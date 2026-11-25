/**
 * 3D vector algebra, parallel-transported curve frames, and physical color
 * helpers (Y-up right-handed coordinate system matching Three.js & glTF).
 */

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const TAU = Math.PI * 2;
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ~137.507764°

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const UP: Readonly<V3> = Object.freeze({ x: 0, y: 1, z: 0 });
export const RIGHT: Readonly<V3> = Object.freeze({ x: 1, y: 0, z: 0 });
export const FWD: Readonly<V3> = Object.freeze({ x: 0, y: 0, z: 1 });

export const clone = (a: V3): V3 => ({ x: a.x, y: a.y, z: a.z });
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const addScaled = (a: V3, b: V3, s: number): V3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
export const neg = (a: V3): V3 => ({ x: -a.x, y: -a.y, z: -a.z });
export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const length = (a: V3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const lengthSq = (a: V3): number => a.x * a.x + a.y * a.y + a.z * a.z;
export const distance = (a: V3, b: V3): number => length(sub(a, b));
export const lerp = (a: V3, b: V3, t: number): V3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

export function normalize(a: V3): V3 {
  const l = length(a);
  if (l < 1e-12) return { x: 0, y: 1, z: 0 };
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

export function anyPerpendicular(d: V3): V3 {
  const ref = Math.abs(d.y) < 0.9 ? UP : RIGHT;
  return normalize(cross(ref, d));
}

export function projectOnPlane(v: V3, n: V3): V3 {
  return addScaled(v, n, -dot(v, n));
}

/** Rodrigues rotation of `v` around unit axis `k` by `angle` radians. */
export function rotateAxis(v: V3, k: V3, angle: number): V3 {
  if (Math.abs(angle) < 1e-9) return clone(v);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const kv = dot(k, v);
  const kxv = cross(k, v);
  return {
    x: v.x * c + kxv.x * s + k.x * kv * (1 - c),
    y: v.y * c + kxv.y * s + k.y * kv * (1 - c),
    z: v.z * c + kxv.z * s + k.z * kv * (1 - c),
  };
}

export function rotateTowards(from: V3, to: V3, maxAngle: number): V3 {
  const d = Math.max(-1, Math.min(1, dot(from, to) / (length(from) * length(to) || 1)));
  const ang = Math.acos(d);
  if (ang <= maxAngle || ang < 1e-7) return normalize(to);
  let axis = cross(from, to);
  if (lengthSq(axis) < 1e-12) axis = anyPerpendicular(from);
  return rotateAxis(from, normalize(axis), maxAngle);
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const saturate = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp1 = (a: number, b: number, t: number): number => a + (b - a) * t;
export const mod = (a: number, n: number): number => ((a % n) + n) % n;

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const d = edge1 - edge0;
  if (Math.abs(d) < 1e-9) return x >= edge0 ? 1 : 0;
  const t = saturate((x - edge0) / d);
  return t * t * (3 - 2 * t);
}

export interface CurveFrame {
  pos: V3;
  /** Unit tangent pointing toward tip. */
  dir: V3;
  /** Lateral width axis (right). */
  right: V3;
  /** Dorsal/adaxial normal = cross(dir, right). */
  up: V3;
  /** Normalised parameter t in [0, 1]. */
  t: number;
  /** Arc length from start. */
  s: number;
}

export interface CurveTurn {
  /** Pitch about `right` (positive curls downward toward -up). */
  pitch?: number;
  /** Gravity droop toward -UP around horizontal axis. */
  gravity?: number;
  /** Lateral sway about `up`. */
  yaw?: number;
  /** Axial twist about `dir`. */
  roll?: number;
}

/**
 * Parallel-transported 3D centreline used for fern stipes/rachises, pinna
 * midribs, coiled fiddleheads, moss gametophytes/setae, and guide hairs.
 */
export class CurveLine {
  readonly pts: V3[] = [];
  readonly dirs: V3[] = [];
  readonly rights: V3[] = [];
  readonly ups: V3[] = [];
  readonly ss: number[] = [];

  get length(): number {
    return this.ss.length ? this.ss[this.ss.length - 1] : 0;
  }

  get count(): number {
    return this.pts.length;
  }

  push(pos: V3, dir: V3, right: V3): void {
    const n = this.pts.length;
    const d = normalize(dir);
    let r = projectOnPlane(right, d);
    r = lengthSq(r) < 1e-12 ? anyPerpendicular(d) : normalize(r);
    const u = normalize(cross(d, r));
    this.ss.push(n === 0 ? 0 : this.ss[n - 1] + distance(pos, this.pts[n - 1]));
    this.pts.push(clone(pos));
    this.dirs.push(d);
    this.rights.push(r);
    this.ups.push(u);
  }

  frameAtIndex(i: number): CurveFrame {
    const k = clamp(i, 0, this.pts.length - 1);
    const L = Math.max(1e-9, this.length);
    return {
      pos: clone(this.pts[k]),
      dir: clone(this.dirs[k]),
      right: clone(this.rights[k]),
      up: clone(this.ups[k]),
      s: this.ss[k],
      t: this.ss[k] / L,
    };
  }

  /** Sample smoothly at normalised parameter `t` in [0, 1]. */
  atT(t: number): CurveFrame {
    return this.atS(saturate(t) * this.length);
  }

  /** Sample smoothly at arc length `s`. */
  atS(s: number): CurveFrame {
    const n = this.pts.length;
    const L = Math.max(1e-9, this.length);
    if (n === 0) return { pos: v3(), dir: UP, right: RIGHT, up: FWD, s: 0, t: 0 };
    if (s <= 0 || n === 1) return { pos: clone(this.pts[0]), dir: clone(this.dirs[0]), right: clone(this.rights[0]), up: clone(this.ups[0]), s: 0, t: 0 };
    if (s >= L) return { pos: clone(this.pts[n - 1]), dir: clone(this.dirs[n - 1]), right: clone(this.rights[n - 1]), up: clone(this.ups[n - 1]), s: L, t: 1 };
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.ss[mid] <= s) lo = mid;
      else hi = mid;
    }
    const u = (s - this.ss[lo]) / Math.max(1e-12, this.ss[hi] - this.ss[lo]);
    const pos = lerp(this.pts[lo], this.pts[hi], u);
    const dir = normalize(lerp(this.dirs[lo], this.dirs[hi], u));
    let right = projectOnPlane(lerp(this.rights[lo], this.rights[hi], u), dir);
    right = lengthSq(right) < 1e-12 ? anyPerpendicular(dir) : normalize(right);
    const up = normalize(cross(dir, right));
    return { pos, dir, right, up, s, t: s / L };
  }
}

