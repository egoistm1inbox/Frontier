// RoadForge — lane graph + AI traffic.
//
// A directed lane graph is derived from the built network: every running lane
// of every edge becomes a strand, and junction plans become spline connectors
// between them. Vehicles drive it with intelligent-driver-model following,
// signal obedience and a junction reservation lock, so nothing ever drives
// through anything else. Hard cap: 25 vehicles.

import { RNG, clamp, m4, bez3, bez3d } from '../core/math.js';
import { VEHICLE_TYPES, rotForZ } from '../props/placement.js';

export const MAX_VEHICLES = 25;

const CLASS_SPEED = {
  highway: 31, arterial: 15.5, street: 12.5, residential: 8.5, alley: 6, ramp: 16, rail: 24,
};

/* ------------------------------------------------------------ lane graph */

export function buildLaneGraph(net, build) {
  const lanes = [];
  const byEdge = new Map();

  for (const edge of net.edges.values()) {
    if (edge.cls === 'rail') continue;
    const curve = build.curves.get(edge.id);
    const prof = build.profiles.get(edge.id);
    if (!curve || !prof) continue;
    const ta = build.trims.get(`${edge.id}:0`) || 0;
    const tb = build.trims.get(`${edge.id}:1`) || 0;
    const sA = ta;
    const sB = curve.length - tb;
    if (sB - sA < 3) continue;
    const mHalf = edge.medianW > 0.1 ? edge.medianW / 2 : 0;
    const maxU = prof.roadHalf - 0.45;
    const group = [];
    const mk = (dir, i) => {
      const off = mHalf + edge.laneWidth * (i + 0.5);
      if (off > maxU + 0.4) return null;
      const u = Math.min(off, maxU) * dir;
      const lane = {
        id: `${edge.id}:${dir > 0 ? 'f' : 'b'}${i}`,
        kind: 'lane', edge, curve, prof, dir, index: i, u,
        sA, sB, length: sB - sA,
        from: dir > 0 ? edge.a : edge.b,
        to: dir > 0 ? edge.b : edge.a,
        speed: CLASS_SPEED[edge.cls] ?? 12,
        conns: [],
      };
      lanes.push(lane);
      group.push(lane);
      return lane;
    };
    for (let i = 0; i < Math.max(0, edge.lanesF); i++) mk(1, i);
    for (let i = 0; i < Math.max(0, edge.lanesB); i++) mk(-1, i);
    byEdge.set(edge.id, group);
  }

  /** world point + heading on a lane at distance d from its entry. */
  const laneAt = (lane, d) => {
    const s = lane.dir > 0 ? lane.sA + d : lane.sB - d;
    const fr = lane.curve.frameAt(clamp(s, 0, lane.curve.length));
    const hx = fr.t[0] * lane.dir, hz = fr.t[2] * lane.dir;
    return {
      x: fr.p[0] + fr.right[0] * lane.u,
      y: fr.p[1] + 0.02,
      z: fr.p[2] + fr.right[2] * lane.u,
      hx, hz,
    };
  };

  // --- junction connectors
  const conns = [];
  const nodeArms = new Map();
  for (const node of net.nodes.values()) {
    const incoming = lanes.filter((l) => l.to === node.id);
    const outgoing = lanes.filter((l) => l.from === node.id);
    if (!incoming.length || !outgoing.length) continue;
    for (const inL of incoming) {
      const a = laneAt(inL, inL.length);
      for (const outL of outgoing) {
        if (outL.edge.id === inL.edge.id) continue;      // no U-turns
        const b = laneAt(outL, 0);
        const dot = a.hx * b.hx + a.hz * b.hz;
        if (dot < -0.72) continue;                        // too sharp
        const d = Math.hypot(b.x - a.x, b.z - a.z);
        if (d > 90) continue;
        const k = clamp(d * 0.42, 1.2, 26);
        const p0 = [a.x, a.y, a.z];
        const p1 = [a.x + a.hx * k, a.y, a.z + a.hz * k];
        const p2 = [b.x - b.hx * k, b.y, b.z - b.hz * k];
        const p3 = [b.x, b.y, b.z];
        // arc length
        let L = 0;
        let prev = p0;
        const N = 10;
        const tbl = [0];
        for (let i = 1; i <= N; i++) {
          const q = bez3(p0, p1, p2, p3, i / N);
          L += Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2]);
          tbl.push(L);
          prev = q;
        }
        const turn = Math.atan2(a.hx * b.hz - a.hz * b.hx, dot);
        const conn = {
          id: `${inL.id}>${outL.id}`, kind: 'conn', node, from: inL, to: outL,
          p0, p1, p2, p3, length: Math.max(L, 0.5), tbl, N,
          turn,
          speed: Math.min(inL.speed, outL.speed) * (Math.abs(turn) > 0.5 ? 0.45 : 0.8),
          conns: [],
        };
        conns.push(conn);
        inL.conns.push(conn);
      }
    }
    nodeArms.set(node.id, { incoming, outgoing });
  }

  const connAt = (conn, d) => {
    const t = paramAt(conn, d);
    const p = bez3(conn.p0, conn.p1, conn.p2, conn.p3, t);
    const dv = bez3d(conn.p0, conn.p1, conn.p2, conn.p3, t);
    const l = Math.hypot(dv[0], dv[2]) || 1;
    return { x: p[0], y: p[1], z: p[2], hx: dv[0] / l, hz: dv[2] / l };
  };

  return { lanes, conns, byEdge, nodeArms, laneAt, connAt, posAt: (el, d) => (el.kind === 'lane' ? laneAt(el, d) : connAt(el, d)) };
}

