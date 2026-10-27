import './ui/styles.css';
import { PRESETS, PRESET_GROUPS, PlantParams, cloneParams, groupOf, plantHeight } from './tropical/params';
import { Viewer, DEFAULT_VIEW, ViewerSettings, DisplayMode } from './viewer/scene';
import { el, icon, button, section, slider, select, check, stepper, colorRow, fmtInt, fmtCompact } from './ui/controls';
import type { WorkerRequest, WorkerResponse, GenerateResponse } from './worker/plant.worker';

const APP_NAME = 'Frontier';

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

let params: PlantParams = cloneParams(PRESETS[0]);
const view: ViewerSettings = { ...DEFAULT_VIEW };
let lastResult: GenerateResponse | null = null;
let busy = false;
let pending = false;
let reqId = 0;
let hasPlant = false;

const worker = new Worker(new URL('./worker/plant.worker.ts', import.meta.url), { type: 'module' });

// -----------------------------------------------------------------------------
// Layout: three floating cards – Library · Viewport · Inspector
// -----------------------------------------------------------------------------

const app = document.getElementById('app')!;
app.append(el('div', 'bg'));

// ---- Library (left) ---------------------------------------------------------

const library = el('aside', 'card library');
{
  const head = el('div', 'card-head');
  const h1 = el('h1');
  h1.append(el('span', 'dot green'), document.createTextNode('Library'));
  head.append(h1, el('span', 'badge', APP_NAME + ' · species'));
  library.append(head);
}
const libTiles = el('div', 'tiles');
const tileSpecies = el('div', 'tile');
const tileFaces = el('div', 'tile');
libTiles.append(tileSpecies, tileFaces);
library.append(libTiles);

const searchRow = el('div', 'search');
searchRow.append(icon('search'));
const searchInput = el('input');
searchInput.placeholder = 'Search species…';
searchInput.spellcheck = false;
searchRow.append(searchInput);
library.append(searchRow);

const libTree = el('div', 'tree');
library.append(libTree);

const libFoot = el('div', 'card-foot');
library.append(libFoot);

// ---- Viewport (centre) ------------------------------------------------------

const viewport = el('main', 'card viewport');
const canvas = el('canvas');
viewport.append(canvas);

const vtop = el('div', 'vtop');
const modeSeg = el('div', 'seg');
const MODES: { id: DisplayMode; label: string }[] = [
  { id: 'shaded', label: 'Shaded' },
  { id: 'matcap', label: 'Clay' },
  { id: 'wireframe', label: 'Wire' },
  { id: 'levels', label: 'Organs' },
  { id: 'junctions', label: 'Junctions' },
  { id: 'wind', label: 'Wind' },
];
const modeButtons = new Map<DisplayMode, HTMLButtonElement>();
for (const m of MODES) {
  const b = el('button', m.id === view.mode ? 'on' : '', m.label);
  b.addEventListener('click', () => {
    view.mode = m.id;
    syncView();
  });
  modeButtons.set(m.id, b);
  modeSeg.append(b);
}
const toggleSeg = el('div', 'seg');
const wireToggle = el('button');
wireToggle.append(icon('quad'), el('span', '', 'Quads'));
wireToggle.title = 'Quad overlay';
wireToggle.addEventListener('click', () => {
  view.showWire = !view.showWire;
  syncView();
});
const texToggle = el('button');
texToggle.append(icon('texture'), el('span', '', 'Texture'));
texToggle.title = 'Procedural texture (off = flat vertex colour)';
texToggle.addEventListener('click', () => {
  view.useTexture = !view.useTexture;
  syncView();
});
const windToggle = el('button');
windToggle.append(icon('wind'), el('span', '', 'Wind'));
windToggle.title = 'Animate wind';
windToggle.addEventListener('click', () => {
  view.windEnabled = !view.windEnabled;
  syncView();
});
toggleSeg.append(wireToggle, texToggle, windToggle);
const actionSeg = el('div', 'seg');
const frameBtn = el('button');
frameBtn.append(icon('frame'), el('span', '', 'Frame'));
frameBtn.title = 'Frame the plant · F';
const shotBtn = el('button');
shotBtn.append(icon('camera'));
shotBtn.title = 'Save a PNG of the viewport';
actionSeg.append(frameBtn, shotBtn);
const exportSeg = el('div', 'seg');
const exportObj = el('button');
exportObj.append(icon('download'), el('span', '', 'OBJ'));
const exportGlb = el('button');
exportGlb.append(icon('download'), el('span', '', 'GLB'));
exportSeg.append(exportObj, exportGlb);
vtop.append(modeSeg, el('span', 'spacer'), toggleSeg, actionSeg, exportSeg);
viewport.append(vtop);

const axisHud = el('div', 'axis-hud');
const camPill = el('div', 'pill');
const sizePill = el('div', 'pill');
axisHud.append(sizePill, camPill);
viewport.append(axisHud);

const vtitle = el('div', 'vtitle');
const vtitleName = el('span', 'n');
const vtitleMeta = el('span', 'm');
vtitle.append(vtitleName, vtitleMeta);
viewport.append(vtitle);

const hud = el('div', 'hud');
const navPill = el('div', 'nav glass keysbar');
const keys = el('div', 'keys');
for (const [k, l] of [
  ['LMB', 'orbit'],
  ['RMB', 'pan'],
  ['F', 'frame'],
  ['B', 'base'],
  ['R', 'reseed'],
]) {
  keys.append(el('span', 'k', k), el('span', 'kl', l));
}
navPill.append(keys);
const status = el('div', 'nav glass status');
const statusDot = el('span', 'sdot');
const statusText = el('span', '', 'Idle');
status.append(statusDot, statusText);
hud.append(status, navPill);
viewport.append(hud);

const legend = el('div', 'legend');
viewport.append(legend);

const toast = el('div', 'toast');
viewport.append(toast);

const errBar = el('div', 'errbar');
viewport.append(errBar);

// ---- Inspector (right) ------------------------------------------------------

const panel = el('aside', 'card inspector');
const inspectorBadge = el('span', 'badge', 'palm · welded');
{
  const head = el('div', 'card-head');
  const h1 = el('h1');
  h1.append(el('span', 'dot orange'), document.createTextNode('Inspector'));
  head.append(h1, inspectorBadge);
  panel.append(head);
}
const hero = el('div', 'hero');
panel.append(hero);
const presence = el('div', 'presence');
panel.append(presence);

const tabs = el('div', 'tabs');
const tabBotany = el('button', 'on', 'Botany');
const tabRoots = el('button', '', 'Roots');
const tabMesh = el('button', '', 'Mesh');
const tabView = el('button', '', 'View');
const tabReport = el('button', '', 'Topology');
tabs.append(tabBotany, tabRoots, tabMesh, tabView, tabReport);
const scroll = el('div', 'insp');
panel.append(tabs, scroll);

