// Basins: flat-floored depressions with a shore. A lake is cut down to a bed below its water level, and the level is
// recorded so the satmap can colour the water. A playa (dry lake) is filled flat to its floor level and recorded as
// dry clay. The shoreline wobbles with noise, and the basin can be stretched and turned. Written for this editor.
import { makeNoise } from '../core/noise.js';
import { clamp, smoothstep, hashString } from '../core/rng.js';
import { seedFor } from './primitives.js';

// Applies one basin to the heights h (N x N). `field` is the water-level field (lake) or the flat-floor share (playa)
// from the layers below, or null. Returns the new heights and the updated field. Neither input is modified.
//   Lake:  water level per cell, normalised; 0 where there is no water.
//   Playa: flat-floor share per cell, 0..1.
export function applyBasin(kind, h, N, p, terr, op, field) {
  if (op <= 0) return { height: h, field };
  const seed = seedFor(terr.seed, p.seed ?? 0, hashString(kind));
  const noise = makeNoise(seed);
  const cx = clamp((p.centreX ?? 50) / 100, 0, 1);
  const cy = clamp((p.centreY ?? 50) / 100, 0, 1);
  const half = 0.5 * clamp((p.radius ?? 12) / 100, 0.02, 1.5);
  const aspect = clamp(p.aspect ?? 0.7, 0.2, 1);
  const ang = (clamp(p.angle ?? 0, 0, 360) * Math.PI) / 180;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const shore = clamp(p.shore ?? 0.4, 0.05, 0.9);
  const wob = clamp(p.wobble ?? 0.3, 0, 1);
  const levelN = clamp((p.level ?? 300) / terr.heightM, 0, 1);
  const bedN = levelN - clamp((p.depth ?? 40) / terr.heightM, 0, 1);
  const out = new Float32Array(h);
  const outField = field ? new Float32Array(field) : new Float32Array(N * N);
  const inv = 1 / (N - 1);
  for (let y = 0; y < N; y++) {
    const Y = y * inv;
    for (let x = 0; x < N; x++) {
      const X = x * inv;
      const dx = X - cx;
      const dy = Y - cy;
      const rx = dx * ca + dy * sa;
      const ry = -dx * sa + dy * ca;
      const r = Math.hypot(rx / half, ry / (half * aspect)) * (1 + wob * 0.25 * noise(X * 4.3 + 1.7, Y * 4.3 - 3.1));
      const s = 1 - smoothstep(1 - shore, 1, r); // 1 at the centre, 0 at the shore
      if (s <= 0) continue;
      const i = y * N + x;
      const z = h[i];
      if (kind === 'lake') {
        const cut = Math.min(z, z + (bedN - z) * s); // never raises ground that is already below the bed
        out[i] = z + (cut - z) * op;
        outField[i] = Math.max(outField[i], levelN);
      } else {
        out[i] = z + (levelN - z) * s * op;
        outField[i] = Math.max(outField[i], s * op);
      }
    }
  }
  return { height: out, field: outField };
}