export function growCurve(
  pos0: V3,
  dir0: V3,
  right0: V3,
  totalLength: number,
  steps: number,
  turnFn: (t0: number, t1: number, curDir: V3, curPos: V3) => CurveTurn,
): CurveLine {
  const line = new CurveLine();
  let p = clone(pos0);
  let d = normalize(dir0);
  let r = projectOnPlane(right0, d);
  r = lengthSq(r) < 1e-12 ? anyPerpendicular(d) : normalize(r);
  line.push(p, d, r);
  const n = Math.max(1, Math.round(steps));
  const ds = totalLength / n;
  for (let k = 0; k < n; k++) {
    const t0 = k / n;
    const t1 = (k + 1) / n;
    const tr = turnFn(t0, t1, d, p);
    if (tr.pitch) {
      d = rotateAxis(d, r, tr.pitch);
    }
    if (tr.gravity) {
      let h = cross(UP, d);
      h = lengthSq(h) < 1e-8 ? r : normalize(h);
      d = rotateAxis(d, h, tr.gravity);
      r = rotateAxis(r, h, tr.gravity);
    }
    if (tr.yaw) {
      const u = normalize(cross(d, r));
      d = rotateAxis(d, u, tr.yaw);
      r = rotateAxis(r, u, tr.yaw);
    }
    if (tr.roll) {
      r = rotateAxis(r, d, tr.roll);
    }
    d = normalize(d);
    r = projectOnPlane(r, d);
    r = lengthSq(r) < 1e-12 ? anyPerpendicular(d) : normalize(r);
    p = addScaled(p, d, ds);
    line.push(p, d, r);
  }
  return line;
}

/** Build a Bishop parallel-transported CurveLine from an arbitrary point array. */
export function curveFromPoints(pts: V3[], initialRight?: V3): CurveLine {
  const line = new CurveLine();
  if (pts.length === 0) return line;
  if (pts.length === 1) {
    line.push(pts[0], UP, initialRight ?? RIGHT);
    return line;
  }
  let prevDir = normalize(sub(pts[1], pts[0]));
  let r = initialRight ? projectOnPlane(initialRight, prevDir) : anyPerpendicular(prevDir);
  r = lengthSq(r) < 1e-10 ? anyPerpendicular(prevDir) : normalize(r);
  line.push(pts[0], prevDir, r);
  for (let i = 1; i < pts.length; i++) {
    const dir = i < pts.length - 1 ? normalize(sub(pts[i + 1], pts[i - 1])) : normalize(sub(pts[i], pts[i - 1]));
    const axis = cross(prevDir, dir);
    const axisLen = length(axis);
    if (axisLen > 1e-7) {
      const ang = Math.acos(clamp(dot(prevDir, dir), -1, 1));
      r = rotateAxis(r, scale(axis, 1 / axisLen), ang);
    }
    r = projectOnPlane(r, dir);
    r = lengthSq(r) < 1e-10 ? anyPerpendicular(dir) : normalize(r);
    line.push(pts[i], dir, r);
    prevDir = dir;
  }
  return line;
}

// -----------------------------------------------------------------------------
// Physical & botanical color helpers
// -----------------------------------------------------------------------------

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function hexToLinearRgb(hex: string): RGB {
  const h = hex.replace('#', '').trim();
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16) || 0;
  return {
    r: srgbToLinear(((n >> 16) & 255) / 255),
    g: srgbToLinear(((n >> 8) & 255) / 255),
    b: srgbToLinear((n & 255) / 255),
  };
}

export const rgb = (r: number, g: number, b: number): RGB => ({ r, g, b });
export const mixRgb = (a: RGB, b: RGB, t: number): RGB => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t,
});
export const scaleRgb = (a: RGB, s: number): RGB => ({ r: a.r * s, g: a.g * s, b: a.b * s });

/**
 * Physical hair/fur pigment model (d'Eon et al. / Marschner melanin absorption):
 * `eumelanin` (0 = blonde/white -> 1 = raven black) + `pheomelanin` (0 -> 1 = red/auburn/fox).
 * Returns linear RGB albedo.
 */
export function melaninToLinearRgb(eumelanin: number, pheomelanin: number, bleach = 0): RGB {
  const eu = Math.max(0, eumelanin * (1 - bleach * 0.78));
  const ph = Math.max(0, pheomelanin * (1 - bleach * 0.45));
  // Spectral absorption coefficients (linear RGB)
  const sigmaR = eu * 0.419 + ph * 0.187;
  const sigmaG = eu * 0.697 + ph * 0.4;
  const sigmaB = eu * 1.37 + ph * 1.05;
  return {
    r: clamp(Math.exp(-sigmaR * 2.35), 0.012, 0.96),
    g: clamp(Math.exp(-sigmaG * 2.35), 0.01, 0.94),
    b: clamp(Math.exp(-sigmaB * 2.35), 0.008, 0.92),
  };
}
