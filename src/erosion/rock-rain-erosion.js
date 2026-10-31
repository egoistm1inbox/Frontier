/**
 * PARTICLE RAIN EROSION FOR THE 3D ROCK & CLIFF STUDIO
 * ====================================================
 *
 * The Terrain Studio erodes a 512x512 height field with GPU raindrops. A rock formation is
 * a real 3D triangle mesh (arches, overhangs, undercuts), so this module brings the *same
 * idea* — Lagrangian raindrops that run downhill carrying sediment — to an arbitrary mesh:
 *
 *  1. Raindrops spawn above the formation and are ray-cast straight down onto the topmost
 *     triangle of the mesh (arches, ledges and overhangs are all handled correctly).
 *  2. Each drop then travels down the local steepest-descent direction of the surface it is
 *     standing on, stepping from triangle to triangle (this is what carves real gullies and
 *     rills rather than a uniform dent).
 *  3. Where water flows it detaches material: the contacted vertices are displaced along
 *     their (welded) normal, i.e. the surface is dissolved / abraded. Erosion resistance is
 *     derived from the local slope and from the baked AO / curvature vertex attributes, so
 *     soft recessed beds wear away first while hard ribs survive.
 *  4. Loaded droplets drop their sediment where they slow down, pool or evaporate, rebuilding
 *     small talus fans at the foot of the slope (mass is roughly conserved).
 *  5. A light Laplacian relaxation of the displacement field keeps the result looking like
 *     flowing water (smooth rounded rills) instead of a noisy vertex cloud.
 *
 * Only rain is used (no snow/wind/rockfall), exactly as requested.
 */

/** Tunable artistic constants (calibrated so a 10 m formation shows visible rills in seconds) */
const EROSION_K = 0.012; // metres of cut per unit of accumulated droplet water
const DEPOSIT_K = 0.006; // metres of refill per unit of settled sediment
const MIN_SLOPE = 0.012; // flattened water stops flowing below this tangent
const MAX_FLOW_STEPS = 48;

