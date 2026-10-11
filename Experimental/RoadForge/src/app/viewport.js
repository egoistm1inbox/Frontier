// RoadForge — camera, picking and the intersection gizmo.

import { m4, v3, clamp, rad } from '../core/math.js';

export class OrbitCamera {
  constructor() {
    this.target = [0, 0, 0];
    this.dist = 150;
    this.yaw = 0.9;
    this.pitch = 0.62;
    this.fov = rad(46);
    this.minDist = 4;
    this.maxDist = 2200;
  }

  get eye() {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    return [
      this.target[0] + Math.cos(this.yaw) * cp * this.dist,
      this.target[1] + sp * this.dist,
      this.target[2] + Math.sin(this.yaw) * cp * this.dist,
    ];
  }

  orbit(dx, dy) {
    this.yaw += dx * 0.006;
    this.pitch = clamp(this.pitch + dy * 0.0055, 0.035, 1.5);
  }

  pan(dx, dy) {
    const e = this.eye;
    const fwd = v3.norm(v3.sub(this.target, e));
    const right = v3.norm(v3.cross(fwd, [0, 1, 0]));
    const up = v3.cross(right, fwd);
    const k = this.dist * 0.0014;
    for (let i = 0; i < 3; i++) {
      this.target[i] += (-right[i] * dx + up[i] * dy) * k;
    }
  }

  zoom(delta) {
    this.dist = clamp(this.dist * Math.exp(delta * 0.0014), this.minDist, this.maxDist);
  }

  frame(bounds, aspect = 1.6) {
    const c = [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    ];
    const r = Math.max(
      bounds.max[0] - bounds.min[0],
      bounds.max[2] - bounds.min[2],
    ) * 0.5;
    this.target = c;
    this.dist = clamp((r * 1.25) / Math.tan(this.fov * 0.5) * 0.55, 20, this.maxDist);
    this.pitch = 0.72;
    void aspect;
  }

  matrices(aspect) {
    const proj = m4.perspective(this.fov, aspect, 0.1, 6000);
    const view = m4.lookAt(this.eye, this.target, [0, 1, 0]);
    const viewProj = m4.mul(proj, view);
    return { proj, view, viewProj, invVP: m4.invert(viewProj) };
  }

  /** Screen pixel → world ray. */
  ray(mx, my, w, h) {
    const { invVP } = this.matrices(w / h);
    const x = (mx / w) * 2 - 1;
    const y = 1 - (my / h) * 2;
    const a = m4.transformPoint(invVP, [x, y, 0.0]);
    const b = m4.transformPoint(invVP, [x, y, 1.0]);
    return { o: a, d: v3.norm(v3.sub(b, a)) };
  }
}

/* ---------------------------------------------------------------- picking */

export function rayPlaneY(ray, y) {
  if (Math.abs(ray.d[1]) < 1e-6) return null;
  const t = (y - ray.o[1]) / ray.d[1];
  if (t < 0) return null;
  return [ray.o[0] + ray.d[0] * t, y, ray.o[2] + ray.d[2] * t, t];
}

export function rayPointDist(ray, p) {
  const w = v3.sub(p, ray.o);
  const t = v3.dot(w, ray.d);
  if (t < 0) return { d: Infinity, t: 0 };
  const proj = [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t];
  return { d: v3.dist(proj, p), t };
}

/** Nearest node whose pick sphere the ray enters. */
export function pickNode(net, build, ray, scale = 1) {
  let best = null;
  for (const n of net.nodes.values()) {
    if (n.hidden) continue;
    const plan = build.plans.get(n.id);
    let r = 4.5;
    if (plan && plan.arms.length) {
      for (const a of plan.arms) r = Math.max(r, (a.w || 4) + 1.4);
    }
    r *= scale;
    const hit = rayPointDist(ray, [n.x, n.y, n.z]);
    if (hit.d >= r) continue;
    // prefer the junction the cursor is most centred on, not merely the nearest
    const score = hit.d / r + hit.t * 1e-5;
    if (!best || score < best.score) best = { node: n, t: hit.t, d: hit.d, r, score };
  }
  return best;
}

