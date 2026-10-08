// Rugged outcrops (Gaea Rugged / Outcrops / Rocky-style LookDev as a heightfield operator).
//
// Breaks smooth relief into shattered rock: Voronoi plates with per-plate uplift, V crevices
// along the plate borders, small-rock pits at high density, and ridged multifractal fragmentation
// detail — masked by patch coverage, a slope window and the erosion hardness, and high-passed so
// the broad landform keeps its shape (Gaea "Rugged preserves overall shape").
//
// Topology contract with the SDF↔heightfield hybrid:
//   • the operator only ADDS a bounded, continuous height delta — the field stays single-valued,
//     so it is still a valid heightfield by construction (no folding, no tears);
//   • it runs BEFORE erosion and river simulation, so thermal settling removes any 1-cell spike,
//     droplets weather the plates, and priority-flood drainage routes over (or fills) the pits;
//   • the same Voronoi field (same seed/scale/warp, `ruggedPlates`) is re-evaluated in the SDF
//     chunk carve for crisp sub-cell crevices and in the shader for crevice shading, so geometry
//     and colour agree;
//   • amplitudes are clamped to `ruggedRelief` and crevice widths are band-limited against the
//     voxel size in the SDF carve (see sdf-chunks.js), so nothing aliases into stair-steps.
//
// Returns the rugged mask (0..1 exposed rugged rock) and mutates height/hardness in place.

import { SimplexNoise, voronoi2, smoothstep, clamp01, lerp } from './noise.js';
import { blurField } from './erosion.js';

// Sine domain warp of the plate lattice (Gaea "Warped" octaves). A sum of sines — not fbm — so
// the JS heightfield/SDF evaluation and the GLSL shading evaluate EXACTLY the same plates.
// (x, z) in metres measured from the tile corner; returns warped cell coords. `warp` 0..1.
export function ruggedWarp(x, z, scale, warp, seed) {
  const s = Math.max(4, scale);
  let u = x / s, w = z / s;
  if (warp > 0) {
    const a = warp * 0.42;
    // phases from seed mod 64: small arguments so float32 (GLSL) and float64 (JS) agree
    const sm = ((seed | 0) % 64 + 64) % 64;
    const s1 = Math.sin(sm * 0.37), s2 = Math.sin(sm * 1.13 + 2.0);
    u += a * (0.65 * Math.sin(w * 1.9 + s1) + 0.35 * Math.sin((u * 0.8 + w) * 3.1 + s2));
    w += a * (0.65 * Math.sin(u * 1.7 + s2) + 0.35 * Math.sin((w * 0.8 - u) * 2.7 + s1));
  }
  return [u, w];
}

// Plate field at a plan position: [uplift, crevice, pockets, interior].
//   uplift   smoothed per-plate value in [-1, 1] (plates pushed up / down)
//   crevice  1 on plate borders → 0 inside (V-notch mask, `width` in cell units)
//   pockets  small-rock pits (second Voronoi at 1/3 scale), 0..1 — skipped when wantPockets = 0
//   interior 0 on borders → 1 inside (for fault-style masking)
export function ruggedPlates(x, z, scale, seed, warp, width, wantPockets = 1) {
  const [u, w] = ruggedWarp(x, z, scale, warp, seed);
  const [v1, v2, edge] = voronoi2(u, w, seed | 0);
  const t = smoothstep(0, Math.max(1e-3, width), edge);
  // symmetric blend (see plateField): JS and GLSL agree exactly on the plate borders
  const avg = (v1 + v2) / 2;
  const uplift = avg + (v1 - avg) * t;
  const crevice = 1 - smoothstep(0, Math.max(1e-3, width), edge);
  // small rocks / debris pits between the big plates (Gaea Rocky "Small Rocks")
  let pockets = 0;
  if (wantPockets) {
    const [, , pEdge] = voronoi2(u * 3.1 + 7.3, w * 3.1 - 2.9, (seed ^ 0x3d85b7c1) | 0);
    pockets = 1 - smoothstep(0, 0.22, pEdge);
  }
  return [uplift, crevice, pockets, t];
}

export function ruggedSeed(params) {
  return (((params.seed | 0) * 733 + (params.ruggedSeed || 11) * 97 + 5) | 0) & 0xffffff;
}

// Single source of truth for the plate field shared by the heightfield operator, the SDF carve
// and the shader shading — same seed/scale/warp/widths everywhere or plates disagree.
export function ruggedFieldParams(params) {
  const density = Math.min(1, Math.max(-1, params.ruggedDensity || 0));
  const d01 = (density + 1) / 2;
  const relief = Math.max(0.5, params.ruggedRelief == null ? 8 : params.ruggedRelief);
  const creviceAmt = clamp01(params.ruggedCrevice == null ? 0.6 : params.ruggedCrevice);
  return {
    scale: Math.max(6, params.ruggedScale || 45),
    seed: ruggedSeed(params),
    warp: clamp01(params.ruggedWarp == null ? 0.4 : params.ruggedWarp),
    widthCells: lerp(0.30, 0.055, d01),
    depthM: relief * lerp(1.25, 0.45, d01) * creviceAmt,
    pocketM: relief * d01 * d01 * 0.35 * creviceAmt,
    relief,
  };
}

