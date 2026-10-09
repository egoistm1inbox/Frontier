// Base relief generator: the first layer of the terrain stack.
//
// Domain-warped fractal relief. A low-frequency warp bends the coordinates, a fractal (fBm) and a
// ridged multifractal are blended by `ridge`, a continental field decides where lowlands sit, and an
// optional plateau clamp gives mesa tops. The result is a height *contribution* in metres (the stack
// adds it), so it can be stacked with other generators and masked like any other layer.

import { SimplexNoise, smoothstep, clamp01 } from './noise.js';

export function buildRelief(N, size, p, out = new Float32Array(N * N)) {
  const cell = size / (N - 1);
  const seed = p.seed | 0;
  const n1 = new SimplexNoise(seed * 13 + 1);
  const n2 = new SimplexNoise(seed * 13 + 5);
  const n3 = new SimplexNoise(seed * 13 + 9);
  const nc = new SimplexNoise(seed * 13 + 21);
  const L = Math.max(20, p.wavelength);            // main feature wavelength [m]
  const oct = Math.max(1, Math.round(p.octaves));
  const gain = 0.2 + 0.6 * clamp01(p.roughness);
  const warpM = clamp01(p.warp) * L * 0.45;        // warp displacement [m]
  const ridge = clamp01(p.ridge);
  const continent = clamp01(p.continent);
  const plateau = clamp01(p.plateau);
  for (let j = 0; j < N; j++) {
    const z = j * cell;
    for (let i = 0; i < N; i++) {
      const x = i * cell;
      const wx = x + warpM * n2.fbm(x / (L * 1.7), z / (L * 1.7), 3, 2, 0.5);
      const wz = z + warpM * n3.fbm(x / (L * 1.7) + 31, z / (L * 1.7) - 17, 3, 2, 0.5);
      const fb = 0.5 + 0.5 * n1.fbm(wx / L, wz / L, oct, 2, gain);
      const rd = n1.ridged(wx / L, wz / L, oct, 2.05, gain, 2);
      let h = fb + (rd - fb) * ridge;                // [0, 1]
      // continental field: lowlands where it is low; `continent` widens them
      const cont = nc.fbm(x / (L * 2.6), z / (L * 2.6), 3, 2, 0.5);
      const cut = -0.55 + 0.75 * continent;
      const land = smoothstep(cut - 0.22, cut + 0.22, cont);
      h = Math.pow(clamp01(h), 0.6 + 0.9 * clamp01(p.peaks)) * (0.08 + 0.92 * land);
      if (plateau > 0) {
        const top = 0.62;
        const flat = top + (h - top) * 0.12;
        h = h + (Math.min(h, flat) - h) * plateau * smoothstep(top - 0.1, top + 0.05, h);
      }
      out[j * N + i] += p.base + h * p.height;
    }
  }
  return out;
}