export const DEFAULT_RAIN_EROSION_PARAMS = {
  running: false,        // simulation playing
  rainIntensity: 0.65,   // 0..1 — raindrop emission rate
  erosionStrength: 0.55, // 0..1 — how aggressively water detaches rock
  deposition: 0.45,      // 0..1 — sediment redeposition in hollows
  evaporation: 0.30,     // 0..1 — how quickly a droplet dies / drops its load
  smoothing: 0.40,       // 0..1 — gully roundness / lateral diffusion
  dropletRate: 7000,     // droplets spawned per second at intensity 1.0
  dropletSteps: 22,      // surface steps each droplet may travel
  maxSpawnPerFrame: 420, // hard cap so slow machines never hitch
  showRain: true,        // render falling rain streaks in the viewport
  windX: 0.0,            // rain slant (world units / second)
  windZ: 0.0,
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export class RockRainErosion {
  constructor(params = {}) {
    this.params = { ...DEFAULT_RAIN_EROSION_PARAMS, ...params };
    this.mesh = null;
    this.ready = false;
    this.time = 0;
    this.dropletCount = 0;
    this.totalEroded = 0;
    this.stats = { droplets: 0, cut: 0, fill: 0 };
    this._spawnAccum = 0;
    this._hit = { y: 0, tri: -1, u: 0, v: 0, w: 0 };
    this._dirty = false;
    this._rain = null;
  }

  setParams(partial = {}) {
    Object.assign(this.params, partial);
  }

  /** Registers a freshly synthesised formation mesh (positions are mutated in place). */
  setMesh(meshData) {
    if (!meshData || !meshData.positions || !meshData.indices) {
      this.mesh = null;
      this.ready = false;
      return;
    }
    this.mesh = meshData;
    this.ready = false;
    this._spawnAccum = 0;
    this.time = 0;
    this.totalEroded = 0;
    this.stats = { droplets: 0, cut: 0, fill: 0 };
    this._rain = null;
  }

  /** Lazily builds the welded topology, adjacency, raindrop grid and rain visuals. */
  _build() {
    const mesh = this.mesh;
    const pos = mesh.positions;
    const idx = mesh.indices;
    const vCount = Math.floor(pos.length / 3);
    const tCount = Math.floor(idx.length / 3);

    this.basePositions = new Float32Array(pos);
    this.positions = pos;
    this.normals = mesh.normals;
    this.vCount = vCount;
    this.tCount = tCount;
    this.indices = idx;

    // ---- Weld coincident vertices (the render mesh is split per normal group / UV axis) ----
    const weldLookup = new Map();
    const vertToWeld = new Int32Array(vCount);
    const weldBaseArr = [];
    for (let v = 0; v < vCount; v++) {
      const x = pos[v * 3];
      const y = pos[v * 3 + 1];
      const z = pos[v * 3 + 2];
      const key = `${Math.round(x * 1e4)}|${Math.round(y * 1e4)}|${Math.round(z * 1e4)}`;
      let w = weldLookup.get(key);
      if (w === undefined) {
        w = weldBaseArr.length / 3;
        weldLookup.set(key, w);
        weldBaseArr.push(x, y, z);
      }
      vertToWeld[v] = w;
    }
    const nWeld = weldBaseArr.length / 3;
    this.vertToWeld = vertToWeld;
    this.nWeld = nWeld;
    this.weldBase = new Float32Array(weldBaseArr);
    this.weldPos = new Float32Array(weldBaseArr);
    this.weldNormal = new Float32Array(nWeld * 3);
    this.disp = new Float32Array(nWeld);
    this.baseNormals = mesh.normals ? new Float32Array(mesh.normals) : null;

    // ---- Erosion resistance from the baked RGBA vertex mask ---------------------------
    // The generator stores (R = volumetric AO, G = concave cavity, B = convex edge,
    // A = upward slope). Hard convex ribs survive, soft recessed beds wash away first.
    const mask = mesh.colors;
    this.erodeResist = new Float32Array(nWeld);
    if (mask && mask.length >= vCount * 4) {
      const acc = new Float32Array(nWeld * 2);
      const cnt = new Float32Array(nWeld);
      for (let v = 0; v < vCount; v++) {
        const w = vertToWeld[v];
        acc[w * 2] += mask[v * 4 + 2]; // convex edge
        acc[w * 2 + 1] += mask[v * 4 + 1]; // cavity
        cnt[w] += 1;
      }
      for (let w = 0; w < nWeld; w++) {
        if (cnt[w] <= 0) {
          this.erodeResist[w] = 1;
          continue;
        }
        const edge = acc[w * 2] / cnt[w];
        const cavity = acc[w * 2 + 1] / cnt[w];
        this.erodeResist[w] = clamp(0.62 + 0.95 * edge - 0.42 * cavity, 0.22, 1.75);
      }
    } else {
      this.erodeResist.fill(1);
    }

    // ---- Bounding box & scale (needed by the triangle orientation test below) ----
    let bMinX = Infinity, bMinY = Infinity, bMinZ = Infinity;
    let bMaxX = -Infinity, bMaxY = -Infinity, bMaxZ = -Infinity;
    for (let v = 0; v < nWeld; v++) {
      const x = this.weldBase[v * 3], y = this.weldBase[v * 3 + 1], z = this.weldBase[v * 3 + 2];
      if (x < bMinX) bMinX = x;
      if (x > bMaxX) bMaxX = x;
      if (y < bMinY) bMinY = y;
      if (y > bMaxY) bMaxY = y;
      if (z < bMinZ) bMinZ = z;
      if (z > bMaxZ) bMaxZ = z;
    }
    this.bounds = { minX: bMinX, minY: bMinY, minZ: bMinZ, maxX: bMaxX, maxY: bMaxY, maxZ: bMaxZ };
    this.centerY = (bMinY + bMaxY) * 0.5;

    // ---- Triangle table in welded index space + per-triangle face normals ----
    const triWeld = new Int32Array(tCount * 3);
    const triNormal = new Float32Array(tCount * 3);
    const triSign = new Float32Array(tCount);
    const srcNormals = mesh.normals;
    for (let t = 0; t < tCount; t++) {
      const a = vertToWeld[idx[t * 3]];
      const b = vertToWeld[idx[t * 3 + 1]];
      const c = vertToWeld[idx[t * 3 + 2]];
      triWeld[t * 3] = a;
      triWeld[t * 3 + 1] = b;
      triWeld[t * 3 + 2] = c;

      const ax = this.weldBase[a * 3], ay = this.weldBase[a * 3 + 1], az = this.weldBase[a * 3 + 2];
      const bx = this.weldBase[b * 3], by = this.weldBase[b * 3 + 1], bz = this.weldBase[b * 3 + 2];
      const cx = this.weldBase[c * 3], cy = this.weldBase[c * 3 + 1], cz = this.weldBase[c * 3 + 2];
      let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      // Orient the face outward using the generator's shading normals (robust for arches,
      // overhangs and undercuts where a simple "away from the centre" test would fail).
      let sign = 1;
      if (srcNormals) {
        const i0 = idx[t * 3], i1 = idx[t * 3 + 1], i2 = idx[t * 3 + 2];
        const sx = srcNormals[i0 * 3] + srcNormals[i1 * 3] + srcNormals[i2 * 3];
        const sy = srcNormals[i0 * 3 + 1] + srcNormals[i1 * 3 + 1] + srcNormals[i2 * 3 + 1];
        const sz = srcNormals[i0 * 3 + 2] + srcNormals[i1 * 3 + 2] + srcNormals[i2 * 3 + 2];
        if (sx * nx + sy * ny + sz * nz < 0) sign = -1;
      }
      triSign[t] = sign;
      triNormal[t * 3] = nx * sign;
      triNormal[t * 3 + 1] = ny * sign;
      triNormal[t * 3 + 2] = nz * sign;
    }
    this.triSign = triSign;
    this.triWeld = triWeld;
    this.triNormal = triNormal;

    // ---- 1-ring adjacency in welded space (for displacement relaxation) ----
    const degree = new Int32Array(nWeld);
    for (let t = 0; t < tCount; t++) {
      degree[triWeld[t * 3]] += 2;
      degree[triWeld[t * 3 + 1]] += 2;
      degree[triWeld[t * 3 + 2]] += 2;
    }
    const offsets = new Int32Array(nWeld + 1);
    for (let v = 0; v < nWeld; v++) offsets[v + 1] = offsets[v] + degree[v];
    const neighbours = new Int32Array(offsets[nWeld]);
    const cursor = new Int32Array(nWeld);
    const pushEdge = (a, b) => {
      neighbours[offsets[a] + cursor[a]++] = b;
      neighbours[offsets[b] + cursor[b]++] = a;
    };
    for (let t = 0; t < tCount; t++) {
      const a = triWeld[t * 3], b = triWeld[t * 3 + 1], c = triWeld[t * 3 + 2];
      pushEdge(a, b);
      pushEdge(b, c);
      pushEdge(c, a);
    }
    this.adjOffsets = offsets;
    this.adjNeighbours = neighbours;

    // ---- Resolution scale and displacement limits ----
    const wp = this.weldBase;
    const minX = this.bounds.minX, minY = this.bounds.minY, minZ = this.bounds.minZ;
    const maxX = this.bounds.maxX, maxY = this.bounds.maxY, maxZ = this.bounds.maxZ;
    const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 10;
    this.diag = diag;
    this.maxCut = Math.max(0.12, diag * 0.055);
    this.maxFill = Math.max(0.03, diag * 0.016);
    this.stepLen = Math.max(0.10, Math.min(0.5, diag * 0.006));
    this.impactRadius = Math.max(0.10, diag * 0.004);

    // ---- Uniform XZ bucket grid for vertical raindrop ray casts ----
    const cell = Math.max(0.2, diag / 110);
    const nx = Math.max(1, Math.min(220, Math.ceil((maxX - minX) / cell) + 1));
    const nz = Math.max(1, Math.min(220, Math.ceil((maxZ - minZ) / cell) + 1));
    const buckets = new Array(nx * nz);
    for (let i = 0; i < buckets.length; i++) buckets[i] = null;
    for (let t = 0; t < tCount; t++) {
      const a = triWeld[t * 3], b = triWeld[t * 3 + 1], c = triWeld[t * 3 + 2];
      const ax = wp[a * 3], az = wp[a * 3 + 2];
      const bx = wp[b * 3], bz = wp[b * 3 + 2];
      const cx = wp[c * 3], cz = wp[c * 3 + 2];
      // Skip triangles that are vertical in plan view — a vertical raindrop cannot land on them
      const planArea = Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az));
      if (planArea < 1e-6) continue;
      const gx0 = clamp(Math.floor((Math.min(ax, bx, cx) - minX) / cell), 0, nx - 1);
      const gx1 = clamp(Math.floor((Math.max(ax, bx, cx) - minX) / cell), 0, nx - 1);
      const gz0 = clamp(Math.floor((Math.min(az, bz, cz) - minZ) / cell), 0, nz - 1);
      const gz1 = clamp(Math.floor((Math.max(az, bz, cz) - minZ) / cell), 0, nz - 1);
      for (let gz = gz0; gz <= gz1; gz++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const k = gz * nx + gx;
          if (!buckets[k]) buckets[k] = [];
          buckets[k].push(t);
        }
      }
    }
    this.grid = { cell, nx, nz, buckets };

    // ---- Sparse work buffers ----
    this.flow = new Float32Array(nWeld);
    this.settle = new Float32Array(nWeld);
    this.touched = new Int32Array(2048);
    this.touchedCount = 0;
    this.touchedStamp = new Int32Array(nWeld);
    this.stamp = 0;
    this._settleList = new Int32Array(2048);
    this._settleCount = 0;
    this._settleStamp = new Int32Array(nWeld);
    this._settleMark = 0;

    this.ready = true;
    this._recomputeWeldNormals();
    this._initRainVisuals();
  }

  _recomputeWeldNormals() {
    const n = this.weldNormal;
    n.fill(0);
    const tw = this.triWeld;
    const wp = this.weldPos;
    const tn = this.triNormal;
    // Recompute face normals from the *current* deformed positions first
    for (let t = 0; t < this.tCount; t++) {
      const a = tw[t * 3], b = tw[t * 3 + 1], c = tw[t * 3 + 2];
      const ax = wp[a * 3], ay = wp[a * 3 + 1], az = wp[a * 3 + 2];
      const bx = wp[b * 3], by = wp[b * 3 + 1], bz = wp[b * 3 + 2];
      const cx = wp[c * 3], cy = wp[c * 3 + 1], cz = wp[c * 3 + 2];
      let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const sign = this.triSign ? this.triSign[t] : 1;
      nx *= sign; ny *= sign; nz *= sign;
      tn[t * 3] = nx;
      tn[t * 3 + 1] = ny;
      tn[t * 3 + 2] = nz;
      n[a * 3] += nx; n[a * 3 + 1] += ny; n[a * 3 + 2] += nz;
      n[b * 3] += nx; n[b * 3 + 1] += ny; n[b * 3 + 2] += nz;
      n[c * 3] += nx; n[c * 3 + 1] += ny; n[c * 3 + 2] += nz;
    }
    for (let v = 0; v < this.nWeld; v++) {
      const x = n[v * 3], y = n[v * 3 + 1], z = n[v * 3 + 2];
      const l = Math.hypot(x, y, z) || 1;
      n[v * 3] = x / l;
      n[v * 3 + 1] = y / l;
      n[v * 3 + 2] = z / l;
    }
    // Keep the cached face normals normalised for the flow direction test
    for (let t = 0; t < this.tCount; t++) {
      const x = tn[t * 3], y = tn[t * 3 + 1], z = tn[t * 3 + 2];
      const l = Math.hypot(x, y, z) || 1;
      tn[t * 3] = x / l;
      tn[t * 3 + 1] = y / l;
      tn[t * 3 + 2] = z / l;
    }
  }

  /** Highest surface point under (x, z). Returns true and fills `this._hit`. */
  _raycast(x, z) {
    const g = this.grid;
    const gx = Math.floor((x - this.bounds.minX) / g.cell);
    if (gx < 0 || gx >= g.nx) return false;
    const gz = Math.floor((z - this.bounds.minZ) / g.cell);
    if (gz < 0 || gz >= g.nz) return false;
    const bucket = g.buckets[gz * g.nx + gx];
    if (!bucket) return false;

    const wp = this.weldPos;
    const tw = this.triWeld;
    let bestY = -Infinity;
    let bestTri = -1;
    let bestU = 0, bestV = 0, bestW = 0;

    for (let k = 0; k < bucket.length; k++) {
      const t = bucket[k];
      const a = tw[t * 3], b = tw[t * 3 + 1], c = tw[t * 3 + 2];
      const ax = wp[a * 3], az = wp[a * 3 + 2];
      const bx = wp[b * 3], bz = wp[b * 3 + 2];
      const cx = wp[c * 3], cz = wp[c * 3 + 2];
      const v0x = bx - ax, v0z = bz - az;
      const v1x = cx - ax, v1z = cz - az;
      const den = v0x * v1z - v1x * v0z;
      if (Math.abs(den) < 1e-10) continue;
      const rx = x - ax, rz = z - az;
      const v = (rx * v1z - v1x * rz) / den;
      const w = (v0x * rz - rx * v0z) / den;
      const u = 1 - v - w;
      if (u < -1e-4 || v < -1e-4 || w < -1e-4) continue;
      const y = u * wp[a * 3 + 1] + v * wp[b * 3 + 1] + w * wp[c * 3 + 1];
      if (y > bestY) {
        bestY = y;
        bestTri = t;
        bestU = u;
        bestV = v;
        bestW = w;
      }
    }
    if (bestTri < 0) return false;
    const hit = this._hit;
    hit.y = bestY;
    hit.tri = bestTri;
    hit.u = bestU;
    hit.v = bestV;
    hit.w = bestW;
    return true;
  }

  _markTouched(v) {
    if (this.touchedStamp[v] === this.stamp) return;
    this.touchedStamp[v] = this.stamp;
    if (this.touchedCount >= this.touched.length) {
      const bigger = new Int32Array(this.touched.length * 2);
      bigger.set(this.touched);
      this.touched = bigger;
    }
    this.touched[this.touchedCount++] = v;
  }

  _markSettle(v) {
    if (this._settleStamp[v] === this._settleMark) return;
    this._settleStamp[v] = this._settleMark;
    if (this._settleCount >= this._settleList.length) {
      const bigger = new Int32Array(this._settleList.length * 2);
      bigger.set(this._settleList);
      this._settleList = bigger;
    }
    this._settleList[this._settleCount++] = v;
  }

  /** Advances the rain + hydraulic erosion simulation by `dtSec` seconds. */
  step(dtSec) {
    if (!this.mesh) return false;
    if (!this.ready) {
      // Topology welding + raindrop grid is expensive: build it only once erosion is started
      if (!this.params.running) return false;
      this._build();
    }

    const dt = clamp(Number(dtSec) || 0.016, 0.001, 0.05);
    this.time += dt;
    this._updateRainVisuals(dt);

    const p = this.params;
    if (!p.running) return false;

    const rate = clamp(p.rainIntensity, 0, 1) * (p.dropletRate || 7000);
    this._spawnAccum += rate * dt;
    let spawn = Math.min(p.maxSpawnPerFrame || 420, Math.floor(this._spawnAccum));
    this._spawnAccum -= spawn;
    if (spawn <= 0) return false;

    this.stamp++;
    if (this.stamp > 2_000_000_000) {
      this.touchedStamp.fill(0);
      this.stamp = 1;
    }
    this.touchedCount = 0;
    this._settleMark++;
    if (this._settleMark > 2_000_000_000) {
      this._settleStamp.fill(0);
      this._settleMark = 1;
    }
    this._settleCount = 0;

    const b = this.bounds;
    const spanX = b.maxX - b.minX;
    const spanZ = b.maxZ - b.minZ;
    const tw = this.triWeld;
    const wp = this.weldPos;
    const tn = this.triNormal;
    const flow = this.flow;
    const settle = this.settle;
    const maxSteps = Math.min(MAX_FLOW_STEPS, Math.max(4, Math.round(p.dropletSteps)));
    const evapPerStep = 0.02 + 0.10 * clamp(p.evaporation, 0, 1);
    let processed = 0;

    for (let d = 0; d < spawn; d++) {
      let x = b.minX + Math.random() * spanX;
      let z = b.minZ + Math.random() * spanZ;
      // Slight wind slant on the way down
      x += (p.windX || 0) * Math.random() * 0.6;
      z += (p.windZ || 0) * Math.random() * 0.6;
      if (!this._raycast(x, z)) continue;

      let water = 1.0;
      let travelled = 0;
      let steps = 0;

      while (steps < maxSteps && water > 0.08) {
        const hit = this._hit;
        const t = hit.tri;
        const a = tw[t * 3], bb = tw[t * 3 + 1], c = tw[t * 3 + 2];

        // Deposit flow water onto the three contacted vertices (barycentric weighted)
        flow[a] += hit.u * water;
        flow[bb] += hit.v * water;
        flow[c] += hit.w * water;
        this._markTouched(a);
        this._markTouched(bb);
        this._markTouched(c);

        const nx = tn[t * 3], ny = tn[t * 3 + 1], nz = tn[t * 3 + 2];
        // Gravity projected onto the local surface plane = steepest descent direction
        let dx = nx * ny;
        let dy = ny * ny - 1;
        let dz = nz * ny;
        const dl = Math.hypot(dx, dy, dz);
        const slopeTan = Math.abs(dy) / Math.max(1e-4, Math.hypot(dx, dz));
        if (dl < 1e-5 || slopeTan < MIN_SLOPE || ny < 0.05) {
          // Standing water / ledge — unload the sediment here
          settle[a] += hit.u * water;
          settle[bb] += hit.v * water;
          settle[c] += hit.w * water;
          this._markSettle(a);
          this._markSettle(bb);
          this._markSettle(c);
          break;
        }
        dx /= dl;
        dz /= dl;

        const stepLen = this.stepLen * (0.65 + 0.9 * Math.min(2.5, slopeTan)) * (0.75 + 0.5 * Math.random());
        x += dx * stepLen;
        z += dz * stepLen;
        travelled += stepLen;
        water *= 1 - evapPerStep;
        steps++;

        if (!this._raycast(x, z)) {
          // Ran off the formation edge — dump remaining load at the last contact point
          settle[a] += hit.u * water;
          settle[bb] += hit.v * water;
          settle[c] += hit.w * water;
          this._markSettle(a);
          this._markSettle(bb);
          this._markSettle(c);
          break;
        }
      }

      // Long travelled paths carve deeper gullies (velocity-weighted erosion)
      if (travelled > 0 && water > 0.08) {
        const hit = this._hit;
        const t = hit.tri;
        const a = tw[t * 3], bb = tw[t * 3 + 1], c = tw[t * 3 + 2];
        settle[a] += hit.u * water;
        settle[bb] += hit.v * water;
        settle[c] += hit.w * water;
        this._markSettle(a);
        this._markSettle(bb);
        this._markSettle(c);
      }
      processed++;
    }

    this.dropletCount = processed;
    this.stats.droplets = processed;
    if (processed === 0) return false;

    // ---- Apply erosion & deposition to the displacement field --------------------------
    const strength = clamp(p.erosionStrength, 0, 1);
    const deposit = clamp(p.deposition, 0, 1);
    const disp = this.disp;
    const dtScale = clamp(dt * 60, 0.5, 2.0);
    let cutSum = 0;
    let fillSum = 0;

    for (let i = 0; i < this.touchedCount; i++) {
      const v = this.touched[i];
      const load = flow[v];
      if (load <= 0) continue;
      const resist = this.erodeResist ? this.erodeResist[v] : 1;
      const cut = (strength * EROSION_K * load * dtScale) / Math.max(0.2, resist);
      if (cut > 0) {
        disp[v] -= cut;
        cutSum += cut;
      }
      flow[v] = 0;
    }

    // Sediment is redeposited in hollows / flat ground proportional to the water that settled
    if (deposit > 0.01 && this._settleCount > 0) {
      for (let i = 0; i < this._settleCount; i++) {
        const v = this._settleList[i];
        const s = settle[v];
        if (s <= 0) continue;
        const fill = deposit * DEPOSIT_K * s * dtScale;
        disp[v] += fill;
        fillSum += fill;
        settle[v] = 0;
      }
    } else {
      for (let i = 0; i < this._settleCount; i++) settle[this._settleList[i]] = 0;
    }

    this.totalEroded += cutSum - fillSum;
    this.stats.cut = cutSum;
    this.stats.fill = fillSum;

    // ---- Lateral smoothing of the displacement field (rounds rills, avoids spikes) ------
    const smooth = clamp(p.smoothing, 0, 1);
    if (smooth > 0.01 && this.touchedCount > 0) {
      const k = 0.10 + 0.30 * smooth;
      const adjOff = this.adjOffsets;
      const adj = this.adjNeighbours;
      if (!this._smoothScratch || this._smoothScratch.length < this.touchedCount) {
        this._smoothScratch = new Float32Array(Math.max(2048, this.touchedCount * 2));
      }
      const scratch = this._smoothScratch;
      for (let i = 0; i < this.touchedCount; i++) {
        const v = this.touched[i];
        const start = adjOff[v];
        const end = adjOff[v + 1];
        let sum = 0;
        const count = end - start;
        for (let j = start; j < end; j++) sum += disp[adj[j]];
        const avg = count > 0 ? sum / count : disp[v];
        scratch[i] = disp[v] + (avg - disp[v]) * k;
      }
      for (let i = 0; i < this.touchedCount; i++) {
        const v = this.touched[i];
        const target = clamp(scratch[i], -this.maxCut, this.maxFill);
        disp[v] = target;
      }
    }

    // ---- Clamp & push deformed positions into the welded position buffer ----------------
    for (let i = 0; i < this.touchedCount; i++) {
      const v = this.touched[i];
      const d = clamp(disp[v], -this.maxCut, this.maxFill);
      disp[v] = d;
      const nx2 = this.weldNormal[v * 3], ny2 = this.weldNormal[v * 3 + 1], nz2 = this.weldNormal[v * 3 + 2];
      wp[v * 3] = this.weldBase[v * 3] + nx2 * d;
      wp[v * 3 + 1] = this.weldBase[v * 3 + 1] + ny2 * d;
      wp[v * 3 + 2] = this.weldBase[v * 3 + 2] + nz2 * d;
    }

    // Refresh smooth normals every ~15 frames so downhill flow follows the eroded surface
    this._normalTick = (this._normalTick || 0) + 1;
    if (this._normalTick % 30 === 0) this._recomputeWeldNormals();

    this._dirty = this.touchedCount > 0;
    return this._dirty;
  }

  /**
   * Writes the deformed welded positions + freshly computed per-corner normals back into the
   * render mesh buffers (which the Three.js BufferAttributes point straight at).
   */
  writeGeometry() {
    if (!this.ready || !this.mesh) return false;
    const pos = this.mesh.positions;
    const nor = this.mesh.normals;
    const v2w = this.vertToWeld;
    const wp = this.weldPos;

    for (let v = 0; v < this.vCount; v++) {
      const w = v2w[v];
      pos[v * 3] = wp[w * 3];
      pos[v * 3 + 1] = wp[w * 3 + 1];
      pos[v * 3 + 2] = wp[w * 3 + 2];
    }

    // Per-corner normals keep the original hard creases (vertices are split per normal group)
    if (nor) {
      nor.fill(0);
      const tw = this.triWeld;
      const tn = this.triNormal;
      const idx = this.indices;
      for (let t = 0; t < this.tCount; t++) {
        const nx = tn[t * 3], ny = tn[t * 3 + 1], nz = tn[t * 3 + 2];
        const i0 = idx[t * 3], i1 = idx[t * 3 + 1], i2 = idx[t * 3 + 2];
        nor[i0 * 3] += nx; nor[i0 * 3 + 1] += ny; nor[i0 * 3 + 2] += nz;
        nor[i1 * 3] += nx; nor[i1 * 3 + 1] += ny; nor[i1 * 3 + 2] += nz;
        nor[i2 * 3] += nx; nor[i2 * 3 + 1] += ny; nor[i2 * 3 + 2] += nz;
      }
      for (let v = 0; v < this.vCount; v++) {
        const x = nor[v * 3], y = nor[v * 3 + 1], z = nor[v * 3 + 2];
        const l = Math.hypot(x, y, z) || 1;
        nor[v * 3] = x / l;
        nor[v * 3 + 1] = y / l;
        nor[v * 3 + 2] = z / l;
      }
    }
    this._dirty = false;
    return true;
  }

  /** Restores the pristine, un-eroded formation geometry. */
  reset() {
    if (!this.ready) return false;
    this.mesh.positions.set(this.basePositions);
    if (this.baseNormals && this.mesh.normals) this.mesh.normals.set(this.baseNormals);
    this.weldPos.set(this.weldBase);
    this.disp.fill(0);
    this.flow.fill(0);
    this.settle.fill(0);
    this._recomputeWeldNormals();
    this.time = 0;
    this.totalEroded = 0;
    this.stats = { droplets: 0, cut: 0, fill: 0 };
    this._dirty = true;
    return true;
  }

  // ==========================================================================
  // RAIN VISUALS (three.js Points driven from here so the viewport stays generic)
  // ==========================================================================
  _initRainVisuals() {
    const count = 1400;
    const arr = new Float32Array(count * 3);
    const b = this.bounds;
    const spanX = b.maxX - b.minX;
    const spanZ = b.maxZ - b.minZ;
    for (let i = 0; i < count; i++) {
      arr[i * 3] = b.minX + Math.random() * spanX;
      arr[i * 3 + 1] = b.minY + Math.random() * (b.maxY - b.minY + 6);
      arr[i * 3 + 2] = b.minZ + Math.random() * spanZ;
    }
    this._rain = {
      count,
      positions: arr,
      speed: new Float32Array(count),
    };
    for (let i = 0; i < this._rain.count; i++) {
      this._rain.speed[i] = 14 + Math.random() * 10;
    }
  }

  _updateRainVisuals(dt) {
    if (!this._rain) return;
    const rain = this._rain;
    const b = this.bounds;
    const pos = rain.positions;
    const top = b.maxY + 5;
    const bottom = b.minY - 0.5;
    const spanX = b.maxX - b.minX;
    const spanZ = b.maxZ - b.minZ;
    for (let i = 0; i < rain.count; i++) {
      pos[i * 3 + 1] -= rain.speed[i] * dt;
      pos[i * 3] += (this.params.windX || 0) * dt;
      pos[i * 3 + 2] += (this.params.windZ || 0) * dt;
      if (pos[i * 3 + 1] < bottom) {
        pos[i * 3] = b.minX + Math.random() * spanX;
        pos[i * 3 + 1] = top - Math.random() * 2;
        pos[i * 3 + 2] = b.minZ + Math.random() * spanZ;
      }
    }
  }

  getRainDrawData() {
    if (!this._rain || this.params.showRain === false) return null;
    return this._rain;
  }
}
