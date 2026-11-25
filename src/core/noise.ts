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

