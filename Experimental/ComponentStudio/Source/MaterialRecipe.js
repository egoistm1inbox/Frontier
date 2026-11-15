// Material recipe model for the Material Workspace inspector (UI demo — no renderer).
// Follows the layer-stack design in unassignedinbox/Frontier Documentation/Plans/DynamicMaterialSystemPlan.md:
// a bottom → top stack of Finish / Procedural field / Mask / Transition layers, live parameters packed into a
// 256-byte uniform block (no recompile on drag), and structural choices that pick the compiled shader variant.

export const BLOCK_BYTES = 256;

// ---------------------------------------------------------------------------------------------- layer types
export const LAYER_TYPES = {
  finish: { label: 'Finish', icon: 'finish', colour: '#ffb238', note: 'A complete OpenPBR surface. The bottom layer is always a finish.' },
  field: { label: 'Procedural field', icon: 'field', colour: '#38d1c4', note: 'Analytical pattern that writes into the channels you target.' },
  mask: { label: 'Mask', icon: 'mask', colour: '#4d9bff', note: 'Decides where and when the layers below it show, with an optional leading-edge seam.' },
  transition: { label: 'Transition', icon: 'transition', colour: '#b58cff', note: 'Blends finish A into finish B across an animated seam. Works on any asset.' },
};

// OpenPBR 1.1 lobes. Diffuse and specular are always present.
export const LOBES = [
  { id: 'diffuse', label: 'Diffuse', note: 'Energy-preserving Oren–Nayar', locked: true },
  { id: 'specular', label: 'Specular', note: 'Anisotropic GGX', locked: true },
  { id: 'metal', label: 'Metal', note: 'F82 conductor tint' },
  { id: 'coat', label: 'Coat', note: 'Tinted clearcoat' },
  { id: 'film', label: 'Thin film', note: 'Belcour–Barla iridescence' },
  { id: 'glints', label: 'Glints', note: 'Microflake sparkle' },
  { id: 'transmission', label: 'Transmission', note: 'Refraction + absorption' },
  { id: 'subsurface', label: 'Subsurface', note: 'Burley diffusion' },
  { id: 'sheen', label: 'Sheen', note: 'LTC cloth sheen' },
  { id: 'glow', label: 'Incandescence', note: 'Blackbody / tinted glow' },
];

export const CHANNELS = [
  { id: 'colour', label: 'Colour' }, { id: 'roughness', label: 'Roughness' }, { id: 'metalness', label: 'Metalness' },
  { id: 'height', label: 'Height' }, { id: 'coat', label: 'Coat' }, { id: 'opacity', label: 'Opacity' }, { id: 'glow', label: 'Glow' },
];

export const FIELD_PATTERNS = [
  { id: 'hex', label: 'Hex lattice' }, { id: 'voronoi', label: 'Dual Voronoi' }, { id: 'fbm', label: 'Warped fBm' }, { id: 'waves', label: 'Gerstner waves' },
  { id: 'rain', label: 'Rain beads' }, { id: 'brushed', label: 'Brushed' }, { id: 'voxel', label: 'Voxel lattice' }, { id: 'contour', label: 'Contour grid' },
];
export const MASK_MODES = [
  { id: 'sweep', label: 'Sweep wave' }, { id: 'fresnel', label: 'Fresnel grazing' }, { id: 'impact', label: 'Impact ripple' }, { id: 'crevice', label: 'Crevice' },
  { id: 'band', label: 'Height band' }, { id: 'puddle', label: 'Puddle flood' }, { id: 'voxel', label: 'Voxel cutout' },
];
export const SPACES = [['local', 'Local'], ['world', 'World'], ['triplanar', 'Triplanar'], ['uv', 'UV']];
export const BLENDS = [['normal', 'Normal'], ['multiply', 'Multiply'], ['overlay', 'Overlay'], ['height', 'Height']];

export const DRIVERS = [
  { id: 'constant', label: 'Constant', note: 'Slider setting', icon: 'link' },
  { id: 'clock', label: 'Clock', note: 'time × speed, wraps', icon: 'clock' },
  { id: 'pingpong', label: 'Ping-pong', note: 'Smooth back-and-forth', icon: 'clock' },
  { id: 'timeline', label: 'Timeline', note: 'Sequencer / gameplay track', icon: 'curve' },
  { id: 'impact', label: 'Impact', note: 'Age of the last world hit', icon: 'impact' },
  { id: 'weather', label: 'Weather', note: 'Wetness / wind from climate', icon: 'sample' },
  { id: 'particle', label: 'Particle link', note: 'Lattice density from a particle system', icon: 'seeds' },
];

