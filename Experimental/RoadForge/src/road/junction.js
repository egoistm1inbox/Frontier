// RoadForge — junction solver.
//
// For every node the solver computes:
//   • per-arm trim distances (how far back each road stops),
//   • kerb corner fillets (true tangent arcs, never overlapping geometry),
//   • the merged carriageway boundary ring,
//   • concentric quad rings filling that boundary into ONE welded surface,
//   • swept kerb/footway corners that weld to each road's kerb stack.
//
// The result is a single continuous mesh: Y junctions look like Y, crosses
// look like +, and no quad is ever stacked on top of another.

import { clamp, lineLine, smoothstep, v3, wrapAngle } from '../core/math.js';
import { MAT } from './materials.js';
import { armCarriageIndices, armStackIndices, STACK } from './profile.js';

const rightN = (d) => [d[1], -d[0]];
const leftN = (d) => [-d[1], d[0]];

export function autoCornerRadius(net, node, arms) {
  if (node.cornerRadius > 0.05) return node.cornerRadius;
  let maxW = 0;
  let minClass = 99;
  const rank = { highway: 0, arterial: 1, street: 2, residential: 3, ramp: 2, alley: 4, rail: 3 };
  for (const a of arms) {
    maxW = Math.max(maxW, a.w);
    minClass = Math.min(minClass, rank[a.edge.cls] ?? 3);
  }
  const base = [11, 9, 6.5, 4.5, 3][minClass] ?? 5;
  return clamp(base * (0.6 + maxW / 14), 2.2, 16);
}

/**
 * Plan every node of the network. Returns Map<nodeId, plan> plus the trim
 * table consumed by the road sweeper.
 */
export function planNetwork(net, profiles, curves, ctx = {}) {
  const plans = new Map();
  const trims = new Map(); // `${edgeId}:${end}` -> distance

  for (const node of net.nodes.values()) {
    const armsRaw = net.arms(node.id);
    const arms = armsRaw.map((a) => {
      const prof = profiles.get(a.edge.id);
      return {
        edge: a.edge, end: a.end, dir: a.dir, angle: a.angle,
        profile: prof,
        curve: curves.get(a.edge.id),
        w: prof.roadHalf - 0.02,
        trim: 0,
      };
    });
    const plan = { node, arms, corners: [], mode: 'none', center: [node.x, node.y, node.z] };
    plans.set(node.id, plan);
    if (arms.length === 0) continue;

    if (arms.length === 1) {
      planEndCap(net, plan);
    } else if (arms.length === 2 && canWeld(arms)) {
      plan.mode = 'weld';
      plan.weldRef = arms[0];
      arms[0].trim = 0; arms[1].trim = 0;
    } else {
      planCap(net, plan, ctx);
    }

    for (const a of plan.arms) {
      const maxTrim = Math.max(0.6, a.curve.length * 0.46);
      a.trim = clamp(a.trim, 0, maxTrim);
      trims.set(`${a.edge.id}:${a.end}`, a.trim);
    }
  }

  // Shrink trims when the two ends of a short edge would cross.
  for (const e of net.edges.values()) {
    const c = curves.get(e.id);
    const ka = `${e.id}:0`, kb = `${e.id}:1`;
    let ta = trims.get(ka) || 0, tb = trims.get(kb) || 0;
    const room = c.length - 1.2;
    if (ta + tb > room && ta + tb > 0) {
      const k = room / (ta + tb);
      ta *= Math.max(0.05, k); tb *= Math.max(0.05, k);
      trims.set(ka, ta); trims.set(kb, tb);
      for (const plan of plans.values()) {
        for (const a of plan.arms) if (a.edge.id === e.id) a.trim = a.end === 0 ? ta : tb;
      }
    }
  }
  return { plans, trims };
}

