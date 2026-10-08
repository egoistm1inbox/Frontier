// Stratigraphic column shared by the heightfield terracing, the erosion hardness, the true-3D
// cliff carving and the surface shader — so the beds you see are the beds that were carved.
//
// Instead of beds of one thickness with a hashed hardness, the column is a sequence of
// *packages*: thin-bedded packages (shales / siltstones, mostly soft, the odd hard ledge),
// massive packages (thick sandstone / limestone, mostly hard, the odd soft parting) and mixed
// ones, each bed with its own thickness (log-normal around the band thickness), hardness, tint
// and an optional gradational base (hardness fading downwards — cross-bedded sets that weather
// back into the bed below).
//
// Elevation goes through a lateral *jitter* (beds thicken and thin across the tile) which is a
// sum of long sines so JS and GLSL evaluate exactly the same thing.

import { mulberry32, voronoi2, smoothstep, clamp01 } from './noise.js';

const Y_MIN = -1500, Y_MAX = 5000;

export function makeBedTable(params) {
  const band = Math.max(2, params.strataBand || 26);
  const variation = params.strataVariation == null ? 0.6 : Math.max(0, Math.min(1.5, params.strataVariation));
  const packaging = params.strataPackaging == null ? 0.6 : Math.max(0, Math.min(1, params.strataPackaging));
  const hardShare = params.strataHardShare == null ? 0.4 : Math.max(0, Math.min(1, params.strataHardShare));
  const rand = mulberry32(((params.seed | 0) * 977 + 13) >>> 0);
  const gauss = () => { // Box–Muller
    const u = Math.max(1e-6, rand()), w = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w);
  };
  const tops = [], hard = [], thick = [], tint = [], grad = [], pkg = [];
  let y = Y_MIN, guard = 0;
  while (y < Y_MAX && guard++ < 4000) {
    const r = rand();
    const type = r < packaging * 0.45 ? 0 /* thin-bedded */ : r < packaging * 0.9 ? 1 /* massive */ : 2 /* mixed */;
    const n = 2 + Math.floor(rand() * 6);
    for (let k = 0; k < n && y < Y_MAX; k++) {
      let t = band * Math.exp(gauss() * 0.5 * variation) * (type === 0 ? 0.42 : type === 1 ? 1.45 : 1);
      t = Math.max(band * 0.12, Math.min(band * 4, t));
      let h;
      if (type === 0) h = rand() < 0.15 ? 0.6 + 0.3 * rand() : 0.04 + 0.3 * rand();
      else if (type === 1) h = rand() < 0.18 ? 0.15 + 0.25 * rand() : 0.7 + 0.3 * rand();
      else h = rand() < hardShare ? 0.65 + 0.35 * rand() : 0.05 + 0.4 * rand();
      y += t;
      tops.push(y); hard.push(h); thick.push(t); tint.push(rand()); grad.push(h > 0.5 && rand() < 0.4 ? 1 : 0); pkg.push(type);
    }
  }
  return {
    count: tops.length, base: Y_MIN, band,
    tops: Float32Array.from(tops), hard: Float32Array.from(hard), thick: Float32Array.from(thick),
    tint: Float32Array.from(tint), grad: Uint8Array.from(grad), pkg: Uint8Array.from(pkg),
  };
}

// bed containing tilted elevation t: index, fraction within the bed (0 base → 1 top), thickness
export function bedAt(table, t, out = {}) {
  const { tops, count } = table;
  let lo = 0, hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t < tops[mid]) hi = mid; else lo = mid + 1;
  }
  const top = tops[lo], thick = table.thick[lo];
  out.index = lo;
  out.f = Math.max(0, Math.min(1, (t - (top - thick)) / thick));
  out.thick = thick;
  out.hard = table.hard[lo];
  out.tint = table.tint[lo];
  out.grad = table.grad[lo];
  return out;
}

// lateral thickness jitter — identical expression in the shader (bedJitter in surface-shader.js)
export function bedJitter(x, z, amount = 0.18) {
  const a = Math.sin(x * 0.0091 + 0.7 * Math.sin(z * 0.0063 + 1.3));
  const b = Math.cos(z * 0.0077 + 0.5 * Math.sin(x * 0.0052 + 0.4));
  return 1 + amount * (0.6 * a + 0.4 * b);
}

