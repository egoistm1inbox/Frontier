// Texture (material) layer registry. Every texture layer is a material placed by mask rules that read the
// terrain's derived maps (height, slope, curvature, flow, wear, deposits, talus, snow, shoreline, aspect,
// occlusion, noise). Layers are composited bottom → top in one GPU pass.
import { newId } from '../terrain/layer-types.js';

export const TEX_BLEND = ['Normal', 'Multiply', 'Overlay', 'Recolor', 'Wetness'];
export const DETAIL_TYPES = ['Rock', 'Ground', 'Vegetation', 'Snow', 'Canopy'];

// Rule domains. lo/hi beyond the domain disable that edge. Ranges are 0..1 unless noted.
export const RULES = [
  { key: 'height', label: 'Height', icon: 'mountain', unit: '%', min: 0, max: 1, step: 0.005, fallMax: 0.3, note: 'Relative elevation' },
  { key: 'slope', label: 'Slope', icon: 'triangle-right', unit: '°', min: 0, max: 90, step: 0.5, fallMax: 25, note: 'Steepness' },
  { key: 'curvature', label: 'Curvature', icon: 'spline', unit: 'm', min: -40, max: 40, step: 0.1, fallMax: 12, note: 'Concave ← → convex' },
  { key: 'flow', label: 'Flow', icon: 'waves', unit: '%', min: 0, max: 1, step: 0.005, fallMax: 0.3, note: 'Drainage area' },
  { key: 'wear', label: 'Wear', icon: 'pickaxe', unit: '%', min: 0, max: 1, step: 0.005, fallMax: 0.3, note: 'Material removed by erosion' },
  { key: 'deposit', label: 'Deposits', icon: 'layers', unit: '%', min: 0, max: 1, step: 0.005, fallMax: 0.3, note: 'Sediment laid down' },
  { key: 'talus', label: 'Talus', icon: 'mountain-snow', unit: '%', min: 0, max: 1, step: 0.005, fallMax: 0.3, note: 'Scree from slope failure' },
  { key: 'snow', label: 'Snow', icon: 'snowflake', unit: '%', min: 0, max: 1, step: 0.005, fallMax: 0.3, note: 'Simulated snow cover' },
  { key: 'water', label: 'Shoreline', icon: 'droplets', unit: 'm', min: -30, max: 30, step: 0.1, fallMax: 8, note: 'Height below (+) / above (−) water' },
  { key: 'aspect', label: 'Aspect', icon: 'compass', unit: '°', special: 'aspect', note: 'Facing direction' },
  { key: 'occlusion', label: 'Occlusion', icon: 'circle-dashed', unit: '%', min: 0, max: 1, step: 0.005, fallMax: 0.3, note: 'Open sky ← → enclosed' },
  { key: 'noise', label: 'Noise', icon: 'sparkles', unit: '', special: 'noise', note: 'Procedural breakup' },
];
export const RULE_KEYS = RULES.map(r => r.key);

const rule = (on = false, lo = null, hi = null, fall = null) => ({ on, lo, hi, fall });

function baseParams() {
  return {
    colorA: '#7d776f', colorB: '#6a645c', variation: 0.35, varScale: 60, roughness: 0.82,
    detail: 0, detailStrength: 0.8,
    coverage: 0.5, edge: 0.3, edgeScale: 18, sharpness: 1.6,
    strataOn: false, strataSpacing: 9, strataContrast: 0.35, strataColor: '#5c554d', strataTilt: 0.05, strataWarp: 0.4,
    wetness: 0.6,
    rules: {
      height: rule(false, 0, 1, 0.04), slope: rule(false, 0, 90, 3), curvature: rule(false, -40, 40, 2),
      flow: rule(false, 0, 1, 0.05), wear: rule(false, 0, 1, 0.05), deposit: rule(false, 0, 1, 0.05),
      talus: rule(false, 0, 1, 0.05), snow: rule(false, 0, 1, 0.05), water: rule(false, -30, 30, 1),
      aspect: { on: false, dir: 0, spread: 60, fall: 25 },
      occlusion: rule(false, 0, 1, 0.05),
      noise: { on: false, scale: 120, threshold: 0.5, contrast: 2.0 },
    },
  };
}

