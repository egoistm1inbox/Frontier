// Builders for the shared inspector (Inspector.css), used by the Material Workspace and the Fracture Editor.
// Pattern workspace look:
//   - foldable sections with an icon and a tag;
//   - label-over-control fields;
//   - number box · unit · slider rows;
//   - white switches;
//   - hero tiles.
// Every builder returns a DOM node, and `data-search` carries the words that the inspector search matches.
import { h, setFill } from './Kit.js';

export const fmt = (v, digits = 2) => (+v).toFixed(digits);

// Fold memory: a tiny wrapper over a localStorage key that holds the list of closed section ids.
export function foldMemory(key) {
  let closed = [];
  try { closed = JSON.parse(localStorage.getItem(key))?.collapsed || []; } catch { closed = []; }
  const save = () => { try { localStorage.setItem(key, JSON.stringify({ collapsed: closed })); } catch { /* storage full: folds are cosmetic */ } };
  return {
    isClosed: (id) => closed.includes(id),
    set(id, isClosed) { closed = isClosed ? [...new Set([...closed, id])] : closed.filter((x) => x !== id); save(); },
    setAll(ids, isClosed) { closed = isClosed ? [...new Set([...closed, ...ids])] : closed.filter((x) => !ids.includes(x)); save(); },
  };
}

export function section(folds, id, { icon, title, tag, accent, action }, ...body) {
  const closed = folds.isClosed(id);
  const toggle = h('button', { class: 'mi-fold', 'aria-expanded': String(!closed), 'aria-label': `${closed ? 'Expand' : 'Collapse'} ${title}`, dataset: { icon: 'chevron', size: '12' } });
  const tagNode = tag ? h('em', {}, tag) : null;
  const head = h('header', {}, h('span', { class: 'mi-section-ico', style: accent ? { color: accent } : null, dataset: { icon, size: '15' } }), h('b', {}, title), tagNode, action || null, toggle);
  const node = h('section', { class: 'mi-section' + (closed ? ' closed' : ''), dataset: { sec: id } }, head, h('div', { class: 'mi-body' }, ...body.filter(Boolean)));
  head.addEventListener('click', (e) => {
    if (e.target.closest('input,select,.mi-head-action')) return;
    const c = node.classList.toggle('closed');
    toggle.setAttribute('aria-expanded', String(!c));
    folds.set(id, c);
  });
  node.setTag = (text) => { if (tagNode) tagNode.textContent = text; };
  return node;
}

export const field = (label, control, { search } = {}) => h('div', { class: 'mi-field', dataset: { search: (search || label).toLowerCase() } }, h('label', {}, label), control);
export const sub = (text, tag) => h('div', { class: 'mi-sub' }, h('span', {}, text), tag ? h('em', {}, tag) : null);
export const hint = (text) => h('p', { class: 'mi-hint' }, text);

export function mswitch(on, onChange, label) {
  const b = h('button', { class: 'mswitch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(on), 'aria-label': label });
  b.addEventListener('click', () => { on = !on; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); onChange(on); });
  return b;
}
export function switchRow(label, on, onChange, note) {
  return h('div', { class: 'mi-switch-row', dataset: { search: label.toLowerCase() } }, h('div', {}, h('span', {}, label), note ? h('small', {}, note) : null), mswitch(on, onChange, label));
}
export function select(options, picked, onChange, label) {
  const s = h('select', { class: 'mi-select', 'aria-label': label });
  for (const [v, t] of options) s.append(h('option', { value: v, selected: v === picked ? true : null }, t));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

// Number box: drag horizontally to scrub (Shift = fine), click to type, Enter commits, Escape restores.
export function numberBox(amount, spec, onCommit, label, onScrub) {
  const input = h('input', { class: 'mi-box', type: 'text', inputmode: 'decimal', value: fmt(amount, spec.digits), 'aria-label': label });
  let drag = null;
  input.addEventListener('pointerdown', (e) => { if (document.activeElement === input) return; drag = { x: e.clientX, v: parseFloat(input.value), moved: false }; input.setPointerCapture(e.pointerId); e.preventDefault(); });
  input.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x; if (Math.abs(dx) > 2) drag.moved = true; if (!drag.moved) return;
    const span = spec.max - spec.min, v = Math.max(spec.min, Math.min(spec.max, drag.v + (dx / 220) * span * (e.shiftKey ? 0.1 : 1)));
    input.value = fmt(v, spec.digits); onScrub?.(v);
  });
  input.addEventListener('pointerup', () => { if (drag) { if (drag.moved) { amount = parseFloat(input.value); onCommit(amount); } else { input.focus(); input.select(); } } drag = null; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = fmt(amount, spec.digits); input.blur(); } });
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (!Number.isFinite(v)) { input.value = fmt(amount, spec.digits); return; }
    amount = Math.max(spec.min, Math.min(spec.max, v)); input.value = fmt(amount, spec.digits); onCommit(amount);
  });
  input.setAmount = (v) => { amount = v; if (document.activeElement !== input) input.value = fmt(v, spec.digits); };
  return input;
}