// Gaea-style broken strata: the column is cut into Voronoi plates (fault blocks), each shifted
// vertically by up to ±breakAmp metres. The shift blends to the neighbouring plate's value over
// `width` metres at borders, so the elevation frame stays C⁰-continuous: the heightfield gets
// steep fault scarps instead of tears, and the SDF carve field stays watertight (marching cubes
// only ever sees a single-valued continuous field). plateField returns [offset, interior] with
// interior = 0 on the fault line → 1 inside a plate. Identical expressions in the shader
// (plateOffset in surface-shader.js) — the SAME frame must feed the heightfield terracing, the
// 3-D chunk carve and the bed-colour lookup or beds, carve and colour disagree.
export function plateField(x, z, scale, seed, width) {
  const s = Math.max(4, scale);
  const [v1, v2, edge] = voronoi2(x / s, z / s, seed | 0);
  const t = smoothstep(0, Math.max(1e-3, width / s), edge);
  // symmetric blend: exactly on the bisector (t = 0) both orderings give the average, so a
  // float-vs-double tie-break flip between JS and GLSL cannot tear the frame (topology: the
  // heightfield, the SDF carve and the bed colours always agree on the fault line itself)
  const avg = (v1 + v2) / 2;
  return [(avg + (v1 - avg) * t), t];
}

// Gaea "Lateral" stratification: long-wavelength vertical warp of the bed frame so packages swell,
// pinch and drift across the tile instead of stacking like pancakes. A sum of sines (like
// bedJitter) so JS and GLSL evaluate exactly the same thing. Returns metres (±amp).
export function lateralWarp(x, z, amp) {
  if (!(amp > 0)) return 0;
  const a = Math.sin(x * 0.0042 + 1.7 * Math.sin(z * 0.0031 + 0.6));
  const b = Math.cos(z * 0.0037 + 1.3 * Math.sin(x * 0.0029 + 2.1));
  return amp * (0.55 * a + 0.45 * b);
}

// Combined plan-position offset of the strata frame in metres (fault blocks + lateral warp).
// x, z are measured from the tile corner (≥ 0), like everywhere else in the strata code.
export function strataPlanOffset(x, z, frame) {
  let off = 0;
  if (frame.breakAmp > 0) off += plateField(x, z, frame.faultScale, frame.plateSeed, frame.faultWidth)[0] * frame.breakAmp;
  off += lateralWarp(x, z, frame.lateralAmp);
  return off;
}

// Gaea-style substrata: secondary bedding inside each bed — `count` sub-beds per bed, terraced
// with the same monotone gain curve as the main beds so the height remap never folds (topology:
// still a valid heightfield, still a continuous SDF). strength 0 returns f exactly (legacy).
// Returns [terracedF, subFraction] — subFraction locates the point inside its sub-bed for the
// shader's sub-seams and the SDF's fine ledges.
export function subTerrace(f, count, strength, mask) {
  const n = Math.max(2, Math.round(count || 3));
  const s = clamp01(strength || 0) * clamp01(mask == null ? 1 : mask);
  const g = Math.min(1, Math.max(0, f)) * n;
  const whole = Math.min(n - 1, Math.floor(g));
  const sf = g - whole;
  if (!(s > 0)) return [Math.min(1, Math.max(0, f)), sf];
  const k = 2.5;
  const num = Math.pow(sf, k), den = num + Math.pow(1 - sf, k);
  const fp = den > 1e-9 ? num / den : sf;
  return [(whole + sf + (fp - sf) * s) / n, sf];
}

// Bundle the plan-frame parameters once per generation (heights in metres).
export function makeStrataFrame(params) {
  const band = Math.max(2, params.strataBand || 26);
  return {
    band,
    breakAmp: (params.strataBreak > 0 ? params.strataBreak : 0) * band,
    faultScale: Math.max(8, params.strataFaultScale || 120),
    faultWidth: Math.max(0.5, params.strataFaultWidth == null ? 6 : params.strataFaultWidth),
    plateSeed: ((params.seed | 0) * 131 + 17) | 0,
    lateralAmp: (params.strataLateralMode > 0 ? params.strataLateralMode : 0) * band,
    subCount: Math.max(2, Math.round(params.strataSubCount || 3)),
    subStrength: params.strataSub > 0 ? params.strataSub : 0,
  };
}

// hardness including the gradational base
export function bedHardness(bed) {
  return bed.grad ? bed.hard * (0.55 + 0.45 * bed.f) : bed.hard;
}
