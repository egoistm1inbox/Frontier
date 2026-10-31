/**
 * 3D Bedrock Outcrops & Gravity-Settled Cliff-Calved Boulders for the GPU Erosion Landscape.
 *
 * Synthesizes authentic flat-faceted polyhedral rock geometry (using our exact 3D convex
 * polyhedron sculptor `sculptGeologicalParentPoly`) and runs real-time rigid-body cliff
 * detachment, gravity rolling, Coulomb scree friction, erosion-undercut wake-up, and
 * slope-aligned settling across the GPU terrain heightfield!
 */

import { createRng } from '../core/prng.js';
import { DEG2RAD, buildStrikeDipFrame, vnorm, clamp } from '../core/vec3.js';
import { clipPolyByHalfSpace, sculptGeologicalParentPoly } from '../geology/polyhedron.js';

const MAX_INSTANCES = 320;
const FLOATS_PER_INSTANCE = 16; // 4 x vec4: col0+seed, col1+wear, col2+radiusY, pos(xyz)+isOutcrop

/**
 * Builds 6 distinct flat-faceted polyhedral rock archetypes packed into a single shared mesh
 * buffer so all outcrops and fallen boulders draw in ONE instanced WebGL2 call (`< 0.12 ms`).
 */
export function buildRockArchetypeAtlas(seed = 7331) {
  const rng = createRng(seed);
  const positions = [];
  const normals = [];
  const masks = []; // (aoApprox, cavity, edge, localY)
  const indices = [];
  const submeshes = []; // { firstIndex, indexCount }

  const specs = [
    // 0..1: Resistant tilted cliff-rim / ridge outcrops (broad rooted base, craggy nose)
    { rx: 1.35, ry: 0.92, rz: 1.05, disp: 0.16, blunt: 0.78, cuts: 8, flatBase: true },
    { rx: 1.15, ry: 1.18, rz: 0.95, disp: 0.20, blunt: 0.74, cuts: 9, flatBase: true },
    // 2..3: Angular blocky cliff-calved megaboulders
    { rx: 1.05, ry: 0.82, rz: 0.92, disp: 0.22, blunt: 0.72, cuts: 7, flatBase: false },
    { rx: 0.96, ry: 0.88, rz: 0.86, disp: 0.24, blunt: 0.70, cuts: 8, flatBase: false },
    // 4..5: Tabular jointed spall slabs (settle flat on talus cones & riverbanks)
    { rx: 1.28, ry: 0.52, rz: 1.02, disp: 0.14, blunt: 0.80, cuts: 6, flatBase: false },
    { rx: 1.18, ry: 0.60, rz: 0.88, disp: 0.18, blunt: 0.76, cuts: 7, flatBase: false },
  ];

  for (let s = 0; s < specs.length; s++) {
    const sp = specs[s];
    const frame = buildStrikeDipFrame(s * 0.65, (14 + s * 6) * DEG2RAD);
    let poly = sculptGeologicalParentPoly(
      [0, 0, 0],
      [sp.rx, sp.ry, sp.rz],
      frame,
      rng,
      {
        jointDispersion: sp.disp,
        cornerBlunt: sp.blunt,
        flatBaseY: sp.flatBase ? -sp.ry * 0.75 : null,
        extraBevelCuts: sp.cuts,
      }
    );
    if (sp.flatBase && poly) {
      poly = clipPolyByHalfSpace(poly, [0, -1, 0], sp.ry * 0.75, 'root') || poly;
    }

    const firstIndex = indices.length;
    if (poly && poly.faces) {
      // Compute polyhedron interior centroid so every face normal is guaranteed to point OUTWARD!
      let pcx = 0, pcy = 0, pcz = 0, pCount = 0;
      for (let f = 0; f < poly.faces.length; f++) {
        const fv = poly.faces[f].verts;
        if (!fv) continue;
        for (let k = 0; k < fv.length; k++) {
          pcx += fv[k][0]; pcy += fv[k][1]; pcz += fv[k][2];
          pCount++;
        }
      }
      if (pCount > 0) { pcx /= pCount; pcy /= pCount; pcz /= pCount; }

      for (let f = 0; f < poly.faces.length; f++) {
        const face = poly.faces[f];
        const fv = face.verts;
        if (!fv || fv.length < 3) continue;
        let fn = vnorm(face.normal);

        // Compute face centroid to accentuate crisp rock arris edges (`edgeMask`)
        let cx = 0, cy = 0, cz = 0;
        for (let k = 0; k < fv.length; k++) {
          cx += fv[k][0]; cy += fv[k][1]; cz += fv[k][2];
        }
        cx /= fv.length; cy /= fv.length; cz /= fv.length;

        // Enforce strictly OUTWARD face normal relative to polyhedron interior centroid!
        if ((cx - pcx) * fn[0] + (cy - pcy) * fn[1] + (cz - pcz) * fn[2] < 0) {
          fn = [-fn[0], -fn[1], -fn[2]];
        }

        const baseVertex = positions.length / 3;
        // Center vertex + perimeter vertices so edge distance is exact on every facet!
        positions.push(cx, cy, cz);
        normals.push(fn[0], fn[1], fn[2]);
        const centerAo = clamp(0.62 + 0.34 * ((cy / sp.ry) * 0.5 + 0.5), 0.32, 0.98);
        masks.push(centerAo, 0.18, 0.0, clamp(cy / sp.ry, -1, 1));

        for (let k = 0; k < fv.length; k++) {
          const v = fv[k];
          positions.push(v[0], v[1], v[2]);
          normals.push(fn[0], fn[1], fn[2]);
          const vAo = clamp(0.56 + 0.38 * ((v[1] / sp.ry) * 0.5 + 0.5), 0.28, 0.98);
          masks.push(vAo, 0.06, 0.92, clamp(v[1] / sp.ry, -1, 1));
        }

        for (let k = 0; k < fv.length; k++) {
          const kNext = (k + 1) % fv.length;
          const v0 = fv[k];
          const v1 = fv[kNext];
          // Guarantee outward CCW winding `(v0 - c) x (v1 - c) . fn > 0` for gl.cullFace(gl.BACK)!
          const e0x = v0[0] - cx, e0y = v0[1] - cy, e0z = v0[2] - cz;
          const e1x = v1[0] - cx, e1y = v1[1] - cy, e1z = v1[2] - cz;
          const nx = e0y * e1z - e0z * e1y;
          const ny = e0z * e1x - e0x * e1z;
          const nz = e0x * e1y - e0y * e1x;
          if (nx * fn[0] + ny * fn[1] + nz * fn[2] >= 0) {
            indices.push(baseVertex, baseVertex + 1 + k, baseVertex + 1 + kNext);
          } else {
            indices.push(baseVertex, baseVertex + 1 + kNext, baseVertex + 1 + k);
          }
        }
      }
    }
    submeshes.push({ firstIndex, indexCount: indices.length - firstIndex });
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    masks: new Float32Array(masks),
    indices: new Uint16Array(indices),
    submeshes,
  };
}

