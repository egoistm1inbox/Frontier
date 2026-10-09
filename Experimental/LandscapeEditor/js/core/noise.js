// 2D gradient noise (Perlin, improved fade curve) with a seeded permutation, plus the fractal
// sums the generators use. Output of noise2 is close to [-1, 1]; fbm() is normalised to the same range.
import { mulberry32 } from './rng.js';

const SCALE = Math.SQRT2; // unit-gradient Perlin peaks near 1/sqrt(2); scale so the range is about [-1, 1]

export function makeNoise(seed) {
  const rnd = mulberry32(seed);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = base[i];
    base[i] = base[j];
    base[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
  const gx = new Float32Array(256);
  const gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const a = rnd() * Math.PI * 2;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return function noise2(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const aa = perm[perm[X] + Y];
    const ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y];
    const bb = perm[perm[X + 1] + Y + 1];
    const n00 = gx[aa] * xf + gy[aa] * yf;
    const n10 = gx[ba] * (xf - 1) + gy[ba] * yf;
    const n01 = gx[ab] * xf + gy[ab] * (yf - 1);
    const n11 = gx[bb] * (xf - 1) + gy[bb] * (yf - 1);
    const u = fade(xf);
    const v = fade(yf);
    const nx0 = n00 + (n10 - n00) * u;
    const nx1 = n01 + (n11 - n01) * u;
    return (nx0 + (nx1 - nx0) * v) * SCALE;
  };
}

// Fractional Brownian motion, normalised by the octave weight sum so the result stays in about [-1, 1].
export function fbm(noise, x, y, octaves, lacunarity, gain) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  const n = Math.max(1, Math.floor(octaves));
  for (let o = 0; o < n; o++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

// Ridged multifractal (Musgrave). Peaks sit on the zero crossings of the noise, so the result has sharp crests.
// Output is roughly in [0, 1.1] with high values on ridges.
export function ridgedFbm(noise, x, y, octaves, lacunarity, gain, sharpness) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let weight = 1;
  const n = Math.max(1, Math.floor(octaves));
  for (let o = 0; o < n; o++) {
    let s = 1 - Math.abs(noise(x * freq, y * freq));
    s = Math.pow(Math.max(s, 0), sharpness);
    s *= weight;
    weight = Math.min(1, Math.max(0, s * 1.6));
    sum += s * amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum;
}
