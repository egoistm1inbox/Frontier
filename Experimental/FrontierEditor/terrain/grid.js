// Derived maps read by masks and by the texturing stack. Every function takes the current surface and
// returns a fresh Float32Array (N × N, row-major, index = j * N + i).

import { SimplexNoise } from './noise.js';
import { computeSlopeMap, computeCavity } from './strata.js';
import { fillDepressions, flowDirections, NO_WATER } from './routing.js';

// slope in degrees
export function slopeDegrees(height, N, cell) {
  const s = computeSlopeMap(height, N, cell);
  for (let i = 0; i < s.length; i++) s[i] = (Math.atan(s[i]) * 180) / Math.PI;
  return s;
}

// curvature, normalised to [-1, 1]: + on crests (convex), − in gullies (concave)
export function curvatureNorm(height, N, cell) {
  const c = computeCavity(height, N, cell);
  const abs = new Float32Array(c.length);
  for (let i = 0; i < c.length; i++) abs[i] = Math.abs(c[i]);
  abs.sort();
  const scale = abs[Math.floor(abs.length * 0.98)] || 1;
  for (let i = 0; i < c.length; i++) c[i] = Math.max(-1, Math.min(1, c[i] / scale));
  return c;
}

// drainage: accumulated upslope area (cells) and a log-normalised 0..1 flow strength
export function drainage(height, N, cell, sea) {
  const total = N * N;
  const { filled, order } = fillDepressions(height, N, sea, 1e-4);
  const down = flowDirections(filled, N);
  const acc = new Float32Array(total).fill(1);
  for (let k = order.length - 1; k >= 0; k--) {
    const c = order[k], d = down[c];
    if (d >= 0) acc[d] += acc[c];
  }
  let max = 1;
  for (let i = 0; i < total; i++) if (acc[i] > max) max = acc[i];
  const lm = Math.log(max) || 1;
  const flowN = new Float32Array(total);
  for (let i = 0; i < total; i++) flowN[i] = Math.log(acc[i]) / lm;
  return { acc, flowN };
}

// chamfer distance (metres) to the nearest cell where `mask` is non-zero
export function distanceTo(mask, N, cell) {
  const total = N * N, INF = 1e9, d = new Float32Array(total);
  for (let i = 0; i < total; i++) d[i] = mask[i] ? 0 : INF;
  const SQ = Math.SQRT2;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const c = j * N + i;
      if (i > 0) d[c] = Math.min(d[c], d[c - 1] + 1);
      if (j > 0) d[c] = Math.min(d[c], d[c - N] + 1);
      if (i > 0 && j > 0) d[c] = Math.min(d[c], d[c - N - 1] + SQ);
      if (i < N - 1 && j > 0) d[c] = Math.min(d[c], d[c - N + 1] + SQ);
    }
  }
  for (let j = N - 1; j >= 0; j--) {
    for (let i = N - 1; i >= 0; i--) {
      const c = j * N + i;
      if (i < N - 1) d[c] = Math.min(d[c], d[c + 1] + 1);
      if (j < N - 1) d[c] = Math.min(d[c], d[c + N] + 1);
      if (i < N - 1 && j < N - 1) d[c] = Math.min(d[c], d[c + N + 1] + SQ);
      if (i > 0 && j < N - 1) d[c] = Math.min(d[c], d[c + N - 1] + SQ);
    }
  }
  for (let i = 0; i < total; i++) d[i] *= cell;
  return d;
}

// wet cells: a surface that stands above the ground (rivers, lakes, sea)
export function wetMask(water, height) {
  const out = new Uint8Array(water.length);
  for (let i = 0; i < water.length; i++) out[i] = water[i] > NO_WATER / 2 && water[i] > height[i] + 0.02 ? 1 : 0;
  return out;
}

// water depth, normalised: 0 dry, 1 at 0.4 m and deeper
export function wetDepth01(water, height) {
  const out = new Float32Array(water.length);
  for (let i = 0; i < water.length; i++) {
    if (water[i] > NO_WATER / 2 && water[i] > height[i] + 0.02) out[i] = Math.min(1, (water[i] - height[i]) / 0.4);
  }
  return out;
}

// fractal noise in [0, 1] sampled at metre coordinates
export function fbmField(N, size, seed, scaleM, octaves = 3) {
  const cell = size / (N - 1);
  const n = new SimplexNoise((seed | 0) * 17 + 3);
  const out = new Float32Array(N * N);
  const s = Math.max(1, scaleM);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      out[j * N + i] = 0.5 + 0.5 * n.fbm((i * cell) / s, (j * cell) / s, octaves, 2, 0.5);
    }
  }
  return out;
}