/**
 * Manages 3D cliff outcrops & dynamically rolling/settling fallen boulders on the GPU terrain.
 */
export class RockCalvingSystem {
  constructor() {
    this.atlas = buildRockArchetypeAtlas(7331);
    this.gridRes = 64;
    this.heightGrid = new Float32Array(64 * 64 * 4); // (bedrock, coarse, fine, water)
    this.hasHeightSnapshot = false;
    this.worldSpan = 512.0;

    this.rocks = [];
    // Separate per-submesh instance staging arrays for 6-archetype instanced draw
    this.bucketData = this.atlas.submeshes.map(() => new Float32Array(MAX_INSTANCES * FLOATS_PER_INSTANCE));
    this.bucketCounts = new Int32Array(this.atlas.submeshes.length);
  }

  /**
   * Updates the 64x64 terrain snapshot `(bedrock, coarse, fine, water)` read from GPU.
   * Automatically wakes up settled boulders if hydraulic erosion undercuts their support!
   */
  updateTerrainSnapshot(rgba64, gridRes = 64, worldSpan = 512.0) {
    this.gridRes = gridRes;
    this.worldSpan = worldSpan;
    if (this.heightGrid.length !== rgba64.length) {
      this.heightGrid = new Float32Array(rgba64.length);
    }
    this.heightGrid.set(rgba64);
    this.hasHeightSnapshot = true;

    for (let i = 0; i < this.rocks.length; i++) {
      const r = this.rocks[i];
      const s = this.sampleTerrain(r.x, r.z);
      if (r.isOutcrop) {
        if (s.slope > 0.44 || s.water > 0.35) {
          // Cliff erosion undercut this rim outcrop into a steep slope -> calve & tumble down!
          r.isOutcrop = false;
          r.settled = false;
          r.airLift = 0.25;
          r.wakeTimer = 4.5;
        } else {
          // Outcrop stays rooted on gentle crown/rim above ground
          r.y = s.totalH + r.radiusY * 0.34;
          r.airLift = 0.0;
        }
      } else if (r.settled) {
        const targetY = s.totalH + r.radiusY * 0.44;
        const drop = r.y - targetY;
        if (drop > 0.24 || s.slope > 0.40) {
          // GPU erosion undercut or steepened the ground beneath this boulder -> wake & slide!
          r.settled = false;
          r.airLift = Math.max(0.0, drop);
          r.wakeTimer = 4.0;
        } else {
          r.y = targetY;
          r.airLift = 0.0;
          this._alignToSlope(r, s.nx, s.ny, s.nz, 0.22);
        }
      }
    }
  }

