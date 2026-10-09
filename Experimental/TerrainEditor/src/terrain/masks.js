// Mask registry: spatial 0..1 fields that gate where a layer (or an erosion
// pass) applies. Masks can use the terrain accumulated so far — coastlines,
// slope, strata bands — which is what makes stacks like "cliffs on steep
// faces" or "sediment in rifts" possible.

import { fbm, smoothstep, fract, clamp01 } from './noise.js';

const P = {
  strength: { key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, def: 1 },
};

export const masks = [
  { id: 'none', label: 'None', params: [], fn: () => 1 },
  {
    id: 'coastal', label: 'Coastal falloff',
    params: [
      { key: 'falloff', label: 'Coast falloff', min: 0.05, max: 1, step: 0.01, def: 0.45 },
      { key: 'edge', label: 'Map edge', min: 0.02, max: 0.6, step: 0.01, def: 0.18 },
      P.strength,
    ],
    fn: (ctx, x, y, p) => {
      // waterProx is 1 on water and decays inland over ~blur support cells.
      const coast = smoothstep(0, p.falloff, 1 - ctx.waterProx[y * ctx.size + x]);
      const edge = smoothstep(0, p.edge, ctx.edgeDist[y * ctx.size + x]);
      return Math.min(coast, edge) * p.strength;
    },
  },
  {
    id: 'mountain', label: 'Mountain ranges',
    params: [
      { key: 'scale', label: 'Range scale', min: 1, max: 8, step: 0.25, def: 2.5, unit: '×' },
      { key: 'threshold', label: 'Range threshold', min: 0.2, max: 0.8, step: 0.01, def: 0.5 },
      { key: 'softness', label: 'Falloff softness', min: 0.05, max: 0.4, step: 0.01, def: 0.15 },
      P.strength,
    ],
    fn: (ctx, x, y, p) => {
      const size = ctx.size;
      const m = fbm(x / size * p.scale, y / size * p.scale, { octaves: 2, seed: ctx.seed + 501 }) * 0.5 + 0.5;
      return smoothstep(p.threshold - p.softness, p.threshold + p.softness, m) * p.strength;
    },
  },
  {
    id: 'stratify', label: 'Stratify (stacks)',
    params: [
      { key: 'layers', label: 'Stacks', min: 4, max: 48, step: 1, def: 14 },
      { key: 'width', label: 'Band width', min: 0.15, max: 0.95, step: 0.01, def: 0.55 },
      { key: 'warp', label: 'Warp', min: 0, max: 8, step: 0.1, def: 2 },
      { key: 'angle', label: 'Angle', min: 0, max: 360, step: 1, def: 0, unit: '°' },
    ],
    fn: (ctx, x, y, p) => {
      const size = ctx.size;
      const a = p.angle * Math.PI / 180;
      const t = (x * Math.cos(a) + y * Math.sin(a)) / size * p.layers
        + fbm(x / size * 3 + 7.3, y / size * 3 + 3.9, { octaves: 2, seed: ctx.seed + 909 }) * p.warp;
      const f = fract(t);
      const band = smoothstep(1 - p.width, 1, 1 - Math.abs(f - 0.5) * 2);
      return band;
    },
    phase: (ctx, x, y, p) => {
      const size = ctx.size;
      const a = p.angle * Math.PI / 180;
      const t = (x * Math.cos(a) + y * Math.sin(a)) / size * p.layers
        + fbm(x / size * 3 + 7.3, y / size * 3 + 3.9, { octaves: 2, seed: ctx.seed + 909 }) * p.warp;
      return fract(t);
    },
  },
  {
    id: 'rifts', label: 'Rifts',
    params: [
      { key: 'scale', label: 'Rift scale', min: 2, max: 24, step: 0.5, def: 7, unit: '×' },
      { key: 'stretch', label: 'Stretch', min: 1, max: 16, step: 0.5, def: 5 },
      { key: 'threshold', label: 'Rift threshold', min: 0.3, max: 0.9, step: 0.01, def: 0.62 },
      { key: 'softness', label: 'Softness', min: 0.05, max: 0.3, step: 0.01, def: 0.12 },
      { key: 'angle', label: 'Angle', min: 0, max: 360, step: 1, def: 0, unit: '°' },
      P.strength,
    ],
    fn: (ctx, x, y, p) => {
      const size = ctx.size;
      const a = p.angle * Math.PI / 180;
      const ca = Math.cos(a), sa = Math.sin(a);
      const rx = (x * ca - y * sa), ry = (x * sa + y * ca);
      const n = fbm(rx / size * p.scale / p.stretch, ry / size * p.scale, { octaves: 2, seed: ctx.seed + 313 }) * 0.5 + 0.5;
      const r = 1 - Math.abs(n * 2 - 1);
      return smoothstep(p.threshold - p.softness, p.threshold + p.softness, r) * p.strength;
    },
  },
  {
    id: 'cliffs', label: 'Cliffs (steep faces)',
    params: [
      { key: 'slopeMin', label: 'Slope from', min: 0.05, max: 0.9, step: 0.01, def: 0.45 },
      { key: 'slopeMax', label: 'Slope to', min: 0.1, max: 1, step: 0.01, def: 0.75 },
      P.strength,
    ],
    fn: (ctx, x, y, p) => {
      const s = ctx.slopeN[y * ctx.size + x];
      return smoothstep(p.slopeMin, p.slopeMax, s) * p.strength;
    },
  },
];

export function maskById(id) {
  return masks.find((m) => m.id === id) || masks[0];
}

export function maskDefaults(id) {
  const mask = maskById(id);
  const out = {};
  for (const def of mask.params) out[def.key] = def.def;
  return out;
}

export function isStrataMask(id) { return id === 'stratify'; }
export function clampMask01(v) { return clamp01(v); }
