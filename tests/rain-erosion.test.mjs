import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_RAIN_EROSION,
  applyRainErosion,
  resolveRainErosionParams,
} from '../src/erosion/rock-rain-erosion.js';

/**
 * Builds a narrow-band SDF for an analytic sphere — the smallest realistic stand-in for the
 * sparse rock SDF that the rain solver operates on.
 */
function buildSphereSdf(radius = 4, voxel = 0.09, bandVoxels = 3) {
  const pad = bandVoxels * voxel + voxel;
  const half = radius + pad;
  const nx = Math.ceil((half * 2) / voxel);
  const gx = nx + 1;
  const gy = gx;
  const gz = gx;
  const originX = -half;
  const originY = -half;
  const originZ = -half;
  const values = new Float32Array(gx * gy * gz).fill(NaN);
  const strideY = gx;
  const strideZ = gx * gy;
  const band = bandVoxels * voxel;

  for (let iz = 0; iz < gz; iz++) {
    const z = originZ + iz * voxel;
    for (let iy = 0; iy < gy; iy++) {
      const y = originY + iy * voxel;
      for (let ix = 0; ix < gx; ix++) {
        const x = originX + ix * voxel;
        const d = Math.hypot(x, y, z) - radius;
        if (Math.abs(d) <= band) values[ix + iy * strideY + iz * strideZ] = d;
      }
    }
  }

  const activeBrickCoords = [];
  const nb = Math.ceil(nx / 4);
  for (let bz = 0; bz < nb; bz++) {
    for (let by = 0; by < nb; by++) {
      for (let bx = 0; bx < nb; bx++) {
        activeBrickCoords.push(bx, by, bz, bx + nb * (by + nb * bz));
      }
    }
  }

  return {
    nx, ny: nx, nz: nx, gx, gy, gz, strideY, strideZ,
    originX, originY, originZ,
    voxelSize: voxel,
    values,
    activeBrickCoords,
    nbx: nb, nby: nb, nbz: nb,
    scale: radius * 2,
    groundY: null,
    sampleWorld(wx, wy, wz) {
      return Math.hypot(wx, wy, wz) - radius;
    },
    ensureSample(ix, iy, iz) {
      return values[ix + iy * strideY + iz * strideZ];
    },
  };
}

function stats(values) {
  let sum = 0;
  let solid = 0;
  let min = Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v < 0) solid++;
    sum += v;
  }
  return { sum, min, solid };
}

test('Rain erosion params are sanitised, aliased from the inspector and bounded', () => {
  const defaults = resolveRainErosionParams({});
  assert.equal(defaults.enabled, false);
  assert.ok(defaults.erosionDepth > 0 && defaults.erosionDepth < 0.25);

  const on = resolveRainErosionParams({ rainErosion: true, erosionStrength: 99, bakeQuality: 99 });
  assert.equal(on.enabled, true);
  assert.equal(on.erosionStrength, 1.6);
  assert.equal(on.bakeQuality, 2.8);

  const off = resolveRainErosionParams({ enabled: false, rainErosion: true });
  assert.equal(off.enabled, false, 'explicit enabled flag must win over the alias');
});

test('Rain erosion carves only rain-wetted rock surface and never melts the whole formation', () => {
  const sdf = buildSphereSdf();
  const before = stats(sdf.values);

  const result = applyRainErosion(sdf, {
    enabled: true,
    seed: 4242,
    rainIntensity: 0.55,
    erosionStrength: 0.7,
    sedimentCapacity: 0.8,
    depositionRate: 0.4,
    erosionDepth: 0.09,
    rillStrength: 0.7,
    steps: 80,
  });

  assert.ok(result.droplets > 0, 'droplets must actually spawn');
  assert.ok(result.erodedCells > 0, 'surface cells must be eroded');
  assert.ok(result.maxCarve > 0, 'carve depth must be positive');
  assert.ok(
    result.maxCarve <= result.maxDepth + 1e-6,
    `max carve ${result.maxCarve} must respect the soft depth cap ${result.maxDepth}`
  );

  const after = stats(sdf.values);
  // Carving pushes the zero-crossing inwards, i.e. the signed distance values GROW.
  assert.ok(after.sum > before.sum, 'erosion must carve the surface inwards');
  // But it must remain a rock, not a shrunken blob: most of the solid band is still solid.
  assert.ok(after.solid > before.solid * 0.6,
    `rock must survive erosion (solid band ${before.solid} -> ${after.solid} cells)`);
});

test('Rain erosion is fully deterministic for a given seed and bakes identical SDFs', () => {
  const a = buildSphereSdf();
  const b = buildSphereSdf();
  const opts = {
    enabled: true,
    seed: 9001,
    rainIntensity: 0.4,
    erosionStrength: 0.6,
    erosionDepth: 0.08,
    rillStrength: 0.6,
    steps: 60,
  };
  const ra = applyRainErosion(a, opts);
  const rb = applyRainErosion(b, opts);
  assert.equal(ra.droplets, rb.droplets);
  assert.equal(ra.erodedCells, rb.erodedCells);

  let maxDelta = 0;
  for (let i = 0; i < a.values.length; i++) {
    const va = a.values[i];
    const vb = b.values[i];
    if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
    maxDelta = Math.max(maxDelta, Math.abs(va - vb));
  }
  assert.ok(maxDelta < 1e-6, `identical seeds must bake identical SDFs (delta ${maxDelta})`);
});

test('Disabled / dry rain erosion leaves the SDF byte-identical', () => {
  const sdf = buildSphereSdf();
  const copy = Float32Array.from(sdf.values);
  const result = applyRainErosion(sdf, { enabled: true, rainIntensity: 0, erosionStrength: 1 });
  assert.equal(result.skipped, true);
  assert.deepEqual(sdf.values, copy);
  assert.ok(DEFAULT_RAIN_EROSION.rainIntensity > 0);
});