  sampleTerrain(wx, wz) {
    const N = this.gridRes;
    const span = this.worldSpan;
    const u = clamp(wx / span + 0.5, 0.001, 0.999) * (N - 1);
    const v = clamp(wz / span + 0.5, 0.001, 0.999) * (N - 1);
    const ix = Math.min(N - 2, Math.floor(u));
    const iz = Math.min(N - 2, Math.floor(v));
    const fx = u - ix;
    const fz = v - iz;

    const g = this.heightGrid;
    const i00 = (iz * N + ix) * 4;
    const i10 = i00 + 4;
    const i01 = i00 + N * 4;
    const i11 = i01 + 4;

    const bilerp = (ch) => {
      const a = g[i00 + ch] * (1 - fx) + g[i10 + ch] * fx;
      const b = g[i01 + ch] * (1 - fx) + g[i11 + ch] * fx;
      return a * (1 - fz) + b * fz;
    };

    const bedrock = bilerp(0);
    const coarse = bilerp(1);
    const fine = bilerp(2);
    const water = bilerp(3);
    const totalH = bedrock + coarse + fine;

    const cellM = span / (N - 1);
    const h00 = g[i00] + g[i00 + 1] + g[i00 + 2];
    const h10 = g[i10] + g[i10 + 1] + g[i10 + 2];
    const h01 = g[i01] + g[i01 + 1] + g[i01 + 2];
    const h11 = g[i11] + g[i11 + 1] + g[i11 + 2];
    const dhdx = ((h10 - h00) * (1 - fz) + (h11 - h01) * fz) / cellM;
    const dhdz = ((h01 - h00) * (1 - fx) + (h11 - h10) * fx) / cellM;
    const slope = Math.hypot(dhdx, dhdz);
    const invN = 1 / Math.hypot(dhdx, 1, dhdz);

    return {
      bedrock,
      coarse,
      fine,
      water,
      totalH,
      dhdx,
      dhdz,
      slope,
      nx: -dhdx * invN,
      ny: invN,
      nz: -dhdz * invN,
    };
  }

