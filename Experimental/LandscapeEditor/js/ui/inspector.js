// Right dock: the inspector. Structure is rebuilt when the selection or a layer's type changes. Live values
// (stats) are updated in place, so a slider under the pointer is never replaced mid-drag.
import { el, fmt, fmtMetres, fmtVolume, fmtMs, percentText } from './dom.js';
import { ICONS } from './icons.js';
import { card, rangeRow, selectRow, statTile, note, button } from './controls.js';
import {
  LAYER_TYPES, EROSION_TYPES, GROUPS, BLEND_MODES, TERRAIN_CONTROLS, VIEW_CONTROLS,
  controlsFor, paramBucket, layerKind,
} from '../terrain/layers.js';

const EROSION_OPTIONS = Object.entries(EROSION_TYPES).map(([id, t]) => [id, t.label]);
const BLEND_OPTIONS = BLEND_MODES.map((m) => [m, m]);

// m: { project, selected, result, view, handlers }
export function renderInspector(container, m) {
  container.replaceChildren();
  if (!m.selected || m.selected === 'terrain') {
    renderTerrain(container, m);
    return;
  }
  const layer = m.project.layers.find((l) => l.id === m.selected);
  if (!layer) {
    renderTerrain(container, m);
    return;
  }
  renderLayer(container, layer, m);
}

function header(eyebrow, title, blurb, actions = []) {
  return el('div', { class: 'insp-head' },
    el('div', { class: 'insp-path', text: eyebrow }),
    title,
    blurb ? el('p', { class: 'insp-sub', text: blurb }) : null,
    actions.length ? el('div', { class: 'obj-actions' }, ...actions) : null,
  );
}

function renderTerrain(container, m) {
  const t = m.project.terrain;
  const h = m.handlers;
  container.append(header(
    'Map',
    el('h2', { class: 'insp-title', text: 'Terrain' }),
    'Grid, scale and sea level. Changing the grid recomputes every layer. Viewport settings below do not.',
  ));

  const seaSpec = { key: 'sea', label: 'Sea level', min: 0, max: Math.round(t.heightM), step: 1, digits: 0, unit: 'm', help: 'Height of the water surface.' };
  const gridSpec = TERRAIN_CONTROLS[0];
  const seed = el('input', { type: 'number', class: 'num seed-input', min: 0, max: 999999, step: 1, value: t.seed, 'aria-label': 'Terrain seed' });
  seed.addEventListener('change', () => {
    const v = Math.max(0, Math.min(999999, Math.floor(+seed.value || 0)));
    seed.value = v;
    h.edit(() => { t.seed = v; }, { key: 'seed', immediate: true });
  });

  container.append(card('Grid', 'Terrain',
    selectRow(gridSpec, t.size, (v) => h.edit(() => { t.size = +v; }, { key: 'size', immediate: true })),
    rangeRow(TERRAIN_CONTROLS[1], t.extentM, {
      onInput: (v) => h.edit(() => { t.extentM = v; }, { key: 'extent' }),
      onChange: () => h.schedule(0),
    }),
    rangeRow(TERRAIN_CONTROLS[2], t.heightM, {
      onInput: (v) => h.edit(() => { t.heightM = v; }, { key: 'heightM' }),
      onChange: () => h.schedule(0),
    }),
    rangeRow(seaSpec, Math.round(t.seaLevel * t.heightM), {
      onInput: (v) => h.edit(() => { t.seaLevel = v / t.heightM; }, { key: 'sea' }),
      onChange: () => h.schedule(0),
    }),
    el('label', { class: 'row seed-row' }, el('span', { class: 'row-k', text: 'Seed' }),
      seed,
      button('', { icon: ICONS.dice, title: 'Randomise the seed', aria: 'Randomise seed', cls: 'icon-btn', onClick: () => h.randomiseSeed() }),
    ),
  ));

  const view = m.view;
  container.append(card('View', 'Viewport',
    ...VIEW_CONTROLS.map((spec) => rangeRow(spec, view[spec.key], {
      onInput: (v) => h.setView(spec.key, v),
    })),
    note('Viewport settings change the 3D view and the satmap lighting preview only. They are not part of undo history.'),
  ));

  const s = m.result?.summary;
  container.append(card('Result', 'Live',
    el('div', { class: 'stat-grid' },
      statTile('Lowest', s ? fmtMetres(s.min * t.heightM) : '–', 't-min'),
      statTile('Highest', s ? fmtMetres(s.max * t.heightM) : '–', 't-max'),
      statTile('Under water', s ? percentText(s.water) : '–', 't-water'),
      statTile('Mean slope', s ? fmt(s.meanSlope, 1) + '°' : '–', 't-slope'),
      statTile('Cells', `${t.size}²`, 't-cells'),
      statTile('Compute', m.result ? fmtMs(m.result.timing.total) : '–', 't-time'),
    ),
  ));
}

