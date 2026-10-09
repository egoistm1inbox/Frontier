// Checks the 28 Section 1 primitive layer types: the list matches the spec, each type is its own layer type,
// each field is finite and in [0, 1], output is deterministic, seeded types respond to the seed while the
// pattern types ignore it, and no two types produce the same field. Run: node CheckPrimitives.mjs
import assert from 'node:assert/strict';
import { PRIMITIVE_IDS, LAYER_TYPES, layerKind } from './js/terrain/layers.js';
import { generatePrimitive, primitiveRaw, PRIMITIVES } from './js/terrain/primitives.js';

const SECTION_1 = [
  'constant', 'perlin', 'simplex', 'value', 'voronoi1', 'voronoi2', 'voronoi3', 'voronoi4', 'crackle', 'worley',
  'cellular', 'gabor', 'sparse', 'wavelet', 'fbm', 'ridged', 'billow', 'swiss', 'jordan', 'random',
  'grid', 'hex', 'brick', 'checker', 'stripes', 'sine', 'sawtooth', 'triangle',
];
// Fixed patterns: no random input, so neither the terrain seed nor the layer seed changes them.
const PATTERNS = new Set(['constant', 'grid', 'hex', 'checker', 'stripes', 'sine', 'sawtooth', 'triangle']);
const W = 128;

const differing = (a, b) => {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
};
const correlation = (a, b) => {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < a.length; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= a.length;
  mb /= a.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return num / Math.sqrt(da * db + 1e-12);
};

// ---------------------------------------------------------------- the list
assert.deepEqual([...PRIMITIVE_IDS].sort(), [...SECTION_1].sort(), 'the primitive types are exactly the 28 Section 1 types');
assert.equal(new Set(PRIMITIVE_IDS).size, 28, 'no duplicate ids');
for (const id of PRIMITIVE_IDS) {
  const def = LAYER_TYPES[id];
  assert.equal(def.group, 'primitive', `${id} is in the primitive group`);
  assert.equal(layerKind(id), 'height', `${id} is a height layer`);
  assert.ok(def.label && def.blurb, `${id} has a label and a description`);
  assert.ok(def.defaults && typeof def.defaults === 'object', `${id} has defaults`);
  assert.ok(id === 'constant' || PRIMITIVES[id], `${id} has an algorithm`);
}

// ---------------------------------------------------------------- each type on its own
const fields = new Map();
for (const id of PRIMITIVE_IDS) {
  const p = { ...LAYER_TYPES[id].defaults };
  const h = generatePrimitive(id, W, p, 1337);
  assert.equal(h.length, W * W, `${id} fills the grid`);
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of h) {
    assert.ok(Number.isFinite(v), `${id} is finite`);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  assert.ok(lo >= 0 && hi <= 1, `${id} stays in [0, 1]`);
  if (id === 'constant') {
    assert.equal(hi - lo, 0, 'constant is flat');
    assert.ok(Math.abs(hi - p.value) < 1e-6, 'constant sits at its value');
  } else {
    assert.ok(hi - lo > 0.15, `${id} has relief (range ${(hi - lo).toFixed(2)})`);
    const raw = primitiveRaw(id, W, p, 1337);
    assert.equal(raw.length, W * W, `${id} raw field fills the grid`);
    assert.ok(raw.every((v) => Number.isFinite(v)), `${id} raw field is finite`);
  }
  assert.deepEqual(Array.from(generatePrimitive(id, W, p, 1337)), Array.from(h), `${id} is deterministic`);
  const other = generatePrimitive(id, W, p, 4242);
  const changed = differing(h, other);
  if (PATTERNS.has(id)) assert.equal(changed, 0, `${id} is a fixed pattern and ignores the seed`);
  else assert.ok(changed > 0.5 * h.length, `${id} changes with the seed (${((changed / h.length) * 100).toFixed(0)}% of cells)`);
  fields.set(id, h);
}

// ---------------------------------------------------------------- constant clamps its value
assert.ok(generatePrimitive('constant', 4, { value: 1.7 }, 1).every((v) => v === 1), 'constant clamps above 1');
assert.ok(generatePrimitive('constant', 4, { value: -2 }, 1).every((v) => v === 0), 'constant clamps below 0');

// ---------------------------------------------------------------- no two types are the same field
const ids = PRIMITIVE_IDS.filter((id) => id !== 'constant');
const near = [];
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    const r = correlation(fields.get(ids[i]), fields.get(ids[j]));
    if (Math.abs(r) > 0.9) near.push(`${ids[i]}~${ids[j]} ${r.toFixed(3)}`);
  }
}
assert.deepEqual(near, [], 'no two types are near duplicates (|r| > 0.9)');

console.log(`CheckPrimitives: all checks passed for ${PRIMITIVE_IDS.length} primitive types at ${W}²`);
