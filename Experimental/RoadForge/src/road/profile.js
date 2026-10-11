// RoadForge — road cross-sections.
//
// A profile is an ordered list of lateral points (left → right) describing the
// true engineering section: verge, footway, kerb chamfer, kerb face, channel,
// parking lane, cycle lane, running lanes, median. Consecutive points that
// `bridge` become one quad strip when swept along the spline, so the whole
// carriageway comes out as a structured quad grid.
//
// IMPORTANT: every profile begins and ends with an 8-entry "kerb stack" of the
// same shape no matter the road class. That uniformity is what lets junction
// corner fillets weld to any road end with shared vertices and zero cracks.

import { MAT } from './materials.js';

export const KERB_W = 0.17;      // kerb stone top width
export const CHANNEL_W = 0.42;   // concrete gutter channel
export const VERGE_W = 0.9;
export const STACK = 8;          // entries per kerb stack (fixed!)

export class Profile {
  constructor() {
    this.pts = [];
    this._run = 0;
  }
  get last() { return this.pts[this.pts.length - 1]; }

  push(u, h, mat, kind, bridge, extra) {
    this.pts.push({ u, h, mat, kind, bridge, uv: this._run, ...(extra || null) });
    return this.pts.length - 1;
  }

  /** Start a new (disconnected) point. */
  move(u, h, mat, kind = 'misc', extra = null) {
    return this.push(u, h, mat, kind, false, extra);
  }

  /** Continue the section — emits a quad strip from the previous point. */
  to(u, h, mat, kind = 'misc', extra = null) {
    const p = this.last;
    if (!p) return this.move(u, h, mat, kind, extra);
    if (p.mat !== mat) this.push(p.u, p.h, mat, kind, false, null); // material seam
    this._run += Math.hypot(u - p.u, h - p.h);
    return this.push(u, h, mat, kind, true, extra);
  }

  /** Continue with lateral subdivision so the strip can take displacement. */
  span(u, h, mat, kind, step = 1.15, extra = null) {
    const p = this.last;
    const du = u - p.u, dh = h - p.h;
    const n = Math.max(1, Math.ceil(Math.abs(du) / step));
    let idx = -1;
    const u0 = p.u, h0 = p.h;
    for (let i = 1; i <= n; i++) idx = this.to(u0 + (du * i) / n, h0 + (dh * i) / n, mat, kind, extra);
    return idx;
  }
}

/** Surface height of a crowned carriageway at lateral offset u. */
export function crownAt(u, crown, roadHalf) {
  const a = Math.abs(u);
  if (roadHalf <= 0.001) return 0;
  const t = Math.min(1, a / roadHalf);
  return -crown * roadHalf * (t * t * 0.55 + t * 0.45);
}

function kerbStack(P, sgn, cfg, open) {
  // Ordered outer → inner when open === true (left side), inner → outer otherwise.
  const { roadHalf, hChan, hKerbTop, sw, walkMat, curbH } = cfg;
  const u = (x) => sgn * x;
  const uVergeOut = roadHalf + KERB_W + sw + VERGE_W;
  const uWalkOut = roadHalf + KERB_W + sw;
  const uKerbBack = roadHalf + KERB_W;
  const uKerbFront = roadHalf + 0.025;
  const uChamfer = roadHalf;
  const uFace = roadHalf - 0.02;
  const hWalkOut = hKerbTop + sw * 0.018 + 0.012;
  const hKerbBack = hKerbTop + 0.012;
  const hChamfer = hKerbTop - Math.min(0.022, curbH * 0.3);
  const seq = [
    [uVergeOut, 0, MAT.GRASS, 'verge-outer', { dyn: 'ground' }],
    [uWalkOut, hWalkOut, MAT.GRASS, 'verge'],
    [uKerbBack, hKerbBack, walkMat, 'footway'],
    [uKerbFront, hKerbTop, MAT.CURB, 'kerb-top'],
    [uChamfer, hChamfer, MAT.CURB, 'kerb-chamfer'],
    [uFace, hChan, MAT.CURB, 'kerb-face'],
  ];
  if (!open) seq.reverse();
  let first = -1;
  for (let i = 0; i < seq.length; i++) {
    const [x, h, mat, kind, extra] = seq[i];
    if (i === 0 && open) first = P.move(u(x), h, mat, kind, extra);
    else P.to(u(x), h, mat, kind, extra);
  }
  return first;
}

/**
 * Build the cross-section template for an edge.
 */
