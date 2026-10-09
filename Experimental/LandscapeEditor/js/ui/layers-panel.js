// Left dock: the layer stack. Texture layers sit above the height stack, and each stack lists its top layer
// first, which matches evaluation order. The terrain row at the bottom selects the map settings.
import { el, fmtMetres, percentText } from './dom.js';
import { ICONS } from './icons.js';
import { LAYER_TYPES, EROSION_TYPES, layerKind } from '../terrain/layers.js';
import { PALETTES } from '../terrain/satmap.js';
import { THUMB } from '../terrain/pipeline.js';

// Reorder state is kept at module level so the drop handler on one row can see the drag started on another.
const drag = { id: null, kind: null };

export function drawThumb(canvas, rgba) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!rgba || rgba.length !== THUMB * THUMB * 4) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), THUMB, THUMB), 0, 0);
}

// Short description of a layer's type and output, shown under its name.
export function layerMeta(layer) {
  const pct = percentText(layer.opacity);
  if (layer.type === 'erosion') return 'Erosion · ' + EROSION_TYPES[layer.params.type].short + ' · ' + pct;
  if (layer.type === 'satmap') return PALETTES[layer.params.palette]?.label + ' · ' + layer.params.resolution + ' px · ' + pct;
  const def = LAYER_TYPES[layer.type];
  if (def.blend && layer.blend && layer.blend !== def.blend) return def.label + ' · ' + layer.blend + ' ' + pct;
  return def.label + ' · ' + pct;
}

// model: { project, selected, result, handlers: { select, toggle, reorder } }
export function renderLayerList(list, model) {
  const { project, selected, result, handlers } = model;
  list.replaceChildren();
  const texture = project.layers.filter((l) => layerKind(l.type) === 'texture').reverse();
  const height = project.layers.filter((l) => layerKind(l.type) === 'height').reverse();

  if (texture.length) {
    list.append(el('div', { class: 'ol-group', text: 'Texture · ' + texture.length }));
    for (const layer of texture) list.append(layerRow(layer, { selected, result, handlers }));
  }
  list.append(el('div', { class: 'ol-group', text: 'Height stack · ' + height.length }));
  if (!height.length) list.append(el('p', { class: 'empty-results', text: 'No height layers yet. Add a primitive or shape to begin.' }));
  for (const layer of height) list.append(layerRow(layer, { selected, result, handlers }));

  list.append(el('div', { class: 'ol-group', text: 'Map' }));
  const t = project.terrain;
  const cellM = t.extentM / (t.size - 1);
  list.append(el('div', {
    class: 'll-row ll-terrain' + (selected === 'terrain' ? ' is-active' : ''),
    tabindex: 0,
    role: 'option',
    'aria-selected': selected === 'terrain',
    'data-id': 'terrain',
    onClick: () => handlers.select('terrain'),
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handlers.select('terrain');
      }
    },
  },
    el('span', { class: 'll-icon', icon: ICONS.terrain }),
    el('div', { class: 'll-text' },
      el('div', { class: 'll-title', text: 'Terrain' }),
      el('div', { class: 'll-meta', text: `${t.size}² · ${(t.extentM / 1000).toFixed(1)} km · ${cellM.toFixed(0)} m cells · ${fmtMetres(t.heightM)} range` }),
    ),
  ));
}

