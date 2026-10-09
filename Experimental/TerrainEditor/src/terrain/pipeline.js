// Layer stack pipeline: evaluates the ordered layer list into a heightmap
// (meters) plus the derived channels the satmap paints from — rivers, sediment
// and strata. Runs inside the Web Worker during editing and inside Node for
// the check script.

import { generatorById, generatorDefaults } from './generators.js';
import { maskById, maskDefaults } from './masks.js';
import { erosionById, computeSlopeN, computeFlow, boxBlur } from './erosion.js';
import { clamp01 } from './noise.js';

let uidCounter = 1;
export function uid(prefix = 'layer') { return `${prefix}-${uidCounter++}`; }

export function shapeLayer(name, generator, genParams = {}, mask = 'none', maskParams = {}, blend = 'add', opacity = 1) {
  return {
    id: uid('shape'), name, kind: 'shape', enabled: true,
    generator, genParams: { ...generatorDefaults(generator), ...genParams },
    mask, maskParams: { ...maskDefaults(mask), ...maskParams },
    blend, opacity,
  };
}

export function erosionLayer(name, type, eroParams = {}, driver = 'perlin', driverParams = {}, mask = 'none', maskParams = {}, opacity = 1, intensity = 1) {
  return {
    id: uid('ero'), name, kind: 'erosion', enabled: true, erosionType: type,
    eroParams: { ...erosionById(type).defaults, ...eroParams },
    driver, driverParams: { ...generatorDefaults(driver), ...driverParams },
    mask, maskParams: { ...maskDefaults(mask), ...maskParams },
    opacity, intensity,
  };
}

export const blendModes = [
  { id: 'add', label: 'Add' },
  { id: 'subtract', label: 'Subtract' },
  { id: 'max', label: 'Max' },
  { id: 'min', label: 'Min' },
  { id: 'replace', label: 'Replace' },
];

// ---------------------------------------------------------------- evaluation

function extent(h) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < h.length; i++) {
    if (h[i] < min) min = h[i];
    if (h[i] > max) max = h[i];
  }
  return { min, max };
}

function edgeDistanceField(size) {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    out[y * size + x] = Math.min(x, y, size - 1 - x, size - 1 - y);
  }
  let max = 1;
  for (let i = 0; i < out.length; i++) if (out[i] > max) max = out[i];
  for (let i = 0; i < out.length; i++) out[i] /= max;
  return out;
}

// Per-layer mask context derived from the terrain accumulated so far.
export function buildMaskContext(h, size, waterLevel, seed, edgeCache) {
  const { min, max } = extent(h);
  const range = (max - min) || 1;
  const heightN = new Float32Array(size * size);
  for (let i = 0; i < heightN.length; i++) heightN[i] = (h[i] - min) / range;
  const slopeN = computeSlopeN(heightN, size);
  const waterN = clamp01((waterLevel - min) / range);
  const water = new Float32Array(size * size);
  for (let i = 0; i < water.length; i++) water[i] = heightN[i] < waterN ? 1 : 0;
  // distance-to-water approximation: repeated box blur of the water mask
  let prox = water;
  const blurRadius = Math.max(2, Math.round(size / 14));
  for (let k = 0; k < 3; k++) prox = boxBlur(prox, size, blurRadius);
  let pmax = 1e-9;
  for (let i = 0; i < prox.length; i++) if (prox[i] > pmax) pmax = prox[i];
  for (let i = 0; i < prox.length; i++) prox[i] /= pmax;
  return {
    size, seed, min, max, range, heightN, slopeN, waterProx: prox,
    edgeDist: edgeCache || edgeDistanceField(size),
  };
}

export function evalGeneratorField(generatorId, genParams, ctx, seedOffset = 0) {
  const { size } = ctx;
  const gen = generatorById(generatorId);
  const p = { ...genParams, _size: size };
  const seed = (ctx.seed ^ (seedOffset | 0)) || 1;
  const field = new Float32Array(size * size);
  let phase = null;
  if (gen.phase) phase = new Float32Array(size * size);
  const scale = p.scale ?? 8;
  for (let y = 0; y < size; y++) {
    const v = y / size * scale;
    for (let x = 0; x < size; x++) {
      const u = x / size * scale;
      const i = y * size + x;
      if (phase) {
        field[i] = gen.fn(u, v, p, seed, x, y);
        phase[i] = gen.phase(u, v, p, seed, x, y);
      } else {
        field[i] = gen.fn(u, v, p, seed, x, y);
      }
    }
  }
  return { field, phase };
}

export function evalMaskField(maskId, maskParams, ctx) {
  const { size } = ctx;
  const mask = maskById(maskId);
  const p = { ...maskParams };
  const out = new Float32Array(size * size);
  let phase = null;
  if (mask.phase) phase = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    out[i] = mask.fn(ctx, x, y, p);
    if (phase) phase[i] = mask.phase(ctx, x, y, p);
  }
  return { mask: out, phase };
}

function applyShapeBlend(h, contrib, mask, layer) {
  const { blend, opacity } = layer;
  for (let i = 0; i < h.length; i++) {
    const c = contrib[i] * mask[i] * opacity;
    switch (blend) {
      case 'subtract': h[i] -= c; break;
      case 'max': h[i] = Math.max(h[i], c); break;
      case 'min': h[i] = Math.min(h[i], c); break;
      case 'replace': h[i] = c; break;
      default: h[i] += c; break;
    }
  }
}

