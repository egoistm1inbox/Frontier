// Layer evaluation. A layer takes the heights produced by the layers below it and returns new
// heights. Generators add or combine a field, operators reshape the heights, and erosion layers
// run a simulation over everything beneath them. Masks and opacity weight every layer per cell.

import { LayerKinds } from './specs.js';
import { createNoise } from './noise.js';
import { clamp, smoothstep, boxBlur, slopeDegrees, mix } from './grid.js';
import { createRandom } from './random.js';
import { runErosion } from './erosion/index.js';

// Typical standard deviation of the normalised fBm sum, used to bring it to about [-1, 1].
const FBM_SIGMA = 0.125;
const RIDGE_CENTRE = 0.6;

export function layerSeed(settings, layer) {
  return ((Math.imul(settings.seed | 0, 1000003) + Math.imul(layer.seed | 0, 7919)) >>> 0) || 1;
}

// Octaves finer than four cells per wavelength only add aliasing, so they are dropped.
function usefulOctaves(requested, frequency, size) {
  const finest = Math.floor(Math.log2((size - 1) / (4 * Math.max(frequency, 1e-3)))) + 1;
  return Math.max(1, Math.min(Math.round(requested), finest));
}

function fbm(noise, x, y, octaves, lacunarity, gain) {
  let sum = 0;
  let amplitude = 1;
  let norm = 0;
  let frequency = 1;
  for (let o = 0; o < octaves; o += 1) {
    sum += amplitude * noise(x * frequency, y * frequency);
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / norm;
}

function ridged(noise, x, y, octaves, lacunarity, gain, sharpness) {
  let sum = 0;
  let amplitude = 1;
  let norm = 0;
  let frequency = 1;
  let weight = 1;
  for (let o = 0; o < octaves; o += 1) {
    let signal = 1 - Math.abs(noise(x * frequency, y * frequency));
    signal = Math.pow(Math.max(signal, 0), sharpness);
    signal *= weight;
    weight = clamp(signal * 2, 0, 1);
    sum += signal * amplitude;
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / norm;
}

// Returns a field in [0, 1] for generator layers.
export function generateField(layer, ctx, seed) {
  const { size } = ctx;
  const total = size * size;
  const field = new Float32Array(total);
  const p = layer.params;
  const last = size - 1;

  if (layer.kind === 'fbm') {
    const base = createNoise(seed);
    const warpX = createNoise(seed + 101);
    const warpY = createNoise(seed + 202);
    const octaves = usefulOctaves(p.octaves, p.frequency, size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        let px = (x / last) * p.frequency;
        let py = (y / last) * p.frequency;
        if (p.warp > 0) {
          px += p.warp * fbm(warpX, px + 3.1, py + 1.7, 3, 2, 0.5) * 0.6;
          py += p.warp * fbm(warpY, px + 8.3, py + 2.8, 3, 2, 0.5) * 0.6;
        }
        const n = fbm(base, px, py, octaves, p.lacunarity, p.gain) / FBM_SIGMA;
        field[y * size + x] = clamp(0.5 + 0.22 * p.contrast * n, 0, 1);
      }
    }
    return field;
  }

  if (layer.kind === 'ridge') {
    const base = createNoise(seed + 7);
    const warpX = createNoise(seed + 303);
    const warpY = createNoise(seed + 404);
    const octaves = usefulOctaves(p.octaves, p.frequency, size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        let px = (x / last) * p.frequency;
        let py = (y / last) * p.frequency;
        if (p.warp > 0) {
          px += p.warp * fbm(warpX, px + 1.9, py + 4.4, 3, 2, 0.5) * 0.5;
          py += p.warp * fbm(warpY, px + 6.1, py + 0.7, 3, 2, 0.5) * 0.5;
        }
        const r = ridged(base, px, py, octaves, 2, p.gain, p.sharpness);
        field[y * size + x] = clamp((r - RIDGE_CENTRE) / (1 - RIDGE_CENTRE), 0, 1);
      }
    }
    return field;
  }

  if (layer.kind === 'island') {
    const coast = createNoise(seed + 13);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = (x / last) * 2 - 1;
        const dy = (y / last) * 2 - 1;
        const u = (x / last) * p.coastScale;
        const v = (y / last) * p.coastScale;
        const jitter = coast(u, v) * 0.25 * p.coastNoise;
        const radial = Math.hypot(dx, dy) * (1 + jitter);
        const t = clamp(radial / p.radius, 0, 1);
        const shore = clamp(1 - Math.pow(t, p.falloff), 0, 1);
        field[y * size + x] = smoothstep(0, 1, shore);
      }
    }
    return field;
  }

  field.fill(1);
  return field;
}

// Soft band between [low, high] with feathered edges of width `feather`.
function band(value, low, high, feather) {
  if (feather <= 1e-6) return value >= low && value <= high ? 1 : 0;
  const rise = smoothstep(low - feather, low, value);
  const fall = 1 - smoothstep(high, high + feather, value);
  return rise * fall;
}

