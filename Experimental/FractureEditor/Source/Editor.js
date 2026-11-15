// Fracture Editor: a standalone page for fracturing analytical primitives.
// Edit sets the shape, impact and recipe (re-fractured live), Sim bakes rigid-body motion you can scrub, and Play
// runs it in real time with a short pre-roll and a shock ring. The playback strip in the viewport footer drives both.
import { Viewport, LineBuilder } from './Renderer.js';
import { invert } from './MathUtils.js';
import { PRIMITIVES, primitiveById, defaultDims, normalizeDims, describe, DETAIL } from './Primitives.js';
import { buildSource, fracture, defaultImpact, MATERIALS, MATERIAL_ORDER, normalizeRecipe, histogram, DEFAULT_RECIPE, METHODS, BUDGETS, rehit, realtimeCap, cellCost } from './Fracture.js';
import { simulate, sample, totalAt, poseMatrix, impactShares, normalizeSimulation, SIMULATION_DEFAULTS } from './FractureSimulation.js';
import { hydrateGlyphs, glyph } from './Glyphs.js';
import { Diagnostics } from './Diagnostics.js';

const $ = (id) => document.getElementById(id);
const PREROLL = 0.6;
const SAVE_KEY = 'frontier.fracture-editor.v1';
const RAMP = [[0.188, 0.42, 0.949], [0.184, 0.647, 0.541], [0.839, 0.941, 0.416], [1, 0.541, 0.239], [0.941, 0.302, 0.239]];
const RAMP_AT = [0, 0.3, 0.55, 0.78, 1];

// ---------------------------------------------------------------------------------------------------- document
const doc = {
  primitive: 'torus', dims: {}, detail: 'medium', recipe: { ...DEFAULT_RECIPE }, simulation: { ...SIMULATION_DEFAULTS },
  mode: 'edit', shading: 'energy', explode: 0, wire: false, seeds: false, grid: true, smooth: true, logScale: true,
  selected: null, hidden: new Set(), overrides: new Map(), filter: 'all', search: '', speed: 1, loop: true,
  aiming: false, hit: null, time: 0, playing: false, shutGroups: new Set(['recipe']), shutSections: new Set(['distribution']), library: false,
};
for (const p of PRIMITIVES) doc.dims[p.id] = defaultDims(p.id);
try {
  const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  if (saved) {
    if (PRIMITIVES.some((p) => p.id === saved.primitive)) doc.primitive = saved.primitive;
    for (const p of PRIMITIVES) if (saved.dims?.[p.id]) doc.dims[p.id] = normalizeDims(p.id, saved.dims[p.id]);
    if (DETAIL[saved.detail]) doc.detail = saved.detail;
    doc.recipe = normalizeRecipe(saved.recipe); doc.simulation = normalizeSimulation(saved.simulation);
    for (const k of ['shading', 'logScale', 'smooth', 'grid', 'loop', 'speed']) if (saved[k] !== undefined) doc[k] = saved[k];
    if (Array.isArray(saved.shutSections)) doc.shutSections = new Set(saved.shutSections);
  }
} catch { /* first visit or unreadable: defaults */ }
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { primitive, dims, detail, recipe, simulation, shading, logScale, smooth, grid, loop, speed } = doc;
    localStorage.setItem(SAVE_KEY, JSON.stringify({ primitive, dims, detail, recipe, simulation, shading, logScale, smooth, grid, loop, speed, shutSections: [...doc.shutSections] }));
  }, 300);
}

// Derived
let source = null, result = null, shares = null, cache = null, meshes = [], kineticPeak = 1, diagnostics = null;
let authored = null; // the Edit fracture, kept while Sim / Play show a re-hit of it (doc.hit)
const impactPoint = () => doc.hit || [doc.recipe.X, doc.recipe.Y, doc.recipe.Z];
const pieceKinetic = []; // per piece: peak kinetic over the bake

// ---------------------------------------------------------------------------------------------------- formatting
const fmtJ = (j) => (Math.abs(j) >= 1000 ? `${(j / 1000).toFixed(j >= 10000 ? 1 : 2)} kJ` : `${j < 10 ? j.toFixed(1) : Math.round(j)} J`);
const fmtKg = (kg) => (kg >= 100 ? `${Math.round(kg)} kg` : kg >= 1 ? `${kg.toFixed(1)} kg` : `${Math.round(kg * 1000)} g`);
const fmtM = (m) => (m >= 1 ? `${m.toFixed(2)} m` : `${(m * 100).toFixed(m < 0.1 ? 1 : 0)} cm`);
// "12.34" → "12<span>.34</span>": the dimmed fraction of the General UI numerals.
function split(value, decimals, unit = '') {
  const t = value.toFixed(decimals), [i, f] = t.split('.');
  return `${Number(i).toLocaleString('en-US')}${f ? `<span>.${f}</span>` : ''}${unit ? `<em>${unit}</em>` : ''}`;
}
const pad2 = (n) => String(n + 1).padStart(2, '0');
const linear = (c) => c.map((v) => Math.pow(v, 2.2));
const hex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
function ramp(t) {
  t = Math.max(0, Math.min(1, t));
  let i = 0; while (i < RAMP_AT.length - 2 && t > RAMP_AT[i + 1]) i++;
  const k = (t - RAMP_AT[i]) / (RAMP_AT[i + 1] - RAMP_AT[i]), a = RAMP[i], b = RAMP[i + 1];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
function hue(i) { const h = (i * 0.618034) % 1, s = 0.5, v = 0.92, f = (n) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5), f(3), f(1)]; }

// ---------------------------------------------------------------------------------------------------- viewport
const canvas = $('Canvas');
const viewport = new Viewport(canvas, { ground: true, onPick: (id, e) => onPick(id, e), onCamera: () => { overlayDirty = true; } });
viewport.settings.background = [0.047, 0.047, 0.05, 1];
viewport.settings.cell = 0.25;
let overlayDirty = true, sceneDirty = true, treeDirty = true;
let seq = new Uint32Array(0);

function buildMeshes() {
  viewport.setObjects([]); // never let the renderer draw a mesh that is about to be deleted
  for (const m of meshes) viewport.deleteMesh(m);
  const inside = MATERIALS[doc.recipe.Material], outside = MATERIALS[doc.recipe.Surface] || inside;
  meshes = result.pieces.map((pc) => {
    const n = pc.positions.length / 3, tris = n / 3;
    if (seq.length < n) { seq = new Uint32Array(n * 2); for (let i = 0; i < seq.length; i++) seq[i] = i; }
    const colors = new Float32Array(tris * 4), debug = new Float32Array(tris * 3);
    for (let t = 0; t < tris; t++) {
      const c = linear(pc.cut[t] ? inside.interior : outside.color).map((v) => v * 0.82), g = pc.cut[t] ? 0.62 : 1;
      colors.set([c[0], c[1], c[2], 0], t * 4); debug.set([g, g, g], t * 3);
    }
    return viewport.createMesh({ positions: pc.positions, indices: seq.subarray(0, n), cornerNormals: pc.normals, colors, debug });
  });
}

// ---------------------------------------------------------------------------------------------------- fracture
function rebuildSource(resetImpact) {
  source = buildSource(doc.primitive, doc.dims[doc.primitive], doc.detail);
  if (resetImpact || Math.abs(source.sdf([doc.recipe.X, doc.recipe.Y, doc.recipe.Z])) > 0.02) {
    const hit = defaultImpact(source); doc.recipe.X = hit[0]; doc.recipe.Y = hit[1]; doc.recipe.Z = hit[2];
  }
  const B = source.bounds;
  viewport.settings.groundLevel = B.lo[1] - 0.0005;
  viewport.settings.shadow = [B.centre[0], B.centre[2], B.size[0] * 0.75 + 0.1, B.size[2] * 0.75 + 0.1];
}
function refracture() {
  authored = null; doc.hit = null;
  result = fracture(source, doc.recipe);
  doc.overrides = new Map([...doc.overrides].filter(([id]) => id < result.pieces.length));
  shares = impactShares(result, doc.simulation, doc.overrides);
  buildMeshes();
  cache = null;
  if (doc.selected !== null && doc.selected >= result.pieces.length) doc.selected = null;
  doc.hidden = new Set([...doc.hidden].filter((id) => id < result.pieces.length));
  if (doc.mode !== 'edit') ensureCache();
  sceneDirty = overlayDirty = treeDirty = true;
  updateScene(); sceneDirty = true;
  refreshLive();
  diagnostics?.bakeFracture(result);
  save();
}
function ensureCache() {
  if (cache) return cache;
  cache = simulate(result, doc.simulation, { overrides: doc.overrides });
  diagnostics?.bakeSimulation(cache);
  kineticPeak = 1e-6; pieceKinetic.length = 0;
  for (let i = 0; i < cache.n; i++) {
    let m = 0; for (let f = 0; f < cache.steps; f++) m = Math.max(m, cache.poses[(f * cache.n + i) * 8 + 7]);
    pieceKinetic[i] = m; kineticPeak = Math.max(kineticPeak, m);
  }
  paintTrack();
  return cache;
}
function invalidateMotion() {
  shares = impactShares(result, doc.simulation, doc.overrides);
  cache = null;
  if (doc.mode !== 'edit') ensureCache();
  sceneDirty = overlayDirty = treeDirty = true;
  refreshLive(); paintTrack(); save();
}

// Sim / Play: hit the object somewhere else. Baked keeps its pre-cut pieces and launches them from the hit; realtime
// cuts new pieces there, timed against its budget.
function hitAt(point) {
  if (!authored) authored = result;
  doc.hit = point.slice();
  const realtime = authored.method === 'realtime';
  result = realtime ? fracture(source, { ...doc.recipe, X: point[0], Y: point[1], Z: point[2] }) : rehit(authored, point);
  doc.overrides.clear(); doc.hidden.clear(); doc.selected = null;
  shares = impactShares(result, doc.simulation, doc.overrides);
  if (realtime) { buildMeshes(); diagnostics?.bakeFracture(result); }
  cache = null; ensureCache();
  doc.time = doc.mode === 'play' ? -0.3 : 0; doc.playing = true;
  sceneDirty = overlayDirty = treeDirty = true;
  renderInspector(); paintTrack(); paintTransport();
  $('Hint').textContent = realtime ? `Realtime · cut ${result.pieces.length} pieces at the hit in ${result.ms.toFixed(1)} ms (budget ${doc.recipe.Budget} ms) · click again to re-hit · Esc to stop` : `Baked · the same ${result.pieces.length} pieces, launched from the new hit · click again to re-hit · Esc to stop`;
}
function restoreAuthored() {
  if (!authored) return;
  const realtime = authored.method === 'realtime';
  result = authored; authored = null; doc.hit = null; doc.overrides.clear();
  shares = impactShares(result, doc.simulation, doc.overrides);
  if (realtime) buildMeshes();
  cache = null; treeDirty = sceneDirty = overlayDirty = true;
}

// Coalesce rapid edits (slider drags) into one fracture per ~70 ms.
let pending = null, pendingTimer = 0;
function schedule(kind = 'fracture') {
  pending = pending === 'source' || kind === 'source' ? 'source' : kind === 'fracture' || pending === 'fracture' ? 'fracture' : 'motion';
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    const k = pending; pending = null;
    if (k === 'source') { rebuildSource(false); refracture(); }
    else if (k === 'fracture') refracture();
    else invalidateMotion();
  }, 70);
}

// ---------------------------------------------------------------------------------------------------- energy colouring
// Edit shows each piece's share of the impact energy; Sim and Play show live kinetic energy.
function energyNorm(i, kinetic) {
  if (doc.mode === 'edit') {
    const e = shares.energy[i], hi = shares.peak || 1, lo = Math.max(shares.low || hi * 1e-3, hi * 1e-4);
    if (!doc.logScale) return e / hi;
    return e <= lo ? 0 : Math.log(e / lo) / Math.log(hi / lo || 10);
  }
  const hi = kineticPeak, lo = hi * 1e-3;
  if (!doc.logScale) return kinetic / hi;
  return kinetic <= lo ? 0 : Math.log(kinetic / lo) / Math.log(hi / lo);
}
function legendRange() {
  if (doc.mode === 'edit') return [doc.logScale ? Math.max(shares.low || 0, shares.peak * 1e-4) : 0, shares.peak];
  return [doc.logScale ? kineticPeak * 1e-3 : 0, kineticPeak];
}