const pages = {
  botany: el('div'),
  roots: el('div'),
  mesh: el('div'),
  view: el('div'),
  report: el('div'),
};
scroll.append(pages.botany, pages.roots, pages.mesh, pages.view, pages.report);
const tabMap: [HTMLButtonElement, HTMLElement][] = [
  [tabBotany, pages.botany],
  [tabRoots, pages.roots],
  [tabMesh, pages.mesh],
  [tabView, pages.view],
  [tabReport, pages.report],
];
function showTab(btn: HTMLButtonElement): void {
  for (const [b, p] of tabMap) {
    b.classList.toggle('on', b === btn);
    p.style.display = b === btn ? '' : 'none';
  }
  scroll.scrollTop = 0;
}
for (const [btn] of tabMap) btn.addEventListener('click', () => showTab(btn));
showTab(tabBotany);

const cmdline = el('div', 'cmdline');
const cmdPrompt = el('span', 'prompt', '›');
const cmdInput = el('input');
cmdInput.placeholder = 'command · seed 42 · preset coconut · mode wire · export glb · help';
cmdInput.spellcheck = false;
cmdline.append(cmdPrompt, cmdInput);
panel.append(cmdline);

app.append(library, viewport, panel);

// -----------------------------------------------------------------------------
// Viewer
// -----------------------------------------------------------------------------

const viewer = new Viewer(canvas);
const narrowObserver = new ResizeObserver(() => viewport.classList.toggle('narrow', viewport.clientWidth < 860));
narrowObserver.observe(viewport);
let camTick = 0;
viewer.onFrame(() => {
  if (++camTick % 6 !== 0) return;
  const az = ((viewer.controls.getAzimuthalAngle() * 180) / Math.PI + 360) % 360;
  const elv = 90 - (viewer.controls.getPolarAngle() * 180) / Math.PI;
  camPill.textContent = `persp · az ${az.toFixed(0)}° · el ${elv.toFixed(0)}° · d ${viewer.controls.getDistance().toFixed(1)} m · ${viewer.fps.toFixed(0)} fps`;
});
frameBtn.addEventListener('click', () => viewer.frame());
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
  if (e.key === 'f' || e.key === 'F') viewer.frame();
  if (e.key === 'b' || e.key === 'B') viewer.frameBase(baseReach());
  if (e.key === 'r' || e.key === 'R') randomSeed();
  if (e.key === 'w' || e.key === 'W') {
    view.showWire = !view.showWire;
    syncView();
  }
});

function baseReach(): number {
  return Math.max(0.5, params.botany.trunkRadius * 8);
}

shotBtn.addEventListener('click', () => {
  const url = viewer.screenshot();
  download(url, `${slug(params.name)}_${params.seed}.png`);
});

const ORGAN_NAMES = ['Trunk', 'Rachis', 'Leaves', 'Fruit', 'Roots'];
const ORGAN_COLORS = ['#8a5a3c', '#c98b4b', '#6fa16b', '#5aa1c9', '#b86b5c'];

function syncView(): void {
  viewer.applySettings(view);
  if (lastResult) refreshPresence();
  for (const [id, b] of modeButtons) b.classList.toggle('on', id === view.mode);
  wireToggle.classList.toggle('on', view.showWire);
  texToggle.classList.toggle('on', view.useTexture);
  windToggle.classList.toggle('on', view.windEnabled);
  legend.style.display = view.mode === 'levels' || view.mode === 'junctions' || view.mode === 'wind' ? '' : 'none';
  legend.innerHTML = '';
  if (view.mode === 'levels') {
    for (let i = 0; i < 5; i++) {
      const s = el('span');
      const ic = el('i');
      ic.style.background = ORGAN_COLORS[i];
      s.append(ic, document.createTextNode(ORGAN_NAMES[i]));
      legend.append(s);
    }
  } else if (view.mode === 'junctions') {
    const s = el('span');
    const ic = el('i');
    ic.style.background = '#f26b2e';
    s.append(ic, document.createTextNode('Welded junction loops (window collars)'));
    legend.append(s);
  } else if (view.mode === 'wind') {
    const s = el('span');
    s.append(document.createTextNode('Limb bend weight: '));
    const i0 = el('i');
    i0.style.background = '#1a338c';
    const i1 = el('i');
    i1.style.background = '#33bf8c';
    const i2 = el('i');
    i2.style.background = '#fad940';
    s.append(i0, document.createTextNode('rigid '), i1, document.createTextNode('mid '), i2, document.createTextNode('flexible'));
    legend.append(s);
  }
  for (const r of viewRefreshers) r();
}

// -----------------------------------------------------------------------------
// Generation
// -----------------------------------------------------------------------------

let debounceTimer = 0;
let frameOnNext = false;

function scheduleGenerate(immediate = false): void {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => generate(), immediate ? 0 : 140);
}

function generate(): void {
  if (busy) {
    pending = true;
    return;
  }
  busy = true;
  setStatus('busy', 'Generating…');
  const id = ++reqId;
  const msg: WorkerRequest = { type: 'generate', id, params: cloneParams(params) };
  worker.postMessage(msg);
}

worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
  const msg = ev.data;
  if (msg.type === 'error') {
    busy = false;
    setStatus('err', 'Generation failed');
    errBar.textContent = msg.message;
    errBar.classList.add('show');
    console.error(msg.message);
    return;
  }
  if (msg.type === 'exported') {
    const blob = new Blob([msg.data], { type: msg.format === 'obj' ? 'text/plain' : 'model/gltf-binary' });
    download(URL.createObjectURL(blob), `${slug(params.name)}_${params.seed}.${msg.format}`);
    showToast(`${msg.format.toUpperCase()} exported`);
    exportObj.disabled = exportGlb.disabled = false;
    return;
  }
  if (msg.type === 'generated') {
    busy = false;
    if (msg.id !== reqId) {
      if (pending) {
        pending = false;
        generate();
      }
      return;
    }
    lastResult = msg;
    const firstPlant = !hasPlant;
    viewer.setPlant(msg.buffers, msg.summary.height);
    if (firstPlant || frameOnNext) viewer.frame();
    frameOnNext = false;
    hasPlant = true;
    updateReport(msg);
    if (pending) {
      pending = false;
      generate();
    }
  }
};

function setStatus(kind: 'ok' | 'warn' | 'err' | 'busy' | '', text: string): void {
  statusDot.className = 'sdot ' + kind;
  statusText.textContent = text;
  if (kind !== 'err') errBar.classList.remove('show');
}

// -----------------------------------------------------------------------------
// Report
// -----------------------------------------------------------------------------

