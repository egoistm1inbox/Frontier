// Checks the mesa country work: the mesa profile and field, the stratigraphic column (monotone, continuous, only on
// cliffs), the lake and playa basins, cast shadows, the desert satmap, the Mesa country template, and that the default
// stack's output has not changed (golden hashes, taken from the committed code before this work). Run: node CheckMesa.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mesaProfile, mesaList, generateMesaField } from './js/terrain/mesas.js';
import { strataDef, strataMap, applyStrata } from './js/terrain/strata.js';
import { applyBasin } from './js/terrain/basins.js';
import { castShadow } from './js/terrain/shadows.js';
import { renderSatmap, PALETTES } from './js/terrain/satmap.js';
import { evaluateProject } from './js/terrain/pipeline.js';
import { createMesaProject, STACK_TEMPLATES, buildTemplate } from './js/terrain/templates.js';
import { createDefaultProject, normaliseProject } from './js/terrain/project.js';
import { LAYER_TYPES } from './js/terrain/layers.js';

const hash = (buf) => createHash('sha256').update(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)).digest('hex').slice(0, 16);

// ---------------------------------------------------------------- mesa profile
{
  const m = { H: 0.3, b: 0.075, cliff: 0.2, talus: 0.7 };
  assert.equal(mesaProfile(0, m), 0.3, 'the caprock is flat at its height');
  assert.equal(mesaProfile(0.79, m), 0.3, 'the caprock stays flat up to the cliff edge');
  assert.ok(Math.abs(mesaProfile(1, m) - m.b) < 1e-9, 'the cliff foot meets the talus at b');
  assert.ok(Math.abs(mesaProfile(1 + m.talus, m)) < 1e-9, 'the talus runs out at its outer edge');
  assert.equal(mesaProfile(1 + m.talus + 0.01, m), 0, 'nothing beyond the apron');
  const cliffDrop = (m.H - m.b) / m.cliff; // average drop per unit radius across the cliff
  const talusDrop = m.b / m.talus; // average drop per unit radius across the apron
  assert.ok(cliffDrop > 5 * talusDrop, 'the cliff is much steeper than the apron');
  let prev = Infinity;
  for (let d = 0.8; d <= 1; d += 0.001) {
    const v = mesaProfile(d, m);
    assert.ok(v <= prev + 1e-12, 'the cliff falls monotonically');
    prev = v;
  }
  prev = Infinity;
  for (let d = 1; d <= 1 + m.talus; d += 0.001) {
    const v = mesaProfile(d, m);
    assert.ok(v <= prev + 1e-12, 'the apron falls monotonically');
    prev = v;
  }
}

// ---------------------------------------------------------------- mesa field
{
  const p = { cells: 4, size: 0.9, variation: 0, jitter: 0, top: 300, cliff: 0.2, talus: 0.7, irregularity: 0, rugosity: 0, seed: 31, coverage: 1 };
  assert.equal(mesaList(p, 1337, 1000).length, 16, 'full coverage puts a mesa in every cell');
  const none = generateMesaField(64, { ...p, coverage: 0 }, 1337, 1000);
  assert.ok(none.every((v) => v === 0.5), 'with no mesas the field is the plain, 0.5');
  const field = generateMesaField(128, p, 1337, 1000);
  assert.ok(field.every((v) => v >= 0.5 && v <= 1), 'mesas only add height above the plain');
  assert.ok(Math.abs(Math.max(...field) - 0.8) < 0.01, 'a caprock reaches its full height (0.5 + 300 m)');
  assert.deepEqual(Array.from(generateMesaField(64, p, 1337, 1000)), Array.from(generateMesaField(64, p, 1337, 1000)), 'deterministic');
  const varied = mesaList({ ...p, variation: 0.6, irregularity: 0.4, coverage: 0.5 }, 1337, 1000);
  assert.ok(varied.length > 0 && varied.length < 16, 'partial coverage leaves some cells empty');
  assert.ok(new Set(varied.map((m) => m.r.toFixed(4))).size > 3, 'mesas differ in size');
  assert.ok(varied.every((m) => m.table.every((k) => k > 0.4 && k < 1.9)), 'outlines stay within their limits');
}

