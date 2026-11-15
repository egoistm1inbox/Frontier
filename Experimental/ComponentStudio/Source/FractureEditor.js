// Fracture Editor: the per-object fracture window, in the Project Zero language.
// Same flow as Project Zero (Frontier-OLD arena/bc062d35): an object's Fracture panel enables fracture and picks
// Dynamic / Baked, and "Edit … fracture ↗" opens this window for that object.
//
// Layout
//   Outliner (left)
//     - The object being fractured: a picker card that switches targets, and a root row that selects the whole object.
//     - Its fragments as child rows, each with a colour swatch, energy meter, held marker and visibility eye.
//   Centre
//     - The preview, with an Edit / Simulate / Play switch in the header.
//     - Below the preview, either the separation bar (Edit) or the transport (Simulate / Play).
//   Inspector (right)
//     - Pattern workspace sections: Fragment (when one is selected), Energy budget, Material, Impact, Fragment quality,
//       Simulation, Visualisation, Presets, Bake, Geometry receipt.
//
// Modes
//   Edit       Static exploded preview. Separation is an inspection aid.
//   Simulate   Rigid-body physics (FractureSimulation.js), baked to a pose cache and scrubbed on the timeline.
//              The recipe stays editable and re-simulates.
//   Play       Game view: the object sits whole, gets hit, breaks. Gizmos are hidden and the recipe is read-only.
//
// The Energy colour mode paints the least energy blue and the most energy red. In Edit it shows each fragment's
// share of the impact; in Simulate and Play, its live kinetic energy.
import { Viewport, LineBuilder } from './Renderer.js';
import { invert, transformPoint } from './MathUtils.js';
import { triangleColors, hueColor } from './MeshData.js';
import { formatCount } from './Compile.js';
import { $, h, segmented, vecRow, toast, hydrate, bindDrawers, setFill, download, popupMenu } from './Kit.js';
import { foldMemory, section as kitSection, field, sub, hint, mswitch, switchRow, numberRow, heroTile, facts, applySearch } from './InspectorKit.js';
import * as F from './FractureEngine.js';
import * as P from './FractureSimulation.js';

