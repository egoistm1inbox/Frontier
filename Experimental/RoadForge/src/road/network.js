// RoadForge — road network graph model.
//
// Nodes are real intersections (clickable, movable, gizmo-driven).
// Edges are spline segments with a full engineering cross-section.

import { v3, clamp, TAU, wrapAngle, bez3, bez3d, hermite } from '../core/math.js';

export const ROAD_CLASSES = {
  highway: {
    label: 'Motorway',
    lanesF: 3, lanesB: 3, laneWidth: 3.65, medianW: 3.0, median: 'barrier',
    shoulder: 2.5, sidewalk: 0, parking: false, maxSpeed: 33,
    curbHeight: 0.0, guardrail: true, lighting: 'median', color: '#e0b25f',
    markings: { centerDouble: false, edgeLines: true, dashed: true, yellowEdge: true },
  },
  arterial: {
    label: 'Arterial',
    lanesF: 2, lanesB: 2, laneWidth: 3.5, medianW: 1.8, median: 'raised',
    shoulder: 0, sidewalk: 2.6, parking: false, maxSpeed: 16,
    curbHeight: 0.15, guardrail: false, lighting: 'both', color: '#d2874f',
    markings: { centerDouble: true, edgeLines: true, dashed: true },
  },
  street: {
    label: 'City street',
    lanesF: 1, lanesB: 1, laneWidth: 3.4, medianW: 0, median: 'none',
    shoulder: 0, sidewalk: 2.4, parking: true, maxSpeed: 13,
    curbHeight: 0.145, guardrail: false, lighting: 'alternate', color: '#9fb4cc',
    markings: { centerDouble: true, edgeLines: false, dashed: false },
  },
  residential: {
    label: 'Residential',
    lanesF: 1, lanesB: 1, laneWidth: 3.0, medianW: 0, median: 'none',
    shoulder: 0, sidewalk: 1.9, parking: true, maxSpeed: 8,
    curbHeight: 0.13, guardrail: false, lighting: 'alternate', color: '#8fa38b',
    markings: { centerDouble: false, edgeLines: false, dashed: true },
  },
  alley: {
    label: 'Service lane',
    lanesF: 1, lanesB: 0, laneWidth: 3.2, medianW: 0, median: 'none',
    shoulder: 0, sidewalk: 0.0, parking: false, maxSpeed: 6,
    curbHeight: 0.06, guardrail: false, lighting: 'none', color: '#7d7d7d',
    markings: { centerDouble: false, edgeLines: false, dashed: false },
  },
  ramp: {
    label: 'Ramp',
    lanesF: 1, lanesB: 0, laneWidth: 4.2, medianW: 0, median: 'none',
    shoulder: 1.2, sidewalk: 0, parking: false, maxSpeed: 18,
    curbHeight: 0.0, guardrail: true, lighting: 'none', color: '#c0a060',
    markings: { centerDouble: false, edgeLines: true, dashed: false, yellowEdge: true },
  },
  rail: {
    label: 'Railway',
    lanesF: 0, lanesB: 0, laneWidth: 0, medianW: 0, median: 'none',
    shoulder: 0, sidewalk: 0, parking: false, maxSpeed: 25,
    curbHeight: 0, guardrail: false, lighting: 'none', color: '#8e7fa8',
    gauge: 1.435, markings: {},
  },
};

export const CLASS_ORDER = ['highway', 'arterial', 'street', 'residential', 'alley', 'ramp', 'rail'];

let _uid = 1;
export const uid = (p = 'o') => `${p}${(_uid++).toString(36)}`;
export const resetUid = (n = 1) => { _uid = n; };

export function makeNode(x, z, y = 0, opts = {}) {
  return {
    id: opts.id || uid('n'),
    kind: 'node',
    name: opts.name || null,
    x, y, z,
    cornerRadius: opts.cornerRadius ?? 0,  // 0 = auto from class
    signals: opts.signals ?? 'auto',       // auto | signals | stop | yield | none | roundabout
    crosswalks: opts.crosswalks ?? true,
    elevated: opts.elevated ?? false,
    locked: false,
    hidden: false,
    tag: opts.tag || null,
  };
}

