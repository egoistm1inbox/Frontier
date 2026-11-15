// Geometry Compile pipeline — the non-UI half. Source → Geometry → UV charts → SDF bake → Cluster LOD → Icon → Metadata.
// Every step is a pure function of the previous step's output plus its own settings, so the window can re-run any step
// (and mark the ones after it stale) without touching the others. SDF and LOD run on workers.
import { transformGeometry, identityTransform } from '../Engine/GeometryTransform.js';
import { unwrapCharts, packCharts, cornerUvs, layoutStatistics } from '../Engine/UvCharts.js';
import { cornerNormals, topology, triangleColors, indexColors } from './MeshData.js';
import { boundsOf } from './MathUtils.js';

export const STEPS = [
  { id: 'source', label: 'Source', note: 'Read · weld · units · axes', icon: 'source', accent: 'grey', optional: false },
  { id: 'geometry', label: 'Geometry', note: 'Transform · normals', icon: 'geometry', accent: 'amber', optional: false },
  { id: 'uv', label: 'UV Charts', note: 'Planar unwrap · pack', icon: 'uv', accent: 'blue', optional: true },
  { id: 'sdf', label: 'SDF Bake', note: 'Signed distance field', icon: 'sdf', accent: 'teal', optional: true },
  { id: 'lod', label: 'Cluster LOD', note: 'Cluster DAG · simplify', icon: 'lod', accent: 'violet', optional: true },
  { id: 'icon', label: 'Icon', note: 'Thumbnail capture', icon: 'icon', accent: 'orange', optional: true },
  { id: 'meta', label: 'Metadata', note: 'Name · category · tags', icon: 'meta', accent: 'green', optional: false },
];
export const DOWNSTREAM = { source: ['geometry', 'uv', 'sdf', 'lod', 'icon'], geometry: ['uv', 'sdf', 'lod', 'icon'], uv: ['icon'], sdf: [], lod: [], icon: [], meta: [] };
export const CATEGORIES = ['Vehicle', 'Prop', 'Architecture', 'Nature', 'Character', 'Sample', 'Other'];

export function defaultSettings(raw, name) {
  return {
    source: { units: 'keep', importScale: 1, upAxis: raw.upAxis && raw.upAxis.startsWith('Z-up (STL') ? 'z' : 'y' },
    geometry: { transform: identityTransform(), uniform: true, smoothing: 40 },
    uv: { normalLimit: 60, mergeBelow: 24, mergeLimit: 75 },
    sdf: { resolution: 40, band: 2 },
    lod: { clusterTriangles: 128, groupClusters: 4, simplifyRatio: 0.5 },
    icon: { size: 256, yaw: 0.75, pitch: 0.42, mode: 'lit', background: 'transparent' },
    meta: { name: meshName(name), category: 'Prop', tags: '', notes: '' },
    enabled: { uv: true, sdf: true, lod: true, icon: true },
  };
}

export function meshName(fileName) {
  const base = String(fileName || 'Imported').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]+/g, ' ').trim();
  const pascal = base.split(' ').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('') || 'Imported';
  return pascal.startsWith('SM_') ? pascal : `SM_${pascal}`;
}

// ---------------------------------------------------------------------------------------------------- Source + Geometry
export function buildGeometry(raw, settings) {
  const started = performance.now();
  let positions = raw.positions;
  if (settings.source.upAxis === 'z') {
    const p = new Float32Array(positions.length);
    for (let i = 0; i < p.length; i += 3) { p[i] = positions[i]; p[i + 1] = positions[i + 2]; p[i + 2] = -positions[i + 1]; }
    positions = p;
  }
  const rawBounds = boundsOf(positions);
  let unit = settings.source.importScale || 1;
  if (settings.source.units !== 'keep') {
    const target = settings.source.units === 'fit1' ? 1 : 2;
    const largest = Math.max(...rawBounds.hi.map((h, k) => h - rawBounds.lo[k])) || 1;
    unit = target / largest;
  }
  const t = settings.geometry.transform;
  const transform = { ...t, scale: t.scale.map((s) => s * unit) };
  const moved = transformGeometry(positions, raw.indices, transform);
  const normals = cornerNormals(moved.positions, moved.indices, settings.geometry.smoothing);
  const topo = topology(moved.indices);
  return {
    positions: moved.positions, indices: moved.indices, families: raw.families, slots: raw.slots, cornerNormals: normals,
    bounds: boundsOf(moved.positions), topology: topo, unit, triangles: moved.indices.length / 3, vertices: moved.positions.length / 3,
    ms: performance.now() - started,
  };
}

