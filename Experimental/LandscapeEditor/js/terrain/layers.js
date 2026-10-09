// Layer registry. One place that says what each layer type is, what it stores, and how the inspector
// should present it. The inspector, the pipeline and the layer list all read from here, so adding a
// type means adding an entry here and a branch in pipeline.js.
//
// Control descriptors:
//   { key, label, min, max, step, digits, unit, help }   range slider with a numeric field
//   { key, label, kind: 'select', options: [[value, label], ...] }
//
// Layer kinds:
//   'height'   generators and modifiers, evaluated bottom to top, each producing a new heightmap
//   'texture'  satmap layers, evaluated after all height layers, each producing an RGB colour map

import { PALETTE_OPTIONS } from './satmap.js';

export const BLEND_MODES = ['Normal', 'Add', 'Subtract', 'Multiply', 'Max', 'Min'];
const BLEND_OPTIONS = BLEND_MODES.map((m) => [m, m]);

export const GROUPS = {
  generator: { label: 'Generators', kind: 'height' },
  erosion: { label: 'Erosion', kind: 'height' },
  shaping: { label: 'Shaping', kind: 'height' },
  texture: { label: 'Texture', kind: 'texture' },
};

// Erosion types. Each owns its parameters, so switching the dropdown keeps every type's own settings.
export const EROSION_TYPES = {
  hydraulic: {
    label: 'Hydraulic · droplets',
    short: 'Hydraulic',
    blurb: 'Rain droplets roll downhill, take up sediment on steep faces and drop it where the flow slows. Carves gullies and fans.',
    defaults: { density: 0.5, lifetime: 50, inertia: 0.05, capacity: 4, minSlope: 0.01, erodeSpeed: 0.15, depositSpeed: 0.15, evaporation: 0.01, gravity: 4, radius: 3 },
    controls: [
      { key: 'density', label: 'Droplets', min: 0.1, max: 4, step: 0.05, digits: 2, unit: '/cell', help: 'Droplets released per map cell.' },
      { key: 'lifetime', label: 'Lifetime', min: 5, max: 120, step: 1, digits: 0, unit: 'steps', help: 'Steps a droplet lives before it evaporates.' },
      { key: 'inertia', label: 'Inertia', min: 0, max: 0.5, step: 0.01, digits: 2, help: 'How much a droplet keeps its heading. High values make straighter tracks.' },
      { key: 'capacity', label: 'Capacity', min: 0.5, max: 12, step: 0.1, digits: 1, unit: '×', help: 'Sediment a droplet can carry per unit of speed and slope.' },
      { key: 'erodeSpeed', label: 'Erosion', min: 0, max: 1, step: 0.01, digits: 2, help: 'Share of the spare capacity a droplet picks up each step.' },
      { key: 'depositSpeed', label: 'Deposition', min: 0, max: 1, step: 0.01, digits: 2, help: 'Share of the excess sediment dropped each step.' },
      { key: 'evaporation', label: 'Evaporation', min: 0, max: 0.1, step: 0.001, digits: 3, help: 'Fraction of water lost per step.' },
      { key: 'gravity', label: 'Gravity', min: 0.5, max: 10, step: 0.1, digits: 1, help: 'Speed gained per unit of drop.' },
      { key: 'minSlope', label: 'Min slope', min: 0, max: 0.1, step: 0.001, digits: 3, help: 'Floor on capacity so flats still erode slightly.' },
      { key: 'radius', label: 'Brush radius', min: 1, max: 6, step: 1, digits: 0, unit: 'cells', help: 'Radius over which erosion is spread, which smooths the cut.' },
    ],
  },
  thermal: {
    label: 'Thermal · talus',
    short: 'Thermal',
    blurb: 'Frost, rockfall and creep. Slopes steeper than the angle of repose slump until they settle at it, and scree gathers at the foot.',
    defaults: { talus: 34, rate: 0.35, iterations: 30 },
    controls: [
      { key: 'talus', label: 'Talus angle', min: 15, max: 60, step: 0.5, digits: 1, unit: '°', help: 'Steepest slope that material can hold. Loose scree is about 33°, rock is steeper.' },
      { key: 'rate', label: 'Transfer', min: 0, max: 0.5, step: 0.01, digits: 2, help: 'Fraction of the excess moved each iteration.' },
      { key: 'iterations', label: 'Iterations', min: 1, max: 200, step: 1, digits: 0, help: 'Relaxation passes. More passes settle the slopes further.' },
    ],
  },
  fluvial: {
    label: 'Fluvial · rivers',
    short: 'Fluvial',
    blurb: 'Stream power: rivers cut in proportion to the area they drain and to their slope. Hillslope diffusion rounds the ridges and uplift keeps the relief alive.',
    defaults: { erodibility: 0.04, areaExponent: 0.5, slopeExponent: 1.0, uplift: 0.0005, diffusion: 0.03, timeStep: 1.0, iterations: 60 },
    controls: [
      { key: 'erodibility', label: 'Erodibility', min: 0, max: 0.2, step: 0.001, digits: 3, help: 'K. How easily the rock is cut. Higher gives deeper valleys per step.' },
      { key: 'areaExponent', label: 'Area exponent', min: 0, max: 1, step: 0.01, digits: 2, help: 'm. Weight of drainage area. About 0.5 is typical for river networks.' },
      { key: 'slopeExponent', label: 'Slope exponent', min: 0.5, max: 2, step: 0.01, digits: 2, help: 'n. Weight of slope. 1 gives a near-linear response.' },
      { key: 'uplift', label: 'Uplift', min: 0, max: 0.01, step: 0.0001, digits: 4, help: 'Rock raised per iteration. Balances erosion so mountains persist.' },
      { key: 'diffusion', label: 'Diffusion', min: 0, max: 0.2, step: 0.005, digits: 3, help: 'Hillslope creep per iteration. Softens ridges and the sharp heads of valleys.' },
      { key: 'timeStep', label: 'Time step', min: 0.1, max: 2, step: 0.05, digits: 2, help: 'Scale of each iteration.' },
      { key: 'iterations', label: 'Iterations', min: 1, max: 200, step: 1, digits: 0, help: 'Number of landform steps.' },
    ],
  },
};

