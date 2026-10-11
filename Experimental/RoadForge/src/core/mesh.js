// RoadForge — quad-first mesh builder.
//
// Everything the road system emits is authored as QUADS. Triangles exist only
// where a quad is geometrically impossible (polygon fills, prop caps).
// Quads are kept as first-class data so the viewport can draw true quad
// wireframe / topology overlays, then triangulated on the shorter diagonal
// for the GPU.

export const VERT_FLOATS = 12; // pos3 nrm3 uv2 aux4
export const VERT_UINTS = 4;   // matId, roadParam, objectId, flags
export const VERT_STRIDE = (VERT_FLOATS + VERT_UINTS) * 4; // 64 bytes

export class MeshBuilder {
  constructor(name = 'mesh') {
    this.name = name;
    this.px = []; this.py = []; this.pz = [];
    this.nx = []; this.ny = []; this.nz = [];
    this.u = []; this.v = [];
    this.a0 = []; this.a1 = []; this.a2 = []; this.a3 = [];
    this.mat = []; this.rp = []; this.obj = []; this.flg = [];
    this.quads = [];   // 4 indices each
    this.tris = [];    // 3 indices each
    this.keys = new Map();
    this.ctx = { mat: 0, rp: 0, obj: 0, flg: 0 };
  }

  get vertexCount() { return this.px.length; }
  get quadCount() { return this.quads.length / 4; }
  get triCount() { return this.tris.length / 3; }

  setCtx(mat = 0, rp = 0, obj = 0, flg = 0) {
    this.ctx.mat = mat; this.ctx.rp = rp; this.ctx.obj = obj; this.ctx.flg = flg;
    return this;
  }

  /** Add a vertex. p=[x,y,z]; uv=[u,v]; aux=[lateral, longitudinal, wear, extra] */
  vert(p, uv = [0, 0], aux = [0, 0, 0, 0], ctx = this.ctx) {
    const i = this.px.length;
    this.px.push(p[0]); this.py.push(p[1]); this.pz.push(p[2]);
    this.nx.push(0); this.ny.push(0); this.nz.push(0);
    this.u.push(uv[0]); this.v.push(uv[1]);
    this.a0.push(aux[0]); this.a1.push(aux[1]); this.a2.push(aux[2]); this.a3.push(aux[3]);
    this.mat.push(ctx.mat | 0); this.rp.push(ctx.rp | 0);
    this.obj.push(ctx.obj | 0); this.flg.push(ctx.flg | 0);
    return i;
  }

  /** Vertex with an explicit weld key — the mechanism that fuses junction caps
   *  and road ends into ONE continuous surface with shared vertices. */
  weld(key, p, uv, aux, ctx = this.ctx) {
    const hit = this.keys.get(key);
    if (hit !== undefined) return hit;
    const i = this.vert(p, uv, aux, ctx);
    this.keys.set(key, i);
    return i;
  }

  hasKey(key) { return this.keys.has(key); }
  keyIndex(key) { return this.keys.get(key); }

  quad(a, b, c, d) {
    if (a === b || b === c || c === d || d === a) {
      // Degenerate ring (collapsed corner) — emit the valid triangle instead.
      if (a !== b && b !== c && a !== c) this.tris.push(a, b, c);
      else if (a !== c && c !== d && a !== d) this.tris.push(a, c, d);
      return;
    }
    this.quads.push(a, b, c, d);
  }

  tri(a, b, c) {
    if (a === b || b === c || a === c) return;
    this.tris.push(a, b, c);
  }

  /** Bridge two equal-length index rows into a quad strip (the workhorse). */
  strip(rowA, rowB, flip = false) {
    const n = Math.min(rowA.length, rowB.length);
    for (let i = 0; i < n - 1; i++) {
      if (flip) this.quad(rowA[i], rowA[i + 1], rowB[i + 1], rowB[i]);
      else this.quad(rowA[i], rowB[i], rowB[i + 1], rowA[i + 1]);
    }
  }

  pos(i) { return [this.px[i], this.py[i], this.pz[i]]; }

  /* ----------------------------------------------------------- finishing */