function canWeld(arms) {
  const [a, b] = arms;
  const ang = Math.abs(wrapAngle(a.angle - b.angle));
  if (ang < 2.5) return false; // sharp hairpin → needs a cap
  const pa = a.profile, pb = b.profile;
  if (pa.pts.length !== pb.pts.length) return false;
  if (Math.abs(pa.roadHalf - pb.roadHalf) > 0.02) return false;
  for (let i = 0; i < pa.pts.length; i++) {
    const ia = pa.pts[i];
    // At end 1 the section is mirrored; compare against the mirrored partner.
    const jb = b.end === a.end ? pb.pts[pb.pts.length - 1 - i] : pb.pts[i];
    const sign = b.end === a.end ? -1 : 1;
    if (Math.abs(ia.u - sign * jb.u) > 0.02 || Math.abs(ia.h - jb.h) > 0.02) return false;
    if (ia.mat !== jb.mat) return false;
  }
  return true;
}

function planEndCap(net, plan) {
  const a = plan.arms[0];
  const node = plan.node;
  const bulb = node.tag === 'cul-de-sac' ? Math.max(8, a.w * 2.4) : a.w;
  a.trim = bulb;
  plan.mode = 'endcap';
  plan.bulb = bulb;
}

function planCap(net, plan, ctx) {
  const node = plan.node;
  // Ring order = decreasing angle so that face winding is +Y (see mesh notes).
  plan.arms.sort((p, q) => q.angle - p.angle);
  const arms = plan.arms;
  const K = arms.length;
  const R = autoCornerRadius(net, node, arms);
  plan.radius = R;
  plan.mode = 'cap';

  for (let k = 0; k < K; k++) {
    const hi = arms[k];
    const lo = arms[(k + 1) % K];
    const dh = hi.dir, dl = lo.dir;
    const oA = [node.x + rightN(dh)[0] * hi.w, node.z + rightN(dh)[1] * hi.w];
    const oB = [node.x + leftN(dl)[0] * lo.w, node.z + leftN(dl)[1] * lo.w];
    const crs = dh[0] * dl[1] - dh[1] * dl[0];
    const dot = clamp(dh[0] * dl[0] + dh[1] * dl[1], -1, 1);
    const corner = { hi: k, lo: (k + 1) % K, oA, oB };

    if (Math.abs(crs) < 0.07) {
      // Parallel / anti-parallel arms: straight connector, no fillet.
      corner.type = 'line';
      corner.reqHi = 0.2; corner.reqLo = 0.2;
      plan.corners.push(corner);
      continue;
    }
    const X = lineLine(oA, dh, oB, dl);
    const phi = Math.acos(dot);
    let rad = Math.min(R, Math.min(hi.w, lo.w) * 3.2);
    let T = rad / Math.tan(Math.max(0.08, phi / 2));
    const apexHi = X ? (X[0] - node.x) * dh[0] + (X[1] - node.z) * dh[1] : 0;
    if (!X || apexHi < -200) {
      corner.type = 'line';
      corner.reqHi = 0.2; corner.reqLo = 0.2;
      plan.corners.push(corner);
      continue;
    }
    // Keep sharp forks from exploding.
    const maxT = Math.max(hi.w, lo.w) * 4.5 + 10;
    if (T > maxT) { T = maxT; rad = T * Math.tan(Math.max(0.08, phi / 2)); }
    const C = [X[0], X[1]];
    const tanHi = [C[0] + dh[0] * T, C[1] + dh[1] * T];
    const tanLo = [C[0] + dl[0] * T, C[1] + dl[1] * T];
    let bis = [dh[0] + dl[0], dh[1] + dl[1]];
    const bl = Math.hypot(bis[0], bis[1]) || 1;
    bis = [bis[0] / bl, bis[1] / bl];
    const O = [C[0] + bis[0] * (rad / Math.sin(Math.max(0.04, phi / 2))),
      C[1] + bis[1] * (rad / Math.sin(Math.max(0.04, phi / 2)))];
    corner.type = 'arc';
    corner.C = C; corner.O = O; corner.radius = rad;
    corner.tanHi = tanHi; corner.tanLo = tanLo;
    corner.reqHi = (tanHi[0] - node.x) * dh[0] + (tanHi[1] - node.z) * dh[1];
    corner.reqLo = (tanLo[0] - node.x) * dl[0] + (tanLo[1] - node.z) * dl[1];
    plan.corners.push(corner);
  }

  // Trim each arm to satisfy both of its corners.
  for (let k = 0; k < K; k++) {
    const asHi = plan.corners[k];
    const asLo = plan.corners[(k - 1 + K) % K];
    const need = Math.max(asHi.reqHi, asLo.reqLo, arms[k].w * 0.35, 0.4);
    arms[k].trim = need + 0.12;
  }
}

