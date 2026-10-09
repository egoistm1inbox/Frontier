// The layer stack evaluator. Height layers run bottom to top, each on the output of the one below.
// Texture layers run last and produce the satmap colour. Every layer's result is cached under a key that
// hashes the terrain settings, its own parameters, and the key of the layer below. Changing one layer
// therefore recomputes that layer and the ones above it, and nothing else.
//
// evaluateProject() is async so that long erosion runs can yield (and be cancelled) between batches.
import { hashKey, clamp } from '../core/rng.js';
import { downsample, minMax, mean } from '../core/grid.js';
import { generateIsland, generateRamp } from './generators.js';
import { generatePrimitive } from './primitives.js';
import { generateGeological } from './geological.js';
import { generateMesaField } from './mesas.js';
import { strataDef, applyStrata } from './strata.js';
import { applyBasin } from './basins.js';
import { falloffMask } from './falloff.js';
import { applyTerrace, applySmooth, applyLevels } from './shaping.js';
import { erodeHydraulic } from '../erosion/hydraulic.js';
import { erodeThermal } from '../erosion/thermal.js';
import { erodeFluvial } from '../erosion/fluvial.js';
import { analyseTerrain } from './analysis.js';
import { renderSatmap } from './satmap.js';
import { layerKind, paramBucket, LAYER_TYPES } from './layers.js';
import { workingSize, PREVIEW_MAX } from './project.js';

