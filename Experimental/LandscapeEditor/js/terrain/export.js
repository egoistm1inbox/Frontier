// Export-size heightmap. The eroded terrain lives on the working grid (at most WORKING_MAX cells a side). A larger
// output grid is made from it in two parts:
//   1. Bicubic (Catmull-Rom) interpolation of the working grid. The landforms are exactly the ones the
//      working grid shows, only smoother at the finer spacing.
//   2. Synthesised detail: fBm noise with its finest feature near one working cell. Its amplitude is set by the
//      local slope (half the height change across one working cell, tan(slope) times the cell width), so flat
//      ground stays flat and steep ground gets a little roughness. The detail is not eroded, so it adds texture
//      at the finer scale without moving any ridge or valley.
// The detail is a plausible texture, not a reconstruction of the terrain at the finer scale. Say so when you
// quote export sizes.
import { makeNoise } from '../core/noise.js';
import { bilinear } from '../core/grid.js';
import { clamp } from '../core/rng.js';

const crPoint = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));

// Catmull-Rom bicubic sample of an N x N grid at fractional cell coordinates, clamped at the edges.
function bicubic(arr, N, x, y) {
  const maxc = N - 1;
  const cx = x < 0 ? 0 : x > maxc ? maxc : x;
  const cy = y < 0 ? 0 : y > maxc ? maxc : y;
  const ix = Math.floor(cx);
  const iy = Math.floor(cy);
  const tx = cx - ix;
  const ty = cy - iy;
  const xm = clamp(ix - 1, 0, maxc);
  const x0 = clamp(ix, 0, maxc);
  const x1 = clamp(ix + 1, 0, maxc);
  const x2 = clamp(ix + 2, 0, maxc);
  const r0 = clamp(iy - 1, 0, maxc) * N;
  const r1 = clamp(iy, 0, maxc) * N;
  const r2 = clamp(iy + 1, 0, maxc) * N;
  const r3 = clamp(iy + 2, 0, maxc) * N;
  const v0 = crPoint(arr[r0 + xm], arr[r0 + x0], arr[r0 + x1], arr[r0 + x2], tx);
  const v1 = crPoint(arr[r1 + xm], arr[r1 + x0], arr[r1 + x1], arr[r1 + x2], tx);
  const v2 = crPoint(arr[r2 + xm], arr[r2 + x0], arr[r2 + x1], arr[r2 + x2], tx);
  const v3 = crPoint(arr[r3 + xm], arr[r3 + x0], arr[r3 + x1], arr[r3 + x2], tx);
  return crPoint(v0, v1, v2, v3, ty);
}

// Returns a Uint16Array (N*N, row 0 at the north edge) as an ArrayBuffer, ready to transfer.
// h: working grid heights (W*W), an: analysis of the working grid (slope in degrees), terr: terrain settings.
export async function exportHeight16({ h, W, N, an, terr, seed, hooks = {} }) {
  const progress = hooks.progress || (() => {});
  const tick = hooks.tick || (async () => {});
  const out = new Uint16Array(N * N);
  if (N === W) {
    for (let i = 0; i < N * N; i++) out[i] = Math.round(clamp(h[i], 0, 1) * 65535);
    progress(1);
    return out.buffer;
  }
  if (N < W) throw new Error('Export size is smaller than the working grid');

  const octaves = clamp(Math.round(Math.log2(N / W)), 1, 4);
  const noise = makeNoise((seed * 7919 + 101) >>> 0);
  const slope = an.slope;
  const cellHeight = (terr.extentM / (W - 1)) / terr.heightM; // normalised height per working-cell metre
  const sc = (W - 1) / (N - 1);
  const norm = 2 * (1 - Math.pow(0.5, octaves)); // sum of the octave amplitudes 1, 1/2, 1/4, ...

  for (let Y = 0; Y < N; Y++) {
    const v = Y * sc;
    for (let X = 0; X < N; X++) {
      const u = X * sc;
      const base = bicubic(h, W, u, v);
      const s = bilinear(slope, W, u, v);
      const amp = Math.min(0.02, 0.5 * Math.tan((s * Math.PI) / 180) * cellHeight);
      let d = 0;
      let a = 1;
      let f = 0.9;
      for (let o = 0; o < octaves; o++) {
        d += a * noise(u * f + 0.3, v * f - 0.7);
        a *= 0.5;
        f *= 2;
      }
      out[Y * N + X] = Math.round(clamp(base + (amp * d) / norm, 0, 1) * 65535);
    }
    if (Y % 32 === 31 || Y === N - 1) {
      progress((Y + 1) / N);
      await tick();
    }
  }
  return out.buffer;
}
