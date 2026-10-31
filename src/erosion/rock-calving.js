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

  // Per-submesh local half-extents (max |coord| on each axis) so the rigid-body collision boxes
  // match the real polyhedron sizes instead of guessed radii.
  const halfExtents = submeshes.map((sm) => {
    let mx = 1e-3, my = 1e-3, mz = 1e-3;
    for (let i = sm.firstIndex; i < sm.firstIndex + sm.indexCount; i++) {
      const v = indices[i] * 3;
      mx = Math.max(mx, Math.abs(positions[v]));
      my = Math.max(my, Math.abs(positions[v + 1]));
      mz = Math.max(mz, Math.abs(positions[v + 2]));
    }
    return [mx, my, mz];
  });

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    masks: new Float32Array(masks),
    indices: new Uint16Array(indices),
    submeshes,
    halfExtents,
  };
}

/* ==========================================================================
 * RIGID-BODY ROCK PHYSICS
 * ==========================================================================
 * Every loose boulder is a real rigid body:
 *   - position + unit quaternion orientation, linear & angular velocity
 *   - mass / box inertia tensor from its real polyhedron half-extents
 *   - gravity, air drag and water buoyancy
 *   - contact against the GPU heightfield (sampled at the 8 box corners, normal from the
 *     terrain gradient) with sequential impulses, Coulomb friction and restitution
 *   - contact against other boulders (sphere proxies, spatially hashed)
 *   - sleeping when at rest, waking automatically when the ground under them is undercut
 * Rooted outcrops are static bodies that only become dynamic when their support is removed.
 *
 * The renderer draws each rock with the exact physics transform (no terrain re-sampling), so a
 * boulder can never float or sink relative to the simulated body that is resting on the ground.
 */

const GRAVITY = 9.81;
const SUBSTEP = 1 / 120;          // fixed physics substep (seconds)
const MAX_SUBSTEPS = 24;          // per call, keeps a long frame stable
const SOLVER_ITERATIONS = 6;
const BAUMGARTE = 0.22;           // penetration correction fraction per substep
const PEN_SLOP = 0.004;           // metres of allowed penetration
const MAX_PUSH_VELOCITY = 2.0;    // m/s cap on penetration correction
const SLEEP_LINEAR = 0.10;        // m/s (visually motionless)
const SLEEP_ANGULAR = 0.15;       // rad/s
const SLEEP_TIME = 0.8;           // seconds at rest before sleeping
const WAKE_CLEARANCE = 0.12;      // ground dropping away this far under a sleeper wakes it
const BURY_FRAC = 0.9;             // fraction of a boulder's height under ground before it is buried
const UNBURY_FRAC = 0.5;           // ground must fall back below this fraction to release it
const ABRASION_PER_METRE = 0.006;  // metres of bedrock scoured per metre a boulder slides on the ground
const OUTCROP_UNDERCUT = 0.9;     // metres of ground loss under a rooted outcrop before it falls
const ROCK_DENSITY = 2600;        // kg/m^3 (only the ratios matter for the solver)

// ---------- small quaternion / matrix helpers (quaternions are [x, y, z, w]) ----------
function quatFromYawPitchRoll(yaw, pitch, roll) {
  const cy = Math.cos(yaw * 0.5), sy = Math.sin(yaw * 0.5);
  const cp = Math.cos(pitch * 0.5), sp = Math.sin(pitch * 0.5);
  const cr = Math.cos(roll * 0.5), sr = Math.sin(roll * 0.5);
  // Z-X-Y order: yaw about world Y, then pitch about X, then roll about Z
  return [
    sp * cy * cr + cp * sy * sr,
    sy * cp * cr - sp * cy * sr,
    cy * cp * sr - sp * sy * cr,
    cy * cp * cr + sp * sy * sr,
  ];
}

function quatIntegrate(q, wx, wy, wz, h) {
  // q += 0.5 * h * (w (*) q), then renormalise
  const [qx, qy, qz, qw] = q;
  const dx = 0.5 * h * (wx * qw + wy * qz - wz * qy);
  const dy = 0.5 * h * (wy * qw + wz * qx - wx * qz);
  const dz = 0.5 * h * (wz * qw + wx * qy - wy * qx);
  const dw = 0.5 * h * (-wx * qx - wy * qy - wz * qz);
  const nx = qx + dx, ny = qy + dy, nz = qz + dz, nw = qw + dw;
  const l = Math.hypot(nx, ny, nz, nw) || 1;
  q[0] = nx / l; q[1] = ny / l; q[2] = nz / l; q[3] = nw / l;
}

function quatToMat(q) {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return [
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
  ];
}

// World-space inverse inertia tensor applied to a vector: I^-1 * v = R * diag(invI) * R^T * v
function applyInvInertia(m, invI, vx, vy, vz) {
  // R^T * v
  const tx = m[0] * vx + m[3] * vy + m[6] * vz;
  const ty = m[1] * vx + m[4] * vy + m[7] * vz;
  const tz = m[2] * vx + m[5] * vy + m[8] * vz;
  // diag
  const ux = tx * invI[0], uy = ty * invI[1], uz = tz * invI[2];
  // R * u
  return [
    m[0] * ux + m[1] * uy + m[2] * uz,
    m[3] * ux + m[4] * uy + m[5] * uz,
    m[6] * ux + m[7] * uy + m[8] * uz,
  ];
}

const CORNER_SIGNS = [
  [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1],
];

/**
 * Manages 3D cliff outcrops and the rigid-body boulder field on the GPU terrain.
 */
