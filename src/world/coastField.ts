// 2D signed-distance texture of the coastline (km, negative inland), truncated to ±band.
// Baked once at start-up. Pure function so it can be unit tested in Node.

export interface CoastField {
  n: number;
  halfKm: number;
  bandKm: number;
  /** Row-major, index = j * n + i, where i = x texel and j = z texel. */
  data: Float32Array;
}

export function bakeCoastField(
  polyM: ReadonlyArray<readonly [number, number]>,
  n: number,
  halfKm: number,
  bandKm: number,
): CoastField {
  const poly = polyM.map(([x, z]) => [x / 1000, z / 1000] as const);
  const cs = (2 * halfKm) / n;
  const data = new Float32Array(n * n).fill(bandKm);
  const inside = new Uint8Array(n * n);
  const m = poly.length;

  // 1) Unsigned distance: only evaluate texels inside each edge's band.
  for (let e = 0; e < m; e++) {
    const [ax, az] = poly[e];
    const [bx, bz] = poly[(e + 1) % m];
    const minX = Math.min(ax, bx) - bandKm, maxX = Math.max(ax, bx) + bandKm;
    const minZ = Math.min(az, bz) - bandKm, maxZ = Math.max(az, bz) + bandKm;
    const i0 = Math.max(0, Math.floor((minX + halfKm) / cs - 0.5));
    const i1 = Math.min(n - 1, Math.ceil((maxX + halfKm) / cs - 0.5));
    const j0 = Math.max(0, Math.floor((minZ + halfKm) / cs - 0.5));
    const j1 = Math.min(n - 1, Math.ceil((maxZ + halfKm) / cs - 0.5));
    for (let j = j0; j <= j1; j++) {
      const zc = -halfKm + (j + 0.5) * cs;
      for (let i = i0; i <= i1; i++) {
        const xc = -halfKm + (i + 0.5) * cs;
        const d = pointSegmentDistance(xc, zc, ax, az, bx, bz);
        const idx = j * n + i;
        if (d < data[idx]) data[idx] = d;
      }
    }
  }

  // 2) Sign: even-odd scanline per texel row.
  for (let j = 0; j < n; j++) {
    const zc = -halfKm + (j + 0.5) * cs;
    const xs: number[] = [];
    for (let e = 0; e < m; e++) {
      const [ax, az] = poly[e];
      const [bx, bz] = poly[(e + 1) % m];
      if ((az <= zc) !== (bz <= zc)) xs.push(ax + ((zc - az) * (bx - ax)) / (bz - az));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let i = 0; i < n; i++) {
        const xc = -halfKm + (i + 0.5) * cs;
        if (xc >= xs[k] && xc < xs[k + 1]) inside[j * n + i] = 1;
      }
    }
  }
  for (let idx = 0; idx < n * n; idx++) if (inside[idx]) data[idx] = -data[idx];
  return { n, halfKm, bandKm, data };
}

/** Bilinear sample (clamped to edges) of the coast field at world metres (x, z). Returns km. */
export function sampleCoastKm(field: CoastField, xM: number, zM: number): number {
  const { n, halfKm, data } = field;
  const cs = (2 * halfKm) / n;
  const u = (xM / 1000 + halfKm) / cs - 0.5;
  const v = (zM / 1000 + halfKm) / cs - 0.5;
  const i0 = clampInt(Math.floor(u), 0, n - 1), j0 = clampInt(Math.floor(v), 0, n - 1);
  const i1 = clampInt(i0 + 1, 0, n - 1), j1 = clampInt(j0 + 1, 0, n - 1);
  const fu = Math.min(1, Math.max(0, u - i0)), fv = Math.min(1, Math.max(0, v - j0));
  const a = data[j0 * n + i0], b = data[j0 * n + i1];
  const c = data[j1 * n + i0], d = data[j1 * n + i1];
  return (a + (b - a) * fu) * (1 - fv) + (c + (d - c) * fu) * fv;
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function pointSegmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax, vz = bz - az;
  const wx = px - ax, wz = pz - az;
  const len2 = vx * vx + vz * vz;
  let t = len2 > 0 ? (wx * vx + wz * vz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = wx - vx * t, dz = wz - vz * t;
  return Math.sqrt(dx * dx + dz * dz);
}