function kvSpan(ico: string, label: string, value: string, cls = ''): HTMLElement {
  const sp = el('span', 'kv' + (cls ? ' ' + cls : ''));
  sp.append(icon(ico), document.createTextNode(label + (value ? ' ' : '')));
  if (value) sp.append(el('b', '', value));
  return sp;
}

function refreshPresence(): void {
  const cells = presence.querySelectorAll<HTMLElement>('.pcell');
  const states = [view.useTexture, view.showGrid, view.windEnabled, view.autoRotate];
  cells.forEach((c, i) => c.classList.toggle('on', states[i]));
}

function groupIcon(name: string): string {
  return PRESET_GROUPS.find((g) => g.label === groupOf(name))?.icon ?? 'palm';
}

/** Tiny bar chart of organs per type in the hero card. */
function drawSpark(cv: HTMLCanvasElement, values: number[], labels: string[]): void {
  const w = 96;
  const h = 56;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = w * dpr;
  cv.height = h * dpr;
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  const max = Math.max(1, ...values);
  const bw = 12;
  const gap = (w - bw * values.length) / Math.max(1, values.length - 1);
  values.forEach((v, i) => {
    const bh = Math.max(2, (Math.log1p(v) / Math.log1p(max)) * (h - 14));
    const x = i * (bw + gap);
    ctx.fillStyle = ORGAN_COLORS[i];
    ctx.globalAlpha = 0.9;
    roundRect(ctx, x, h - 12 - bh, bw, bh, 3);
    ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#fff';
    ctx.font = '8px JetBrains Mono Variable, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(labels[i], x + bw / 2, h - 2);
  });
  ctx.globalAlpha = 1;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function updateReport(r: GenerateResponse): void {
  const rep = r.report;
  const ok = rep.closed && rep.manifold && rep.components === 1 && rep.genus === 0;
  setStatus(ok ? 'ok' : 'warn', ok ? 'Closed manifold · genus 0 · 1 piece' : 'Topology issues – see report');

  inspectorBadge.textContent = `${params.habit === 'branching' ? 'tree' : params.habit} · welded`;

  // Hero card: species, height, mesh census.
  hero.innerHTML = '';
  const cTop = el('div', 'c-top');
  const ico = el('span', 'ico');
  ico.append(icon(groupIcon(params.name)));
  const heroText = el('div', 't');
  heroText.append(el('span', 'n', params.name), el('span', 'm', `${groupOf(params.name).toLowerCase()} · seed ${params.seed} · ${r.timings.total.toFixed(0)} ms`));
  cTop.append(ico, heroText);
  const big = el('div', 'big');
  const hSmall = r.summary.height < 1;
  big.append(el('span', 'v', hSmall ? (r.summary.height * 100).toFixed(0) : r.summary.height.toFixed(1)), el('span', 'u', hSmall ? 'cm' : 'm'), el('span', 'lab', 'height'));
  const side = el('div', 'side');
  const cell = (k: string, v: string, cls = ''): void => {
    const d = el('div');
    d.append(el('span', 'k', k), el('span', 'v2' + (cls ? ' ' + cls : ''), v));
    side.append(d);
  };
  const organs = r.stats.tubesByOrgan;
  const organTotal = organs.reduce((a, b) => a + b, 0);
  cell('faces', fmtCompact(rep.faces));
  cell('quads', `${(rep.quadRatio * 100).toFixed(rep.quadRatio > 0.9995 ? 0 : 1)} %`);
  cell('organs', fmtCompact(organTotal));
  cell('welds', fmtCompact(r.stats.junctions));
  cell('genus', ok ? '0 · closed' : `${rep.genus} · ${rep.components} part${rep.components === 1 ? '' : 's'}`, ok ? 'ok' : 'warn');
  const spark = el('canvas', 'spark');
  hero.append(cTop, big, side, spark);
  drawSpark(spark, organs, ['TRK', 'RAC', 'LEAF', 'FRUIT', 'ROOT']);

  // Presence grid.
  presence.innerHTML = '';
  const pcell = (name: string, label: string, on: boolean, click: () => void): void => {
    const c = el('button', 'pcell' + (on ? ' on' : ''));
    c.append(icon(name), el('span', '', label));
    c.addEventListener('click', click);
    presence.append(c);
  };
  pcell('texture', 'Texture', view.useTexture, () => {
    view.useTexture = !view.useTexture;
    syncView();
  });
  pcell('grid', 'Grid', view.showGrid, () => {
    view.showGrid = !view.showGrid;
    syncView();
  });
  pcell('wind', 'Wind', view.windEnabled, () => {
    view.windEnabled = !view.windEnabled;
    syncView();
  });
  pcell('turntable', 'Spin', view.autoRotate, () => {
    view.autoRotate = !view.autoRotate;
    syncView();
  });

  vtitleName.textContent = params.name;
  vtitleMeta.textContent = `seed ${params.seed} · ${fmtInt(organTotal)} organs welded · 1 mesh${r.stats.dropped ? ` · ${r.stats.dropped} dropped` : ''}`;
  sizePill.textContent = `${fmtInt(rep.faces)} F · ${fmtInt(rep.vertices)} V · ${fmtInt(r.buffers.index.length / 3)} tris`;
  tileFaces.innerHTML = '';
  tileFaces.className = 'tile ' + (ok ? 'ok' : 'warn');
  tileFaces.append(el('span', 'l', 'Faces'), el('span', 's', ok ? 'genus 0 · 1 piece' : `${rep.boundaryEdges + rep.nonManifoldEdges} bad edges`), el('b', '', fmtCompact(rep.faces)));

  libFoot.innerHTML = '';
  const census = el('div', 'census');
  const total = Math.max(1, organTotal);
  organs.forEach((n, i) => {
    const bar = el('i');
    bar.style.width = `${(n / total) * 100}%`;
    bar.style.background = ORGAN_COLORS[i];
    census.append(bar);
  });
  const footRow = el('div', 'foot-row');
  footRow.append(kvSpan('palm', 'organs', fmtInt(organTotal)), kvSpan('layers', 'welds', fmtInt(r.stats.junctions)), el('span', 'sp'), kvSpan('check', ok ? 'clean' : 'issues', '', ok ? 'ok' : 'warn'));
  libFoot.append(census, footRow);

  // Topology page.
  const page = pages.report;
  page.innerHTML = '';
  const s1 = section('Manifold checks', page, { hint: ok ? 'all pass' : 'issues' });
  const list = el('div', 'list');
  const item = (label: string, pass: boolean, detail: string): void => {
    const it = el('div', 'li' + (pass ? '' : ' warn'));
    it.append(el('span', 'dot'), el('span', 't', label), el('span', 'm', detail));
    list.append(it);
  };
  item('Closed surface (no boundary edges)', rep.boundaryEdges === 0, `${rep.boundaryEdges} open`);
  item('2-manifold (every edge has 2 faces)', rep.nonManifoldEdges === 0, `${rep.nonManifoldEdges} bad`);
  item('Consistent winding', rep.inconsistentEdges === 0, `${rep.inconsistentEdges} flipped`);
  item('Single connected piece', rep.components === 1, `${rep.components} part${rep.components === 1 ? '' : 's'}`);
  item('Genus 0  (V − E + F = 2)', rep.eulerCharacteristic === 2, `χ = ${rep.eulerCharacteristic}`);
  item('No degenerate faces', rep.degenerateFaces === 0, `${rep.degenerateFaces}`);
  item('No isolated vertices', rep.isolatedVertices === 0, `${rep.isolatedVertices}`);
  s1.append(list);

  const s2 = section('Mesh statistics', page, { hint: `${fmtCompact(rep.faces)} faces` });
  const grid = el('div', 'kvgrid');
  const add = (k: string, v: string, cls = ''): void => {
    grid.append(el('span', '', k), el('b', cls, v));
  };
  add('Vertices', fmtInt(rep.vertices));
  add('Edges', fmtInt(rep.edges));
  add('Faces', fmtInt(rep.faces));
  add('Quads', `${fmtInt(rep.quads)}  (${(rep.quadRatio * 100).toFixed(2)} %)`, rep.quadRatio > 0.99 ? 'ok' : 'warn');
  add('Triangles', fmtInt(rep.tris));
  add('Triangulated', fmtInt(r.buffers.index.length / 3));
  add('Poles (valence ≠ 4)', `${fmtInt(rep.poles)}  (${((rep.poles / Math.max(1, rep.vertices)) * 100).toFixed(1)} %)`);
  add('Min edge length', `${(rep.minEdgeLength * 1000).toFixed(1)} mm`);
  add('Organs welded', fmtInt(organTotal));
  ORGAN_NAMES.forEach((n, i) => add(`· ${n.toLowerCase()}`, fmtInt(organs[i])));
  add('Junctions (windows)', fmtInt(r.stats.junctions));
  add('Organs dropped', fmtInt(r.stats.dropped), r.stats.dropped ? 'warn' : 'ok');
  s2.append(grid);

  const s3 = section('Valence histogram', page, { collapsed: true });
  const bars = el('div', 'bars');
  const entries = Object.entries(rep.valenceHistogram)
    .map(([k, v]) => [Number(k), v] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const maxV = Math.max(1, ...entries.map((e) => e[1]));
  for (const [val, count] of entries) {
    bars.append(el('span', '', `v${val}`));
    const bar = el('div', 'bar');
    const fill = el('i');
    fill.style.width = `${(count / maxV) * 100}%`;
    bar.append(fill);
    bars.append(bar, el('span', '', fmtInt(count)));
  }
  s3.append(bars);

  const t = r.timings;
  const s4 = section('Timings', page, { collapsed: true, hint: `${t.total.toFixed(0)} ms` });
  const tg = el('div', 'kvgrid');
  const addT = (k: string, v: number): void => {
    tg.append(el('span', '', k), el('b', '', `${v.toFixed(1)} ms`));
  };
  addT('Grow + weld', t.build);
  addT('Validation', t.validate);
  addT('GPU buffers', t.buffers);
  addT('Total', t.total);
  s4.append(tg);

  if (r.stats.dropped > 0) {
    const s5 = section('Dropped organs', page, { collapsed: true, hint: String(r.stats.dropped) });
    const dg = el('div', 'kvgrid');
    for (const [k, v] of Object.entries(r.stats.dropReasons)) dg.append(el('span', '', k), el('b', '', fmtInt(v)));
    s5.append(dg, el('p', 'note', 'An organ is dropped when no window can be opened for it on its parent without overlapping another junction. More radial segments, larger organs or fewer children make room.'));
  }
}

// -----------------------------------------------------------------------------
// Library (species browser)
// -----------------------------------------------------------------------------

const closedGroups = new Set<string>();

function speciesMeta(name: string): string {
  const p = PRESETS.find((x) => x.name === name);
  if (!p) return '';
  const h = plantHeight(p);
  const hm = h < 1 ? `${Math.round(h * 100)} cm` : `${h.toFixed(1)} m`;
  switch (p.habit) {
    case 'palm':
      return `${p.botany.frondType} · ${hm} · ${p.botany.frondCount} fronds`;
    case 'paddle':
      return `paddle leaves · ${hm}`;
    case 'rosette':
      return `big-leaf · ${hm}`;
    case 'branching':
      return `tree · ${hm} · L${p.botany.branchLevels}`;
  }
}

function buildLibrary(): void {
  libTree.innerHTML = '';
  const q = searchInput.value.trim().toLowerCase();
  const grouped = new Set<string>();
  const groups = PRESET_GROUPS.map((g) => ({ ...g, names: g.names.filter((n) => PRESETS.some((p) => p.name === n)) }));
  for (const g of groups) g.names.forEach((n) => grouped.add(n));
  const rest = PRESETS.map((p) => p.name).filter((n) => !grouped.has(n));
  if (rest.length) groups.push({ label: 'Other', icon: 'tree', accent: '#9aa4b2', names: rest });
  let shown = 0;
  for (const g of groups) {
    const names = g.names.filter((n) => !q || n.toLowerCase().includes(q) || g.label.toLowerCase().includes(q));
    if (names.length === 0) continue;
    const grp = el('div', 'grp' + (closedGroups.has(g.label) && !q ? ' closed' : ''));
    const gh = el('div', 'grp-h');
    gh.append(icon('caret', 'i car'), el('span', '', g.label), el('span', 'cnt', String(names.length)));
    gh.addEventListener('click', () => {
      if (closedGroups.has(g.label)) closedGroups.delete(g.label);
      else closedGroups.add(g.label);
      grp.classList.toggle('closed');
    });
    const kids = el('div', 'kids');
    for (const name of names) {
      const row = el('div', 'row' + (name === params.name ? ' sel' : ''));
      row.style.setProperty('--acc', g.accent);
      const ico = el('span', 'ico');
      ico.append(icon(g.icon));
      const txt = el('div', 'txt');
      txt.append(el('span', 'name', name), el('span', 'meta', speciesMeta(name)));
      row.append(ico, txt);
      if (name === params.name) {
        const st = el('span', 'st ok');
        st.append(icon('check'));
        row.append(st);
      }
      row.addEventListener('click', () => {
        if (name !== params.name) selectPreset(name);
      });
      kids.append(row);
      shown++;
    }
    grp.append(gh, kids);
    libTree.append(grp);
  }
  if (shown === 0) {
    const empty = el('div', 'empty');
    empty.append(el('b', '', 'No species match'), document.createTextNode('Try a family name such as “palm”, “banana”, “fan” or “tree”.'));
    libTree.append(empty);
  }
  tileSpecies.innerHTML = '';
  tileSpecies.className = 'tile ok';
  tileSpecies.append(el('span', 'l', 'Species'), el('span', 's', `${groups.length} families`), el('b', '', String(PRESETS.length)));
}
searchInput.addEventListener('input', () => buildLibrary());
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    searchInput.value = '';
    buildLibrary();
    searchInput.blur();
  }
});

