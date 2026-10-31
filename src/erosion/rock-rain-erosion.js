/**
 * Rain-Only Lagrangian Hydraulic Erosion for 3D SDF Rock & Cliff Formations.
 *
 * This is the same multi-agent *rain* solver used by Terrain Studio's GPU erosion
 * (`erosionStrength` / `sedimentCapacity` / `depositionRate` / `particleInertia`),
 * re-implemented as a high-quality CPU bake directly on the sparse narrow-band 3D SDF:
 *
 *  1. Rain droplets spawn ONLY on real up-facing / vertical rock surfaces (no underside —
 *     rain cannot run uphill!), found by scanning the band of |SDF| < 1 voxel.
 *  2. Each droplet follows the true 3D surface (gradient-projected) downhill along gravity,
 *     accelerating, picking up sediment when it has spare carrying capacity and dropping it
 *     where the slope relaxes (talus aprons, ledges, base of the cliff).
 *  3. Detachment is modulated by (a) ridged vertical rill noise -> discrete rain gullies &
 *     flutes instead of a uniform shrink, and (b) 3D rock hardness noise -> resistant ribs
 *     and cornices survive and get undercut, which is what makes eroded rock look like rock
 *     and not like melted chocolate.
 *  4. The accumulated erosion (a signed depth field) is written into the SDF itself and the
 *     mesh is re-contoured at the high bake resolution, then QEM-decimated afterwards for
 *     the game-ready low-poly LODs. The relief is therefore real geometry, not vertex noise.
 *
 * Why the earlier attempt looked like molten chocolate:
 *   - erosion was applied as a wide, smooth, low-resolution blob (kernel radius >> feature size)
 *   - every surface (including flat ledges and the underside of overhangs) was pushed inward
 *   - no capacity/deposition, so everything just shrank uniformly.
 * Here the splat radius is ~1 voxel at a 2x-3x higher bake resolution, only rain-wetted
 * surfaces are touched, capacity/deposition is honoured, and total depth is soft-saturated.
 */

import { clamp } from '../core/vec3.js';
import { createRng } from '../core/prng.js';
import { scalarField3D } from '../core/spatial-noise.js';

export const DEFAULT_RAIN_EROSION = {
  enabled: false,
  rainIntensity: 0.62,       // droplet count multiplier (0 = dry, 1 = tropical downpour)
  erosionStrength: 0.58,     // hydraulic detachment power (same slate as Terrain Studio)
  sedimentCapacity: 0.72,    // how much rock a droplet can carry
  depositionRate: 0.38,      // alluvial deposition / talus apron build-up
  particleInertia: 0.30,     // momentum carried through the flow (0 = sticky, 1 = slippery)
  erosionDepth: 0.11,       // max carved depth as a fraction of formation scale
  rillStrength: 0.66,        // 0 = uniform sheet erosion, 1 = crisp vertical rain gullies
  bakeQuality: 1.8,          // extra voxel density reserved for the erosion bake (1.0 - 2.6x)
  steps: 96,                 // droplet life in surface steps
  radiusVoxels: 1.15,        // splat radius measured in bake voxels (never widen this!)
  upness: -0.18,             // min surface normal Y a droplet can run on (rains on cliffs, not undersides)
};

export function resolveRainErosionParams(input = {}) {
  const out = { ...DEFAULT_RAIN_EROSION };
  for (const key of Object.keys(DEFAULT_RAIN_EROSION)) {
    if (input[key] !== undefined && input[key] !== null) out[key] = input[key];
  }
  // `rainErosion` is the formation-parameter alias used by the Rock Studio inspector.
  if (input.enabled === undefined && input.rainErosion !== undefined) {
    out.enabled = Boolean(input.rainErosion);
  }
  out.enabled = Boolean(out.enabled);
  out.rainIntensity = clamp(Number(out.rainIntensity) || 0, 0, 1.4);
  out.erosionStrength = clamp(Number(out.erosionStrength) || 0, 0, 1.6);
  out.sedimentCapacity = clamp(Number(out.sedimentCapacity) || 0, 0.02, 1.6);
  out.depositionRate = clamp(Number(out.depositionRate) || 0, 0, 1.5);
  out.particleInertia = clamp(Number(out.particleInertia) || 0, 0, 1);
  out.erosionDepth = clamp(Number(out.erosionDepth) || 0, 0, 0.22);
  out.rillStrength = clamp(Number(out.rillStrength) || 0, 0, 1);
  out.bakeQuality = clamp(Number(out.bakeQuality) || 1, 1, 2.8);
  out.steps = Math.round(clamp(Number(out.steps) || 96, 16, 240));
  out.radiusVoxels = clamp(Number(out.radiusVoxels) || 1.15, 1.0, 2.2);
  out.upness = clamp(Number(out.upness) ?? -0.30, -0.5, 0.5);
  return out;
}

