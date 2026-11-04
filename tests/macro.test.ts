import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bakeCoastField } from '../src/world/coastField.ts';
import { africaPolygonM } from '../src/world/africa.ts';
import { lonLatToWorld } from '../src/world/macroParams.ts';
import { macroHeight, macroSDF, type MacroField } from '../src/world/macroReference.ts';
import { hash3, vnoise3 } from '../src/world/noise.ts';

const field: MacroField = { coast: bakeCoastField(africaPolygonM(), 1024, 4000, 64) };

test('hash is deterministic and spreads values', () => {
  assert.equal(hash3(1, 2, 3), hash3(1, 2, 3));
  assert.notEqual(hash3(1, 2, 3), hash3(3, 2, 1));
  let lo = 0, hi = 0;
  for (let i = 0; i < 2000; i++) { const v = vnoise3(i * 0.37, i * 0.11, i * 0.23); if (v < 0) lo++; else hi++; }
  assert.ok(lo > 600 && hi > 600, `balanced noise (${lo}/${hi})`);
});

test('macro SDF: sky above ocean, solid well below the land surface', () => {
  const [jx, jz] = lonLatToWorld(28.04, -26.2);
  const h = macroHeight(field, jx, jz, 8);
  assert.ok(h > 800 && h < 3000, `Highveld height plausible (${h.toFixed(0)} m)`);
  assert.ok(macroSDF(field, jx, h + 200, jz) > 0, 'air above terrain');
  assert.ok(macroSDF(field, jx, h - 200, jz) < 0, 'solid below terrain');
  const [ox, oz] = lonLatToWorld(-30, 0);
  assert.ok(macroHeight(field, ox, oz, 8) < -2000, 'deep ocean floor');
});

test('macro SDF gradient is bounded (safe for sphere tracing with step factor ~0.6)', () => {
  const [jx, jz] = lonLatToWorld(28.04, -26.2);
  const e = 0.5;
  let worst = 0;
  for (let k = 0; k < 200; k++) {
    const x = jx + k * 37.3, z = jz + k * 19.7, y = 1500 + k * 1.1;
    const c = macroSDF(field, x, y, z, 8);
    const gx = (macroSDF(field, x + e, y, z, 8) - c) / e;
    const gy = (macroSDF(field, x, y + e, z, 8) - c) / e;
    const gz = (macroSDF(field, x, y, z + e, 8) - c) / e;
    worst = Math.max(worst, Math.hypot(gx, gy, gz));
  }
  assert.ok(worst < 3, `max |grad| ${worst.toFixed(2)}`);
});