const erosionDefaults = () => {
  const out = { type: 'hydraulic', seed: 7 };
  for (const [key, t] of Object.entries(EROSION_TYPES)) out[key] = { ...t.defaults };
  return out;
};

export const LAYER_TYPES = {
  noise: {
    group: 'generator',
    label: 'Fractal noise',
    blurb: 'Layered gradient noise for rolling hills. Domain warp bends the shapes into organic forms.',
    blend: 'Normal',
    defaults: { frequency: 1.6, octaves: 7, lacunarity: 2.0, gain: 0.5, warp: 0.45, relief: 1.6, offset: 0, seed: 3 },
    controls: [
      { key: 'frequency', label: 'Frequency', min: 0.5, max: 8, step: 0.05, digits: 2, unit: 'cyc', help: 'Feature count across the map.' },
      { key: 'octaves', label: 'Octaves', min: 1, max: 9, step: 1, digits: 0, help: 'Layers of detail.' },
      { key: 'lacunarity', label: 'Lacunarity', min: 1.5, max: 3.5, step: 0.05, digits: 2, help: 'Frequency step between octaves.' },
      { key: 'gain', label: 'Gain', min: 0.1, max: 0.9, step: 0.01, digits: 2, help: 'Amplitude kept per octave. Higher is rougher.' },
      { key: 'warp', label: 'Domain warp', min: 0, max: 1, step: 0.01, digits: 2, help: 'Bends the noise coordinates for organic shapes.' },
      { key: 'relief', label: 'Relief', min: 0.2, max: 3, step: 0.01, digits: 2, help: 'Height range of the noise around its mid level.' },
      { key: 'offset', label: 'Offset', min: -0.5, max: 0.5, step: 0.01, digits: 2, help: 'Raises or lowers the whole layer.' },
      { key: 'seed', label: 'Seed', min: 0, max: 999, step: 1, digits: 0, help: 'Changes the pattern without changing the settings.' },
    ],
  },
  ridged: {
    group: 'generator',
    label: 'Ridged mountains',
    blurb: 'Ridged multifractal noise. Sharp crests and valleys, suited to ranges.',
    blend: 'Max',
    defaults: { frequency: 2.6, octaves: 6, lacunarity: 2.1, gain: 0.5, sharpness: 2, warp: 0.4, relief: 1.5, offset: 0, seed: 11 },
    controls: [
      { key: 'frequency', label: 'Frequency', min: 0.5, max: 8, step: 0.05, digits: 2, unit: 'cyc', help: 'Range count across the map.' },
      { key: 'octaves', label: 'Octaves', min: 1, max: 9, step: 1, digits: 0 },
      { key: 'lacunarity', label: 'Lacunarity', min: 1.5, max: 3.5, step: 0.05, digits: 2 },
      { key: 'gain', label: 'Gain', min: 0.1, max: 0.9, step: 0.01, digits: 2 },
      { key: 'sharpness', label: 'Sharpness', min: 1, max: 4, step: 0.05, digits: 2, help: 'Exponent on the ridge profile. Higher gives thinner crests.' },
      { key: 'warp', label: 'Domain warp', min: 0, max: 1, step: 0.01, digits: 2 },
      { key: 'relief', label: 'Relief', min: 0.2, max: 4, step: 0.01, digits: 2 },
      { key: 'offset', label: 'Offset', min: -0.5, max: 0.5, step: 0.01, digits: 2 },
      { key: 'seed', label: 'Seed', min: 0, max: 999, step: 1, digits: 0 },
    ],
  },
  island: {
    group: 'generator',
    label: 'Island falloff',
    blurb: 'Radial mask with a wobbly coastline. Multiply it into the stack to sink the edges below sea level.',
    blend: 'Multiply',
    defaults: { radius: 1.2, falloff: 2.2, wobble: 0.45, seed: 5 },
    controls: [
      { key: 'radius', label: 'Radius', min: 0.3, max: 1.3, step: 0.01, digits: 2, help: 'Where the mask reaches zero, as a fraction of the half-width.' },
      { key: 'falloff', label: 'Falloff', min: 0.5, max: 4, step: 0.05, digits: 2, help: 'How quickly the land drops to the coast.' },
      { key: 'wobble', label: 'Coast wobble', min: 0, max: 1, step: 0.01, digits: 2 },
      { key: 'seed', label: 'Seed', min: 0, max: 999, step: 1, digits: 0 },
    ],
  },
  base: {
    group: 'generator',
    label: 'Base level',
    blurb: 'A flat plane at a chosen height. At full opacity with Normal blending it replaces everything beneath.',
    blend: 'Normal',
    defaults: { level: 0.3 },
    controls: [{ key: 'level', label: 'Level', min: 0, max: 1, step: 0.005, digits: 3, help: 'Normalised height. Multiply by the height range to get metres.' }],
  },
  ramp: {
    group: 'generator',
    label: 'Tilt ramp',
    blurb: 'A linear slope across the map. Good for giving a continent a prevailing tilt.',
    blend: 'Normal',
    defaults: { angle: 60, steepness: 0.35, level: 0.45 },
    controls: [
      { key: 'angle', label: 'Direction', min: 0, max: 360, step: 1, digits: 0, unit: '°', help: 'Direction the ramp climbs toward.' },
      { key: 'steepness', label: 'Steepness', min: -1, max: 1, step: 0.01, digits: 2, help: 'Negative values tilt the other way.' },
      { key: 'level', label: 'Level', min: 0, max: 1, step: 0.01, digits: 2 },
    ],
  },
  erosion: {
    group: 'erosion',
    label: 'Erosion',
    blurb: 'Simulates a natural process on the layers below it. Pick the process type; each type has its own parameters.',
    blend: 'Normal',
    defaults: erosionDefaults(),
    controls: [], // built from the type, see controlsFor()
  },
  terrace: {
    group: 'shaping',
    label: 'Terrace',
    blurb: 'Stepped plateaus, as on farmed hillsides or eroded mesas.',
    blend: 'Normal',
    defaults: { steps: 7, sharpness: 0.6 },
    controls: [
      { key: 'steps', label: 'Steps', min: 2, max: 24, step: 1, digits: 0 },
      { key: 'sharpness', label: 'Riser sharpness', min: 0, max: 0.98, step: 0.01, digits: 2, help: '0 is a smooth ramp, 1 is a hard cliff between steps.' },
    ],
  },
  smooth: {
    group: 'shaping',
    label: 'Smooth',
    blurb: 'Repeated box blur. Removes noise and roughness, for example after hydraulic erosion.',
    blend: 'Normal',
    defaults: { radius: 2, iterations: 2 },
    controls: [
      { key: 'radius', label: 'Radius', min: 1, max: 8, step: 1, digits: 0, unit: 'cells' },
      { key: 'iterations', label: 'Passes', min: 1, max: 12, step: 1, digits: 0 },
    ],
  },
  levels: {
    group: 'shaping',
    label: 'Levels',
    blurb: 'Remap the height window and gamma. Use it to clip the sea floor or lift the peaks.',
    blend: 'Normal',
    defaults: { low: 0.02, high: 0.98, gamma: 1 },
    controls: [
      { key: 'low', label: 'Black point', min: 0, max: 0.95, step: 0.005, digits: 3 },
      { key: 'high', label: 'White point', min: 0.05, max: 1, step: 0.005, digits: 3 },
      { key: 'gamma', label: 'Gamma', min: 0.2, max: 3, step: 0.01, digits: 2 },
    ],
  },
  satmap: {
    group: 'texture',
    label: 'Satmap texture',
    blurb: 'Procedural satellite-style colour: vegetation, bare rock, scree, alluvium, snow and water, placed from the terrain.',
    blend: 'Normal',
    defaults: {
      palette: 'temperate', resolution: 1024, vegetation: 0.7, rockSlope: 34, snowline: 900, wetness: 0.6,
      hillshade: 0.6, detail: 0.5, saturation: 1.0, contrast: 1.0, sunAzimuth: 315, sunElevation: 38,
    },
    controls: [
      { key: 'palette', label: 'Palette', kind: 'select', options: PALETTE_OPTIONS },
      { key: 'resolution', label: 'Resolution', kind: 'select', options: [[512, '512 px'], [1024, '1024 px'], [2048, '2048 px']] },
      { key: 'vegetation', label: 'Vegetation', min: 0, max: 1, step: 0.01, digits: 2, help: 'Cover on gentle, low, wet ground.' },
      { key: 'wetness', label: 'Wetness', min: 0, max: 1, step: 0.01, digits: 2, help: 'How much drainage and valley floors green the land.' },
      { key: 'rockSlope', label: 'Rock slope', min: 15, max: 60, step: 0.5, digits: 1, unit: '°', help: 'Slope above which bare rock shows.' },
      { key: 'snowline', label: 'Snow line', min: 0, max: 3000, step: 10, digits: 0, unit: 'm', help: 'Altitude above which snow lies on the gentler ground.' },
      { key: 'hillshade', label: 'Hillshade', min: 0, max: 1, step: 0.01, digits: 2, help: 'Relief shading from the sun below.' },
      { key: 'detail', label: 'Detail', min: 0, max: 1, step: 0.01, digits: 2, help: 'Grain and field texture.' },
      { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01, digits: 2 },
      { key: 'contrast', label: 'Contrast', min: 0.5, max: 1.6, step: 0.01, digits: 2 },
      { key: 'sunAzimuth', label: 'Sun bearing', min: 0, max: 360, step: 1, digits: 0, unit: '°' },
      { key: 'sunElevation', label: 'Sun elevation', min: 5, max: 85, step: 1, digits: 0, unit: '°' },
    ],
  },
};