export class RockCalvingSystem {
  constructor() {
    this.atlas = buildRockArchetypeAtlas(7331);
    this.gridRes = 128;
    this.heightGrid = new Float32Array(128 * 128 * 4); // (bedrock, coarse, fine, water)
    this.hasHeightSnapshot = false;
    this.worldSpan = 512.0;
    // Texels by which the GPU read-back grid is offset from the texel-centre convention (set by engine)
    this.sampleShiftTexels = 0;

    this.rocks = [];
    this.simTime = 0;
    // Bed scour removed by sliding boulders this interval (metres per cell), applied to the GPU terrain
    this.scourGrid = null;
    this.scourRes = 0;
    this._scratch = { bedrock: 0, coarse: 0, fine: 0, water: 0, totalH: 0, dhdx: 0, dhdz: 0, slope: 0, nx: 0, ny: 1, nz: 0 };
    // Separate per-submesh instance staging arrays for 6-archetype instanced draw
    this.bucketData = this.atlas.submeshes.map(() => new Float32Array(MAX_INSTANCES * FLOATS_PER_INSTANCE));
    this.bucketCounts = new Int32Array(this.atlas.submeshes.length);
  }

  /**
   * Updates the terrain snapshot `(bedrock, coarse, fine, water)` read back from the GPU.
   * Rooted outcrops follow the ground, undercut outcrops fall, and sleeping boulders wake if the
   * ground under them was removed.
   */
  updateTerrainSnapshot(rgbaGrid, gridRes = 128, worldSpan = 512.0) {
    this.gridRes = gridRes;
    this.worldSpan = worldSpan;
    if (this.heightGrid.length !== rgbaGrid.length) {
      this.heightGrid = new Float32Array(rgbaGrid.length);
    }
    this.heightGrid.set(rgbaGrid);
    this.hasHeightSnapshot = true;
    if (!this.scourGrid || this.scourRes !== gridRes) {
      this.scourGrid = new Float32Array(gridRes * gridRes);
      this.scourRes = gridRes;
    }

    for (let i = 0; i < this.rocks.length; i++) {
      const r = this.rocks[i];
      if (r.isOutcrop && !r.dynamic) {
        const s = this.sampleTerrain(r.x, r.z);
        if (r.seedSurfaceH - s.totalH > OUTCROP_UNDERCUT || s.slope > 0.62) {
          // Ground beneath the rooted rim was cut away -> the outcrop loses support and falls
          this._makeDynamic(r, 0.0);
        } else {
          r.y = s.totalH + r.embed;
          this._alignToSurface(r, s.nx, s.ny, s.nz);
        }
      } else if (r.dynamic) {
        // Sediment burial: a boulder the ground has risen over is frozen and hidden by the surface
        if (this._updateBurial(r)) continue;
        // Sleeping boulders wake up if the ground under any corner has dropped away
        if (r.sleeping) {
          const clearance = this._minClearance(r);
          if (clearance > WAKE_CLEARANCE || clearance < -0.25) this._wake(r);
        }
      }
    }
    this._rebuildInstanceBuckets();
  }

  /**
   * Bilinear heightfield sample with analytic normal. Writes into an internal scratch object and
   * returns it (no allocation in hot loops). Call sampleTerrain for a fresh copy.
   */
  _sampleInto(wx, wz, out) {
    // Texel-centre convention: texel j covers world [(j/N - 0.5) .. ((j+1)/N - 0.5)] * span,
    // matching the GPU telemetry read-back which samples each texel at (j + 0.5) / N.
    const N = this.gridRes;
    const span = this.worldSpan;
    const shift = this.sampleShiftTexels || 0;
    const u = clamp(wx / span + 0.5, 0.0, 1.0) * N - 0.5 - shift;
    const v = clamp(wz / span + 0.5, 0.0, 1.0) * N - 0.5 - shift;
    const ix = clamp(Math.floor(u), 0, N - 2);
    const iz = clamp(Math.floor(v), 0, N - 2);
    const fx = clamp(u - ix, 0, 1);
    const fz = clamp(v - iz, 0, 1);

    const g = this.heightGrid;
    const i00 = (iz * N + ix) * 4;
    const i10 = i00 + 4;
    const i01 = i00 + N * 4;
    const i11 = i01 + 4;

    const w00 = (1 - fx) * (1 - fz), w10 = fx * (1 - fz), w01 = (1 - fx) * fz, w11 = fx * fz;
    out.bedrock = g[i00] * w00 + g[i10] * w10 + g[i01] * w01 + g[i11] * w11;
    out.coarse = g[i00 + 1] * w00 + g[i10 + 1] * w10 + g[i01 + 1] * w01 + g[i11 + 1] * w11;
    out.fine = g[i00 + 2] * w00 + g[i10 + 2] * w10 + g[i01 + 2] * w01 + g[i11 + 2] * w11;
    out.water = g[i00 + 3] * w00 + g[i10 + 3] * w10 + g[i01 + 3] * w01 + g[i11 + 3] * w11;
    out.totalH = out.bedrock + out.coarse + out.fine;

    const cellM = span / N;
    const h00 = g[i00] + g[i00 + 1] + g[i00 + 2];
    const h10 = g[i10] + g[i10 + 1] + g[i10 + 2];
    const h01 = g[i01] + g[i01 + 1] + g[i01 + 2];
    const h11 = g[i11] + g[i11 + 1] + g[i11 + 2];
    const dhdx = ((h10 - h00) * (1 - fz) + (h11 - h01) * fz) / cellM;
    const dhdz = ((h01 - h00) * (1 - fx) + (h11 - h10) * fx) / cellM;
    const slope = Math.hypot(dhdx, dhdz);
    const invN = 1 / Math.hypot(dhdx, 1, dhdz);
    out.dhdx = dhdx;
    out.dhdz = dhdz;
    out.slope = slope;
    out.nx = -dhdx * invN;
    out.ny = invN;
    out.nz = -dhdz * invN;
    return out;
  }

