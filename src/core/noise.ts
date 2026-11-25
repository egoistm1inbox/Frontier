/**
 * Deterministic 2D & 3D value noise, fBm, ridged multifractal, and Voronoi
 * cellular hummock fields (used for moss cushion topography, rock fissures,
 * bullate leaf mesophyll quilting, and strand frizz).
 */

export function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h =
    Math.imul(ix | 0, 0x27d4eb2d) ^
    Math.imul(iy | 0, 0x165667b1) ^
    Math.imul(iz | 0, 0x9e3779b1) ^
    Math.imul((seed | 0) + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Smooth value noise in [-1, 1]. */
export function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const u = fade(fx);
  const v = fade(fy);
  const w = fade(fz);
  const c000 = hash3(ix, iy, iz, seed);
  const c100 = hash3(ix + 1, iy, iz, seed);
  const c010 = hash3(ix, iy + 1, iz, seed);
  const c110 = hash3(ix + 1, iy + 1, iz, seed);
  const c001 = hash3(ix, iy, iz + 1, seed);
  const c101 = hash3(ix + 1, iy, iz + 1, seed);
  const c011 = hash3(ix, iy + 1, iz + 1, seed);
  const c111 = hash3(ix + 1, iy + 1, iz + 1, seed);
  const x00 = c000 + (c100 - c000) * u;
  const x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u;
  const x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v;
  const y1 = x01 + (x11 - x01) * v;
  return (y0 + (y1 - y0) * w) * 2 - 1;
}

/** Fractal Brownian motion in [-1, 1]. */
export function fbm3(x: number, y: number, z: number, seed: number, octaves = 4, lacunarity = 2.03, gain = 0.5): number {
  let amp = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise3(x, y, z, seed + o * 131);
    norm += amp;
    x = x * lacunarity + 11.3;
    y = y * lacunarity + 7.1;
    z = z * lacunarity + 3.7;
    amp *= gain;
  }
  return sum / (norm || 1);
}

/** Ridged multifractal in [0, 1] (rock fractures, bark ridges). */
export function ridged3(x: number, y: number, z: number, seed: number, octaves = 4): number {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let prev = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(valueNoise3(x, y, z, seed + o * 197));
    n = n * n * prev;
    prev = Math.max(0.2, Math.min(1, n * 1.8));
    sum += n * amp;
    norm += amp;
    x = x * 2.11 + 5.7;
    y = y * 2.11 + 9.2;
    z = z * 2.11 + 2.9;
    amp *= 0.5;
  }
  return sum / (norm || 1);
}

/**
 * 2D Voronoi cellular hummock field: returns
 *  - `pillow`: smooth dome [0, 1] peaking at cushion centers and dipping at crevices;
 *  - `edge`: crevice proximity [0, 1] along cell boundaries;
 *  - `cellId`: deterministic [0, 1) hash of the winning cushion cell.
 */
export function voronoiHummock2(x: number, z: number, seed: number, jitter = 0.82): { pillow: number; edge: number; cellId: number } {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  let d1 = 1e9;
  let d2 = 1e9;
  let bestId = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const cx = ix + dx;
      const cz = iz + dz;
      const jx = (hash3(cx, 17, cz, seed) - 0.5) * jitter + 0.5;
      const jz = (hash3(cx, 53, cz, seed + 71) - 0.5) * jitter + 0.5;
      const px = cx + jx - x;
      const pz = cz + jz - z;
      const d = Math.sqrt(px * px + pz * pz);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        bestId = hash3(cx, 99, cz, seed + 313);
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  const gap = Math.max(0, Math.min(1, (d2 - d1) * 1.55));
  const pillow = Math.sqrt(gap) * Math.max(0, 1 - d1 * d1 * 0.72);
  return { pillow: Math.max(0, Math.min(1, pillow * 1.25)), edge: 1 - gap, cellId: bestId };
}

export interface PillowFieldSample {
  /** Smooth macro pillow height [0..1.25] (C2-smooth ellipsoidal domes, zero high-freq noise). */
  macroHeight: number;
  /** Total normalized pillow thickness including fine tuft relief [0..1.35] (0 = bare wet rock). */
  height: number;
  /** Cushion presence mask [0..1] (0 = exposed wet dark basalt rock). */
  coverage: number;
  /** Deep inter-pillow crease & under-lip shadow factor [0..1] (0 = deep black cleft, 1 = open crown). */
  creviceAo: number;
  /** Sun-toasted warm golden-russet patchiness on select exposed dome crests [0..1]. */
  toast: number;
  /** Fine 3..6 mm star-tuft micro-stipple [0..1]. */
  microTuft: number;
}