// -----------------------------------------------------------------------------
// Inspector pages
// -----------------------------------------------------------------------------

const refreshers: (() => void)[] = [];
const viewRefreshers: (() => void)[] = [];
const onChange = (): void => {
  scheduleGenerate();
  for (const r of refreshers) r();
};

/** Slider whose UI value is scaled (e.g. cm shown, metres stored). */
function scaledSlider(
  parent: HTMLElement,
  label: string,
  get: () => number,
  set: (v: number) => void,
  scale: number,
  opts: { min: number; max: number; step?: number; unit?: string; title?: string },
): void {
  slider(parent, label, () => get() * scale, (v) => set(v / scale), opts, onChange);
}

function buildBotanyPage(): void {
  const page = pages.botany;
  page.innerHTML = '';
  refreshers.length = 0;
  const b = params.botany;
  const B = (): typeof b => params.botany;

  const sSeed = section('Seed', page, { hint: groupOf(params.name).toLowerCase() });
  const seedRow = el('div', 'ctl rowctl seed');
  seedRow.append(el('span', 'lab', 'Seed'));
  const stp = el('div', 'stp');
  const seedInput = el('input', 'n');
  seedInput.type = 'text';
  seedInput.spellcheck = false;
  seedInput.value = String(params.seed);
  seedInput.addEventListener('change', () => {
    const v = parseInt(seedInput.value, 10);
    if (!Number.isNaN(v)) {
      params.seed = v;
      scheduleGenerate(true);
    }
  });
  seedInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') seedInput.blur();
  });
  const seedDec = el('button', 'b', '−');
  seedDec.addEventListener('click', () => setSeed(params.seed - 1));
  const seedInc = el('button', 'b', '+');
  seedInc.addEventListener('click', () => setSeed(params.seed + 1));
  stp.append(seedDec, seedInput, seedInc);
  const rnd = button('Randomise', () => randomSeed(), { icon: 'dice', kbd: 'R', cls: 'slim' });
  seedRow.append(stp, rnd);
  sSeed.append(seedRow);
  const resetRow = el('div', 'actions');
  resetRow.append(
    button('Reset species', () => {
      const seed = params.seed;
      params = cloneParams(PRESETS.find((p) => p.name === params.name) ?? PRESETS[0]);
      params.seed = seed;
      rebuildPages();
      scheduleGenerate(true);
    }, { icon: 'reset', title: 'Restore the preset values of the current species' }),
  );
  sSeed.append(resetRow);
  refreshers.push(() => {
    seedInput.value = String(params.seed);
  });

  // ── trunk ─────────────────────────────────────────────────────────────────
  const sTrunk = section(params.habit === 'paddle' ? 'Stem' : params.habit === 'rosette' ? 'Crown & stem' : 'Trunk', page);
  slider(sTrunk, 'Height', () => B().trunkHeight, (v) => (B().trunkHeight = v), { min: 0.1, max: 30, step: 0.1, unit: 'm' }, onChange);
  scaledSlider(sTrunk, 'Radius', () => B().trunkRadius, (v) => (B().trunkRadius = v), 100, { min: 1, max: 60, step: 0.5, unit: 'cm' });
  slider(sTrunk, 'Curve', () => B().trunkCurve, (v) => (B().trunkCurve = v), { min: 0, max: 1, step: 0.02, title: 'Lean and sweep of the trunk' }, onChange);
  slider(sTrunk, 'Ring scars', () => B().ringFrequency, (v) => (B().ringFrequency = v), { min: 0, max: 24, step: 0.5, unit: '/m', title: 'Old frond-base rings per metre (0 = smooth)' }, onChange);
  slider(sTrunk, 'Scar depth', () => B().ringDepth, (v) => (B().ringDepth = v), { min: 0, max: 1, step: 0.05 }, onChange);
  if (params.habit === 'palm') {
    slider(sTrunk, 'Crownshaft', () => B().crownshaft, (v) => (B().crownshaft = v), { min: 0, max: 0.25, step: 0.005, title: 'Smooth green shaft under the crown (royal palm), fraction of height' }, onChange);
  }
  if (params.habit === 'palm' || params.habit === 'paddle') {
    refreshers.push(stepper(sTrunk, 'Stems (clump)', () => B().stemCount, (v) => (B().stemCount = v), { min: 1, max: 9, integer: true, title: 'Clustering stems, each welded into the shared root crown' }, onChange).refresh);
  }
  if (params.habit === 'rosette') {
    slider(sTrunk, 'Climbing stem', () => B().stemClimb, (v) => (B().stemClimb = v), { min: 0, max: 1, step: 0.05, title: 'Leaves spread along a winding stem (monstera) instead of a ground rosette' }, onChange);
  }

  // ── habit-specific crown ──────────────────────────────────────────────────
  if (params.habit === 'palm') {
    const sCrown = section('Crown & fronds', page);
    select(sCrown, 'Frond type', [{ value: 'pinnate', label: 'Pinnate (feather)' }, { value: 'palmate', label: 'Palmate (fan)' }], () => B().frondType, (v) => (B().frondType = v), onChange);
    slider(sCrown, 'Fronds', () => B().frondCount, (v) => (B().frondCount = Math.round(v)), { min: 3, max: 60, step: 1 }, onChange);
    slider(sCrown, 'Frond length', () => B().frondLength, (v) => (B().frondLength = v), { min: 0.5, max: 8, step: 0.1, unit: 'm' }, onChange);
    slider(sCrown, 'Frond arc', () => B().frondArc, (v) => (B().frondArc = v), { min: 0, max: 2, step: 0.05, title: 'Droop curvature of the rachis' }, onChange);
    slider(sCrown, 'Crown spread', () => B().crownSpread, (v) => (B().crownSpread = v), { min: 20, max: 160, step: 1, unit: '°', title: 'Elevation from spear leaf to oldest frond' }, onChange);
    slider(sCrown, 'Phyllotaxis', () => B().phyllotaxis, (v) => (B().phyllotaxis = v), { min: 60, max: 220, step: 0.5, unit: '°', title: 'Azimuth between successive fronds (137.5° = golden angle, 180° = two-ranked fan)' }, onChange);
    slider(sCrown, 'Petiole ratio', () => B().petioleRatio, (v) => (B().petioleRatio = v), { min: 0.02, max: 0.75, step: 0.01, title: 'Bare stalk before leaflets / segments begin' }, onChange);
    refreshers.push(stepper(sCrown, 'Dead skirt', () => B().skirtFronds, (v) => (B().skirtFronds = v), { min: 0, max: 40, integer: true, title: 'Hanging dead fronds under the crown (Washingtonia)' }, onChange).refresh);

    const sLeaf = section(B().frondType === 'palmate' ? 'Segments' : 'Leaflets', page);
    slider(sLeaf, 'Per side', () => B().leafletsPerSide, (v) => (B().leafletsPerSide = Math.round(v)), { min: 4, max: 90, step: 1 }, onChange);
    slider(sLeaf, 'Length', () => B().leafletLength, (v) => (B().leafletLength = v), { min: 0.1, max: 2, step: 0.05, unit: 'm' }, onChange);
    scaledSlider(sLeaf, 'Width', () => B().leafletWidth, (v) => (B().leafletWidth = v), 1000, { min: 8, max: 120, step: 1, unit: 'mm' });
    slider(sLeaf, 'Insertion angle', () => B().leafletAngle, (v) => (B().leafletAngle = v), { min: 15, max: 90, step: 1, unit: '°', title: 'Angle from the rachis axis (90° = perpendicular)' }, onChange);
    slider(sLeaf, 'Droop', () => B().leafletDroop, (v) => (B().leafletDroop = v), { min: 0, max: 2.5, step: 0.05 }, onChange);
    slider(sLeaf, 'Twist', () => B().leafletTwist, (v) => (B().leafletTwist = v), { min: 0, max: 120, step: 1, unit: '°', title: 'Blade roll toward the tip' }, onChange);
    slider(sLeaf, 'Plume', () => B().plume, (v) => (B().plume = v), { min: 0, max: 1, step: 0.05, title: '0 = flat two-ranked V · 1 = plumose, multi-plane feather (queen palm)' }, onChange);
  } else if (params.habit === 'paddle' || params.habit === 'rosette') {
    const sLeaf = section('Leaves', page);
    slider(sLeaf, 'Leaves', () => B().frondCount, (v) => (B().frondCount = Math.round(v)), { min: 2, max: 24, step: 1 }, onChange);
    slider(sLeaf, 'Leaf length', () => B().leafLength, (v) => (B().leafLength = v), { min: 0.3, max: 5, step: 0.05, unit: 'm', title: 'Petiole + blade' }, onChange);
    slider(sLeaf, 'Blade width', () => B().bladeWidth, (v) => (B().bladeWidth = v), { min: 0.08, max: 1.4, step: 0.02, unit: 'm' }, onChange);
    slider(sLeaf, 'Petiole ratio', () => B().petioleRatio, (v) => (B().petioleRatio = v), { min: 0.05, max: 0.8, step: 0.01 }, onChange);
    slider(sLeaf, 'Blade arc', () => B().bladeArc, (v) => (B().bladeArc = v), { min: 0, max: 2, step: 0.05 }, onChange);
    slider(sLeaf, 'Blade pitch', () => B().bladePitch, (v) => (B().bladePitch = v), { min: 0, max: 90, step: 1, unit: '°', title: '90° = blade held flat to the sky, 0° = upright flag' }, onChange);
    slider(sLeaf, 'Splits', () => B().bladeNotch, (v) => (B().bladeNotch = v), { min: 0, max: 1, step: 0.05, title: 'Deep marginal splits (monstera) — cut into the blade, never through it' }, onChange);
    slider(sLeaf, 'Heart lobes', () => B().bladeLobes, (v) => (B().bladeLobes = v), { min: 0, max: 1, step: 0.05, title: 'Basal lobes of heart/arrow leaves (alocasia, taro)' }, onChange);
    slider(sLeaf, 'Crown spread', () => B().crownSpread, (v) => (B().crownSpread = v), { min: 10, max: 130, step: 1, unit: '°' }, onChange);
    slider(sLeaf, 'Phyllotaxis', () => B().phyllotaxis, (v) => (B().phyllotaxis = v), { min: 60, max: 220, step: 0.5, unit: '°', title: '180° = two-ranked fan (bird of paradise, traveler palm)' }, onChange);
  } else {
    const sBranch = section('Branching', page);
    refreshers.push(stepper(sBranch, 'Levels', () => B().branchLevels, (v) => (B().branchLevels = v), { min: 1, max: 4, integer: true, title: 'Recursion depth of the branch system' }, onChange).refresh);
    slider(sBranch, 'Branches / node', () => B().branchCount, (v) => (B().branchCount = v), { min: 2, max: 5, step: 0.1 }, onChange);
    slider(sBranch, 'Branch angle', () => B().branchAngle, (v) => (B().branchAngle = v), { min: 10, max: 85, step: 1, unit: '°' }, onChange);
    slider(sBranch, 'Branch thickness', () => B().branchTaper, (v) => (B().branchTaper = v), { min: 0.35, max: 0.9, step: 0.02, title: 'Child radius relative to parent (frangipani ≈ 0.78)' }, onChange);

    const sLeaf = section('Leaves', page);
    select(sLeaf, 'Leaf type', [{ value: 'simple', label: 'Simple blade' }, { value: 'palmate', label: 'Palmate (umbrella)' }], () => B().compoundLeaf, (v) => (B().compoundLeaf = v), onChange);
    refreshers.push(stepper(sLeaf, 'Leaves / tip', () => B().leavesPerTip, (v) => (B().leavesPerTip = v), { min: 1, max: 14, integer: true }, onChange).refresh);
    slider(sLeaf, 'Leaf length', () => B().leafLength, (v) => (B().leafLength = v), { min: 0.1, max: 1.2, step: 0.02, unit: 'm' }, onChange);
    slider(sLeaf, 'Blade width', () => B().bladeWidth, (v) => (B().bladeWidth = v), { min: 0.03, max: 0.6, step: 0.01, unit: 'm' }, onChange);
    slider(sLeaf, 'Petiole ratio', () => B().petioleRatio, (v) => (B().petioleRatio = v), { min: 0.03, max: 0.7, step: 0.01 }, onChange);
    slider(sLeaf, 'Blade arc', () => B().bladeArc, (v) => (B().bladeArc = v), { min: 0, max: 2, step: 0.05 }, onChange);
    slider(sLeaf, 'Blade pitch', () => B().bladePitch, (v) => (B().bladePitch = v), { min: 0, max: 90, step: 1, unit: '°' }, onChange);
  }

  // ── fruit ─────────────────────────────────────────────────────────────────
  const sFruit = section('Fruit & flowers', page, { collapsed: params.botany.nutCount === 0 });
  refreshers.push(stepper(sFruit, 'Count', () => B().nutCount, (v) => (B().nutCount = v), { min: 0, max: 24, integer: true, title: 'Nuts / inflorescences welded under the crown or at branch tips' }, onChange).refresh);
  scaledSlider(sFruit, 'Size', () => B().nutSize, (v) => (B().nutSize = v), 100, { min: 1, max: 30, step: 0.5, unit: 'cm' });

  // ── colour ────────────────────────────────────────────────────────────────
  const sCol = section('Colour', page, { collapsed: true, hint: 'flat + procedural' });
  refreshers.push(colorRow(sCol, 'Leaf (old)', () => B().leafColor, (v) => (B().leafColor = v), onChange).refresh);
  refreshers.push(colorRow(sCol, 'Leaf (fresh)', () => B().leafColor2, (v) => (B().leafColor2 = v), onChange).refresh);
  refreshers.push(colorRow(sCol, 'Dead fronds', () => B().deadColor, (v) => (B().deadColor = v), onChange).refresh);
  refreshers.push(colorRow(sCol, 'Trunk', () => B().trunkColor, (v) => (B().trunkColor = v), onChange).refresh);
  refreshers.push(colorRow(sCol, 'Trunk top', () => B().trunkColor2, (v) => (B().trunkColor2 = v), onChange).refresh);
  refreshers.push(colorRow(sCol, 'Rachis / stalks', () => B().rachisColor, (v) => (B().rachisColor = v), onChange).refresh);
  refreshers.push(colorRow(sCol, 'Fruit A', () => B().nutColor, (v) => (B().nutColor = v), onChange).refresh);
  refreshers.push(colorRow(sCol, 'Fruit B', () => B().nutColor2, (v) => (B().nutColor2 = v), onChange).refresh);
}