// Number box · unit · slider. `onInput(v, final)` fires while dragging (final = false) and on release or commit
// (final = true). `curve: 'log'` maps the slider logarithmically (for energies), and the box stays linear.
export function numberRow({ label, unit = '', min, max, step = 0.01, digits = 2, value, onInput, curve, note, head, search }) {
  const spec = { min, max, digits };
  const log = curve === 'log' && min > 0;
  const toSlider = (v) => (log ? (Math.log(v / min) / Math.log(max / min)) * 1000 : v);
  const fromSlider = (s) => (log ? +(min * Math.pow(max / min, s / 1000)).toFixed(digits) : +s);
  const range = h('input', { type: 'range', min: log ? 0 : min, max: log ? 1000 : max, step: log ? 1 : step, value: toSlider(value), 'aria-label': `${label} slider` });
  const box = numberBox(value, spec, (v) => { range.value = toSlider(v); setFill(range); onInput(v, true); }, label, (v) => { range.value = toSlider(v); setFill(range); onInput(v, false); });
  setFill(range);
  range.addEventListener('input', () => { setFill(range); const v = fromSlider(range.value); box.setAmount(v); onInput(v, false); });
  range.addEventListener('change', () => onInput(fromSlider(range.value), true));
  const row = h('div', { class: 'mi-row', dataset: { search: (search || label).toLowerCase() } }, h('div', { class: 'mi-row-head' }, h('label', {}, label), head || null),
    h('div', { class: 'mi-row-ctl' }, box, h('span', { class: 'mi-unit' }, unit || '—'), range), note ? h('small', { class: 'mi-row-note' }, note) : null);
  row.setAmount = (v) => { box.setAmount(v); range.value = toSlider(v); setFill(range); };
  return row;
}

// Hero tile; set `cream` for the primary one. Returns the node with a `.set(value, subtext)` updater.
export function heroTile({ label, value = '—', subtext = '', cream = false, extra = '' }) {
  const b = h('b', { html: value }), s = h('small', {}, subtext);
  const node = h('div', { class: 'mi-tile' + (cream ? ' cream' : '') + (extra ? ' ' + extra : '') }, h('small', {}, label), b, s);
  node.set = (v, t) => { b.innerHTML = v; if (t !== undefined) s.textContent = t; };
  return node;
}

// Label / value grid for read-only facts (fragment details, receipts).
export function facts(list) {
  const node = h('div', { class: 'mi-facts' });
  node.fill = (items) => { node.textContent = ''; for (const [k, v, cls] of items) node.append(h('span', {}, k), h('b', { class: cls || null, html: v })); };
  node.fill(list);
  return node;
}

// Search filtering: hide rows that do not match, keep a section whose title matches, hide empty sections.
export function applySearch(host, query) {
  const q = query.trim().toLowerCase();
  for (const sec of host.querySelectorAll('.mi-section')) {
    const titleHit = q && sec.querySelector('header b').textContent.toLowerCase().includes(q);
    let any = false;
    for (const row of sec.querySelectorAll('[data-search]')) {
      const hit = !q || titleHit || row.dataset.search.includes(q);
      row.classList.toggle('mi-miss', !hit); if (hit) any = true;
    }
    sec.classList.toggle('mi-miss', !!q && !titleHit && !any);
    if (q && (any || titleHit)) sec.classList.remove('closed');
  }
}
