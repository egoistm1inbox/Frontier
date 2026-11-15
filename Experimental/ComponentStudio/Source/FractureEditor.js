// Fracture Editor — the per-object fracture window, redesigned in the Project Zero language.
// Same flow as Project Zero (Frontier-OLD arena/bc062d35): an object's Fracture card (here: the Component Viewer's
// Details panel) enables fracture and picks Dynamic / Baked; "Edit … fracture ↗" opens this window for that object.
// Left: fracture targets (class components + specimens + recipe presets). Centre: preview, separation, receipt metrics.
// Right: the recipe — Material, Impact, Fragment quality, Bake, Geometry receipt. The preview engine is
// FractureEngine.js; the window does not simulate anything (separation is an inspection aid, not physics).
import { Viewport, LineBuilder } from './Renderer.js';
import { invert } from './MathUtils.js';
import { triangleColors, hueColor } from './MeshData.js';
import { formatCount } from './Compile.js';
import { $, h, heading, panel, note, segmented, tile, vecRow, rows, prop, toast, hydrate, bindDrawers, setFill, download, cardHead } from './Kit.js';
import * as F from './FractureEngine.js';

const SPECIMEN_KEY = 'frontier.componentStudio.fracture.v1';
const PRESETS = [
  { id: 'shatter', label: 'Shatter', icon: 'pane', note: 'Glass · 20 kJ · up to 96 pieces', recipe: { Material: 'glass', Energy: 20000, Ceiling: 96, MinimumSize: 0.02 } },
  { id: 'crumble', label: 'Crumble', icon: 'rock', note: 'Concrete · 6 kJ · up to 64 pieces', recipe: { Material: 'concrete', Energy: 6000, Ceiling: 64, MinimumSize: 0.04 } },
  { id: 'splinter', label: 'Splinter', icon: 'beam', note: 'Wood · 9 kJ · up to 32 pieces', recipe: { Material: 'wood', Energy: 9000, Ceiling: 32, MinimumSize: 0.03 } },
  { id: 'dice', label: 'Dice', icon: 'dice', note: 'Tempered glass · 160 pieces', recipe: { Material: 'tempered', Energy: 2500, Ceiling: 160, MinimumSize: 0.02 } },
];
const MODES = ['source', 'pieces', 'material', 'size', 'priority'];
const RAMP = ['#306bf2', '#29c7c2', '#59d15c', '#f7cc40', '#f04d3d'].map(hexLinear);
const RAMP_CSS = 'linear-gradient(90deg,#306bf2,#29c7c2,#59d15c,#f7cc40,#f04d3d)';