const R = (o) => o; // readability helper for presets

// Material presets offered in the Add-layer modal. All share one parameter set; presets only differ in defaults.
export const TEXTURE_TYPES = {
  base: { label: 'Bedrock base', category: 'Rock', icon: 'square', blurb: 'Fills the whole terrain', swatch: '#7d776f',
    params: R({ colorA: '#7a746c', colorB: '#625d57', variation: 0.45, varScale: 140, roughness: 0.85, detail: 0, edge: 0, coverage: 0.5 }) },
  rock: { label: 'Rock', category: 'Rock', icon: 'mountain', blurb: 'Exposed rock on steep faces', swatch: '#857f77',
    params: R({ colorA: '#868077', colorB: '#6f6961', variation: 0.4, varScale: 45, roughness: 0.78, detail: 0, rules: { slope: rule(true, 38, 90, 6) } }) },
  cliff: { label: 'Cliff strata', category: 'Rock', icon: 'layers-3', blurb: 'Banded sedimentary cliffs', swatch: '#9a8a76',
    params: R({ colorA: '#9b8b77', colorB: '#7c6c5a', variation: 0.3, roughness: 0.8, detail: 0, strataOn: true, strataContrast: 0.45, rules: { slope: rule(true, 45, 90, 5) } }) },
  basalt: { label: 'Basalt', category: 'Rock', icon: 'hexagon', blurb: 'Dark volcanic rock', swatch: '#3d3b3a',
    params: R({ colorA: '#3f3d3b', colorB: '#2e2c2b', variation: 0.35, roughness: 0.72, detail: 0 }) },
  scree: { label: 'Scree', category: 'Soil & sediment', icon: 'mountain-snow', blurb: 'Loose talus below cliffs', swatch: '#8d867c',
    params: R({ colorA: '#8f887d', colorB: '#787168', variation: 0.5, varScale: 30, roughness: 0.88, detail: 1, rules: { talus: rule(true, 0.12, 1, 0.08), slope: rule(true, 0, 42, 4) } }) },
  soil: { label: 'Soil', category: 'Soil & sediment', icon: 'shovel', blurb: 'Dark earth on gentle slopes', swatch: '#5a4a3a',
    params: R({ colorA: '#5b4b3b', colorB: '#4a3d30', variation: 0.4, varScale: 80, roughness: 0.9, detail: 1, rules: { slope: rule(true, 0, 30, 5) } }) },
  sediment: { label: 'Sediment', category: 'Soil & sediment', icon: 'layers', blurb: 'Alluvial fans and deposits', swatch: '#8a7b66',
    params: R({ colorA: '#8b7c67', colorB: '#a18f75', variation: 0.45, varScale: 50, roughness: 0.9, detail: 1, rules: { deposit: rule(true, 0.1, 1, 0.1) } }) },
  gravel: { label: 'River gravel', category: 'Soil & sediment', icon: 'waves', blurb: 'Riverbeds along strong flow', swatch: '#77736c',
    params: R({ colorA: '#7a766e', colorB: '#8f8a80', variation: 0.5, varScale: 12, roughness: 0.8, detail: 1, edge: 0.2, rules: { flow: rule(true, 0.62, 1, 0.06) } }) },
  sand: { label: 'Sand', category: 'Soil & sediment', icon: 'sun', blurb: 'Dunes, beaches and desert floors', swatch: '#c2a27a',
    params: R({ colorA: '#c4a37b', colorB: '#b18e66', variation: 0.35, varScale: 90, roughness: 0.92, detail: 1 }) },
  grass: { label: 'Alpine meadow', category: 'Vegetation', icon: 'sprout', blurb: 'Grass on gentle, open slopes', swatch: '#5d6a36',
    params: R({ colorA: '#56662f', colorB: '#7d7a42', variation: 0.45, varScale: 110, roughness: 0.92, detail: 2, coverage: 0.55,
      rules: { slope: rule(true, 0, 30, 5), height: rule(true, 0, 0.62, 0.08), noise: { on: true, scale: 180, threshold: 0.42, contrast: 1.6 } } }) },
  forest: { label: 'Conifer forest', category: 'Vegetation', icon: 'trees', blurb: 'Dense forest canopy in valleys', swatch: '#2b3a24',
    params: R({ colorA: '#2a3923', colorB: '#35442a', variation: 0.4, varScale: 40, roughness: 0.95, detail: 4, coverage: 0.5, edge: 0.55, edgeScale: 40, sharpness: 2.2,
      rules: { slope: rule(true, 0, 33, 4), height: rule(true, 0, 0.36, 0.06), occlusion: rule(false, 0, 1, 0.05) } }) },
  moss: { label: 'Moss & lichen', category: 'Vegetation', icon: 'leaf', blurb: 'Shaded, north-facing growth', swatch: '#4f5b33',
    params: R({ colorA: '#4e5a32', colorB: '#6b7044', variation: 0.5, varScale: 20, roughness: 0.9, detail: 2,
      rules: { aspect: { on: true, dir: 0, spread: 70, fall: 30 }, slope: rule(true, 0, 50, 6) } }) },
  dryGrass: { label: 'Dry grass', category: 'Vegetation', icon: 'wheat', blurb: 'Sun-baked grassland', swatch: '#9b8a55',
    params: R({ colorA: '#9a8954', colorB: '#7f7445', variation: 0.45, varScale: 70, roughness: 0.93, detail: 2, rules: { slope: rule(true, 0, 26, 5) } }) },
  snow: { label: 'Snow', category: 'Snow & water', icon: 'snowflake', blurb: 'Fresh snow from the snow simulation', swatch: '#eef2f7',
    params: R({ colorA: '#f1f4f8', colorB: '#dfe6ef', variation: 0.25, varScale: 35, roughness: 0.55, detail: 3, edge: 0.25, edgeScale: 8, sharpness: 2.4,
      rules: { snow: rule(true, 0.08, 1, 0.06), slope: rule(true, 0, 52, 5) } }) },
  snowline: { label: 'Snowline', category: 'Snow & water', icon: 'mountain-snow', blurb: 'Snow above an altitude', swatch: '#e7edf4',
    params: R({ colorA: '#eef2f7', colorB: '#d9e1ea', variation: 0.25, varScale: 35, roughness: 0.55, detail: 3, edge: 0.45, edgeScale: 30, sharpness: 2.2,
      rules: { height: rule(true, 0.72, 1, 0.05), slope: rule(true, 0, 48, 6) } }) },
  shoreline: { label: 'Wet shore', category: 'Snow & water', icon: 'droplets', blurb: 'Damp banks around lakes and rivers', swatch: '#3c4148',
    params: R({ colorA: '#4a4640', colorB: '#3a3732', blend: 4, wetness: 0.85, detail: 1, rules: { water: rule(true, -2.5, 30, 1.2) } }) },
  tint: { label: 'Colour variation', category: 'Adjust', icon: 'palette', blurb: 'Large-scale hue & value drift', swatch: '#a08a70',
    params: R({ colorA: '#b5a28c', colorB: '#8f9aa6', variation: 0.5, varScale: 900, blend: 2, edge: 0, rules: { noise: { on: true, scale: 1400, threshold: 0.5, contrast: 1.0 } } }) },
  dirtCavity: { label: 'Cavity dirt', category: 'Adjust', icon: 'circle-dashed', blurb: 'Grime collected in concave pockets', swatch: '#4b3f33',
    params: R({ colorA: '#b39d85', colorB: '#a08870', variation: 0.3, blend: 1, detail: 1, rules: { curvature: rule(true, -40, -1.5, 1.5) } }) },
};

