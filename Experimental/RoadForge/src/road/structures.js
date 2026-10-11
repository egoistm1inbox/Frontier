// RoadForge — civil structures.
//
// build.js classifies every sample of every edge as grade / viaduct / trench /
// tunnel and hands the non-grade spans here. This module grows the real
// engineering around those spans: box-girder decks with fascia and soffit,
// tapered piers with caps and footings, abutments, retaining walls, tunnel
// bores with portal headwalls, and railway trackwork.
//
// Everything is emitted into the SAME MeshBuilder as the carriageway, so the
// scene stays one welded mesh with honest quad topology.

import { MAT } from './materials.js';
import { clamp, lerp, smoothstep } from '../core/math.js';
import { box } from '../core/mesh.js';

const EASE = 6.0; // must match build.js structure easing

export function buildStructures(mb, structures, opts = {}) {
  const groundAt = opts.groundAt || (() => 0);
  const clearance = opts.clearance || (() => true);
  const stats = { piers: 0, decks: 0, portals: 0, walls: 0 };
  for (const sp of structures) {
    if (sp.mode === 'viaduct') viaduct(mb, sp, groundAt, clearance, stats);
    else if (sp.mode === 'tunnel') tunnelBore(mb, sp, groundAt, stats);
    else if (sp.mode === 'trench') trenchWalls(mb, sp, groundAt, stats);
  }
  return stats;
}

/* --------------------------------------------------------------- helpers */

function rowsFor(sp, step) {
  const n = Math.max(2, Math.ceil((sp.s1 - sp.s0) / step));
  const rows = [];
  for (let i = 0; i <= n; i++) {
    const s = sp.s0 + ((sp.s1 - sp.s0) * i) / n;
    rows.push(sp.curve.frameAt(s));
  }
  return rows;
}

function W(fr, u, h) {
  return [fr.p[0] + fr.right[0] * u, fr.p[1] + h, fr.p[2] + fr.right[2] * u];
}

/** Deck-edge easing identical to build.js so fascias weld to the deck lip. */
function lip(sp, fr, groundAt) {
  const pts = sp.profile.pts;
  const n = pts.length;
  const blend = clamp(Math.min(fr.s - sp.es0, sp.es1 - fr.s) / EASE, 0, 1);
  const gy = groundAt(fr.p[0], fr.p[2]);
  const L = {
    u: lerp(pts[0].u, pts[1].u - 0.22, blend),
    h: lerp(gy - fr.p[1], pts[1].h + 0.06, blend),
  };
  const R = {
    u: lerp(pts[n - 1].u, pts[n - 2].u + 0.22, blend),
    h: lerp(gy - fr.p[1], pts[n - 2].h + 0.06, blend),
  };
  return { L, R, blend, gy };
}

/** Sweep an open section (array of [u,h]) along rows. Pure quad strips. */
function sweepSection(mb, rows, sectionAt, mat, uvScale = 0.35) {
  let prev = null;
  let prevS = 0;
  for (const fr of rows) {
    const sec = sectionAt(fr);
    if (!sec) { prev = null; continue; }
    const idx = new Array(sec.length);
    let run = 0;
    for (let i = 0; i < sec.length; i++) {
      if (i > 0) run += Math.hypot(sec[i][0] - sec[i - 1][0], sec[i][1] - sec[i - 1][1]);
      mb.setCtx(sec[i][2] ?? mat, 0, sec[i][3] ?? 0, 0);
      idx[i] = mb.vert(W(fr, sec[i][0], sec[i][1]), [run * uvScale, fr.s * uvScale], [sec[i][0], fr.s, 0.12, 0]);
    }
    if (prev && prev.length === idx.length) {
      for (let i = 0; i < idx.length - 1; i++) mb.quad(prev[i], prev[i + 1], idx[i + 1], idx[i]);
    }
    prev = idx;
    prevS = fr.s;
  }
  return prevS;
}

/* -------------------------------------------------------------- viaduct */