  computeNormals(creaseSplit = false) {
    const { px, py, pz } = this;
    const nx = new Float64Array(px.length);
    const ny = new Float64Array(px.length);
    const nz = new Float64Array(px.length);
    const accum = (idx, n, w) => {
      for (const i of idx) { nx[i] += n[0] * w; ny[i] += n[1] * w; nz[i] += n[2] * w; }
    };
    const newell = (idx) => {
      let X = 0, Y = 0, Z = 0;
      for (let k = 0; k < idx.length; k++) {
        const i = idx[k], j = idx[(k + 1) % idx.length];
        X += (py[i] - py[j]) * (pz[i] + pz[j]);
        Y += (pz[i] - pz[j]) * (px[i] + px[j]);
        Z += (px[i] - px[j]) * (py[i] + py[j]);
      }
      const l = Math.hypot(X, Y, Z) || 1;
      return [X / l, Y / l, Z / l, l * 0.5];
    };
    for (let q = 0; q < this.quads.length; q += 4) {
      const idx = [this.quads[q], this.quads[q + 1], this.quads[q + 2], this.quads[q + 3]];
      const n = newell(idx);
      accum(idx, n, Math.max(n[3], 1e-5));
    }
    for (let t = 0; t < this.tris.length; t += 3) {
      const idx = [this.tris[t], this.tris[t + 1], this.tris[t + 2]];
      const n = newell(idx);
      accum(idx, n, Math.max(n[3], 1e-5));
    }
    for (let i = 0; i < px.length; i++) {
      const l = Math.hypot(nx[i], ny[i], nz[i]) || 1;
      this.nx[i] = nx[i] / l; this.ny[i] = ny[i] / l; this.nz[i] = nz[i] / l;
    }
    return this;
  }

  /** Triangulate quads along the shorter diagonal (better shading + silhouettes). */
  buildIndices() {
    const n = this.quadCount * 6 + this.triCount * 3;
    const out = new Uint32Array(n);
    let w = 0;
    const { px, py, pz } = this;
    const d2 = (i, j) => (px[i] - px[j]) ** 2 + (py[i] - py[j]) ** 2 + (pz[i] - pz[j]) ** 2;
    for (let q = 0; q < this.quads.length; q += 4) {
      const a = this.quads[q], b = this.quads[q + 1], c = this.quads[q + 2], d = this.quads[q + 3];
      if (d2(a, c) <= d2(b, d)) {
        out[w++] = a; out[w++] = b; out[w++] = c;
        out[w++] = a; out[w++] = c; out[w++] = d;
      } else {
        out[w++] = a; out[w++] = b; out[w++] = d;
        out[w++] = b; out[w++] = c; out[w++] = d;
      }
    }
    for (let t = 0; t < this.tris.length; t++) out[w++] = this.tris[t];
    return out;
  }

  /**
   * Index buffer where each named part occupies ONE contiguous range
   * (its quads triangulated first, then its loose triangles). Used by the
   * prop atlas so every prop type is a single instanced draw.
   */
  buildIndicesGrouped(parts) {
    const n = this.quadCount * 6 + this.triCount * 3;
    const out = new Uint32Array(n);
    const ranges = {};
    let w = 0;
    const { px, py, pz } = this;
    const d2 = (i, j) => (px[i] - px[j]) ** 2 + (py[i] - py[j]) ** 2 + (pz[i] - pz[j]) ** 2;
    for (const part of parts) {
      const start = w;
      for (let q = part.quad0; q < part.quad1; q += 4) {
        const a = this.quads[q], b = this.quads[q + 1], c = this.quads[q + 2], d = this.quads[q + 3];
        if (d2(a, c) <= d2(b, d)) {
          out[w++] = a; out[w++] = b; out[w++] = c;
          out[w++] = a; out[w++] = c; out[w++] = d;
        } else {
          out[w++] = a; out[w++] = b; out[w++] = d;
          out[w++] = b; out[w++] = c; out[w++] = d;
        }
      }
      for (let t = part.tri0; t < part.tri1; t++) out[w++] = this.tris[t];
      ranges[part.name] = { indexOffset: start, indexCount: w - start };
    }
    return { indices: out.subarray(0, w), ranges };
  }

  /** Unique quad-boundary edges: the honest topology overlay. */
  buildQuadWire() {
    const set = new Set();
    const push = (a, b) => {
      const k = a < b ? a * 4294967296 + b : b * 4294967296 + a;
      set.add(k);
    };
    for (let q = 0; q < this.quads.length; q += 4) {
      const a = this.quads[q], b = this.quads[q + 1], c = this.quads[q + 2], d = this.quads[q + 3];
      push(a, b); push(b, c); push(c, d); push(d, a);
    }
    for (let t = 0; t < this.tris.length; t += 3) {
      const a = this.tris[t], b = this.tris[t + 1], c = this.tris[t + 2];
      push(a, b); push(b, c); push(c, a);
    }
    const out = new Uint32Array(set.size * 2);
    let w = 0;
    for (const k of set) {
      out[w++] = Math.floor(k / 4294967296);
      out[w++] = k % 4294967296;
    }
    return out;
  }

