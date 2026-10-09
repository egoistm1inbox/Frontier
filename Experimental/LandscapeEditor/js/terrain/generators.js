// Shape generators. Each returns a fresh Float32Array of N*N heights in [0, 1]. The base primitives (noise,
// ridged, constant and the rest) live in primitives.js.
// Coordinates run 0..1 across the map.
import { makeNoise } from '../core/noise.js';
import { clamp } from '../core/rng.js';

const seedFor = (terrainSeed, layerSeed, salt) => ((terrainSeed * 2654435761) ^ (layerSeed * 40503) ^ salt) >>> 0;

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
