import test from 'node:test';
import assert from 'node:assert/strict';
import { RockRainErosion } from '../src/erosion/rock-rain-erosion.js';

/** Builds a small dome "rock" mesh with the same layout the studio's generator emits. */
function makeDomeMesh(segments = 48) {
  const positions = [];
  const normals = [];
  const indices = [];
  const half = 5;
  for (let j = 0; j <= segments; j++) {
    for (let i = 0; i <= segments; i++) {
      const x = (i / segments) * 2 - 1;
      const z = (j / segments) * 2 - 1;
      const wx = x * half;
      const wz = z * half;
      const wy = Math.sqrt(Math.max(0, half * half - wx * wx - wz * wz)) * 0.9;
      positions.push(wx, wy, wz);
      const l = Math.hypot(wx, wy + 0.001, wz) || 1;
      normals.push(wx / l, wy / l, wz / l);
    }
  }
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * (segments + 1) + i;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

test('Rock rain erosion carves the surface, stays finite and is fully reversible', () => {
  const mesh = makeDomeMesh(40);
  const pristine = new Float32Array(mesh.positions);
  const sim = new RockRainErosion({
    running: true,
    rainIntensity: 0.8,
    erosionStrength: 0.7,
    deposition: 0.5,
  });
  sim.setMesh(mesh);

  for (let f = 0; f < 90; f++) sim.step(1 / 60);
  assert.ok(sim.ready, 'solver topology should be built');
  assert.ok(sim.dropletCount > 0, 'raindrops should be simulated');

  sim.writeGeometry();
  let moved = 0;
  let maxMove = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const dx = mesh.positions[i] - pristine[i];
    const dy = mesh.positions[i + 1] - pristine[i + 1];
    const dz = mesh.positions[i + 2] - pristine[i + 2];
    const d = Math.hypot(dx, dy, dz);
    assert.ok(Number.isFinite(d), 'vertex positions must stay finite');
    if (d > 1e-5) moved++;
    if (d > maxMove) maxMove = d;
  }
  assert.ok(moved > 50, `expected many eroded vertices, got ${moved}`);
  assert.ok(maxMove > 0.0005, `expected visible erosion, got ${maxMove}`);
  assert.ok(maxMove <= sim.maxCut + 1e-3, 'displacement may never exceed the cut limit');

  // Normals must remain unit length after the write-back
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const l = Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]);
    assert.ok(Math.abs(l - 1) < 1e-3, `normal ${i / 3} not normalised (${l})`);
  }

  sim.reset();
  let restoredMax = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const d = Math.hypot(
      mesh.positions[i] - pristine[i],
      mesh.positions[i + 1] - pristine[i + 1],
      mesh.positions[i + 2] - pristine[i + 2]
    );
    if (d > restoredMax) restoredMax = d;
  }
  assert.ok(restoredMax < 1e-6, `reset should restore the pristine mesh (${restoredMax})`);
});

test('Rain erosion only advances while running and respects the visible-rain toggle', () => {
  const mesh = makeDomeMesh(24);
  const sim = new RockRainErosion({ running: false });
  sim.setMesh(mesh);
  assert.equal(sim.step(1 / 60), false);
  assert.equal(sim.ready, false, 'topology is built lazily when erosion starts');

  sim.setParams({ running: true, dropletRate: 600, maxSpawnPerFrame: 40 });
  sim.step(1 / 60);
  assert.equal(sim.ready, true);
  const rain = sim.getRainDrawData();
  assert.ok(rain && rain.count > 0, 'rain visuals should be available');
  sim.setParams({ showRain: false });
  assert.equal(sim.getRainDrawData(), null);
});
