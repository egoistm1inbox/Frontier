// True-3D cliffs: local SDF chunks over the steep parts of the refined heightfield, seamless with the
// surrounding heightfield mesh by construction (see Frontier/Experimental/SdfCliffLab for the
// isolated proof). Pure JS — chunk meshing runs in sdf.worker.js.
//
//   field  f(p) = mix( y − h(x,z),  (y − h) / |∇|  + carve(p),  W(x,z) )
//   W      cliff weight: 1 on cells steeper than `sdfAngle`, fading to 0 over `sdfBlend` cells, 0 on
//          every face shared with a non-chunked cell and on the map border
//   carve  ≥ 0 removes rock along the normal: soft strata beds (same strata model as the heightfield,
//          evaluated at the 3-D point's elevation) are undercut by pocket noise, plus joints,
//          weathering pits and fine roughness — so hard beds are left as lips and overhangs
//   mesh   marching tetrahedra on a voxel grid aligned with the heightfield cells; where W == 0 the
//          field is linear along every edge, so iso-crossings sit exactly on the heightfield's own
//          piecewise-linear border → watertight with the terrain mesh, which skips the covered quads

import { SimplexNoise, GradientNoise3, hash2, smoothstep, lerp, clamp01 } from './noise.js';
import { makeBedTable, bedAt, bedJitter, bedHardness } from './strata-model.js';
import { NO_WATER } from './features.js';
import { edgeTable, triTable } from './mc-tables.js';

const DX8 = [1, -1, 0, 0, 1, 1, -1, -1], DZ8 = [0, 0, 1, -1, 1, -1, 1, -1];

// Chunks are C×C heightfield cells; the last row / column may be narrower (grid cells are rarely a
// multiple of the chunk size). Chunk (ci, cj) covers cells [ci·C, min(ci·C + C, N−1)).
export function chunkCellsFor(N, want) {
  return Math.max(4, Math.min(64, Math.round(want || 16)));
}

// ---- selection on the refined field --------------------------------------------------------------
export function selectChunks(fine, v) {
  const { resolution: N, worldSize: size, height } = fine;
  const cell = size / (N - 1);
  const tanA = Math.tan(((v.sdfAngle || 58) * Math.PI) / 180);
  const r = Math.max(1, Math.min(6, Math.round(v.sdfBlend || 2)));
  const total = N * N;
  // chamfer distance (in cells) from cliff nodes, up to r
  const dist = new Uint8Array(total).fill(255);
  for (let j = 1; j < N - 1; j++) {
    for (let i = 1; i < N - 1; i++) {
      const idx = j * N + i;
      const gx = (height[idx + 1] - height[idx - 1]) / (2 * cell), gz = (height[idx + N] - height[idx - N]) / (2 * cell);
      if (gx * gx + gz * gz > tanA * tanA) dist[idx] = 0;
    }
  }
  for (let pass = 1; pass <= r; pass++) {
    for (let j = 1; j < N - 1; j++) {
      for (let i = 1; i < N - 1; i++) {
        const idx = j * N + i;
        if (dist[idx] !== 255) continue;
        for (let d = 0; d < 8; d++) {
          if (dist[idx + DX8[d] + DZ8[d] * N] === pass - 1) { dist[idx] = pass; break; }
        }
      }
    }
  }
  const W = new Float32Array(total);
  for (let idx = 0; idx < total; idx++) {
    const d = dist[idx];
    if (d === 255) continue;
    const i = idx % N, j = (idx - i) / N;
    if (i === 0 || j === 0 || i === N - 1 || j === N - 1) continue;
    W[idx] = smoothstep(0, 1, 1 - d / (r + 1));
  }

  const C = chunkCellsFor(N, v.sdfChunk || 16);
  const nc = Math.ceil((N - 1) / C);
  const candidates = [];
  for (let cj = 0; cj < nc; cj++) {
    for (let ci = 0; ci < nc; ci++) {
      const i0 = ci * C, j0 = cj * C, i1 = Math.min(N - 1, i0 + C), j1 = Math.min(N - 1, j0 + C);
      let sum = 0, hmin = Infinity, hmax = -Infinity, g2max = 0;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const idx = j * N + i;
          sum += W[idx];
          const h = height[idx]; if (h < hmin) hmin = h; if (h > hmax) hmax = h;
          if (i > 0 && j > 0 && i < N - 1 && j < N - 1) {
            const gx = (height[idx + 1] - height[idx - 1]) / (2 * cell), gz = (height[idx + N] - height[idx - N]) / (2 * cell);
            const g2 = gx * gx + gz * gz; if (g2 > g2max) g2max = g2;
          }
        }
      }
      if (sum > 0) candidates.push({ ci, cj, i0, j0, cw: i1 - i0, ch: j1 - j0, hmin, hmax, sum, slopeF: Math.sqrt(1 + g2max) });
    }
  }
  candidates.sort((a, b) => b.sum - a.sum);
  const maxChunks = Math.max(1, Math.round(v.sdfMaxChunks || 600));
  const list = candidates.slice(0, maxChunks);
  const active = new Uint8Array(nc * nc);
  for (const c of list) active[c.cj * nc + c.ci] = 1;
  // W must be 0 on faces shared with inactive chunks: zero every node that touches a non-active chunk
  if (list.length < candidates.length) {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const idx = j * N + i;
        if (W[idx] === 0) continue;
        const ci0 = Math.max(0, Math.floor((i - 1) / C)), ci1 = Math.min(nc - 1, Math.floor(i / C));
        const cj0 = Math.max(0, Math.floor((j - 1) / C)), cj1 = Math.min(nc - 1, Math.floor(j / C));
        let inactive = false;
        for (let cj = cj0; cj <= cj1 && !inactive; cj++) for (let ci = ci0; ci <= ci1; ci++) if (!active[cj * nc + ci]) { inactive = true; break; }
        if (inactive) W[idx] = 0;
      }
    }
  }
  // fade for the heightfield mesh displacement: 0 on/inside active footprints, 1 three cells away
  const fade = new Float32Array(total).fill(1);
  for (const c of list) {
    for (let j = c.j0; j <= c.j0 + c.ch; j++) for (let i = c.i0; i <= c.i0 + c.cw; i++) fade[j * N + i] = 0;
  }
  for (let pass = 1; pass <= 3; pass++) {
    const level = pass / 4;
    for (let j = 1; j < N - 1; j++) {
      for (let i = 1; i < N - 1; i++) {
        const idx = j * N + i;
        if (fade[idx] < 1) continue;
        for (let d = 0; d < 8; d++) {
          const f = fade[idx + DX8[d] + DZ8[d] * N];
          if (f < level - 1e-6) { fade[idx] = level; break; }
        }
      }
    }
  }
  fine.sdfWeight = W;
  fine.sdfFade = fade;
  return { active, nc, C, list, W, fade, candidates: candidates.length };
}