// ---------------------------------------------------------------------------------------------------- scene
const pose = { x: [0, 0, 0], q: [0, 0, 0, 1], kinetic: 0 };
const live = { kinetic: [], matrices: [], total: 0, awake: 0 };
function sceneTime() { return Math.max(0, doc.time); }
function updateScene() {
  if (!result) return;
  const B = source.bounds, n = result.pieces.length, t = sceneTime(), moving = doc.mode !== 'edit' && cache;
  live.total = 0; live.awake = 0;
  const intact = doc.mode === 'play' && doc.time < 0 && result.method === 'realtime';
  const objects = result.pieces.map((pc, i) => {
    let matrix;
    if (moving) {
      sample(cache, t, i, pose); matrix = poseMatrix(pc.centre, pose.x, pose.q, live.matrices[i]); live.matrices[i] = matrix;
      live.kinetic[i] = pose.kinetic; live.total += pose.kinetic; if (pose.kinetic > 1e-4) live.awake++;
    } else {
      const k = doc.explode * 0.9, m = live.matrices[i] || new Float32Array(16); m.fill(0); m[0] = m[5] = m[10] = m[15] = 1;
      m[12] = (pc.centre[0] - B.centre[0]) * k; m[13] = (pc.centre[1] - B.centre[1]) * k + (doc.explode > 0 ? doc.explode * B.size[1] * 0.25 : 0); m[14] = (pc.centre[2] - B.centre[2]) * k;
      matrix = live.matrices[i] = m; live.kinetic[i] = 0;
    }
    let tint = [1, 1, 1], mode = 'lit';
    if (intact) { /* realtime before the hit: one whole object, no cells to colour yet */ }
    else if (doc.shading === 'energy') { tint = linear(ramp(energyNorm(i, live.kinetic[i]))); mode = 'debug'; }
    else if (doc.shading === 'cells') { tint = linear(hue(i)); mode = 'debug'; }
    else if (doc.shading === 'normal') mode = 'normal';
    return { mesh: meshes[i], matrix, tint, mode, selected: doc.selected === i, visible: !doc.hidden.has(i), pickId: i };
  });
  live.matrices.length = n;
  viewport.setObjects(objects);
  viewport.settings.wire = doc.wire; viewport.settings.grid = doc.grid; viewport.settings.flat = !doc.smooth;
  if (doc.mode !== 'edit') viewport.settings.shadow = null;
  else viewport.settings.shadow = [B.centre[0], B.centre[2], B.size[0] * 0.75 + 0.1, B.size[2] * 0.75 + 0.1];
  paintLines();
  viewport.dirty = true;
}

function paintLines() {
  const L = new LineBuilder(), imp = impactPoint(), nrm = source.sdf ? gradientAt(imp) : [0, 1, 0];
  const size = Math.max(...source.bounds.size), r = size * 0.05;
  const orange = [1, 0.54, 0.24, 0.95];
  const showImpact = doc.mode === 'edit' || doc.time < 0.4;
  if (showImpact) {
    ring(L, imp, nrm, r, orange); ring(L, imp, nrm, r * 0.45, orange);
    L.arrow(imp.map((v, k) => v + nrm[k] * size * 0.32), imp.map((v, k) => v + nrm[k] * r * 0.4), orange);
  }
  if (doc.mode === 'play' && doc.time > -0.05 && doc.time < 0.55) { // shock ring
    const k = Math.max(0, doc.time) / 0.55;
    for (const f of [1, 0.7]) ring(L, imp, nrm, size * (0.08 + k * 0.9) * f, [1, 0.75, 0.4, (1 - k) * 0.9 * f]);
  }
  if (doc.seeds) {
    const c = [0.85, 0.95, 0.42, 0.9];
    if (doc.mode === 'edit') for (const pc of result.pieces) { const p = pc.seedPoint, s = size * 0.012; L.line([p[0] - s, p[1], p[2]], [p[0] + s, p[1], p[2]], c).line([p[0], p[1] - s, p[2]], [p[0], p[1] + s, p[2]], c).line([p[0], p[1], p[2] - s], [p[0], p[1], p[2] + s], c); }
    else if (cache) for (let i = 0; i < cache.n; i++) { // launch vectors from the first baked step
      const a = (0 * cache.n + i) * 8, b = (1 * cache.n + i) * 8, P = cache.poses, v = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]].map((d) => d * cache.rate * 0.08);
      if (Math.hypot(...v) < 1e-4) continue;
      const from = [P[a], P[a + 1], P[a + 2]], col = ramp(energyNorm(i, pieceKinetic[i]));
      L.arrow(from, from.map((x, k) => x + v[k]), [...col, 0.9]);
    }
  }
  if (aimHover) { ring(L, aimHover.point, aimHover.normal, r, [1, 1, 1, 0.9]); ring(L, aimHover.point, aimHover.normal, r * 1.8, [1, 1, 1, 0.35]); }
  viewport.setLines('marks', L.build(), { depth: false });
}
function ring(L, c, n, r, col, seg = 40) {
  const u = Math.abs(n[1]) < 0.9 ? norm3(cross3(n, [0, 1, 0])) : norm3(cross3(n, [1, 0, 0])), v = cross3(n, u);
  let prev = null;
  for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2, p = [0, 1, 2].map((k) => c[k] + (u[k] * Math.cos(a) + v[k] * Math.sin(a)) * r + n[k] * 0.002); if (prev) L.line(prev, p, col); prev = p; }
}
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
function gradientAt(p) {
  const e = 1e-4, f = (x, y, z) => source.sdf([x, y, z]);
  return norm3([f(p[0] + e, p[1], p[2]) - f(p[0] - e, p[1], p[2]), f(p[0], p[1] + e, p[2]) - f(p[0], p[1] - e, p[2]), f(p[0], p[1], p[2] + e) - f(p[0], p[1], p[2] - e)]);
}

// ---------------------------------------------------------------------------------------------------- picking / aiming
let aimHover = null;
function rayAt(clientX, clientY) {
  const r = canvas.getBoundingClientRect(), { viewProj } = viewport.matrices(r.width / r.height), inv = invert(viewProj);
  const x = ((clientX - r.left) / r.width) * 2 - 1, y = 1 - ((clientY - r.top) / r.height) * 2;
  const un = (z) => { const v = [x, y, z, 1], o = [0, 0, 0, 0]; for (let i = 0; i < 4; i++) o[i] = inv[i] * v[0] + inv[4 + i] * v[1] + inv[8 + i] * v[2] + inv[12 + i] * v[3]; return [o[0] / o[3], o[1] / o[3], o[2] / o[3]]; };
  const a = un(-1), b = un(1);
  return { origin: a, dir: norm3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]) };
}
function onPick(id, e) {
  if (doc.aiming && doc.mode === 'edit') {
    const ray = rayAt(e.clientX, e.clientY), hit = source.trace(ray.origin, ray.dir);
    if (hit) { doc.recipe.X = hit.point[0]; doc.recipe.Y = hit.point[1]; doc.recipe.Z = hit.point[2]; setAiming(false); aimHover = null; syncImpactInputs(); schedule('fracture'); }
    return;
  }
  if (doc.aiming) { // Sim / Play: a runtime hit
    const ray = rayAt(e.clientX, e.clientY), hit = source.trace(ray.origin, ray.dir);
    if (hit) hitAt(hit.point);
    return;
  }
  select(id === null ? null : id);
}
let aimRaf = 0;
canvas.addEventListener('pointermove', (e) => {
  if (!doc.aiming || aimRaf) return;
  aimRaf = requestAnimationFrame(() => {
    aimRaf = 0;
    const ray = rayAt(e.clientX, e.clientY), hit = source.trace(ray.origin, ray.dir);
    aimHover = hit; paintLines(); viewport.dirty = true;
  });
});
canvas.addEventListener('pointerleave', () => { if (aimHover) { aimHover = null; paintLines(); viewport.dirty = true; } });
function setAiming(on) {
  doc.aiming = on && !!result;
  $('ImpactBtn').classList.toggle('on', doc.aiming); $('Well').classList.toggle('aiming', doc.aiming);
  document.querySelectorAll('[data-act="aim"]').forEach((b) => b.classList.toggle('on', doc.aiming));
  $('Hint').textContent = doc.aiming ? (doc.mode === 'edit' ? 'Click the surface to place the impact · Esc to cancel' : result.method === 'realtime' ? 'Click the surface to hit it · realtime cuts new pieces where you hit · Esc to stop' : 'Click the surface to hit it · baked pieces release from where you hit · Esc to stop') : 'Drag to orbit · right-drag to pan · wheel to zoom · click a fragment to select';
  if (!doc.aiming) { aimHover = null; paintLines(); }
}
function select(id) {
  doc.selected = id;
  sceneDirty = overlayDirty = treeDirty = true;
  renderInspector();
}
function frameSelection() {
  if (doc.selected !== null && result.pieces[doc.selected]) {
    const pc = result.pieces[doc.selected], m = live.matrices[doc.selected], c = m ? [m[0] * pc.centre[0] + m[4] * pc.centre[1] + m[8] * pc.centre[2] + m[12], m[1] * pc.centre[0] + m[5] * pc.centre[1] + m[9] * pc.centre[2] + m[13], m[2] * pc.centre[0] + m[6] * pc.centre[1] + m[10] * pc.centre[2] + m[14]] : pc.centre;
    viewport.frame({ centre: c, radius: Math.max(0.08, Math.hypot(...pc.bounds.size) * 0.9) });
  } else viewport.frame({ centre: source.bounds.centre, radius: source.bounds.radius * 0.95 });
}

// ---------------------------------------------------------------------------------------------------- overlay
function project(p, vp, w, h) {
  const cx = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12], cy = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13], cw = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
  if (cw <= 0.01) return null;
  return [(cx / cw * 0.5 + 0.5) * w, (1 - (cy / cw * 0.5 + 0.5)) * h];
}
function paintOverlay() {
  const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !result) return;
  const { viewProj } = viewport.matrices(w / h);
  const notes = [];
  const imp = impactPoint();
  if (doc.mode === 'edit' || doc.time < 0.4) {
    const p = project(imp, viewProj, w, h);
    if (p) notes.push({ p, cls: 'impact', title: `Impact · ${fmtJ(doc.recipe.Energy)}`, sub: `${imp.map((v) => v.toFixed(2)).join(', ')} m · ${MATERIALS[doc.recipe.Material].label}`, dx: 64, dy: -54 });
  }
  if (doc.selected !== null && result.pieces[doc.selected] && !doc.hidden.has(doc.selected)) {
    const i = doc.selected, pc = result.pieces[i], m = live.matrices[i];
    const c = m ? [m[0] * pc.centre[0] + m[4] * pc.centre[1] + m[8] * pc.centre[2] + m[12], m[1] * pc.centre[0] + m[5] * pc.centre[1] + m[9] * pc.centre[2] + m[13], m[2] * pc.centre[0] + m[6] * pc.centre[1] + m[10] * pc.centre[2] + m[14]] : pc.centre;
    const p = project(c, viewProj, w, h);
    const energy = doc.mode === 'edit' ? `${fmtJ(shares.energy[i])} share` : `${fmtJ(live.kinetic[i] || 0)} kinetic`;
    if (p) notes.push({ p, cls: 'pick', title: `Fragment ${pad2(i)} · ${fmtKg(pc.mass)}`, sub: `${energy} · ${shares.released[i] ? 'released' : 'held'}`, dx: -70, dy: -48, left: true });
  }
  let svg = '', html = '';
  for (const n of notes) {
    let x = n.p[0] + n.dx, y = n.p[1] + n.dy;
    x = Math.max(n.left ? 190 : 10, Math.min(w - (n.left ? 10 : 200), x)); y = Math.max(64, Math.min(h - 10, y));
    const col = n.cls === 'impact' ? '#ff8a3d' : '#f2a93b';
    svg += `<path d="M${n.p[0]},${n.p[1]} L${x - (n.left ? -18 : 18)},${y} L${x},${y}" fill="none" stroke="${col}" stroke-opacity=".75" stroke-width="1.2"/><circle cx="${n.p[0]}" cy="${n.p[1]}" r="4" fill="${col}"/><circle cx="${n.p[0]}" cy="${n.p[1]}" r="9" fill="none" stroke="${col}" stroke-opacity=".4"/>`;
    html += `<div class="callout ${n.cls}${n.left ? ' left' : ''}" style="left:${x}px;top:${y}px"><b>${n.title}</b><small>${n.sub}</small></div>`;
  }
  $('Leaders').innerHTML = svg; $('Callouts').innerHTML = html;
}

