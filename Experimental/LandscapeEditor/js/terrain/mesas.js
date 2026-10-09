// Mesa field: many mesas and buttes on a jittered grid. Each mesa has a flat caprock top, a steep cliff band, and a
// concave talus apron that runs out onto the plain. Each outline is irregular (its radius varies with direction, from
// noise), and each one is stretched and turned. Where two mesas overlap, the higher profile wins.
// Heights are normalised (1 is the whole height range), so the top height is given in metres and converted here.
// This is an independent construction of the usual mesa profile. It is not taken from any published tool.
import { makeNoise, fbm } from '../core/noise.js';
import { clamp, smoothstep, hashString } from '../core/rng.js';
import { hashIJ, seedFor } from './primitives.js';

export const MESA_CELLS_MAX = 14;
const OUTLINE = 48; // directions in each mesa's outline table

// Radius scale around a mesa, by direction. Built once per mesa from two octaves of noise sampled on a circle, so it
// closes on itself and each mesa gets its own outline.
function outlineTable(noise, ox, oy, irregular) {
  const t = new Float32Array(OUTLINE);
  for (let k = 0; k < OUTLINE; k++) {
    const th = (k / OUTLINE) * Math.PI * 2;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const v = 0.7 * noise(c * 1.3 + ox, s * 1.3 + oy) + 0.3 * noise(c * 3.1 + ox * 1.7, s * 3.1 + oy * 1.3);
    t[k] = clamp(1 + irregular * 1.2 * v, 0.45, 1.8);
  }
  return t;
}

function outlineAt(t, th) {
  let f = (th / (Math.PI * 2)) * OUTLINE;
  f = ((f % OUTLINE) + OUTLINE) % OUTLINE;
  const i0 = Math.floor(f);
  const i1 = (i0 + 1) % OUTLINE;
  return t[i0] + (t[i1] - t[i0]) * (f - i0);
}

// The mesas in a field: one entry for each cell that holds one. Exported for the tests.
//   cx, cy   centre, 0..1 across the map
//   r        radius before the outline is applied, as a fraction of the map
//   H        height of the caprock top, normalised
//   b        height where the talus meets the cliff foot, normalised
//   cliff    width of the cliff band, as a fraction of the radius
//   talus    width of the talus apron, as a fraction of the radius
//   aspect   stretch across the mesa (1 is round), angle its long-axis turn in radians, table its outline
export function mesaList(p, terrainSeed, heightM) {
  const seed = seedFor(terrainSeed, p.seed ?? 0, hashString('mesafield'));
  const cells = clamp(Math.round(p.cells ?? 6), 2, MESA_CELLS_MAX);
  const coverage = clamp(p.coverage ?? 0.6, 0, 1);
  const size = clamp(p.size ?? 0.85, 0.2, 1);
  const variation = clamp(p.variation ?? 0.45, 0, 1);
  const jitter = clamp(p.jitter ?? 0.7, 0, 1);
  const top = clamp((p.top ?? 260) / heightM, 0.01, 1);
  const cliff = clamp(p.cliff ?? 0.22, 0.05, 0.6);
  const talus = clamp(p.talus ?? 0.7, 0, 0.9);
  const irregular = clamp(p.irregularity ?? 0.35, 0, 0.8);
  const shape = makeNoise((seed ^ 0x7f4a) >>> 0);
  const s = 1 / cells;
  const list = [];
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      if (hashIJ(i, j, seed + 1) >= coverage) continue;
      // Sizes are skewed: most mesas are on the small side, a few reach the full size. variation 0 makes them all equal.
      const scale = 1 - variation * (1 - Math.pow(hashIJ(i, j, seed + 2), 1.6));
      const r = 0.5 * s * size * Math.max(0.25, scale);
      const cx = (i + 0.5 + (hashIJ(i, j, seed + 3) - 0.5) * jitter) * s;
      const cy = (j + 0.5 + (hashIJ(i, j, seed + 4) - 0.5) * jitter) * s;
      const H = top * (1 - 0.35 * variation * hashIJ(i, j, seed + 5));
      const aspect = 0.65 + 0.35 * hashIJ(i, j, seed + 6);
      const angle = Math.PI * hashIJ(i, j, seed + 7);
      const table = outlineTable(shape, hashIJ(i, j, seed + 8) * 40, hashIJ(i, j, seed + 9) * 40, irregular);
      list.push({ i, j, cx, cy, r, H, b: 0.25 * H, cliff, talus, aspect, ca: Math.cos(angle), sa: Math.sin(angle), table });
    }
  }
  return list;
}

