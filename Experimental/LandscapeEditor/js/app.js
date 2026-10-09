// Landscape Editor controller: project state, undo history, worker scheduling, autosave, exports and the wiring
// between the layer stack (left), the viewport (centre) and the inspector (right). Entry module of index.html.
import {
  createDefaultProject, normaliseProject, evaluationSnapshot, workingSize, createLayer, newId, STORAGE_KEY,
} from './terrain/project.js';
import { layerKind } from './terrain/layers.js';
import { renderLayerList, buildAddMenu } from './ui/layers-panel.js';
import { renderInspector, updateInspectorStats } from './ui/inspector.js';
import { View2D } from './ui/viewport2d.js';
import { View3D } from './ui/viewport3d.js';
import { el, fmt, fmtMetres, fmtMs, percentText } from './ui/dom.js';
import { ICONS } from './ui/icons.js';

const $ = (sel) => document.querySelector(sel);
const HISTORY_LIMIT = 100;
const VIEW_MODES = [
  ['3d', '3D'],
  ['satmap', 'Satmap'],
  ['height', 'Height'],
  ['slope', 'Slope'],
  ['flow', 'Flow'],
  ['sediment', 'Sediment'],
];

const state = {
  project: null,
  selected: 'terrain',
  result: null,
  status: { phase: 'idle', label: 'Ready', fraction: 0, index: 0, total: 0, message: '' },
  history: [],
  future: [],
  lastKey: null,
  lastAt: 0,
  saved: true,
};

let worker = null;
let exportJobId = 0;
let exporting = null; // { job, kind } while a file is being made in the worker
let jobId = 0;
let scheduleTimer = 0;
let saveTimer = 0;
let statusFrame = 0;
let view2d = null;
let view3d = null;
let view3dError = null;

// ---------------------------------------------------------------- project data helpers
const dataSnapshot = () => JSON.stringify({ terrain: state.project.terrain, layers: state.project.layers });

function applySnapshot(json) {
  const data = JSON.parse(json);
  state.project.terrain = data.terrain;
  state.project.layers = data.layers;
  if (state.selected !== 'terrain' && !state.project.layers.some((l) => l.id === state.selected)) state.selected = 'terrain';
}

// Runs fn as one undoable edit. Edits that share a key within a second are merged, so a slider drag is one step.
function edit(fn, opts = {}) {
  const before = dataSnapshot();
  fn();
  const after = dataSnapshot();
  if (after === before) return false;
  const now = performance.now();
  const merge = opts.key && opts.key === state.lastKey && now - state.lastAt < 1200;
  if (!merge) {
    state.history.push(before);
    if (state.history.length > HISTORY_LIMIT) state.history.shift();
    state.future = [];
  }
  state.lastKey = opts.key || null;
  state.lastAt = now;
  afterProjectChange(opts.immediate ? 0 : 250);
  return true;
}

// Live edits (slider drags included) never rebuild the inspector, so the control under the pointer survives.
// Structural operations call renderAll() or renderInspectorPanel() themselves.
function afterProjectChange(delay) {
  state.saved = false;
  schedule(delay);
  renderLayers();
  renderHeaderButtons();
  queuePersist();
}

function undo() {
  if (!state.history.length) return;
  state.future.push(dataSnapshot());
  applySnapshot(state.history.pop());
  state.lastKey = null;
  renderAll();
  schedule(0);
  queuePersist();
}

function redo() {
  if (!state.future.length) return;
  state.history.push(dataSnapshot());
  applySnapshot(state.future.pop());
  state.lastKey = null;
  renderAll();
  schedule(0);
  queuePersist();
}

// ---------------------------------------------------------------- worker and evaluation
function startWorker() {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = onWorkerMessage;
  worker.onerror = (e) => {
    state.status = { phase: 'error', message: e.message || 'The evaluation worker stopped.' };
    renderStatus();
  };
}