/** Nearest edge centreline within a tolerance. */
export function pickEdge(net, build, ray, tol = 3.2) {
  let best = null;
  for (const e of net.edges.values()) {
    const curve = build.curves.get(e.id);
    if (!curve) continue;
    const step = Math.max(2.5, curve.length / 48);
    for (let s = 0; s <= curve.length; s += step) {
      const fr = curve.frameAt(s);
      const hit = rayPointDist(ray, fr.p);
      const w = (build.profiles.get(e.id)?.roadHalf ?? 4) + tol;
      if (hit.d < w && (!best || hit.t < best.t)) best = { edge: e, t: hit.t, s, d: hit.d };
    }
  }
  return best;
}

/** Closest point parameter on an infinite axis to a ray (for axis dragging). */
export function axisClosest(ray, origin, axis) {
  const w0 = v3.sub(origin, ray.o);
  const a = v3.dot(axis, axis);
  const b = v3.dot(axis, ray.d);
  const c = v3.dot(ray.d, ray.d);
  const d = v3.dot(axis, w0);
  const e = v3.dot(ray.d, w0);
  const den = a * c - b * b;
  if (Math.abs(den) < 1e-7) return 0;
  return (b * e - c * d) / den * -1;
}

/* ----------------------------------------------------------------- gizmo */

const AXES = [
  { id: 'x', dir: [1, 0, 0], col: [0.93, 0.33, 0.36] },
  { id: 'y', dir: [0, 1, 0], col: [0.46, 0.86, 0.45] },
  { id: 'z', dir: [0, 0, 1], col: [0.38, 0.6, 0.95] },
];

export class Gizmo {
  constructor() {
    this.active = null;     // 'x' | 'y' | 'z' | 'xz'
    this.hover = null;
    this.drag = null;
    this.size = 1;
  }

  /** Screen-stable handle length. */
  scaleFor(camera, center) {
    const d = v3.dist(camera.eye, center);
    return clamp(d * 0.115, 2.2, 46);
  }

  /** Which handle does this ray hit? */
  hitTest(ray, center, s) {
    let best = null;
    for (const a of AXES) {
      const tip = [center[0] + a.dir[0] * s, center[1] + a.dir[1] * s, center[2] + a.dir[2] * s];
      // sample the shaft
      for (let i = 2; i <= 10; i++) {
        const t = i / 10;
        const p = [
          center[0] + a.dir[0] * s * t,
          center[1] + a.dir[1] * s * t,
          center[2] + a.dir[2] * s * t,
        ];
        const hit = rayPointDist(ray, p);
        if (hit.d < s * 0.09 && (!best || hit.t < best.t)) best = { id: a.id, t: hit.t };
      }
      void tip;
    }
    // planar handle (XZ square near the origin)
    const q = rayPlaneY(ray, center[1]);
    if (q) {
      const dx = q[0] - center[0], dz = q[2] - center[2];
      const k = s * 0.34;
      if (dx > s * 0.1 && dx < k && dz > s * 0.1 && dz < k) {
        if (!best || q[3] < best.t) best = { id: 'xz', t: q[3] };
      }
    }
    return best ? best.id : null;
  }

  begin(id, ray, center) {
    this.active = id;
    const axis = AXES.find((a) => a.id === id);
    if (id === 'xz') {
      const p = rayPlaneY(ray, center[1]);
      this.drag = { kind: 'plane', start: p ? [p[0], p[1], p[2]] : center.slice(), origin: center.slice() };
    } else if (axis) {
      const t = axisClosest(ray, center, axis.dir);
      this.drag = { kind: 'axis', axis: axis.dir, t0: t, origin: center.slice() };
    }
  }