export function buildProfile(e, net) {
  const P = new Profile();
  const isRail = e.cls === 'rail';
  const roadHalf = net.roadHalf(e);
  const crown = isRail ? 0.004 : e.crown;
  const curbH = isRail ? 0.0 : Math.max(0.02, e.curbHeight);
  const hEdge = crownAt(roadHalf, crown, roadHalf);
  const hChan = hEdge - (isRail ? 0 : 0.016);
  const hKerbTop = hEdge + curbH;

  const cfgL = {
    roadHalf, hChan, hKerbTop, curbH,
    sw: isRail ? 0.25 : Math.max(0.04, e.sidewalkL),
    walkMat: isRail ? MAT.BALLAST : (e.sidewalkL > 0.3 && curbH > 0.05 ? MAT.PAVING : MAT.DIRT),
  };
  const cfgR = {
    roadHalf, hChan, hKerbTop, curbH,
    sw: isRail ? 0.25 : Math.max(0.04, e.sidewalkR),
    walkMat: isRail ? MAT.BALLAST : (e.sidewalkR > 0.3 && curbH > 0.05 ? MAT.PAVING : MAT.DIRT),
  };

  kerbStack(P, -1, cfgL, true);           // left stack: entries 0..7
  const cwFrom = P.to(-(roadHalf - 0.02), hChan, isRail ? MAT.BALLAST : MAT.GUTTER, 'channel-edge');

  if (isRail) {
    P.span(roadHalf - 0.02, hChan, MAT.BALLAST, 'ballast', 0.85);
  } else {
    // ---- left half carriageway (reverse flow) ----
    P.to(-(roadHalf - CHANNEL_W), crownAt(roadHalf - CHANNEL_W, crown, roadHalf), MAT.GUTTER, 'channel');
    let x = roadHalf - CHANNEL_W;
    if (e.parkingL > 0.2) {
      x -= e.parkingL;
      P.span(-x, crownAt(x, crown, roadHalf), MAT.ASPHALT, 'parking', 1.2);
    }
    if (e.bikeLaneL) {
      x -= 1.6;
      P.span(-x, crownAt(x, crown, roadHalf), MAT.BIKE, 'cycle', 0.82);
    }
    const mHalf = e.medianW > 0.1 ? e.medianW / 2 : 0;
    const lanesB = Math.max(e.lanesB, 0);
    for (let i = 0; i < lanesB; i++) {
      x = Math.max(mHalf, x - e.laneWidth);
      P.span(-x, crownAt(x, crown, roadHalf), MAT.ASPHALT, 'lane', 1.15);
    }
    if (x > mHalf + 0.05) P.span(-mHalf, crownAt(mHalf, crown, roadHalf), MAT.ASPHALT, 'lane', 1.15);

    // ---- median ----
    if (e.medianW > 0.5 && e.median === 'raised') {
      const hm = crownAt(mHalf, crown, roadHalf);
      P.to(-mHalf + 0.03, hm + 0.145, MAT.CURB, 'median-face');
      P.to(-mHalf + 0.2, hm + 0.16, MAT.CURB, 'median-top');
      P.span(mHalf - 0.2, hm + 0.1, MAT.DIRT, 'median-fill', 1.4);
      P.to(mHalf - 0.03, hm + 0.16, MAT.CURB, 'median-top');
      P.to(mHalf, hm + 0.145, MAT.CURB, 'median-face');
      P.to(mHalf, hm, MAT.ASPHALT, 'lane');
    } else if (e.medianW > 0.1) {
      P.span(mHalf, crownAt(mHalf, crown, roadHalf), MAT.ASPHALT, 'median-flat', 1.2);
    }

    // ---- right half carriageway (forward flow) ----
    x = mHalf;
    const lanesF = Math.max(e.lanesF, 0);
    const xMax = roadHalf - CHANNEL_W;
    for (let i = 0; i < lanesF; i++) {
      x = Math.min(xMax, x + e.laneWidth);
      P.span(x, crownAt(x, crown, roadHalf), MAT.ASPHALT, 'lane', 1.15);
    }
    if (e.bikeLaneR) {
      x = Math.min(xMax, x + 1.6);
      P.span(x, crownAt(x, crown, roadHalf), MAT.BIKE, 'cycle', 0.82);
    }
    if (e.parkingR > 0.2) {
      x = Math.min(xMax, x + e.parkingR);
      P.span(x, crownAt(x, crown, roadHalf), MAT.ASPHALT, 'parking', 1.2);
    }
    if (x < xMax - 0.05) P.span(xMax, crownAt(xMax, crown, roadHalf), MAT.ASPHALT, 'lane', 1.2);
    P.to(roadHalf - 0.02, hChan, MAT.GUTTER, 'channel');
  }

  const cwTo = P.pts.length - 1;
  kerbStack(P, 1, cfgR, false);           // right stack: last 8 entries

  return {
    pts: P.pts,
    cwFrom, cwTo,
    stackL: [0, STACK - 1],
    stackR: [P.pts.length - STACK, P.pts.length - 1],
    roadHalf, hChan, hKerbTop, curbH, crown,
    isRail,
    width: P.pts[P.pts.length - 1].u - P.pts[0].u,
  };
}

/**
 * Kerb-stack indices for one side of an arm, ordered INNER (kerb face bottom)
 * → OUTER (verge). `side` is relative to the OUTGOING direction at the node.
 */
export function armStackIndices(profile, end, side) {
  // Edge-space left stack is 0..7 (outer→inner); right stack is n-8..n-1 (inner→outer)
  const n = profile.pts.length;
  const leftInnerFirst = [7, 6, 5, 4, 3, 2, 1, 0];
  const rightInnerFirst = [n - 8, n - 7, n - 6, n - 5, n - 4, n - 3, n - 2, n - 1];
  // At end 0 the outgoing direction equals the edge forward direction.
  const outgoingRightIsEdgeRight = end === 0;
  if (side === 'right') return outgoingRightIsEdgeRight ? rightInnerFirst : leftInnerFirst;
  return outgoingRightIsEdgeRight ? leftInnerFirst : rightInnerFirst;
}

/** Carriageway indices ordered from the OUTGOING-left edge to the outgoing-right edge. */
export function armCarriageIndices(profile, end) {
  const idx = [];
  for (let i = profile.cwFrom; i <= profile.cwTo; i++) idx.push(i);
  // Edge-space order is left→right; flip when the arm leaves backwards.
  if (end === 1) idx.reverse();
  return idx;
}
