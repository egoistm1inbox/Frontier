// Component Studio boot: Content library (compiled meshes, persisted in IndexedDB), the built-in ControlVehicle meshes,
// the Import menu / drag-and-drop, and the wiring between Geometry Compile and the Component Viewer.
import { createComponentViewer } from './ComponentViewer.js';
import { createGeometryCompile } from './GeometryCompile.js';
import { createFractureEditor } from './FractureEditor.js';
import { defaultSettings, buildGeometry, runUv, runLod } from './Compile.js';
import { readFacet, readFile, readSample, SAMPLE_SOURCES, IMPORT_FORMATS, triangleColors } from './MeshData.js';
import { $, h, toast, hydrate } from './Kit.js';
import { hydrateIcons } from './Icons.js';

// ---------------------------------------------------------------------------------------------------- IndexedDB
const DB_NAME = 'frontier-component-studio', STORE = 'meshes';
function openDb() {
  return new Promise((resolve) => {
    if (!('indexedDB' in window)) return resolve(null);
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}
const dbReady = openDb();
async function dbAll() { const db = await dbReady; if (!db) return []; return new Promise((res) => { const r = db.transaction(STORE).objectStore(STORE).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); }); }
async function dbPut(record) { const db = await dbReady; if (!db) return; try { db.transaction(STORE, 'readwrite').objectStore(STORE).put(record); } catch (e) { console.warn('Could not store mesh', e); } }
async function dbDelete(id) { const db = await dbReady; if (!db) return; db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id); }

// ---------------------------------------------------------------------------------------------------- library
const library = {
  map: new Map(),
  get(id) { return this.map.get(id); },
  list() { return [...this.map.values()].sort((a, b) => (a.builtin === b.builtin ? a.compiledAt - b.compiledAt : a.builtin ? -1 : 1)); },
  put(record, persist = true) { this.map.set(record.id, record); if (persist) dbPut(record); },
  touch(id) { const r = this.map.get(id); if (r) { r.compiledAt = Date.now(); dbPut(r); } },
  remove(id) { this.map.delete(id); dbDelete(id); },
};

const BUILTINS = [
  { id: 'builtin-body', file: 'ControlVehicleBody.facet', name: 'SM_ControlVehicleBody', smoothing: 30, yaw: 2.25, pitch: 0.36, tags: 'control vehicle, body shell, fct1' },
  { id: 'builtin-tyre', file: 'ControlVehicleTyre.facet', name: 'SM_ControlVehicleTyre', smoothing: 50, yaw: Math.PI - 0.55, pitch: 0.2, tags: 'control vehicle, tyre, mf6.1, fct1' },
  { id: 'builtin-rim', file: 'ControlVehicleRim.facet', name: 'SM_ControlVehicleRim', smoothing: 35, yaw: Math.PI - 0.55, pitch: 0.2, tags: 'control vehicle, rim, fct1' },
];

// Headless Geometry Compile for the ControlVehicle parts: Source → Geometry → UV → Icon now, Cluster LOD on a worker
// right after. SDF is left un-baked on purpose so the "bake missing data" round trip has something to show.
async function compileBuiltin(spec, viewport) {
  const buffer = await fetch(new URL(`../Vehicle/Archive/${spec.file}`, import.meta.url), { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`${spec.file}: ${r.status}`); return r.arrayBuffer(); });
  const raw = readFacet(buffer, spec.file);
  const settings = defaultSettings(raw, spec.file);
  settings.geometry.smoothing = spec.smoothing;
  settings.meta = { name: spec.name, category: 'Vehicle', tags: spec.tags, notes: 'Vehicle HMI ControlVehicle FCT1 facet stream (Experimental/VehicleProvingGrounds/Archive in Frontier-OLD).' };
  settings.icon.yaw = spec.yaw; settings.icon.pitch = spec.pitch;
  const geo = buildGeometry(raw, settings);
  const uv = runUv(geo, settings.uv);
  const record = {
    id: spec.id, builtin: true, name: spec.name, category: 'Vehicle', tags: spec.tags, notes: settings.meta.notes,
    sourceFile: spec.file, format: raw.format, compiledAt: Date.now(),
    positions: geo.positions, indices: geo.indices, families: geo.families, slots: geo.slots, cornerNormals: geo.cornerNormals,
    bounds: geo.bounds, topology: geo.topology, triangles: geo.triangles, vertices: geo.vertices,
    uv, sdf: null, lod: null, icon: null, settings, raw, log: [],
  };
  record.icon = captureIcon(viewport, record);
  return { record, geo };
}

function captureIcon(viewport, record) {
  const s = record.settings.icon;
  const mesh = viewport.createMesh({ positions: record.positions, indices: record.indices, cornerNormals: record.cornerNormals, uvs: record.uv?.uvs, colors: triangleColors(record.families, record.slots) });
  const canvas = viewport.capture({ objects: [{ mesh, mode: 'lit' }], bounds: record.bounds, size: s.size, yaw: s.yaw, pitch: s.pitch });
  viewport.deleteMesh(mesh);
  return canvas.toDataURL('image/png');
}

// ---------------------------------------------------------------------------------------------------- boot
let viewer, compile, fracture;

