// Project model: terrain settings, the layer list, view settings. Pure data, so it serialises to JSON.
import { LAYER_TYPES, EROSION_TYPES, DEFAULT_VIEW, DEFAULT_GRID, GRID_SIZES, SATMAP_SIZES, defaultLayerName, layerKind } from './layers.js';

// Version 2 renamed two types (noise to fbm, base to constant). Older files are migrated on load.
export const PROJECT_VERSION = 2;
export const STORAGE_KEY = 'Frontier.LandscapeEditor.v1';

// Erosion and the other working-grid stages never run above WORKING_MAX cells a side. Larger outputs are
// produced from that grid by upscaling plus synthesised detail at export time (see terrain/export.js).
export const WORKING_MAX = 2048;
// The viewport colour preview is never larger than this, whatever the satmap export size is.
export const PREVIEW_MAX = 1024;

export const workingSize = (size) => Math.min(size, WORKING_MAX);

export const TERRAIN_DEFAULTS = {
  size: DEFAULT_GRID,
  extentM: 6144,
  heightM: 1000,
  seed: 1337,
  seaLevel: 0.18,
};

// Old type names and the parameter each one used to store under.
const TYPE_RENAMES = { noise: 'fbm', base: 'constant' };

let idCounter = 0;
export function newId(prefix = 'L') {
  idCounter++;
  return prefix + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 6) + idCounter.toString(36);
}

const clone = (v) => JSON.parse(JSON.stringify(v));

export function createLayer(type, opts = {}) {
  const def = LAYER_TYPES[type];
  if (!def) throw new Error('Unknown layer type ' + type);
  const params = clone(def.defaults);
  if (opts.params) mergeParams(params, opts.params);
  return {
    id: newId(),
    type,
    name: opts.name || defaultLayerName(type, params),
    enabled: true,
    opacity: opts.opacity ?? 1,
    blend: opts.blend || def.blend || 'Normal',
    params,
  };
}

function mergeParams(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') mergeParams(target[k], v);
    else target[k] = v;
  }
}

export function createDefaultProject() {
  const layers = [
    createLayer('fbm', { name: 'Continental hills', params: { frequency: 1.6, octaves: 7, warp: 0.45, relief: 1.3, seed: 3 } }),
    createLayer('ridged', { name: 'Mountain ridges', opacity: 0.5, blend: 'Add', params: { frequency: 2.6, relief: 1.3, seed: 11 } }),
    createLayer('billow', { name: 'Foothills', opacity: 0.2, blend: 'Add', params: { frequency: 3.5, octaves: 5, relief: 0.8, seed: 41 } }),
    createLayer('island', { name: 'Coastline mask', params: { radius: 1.2, falloff: 2.2, wobble: 0.45, seed: 5 } }),
    createLayer('erosion', { name: 'Fluvial valleys', params: { type: 'fluvial' } }),
    createLayer('erosion', { name: 'Thermal scree', opacity: 0.7, params: { type: 'thermal' } }),
    createLayer('erosion', { name: 'Hydraulic gullies', opacity: 0.8, params: { type: 'hydraulic' } }),
    createLayer('satmap', { name: 'Satellite · temperate', params: { palette: 'temperate' } }),
  ];
  return {
    version: PROJECT_VERSION,
    name: 'Untitled landscape',
    terrain: { ...TERRAIN_DEFAULTS },
    layers,
    view: { ...DEFAULT_VIEW },
  };
}

// Brings any loaded or stored project to the current shape: fills missing fields from the registry,
// drops unknown keys, renames old layer types and orders layers so height layers come before texture layers.
export function normaliseProject(input) {
  const base = createDefaultProject();
  if (!input || typeof input !== 'object') return base;
  const out = { ...base, name: typeof input.name === 'string' ? input.name : base.name };
  out.terrain = { ...TERRAIN_DEFAULTS, ...(input.terrain || {}) };
  out.terrain.size = GRID_SIZES.includes(+out.terrain.size) ? +out.terrain.size : TERRAIN_DEFAULTS.size;
  out.terrain.extentM = clampNum(out.terrain.extentM, 1000, 16000, TERRAIN_DEFAULTS.extentM);
  out.terrain.heightM = clampNum(out.terrain.heightM, 100, 4000, TERRAIN_DEFAULTS.heightM);
  out.terrain.seaLevel = clampNum(out.terrain.seaLevel, 0, 0.6, TERRAIN_DEFAULTS.seaLevel);
  out.terrain.seed = Math.floor(clampNum(out.terrain.seed, 0, 999999, TERRAIN_DEFAULTS.seed));
  out.view = { ...DEFAULT_VIEW, ...(input.view || {}) };
  const layers = [];
  const seen = new Set();
  for (const raw of Array.isArray(input.layers) ? input.layers : []) {
    if (!raw || typeof raw !== 'object') continue;
    const type = TYPE_RENAMES[raw.type] || raw.type;
    if (!LAYER_TYPES[type]) continue;
    const fresh = createLayer(type, {});
    const params = { ...fresh.params };
    const rawParams = raw.params && typeof raw.params === 'object' ? { ...raw.params } : {};
    // The old base layer stored its height as "level". The constant primitive calls it "value".
    if (raw.type === 'base' && rawParams.value === undefined && rawParams.level !== undefined) rawParams.value = rawParams.level;
    mergeParams(params, rawParams);
    if (type === 'erosion' && !EROSION_TYPES[params.type]) params.type = 'hydraulic';
    if (type === 'satmap' && !SATMAP_SIZES.includes(+params.resolution)) params.resolution = 1024;
    let id = typeof raw.id === 'string' && raw.id ? raw.id : fresh.id;
    if (seen.has(id)) id = newId();
    seen.add(id);
    layers.push({
      id,
      type,
      name: typeof raw.name === 'string' && raw.name ? raw.name : defaultLayerName(type, params),
      enabled: raw.enabled !== false,
      opacity: clampNum(raw.opacity, 0, 1, 1),
      blend: LAYER_TYPES[type].blend && ['Normal', 'Add', 'Subtract', 'Multiply', 'Max', 'Min'].includes(raw.blend) ? raw.blend : fresh.blend,
      params,
    });
  }
  out.layers = [...layers.filter((l) => layerKind(l.type) === 'height'), ...layers.filter((l) => layerKind(l.type) === 'texture')];
  return out;
}

function clampNum(v, lo, hi, fallback) {
  const x = Number(v);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(hi, Math.max(lo, x));
}

// The data the worker needs. Layer names and view settings stay on the main thread.
export function evaluationSnapshot(project) {
  return {
    terrain: { ...project.terrain },
    layers: project.layers.map((l) => ({
      id: l.id,
      type: l.type,
      name: l.name,
      enabled: l.enabled,
      opacity: l.opacity,
      blend: l.blend,
      params: clone(l.params),
    })),
  };
}

// Unsigned 16-bit, little-endian, row 0 at the north edge. Matches the common raw import formats.
export function encodeR16(height, N) {
  const buf = new ArrayBuffer(N * N * 2);
  const view = new DataView(buf);
  for (let i = 0; i < N * N; i++) {
    const v = Math.max(0, Math.min(1, height[i]));
    view.setUint16(i * 2, Math.round(v * 65535), true);
  }
  return buf;
}
