/**
 * High-poly anatomical PartMesh & SceneAssembly container, topology reporter,
 * zero-copy Web Worker transfer packer, quad-preserving OBJ exporter, and
 * multi-node glTF 2.0 Binary (GLB) exporter.
 */

import { RGB, V3, clamp, rotateAxis } from './math';

export type ShadingProfile = 'botanical' | 'hair' | 'moss' | 'substrate' | 'flower';

export interface VertexInput {
  x: number;
  y: number;
  z: number;
  /** Optional explicit normal (if omitted, computed from face geometry). */
  nx?: number;
  ny?: number;
  nz?: number;
  /** Tangent along leaf vein / hair shaft / stem axis (for anisotropic specular). */
  tx?: number;
  ty?: number;
  tz?: number;
  u?: number;
  v?: number;
  color: RGB;
  /** Wind: [height01, limbFlex, phase01, flutterWeight]. */
  wind?: [number, number, number, number];
  pivot?: V3;
  /** Surface channels: [roughness, translucency, detailMetric, anatomyLevel]. */
  roughness?: number;
  translucency?: number;
  /** Vein intensity / clump id / moisture [0..1] for shader & Detail heatmap. */
  detailMetric?: number;
  /** Integer anatomy level (0..5) for Anatomy display mode. */
  anatomyLevel?: number;
}

export class PartMesh {
  readonly id: string;
  readonly name: string;
  readonly shading: ShadingProfile;
  readonly parentId: string | null;
  readonly groupIcon: string;
  readonly accent: string;

  positions: number[] = [];
  normals: number[] = [];
  hasExplicitNormals = false;
  tangents: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  wind: number[] = [];
  pivots: number[] = [];
  /** vec4: roughness, translucency, detailMetric, anatomyLevel */
  surface: number[] = [];

  /** True quad faces (4 vertex indices each). */
  quads: number[] = [];
  /** Triangle faces (3 vertex indices each). */
  tris: number[] = [];
  /** Optional guide polylines (pairs of vertex indices for guide strands). */
  lines: number[] = [];

  /** Optional metadata badge shown in Outliner (e.g. "14 fronds" or "18k strands"). */
  metaLabel = '';

  constructor(
    id: string,
    name: string,
    shading: ShadingProfile = 'botanical',
    parentId: string | null = null,
    groupIcon = 'leaf',
    accent = '#34c759',
  ) {
    this.id = id;
    this.name = name;
    this.shading = shading;
    this.parentId = parentId;
    this.groupIcon = groupIcon;
    this.accent = accent;
  }

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
  get renderedTriangles(): number {
    return this.quadCount * 2 + this.triCount;
  }

  addVertex(v: VertexInput): number {
    const idx = this.positions.length / 3;
    this.positions.push(v.x, v.y, v.z);
    if (v.nx !== undefined && v.ny !== undefined && v.nz !== undefined) {
      this.normals.push(v.nx, v.ny, v.nz);
      this.hasExplicitNormals = true;
    } else {
      this.normals.push(0, 0, 0);
    }
    this.tangents.push(v.tx ?? 0, v.ty ?? 1, v.tz ?? 0);
    this.uvs.push(v.u ?? 0, v.v ?? 0);
    this.colors.push(v.color.r, v.color.g, v.color.b);
    const w = v.wind ?? [0, 0, 0, 0];
    this.wind.push(w[0], w[1], w[2], w[3]);
    const p = v.pivot ?? { x: 0, y: 0, z: 0 };
    this.pivots.push(p.x, p.y, p.z);
    this.surface.push(
      v.roughness ?? 0.55,
      v.translucency ?? 0.35,
      v.detailMetric ?? 0,
      v.anatomyLevel ?? 0,
    );
    return idx;
  }

  addQuad(a: number, b: number, c: number, d: number): void {
    if (a === b || b === c || c === d || d === a || a === c || b === d) {
      const uniq: number[] = [];
      for (const x of [a, b, c, d]) if (!uniq.includes(x)) uniq.push(x);
      if (uniq.length === 3) this.tris.push(uniq[0], uniq[1], uniq[2]);
      return;
    }
    this.quads.push(a, b, c, d);
  }

  addTri(a: number, b: number, c: number): void {
    if (a === b || b === c || a === c) return;
    this.tris.push(a, b, c);
  }

  addLine(a: number, b: number): void {
    if (a === b) return;
    this.lines.push(a, b);
  }