function viaduct(mb, sp, groundAt, clearance, stats) {
  const span = sp.s1 - sp.s0;
  if (span < 3) return;
  const rows = rowsFor(sp, 2.0);
  const width = sp.profile.width;
  const T = clamp(width * 0.085 + span * 0.012, 0.75, 2.1); // girder depth
  const objId = sp.objId;

  // --- deck: one continuous section down the left fascia, across the
  //     soffit and back up the right fascia.
  sweepSection(mb, rows, (fr) => {
    const { L, R, blend } = lip(sp, fr, groundAt);
    if (blend < 0.015) return null;
    const k = smoothstep(blend);
    const drop = 0.30 * k;
    const depth = T * k;
    const haunch = 0.26 * k;
    const yTop = L.h;
    const sec = [];
    sec.push([L.u, L.h, MAT.CONCRETE, objId]);
    sec.push([L.u - 0.07 * k, yTop - drop * 0.75, MAT.CONCRETE, objId]);
    sec.push([L.u - 0.11 * k, yTop - drop, MAT.CONCRETE, objId]);
    sec.push([L.u - 0.11 * k, yTop - drop - depth, MAT.CONCRETE, objId]);
    const sl = L.u - 0.11 * k + 0.55;
    const sr = R.u + 0.11 * k - 0.55;
    const ySof = yTop - drop - depth - haunch;
    const segs = Math.max(2, Math.round((sr - sl) / 1.6));
    for (let i = 0; i <= segs; i++) {
      sec.push([lerp(sl, sr, i / segs), ySof, MAT.CONCRETE, objId]);
    }
    sec.push([R.u + 0.11 * k, yTop - drop - depth, MAT.CONCRETE, objId]);
    sec.push([R.u + 0.11 * k, yTop - drop, MAT.CONCRETE, objId]);
    sec.push([R.u + 0.07 * k, yTop - drop * 0.75, MAT.CONCRETE, objId]);
    sec.push([R.u, R.h, MAT.CONCRETE, objId]);
    return sec;
  }, MAT.CONCRETE);
  stats.decks++;

  // --- piers
  const ideal = clamp(18 + width * 0.8, 18, 34);
  const count = Math.max(0, Math.round(span / ideal) - 1);
  mb.setCtx(MAT.CONCRETE, 0, objId, 0);
  for (let i = 1; i <= count; i++) {
    let s = sp.s0 + (span * i) / (count + 1);
    const fr0 = sp.curve.frameAt(s);
    if (!clearance(fr0.p[0], fr0.p[2])) {
      let moved = false;
      for (const off of [4, -4, 8, -8, 12, -12]) {
        const t = clamp(s + off, sp.s0 + 6, sp.s1 - 6);
        const f = sp.curve.frameAt(t);
        if (clearance(f.p[0], f.p[2])) { s = t; moved = true; break; }
      }
      if (!moved) continue;
    }
    const fr = sp.curve.frameAt(s);
    const { L, R, blend } = lip(sp, fr, groundAt);
    if (blend < 0.6) continue;
    const gy = groundAt(fr.p[0], fr.p[2]);
    const soffitY = fr.p[1] + L.h - 0.30 - T - 0.26;
    const h = soffitY - gy;
    if (h < 1.6) continue;
    const ang = Math.atan2(fr.right[0], fr.right[2]);
    const wide = (R.u - L.u) > 16;
    const cx = fr.p[0], cz = fr.p[2];

    // pier cap (crosshead)
    const capW = Math.min((R.u - L.u) * 0.62, 11);
    box(mb, [cx, soffitY - 0.45, cz], [capW, 0.9, 1.9], ang);
    // shafts
    const shafts = wide ? [-capW * 0.3, capW * 0.3] : [0];
    for (const off of shafts) {
      const px = cx + fr.right[0] * off, pz = cz + fr.right[2] * off;
      const shaftH = h - 0.9;
      const top = soffitY - 0.9;
      const segs = 3;
      for (let k2 = 0; k2 < segs; k2++) {
        const t0 = k2 / segs, t1 = (k2 + 1) / segs;
        const y0 = top - shaftH * t0, y1 = top - shaftH * t1;
        const w0 = lerp(1.5, 2.1, t0), w1 = lerp(1.5, 2.1, t1);
        const d0 = lerp(1.1, 1.5, t0), d1 = lerp(1.1, 1.5, t1);
        prism(mb, [px, y1, pz], [px, y0, pz], w1, d1, w0, d0, ang);
      }
      // footing
      box(mb, [px, gy + 0.22, pz], [3.4, 0.55, 2.8], ang);
      stats.piers++;
    }
  }

  // --- abutments at both ends
  for (const endS of [sp.s0, sp.s1]) {
    const inward = endS === sp.s0 ? 1 : -1;
    const fr = sp.curve.frameAt(clamp(endS + inward * 0.9, 0, sp.curve.length));
    const { L, R, blend } = lip(sp, fr, groundAt);
    const gy = groundAt(fr.p[0], fr.p[2]);
    const topY = fr.p[1] + lerp(L.h, R.h, 0.5) - 0.2;
    if (topY - gy < 1.0) continue;
    const ang = Math.atan2(fr.right[0], fr.right[2]);
    const w = (R.u - L.u) + 0.6;
    const cu = (L.u + R.u) * 0.5;
    const p = W(fr, cu, 0);
    mb.setCtx(MAT.CONCRETE, 0, objId, 0);
    box(mb, [p[0] - fr.t[0] * inward * 0.7, (topY + gy) * 0.5, p[2] - fr.t[2] * inward * 0.7],
      [w, topY - gy, 1.5], ang);
    stats.walls++;
  }
}