function paintChips() {
  if (!result) return;
  const m = result.metrics, ck = glyph('check'), tri = glyph('triangle'), chips = [];
  chips.push(`<span class="chip"><i class="ok">${ck}</i>Volume kept <b>${m.occupied.toFixed(3)} %</b></span>`);
  if (result.plan.capped) chips.push(`<span class="chip"><i class="warn">${tri}</i>Ceiling reached · <b>${doc.recipe.Ceiling}</b> of ${result.plan.requested} requested</span>`);
  if (source.segmented) chips.push(`<span class="chip"><i class="info">${glyph('dots')}</i><b>${source.segments}</b> convex segments · ${result.stats.rejoined} seam joins</span>`);
  if (doc.mode !== 'edit' && cache) {
    chips.push(`<span class="chip"><i class="ok">${ck}</i>Released <b>${cache.shares.releasedCount}</b> of ${result.pieces.length}</span>`);
    chips.push(cache.settled !== null ? `<span class="chip"><i class="ok">${ck}</i>Settles at <b>${cache.settled.toFixed(2)} s</b></span>` : `<span class="chip"><i class="warn">${tri}</i>Still moving at <b>${cache.duration.toFixed(2)} s</b></span>`);
  }
  $('Chips').innerHTML = chips.join('');
  const legend = $('Legend'); legend.hidden = doc.shading !== 'energy';
  if (!legend.hidden) {
    const [lo, hi] = legendRange();
    $('LegendLow').textContent = doc.mode === 'edit' ? `${fmtJ(lo)} share` : doc.logScale ? `≤ ${fmtJ(lo)}` : '0 J';
    $('LegendHigh').textContent = `${fmtJ(hi)}${doc.mode === 'edit' ? ' peak share' : ' peak kinetic'}`;
    $('LegendScale').textContent = doc.logScale ? 'LOG' : 'LINEAR';
  }
}

