/**
 * Frontier Landscape Studio — the layer stack.
 *
 * A landscape is a list of non-destructive layers baked bottom-up. Each layer
 * produces a field, which is combined into the accumulator with a blend mode,
 * an opacity and an optional mask. Nothing is ever edited in place, so the
 * stack can be reordered, muted or re-baked at any time.
 *
 * Parameter schemas are declared next to the layer type so the inspector builds
 * its controls from the same source of truth the baker reads.
 */

import { Perlin, fbm, ridged, billow, cellular, clamp01, mulberry32, warpedFbm } from './noise.js';
import {
  runErosion, erosionDefaults, erosionType, slopeField, flowAccumulation, normalizeFlow,
  fillSinks, EROSION_TYPES,
} from './erosion.js';

/* ------------------------------------------------------------------ schema */

export const range = (key, label, min, max, step, value, unit = '', hint = '') =>
  ({ kind: 'range', key, label, min, max, step, value, unit, hint });
export const select = (key, label, options, value, hint = '') =>
  ({ kind: 'select', key, label, options, value, hint });
export const toggle = (key, label, value, hint = '') => ({ kind: 'toggle', key, label, value, hint });
export const seedParam = (key = 'seed', label = 'Seed') => ({ kind: 'seed', key, label, value: 1337 });
export const group = (label) => ({ kind: 'group', label });

export const BLEND_MODES = [
  { id: 'replace', name: 'Replace', note: 'Overwrite with the layer, faded by opacity' },
  { id: 'add', name: 'Additive', note: 'Raise the surface' },
  { id: 'subtract', name: 'Subtract', note: 'Cut into the surface' },
  { id: 'multiply', name: 'Multiply', note: 'Scale relief — good for falloffs' },
  { id: 'screen', name: 'Screen', note: 'Soften and lift the mid tones' },
  { id: 'min', name: 'Minimum', note: 'Carve: keep whichever surface is lower' },
  { id: 'max', name: 'Maximum', note: 'Build: keep whichever surface is higher' },
  { id: 'overlay', name: 'Overlay', note: 'Contrast around the mid height' },
  { id: 'difference', name: 'Difference', note: 'Invert where the layers cross' },
  { id: 'average', name: 'Average', note: 'Blend evenly between the two' },
];

export const MASK_TYPES = [
  { id: 'none', name: 'No mask' },
  { id: 'radial', name: 'Radial' },
  { id: 'linear', name: 'Linear gradient' },
  { id: 'noise', name: 'Fractal noise' },
  { id: 'height', name: 'Height (from stack)' },
  { id: 'slope', name: 'Slope (from stack)' },
  { id: 'flow', name: 'Flow accumulation' },
];

const maskParams = [
  group('Layer mask'),
  select('maskType', 'Mask', MASK_TYPES.map((m) => ({ value: m.id, label: m.name })), 'none',
    'Restricts where this layer touches the stack'),
  range('maskFeather', 'Feather', 0, 1, 0.01, 0.35, '', 'Softness of the mask edge'),
  range('maskContrast', 'Contrast', 0.05, 4, 0.05, 1, '', 'Pushes the mask towards black or white'),
  range('maskThreshold', 'Threshold', 0, 1, 0.01, 0.5, '', 'Where height / slope / flow masks cut'),
  range('maskAngle', 'Angle', 0, 360, 1, 0, '°', 'Direction for linear masks'),
  range('maskScale', 'Scale', 0.5, 40, 0.5, 6, '', 'Frequency of the fractal mask'),
  range('maskSeed', 'Mask seed', 1, 9999, 1, 921, ''),
  toggle('maskInvert', 'Invert mask', false),
];

/* ------------------------------------------------------------ layer library */