export function makeEdge(a, b, cls = 'street', opts = {}) {
  const def = ROAD_CLASSES[cls];
  return {
    id: opts.id || uid('e'),
    kind: 'edge',
    name: opts.name || null,
    a, b,
    cls,
    // Tangent handles (world-space offsets from the node). null = auto.
    ha: opts.ha || null,
    hb: opts.hb || null,
    lanesF: opts.lanesF ?? def.lanesF,
    lanesB: opts.lanesB ?? def.lanesB,
    laneWidth: opts.laneWidth ?? def.laneWidth,
    medianW: opts.medianW ?? def.medianW,
    median: opts.median ?? def.median,
    sidewalkL: opts.sidewalkL ?? def.sidewalk,
    sidewalkR: opts.sidewalkR ?? def.sidewalk,
    parkingL: opts.parkingL ?? (def.parking ? 2.3 : 0),
    parkingR: opts.parkingR ?? (def.parking ? 2.3 : 0),
    shoulder: opts.shoulder ?? def.shoulder,
    curbHeight: opts.curbHeight ?? def.curbHeight,
    crown: opts.crown ?? 0.022,
    // Structures
    bridge: opts.bridge ?? 'auto',   // auto | always | never
    tunnel: opts.tunnel ?? false,
    guardrail: opts.guardrail ?? def.guardrail,
    railingL: opts.railingL ?? false,
    railingR: opts.railingR ?? false,
    // Surface condition / features
    wear: opts.wear ?? 0.35,
    potholes: opts.potholes ?? 0,
    patches: opts.patches ?? 0.3,
    bumps: opts.bumps ?? [],         // [{s: 0..1, kind:'hump'|'table'|'cushion'}]
    construction: opts.construction ?? null, // {s0,s1,side}
    busStop: opts.busStop ?? null,
    lighting: opts.lighting ?? def.lighting,
    bikeLaneL: opts.bikeLaneL ?? false,
    bikeLaneR: opts.bikeLaneR ?? false,
    oneway: opts.oneway ?? (def.lanesB === 0),
    speed: opts.speed ?? def.maxSpeed,
    hidden: false,
    locked: false,
    group: opts.group || null,
  };
}

