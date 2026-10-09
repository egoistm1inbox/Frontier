// Engine tests: run with `npm test`. They use Node's built-in test runner, so no test framework
// is needed. Resolutions are kept small (128²) so the whole file runs in seconds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';

import { createNoise } from '../src/engine/noise.js';
import { routeFlow, accumulate, flowIntensity } from '../src/engine/flow.js';
import { evaluateProject, CancelledError } from '../src/engine/evaluate.js';
import { runErosion } from '../src/engine/erosion/index.js';
import { createRandom } from '../src/engine/random.js';
import {
  createDefaultProject,
  createLayer,
  normaliseProject,
  ErosionTypes,
  EROSION_ORDER,
  LayerKinds,
  DEFAULT_SETTINGS,
} from '../src/engine/specs.js';
import { encodeHeightPng16, encodeRgbaPng } from '../src/engine/png.js';
import { buildFields, hexToRgb, makeLut, LEGEND } from '../src/ui/colour.js';
import { formatVolume, formatMs, formatKm } from '../src/ui/format.js';

const deflate = async (bytes) => deflateSync(bytes);

// A small project: one fBm base layer followed by the given layers.
function smallProject(layers, resolution = 128) {
  const project = createDefaultProject();
  project.settings = { ...DEFAULT_SETTINGS, resolution, seed: 42 };
  project.layers = [createLayer('fbm', { seed: 3 }), ...layers];
  return project;
}

function erosionLayer(type, overrides = {}, seed = 9) {
  const layer = createLayer('erosion', { seed, params: { type } });
  layer.params[type] = { ...layer.params[type], ...overrides };
  return layer;
}

function assertTerrain(heights, label) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < heights.length; i += 1) {
    assert.ok(Number.isFinite(heights[i]), `${label}: non-finite height at ${i}`);
    min = Math.min(min, heights[i]);
    max = Math.max(max, heights[i]);
  }
  assert.ok(min >= 0 && max <= 1, `${label}: heights outside [0, 1] (${min}, ${max})`);
}

function layerMetrics(result, id) {
  return result.layers.find((entry) => entry.id === id).metrics;
}

// ---- Noise and random numbers ----------------------------------------------------------------

test('noise is deterministic per seed and bounded', () => {
  const a = createNoise(7);
  const b = createNoise(7);
  const c = createNoise(8);
  let differs = false;
  for (let i = 0; i < 400; i += 1) {
    const x = i * 0.137;
    const y = i * 0.291;
    assert.equal(a(x, y), b(x, y));
    if (a(x, y) !== c(x, y)) differs = true;
    assert.ok(Math.abs(a(x, y)) <= 1.5, 'noise sample out of range');
  }
  assert.ok(differs, 'different seeds should give different noise');
});

test('seeded random numbers repeat and stay in [0, 1)', () => {
  const r1 = createRandom(11);
  const r2 = createRandom(11);
  for (let i = 0; i < 1000; i += 1) {
    const v = r1();
    assert.equal(v, r2());
    assert.ok(v >= 0 && v < 1);
  }
});

// ---- Drainage routing ------------------------------------------------------------------------

test('every cell drains to a lower-or-equal neighbour, and outlet areas add up to the grid', () => {
  const size = 64;
  const noise = createNoise(5);
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) heights[y * size + x] = 0.5 + 0.4 * noise(x * 0.12, y * 0.12);
  }
  const { filled, order, receiver } = routeFlow(heights, size);
  let outletArea = 0;
  const area = accumulate(order, receiver, size * size);
  for (let i = 0; i < size * size; i += 1) {
    const r = receiver[i];
    if (r < 0) {
      outletArea += area[i];
      continue;
    }
    const dx = Math.abs((r % size) - (i % size));
    const dy = Math.abs(Math.floor(r / size) - Math.floor(i / size));
    assert.ok(dx <= 1 && dy <= 1 && r !== i, `cell ${i} routes to a non-neighbour ${r}`);
    assert.ok(filled[r] <= filled[i] + 1e-9, `cell ${i} routes uphill`);
  }
  assert.equal(outletArea, size * size, 'every cell should reach exactly one outlet');
  const intensity = flowIntensity(area);
  for (let i = 0; i < intensity.length; i += 1) assert.ok(intensity[i] >= 0 && intensity[i] <= 1);
});

