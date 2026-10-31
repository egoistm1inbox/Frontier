/**
 * Rain-only particle (droplet) erosion for true 3D rock formations.
 *
 * Terrain Studio erodes a 2D heightfield with GPU rain/runoff particles.
 * A rock formation is NOT a heightfield — it has cliffs, overhangs and arch
 * undersides — so the same droplet model is run here directly on the welded
 * triangle mesh instead:
 *
 *   1. Rain falls vertically, so droplets spawn on triangles weighted by
 *      their horizontally-projected area (|normal.y| * area): crowns and
 *      ledges catch rain, sheer walls and undersides catch almost none.
 *   2. Each droplet runs downhill over the surface (steepest descent across
 *      vertex neighbours, with a little inertia like the terrain droplets),
 *      picking up sediment where it flows fast and dropping it where it
 *      slows down or reaches a hollow.
 *   3. Erosion moves a vertex *into* the rock (against its vertex normal);
 *      deposition moves it *outward* (along the normal).  On a near-vertical
 *      wall that carves/flushes the face; on a ledge it lowers/raises the
 *      surface — exactly how rain wears a real outcrop.
 *
 * Rain only: no snow, no wind saltation, no rockfall species.
 * Deterministic for a given seed.  Pure JS — runs in the generation worker
 * and in Node tests.  Input positions are never mutated.
 */

import { createRng } from '../core/prng.js';

export const RAIN_EROSION_DEFAULTS = Object.freeze({
  droplets: 0,          // 0 = rain erosion off (formation unchanged)
  strength: 0.35,       // 0..1 droplet erosion rate
  deposition: 0.3,      // 0..1 fraction of excess sediment dropped per step
  lifetime: 36,         // max surface steps per droplet
  inertia: 0.25,        // 0..1 tendency to keep flowing in the same direction
});

/** Area-weighted smooth vertex normals. Returns Float32Array(n*3). */
export function computeVertexNormals(positions, indices) {
  const n = positions.length / 3;
  const normals = new Float32Array(n * 3);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const ux = positions[b * 3] - ax, uy = positions[b * 3 + 1] - ay, uz = positions[b * 3 + 2] - az;
    const vx = positions[c * 3] - ax, vy = positions[c * 3 + 1] - ay, vz = positions[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    normals[a * 3] += nx; normals[a * 3 + 1] += ny; normals[a * 3 + 2] += nz;
    normals[b * 3] += nx; normals[b * 3 + 1] += ny; normals[b * 3 + 2] += nz;
    normals[c * 3] += nx; normals[c * 3 + 1] += ny; normals[c * 3 + 2] += nz;
  }
  for (let v = 0; v < n; v++) {
    const i = v * 3;
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l;
  }
  return normals;
}

function buildAdjacency(numVerts, indices) {
  const adj = Array.from({ length: numVerts }, () => []);
  const seen = Array.from({ length: numVerts }, () => new Set());
  const link = (u, v) => { if (!seen[u].has(v)) { seen[u].add(v); adj[u].push(v); } };
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    link(a, b); link(b, a); link(b, c); link(c, b); link(c, a); link(a, c);
  }
  return adj;
}

/**
 * Erode a welded mesh with rain droplets.
 * @returns {{positions: Float32Array, stats: object}} new positions + stats.
 */
