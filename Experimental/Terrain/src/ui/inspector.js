// Schema-driven inspector (right column). Mirrors the Frontier editor: eyebrow, large title, Reset, Enabled pill,
// PROPERTIES switch tiles, then property cards with a hero metric and slider rows.
import { h, ic, clear } from './dom.js';
import { sliderRow, enumRow, toggleRow, colorRow, xyPad, dialRow, curveEditor, seedRow, rangeRow, metricParts, fmt, selectCtl } from './controls.js';
import { TERRAIN_TYPES, BLEND_MODES, MASK_MODES, defaultParams } from '../terrain/layer-types.js';
import { TEXTURE_TYPES, TEXTURE_SCHEMA, TEX_BLEND, RULES, textureDefaults } from '../texture/layer-types.js';
import { SURROUNDS, TONEMAPS, SCENE_DEFAULTS } from '../render/renderer.js';
import { VIEW_MODES } from '../render/shaders.js';

export const SCENE_ITEMS = [
  { key: 'sun', label: 'Sun', icon: 'sun', color: '#e8b65f', sub: 'Direction, intensity and colour' },
  { key: 'atmosphere', label: 'Atmosphere', icon: 'cloud-sun', color: '#99aafa', sub: 'Air, haze and valley fog' },
  { key: 'water', label: 'Water', icon: 'droplets', color: '#74bdd4', sub: 'Sea level, lakes and rivers' },
  { key: 'world', label: 'World', icon: 'globe', color: '#d6a078', sub: 'Size, height and resolution' },
  { key: 'view', label: 'Viewport', icon: 'monitor', color: '#bb9ae4', sub: 'Surroundings, detail and overlays' },
  { key: 'post', label: 'Camera & grade', icon: 'aperture', color: '#c5a6d7', sub: 'Exposure, tonemapping and bloom' },
];