// ---------------------------------------------------------------------------------------------------- header / footer
function paintChrome() {
  const spec = primitiveById(doc.primitive);
  $('VpGlyph').src = `Icons/${spec.icon}.svg`;
  $('VpTitle').textContent = spec.label;
  $('VpSub').textContent = result ? `${result.pieces.length} fragments · ${MATERIALS[doc.recipe.Material].label.toLowerCase()} · ${source.note}` : '';
  const badge = $('VpBadge');
  badge.className = 'badge' + (doc.mode === 'play' ? ' live' : '');
  const rt = result?.realtime, method = rt ? `REALTIME · ${result.ms.toFixed(1)} / ${rt.budget} MS` : 'BAKED';
  badge.className = 'badge' + (doc.mode === 'play' ? ' live' : rt && rt.over ? ' warn' : '');
  badge.textContent = doc.mode === 'edit' ? `${method} · LIVE PREVIEW` : `${doc.hit ? 'RE-HIT · ' : ''}${doc.mode === 'sim' ? `SIMULATED · ${cache ? cache.ms.toFixed(0) : 0} MS` : 'PLAYING'} · ${rt ? 'REALTIME' : 'BAKED'}`;
  document.querySelectorAll('.modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === doc.mode));
  const [label, key] = doc.mode === 'edit' ? ['Simulate', 'Shift+2'] : doc.mode === 'sim' ? ['Play', 'Shift+3'] : ['Restart', 'Home'];
  $('PrimaryLabel').textContent = label; $('PrimaryKey').textContent = key;
  $('PrimaryBtn').querySelector('img').src = doc.mode === 'edit' ? 'Icons/editor-simulate.svg' : doc.mode === 'sim' ? 'Icons/editor-play-mode.svg' : 'Icons/editor-pause.svg';
  $('ExplodeWrap').classList.toggle('off', doc.mode !== 'edit');
  $('ImpactBtn').title = doc.mode === 'edit' ? 'Place impact · I' : 'Hit the object · I';
  $('WireBtn').classList.toggle('on', doc.wire); $('SeedsBtn').classList.toggle('on', doc.seeds); $('GridBtn').classList.toggle('on', doc.grid);
  $('ShadingLabel').textContent = { material: 'Material', energy: 'Energy', cells: 'Cells', normal: 'Normals' }[doc.shading];
  document.querySelectorAll('#ShadingDrop .drop-list button').forEach((b) => b.classList.toggle('on', b.dataset.value === doc.shading));
  if (result) {
    const d = source.dims, dimText = spec.dims.map(([k, , u]) => `${k} ${u === 'mm' ? d[k].toFixed(0) + ' mm' : d[k].toFixed(2)}`).join(' · ');
    $('VpFoot').innerHTML = `<span>Analytical ${spec.label.toLowerCase()} · <em>${dimText}${spec.dims[0][2] === 'm' ? ' m' : ''}</em> · faceting <b>${(source.faceting * 100).toFixed(2)} %</b></span><span>${source.segments > 1 ? `${source.segments} segments · ` : ''}${result.metrics.tris.toLocaleString()} tris · <b>${result.pieces.length}</b> closed</span>`;
    $('OlScope').textContent = `${spec.label} · ${result.pieces.length} fragments`;
    $('ReleasedCount').textContent = shares.releasedCount; $('HeldCount').textContent = result.pieces.length - shares.releasedCount;
    $('StatusBake').textContent = `${result.ms.toFixed(0)} ms`; $('StatusTris').textContent = result.metrics.tris >= 10000 ? `${(result.metrics.tris / 1000).toFixed(1)}k` : result.metrics.tris.toLocaleString(); $('StatusSeed').textContent = doc.recipe.Seed;
    $('InsFootLeft').textContent = doc.selected !== null ? `Fragment ${pad2(doc.selected)} · ${spec.label}` : `Analytical ${spec.label.toLowerCase()}`;
  }
  $('StatReleased').classList.toggle('on', doc.filter === 'released'); $('StatHeld').classList.toggle('on', doc.filter === 'held');
  $('LibraryNotch').classList.toggle('on', doc.library);
}

// ---------------------------------------------------------------------------------------------------- outliner
const swatchEls = new Map();
function renderTree() {
  treeDirty = false;
  if (!result) return;
  const q = doc.search.trim().toLowerCase(), spec = primitiveById(doc.primitive);
  const group = (id, icon, title, sub, rows) => `<div class="tg${doc.shutGroups.has(id) ? ' shut' : ''}" data-group="${id}"><button class="tg-head"><i class="tg-chev">${glyph('chevron')}</i><img src="Icons/${icon}.svg" alt=""><span class="tg-title"><b>${title}</b><small>${sub}</small></span></button><div class="tg-rows">${rows}</div></div>`;
  const prims = PRIMITIVES.filter((p) => !q || p.label.toLowerCase().includes(q)).map((p) => `<button class="tr${p.id === doc.primitive ? ' on' : ''}" data-primitive="${p.id}"><img src="Icons/${p.icon}.svg" alt=""><span class="tr-text"><b>${p.label}</b><small>${describe(p.id, doc.dims[p.id])}${p.convex ? '' : ' · segmented'}</small></span>${p.id === doc.primitive ? `<span class="tr-mark ok">${glyph('check')}</span>` : ''}</button>`).join('');
  const m = MATERIALS[doc.recipe.Material];
  const recipeRows = [
    ['method', doc.recipe.Method === 'realtime' ? 'lightning' : 'editor-bake', 'Method', doc.recipe.Method === 'realtime' ? `Realtime · ${doc.recipe.Budget} ms budget · ≤ ${realtimeCap(source, doc.recipe)} cells` : `Baked · ${(result.metrics.bytes / 1024).toFixed(0)} KB stored · ${result.pieces.length} pieces`],
    ['impact', 'lightning', 'Impact', `${fmtJ(doc.recipe.Energy)} · ${[doc.recipe.X, doc.recipe.Y, doc.recipe.Z].map((v) => v.toFixed(2)).join(', ')}`],
    ['material', 'material', 'Material', `Outside ${MATERIALS[doc.recipe.Surface].label.toLowerCase()} · inside ${m.label.toLowerCase()}`],
    ['pattern', 'dice', 'Pattern', `Seed ${doc.recipe.Seed} · ceiling ${doc.recipe.Ceiling} · min ${(doc.recipe.MinimumSize * 1000).toFixed(0)} mm`],
    ['simulation', 'editor-physics', 'Simulation', `${doc.simulation.Duration.toFixed(1)} s · transfer ${(doc.simulation.Transfer * 100).toFixed(0)} % · release ${doc.simulation.Release} J`],
  ].filter((r) => !q || r[2].toLowerCase().includes(q)).map(([sec, icon, title, sub]) => `<button class="tr" data-section="${sec}"><img src="Icons/${icon}.svg" alt=""><span class="tr-text"><b>${title}</b><small>${sub}</small></span></button>`).join('');
  swatchEls.clear();
  const frags = result.pieces.filter((pc) => {
    const i = pc.id;
    if (q && !`fragment ${pad2(i)}`.includes(q) && !String(i + 1).includes(q)) return false;
    if (doc.filter === 'released') return !!shares.released[i];
    if (doc.filter === 'held') return !shares.released[i];
    if (doc.filter === 'hidden') return doc.hidden.has(i);
    if (doc.filter === 'seam') return pc.chunks > 1;
    return true;
  });
  const fragRows = frags.map((pc) => {
    const i = pc.id, rel = shares.released[i], hidden = doc.hidden.has(i), held = doc.overrides.get(i);
    return `<button class="tr${doc.selected === i ? ' on' : ''}${hidden ? ' hidden' : ''}" data-piece="${i}"><span class="swatch" data-swatch="${i}"></span><span class="tr-text"><b>Fragment ${pad2(i)}</b><small>${fmtKg(pc.mass)} · ${fmtM(Math.max(...pc.bounds.size))}${pc.chunks > 1 ? ` · ${pc.chunks} chunks` : ''}${held ? ` · ${held} by hand` : ''}</small></span><span class="tr-energy" data-energy="${i}">${fmtJ(shares.energy[i])}</span><span class="tr-eye" data-eye="${i}" title="${hidden ? 'Show' : 'Hide'}">${glyph(hidden ? 'eye-off' : 'eye')}</span><span class="tr-mark ${held === 'held' ? 'lock' : rel ? 'ok' : 'idle'}">${held === 'held' ? glyph('hold') : rel ? glyph('check') : ''}</span></button>`;
  }).join('') || `<div class="tree-more" style="display:grid;place-items:center;border-style:dashed">No fragments match</div>`;
  $('Tree').innerHTML =
    group('primitives', 'folder-scene', 'Primitives', `${PRIMITIVES.length} analytical shapes`, prims) +
    group('recipe', 'editor-material', 'Recipe', `${METHODS[doc.recipe.Method].label} · ${m.label} · ${fmtJ(doc.recipe.Energy)}`, recipeRows) +
    group('fragments', 'editor-collection', 'Fragments', `${result.pieces.length} pieces · ${shares.releasedCount} released${doc.filter !== 'all' ? ` · showing ${frags.length}` : ''}`, fragRows);
  for (const el of $('Tree').querySelectorAll('[data-swatch]')) swatchEls.set(+el.dataset.swatch, { swatch: el, energy: el.parentElement.querySelector('[data-energy]') });
  paintSwatches();
}
function paintSwatches() {
  for (const [i, { swatch, energy }] of swatchEls) {
    const k = doc.mode === 'edit' ? shares.energy[i] : live.kinetic[i] || 0;
    swatch.style.background = hex(ramp(energyNorm(i, k)));
    energy.textContent = fmtJ(k);
  }
}
$('Tree').addEventListener('click', (e) => {
  const head = e.target.closest('.tg-head');
  if (head) { const g = head.parentElement.dataset.group; doc.shutGroups.has(g) ? doc.shutGroups.delete(g) : doc.shutGroups.add(g); head.parentElement.classList.toggle('shut'); return; }
  const eye = e.target.closest('[data-eye]');
  if (eye) { const i = +eye.dataset.eye; doc.hidden.has(i) ? doc.hidden.delete(i) : doc.hidden.add(i); sceneDirty = overlayDirty = treeDirty = true; if (doc.selected === i) renderInspector(); return; }
  const row = e.target.closest('.tr'); if (!row) return;
  if (row.dataset.primitive) setPrimitive(row.dataset.primitive);
  else if (row.dataset.section) { if (doc.selected !== null) select(null); openSection(row.dataset.section); }
  else if (row.dataset.piece !== undefined) select(doc.selected === +row.dataset.piece ? null : +row.dataset.piece);
});
$('Tree').addEventListener('dblclick', (e) => { const row = e.target.closest('[data-piece]'); if (row) { select(+row.dataset.piece); frameSelection(); } });
$('OlSearch').addEventListener('input', (e) => { doc.search = e.target.value; renderTree(); });
$('OlCollapse').addEventListener('click', () => { const all = ['primitives', 'recipe', 'fragments'], shut = all.every((g) => doc.shutGroups.has(g)); doc.shutGroups = shut ? new Set() : new Set(all); renderTree(); });
for (const id of ['StatReleased', 'StatHeld']) $(id).addEventListener('click', (e) => setFilter(doc.filter === e.currentTarget.dataset.filter ? 'all' : e.currentTarget.dataset.filter));
function setFilter(f) { doc.filter = f; $('OlFilterLabel').textContent = { all: 'All', released: 'Released', held: 'Held', hidden: 'Hidden', seam: 'Seams' }[f]; document.querySelectorAll('#OlFilter .drop-list button').forEach((b) => b.classList.toggle('on', b.dataset.value === f)); renderTree(); paintChrome(); }

function setPrimitive(id) {
  if (id === doc.primitive) return;
  doc.primitive = id; doc.selected = null; doc.hidden.clear(); doc.overrides.clear();
  doc.mode = 'edit'; doc.playing = false; doc.time = 0;
  rebuildSource(true); refracture(); setMode('edit'); frameSelection(); paintLibrary();
}

// ---------------------------------------------------------------------------------------------------- inspector
const SLIDERS = {}; // key → { get, set, lo, hi, log, step, kind, scale (display multiplier) }
function sliderDef(key, def) { SLIDERS[key] = def; return key; }
function toSlide(def, v) { const x = Math.max(def.lo, Math.min(def.hi, v)); return def.log ? (Math.log(Math.max(x, def.lo) / def.lo) / Math.log(def.hi / def.lo)) * 1000 : ((x - def.lo) / (def.hi - def.lo)) * 1000; }
function fromSlide(def, s) { let v = def.log ? def.lo * Math.pow(def.hi / def.lo, s / 1000) : def.lo + ((def.hi - def.lo) * s) / 1000; if (def.step) v = Math.round(v / def.step) * def.step; return v; }
function shown(def, v) { const d = def.decimals ?? 2; return (v * (def.scale || 1)).toFixed(d); }
function field(key, label, unit) {
  const def = SLIDERS[key], v = def.get(), s = toSlide(def, v);
  return `<div class="field" data-slider="${key}"><span>${label}</span><label class="amount"><input value="${shown(def, v)}" inputmode="decimal"><em>${unit}</em></label><input type="range" class="slide" min="0" max="1000" step="1" value="${s}" style="--fill:${s / 10}%"></div>`;
}
function section(id, title, note, body) {
  return `<section class="sec${doc.shutSections.has(id) ? ' shut' : ''}" data-sec="${id}"><button class="sec-head"><h3>${title}</h3><small>${note}</small><i>${glyph('chevron')}</i></button><div class="sec-body">${body}</div></section>`;
}
function toggleTile(key, label, on, glyphName, sub) {
  return `<button class="qt${on ? ' on' : ' off'}" data-toggle="${key}"><span class="qt-seat">${glyph(glyphName)}</span><b>${label}</b><small>${sub || (on ? 'On' : 'Off')}</small></button>`;
}

function defineSliders() {
  for (const k of Object.keys(SLIDERS)) delete SLIDERS[k];
  const spec = primitiveById(doc.primitive);
  for (const [key, , unit, lo, hi, step] of spec.dims) {
    sliderDef('dim:' + key, { get: () => doc.dims[doc.primitive][key], set: (v) => { doc.dims[doc.primitive] = normalizeDims(doc.primitive, { ...doc.dims[doc.primitive], [key]: v }); }, lo, hi, step, decimals: unit === 'mm' ? 0 : 2, kind: 'source' });
  }
  const r = doc.recipe, s = doc.simulation;
  sliderDef('Energy', { get: () => r.Energy, set: (v) => { r.Energy = v; }, lo: 20, hi: 50000, log: true, step: 10, decimals: 0, kind: 'fracture' });
  sliderDef('Ceiling', { get: () => r.Ceiling, set: (v) => { r.Ceiling = Math.round(v); }, lo: 2, hi: 160, step: 1, decimals: 0, kind: 'fracture' });
  sliderDef('MinimumSize', { get: () => r.MinimumSize, set: (v) => { r.MinimumSize = v; }, lo: 0.002, hi: 0.3, log: true, step: 0.001, scale: 1000, decimals: 0, kind: 'fracture' });
  sliderDef('Duration', { get: () => s.Duration, set: (v) => { s.Duration = v; }, lo: 1, hi: 10, step: 0.1, decimals: 1, kind: 'motion' });
  sliderDef('Transfer', { get: () => s.Transfer, set: (v) => { s.Transfer = v; }, lo: 0, hi: 1, step: 0.01, scale: 100, decimals: 0, kind: 'motion' });
  sliderDef('Release', { get: () => s.Release, set: (v) => { s.Release = v; }, lo: 0, hi: 200, step: 0.5, decimals: 1, kind: 'motion' });
  sliderDef('Gravity', { get: () => s.Gravity, set: (v) => { s.Gravity = v; }, lo: 0, hi: 30, step: 0.01, decimals: 2, kind: 'motion' });
  sliderDef('Restitution', { get: () => s.Restitution, set: (v) => { s.Restitution = v; }, lo: 0, hi: 0.95, step: 0.01, decimals: 2, kind: 'motion' });
  sliderDef('Friction', { get: () => s.Friction, set: (v) => { s.Friction = v; }, lo: 0, hi: 1.5, step: 0.01, decimals: 2, kind: 'motion' });
}

function renderInspector() {
  if (!result) return;
  defineSliders();
  const el = $('Inspector'), top = el.scrollTop;
  el.innerHTML = doc.selected !== null && result.pieces[doc.selected] ? fragmentInspector(doc.selected) : primitiveInspector();
  el.scrollTop = top;
  refreshLive();
  paintChrome();
}

const heroHtml = () => `<div class="hero" id="InsHero"><canvas></canvas><div class="hero-head"><span class="hero-tag" id="InsHeroTag"></span><div class="hero-key" id="InsHeroKey"></div></div><div class="hero-text"><b id="InsHeroBig"></b><small id="InsHeroSmall"></small></div><div class="hero-tip" id="InsHeroTip" hidden></div></div>`;

// Material: two pickers. Outside colours the original surface only; Interior is the bulk, so it sets density,
// crack resistance and the fracture pattern, and colours every cut face.
const MATERIAL_MODE = { 'bulk-brittle': 'Brittle bulk', fibrous: 'Fibrous grain', 'plate-brittle': 'Brittle plate', ductile: 'Tough polymer' };
const lift = (c, k, add = 0) => c.map((v) => Math.min(1, v * k + add));
const ballStyle = (c) => `background:radial-gradient(circle at 34% 30%, ${hex(lift(c, 1.3, 0.12))} 0%, ${hex(c)} 42%, ${hex(lift(c, 0.32))} 100%)`;
const cutStyle = (c) => `background:linear-gradient(140deg, ${hex(lift(c, 1.18, 0.05))} 0%, ${hex(c)} 48%, ${hex(lift(c, 0.55))} 100%)`;
function materialPick(slot) {
  const outside = slot === 'Surface', cur = MATERIALS[doc.recipe[slot]], tone = (mm) => (outside ? mm.color : mm.interior);
  const ball = (mm) => `<span class="mat-ball${outside ? '' : ' cut'}" style="${outside ? ballStyle(tone(mm)) : cutStyle(tone(mm))}"></span>`;
  const sub = (mm) => (outside ? `${MATERIAL_MODE[mm.mode]} · surface finish` : `Gc ${mm.Gc} J/m² · ${mm.density.toLocaleString('en-US')} kg/m³`);
  const lead = outside ? `${MATERIAL_MODE[cur.mode]} · colours the uncut shell` : `Gc ${cur.Gc} J/m² · ${cur.density.toLocaleString('en-US')} kg/m³ · sets the cracks`;
  return `<div class="mat-pick" data-pick="${slot}">
    <button class="mat-face">${ball(cur)}<span class="mat-text"><small>${outside ? 'Outside · original surface' : 'Interior · cut faces and bulk'}</small><b>${cur.label}</b><em>${lead}</em></span><i>${glyph('chevron')}</i></button>
    <div class="mat-list">${MATERIAL_ORDER.map((k) => { const mm = MATERIALS[k]; return `<button class="mat-opt${doc.recipe[slot] === k ? ' on' : ''}" data-pick-to="${k}">${ball(mm)}<span><b>${mm.label}</b><small>${sub(mm)}</small></span><i>${glyph('check')}</i></button>`; }).join('')}</div>
  </div>`;
}

// Fracture method: Baked (pre-cut here at full quality, pattern fixed) or Realtime (cut at impact within a budget).
function methodPicker() {
  const r = doc.recipe, base = authored || result, cap = realtimeCap(source, r), cost = cellCost(source), per = cost.per, kb = (base.metrics.bytes / 1024).toFixed(0);
  const rt = base.realtime, realtime = r.Method === 'realtime';
  const opt = (id, icon, facts) => `<button class="method-opt${r.Method === id ? ' on' : ''}" data-method="${id}">
      <span class="method-head"><img src="Icons/${icon}.svg" alt=""><span class="method-text"><b>${METHODS[id].label}</b><small>${METHODS[id].lead}</small></span><i class="method-check">${glyph('check')}</i></span>
      <dl class="method-facts">${facts.map(([k, v, cls]) => `<div><dt>${k}</dt><dd class="${cls || ''}">${v}</dd></div>`).join('')}</dl></button>`;
  const baked = opt('baked', 'editor-bake', [
    ['Pattern', METHODS.baked.pattern], ['At impact', 'Release only · 0 ms', 'good'],
    ['Stored', realtime ? 'Every piece' : `${kb} KB · ${base.pieces.length} pieces`], ['Bake', realtime ? 'Full quality' : `${base.ms.toFixed(0)} ms, ahead of time`],
  ]);
  const live = opt('realtime', 'lightning', [
    ['Pattern', METHODS.realtime.pattern], ['At impact', realtime && rt ? `${(doc.hit ? result : base).ms.toFixed(1)} of ${r.Budget} ms` : `≈ ${(cost.base + cap * per).toFixed(0)} of ${r.Budget} ms`, realtime && rt ? ((doc.hit ? result.realtime : rt).over ? 'bad' : 'good') : ''],
    ['Stored', 'Shape only'], ['Pieces', `≤ ${cap} cells · ${per.toFixed(2)} ms each`],
  ]);
  const budget = realtime ? `<div class="panel method-budget"><div class="field"><span>Frame budget</span><small>${rt && rt.over ? `over budget · the shape alone costs ≈ ${cost.base.toFixed(1)} ms` : `fits ${cap} cells`}</small></div>
      <div class="seg" data-seg="budget">${BUDGETS.map((b) => `<button data-value="${b}" class="${r.Budget === b ? 'on' : ''}">${b} ms</button>`).join('')}</div>
      <p class="note">One pass with plain fans and no needle re-cut. The cost per cell is measured on this machine, so the cap tracks what actually fits. In Sim and Play, the impact tool (I) hits the object and re-cuts where you hit.</p></div>`
    : `<p class="note">Cut once here at full quality and stored. A hit at runtime only releases the stored pieces, so the pattern does not follow the hit; try the impact tool (I) in Sim or Play.</p>`;
  return `<div class="method-pick">${baked}${live}</div>${budget}`;
}
function setMethod(id) { if (!METHODS[id] || doc.recipe.Method === id) return; doc.recipe.Method = id; renderInspector(); schedule('fracture'); }

function primitiveInspector() {
  const spec = primitiveById(doc.primitive), m = MATERIALS[doc.recipe.Material], d = source.dims;
  const shape = `<div class="panel">${spec.dims.map(([key, label, unit]) => field('dim:' + key, label, unit)).join('')}
      <div class="field"><span>Facet detail</span></div>
      <div class="seg" style="margin-top:7px" data-seg="detail">${Object.entries(DETAIL).map(([k, v]) => `<button data-value="${k}" class="${doc.detail === k ? 'on' : ''}">${v.label}</button>`).join('')}</div></div>
    <div class="panel"><dl class="facts" id="InsShapeFacts"></dl></div>`;
  const materials = materialPick('Surface') + materialPick('Material');
  const impact = `<div class="panel">${field('Energy', 'Impact energy', 'J')}
      <div class="xyz" id="ImpactXYZ">${['X', 'Y', 'Z'].map((k) => `<label><em>${k}</em><input data-axis="${k}" value="${doc.recipe[k].toFixed(3)}"></label>`).join('')}</div>
      <div class="pair"><button class="wide-btn${doc.aiming ? ' on' : ''}" data-act="aim"><img src="Icons/lightning.svg" alt="">Place on surface</button><button class="wide-btn" data-act="impact-reset">${glyph('reset')}Default</button></div></div>`;
  const pattern = `<div class="panel"><div class="field"><span>Seed</span><label class="amount"><input id="SeedBox" value="${doc.recipe.Seed}" inputmode="numeric"><em>#</em></label></div>
      ${field('Ceiling', 'Piece ceiling', 'pcs')}${field('MinimumSize', 'Minimum size', 'mm')}
      <button class="wide-btn" data-act="reroll"><img src="Icons/dice.svg" alt="">Reroll seed</button></div>`;
  const rtOff = doc.recipe.Method === 'realtime';
  const quality = `<div class="tiles">${toggleTile('NeedleRejection', 'Needle rejection', doc.recipe.NeedleRejection && !rtOff, 'triangle', rtOff ? 'Off in realtime' : '')}${toggleTile('ClosedCaps', 'Closed caps', doc.recipe.ClosedCaps, 'wire')}${toggleTile('QualityTriangulation', 'Quality fans', doc.recipe.QualityTriangulation && !rtOff, 'grid', rtOff ? 'Off in realtime' : '')}${toggleTile('smooth', 'Exact normals', doc.smooth, 'sphere', doc.smooth ? 'Analytic' : 'Faceted')}</div>`;
  const sim = `<div class="panel">${field('Duration', 'Duration', 's')}${field('Transfer', 'Energy transfer', '%')}${field('Release', 'Release threshold', 'J')}</div>
    <div class="panel">${field('Gravity', 'Gravity', 'm/s²')}${field('Restitution', 'Restitution', '')}${field('Friction', 'Friction', 'μ')}</div>
    <div class="tiles" style="margin-top:8px">${toggleTile('Collisions', 'Collisions', doc.simulation.Collisions, 'dots', doc.simulation.Collisions ? 'Spheres' : 'Off')}<button class="qt" data-act="sim-reset"><span class="qt-seat" style="--qt-ink:#bbb">${glyph('reset')}</span><b>Defaults</b><small>Reset motion</small></button></div>`;
  return `<div class="ins-heading"><div class="crumbs">Inspector / Fracture / <b>${spec.label}</b></div><button class="notes-btn" data-act="reroll">${glyph('dice')}Reroll seed</button><h1>${spec.label}</h1><p>Analytical primitive · ${m.label} · ${describe(spec.id, d)}</p></div>
    ${heroHtml()}
    <div class="stats" id="InsStats"></div>
    ${section('method', 'Fracture method', METHODS[doc.recipe.Method].lead, `<div id="MethodBody">${methodPicker()}</div>`)}
    ${section('shape', 'Shape', spec.formula, shape)}
    ${section('material', 'Material', 'Outside and interior', materials)}
    ${section('impact', 'Impact', 'Energy and point', impact)}
    ${section('pattern', 'Pattern', 'Voronoi seeds', pattern)}
    ${section('quality', 'Quality', 'Cells and shading', quality)}
    ${section('simulation', 'Simulation', 'Rigid-body preview', sim)}
    ${section('distribution', 'Size distribution', 'Log volume', `<div class="panel"><div class="bars" id="InsBars"></div><div class="bars-scale" id="InsBarsScale"></div></div>`)}
    ${section('log', 'Bake log', '', `<pre class="log" id="InsLog"></pre>`)}`;
}

function fragmentInspector(i) {
  const pc = result.pieces[i], spec = primitiveById(doc.primitive), m = MATERIALS[doc.recipe.Material], ov = doc.overrides.get(i) || 'auto', hidden = doc.hidden.has(i);
  return `<div class="ins-heading"><div class="crumbs">Inspector / Fragments / <b>Fragment ${pad2(i)}</b></div><button class="notes-btn" data-act="back">${glyph('chevron-right').replace('<svg', '<svg style="transform:rotate(180deg)"')}Back to ${spec.label}</button><h1>Fragment ${pad2(i)}</h1><p>Piece of ${spec.label} · ${m.label}${pc.chunks > 1 ? ` · ${pc.chunks} chunks rejoined at seams` : ''}</p></div>
    ${heroHtml()}
    <div class="stats" id="InsStats"></div>
    ${section('release', 'Release', 'Per-fragment override', `<div class="seg" data-seg="override">${['auto', 'held', 'released'].map((k) => `<button data-value="${k}" class="${ov === k ? 'on' : ''}">${{ auto: 'Auto', held: 'Hold', released: 'Release' }[k]}</button>`).join('')}</div>
      <p class="note">Auto releases a fragment when its share of the impact energy exceeds the ${doc.simulation.Release} J release threshold. Held fragments stay in the remaining body.</p>`)}
    ${section('geometry', 'Geometry', 'Closed convex cell', `<div class="panel"><dl class="facts" id="InsGeoFacts"></dl></div>`)}
    ${section('motion', 'Motion', doc.mode === 'edit' ? 'Simulate to bake' : 'Baked', `<div class="panel"><dl class="facts" id="InsMotionFacts"></dl></div>`)}
    <div class="pair" style="margin-top:14px"><button class="wide-btn" data-act="frame">${glyph('frame')}Frame</button><button class="wide-btn" data-act="hide">${glyph(hidden ? 'eye' : 'eye-off')}${hidden ? 'Show' : 'Hide'}</button></div>`;
}

// Parts of the inspector that change with every fracture / frame, without rebuilding the controls.
function refreshLive() {
  if (!result) return;
  paintChrome(); paintChips();
  const sel = doc.selected !== null && result.pieces[doc.selected] ? doc.selected : null;
  const m = result.metrics, r = doc.recipe, mat = MATERIALS[r.Material];
  const stats = $('InsStats');
  const tile = (num, label, warn = false) => `<div class="stat${warn ? ' warn' : ''}"><i class="arrow">${glyph('arrow-ne')}</i><div class="num">${num}</div><label>${label}</label></div>`;
  if (sel === null) {
    if (stats) stats.innerHTML = tile(`${m.cells}<span> / ${r.Ceiling}</span>`, result.plan.capped ? 'Cells · ceiling reached' : 'Cells / ceiling', result.plan.capped) + tile(split(m.cutArea, 2, 'm²'), 'New crack area') + tile(m.mass >= 1000 ? split(m.mass / 1000, 2, 't') : split(m.mass, 0, 'kg'), 'Mass') + (result.realtime ? tile(`${split(result.ms, 1, 'ms')}<span> / ${result.realtime.budget}</span>`, result.realtime.over ? 'At impact · over budget' : 'At impact · in budget', result.realtime.over) : tile(split(result.ms, 0, 'ms'), `Bake · ${m.cells} cells`));
    const big = $('InsHeroBig'), small = $('InsHeroSmall'), tag = $('InsHeroTag');
    if (big) {
      big.innerHTML = `${m.pieces} <span>fragments</span>`;
      const kin = Math.max(0, r.Energy - Math.min(r.Energy, result.plan.energy)) * doc.simulation.Transfer;
      small.innerHTML = `<span>${fmtJ(r.Energy)} impact · ${fmtJ(kin)} kinetic</span><span>${shares.releasedCount} released</span>`;
      tag.textContent = doc.mode === 'edit' ? 'Energy share' : 'Kinetic energy';
    }
    const methodBody = $('MethodBody'); if (methodBody) methodBody.innerHTML = methodPicker();
    const facts = $('InsShapeFacts');
    if (facts) facts.innerHTML = `<dt>Exact volume</dt><dd>${(source.exactVolume * 1000).toFixed(1)} L</dd><dt>Faceted volume</dt><dd>${(source.volume * 1000).toFixed(1)} L</dd><dt>Faceting error</dt><dd class="${Math.abs(source.faceting) < 0.01 ? 'good' : ''}">${(source.faceting * 100).toFixed(2)} %</dd><dt>Surface area</dt><dd>${source.exactArea.toFixed(3)} m²</dd><dt>Convex parts</dt><dd>${source.segments}${source.segmented ? ' wedge segments' : ''}</dd><dt>Surface facets</dt><dd>${source.faces.toLocaleString()}</dd>`;
    const bars = $('InsBars');
    if (bars) {
      const h = histogram(result), max = Math.max(1, ...h.counts);
      bars.innerHTML = h.counts.map((c, k) => `<i style="height:${(c / max) * 100}%;background:${hex(ramp(1 - k / Math.max(1, h.counts.length - 1)))}"></i>`).join('');
      $('InsBarsScale').innerHTML = `<span>${(h.lo * 1000).toFixed(h.lo < 0.001 ? 2 : 1)} L</span><span>${result.pieces.length} pieces</span><span>${(h.hi * 1000).toFixed(1)} L</span>`;
    }
    const log = $('InsLog'); if (log) log.textContent = result.log.join('\n');
  } else {
    const pc = result.pieces[sel];
    if (stats) stats.innerHTML = tile(pc.mass >= 1 ? split(pc.mass, 2, 'kg') : split(pc.mass * 1000, 0, 'g'), 'Mass') + tile(split(pc.volume * 1000, 2, 'L'), 'Volume') + tile(split(shares.energy[sel], shares.energy[sel] < 10 ? 2 : 0, 'J'), 'Energy share') + tile(split(pc.distance, 2, 'm'), 'From impact');
    const big = $('InsHeroBig');
    if (big) {
      big.innerHTML = `${fmtKg(pc.mass)} <span>· ${shares.released[sel] ? 'released' : 'held'}</span>`;
      $('InsHeroSmall').innerHTML = `<span>Rank ${sel + 1} of ${result.pieces.length} by distance</span><span>${fmtJ(shares.energy[sel])}</span>`;
      $('InsHeroTag').textContent = doc.mode === 'edit' ? 'Energy share' : 'Kinetic · fragment';
    }
    const geo = $('InsGeoFacts');
    if (geo) geo.innerHTML = `<dt>Faces</dt><dd>${pc.faces} (${pc.cutFaces} cut)</dd><dt>Triangles</dt><dd>${pc.tris}</dd><dt>Thickness</dt><dd class="${pc.span < r.MinimumSize ? 'bad' : ''}">${(pc.span * 1000).toFixed(0)} mm</dd><dt>Bounds</dt><dd>${pc.bounds.size.map((v) => (v * 100).toFixed(0)).join(' × ')} cm</dd><dt>Crack surface</dt><dd>${(pc.cutArea * 1e4).toFixed(0)} cm²</dd><dt>Worst triangle</dt><dd>${pc.minQ.toFixed(2)}</dd><dt>Convex chunks</dt><dd>${pc.chunks}</dd>`;
    const mo = $('InsMotionFacts');
    if (mo) {
      if (cache) {
        const P = cache.poses, n = cache.n, a = sel * 8, b = (n + sel) * 8, last = ((cache.steps - 1) * n + sel) * 8;
        const speed = Math.hypot(P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]) * cache.rate;
        let rest = null; for (let f = cache.steps - 1; f > 0; f--) if (P[(f * n + sel) * 8 + 7] > 1e-4) { rest = (f + 1) / cache.rate; break; }
        mo.innerHTML = `<dt>Launch speed</dt><dd>${speed.toFixed(2)} m/s</dd><dt>Peak kinetic</dt><dd>${fmtJ(pieceKinetic[sel] || 0)}</dd><dt>Comes to rest</dt><dd>${rest === null ? 'never moves' : rest >= cache.duration ? 'still moving' : rest.toFixed(2) + ' s'}</dd><dt>Travel</dt><dd>${fmtM(Math.hypot(P[last] - P[a], P[last + 1] - P[a + 1], P[last + 2] - P[a + 2]))}</dd>`;
      } else mo.innerHTML = `<dt>Rigid-body motion</dt><dd>Not baked · Shift+2</dd>`;
    }
  }
  paintHero();
}

