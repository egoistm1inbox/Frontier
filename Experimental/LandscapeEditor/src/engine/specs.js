// Shared definitions: layer kinds, erosion types, their slider specifications and defaults.
// The engine reads these values and the Inspector renders sliders from the same specs, so the
// two cannot drift apart. Height-like parameters are stored in metres.

export const PROJECT_FORMAT = 'frontier-landscape';
export const PROJECT_VERSION = 1;

export const RESOLUTIONS = [128, 192, 256, 384, 512];
export const SIZES = [1024, 2048, 4096, 8192];
export const SATMAP_RESOLUTIONS = [256, 512, 1024];

export const BLEND_MODES = [
  { value: 'add', label: 'Add' },
  { value: 'subtract', label: 'Subtract' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'max', label: 'Max' },
  { value: 'min', label: 'Min' },
  { value: 'replace', label: 'Replace' },
];

// A control spec describes one slider (or select) in the Inspector.
// number: { key, label, min, max, step, unit?, decimals?, hint? }
// select: { key, label, type: 'select', options: [{ value, label }] }

export const CATEGORIES = [
  { id: 'generate', label: 'Generate' },
  { id: 'shape', label: 'Shape' },
  { id: 'erode', label: 'Erode' },
];

export const LayerKinds = {
  fbm: {
    label: 'Noise · fBm',
    shortLabel: 'fBm noise',
    category: 'generate',
    icon: 'noise',
    generator: true,
    blend: 'add',
    description: 'Fractal Brownian motion: the base continent shape. Domain warping breaks up the grid feel.',
    defaults: { frequency: 1.2, octaves: 6, lacunarity: 2.0, gain: 0.5, warp: 0.6, contrast: 1.4, amplitude: 300 },
    controls: [
      { key: 'frequency', label: 'Frequency', min: 0.2, max: 12, step: 0.05, unit: 'cycles', decimals: 2 },
      { key: 'octaves', label: 'Octaves', min: 1, max: 10, step: 1, decimals: 0 },
      { key: 'lacunarity', label: 'Lacunarity', min: 1.5, max: 3.5, step: 0.05, decimals: 2 },
      { key: 'gain', label: 'Persistence', min: 0.2, max: 0.8, step: 0.01, decimals: 2 },
      { key: 'warp', label: 'Domain warp', min: 0, max: 2, step: 0.01, decimals: 2 },
      { key: 'contrast', label: 'Contrast', min: 0.4, max: 3, step: 0.01, decimals: 2 },
      { key: 'amplitude', label: 'Amplitude', min: 0, max: 2000, step: 5, unit: 'm', decimals: 0, amplitude: true },
    ],
  },
  ridge: {
    label: 'Ridged · Mountains',
    shortLabel: 'Ridged mountains',
    category: 'generate',
    icon: 'ridge',
    generator: true,
    blend: 'add',
    description: 'Ridged multifractal noise: sharp crests and valleys. Pair it with an altitude mask for ranges.',
    defaults: { frequency: 2.0, octaves: 6, sharpness: 2.0, gain: 0.55, warp: 0.4, amplitude: 260 },
    controls: [
      { key: 'frequency', label: 'Frequency', min: 0.2, max: 12, step: 0.05, unit: 'cycles', decimals: 2 },
      { key: 'octaves', label: 'Octaves', min: 1, max: 10, step: 1, decimals: 0 },
      { key: 'sharpness', label: 'Crest sharpness', min: 1, max: 4, step: 0.05, decimals: 2 },
      { key: 'gain', label: 'Persistence', min: 0.2, max: 0.9, step: 0.01, decimals: 2 },
      { key: 'warp', label: 'Domain warp', min: 0, max: 2, step: 0.01, decimals: 2 },
      { key: 'amplitude', label: 'Amplitude', min: 0, max: 2000, step: 5, unit: 'm', decimals: 0, amplitude: true },
    ],
  },
  island: {
    label: 'Island · Falloff',
    shortLabel: 'Island falloff',
    category: 'generate',
    icon: 'island',
    generator: true,
    blend: 'multiply',
    description: 'Radial falloff with a noisy coastline. Multiply it over the base to fade terrain into the sea.',
    defaults: { radius: 0.72, falloff: 2.2, coastNoise: 0.35, coastScale: 4, amplitude: 600 },
    controls: [
      { key: 'radius', label: 'Radius', min: 0.2, max: 1.0, step: 0.01, decimals: 2 },
      { key: 'falloff', label: 'Falloff', min: 0.5, max: 6, step: 0.05, decimals: 2 },
      { key: 'coastNoise', label: 'Coastline noise', min: 0, max: 1, step: 0.01, decimals: 2 },
      { key: 'coastScale', label: 'Coastline scale', min: 1, max: 12, step: 0.1, unit: 'cycles', decimals: 1 },
      { key: 'amplitude', label: 'Amplitude', min: 0, max: 2000, step: 5, unit: 'm', decimals: 0, amplitude: true },
    ],
  },
  offset: {
    label: 'Offset · Level',
    shortLabel: 'Offset',
    category: 'generate',
    icon: 'offset',
    generator: true,
    blend: 'add',
    description: 'Raises or lowers the masked area by a fixed height.',
    defaults: { level: 60 },
    controls: [{ key: 'level', label: 'Level', min: -600, max: 600, step: 1, unit: 'm', decimals: 0 }],
  },
  terrace: {
    label: 'Terraces',
    shortLabel: 'Terraces',
    category: 'shape',
    icon: 'terrace',
    generator: false,
    description: 'Quantises the height into plateaus with riser cliffs, for mesas and stepped valleys.',
    defaults: { steps: 7, sharpness: 0.6 },
    controls: [
      { key: 'steps', label: 'Steps', min: 2, max: 24, step: 1, decimals: 0 },
      { key: 'sharpness', label: 'Riser sharpness', min: 0, max: 1, step: 0.01, decimals: 2 },
    ],
  },
  smooth: {
    label: 'Smooth · Blur',
    shortLabel: 'Smooth',
    category: 'shape',
    icon: 'smooth',
    generator: false,
    description: 'Repeated box blur. Use it to soften noise or to calm a layer after erosion.',
    defaults: { radius: 3, passes: 2 },
    controls: [
      { key: 'radius', label: 'Radius', min: 1, max: 12, step: 1, unit: 'cells', decimals: 0 },
      { key: 'passes', label: 'Passes', min: 1, max: 12, step: 1, decimals: 0 },
    ],
  },
  levels: {
    label: 'Levels · Curve',
    shortLabel: 'Levels',
    category: 'shape',
    icon: 'levels',
    generator: false,
    description: 'Remaps black and white points and applies a gamma curve to the heights.',
    defaults: { black: 0, white: 600, gamma: 1.0 },
    controls: [
      { key: 'black', label: 'Black point', min: 0, max: 1500, step: 1, unit: 'm', decimals: 0 },
      { key: 'white', label: 'White point', min: 50, max: 2000, step: 1, unit: 'm', decimals: 0 },
      { key: 'gamma', label: 'Gamma', min: 0.2, max: 4, step: 0.01, decimals: 2 },
    ],
  },
  erosion: {
    label: 'Erosion',
    shortLabel: 'Erosion',
    category: 'erode',
    icon: 'erosion',
    generator: false,
    description: 'Runs a physical erosion simulation on everything below it in the stack.',
    defaults: { type: 'droplet' },
    controls: [],
  },
};

