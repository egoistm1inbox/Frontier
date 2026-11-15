// Source readers and mesh utilities for the Geometry Compile window.
// Every reader returns the same raw record: welded positions (Y-up), triangle indices, a material family per triangle
// and the material slot table. Nothing is rescaled unless the Source step asks for it.
import { DecodeFacetStream } from '../Vehicle/FacetCodec.js';
import { CourseMaterial, ConstructMaterialSpecification } from '../Vehicle/MaterialSpecification.js';
import { SOURCE_PRESETS, constructSource } from '../Engine/SourceGeometry.js';

export const SAMPLE_SOURCES = SOURCE_PRESETS.map(({ id, label, note }) => ({ id, label, note }));
export const IMPORT_FORMATS = [
  { ext: 'obj', label: 'Wavefront OBJ', note: 'positions · faces · usemtl slots', live: true },
  { ext: 'stl', label: 'STL (binary / ASCII)', note: 'triangle soup · welded on load', live: true },
  { ext: 'facet', label: 'Frontier FCT1 facet', note: 'Z-up · per-face material family', live: true },
  { ext: 'gltf', label: 'glTF / GLB', note: 'listed · reader not connected', live: false },
  { ext: 'fbx', label: 'FBX', note: 'listed · reader not connected', live: false },
];

const MATERIALS = ConstructMaterialSpecification();
const FAMILY_NAMES = Object.fromEntries(Object.entries(CourseMaterial).map(([k, v]) => [v, k]));

export function familySlot(family) {
  const spec = MATERIALS[family] || MATERIALS[CourseMaterial.VehicleDefault];
  const emission = spec.Emission || [0, 0, 0];
  const glow = Math.max(...emission);
  let color = (spec.Albedo || [0.6, 0.6, 0.6]).slice();
  if (glow > 0.2) color = emission.map((e) => Math.min(1, e / glow));
  // Very dark linear albedos (tyre rubber, glass) read as pure black on a dark stage; lift them a little.
  color = color.map((c) => Math.max(c, 0.03));
  return { name: FAMILY_NAMES[family] || `Family ${family}`, family, color, emissive: glow > 0.2 };
}

const DEFAULT_SLOT = () => ({ name: 'Default', family: 0, color: [0.62, 0.62, 0.6], emissive: false });

// ---------------------------------------------------------------------------------------------------- readers
export function readFacet(buffer, name = 'facet') {
  const s = DecodeFacetStream(buffer, name);
  // Authoring frame is Z-up, X forward, Y left. (x, y, z) → (x, z, −y) is a proper rotation, so winding is kept.
  const positions = new Float32Array(s.VertexCount * 3);
  for (let i = 0; i < s.VertexCount; i++) {
    positions[i * 3] = s.Positions[i * 3]; positions[i * 3 + 1] = s.Positions[i * 3 + 2]; positions[i * 3 + 2] = -s.Positions[i * 3 + 1];
  }
  const indices = new Uint32Array(s.Facets);
  const used = [...new Set(s.Families)].sort((a, b) => a - b);
  const slotOf = new Map(used.map((f, i) => [f, i]));
  const families = Uint16Array.from(s.Families, (f) => slotOf.get(f));
  return { positions, indices, families, slots: used.map(familySlot), format: 'FCT1 facet', upAxis: 'Z-up (converted)' };
}

function weld(raw, faces, faceFamilies) {
  const lookup = new Map(), positions = [], remap = new Uint32Array(raw.length / 3);
  for (let i = 0; i < raw.length / 3; i++) {
    const x = raw[i * 3], y = raw[i * 3 + 1], z = raw[i * 3 + 2];
    const key = `${x},${y},${z}`;
    let id = lookup.get(key);
    if (id === undefined) { id = positions.length / 3; positions.push(x, y, z); lookup.set(key, id); }
    remap[i] = id;
  }
  const indices = [], families = [];
  for (let f = 0; f < faces.length / 3; f++) {
    const a = remap[faces[f * 3]], b = remap[faces[f * 3 + 1]], c = remap[faces[f * 3 + 2]];
    if (a === b || b === c || a === c) continue;
    indices.push(a, b, c); families.push(faceFamilies ? faceFamilies[f] : 0);
  }
  if (!indices.length) throw new Error('No usable triangles');
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices), families: Uint16Array.from(families) };
}

export function readObj(text) {
  const raw = [], faces = [], fam = [], slotNames = [];
  let current = -1;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('v ') || t.startsWith('v\t')) { const p = t.split(/\s+/); raw.push(+p[1], +p[2], +p[3]); }
    else if (t.startsWith('usemtl')) { const name = t.slice(6).trim() || 'Default'; current = slotNames.indexOf(name); if (current < 0) { slotNames.push(name); current = slotNames.length - 1; } }
    else if (t.startsWith('f ') || t.startsWith('f\t')) {
      const count = raw.length / 3;
      const ids = t.split(/\s+/).slice(1).map((q) => { const v = parseInt(q, 10); return v < 0 ? count + v : v - 1; }).filter((v) => v >= 0 && v < count);
      for (let i = 1; i + 1 < ids.length; i++) { faces.push(ids[0], ids[i], ids[i + 1]); fam.push(Math.max(0, current)); }
    }
  }
  if (!raw.length || !faces.length) throw new Error('OBJ has no triangles');
  if (raw.some((v) => !Number.isFinite(v))) throw new Error('OBJ has a non-finite vertex');
  const w = weld(raw, faces, fam);
  const palette = [[0.62, 0.62, 0.6], [0.72, 0.42, 0.2], [0.2, 0.42, 0.7], [0.3, 0.62, 0.36], [0.7, 0.66, 0.3], [0.55, 0.3, 0.6]];
  const slots = (slotNames.length ? slotNames : ['Default']).map((name, i) => ({ name, family: i, color: palette[i % palette.length], emissive: false }));
  return { ...w, slots, format: 'Wavefront OBJ', upAxis: 'Y-up' };
}

