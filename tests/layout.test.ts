import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRID, atlasDims, brickSize, cellSize, estimateVram, pageCodeIndex, PAGE_DIMS, posMod, slotOrigin, windowBase, LEVELS } from '../src/clipmap/layout.ts';
import { VRAM_BUDGET_BYTES } from '../src/config.ts';

test('cell and brick sizes double per level', () => {
  assert.equal(cellSize(0), 0.5);
  assert.equal(cellSize(7), 64);
  assert.equal(brickSize(0), 16);
  assert.equal(brickSize(1), 32);
});

test('posMod handles negatives', () => {
  assert.equal(posMod(-1, 16), 15);
  assert.equal(posMod(17, 16), 1);
  assert.equal(posMod(-16, 16), 0);
});

test('window is centred on the camera brick', () => {
  const b = windowBase(0, [0.1, 0.1, 0.1]);
  assert.deepEqual(b, [-8, -4, -8]);
});

test('atlas and slot origins stay inside the atlas', () => {
  const [w, h, d] = atlasDims();
  for (const s of [0, 1, 255, 256, 8191]) {
    const [ox, oy, oz] = slotOrigin(s);
    assert.ok(ox + 34 <= w && oy + 34 <= h && oz + 34 <= d, `slot ${s}`);
  }
  assert.equal(d % 34, 0);
});

test('page addressing is unique per level and texel', () => {
  const seen = new Set<number>();
  for (let lv = 0; lv < LEVELS; lv++) for (let z = 0; z < GRID[2]; z++) for (let y = 0; y < GRID[1]; y++) for (let x = 0; x < GRID[0]; x++) {
    const i = pageCodeIndex(lv, x, y, z);
    assert.ok(i >= 0 && i < PAGE_DIMS[0] * PAGE_DIMS[1] * PAGE_DIMS[2]);
    assert.ok(!seen.has(i));
    seen.add(i);
  }
});

test('atlas fits the VRAM budget with room for everything else', () => {
  const v = estimateVram(2048);
  assert.ok(v.totalBytes < VRAM_BUDGET_BYTES, `total ${v.totalBytes}`);
  assert.ok(v.totalBytes > 400 * 1024 * 1024, 'atlas should be a substantial part of the budget');
});
