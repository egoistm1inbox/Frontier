// Checks the layer stack: evaluation shape, per-layer caching, blend maths, project normalisation, satmap and
// the 16-bit export. Run: node CheckPipeline.mjs
import assert from 'node:assert/strict';
import { evaluateProject, blend, THUMB } from './js/terrain/pipeline.js';
import { createDefaultProject, normaliseProject, encodeR16, createLayer, evaluationSnapshot, workingSize, WORKING_MAX } from './js/terrain/project.js';
import { generateIsland } from './js/terrain/generators.js';
import { generatePrimitive } from './js/terrain/primitives.js';
import { applyTerrace, applyLevels, applySmooth } from './js/terrain/shaping.js';
import { renderSatmap, PALETTES } from './js/terrain/satmap.js';
import { layerKind, LAYER_TYPES, EROSION_TYPES } from './js/terrain/layers.js';

const sumOf = (a) => a.reduce((s, v) => s + v, 0);
const timed = (res, id) => res.timing.layers[id];

// ---------------------------------------------------------------- default project and caching
const project = createDefaultProject();
project.terrain.size = 96;
const N = 96;
const cache = new Map();
const first = await evaluateProject(project, { cache });
assert.ok(first, 'first evaluation completes');
assert.equal(first.N, N);
assert.equal(first.height.length, N * N);
assert.ok(first.height.every((v) => Number.isFinite(v) && v >= 0 && v <= 1), 'heights are finite and in [0, 1]');
const heightLayers = project.layers.filter((l) => layerKind(l.type) === 'height');
const textureLayers = project.layers.filter((l) => layerKind(l.type) === 'texture');
assert.ok(heightLayers.length >= 5 && textureLayers.length === 1, 'default stack has height layers and one satmap');
assert.deepEqual(createDefaultProject().layers.map((l) => l.type), ['fbm', 'ridged', 'billow', 'island', 'erosion', 'erosion', 'erosion', 'satmap'], 'default stack order');
assert.equal(createDefaultProject().terrain.size, 1024, 'the default output is 1k');
assert.ok(first.colour && first.colour.length === first.colourSize ** 2 * 4, 'satmap RGBA has the right length');
assert.ok(first.colour.every((v, i) => i % 4 !== 3 || v === 255), 'satmap is opaque');
assert.ok(first.summary.water > 0.05 && first.summary.water < 0.95, `water fraction ${first.summary.water}`);
assert.ok(first.summary.max > first.summary.min, 'terrain has relief');
for (const l of project.layers) assert.ok(first.thumbs[l.id] && first.thumbs[l.id].length === THUMB * THUMB * 4, `thumb for ${l.name}`);
assert.ok(first.stats[heightLayers.find((l) => l.type === 'erosion').id].removedM3 > 0, 'erosion reports removed volume');

// Second evaluation with nothing changed: every height layer comes from the cache.
const second = await evaluateProject(project, { cache });
for (const l of heightLayers) assert.equal(timed(second, l.id), 0, `${l.name} is cached`);
assert.deepEqual(Array.from(second.height), Array.from(first.height), 'cached result equals the fresh one');

// Changing the satmap palette recomputes only the texture layer.
const sat = textureLayers[0];
sat.params.palette = 'arid';
const third = await evaluateProject(project, { cache });
for (const l of heightLayers) assert.equal(timed(third, l.id), 0, `${l.name} still cached after a texture change`);
assert.ok(timed(third, sat.id) > 0, 'the satmap is recomputed');
assert.ok(!Array.from(third.colour).every((v, i) => v === first.colour[i]), 'the palette change reaches the colour map');

// Changing one erosion layer recomputes it and the layers above it, and nothing below.
const hydraulic = heightLayers.find((l) => l.type === 'erosion' && l.params.type === 'hydraulic');
const index = heightLayers.indexOf(hydraulic);
hydraulic.params.hydraulic.density = 0.6;
const fourth = await evaluateProject(project, { cache });
heightLayers.forEach((l, i) => {
  if (i < index) assert.equal(timed(fourth, l.id), 0, `${l.name} below the change is cached`);
  if (i === index) assert.ok(timed(fourth, l.id) > 0, `${l.name} is recomputed`);
});