function layerRow(layer, { selected, result, handlers }) {
  const active = selected === layer.id;
  const canvas = el('canvas', { class: 'll-thumb', width: THUMB, height: THUMB, 'aria-hidden': 'true' });
  const thumb = result?.thumbs?.[layer.id];
  if (thumb) drawThumb(canvas, thumb);
  const eye = el('button', {
    type: 'button',
    class: 'll-eye' + (layer.enabled ? ' is-on' : ''),
    'aria-pressed': layer.enabled,
    'aria-label': (layer.enabled ? 'Hide ' : 'Show ') + layer.name,
    title: layer.enabled ? 'Hide layer' : 'Show layer',
    onClick: (e) => {
      e.stopPropagation();
      handlers.toggle(layer.id);
    },
  });
  const kind = layerKind(layer.type);
  const row = el('div', {
    class: 'll-row' + (active ? ' is-active' : '') + (layer.enabled ? '' : ' is-off'),
    role: 'option',
    tabindex: 0,
    'aria-selected': active,
    'data-id': layer.id,
    draggable: true,
    onClick: () => handlers.select(layer.id),
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handlers.select(layer.id);
      }
    },
    onDragStart: (e) => {
      drag.id = layer.id;
      drag.kind = kind;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', layer.id);
      row.classList.add('is-dragging');
    },
    onDragEnd: () => clearDrag(row.parentElement),
    onDragOver: (e) => {
      if (!drag.id || drag.id === layer.id || drag.kind !== kind) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      clearDrop(row.parentElement);
      row.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-above' : 'drop-below');
    },
    onDragLeave: () => row.classList.remove('drop-above', 'drop-below'),
    onDrop: (e) => {
      if (!drag.id || drag.id === layer.id || drag.kind !== kind) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      const above = e.clientY < r.top + r.height / 2;
      const id = drag.id;
      clearDrag(row.parentElement);
      handlers.reorder(id, layer.id, above);
    },
  },
    canvas,
    el('div', { class: 'll-text' },
      el('div', { class: 'll-title', text: layer.name }),
      el('div', { class: 'll-meta', text: layerMeta(layer) }),
    ),
    eye,
  );
  return row;
}

function clearDrop(container) {
  container?.querySelectorAll('.drop-above, .drop-below').forEach((n) => n.classList.remove('drop-above', 'drop-below'));
}

function clearDrag(container) {
  clearDrop(container);
  container?.querySelectorAll('.is-dragging').forEach((n) => n.classList.remove('is-dragging'));
  drag.id = null;
  drag.kind = null;
}

// Add-layer menu: grouped by family, searchable, and each entry says what it does. The 28 primitives are
// separate types. Each one is a single algorithm, so none of them is a catch-all layer.
const ADD_SECTIONS = [
  ['Primitives · basic', ['constant']],
  ['Primitives · noise', ['perlin', 'simplex', 'value', 'wavelet', 'gabor', 'sparse']],
  ['Primitives · cells', ['voronoi1', 'voronoi2', 'voronoi3', 'voronoi4', 'crackle', 'worley', 'cellular', 'random']],
  ['Primitives · fractals', ['fbm', 'ridged', 'billow', 'swiss', 'jordan']],
  ['Primitives · patterns', ['grid', 'hex', 'brick', 'checker', 'stripes']],
  ['Primitives · waves', ['sine', 'sawtooth', 'triangle']],
  ['Shapes', ['island', 'ramp']],
  ['Geological · landforms', ['cone', 'range', 'stump', 'inselberg', 'crater', 'rift']],
  ['Erosion', ['erosion']],
  ['Shaping', ['terrace', 'smooth', 'levels']],
  ['Texture', ['satmap']],
];

const ICON_FOR = { fbm: 'noise', constant: 'base', cone: 'ridged', range: 'ridged', stump: 'terrace', inselberg: 'base', crater: 'island', rift: 'ramp' };
const iconFor = (type) => ICONS[ICON_FOR[type] || type] || ICONS[LAYER_TYPES[type].group] || ICONS.noise;

export function buildAddMenu(onPick) {
  const menu = el('div', { class: 'add-menu', role: 'menu' });
  const search = el('input', { type: 'search', class: 'add-filter', placeholder: 'Filter layers…', 'aria-label': 'Filter layers' });
  menu.append(search);
  const sections = [];
  for (const [title, types] of ADD_SECTIONS) {
    const head = el('div', { class: 'add-menu-h', text: title });
    menu.append(head);
    const items = [];
    for (const type of types) {
      const def = LAYER_TYPES[type];
      const item = el('button', {
        type: 'button',
        class: 'add-item',
        role: 'menuitem',
        'data-search': (def.label + ' ' + def.blurb).toLowerCase(),
        onClick: () => onPick(type),
      },
        el('span', { class: 'add-icon', icon: iconFor(type) }),
        el('span', { class: 'add-text' },
          el('span', { class: 'add-title', text: def.label }),
          el('span', { class: 'add-desc', text: def.blurb }),
        ),
      );
      menu.append(item);
      items.push(item);
    }
    sections.push({ head, items });
  }
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    for (const { head, items } of sections) {
      let any = false;
      for (const item of items) {
        const show = !q || item.dataset.search.includes(q);
        item.hidden = !show;
        if (show) any = true;
      }
      head.hidden = !any;
    }
  });
  return menu;
}