// ---------------------------------------------------------------- stratigraphy
{
  const def = strataDef({ units: 6, thickness: 50, base: 200, hard: 0.5, sharpness: 0.75, cliffs: 45, dip: 0, warp: 0, seed: 17 }, 1337, 1000, 6144);
  assert.equal(def.K, 6);
  assert.equal(strataMap(def, 0.1, 0), 0.1, 'identity below the column');
  assert.equal(strataMap(def, def.top + 0.05, 0), def.top + 0.05, 'identity above the column');
  let prev = -Infinity;
  for (let z = def.base; z < def.top; z += 0.0005) {
    const v = strataMap(def, z, 0);
    assert.ok(v >= prev - 1e-12, 'the mapping is monotonic through the column');
    prev = v;
  }
  for (let k = 1; k < def.K; k++) {
    const b = def.bounds[k];
    assert.ok(Math.abs(strataMap(def, b - 1e-9, 0) - strataMap(def, b + 1e-9, 0)) < 1e-6, `continuous at boundary ${k}`);
  }
  const hardK = def.hard.findIndex((h, k) => h && k < def.K - 1);
  const softK = def.hard.findIndex((h) => !h);
  assert.ok(hardK >= 0 && softK >= 0, 'the column has hard and soft units');
  const b0 = def.bounds[hardK];
  const span = def.bounds[hardK + 1] - b0;
  assert.ok(strataMap(def, b0 + 0.1 * span, 0) - strataMap(def, b0, 0) < 1e-6, 'a hard unit keeps a flat bench at its base');
  assert.ok(strataMap(def, b0 + 0.5 * span, 0) - strataMap(def, b0 + 0.4 * span, 0) > 0.1 * span, 'and a steep riser across its middle');
  const s0 = def.bounds[softK];
  const sspan = def.bounds[softK + 1] - s0;
  assert.ok(Math.abs((strataMap(def, s0 + 0.75 * sspan, 0) - strataMap(def, s0 + 0.25 * sspan, 0)) - 0.5 * sspan) < 1e-6, 'a soft unit slopes evenly');
  // Only cliffs are stepped: flat ground is unchanged, and a steep slope is stepped.
  const N = 32;
  const flat = new Float32Array(N * N).fill(0.4);
  const same = applyStrata(flat, N, def, 1, 200, 1000);
  assert.ok(same.every((v, i) => v === flat[i]), 'flat ground is not stepped');
  const ramp = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) ramp[y * N + x] = 0.1 + 0.8 * (x / (N - 1));
  const steep = applyStrata(ramp, N, def, 1, 20, 1000); // about 50 degrees
  assert.ok(steep.some((v, i) => Math.abs(v - ramp[i]) > 1e-4), 'ground steeper than the gate is stepped');
  const off = applyStrata(ramp, N, def, 0, 20, 1000);
  assert.ok(off.every((v, i) => v === ramp[i]), 'zero opacity changes nothing');
}

// ---------------------------------------------------------------- basins
{
  const N = 65;
  const terr = { heightM: 1000, seed: 1337 };
  const flat = new Float32Array(N * N).fill(0.6);
  const p = { centreX: 50, centreY: 50, radius: 20, aspect: 1, angle: 0, level: 300, depth: 40, shore: 0.4, wobble: 0, seed: 9 };
  const c = 32 * N + 32;
  const lake = applyBasin('lake', flat, N, p, terr, 1, null);
  assert.ok(Math.abs(lake.height[c] - 0.26) < 1e-3, 'a lake bed lies the depth below the water level');
  assert.ok(Math.abs(lake.field[c] - 0.3) < 1e-6, 'the water level is recorded at the centre');
  assert.ok(Math.abs(lake.height[0] - 0.6) < 1e-6, 'outside the basin nothing changes');
  assert.equal(lake.field[0], 0, 'and there is no water there');
  const playa = applyBasin('playa', flat, N, { ...p, level: 240 }, terr, 1, null);
  assert.ok(Math.abs(playa.height[c] - 0.24) < 1e-3, 'a playa floor is flat at its level');
  assert.ok(Math.abs(playa.field[c] - 1) < 1e-6, 'and is fully playa at the centre');
  const cut = applyBasin('lake', flat, N, p, terr, 0, null);
  assert.equal(cut.height, flat, 'zero opacity returns the heights unchanged');
  const lower = new Float32Array(N * N).fill(0.1); // ground already below the bed is not raised
  assert.ok(applyBasin('lake', lower, N, p, terr, 1, null).height[c] <= 0.1 + 1e-6, 'a lake never raises low ground');
}

// ---------------------------------------------------------------- cast shadows
{
  const S = 64;
  const ridge = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) ridge[y * S + x] = x >= 30 && x <= 33 ? 0.5 : 0.1;
  const west = castShadow(ridge, S, 1000, 100, 270, 30); // sun in the west: the ground east of the ridge is shadowed
  assert.ok(west[20 * S + 36] < 0.2, 'east of a ridge lit from the west is in shadow');
  assert.ok(west[20 * S + 20] > 0.9, 'west of it is in sun');
  const east = castShadow(ridge, S, 1000, 100, 90, 30); // sun in the east: the ground west of the ridge is shadowed
  assert.ok(east[20 * S + 28] < 0.2, 'west of a ridge lit from the east is in shadow');
  assert.ok(east[20 * S + 36] > 0.9, 'east of it is in sun');
  assert.ok(west.every((v) => v >= 0 && v <= 1), 'lit values stay in [0, 1]');
}

