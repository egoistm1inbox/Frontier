// RoadForge — procedural surface layer stacks.
//
// Every road surface is textured by a stack of procedural layers evaluated on
// the GPU (see gpu/texbake.js). This file owns the authoring model that the
// inspector drives: types, parameter metadata, defaults and presets.

export const BLEND = ['Normal', 'Multiply', 'Overlay', 'Add', 'Screen', 'Soft light'];

export const LAYER_TYPES = {
  base: {
    id: 0, name: 'Base surface', icon: 'layers',
    params: [
      { k: 'rough', label: 'Roughness', min: 0.02, max: 1, step: 0.01, def: 0.82 },
      { k: 'tint', label: 'Tone', min: 0.2, max: 2.2, step: 0.01, def: 1 },
    ],
    color: [0.085, 0.086, 0.092],
  },
  grain: {
    id: 1, name: 'Grain', icon: 'grain',
    params: [
      { k: 'freq', label: 'Frequency', min: 2, max: 160, step: 1, def: 48 },
      { k: 'contrast', label: 'Contrast', min: 0, max: 1, step: 0.01, def: 0.42 },
      { k: 'height', label: 'Relief', min: 0, max: 1, step: 0.01, def: 0.22 },
      { k: 'rough', label: 'Roughness var', min: 0, max: 1, step: 0.01, def: 0.3 },
    ],
    color: [0.5, 0.5, 0.5],
  },
  aggregate: {
    id: 2, name: 'Aggregate chips', icon: 'aggregate',
    params: [
      { k: 'density', label: 'Chip density', min: 4, max: 90, step: 1, def: 34 },
      { k: 'variation', label: 'Size variation', min: 0, max: 1, step: 0.01, def: 0.55 },
      { k: 'height', label: 'Protrusion', min: 0, max: 1, step: 0.01, def: 0.45 },
      { k: 'exposure', label: 'Exposure', min: 0, max: 1, step: 0.01, def: 0.35 },
    ],
    color: [0.34, 0.33, 0.31],
  },
  cracks: {
    id: 3, name: 'Cracking', icon: 'cracks',
    params: [
      { k: 'density', label: 'Density', min: 1, max: 24, step: 0.5, def: 7 },
      { k: 'width', label: 'Width', min: 0.005, max: 0.14, step: 0.005, def: 0.032 },
      { k: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, def: 0.6 },
      { k: 'branch', label: 'Alligatoring', min: 0, max: 1, step: 0.01, def: 0.35 },
    ],
    color: [0.016, 0.016, 0.018],
  },
  patch: {
    id: 4, name: 'Repair patches', icon: 'patch',
    params: [
      { k: 'count', label: 'Count', min: 1, max: 16, step: 1, def: 5 },
      { k: 'size', label: 'Size', min: 0.03, max: 0.5, step: 0.01, def: 0.17 },
      { k: 'tone', label: 'Tone shift', min: -1, max: 1, step: 0.01, def: -0.35 },
      { k: 'edge', label: 'Edge seam', min: 0, max: 1, step: 0.01, def: 0.6 },
    ],
    color: [0.045, 0.045, 0.048],
  },
  oil: {
    id: 5, name: 'Oil & fluids', icon: 'oil',
    params: [
      { k: 'count', label: 'Spots', min: 1, max: 24, step: 1, def: 9 },
      { k: 'size', label: 'Spread', min: 0.01, max: 0.3, step: 0.005, def: 0.07 },
      { k: 'darkness', label: 'Darkness', min: 0, max: 1, step: 0.01, def: 0.6 },
      { k: 'gloss', label: 'Gloss', min: 0, max: 1, step: 0.01, def: 0.65 },
    ],
    color: [0.012, 0.011, 0.010],
  },
  paving: {
    id: 6, name: 'Paving pattern', icon: 'paving',
    params: [
      { k: 'mode', label: 'Bond', min: 0, max: 7, step: 1, def: 0, enum: ['Running bond', 'Herringbone', 'Basketweave', 'Hexagonal', 'Large slab', 'Granite setts', 'Tactile blister', 'Stack bond'] },
      { k: 'size', label: 'Unit size', min: 2, max: 26, step: 1, def: 7 },
      { k: 'grout', label: 'Joint width', min: 0.01, max: 0.22, step: 0.005, def: 0.055 },
      { k: 'bevel', label: 'Bevel', min: 0, max: 1, step: 0.01, def: 0.42 },
      { k: 'variation', label: 'Colour variation', min: 0, max: 1, step: 0.01, def: 0.35 },
      { k: 'wear', label: 'Edge wear', min: 0, max: 1, step: 0.01, def: 0.3 },
    ],
    color: [0.22, 0.215, 0.205],
  },
  moss: {
    id: 7, name: 'Moss & dirt', icon: 'moss',
    params: [
      { k: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, def: 0.35 },
      { k: 'joint', label: 'Joint bias', min: 0, max: 1, step: 0.01, def: 0.75 },
      { k: 'scale', label: 'Scale', min: 1, max: 40, step: 1, def: 9 },
    ],
    color: [0.035, 0.055, 0.022],
  },
  stain: {
    id: 8, name: 'Weathering', icon: 'stain',
    params: [
      { k: 'scale', label: 'Scale', min: 0.5, max: 24, step: 0.5, def: 4 },
      { k: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, def: 0.4 },
      { k: 'contrast', label: 'Contrast', min: 0, max: 1, step: 0.01, def: 0.5 },
    ],
    color: [0.09, 0.088, 0.082],
  },
  gravel: {
    id: 9, name: 'Loose stone', icon: 'gravel',
    params: [
      { k: 'density', label: 'Density', min: 6, max: 90, step: 1, def: 40 },
      { k: 'size', label: 'Stone size', min: 0.1, max: 1, step: 0.01, def: 0.6 },
      { k: 'height', label: 'Relief', min: 0, max: 1, step: 0.01, def: 0.7 },
    ],
    color: [0.14, 0.135, 0.125],
  },
  scratch: {
    id: 10, name: 'Brushed / scratched', icon: 'scratch',
    params: [
      { k: 'density', label: 'Density', min: 10, max: 400, step: 5, def: 140 },
      { k: 'angle', label: 'Angle', min: 0, max: 180, step: 1, def: 0 },
      { k: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, def: 0.4 },
    ],
    color: [0.4, 0.4, 0.42],
  },
  polish: {
    id: 11, name: 'Traffic polish', icon: 'polish',
    params: [
      { k: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, def: 0.5 },
      { k: 'width', label: 'Track width', min: 0.05, max: 1, step: 0.01, def: 0.4 },
    ],
    color: [0.1, 0.1, 0.1],
  },
};