/**
 * Trilinear + nearest-node accessors over the sparse SDF band. Missing (NaN) samples —
 * i.e. air/interior cells outside the narrow band — fall back to the analytic geological
 * SDF so droplets never tunnel through thin features.
 */
function createFieldSampler(sdf) {
  const values = sdf.values;
  const gx = sdf.gx;
  const gy = sdf.gy;
  const gz = sdf.gz;
  const strideY = sdf.strideY;
  const strideZ = sdf.strideZ;
  const originX = sdf.originX;
  const originY = sdf.originY;
  const originZ = sdf.originZ;
  const h = sdf.voxelSize;
  const nx = sdf.nx;
  const ny = sdf.ny;
  const nz = sdf.nz;
  const analytic = sdf.sampleWorld;

  // Cached index of the last node read — droplet paths are coherent, so this is a big win.
  let lastIdx = -1;
  let lastVal = 0;

  function node(ix, iy, iz) {
    if (ix < 0) ix = 0; else if (ix >= gx) ix = gx - 1;
    if (iy < 0) iy = 0; else if (iy >= gy) iy = gy - 1;
    if (iz < 0) iz = 0; else if (iz >= gz) iz = gz - 1;
    const idx = ix + iy * strideY + iz * strideZ;
    if (idx === lastIdx) return lastVal;
    let v = values[idx];
    if (!Number.isFinite(v)) {
      v = analytic(originX + ix * h, originY + iy * h, originZ + iz * h);
    }
    lastIdx = idx;
    lastVal = v;
    return v;
  }

  function sample(wx, wy, wz) {
    const fx = (wx - originX) / h;
    const fy = (wy - originY) / h;
    const fz = (wz - originZ) / h;
    if (fx < 0 || fy < 0 || fz < 0 || fx >= nx || fy >= ny || fz >= nz) {
      return analytic(wx, wy, wz);
    }
    const ix = fx | 0;
    const iy = fy | 0;
    const iz = fz | 0;
    const tx = fx - ix;
    const ty = fy - iy;
    const tz = fz - iz;

    const c000 = node(ix, iy, iz);
    const c100 = node(ix + 1, iy, iz);
    const c010 = node(ix, iy + 1, iz);
    const c110 = node(ix + 1, iy + 1, iz);
    const c001 = node(ix, iy, iz + 1);
    const c101 = node(ix + 1, iy, iz + 1);
    const c011 = node(ix, iy + 1, iz + 1);
    const c111 = node(ix + 1, iy + 1, iz + 1);

    const x00 = c000 + (c100 - c000) * tx;
    const x10 = c010 + (c110 - c010) * tx;
    const x01 = c001 + (c101 - c001) * tx;
    const x11 = c011 + (c111 - c011) * tx;
    const y0 = x00 + (x10 - x00) * ty;
    const y1 = x01 + (x11 - x01) * ty;
    return y0 + (y1 - y0) * tz;
  }

  // Central-difference gradient on the (already trilinear-filled) node lattice.
  function gradient(wx, wy, wz, out) {
    let ix = Math.round((wx - originX) / h);
    let iy = Math.round((wy - originY) / h);
    let iz = Math.round((wz - originZ) / h);
    if (ix < 1) ix = 1; else if (ix > nx - 1) ix = nx - 1;
    if (iy < 1) iy = 1; else if (iy > ny - 1) iy = ny - 1;
    if (iz < 1) iz = 1; else if (iz > nz - 1) iz = nz - 1;

    const inv2h = 0.5 / h;
    let gxV = (node(ix + 1, iy, iz) - node(ix - 1, iy, iz)) * inv2h;
    let gyV = (node(ix, iy + 1, iz) - node(ix, iy - 1, iz)) * inv2h;
    let gzV = (node(ix, iy, iz + 1) - node(ix, iy, iz - 1)) * inv2h;
    const len = Math.hypot(gxV, gyV, gzV);
    if (len > 1e-6) {
      gxV /= len; gyV /= len; gzV /= len;
    } else {
      gxV = 0; gyV = 1; gzV = 0;
    }
    out[0] = gxV;
    out[1] = gyV;
    out[2] = gzV;
    return out;
  }

  // Smooth trilinear central-difference gradient. Used for droplet flow so that voxel-scale
  // stair-stepping on blocky rock does not flip the normal and kill the droplet prematurely.
  function gradientSmooth(wx, wy, wz, out, delta = h * 1.1) {
    const gxV = (sample(wx + delta, wy, wz) - sample(wx - delta, wy, wz));
    const gyV = (sample(wx, wy + delta, wz) - sample(wx, wy - delta, wz));
    const gzV = (sample(wx, wy, wz + delta) - sample(wx, wy, wz - delta));
    const len = Math.hypot(gxV, gyV, gzV);
    if (len > 1e-9) {
      out[0] = gxV / len; out[1] = gyV / len; out[2] = gzV / len;
    } else {
      out[0] = 0; out[1] = 1; out[2] = 0;
    }
    return out;
  }

  return { node, sample, gradient, gradientSmooth, gridRes: [nx, ny, nz], origin: [originX, originY, originZ], h };
}

