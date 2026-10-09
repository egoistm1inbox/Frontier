// Layer registry. One place that says what each layer type is, what it stores, and how the inspector
// should present it. The inspector, the pipeline and the layer list all read from here, so adding a
// type means adding an entry here and a branch in pipeline.js (or an entry in primitives.js for a primitive).
//
// Control descriptors:
//   { key, label, min, max, step, digits, unit, help }   range slider with a numeric field
//   { key, label, kind: 'select', options: [[value, label], ...] }
//
// Layer kinds:
//   'height'   primitives, shapes and modifiers, evaluated bottom to top, each producing a new heightmap
//   'texture'  satmap layers, evaluated after all height layers, each producing an RGB colour map

import { PALETTE_OPTIONS } from './satmap.js';
import { FALLOFF_DEFAULTS, FALLOFF_SHAPES } from './falloff.js';

export const BLEND_MODES = ['Normal', 'Add', 'Subtract', 'Multiply', 'Max', 'Min'];
const BLEND_OPTIONS = BLEND_MODES.map((m) => [m, m]);

// Output grid sizes. The working grid (the size erosion actually runs on) is capped in project.js.
export const GRID_SIZES = [512, 1024, 2048, 4096, 8192, 16384];
export const DEFAULT_GRID = 1024;
export const SATMAP_SIZES = [1024, 2048, 4096, 8192, 16384];