export const THUMB = 40;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export async function evaluateProject(project, options = {}) {
  const cache = options.cache || new Map();
  const hooks = options.hooks || {};
  const cancelled = () => !!(hooks.cancelled && hooks.cancelled());
  const terr = project.terrain;
  // Everything below runs on the working grid. The output grid can be larger; export.js upscales to it.
  const N = workingSize(terr.size);
  const n = N * N;
  const cellM = terr.extentM / (N - 1);
  const outCellM = terr.extentM / (terr.size - 1);
  const t0 = now();

  const layers = project.layers;
  const heightLayers = layers.filter((l) => layerKind(l.type) === 'height');
  const textureLayers = layers.filter((l) => layerKind(l.type) === 'texture');
  const total = heightLayers.length + textureLayers.length + 1;
  const report = (index, label, fraction) => {
    if (hooks.progress) hooks.progress({ index, total, label, fraction });
  };
  const yieldNow = async () => {
    if (hooks.tick) await hooks.tick();
  };

  const stats = {};
  const thumbs = {};
  const layerMs = {};
  let h = new Float32Array(n);
  let dep = null;
  // Context from the layers below: the stratigraphic column, the lake water levels and the playa floors. The satmap
  // reads it. Each layer that sets one returns a new object, so cached results are never changed in place.
  let ctx = { strata: null, water: null, playa: null };
  let key = hashKey(JSON.stringify(terr));
  let step = 0;

  for (const layer of heightLayers) {
    step++;
    const label = layer.name;
    if (!layer.enabled) {
      thumbs[layer.id] = thumbFromHeight(h, N);
      stats[layer.id] = null;
      layerMs[layer.id] = 0;
      continue;
    }
    key = hashKey(key + '|' + layer.type + '|' + JSON.stringify([layer.params, layer.opacity, layer.blend]));
    const cached = cache.get(layer.id);
    if (cached && cached.key === key) {
      h = cached.height;
      dep = cached.dep;
      ctx = cached.ctx;
      stats[layer.id] = cached.stats;
      layerMs[layer.id] = 0;
    } else {
      report(step, label, 0);
      const started = now();
      const result = await runHeightLayer(layer, h, dep, ctx, N, n, terr, cellM, {
        cancelled,
        tick: yieldNow,
        progress: (f) => report(step, label, f),
      });
      if (result === null || cancelled()) return null;
      const before = h;
      h = result.height;
      dep = result.dep;
      ctx = result.ctx;
      stats[layer.id] = summarise(before, h, N, cellM, terr.heightM, result.removed, result.eroded);
      layerMs[layer.id] = now() - started;
      cache.set(layer.id, { key, height: h, dep, ctx, stats: stats[layer.id] });
    }
    thumbs[layer.id] = thumbFromHeight(h, N);
    await yieldNow();
    if (cancelled()) return null;
  }

  // Derived fields of the final heightmap.
  step++;
  report(step, 'Analysis', 0);
  const analysisKey = hashKey(key + '|analysis');
  let analysis = cache.get('__analysis');
  if (!analysis || analysis.key !== analysisKey) {
    const started = now();
    // The shadow cache lives with the analysis, so it is rebuilt only when the heights change.
    analysis = { key: analysisKey, value: analyseTerrain(h, N, terr), ms: now() - started, shadows: new Map() };
    cache.set('__analysis', analysis);
  }
  if (cancelled()) return null;
  const an = {
    ...analysis.value,
    deposition: normalisedDeposition(dep),
    strata: ctx.strata,
    water: ctx.water,
    playa: ctx.playa,
    shadows: analysis.shadows,
  };
  await yieldNow();

  // Texture layers.
  let colour = null;
  let colourSize = 0;
  let texKey = analysisKey;
  for (const layer of textureLayers) {
    step++;
    if (!layer.enabled) {
      thumbs[layer.id] = null;
      stats[layer.id] = null;
      continue;
    }
    texKey = hashKey(texKey + '|' + layer.id + '|' + JSON.stringify([layer.params, layer.opacity]));
    report(step, layer.name, 0);
    const started = now();
    let entry = cache.get(layer.id);
    if (!entry || entry.key !== texKey) {
      // The viewport preview is capped. The export size is rendered on demand by the worker (see export.js).
      const size = Math.min(layer.params.resolution, PREVIEW_MAX);
      const rgba = renderSatmap(layer.params, size, h, N, an, terr, terr.seed);
      entry = { key: texKey, rgba, size };
      cache.set(layer.id, entry);
    }
    layerMs[layer.id] = now() - started;
    if (cancelled()) return null;
    if (!colour) {
      colour = entry.rgba;
      colourSize = entry.size;
    } else {
      const target = Math.max(colourSize, entry.size);
      colour = resampleRGBA(colour, colourSize, target);
      const top = resampleRGBA(entry.rgba, entry.size, target);
      colour = blendRGBA(colour, top, layer.opacity);
      colourSize = target;
    }
    thumbs[layer.id] = thumbFromRGBA(entry.rgba, entry.size);
    stats[layer.id] = { ms: layerMs[layer.id] };
    await yieldNow();
  }

  // Drop cache entries for layers that were deleted.
  const live = new Set(layers.map((l) => l.id));
  for (const id of [...cache.keys()]) {
    if (id !== '__analysis' && !live.has(id)) cache.delete(id);
  }

  const mm = minMax(h);
  let water = 0;
  for (let i = 0; i < n; i++) if (h[i] < terr.seaLevel) water++;
  const result = {
    N,
    height: h,
    colour,
    colourSize,
    slope: an.slope,
    flow: an.flow,
    deposition: an.deposition,
    thumbs,
    stats,
    // N is the working grid. outN is the output grid the user asked for (equal to N unless it is above WORKING_MAX).
    outN: terr.size,
    an,
    summary: {
      min: mm.min,
      max: mm.max,
      mean: mean(h),
      water: water / n,
      meanSlope: mean(an.slope),
      cellM,
      outCellM,
      extentM: terr.extentM,
      heightM: terr.heightM,
    },
    timing: { total: now() - t0, layers: layerMs, analysis: analysis.ms },
  };
  return result;
}