// Bypassing a layer: its stats are null, its thumbnail is still produced, and the result changes.
const thermal = heightLayers.find((l) => l.type === 'erosion' && l.params.type === 'thermal');
thermal.enabled = false;
const fifth = await evaluateProject(project, { cache });
assert.equal(fifth.stats[thermal.id], null, 'bypassed layers report no stats');
assert.ok(fifth.thumbs[thermal.id], 'bypassed layers still have a thumbnail');
assert.ok(sumOf(fifth.height) !== sumOf(fourth.height), 'bypassing a layer changes the terrain');
thermal.enabled = true;

// Cancellation: a cancelled evaluation returns null.
const cancelled = await evaluateProject(project, { cache: new Map(), hooks: { cancelled: () => true } });
assert.equal(cancelled, null, 'cancelled evaluations return null');
console.log(`pipeline: stack of ${project.layers.length} layers evaluates to ${N}² with caching; first run ${Math.round(first.timing.total)} ms`);

// ---------------------------------------------------------------- blend modes
{
  const base = Float32Array.from([0.2, 0.8, 0.5]);
  const over = Float32Array.from([0.6, 0.4, 0.5]);
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
  assert.ok(near(blend(base, over, 'Normal', 1), over), 'Normal at full opacity replaces');
  assert.ok(near(blend(base, over, 'Normal', 0), base), 'Normal at zero opacity keeps the base');
  assert.ok(near(blend(base, over, 'Max', 1), [0.6, 0.8, 0.5]), 'Max keeps the larger value');
  assert.ok(near(blend(base, over, 'Min', 1), [0.2, 0.4, 0.5]), 'Min keeps the smaller value');
  assert.ok(near(blend(base, over, 'Add', 1), [0.3, 0.7, 0.5]), 'Add adds the layer around its 0.5 mid level');
  assert.ok(near(blend(base, over, 'Multiply', 1), [0.12, 0.32, 0.25]), 'Multiply scales the base');
  assert.ok(near(blend(base, over, 'Subtract', 1), [0.1, 0.9, 0.5]), 'Subtract removes the layer around 0.5');
}

// ---------------------------------------------------------------- generators and shaping
{
  const island = generateIsland(64, { radius: 1.2, falloff: 2.2, wobble: 0.45, seed: 5 }, 1337);
  assert.ok(island.every((v) => v >= 0 && v <= 1), 'island mask stays in [0, 1]');
  assert.ok(island[32 * 64 + 32] > island[0], 'island mask is highest at the centre');
  assert.ok(generatePrimitive('constant', 8, { value: 0.3 }, 1).every((v) => Math.abs(v - 0.3) < 1e-6), 'constant primitive is flat');
  const ramp = Float32Array.from({ length: 4096 }, (_, i) => i / 4095);
  const terraced = applyTerrace(ramp, 64, { steps: 4, sharpness: 0.9 });
  // Sharpness 0.9 leaves a narrow riser between plateaus. Most cells should sit exactly on a plateau level.
  const onPlateau = terraced.filter((v) => Math.abs(v * 4 - Math.round(v * 4)) < 1e-6).length / terraced.length;
  assert.ok(onPlateau > 0.7, `terrace plateaus hold most cells, got ${onPlateau.toFixed(2)}`);
  const lv = applyLevels(ramp, 64, { low: 0, high: 1, gamma: 1 });
  assert.ok(lv.every((v, i) => Math.abs(v - ramp[i]) < 1e-6), 'identity levels leave heights unchanged');
  const noisy = Float32Array.from({ length: 4096 }, (_, i) => (i * 37) % 97 / 97);
  const smooth = applySmooth(noisy, 64, { radius: 2, iterations: 2 });
  const variance = (a) => { const m = sumOf(a) / a.length; return a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length; };
  assert.ok(variance(smooth) < variance(noisy), 'smoothing reduces roughness');
}

