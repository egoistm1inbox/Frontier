// RoadForge — network → geometry.
//
// Sweeps every edge between its junction trims as a structured quad grid,
// welds the first/last cross-section into the junction caps, applies surface
// features (speed tables, potholes, excavations) and raises structures
// (viaducts, retaining walls, portals) where the alignment leaves grade.

import { MeshBuilder } from '../core/mesh.js';
import { clamp, lerp, smoothstep, mulberry32, RNG } from '../core/math.js';
import { MAT } from './materials.js';
import { buildProfile } from './profile.js';
import { buildCurves } from './curve.js';
import { planNetwork, buildJunction } from './junction.js';
import { ROAD_CLASSES } from './network.js';

export const RP_FLOATS = 16;

export const FLAG = {
  CENTER_DOUBLE: 1 << 0,
  CENTER_DASH: 1 << 1,
  EDGE_LINES: 1 << 2,
  CROSS_A: 1 << 3,
  CROSS_B: 1 << 4,
  STOP_A: 1 << 5,
  STOP_B: 1 << 6,
  PARK_L: 1 << 7,
  PARK_R: 1 << 8,
  JUNCTION: 1 << 9,
  YELLOW: 1 << 10,
  ARROW_A: 1 << 11,
  ARROW_B: 1 << 12,
  BIKE_L: 1 << 13,
  BIKE_R: 1 << 14,
  RAIL: 1 << 15,
  HATCH: 1 << 16,
  ONEWAY: 1 << 17,
};

const classId = (cls) => ['highway', 'arterial', 'street', 'residential', 'alley', 'ramp', 'rail'].indexOf(cls);

export function flatGround() { return 0; }

/** Deterministic surface-damage field for an edge. */
function damageField(edge, seedBase) {
  const rnd = new RNG((seedBase ^ hashStr(edge.id)) >>> 0);
  const potholes = [];
  const n = Math.round(edge.potholes * 14);
  for (let i = 0; i < n; i++) {
    potholes.push({
      s: rnd.f(0.04, 0.96),
      u: rnd.f(-1, 1),
      r: rnd.f(0.22, 0.75),
      d: rnd.f(0.03, 0.12),
      e: rnd.f(0.6, 1.4),
    });
  }
  const patches = [];
  const np = Math.round(edge.patches * 7);
  for (let i = 0; i < np; i++) {
    patches.push({
      s: rnd.f(0.02, 0.98), hs: rnd.f(0.6, 4.5),
      u: rnd.f(-1, 1), hu: rnd.f(0.6, 2.4),
      k: rnd.f(0.4, 1),
    });
  }
  return { potholes, patches };
}

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* ------------------------------------------------------------------ main */