const SPECIMEN_KEY = 'frontier.componentStudio.fracture.v1';
const FOLD_KEY = 'frontier.componentStudio.fracture.ui.v1';
const PRESETS = [
  { id: 'shatter', label: 'Shatter', icon: 'pane', note: 'Glass · 20 kJ · up to 96 pieces', recipe: { Material: 'glass', Energy: 20000, Ceiling: 96, MinimumSize: 0.02 } },
  { id: 'crumble', label: 'Crumble', icon: 'rock', note: 'Concrete · 6 kJ · up to 64 pieces', recipe: { Material: 'concrete', Energy: 6000, Ceiling: 64, MinimumSize: 0.04 } },
  { id: 'splinter', label: 'Splinter', icon: 'beam', note: 'Wood · 9 kJ · up to 32 pieces', recipe: { Material: 'wood', Energy: 9000, Ceiling: 32, MinimumSize: 0.03 } },
  { id: 'dice', label: 'Dice', icon: 'dice', note: 'Tempered glass · 160 pieces', recipe: { Material: 'tempered', Energy: 2500, Ceiling: 160, MinimumSize: 0.02 } },
];
const MODES = ['source', 'pieces', 'material', 'size', 'energy'];
const MODE_LABEL = { source: 'Source', pieces: 'Pieces', material: 'Material', size: 'Size', energy: 'Energy' };
const PHASES = ['edit', 'simulate', 'play'];
const PREROLL = 0.6; // Play: the object sits whole this long before the hit
const RAMP = ['#306bf2', '#29c7c2', '#59d15c', '#f7cc40', '#f04d3d'].map(hexLinear);
const RAMP_CSS = 'linear-gradient(90deg,#306bf2,#29c7c2,#59d15c,#f7cc40,#f04d3d)';
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function hexLinear(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.pow(c / 255, 2.2)); }
const intLinear = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.pow(c / 255, 2.2));
const intHex = (n) => '#' + n.toString(16).padStart(6, '0');
const cssOf = (lin) => `rgb(${lin.map((v) => Math.round(Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2) * 255)).join(',')})`;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
function ramp(t) { t = clamp01(t) * (RAMP.length - 1); const i = Math.min(RAMP.length - 2, Math.floor(t)), f = t - i; return RAMP[i].map((v, k) => v + (RAMP[i + 1][k] - v) * f); }
const fmtVol = (v) => (v >= 0.01 ? `${v.toFixed(4)} m³` : v >= 1e-5 ? `${(v * 1e3).toFixed(2)} L` : `${(v * 1e6).toFixed(1)} cm³`);
const fmtArea = (a) => (a >= 0.01 ? `${a.toFixed(3)} m²` : `${(a * 1e4).toFixed(1)} cm²`);
const fmtBytes = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MiB` : `${(b / 1024).toFixed(1)} KiB`);
const fmtMass = (m) => (m >= 10 ? `${m.toFixed(0)} kg` : m >= 0.1 ? `${m.toFixed(2)} kg` : `${(m * 1000).toFixed(0)} g`);
const fmtJ = (j) => (j >= 1000 ? `${(j / 1000).toFixed(j >= 10000 ? 0 : 1)} kJ` : j >= 10 ? `${j.toFixed(0)} J` : j >= 0.1 ? `${j.toFixed(1)} J` : j > 0 ? `${(j * 1000).toFixed(0)} mJ` : '0 J');
const pad = (i) => String(i).padStart(2, '0');

export function createFractureEditor({ library, viewer }) {
  let viewport = null, drawers = null, timer = 0, anim = 0, simTimer = 0, raf = 0, lastTick = 0, lastPaint = 0;
  const sources = new Map();
  const folds = foldMemory(FOLD_KEY);
  const S = {
    target: null, source: null, recipe: null, savedJson: '', result: null, shares: null, cache: null, sizeT: [],
    mode: 'pieces', wire: false, grid: true, seeds: true, impactTool: false, separation: 0.18, shown: 0.18, selected: -1, cam: 'persp',
    search: '', paramSearch: '', tableSort: 'priority', treeSort: 'energy', treeOpen: true, groupOpen: true, logLines: [],
    phase: 'edit', time: 0, playing: false, speed: 1, loop: true, overrides: new Map(), hidden: new Set(), energyScale: 'log', vectors: true,
  };
  const gpu = { pieces: [], source: null };
  const live = {}; // inspector nodes refreshed after every solve or playback tick without rebuilding the panel
  const tree = { rows: new Map(), root: null };
  const pose = { x: [0, 0, 0], q: [0, 0, 0, 1], kinetic: 0 };
  const poseNext = { x: [0, 0, 0], q: [0, 0, 0, 1], kinetic: 0 };
  const placements = [];
  const section = (id, opts, ...body) => kitSection(folds, id, opts, ...body);

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
  const sim = () => R().Simulation;

  // -------------------------------------------------------------------------------------------- open / close
  function open(key) {
    // No key: reopen the last target, else the first class component.
    if (!key) key = S.target?.key || allTargets()[0]?.key;
    const t = allTargets().find((x) => x.key === key) || allTargets().find((x) => x.key === 'component:' + key || x.key === 'specimen:' + key);
    if (!t) { toast(`No fracture target "${key}"`); return; }
    if ($('Fracture').hidden === false && S.target && S.target.key !== t.key && dirty() && !confirm(`Discard unsaved fracture changes to ${S.target.name}?`)) return;
    $('Fracture').hidden = false;
    ensureViewport();
    if (S.phase !== 'edit') setPhase('edit', { quiet: true });
    S.target = t; S.source = sourceFor(t); S.recipe = { ...t.recipe, Simulation: P.normalizeSimulation(t.recipe.Simulation) };
    if (!S.recipe.EditedAt && S.source) { const p = F.defaultImpact(S.source); S.recipe.X = +p[0].toFixed(3); S.recipe.Y = +p[1].toFixed(3); S.recipe.Z = +p[2].toFixed(3); }
    S.savedJson = JSON.stringify(S.recipe);
    S.selected = -1; S.shown = S.recipe.Enabled ? S.separation : 0; S.logLines = []; S.overrides = new Map(); S.hidden = new Set(); S.cache = null;
    log(`open    ${t.name} · ${t.kind === 'component' ? `${viewer.className()} component` : 'specimen'} · ${S.source ? (S.source.kind === 'convex' ? 'closed convex source' : 'open surface source') : 'missing mesh'}`, 'dim');
    if (S.source) { viewport.settings.groundLevel = S.source.bounds.lo[1]; cameraPreset(S.cam, true); }
    solve(true);
    renderAll();
  }
  function close(force = false) {
    if (!force && dirty() && !confirm(`Close the Fracture Editor and discard unsaved changes to ${S.target?.name}?`)) return;
    setPlaying(false);
    $('Fracture').hidden = true; drawers?.close();
  }

  // -------------------------------------------------------------------------------------------- solve
  function change(key, amount, { rebuild = false, immediate = false } = {}) {
    S.recipe[key] = amount;
    if (key === 'Enabled') { S.shown = amount ? S.separation : 0; if (!amount && S.phase !== 'edit') setPhase('edit'); }
    schedule(immediate);
    if (rebuild) renderInspector(); else refreshLive();
    renderChrome();
  }
  function schedule(immediate) { clearTimeout(timer); if (immediate) solve(); else timer = setTimeout(() => solve(), 70); }
  function solve(silent = false) {
    const before = S.result ? F.signature(S.source, S.result.recipe) : null;
    if (!S.source || !R().Enabled) { S.result = null; S.shares = null; S.cache = null; upload(); renderOutliner(); refreshLive(); renderChrome(); return; }
    S.result = F.fracture(S.source, R());
    // Piece ids are only stable for one geometry. A new solve clears per-fragment choices.
    if (before !== F.signature(S.source, R())) { S.overrides.clear(); S.hidden.clear(); }
    if (S.selected >= S.result.pieces.length) S.selected = -1;
    S.result.log.forEach((l) => log(l, silent ? 'dim' : /refused|needles/.test(l) ? 'warn' : 'ok'));
    S.shares = P.impactShares(S.result, sim(), S.overrides);
    S.cache = null;
    upload();
    if (S.phase !== 'edit') bakeSimulation();
    renderOutliner(); refreshLive(); renderChrome();
    if (S.selected >= 0) renderInspector();
  }
  // Simulation settings or per-fragment overrides changed: the geometry stays, so only shares and the bake update.
  function reshare({ now = false } = {}) {
    if (!S.result) return;
    S.shares = P.impactShares(S.result, sim(), S.overrides);
    S.cache = null;
    if (S.phase !== 'edit') { clearTimeout(simTimer); if (now) bakeSimulation(); else simTimer = setTimeout(() => { bakeSimulation(); paint(); refreshLive(); }, 140); }
    paint(); paintTree(); refreshLive(); renderChrome();
  }
  function simChange(key, amount, final) {
    S.recipe.Simulation = { ...sim(), [key]: amount };
    if (final || key !== 'Duration') reshare();
  }
  function bakeSimulation() {
    if (!S.result) { S.cache = null; return; }
    S.cache = P.simulate(S.result, sim(), { overrides: S.overrides, ground: S.source.bounds.lo[1] });
    const c = S.cache, sh = c.shares;
    log(`physics ${sh.releasedCount}/${c.n} released · ${fmtJ(sh.kinetic)} kinetic · ${c.steps} steps in ${c.ms.toFixed(0)} ms${c.settled !== null ? ` · at rest by ${c.settled.toFixed(2)} s` : ''}`, 'ok');
    S.time = Math.min(S.time, timelineEnd());
    energyCurve(); syncTransport();
  }

  // -------------------------------------------------------------------------------------------- energy + colour
  const timelineEnd = () => (S.cache ? (S.phase === 'play' ? PREROLL : 0) + S.cache.duration : 0);
  const simTime = () => (S.phase === 'play' ? S.time - PREROLL : S.time);
  const physical = () => S.phase !== 'edit' && !!S.cache;
  // Kinetic energy of all fragments right now. Zero before the hit in Play.
  const kineticNow = () => (S.cache && simTime() > 0 ? P.totalAt(S.cache, simTime()) : 0);
  function energyOf(i, st = simTime()) {
    if (!S.shares) return 0;
    if (!physical()) return S.shares.energy[i];
    if (st <= 0) return 0;
    return P.sample(S.cache, st, i, pose).kinetic;
  }
  // Log scale: the least-hit fragment is blue, the most-hit is red, with at least 2 decades between them so live
// kinetic energy can cool down through the ramp as fragments come to rest.
function energyRange() {
    const hi = Math.max(1e-6, S.shares?.peak || 1), low = S.shares?.low || 0;
    return { lo: S.energyScale === 'log' ? Math.min(hi * 0.5, Math.max(hi * 1e-3, physical() ? Math.min(low, hi * 1e-2) : low)) : 0, hi };
  }
  function energyT(E) {
    const { lo, hi } = energyRange();
    if (S.energyScale === 'linear') return clamp01(E / hi);
    return E <= lo ? 0 : clamp01(Math.log(E / lo) / Math.log(hi / lo));
  }
  function pieceColour(i) {
    if (S.mode === 'energy') return ramp(energyT(energyOf(i)));
    if (S.mode === 'size') return ramp(S.sizeT[i] ?? 0.5);
    if (S.mode === 'material') return intLinear(F.MATERIALS[R().Material].color);
    return hueColor(i, 0.5, 0.58);
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
    select(id === null || id === undefined ? -1 : id);
  }
  function select(i, { reveal = true } = {}) {
    S.selected = i;
    applyObjects(); drawLines(); readout(); paintTree();
    if (reveal && i >= 0) tree.rows.get(i)?.row.scrollIntoView({ block: 'nearest' });
    if ($('FragmentDrawer').classList.contains('open')) renderTable();
    renderInspector();
  }
  function rayFromEvent(e) {
    const c = $('FractureCanvas'), r = c.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1, y = 1 - ((e.clientY - r.top) / r.height) * 2;
    const inv = invert(viewport.placements(r.width / r.height).viewProj);
    const un = (z) => { const v = [0, 1, 2, 3].map((i) => inv[i] * x + inv[4 + i] * y + inv[8 + i] * z + inv[12 + i]); return [v[0] / v[3], v[1] / v[3], v[2] / v[3]]; };
    const a = un(-1), b = un(1), d = b.map((v, k) => v - a[k]), l = Math.hypot(...d);
    return { origin: a, dir: d.map((v) => v / l) };
  }
  function placeImpact(e) {
    if (!S.source || !R().Enabled) return;
    if (S.phase === 'play') { toast('Switch to Edit or Simulate to move the impact'); return; }
    const { origin, dir } = rayFromEvent(e);
    const hit = F.raySource(S.source, origin, dir);
    if (!hit) { toast('Click on the source surface to place the impact'); return; }
    S.recipe.X = +hit[0].toFixed(3); S.recipe.Y = +hit[1].toFixed(3); S.recipe.Z = +hit[2].toFixed(3);
    log(`impact  placed at ${hit.map((v) => v.toFixed(3)).join(', ')} m (local)`, 'ok');
    if (S.impactTool) setImpactTool(false);
    if (S.phase === 'simulate') S.time = 0;
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
    S.sizeT = [];
    if (res) {
      const vols = res.pieces.map((p) => (src.kind === 'convex' ? p.volume : p.area)), lo = Math.log10(Math.min(...vols)), hi = Math.log10(Math.max(...vols));
      S.sizeT = vols.map((v) => (hi > lo ? (Math.log10(v) - lo) / (hi - lo) : 0.5));
      const outer = intLinear(m.color), inner = intLinear(m.interior);
      res.pieces.forEach((pc, i) => {
        const tris = pc.tris, debug = new Float32Array(tris * 3), colors = new Float32Array(tris * 4);
        // Energy mode: a neutral base that the per-object tint colours on every repaint. Other modes bake their colour in.
        const base = S.mode === 'energy' ? [1, 1, 1] : S.mode === 'size' ? ramp(S.sizeT[i]) : hueColor(i, 0.5, 0.58);
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
  function placementOf(i, st = simTime()) {
    const pc = S.result.pieces[i];
    if (!physical()) return translate(offsetOf(pc));
    if (st <= 0) return IDENTITY;
    P.sample(S.cache, st, i, pose);
    return P.poseMatrix(pc.centre, pose.x, pose.q, (placements[i] ||= new Float32Array(16)));
  }
  function applyObjects() {
    if (!viewport) return;
    const res = S.result, showSource = S.mode === 'source' || !res;
    if (showSource) viewport.setObjects(gpu.source ? [{ mesh: gpu.source, mode: 'lit' }] : []);
    else {
      const st = simTime(), energy = S.mode === 'energy';
      viewport.setObjects(res.pieces.map((pc, i) => ({
        mesh: gpu.pieces[i], mode: S.mode === 'material' ? 'lit' : 'debug', matrix: placementOf(i, st), pickId: i,
        selected: i === S.selected && S.phase !== 'play', visible: !S.hidden.has(pc.id), tint: energy ? ramp(energyT(energyOf(i, st))) : undefined,
      })));
    }
    viewport.settings.wire = S.wire; viewport.settings.grid = S.grid; viewport.dirty = true;
  }
  function drawLines() {
    if (!viewport) return;
    const src = S.source, res = S.result;
    if (!src) { viewport.setLines('fx-impact', null); viewport.setLines('fx-seeds', null); return; }
    const size = Math.max(...src.bounds.size), L = new LineBuilder(), Ls = new LineBuilder(), st = simTime();
    const p = [R().X, R().Y, R().Z], amber = [1, 0.7, 0.22, 1];
    if (R().Enabled && S.phase !== 'play') {
      const r = size * 0.035;
      L.circle(p, r, 'x', amber, 24).circle(p, r, 'y', amber, 24).circle(p, r, 'z', amber, 24);
      const c = src.bounds.centre, n = p.map((v, k) => v - c[k]), nl = Math.hypot(...n) || 1;
      L.arrow(p.map((v, k) => v + (n[k] / nl) * size * 0.42), p.map((v, k) => v + (n[k] / nl) * r * 1.2), amber);
      if (res && S.phase === 'edit') { const f = res.plan.falloff; L.circle(p, f, 'y', [1, 0.7, 0.22, 0.32], 64); L.circle(p, f * 0.5, 'y', [1, 0.7, 0.22, 0.18], 48); }
    }
    // Play: a shock ring at the moment of impact.
    if (res && S.phase === 'play') {
      const k = (S.time - PREROLL + 0.06) / 0.45;
      if (k > 0 && k < 1) for (const axis of ['x', 'y', 'z']) L.circle(p, size * (0.04 + 0.55 * k), axis, [1, 0.78, 0.4, 1 - k], 48);
    }
    if (res && S.seeds && S.phase === 'edit') {
      const s = size * 0.012, teal = [0.22, 0.82, 0.77, 0.95];
      res.pieces.forEach((pc) => {
        const o = S.mode === 'source' ? [0, 0, 0] : offsetOf(pc), q = pc.seedPoint.map((v, k) => v + o[k]);
        for (let k = 0; k < 3; k++) { const a = q.slice(), b = q.slice(); a[k] -= s; b[k] += s; Ls.line(a, b, teal); }
      });
    }
    // Simulate: velocity vectors, 60 ms of travel long, coloured by kinetic energy.
    if (res && S.phase === 'simulate' && S.vectors && S.cache && st > 0) {
      res.pieces.forEach((pc, i) => {
        if (!S.shares.released[i] || S.hidden.has(pc.id)) return;
        P.sample(S.cache, st, i, pose); P.sample(S.cache, st + 1 / P.RATE, i, poseNext);
        const v = poseNext.x.map((x, k) => (x - pose.x[k]) * P.RATE), speed = Math.hypot(...v);
        if (speed < 0.05) return;
        const c = ramp(energyT(pose.kinetic));
        L.arrow(pose.x.slice(), pose.x.map((x, k) => x + v[k] * 0.06), [c[0] * 1.3, c[1] * 1.3, c[2] * 1.3, 0.95]);
      });
    }
    if (res && S.selected >= 0 && S.mode !== 'source' && S.phase !== 'play') {
      const pc = res.pieces[S.selected];
      if (physical()) L.box(pc.bounds.lo, pc.bounds.hi, [1, 0.7, 0.22, 0.9], placementOf(S.selected, st), transformPoint);
      else { const o = offsetOf(pc); L.box(pc.bounds.lo.map((v, k) => v + o[k]), pc.bounds.hi.map((v, k) => v + o[k]), [1, 0.7, 0.22, 0.9]); }
    }
    if ((S.mode === 'source' || !res) && S.phase !== 'play') L.box(src.bounds.lo, src.bounds.hi, [1, 1, 1, 0.12]);
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
    const B = S.source.bounds, size = Math.max(...B.size), grow = S.phase === 'edit' ? 1 + S.shown * 1.2 : 1.9;
    viewport.frame({ centre: B.centre, radius: (Math.hypot(...B.size) / 2) * grow + size * 0.04 }, { keepAngles: true });
  }
  function focusFragment(i) {
    const pc = S.result.pieces[i], size = Math.max(...pc.bounds.size);
    let centre = pc.centre;
    if (physical() && simTime() > 0) centre = P.sample(S.cache, simTime(), i, pose).x.slice();
    else if (!physical()) { const o = offsetOf(pc); centre = pc.centre.map((v, k) => v + o[k]); }
    viewport.frame({ centre, radius: size * 1.4 + 0.02 }, { keepAngles: true });
  }

  // -------------------------------------------------------------------------------------------- Edit: separation animation
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

  // -------------------------------------------------------------------------------------------- Simulate / Play
  function setPhase(p, { quiet = false } = {}) {
    if (p === S.phase || !PHASES.includes(p)) return;
    if (p !== 'edit' && !S.source) { toast('This target has no source mesh to simulate'); return; }
    if (p !== 'edit' && !R().Enabled) { R().Enabled = true; S.shown = S.separation; solve(true); log('enable  fracture switched on to simulate', 'warn'); }
    cancelAnimationFrame(anim);
    const from = S.phase;
    S.phase = p;
    document.querySelectorAll('#FracturePhase button').forEach((b) => { const on = b.dataset.phase === p; b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on)); });
    $('FractureEditBar').hidden = p !== 'edit'; $('FractureTransport').hidden = p === 'edit';
    $('FractureWell').classList.toggle('phase-play', p === 'play'); $('FractureWell').classList.toggle('phase-simulate', p === 'simulate');
    if (p === 'play') setImpactTool(false);
    if (p !== 'edit') {
      if (S.mode === 'source') { S.mode = 'energy'; syncModeButtons(); upload(); }
      if (!S.cache) bakeSimulation(); else energyCurve();
      S.time = 0;
      if (from === 'edit') fit();
      setPlaying(true);
    } else { setPlaying(false); S.time = 0; fit(); }
    if (!quiet) log(`mode    ${p}${p !== 'edit' && S.cache ? ` · ${S.cache.duration.toFixed(1)} s bake` : ''}`, 'dim');
    paint(); legend(); renderInspector(); renderChrome(); paintTree();
  }
  function setPlaying(on) {
    S.playing = on && S.phase !== 'edit' && !!S.cache;
    const b = $('FracturePlay'); b.textContent = ''; b.append(h('span', { dataset: { icon: S.playing ? 'pause' : 'play', size: '16' } })); hydrate(b);
    b.classList.toggle('paused', !S.playing);
    cancelAnimationFrame(raf);
    if (S.playing) { if (S.time >= timelineEnd() - 1e-3) S.time = 0; lastTick = performance.now(); raf = requestAnimationFrame(tick); }
  }
  function tick(now) {
    if (!S.playing) return;
    const dt = Math.min(0.1, (now - lastTick) / 1000) * S.speed; lastTick = now;
    S.time += dt;
    const end = timelineEnd();
    if (S.time >= end) { if (S.loop) S.time = 0; else { S.time = end; setPlaying(false); } }
    paint(now);
    if (S.playing) raf = requestAnimationFrame(tick);
  }
  function seek(t) { S.time = Math.max(0, Math.min(timelineEnd(), t)); paint(); }
  // One visual update. The outliner, inspector facts and legend repaint at about 8 Hz during playback.
  function paint(now = performance.now()) {
    applyObjects(); drawLines(); syncTransport(); readout();
    if (now - lastPaint > 120 || !S.playing) { lastPaint = now; paintTree(); refreshMotion(); }
  }
  function syncTransport() {
    if (S.phase === 'edit') return;
    const end = timelineEnd() || 1, st = simTime();
    const scrub = $('FractureScrub'); scrub.value = Math.round((S.time / end) * 1000); setFill(scrub);
    $('FractureTime').textContent = st < 0 ? `−${(-st).toFixed(2)} s` : `${st.toFixed(2)} s`;
    $('FractureTimeNote').textContent = S.cache ? `${st < 0 ? 'before impact' : `of ${S.cache.duration.toFixed(2)} s`} · ${P.RATE} Hz bake` : 'not baked';
    const imp = $('FractureImpactMark'), set = $('FractureSettleMark');
    imp.hidden = S.phase !== 'play'; imp.style.left = `${(PREROLL / end) * 100}%`;
    set.hidden = !S.cache || S.cache.settled === null;
    if (S.cache && S.cache.settled !== null) set.style.left = `${(((S.phase === 'play' ? PREROLL : 0) + S.cache.settled) / end) * 100}%`;
  }
  function energyCurve() {
    const svg = $('FractureEnergyCurve'); if (!S.cache) { svg.innerHTML = ''; return; }
    const c = S.cache, end = timelineEnd(), off = S.phase === 'play' ? PREROLL : 0, peak = Math.max(1e-6, ...c.totals);
    let d = `M0 40L${((off / end) * 1000).toFixed(1)} 40`;
    for (let f = 0; f < c.steps; f += 2) { const x = (((off + f / c.rate) / end) * 1000).toFixed(1), y = (40 - Math.sqrt(c.totals[f] / peak) * 36).toFixed(1); d += `L${x} ${y}`; }
    svg.innerHTML = `<path d="${d}L1000 40Z" class="area"/><path d="${d.replace(/^M0 40/, 'M0 40')}" class="line"/>`;
  }

  // -------------------------------------------------------------------------------------------- chrome
  function bindChrome() {
    document.querySelectorAll('#FractureModes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.fmode)));
    document.querySelectorAll('#FractureCams button').forEach((b) => b.addEventListener('click', () => cameraPreset(b.dataset.fcam)));
    document.querySelectorAll('#FracturePhase button').forEach((b) => b.addEventListener('click', () => setPhase(b.dataset.phase)));
    $('FractureImpactTool').addEventListener('click', () => setImpactTool(!S.impactTool));
    const toggle = (id, key, after) => $(id).addEventListener('click', () => { S[key] = !S[key]; $(id).classList.toggle('active', S[key]); after?.(); });
    toggle('FractureSeeds', 'seeds', drawLines);
    toggle('FractureWire', 'wire', applyObjects);
    toggle('FractureGrid', 'grid', applyObjects);
    toggle('FractureLoop', 'loop');
    $('FractureFit').addEventListener('click', fit);
    const sep = (v) => { S.separation = S.shown = Math.max(0, Math.min(1, v / 100)); syncSeparation(); applyObjects(); drawLines(); };
    $('FractureSep').addEventListener('input', () => sep(+$('FractureSep').value));
    $('FractureSepNumber').addEventListener('change', () => sep(+$('FractureSepNumber').value));
    $('FractureAssemble').addEventListener('click', () => animateTo(0));
    $('FractureRun').addEventListener('click', runFracture);
    $('FracturePlay').addEventListener('click', () => setPlaying(!S.playing));
    $('FractureToStart').addEventListener('click', () => { seek(0); });
    $('FractureStepAhead').addEventListener('click', () => { setPlaying(false); seek(S.time + 1 / P.RATE); });
    $('FractureScrub').addEventListener('input', () => { setPlaying(false); seek((+$('FractureScrub').value / 1000) * timelineEnd()); });
    document.querySelectorAll('#FractureSpeed button').forEach((b) => b.addEventListener('click', () => {
      S.speed = +b.dataset.speed; document.querySelectorAll('#FractureSpeed button').forEach((x) => x.classList.toggle('active', x === b));
    }));
    $('FractureOwner').addEventListener('click', () => targetMenu());
    $('FractureClose').addEventListener('click', () => close());
    $('FractureBack').addEventListener('click', () => close());
    $('FractureRevert').addEventListener('click', () => { if (!dirty()) return; S.recipe = JSON.parse(S.savedJson); log('revert  recipe restored to the saved version', 'warn'); solve(); renderAll(); });
    $('FractureSave').addEventListener('click', save);
    $('FractureExport').addEventListener('click', exportRecipe);
    $('FractureSearch').addEventListener('input', (e) => { S.search = e.target.value; filterTree(); });
    document.addEventListener('keydown', (e) => {
      if ($('Fracture').hidden || e.target.closest('input, select, textarea')) return;
      const k = e.key.toLowerCase();
      if (e.shiftKey && /^Digit[123]$/.test(e.code)) { setPhase(PHASES[+e.code.slice(5) - 1]); e.preventDefault(); return; }
      if (e.key === 'Escape') { if (S.impactTool) setImpactTool(false); else if (S.phase !== 'edit') setPhase('edit'); else close(); }
      else if (e.key === ' ') { e.preventDefault(); if (S.phase === 'edit') runFracture(); else setPlaying(!S.playing); }
      else if (S.phase !== 'edit' && e.key === 'Home') { e.preventDefault(); seek(0); }
      else if (S.phase !== 'edit' && (e.key === '.' || e.key === ',')) { setPlaying(false); seek(S.time + (e.key === '.' ? 1 : -1) / P.RATE); }
      else if (S.phase !== 'edit' && k === 'l') $('FractureLoop').click();
      else if (k === 'i' && S.phase !== 'play') setImpactTool(!S.impactTool);
      else if (k === 'f') { if (S.selected >= 0 && e.altKey) focusFragment(S.selected); else fit(); }
      else if (k === 'z') $('FractureWire').click();
      else if (k === 'g') $('FractureGrid').click();
      else if (k === 's' && !e.ctrlKey && !e.metaKey) $('FractureSeeds').click();
      else if (k === 'r' && S.phase === 'edit') animateTo(0);
      else if (e.key >= '1' && e.key <= '5' && !e.shiftKey) setMode(MODES[+e.key - 1]);
      else return;
    });
    document.addEventListener('keydown', (e) => { if (!$('Fracture').hidden && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } });
  }
  function syncModeButtons() { document.querySelectorAll('#FractureModes button').forEach((b) => b.classList.toggle('active', b.dataset.fmode === S.mode)); }
  function setMode(m) {
    if (!MODES.includes(m)) return;
    if (m === 'source' && S.phase !== 'edit') { toast('Source view is an Edit view: the simulation needs the pieces'); return; }
    S.mode = m; syncModeButtons();
    upload(); paintTree(); renderInspector();
  }
  function recolour() { applyObjects(); drawLines(); legend(); paintTree(); refreshLive(); }

  function renderAll() { renderOutliner(); renderInspector(); renderChrome(); syncSeparation(); hydrate($('Fracture')); }

  function statusOf(t, recipe) {
    const r = recipe || t.recipe;
    if (!r.Enabled) return ['OFF', ''];
    if (r.Mode === 'baked') { const src = sourceFor(t); return r.Baked && src && r.Baked.signature === F.signature(src, r) ? ['BAKED', 'baked'] : ['STALE', 'stale']; }
    return ['DYNAMIC', 'dyn'];
  }

  // -------------------------------------------------------------------------------------------- outliner
  // The object picker: every class component and specimen, with its fracture state.
  function targetMenu() {
    const item = (t) => {
      const current = S.target?.key === t.key, r = current ? S.recipe : t.recipe, [label] = statusOf(t, r);
      return { label: t.name + (current ? '  ·  current' : ''), icon: t.kind === 'component' ? 'mesh' : t.icon,
        note: r.Enabled ? `${F.MATERIALS[r.Material].label} · ${formatCount(r.Energy)} J · ≤ ${r.Ceiling} pcs` : t.kind === 'component' ? (t.record ? t.record.name : 'Missing mesh') : t.note,
        hint: current && dirty() ? 'EDITED' : label, onClick: () => open(t.key) };
    };
    const comp = componentTargets(), spec = specimenTargets();
    popupMenu($('FractureOwner').getBoundingClientRect(), [{ heading: `${viewer.className().toUpperCase()} · CLASS COMPONENTS` }, ...comp.map(item), 'sep', { heading: 'SPECIMENS' }, ...spec.map(item)], { width: 300, label: 'Fracture target' });
  }
  function renderOwner() {
    const t = S.target, src = S.source, r = R(), owner = $('FractureOwner'); owner.textContent = '';
    const [label, cls] = statusOf(t, r);
    owner.append(h('span', { class: 'ext teal' }, t.kind === 'component' && t.record?.icon ? h('img', { src: t.record.icon, alt: '' }) : h('span', { dataset: { icon: t.kind === 'component' ? 'mesh' : t.icon, size: '20' } })),
      h('div', {}, h('small', { class: 'fx-target-kicker' }, 'FRACTURING'), h('b', {}, t.kind === 'component' ? `${t.name} · ${t.record ? t.record.name : 'missing'}` : `${t.name} specimen`),
        h('small', {}, src ? `${src.kind === 'convex' ? 'Analytical convex' : 'Compiled mesh · surface'} · ${src.bounds.size.map((v) => v.toFixed(2)).join(' × ')} m` : 'Source mesh not in Content')),
      h('span', { class: 'fx-target-side' }, h('span', { class: 'state-pill ' + (dirty() ? 'unsaved' : cls) }, dirty() ? 'EDITED' : label), h('span', { dataset: { icon: 'chevron', size: '12' } })));
    hydrate(owner);
  }
  function sortedPieces() {
    const res = S.result; if (!res) return [];
    const convex = S.source.kind === 'convex', list = [...res.pieces];
    if (S.treeSort === 'energy') list.sort((a, b) => S.shares.energy[b.id] - S.shares.energy[a.id]);
    else if (S.treeSort === 'size') list.sort((a, b) => (convex ? b.volume - a.volume : b.area - a.area));
    return list;
  }
  function renderOutliner() {
    const host = $('FractureTree'), t = S.target; if (!t) return;
    host.textContent = ''; tree.rows.clear();
    const r = R(), res = S.result, src = S.source;
    const caret = (open, onToggle, label) => { const b = h('button', { class: 'caret' + (open ? '' : ' closed'), 'aria-label': label, 'aria-expanded': String(open) }); b.addEventListener('click', (e) => { e.stopPropagation(); onToggle(); }); return b; };
    // Root: the whole object.
    const total = res ? res.pieces.reduce((a, p) => a + p.mass, 0) : 0;
    const rootSub = !src ? 'Source mesh missing' : res ? `Whole object · ${res.pieces.length} fragments · ${fmtMass(total)}` : r.Enabled ? 'Solving…' : 'Whole object · fracture off';
    const root = h('div', { class: 'tree-row fx-root' + (S.selected < 0 ? ' active' : ''), role: 'treeitem', tabindex: '0', 'aria-selected': String(S.selected < 0), title: 'Select the whole object' },
      caret(S.treeOpen, () => { S.treeOpen = !S.treeOpen; renderOutliner(); }, 'Expand object'),
      t.kind === 'component' && t.record?.icon ? h('img', { class: 'thumb', src: t.record.icon, alt: '' }) : h('span', { class: 'glyph', dataset: { icon: t.kind === 'component' ? 'mesh' : t.icon, size: '17', accent: 'teal' } }),
      h('div', {}, h('b', {}, t.name), h('small', {}, rootSub)),
      h('span', { class: 'tag' }, h('span', { class: 'fx-role' }, 'SOURCE')));
    root.addEventListener('click', () => select(-1));
    root.addEventListener('keydown', (e) => { if (e.key === 'Enter') select(-1); });
    tree.root = root; host.append(root);
    if (!S.treeOpen) { hydrate(host); return; }
    if (!res) {
      host.append(h('div', { class: 'fx-tree-note', style: { '--depth': 1 } }, h('span', { dataset: { icon: 'fracture', size: '14', accent: 'teal' } }),
        h('p', {}, !src ? 'Re-import the mesh through Geometry Compile.' : r.Enabled ? 'No fragments yet.' : 'Fracture is off, so the object stays whole. Turn it on in the inspector to generate fragments.')));
      hydrate(host); return;
    }
    // Fragments group.
    const sorter = h('div', { class: 'fx-sort', role: 'radiogroup', 'aria-label': 'Sort fragments' }, ...[['energy', 'Energy'], ['size', 'Size'], ['id', '#']].map(([id, label]) => {
      const b = h('button', { class: S.treeSort === id ? 'active' : null, title: `Sort by ${id === 'id' ? 'index' : id}` }, label);
      b.addEventListener('click', (e) => { e.stopPropagation(); S.treeSort = id; renderOutliner(); });
      return b;
    }));
    const group = h('div', { class: 'tree-row fx-group', style: { '--depth': 1 }, role: 'treeitem' },
      caret(S.groupOpen, () => { S.groupOpen = !S.groupOpen; renderOutliner(); }, 'Expand fragments'),
      h('span', { class: 'glyph', dataset: { icon: 'fragment', size: '15', accent: 'teal' } }),
      h('div', {}, h('b', {}, 'Fragments'), h('small', { id: 'FractureGroupNote' }, '')), sorter);
    group.addEventListener('click', () => { S.groupOpen = !S.groupOpen; renderOutliner(); });
    host.append(group);
    if (S.groupOpen) {
      const convex = src.kind === 'convex';
      for (const pc of sortedPieces()) {
        const i = pc.id;
        const swatch = h('i', { class: 'fx-swatch' }), meter = h('span', { class: 'fx-meter', title: 'Share of the impact energy' }, h('i')), note = h('small', {}, '');
        const eye = h('button', { class: 'hide', title: 'Hide in preview', 'aria-label': `Hide fragment ${pad(i)}`, dataset: { icon: S.hidden.has(i) ? 'eyeOff' : 'eye', size: '13' } });
        eye.addEventListener('click', (e) => { e.stopPropagation(); toggleHidden(i, !S.hidden.has(i)); });
        const lock = h('span', { class: 'fx-held', title: 'Held: stays in the remaining body', dataset: { icon: 'lock', size: '11' } });
        const row = h('div', { class: 'tree-row fx-frag', style: { '--depth': 2 }, role: 'treeitem', tabindex: '-1', dataset: { search: `fragment ${pad(i)} #${i} ${convex ? '' : 'patch'}` } },
          h('span', { class: 'caret leaf' }), swatch, h('div', {}, h('b', {}, `Fragment ${pad(i)}`), note), h('span', { class: 'tag' }, meter, lock, eye));
        row.addEventListener('click', () => select(i === S.selected ? -1 : i, { reveal: false }));
        row.addEventListener('dblclick', () => { select(i, { reveal: false }); focusFragment(i); });
        tree.rows.set(i, { row, swatch, meter, note, eye, lock });
        host.append(row);
      }
    }
    hydrate(host);
    paintTree(); filterTree();
  }
  function paintTree() {
    if (!S.target) return;
    tree.root?.classList.toggle('active', S.selected < 0);
    const res = S.result; if (!res || !S.shares) return;
    const peak = S.shares.peak || 1, live = physical() && simTime() > 0;
    let awake = 0;
    for (const [i, n] of tree.rows) {
      const pc = res.pieces[i], held = !S.shares.released[i], E = energyOf(i);
      n.swatch.style.background = cssOf(pieceColour(i));
      n.meter.firstChild.style.width = `${Math.max(2, energyT(live ? E : S.shares.energy[i]) * 100)}%`;
      n.meter.firstChild.style.background = cssOf(ramp(energyT(live ? E : S.shares.energy[i])));
      n.note.textContent = `${fmtMass(pc.mass)} · ${fmtJ(E)}${live ? ' now' : ''}${held ? ' · held' : ''}`;
      n.lock.hidden = !held;
      n.row.classList.toggle('active', i === S.selected);
      n.row.classList.toggle('hidden-row', S.hidden.has(i));
      if (live && E > peak * 1e-4) awake++;
    }
    const note = $('FractureGroupNote');
    if (note) note.textContent = live ? `${awake} moving · sorted by ${S.treeSort === 'id' ? 'index' : S.treeSort}` : `${S.shares.releasedCount} released · ${res.pieces.length - S.shares.releasedCount} held`;
  }
  function filterTree() {
    const q = S.search.trim().toLowerCase();
    for (const [i, n] of tree.rows) {
      const held = S.shares && !S.shares.released[i];
      const words = n.row.dataset.search + (held ? ' held' : ' released') + (S.hidden.has(i) ? ' hidden' : '');
      n.row.hidden = !!q && !words.includes(q);
    }
  }
  function toggleHidden(i, on) {
    if (on) S.hidden.add(i); else S.hidden.delete(i);
    const n = tree.rows.get(i);
    if (n) { n.eye.dataset.icon = on ? 'eyeOff' : 'eye'; hydrate(n.row); }
    applyObjects(); drawLines(); paintTree();
    if (S.selected === i) renderInspector();
  }

  function renderChrome() {
    const t = S.target; if (!t) return;
    const r = R(), res = S.result, src = S.source, m = F.MATERIALS[r.Material];
    const [label, cls] = statusOf(t, r);
    const tag = $('FractureState'); tag.textContent = label; tag.className = 'state-tag ' + ({ dyn: 'teal', baked: 'mint', stale: 'stale' }[cls] || 'off');
    $('FractureTab').textContent = `${t.name} · Fracture`;
    $('FractureTitle').textContent = `${t.name}`;
    $('FractureNote').textContent = t.kind === 'component' ? `${viewer.className()} · ${t.record ? t.record.name : 'missing mesh'} · ${src ? (src.kind === 'convex' ? 'closed source' : `open surface · ${formatCount(t.record.triangles)} tris`) : ''}` : `Specimen · ${t.note} · ${src ? fmtVol(src.volume) : ''}`;
    $('FractureClass').textContent = `${viewer.className()} · ${t.name}`;
    renderOwner();
    $('FractureOwnerId').textContent = t.id;
    $('FractureStorage').textContent = t.kind === 'component' ? 'Class' : 'Browser';
    const saved = $('FractureSaved'); saved.textContent = dirty() ? 'UNSAVED' : 'SAVED'; saved.style.color = dirty() ? '#e8c063' : '';
    $('FractureStatPieces').textContent = res ? String(res.metrics.pieces) : r.Enabled ? '—' : '1';
    $('FractureStatReleased').innerHTML = S.shares ? `${S.shares.releasedCount}<i>/ ${res.pieces.length}</i>` : '—';
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
      off.append(h('span', { dataset: { icon: 'fracture', size: '28', accent: 'teal' } }), h('b', {}, `${t.name} stays whole`), h('p', {}, 'Fracture is off for this object. Enable it to author a per-object recipe — material, impact, quality limits, physics and bake mode.'), b);
      hydrate(off);
    }
    if (!src) { off.hidden = false; off.innerHTML = `<b>Source mesh missing</b><p>${t.name} references a mesh that is not in Content. Re-import it through Geometry Compile.</p>`; }
    const banner = $('FractureBanner');
    banner.hidden = !(src && src.kind === 'mesh' && r.Enabled && S.phase === 'edit');
    if (!banner.hidden) banner.innerHTML = `<b>Surface preview</b> · ${t.record.name} is ${src.closed ? 'closed but not convex' : 'an open shell'}, so pieces are surface patches split at Voronoi borders. Closed caps need convex decomposition — pending in the native bake.`;
    const badge = $('FracturePhaseBadge');
    badge.hidden = S.phase === 'edit';
    if (!badge.hidden) { badge.textContent = ''; badge.className = 'phase-badge ' + S.phase; badge.append(h('span', { dataset: { icon: S.phase === 'play' ? 'play' : 'simulate', size: '12' } }), S.phase === 'play' ? 'PLAY · GAME VIEW' : 'SIMULATE · RIGID BODIES'); hydrate(badge); }
    metrics();
    $('FractureStrip').textContent = res ? `${res.metrics.pieces} PIECES · ${formatCount(res.metrics.tris)} TRIS · SOLVED IN ${res.ms.toFixed(0)} MS · ${m.label.toUpperCase()} · SEED ${r.Seed}` : r.Enabled ? '—' : 'FRACTURE OFF · SOURCE ONLY';
    $('FracturePhaseStrip').textContent = `FRACTURE EDITOR · ${S.phase.toUpperCase()}`;
    $('FractureRun').disabled = !src;
    readout();
  }
  function metrics() {
    const M = $('FractureMetrics'), res = S.result, src = S.source; M.textContent = '';
    const cell = (value, label, cls = '') => h('div', { class: cls }, h('b', { html: value }), h('span', {}, label));
    if (res && S.phase !== 'edit' && S.cache) {
      const sh = S.cache.shares;
      live.metricKinetic = cell(fmtJ(kineticNow()), 'KINETIC NOW');
      M.append(cell(`${sh.releasedCount}<small>/ ${res.pieces.length}</small>`, 'RELEASED'), live.metricKinetic,
        cell(fmtJ(sh.peak), 'MOST ENERGETIC FRAGMENT', 'hot'), cell(S.cache.settled !== null ? `${S.cache.settled.toFixed(2)}<small>s</small>` : '—', S.cache.settled !== null ? 'AT REST BY' : 'STILL MOVING AT END', S.cache.settled !== null ? 'ok' : 'warn'));
    } else if (res) {
      const mt = res.metrics;
      M.append(cell(String(mt.pieces), 'FRAGMENTS'),
        cell(mt.occupied !== null ? `${mt.occupied.toFixed(3)}<small>%</small>` : '—', mt.occupied !== null ? 'OCCUPIED VOLUME' : 'VOLUME · SURFACE ONLY', mt.occupied !== null && Math.abs(mt.occupied - 100) < 0.01 ? 'ok' : ''),
        cell(mt.minQ !== null ? mt.minQ.toFixed(3) : '—', 'MIN TRIANGLE QUALITY', mt.minQ !== null && mt.minQ < 0.01 ? 'warn' : ''),
        cell(mt.closed ? 'Closed' : src.kind === 'mesh' ? 'Open' : 'Uncapped', 'TOPOLOGY', mt.closed ? 'ok' : 'warn'));
    } else M.append(cell('1', 'FRAGMENTS'), cell(src && src.kind === 'convex' ? '100.000<small>%</small>' : '—', 'OCCUPIED VOLUME'), cell('—', 'MIN TRIANGLE QUALITY'), cell(src ? (src.kind === 'convex' ? 'Closed' : 'Open') : '—', 'TOPOLOGY'));
  }
  function readout() {
    const t = S.target, src = S.source, res = S.result, r = R(); if (!t) return;
    if (S.phase === 'play') { $('FractureReadout').textContent = ''; return; }
    const lines = [
      `target    ${t.name} · ${t.kind === 'component' ? 'StaticMeshComponent' : 'specimen'}`,
      `source    ${src ? (src.kind === 'convex' ? `analytical ${t.id} · ${fmtVol(src.volume)}` : `${t.record.name} · ${formatCount(t.record.triangles)} tris`) : 'missing'}`,
      `recipe    ${F.MATERIALS[r.Material].label} · ${formatCount(r.Energy)} J · seed ${r.Seed}${r.Enabled ? '' : ' · off'}`,
    ];
    if (res) {
      lines.push(`pieces    ${res.metrics.pieces} of ${res.plan.requested} requested · ceiling ${r.Ceiling}`);
      if (S.phase === 'simulate' && S.cache) {
        const st = Math.max(0, simTime());
        lines.push(`physics   t ${st.toFixed(2)} s · ${fmtJ(P.totalAt(S.cache, st))} kinetic · ${S.cache.shares.releasedCount} released`);
      } else {
        lines.push(`refused   ${res.stats.refusedSpan} span · ${res.stats.refusedNeedle} needle`);
        lines.push(`solve     ${res.ms.toFixed(0)} ms`);
      }
      if (S.selected >= 0) { const pc = res.pieces[S.selected]; lines.push(`selected  #${pc.id} · ${src.kind === 'convex' ? fmtVol(pc.volume) : fmtArea(pc.area)} · ${fmtMass(pc.mass)} · ${fmtJ(energyOf(S.selected))}`); }
    }
    $('FractureReadout').textContent = lines.join('\n');
  }
  function legend() {
    const L = $('FractureLegend'), res = S.result, src = S.source; let html = '';
    if (!res || S.mode === 'source') html = `<b>SOURCE</b><div style="margin-top:4px">Undivided geometry${res ? ' · seeds in teal' : ''}</div>`;
    else if (S.mode === 'pieces') html = `<b>PIECES · ${res.pieces.length}</b><div style="margin-top:4px">One hue per fragment · cut faces darker</div>`;
    else if (S.mode === 'material') { const m = F.MATERIALS[R().Material]; html = `<b>${m.label.toUpperCase()}</b><div style="margin-top:6px;display:flex;gap:10px;justify-content:flex-end"><span><i style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${intHex(m.color)};margin-right:5px"></i>Surface</span><span><i style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${intHex(m.interior)};margin-right:5px"></i>Fracture faces</span></div>`; }
    else if (S.mode === 'size') { const v = res.pieces.map((p) => (src.kind === 'convex' ? p.volume : p.area)); const f = src.kind === 'convex' ? fmtVol : fmtArea; html = `<b>${src.kind === 'convex' ? 'PIECE VOLUME' : 'PATCH AREA'} · LOG</b><div class="ramp" style="background:${RAMP_CSS}"></div><div class="ends"><span>${f(Math.min(...v))}</span><span>${f(Math.max(...v))}</span></div>`; }
    else { const { lo, hi } = energyRange(); html = `<b>${physical() ? 'KINETIC ENERGY · LIVE' : 'RECEIVED ENERGY'} · ${S.energyScale.toUpperCase()}</b><div class="ramp" style="background:${RAMP_CSS}"></div><div class="ends"><span>LEAST · ${S.energyScale === 'log' ? '≤ ' : ''}${fmtJ(lo)}</span><span>MOST · ${fmtJ(hi)}</span></div>`; }
    L.hidden = !src; L.innerHTML = html;
  }
  function log(text, cls = '') { S.logLines.push([new Date().toLocaleTimeString(), text, cls]); if (S.logLines.length > 160) S.logLines.shift(); if ($('FractureLogDrawer').classList.contains('open')) renderLog(); }
  function renderLog() { const host = $('FractureLog'); host.innerHTML = S.logLines.map(([time, t, c]) => `<div class="${c}"><span class="dim">${time}</span>  ${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`).join(''); host.scrollTop = host.scrollHeight; }

  function renderTable() {
    const host = $('FragmentTable'), res = S.result, src = S.source; host.textContent = '';
    if (!res) { $('FragmentSummary').textContent = 'Fracture is off'; return; }
    const convex = src.kind === 'convex';
    const cols = [['#', 'id'], [convex ? 'VOLUME' : 'AREA', 'size'], ['MASS', 'mass'], ['FACES · CUT', 'faces'], ['SPAN', 'span'], ['MIN Q', 'minQ'], ['DIST.', 'distance'], ['PRIORITY', 'priority'], ['ENERGY', 'energy']];
    const key = { id: (p) => p.id, size: (p) => (convex ? p.volume : p.area), mass: (p) => p.mass, faces: (p) => p.faces, span: (p) => p.span, minQ: (p) => p.minQ, distance: (p) => p.distance, priority: (p) => p.priority, energy: (p) => S.shares.energy[p.id] }[S.tableSort];
    const list = [...res.pieces].sort((a, b) => (S.tableSort === 'id' || S.tableSort === 'distance' ? key(a) - key(b) : key(b) - key(a)));
    const maxSize = Math.max(...res.pieces.map((p) => (convex ? p.volume : p.area)));
    const table = h('table', {}, h('thead', {}, h('tr', {}, ...cols.map(([label, k]) => { const th = h('th', { class: S.tableSort === k ? 'sorted' : null }, label); th.addEventListener('click', () => { S.tableSort = k; renderTable(); }); return th; }))));
    const body = h('tbody');
    list.forEach((p) => {
      const sz = convex ? p.volume : p.area;
      const tr = h('tr', { class: p.id === S.selected ? 'active' : null },
        h('td', {}, h('i', { style: { background: cssOf(pieceColour(p.id)) } }), `#${p.id}`),
        h('td', {}, h('span', { class: 'bar', style: { width: Math.max(2, (sz / maxSize) * 46) + 'px' } }), convex ? fmtVol(sz) : fmtArea(sz)),
        h('td', {}, fmtMass(p.mass)), h('td', {}, convex ? `${p.faces} · ${p.cutFaces}` : `${p.faces} tris`), h('td', {}, Number.isFinite(p.span) ? `${(p.span * 1000).toFixed(0)} mm` : '—'),
        h('td', {}, convex ? p.minQ.toFixed(3) : '—'), h('td', {}, `${p.distance.toFixed(2)} m`), h('td', {}, p.priority.toFixed(2)), h('td', {}, fmtJ(S.shares.energy[p.id])));
      tr.addEventListener('click', () => select(p.id === S.selected ? -1 : p.id));
      body.append(tr);
    });
    table.append(body); host.append(table);
    $('FragmentSummary').textContent = `${res.pieces.length} ${convex ? 'closed cells' : 'surface patches'} · total ${fmtMass(res.pieces.reduce((a, p) => a + p.mass, 0))} · click a row to select · click a header to sort`;
  }

  // -------------------------------------------------------------------------------------------- inspector
  function renderInspector() {
    const host = $('FractureInspector'), t = S.target, r = R(), src = S.source;
    if (!t) return;
    const scroll = host.scrollTop;
    host.textContent = '';
    for (const k of Object.keys(live)) delete live[k];
    const sw = mswitch(r.Enabled, (on) => change('Enabled', on, { rebuild: true, immediate: true }), 'Enable fracture');
    sw.classList.add('fx-enable');
    live.heroPieces = heroTile({ label: 'Fragments', cream: true });
    live.heroKinetic = heroTile({ label: 'Kinetic energy' });
    live.heroReleased = heroTile({ label: 'Released' });
    live.active = h('span', { class: 'mi-active' }, '');
    host.append(h('div', { class: 'mi-head' },
      h('div', { class: 'mi-kicker' }, 'Fracture & Physics', h('em', {}, `${S.phase.toUpperCase()} · ${r.Mode === 'baked' ? 'BAKED' : 'DYNAMIC'}`)),
      h('div', { class: 'mi-title' },
        h('span', { class: 'fx-badge' }, t.kind === 'component' && t.record?.icon ? h('img', { src: t.record.icon, alt: '' }) : h('span', { dataset: { icon: t.kind === 'component' ? 'mesh' : t.icon, size: '22', accent: 'teal' } })),
        h('div', {}, h('b', { class: 'fx-name' }, t.name), live.active), sw),
      h('div', { class: 'mi-hero' }, live.heroPieces, live.heroKinetic, live.heroReleased)));
    const input = h('input', { type: 'search', placeholder: 'Find a setting…', value: S.paramSearch, autocomplete: 'off', 'aria-label': 'Find a setting' });
    input.addEventListener('input', () => { S.paramSearch = input.value; applySearch(host, S.paramSearch); });
    const foldAll = h('button', { class: 'mi-icon-btn', title: 'Collapse / expand all sections', 'aria-label': 'Collapse or expand all', dataset: { icon: 'layers', size: '13' } });
    foldAll.addEventListener('click', () => { const all = [...host.querySelectorAll('.mi-section')], close = all.some((c) => !c.classList.contains('closed')); all.forEach((c) => c.classList.toggle('closed', close)); folds.setAll(all.map((c) => c.dataset.sec), close); });
    host.append(h('div', { class: 'mi-search' }, h('label', { class: 'search' }, h('span', { dataset: { icon: 'search', size: '14' } }), input), foldAll));
    if (S.phase === 'play') host.append(h('div', { class: 'fx-lock' }, h('span', { dataset: { icon: 'play', size: '13' } }), h('span', {}, 'Playing — the recipe is read-only. Switch to ', h('button', { onclick: () => setPhase('edit') }, 'Edit'), ' or ', h('button', { onclick: () => setPhase('simulate') }, 'Simulate'), ' to change it.')));
    const body = h('div', { class: 'fx-sections' + (r.Enabled && src ? '' : ' inspector-off') + (S.phase === 'play' ? ' fx-readonly' : '') });
    if (S.selected >= 0 && S.result) body.append(fragmentSection());
    body.append(budgetSection(), materialSection(), impactSection(), qualitySection(), simulationSection(), visualSection(), presetSection(), bakeSection(), receiptSection());
    host.append(body);
    refreshLive();
    applySearch(host, S.paramSearch);
    hydrate(host);
    host.scrollTop = scroll;
  }

  function fragmentSection() {
    const i = S.selected, pc = S.result.pieces[i], held = !S.shares.released[i], ov = S.overrides.get(pc.id) || 'auto';
    live.fragSwatch = h('span', { class: 'fx-frag-swatch' });
    live.fragNote = h('small', {}, '');
    live.fragFacts = facts([]);
    const breakOff = segmented([['auto', 'Auto'], ['held', 'Held'], ['released', 'Released']], ov, (v) => {
      if (v === 'auto') S.overrides.delete(pc.id); else S.overrides.set(pc.id, v);
      log(`fragment #${pc.id} ${v === 'auto' ? 'back to automatic break-off' : v}`, 'ok');
      reshare(); renderInspector();
    }, { full: true, label: 'Break-off' });
    const btn = (icon, label, fn) => h('button', { class: 'tool', onclick: fn }, h('span', { dataset: { icon, size: '13' } }), label);
    return section('fragment', { icon: 'fragment', title: `Fragment ${pad(pc.id)}`, tag: held ? 'HELD' : 'RELEASED', accent: '#ffb238' },
      h('div', { class: 'fx-frag-head' }, live.fragSwatch, h('div', {}, h('b', {}, `Fragment ${pad(pc.id)} of ${S.result.pieces.length}`), live.fragNote)),
      live.fragFacts,
      field('Break-off', breakOff, { search: 'break off held released anchor' }),
      hint('Auto releases the fragment once its share of the impact reaches the release energy. Held keeps it in the remaining body; Released always lets it go.'),
      switchRow('Hidden in preview', S.hidden.has(pc.id), (on) => toggleHidden(pc.id, on), 'Also from the outliner eye'),
      h('div', { class: 'fx-btn-row' }, btn('frame', 'Focus fragment', () => focusFragment(i)), btn('root', 'Whole object', () => select(-1))));
  }
  function fillFragment() {
    if (!live.fragFacts || S.selected < 0 || !S.result) return;
    const i = S.selected, pc = S.result.pieces[i], convex = S.source.kind === 'convex', E = S.shares.energy[i], released = S.shares.released[i];
    const launch = released ? Math.min(40, Math.sqrt((2 * 0.85 * E) / pc.mass)) : 0;
    live.fragSwatch.style.background = cssOf(pieceColour(i));
    live.fragNote.textContent = `${fmtMass(pc.mass)} · ${fmtJ(E)} received · ${released ? 'released' : 'held'}`;
    const list = [
      ['Mass', fmtMass(pc.mass)], [convex ? 'Volume' : 'Patch area', convex ? fmtVol(pc.volume) : fmtArea(pc.area)],
      ['Faces · cut', convex ? `${pc.faces} · ${pc.cutFaces}` : `${pc.faces} tris`], ['From impact', `${pc.distance.toFixed(3)} m`],
      ['Cut priority', pc.priority.toFixed(3)], ['Received energy', fmtJ(E), 'hot'],
      ['Launch speed', released ? `${launch.toFixed(2)} m/s` : 'held'], ['Energy rank', `${1 + [...S.shares.energy].filter((x) => x > E).length} of ${S.result.pieces.length}`],
    ];
    if (physical() && simTime() > 0) {
      const st = simTime(); P.sample(S.cache, st, i, pose); P.sample(S.cache, Math.min(S.cache.duration, st + 1 / P.RATE), i, poseNext);
      const speed = Math.hypot(...poseNext.x.map((x, k) => (x - pose.x[k]) * P.RATE));
      list.push(['Speed now', `${speed.toFixed(2)} m/s`], ['Kinetic now', fmtJ(pose.kinetic), 'hot'], ['Height', `${(pose.x[1] - S.source.bounds.lo[1]).toFixed(2)} m`], ['Time', `${st.toFixed(2)} s`]);
    }
    live.fragFacts.fill(list);
  }

  function budgetSection() {
    live.budgetSplit = h('div', { class: 'fx-stack' });
    live.budgetCeiling = h('div', { class: 'fx-stack' });
    return section('budget', { icon: 'energy', title: 'Energy budget', tag: '', accent: '#ffb238' }, live.budgetSplit, sub('Pieces against the ceiling', 'LOG SCALE'), live.budgetCeiling,
      hint('Crack surface is bought at 2·Gc per m². The transfer fraction of what is left launches the fragments, and the rest becomes heat and sound.'));
  }
  function fillBudget() {
    const host = live.budgetSplit, ceil = live.budgetCeiling; if (!host) return;
    host.textContent = ''; ceil.textContent = '';
    const r = R(), res = S.result, sh = S.shares;
    const sec = host.closest('.mi-section');
    if (!res || !sh) { host.append(hint('Fracture is off — no energy is spent.')); sec?.setTag?.('OFF'); return; }
    const total = Math.max(1e-9, r.Energy), lost = Math.max(0, total - sh.spent - sh.kinetic);
    const parts = [['Crack surface', sh.spent, '#38d1c4', `${fmtArea(res.plan.crackArea)} at 2·Gc`], ['Fragment motion', sh.kinetic, '#ffb238', `${Math.round(sim().Transfer * 100)} % transfer`], ['Heat & sound', lost, '#3a3a3a', 'not simulated']];
    host.append(h('div', { class: 'mi-budget-bar' }, ...parts.map(([, v, c]) => h('i', { style: { width: `${(v / total) * 100}%`, background: c } }))),
      h('div', { class: 'mi-budget-legend' }, h('span', {}, `${fmtJ(total)} impact`), h('em', {}, `${sh.releasedCount} OF ${res.pieces.length} RELEASED`)),
      ...parts.map(([label, v, c, note]) => h('div', { class: 'mi-budget-row' }, h('span', { class: 'mi-dot', style: { background: c } }), h('span', {}, label), h('small', {}, note), h('code', {}, fmtJ(v)))));
    const p = res.plan, max = Math.max(p.requested, r.Ceiling, 1), scale = (v) => Math.min(100, (Math.log(1 + v) / Math.log(1 + Math.max(max, 2))) * 100);
    ceil.append(h('div', { class: 'budget-bar', title: 'Accepted pieces (fill) against the ceiling (amber mark), log scale' }, h('i', { style: { width: scale(res.metrics.pieces) + '%' } }), h('em', { style: { left: `calc(${scale(r.Ceiling)}% - 1px)` } })),
      facts([['Requested', formatCount(p.requested)], ['Ceiling', String(r.Ceiling)], ['Accepted', String(res.metrics.pieces)], ['Refused', String(res.metrics.refused)]]));
    sec?.setTag?.(p.capped ? 'CEILING REACHED' : 'WITHIN CEILING');
  }

  function materialSection() {
    const r = R(), m = F.MATERIALS[r.Material];
    const grid = h('div', { class: 'mi-options', role: 'radiogroup', 'aria-label': 'Fracture material' });
    F.MATERIAL_ORDER.forEach((id) => {
      const mm = F.MATERIALS[id];
      const b = h('button', { class: 'mi-option' + (id === r.Material ? ' active' : ''), role: 'radio', 'aria-checked': String(id === r.Material), dataset: { search: `${mm.label} ${mm.mode}`.toLowerCase() } },
        h('span', { class: 'mi-dot', style: { background: intHex(mm.color) } }), h('span', {}, h('b', {}, mm.label), h('small', {}, mm.mode.replace('-', ' · '))), h('em', {}, `${mm.Gc}`));
      b.addEventListener('click', () => change('Material', id, { rebuild: true }));
      grid.append(b);
    });
    const third = m.stored ? ['Stored energy', `${(m.stored / 1000).toFixed(0)} kJ/m³`] : m.grain > 1 ? ['Grain ratio · X', `${m.grain}× across`] : ['Impact focus', `${(m.cluster * 100).toFixed(0)} %`];
    return section('material', { icon: 'material', title: 'Material', tag: m.label.toUpperCase() },
      grid, facts([['Crack resistance · Gc', `${m.Gc} J/m²`], ['Density', `${m.density.toLocaleString('en-US')} kg/m³`], [third[0], third[1]], ['Response', m.mode.replace('-', ' · ')]]),
      hint(`${m.note} Fracture response only — not surface appearance.`));
  }

  function impactSection() {
    const r = R();
    live.falloff = h('div', { class: 'fx-graph' });
    const btn = (icon, label, fn, extra = {}) => h('button', { class: 'tool' + (extra.active ? ' active' : ''), title: extra.title || null, onclick: fn }, icon ? h('span', { dataset: { icon, size: '13', accent: extra.accent || null } }) : null, label);
    const imp = vecRow({ label: 'XYZ', value: [r.X, r.Y, r.Z], step: 0.005, digits: 3, onInput: (v) => { S.recipe.X = v[0]; S.recipe.Y = v[1]; S.recipe.Z = v[2]; schedule(false); drawLines(); renderChrome(); }, onReset: () => [0, 0, 0] });
    return section('impact', { icon: 'impact', title: 'Impact', tag: `${fmtJ(r.Energy)} · SEED ${r.Seed}`, accent: '#ffb238' },
      live.falloff,
      numberRow({ label: 'Impact energy', unit: 'J', min: 10, max: 50000, digits: 0, value: Math.max(10, r.Energy), curve: 'log', onInput: (v) => change('Energy', v), search: 'impact energy joules' }),
      numberRow({ label: 'Pattern seed', unit: '#', min: 1, max: 999999, step: 1, digits: 0, value: r.Seed, onInput: (v) => change('Seed', Math.round(v)), search: 'pattern seed random' }),
      h('div', { class: 'fx-btn-row', dataset: { search: 'seed shuffle' } },
        btn('dice', 'Shuffle seed', () => { S.recipe.Seed = 1 + Math.floor(Math.random() * 999998); log(`seed    shuffled to ${S.recipe.Seed}`, 'ok'); solve(); renderInspector(); renderChrome(); }),
        btn(null, 'Reset to 42', () => { S.recipe.Seed = 42; solve(); renderInspector(); renderChrome(); })),
      sub('Impact point', 'LOCAL METRES'),
      h('div', { class: 'fx-impact', dataset: { search: 'impact point position pick' } }, imp),
      h('div', { class: 'fx-btn-row', dataset: { search: 'impact point pick default' } },
        btn('impact', 'Pick on surface', () => setImpactTool(!S.impactTool), { active: S.impactTool, accent: 'amber', title: 'Click the surface to place (I)' }),
        btn(null, 'Default', () => { const p = F.defaultImpact(S.source); S.recipe.X = +p[0].toFixed(3); S.recipe.Y = +p[1].toFixed(3); S.recipe.Z = +p[2].toFixed(3); solve(); renderInspector(); renderChrome(); })),
      hint('Double-click the preview to place the impact. Seeds near it get cut priority, so fragments are finer there and coarser far away.'));
  }

  function qualitySection() {
    const r = R();
    live.histogram = h('div', { class: 'fx-graph' });
    return section('quality', { icon: 'quality', title: 'Fragment quality', tag: 'LIMITS, NOT PROMISES' },
      live.histogram,
      numberRow({ label: 'Fragment ceiling', unit: 'pcs', min: 2, max: 160, step: 1, digits: 0, value: r.Ceiling, onInput: (v) => change('Ceiling', Math.round(v)) }),
      numberRow({ label: 'Minimum span', unit: 'm', min: 0.002, max: 0.3, step: 0.001, digits: 3, value: r.MinimumSize, onInput: (v) => change('MinimumSize', v) }),
      switchRow('Needle rejection', r.NeedleRejection, (on) => change('NeedleRejection', on), 'Merge cells thinner than the minimum span'),
      switchRow('Closed caps', r.ClosedCaps, (on) => change('ClosedCaps', on), 'Cap every cut so pieces are closed solids'),
      switchRow('Quality triangulation', r.QualityTriangulation, (on) => change('QualityTriangulation', on), 'Fan cut faces from the centroid (fewer slivers)'),
      hint('Seeds closer than twice the minimum span are refused. The ceiling caps the count — it never forces bad fragments to reach it.'));
  }

  function simulationSection() {
    const s = sim();
    live.simFacts = facts([]);
    const overrides = S.overrides.size;
    const go = h('button', { class: 'tool fx-primary', onclick: () => { if (S.phase === 'edit') setPhase('simulate'); else { reshare({ now: true }); S.time = 0; setPlaying(true); } } },
      h('span', { dataset: { icon: S.phase === 'edit' ? 'simulate' : 'reset', size: '13' } }), S.phase === 'edit' ? 'Simulate' : 'Re-simulate');
    const reset = h('button', { class: 'tool', disabled: !overrides || null, onclick: () => { S.overrides.clear(); log('fragment overrides cleared', 'warn'); reshare(); renderInspector(); } }, overrides ? `Reset ${overrides} override${overrides > 1 ? 's' : ''}` : 'No overrides');
    return section('simulation', { icon: 'simulate', title: 'Simulation', tag: S.cache ? `${S.cache.steps} STEPS · ${S.cache.ms.toFixed(0)} MS` : 'RIGID BODIES', accent: '#38d1c4' },
      numberRow({ label: 'Duration', unit: 's', min: 1, max: 10, step: 0.5, digits: 1, value: s.Duration, onInput: (v, final) => simChange('Duration', v, final), search: 'duration length time' }),
      numberRow({ label: 'Energy transfer', unit: '%', min: 0, max: 100, step: 1, digits: 0, value: s.Transfer * 100, onInput: (v) => simChange('Transfer', v / 100), search: 'energy transfer kinetic' }),
      numberRow({ label: 'Release energy', unit: 'J', min: 0.1, max: 200, digits: 1, value: Math.max(0.1, s.Release), curve: 'log', onInput: (v) => simChange('Release', v), note: 'Fragments receiving less stay held in the remaining body', search: 'release energy threshold held' }),
      numberRow({ label: 'Gravity', unit: 'm/s²', min: 0, max: 30, step: 0.01, digits: 2, value: s.Gravity, onInput: (v) => simChange('Gravity', v) }),
      numberRow({ label: 'Bounce', unit: '×', min: 0, max: 0.95, step: 0.01, digits: 2, value: s.Restitution, onInput: (v) => simChange('Restitution', v), search: 'bounce restitution' }),
      numberRow({ label: 'Friction', unit: 'μ', min: 0, max: 1.5, step: 0.01, digits: 2, value: s.Friction, onInput: (v) => simChange('Friction', v) }),
      switchRow('Fragment collisions', s.Collisions, (on) => simChange('Collisions', on), 'Pieces bump into each other (bounding spheres)'),
      live.simFacts,
      h('div', { class: 'fx-btn-row' }, go, reset),
      hint('A preview bake at 240 Hz, cached for scrubbing. The runtime solver is separate — this shows how the recipe breaks, not final gameplay physics.'));
  }
  function fillSimulation() {
    if (!live.simFacts) return;
    const sh = S.shares, c = S.cache;
    if (!sh) { live.simFacts.fill([['Kinetic budget', '—'], ['Released', '—']]); return; }
    const list = [['Kinetic budget', fmtJ(sh.kinetic), 'hot'], ['Released', `${sh.releasedCount} of ${S.result.pieces.length}`], ['Held', String(S.result.pieces.length - sh.releasedCount)], ['Most energetic', fmtJ(sh.peak)]];
    if (c) list.push(['Baked', `${c.steps} steps · ${c.ms.toFixed(0)} ms`], ['At rest by', c.settled !== null ? `${c.settled.toFixed(2)} s` : 'still moving']);
    else list.push(['Bake', S.phase === 'edit' ? 'on Simulate' : 'pending']);
    live.simFacts.fill(list);
  }

  function visualSection() {
    const colourBy = segmented([['pieces', 'Pieces'], ['material', 'Material'], ['size', 'Size'], ['energy', 'Energy']], S.mode === 'source' ? 'pieces' : S.mode, (v) => setMode(v), { full: true, label: 'Colour fragments by' });
    live.ramp = h('div', { class: 'mi-ramp' });
    return section('visual', { icon: 'heat', title: 'Visualisation', tag: MODE_LABEL[S.mode].toUpperCase() },
      field('Colour fragments by', colourBy, { search: 'colour color mode pieces material size energy heat' }),
      S.mode === 'energy' ? field('Energy scale', segmented([['log', 'Log'], ['linear', 'Linear']], S.energyScale, (v) => { S.energyScale = v; recolour(); renderInspector(); }, { full: true, label: 'Energy scale' }), { search: 'energy scale log linear' }) : null,
      S.mode === 'energy' ? live.ramp : null,
      S.mode === 'energy' ? hint(physical() ? 'Live kinetic energy of every fragment: red while it flies, cooling to blue as it comes to rest.' : 'Each fragment’s share of the impact energy: red near the hit, blue far away. Simulate turns this into live kinetic energy.') : null,
      switchRow('Velocity vectors', S.vectors, (on) => { S.vectors = on; drawLines(); }, 'Simulate · arrow = 60 ms of travel'),
      switchRow('Voronoi seeds', S.seeds, () => $('FractureSeeds').click(), 'Edit · teal crosses'));
  }
  function fillRamp() {
    if (!live.ramp) return;
    const { lo, hi } = energyRange();
    live.ramp.innerHTML = `<div class="bar" style="background:${RAMP_CSS}"></div><div class="ends"><span><b>Least</b> ${S.energyScale === 'log' ? '≤ ' : ''}${fmtJ(lo)}</span><span><b>Most</b> ${fmtJ(hi)}</span></div>`;
  }

  function presetSection() {
    const list = h('div', { class: 'mi-options one' });
    PRESETS.forEach((p) => {
      const b = h('button', { class: 'mi-option', title: 'Apply to the current recipe (impact and seed are kept)', dataset: { search: `${p.label} ${p.note}`.toLowerCase() } },
        h('span', { class: 'mi-option-ico', dataset: { icon: p.icon, size: '15', accent: 'teal' } }), h('span', {}, h('b', {}, p.label), h('small', {}, p.note)), h('em', {}, 'APPLY'));
      b.addEventListener('click', () => { Object.assign(S.recipe, p.recipe, { Enabled: true }); log(`preset  ${p.label} applied (${p.note})`, 'ok'); S.shown = S.separation; solve(); renderAll(); });
      list.append(b);
    });
    return section('presets', { icon: 'sample', title: 'Recipe presets', tag: `${PRESETS.length} PRESETS` }, list);
  }

  function bakeSection() {
    const r = R();
    live.bake = h('div', { class: 'fx-bake-body' });
    return section('bake', { icon: 'bake', title: 'Bake', tag: r.Mode === 'baked' ? 'STORED GEOMETRY' : 'ON DEMAND' },
      field('Precompute', segmented([['dynamic', 'Dynamic'], ['baked', 'Baked']], r.Mode, (v) => change('Mode', v, { rebuild: true }), { full: true, label: 'Fracture execution' }), { search: 'precompute dynamic baked' }),
      live.bake);
  }
  function fillBake() {
    const host = live.bake; if (!host) return;
    host.textContent = '';
    const r = R(), res = S.result, src = S.source;
    if (r.Mode === 'dynamic') { host.append(hint(`Fragments are generated on impact from this recipe. Nothing is stored; the preview solve took ${res ? res.ms.toFixed(0) : '—'} ms in this browser.`)); return; }
    const sig = src ? F.signature(src, r) : null, ready = r.Baked && r.Baked.signature === sig;
    const status = h('div', { class: 'bake-status ' + (ready ? 'ready' : r.Baked ? 'stale' : '') }, h('i'),
      h('div', {}, h('b', {}, ready ? 'Baked · ready' : r.Baked ? 'Stale · recipe changed since bake' : 'Not baked yet'),
        h('small', {}, r.Baked ? `${r.Baked.pieces} ${src?.kind === 'mesh' ? 'patches' : 'closed pieces'} · ${fmtBytes(r.Baked.bytes)} · ${new Date(r.Baked.at).toLocaleString()}` : res ? `Would store ${res.metrics.pieces} pieces · ${fmtBytes(res.metrics.bytes)}` : '—')));
    const bake = h('button', { class: 'tool fx-primary', disabled: !res || null, onclick: () => {
      S.recipe.Baked = { signature: sig, pieces: res.metrics.pieces, tris: res.metrics.tris, bytes: res.metrics.bytes, at: Date.now() };
      log(`bake    ${res.metrics.pieces} pieces · ${fmtBytes(res.metrics.bytes)} · signature ${sig}`, 'ok'); renderChrome(); fillBake(); fillReceipt();
    } }, h('span', { dataset: { icon: 'bake', size: '13' } }), ready ? 'Rebake' : 'Bake now');
    const clear = h('button', { class: 'tool', disabled: !r.Baked || null, onclick: () => { S.recipe.Baked = null; log('bake    cleared', 'warn'); renderChrome(); fillBake(); } }, 'Clear');
    host.append(hint('The closed fragment geometry is stored with the object, so no fracture work happens at runtime.'), status, h('div', { class: 'fx-btn-row' }, bake, clear),
      switchRow('Precompute SDF per piece', r.PieceSdf, (on) => { S.recipe.PieceSdf = on; fillBake(); renderChrome(); }, 'R16F distance field per fragment'));
    if (r.PieceSdf) {
      const pieces = res ? res.metrics.pieces : r.Baked?.pieces || 0, per = r.SdfResolution ** 3 * 2, total = per * pieces;
      host.append(field('SDF resolution', segmented([[32, '32³'], [64, '64³'], [128, '128³']], r.SdfResolution, (v) => { S.recipe.SdfResolution = v; fillBake(); renderChrome(); }, { full: true, label: 'SDF resolution per piece' })),
        facts([['Format', 'R16F signed distance'], ['Per piece', fmtBytes(per)], [`${pieces} pieces`, fmtBytes(total), total > 64 * 1048576 ? 'warn' : '']]),
        hint('Per-piece distance fields are generated by the native bake; this window records the request and its memory cost.'));
    }
    hydrate(host);
  }

  function receiptSection() { live.receipt = facts([]); return section('receipt', { icon: 'receipt', title: 'Geometry receipt', tag: 'WHAT WOULD BE STORED' }, live.receipt); }
  function fillReceipt() {
    const host = live.receipt; if (!host) return;
    const res = S.result, src = S.source, r = R();
    if (!res) { host.fill([['Fracture', r.Enabled ? 'no result yet' : 'off — nothing stored']]); return; }
    const mt = res.metrics, convex = src.kind === 'convex', total = res.pieces.reduce((a, p) => a + p.mass, 0);
    host.fill([
      ['Source', convex ? 'Closed convex · analytical' : `${src.closed ? 'Closed' : 'Open'} surface · mesh`],
      ['Pieces', `${mt.pieces} ${convex ? (r.ClosedCaps ? 'closed cells' : 'uncapped cells') : 'patches'}`],
      ['Triangles', formatCount(mt.tris)], ['Vertices (unshared)', formatCount(mt.vertices)],
      ['Fracture surface', convex ? fmtArea(mt.cutArea) : 'pending caps'],
      ['Occupied volume', mt.occupied !== null ? `${mt.occupied.toFixed(4)} %` : '—'],
      ['Smallest', convex ? fmtVol(mt.smallest) : fmtArea(mt.smallest)], ['Largest', convex ? fmtVol(mt.largest) : fmtArea(mt.largest)],
      ['Total mass', `${fmtMass(total)}${convex ? '' : ' (4 mm shell)'}`],
      ['Refused', `${mt.refused} (${res.stats.refusedSpan} span · ${res.stats.refusedNeedle} needle)`],
      ['Geometry memory', fmtBytes(mt.bytes)], ['Recipe signature', `<code>${F.signature(src, r)}</code>`],
    ]);
  }

  function fillHero() {
    if (!live.heroPieces) return;
    const r = R(), res = S.result, sh = S.shares;
    live.active.textContent = S.selected >= 0 ? `SELECTED · FRAGMENT ${pad(S.selected)}` : 'SELECTED · WHOLE OBJECT';
    if (!res || !sh) { live.heroPieces.set('1', r.Enabled ? 'solving' : 'fracture off'); live.heroKinetic.set('—', ''); live.heroReleased.set('—', ''); return; }
    live.heroPieces.set(`${res.metrics.pieces}<i> / ${r.Ceiling}</i>`, `${formatCount(res.plan.requested)} requested`);
    if (physical()) { live.heroKinetic.set(fmtJ(kineticNow()), `now · ${fmtJ(sh.kinetic)} at impact`); }
    else live.heroKinetic.set(fmtJ(sh.kinetic), `of ${fmtJ(r.Energy)} · ${Math.round(sim().Transfer * 100)} % transfer`);
    live.heroReleased.set(`${sh.releasedCount}<i> / ${res.pieces.length}</i>`, `release ≥ ${fmtJ(sim().Release)}`);
  }
  // Inspector work on each playback tick: only the time-dependent numbers.
  function refreshMotion() {
    fillHero(); fillFragment();
    if (live.metricKinetic && S.cache) live.metricKinetic.firstChild.innerHTML = fmtJ(kineticNow());
    if (S.mode === 'energy') legend();
  }
  function refreshLive() {
    if (!S.target) return;
    fillHero(); fillBudget(); fillFragment(); fillSimulation(); fillRamp(); fillBake(); fillReceipt();
    if (live.falloff) live.falloff.innerHTML = falloffSvg();
    if (live.histogram) live.histogram.innerHTML = histogramSvg();
    legend();
  }

  function falloffSvg() {
    const res = S.result, W = 300, H = 108, x0 = 14, x1 = W - 10, y0 = 12, y1 = H - 20;
    if (!res) return `<svg class="graph" viewBox="0 0 ${W} ${H}"><path class="grid" d="M${x0} ${y0}V${y1}H${x1}"/><text x="${x0 + 6}" y="${y0 + 10}">cut priority</text></svg>`;
    const size = Math.max(...S.source.bounds.size), dMax = size * 1.1, f = res.plan.falloff;
    const X = (d) => x0 + (Math.min(d, dMax) / dMax) * (x1 - x0), Y = (p) => y1 - p * (y1 - y0);
    let path = ''; for (let i = 0; i <= 40; i++) { const d = (i / 40) * dMax; path += `${i ? 'L' : 'M'}${X(d).toFixed(1)} ${Y(Math.exp(-d / f)).toFixed(1)}`; }
    const dots = res.pieces.map((p) => `<circle class="dot${p.id === S.selected ? ' sel' : ''}" cx="${X(p.distance).toFixed(1)}" cy="${Y(p.priority).toFixed(1)}" r="${p.id === S.selected ? 3.6 : 2.2}" style="fill:${S.mode === 'energy' ? cssOf(ramp(energyT(S.shares.energy[p.id]))) : ''}"/>`).join('');
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
    const objects = S.result ? S.result.pieces.map((pc, i) => ({ mesh: gpu.pieces[i], mode: 'debug', matrix: translate(offsetOf({ ...pc })), tint: S.mode === 'energy' ? ramp(energyT(S.shares.energy[i])) : undefined })) : [{ mesh: gpu.source, mode: 'lit' }];
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
    recipe.Simulation = P.normalizeSimulation(S.recipe.Simulation);
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
    const sh = S.shares;
    const out = {
      format: 'frontier.fracture.v2', owner: { kind: t.kind, id: t.id, name: t.name, className: t.kind === 'component' ? viewer.className() : null, mesh: t.record?.name || null },
      recipe, signature: src ? F.signature(src, S.recipe) : null,
      receipt: res ? { ...res.metrics, requested: res.plan.requested, crackArea: res.plan.crackArea, solveMs: Math.round(res.ms) } : null,
      simulation: sh ? { ...P.normalizeSimulation(S.recipe.Simulation), kinetic: +sh.kinetic.toFixed(2), crackEnergy: +sh.spent.toFixed(2), released: sh.releasedCount, settled: S.cache?.settled ?? null, overrides: Object.fromEntries(S.overrides) } : null,
      pieces: res ? res.pieces.map((p) => ({ id: p.id, centre: p.centre.map((v) => +v.toFixed(4)), volume: +(p.volume || 0).toFixed(6), area: +p.area.toFixed(5), mass: +p.mass.toFixed(3), priority: +p.priority.toFixed(3), energy: +sh.energy[p.id].toFixed(3), released: !!sh.released[p.id] })) : [],
    };
    download(`${t.name}.fracture.json`, JSON.stringify(out, null, 2), 'application/json');
  }

  return { open, close, isOpen: () => !$('Fracture').hidden };
}