function buildRootsPage(): void {
  const page = pages.roots;
  page.innerHTML = '';
  const R = (): PlantParams['roots'] => params.roots;
  const s1 = section('Root system', page, { hint: R().stiltCount > 0 ? `${Math.round(R().stiltCount)} stilts` : 'flare only' });
  slider(s1, 'Root flare', () => R().flare, (v) => (R().flare = v), { min: 0, max: 2, step: 0.05, title: 'Basal bulge and buttress fluting where the trunk meets the ground' }, onChange);
  refreshers.push(stepper(s1, 'Stilt roots', () => Math.round(R().stiltCount), (v) => (R().stiltCount = v), { min: 0, max: 16, integer: true, title: 'Prop roots welded into the trunk, diving to the ground (walking palm, monstera aerials)' }, onChange).refresh);
  slider(s1, 'Stilt height', () => R().stiltHeight, (v) => (R().stiltHeight = v), { min: 0.02, max: 0.6, step: 0.01, title: 'Attachment height as a fraction of trunk height' }, onChange);
  page.append(
    Object.assign(el('p', 'note'), {
      textContent: 'Roots are not separate props: each stilt root is extruded from a window cut into the trunk and welded in with the same collar topology as every frond, so the plant stays one closed surface above and below ground.',
    }),
  );
}