  /** Apply layer transform (scale, yawDeg around Y, translation). */
  applyTransform(tx: number, ty: number, tz: number, yawDeg: number, uniformScale: number): void {
    const rad = (yawDeg * Math.PI) / 180;
    const cosY = Math.cos(rad);
    const sinY = Math.sin(rad);
    const s = uniformScale;
    const p = this.positions;
    const n = this.normals;
    const t = this.tangents;
    const pv = this.pivots;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i] * s;
      const y = p[i + 1] * s;
      const z = p[i + 2] * s;
      p[i] = x * cosY + z * sinY + tx;
      p[i + 1] = y + ty;
      p[i + 2] = -x * sinY + z * cosY + tz;

      if (this.hasExplicitNormals) {
        const nx = n[i];
        const nz = n[i + 2];
        n[i] = nx * cosY + nz * sinY;
        n[i + 2] = -nx * sinY + nz * cosY;
      }

      const tx0 = t[i];
      const tz0 = t[i + 2];
      t[i] = tx0 * cosY + tz0 * sinY;
      t[i + 2] = -tx0 * sinY + tz0 * cosY;

      const px = pv[i] * s;
      const py = pv[i + 1] * s;
      const pz = pv[i + 2] * s;
      pv[i] = px * cosY + pz * sinY + tx;
      pv[i + 1] = py + ty;
      pv[i + 2] = -px * sinY + pz * cosY + tz;
    }
  }

  /** Ensure smooth area-weighted normals exist (blended with any explicit sculpted relief). */
  computeNormals(): Float32Array {
    const V = this.vertexCount;
    const out = new Float32Array(V * 3);
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
      out[a] += nx; out[a + 1] += ny; out[a + 2] += nz;
      out[b] += nx; out[b + 1] += ny; out[b + 2] += nz;
      out[c] += nx; out[c + 1] += ny; out[c + 2] += nz;
      out[d] += nx; out[d + 1] += ny; out[d + 2] += nz;
    }
    const tr = this.tris;
    for (let f = 0; f < tr.length; f += 3) {
      const a = tr[f] * 3;
      const b = tr[f + 1] * 3;
      const c = tr[f + 2] * 3;
      const e1x = p[b] - p[a];
      const e1y = p[b + 1] - p[a + 1];
      const e1z = p[b + 2] - p[a + 2];
      const e2x = p[c] - p[a];
      const e2y = p[c + 1] - p[a + 1];
      const e2z = p[c + 2] - p[a + 2];
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      out[a] += nx; out[a + 1] += ny; out[a + 2] += nz;
      out[b] += nx; out[b + 1] += ny; out[b + 2] += nz;
      out[c] += nx; out[c + 1] += ny; out[c + 2] += nz;
    }
    const exp = this.normals;
    for (let i = 0; i < V; i++) {
      const k = i * 3;
      let gx = out[k];
      let gy = out[k + 1];
      let gz = out[k + 2];
      const gl = Math.sqrt(gx * gx + gy * gy + gz * gz);
      if (gl > 1e-12) {
        gx /= gl; gy /= gl; gz /= gl;
      } else {
        gx = 0; gy = 1; gz = 0;
      }
      if (this.hasExplicitNormals) {
        const ex = exp[k];
        const ey = exp[k + 1];
        const ez = exp[k + 2];
        const el = Math.sqrt(ex * ex + ey * ey + ez * ez);
        if (el > 0.25) {
          gx = ex / el;
          gy = ey / el;
          gz = ez / el;
        }
      }
      out[k] = gx;
      out[k + 1] = gy;
      out[k + 2] = gz;
    }
    return out;
  }

  toPacket(includeEdges = true): PartPacket {
    const normals = this.computeNormals();
    const qCount = this.quads.length / 4;
    const tCount = this.tris.length / 3;
    const index = new Uint32Array(qCount * 6 + tCount * 3);
    const edgeIndex = includeEdges ? new Uint32Array(qCount * 8 + tCount * 6 + this.lines.length) : new Uint32Array(this.lines.length);
    const p = this.positions;
    const q = this.quads;
    let ii = 0;
    let ei = 0;
    for (let f = 0; f < q.length; f += 4) {
      const a = q[f];
      const b = q[f + 1];
      const c = q[f + 2];
      const d = q[f + 3];
      const dac = distSqIdx(p, a, c);
      const dbd = distSqIdx(p, b, d);
      if (dac <= dbd) {
        index[ii++] = a; index[ii++] = b; index[ii++] = c;
        index[ii++] = a; index[ii++] = c; index[ii++] = d;
      } else {
        index[ii++] = a; index[ii++] = b; index[ii++] = d;
        index[ii++] = b; index[ii++] = c; index[ii++] = d;
      }
      if (includeEdges) {
        edgeIndex[ei++] = a; edgeIndex[ei++] = b;
        edgeIndex[ei++] = b; edgeIndex[ei++] = c;
        edgeIndex[ei++] = c; edgeIndex[ei++] = d;
        edgeIndex[ei++] = d; edgeIndex[ei++] = a;
      }
    }
    const tr = this.tris;
    for (let f = 0; f < tr.length; f += 3) {
      const a = tr[f];
      const b = tr[f + 1];
      const c = tr[f + 2];
      index[ii++] = a; index[ii++] = b; index[ii++] = c;
      if (includeEdges) {
        edgeIndex[ei++] = a; edgeIndex[ei++] = b;
        edgeIndex[ei++] = b; edgeIndex[ei++] = c;
        edgeIndex[ei++] = c; edgeIndex[ei++] = a;
      }
    }
    for (let l = 0; l < this.lines.length; l++) {
      edgeIndex[ei++] = this.lines[l];
    }

    // Bounding box
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    if (!Number.isFinite(minX)) {
      minX = minY = minZ = -0.1;
      maxX = maxY = maxZ = 0.1;
    }

    return {
      id: this.id,
      name: this.name,
      parentId: this.parentId,
      shading: this.shading,
      groupIcon: this.groupIcon,
      accent: this.accent,
      metaLabel: this.metaLabel,
      vertexCount: this.vertexCount,
      quadCount: qCount,
      triCount: tCount,
      renderedTriangles: qCount * 2 + tCount,
      lineSegments: this.lines.length / 2,
      bounds: [minX, minY, minZ, maxX, maxY, maxZ],
      position: new Float32Array(this.positions),
      normal: normals,
      tangent: new Float32Array(this.tangents),
      uv: new Float32Array(this.uvs),
      color: new Float32Array(this.colors),
      wind: new Float32Array(this.wind),
      pivot: new Float32Array(this.pivots),
      surface: new Float32Array(this.surface),
      index,
      edgeIndex,
    };
  }
}