// Erosion types. Each one has its own parameter set, its own sliders and its own defaults.
export const ErosionTypes = {
  droplet: {
    label: 'Hydraulic · Rain droplets',
    shortLabel: 'Rain droplets',
    icon: 'rain',
    summary: 'Particle hydraulics. Droplets carve gullies and deposit fans.',
    defaults: {
      droplets: 150000,
      inertia: 0.05,
      capacity: 4,
      minCapacity: 0.01,
      erodeSpeed: 0.3,
      depositSpeed: 0.3,
      evaporation: 0.01,
      gravity: 4,
      lifetime: 30,
      radius: 3,
    },
    controls: [
      { key: 'droplets', label: 'Droplets', min: 1000, max: 600000, step: 1000, decimals: 0 },
      { key: 'inertia', label: 'Inertia', min: 0, max: 0.95, step: 0.01, decimals: 2 },
      { key: 'capacity', label: 'Sediment capacity', min: 0, max: 16, step: 0.1, decimals: 1 },
      { key: 'minCapacity', label: 'Minimum capacity', min: 0, max: 0.1, step: 0.001, decimals: 3 },
      { key: 'erodeSpeed', label: 'Erode speed', min: 0, max: 1, step: 0.01, decimals: 2 },
      { key: 'depositSpeed', label: 'Deposit speed', min: 0, max: 1, step: 0.01, decimals: 2 },
      { key: 'evaporation', label: 'Evaporation', min: 0, max: 0.2, step: 0.001, decimals: 3 },
      { key: 'gravity', label: 'Gravity', min: 0, max: 10, step: 0.1, decimals: 1 },
      { key: 'lifetime', label: 'Droplet lifetime', min: 5, max: 120, step: 1, unit: 'steps', decimals: 0 },
      { key: 'radius', label: 'Brush radius', min: 1, max: 8, step: 1, unit: 'cells', decimals: 0 },
    ],
  },
  stream: {
    label: 'Hydraulic · Stream power',
    shortLabel: 'Stream power',
    icon: 'fluid',
    summary: 'River incision E = K·A^m·S^n over a routed drainage network, with hillslope diffusion.',
    defaults: {
      iterations: 120,
      erodibility: 1.0,
      areaExponent: 0.5,
      slopeExponent: 1.0,
      timeStep: 1.0,
      diffusion: 0.15,
    },
    controls: [
      { key: 'iterations', label: 'Iterations', min: 10, max: 400, step: 1, decimals: 0 },
      { key: 'erodibility', label: 'Erodibility K', min: 0, max: 5, step: 0.05, decimals: 2 },
      { key: 'areaExponent', label: 'Area exponent m', min: 0, max: 1, step: 0.01, decimals: 2 },
      { key: 'slopeExponent', label: 'Slope exponent n', min: 0.5, max: 2, step: 0.01, decimals: 2 },
      { key: 'timeStep', label: 'Time step', min: 0.05, max: 5, step: 0.05, decimals: 2 },
      { key: 'diffusion', label: 'Hillslope diffusion', min: 0, max: 1, step: 0.01, decimals: 2 },
    ],
  },
  thermal: {
    label: 'Thermal · Talus',
    shortLabel: 'Thermal talus',
    icon: 'scree',
    summary: 'Slope failure. Steep faces shed material into talus aprons at the angle of repose.',
    defaults: { iterations: 60, talusAngle: 34, transfer: 0.5, neighbours: 8 },
    controls: [
      { key: 'iterations', label: 'Iterations', min: 1, max: 400, step: 1, decimals: 0 },
      { key: 'talusAngle', label: 'Talus angle', min: 5, max: 70, step: 0.5, unit: '°', decimals: 1 },
      { key: 'transfer', label: 'Transfer rate', min: 0, max: 1, step: 0.01, decimals: 2 },
      {
        key: 'neighbours',
        label: 'Neighbours',
        type: 'select',
        options: [
          { value: 4, label: '4 (orthogonal)' },
          { value: 8, label: '8 (with diagonals)' },
        ],
      },
    ],
  },
  wind: {
    label: 'Aeolian · Wind dunes',
    shortLabel: 'Wind dunes',
    icon: 'wind',
    summary: 'Saltation transport. Sand moves downwind, accelerates over crests and drops into lee shadows.',
    defaults: { iterations: 40, direction: 225, speedUp: 1.5, threshold: 0.6, mobility: 0.5, maxStep: 0.25 },
    controls: [
      { key: 'iterations', label: 'Iterations', min: 1, max: 200, step: 1, decimals: 0 },
      { key: 'direction', label: 'Wind direction', min: 0, max: 360, step: 1, unit: '°', decimals: 0 },
      { key: 'speedUp', label: 'Crest speed-up', min: 0, max: 4, step: 0.05, decimals: 2 },
      { key: 'threshold', label: 'Entrainment threshold', min: 0, max: 1.2, step: 0.01, decimals: 2 },
      { key: 'mobility', label: 'Mobility', min: 0, max: 2, step: 0.01, decimals: 2 },
      { key: 'maxStep', label: 'Max change per pass', min: 0.01, max: 2, step: 0.01, unit: 'm', decimals: 2 },
    ],
  },
};

