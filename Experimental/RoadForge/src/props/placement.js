// RoadForge — prop placement.
//
// Walks the built network and decides where real-world street furniture goes:
// lighting columns on the verge, signal heads facing each approach, bollards
// guarding footways, guardrails on fast roads and viaducts, works kit inside
// construction zones, parked cars in marked bays, signs, trees and billboards.

import { RNG, clamp, m4, TAU } from '../core/math.js';
import { MAT } from '../road/materials.js';
import { PROP_NAMES } from './library.js';

export const VEHICLE_TYPES = [
  { name: 'car_sedan', n: 8 },
  { name: 'car_hatch', n: 6 },
  { name: 'car_suv', n: 5 },
  { name: 'van', n: 3 },
  { name: 'bus', n: 2 },
  { name: 'truck', n: 1 },
];
export const TRAIN_TYPES = [
  { name: 'train_loco', n: 2 },
  { name: 'train_coach', n: 8 },
];

export const INSTANCE_FLOATS = 24;

/** +X of the prop points along (dx,dz). */
export const rotForX = (dx, dz) => Math.atan2(-dz, dx);
/** +Z of the prop points along (dx,dz). */
export const rotForZ = (dx, dz) => Math.atan2(dx, dz);

export class InstanceSet {
  constructor() {
    this.byType = new Map();
    for (const n of PROP_NAMES) this.byType.set(n, []);
  }

  add(type, pos, rotY, scale = 1, color = [1, 1, 1, 0], parm = [0, -1, 0, 0]) {
    const list = this.byType.get(type);
    if (!list) return;
    const m = m4.trs(pos, rotY, Array.isArray(scale) ? scale : [scale, scale, scale]);
    list.push({ m, color, parm });
  }

  get total() {
    let n = 0;
    for (const l of this.byType.values()) n += l.length;
    return n;
  }

  /**
   * Pack into one buffer. Reserved dynamic slots are appended after the
   * statics so traffic can rewrite them every frame without touching props.
   */
  pack(reserve = []) {
    const draws = [];
    const slots = new Map();
    let total = this.total;
    for (const r of reserve) total += r.n;
    const data = new Float32Array(total * INSTANCE_FLOATS);
    let cursor = 0;
    for (const name of PROP_NAMES) {
      const list = this.byType.get(name);
      if (!list.length) continue;
      const first = cursor;
      for (const it of list) {
        const o = cursor * INSTANCE_FLOATS;
        data.set(it.m, o);
        data.set(it.color, o + 16);
        data.set(it.parm, o + 20);
        cursor++;
      }
      draws.push({ name, firstInstance: first, instanceCount: list.length });
    }
    for (const r of reserve) {
      slots.set(r.name, { first: cursor, max: r.n });
      draws.push({ name: r.name, firstInstance: cursor, instanceCount: 0, dynamic: true });
      cursor += r.n;
    }
    return { data, draws, slots, staticCount: this.total };
  }
}

/* ------------------------------------------------------------- placement */