export const LAYER_LIBRARY = [
  /* --- generators --- */
  {
    id: 'base', name: 'Base plane', category: 'Generator', icon: 'Square', accent: '#b9b9b9',
    summary: 'The starting elevation of the landscape, with an optional edge falloff.',
    params: [
      range('elevation', 'Elevation', 0, 1, 0.005, 0.14, '', 'Flat height of the whole field'),
      range('edgeFalloff', 'Edge falloff', 0, 1, 0.01, 0.35, '', 'Pulls the border down towards zero'),
      range('falloffPower', 'Falloff curve', 0.4, 8, 0.1, 2.6, '', 'How abruptly the border drops'),
      range('tilt', 'Tilt', 0, 0.6, 0.005, 0, '', 'A gentle overall incline'),
      range('tiltAngle', 'Tilt bearing', 0, 360, 1, 180, '°'),
    ],
  },
  {
    id: 'noise', name: 'Fractal noise', category: 'Generator', icon: 'Mountain', accent: '#d6a078',
    summary: 'Layered value noise — the workhorse for hills, mountains and general relief.',
    params: [
      select('distribution', 'Distribution', [
        { value: 'fbm', label: 'Fractal (fBm)' },
        { value: 'ridged', label: 'Ridged multifractal' },
        { value: 'billow', label: 'Billow — rounded' },
        { value: 'warped', label: 'Domain warped' },
      ], 'fbm', 'Shape of the fractal'),
      range('amplitude', 'Amplitude', 0, 1, 0.005, 0.62, '', 'Peak height the layer contributes'),
      range('scale', 'Feature size', 0.5, 40, 0.1, 5.5, '', 'Larger means broader features'),
      range('octaves', 'Octaves', 1, 12, 1, 7, '', 'Detail levels stacked on top of each other'),
      range('lacunarity', 'Lacunarity', 1.2, 4, 0.01, 2.02, '', 'Frequency jump between octaves'),
      range('gain', 'Gain', 0.1, 0.9, 0.01, 0.48, '', 'Amplitude drop between octaves'),
      range('sharpness', 'Ridge sharpness', 0.2, 6, 0.05, 1.4, '', 'Ridged distribution only'),
      range('warp', 'Warp amount', 0, 3, 0.01, 0.9, '', 'Domain-warped distribution only'),
      range('contrast', 'Contrast', 0.1, 4, 0.05, 1.15, '', 'Pushes towards flat or peaked'),
      range('exponent', 'Bias', 0.2, 5, 0.05, 1.25, '', 'Below 1 raises lowlands, above 1 sharpens peaks'),
      range('offsetX', 'Offset X', -1, 1, 0.005, 0, ''),
      range('offsetY', 'Offset Y', -1, 1, 0.005, 0, ''),
      toggle('invert', 'Invert', false, 'Turns hills into basins'),
      seedParam(),
    ],
  },
  {
    id: 'cellular', name: 'Cellular / mesas', category: 'Generator', icon: 'Hexagon', accent: '#c3a1ec',
    summary: 'Voronoi cells for buttes, mesas, cracked flats and island chains.',
    params: [
      select('mode', 'Cell shape', [
        { value: 0, label: 'Cells — rounded domes' },
        { value: 1, label: 'Cracks — F2 minus F1' },
        { value: 2, label: 'Mesas — blended' },
      ], 0),
      range('amplitude', 'Amplitude', 0, 1, 0.005, 0.5),
      range('scale', 'Cell size', 1, 60, 0.5, 11, '', 'Larger means fewer, broader cells'),
      range('smoothness', 'Mesas blend', 0, 1, 0.01, 0.35, '', 'Mesas shape only'),
      range('plateau', 'Plateau cut', 0, 1, 0.01, 0.35, '', 'Flattens cell tops into mesas'),
      range('octaves', 'Detail octaves', 0, 6, 1, 2, '', 'Fine relief added to each cell'),
      range('detailScale', 'Detail size', 1, 40, 0.5, 14),
      range('contrast', 'Contrast', 0.1, 4, 0.05, 1.1),
      toggle('invert', 'Invert', false),
      seedParam(),
    ],
  },
  {
    id: 'island', name: 'Island falloff', category: 'Generator', icon: 'LifeBuoy', accent: '#8ebce8',
    summary: 'Radial falloff that turns any stack into an island surrounded by ocean.',
    params: [
      select('shape', 'Falloff shape', [
        { value: 'radial', label: 'Circular' },
        { value: 'square', label: 'Square' },
        { value: 'organic', label: 'Organic coastline' },
      ], 'organic'),
      range('radius', 'Radius', 0.1, 1.2, 0.01, 0.62, '', 'How far the land reaches'),
      range('exponent', 'Curve', 0.4, 8, 0.05, 2.4, '', 'Steepness of the shoreline drop'),
      range('coastNoise', 'Coastline roughness', 0, 1, 0.01, 0.55, '', 'Breaks the circle into bays and headlands'),
      range('coastScale', 'Coast feature size', 0.5, 20, 0.1, 4.5),
      range('amplitude', 'Amplitude', 0, 1, 0.005, 1),
      toggle('invert', 'Invert — basin instead of island', false),
      seedParam(),
    ],
  },
  {
    id: 'cone', name: 'Volcanic cone', category: 'Generator', icon: 'Triangle', accent: '#e2a07a',
    summary: 'A single placed peak with a caldera — position it by dragging in the viewport.',
    params: [
      range('height', 'Height', 0, 1, 0.005, 0.72),
      range('radius', 'Base radius', 0.02, 0.8, 0.005, 0.24),
      range('curve', 'Profile curve', 0.4, 5, 0.05, 1.35, '', 'Below 1 bulges, above 1 sharpens'),
      range('craterRadius', 'Crater radius', 0, 0.5, 0.005, 0.1),
      range('craterDepth', 'Crater depth', 0, 1, 0.005, 0.24),
      range('roughness', 'Cone roughness', 0, 1, 0.01, 0.3),
      range('roughScale', 'Roughness size', 1, 40, 0.5, 16),
      range('posX', 'Position X', 0, 1, 0.005, 0.5),
      range('posY', 'Position Y', 0, 1, 0.005, 0.44),
      seedParam(),
    ],
  },
  {
    id: 'terrace', name: 'Terraces', category: 'Generator', icon: 'AlignJustify', accent: '#b2bea8',
    summary: 'Quantizes the incoming surface into stepped plateaus and risers.',
    modifier: true,
    params: [
      range('steps', 'Steps', 2, 96, 1, 14),
      range('smoothness', 'Riser softness', 0, 1, 0.01, 0.28, '', 'How rounded each step edge is'),
      range('offset', 'Offset', 0, 1, 0.01, 0),
      range('amount', 'Amount', 0, 1, 0.01, 0.85, '', 'Blends between raw and fully stepped'),
      toggle('invert', 'Invert steps', false),
    ],
  },
  {
    id: 'ramp', name: 'Directional ramp', category: 'Generator', icon: 'MoveUpRight', accent: '#87c1ba',
    summary: 'A tilted plane, useful for a coastline running across the map.',
    params: [
      range('angle', 'Bearing', 0, 360, 1, 200, '°'),
      range('height', 'Rise', 0, 1, 0.005, 0.55),
      range('curve', 'Curve', 0.3, 4, 0.05, 1),
      range('amplitude', 'Amplitude', 0, 1, 0.005, 1),
      toggle('invert', 'Invert', false),
    ],
  },

  /* --- modifiers --- */
  {
    id: 'smooth', name: 'Smooth / blur', category: 'Modifier', icon: 'Droplet', accent: '#9cbde7',
    summary: 'Separable Gaussian blur — softens noise and blends erosion scars.',
    modifier: true,
    params: [
      range('radius', 'Radius', 1, 24, 1, 4, 'cells'),
      range('passes', 'Passes', 1, 12, 1, 2),
      range('amount', 'Amount', 0, 1, 0.01, 1),
      toggle('preservePeaks', 'Preserve peaks', false, 'Only smooths where the surface is gentle'),
    ],
  },
  {
    id: 'sharpen', name: 'Sharpen / detail', category: 'Modifier', icon: 'Sparkles', accent: '#cab281',
    summary: 'Unsharp mask — brings fine ridges and gullies back out.',
    modifier: true,
    params: [
      range('radius', 'Radius', 1, 24, 1, 2, 'cells'),
      range('amount', 'Amount', 0, 3, 0.01, 0.85),
      range('threshold', 'Threshold', 0, 0.2, 0.001, 0.002, '', 'Ignores flat areas'),
      toggle('clamp', 'Clamp to 0–1', true),
    ],
  },
  {
    id: 'flatten', name: 'Flatten / plateau', category: 'Modifier', icon: 'Minus', accent: '#a4c6e6',
    summary: 'Levels everything within a band to a single height — lake beds, airfields.',
    modifier: true,
    params: [
      range('level', 'Level', 0, 1, 0.005, 0.22),
      range('tolerance', 'Tolerance', 0.001, 0.6, 0.001, 0.09, '', 'How far from the level is affected'),
      range('feather', 'Feather', 0, 1, 0.01, 0.5, '', 'Softness of the transition'),
      select('mode', 'Affect', [
        { value: 'both', label: 'Above and below' },
        { value: 'above', label: 'Only above the level' },
        { value: 'below', label: 'Only below the level' },
      ], 'both'),
      range('amount', 'Amount', 0, 1, 0.01, 1),
    ],
  },
  {
    id: 'normalize', name: 'Remap range', category: 'Modifier', icon: 'ArrowUpDown', accent: '#d3bea0',
    summary: 'Rescales the whole field into a new elevation range.',
    modifier: true,
    params: [
      range('low', 'Low point', -0.5, 1, 0.005, 0),
      range('high', 'High point', 0, 1.5, 0.005, 1),
      range('gamma', 'Curve', 0.2, 4, 0.02, 1),
      toggle('auto', 'Auto-fit to the stack', true, 'Uses the actual min and max of the incoming field'),
      range('margin', 'Margin', 0, 0.3, 0.005, 0.02, '', 'Padding left at the top and bottom'),
    ],
  },
  {
    id: 'erode', name: 'Erosion', category: 'Process', icon: 'Waves', accent: '#81b8c8',
    summary: 'Runs a physical erosion process over the incoming surface.',
    modifier: true, heavy: true,
    params: [
      select('type', 'Process', EROSION_TYPES.map((t) => ({ value: t.id, label: t.name })), 'hydraulic',
        'Each process exposes its own controls below'),
      range('strength', 'Strength', 0, 2, 0.01, 1, '', 'Scales the total displacement'),
      range('verticalScale', 'Vertical scale', 0.2, 6, 0.05, 1, '',
        'Taller terrain means steeper slopes, so angle-of-repose failures happen sooner'),
      seedParam('seed', 'Simulation seed'),
    ],
  },
  {
    id: 'brush', name: 'Sculpt strokes', category: 'Paint', icon: 'Brush', accent: '#c5a6d7',
    summary: 'Hand-painted height. Select this layer and paint in the viewport.',
    modifier: true,
    params: [
      select('mode', 'Brush', [
        { value: 'raise', label: 'Raise' },
        { value: 'lower', label: 'Lower' },
        { value: 'smooth', label: 'Smooth' },
        { value: 'flatten', label: 'Flatten' },
        { value: 'plateau', label: 'Plateau (level)' },
        { value: 'noise', label: 'Noise stamp' },
        { value: 'erase', label: 'Erase strokes' },
      ], 'raise'),
      range('size', 'Size', 2, 90, 1, 22, 'cells'),
      range('strength', 'Strength', 0.001, 1, 0.001, 0.18),
      range('falloff', 'Falloff', 0, 1, 0.01, 0.62, '', 'Hardness of the brush edge'),
      range('level', 'Target level', 0, 1, 0.005, 0.3, '', 'Flatten / plateau only'),
      range('noiseScale', 'Noise size', 1, 40, 0.5, 8, '', 'Noise stamp only'),
      toggle('accumulate', 'Build up while held', true),
      seedParam(),
    ],
  },
  {
    id: 'import', name: 'Imported heightmap', category: 'Generator', icon: 'ImageUp', accent: '#a8bbeb',
    summary: 'A 16-bit grayscale PNG loaded from disk, resampled onto the grid.',
    params: [
      range('amplitude', 'Amplitude', 0, 2, 0.005, 1),
      range('offset', 'Offset', -1, 1, 0.005, 0),
      range('rotation', 'Rotation', 0, 360, 1, 0, '°'),
      select('fit', 'Fit', [
        { value: 'stretch', label: 'Stretch to grid' },
        { value: 'contain', label: 'Contain — keep ratio' },
        { value: 'cover', label: 'Cover — crop' },
      ], 'stretch'),
      toggle('invert', 'Invert', false),
      toggle('flipY', 'Flip vertically', true),
    ],
  },
];

