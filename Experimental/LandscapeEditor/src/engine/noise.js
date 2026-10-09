// 2D gradient (Perlin-style) noise with a seeded permutation table.
// createNoise(seed) returns sample(x, y) in roughly [-1, 1].

import { createRandom } from './random.js';

export function createNoise(seed) {
  const random = createRandom(seed);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) base[i] = i;
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const swap = base[i];
    base[i] = base[j];
    base[j] = swap;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i += 1) perm[i] = base[i & 255];

  const gradX = new Float64Array(256);
  const gradY = new Float64Array(256);
  for (let i = 0; i < 256; i += 1) {
    const angle = random() * Math.PI * 2;
    gradX[i] = Math.cos(angle);
    gradY[i] = Math.sin(angle);
  }

  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

  return function sample(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const g00 = perm[perm[X] + Y];
    const g10 = perm[perm[X + 1] + Y];
    const g01 = perm[perm[X] + Y + 1];
    const g11 = perm[perm[X + 1] + Y + 1];
    const d00 = gradX[g00] * xf + gradY[g00] * yf;
    const d10 = gradX[g10] * (xf - 1) + gradY[g10] * yf;
    const d01 = gradX[g01] * xf + gradY[g01] * (yf - 1);
    const d11 = gradX[g11] * (xf - 1) + gradY[g11] * (yf - 1);
    const u = fade(xf);
    const v = fade(yf);
    const top = d00 + u * (d10 - d00);
    const bottom = d01 + u * (d11 - d01);
    // Scale so the usual range is close to [-1, 1].
    return (top + v * (bottom - top)) * 1.4142;
  };
}
