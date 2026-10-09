// Physical checks for the solvers. Each test states the invariant it protects.
// Run: node CheckErosion.mjs
import assert from 'node:assert/strict';
import { makeNoise, fbm } from './js/core/noise.js';
import { routeFlow } from './js/core/flow.js';
import { erodeHydraulic } from './js/erosion/hydraulic.js';
import { erodeThermal } from './js/erosion/thermal.js';
import { erodeFluvial } from './js/erosion/fluvial.js';

const N = 80;
const CELL = 16;
const HEIGHT = 1000;

function testTerrain(seed = 5, lo = 0.25, hi = 0.8) {
  const noise = makeNoise(seed);
  const h = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const v = fbm(noise, (x / (N - 1)) * 2.2, (y / (N - 1)) * 2.2, 6, 2, 0.5);
      h[y * N + x] = Math.min(hi, Math.max(lo, 0.5 + 1.2 * v));
    }
  }
  return h;
}

const sum = (a) => a.reduce((s, v) => s + v, 0);
const finite = (a) => a.every((v) => Number.isFinite(v));

// ---------------------------------------------------------------- hydraulic
const hydro = {
  density: 1.0, lifetime: 50, inertia: 0.05, capacity: 4, minSlope: 0.01,
  erodeSpeed: 0.15, depositSpeed: 0.15, evaporation: 0.01, gravity: 4, radius: 3,
  seed: 11, cellM: CELL, heightM: HEIGHT,
};
{
  const h = testTerrain(5, 0.25, 0.97);
  const before = Float32Array.from(h);
  const sumBefore = sum(before);
  const peakBefore = Math.max(...before);
  const res = await erodeHydraulic(h, N, hydro);
  assert.ok(res, 'hydraulic run should finish');
  assert.ok(finite(h), 'hydraulic output must be finite');
  // Mass: every unit removed by erosion is either deposited on the map or carried out of it.
  const dMass = sum(h) - sumBefore;
  assert.ok(Math.abs(dMass + res.lost) < 0.02 * Math.max(1, res.eroded), `mass balance: d=${dMass} lost=${res.lost}`);
  assert.ok(Math.max(...h) < peakBefore, 'droplets lower the highest peak');
  assert.ok(res.eroded > 0 && res.deposited > 0, 'both erosion and deposition happen');
  assert.ok(res.deposition.some((v) => v > 0), 'a deposition map is returned');
  // Determinism: the same seed gives the same surface.
  const again = testTerrain(5, 0.25, 0.97);
  await erodeHydraulic(again, N, hydro);
  let same = again.length === h.length;
  for (let i = 0; same && i < h.length; i++) same = again[i] === h[i];
  assert.ok(same, 'same seed, same result');
  console.log(`hydraulic: mass balance ok (lost ${res.lost.toFixed(3)}), peak ${peakBefore.toFixed(3)} -> ${Math.max(...h).toFixed(3)}`);
}

// ---------------------------------------------------------------- thermal
{
  // A steep mound of radius 8 cells on a flat base. Its flanks are about 51° at these scales. Material moves
  // about one cell per pass, so the mound has to be small enough to settle within the pass budget.
  const h = new Float32Array(N * N).fill(0.5);
  const c = (N - 1) / 2;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const d = Math.hypot(x - c, y - c);
      if (d < 8) h[y * N + x] = 0.5 + 0.02 * (8 - d);
    }
  }
  const sumBefore = sum(h);
  const res = await erodeThermal(h, N, { talus: 35, rate: 0.5, iterations: 900, cellM: CELL, heightM: HEIGHT });
  assert.ok(res, 'thermal run should finish');
  assert.ok(finite(h));
  // Float32 storage limits the balance to about 1e-5 of the material moved, so the tolerance is relative.
  const dMass = sum(h) - sumBefore;
  assert.ok(Math.abs(dMass + res.lost) < 1e-4 * Math.abs(res.lost) + 1e-3, `thermal mass balance ${dMass} + ${res.lost}`);
  // Slopes around the mound (every neighbour inside the map, away from the open border) must sit at or below the talus.
  let worst = 0;
  for (let y = 4; y < N - 4; y++) {
    for (let x = 4; x < N - 4; x++) {
      const i = y * N + x;
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1], [-1, 0], [0, -1], [-1, -1], [-1, 1]]) {
        const j = (y + dy) * N + (x + dx);
        const step = Math.hypot(dx, dy) * CELL;
        const slope = ((h[i] - h[j]) * HEIGHT) / step;
        const deg = (Math.atan(slope) * 180) / Math.PI;
        if (deg > worst) worst = deg;
      }
    }
  }
  assert.ok(worst < 36.5, `steepest slope ${worst.toFixed(2)}° should be at or below the 35° talus`);
  assert.ok(res.deposition.some((v) => v > 0), 'talus deposits material at the foot of the slope');
  console.log(`thermal: steepest slope after 900 passes ${worst.toFixed(2)}° (talus 35°), mass balance ok`);
}