function schedule(delay = 0) {
  clearTimeout(scheduleTimer);
  scheduleTimer = setTimeout(startJob, delay);
  state.status = { ...state.status, phase: 'computing', label: 'Queued', fraction: 0 };
  renderStatus();
}

function startJob() {
  scheduleTimer = 0;
  jobId++;
  worker.postMessage({ type: 'evaluate', job: jobId, project: evaluationSnapshot(state.project) });
  state.status = { phase: 'computing', label: 'Starting', fraction: 0, index: 0, total: 0, message: '' };
  renderStatus();
}

function onWorkerMessage(event) {
  const m = event.data;
  if (m.type === 'export-progress') {
    if (exporting && m.job === exporting.job) {
      state.status = { phase: 'computing', label: m.label, fraction: m.fraction, index: 1, total: 1, message: '', exportJob: m.job };
      renderStatus();
    }
    return;
  }
  if (m.type === 'export-done') {
    if (exporting && m.job === exporting.job) finishExport(m);
    return;
  }
  if (m.type === 'export-error') {
    if (exporting && m.job === exporting.job) {
      exporting = null;
      endExportStatus(m.job);
      flashStatus('Export failed: ' + m.message);
    }
    return;
  }
  if (m.job !== jobId) return;
  if (m.type === 'progress') {
    state.status = { phase: 'computing', label: m.label, fraction: m.fraction, index: m.index, total: m.total, message: '' };
    if (!statusFrame) {
      statusFrame = requestAnimationFrame(() => {
        statusFrame = 0;
        renderStatus();
      });
    }
    return;
  }
  if (m.type === 'result') {
    state.result = m;
    state.status = { phase: 'idle', label: 'Up to date', fraction: 1, index: 0, total: 0, message: '' };
    renderLayers();
    updateInspectorStats($('#inspector'), inspectorModel());
    updateViewport();
    renderViewportHead();
    renderStatus();
    return;
  }
  if (m.type === 'error') {
    state.status = { phase: 'error', message: m.message.split('\n')[0] };
    console.error(m.message);
    renderStatus();
  }
}

// ---------------------------------------------------------------- persistence
function queuePersist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 400);
}

function persistNow() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.project));
    state.saved = true;
  } catch {
    state.saved = false;
  }
  renderSavePill();
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeName(text) {
  return (text || 'landscape').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'landscape';
}

// Exports run in the worker. It evaluates the current stack (cached, so cheap when the preview is up to date),
// makes the file at the full export size, and transfers the buffer back. The main thread only downloads it.
function requestExport(kind, layerId = null) {
  if (!worker || !state.project) return;
  if (exporting) {
    flashStatus('An export is already running.');
    return;
  }
  exportJobId++;
  exporting = { job: exportJobId, kind };
  state.status = { phase: 'computing', label: kind === 'r16' ? 'Exporting heightmap' : 'Exporting satmap', fraction: 0, index: 1, total: 1, message: '', exportJob: exportJobId };
  renderStatus();
  worker.postMessage({ type: 'export', job: exportJobId, kind, layerId, project: evaluationSnapshot(state.project) });
}

function exportR16() {
  requestExport('r16');
}

function exportSatmapFile() {
  // The top-most enabled satmap layer is exported at its own export size.
  const layers = state.project.layers.filter((l) => l.type === 'satmap' && l.enabled);
  if (!layers.length) {
    flashStatus('Add a satmap layer to export a colour map.');
    return;
  }
  requestExport('satmap', layers[layers.length - 1].id);
}

// Clears the export's own status line. A preview job that is still running keeps its status, because its
// progress messages have replaced the export line by now.
function endExportStatus(job) {
  if (state.status.exportJob === job) state.status = { phase: 'idle', label: 'Ready', fraction: 0, index: 0, total: 0, message: '' };
  renderStatus();
}

