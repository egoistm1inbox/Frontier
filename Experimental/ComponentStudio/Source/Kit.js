// Inspector building blocks shared by the Component Viewer Details panel and the Geometry Compile Import Inspector.
// All return DOM nodes; values flow out through callbacks so each host owns its own state.
import { hydrateIcons } from './Icons.js';

export const $ = (id) => document.getElementById(id);
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c.nodeType ? c : document.createTextNode(String(c)));
  return node;
}
export const ico = (name, size = 16, accent) => h('span', { class: 'glyph', dataset: { icon: name, size: String(size), ...(accent ? { accent } : {}) } });

export function heading(text, tag) { return h('h4', {}, text, tag ? h('em', {}, tag) : null); }
export function panel(...children) { return h('div', { class: 'panel' }, ...children); }
export function cardHead(text, tag) { return h('div', { class: 'card-head' }, text, tag ? h('em', {}, tag) : null); }
export function note(text) { return h('p', {}, text); }

export function setFill(range) {
  const min = +range.min, max = +range.max, v = +range.value;
  range.style.setProperty('--fill', ((v - min) / (max - min || 1)) * 100 + '%');
}

// Pill slider with a label and live output.
export function slider({ label, min, max, step = 0.01, value, format = (v) => v, onInput, onChange, hint, cream = false }) {
  const out = h('output', {}, format(value));
  const range = h('input', { type: 'range', min, max, step, value, class: cream ? 'cream' : null, 'aria-label': label });
  setFill(range);
  range.addEventListener('input', () => { setFill(range); out.textContent = format(+range.value); onInput?.(+range.value); });
  range.addEventListener('change', () => onChange?.(+range.value));
  return h('div', { class: 'field' }, h('label', {}, label), out, range, hint ? h('small', {}, hint) : null);
}

// Vehicle Lab style property: label, number + unit pill, slider, min/max meta.
export function prop({ label, min, max, step, value, unit = '', digits = 2, onInput }) {
  const number = h('input', { type: 'number', step, value: (+value).toFixed(digits), 'aria-label': label });
  const range = h('input', { type: 'range', min, max, step, value, class: 'cream', 'aria-label': label + ' slider' });
  setFill(range);
  const commit = (v, from) => {
    if (!Number.isFinite(v)) return;
    v = Math.max(min, Math.min(max, v));
    if (from !== 'range') range.value = v;
    if (from !== 'number') number.value = v.toFixed(digits);
    setFill(range); onInput?.(v);
  };
  range.addEventListener('input', () => commit(+range.value, 'range'));
  number.addEventListener('change', () => commit(+number.value, 'number'));
  return h('div', { class: 'prop' },
    h('div', { class: 'prop-line' }, h('label', {}, label), h('span', { class: 'value-pill' }, number, h('span', {}, unit || '—'))),
    range,
    h('div', { class: 'prop-meta' }, h('span', {}, `${(+min).toFixed(digits)} ${unit}`), h('span', {}, `${(+max).toFixed(digits)} ${unit}`)));
}

export function segmented(options, value, onPick, { full = true, label } = {}) {
  const group = h('div', { class: 'segmented' + (full ? ' full' : ''), role: 'radiogroup', 'aria-label': label || null });
  for (const [id, text] of options) {
    const b = h('button', { type: 'button', class: id === value ? 'active' : null, 'aria-pressed': String(id === value) }, text);
    b.addEventListener('click', () => {
      for (const o of group.children) { o.classList.toggle('active', o === b); o.setAttribute('aria-pressed', String(o === b)); }
      onPick(id);
    });
    group.append(b);
  }
  return group;
}

export function labelled(label, control) { return h('div', { class: 'field' }, h('label', {}, label), control); }

export function tile({ icon, label, on, onToggle, title }) {
  const state = h('small', {}, on ? 'ON' : 'OFF');
  const b = h('button', { type: 'button', class: 'tile' + (on ? ' on' : ''), title: title || label }, h('span', { class: 'ico', dataset: { icon, size: '16' } }), h('b', {}, label), state);
  b.addEventListener('click', () => {
    on = !on; b.classList.toggle('on', on); state.textContent = on ? 'ON' : 'OFF'; onToggle(on);
  });
  return b;
}