/* ------------------------------------------------------------------ build */

/** Sample a corner boundary (kerb line) between two arms. */
function cornerSamples(plan, corner, step = 0) {
  if (!step) step = clamp((corner.rad || 4) * 0.16, 0.7, 1.7);
  const arms = plan.arms;
  const hi = arms[corner.hi], lo = arms[corner.lo];
  const node = plan.node;
  const pHi = [node.x + rightN(hi.dir)[0] * hi.w + hi.dir[0] * hi.trim,
    node.z + rightN(hi.dir)[1] * hi.w + hi.dir[1] * hi.trim];
  const pLo = [node.x + leftN(lo.dir)[0] * lo.w + lo.dir[0] * lo.trim,
    node.z + leftN(lo.dir)[1] * lo.w + lo.dir[1] * lo.trim];
  const pts = [];
  const push = (p, out) => pts.push({ p, out });

  if (corner.type === 'line') {
    const n = Math.max(1, Math.ceil(Math.hypot(pLo[0] - pHi[0], pLo[1] - pHi[1]) / step));
    let out = [pHi[0] - node.x, pHi[1] - node.z];
    const ol = Math.hypot(out[0], out[1]) || 1;
    out = [out[0] / ol, out[1] / ol];
    const outA = rightN(hi.dir), outB = leftN(lo.dir);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const o = [outA[0] * (1 - t) + outB[0] * t, outA[1] * (1 - t) + outB[1] * t];
      const l = Math.hypot(o[0], o[1]) || 1;
      push([pHi[0] + (pLo[0] - pHi[0]) * t, pHi[1] + (pLo[1] - pHi[1]) * t], [o[0] / l, o[1] / l]);
    }
    return pts;
  }

  // straight run → arc → straight run
  const { O, radius, tanHi, tanLo } = corner;
  const a0 = Math.atan2(tanHi[1] - O[1], tanHi[0] - O[0]);
  const a1 = Math.atan2(tanLo[1] - O[1], tanLo[0] - O[0]);
  let sweep = wrapAngle(a1 - a0);
  const run0 = Math.hypot(tanHi[0] - pHi[0], tanHi[1] - pHi[1]);
  const run1 = Math.hypot(pLo[0] - tanLo[0], pLo[1] - tanLo[1]);

  const outA = rightN(hi.dir), outB = leftN(lo.dir);
  const n0 = Math.max(1, Math.round(run0 / step));
  for (let i = 0; i < n0; i++) {
    const t = i / n0;
    push([pHi[0] + (tanHi[0] - pHi[0]) * t, pHi[1] + (tanHi[1] - pHi[1]) * t], outA);
  }
  const arcLen = Math.abs(sweep) * radius;
  const na = Math.max(2, Math.round(arcLen / step));
  for (let i = 0; i <= na; i++) {
    const a = a0 + sweep * (i / na);
    const p = [O[0] + Math.cos(a) * radius, O[1] + Math.sin(a) * radius];
    push(p, [Math.cos(a), Math.sin(a)]);
  }
  const n1 = Math.max(1, Math.round(run1 / step));
  for (let i = 1; i <= n1; i++) {
    const t = i / n1;
    push([tanLo[0] + (pLo[0] - tanLo[0]) * t, tanLo[1] + (pLo[1] - tanLo[1]) * t], outB);
  }
  return pts;
}