// Hero chart. Edit: every fragment's share of the impact energy, ranked highest first, on the energy ramp, with the
// release threshold dividing released (filled) from held (ring) fragments. Sim / Play: kinetic energy over the bake
// with the playhead, peak and settle marks; a selected fragment is drawn over the faint total.
let heroHover = null;
function niceTop(v) { const mag = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1e-9)))); return [1, 2, 2.5, 5, 10].find((n) => n * mag >= v * 0.999) * mag; }
function heroGeometry(w, h) { return { x0: 16, x1: w - 46, y0: 100, y1: h - 26 }; }
function paintHero() {
  const hero = $('InsHero'); if (!hero || !result) return;
  const cv = hero.querySelector('canvas'), w = hero.clientWidth, h = hero.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
  if (!w) return;
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const { x0, x1, y0, y1 } = heroGeometry(w, h), sel = doc.selected, tip = $('InsHeroTip'), key = $('InsHeroKey');
  g.font = '300 8.5px DM Sans'; g.textBaseline = 'alphabetic';
  const gridLine = (y, label, strong = false) => {
    g.strokeStyle = strong ? '#ffffff24' : '#ffffff10'; g.lineWidth = 1; g.setLineDash(strong ? [] : [2, 4]);
    g.beginPath(); g.moveTo(x0, Math.round(y) + 0.5); g.lineTo(x1, Math.round(y) + 0.5); g.stroke(); g.setLineDash([]);
    if (label) { g.fillStyle = '#7d848d'; g.fillText(label, x1 + 8, y + 3); }
  };
  const axisText = (x, text, align) => { g.fillStyle = '#6f757d'; g.textAlign = align; g.fillText(text, x, h - 10); g.textAlign = 'left'; };
  let tipAt = null;

  if (doc.mode === 'edit' || !cache) {
    const order = result.pieces.map((p) => p.id).sort((a, b) => shares.energy[b] - shares.energy[a]), n = order.length;
    const peak = shares.peak || 1, lo = Math.max(shares.low || peak * 1e-3, peak * 1e-4);
    const norm = (e) => (doc.logScale ? (e <= lo ? 0 : Math.log(e / lo) / Math.log(peak / lo || 10)) : e / peak);
    const top = doc.logScale ? peak : niceTop(peak);
    const Y = (e) => y1 - Math.max(0, Math.min(1, doc.logScale ? norm(e) : e / top)) * (y1 - y0);
    const X = (k) => (n > 1 ? x0 + 6 + (k / (n - 1)) * (x1 - x0 - 12) : (x0 + x1) / 2);
    // grid: decades on log, quarters on linear
    if (doc.logScale) {
      for (let d = Math.ceil(Math.log10(lo)); d <= Math.floor(Math.log10(peak)); d++) { const e = Math.pow(10, d); gridLine(Y(e), fmtJ(e).replace('.00', '').replace('.0 ', ' ')); }
      gridLine(y1, '', true);
    } else for (let k = 0; k <= 4; k++) gridLine(Y((top * k) / 4), k ? fmtJ((top * k) / 4) : '', k === 0);
    // released zone above the threshold
    const rel = doc.simulation.Release, relY = rel > 0 && rel < peak ? Y(rel) : null;
    if (relY !== null) {
      const band = g.createLinearGradient(0, y0, 0, relY); band.addColorStop(0, '#ff8a3d14'); band.addColorStop(1, '#ff8a3d03');
      g.fillStyle = band; g.fillRect(x0, y0 - 4, x1 - x0, relY - y0 + 4);
    }
    // area under the ranked profile, coloured along the ramp
    if (n > 1) {
      const fill = g.createLinearGradient(x0, 0, x1, 0);
      order.forEach((id, k) => fill.addColorStop(k / (n - 1), hex(ramp(energyNorm(id, 0))) + '30'));
      g.beginPath(); g.moveTo(X(0), y1); order.forEach((id, k) => g.lineTo(X(k), Y(shares.energy[id]))); g.lineTo(X(n - 1), y1); g.closePath(); g.fillStyle = fill; g.fill();
      g.beginPath(); order.forEach((id, k) => (k ? g.lineTo(X(k), Y(shares.energy[id])) : g.moveTo(X(k), Y(shares.energy[id])))); g.strokeStyle = '#ffffff70'; g.lineWidth = 1.1; g.lineJoin = 'round'; g.stroke();
    }
    if (relY !== null) {
      g.setLineDash([5, 4]); g.strokeStyle = '#ffffffb0'; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, relY + 0.5); g.lineTo(x1, relY + 0.5); g.stroke(); g.setLineDash([]);
      const label = `release ${fmtJ(rel)}`, tw = g.measureText(label).width; g.fillStyle = '#111214e6'; roundRect(g, x0 + 2, relY - 8, tw + 14, 16, 8); g.fill(); g.strokeStyle = '#ffffff22'; g.stroke();
      g.fillStyle = '#f2f2f0'; g.fillText(label, x0 + 9, relY + 3);
    }
    // one dot per fragment: filled when released, ring when held
    const r = n > 70 ? 1.8 : n > 40 ? 2.4 : 3;
    let hoverK = null;
    if (heroHover && heroHover.y > y0 - 12) { hoverK = Math.round(((heroHover.x - x0 - 6) / (x1 - x0 - 12)) * (n - 1)); hoverK = Math.max(0, Math.min(n - 1, hoverK)); }
    order.forEach((id, k) => {
      const x = X(k), y = Y(shares.energy[id]), col = hex(ramp(energyNorm(id, 0))), dim = sel !== null && sel !== id;
      g.globalAlpha = dim ? 0.35 : 1;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
      if (shares.released[id]) { g.fillStyle = col; g.fill(); } else { g.fillStyle = '#141518'; g.fill(); g.strokeStyle = col; g.lineWidth = 1.2; g.stroke(); }
    });
    g.globalAlpha = 1;
    const mark = (k, strong) => {
      const id = order[k], x = X(k), y = Y(shares.energy[id]);
      g.strokeStyle = strong ? '#f2f2f0' : '#ffffff55'; g.lineWidth = 1; g.beginPath(); g.moveTo(x + 0.5, y + 6); g.lineTo(x + 0.5, y1); g.stroke();
      g.beginPath(); g.arc(x, y, r + 3, 0, Math.PI * 2); g.strokeStyle = '#f2f2f0'; g.lineWidth = 1.6; g.stroke();
      tipAt = { x, y: y - r - 8, text: `Fragment ${pad2(id)} · ${fmtJ(shares.energy[id])} · #${k + 1}` };
    };
    if (sel !== null) { const k = order.indexOf(sel); if (k >= 0) mark(k, true); }
    if (hoverK !== null) mark(hoverK, false);
    axisText(x0, 'highest share', 'left'); axisText((x0 + x1) / 2, `${n} fragments ranked`, 'center'); axisText(x1, 'lowest', 'right');
    key.innerHTML = `<span><i style="background:#ff8a3d"></i>Released</span><span><i style="border:1.2px solid #4f8fd9"></i>Held</span><span><i class="dash"></i>Threshold</span>`;
  } else {
    const steps = cache.steps, totals = cache.totals, single = sel !== null;
    const series = single ? Array.from({ length: steps }, (_, f) => cache.poses[(f * cache.n + sel) * 8 + 7]) : totals;
    const peak = Math.max(1e-6, ...series), top = niceTop(peak * 1.08), dur = cache.duration;
    const X = (t) => x0 + (t / dur) * (x1 - x0), Y = (v) => y1 - (v / top) * (y1 - y0);
    for (let k = 0; k <= 4; k++) gridLine(Y((top * k) / 4), k ? fmtJ((top * k) / 4) : '', k === 0);
    // settled stretch
    if (cache.settled !== null) {
      const sx = X(cache.settled); g.fillStyle = '#2fa58a12'; g.fillRect(sx, y0 - 4, x1 - sx, y1 - y0 + 4);
      g.strokeStyle = '#5bdb8766'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(sx + 0.5, y0 - 4); g.lineTo(sx + 0.5, y1); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#5bdb87'; g.fillText(`settled ${cache.settled.toFixed(2)} s`, Math.min(sx + 6, x1 - 70), y0 + 6);
    }
    // moving count as quiet columns along the floor
    const maxAwake = Math.max(1, ...cache.awake), colH = (y1 - y0) * 0.22;
    g.fillStyle = '#ffffff0d';
    for (let f = 0; f < steps; f += 3) { const v = cache.awake[f] / maxAwake; if (v > 0) g.fillRect(X(f / cache.rate), y1 - v * colH, Math.max(1, X(3 / cache.rate) - X(0) - 1), v * colH); }
    // ghost total under a selected fragment
    if (single) {
      const tp = Math.max(1e-6, ...totals);
      g.beginPath(); for (let f = 0; f < steps; f++) { const x = X(f / cache.rate), y = y1 - (totals[f] / tp) * (y1 - y0) * 0.92; f ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.strokeStyle = '#ffffff26'; g.lineWidth = 1; g.stroke();
    }
    const accent = single ? '#f2a93b' : '#ff8a3d';
    g.beginPath(); g.moveTo(X(0), y1); for (let f = 0; f < steps; f++) g.lineTo(X(f / cache.rate), Y(series[f])); g.lineTo(X(dur), y1); g.closePath();
    const grad = g.createLinearGradient(0, y0, 0, y1); grad.addColorStop(0, accent + '55'); grad.addColorStop(1, accent + '00'); g.fillStyle = grad; g.fill();
    g.beginPath(); for (let f = 0; f < steps; f++) { const x = X(f / cache.rate), y = Y(series[f]); f ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.strokeStyle = single ? accent : '#f4f4f2'; g.lineWidth = 1.5; g.lineJoin = 'round'; g.stroke();
    // peak
    let pf = 0; for (let f = 1; f < steps; f++) if (series[f] > series[pf]) pf = f;
    const px = X(pf / cache.rate), py = Y(series[pf]);
    g.beginPath(); g.arc(px, py, 2.5, 0, Math.PI * 2); g.fillStyle = '#f04d3d'; g.fill();
    g.fillStyle = '#e9e9e7'; const pl = `peak ${fmtJ(series[pf])}`; g.fillText(pl, Math.min(px + 7, x1 - g.measureText(pl).width), Math.max(y0 + 2, py - 4));
    // playhead or hover probe
    const probeT = heroHover && heroHover.y > y0 - 12 ? Math.max(0, Math.min(dur, ((heroHover.x - x0) / (x1 - x0)) * dur)) : sceneTime();
    const f = Math.max(0, Math.min(steps - 1, Math.round(probeT * cache.rate))), x = X(f / cache.rate), y = Y(series[f]);
    g.strokeStyle = heroHover ? '#ffffff55' : '#f2f2f0aa'; g.lineWidth = 1; g.beginPath(); g.moveTo(x + 0.5, y0 - 4); g.lineTo(x + 0.5, y1); g.stroke();
    g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = '#141518'; g.stroke();
    tipAt = { x, y: y - 10, text: `${(f / cache.rate).toFixed(2)} s · ${fmtJ(series[f])} · ${cache.awake[f]} moving` };
    axisText(x0, '0 s', 'left'); axisText((x0 + x1) / 2, `${(dur / 2).toFixed(1)} s`, 'center'); axisText(x1, `${dur.toFixed(1)} s`, 'right');
    key.innerHTML = `${single ? `<span><i style="background:${accent}"></i>Fragment ${pad2(sel)}</span><span><i class="dash" style="border-top-style:solid;opacity:.4"></i>Total</span>` : `<span><i style="background:#f4f4f2"></i>Kinetic</span>`}<span><i style="background:#ffffff30;border-radius:2px"></i>Moving</span>`;
  }
  if (tipAt) {
    tip.hidden = false; tip.textContent = tipAt.text;
    const half = Math.min(tip.offsetWidth / 2 + 4, w / 2);
    tip.style.left = `${Math.max(half, Math.min(w - half, tipAt.x))}px`; tip.style.top = `${Math.max(92, tipAt.y)}px`;
  } else tip.hidden = true;
}
// Hover probes the chart; click selects the ranked fragment (Edit) or scrubs to that moment (Sim / Play).
function heroPoint(e) { const hero = e.target.closest?.('#InsHero'); if (!hero) return null; const r = hero.getBoundingClientRect(); return { hero, x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height }; }
$('Inspector').addEventListener('pointermove', (e) => { const p = heroPoint(e); const next = p ? { x: p.x, y: p.y } : null; if (next || heroHover) { heroHover = next; paintHero(); } });
$('Inspector').addEventListener('pointerleave', () => { if (heroHover) { heroHover = null; paintHero(); } });
$('Inspector').addEventListener('click', (e) => {
  const p = heroPoint(e); if (!p || !result) return;
  const { x0, x1, y0 } = heroGeometry(p.w, p.h); if (p.y < y0 - 12) return;
  const u = Math.max(0, Math.min(1, (p.x - x0) / (x1 - x0)));
  if (doc.mode === 'edit' || !cache) {
    const order = result.pieces.map((pc) => pc.id).sort((a, b) => shares.energy[b] - shares.energy[a]);
    const k = Math.max(0, Math.min(order.length - 1, Math.round(((p.x - x0 - 6) / (x1 - x0 - 12)) * (order.length - 1))));
    heroHover = null; select(order[k]);
  } else { doc.playing = false; doc.time = u * cache.duration; sceneDirty = overlayDirty = true; paintTransport(); paintHero(); }
});
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath(); }