function distSqIdx(p: number[], a: number, b: number): number {
  const dx = p[a * 3] - p[b * 3];
  const dy = p[a * 3 + 1] - p[b * 3 + 1];
  const dz = p[a * 3 + 2] - p[b * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}

export interface PartPacket {
  id: string;
  name: string;
  parentId: string | null;
  shading: ShadingProfile;
  groupIcon: string;
  accent: string;
  metaLabel: string;
  vertexCount: number;
  quadCount: number;
  triCount: number;
  renderedTriangles: number;
  lineSegments: number;
  bounds: [number, number, number, number, number, number];
  position: Float32Array;
  normal: Float32Array;
  tangent: Float32Array;
  uv: Float32Array;
  color: Float32Array;
  wind: Float32Array;
  pivot: Float32Array;
  surface: Float32Array;
  index: Uint32Array;
  edgeIndex: Uint32Array;
}

export interface TopologySummary {
  vertices: number;
  faces: number;
  quads: number;
  tris: number;
  renderedTriangles: number;
  quadRatio: number;
  parts: number;
  subParts: number;
  degenerateFaces: number;
  nanVertices: number;
  boundsWidth: number;
  boundsHeight: number;
  boundsDepth: number;
  clean: boolean;
}

export function auditParts(parts: PartMesh[]): TopologySummary {
  let vertices = 0;
  let quads = 0;
  let tris = 0;
  let degenerateFaces = 0;
  let nanVertices = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const part of parts) {
    vertices += part.vertexCount;
    quads += part.quadCount;
    tris += part.triCount;
    const p = part.positions;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        nanVertices++;
        continue;
      }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const q = part.quads;
    for (let f = 0; f < q.length; f += 4) {
      if (q[f] === q[f + 1] || q[f + 1] === q[f + 2] || q[f + 2] === q[f + 3] || q[f + 3] === q[f]) degenerateFaces++;
    }
    const t = part.tris;
    for (let f = 0; f < t.length; f += 3) {
      if (t[f] === t[f + 1] || t[f + 1] === t[f + 2] || t[f] === t[f + 2]) degenerateFaces++;
    }
  }
  const faces = quads + tris;
  if (!Number.isFinite(minX)) {
    minX = minY = minZ = 0;
    maxX = maxY = maxZ = 0;
  }
  return {
    vertices,
    faces,
    quads,
    tris,
    renderedTriangles: quads * 2 + tris,
    quadRatio: faces > 0 ? quads / faces : 1,
    parts: parts.filter((p) => p.faceCount > 0 || p.lines.length > 0).length,
    subParts: parts.length,
    degenerateFaces,
    nanVertices,
    boundsWidth: Math.max(0, maxX - minX),
    boundsHeight: Math.max(0, maxY - minY),
    boundsDepth: Math.max(0, maxZ - minZ),
    clean: nanVertices === 0 && degenerateFaces === 0 && vertices > 0,
  };
}