function finishExport(m) {
  exporting = null;
  endExportStatus(m.job);
  const name = safeName(state.project.name);
  if (m.kind === 'r16') {
    download(`${name}-${m.size}x${m.size}.r16`, new Blob([m.buffer], { type: 'application/octet-stream' }));
    return;
  }
  const S = m.size;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(m.buffer), S, S), 0, 0);
    canvas.toBlob((blob) => {
      if (blob) download(`${name}-satmap-${S}.png`, blob);
      else flashStatus(`The ${S} px satmap could not be encoded.`);
    }, 'image/png');
  } catch {
    flashStatus(`Could not make a ${S} px satmap: the browser does not have enough memory for it.`);
  }
}

function saveJSON() {
  download(`${safeName(state.project.name)}.landscape.json`, new Blob([JSON.stringify(state.project, null, 2)], { type: 'application/json' }));
}

function openJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const next = normaliseProject(JSON.parse(String(reader.result)));
      state.history.push(dataSnapshot());
      state.future = [];
      state.project = next;
      state.selected = 'terrain';
      renderAll();
      schedule(0);
      queuePersist();
    } catch (err) {
      flashStatus('Could not open that file: ' + (err.message || err));
    }
  };
  reader.readAsText(file);
}

function newProject() {
  state.history.push(dataSnapshot());
  state.future = [];
  state.project = createDefaultProject();
  state.selected = 'terrain';
  renderAll();
  schedule(0);
  queuePersist();
}

function flashStatus(message) {
  state.status = { ...state.status, phase: 'notice', message };
  renderStatus();
  setTimeout(() => {
    if (state.status.message === message) {
      state.status = { ...state.status, phase: 'idle', message: '' };
      renderStatus();
    }
  }, 4000);
}

// ---------------------------------------------------------------- layer operations
function selectLayer(id) {
  state.selected = id;
  renderLayers();
  renderInspectorPanel();
}

function addLayer(type) {
  const layer = createLayer(type);
  edit(() => {
    const layers = state.project.layers;
    if (layerKind(type) === 'texture') {
      layers.push(layer);
    } else {
      const firstTexture = layers.findIndex((l) => layerKind(l.type) === 'texture');
      layers.splice(firstTexture < 0 ? layers.length : firstTexture, 0, layer);
    }
  }, { immediate: true });
  state.selected = layer.id;
  renderAll();
  closeAddMenu();
}

function reorderLayer(dragId, targetId, above) {
  edit(() => {
    const layers = state.project.layers;
    const from = layers.findIndex((l) => l.id === dragId);
    if (from < 0) return;
    const [moving] = layers.splice(from, 1);
    let to = layers.findIndex((l) => l.id === targetId);
    if (to < 0) {
      layers.splice(from, 0, moving);
      return;
    }
    if (above) to += 1;
    layers.splice(to, 0, moving);
  }, { immediate: true });
  renderAll();
}

function moveLayer(id, dir) {
  const layers = state.project.layers;
  const i = layers.findIndex((l) => l.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= layers.length) return;
  if (layerKind(layers[i].type) !== layerKind(layers[j].type)) return;
  edit(() => {
    [layers[i], layers[j]] = [layers[j], layers[i]];
  }, { immediate: true });
  renderAll();
}

function duplicateLayer(id) {
  const layers = state.project.layers;
  const i = layers.findIndex((l) => l.id === id);
  if (i < 0) return;
  const copy = JSON.parse(JSON.stringify(layers[i]));
  copy.id = newId();
  copy.name = layers[i].name + ' copy';
  edit(() => layers.splice(i + 1, 0, copy), { immediate: true });
  state.selected = copy.id;
  renderAll();
}

function removeLayer(id) {
  const layers = state.project.layers;
  const i = layers.findIndex((l) => l.id === id);
  if (i < 0) return;
  edit(() => layers.splice(i, 1), { immediate: true });
  const neighbour = layers[i] || layers[i - 1];
  state.selected = neighbour ? neighbour.id : 'terrain';
  renderAll();
}