function openSection(id) {
  doc.shutSections.delete(id);
  const el = $('Inspector').querySelector(`[data-sec="${id}"]`);
  if (el) { el.classList.remove('shut'); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  save();
}
function syncImpactInputs() { document.querySelectorAll('#ImpactXYZ input').forEach((inp) => { inp.value = doc.recipe[inp.dataset.axis].toFixed(3); }); }

const ins = $('Inspector');
ins.addEventListener('input', (e) => {
  const f = e.target.closest('[data-slider]');
  if (f && e.target.classList.contains('slide')) {
    const def = SLIDERS[f.dataset.slider]; if (!def) return;
    def.set(fromSlide(def, +e.target.value));
    e.target.style.setProperty('--fill', `${e.target.value / 10}%`);
    f.querySelector('.amount input').value = shown(def, def.get());
    schedule(def.kind);
  }
});
ins.addEventListener('change', (e) => {
  const f = e.target.closest('[data-slider]');
  if (f && e.target.closest('.amount')) {
    const def = SLIDERS[f.dataset.slider], v = parseFloat(e.target.value);
    if (Number.isFinite(v)) def.set(Math.max(def.lo === 20 ? 0 : def.lo, Math.min(def.hi, v / (def.scale || 1))));
    e.target.value = shown(def, def.get());
    const s = toSlide(def, def.get()), slide = f.querySelector('.slide'); slide.value = s; slide.style.setProperty('--fill', `${s / 10}%`);
    schedule(def.kind); return;
  }
  if (e.target.dataset.axis) { const v = parseFloat(e.target.value); if (Number.isFinite(v)) doc.recipe[e.target.dataset.axis] = v; schedule('fracture'); return; }
  if (e.target.id === 'SeedBox') { const v = parseInt(e.target.value, 10); if (Number.isFinite(v)) doc.recipe.Seed = Math.max(1, Math.min(999999, v)); e.target.value = doc.recipe.Seed; schedule('fracture'); }
});
ins.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur(); });
ins.addEventListener('click', (e) => {
  const head = e.target.closest('.sec-head');
  if (head) { const s = head.parentElement, id = s.dataset.sec; s.classList.toggle('shut'); s.classList.contains('shut') ? doc.shutSections.add(id) : doc.shutSections.delete(id); save(); if (!s.classList.contains('shut')) refreshLive(); return; }
  const method = e.target.closest('[data-method]');
  if (method) { setMethod(method.dataset.method); return; }
  const face = e.target.closest('.mat-face');
  if (face) { const pick = face.parentElement, open = pick.classList.contains('open'); document.querySelectorAll('.mat-pick.open').forEach((p) => p.classList.remove('open')); pick.classList.toggle('open', !open); return; }
  const opt = e.target.closest('[data-pick-to]');
  if (opt) {
    const slot = opt.closest('[data-pick]').dataset.pick; doc.recipe[slot] = opt.dataset.pickTo;
    if (slot === 'Surface') { buildMeshes(); sceneDirty = overlayDirty = treeDirty = true; save(); } else schedule('fracture');
    renderInspector(); return;
  }
  const tog = e.target.closest('[data-toggle]');
  if (tog) {
    const k = tog.dataset.toggle;
    if (k === 'smooth') { doc.smooth = !doc.smooth; sceneDirty = true; save(); }
    else if (k === 'Collisions') { doc.simulation.Collisions = !doc.simulation.Collisions; schedule('motion'); }
    else { doc.recipe[k] = !doc.recipe[k]; schedule('fracture'); }
    renderInspector(); return;
  }
  const seg = e.target.closest('[data-seg] button');
  if (seg) {
    const kind = seg.parentElement.dataset.seg, v = seg.dataset.value;
    seg.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === seg));
    if (kind === 'detail') { doc.detail = v; schedule('source'); }
    if (kind === 'budget') { doc.recipe.Budget = +v; schedule('fracture'); }
    if (kind === 'override') { v === 'auto' ? doc.overrides.delete(doc.selected) : doc.overrides.set(doc.selected, v); invalidateMotion(); renderTree(); }
    return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'reroll') reroll();
  else if (act === 'aim') setAiming(!doc.aiming);
  else if (act === 'impact-reset') { const hit = defaultImpact(source); doc.recipe.X = hit[0]; doc.recipe.Y = hit[1]; doc.recipe.Z = hit[2]; syncImpactInputs(); schedule('fracture'); }
  else if (act === 'sim-reset') { doc.simulation = { ...SIMULATION_DEFAULTS }; renderInspector(); schedule('motion'); }
  else if (act === 'back') select(null);
  else if (act === 'frame') frameSelection();
  else if (act === 'hide') { const i = doc.selected; doc.hidden.has(i) ? doc.hidden.delete(i) : doc.hidden.add(i); sceneDirty = overlayDirty = treeDirty = true; renderInspector(); }
});
function reroll() { doc.recipe.Seed = 1 + Math.floor(Math.random() * 99999); const box = $('SeedBox'); if (box) box.value = doc.recipe.Seed; schedule('fracture'); }