// Runs one height layer. Returns { height, dep, ctx } (plus the erosion fields), or null if the run was cancelled.
async function runHeightLayer(layer, input, depIn, ctxIn, N, n, terr, cellM, hooks) {
  const p = layer.params;
  const op = clamp(layer.opacity, 0, 1);
  switch (layer.type) {
    case 'island':
      return { height: blend(input, generateIsland(N, p, terr.seed), layer.blend, op, falloffMask(N, p.falloff)), dep: depIn, ctx: ctxIn };
    case 'ramp':
      return { height: blend(input, generateRamp(N, p), layer.blend, op, falloffMask(N, p.falloff)), dep: depIn, ctx: ctxIn };
    case 'terrace':
      return { height: lerpArr(input, applyTerrace(input, N, p), op), dep: depIn, ctx: ctxIn };
    case 'smooth':
      return { height: lerpArr(input, applySmooth(input, N, p), op), dep: depIn, ctx: ctxIn };
    case 'levels':
      return { height: lerpArr(input, applyLevels(input, N, p), op), dep: depIn, ctx: ctxIn };
    case 'mesafield':
      return { height: blend(input, generateMesaField(N, p, terr.seed, terr.heightM), layer.blend, op, falloffMask(N, p.falloff)), dep: depIn, ctx: ctxIn };
    case 'strata': {
      // The column is also handed to the satmap, so the bands on the cliffs match the rock units made here.
      const def = strataDef(p, terr.seed, terr.heightM, terr.extentM);
      return { height: applyStrata(input, N, def, op, cellM, terr.heightM), dep: depIn, ctx: { ...ctxIn, strata: def } };
    }
    case 'lake':
    case 'playa': {
      const isLake = layer.type === 'lake';
      const r = applyBasin(layer.type, input, N, p, terr, op, isLake ? ctxIn.water : ctxIn.playa);
      return { height: r.height, dep: depIn, ctx: isLake ? { ...ctxIn, water: r.field } : { ...ctxIn, playa: r.field } };
    }
    case 'erosion': {
      const r = await runErosion(layer, input, depIn, N, cellM, terr, hooks);
      return r === null ? null : { ...r, ctx: ctxIn };
    }
    default: {
      const group = LAYER_TYPES[layer.type] && LAYER_TYPES[layer.type].group;
      if (group === 'primitive' || group === 'geological') {
        const field = group === 'primitive' ? generatePrimitive(layer.type, N, p, terr.seed) : generateGeological(layer.type, N, p, terr.seed);
        return { height: blend(input, field, layer.blend, op, falloffMask(N, p.falloff)), dep: depIn, ctx: ctxIn };
      }
      throw new Error('Unknown height layer type: ' + layer.type);
    }
  }
}

async function runErosion(layer, input, depIn, N, cellM, terr, hooks) {
  const op = clamp(layer.opacity, 0, 1);
  const type = layer.params.type;
  const work = new Float32Array(input);
  const common = { cellM, heightM: terr.heightM, seed: layer.params.seed };
  let out = null;
  let dep = depIn;
  let removed = null;
  if (type === 'hydraulic') {
    const r = await erodeHydraulic(work, N, { ...paramBucket(layer), ...common }, hooks);
    if (!r) return null;
    dep = addDeposition(depIn, r.deposition, op);
  } else if (type === 'thermal') {
    const r = await erodeThermal(work, N, { ...paramBucket(layer), ...common }, hooks);
    if (!r) return null;
    dep = addDeposition(depIn, r.deposition, op);
  } else if (type === 'fluvial') {
    const r = await erodeFluvial(work, N, { ...paramBucket(layer), ...common }, hooks);
    if (!r) return null;
  } else {
    throw new Error('Unknown erosion type: ' + type);
  }
  out = lerpArr(input, work, op);
  return { height: out, dep, removed: null, eroded: true };
}

function addDeposition(depIn, add, op) {
  const out = depIn ? new Float32Array(depIn) : new Float32Array(add.length);
  for (let i = 0; i < add.length; i++) out[i] += add[i] * op;
  return out;
}

function normalisedDeposition(dep) {
  if (!dep) return null;
  let max = 0;
  for (let i = 0; i < dep.length; i++) if (dep[i] > max) max = dep[i];
  if (max <= 0) return null;
  const out = new Float32Array(dep.length);
  const inv = 1 / max;
  for (let i = 0; i < dep.length; i++) out[i] = Math.min(1, dep[i] * inv);
  return out;
}

