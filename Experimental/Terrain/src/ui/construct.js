// "Construct" modal for adding layers (after the Frontier editor's Shift+A menu).
import { h, ic } from './dom.js';
import { TERRAIN_TYPES, TERRAIN_CATEGORIES } from '../terrain/layer-types.js';
import { TEXTURE_TYPES, TEXTURE_CATEGORIES } from '../texture/layer-types.js';

export function openConstruct(kind, onPick) {
  const isT = kind === 'terrain';
  const types = isT ? TERRAIN_TYPES : TEXTURE_TYPES;
  const cats = isT ? TERRAIN_CATEGORIES : TEXTURE_CATEGORIES;
  let cat = 'All', q = '';
  const close = () => { bg.remove(); window.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  window.addEventListener('keydown', onKey, true);
  const grid = h('div.cgrid');
  const catList = h('div.cats');
  const search = h('input', { placeholder: isT ? 'Search primitives, modifiers, erosion…' : 'Search materials…', spellcheck: false });
  search.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { const first = grid.querySelector('.ccard'); first?.click(); }
    if (e.key === 'Escape') close();
  });
  search.addEventListener('input', () => { q = search.value.toLowerCase(); paint(); });
  const entries = Object.entries(types);
  const count = (c) => entries.filter(([, t]) => c === 'All' || t.category === c).length;
  const paintCats = () => {
    catList.innerHTML = '';
    for (const c of [{ id: 'All', icon: 'layout-grid', note: '' }, ...cats]) {
      const b = h('button.cat' + (cat === c.id ? '.on' : ''), ic(c.icon, 15), c.id, h('span.c', count(c.id)));
      b.addEventListener('click', () => { cat = c.id; paintCats(); paint(); });
      catList.append(b);
    }
  };
  const paint = () => {
    grid.innerHTML = '';
    for (const [key, t] of entries) {
      if (cat !== 'All' && t.category !== cat) continue;
      if (q && !(t.label + ' ' + t.blurb + ' ' + t.category).toLowerCase().includes(q)) continue;
      const color = isT ? t.color : t.swatch;
      const card = h('button.ccard', h('div.ci', ic(t.icon, 17, color)), h('div.cn', t.label), h('div.cs', t.blurb), h('span.ca', ic('arrow-up-right', 14)),
        !isT ? h('span.swb', { style: { background: t.swatch } }) : null);
      card.addEventListener('click', () => { close(); onPick(key); });
      grid.append(card);
    }
    if (!grid.children.length) grid.append(h('div.empty', 'Nothing matches “' + q + '”.'));
  };
  const xb = h('button.x', ic('x', 16));
  xb.addEventListener('click', close);
  const modal = h('div.modal',
    h('div.modal-h', h('div.it', ic(isT ? 'mountain' : 'palette', 19)), h('div', h('div.tt', 'Construct'), h('div.st', isT ? 'Add a terrain layer above the selection' : 'Add a material above the selection')),
      h('span.tag', 'FRONTIER / TERRAIN'), xb),
    h('div.steps', h('span.on', h('span.n', '01'), isT ? 'Layer type' : 'Material'), ic('arrow-right', 12), h('span', h('span.n', '02'), 'Properties')),
    h('div.modal-body', catList, h('div.grid-wrap', h('div.search', ic('search', 14), search), grid)),
    h('div.modal-f', h('span', isT ? 'Layers evaluate bottom → top. Erosion layers simulate on everything below them.' : 'Materials composite bottom → top using their placement rules.'), h('span', 'Esc to close · Enter to add first match')));
  const bg = h('div.modal-bg', modal);
  bg.addEventListener('pointerdown', (e) => { if (e.target === bg) close(); });
  document.body.append(bg);
  paintCats(); paint();
  setTimeout(() => search.focus(), 30);
}