function sminPoly(a: number, b: number, k: number): number {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / Math.max(1e-5, k)));
  return b * (1 - h) + a * h - k * h * (1 - h);
}

function smaxPoly(a: number, b: number, k: number): number {
  return -sminPoly(-a, -b, k);
}

/**
 * True Confluent Ellipsoidal Cushion / Pillow Moss Field:
 * Evaluates overlapping plump rounded bryophyte hemispheres & cascading elongated
 * pillow lobes combined via tight smooth-max (`k = 0.045`), producing smooth convex
 * cushion tops, steep vertical/tucked lips over bare wet basalt windows, and deep
 * V-shaped inter-lobe creases with zero polygonal Voronoi artifacts.
 */
export function confluentPillowField2(
  u: number,
  v: number,
  lobeScale: number,
  coverageTarget: number,
  patchiness: number,
  seed: number,
): PillowFieldSample {
  const wu = fbm3(u * 2.6, 0.4, v * 2.6, seed ^ 0x1357, 3) * 0.055;
  const wv = fbm3(u * 2.6 + 5.2, 1.3, v * 2.6 - 3.8, seed ^ 0x2468, 3) * 0.055;
  const su = (u + wu) * lobeScale;
  const sv = (v + wv) * lobeScale;

  let best1 = 0;
  let best2 = 0;
  let unionH = 0;

  // Natural wet-basalt hollow mask evaluated per cushion center so we drop WHOLE ellipsoids
  // (keeping every rock-facing moss margin 100% round and plump, never slicing a dome into a flat flap!)
  const evalRockKeep = (cu: number, cv: number, hRand: number): boolean => {
    const channel =
      0.46 +
      0.48 * fbm3(cu * 2.1 - 0.6, 3.1, cv * 2.1 + 0.8, seed ^ 0x6291, 3) +
      (cu - 0.38) * 0.52 -
      (cv - 0.42) * 0.18;
    const thresh = (1 - coverageTarget) * (1.05 + 0.95 * patchiness);
    return channel + hRand * 0.18 >= thresh;
  };

  // Layer A: Large cascading primary pillows + elongated ridge lobes
  const ix0 = Math.floor(su);
  const iz0 = Math.floor(sv);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix0 + dx;
      const cz = iz0 + dz;
      const px = cx + 0.16 + 0.68 * hash3(cx, cz, 23, seed);
      const pz = cz + 0.16 + 0.68 * hash3(cx, cz, 41, seed);
      if (!evalRockKeep(px / lobeScale, pz / lobeScale, hash3(cx, cz, 11, seed))) continue;

      const rx = 0.48 + 0.30 * hash3(cx, cz, 59, seed);
      const rz = 0.58 + 0.42 * hash3(cx, cz, 73, seed);
      const ang = (hash3(cx, cz, 89, seed) - 0.5) * 1.15;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);

      const du = su - px;
      const dv = sv - pz;
      const lu = (du * ca + dv * sa) / rx;
      const lv = (-du * sa + dv * ca) / rz;
      const r2 = lu * lu + lv * lv;
      if (r2 < 1.0) {
        const dome = (0.72 + 0.34 * hash3(cx, cz, 103, seed)) * Math.pow(1 - r2, 0.52);
        if (dome > best1) {
          best2 = best1;
          best1 = dome;
        } else if (dome > best2) {
          best2 = dome;
        }
        unionH = unionH <= 0 ? dome : smaxPoly(unionH, dome, 0.042);
      }
    }
  }

  // Layer B: Budding secondary round sub-cushions nestled on shoulders & rock edges
  const su2 = su * 1.85 + 2.3;
  const sv2 = sv * 1.85 - 1.7;
  const jx0 = Math.floor(su2);
  const jz0 = Math.floor(sv2);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = jx0 + dx;
      const cz = jz0 + dz;
      const px = cx + 0.18 + 0.64 * hash3(cx, cz, 149, seed);
      const pz = cz + 0.18 + 0.64 * hash3(cx, cz, 167, seed);
      const cu = (px - 2.3) / (1.85 * lobeScale);
      const cv = (pz + 1.7) / (1.85 * lobeScale);
      if (
        hash3(cx, cz, 131, seed) < 0.28 ||
        !evalRockKeep(cu, cv, hash3(cx, cz, 137, seed) * 0.85)
      ) {
        continue;
      }
      const rad = 0.52 + 0.28 * hash3(cx, cz, 181, seed);
      const du = (su2 - px) / rad;
      const dv = (sv2 - pz) / rad;
      const r2 = du * du + dv * dv;
      if (r2 < 1.0) {
        const subDome = (0.48 + 0.28 * hash3(cx, cz, 197, seed)) * Math.pow(1 - r2, 0.54);
        if (subDome > best1) {
          best2 = best1;
          best1 = subDome;
        } else if (subDome > best2) {
          best2 = subDome;
        }
        unionH = unionH <= 0 ? subDome : smaxPoly(unionH, subDome, 0.036);
      }
    }
  }

  // Layer C: Smaller cauliflower sub-knobs (`3.5x` scale) budding across existing cushions
  // so large lobes have realistic bryophyte sub-hummock texture rather than smooth leather!
  let subKnob = 0;
  if (unionH > 0.04) {
    const su3 = su * 3.4 - 1.4;
    const sv3 = sv * 3.4 + 2.9;
    const kx0 = Math.floor(su3);
    const kz0 = Math.floor(sv3);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = kx0 + dx;
        const cz = kz0 + dz;
        const px = cx + 0.16 + 0.68 * hash3(cx, cz, 211, seed);
        const pz = cz + 0.16 + 0.68 * hash3(cx, cz, 223, seed);
        const rad = 0.58 + 0.28 * hash3(cx, cz, 229, seed);
        const du = (su3 - px) / rad;
        const dv = (sv3 - pz) / rad;
        const r2 = du * du + dv * dv;
        if (r2 < 1.0) {
          const knob = (0.16 + 0.14 * hash3(cx, cz, 241, seed)) * Math.pow(1 - r2, 0.62);
          subKnob = subKnob <= 0 ? knob : smaxPoly(subKnob, knob, 0.03);
        }
      }
    }
  }

  const billow =
    unionH > 0.02
      ? (0.90 + 0.14 * fbm3(u * lobeScale * 2.2, 2.1, v * lobeScale * 2.2, seed ^ 0x4411, 3))
      : 1.0;
  const macroHeight = unionH * billow + subKnob * Math.min(1, unionH * 2.2);
  const cov = Math.max(0, Math.min(1, macroHeight / 0.032));

  // Fine 3..6 mm star-clump cauliflower micro-undulation
  const micro1 = 0.5 + 0.5 * fbm3(u * 34, 0.7, v * 34, seed ^ 0x3141, 2);
  const micro2 = 0.5 + 0.5 * fbm3(u * 72, 1.9, v * 72, seed ^ 0x2718, 2);
  const microTuft = 0.58 * micro1 + 0.42 * micro2;

  const height = cov <= 0.001 ? 0 : macroHeight + 0.020 * (microTuft - 0.5) * Math.min(1, macroHeight * 3.0);

  // Deep V-cleft occlusion where pillows meet (`best1 ≈ best2`) AND around steep overhanging rock lips!
  const cleftSep = best2 > 0.02 ? Math.max(0, Math.min(1, (best1 - best2) * 3.4)) : 1.0;
  const crownLift = Math.max(0, Math.min(1, macroHeight * 1.18));
  const creviceAo = Math.max(
    0.02,
    Math.min(1.0, (0.10 + 0.90 * Math.pow(cleftSep, 0.58)) * Math.pow(crownLift, 0.78)),
  );

  // Subtle sun-toasted russet-ochre crest accent on just 1..2 exposed upper domes
  const toastWave = fbm3(u * 2.8 + 2.4, 4.1, v * 2.8 - 1.5, seed ^ 0x8844, 3);
  const toast =
    Math.max(0, Math.min(1, (toastWave - 0.36) * 3.2)) *
    Math.pow(crownLift, 2.3) *
    creviceAo;

  return { macroHeight, height, coverage: cov, creviceAo, toast, microTuft };
}