// Per-cell weight = mask * opacity. Masks read the heights below the layer.
export function layerWeights(prev, layer, ctx) {
  const total = prev.length;
  const weights = new Float32Array(total);
  const mask = layer.mask;
  if (!mask || !mask.enabled) {
    weights.fill(layer.opacity);
    return weights;
  }
  const slope = slopeDegrees(prev, ctx.size, ctx.cellMetres, ctx.maxHeight);
  for (let i = 0; i < total; i += 1) {
    const altitude = prev[i] * ctx.maxHeight;
    let m = band(altitude, mask.minAltitude, mask.maxAltitude, mask.altitudeFeather);
    m *= band(slope[i], mask.minSlope, mask.maxSlope, mask.slopeFeather);
    if (mask.invert) m = 1 - m;
    weights[i] = m * layer.opacity;
  }
  return weights;
}

function combineGenerator(prev, field, weights, amplitude, mode, out) {
  for (let i = 0; i < prev.length; i += 1) {
    const w = weights[i];
    const f = field[i];
    const p = prev[i];
    const t = amplitude * f;
    let v;
    switch (mode) {
      case 'subtract':
        v = p - w * t;
        break;
      case 'multiply':
        v = p * (1 - w + w * f);
        break;
      case 'max':
        v = p + w * (Math.max(p, t) - p);
        break;
      case 'min':
        v = p + w * (Math.min(p, t) - p);
        break;
      case 'replace':
        v = p + w * (t - p);
        break;
      default:
        v = p + w * t;
    }
    out[i] = clamp(v, 0, 1);
  }
}

function applyOperator(prev, layer, ctx) {
  const { size, maxHeight } = ctx;
  const total = size * size;
  const p = layer.params;
  const out = new Float32Array(total);
  switch (layer.kind) {
    case 'terrace': {
      const r = 0.45 * (1 - p.sharpness);
      for (let i = 0; i < total; i += 1) {
        const s = clamp(prev[i], 0, 1) * p.steps;
        const base = Math.floor(s);
        const f = s - base;
        const riser = smoothstep(0.5 - r - 1e-4, 0.5 + r + 1e-4, f);
        out[i] = clamp((base + riser) / p.steps, 0, 1);
      }
      return out;
    }
    case 'smooth':
      return boxBlur(prev, size, p.radius, Math.round(p.passes));
    case 'levels': {
      const black = p.black / maxHeight;
      const white = p.white / maxHeight;
      const span = white - black;
      for (let i = 0; i < total; i += 1) {
        const t = span > 1e-6 ? clamp((prev[i] - black) / span, 0, 1) : prev[i] >= black ? 1 : 0;
        out[i] = Math.pow(t, p.gamma);
      }
      return out;
    }
    default:
      out.set(prev);
      return out;
  }
}

// Heights before and after a layer, weighted by the layer's mask and opacity.
// Returns { heights, delta, metrics, weights } where metrics are in SI units.
export async function applyLayer(prev, layer, ctx) {
  const { size, cellMetres, maxHeight } = ctx;
  const total = size * size;
  const seed = layerSeed(ctx.settings, layer);
  const weights = layerWeights(prev, layer, ctx);
  const out = new Float32Array(total);
  const started = performance.now();
  const kind = LayerKinds[layer.kind];
  let erosionStats = null;

  if (layer.kind === 'erosion') {
    const type = layer.params.type;
    const eroded = Float32Array.from(prev);
    const erosionCtx = { ...ctx, random: createRandom(seed) };
    erosionStats = await runErosion(type, eroded, layer.params[type], erosionCtx);
    for (let i = 0; i < total; i += 1) out[i] = clamp(prev[i] + weights[i] * (eroded[i] - prev[i]), 0, 1);
  } else if (kind.generator) {
    if (layer.kind === 'offset') {
      const lift = layer.params.level / maxHeight;
      for (let i = 0; i < total; i += 1) out[i] = clamp(prev[i] + weights[i] * lift, 0, 1);
    } else {
      const field = generateField(layer, ctx, seed);
      const amplitude = (layer.params.amplitude ?? maxHeight) / maxHeight;
      combineGenerator(prev, field, weights, amplitude, layer.blend, out);
    }
  } else {
    const shaped = applyOperator(prev, layer, ctx);
    for (let i = 0; i < total; i += 1) out[i] = clamp(mix(prev[i], shaped[i], weights[i]), 0, 1);
  }

  const delta = new Float32Array(total);
  let min = Infinity;
  let max = -Infinity;
  let removed = 0;
  let deposited = 0;
  let changed = 0;
  const cellArea = cellMetres * cellMetres;
  for (let i = 0; i < total; i += 1) {
    const d = out[i] - prev[i];
    delta[i] = d;
    if (out[i] < min) min = out[i];
    if (out[i] > max) max = out[i];
    if (Math.abs(d) > 1e-6) changed += 1;
    if (d < 0) removed -= d;
    else deposited += d;
  }
  const metrics = {
    minMetres: min * maxHeight,
    maxMetres: max * maxHeight,
    changedFraction: changed / total,
    removedVolume: removed * maxHeight * cellArea,
    depositedVolume: deposited * maxHeight * cellArea,
    milliseconds: performance.now() - started,
  };
  if (erosionStats) metrics.simulated = erosionStats;
  return { heights: out, delta, metrics, weights };
}