export function applyRugged(height, hardness, params, outcrop, progress = () => {}) {
  const N = params.resolution;
  const size = params.worldSize;
  const cell = size / (N - 1);
  const mask = new Float32Array(N * N);
  const amount = clamp01(params.ruggedAmount || 0);
  if (!(amount > 0)) return mask;

  const fp = ruggedFieldParams(params);
  const { scale, relief, warp, seed } = fp;
  const breakage = clamp01(params.ruggedBreakage == null ? 0.5 : params.ruggedBreakage);
  const creviceAmt = clamp01(params.ruggedCrevice == null ? 0.6 : params.ruggedCrevice);
  const density = Math.min(1, Math.max(-1, params.ruggedDensity || 0)); // −1 deep wide crevices → +1 fused + pockets
  const d01 = (density + 1) / 2;
  const octaves = Math.max(1, Math.min(4, Math.round(params.ruggedOctaves == null ? 2 : params.ruggedOctaves)));
  const sweep = Math.max(0, Math.min(4, Math.round(params.ruggedSweep == null ? 1 : params.ruggedSweep)));
  const coverage = clamp01(params.ruggedCoverage == null ? 0.6 : params.ruggedCoverage);
  const slopeLo = Math.tan(((params.ruggedSlopeMin == null ? 12 : params.ruggedSlopeMin) * Math.PI) / 180);
  const slopeHi = Math.tan(((params.ruggedSlopeMax == null ? 75 : params.ruggedSlopeMax) * Math.PI) / 180);
  const hardBias = Math.min(1, Math.max(-1, params.ruggedHardBias == null ? 0.5 : params.ruggedHardBias));
  const reverse = params.ruggedReverse ? -1 : 1;

  const coverNoise = new SimplexNoise(seed * 3 + 71);
  const detail = new SimplexNoise(seed * 5 + 13);

  // crevice width in cell units: wide + deep at negative density, narrow + shallow at positive
  const creviceWidth = fp.widthCells;
  const creviceDepth = fp.depthM / relief;
  const plateGain = lerp(1, 0.45, d01 * 0.8); // fused plates at positive density
  const pocketGain = d01 * d01;               // small-rock pits only when fused

  const invN = 1 / (N - 1);
  const delta = new Float32Array(N * N);

  for (let j = 0; j < N; j++) {
    const z = j * invN * size;
    const j0 = Math.max(0, j - 1), j1 = Math.min(N - 1, j + 1);
    for (let i = 0; i < N; i++) {
      const x = i * invN * size;
      const idx = j * N + i;
      const i0 = Math.max(0, i - 1), i1 = Math.min(N - 1, i + 1);
      const dx = (height[j * N + i1] - height[j * N + i0]) / ((i1 - i0) * cell);
      const dz = (height[j1 * N + i] - height[j0 * N + i]) / ((j1 - j0) * cell);
      const slope = Math.sqrt(dx * dx + dz * dz);

      // mask: patchy coverage × slope window × hardness bias (Gaea Outcrops Coverage)
      const patch = 0.5 + 0.5 * coverNoise.fbm(x / (scale * 4.5) + 3.7, z / (scale * 4.5) - 1.2, 3);
      const cover = smoothstep(1 - coverage - 0.18, 1 - coverage + 0.28, patch);
      if (cover <= 0.001) continue;
      const slopeW = smoothstep(slopeLo * 0.6, slopeLo + 0.03, slope) * (1 - smoothstep(slopeHi, slopeHi * 1.3 + 0.08, slope));
      if (slopeW <= 0.001) continue;
      const hard = hardness[idx];
      const hardW = hardBias >= 0 ? lerp(1, smoothstep(0.3, 0.7, hard), hardBias) : lerp(1, 1 - smoothstep(0.3, 0.7, hard), -hardBias);
      let m = cover * slopeW * hardW;
      if (outcrop && outcrop[idx] > 0) m *= 1 - 0.3 * outcrop[idx]; // core-stones keep their own form
      if (m <= 0.001) continue;

      // broken plates + crevices + pockets
      const [uplift, crevice, pockets] = ruggedPlates(x, z, scale, seed, warp, creviceWidth, pocketGain > 0.001 ? 1 : 0);
      // ridged fragmentation detail (Gaea Fragmentation / Rocky Breakage), zero-mean-ish
      let frag = 0, amp = 1, norm = 0, f = 1 / scale;
      for (let o = 0; o < octaves; o++) {
        const n = detail.ridged(x * f * 2.2 + o * 13.1, z * f * 2.2 - o * 7.7, 3, 2.1, 0.5, 2);
        frag += (n - 0.62) * amp; norm += amp; amp *= 0.55; f *= 2.3;
      }
      frag /= norm;
      let d = (uplift * (0.35 + 0.65 * breakage) * plateGain
        - Math.pow(crevice, 1.4) * creviceDepth
        - pockets * pocketGain * 0.35 * creviceAmt
        + frag * 0.55 * (0.3 + 0.7 * breakage)) * relief * reverse;
      // bounded by construction: never more than one relief up or down (topology: gradients stay
      // finite, thermal + flood fill downstream see nothing pathological)
      d = Math.max(-relief, Math.min(relief, d));
      delta[idx] = d * m;
      mask[idx] = m * clamp01(Math.abs(d) / relief * 1.6 + crevice * m * 0.5);
    }
    if ((j & 63) === 0) progress(j / N * 0.7);
  }

  // Gaea "Sweep": a few lateral smoothing passes on the raw delta.
  let swept = delta;
  if (sweep > 0) { swept = blurField(delta, N, sweep); progress(0.75); }

  // Preserve the overall shape: subtract the local mean so only detail remains (Gaea Rugged).
  const radius = Math.min(8, Math.max(2, Math.round(scale / cell / 2)));
  const lowPassed = blurField(swept, N, radius);
  progress(0.85);
  const hardBoost = 0.55 + 0.35 * breakage;
  for (let i = 0; i < N * N; i++) {
    const d = (swept[i] - lowPassed[i]) * amount;
    if (d !== 0) {
      height[i] += d;
      // exposed rugged rock resists erosion like caprock (plates survive, crevices channel flow)
      if (mask[i] > 0) hardness[i] = Math.max(hardness[i], mask[i] * hardBoost);
    }
  }
  progress(1);
  return mask;
}