function buildMeshPage(): void {
  const page = pages.mesh;
  page.innerHTML = '';
  const M = (): PlantParams['mesh'] => params.mesh;
  const s1 = section('Resolution', page);
  slider(s1, 'Trunk ring segments', () => M().trunkSides, (v) => (M().trunkSides = Math.round(v / 2) * 2), { min: 10, max: 40, step: 2, unit: 'v', title: 'Vertices around the trunk. Children derive their ring size from the window they grow out of.' }, onChange);
  slider(s1, 'Geometry density', () => M().quality, (v) => (M().quality = v), { min: 0.5, max: 2, step: 0.1, unit: '×', title: 'Global ring-density multiplier. Geometry is cheap; topology is forever.' }, onChange);
  refreshers.push(stepper(s1, 'Leaflet rings', () => M().leafletRings, (v) => (M().leafletRings = v), { min: 4, max: 20, integer: true, title: 'Rings along each leaflet / segment' }, onChange).refresh);
  refreshers.push(stepper(s1, 'Blade rings', () => M().bladeRings, (v) => (M().bladeRings = v), { min: 10, max: 48, integer: true, title: 'Rings along each simple blade leaf' }, onChange).refresh);

  const s2 = section('Junctions', page);
  refreshers.push(stepper(s2, 'Collar rings', () => M().collarRings, (v) => (M().collarRings = v), { min: 0, max: 3, integer: true, title: 'Intermediate edge loops between the window and the first child ring' }, onChange).refresh);
  slider(s2, 'Collar length', () => M().collarScale, (v) => (M().collarScale = v), { min: 0.3, max: 2, step: 0.05, title: 'Distance of the first full child ring from the parent surface, in child radii' }, onChange);

  page.append(
    Object.assign(el('p', 'note'), {
      textContent:
        'The whole plant is a single closed quad surface. Every frond, leaflet, nut and root grows out of a rectangular window cut into its parent’s ring grid; the window loop (2(w+h) vertices) is stitched to the child’s first ring with a collar of quads. Nothing is intersected, stacked or merged — one piece, genus 0. Check the Topology tab for the proof.',
    }),
  );
}

