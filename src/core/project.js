/**
 * Frontier Landscape Studio — project model and serialization.
 */

import { defaultLayers, createLayer, LAYER_LIBRARY } from './layers.js';
import { defaultTextureStack, defaultSun, createSplatLayer, createSatmapLayer } from './textures.js';

export const RESOLUTIONS = [
  { value: 129, label: '129 × 129', note: 'Fast · preview', cost: 'low' },
  { value: 257, label: '257 × 257', note: 'Balanced', cost: 'medium' },
  { value: 513, label: '513 × 513', note: 'Detailed · slower', cost: 'high' },
  { value: 1025, label: '1025 × 1025', note: 'Production · slow', cost: 'very high' },
];

export const STORAGE_KEY = 'frontier-landscape-studio-v1';

export function defaultProject() {
  return {
    name: 'Evergreen valley',
    version: 1,
    resolution: 257,
    worldSize: 2048,       // metres across the grid
    maxHeight: 900,        // metres of vertical range
    heightScale: 1,        // artistic vertical exaggeration
    seaLevel: 0.2,
    seed: 4821,
    textureSize: 1024,
    layers: defaultLayers(),
    texture: defaultTextureStack(),
    view: {
      mode: 'shaded',
      grid: false,
      gridStep: 8,
      contours: false,
      contourInterval: 25,
      contourMajor: 5,
      ortho: false,
      detailStrength: 0.55,
      detailScale: 46,
      water: {
        enabled: true,
        level: 0.2,
        opacity: 0.82,
        ripple: 0.5,
        foam: 0.35,
        deepColor: '#123844',
      },
      sky: {
        top: '#1b2c40',
        horizon: '#7d8b98',
        ground: '#2a2723',
      },
      specular: true,
    },
    sun: defaultSun(),
    brush: {
      mode: 'raise',
      size: 22,
      strength: 0.18,
      falloff: 0.62,
      level: 0.3,
      noiseScale: 8,
    },
  };
}

/** Layer types grouped the way the add menu presents them. */
export function layerCategories() {
  const groups = new Map();
  for (const type of LAYER_LIBRARY) {
    if (!groups.has(type.category)) groups.set(type.category, []);
    groups.get(type.category).push(type);
  }
  return [...groups.entries()].map(([name, types]) => ({ name, types }));
}

/* ------------------------------------------------------------- mutation */

export function withLayer(project, id, updater) {
  return {
    ...project,
    layers: project.layers.map((l) => (l.id === id ? updater(l) : l)),
    texture: {
      ...project.texture,
      layers: project.texture.layers.map((l) => (l.id === id ? updater(l) : l)),
    },
  };
}

export function setLayerParam(project, id, key, value) {
  return withLayer(project, id, (layer) => ({
    ...layer,
    params: { ...layer.params, [key]: value },
  }));
}

export function moveLayer(layers, from, to) {
  if (from === to) return layers;
  const next = [...layers];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function reorderTextureLayers(layers, from, to) {
  return moveLayer(layers, from, to);
}

/* --------------------------------------------------------- serialization */

/** Strip runtime-only payloads that must never be written to storage. */
function serializeLayer(layer) {
  const { params } = layer;
  const clean = {};
  for (const [key, value] of Object.entries(params || {})) {
    // Imported satellite imagery can be megabytes; localStorage would reject it.
    if (key === 'image') continue;
    clean[key] = value;
  }
  return { ...layer, params: clean, hasImage: !!(params && params.image) };
}

export function serializeProject(project) {
  return {
    ...project,
    layers: project.layers.map(serializeLayer),
    texture: { ...project.texture, layers: project.texture.layers.map(serializeLayer) },
  };
}

export function deserializeProject(raw) {
  if (!raw || typeof raw !== 'object') return defaultProject();
  const base = defaultProject();
  const project = {
    ...base,
    ...raw,
    view: { ...base.view, ...(raw.view || {}), water: { ...base.view.water, ...(raw.view?.water || {}) }, sky: { ...base.view.sky, ...(raw.view?.sky || {}) } },
    sun: { ...base.sun, ...(raw.sun || {}) },
    brush: { ...base.brush, ...(raw.brush || {}) },
    texture: {
      ...base.texture,
      ...(raw.texture || {}),
      layers: Array.isArray(raw.texture?.layers) && raw.texture.layers.length
        ? raw.texture.layers
        : base.texture.layers,
    },
  };
  if (!Array.isArray(project.layers) || !project.layers.length) project.layers = base.layers;
  return project;
}

export function loadProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultProject();
    return deserializeProject(JSON.parse(raw));
  } catch {
    return defaultProject();
  }
}

export function saveProject(project) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeProject(project)));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || 'Storage unavailable' };
  }
}

/** Rough estimate of what a bake will cost, used to warn before big runs. */
export function estimateCost(project) {
  const cells = project.resolution * project.resolution;
  let erosionUnits = 0;
  for (const layer of project.layers) {
    if (!layer.enabled || layer.type !== 'erode') continue;
    const type = layer.params?.type || 'hydraulic';
    const tuning = layer.params?.tuning?.[type] || {};
    if (type === 'hydraulic') erosionUnits += (tuning.droplets || 0) * (tuning.lifetime || 0) / 1e6;
    else erosionUnits += (tuning.iterations || 0) * cells / 1e7;
  }
  return { cells, erosionUnits, heavy: erosionUnits > 6 || cells > 300000 };
}

export { createLayer, createSplatLayer, createSatmapLayer };
