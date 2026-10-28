import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GridTransform,
  HeightFieldLevel,
  HybridFluidSimulation,
  SparseVolumeGrid,
} from '../src/simulation.js';

test('GridTransform round-trips a point on a rotated, non-uniform grid', () => {
  const transform = new GridTransform({
    origin: [14, -3, 8],
    basis: [[0, 0, 0.5], [0, 0.25, 0], [-0.8, 0, 0]],
  });
  const gridPoint = [3.5, 4, -2.25];
  const world = transform.gridToWorld(gridPoint);
  const recovered = transform.worldToGrid(world);
  recovered.forEach((value, index) => assert.ok(Math.abs(value - gridPoint[index]) < 1e-9));
  assert.deepEqual(transform.worldToCell(world), [3, 4, -3]);
});

test('SparseVolumeGrid allocates only the chunk touched by a world-space deposit', () => {
  const grid = new SparseVolumeGrid({ cellSize: 0.25, chunkSize: 8 });
  grid.beginFrame();
  const deposit = grid.deposit([2.2, 1.1, -0.3], 0.4, [2, -3, 1], 0.6);
  const sample = grid.sampleCell([2.2, 1.1, -0.3]);
  assert.equal(grid.activeChunkCount, 1);
  assert.equal(grid.occupiedCellCount, 8);
  const depositedMass = [...grid.chunks.values()].reduce((total, chunk) => total + chunk.mass.reduce((sum, value) => sum + value, 0), 0);
  assert.ok(Math.abs(depositedMass - 0.4) < 1e-6);
  assert.ok(sample.mass > 0 && sample.mass < 0.4);
  assert.deepEqual(deposit.cell, [8, 4, -2]);
  sample.velocity.forEach((value, index) => assert.ok(Math.abs(value - [2, -3, 1][index]) < 1e-6));
});

test('HeightFieldLevel carries a local impulse through update and re-centers in grid cells', () => {
  const level = new HeightFieldLevel({ resolution: 24, cellSize: 1, center: [0, 0] });
  const touched = level.inject(0, 0, { momentum: 2, radius: 1.2, foam: 0.7 });
  assert.ok(touched > 0);
  const before = level.sample(0, 0);
  assert.ok(before.foam > 0);
  level.update(1 / 60, { waveResponse: 4, damping: 0.3, foamPersistence: 6, foamGain: 0.6 });
  const after = level.sample(0, 0);
  assert.notEqual(after.height, before.height);
  const changed = level.recenter(3, 0);
  assert.equal(changed, true);
  assert.ok(level.sample(0, 0));
});

test('HybridFluidSimulation registers an emitter in both fluid domains', () => {
  const simulation = new HybridFluidSimulation({ dropletCount: 24, maxParticles: 160 });
  const impact = simulation.spawnImpact({ x: 0, z: 22, speed: 8, mass: 1, radius: 1, source: 'test' });
  assert.ok(impact.gridHits.length > 0, 'surface clipmap should receive an impact');
  assert.ok(simulation.particles.length >= 25, 'carrier plus crown droplets should exist');
  assert.equal(simulation.contacts[0].type, 'source');
  assert.equal(simulation.contacts[0].surfaceGrids[0].level, 0);
  assert.equal(simulation.contacts[0].volumeCell.length, 3);
});

test('Falling splash particles transfer back into the surface after stepping', () => {
  const simulation = new HybridFluidSimulation({ dropletCount: 12, maxParticles: 128 });
  simulation.spawnImpact({ x: 0, z: 22, speed: 7, mass: 0.5, radius: 0.7, source: 'test' });
  for (let frame = 0; frame < 180; frame += 1) simulation.step(1 / 60);
  assert.ok(simulation.contacts.some((contact) => contact.type === 'return'));
  assert.ok(simulation.ocean.registrations.length > 1);
  assert.ok(simulation.metrics().registrations >= 2);
});