function endCapSamples(plan, step = 0.85) {
  const a = plan.arms[0];
  const node = plan.node;
  const fr = a.curve.frameAt(a.end === 0 ? a.trim : a.curve.length - a.trim);
  const d = a.dir;
  const c = [fr.p[0], fr.p[2]];
  const r = a.w;
  const a0 = Math.atan2(rightN(d)[1], rightN(d)[0]);
  const n = Math.max(6, Math.round((Math.PI * r) / step));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    // sweep from the arm's right side, around the nose, to its left side
    const ang = a0 - (Math.PI * i) / n;
    const dir = [Math.cos(ang), Math.sin(ang)];
    pts.push({ p: [c[0] + dir[0] * r, c[1] + dir[1] * r], out: dir });
  }
  return pts;
}

/**
 * Emit a junction into the mesh builder.
 * ctx: { mb, groundAt, objId, rpIndex, wearAt }
 */
export function buildJunction(plan, ctx) {
  if (plan.mode === 'none' || plan.mode === 'weld') return null;
  const { mb } = ctx;
  const arms = plan.arms;
  const node = plan.node;
  const ring = [];          // {x,y,z,idx}
  const cornerRuns = [];

  const armWorld = (a, pIdx) => {
    const s = a.end === 0 ? a.trim : a.curve.length - a.trim;
    const fr = a.curve.frameAt(s);
    const pt = a.profile.pts[pIdx];
    const h = pt.dyn === 'ground' ? (ctx.groundAt(fr.p[0], fr.p[2]) - fr.p[1]) : pt.h;
    return [
      fr.p[0] + fr.right[0] * pt.u,
      fr.p[1] + h,
      fr.p[2] + fr.right[2] * pt.u,
    ];
  };
  const armKey = (a, pIdx) => `jn:${a.edge.id}:${a.end}:${pIdx}`;

  // --- carriageway boundary ring -------------------------------------------
  const pushArm = (a) => {
    const idxList = armCarriageIndices(a.profile, a.end);
    const row = [];
    mb.setCtx(0, ctx.rpOf(a.edge.id), ctx.objId, 0);
    for (const pi of idxList) {
      const p = armWorld(a, pi);
      const pt = a.profile.pts[pi];
      mb.setCtx(pt.mat, ctx.rpOf(a.edge.id), ctx.objId, 1);
      const idx = mb.weld(armKey(a, pi), p, [pt.uv, 0], [pt.u, 0, ctx.wear, 1]);
      row.push({ idx, p });
      ring.push({ idx, p });
    }
    return row;
  };

  const capMat = MAT.ASPHALT;
  if (plan.mode === 'endcap') {
    const a = arms[0];
    pushArm(a);
    const samples = endCapSamples(plan);
    const base = armWorld(a, a.profile.cwFrom)[1];
    const run = [];
    for (let i = 1; i < samples.length - 1; i++) {
      const s = samples[i];
      mb.setCtx(capMat, ctx.rpOf(a.edge.id), ctx.objId, 1);
      const p = [s.p[0], base, s.p[1]];
      const idx = mb.vert(p, [0, 0], [0, 0, ctx.wear, 1]);
      ring.push({ idx, p });
      run.push({ idx, p, out: s.out, t: i / (samples.length - 1) });
    }
    cornerRuns.push({
      run, hi: a, lo: a, hiSide: 'right', loSide: 'left',
      first: { a, side: 'right' }, last: { a, side: 'left' },
      samples,
    });
  } else {
    for (let k = 0; k < arms.length; k++) {
      const hi = arms[k];
      const lo = arms[(k + 1) % arms.length];
      pushArm(hi);
      const corner = plan.corners[k];
      const samples = cornerSamples(plan, corner);
      const hHi = armWorld(hi, hi.end === 0 ? hi.profile.cwTo : hi.profile.cwFrom)[1];
      const hLo = armWorld(lo, lo.end === 0 ? lo.profile.cwFrom : lo.profile.cwTo)[1];
      const run = [];
      for (let i = 1; i < samples.length - 1; i++) {
        const t = i / (samples.length - 1);
        const s = samples[i];
        const y = hHi + (hLo - hHi) * t;
        mb.setCtx(capMat, ctx.rpOf(hi.edge.id), ctx.objId, 1);
        const p = [s.p[0], y, s.p[1]];
        const idx = mb.vert(p, [0, 0], [0, 0, ctx.wear, 1]);
        ring.push({ idx, p });
        run.push({ idx, p, out: s.out, t });
      }
      cornerRuns.push({
        run, samples,
        first: { a: hi, side: 'right' }, last: { a: lo, side: 'left' },
      });
    }
  }

  if (ring.length < 4) return null;

  // --- orientation ----------------------------------------------------------
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i].p, q = ring[(i + 1) % ring.length].p;
    area += p[0] * q[2] - q[0] * p[2];
  }
  const flip = area > 0; // +Y normals need negative shoelace in (x,z)

  // --- concentric quad rings ------------------------------------------------
  const N = ring.length;
  let cx = 0, cz = 0, cy = 0;
  for (const r of ring) { cx += r.p[0]; cz += r.p[2]; cy += r.p[1]; }
  cx /= N; cz /= N; cy /= N;
  // Centre height: the crown of the arms continues through the junction.
  let crownY = -Infinity;
  for (const a of arms) {
    const s = a.end === 0 ? a.trim : a.curve.length - a.trim;
    const fr = a.curve.frameAt(s);
    crownY = Math.max(crownY, fr.p[1] + 0.004);
  }
  if (!isFinite(crownY)) crownY = cy;
  const centreY = Math.max(cy + 0.004, Math.min(crownY, cy + 0.09));

  let radius = 0;
  for (const r of ring) radius = Math.max(radius, Math.hypot(r.p[0] - cx, r.p[2] - cz));
  const layers = clamp(Math.round(radius / 2.6), 2, 5);
  const rings = [ring.map((r) => ({ idx: r.idx, p: r.p.slice(), fixed: true }))];
  for (let L = 1; L <= layers; L++) {
    const t = L / layers;
    // stop the uniform bands at ~46% radius; the reduction bands take over
    const k = 1 - smoothstep(t) * 0.54;
    const row = [];
    for (let i = 0; i < N; i++) {
      const b = ring[i].p;
      const x = cx + (b[0] - cx) * k;
      const z = cz + (b[2] - cz) * k;
      const y = b[1] + (centreY - b[1]) * smoothstep(Math.min(1, t * 1.35));
      row.push({ idx: -1, p: [x, y, z], fixed: false });
    }
    rings.push(row);
  }
  // Laplacian relax (boundary pinned) so concave junctions stay tidy.
  for (let it = 0; it < 4; it++) {
    for (let L = 1; L < rings.length; L++) {
      const cur = rings[L], inner = rings[Math.min(L + 1, rings.length - 1)], outer = rings[L - 1];
      for (let i = 0; i < N; i++) {
        const a = cur[(i + N - 1) % N].p, b = cur[(i + 1) % N].p;
        const o = outer[i].p, n = inner[i].p;
        const w = 0.5;
        cur[i].p[0] = cur[i].p[0] * (1 - w) + ((a[0] + b[0] + o[0] + n[0]) / 4) * w;
        cur[i].p[2] = cur[i].p[2] * (1 - w) + ((a[2] + b[2] + o[2] + n[2]) / 4) * w;
        cur[i].p[1] = cur[i].p[1] * (1 - w) + ((a[1] + b[1] + o[1] + n[1]) / 4) * w;
      }
    }
  }
  // Emit interior vertices.
  mb.setCtx(capMat, ctx.rpJunction, ctx.objId, 1);
  for (let L = 1; L < rings.length; L++) {
    for (let i = 0; i < N; i++) {
      const p = rings[L][i].p;
      rings[L][i].idx = mb.vert(p, [p[0] * 0.2, p[2] * 0.2], [0, 0, ctx.wear * 1.1, 1]);
    }
  }
  const quad = (a, b, c, d) => (flip ? mb.quad(d, c, b, a) : mb.quad(a, b, c, d));
  for (let L = 0; L < rings.length - 1; L++) {
    const A = rings[L], B = rings[L + 1];
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      quad(A[i].idx, A[j].idx, B[j].idx, B[i].idx);
    }
  }
  // Centre: step the ring count down with all-quad 2:1 reduction bands so the
  // middle of the junction is a low-valence quad fan, not a 150-ray pole.
  let inner = rings[rings.length - 1].map((r) => ({ idx: r.idx, p: r.p.slice() }));
  let guard = 0;
  while (inner.length > 34 && guard++ < 5) {
    inner = reduceRing(mb, inner, [cx, centreY, cz], quad, ctx);
  }
  const M = inner.length;
  const cIdx = mb.vert([cx, centreY, cz], [cx * 0.2, cz * 0.2], [0, 0, ctx.wear, 1]);
  const mids = [];
  for (let i = 0; i < M; i++) {
    const j = (i + 1) % M;
    const a = inner[i].p, b = inner[j].p;
    const mp = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    mids.push(mb.vert(mp, [mp[0] * 0.2, mp[2] * 0.2], [0, 0, ctx.wear, 1]));
  }
  for (let i = 0; i < M; i++) {
    const prev = (i + M - 1) % M;
    quad(inner[i].idx, mids[i], cIdx, mids[prev]);
  }

  // --- kerb + footway corner sweeps ----------------------------------------
  for (const cr of cornerRuns) {
    sweepCornerStack(cr, plan, ctx, armWorld, armKey, flip);
  }

  plan.ringPoints = ring.map((r) => r.p);
  plan.centre = [cx, centreY, cz];
  plan.radiusApprox = radius;
  return { ring, centre: [cx, centreY, cz] };
}