function resetLayer(id) {
  const layer = state.project.layers.find((l) => l.id === id);
  if (!layer) return;
  const fresh = createLayer(layer.type);
  edit(() => {
    layer.params = fresh.params;
  }, { immediate: true });
  renderAll();
}

function toggleLayer(id) {
  const layer = state.project.layers.find((l) => l.id === id);
  if (!layer) return;
  edit(() => {
    layer.enabled = !layer.enabled;
  }, { immediate: true });
  renderAll();
}

function renameLayer(id, name) {
  const layer = state.project.layers.find((l) => l.id === id);
  if (!layer) return;
  edit(() => {
    layer.name = name.slice(0, 60);
  }, { key: 'name:' + id, immediate: true });
  renderLayers();
}

// ---------------------------------------------------------------- view settings (not undoable)
function setView(key, value) {
  state.project.view[key] = value;
  state.saved = false;
  queuePersist();
  if (view3d) view3d.setSettings(viewSettingsFor());
  if (key === 'mode' || key === 'satmap' || key === 'water') {
    renderViewportHead();
    updateViewport();
  }
}

function viewSettingsFor() {
  const v = state.project.view;
  return { satmap: v.satmap, water: v.water, exaggeration: v.exaggeration, sunAzimuth: v.sunAzimuth, sunElevation: v.sunElevation };
}

// ---------------------------------------------------------------- rendering
function inspectorModel() {
  return {
    project: state.project,
    selected: state.selected,
    result: state.result,
    view: state.project.view,
    handlers: inspectorHandlers,
  };
}

const inspectorHandlers = {
  edit,
  schedule,
  setView,
  rename: renameLayer,
  toggleEnabled: toggleLayer,
  move: moveLayer,
  duplicate: duplicateLayer,
  reset: resetLayer,
  remove: removeLayer,
  refreshInspector: () => renderInspectorPanel(),
  randomiseSeed: () => {
    edit(() => {
      state.project.terrain.seed = Math.floor(Math.random() * 999999);
    }, { immediate: true });
    renderAll();
  },
};

function renderLayers() {
  renderLayerList($('#layer-list'), {
    project: state.project,
    selected: state.selected,
    result: state.result,
    handlers: {
      select: selectLayer,
      toggle: toggleLayer,
      reorder: reorderLayer,
    },
  });
  const height = state.project.layers.filter((l) => layerKind(l.type) === 'height');
  const texture = state.project.layers.filter((l) => layerKind(l.type) === 'texture');
  $('#count-height').textContent = String(height.length);
  $('#count-texture').textContent = String(texture.length);
  $('#layer-count').textContent = `${state.project.layers.length} layers · ${state.project.layers.filter((l) => l.enabled).length} on`;
}

function renderInspectorPanel() {
  renderInspector($('#inspector'), inspectorModel());
  updateInspectorStats($('#inspector'), inspectorModel());
}

function renderHeaderButtons() {
  $('#btn-undo').disabled = state.history.length === 0;
  $('#btn-redo').disabled = state.future.length === 0;
  $('#btn-export-r16').disabled = !state.result;
  $('#btn-export-png').disabled = !state.result?.colour;
}

function renderViewportHead() {
  const v = state.project.view;
  const t = state.project.terrain;
  const seg = $('#vp-modes');
  seg.replaceChildren();
  for (const [mode, label] of VIEW_MODES) {
    seg.append(el('button', {
      type: 'button',
      class: 'vp-seg-btn',
      'aria-pressed': v.mode === mode,
      onClick: () => setView('mode', mode),
    }, label));
  }
  $('#btn-satmap-toggle').setAttribute('aria-pressed', String(!!v.satmap));
  $('#btn-water-toggle').setAttribute('aria-pressed', String(!!v.water));
  $('#btn-satmap-toggle').hidden = v.mode !== '3d';
  $('#vp-title').textContent = state.project.name;
  const work = workingSize(t.size);
  const cellM = t.extentM / (work - 1);
  const eroded = work < t.size ? ` · eroded at ${work}²` : '';
  $('#vp-sub').textContent = `${t.size}²${eroded} · ${(t.extentM / 1000).toFixed(1)} km · ${cellM.toFixed(0)} m cells · ${fmtMetres(t.heightM)} range · sea ${fmtMetres(t.seaLevel * t.heightM)}`;
}

