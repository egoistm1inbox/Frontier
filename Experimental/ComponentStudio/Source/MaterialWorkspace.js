// Material Workspace — inspector-only UI demo. The viewport is intentionally blank in this pass; every control edits a
// real recipe model (MaterialRecipe.js), so the live-vs-structural split, drivers and the 256-byte block stay honest.
import { $, h, segmented, vecRow, toast, hydrate, download, popupMenu, setFill } from './Kit.js';
import {
  LAYER_TYPES, LOBES, CHANNELS, FIELD_PATTERNS, MASK_MODES, SPACES, BLENDS, DRIVERS, COLOUR_SLOTS, FINISHES, SPECS, AMOUNT,
  BLOCK_BYTES, presets, newLayer, liveParams, blockLayout, structure, signature, lobeSummary,
} from './MaterialRecipe.js';

const STORE = 'frontier.materialWorkspace.v1';
const UI_STORE = 'frontier.materialWorkspace.ui.v1';
const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------------------------------------- session
const library = presets();
const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } })();
const ui = (() => { try { return { collapsed: [], ...JSON.parse(localStorage.getItem(UI_STORE)) }; } catch { return { collapsed: [] }; } })();
const S = {
  recipe: null, savedJson: '', compiled: '', liveEdits: 0, active: 0, search: '',
  undo: [], redo: [], last: '',
};

function load(id) {
  const preset = library.find((m) => m.id === id) || library[0];
  S.recipe = structuredClone(saved[preset.id] || preset);
  S.recipe.output ||= { res: 2048, time: 0, channels: ['colour', 'roughness', 'metalness', 'normal', 'height'] };
  S.savedJson = JSON.stringify(S.recipe);
  S.last = S.savedJson; S.undo = []; S.redo = [];
  S.compiled = signature(structure(S.recipe)); S.liveEdits = 0;
  S.active = Math.min(S.recipe.layers.length - 1, Math.max(0, +(params.get('layer') ?? S.recipe.layers.length - 1)));
  $('MatPicker').value = preset.id;
  render();
}
const R = () => S.recipe;
const layer = () => R().layers[S.active];
const dirty = () => JSON.stringify(R()) !== S.savedJson;
const variant = () => signature(structure(R()));
const stale = () => variant() !== S.compiled;

// Every committed edit lands here. `structural` edits change the compiled variant and redraw the inspector;
// live edits only refresh the counters.
function commit({ structural = false, redraw = structural } = {}) {
  const now = JSON.stringify(R());
  if (now !== S.last) { S.undo.push(S.last); if (S.undo.length > 80) S.undo.shift(); S.redo = []; S.last = now; }
  if (!structural) S.liveEdits++;
  if (redraw) render(); else refresh();
}
function restore(json) { S.recipe = JSON.parse(json); S.last = json; S.active = Math.min(S.active, R().layers.length - 1); render(); }
function undo() { if (!S.undo.length) return; S.redo.push(S.last); restore(S.undo.pop()); }
function redo() { if (!S.redo.length) return; S.undo.push(S.last); restore(S.redo.pop()); }

// ---------------------------------------------------------------------------------------------- parameter access
function getVal(l, key) { if (key === 'opacity') return l.opacity; if (key.startsWith('amount.')) return l.targets[key.slice(7)]; return l.p[key]; }
function setVal(l, key, v) { if (key === 'opacity') l.opacity = v; else if (key.startsWith('amount.')) l.targets[key.slice(7)] = v; else l.p[key] = v; }
const driverKey = (l, key) => `${l.id}.${key}`;
const fmt = (v, d) => (+v).toFixed(d);

// ---------------------------------------------------------------------------------------------- widgets
function section(id, { icon, title, tag, accent }, ...body) {
  const closed = ui.collapsed.includes(id);
  const toggle = h('button', { class: 'mi-fold', 'aria-expanded': String(!closed), 'aria-label': `${closed ? 'Expand' : 'Collapse'} ${title}`, dataset: { icon: 'chevron', size: '12' } });
  const head = h('header', {}, h('span', { class: 'mi-section-ico', style: accent ? { color: accent } : null, dataset: { icon, size: '15' } }), h('b', {}, title), tag ? h('em', {}, tag) : null, toggle);
  const node = h('section', { class: 'mi-section' + (closed ? ' closed' : ''), dataset: { sec: id } }, head, h('div', { class: 'mi-body' }, ...body));
  head.addEventListener('click', (e) => {
    if (e.target.closest('input,select,.mi-head-action')) return;
    const c = node.classList.toggle('closed');
    toggle.setAttribute('aria-expanded', String(!c));
    ui.collapsed = c ? [...new Set([...ui.collapsed, id])] : ui.collapsed.filter((x) => x !== id);
    localStorage.setItem(UI_STORE, JSON.stringify(ui));
  });
  return node;
}
const field = (label, control, extra = {}) => h('div', { class: 'mi-field', dataset: { search: (extra.search || label).toLowerCase() } }, h('label', {}, label), control);
const sub = (text, tag) => h('div', { class: 'mi-sub' }, h('span', {}, text), tag ? h('em', {}, tag) : null);
const hint = (text) => h('p', { class: 'mi-hint' }, text);

