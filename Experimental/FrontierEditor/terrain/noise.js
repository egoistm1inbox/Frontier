// Deterministic 2-D noise for the terrain stack. Pure functions, no DOM, so the same numbers come out in the
// browser and in the Node checks under terrain/. Everything is seeded: a given stack + seed always rebuilds the
// same heightfield.

export function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

// Value noise in [0, 1].
export function valueNoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}

// Fractal Brownian motion in roughly [-1, 1]. `frequency` is in noise cells per world tile.
export function fbm(x, y, { octaves = 6, lacunarity = 2.02, gain = 0.5, seed = 1 } = {}) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * (valueNoise(x * freq, y * freq, seed + o * 17) * 2 - 1);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

// Ridged multifractal in [0, 1]: sharp crests where the noise crosses its midline.
export function ridged(x, y, { octaves = 5, lacunarity = 2.1, gain = 0.5, seed = 1 } = {}) {
  let amp = 1, freq = 1, sum = 0, norm = 0, weight = 1;
  for (let o = 0; o < octaves; o++) {
    let s = 1 - Math.abs(valueNoise(x * freq, y * freq, seed + o * 31) * 2 - 1);
    s *= s;
    s *= weight;
    weight = Math.min(1, Math.max(0, s * 2));
    sum += s * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

// Blocky (stepped) noise in [0, 1]: quantises a smooth field into plateaus and risers.
export function blocky(x, y, { levels = 5, seed = 1 } = {}) {
  const n = fbm(x, y, { octaves: 3, seed }) * 0.5 + 0.5;
  return Math.floor(Math.min(0.999999, Math.max(0, n)) * levels) / levels;
}
