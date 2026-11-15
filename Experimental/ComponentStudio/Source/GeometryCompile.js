// Geometry Compile — the window that opens whenever something is imported (or re-opened from the Component Viewer).
// Left: the bake pipeline (Source → Geometry → UV → SDF → Cluster LOD → Icon → Metadata) with per-step state.
// Centre: one preview viewport whose mode follows the step (lit, checker, charts, clusters, GPU SDF raymarch, normals).
// Right: the Import Inspector for the active step, and the compile / add actions.
import { Viewport } from './Renderer.js';
import { STEPS, DOWNSTREAM, CATEGORIES, defaultSettings, buildGeometry, runUv, runSdf, runLod, lodLevel, formatCount, ms } from './Compile.js';
import { cornerNormals, triangleColors, indexColors, hueColor, linearToHex, hexToLinear } from './MeshData.js';
import { identityTransform } from '../Engine/GeometryTransform.js';
import { formatObj, formatUvSvg } from '../Engine/ObjExport.js';
import { $, h, ico, heading, panel, cardHead, note, slider, segmented, tile, vecRow, rows, toast, hydrate, download, bindDrawers, labelled } from './Kit.js';

const AUTO_LIMIT = 150000; // triangles below which UV + icon re-run automatically after a geometry edit

export function createGeometryCompile({ onSave, targetName }) {
  let viewport = null, drawers = null;
  let job = null; // { raw, fileName, ext, settings, geo, results, status, step, mode, levelPick, existingId }
  let gpu = { preview: null, lod: null, lodLevel: -1 };
  let rebuildTimer = 0, autoTimer = 0, busy = false;
  const view = { wire: false, grid: true, uvInset: false, iconFrame: false };

  // -------------------------------------------------------------------------------------------- open / close
  function open({ raw, fileName, ext, existing = null, preset = null }) {
    $('Compile').hidden = false;
    if (!viewport) init();
    const settings = existing ? structuredClone(existing.settings) : defaultSettings(raw, fileName);
    if (preset) Object.assign(settings.meta, preset.meta || {}), Object.assign(settings.source, preset.source || {});
    job = {
      raw, fileName, ext: (ext || fileName.split('.').pop() || '').toUpperCase(), settings, geo: null,
      results: { uv: null, sdf: null, lod: null, icon: null },
      status: { source: 'done', geometry: 'pending', uv: 'pending', sdf: 'pending', lod: 'pending', icon: 'pending', meta: 'done' },
      step: 'source', mode: 'lit', levelPick: 0, existingId: existing ? existing.id : null, log: [], compiledAt: 0,
      sdfView: { iso: 0, axis: 1, slice: 0.5, showSlice: true },
    };
    if (existing) {
      for (const k of ['uv', 'sdf', 'lod']) if (existing[k]) { job.results[k] = existing[k]; job.status[k] = 'done'; }
      if (existing.icon) { job.results.icon = { url: existing.icon, size: existing.settings.icon.size }; job.status.icon = 'done'; }
    }
    for (const s of STEPS) if (s.optional && !settings.enabled[s.id]) job.status[s.id] = 'skipped';
    log(`Opened ${fileName} · ${raw.format} · ${formatCount(raw.indices.length / 3)} triangles · ${raw.slots.length} material slot(s)`, 'dim');
    $('CompileFile').textContent = fileName;
    $('CompileExt').textContent = job.ext.slice(0, 5);
    $('CompileFileNote').textContent = `${raw.format} · ${raw.upAxis}`;
    $('CompileSave').textContent = existing ? `Compile & update ${existing.name}` : `Compile & add to ${targetName()}`;
    $('CompileTab').textContent = fileName;
    rebuildGeometry({ frame: true, keepResults: !!existing });
    viewport.setSdf(job.results.sdf || null);
    if (!existing) scheduleAuto(60);
    selectStep(existing ? 'meta' : 'source');
    renderLog();
  }

  function close() {
    $('Compile').hidden = true;
    drawers?.close();
    job = null;
    if (viewport) { viewport.deleteMesh(gpu.preview); viewport.deleteMesh(gpu.lod); viewport.setSdf(null); viewport.setObjects([]); }
    gpu = { preview: null, lod: null, lodLevel: -1 };
  }

  function init() {
    viewport = new Viewport($('CompileCanvas'), { onCamera: () => updateReadout() });
    drawers = bindDrawers($('Compile'));
    $('CompileModes').addEventListener('click', (e) => { const b = e.target.closest('[data-pmode]'); if (b) setMode(b.dataset.pmode); });
    const toggle = (id, key, apply) => $(id).addEventListener('click', () => { view[key] = !view[key]; $(id).classList.toggle('active', view[key]); apply(); });
    toggle('PreviewWire', 'wire', () => { viewport.settings.wire = view.wire; viewport.dirty = true; });
    toggle('PreviewGrid', 'grid', () => { viewport.settings.grid = view.grid; viewport.dirty = true; });
    toggle('PreviewUv', 'uvInset', () => { $('UvInset').hidden = !view.uvInset; drawUv($('UvInsetCanvas')); });
    toggle('PreviewIcon', 'iconFrame', () => updateIconFrame());
    $('PreviewFit').addEventListener('click', () => job?.geo && viewport.frame(job.geo.bounds));
    $('CompileCancel').addEventListener('click', () => { if (!busy) close(); });
    $('CompileRun').addEventListener('click', () => compileAll());
    $('CompileSave').addEventListener('click', () => save(true));
    new ResizeObserver(() => updateIconFrame()).observe($('CompileWell'));
    document.addEventListener('keydown', (e) => {
      if ($('Compile').hidden) return;
      if (e.key === 'Escape' && !busy && !document.querySelector('dialog[open]')) close();
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      const idx = '1234567'.indexOf(e.key);
      if (idx >= 0) selectStep(STEPS[idx].id);
      if (e.key === 'f' || e.key === 'F') job?.geo && viewport.frame(job.geo.bounds);
    });
    hydrate($('Compile'));
  }

  // -------------------------------------------------------------------------------------------- steps + state
  function setStatus(id, state) { job.status[id] = state; renderSteps(); }
  function markStale(from) {
    for (const d of DOWNSTREAM[from]) {
      if (!job.settings.enabled[d] && STEPS.find((s) => s.id === d).optional) { job.status[d] = 'skipped'; continue; }
      if (job.status[d] === 'done') job.status[d] = 'stale';
    }
    job.compiledAt = 0;
    renderSteps(); updateHeader();
  }

  function renderSteps() {
    if (!job) return;
    const list = $('StepList'); list.textContent = '';
    STEPS.forEach((s, i) => {
      const st = job.status[s.id];
      const pill = { done: ['done', 'DONE'], running: ['run', 'RUNNING'], stale: ['stale', 'STALE'], failed: ['fail', 'FAILED'], skipped: ['skip', 'SKIP'], pending: ['', 'PENDING'] }[st] || ['', st];
      const row = h('button', { class: `step-row${job.step === s.id ? ' active' : ''}${st === 'skipped' ? ' skipped' : ''}`, title: `${s.label} (${i + 1})` },
        h('span', { class: 'step-ico', dataset: { icon: s.icon, size: '18', accent: s.accent } }),
        h('div', {}, h('b', {}, `${i + 1}. ${s.label}`), h('small', {}, stepNote(s.id))),
        h('span', { class: 'step-state' }, h('span', { class: `pill ${pill[0]}` }, pill[1]),
          s.optional ? h('span', { class: `step-include${job.settings.enabled[s.id] ? ' on' : ''}`, role: 'checkbox', 'aria-checked': String(!!job.settings.enabled[s.id]), title: 'Include this step in Compile all', dataset: { include: s.id, icon: 'check', size: '11' } }) : null));
      row.addEventListener('click', (e) => {
        const inc = e.target.closest('[data-include]');
        if (inc) { e.stopPropagation(); toggleStep(s.id); return; }
        selectStep(s.id);
      });
      list.append(row);
    });
    const done = STEPS.filter((s) => job.status[s.id] === 'done').length;
    $('StepCount').textContent = `${done} / ${STEPS.length} DONE`;
    hydrate(list);
  }

  function stepNote(id) {
    const g = job.geo, r = job.results;
    switch (id) {
      case 'source': return `${job.raw.format} · ${formatCount(job.raw.indices.length / 3)} tris`;
      case 'geometry': return g ? `${dims(g.bounds)} · ${g.topology.closed ? 'closed' : 'open'}` : 'Transform · normals';
      case 'uv': return r.uv ? `${r.uv.charts} islands · ${Math.round(r.uv.fit * 100)} % fit` : 'Planar unwrap · pack';
      case 'sdf': return r.sdf ? `${r.sdf.dims}³ · ${ms(r.sdf.ms)}` : 'Signed distance field';
      case 'lod': return r.lod ? `${r.lod.levels.length} levels · ${formatCount(r.lod.clusterCount)} clusters` : 'Cluster DAG · simplify';
      case 'icon': return r.icon ? `${r.icon.size} px · ${job.settings.icon.background}` : 'Thumbnail capture';
      case 'meta': return `${job.settings.meta.name} · ${job.settings.meta.category}`;
    }
    return '';
  }

  function toggleStep(id) {
    const on = !job.settings.enabled[id];
    job.settings.enabled[id] = on;
    job.status[id] = on ? (job.results[id] ? 'stale' : 'pending') : 'skipped';
    renderSteps();
  }

  function selectStep(id) {
    job.step = id;
    const auto = { source: 'lit', geometry: 'lit', uv: 'checker', sdf: 'sdf', lod: 'clusters', icon: 'lit', meta: 'lit' }[id];
    if (auto === 'sdf' && !job.results.sdf) setMode('lit'); else if (auto === 'clusters' && !job.results.lod) setMode('lit'); else if (auto === 'checker' && !job.results.uv) setMode('lit'); else setMode(auto);
    if (id === 'icon' && !view.iconFrame) { view.iconFrame = true; $('PreviewIcon').classList.add('active'); }
    if (id !== 'icon' && view.iconFrame) { view.iconFrame = false; $('PreviewIcon').classList.remove('active'); }
    if (id === 'uv' && job.results.uv && !view.uvInset) { view.uvInset = true; $('PreviewUv').classList.add('active'); $('UvInset').hidden = false; }
    if (id !== 'uv' && view.uvInset) { view.uvInset = false; $('PreviewUv').classList.remove('active'); $('UvInset').hidden = true; }
    if (id === 'icon') applyIconCamera();
    updateIconFrame(); drawUv($('UvInsetCanvas'));
    renderSteps(); renderInspector();
  }

  function setMode(mode) {
    if (!job) return;
    job.mode = mode;
    for (const b of $('CompileModes').children) b.classList.toggle('active', b.dataset.pmode === mode);
    applyObjects();
  }

  // -------------------------------------------------------------------------------------------- geometry + preview
  function rebuildGeometry({ frame = false, keepResults = false } = {}) {
    try {
      job.geo = buildGeometry(job.raw, job.settings);
      job.status.geometry = 'done';
      if (!keepResults) markStale('geometry');
    } catch (error) {
      job.status.geometry = 'failed'; log(`Geometry failed: ${error.message}`, 'err');
    }
    $('CompileTris').textContent = formatCount(job.geo?.triangles || 0);
    $('CompileVerts').textContent = formatCount(job.geo?.vertices || 0);
    $('CompileSummary').textContent = job.settings.meta.name;
    uploadPreview();
    if (frame && job.geo) { viewport.camera.yaw = 0.75; viewport.camera.pitch = 0.32; viewport.frame(job.geo.bounds); }
    renderSteps(); updateHeader(); updateLive();
  }

  function scheduleRebuild(opts = {}) {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => { rebuildGeometry(opts); scheduleAuto(250); }, 90);
  }

  function scheduleAuto(delay) {
    clearTimeout(autoTimer);
    if (!job?.geo || job.geo.triangles > AUTO_LIMIT) return;
    autoTimer = setTimeout(async () => {
      if (!job || busy) return;
      if (job.settings.enabled.uv && job.status.uv !== 'done') stepUv();
      if (job.settings.enabled.icon && job.status.icon !== 'done') stepIcon();
      if (job.step === 'uv' || job.step === 'icon' || job.step === 'geometry') renderInspector();
    }, delay);
  }

  function uploadPreview() {
    viewport.deleteMesh(gpu.preview); gpu.preview = null;
    if (!job.geo) return;
    const g = job.geo, uv = job.results.uv;
    gpu.preview = viewport.createMesh({
      positions: g.positions, indices: g.indices, cornerNormals: g.cornerNormals, uvs: uv ? uv.uvs : null,
      colors: triangleColors(g.families, g.slots), debug: uv ? indexColors(uv.chartOf) : null,
    });
    uploadLod();
    viewport.settings.groundLevel = g.bounds.lo[1];
    viewport.settings.cell = niceCell(g.bounds.radius);
    viewport.settings.shadow = [g.bounds.centre[0], g.bounds.centre[2], (g.bounds.hi[0] - g.bounds.lo[0]) * 0.62 + 0.01, (g.bounds.hi[2] - g.bounds.lo[2]) * 0.62 + 0.01];
    applyObjects();
  }

  function uploadLod() {
    viewport.deleteMesh(gpu.lod); gpu.lod = null; gpu.lodLevel = -1;
    const lod = job.results.lod;
    if (!lod || !job.geo) return;
    const L = Math.min(job.levelPick, lod.levels.length - 1);
    const { indices, cluster } = lodLevel(lod, L);
    gpu.lod = viewport.createMesh({ positions: job.geo.positions, indices, cornerNormals: cornerNormals(job.geo.positions, indices, job.settings.geometry.smoothing), debug: indexColors(cluster) });
    gpu.lodLevel = L;
  }

  function applyObjects() {
    if (!viewport || !job) return;
    const m = job.mode;
    viewport.sdfView.enabled = m === 'sdf' && !!job.results.sdf;
    Object.assign(viewport.sdfView, job.sdfView);
    viewport.settings.wire = view.wire;
    let objects = [];
    if (m === 'clusters' && gpu.lod) objects = [{ mesh: gpu.lod, mode: 'debug' }];
    else if (gpu.preview) objects = [{ mesh: gpu.preview, mode: m === 'charts' ? 'debug' : m === 'checker' ? 'checker' : m === 'normal' ? 'normal' : 'lit' }];
    viewport.setObjects(objects);
    legend();
    updateReadout();
  }

  function legend() {
    const L = $('CompileLegend'), m = job.mode;
    const content = {
      charts: job.results.uv ? `<b>UV CHARTS</b><div style="margin-top:4px">${job.results.uv.charts} islands · one colour each</div>` : '<b>UV CHARTS</b><div>Run the UV step first</div>',
      clusters: job.results.lod ? `<b>CLUSTERS · LOD ${gpu.lodLevel}</b><div style="margin-top:4px">${formatCount(job.results.lod.levels[gpu.lodLevel].clusters)} clusters · ${formatCount(job.results.lod.levels[gpu.lodLevel].triangles)} tris</div>` : '<b>CLUSTERS</b><div>Build the Cluster LOD step first</div>',
      sdf: job.results.sdf ? `<b>SIGNED DISTANCE · ${job.results.sdf.dims}³</b><div class="ramp" style="background:linear-gradient(90deg,#d94d2e,#ffc85c,#fff,#4db3d9,#14295c)"></div><div class="ends"><span>INSIDE</span><span>SURFACE</span><span>OUTSIDE</span></div>` : '<b>SDF</b><div>Bake the SDF step first</div>',
      checker: job.results.uv ? '<b>CHECKER · 16 × 16</b><div style="margin-top:4px">Magenta = no UVs</div>' : '<b>CHECKER</b><div>Run the UV step first</div>',
    }[m];
    L.hidden = !content; if (content) L.innerHTML = content;
  }

  function updateReadout() {
    if (!job?.geo) return;
    const g = job.geo, c = viewport.camera;
    $('CompileReadout').textContent = [
      `tris      ${formatCount(g.triangles)}`, `verts     ${formatCount(g.vertices)}`, `bounds    ${dims(g.bounds)}`,
      `topology  ${g.topology.closed ? 'closed' : `open · ${g.topology.border} border edges`}`, `slots     ${g.slots.length}`,
      `camera    yaw ${(c.yaw * 57.3).toFixed(0)}° pitch ${(c.pitch * 57.3).toFixed(0)}°`,
    ].join('\n');
  }

  function updateHeader() {
    if (!job) return;
    const allDone = STEPS.every((s) => ['done', 'skipped'].includes(job.status[s.id]));
    $('CompileTitle').textContent = job.settings.meta.name;
    $('CompileNote').textContent = `${job.fileName} · ${job.raw.format}`;
    const st = $('CompileState');
    st.textContent = job.compiledAt ? 'COMPILED' : allDone ? 'READY' : 'DRAFT';
    st.className = 'state-tag' + (job.compiledAt || allDone ? ' live' : '');
    $('CompileLive').textContent = job.compiledAt ? 'COMPILED' : 'DRAFT';
    $('CompileStrip').textContent = job.compiledAt ? `COMPILED · ${new Date(job.compiledAt).toLocaleTimeString()}` : 'PREVIEW · NOT YET COMPILED';
    const total = ['uv', 'sdf', 'lod'].reduce((a, k) => a + (job.results[k]?.ms || job.results[k]?.buildMs || 0), job.geo?.ms || 0);
    $('CompileTime').textContent = ms(total);
    $('CompileMemory').textContent = memory();
  }

  function memory() {
    const g = job.geo; if (!g) return '—';
    let bytes = g.positions.byteLength + g.indices.byteLength + g.cornerNormals.byteLength;
    if (job.results.uv) bytes += job.results.uv.uvs.byteLength;
    if (job.results.sdf) bytes += job.results.sdf.values.byteLength;
    if (job.results.lod) bytes += job.results.lod.cornerVertex.byteLength;
    return bytes > 1e6 ? (bytes / 1e6).toFixed(1) + ' MB' : (bytes / 1e3).toFixed(0) + ' kB';
  }

  // -------------------------------------------------------------------------------------------- step runners
  function stepUv() {
    if (!job.geo) return;
    setStatus('uv', 'running');
    try {
      job.results.uv = runUv(job.geo, job.settings.uv);
      job.status.uv = 'done';
      log(`UV charts · ${job.results.uv.charts} islands · ${job.results.uv.seamCount} seam edges · fit ${(job.results.uv.fit * 100).toFixed(1)} % · ${ms(job.results.uv.ms)}`, 'ok');
      uploadPreview();
      if (job.status.icon === 'done') job.status.icon = 'stale';
    } catch (error) { job.status.uv = 'failed'; log(`UV failed: ${error.message}`, 'err'); }
    renderSteps(); updateHeader(); drawUv($('UvInsetCanvas'));
  }

  async function stepSdf(progress) {
    if (!job.geo) return;
    setStatus('sdf', 'running');
    if (!job.geo.topology.closed) log(`SDF: surface is open (${job.geo.topology.border} border edges) — sign is a parity guess`, 'warn');
    try {
      const result = await runSdf(job.geo, job.settings.sdf, progress);
      if (!job) return;
      job.results.sdf = result; job.status.sdf = 'done';
      viewport.setSdf(result);
      job.sdfView.iso = 0;
      log(`SDF bake · ${result.dims}³ · voxel ${result.voxel.toFixed(4)} · inside ${(result.insideShare * 100).toFixed(1)} % · ${ms(result.ms)}`, 'ok');
    } catch (error) { if (job) { job.status.sdf = 'failed'; log(`SDF failed: ${error.message}`, 'err'); } }
    if (job) { renderSteps(); updateHeader(); applyObjects(); }
  }

  async function stepLod(progress) {
    if (!job.geo) return;
    setStatus('lod', 'running');
    try {
      const result = await runLod(job.geo, job.settings.lod, progress);
      if (!job) return;
      job.results.lod = result; job.status.lod = 'done';
      job.levelPick = Math.min(job.levelPick, result.levels.length - 1);
      uploadLod();
      const top = result.levels[result.levels.length - 1];
      log(`Cluster LOD · ${result.levels.length} levels · ${formatCount(result.clusterCount)} clusters · coarsest ${formatCount(top.triangles)} tris${result.stalled ? ' · simplification stalled' : ''} · ${ms(result.buildMs)}`, 'ok');
    } catch (error) { if (job) { job.status.lod = 'failed'; log(`Cluster LOD failed: ${error.message}`, 'err'); } }
    if (job) { renderSteps(); updateHeader(); applyObjects(); }
  }

  function iconModeOf() { return { lit: 'lit', checker: 'checker', charts: 'debug' }[job.settings.icon.mode] || 'lit'; }
  function stepIcon() {
    if (!gpu.preview) return;
    const s = job.settings.icon;
    const canvas = viewport.capture({
      objects: [{ mesh: gpu.preview, mode: iconModeOf() }], bounds: job.geo.bounds, size: s.size, yaw: s.yaw, pitch: s.pitch,
      background: s.background === 'dark' ? [0.07, 0.07, 0.08, 1] : null,
    });
    job.results.icon = { url: canvas.toDataURL('image/png'), size: s.size };
    job.status.icon = 'done';
    log(`Icon · ${s.size} px · yaw ${(s.yaw * 57.3).toFixed(0)}° pitch ${(s.pitch * 57.3).toFixed(0)}° · ${s.background}`, 'ok');
    renderSteps();
  }

  async function compileAll() {
    if (busy || !job) return;
    busy = true;
    $('CompileBusy').hidden = false;
    const started = performance.now();
    const plan = ['uv', 'sdf', 'lod', 'icon'].filter((k) => job.settings.enabled[k] && job.status[k] !== 'done');
    const label = (t, f, n) => { $('BusyLabel').textContent = t; $('BusyBar').style.width = (f * 100).toFixed(0) + '%'; $('BusyNote').textContent = n || ''; };
    log(`Compile · ${plan.length ? plan.join(' → ') : 'nothing pending'}`, 'dim');
    try {
      if (job.status.geometry !== 'done') rebuildGeometry();
      for (let i = 0; i < plan.length; i++) {
        const k = plan[i], base = i / plan.length, span = 1 / plan.length;
        const progress = (f, text) => label(`${STEPS.find((s) => s.id === k).label}`, base + f * span, text);
        progress(0, 'Starting');
        await new Promise((r) => setTimeout(r, 20));
        if (k === 'uv') stepUv();
        else if (k === 'sdf') await stepSdf(progress);
        else if (k === 'lod') await stepLod(progress);
        else if (k === 'icon') stepIcon();
        if (!job) return;
      }
      job.compiledAt = Date.now();
      log(`Compiled in ${ms(performance.now() - started)}`, 'ok');
    } finally {
      busy = false;
      $('CompileBusy').hidden = true;
      if (job) { updateHeader(); renderSteps(); renderInspector(); }
    }
  }

  async function save(addToClass) {
    if (busy || !job) return;
    const failed = STEPS.filter((s) => job.status[s.id] === 'failed');
    await compileAll();
    if (!job) return;
    if (failed.length) toast(`Compiled with ${failed.length} failed step(s) — see the log`);
    const g = job.geo, r = job.results, s = job.settings;
    const record = {
      id: job.existingId || `mesh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: s.meta.name, category: s.meta.category, tags: s.meta.tags, notes: s.meta.notes,
      sourceFile: job.fileName, format: job.raw.format, compiledAt: Date.now(),
      positions: g.positions, indices: g.indices, families: g.families, slots: g.slots.map((x) => ({ ...x, color: x.color.slice() })), cornerNormals: g.cornerNormals,
      bounds: g.bounds, topology: g.topology, triangles: g.triangles, vertices: g.vertices,
      uv: s.enabled.uv ? r.uv : null, sdf: s.enabled.sdf ? r.sdf : null, lod: s.enabled.lod ? r.lod : null, icon: s.enabled.icon && r.icon ? r.icon.url : null,
      settings: structuredClone(s), raw: job.raw, log: job.log.map((l) => l.text),
    };
    onSave(record, { addToClass: addToClass && !job.existingId });
    close();
  }

  // -------------------------------------------------------------------------------------------- inspector
  function renderInspector() {
    if (!job) return;
    const host = $('StepInspector'); host.textContent = '';
    const step = STEPS.find((s) => s.id === job.step);
    const idx = STEPS.indexOf(step);
    host.append(
      h('div', { class: 'crumbs' }, 'Import Inspector', h('i', {}, '/'), job.fileName, h('i', {}, '/'), step.label),
      h('div', { class: 'title-row' }, h('span', { class: 'badge', dataset: { icon: step.icon, size: '22', accent: step.accent } }), h('h1', {}, step.label)),
      h('div', { class: 'subtitle', id: 'StepSubtitle' }, stepNote(step.id)),
    );
    const builders = { source: inspectSource, geometry: inspectGeometry, uv: inspectUv, sdf: inspectSdf, lod: inspectLod, icon: inspectIcon, meta: inspectMeta };
    builders[step.id](host);
    const nav = h('div', { class: 'btn-row', style: { marginTop: '18px' } },
      h('button', { class: 'tool', disabled: idx === 0, onclick: () => selectStep(STEPS[idx - 1].id) }, '‹ ', idx > 0 ? STEPS[idx - 1].label : 'Back'),
      h('button', { class: 'tool', disabled: idx === STEPS.length - 1, onclick: () => selectStep(STEPS[idx + 1].id) }, idx < STEPS.length - 1 ? STEPS[idx + 1].label : 'Next', ' ›'));
    host.append(nav);
    hydrate(host);
  }

  function updateLive() {
    const sub = $('StepSubtitle'); if (sub && job) sub.textContent = stepNote(job.step);
    const b = $('GeoBounds'); if (b && job?.geo) b.replaceWith(Object.assign(geoRows(), { id: 'GeoBounds' }));
  }

  function geoRows() {
    const g = job.geo;
    const r = rows([
      ['Bounds', dims(g.bounds)], ['Centre', g.bounds.centre.map((v) => v.toFixed(2)).join(', ')], ['Unit scale', `× ${g.unit.toPrecision(3)}`],
      ['Topology', g.topology.closed ? 'Closed (watertight)' : `Open · ${g.topology.border} border edges`],
      ['Non-manifold edges', String(g.topology.nonManifold)],
    ]);
    r.id = 'GeoBounds';
    return r;
  }

  function inspectSource(host) {
    const raw = job.raw, s = job.settings.source;
    host.append(
      h('div', { class: 'metrics' },
        h('div', {}, h('b', {}, formatCount(raw.indices.length / 3)), h('small', {}, 'TRIANGLES')),
        h('div', {}, h('b', {}, formatCount(raw.positions.length / 3)), h('small', {}, 'WELDED VERTICES')),
        h('div', {}, h('b', {}, String(raw.slots.length)), h('small', {}, 'MATERIAL SLOTS')),
        h('div', {}, h('b', {}, job.geo?.topology.closed ? 'Closed' : 'Open'), h('small', {}, 'TOPOLOGY'))),
      heading('FILE'),
      panel(rows([['File', job.fileName], ['Format', raw.format], ['Authored axis', raw.upAxis], ['Welding', 'Exact position'], ['Degenerates', 'Dropped on read']])),
      heading('UNITS & AXES'),
      panel(
        labelled('Units', h('span')),
        segmented([['keep', 'Keep authored'], ['fit1', 'Fit 1 m'], ['fit2', 'Fit 2 m']], s.units, (v) => { s.units = v; scheduleRebuild(); }),
        slider({ label: 'Import scale', min: -2, max: 2, step: 0.01, value: Math.log10(s.importScale), format: (v) => `× ${Math.pow(10, v).toPrecision(3)}`, onInput: (v) => { s.importScale = Math.pow(10, v); scheduleRebuild(); }, hint: 'Applied when units are kept. Logarithmic: ×0.01 – ×100.' }),
        labelled('Up axis', h('span')),
        segmented([['y', 'Y-up (keep)'], ['z', 'Z-up → Y-up']], s.upAxis, (v) => { s.upAxis = v; scheduleRebuild({ frame: true }); }),
        note('FCT1 facet streams are converted to Y-up on read. STL defaults to Z-up.')),
      heading('MATERIAL SLOTS', `${raw.slots.length}`),
      slotPanel(raw.slots),
    );
  }

  function slotPanel(slots) {
    const p = panel();
    slots.forEach((slot, i) => {
      const input = h('input', { type: 'color', value: linearToHex(slot.color), 'aria-label': `${slot.name} colour` });
      input.addEventListener('input', () => { slot.color = hexToLinear(input.value); uploadPreview(); if (job.status.icon === 'done') { job.status.icon = 'stale'; renderSteps(); } });
      p.append(h('div', { class: 'slot-row' }, input, h('span', {}, slot.name), h('small', {}, `SLOT ${i}${slot.emissive ? ' · EMISSIVE' : ''}`)));
    });
    return p;
  }

  function inspectGeometry(host) {
    const t = job.settings.geometry.transform, gs = job.settings.geometry;
    const apply = () => scheduleRebuild();
    host.append(
      heading('TRANSFORM', 'BEFORE BAKE'),
      panel(
        vecRow({ label: 'Scale', value: t.scale, step: 0.01, digits: 3, onInput: (v) => { if (gs.uniform) { const k = v.find((x, i) => x !== t.scale[i]) ?? v[0]; t.scale = [k, k, k]; } else t.scale = v; apply(); }, onReset: () => (t.scale = [1, 1, 1]) }),
        vecRow({ label: 'Rotate °', value: t.rotate, step: 0.5, digits: 1, onInput: (v) => { t.rotate = v; apply(); }, onReset: () => (t.rotate = [0, 0, 0]) }),
        h('div', { class: 'tiles three' },
          ...['X', 'Y', 'Z'].map((a, k) => tile({ icon: 'scale', label: `Mirror ${a}`, on: t.mirror[k], onToggle: (on) => { t.mirror[k] = on; apply(); } }))),
        h('div', { class: 'tiles' },
          tile({ icon: 'lock', label: 'Uniform scale', on: gs.uniform, onToggle: (on) => { gs.uniform = on; } }),
          tile({ icon: 'geometry', label: 'Flip normals', on: t.flipNormals, onToggle: (on) => { t.flipNormals = on; apply(); } })),
        labelled('Pivot', h('span')),
        segmented([['none', 'Keep'], ['origin', 'Centre'], ['floor', 'Floor (base)']], t.centre, (v) => { t.centre = v; apply(); }),
        h('button', { class: 'tool wide', onclick: () => { job.settings.geometry.transform = identityTransform(); rebuildGeometry(); renderInspector(); } }, h('span', { dataset: { icon: 'reset', size: '14' } }), 'Reset transform')),
      heading('NORMALS'),
      panel(
        slider({ label: 'Smoothing angle', min: 0, max: 180, step: 1, value: gs.smoothing, format: (v) => `${v}°`, onInput: (v) => { gs.smoothing = v; apply(); }, hint: 'Faces whose normals differ by more than this keep a hard edge. 180° = fully smooth.' })),
      heading('RESULT'),
      panel(geoRows(), note('Mirror reverses winding so normals stay outward; Flip normals reverses it again. Editing geometry marks UV, SDF, LOD and Icon stale; UV and Icon re-run automatically on meshes under 150k triangles.')),
    );
  }

  function inspectUv(host) {
    const s = job.settings.uv, r = job.results.uv;
    const canvas = h('canvas', { class: 'preview-canvas', 'aria-label': 'UV layout' });
    host.append(canvas);
    requestAnimationFrame(() => drawUv(canvas));
    host.append(
      h('div', { class: 'metrics' },
        h('div', {}, h('b', {}, r ? String(r.charts) : '—'), h('small', {}, 'ISLANDS')),
        h('div', {}, h('b', {}, r ? formatCount(r.seamCount) : '—'), h('small', {}, 'SEAM EDGES')),
        h('div', {}, h('b', {}, r ? `${(r.fit * 100).toFixed(1)} %` : '—'), h('small', {}, 'PROJECTION FIT')),
        h('div', {}, h('b', {}, r ? `${(r.coverage * 100).toFixed(1)} %` : '—'), h('small', {}, 'UV COVERAGE'))),
      heading('UNWRAP'),
      panel(
        slider({ label: 'Island normal limit', min: 15, max: 89, step: 1, value: s.normalLimit, format: (v) => `${v}°`, onChange: (v) => { s.normalLimit = v; markUvStale(); } }),
        slider({ label: 'Merge islands below', min: 0, max: 200, step: 1, value: s.mergeBelow, format: (v) => `${v} tris`, onChange: (v) => { s.mergeBelow = v; markUvStale(); } }),
        slider({ label: 'Merge plane limit', min: 30, max: 120, step: 1, value: s.mergeLimit, format: (v) => `${v}°`, onChange: (v) => { s.mergeLimit = v; markUvStale(); } }),
        h('button', { class: 'primary' + (job.status.uv === 'stale' ? ' stale' : ''), onclick: () => { stepUv(); renderInspector(); if (job.mode === 'lit') setMode('checker'); } }, h('span', { dataset: { icon: 'uv', size: '15' } }), r ? 'Re-unwrap & pack' : 'Unwrap & pack')),
      heading('EXPORT'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'tool', disabled: !r, onclick: () => download(`${job.settings.meta.name}.obj`, formatObj(job.geo.positions, job.geo.indices, r.uvs, job.settings.meta.name), 'text/plain') }, 'OBJ + UVs'),
        h('button', { class: 'tool', disabled: !r, onclick: () => download(`${job.settings.meta.name}-uv.svg`, formatUvSvg(uvLayoutForSvg(), r.uvs, job.settings.meta.name), 'image/svg+xml') }, 'SVG layout')),
      h('p', { class: 'honest' }, 'Planar island unwrap (Frontier-1 UvCharts): flood fill by normal cone, tiny-island merge, projection onto each island plane, shelf packing at one texel density. Not a least-squares conformal unwrap — projection fit reports the area lost to foreshortening.'),
    );
  }
  function markUvStale() { if (job.status.uv === 'done') { job.status.uv = 'stale'; renderSteps(); } }
  function uvLayoutForSvg() {
    // formatUvSvg expects the layout (seams + triangleCount); rebuild the minimal shape from the stored result.
    const r = job.results.uv;
    return { triangleCount: job.geo.triangles, seams: r.seams, borders: r.borders || new Uint32Array(0), charts: new Array(r.charts), chartOf: r.chartOf };
  }

  function inspectSdf(host) {
    const s = job.settings.sdf, r = job.results.sdf, v = job.sdfView;
    const canvas = h('canvas', { class: 'preview-canvas', 'aria-label': 'SDF slice' });
    host.append(canvas);
    requestAnimationFrame(() => drawSlice(canvas));
    if (!job.geo.topology.closed) host.append(h('div', { class: 'panel', style: { marginTop: '8px', borderColor: '#4a3418', background: '#1b150c' } }, h('p', { style: { color: '#ffb86b' } }, `Open surface (${job.geo.topology.border} border edges). The distance is exact; the inside/outside sign is a crossing-parity guess.`)));
    host.append(
      h('div', { class: 'metrics' },
        h('div', {}, h('b', {}, r ? `${r.dims}³` : '—'), h('small', {}, 'GRID')),
        h('div', {}, h('b', {}, r ? r.voxel.toFixed(4) : '—'), h('small', {}, 'VOXEL (UNITS)')),
        h('div', {}, h('b', {}, r ? `${(r.insideShare * 100).toFixed(1)} %` : '—'), h('small', {}, 'INSIDE')),
        h('div', {}, h('b', {}, r ? ms(r.ms) : '—'), h('small', {}, 'BAKE TIME'))),
      heading('BAKE'),
      panel(
        labelled('Resolution', h('span')),
        segmented([[32, '32³'], [40, '40³'], [48, '48³'], [64, '64³'], [80, '80³']], s.resolution, (x) => { s.resolution = x; if (job.status.sdf === 'done') { job.status.sdf = 'stale'; renderSteps(); } }),
        slider({ label: 'Narrow band', min: 1, max: 4, step: 1, value: s.band, format: (x) => `${x} voxels`, onChange: (x) => { s.band = x; if (job.status.sdf === 'done') { job.status.sdf = 'stale'; renderSteps(); } } }),
        h('button', { class: 'primary' + (job.status.sdf === 'stale' ? ' stale' : ''), disabled: job.status.sdf === 'running', onclick: async () => { await runWithOverlay('SDF bake', stepSdf); setMode('sdf'); renderInspector(); } }, h('span', { dataset: { icon: 'sdf', size: '15' } }), r ? 'Re-bake distance field' : 'Bake distance field')),
      heading('PREVIEW', 'GPU RAYMARCH'),
      panel(
        slider({ label: 'Iso offset', min: -15, max: 15, step: 0.5, value: r ? (v.iso / (r.extent / 1.1)) * 100 : 0, format: (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)} % of size`, onInput: (x) => { if (!r) return; v.iso = (x / 100) * (r.extent / 1.1); applyObjects(); drawSlice(canvas); } }),
        labelled('Slice axis', h('span')),
        segmented([[0, 'X'], [1, 'Y'], [2, 'Z']], v.axis, (x) => { v.axis = x; applyObjects(); drawSlice(canvas); }),
        slider({ label: 'Slice position', min: 0, max: 1, step: 0.005, value: v.slice, format: (x) => `${(x * 100).toFixed(0)} %`, onInput: (x) => { v.slice = x; applyObjects(); drawSlice(canvas); } }),
        h('div', { class: 'tiles' }, tile({ icon: 'heat', label: 'Slice plane', on: v.showSlice, onToggle: (on) => { v.showSlice = on; applyObjects(); } }),
          tile({ icon: 'sdf', label: 'SDF view', on: job.mode === 'sdf', onToggle: (on) => setMode(on ? 'sdf' : 'lit') }))),
      h('p', { class: 'honest' }, 'Narrow-band distance + crossing-parity sign (Frontier-1 SdfBake) on a worker. The viewport sphere-traces the baked grid as a half-float 3D texture; the slice plane shows the field with contour lines.'),
    );
  }

  function inspectLod(host) {
    const s = job.settings.lod, r = job.results.lod;
    const L = r ? Math.min(job.levelPick, r.levels.length - 1) : 0;
    const share = r ? r.levels[L].triangles / r.levels[0].triangles : 0;
    host.append(
      h('div', { class: 'hero' }, h('div', { class: 'hero-bar' }, h('i', { style: { width: (share * 100).toFixed(1) + '%' } })),
        h('div', { class: 'hero-text' }, h('b', {}, r ? `${(share * 100).toFixed(1)} %` : '—'), h('small', {}, r ? `of source triangles at LOD ${L}` : 'Build the hierarchy to preview levels'))),
      h('div', { class: 'metrics' },
        h('div', {}, h('b', {}, r ? String(r.levels.length) : '—'), h('small', {}, 'LEVELS')),
        h('div', {}, h('b', {}, r ? formatCount(r.clusterCount) : '—'), h('small', {}, 'CLUSTERS')),
        h('div', {}, h('b', {}, r ? formatCount(r.groupCount) : '—'), h('small', {}, 'GROUPS')),
        h('div', {}, h('b', {}, r ? ms(r.buildMs) : '—'), h('small', {}, 'BUILD'))),
    );
    if (r) {
      const top = r.levels.length - 1;
      host.append(heading('LEVEL PREVIEW'), panel(
        slider({ label: 'LOD level', min: 0, max: top, step: 1, value: L, format: (x) => `LOD ${x} of ${top}`, onChange: (x) => { job.levelPick = x; uploadLod(); setMode('clusters'); renderInspector(); } }),
        levelTable(r, L)));
    }
    host.append(
      heading('BUILD'),
      panel(
        slider({ label: 'Cluster size', min: 32, max: 256, step: 32, value: s.clusterTriangles, format: (x) => `${x} tris`, onChange: (x) => { s.clusterTriangles = x; lodStale(); } }),
        slider({ label: 'Group size', min: 2, max: 8, step: 1, value: s.groupClusters, format: (x) => `${x} clusters`, onChange: (x) => { s.groupClusters = x; lodStale(); } }),
        slider({ label: 'Keep ratio', min: 0.3, max: 0.8, step: 0.05, value: s.simplifyRatio, format: (x) => `${Math.round(x * 100)} %`, onChange: (x) => { s.simplifyRatio = x; lodStale(); } }),
        h('button', { class: 'primary' + (job.status.lod === 'stale' ? ' stale' : ''), disabled: job.status.lod === 'running', onclick: async () => { await runWithOverlay('Cluster LOD', stepLod); setMode('clusters'); renderInspector(); } }, h('span', { dataset: { icon: 'lod', size: '15' } }), r ? 'Rebuild hierarchy' : 'Build hierarchy')),
      h('p', { class: 'honest' }, 'Nanite-style DAG (Frontier-1 ClusterHierarchy): median-split clusters, border-sharing groups, quadric simplification with locked group borders, recursive until one cluster. Every level is crack-free against its neighbours.'),
    );
  }
  function lodStale() { if (job.status.lod === 'done') { job.status.lod = 'stale'; renderSteps(); } }
  function levelTable(r, active) {
    const wrap = h('div', {});
    const max = r.levels[0].triangles;
    r.levels.forEach((lv, i) => {
      const c = hueColor(i * 3 + 1).map((x) => Math.pow(x, 1 / 2.2) * 255 | 0);
      const row = h('div', { class: 'level-row' + (i === active ? ' active' : ''), title: `LOD ${i}` },
        h('i', { style: { background: `rgb(${c})` } }), h('b', {}, `LOD ${i}`),
        h('div', { class: 'meter' }, h('em', { style: { width: Math.max(2, (lv.triangles / max) * 100) + '%' } })),
        h('span', {}, formatCount(lv.triangles)));
      row.addEventListener('click', () => { job.levelPick = i; uploadLod(); setMode('clusters'); renderInspector(); });
      wrap.append(row);
    });
    return wrap;
  }

  function inspectIcon(host) {
    const s = job.settings.icon, r = job.results.icon;
    const preview = h('div', { class: 'icon-preview' }, r ? h('img', { src: r.url, alt: 'Captured icon' }) : h('div', { class: 'icon-empty' }, 'No icon yet. Frame the mesh in the dashed box and press Capture.'));
    host.append(preview,
      heading('CAMERA'),
      panel(
        segmented([['q', '¾ view'], ['front', 'Front'], ['side', 'Side'], ['top', 'Top']], null, (v) => {
          const a = { q: [0.75, 0.42], front: [0, 0.08], side: [Math.PI / 2, 0.08], top: [0.001, 1.45] }[v];
          s.yaw = a[0]; s.pitch = a[1]; applyIconCamera(); renderInspector();
        }),
        slider({ label: 'Yaw', min: -180, max: 180, step: 1, value: Math.round(((s.yaw * 180) / Math.PI + 540) % 360 - 180), format: (x) => `${x}°`, onInput: (x) => { s.yaw = (x * Math.PI) / 180; applyIconCamera(); } }),
        slider({ label: 'Pitch', min: -80, max: 85, step: 1, value: Math.round((s.pitch * 180) / Math.PI), format: (x) => `${x}°`, onInput: (x) => { s.pitch = (x * Math.PI) / 180; applyIconCamera(); } }),
        h('button', { class: 'tool wide', onclick: () => { s.yaw = viewport.camera.yaw; s.pitch = viewport.camera.pitch; renderInspector(); toast('Icon camera set from the viewport'); } }, h('span', { dataset: { icon: 'rotate', size: '14' } }), 'Use viewport angle')),
      heading('OUTPUT'),
      panel(
        labelled('Size', h('span')), segmented([[128, '128'], [256, '256'], [512, '512'], [1024, '1024']], s.size, (v) => { s.size = v; }),
        labelled('Background', h('span')), segmented([['transparent', 'Transparent'], ['dark', 'Studio dark']], s.background, (v) => { s.background = v; }),
        labelled('Shading', h('span')), segmented([['lit', 'Lit'], ['checker', 'Checker'], ['charts', 'UV charts']], s.mode, (v) => { s.mode = v; }),
        h('div', { class: 'btn-row' },
          h('button', { class: 'primary', onclick: () => { stepIcon(); renderInspector(); } }, h('span', { dataset: { icon: 'icon', size: '15' } }), 'Capture'),
          h('button', { class: 'tool', disabled: !r, onclick: () => download(`${job.settings.meta.name}.png`, r.url) }, h('span', { dataset: { icon: 'download', size: '14' } }), 'PNG'))),
      h('p', { class: 'honest' }, 'The capture renders only this mesh, fitted to a square, through the same WebGL2 shader as the viewport (4× MSAA). The icon becomes the Content thumbnail and the component badge in the Component Viewer.'),
    );
  }
  function applyIconCamera() {
    if (!job?.geo) return;
    const s = job.settings.icon;
    viewport.camera.yaw = s.yaw; viewport.camera.pitch = s.pitch;
    viewport.frame(job.geo.bounds);
    viewport.camera.distance = job.geo.bounds.radius / Math.sin((viewport.camera.fov * Math.PI) / 360) / 0.86 * (viewport.camera.fov / 30) * 0.9;
    viewport.dirty = true; updateIconFrame();
  }
  function updateIconFrame() {
    const f = $('IconFrame');
    f.hidden = !view.iconFrame;
    if (!view.iconFrame) return;
    const well = $('CompileWell');
    f.style.setProperty('--side', Math.round(Math.min(well.clientWidth, well.clientHeight) * 0.72) + 'px');
  }

  function inspectMeta(host) {
    const m = job.settings.meta, r = job.results;
    const tags = h('div', { class: 'tag-list' });
    const drawTags = () => { tags.textContent = ''; m.tags.split(',').map((t) => t.trim()).filter(Boolean).forEach((t) => tags.append(h('span', {}, t))); };
    drawTags();
    const name = h('input', { value: m.name, maxlength: 64, autocomplete: 'off' });
    name.addEventListener('input', () => { m.name = name.value.trim() || 'SM_Imported'; $('CompileSummary').textContent = m.name; updateHeader(); renderSteps(); });
    const cat = h('select', {}, ...CATEGORIES.map((c) => h('option', { value: c, selected: c === m.category }, c)));
    cat.addEventListener('change', () => { m.category = cat.value; renderSteps(); });
    const tagInput = h('input', { value: m.tags, placeholder: 'comma, separated, tags', autocomplete: 'off' });
    tagInput.addEventListener('input', () => { m.tags = tagInput.value; drawTags(); });
    const notes = h('textarea', { rows: 4, placeholder: 'Provenance, licence, notes for the team' }, m.notes);
    notes.addEventListener('input', () => { m.notes = notes.value; });
    host.append(
      h('div', { class: 'mesh-picker', style: { margin: '6px 0 4px' } },
        h('span', { class: 'thumb' }, r.icon ? h('img', { src: r.icon.url, alt: '' }) : h('span', { dataset: { icon: 'mesh', size: '24' } })),
        h('div', {}, h('b', {}, m.name), h('small', {}, `${m.category} · ${formatCount(job.geo.triangles)} tris · ${job.geo.slots.length} slots`), tags)),
      heading('METADATA'),
      panel(h('label', { class: 'meta-field' }, h('span', {}, 'Name'), name), h('label', { class: 'meta-field' }, h('span', {}, 'Category'), cat),
        h('label', { class: 'meta-field' }, h('span', {}, 'Tags'), tagInput), h('label', { class: 'meta-field' }, h('span', {}, 'Notes'), notes)),
      heading('COMPILE SUMMARY'),
      panel(h('div', { class: 'bake-grid' }, ...['uv', 'sdf', 'lod', 'icon'].map((k) => {
        const st = STEPS.find((s) => s.id === k), on = job.status[k] === 'done';
        return h('div', { class: 'bake-chip' + (on ? ' on' : '') }, h('span', { class: 'ico', dataset: { icon: on ? 'check' : st.icon, size: '14' } }), h('div', {}, h('b', {}, st.label), h('small', {}, job.status[k].toUpperCase() + ' · ' + stepNote(k))));
      }))),
    );
  }

  async function runWithOverlay(label, fn) {
    if (busy) return;
    busy = true; $('CompileBusy').hidden = false;
    const progress = (f, text) => { $('BusyLabel').textContent = label; $('BusyBar').style.width = (f * 100).toFixed(0) + '%'; $('BusyNote').textContent = text || ''; };
    progress(0, 'Starting');
    try { await fn(progress); } finally { busy = false; $('CompileBusy').hidden = true; }
  }

  // -------------------------------------------------------------------------------------------- 2D previews
  function drawUv(canvas) {
    if (!canvas || !job) return;
    const size = Math.max(200, Math.round((canvas.clientWidth || 300) * Math.min(2, devicePixelRatio || 1)));
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d');
    g.fillStyle = '#0d0d0f'; g.fillRect(0, 0, size, size);
    g.strokeStyle = '#1f1f24'; g.lineWidth = 1;
    for (let i = 0; i <= 8; i++) { const x = (i / 8) * size; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, size); g.moveTo(0, x); g.lineTo(size, x); g.stroke(); }
    const r = job.results.uv;
    if (!r) { g.fillStyle = '#666'; g.font = `${size / 22}px DM Sans, sans-serif`; g.textAlign = 'center'; g.fillText('Run the UV step to see the layout', size / 2, size / 2); return; }
    const uv = r.uvs, tris = uv.length / 6, stride = Math.max(1, Math.ceil(tris / 90000)), pad = size * 0.03, s = size - pad * 2;
    const X = (u) => pad + u * s, Y = (v) => pad + (1 - v) * s;
    let last = -1;
    for (let t = 0; t < tris; t += stride) {
      const chart = r.chartOf[t];
      if (chart !== last) {
        if (last >= 0) g.fill();
        const c = hueColor(chart).map((x) => (Math.pow(x, 1 / 2.2) * 255) | 0);
        g.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},0.55)`; g.beginPath(); last = chart;
      }
      const o = t * 6;
      g.moveTo(X(uv[o]), Y(uv[o + 1])); g.lineTo(X(uv[o + 2]), Y(uv[o + 3])); g.lineTo(X(uv[o + 4]), Y(uv[o + 5])); g.closePath();
    }
    if (last >= 0) g.fill();
    g.strokeStyle = '#ffb238'; g.lineWidth = Math.max(1, size / 600); g.beginPath();
    const seamStride = Math.max(1, Math.ceil(r.seams.length / 40000));
    for (let i = 0; i < r.seams.length; i += seamStride) {
      const slot = r.seams[i], t = (slot / 3) | 0, k = slot % 3, a = t * 6 + k * 2, b = t * 6 + ((k + 1) % 3) * 2;
      g.moveTo(X(uv[a]), Y(uv[a + 1])); g.lineTo(X(uv[b]), Y(uv[b + 1]));
    }
    g.stroke();
    g.strokeStyle = '#3a3a40'; g.strokeRect(pad, pad, s, s);
  }

  function drawSlice(canvas) {
    if (!canvas || !job) return;
    const size = Math.max(200, Math.round((canvas.clientWidth || 300) * Math.min(2, devicePixelRatio || 1) * 0.6));
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d');
    const r = job.results.sdf;
    g.fillStyle = '#0d0d0f'; g.fillRect(0, 0, size, size);
    if (!r) { g.fillStyle = '#666'; g.font = `${size / 20}px DM Sans, sans-serif`; g.textAlign = 'center'; g.fillText('Bake the distance field to see a slice', size / 2, size / 2); return; }
    const { values, dims: n, origin, voxel, band } = r, v = job.sdfView;
    const span = (n - 1) * voxel;
    const at = (a, b, c) => values[a + n * (b + n * c)];
    const sample = (x, y, z) => {
      const gx = (x - origin[0]) / voxel, gy = (y - origin[1]) / voxel, gz = (z - origin[2]) / voxel;
      const i = Math.max(0, Math.min(n - 2, Math.floor(gx))), j = Math.max(0, Math.min(n - 2, Math.floor(gy))), k = Math.max(0, Math.min(n - 2, Math.floor(gz)));
      const fx = Math.min(1, Math.max(0, gx - i)), fy = Math.min(1, Math.max(0, gy - j)), fz = Math.min(1, Math.max(0, gz - k));
      const c00 = at(i, j, k) * (1 - fx) + at(i + 1, j, k) * fx, c10 = at(i, j + 1, k) * (1 - fx) + at(i + 1, j + 1, k) * fx;
      const c01 = at(i, j, k + 1) * (1 - fx) + at(i + 1, j, k + 1) * fx, c11 = at(i, j + 1, k + 1) * (1 - fx) + at(i + 1, j + 1, k + 1) * fx;
      return (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz - v.iso;
    };
    const img = g.createImageData(size, size);
    const axes = v.axis === 0 ? [2, 1] : v.axis === 1 ? [0, 2] : [0, 1];
    for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
      const p = [0, 0, 0];
      p[v.axis] = origin[v.axis] + span * v.slice;
      p[axes[0]] = origin[axes[0]] + ((px + 0.5) / size) * span;
      p[axes[1]] = origin[axes[1]] + (1 - (py + 0.5) / size) * span;
      const d = sample(p[0], p[1], p[2]), t = Math.max(-1, Math.min(1, d / band));
      let c = t < 0 ? [255, 200 + 55 * t, 92 + 46 * t] : [77 - 57 * t, 179 - 138 * t, 217 - 125 * t];
      if (t < 0) c = [255 + 38 * t, 200 + 123 * t, 92 + 46 * t];
      const contour = Math.abs(((d / (band * 0.25)) % 1 + 1) % 1 - 0.5) < 0.06;
      if (contour) c = c.map((x) => x * 0.6);
      if (Math.abs(d) < voxel * 0.5) c = [255, 255, 255];
      const o = (py * size + px) * 4;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    g.fillStyle = '#ffffffaa'; g.font = `${Math.round(size / 24)}px ui-monospace, monospace`;
    g.fillText(`${'XYZ'[v.axis]} = ${(origin[v.axis] + span * v.slice).toFixed(3)}`, 8, size - 10);
  }

  // -------------------------------------------------------------------------------------------- log
  function log(text, kind = '') {
    if (!job) return;
    job.log.push({ text: `${new Date().toLocaleTimeString()}  ${text}`, kind });
    renderLog();
  }
  function renderLog() {
    const el = $('CompileLog'); if (!el || !job) return;
    el.innerHTML = job.log.map((l) => `<div class="${l.kind}">${l.text.replace(/</g, '&lt;')}</div>`).join('');
    el.scrollTop = el.scrollHeight;
  }

  return { open, close, isOpen: () => !!job };
}

function dims(b) {
  const d = b.hi.map((h, k) => h - b.lo[k]);
  return d.map((x) => (x >= 10 ? x.toFixed(1) : x.toFixed(2))).join(' × ');
}
function niceCell(radius) {
  const raw = radius / 4, p = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 5, 10].map((m) => m * p).find((x) => x >= raw) || raw;
}