function mswitch(on, onChange, label) {
  const b = h('button', { class: 'mswitch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(on), 'aria-label': label });
  b.addEventListener('click', () => { on = !on; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); onChange(on); });
  return b;
}
function switchRow(label, on, onChange, note) {
  return h('div', { class: 'mi-switch-row', dataset: { search: label.toLowerCase() } }, h('div', {}, h('span', {}, label), note ? h('small', {}, note) : null), mswitch(on, onChange, label));
}
function select(options, picked, onChange, label) {
  const s = h('select', { class: 'mi-select', 'aria-label': label });
  for (const [v, t] of options) s.append(h('option', { value: v, selected: v === picked ? true : null }, t));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}
function colourRow(label, hex, onInput, { tag, search } = {}) {
  const input = h('input', { type: 'color', value: hex, 'aria-label': label });
  const code = h('code', {}, hex);
  const dot = h('span', { class: 'mi-dot', style: { background: hex } });
  input.addEventListener('input', () => { dot.style.background = input.value; code.textContent = input.value; onInput(input.value, false); });
  input.addEventListener('change', () => onInput(input.value, true));
  return h('label', { class: 'mi-colour', dataset: { search: (search || label).toLowerCase() } }, dot, h('span', {}, label), tag ? h('em', {}, tag) : null, code, input);
}

// A live parameter: label + driver chip, then number box · unit · slider (Pattern workspace row).
function paramRow(l, key, spec, { label = spec.label, drivable = true } = {}) {
  const dk = driverKey(l, key), drv = drivable ? R().drivers[dk] : null;
  const chip = h('button', { class: 'mi-drv' + (drv ? ' on' : ''), title: drv ? `Driven by ${DRIVERS.find((d) => d.id === drv.mode).label} · click to change` : 'Link a live driver', 'aria-label': `Driver for ${label}` },
    h('span', { dataset: { icon: drv ? DRIVERS.find((d) => d.id === drv.mode).icon : 'link', size: '11' } }), drv ? `${DRIVERS.find((d) => d.id === drv.mode).label}` : '');
  chip.addEventListener('click', (e) => { e.stopPropagation(); driverMenu(l, key, spec, chip.getBoundingClientRect()); });
  const head = h('div', { class: 'mi-row-head' }, h('label', {}, label), drivable ? chip : null);
  const row = h('div', { class: 'mi-row' + (drv ? ' driven' : ''), dataset: { search: label.toLowerCase() } }, head);
  if (drv) {
    // Driven: the row edits the range the driver sweeps between.
    const lo = numberBox(drv.min, spec, (v) => { drv.min = v; paint(); commit(); }, `${label} minimum`);
    const hi = numberBox(drv.max, spec, (v) => { drv.max = v; paint(); commit(); }, `${label} maximum`);
    const band = h('div', { class: 'mi-band' }, h('i'));
    const paint = () => {
      const a = (Math.min(drv.min, drv.max) - spec.min) / (spec.max - spec.min), b = (Math.max(drv.min, drv.max) - spec.min) / (spec.max - spec.min);
      band.firstChild.style.left = a * 100 + '%'; band.firstChild.style.width = Math.max(1.5, (b - a) * 100) + '%';
    };
    paint();
    row.append(h('div', { class: 'mi-row-ctl' }, lo, band, hi), h('small', { class: 'mi-row-note' }, `${DRIVERS.find((d) => d.id === drv.mode).note} · speed ${fmt(drv.speed, 2)}× · ${spec.unit || 'unitless'}`));
    return row;
  }
  const current = getVal(l, key);
  const range = h('input', { type: 'range', min: spec.min, max: spec.max, step: spec.step, value: current, 'aria-label': `${label} slider` });
  const box = numberBox(current, spec, (v) => { range.value = v; setFill(range); setVal(l, key, v); commit(); }, label);
  setFill(range);
  range.addEventListener('input', () => { setFill(range); box.value = fmt(range.value, spec.digits); setVal(l, key, +range.value); refresh(); });
  range.addEventListener('change', () => commit());
  row.append(h('div', { class: 'mi-row-ctl' }, box, h('span', { class: 'mi-unit' }, spec.unit || '—'), range));
  return row;
}
function numberBox(amount, spec, onCommit, label) {
  const input = h('input', { class: 'mi-box', type: 'text', inputmode: 'decimal', value: fmt(amount, spec.digits), 'aria-label': label });
  // Drag horizontally to scrub (Shift = fine), click to type.
  let drag = null;
  input.addEventListener('pointerdown', (e) => { if (document.activeElement === input) return; drag = { x: e.clientX, v: parseFloat(input.value), moved: false }; input.setPointerCapture(e.pointerId); e.preventDefault(); });
  input.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x; if (Math.abs(dx) > 2) drag.moved = true; if (!drag.moved) return;
    const span = spec.max - spec.min, v = Math.max(spec.min, Math.min(spec.max, drag.v + (dx / 220) * span * (e.shiftKey ? 0.1 : 1)));
    input.value = fmt(v, spec.digits);
  });
  input.addEventListener('pointerup', () => { if (drag) { if (drag.moved) onCommit(parseFloat(input.value)); else { input.focus(); input.select(); } } drag = null; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = fmt(value, spec.digits); input.blur(); } });
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (!Number.isFinite(v)) { input.value = fmt(value, spec.digits); return; }
    const c = Math.max(spec.min, Math.min(spec.max, v)); input.value = fmt(c, spec.digits); value = c; onCommit(c);
  });
  return input;
}
function driverMenu(l, key, spec, at) {
  const dk = driverKey(l, key), cur = R().drivers[dk];
  popupMenu(at, [
    { heading: `DRIVE · ${spec.label.toUpperCase()}` },
    ...DRIVERS.map((d) => ({
      label: d.label, note: d.note, icon: d.icon, accent: (cur ? cur.mode : 'constant') === d.id ? 'teal' : null, hint: (cur ? cur.mode : 'constant') === d.id ? '●' : null,
      onClick: () => {
        if (d.id === 'constant') { if (cur) { setVal(l, key, Math.min(spec.max, Math.max(spec.min, (cur.min + cur.max) / 2))); delete R().drivers[dk]; } }
        else {
          // New links sweep a quarter of the range either side of the current setting.
          const v = getVal(l, key), q = (spec.max - spec.min) * 0.25, c = (x) => +Math.max(spec.min, Math.min(spec.max, x)).toFixed(spec.digits ?? 2);
          R().drivers[dk] = { mode: d.id, speed: cur?.speed ?? 1, min: cur?.min ?? c(v - q), max: cur?.max ?? c(v + q) };
        }
        commit({ redraw: true });
        toast(d.id === 'constant' ? `${spec.label} is a plain slider again` : `${spec.label} ← ${d.label}. Live: no recompile`);
      },
    })),
  ], { width: 250, label: 'Driver' });
}

