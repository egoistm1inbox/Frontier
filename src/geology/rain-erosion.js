/**
 * Particle-based rain erosion for rock formation meshes (Rock & Cliff Studio).
 *
 * Replaces the earlier SDF erosion, which produced a "melted chocolate" look because it
 * smeared the field at voxel scale. Here discrete rain droplets walk the mesh itself:
 *
 *  - Droplets spawn on surfaces in proportion to how much open sky they see (up-facing
 *    faces, not sheltered by overhangs or nearby rock). Downward faces get almost nothing.
 *  - Each droplet follows the steepest descent along the mesh graph with inertia, gains
 *    speed on slopes, and carries sediment up to a capacity set by slope x speed x water.
 *  - Where carrying capacity exceeds the load the droplet erodes the rock beneath it;
 *    where the load exceeds capacity it deposits. Water evaporates along the way.
 *  - Vertex motion is bounded along the vertex normal, then relaxed with a light pinned
 *    Laplacian pass, so the result keeps the original topology (decimation runs afterwards).
 *
 * Everything is in mesh units (metres). The function is deterministic for a given seed.
 */

import { createRng } from '../core/prng.js';

const SHELTER_DIRS = 8;
const SHELTER_STEPS = [1, 2, 3, 4, 6, 8, 11, 15, 20];
const SHELTER_TAN = Math.tan((25 * Math.PI) / 180);

/** Builds a deduplicated vertex adjacency in CSR form. */
function buildAdjacency(numV, indices) {
  const deg = new Int32Array(numV);
  // Each triangle contributes two neighbour slots to each of its three corners
  for (let t = 0; t < indices.length; t += 3) {
    deg[indices[t]] += 2; deg[indices[t + 1]] += 2; deg[indices[t + 2]] += 2;
  }
  const off = new Int32Array(numV + 1);
  for (let v = 0; v < numV; v++) off[v + 1] = off[v] + deg[v];
  const raw = new Int32Array(off[numV]);
  const fill = off.slice(0, numV);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    raw[fill[a]++] = b; raw[fill[a]++] = c;
    raw[fill[b]++] = a; raw[fill[b]++] = c;
    raw[fill[c]++] = a; raw[fill[c]++] = b;
  }
  // Deduplicate per vertex (degrees are small, a linear scan is fine)
  const nbrOff = new Int32Array(numV + 1);
  const nbr = new Int32Array(raw.length);
  let w = 0;
  for (let v = 0; v < numV; v++) {
    nbrOff[v] = w;
    for (let k = off[v]; k < off[v + 1]; k++) {
      const u = raw[k];
      if (u === v) continue;
      let seen = false;
      for (let q = nbrOff[v]; q < w; q++) if (nbr[q] === u) { seen = true; break; }
      if (!seen) nbr[w++] = u;
    }
  }
  nbrOff[numV] = w;
  return { nbrOff, nbr: nbr.slice(0, w) };
}

/** Area-weighted vertex normals. */
function computeNormals(pos, indices, numV) {
  const n = new Float64Array(numV * 3);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const o of [a, b, c]) {
      n[o] += nx; n[o + 1] += ny; n[o + 2] += nz;
    }
  }
  for (let v = 0; v < numV; v++) {
    const o = v * 3;
    const l = Math.hypot(n[o], n[o + 1], n[o + 2]);
    if (l > 1e-12) { n[o] /= l; n[o + 1] /= l; n[o + 2] /= l; } else { n[o] = 0; n[o + 1] = 1; n[o + 2] = 0; }
  }
  return n;
}

/**
 * Sky exposure per vertex in [0,1]: 1 = open sky above, 0 = fully sheltered in all directions.
 * Uses a coarse max-height grid and horizon tests in 8 directions.
 */
