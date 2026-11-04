// Deterministic value noise. Integer hashing (no sin()) so CPU and GPU agree closely.
// Mirrors the GLSL in src/gpu/shaders/chunks.ts — keep both in sync.

export function hash3(x: number, y: number, z: number): number {
  let h = (Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

function lattice(x: number, y: number, z: number): number {
  return hash3(x, y, z) * (2 / 4294967295) - 1;
}

/** 3D value noise in [-1, 1] with quintic interpolation. */
export function vnoise3(px: number, py: number, pz: number): number {
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  const fx = px - ix, fy = py - iy, fz = pz - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const x00 = lerp(lattice(ix, iy, iz), lattice(ix + 1, iy, iz), ux);
  const x10 = lerp(lattice(ix, iy + 1, iz), lattice(ix + 1, iy + 1, iz), ux);
  const x01 = lerp(lattice(ix, iy, iz + 1), lattice(ix + 1, iy, iz + 1), ux);
  const x11 = lerp(lattice(ix, iy + 1, iz + 1), lattice(ix + 1, iy + 1, iz + 1), ux);
  return lerp(lerp(x00, x10, uy), lerp(x01, x11, uy), uz);
}

export function vnoise2(x: number, y: number): number {
  return vnoise3(x, y, 0.5);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function fbm3(x: number, y: number, z: number, oct: number): number {
  let a = 0.5, s = 0, n = 0;
  for (let i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * vnoise3(x, y, z);
    n += a;
    x = x * 2.03 + 17.1; y = y * 2.03 + 5.3; z = z * 2.03 + 9.7;
    a *= 0.5;
  }
  return s / n;
}

export function fbm2(x: number, y: number, oct: number): number {
  let a = 0.5, s = 0, n = 0;
  for (let i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * vnoise2(x, y);
    n += a;
    x = x * 2.03 + 17.1; y = y * 2.03 + 5.3;
    a *= 0.5;
  }
  return s / n;
}

/** Ridged multifractal in [0, 1]. */
export function ridged2(x: number, y: number, oct: number): number {
  let a = 0.5, s = 0, n = 0;
  for (let i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * (1 - Math.abs(vnoise2(x, y)));
    n += a;
    x = x * 2.03 + 17.1; y = y * 2.03 + 5.3;
    a *= 0.5;
  }
  return s / n;
}
