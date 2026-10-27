/**
 * Exporters + GPU buffer conversion.
 *
 * OBJ keeps the quads as quads (n-gon faces) with vertex colours, so the edge
 * flow survives a trip through Blender / ZBrush. GLB is triangulated (the
 * format only knows triangles) as ONE primitive carrying colours, atlas UVs
 * and the wind data (_WIND / _PIVOT) for game-engine materials.
 */

import { QuadMesh } from './mesh';

/** Atlas layout: 2×2 tiles in a 1024² texture, 480px pattern + 16px gutter. */
export const ATLAS = { size: 1024, cell: 512, pattern: 480, gutter: 16 };

/** Map a tile-local (u, v) into atlas texture space. */
export function atlasUv(tile: number, u: number, v: number): [number, number] {
  const cx = tile % 2;
  const cy = Math.floor(tile / 2);
  const o = ATLAS.gutter / ATLAS.size;
  const s = ATLAS.pattern / ATLAS.size;
  const fu = u - Math.floor(u);
  const fv = v - Math.floor(v);
  return [cx * 0.5 + o + fu * s, cy * 0.5 + o + fv * s];
}

// -----------------------------------------------------------------------------
// GPU buffers
// -----------------------------------------------------------------------------

export interface GpuBuffers {
  position: Float32Array;
  normal: Float32Array;
  /** Tile-local UVs (continuous v); the viewer maps them into the atlas. */
  uv: Float32Array;
  color: Float32Array;
  /** height, limb, phase, detail */
  wind: Float32Array;
  pivot: Float32Array;
  organ: Float32Array;
  junction: Float32Array;
  tile: Float32Array;
  index: Uint32Array;
  /** Quad edges only (true quad wireframe). */
  edgeIndex: Uint32Array;
}

export function toGpuBuffers(mesh: QuadMesh): GpuBuffers {
  const baseCount = mesh.vertexCount;
  const normals = mesh.computeNormals();

  const positions: number[] = Array.from(mesh.positions);
  const nrm: number[] = Array.from(normals);
  const colors: number[] = Array.from(mesh.colors);
  const uv: number[] = new Array(baseCount * 2).fill(NaN);
  const tileArr: number[] = new Array(baseCount).fill(-1);
  const wind: number[] = Array.from(mesh.wind);
  const pivot: number[] = Array.from(mesh.pivots);
  const organ: number[] = Array.from(mesh.organs);
  const junction: number[] = Array.from(mesh.junction);
  const alias = new Map<string, number>();

  // Split a vertex when a face corner needs a different (tile, uv) than the
  // one already stored — keeps smooth normals while seams/repeats stay exact.
  const resolve = (v: number, u: number, w: number, tile: number): number => {
    const cu = uv[v * 2];
    if (Number.isNaN(cu)) {
      uv[v * 2] = u;
      uv[v * 2 + 1] = w;
      tileArr[v] = tile;
      return v;
    }
    if (tileArr[v] === tile && Math.abs(cu - u) < 0.25 && Math.abs(uv[v * 2 + 1] - w) < 0.01) return v;
    const key = `${v}:${tile}:${Math.round(u * 32)}:${Math.round(w * 32)}`;
    const found = alias.get(key);
    if (found !== undefined) return found;
    const ni = positions.length / 3;
    positions.push(mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]);
    nrm.push(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]);
    colors.push(mesh.colors[v * 3], mesh.colors[v * 3 + 1], mesh.colors[v * 3 + 2]);
    uv.push(u, w);
    tileArr.push(tile);
    wind.push(mesh.wind[v * 4], mesh.wind[v * 4 + 1], mesh.wind[v * 4 + 2], mesh.wind[v * 4 + 3]);
    pivot.push(mesh.pivots[v * 3], mesh.pivots[v * 3 + 1], mesh.pivots[v * 3 + 2]);
    organ.push(mesh.organs[v]);
    junction.push(mesh.junction[v]);
    alias.set(key, ni);
    return ni;
  };

  const index: number[] = [];
  const edges: number[] = [];
  const q = mesh.quads;
  const quv = mesh.quadUVs;
  for (let f = 0, u = 0, fi = 0; f < q.length; f += 4, u += 8, fi++) {
    const tile = mesh.quadTiles[fi];
    const a = resolve(q[f], quv[u], quv[u + 1], tile);
    const b = resolve(q[f + 1], quv[u + 2], quv[u + 3], tile);
    const c = resolve(q[f + 2], quv[u + 4], quv[u + 5], tile);
    const d = resolve(q[f + 3], quv[u + 6], quv[u + 7], tile);
    if (diag(positions, a, c) <= diag(positions, b, d)) index.push(a, b, c, a, c, d);
    else index.push(a, b, d, b, c, d);
    edges.push(a, b, b, c, c, d, d, a);
  }
  const t = mesh.tris;
  const tuv = mesh.triUVs;
  for (let f = 0, u = 0, fi = 0; f < t.length; f += 3, u += 6, fi++) {
    const tile = mesh.triTiles[fi];
    const a = resolve(t[f], tuv[u], tuv[u + 1], tile);
    const b = resolve(t[f + 1], tuv[u + 2], tuv[u + 3], tile);
    const c = resolve(t[f + 2], tuv[u + 4], tuv[u + 5], tile);
    index.push(a, b, c);
    edges.push(a, b, b, c, c, a);
  }
  for (let i = 0; i < uv.length; i++) if (Number.isNaN(uv[i])) uv[i] = 0;
  for (let i = 0; i < tileArr.length; i++) if (tileArr[i] < 0) tileArr[i] = 0;

  return {
    position: new Float32Array(positions),
    normal: new Float32Array(nrm),
    uv: new Float32Array(uv),
    color: new Float32Array(colors),
    wind: new Float32Array(wind),
    pivot: new Float32Array(pivot),
    organ: new Float32Array(organ),
    junction: new Float32Array(junction),
    tile: new Float32Array(tileArr),
    index: new Uint32Array(index),
    edgeIndex: new Uint32Array(edges),
  };
}