/**
 * Collects a reservoir-sampled set of surface seed points inside the narrow SDF band.
 * Only real rocks (negative interior cells adjacent to air) are considered.
 */
function collectSurfaceSeeds(sdf, maxSeeds, rng) {
  const values = sdf.values;
  const gx = sdf.gx;
  const gy = sdf.gy;
  const strideY = sdf.strideY;
  const strideZ = sdf.strideZ;
  const h = sdf.voxelSize;
  const originX = sdf.originX;
  const originY = sdf.originY;
  const originZ = sdf.originZ;
  const band = h * 0.85;

  const seeds = new Float32Array(maxSeeds * 3);
  let count = 0;
  let seen = 0;

  function offer(ix, iy, iz, v) {
    seen++;
    if (count < maxSeeds) {
      const o = count * 3;
      seeds[o] = originX + ix * h;
      seeds[o + 1] = originY + iy * h;
      seeds[o + 2] = originZ + iz * h;
      count++;
      return;
    }
    // Reservoir sampling keeps a spatially uniform random subset of the whole band.
    const j = rng.int(0, seen - 1);
    if (j < maxSeeds) {
      const o = j * 3;
      seeds[o] = originX + ix * h;
      seeds[o + 1] = originY + iy * h;
      seeds[o + 2] = originZ + iz * h;
    }
  }

  const coords = sdf.activeBrickCoords;
  const BRICK = 4;
  for (let bi = 0; bi < coords.length; bi += 4) {
    const bx = coords[bi];
    const by = coords[bi + 1];
    const bz = coords[bi + 2];
    const x0 = Math.max(1, bx * BRICK);
    const x1 = Math.min(gx - 2, (bx + 1) * BRICK);
    const y0 = Math.max(1, by * BRICK);
    const y1 = Math.min(gy - 2, (by + 1) * BRICK);
    const z0 = Math.max(1, bz * BRICK);
    const z1 = Math.min(sdf.gz - 2, (bz + 1) * BRICK);
    for (let iz = z0; iz <= z1; iz++) {
      const zOff = iz * strideZ;
      for (let iy = y0; iy <= y1; iy++) {
        const yzOff = zOff + iy * strideY;
        for (let ix = x0; ix <= x1; ix++) {
          const v = values[yzOff + ix];
          if (!Number.isFinite(v) || v > band || v < -band * 1.6) continue;
          offer(ix, iy, iz, v);
        }
      }
    }
  }
  return { seeds, count, scanned: seen };
}

/**
 * Runs rain-only hydraulic erosion directly on `sdf.values` (in place) and returns bake stats.
 *
 * @param {object} sdf   Sparse narrow-band SDF from `evaluateSparseSdf` (mutated in place).
 * @param {object} options Rain erosion parameters (see DEFAULT_RAIN_EROSION).
 * @param {function} onProgress optional (progress01, label) callback.
 */