function paramAt(conn, d) {
  const { tbl, N } = conn;
  const x = clamp(d, 0, conn.length);
  let i = 1;
  while (i < tbl.length && tbl[i] < x) i++;
  const s0 = tbl[i - 1], s1 = tbl[Math.min(i, tbl.length - 1)];
  const f = s1 > s0 ? (x - s0) / (s1 - s0) : 0;
  return clamp((i - 1 + f) / N, 0, 1);
}

/* --------------------------------------------------------------- signals */

export class SignalController {
  constructor(net, build) {
    this.nodes = new Map();
    for (const [nodeId, plan] of build.plans) {
      const node = net.node(nodeId);
      if (!node || (plan.arms || []).length < 3) continue;
      let kind = node.signals;
      const major = plan.arms.some((a) => a.edge.cls === 'arterial' || a.edge.cls === 'highway');
      if (kind === 'auto') kind = (major || plan.arms.length > 3) ? 'signals' : 'stop';
      if (kind !== 'signals') continue;
      const base = Math.abs(hash(nodeId)) % 1000 / 1000;
      this.nodes.set(nodeId, {
        node, groups: plan.arms.map((a) => groupOf(a.angle)),
        arms: plan.arms, period: 26 + (Math.abs(hash(nodeId)) % 7), offset: base * 26,
      });
    }
  }

  /** 'green' | 'amber' | 'red' for an approach direction at a node. */
  state(nodeId, hx, hz, time) {
    const S = this.nodes.get(nodeId);
    if (!S) return 'none';
    const ang = Math.atan2(hz, hx);
    const g = groupOf(ang);
    const t = (time + S.offset) % S.period;
    const half = S.period / 2;
    const inFirst = t < half;
    const localT = inFirst ? t : t - half;
    const active = inFirst ? 0 : 1;
    if (g !== active) return 'red';
    if (localT > half - 3.4) return 'amber';
    return 'green';
  }

  /** Lamp index 0=red 1=amber 2=green for prop animation. */
  lamp(nodeId, group, time) {
    const S = this.nodes.get(nodeId);
    if (!S) return 2;
    const t = (time + S.offset) % S.period;
    const half = S.period / 2;
    const inFirst = t < half;
    const localT = inFirst ? t : t - half;
    const active = inFirst ? 0 : 1;
    if (group !== active) return 0;
    if (localT > half - 3.4) return 1;
    return 2;
  }
}