export function buildNetwork(net, opts = {}) {
  const t0 = performance.now();
  const quality = opts.quality ?? 1;            // 0 draft, 1 standard, 2 high
  const groundAt = opts.groundAt || flatGround;
  const seed = opts.seed ?? 1337;
  const mb = new MeshBuilder('road-network');

  const profiles = new Map();
  for (const e of net.edges.values()) profiles.set(e.id, buildProfile(e, net));
  const curves = buildCurves(net);
  const { plans, trims } = planNetwork(net, profiles, curves, opts);

  // ---- road parameter table ------------------------------------------------
  const rpList = [];
  const rpIndex = new Map();
  const pushRP = (key, vals) => {
    const i = rpList.length;
    rpList.push(vals);
    rpIndex.set(key, i);
    return i;
  };
  const objects = [];
  const objIndex = new Map();
  const objFor = (type, id, name, extra) => {
    if (objIndex.has(id)) return objIndex.get(id);
    const oid = objects.length + 1;
    objects.push({ oid, type, id, name, ...extra });
    objIndex.set(id, oid);
    return oid;
  };

  for (const e of net.edges.values()) {
    const prof = profiles.get(e.id);
    const c = curves.get(e.id);
    const ta = trims.get(`${e.id}:0`) || 0;
    const tb = trims.get(`${e.id}:1`) || 0;
    const degA = net.degree(e.a), degB = net.degree(e.b);
    let flags = 0;
    const def = ROAD_CLASSES[e.cls];
    const mk = def.markings || {};
    if (e.cls === 'rail') flags |= FLAG.RAIL;
    else {
      if (e.lanesF > 0 && e.lanesB > 0) {
        if (mk.centerDouble && e.medianW < 0.2) flags |= FLAG.CENTER_DOUBLE;
        else if (e.medianW < 0.2) flags |= FLAG.CENTER_DASH;
      }
      if (e.lanesB === 0) flags |= FLAG.ONEWAY;
      if (mk.edgeLines) flags |= FLAG.EDGE_LINES;
      if (mk.yellowEdge) flags |= FLAG.YELLOW;
      if (e.parkingL > 0.2) flags |= FLAG.PARK_L;
      if (e.parkingR > 0.2) flags |= FLAG.PARK_R;
      if (e.bikeLaneL) flags |= FLAG.BIKE_L;
      if (e.bikeLaneR) flags |= FLAG.BIKE_R;
      if (e.medianW > 0.5 && e.median === 'painted') flags |= FLAG.HATCH;
      const nodeA = net.node(e.a), nodeB = net.node(e.b);
      const bigJ = (d, n) => d >= 3 && n.crosswalks !== false;
      if (bigJ(degA, nodeA) && e.cls !== 'highway') flags |= FLAG.CROSS_A | FLAG.STOP_A;
      if (bigJ(degB, nodeB) && e.cls !== 'highway') flags |= FLAG.CROSS_B | FLAG.STOP_B;
      if (degA >= 3 && e.cls !== 'highway' && (e.lanesF + e.lanesB) >= 3) flags |= FLAG.ARROW_A;
      if (degB >= 3 && e.cls !== 'highway' && (e.lanesF + e.lanesB) >= 3) flags |= FLAG.ARROW_B;
    }
    const span = Math.max(0.5, c.length - ta - tb);
    pushRP(e.id, [
      e.laneWidth, e.lanesF, e.lanesB, e.medianW / 2,
      prof.roadHalf, span, ta, flags,
      classId(e.cls), e.wear, clamp(1 - e.wear * 0.8, 0.15, 1), 2.6,
      e.parkingL, e.parkingR, c.length, 0,
    ]);
  }
  const rpJunction = pushRP('@junction', [3.4, 1, 1, 0, 8, 10, 0, FLAG.JUNCTION, 2, 0.5, 0.6, 0, 0, 0, 10, 0]);

  // ---- junction caps -------------------------------------------------------
  const junctionInfo = new Map();
  for (const plan of plans.values()) {
    if (plan.mode === 'none' || plan.mode === 'weld') continue;
    const oid = objFor('node', plan.node.id, plan.node.name || 'Junction', { degree: plan.arms.length });
    const res = buildJunction(plan, {
      mb, groundAt, objId: oid, rpJunction,
      rpOf: (eid) => rpIndex.get(eid) ?? 0,
      wear: 0.5,
    });
    if (res) junctionInfo.set(plan.node.id, res);
  }

  // ---- road sweeps ---------------------------------------------------------
  const boundaries = [];   // outer polylines for block fills
  const structures = [];
  for (const e of net.edges.values()) {
    const oid = objFor('edge', e.id, e.name || ROAD_CLASSES[e.cls].label, { cls: e.cls });
    sweepEdge({
      net, edge: e, mb, curve: curves.get(e.id), profile: profiles.get(e.id),
      trimA: trims.get(`${e.id}:0`) || 0, trimB: trims.get(`${e.id}:1`) || 0,
      plans, groundAt, quality, seed, objId: oid,
      rp: rpIndex.get(e.id) ?? 0, boundaries, structures,
    });
  }

  const mesh = mb.finish();
  const rpBuf = new Float32Array(rpList.length * RP_FLOATS);
  rpList.forEach((v, i) => rpBuf.set(v, i * RP_FLOATS));

  return {
    mesh, mb, profiles, curves, plans, trims, boundaries, structures,
    roadParams: rpBuf, rpIndex, objects, objIndex, junctionInfo,
    buildMs: performance.now() - t0,
  };
}

/* ------------------------------------------------------------- edge sweep */