// Height of one mesa at distance d from its centre, in units of its outline radius (1 at the caprock edge).
export function mesaProfile(d, m) {
  const edge = 1 - m.cliff;
  if (d <= edge) return m.H;
  if (d <= 1) {
    const t = (d - edge) / m.cliff; // 0 at the top edge, 1 at the foot of the cliff
    return m.b + (m.H - m.b) * (1 - smoothstep(0, 1, t));
  }
  if (d < 1 + m.talus) {
    const x = (d - 1) / m.talus; // 0 at the foot, 1 at the outer edge: steepest at the foot, then easing out
    return m.b * (1 - x) * (1 - x);
  }
  return 0;
}

// Mesa field on a W x W grid, as a layer field. 0.5 is the plain: each mesa adds its height above it, so the layer
// works in Add mode like the other landforms. Rugosity roughens the cliffs and talus far more than the caprock.
export function generateMesaField(W, p, terrainSeed, heightM = 1000) {
  const seed = seedFor(terrainSeed, p.seed ?? 0, hashString('mesafield'));
  const cells = clamp(Math.round(p.cells ?? 6), 2, MESA_CELLS_MAX);
  const byCell = new Array(cells * cells).fill(null);
  for (const m of mesaList(p, terrainSeed, heightM)) byCell[m.j * cells + m.i] = m;
  const rug = clamp(p.rugosity ?? 0.12, 0, 1);
  const freq = clamp(p.frequency ?? 6, 0.5, 24);
  const oct = clamp(Math.round(p.octaves ?? 4), 1, 8);
  const noise = makeNoise((seed ^ 0x6d2b) >>> 0);
  const s = 1 / cells;
  const inv = 1 / (W - 1);
  const out = new Float32Array(W * W);
  for (let y = 0; y < W; y++) {
    const Y = y * inv;
    const cj = Math.min(cells - 1, Math.floor(Y / s));
    for (let x = 0; x < W; x++) {
      const X = x * inv;
      const ci = Math.min(cells - 1, Math.floor(X / s));
      const n = rug > 0 ? fbm(noise, X * freq, Y * freq, oct, 2, 0.5) : 0;
      let best = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const j = cj + dj;
        if (j < 0 || j >= cells) continue;
        for (let di = -1; di <= 1; di++) {
          const i = ci + di;
          if (i < 0 || i >= cells) continue;
          const m = byCell[j * cells + i];
          if (!m) continue;
          const dx = X - m.cx;
          const dy = Y - m.cy;
          const rx = dx * m.ca + dy * m.sa; // turn into the mesa's own axes, then stretch across them
          const ry = -dx * m.sa + dy * m.ca;
          const raw = Math.hypot(rx / m.aspect, ry) / m.r;
          const d = raw / outlineAt(m.table, Math.atan2(ry, rx / m.aspect));
          if (d >= 1 + m.talus) continue;
          let f = mesaProfile(d, m);
          if (f > 0 && rug > 0) f *= 1 + rug * 0.5 * n * (d > 1 - m.cliff ? 1 : 0.25);
          if (f > best) best = f;
        }
      }
      out[y * W + x] = clamp(0.5 + best, 0, 1);
    }
  }
  return out;
}