// ---- jobs for the worker (slices of every map, transferable) ---------------------------------------
export function packChunkJobs(fine, chunks, v) {
  const { resolution: N } = fine;
  const { C, list } = chunks;
  const names = ['height', 'hardness', 'deposit', 'flow', 'cavity', 'road', 'river', 'lake', 'waterLevel', 'sdfWeight', 'outcrop'];
  const jobs = [], transfer = [];
  const cell = fine.worldSize / (N - 1);
  const maxCarve = carveReach(v);
  for (const c of list) {
    const Sx = c.cw + 1, Sz = c.ch + 1;
    const maps = {};
    for (const name of names) {
      const src = fine[name];
      const out = new Float32Array(Sx * Sz);
      if (src) for (let j = 0; j < Sz; j++) out.set(src.subarray((c.j0 + j) * N + c.i0, (c.j0 + j) * N + c.i0 + Sx), j * Sx);
      else if (name === 'waterLevel') out.fill(NO_WATER);
      maps[name] = out; transfer.push(out.buffer);
    }
    jobs.push({ ci: c.ci, cj: c.cj, i0: c.i0, j0: c.j0, cw: c.cw, ch: c.ch, hmin: c.hmin, hmax: c.hmax, slopeF: c.slopeF, maps });
  }
  // voxel resolution: explicit, or the finest that fits the voxel budget (only the band around the
  // surface is polygonised, so the estimate is footprint × band thickness)
  let k = Math.max(1, Math.min(3, Math.round(v.sdfVoxel || 0)));
  if (!(v.sdfVoxel >= 1)) {
    let est = 0;
    for (const c of list) est += c.cw * c.ch * ((maxCarve * Math.min(3, c.slopeF) * 2) / cell + 6);
    const budget = Math.max(1e6, (v.sdfVoxelBudget || 24) * 1e6);
    k = est * 27 <= budget ? 3 : est * 8 <= budget ? 2 : 1;
  }
  return { jobs, transfer, meta: { N, size: fine.worldSize, C, k, cell: cell / k } };
}