  /**
   * Seeds cliff outcrops along resistant scarps and detaches boulders from steep cliff faces,
   * running initial gravity-rolling settling steps so boulders immediately sit naturally at
   * cliff toes, talus cones, and canyon benches!
   */
  seedForLandscape(params) {
    this.rocks.length = 0;
    const density = clamp(params.boulderDensity ?? 0.65, 0, 1);
    if (!this.hasHeightSnapshot || density <= 0.02) {
      this._rebuildInstanceBuckets();
      return;
    }

    const rng = createRng((params.seed || 4029) + 9187);
    const span = params.worldSpan || 512.0;
    const half = span * 0.455;
    const strikeRad = ((params.strataStrike ?? 0) * Math.PI) / 180;
    const dipRad = ((params.strataDip ?? 8) * Math.PI) / 180;

    // Collect convex rocky ridge/rim candidates for rooted bedrock outcrops (NEVER steep slopes, water, or deep sand!)
    const rimCells = [];
    const apronCells = [];
    const N = this.gridRes;
    const cellStep = span / N;
    for (let iz = 3; iz < N - 3; iz++) {
      for (let ix = 3; ix < N - 3; ix++) {
        const wx = ((ix + 0.5) / N - 0.5) * span;
        const wz = ((iz + 0.5) / N - 0.5) * span;
        if (Math.abs(wx) > half || Math.abs(wz) > half) continue;
        const s = this.sampleTerrain(wx, wz);
        if (s.water > 0.06 || s.fine > 1.35) continue;

        // Check neighborhood for ridge convexity (outcrops) and nearby cliff scarps (talus aprons)
        const sE = this.sampleTerrain(wx + cellStep, wz);
        const sW = this.sampleTerrain(wx - cellStep, wz);
        const sN = this.sampleTerrain(wx, wz + cellStep);
        const sS = this.sampleTerrain(wx, wz - cellStep);
        const meanNb = 0.25 * (sE.totalH + sW.totalH + sN.totalH + sS.totalH);
        const convexity = s.totalH - meanNb;
        const maxNbSlope = Math.max(sE.slope, sW.slope, sN.slope, sS.slope);

        // Rooted outcrops ONLY belong on flat/gentle convex ridge crowns, rims & knolls (slope <= 0.36)
        if (s.slope >= 0.04 && s.slope <= 0.36 && s.bedrock > 12.0 && s.fine < 0.75 && convexity > -0.35) {
          rimCells.push({ wx, wz, s, convexity });
        }
        // Cliff-toe talus & bench cells: gentle dry ground near steeper rocky slopes!
        if (s.slope <= 0.34 && s.bedrock > 4.0 && (maxNbSlope > 0.45 || s.coarse > 0.08)) {
          apronCells.push({ wx, wz, s });
        }
      }
    }

    // Prefer the most prominent convex ridge/rim crowns for bedrock outcrops
    rimCells.sort((a, b) => b.convexity - a.convexity);
    const crownPool = rimCells.slice(0, Math.max(24, Math.floor(rimCells.length * 0.65)));

    const targetOutcrops = Math.min(68, Math.round(density * 72));
    if (crownPool.length > 0) {
      for (let i = 0; i < targetOutcrops * 5 && this.rocks.length < targetOutcrops; i++) {
        const pick = crownPool[rng.int(0, crownPool.length - 1)];
        const jx = pick.wx + rng.signed() * 3.0;
        const jz = pick.wz + rng.signed() * 3.0;
        if (this._tooClose(jx, jz, 8.5)) continue;

        const st = this.sampleTerrain(jx, jz);
        if (st.water > 0.06 || st.slope > 0.38 || st.fine > 0.85) continue;
        const scale = rng.range(2.4, 5.4);
        const sx = scale * rng.range(0.95, 1.32);
        const sy = scale * rng.range(0.70, 1.06);
        const sz = scale * rng.range(0.86, 1.20);
        const yaw = strikeRad + rng.signed() * 0.28;
        const gentleDip = Math.min(0.18, Math.abs(dipRad)) * Math.sign(dipRad || 1);

        this.rocks.push({
          submesh: rng.int(0, 1),
          isOutcrop: true,
          settled: true,
          grounded: true,
          x: jx,
          y: st.totalH + sy * 0.34,
          airLift: 0.0,
          z: jz,
          vx: 0, vy: 0, vz: 0,
          sx, sy, sz,
          radiusY: sy,
          yaw,
          upX: Math.sin(strikeRad) * Math.sin(gentleDip),
          upY: Math.cos(gentleDip),
          upZ: Math.cos(strikeRad) * Math.sin(gentleDip),
          seedHash: rng.float(),
          wear: rng.range(0.15, 0.55),
          wakeTimer: 0,
        });
      }
    }

    // 1. Seed natural clustered talus-fan boulders directly along cliff toes & benches
    const targetBoulders = Math.min(185, Math.round(density * 195));
    const directApronTarget = Math.round(targetBoulders * 0.58);
    if (apronCells.length > 0) {
      let placed = 0;
      for (let tries = 0; tries < directApronTarget * 5 && placed < directApronTarget; tries++) {
        const anchor = apronCells[rng.int(0, apronCells.length - 1)];
        const clusterCount = rng.int(1, 3);
        for (let k = 0; k < clusterCount && placed < directApronTarget; k++) {
          const bx = clamp(anchor.wx + rng.signed() * 5.2, -half, half);
          const bz = clamp(anchor.wz + rng.signed() * 5.2, -half, half);
          if (this._tooClose(bx, bz, 2.6)) continue;
          const st = this.sampleTerrain(bx, bz);
          if (st.water > 0.06 || st.slope > 0.34 || st.fine > 1.45) continue;

          const isSlab = rng.chance(0.40);
          const submesh = isSlab ? rng.int(4, 5) : rng.int(2, 3);
          const baseR = (k === 0 ? 1.55 : 0.95) + Math.pow(rng.float(), 2.1) * (k === 0 ? 2.75 : 1.65);
          const sx = baseR * rng.range(0.90, 1.30);
          const sy = baseR * (isSlab ? rng.range(0.54, 0.74) : rng.range(0.78, 1.08));
          const sz = baseR * rng.range(0.86, 1.22);

          const rk = {
            submesh,
            isOutcrop: false,
            settled: true,
            grounded: true,
            x: bx,
            y: st.totalH + sy * 0.44,
            airLift: 0.0,
            z: bz,
            vx: 0, vy: 0, vz: 0,
            sx, sy, sz,
            radiusY: sy,
            yaw: rng.float() * Math.PI * 2,
            upX: 0, upY: 1, upZ: 0,
            isSlab,
            seedHash: rng.float(),
            wear: rng.range(0.25, 0.78),
            wakeTimer: 0,
          };
          this._alignToSlope(rk, st.nx * 0.65, 1.0, st.nz * 0.65, 0.92);
          this.rocks.push(rk);
          placed++;
        }
      }
    }

    // 2. Calve remaining boulders from steep cliffs & run gravity settling into couloir fans
    const calveCount = Math.max(24, targetBoulders - (this.rocks.length - targetOutcrops));
    this.calveCliffBoulders(calveCount, rng, true);

    for (let step = 0; step < 95; step++) {
      this.stepPhysics(0.06, true);
    }
    // Trigger a live rockfall batch at boot so user immediately sees brisk tumbling boulders!
    this.calveCliffBoulders(Math.round(density * 18), rng, false);
    this._rebuildInstanceBuckets();
  }