export const layerType = (id) => LAYER_LIBRARY.find((t) => t.id === id) || LAYER_LIBRARY[0];

export function typeDefaults(id) {
  const out = {};
  for (const p of layerType(id).params) {
    if (p.kind === 'group') continue;
    out[p.key] = p.value;
  }
  return out;
}

/**
 * Every parameter a layer owns, split into inspector cards by `group` markers.
 * The type's own controls come first, the shared layer mask last.
 */
export function layerSchema(id) {
  const type = layerType(id);
  return [{ kind: 'group', label: type.name }, ...type.params, ...maskParams];
}

/** The single-layer evaluator, also used for inspector previews. */
export function evaluateLayer(type, params, res, incoming, ctx) {
  const scratch = {
    perlin: (seed) => new Perlin(seed),
    brushField: ctx?.brushField || null,
    imported: ctx?.imported || null,
    ...ctx,
  };
  if (!scratch.perlinCache) {
    const cache = new Map();
    scratch.perlin = (seed) => {
      if (!cache.has(seed)) cache.set(seed, new Perlin(seed));
      return cache.get(seed);
    };
  }
  return generate(type, params, res, incoming, scratch);
}

/* --------------------------------------------------------------- factories */

let counter = 0;
export function newLayerId(prefix = 'layer') {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

/** Create a layer with sensible defaults and a descriptive name. */
export function createLayer(typeId, overrides = {}) {
  const type = layerType(typeId);
  const params = { ...typeDefaults(typeId) };
  if (typeId === 'erode') params.tuning = {};
  return {
    id: newLayerId(typeId),
    type: typeId,
    name: overrides.name || type.name,
    enabled: true,
    opacity: 1,
    blend: typeId === 'base' ? 'replace' : type.modifier ? 'replace' : 'add',
    color: type.accent,
    params,
    ...overrides,
  };
}

/** The opening stack: a plausible island landscape that shows every feature. */
export function defaultLayers() {
  const base = createLayer('base', { name: 'Bedrock plane' });
  base.blend = 'replace';
  base.params.elevation = 0.2;
  base.params.edgeFalloff = 0;

  const land = createLayer('noise', { name: 'Continental relief' });
  land.blend = 'replace';
  land.opacity = 0.92;
  land.params.distribution = 'fbm';
  land.params.amplitude = 0.6;
  land.params.scale = 4.6;
  land.params.octaves = 8;
  land.params.gain = 0.5;
  land.params.contrast = 1.25;
  land.params.exponent = 1.25;
  land.params.seed = 4821;

  const spine = createLayer('noise', { name: 'Mountain spine' });
  spine.blend = 'max';
  spine.opacity = 0.95;
  spine.params.distribution = 'ridged';
  spine.params.amplitude = 0.82;
  spine.params.scale = 8.5;
  spine.params.octaves = 6;
  spine.params.sharpness = 1.9;
  spine.params.seed = 913;
  spine.params.maskType = 'linear';
  spine.params.maskAngle = 24;
  spine.params.maskFeather = 0.75;
  spine.params.maskContrast = 1.1;
  spine.params.maskThreshold = 0.5;

  const mid = createLayer('noise', { name: 'Foothills' });
  mid.blend = 'add';
  mid.opacity = 0.34;
  mid.params.distribution = 'ridged';
  mid.params.amplitude = 0.5;
  mid.params.scale = 17;
  mid.params.octaves = 5;
  mid.params.sharpness = 1.4;
  mid.params.seed = 607;

  const coast = createLayer('island', { name: 'Coastline falloff' });
  coast.blend = 'multiply';
  coast.opacity = 1;
  coast.params.shape = 'organic';
  coast.params.radius = 0.78;
  coast.params.exponent = 2.7;
  coast.params.coastNoise = 0.55;
  coast.params.seed = 2277;

  const detail = createLayer('noise', { name: 'Surface detail' });
  detail.blend = 'add';
  detail.opacity = 0.2;
  detail.params.distribution = 'billow';
  detail.params.amplitude = 0.3;
  detail.params.scale = 34;
  detail.params.octaves = 4;
  detail.params.seed = 5150;

  const rivers = createLayer('erode', { name: 'River systems' });
  rivers.blend = 'replace';
  rivers.opacity = 1;
  rivers.params.type = 'hydraulic';
  rivers.params.strength = 1.15;
  rivers.params.seed = 7717;
  rivers.params.tuning = { hydraulic: { ...erosionDefaults('hydraulic'), droplets: 120000, lifetime: 46 } };

  const talus = createLayer('erode', { name: 'Talus & scree' });
  talus.blend = 'replace';
  talus.params.type = 'thermal';
  talus.params.strength = 0.8;
  talus.params.seed = 4409;
  talus.params.tuning = { thermal: { ...erosionDefaults('thermal'), iterations: 110 } };

  const sculpt = createLayer('brush', { name: 'Hand sculpt' });
  sculpt.blend = 'replace';
  sculpt.opacity = 1;
  sculpt.params.size = 22;

  return [base, land, spine, mid, coast, detail, rivers, talus, sculpt];
}

/* ------------------------------------------------------------------- baking */

/** Blend one field into another. Both are normalized [0,1]. */
export function blendField(base, layer, mode, opacity) {
  if (opacity <= 0) return;
  const n = base.length;
  const o = Math.min(1, Math.max(0, opacity));
  switch (mode) {
    case 'replace':
      for (let i = 0; i < n; i++) base[i] += (layer[i] - base[i]) * o;
      break;
    case 'add':
      for (let i = 0; i < n; i++) base[i] += layer[i] * o;
      break;
    case 'subtract':
      for (let i = 0; i < n; i++) base[i] -= layer[i] * o;
      break;
    case 'multiply':
      for (let i = 0; i < n; i++) base[i] *= 1 + (layer[i] - 1) * o;
      break;
    case 'screen': {
      for (let i = 0; i < n; i++) {
        const s = 1 - (1 - base[i]) * (1 - layer[i]);
        base[i] += (s - base[i]) * o;
      }
      break;
    }
    case 'min':
      for (let i = 0; i < n; i++) base[i] = base[i] + (Math.min(base[i], layer[i]) - base[i]) * o;
      break;
    case 'max':
      for (let i = 0; i < n; i++) base[i] = base[i] + (Math.max(base[i], layer[i]) - base[i]) * o;
      break;
    case 'overlay': {
      for (let i = 0; i < n; i++) {
        const b = base[i];
        const v = b < 0.5 ? 2 * b * layer[i] : 1 - 2 * (1 - b) * (1 - layer[i]);
        base[i] += (v - b) * o;
      }
      break;
    }
    case 'difference': {
      for (let i = 0; i < n; i++) {
        const v = Math.abs(base[i] - layer[i]);
        base[i] += (v - base[i]) * o;
      }
      break;
    }
    case 'average':
      for (let i = 0; i < n; i++) base[i] += ((base[i] + layer[i]) * 0.5 - base[i]) * o;
      break;
    default:
      for (let i = 0; i < n; i++) base[i] += (layer[i] - base[i]) * o;
  }
}

/** Build the mask for a layer, or null when unmasked. */
export function buildMask(params, res, incoming, ctx) {
  const type = params.maskType || 'none';
  if (type === 'none') return null;
  const n = res * res;
  const mask = new Float32Array(n);
  const feather = Math.max(0.001, params.maskFeather ?? 0.35);
  const contrast = params.maskContrast ?? 1;
  const threshold = params.maskThreshold ?? 0.5;
  const invert = !!params.maskInvert;

  if (type === 'radial') {
    const cx = res * 0.5, cy = res * 0.5;
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const d = Math.hypot(x - cx, y - cy) / (res * 0.5);
        mask[y * res + x] = clamp01(1 - d / feather);
      }
    }
  } else if (type === 'linear') {
    const a = ((params.maskAngle ?? 0) * Math.PI) / 180;
    const dx = Math.sin(a), dy = -Math.cos(a);
    const cx = res * 0.5, cy = res * 0.5;
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const t = ((x - cx) * dx + (y - cy) * dy) / (res * 0.5);
        mask[y * res + x] = clamp01((t + feather) / (2 * feather));
      }
    }
  } else if (type === 'noise') {
    const perlin = new Perlin(params.maskSeed ?? 921);
    const scale = params.maskScale ?? 6;
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        mask[y * res + x] = fbm(perlin, (x / res) * scale, (y / res) * scale, 5, 2, 0.5);
      }
    }
  } else if (type === 'height') {
    for (let i = 0; i < n; i++) {
      const d = (incoming[i] - threshold) / feather;
      mask[i] = clamp01(d + 0.5);
    }
  } else if (type === 'slope') {
    const slope = ctx.slope || slopeField(incoming, res);
    ctx.slope = slope;
    for (let i = 0; i < n; i++) {
      const d = (slope[i] * 12 - threshold) / feather;
      mask[i] = clamp01(d + 0.5);
    }
  } else if (type === 'flow') {
    const flow = ctx.flow || normalizeFlow(flowAccumulation(incoming, res));
    ctx.flow = flow;
    for (let i = 0; i < n; i++) {
      const d = (flow[i] - threshold) / feather;
      mask[i] = clamp01(d + 0.5);
    }
  }

  // Contrast around the midpoint, then optional inversion.
  if (contrast !== 1) {
    for (let i = 0; i < n; i++) mask[i] = clamp01(Math.pow(mask[i], 1 / Math.max(0.01, contrast)));
  }
  if (invert) for (let i = 0; i < n; i++) mask[i] = 1 - mask[i];
  return mask;
}