// ---------------------------------------------------------------- templates and the stack
{
  assert.deepEqual(STACK_TEMPLATES.map((t) => t.id), ['default', 'mesa'], 'two templates: default and mesa');
  const mesa = createMesaProject();
  assert.equal(mesa.name, 'Mesa country');
  const types = mesa.layers.map((l) => l.type);
  for (const t of ['mesafield', 'strata', 'erosion', 'playa', 'lake', 'satmap']) assert.ok(types.includes(t), `the mesa stack has ${t}`);
  assert.equal(types[types.length - 1], 'satmap', 'the satmap is the last layer');
  assert.equal(mesa.layers.find((l) => l.type === 'satmap').params.palette, 'mesa');
  const round = normaliseProject(JSON.parse(JSON.stringify(mesa)));
  assert.deepEqual(round.layers.map((l) => l.type), types, 'the mesa stack survives a save and open');
  assert.equal(round.layers.find((l) => l.type === 'strata').params.cliffs, 45, 'and keeps its settings');
  assert.equal(buildTemplate('mesa').name, 'Mesa country');
  assert.equal(buildTemplate('nope').name, 'Untitled landscape', 'an unknown template falls back to the default');
  for (const type of ['mesafield', 'strata', 'lake', 'playa']) assert.ok(LAYER_TYPES[type], `${type} is registered`);
  assert.ok(LAYER_TYPES.mesafield.defaults.falloff, 'the mesa field is a generator, so it has a falloff');
  assert.equal(LAYER_TYPES.lake.defaults.falloff, undefined, 'basins are finite and have no falloff');
  assert.ok(PALETTES.mesa.desert && PALETTES.mesa.strata.length >= 4, 'the mesa palette is a desert palette with strata');
}

// ---------------------------------------------------------------- evaluation: the mesa stack and the context it sets
{
  const mesa = createMesaProject();
  mesa.terrain.size = 128;
  mesa.layers.find((l) => l.type === 'satmap').params.resolution = 128; // the preview is the export size, capped at 1k
  const r = await evaluateProject(mesa, {});
  assert.ok(r.height.every((v) => v >= 0 && v <= 1), 'the mesa heights stay in range');
  assert.ok(r.colour && r.colourSize === 128 && r.colour.every((v, i) => i % 4 !== 3 || v === 255), 'the mesa satmap is opaque');
  assert.ok(r.an.strata, 'the stratigraphy reaches the satmap');
  assert.ok(r.an.water && r.an.water.some((v) => v > 0), 'the reservoir sets water levels');
  assert.ok(r.an.playa && r.an.playa.some((v) => v > 0.99), 'the playa sets a flat floor');
  const colours = new Set();
  for (let i = 0; i < r.colour.length; i += 4) colours.add((r.colour[i] << 16) | (r.colour[i + 1] << 8) | r.colour[i + 2]);
  assert.ok(colours.size > 300, 'the desert satmap has a real range of colours, not a flat fill');
  const params = mesa.layers.find((l) => l.type === 'satmap').params;
  const again = renderSatmap(params, 64, r.height, r.N, r.an, mesa.terrain, mesa.terrain.seed);
  assert.deepEqual(Array.from(again), Array.from(renderSatmap(params, 64, r.height, r.N, r.an, mesa.terrain, mesa.terrain.seed)), 'deterministic');
  // The desert context is ignored by the temperate palettes, so they render the same with or without it.
  const temperate = { ...params, palette: 'temperate', strata: 0.6, varnish: 0.4, sand: 0.8, shadow: 0.8 };
  const bare = { ...r.an, strata: null, water: null, playa: null };
  assert.deepEqual(Array.from(renderSatmap(temperate, 64, r.height, r.N, r.an, mesa.terrain, 1)), Array.from(renderSatmap(temperate, 64, r.height, r.N, bare, mesa.terrain, 1)), 'temperate palettes ignore the desert context');
}

// ---------------------------------------------------------------- the default stack has not changed
{
  const d = createDefaultProject();
  d.terrain.size = 128;
  const r = await evaluateProject(d, {});
  assert.equal(hash(r.height), '2609a285403331f5', 'default heights are unchanged');
  assert.equal(hash(r.colour), 'a8691192b21eebae', 'default satmap is unchanged');
}

console.log('CheckMesa: all checks passed for the mesa field, stratigraphy, basins, cast shadows, the desert satmap, the Mesa country template and the default golden');
