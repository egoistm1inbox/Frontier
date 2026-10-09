// Height generators. Each returns a fresh Float32Array of N*N heights in [0, 1].
// Coordinates run 0..1 across the map; frequency is in cycles across the map.
import { makeNoise, fbm, ridgedFbm } from '../core/noise.js';
import { clamp } from '../core/rng.js';

const seedFor = (terrainSeed, layerSeed, salt) => ((terrainSeed * 2654435761) ^ (layerSeed * 40503) ^ salt) >>> 0;

export function generateNoise(N, p, terrainSeed) {
  const out = new Float32Array(N * N);
  const noise = makeNoise(seedFor(terrainSeed, p.seed, 0x51));
  const warpNoise = makeNoise(seedFor(terrainSeed, p.seed, 0xa3));
  const inv = 1 / (N - 1);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let sx = x * inv * p.frequency;
      let sy = y * inv * p.frequency;
      if (p.warp > 0) {
        const qx = fbm(warpNoise, sx + 5.2, sy + 1.3, 3, 2, 0.5);
        const qy = fbm(warpNoise, sx + 1.7, sy + 9.2, 3, 2, 0.5);
        sx += p.warp * qx * 1.4;
        sy += p.warp * qy * 1.4;
      }
      const v = fbm(noise, sx, sy, p.octaves, p.lacunarity, p.gain);
      out[y * N + x] = clamp(0.5 + p.relief * v + p.offset, 0, 1);
    }
  }
  return out;
}

export function generateRidged(N, p, terrainSeed) {
  const out = new Float32Array(N * N);
  const noise = makeNoise(seedFor(terrainSeed, p.seed, 0x7c));
  const warpNoise = makeNoise(seedFor(terrainSeed, p.seed, 0x1d));
  const inv = 1 / (N - 1);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let sx = x * inv * p.frequency;
      let sy = y * inv * p.frequency;
      if (p.warp > 0) {
        const qx = fbm(warpNoise, sx + 3.1, sy + 7.7, 3, 2, 0.5);
        const qy = fbm(warpNoise, sx + 8.3, sy + 2.9, 3, 2, 0.5);
        sx += p.warp * qx * 1.1;
        sy += p.warp * qy * 1.1;
      }
      const r = ridgedFbm(noise, sx, sy, p.octaves, p.lacunarity, p.gain, p.sharpness);
      out[y * N + x] = clamp((r - 0.18) * p.relief + p.offset, 0, 1);
    }
  }
  return out;
}

// Radial mask: 1 at the centre, falling to 0 at the radius. A noisy wobble breaks the circle into a coastline.
export function generateIsland(N, p, terrainSeed) {
  const out = new Float32Array(N * N);
  const wob = makeNoise(seedFor(terrainSeed, p.seed, 0x3f));
  const inv = 1 / (N - 1);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x * inv;
      const v = y * inv;
      const dx = u - 0.5;
      const dy = v - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const wn = wob(u * 3.1 + 11.0, v * 3.1 - 4.0) * 0.5 + wob(u * 7.3 - 2.0, v * 7.3 + 9.0) * 0.25;
      const rr = r * (1 + p.wobble * wn);
      const m = clamp(1 - Math.pow(rr / Math.max(0.05, p.radius), p.falloff), 0, 1);
      out[y * N + x] = m * m * (3 - 2 * m);
    }
  }
  return out;
}

export function generateBase(N, p) {
  return new Float32Array(N * N).fill(clamp(p.level, 0, 1));
}

export function generateRamp(N, p) {
  const out = new Float32Array(N * N);
  const a = (p.angle * Math.PI) / 180;
  const cx = Math.cos(a);
  const cy = Math.sin(a);
  const inv = 1 / (N - 1);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const t = (x * inv - 0.5) * cx + (y * inv - 0.5) * cy;
      out[y * N + x] = clamp(p.level + p.steepness * t * 2, 0, 1);
    }
  }
  return out;
}