function renderSavePill() {
  const pill = $('#save-pill');
  pill.textContent = state.saved ? 'Saved' : 'Saving…';
  pill.className = 'pill ' + (state.saved ? 'ok' : 'warn');
}

function renderStatus() {
  const s = state.status;
  const pill = $('#top-pill');
  const stateText = $('#st-state');
  const bar = $('#st-bar');
  if (s.phase === 'error') {
    pill.textContent = 'Error';
    pill.className = 'pill bad';
    stateText.textContent = s.message || 'Something went wrong.';
    bar.style.width = '0%';
  } else if (s.phase === 'notice') {
    pill.textContent = 'Note';
    pill.className = 'pill warn';
    stateText.textContent = s.message;
  } else if (s.phase === 'computing') {
    pill.textContent = 'Computing';
    pill.className = 'pill warn';
    const total = s.total ? `${s.index}/${s.total} · ` : '';
    stateText.textContent = `${total}${s.label} ${Math.round((s.fraction || 0) * 100)}%`;
    bar.style.width = Math.round(((s.index - 1 + (s.fraction || 0)) / Math.max(1, s.total)) * 100) + '%';
  } else {
    pill.textContent = 'Live';
    pill.className = 'pill ok';
    stateText.textContent = state.result ? `Up to date · ${fmtMs(state.result.timing.total)}` : 'Ready';
    bar.style.width = state.result ? '100%' : '0%';
  }
  const summary = $('#st-summary');
  if (state.result) {
    const sm = state.result.summary;
    summary.textContent = `Elevation ${fmtMetres(sm.min * state.project.terrain.heightM)}–${fmtMetres(sm.max * state.project.terrain.heightM)} · under water ${percentText(sm.water)} · mean slope ${fmt(sm.meanSlope, 1)}°`;
  } else {
    summary.textContent = '';
  }
  renderHeaderButtons();
  renderSavePill();
}

function updateViewport() {
  const v = state.project.view;
  const r = state.result;
  const stage2d = $('#view2d');
  const stage3d = $('#view3d');
  const err = $('#view-error');
  if (!r) {
    view2d.setModel(null);
    return;
  }
  if (v.mode === '3d') {
    stage2d.hidden = true;
    if (!view3d && !view3dError) {
      try {
        view3d = new View3D(stage3d);
      } catch (e) {
        view3dError = e.message || String(e);
      }
    }
    if (view3d) {
      err.hidden = true;
      stage3d.hidden = false;
      view3d.setSettings(viewSettingsFor());
      view3d.setTerrain(r, state.project.terrain);
    } else {
      stage3d.hidden = true;
      err.hidden = false;
      err.textContent = view3dError;
    }
    $('#readout').hidden = true;
  } else {
    stage3d.hidden = true;
    err.hidden = true;
    stage2d.hidden = false;
    view2d.setModel({ mode: v.mode, result: r, terrain: state.project.terrain, water: v.water });
    if (view3d) view3d.setTerrain(r, state.project.terrain);
  }
  renderViewportHead();
}

function renderAll() {
  $('#project-name').value = state.project.name;
  renderLayers();
  renderInspectorPanel();
  renderViewportHead();
  updateViewport();
  renderStatus();
  renderHeaderButtons();
}

// ---------------------------------------------------------------- menus, keys and pointer readout
function openAddMenu() {
  const host = $('#add-menu-host');
  if (host.firstElementChild) return closeAddMenu();
  host.append(buildAddMenu((type) => addLayer(type)));
  host.hidden = false;
  host.querySelector('.add-filter')?.focus();
}