function buildViewPage(): void {
  const page = pages.view;
  page.innerHTML = '';
  viewRefreshers.length = 0;
  const s1 = section('Wind', page);
  viewRefreshers.push(check(s1, 'Enabled', () => view.windEnabled, (v) => (view.windEnabled = v), syncView).refresh);
  viewRefreshers.push(slider(s1, 'Strength', () => view.windStrength, (v) => (view.windStrength = v), { min: 0, max: 3, step: 0.05 }, syncView).refresh);
  viewRefreshers.push(slider(s1, 'Gustiness', () => view.windGust, (v) => (view.windGust = v), { min: 0, max: 1.5, step: 0.05 }, syncView).refresh);
  viewRefreshers.push(slider(s1, 'Direction', () => view.windDirection, (v) => (view.windDirection = v), { min: 0, max: 360, step: 1, unit: '°' }, syncView).refresh);
  viewRefreshers.push(slider(s1, 'Trunk flex', () => view.trunkFlex, (v) => (view.trunkFlex = v), { min: 0, max: 3, step: 0.05 }, syncView).refresh);
  viewRefreshers.push(slider(s1, 'Frond flex', () => view.limbFlex, (v) => (view.limbFlex = v), { min: 0, max: 3, step: 0.05 }, syncView).refresh);
  viewRefreshers.push(slider(s1, 'Detail flutter', () => view.detailFlex, (v) => (view.detailFlex = v), { min: 0, max: 3, step: 0.05 }, syncView).refresh);

  const s2 = section('Display', page);
  viewRefreshers.push(check(s2, 'Quad overlay', () => view.showWire, (v) => (view.showWire = v), syncView).refresh);
  viewRefreshers.push(check(s2, 'Procedural texture', () => view.useTexture, (v) => (view.useTexture = v), syncView).refresh);
  viewRefreshers.push(check(s2, 'Grid', () => view.showGrid, (v) => (view.showGrid = v), syncView).refresh);
  viewRefreshers.push(check(s2, 'Turntable', () => view.autoRotate, (v) => (view.autoRotate = v), syncView).refresh);
  page.append(
    Object.assign(el('p', 'note'), {
      textContent: 'Wind is evaluated in the vertex shader from per-vertex data baked by the generator: normalised height (trunk sway), limb weight + pivot (frond bending) and a detail weight (leaflet flutter). Because every organ shares one welded surface, the deformation is continuous through every junction.',
    }),
  );
}