export const GROUPS = {
  primitive: { label: 'Primitives', kind: 'height' },
  shape: { label: 'Shapes', kind: 'height' },
  geological: { label: 'Geological', kind: 'height' },
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

// Shared control descriptors for the primitives. Each primitive picks the ones it uses.
const C = {
  freq: { key: 'frequency', label: 'Frequency', min: 0.5, max: 32, step: 0.05, digits: 2, unit: 'cyc', help: 'Features across the map. Resolution does not change the look.' },
  octaves: { key: 'octaves', label: 'Octaves', min: 1, max: 10, step: 1, digits: 0, help: 'Layers of detail.' },
  lac: { key: 'lacunarity', label: 'Lacunarity', min: 1.5, max: 3.5, step: 0.05, digits: 2, help: 'Frequency step between octaves.' },
  gain: { key: 'gain', label: 'Gain', min: 0.1, max: 0.9, step: 0.01, digits: 2, help: 'Amplitude kept per octave. Higher is rougher.' },
  warp: { key: 'warp', label: 'Domain warp', min: 0, max: 1, step: 0.01, digits: 2, help: 'Bends the coordinates for organic shapes.' },
  relief: { key: 'relief', label: 'Relief', min: 0, max: 3, step: 0.01, digits: 2, help: 'Height range. 1 uses the full range of the layer; below 1 flattens it.' },
  offset: { key: 'offset', label: 'Offset', min: -0.5, max: 0.5, step: 0.01, digits: 2, help: 'Raises or lowers the whole layer.' },
  seed: { key: 'seed', label: 'Seed', min: 0, max: 999, step: 1, digits: 0, help: 'Changes the pattern without changing the settings.' },
  jitter: { key: 'jitter', label: 'Jitter', min: 0, max: 1, step: 0.01, digits: 2, help: 'How far feature points wander from their cell centres. 0 gives a regular grid.' },
  bandwidth: { key: 'bandwidth', label: 'Bandwidth', min: 0.12, max: 0.5, step: 0.01, digits: 2, unit: 'cells', help: 'Width of each kernel, in cells.' },
  impulses: { key: 'impulses', label: 'Impulses per cell', min: 1, max: 6, step: 1, digits: 0, help: 'Kernels scattered in each cell.' },
  angle: { key: 'angle', label: 'Direction', min: 0, max: 360, step: 1, digits: 0, unit: '°', help: 'Direction the pattern runs.' },
  phase: { key: 'phase', label: 'Phase', min: 0, max: 1, step: 0.01, digits: 2, unit: 'turn', help: 'Shifts the pattern along its direction.' },
};

// Primitives: one entry per algorithm. Defaults give a pleasant result on their own at 1k.
const PRIM = (group, label, blurb, defaults, controls) => ({ group, label, blurb, blend: 'Normal', defaults, controls });

const PRIMITIVE_TYPES = {
  constant: PRIM('primitive', 'Constant', 'A flat level at a chosen height. With Normal blending at full opacity it replaces everything beneath.',
    { value: 0.3 },
    [{ key: 'value', label: 'Level', min: 0, max: 1, step: 0.005, digits: 3, help: 'Normalised height. Multiply by the height range to get metres.' }]),
  perlin: PRIM('primitive', 'Perlin noise', 'Classic gradient noise (Perlin 2002). Smooth, isotropic hills. The basic building block of terrain.',
    { frequency: 2, relief: 1.2, offset: 0, seed: 21 },
    [C.freq, C.relief, C.offset, C.seed]),
  simplex: PRIM('primitive', 'Simplex noise', 'Simplex gradient noise (Gustavson 2005). Like Perlin, with fewer grid-aligned artefacts.',
    { frequency: 2, relief: 1.2, offset: 0, seed: 22 },
    [C.freq, C.relief, C.offset, C.seed]),
  value: PRIM('primitive', 'Value noise', 'Random heights on a lattice, interpolated. Linear gives blocky creases; Smooth gives soft bumps.',
    { frequency: 4, curve: 'linear', relief: 1, offset: 0, seed: 23 },
    [C.freq,
      { key: 'curve', label: 'Interpolation', kind: 'select', options: [['linear', 'Linear (blocky)'], ['smooth', 'Smooth']] },
      C.relief, C.offset, C.seed]),
  voronoi1: PRIM('primitive', 'Voronoi F1', 'Distance to the nearest feature point. Domes and rounded cells: the base of many rock and cobble forms.',
    { frequency: 6, jitter: 1, relief: 1.2, offset: 0, seed: 31 },
    [C.freq, C.jitter, C.relief, C.offset, C.seed]),
  voronoi2: PRIM('primitive', 'Voronoi F2', 'Distance to the second-nearest feature point. Softer, flatter cells than F1.',
    { frequency: 6, jitter: 1, relief: 1.2, offset: 0, seed: 31 },
    [C.freq, C.jitter, C.relief, C.offset, C.seed]),
  voronoi3: PRIM('primitive', 'Voronoi F3', 'Distance to the third-nearest feature point.',
    { frequency: 6, jitter: 1, relief: 1.2, offset: 0, seed: 31 },
    [C.freq, C.jitter, C.relief, C.offset, C.seed]),
  voronoi4: PRIM('primitive', 'Voronoi F4', 'Distance to the fourth-nearest feature point. Busiest of the four.',
    { frequency: 6, jitter: 1, relief: 1.2, offset: 0, seed: 31 },
    [C.freq, C.jitter, C.relief, C.offset, C.seed]),
  crackle: PRIM('primitive', 'Voronoi crackle', 'F2 minus F1, shown as cracks between cells. Dried mud, plates and rock joints.',
    { frequency: 6, jitter: 1, width: 0.15, relief: 1, offset: 0, seed: 31 },
    [C.freq, C.jitter,
      { key: 'width', label: 'Crack width', min: 0.01, max: 0.5, step: 0.01, digits: 2, help: 'Width of the cracks, as a fraction of the cell distance.' },
      C.relief, C.offset, C.seed]),
  worley: PRIM('primitive', 'Worley cells', 'Each feature point carries a random height, blended by inverse distance. Soft cellular relief.',
    { frequency: 6, jitter: 1, sharpness: 4, relief: 1.2, offset: 0, seed: 34 },
    [C.freq, C.jitter,
      { key: 'sharpness', label: 'Sharpness', min: 0.5, max: 12, step: 0.1, digits: 1, help: 'How strongly the nearest cell dominates. High gives crisp cells.' },
      C.relief, C.offset, C.seed]),
  cellular: PRIM('primitive', 'Cellular automaton', 'Random seed cells run through a cave rule. Gives blobby masses, caves and islands.',
    { frequency: 3, fill: 0.46, steps: 4, relief: 1, offset: 0, seed: 35 },
    [C.freq,
      { key: 'fill', label: 'Fill', min: 0.2, max: 0.7, step: 0.01, digits: 2, help: 'Share of cells alive at the start.' },
      { key: 'steps', label: 'Steps', min: 1, max: 12, step: 1, digits: 0, help: 'Rule passes. More passes give larger, smoother masses.' },
      C.relief, C.offset, C.seed]),
  gabor: PRIM('primitive', 'Gabor noise', 'Oriented, band-limited wavelets scattered per cell. Directional ridges and sheared textures.',
    { frequency: 3, bandwidth: 0.5, carrier: 2.2, angle: 35, impulses: 3, relief: 1, offset: 0, seed: 36 },
    [C.freq, C.bandwidth,
      { key: 'carrier', label: 'Carrier', min: 0.2, max: 4, step: 0.05, digits: 2, unit: 'cyc/cell', help: 'Oscillation frequency inside each kernel. Sets the ridge spacing.' },
      C.angle, C.impulses, C.relief, C.offset, C.seed]),
  sparse: PRIM('primitive', 'Sparse convolution', 'Isotropic Gaussian kernels scattered per cell. Soft, speckled hills with no direction.',
    { frequency: 6, bandwidth: 0.35, impulses: 2, relief: 1, offset: 0, seed: 37 },
    [C.freq, C.bandwidth, C.impulses, C.relief, C.offset, C.seed]),
  wavelet: PRIM('primitive', 'Wavelet noise', 'Band-pass random tile, periodic. Fine, even texture with no visible lattice.',
    { frequency: 2, relief: 1, offset: 0, seed: 38 },
    [{ ...C.freq, label: 'Tiles', help: 'Repeats of the wavelet tile across the map.' }, C.relief, C.offset, C.seed]),
  fbm: PRIM('primitive', 'Fractal Brownian motion', 'Layered octaves of gradient noise. Rolling hills, and domain warp makes them organic.',
    { frequency: 1.6, octaves: 7, lacunarity: 2, gain: 0.5, warp: 0.45, relief: 1.6, offset: 0, seed: 3 },
    [C.freq, C.octaves, C.lac, C.gain, C.warp, C.relief, C.offset, C.seed]),
  ridged: PRIM('primitive', 'Ridged multifractal', 'Musgrave ridged multifractal: noise folded into sharp crests and valleys. Suited to ranges.',
    { frequency: 2.6, octaves: 6, lacunarity: 2.1, gain: 0.5, sharpness: 2, warp: 0.4, relief: 1.5, offset: 0, seed: 11 },
    [C.freq, C.octaves, C.lac, C.gain,
      { key: 'sharpness', label: 'Sharpness', min: 1, max: 4, step: 0.05, digits: 2, help: 'Exponent on the ridge profile. Higher gives thinner crests.' },
      C.warp, C.relief, C.offset, C.seed]),
  billow: PRIM('primitive', 'Billow', 'Folded noise octaves that give rounded, pillow-like bumps.',
    { frequency: 3, octaves: 6, lacunarity: 2, gain: 0.5, relief: 1, offset: 0, seed: 41 },
    [C.freq, C.octaves, C.lac, C.gain, C.relief, C.offset, C.seed]),
  swiss: PRIM('primitive', 'Swiss turbulence', 'Swiss-style turbulence, an interpretation rather than a published formula. Squared distance to zero crossings, fed back on itself: ridged channels with holes.',
    { frequency: 2.5, octaves: 6, lacunarity: 2, gain: 0.5, warp: 0.5, relief: 1.3, offset: 0, seed: 42 },
    [C.freq, C.octaves, C.lac, C.gain, C.warp, C.relief, C.offset, C.seed]),
  jordan: PRIM('primitive', 'Jordan turbulence', 'Jordan-style turbulence, an interpretation rather than a published formula. Two domain-warp stages then fBm: swirled, eroded-looking masses.',
    { frequency: 1.4, octaves: 5, warp: 1, relief: 1.4, offset: 0, seed: 43 },
    [C.freq, C.octaves, { ...C.warp, label: 'Warp strength' }, C.relief, C.offset, C.seed]),
  random: PRIM('primitive', 'Random cells', 'A random height for every block of cells. Raw grain for breakup and texture.',
    { cellSize: 1, relief: 0.6, offset: 0, seed: 51 },
    [{ key: 'cellSize', label: 'Block size', min: 1, max: 16, step: 1, digits: 0, unit: 'cells', help: 'Cells per random block.' }, C.relief, C.offset, C.seed]),
  grid: PRIM('primitive', 'Grid lines', 'Straight lines on a regular grid. Field boundaries and survey grids.',
    { frequency: 8, width: 0.08, softness: 0.06, relief: 0.8, offset: 0 },
    [{ ...C.freq, label: 'Lines across' },
      { key: 'width', label: 'Line width', min: 0.005, max: 0.45, step: 0.005, digits: 3, help: 'Width of each line, as a fraction of a cell.' },
      { key: 'softness', label: 'Softness', min: 0, max: 0.4, step: 0.01, digits: 2, help: 'Feathering at the line edges.' },
      C.relief, C.offset]),
  hex: PRIM('primitive', 'Hexagonal tiles', 'Hexagonal cells with bevelled edges. Honeycomb and tile patterns.',
    { frequency: 8, bevel: 0.2, relief: 0.8, offset: 0 },
    [{ ...C.freq, label: 'Hexes across' },
      { key: 'bevel', label: 'Bevel', min: 0, max: 0.45, step: 0.01, digits: 2, help: 'Width of the sloped edge of each tile.' },
      C.relief, C.offset]),
  brick: PRIM('primitive', 'Brick bond', 'Running-bond brickwork with mortar joints and per-brick variation.',
    { frequency: 8, aspect: 2, mortar: 0.12, variation: 0.3, relief: 0.8, offset: 0, seed: 61 },
    [{ ...C.freq, label: 'Rows across' },
      { key: 'aspect', label: 'Brick aspect', min: 1, max: 4, step: 0.05, digits: 2, help: 'Brick length to height.' },
      { key: 'mortar', label: 'Mortar', min: 0, max: 0.4, step: 0.01, digits: 2, help: 'Joint width, as a fraction of a brick.' },
      { key: 'variation', label: 'Variation', min: 0, max: 1, step: 0.01, digits: 2, help: 'Random height difference between bricks.' },
      C.relief, C.offset, C.seed]),
  checker: PRIM('primitive', 'Checkerboard', 'Alternating squares with soft or sharp edges.',
    { frequency: 6, softness: 0.1, relief: 0.8, offset: 0 },
    [{ ...C.freq, label: 'Squares across' },
      { key: 'softness', label: 'Edge softness', min: 0, max: 0.5, step: 0.01, digits: 2, help: 'Width of the blend at each square edge. 0 is sharp.' },
      C.relief, C.offset]),
  stripes: PRIM('primitive', 'Stripes', 'Straight stripes at any angle, with duty cycle and edge softness.',
    { frequency: 6, angle: 20, duty: 0.5, softness: 0.1, phase: 0, relief: 0.8, offset: 0 },
    [{ ...C.freq, label: 'Stripes across' }, C.angle,
      { key: 'duty', label: 'Duty', min: 0.02, max: 0.98, step: 0.01, digits: 2, help: 'Share of each period that is high.' },
      { key: 'softness', label: 'Edge softness', min: 0, max: 0.5, step: 0.01, digits: 2 },
      C.phase, C.relief, C.offset]),
  sine: PRIM('primitive', 'Sine wave', 'A sine undulation across the map at any angle. Clean periodic ridges.',
    { frequency: 3, angle: 0, phase: 0, relief: 1, offset: 0 },
    [{ ...C.freq, label: 'Waves across' }, C.angle, C.phase, C.relief, C.offset]),
  sawtooth: PRIM('primitive', 'Sawtooth', 'A ramp that climbs and drops sharply each period. Strata and step-like banding.',
    { frequency: 3, angle: 0, phase: 0, relief: 1, offset: 0 },
    [{ ...C.freq, label: 'Teeth across' }, C.angle, C.phase, C.relief, C.offset]),
  triangle: PRIM('primitive', 'Triangle wave', 'Linear rise and fall each period. Even, evenly spaced ridges.',
    { frequency: 3, angle: 0, phase: 0, relief: 1, offset: 0 },
    [{ ...C.freq, label: 'Waves across' }, C.angle, C.phase, C.relief, C.offset]),
};

// Geological landforms. Each one is finite: its centre and radius keep it in one place, so it needs no falloff.
// Their family follows Hesiod's Primitive/Geological group (GPL-3.0). The code is written for this editor. See geological.js.
const GEO = (label, blurb, defaults, controls) => ({ group: 'geological', label, blurb, blend: 'Add', defaults, controls });
const GEO_CENTRE = [
  { key: 'centreX', label: 'Centre X', min: 0, max: 100, step: 1, digits: 0, unit: '%', help: 'Horizontal position of the centre. 50 is the middle of the map.' },
  { key: 'centreY', label: 'Centre Y', min: 0, max: 100, step: 1, digits: 0, unit: '%', help: 'Vertical position of the centre. 50 is the middle of the map.' },
];
const GEO_RADIUS = { key: 'radius', label: 'Radius', min: 5, max: 150, step: 1, digits: 0, unit: '%', help: 'Size of the landform. 100 reaches the middle of each edge of the map.' };
const GEO_HEIGHT = { key: 'height', label: 'Height', min: 0, max: 2, step: 0.01, digits: 2, help: 'Height of the tallest feature. 1 is half the height range above the base.' };
const GEO_DETAIL = [
  { key: 'frequency', label: 'Detail scale', min: 0.5, max: 12, step: 0.1, digits: 1, unit: 'cyc', help: 'Scale of the surface roughness across the map.' },
  C.octaves,
];

const GEOLOGICAL_TYPES = {
  cone: GEO('Mountain cone', 'A single conical massif with a sharp summit. Its centre and radius place it. Add a falloff to keep its flanks from running on.',
    { centreX: 50, centreY: 50, radius: 45, sharpness: 2, rugosity: 0.25, height: 1.2, offset: 0, frequency: 3, octaves: 5, seed: 61 },
    [...GEO_CENTRE, GEO_RADIUS,
      { key: 'sharpness', label: 'Summit sharpness', min: 0.5, max: 4, step: 0.05, digits: 2, help: 'Higher gives a narrower summit and steeper flanks.' },
      { key: 'rugosity', label: 'Rugosity', min: 0, max: 1, step: 0.01, digits: 2, help: 'Roughness of the flanks.' },
      GEO_HEIGHT, C.offset, ...GEO_DETAIL, C.seed]),
  range: GEO('Radial mountain range', 'Ridges that radiate from a centre, like spokes. Good for a central massif with ridges running out from it.',
    { centreX: 50, centreY: 50, radius: 80, spokes: 7, sharpness: 1.5, roughness: 0.4, height: 1, offset: 0, frequency: 3, octaves: 4, seed: 62 },
    [...GEO_CENTRE, GEO_RADIUS,
      { key: 'spokes', label: 'Ridges', min: 3, max: 14, step: 1, digits: 0, help: 'Approximate number of ridges around the centre.' },
      { key: 'sharpness', label: 'Ridge sharpness', min: 0.5, max: 6, step: 0.05, digits: 2, help: 'Higher gives sharper crests.' },
      { key: 'roughness', label: 'Roughness', min: 0, max: 1, step: 0.01, digits: 2, help: 'Roughness along the ridges.' },
      GEO_HEIGHT, C.offset, ...GEO_DETAIL, C.seed]),
  stump: GEO('Mesa', 'A mountain with a flat top and steep sides.',
    { centreX: 50, centreY: 50, radius: 45, steepness: 2.5, plateau: 0.6, rugosity: 0.15, height: 1, offset: 0, frequency: 3, octaves: 4, seed: 63 },
    [...GEO_CENTRE, GEO_RADIUS,
      { key: 'steepness', label: 'Steepness', min: 1, max: 5, step: 0.05, digits: 2, help: 'Higher gives steeper sides.' },
      { key: 'plateau', label: 'Top height', min: 0.2, max: 1, step: 0.01, digits: 2, help: 'Height of the flat top, relative to the tallest feature.' },
      { key: 'rugosity', label: 'Rugosity', min: 0, max: 1, step: 0.01, digits: 2, help: 'Roughness of the flanks.' },
      GEO_HEIGHT, C.offset, ...GEO_DETAIL, C.seed]),
  inselberg: GEO('Inselberg', 'An isolated, rounded rock hill with steep sides.',
    { centreX: 50, centreY: 50, radius: 35, roundness: 3, rugosity: 0.3, height: 1, offset: 0, frequency: 4, octaves: 5, seed: 64 },
    [...GEO_CENTRE, GEO_RADIUS,
      { key: 'roundness', label: 'Roundness', min: 1.5, max: 6, step: 0.05, digits: 2, help: 'Higher gives steeper sides and a flatter top.' },
      { key: 'rugosity', label: 'Rugosity', min: 0, max: 1, step: 0.01, digits: 2, help: 'Roughness of the sides.' },
      GEO_HEIGHT, C.offset, ...GEO_DETAIL, C.seed]),
  crater: GEO('Crater', 'A bowl inside a raised rim, with an optional central peak and ejecta outside the rim.',
    { centreX: 50, centreY: 50, radius: 40, rim: 0.5, rimWidth: 0.12, depth: 0.6, peak: 0.2, rugosity: 0.2, height: 1, offset: 0, frequency: 4, octaves: 4, seed: 65 },
    [...GEO_CENTRE, GEO_RADIUS,
      { key: 'rim', label: 'Rim height', min: 0, max: 1, step: 0.01, digits: 2, help: 'Height of the rim.' },
      { key: 'rimWidth', label: 'Rim width', min: 0.04, max: 0.4, step: 0.01, digits: 2, help: 'Width of the rim, relative to the radius.' },
      { key: 'depth', label: 'Floor depth', min: 0, max: 1.5, step: 0.01, digits: 2, help: 'How far the floor sinks inside the rim.' },
      { key: 'peak', label: 'Central peak', min: 0, max: 1, step: 0.01, digits: 2, help: 'Height of a peak in the middle of the floor.' },
      { key: 'rugosity', label: 'Rugosity', min: 0, max: 1, step: 0.01, digits: 2, help: 'Roughness of the rim and the ejecta.' },
      GEO_HEIGHT, C.offset, ...GEO_DETAIL, C.seed]),
  rift: GEO('Rift valley', 'An elongated depression along an axis, with raised shoulders on either side.',
    { centreX: 50, centreY: 50, radius: 90, angle: 30, width: 0.25, depth: 0.8, shoulder: 0.3, rugosity: 0.2, height: 1, offset: 0, frequency: 4, octaves: 4, seed: 66 },
    [...GEO_CENTRE, GEO_RADIUS, C.angle,
      { key: 'width', label: 'Valley width', min: 0.05, max: 0.8, step: 0.01, digits: 2, help: 'Width of the valley, relative to the radius.' },
      { key: 'depth', label: 'Valley depth', min: 0, max: 1.5, step: 0.01, digits: 2, help: 'How far the valley floor sinks.' },
      { key: 'shoulder', label: 'Shoulders', min: 0, max: 1, step: 0.01, digits: 2, help: 'Height of the raised flanks beside the valley.' },
      { key: 'rugosity', label: 'Rugosity', min: 0, max: 1, step: 0.01, digits: 2, help: 'Roughness of the valley floor.' },
      GEO_HEIGHT, C.offset, ...GEO_DETAIL, C.seed]),
};

export const LAYER_TYPES = {
  ...PRIMITIVE_TYPES,
  ...GEOLOGICAL_TYPES,
  island: {
    group: 'shape',
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
  ramp: {
    group: 'shape',
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
      {
        key: 'resolution', label: 'Export size', kind: 'select',
        options: [[1024, '1k · 1024 px'], [2048, '2k · 2048 px'], [4096, '4k · 4096 px'], [8192, '8k · 8192 px'], [16384, '16k · 16384 px']],
        help: 'Size of the exported PNG. The viewport preview is always at most 1k.',
      },
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

// Primitive type ids in menu order. The Add menu uses this for its sections.
export const PRIMITIVE_IDS = Object.keys(PRIMITIVE_TYPES);

// Generator layers (primitives, shapes and geological landforms) can be limited to a region with a falloff.
// Their parameters hold a falloff block, which is off by default. See falloff.js.
export const GENERATOR_GROUPS = ['primitive', 'shape', 'geological'];
export const isGenerator = (type) => GENERATOR_GROUPS.includes(LAYER_TYPES[type]?.group);
for (const def of Object.values(LAYER_TYPES)) {
  if (GENERATOR_GROUPS.includes(def.group)) def.defaults = { ...def.defaults, falloff: { ...FALLOFF_DEFAULTS } };
}

// Controls of the falloff card. The inspector stores them under params.falloff.
export const FALLOFF_CONTROLS = [
  { key: 'shape', label: 'Shape', kind: 'select', options: FALLOFF_SHAPES, help: 'Outline of the region: a circle, a square or a diamond.' },
  { key: 'centreX', label: 'Centre X', min: 0, max: 100, step: 1, digits: 0, unit: '%', help: 'Horizontal centre of the region. 50 is the middle of the map.' },
  { key: 'centreY', label: 'Centre Y', min: 0, max: 100, step: 1, digits: 0, unit: '%', help: 'Vertical centre of the region. 50 is the middle of the map.' },
  { key: 'radius', label: 'Radius', min: 5, max: 150, step: 1, digits: 0, unit: '%', help: 'Edge of the region. 100 reaches the middle of each edge of the map.' },
  { key: 'softness', label: 'Softness', min: 0, max: 100, step: 1, digits: 0, unit: '%', help: 'Width of the fade at the edge, as a share of the radius.' },
  { key: 'strength', label: 'Strength', min: 0, max: 100, step: 1, digits: 0, unit: '%', help: 'How far the region limits the layer. 100 removes it completely outside.' },
];

export const TERRAIN_CONTROLS = [
  {
    key: 'size', label: 'Grid', kind: 'select',
    options: [[512, '512 × 512'], [1024, '1k · 1024 × 1024'], [2048, '2k · 2048 × 2048'], [4096, '4k · 4096 × 4096'], [8192, '8k · 8192 × 8192'], [16384, '16k · 16384 × 16384']],
    help: 'Output grid. Erosion runs on at most a 2k working grid; larger outputs add synthesised detail.',
  },
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