// ---------------------------------------------------------------------------------------------------- modes & playback
function setMode(mode) {
  if (mode !== 'edit' && !result) return;
  doc.mode = mode; setAiming(false);
  if (mode === 'edit') { restoreAuthored(); doc.playing = false; doc.time = 0; }
  else { ensureCache(); doc.explode = 0; $('Explode').value = 0; $('ExplodeValue').textContent = '0 %'; $('Explode').style.setProperty('--fill', '0%'); }
  if (mode === 'sim') { doc.playing = false; doc.time = Math.max(0, Math.min(doc.time, cache.duration)); }
  if (mode === 'play') { doc.time = -PREROLL; doc.playing = true; }
  sceneDirty = overlayDirty = treeDirty = true;
  renderInspector(); paintTrack(); paintTransport();
}
function togglePlay() {
  if (doc.mode === 'edit') { setMode('play'); return; }
  if (!doc.playing && doc.time >= cache.duration - 1e-3) doc.time = doc.mode === 'play' ? -PREROLL : 0;
  doc.playing = !doc.playing; paintTransport();
}
function toStart() { if (doc.mode === 'edit') return; doc.time = doc.mode === 'play' ? -PREROLL : 0; sceneDirty = overlayDirty = true; if (doc.mode === 'play') doc.playing = true; paintTransport(); }
function step(dir) { if (doc.mode === 'edit') setMode('sim'); doc.playing = false; doc.time = Math.max(0, Math.min(cache.duration, doc.time + dir / 60)); sceneDirty = overlayDirty = true; paintTransport(); }
function paintTransport() {
  const play = $('PbPlay'); play.dataset.glyph = doc.playing ? 'pause' : 'play'; play.innerHTML = glyph(doc.playing ? 'pause' : 'play');
  $('PbLoop').classList.toggle('on', doc.loop);
  document.querySelectorAll('#PbSpeed button').forEach((b) => b.classList.toggle('on', +b.dataset.speed === doc.speed));
  $('Playback').classList.toggle('idle', doc.mode === 'edit');
  $('TrackEmpty').hidden = doc.mode !== 'edit' || !!cache;
  paintClock();
}
function paintClock() {
  const total = cache ? cache.duration : doc.simulation.Duration;
  const t = doc.time;
  $('PbNow').textContent = (t < 0 ? '−' : '') + Math.abs(t).toFixed(2);
  $('PbTotal').textContent = `/ ${total.toFixed(2)} s`;
  const phase = $('PbPhase');
  phase.className = doc.playing ? 'live' : '';
  phase.textContent = doc.mode === 'edit' ? 'EDIT · NOT BAKED' : t < 0 ? 'PRE-ROLL · IMPACT IN ' + Math.abs(t).toFixed(1) + ' S' : doc.playing ? `PLAYING · ${doc.speed}×` : cache && cache.settled !== null && t >= cache.settled ? 'SETTLED · AT REST' : 'PAUSED · SCRUB TO INSPECT';
  $('PbEnergy').textContent = doc.mode === 'edit' ? fmtJ(0) : fmtJ(live.total);
  $('PbAwake').textContent = doc.mode === 'edit' ? `${shares ? shares.releasedCount : 0} will release` : `${live.awake} moving`;
  const tr = $('Track'), w = tr.clientWidth, head = $('TrackHead');
  head.style.left = `${(cache ? Math.max(0, t) / cache.duration : 0) * w}px`;
  head.style.display = doc.mode === 'edit' ? 'none' : '';
}
function paintTrack() {
  const tr = $('Track'), cv = $('TrackCanvas'), w = tr.clientWidth, h = tr.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
  if (!w) return;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const duration = cache ? cache.duration : doc.simulation.Duration, X = (t) => (t / duration) * w;
  // ticks every 0.1 s, labels every 0.5 s
  g.font = '300 8.5px DM Sans'; g.textBaseline = 'alphabetic';
  for (let k = 0; k <= Math.round(duration * 10); k++) {
    const t = k / 10, x = Math.round(X(t)) + 0.5, major = k % 5 === 0;
    g.strokeStyle = major ? '#ffffff2a' : '#ffffff12'; g.beginPath(); g.moveTo(x, h - (major ? 12 : 6)); g.lineTo(x, h); g.stroke();
    if (major && k > 0 && x < w - 20) { g.fillStyle = '#6a6a68'; g.fillText(`${t.toFixed(1)} s`, x + 4, h - 4); }
  }
  let events = '';
  if (cache) {
    const steps = cache.steps, peak = Math.max(1e-6, ...cache.totals), top = 8, bottom = h - 13;
    if (cache.settled !== null) { g.fillStyle = '#2fa58a1c'; g.fillRect(0, 0, X(cache.settled), h); }
    // awake count as faint bars
    const maxAwake = Math.max(1, ...cache.awake);
    g.fillStyle = '#ffffff0a';
    for (let f = 0; f < steps; f += 2) { const v = cache.awake[f] / maxAwake; g.fillRect(X(f / cache.rate), bottom - v * (bottom - top) * 0.6, Math.max(1, X(2 / cache.rate)) - 0.5, v * (bottom - top) * 0.6); }
    // kinetic energy curve: white line, orange fill
    const Y = (v) => bottom - Math.sqrt(v / peak) * (bottom - top);
    g.beginPath(); g.moveTo(0, bottom); for (let f = 0; f < steps; f++) g.lineTo(X(f / cache.rate), Y(cache.totals[f])); g.lineTo(X(duration), bottom); g.closePath();
    const grad = g.createLinearGradient(0, top, 0, bottom); grad.addColorStop(0, '#ff8a3d50'); grad.addColorStop(1, '#ff8a3d00'); g.fillStyle = grad; g.fill();
    g.beginPath(); for (let f = 0; f < steps; f++) { const x = X(f / cache.rate), y = Y(cache.totals[f]); f ? g.lineTo(x, y) : g.moveTo(x, y); } g.strokeStyle = '#ececea'; g.lineWidth = 1.3; g.stroke();
    let pf = 0; for (let f = 0; f < steps; f++) if (cache.totals[f] > cache.totals[pf]) pf = f;
    const ev = (t, label, color) => `<span class="pb-event" style="left:${Math.max(44, Math.min(w - 54, X(t)))}px"><i style="background:${color}"></i>${label}</span>`;
    events += ev(0, result.realtime ? `Impact · cut in ${result.ms.toFixed(1)} ms` : doc.hit ? 'Re-hit 0.00' : 'Impact 0.00', '#ff8a3d');
    if (pf > 2) events += ev(pf / cache.rate, `Peak ${fmtJ(cache.totals[pf])}`, '#f04d3d');
    events += cache.settled !== null ? ev(cache.settled, `Settled ${cache.settled.toFixed(2)}`, '#5bdb87') : ev(duration, 'Still moving', '#f0c23d');
  }
  $('TrackEvents').innerHTML = events;
  paintClock();
}
let scrubbing = false;
function scrubTo(e) {
  const r = $('Track').getBoundingClientRect();
  if (doc.mode === 'edit') setMode('sim');
  doc.playing = false;
  doc.time = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * cache.duration;
  sceneDirty = overlayDirty = true; paintTransport();
}
$('Track').addEventListener('pointerdown', (e) => { scrubbing = true; $('Track').setPointerCapture(e.pointerId); scrubTo(e); });
$('Track').addEventListener('pointermove', (e) => { if (scrubbing) scrubTo(e); });
$('Track').addEventListener('pointerup', () => { scrubbing = false; });
$('PbPlay').addEventListener('click', togglePlay);
$('PbStart').addEventListener('click', toStart);
$('PbStep').addEventListener('click', () => step(1));
$('PbLoop').addEventListener('click', () => { doc.loop = !doc.loop; paintTransport(); save(); });
$('PbSpeed').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { doc.speed = +b.dataset.speed; paintTransport(); save(); } });