export const TEXTURE_CATEGORIES = [
  { id: 'Rock', icon: 'mountain', note: 'Bedrock, cliffs and strata' },
  { id: 'Soil & sediment', icon: 'shovel', note: 'Loose material moved by erosion' },
  { id: 'Vegetation', icon: 'sprout', note: 'Grass, forest and moss' },
  { id: 'Snow & water', icon: 'snowflake', note: 'Snow cover and wet ground' },
  { id: 'Adjust', icon: 'palette', note: 'Tints and grime' },
];

function deepMerge(a, b) {
  const o = Array.isArray(a) ? [...a] : { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && a && typeof a[k] === 'object') o[k] = deepMerge(a[k], v);
    else o[k] = v;
  }
  return o;
}

export function textureDefaults(type) {
  const t = TEXTURE_TYPES[type] || TEXTURE_TYPES.base;
  const p = deepMerge(baseParams(), t.params);
  const blend = p.blend ?? 0; delete p.blend;
  return { params: p, blend };
}

export function makeTextureLayer(type, overrides = {}) {
  const t = TEXTURE_TYPES[type] || TEXTURE_TYPES.base;
  const d = textureDefaults(type);
  return {
    id: newId('m'), type, name: overrides.name || t.label, enabled: true,
    params: deepMerge(d.params, overrides.params || {}),
    blend: { mode: d.blend, opacity: 1, invert: false, ...(overrides.blend || {}) },
  };
}

