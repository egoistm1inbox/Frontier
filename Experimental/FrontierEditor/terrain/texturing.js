// Texturing stack evaluation. Paints every texel with the layers in order: each layer generates a
// colour and roughness field, the mask stack (shared with the terrain stack) decides where it lands,
// and the layer's blend mode combines it with what is underneath.

import { makeContext, maskAlpha, resolveParams, defaultParams, makeMask, newId } from './stack.js';
import { TEXTURE_TYPES } from './catalog-texture.js';
import { MASK_TYPES } from './catalog-mask.js';
import { fbmField } from './grid.js';

export function makeTextureLayer(type) {
  const def = TEXTURE_TYPES[type];
  const masks = (def.defaultMasks || []).map((m) => {
    const mask = makeMask(m.type, m.blend || 'multiply');
    mask.params = { ...defaultParams(MASK_TYPES[m.type].params), ...m.params };
    return mask;
  });
  return { id: newId('x'), type, enabled: true, opacity: 1, blend: def.blend, params: defaultParams(def.params), masks };
}

function blendValue(b, c, mode) {
  switch (mode) {
    case 'multiply': return b * c;
    case 'overlay': return b < 0.5 ? 2 * b * c : 1 - 2 * (1 - b) * (1 - c);
    case 'screen': return 1 - (1 - b) * (1 - c);
    case 'add': return Math.min(1, b + c);
    case 'darken': return Math.min(b, c);
    case 'lighten': return Math.max(b, c);
    default: return c;
  }
}

export function textureContext(st, ctx) {
  const N = st.N, total = N * N, cell = st.cell;
  const cache = new Map();
  const noise = (scale, seed) => {
    const k = `${Math.round(scale)}:${seed}`;
    if (!cache.has(k)) cache.set(k, fbmField(N, st.size, seed, scale, 4));
    return cache.get(k);
  };
  let lo = Infinity, hi = -Infinity, sMax = 0;
  for (let i = 0; i < total; i++) {
    if (st.height[i] < lo) lo = st.height[i];
    if (st.height[i] > hi) hi = st.height[i];
    if (st.sediment[i] > sMax) sMax = st.sediment[i];
  }
  const alt = new Float32Array(total), sediment = new Float32Array(total);
  const span = Math.max(1e-3, hi - lo);
  for (let i = 0; i < total; i++) {
    alt[i] = (st.height[i] - lo) / span;
    sediment[i] = sMax > 0 ? st.sediment[i] / sMax : 0;
  }
  return {
    N, size: st.size, cell, height: st.height, slope: ctx.slope(), curv: ctx.curv(), flow: ctx.flow(),
    hard: st.hardness, wetN: ctx.wet(), river: st.riverMask, lake: st.lakeMask, sea: st.seaMask,
    sediment, alt, noise, grain: noise(Math.max(3, cell * 3), 5),
  };
}

// layers → { r, g, b, rough } (Float32Array, 0–1 per texel, index = j * N + i)
export function evaluateTexturing(st, layers, onLayer = () => {}) {
  const total = st.N * st.N;
  const ctx = makeContext(st);
  const tc = textureContext(st, ctx);
  const out = {
    r: new Float32Array(total).fill(0.5), g: new Float32Array(total).fill(0.5),
    b: new Float32Array(total).fill(0.5), rough: new Float32Array(total).fill(0.8),
  };
  const timings = [];
  layers.forEach((layer, index) => {
    if (!layer.enabled) return;
    const def = TEXTURE_TYPES[layer.type];
    if (!def) return;
    onLayer(index, layers.length, layer);
    const t0 = performance.now();
    const p = resolveParams(def.params, layer.params);
    const L = { r: new Float32Array(total), g: new Float32Array(total), b: new Float32Array(total), rough: new Float32Array(total) };
    def.paint(tc, p, L);
    const alpha = maskAlpha(layer.masks, ctx);
    const op = Math.min(1, Math.max(0, layer.opacity ?? 1));
    const mode = layer.blend || def.blend || 'normal';
    for (let i = 0; i < total; i++) {
      const w = (alpha ? alpha[i] : 1) * op;
      if (w <= 0) continue;
      out.r[i] += (blendValue(out.r[i], L.r[i], mode) - out.r[i]) * w;
      out.g[i] += (blendValue(out.g[i], L.g[i], mode) - out.g[i]) * w;
      out.b[i] += (blendValue(out.b[i], L.b[i], mode) - out.b[i]) * w;
      // detail (multiply) layers scale roughness rather than replacing it, so a neutral cavity pass stays neutral
      out.rough[i] = mode === 'multiply'
        ? out.rough[i] * (1 - w + w * L.rough[i])
        : out.rough[i] + (L.rough[i] - out.rough[i]) * w;
    }
    timings.push({ id: layer.id, type: layer.type, ms: performance.now() - t0 });
  });
  return { out, timings };
}

// 8-bit RGBA for a texture (sRGB-style values, as painted)
export function toRGBA8(colour) {
  const total = colour.r.length;
  const px = new Uint8ClampedArray(total * 4);
  for (let i = 0; i < total; i++) {
    px[i * 4] = colour.r[i] * 255 + 0.5;
    px[i * 4 + 1] = colour.g[i] * 255 + 0.5;
    px[i * 4 + 2] = colour.b[i] * 255 + 0.5;
    px[i * 4 + 3] = 255;
  }
  return px;
}