function groupOf(angle) {
  let a = angle % Math.PI;
  if (a < 0) a += Math.PI;
  return a < Math.PI / 4 || a >= (3 * Math.PI) / 4 ? 0 : 1;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h | 0;
}

/* -------------------------------------------------------------- vehicles */

const SPECS = {
  car_sedan: { len: 4.52, w: 1.81, acc: 2.4, dec: 4.2 },
  car_hatch: { len: 3.98, w: 1.76, acc: 2.6, dec: 4.4 },
  car_suv: { len: 4.74, w: 1.92, acc: 2.1, dec: 4.0 },
  van: { len: 5.4, w: 2.0, acc: 1.7, dec: 3.6 },
  bus: { len: 11.6, w: 2.55, acc: 1.1, dec: 3.0 },
  truck: { len: 9.5, w: 2.5, acc: 1.0, dec: 2.8 },
};

export class TrafficSim {
  constructor(net, build, opts = {}) {
    this.net = net;
    this.graph = buildLaneGraph(net, build);
    this.signals = new SignalController(net, build);
    this.rnd = new RNG((opts.seed || 1) ^ 0x7a71);
    this.vehicles = [];
    this.time = 0;
    this.target = clamp(opts.count ?? 18, 0, MAX_VEHICLES);
    this.locks = new Map();
    this.occupancy = new Map();
    this.spawnPool = [];
    for (const t of VEHICLE_TYPES) for (let i = 0; i < t.n; i++) this.spawnPool.push(t.name);
  }

  get laneCount() { return this.graph.lanes.length; }

  setCount(n) { this.target = clamp(n | 0, 0, MAX_VEHICLES); }

  spawn() {
    const lanes = this.graph.lanes;
    if (!lanes.length) return null;
    const used = new Map();
    for (const v of this.vehicles) {
      if (v.el.kind === 'lane') used.set(v.el.id, Math.min(used.get(v.el.id) ?? 1e9, v.s));
    }
    for (let tries = 0; tries < 40; tries++) {
      const lane = lanes[(this.rnd.i(0, lanes.length - 1))];
      if (lane.length < 14) continue;
      const head = used.get(lane.id);
      if (head !== undefined && head < 16) continue;
      const counts = {};
      for (const v of this.vehicles) counts[v.type] = (counts[v.type] || 0) + 1;
      const avail = this.spawnPool.filter((t) => {
        const cap = VEHICLE_TYPES.find((x) => x.name === t).n;
        return (counts[t] || 0) < cap;
      });
      if (!avail.length) return null;
      const type = this.rnd.pick(avail);
      const spec = SPECS[type];
      if (lane.edge.cls === 'residential' && (type === 'bus' || type === 'truck')) continue;
      const v = {
        id: `v${this.vehicles.length}${Math.floor(this.rnd.f() * 1e5)}`,
        type, spec, el: lane, s: 1.0, speed: lane.speed * 0.6,
        color: paint(this.rnd), lock: null, waiting: 0,
        wander: (this.rnd.f() - 0.5) * 0.12,
      };
      this.vehicles.push(v);
      return v;
    }
    return null;
  }

  despawn(v) {
    if (v.lock) { this.locks.delete(v.lock); v.lock = null; }
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
  }

  nextElement(v) {
    const el = v.el;
    if (el.kind === 'lane') {
      const options = el.conns;
      if (!options.length) return null;
      // prefer straight ahead, then turns; never reverse
      const w = options.map((c) => (Math.abs(c.turn) < 0.35 ? 3.2 : Math.abs(c.turn) < 1.1 ? 1.4 : 0.6));
      let total = 0;
      for (const x of w) total += x;
      let r = this.rnd.f() * total;
      for (let i = 0; i < options.length; i++) {
        r -= w[i];
        if (r <= 0) return options[i];
      }
      return options[options.length - 1];
    }
    return el.to;
  }

