// Checks the deterministic building blocks: PRNG, hashes, noise ranges and seeding.
// Run: node CheckRng.mjs
import assert from 'node:assert/strict';
import { mulberry32, hashString, hashKey, hash2, clamp, smoothstep } from './js/core/rng.js';
import { makeNoise, fbm, ridgedFbm } from './js/core/noise.js';

const a = mulberry32(42);
const b = mulberry32(42);
const seqA = Array.from({ length: 1000 }, () => a());
const seqB = Array.from({ length: 1000 }, () => b());
assert.deepEqual(seqA, seqB, 'same seed must give the same sequence');
assert.ok(seqA.every((v) => v >= 0 && v < 1), 'PRNG values must lie in [0, 1)');
const mean = seqA.reduce((s, v) => s + v, 0) / seqA.length;
assert.ok(Math.abs(mean - 0.5) < 0.05, `PRNG mean should be near 0.5, got ${mean}`);
assert.notDeepEqual(mulberry32(1)(), mulberry32(2)(), 'different seeds must differ');

assert.equal(hashString('a'), 'e40c292c', 'FNV-1a of "a" is a known value');
assert.equal(hashKey('abc'), hashKey('abc'));
assert.notEqual(hashKey('abc'), hashKey('abd'));
assert.equal(hashKey('x').length, 16);
const h2 = hash2(3, 4, 9);
assert.ok(h2 >= 0 && h2 < 1);
assert.equal(hash2(3, 4, 9), h2, 'hash2 is stateless');

assert.equal(clamp(5, 0, 1), 1);
assert.equal(clamp(-5, 0, 1), 0);
assert.equal(smoothstep(0, 1, 0.5), 0.5);

const n1 = makeNoise(7);
const n2 = makeNoise(7);
const n3 = makeNoise(8);
let lo = Infinity;
let hi = -Infinity;
let differs = false;
for (let i = 0; i < 4000; i++) {
  const x = i * 0.137;
  const y = i * 0.291;
  const v = n1(x, y);
  assert.equal(v, n2(x, y), 'same noise seed must match');
  if (v !== n3(x, y)) differs = true;
  lo = Math.min(lo, v);
  hi = Math.max(hi, v);
}
assert.ok(differs, 'different noise seeds must differ');
assert.ok(lo > -1.05 && hi < 1.05, `noise range ${lo}..${hi}`);
assert.ok(hi - lo > 1, 'noise must vary');
assert.ok(Math.abs(n1(0, 0)) < 1e-12, 'gradient noise is zero on lattice points');

const f = fbm(n1, 1.3, 2.7, 6, 2, 0.5);
assert.ok(Math.abs(f) <= 1.05, 'fbm stays near [-1, 1]');
const r = ridgedFbm(n1, 1.3, 2.7, 6, 2.1, 0.5, 2);
assert.ok(r >= 0 && r < 2, 'ridged output is non-negative and bounded');

console.log('CheckRng: all checks passed');
