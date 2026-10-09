// Mask catalogue (Gaea-style masking). A mask is a 0–1 field evaluated on the surface a layer is about
// to act on. Terrain layers and texturing layers share this catalogue and the same combine rules.
//
// Parameter spec: { key, label, unit?, min, max, step, value }  or  { key, label, options:[...], value }

import { fbmField } from './grid.js';
import { smoothstep, clamp01 } from './noise.js';

const band = (x, lo, hi, f) => {
  const w = Math.max(1e-3, f);
  return smoothstep(lo - w, lo + w, x) * (1 - smoothstep(hi - w, hi + w, x));
};

// How a mask combines with the masks above it in the same stack.
export const MASK_BLEND_MODES = [
  { id: 'multiply', label: 'Multiply (AND)' }, { id: 'add', label: 'Add (OR)' }, { id: 'subtract', label: 'Subtract' },
  { id: 'max', label: 'Max' }, { id: 'min', label: 'Min' }, { id: 'replace', label: 'Replace' },
];

export const MASK_TYPES = {
  height: {
    name: 'Height', blurb: 'Elevation band',
    params: [
      { key: 'min', label: 'From', unit: 'm', min: -300, max: 1500, step: 1, value: 0 },
      { key: 'max', label: 'To', unit: 'm', min: -300, max: 1500, step: 1, value: 1000 },
      { key: 'feather', label: 'Feather', unit: 'm', min: 0, max: 400, step: 1, value: 30 },
    ],
    eval(ctx, p) {
      const h = ctx.height, out = new Float32Array(h.length);
      for (let i = 0; i < h.length; i++) out[i] = band(h[i], p.min, p.max, p.feather);
      return out;
    },
  },
  slope: {
    name: 'Slope', blurb: 'Steepness band',
    params: [
      { key: 'min', label: 'From', unit: '°', min: 0, max: 90, step: 1, value: 0 },
      { key: 'max', label: 'To', unit: '°', min: 0, max: 90, step: 1, value: 35 },
      { key: 'feather', label: 'Feather', unit: '°', min: 0, max: 30, step: 0.5, value: 6 },
    ],
    eval(ctx, p) {
      const s = ctx.slope(), out = new Float32Array(s.length);
      for (let i = 0; i < s.length; i++) out[i] = band(s[i], p.min, p.max, p.feather);
      return out;
    },
  },
  curvature: {
    name: 'Curvature', blurb: 'Crests or gullies',
    params: [
      { key: 'side', label: 'Side', options: ['convex', 'concave', 'both'], value: 'concave' },
      { key: 'threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, value: 0.15 },
      { key: 'feather', label: 'Feather', min: 0, max: 0.5, step: 0.01, value: 0.15 },
    ],
    eval(ctx, p) {
      const c = ctx.curv(), out = new Float32Array(c.length);
      for (let i = 0; i < c.length; i++) {
        const cv = p.side === 'concave' ? -c[i] : c[i];
        const convex = smoothstep(p.threshold - p.feather - 1e-3, p.threshold + p.feather, cv);
        out[i] = p.side === 'both' ? smoothstep(p.threshold - p.feather - 1e-3, p.threshold + p.feather, Math.abs(c[i])) : convex;
      }
      return out;
    },
  },
  flow: {
    name: 'Drainage', blurb: 'Where water collects',
    params: [
      { key: 'min', label: 'From', min: 0, max: 1, step: 0.01, value: 0.4 },
      { key: 'max', label: 'To', min: 0, max: 1, step: 0.01, value: 1 },
      { key: 'feather', label: 'Feather', min: 0, max: 0.5, step: 0.01, value: 0.1 },
    ],
    eval(ctx, p) {
      const f = ctx.flow(), out = new Float32Array(f.length);
      for (let i = 0; i < f.length; i++) out[i] = band(f[i], p.min, p.max, p.feather);
      return out;
    },
  },
  distance: {
    name: 'Distance to water', blurb: 'Near or far from water',
    params: [
      { key: 'side', label: 'Side', options: ['near', 'far'], value: 'near' },
      { key: 'distance', label: 'Distance', unit: 'm', min: 0, max: 400, step: 1, value: 30 },
      { key: 'feather', label: 'Feather', unit: 'm', min: 0, max: 200, step: 1, value: 15 },
    ],
    eval(ctx, p) {
      const d = ctx.dist(), out = new Float32Array(d.length);
      const f = Math.max(1e-3, p.feather);
      for (let i = 0; i < d.length; i++) {
        out[i] = p.side === 'near' ? 1 - smoothstep(p.distance - f, p.distance + f, d[i]) : smoothstep(p.distance - f, p.distance + f, d[i]);
      }
      return out;
    },
  },
  water: {
    name: 'Water', blurb: 'Rivers, lakes, sea',
    params: [
      { key: 'kind', label: 'Water', options: ['any', 'river', 'lake', 'sea'], value: 'any' },
      { key: 'feather', label: 'Feather', min: 0, max: 0.5, step: 0.01, value: 0.1 },
    ],
    eval(ctx, p) {
      const w = ctx.wet(), out = new Float32Array(w.length);
      const pick = p.kind === 'river' ? ctx.st.riverMask : p.kind === 'lake' ? ctx.st.lakeMask : p.kind === 'sea' ? ctx.st.seaMask : null;
      for (let i = 0; i < w.length; i++) {
        const v = pick ? Math.min(1, pick[i] * 4) * (w[i] > 0 ? 1 : 0) : w[i];
        out[i] = smoothstep(0.5 - p.feather - 1e-3, 0.5 + p.feather, v);
      }
      return out;
    },
  },
  hardness: {
    name: 'Rock hardness', blurb: 'Hard beds or soft beds',
    params: [
      { key: 'min', label: 'From', min: 0, max: 1, step: 0.01, value: 0.5 },
      { key: 'max', label: 'To', min: 0, max: 1, step: 0.01, value: 1 },
      { key: 'feather', label: 'Feather', min: 0, max: 0.5, step: 0.01, value: 0.08 },
    ],
    eval(ctx, p) {
      const h = ctx.st.hardness, out = new Float32Array(h.length);
      for (let i = 0; i < h.length; i++) out[i] = band(h[i], p.min, p.max, p.feather);
      return out;
    },
  },
  noise: {
    name: 'Noise', blurb: 'Fractal patches',
    params: [
      { key: 'scale', label: 'Scale', unit: 'm', min: 10, max: 2000, step: 5, value: 180 },
      { key: 'threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, value: 0.5 },
      { key: 'feather', label: 'Feather', min: 0, max: 0.5, step: 0.01, value: 0.12 },
      { key: 'seed', label: 'Seed', min: 1, max: 999, step: 1, value: 3 },
    ],
    eval(ctx, p) {
      const n = fbmField(ctx.N, ctx.size, p.seed, p.scale, 4);
      const out = new Float32Array(n.length);
      for (let i = 0; i < n.length; i++) out[i] = smoothstep(p.threshold - p.feather - 1e-3, p.threshold + p.feather, clamp01(n[i]));
      return out;
    },
  },
};

// Combine one mask into the running value. The first mask always starts the chain.
export function combineMask(acc, value, mode, opacity) {
  const o = clamp01(opacity);
  const n = acc.length;
  const identity = mode === 'multiply' || mode === 'min' ? 1 : 0;
  for (let i = 0; i < n; i++) {
    const v = identity + (value[i] - identity) * o;
    switch (mode) {
      case 'add': acc[i] = Math.min(1, acc[i] + v); break;
      case 'subtract': acc[i] = Math.max(0, acc[i] - v); break;
      case 'max': acc[i] = Math.max(acc[i], v); break;
      case 'min': acc[i] = Math.min(acc[i], v); break;
      case 'replace': acc[i] = v; break;
      default: acc[i] *= v;
    }
  }
  return acc;
}