// Little previews for pattern / mask pickers (40 × 28).
const PATTERN_ART = {
  hex: 'M6 4l4 2.3v4.6L6 13.2 2 10.9V6.3zM16 4l4 2.3v4.6l-4 2.3-4-2.3V6.3zM26 4l4 2.3v4.6l-4 2.3-4-2.3V6.3zM36 4l4 2.3v4.6M11 13.2l4 2.3v4.6l-4 2.3-4-2.3v-4.6zM21 13.2l4 2.3v4.6l-4 2.3-4-2.3v-4.6zM31 13.2l4 2.3v4.6l-4 2.3-4-2.3v-4.6z',
  voronoi: 'M2 9l8-5 7 4 1 8-7 4-8-3zM17 8l9-5 9 6-2 8-9 2-6-3zM11 20l7-4 6 3-1 7M33 17l5 6M2 20l9 0 1 7',
  fbm: 'M2 18c4-6 7 2 11-3s6-9 10-4 5 7 9 3 5-6 6-4M2 25c5-3 8 0 12-2s7-5 11-2 8 2 13-1M2 9c3-3 6-1 9-3s7-4 10-1',
  waves: 'M2 7c4-4 8 4 12 0s8 4 12 0 8 4 12 0M2 14c4-4 8 4 12 0s8 4 12 0 8 4 12 0M2 21c4-4 8 4 12 0s8 4 12 0 8 4 12 0',
  rain: 'M7 4v7M7 15a1.6 2 0 1 0 0.1 0M18 2v10M18 16a1.6 2 0 1 0 0.1 0M29 6v6M29 16a1.6 2 0 1 0 0.1 0M35 3v12M12 20v4M24 19v6',
  brushed: 'M2 5h36M2 8h30M6 11h32M2 14h36M2 17h26M8 20h30M2 23h36',
  voxel: 'M3 4h6v6H3zM11 4h6v6h-6zM19 4h6v6h-6zM27 4h6v6h-6zM3 12h6v6H3zM11 12h6v6h-6zM27 12h6v6h-6zM3 20h6v6H3zM19 20h6v6h-6z',
  contour: 'M20 14m-4 0a4 3 0 1 0 8 0a4 3 0 1 0-8 0M20 14m-9 0a9 7 0 1 0 18 0a9 7 0 1 0-18 0M20 14m-15 0a15 11 0 1 0 30 0a15 11 0 1 0-30 0',
};
const MASK_ART = {
  sweep: 'M2 26L20 2h18v24zM19 26L37 2', fresnel: 'M20 14m-11 0a11 11 0 1 0 22 0a11 11 0 1 0-22 0M20 14m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0',
  impact: 'M20 14m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M20 14m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M20 14m-12 0a12 12 0 1 0 24 0a12 12 0 1 0-24 0',
  crevice: 'M2 8l6 12 5-9 6 13 5-11 6 10 4-7 4 6', band: 'M2 10h36M2 18h36M2 4h36M2 24h36', puddle: 'M6 12c0-5 10-6 12-2s-2 8-6 8-6-2-6-6zM24 18c0-4 8-5 11-2s0 7-4 7-7-1-7-5z',
  voxel: 'M2 26V18h6v-6h6V6h6V2M20 2h6v6h6v6h6',
};
function picker(list, picked, art, onPick, label) {
  const grid = h('div', { class: 'mi-picker', role: 'radiogroup', 'aria-label': label });
  for (const o of list) {
    const b = h('button', { class: 'mi-pick' + (o.id === picked ? ' active' : ''), role: 'radio', 'aria-checked': String(o.id === picked), title: o.label, dataset: { search: o.label.toLowerCase() } },
      h('span', { class: 'mi-art', html: `<svg viewBox="0 0 40 28" width="40" height="28" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="${art[o.id]}"/></svg>` }), h('small', {}, o.label));
    b.addEventListener('click', () => onPick(o.id));
    grid.append(b);
  }
  return grid;
}

// ---------------------------------------------------------------------------------------------- inspector
function render() {
  const host = $('MatInspector'), scroll = host.scrollTop;
  host.textContent = '';
  const l = layer(), t = LAYER_TYPES[l.type];
  host.append(headBlock(l), heroTiles(), layerStrip(), searchRow());
  host.append(layerSection(l));
  if (l.type === 'finish') host.append(surfaceSection(l), lobeSection(l));
  if (l.type === 'field') host.append(fieldSection(l), targetSection(l));
  if (l.type === 'mask') host.append(maskSection(l), seamSection(l));
  if (l.type === 'transition') host.append(transitionSection(l));
  host.append(slotSection(), driverSection(), budgetSection(), outputSection());
  hydrate(host);
  applySearch();
  host.scrollTop = scroll;
  $('MatTitle').textContent = R().name; $('MatGroup').textContent = `${R().group.toUpperCase()} · ${R().layers.length} LAYERS`;
  $('MatDocTab').textContent = R().name;
  document.title = `${R().name} · Material Workspace`;
  refresh();
  void t;
}