// Blend modes for height layers (primitives, shapes and erosion). `over` is the new layer; `op` is its opacity.
// Combines a layer with the stack below. `mask`, when given, multiplies the opacity cell by cell (falloff).
export function blend(base, over, mode, op, mask = null) {
  const out = new Float32Array(base.length);
  for (let i = 0; i < base.length; i++) {
    const b = base[i];
    const o = over[i];
    const k = mask ? op * mask[i] : op;
    let v;
    switch (mode) {
      case 'Add':
        v = b + (o - 0.5) * k;
        break;
      case 'Subtract':
        v = b - (o - 0.5) * k;
        break;
      case 'Multiply':
        v = b + (b * o - b) * k;
        break;
      case 'Max':
        v = b + (Math.max(b, o) - b) * k;
        break;
      case 'Min':
        v = b + (Math.min(b, o) - b) * k;
        break;
      default:
        v = b + (o - b) * k;
    }
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}

function lerpArr(a, b, t) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}

function summarise(before, after, N, cellM, heightM, removed, eroded) {
  const m = minMax(after);
  const stat = { min: m.min, max: m.max, mean: mean(after) };
  if (eroded) {
    const cell2 = cellM * cellM;
    let cut = 0;
    let fill = 0;
    let maxCut = 0;
    for (let i = 0; i < after.length; i++) {
      const d = (after[i] - before[i]) * heightM;
      if (d < 0) {
        cut -= d;
        if (-d > maxCut) maxCut = -d;
      } else fill += d;
    }
    stat.removedM3 = cut * cell2; // rock and soil taken away
    stat.addedM3 = fill * cell2; // material deposited, or lifted by uplift
    stat.maxCutM = maxCut;
  }
  return stat;
}

// Height thumbnails: grey ramp from the normalised heights.
function thumbFromHeight(h, N) {
  const small = downsample(h, N, THUMB);
  const out = new Uint8ClampedArray(THUMB * THUMB * 4);
  for (let i = 0; i < THUMB * THUMB; i++) {
    const v = Math.round(clamp(small[i], 0, 1) * 255);
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}

function thumbFromRGBA(rgba, S) {
  const out = new Uint8ClampedArray(THUMB * THUMB * 4);
  const f = S / THUMB;
  for (let y = 0; y < THUMB; y++) {
    for (let x = 0; x < THUMB; x++) {
      const sx = Math.min(S - 1, Math.floor((x + 0.5) * f));
      const sy = Math.min(S - 1, Math.floor((y + 0.5) * f));
      const si = (sy * S + sx) * 4;
      const di = (y * THUMB + x) * 4;
      out[di] = rgba[si];
      out[di + 1] = rgba[si + 1];
      out[di + 2] = rgba[si + 2];
      out[di + 3] = 255;
    }
  }
  return out;
}

function resampleRGBA(src, S, T) {
  if (S === T) return src;
  const out = new Uint8ClampedArray(T * T * 4);
  for (let y = 0; y < T; y++) {
    const sy = Math.min(S - 1, Math.floor(((y + 0.5) * S) / T));
    for (let x = 0; x < T; x++) {
      const sx = Math.min(S - 1, Math.floor(((x + 0.5) * S) / T));
      const si = (sy * S + sx) * 4;
      const di = (y * T + x) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = 255;
    }
  }
  return out;
}

function blendRGBA(base, top, op) {
  const out = new Uint8ClampedArray(base.length);
  for (let i = 0; i < base.length; i += 4) {
    out[i] = base[i] + (top[i] - base[i]) * op;
    out[i + 1] = base[i + 1] + (top[i + 1] - base[i + 1]) * op;
    out[i + 2] = base[i + 2] + (top[i + 2] - base[i + 2]) * op;
    out[i + 3] = 255;
  }
  return out;
}
