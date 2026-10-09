// Terrain stack evaluation: an ordered list of layers, each with an optional mask stack, an opacity and
// a blend mode. Generators add height; effects rewrite the surface and blend back through the mask.
// A worker keeps a snapshot after every layer, so editing layer k only re-runs layers k…n.

import { TERRAIN_TYPES } from './catalog-terrain.js';
import { MASK_TYPES, combineMask } from './catalog-mask.js';
import { slopeDegrees, curvatureNorm, drainage, distanceTo, wetMask, wetDepth01 } from './grid.js';
import { NO_WATER } from './routing.js';

const CHANNELS = ['height', 'hardness', 'sediment', 'outcrop', 'riverMask', 'lakeMask', 'seaMask'];

export function createState(world) {
  const N = world.resolution, total = N * N;
  return {
    N, size: world.size, cell: world.size / (N - 1), sea: -Infinity,
    height: new Float32Array(total),
    hardness: new Float32Array(total).fill(0.5),
    sediment: new Float32Array(total),
    outcrop: new Float32Array(total),
    water: new Float32Array(total).fill(NO_WATER),
    riverMask: new Float32Array(total),
    lakeMask: new Float32Array(total),
    seaMask: new Float32Array(total),
  };
}

export function cloneState(st) {
  const out = { ...st };
  for (const k of [...CHANNELS, 'water']) out[k] = st[k].slice();
  return out;
}

// Typed parameter resolution: clamps numbers, validates options, falls back to defaults.
export function resolveParams(specs, values = {}) {
  const out = {};
  for (const s of specs) {
    const v = values[s.key];
    if (s.options) { out[s.key] = s.options.includes(v) ? v : s.value; continue; }
    const n = typeof v === 'number' ? v : Number(v);
    out[s.key] = Number.isFinite(n) ? Math.min(s.max, Math.max(s.min, n)) : s.value;
  }
  return out;
}

export function defaultParams(specs) {
  const o = {};
  for (const s of specs) o[s.key] = s.value;
  return o;
}