function closeAddMenu() {
  const host = $('#add-menu-host');
  host.replaceChildren();
  host.hidden = true;
}

function wireKeys() {
  window.addEventListener('keydown', (e) => {
    const typing = e.target instanceof HTMLElement && (e.target.matches('input, textarea, select') || e.target.isContentEditable);
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') closeAddMenu();
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault();
      undo();
    } else if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z')) && !typing) {
      e.preventDefault();
      redo();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && state.selected !== 'terrain') {
      e.preventDefault();
      removeLayer(state.selected);
    } else if (e.key.toLowerCase() === 'r' && !typing && !mod) {
      schedule(0);
    }
  });
}

function wireReadout() {
  const canvas = $('#view2d');
  const box = $('#readout');
  canvas.addEventListener('pointermove', (e) => {
    const r = state.result;
    const rect = canvas.getBoundingClientRect();
    const cell = view2d.cellAt(e.clientX - rect.left, e.clientY - rect.top);
    if (!r || !cell) {
      box.hidden = true;
      return;
    }
    const t = state.project.terrain;
    const cellM = t.extentM / (r.N - 1);
    const alt = r.height[cell.i] * t.heightM;
    const flowKm2 = (r.flow[cell.i] * cellM * cellM) / 1e6;
    box.hidden = false;
    box.textContent = `${Math.round(cell.x * cellM)} m E · ${Math.round(cell.y * cellM)} m S · ${fmtMetres(alt)} · slope ${fmt(r.slope[cell.i], 1)}° · drains ${fmt(flowKm2, 3)} km²`;
  });
  canvas.addEventListener('pointerleave', () => {
    box.hidden = true;
  });
}

function wireHeader() {
  $('#project-name').addEventListener('change', (e) => {
    const name = e.target.value.trim().slice(0, 60) || 'Untitled landscape';
    state.project.name = name;
    e.target.value = name;
    state.saved = false;
    queuePersist();
    renderViewportHead();
  });
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);
  $('#btn-new').addEventListener('click', newProject);
  $('#btn-open').addEventListener('click', () => $('#file-open').click());
  $('#file-open').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) openJSON(file);
    e.target.value = '';
  });
  $('#btn-save').addEventListener('click', saveJSON);
  $('#btn-export-r16').addEventListener('click', exportR16);
  $('#btn-export-png').addEventListener('click', exportSatmapFile);
  $('#btn-add').addEventListener('click', openAddMenu);
  $('#btn-satmap-toggle').addEventListener('click', () => setView('satmap', !state.project.view.satmap));
  $('#btn-water-toggle').addEventListener('click', () => setView('water', !state.project.view.water));
  $('#btn-camera').addEventListener('click', () => view3d?.resetCamera());
  $('#btn-recompute').addEventListener('click', () => schedule(0));
}

function observeStage() {
  new ResizeObserver(() => {
    view2d.resize();
    if (view3d) view3d.resize();
  }).observe($('#stage'));
}

// ---------------------------------------------------------------- boot
function boot() {
  let stored = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) stored = JSON.parse(raw);
  } catch {
    stored = null;
  }
  state.project = normaliseProject(stored) || createDefaultProject();
  view2d = new View2D($('#view2d'));
  $('#add-menu-host').hidden = true;
  $('#btn-undo').innerHTML = ICONS.undo; // static SVG strings from icons.js
  $('#btn-redo').innerHTML = ICONS.redo;
  wireHeader();
  wireKeys();
  wireReadout();
  observeStage();
  startWorker();
  renderAll();
  schedule(0);
}

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot);
else boot();

// Read-only handle for the browser checks and the console. Changes go through the UI or edit().
window.LandscapeEditor = {
  state,
  get view3d() {
    return view3d;
  },
  edit,
  undo,
  redo,
  addLayer,
  removeLayer,
  schedule,
};