// Location / Rotation / Scale row with draggable axis fields.
export function vecRow({ label, value, step = 0.01, digits = 3, onInput, onReset }) {
  const row = h('div', { class: 'vec-row' }, h('label', {}, label));
  const inputs = [];
  ['x', 'y', 'z'].forEach((axis, k) => {
    const input = h('input', { type: 'text', inputmode: 'decimal', value: (+value[k]).toFixed(digits), 'aria-label': `${label} ${axis.toUpperCase()}` });
    let drag = null;
    input.addEventListener('pointerdown', (e) => { if (document.activeElement === input) return; drag = { x: e.clientX, v: +input.value, moved: false }; input.setPointerCapture(e.pointerId); e.preventDefault(); });
    input.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 2) drag.moved = true;
      if (!drag.moved) return;
      const v = drag.v + dx * step * (e.shiftKey ? 10 : 1);
      input.value = v.toFixed(digits); value[k] = v; onInput([...value]);
    });
    input.addEventListener('pointerup', () => { if (drag && !drag.moved) { input.focus(); input.select(); } drag = null; });
    input.addEventListener('change', () => { const v = parseFloat(input.value); if (Number.isFinite(v)) { value[k] = v; onInput([...value]); } input.value = (+value[k]).toFixed(digits); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    inputs.push(input);
    row.append(h('span', { class: `axis ${axis}` }, h('i'), input));
  });
  const reset = h('button', { type: 'button', class: 'reset-mini', title: 'Reset', 'aria-label': `Reset ${label}`, dataset: { icon: 'reset', size: '12' } });
  reset.addEventListener('click', () => { const v = onReset(); v.forEach((x, k) => { value[k] = x; inputs[k].value = (+x).toFixed(digits); }); onInput([...value]); });
  row.append(reset);
  return row;
}

export function rows(pairs) {
  const node = h('div', { class: 'rows' });
  for (const [k, v] of pairs) node.append(h('span', {}, k), h('b', { title: String(v) }, v));
  return node;
}

let toastTimer = 0;
export function toast(text) {
  const t = $('Toast');
  t.textContent = text; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

export function hydrate(root) { hydrateIcons(root); }

export function download(name, content, type) {
  const url = typeof content === 'string' && content.startsWith('data:') ? content : URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  if (!url.startsWith('data:')) setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Drawer handles: one open drawer per dock.
export function bindDrawers(root) {
  const handles = [...root.querySelectorAll('.drawer-handle')];
  const close = () => { handles.forEach((x) => { x.classList.remove('active'); $(x.dataset.drawer).classList.remove('open'); }); };
  handles.forEach((b) => b.addEventListener('click', () => {
    const d = $(b.dataset.drawer), open = !d.classList.contains('open');
    close();
    if (open) { d.classList.add('open'); b.classList.add('active'); d.dispatchEvent(new Event('drawer-open')); }
  }));
  root.querySelectorAll('[data-close-drawer]').forEach((b) => b.addEventListener('click', close));
  return { close, open: (id) => { close(); $(id).classList.add('open'); handles.find((x) => x.dataset.drawer === id)?.classList.add('active'); $(id).dispatchEvent(new Event('drawer-open')); } };
}

// Project Zero popup menu (workspace tab menu, outliner context menu). Items: { heading } | 'sep' |
// { label, icon, hint, note, disabled, accent, onClick }. `at` is a DOMRect (opens below it) or { x, y }.
let openMenu = null;
export function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }
export function popupMenu(at, items, { width = 248, label = 'Menu' } = {}) {
  closeMenu();
  const menu = h('div', { class: 'popup-menu', role: 'menu', 'aria-label': label, style: { width: width + 'px' } });
  for (const it of items) {
    if (!it) continue;
    if (it === 'sep') { menu.append(h('hr')); continue; }
    if (it.heading) { menu.append(h('label', {}, it.heading)); continue; }
    const b = h('button', { role: 'menuitem', class: it.accent ? 'accent-' + it.accent : null, disabled: it.disabled ? true : null, title: it.title || null },
      it.icon ? h('span', { class: 'glyph', dataset: { icon: it.icon, size: '14' } }) : h('span', { class: 'glyph' }),
      h('span', { class: 'label' }, it.label, it.note ? h('small', {}, it.note) : null),
      it.hint ? h('kbd', {}, it.hint) : null);
    b.addEventListener('click', () => { closeMenu(); it.onClick?.(); });
    menu.append(b);
  }
  document.body.append(menu);
  hydrateIcons(menu);
  const r = menu.getBoundingClientRect();
  const below = 'bottom' in at; // DOMRect anchors open below the element; points open at the cursor
  let x = below ? at.left : at.x, y = below ? at.bottom + 6 : at.y;
  if (y + r.height > innerHeight - 8) y = Math.max(8, (below ? at.top : y) - r.height - 6);
  menu.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x)) + 'px';
  menu.style.top = y + 'px';
  openMenu = menu;
  menu.querySelector('button:not([disabled])')?.focus({ preventScroll: true });
  return menu;
}
document.addEventListener('pointerdown', (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }, true);
document.addEventListener('keydown', (e) => {
  if (!openMenu) return;
  if (e.key === 'Escape') { e.stopImmediatePropagation(); closeMenu(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const list = [...openMenu.querySelectorAll('button:not([disabled])')], i = list.indexOf(document.activeElement);
    list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
  }
}, true);
addEventListener('resize', closeMenu);
addEventListener('blur', closeMenu);
