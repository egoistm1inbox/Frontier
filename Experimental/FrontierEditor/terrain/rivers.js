// Simulated river network: channels are CUT into the ground.
//
// The earlier prototype ran its drainage on a routing copy and then laid water on the surface, so
// the rivers read as flat strips (and any ground below the water line was painted blue). This solver
// works the other way round:
//
//   1. Route the current surface (priority flood + D8) and accumulate drainage area.
//   2. Cells whose catchment passes a threshold are channels. Width and depth grow with the
//      catchment (Leopold–Maddock style: width ∝ √area).
//   3. The bed is a monotone long profile: it can only fall downstream, so water never runs uphill.
//      Each channel point is lowered onto a smooth U-profile around that bed (a cut, never a fill),
//      banks rise at a fixed angle until they meet the untouched ground.
//   4. Water exists only where the *carved* ground lies below the water surface, which is itself a
//      monotone profile inside the channel. Nothing is written beyond the channel footprint, so the
//      water sits in a real trench with dry banks, and dry ground is never tinted.

import { fillDepressions, flowDirections, NO_WATER } from './routing.js';
import { smoothstep, clamp01 } from './noise.js';

const SQRT2 = Math.SQRT2;

// Kahn order on the drainage graph: every cell appears after all of its donors (upstream first).
function upstreamOrder(down, total) {
  const indeg = new Int32Array(total);
  for (let c = 0; c < total; c++) if (down[c] >= 0) indeg[down[c]]++;
  const order = new Int32Array(total);
  let head = 0, tail = 0;
  for (let c = 0; c < total; c++) if (indeg[c] === 0) order[tail++] = c;
  while (head < tail) {
    const c = order[head++];
    const d = down[c];
    if (d >= 0 && --indeg[d] === 0) order[tail++] = d;
  }
  return order.subarray(0, tail);
}