export function applyRainErosion(sdf, options = {}, onProgress = null) {
  const p = resolveRainErosionParams(options);
  const h = sdf.voxelSize;
  const values = sdf.values;
  const scale = sdf.scale || h * Math.max(sdf.nx, sdf.ny, sdf.nz);
  const maxDepth = Math.max(h * 0.85, p.erosionDepth * scale);
  const maxDeposit = maxDepth * 0.55;

  const rng = createRng((options.seed ?? 4029) ^ 0x5eed1a1);

  if (onProgress) onProgress(0.60, 'Seeding rain droplets on rock surfaces...');

  const sampler = createFieldSampler(sdf);
  const [nx, ny, nz] = sampler.gridRes;
  const [ox, oy, oz] = sampler.origin;

  const intensity = clamp(p.rainIntensity, 0, 1.4);
  if (intensity <= 1e-4 || p.erosionStrength <= 1e-4) {
    return { droplets: 0, steps: 0, erodedCells: 0, depositedCells: 0, maxCarve: 0, elapsedMs: 0, skipped: true };
  }

  const dropletCount = Math.round(clamp(26000 * intensity, 1200, 90000));
  const seedBudget = Math.min(120000, Math.max(6000, dropletCount * 3));
  const { seeds, count: seedCount } = collectSurfaceSeeds(sdf, seedBudget, rng);

  if (seedCount === 0) {
    return { droplets: 0, steps: 0, erodedCells: 0, depositedCells: 0, maxCarve: 0, elapsedMs: 0, skipped: true };
  }

  // Sparse signed erosion field (meters). Positive = carve, negative = deposit.
  const erosion = new Map();
  const touched = [];

  const radius = p.radiusVoxels * h;
  const sigma = radius * 0.62;
  const inv2Sigma2 = 1 / (2 * sigma * sigma);
  const reach = Math.ceil(radius / h) + 1;

  function splat(wx, wy, wz, amount) {
    if (Math.abs(amount) < 1e-9) return;
    const cx = Math.round((wx - ox) / h);
    const cy = Math.round((wy - oy) / h);
    const cz = Math.round((wz - oz) / h);
    let wSum = 0;
    const idxs = [];
    const wts = [];
    for (let iz = cz - reach; iz <= cz + reach; iz++) {
      if (iz < 1 || iz >= nz) continue;
      const dz = (iz * h + oz - wz);
      for (let iy = cy - reach; iy <= cy + reach; iy++) {
        if (iy < 1 || iy >= ny) continue;
        const dy = (iy * h + oy - wy);
        for (let ix = cx - reach; ix <= cx + reach; ix++) {
          if (ix < 1 || ix >= nx) continue;
          const dx = (ix * h + ox - wx);
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > radius * radius) continue;
          const w = Math.exp(-d2 * inv2Sigma2);
          if (w < 1e-3) continue;
          const idx = ix + iy * sdf.strideY + iz * sdf.strideZ;
          if (!Number.isFinite(values[idx])) continue;
          idxs.push(idx);
          wts.push(w);
          wSum += w;
        }
      }
    }
    if (wSum <= 1e-9) return;
    const norm = amount / wSum;
    for (let k = 0; k < idxs.length; k++) {
      const idx = idxs[k];
      const prev = erosion.get(idx);
      if (prev === undefined) {
        erosion.set(idx, norm * wts[k]);
        touched.push(idx);
      } else {
        erosion.set(idx, prev + norm * wts[k]);
      }
    }
  }

  const grad = [0, 1, 0];
  const stepLen = h * 1.5;
  const maxSteps = p.steps;
  const slopeCap = 4.0;
  const vMax = 7.0;
  const gravity = 9.81;
  const inertia = p.particleInertia;
  const maxCarvePerStep = h * 0.34 * p.erosionStrength;
  const maxDepositPerStep = h * 0.075 * p.erosionStrength;
  const rillFreq = 1 / Math.max(scale * 0.11, h * 6);
  const hardnessFreq = 1 / Math.max(scale * 0.22, h * 8);
  const rillSalt = 3131 + (options.seed ?? 4029) % 977;
  const hardnessSalt = 7717 + (options.seed ?? 4029) % 613;

  let dropletsRun = 0;
  let totalSteps = 0;
  let maxCarve = 0;

  const progressEvery = Math.max(1, Math.floor(dropletCount / 24));

  for (let d = 0; d < dropletCount; d++) {
    // Pick a surface seed and make sure rain can actually run on it.
    let sx = 0, sy = 0, sz = 0;
    let found = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      const si = rng.int(0, seedCount - 1) * 3;
      sx = seeds[si];
      sy = seeds[si + 1];
      sz = seeds[si + 2];
      sampler.gradient(sx, sy, sz, grad);
      if (grad[1] >= p.upness) { found = true; break; }
    }
    if (!found) continue;

    dropletsRun++;
    let px = sx, py = sy, pz = sz;
    let speed = 0.8 + rng.float() * 0.6;
    let sediment = 0;

    let prevNx = 0, prevNy = 1, prevNz = 0;
    for (let s = 0; s < maxSteps; s++) {
      totalSteps++;
      sampler.gradientSmooth(px, py, pz, grad);
      // Momentum-blended normal: flowing water does not instantly re-orient on every pebble.
      let nxv = grad[0] * 0.62 + prevNx * 0.38;
      let nyv = grad[1] * 0.62 + prevNy * 0.38;
      let nzv = grad[2] * 0.62 + prevNz * 0.38;
      const nlen = Math.hypot(nxv, nyv, nzv) || 1;
      nxv /= nlen; nyv /= nlen; nzv /= nlen;
      prevNx = nxv; prevNy = nyv; prevNz = nzv;
      if (nyv < p.upness && s > 2) {
        // Water detaches from an overhang and free-falls to the next surface below.
        let landed = false;
        for (let t = 0; t < 20; t++) {
          py -= h * 1.5;
          if (py < oy + h * 2.5) break;
          const dd = sampler.sample(px, py, pz);
          if (dd <= h * 0.55) {
            for (let k = 0; k < 2; k++) {
              sampler.gradientSmooth(px, py, pz, grad);
              const pr = clamp(sampler.sample(px, py, pz), -stepLen, stepLen);
              px -= grad[0] * pr; py -= grad[1] * pr; pz -= grad[2] * pr;
            }
            landed = true;
            speed = Math.min(vMax, speed * 1.25 + 1.0);
            prevNx = 0; prevNy = 1; prevNz = 0;
            break;
          }
        }
        if (!landed) break;
        continue;
      }

      // Tangential gravity projection: flow = down - n (down . n)
      let fx = nxv * nyv;
      let fy = -1 + nyv * nyv;
      let fz = nzv * nyv;
      const flen = Math.hypot(fx, fy, fz);
      if (flen < 1e-3) break;
      fx /= flen; fy /= flen; fz /= flen;

      const slope = clamp(flen / Math.max(nyv, 0.12), 0.02, slopeCap);

      px += fx * stepLen;
      py += fy * stepLen;
      pz += fz * stepLen;

      // Reproject onto the true surface (2 Newton-ish steps along the SDF normal).
      let escaped = false;
      for (let k = 0; k < 2; k++) {
        const dist = sampler.sample(px, py, pz);
        if (dist > stepLen * 2.2) { escaped = true; break; }
        sampler.gradientSmooth(px, py, pz, grad);
        const proj = clamp(dist, -stepLen, stepLen);
        px -= grad[0] * proj;
        py -= grad[1] * proj;
        pz -= grad[2] * proj;
      }

      if (escaped) {
        // The droplet ran off a ledge / lip. Real rain becomes a free-falling sheet here:
        // search downwards for the next rock surface so gullies continue down the cliff face.
        let recovered = false;
        for (let t = 0; t < 16; t++) {
          py -= h * 1.5;
          if (py < oy + h * 2.5) break;
          const dd = sampler.sample(px, py, pz);
          if (dd <= h * 0.55) {
            for (let k = 0; k < 2; k++) {
              sampler.gradientSmooth(px, py, pz, grad);
              const pr = clamp(sampler.sample(px, py, pz), -stepLen, stepLen);
              px -= grad[0] * pr; py -= grad[1] * pr; pz -= grad[2] * pr;
            }
            recovered = true;
            speed = Math.min(vMax, speed * 1.35 + 1.2);
            break;
          }
        }
        if (!recovered) break;
      }
      if (py < oy + h * 2 || py > oy + (ny - 2) * h) break;

      // Acceleration down the true slope (gravity minus inertial drag).
      speed = Math.min(vMax, Math.sqrt(Math.max(0, speed * speed + 2 * gravity * stepLen * slope * (1 - 0.55 * inertia))));

      // 3D differential hardness keeps resistant ribs & cornices while rills concentrate flow.
      const wx = px, wy = py, wz = pz;
      const rillRaw = scalarField3D(
        wx * rillFreq,
        wy * rillFreq * 0.28,
        wz * rillFreq,
        rillSalt
      );
      const rill = clamp(1.0 - Math.abs(rillRaw) * 1.55, 0, 1);
      const rill2Raw = scalarField3D(wx * rillFreq * 2.35 + 7.3, wy * rillFreq * 0.55, wz * rillFreq * 2.35 - 2.1, rillSalt + 41);
      const rill2 = clamp(1.0 - Math.abs(rill2Raw) * 1.9, 0, 1);
      const rillMask = clamp(rill * 0.72 + rill2 * 0.28, 0, 1);
      const hardnessN = 0.5 + 0.5 * scalarField3D(
        wx * hardnessFreq,
        wy * hardnessFreq * 1.7,
        wz * hardnessFreq,
        hardnessSalt
      );
      const hardness = clamp(hardnessN * 0.82 + 0.09, 0.05, 0.98);
      const rillFactor = (1 - p.rillStrength) + p.rillStrength * Math.pow(rillMask, 1.35);
      const erodibility = (1 - hardness) * (1 - hardness) * 1.45 + 0.42;

      // Stream power: capacity grows with velocity and slope.
      const capacity = p.sedimentCapacity * (0.35 + 0.65 * speed / vMax) * Math.min(slope, 3.2) * 0.165;
      const diff = capacity - sediment;

      if (diff > 0) {
        // Runoff accelerates down steep faces -> vertical rain gullies form there, while flat
      // tops only receive gentle sheet-wash (this is what stops the 'melted' look).
      const faceRain = clamp(0.52 + (1.0 - nyv) * 0.62, 0.20, 1.15);
        const amount = Math.min(diff * p.erosionStrength * 1.85, maxCarvePerStep) * rillFactor * erodibility * faceRain;
        if (amount > 1e-7) {
          splat(px, py, pz, amount);
          sediment += amount;
          if (amount > maxCarve) maxCarve = amount;
        }
      } else if (nyv > 0.42) {
        // Only deposit where the surface is gentle enough for talus to actually stay put.
        const amount = Math.min(-diff * p.depositionRate * 1.8, maxDepositPerStep) * (0.35 + 0.65 * (nyv - 0.42) / 0.58);
        const dep = Math.min(amount, sediment);
        if (dep > 1e-7) {
          splat(px, py, pz, -dep);
          sediment -= dep;
        }
      }

      if (py < oy + h * 3) break;
    }

    // Drop what is left where the flow dies out (talus apron / ledge).
    if (sediment > 1e-6) {
      splat(px, py, pz, -Math.min(sediment * 0.65, maxDepth * 0.12));
    }

    if (onProgress && d % progressEvery === 0) {
      onProgress(0.60 + 0.24 * (d / dropletCount), 'Rain droplets carving rock surface...');
    }
  }

  if (onProgress) onProgress(0.845, 'Applying rain-carved relief to the SDF...');

  // Anti-aliasing of the deposition field: a very light 6-tap blur prevents single-voxel
  // triangulation diamonds while keeping the rills razor-sharp (this is NOT a wide smooth).
  const smoothed = new Map();
  const neighbours = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  for (let i = 0; i < touched.length; i++) {
    const idx = touched[i];
    const e = erosion.get(idx);
    if (Math.abs(e) < 1e-6) continue;
    const ix = idx % sdf.gx;
    const iy = Math.floor(idx / sdf.strideY) % sdf.gy;
    const iz = Math.floor(idx / sdf.strideZ);
    let acc = e * 0.74;
    let wSum = 0.74;
    for (let k = 0; k < neighbours.length; k++) {
      const nIdx = idx + neighbours[k][0] + neighbours[k][1] * sdf.strideY + neighbours[k][2] * sdf.strideZ;
      if (ix + neighbours[k][0] < 0 || ix + neighbours[k][0] >= sdf.gx) continue;
      if (iy + neighbours[k][1] < 0 || iy + neighbours[k][1] >= sdf.gy) continue;
      if (iz + neighbours[k][2] < 0 || iz + neighbours[k][2] >= sdf.gz) continue;
      const nv = erosion.get(nIdx);
      if (nv !== undefined) { acc += nv * 0.06; wSum += 0.06; }
    }
    smoothed.set(idx, acc / wSum);
  }

  let erodedCells = 0;
  let depositedCells = 0;
  let appliedMax = 0;
  for (const [idx, raw] of smoothed) {
    if (!Number.isFinite(values[idx])) continue;
    // Soft-saturate so many overlapping droplets cannot melt the whole formation away:
    // shallow detail stays linear, extreme accumulation asymptotes to `erosionDepth`.
    let e = raw;
    if (e >= 0) {
      e = maxDepth * Math.tanh(e / maxDepth);
      if (e > h * 0.02) erodedCells++;
      if (e > appliedMax) appliedMax = e;
    } else {
      const k = -e;
      e = -maxDeposit * (1 - Math.exp(-k / maxDeposit));
      depositedCells++;
    }
    // Never push the base/ground plane down — erosion only ever acts on rock above the floor.
    if (sdf.groundY !== undefined && sdf.groundY !== null) {
      const iz = Math.floor(idx / sdf.strideZ);
      const wy = oy + iz * h;
      if (wy <= sdf.groundY + h * 1.5 && e > 0) continue;
    }
    values[idx] += e;
  }

  // Kick the SDF back to a proper (approximate) distance field near the new surface by a
  // single conservative relaxation sweep. This keeps QEF dual contouring crisp instead of
  // working with a discontinuous offset field.
  if (onProgress) onProgress(0.88, 'Re-normalizing eroded distance field...');
  relaxErodedBand(sdf, touched, h);

  const elapsedMs = 0;
  return {
    droplets: dropletsRun,
    steps: totalSteps,
    avgSteps: dropletsRun > 0 ? Number((totalSteps / dropletsRun).toFixed(1)) : 0,
    seeds: seedCount,
    erodedCells,
    depositedCells,
    maxCarve: Number(appliedMax.toFixed(4)),
    maxDepth: Number(maxDepth.toFixed(4)),
    elapsedMs,
    skipped: false,
  };
}