function setSeed(seed: number): void {
  params.seed = Math.max(0, Math.round(seed));
  for (const r of refreshers) r();
  scheduleGenerate(true);
}

function rebuildPages(): void {
  buildBotanyPage();
  buildRootsPage();
  buildMeshPage();
  buildViewPage();
  buildLibrary();
  inspectorBadge.textContent = `${params.habit === 'branching' ? 'tree' : params.habit} · welded`;
}

function selectPreset(name: string): void {
  const seed = params.seed;
  params = cloneParams(PRESETS.find((p) => p.name === name) ?? PRESETS[0]);
  params.seed = seed;
  frameOnNext = true;
  rebuildPages();
  scheduleGenerate(true);
}

function randomSeed(): void {
  params.seed = Math.floor(Math.random() * 99999) + 1;
  for (const r of refreshers) r();
  scheduleGenerate(true);
}

// -----------------------------------------------------------------------------
// Export
// -----------------------------------------------------------------------------

function requestExport(format: 'obj' | 'glb'): void {
  exportObj.disabled = exportGlb.disabled = true;
  showToast(`Building ${format.toUpperCase()}…`);
  const msg: WorkerRequest = { type: 'export', id: ++reqId, params: cloneParams(params), format };
  worker.postMessage(msg);
}
exportObj.addEventListener('click', () => requestExport('obj'));
exportGlb.addEventListener('click', () => requestExport('glb'));

function download(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 5000);
}

let toastTimer = 0;
function showToast(text: string, ms = 1800): void {
  toast.textContent = text;
  toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), ms);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

// -----------------------------------------------------------------------------
// Boot
// -----------------------------------------------------------------------------

rebuildPages();
syncView();
generate();

// -----------------------------------------------------------------------------
// Command line (Inspector footer)
// -----------------------------------------------------------------------------

function runCommand(line: string): void {
  const [verb, ...rest] = line.trim().split(/\s+/);
  const arg = rest.join(' ');
  const v = verb.toLowerCase();
  if (!v) return;
  if (v === 'seed') {
    const n = parseInt(arg, 10);
    if (Number.isNaN(n)) randomSeed();
    else setSeed(n);
  } else if (v === 'preset' || v === 'species') {
    const q = arg.toLowerCase();
    const hit = PRESETS.find((p) => p.name.toLowerCase() === q) ?? PRESETS.find((p) => p.name.toLowerCase().includes(q));
    if (hit) selectPreset(hit.name);
    else showToast(`No species matches “${arg}”`);
  } else if (v === 'mode') {
    const hit = MODES.find((m) => m.id === arg.toLowerCase() || m.label.toLowerCase() === arg.toLowerCase());
    if (hit) {
      view.mode = hit.id;
      syncView();
    } else showToast('Modes: ' + MODES.map((m) => m.id).join(' · '));
  } else if (v === 'export') {
    const f = arg.toLowerCase();
    if (f === 'obj' || f === 'glb') requestExport(f);
    else showToast('export obj | export glb');
  } else if (v === 'frame') {
    if (arg === 'base') viewer.frameBase(baseReach());
    else viewer.frame();
  } else if (v === 'wind') {
    view.windEnabled = arg ? arg === 'on' : !view.windEnabled;
    syncView();
  } else if (v === 'texture') {
    view.useTexture = arg ? arg === 'on' : !view.useTexture;
    syncView();
  } else if (v === 'quads' || v === 'wire') {
    view.showWire = arg ? arg === 'on' : !view.showWire;
    syncView();
  } else if (v === 'shot' || v === 'screenshot') {
    download(viewer.screenshot(), `${slug(params.name)}_${params.seed}.png`);
  } else if (v === 'help' || v === '?') {
    showToast('seed [n] · preset <name> · mode <shaded|matcap|wireframe|levels|junctions|wind> · export obj|glb · frame [base] · wind|texture|quads [on|off] · shot', 5000);
  } else {
    showToast(`Unknown command “${verb}” · type help`);
  }
}
cmdInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    runCommand(cmdInput.value);
    cmdInput.value = '';
  } else if (e.key === 'Escape') {
    cmdInput.value = '';
    cmdInput.blur();
  }
  e.stopPropagation();
});

// Expose for debugging / automation.
(window as unknown as { frontier: unknown }).frontier = {
  get params() {
    return params;
  },
  get result() {
    return lastResult;
  },
  view,
  viewer,
  setPreset(name: string) {
    params = cloneParams(PRESETS.find((p) => p.name === name) ?? PRESETS[0]);
    frameOnNext = true;
    rebuildPages();
    scheduleGenerate(true);
  },
  setSeed(seed: number) {
    params.seed = seed;
    scheduleGenerate(true);
  },
  setParams(partial: { botany?: Partial<PlantParams['botany']>; mesh?: Partial<PlantParams['mesh']>; roots?: Partial<PlantParams['roots']>; seed?: number; name?: string }) {
    if (partial.botany) Object.assign(params.botany, partial.botany);
    if (partial.mesh) Object.assign(params.mesh, partial.mesh);
    if (partial.roots) Object.assign(params.roots, partial.roots);
    if (partial.seed !== undefined) params.seed = partial.seed;
    if (partial.name) params.name = partial.name;
    rebuildPages();
    scheduleGenerate(true);
  },
  setMode(mode: DisplayMode) {
    view.mode = mode;
    syncView();
  },
  setView(partial: Partial<ViewerSettings>) {
    Object.assign(view, partial);
    syncView();
  },
  regenerate: () => scheduleGenerate(true),
  frame: () => viewer.frame(),
  frameBase: () => viewer.frameBase(baseReach()),
  ready: () => !busy && hasPlant,
  setCamera(pos: [number, number, number], target: [number, number, number]) {
    viewer.camera.position.set(pos[0], pos[1], pos[2]);
    viewer.controls.target.set(target[0], target[1], target[2]);
    viewer.controls.update();
  },
};