// Counters that change on every live edit — no DOM rebuild.
function refresh() {
  const b = blockLayout(R()), live = b.rows.slice(2).reduce((n, r) => n + r.params, 0);
  const set = (id, text) => { const n = document.getElementById(id); if (n) n.textContent = text; };
  set('HeroLive', String(live)); set('HeroLiveSub', `${b.used} / ${BLOCK_BYTES} B`);
  set('HeroVariant', '#' + variant());
  const vt = document.getElementById('HeroVariantTile');
  if (vt) { vt.classList.toggle('stale', stale()); set('HeroVariantSub', stale() ? 'Rebuild needed' : `Compiled · ${S.liveEdits} live edits`); }
  set('FootLayers', `${R().layers.filter((x) => x.enabled).length} / ${R().layers.length}`); set('FootLive', `${b.used} B`); set('FootVariant', '#' + variant() + (stale() ? ' · stale' : ''));
  const ss = $('MatSaveState'); ss.textContent = dirty() ? 'UNSAVED' : 'SAVED'; ss.classList.toggle('dirty', dirty());
  $('MatSave').classList.toggle('dirty', dirty()); $('MatRevert').disabled = !dirty(); $('MatUndo').disabled = !S.undo.length;
  $('MatFootRight').textContent = stale() ? 'Structure changed · rebuild variant' : 'Live uniforms · no recompile';
  $('MatFootRight').classList.toggle('warn', stale());
  const look = document.getElementById('MatLook'); if (look) look.style.background = lookGradient();
}

function lookGradient() {
  const f = R().layers.find((x) => x.type === 'finish' && x.enabled) || R().layers[0];
  const r = f?.p?.roughness ?? 0.5, c = f?.colour || '#444', glow = R().slots.primary;
  const spot = Math.round(10 + r * 34);
  return `radial-gradient(circle at 34% 30%, #ffffff${r < 0.4 ? 'ee' : '66'} 0 ${Math.max(2, spot / 6)}%, transparent ${spot}%), radial-gradient(circle at 50% 50%, ${c} 0 52%, ${glow} 70%, #050505 72%)`;
}

function headBlock(l) {
  const name = h('input', { class: 'mi-name', value: R().name, 'aria-label': 'Material name', spellcheck: 'false' });
  name.addEventListener('change', () => { R().name = name.value.trim() || R().name; commit({ structural: false, redraw: true }); });
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
  return h('div', { class: 'mi-head' },
    h('div', { class: 'mi-kicker' }, h('span', {}, 'Material & Layers'), h('em', {}, 'OPENPBR 1.1 · DYNAMIC')),
    h('div', { class: 'mi-title' }, h('span', { class: 'mi-look', id: 'MatLook', title: 'Look swatch (not a render)' }),
      h('div', {}, name, h('small', { class: 'mi-active' }, `ACTIVE LAYER: ${l.name.toUpperCase()}`))));
}

function heroTiles() {
  const rebuild = h('button', { class: 'mi-head-action', title: 'Rebuild the shader variant for the new structure' }, 'Rebuild');
  rebuild.addEventListener('click', (e) => { e.stopPropagation(); S.compiled = variant(); S.liveEdits = 0; toast(`Variant #${S.compiled} compiled · ${18 + R().layers.length * 7} ms (simulated)`); refresh(); });
  return h('div', { class: 'mi-hero' },
    h('div', { class: 'mi-tile cream' }, h('small', {}, 'Live parameters'), h('b', { id: 'HeroLive' }, '—'), h('small', { id: 'HeroLiveSub' }, '—')),
    h('div', { class: 'mi-tile' }, h('small', {}, 'Layers'), h('b', {}, `${R().layers.filter((x) => x.enabled).length}`, h('i', {}, ` / ${R().layers.length}`)), h('small', {}, Object.keys(R().drivers).length + ' driven')),
    h('div', { class: 'mi-tile variant', id: 'HeroVariantTile' }, h('small', {}, 'Variant'), h('b', { id: 'HeroVariant' }, '—'), h('small', { id: 'HeroVariantSub' }, '—'), rebuild));
}

// Compact active-layer selector. The full layer stack is being redesigned separately; this only picks what to inspect.
function layerStrip() {
  const add = h('button', { class: 'mi-icon-btn', title: 'Add a layer above the active one', 'aria-label': 'Add layer', dataset: { icon: 'plus', size: '13' } });
  add.addEventListener('click', (e) => {
    popupMenu(add.getBoundingClientRect(), [{ heading: 'ADD LAYER ABOVE ACTIVE' }, ...Object.entries(LAYER_TYPES).map(([type, t]) => ({ label: t.label, icon: t.icon, note: t.note,
      onClick: () => { R().layers.splice(S.active + 1, 0, newLayer(type, R())); S.active++; commit({ structural: true }); toast(`${t.label} layer added · structure changed`); } }))], { width: 290, label: 'Add layer' });
    e.stopPropagation();
  });
  const list = h('div', { class: 'mi-layers', role: 'listbox', 'aria-label': 'Active layer' });
  [...R().layers].map((x, i) => [x, i]).reverse().forEach(([x, i]) => {
    const t = LAYER_TYPES[x.type];
    const eye = h('span', { class: 'mi-eye', title: x.enabled ? 'Disable layer' : 'Enable layer', dataset: { icon: x.enabled ? 'eye' : 'eyeOff', size: '13' } });
    const row = h('button', { class: 'mi-layer' + (i === S.active ? ' active' : '') + (x.enabled ? '' : ' off'), role: 'option', 'aria-selected': String(i === S.active), style: { '--tc': t.colour } },
      h('span', { class: 'mi-layer-ico', dataset: { icon: t.icon, size: '14' } }),
      h('span', { class: 'mi-layer-text' }, h('b', {}, x.name), h('small', {}, `${t.label}${i === 0 ? ' · bottom' : ''}${Object.keys(R().drivers).some((k) => k.startsWith(x.id + '.')) ? ' · driven' : ''}`)),
      i > 0 ? eye : h('span', { class: 'mi-eye lock', title: 'The bottom finish is always on', dataset: { icon: 'lock', size: '12' } }));
    row.addEventListener('click', (e) => {
      if (e.target.closest('.mi-eye') && i > 0) { x.enabled = !x.enabled; commit({ structural: true }); return; }
      S.active = i; render();
    });
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); layerMenu(i, { x: e.clientX, y: e.clientY }); });
    list.append(row);
  });
  return h('div', { class: 'mi-strip' }, h('div', { class: 'mi-strip-head' }, h('span', {}, 'EDITING LAYER'), h('em', {}, 'TOP → BOTTOM'), add), list);
}
function layerMenu(i, at) {
  const x = R().layers[i], n = R().layers.length;
  popupMenu(at, [
    { heading: x.name.toUpperCase() },
    { label: 'Move up', icon: 'chevron', disabled: i === 0 || i === n - 1, onClick: () => { [R().layers[i], R().layers[i + 1]] = [R().layers[i + 1], R().layers[i]]; S.active = i + 1; commit({ structural: true }); } },
    { label: 'Move down', icon: 'chevron', disabled: i <= 1, onClick: () => { [R().layers[i], R().layers[i - 1]] = [R().layers[i - 1], R().layers[i]]; S.active = i - 1; commit({ structural: true }); } },
    { label: 'Duplicate', icon: 'duplicate', disabled: i === 0, onClick: () => { const c = structuredClone(x); c.id = `${x.type}-${Math.random().toString(36).slice(2, 7)}`; c.name += ' copy'; R().layers.splice(i + 1, 0, c); S.active = i + 1; commit({ structural: true }); } },
    'sep',
    { label: 'Delete layer', icon: 'trash', accent: 'danger', disabled: i === 0, note: i === 0 ? 'The bottom finish stays' : null, onClick: () => {
      for (const k of Object.keys(R().drivers)) if (k.startsWith(x.id + '.')) delete R().drivers[k];
      R().layers.splice(i, 1); S.active = Math.max(0, Math.min(S.active, R().layers.length - 1)); commit({ structural: true }); toast(`Deleted ${x.name}`);
    } },
  ], { width: 230, label: 'Layer actions' });
}