  move(ray, center) {
    if (!this.drag) return null;
    if (this.drag.kind === 'plane') {
      const p = rayPlaneY(ray, this.drag.origin[1]);
      if (!p) return null;
      return [
        this.drag.origin[0] + (p[0] - this.drag.start[0]),
        this.drag.origin[1],
        this.drag.origin[2] + (p[2] - this.drag.start[2]),
      ];
    }
    const t = axisClosest(ray, this.drag.origin, this.drag.axis);
    const dt = t - this.drag.t0;
    return [
      this.drag.origin[0] + this.drag.axis[0] * dt,
      this.drag.origin[1] + this.drag.axis[1] * dt,
      this.drag.origin[2] + this.drag.axis[2] * dt,
    ];
  }

  end() { this.active = null; this.drag = null; }

  /** Emit gizmo + selection highlight lines into a writer. */
  lines(push, center, s, plan) {
    const hot = this.active || this.hover;
    for (const a of AXES) {
      const c = hot === a.id ? [1, 0.92, 0.5] : a.col;
      const tip = [center[0] + a.dir[0] * s, center[1] + a.dir[1] * s, center[2] + a.dir[2] * s];
      push(center, tip, c, 1);
      // arrow head
      const perp = a.id === 'y' ? [1, 0, 0] : [0, 1, 0];
      const p2 = v3.cross(a.dir, perp);
      const back = 0.82;
      for (const sg of [-1, 1]) {
        push(tip, [
          center[0] + a.dir[0] * s * back + p2[0] * s * 0.07 * sg,
          center[1] + a.dir[1] * s * back + p2[1] * s * 0.07 * sg,
          center[2] + a.dir[2] * s * back + p2[2] * s * 0.07 * sg,
        ], c, 1);
        push(tip, [
          center[0] + a.dir[0] * s * back + perp[0] * s * 0.07 * sg,
          center[1] + a.dir[1] * s * back + perp[1] * s * 0.07 * sg,
          center[2] + a.dir[2] * s * back + perp[2] * s * 0.07 * sg,
        ], c, 1);
      }
    }
    // planar handle
    const k = s * 0.34, k0 = s * 0.1;
    const pc = hot === 'xz' ? [1, 0.92, 0.5] : [0.85, 0.85, 0.88];
    const corners = [
      [center[0] + k0, center[1], center[2] + k0],
      [center[0] + k, center[1], center[2] + k0],
      [center[0] + k, center[1], center[2] + k],
      [center[0] + k0, center[1], center[2] + k],
    ];
    for (let i = 0; i < 4; i++) push(corners[i], corners[(i + 1) % 4], pc, 0.85);

    // junction outline: the actual welded cap boundary
    if (plan && plan.ring && plan.ring.length > 2) {
      for (let i = 0; i < plan.ring.length; i++) {
        const a = plan.ring[i], b = plan.ring[(i + 1) % plan.ring.length];
        push([a[0], a[1] + 0.06, a[2]], [b[0], b[1] + 0.06, b[2]], [1, 0.86, 0.36], 0.95);
      }
    }
  }
}

/** Builds the line vertex buffer (pos3 + rgba4). */
export class LineBatch {
  constructor(max = 65536) {
    this.data = new Float32Array(max * 7);
    this.count = 0;
    this.max = max;
  }
  reset() { this.count = 0; }
  push(a, b, col, alpha = 1) {
    if (this.count + 2 > this.max) return;
    const o = this.count * 7;
    const d = this.data;
    d[o] = a[0]; d[o + 1] = a[1]; d[o + 2] = a[2];
    d[o + 3] = col[0]; d[o + 4] = col[1]; d[o + 5] = col[2]; d[o + 6] = alpha;
    d[o + 7] = b[0]; d[o + 8] = b[1]; d[o + 9] = b[2];
    d[o + 10] = col[0]; d[o + 11] = col[1]; d[o + 12] = col[2]; d[o + 13] = alpha;
    this.count += 2;
  }
}