// ---- Erosion solvers -------------------------------------------------------------------------

test('each erosion type keeps heights finite and bounded, and changes the terrain', async () => {
  const cases = {
    droplet: { droplets: 40000 },
    stream: { iterations: 30 },
    thermal: { iterations: 30 },
    wind: {},
  };
  for (const type of EROSION_ORDER) {
    const project = smallProject([erosionLayer(type, cases[type])]);
    const result = await evaluateProject(project, { cache: new Map() });
    assertTerrain(result.heights, type);
    const metrics = layerMetrics(result, project.layers[1].id);
    assert.ok(metrics.changedFraction > 0, `${type} did not change the terrain`);
    assert.ok(metrics.removedVolume > 0, `${type} removed no material`);
  }
});

test('thermal conserves material exactly, and wind only exchanges a small amount with the map edges', async () => {
  // Thermal transfers stay inside the map, so removed and deposited volumes must match.
  const thermal = smallProject([erosionLayer('thermal', { iterations: 40, talusAngle: 25 })]);
  const t = await evaluateProject(thermal, { cache: new Map() });
  const tm = layerMetrics(t, thermal.layers[1].id);
  assert.ok(Math.abs(tm.removedVolume - tm.depositedVolume) / tm.removedVolume < 1e-4, 'thermal does not conserve mass');

  // Wind has an open edge: the upwind edge supplies sand at the local flux and the downwind edge
  // carries it away. The net exchange must stay a small share of the moved material.
  const wind = smallProject([erosionLayer('wind', { iterations: 20 })]);
  const w = await evaluateProject(wind, { cache: new Map() });
  const wm = layerMetrics(w, wind.layers[1].id);
  const exchange = Math.abs(wm.removedVolume - wm.depositedVolume) / Math.max(wm.removedVolume, wm.depositedVolume);
  assert.ok(exchange < 0.05, `wind edge exchange is ${(exchange * 100).toFixed(2)}% of the moved material`);
});

test('thermal erosion relaxes steep slopes towards the talus angle', async () => {
  const project = smallProject([erosionLayer('thermal', { iterations: 120, talusAngle: 30 })]);
  const before = await evaluateProject(smallProject([]), { cache: new Map() });
  const after = await evaluateProject(project, { cache: new Map() });
  const steepCells = (heights, size, cellMetres, maxHeight) => {
    let count = 0;
    for (let y = 1; y < size - 1; y += 1) {
      for (let x = 1; x < size - 1; x += 1) {
        const i = y * size + x;
        const dx = (heights[i + 1] - heights[i - 1]) * maxHeight / (2 * cellMetres);
        const dy = (heights[i + size] - heights[i - size]) * maxHeight / (2 * cellMetres);
        if (Math.atan(Math.hypot(dx, dy)) * 180 / Math.PI > 36) count += 1;
      }
    }
    return count;
  };
  const cell = project.settings.size / (project.settings.resolution - 1);
  const steepBefore = steepCells(before.heights, 128, cell, project.settings.maxHeight);
  const steepAfter = steepCells(after.heights, 128, cell, project.settings.maxHeight);
  assert.ok(steepAfter < steepBefore, `talus did not reduce steep cells (${steepBefore} → ${steepAfter})`);
});

test('the same seed gives the same droplet erosion', async () => {
  const run = async (seed) => {
    const heights = new Float32Array(64 * 64);
    const noise = createNoise(2);
    for (let i = 0; i < heights.length; i += 1) heights[i] = 0.5 + 0.3 * noise((i % 64) * 0.2, Math.floor(i / 64) * 0.2);
    const ctx = { size: 64, cellMetres: 32, maxHeight: 600, random: createRandom(seed), checkpoint: async () => {} };
    await runErosion('droplet', heights, { ...ErosionTypes.droplet.defaults, droplets: 20000 }, ctx);
    return heights;
  };
  const a = await run(5);
  const b = await run(5);
  const c = await run(6);
  assert.deepEqual(Array.from(a), Array.from(b));
  assert.notDeepEqual(Array.from(a), Array.from(c));
});

// ---- Layer stack, cache and cancellation ------------------------------------------------------