export const EROSION_ORDER = ['droplet', 'stream', 'thermal', 'wind'];

// Mask controls, shared by every layer.
export const MaskControls = [
  { key: 'minAltitude', label: 'Min altitude', min: 0, max: 2000, step: 1, unit: 'm', decimals: 0 },
  { key: 'maxAltitude', label: 'Max altitude', min: 0, max: 2000, step: 1, unit: 'm', decimals: 0 },
  { key: 'altitudeFeather', label: 'Altitude feather', min: 0, max: 500, step: 1, unit: 'm', decimals: 0 },
  { key: 'minSlope', label: 'Min slope', min: 0, max: 90, step: 0.5, unit: '°', decimals: 1 },
  { key: 'maxSlope', label: 'Max slope', min: 0, max: 90, step: 0.5, unit: '°', decimals: 1 },
  { key: 'slopeFeather', label: 'Slope feather', min: 0, max: 45, step: 0.5, unit: '°', decimals: 1 },
];

export const DEFAULT_MASK = {
  enabled: false,
  minAltitude: 0,
  maxAltitude: 2000,
  altitudeFeather: 0,
  minSlope: 0,
  maxSlope: 90,
  slopeFeather: 0,
  invert: false,
};

export const DEFAULT_SETTINGS = {
  size: 2048,
  resolution: 256,
  maxHeight: 600,
  seaLevel: 45,
  seed: 1337,
};