// largest distance the carve can move the surface along the normal
export function carveReach(v) {
  const undercut = Math.max(0, v.sdfUndercut == null ? 6 : v.sdfUndercut);
  const pits = v.sdfPits == null ? 0.3 : v.sdfPits, joints = v.sdfJoints == null ? 0.5 : v.sdfJoints;
  return undercut * (1 + 0.5 * pits + 0.9 * joints) + 1.5;
}

// ---- strata hardness at a 3-D point (same model as heightfield.applyStrata) -----------------------
// column(x, z) caches everything that depends on the plan position; at(col, y) is cheap per voxel.
export function makeStrataSampler(params) {
  const size = params.worldSize;
  const dipRad = (params.strataDip * Math.PI) / 180, dirRad = (params.strataDipDirection * Math.PI) / 180;
  const gx = Math.tan(dipRad) * Math.cos(dirRad), gz = Math.tan(dipRad) * Math.sin(dirRad);
  const detail = new SimplexNoise(params.seed * 5 + 77);
  const contrast = params.hardnessContrast;
  const table = makeBedTable(params);
  const lateral = params.strataLateral == null ? 0.18 : params.strataLateral;
  function column(xw, zw) {
    const x = xw + size / 2, z = zw + size / 2;
    return { x, z, tilt: gx * x + gz * z, jitter: bedJitter(x, z, lateral), layers: new Map(), bed: {} };
  }
  // returns [hardness, fraction within bed (0 base → 1 top), bed thickness, bed index]
  function at(col, y) {
    const bed = bedAt(table, (y + col.tilt) / col.jitter, col.bed);
    const bi = bed.index;
    let lens = col.layers.get(bi);
    if (lens === undefined) {
      lens = 0.12 * detail.fbm(col.x * 0.006 + bi * 3.7, col.z * 0.006, 3);
      col.layers.set(bi, lens);
    }
    const hard = lerp(0.35, clamp01(bedHardness(bed) + lens), contrast);
    return [hard, bed.f, bed.thick, bi];
  }
  return { column, at, table, sample: (xw, zw, y) => at(column(xw, zw), y) };
}

// ---- marching cubes ------------------------------------------------------------------------------
const CORNER = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

export function makeChunkContext(v) {
  return {
    seed: (v.seed | 0) >>> 0,
    strata: makeStrataSampler(v),
    pocket: new GradientNoise3((v.seed || 1) * 41 + 9),
    joint: new SimplexNoise((v.seed || 1) * 23 + 5),
    rough: new GradientNoise3((v.seed || 1) * 31 + 11),
  };
}

