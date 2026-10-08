// Base heightfield synthesis: domain-warped ridged multifractal mountains, continental
// relief mask, optional canyon incision, mesa plateaus and — the cliff-maker — layered
// strata terracing with per-layer hardness (hard caprock → vertical face, soft layer → slope).
//
// Heights are in metres. The grid covers worldSize × worldSize metres, resolution N × N.

import { SimplexNoise, hash2, smoothstep, lerp, clamp01 } from './noise.js';
import { makeBedTable, bedAt, bedJitter, bedHardness } from './strata-model.js';

export function synthesizeBase(params, progress = () => {}) {
  const N = params.resolution;
  const size = params.worldSize;
  const noise = new SimplexNoise(params.seed);
  const warpNoise = new SimplexNoise(params.seed * 7 + 13);
  const maskNoise = new SimplexNoise(params.seed * 3 + 101);
  const height = new Float32Array(N * N);

  const freq = params.baseFrequency;
  const warpAmp = params.warpStrength * 0.35;
  const invN = 1 / (N - 1);

  // Canyon centreline wanders with low-frequency noise so the gorge meanders.
  const canyonNoise = new SimplexNoise(params.seed * 11 + 7);

  // Transverse dunes: asymmetric ridges across the wind, in fields.
  const duneAmp = params.duneAmount || 0;
  const duneNoise = new SimplexNoise(params.seed * 17 + 23);
  const duneDir = ((params.duneDirection || 0) * Math.PI) / 180;
  const duneCos = Math.cos(duneDir), duneSin = Math.sin(duneDir);
  const duneLambda = Math.max(10, params.duneWavelength || 140);
  const crest = Math.min(0.95, Math.max(0.5, params.duneAsymmetry == null ? 0.68 : params.duneAsymmetry));
  const duneCover = params.duneCoverage == null ? 0.6 : params.duneCoverage;

  for (let j = 0; j < N; j++) {
    const v = j * invN;
    for (let i = 0; i < N; i++) {
      const u = i * invN;

      // Domain warp — bends ridgelines so they stop looking like noise contours.
      const wx = warpNoise.fbm(u * freq * 0.8 + 3.1, v * freq * 0.8 + 1.7, 4, 2, 0.5);
      const wy = warpNoise.fbm(u * freq * 0.8 - 5.3, v * freq * 0.8 + 8.9, 4, 2, 0.5);
      const px = u * freq + wx * warpAmp;
      const py = v * freq + wy * warpAmp;

      // Ridged mountains with a touch of fbm so that lowlands have gentle rolling relief.
      let r = noise.ridged(px, py, 9, 2.07, 0.5, params.ridgeSharpness);
      r = Math.pow(r, params.peakPower);
      const rolling = 0.5 + 0.5 * noise.fbm(px * 2.3 + 40, py * 2.3 - 12, 5, 2, 0.55);

      // Continental mask: where mountains rise vs. plains / sea floor.
      const m = 0.5 + 0.5 * maskNoise.fbm(u * params.reliefFrequency + 0.3, v * params.reliefFrequency - 0.6, 4, 2, 0.5);
      const mask = smoothstep(0.5 - params.reliefContrast * 0.5, 0.5 + params.reliefContrast * 0.5, m);

      let h = (r * mask + rolling * 0.08 * (1 - mask * 0.5)) * params.mountainHeight;
      h += (mask - 0.5) * params.mountainHeight * 0.25;
      h += params.baseElevation;

      // Mesa plateau — soft minimum clamps peaks into flat tops.
      if (params.plateauStrength > 0) {
        const cap = params.plateauHeight;
        const k = lerp(220, 8, params.plateauStrength);
        const soft = cap - softplus(cap - h, k) + softplus(h - cap, k) * (1 - params.plateauStrength);
        h = lerp(h, soft, params.plateauStrength);
      }

      // Canyon incision — a meandering gorge cut through everything.
      if (params.canyonDepth > 0) {
        const cx = 0.5 + 0.22 * canyonNoise.fbm(v * 1.6 + 2.0, 0.37, 3, 2, 0.5)
          + 0.04 * canyonNoise.fbm(v * 6.0 + 9.0, 1.21, 3, 2, 0.5);
        const d = Math.abs(u - cx) * size;
        const halfWidth = params.canyonWidth * 0.5;
        const profile = 1 - smoothstep(halfWidth * 0.25, halfWidth, d);
        const floorNoise = 1 + 0.15 * noise.fbm(u * 20, v * 20, 3);
        h -= params.canyonDepth * profile * floorNoise;
      }

      if (duneAmp > 0) {
        const xw = (u - 0.5) * size, zw = (v - 0.5) * size;
        // along-wind coordinate, bent by low-frequency noise so crests curve (barchanoid ridges)
        const bend = duneNoise.fbm(u * 3 + 11, v * 3 - 4, 3) * 0.6 + duneNoise.fbm(u * 9 + 2, v * 9 + 6, 2) * 0.12;
        const sCoord = (xw * duneCos + zw * duneSin) / duneLambda + bend;
        const fr = sCoord - Math.floor(sCoord);
        // long windward slope up to the crest, short slip face down (at the angle of repose it is the
        // thermal pass that finishes the slip face)
        const profile = duneProfile(fr, crest, duneLambda, duneAmp);
        // dune fields come and go
        const fieldMask = smoothstep(0.5 - duneCover * 0.5, 0.5 + duneCover * 0.35, 0.5 + 0.5 * duneNoise.fbm(u * 2.2 + 31, v * 2.2 + 7, 3));
        // compound dunes: a smaller set of dunes climbing the windward slope of the big ones
        const s2 = sCoord * 2.6 + bend * 2.5 + duneNoise.fbm(u * 6 + 17, v * 6 - 9, 2) * 0.8;
        const fr2 = s2 - Math.floor(s2);
        const minor = (fr2 < 0.7 ? Math.pow(fr2 / 0.7, 1.5) : 1 - smoothstep(0.7, 1, fr2)) * 0.07 * smoothstep(0.15, 0.6, fr) * (fr < crest ? 1 : 0.1);
        const local = 0.75 + 0.25 * duneNoise.fbm(u * 5 + 3, v * 5 + 9, 2);
        h += duneAmp * (profile + minor) * fieldMask * local;
      }

      height[j * N + i] = h;
    }
    if ((j & 31) === 0) progress(j / N);
  }
  return height;
}