// ---------------------------------------------------------------------------------------------------- UV
export function runUv(geo, s) {
  const started = performance.now();
  const layout = unwrapCharts(geo.positions, geo.indices, { normalLimitDeg: s.normalLimit, mergeBelow: s.mergeBelow, mergeLimitDeg: s.mergeLimit });
  packCharts(layout);
  const uvs = cornerUvs(layout);
  const stats = layoutStatistics(layout, uvs);
  let area = 0, fit = 0;
  for (const c of layout.charts) { area += c.area; fit += c.area * c.projection; }
  return {
    uvs, chartOf: layout.chartOf, seams: layout.seams, borders: layout.borders, charts: layout.charts.length, seamCount: layout.seams.length,
    texelScale: stats.texelScale, coverage: stats.uvArea, fit: area ? fit / area : 1, ms: performance.now() - started,
    settings: { ...s },
  };
}

// ---------------------------------------------------------------------------------------------------- workers
function runWorker(url, request, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(url, { type: 'module' });
    const ticket = Math.random();
    worker.onmessage = (event) => {
      const m = event.data;
      if (m.ticket !== ticket) return;
      if (m.type === 'progress') onProgress?.(m.fraction, m.label);
      else if (m.type === 'error') { worker.terminate(); reject(new Error(m.message)); }
      else if (m.type === 'done') { worker.terminate(); resolve(m.result); }
    };
    worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message || 'worker error')); };
    worker.postMessage({ ticket, request });
  });
}

export async function runSdf(geo, s, onProgress) {
  const result = await runWorker(new URL('../Engine/SdfWorker.js', import.meta.url), {
    positions: new Float32Array(geo.positions), indices: new Uint32Array(geo.indices), resolution: s.resolution, band: s.band,
  }, onProgress);
  return { ...result, closed: geo.topology.closed, settings: { ...s } };
}

export async function runLod(geo, s, onProgress) {
  const result = await runWorker(new URL('../Engine/LodWorker.js', import.meta.url), {
    positions: new Float32Array(geo.positions), indices: new Uint32Array(geo.indices),
    build: { clusterTriangles: s.clusterTriangles, groupClusters: s.groupClusters, simplifyRatio: s.simplifyRatio },
  }, onProgress);
  return { ...result, settings: { ...s } };
}

// Triangles of one LOD level straight from the hierarchy's corner stream, with the cluster id of each triangle.
export function lodLevel(lod, level) {
  let corners = 0;
  for (let c = 0; c < lod.clusterFirst.length; c++) if (lod.clusterLevel[c] === level) corners += lod.clusterSize[c];
  const indices = new Uint32Array(corners), cluster = new Uint32Array(corners / 3);
  let o = 0;
  for (let c = 0; c < lod.clusterFirst.length; c++) {
    if (lod.clusterLevel[c] !== level) continue;
    const first = lod.clusterFirst[c], n = lod.clusterSize[c];
    for (let k = 0; k < n; k++) indices[o + k] = lod.cornerVertex[first + k];
    cluster.fill(c, o / 3, (o + n) / 3);
    o += n;
  }
  return { indices, cluster };
}

// GPU-ready mesh data for a compiled record at a level (−1 = source triangles).
export function meshPayload(record, level = -1, smoothing = 40) {
  if (level < 0 || !record.lod) {
    return {
      positions: record.positions, indices: record.indices, cornerNormals: record.cornerNormals, uvs: record.uv ? record.uv.uvs : null,
      colors: triangleColors(record.families, record.slots), debug: record.uv ? indexColors(record.uv.chartOf) : null,
    };
  }
  const L = Math.min(level, record.lod.levels.length - 1);
  const { indices, cluster } = lodLevel(record.lod, L);
  // Simplified triangles reuse source vertices; give each the family of the nearest source triangle by vertex lookup.
  const familyOfVertex = new Uint16Array(record.positions.length / 3);
  for (let t = 0; t < record.indices.length / 3; t++) for (let k = 0; k < 3; k++) familyOfVertex[record.indices[t * 3 + k]] = record.families[t];
  const families = new Uint16Array(indices.length / 3);
  for (let t = 0; t < families.length; t++) families[t] = familyOfVertex[indices[t * 3]];
  return {
    positions: record.positions, indices, cornerNormals: cornerNormals(record.positions, indices, smoothing), uvs: null,
    colors: triangleColors(families, record.slots), debug: indexColors(cluster),
  };
}

export function formatCount(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return Math.round(n).toLocaleString('en-US');
}
export const ms = (v) => (v >= 1000 ? (v / 1000).toFixed(2) + ' s' : Math.round(v) + ' ms');