function computeSkyExposure(pos, numV, gridRes = 96) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let v = 0; v < numV; v++) {
    const x = pos[v * 3], z = pos[v * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const span = Math.max(maxX - minX, maxZ - minZ, 1e-3);
  const cell = span / gridRes;
  const G = gridRes + 2;
  const maxY = new Float32Array(G * G).fill(-Infinity);
  const cellOf = new Int32Array(numV * 2);
  for (let v = 0; v < numV; v++) {
    const cx = Math.min(gridRes - 1, Math.max(0, Math.floor((pos[v * 3] - minX) / cell))) + 1;
    const cz = Math.min(gridRes - 1, Math.max(0, Math.floor((pos[v * 3 + 2] - minZ) / cell))) + 1;
    cellOf[v * 2] = cx; cellOf[v * 2 + 1] = cz;
    const idx = cz * G + cx;
    if (pos[v * 3 + 1] > maxY[idx]) maxY[idx] = pos[v * 3 + 1];
  }
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const exposure = new Float32Array(numV);
  for (let v = 0; v < numV; v++) {
    const cx = cellOf[v * 2], cz = cellOf[v * 2 + 1];
    const y = pos[v * 3 + 1];
    let sheltered = 0;
    for (const [dx, dz] of dirs) {
      let blocked = false;
      for (const k of SHELTER_STEPS) {
        const sx = cx + dx * k, sz = cz + dz * k;
        if (sx < 0 || sz < 0 || sx >= G || sz >= G) break;
        const h = maxY[sz * G + sx];
        if (h > y + SHELTER_TAN * k * cell) { blocked = true; break; }
      }
      if (blocked) sheltered++;
    }
    exposure[v] = 1 - sheltered / SHELTER_DIRS;
  }
  return exposure;
}

/**
 * Applies rain erosion to a welded mesh. Returns new positions (same topology).
 * @param {Float32Array|number[]} positions flat xyz
 * @param {Uint32Array|number[]} indices triangle indices
 * @param {object} [options]
 * @param {number} [options.strength=0.5] 0..1; 0 returns the input unchanged
 * @param {number} [options.passes=2]
 * @param {number} [options.groundY=0] vertices on this plane are pinned
 * @param {number} [options.seed=4029]
 */
export function applyRainErosion(positions, indices, options = {}) {
  const strength = Math.max(0, Math.min(1, options.strength ?? 0.5));
  const outPos = Float32Array.from(positions);
  if (strength <= 0 || indices.length < 3) return { positions: outPos, stats: { droplets: 0, eroded: 0, deposited: 0 } };

  const numV = outPos.length / 3;
  const groundY = options.groundY ?? 0;
  const passes = Math.max(1, Math.round(options.passes ?? 2));
  const rng = createRng((options.seed ?? 4029) + 7717);
  const { nbrOff, nbr } = buildAdjacency(numV, indices);

  // Bounding extent sets the physical scale of every per-droplet constant
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let v = 0; v < numV; v++) {
    const x = outPos[v * 3], y = outPos[v * 3 + 1], z = outPos[v * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-3);
  const unit = extent / 100;                    // one "erosion unit" = 1% of the formation size
  const maxDisp = 0.6 * unit * (0.5 + strength); // bound on total vertex motion per pass
  const dropletsPerPass = Math.min(400000, Math.round(strength * numV * 2.0));
  const MAX_STEPS = 64;

  const stats = { droplets: 0, eroded: 0, deposited: 0 };

  for (let pass = 0; pass < passes; pass++) {
    const normals = computeNormals(outPos, indices, numV);
    const exposure = computeSkyExposure(outPos, numV);

    // Droplet spawn weights: rain hits up-facing, unsheltered surfaces (sheltered faces get none)
    const cdf = new Float64Array(numV);
    let total = 0;
    const pinned = new Uint8Array(numV);
    for (let v = 0; v < numV; v++) {
      if (Math.abs(outPos[v * 3 + 1] - groundY) < 1e-3) pinned[v] = 1;
      const w = pinned[v] ? 0 : exposure[v] * (0.08 + Math.max(0, normals[v * 3 + 1]));
      total += w;
      cdf[v] = total;
    }
    if (total <= 0) break;

    const delta = new Float64Array(numV); // signed displacement along vertex normal
    const hardness = new Float64Array(numV);
    for (let v = 0; v < numV; v++) {
      // Layered hardness from a hashed vertex value: harder where the rock is hard, soft seams erode faster
      const h = Math.sin(outPos[v * 3] * 12.9898 + outPos[v * 3 + 2] * 78.233 + pass * 3.1) * 43758.5453;
      hardness[v] = 0.75 + 0.5 * (h - Math.floor(h));
    }

    const Kc = 6.0 * strength + 1.0;   // carrying capacity
    const Ke = 0.9;                    // erosion rate
    const Kd = 0.6;                    // deposition rate
    const Kevap = 0.03;
    const inertia = 0.35;
    const friction = 0.08;
    const gravity = 1.0;

    for (let d = 0; d < dropletsPerPass; d++) {
      // Spawn weighted by exposure
      const r = rng.float() * total;
      let lo = 0, hi = numV - 1;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (cdf[mid] < r) lo = mid + 1; else hi = mid;
      }
      let v = lo;
      if (pinned[v]) continue;
      stats.droplets++;

      let dx = 0, dy = 0, dz = 0;          // flow direction (unit, or zero)
      let speed = 0;
      let water = 1.0;
      let sediment = 0;

      for (let step = 0; step < MAX_STEPS && water > 0.02; step++) {
        const vx = outPos[v * 3], vy = outPos[v * 3 + 1], vz = outPos[v * 3 + 2];
        // Steepest-descent gradient over the graph neighbourhood (downhill neighbours only)
        let gx = 0, gy = 0, gz = 0;
        for (let k = nbrOff[v]; k < nbrOff[v + 1]; k++) {
          const u = nbr[k];
          const ex = outPos[u * 3] - vx, ey = outPos[u * 3 + 1] - vy, ez = outPos[u * 3 + 2] - vz;
          const len = Math.hypot(ex, ey, ez);
          if (len < 1e-9 || ey >= 0) continue;
          const slope = -ey / len;
          gx += (ex / len) * slope; gy += (ey / len) * slope; gz += (ez / len) * slope;
        }
        const gl = Math.hypot(gx, gy, gz);
        // Local minimum: the droplet pools here and drops its load
        if (gl < 1e-9) {
          delta[v] += sediment * Kd * unit;
          stats.deposited += sediment;
          sediment = 0;
          break;
        }
        // Inertial blend of the previous flow direction with the steepest-descent direction
        dx = inertia * dx + (1 - inertia) * (gx / gl);
        dy = inertia * dy + (1 - inertia) * (gy / gl);
        dz = inertia * dz + (1 - inertia) * (gz / gl);
        const dl = Math.hypot(dx, dy, dz);
        if (dl > 1e-9) { dx /= dl; dy /= dl; dz /= dl; }

        // Move to the downhill neighbour best aligned with the flow direction
        let nxt = -1, bestDot = -Infinity, bestDrop = 0;
        for (let k = nbrOff[v]; k < nbrOff[v + 1]; k++) {
          const u = nbr[k];
          const ex = outPos[u * 3] - vx, ey = outPos[u * 3 + 1] - vy, ez = outPos[u * 3 + 2] - vz;
          const len = Math.hypot(ex, ey, ez);
          if (len < 1e-9 || ey >= 0) continue;
          const dot = (ex / len) * dx + (ey / len) * dy + (ez / len) * dz;
          if (dot > bestDot) { bestDot = dot; nxt = u; bestDrop = -ey; }
        }
        if (nxt < 0) break;
        const stepLen = Math.hypot(outPos[nxt * 3] - vx, outPos[nxt * 3 + 1] - vy, outPos[nxt * 3 + 2] - vz);
        const drop = bestDrop;
        const slope = drop / Math.max(stepLen, 1e-9);
        speed = Math.sqrt(Math.max(0, speed * speed * (1 - friction) + 2 * gravity * drop / unit));
        const stepN = stepLen / unit;

        // Sediment capacity: steeper, faster, more water => more load
        const capacity = Kc * Math.max(slope, 0.04) * Math.min(speed, 3.0) * water * stepN;
        const expo = exposure[v];
        if (sediment < capacity) {
          const pick = Math.min((capacity - sediment) * Ke * hardness[v] * expo, 0.25 * stepN);
          delta[v] -= pick * unit;
          sediment += pick;
          stats.eroded += pick;
        } else {
          const drop2 = (sediment - capacity) * Kd;
          delta[v] += drop2 * unit;
          sediment -= drop2;
          stats.deposited += drop2;
        }

        water *= 1 - Kevap * stepN;
        v = nxt;
        if (pinned[v]) break;
      }
      // Remaining load settles at the final resting vertex
      if (sediment > 0 && !pinned[v]) {
        delta[v] += sediment * Kd * unit;
        stats.deposited += sediment;
      }
    }

    // Bound the motion per vertex and push along the normal
    for (let v = 0; v < numV; v++) {
      if (pinned[v]) continue;
      const dd = Math.max(-maxDisp, Math.min(maxDisp, delta[v]));
      if (dd === 0) continue;
      const o = v * 3;
      outPos[o] += normals[o] * dd;
      outPos[o + 1] += normals[o + 1] * dd;
      outPos[o + 2] += normals[o + 2] * dd;
      if (outPos[o + 1] < groundY) outPos[o + 1] = groundY;
    }

    // Light relaxation of the displaced vertices so the eroded faces read as smooth rock, not spikes
    relaxPinned(outPos, nbrOff, nbr, pinned, groundY, 2, 0.35);
  }

  return { positions: outPos, stats };
}