/** Sweep the 8-entry kerb stack around a corner, welding to both road ends. */
function sweepCornerStack(cr, plan, ctx, armWorld, armKey, flip) {
  const { mb } = ctx;
  const A = cr.first.a, B = cr.last.a;
  const stackA = armStackIndices(A.profile, A.end, cr.first.side);
  const stackB = armStackIndices(B.profile, B.end, cr.last.side);
  // Offsets relative to the kerb-face-bottom entry (inner, index 0 of stack).
  const offs = (prof, stack) => {
    const base = prof.pts[stack[0]];
    return stack.map((pi) => {
      const pt = prof.pts[pi];
      return { du: Math.abs(pt.u - base.u), dh: pt.h - base.h, mat: pt.mat, dyn: pt.dyn, uv: pt.uv, kind: pt.kind };
    });
  };
  const oa = offs(A.profile, stackA);
  const ob = offs(B.profile, stackB);

  const rows = [];
  // start row = arm A's existing stack vertices (welded)
  rows.push(stackA.map((pi) => ({ idx: mb.weld(armKey(A, pi), armWorld(A, pi), [A.profile.pts[pi].uv, 0], [A.profile.pts[pi].u, 0, ctx.wear, 1], { mat: A.profile.pts[pi].mat, rp: ctx.rpOf(A.edge.id), obj: ctx.objId, flg: 1 }) })));

  for (const s of cr.run) {
    const t = smoothstep(s.t);
    const row = [];
    for (let k = 0; k < STACK; k++) {
      const du = oa[k].du + (ob[k].du - oa[k].du) * t;
      const dh = oa[k].dh + (ob[k].dh - oa[k].dh) * t;
      const mat = t < 0.5 ? oa[k].mat : ob[k].mat;
      const x = s.p[0] + s.out[0] * du;
      const z = s.p[2] + s.out[1] * du;
      let y = s.p[1] + dh;
      if (oa[k].dyn === 'ground' || ob[k].dyn === 'ground') y = ctx.groundAt(x, z);
      mb.setCtx(mat, ctx.rpJunction, ctx.objId, 1);
      row.push({ idx: mb.vert([x, y, z], [oa[k].uv + (ob[k].uv - oa[k].uv) * t, 0], [du, 0, ctx.wear, 0]) });
    }
    rows.push(row);
  }
  rows.push(stackB.map((pi) => ({ idx: mb.weld(armKey(B, pi), armWorld(B, pi), [B.profile.pts[pi].uv, 0], [B.profile.pts[pi].u, 0, ctx.wear, 1], { mat: B.profile.pts[pi].mat, rp: ctx.rpOf(B.edge.id), obj: ctx.objId, flg: 1 }) })));

  // A strip exists only where the profile bridges (skips material seams).
  const live = [];
  for (let k = 0; k < STACK - 1; k++) {
    const hiIdx = Math.max(stackA[k], stackA[k + 1]);
    live.push(!!A.profile.pts[hiIdx].bridge);
  }
  for (let r = 0; r < rows.length - 1; r++) {
    const P = rows[r], Q = rows[r + 1];
    for (let k = 0; k < STACK - 1; k++) {
      if (!live[k]) continue;
      if (flip) mb.quad(P[k].idx, Q[k].idx, Q[k + 1].idx, P[k + 1].idx);
      else mb.quad(P[k].idx, P[k + 1].idx, Q[k + 1].idx, Q[k].idx);
    }
  }
}

