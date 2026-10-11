// Frontier Terrain — application bootstrap and orchestration.
import { GPUContext } from './core/gpu.js';
import { TerrainEngine, THUMB } from './terrain/engine.js';
import { Derived } from './terrain/derived.js';
import { TERRAIN_TYPES, makeTerrainLayer, newId } from './terrain/layer-types.js';
import { TEXTURE_TYPES, makeTextureLayer } from './texture/layer-types.js';
import { TextureCompositor, TEX_THUMB } from './texture/compositor.js';
import { Renderer } from './render/renderer.js';
import { VIEW_MODES } from './render/shaders.js';
import { Store } from './app/store.js';
import { PRESETS, presetById, normalizeProject } from './app/presets.js';
import { StackPanel } from './ui/stack.js';
import { Inspector } from './ui/inspector.js';
import { openConstruct } from './ui/construct.js';
import { h, ic, toast, popMenu, download, clear } from './ui/dom.js';
import { Exporter } from './io/export.js';
import { hexToRgb, clamp } from './core/math.js';
import { SURROUNDS } from './render/renderer.js';

const Q = new URLSearchParams(location.search);
const TEST = Q.get('test') === '1';

class App {
  constructor() {
    this.store = new Store();
    this.thumbs = { terrain: {}, texture: {} };
    this.lastBuild = null;
    this.buildSeq = 0;
    this.lock = Promise.resolve();
    this.building = false;
    this.stale = false;
  }

  async start() {
    try {
      this.gpu = await GPUContext.create();
    } catch (e) {
      return this.fatal('WebGPU is required', 'Frontier Terrain renders and simulates entirely on the GPU through WebGPU. Use a current Chrome, Edge or another WebGPU-enabled browser with hardware acceleration on.', e.message);
    }
    let lastErr = 0;
    this.gpu.onError = (m) => { if (performance.now() - lastErr > 4000) { lastErr = performance.now(); toast('GPU: ' + m.split('\n')[0].slice(0, 140), 'err', 5000); } };
    this.engine = new TerrainEngine(this.gpu);
    this.derived = new Derived(this.gpu);
    this.compositor = new TextureCompositor(this.gpu);
    this.renderer = new Renderer(this.gpu, document.getElementById('view'));
    this.renderer.testMode = TEST;
    this.exporter = new Exporter(this);
    await Promise.all([this.compositor.init(), this.renderer.init()]);
    this.renderer.onFrame = (s) => this._stats(s);
    this.renderer.onSunDrag = () => { if (this.store.sel.tab === 'scene' && this.store.sel.scene === 'sun') this._sunDragRefresh(); this._saveSoon(); };

    // project
    let project = null;
    if (Q.get('preset')) project = presetById(Q.get('preset'));
    else if (Q.get('fresh') !== '1') project = Store.restore();
    if (!project) project = presetById('alpine');
    project = normalizeProject(project);
    if (TEST) project.build.res = +(Q.get('res') || 256);
    else if (Q.get('res')) project.build.res = +Q.get('res');
    project.build.res = Math.min(project.build.res, this.gpu.maxResolution());

    this._layout();
    this.stack = new StackPanel(document.getElementById('stack'), this);
    this.inspector = new Inspector(document.getElementById('inspector'), this);
    this._topbar();
    this._viewportUI();
    this._keys();
    this.store.on((kind, info) => this._onChange(kind, info));
    this.store.load(project);
    if (Q.get('tab')) this.selectTab(Q.get('tab'));
    if (Q.get('scene')) this.selectScene(Q.get('scene'));
    if (Q.get('view')) { this.p.scene.view.mode = +Q.get('view'); this._syncViewChips(); }
    window.__app = this;
  }

  fatal(title, msg, detail) {
    document.body.append(h('div.fatal', h('div.box', h('h1', title), h('p', msg), detail ? h('code', detail) : null)));
    window.__done = true;
  }

  _layout() {
    const side = document.getElementById('side');
    const mq = window.matchMedia('(max-width: 1499px)');
    const apply = () => side.classList.toggle('narrow', mq.matches);
    mq.addEventListener('change', apply); apply();
  }