function searchRow() {
  const input = h('input', { type: 'search', id: 'MatSearch', placeholder: 'Find a parameter…', value: S.search, autocomplete: 'off', 'aria-label': 'Find a parameter' });
  input.addEventListener('input', () => { S.search = input.value; applySearch(); });
  const fold = h('button', { class: 'mi-icon-btn', title: 'Collapse / expand all sections', 'aria-label': 'Collapse or expand all', dataset: { icon: 'layers', size: '13' } });
  fold.addEventListener('click', () => {
    const sections = [...document.querySelectorAll('.mi-section')], close = sections.some((c) => !c.classList.contains('closed'));
    sections.forEach((c) => c.classList.toggle('closed', close));
    ui.collapsed = close ? sections.map((c) => c.dataset.sec) : []; localStorage.setItem(UI_STORE, JSON.stringify(ui));
  });
  return h('div', { class: 'mi-search' }, h('label', { class: 'search' }, h('span', { dataset: { icon: 'search', size: '14' } }), input), fold);
}
function applySearch() {
  const q = S.search.trim().toLowerCase();
  for (const c of document.querySelectorAll('.mi-section')) {
    const rows = [...c.querySelectorAll('[data-search]')];
    let any = !q || c.querySelector('header b').textContent.toLowerCase().includes(q);
    for (const it of rows) { const hit = !q || any || it.dataset.search.includes(q); it.classList.toggle('mi-miss', !hit); if (q && it.dataset.search.includes(q)) any = true; }
    if (q && any) rows.forEach((it) => it.classList.toggle('mi-miss', !(c.querySelector('header b').textContent.toLowerCase().includes(q) || it.dataset.search.includes(q))));
    c.classList.toggle('mi-miss', !!q && !any);
    if (q && any) c.classList.remove('closed');
  }
}

// ---------------------------------------------------------------------------------------------- sections
function layerSection(l) {
  const t = LAYER_TYPES[l.type], bottom = S.active === 0;
  const name = h('input', { class: 'mi-input', value: l.name, 'aria-label': 'Layer name', spellcheck: 'false' });
  name.addEventListener('change', () => { l.name = name.value.trim() || l.name; commit({ redraw: true }); });
  const body = [
    field('Layer name', name),
    h('div', { class: 'mi-type', style: { '--tc': t.colour }, dataset: { search: 'layer type ' + t.label.toLowerCase() } }, h('span', { dataset: { icon: t.icon, size: '15' } }), h('div', {}, h('b', {}, t.label), h('small', {}, t.note))),
  ];
  if (!bottom) {
    body.push(switchRow('Layer enabled', l.enabled, (v) => { l.enabled = v; commit({ structural: true }); }, 'Off layers are skipped by the compiled variant'));
    body.push(field('Blend mode', segmented(BLENDS, l.blend, (v) => { l.blend = v; commit({ structural: true }); }, { label: 'Blend mode' })));
    body.push(paramRow(l, 'opacity', { form: 'scalar', label: 'Layer opacity', min: 0, max: 1, step: 0.01, unit: '', digits: 2 }));
  } else body.push(hint('Bottom layer: the finish everything above blends onto. It cannot be disabled or blended.'));
  if (l.type === 'field') body.push(field('Coordinates', segmented(SPACES, l.space, (v) => { l.space = v; commit({ structural: true }); }, { label: 'Coordinates' })));
  return section('layer', { icon: 'layers', title: 'Layer properties', tag: t.label.toUpperCase(), accent: t.colour }, ...body);
}

function surfaceSection(l) {
  const preset = select(Object.entries(FINISHES).map(([k, f]) => [k, f.label]), l.finish, (k) => {
    const f = FINISHES[k]; Object.assign(l.p, { roughness: f.roughness, metalness: f.metalness, specular: f.specular, ior: f.ior }); l.colour = f.colour; l.lobes = [...f.lobes]; l.finish = k;
    commit({ structural: true }); toast(`${f.label} applied · lobes ${f.lobes.length ? f.lobes.join(', ') : 'diffuse + specular'}`);
  }, 'Finish preset');
  return section('surface', { icon: 'finish', title: 'Surface response', tag: FINISHES[l.finish]?.label.toUpperCase(), accent: LAYER_TYPES.finish.colour },
    field('Finish preset', preset),
    colourRow('Colour', l.colour, (v, done) => { l.colour = v; done ? commit() : refresh(); }, { tag: 'LINEAR' }),
    ...['roughness', 'metalness', 'specular', 'ior'].map((k) => paramRow(l, k, SPECS.finish[k])));
}

