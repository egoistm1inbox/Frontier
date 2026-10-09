// Stratigraphy: a column of rock units with their own thickness and hardness, laid nearly flat and then cut by erosion.
// A hard unit keeps a flat bench and a steep riser across its middle. A soft unit slopes evenly from its base to its
// top. The unit boundaries are deterministic functions of position, so the satmap colours the same bands on the
// cliffs that the layer produces. This is an independent construction (a terrace whose steps follow the rock units),
// not a published method.
import { makeNoise, fbm } from '../core/noise.js';
import { clamp, mulberry32, smoothstep, hashString } from '../core/rng.js';
import { seedFor } from './primitives.js';

// Definition of a stratigraphic column, built from the layer's parameters. Heights are normalised.
export function strataDef(p, terrainSeed, heightM, extentM) {
  const K = clamp(Math.round(p.units ?? 10), 2, 16);
  const meanT = clamp((p.thickness ?? 45) / heightM, 0.005, 0.5);
  const base = clamp((p.base ?? 150) / heightM, 0, 1);
  const hardShare = clamp(p.hard ?? 0.5, 0, 1);
  const sharp = clamp(p.sharpness ?? 0.75, 0, 1);
  const seed = seedFor(terrainSeed, p.seed ?? 0, hashString('strata'));
  const rnd = mulberry32(seed);
  const bounds = [base];
  const hard = [];
  for (let k = 0; k < K; k++) {
    bounds.push(bounds[k] + meanT * (0.6 + 0.8 * rnd()));
    hard.push(rnd() < hardShare);
  }
  hard[K - 1] = true; // the top unit is the caprock
  // Dip: the beds rise toward the dip direction (degrees from north, clockwise). A slope of tan(dip) over the map width.
  const tanDip = Math.tan((clamp(p.dip ?? 3, -20, 20) * Math.PI) / 180) * (extentM / heightM);
  const az = (clamp(p.dipDirection ?? 90, 0, 360) * Math.PI) / 180;
  return {
    K,
    base,
    top: bounds[K],
    bounds,
    hard,
    dx: tanDip * Math.sin(az),
    dy: -tanDip * Math.cos(az),
    warp: clamp((p.warp ?? 12) / heightM, 0, 0.2),
    riser: 0.42 - 0.3 * sharp, // half-width of the steep band inside a hard unit, as a fraction of the unit
    cliffs: clamp(p.cliffs ?? 22, 0, 60), // only ground steeper than this (degrees) is stepped
    seed: (seed ^ 0x2f6b) >>> 0,
  };
}

export const strataNoise = (def) => makeNoise(def.seed);

// Altitude offset of the beds at map position (X, Y), 0..1. Dip plus a gentle undulation.
export function strataOffset(def, noise, X, Y) {
  return def.dx * (X - 0.5) + def.dy * (Y - 0.5) + def.warp * fbm(noise, X * 3.1 + 7.3, Y * 3.1 - 2.9, 3, 2.1, 0.5);
}

// Index of the unit that contains height zw (already corrected for the bed offset), or -1 outside the column.
export function strataUnit(def, zw) {
  if (zw < def.base || zw >= def.top) return -1;
  let k = 0;
  while (k < def.K - 1 && zw >= def.bounds[k + 1]) k++;
  return k;
}

// Maps height z through the column at offset o. Monotonic in z, continuous at every boundary, identity outside.
export function strataMap(def, z, o) {
  const zw = z - o;
  const k = strataUnit(def, zw);
  if (k < 0) return z;
  const b0 = def.bounds[k];
  const span = def.bounds[k + 1] - b0;
  const t = (zw - b0) / span;
  const g = def.hard[k] ? smoothstep(0.5 - def.riser, 0.5 + def.riser, t) : t;
  return b0 + span * g + o;
}

// Applies the column to a heightmap. The bands are only applied where the ground is steeper than def.cliffs, so
// gentle slopes and plains stay smooth and only the cliffs show their rock units. Blended by the layer opacity.
export function applyStrata(h, N, def, op, cellM, heightM) {
  const noise = strataNoise(def);
  const out = new Float32Array(h.length);
  const inv = 1 / (N - 1);
  const lo = def.cliffs - 5;
  const hi = def.cliffs + 5;
  const toM = heightM / cellM; // normalised height per cell -> metres per metre
  for (let y = 0; y < N; y++) {
    const Y = y * inv;
    const ym = Math.max(0, y - 1);
    const yp = Math.min(N - 1, y + 1);
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const z = h[i];
      out[i] = z;
      const xm = Math.max(0, x - 1);
      const xp = Math.min(N - 1, x + 1);
      const gx = ((h[y * N + xp] - h[y * N + xm]) * toM) / (xp - xm);
      const gy = ((h[yp * N + x] - h[ym * N + x]) * toM) / (yp - ym);
      const slope = (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI;
      const w = smoothstep(lo, hi, slope);
      if (w <= 0) continue;
      const m = strataMap(def, z, strataOffset(def, noise, x * inv, Y));
      out[i] = clamp(z + (m - z) * op * w, 0, 1);
    }
  }
  return out;
}
