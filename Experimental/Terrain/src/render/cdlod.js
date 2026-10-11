// Continuous Distance-Dependent LOD (Strugar 2010) over a 128² leaf grid.
// Instances are (originX, originZ, size, level). Optional mirrored surroundings: (2m+1)² tiles, odd tiles flipped.
import { sphereAABB, aabbInFrustum } from '../core/math.js';

export const PATCH_GRID = 32;

export function buildPatchIndices(G = PATCH_GRID) {
  const idx = [];
  const V = (x, z) => z * (G + 1) + x;
  for (let z = 0; z < G; z++) for (let x = 0; x < G; x++) {
    const a = V(x, z), b = V(x + 1, z), c = V(x, z + 1), d = V(x + 1, z + 1);
    // alternate diagonals for a more isotropic mesh
    if ((x + z) & 1) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
  }
  const base = (G + 1) * (G + 1);
  // skirts: edge e (0 = -z, 1 = +z, 2 = -x, 3 = +x), row r (0 top, 1 bottom), k along the edge
  const S = (e, r, k) => base + (e * 2 + r) * (G + 1) + k;
  for (let e = 0; e < 4; e++) for (let k = 0; k < G; k++) {
    const t0 = S(e, 0, k), t1 = S(e, 0, k + 1), b0 = S(e, 1, k), b1 = S(e, 1, k + 1);
    // winding so the outward face is front-facing
    if (e === 0 || e === 3) idx.push(t0, t1, b0, t1, b1, b0); else idx.push(t0, b0, t1, t1, b0, b1);
  }
  return new Uint32Array(idx);
}

export class CDLOD {
  constructor() {
    this.ready = false;
    this.lodFactor = 2.4;
    this.mirror = 0;
  }
  setTerrain(derived) {
    const { L, data } = derived.minmax;
    this.L = L;
    this.D = Math.round(Math.log2(L));
    this.W = derived.world.size;
    this.hs = derived.world.height;
    this.leafW = this.W / L;
    // pyramid of (min, max, water) per level
    const levels = [];
    let n = L;
    let cur = new Float32Array(L * L * 3);
    for (let i = 0; i < L * L; i++) { cur[i * 3] = data[i * 4] * this.hs; cur[i * 3 + 1] = data[i * 4 + 1] * this.hs; cur[i * 3 + 2] = data[i * 4 + 2]; }
    levels.push({ n, d: cur });
    while (n > 1) {
      const m = n >> 1;
      const nx = new Float32Array(m * m * 3);
      for (let z = 0; z < m; z++) for (let x = 0; x < m; x++) {
        let lo = 1e9, hi = -1e9, w = 0;
        for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) {
          const j = ((z * 2 + dz) * n + (x * 2 + dx)) * 3;
          lo = Math.min(lo, cur[j]); hi = Math.max(hi, cur[j + 1]); w = Math.max(w, cur[j + 2]);
        }
        const o = (z * m + x) * 3; nx[o] = lo; nx[o + 1] = hi; nx[o + 2] = w;
      }
      levels.push({ n: m, d: nx });
      cur = nx; n = m;
    }
    this.levels = levels;
    this.ready = true;
  }
  ranges() {
    const r = [];
    for (let l = 0; l <= this.D; l++) r.push(this.leafW * Math.pow(2, l) * this.lodFactor);
    return r;
  }
  // Morph (start, end) per level for the vertex shader
  morphTable() {
    const r = this.ranges();
    const out = new Float32Array(16 * 4);
    for (let l = 0; l <= this.D && l < 16; l++) {
      const end = l === this.D ? 1e9 : r[l];
      const prev = l === 0 ? 0 : r[l - 1];
      const start = l === this.D ? 1e9 - 1 : prev + (end - prev) * 0.68;
      out[l * 4] = start; out[l * 4 + 1] = end; out[l * 4 + 2] = 1 / Math.max(end - start, 1e-3); out[l * 4 + 3] = this.leafW * Math.pow(2, l) / PATCH_GRID;
    }
    return out;
  }
  _mm(tx, tz, l, ix, iz) {
    const lv = this.levels[l];
    const n = lv.n;
    const jx = (tx & 1) ? n - 1 - ix : ix;
    const jz = (tz & 1) ? n - 1 - iz : iz;
    const o = (jz * n + jx) * 3;
    return [lv.d[o], lv.d[o + 1], lv.d[o + 2]];
  }
  select(camPos, planes, opts = {}) {
    if (!this.ready) return { terrain: new Float32Array(0), water: new Float32Array(0), nT: 0, nW: 0 };
    const ranges = this.ranges();
    const terrain = [], water = [];
    const m = opts.mirror ? 2 : 0;
    const W = this.W, D = this.D, leafW = this.leafW;
    const wantWater = opts.water !== false;
    const add = (x0, z0, size, l, wmax, dist) => {
      terrain.push([x0, z0, size, l, dist]);
      if (wantWater && wmax > 0.02) water.push([x0, z0, size, l, dist]);
    };
    const sel = (tx, tz, l, ix, iz) => {
      const size = leafW * (1 << l);
      const x0 = -W / 2 + tx * W + ix * size, z0 = -W / 2 + tz * W + iz * size;
      const [lo, hi, wm] = this._mm(tx, tz, l, ix, iz);
      const mn = [x0, lo - 2, z0], mx = [x0 + size, hi + 2, z0 + size];
      if (l < D && !sphereAABB(camPos, ranges[l], mn, mx)) return false;
      if (!aabbInFrustum(planes, mn, mx)) return true;
      const cx = x0 + size / 2, cz = z0 + size / 2;
      const dist = Math.hypot(cx - camPos[0], (lo + hi) / 2 - camPos[1], cz - camPos[2]);
      if (l === 0) { add(x0, z0, size, 0, wm, dist); return true; }
      if (!sphereAABB(camPos, ranges[l - 1], mn, mx)) { add(x0, z0, size, l, wm, dist); return true; }
      for (let k = 0; k < 4; k++) {
        const cix = ix * 2 + (k & 1), ciz = iz * 2 + (k >> 1);
        if (!sel(tx, tz, l - 1, cix, ciz)) {
          const cs = size / 2;
          const c0x = x0 + (k & 1) * cs, c0z = z0 + (k >> 1) * cs;
          const [clo, chi, cwm] = this._mm(tx, tz, l - 1, cix, ciz);
          if (aabbInFrustum(planes, [c0x, clo - 2, c0z], [c0x + cs, chi + 2, c0z + cs])) {
            add(c0x, c0z, cs, l - 1, cwm, Math.hypot(c0x + cs / 2 - camPos[0], (clo + chi) / 2 - camPos[1], c0z + cs / 2 - camPos[2]));
          }
        }
      }
      return true;
    };
    for (let tz = -m; tz <= m; tz++) for (let tx = -m; tx <= m; tx++) sel(tx, tz, D, 0, 0);
    const pack = (list) => {
      list.sort((a, b) => a[4] - b[4]);
      const f = new Float32Array(list.length * 4);
      list.forEach((it, i) => { f[i * 4] = it[0]; f[i * 4 + 1] = it[1]; f[i * 4 + 2] = it[2]; f[i * 4 + 3] = it[3]; });
      return f;
    };
    return { terrain: pack(terrain), water: pack(water), nT: terrain.length, nW: water.length };
  }
}