/** Tapered 4-sided prism between two rectangular rings. */
function prism(mb, pBot, pTop, wB, dB, wT, dT, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const corner = (p, w, d, sx, sz) => [
    p[0] + (sx * w * 0.5) * c + (sz * d * 0.5) * s,
    p[1],
    p[2] - (sx * w * 0.5) * s + (sz * d * 0.5) * c,
  ];
  const sgn = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const bot = sgn.map(([a, b]) => mb.vert(corner(pBot, wB, dB, a, b), [0, 0], [0, 0, 0, 0]));
  const top = sgn.map(([a, b]) => mb.vert(corner(pTop, wT, dT, a, b), [1, 1], [0, 0, 0, 0]));
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    mb.quad(bot[i], bot[j], top[j], top[i]);
  }
}

/* ---------------------------------------------------------------- trench */

function trenchWalls(mb, sp, groundAt, stats) {
  const rows = rowsFor(sp, 2.2);
  const objId = sp.objId;
  sweepSection(mb, rows, (fr) => {
    const { L, blend, gy } = lip(sp, fr, groundAt);
    if (blend < 0.02) return null;
    const rel = gy - fr.p[1];
    if (rel - L.h < 0.4) return null;
    const k = smoothstep(blend);
    return [
      [L.u, L.h, MAT.CONCRETE, objId],
      [L.u - 0.05, L.h + (rel - L.h) * 0.5 * k, MAT.CONCRETE, objId],
      [L.u - 0.08, rel * k + L.h * (1 - k), MAT.CONCRETE, objId],
      [L.u - 0.5, rel * k + L.h * (1 - k) + 0.02, MAT.CONCRETE, objId],
    ];
  }, MAT.CONCRETE);
  sweepSection(mb, rows, (fr) => {
    const { R, blend, gy } = lip(sp, fr, groundAt);
    if (blend < 0.02) return null;
    const rel = gy - fr.p[1];
    if (rel - R.h < 0.4) return null;
    const k = smoothstep(blend);
    return [
      [R.u + 0.5, rel * k + R.h * (1 - k) + 0.02, MAT.CONCRETE, objId],
      [R.u + 0.08, rel * k + R.h * (1 - k), MAT.CONCRETE, objId],
      [R.u + 0.05, R.h + (rel - R.h) * 0.5 * k, MAT.CONCRETE, objId],
      [R.u, R.h, MAT.CONCRETE, objId],
    ];
  }, MAT.CONCRETE);
  stats.walls += 2;
}

/* ---------------------------------------------------------------- tunnel */