/** Lambda-blends each free vertex toward its neighbour centroid, leaving pinned vertices fixed. */
function relaxPinned(pos, nbrOff, nbr, pinned, groundY, iterations, lambda) {
  const numV = pos.length / 3;
  let cur = pos;
  let next = new Float32Array(pos.length);
  for (let it = 0; it < iterations; it++) {
    next.set(cur);
    for (let v = 0; v < numV; v++) {
      if (pinned[v]) continue;
      const a = nbrOff[v], b = nbrOff[v + 1];
      if (b <= a) continue;
      let sx = 0, sy = 0, sz = 0;
      for (let k = a; k < b; k++) {
        const u = nbr[k] * 3;
        sx += cur[u]; sy += cur[u + 1]; sz += cur[u + 2];
      }
      const inv = 1 / (b - a);
      const o = v * 3;
      next[o] = cur[o] + lambda * (sx * inv - cur[o]);
      next[o + 1] = cur[o + 1] + lambda * (sy * inv - cur[o + 1]);
      next[o + 2] = cur[o + 2] + lambda * (sz * inv - cur[o + 2]);
      if (next[o + 1] < groundY) next[o + 1] = groundY;
    }
    const t = cur; cur = next; next = t;
  }
  if (cur !== pos) pos.set(cur);
}
