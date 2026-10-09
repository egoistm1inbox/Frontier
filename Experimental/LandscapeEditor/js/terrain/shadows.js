// Cast shadows from a directional sun, on the working grid. From each cell the sun ray is walked outward over a fixed
// number of steps whose spacing grows with distance, and the steepest occluder sets the shadow. The edge of a shadow
// is soft over a small range of sun angles. lit is 1 in full sun and 0 in full shadow.
import { bilinear } from '../core/grid.js';
import { clamp } from '../core/rng.js';

const STEPS = 40;
const SOFT = 0.03; // penumbra width, in tangent units (about 1.7 degrees)
const CACHE_MAX = 4;

export function castShadow(h, N, heightM, cellM, azDeg, elDeg) {
  const out = new Float32Array(N * N);
  const az = (azDeg * Math.PI) / 180;
  const sx = Math.sin(az); // grid x runs east
  const sy = -Math.cos(az); // grid y runs south, so azimuth 0 (north) points to -y
  const tanEl = Math.tan((elDeg * Math.PI) / 180);
  // Sample distances in cells. The spacing grows by half a cell per step, and scales with the grid so that the reach
  // in metres stays about the same on larger grids.
  const scale = Math.max(1, N / 1024);
  const dist = new Float32Array(STEPS);
  let d = 0;
  for (let k = 0; k < STEPS; k++) {
    d += (1 + 0.5 * k) * scale;
    dist[k] = d;
  }
  const last = N - 1;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const h0 = h[y * N + x];
      let maxTan = -Infinity;
      for (let k = 0; k < STEPS; k++) {
        const px = x + sx * dist[k];
        const py = y + sy * dist[k];
        if (px < 0 || py < 0 || px > last || py > last) break; // beyond the map there is no terrain to test
        const hs = bilinear(h, N, px, py);
        const tanOcc = ((hs - h0) * heightM) / (dist[k] * cellM);
        if (tanOcc > maxTan) maxTan = tanOcc;
      }
      out[y * N + x] = clamp(0.5 + (tanEl - maxTan) / SOFT, 0, 1);
    }
  }
  return out;
}

// Shadow map for the current heights and sun, cached on the analysis object (which lives as long as the heights do).
// The cache keeps the last few suns, so changing the satmap sun and back does not recompute.
export function shadowFor(analysis, h, N, azDeg, elDeg) {
  const key = `${Math.round(azDeg * 10)}|${Math.round(elDeg * 10)}`;
  const cache = analysis.shadows || null;
  if (cache && cache.has(key)) return cache.get(key);
  const lit = castShadow(h, N, analysis.heightM, analysis.cellM, azDeg, elDeg);
  if (cache) {
    cache.set(key, lit);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }
  return lit;
}
