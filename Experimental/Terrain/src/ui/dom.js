import { icon } from './icons.js';

// h('div.cls#id', {attrs, on:{click}}, ...children)
export function h(sel, attrs, ...kids) {
  const m = sel.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) for (const part of m[2].match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

export function ic(name, size = 16, color) {
  const t = document.createElement('template');
  t.innerHTML = icon(name, size, 'ic');
  const el = t.content.firstElementChild;
  if (color) el.style.color = color;
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

let toastRoot;
export function toast(msg, kind = 'info', ms = 2600) {
  toastRoot ||= document.querySelector('.toasts') || document.body.appendChild(h('div.toasts'));
  const t = h('div.toast' + (kind === 'err' ? '.err' : ''), ic(kind === 'err' ? 'triangle-alert' : kind === 'ok' ? 'check' : 'info', 14), msg);
  toastRoot.append(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, ms);
}

// Popup menu anchored to an element. items: [{label, icon, right, on, action} | {group} | {sep:true}]
let openMenu = null;
export function popMenu(anchor, items, opts = {}) {
  closeMenu();
  const m = h('div.menu-pop');
  for (const it of items) {
    if (it.sep) { m.append(h('div.sep')); continue; }
    if (it.group) { m.append(h('div.grp', it.group)); continue; }
    const b = h('button.it' + (it.on ? '.on' : ''), it.icon ? ic(it.icon, 14) : null, h('span', it.label), it.right ? h('span.r', it.right) : null);
    b.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); it.action?.(); });
    m.append(b);
  }
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let x = opts.alignRight ? r.right - mw : r.left;
  let y = r.bottom + 6;
  if (y + mh > window.innerHeight - 8) y = Math.max(8, r.top - mh - 6);
  x = Math.max(8, Math.min(window.innerWidth - mw - 8, x));
  m.style.left = x + 'px'; m.style.top = y + 'px';
  openMenu = m;
  setTimeout(() => window.addEventListener('pointerdown', onDoc, true), 0);
  return m;
}
function onDoc(e) { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }
export function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; window.removeEventListener('pointerdown', onDoc, true); } }

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