// Transverse dune cross-section on [0,1): gently concave windward slope steepening to a sharp
// brink, a straight slip face at the angle of repose, a short toe and an interdune flat.
function duneProfile(fr, crest, lambda, amp) {
  if (fr < crest) return Math.pow(fr / crest, 1.7); // steepens all the way to the brink
  // slip face: drop at ~33° with a rounded toe; if the wavelength leaves room the floor stays flat
  const run = (fr - crest) * lambda;
  const slipLen = amp / Math.tan((33 * Math.PI) / 180);
  const t = Math.min(1, run / Math.max(1e-3, slipLen));
  const a = 0.25;
  const y = t <= 1 - a ? 1 - t - a / 2 : (1 - t) * (1 - t) / (2 * a);
  return y / (1 - a / 2);
}

function softplus(x, k) {
  const kx = k * x;
  if (kx > 30) return x;
  if (kx < -30) return 0;
  return Math.log1p(Math.exp(kx)) / k;
}

// Strata terracing with geological dip. Also produces the hardness field that the erosion
// passes use so that resistant layers survive as cliff bands while soft layers wear to slopes.
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
  const slopeMaskLo = 0.12, slopeMaskHi = 0.55;
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
      const thin = smoothstep(0.1, 0.45, bed.thick / band);
      const terraced = (table.tops[bi] - bed.thick + lerp(f, fp, thin) * bed.thick) * jitter - tilt;

      const sm = smoothstep(slopeMaskLo, slopeMaskHi, slope[idx]);
      let amount = strength * lerp(0.25, 1, sm);
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