// opts: sea [m], minCatchmentKm2, widthAt1km2 [m], minWidth [m], maxWidth [m], depthScale,
//       waterFraction (0–1 of channel depth), bankAngle [°], minGrade (fraction), smooth (passes).
// Modifies `height` in place. Returns water level (NO_WATER where dry), riverMask (0–1) and stats.
export function carveRivers(height, N, cell, opts = {}) {
  const total = N * N;
  const sea = opts.sea == null ? -Infinity : opts.sea;
  const cellKm2 = (cell * cell) / 1e6;
  const { filled } = fillDepressions(height, N, sea, 1e-4);
  const down = flowDirections(filled, N);
  const topo = upstreamOrder(down, total);

  const acc = new Float32Array(total).fill(1);
  for (let n = 0; n < topo.length; n++) {
    const c = topo[n], d = down[c];
    if (d >= 0) acc[d] += acc[c];
  }

  const minCells = Math.max(2, (opts.minCatchmentKm2 ?? 0.02) / cellKm2);
  const isRiver = new Uint8Array(total);
  for (let c = 0; c < total; c++) if (acc[c] >= minCells && height[c] > sea) isRiver[c] = 1;

  const wScale = opts.widthAt1km2 ?? 40;
  const wMin = opts.minWidth ?? cell * 1.5;
  const wMax = opts.maxWidth ?? 90;
  const dScale = opts.depthScale ?? 1;
  const waterFrac = clamp01(opts.waterFraction ?? 0.45);
  const bankTan = Math.tan(((opts.bankAngle ?? 32) * Math.PI) / 180);
  const minGrade = opts.minGrade ?? 0.002;

  const width = new Float32Array(total), depth = new Float32Array(total);
  const bed = new Float32Array(total), wl = new Float32Array(total);
  for (let c = 0; c < total; c++) {
    if (!isRiver[c]) continue;
    const w = Math.min(wMax, Math.max(wMin, wScale * Math.sqrt(acc[c] * cellKm2)));
    width[c] = w;
    depth[c] = Math.min(3.5, Math.max(0.5, dScale * (0.06 * w + 0.4)));
    bed[c] = filled[c] - depth[c];
  }

  // step length from c to its receiver (diagonal steps are √2 cells)
  const stepLen = (c, d) => {
    const ci = c % N, di = d % N;
    const diag = ci !== di && ((c - ci) / N) !== ((d - di) / N);
    return diag ? cell * SQRT2 : cell;
  };

  // long profile, downstream first: the bed may not rise downhill
  for (let n = topo.length - 1; n >= 0; n--) {
    const c = topo[n];
    if (!isRiver[c]) continue;
    const d = down[c];
    let b = bed[c];
    if (d >= 0 && isRiver[d]) b = Math.max(b, bed[d] + minGrade * stepLen(c, d));
    bed[c] = Math.min(b, filled[c] - 0.05);
  }
  // water surface: monotone, inside the channel, never above the ground it cuts
  for (let c = 0; c < total; c++) if (isRiver[c]) wl[c] = bed[c] + waterFrac * depth[c];
  for (let n = topo.length - 1; n >= 0; n--) {
    const c = topo[n];
    if (!isRiver[c]) continue;
    const d = down[c];
    if (d >= 0 && isRiver[d]) wl[c] = Math.max(wl[c], wl[d]);
    wl[c] = Math.min(Math.max(wl[c], bed[c] + 0.05), bed[c] + depth[c], filled[c]);
  }

  // centreline: each point averaged with its main donor and receiver, twice, to remove the D8 stair
  const main = new Int32Array(total).fill(-1);
  for (let n = 0; n < topo.length; n++) {
    const c = topo[n], d = down[c];
    if (d >= 0 && isRiver[c] && isRiver[d] && (main[d] < 0 || acc[c] > acc[main[d]])) main[d] = c;
  }
  let qx = new Float32Array(total), qz = new Float32Array(total);
  for (let c = 0; c < total; c++) { qx[c] = c % N; qz[c] = Math.floor(c / N); }
  for (let pass = 0; pass < (opts.smooth ?? 2); pass++) {
    const nx = Float32Array.from(qx), nz = Float32Array.from(qz);
    for (let c = 0; c < total; c++) {
      if (!isRiver[c]) continue;
      const d = down[c];
      const u = main[c] >= 0 ? main[c] : c;
      const v = d >= 0 && isRiver[d] ? d : c;
      nx[c] = 0.5 * qx[c] + 0.25 * qx[u] + 0.25 * qx[v];
      nz[c] = 0.5 * qz[c] + 0.25 * qz[u] + 0.25 * qz[v];
    }
    qx = nx; qz = nz;
  }

  // one segment per channel cell: centre → receiver (a point when the receiver is not a channel)
  const origin = Float32Array.from(height);
  const segs = [];
  for (let c = 0; c < total; c++) {
    if (!isRiver[c]) continue;
    const d = down[c] >= 0 && isRiver[down[c]] ? down[c] : c;
    segs.push(c, d);
  }

  // Every ground cell takes its channel profile from its NEAREST centreline point only. The bed,
  // width and depth are interpolated along that one segment, so the profile is continuous along the
  // river. (Taking the lowest of several overlapping segments pulled steep reaches far below their
  // own bed and floated the water surface over a trench.)
  const nD = new Float32Array(total).fill(Infinity);
  const nW = new Float32Array(total), nBL = new Float32Array(total);
  const nDep = new Float32Array(total), nWL = new Float32Array(total);
  for (let s = 0; s < segs.length; s += 2) {
    const a = segs[s], b = segs[s + 1];
    const ax = qx[a], az = qz[a], bx = qx[b], bz = qz[b];
    const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz;
    const depMax = Math.max(depth[a], depth[b]);
    const reach = Math.max(width[a], width[b]) / 2 + Math.max(2 * cell, 1.5 * depMax / Math.max(bankTan, 0.1)) + cell;
    const rc = Math.ceil(reach / cell);
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx)) - rc), i1 = Math.min(N - 1, Math.ceil(Math.max(ax, bx)) + rc);
    const j0 = Math.max(0, Math.floor(Math.min(az, bz)) - rc), j1 = Math.min(N - 1, Math.ceil(Math.max(az, bz)) + rc);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const t = L2 > 0 ? Math.min(1, Math.max(0, ((i - ax) * vx + (j - az) * vz) / L2)) : 0;
        const dist = Math.hypot(i - (ax + t * vx), j - (az + t * vz)) * cell;
        const p = j * N + i;
        if (dist >= nD[p]) continue;
        nD[p] = dist;
        nW[p] = width[a] + (width[b] - width[a]) * t;
        nBL[p] = bed[a] + (bed[b] - bed[a]) * t;
        nDep[p] = depth[a] + (depth[b] - depth[a]) * t;
        nWL[p] = wl[a] + (wl[b] - wl[a]) * t;
      }
    }
  }

  // cut: a U-shaped trench across the channel; beyond the channel top the banks rise at `bankAngle`
  // and the cut fades out smoothly into the untouched ground (no shelf, no wall at the search edge)
  const water = new Float32Array(total).fill(NO_WATER);
  const riverMask = new Float32Array(total);
  let waterCells = 0, cutVolume = 0, maxCut = 0;
  for (let p = 0; p < total; p++) {
    if (nD[p] === Infinity) continue;
    const half = nW[p] / 2;
    const r = nD[p] / half;
    const z = r <= 1 ? nBL[p] + nDep[p] * Math.pow(r, 2.2) : nBL[p] + nDep[p] + (nD[p] - half) * bankTan;
    const fade = r <= 1 ? 1 : 1 - smoothstep(half, half + Math.max(2 * cell, 1.5 * nDep[p] / Math.max(bankTan, 0.1)), nD[p]);
    if (height[p] > z) height[p] -= (height[p] - z) * fade;
    // water: inside the channel footprint, where the carved ground is below the water surface
    if (r <= 1.15 && height[p] < nWL[p] - 0.02) {
      water[p] = nWL[p];
      riverMask[p] = 1 - smoothstep(0.8, 1.15, r);
      waterCells++;
    }
  }
  for (let p = 0; p < total; p++) {
    const cut = origin[p] - height[p];
    if (cut > 0) { cutVolume += cut * cell * cell; if (cut > maxCut) maxCut = cut; }
  }
  let channelCells = 0;
  for (let c = 0; c < total; c++) if (isRiver[c]) channelCells++;
  return {
    water, riverMask, channel: isRiver, acc,
    stats: { channelCells, waterCells, cutVolume, maxCut },
  };
}