  /** Distance to the vehicle ahead along the route (search 2 elements deep). */
  gapAhead(v) {
    let best = 400;
    let leadSpeed = 30;
    const consider = (other, dist) => {
      if (dist < best) { best = dist; leadSpeed = other.speed; }
    };
    const here = this.occupancy.get(v.el.id);
    if (here) {
      for (const o of here) {
        if (o === v || o.s <= v.s) continue;
        consider(o, o.s - v.s - o.spec.len * 0.5 - v.spec.len * 0.5);
      }
    }
    const remain = v.el.length - v.s;
    if (remain < 70) {
      const nexts = v.el.kind === 'lane' ? v.el.conns : [v.el.to];
      for (const nx of nexts) {
        if (!nx) continue;
        const list = this.occupancy.get(nx.id);
        if (!list) continue;
        for (const o of list) {
          consider(o, remain + o.s - o.spec.len * 0.5 - v.spec.len * 0.5);
        }
        if (nx.kind === 'conn') {
          const list2 = this.occupancy.get(nx.to?.id);
          if (list2) for (const o of list2) consider(o, remain + nx.length + o.s - o.spec.len);
        }
      }
    }
    return { gap: Math.max(best, -2), leadSpeed };
  }

  update(dt, enabled = true) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    if (!enabled) return;

    while (this.vehicles.length < this.target) { if (!this.spawn()) break; }
    while (this.vehicles.length > this.target) this.despawn(this.vehicles[this.vehicles.length - 1]);

    // occupancy index
    this.occupancy.clear();
    for (const v of this.vehicles) {
      let list = this.occupancy.get(v.el.id);
      if (!list) { list = []; this.occupancy.set(v.el.id, list); }
      list.push(v);
    }

