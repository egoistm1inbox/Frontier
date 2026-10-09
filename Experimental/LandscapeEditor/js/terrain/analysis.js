// Derived fields of a finished heightmap: gradient, slope, ridge/valley curvature and drainage.
// Everything here is computed from the final heights, so the satmap and the 2D views always agree.
import { routeFlow } from '../core/flow.js';

export function analyseTerrain(h, N, terrain) {
  const n = N * N;
  const cellM = terrain.extentM / (N - 1);
  const heightM = terrain.heightM;
  const gx = new Float32Array(n); // dz/dx in metres per metre, east positive
  const gy = new Float32Array(n); // dz/dy, south positive (rows run south)
  const slope = new Float32Array(n); // degrees
  const ridge = new Float32Array(n); // h minus the mean of its four neighbours: >0 crest, <0 valley floor
  const flat = (x, y) => (y < 0 ? 0 : y >= N ? N - 1 : y) * N + (x < 0 ? 0 : x >= N ? N - 1 : x);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const c = y * N + x;
      const xl = x > 0 ? x - 1 : x;
      const xr = x < N - 1 ? x + 1 : x;
      const yu = y > 0 ? y - 1 : y;
      const yd = y < N - 1 ? y + 1 : y;
      const spanX = (xr - xl) * cellM;
      const spanY = (yd - yu) * cellM;
      const dzdx = ((h[flat(xr, y)] - h[flat(xl, y)]) * heightM) / spanX;
      const dzdy = ((h[flat(x, yd)] - h[flat(x, yu)]) * heightM) / spanY;
      gx[c] = dzdx;
      gy[c] = dzdy;
      slope[c] = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
      const mean4 = (h[flat(x - 1, y)] + h[flat(x + 1, y)] + h[flat(x, y - 1)] + h[flat(x, y + 1)]) * 0.25;
      ridge[c] = h[c] - mean4;
    }
  }
  const { area } = routeFlow(h, N);
  let maxArea = 1;
  for (let i = 0; i < n; i++) if (area[i] > maxArea) maxArea = area[i];
  const logMax = Math.log1p(maxArea);
  const wet = new Float32Array(n);
  for (let i = 0; i < n; i++) wet[i] = Math.log1p(area[i]) / logMax;
  return { N, cellM, heightM, gx, gy, slope, ridge, flow: area, wet };
}