function lobeSection(l) {
  const grid = h('div', { class: 'mi-lobes' });
  for (const lobe of LOBES) {
    const on = lobe.locked || l.lobes.includes(lobe.id);
    const b = h('button', { class: 'mi-lobe' + (on ? ' on' : '') + (lobe.locked ? ' locked' : ''), 'aria-pressed': String(on), disabled: lobe.locked ? true : null, title: lobe.note, dataset: { search: lobe.label.toLowerCase() } },
      h('b', {}, lobe.label), h('small', {}, lobe.note), h('em', {}, lobe.locked ? 'ALWAYS' : on ? 'ON' : 'OFF'));
    if (!lobe.locked) b.addEventListener('click', () => { l.lobes = on ? l.lobes.filter((x) => x !== lobe.id) : [...l.lobes, lobe.id]; commit({ structural: true }); });
    grid.append(b);
  }
  const extras = [];
  for (const lobe of LOBES) {
    if (lobe.locked || !l.lobes.includes(lobe.id)) continue;
    const keys = Object.entries(SPECS.finish).filter(([, s]) => s.lobe === lobe.id);
    extras.push(sub(lobe.label.toUpperCase(), lobe.note), ...keys.map(([k, s]) => paramRow(l, k, s)));
  }
  return section('lobes', { icon: 'lobes', title: 'OpenPBR lobes', tag: `${l.lobes.length + 2} / ${LOBES.length}` },
    grid, hint('Turning a lobe on or off changes the compiled variant. Its sliders below are live.'), ...extras);
}

function fieldSection(l) {
  const octaves = ['fbm', 'waves', 'voronoi'].includes(l.pattern)
    ? field('Octaves', segmented([2, 3, 4, 5, 6].map((n) => [n, String(n)]), l.octaves, (v) => { l.octaves = v; commit({ structural: true }); }, { label: 'Octaves' })) : null;
  const keys = Object.keys(SPECS.field).filter((k) => k !== 'lineWidth' || ['hex', 'contour', 'voxel'].includes(l.pattern));
  return section('field', { icon: 'field', title: 'Procedural field', tag: FIELD_PATTERNS.find((p) => p.id === l.pattern).label.toUpperCase(), accent: LAYER_TYPES.field.colour },
    picker(FIELD_PATTERNS, l.pattern, PATTERN_ART, (v) => { l.pattern = v; commit({ structural: true }); }, 'Pattern'),
    octaves, ...keys.map((k) => paramRow(l, k, SPECS.field[k])));
}

function targetSection(l) {
  const chips = h('div', { class: 'mi-chips', dataset: { search: 'channels targets' } });
  for (const c of CHANNELS) {
    const on = c.id in l.targets;
    const b = h('button', { class: 'mi-chip' + (on ? ' on' : ''), 'aria-pressed': String(on) }, h('i'), c.label);
    b.addEventListener('click', () => { if (on) delete l.targets[c.id]; else l.targets[c.id] = 0.5; commit({ structural: true }); });
    chips.append(b);
  }
  const rows = Object.keys(l.targets).map((ch) => paramRow(l, 'amount.' + ch, { ...AMOUNT, label: `${CHANNELS.find((c) => c.id === ch).label} amount` }));
  return section('targets', { icon: 'material', title: 'Channel targets', tag: (n => `${n} CHANNEL${n === 1 ? '' : 'S'}`)(Object.keys(l.targets).length) },
    chips, rows.length ? null : hint('Pick at least one channel for this field to write into.'), ...rows);
}

function maskSection(l) {
  const keys = ['progress', 'softness'].concat(l.mode === 'impact' ? ['radius'] : []);
  const origin = l.mode === 'impact' ? h('div', { class: 'mi-field', dataset: { search: 'impact origin xyz' } }, h('label', {}, 'Impact origin · asset local'),
    vecRow({ label: 'XYZ', value: [...l.origin], step: 0.01, digits: 2, onInput: (v) => { l.origin = v; refresh(); clearTimeout(maskSection.t); maskSection.t = setTimeout(() => commit(), 300); }, onReset: () => [0, 0.4, 0.6] })) : null;
  return section('mask', { icon: 'mask', title: 'Mask', tag: MASK_MODES.find((m) => m.id === l.mode).label.toUpperCase(), accent: LAYER_TYPES.mask.colour },
    picker(MASK_MODES, l.mode, MASK_ART, (v) => { l.mode = v; commit({ structural: true }); }, 'Mask mode'),
    switchRow('Invert mask', l.invert, (v) => { l.invert = v; commit({ structural: true }); }),
    ...keys.map((k) => paramRow(l, k, SPECS.mask[k])), origin,
    hint('Masks are asset-agnostic: they read normalised local bounds, so the same mask works on a shaderball, a building or the ControlVehicle.'));
}
function seamSection(l) {
  return section('seam', { icon: 'heat', title: 'Leading-edge seam', tag: l.seam ? 'ON' : 'OFF' },
    switchRow('Seam enabled', l.seam, (v) => { l.seam = v; commit({ structural: true }); }, 'Glowing rim along the moving mask edge'),
    ...(l.seam ? [paramRow(l, 'seamWidth', SPECS.mask.seamWidth), paramRow(l, 'seamGain', SPECS.mask.seamGain), colourRow('Seam colour', R().slots.seam, (v, done) => { R().slots.seam = v; done ? commit() : refresh(); }, { tag: 'SLOT' })] : []));
}