export const COLOUR_SLOTS = [['primary', 'Primary'], ['secondary', 'Secondary'], ['seam', 'Seam'], ['glow', 'Glow']];

// Finish library used by the preset picker and transition A / B.
export const FINISHES = {
  sapphire: { label: 'Sapphire dielectric', colour: '#0b2a4a', roughness: 0.06, metalness: 0.02, specular: 0.8, ior: 1.77, lobes: ['coat', 'transmission'] },
  titanium: { label: 'Brushed titanium', colour: '#a9b1ba', roughness: 0.32, metalness: 1, specular: 1, ior: 2.16, lobes: ['metal'] },
  obsidian: { label: 'Liquid obsidian', colour: '#07080b', roughness: 0.05, metalness: 0.1, specular: 0.9, ior: 1.49, lobes: ['coat', 'glints'] },
  basalt: { label: 'Volcanic basalt', colour: '#1b1918', roughness: 0.88, metalness: 0.02, specular: 0.4, ior: 1.6, lobes: ['glow'] },
  water: { label: 'Deep ocean water', colour: '#0a2f3d', roughness: 0.03, metalness: 0, specular: 1, ior: 1.333, lobes: ['transmission', 'subsurface'] },
  snow: { label: 'Hoarfrost snow', colour: '#eef3f7', roughness: 0.62, metalness: 0, specular: 0.5, ior: 1.31, lobes: ['subsurface', 'glints'] },
  gunmetal: { label: 'Anodised gunmetal', colour: '#2b2f35', roughness: 0.24, metalness: 0.95, specular: 1, ior: 2.4, lobes: ['metal', 'film'] },
  asphalt: { label: 'Crushed asphalt', colour: '#2a2a2b', roughness: 0.86, metalness: 0, specular: 0.35, ior: 1.5, lobes: [] },
};

// ---------------------------------------------------------------------------------------------- parameter specs
// `form`: scalar (4 B) · colour (16 B, vec4 aligned) · vec3 (16 B). Live parameters live in the uniform block.
const S = (label, min, max, step, unit = '', digits = 2, extra = {}) => ({ form: 'scalar', label, min, max, step, unit, digits, ...extra });
export const SPECS = {
  finish: {
    roughness: S('Roughness', 0, 1, 0.01), metalness: S('Metalness', 0, 1, 0.01), specular: S('Specular weight', 0, 1, 0.01), ior: S('IOR', 1, 3, 0.001, '', 3),
    coatWeight: S('Coat weight', 0, 1, 0.01, '', 2, { lobe: 'coat' }), coatRoughness: S('Coat roughness', 0, 1, 0.01, '', 2, { lobe: 'coat' }),
    filmThickness: S('Film thickness', 100, 1200, 1, 'nm', 0, { lobe: 'film' }), filmIor: S('Film IOR', 1, 2.5, 0.01, '', 2, { lobe: 'film' }),
    glintDensity: S('Flake density', 0, 1, 0.01, '', 2, { lobe: 'glints' }), glintSize: S('Flake size', 5, 200, 1, 'µm', 0, { lobe: 'glints' }),
    transWeight: S('Transmission', 0, 1, 0.01, '', 2, { lobe: 'transmission' }), transDepth: S('Absorption depth', 0.001, 2, 0.001, 'm', 3, { lobe: 'transmission' }),
    sssWeight: S('Subsurface', 0, 1, 0.01, '', 2, { lobe: 'subsurface' }), sssRadius: S('Scatter radius', 0.1, 20, 0.1, 'mm', 1, { lobe: 'subsurface' }),
    sheenWeight: S('Sheen', 0, 1, 0.01, '', 2, { lobe: 'sheen' }), sheenRoughness: S('Sheen roughness', 0, 1, 0.01, '', 2, { lobe: 'sheen' }),
    metalTint: S('Edge tint (F82)', 0, 1, 0.01, '', 2, { lobe: 'metal' }),
    glowTemperature: S('Temperature', 800, 6500, 10, 'K', 0, { lobe: 'glow' }), glowGain: S('Glow gain', 0, 8, 0.01, '×', 2, { lobe: 'glow' }),
  },
  field: {
    scale: S('Feature scale', 0.1, 32, 0.01, '×'), rotation: S('Rotation', -180, 180, 1, '°', 0), jitter: S('Jitter', 0, 1, 0.01),
    lineWidth: S('Line width', 0.001, 0.25, 0.001, '', 3), contrast: S('Contrast', 0, 4, 0.01, '×'), speed: S('Drift speed', 0, 4, 0.01, '/s'),
  },
  mask: {
    progress: S('Progress', 0, 1, 0.001, '', 3), softness: S('Edge softness', 0, 1, 0.01), radius: S('Radius', 0.01, 4, 0.01, 'm'),
    seamWidth: S('Seam width', 0.001, 0.3, 0.001, 'm', 3), seamGain: S('Seam gain', 0, 12, 0.01, '×'),
  },
  transition: {
    progress: S('Progress', 0, 1, 0.001, '', 3), seamWidth: S('Seam width', 0.001, 0.3, 0.001, 'm', 3), jitter: S('Seam jitter', 0, 1, 0.01), seamGain: S('Seam gain', 0, 12, 0.01, '×'),
  },
};
// Channel amounts on field layers (one scalar each, only when targeted).
export const AMOUNT = S('Amount', -1, 1, 0.01);

