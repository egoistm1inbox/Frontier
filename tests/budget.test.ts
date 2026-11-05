// Budget regression: the pool must hold every mixed brick a camera window needs, and the whole
// engine must stay inside the 1 GB VRAM budget. Uses the real CPU classifier and coastline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POOL, VRAM_BUDGET_BYTES, WORLD } from '../src/config.ts';
import { africaPolygonM } from '../src/world/africa.ts';
import { bakeCoastField } from '../src/world/coastField.ts';
import { lonLatToWorld } from '../src/world/macroParams.ts';
import { macroHeight, type MacroField } from '../src/world/macroReference.ts';
import { classifyBrick } from '../src/clipmap/classify.ts';
import { GRID, LEVELS, estimateVram, windowBase, type V3 } from '../src/clipmap/layout.ts';

const field: MacroField = {
  coast: bakeCoastField(africaPolygonM(), WORLD.coastTexels, WORLD.halfExtentM / 1000, WORLD.coastBandKm),
};

function mixedInWindow(cam: V3): number {
  let n = 0;
  for (let lv = 0; lv < LEVELS; lv++) {
    const b = windowBase(lv, cam);
    for (let z = 0; z < GRID[2]; z++) for (let y = 0; y < GRID[1]; y++) for (let x = 0; x < GRID[0]; x++) {
      if (classifyBrick(field, lv, b[0] + x, b[1] + y, b[2] + z) === 'mixed') n++;
    }
  }
  return n;
}

test('every camera window fits in the brick pool', () => {
  const spots: Array<[number, number]> = [
    lonLatToWorld(28.32, -26.19), // Benoni
    lonLatToWorld(3.4, 6.45), // Lagos
    lonLatToWorld(37.35, -3.07), // Kilimanjaro
    lonLatToWorld(10, 25), // Sahara
  ];
  for (const [x, z] of spots) {
    const cam: V3 = [x, macroHeight(field, x, z, 8) + 4, z];
    const need = mixedInWindow(cam);
    assert.ok(need <= POOL.slots, `window at (${x.toFixed(0)}, ${z.toFixed(0)}) needs ${need} > ${POOL.slots}`);
  }
});

test('total VRAM stays inside the 1 GB budget', () => {
  const v = estimateVram(WORLD.coastTexels);
  assert.ok(v.totalBytes < VRAM_BUDGET_BYTES, `${v.totalBytes} bytes exceeds ${VRAM_BUDGET_BYTES}`);
});