export function placeProps(ctx) {
  const { net, build, opts = {} } = ctx;
  const rnd = new RNG((opts.seed || 1) ^ 0x51ed);
  const set = new InstanceSet();
  const lights = [];
  const groundAt = opts.groundAt || (() => 0);

  const density = opts.propDensity ?? 1;
  const lightOn = opts.lighting !== false;

  for (const edge of net.edges.values()) {
    const curve = build.curves.get(edge.id);
    const prof = build.profiles.get(edge.id);
    if (!curve || !prof) continue;
    const ta = build.trims.get(`${edge.id}:0`) || 0;
    const tb = build.trims.get(`${edge.id}:1`) || 0;
    const s0 = ta + 2.0;
    const s1 = curve.length - tb - 2.0;
    const len = s1 - s0;
    if (len < 6) continue;
    const cls = edge.cls;
    const outer = Math.abs(prof.pts[0].u);
    const walkU = prof.roadHalf + 0.17 + Math.max(0.3, edge.sidewalkL) * 0.45;
    const walkUR = prof.roadHalf + 0.17 + Math.max(0.3, edge.sidewalkR) * 0.45;
    const h = (fr, u) => groundAt(fr.p[0] + fr.right[0] * u, fr.p[2] + fr.right[2] * u);

    /* --- lighting --------------------------------------------------- */
    if (lightOn && cls !== 'rail') {
      const plan = {
        highway: { step: 48, mode: 'median', prop: 'lamp_motorway' },
        ramp: { step: 44, mode: 'right', prop: 'lamp_street' },
        arterial: { step: 33, mode: 'both', prop: 'lamp_street' },
        street: { step: 34, mode: 'alt', prop: 'lamp_street' },
        residential: { step: 38, mode: 'alt', prop: edge.heritage ? 'lamp_heritage' : 'lamp_street' },
        alley: { step: 0, mode: 'none', prop: 'lamp_street' },
      }[cls] || { step: 0, mode: 'none' };
      if (plan.step > 0) {
        const count = Math.max(1, Math.round(len / (plan.step / density)));
        for (let i = 0; i <= count; i++) {
          const s = s0 + (len * i) / count;
          if (s > s1) break;
          const fr = curve.frameAt(s);
          const sides = plan.mode === 'both' ? [-1, 1]
            : plan.mode === 'median' ? [0]
              : plan.mode === 'right' ? [1]
                : [i % 2 === 0 ? -1 : 1];
          for (const side of sides) {
            const u = side === 0 ? 0 : side * (side < 0 ? walkU : walkUR);
            const px = fr.p[0] + fr.right[0] * u;
            const pz = fr.p[2] + fr.right[2] * u;
            const py = side === 0 ? fr.p[1] + 0.2 : Math.max(groundAt(px, pz), fr.p[1] + prof.hKerbTop);
            // arm (+X) points toward the carriageway
            const toRoad = side === 0 ? 1 : -side;
            const rot = rotForX(fr.right[0] * toRoad, fr.right[2] * toRoad);
            const prop = plan.prop;
            set.add(prop, [px, py, pz], rot, 1, [1, 1, 1, 0], [0, -1, 1, 0]);
            const hh = prop === 'lamp_motorway' ? 12.0 : prop === 'lamp_heritage' ? 4.0 : 7.9;
            const reach = prop === 'lamp_motorway' ? 0 : 1.85;
            const lx = px + fr.right[0] * toRoad * reach;
            const lz = pz + fr.right[2] * toRoad * reach;
            if (prop === 'lamp_motorway') {
              for (const sg of [-1, 1]) {
                lights.push({
                  pos: [px + fr.right[0] * sg * 2.4, py + hh, pz + fr.right[2] * sg * 2.4],
                  range: 26, color: [1.0, 0.86, 0.66], intensity: 10, dir: [0, -1, 0], outer: 1.35, inner: 0.5, kind: 1,
                });
              }
            } else {
              lights.push({
                pos: [lx, py + hh, lz], range: prop === 'lamp_heritage' ? 13 : 21,
                color: prop === 'lamp_heritage' ? [1.0, 0.76, 0.46] : [1.0, 0.88, 0.70],
                intensity: prop === 'lamp_heritage' ? 4 : 8.5,
                dir: [0, -1, 0], outer: 1.38, inner: 0.55, kind: 1,
              });
            }
          }
        }
      }
    }

    /* --- parking bays ------------------------------------------------ */
    for (const side of [-1, 1]) {
      const bay = side < 0 ? edge.parkingL : edge.parkingR;
      if (bay < 1.6 || cls === 'rail') continue;
      const u = side * (prof.roadHalf - 0.42 - bay * 0.5);
      const step = 5.6;
      const n = Math.floor(len / step);
      for (let i = 0; i < n; i++) {
        if (!rnd.chance(0.52 * density)) continue;
        const s = s0 + step * (i + 0.5);
        const fr = curve.frameAt(s);
        const px = fr.p[0] + fr.right[0] * u;
        const pz = fr.p[2] + fr.right[2] * u;
        const dir = rnd.chance(0.5) ? 1 : -1;
        const rot = rotForZ(fr.t[0] * dir, fr.t[2] * dir);
        const type = rnd.pick(['car_sedan', 'car_hatch', 'car_suv', 'van']);
        set.add(type, [px, groundAt(px, pz), pz], rot + (rnd.f() - 0.5) * 0.06, 1,
          carColor(rnd), [0, -1, 0, 0]);
      }
      // parking meters on the footway
      const mstep = 17;
      for (let s = s0 + 6; s < s1 - 4; s += mstep) {
        const fr = curve.frameAt(s);
        const mu = side * (prof.roadHalf + 0.5);
        const px = fr.p[0] + fr.right[0] * mu;
        const pz = fr.p[2] + fr.right[2] * mu;
        set.add('meter', [px, fr.p[1] + prof.hKerbTop, pz],
          rotForX(-fr.right[0] * side, -fr.right[2] * side));
      }
    }

    /* --- bollards & footway furniture --------------------------------- */
    if (cls !== 'rail' && cls !== 'highway' && cls !== 'ramp') {
      const design = ['bollard_steel', 'bollard_granite', 'bollard_bell', 'bollard_lit'][
        Math.abs(hashStr(edge.id)) % 4];
      for (const side of [-1, 1]) {
        const sw = side < 0 ? edge.sidewalkL : edge.sidewalkR;
        if (sw < 1.4) continue;
        if (!rnd.chance(0.45)) continue;
        const u = side * (prof.roadHalf + 0.22 + sw * 0.25);
        const step = 2.6;
        const runs = Math.min(6, Math.floor(len / 24) + 1);
        for (let r = 0; r < runs; r++) {
          const base = s0 + (len * (r + 0.5)) / runs - step * 1.5;
          for (let i = 0; i < 4; i++) {
            const s = base + i * step;
            if (s < s0 || s > s1) continue;
            const fr = curve.frameAt(s);
            const px = fr.p[0] + fr.right[0] * u;
            const pz = fr.p[2] + fr.right[2] * u;
            set.add(design, [px, fr.p[1] + prof.hKerbTop, pz], rnd.f() * TAU);
            if (design === 'bollard_lit') {
              lights.push({
                pos: [px, fr.p[1] + prof.hKerbTop + 0.9, pz], range: 5,
                color: [0.9, 0.95, 1.0], intensity: 1.1, dir: null, kind: 2,
              });
            }
          }
        }
      }
      // trees / benches / bins on wide footways
      for (const side of [-1, 1]) {
        const sw = side < 0 ? edge.sidewalkL : edge.sidewalkR;
        if (sw < 2.0) continue;
        const step = 15 / density;
        for (let s = s0 + 7; s < s1 - 5; s += step) {
          const fr = curve.frameAt(s);
          const u = side * (prof.roadHalf + 0.2 + sw * 0.72);
          const px = fr.p[0] + fr.right[0] * u;
          const pz = fr.p[2] + fr.right[2] * u;
          const py = fr.p[1] + prof.hKerbTop;
          const r = rnd.f();
          if (r < 0.45) set.add('tree', [px, py, pz], rnd.f() * TAU, 0.85 + rnd.f() * 0.5);
          else if (r < 0.62) set.add('bench', [px, py, pz], rotForZ(fr.t[0], fr.t[2]));
          else if (r < 0.75) set.add('bin', [px, py, pz], rnd.f() * TAU);
          else if (r < 0.84) set.add('planter', [px, py, pz], rnd.f() * 0.4);
          else if (r < 0.9) set.add('hydrant', [px, py, pz], rnd.f() * TAU);
        }
      }
    }

    /* --- construction zone -------------------------------------------- */
    if (edge.construction) {
      const c = edge.construction;
      const cs0 = s0 + c.s0 * len;
      const cs1 = s0 + c.s1 * len;
      const side = c.side || 1;
      const u = side * (prof.roadHalf * 0.5);
      for (let s = cs0; s <= cs1; s += 2.4) {
        const fr = curve.frameAt(s);
        const taper = clamp(Math.min(s - cs0, cs1 - s) / 7, 0.2, 1);
        const uu = side * (prof.roadHalf * 0.08 + (prof.roadHalf * 0.9 - prof.roadHalf * 0.08) * (1 - taper));
        const px = fr.p[0] + fr.right[0] * uu;
        const pz = fr.p[2] + fr.right[2] * uu;
        set.add('cone', [px, groundAt(px, pz), pz], rnd.f() * TAU);
      }
      for (let s = cs0 + 1.2; s <= cs1 - 1.2; s += 2.4) {
        const fr = curve.frameAt(s);
        const px = fr.p[0] + fr.right[0] * u;
        const pz = fr.p[2] + fr.right[2] * u;
        set.add(rnd.chance(0.5) ? 'barrier_fence' : 'barrier_jersey',
          [px, groundAt(px, pz), pz], rotForZ(fr.t[0], fr.t[2]));
      }
      const fr0 = curve.frameAt(cs0 - 1.5);
      const p0 = [fr0.p[0] + fr0.right[0] * u, groundAt(fr0.p[0], fr0.p[2]), fr0.p[2] + fr0.right[2] * u];
      set.add('works_board', p0, rotForX(-fr0.t[0], -fr0.t[2]));
      lights.push({ pos: [p0[0], p0[1] + 2.0, p0[2]], range: 7, color: [1, 0.55, 0.05], intensity: 2.2, dir: null, kind: 3 });
      const frm = curve.frameAt((cs0 + cs1) / 2);
      const hu = side * (prof.roadHalf + 1.9);
      const hp = [frm.p[0] + frm.right[0] * hu, groundAt(frm.p[0], frm.p[2]), frm.p[2] + frm.right[2] * hu];
      if (cs1 - cs0 > 14) {
        set.add('site_hut', hp, rotForZ(frm.t[0], frm.t[2]));
        const pp = [frm.p[0] + frm.right[0] * (hu * 1.3), groundAt(frm.p[0], frm.p[2]), frm.p[2] + frm.right[2] * (hu * 1.3)];
        set.add('pipe_stack', pp, rotForZ(frm.t[0], frm.t[2]) + 0.3);
      }
    }

    /* --- speed-limit / warning signs ----------------------------------- */
    if (cls !== 'rail' && len > 30 && rnd.chance(0.5)) {
      const s = s0 + len * (0.2 + rnd.f() * 0.6);
      const fr = curve.frameAt(s);
      const side = rnd.chance(0.5) ? -1 : 1;
      const u = side * (prof.roadHalf + 0.9);
      const px = fr.p[0] + fr.right[0] * u;
      const pz = fr.p[2] + fr.right[2] * u;
      const face = -side;
      set.add(rnd.chance(0.6) ? 'sign_round' : 'sign_board', [px, groundAt(px, pz), pz],
        rotForZ(fr.right[0] * face, fr.right[2] * face));
    }

    /* --- billboards on fast roads --------------------------------------- */
    if ((cls === 'highway' || cls === 'arterial') && len > 70 && rnd.chance(0.55)) {
      const s = s0 + len * (0.3 + rnd.f() * 0.4);
      const fr = curve.frameAt(s);
      const side = rnd.chance(0.5) ? -1 : 1;
      const u = side * (outer + 7 + rnd.f() * 5);
      const px = fr.p[0] + fr.right[0] * u;
      const pz = fr.p[2] + fr.right[2] * u;
      const face = -side;
      set.add('billboard', [px, groundAt(px, pz), pz],
        rotForZ(fr.right[0] * face, fr.right[2] * face) + (rnd.f() - 0.5) * 0.3);
      lights.push({
        pos: [px + fr.right[0] * face * 0.5, groundAt(px, pz) + 7.6, pz + fr.right[2] * face * 0.5],
        range: 14, color: [0.95, 0.95, 1.0], intensity: 3.4,
        dir: [fr.right[0] * face * 0.4, -1, fr.right[2] * face * 0.4], outer: 1.1, inner: 0.4, kind: 4,
      });
    }
  }

  /* --- junction signals ------------------------------------------------- */
  for (const [nodeId, plan] of build.plans) {
    const node = net.node(nodeId);
    if (!node) continue;
    const arms = plan.arms || [];
    if (arms.length < 3) continue;
    const ranks = arms.map((a) => a.edge.cls);
    const major = ranks.some((c) => c === 'arterial' || c === 'highway');
    let kind = node.signals;
    if (kind === 'auto') kind = major && arms.length >= 3 ? 'signals' : (arms.length > 3 ? 'signals' : 'stop');
    if (kind === 'none' || kind === 'roundabout') continue;
    for (const arm of arms) {
      const prof = build.profiles.get(arm.edge.id);
      if (!prof) continue;
      const d = [arm.dir[0], 0, arm.dir[1]];
      const right = [d[2], 0, -d[0]];
      const back = (arm.trim || 6) + 2.6;
      const u = prof.roadHalf + 1.0;
      const px = node.x + d[0] * back + right[0] * u;
      const pz = node.z + d[2] * back + right[2] * u;
      const py = groundAt(px, pz);
      // the mast arm (+X) must reach over the carriageway: toward -right
      const rot = rotForX(-right[0], -right[2]);
      if (kind === 'signals') {
        set.add(major ? 'signal_mast' : 'signal_post', [px, py, pz], rot, 1, [1, 1, 1, 0],
          [0, -1, 0, 0]);
        lights.push({
          pos: [px - right[0] * 3.3, py + 4.4, pz - right[2] * 3.3],
          range: 7, color: [1.0, 0.3, 0.12], intensity: 1.4, dir: null, kind: 5,
        });
      } else {
        set.add('sign_round', [px, py, pz], rotForZ(-d[0], -d[2]));
      }
      if (node.crosswalks && prof.roadHalf > 3.2) {
        const pu = prof.roadHalf + 0.55;
        for (const sg of [-1, 1]) {
          const qx = node.x + d[0] * (back - 1.4) + right[0] * pu * sg;
          const qz = node.z + d[2] * (back - 1.4) + right[2] * pu * sg;
          set.add('signal_ped', [qx, groundAt(qx, qz), qz], rotForX(-right[0] * sg, -right[2] * sg));
        }
      }
    }
  }

  return { set, lights };
}