export function buildChunkGeometry(job, meta, v, ctx) {
  const { N, size } = meta;
  const Sx = job.cw + 1, Sz = job.ch + 1;
  const cell = size / (N - 1);
  const k = v.sdfVoxel >= 1 ? Math.max(1, Math.min(3, Math.round(v.sdfVoxel))) : (meta.k || 1);
  const vox = cell / k;
  const nx = job.cw * k, nz = job.ch * k;
  const x0 = (job.i0 / (N - 1) - 0.5) * size, z0 = (job.j0 / (N - 1) - 0.5) * size;
  const m = job.maps;

  // local bilinear sampler on the slice (u, w in cells)
  const bil = (arr, u, w) => {
    const i = Math.min(Sx - 2, Math.max(0, Math.floor(u))), j = Math.min(Sz - 2, Math.max(0, Math.floor(w)));
    const fu = Math.min(1, Math.max(0, u - i)), fw = Math.min(1, Math.max(0, w - j));
    const a = arr[j * Sx + i], b = arr[j * Sx + i + 1], c = arr[(j + 1) * Sx + i], d = arr[(j + 1) * Sx + i + 1];
    return (a + (b - a) * fu) * (1 - fw) + (c + (d - c) * fu) * fw;
  };
  const grad = (u, w) => {
    const i = Math.min(Sx - 2, Math.max(0, Math.floor(u))), j = Math.min(Sz - 2, Math.max(0, Math.floor(w)));
    const fu = Math.min(1, Math.max(0, u - i)), fw = Math.min(1, Math.max(0, w - j));
    const h = m.height;
    const a = h[j * Sx + i], b = h[j * Sx + i + 1], c = h[(j + 1) * Sx + i], d = h[(j + 1) * Sx + i + 1];
    return [((b - a) * (1 - fw) + (d - c) * fw) / cell, ((c - a) * (1 - fu) + (d - b) * fu) / cell];
  };

  const undercut = Math.max(0, v.sdfUndercut == null ? 6 : v.sdfUndercut);
  const pocketScale = Math.max(1, v.sdfPockets || 12);
  const pits = v.sdfPits == null ? 0.3 : v.sdfPits;
  const joints = v.sdfJoints == null ? 0.5 : v.sdfJoints;
  // roughness wavelength is tied to the voxel size (≥ 5 voxels) so it cannot alias into stair-steps
  const roughAmp = (v.sdfRough == null ? 0.5 : v.sdfRough) * Math.min(1.2, vox * 0.3);
  const roughFreq = 1 / (vox * 5);
  const bedPower = v.sdfBedContrast == null ? 1 : v.sdfBedContrast;
  const band = Math.max(2, v.strataBand || 26);
  const hasOutcrop = !!m.outcrop;

  const maxCarve = carveReach(v);
  // everything that depends on the plan position only
  function column(x, z) {
    const u = (x - x0) / cell, wq = (z - z0) / cell;
    const h = bil(m.height, u, wq);
    const w = bil(m.sdfWeight, u, wq);
    const [gx, gz] = grad(u, wq);
    const slopeF = Math.sqrt(1 + gx * gx + gz * gz);
    const steep = smoothstep(0.7, 1.7, Math.hypot(gx, gz));
    const oc = hasOutcrop ? bil(m.outcrop, u, wq) : 0;
    return { x, z, h, w, slopeF, steep, oc, strata: w > 1e-6 && steep > 0 ? ctx.strata.column(x, z) : null };
  }
  function carve(col, y) {
    const { x, z } = col;
    const [hard, f, thick, bi] = ctx.strata.at(col.strata, y);
    // soft beds recede into a notch that is deepest just under the hard bed above (where seepage
    // and frost work hardest); thin partings only make a shallow groove, thick soft beds a deep
    // undercut; hard beds keep their lip
    const softness = Math.pow(1 - smoothstep(0.3, 0.6, hard), bedPower);
    const notch = 0.3 + 0.7 * Math.sin(Math.PI * Math.pow(Math.min(1, Math.max(0, f)), 1.6));
    const thickF = Math.pow(Math.min(1, thick / (band * 0.7)), 0.6);
    let soft = softness * notch * thickF;
    const n = 0.5 + 0.5 * ctx.pocket.fbm(x / pocketScale, y / (pocketScale * 0.6), z / pocketScale, 3, 2.1, 0.55);
    const pocket = smoothstep(0.32, 0.7, n);
    // hard beds break along joint sets spaced like their thickness → blocky columns; soft beds
    // weather smooth. Each bed has its own joint pattern, and now and then a whole block is gone.
    const hardness = smoothstep(0.45, 0.7, hard);
    const spacing = Math.max(2, Math.min(30, thick * 0.9));
    const jn = 0.5 + 0.5 * ctx.joint.fbm(x / spacing + bi * 3.1, z / spacing - bi * 1.7, 2);
    let joint = smoothstep(0.7, 0.82, jn) * joints * hardness;
    const bx = Math.floor(x / spacing + bi * 0.37), bz = Math.floor(z / spacing - bi * 0.61);
    const fallen = hash2(bx + bi * 131, bz, ctx.seed) < 0.05 * joints ? smoothstep(0.04, 0.16, f) * smoothstep(0.98, 0.9, f) * hardness : 0;
    const pit = smoothstep(0.66, 0.82, n) * pits;
    const rough = ctx.rough.fbm(x * roughFreq, y * roughFreq, z * roughFreq, 2, 2.1, 0.55) * roughAmp;
    // embedded boulders are massive rock: no bedding undercuts, spheroidal weathering only
    if (col.oc > 0) { soft *= 1 - col.oc; joint *= 1 - col.oc * 0.5; }
    const d = undercut * (soft * (0.3 + 0.7 * pocket) + joint * 0.6 + fallen * 0.9 + pit * 0.5 + col.oc * 0.12 * pocket) + rough;
    return d * col.steep * col.w;
  }
  function fCol(col, y) {
    const plain = y - col.h;
    if (col.w <= 1e-6 || col.steep <= 0) return plain;
    // outside the band where carving can flip the sign the field is just the plain distance
    if (plain < -maxCarve * col.slopeF - 2 * vox || plain > roughAmp + 2 * vox) return plain;
    const dist = plain / col.slopeF;
    return plain + (dist + carve(col, y) - plain) * col.w;
  }

  // vertical range: carving d along the normal moves the surface up to d·|∇| vertically
  const reach = maxCarve * Math.min(3, job.slopeF || 3);
  const yLo = Math.floor((job.hmin - reach - 2 * vox) / vox) * vox;
  const yHi = Math.ceil((job.hmax + roughAmp + 2 * vox) / vox) * vox;
  const ny = Math.max(1, Math.round((yHi - yLo) / vox));
  const sx = nx + 1, sy = ny + 1, sz = nz + 1;
  // only the band around the surface is sampled / polygonised; nodes outside it are the plain
  // distance, whose sign is known from the column height
  const vals = new Float32Array(sx * sy * sz);
  const bandLo = new Int32Array(sx * sz), bandHi = new Int32Array(sx * sz);
  for (let jz = 0; jz < sz; jz++) {
    const z = z0 + jz * vox;
    for (let jx = 0; jx < sx; jx++) {
      const col = column(x0 + jx * vox, z);
      const lo = Math.max(0, Math.floor((col.h - maxCarve * col.slopeF - 2 * vox - yLo) / vox) - 1);
      const hi = Math.min(ny, Math.ceil((col.h + roughAmp + 2 * vox - yLo) / vox) + 1);
      bandLo[jz * sx + jx] = lo; bandHi[jz * sx + jx] = hi;
      const base = jz * sy * sx + jx;
      for (let jy = 0; jy < lo; jy++) vals[base + jy * sx] = yLo + jy * vox - col.h;
      for (let jy = lo; jy <= hi; jy++) vals[base + jy * sx] = fCol(col, yLo + jy * vox);
      for (let jy = hi + 1; jy < sy; jy++) vals[base + jy * sx] = yLo + jy * vox - col.h;
    }
  }
  const idx = (ix, iy, iz) => (iz * sy + iy) * sx + ix;

  // welded output: one vertex per crossed grid edge (axis, ix, iy, iz)
  const positions = [], indices = [];
  const edgeIds = new Int32Array(3 * sx * sy * sz).fill(-1);
  const EDGE_AXIS = [0, 1, 0, 1, 0, 1, 0, 1, 2, 2, 2, 2];
  const EDGE_OFF = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
  const cv = new Float64Array(8), cp = new Float64Array(24);
  const vid = new Int32Array(12);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const c00 = iz * sx + ix, c10 = c00 + 1, c01 = c00 + sx, c11 = c01 + 1;
      const iyLo = Math.max(0, Math.min(bandLo[c00], bandLo[c10], bandLo[c01], bandLo[c11]));
      const iyHi = Math.min(ny - 1, Math.max(bandHi[c00], bandHi[c10], bandHi[c01], bandHi[c11]));
      for (let iy = iyLo; iy <= iyHi; iy++) {
        let cube = 0;
        for (let c = 0; c < 8; c++) {
          const val = vals[idx(ix + CORNER[c][0], iy + CORNER[c][1], iz + CORNER[c][2])];
          cv[c] = val; if (val < 0) cube |= 1 << c;
          cp[c * 3] = x0 + (ix + CORNER[c][0]) * vox; cp[c * 3 + 1] = yLo + (iy + CORNER[c][1]) * vox; cp[c * 3 + 2] = z0 + (iz + CORNER[c][2]) * vox;
        }
        const edges = edgeTable[cube];
        if (edges === 0) continue;
        for (let e = 0; e < 12; e++) {
          if (!(edges & (1 << e))) continue;
          const off = EDGE_OFF[e];
          const key = (EDGE_AXIS[e] * sz + iz + off[2]) * sy * sx + (iy + off[1]) * sx + ix + off[0];
          let id = edgeIds[key];
          if (id < 0) {
            const a = EDGES[e][0], b = EDGES[e][1];
            const t = cv[a] / (cv[a] - cv[b]);
            id = positions.length / 3;
            positions.push(cp[a * 3] + (cp[b * 3] - cp[a * 3]) * t, cp[a * 3 + 1] + (cp[b * 3 + 1] - cp[a * 3 + 1]) * t, cp[a * 3 + 2] + (cp[b * 3 + 2] - cp[a * 3 + 2]) * t);
            edgeIds[key] = id;
          }
          vid[e] = id;
        }
        // field gradient over the cube → outward direction for the winding check
        const gx = (cv[1] + cv[2] + cv[5] + cv[6]) - (cv[0] + cv[3] + cv[4] + cv[7]);
        const gy = (cv[2] + cv[3] + cv[6] + cv[7]) - (cv[0] + cv[1] + cv[4] + cv[5]);
        const gz = (cv[4] + cv[5] + cv[6] + cv[7]) - (cv[0] + cv[1] + cv[2] + cv[3]);
        const base = cube * 16;
        for (let t = 0; triTable[base + t] !== -1; t += 3) {
          let ia = vid[triTable[base + t]], ib = vid[triTable[base + t + 1]], ic = vid[triTable[base + t + 2]];
          if (ia === ib || ib === ic || ia === ic) continue;
          const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
          const ux = positions[ib * 3] - ax, uy = positions[ib * 3 + 1] - ay, uz = positions[ib * 3 + 2] - az;
          const wx = positions[ic * 3] - ax, wy = positions[ic * 3 + 1] - ay, wz = positions[ic * 3 + 2] - az;
          const nx_ = uy * wz - uz * wy, ny_ = uz * wx - ux * wz, nz_ = ux * wy - uy * wx;
          if (nx_ * gx + ny_ * gy + nz_ * gz < 0) { const tmp = ib; ib = ic; ic = tmp; }
          indices.push(ia, ib, ic);
        }
      }
    }
  }

  const count = positions.length / 3;
  const pos = new Float32Array(positions);
  const normals = new Float32Array(count * 3);
  const aux = new Float32Array(count * 4), aux2 = new Float32Array(count * 4);
  const g = new Float64Array(3);
  const gAt = (ix, iy, iz) => {
    const xa = Math.max(0, ix - 1), xb = Math.min(nx, ix + 1), ya = Math.max(0, iy - 1), yb = Math.min(ny, iy + 1), za = Math.max(0, iz - 1), zb = Math.min(nz, iz + 1);
    g[0] = (vals[idx(xb, iy, iz)] - vals[idx(xa, iy, iz)]) / (xb - xa);
    g[1] = (vals[idx(ix, yb, iz)] - vals[idx(ix, ya, iz)]) / (yb - ya);
    g[2] = (vals[idx(ix, iy, zb)] - vals[idx(ix, iy, za)]) / (zb - za);
  };
  for (let n = 0; n < count; n++) {
    const x = pos[n * 3], y = pos[n * 3 + 1], z = pos[n * 3 + 2];
    const u = Math.min(nx - 1e-6, Math.max(0, (x - x0) / vox)), vv = Math.min(ny - 1e-6, Math.max(0, (y - yLo) / vox)), w = Math.min(nz - 1e-6, Math.max(0, (z - z0) / vox));
    const ix = Math.floor(u), iy = Math.floor(vv), iz = Math.floor(w), fx = u - ix, fy = vv - iy, fz = w - iz;
    let sx_ = 0, sy_ = 0, sz_ = 0;
    for (let c = 0; c < 8; c++) {
      const wgt = (CORNER[c][0] ? fx : 1 - fx) * (CORNER[c][1] ? fy : 1 - fy) * (CORNER[c][2] ? fz : 1 - fz);
      if (wgt === 0) continue;
      gAt(ix + CORNER[c][0], iy + CORNER[c][1], iz + CORNER[c][2]);
      sx_ += g[0] * wgt; sy_ += g[1] * wgt; sz_ += g[2] * wgt;
    }
    const l = Math.hypot(sx_, sy_, sz_) || 1;
    normals[n * 3] = sx_ / l; normals[n * 3 + 1] = sy_ / l; normals[n * 3 + 2] = sz_ / l;
    // surface channels sampled by XZ (the shader is world-space, no UVs)
    const cu = (x - x0) / cell, cw = (z - z0) / cell;
    aux[n * 4] = bil(m.deposit, cu, cw);
    aux[n * 4 + 1] = bil(m.flow, cu, cw);
    // hardness from the 3-D strata model so beds read correctly on the undercut faces
    aux[n * 4 + 2] = ctx.strata.sample(x, z, y)[0];
    aux[n * 4 + 3] = bil(m.cavity, cu, cw);
    aux2[n * 4] = bil(m.road, cu, cw);
    aux2[n * 4 + 1] = bil(m.river, cu, cw);
    aux2[n * 4 + 2] = bil(m.lake, cu, cw);
    const wi = Math.min(Sx - 1, Math.max(0, Math.round(cu))), wj = Math.min(Sz - 1, Math.max(0, Math.round(cw)));
    aux2[n * 4 + 3] = m.waterLevel[wj * Sx + wi];
  }
  const index = count > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  return { positions: pos, normals, aux, aux2, index, voxels: nx * ny * nz, triangles: indices.length / 3 };
}