export class RoadNetwork {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
    this.version = 0;
    this.listeners = new Set();
  }

  clear() { this.nodes.clear(); this.edges.clear(); this.bump(); }
  bump() { this.version++; }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(reason = 'change', detail = null) {
    this.bump();
    for (const l of this.listeners) l(reason, detail);
  }

  addNode(n) { this.nodes.set(n.id, n); return n; }
  addEdge(e) {
    if (!this.nodes.has(e.a) || !this.nodes.has(e.b) || e.a === e.b) return null;
    for (const other of this.edges.values()) {
      if ((other.a === e.a && other.b === e.b) || (other.a === e.b && other.b === e.a)) return other;
    }
    this.edges.set(e.id, e);
    return e;
  }
  removeEdge(id) { this.edges.delete(id); }
  removeNode(id) {
    for (const [eid, e] of [...this.edges]) if (e.a === id || e.b === id) this.edges.delete(eid);
    this.nodes.delete(id);
  }

  node(id) { return this.nodes.get(id); }
  edge(id) { return this.edges.get(id); }
  get(id) { return this.nodes.get(id) || this.edges.get(id); }

  edgesAt(id) {
    const out = [];
    for (const e of this.edges.values()) if (e.a === id || e.b === id) out.push(e);
    return out;
  }

  degree(id) { return this.edgesAt(id).length; }

  nodePos(id) { const n = this.nodes.get(id); return [n.x, n.y, n.z]; }

  /** Handle (tangent) of edge e at its `end` (0 = a, 1 = b), world offset. */
  handle(e, end) {
    const a = this.nodes.get(e.a), b = this.nodes.get(e.b);
    const explicit = end === 0 ? e.ha : e.hb;
    const chord = Math.hypot(b.x - a.x, b.z - a.z);
    if (explicit) return [explicit[0], explicit[1]];
    // Auto: smooth through nodes of degree 2, straight otherwise.
    const self = end === 0 ? a : b;
    const other = end === 0 ? b : a;
    const dir = [other.x - self.x, other.z - self.z];
    const dl = Math.hypot(dir[0], dir[1]) || 1;
    const ndir = [dir[0] / dl, dir[1] / dl];
    const inc = this.edgesAt(self.id);
    if (inc.length === 2) {
      // Average the two chord directions to keep curvature continuous.
      let sum = [0, 0];
      for (const ie of inc) {
        const o = this.nodes.get(ie.a === self.id ? ie.b : ie.a);
        const d = [o.x - self.x, o.z - self.z];
        const l = Math.hypot(d[0], d[1]) || 1;
        sum = [sum[0] + d[0] / l, sum[1] + d[1] / l];
      }
      let t = [ndir[0] - sum[0] * 0.5, ndir[1] - sum[1] * 0.5];
      const tl = Math.hypot(t[0], t[1]);
      if (tl > 1e-4) {
        t = [t[0] / tl, t[1] / tl];
        const k = clamp(chord * 0.34, 2, 60);
        return [t[0] * k, t[1] * k];
      }
    }
    const k = chord * 0.3;
    return [ndir[0] * k, ndir[1] * k];
  }

  /** Control points of the cubic for an edge: [p0, c0, c1, p1] in 3D. */
  controls(e) {
    const a = this.nodes.get(e.a), b = this.nodes.get(e.b);
    const ha = this.handle(e, 0), hb = this.handle(e, 1);
    const p0 = [a.x, a.y, a.z];
    const p1 = [b.x, b.y, b.z];
    const c0 = [a.x + ha[0], a.y, a.z + ha[1]];
    const c1 = [b.x + hb[0], b.y, b.z + hb[1]];
    // Vertical: hermite blend so grades stay smooth and bridges arch properly.
    const arch = e._arch || 0;
    c0[1] = a.y + (b.y - a.y) * 0.18 + arch;
    c1[1] = b.y - (b.y - a.y) * 0.18 + arch;
    return [p0, c0, c1, p1];
  }

  point(e, t) { const c = this.controls(e); return bez3(c[0], c[1], c[2], c[3], t); }
  tangent(e, t) { const c = this.controls(e); return v3.norm(bez3d(c[0], c[1], c[2], c[3], t)); }

  /** Outgoing planar direction at a node for an edge (unit, XZ). */
  dirAt(e, nodeId) {
    const t = nodeId === e.a ? 0 : 1;
    const d = this.tangent(e, t);
    const s = nodeId === e.a ? 1 : -1;
    const v = [d[0] * s, d[2] * s];
    const l = Math.hypot(v[0], v[1]) || 1;
    return [v[0] / l, v[1] / l];
  }

  angleAt(e, nodeId) {
    const d = this.dirAt(e, nodeId);
    return Math.atan2(d[1], d[0]);
  }

  /** Incident edges sorted CCW by outgoing angle. */
  arms(nodeId) {
    const out = this.edgesAt(nodeId).map((e) => ({
      edge: e,
      end: e.a === nodeId ? 0 : 1,
      dir: this.dirAt(e, nodeId),
      angle: this.angleAt(e, nodeId),
    }));
    out.sort((p, q) => p.angle - q.angle);
    return out;
  }

  length(e, samples = 24) {
    const c = this.controls(e);
    let len = 0;
    let prev = bez3(c[0], c[1], c[2], c[3], 0);
    for (let i = 1; i <= samples; i++) {
      const p = bez3(c[0], c[1], c[2], c[3], i / samples);
      len += v3.dist(prev, p);
      prev = p;
    }
    return len;
  }

  /** Half width of the carriageway (curb line to centreline). */
  roadHalf(e) {
    const def = ROAD_CLASSES[e.cls];
    if (e.cls === 'rail') return 2.6;
    const lanes = Math.max(e.lanesF, 0) * e.laneWidth + Math.max(e.lanesB, 0) * e.laneWidth;
    const w = lanes + e.medianW + e.parkingL + e.parkingR + e.shoulder * 2
      + (e.bikeLaneL ? 1.6 : 0) + (e.bikeLaneR ? 1.6 : 0);
    return Math.max(2.0, w / 2);
  }

  /** Total half width including curb, footway and verge. */
  fullHalf(e) {
    return this.roadHalf(e) + 0.18 + Math.max(e.sidewalkL, e.sidewalkR) + 0.6;
  }

  bounds() {
    let mnx = Infinity, mnz = Infinity, mxx = -Infinity, mxz = -Infinity;
    for (const n of this.nodes.values()) {
      mnx = Math.min(mnx, n.x); mxx = Math.max(mxx, n.x);
      mnz = Math.min(mnz, n.z); mxz = Math.max(mxz, n.z);
    }
    if (!isFinite(mnx)) return { min: [-50, -50], max: [50, 50], center: [0, 0], size: 100 };
    return {
      min: [mnx, mnz], max: [mxx, mxz],
      center: [(mnx + mxx) / 2, (mnz + mxz) / 2],
      size: Math.max(mxx - mnx, mxz - mnz) || 100,
    };
  }

  stats() {
    let len = 0;
    for (const e of this.edges.values()) len += this.length(e);
    let junctions = 0;
    for (const n of this.nodes.values()) if (this.degree(n.id) >= 3) junctions++;
    return { nodes: this.nodes.size, edges: this.edges.size, length: len, junctions };
  }

  toJSON() {
    return {
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
    };
  }

  static fromJSON(data) {
    const net = new RoadNetwork();
    for (const n of data.nodes) net.nodes.set(n.id, { ...n });
    for (const e of data.edges) net.edges.set(e.id, { ...e });
    return net;
  }
}