export const TERRAIN_CONTROLS = [
  { key: 'size', label: 'Grid', kind: 'select', options: [[128, '128 × 128'], [256, '256 × 256'], [384, '384 × 384'], [512, '512 × 512']] },
  { key: 'extentM', label: 'Extent', min: 1000, max: 16000, step: 100, digits: 0, unit: 'm', help: 'Width of the map in metres.' },
  { key: 'heightM', label: 'Height range', min: 100, max: 4000, step: 10, digits: 0, unit: 'm', help: 'Metres that normalised height 1.0 represents.' },
  { key: 'seaLevel', label: 'Sea level', min: 0, max: 0.6, step: 0.005, digits: 3, help: 'Normalised height of the water surface.' },
];

export const BLEND_CONTROL = { key: 'blend', label: 'Blend', kind: 'select', options: BLEND_OPTIONS };

export const VIEW_CONTROLS = [
  { key: 'exaggeration', label: 'Exaggeration', min: 0.5, max: 4, step: 0.05, digits: 2, unit: '×', help: 'Vertical exaggeration in the 3D view only.' },
  { key: 'sunAzimuth', label: 'Sun bearing', min: 0, max: 360, step: 1, digits: 0, unit: '°' },
  { key: 'sunElevation', label: 'Sun elevation', min: 5, max: 85, step: 1, digits: 0, unit: '°' },
];

export const DEFAULT_VIEW = { mode: '3d', satmap: true, water: true, exaggeration: 1.6, sunAzimuth: 315, sunElevation: 42 };

export function layerKind(type) {
  return GROUPS[LAYER_TYPES[type].group].kind;
}

export function controlsFor(layer) {
  if (layer.type === 'erosion') {
    const t = EROSION_TYPES[layer.params.type] || EROSION_TYPES.hydraulic;
    return t.controls;
  }
  return LAYER_TYPES[layer.type].controls;
}

// Params that live under the erosion type's own key (so they are kept per type).
export function paramBucket(layer) {
  return layer.type === 'erosion' ? layer.params[layer.params.type] : layer.params;
}

export function defaultLayerName(type, params) {
  if (type === 'erosion') return 'Erosion · ' + EROSION_TYPES[params.type].short;
  return LAYER_TYPES[type].label;
}
