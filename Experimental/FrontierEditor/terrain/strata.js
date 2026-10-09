// Stratigraphic terracing (Gaea Stratify-style): one bed column shared by the terrace profile, the
// rock hardness used by erosion, and the cliff/rugged stages. Extracted from the cliff-generator
// heightfield (applyStrata) and re-homed here; computeSlopeMap / computeCavity travel with it.

import { SimplexNoise, smoothstep, lerp, clamp01 } from './noise.js';
import { makeBedTable, bedAt, bedJitter, bedHardness } from './strata-model.js';

export function applyStrata(height, params, progress = () => {}, outcrop = null) {
  const N = params.resolution;
  const size = params.worldSize;
  const hardness = new Float32Array(N * N);
  const band = Math.max(2, params.strataBand);
  const strength = params.strataStrength;
  const invN = 1 / (N - 1);
  const cell = size / (N - 1);

  // Dip plane: tilt strata by dipAngle towards dipDirection.
  const dipRad = (params.strataDip * Math.PI) / 180;
  const dirRad = (params.strataDipDirection * Math.PI) / 180;
  const gx = Math.tan(dipRad) * Math.cos(dirRad);
  const gz = Math.tan(dipRad) * Math.sin(dirRad);

  const detail = new SimplexNoise(params.seed * 5 + 77);
  // beds only show where the ground is steep enough to expose them (≈ 17° → full at 38°); gentle
  // slopes keep their soil / scree profile instead of a contour-line staircase
  const slopeMaskLo = 0.3, slopeMaskHi = 0.78;
  const table = makeBedTable(params);
  const lateral = params.strataLateral == null ? 0.18 : params.strataLateral;
  const bed = {};

  // Precompute slope of the un-terraced field so terracing targets steep ground.
  const slope = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const j0 = Math.max(0, j - 1), j1 = Math.min(N - 1, j + 1);
    for (let i = 0; i < N; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(N - 1, i + 1);
      const dx = (height[j * N + i1] - height[j * N + i0]) / ((i1 - i0) * cell);
      const dz = (height[j1 * N + i] - height[j0 * N + i]) / ((j1 - j0) * cell);
      slope[j * N + i] = Math.sqrt(dx * dx + dz * dz);
    }
  }

  for (let j = 0; j < N; j++) {
    const z = j * invN * size;
    for (let i = 0; i < N; i++) {
      const x = i * invN * size;
      const idx = j * N + i;
      const h = height[idx];

      // Work in the tilted frame so bands dip.
      const tilt = gx * x + gz * z;
      // Lateral thickness jitter keeps layers from looking machine-cut (same expression as the
      // shader and the 3-D chunks).
      const jitter = bedJitter(x, z, lateral);
      bedAt(table, (h + tilt) / jitter, bed);
      const f = bed.f, bi = bed.index;

      // Bed hardness from the stratigraphic column + intra-layer variation (lenses, joints).
      let hard = bedHardness(bed);
      hard = clamp01(hard + 0.12 * detail.fbm(x * 0.006 + bi * 3.7, z * 0.006, 3));
      hard = lerp(0.35, hard, params.hardnessContrast);

      // Terrace profile: gain curve with per-layer steepness; thin beds step less.
      const k = lerp(1.2, 9, hard);
      const fk = Math.pow(f, k);
      const fp = fk / (fk + Math.pow(1 - f, k));
      const thin = smoothstep(0.08, 0.3, bed.thick / band);
      const terraced = (table.tops[bi] - bed.thick + lerp(f, fp, thin) * bed.thick) * jitter - tilt;

      const sm = smoothstep(slopeMaskLo, slopeMaskHi, slope[idx]);
      // hard beds snap almost fully (vertical riser, flat bench); soft beds keep more of the slope;
      // and a bed's expression varies along strike (benches pinch out, ledges come and go) so the
      // hillside is not a machine-cut staircase
      const expr = 0.55 + 0.45 * (0.5 + 0.5 * detail.fbm(x * 0.0045 + bi * 1.9, z * 0.0045 - bi * 0.7, 2));
      let amount = Math.min(0.95, strength * sm * lerp(0.5, 1.1, hard) * expr);
      if (outcrop && outcrop[idx] > 0) amount *= 1 - outcrop[idx]; // massive core-stones are not bedded
      height[idx] = lerp(h, terraced, amount);
      hardness[idx] = hard;
    }
    if ((j & 31) === 0) progress(j / N);
  }
  return hardness;
}

export function computeSlopeMap(height, N, cell) {
  const out = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const j0 = Math.max(0, j - 1), j1 = Math.min(N - 1, j + 1);
    for (let i = 0; i < N; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(N - 1, i + 1);
      const dx = (height[j * N + i1] - height[j * N + i0]) / ((i1 - i0) * cell);
      const dz = (height[j1 * N + i] - height[j0 * N + i]) / ((j1 - j0) * cell);
      out[j * N + i] = Math.sqrt(dx * dx + dz * dz);
    }
  }
  return out;
}

// Cavity / convexity from a smoothed Laplacian; negative in gullies, positive on crests.
export function computeCavity(height, N, cell) {
  const out = new Float32Array(N * N);
  const radius = 2;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const c = height[j * N + i];
      let sum = 0, count = 0;
      for (let dj = -radius; dj <= radius; dj++) {
        const jj = Math.min(N - 1, Math.max(0, j + dj));
        for (let di = -radius; di <= radius; di++) {
          if (di === 0 && dj === 0) continue;
          const ii = Math.min(N - 1, Math.max(0, i + di));
          sum += height[jj * N + ii];
          count++;
        }
      }
      // Positive = convex (ridge), negative = concave (gully). Normalised by cell size.
      out[j * N + i] = (c - sum / count) / (cell * radius);
    }
  }
  return out;
}