function tunnelBore(mb, sp, groundAt, stats) {
  const rows = rowsFor(sp, 2.4);
  const objId = sp.objId;
  const clearH = 5.3;
  const ARCH = 10;

  // Bore: walls + segmental arch, inward facing, one continuous section.
  sweepSection(mb, rows, (fr) => {
    const { L, R, blend } = lip(sp, fr, groundAt);
    if (blend < 0.05) return null;
    const k = smoothstep(blend);
    const hw = (R.u - L.u) * 0.5;
    const cu = (L.u + R.u) * 0.5;
    const wallTop = L.h + (clearH - 1.6) * k;
    const crown = L.h + clearH * k;
    const sec = [];
    sec.push([R.u, R.h, MAT.CONCRETE, objId]);
    sec.push([R.u + 0.04, wallTop, MAT.CONCRETE, objId]);
    for (let i = 1; i < ARCH; i++) {
      const a = (i / ARCH) * Math.PI;
      sec.push([cu + Math.cos(a) * hw, wallTop + Math.sin(a) * (crown - wallTop), MAT.CONCRETE, objId]);
    }
    sec.push([L.u - 0.04, wallTop, MAT.CONCRETE, objId]);
    sec.push([L.u, L.h, MAT.CONCRETE, objId]);
    return sec;
  }, MAT.CONCRETE);

  // Portal headwalls at both ends.
  for (const endS of [sp.s0, sp.s1]) {
    const inward = endS === sp.s0 ? 1 : -1;
    const fr = sp.curve.frameAt(clamp(endS + inward * 1.2, 0, sp.curve.length));
    const { L, R, blend } = lip(sp, fr, groundAt);
    if (blend < 0.35) continue;
    const gy = groundAt(fr.p[0], fr.p[2]);
    const ang = Math.atan2(fr.right[0], fr.right[2]);
    const crownY = fr.p[1] + L.h + clearH;
    if (gy - crownY < 0.3) continue;
    const cu = (L.u + R.u) * 0.5;
    const w = (R.u - L.u);
    const p = W(fr, cu, 0);
    mb.setCtx(MAT.CONCRETE, 0, objId, 0);
    // lintel over the arch + jambs either side
    box(mb, [p[0], (crownY + gy) * 0.5 + 0.35, p[2]], [w + 3.2, Math.max(0.8, gy - crownY) + 0.7, 1.1], ang);
    for (const su of [L.u - 1.3, R.u + 1.3]) {
      const q = W(fr, su, 0);
      box(mb, [q[0], (fr.p[1] + L.h + gy) * 0.5, q[2]],
        [2.0, Math.max(1.0, gy - (fr.p[1] + L.h)), 1.1], ang);
    }
    stats.portals++;
  }
}

/* ------------------------------------------------------------- trackwork */

/**
 * Rails + sleepers for every rail-class edge. Sleepers are quad boxes, rails
 * are swept I-section-ish beams — no billboards, no decals.
 */
export function buildTrackwork(mb, net, curves, profiles, opts = {}) {
  const trims = opts.trims || new Map();
  let sleepers = 0;
  for (const e of net.edges.values()) {
    if (e.cls !== 'rail') continue;
    const curve = curves.get(e.id);
    const prof = profiles.get(e.id);
    if (!curve || !prof) continue;
    const ta = trims.get(`${e.id}:0`) || 0;
    const tb = trims.get(`${e.id}:1`) || 0;
    const s0 = ta + 0.4;
    const s1 = curve.length - tb - 0.4;
    if (s1 - s0 < 2) continue;
    const gauge = 1.435;
    const railHead = prof.hChan + 0.19;

    // sleepers every 0.62 m
    mb.setCtx(MAT.SLEEPER, 0, 0, 0);
    const step = 0.62;
    for (let s = s0; s < s1; s += step) {
      const fr = curve.frameAt(s);
      const ang = Math.atan2(fr.right[0], fr.right[2]);
      box(mb, [fr.p[0], fr.p[1] + prof.hChan + 0.075, fr.p[2]], [2.6, 0.15, 0.26], ang);
      sleepers++;
    }
    // rails
    const rows = [];
    const n = Math.max(2, Math.ceil((s1 - s0) / 1.4));
    for (let i = 0; i <= n; i++) rows.push(curve.frameAt(s0 + ((s1 - s0) * i) / n));
    for (const side of [-1, 1]) {
      const u0 = (side * gauge) / 2;
      mb.setCtx(MAT.STEEL, 0, 0, 0);
      sweepSection(mb, rows, () => ([
        [u0 - 0.07, railHead - 0.17, MAT.STEEL, 0],
        [u0 - 0.07, railHead - 0.145, MAT.STEEL, 0],
        [u0 - 0.025, railHead - 0.105, MAT.STEEL, 0],
        [u0 - 0.035, railHead - 0.03, MAT.STEEL, 0],
        [u0 - 0.035, railHead, MAT.STEEL, 0],
        [u0 + 0.035, railHead, MAT.STEEL, 0],
        [u0 + 0.035, railHead - 0.03, MAT.STEEL, 0],
        [u0 + 0.025, railHead - 0.105, MAT.STEEL, 0],
        [u0 + 0.07, railHead - 0.145, MAT.STEEL, 0],
        [u0 + 0.07, railHead - 0.17, MAT.STEEL, 0],
      ]), MAT.STEEL, 1.4);
    }
  }
  return { sleepers };
}