// ---------------------------------------------------------------- pipeline

export function computeTerrain({ layers, size = 256, seed = 1337, waterLevel = 0, budget = 1, onProgress }) {
  const n = size * size;
  const h = new Float32Array(n); // meters
  const rivers = new Float32Array(n);
  const sediment = new Float32Array(n);
  const strata = new Float32Array(n);
  const strataPhase = new Float32Array(n);
  const edgeCache = edgeDistanceField(size);
  const totalLayers = Math.max(1, layers.length);

  layers.forEach((layer, li) => {
    if (!layer.enabled) return;
    const ctx = buildMaskContext(h, size, waterLevel, seed, edgeCache);

    if (layer.kind === 'shape') {
      const gen = evalGeneratorField(layer.generator, layer.genParams, ctx, (li + 1) * 7919);
      const m = layer.mask === 'none'
        ? null
        : evalMaskField(layer.mask, layer.maskParams, ctx);
      const maskArr = m ? m.mask : null;
      const amplitude = layer.genParams.amplitude ?? 600;
      const contrib = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        contrib[i] = gen.field[i] * amplitude;
      }
      applyShapeBlend(h, contrib, maskArr || ones(n), layer);
      if (gen.phase || (m && m.phase)) {
        for (let i = 0; i < n; i++) {
          const s = (maskArr ? maskArr[i] : 1) * layer.opacity;
          if (s > strata[i]) {
            strata[i] = s;
            strataPhase[i] = (gen.phase ? gen.phase[i] : m.phase[i]);
          }
        }
      }
    } else {
      // erosion pass over the terrain accumulated below this layer
      const { min, max } = extent(h);
      const range = (max - min) || 1;
      const hN = new Float32Array(n);
      for (let i = 0; i < n; i++) hN[i] = (h[i] - min) / range;
      const type = erosionById(layer.erosionType);
      const params = { ...type.defaults, ...layer.eroParams };
      if (budget < 1) {
        if ('droplets' in params) params.droplets = Math.max(2000, Math.round(params.droplets * budget));
        if ('iterations' in params) params.iterations = Math.max(3, Math.round(params.iterations * budget));
      }
      const res = type.run(hN, size, params, (seed ^ ((li + 1) * 104729)) || 1,
        onProgress ? (p) => onProgress((li + p) / totalLayers, layer.name) : undefined);
      // intensity field: driver generator × mask × opacity × intensity
      const inten = new Float32Array(n).fill(layer.intensity * layer.opacity);
      if (layer.driver && layer.driver !== 'none') {
        const drv = evalGeneratorField(layer.driver, layer.driverParams, ctx, (li + 1) * 31337);
        const m = layer.mask === 'none' ? null : evalMaskField(layer.mask, layer.maskParams, ctx);
        for (let i = 0; i < n; i++) {
          const g = (drv.field[i] + 1) * 0.5;
          inten[i] = g * (m ? m.mask[i] : 1) * layer.intensity * layer.opacity;
        }
      } else if (layer.mask !== 'none') {
        const m = evalMaskField(layer.mask, layer.maskParams, ctx);
        for (let i = 0; i < n; i++) inten[i] = m.mask[i] * layer.intensity * layer.opacity;
      }
      for (let i = 0; i < n; i++) {
        h[i] = h[i] + (res.height[i] - hN[i]) * range * inten[i];
        if (res.sediment) sediment[i] = Math.max(sediment[i], res.sediment[i]);
        if (res.flux) rivers[i] = Math.max(rivers[i], res.flux[i]);
      }
    }
    if (onProgress) onProgress((li + 1) / totalLayers, layer.name);
  });

  // ------------------------------------------------------------ final channels
  const { min, max } = extent(h);
  const range = (max - min) || 1;
  const heightN = new Float32Array(n);
  for (let i = 0; i < n; i++) heightN[i] = (h[i] - min) / range;
  const slopeN = computeSlopeN(heightN, size);
  const waterN = clamp01((waterLevel - min) / range);

  // rivers: combine erosion flux with a D8 accumulation on the final terrain
  const { accum, amax } = computeFlow(heightN, size, seed ^ 0x5f3759df);
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt(accum[i] / amax);
    if (r > rivers[i]) rivers[i] = r;
  }
  for (let i = 0; i < n; i++) {
    rivers[i] = clamp01(rivers[i]);
    sediment[i] = clamp01(sediment[i]);
  }

  let mean = 0;
  for (let i = 0; i < n; i++) mean += h[i];
  mean /= n;

  return {
    height: h, heightN, slopeN, rivers, sediment, strata, strataPhase,
    waterN, min, max, mean, size,
  };
}

let onesCache = null;
function ones(n) {
  if (!onesCache || onesCache.length !== n) onesCache = new Float32Array(n).fill(1);
  return onesCache;
}

// Small helper used by the inspector's layer preview: the masked contribution
// of a single shape layer against a context heightfield.
export function previewShapeLayer(layer, ctx) {
  const gen = evalGeneratorField(layer.generator, layer.genParams, ctx, 7);
  const m = layer.mask === 'none' ? null : evalMaskField(layer.mask, layer.maskParams, ctx);
  const amplitude = layer.genParams.amplitude ?? 600;
  const out = new Float32Array(ctx.size * ctx.size);
  for (let i = 0; i < out.length; i++) {
    out[i] = gen.field[i] * amplitude * (m ? m.mask[i] : 1) * layer.opacity;
  }
  return out;
}