// ---------------------------------------------------------------------------------------------- recipes
let uid = 0;
const id = (t) => `${t}-${(++uid).toString(36)}`;
function finishLayer(name, key, over = {}) {
  const f = FINISHES[key];
  return { id: id('finish'), type: 'finish', name, enabled: true, blend: 'normal', opacity: 1, finish: key, colour: f.colour, lobes: [...f.lobes],
    p: { roughness: f.roughness, metalness: f.metalness, specular: f.specular, ior: f.ior, coatWeight: 0.9, coatRoughness: 0.04, filmThickness: 460, filmIor: 1.45, glintDensity: 0.35, glintSize: 40, transWeight: 0.7, transDepth: 0.25, sssWeight: 0.4, sssRadius: 3, sheenWeight: 0.3, sheenRoughness: 0.5, metalTint: 0.3, glowTemperature: 1900, glowGain: 2.4, ...over } };
}
function fieldLayer(name, pattern, targets, over = {}, extra = {}) {
  return { id: id('field'), type: 'field', name, enabled: true, blend: 'normal', opacity: 1, pattern, space: 'local', octaves: 4, targets,
    p: { scale: 4.5, rotation: 0, jitter: 0.2, lineWidth: 0.04, contrast: 1.4, speed: 0, ...over }, ...extra };
}
function maskLayer(name, mode, over = {}, extra = {}) {
  return { id: id('mask'), type: 'mask', name, enabled: true, blend: 'normal', opacity: 1, mode, invert: false, seam: true, origin: [0, 0.4, 0.6],
    p: { progress: 0.5, softness: 0.2, radius: 0.8, seamWidth: 0.02, seamGain: 3, ...over }, ...extra };
}
function transitionLayer(name, a, b, over = {}) {
  return { id: id('transition'), type: 'transition', name, enabled: true, blend: 'normal', opacity: 1, a, b, direction: 'sweep',
    p: { progress: 0.5, seamWidth: 0.03, jitter: 0.4, seamGain: 2.6, ...over } };
}