  /**
   * Detaches `count` fresh rock chunks from steep cliff scarps so they tumble & settle!
   */
  calveCliffBoulders(count = 24, customRng = null, allowAllPool = false) {
    if (!this.hasHeightSnapshot || count <= 0) return 0;
    const rng = customRng || createRng(Math.floor(performance.now()) + this.rocks.length * 37);
    const span = this.worldSpan;
    const half = span * 0.42;
    const N = this.gridRes;

    const cliffs = [];
    for (let iz = 4; iz < N - 4; iz++) {
      for (let ix = 4; ix < N - 4; ix++) {
        const wx = ((ix + 0.5) / N - 0.5) * span;
        const wz = ((iz + 0.5) / N - 0.5) * span;
        if (Math.abs(wx) > half || Math.abs(wz) > half) continue;
        const s = this.sampleTerrain(wx, wz);
        if (s.slope > (allowAllPool ? 0.52 : 0.68) && s.water < 0.08 && s.fine < 1.35) {
          cliffs.push({ wx, wz, s });
        }
      }
    }
    if (cliffs.length === 0) return 0;

    let spawned = 0;
    for (let tries = 0; tries < count * 4 && spawned < count; tries++) {
      if (this.rocks.length >= MAX_INSTANCES) {
        // Recycle oldest settled small boulder if at cap
        const idx = this.rocks.findIndex((b) => !b.isOutcrop && b.settled);
        if (idx >= 0) this.rocks.splice(idx, 1);
        else break;
      }

      const c = cliffs[rng.int(0, cliffs.length - 1)];
      const bx = c.wx + rng.signed() * 3.8;
      const bz = c.wz + rng.signed() * 3.8;
      const st = this.sampleTerrain(bx, bz);

      const isSlab = rng.chance(0.42);
      const submesh = isSlab ? rng.int(4, 5) : rng.int(2, 3);
      // Power-law size distribution: many medium talus blocks + occasional heroic megaboulders!
      const baseR = 1.05 + Math.pow(rng.float(), 2.2) * 3.35;
      const sx = baseR * rng.range(0.90, 1.32);
      const sy = baseR * (isSlab ? rng.range(0.48, 0.68) : rng.range(0.75, 1.06));
      const sz = baseR * rng.range(0.86, 1.22);

      // Push slightly downslope out of the cliff face with initial calving impulse
      const downLen = Math.hypot(st.dhdx, st.dhdz) || 1;
      const dx = -st.dhdx / downLen;
      const dz = -st.dhdz / downLen;

      this.rocks.push({
        submesh,
        isOutcrop: false,
        settled: false,
        grounded: false,
        x: bx + dx * 1.4,
        y: st.totalH + sy * 0.72,
        airLift: sy * 0.28,
        z: bz + dz * 1.4,
        vx: dx * rng.range(4.5, 11.5) + rng.signed() * 1.4,
        vy: rng.range(-1.0, 2.2),
        vz: dz * rng.range(4.5, 11.5) + rng.signed() * 1.4,
        sx, sy, sz,
        radiusY: sy,
        yaw: rng.float() * Math.PI * 2,
        upX: 0,
        upY: 1,
        upZ: 0,
        isSlab,
        seedHash: rng.float(),
        wear: rng.range(0.25, 0.78),
        wakeTimer: 3.5,
      });
      spawned++;
    }
    return spawned;
  }