let lid = 1;
export function makeLayer(type, over = {}) {
  const def = LAYER_TYPES[type];
  const params = {};
  for (const p of def.params) params[p.k] = p.def;
  return {
    id: `L${lid++}`,
    type,
    name: over.name || def.name,
    on: over.on !== false,
    opacity: over.opacity ?? 1,
    blend: over.blend ?? 0,
    color: over.color ? over.color.slice() : def.color.slice(),
    params: { ...params, ...(over.params || {}) },
  };
}

/** Default stacks per baked texture slot. */
export function defaultStacks() {
  return {
    asphalt: {
      slot: 0, name: 'Asphalt', scale: 4,
      layers: [
        makeLayer('base', { color: [0.070, 0.070, 0.076], params: { rough: 0.86, tint: 1 } }),
        makeLayer('aggregate', { opacity: 0.9, params: { density: 38, variation: 0.6, height: 0.5, exposure: 0.4 } }),
        makeLayer('grain', { blend: 5, opacity: 0.8, params: { freq: 90, contrast: 0.5, height: 0.25, rough: 0.4 } }),
        makeLayer('stain', { blend: 1, opacity: 0.55, params: { scale: 3, amount: 0.45, contrast: 0.45 } }),
        makeLayer('cracks', { opacity: 0.7, params: { density: 6, width: 0.028, depth: 0.65, branch: 0.4 } }),
        makeLayer('patch', { opacity: 0.6, params: { count: 4, size: 0.18, tone: -0.3, edge: 0.65 } }),
        makeLayer('oil', { opacity: 0.5, params: { count: 7, size: 0.06, darkness: 0.55, gloss: 0.6 } }),
      ],
    },
    paving: {
      slot: 1, name: 'Footway paving', scale: 2,
      layers: [
        makeLayer('base', { color: [0.215, 0.212, 0.203], params: { rough: 0.78, tint: 1 } }),
        makeLayer('paving', { params: { mode: 0, size: 7, grout: 0.05, bevel: 0.45, variation: 0.32, wear: 0.3 } }),
        makeLayer('grain', { blend: 5, opacity: 0.6, params: { freq: 120, contrast: 0.4, height: 0.12, rough: 0.3 } }),
        makeLayer('stain', { blend: 1, opacity: 0.4, params: { scale: 5, amount: 0.35, contrast: 0.45 } }),
        makeLayer('moss', { opacity: 0.55, params: { amount: 0.3, joint: 0.8, scale: 11 } }),
      ],
    },
    kerb: {
      slot: 2, name: 'Kerb stone', scale: 2,
      layers: [
        makeLayer('base', { color: [0.30, 0.295, 0.285], params: { rough: 0.7, tint: 1 } }),
        makeLayer('paving', { opacity: 0.85, params: { mode: 7, size: 3, grout: 0.045, bevel: 0.5, variation: 0.25, wear: 0.45 } }),
        makeLayer('grain', { blend: 5, opacity: 0.7, params: { freq: 150, contrast: 0.45, height: 0.18, rough: 0.35 } }),
        makeLayer('stain', { blend: 1, opacity: 0.5, params: { scale: 7, amount: 0.4, contrast: 0.5 } }),
      ],
    },
    concrete: {
      slot: 3, name: 'Concrete', scale: 2,
      layers: [
        makeLayer('base', { color: [0.235, 0.234, 0.228], params: { rough: 0.76, tint: 1 } }),
        makeLayer('grain', { blend: 5, opacity: 0.9, params: { freq: 70, contrast: 0.35, height: 0.14, rough: 0.35 } }),
        makeLayer('stain', { blend: 1, opacity: 0.6, params: { scale: 2.5, amount: 0.5, contrast: 0.55 } }),
        makeLayer('cracks', { opacity: 0.4, params: { density: 3, width: 0.018, depth: 0.4, branch: 0.1 } }),
      ],
    },
    grass: {
      slot: 4, name: 'Verge', scale: 3,
      layers: [
        makeLayer('base', { color: [0.055, 0.085, 0.035], params: { rough: 0.95, tint: 1 } }),
        makeLayer('grain', { blend: 5, opacity: 1, params: { freq: 150, contrast: 0.7, height: 0.4, rough: 0.2 } }),
        makeLayer('stain', { blend: 1, opacity: 0.7, color: [0.09, 0.08, 0.035], params: { scale: 6, amount: 0.55, contrast: 0.6 } }),
        makeLayer('gravel', { opacity: 0.25, params: { density: 60, size: 0.3, height: 0.3 } }),
      ],
    },
    gravel: {
      slot: 5, name: 'Ballast / gravel', scale: 3,
      layers: [
        makeLayer('base', { color: [0.105, 0.100, 0.094], params: { rough: 0.93, tint: 1 } }),
        makeLayer('gravel', { params: { density: 46, size: 0.68, height: 0.85 } }),
        makeLayer('grain', { blend: 5, opacity: 0.7, params: { freq: 110, contrast: 0.5, height: 0.25, rough: 0.3 } }),
        makeLayer('stain', { blend: 1, opacity: 0.45, params: { scale: 4, amount: 0.4, contrast: 0.5 } }),
      ],
    },
    setts: {
      slot: 6, name: 'Granite setts', scale: 3,
      layers: [
        makeLayer('base', { color: [0.115, 0.112, 0.108], params: { rough: 0.8, tint: 1 } }),
        makeLayer('paving', { params: { mode: 5, size: 11, grout: 0.09, bevel: 0.7, variation: 0.5, wear: 0.5 } }),
        makeLayer('grain', { blend: 5, opacity: 0.8, params: { freq: 170, contrast: 0.5, height: 0.2, rough: 0.35 } }),
        makeLayer('moss', { opacity: 0.6, params: { amount: 0.35, joint: 0.9, scale: 14 } }),
      ],
    },
    metal: {
      slot: 7, name: 'Metal & misc', scale: 2,
      layers: [
        makeLayer('base', { color: [0.38, 0.385, 0.39], params: { rough: 0.42, tint: 1 } }),
        makeLayer('scratch', { opacity: 0.6, params: { density: 180, angle: 0, depth: 0.35 } }),
        makeLayer('stain', { blend: 1, opacity: 0.35, color: [0.13, 0.07, 0.03], params: { scale: 6, amount: 0.4, contrast: 0.6 } }),
        makeLayer('grain', { blend: 5, opacity: 0.5, params: { freq: 200, contrast: 0.3, height: 0.08, rough: 0.25 } }),
      ],
    },
  };
}

export const STACK_ORDER = ['asphalt', 'paving', 'kerb', 'concrete', 'grass', 'gravel', 'setts', 'metal'];

export const LAYER_FLOATS = 16; // 4 x vec4

export function packStack(stack) {
  const live = stack.layers.filter((l) => l.on);
  const buf = new Float32Array(Math.max(1, live.length) * LAYER_FLOATS);
  live.forEach((l, i) => {
    const t = LAYER_TYPES[l.type];
    const o = i * LAYER_FLOATS;
    buf[o] = t.id;
    buf[o + 1] = l.blend;
    buf[o + 2] = l.opacity;
    buf[o + 3] = stack.scale;
    const ps = t.params;
    for (let k = 0; k < 8; k++) {
      buf[o + 4 + k] = ps[k] ? (l.params[ps[k].k] ?? ps[k].def) : 0;
    }
    buf[o + 12] = l.color[0];
    buf[o + 13] = l.color[1];
    buf[o + 14] = l.color[2];
    buf[o + 15] = 1;
  });
  return { buf, count: live.length };
}