export function presets() {
  uid = 0;
  const list = [];
  {
    const shell = finishLayer('Sapphire Fresnel shell', 'sapphire', { roughness: 0.08 });
    const lattice = fieldLayer('Hexagonal wireframe lattice', 'hex', { colour: 0.8, glow: 0.65, roughness: -0.2 }, { scale: 4.6, lineWidth: 0.035, jitter: 0 });
    const shock = maskLayer('Geodesic impact shockwaves', 'impact', { progress: 0.5, radius: 0.9, seamGain: 2.6 });
    list.push({ id: 'hex-barrier', name: 'Hexagonal Energy Barrier', group: 'Animated & VFX', layers: [shell, lattice, shock],
      slots: { primary: '#5fd4ff', secondary: '#7aa2ff', seam: '#d8fbff', glow: '#e8ffff' },
      drivers: { [`${shock.id}.progress`]: { mode: 'impact', speed: 0.85, min: 0, max: 1 }, [`${lattice.id}.speed`]: { mode: 'clock', speed: 0.55, min: 0, max: 1 } } });
  }
  {
    const basalt = finishLayer('Ropy pahoehoe basalt', 'basalt');
    const fissure = fieldLayer('Tectonic fissures', 'voronoi', { height: -0.7, glow: 1, roughness: 0.1 }, { scale: 2.1, jitter: 0.85, lineWidth: 0.06, contrast: 2.2 });
    const crust = maskLayer('Recessed crevice glow', 'crevice', { softness: 0.35, seamGain: 2.75 });
    list.push({ id: 'magma', name: 'Volcanic Pahoehoe Magma', group: 'Animated & VFX', layers: [basalt, fissure, crust],
      slots: { primary: '#1b1918', secondary: '#d93b04', seam: '#ffd26a', glow: '#ff7a1a' },
      drivers: { [`${basalt.id}.glowGain`]: { mode: 'pingpong', speed: 0.28, min: 1.6, max: 3.2 } } });
  }
  {
    const a = finishLayer('Brushed titanium', 'titanium');
    const t = transitionLayer('Titanium → obsidian', 'titanium', 'obsidian', { progress: 0.42 });
    const hex = fieldLayer('Ionised hex seam', 'hex', { glow: 0.9 }, { scale: 9, lineWidth: 0.02 });
    list.push({ id: 'transition', name: 'Surface Material Transition', group: 'Animated & VFX', layers: [a, t, hex],
      slots: { primary: '#b9c2cc', secondary: '#0a0d13', seam: '#28e8ff', glow: '#9ff6ff' },
      drivers: { [`${t.id}.progress`]: { mode: 'timeline', speed: 0.46, min: 0, max: 1 } } });
  }
  {
    const water = finishLayer('Dielectric water', 'water');
    const swell = fieldLayer('Four-swell Gerstner sum', 'waves', { height: 0.8, roughness: 0.05 }, { scale: 1.4, speed: 0.6 }, { space: 'world' });
    const caps = fieldLayer('Capillary fBm normals', 'fbm', { height: 0.25 }, { scale: 14, speed: 1.2, contrast: 0.8 }, { space: 'world', octaves: 5 });
    const foam = maskLayer('Crest micro-foam', 'band', { progress: 0.82, softness: 0.4 }, { seam: false });
    list.push({ id: 'ocean', name: 'Physical Ocean Water', group: 'Nature', layers: [water, swell, caps, foam],
      slots: { primary: '#0a2f3d', secondary: '#1f7a8c', seam: '#e9fbff', glow: '#9fe9ff' },
      drivers: { [`${swell.id}.speed`]: { mode: 'clock', speed: 0.6, min: 0, max: 1 }, [`${caps.id}.speed`]: { mode: 'clock', speed: 1.2, min: 0, max: 1 } } });
  }
  {
    const obs = finishLayer('Deep obsidian', 'obsidian', { coatWeight: 1, coatRoughness: 0.04 });
    list.push({ id: 'obsidian', name: 'Liquid Obsidian Clearcoat', group: 'Metals', layers: [obs],
      slots: { primary: '#07080b', secondary: '#1a1d24', seam: '#ffffff', glow: '#ffffff' }, drivers: {} });
  }
  {
    const asphalt = finishLayer('Crushed aggregate tarmac', 'asphalt');
    const puddles = maskLayer('Puddle flood', 'puddle', { progress: 0.55, softness: 0.3 }, { seam: false });
    const ripples = fieldLayer('Rain ripples', 'rain', { height: 0.3, roughness: -0.6 }, { scale: 6, speed: 1.6 });
    list.push({ id: 'asphalt', name: 'Wet Asphalt & Rain Puddles', group: 'Nature', layers: [asphalt, puddles, ripples],
      slots: { primary: '#2a2a2b', secondary: '#3c3d40', seam: '#9fb3c4', glow: '#ffffff' },
      drivers: { [`${puddles.id}.progress`]: { mode: 'weather', speed: 1, min: 0, max: 0.9 } } });
  }
  {
    const metal = finishLayer('Brushed gunmetal', 'gunmetal', { filmThickness: 520 });
    const drift = fieldLayer('Organic film drift', 'fbm', { colour: 0.4 }, { scale: 3, speed: 0.12, contrast: 0.6 });
    list.push({ id: 'thin-film', name: 'Anodised Thin-Film Iridescence', group: 'Metals', layers: [metal, drift],
      slots: { primary: '#2b2f35', secondary: '#6b4cff', seam: '#29e0c0', glow: '#ffffff' },
      drivers: { [`${metal.id}.filmThickness`]: { mode: 'pingpong', speed: 0.1, min: 380, max: 640 } } });
  }
  return list;
}