// -----------------------------------------------------------------------------
// Exporters (Quad-preserving OBJ & Multi-Node glTF 2.0 GLB)
// -----------------------------------------------------------------------------

export function partsToOBJ(parts: PartMesh[], sceneName = 'frontier_specimen'): string {
  const out: string[] = [];
  out.push(`# Frontier Botanical, Moss & Groom Studio — high-poly mesh export`);
  out.push(`# Scene: ${sceneName}`);
  let vBase = 1;
  let vtBase = 1;
  let vnBase = 1;

  for (const part of parts) {
    if (part.faceCount === 0) continue;
    const safeName = part.name.replace(/[^a-zA-Z0-9_.-]+/g, '_');
    out.push(`o ${safeName}`);
    const p = part.positions;
    const c = part.colors;
    for (let i = 0; i < p.length; i += 3) {
      // Vertex position + optional sRGB vertex color extension (supported by Blender/ZBrush/MeshLab)
      const sr = clamp(Math.pow(Math.max(0, c[i]), 1 / 2.2), 0, 1);
      const sg = clamp(Math.pow(Math.max(0, c[i + 1]), 1 / 2.2), 0, 1);
      const sb = clamp(Math.pow(Math.max(0, c[i + 2]), 1 / 2.2), 0, 1);
      out.push(`v ${p[i].toFixed(5)} ${p[i + 1].toFixed(5)} ${p[i + 2].toFixed(5)} ${sr.toFixed(4)} ${sg.toFixed(4)} ${sb.toFixed(4)}`);
    }
    const nrm = part.computeNormals();
    for (let i = 0; i < nrm.length; i += 3) {
      out.push(`vn ${nrm[i].toFixed(4)} ${nrm[i + 1].toFixed(4)} ${nrm[i + 2].toFixed(4)}`);
    }
    const uv = part.uvs;
    for (let i = 0; i < uv.length; i += 2) {
      out.push(`vt ${uv[i].toFixed(5)} ${uv[i + 1].toFixed(5)}`);
    }
    out.push(`s 1`);
    const q = part.quads;
    for (let f = 0; f < q.length; f += 4) {
      const a = q[f];
      const b = q[f + 1];
      const cc = q[f + 2];
      const d = q[f + 3];
      out.push(
        `f ${vBase + a}/${vtBase + a}/${vnBase + a} ${vBase + b}/${vtBase + b}/${vnBase + b} ${vBase + cc}/${vtBase + cc}/${vnBase + cc} ${vBase + d}/${vtBase + d}/${vnBase + d}`,
      );
    }
    const tr = part.tris;
    for (let f = 0; f < tr.length; f += 3) {
      const a = tr[f];
      const b = tr[f + 1];
      const cc = tr[f + 2];
      out.push(
        `f ${vBase + a}/${vtBase + a}/${vnBase + a} ${vBase + b}/${vtBase + b}/${vnBase + b} ${vBase + cc}/${vtBase + cc}/${vnBase + cc}`,
      );
    }
    vBase += part.vertexCount;
    vtBase += part.vertexCount;
    vnBase += part.vertexCount;
  }
  return out.join('\n') + '\n';
}

