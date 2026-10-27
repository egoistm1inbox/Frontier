/**
 * Quad-native mesh container for the tropical generator.
 *
 * The whole plant — trunk, fronds, every leaflet, fruit and roots — is ONE
 * of these: a single closed quad surface welded together by window
 * junctions (see welder.ts). Faces are quads plus a few triangles at organ
 * tips. UVs are face-varying (per corner, tile-local space) so seams and
 * texture repeats never force duplicated vertices; everything else
 * (position, colour, wind, pivot, organ id, junction flag) is per vertex.
 */

export interface VertexWind {
  /** 0..1 normalised height, drives trunk sway. Filled in at finalize. */
  height: number;
  /** 0..1 distance along the limb from its root, drives limb bending. */
  limb: number;
  /** 0..1 random phase of the limb. */
  phase: number;
  /** 0..1 fine-detail flutter weight (leaflets, blade tips). */
  detail: number;
}

/** Organ ids (Levels view + census). */
export const ORGAN = {
  trunk: 0,
  rachis: 1,
  leaf: 2,
  fruit: 3,
  root: 4,
} as const;

/** Texture-atlas tiles. */
export const TILE = {
  bark: 0,
  leafLong: 1,
  leafCross: 2,
  stem: 3,
} as const;

export class QuadMesh {
  positions: number[] = [];
  /** Per-vertex sRGB colour (procedural flat colour; multiplied by the atlas). */
  colors: number[] = [];
  /** Per-vertex: height, limb, phase, detail. */
  wind: number[] = [];
  /** Per-vertex limb pivot (root of the limb this vertex belongs to). */
  pivots: number[] = [];
  /** Per-vertex organ id (see ORGAN). */
  organs: number[] = [];
  /** Per-vertex junction flag (1 = belongs to a weld loop / collar). */
  junction: number[] = [];