function renderLayer(container, layer, m) {
  const h = m.handlers;
  const def = LAYER_TYPES[layer.type];
  const group = GROUPS[def.group];
  const isErosion = layer.type === 'erosion';
  const isTexture = layerKind(layer.type) === 'texture';
  const eyebrow = group.label + ' · ' + (isErosion ? EROSION_TYPES[layer.params.type].short : def.label);
  const actions = [
    el('button', {
      type: 'button',
      class: 'pill-toggle' + (layer.enabled ? ' is-on' : ''),
      'aria-pressed': layer.enabled,
      title: layer.enabled ? 'Layer is active. Click to bypass it.' : 'Layer is bypassed. Click to enable it.',
      onClick: () => h.toggleEnabled(layer.id),
    }, layer.enabled ? 'Enabled' : 'Bypassed'),
    button('', { icon: ICONS.up, title: 'Move up in the stack', aria: 'Move up', cls: 'icon-btn', onClick: () => h.move(layer.id, 1) }),
    button('', { icon: ICONS.down, title: 'Move down in the stack', aria: 'Move down', cls: 'icon-btn', onClick: () => h.move(layer.id, -1) }),
    button('', { icon: ICONS.duplicate, title: 'Duplicate layer', aria: 'Duplicate layer', cls: 'icon-btn', onClick: () => h.duplicate(layer.id) }),
    button('', { icon: ICONS.reset, title: 'Reset parameters to defaults', aria: 'Reset parameters', cls: 'icon-btn', onClick: () => h.reset(layer.id) }),
    button('', { icon: ICONS.trash, title: 'Delete layer (Delete key)', aria: 'Delete layer', cls: 'icon-btn danger', onClick: () => h.remove(layer.id) }),
  ];
  const name = el('input', {
    type: 'text',
    class: 'le-name',
    value: layer.name,
    maxlength: 60,
    'aria-label': 'Layer name',
  });
  name.addEventListener('change', () => {
    const v = name.value.trim() || layer.name;
    h.rename(layer.id, v);
  });
  container.append(header(eyebrow, name, def.blurb, actions));

  // Output: blend (generators only) and opacity or strength.
  const outputRows = [];
  if (group.kind === 'height' && def.group === 'generator') {
    outputRows.push(selectRow({ key: 'blend', label: 'Blend', options: BLEND_OPTIONS, help: 'How this layer combines with the stack below it.' }, layer.blend, (v) => {
      h.edit(() => { layer.blend = v; }, { key: 'blend:' + layer.id, immediate: true });
      h.refreshInspector();
    }));
  }
  const opacityLabel = isTexture ? 'Opacity' : def.group === 'generator' ? 'Opacity' : 'Strength';
  outputRows.push(rangeRow({ key: 'opacity', label: opacityLabel, min: 0, max: 100, step: 1, digits: 0, unit: '%', help: 'Mix between the layer below and this layer.' }, layer.opacity * 100, {
    onInput: (v) => h.edit(() => { layer.opacity = v / 100; }, { key: 'op:' + layer.id }),
    onChange: () => h.schedule(0),
  }));
  container.append(card('Output', isTexture ? 'Texture' : 'Mix', ...outputRows));

  if (isErosion) {
    container.append(card('Erosion type', 'Process',
      selectRow({ key: 'type', label: 'Process', options: EROSION_OPTIONS, help: 'Each process has its own parameters. Switching keeps the values of each.' }, layer.params.type, (v) => {
        h.edit(() => { layer.params.type = v; }, { key: 'type:' + layer.id, immediate: true });
        h.refreshInspector();
      }),
      note(EROSION_TYPES[layer.params.type].blurb),
    ));
    const t = EROSION_TYPES[layer.params.type];
    const bucket = paramBucket(layer);
    const rows = controlsFor(layer).map((spec) => controlRow(layer, spec, bucket, h));
    if (layer.params.type === 'hydraulic') {
      rows.push(seedRow(layer, h));
    }
    container.append(card(t.short + ' properties', 'Parameters', ...rows));
  } else if (!isTexture && controlsFor(layer).length) {
    container.append(card(def.label, 'Parameters', ...controlsFor(layer).map((spec) => controlRow(layer, spec, layer.params, h))));
  } else if (isTexture) {
    const rows = controlsFor(layer).map((spec) => controlRow(layer, spec, layer.params, h));
    const paletteCards = rows.slice(0, 2);
    const surfaceCards = rows.slice(2, 6);
    const lightCards = rows.slice(6);
    container.append(card('Palette', 'Satmap', ...paletteCards));
    container.append(card('Surface', 'Terrain response', ...surfaceCards));
    container.append(card('Light and detail', 'Shading', ...lightCards, note('Hillshade and cavity shading use the sun bearing and elevation here. The 3D view lights the terrain with its own sun in the View card.')));
  }

  container.append(card('Result', isErosion ? 'Erosion' : 'Output', resultTiles(layer, m)));
}