  interleave() {
    const n = this.px.length;
    const buf = new ArrayBuffer(n * VERT_STRIDE);
    const f = new Float32Array(buf);
    const u32 = new Uint32Array(buf);
    for (let i = 0; i < n; i++) {
      const o = i * 16;
      f[o] = this.px[i]; f[o + 1] = this.py[i]; f[o + 2] = this.pz[i];
      f[o + 3] = this.nx[i]; f[o + 4] = this.ny[i]; f[o + 5] = this.nz[i];
      f[o + 6] = this.u[i]; f[o + 7] = this.v[i];
      f[o + 8] = this.a0[i]; f[o + 9] = this.a1[i]; f[o + 10] = this.a2[i]; f[o + 11] = this.a3[i];
      u32[o + 12] = this.mat[i]; u32[o + 13] = this.rp[i];
      u32[o + 14] = this.obj[i]; u32[o + 15] = this.flg[i];
    }
    return buf;
  }

  bounds() {
    let mnx = Infinity, mny = Infinity, mnz = Infinity;
    let mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    for (let i = 0; i < this.px.length; i++) {
      if (this.px[i] < mnx) mnx = this.px[i];
      if (this.py[i] < mny) mny = this.py[i];
      if (this.pz[i] < mnz) mnz = this.pz[i];
      if (this.px[i] > mxx) mxx = this.px[i];
      if (this.py[i] > mxy) mxy = this.py[i];
      if (this.pz[i] > mxz) mxz = this.pz[i];
    }
    return { min: [mnx, mny, mnz], max: [mxx, mxy, mxz] };
  }

  finish({ normals = true, wire = true } = {}) {
    if (normals) this.computeNormals();
    return {
      name: this.name,
      vertexData: this.interleave(),
      indices: this.buildIndices(),
      wire: wire ? this.buildQuadWire() : new Uint32Array(0),
      vertexCount: this.vertexCount,
      quadCount: this.quadCount,
      triCount: this.triCount,
      bounds: this.bounds(),
    };
  }
}

/* ------------------------------------------------------------- primitives
 * Generic quad-topology builders shared by props, rails and vehicles.
 * All of them emit quad rings so the topology overlay stays honest.
 * ------------------------------------------------------------------------ */

/** Revolve a 2D profile [[r,y],...] around +Y. Produces quad rings. */
export function revolve(mb, profile, segments, transform, { capTop = true, capBottom = true, uvScale = 1 } = {}) {
  const rings = [];
  for (let p = 0; p < profile.length; p++) {
    const ring = [];
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      const r = profile[p][0];
      const pt = transform([Math.cos(a) * r, profile[p][1], Math.sin(a) * r]);
      ring.push(mb.vert(pt, [(s / segments) * uvScale, profile[p][1] * uvScale], [0, 0, 0, 0]));
    }
    rings.push(ring);
  }
  for (let p = 0; p < rings.length - 1; p++) {
    for (let s = 0; s < segments; s++) {
      const s2 = (s + 1) % segments;
      mb.quad(rings[p][s], rings[p][s2], rings[p + 1][s2], rings[p + 1][s]);
    }
  }
  if (capBottom && profile[0][0] > 1e-4) fanCap(mb, rings[0], transform([0, profile[0][1], 0]), true);
  if (capTop && profile[profile.length - 1][0] > 1e-4) {
    fanCap(mb, rings[rings.length - 1], transform([0, profile[profile.length - 1][1], 0]), false);
  }
  return rings;
}

export function fanCap(mb, ring, center, flip) {
  const c = mb.vert(center, [0.5, 0.5], [0, 0, 0, 0]);
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (flip) mb.tri(c, ring[j], ring[i]);
    else mb.tri(c, ring[i], ring[j]);
  }
}