// Scene schemas: each param says which object it edits and what must update.
const sky = (p) => p.scene.sky, wtr = (p) => p.scene.water, wld = (p) => p.world, view = (p) => p.scene.view, bld = (p) => p.build, scn = (p) => p.scene;
const SCENE_SCHEMAS = {
  sun: {
    eyebrow: 'Scene · Light', blurb: 'Hold L and drag in the viewport to move the sun.',
    cards: [{ id: 'Direction', icon: 'compass', metric: ['sunElevation', sky] }, { id: 'Light', icon: 'sun', metric: ['sunIntensity', sky] }],
    params: [
      { key: 'sunAzimuth', obj: sky, label: 'Azimuth', type: 'float', min: 0, max: 360, step: 1, unit: '°', ui: 'dial', card: 'Direction', kind: 'sun' },
      { key: 'sunElevation', obj: sky, label: 'Elevation', type: 'float', min: -8, max: 89, step: 0.1, unit: '°', card: 'Direction', kind: 'sun' },
      { key: 'sunIntensity', obj: sky, label: 'Intensity', type: 'float', min: 0.05, max: 4, step: 0.01, unit: '×', card: 'Light', kind: 'scene' },
      { key: 'sunSize', obj: sky, label: 'Disk size', type: 'float', min: 0.2, max: 4, step: 0.01, unit: '°', card: 'Light', kind: 'scene' },
      { key: 'sunTint', obj: sky, label: 'Tint', type: 'color', card: 'Light', kind: 'scene' },
    ],
  },
  atmosphere: {
    eyebrow: 'Scene · Atmosphere', blurb: 'Rayleigh & Mie scattering with aerial perspective (Hillaire 2020).',
    switches: [{ key: 'ozone', obj: sky, label: 'Ozone layer', icon: 'circle' }],
    cards: [{ id: 'Air', icon: 'wind', metric: ['haze', sky] }, { id: 'Valley fog', icon: 'cloud-fog', metric: ['fogDensity', sky] }],
    params: [
      { key: 'haze', obj: sky, label: 'Haze (Mie)', type: 'float', min: 0, max: 12, step: 0.05, unit: '×', card: 'Air', kind: 'scene' },
      { key: 'hazeAnisotropy', obj: sky, label: 'Haze forward scatter', type: 'float', min: 0, max: 0.95, step: 0.01, card: 'Air', kind: 'scene' },
      { key: 'airDensity', obj: sky, label: 'Air density (Rayleigh)', type: 'float', min: 0.1, max: 4, step: 0.01, unit: '×', card: 'Air', kind: 'scene' },
      { key: 'baseAltitude', obj: sky, label: 'Base altitude', type: 'float', min: 0, max: 5000, step: 10, unit: 'm', card: 'Air', kind: 'scene' },
      { key: 'fogDensity', obj: sky, label: 'Density', type: 'float', min: 0, max: 2, step: 0.005, card: 'Valley fog', kind: 'scene' },
      { key: 'fogHeight', obj: sky, label: 'Height falloff', type: 'float', min: 10, max: 2000, step: 5, unit: 'm', card: 'Valley fog', kind: 'scene' },
      { key: 'fogColor', obj: sky, label: 'Colour', type: 'color', card: 'Valley fog', kind: 'scene' },
    ],
  },
  water: {
    eyebrow: 'Scene · Water', blurb: 'Analytic water: refraction, absorption, scattering and sky reflection.',
    switches: [{ key: 'seaOn', obj: wld, label: 'Sea', icon: 'waves', kind: 'terrain' }, { key: 'animate', obj: wtr, label: 'Animate', icon: 'play' }],
    cards: [{ id: 'Sea', icon: 'waves', metric: ['seaLevel', wld], switch: 'seaOn' }, { id: 'Optics', icon: 'droplets', metric: ['clarity', wtr] }, { id: 'Surface', icon: 'wind' }],
    params: [
      { key: 'seaLevel', obj: wld, label: 'Sea level', type: 'float', min: -500, max: 3000, step: 1, unit: 'm', card: 'Sea', kind: 'terrain' },
      { key: 'color', obj: wtr, label: 'Water colour', type: 'color', card: 'Optics', kind: 'scene' },
      { key: 'clarity', obj: wtr, label: 'Clarity', type: 'float', min: 0.5, max: 40, step: 0.1, unit: 'm', card: 'Optics', kind: 'scene' },
      { key: 'turbidity', obj: wtr, label: 'Turbidity', type: 'float', min: 0, max: 1, step: 0.01, unit: '%', card: 'Optics', kind: 'scene' },
      { key: 'waves', obj: wtr, label: 'Wave strength', type: 'float', min: 0, max: 2, step: 0.01, unit: '×', card: 'Surface', kind: 'scene' },
      { key: 'windBearing', obj: wtr, label: 'Wind bearing', type: 'float', min: 0, max: 360, step: 1, unit: '°', ui: 'dial', card: 'Surface', kind: 'scene' },
    ],
  },
  world: {
    eyebrow: 'Scene · World', blurb: 'Physical extent of the terrain. Changing these rebuilds the stack.',
    switches: [{ key: 'auto', obj: bld, label: 'Auto build', icon: 'refresh-cw', kind: 'meta' }],
    cards: [{ id: 'Extent', icon: 'globe', metric: ['size', wld] }, { id: 'Build', icon: 'grid-3x3' }],
    params: [
      { key: 'size', obj: wld, label: 'Width', type: 'float', min: 1024, max: 32768, step: 64, unit: 'm', card: 'Extent', kind: 'terrain', curve: 'log' },
      { key: 'height', obj: wld, label: 'Height range', type: 'float', min: 100, max: 8000, step: 10, unit: 'm', card: 'Extent', kind: 'terrain' },
      { key: 'res', obj: bld, label: 'Resolution', type: 'enum', options: ['512²', '1024²', '2048²', '4096²'], values: [512, 1024, 2048, 4096], card: 'Build', kind: 'terrain' },
    ],
  },
  view: {
    eyebrow: 'Scene · Viewport', blurb: 'How the terrain is presented. Does not change the terrain itself.',
    switches: [{ key: 'detail', obj: view, label: 'Surface detail', icon: 'sparkles' }, { key: 'contours', obj: view, label: 'Contours', icon: 'spline' }, { key: 'grid', obj: view, label: 'Grid', icon: 'grid-3x3' }],
    cards: [{ id: 'Presentation', icon: 'monitor' }, { id: 'Detail', icon: 'sparkles', switch: 'detail' }, { id: 'Overlays', icon: 'spline' }],
    params: [
      { key: 'surround', obj: scn, label: 'Surroundings', type: 'enum', options: SURROUNDS, card: 'Presentation', kind: 'scene' },
      { key: 'mode', obj: view, label: 'View mode', type: 'enum', options: VIEW_MODES.map(v => v.label), values: VIEW_MODES.map(v => v.id), card: 'Presentation', kind: 'scene' },
      { key: 'quality', obj: view, label: 'Render quality', type: 'enum', options: ['Fast', 'High', 'Ultra'], card: 'Presentation', kind: 'scene' },
      { key: 'detailStrength', obj: view, label: 'Detail strength', type: 'float', min: 0, max: 2, step: 0.01, unit: '×', card: 'Detail', kind: 'scene' },
      { key: 'displacement', obj: view, label: 'Close-range displacement', type: 'float', min: 0, max: 2, step: 0.01, unit: '×', card: 'Detail', kind: 'scene' },
      { key: 'contourInterval', obj: view, label: 'Contour interval', type: 'float', min: 1, max: 500, step: 1, unit: 'm', card: 'Overlays', kind: 'scene' },
      { key: 'gridSpacing', obj: view, label: 'Grid spacing', type: 'float', min: 10, max: 4000, step: 10, unit: 'm', card: 'Overlays', kind: 'scene', curve: 'log' },
    ],
  },
  post: {
    eyebrow: 'Scene · Camera', blurb: 'Exposure and display transform applied to the HDR image.',
    switches: [{ key: 'autoExposure', obj: sky, label: 'Auto exposure', icon: 'aperture' }],
    cards: [{ id: 'Exposure', icon: 'aperture', metric: ['exposure', sky] }, { id: 'Grade', icon: 'palette' }, { id: 'Lens', icon: 'focus' }],
    params: [
      { key: 'exposure', obj: sky, label: 'Exposure compensation', type: 'float', min: -6, max: 6, step: 0.05, unit: 'EV', card: 'Exposure', kind: 'scene' },
      { key: 'tonemap', obj: sky, label: 'Display transform', type: 'enum', options: TONEMAPS, values: ['agx', 'aces', 'neutral', 'none'], card: 'Exposure', kind: 'scene' },
      { key: 'contrast', obj: sky, label: 'Contrast', type: 'float', min: 0.5, max: 1.6, step: 0.01, unit: '×', card: 'Grade', kind: 'scene' },
      { key: 'saturation', obj: sky, label: 'Saturation', type: 'float', min: 0, max: 1.6, step: 0.01, unit: '×', card: 'Grade', kind: 'scene' },
      { key: 'bloom', obj: sky, label: 'Bloom', type: 'float', min: 0, max: 0.3, step: 0.002, card: 'Lens', kind: 'scene' },
      { key: 'vignette', obj: sky, label: 'Vignette', type: 'float', min: 0, max: 1, step: 0.01, unit: '%', card: 'Lens', kind: 'scene' },
      { key: 'grain', obj: sky, label: 'Film grain', type: 'float', min: 0, max: 1, step: 0.01, unit: '%', card: 'Lens', kind: 'scene' },
      { key: 'fov', obj: (p) => p.scene.camera, label: 'Field of view', type: 'float', min: 15, max: 100, step: 0.5, unit: '°', card: 'Lens', kind: 'camera' },
    ],
  },
};