export function partsToGLB(parts: PartMesh[], sceneName = 'frontier_specimen'): ArrayBuffer {
  const validParts = parts.filter((p) => p.faceCount > 0);
  const views: { data: ArrayBuffer; target?: number }[] = [];
  const accessors: Record<string, unknown>[] = [];

  const addAccessor = (arr: Float32Array | Uint32Array, type: string, target: number, withBounds = false): number => {
    const comps = type === 'SCALAR' ? 1 : type === 'VEC2' ? 2 : type === 'VEC3' ? 3 : 4;
    views.push({ data: arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer, target });
    const acc: Record<string, unknown> = {
      bufferView: views.length - 1,
      componentType: arr instanceof Float32Array ? 5126 : 5125,
      count: arr.length / comps,
      type,
    };
    if (withBounds) {
      const min = new Array(comps).fill(Infinity);
      const max = new Array(comps).fill(-Infinity);
      for (let i = 0; i < arr.length; i++) {
        const c = i % comps;
        if (arr[i] < min[c]) min[c] = arr[i];
        if (arr[i] > max[c]) max[c] = arr[i];
      }
      acc.min = min;
      acc.max = max;
    }
    accessors.push(acc);
    return accessors.length - 1;
  };

  const materials = [
    { name: 'botanical_foliage', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0.0, roughnessFactor: 0.48 } },
    { name: 'bryophyte_moss', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0.0, roughnessFactor: 0.62 } },
    { name: 'groom_hair_fur', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0.0, roughnessFactor: 0.36 } },
    { name: 'host_substrate', doubleSided: false, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0.0, roughnessFactor: 0.9 } },
  ];
  const matIdxFor = (s: ShadingProfile): number => (s === 'botanical' ? 0 : s === 'moss' ? 1 : s === 'hair' ? 2 : 3);

  const meshes: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];
  const rootChildren: number[] = [];

  for (const part of validParts) {
    const pkt = part.toPacket(false);
    const vCount = pkt.vertexCount;
    const rgba = new Float32Array(vCount * 4);
    for (let i = 0; i < vCount; i++) {
      rgba[i * 4] = pkt.color[i * 3];
      rgba[i * 4 + 1] = pkt.color[i * 3 + 1];
      rgba[i * 4 + 2] = pkt.color[i * 3 + 2];
      rgba[i * 4 + 3] = 1;
    }
    const meshIdx = meshes.length;
    meshes.push({
      name: part.name,
      primitives: [
        {
          attributes: {
            POSITION: addAccessor(pkt.position, 'VEC3', 34962, true),
            NORMAL: addAccessor(pkt.normal, 'VEC3', 34962),
            TEXCOORD_0: addAccessor(pkt.uv, 'VEC2', 34962),
            TEXCOORD_1: addAccessor(pkt.wind, 'VEC4', 34962),
            COLOR_0: addAccessor(rgba, 'VEC4', 34962),
          },
          indices: addAccessor(pkt.index, 'SCALAR', 34963),
          material: matIdxFor(part.shading),
          mode: 4,
        },
      ],
    });
    const nodeIdx = nodes.length;
    nodes.push({ name: part.name, mesh: meshIdx });
    rootChildren.push(nodeIdx);
  }

  const rootIdx = nodes.length;
  nodes.push({ name: sceneName, children: rootChildren });

  let byteLength = 0;
  const bufferViews: Record<string, unknown>[] = [];
  const chunks: ArrayBuffer[] = [];
  for (const v of views) {
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) {
      chunks.push(new ArrayBuffer(pad));
      byteLength += pad;
    }
    const bv: Record<string, unknown> = { buffer: 0, byteOffset: byteLength, byteLength: v.data.byteLength };
    if (v.target) bv.target = v.target;
    bufferViews.push(bv);
    chunks.push(v.data);
    byteLength += v.data.byteLength;
  }
  const tailPad = (4 - (byteLength % 4)) % 4;
  if (tailPad) {
    chunks.push(new ArrayBuffer(tailPad));
    byteLength += tailPad;
  }

  const gltf = {
    asset: { version: '2.0', generator: 'Frontier Botanical, Moss & Groom Studio' },
    scene: 0,
    scenes: [{ name: sceneName, nodes: [rootIdx] }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };

  const enc = new TextEncoder();
  let jsonBytes = enc.encode(JSON.stringify(gltf));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  if (jsonPad) {
    const padded = new Uint8Array(jsonBytes.length + jsonPad);
    padded.set(jsonBytes);
    padded.fill(0x20, jsonBytes.length);
    jsonBytes = padded;
  }

  const total = 12 + 8 + jsonBytes.length + 8 + byteLength;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  let o = 0;
  dv.setUint32(o, 0x46546c67, true); o += 4;
  dv.setUint32(o, 2, true); o += 4;
  dv.setUint32(o, total, true); o += 4;
  dv.setUint32(o, jsonBytes.length, true); o += 4;
  dv.setUint32(o, 0x4e4f534a, true); o += 4;
  u8.set(jsonBytes, o); o += jsonBytes.length;
  dv.setUint32(o, byteLength, true); o += 4;
  dv.setUint32(o, 0x004e4942, true); o += 4;
  for (const c of chunks) {
    u8.set(new Uint8Array(c), o);
    o += c.byteLength;
  }
  return out;
}