export function erodeRockWithRain(positions, indices, options = {}) {
  const opts = { ...RAIN_EROSION_DEFAULTS, ...options };
  const dropletCount = Math.max(0, Math.floor(opts.droplets) || 0);
  const out = new Float32Array(positions);
  const stats = {
    droplets: dropletCount, steps: 0,
    eroded: 0, deposited: 0, maxDisplacement: 0,
  };
  const numVerts = positions.length / 3;
  if (dropletCount === 0 || numVerts === 0 || indices.length === 0) {
    return { positions: out, stats };
  }

  const strength = Math.min(1, Math.max(0, opts.strength));
  const depositionRate = Math.min(1, Math.max(0, opts.deposition));
  const lifetime = Math.max(1, Math.floor(opts.lifetime));
  const inertia = Math.min(1, Math.max(0, opts.inertia));
  if (strength <= 0) return { positions: out, stats };

  const rng = createRng(`${opts.seed ?? 4029}:rain-erosion`);
  const normals = computeVertexNormals(out, indices);
  const adj = buildAdjacency(numVerts, indices);

  // Mean edge length = the natural "one step" scale of this mesh.
  let edgeSum = 0, edgeCount = 0;
  for (let v = 0; v < numVerts; v++) {
    for (const nb of adj[v]) {
      if (nb > v) {
        edgeSum += Math.hypot(out[nb * 3] - out[v * 3], out[nb * 3 + 1] - out[v * 3 + 1], out[nb * 3 + 2] - out[v * 3 + 2]);
        edgeCount++;
      }
    }
  }
  const meanEdge = edgeCount ? edgeSum / edgeCount : 0.1;
  // Per-vertex displacement cap keeps droplets from drilling spikes/holes.
  const maxDisp = meanEdge * 1.6;
  const totalDisp = new Float32Array(numVerts);

  // Ground/base vertices (lowest shell of the formation) stay pinned.
  let minY = Infinity;
  for (let v = 0; v < numVerts; v++) minY = Math.min(minY, out[v * 3 + 1]);
  const pinned = new Uint8Array(numVerts);
  for (let v = 0; v < numVerts; v++) if (out[v * 3 + 1] <= minY + meanEdge * 0.25) pinned[v] = 1;

  // --- Rain spawn table: triangles weighted by projected (horizontal) area.
  const triCount = indices.length / 3;
  const spawnCum = new Float64Array(triCount + 1);
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
    const ax = out[a * 3], ay = out[a * 3 + 1], az = out[a * 3 + 2];
    const ux = out[b * 3] - ax, uy = out[b * 3 + 1] - ay, uz = out[b * 3 + 2] - az;
    const vx = out[c * 3] - ax, vy = out[c * 3 + 1] - ay, vz = out[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz;
    const projArea = 0.5 * Math.abs(ny); // vertical rain sees only this
    // Tiny floor so steep faces still get an occasional direct hit.
    spawnCum[t + 1] = spawnCum[t] + projArea + 0.5 * Math.hypot(nx, ny, uy * vz - uz * vy) * 0.0 + 1e-9;
  }
  const spawnTotal = spawnCum[triCount];
  function pickStartVertex() {
    const r = rng.float() * spawnTotal;
    let lo = 0, hi = triCount - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (spawnCum[mid + 1] < r) lo = mid + 1; else hi = mid; }
    const t = lo;
    // Barycentric-ish pick: choose one corner of the hit triangle at random.
    return indices[t * 3 + Math.floor(rng.float() * 3)];
  }

  // Move vertex v by `amount` along its normal (sign +1 = outward/deposit).
  function displace(v, signedAmount) {
    if (pinned[v] || signedAmount === 0) return 0;
    const room = maxDisp - totalDisp[v];
    if (room <= 0) return 0;
    const applied = Math.sign(signedAmount) * Math.min(Math.abs(signedAmount), room);
    const i = v * 3;
    // applied > 0 deposits (moves along +normal, out of the rock);
    // applied < 0 erodes (moves along -normal, into the rock).
    out[i] += normals[i] * applied;
    out[i + 1] += normals[i + 1] * applied;
    out[i + 2] += normals[i + 2] * applied;
    totalDisp[v] += Math.abs(applied);
    if (totalDisp[v] > stats.maxDisplacement) stats.maxDisplacement = totalDisp[v];
    return applied;
  }

  const erosionRate = 0.28 * strength;
  for (let d = 0; d < dropletCount; d++) {
    let cur = pickStartVertex();
    let water = 1, speed = 0.2, sediment = 0;
    let dirX = 0, dirZ = 0;
    const visited = new Set([cur]);

    for (let step = 0; step < lifetime; step++) {
      stats.steps++;
      const ci = cur * 3;
      const cx = out[ci], cy = out[ci + 1], cz = out[ci + 2];

      // Steepest surface descent: lowest neighbour, with flow inertia.
      let next = -1, bestScore = 1e-6, bestDist = 1, bestDrop = 0;
      for (const nb of adj[cur]) {
        if (visited.has(nb) && adj[cur].length > 1) continue;
        const ni = nb * 3;
        const dx = out[ni] - cx, dy = out[ni + 1] - cy, dz = out[ni + 2] - cz;
        const dist = Math.hypot(dx, dy, dz) || 1e-6;
        const dropPerDist = -dy / dist;
        let score = dropPerDist;
        if (dirX !== 0 || dirZ !== 0) {
          score += inertia * 0.35 * ((dx / dist) * dirX + (dz / dist) * dirZ);
        }
        if (score > bestScore) { bestScore = score; next = nb; bestDist = dist; bestDrop = -dy; }
      }

      if (next === -1) {
        // Hollow / flat / base: drop whatever sediment is left and stop.
        if (sediment > 0) stats.deposited += Math.max(0, displace(cur, sediment * depositionRate * meanEdge * 0.35));
        break;
      }

      const slope = Math.max(0, bestDrop) / bestDist; // 0..~1
      const capacity = Math.max(slope, 0.012) * speed * water * 3.2;

      if (sediment > capacity) {
        const dropAmt = (sediment - capacity) * depositionRate;
        sediment -= dropAmt;
        stats.deposited += Math.max(0, displace(cur, dropAmt * meanEdge * 0.35));
      } else {
        const take = Math.min((capacity - sediment) * erosionRate, Math.max(0, bestDrop) * 0.45 + meanEdge * 0.002);
        sediment += take / Math.max(meanEdge, 1e-6) * 0.35; // sediment in edge-length units
        const applied = displace(cur, -take * (0.35 + 0.65 * strength));
        stats.eroded += Math.max(0, -applied);
      }

      // Flow physics for the next step (mirrors terrain droplet update).
      speed = Math.sqrt(Math.max(0.02, speed * speed + slope * 1.4));
      water *= 0.965; // evaporation/absorption
      const ni = next * 3;
      const mx = out[ni] - cx, mz = out[ni + 2] - cz;
      const ml = Math.hypot(mx, mz);
      if (ml > 1e-6) { dirX = mx / ml; dirZ = mz / ml; }
      visited.add(next);
      cur = next;
      if (water < 0.12) {
        if (sediment > 0) stats.deposited += Math.max(0, displace(cur, sediment * depositionRate * meanEdge * 0.35));
        break;
      }
    }
  }
  stats.eroded = Number(stats.eroded.toFixed(4));
  stats.deposited = Number(stats.deposited.toFixed(4));
  stats.maxDisplacement = Number(stats.maxDisplacement.toFixed(4));
  return { positions: out, stats };
}
