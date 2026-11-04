import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bakeCoastField, sampleCoastKm } from '../src/world/coastField.ts';
import { africaPolygonM } from '../src/world/africa.ts';
import { lonLatToWorld } from '../src/world/macroParams.ts';

const field = bakeCoastField(africaPolygonM(), 1024, 4000, 64);

test('coast SDF: inland is negative, ocean is positive', () => {
  const [jx, jz] = lonLatToWorld(28.04, -26.2); // Johannesburg / Benoni area
  assert.ok(sampleCoastKm(field, jx, jz) <= -64 + 1e-3, "Johannesburg is beyond the 64 km band, so it saturates inland");
  const [ax, az] = lonLatToWorld(-30, 0); // mid-Atlantic
  assert.ok(sampleCoastKm(field, ax, az) > 0, 'mid-Atlantic should be ocean');
  const [ex, ez] = lonLatToWorld(70, -5); // Indian Ocean
  assert.ok(sampleCoastKm(field, ex, ez) > 0, 'Indian Ocean should be ocean');
});

test('coast SDF is 1-Lipschitz-ish away from the band (|Δd| ≤ Δx)', () => {
  const cs = 8000 / 1024;
  for (let k = 0; k < 200; k++) {
    const x = -3000e3 + k * 29e3, z = -1000e3 + k * 11e3;
    const a = sampleCoastKm(field, x, z), b = sampleCoastKm(field, x + 1000, z);
    assert.ok(Math.abs(a - b) <= 1.0 + 1e-6 + cs * 0, `gradient jump at k=${k}: ${a} vs ${b}`);
  }
});

test('coast SDF values are truncated to the band', () => {
  for (let i = 0; i < field.data.length; i += 997) {
    assert.ok(Math.abs(field.data[i]) <= 64 + 1e-6);
  }
});