async function boot() {
  hydrateIcons(document);
  compile = createGeometryCompile({
    targetName: () => viewer.className(),
    onSave: (record, { addToClass }) => {
      library.put(record);
      viewer.purgeGpu(record.id);
      if (addToClass) viewer.addMesh(record.id);
      viewer.refresh();
      if (!addToClass) viewer.openContent();
      toast(`${record.name} compiled${addToClass ? ` and added to ${viewer.className()}` : ' · updated everywhere it is used'}`);
    },
  });
  viewer = createComponentViewer({
    library,
    openCompile: (record) => record && compile.open({ raw: record.raw, fileName: record.sourceFile, ext: record.sourceFile.split('.').pop(), existing: record }),
    openImportMenu: (anchor) => toggleImportMenu(anchor),
    openFracture: (id) => fracture.open(id ? 'component:' + id : null),
  });
  fracture = createFractureEditor({ library, viewer });
  bindImport();

  $('ViewerEmpty').hidden = false;
  const stored = await dbAll();
  const storedIds = new Set(stored.map((r) => r.id));
  stored.forEach((r) => library.put(r, false));
  try {
    const fresh = [];
    for (const spec of BUILTINS) {
      if (storedIds.has(spec.id)) continue;
      fresh.push(await compileBuiltin(spec, viewer.viewport()));
    }
    fresh.forEach(({ record }) => library.put(record, false));
    $('ViewerEmpty').hidden = true;
    viewer.refresh();
    // Cluster LOD for the built-ins, on workers, after first paint.
    for (const { record, geo } of fresh) {
      runLod(geo, record.settings.lod).then((lod) => { record.lod = lod; record.compiledAt = Date.now(); viewer.purgeGpu(record.id); viewer.refresh(); }).catch((e) => console.warn('LOD', e));
    }
  } catch (error) {
    console.error(error);
    $('ViewerEmpty').innerHTML = `<b style="color:#ff8a6b">Could not load the ControlVehicle facet streams</b><small>${error.message}</small>`;
    viewer.refresh();
  }

  const params = new URLSearchParams(location.search);
  if (params.has('sample')) openSample(params.get('sample'));
  if (params.has('drawer')) viewer.openContent();
  if (params.has('fracture')) fracture.open(params.get('fracture') || 'body');
}

// ---------------------------------------------------------------------------------------------------- import
function openSample(id) {
  const s = SAMPLE_SOURCES.find((x) => x.id === id) || SAMPLE_SOURCES[0];
  const raw = readSample(s.id);
  compile.open({ raw, fileName: `${s.label.replace(/\s+/g, '')}.sample`, ext: 'GEN', preset: { meta: { category: 'Sample', tags: `sample, ${s.id}` } } });
}

async function importFile(file) {
  try {
    const raw = await readFile(file);
    compile.open({ raw, fileName: file.name, ext: file.name.split('.').pop() });
  } catch (error) {
    toast(`Import failed: ${error.message}`);
  }
}

function toggleImportMenu(anchor, force) {
  const menu = $('ImportMenu');
  const show = force ?? menu.hidden;
  menu.hidden = !show;
  if (!show) return;
  const r = (anchor || $('ImportBtn')).getBoundingClientRect();
  const top = r.bottom + 8 + 520 > innerHeight ? Math.max(12, r.top - 528) : r.bottom + 8;
  menu.style.left = Math.min(innerWidth - 356, Math.max(12, r.left)) + 'px';
  menu.style.top = top + 'px';
}

function bindImport() {
  const formats = $('FormatList');
  IMPORT_FORMATS.forEach((f) => formats.append(h('div', { class: 'format-row' + (f.live ? '' : ' off') }, h('span', { class: 'ext' }, f.ext), h('div', {}, h('b', {}, f.label), h('small', {}, f.note)), f.live ? h('span', { dataset: { icon: 'check', size: '13' }, style: { color: '#46d267' } }) : h('small', {}, 'SOON'))));
  const samples = $('SampleList');
  SAMPLE_SOURCES.forEach((s) => {
    const row = h('button', { class: 'sample-row' }, h('span', { dataset: { icon: 'sample', size: '18', accent: 'teal' } }), h('div', {}, h('b', {}, s.label), h('small', {}, s.note)), h('span', { dataset: { icon: 'chevron', size: '13' } }));
    row.addEventListener('click', () => { toggleImportMenu(null, false); openSample(s.id); });
    samples.append(row);
  });
  hydrate($('ImportMenu'));
  $('ImportBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleImportMenu($('ImportBtn')); });
  $('ImportFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; toggleImportMenu(null, false); if (f) importFile(f); });
  document.addEventListener('pointerdown', (e) => { const m = $('ImportMenu'); if (!m.hidden && !m.contains(e.target) && !e.target.closest('#ImportBtn') && !e.target.closest('.import-card') && !e.target.closest('[data-import-anchor]')) toggleImportMenu(null, false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('ImportMenu').hidden) toggleImportMenu(null, false);
    if ((e.ctrlKey || e.metaKey) && (e.key === 'i' || e.key === 'I') && $('Compile').hidden && $('Fracture').hidden) { e.preventDefault(); toggleImportMenu($('ImportBtn'), true); }
  });
  // Files dropped anywhere open Geometry Compile.
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; depth++; $('DropVeil').hidden = false; });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) $('DropVeil').hidden = true; });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0; $('DropVeil').hidden = true;
    const f = e.dataTransfer.files[0];
    if (f) { if (!$('Compile').hidden) compile.close(); importFile(f); }
  });
}

boot();