let idCounter = 0;
export const newId = (prefix) => `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export function makeTerrainLayer(type) {
  const def = TERRAIN_TYPES[type];
  return { id: newId('t'), type, enabled: true, opacity: 1, blend: def.kind === 'generator' ? 'add' : 'normal', params: defaultParams(def.params), masks: [] };
}

export function makeMask(type, blend = 'multiply') {
  const def = MASK_TYPES[type];
  return { id: newId('m'), type, enabled: true, invert: false, opacity: 1, blend, params: defaultParams(def.params) };
}

// Derived maps for one stage of evaluation. Built lazily and reused by every mask of the same layer.
export function makeContext(st) {
  const memo = new Map();
  const get = (k, f) => { if (!memo.has(k)) memo.set(k, f()); return memo.get(k); };
  const N = st.N, cell = st.cell;
  return {
    st, N, cell, size: st.size, height: st.height,
    slope: () => get('slope', () => slopeDegrees(st.height, N, cell)),
    curv: () => get('curv', () => curvatureNorm(st.height, N, cell)),
    flow: () => get('flow', () => drainage(st.height, N, cell, st.sea).flowN),
    drain: () => get('drain', () => drainage(st.height, N, cell, st.sea)),
    dist: () => get('dist', () => distanceTo(wetMask(st.water, st.height), N, cell)),
    wet: () => get('wet', () => wetDepth01(st.water, st.height)),
  };
}

// Mask stack → one alpha field (or a scalar when there are no active masks).
export function maskAlpha(masks, ctx) {
  let acc = null;
  for (const m of masks || []) {
    if (m.enabled === false) continue; // hand-written masks may omit the flag; absent means on
    const def = MASK_TYPES[m.type];
    if (!def) continue;
    const p = resolveParams(def.params, m.params);
    const v = def.eval(ctx, p);
    if (m.invert) for (let i = 0; i < v.length; i++) v[i] = 1 - v[i];
    const o = Math.min(1, Math.max(0, m.opacity ?? 1));
    if (!acc) {
      acc = new Float32Array(v.length);
      for (let i = 0; i < v.length; i++) acc[i] = 1 - o * (1 - v[i]);
    } else {
      combineMask(acc, v, m.blend || 'multiply', o);
    }
  }
  return acc;
}

function snapshot(st) {
  const snap = { sea: st.sea, water: st.water.slice() };
  for (const k of CHANNELS) snap[k] = st[k].slice();
  return snap;
}

// Effects rewrite the channels; the layer blend decides how the new height lands on the old one:
// normal mixes by weight, min keeps only the cut, max keeps only the fill. Other channels always mix.
function blendEffect(st, prev, alpha, scalar, mode = 'normal') {
  const total = st.height.length;
  if (!alpha && scalar >= 1 && mode === 'normal') return;
  for (const k of CHANNELS) {
    const cur = st[k], pv = prev[k];
    for (let i = 0; i < total; i++) {
      const w = (alpha ? alpha[i] : 1) * scalar;
      let target = cur[i];
      if (k === 'height' && mode !== 'normal') target = mode === 'min' ? Math.min(pv[i], cur[i]) : Math.max(pv[i], cur[i]);
      if (w < 1 || target !== cur[i]) cur[i] = pv[i] + (target - pv[i]) * w;
    }
  }
  // water is a surface, not a height: it switches rather than mixes
  for (let i = 0; i < total; i++) {
    const w = (alpha ? alpha[i] : 1) * scalar;
    if (w < 0.5) st.water[i] = prev.water[i];
  }
}

// Run one layer on the state (in place). Returns timing info.
export function runLayer(st, layer) {
  const def = TERRAIN_TYPES[layer.type];
  if (!def || !layer.enabled) return null;
  const t0 = performance.now();
  const p = resolveParams(def.params, layer.params);
  const ctx = makeContext(st);
  const alpha = maskAlpha(layer.masks, ctx);
  const scalar = Math.min(1, Math.max(0, layer.opacity ?? 1));
  if (def.kind === 'generator') {
    const delta = def.run(st, p, ctx);
    const sign = layer.blend === 'subtract' ? -1 : 1;
    for (let i = 0; i < st.height.length; i++) {
      const w = (alpha ? alpha[i] : 1) * scalar;
      st.height[i] += sign * delta[i] * w;
    }
  } else {
    const prev = snapshot(st);
    def.run(st, p, ctx);
    blendEffect(st, prev, alpha, scalar, layer.blend || 'normal');
  }
  return { id: layer.id, type: layer.type, ms: performance.now() - t0 };
}

// Layer identity for the cache: everything that changes the result, nothing that does not.
export function layerKey(layer) {
  const def = TERRAIN_TYPES[layer.type];
  if (!def) return 'unknown';
  return JSON.stringify([
    layer.type, layer.enabled, layer.opacity, layer.blend, resolveParams(def.params, layer.params),
    (layer.masks || []).map((m) => {
      const md = MASK_TYPES[m.type];
      return md ? [m.type, m.enabled, m.invert, m.opacity, m.blend, resolveParams(md.params, m.params)] : 'x';
    }),
  ]);
}

export function worldKey(world) {
  return `${world.size}|${world.resolution}|${world.seed ?? 0}`;
}

// Full evaluation without a cache.
export function evaluateTerrain(world, layers, onLayer = () => {}) {
  const st = createState(world);
  const timings = [];
  layers.forEach((layer, i) => {
    onLayer(i, layers.length, layer);
    const t = runLayer(st, layer);
    if (t) timings.push(t);
  });
  return { state: st, timings };
}

// Incremental evaluation. `cache` = { world, entries[i] = { key, state } } where entries[i] is the state
// after layers[0..i]. The longest unchanged prefix is reused.
export function createTerrainCache() {
  return { world: null, entries: [] };
}

export function evaluateTerrainCached(world, layers, cache, onLayer = () => {}) {
  const wk = worldKey(world);
  if (cache.world !== wk) { cache.world = wk; cache.entries = []; }
  const keep = world.resolution <= 320;
  let k = 0;
  while (k < layers.length && k < cache.entries.length && cache.entries[k].key === layerKey(layers[k])) k++;
  while (k > 0 && !cache.entries[k - 1].state) k--;
  cache.entries.length = k;
  let st = k > 0 ? cloneState(cache.entries[k - 1].state) : createState(world);
  const timings = [];
  for (let i = k; i < layers.length; i++) {
    onLayer(i, layers.length, layers[i]);
    const t = runLayer(st, layers[i]);
    if (t) timings.push(t);
    cache.entries[i] = { key: layerKey(layers[i]), state: keep || i === layers.length - 1 ? cloneState(st) : null };
  }
  if (layers.length === 0) st = createState(world);
  return { state: st, timings, reused: k };
}