function hexLinear(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.pow(c / 255, 2.2)); }
const intLinear = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.pow(c / 255, 2.2));
const intHex = (n) => '#' + n.toString(16).padStart(6, '0');
function ramp(t) { t = Math.max(0, Math.min(1, t)) * (RAMP.length - 1); const i = Math.min(RAMP.length - 2, Math.floor(t)), f = t - i; return RAMP[i].map((v, k) => v + (RAMP[i + 1][k] - v) * f); }
const fmtVol = (v) => (v >= 0.01 ? `${v.toFixed(4)} m³` : v >= 1e-5 ? `${(v * 1e3).toFixed(2)} L` : `${(v * 1e6).toFixed(1)} cm³`);
const fmtArea = (a) => (a >= 0.01 ? `${a.toFixed(3)} m²` : `${(a * 1e4).toFixed(1)} cm²`);
const fmtBytes = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MiB` : `${(b / 1024).toFixed(1)} KiB`);
const fmtMass = (m) => (m >= 10 ? `${m.toFixed(0)} kg` : m >= 0.1 ? `${m.toFixed(2)} kg` : `${(m * 1000).toFixed(0)} g`);

export function createFractureEditor({ library, viewer }) {
  let viewport = null, drawers = null, timer = 0, anim = 0;
  const sources = new Map();
  const S = {
    target: null, source: null, recipe: null, savedJson: '', result: null, mode: 'pieces', wire: false, grid: true, seeds: true,
    impactTool: false, separation: 0.18, shown: 0.18, selected: -1, cam: 'persp', search: '', sort: 'priority', logLines: [],
  };
  const gpu = { pieces: [], source: null };
  const live = {}; // inspector nodes refreshed after every solve without rebuilding the panel

  // -------------------------------------------------------------------------------------------- targets
  const specimenStore = () => { try { return JSON.parse(localStorage.getItem(SPECIMEN_KEY)) || {}; } catch { return {}; } };
  function componentTargets() {
    return viewer.fractureTargets().map((c) => ({ key: 'component:' + c.id, kind: 'component', id: c.id, name: c.name, meshId: c.meshId, record: library.get(c.meshId), recipe: F.normalizeRecipe(c.recipe || {}) }));
  }
  function specimenTargets() {
    const store = specimenStore();
    return F.SPECIMENS.map((sp) => ({ key: 'specimen:' + sp.id, kind: 'specimen', id: sp.id, name: sp.label, note: sp.note, icon: sp.icon, recipe: F.normalizeRecipe(store[sp.id] || { Enabled: true }) }));
  }
  const allTargets = () => [...componentTargets(), ...specimenTargets()];
  function sourceFor(t) {
    const key = t.kind === 'specimen' ? 'specimen:' + t.id : t.record ? `mesh:${t.record.id}:${t.record.compiledAt}` : null;
    if (!key) return null;
    if (!sources.has(key)) sources.set(key, t.kind === 'specimen' ? F.specimenSource(t.id) : F.meshSource(t.record));
    return sources.get(key);
  }
  const dirty = () => !!S.recipe && JSON.stringify(S.recipe) !== S.savedJson;
  const R = () => S.recipe;

  // -------------------------------------------------------------------------------------------- open / close
  function open(key) {
    const t = allTargets().find((x) => x.key === key) || allTargets().find((x) => x.key === 'component:' + key || x.key === 'specimen:' + key);
    if (!t) { toast(`No fracture target "${key}"`); return; }
    if ($('Fracture').hidden === false && S.target && S.target.key !== t.key && dirty() && !confirm(`Discard unsaved fracture changes to ${S.target.name}?`)) return;
    $('Fracture').hidden = false;
    ensureViewport();
    S.target = t; S.source = sourceFor(t); S.recipe = { ...t.recipe };
    if (!S.recipe.EditedAt && S.source) { const p = F.defaultImpact(S.source); S.recipe.X = +p[0].toFixed(3); S.recipe.Y = +p[1].toFixed(3); S.recipe.Z = +p[2].toFixed(3); }
    S.savedJson = JSON.stringify(S.recipe);
    S.selected = -1; S.shown = S.recipe.Enabled ? S.separation : 0; S.logLines = [];
    log(`open    ${t.name} · ${t.kind === 'component' ? `${viewer.className()} component` : 'specimen'} · ${S.source ? (S.source.kind === 'convex' ? 'closed convex source' : 'open surface source') : 'missing mesh'}`, 'dim');
    if (S.source) { viewport.settings.groundLevel = S.source.bounds.lo[1]; cameraPreset(S.cam, true); }
    solve(true);
    renderAll();
  }
  function close(force = false) {
    if (!force && dirty() && !confirm(`Close the Fracture Editor and discard unsaved changes to ${S.target?.name}?`)) return;
    $('Fracture').hidden = true; drawers?.close();
  }

  // -------------------------------------------------------------------------------------------- solve
  function change(key, value, { rebuild = false, immediate = false } = {}) {
    S.recipe[key] = value;
    if (key === 'Enabled') { S.shown = value ? S.separation : 0; }
    schedule(immediate);
    if (rebuild) renderInspector(); else refreshLive();
    renderChrome();
  }
  function schedule(immediate) { clearTimeout(timer); if (immediate) solve(); else timer = setTimeout(() => solve(), 70); }
  function solve(silent = false) {
    if (!S.source) { S.result = null; upload(); renderChrome(); return; }
    if (!R().Enabled) { S.result = null; upload(); refreshLive(); renderChrome(); return; }
    S.result = F.fracture(S.source, R());
    if (S.selected >= S.result.pieces.length) S.selected = -1;
    if (!silent) S.result.log.forEach((l) => log(l, /refused|needles/.test(l) ? 'warn' : 'ok'));
    else S.result.log.forEach((l) => log(l, 'dim'));
    upload(); refreshLive(); renderChrome();
  }

  // -------------------------------------------------------------------------------------------- viewport
  function ensureViewport() {
    if (viewport) return;
    viewport = new Viewport($('FractureCanvas'), { onPick: (id, e) => onPick(id, e) });
    viewport.settings.cell = 0.25;
    drawers = bindDrawers($('Fracture'));
    $('FragmentDrawer').addEventListener('drawer-open', renderTable);
    $('FractureLogDrawer').addEventListener('drawer-open', renderLog);
    $('FractureCanvas').addEventListener('dblclick', (e) => placeImpact(e));
    bindChrome();
  }
  function onPick(id, e) {
    if (S.impactTool || e.altKey) { placeImpact(e); return; }
    S.selected = id === null || id === undefined ? -1 : id;
    applyObjects(); drawLines(); readout();
    if ($('FragmentDrawer').classList.contains('open')) renderTable();
    refreshLive();
  }
  function rayFromEvent(e) {
    const c = $('FractureCanvas'), r = c.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1, y = 1 - ((e.clientY - r.top) / r.height) * 2;
    const inv = invert(viewport.matrices(r.width / r.height).viewProj);
    const un = (z) => { const v = [0, 1, 2, 3].map((i) => inv[i] * x + inv[4 + i] * y + inv[8 + i] * z + inv[12 + i]); return [v[0] / v[3], v[1] / v[3], v[2] / v[3]]; };
    const a = un(-1), b = un(1), d = b.map((v, k) => v - a[k]), l = Math.hypot(...d);
    return { origin: a, dir: d.map((v) => v / l) };
  }
  function placeImpact(e) {
    if (!S.source || !R().Enabled) return;
    const { origin, dir } = rayFromEvent(e);
    const hit = F.raySource(S.source, origin, dir);
    if (!hit) { toast('Click on the source surface to place the impact'); return; }
    S.recipe.X = +hit[0].toFixed(3); S.recipe.Y = +hit[1].toFixed(3); S.recipe.Z = +hit[2].toFixed(3);
    log(`impact  placed at ${hit.map((v) => v.toFixed(3)).join(', ')} m (local)`, 'ok');
    if (S.impactTool) setImpactTool(false);
    solve(); renderInspector(); renderChrome();
  }
  function setImpactTool(on) { S.impactTool = on; $('FractureImpactTool').classList.toggle('active', on); $('FractureCanvas').style.cursor = on ? 'crosshair' : ''; }

  function upload() {
    gpu.pieces.forEach((m) => viewport.deleteMesh(m)); gpu.pieces = [];
    viewport.deleteMesh(gpu.source); gpu.source = null;
    const src = S.source; if (!src) { viewport.setObjects([]); drawLines(); readout(); return; }
    const m = F.MATERIALS[R().Material];
    // Source (also drawn when fracture is off).
    if (src.kind === 'convex') {
      const n = src.positions.length / 3, colors = new Float32Array((n / 3) * 4), base = intLinear(m.color);
      for (let t = 0; t < n / 3; t++) colors.set([...base, 0], t * 4);
      gpu.source = viewport.createMesh({ positions: src.positions, indices: seq(n), cornerNormals: src.normals, colors });
    } else {
      const r = src.record;
      gpu.source = viewport.createMesh({ positions: r.positions, indices: r.indices, cornerNormals: r.cornerNormals, colors: triangleColors(r.families, r.slots) });
    }
    const res = S.result;
    if (res) {
      const vols = res.pieces.map((p) => (src.kind === 'convex' ? p.volume : p.area)), lo = Math.log10(Math.min(...vols)), hi = Math.log10(Math.max(...vols));
      const outer = intLinear(m.color), inner = intLinear(m.interior);
      res.pieces.forEach((pc, i) => {
        const tris = pc.tris, debug = new Float32Array(tris * 3), colors = new Float32Array(tris * 4);
        let base;
        if (S.mode === 'size') base = ramp(hi > lo ? (Math.log10(vols[i]) - lo) / (hi - lo) : 0.5);
        else if (S.mode === 'priority') base = ramp(pc.priority);
        else base = hueColor(i, 0.5, 0.58);
        for (let t = 0; t < tris; t++) {
          const cut = pc.cut[t], k = cut ? 0.55 : 1;
          debug[t * 3] = base[0] * k; debug[t * 3 + 1] = base[1] * k; debug[t * 3 + 2] = base[2] * k;
          const c = cut ? inner : outer; colors[t * 4] = c[0]; colors[t * 4 + 1] = c[1]; colors[t * 4 + 2] = c[2];
        }
        gpu.pieces.push(viewport.createMesh({ positions: pc.positions, indices: seq(tris * 3), cornerNormals: pc.normals, colors, debug }));
      });
    }
    applyObjects(); drawLines(); readout(); legend();
  }
  const seqCache = new Map();
  function seq(n) { if (!seqCache.has(n)) seqCache.set(n, Uint32Array.from({ length: n }, (_, i) => i)); return seqCache.get(n); }

  function offsetOf(pc) {
    const src = S.source, B = src.bounds, size = Math.max(...B.size), imp = S.result.impact;
    const o = B.centre.map((v, k) => v + (imp[k] - v) * 0.4), d = pc.centre.map((v, k) => v - o[k]), l = Math.hypot(...d) || 1;
    const mag = S.shown * size * (0.3 + 0.7 * pc.priority);
    return d.map((v) => (v / l) * mag);
  }
  const translate = (t) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1]);
  function applyObjects() {
    if (!viewport) return;
    const showSource = S.mode === 'source' || !S.result;
    if (showSource) viewport.setObjects(gpu.source ? [{ mesh: gpu.source, mode: 'lit' }] : []);
    else viewport.setObjects(S.result.pieces.map((pc, i) => ({ mesh: gpu.pieces[i], mode: S.mode === 'material' ? 'lit' : 'debug', matrix: translate(offsetOf(pc)), pickId: i, selected: i === S.selected })));
    viewport.settings.wire = S.wire; viewport.settings.grid = S.grid; viewport.dirty = true;
  }
  function drawLines() {
    if (!viewport) return;
    const src = S.source, res = S.result;
    if (!src) { viewport.setLines('fx-impact', null); viewport.setLines('fx-seeds', null); return; }
    const size = Math.max(...src.bounds.size), L = new LineBuilder(), Ls = new LineBuilder();
    if (R().Enabled) {
      const p = [R().X, R().Y, R().Z], r = size * 0.035, amber = [1, 0.7, 0.22, 1];
      L.circle(p, r, 'x', amber, 24).circle(p, r, 'y', amber, 24).circle(p, r, 'z', amber, 24);
      const c = src.bounds.centre, n = p.map((v, k) => v - c[k]), nl = Math.hypot(...n) || 1;
      L.arrow(p.map((v, k) => v + (n[k] / nl) * size * 0.42), p.map((v, k) => v + (n[k] / nl) * r * 1.2), amber);
      if (res) { const f = res.plan.falloff; L.circle(p, f, 'y', [1, 0.7, 0.22, 0.32], 64); L.circle(p, f * 0.5, 'y', [1, 0.7, 0.22, 0.18], 48); }
    }
    if (res && S.seeds) {
      const s = size * 0.012, teal = [0.22, 0.82, 0.77, 0.95];
      res.pieces.forEach((pc) => {
        const o = S.mode === 'source' ? [0, 0, 0] : offsetOf(pc), q = pc.seedPoint.map((v, k) => v + o[k]);
        for (let k = 0; k < 3; k++) { const a = q.slice(), b = q.slice(); a[k] -= s; b[k] += s; Ls.line(a, b, teal); }
      });
    }
    if (res && S.selected >= 0 && S.mode !== 'source') {
      const pc = res.pieces[S.selected], o = offsetOf(pc);
      L.box(pc.bounds.lo.map((v, k) => v + o[k]), pc.bounds.hi.map((v, k) => v + o[k]), [1, 0.7, 0.22, 0.9]);
    }
    if (S.mode === 'source' || !res) L.box(src.bounds.lo, src.bounds.hi, [1, 1, 1, 0.12]);
    viewport.setLines('fx-impact', L.build(), { depth: false });
    viewport.setLines('fx-seeds', Ls.build(), { depth: true });
  }
  function cameraPreset(p, refit = false) {
    S.cam = p;
    document.querySelectorAll('#FractureCams button').forEach((b) => b.classList.toggle('active', b.dataset.fcam === p));
    const c = viewport.camera, A = { persp: [0.62, 0.36], front: [0, 0.02], side: [Math.PI / 2, 0.02], top: [0, 1.44] }[p];
    c.yaw = A[0]; c.pitch = A[1];
    if (refit || S.source) fit();
  }
  function fit() {
    if (!S.source) return;
    const B = S.source.bounds, size = Math.max(...B.size), grow = 1 + S.shown * 1.2;
    viewport.frame({ centre: B.centre, radius: (Math.hypot(...B.size) / 2) * grow + size * 0.04 }, { keepAngles: true });
  }

  // -------------------------------------------------------------------------------------------- separation animation
  function animateTo(target) {
    cancelAnimationFrame(anim);
    const from = S.shown, t0 = performance.now(), dur = 520;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      S.shown = from + (target - from) * e; syncSeparation(); applyObjects(); drawLines();
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }
  function syncSeparation() {
    const v = Math.round(S.shown * 100);
    $('FractureSep').value = v; $('FractureSepNumber').value = v; setFill($('FractureSep'));
  }
  function runFracture() {
    if (!R().Enabled) { change('Enabled', true, { rebuild: true, immediate: true }); }
    if (S.mode === 'source') setMode('pieces');
    S.shown = 0; applyObjects();
    animateTo(Math.max(0.12, S.separation));
  }

  // -------------------------------------------------------------------------------------------- chrome
  function bindChrome() {
    document.querySelectorAll('#FractureModes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.fmode)));
    document.querySelectorAll('#FractureCams button').forEach((b) => b.addEventListener('click', () => cameraPreset(b.dataset.fcam)));
    $('FractureImpactTool').addEventListener('click', () => setImpactTool(!S.impactTool));
    const toggle = (id, key, after) => $(id).addEventListener('click', () => { S[key] = !S[key]; $(id).classList.toggle('active', S[key]); after?.(); });
    toggle('FractureSeeds', 'seeds', drawLines);
    toggle('FractureWire', 'wire', applyObjects);
    toggle('FractureGrid', 'grid', applyObjects);
    $('FractureFit').addEventListener('click', fit);
    const sep = (v) => { S.separation = S.shown = Math.max(0, Math.min(1, v / 100)); syncSeparation(); applyObjects(); drawLines(); };
    $('FractureSep').addEventListener('input', () => sep(+$('FractureSep').value));
    $('FractureSepNumber').addEventListener('change', () => sep(+$('FractureSepNumber').value));
    $('FractureAssemble').addEventListener('click', () => animateTo(0));
    $('FractureRun').addEventListener('click', runFracture);
    $('FractureClose').addEventListener('click', () => close());
    $('FractureRevert').addEventListener('click', () => { if (!dirty()) return; S.recipe = JSON.parse(S.savedJson); log('revert  recipe restored to the saved version', 'warn'); solve(); renderAll(); });
    $('FractureSave').addEventListener('click', save);
    $('FractureExport').addEventListener('click', exportRecipe);
    $('FractureSearch').addEventListener('input', (e) => { S.search = e.target.value; renderTargets(); });
    document.addEventListener('keydown', (e) => {
      if ($('Fracture').hidden || e.target.closest('input, select, textarea')) return;
      const k = e.key.toLowerCase();
      if (e.key === 'Escape') { if (S.impactTool) setImpactTool(false); else close(); }
      else if (k === 'i') setImpactTool(!S.impactTool);
      else if (k === 'f') fit();
      else if (k === 'z') $('FractureWire').click();
      else if (k === 'g') $('FractureGrid').click();
      else if (k === 's' && !e.ctrlKey && !e.metaKey) $('FractureSeeds').click();
      else if (k === 'r') animateTo(0);
      else if (e.key === ' ') { e.preventDefault(); runFracture(); }
      else if (e.key >= '1' && e.key <= '5') setMode(MODES[+e.key - 1]);
      else return;
    });
    document.addEventListener('keydown', (e) => { if (!$('Fracture').hidden && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } });
  }
  function setMode(m) {
    S.mode = m;
    document.querySelectorAll('#FractureModes button').forEach((b) => b.classList.toggle('active', b.dataset.fmode === m));
    upload();
  }

  function renderAll() { renderTargets(); renderInspector(); renderChrome(); syncSeparation(); hydrate($('Fracture')); }

  function stateOf(t, recipe) {
    const r = recipe || t.recipe;
    if (!r.Enabled) return ['OFF', ''];
    if (r.Mode === 'baked') { const src = sourceFor(t); return r.Baked && src && r.Baked.signature === F.signature(src, r) ? ['BAKED', 'baked'] : ['STALE', 'stale']; }
    return ['DYNAMIC', 'dyn'];
  }
  function renderTargets() {
    const q = S.search.trim().toLowerCase();
    const comp = componentTargets(), spec = specimenTargets();
    const row = (t) => {
      const current = S.target && S.target.key === t.key, r = current ? S.recipe : t.recipe;
      const [label, cls] = stateOf(t, r);
      const glyph = t.kind === 'component' && t.record?.icon ? h('img', { class: 'thumb', src: t.record.icon, alt: '' }) : h('span', { class: 'glyph', dataset: { icon: t.kind === 'component' ? 'mesh' : t.icon, size: '17', accent: 'teal' } });
      const sub = r.Enabled ? `${F.MATERIALS[r.Material].label} · ${formatCount(r.Energy)} J · ≤ ${r.Ceiling} pcs` : t.kind === 'component' ? (t.record ? t.record.name : 'Missing mesh') : t.note;
      const b = h('button', { class: 'tree-row' + (current ? ' active' : ''), dataset: { key: t.key } }, h('span', { class: 'caret leaf' }), glyph, h('div', {}, h('b', {}, t.name), h('small', {}, sub)),
        h('span', { class: 'tag' }, current && dirty() ? h('span', { class: 'state-pill unsaved' }, 'EDITED') : h('span', { class: 'state-pill ' + cls }, label)));
      b.addEventListener('click', () => open(t.key));
      return b;
    };
    const fill = (host, list) => { host.textContent = ''; list.filter((t) => !q || t.name.toLowerCase().includes(q)).forEach((t) => host.append(row(t))); };
    fill($('FractureComponents'), comp); fill($('FractureSpecimens'), spec);
    $('FractureComponentCount').textContent = comp.length; $('FractureSpecimenCount').textContent = spec.length;
    $('FractureStatEnabled').innerHTML = `${[...comp, ...spec].filter((t) => (S.target?.key === t.key ? S.recipe : t.recipe).Enabled).length}<i>/ ${comp.length + spec.length}</i>`;
    const presets = $('FracturePresets'); presets.textContent = '';
    PRESETS.forEach((p) => {
      const b = h('button', { class: 'preset-row', title: 'Apply to the current recipe (impact and seed are kept)' }, h('span', { class: 'glyph', dataset: { icon: p.icon, size: '17', accent: 'teal' } }), h('div', {}, h('b', {}, p.label), h('small', {}, p.note)), h('span', { class: 'apply' }, 'APPLY'));
      b.addEventListener('click', () => { Object.assign(S.recipe, p.recipe, { Enabled: true }); log(`preset  ${p.label} applied (${p.note})`, 'ok'); S.shown = S.separation; solve(); renderAll(); });
      presets.append(b);
    });
    hydrate($('Fracture').querySelector('.dock.left'));
  }

  function renderChrome() {
    const t = S.target; if (!t) return;
    const r = R(), res = S.result, src = S.source, m = F.MATERIALS[r.Material];
    const [label, cls] = stateOf(t, r);
    const tag = $('FractureState'); tag.textContent = label; tag.className = 'state-tag ' + ({ dyn: 'teal', baked: 'mint', stale: 'stale' }[cls] || 'off');
    $('FractureTab').textContent = `${t.name} · Fracture`;
    $('FractureTitle').textContent = `${t.name}`;
    $('FractureNote').textContent = t.kind === 'component' ? `${viewer.className()} · ${t.record ? t.record.name : 'missing mesh'} · ${src ? (src.kind === 'convex' ? 'closed source' : `open surface · ${formatCount(t.record.triangles)} tris`) : ''}` : `Specimen · ${t.note} · ${src ? fmtVol(src.volume) : ''}`;
    $('FractureClass').textContent = `${viewer.className()} · ${t.name}`;
    const owner = $('FractureOwner'); owner.textContent = '';
    owner.append(h('span', { class: 'ext teal' }, t.kind === 'component' && t.record?.icon ? h('img', { src: t.record.icon, alt: '' }) : h('span', { dataset: { icon: t.kind === 'component' ? 'mesh' : t.icon, size: '20' } })),
      h('div', {}, h('b', {}, t.kind === 'component' ? `${t.name} · ${t.record ? t.record.name : 'missing'}` : `${t.name} specimen`), h('small', {}, src ? `${src.kind === 'convex' ? 'Analytical convex' : 'Compiled mesh · surface'} · ${src.bounds.size.map((v) => v.toFixed(2)).join(' × ')} m` : 'Source mesh not in Content')));
    $('FractureOwnerId').textContent = t.kind === 'component' ? t.id : t.id;
    $('FractureStorage').textContent = t.kind === 'component' ? 'Class' : 'Browser';
    const saved = $('FractureSaved'); saved.textContent = dirty() ? 'UNSAVED' : 'SAVED'; saved.style.color = dirty() ? '#e8c063' : '';
    $('FractureStatPieces').textContent = res ? String(res.metrics.pieces) : r.Enabled ? '—' : '1';
    const go = $('FractureSave');
    go.textContent = t.kind === 'component' ? `Save fracture to ${t.name}` : `Save ${t.name} specimen recipe`;
    go.classList.toggle('dirty', dirty()); $('FractureRevert').disabled = !dirty();
    // Off card / banner
    const off = $('FractureOff');
    off.hidden = !(src && !r.Enabled);
    if (!off.hidden) {
      off.textContent = '';
      const b = h('button', { class: 'mint-btn' }, h('span', { dataset: { icon: 'fracture', size: '15' } }), 'Enable fracture');
      b.addEventListener('click', () => change('Enabled', true, { rebuild: true, immediate: true }));
      off.append(h('span', { dataset: { icon: 'fracture', size: '28', accent: 'teal' } }), h('b', {}, `${t.name} stays whole`), h('p', {}, 'Fracture is off for this object. Enable it to author a per-object recipe — material, impact, quality limits and bake mode.'), b);
      hydrate(off);
    }
    if (!src) { off.hidden = false; off.innerHTML = `<b>Source mesh missing</b><p>${t.name} references a mesh that is not in Content. Re-import it through Geometry Compile.</p>`; }
    const banner = $('FractureBanner');
    banner.hidden = !(src && src.kind === 'mesh' && r.Enabled);
    if (!banner.hidden) banner.innerHTML = `<b>Surface preview</b> · ${t.record.name} is ${src.closed ? 'closed but not convex' : 'an open shell'}, so pieces are surface patches split at Voronoi borders. Closed caps need convex decomposition — pending in the native bake.`;
    // Metrics strip
    const M = $('FractureMetrics'); M.textContent = '';
    const cell = (value, label, cls = '') => h('div', { class: cls }, h('b', { html: value }), h('span', {}, label));
    if (res) {
      const mt = res.metrics;
      M.append(cell(String(mt.pieces), 'FRAGMENTS'),
        cell(mt.occupied !== null ? `${mt.occupied.toFixed(3)}<small>%</small>` : '—', mt.occupied !== null ? 'OCCUPIED VOLUME' : 'VOLUME · SURFACE ONLY', mt.occupied !== null && Math.abs(mt.occupied - 100) < 0.01 ? 'ok' : ''),
        cell(mt.minQ !== null ? mt.minQ.toFixed(3) : '—', 'MIN TRIANGLE QUALITY', mt.minQ !== null && mt.minQ < 0.01 ? 'warn' : ''),
        cell(mt.closed ? 'Closed' : src.kind === 'mesh' ? 'Open' : 'Uncapped', 'TOPOLOGY', mt.closed ? 'ok' : 'warn'));
    } else M.append(cell('1', 'FRAGMENTS'), cell(src && src.kind === 'convex' ? '100.000<small>%</small>' : '—', 'OCCUPIED VOLUME'), cell('—', 'MIN TRIANGLE QUALITY'), cell(src ? (src.kind === 'convex' ? 'Closed' : 'Open') : '—', 'TOPOLOGY'));
    $('FractureStrip').textContent = res ? `${res.metrics.pieces} PIECES · ${formatCount(res.metrics.tris)} TRIS · SOLVED IN ${res.ms.toFixed(0)} MS · ${m.label.toUpperCase()} · SEED ${r.Seed}` : r.Enabled ? '—' : 'FRACTURE OFF · SOURCE ONLY';
    $('FractureRun').disabled = !src;
    renderTargets();
    readout();
  }
  function readout() {
    const t = S.target, src = S.source, res = S.result, r = R(); if (!t) return;
    const lines = [
      `target    ${t.name} · ${t.kind === 'component' ? 'StaticMeshComponent' : 'specimen'}`,
      `source    ${src ? (src.kind === 'convex' ? `analytical ${t.id} · ${fmtVol(src.volume)}` : `${t.record.name} · ${formatCount(t.record.triangles)} tris`) : 'missing'}`,
      `recipe    ${F.MATERIALS[r.Material].label} · ${formatCount(r.Energy)} J · seed ${r.Seed}${r.Enabled ? '' : ' · off'}`,
    ];
    if (res) {
      lines.push(`pieces    ${res.metrics.pieces} of ${res.plan.requested} requested · ceiling ${r.Ceiling}`);
      lines.push(`refused   ${res.stats.refusedSpan} span · ${res.stats.refusedNeedle} needle`);
      lines.push(`solve     ${res.ms.toFixed(0)} ms`);
      if (S.selected >= 0) { const pc = res.pieces[S.selected]; lines.push(`selected  #${pc.id} · ${src.kind === 'convex' ? fmtVol(pc.volume) : fmtArea(pc.area)} · ${fmtMass(pc.mass)} · priority ${pc.priority.toFixed(2)}`); }
    }
    $('FractureReadout').textContent = lines.join('\n');
  }
  function legend() {
    const L = $('FractureLegend'), res = S.result, src = S.source; let html = '';
    if (!res || S.mode === 'source') html = `<b>SOURCE</b><div style="margin-top:4px">Undivided geometry${res ? ' · seeds in teal' : ''}</div>`;
    else if (S.mode === 'pieces') html = `<b>PIECES · ${res.pieces.length}</b><div style="margin-top:4px">One hue per fragment · cut faces darker</div>`;
    else if (S.mode === 'material') { const m = F.MATERIALS[R().Material]; html = `<b>${m.label.toUpperCase()}</b><div style="margin-top:6px;display:flex;gap:10px;justify-content:flex-end"><span><i style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${intHex(m.color)};margin-right:5px"></i>Surface</span><span><i style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${intHex(m.interior)};margin-right:5px"></i>Fracture faces</span></div>`; }
    else if (S.mode === 'size') { const v = res.pieces.map((p) => (src.kind === 'convex' ? p.volume : p.area)); const f = src.kind === 'convex' ? fmtVol : fmtArea; html = `<b>${src.kind === 'convex' ? 'PIECE VOLUME' : 'PATCH AREA'} · LOG</b><div class="ramp" style="background:${RAMP_CSS}"></div><div class="ends"><span>${f(Math.min(...v))}</span><span>${f(Math.max(...v))}</span></div>`; }
    else html = `<b>CUT PRIORITY</b><div class="ramp" style="background:${RAMP_CSS}"></div><div class="ends"><span>FAR</span><span>AT IMPACT</span></div>`;
    L.hidden = !src; L.innerHTML = html;
  }
  function log(text, cls = '') { S.logLines.push([new Date().toLocaleTimeString(), text, cls]); if (S.logLines.length > 120) S.logLines.shift(); if ($('FractureLogDrawer').classList.contains('open')) renderLog(); }
  function renderLog() { const host = $('FractureLog'); host.innerHTML = S.logLines.map(([time, t, c]) => `<div class="${c}"><span class="dim">${time}</span>  ${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`).join(''); host.scrollTop = host.scrollHeight; }

  function renderTable() {
    const host = $('FragmentTable'), res = S.result, src = S.source; host.textContent = '';
    if (!res) { $('FragmentSummary').textContent = 'Fracture is off'; return; }
    const convex = src.kind === 'convex';
    const cols = [['#', 'id'], [convex ? 'VOLUME' : 'AREA', 'size'], ['MASS', 'mass'], ['FACES · CUT', 'faces'], ['SPAN', 'span'], ['MIN Q', 'minQ'], ['DIST.', 'distance'], ['PRIORITY', 'priority']];
    const key = { id: (p) => p.id, size: (p) => (convex ? p.volume : p.area), mass: (p) => p.mass, faces: (p) => p.faces, span: (p) => p.span, minQ: (p) => p.minQ, distance: (p) => p.distance, priority: (p) => p.priority }[S.sort];
    const list = [...res.pieces].sort((a, b) => (S.sort === 'id' || S.sort === 'distance' ? key(a) - key(b) : key(b) - key(a)));
    const maxSize = Math.max(...res.pieces.map((p) => (convex ? p.volume : p.area)));
    const table = h('table', {}, h('thead', {}, h('tr', {}, ...cols.map(([label, k]) => { const th = h('th', { class: S.sort === k ? 'sorted' : null }, label); th.addEventListener('click', () => { S.sort = k; renderTable(); }); return th; }))));
    const body = h('tbody');
    list.forEach((p) => {
      const c = hueColor(p.id, 0.5, 0.58).map((v) => Math.round(Math.pow(v, 1 / 2.2) * 255));
      const sz = convex ? p.volume : p.area;
      const tr = h('tr', { class: p.id === S.selected ? 'active' : null },
        h('td', {}, h('i', { style: { background: `rgb(${c.join(',')})` } }), `#${p.id}`),
        h('td', {}, h('span', { class: 'bar', style: { width: Math.max(2, (sz / maxSize) * 46) + 'px' } }), convex ? fmtVol(sz) : fmtArea(sz)),
        h('td', {}, fmtMass(p.mass)), h('td', {}, convex ? `${p.faces} · ${p.cutFaces}` : `${p.faces} tris`), h('td', {}, Number.isFinite(p.span) ? `${(p.span * 1000).toFixed(0)} mm` : '—'),
        h('td', {}, convex ? p.minQ.toFixed(3) : '—'), h('td', {}, `${p.distance.toFixed(2)} m`), h('td', {}, p.priority.toFixed(2)));
      tr.addEventListener('click', () => { S.selected = p.id === S.selected ? -1 : p.id; applyObjects(); drawLines(); readout(); renderTable(); refreshLive(); });
      body.append(tr);
    });
    table.append(body); host.append(table);
    $('FragmentSummary').textContent = `${res.pieces.length} ${convex ? 'closed cells' : 'surface patches'} · total ${fmtMass(res.pieces.reduce((a, p) => a + p.mass, 0))} · click a row to select · click a header to sort`;
  }

  // -------------------------------------------------------------------------------------------- inspector
  function renderInspector() {
    const host = $('FractureInspector'), t = S.target, r = R(), src = S.source; host.textContent = '';
    if (!t) return;
    const m = F.MATERIALS[r.Material];
    const sw = h('button', { class: 'big-switch' + (r.Enabled ? ' on' : ''), role: 'switch', 'aria-checked': String(r.Enabled), 'aria-label': 'Enable fracture', title: 'Enable fracture' });
    sw.addEventListener('click', () => change('Enabled', !r.Enabled, { rebuild: true, immediate: true }));
    host.append(
      h('div', { class: 'crumbs' }, 'Fracture', h('i', {}, '/'), t.kind === 'component' ? viewer.className() : 'Specimens', h('i', {}, '/'), t.name),
      h('div', { class: 'title-row' }, h('span', { class: 'badge' }, t.kind === 'component' && t.record?.icon ? h('img', { src: t.record.icon, alt: '' }) : h('span', { dataset: { icon: t.kind === 'component' ? 'mesh' : t.icon, size: '22', accent: 'teal' } })),
        h('div', { style: { minWidth: 0, flex: 1 } }, h('h1', {}, t.name)), sw),
      h('div', { class: 'subtitle' }, r.Enabled ? `Per-object recipe · ${m.label} · ${r.Mode === 'baked' ? 'Baked' : 'Dynamic'}` : 'Fracture off · the object stays whole'),
    );
    const sections = [['Material', materialSection], ['Impact', impactSection], ['Quality', qualitySection], ['Bake', bakeSection], ['Receipt', receiptSection]];
    const nav = h('div', { class: 'inspector-nav' });
    sections.forEach(([name], i) => nav.append(h('button', { onclick: () => host.querySelector(`[data-section="${i}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, name)));
    host.append(nav);
    live.budget = h('div', { class: 'budget' }); host.append(live.budget);
    const body = h('div', { class: r.Enabled && src ? '' : 'inspector-off' });
    sections.forEach(([, build], i) => { const wrap = h('div', { dataset: { section: String(i) } }); build().forEach((n) => wrap.append(n)); body.append(wrap); });
    host.append(body);
    refreshLive();
    hydrate(host);
  }

  function materialSection() {
    const r = R(), m = F.MATERIALS[r.Material];
    const grid = h('div', { class: 'mat-grid', role: 'radiogroup', 'aria-label': 'Fracture material' });
    F.MATERIAL_ORDER.forEach((id) => {
      const mm = F.MATERIALS[id];
      const b = h('button', { class: id === r.Material ? 'active' : null, 'aria-pressed': String(id === r.Material) }, h('i', { style: { background: intHex(mm.color) } }), mm.label, h('em', {}, `${mm.Gc}`));
      b.addEventListener('click', () => change('Material', id, { rebuild: true }));
      grid.append(b);
    });
    const third = m.stored ? [`${(m.stored / 1000).toFixed(0)}<small>kJ/m³</small>`, 'STORED ENERGY'] : m.grain > 1 ? [`${m.grain}<small>× across</small>`, 'GRAIN RATIO · X'] : [`${(m.cluster * 100).toFixed(0)}<small>%</small>`, 'IMPACT FOCUS'];
    return [heading('MATERIAL', '01 · FRACTURE RESPONSE'), panel(
      h('p', {}, 'Fracture response only — not surface appearance. Crack resistance sets how much surface the impact can buy.'),
      grid,
      h('span', { class: 'mode-chip' }, m.mode.toUpperCase().replace('-', ' · ')),
      h('div', { class: 'mat-readout' },
        h('div', {}, h('b', { html: `${m.Gc}<small>J/m²</small>` }), h('span', {}, 'CRACK RESISTANCE · Gc')),
        h('div', {}, h('b', { html: `${m.density.toLocaleString('en-US')}<small>kg/m³</small>` }), h('span', {}, 'DENSITY')),
        h('div', {}, h('b', { html: third[0] }), h('span', {}, third[1]))),
      note(m.note))];
  }

  function impactSection() {
    const r = R();
    live.falloff = h('div', {});
    const seedRow = h('div', { class: 'btn-row' },
      h('button', { class: 'tool', onclick: () => { S.recipe.Seed = 1 + Math.floor(Math.random() * 999998); log(`seed    shuffled to ${S.recipe.Seed}`, 'ok'); solve(); renderInspector(); renderChrome(); } }, h('span', { dataset: { icon: 'dice', size: '14' } }), 'Shuffle seed'),
      h('button', { class: 'tool', onclick: () => { S.recipe.Seed = 42; solve(); renderInspector(); renderChrome(); } }, 'Reset to 42'));
    const imp = vecRow({ label: 'Impact', value: [r.X, r.Y, r.Z], step: 0.005, digits: 3, onInput: (v) => { S.recipe.X = v[0]; S.recipe.Y = v[1]; S.recipe.Z = v[2]; schedule(false); drawLines(); renderChrome(); }, onReset: () => [0, 0, 0] });
    const place = h('button', { class: 'tool' + (S.impactTool ? ' active' : ''), title: 'Click the surface to place (I)', onclick: () => setImpactTool(!S.impactTool) }, h('span', { dataset: { icon: 'impact', size: '14', accent: 'amber' } }), 'Pick');
    const centre = h('button', { class: 'tool', title: 'Reset to the default surface point', onclick: () => { const p = F.defaultImpact(S.source); S.recipe.X = +p[0].toFixed(3); S.recipe.Y = +p[1].toFixed(3); S.recipe.Z = +p[2].toFixed(3); solve(); renderInspector(); renderChrome(); } }, 'Default');
    return [heading('IMPACT', '02 · WHERE AND HOW HARD'), panel(
      live.falloff,
      prop({ label: 'Impact energy', min: 0, max: 50000, step: 50, value: r.Energy, unit: 'J', digits: 0, onInput: (v) => change('Energy', v) }),
      prop({ label: 'Pattern seed', min: 1, max: 999999, step: 1, value: r.Seed, unit: '#', digits: 0, onInput: (v) => change('Seed', Math.round(v)) }),
      seedRow,
      h('div', { class: 'card-head', style: { marginTop: '4px' } }, 'IMPACT POINT', h('em', {}, 'LOCAL METRES')),
      h('div', { class: 'impact-row' }, imp, h('div', { class: 'btn-row', style: { gap: '6px' } }, place, centre)),
      note('Double-click the preview (or use Pick) to place the impact on the surface. Seeds near the impact get cut priority, so fragments are finer there and coarser far away.'))];
  }

  function qualitySection() {
    const r = R();
    live.histogram = h('div', {});
    return [heading('FRAGMENT QUALITY', '03 · LIMITS, NOT PROMISES'), panel(
      live.histogram,
      prop({ label: 'Fragment ceiling', min: 2, max: 160, step: 1, value: r.Ceiling, unit: 'pcs', digits: 0, onInput: (v) => change('Ceiling', Math.round(v)) }),
      prop({ label: 'Minimum span', min: 0.002, max: 0.3, step: 0.001, value: r.MinimumSize, unit: 'm', digits: 3, onInput: (v) => change('MinimumSize', v) }),
      h('div', { class: 'check-tiles' },
        tile({ icon: 'quality', label: 'Needle rejection', on: r.NeedleRejection, title: 'Merge cells thinner than the minimum span into their neighbours', onToggle: (on) => change('NeedleRejection', on) }),
        tile({ icon: 'cube', label: 'Closed caps', on: r.ClosedCaps, title: 'Cap every cut so pieces are closed solids', onToggle: (on) => change('ClosedCaps', on) }),
        tile({ icon: 'geometry', label: 'Quality triangulation', on: r.QualityTriangulation, title: 'Fan cut faces from their centroid instead of a corner (fewer slivers)', onToggle: (on) => change('QualityTriangulation', on) })),
      note('Seeds closer than twice the minimum span are refused, and cells thinner than it are merged. The ceiling caps the count — it never forces bad fragments to reach it.'))];
  }

  function bakeSection() {
    const r = R();
    live.bake = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });
    const out = [heading('BAKE', '04 · RUNTIME COST VS STORAGE'), panel(
      segmented([['dynamic', 'Dynamic'], ['baked', 'Baked']], r.Mode, (v) => change('Mode', v, { rebuild: true }), { label: 'Fracture execution' }),
      live.bake)];
    return out;
  }
  function fillBake() {
    const host = live.bake; if (!host) return;
    host.textContent = '';
    const r = R(), res = S.result, src = S.source, t = S.target;
    if (r.Mode === 'dynamic') {
      host.append(note(`Fragments are generated on impact from this recipe. Nothing is stored; the preview solve took ${res ? res.ms.toFixed(0) : '—'} ms in this browser.`));
      return;
    }
    const sig = src ? F.signature(src, r) : null, ready = r.Baked && r.Baked.signature === sig;
    host.append(note('The closed fragment geometry is stored with the object, so no fracture work happens at runtime.'));
    const status = h('div', { class: 'bake-status ' + (ready ? 'ready' : r.Baked ? 'stale' : '') }, h('i'),
      h('b', {}, ready ? 'Baked · ready' : r.Baked ? 'Stale · recipe changed since bake' : 'Not baked yet'),
      h('small', {}, r.Baked ? `${r.Baked.pieces} ${src?.kind === 'mesh' ? 'patches' : 'closed pieces'} · ${fmtBytes(r.Baked.bytes)} · ${new Date(r.Baked.at).toLocaleString()} · ${r.Baked.signature}` : res ? `Would store ${res.metrics.pieces} pieces · ${fmtBytes(res.metrics.bytes)}` : '—'));
    const bake = h('button', { class: 'mint-btn', disabled: !res, onclick: () => {
      S.recipe.Baked = { signature: sig, pieces: res.metrics.pieces, tris: res.metrics.tris, bytes: res.metrics.bytes, at: Date.now() };
      log(`bake    ${res.metrics.pieces} pieces · ${fmtBytes(res.metrics.bytes)} · signature ${sig}`, 'ok'); renderChrome(); fillBake(); fillReceipt();
    } }, h('span', { dataset: { icon: 'bake', size: '14' } }), ready ? 'Rebake' : 'Bake now');
    const clear = h('button', { class: 'tool', disabled: !r.Baked, onclick: () => { S.recipe.Baked = null; log('bake    cleared', 'warn'); renderChrome(); fillBake(); } }, 'Clear');
    host.append(status, h('div', { class: 'btn-row' }, bake, clear));
    // SDF per piece
    const sdf = h('div', { class: 'tiles one' }, tile({ icon: 'sdf', label: 'Precompute SDF per piece', on: r.PieceSdf, onToggle: (on) => { S.recipe.PieceSdf = on; fillBake(); renderChrome(); } }));
    host.append(sdf);
    if (r.PieceSdf) {
      const pieces = res ? res.metrics.pieces : r.Baked?.pieces || 0, per = r.SdfResolution ** 3 * 2, total = per * pieces;
      host.append(...[
        segmented([[32, '32³'], [64, '64³'], [128, '128³']], r.SdfResolution, (v) => { S.recipe.SdfResolution = v; fillBake(); renderChrome(); }, { label: 'SDF resolution per piece' }),
        rows([['Format', 'R16F signed distance'], ['Per piece', fmtBytes(per)], [`${pieces} pieces`, fmtBytes(total)]]),
        total > 64 * 1048576 ? h('p', { style: { color: '#ffb86b' } }, `${fmtBytes(total)} of distance data — consider 64³ or fewer pieces.`) : null,
        note('Authoring setting. Per-piece distance fields are generated by the native bake; this window records the request and its memory cost.')].filter(Boolean));
    }
    hydrate(host);
  }

  function receiptSection() { live.receipt = h('div', {}); return [heading('GEOMETRY RECEIPT', '05 · WHAT WOULD BE STORED'), panel(live.receipt)]; }
  function fillReceipt() {
    const host = live.receipt; if (!host) return; host.textContent = '';
    const res = S.result, src = S.source, r = R();
    if (!res) { host.append(note(r.Enabled ? 'No result yet.' : 'Fracture is off — nothing is generated or stored.')); return; }
    const mt = res.metrics, convex = src.kind === 'convex', total = res.pieces.reduce((a, p) => a + p.mass, 0);
    host.append(rows([
      ['Source', convex ? 'Closed convex · analytical' : `${src.closed ? 'Closed' : 'Open'} surface · compiled mesh`],
      ['Pieces', `${mt.pieces} ${convex ? (r.ClosedCaps ? 'closed cells' : 'uncapped cells') : 'surface patches'}`],
      ['Triangles', formatCount(mt.tris)], ['Vertices (unshared)', formatCount(mt.vertices)],
      ['Fracture surface', convex ? fmtArea(mt.cutArea) : 'pending caps'],
      ['Occupied volume', mt.occupied !== null ? `${mt.occupied.toFixed(6)} %` : '—'],
      [convex ? 'Smallest / largest' : 'Smallest / largest patch', convex ? `${fmtVol(mt.smallest)} / ${fmtVol(mt.largest)}` : `${fmtArea(mt.smallest)} / ${fmtArea(mt.largest)}`],
      ['Total mass', `${fmtMass(total)}${convex ? '' : ' (4 mm shell)'}`],
      ['Refused candidates', `${mt.refused} (${res.stats.refusedSpan} span · ${res.stats.refusedNeedle} needle)`],
      ['Geometry memory', fmtBytes(mt.bytes)],
      ['Recipe signature', F.signature(src, r)],
    ]));
  }

  function refreshLive() {
    const r = R(), res = S.result, src = S.source; if (!S.target) return;
    // Energy budget hero
    if (live.budget) {
      const B = live.budget; B.textContent = '';
      if (!src || !r.Enabled || !res) { B.append(cardHead('ENERGY BUDGET', 'OFF'), h('div', { class: 'budget-text' }, h('b', {}, '1'), h('small', {}, 'piece · fracture is off'))); }
      else {
        const p = res.plan, max = Math.max(p.requested, r.Ceiling, 1), scale = (v) => Math.min(100, (Math.log(1 + v) / Math.log(1 + Math.max(max, 2))) * 100);
        B.append(cardHead('ENERGY BUDGET', p.capped ? 'CEILING REACHED' : 'WITHIN CEILING'),
          h('div', { class: 'budget-bar', title: 'Accepted pieces (fill) against the ceiling (amber mark), log scale' }, h('i', { style: { width: scale(res.metrics.pieces) + '%' } }), h('em', { style: { left: `calc(${scale(r.Ceiling)}% - 1px)` } })),
          h('div', { class: 'budget-text' }, h('b', {}, `${res.metrics.pieces}`), h('small', {}, `pieces · ${fmtArea(p.crackArea)} of crack bought with ${p.energy.toFixed(0)} J at 2·Gc`)),
          h('div', { class: 'budget-row' },
            h('div', {}, h('b', {}, formatCount(p.requested)), h('small', {}, 'REQUESTED')),
            h('div', {}, h('b', {}, String(r.Ceiling)), h('small', {}, 'CEILING')),
            h('div', {}, h('b', {}, String(res.metrics.refused)), h('small', {}, 'REFUSED'))));
      }
    }
    if (live.falloff) live.falloff.innerHTML = falloffSvg();
    if (live.histogram) live.histogram.innerHTML = histogramSvg();
    fillBake(); fillReceipt();
  }

  function falloffSvg() {
    const res = S.result, W = 300, H = 108, x0 = 14, x1 = W - 10, y0 = 12, y1 = H - 20;
    if (!res) return `<svg class="graph" viewBox="0 0 ${W} ${H}"><path class="grid" d="M${x0} ${y0}V${y1}H${x1}"/><text x="${x0 + 6}" y="${y0 + 10}">cut priority</text></svg>`;
    const size = Math.max(...S.source.bounds.size), dMax = size * 1.1, f = res.plan.falloff;
    const X = (d) => x0 + (Math.min(d, dMax) / dMax) * (x1 - x0), Y = (p) => y1 - p * (y1 - y0);
    let path = ''; for (let i = 0; i <= 40; i++) { const d = (i / 40) * dMax; path += `${i ? 'L' : 'M'}${X(d).toFixed(1)} ${Y(Math.exp(-d / f)).toFixed(1)}`; }
    const dots = res.pieces.map((p) => `<circle class="dot${p.id === S.selected ? ' sel' : ''}" cx="${X(p.distance).toFixed(1)}" cy="${Y(p.priority).toFixed(1)}" r="${p.id === S.selected ? 3.6 : 2.2}"/>`).join('');
    return `<svg class="graph" viewBox="0 0 ${W} ${H}" aria-label="Cut priority against distance from the impact">
      <path class="grid" d="M${x0} ${y0}V${y1}H${x1}M${x0} ${Y(0.5)}H${x1}M${X(f)} ${y0}V${y1}"/>
      <path class="area" d="${path}L${x1} ${y1}L${x0} ${y1}Z"/><path class="curve" d="${path}"/>${dots}
      <text x="${x0 + 6}" y="${y0 + 8}">cut priority · one dot per piece</text><text x="${X(f) + 4}" y="${y1 - 4}">falloff ${f.toFixed(2)} m</text><text x="${x1 - 70}" y="${H - 6}">distance → ${dMax.toFixed(1)} m</text></svg>`;
  }
  function histogramSvg() {
    const res = S.result, W = 300, H = 96, x0 = 14, x1 = W - 10, y0 = 10, y1 = H - 20;
    if (!res) return `<svg class="graph" viewBox="0 0 ${W} ${H}"><path class="grid" d="M${x0} ${y0}V${y1}H${x1}"/><text x="${x0 + 6}" y="${y0 + 10}">fragment sizes</text></svg>`;
    const hgm = F.histogram(res, 14), max = Math.max(1, ...hgm.counts), bw = (x1 - x0) / hgm.counts.length, convex = S.source.kind === 'convex', fm = convex ? fmtVol : fmtArea;
    const sel = S.selected >= 0 ? res.pieces[S.selected] : null, selV = sel ? (convex ? sel.volume : sel.area) : null;
    const selBin = selV ? Math.min(hgm.counts.length - 1, Math.floor(((Math.log10(selV) - Math.log10(hgm.lo)) / (Math.log10(hgm.hi) - Math.log10(hgm.lo) || 1)) * hgm.counts.length)) : -1;
    const bars = hgm.counts.map((c, i) => { const hh = (c / max) * (y1 - y0); return `<rect class="bar${i === selBin ? ' hi' : ''}" x="${(x0 + i * bw + 1.5).toFixed(1)}" y="${(y1 - hh).toFixed(1)}" width="${(bw - 3).toFixed(1)}" height="${hh.toFixed(1)}" rx="2"/>`; }).join('');
    return `<svg class="graph" viewBox="0 0 ${W} ${H}" aria-label="Fragment size distribution"><path class="grid" d="M${x0} ${y0}V${y1}H${x1}"/>${bars}
      <text x="${x0 + 6}" y="${y0 + 8}">${convex ? 'piece volume' : 'patch area'} · log bins</text><text x="${x0}" y="${H - 6}">${fm(hgm.lo)}</text><text x="${x1 - 46}" y="${H - 6}">${fm(hgm.hi)}</text></svg>`;
  }

  // -------------------------------------------------------------------------------------------- save / export
  function thumbnail() {
    if (!viewport || !S.source) return null;
    const objects = S.result ? S.result.pieces.map((pc, i) => ({ mesh: gpu.pieces[i], mode: 'debug', matrix: translate(offsetOf({ ...pc })) })) : [{ mesh: gpu.source, mode: 'lit' }];
    const B = S.source.bounds, size = Math.max(...B.size), grow = 1 + S.shown;
    const lo = B.centre.map((v) => v - (size / 2) * grow), hi = B.centre.map((v) => v + (size / 2) * grow);
    try { return viewport.capture({ objects, bounds: { lo, hi, centre: B.centre, radius: (Math.hypot(...B.size) / 2) * grow }, size: 144, yaw: 0.62, pitch: 0.36 }).toDataURL('image/png'); } catch { return null; }
  }
  function save() {
    const t = S.target; if (!t) return;
    const shownBefore = S.shown;
    if (S.result && S.shown < 0.08) { S.shown = 0.18; }
    S.recipe.Thumb = thumbnail(); S.shown = shownBefore;
    S.recipe.EditedAt = Date.now();
    const recipe = F.normalizeRecipe(S.recipe);
    recipe.Thumb = S.recipe.Thumb; recipe.EditedAt = S.recipe.EditedAt; recipe.Pieces = S.result ? S.result.metrics.pieces : 1;
    if (t.kind === 'component') viewer.setFracture(t.id, recipe);
    else { const store = specimenStore(); store[t.id] = recipe; try { localStorage.setItem(SPECIMEN_KEY, JSON.stringify(store)); } catch { toast('Browser storage is full — specimen recipe not saved'); return; } }
    S.recipe = { ...recipe }; S.savedJson = JSON.stringify(S.recipe);
    log(`save    ${t.name} · ${recipe.Enabled ? `${F.MATERIALS[recipe.Material].label} · ${recipe.Pieces} pieces · ${recipe.Mode}` : 'fracture off'}`, 'ok');
    toast(`${t.name} fracture saved${t.kind === 'component' ? ` to ${viewer.className()}` : ''}`);
    renderChrome(); applyObjects();
  }
  function exportRecipe() {
    const t = S.target, res = S.result, src = S.source; if (!t) return;
    const { Thumb, ...recipe } = F.normalizeRecipe(S.recipe);
    const out = {
      format: 'frontier.fracture.v1', owner: { kind: t.kind, id: t.id, name: t.name, className: t.kind === 'component' ? viewer.className() : null, mesh: t.record?.name || null },
      recipe, signature: src ? F.signature(src, S.recipe) : null,
      receipt: res ? { ...res.metrics, requested: res.plan.requested, crackArea: res.plan.crackArea, solveMs: Math.round(res.ms) } : null,
      pieces: res ? res.pieces.map((p) => ({ id: p.id, centre: p.centre.map((v) => +v.toFixed(4)), volume: +(p.volume || 0).toFixed(6), area: +p.area.toFixed(5), mass: +p.mass.toFixed(3), priority: +p.priority.toFixed(3) })) : [],
    };
    download(`${t.name}.fracture.json`, JSON.stringify(out, null, 2), 'application/json');
  }

  return { open, close, isOpen: () => !$('Fracture').hidden };
}