  sampleTerrain(wx, wz) {
    return { ...this._sampleInto(wx, wz, this._scratch) };
  }

  /**
   * Seeds rooted cliff outcrops, drops talus & cliff boulders above the ground and lets the
   * rigid-body solver settle them into their natural resting poses.
   */
  seedForLandscape(params) {
    this.rocks.length = 0;
    this.simTime = 0;
    if (this.scourGrid) this.scourGrid.fill(0);
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

    // Collect convex rocky ridge/rim candidates for rooted bedrock outcrops
    const rimCells = [];
    const apronCells = [];
    const N = this.gridRes;
    const cellStep = span / N;
    const tmp = { ...this._scratch };
    const cellsPerSide = Math.max(1, Math.floor(N / 64));
    for (let iz = 3; iz < N - 3; iz += cellsPerSide) {
      for (let ix = 3; ix < N - 3; ix += cellsPerSide) {
        const wx = ((ix + 0.5) / N - 0.5) * span;
        const wz = ((iz + 0.5) / N - 0.5) * span;
        if (Math.abs(wx) > half || Math.abs(wz) > half) continue;
        const s = { ...this._sampleInto(wx, wz, tmp) };
        if (s.water > 0.06 || s.fine > 1.35) continue;

        const sE = this._sampleInto(wx + cellStep, wz, tmp);
        const sW = this._sampleInto(wx - cellStep, wz, tmp);
        const sN = this._sampleInto(wx, wz + cellStep, tmp);
        const sS = this._sampleInto(wx, wz - cellStep, tmp);
        const meanNb = 0.25 * (sE.totalH + sW.totalH + sN.totalH + sS.totalH);
        const convexity = s.totalH - meanNb;
        const maxNbSlope = Math.max(sE.slope, sW.slope, sN.slope, sS.slope);

        if (s.slope >= 0.04 && s.slope <= 0.36 && s.bedrock > 12.0 && s.fine < 0.75 && convexity > -0.35) {
          rimCells.push({ wx, wz, s, convexity });
        }
        if (s.slope <= 0.34 && s.bedrock > 4.0 && (maxNbSlope > 0.45 || s.coarse > 0.08)) {
          apronCells.push({ wx, wz, s });
        }
      }
    }

    // Rooted outcrops: static bodies on prominent convex ridge crowns
    rimCells.sort((a, b) => b.convexity - a.convexity);
    const crownPool = rimCells.slice(0, Math.max(24, Math.floor(rimCells.length * 0.65)));
    const targetOutcrops = Math.min(68, Math.round(density * 72));
    if (crownPool.length > 0) {
      for (let i = 0; i < targetOutcrops * 5 && this.rocks.length < targetOutcrops; i++) {
        const pick = crownPool[rng.int(0, crownPool.length - 1)];
        const jx = pick.wx + rng.signed() * 3.0;
        const jz = pick.wz + rng.signed() * 3.0;
        if (this._tooClose(jx, jz, 8.5)) continue;

        const st = this._sampleInto(jx, jz, tmp);
        if (st.water > 0.06 || st.slope > 0.38 || st.fine > 0.85) continue;
        const scale = rng.range(2.4, 5.4);
        const sx = scale * rng.range(0.95, 1.32);
        const sy = scale * rng.range(0.70, 1.06);
        const sz = scale * rng.range(0.86, 1.20);
        const yaw = strikeRad + rng.signed() * 0.28;
        const gentleDip = Math.min(0.18, Math.abs(dipRad)) * Math.sign(dipRad || 1);
        const r = this._makeBody({
          submesh: rng.int(0, 1),
          isOutcrop: true,
          x: jx,
          z: jz,
          y: st.totalH + sy * 0.34,
          sx, sy, sz,
          yaw,
          pitch: gentleDip,
          roll: 0,
          seedHash: rng.float(),
          wear: rng.range(0.15, 0.55),
          isSlab: false,
          dynamic: false,
        });
        r.embed = sy * 0.34;
        r.seedSurfaceH = st.totalH;
        this.rocks.push(r);
      }
    }

    // Talus-fan boulders clustered along cliff toes and benches; they are dropped and settle
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
          const st = this._sampleInto(bx, bz, tmp);
          if (st.water > 0.06 || st.slope > 0.34 || st.fine > 1.45) continue;

          const isSlab = rng.chance(0.40);
          const submesh = isSlab ? rng.int(4, 5) : rng.int(2, 3);
          const baseR = (k === 0 ? 1.55 : 0.95) + Math.pow(rng.float(), 2.1) * (k === 0 ? 2.75 : 1.65);
          const sx = baseR * rng.range(0.90, 1.30);
          const sy = baseR * (isSlab ? rng.range(0.54, 0.74) : rng.range(0.78, 1.08));
          const sz = baseR * rng.range(0.86, 1.22);
          const body = this._makeBody({
            submesh,
            isOutcrop: false,
            x: bx,
            z: bz,
            y: st.totalH + sy + 0.6 + rng.range(0.0, 1.2),
            sx, sy, sz,
            yaw: rng.float() * Math.PI * 2,
            pitch: rng.signed() * (isSlab ? 0.12 : 0.6),
            roll: rng.signed() * (isSlab ? 0.12 : 0.6),
            seedHash: rng.float(),
            wear: rng.range(0.25, 0.78),
            isSlab,
            dynamic: true,
          });
          this.rocks.push(body);
          placed++;
        }
      }
    }

    // Cliff-calved boulders start in free fall with downslope kick
    const calveCount = Math.max(24, targetBoulders - (this.rocks.length - this.rocks.filter((b) => b.isOutcrop).length));
    this.calveCliffBoulders(calveCount, rng, true);

    // Let the whole field fall and settle physically before the first frame is drawn
    this.settleField(12.0);

    // Trigger a live rockfall batch at boot so the user immediately sees boulders tumbling
    this.calveCliffBoulders(Math.round(density * 18), rng, false);
    this.settleField(3.0);
    this._rebuildInstanceBuckets();
  }

  /**
   * Detaches `count` fresh rock chunks from steep cliff scarps. They start in free fall with a
   * downslope impulse and then tumble under the rigid-body solver.
   */
  calveCliffBoulders(count = 24, customRng = null, allowAllPool = false) {
    if (!this.hasHeightSnapshot || count <= 0) return 0;
    const rng = customRng || createRng(Math.floor(performance.now()) + this.rocks.length * 37);
    const span = this.worldSpan;
    const half = span * 0.42;
    const N = this.gridRes;
    const tmp = { ...this._scratch };

    const cliffs = [];
    const step = Math.max(1, Math.floor(N / 96));
    for (let iz = 4; iz < N - 4; iz += step) {
      for (let ix = 4; ix < N - 4; ix += step) {
        const wx = ((ix + 0.5) / N - 0.5) * span;
        const wz = ((iz + 0.5) / N - 0.5) * span;
        if (Math.abs(wx) > half || Math.abs(wz) > half) continue;
        const s = this._sampleInto(wx, wz, tmp);
        if (s.slope > (allowAllPool ? 0.52 : 0.68) && s.water < 0.08 && s.fine < 1.35) {
          cliffs.push({ wx, wz });
        }
      }
    }
    if (cliffs.length === 0) return 0;

    let spawned = 0;
    for (let tries = 0; tries < count * 4 && spawned < count; tries++) {
      if (this.rocks.length >= MAX_INSTANCES) {
        // Recycle the oldest sleeping small boulder when at capacity
        const idx = this.rocks.findIndex((b) => !b.isOutcrop && b.sleeping);
        if (idx >= 0) this.rocks.splice(idx, 1);
        else break;
      }

      const c = cliffs[rng.int(0, cliffs.length - 1)];
      const bx = c.wx + rng.signed() * 3.8;
      const bz = c.wz + rng.signed() * 3.8;
      const st = this._sampleInto(bx, bz, tmp);

      const isSlab = rng.chance(0.42);
      const submesh = isSlab ? rng.int(4, 5) : rng.int(2, 3);
      const baseR = 1.05 + Math.pow(rng.float(), 2.2) * 3.35;
      const sx = baseR * rng.range(0.90, 1.32);
      const sy = baseR * (isSlab ? rng.range(0.48, 0.68) : rng.range(0.75, 1.06));
      const sz = baseR * rng.range(0.86, 1.22);

      const downLen = Math.hypot(st.dhdx, st.dhdz) || 1;
      const dx = -st.dhdx / downLen;
      const dz = -st.dhdz / downLen;
      const speed = rng.range(1.5, 4.5);

      const body = this._makeBody({
        submesh,
        isOutcrop: false,
        x: bx + dx * 1.2,
        z: bz + dz * 1.2,
        y: st.totalH + sy * 1.4 + rng.range(0.5, 2.5),
        sx, sy, sz,
        yaw: rng.float() * Math.PI * 2,
        pitch: rng.signed() * 0.9,
        roll: rng.signed() * 0.9,
        seedHash: rng.float(),
        wear: rng.range(0.25, 0.78),
        isSlab,
        dynamic: true,
      });
      body.vx = dx * speed + rng.signed() * 0.8;
      body.vz = dz * speed + rng.signed() * 0.8;
      body.vy = rng.range(-0.5, 1.0);
      body.wx = rng.signed() * 1.4;
      body.wy = rng.signed() * 1.4;
      body.wz = rng.signed() * 1.4;
      this.rocks.push(body);
      spawned++;
    }
    this._rebuildInstanceBuckets();
    return spawned;
  }

  /**
   * Adds a free rigid boulder at an explicit pose. `y` is the centre-of-mass height.
   * Optional vx/vy/vz give the initial linear velocity (m/s).
   */
  addBoulder(spec) {
    const body = this._makeBody({
      submesh: 0, isOutcrop: false, sx: 1, sy: 1, sz: 1, yaw: 0, pitch: 0, roll: 0,
      seedHash: 0.5, wear: 0.3, dynamic: true, ...spec,
    });
    body.vx = spec.vx || 0;
    body.vy = spec.vy || 0;
    body.vz = spec.vz || 0;
    this.rocks.push(body);
    return body;
  }

  _makeBody(o) {
    const q = quatFromYawPitchRoll(o.yaw, o.pitch, o.roll);
    const b = this.atlas.halfExtents[o.submesh];
    // Physics box = real polyhedron half-extents scaled by the rock's size (slightly shrunk so
    // corners of the box never hang outside the visible facets).
    const hx = b[0] * o.sx * 0.92;
    const hy = b[1] * o.sy * 0.88;
    const hz = b[2] * o.sz * 0.92;
    const dynamic = o.dynamic !== false;
    const mass = dynamic ? Math.max(1e-3, 8 * hx * hy * hz * ROCK_DENSITY) : 0;
    const invMass = dynamic ? 1 / mass : 0;
    // Solid box inertia about its principal axes
    const ix = dynamic ? mass * (hy * hy + hz * hz) / 3 : 1;
    const iy = dynamic ? mass * (hx * hx + hz * hz) / 3 : 1;
    const iz = dynamic ? mass * (hx * hx + hy * hy) / 3 : 1;
    return {
      submesh: o.submesh,
      isOutcrop: o.isOutcrop,
      isSlab: !!o.isSlab,
      dynamic,
      sleeping: !dynamic,
      sleepTimer: 0,
      seedHash: o.seedHash,
      wear: o.wear,
      x: o.x,
      y: o.y,
      z: o.z,
      vx: 0, vy: 0, vz: 0,
      wx: 0, wy: 0, wz: 0,
      q,
      sx: o.sx, sy: o.sy, sz: o.sz,
      hx, hy, hz,
      invMass,
      invI: [1 / ix, 1 / iy, 1 / iz],
      radiusProxy: 0.82 * Math.max(hx, hy, hz),
      friction: o.isSlab ? 0.72 : 0.62,
      restitution: 0.12,
      embed: 0,
      seedSurfaceH: 0,
      touching: false,
      idx: 0,
    };
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

  _alignToSurface(r, nx, ny, nz) {
    // Only used by rooted outcrops: keep them upright relative to the local surface normal
    const m = quatToMat(r.q);
    const ux = m[1], uy = m[4], uz = m[7];
    const blend = 0.25;
    let tx = ux * (1 - blend) + nx * blend;
    let ty = uy * (1 - blend) + ny * blend;
    let tz = uz * (1 - blend) + nz * blend;
    const l = Math.hypot(tx, ty, tz) || 1;
    tx /= l; ty /= l; tz /= l;
    // Rotate the body's up axis toward (tx,ty,tz) with the shortest arc
    const cx = uy * tz - uz * ty;
    const cy = uz * tx - ux * tz;
    const cz = ux * ty - uy * tx;
    const d = clamp(ux * tx + uy * ty + uz * tz, -1, 1);
    const cl = Math.hypot(cx, cy, cz);
    if (cl < 1e-6) return;
    const ang = Math.atan2(cl, d) * 0.5;
    const s = Math.sin(ang) / cl;
    const dq = [cx * s, cy * s, cz * s, Math.cos(ang)];
    const q = r.q;
    const nxq = dq[3] * q[0] + dq[0] * q[3] + dq[1] * q[2] - dq[2] * q[1];
    const nyq = dq[3] * q[1] - dq[0] * q[2] + dq[1] * q[3] + dq[2] * q[0];
    const nzq = dq[3] * q[2] + dq[0] * q[1] - dq[1] * q[0] + dq[2] * q[3];
    const nwq = dq[3] * q[3] - dq[0] * q[0] - dq[1] * q[1] - dq[2] * q[2];
    const ql = Math.hypot(nxq, nyq, nzq, nwq) || 1;
    q[0] = nxq / ql; q[1] = nyq / ql; q[2] = nzq / ql; q[3] = nwq / ql;
  }

  _cornerWorld(r, m, i) {
    const s = CORNER_SIGNS[i];
    const lx = s[0] * r.hx, ly = s[1] * r.hy, lz = s[2] * r.hz;
    return [
      m[0] * lx + m[1] * ly + m[2] * lz,
      m[3] * lx + m[4] * ly + m[5] * lz,
      m[6] * lx + m[7] * ly + m[8] * lz,
    ];
  }

  _minClearance(r) {
    const m = quatToMat(r.q);
    const st = this._scratch;
    let minC = Infinity;
    for (let i = 0; i < 8; i++) {
      const c = this._cornerWorld(r, m, i);
      const px = r.x + c[0], py = r.y + c[1], pz = r.z + c[2];
      this._sampleInto(px, pz, st);
      minC = Math.min(minC, py - st.totalH);
    }
    return minC;
  }

  /** Returns true while the boulder is buried. Hysteresis keeps it buried until the ground falls clearly. */
  _updateBurial(r) {
    const s = this.sampleTerrain(r.x, r.z);
    const frac = (s.totalH - (r.y - r.hy)) / Math.max(1e-3, 2 * r.hy);
    if (!r.buried) {
      if (frac > BURY_FRAC) {
        r.buried = true;
        r.sleeping = true;
        r.sleepTimer = 0;
        r.vx = r.vy = r.vz = 0;
        r.wx = r.wy = r.wz = 0;
      }
    } else if (frac < UNBURY_FRAC) {
      r.buried = false;
      r.sleeping = false;
      r.sleepTimer = 0;
    }
    return r.buried;
  }

  /** Grid index of the texel the physics sampler reads for world (wx, wz). */
  _scourIndex(wx, wz) {
    const N = this.gridRes;
    const span = this.worldSpan;
    const u = clamp(wx / span + 0.5, 0.0, 1.0) * N - 0.5 - (this.sampleShiftTexels || 0);
    const v = clamp(wz / span + 0.5, 0.0, 1.0) * N - 0.5 - (this.sampleShiftTexels || 0);
    const ix = clamp(Math.round(u), 0, N - 1);
    const iz = clamp(Math.round(v), 0, N - 1);
    return iz * N + ix;
  }

  _addScour(wx, wz, dz) {
    if (!this.scourGrid || dz <= 0) return;
    this.scourGrid[this._scourIndex(wx, wz)] += dz;
  }

  /** Returns the accumulated scour grid (metres per texel) and resets it, or null if nothing to apply. */
  takeScourGrid() {
    if (!this.scourGrid) return null;
    let any = false;
    for (let i = 0; i < this.scourGrid.length; i++) {
      if (this.scourGrid[i] > 0) { any = true; break; }
    }
    if (!any) return null;
    const out = this.scourGrid;
    this.scourGrid = new Float32Array(out.length);
    return { data: out, res: this.gridRes };
  }

  _wake(r) {
    if (r.buried) return;
    r.sleeping = false;
    r.sleepTimer = 0;
  }

  _makeDynamic(r, vy) {
    r.isOutcrop = false;
    r.dynamic = true;
    r.sleeping = false;
    r.sleepTimer = 0;
    r.vx = 0; r.vy = vy; r.vz = 0;
    r.wx = 0; r.wy = 0; r.wz = 0;
    const mass = Math.max(1e-3, 8 * r.hx * r.hy * r.hz * ROCK_DENSITY);
    r.invMass = 1 / mass;
    r.invI = [
      3 / (mass * (r.hy * r.hy + r.hz * r.hz)),
      3 / (mass * (r.hx * r.hx + r.hz * r.hz)),
      3 / (mass * (r.hx * r.hx + r.hy * r.hy)),
    ];
    r.radiusProxy = 0.82 * Math.max(r.hx, r.hy, r.hz);
  }

  /**
   * Advances the rigid-body simulation by `dt` seconds using fixed substeps.
   */
  stepPhysics(dt = 0.033, _duringPrewarm = false) {
    if (!this.hasHeightSnapshot || this.rocks.length === 0) return;
    const count = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / SUBSTEP)));
    const h = dt / count;
    for (let s = 0; s < count; s++) {
      this._substep(h);
    }
    this.simTime += dt;
    this._rebuildInstanceBuckets();
  }

  /**
   * Runs the solver (fixed substeps, no rendering) until every dynamic boulder is asleep or
   * `maxSeconds` of simulated time have elapsed.
   */
  settleField(maxSeconds = 10.0) {
    if (!this.hasHeightSnapshot) return 0;
    const h = SUBSTEP;
    let t = 0;
    while (t < maxSeconds) {
      let awake = 0;
      for (let i = 0; i < this.rocks.length; i++) {
        const r = this.rocks[i];
        if (r.dynamic && !r.sleeping) awake++;
      }
      if (awake === 0) break;
      this._substep(h);
      t += h;
    }
    this.simTime += t;
    this._rebuildInstanceBuckets();
    return t;
  }

  _substep(h) {
    const rocks = this.rocks;
    const n = rocks.length;
    if (n === 0) return;
    const st = this._scratch;

    // 1. Forces: gravity (reduced when submerged), air drag, rolling resistance
    const awakeList = [];
    for (let i = 0; i < n; i++) {
      const r = rocks[i];
      r.idx = i;
      if (!r.dynamic || r.sleeping) continue;
      awakeList.push(r);
      this._sampleInto(r.x, r.z, st);
      const buoy = st.water > 0.25 ? 0.6 : 1.0;
      r.vy -= GRAVITY * buoy * h;
      const drag = Math.exp(-0.035 * h);
      r.vx *= drag; r.vy *= drag; r.vz *= drag;
      if (r.touching) {
        const roll = Math.exp(-1.6 * h);
        r.wx *= roll; r.wy *= roll; r.wz *= roll;
      }
      const wd = Math.exp(-0.02 * h);
      r.wx *= wd; r.wy *= wd; r.wz *= wd;
    }

    // 2. Build contact list against the terrain (corners below the ground surface)
    const contacts = [];
    for (let k = 0; k < awakeList.length; k++) {
      const r = awakeList[k];
      const m = quatToMat(r.q);
      r.touching = false;
      r.nCont = 0;
      for (let i = 0; i < 8; i++) {
        const c = this._cornerWorld(r, m, i);
        const px = r.x + c[0], py = r.y + c[1], pz = r.z + c[2];
        this._sampleInto(px, pz, st);
        const pen = st.totalH - py;
        const margin = 0.03 + 2.0 * h * Math.hypot(r.vx, r.vy, r.vz);
        if (pen > -margin) {
          const mu = st.water > 0.08 ? Math.min(r.friction, 0.38) : r.friction;
          r.nCont++;
          contacts.push({
            body: r, other: null,
            rx: c[0], ry: c[1], rz: c[2],
            nx: st.nx, ny: st.ny, nz: st.nz,
            pen: Math.max(0, pen),
            mu,
            vn0: 0,
            e: 0.12,
            jn: 0, jt1: 0, jt2: 0,
            t1x: 0, t1y: 0, t1z: 0, t2x: 0, t2y: 0, t2z: 0,
            kN: 0, kT1: 0, kT2: 0,
            invI: null,
          });
          r.touching = true;
        }
      }
    }

    // 3. Rock-rock contacts via spatially hashed sphere proxies
    const cell = 6.0;
    const buckets = new Map();
    for (let i = 0; i < n; i++) {
      const r = rocks[i];
      const key = (Math.floor(r.x / cell) + 4096) * 8192 + (Math.floor(r.z / cell) + 4096);
      let arr = buckets.get(key);
      if (!arr) { arr = []; buckets.set(key, arr); }
      arr.push(i);
    }
    for (let k = 0; k < awakeList.length; k++) {
      const a = awakeList[k];
      const ia = a.idx;
      const cx = Math.floor(a.x / cell), cz = Math.floor(a.z / cell);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const arr = buckets.get((cx + ox + 4096) * 8192 + (cz + oz + 4096));
          if (!arr) continue;
          for (const j of arr) {
            const b = rocks[j];
            if (b === a) continue;
            // Count each awake-awake pair once (from the lower index)
            if (b.dynamic && !b.sleeping && j < ia) continue;
            const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
            const d = Math.hypot(dx, dy, dz);
            const rs = a.radiusProxy + b.radiusProxy;
            if (d >= rs || d < 1e-5) continue;
            const nx = dx / d, ny = dy / d, nz = dz / d;
            if (!b.dynamic && !a.dynamic) continue;
            if (a.sleeping && b.sleeping) continue;
            if (a.buried || b.buried) continue;
            const pen = rs - d;
            // Contact normal points from b into a. a's contact arm points toward b, b's toward a.
            contacts.push({
              body: a, other: b,
              rx: nx * a.radiusProxy, ry: ny * a.radiusProxy, rz: nz * a.radiusProxy,
              orx: -nx * b.radiusProxy, ory: -ny * b.radiusProxy, orz: -nz * b.radiusProxy,
              nx: -nx, ny: -ny, nz: -nz,
              pen,
              mu: 0.5 * (a.friction + b.friction),
              vn0: 0, e: 0.08, jn: 0, jt1: 0, jt2: 0,
              kN: 0, kT1: 0, kT2: 0,
              pair: true,
            });
            // Only a real impact (closing speed) wakes a sleeper; resting stacks stay asleep
            const closing = (a.vx - b.vx) * -nx + (a.vy - b.vy) * -ny + (a.vz - b.vz) * -nz;
            if (closing > 0.25 || (!a.sleeping && !b.sleeping)) {
              if (a.sleeping) this._wake(a);
              if (b.dynamic && b.sleeping) this._wake(b);
            }
            a.touching = true;
            if (b.dynamic) b.touching = true;
          }
        }
      }
    }

    // 4. Precompute effective masses and pre-impulse normal velocities
    for (let c = 0; c < contacts.length; c++) {
      const ct = contacts[c];
      const a = ct.body;
      const ma = a.invMass;
      const Ia = this._worldInvInertia(a);
      const ra = [ct.rx, ct.ry, ct.rz];
      const b = ct.other;
      const rb = b ? [ct.orx, ct.ory, ct.orz] : null;
      const Ib = b ? this._worldInvInertia(b) : null;
      const mb = b ? b.invMass : 0;

      const n = [ct.nx, ct.ny, ct.nz];
      const kN = this._effectiveMass(ma, Ia, ra, n, mb, Ib, rb);
      ct.kN = kN > 1e-9 ? 1 / kN : 0;

      // Tangent basis
      let t1 = [1, 0, 0];
      if (Math.abs(n[0]) > 0.8) t1 = [0, 1, 0];
      const d1 = t1[0] * n[0] + t1[1] * n[1] + t1[2] * n[2];
      t1 = normalize3([t1[0] - d1 * n[0], t1[1] - d1 * n[1], t1[2] - d1 * n[2]]);
      const t2 = cross3(n, t1);
      ct.t1x = t1[0]; ct.t1y = t1[1]; ct.t1z = t1[2];
      ct.t2x = t2[0]; ct.t2y = t2[1]; ct.t2z = t2[2];
      const k1 = this._effectiveMass(ma, Ia, ra, t1, mb, Ib, rb);
      const k2 = this._effectiveMass(ma, Ia, ra, t2, mb, Ib, rb);
      ct.kT1 = k1 > 1e-9 ? 1 / k1 : 0;
      ct.kT2 = k2 > 1e-9 ? 1 / k2 : 0;

      const rv = this._relVel(a, ra, b, rb);
      ct.vn0 = rv[0] * n[0] + rv[1] * n[1] + rv[2] * n[2];
    }

    // 5. Sequential impulse solver
    for (let it = 0; it < SOLVER_ITERATIONS; it++) {
      for (let c = 0; c < contacts.length; c++) {
        const ct = contacts[c];
        const a = ct.body;
        const b = ct.other;
        const n = [ct.nx, ct.ny, ct.nz];
        const ra = [ct.rx, ct.ry, ct.rz];
        const rb = b ? [ct.orx, ct.ory, ct.orz] : null;

        // Normal
        let rv = this._relVel(a, ra, b, rb);
        const vn = rv[0] * n[0] + rv[1] * n[1] + rv[2] * n[2];
        // Restitution only for real impacts; Baumgarte push-out for penetration
        let target = 0;
        if (it === 0 && ct.vn0 < -1.2) target = -ct.e * ct.vn0;
        // Capped push-out velocity: deep overlaps (e.g. spawn overlap) must not launch bodies
        const bias = Math.min(MAX_PUSH_VELOCITY, (BAUMGARTE / h) * Math.max(0, ct.pen - PEN_SLOP));
        let dJn = (target + bias - vn) * ct.kN;
        const newJn = Math.max(0, ct.jn + dJn);
        dJn = newJn - ct.jn;
        ct.jn = newJn;
        if (dJn !== 0) this._applyImpulse(a, ra, b, rb, n[0] * dJn, n[1] * dJn, n[2] * dJn);

        // Friction (Coulomb cone)
        rv = this._relVel(a, ra, b, rb);
        const t1 = [ct.t1x, ct.t1y, ct.t1z];
        const t2 = [ct.t2x, ct.t2y, ct.t2z];
        const vt1 = rv[0] * t1[0] + rv[1] * t1[1] + rv[2] * t1[2];
        const vt2 = rv[0] * t2[0] + rv[1] * t2[1] + rv[2] * t2[2];
        const maxF = ct.mu * ct.jn;
        let dt1 = -vt1 * ct.kT1;
        let dt2 = -vt2 * ct.kT2;
        const nt1 = clamp(ct.jt1 + dt1, -maxF, maxF);
        dt1 = nt1 - ct.jt1; ct.jt1 = nt1;
        const nt2 = clamp(ct.jt2 + dt2, -maxF, maxF);
        dt2 = nt2 - ct.jt2; ct.jt2 = nt2;
        if (dt1 !== 0 || dt2 !== 0) {
          this._applyImpulse(a, ra, b, rb,
            t1[0] * dt1 + t2[0] * dt2, t1[1] * dt1 + t2[1] * dt2, t1[2] * dt1 + t2[2] * dt2);
        }
      }
    }

    // 6. Integrate positions & orientations
    for (let k = 0; k < awakeList.length; k++) {
      const r = awakeList[k];
      r.x += r.vx * h;
      r.y += r.vy * h;
      r.z += r.vz * h;
      quatIntegrate(r.q, r.wx, r.wy, r.wz, h);
    }

    // 7. Abrasion: boulders sliding on the bed scour it (rate ~ distance travelled x contact fraction)
    if (this.scourGrid) {
      for (let k = 0; k < awakeList.length; k++) {
        const r = awakeList[k];
        if (!r.nCont) continue;
        const vxz = Math.hypot(r.vx, r.vz);
        if (vxz < 0.05) continue;
        const dz = ABRASION_PER_METRE * vxz * h * Math.min(1, r.nCont / 4);
        this._addScour(r.x, r.z, dz);
      }
    }

    // 8. Sleep detection and bounds
    for (let k = 0; k < awakeList.length; k++) {
      const r = awakeList[k];
      const lin = Math.hypot(r.vx, r.vy, r.vz);
      const ang = Math.hypot(r.wx, r.wy, r.wz);
      if (r.touching && lin < SLEEP_LINEAR && ang < SLEEP_ANGULAR) {
        r.sleepTimer += h;
        if (r.sleepTimer > SLEEP_TIME) {
          r.sleeping = true;
          r.vx = r.vy = r.vz = 0;
          r.wx = r.wy = r.wz = 0;
        }
      } else {
        r.sleepTimer = 0;
      }
      if (Math.abs(r.x) > this.worldSpan * 0.5 || Math.abs(r.z) > this.worldSpan * 0.5) {
        // Slid off the mesh edge: stop it so it never leaves the domain
        r.x = clamp(r.x, -this.worldSpan * 0.49, this.worldSpan * 0.49);
        r.z = clamp(r.z, -this.worldSpan * 0.49, this.worldSpan * 0.49);
        r.vx *= -0.2; r.vz *= -0.2;
      }
    }
  }

  _worldInvInertia(body) {
    return { m: quatToMat(body.q), invI: body.invI };
  }

  _effectiveMass(ma, Ia, ra, d, mb, Ib, rb) {
    // k = 1/ma + (ra x d) . Ia (ra x d) [+ same for b]
    let k = ma;
    if (ma > 0) {
      const w = cross3(ra, d);
      const u = applyInvInertia(Ia.m, Ia.invI, w[0], w[1], w[2]);
      k += d[0] * (u[1] * ra[2] - u[2] * ra[1]) + d[1] * (u[2] * ra[0] - u[0] * ra[2]) + d[2] * (u[0] * ra[1] - u[1] * ra[0]);
    }
    if (rb && mb > 0) {
      k += mb;
      const w = cross3(rb, d);
      const u = applyInvInertia(Ib.m, Ib.invI, w[0], w[1], w[2]);
      k += d[0] * (u[1] * rb[2] - u[2] * rb[1]) + d[1] * (u[2] * rb[0] - u[0] * rb[2]) + d[2] * (u[0] * rb[1] - u[1] * rb[0]);
    }
    return k;
  }

  _relVel(a, ra, b, rb) {
    // v_a + w_a x r_a (- v_b - w_b x r_b)
    const ax = a.vx + (a.wy * ra[2] - a.wz * ra[1]);
    const ay = a.vy + (a.wz * ra[0] - a.wx * ra[2]);
    const az = a.vz + (a.wx * ra[1] - a.wy * ra[0]);
    if (!b) return [ax, ay, az];
    const bx = b.vx + (b.wy * rb[2] - b.wz * rb[1]);
    const by = b.vy + (b.wz * rb[0] - b.wx * rb[2]);
    const bz = b.vz + (b.wx * rb[1] - b.wy * rb[0]);
    return [ax - bx, ay - by, az - bz];
  }

  _applyImpulse(a, ra, b, rb, jx, jy, jz) {
    if (a.dynamic && !a.sleeping) {
      a.vx += jx * a.invMass; a.vy += jy * a.invMass; a.vz += jz * a.invMass;
      const m = quatToMat(a.q);
      const w = cross3(ra, [jx, jy, jz]);
      const u = applyInvInertia(m, a.invI, w[0], w[1], w[2]);
      a.wx += u[0]; a.wy += u[1]; a.wz += u[2];
    }
    if (b && b.dynamic && !b.sleeping) {
      b.vx -= jx * b.invMass; b.vy -= jy * b.invMass; b.vz -= jz * b.invMass;
      const m = quatToMat(b.q);
      const w = cross3(rb, [jx, jy, jz]);
      const u = applyInvInertia(m, b.invI, w[0], w[1], w[2]);
      b.wx -= u[0]; b.wy -= u[1]; b.wz -= u[2];
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

      // Columns of the rigid-body rotation matrix scaled by the visual half-scales. det = +1.
      const m = quatToMat(r.q);
      const arr = this.bucketData[bIdx];
      const o = slot * FLOATS_PER_INSTANCE;
      arr[o + 0] = m[0] * r.sx;
      arr[o + 1] = m[3] * r.sx;
      arr[o + 2] = m[6] * r.sx;
      arr[o + 3] = r.seedHash;
      arr[o + 4] = m[1] * r.sy;
      arr[o + 5] = m[4] * r.sy;
      arr[o + 6] = m[7] * r.sy;
      arr[o + 7] = r.wear;
      arr[o + 8] = m[2] * r.sz;
      arr[o + 9] = m[5] * r.sz;
      arr[o + 10] = m[8] * r.sz;
      arr[o + 11] = r.sy;
      // aInstPosMeta: absolute world centre of mass (rendered exactly where physics places it)
      arr[o + 12] = r.x;
      arr[o + 13] = r.y;
      arr[o + 14] = r.z;
      arr[o + 15] = r.isOutcrop ? 1.0 : 0.0;
    }
  }
}

function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