export const DEFAULT_SATMAP = {
  source: 'procedural',
  resolution: 512,
  imageBlend: 1,
  vegetation: 0.7,
  rockSlope: 38,
  snowline: 0.72,
  treeline: 0.55,
  beach: 12,
  riverDensity: 0.5,
  wetness: 0.5,
  variation: 0.5,
  detail: 0.6,
  shade: 0.35,
  sunAzimuth: 300,
  sunElevation: 42,
  colours: {
    grass: '#6f8f4a',
    forest: '#2f5a35',
    rock: '#7b7468',
    sand: '#c9b27f',
    snow: '#eef2f5',
    water: '#2d6a8f',
    soil: '#8a6f4e',
  },
};

export const SatmapControls = {
  biomes: [
    { key: 'vegetation', label: 'Vegetation cover', min: 0, max: 1, step: 0.01, unit: '%', scale: 100, decimals: 0 },
    { key: 'wetness', label: 'Valley wetness', min: 0, max: 1, step: 0.01, unit: '%', scale: 100, decimals: 0 },
    { key: 'riverDensity', label: 'River density', min: 0, max: 1, step: 0.01, unit: '%', scale: 100, decimals: 0 },
    { key: 'rockSlope', label: 'Rock above slope', min: 20, max: 60, step: 0.5, unit: '°', decimals: 1 },
    { key: 'snowline', label: 'Snowline', min: 0.5, max: 1, step: 0.01, unit: '%', scale: 100, decimals: 0 },
    { key: 'treeline', label: 'Treeline', min: 0.2, max: 0.95, step: 0.01, unit: '%', scale: 100, decimals: 0 },
    { key: 'beach', label: 'Beach width', min: 0, max: 60, step: 1, unit: 'm', decimals: 0 },
  ],
  detail: [
    { key: 'variation', label: 'Colour variation', min: 0, max: 1, step: 0.01, unit: '%', scale: 100, decimals: 0 },
    { key: 'detail', label: 'Micro detail', min: 0, max: 1, step: 0.01, unit: '%', scale: 100, decimals: 0 },
    { key: 'shade', label: 'Baked shading', min: 0, max: 1, step: 0.01, unit: '%', scale: 100, decimals: 0 },
    { key: 'sunAzimuth', label: 'Sun azimuth', min: 0, max: 360, step: 1, unit: '°', decimals: 0 },
    { key: 'sunElevation', label: 'Sun elevation', min: 5, max: 85, step: 1, unit: '°', decimals: 0 },
  ],
};