function controlRow(layer, spec, bucket, h) {
  if (spec.kind === 'select') {
    return selectRow(spec, bucket[spec.key], (v) => {
      h.edit(() => { bucket[spec.key] = typeof spec.options[0][0] === 'number' ? +v : v; }, { key: 'p:' + layer.id + ':' + spec.key, immediate: true });
      h.refreshInspector();
    });
  }
  const key = 'p:' + layer.id + ':' + spec.key;
  return rangeRow(spec, bucket[spec.key], {
    onInput: (v) => h.edit(() => { bucket[spec.key] = v; }, { key }),
    onChange: () => h.schedule(0),
  });
}

function seedRow(layer, h) {
  const input = el('input', { type: 'number', class: 'num', min: 0, max: 999, step: 1, value: layer.params.seed, 'aria-label': 'Droplet seed' });
  input.addEventListener('change', () => {
    const v = Math.max(0, Math.min(999, Math.floor(+input.value || 0)));
    input.value = v;
    h.edit(() => { layer.params.seed = v; }, { key: 'seed:' + layer.id, immediate: true });
  });
  return el('label', { class: 'row seed-row', title: 'Changes which droplets are released.' },
    el('span', { class: 'row-k', text: 'Droplet seed' }),
    input,
    el('em', { class: 'unit', text: '' }),
  );
}

function resultTiles(layer, m) {
  const s = m.result?.stats?.[layer.id];
  const hm = m.project.terrain.heightM;
  if (layer.type === 'erosion') {
    return el('div', { class: 'stat-grid' },
      statTile('Removed', s ? fmtVolume(s.removedM3) : '–', 'removed:' + layer.id),
      statTile('Added', s ? fmtVolume(s.addedM3) : '–', 'added:' + layer.id),
      statTile('Deepest cut', s ? fmtMetres(s.maxCutM) : '–', 'maxcut:' + layer.id),
      statTile('Compute', m.result ? fmtMs(m.result.timing.layers[layer.id]) : '–', 'ms:' + layer.id),
    );
  }
  if (layer.type === 'satmap') {
    return el('div', { class: 'stat-grid' },
      statTile('Resolution', layer.params.resolution + ' px', null),
      statTile('Compute', m.result ? fmtMs(m.result.timing.layers[layer.id]) : '–', 'ms:' + layer.id),
    );
  }
  return el('div', { class: 'stat-grid' },
    statTile('Lowest', s ? fmtMetres(s.min * hm) : '–', 'min:' + layer.id),
    statTile('Highest', s ? fmtMetres(s.max * hm) : '–', 'max:' + layer.id),
    statTile('Mean', s ? fmtMetres(s.mean * hm) : '–', 'mean:' + layer.id),
    statTile('Compute', m.result ? fmtMs(m.result.timing.layers[layer.id]) : '–', 'ms:' + layer.id),
  );
}

// Writes the live numbers into the existing stat elements, so no control is rebuilt.
export function updateInspectorStats(container, m) {
  const r = m.result;
  const set = (key, text) => {
    const node = container.querySelector(`[data-stat="${CSS.escape(key)}"]`);
    if (node && node.textContent !== text) node.textContent = text;
  };
  if (!r) return;
  const hm = m.project.terrain.heightM;
  if (!m.selected || m.selected === 'terrain') {
    const s = r.summary;
    set('t-min', fmtMetres(s.min * hm));
    set('t-max', fmtMetres(s.max * hm));
    set('t-water', percentText(s.water));
    set('t-slope', fmt(s.meanSlope, 1) + '°');
    set('t-time', fmtMs(r.timing.total));
    return;
  }
  const layer = m.project.layers.find((l) => l.id === m.selected);
  if (!layer) return;
  const s = r.stats?.[layer.id];
  set('ms:' + layer.id, fmtMs(r.timing.layers[layer.id]));
  if (layer.type === 'erosion' && s) {
    set('removed:' + layer.id, fmtVolume(s.removedM3));
    set('added:' + layer.id, fmtVolume(s.addedM3));
    set('maxcut:' + layer.id, fmtMetres(s.maxCutM));
  } else if (s && layer.type !== 'satmap') {
    set('min:' + layer.id, fmtMetres(s.min * hm));
    set('max:' + layer.id, fmtMetres(s.max * hm));
    set('mean:' + layer.id, fmtMetres(s.mean * hm));
  }
}