  _tooClose(x, z, minDist) {
    const d2 = minDist * minDist;
    for (let i = 0; i < this.rocks.length; i++) {
      const r = this.rocks[i];
      const dx = r.x - x;
      const dz = r.z - z;
      if (dx * dx + dz * dz < d2) return true;
    }
    return false;
  }

  _alignToSlope(r, nx, ny, nz, blend = 0.25) {
    let ux = r.upX * (1 - blend) + nx * blend;
    let uy = r.upY * (1 - blend) + ny * blend;
    let uz = r.upZ * (1 - blend) + nz * blend;
    const l = Math.hypot(ux, uy, uz) || 1;
    r.upX = ux / l;
    r.upY = uy / l;
    r.upZ = uz / l;
  }

  /**
   * Advances gravity rolling, bouncing & Coulomb talus-friction settling for active boulders.
   * Boulders NEVER cling to steep slopes (> 21 deg) and accelerate briskly down cliffs at
   * landscape scale before plowing to rest on flat/gentle aprons & valley floors!
   */
  stepPhysics(dt = 0.033, duringPrewarm = false) {
    if (!this.hasHeightSnapshot || this.rocks.length === 0) return;
    // Landscape-accelerated rockfall gravity across the 500m mountain domain so boulders plunge
    // & slide down cliffs at crisp, natural real-time speed rather than creeping in slow motion!
    const g = 38.0;
    const half = this.worldSpan * 0.468;
    let anyMoved = duringPrewarm;

    for (let i = 0; i < this.rocks.length; i++) {
      const r = this.rocks[i];
      if (r.isOutcrop) continue;

      // Maximum slope on which a loose boulder can ever remain at rest (~20-22 deg = tan 0.36..0.41):
      // Any boulder on a steeper slope immediately breaks loose and slides/rolls down!
      const maxRestSlope = r.isSlab ? 0.41 : 0.36;
      if (r.settled) {
        const stCheck = this.sampleTerrain(r.x, r.z);
        if (stCheck.slope > maxRestSlope + 0.02) {
          r.settled = false;
          const dl = Math.hypot(stCheck.dhdx, stCheck.dhdz) || 1;
          r.vx = (-stCheck.dhdx / dl) * 3.5;
          r.vz = (-stCheck.dhdz / dl) * 3.5;
        } else {
          continue;
        }
      }

      anyMoved = true;
      r.wakeTimer -= dt;
      r.vy -= g * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.z += r.vz * dt;

      if (Math.abs(r.x) > half || Math.abs(r.z) > half) {
        r.x = clamp(r.x, -half, half);
        r.z = clamp(r.z, -half, half);
        r.vx *= -0.20;
        r.vz *= -0.20;
        const stEdge = this.sampleTerrain(r.x, r.z);
        if (stEdge.slope <= maxRestSlope + 0.12) {
          r.vx = 0; r.vz = 0; r.vy = 0;
          r.y = stEdge.totalH + r.radiusY * 0.44;
          r.airLift = 0.0;
          r.settled = true;
          this._alignToSlope(r, stEdge.nx * 0.5, 1.0, stEdge.nz * 0.5, 0.9);
          continue;
        }
      }

      const st = this.sampleTerrain(r.x, r.z);
      const restY = st.totalH + r.radiusY * 0.44;

      // Halt on shoreline bank before plunging deep underwater so boulders never vanish into lakes!
      if (st.water > 0.55) {
        r.vx *= 0.25;
        r.vz *= 0.25;
        if (Math.hypot(r.vx, r.vz) < 1.8 && st.slope <= maxRestSlope + 0.08) {
          r.vx = 0; r.vz = 0; r.vy = 0;
          r.y = restY;
          r.airLift = 0.0;
          r.settled = true;
          continue;
        }
      }

      // Keep sliding boulders in continuous contact with steep mountain walls/couloirs (up to 74 deg)
      // so downslope gravity accelerates vx/vz EVERY frame instead of skipping frames in mid-air!
      if (r.grounded && st.slope <= 3.5 && r.y < restY + r.radiusY * 1.6) {
        r.y = restY;
        r.airLift = 0.0;
        r.vy = 0;
      }

      if (r.y <= restY) {
        r.y = restY;
        r.airLift = 0.0;
        r.grounded = true;
        if (r.vy < -22.0) {
          r.vy = -r.vy * 0.16;
          r.grounded = false;
        } else {
          r.vy = 0;
        }

        const inv1pS2 = 1 / (1 + st.slope * st.slope);
        const axGravity = -g * st.dhdx * inv1pS2;
        const azGravity = -g * st.dhdz * inv1pS2;
        r.vx += axGravity * dt;
        r.vz += azGravity * dt;

        const speedH = Math.hypot(r.vx, r.vz);

        if (st.slope <= maxRestSlope) {
          // Gentle bench / talus toe / valley floor (<= 21 deg): strong scree & water plowing drag brings rock to crisp rest!
          const muStop = (r.isSlab ? 0.68 : 0.56) + Math.min(0.28, st.coarse * 0.14 + st.fine * 0.18) + (st.water > 0.15 ? 0.40 : 0);
          const decel = muStop * g * Math.sqrt(inv1pS2) * dt + speedH * 1.15 * dt;
          if (speedH <= decel * 1.25 || speedH < 1.35) {
            r.vx = 0;
            r.vz = 0;
            r.settled = true;
            // Settle with natural stable base (gently conformed to apron, never precariously tilted!)
            this._alignToSlope(r, st.nx * 0.65, 1.0, st.nz * 0.65, 0.90);
          } else {
            const nextSpeed = Math.max(0, speedH - decel);
            r.vx = (r.vx / speedH) * nextSpeed;
            r.vz = (r.vz / speedH) * nextSpeed;
            r.yaw += (nextSpeed / Math.max(0.6, r.radiusY)) * dt * 0.45;
            this._alignToSlope(r, st.nx * 0.75, st.ny, st.nz * 0.75, 0.35);
          }
        } else {
          // Steep slope / cliff (> 21 deg): NEVER cling! Low rolling resistance (0.16) so rocks accelerate fast downslope!
          const rollLoss = 0.16 * g * Math.sqrt(inv1pS2) * dt;
          const airDrag = (0.04 + 0.008 * speedH) * dt;
          const minSlideSpeed = Math.min(22.0, 5.5 + (st.slope - maxRestSlope) * 18.0);
          const nextSpeed = Math.min(58.0, Math.max(minSlideSpeed, (speedH - rollLoss) * Math.max(0.6, 1 - airDrag)));
          if (speedH > 1e-4) {
            r.vx = (r.vx / speedH) * nextSpeed;
            r.vz = (r.vz / speedH) * nextSpeed;
          } else {
            const dl = Math.hypot(st.dhdx, st.dhdz) || 1;
            r.vx = (-st.dhdx / dl) * minSlideSpeed;
            r.vz = (-st.dhdz / dl) * minSlideSpeed;
          }
          r.yaw += (nextSpeed / Math.max(0.6, r.radiusY)) * dt * 0.65;
          this._alignToSlope(r, st.nx * 0.55, 1.0, st.nz * 0.55, 0.28);
        }
      } else {
        r.airLift = Math.max(0.0, r.y - restY);
      }
    }

    if (anyMoved) {
      this._rebuildInstanceBuckets();
    }
  }