/** Separable box blur, applied `passes` times to approximate a Gaussian. */
export function blur(src, res, radius, passes) {
  let a = new Float32Array(src);
  let b = new Float32Array(src.length);
  const r = Math.max(1, Math.round(radius));
  for (let p = 0; p < passes; p++) {
    // Horizontal
    for (let y = 0; y < res; y++) {
      let sum = 0;
      const row = y * res;
      for (let x = -r; x <= r; x++) sum += a[row + Math.min(res - 1, Math.max(0, x))];
      for (let x = 0; x < res; x++) {
        b[row + x] = sum / (2 * r + 1);
        const add = a[row + Math.min(res - 1, x + r + 1)];
        const sub = a[row + Math.max(0, x - r)];
        sum += add - sub;
      }
    }
    // Vertical
    for (let x = 0; x < res; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += b[Math.min(res - 1, Math.max(0, y)) * res + x];
      for (let y = 0; y < res; y++) {
        a[y * res + x] = sum / (2 * r + 1);
        sum += b[Math.min(res - 1, y + r + 1) * res + x] - b[Math.max(0, y - r) * res + x];
      }
    }
  }
  return a;
}

/* ------------------------------------------------------- layer evaluation */

function generate(type, p, res, incoming, ctx) {
  const n = res * res;
  const out = new Float32Array(n);

  switch (type) {
    case 'base': {
      const tiltA = ((p.tiltAngle ?? 0) * Math.PI) / 180;
      const tx = Math.sin(tiltA), ty = -Math.cos(tiltA);
      const ef = p.edgeFalloff ?? 0, fp = Math.max(0.05, p.falloffPower ?? 2);
      for (let y = 0; y < res; y++) {
        const fy = y / (res - 1);
        for (let x = 0; x < res; x++) {
          const fx = x / (res - 1);
          let v = p.elevation ?? 0.14;
          if (ef > 0) {
            const dx = Math.min(fx, 1 - fx) * 2, dy = Math.min(fy, 1 - fy) * 2;
            const d = Math.min(dx, dy);
            v *= clamp01(Math.pow(clamp01(d / ef), fp));
          }
          if (p.tilt > 0) v += ((fx - 0.5) * tx + (fy - 0.5) * ty) * p.tilt;
          out[y * res + x] = v;
        }
      }
      return out;
    }

    case 'noise': {
      const perlin = ctx.perlin(p.seed ?? 1337);
      const scale = Math.max(0.1, p.scale ?? 4);
      const oct = Math.max(1, p.octaves ?? 6);
      const amp = p.amplitude ?? 1;
      const exp = p.exponent ?? 1;
      const contrast = p.contrast ?? 1;
      const ox = (p.offsetX ?? 0) * 40, oy = (p.offsetY ?? 0) * 40;
      const mode = p.distribution || 'fbm';
      for (let y = 0; y < res; y++) {
        for (let x = 0; x < res; x++) {
          const nx = (x / res) * scale + ox;
          const ny = (y / res) * scale + oy;
          let v;
          if (mode === 'ridged') v = ridged(perlin, nx, ny, oct, p.lacunarity ?? 2, p.gain ?? 0.5, p.sharpness ?? 1.4);
          else if (mode === 'billow') v = billow(perlin, nx, ny, oct, p.lacunarity ?? 2, p.gain ?? 0.5);
          else if (mode === 'warped') v = warpedFbm(perlin, nx, ny, oct, p.lacunarity ?? 2, p.gain ?? 0.5, p.warp ?? 0.9, p.seed ?? 1337, 1.4);
          else v = fbm(perlin, nx, ny, oct, p.lacunarity ?? 2, p.gain ?? 0.5);
          if (contrast !== 1) v = clamp01((v - 0.5) * contrast + 0.5);
          if (exp !== 1) v = Math.pow(v, exp);
          if (p.invert) v = 1 - v;
          out[y * res + x] = v * amp;
        }
      }
      return out;
    }

    case 'cellular': {
      const perlin = ctx.perlin(p.seed ?? 1337);
      const scale = Math.max(0.5, p.scale ?? 10);
      const mode = p.mode ?? 0;
      const amp = p.amplitude ?? 1;
      const oct = p.octaves ?? 0;
      const dscale = p.detailScale ?? 12;
      const plateau = p.plateau ?? 0;
      const contrast = p.contrast ?? 1;
      for (let y = 0; y < res; y++) {
        for (let x = 0; x < res; x++) {
          const nx = (x / res) * scale, ny = (y / res) * scale;
          let v = cellular(nx, ny, p.seed ?? 1337, mode, p.smoothness ?? 0.35);
          v = 1 - v; // cells become domes rather than pits
          if (plateau > 0) v = v * (1 - plateau) + clamp01(Math.round(v * 6) / 6) * plateau;
          if (contrast !== 1) v = clamp01((v - 0.5) * contrast + 0.5);
          if (oct > 0) v = clamp01(v * 0.75 + fbm(perlin, (x / res) * dscale, (y / res) * dscale, oct, 2, 0.5) * 0.25);
          if (p.invert) v = 1 - v;
          out[y * res + x] = v * amp;
        }
      }
      return out;
    }

    case 'island': {
      const perlin = ctx.perlin(p.seed ?? 991);
      const radius = Math.max(0.05, p.radius ?? 0.6);
      const exp = Math.max(0.1, p.exponent ?? 2.4);
      const rough = p.coastNoise ?? 0;
      const rscale = p.coastScale ?? 4.5;
      const cx = res * 0.5, cy = res * 0.5;
      for (let y = 0; y < res; y++) {
        for (let x = 0; x < res; x++) {
          let d;
          const fx = (x - cx) / (res * 0.5), fy = (y - cy) / (res * 0.5);
          if (p.shape === 'square') d = Math.max(Math.abs(fx), Math.abs(fy));
          else d = Math.hypot(fx, fy);
          if (rough > 0) d += (fbm(perlin, (x / res) * rscale, (y / res) * rscale, 5, 2, 0.5) - 0.5) * rough * 0.55;
          let v = clamp01(1 - Math.pow(clamp01(d / radius), exp));
          if (p.invert) v = 1 - v;
          out[y * res + x] = v * (p.amplitude ?? 1);
        }
      }
      return out;
    }

    case 'cone': {
      const perlin = ctx.perlin(p.seed ?? 424);
      const px = (p.posX ?? 0.5) * res, py = (p.posY ?? 0.5) * res;
      const radius = Math.max(0.01, p.radius ?? 0.25) * res;
      const curve = Math.max(0.2, p.curve ?? 1.3);
      const craterR = (p.craterRadius ?? 0) * radius * 2;
      const craterD = p.craterDepth ?? 0;
      const rough = p.roughness ?? 0, rscale = p.roughScale ?? 16;
      for (let y = 0; y < res; y++) {
        for (let x = 0; x < res; x++) {
          const d = Math.hypot(x - px, y - py);
          let v = clamp01(1 - d / radius);
          v = Math.pow(v, curve);
          if (craterR > 0) {
            const c = clamp01(1 - d / craterR);
            v -= Math.pow(c, 1.6) * craterD;
          }
          if (rough > 0) v += (fbm(perlin, (x / res) * rscale, (y / res) * rscale, 4, 2, 0.5) - 0.5) * rough * v;
          out[y * res + x] = clamp01(v) * (p.height ?? 1);
        }
      }
      return out;
    }

    case 'ramp': {
      const a = ((p.angle ?? 0) * Math.PI) / 180;
      const dx = Math.sin(a), dy = -Math.cos(a);
      const curve = Math.max(0.2, p.curve ?? 1);
      for (let y = 0; y < res; y++) {
        for (let x = 0; x < res; x++) {
          const t = ((x / (res - 1) - 0.5) * dx + (y / (res - 1) - 0.5) * dy) + 0.5;
          let v = Math.pow(clamp01(t), curve) * (p.height ?? 0.5);
          if (p.invert) v = (p.height ?? 0.5) - v;
          out[y * res + x] = v * (p.amplitude ?? 1);
        }
      }
      return out;
    }

    case 'terrace': {
      const steps = Math.max(2, p.steps ?? 12);
      const amount = p.amount ?? 1;
      const smoothness = p.smoothness ?? 0.3;
      const offset = p.offset ?? 0;
      for (let i = 0; i < n; i++) {
        const v = clamp01(incoming[i] + offset);
        const q = v * steps;
        const floorQ = Math.floor(q);
        const frac = q - floorQ;
        let stepped = (floorQ + smoothstepRiser(frac, smoothness)) / steps;
        if (p.invert) stepped = 1 - stepped;
        out[i] = v * (1 - amount) + stepped * amount;
      }
      return out;
    }

    /* modifiers return the edited incoming field */
    case 'smooth': {
      out.set(incoming);
      const amount = p.amount ?? 1;
      let working = new Float32Array(incoming);
      if (p.preservePeaks) {
        // Only smooth gentle ground: weight the blur by inverse slope.
        const slope = ctx.slope || slopeField(incoming, res);
        ctx.slope = slope;
        const gentle = new Float32Array(n);
        for (let i = 0; i < n; i++) gentle[i] = clamp01(1 - slope[i] * 16);
        const blurredH = blur(incoming, res, p.radius ?? 4, p.passes ?? 2);
        const weighted = blurWeighted(incoming, blurredH, gentle, res);
        for (let i = 0; i < n; i++) out[i] = working[i] + (weighted[i] - working[i]) * amount;
        return out;
      }
      const blurredH = blur(incoming, res, p.radius ?? 4, p.passes ?? 2);
      for (let i = 0; i < n; i++) out[i] = working[i] + (blurredH[i] - working[i]) * amount;
      return out;
    }

    case 'sharpen': {
      const blurred = blur(incoming, res, p.radius ?? 2, 1);
      const amount = p.amount ?? 1;
      const threshold = p.threshold ?? 0;
      for (let i = 0; i < n; i++) {
        const diff = incoming[i] - blurred[i];
        const boosted = Math.abs(diff) > threshold ? incoming[i] + diff * amount : incoming[i];
        out[i] = p.clamp === false ? boosted : clamp01(boosted);
      }
      return out;
    }

    case 'flatten': {
      const level = p.level ?? 0.25;
      const tol = Math.max(0.001, p.tolerance ?? 0.1);
      const feather = Math.max(0.001, p.feather ?? 0.5);
      const amount = p.amount ?? 1;
      for (let i = 0; i < n; i++) {
        const v = incoming[i];
        const d = v - level;
        if (p.mode === 'above' && d < 0) { out[i] = v; continue; }
        if (p.mode === 'below' && d > 0) { out[i] = v; continue; }
        const inside = clamp01(1 - Math.abs(d) / tol);
        const w = Math.pow(inside, 1 / Math.max(0.05, feather)) * amount;
        out[i] = v + (level - v) * w;
      }
      return out;
    }

    case 'normalize': {
      let lo = p.low ?? 0, hi = p.high ?? 1;
      if (p.auto) {
        lo = Infinity; hi = -Infinity;
        for (let i = 0; i < n; i++) { if (incoming[i] < lo) lo = incoming[i]; if (incoming[i] > hi) hi = incoming[i]; }
        if (!isFinite(lo) || !isFinite(hi) || hi - lo < 1e-9) { lo = 0; hi = 1; }
        const m = (p.margin ?? 0) * (hi - lo);
        lo += m; hi -= m;
      }
      const gamma = Math.max(0.05, p.gamma ?? 1);
      const span = hi - lo || 1;
      for (let i = 0; i < n; i++) {
        let t = clamp01((incoming[i] - lo) / span);
        if (gamma !== 1) t = Math.pow(t, gamma);
        out[i] = t;
      }
      return out;
    }

    case 'brush': {
      out.set(incoming);
      const field = ctx.brushField;
      if (field) for (let i = 0; i < n; i++) out[i] += field[i];
      return out;
    }

    case 'import': {
      out.set(ctx.imported || incoming);
      const amp = p.amplitude ?? 1, off = p.offset ?? 0;
      for (let i = 0; i < n; i++) out[i] = clamp01(out[i] * amp + off);
      if (p.invert) for (let i = 0; i < n; i++) out[i] = 1 - out[i];
      return out;
    }

    default:
      out.set(incoming);
      return out;
  }
}