function diag(p: number[], a: number, b: number): number {
  const dx = p[a * 3] - p[b * 3];
  const dy = p[a * 3 + 1] - p[b * 3 + 1];
  const dz = p[a * 3 + 2] - p[b * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}

// -----------------------------------------------------------------------------
// OBJ (quads preserved, vertex colours, atlas UVs)
// -----------------------------------------------------------------------------

export function toOBJ(mesh: QuadMesh, name = 'plant'): string {
  const out: string[] = [];
  out.push('# Frontier tropical plant generator – single welded quad mesh');
  out.push(`o ${name}`);
  const p = mesh.positions;
  const c = mesh.colors;
  for (let i = 0; i < p.length; i += 3) {
    out.push(`v ${p[i].toFixed(5)} ${p[i + 1].toFixed(5)} ${p[i + 2].toFixed(5)} ${c[i].toFixed(4)} ${c[i + 1].toFixed(4)} ${c[i + 2].toFixed(4)}`);
  }
  const normals = mesh.computeNormals();
  for (let i = 0; i < normals.length; i += 3) out.push(`vn ${normals[i].toFixed(4)} ${normals[i + 1].toFixed(4)} ${normals[i + 2].toFixed(4)}`);
  // Face-varying UVs mapped into the atlas.
  const emitUvs = (uvs: number[], tiles: number[], corners: number): void => {
    for (let f = 0, u = 0; f < tiles.length; f++) {
      for (let k = 0; k < corners; k++, u += 2) {
        const [au, av] = atlasUv(tiles[f], uvs[u], uvs[u + 1]);
        out.push(`vt ${au.toFixed(5)} ${av.toFixed(5)}`);
      }
    }
  };
  emitUvs(mesh.quadUVs, mesh.quadTiles, 4);
  const triUvBase = mesh.quadUVs.length / 2;
  emitUvs(mesh.triUVs, mesh.triTiles, 3);

  out.push('g plant');
  out.push('s 1');
  const q = mesh.quads;
  let uvi = 1;
  for (let f = 0; f < q.length; f += 4) {
    const a = q[f] + 1, b = q[f + 1] + 1, cc = q[f + 2] + 1, d = q[f + 3] + 1;
    out.push(`f ${a}/${uvi}/${a} ${b}/${uvi + 1}/${b} ${cc}/${uvi + 2}/${cc} ${d}/${uvi + 3}/${d}`);
    uvi += 4;
  }
  const t = mesh.tris;
  uvi = triUvBase + 1;
  for (let f = 0; f < t.length; f += 3) {
    const a = t[f] + 1, b = t[f + 1] + 1, cc = t[f + 2] + 1;
    out.push(`f ${a}/${uvi}/${a} ${b}/${uvi + 1}/${b} ${cc}/${uvi + 2}/${cc}`);
    uvi += 3;
  }
  return out.join('\n') + '\n';
}

// -----------------------------------------------------------------------------
// GLB (single primitive, colours + atlas UVs + wind extras)
// -----------------------------------------------------------------------------

interface BufferViewDesc {
  data: ArrayBuffer;
  target?: number;
}

export function toGLB(mesh: QuadMesh, name = 'plant', atlasPng?: ArrayBuffer): ArrayBuffer {
  const g = toGpuBuffers(mesh);
  const vcount = g.position.length / 3;

  // Atlas-space UVs for external renderers.
  const auv = new Float32Array(g.uv.length);
  for (let i = 0; i < vcount; i++) {
    const [x, y] = atlasUv(g.tile[i], g.uv[i * 2], g.uv[i * 2 + 1]);
    auv[i * 2] = x;
    auv[i * 2 + 1] = 1 - y; // glTF v origin is top-left of the image
  }
  const color4 = new Float32Array(vcount * 4);
  for (let i = 0; i < vcount; i++) {
    color4[i * 4] = g.color[i * 3];
    color4[i * 4 + 1] = g.color[i * 3 + 1];
    color4[i * 4 + 2] = g.color[i * 3 + 2];
    color4[i * 4 + 3] = 1;
  }
  const tex1 = new Float32Array(vcount * 2);
  for (let i = 0; i < vcount; i++) {
    tex1[i * 2] = g.organ[i] / 4;
    tex1[i * 2 + 1] = g.junction[i];
  }

  const views: BufferViewDesc[] = [];
  const accessors: Record<string, unknown>[] = [];
  const addAccessor = (arr: Float32Array | Uint32Array, type: string, target: number, minMax = false): number => {
    const comps = type === 'SCALAR' ? 1 : type === 'VEC2' ? 2 : type === 'VEC3' ? 3 : 4;
    views.push({ data: arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer, target });
    const acc: Record<string, unknown> = {
      bufferView: views.length - 1,
      componentType: arr instanceof Float32Array ? 5126 : 5125,
      count: arr.length / comps,
      type,
    };
    if (minMax) {
      const min = new Array(comps).fill(Infinity);
      const max = new Array(comps).fill(-Infinity);
      for (let i = 0; i < arr.length; i++) {
        const cc = i % comps;
        if (arr[i] < min[cc]) min[cc] = arr[i];
        if (arr[i] > max[cc]) max[cc] = arr[i];
      }
      acc.min = min;
      acc.max = max;
    }
    accessors.push(acc);
    return accessors.length - 1;
  };

  const attributes: Record<string, number> = {
    POSITION: addAccessor(g.position, 'VEC3', 34962, true),
    NORMAL: addAccessor(g.normal, 'VEC3', 34962),
    TEXCOORD_0: addAccessor(auv, 'VEC2', 34962),
    TEXCOORD_1: addAccessor(tex1, 'VEC2', 34962),
    COLOR_0: addAccessor(color4, 'VEC4', 34962),
    _WIND: addAccessor(g.wind, 'VEC4', 34962),
    _PIVOT: addAccessor(g.pivot, 'VEC3', 34962),
  };

  const material: Record<string, unknown> = {
    name: 'plant',
    pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.85 },
  };
  const extras: Record<string, unknown> = {};
  if (atlasPng) {
    views.push({ data: atlasPng });
    const imageView = views.length - 1;
    (material.pbrMetallicRoughness as Record<string, unknown>).baseColorTexture = { index: 0 };
    extras.images = [{ bufferView: imageView, mimeType: 'image/png', name: 'atlas' }];
    extras.textures = [{ source: 0, sampler: 0 }];
    extras.samplers = [{ wrapS: 33071, wrapT: 33071, magFilter: 9729, minFilter: 9987 }];
  }

  // Pack buffer.
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

  const gltf: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'Frontier tropical plant generator' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes, indices: addAccessor(g.index, 'SCALAR', 34963), material: 0, mode: 4 }] }],
    materials: [material],
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
    extras: {
      wind: '_WIND = (normalised height, limb bend, phase, detail flutter); _PIVOT = limb bend pivot; TEXCOORD_1 = (organ/4, junction flag)',
      welded: 'single closed manifold quad mesh, triangulated on export',
    },
  };
  if (atlasPng) {
    gltf.images = extras.images;
    gltf.textures = extras.textures;
    gltf.samplers = extras.samplers;
  }

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