export function newLayer(type, recipe) {
  if (type === 'finish') return finishLayer('New finish', 'obsidian');
  if (type === 'field') return fieldLayer('New procedural field', 'fbm', { roughness: 0.3 });
  if (type === 'mask') return maskLayer('New mask', 'sweep');
  return transitionLayer('New transition', recipe.layers[0]?.finish || 'titanium', 'obsidian');
}

// ---------------------------------------------------------------------------------------------- derived data
// Live parameters of one layer: [{ key, spec, amount }]. Lobe parameters only count when their lobe is on.
export function liveParams(layer) {
  const out = [{ key: 'opacity', spec: S('Layer opacity', 0, 1, 0.01), amount: layer.opacity }];
  const specs = SPECS[layer.type];
  for (const [key, spec] of Object.entries(specs)) {
    if (spec.lobe && !layer.lobes?.includes(spec.lobe)) continue;
    if (layer.type === 'mask' && (key === 'seamWidth' || key === 'seamGain') && !layer.seam) continue;
    if (layer.type === 'mask' && key === 'radius' && layer.mode !== 'impact') continue;
    out.push({ key, spec, amount: layer.p[key] });
  }
  if (layer.type === 'field') for (const [ch, v] of Object.entries(layer.targets)) out.push({ key: 'amount.' + ch, spec: { ...AMOUNT, label: `${CHANNELS.find((c) => c.id === ch)?.label} amount` }, amount: v });
  if (layer.type === 'finish') out.push({ key: 'colour', spec: { form: 'colour', label: 'Colour' }, amount: layer.colour });
  if (layer.type === 'mask' && layer.mode === 'impact') out.push({ key: 'origin', spec: { form: 'vec3', label: 'Impact origin' }, amount: layer.origin });
  return out;
}
const bytesOf = (spec) => (spec.form === 'scalar' ? 4 : 16);

// Uniform block layout: header (clock, impact, weather — 32 B), colour slots (4 × 16 B), then each layer's live params.
export function blockLayout(recipe) {
  const rows = [{ id: 'header', label: 'Clock · impact · weather', colour: '#6a6a6a', bytes: 32 }, { id: 'slots', label: 'Colour slots', colour: '#cfcfcf', bytes: 16 * COLOUR_SLOTS.length }];
  for (const layer of recipe.layers) {
    if (!layer.enabled) continue;
    const params = liveParams(layer);
    let bytes = params.reduce((n, x) => n + bytesOf(x.spec), 0);
    bytes = Math.ceil(bytes / 16) * 16; // std140 rows
    rows.push({ id: layer.id, label: layer.name, colour: LAYER_TYPES[layer.type].colour, bytes, params: params.length });
  }
  const used = rows.reduce((n, r) => n + r.bytes, 0);
  return { rows, used, free: Math.max(0, BLOCK_BYTES - used), over: used > BLOCK_BYTES };
}

// Structural signature: anything that changes the compiled variant. Live values are excluded on purpose.
export function structure(recipe) {
  return recipe.layers.filter((l) => l.enabled).map((l) => [l.type, l.blend, l.finish, (l.lobes || []).slice().sort().join('+'), l.pattern, l.space, l.octaves, l.mode, l.invert, l.seam, l.a, l.b, l.direction,
    l.targets ? Object.keys(l.targets).sort().join('+') : ''].join(':')).join('|');
}
export function signature(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0').slice(-4);
}

export function lobeSummary(recipe) {
  const on = new Set(['diffuse', 'specular']);
  for (const l of recipe.layers) if (l.enabled && l.type === 'finish') l.lobes.forEach((x) => on.add(x));
  for (const l of recipe.layers) if (l.enabled && l.type === 'transition') [l.a, l.b].forEach((k) => FINISHES[k]?.lobes.forEach((x) => on.add(x)));
  return on;
}