function smoothstepRiser(frac, smoothness) {
  if (smoothness <= 0.001) return frac < 0.5 ? 0 : 1;
  const lo = 0.5 - smoothness * 0.5, hi = 0.5 + smoothness * 0.5;
  if (frac < lo) return 0;
  if (frac > hi) return 1;
  const t = (frac - lo) / (hi - lo);
  return t * t * (3 - 2 * t);
}

/** Blur weighted by a per-cell mask so peaks survive smoothing. */
function blurWeighted(src, blurred, weight, res) {
  const out = new Float32Array(src.length);
  for (let i = 0; i < out.length; i++) out[i] = src[i] + (blurred[i] - src[i]) * weight[i];
  return out;
}

/**
 * Bake the whole stack.
 *
 * @param {Array} layers  layer list, bottom first
 * @param {number} res    grid resolution
 * @param {object} ctx    { worldSize, maxHeight, brushFields, imported,
 *                          captureBefore, onProgress, onErosionProgress }
 * @returns {object} { height, eroded, deposited, flow, water, talus, stats, layerOutputs }
 */
export function bakeStack(layers, res, ctx = {}) {
  const n = res * res;
  const perlinCache = new Map();
  // cellSize / maxHeight turns the normalized field into real slope. Erosion
  // thresholds such as an angle of repose are meaningless without it.
  const worldSize = ctx.worldSize || 2048;
  const maxHeight = ctx.maxHeight || 900;
  const aspect = (worldSize / Math.max(1, res - 1)) / Math.max(1, maxHeight);

  const context = {
    aspect,
    perlin: (seed) => {
      if (!perlinCache.has(seed)) perlinCache.set(seed, new Perlin(seed));
      return perlinCache.get(seed);
    },
    brushFields: ctx.brushFields || {},
    imported: ctx.imported || null,
    ...ctx,
  };
  context.perlin = (seed) => {
    if (!perlinCache.has(seed)) perlinCache.set(seed, new Perlin(seed));
    return perlinCache.get(seed);
  };

  const height = new Float32Array(n);
  const maps = {
    eroded: new Float32Array(n),
    deposited: new Float32Array(n),
    flow: new Float32Array(n),
    water: new Float32Array(n),
    talus: new Float32Array(n),
  };
  const enabled = layers.filter((l) => l.enabled !== false);
  const layerOutputs = [];
  const captures = {};
  const captureBefore = ctx.captureBefore instanceof Set ? ctx.captureBefore : new Set(ctx.captureBefore || []);

  for (let li = 0; li < enabled.length; li++) {
    const layer = enabled[li];
    if (ctx.onProgress) ctx.onProgress(li / Math.max(1, enabled.length), layer.name);

    const p = layer.params || {};
    // Sculpt layers need the surface as it stood before they were applied, so
    // a live stroke can be previewed without re-running the whole stack.
    if (captureBefore.has(layer.id)) captures[layer.id] = new Float32Array(height);
    const scratch = { ...context };
    if (layer.type === 'brush') scratch.brushField = context.brushFields[layer.id] || null;
    if (layer.type === 'erode') scratch.slope = null, scratch.flow = null;

    let field;
    if (layer.type === 'erode') {
      // Erosion edits the accumulator directly, then reports the delta as its field.
      const before = new Float32Array(height);
      const erosionParams = erosionLayerParams(layer);
      runErosion(p.type || 'hydraulic', height, res, erosionParams, {
        strength: p.strength ?? 1,
        seed: p.seed || 1337,
        aspect: context.aspect,
        verticalScale: p.verticalScale ?? 1,
        maps,
        onProgress: ctx.onErosionProgress,
      });
      field = new Float32Array(n);
      for (let i = 0; i < n; i++) field[i] = height[i];
      // Undo the in-place edit: the blend step below is what commits it, which
      // keeps opacity, blend mode and masks meaningful for erosion too.
      height.set(before);
      for (let i = 0; i < n; i++) height[i] = clamp01(height[i]);
      scratch.slope = null;
      scratch.flow = null;
    } else {
      field = generate(layer.type, p, res, height, scratch);
    }

    if (!field) continue;
    for (let i = 0; i < n; i++) field[i] = clamp01(field[i]);

    const mask = buildMask(p, res, height, scratch);
    const opacity = layer.opacity ?? 1;
    if (mask) {
      const masked = new Float32Array(n);
      for (let i = 0; i < n; i++) masked[i] = height[i] + (field[i] - height[i]) * mask[i];
      blendField(height, masked, layer.blend || 'replace', opacity);
    } else {
      blendField(height, field, layer.blend || 'replace', opacity);
    }
    for (let i = 0; i < n; i++) height[i] = clamp01(height[i]);
    if (ctx.captureLayers) layerOutputs.push({ id: layer.id, name: layer.name, field: new Float32Array(height) });
  }

  if (ctx.onProgress) ctx.onProgress(1, 'Done');

  // Diagnostics for the whole stack: accumulation drives rivers, texture rules
  // and the glacier process, so it is always recomputed from the final field.
  const flowNorm = normalizeFlow(flowAccumulation(height, res));
  maps.flowNorm = flowNorm;
  for (let i = 0; i < n; i++) maps.flow[i] = Math.max(maps.flow[i] ? clamp01(maps.flow[i]) : 0, flowNorm[i]);

  const stats = fieldStats(height, n);
  return { height, ...maps, stats, layerOutputs, captures };
}

export function fieldStats(h, n = h.length) {
  let min = Infinity, max = -Infinity, sum = 0;
  for (let i = 0; i < n; i++) {
    const v = h[i];
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, max, mean: sum / Math.max(1, n) };
}

/** Resolved erosion parameters for a layer, cached per process type. */
export function erosionLayerParams(layer) {
  const p = layer.params || {};
  const type = p.type || 'hydraulic';
  const tuning = p.tuning || {};
  if (!tuning[type]) tuning[type] = erosionDefaults(type);
  return tuning[type];
}

/** Update one process' tuning without disturbing the others. */
export function setErosionParam(layer, key, value) {
  const p = { ...layer.params };
  const type = p.type || 'hydraulic';
  const tuning = { ...(p.tuning || {}) };
  tuning[type] = { ...(tuning[type] || erosionDefaults(type)), [key]: value };
  p.tuning = tuning;
  return p;
}

export { erosionType, erosionDefaults, EROSION_TYPES, slopeField, flowAccumulation, normalizeFlow };