    for (const v of this.vehicles) {
      const desired = v.el.speed * (1 + v.wander);
      const { gap, leadSpeed } = this.gapAhead(v);

      // --- junction gate
      let gate = Infinity;
      if (v.el.kind === 'lane') {
        const remain = v.el.length - v.s;
        const node = v.el.to;
        const next = v.plan || (v.plan = this.nextElement(v));
        if (!next) {
          gate = Math.min(gate, remain + 4); // dead end: allowed to exit the world
        } else if (remain < 42) {
          const head = this.graph.laneAt(v.el, v.el.length);
          const sig = this.signals.state(node, head.hx, head.hz, this.time);
          const stopping = sig === 'red' || (sig === 'amber' && remain > v.speed * 1.1);
          if (stopping) gate = Math.min(gate, remain - 0.6);
          else if (remain < 9) {
            const lock = this.locks.get(node);
            const cap = sig === 'none' ? 1 : 2;
            const n = lock ? lock.size : 0;
            if (!lock || lock.has(v.id) || n < cap) {
              // allowed
            } else gate = Math.min(gate, remain - 0.6);
          }
        }
      }

      const a = idm(v, desired, gap, leadSpeed, gate - 0.0);
      v.speed = Math.max(0, v.speed + a * dt);
      if (v.speed < 0.08 && gate < 2) v.speed = 0;
      v.s += v.speed * dt;

      if (v.s >= v.el.length) {
        const over = v.s - v.el.length;
        const nxt = v.plan || this.nextElement(v);
        v.plan = null;
        if (!nxt) { this.respawn(v); continue; }
        if (v.el.kind === 'lane' && nxt.kind === 'conn') {
          let lock = this.locks.get(nxt.node.id);
          if (!lock) { lock = new Set(); this.locks.set(nxt.node.id, lock); }
          lock.add(v.id);
          v.lock = nxt.node.id;
        } else if (v.el.kind === 'conn') {
          const lock = this.locks.get(v.el.node.id);
          if (lock) lock.delete(v.id);
          v.lock = null;
        }
        v.el = nxt;
        v.s = Math.min(over, nxt.length * 0.5);
      }
    }
  }

  respawn(v) {
    if (v.lock) {
      const lock = this.locks.get(v.lock);
      if (lock) lock.delete(v.id);
      v.lock = null;
    }
    const lanes = this.graph.lanes;
    for (let i = 0; i < 25; i++) {
      const lane = lanes[this.rnd.i(0, lanes.length - 1)];
      if (lane.length < 14) continue;
      let clear = true;
      const list = this.occupancy.get(lane.id);
      if (list) for (const o of list) if (o.s < 18) clear = false;
      if (!clear) continue;
      v.el = lane; v.s = 0.6; v.speed = lane.speed * 0.5; v.plan = null;
      return;
    }
    v.el = lanes[0]; v.s = 0.5; v.speed = 0; v.plan = null;
  }

  /** Write transforms into the reserved instance slots. */
  writeInstances(data, slots, out) {
    const counts = new Map();
    for (const v of this.vehicles) {
      const slot = slots.get(v.type);
      if (!slot) continue;
      const k = counts.get(v.type) || 0;
      if (k >= slot.max) continue;
      counts.set(v.type, k + 1);
      const p = this.graph.posAt(v.el, v.s);
      const rot = rotForZ(p.hx, p.hz);
      const idx = slot.first + k;
      const m = m4.trs([p.x, p.y, p.z], rot, [1, 1, 1]);
      data.set(m, idx * 24);
      data[idx * 24 + 16] = v.color[0];
      data[idx * 24 + 17] = v.color[1];
      data[idx * 24 + 18] = v.color[2];
      data[idx * 24 + 19] = 0;
      data[idx * 24 + 20] = 0;
      data[idx * 24 + 21] = -1;
      data[idx * 24 + 22] = v.speed < 0.4 ? 1 : 0;   // brake lights
      data[idx * 24 + 23] = 0;
      if (out) out.push({ v, p });
    }
    return counts;
  }

  headlights(list, night) {
    if (night < 0.02) return;
    for (const v of this.vehicles) {
      const p = this.graph.posAt(v.el, v.s);
      const fx = p.hx, fz = p.hz;
      list.push({
        pos: [p.x + fx * (v.spec.len * 0.45), 0.72, p.z + fz * (v.spec.len * 0.45)],
        range: 24, color: [1.0, 0.95, 0.85], intensity: 7 * night,
        dir: [fx, -0.22, fz], outer: 0.72, inner: 0.28, kind: 6,
      });
    }
  }
}

function idm(v, desired, gap, leadSpeed, gateDist) {
  const a = v.spec.acc, b = v.spec.dec;
  const s0 = 2.2 + v.spec.len * 0.12;
  const T = 1.35;
  const free = 1 - (v.speed / Math.max(desired, 0.6)) ** 4;
  let interaction = 0;
  const applyObstacle = (dist, otherV) => {
    const d = Math.max(dist, 0.35);
    const dv = v.speed - otherV;
    const sStar = s0 + Math.max(0, v.speed * T + (v.speed * dv) / (2 * Math.sqrt(a * b)));
    interaction = Math.max(interaction, (sStar / d) ** 2);
  };
  if (gap < 220) applyObstacle(gap, leadSpeed);
  if (Number.isFinite(gateDist)) applyObstacle(gateDist, 0);
  return clamp(a * (free - interaction), -b * 2.2, a);
}

function paint(rnd) {
  const palette = [
    [0.55, 0.56, 0.58], [0.025, 0.025, 0.03], [0.78, 0.78, 0.79], [0.07, 0.09, 0.18],
    [0.31, 0.02, 0.02], [0.02, 0.09, 0.05], [0.42, 0.44, 0.48], [0.6, 0.45, 0.08],
    [0.09, 0.2, 0.34], [0.68, 0.66, 0.6], [0.2, 0.05, 0.12],
  ];
  return rnd.pick(palette);
}