// ---------------------------------------------------------------------------------------------------- toolbar
document.querySelectorAll('.modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
$('PrimaryBtn').addEventListener('click', () => { if (doc.mode === 'edit') setMode('sim'); else if (doc.mode === 'sim') setMode('play'); else toStart(); });
$('FrameBtn').addEventListener('click', frameSelection);
$('ImpactBtn').addEventListener('click', () => setAiming(!doc.aiming));
$('WireBtn').addEventListener('click', () => { doc.wire = !doc.wire; sceneDirty = true; paintChrome(); });
$('SeedsBtn').addEventListener('click', () => { doc.seeds = !doc.seeds; sceneDirty = true; paintChrome(); });
$('DiagBtn').addEventListener('click', () => diagnostics.toggle());
$('GridBtn').addEventListener('click', () => { doc.grid = !doc.grid; sceneDirty = true; paintChrome(); save(); });
$('Explode').addEventListener('input', (e) => { doc.explode = +e.target.value; $('ExplodeValue').textContent = `${Math.round(doc.explode * 100)} %`; e.target.style.setProperty('--fill', `${doc.explode * 100}%`); sceneDirty = overlayDirty = true; });
$('LegendScale').addEventListener('click', () => { doc.logScale = !doc.logScale; sceneDirty = true; paintChips(); paintHero(); paintSwatches(); save(); });
for (const drop of document.querySelectorAll('.drop')) {
  drop.querySelector('.drop-face').addEventListener('click', (e) => { e.stopPropagation(); const open = drop.classList.contains('open'); document.querySelectorAll('.drop.open').forEach((d) => d.classList.remove('open')); drop.classList.toggle('open', !open); });
  drop.querySelector('.drop-list').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; drop.classList.remove('open');
    if (drop.id === 'ShadingDrop') setShading(b.dataset.value); else setFilter(b.dataset.value);
  });
}
document.addEventListener('click', (e) => {
  document.querySelectorAll('.drop.open').forEach((d) => d.classList.remove('open'));
  if (!e.target.closest('.mat-pick')) document.querySelectorAll('.mat-pick.open').forEach((p) => p.classList.remove('open'));
});
function setShading(s) { doc.shading = s; sceneDirty = true; paintChrome(); paintChips(); save(); }

// Library drawer (bottom notch)
function paintLibrary() {
  $('LibraryGrid').innerHTML = PRIMITIVES.map((p) => `<button class="lib-tile${p.id === doc.primitive ? ' on' : ''}" data-primitive="${p.id}"><img src="Icons/${p.icon}.svg" alt=""><i class="lib-arrow">${glyph('arrow-ne')}</i><b>${p.label}</b><small>${describe(p.id, doc.dims[p.id])}</small><em>${p.convex ? 'Convex' : 'Segmented'} · ${p.formula}</em></button>`).join('');
}
function setLibrary(open) { doc.library = open; $('Library').hidden = !open; paintChrome(); }
$('LibraryNotch').addEventListener('click', () => setLibrary(!doc.library));
$('LibraryClose').addEventListener('click', () => setLibrary(false));
$('LibraryGrid').addEventListener('click', (e) => { const t = e.target.closest('[data-primitive]'); if (t) { setPrimitive(t.dataset.primitive); setLibrary(false); } });

// ---------------------------------------------------------------------------------------------------- keyboard
addEventListener('keydown', (e) => {
  const typing = e.target.tagName === 'INPUT' && e.target.type !== 'range';
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('OlSearch').focus(); $('OlSearch').select(); return; }
  if (typing) { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.target.tagName === 'SELECT' && e.code !== 'F3' && e.code !== 'Escape') return;
  if (e.shiftKey && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) { e.preventDefault(); setMode(['edit', 'sim', 'play'][+e.code.slice(-1) - 1]); return; }
  if (e.altKey && e.code === 'KeyF') { e.preventDefault(); frameSelection(); return; }
  switch (e.code) {
    case 'Space': e.preventDefault(); togglePlay(); break;
    case 'Home': e.preventDefault(); toStart(); break;
    case 'Comma': step(-1); break;
    case 'Period': step(1); break;
    case 'KeyL': doc.loop = !doc.loop; paintTransport(); break;
    case 'KeyF': frameSelection(); break;
    case 'KeyI': setAiming(!doc.aiming); break;
    case 'KeyM': setMethod(doc.recipe.Method === 'baked' ? 'realtime' : 'baked'); break;
    case 'KeyR': if (doc.mode === 'edit') reroll(); break;
    case 'KeyW': doc.wire = !doc.wire; sceneDirty = true; paintChrome(); break;
    case 'KeyG': doc.grid = !doc.grid; sceneDirty = true; paintChrome(); break;
    case 'KeyV': doc.seeds = !doc.seeds; sceneDirty = true; paintChrome(); break;
    case 'KeyE': setShading(doc.shading === 'energy' ? 'material' : 'energy'); break;
    case 'KeyH': if (doc.selected !== null) { const i = doc.selected; doc.hidden.has(i) ? doc.hidden.delete(i) : doc.hidden.add(i); sceneDirty = overlayDirty = treeDirty = true; renderInspector(); } break;
    case 'F3': e.preventDefault(); diagnostics.toggle(); break;
    case 'Escape':
      if (diagnostics.isOpen) diagnostics.close(); else if (doc.library) setLibrary(false); else if (doc.aiming) setAiming(false); else if (doc.selected !== null) select(null); else if (doc.mode !== 'edit') setMode('edit');
      break;
    case 'BracketRight': case 'BracketLeft': if (result) { const n = result.pieces.length, d = e.code === 'BracketRight' ? 1 : -1; select(doc.selected === null ? 0 : (doc.selected + d + n) % n); } break;
  }
});

// ---------------------------------------------------------------------------------------------------- loop
let last = performance.now(), frames = 0, fpsAt = last, swatchAt = 0, holdUntil = 0;
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.1, (now - last) / 1000); last = now; frames++;
  diagnostics.frame(now);
  if (now - fpsAt > 1000) { $('StatusFps').textContent = `${Math.round((frames * 1000) / (now - fpsAt))} fps`; frames = 0; fpsAt = now; }
  if (doc.playing && cache && now > holdUntil) {
    doc.time += dt * doc.speed;
    if (doc.time >= cache.duration) {
      if (doc.loop) { doc.time = doc.mode === 'play' ? -PREROLL : 0; holdUntil = now + 500; }
      else { doc.time = cache.duration; doc.playing = false; paintTransport(); }
    }
    sceneDirty = overlayDirty = true;
  }
  if (sceneDirty) {
    sceneDirty = false; updateScene(); paintClock();
    if (doc.mode !== 'edit' && now - swatchAt > 90) { swatchAt = now; paintSwatches(); paintHero(); refreshMotionReadouts(); }
  }
  if (treeDirty) renderTree();
  if (overlayDirty) { overlayDirty = false; paintOverlay(); }
}
function refreshMotionReadouts() { paintChips(); }

addEventListener('resize', () => { viewport.dirty = true; overlayDirty = true; paintTrack(); paintHero(); });

// ---------------------------------------------------------------------------------------------------- start
hydrateGlyphs();
rebuildSource(false);
refracture();
viewport.camera.yaw = 0.62; viewport.camera.pitch = 0.42;
frameSelection();
paintLibrary(); renderInspector(); setFilter('all'); paintTransport(); paintTrack();
diagnostics = new Diagnostics(() => ({ mode: doc.mode, playing: doc.playing, time: sceneTime(), result, cache, source, recipe: doc.recipe, simulation: doc.simulation, live, shares }));
diagnostics.bakeFracture(result);
requestAnimationFrame(tick);
window.fractureEditor = { doc, get result() { return result; }, get cache() { return cache; }, diagnostics, hitAt, setMethod, setMode, setPrimitive, select, setShading };