// Inspector schema for texture layers (shared by every preset).
export const TEXTURE_SCHEMA = {
  cards: [
    { id: 'Material', icon: 'palette', metric: 'roughness', note: 'Albedo and microsurface' },
    { id: 'Placement', icon: 'scan-line', ui: 'rules', note: 'Where this material appears' },
    { id: 'Breakup', icon: 'sparkles', metric: 'coverage', note: 'Coverage and edge noise' },
    { id: 'Strata', icon: 'layers-3', switch: 'strataOn', note: 'Sedimentary banding' },
  ],
  switches: [{ key: 'strataOn', label: 'Strata', icon: 'layers-3' }],
  params: {
    colorA: { label: 'Primary colour', type: 'color', card: 'Material' },
    colorB: { label: 'Secondary colour', type: 'color', card: 'Material' },
    variation: { label: 'Secondary amount', type: 'float', min: 0, max: 1, step: 0.01, unit: '%', card: 'Material' },
    varScale: { label: 'Variation size', type: 'float', min: 2, max: 3000, step: 1, unit: 'm', card: 'Material', curve: 'log' },
    roughness: { label: 'Roughness', type: 'float', min: 0.05, max: 1, step: 0.01, unit: '', card: 'Material' },
    detail: { label: 'Surface detail', type: 'enum', options: DETAIL_TYPES, card: 'Material' },
    detailStrength: { label: 'Detail strength', type: 'float', min: 0, max: 1.5, step: 0.01, unit: '×', card: 'Material' },
    wetness: { label: 'Wetness', type: 'float', min: 0, max: 1, step: 0.01, unit: '%', card: 'Material', showIf: (l) => l.blend.mode === 4 },
    coverage: { label: 'Coverage', type: 'float', min: 0, max: 1, step: 0.01, unit: '%', card: 'Breakup', hint: ['Less', 'More'] },
    sharpness: { label: 'Edge sharpness', type: 'float', min: 0.5, max: 8, step: 0.05, unit: '×', card: 'Breakup' },
    edge: { label: 'Edge noise', type: 'float', min: 0, max: 1, step: 0.01, unit: '%', card: 'Breakup' },
    edgeScale: { label: 'Edge noise size', type: 'float', min: 1, max: 400, step: 0.5, unit: 'm', card: 'Breakup', curve: 'log' },
    strataSpacing: { label: 'Band spacing', type: 'float', min: 0.5, max: 80, step: 0.1, unit: 'm', card: 'Strata', curve: 'log' },
    strataContrast: { label: 'Band contrast', type: 'float', min: 0, max: 1, step: 0.01, unit: '%', card: 'Strata' },
    strataColor: { label: 'Band colour', type: 'color', card: 'Strata' },
    strataTilt: { label: 'Dip', type: 'float', min: -0.5, max: 0.5, step: 0.005, unit: '', card: 'Strata' },
    strataWarp: { label: 'Warp', type: 'float', min: 0, max: 1, step: 0.01, unit: '%', card: 'Strata' },
  },
};