/**
 * A single pass of "SDF re-distancing" on cells touched by erosion: each cell is pushed
 * towards the sign-consistent value implied by its newly-eroded neighbours. Cheap,
 * monotone, and it prevents the surface from developing voxel-scale spikes.
 */
function relaxErodedBand(sdf, touched, h) {
  const values = sdf.values;
  const gx = sdf.gx;
  const gy = sdf.gy;
  const gz = sdf.gz;
  const strideY = sdf.strideY;
  const strideZ = sdf.strideZ;

  const snapshot = new Float32Array(touched.length);
  for (let i = 0; i < touched.length; i++) snapshot[i] = values[touched[i]];

  for (let i = 0; i < touched.length; i++) {
    const idx = touched[i];
    const v = snapshot[i];
    if (!Number.isFinite(v)) continue;
    const ix = idx % gx;
    const iy = Math.floor(idx / strideY) % gy;
    const iz = Math.floor(idx / strideZ);
    let sum = 0;
    let n = 0;
    if (ix > 0) { const nv = values[idx - 1]; if (Number.isFinite(nv)) { sum += nv; n++; } }
    if (ix < gx - 1) { const nv = values[idx + 1]; if (Number.isFinite(nv)) { sum += nv; n++; } }
    if (iy > 0) { const nv = values[idx - strideY]; if (Number.isFinite(nv)) { sum += nv; n++; } }
    if (iy < gy - 1) { const nv = values[idx + strideY]; if (Number.isFinite(nv)) { sum += nv; n++; } }
    if (iz > 0) { const nv = values[idx - strideZ]; if (Number.isFinite(nv)) { sum += nv; n++; } }
    if (iz < gz - 1) { const nv = values[idx + strideZ]; if (Number.isFinite(nv)) { sum += nv; n++; } }
    if (n === 0) continue;
    const avg = sum / n;
    // Blend only 18%: enough to stop voxel spikes, far too little to round off the rills.
    values[idx] = v * 0.88 + avg * 0.12;
  }
}