/**
 * All-quad 2:1 ring reduction. Each inner edge absorbs two outer edges through
 * one intermediate vertex (three outer edges once, when the count is odd), so
 * the ring halves without a single triangle and without a high-valence pole.
 */
function reduceRing(mb, cur, c, quad, ctx) {
  const n = cur.length;
  const m = Math.floor(n / 2);
  if (m < 6) return cur;
  const extra = n - m * 2;                 // 0 or 1 leftover edge
  const shrink = 0.74;
  const place = (p) => [
    c[0] + (p[0] - c[0]) * shrink,
    p[1] + (c[1] - p[1]) * 0.42,
    c[2] + (p[2] - c[2]) * shrink,
  ];
  const starts = [];
  let i = 0;
  for (let k = 0; k < m; k++) {
    starts.push(i);
    i += 2 + (k === m - 1 ? extra : 0);
  }
  const inner = starts.map((s) => {
    const p = place(cur[s].p);
    return { idx: mb.vert(p, [p[0] * 0.2, p[2] * 0.2], [0, 0, ctx.wear, 1]), p };
  });
  for (let k = 0; k < m; k++) {
    const s = starts[k];
    const g = 2 + (k === m - 1 ? extra : 0);
    const b0 = inner[k], b1 = inner[(k + 1) % m];
    let prevIdx = b0.idx;
    for (let e = 0; e < g; e++) {
      const a0 = cur[(s + e) % n], a1 = cur[(s + e + 1) % n];
      let nextIdx;
      if (e === g - 1) {
        nextIdx = b1.idx;
      } else {
        const t = (e + 1) / g;
        const bx = b0.p[0] + (b1.p[0] - b0.p[0]) * t;
        const by = b0.p[1] + (b1.p[1] - b0.p[1]) * t;
        const bz = b0.p[2] + (b1.p[2] - b0.p[2]) * t;
        const o = a1.p;
        const mp = [bx * 0.66 + o[0] * 0.34, by * 0.66 + o[1] * 0.34, bz * 0.66 + o[2] * 0.34];
        nextIdx = mb.vert(mp, [mp[0] * 0.2, mp[2] * 0.2], [0, 0, ctx.wear, 1]);
      }
      quad(a0.idx, a1.idx, nextIdx, prevIdx);
      prevIdx = nextIdx;
    }
  }
  return inner;
}