// ---------------------------------------------------------------- flow routing
{
  const h = testTerrain(9, 0.2, 0.9);
  // A pit in the middle must be filled so that water still reaches the border.
  const mid = (N / 2) * N + N / 2;
  h[mid] = 0.05;
  const { filled, down, area, order } = routeFlow(h, N);
  assert.equal(order.length, N * N, 'every cell is visited once');
  for (let c = 0; c < N * N; c++) {
    let steps = 0;
    let cur = c;
    while (down[cur] >= 0 && steps <= N * N) {
      const nx = down[cur];
      assert.ok(filled[nx] < filled[cur], 'downstream cells are strictly lower on the filled surface');
      cur = nx;
      steps++;
    }
    const x = cur % N;
    const y = Math.floor(cur / N);
    assert.ok(x === 0 || y === 0 || x === N - 1 || y === N - 1, `cell ${c} drains to the border`);
  }
  let outletArea = 0;
  for (let c = 0; c < N * N; c++) {
    const x = c % N;
    const y = Math.floor(c / N);
    if (x === 0 || y === 0 || x === N - 1 || y === N - 1) outletArea += area[c];
  }
  assert.equal(outletArea, N * N, 'drainage area at the outlets adds up to the whole map');
  // The pit was filled to just above its lowest spill point.
  assert.ok(filled[mid] > h[mid], 'depression is filled');
  console.log('flow: every cell drains to the border, outlets collect all', N * N, 'cells');
}

// ---------------------------------------------------------------- fluvial
{
  const h = testTerrain(3, 0.3, 0.85);
  const before = Float32Array.from(h);
  // Pure incision: no uplift, no diffusion. Heights may only fall.
  const res = await erodeFluvial(h, N, {
    erodibility: 0.05, areaExponent: 0.5, slopeExponent: 1.0, uplift: 0, diffusion: 0, timeStep: 1, iterations: 25, cellM: CELL, heightM: HEIGHT,
  });
  assert.ok(res, 'fluvial run should finish');
  let rose = 0;
  for (let i = 0; i < h.length; i++) if (h[i] > before[i] + 1e-7) rose++;
  assert.equal(rose, 0, 'pure incision never raises the ground');
  assert.ok(sum(before) - sum(h) > 0, 'incision removes material');
  assert.ok(res.flow && res.flow.length === N * N, 'the drainage area is returned');
  // With uplift and diffusion the surface stays within the normalised range.
  const h2 = testTerrain(3, 0.3, 0.85);
  const res2 = await erodeFluvial(h2, N, {
    erodibility: 0.04, areaExponent: 0.5, slopeExponent: 1.0, uplift: 0.002, diffusion: 0.1, timeStep: 1, iterations: 40, cellM: CELL, heightM: HEIGHT,
  });
  assert.ok(res2 && finite(h2));
  assert.ok(Math.max(...h2) <= 1 + 1e-6, 'uplift is capped at the top of the range');
  assert.ok(Math.min(...h2) >= -1e-6, 'heights stay non-negative');
  console.log(`fluvial: incision only (${rose} rising cells), uplift run capped at ${Math.max(...h2).toFixed(4)}`);
}

// ---------------------------------------------------------------- cancellation
{
  const h = testTerrain();
  let calls = 0;
  const res = await erodeHydraulic(h, N, hydro, {
    tick: async () => {},
    cancelled: () => ++calls > 1,
  });
  assert.equal(res, null, 'a cancelled droplet run returns null');
  console.log('cancellation: solvers stop at their next yield point');
}

console.log('CheckErosion: all checks passed');