export class Inspector {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.scroll = h('div.insp-scroll');
    this.foot = h('div.insp-foot', h('span', 'FRONTIER / TERRAIN'), h('span.ver', 'Inspector'));
    root.append(this.scroll, this.foot);
  }
  get store() { return this.app.store; }

  render() {
    const top = this.scroll.scrollTop;
    const keepScroll = this._lastKey === this._key();
    clear(this.scroll);
    const s = this.store.sel;
    if (s.tab === 'scene') this._scene(s.scene);
    else {
      const list = s.tab === 'terrain' ? this.store.p.terrain.layers : this.store.p.texture.layers;
      const layer = list.find(l => l.id === s[s.tab]);
      if (!layer) this._empty(s.tab);
      else if (s.tab === 'terrain') this._terrain(layer);
      else this._texture(layer);
    }
    this._lastKey = this._key();
    if (keepScroll) this.scroll.scrollTop = top;
  }
  _key() { const s = this.store.sel; return s.tab + ':' + (s.tab === 'scene' ? s.scene : s[s.tab]); }

  _empty(tab) {
    this.scroll.append(h('div.insp-head', h('div.eyebrow', tab === 'terrain' ? 'Terrain stack' : 'Texture stack'), h('h1', 'Nothing selected'),
      h('div.blurb', 'Add a layer with the button in the stack, or press Shift + A.')));
  }

  _header({ eyebrow, color, title, blurb, onRename, onReset, enabled, onToggle, crumb }) {
    const h1 = h('h1', { contenteditable: onRename ? 'true' : 'false', spellcheck: false }, title);
    if (onRename) {
      h1.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); h1.blur(); } });
      h1.addEventListener('blur', () => { const t = h1.textContent.trim(); if (t && t !== title) onRename(t); else h1.textContent = title; });
    }
    const acts = h('div.head-acts');
    if (onReset) { const r = h('button.reset', ic('rotate-ccw', 12), 'Reset'); r.addEventListener('click', onReset); acts.append(r); }
    if (onToggle) {
      const pill = h('button.pill' + (enabled ? '' : '.off'), h('span.d'), enabled ? 'Enabled' : 'Disabled');
      pill.addEventListener('click', onToggle);
      acts.append(pill);
    }
    this.scroll.append(
      h('div.insp-crumb', ic('panel-right', 12), 'Inspector', ic('chevron-right', 11), crumb),
      h('div.insp-head', h('div.eyebrow', h('span.sw', { style: { background: color } }), eyebrow), h1, blurb ? h('div.blurb', blurb) : null, acts));
  }

  _tiles(items) {
    if (!items.length) return;
    this.scroll.append(h('div.sec', h('span', 'Properties'), h('span.note', items.length + (items.length === 1 ? ' switch' : ' switches'))));
    const wrap = h('div.tiles');
    for (const it of items) {
      const tile = h('button.tile' + (it.on ? '' : '.off'), h('div.circ', ic(it.icon || 'power', 15)), h('div', h('div.lab', it.label), h('div.st', it.on ? 'On' : 'Off')));
      tile.addEventListener('click', () => it.toggle(!it.on));
      wrap.append(tile);
    }
    this.scroll.append(wrap);
  }

  _card(def, accent, metricEl, bodyEls, disabled, right) {
    const card = h('div.card' + (disabled ? '.disabled' : ''),
      h('div.card-h', ic(def.icon || 'circle', 16, accent), h('span', def.id), right ? h('span.r', right) : null),
      h('div.card-b', metricEl, ...bodyEls));
    return card;
  }
  _metric(v, d, note) {
    const [num, unit] = metricParts(v, d);
    const el = h('div', h('div.metric', h('span.v', num), h('span.u', unit)), note ? h('div.metric-note', note) : null);
    el.update = (nv) => { const [a, b] = metricParts(nv, d); el.querySelector('.v').textContent = a; el.querySelector('.u').textContent = b; };
    return el;
  }

  // ───────────────────────── terrain layer ─────────────────────────
  _terrain(layer) {
    const t = TERRAIN_TYPES[layer.type];
    const app = this.app;
    const live = () => this.store.change('terrain', { id: layer.id });
    const commit = () => this.store.commit('terrain', { id: layer.id });
    this._header({
      eyebrow: `Terrain · ${t.category}`, color: t.color, title: layer.name, blurb: t.blurb, crumb: t.label,
      onRename: (n) => { layer.name = n; this.store.commit('meta'); },
      onReset: () => { layer.params = { ...defaultParams(layer.type), seed: layer.params.seed }; commit(); this.render(); },
      enabled: layer.enabled, onToggle: () => { layer.enabled = !layer.enabled; commit(); this.render(); },
    });
    // preview
    const pv = h('div.preview-big', app.thumbCanvas(layer, 'terrain', 240));
    this.scroll.append(pv);
    const sw = (t.switches || []).map(s => ({ label: s.label, icon: s.icon, on: !!layer.params[s.key], toggle: (v) => { layer.params[s.key] = v; commit(); this.render(); } }));
    this._tiles(sw);
    this.scroll.append(h('div.sec', h('span', 'Parameters'), h('span.note', t.label)));
    const switchKeys = new Set((t.switches || []).map(s => s.key));
    const metrics = {};
    for (const c of t.cards) {
      const body = [];
      if (c.ui === 'curve') {
        const d = t.params.curve;
        body.push(curveEditor(layer.params.curve || d.default, { accent: t.color, onInput: (pts) => { layer.params.curve = pts; live(); }, onCommit: (pts) => { layer.params.curve = pts; commit(); } }));
        body.push(h('div.hints', h('span', 'Click to add · drag · double-click to remove'), h('span', '')));
      }
      for (const [k, d] of Object.entries(t.params)) {
        if (d.card !== c.id || d.ui === 'hidden' || switchKeys.has(k) || d.type === 'curve' || d.type === 'seed') continue;
        body.push(this._paramCtl(layer.params, k, d, t.color, live, commit, (v) => metrics[k]?.update(v), layer));
      }
      let metricEl = null;
      if (c.metric && t.params[c.metric]) { metricEl = this._metric(layer.params[c.metric], t.params[c.metric], c.note); metrics[c.metric] = metricEl; }
      const disabled = c.switch ? !layer.params[c.switch] : false;
      this.scroll.append(this._card(c, t.color, metricEl, body, disabled));
    }
    // blend & mask + seed
    const blendBody = [];
    if (t.role === 'generator') blendBody.push(enumRow({ label: 'Blend mode', options: BLEND_MODES }, layer.blend.mode, (v) => { layer.blend.mode = v; commit(); this.render(); }));
    blendBody.push(sliderRow({ label: 'Opacity', min: 0, max: 1, step: 0.01, unit: '%', default: 1 }, layer.blend.opacity, { accent: t.color, onInput: (v) => { layer.blend.opacity = v; live(); }, onCommit: (v) => { layer.blend.opacity = v; commit(); } }));
    if (t.role === 'generator' && (layer.blend.mode === 6 || layer.blend.mode === 7)) {
      blendBody.push(sliderRow({ label: 'Blend smoothness', min: 1, max: 600, step: 1, unit: 'm', default: 120 }, layer.blend.smooth, { accent: t.color, onInput: (v) => { layer.blend.smooth = v; live(); }, onCommit: (v) => { layer.blend.smooth = v; commit(); } }));
    }
    blendBody.push(enumRow({ label: 'Mask', options: MASK_MODES }, layer.mask.mode, (v) => { layer.mask.mode = v; if (v === 2) { layer.mask.min = 0; layer.mask.max = 35; layer.mask.falloff = 5; } else if (v === 3) { layer.mask.min = 0.5; layer.mask.falloff = 0.1; } else if (v === 4) { layer.mask.min = 0.3; layer.mask.max = 0.9; } commit(); this.render(); }));
    const mm = layer.mask.mode;
    const mk = (key, d) => sliderRow(d, layer.mask[key], { accent: t.color, onInput: (v) => { layer.mask[key] = v; live(); }, onCommit: (v) => { layer.mask[key] = v; commit(); } });
    if (mm === 1) { blendBody.push(mk('min', { label: 'Above', min: -500, max: 8000, step: 5, unit: 'm' }), mk('max', { label: 'Below', min: -500, max: 8000, step: 5, unit: 'm' }), mk('falloff', { label: 'Falloff', min: 1, max: 800, step: 1, unit: 'm' })); }
    if (mm === 2) { blendBody.push(mk('min', { label: 'Min slope', min: 0, max: 90, step: 0.5, unit: '°' }), mk('max', { label: 'Max slope', min: 0, max: 90, step: 0.5, unit: '°' }), mk('falloff', { label: 'Falloff', min: 0.5, max: 30, step: 0.5, unit: '°' })); }
    if (mm === 3) { blendBody.push(mk('scale', { label: 'Noise size', min: 0.1, max: 16, step: 0.05, unit: 'km' }), mk('min', { label: 'Threshold', min: 0, max: 1, step: 0.01, unit: '%' }), mk('falloff', { label: 'Softness', min: 0.005, max: 0.5, step: 0.005 })); }
    if (mm === 4) { blendBody.push(mk('min', { label: 'Inner radius', min: 0, max: 1.5, step: 0.01, unit: '%' }), mk('max', { label: 'Outer radius', min: 0, max: 1.5, step: 0.01, unit: '%' })); }
    if (mm > 0) blendBody.push(toggleRow('Invert mask', !!layer.mask.invert, (v) => { layer.mask.invert = v; commit(); }));
    if (t.params.seed) blendBody.push(seedRow(layer.params.seed, { onCommit: (v) => { layer.params.seed = v; commit(); } }));
    this.scroll.append(this._card({ id: 'Blend & mask', icon: 'blend' }, t.color, null, blendBody, false, BLEND_MODES[layer.blend.mode] && t.role === 'generator' ? BLEND_MODES[layer.blend.mode] : 'Modifier'));
    this.foot.querySelector('.ver').textContent = layer.type + ' · ' + layer.id.slice(-5);
  }

  _paramCtl(obj, k, d, accent, live, commit, onMetric, layer) {
    if (d.showIf && layer && !d.showIf(layer)) return null;
    if (d.type === 'enum') {
      const cur = d.values ? Math.max(0, d.values.indexOf(obj[k])) : obj[k];
      return enumRow(d, cur, (i) => { obj[k] = d.values ? d.values[i] : i; commit(); if (d.rerender) this.render(); });
    }
    if (d.type === 'bool') return toggleRow(d.label, !!obj[k], (v) => { obj[k] = v; commit(); this.render(); });
    if (d.type === 'color') return colorRow(d.label, obj[k], { onInput: (v) => { obj[k] = v; live(); }, onCommit: (v) => { obj[k] = v; commit(); } });
    if (d.ui === 'xy') {
      const pair = d.pair;
      const pad = xyPad(obj[k], obj[pair], { onInput: (x, y) => { obj[k] = x; obj[pair] = y; live(); }, onCommit: (x, y) => { obj[k] = x; obj[pair] = y; commit(); }, bg: this.app.thumbCanvas(null, 'height', 160) });
      return h('div.ctl', h('div.ctl-top', h('span.ctl-l', 'Position'), h('span.ctl-v', `${Math.round(obj[k] * 100)}%, ${Math.round(obj[pair] * 100)}%`)), pad);
    }
    const opts = { accent, onInput: (v) => { obj[k] = v; onMetric?.(v); live(); }, onCommit: (v) => { obj[k] = v; onMetric?.(v); commit(); } };
    if (d.ui === 'dial') return dialRow(d, obj[k], opts);
    return sliderRow(d, obj[k], opts);
  }

  // ───────────────────────── texture layer ─────────────────────────
  _texture(layer) {
    const t = TEXTURE_TYPES[layer.type] || TEXTURE_TYPES.base;
    const S = TEXTURE_SCHEMA;
    const accent = layer.params.colorA;
    const live = () => this.store.change('texture', { id: layer.id });
    const commit = () => this.store.commit('texture', { id: layer.id });
    this._header({
      eyebrow: `Texture · ${t.category}`, color: layer.params.colorA, title: layer.name, blurb: t.blurb, crumb: t.label,
      onRename: (n) => { layer.name = n; this.store.commit('meta'); },
      onReset: () => { const d = textureDefaults(layer.type); layer.params = d.params; layer.blend.mode = d.blend; commit(); this.render(); },
      enabled: layer.enabled, onToggle: () => { layer.enabled = !layer.enabled; commit(); this.render(); },
    });
    this.scroll.append(h('div.preview-big', this.app.thumbCanvas(layer, 'texture', 240)));
    this._tiles(S.switches.map(s => ({ label: s.label, icon: s.icon, on: !!layer.params[s.key], toggle: (v) => { layer.params[s.key] = v; commit(); this.render(); } })));
    this.scroll.append(h('div.sec', h('span', 'Material'), h('span.note', TEX_BLEND[layer.blend.mode])));
    const metrics = {};
    for (const c of S.cards) {
      const body = [];
      if (c.ui === 'rules') { body.push(...this._rules(layer, accent, live, commit)); }
      for (const [k, d] of Object.entries(S.params)) {
        if (d.card !== c.id) continue;
        if (S.switches.some(s => s.key === k)) continue;
        const el = this._paramCtl(layer.params, k, { ...d, default: textureDefaults(layer.type).params[k] }, accent, live, commit, (v) => metrics[k]?.update(v), layer);
        if (el) body.push(el);
      }
      let metricEl = null;
      if (c.metric && S.params[c.metric]) { metricEl = this._metric(layer.params[c.metric], S.params[c.metric], c.note); metrics[c.metric] = metricEl; }
      const disabled = c.switch ? !layer.params[c.switch] : false;
      const right = c.ui === 'rules' ? RULES.filter(r => layer.params.rules[r.key]?.on).length + ' active' : null;
      this.scroll.append(this._card(c, accent, metricEl, body, disabled, right));
    }
    const blendBody = [
      enumRow({ label: 'Blend mode', options: TEX_BLEND }, layer.blend.mode, (v) => { layer.blend.mode = v; commit(); this.render(); }),
      sliderRow({ label: 'Opacity', min: 0, max: 1, step: 0.01, unit: '%', default: 1 }, layer.blend.opacity, { accent, onInput: (v) => { layer.blend.opacity = v; live(); }, onCommit: (v) => { layer.blend.opacity = v; commit(); } }),
      toggleRow('Invert placement', !!layer.blend.invert, (v) => { layer.blend.invert = v; commit(); }),
    ];
    this.scroll.append(this._card({ id: 'Blend', icon: 'blend' }, accent, null, blendBody, false, TEX_BLEND[layer.blend.mode]));
    this.foot.querySelector('.ver').textContent = 'material · ' + layer.id.slice(-5);
  }

  _rules(layer, accent, live, commit) {
    const out = [];
    for (const r of RULES) {
      const v = layer.params.rules[r.key];
      const row = h('div.rule' + (v.on ? '' : '.off'));
      const label = () => {
        if (r.special === 'aspect') return `${Math.round(v.dir)}° ± ${Math.round(v.spread)}°`;
        if (r.special === 'noise') return `${fmt(v.scale, { unit: 'm' })} · ${Math.round(v.threshold * 100)}%`;
        return `${fmt(v.lo, r)} – ${fmt(v.hi, r)}`;
      };
      const rv = h('span.rv', v.on ? label() : r.note);
      const tg = h('button.tog' + (v.on ? '.on' : ''));
      tg.addEventListener('click', () => { v.on = !v.on; commit(); row.classList.toggle('off', !v.on); tg.classList.toggle('on', v.on); rv.textContent = v.on ? label() : r.note; this._updateRuleCount(); });
      row.append(h('div.rule-h', tg, ic(r.icon, 14, v.on ? accent : '#777'), h('span', r.label), rv));
      const body = h('div.rule-b');
      if (r.special === 'aspect') {
        body.append(dialRow({ label: 'Facing', min: 0, max: 360, step: 1, unit: '°' }, v.dir, { accent, onInput: (x) => { v.dir = x; rv.textContent = label(); live(); }, onCommit: (x) => { v.dir = x; commit(); } }));
        body.append(sliderRow({ label: 'Spread', min: 5, max: 180, step: 1, unit: '°' }, v.spread, { accent, onInput: (x) => { v.spread = x; rv.textContent = label(); live(); }, onCommit: (x) => { v.spread = x; commit(); } }));
        body.append(sliderRow({ label: 'Falloff', min: 1, max: 90, step: 1, unit: '°' }, v.fall, { accent, onInput: (x) => { v.fall = x; live(); }, onCommit: (x) => { v.fall = x; commit(); } }));
      } else if (r.special === 'noise') {
        body.append(sliderRow({ label: 'Size', min: 2, max: 4000, step: 1, unit: 'm', curve: 'log' }, v.scale, { accent, onInput: (x) => { v.scale = x; rv.textContent = label(); live(); }, onCommit: (x) => { v.scale = x; commit(); } }));
        body.append(sliderRow({ label: 'Threshold', min: 0, max: 1, step: 0.01, unit: '%' }, v.threshold, { accent, onInput: (x) => { v.threshold = x; rv.textContent = label(); live(); }, onCommit: (x) => { v.threshold = x; commit(); } }));
        body.append(sliderRow({ label: 'Contrast', min: 0.2, max: 12, step: 0.05, unit: '×' }, v.contrast, { accent, onInput: (x) => { v.contrast = x; live(); }, onCommit: (x) => { v.contrast = x; commit(); } }));
      } else {
        body.append(rangeRow(r, v.lo, v.hi, v.fall, { accent, onInput: (a, b) => { v.lo = a; v.hi = b; rv.textContent = label(); live(); }, onCommit: (a, b) => { v.lo = a; v.hi = b; commit(); } }));
        body.append(sliderRow({ label: 'Falloff', min: 0, max: r.fallMax, step: r.step, unit: r.unit === '%' ? '' : r.unit }, v.fall, { accent, onInput: (x) => { v.fall = x; live(); }, onCommit: (x) => { v.fall = x; commit(); } }));
      }
      row.append(body);
      out.push(row);
    }
    return out;
  }
  _updateRuleCount() {
    const s = this.store.sel;
    const layer = this.store.p.texture.layers.find(l => l.id === s.texture);
    const r = this.scroll.querySelectorAll('.card-h .r')[0];
    if (layer && r) r.textContent = RULES.filter(x => layer.params.rules[x.key]?.on).length + ' active';
  }

  // ───────────────────────── scene items ─────────────────────────
  _scene(key) {
    const item = SCENE_ITEMS.find(i => i.key === key) || SCENE_ITEMS[0];
    const S = SCENE_SCHEMAS[item.key];
    const p = this.store.p;
    const kindOf = (d) => d.kind || 'scene';
    const live = (d) => this.store.change(kindOf(d), { scene: true, sun: d.kind === 'sun' });
    const commit = (d) => this.store.commit(kindOf(d), { scene: true, sun: d.kind === 'sun' });
    this._header({
      eyebrow: S.eyebrow, color: item.color, title: item.label, blurb: S.blurb, crumb: item.label,
      onReset: () => {
        const def = SCENE_DEFAULTS;
        for (const d of S.params.concat(S.switches || [])) {
          const o = d.obj(p);
          const src = o === p.scene.sky ? def.sky : o === p.scene.water ? def.water : o === p.scene.view ? def.view : o === p.scene ? def : null;
          if (src && d.key in src) o[d.key] = structuredClone(src[d.key]);
        }
        this.store.commit('scene', { scene: true, sun: true }); this.render();
      },
    });
    this._tiles((S.switches || []).map(sw => ({ label: sw.label, icon: sw.icon, on: !!sw.obj(p)[sw.key], toggle: (v) => { sw.obj(p)[sw.key] = v; this.store.commit(sw.kind || 'scene', { scene: true }); this.render(); } })));
    this.scroll.append(h('div.sec', h('span', 'Settings'), h('span.note', item.sub)));
    const metrics = {};
    for (const c of S.cards) {
      const body = [];
      for (const d of S.params) {
        if (d.card !== c.id) continue;
        const o = d.obj(p);
        if (!o) continue;
        const el = this._paramCtl(o, d.key, { ...d, rerender: d.key === 'surround' }, item.color, () => live(d), () => commit(d), (v) => metrics[d.key]?.update(v));
        if (el) body.push(el);
      }
      let metricEl = null;
      if (c.metric) {
        const [mk, obj] = c.metric;
        const d = S.params.find(x => x.key === mk);
        if (d) { metricEl = this._metric(obj(p)[mk], d, null); metrics[mk] = metricEl; }
      }
      const disabled = c.switch ? !(S.switches.find(x => x.key === c.switch)?.obj(p)[c.switch]) : false;
      this.scroll.append(this._card(c, item.color, metricEl, body, disabled));
    }
    if (item.key === 'world' && this.app.lastBuild) {
      const b = this.app.lastBuild;
      this.scroll.append(this._card({ id: 'Statistics', icon: 'chart-column' }, item.color, null, [h('div.kv',
        h('span', 'Resolution'), h('b', `${b.N} × ${b.N}`),
        h('span', 'Cell size'), h('b', fmt(p.world.size / b.N, { unit: 'm' })),
        h('span', 'Lowest point'), h('b', fmt(b.stats.min * p.world.height, { unit: 'm' })),
        h('span', 'Highest point'), h('b', fmt(b.stats.max * p.world.height, { unit: 'm' })),
        h('span', 'Build time'), h('b', (b.ms / 1000).toFixed(2) + ' s'))], false));
    }
    if (item.key === 'view') {
      this.scroll.append(this._card({ id: 'Controls', icon: 'mouse' }, item.color, null, [h('div.kv',
        h('span', 'Look'), h('b', 'Right mouse drag'), h('span', 'Fly'), h('b', 'W A S D · Q E'), h('span', 'Boost'), h('b', 'Shift'),
        h('span', 'Dolly'), h('b', 'Wheel'), h('span', 'Fly speed'), h('b', 'RMB + wheel'), h('span', 'Move + turn'), h('b', 'Left mouse drag'),
        h('span', 'Pan'), h('b', 'Middle mouse drag'), h('span', 'Orbit'), h('b', 'Alt + left drag'), h('span', 'Move sun'), h('b', 'L + left drag'), h('span', 'Frame terrain'), h('b', 'F'))], false));
    }
    this.foot.querySelector('.ver').textContent = 'scene · ' + item.key;
  }
}
export { selectCtl };