function carColor(rnd) {
  const palette = [
    [0.52, 0.53, 0.55], [0.03, 0.03, 0.035], [0.72, 0.72, 0.73], [0.08, 0.1, 0.16],
    [0.26, 0.03, 0.03], [0.02, 0.08, 0.05], [0.3, 0.32, 0.36], [0.55, 0.42, 0.1],
    [0.1, 0.18, 0.3], [0.62, 0.6, 0.55],
  ];
  const c = rnd.pick(palette);
  return [c[0], c[1], c[2], 0];
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h | 0;
}

/* ----------------------------------------------------------- guardrails */

/**
 * Swept W-beam / parapet railing along an edge boundary. Emitted as real
 * geometry into the road mesh so it curves with the road.
 */
export function buildRailings(mb, net, build, opts = {}) {
  const groundAt = opts.groundAt || (() => 0);
  let runs = 0;
  for (const edge of net.edges.values()) {
    const curve = build.curves.get(edge.id);
    const prof = build.profiles.get(edge.id);
    if (!curve || !prof) continue;
    const ta = build.trims.get(`${edge.id}:0`) || 0;
    const tb = build.trims.get(`${edge.id}:1`) || 0;
    const s0 = ta + 1.2;
    const s1 = curve.length - tb - 1.2;
    if (s1 - s0 < 8) continue;

    const elevated = [];
    for (const sp of build.structures) {
      if (sp.edge.id === edge.id && (sp.mode === 'viaduct' || sp.mode === 'trench')) {
        elevated.push([Math.max(sp.s0, s0), Math.min(sp.s1, s1)]);
      }
    }
    const wantGuard = edge.guardrail || edge.cls === 'highway' || edge.cls === 'ramp';
    const spans = [];
    if (elevated.length) for (const e of elevated) spans.push({ a: e[0], b: e[1], type: 'parapet' });
    else if (wantGuard) spans.push({ a: s0, b: s1, type: 'wbeam' });
    if (!spans.length) continue;

    for (const sp of spans) {
      if (sp.b - sp.a < 6) continue;
      for (const side of [-1, 1]) {
        const u = side * (Math.abs(prof.pts[side < 0 ? 0 : prof.pts.length - 1].u) - 0.28);
        railingRun(mb, curve, sp, u, side, prof, sp.type, groundAt);
        runs++;
      }
    }
  }
  return runs;
}