export function readStl(buffer) {
  const view = new DataView(buffer);
  const count = buffer.byteLength >= 84 ? view.getUint32(80, true) : 0;
  const raw = [], faces = [];
  if (buffer.byteLength === 84 + count * 50 && count > 0) {
    for (let f = 0; f < count; f++) {
      const o = 84 + f * 50 + 12;
      for (let k = 0; k < 3; k++) { raw.push(view.getFloat32(o + k * 12, true), view.getFloat32(o + k * 12 + 4, true), view.getFloat32(o + k * 12 + 8, true)); faces.push(raw.length / 3 - 1); }
    }
  } else {
    const text = new TextDecoder().decode(buffer);
    for (const m of text.matchAll(/vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g)) { raw.push(+m[1], +m[2], +m[3]); faces.push(raw.length / 3 - 1); }
  }
  if (!faces.length) throw new Error('STL has no triangles');
  return { ...weld(raw, faces, null), slots: [DEFAULT_SLOT()], format: 'STL', upAxis: 'Z-up (STL convention)' };
}

export function readSample(id, budget = 60000) {
  const s = constructSource(id, budget);
  const preset = SOURCE_PRESETS.find((p) => p.id === id) || SOURCE_PRESETS[0];
  return {
    positions: s.positions, indices: s.indices, families: new Uint16Array(s.indices.length / 3), slots: [{ ...DEFAULT_SLOT(), name: 'Surface', color: [0.55, 0.62, 0.66] }],
    format: 'Procedural sample', upAxis: 'Y-up', label: preset.label,
  };
}

export async function readFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'obj') return readObj(await file.text());
  if (ext === 'stl') return readStl(await file.arrayBuffer());
  if (ext === 'facet' || ext === 'fct') return readFacet(await file.arrayBuffer(), file.name);
  throw new Error(`.${ext} import is listed but its reader is not connected in this build`);
}

// ---------------------------------------------------------------------------------------------------- utilities
export function topology(indices) {
  const edges = new Map();
  for (let t = 0; t < indices.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = indices[t + k], b = indices[t + ((k + 1) % 3)];
    const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
    edges.set(key, (edges.get(key) || 0) + 1);
  }
  let border = 0, nonManifold = 0;
  for (const n of edges.values()) { if (n === 1) border++; else if (n > 2) nonManifold++; }
  return { edges: edges.size, border, nonManifold, closed: border === 0 && nonManifold === 0 };
}

// Per-corner normals: faces around a vertex are averaged only when their normals are within `angle` degrees, so hard
// edges stay hard and curved surfaces stay smooth.
export function cornerNormals(positions, indices, angle = 40) {
  const tris = indices.length / 3, fn = new Float32Array(tris * 3);
  for (let t = 0; t < tris; t++) {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    fn[t * 3] = uy * vz - uz * vy; fn[t * 3 + 1] = uz * vx - ux * vz; fn[t * 3 + 2] = ux * vy - uy * vx;
  }
  const vcount = positions.length / 3, start = new Uint32Array(vcount + 1);
  for (let i = 0; i < indices.length; i++) start[indices[i] + 1]++;
  for (let v = 0; v < vcount; v++) start[v + 1] += start[v];
  const fill = start.slice(0, vcount), list = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) list[fill[indices[i]]++] = (i / 3) | 0;
  const cos = Math.cos((angle * Math.PI) / 180), out = new Float32Array(tris * 9);
  const unit = (t) => { const x = fn[t * 3], y = fn[t * 3 + 1], z = fn[t * 3 + 2], l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
  for (let t = 0; t < tris; t++) {
    const self = unit(t);
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k];
      let x = 0, y = 0, z = 0;
      for (let j = start[v]; j < start[v + 1]; j++) {
        const o = list[j], n = unit(o);
        if (o === t || n[0] * self[0] + n[1] * self[1] + n[2] * self[2] >= cos) { x += fn[o * 3]; y += fn[o * 3 + 1]; z += fn[o * 3 + 2]; }
      }
      const l = Math.hypot(x, y, z) || 1;
      out[(t * 3 + k) * 3] = x / l; out[(t * 3 + k) * 3 + 1] = y / l; out[(t * 3 + k) * 3 + 2] = z / l;
    }
  }
  return out;
}

export function triangleColors(families, slots) {
  const out = new Float32Array(families.length * 4);
  for (let t = 0; t < families.length; t++) {
    const s = slots[families[t]] || slots[0];
    out[t * 4] = s.color[0]; out[t * 4 + 1] = s.color[1]; out[t * 4 + 2] = s.color[2]; out[t * 4 + 3] = s.emissive ? 1 : 0;
  }
  return out;
}

export function hueColor(i, s = 0.55, l = 0.55) {
  const h = ((i * 137.508) % 360) / 360;
  const f = (n) => { const k = (n + h * 12) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)].map((c) => Math.pow(c, 2.2));
}

export function indexColors(ids) {
  const out = new Float32Array(ids.length * 3);
  for (let t = 0; t < ids.length; t++) { const c = hueColor(ids[t]); out[t * 3] = c[0]; out[t * 3 + 1] = c[1]; out[t * 3 + 2] = c[2]; }
  return out;
}

export function hexToLinear(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.pow(c / 255, 2.2));
}
export function linearToHex(c) {
  return '#' + c.map((v) => Math.round(Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2) * 255).toString(16).padStart(2, '0')).join('');
}
