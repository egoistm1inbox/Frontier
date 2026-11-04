import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SlotPool } from '../src/clipmap/slotPool.ts';

test('acquire/release round trip and exhaustion', () => {
  const p = new SlotPool(3);
  const a = p.acquire(), b = p.acquire(), c = p.acquire();
  assert.deepEqual([a, b, c].sort(), [0, 1, 2]);
  assert.equal(p.acquire(), -1);
  p.release(b);
  assert.equal(p.acquire(), b);
  assert.equal(p.inUse, 3);
});

test('releasing an out-of-range slot throws', () => {
  const p = new SlotPool(2);
  assert.throws(() => p.release(5));
});