// ---------------------------------------------------------------- project normalisation
{
  const fresh = normaliseProject(null);
  assert.equal(fresh.layers.length, createDefaultProject().layers.length, 'null input gives the default project');
  const messy = normaliseProject({
    name: 42,
    terrain: { size: 300, extentM: 1e9, heightM: 'x', seed: 12.7, seaLevel: 9 },
    layers: [
      { type: 'satmap', name: 'Sat', params: { palette: 'arid' } },
      { type: 'nope' },
      { type: 'noise', params: { frequency: 3 }, opacity: 7, blend: 'Bogus' },
      { type: 'erosion', params: { type: 'mystery' } },
      { type: 'base' },
    ],
    view: { mode: 'flow' },
  });
  assert.equal(messy.name, 'Untitled landscape', 'non-string names fall back');
  assert.equal(messy.terrain.size, 1024, 'unsupported grid sizes fall back to the 1k default');
  assert.equal(messy.terrain.extentM, 16000, 'extent is clamped');
  assert.equal(messy.terrain.heightM, 1000, 'bad numbers fall back');
  assert.equal(messy.terrain.seed, 12, 'seed is a whole number');
  assert.equal(messy.terrain.seaLevel, 0.6, 'sea level is clamped');
  assert.ok(!messy.layers.some((l) => l.type === 'nope'), 'unknown layer types are dropped');
  const kinds = messy.layers.map((l) => layerKind(l.type));
  assert.deepEqual(kinds, [...kinds].sort((a, b) => (a === 'texture') - (b === 'texture')), 'texture layers go last');
  const noise = messy.layers.find((l) => l.type === 'fbm');
  assert.ok(noise, 'the v1 noise type migrates to fbm');
  assert.equal(noise.params.octaves, LAYER_TYPES.fbm.defaults.octaves, 'missing parameters come from the defaults');
  assert.equal(noise.params.frequency, 3, 'given parameters are kept');
  assert.equal(noise.opacity, 1, 'opacity is clamped');
  assert.equal(noise.blend, 'Normal', 'unknown blend modes fall back');
  assert.equal(messy.layers.find((l) => l.type === 'erosion').params.type, 'hydraulic', 'unknown erosion types fall back');
  const legacy = normaliseProject({ version: 1, layers: [{ type: 'base', params: { level: 0.3 } }] });
  assert.equal(legacy.layers[0].type, 'constant', 'the v1 base type migrates to constant');
  assert.equal(legacy.layers[0].params.value, 0.3, 'the v1 level becomes the constant value');
  assert.equal(legacy.version, 2, 'projects are written at the current version');
  assert.equal(workingSize(16384), WORKING_MAX, 'the working grid is capped');
  assert.equal(workingSize(1024), 1024, 'small outputs are their own working grid');
  assert.equal(messy.layers.find((l) => l.type === 'satmap').params.palette, 'arid');
  assert.equal(messy.view.mode, 'flow', 'view settings are kept');
  assert.ok(messy.layers.every((l) => l.id), 'every layer has an id');
  const ids = messy.layers.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, 'layer ids are unique');
}

// ---------------------------------------------------------------- encoding
{
  const h = Float32Array.from([0, 0.5, 1, 2, -1, 0.25]);
  const buf = encodeR16(h, 3);
  assert.equal(buf.byteLength, 3 * 3 * 2, 'R16 is two bytes per cell');
  const view = new DataView(buf);
  assert.equal(view.getUint16(0, true), 0);
  assert.equal(view.getUint16(2, true), Math.round(0.5 * 65535));
  assert.equal(view.getUint16(4, true), 65535);
  assert.equal(view.getUint16(6, true), 65535, 'values above 1 are clamped');
  assert.equal(view.getUint16(8, true), 0, 'values below 0 are clamped');
  assert.equal(view.getUint16(10, true), Math.round(0.25 * 65535));
}

// ---------------------------------------------------------------- satmap
{
  const M = 48;
  const h = Float32Array.from({ length: M * M }, (_, i) => (i % M) / M);
  const analysis = {
    N: M, cellM: 16, heightM: 1000,
    gx: new Float32Array(M * M), gy: new Float32Array(M * M), slope: new Float32Array(M * M).fill(5),
    ridge: new Float32Array(M * M), flow: new Float32Array(M * M).fill(1), wet: new Float32Array(M * M).fill(0.5), deposition: null,
  };
  const params = { palette: 'temperate', vegetation: 0.7, wetness: 0.6, rockSlope: 34, snowline: 900, hillshade: 0.6, detail: 0.5, saturation: 1, contrast: 1, sunAzimuth: 315, sunElevation: 38 };
  const low = renderSatmap(params, 32, h, M, analysis, { seaLevel: 0.6, heightM: 1000 }, 3);
  assert.equal(low.length, 32 * 32 * 4);
  let bluish = 0;
  for (let i = 0; i < low.length; i += 4) if (low[i + 2] > low[i] + 20) bluish++;
  assert.ok(bluish > 0, 'a high sea level puts water on the map');
  const again = renderSatmap(params, 32, h, M, analysis, { seaLevel: 0.6, heightM: 1000 }, 3);
  assert.deepEqual(Array.from(again.slice(0, 64)), Array.from(low.slice(0, 64)), 'satmap is deterministic');
  assert.ok(Object.keys(PALETTES).length >= 6, 'several palettes are available');
}