test('evaluation is repeatable and the cache serves unchanged layers', async () => {
  const project = smallProject([erosionLayer('droplet', { droplets: 20000 }), erosionLayer('thermal', { iterations: 20 }, 10)]);
  const cache = new Map();
  const first = await evaluateProject(project, { cache });
  const second = await evaluateProject(project, { cache });
  assert.equal(second.cacheHits, project.layers.length);
  assert.deepEqual(Array.from(first.heights), Array.from(second.heights));

  // Changing the last layer only recomputes that layer.
  const edited = structuredClone(project);
  edited.layers[2].params.thermal.talusAngle = 28;
  const third = await evaluateProject(edited, { cache });
  assert.equal(third.cacheHits, project.layers.length - 1);
});

test('force replays erosion but keeps generator layers cached', async () => {
  const project = smallProject([erosionLayer('thermal', { iterations: 20 })]);
  const cache = new Map();
  await evaluateProject(project, { cache });
  const replay = await evaluateProject(project, { cache, force: true });
  assert.equal(replay.layers[0].cached, true, 'base layer should stay cached');
  assert.equal(replay.layers[1].cached, false, 'erosion layer should be recomputed');
});

test('a disabled layer passes its input through unchanged', async () => {
  const off = erosionLayer('stream', { iterations: 40 });
  off.enabled = false;
  const project = smallProject([off]);
  const base = await evaluateProject(smallProject([]), { cache: new Map() });
  const result = await evaluateProject(project, { cache: new Map() });
  assert.deepEqual(Array.from(result.heights), Array.from(base.heights));
  assert.equal(result.layers[1].skipped, true);
});

test('cancellation rejects with CancelledError and leaves the cache usable', async () => {
  const project = smallProject([erosionLayer('droplet', { droplets: 20000 })]);
  const cache = new Map();
  let calls = 0;
  const checkpoint = async () => {
    calls += 1;
    if (calls > 3) throw new CancelledError();
  };
  await assert.rejects(evaluateProject(project, { cache, checkpoint }), CancelledError);
  const result = await evaluateProject(project, { cache });
  assertTerrain(result.heights, 'after cancel');
});

test('the satmap texture is full-size RGBA with opaque alpha', async () => {
  const project = smallProject([erosionLayer('stream', { iterations: 20 })]);
  const result = await evaluateProject(project, { cache: new Map() });
  const side = result.textureSize;
  assert.equal(result.texture.length, side * side * 4);
  for (let i = 3; i < result.texture.length; i += 4) assert.equal(result.texture[i], 255);
});

// ---- Project documents ------------------------------------------------------------------------

test('every erosion type has its own sliders, each bound to a real parameter', () => {
  const keySets = [];
  for (const type of EROSION_ORDER) {
    const spec = ErosionTypes[type];
    assert.ok(spec.controls.length > 0, `${type} has no sliders`);
    for (const control of spec.controls) {
      assert.ok(control.key in spec.defaults, `${type}.${control.key} has no default`);
      if (control.type === 'select') assert.ok(control.options?.length > 0, `${type}.${control.key} has no options`);
      else assert.ok(control.min < control.max, `${type}.${control.key} has an empty range`);
    }
    keySets.push(spec.controls.map((control) => control.key).sort().join(','));
  }
  assert.equal(new Set(keySets).size, EROSION_ORDER.length, 'two erosion types share the same slider set');
});

test('every layer kind has controls that match its defaults', () => {
  for (const [kind, spec] of Object.entries(LayerKinds)) {
    if (kind === 'erosion') continue;
    for (const control of spec.controls) {
      assert.ok(control.key in spec.defaults, `${kind}.${control.key} has no default`);
    }
  }
});

test('normaliseProject repairs bad input and drops unknown layers', () => {
  const project = normaliseProject({
    settings: { resolution: 999, size: 5000, maxHeight: 9999, seaLevel: 99999 },
    layers: [{ kind: 'bogus' }, { kind: 'erosion', params: { type: 'wind' } }],
    satmap: { source: 'imported', resolution: 77 },
  });
  assert.equal(project.settings.resolution, DEFAULT_SETTINGS.resolution);
  assert.equal(project.settings.size, DEFAULT_SETTINGS.size);
  assert.equal(project.settings.maxHeight, 2000);
  assert.equal(project.settings.seaLevel, 2000);
  assert.equal(project.layers.length, 1);
  assert.equal(project.layers[0].params.type, 'wind');
  assert.equal(project.layers[0].params.wind.iterations, ErosionTypes.wind.defaults.iterations);
  assert.equal(project.satmap.source, 'imported');
  assert.equal(project.satmap.resolution, 512);
});

