// RoadForge — arc-length parameterised edge curves with stable frames.

import { bez3, bez3d, v3, clamp } from '../core/math.js';

export class EdgeCurve {
  constructor(net, edge, samples = 0) {
    this.edge = edge;
    const c = net.controls(edge);
    this.c = c;
    const chord = v3.dist(c[0], c[3]);
    const n = samples || clamp(Math.ceil(chord / 1.2) + 8, 16, 400);
    this.n = n;
    this.ps = new Float64Array((n + 1) * 3);
    this.ts = new Float64Array((n + 1) * 3);
    this.ss = new Float64Array(n + 1);
    let acc = 0;
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const p = bez3(c[0], c[1], c[2], c[3], u);
      const d = v3.norm(bez3d(c[0], c[1], c[2], c[3], u));
      this.ps[i * 3] = p[0]; this.ps[i * 3 + 1] = p[1]; this.ps[i * 3 + 2] = p[2];
      this.ts[i * 3] = d[0]; this.ts[i * 3 + 1] = d[1]; this.ts[i * 3 + 2] = d[2];
      if (prev) acc += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
      this.ss[i] = acc;
      prev = p;
    }
    this.length = acc;
  }

  /** Normalised parameter for an arc length s. */
  uAt(s) {
    const { ss, n } = this;
    const d = clamp(s, 0, this.length);
    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ss[mid] < d) lo = mid + 1; else hi = mid;
    }
    const i = Math.max(1, lo);
    const s0 = ss[i - 1], s1 = ss[i];
    const f = s1 > s0 ? (d - s0) / (s1 - s0) : 0;
    return (i - 1 + f) / n;
  }

  point(u) { return bez3(this.c[0], this.c[1], this.c[2], this.c[3], u); }
  tangent(u) { return v3.norm(bez3d(this.c[0], this.c[1], this.c[2], this.c[3], u)); }

  /** Frame at arc length s: position, forward, right (XZ), up. */
  frameAt(s) {
    const u = this.uAt(s);
    const p = this.point(u);
    const t = this.tangent(u);
    const fl = Math.hypot(t[0], t[2]) || 1;
    const right = [t[2] / fl, 0, -t[0] / fl];
    // Up is tilted by the longitudinal grade so sections stay perpendicular.
    const up = v3.norm(v3.cross(right, t));
    return { p, t, right, up, u, s };
  }

  /** Signed curvature (1/radius) in the XZ plane at arc length s. */
  curvature(s) {
    const e = Math.max(0.5, this.length * 0.01);
    const a = this.frameAt(Math.max(0, s - e));
    const b = this.frameAt(Math.min(this.length, s + e));
    const da = Math.atan2(a.t[2], a.t[0]);
    const db = Math.atan2(b.t[2], b.t[0]);
    let d = db - da;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d / Math.max(1e-3, b.s - a.s);
  }
}

export function buildCurves(net) {
  const map = new Map();
  for (const e of net.edges.values()) map.set(e.id, new EdgeCurve(net, e));
  return map;
}