  _rebuildInstanceBuckets() {
    this.bucketCounts.fill(0);
    for (let i = 0; i < this.rocks.length; i++) {
      const r = this.rocks[i];
      const bIdx = r.submesh;
      const slot = this.bucketCounts[bIdx];
      if (slot >= MAX_INSTANCES) continue;
      this.bucketCounts[bIdx] = slot + 1;

      // Right-handed orthonormal basis (det = +1.0!): b = t x u (NOT u x t!)
      // With det = -1 previously, cofactor(M) = -M^{-T} inverted every normal & flipped CCW winding!
      const ux = r.upX, uy = r.upY, uz = r.upZ;
      const cy = Math.cos(r.yaw), sy = Math.sin(r.yaw);
      let tx = cy, ty = 0, tz = sy;
      const dotTU = tx * ux + ty * uy + tz * uz;
      tx -= ux * dotTU; ty -= uy * dotTU; tz -= uz * dotTU;
      let tl = Math.hypot(tx, ty, tz);
      if (tl < 1e-5) {
        tx = Math.abs(uy) < 0.9 ? 0 : 1;
        ty = Math.abs(uy) < 0.9 ? 1 : 0;
        tz = 0;
        const d2 = tx * ux + ty * uy + tz * uz;
        tx -= ux * d2; ty -= uy * d2; tz -= uz * d2;
        tl = Math.hypot(tx, ty, tz) || 1;
      }
      tx /= tl; ty /= tl; tz /= tl;

      const bx = ty * uz - tz * uy;
      const by = tz * ux - tx * uz;
      const bz = tx * uy - ty * ux;

      const arr = this.bucketData[bIdx];
      const o = slot * FLOATS_PER_INSTANCE;
      // aInstCol0: scaled right (xyz) + seedHash (w)
      arr[o + 0] = tx * r.sx;
      arr[o + 1] = ty * r.sx;
      arr[o + 2] = tz * r.sx;
      arr[o + 3] = r.seedHash;
      // aInstCol1: scaled up (xyz) + wear (w)
      arr[o + 4] = ux * r.sy;
      arr[o + 5] = uy * r.sy;
      arr[o + 6] = uz * r.sy;
      arr[o + 7] = r.wear;
      // aInstCol2: scaled forward (xyz) + radiusY (w)
      arr[o + 8] = bx * r.sz;
      arr[o + 9] = by * r.sz;
      arr[o + 10] = bz * r.sz;
      arr[o + 11] = r.radiusY;
      // aInstPosMeta: (worldX, airLiftAboveGround, worldZ, isOutcrop)
      // ROCK_INSTANCE_VERT samples exact 512x512 uTerrainTex + uSnowTex at (worldX, worldZ) so rocks
      // NEVER sink or disappear under sub-8m terrain ridges, dunes, or snowdrifts!
      arr[o + 12] = r.x;
      arr[o + 13] = Math.max(0.0, r.airLift || 0.0);
      arr[o + 14] = r.z;
      arr[o + 15] = r.isOutcrop ? 1.0 : 0.0;
    }
  }
}
