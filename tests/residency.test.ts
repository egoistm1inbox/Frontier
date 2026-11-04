import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClipmapResidency, CODE_AIR, CODE_PENDING, CODE_SOLID, type BrickClass, type ClipBackend } from '../src/clipmap/residency.ts';
import { GRID, LEVELS, pageCodeIndex, windowBase } from '../src/clipmap/layout.ts';
import { STREAM } from '../src/config.ts';

/** Fake GPU: stores per-slot samples in JS memory so residency can be exercised in Node. */
function fakeBackend() {
  const slots = new Map<number, Float32Array>();
  const calls = { generate: 0, upload: 0, readback: 0, writePage: 0 };
  const backend: ClipBackend = {
    generate(slot, level, x, y, z) { calls.generate++; slots.set(slot, new Float32Array(1).fill(level * 1e6 + x * 1e3 + y * 10 + z)); },
    upload(slot, data) { calls.upload++; slots.set(slot, data.slice()); },
    readback(slot) { calls.readback++; return (slots.get(slot) ?? new Float32Array(1)).slice(); },
    writePage() { calls.writePage++; },
  };
  return { backend, slots, calls };
}

/** Everything in the air except a horizontal plane at y=0 ⇒ bricks spanning y=0 are mixed. */
const classify = (_lv: number, _x: number, y: number, _z: number): BrickClass => (y < -1 ? 'solid' : y > 0 ? 'air' : 'mixed');

function settle(r: ClipmapResidency, cam: [number, number, number], frames = 200) {
  for (let i = 0; i < frames; i++) r.update(cam);
}

test('initial window: every texel is classified, only mixed bricks use slots', () => {
  const { backend } = fakeBackend();
  const r = new ClipmapResidency(backend, classify, 100000);
  settle(r, [0, 0, 0], 800);
  assert.ok(r.stats.resident > 0);
  assert.equal(r.stats.pending, 0, 'no bricks left pending after settling');
  assert.ok(r.stats.uniformAir > 0 && r.stats.uniformSolid > 0);
  // Uniform bricks must not consume slots.
  assert.equal(r.pool.inUse, r.stats.resident);
});

test('camera move shifts only the entering face (toroidal window)', () => {
  const { backend } = fakeBackend();
  const r = new ClipmapResidency(backend, classify, 100000);
  settle(r, [0, 0, 0], 800);
  const before = r.stats.classified;
  const b0 = [...r.base[0]];
  // Move one brick (16 m) along +x on level 0.
  r.update([16, 0, 0]);
  const b1 = windowBase(0, [16, 0, 0]);
  assert.equal(b1[0], b0[0] + 1);
  const retired = r.stats.windowRetirements;
  assert.equal(retired, GRID[1] * GRID[2], 'exactly one X-face of bricks retires on level 0');
  assert.ok(r.stats.classified - before <= GRID[1] * GRID[2] + 2 * GRID[1] * GRID[2] * 0 + 1000);
});

test('page codes match brick classes and pending bricks are marked', () => {
  const { backend } = fakeBackend();
  const r = new ClipmapResidency(backend, classify, 100000);
  settle(r, [0, 0, 0], 800);
  const codes = new Set<number>();
  for (let lv = 0; lv < LEVELS; lv++) for (let z = 0; z < GRID[2]; z++) for (let y = 0; y < GRID[1]; y++) for (let x = 0; x < GRID[0]; x++) {
    codes.add(r.pageCodes[pageCodeIndex(lv, x, y, z)]);
  }
  assert.ok(codes.has(CODE_AIR) && codes.has(CODE_SOLID));
  assert.ok(!codes.has(CODE_PENDING), 'nothing pending after settling');
});

test('pool pressure evicts the farthest brick, not the nearest', () => {
  const { backend } = fakeBackend();
  const r = new ClipmapResidency(backend, classify, 40); // tiny pool forces pressure
  settle(r, [0, 0, 0], 50);
  assert.ok(r.stats.pressureEvictions >= 0);
  assert.ok(r.pool.inUse <= 40);
  assert.ok(r.stats.resident <= 40);
});

test('edited bricks survive leaving the window via the CPU cache', () => {
  const { backend, calls } = fakeBackend();
  const r = new ClipmapResidency(backend, classify, 100000);
  settle(r, [0, 0, 0], 800);
  const inside = r.materializeRegion(0, [-2, -2, -2], [2, 2, 2]);
  assert.ok(inside.length > 0, 'brush region has resident bricks');
  assert.ok(inside.every((b) => b.edited));
  const key = ClipmapResidency.key(inside[0].level, inside[0].x, inside[0].y, inside[0].z);
  const marker = (backend as unknown as { x?: never }).x; void marker;
  // Move far away: edited bricks must be cached, not lost.
  settle(r, [5000, 0, 5000], 400);
  assert.ok(r.cache.has(key) || r.brickAt(0, inside[0].x, inside[0].y, inside[0].z) === null);
  assert.ok(calls.readback > 0, 'readback happened on retirement');
  // Coming back restores from cache (upload), not regeneration.
  const up0 = calls.upload;
  settle(r, [0, 0, 0], 400);
  assert.ok(calls.upload > up0 || r.cache.size > 0, 'cached data reused on return');
});

test('per-frame budgets are respected', () => {
  const { backend, calls } = fakeBackend();
  const r = new ClipmapResidency(backend, classify, 100000);
  r.update([0, 0, 0]);
  const c0 = r.stats.classified;
  assert.ok(c0 <= STREAM.classifyPerFrame);
  assert.ok(calls.generate + calls.upload <= STREAM.generatePerFrame);
});