test('a project survives a JSON round trip', () => {
  const original = createDefaultProject();
  const copy = normaliseProject(JSON.parse(JSON.stringify(original)));
  assert.deepEqual(copy.layers.map((l) => [l.kind, l.name, l.seed]), original.layers.map((l) => [l.kind, l.name, l.seed]));
  assert.deepEqual(copy.settings, original.settings);
});

// ---- Export encoders --------------------------------------------------------------------------

test('the 16-bit heightmap is a valid greyscale PNG with the right scanline length', async () => {
  const size = 16;
  const heights = new Float32Array(size * size).map((_, i) => i / (size * size));
  const png = await encodeHeightPng16(heights, size, deflate);
  assert.deepEqual(Array.from(png.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  assert.equal(view.getUint32(16), size);
  assert.equal(view.getUint32(20), size);
  assert.equal(png[24], 16, 'bit depth');
  assert.equal(png[25], 0, 'colour type (greyscale)');
  const idat = findChunk(png, 'IDAT');
  assert.equal(inflateSync(idat).length, size * (1 + size * 2));
});

test('the RGBA satmap PNG has the right colour type and scanline length', async () => {
  const size = 8;
  const rgba = new Uint8ClampedArray(size * size * 4).fill(128);
  const png = await encodeRgbaPng(rgba, size, size, deflate);
  assert.equal(png[25], 6, 'colour type (RGBA)');
  assert.equal(inflateSync(findChunk(png, 'IDAT')).length, size * (1 + size * 4));
});

function findChunk(png, type) {
  let offset = 8;
  while (offset < png.length) {
    const length = new DataView(png.buffer, png.byteOffset + offset, 4).getUint32(0);
    const name = String.fromCharCode(...png.slice(offset + 4, offset + 8));
    if (name === type) return png.slice(offset + 8, offset + 8 + length);
    offset += 12 + length;
  }
  throw new Error(`chunk ${type} not found`);
}

// ---- UI helpers that are plain JS -------------------------------------------------------------

test('viewport fields are finite RGB triplets for every mode', () => {
  const size = 32;
  const heights = new Float32Array(size * size).map((_, i) => (i % size) / size);
  const slope = new Float32Array(size * size).map((_, i) => (i * 7) % 60);
  const flow = new Float32Array(size * size).map((_, i) => (i % 5) / 4);
  const delta = new Float32Array(size * size).map((_, i) => (i % 2 ? 0.01 : -0.02));
  for (const mode of ['shaded', 'height', 'slope', 'flow', 'erosion']) {
    const colours = buildFields(mode, { heights, size, maxHeight: 600, seaLevel: 45, slope, flow, erosionDelta: delta });
    assert.equal(colours.length, size * size * 3, mode);
    for (const value of colours) assert.ok(value >= 0 && value <= 1 && Number.isFinite(value), mode);
  }
  for (const key of Object.keys(LEGEND)) assert.ok(LEGEND[key].stops.length >= 2);
});

test('hex colours and lookup tables agree at the end points', () => {
  assert.deepEqual(hexToRgb('#ff8000'), [255, 128, 0]);
  assert.deepEqual(hexToRgb('#0f0'), [0, 255, 0]);
  const lut = makeLut([[0, '#000000'], [1, '#ffffff']]);
  assert.equal(lut[0], 0);
  assert.ok(Math.abs(lut[255 * 3] - 1) < 1e-6);
});

test('readout formatting', () => {
  assert.equal(formatVolume(1.5e6), '1.50 M m³');
  assert.equal(formatVolume(2500), '2.5 k m³');
  assert.equal(formatMs(1500), '1.50 s');
  assert.equal(formatMs(42), '42 ms');
  assert.equal(formatKm(2048), '2.0 km');
});