  quads: number[] = [];
  quadUVs: number[] = [];
  quadTiles: number[] = [];
  tris: number[] = [];
  triUVs: number[] = [];
  triTiles: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }
  get quadCount(): number {
    return this.quads.length / 4;
  }
  get triCount(): number {
    return this.tris.length / 3;
  }
  get faceCount(): number {
    return this.quadCount + this.triCount;
  }

  addVertex(
    x: number,
    y: number,
    z: number,
    color: [number, number, number],
    wind: VertexWind,
    pivot: { x: number; y: number; z: number },
    organ: number,
    junction = 0,
  ): number {
    const idx = this.positions.length / 3;
    this.positions.push(x, y, z);
    this.colors.push(color[0], color[1], color[2]);
    this.wind.push(wind.height, wind.limb, wind.phase, wind.detail);
    this.pivots.push(pivot.x, pivot.y, pivot.z);
    this.organs.push(organ);
    this.junction.push(junction);
    return idx;
  }

  setPosition(i: number, x: number, y: number, z: number): void {
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
  }

  pos(i: number): { x: number; y: number; z: number } {
    return { x: this.positions[i * 3], y: this.positions[i * 3 + 1], z: this.positions[i * 3 + 2] };
  }

  /**
   * Emit a quad. `uv` holds 4 (u, v) pairs in tile-local space; u values are
   * unwrapped relative to the first corner so seam-crossing faces stay
   * continuous.
   */
  addQuad(a: number, b: number, c: number, d: number, uv: number[], tile: number): void {
    if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error(`addQuad: reference to a skipped vertex (${a}, ${b}, ${c}, ${d})`);
    if (a === b || b === c || c === d || d === a || a === c || b === d) {
      const ids = [a, b, c, d];
      const uniq = ids.filter((v, i) => ids.indexOf(v) === i);
      if (uniq.length === 3) {
        const uvs: number[] = [];
        for (const u of uniq) {
          const k = ids.indexOf(u);
          uvs.push(uv[k * 2], uv[k * 2 + 1]);
        }
        this.addTri(uniq[0], uniq[1], uniq[2], uvs, tile);
      }
      return;
    }
    this.quads.push(a, b, c, d);
    this.quadTiles.push(tile);
    const u0 = uv[0];
    this.quadUVs.push(u0, uv[1]);
    for (let k = 1; k < 4; k++) {
      let u = uv[k * 2];
      while (u - u0 > 0.5) u -= 1;
      while (u0 - u > 0.5) u += 1;
      this.quadUVs.push(u, uv[k * 2 + 1]);
    }
  }

  addTri(a: number, b: number, c: number, uv: number[], tile: number): void {
    if (a < 0 || b < 0 || c < 0) throw new Error(`addTri: reference to a skipped vertex (${a}, ${b}, ${c})`);
    if (a === b || b === c || c === a) return;
    this.tris.push(a, b, c);
    this.triTiles.push(tile);
    const u0 = uv[0];
    this.triUVs.push(u0, uv[1]);
    for (let k = 1; k < 3; k++) {
      let u = uv[k * 2];
      while (u - u0 > 0.5) u -= 1;
      while (u0 - u > 0.5) u += 1;
      this.triUVs.push(u, uv[k * 2 + 1]);
    }
  }

  /** Area-weighted smooth vertex normals (quads use the diagonal cross product). */
  computeNormals(): Float32Array {
    const n = this.vertexCount;
    const normals = new Float32Array(n * 3);
    const p = this.positions;
    const q = this.quads;
    for (let f = 0; f < q.length; f += 4) {
      const a = q[f] * 3;
      const b = q[f + 1] * 3;
      const c = q[f + 2] * 3;
      const d = q[f + 3] * 3;
      const e1x = p[c] - p[a];
      const e1y = p[c + 1] - p[a + 1];
      const e1z = p[c + 2] - p[a + 2];
      const e2x = p[d] - p[b];
      const e2y = p[d + 1] - p[b + 1];
      const e2z = p[d + 2] - p[b + 2];
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      normals[a] += nx; normals[a + 1] += ny; normals[a + 2] += nz;
      normals[b] += nx; normals[b + 1] += ny; normals[b + 2] += nz;
      normals[c] += nx; normals[c + 1] += ny; normals[c + 2] += nz;
      normals[d] += nx; normals[d + 1] += ny; normals[d + 2] += nz;
    }
    const t = this.tris;
    for (let f = 0; f < t.length; f += 3) {
      const a = t[f] * 3;
      const b = t[f + 1] * 3;
      const c = t[f + 2] * 3;
      const e1x = p[b] - p[a];
      const e1y = p[b + 1] - p[a + 1];
      const e1z = p[b + 2] - p[a + 2];
      const e2x = p[c] - p[a];
      const e2y = p[c + 1] - p[a + 1];
      const e2z = p[c + 2] - p[a + 2];
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      normals[a] += nx; normals[a + 1] += ny; normals[a + 2] += nz;
      normals[b] += nx; normals[b + 1] += ny; normals[b + 2] += nz;
      normals[c] += nx; normals[c + 1] += ny; normals[c + 2] += nz;
    }
    for (let i = 0; i < n; i++) {
      const x = normals[i * 3];
      const y = normals[i * 3 + 1];
      const z = normals[i * 3 + 2];
      const l = Math.sqrt(x * x + y * y + z * z) || 1;
      normals[i * 3] = x / l;
      normals[i * 3 + 1] = y / l;
      normals[i * 3 + 2] = z / l;
    }
    return normals;
  }

  /** Signed volume (positive when faces wind outward). */
  signedVolume(): number {
    const p = this.positions;
    let vol = 0;
    const triVol = (a: number, b: number, c: number): void => {
      const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
      const bx = p[b * 3], by = p[b * 3 + 1], bz = p[b * 3 + 2];
      const cx = p[c * 3], cy = p[c * 3 + 1], cz = p[c * 3 + 2];
      vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    };
    const q = this.quads;
    for (let f = 0; f < q.length; f += 4) {
      triVol(q[f], q[f + 1], q[f + 2]);
      triVol(q[f], q[f + 2], q[f + 3]);
    }
    const t = this.tris;
    for (let f = 0; f < t.length; f += 3) triVol(t[f], t[f + 1], t[f + 2]);
    return vol / 6;
  }

  /** Reverse every face (used if a build ends up inside-out). */
  flipAll(): void {
    const q = this.quads;
    const qu = this.quadUVs;
    for (let f = 0, u = 0; f < q.length; f += 4, u += 8) {
      const b = q[f + 1];
      q[f + 1] = q[f + 3];
      q[f + 3] = b;
      const ux = qu[u + 2], uy = qu[u + 3];
      qu[u + 2] = qu[u + 6]; qu[u + 3] = qu[u + 7];
      qu[u + 6] = ux; qu[u + 7] = uy;
    }
    const t = this.tris;
    const tu = this.triUVs;
    for (let f = 0, u = 0; f < t.length; f += 3, u += 6) {
      const b = t[f + 1];
      t[f + 1] = t[f + 2];
      t[f + 2] = b;
      const ux = tu[u + 2], uy = tu[u + 3];
      tu[u + 2] = tu[u + 4]; tu[u + 3] = tu[u + 5];
      tu[u + 4] = ux; tu[u + 5] = uy;
    }
  }
}