/** Sweep a 2D cross-section [[x,y],...] along a 3D path with frames. */
export function sweep(mb, section, path, { closed = false, capStart = false, capEnd = false, uvScale = 1, up = [0, 1, 0] } = {}) {
  const rings = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i].p;
    const fwd = path[i].t;
    let right = [fwd[2] * up[1] - fwd[1] * up[2], fwd[0] * up[2] - fwd[2] * up[0], fwd[1] * up[0] - fwd[0] * up[1]];
    // right = normalize(cross(fwd, up)) with up=(0,1,0) -> (fwd.z, 0, -fwd.x)
    right = [fwd[2], 0, -fwd[0]];
    const rl = Math.hypot(right[0], right[2]) || 1;
    right = [right[0] / rl, 0, right[2] / rl];
    const u2 = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
    const ring = [];
    for (let s = 0; s < section.length; s++) {
      const sx = section[s][0], sy = section[s][1];
      ring.push(mb.vert([
        p[0] + right[0] * sx + u2[0] * sy,
        p[1] + right[1] * sx + u2[1] * sy,
        p[2] + right[2] * sx + u2[2] * sy,
      ], [s * 0.25 * uvScale, (path[i].d || i) * uvScale], [sx, path[i].d || i, 0, 0]));
    }
    rings.push(ring);
  }
  const last = closed ? rings.length : rings.length - 1;
  for (let i = 0; i < last; i++) {
    const A = rings[i], B = rings[(i + 1) % rings.length];
    for (let s = 0; s < section.length - 1; s++) mb.quad(A[s], A[s + 1], B[s + 1], B[s]);
    if (closed) { /* section open by default */ }
  }
  if (capStart) capRing(mb, rings[0], true);
  if (capEnd) capRing(mb, rings[rings.length - 1], false);
  return rings;
}

export function capRing(mb, ring, flip) {
  // Fan from the centroid of the ring.
  let cx = 0, cy = 0, cz = 0;
  for (const i of ring) { cx += mb.px[i]; cy += mb.py[i]; cz += mb.pz[i]; }
  const n = ring.length;
  const c = mb.vert([cx / n, cy / n, cz / n], [0.5, 0.5], [0, 0, 0, 0]);
  for (let i = 0; i < n - 1; i++) {
    if (flip) mb.tri(c, ring[i + 1], ring[i]);
    else mb.tri(c, ring[i], ring[i + 1]);
  }
}

/** Axis-aligned box as 6 quads (hard edges: 24 verts). */
export function box(mb, center, size, rotY = 0, uvScale = 1) {
  const [cx, cy, cz] = center;
  const hx = size[0] / 2, hy = size[1] / 2, hz = size[2] / 2;
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const P = (x, y, z) => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
  const corners = [
    P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz),
    P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz),
  ];
  const faces = [
    [4, 5, 6, 7], [1, 0, 3, 2], [0, 4, 7, 3], [5, 1, 2, 6], [3, 7, 6, 2], [0, 1, 5, 4],
  ];
  for (const f of faces) {
    const idx = f.map((k, n) => mb.vert(corners[k], [
      (n === 1 || n === 2 ? 1 : 0) * Math.max(size[0], size[2]) * uvScale,
      (n >= 2 ? 1 : 0) * Math.max(size[1], size[2]) * uvScale,
    ], [0, 0, 0, 0]));
    mb.quad(idx[0], idx[1], idx[2], idx[3]);
  }
}

/** Rounded/chamfered box — superellipsoid-ish, all quads. Used for vehicles. */
export function roundedBox(mb, center, size, radius, seg = 3, rotY = 0) {
  const [sx, sy, sz] = [size[0] / 2, size[1] / 2, size[2] / 2];
  const r = Math.min(radius, Math.min(sx, Math.min(sy, sz)) * 0.9);
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const n = seg * 4;
  const rings = [];
  // Build as a lathe over Y-slices of a rounded rectangle.
  const slices = [];
  const steps = seg * 2 + 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ang = -Math.PI / 2 + t * Math.PI;
    const y = Math.sin(ang) * sy;
    const k = Math.cos(ang);
    const fy = Math.min(1, (sy - Math.abs(y)) / r);
    const shrink = 1 - (1 - Math.sqrt(Math.max(0, Math.min(1, fy)))) * (r / Math.min(sx, sz));
    slices.push([y, Math.max(0.05, shrink)]);
  }
  for (const [y, k] of slices) {
    const ring = [];
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      // rounded-rect radius
      const p = 4.0;
      const rr = 1 / Math.pow(Math.pow(Math.abs(ca), p) + Math.pow(Math.abs(sa), p), 1 / p);
      const x = ca * rr * sx * k, z = sa * rr * sz * k;
      ring.push(mb.vert([center[0] + x * c + z * s, center[1] + y, center[2] - x * s + z * c],
        [j / n, (y + sy) / (sy * 2)], [0, 0, 0, 0]));
    }
    rings.push(ring);
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      mb.quad(rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]);
    }
  }
  return rings;
}

