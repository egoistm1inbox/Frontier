// Deterministic hashing and noise fields for the terrain pipeline.
// Everything here is pure and dependency-free so the same code runs in the
// browser, in the Web Worker and in the Node check script.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Integer lattice hash → [0,1)
export function ihash(x, y, seed) {
  let h = (seed | 0) ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * (3 - 2 * t);

export function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
export function smoothstep(a, b, x) {
  if (b <= a) return x < a ? 0 : 1;
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
export function fract(v) { return v - Math.floor(v); }
export function lerp(a, b, t) { return a + (b - a) * t; }

// Value noise, [0,1]
export function valueNoise(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const u = fade(fx), v = fade(fy);
  const a = ihash(x0, y0, seed), b = ihash(x0 + 1, y0, seed);
  const c = ihash(x0, y0 + 1, seed), d = ihash(x0 + 1, y0 + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Gradient (Perlin) noise, roughly [0,1]
export function perlinNoise(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const u = fade(fx), v = fade(fy);
  const dot = (ix, iy, dx, dy) => {
    const a = ihash(ix, iy, seed) * Math.PI * 2;
    return Math.cos(a) * dx + Math.sin(a) * dy;
  };
  const n0 = dot(x0, y0, fx, fy);
  const n1 = dot(x0 + 1, y0, fx - 1, fy);
  const n2 = dot(x0, y0 + 1, fx, fy - 1);
  const n3 = dot(x0 + 1, y0 + 1, fx - 1, fy - 1);
  return 0.5 + 0.5 * (n0 + (n1 - n0) * u + (n2 - n0) * v + (n0 - n1 - n2 + n3) * u * v);
}

// Fractal Brownian motion, [-1,1]
export function fbm(x, y, o = {}) {
  const octaves = o.octaves || 4, persistence = o.persistence ?? 0.5,
    lacunarity = o.lacunarity || 2, seed = o.seed || 1;
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += (perlinNoise(x * freq, y * freq, seed + i * 101.3) * 2 - 1) * amp;
    norm += amp; amp *= persistence; freq *= lacunarity;
  }
  return norm ? sum / norm : 0;
}

// Ridged multifractal, [0,1]
export function ridged(x, y, o = {}) {
  const octaves = o.octaves || 4, persistence = o.persistence ?? 0.5,
    lacunarity = o.lacunarity || 2, seed = o.seed || 1, gain = o.gain ?? 2;
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(perlinNoise(x * freq, y * freq, seed + i * 57.7) * 2 - 1);
    n *= n;
    const w = Math.min(1, n * gain);
    sum += n * w * amp;
    norm += amp; amp *= persistence; freq *= lacunarity;
  }
  return norm ? sum / norm : 0;
}

// Billow noise, [-1,1]
export function billow(x, y, o = {}) {
  const octaves = o.octaves || 4, persistence = o.persistence ?? 0.5,
    lacunarity = o.lacunarity || 2, seed = o.seed || 1;
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += (Math.abs(perlinNoise(x * freq, y * freq, seed + i * 13.7) * 2 - 1) * 2 - 1) * amp;
    norm += amp; amp *= persistence; freq *= lacunarity;
  }
  return norm ? sum / norm : 0;
}

// Musgrave-style multifractal, [-1,1]
export function multifractal(x, y, o = {}) {
  const octaves = o.octaves || 4, lacunarity = o.lacunarity || 2,
    seed = o.seed || 1, gain = o.gain ?? 0.7, offset = o.offset ?? 0.4;
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += ((perlinNoise(x * freq, y * freq, seed + i * 29.9) * 2 - 1) + offset) * amp;
    norm += amp; amp *= gain; freq *= lacunarity;
  }
  return norm ? sum / norm : 0;
}

// Voronoi F1 distance, ~[0,1.2]
export function voronoiF1(x, y, seed, jitter = 1) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let best = 8;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = xi + dx, cy = yi + dy;
    const px = cx + 0.5 + (ihash(cx, cy, seed) - 0.5) * jitter;
    const py = cy + 0.5 + (ihash(cx, cy, seed + 7919) - 0.5) * jitter;
    const d = Math.hypot(px - x, py - y);
    if (d < best) best = d;
  }
  return best;
}