function railingRun(mb, curve, sp, u, side, prof, type, groundAt) {
  const step = 1.6;
  const n = Math.max(2, Math.ceil((sp.b - sp.a) / step));
  const rows = [];
  for (let i = 0; i <= n; i++) rows.push(curve.frameAt(sp.a + ((sp.b - sp.a) * i) / n));

  const sections = type === 'parapet'
    ? [[0.0, 0.0], [0.0, 1.12], [0.07, 1.12], [0.07, 0.0]]
    : [[0.0, 0.52], [0.045, 0.56], [0.045, 0.66], [0.0, 0.70], [0.0, 0.80], [0.045, 0.84], [0.045, 0.94], [0.0, 0.98]];

  mb.setCtx(type === 'parapet' ? MAT.CONCRETE : MAT.STEEL, 0, 0, 0);
  let prev = null;
  for (const fr of rows) {
    const base = prof.hKerbTop;
    const idx = sections.map((s, k) => {
      const uu = u + s[0] * -side;
      return mb.vert([
        fr.p[0] + fr.right[0] * uu,
        fr.p[1] + base + s[1],
        fr.p[2] + fr.right[2] * uu,
      ], [k * 0.3, fr.s * 0.3], [uu, fr.s, 0.1, 0]);
    });
    if (prev) for (let k = 0; k < idx.length - 1; k++) mb.quad(prev[k], prev[k + 1], idx[k + 1], idx[k]);
    prev = idx;
  }

  // posts
  if (type !== 'parapet') {
    mb.setCtx(MAT.STEEL, 0, 0, 0);
    for (let s = sp.a; s <= sp.b; s += 3.2) {
      const fr = curve.frameAt(s);
      const px = fr.p[0] + fr.right[0] * u;
      const pz = fr.p[2] + fr.right[2] * u;
      const y0 = Math.min(groundAt(px, pz), fr.p[1] + prof.hKerbTop);
      const y1 = fr.p[1] + prof.hKerbTop + 1.0;
      postBox(mb, px, pz, y0, y1, 0.09, 0.14, Math.atan2(fr.right[0], fr.right[2]));
    }
  } else {
    // parapet handrail
    mb.setCtx(MAT.STEEL, 0, 0, 0);
    let prevR = null;
    for (const fr of rows) {
      const uu = u + 0.035 * -side;
      const yb = fr.p[1] + prof.hKerbTop + 1.12;
      const ring = [];
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU;
        ring.push(mb.vert([
          fr.p[0] + fr.right[0] * (uu + Math.cos(a) * 0.055),
          yb + 0.055 + Math.sin(a) * 0.055,
          fr.p[2] + fr.right[2] * (uu + Math.cos(a) * 0.055),
        ], [k / 6, fr.s * 0.3], [0, 0, 0, 0]));
      }
      if (prevR) for (let k = 0; k < 6; k++) mb.quad(prevR[k], prevR[(k + 1) % 6], ring[(k + 1) % 6], ring[k]);
      prevR = ring;
    }
  }
}

function postBox(mb, x, z, y0, y1, hw, hd, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const P = (sx, sz, y) => [x + sx * hw * c + sz * hd * s, y, z - sx * hw * s + sz * hd * c];
  const sgn = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const bot = sgn.map(([a, b]) => mb.vert(P(a, b, y0), [0, 0], [0, 0, 0, 0]));
  const top = sgn.map(([a, b]) => mb.vert(P(a, b, y1), [1, 1], [0, 0, 0, 0]));
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    mb.quad(bot[i], bot[j], top[j], top[i]);
  }
  mb.quad(top[0], top[1], top[2], top[3]);
}