function sweepEdge(a) {
  const {
    net, edge, mb, curve, profile, trimA, trimB, plans, groundAt, quality, seed,
    objId, rp, boundaries, structures,
  } = a;
  const s0 = trimA;
  const s1 = curve.length - trimB;
  if (s1 - s0 < 0.25) return;

  const dmg = damageField(edge, seed);
  const span = s1 - s0;

  // --- longitudinal sampling -------------------------------------------
  const baseStep = [3.2, 2.0, 1.25][quality] ?? 2.0;
  const samples = [];
  const add = (s) => { if (s > s0 + 1e-4 && s < s1 - 1e-4) samples.push(s); };
  let s = s0;
  while (s < s1) {
    const k = Math.abs(curve.curvature(s));
    const st = clamp(baseStep / (1 + k * 26), 0.45, baseStep);
    s += st;
    add(s);
  }
  // refine around features
  for (const b of edge.bumps || []) {
    const sc = s0 + b.s * span;
    for (let i = -8; i <= 8; i++) add(sc + i * 0.28);
  }
  for (const p of dmg.potholes) {
    const sc = s0 + p.s * span;
    for (let i = -3; i <= 3; i++) add(sc + i * (p.r * 0.55));
  }
  if (edge.construction) {
    for (const t of [edge.construction.s0, edge.construction.s1]) {
      const sc = s0 + t * span;
      for (let i = -2; i <= 2; i++) add(sc + i * 0.4);
    }
  }
  samples.push(s0, s1);
  samples.sort((x, y) => x - y);
  const rows = [samples[0]];
  for (const v of samples) if (v - rows[rows.length - 1] > 0.09) rows.push(v);
  if (rows[rows.length - 1] < s1 - 1e-4) rows.push(s1);

  // --- elevation mode per sample ----------------------------------------
  const pts = profile.pts;
  const nP = pts.length;
  const outerL = 0, outerR = nP - 1;
  const vergeL = 1, vergeR = nP - 2;

  const prevRowStore = [];
  let prevRow = null;
  const leftEdge = [], rightEdge = [], centreLine = [];
  const structSpans = [];
  let curMode = null, modeStart = 0;

  for (let ri = 0; ri < rows.length; ri++) {
    const sv = rows[ri];
    const fr = curve.frameAt(sv);
    const gy = groundAt(fr.p[0], fr.p[2]);
    const dy = fr.p[1] - gy;
    let mode = 'grade';
    if (edge.tunnel) mode = 'tunnel';
    else if (dy > 1.15 && edge.bridge !== 'never') mode = 'viaduct';
    else if (dy < -1.15) mode = 'trench';
    if (curMode === null) { curMode = mode; modeStart = sv; }
    else if (mode !== curMode) {
      structSpans.push({ mode: curMode, s0: modeStart, s1: sv });
      curMode = mode; modeStart = sv;
    }

    const row = new Array(nP);
    const mats = new Array(nP);
    const t = (sv - s0) / span;
    const blend = clamp(Math.min(sv - s0, s1 - sv) / 6, 0, 1); // ease structures at the ends

    for (let i = 0; i < nP; i++) {
      const pt = pts[i];
      let u = pt.u;
      let h = pt.h;
      let mat = pt.mat;
      let wear = edge.wear;

      if (pt.dyn === 'ground') {
        if (mode === 'viaduct') {
          const target = pts[i === outerL ? vergeL : vergeR];
          u = lerp(pt.u, target.u + (i === outerL ? -0.22 : 0.22), blend);
          h = lerp(gy - fr.p[1], target.h + 0.06, blend);
          mat = blend > 0.5 ? MAT.CONCRETE : pt.mat;
        } else if (mode === 'trench' || mode === 'tunnel') {
          const target = pts[i === outerL ? vergeL : vergeR];
          u = lerp(pt.u, target.u + (i === outerL ? -0.3 : 0.3), blend);
          h = gy - fr.p[1];
          mat = blend > 0.5 ? MAT.CONCRETE : pt.mat;
        } else {
          h = gy - fr.p[1];
        }
      } else if (pt.kind === 'verge' && (mode === 'viaduct' || mode === 'trench' || mode === 'tunnel')) {
        mat = blend > 0.5 ? MAT.CONCRETE : pt.mat;
      }

      // ---- carriageway features ----
      const isRoad = pt.kind === 'lane' || pt.kind === 'parking' || pt.kind === 'cycle'
        || pt.kind === 'channel' || pt.kind === 'channel-edge' || pt.kind === 'median-flat';
      let patch = 0;
      if (isRoad) {
        // speed tables / humps
        for (const b of edge.bumps || []) {
          const sc = s0 + b.s * span;
          const d = Math.abs(sv - sc);
          const halfLen = b.kind === 'table' ? 3.1 : 1.85;
          const hgt = b.kind === 'table' ? 0.095 : 0.085;
          if (d < halfLen) {
            let k;
            if (b.kind === 'table') k = smoothstep(clamp((halfLen - d) / 1.1, 0, 1));
            else k = Math.cos((d / halfLen) * Math.PI) * 0.5 + 0.5;
            let lateral = 1;
            if (b.kind === 'cushion') {
              const lu = Math.abs(Math.abs(u) - profile.roadHalf * 0.45);
              lateral = clamp(1 - (lu - 0.75) / 0.35, 0, 1);
            }
            h += hgt * k * lateral;
          }
        }
        // potholes
        for (const p of dmg.potholes) {
          const sc = s0 + p.s * span;
          const pu = p.u * (profile.roadHalf - 1.0);
          const dx = (sv - sc) / p.e, dz = (u - pu);
          const d = Math.hypot(dx, dz);
          if (d < p.r * 1.6) {
            const k = 1 - smoothstep(clamp(d / p.r, 0, 1));
            h -= p.d * k;
            wear = Math.max(wear, 0.55 + 0.45 * k);
          }
        }
        // resurfacing patches (shading only)
        for (const p of dmg.patches) {
          const sc = s0 + p.s * span;
          const pu = p.u * (profile.roadHalf - 0.8);
          if (Math.abs(sv - sc) < p.hs && Math.abs(u - pu) < p.hu) patch = Math.max(patch, p.k);
        }
        // excavation
        if (edge.construction) {
          const cs0 = s0 + edge.construction.s0 * span;
          const cs1 = s0 + edge.construction.s1 * span;
          const side = edge.construction.side || 1;
          const inSpan = sv > cs0 && sv < cs1;
          const inLane = side > 0 ? u > 0.3 : u < -0.3;
          if (inSpan && inLane) {
            const fade = clamp(Math.min(sv - cs0, cs1 - sv) / 1.6, 0, 1);
            h -= 0.07 * fade;
            mat = fade > 0.4 ? MAT.DIRT : MAT.ASPHALT_OLD;
            wear = 1;
          }
        }
      }

      const x = fr.p[0] + fr.right[0] * u;
      const z = fr.p[2] + fr.right[2] * u;
      const y = fr.p[1] + h;
      row[i] = { x, y, z, u, mat, wear, patch, uv: pt.uv };
      mats[i] = mat;
    }

    // --- emit vertices (welding the first/last rows into the junctions) ---
    const idxRow = new Array(nP);
    const isFirst = ri === 0, isLast = ri === rows.length - 1;
    const endNodeId = isFirst ? edge.a : edge.b;
    const plan = plans.get(endNodeId);
    for (let i = 0; i < nP; i++) {
      const r = row[i];
      mb.setCtx(r.mat, rp, objId, 0);
      const aux = [r.u, sv - s0, r.wear, r.patch];
      const uv = [r.uv, sv];
      let key = null;
      if ((isFirst || isLast) && plan) {
        if (plan.mode === 'cap' || plan.mode === 'endcap') key = `jn:${edge.id}:${isFirst ? 0 : 1}:${i}`;
        else if (plan.mode === 'weld') {
          const ref = plan.weldRef;
          const end = isFirst ? 0 : 1;
          const sameOrient = ref.edge.id === edge.id ? true : (ref.end === end);
          const slot = sameOrient ? i : nP - 1 - i;
          key = `nd:${endNodeId}:${slot}`;
        }
      }
      idxRow[i] = key ? mb.weld(key, [r.x, r.y, r.z], uv, aux) : mb.vert([r.x, r.y, r.z], uv, aux);
    }

    if (prevRow) {
      for (let i = 0; i < nP - 1; i++) {
        if (!pts[i + 1].bridge) continue;
        mb.quad(prevRow[i], idxRow[i], idxRow[i + 1], prevRow[i + 1]);
      }
    }
    prevRow = idxRow;
    prevRowStore.push(row);
    leftEdge.push([row[outerL].x, row[outerL].y, row[outerL].z]);
    rightEdge.push([row[outerR].x, row[outerR].y, row[outerR].z]);
    centreLine.push([fr.p[0], fr.p[1], fr.p[2], sv]);
  }
  structSpans.push({ mode: curMode, s0: modeStart, s1: rows[rows.length - 1] });

  boundaries.push({ edgeId: edge.id, left: leftEdge, right: rightEdge, centre: centreLine });
  for (const sp of structSpans) {
    if (sp.mode !== 'grade' && sp.s1 - sp.s0 > 1.0) {
      // es0/es1 are the trimmed edge bounds — structures/ re-derives the exact
      // same deck-edge easing from them so the fascia welds to the deck lip.
      structures.push({ edge, curve, profile, ...sp, es0: s0, es1: s1, objId, rp });
    }
  }
}
