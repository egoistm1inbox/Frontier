/** Small vector/scalar helpers (allocation-light, plain objects). */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const clone = (a: V3): V3 => ({ x: a.x, y: a.y, z: a.z });
export const set = (o: V3, x: number, y: number, z: number): V3 => {
  o.x = x;
  o.y = y;
  o.z = z;
  return o;
};
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const addScaled = (a: V3, b: V3, s: number): V3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const lengthSq = (a: V3): number => a.x * a.x + a.y * a.y + a.z * a.z;
export const length = (a: V3): number => Math.sqrt(lengthSq(a));
export const normalize = (a: V3): V3 => {
  const l = length(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
export const lerpV = (a: V3, b: V3, t: number): V3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const mod = (n: number, m: number): number => ((n % m) + m) % m;

/** Rotate `v` around unit `axis` by `angle` radians (Rodrigues). */
export function rotateAxis(v: V3, axis: V3, angle: number): V3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = dot(axis, v) * (1 - c);
  return {
    x: v.x * c + (axis.y * v.z - axis.z * v.y) * s + axis.x * d,
    y: v.y * c + (axis.z * v.x - axis.x * v.z) * s + axis.y * d,
    z: v.z * c + (axis.x * v.y - axis.y * v.x) * s + axis.z * d,
  };
}

/** Any unit vector perpendicular to `a`. */
export function anyPerpendicular(a: V3): V3 {
  const ax = Math.abs(a.x);
  const ay = Math.abs(a.y);
  const az = Math.abs(a.z);
  const other = ax <= ay && ax <= az ? v3(1, 0, 0) : ay <= az ? v3(0, 1, 0) : v3(0, 0, 1);
  return normalize(cross(a, other));
}

/**
 * Orthonormal ring frame for tangent T with profile +y biased toward `up`.
 * Returns (U, V) with U × V = T, so profile points (x·U + y·V) wind CCW when
 * viewed from the tip looking back toward the base.
 */
export function frameFromUp(T: V3, up: V3): { U: V3; V: V3 } {
  let V = sub(up, scale(T, dot(up, T)));
  if (lengthSq(V) < 1e-8) V = anyPerpendicular(T);
  V = normalize(V);
  const U = cross(V, T);
  return { U, V };
}

/** Direction from azimuth (around Y, radians) and elevation above horizon (radians). */
export function dirFromAzEl(az: number, el: number): V3 {
  const c = Math.cos(el);
  return { x: Math.cos(az) * c, y: Math.sin(el), z: Math.sin(az) * c };
}

/** Parse '#rrggbb' (authored in sRGB) into linear-sRGB [r,g,b] in 0..1. */
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  if (Number.isNaN(n)) return [1, 1, 1];
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255)];
}

export function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