/** Extrude a closed 2D polygon (XZ) vertically. Quad walls + triangulated caps. */
export function extrudePolygon(mb, poly, y0, y1, { capTop = true, capBottom = false, uvScale = 0.25 } = {}) {
  const n = poly.length;
  const bot = [], top = [];
  let run = 0;
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    bot.push(mb.vert([p[0], y0, p[1]], [run * uvScale, y0 * uvScale], [0, 0, 0, 0]));
    top.push(mb.vert([p[0], y1, p[1]], [run * uvScale, y1 * uvScale], [0, 0, 0, 0]));
    const q = poly[(i + 1) % n];
    run += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    mb.quad(bot[i], bot[j], top[j], top[i]);
  }
  if (capTop) {
    const tri = earcut(poly);
    for (let i = 0; i < tri.length; i += 3) mb.tri(top[tri[i]], top[tri[i + 1]], top[tri[i + 2]]);
  }
  if (capBottom) {
    const tri = earcut(poly);
    for (let i = 0; i < tri.length; i += 3) mb.tri(bot[tri[i + 2]], bot[tri[i + 1]], bot[tri[i]]);
  }
}

/* --------------------------------------------------------------- earcut */
// Compact ear clipping for simple polygons (used for block fills + caps).
export function earcut(poly) {
  const n = poly.length;
  const out = [];
  if (n < 3) return out;
  // Standard signed area; normalise the working order to CCW.
  let A = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    A += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  }
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(A >= 0 ? i : n - 1 - i);

  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inTri = (a, b, c, p) =>
    cross(a, b, p) > 1e-10 && cross(b, c, p) > 1e-10 && cross(c, a, p) > 1e-10;

  let guard = 0;
  while (idx.length > 3 && guard++ < n * n + 128) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const m = idx.length;
      const i0 = idx[(i + m - 1) % m], i1 = idx[i], i2 = idx[(i + 1) % m];
      const a = poly[i0], b = poly[i1], c = poly[i2];
      if (cross(a, b, c) <= 1e-10) continue;        // reflex or degenerate
      let ok = true;
      for (let k = 0; k < m; k++) {
        const ik = idx[k];
        if (ik === i0 || ik === i1 || ik === i2) continue;
        if (inTri(a, b, c, poly[ik])) { ok = false; break; }
      }
      if (!ok) continue;
      out.push(i0, i1, i2);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) {
    out.push(idx[0], idx[1], idx[2]);
  } else if (idx.length > 3) {
    // Degenerate remainder: fall back to a centroid-free fan so no hole is left.
    for (let i = 1; i < idx.length - 1; i++) out.push(idx[0], idx[i], idx[i + 1]);
  }
  return out;
}

/** Offset (inset) a simple polygon by d (positive = inward for CCW). */
export function insetPolygon(poly, d) {
  const n = poly.length;
  const out = [];
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  const sgn = area > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i + n - 1) % n], p1 = poly[i], p2 = poly[(i + 1) % n];
    let d1 = [p1[0] - p0[0], p1[1] - p0[1]];
    let d2 = [p2[0] - p1[0], p2[1] - p1[1]];
    const l1 = Math.hypot(d1[0], d1[1]) || 1, l2 = Math.hypot(d2[0], d2[1]) || 1;
    d1 = [d1[0] / l1, d1[1] / l1];
    d2 = [d2[0] / l2, d2[1] / l2];
    const n1 = [-d1[1] * sgn, d1[0] * sgn];
    const n2 = [-d2[1] * sgn, d2[0] * sgn];
    let bis = [n1[0] + n2[0], n1[1] + n2[1]];
    const bl = Math.hypot(bis[0], bis[1]);
    if (bl < 1e-6) { out.push([p1[0], p1[1]]); continue; }
    bis = [bis[0] / bl, bis[1] / bl];
    const cosHalf = Math.max(0.25, bis[0] * n1[0] + bis[1] * n1[1]);
    out.push([p1[0] - bis[0] * (d / cosHalf), p1[1] - bis[1] * (d / cosHalf)]);
  }
  return out;
}
