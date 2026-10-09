/**
 * Frontier Landscape Studio — procedural field noise.
 *
 * Everything here is deterministic: the same seed and the same coordinates
 * always produce the same value, so a layer stack bakes identically on every
 * machine, in the worker and on the main thread alike.
 */

/** Small, fast, well-distributed 32-bit PRNG. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer lattice hash in [0,1). Used for feature points and jitter. */
export function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Two independent hashes for a lattice cell. */
export function hash2v(ix, iy, seed) {
  return [hash2(ix, iy, seed), hash2(ix, iy, seed + 7919)];
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => t * t * (3 - 2 * t);
const quintic = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * Classic Perlin gradient noise, 2D, returning roughly [-1, 1].
 * A permutation table per seed keeps it cheap and allocation-free in the loop.
 */
export class Perlin {
  constructor(seed = 1337) {
    const rand = mulberry32(seed);
    const p = new Uint8Array(512);
    const source = new Uint8Array(256);
    for (let i = 0; i < 256; i++) source[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      const t = source[i];
      source[i] = source[j];
      source[j] = t;
    }
    for (let i = 0; i < 512; i++) p[i] = source[i & 255];
    this.perm = p;
  }

  /** Gradient from the low four bits of the permutation value. */
  static grad(hash, x, y) {
    switch (hash & 7) {
      case 0: return x + y;
      case 1: return x - y;
      case 2: return -x + y;
      case 3: return -x - y;
      case 4: return x;
      case 5: return -x;
      case 6: return y;
      default: return -y;
    }
  }

  noise(x, y) {
    const p = this.perm;
    const fx = Math.floor(x), fy = Math.floor(y);
    const X = fx & 255, Y = fy & 255;
    const dx = x - fx, dy = y - fy;
    const u = quintic(dx), v = quintic(dy);
    const aa = p[p[X] + Y], ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
    const x1 = lerp(Perlin.grad(aa, dx, dy), Perlin.grad(ba, dx - 1, dy), u);
    const x2 = lerp(Perlin.grad(ab, dx, dy - 1), Perlin.grad(bb, dx - 1, dy - 1), u);
    return lerp(x1, x2, v) * 0.7;
  }
}

export const lerp = (a, b, t) => a + (b - a) * t;

/** Fractal Brownian motion in [0,1]. */
export function fbm(perlin, x, y, octaves = 6, lacunarity = 2.0, gain = 0.5, warp = 0) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  let ox = 0, oy = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * perlin.noise((x + ox) * freq, (y + oy) * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
    if (warp > 0 && i < octaves - 1) {
      ox += warp * perlin.noise((x + 31.7) * freq * 0.5, (y + 47.3) * freq * 0.5);
      oy += warp * perlin.noise((x + 91.1) * freq * 0.5, (y + 13.9) * freq * 0.5);
    }
  }
  return clamp01(sum / (norm || 1) * 0.5 + 0.5);
}

/** Ridged multifractal in [0,1] — sharp creases, good for mountain spines. */
export function ridged(perlin, x, y, octaves = 6, lacunarity = 2.0, gain = 0.5, sharpness = 1.0) {
  let amp = 1, freq = 1, sum = 0, norm = 0, weight = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(perlin.noise(x * freq, y * freq));
    n = Math.pow(Math.max(0, n), sharpness);
    n *= weight;
    weight = clamp01(n * 2);
    sum += n * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return clamp01(sum / (norm || 1));
}

/** Billow in [0,1] — rounded hills. */
export function billow(perlin, x, y, octaves = 6, lacunarity = 2.0, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * (Math.abs(perlin.noise(x * freq, y * freq)) * 2 - 1);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return clamp01(sum / (norm || 1) * 0.5 + 0.5);
}

/**
 * Cellular / Voronoi field in [0,1].
 * `mode`: 0 = distance to nearest feature (cells), 1 = F2-F1 (cracks),
 * 2 = smooth blend of the two (mesas).
 */
export function cellular(x, y, seed, mode = 0, smoothness = 0.2) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let f1 = 1e9, f2 = 1e9;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = ix + ox, cy = iy + oy;
      const [hx, hy] = hash2v(cx, cy, seed);
      const dx = ox + hx - (x - ix), dy = oy + hy - (y - iy);
      const d = dx * dx + dy * dy;
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  f1 = Math.sqrt(f1); f2 = Math.sqrt(f2);
  if (mode === 0) return clamp01(f1);
  if (mode === 1) return clamp01((f2 - f1) * 1.6);
  const t = smoothness;
  return clamp01(lerp(f1, f2 - f1, t) * 1.4);
}

/** Domain-warped fbm — breaks up the repetitive look of plain fractal noise. */
export function warpedFbm(perlin, x, y, octaves, lacunarity, gain, warpAmount, warpSeed, warpScale) {
  if (warpAmount <= 0) return fbm(perlin, x, y, octaves, lacunarity, gain, 0);
  const wx = fbm(perlin, x * warpScale + 5.2, y * warpScale + 1.3, Math.max(2, (octaves / 2) | 0), lacunarity, gain, 0);
  const wy = fbm(perlin, x * warpScale + 9.7, y * warpScale + 6.1, Math.max(2, (octaves / 2) | 0), lacunarity, gain, 0);
  return fbm(perlin, (x + (wx - 0.5) * warpAmount) , (y + (wy - 0.5) * warpAmount), octaves, lacunarity, gain, 0);
}

/** Remap a value from one range to another. */
export function remap(v, a0, a1, b0, b1) {
  if (a1 === a0) return b0;
  return b0 + ((v - a0) / (a1 - a0)) * (b1 - b0);
}

export { clamp01, smooth, quintic };
