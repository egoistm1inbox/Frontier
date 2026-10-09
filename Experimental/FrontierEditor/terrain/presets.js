// Starting stacks. Each preset is a plain document: world settings, a terrain stack and a texturing
// stack. Layers are built with the same factories the picker uses, so every field is editable.

import { makeTerrainLayer, makeMask, defaultParams, newId } from './stack.js';
import { makeTextureLayer } from './texturing.js';
import { TERRAIN_TYPES } from './catalog-terrain.js';

function terrain(type, overrides = {}, masks = []) {
  const layer = makeTerrainLayer(type);
  layer.params = { ...layer.params, ...overrides };
  layer.masks = masks;
  return layer;
}

// Masks are built with the same factory as the picker, so every field (enabled, blend, invert) is set.
function mask(type, params = {}, blend = 'multiply') {
  const m = makeMask(type, blend);
  m.params = { ...m.params, ...params };
  return m;
}

function texture(type, overrides = {}, masks) {
  const layer = makeTextureLayer(type);
  layer.params = { ...layer.params, ...overrides };
  if (masks) layer.masks = masks;
  return layer;
}

const alpineTerrain = () => [
  terrain('relief', { seed: 7, height: 420, wavelength: 480, ridge: 0.65, warp: 0.55, peaks: 0.55, continent: 0.35 }),
  terrain('strata', { band: 22, strength: 0.4, hardShare: 0.5 }),
  terrain('rugged', { amount: 14, scale: 70, blockiness: 0.7, ledges: 0.5 }),
  terrain('thermal', { iterations: 24, rate: 0.5 }),
  terrain('fluvial', { strength: 0.65, iterations: 30, concavity: 0.45, uplift: 0.3, deposition: 0.6, basinFill: 0.2 }),
  terrain('hydraulic', { droplets: 40000, erode: 0.35 }),
  terrain('rivers', { catchment: 0.02, widthAt1km2: 70, maxWidth: 90, depthScale: 1 }),
  terrain('lakes', { fill: 0.35, minDepth: 2.5, minArea: 800, maxAreaFrac: 0.03 }),
];

const coastTerrain = () => [
  terrain('relief', { seed: 21, height: 340, base: -26, wavelength: 600, ridge: 0.4, continent: 0.55, peaks: 0.4 }),
  terrain('strata', { band: 18, strength: 0.55, dipDirection: 200, dip: 8 }),
  terrain('rugged', { amount: 22, scale: 90, blockiness: 0.8, slopeMin: 24, slopeMax: 45 }),
  terrain('thermal', { iterations: 30, rate: 0.55 }),
  terrain('fluvial', { strength: 0.5, iterations: 24, uplift: 0.2 }),
  terrain('sea', { level: 0 }),
  terrain('rivers', { catchment: 0.015, widthAt1km2: 80, maxWidth: 110 }),
  terrain('lakes', { fill: 0.35, minDepth: 2.5, minArea: 800, maxAreaFrac: 0.03 }),
];

const canyonTerrain = () => [
  terrain('relief', { seed: 33, height: 260, wavelength: 300, ridge: 0.3, roughness: 0.7, plateau: 0.5, peaks: 0.2, continent: 0.5 }),
  terrain('strata', { band: 14, strength: 0.7, hardShare: 0.45, dip: 3 }),
  terrain('thermal', { iterations: 40, rate: 0.6 }),
  terrain('fluvial', { strength: 0.85, iterations: 50, uplift: 0.6, deposition: 0.4 }),
  terrain('hydraulic', { droplets: 30000, erode: 0.4 }),
  terrain('rivers', { catchment: 0.03, widthAt1km2: 50, maxWidth: 80, depthScale: 1.3 }),
  terrain('lakes', { fill: 0.3, minDepth: 2.5, minArea: 800, maxAreaFrac: 0.03 }),
];

const surfaceTexture = (warm = false) => [
  texture('rock', warm ? { hard: '#c49b74', soft: '#8a5d43', grain: 0.4 } : {}),
  texture('cliff', warm ? { colour: '#6a3f2c' } : {}),
  texture('soil', warm ? { colour: '#9a6d4a' } : {}),
  texture('grass', warm ? { colourA: '#8a7a45', colourB: '#a29152' } : {}),
  texture('snow', { roughness: 0.55 }, [mask('height', { min: 230, max: 1500, feather: 30 })]),
  texture('gravel'),
  texture('silt'),
  texture('water'),
  texture('cavity'),
  texture('wetness'),
];

export const PRESETS = [
  { id: 'alpine', name: 'Alpine valley', blurb: 'Ridged massifs cut by a river network, with lakes and snow', world: { size: 1024, resolution: 256, seed: 7 }, terrain: alpineTerrain, texturing: () => surfaceTexture(false) },
  { id: 'coast', name: 'Coastal cliffs', blurb: 'Lowlands meeting a sea level, with cliffs above the shore', world: { size: 1024, resolution: 256, seed: 21 }, terrain: coastTerrain, texturing: () => surfaceTexture(false) },
  { id: 'canyon', name: 'Canyon lakes', blurb: 'Plateau bedrock with stratified walls and deep river cuts', world: { size: 1024, resolution: 256, seed: 33 }, terrain: canyonTerrain, texturing: () => surfaceTexture(true) },
];

export function buildPreset(id) {
  const preset = PRESETS.find((p) => p.id === id) || PRESETS[0];
  return {
    version: 1,
    world: { ...preset.world },
    terrain: preset.terrain(),
    texturing: preset.texturing(),
    view: { mode: 'shaded' },
  };
}

export { TERRAIN_TYPES, makeMask, defaultParams, newId };