function transitionSection(l) {
  const side = (key, tag) => {
    const f = FINISHES[l[key]];
    const s = select(Object.entries(FINISHES).map(([k, x]) => [k, x.label]), l[key], (v) => { l[key] = v; commit({ structural: true }); }, `Finish ${tag}`);
    return h('div', { class: 'mi-side' }, h('span', { class: 'mi-side-dot', style: { background: f.colour } }), h('small', {}, `FINISH ${tag}`), h('b', {}, f.label), h('span', { class: 'mi-side-meta' }, `R ${f.roughness.toFixed(2)} · M ${f.metalness.toFixed(2)}`), s);
  };
  const swap = h('button', { class: 'mi-icon-btn mi-swap', title: 'Swap A and B', 'aria-label': 'Swap A and B', dataset: { icon: 'transition', size: '14' } });
  swap.addEventListener('click', () => { [l.a, l.b] = [l.b, l.a]; commit({ structural: true }); });
  return section('transition', { icon: 'transition', title: 'Transition', tag: `${FINISHES[l.a].label.split(' ').pop().toUpperCase()} → ${FINISHES[l.b].label.split(' ').pop().toUpperCase()}`, accent: LAYER_TYPES.transition.colour },
    h('div', { class: 'mi-sides', dataset: { search: 'finish a b' } }, side('a', 'A'), swap, side('b', 'B')),
    field('Seam path', segmented([['sweep', 'Sweep'], ['radial', 'Radial'], ['noise', 'Noise']], l.direction, (v) => { l.direction = v; commit({ structural: true }); }, { label: 'Seam path' })),
    ...Object.keys(SPECS.transition).map((k) => paramRow(l, k, SPECS.transition[k])));
}

function slotSection() {
  const grid = h('div', { class: 'mi-slots' });
  for (const [k, label] of COLOUR_SLOTS) {
    const input = h('input', { type: 'color', value: R().slots[k], 'aria-label': `${label} colour slot` });
    const sw = h('span', { class: 'mi-slot-swatch', style: { background: R().slots[k] } }), code = h('code', {}, R().slots[k]);
    input.addEventListener('input', () => { R().slots[k] = input.value; sw.style.background = input.value; code.textContent = input.value; refresh(); });
    input.addEventListener('change', () => commit());
    grid.append(h('label', { class: 'mi-slot', dataset: { search: label.toLowerCase() + ' colour slot' } }, sw, h('small', {}, label), code, input));
  }
  return section('slots', { icon: 'swatch', title: 'Colour slots', tag: 'LINEAR REC.709' }, grid, hint('Shared by every layer. Slots are live uniforms, so recolouring never recompiles.'));
}

function driverCurve(mode) {
  const pts = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60 * 4; let v;
    if (mode === 'clock') v = (t * 0.8) % 1; else if (mode === 'pingpong') v = 0.5 - 0.5 * Math.cos(t * Math.PI * 0.8);
    else if (mode === 'timeline') v = t < 0.6 ? 0 : t > 3.2 ? 1 : (1 - Math.cos(((t - 0.6) / 2.6) * Math.PI)) / 2;
    else if (mode === 'impact') { const a = t % 2; v = Math.exp(-a * 2.6); } else if (mode === 'weather') v = 0.45 + 0.3 * Math.sin(t * 0.9) + 0.12 * Math.sin(t * 3.1);
    else v = Math.floor(t * 2.2) % 3 / 2;
    pts.push(`${(i / 60 * 100).toFixed(1)},${(22 - v * 18).toFixed(1)}`);
  }
  return `<svg viewBox="0 0 100 24" preserveAspectRatio="none" width="100%" height="24"><polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>`;
}
function driverSection() {
  const entries = Object.entries(R().drivers);
  const list = entries.map(([dk, d]) => {
    const [lid, ...rest] = dk.split('.'), key = rest.join('.'), l = R().layers.find((x) => x.id === lid);
    if (!l) return null;
    const spec = liveParams(l).find((x) => x.key === key)?.spec || SPECS[l.type][key] || { label: key, min: 0, max: 1, step: 0.01, digits: 2 };
    const mode = DRIVERS.find((x) => x.id === d.mode);
    const modeBtn = h('button', { class: 'mi-drv on' }, h('span', { dataset: { icon: mode.icon, size: '11' } }), mode.label);
    modeBtn.addEventListener('click', (e) => { e.stopPropagation(); driverMenu(l, key, spec, modeBtn.getBoundingClientRect()); });
    const speed = numberBox(d.speed, { min: 0, max: 8, step: 0.01, digits: 2 }, (v) => { d.speed = v; commit(); }, `${spec.label} driver speed`);
    const unlink = h('button', { class: 'mi-icon-btn', title: 'Unlink — back to a plain slider', 'aria-label': `Unlink ${spec.label}`, dataset: { icon: 'close', size: '12' } });
    unlink.addEventListener('click', () => { setVal(l, key, Math.min(spec.max, Math.max(spec.min, (d.min + d.max) / 2))); delete R().drivers[dk]; commit({ redraw: true }); });
    const go = h('button', { class: 'mi-link-btn', title: 'Inspect this layer' }, l.name);
    go.addEventListener('click', () => { S.active = R().layers.indexOf(l); render(); });
    return h('div', { class: 'mi-driver', style: { '--tc': LAYER_TYPES[l.type].colour }, dataset: { search: `${spec.label} ${l.name} ${mode.label}`.toLowerCase() } },
      h('div', { class: 'mi-driver-top' }, h('div', {}, h('b', {}, spec.label), go), modeBtn, unlink),
      h('div', { class: 'mi-curve', html: driverCurve(d.mode) }),
      h('div', { class: 'mi-driver-meta' }, h('span', {}, 'Speed'), speed, h('span', { class: 'mi-unit' }, '×'), h('span', { class: 'mi-range' }, `${fmt(d.min, spec.digits)} → ${fmt(d.max, spec.digits)} ${spec.unit || ''}`)));
  }).filter(Boolean);
  return section('drivers', { icon: 'clock', title: 'Live drivers', tag: `${list.length} LINKED` },
    ...(list.length ? list : [hint('Nothing is driven yet. Use the link button on any slider to drive it from the clock, an impact, the weather or a particle system.')]),
    hint('Drivers write into the uniform block every frame — no scripting, no recompile.'));
}