export const SatmapColours = [
  { key: 'grass', label: 'Grass' },
  { key: 'forest', label: 'Forest' },
  { key: 'rock', label: 'Rock' },
  { key: 'sand', label: 'Sand' },
  { key: 'snow', label: 'Snow' },
  { key: 'water', label: 'Water' },
  { key: 'soil', label: 'Soil' },
];

// Factories -----------------------------------------------------------------------------------

let idCounter = 0;
export function makeId(prefix = 'layer') {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function defaultErosionParams(type = 'droplet') {
  const params = { type };
  for (const id of EROSION_ORDER) params[id] = clone(ErosionTypes[id].defaults);
  return params;
}

export function createLayer(kind, overrides = {}) {
  const spec = LayerKinds[kind];
  const layer = {
    id: makeId(kind),
    kind,
    name: overrides.name ?? defaultLayerName(kind, overrides.params),
    enabled: true,
    opacity: 1,
    blend: spec.blend ?? 'add',
    seed: Math.floor(Math.random() * 100000),
    mask: clone(DEFAULT_MASK),
    params: kind === 'erosion' ? defaultErosionParams(overrides.params?.type ?? 'droplet') : clone(spec.defaults),
  };
  if (overrides.params) {
    layer.params = { ...layer.params, ...clone(overrides.params) };
  }
  if (overrides.mask) layer.mask = { ...layer.mask, ...clone(overrides.mask) };
  for (const key of ['enabled', 'opacity', 'blend', 'seed']) {
    if (overrides[key] !== undefined) layer[key] = overrides[key];
  }
  return layer;
}

export function defaultLayerName(kind, params) {
  if (kind === 'erosion') {
    const type = params?.type ?? 'droplet';
    return `Erosion · ${ErosionTypes[type].shortLabel}`;
  }
  return LayerKinds[kind].shortLabel;
}

export function createDefaultProject() {
  return {
    settings: clone(DEFAULT_SETTINGS),
    satmap: clone(DEFAULT_SATMAP),
    layers: [
      createLayer('fbm', { name: 'Base · fBm continent', seed: 11 }),
      createLayer('ridge', {
        name: 'Ranges · ridged',
        seed: 23,
        mask: { enabled: true, minAltitude: 150, maxAltitude: 2000, altitudeFeather: 70 },
        params: { amplitude: 260 },
      }),
      createLayer('offset', { name: 'Lift · continental shelf', seed: 3, params: { level: 25 } }),
      createLayer('erosion', { seed: 5, params: { type: 'droplet' } }),
      createLayer('erosion', { seed: 6, params: { type: 'stream' } }),
      createLayer('erosion', { seed: 7, params: { type: 'thermal' } }),
    ],
  };
}

// Accepts older or partial documents and fills in anything missing.
export function normaliseProject(raw) {
  const base = createDefaultProject();
  if (!raw || typeof raw !== 'object') return base;
  const settings = { ...base.settings, ...(raw.settings ?? {}) };
  settings.resolution = RESOLUTIONS.includes(settings.resolution) ? settings.resolution : base.settings.resolution;
  settings.size = SIZES.includes(settings.size) ? settings.size : base.settings.size;
  settings.maxHeight = clamp(Number(settings.maxHeight) || base.settings.maxHeight, 50, 2000);
  settings.seaLevel = clamp(Number(settings.seaLevel) || 0, 0, settings.maxHeight);
  settings.seed = Math.floor(Number(settings.seed) || 0);
  const satmap = { ...base.satmap, ...(raw.satmap ?? {}) };
  satmap.colours = { ...base.satmap.colours, ...(raw.satmap?.colours ?? {}) };
  satmap.source = satmap.source === 'imported' ? 'imported' : 'procedural';
  satmap.resolution = SATMAP_RESOLUTIONS.includes(satmap.resolution) ? satmap.resolution : 512;
  const layers = Array.isArray(raw.layers)
    ? raw.layers.filter((layer) => layer && LayerKinds[layer.kind]).map((layer) => normaliseLayer(layer))
    : base.layers;
  return { settings, satmap, layers };
}

function normaliseLayer(layer) {
  const spec = LayerKinds[layer.kind];
  const params =
    layer.kind === 'erosion'
      ? defaultErosionParams(ErosionTypes[layer.params?.type] ? layer.params.type : 'droplet')
      : clone(spec.defaults);
  if (layer.params && typeof layer.params === 'object') {
    for (const key of Object.keys(layer.params)) {
      if (layer.kind === 'erosion' && EROSION_ORDER.includes(key) && typeof layer.params[key] === 'object') {
        params[key] = { ...params[key], ...layer.params[key] };
      } else if (layer.kind !== 'erosion' && key in params) {
        params[key] = layer.params[key];
      }
    }
  }
  return {
    id: layer.id || makeId(layer.kind),
    kind: layer.kind,
    name: typeof layer.name === 'string' && layer.name ? layer.name : defaultLayerName(layer.kind, params),
    enabled: layer.enabled !== false,
    opacity: clamp(Number.isFinite(layer.opacity) ? layer.opacity : 1, 0, 1),
    blend: BLEND_MODES.some((mode) => mode.value === layer.blend) ? layer.blend : spec.blend ?? 'add',
    seed: Math.floor(Number(layer.seed) || 0),
    mask: { ...DEFAULT_MASK, ...(layer.mask ?? {}) },
    params,
  };
}

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

// One-line summary shown under each layer name in the stack.
export function describeLayer(layer) {
  const p = layer.params;
  switch (layer.kind) {
    case 'fbm':
      return `fBm · ${p.frequency} cyc · ${p.octaves} oct · ${Math.round(p.amplitude)} m`;
    case 'ridge':
      return `Ridged · ${p.frequency} cyc · sharp ${p.sharpness} · ${Math.round(p.amplitude)} m`;
    case 'island':
      return `Island · r ${p.radius} · falloff ${p.falloff}`;
    case 'offset':
      return `Offset · ${p.level > 0 ? '+' : ''}${Math.round(p.level)} m`;
    case 'terrace':
      return `Terraces · ${p.steps} steps`;
    case 'smooth':
      return `Smooth · r${p.radius} × ${p.passes}`;
    case 'levels':
      return `Levels · γ ${p.gamma}`;
    case 'erosion': {
      const type = p.type;
      const e = p[type];
      if (type === 'droplet') return `Droplets · ${Math.round(e.droplets / 1000)}k · r${e.radius}`;
      if (type === 'stream') return `Stream power · ${e.iterations} iter · K ${e.erodibility}`;
      if (type === 'thermal') return `Talus · ${e.iterations} iter · ${e.talusAngle}°`;
      return `Dunes · ${e.iterations} iter · ${e.direction}°`;
    }
    default:
      return layer.kind;
  }
}