/* ----------------------------------------------------------------- trains */

export class TrainSim {
  constructor(net, build, opts = {}) {
    this.runs = [];
    this.time = 0;
    const visited = new Set();
    for (const edge of net.edges.values()) {
      if (edge.cls !== 'rail' || visited.has(edge.id)) continue;
      const chain = railChain(net, edge, visited);
      if (!chain.length) continue;
      const segs = chain.map((c) => ({
        curve: build.curves.get(c.edge.id), dir: c.dir, prof: build.profiles.get(c.edge.id),
      })).filter((s) => s.curve);
      if (!segs.length) continue;
      let total = 0;
      for (const s of segs) { s.start = total; total += s.curve.length; }
      this.runs.push({ segs, total, s: Math.random() * total, speed: 14 + Math.random() * 8, cars: 4 });
    }
  }

  posAt(run, d) {
    let x = ((d % run.total) + run.total) % run.total;
    for (const s of run.segs) {
      if (x <= s.start + s.curve.length) {
        const local = x - s.start;
        const sv = s.dir > 0 ? local : s.curve.length - local;
        const fr = s.curve.frameAt(clamp(sv, 0, s.curve.length));
        return {
          x: fr.p[0], y: fr.p[1] + (s.prof ? s.prof.hChan + 0.21 : 0.2), z: fr.p[2],
          hx: fr.t[0] * s.dir, hz: fr.t[2] * s.dir,
        };
      }
    }
    const s = run.segs[run.segs.length - 1];
    const fr = s.curve.frameAt(s.curve.length);
    return { x: fr.p[0], y: fr.p[1] + 0.2, z: fr.p[2], hx: fr.t[0], hz: fr.t[2] };
  }

  update(dt, enabled) {
    if (!enabled) return;
    this.time += dt;
    for (const r of this.runs) r.s += r.speed * dt;
  }

  writeInstances(data, slots, enabled) {
    const counts = new Map([['train_loco', 0], ['train_coach', 0]]);
    if (!enabled) return counts;
    for (const run of this.runs) {
      for (let c = 0; c < run.cars; c++) {
        const type = c === 0 ? 'train_loco' : 'train_coach';
        const slot = slots.get(type);
        if (!slot) continue;
        const k = counts.get(type);
        if (k >= slot.max) continue;
        counts.set(type, k + 1);
        const p = this.posAt(run, run.s - c * 20.6);
        const m = m4.trs([p.x, p.y, p.z], rotForZ(p.hx, p.hz), [1, 1, 1]);
        const idx = (slot.first + k) * 24;
        data.set(m, idx);
        data[idx + 16] = 1; data[idx + 17] = 1; data[idx + 18] = 1; data[idx + 19] = 0;
        data[idx + 20] = 0; data[idx + 21] = -1; data[idx + 22] = 0; data[idx + 23] = 0;
      }
    }
    return counts;
  }
}

function railChain(net, start, visited) {
  const chain = [{ edge: start, dir: 1 }];
  visited.add(start.id);
  // extend forward
  let node = start.b;
  let guard = 0;
  while (guard++ < 200) {
    const next = net.edgesAt(node).find((e) => e.cls === 'rail' && !visited.has(e.id));
    if (!next) break;
    visited.add(next.id);
    const dir = next.a === node ? 1 : -1;
    chain.push({ edge: next, dir });
    node = dir > 0 ? next.b : next.a;
  }
  // extend backward
  node = start.a;
  guard = 0;
  while (guard++ < 200) {
    const next = net.edgesAt(node).find((e) => e.cls === 'rail' && !visited.has(e.id));
    if (!next) break;
    visited.add(next.id);
    const dir = next.b === node ? 1 : -1;
    chain.unshift({ edge: next, dir });
    node = dir > 0 ? next.a : next.b;
  }
  return chain;
}