function budgetSection() {
  const b = blockLayout(R());
  const bar = h('div', { class: 'mi-budget-bar' + (b.over ? ' over' : '') });
  for (const r of b.rows) bar.append(h('i', { style: { width: (r.bytes / BLOCK_BYTES) * 100 + '%', background: r.colour }, title: `${r.label} · ${r.bytes} B` }));
  const rows = b.rows.map((r) => h('div', { class: 'mi-budget-row', dataset: { search: r.label.toLowerCase() } }, h('span', { class: 'mi-dot', style: { background: r.colour } }), h('span', {}, r.label), h('small', {}, r.params ? `${r.params} params` : ''), h('code', {}, `${r.bytes} B`)));
  return section('budget', { icon: 'budget', title: 'Parameter block', tag: `${b.used} / ${BLOCK_BYTES} B` },
    bar, h('div', { class: 'mi-budget-legend' }, h('span', {}, b.over ? `${b.used - BLOCK_BYTES} B over: params past the block need a second buffer` : `${b.free} B free`), h('em', {}, 'STD140 · 16 B ROWS')),
    ...rows);
}

function outputSection() {
  const o = R().output;
  const outChannels = [['colour', 'Colour'], ['roughness', 'Roughness'], ['metalness', 'Metalness'], ['normal', 'Normal'], ['height', 'Height'], ['ao', 'AO'], ['opacity', 'Opacity'], ['glow', 'Glow']];
  const chips = h('div', { class: 'mi-chips', dataset: { search: 'snapshot channels' } });
  for (const [k, label] of outChannels) {
    const on = o.channels.includes(k);
    const b = h('button', { class: 'mi-chip' + (on ? ' on' : ''), 'aria-pressed': String(on) }, h('i'), label);
    b.addEventListener('click', () => { o.channels = on ? o.channels.filter((x) => x !== k) : [...o.channels, k]; commit({ redraw: true }); });
    chips.append(b);
  }
  const bytes = o.channels.length * o.res * o.res * 2; // 16-bit per channel estimate
  const snap = h('button', { class: 'mi-wide' }, h('span', { dataset: { icon: 'snapshot', size: '14' } }), 'Snapshot static channels');
  snap.addEventListener('click', () => toast(`Snapshot at t = ${o.time.toFixed(1)} s · ${o.channels.length} channels · ${o.res}² · ${(bytes / 1048576).toFixed(0)} MiB (simulated)`));
  const assign = h('button', { class: 'mi-wide' }, h('span', { dataset: { icon: 'folder', size: '14' } }), 'Assign to Content Browser');
  assign.addEventListener('click', () => toast(`${R().name} queued for the Content Browser · it arrives with the browser pass`));
  return section('output', { icon: 'snapshot', title: 'Snapshot & assign', tag: 'STATIC BAKE' },
    field('Resolution', segmented([[512, '512'], [1024, '1K'], [2048, '2K'], [4096, '4K']], o.res, (v) => { o.res = v; commit({ redraw: true }); }, { label: 'Snapshot resolution' })),
    paramRow({ id: 'output', p: o, opacity: 1 }, 'time', { form: 'scalar', label: 'At time', min: 0, max: 10, step: 0.1, unit: 's', digits: 1 }, { drivable: false }),
    field('Channels', chips, { search: 'channels' }),
    h('div', { class: 'mi-estimate', dataset: { search: 'size estimate' } }, h('span', {}, 'Estimated size'), h('code', {}, `${(bytes / 1048576).toFixed(0)} MiB · R16`)),
    h('div', { class: 'mi-btns' }, snap, assign),
    hint('Snapshots freeze the dynamic material for LODs and export. The live material is untouched.'));
}

// ---------------------------------------------------------------------------------------------- chrome
function save() {
  saved[R().id] = R(); localStorage.setItem(STORE, JSON.stringify(saved));
  S.savedJson = JSON.stringify(R()); refresh(); toast(`${R().name} saved`);
}
function bind() {
  const pick = $('MatPicker');
  const groups = {};
  library.forEach((m) => { (groups[m.group] ||= h('optgroup', { label: m.group })).append(h('option', { value: m.id }, m.name)); });
  Object.values(groups).forEach((g) => pick.append(g));
  pick.addEventListener('change', () => {
    if (dirty() && !confirm(`Discard unsaved changes to ${R().name}?`)) { pick.value = R().id; return; }
    load(pick.value);
  });
  $('MatSave').addEventListener('click', save);
  $('MatRevert').addEventListener('click', () => { if (!dirty()) return; S.undo.push(S.last); restore(S.savedJson); toast('Reverted to the saved material'); });
  $('MatUndo').addEventListener('click', undo);
  $('MatExport').addEventListener('click', () => {
    const b = blockLayout(R());
    download(`${R().id}.material.json`, JSON.stringify({ format: 'frontier.material.v1', variant: variant(), block: { bytes: b.used, rows: b.rows.map((r) => ({ label: r.label, bytes: r.bytes })) }, recipe: R() }, null, 2), 'application/json');
  });
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase(), typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); return; }
    if (typing) return;
    if (e.key === '/') { e.preventDefault(); $('MatSearch')?.focus(); }
    else if (e.key === '[' || e.key === ']') { S.active = Math.max(0, Math.min(R().layers.length - 1, S.active + (e.key === ']' ? 1 : -1))); render(); }
  });
  addEventListener('beforeunload', (e) => { if (dirty()) e.preventDefault(); });
}

hydrate(document);
bind();
load(params.get('material') || 'hex-barrier');
if (params.get('search')) { S.search = params.get('search'); render(); }