// ---------------------------------------------------------------- snapshot
{
  const snap = evaluationSnapshot(createDefaultProject());
  assert.ok(!('view' in snap), 'the worker snapshot carries no view settings');
  assert.ok(snap.layers.every((l) => typeof l.name === 'string' && l.id), 'layers carry their ids and names');
  const custom = createLayer('erosion', { name: 'Custom', params: { type: 'thermal' } });
  assert.equal(custom.params.type, 'thermal');
  assert.equal(custom.name, 'Custom');
  assert.ok(EROSION_TYPES.thermal && EROSION_TYPES.fluvial && EROSION_TYPES.hydraulic);
}

// ---------------------------------------------------------------- falloff and geological layers in the stack
{
  const base = Float32Array.from([0.2, 0.8, 0.5, 0.1]);
  const over = Float32Array.from([0.9, 0.1, 0.7, 0.4]);
  const none = new Float32Array(4); // mask 0: the layer has no effect in any blend mode
  const ones = new Float32Array(4).fill(1);
  for (const mode of ['Normal', 'Add', 'Subtract', 'Multiply', 'Max', 'Min']) {
    assert.deepEqual(Array.from(blend(base, over, mode, 0.8, none)), Array.from(base), `a zero mask leaves the base unchanged in ${mode} mode`);
    assert.deepEqual(Array.from(blend(base, over, mode, 0.8, ones)), Array.from(blend(base, over, mode, 0.8)), `a full mask matches no mask in ${mode} mode`);
  }
}
{
  // A fractal limited to a region. The base is zero, so outside the region the terrain stays at zero.
  const size = 64;
  const proj = (layers) => ({ ...createDefaultProject(), terrain: { ...createDefaultProject().terrain, size }, layers });
  const limited = createLayer('fbm', { params: { falloff: { enabled: true, radius: 50, softness: 0, strength: 100 } } });
  const free = createLayer('fbm');
  const withFalloff = await evaluateProject(proj([limited]), { cache: new Map() });
  const without = await evaluateProject(proj([free]), { cache: new Map() });
  const patchMean = (h, x0, y0) => {
    let sum = 0;
    for (let y = y0; y < y0 + 8; y++) for (let x = x0; x < x0 + 8; x++) sum += h[y * size + x];
    return sum / 64;
  };
  assert.equal(patchMean(withFalloff.height, 0, 0), 0, 'with a falloff the layer does nothing outside its region');
  assert.ok(patchMean(withFalloff.height, 28, 28) > 0.05, 'inside the region the layer is there');
  assert.ok(patchMean(without.height, 0, 0) > 0.05, 'without a falloff the layer covers the whole map');
}
{
  // A crater added in Add mode sinks a flat floor at its centre and leaves the floor alone outside its footprint.
  const size = 64;
  const proj = (layers) => ({ ...createDefaultProject(), terrain: { ...createDefaultProject().terrain, size }, layers });
  const floor = createLayer('constant', { params: { value: 0.5 } });
  const crater = createLayer('crater');
  const r = await evaluateProject(proj([floor, crater]), { cache: new Map() });
  const at = (x, y) => r.height[y * size + x];
  assert.equal(crater.blend, 'Add', 'geological layers default to Add');
  assert.ok(at(size >> 1, size >> 1) < 0.4, `a crater sinks a flat floor at its centre (${at(size >> 1, size >> 1).toFixed(3)})`);
  assert.ok(Math.abs(at(0, 0) - 0.5) < 0.01, 'outside the crater the floor is unchanged');
}
{
  // Projects written before the falloff existed still load, with the falloff off. A saved falloff block is kept.
  const old = normaliseProject({
    layers: [
      { type: 'fbm', params: { octaves: 3 } },
      { type: 'cone', params: { radius: 30, falloff: { enabled: true, radius: 40 } } },
    ],
  });
  const fb = old.layers[0];
  assert.equal(fb.params.falloff.enabled, false, 'a generator from an older file has the falloff off');
  const cone = old.layers[1];
  assert.equal(cone.params.radius, 30, 'geological parameters are kept');
  assert.equal(cone.params.falloff.enabled, true, 'a falloff block from a file is kept');
  assert.equal(cone.params.falloff.radius, 40, 'falloff settings from a file are kept');
  assert.equal(cone.params.falloff.centreX, 50, 'missing falloff settings fall back to the defaults');
}

console.log('CheckPipeline: all checks passed');
