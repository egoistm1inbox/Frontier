import test from 'node:test';
import assert from 'node:assert/strict';

import { RockCalvingSystem } from '../src/erosion/rock-calving.js';

/**
 * Builds a deterministic CPU height snapshot: a gentle ridge sloping down in +X, with a
 * flat valley floor. Layout matches the GPU telemetry readback (bedrock, coarse, fine, water).
 */
function buildSnapshot(res = 64, span = 512) {
  const g = new Float32Array(res * res * 4);
  for (let iz = 0; iz < res; iz++) {
    for (let ix = 0; ix < res; ix++) {
      const u = ix / (res - 1);
      const i = (iz * res + ix) * 4;
      const ridge = 18 + 46 * u + 5 * Math.sin(u * Math.PI * 3.0);
      g[i] = ridge;      // bedrock
      g[i + 1] = 0.4;    // coarse talus
      g[i + 2] = 0.05;   // fine alluvium
      g[i + 3] = 0;      // water
    }
  }
  return g;
}

function makeSystem() {
  const sys = new RockCalvingSystem();
  sys.updateTerrainSnapshot(buildSnapshot(64), 64, 512);
  return sys;
}

function groundAt(sys, rock) {
  return sys.sampleTerrain(rock.x, rock.z).totalH;
}

test('Rock rigid bodies actually FALL under gravity instead of tracking the surface', () => {
  const sys = makeSystem();
  const st = sys.sampleTerrain(0, 0);
  const rock = {
    submesh: 2,
    isOutcrop: false,
    settled: false,
    grounded: false,
    x: 0,
    z: 0,
    y: st.totalH + 30,
    vx: 0, vy: 0, vz: 0,
    sx: 2, sy: 2, sz: 2,
    radiusY: 2,
    yaw: 0,
    upX: 0, upY: 1, upZ: 0,
    isSlab: false,
    seedHash: 0.5,
    wear: 0.5,
    wakeTimer: 0,
    spin: 0,
  };
  sys.rocks.push(rock);
  const startY = rock.y;

  for (let i = 0; i < 90; i++) sys.stepPhysics(1 / 60);

  assert.ok(rock.y < startY - 5, `rock should have fallen (y ${startY} -> ${rock.y})`);
  assert.equal(rock.settled, true, 'rock should come to rest on the gentle slope');
  const g = groundAt(sys, rock);
  assert.ok(rock.y >= g - 0.5, 'resting rock must not sink below the terrain');
  assert.ok(rock.y < g + rock.radiusY * 2.0, 'resting rock must not float far above the terrain');
});

test('Instance buckets upload the simulated world Y (not a surface-anchored lift)', () => {
  const sys = makeSystem();
  const st = sys.sampleTerrain(20, 20);
  sys.rocks.push({
    submesh: 3,
    isOutcrop: false,
    settled: false,
    grounded: false,
    x: 20, z: 20, y: st.totalH + 12,
    vx: 0, vy: 0, vz: 0,
    sx: 1.5, sy: 1.5, sz: 1.5,
    radiusY: 1.5,
    yaw: 0.3,
    upX: 0, upY: 1, upZ: 0,
    isSlab: false,
    seedHash: 0.25,
    wear: 0.4,
    wakeTimer: 0,
    spin: 0,
  });
  sys._rebuildInstanceBuckets();
  const arr = sys.bucketData[3];
  const slot = sys.bucketCounts[3] - 1;
  assert.ok(slot >= 0);
  assert.ok(Math.abs(arr[slot * 16 + 13] - sys.rocks[0].y) < 1e-3, 'bucket stores the simulated Y');
});

test('Seeded boulder fields settle on stable ground and never cling to cliffs', () => {
  const sys = makeSystem();
  sys.seedForLandscape({ seed: 4029, worldSpan: 512, boulderDensity: 0.7, rockfallRate: 0.5, strataStrike: 22, strataDip: 8 });
  assert.ok(sys.rocks.length > 5, 'landscape must be seeded with outcrops and boulders');
  for (let i = 0; i < 120; i++) sys.stepPhysics(1 / 60);
  for (const r of sys.rocks) {
    const s = sys.sampleTerrain(r.x, r.z);
    if (r.isOutcrop) continue;
    if (r.settled) {
      assert.ok(s.slope < 0.5, `settled boulder should rest on a stable slope (slope ${s.slope.toFixed(2)})`);
      assert.ok(r.y > s.totalH - 0.75, 'settled boulder must not be buried below the terrain');
    }
  }
});