  // ───────────────────────── selection & editing ─────────────────────────
  get p() { return this.store.p; }
  listFor(tab = this.store.sel.tab) { return tab === 'terrain' ? this.p.terrain.layers : this.p.texture.layers; }
  selected() { const s = this.store.sel; return s.tab === 'scene' ? null : this.listFor().find(l => l.id === s[s.tab]) || null; }

  selectTab(tab) { this.store.sel.tab = tab; this.stack.render(); this.inspector.render(); this._syncMaskView(); }
  select(id) {
    const s = this.store.sel;
    if (s[s.tab] === id) return;
    s[s.tab] = id;
    this.stack.render(); this.inspector.render();
    if (s.tab === 'texture') this._recomposite(false);
  }
  selectScene(key) { this.store.sel.scene = key; this.stack.render(); this.inspector.render(); }

  openConstruct() {
    const tab = this.store.sel.tab;
    if (tab === 'scene') return;
    openConstruct(tab, (type) => this.addLayer(type));
  }
  addLayer(type) {
    const tab = this.store.sel.tab;
    const list = this.listFor(tab);
    const layer = tab === 'terrain' ? makeTerrainLayer(type) : makeTextureLayer(type);
    if (tab === 'terrain' && layer.params.seed !== undefined) layer.params.seed = Math.floor(Math.random() * 9999);
    const cur = list.findIndex(l => l.id === this.store.sel[tab]);
    list.splice(cur >= 0 ? cur + 1 : list.length, 0, layer);
    this.store.sel[tab] = layer.id;
    this.store.commit(tab, { id: layer.id, structural: true });
    this.stack.render(); this.inspector.render();
    toast(`Added ${layer.name}`, 'ok', 1600);
  }
  duplicate(id) {
    const tab = this.store.sel.tab;
    const list = this.listFor(tab);
    const i = list.findIndex(l => l.id === id);
    if (i < 0) return;
    const copy = structuredClone(list[i]);
    copy.id = newId(tab === 'terrain' ? 't' : 'm');
    copy.name = list[i].name + ' copy';
    list.splice(i + 1, 0, copy);
    this.store.sel[tab] = copy.id;
    this.store.commit(tab, { structural: true });
    this.stack.render(); this.inspector.render();
  }
  remove(id) {
    const tab = this.store.sel.tab;
    const list = this.listFor(tab);
    const i = list.findIndex(l => l.id === id);
    if (i < 0) return;
    const [gone] = list.splice(i, 1);
    this.store.sel[tab] = list.length ? list[Math.min(i, list.length - 1)].id : null;
    this.store.commit(tab, { structural: true });
    this.stack.render(); this.inspector.render();
    toast(`Deleted ${gone.name} · Ctrl+Z to undo`, 'info', 2200);
  }
  move(id, dir) {
    const tab = this.store.sel.tab;
    const list = this.listFor(tab);
    const i = list.findIndex(l => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.store.commit(tab, { structural: true });
    this.stack.render();
  }

  // ───────────────────────── change routing ─────────────────────────
  _onChange(kind, info) {
    const r = this.renderer;
    switch (kind) {
      case 'load': {
        r.project = this.p;
        r.setScene(this.p.scene);
        if (this.p.scene.camera) r.camera.fromJSON(this.p.scene.camera);
        this.thumbs = { terrain: {}, texture: {} };
        this.nameInput.value = this.p.name;
        this.stack.render(); this.inspector.render();
        this._syncTop();
        this._syncViewChips();
        this._firstFrame = !this.p.scene.camera;
        if (Q.get('cam')) { const c = Q.get('cam').split(',').map(Number); r.camera.pos = c.slice(0, 3); r.camera.yaw = c[3] || 0; r.camera.pitch = c[4] || 0; this._firstFrame = false; }
        this.requestBuild({ preview: false });
        break;
      }
      case 'restore': {
        r.project = this.p;
        r.setScene(this.p.scene);
        this.nameInput.value = this.p.name;
        this.stack.render(); this.inspector.render(); this._syncTop(); this._syncViewChips();
        if (info.terrain) this.requestBuild({ preview: false });
        else if (info.texture) this._recomposite(true);
        r.sunChanged();
        break;
      }
      case 'terrain': {
        if (!this.p.build.auto && !info.structural && info.live) { this._markStale(); break; }
        if (!this.p.build.auto) { this._markStale(); this.stack.render(); break; }
        this.requestBuild({ preview: !!info.live, focusId: info.id });
        if (!info.live) this.stack.render();
        break;
      }
      case 'texture': {
        this._recomposite(!info.live);
        if (!info.live) this.stack.render();
        break;
      }
      case 'scene': case 'camera': {
        if (kind === 'camera') r.camera.fov = this.p.scene.camera?.fov ?? r.camera.fov;
        if (info.sun) r.sunChanged(); else r.requestFrame();
        if (!info.live) this._syncViewChips();
        r.resize();
        break;
      }
      case 'meta': { this.stack.render(); this._syncTop(); break; }
      case 'saved': { this._status(); break; }
    }
    this._syncUndo();
  }

  _markStale() { this.stale = true; this.buildBtn.classList.add('stale'); this._status(); }

  // ───────────────────────── build pipeline ─────────────────────────
  requestBuild({ preview = false, focusId = null } = {}) {
    const seq = ++this.buildSeq;
    const full = this.p.build.res;
    let res = full;
    const enabled = this.p.terrain.layers.filter(l => l.enabled);
    const focusIndex = focusId ? enabled.findIndex(l => l.id === focusId) : -1;
    if (preview && full > 512) {
      // stay at full resolution when everything below the edited layer is cached at full resolution
      const lastSim = enabled.reduce((a, l, i) => (TERRAIN_TYPES[l.type]?.kind === 'sim' && (focusIndex < 0 || i < focusIndex) ? i : a), -1);
      const cached = this.engine.cache && this.engine.cache.N === full && focusIndex > lastSim;
      const cheap = !enabled.some((l, i) => TERRAIN_TYPES[l.type]?.kind === 'sim' && i >= Math.max(0, focusIndex));
      res = cached && cheap ? full : 512;
    }
    if (this.building) this.engine.abort?.abort();
    this.lock = this.lock.then(() => this._build(seq, res, preview, focusIndex)).catch((e) => { console.error(e); toast(e.message, 'err', 5000); });
    return this.lock;
  }
  async _build(seq, res, preview, focusIndex) {
    if (seq !== this.buildSeq) return;
    this.building = true;
    this._status();
    const t0 = performance.now();
    const project = this.p;
    const r = await this.engine.build(project, {
      res, focusIndex: focusIndex >= 0 ? focusIndex : undefined,
      onProgress: (pr) => { if (seq === this.buildSeq) this._progress(pr.fraction, pr.label); },
      onError: (e) => toast(e.message.split('\n')[0], 'err', 6000),
    });
    if (!r || seq !== this.buildSeq) { this.building = seq === this.buildSeq ? false : this.building; if (!r && seq === this.buildSeq) { this._progress(-1); this._status(); } return; }
    await this.derived.compute(this.engine, r, project.world);
    if (seq !== this.buildSeq && preview) { this.building = false; return; }
    for (const [k, v] of Object.entries(r.thumbs || {})) this.thumbs.terrain[k] = v;
    this.lastBuild = { N: r.N, stats: r.stats, ms: performance.now() - t0, preview };
    this.compositor.run(project.texture.layers, this.derived, this._maskLayerId());
    this.renderer.project = project;
    this.renderer.setTerrain(this.derived);
    this.renderer.setCompositor(this.compositor);
    if (this._firstFrame) { this._firstFrame = false; this.renderer.camera.frame(); }
    this.building = false;
    this.stale = preview;
    this.buildBtn.classList.toggle('stale', false);
    this._progress(-1);
    this._status();
    this.refreshThumbs();
    this.stack.render();
    if (this.store.sel.tab === 'scene' && this.store.sel.scene === 'world') this.inspector.render();
    if (!preview) {
      this._texThumbs();
      window.__built = (window.__built || 0) + 1;
      setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => { window.__done = true; })), 300);
    } else if (seq === this.buildSeq && this.p.build.auto) {
      // settle at full resolution once the user stops dragging
      clearTimeout(this._settleT);
      this._settleT = setTimeout(() => { if (seq === this.buildSeq) this.requestBuild({ preview: false }); }, 450);
    }
  }
  async _texThumbs() {
    const t = await this.compositor.thumbnails(this.p.texture.layers, this.derived);
    this.thumbs.texture = t;
    this.refreshThumbs();
  }
  _maskLayerId() { return this.store.sel.texture; }
  _syncMaskView() { if (this.p.scene.view.mode === 12) this._recomposite(false); }
  _recomposite(withThumbs) {
    if (!this.derived.tex) return;
    cancelAnimationFrame(this._compRaf);
    this._compRaf = requestAnimationFrame(() => {
      this.compositor.run(this.p.texture.layers, this.derived, this._maskLayerId());
      this.renderer.setCompositor(this.compositor);
      if (withThumbs) this._texThumbs();
    });
  }

  // ───────────────────────── thumbnails ─────────────────────────
  thumbCanvas(layer, kind, size = 96) {
    const c = document.createElement('canvas');
    c.width = c.height = kind === 'texture' ? TEX_THUMB : THUMB;
    c.dataset.kind = kind;
    c.dataset.id = layer?.id || '';
    c.style.width = '100%'; c.style.height = '100%';
    this.drawThumb(c);
    return c;
  }
  _finalHeightThumb() {
    const en = this.p.terrain.layers.filter(l => l.enabled);
    for (let i = en.length - 1; i >= 0; i--) if (this.thumbs.terrain[en[i].id]) return this.thumbs.terrain[en[i].id];
    return null;
  }
  drawThumb(c) {
    const kind = c.dataset.kind, id = c.dataset.id;
    const ctx = c.getContext('2d');
    const T = c.width;
    const img = ctx.createImageData(T, T);
    const W = this.p.world.size, hs = this.p.world.height;
    let hdata = kind === 'terrain' ? this.thumbs.terrain[id] : this._finalHeightThumb();
    if (!hdata) { ctx.fillStyle = '#141414'; ctx.fillRect(0, 0, T, T); return; }
    const N = Math.round(Math.sqrt(hdata.length));
    const cell = W / N;
    let lo = 1e9, hi = -1e9;
    for (const v of hdata) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const layer = kind === 'texture' ? this.p.texture.layers.find(l => l.id === id) : null;
    const mask = kind === 'texture' ? this.thumbs.texture[id] : null;
    const col = layer ? hexToRgb(layer.params.colorA) : null;
    const sea = this.p.world.seaOn ? this.p.world.seaLevel / hs : -1e9;
    const L = [-0.55, 0.62, -0.56];
    const ll = Math.hypot(...L);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const sx = Math.min(N - 1, Math.floor(x * N / T)), sy = Math.min(N - 1, Math.floor(y * N / T));
      const at = (xx, yy) => hdata[clamp(yy, 0, N - 1) * N + clamp(xx, 0, N - 1)];
      const v = at(sx, sy);
      const dx = (at(sx + 1, sy) - at(sx - 1, sy)) * hs / (2 * cell);
      const dz = (at(sx, sy + 1) - at(sx, sy - 1)) * hs / (2 * cell);
      const n = [-dx * 1.6, 1, -dz * 1.6]; const nl = Math.hypot(...n);
      const d = Math.max(0, (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / nl / ll);
      const e = (v - lo) / (hi - lo + 1e-9);
      let r, g, b;
      if (kind === 'texture') {
        const m = mask ? mask[Math.min(TEX_THUMB - 1, Math.floor(y * TEX_THUMB / T)) * TEX_THUMB + Math.min(TEX_THUMB - 1, Math.floor(x * TEX_THUMB / T))] : 0;
        const s = 0.35 + 0.75 * d;
        const base = 24 + 30 * d;
        r = base + (col[0] * 255 * s - base) * m; g = base + (col[1] * 255 * s - base) * m; b = base + (col[2] * 255 * s - base) * m;
      } else {
        const s = 0.25 + 0.85 * d;
        r = (120 + 90 * e) * s; g = (112 + 82 * e) * s; b = (100 + 80 * e) * s;
        if (v < sea) { r = r * 0.35 + 20; g = g * 0.45 + 50; b = b * 0.5 + 70; }
      }
      const o = (y * T + x) * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  refreshThumbs() { document.querySelectorAll('canvas[data-kind]').forEach(c => this.drawThumb(c)); }

  // ───────────────────────── top bar ─────────────────────────
  _topbar() {
    const bar = document.getElementById('topbar');
    this.nameInput = h('input.name', { spellcheck: false, value: '' });
    this.nameInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.nameInput.blur(); });
    this.nameInput.addEventListener('change', () => { this.p.name = this.nameInput.value.trim() || 'Untitled terrain'; this.store.commit('meta'); });
    const presetsBtn = h('button.tbtn', ic('folder-open', 14), 'Projects', ic('chevron-down', 12));
    presetsBtn.addEventListener('click', () => popMenu(presetsBtn, [
      { group: 'Start from a preset' },
      ...PRESETS.map(p => ({ label: p.label, icon: p.icon, right: '', action: () => { this.store.load(normalizeProject(p.make())); toast(`Loaded ${p.label}`, 'ok'); } })),
      { sep: true },
      { label: 'Open project…', icon: 'file-up', right: 'Ctrl O', action: () => this.exporter.openProject() },
      { label: 'Save project', icon: 'save', right: 'Ctrl S', action: () => this.exporter.saveProject() },
    ]));
    this.undoBtn = h('button.tbtn.icon', { title: 'Undo (Ctrl+Z)' }, ic('undo-2', 15));
    this.redoBtn = h('button.tbtn.icon', { title: 'Redo (Ctrl+Shift+Z)' }, ic('redo-2', 15));
    this.undoBtn.addEventListener('click', () => this.store.undo());
    this.redoBtn.addEventListener('click', () => this.store.redo());
    this.resSeg = h('div.seg', { title: 'Build resolution' });
    const maxRes = this.gpu.maxResolution();
    for (const [v, l] of [[512, '512'], [1024, '1K'], [2048, '2K'], [4096, '4K']]) {
      if (v > maxRes) continue;
      const b = h('button', { 'data-res': v }, l);
      b.addEventListener('click', () => { if (this.p.build.res === v) return; this.p.build.res = v; this._syncTop(); this.store.commit('terrain', { structural: true }); });
      this.resSeg.append(b);
    }
    this.autoBtn = h('button.tbtn', { title: 'Rebuild automatically after every change' }, ic('refresh-cw', 13), 'Auto');
    this.autoBtn.addEventListener('click', () => { this.p.build.auto = !this.p.build.auto; this._syncTop(); this.store.commit('meta'); if (this.p.build.auto && this.stale) this.requestBuild(); });
    this.buildBtn = h('button.tbtn.primary', { title: 'Build (Ctrl+B)' }, ic('play', 13), 'Build');
    this.buildBtn.addEventListener('click', () => this.requestBuild({ preview: false }));
    const exportBtn = h('button.tbtn', ic('download', 14), 'Export', ic('chevron-down', 12));
    exportBtn.addEventListener('click', () => popMenu(exportBtn, this.exporter.menu(), { alignRight: true }));
    this.statusEl = h('div.status', h('span.dot'), h('span.t', 'Starting…'));
    this.progressEl = h('div.progress');
    bar.append(
      h('div.brand', h('span.word', 'frontier', h('i', '.')), h('span.tag', 'TERRAIN / 01')),
      h('div.crumbs', h('div.path', 'Projects', ic('chevron-right', 10), 'Terrain'), this.nameInput),
      h('div.top-spacer'),
      h('div.top-group', presetsBtn),
      h('div.top-group', this.undoBtn, this.redoBtn),
      this.resSeg,
      h('div.top-group', this.autoBtn, this.buildBtn, exportBtn),
      this.statusEl, this.progressEl);
  }
  _syncTop() {
    if (!this.p) return;
    this.resSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.res === this.p.build.res));
    this.autoBtn.classList.toggle('primary', false);
    this.autoBtn.style.color = this.p.build.auto ? '#e9e9e9' : '#7d7d7d';
    this.autoBtn.querySelector('svg').style.color = this.p.build.auto ? 'var(--on)' : '#777';
    if (this.nameInput !== document.activeElement) this.nameInput.value = this.p.name;
  }
  _syncUndo() {
    this.undoBtn.disabled = !this.store.canUndo();
    this.redoBtn.disabled = !this.store.canRedo();
  }
  _progress(f, label) {
    const el = this.progressEl;
    if (f < 0) { el.classList.remove('on'); setTimeout(() => { if (!this.building) el.style.width = '0'; }, 400); return; }
    el.classList.add('on');
    el.style.width = (Math.max(0.02, f) * 100).toFixed(1) + '%';
    this._progLabel = label;
    this._status();
  }
  _status() {
    const el = this.statusEl;
    const t = el.querySelector('.t');
    el.classList.toggle('busy', this.building);
    if (this.building) t.textContent = `Building · ${this._progLabel || 'terrain'}`;
    else if (this.stale && !this.p.build.auto) t.textContent = 'Changes not built';
    else if (this.lastBuild) t.textContent = `All changes saved · ${this.lastBuild.N}²`;
    else t.textContent = 'Ready';
  }

  // ───────────────────────── viewport overlays ─────────────────────────
  _viewportUI() {
    const vp = document.getElementById('viewport');
    this.viewChip = h('button.chip', ic('sun', 13), h('span.l', 'Lit'), ic('chevron-down', 11));
    this.viewChip.addEventListener('click', () => popMenu(this.viewChip, [
      { group: 'View mode' },
      ...VIEW_MODES.map(m => ({ label: m.label, icon: m.icon, on: this.p.scene.view.mode === m.id, right: m.id === 0 ? 'Default' : '', action: () => { this.p.scene.view.mode = m.id; this.store.commit('scene'); this._syncViewChips(); if (m.id === 12) this._recomposite(false); } })),
    ]));
    this.surChip = h('button.chip', ic('globe', 13), h('span.l', 'Mirror'), ic('chevron-down', 11));
    this.surChip.addEventListener('click', () => popMenu(this.surChip, [
      { group: 'Surroundings' },
      ...SURROUNDS.map((s, i) => ({ label: s, icon: ['box', 'copy', 'waves'][i], on: this.p.scene.surround === i, action: () => { this.p.scene.surround = i; this.store.commit('scene'); this._syncViewChips(); } })),
    ]));
    this.contChip = h('button.chip', { title: 'Contour lines' }, ic('spline', 13), 'Contours');
    this.contChip.addEventListener('click', () => { this.p.scene.view.contours = !this.p.scene.view.contours; this.store.commit('scene'); this._syncViewChips(); });
    const shot = h('button.chip', { title: 'Save a screenshot (P)' }, ic('camera', 13), 'Shot');
    shot.addEventListener('click', () => this.exporter.screenshot());
    const frame = h('button.chip', { title: 'Frame the terrain (F)' }, ic('scan', 13), 'Frame');
    frame.addEventListener('click', () => this.renderer.camera.frame());
    this.statBox = h('div.stat', '');
    this.altBox = h('div.stat', '');
    this.help = h('div.vp-help', h('b', 'RMB'), ' look · ', h('b', 'WASD/QE'), ' fly · ', h('b', 'Shift'), ' boost', h('br'), h('b', 'Wheel'), ' dolly · ', h('b', 'MMB'), ' pan · ', h('b', 'Alt+LMB'), ' orbit · ', h('b', 'L+LMB'), ' sun · ', h('b', 'F'), ' frame');
    this.compass = h('div.compass', h('div.n'), h('div.s'));
    vp.append(h('div.vp-top', this.viewChip, this.surChip, this.contChip, frame, shot), this.compass, h('div.vp-bottom', this.statBox, this.altBox), this.help);
    let helpT = setTimeout(() => { this.help.style.opacity = '0.0'; }, 12000);
    vp.addEventListener('pointerenter', () => { clearTimeout(helpT); this.help.style.opacity = '1'; helpT = setTimeout(() => { this.help.style.opacity = '0'; }, 6000); });
    this.renderer.camera.onChange = () => { this.renderer.requestFrame(); this._saveCamSoon(); };
  }
  _syncViewChips() {
    const v = this.p.scene.view;
    const m = VIEW_MODES.find(x => x.id === v.mode) || VIEW_MODES[0];
    this.viewChip.querySelector('.l').textContent = m.label;
    this.viewChip.classList.toggle('on', v.mode !== 0);
    this.surChip.querySelector('.l').textContent = SURROUNDS[this.p.scene.surround];
    this.contChip.classList.toggle('on', !!v.contours);
  }
  _stats(s) {
    const cam = this.renderer.camera;
    const now = performance.now();
    this._fps = this._fps || [];
    this._fps.push(now);
    while (this._fps.length && now - this._fps[0] > 1000) this._fps.shift();
    this.statBox.textContent = `${s.instances} patches${s.water ? ' · ' + s.water + ' water' : ''} · ${s.ms.toFixed(1)} ms cpu`;
    const alt = cam.altitude();
    this.altBox.textContent = `alt ${Math.round(cam.pos[1])} m · ${alt > 0 ? Math.round(alt) : 0} m AGL · ${Math.round(cam.baseSpeed())} m/s`;
    const sun = this.p.scene.sky;
    this.compass.querySelector('.n').style.transform = `rotate(${-cam.yaw * 180 / Math.PI}deg)`;
    const a = (sun.sunAzimuth * Math.PI / 180) - cam.yaw;
    const rr = 15 * Math.cos(Math.max(0, sun.sunElevation) * Math.PI / 180);
    this.compass.querySelector('.s').style.transform = `translate(${Math.sin(a) * rr}px, ${-Math.cos(a) * rr}px)`;
  }
  _saveCamSoon() {
    clearTimeout(this._camT);
    this._camT = setTimeout(() => { if (!this.p) return; this.p.scene.camera = this.renderer.camera.toJSON(); this.store.save(); }, 700);
  }
  _saveSoon() { clearTimeout(this._sT); this._sT = setTimeout(() => this.store.commit('scene', { live: false }), 500); }
  _sunDragRefresh() { clearTimeout(this._sunT); this._sunT = setTimeout(() => this.inspector.render(), 120); }

  // ───────────────────────── keyboard ─────────────────────────
  _keys() {
    window.addEventListener('keydown', (e) => {
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable || a.tagName === 'SELECT')) return;
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? this.store.redo() : this.store.undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); this.store.redo(); return; }
      if (mod && k === 's') { e.preventDefault(); this.exporter.saveProject(); return; }
      if (mod && k === 'o') { e.preventDefault(); this.exporter.openProject(); return; }
      if (mod && k === 'b') { e.preventDefault(); this.requestBuild({ preview: false }); return; }
      if (mod && k === 'd') { e.preventDefault(); const s = this.selected(); if (s) this.duplicate(s.id); return; }
      if (e.shiftKey && k === 'a') { e.preventDefault(); this.openConstruct(); return; }
      if ((k === 'delete' || k === 'backspace') && !mod) { const s = this.selected(); if (s) { e.preventDefault(); this.remove(s.id); } return; }
      if (!mod && !e.altKey && this.renderer.camera.buttons === 0 && !this.renderer.camera.hover) {
        if (k === '1') this.selectTab('terrain');
        if (k === '2') this.selectTab('texture');
        if (k === '3') this.selectTab('scene');
      }
      if (!mod && k === 'p') this.exporter.screenshot();
    });
  }
}

const app = new App();
app.start().catch((e) => { console.error(e); app.fatal('Something went wrong', 'Frontier Terrain failed to start.', e.stack || e.message); });
export { clear };
