// RoadForge — editor shell: layer stack (right) + inspector (right).
// No node graph: every parameter is a toggle, a slider or a segmented choice.

import { icon } from './icons.js';
import { LAYER_TYPES, BLEND, makeLayer, packStack, STACK_ORDER } from '../texture/stack.js';
import { ROAD_CLASSES, CLASS_ORDER } from '../road/network.js';
import { MATERIALS } from '../road/materials.js';

const CLASS_ICON = {
  highway: 'road', arterial: 'road', street: 'road', residential: 'road',
  alley: 'road', ramp: 'bridge', rail: 'train',
};

/* ------------------------------------------------------------- controls */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function sliderHTML(c, val) {
  const pct = ((val - c.min) / (c.max - c.min)) * 100;
  const shown = c.fmt ? c.fmt(val) : (c.step && c.step < 1 ? val.toFixed(c.step < 0.05 ? 3 : 2) : Math.round(val));
  return `<div class="field">
    <div class="control-line"><span>${esc(c.label)}</span><strong>${esc(shown)}${c.unit ? ` <em>${esc(c.unit)}</em>` : ''}</strong></div>
    <input type="range" min="${c.min}" max="${c.max}" step="${c.step ?? 0.01}" value="${val}"
      style="--progress:${pct}%" data-path="${esc(c.path)}" data-live="${c.live === false ? 0 : 1}" />
    ${c.lo || c.hi ? `<div class="range-labels"><span>${esc(c.lo || '')}</span><span>${esc(c.hi || '')}</span></div>` : ''}
  </div>`;
}

function toggleHTML(c, val) {
  return `<div class="toggle-row"><span>${esc(c.label)}</span>
    <button class="toggle ${val ? 'on' : ''}" data-path="${esc(c.path)}" data-type="toggle"><i></i></button></div>`;
}

function segHTML(c, val) {
  return `<div class="field"><div class="control-line"><span>${esc(c.label)}</span></div>
    <div class="seg">${c.options.map(([v, l]) => `<button data-path="${esc(c.path)}" data-type="seg" data-value="${esc(v)}" class="${String(val) === String(v) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div></div>`;
}

function selectHTML(c, val) {
  return `<div class="field"><div class="control-line"><span>${esc(c.label)}</span></div>
    <select class="sel-input" data-path="${esc(c.path)}" data-type="select">
      ${c.options.map(([v, l]) => `<option value="${esc(v)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}
    </select></div>`;
}

function colorHTML(c, val) {
  const hex = (rgb) => '#' + rgb.map((x) => Math.round(Math.min(1, Math.max(0, x)) ** (1 / 2.2) * 255).toString(16).padStart(2, '0')).join('');
  return `<div class="field"><div class="control-line"><span>${esc(c.label)}</span><em>${esc(hex(val))}</em></div>
    <div class="swatches">${c.palette.map((p, i) => `<button data-path="${esc(c.path)}" data-type="color" data-value="${i}" class="${hex(p) === hex(val) ? 'on' : ''}" style="background:${hex(p)}"></button>`).join('')}</div></div>`;
}

function card(title, iconName, body, extra = '') {
  return `<section class="card"${extra}>
    <div class="card-heading"><span><span class="ic">${icon(iconName, 15)}</span>${esc(title)}</span></div>
    ${body}</section>`;
}

function controlsHTML(list, get) {
  return list.map((c) => {
    if (c.type === 'slider') return sliderHTML(c, Number(get(c.path)));
    if (c.type === 'toggle') return toggleHTML(c, !!get(c.path));
    if (c.type === 'seg') return segHTML(c, get(c.path));
    if (c.type === 'select') return selectHTML(c, get(c.path));
    if (c.type === 'color') return colorHTML(c, get(c.path));
    if (c.type === 'html') return c.html;
    return '';
  }).join('');
}

/* ------------------------------------------------------------------ app */

export class EditorUI {
  constructor(scene, hooks) {
    this.scene = scene;
    this.hooks = hooks;           // { rebuild, bake, bakeSlot, focus, setTool, setView, generate }
    this.stage = 'network';
    this.selection = { kind: 'group', id: 'network' };
    this.filter = '';
    this.expanded = new Set(['asphalt']);
    this.el = {
      tree: document.getElementById('tree'),
      inspector: document.getElementById('inspector'),
      stackTitle: document.getElementById('stackTitle'),
      stackCount: document.getElementById('stackCount'),
      stackTools: document.getElementById('stackTools'),
      crumb: document.getElementById('crumb'),
      badge: document.getElementById('inspectorBadge'),
      stats: document.getElementById('topStats'),
      selChip: document.getElementById('selChip'),
      perf: document.getElementById('perfChip'),
      search: document.getElementById('stackSearch'),
      rail: document.getElementById('rail'),
      vpToolbar: document.getElementById('vpToolbar'),
    };
    this.view = { wire: false, grid: false, markings: true, traffic: true };
    this.tool = 'select';
    this.bindChrome();
  }

  /* ------------------------------------------------------------ chrome */

  bindChrome() {
    document.getElementById('searchIcon').innerHTML = icon('search', 13);
    this.el.search.addEventListener('input', (e) => {
      this.filter = e.target.value.toLowerCase();
      this.renderTree();
    });

    document.getElementById('stageTabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-stage]');
      if (!b) return;
      this.stage = b.dataset.stage;
      [...e.currentTarget.children].forEach((c) => c.classList.toggle('on', c === b));
      this.selection = this.stage === 'network'
        ? { kind: 'group', id: 'network' }
        : { kind: 'stack', id: 'asphalt' };
      this.render();
    });

    const railIcons = {
      select: 'move', pan: 'camera', wire: 'wire', grid: 'grid',
      markings: 'road', traffic: 'car', focus: 'pin',
    };
    for (const b of this.el.rail.querySelectorAll('button')) {
      const k = b.dataset.tool || b.dataset.view;
      b.innerHTML = icon(railIcons[k] || 'settings', 17);
      b.addEventListener('click', () => {
        if (b.dataset.tool) {
          this.tool = b.dataset.tool;
          this.el.rail.querySelectorAll('button[data-tool]').forEach((o) => o.classList.toggle('on', o === b));
          this.hooks.setTool(this.tool);
        } else if (b.dataset.view === 'focus') {
          this.hooks.focus();
        } else {
          const k2 = b.dataset.view;
          this.view[k2] = !this.view[k2];
          b.classList.toggle('on', this.view[k2]);
          this.hooks.setView(this.view);
          if (k2 === 'traffic') { this.scene.settings.traffic = this.view.traffic; }
        }
      });
    }

    this.el.vpToolbar.innerHTML = [
      ['sun', 'day', 'Daylight'], ['cloud', 'dusk', 'Golden hour'], ['bolt', 'night', 'Night'],
      ['droplet', 'wet', 'Wet weather'],
    ].map(([ic, id, t]) => `<button data-env="${id}" title="${t}">${icon(ic, 15)}</button>`).join('');
    this.el.vpToolbar.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-env]');
      if (!b) return;
      this.applyEnvPreset(b.dataset.env);
      this.el.vpToolbar.querySelectorAll('button').forEach((o) => o.classList.toggle('on', o === b));
    });

    document.getElementById('btnGenerate').addEventListener('click', () => {
      this.scene.settings.seed = (Math.random() * 1e9) | 0;
      this.hooks.generate();
    });
    document.getElementById('btnRebake').addEventListener('click', () => this.hooks.bake());

    this.el.tree.addEventListener('click', (e) => this.onTreeClick(e));
    this.el.inspector.addEventListener('input', (e) => this.onControl(e, true));
    this.el.inspector.addEventListener('change', (e) => this.onControl(e, false));
    this.el.inspector.addEventListener('click', (e) => this.onInspectorClick(e));
  }

  applyEnvPreset(id) {
    const s = this.scene.settings;
    if (id === 'day') Object.assign(s, { timeOfDay: 14.6, cloudCover: 0.3, wetness: 0, exposure: 1.05, fog: 0.0015 });
    if (id === 'dusk') Object.assign(s, { timeOfDay: 18.65, cloudCover: 0.45, wetness: 0.1, exposure: 1.2, fog: 0.0026 });
    if (id === 'night') Object.assign(s, { timeOfDay: 22.4, cloudCover: 0.35, wetness: 0.25, exposure: 1.35, fog: 0.0022 });
    if (id === 'wet') Object.assign(s, { timeOfDay: 11.2, cloudCover: 0.9, wetness: 0.85, exposure: 1.1, fog: 0.0042 });
    this.renderInspector();
  }

  /* -------------------------------------------------------------- state */

  get(path) {
    const s = this.scene;
    const p = path.split('.');
    if (p[0] === 'settings') return s.settings[p[1]];
    if (p[0] === 'view') return this.view[p[1]];
    if (p[0] === 'class') {
      const ov = s.classOverrides[p[1]] || {};
      return ov[p[2]] !== undefined ? ov[p[2]] : ROAD_CLASSES[p[1]][p[2]];
    }
    if (p[0] === 'node') {
      const n = s.net.node(this.selection.id);
      return n ? n[p[1]] : 0;
    }
    if (p[0] === 'edge') {
      const e = s.net.edges.get(this.selection.id);
      return e ? e[p[1]] : 0;
    }
    if (p[0] === 'stack') {
      const st = s.stacks[this.selection.stackId || this.selection.id];
      return st ? st[p[1]] : 0;
    }
    if (p[0] === 'layer') {
      const L = this.currentLayer();
      if (!L) return 0;
      if (p[1] === 'params') return L.params[p[2]];
      if (p[1] === 'color') return L.color;
      return L[p[1]];
    }
    return 0;
  }

  set(path, value) {
    const s = this.scene;
    const p = path.split('.');
    if (p[0] === 'settings') { s.settings[p[1]] = value; return 'settings'; }
    if (p[0] === 'view') { this.view[p[1]] = value; this.hooks.setView(this.view); return 'view'; }
    if (p[0] === 'class') { s.classOverrides[p[1]][p[2]] = value; return 'geometry'; }
    if (p[0] === 'node') {
      const n = s.net.node(this.selection.id);
      if (n) n[p[1]] = value;
      return 'geometry';
    }
    if (p[0] === 'edge') {
      const e = s.net.edges.get(this.selection.id);
      if (e) e[p[1]] = value;
      return 'geometry';
    }
    if (p[0] === 'stack') {
      const st = s.stacks[this.selection.stackId || this.selection.id];
      if (st) st[p[1]] = value;
      return 'texture';
    }
    if (p[0] === 'layer') {
      const L = this.currentLayer();
      if (!L) return null;
      if (p[1] === 'params') L.params[p[2]] = value;
      else if (p[1] === 'color') L.color = value;
      else L[p[1]] = value;
      return 'texture';
    }
    return null;
  }

  currentStackId() {
    return this.selection.kind === 'layer' ? this.selection.stackId : (this.selection.kind === 'stack' ? this.selection.id : 'asphalt');
  }

  currentLayer() {
    if (this.selection.kind !== 'layer') return null;
    const st = this.scene.stacks[this.selection.stackId];
    return st ? st.layers.find((l) => l.id === this.selection.id) : null;
  }

  onControl(e, live) {
    const t = e.target;
    const path = t.dataset.path;
    if (!path) return;
    let value;
    if (t.tagName === 'INPUT' && t.type === 'range') {
      value = Number(t.value);
      const pct = ((value - Number(t.min)) / (Number(t.max) - Number(t.min))) * 100;
      t.style.setProperty('--progress', `${pct}%`);
      const isLive = t.dataset.live === '1';
      if (live && !isLive) { this.updateReadout(t, value); return; }
      if (!live && isLive) return;
    } else if (t.tagName === 'SELECT') {
      value = t.value;
      if (live) return;
      const num = Number(value);
      if (!Number.isNaN(num) && value.trim() !== '') value = num;
    } else return;
    this.updateReadout(t, value);
    const scope = this.set(path, value);
    this.commit(scope, path);
  }

  updateReadout(input, value) {
    const line = input.closest('.field')?.querySelector('.control-line strong');
    if (!line) return;
    const step = Number(input.step) || 1;
    const txt = step < 1 ? value.toFixed(step < 0.05 ? 3 : 2) : String(Math.round(value));
    const unit = line.querySelector('em');
    line.textContent = txt;
    if (unit) line.appendChild(document.createTextNode(' ')), line.appendChild(unit);
  }

  onInspectorClick(e) {
    const b = e.target.closest('[data-path][data-type], [data-action]');
    if (!b) return;
    if (b.dataset.action) { this.action(b.dataset.action, b.dataset.value); return; }
    const type = b.dataset.type;
    const path = b.dataset.path;
    if (type === 'toggle') {
      const v = !this.get(path);
      const scope = this.set(path, v);
      b.classList.toggle('on', v);
      this.commit(scope, path);
    } else if (type === 'seg') {
      let v = b.dataset.value;
      const num = Number(v);
      if (!Number.isNaN(num) && v.trim() !== '') v = num;
      const scope = this.set(path, v);
      b.parentElement.querySelectorAll('button').forEach((o) => o.classList.toggle('on', o === b));
      this.commit(scope, path);
    } else if (type === 'color') {
      const idx = Number(b.dataset.value);
      const palette = this.palette;
      const scope = this.set(path, palette[idx].slice());
      this.commit(scope, path);
      this.renderInspector();
    }
  }

  action(name, value) {
    const s = this.scene;
    if (name === 'addLayer') {
      const st = s.stacks[this.currentStackId()];
      const L = makeLayer(value);
      st.layers.push(L);
      this.selection = { kind: 'layer', id: L.id, stackId: st.slot !== undefined ? this.currentStackId() : 'asphalt' };
      this.hooks.bakeSlot(this.currentStackId());
      this.render();
    } else if (name === 'delLayer') {
      const sid = this.currentStackId();
      const st = s.stacks[sid];
      const i = st.layers.findIndex((l) => l.id === this.selection.id);
      if (i >= 0 && st.layers.length > 1) {
        st.layers.splice(i, 1);
        this.selection = { kind: 'stack', id: sid };
        this.hooks.bakeSlot(sid);
        this.render();
      }
    } else if (name === 'dupLayer') {
      const sid = this.currentStackId();
      const st = s.stacks[sid];
      const L = this.currentLayer();
      if (L) {
        const copy = makeLayer(L.type, { name: `${L.name} copy`, opacity: L.opacity, blend: L.blend, color: L.color, params: L.params });
        st.layers.splice(st.layers.indexOf(L) + 1, 0, copy);
        this.selection = { kind: 'layer', id: copy.id, stackId: sid };
        this.hooks.bakeSlot(sid);
        this.render();
      }
    } else if (name === 'moveLayer') {
      const sid = this.currentStackId();
      const st = s.stacks[sid];
      const i = st.layers.findIndex((l) => l.id === this.selection.id);
      const j = i + Number(value);
      if (i >= 0 && j >= 0 && j < st.layers.length) {
        const [L] = st.layers.splice(i, 1);
        st.layers.splice(j, 0, L);
        this.hooks.bakeSlot(sid);
        this.render();
      }
    } else if (name === 'regen') {
      this.hooks.generate();
    } else if (name === 'rebuild') {
      this.hooks.rebuild();
    } else if (name === 'reseed') {
      s.settings.seed = (Math.random() * 1e9) | 0;
      this.hooks.generate();
    } else if (name === 'focusNode') {
      this.hooks.focus(this.selection.id);
    } else if (name === 'deleteNode') {
      s.net.removeNode(this.selection.id);
      this.selection = { kind: 'group', id: 'network' };
      this.hooks.rebuild();
      this.render();
    } else if (name === 'presetTex') {
      this.hooks.bake();
    }
  }

  commit(scope, path) {
    if (scope === 'texture') {
      clearTimeout(this._bakeT);
      this._bakeT = setTimeout(() => this.hooks.bakeSlot(this.currentStackId()), 16);
      if (path.endsWith('.on') || path.endsWith('.blend')) this.renderTree();
    } else if (scope === 'geometry' || scope === 'settings') {
      const geomKeys = /seed|extent|block|density|curviness|relief|highway|rail|quality|markings|wear|potholes|calming|works|parking|structures|tunnels|trackwork|railings|lighting|signals|bollards|furniture|billboards|worksKit|propDensity|blocks|ground/;
      if (scope === 'geometry' || geomKeys.test(path)) {
        clearTimeout(this._buildT);
        this._buildT = setTimeout(() => { this.hooks.rebuild(); this.renderTree(); this.renderStats(); }, 30);
      }
    }
  }

  /* --------------------------------------------------------------- tree */

  onTreeClick(e) {
    const vis = e.target.closest('.visibility');
    const row = e.target.closest('.tree-row');
    if (!row) return;
    const kind = row.dataset.kind;
    const id = row.dataset.id;
    if (vis) {
      if (kind === 'layer') {
        const st = this.scene.stacks[row.dataset.stack];
        const L = st.layers.find((l) => l.id === id);
        L.on = !L.on;
        this.hooks.bakeSlot(row.dataset.stack);
      } else if (kind === 'feature') {
        this.scene.settings[id] = !this.scene.settings[id];
        this.commit('settings', `settings.${id}`);
      } else if (kind === 'class') {
        const hide = !this.scene.visible[id];
        this.scene.visible[id] = hide;
        for (const ed of this.scene.net.edges.values()) if (ed.cls === id) ed.hidden = hide;
        this.hooks.rebuild();
      }
      this.renderTree();
      return;
    }
    if (kind === 'stack') {
      if (this.expanded.has(id)) this.expanded.delete(id); else { this.expanded.clear(); this.expanded.add(id); }
      this.selection = { kind: 'stack', id };
    } else if (kind === 'layer') {
      this.selection = { kind: 'layer', id, stackId: row.dataset.stack };
    } else {
      this.selection = { kind, id };
    }
    this.render();
  }

  renderTree() {
    const s = this.scene;
    let html = '';
    let count = 0;
    const match = (name) => !this.filter || name.toLowerCase().includes(this.filter);

    const row = (kind, id, name, sub, iconName, opts = {}) => {
      if (!match(name)) return '';
      count++;
      const sel = this.selection.kind === kind && this.selection.id === id;
      return `<div class="tree-row ${sel ? 'sel' : ''}" data-kind="${kind}" data-id="${esc(id)}" ${opts.stack ? `data-stack="${esc(opts.stack)}"` : ''}>
        <button class="object-button" style="${opts.indent ? `padding-left:${12 + opts.indent * 15}px` : ''}">
          <span class="ic">${icon(iconName, opts.indent ? 13 : 15)}</span>
          <span style="min-width:0">
            <span class="label">${esc(name)}</span>
            ${sub ? `<br><span class="sub">${esc(sub)}</span>` : ''}
          </span>
        </button>
        <span class="row-meta">
          ${opts.swatch ? `<span class="row-swatch" style="background:${opts.swatch}"></span>` : ''}
          ${sel ? '<span class="row-dot"></span>' : ''}
          ${opts.hideable !== false ? `<button class="visibility ${opts.on === false ? 'off' : ''}">${icon(opts.on === false ? 'eyeOff' : 'eye', 14)}</button>` : ''}
        </span>
      </div>`;
    };
    const group = (label, n) => `<div class="group-label">${esc(label)}<span class="group-count">${n}</span></div>`;

    if (this.stage === 'network') {
      this.el.stackTitle.firstChild.textContent = 'Network stack ';
      html += group('Carriageways', CLASS_ORDER.length);
      for (const c of CLASS_ORDER) {
        const n = s.net ? s.classCount(c) : 0;
        html += row('class', c, ROAD_CLASSES[c].label, `${n} segment${n === 1 ? '' : 's'}`, CLASS_ICON[c],
          { on: !s.visible[c], swatch: ROAD_CLASSES[c].color });
      }
      const jn = s.net ? s.junctionCount() : 0;
      html += group('Topology', 3);
      html += row('group', 'junctions', 'Intersections', `${jn} merged junction${jn === 1 ? '' : 's'}`, 'junction', { hideable: false });
      html += row('feature', 'structures', 'Bridges & viaducts', `${s.stats.structures ?? 0} spans`, 'bridge', { on: s.settings.structures });
      html += row('feature', 'trackwork', 'Railway trackwork', 'Rails & sleepers', 'train', { on: s.settings.trackwork });

      html += group('Surface', 6);
      html += row('feature', 'markings', 'Road markings', 'Lane lines, crossings, arrows', 'road', { on: s.settings.markings });
      html += row('feature', 'potholes', 'Wear & potholes', 'Damage field', 'cracks', { on: s.settings.potholes });
      html += row('feature', 'calming', 'Traffic calming', 'Humps, tables, cushions', 'ruler', { on: s.settings.calming });
      html += row('feature', 'works', 'Construction works', 'Excavations & diversions', 'cone', { on: s.settings.works });
      html += row('feature', 'parking', 'On-street parking', 'Bays, meters, parked cars', 'parking', { on: s.settings.parking });
      html += row('feature', 'railings', 'Guardrails & parapets', 'Swept W-beam / concrete', 'fence', { on: s.settings.railings });

      html += group('Furniture', 5);
      html += row('feature', 'lighting', 'Street lighting', 'Columns & luminaires', 'lamp', { on: s.settings.lighting });
      html += row('feature', 'signals', 'Traffic signals', 'Masts, heads, ped signals', 'signal', { on: s.settings.signals });
      html += row('feature', 'bollards', 'Bollards', '4 designs', 'bollard', { on: s.settings.bollards });
      html += row('feature', 'billboards', 'Signage & billboards', 'Lit hoardings', 'billboard', { on: s.settings.billboards });
      html += row('feature', 'furniture', 'Planting & furniture', 'Trees, benches, bins', 'tree', { on: s.settings.furniture });

      html += group('Simulation', 2);
      html += row('feature', 'traffic', 'AI traffic', `${s.settings.vehicles} / 25 vehicles`, 'car', { on: s.settings.traffic });
      html += row('feature', 'trains', 'Trains', 'Rolling stock', 'train', { on: s.settings.trains });

      html += group('World', 3);
      html += row('feature', 'blocks', 'City blocks', `${s.stats.blocks ?? 0} parcels`, 'block', { on: s.settings.blocks });
      html += row('group', 'generator', 'Generator', s.settings.preset, 'settings', { hideable: false });
      html += row('group', 'environment', 'Environment', 'Sun, sky, weather', 'sun', { hideable: false });
    } else {
      this.el.stackTitle.firstChild.textContent = 'Texture stack ';
      html += group('Surfaces', STACK_ORDER.length);
      for (const id of STACK_ORDER) {
        const st = s.stacks[id];
        const open = this.expanded.has(id);
        html += row('stack', id, st.name, `${st.layers.length} layers · ${st.scale}× tiling`, 'layers', { hideable: false });
        if (open) {
          for (let i = st.layers.length - 1; i >= 0; i--) {
            const L = st.layers[i];
            const def = LAYER_TYPES[L.type];
            html += row('layer', L.id, L.name, `${BLEND[L.blend]} · ${Math.round(L.opacity * 100)}%`, def.icon,
              { indent: 1, on: L.on, stack: id });
          }
        }
      }
    }

    this.el.tree.innerHTML = html;
    this.el.stackCount.textContent = String(count).padStart(2, '0');

    this.el.stackTools.innerHTML = this.stage === 'texture'
      ? `<button class="icon-button" data-tt="add" title="Add layer">${icon('plus', 16)}</button>`
      : `<button class="icon-button" data-tt="rebuild" title="Rebuild network">${icon('refresh', 15)}</button>`;
    this.el.stackTools.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.tt === 'rebuild') this.hooks.rebuild();
      else this.toggleAddMenu(b);
    };
  }

  toggleAddMenu(anchor) {
    const old = document.querySelector('.add-menu');
    if (old) { old.remove(); return; }
    const menu = document.createElement('div');
    menu.className = 'add-menu';
    menu.innerHTML = Object.entries(LAYER_TYPES).map(([k, v]) =>
      `<button data-add="${k}"><span class="ic">${icon(v.icon, 15)}</span>${esc(v.name)}</button>`).join('');
    anchor.closest('.stack').appendChild(menu);
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-add]');
      if (!b) return;
      menu.remove();
      this.action('addLayer', b.dataset.add);
    });
  }

  /* ---------------------------------------------------------- inspector */

  renderInspector() {
    const s = this.scene;
    const sel = this.selection;
    const g = (p) => this.get(p);
    let title = 'Network';
    let eyebrow = 'ROADFORGE';
    let badge = '';
    let body = '';

    if (this.stage === 'texture') {
      const sid = this.currentStackId();
      const st = s.stacks[sid];
      if (sel.kind === 'layer') {
        const L = this.currentLayer();
        if (L) {
          const def = LAYER_TYPES[L.type];
          title = L.name; eyebrow = `${st.name.toUpperCase()} · LAYER`;
          badge = def.name;
          this.palette = PALETTES[L.type] || PALETTES.default;
          const ctrls = [
            { type: 'seg', path: 'layer.blend', label: 'Blend mode', options: BLEND.map((b, i) => [i, b]) },
            { type: 'slider', path: 'layer.opacity', label: 'Opacity', min: 0, max: 1, step: 0.01 },
          ];
          const params = def.params.map((p) => (p.enum
            ? { type: 'seg', path: `layer.params.${p.k}`, label: p.label, options: p.enum.map((n, i) => [i, n]) }
            : { type: 'slider', path: `layer.params.${p.k}`, label: p.label, min: p.min, max: p.max, step: p.step }));
          body = card('Layer', def.icon, controlsHTML(ctrls, g))
            + card('Parameters', 'settings', controlsHTML(params, g))
            + card('Colour', 'sparkle', controlsHTML([{ type: 'color', path: 'layer.color', label: 'Tint', palette: this.palette }], g))
            + `<div class="btn-row">
                <button class="ghost-btn" data-action="moveLayer" data-value="1">${icon('up', 13)} Raise</button>
                <button class="ghost-btn" data-action="moveLayer" data-value="-1">${icon('down', 13)} Lower</button>
                <button class="ghost-btn" data-action="dupLayer">${icon('copy', 13)} Duplicate</button>
                <button class="ghost-btn" data-action="delLayer">${icon('trash', 13)} Delete</button>
              </div>`;
        }
      } else {
        title = st.name; eyebrow = 'SURFACE STACK';
        badge = `slot ${st.slot}`;
        const using = MATERIALS.filter((m) => m[4] === st.slot).map((m) => m[0]);
        body = card('Tiling', 'ruler', controlsHTML([
          { type: 'slider', path: 'stack.scale', label: 'Texture repeat', min: 1, max: 8, step: 1, unit: '×', lo: 'Large pattern', hi: 'Fine pattern' },
        ], g) + `<p class="muted">${st.layers.length} procedural layers baked to a 512² albedo + normal/rough/AO pair with a full mip chain.</p>`)
          + card('Used by', 'layers', `<p class="muted">${using.map(esc).join(' · ') || 'Not bound to a material'}</p>`)
          + `<div class="btn-row"><button class="ghost-btn" data-action="presetTex">${icon('refresh', 13)} Re-bake all surfaces</button></div>`;
      }
    } else if (sel.kind === 'class') {
      const c = sel.id;
      const def = ROAD_CLASSES[c];
      title = def.label; eyebrow = 'ROAD CLASS';
      badge = `${s.classCount(c)} segments`;
      const geo = [
        { type: 'slider', path: `class.${c}.lanesF`, label: 'Lanes · forward', min: 0, max: 5, step: 1, live: false },
        { type: 'slider', path: `class.${c}.lanesB`, label: 'Lanes · reverse', min: 0, max: 5, step: 1, live: false },
        { type: 'slider', path: `class.${c}.laneWidth`, label: 'Lane width', min: 2.4, max: 4.2, step: 0.05, unit: 'm', live: false },
        { type: 'slider', path: `class.${c}.medianW`, label: 'Median width', min: 0, max: 6, step: 0.1, unit: 'm', live: false },
      ];
      const walk = [
        { type: 'slider', path: `class.${c}.sidewalk`, label: 'Footway width', min: 0, max: 5, step: 0.1, unit: 'm', live: false },
        { type: 'slider', path: `class.${c}.curbHeight`, label: 'Kerb height', min: 0, max: 0.3, step: 0.005, unit: 'm', live: false },
        { type: 'slider', path: `class.${c}.shoulder`, label: 'Hard shoulder', min: 0, max: 4, step: 0.1, unit: 'm', live: false },
      ];
      body = card('Carriageway', 'road',
        `<div class="metric">${def.lanesF + def.lanesB}<small>lanes</small></div>
         <p class="muted">${esc(def.label)} · design speed ${Math.round(def.maxSpeed * 3.6)} km/h</p>`
        + controlsHTML(geo, g))
        + card('Footway & kerb', 'ruler', controlsHTML(walk, g))
        + card('Fittings', 'lamp', controlsHTML([
          { type: 'select', path: `class.${c}.lighting`, label: 'Lighting arrangement', options: [['none', 'None'], ['alternate', 'Alternating'], ['both', 'Both sides'], ['median', 'Central mast'], ['right', 'One side']] },
          { type: 'toggle', path: `class.${c}.guardrail`, label: 'Guardrail / parapet' },
        ], g));
    } else if (sel.kind === 'node') {
      const n = s.net.node(sel.id);
      if (n) {
        const deg = s.net.degree(n.id);
        title = n.name || `Intersection ${n.id}`;
        eyebrow = deg >= 3 ? `${deg}-ARM JUNCTION` : deg === 2 ? 'ROAD JOIN' : 'TERMINUS';
        badge = `${deg} arms`;
        const plan = s.build?.plans.get(n.id);
        body = card('Transform', 'move',
          `<div class="metric">${n.x.toFixed(1)}<small>, ${n.z.toFixed(1)} m</small></div>
           <p class="muted">Drag the gizmo in the viewport — the whole junction, its fillets and every connected road rebuild as one welded mesh.</p>`
          + controlsHTML([
            { type: 'slider', path: 'node.x', label: 'East', min: n.x - 160, max: n.x + 160, step: 0.1, unit: 'm', live: false },
            { type: 'slider', path: 'node.z', label: 'North', min: n.z - 160, max: n.z + 160, step: 0.1, unit: 'm', live: false },
            { type: 'slider', path: 'node.y', label: 'Elevation', min: -14, max: 16, step: 0.1, unit: 'm', live: false },
          ], g))
          + card('Junction', 'junction', controlsHTML([
            { type: 'slider', path: 'node.cornerRadius', label: 'Corner radius (0 = auto)', min: 0, max: 18, step: 0.25, unit: 'm', live: false },
            { type: 'select', path: 'node.signals', label: 'Control', options: [['auto', 'Automatic'], ['signals', 'Signalised'], ['stop', 'Stop'], ['yield', 'Give way'], ['none', 'Uncontrolled']] },
            { type: 'toggle', path: 'node.crosswalks', label: 'Pedestrian crossings' },
          ], g)
            + `<p class="muted">Mode: <b>${esc(plan?.mode || '—')}</b> · ${plan?.corners?.length ?? 0} corner fillets</p>`)
          + `<div class="btn-row">
              <button class="ghost-btn" data-action="focusNode">${icon('pin', 13)} Frame</button>
              <button class="ghost-btn" data-action="deleteNode">${icon('trash', 13)} Delete</button>
            </div>`;
      }
    } else if (sel.kind === 'edge') {
      const e = s.net.edges.get(sel.id);
      if (e) {
        title = e.name || `Road ${e.id}`;
        eyebrow = (ROAD_CLASSES[e.cls]?.label || e.cls).toUpperCase();
        const curve = s.build?.curves.get(e.id);
        badge = curve ? `${curve.length.toFixed(0)} m` : '';
        body = card('Segment', 'road',
          `<div class="metric">${curve ? curve.length.toFixed(0) : '0'}<small>m</small></div>
           <p class="muted">${e.lanesF + e.lanesB} lanes · ${(s.build?.profiles.get(e.id)?.width ?? 0).toFixed(1)} m overall width</p>`
          + controlsHTML([
            { type: 'slider', path: 'edge.lanesF', label: 'Lanes · forward', min: 0, max: 5, step: 1, live: false },
            { type: 'slider', path: 'edge.lanesB', label: 'Lanes · reverse', min: 0, max: 5, step: 1, live: false },
            { type: 'slider', path: 'edge.wear', label: 'Surface wear', min: 0, max: 1, step: 0.01, live: false },
            { type: 'slider', path: 'edge.crown', label: 'Camber', min: 0, max: 0.06, step: 0.002, live: false },
          ], g))
          + card('Edges', 'ruler', controlsHTML([
            { type: 'slider', path: 'edge.sidewalkL', label: 'Footway left', min: 0, max: 5, step: 0.1, unit: 'm', live: false },
            { type: 'slider', path: 'edge.sidewalkR', label: 'Footway right', min: 0, max: 5, step: 0.1, unit: 'm', live: false },
            { type: 'slider', path: 'edge.parkingL', label: 'Parking left', min: 0, max: 3, step: 0.1, unit: 'm', live: false },
            { type: 'slider', path: 'edge.parkingR', label: 'Parking right', min: 0, max: 3, step: 0.1, unit: 'm', live: false },
            { type: 'toggle', path: 'edge.bikeLaneL', label: 'Cycle lane left' },
            { type: 'toggle', path: 'edge.bikeLaneR', label: 'Cycle lane right' },
            { type: 'toggle', path: 'edge.tunnel', label: 'Bored tunnel' },
          ], g));
      }
    } else if (sel.id === 'generator') {
      title = 'Generator'; eyebrow = 'PROCEDURAL NETWORK';
      badge = `seed ${s.settings.seed}`;
      body = card('Preset', 'grid', controlsHTML([
        { type: 'select', path: 'settings.preset', label: 'Layout', options: s.presets.map((p) => [p.id, p.name]) },
      ], g) + `<p class="muted">${esc(s.presets.find((p) => p.id === s.settings.preset)?.hint || '')}</p>
        <div class="btn-row"><button class="ghost-btn primary" data-action="regen">${icon('refresh', 13)} Generate</button>
        <button class="ghost-btn" data-action="reseed">${icon('sparkle', 13)} New seed</button></div>`)
        + card('Shape', 'ruler', controlsHTML([
          { type: 'slider', path: 'settings.extent', label: 'Extent', min: 120, max: 720, step: 10, unit: 'm', live: false },
          { type: 'slider', path: 'settings.block', label: 'Block size', min: 36, max: 150, step: 2, unit: 'm', live: false },
          { type: 'slider', path: 'settings.density', label: 'Street density', min: 0.2, max: 1, step: 0.02, live: false },
          { type: 'slider', path: 'settings.curviness', label: 'Curviness', min: 0, max: 1, step: 0.02, live: false },
          { type: 'slider', path: 'settings.relief', label: 'Relief', min: 0, max: 1, step: 0.02, live: false },
        ], g))
        + card('Content', 'layers', controlsHTML([
          { type: 'toggle', path: 'settings.highway', label: 'Motorway & interchange' },
          { type: 'toggle', path: 'settings.rail', label: 'Railway' },
          { type: 'seg', path: 'settings.quality', label: 'Mesh density', options: [[0, 'Draft'], [1, 'Standard'], [2, 'High']] },
        ], g))
        + card('Condition', 'cracks', controlsHTML([
          { type: 'slider', path: 'settings.wear', label: 'Overall wear', min: 0, max: 1, step: 0.02, live: false },
          { type: 'slider', path: 'settings.propDensity', label: 'Furniture density', min: 0.2, max: 2, step: 0.05, live: false },
          { type: 'slider', path: 'settings.vehicles', label: 'AI vehicles', min: 0, max: 25, step: 1, live: false },
        ], g));
    } else if (sel.id === 'environment') {
      title = 'Environment'; eyebrow = 'LIGHT & ATMOSPHERE';
      const t = s.settings.timeOfDay;
      badge = `${String(Math.floor(t)).padStart(2, '0')}:${String(Math.floor((t % 1) * 60)).padStart(2, '0')}`;
      body = card('Daylight', 'sun',
        `<div class="metric">${String(Math.floor(t)).padStart(2, '0')}<small>:${String(Math.floor((t % 1) * 60)).padStart(2, '0')}</small></div>`
        + controlsHTML([
          { type: 'slider', path: 'settings.timeOfDay', label: 'Time of day', min: 0, max: 24, step: 0.05, lo: '00:00', hi: '24:00' },
          { type: 'slider', path: 'settings.sunAzimuth', label: 'Sun bearing', min: 0, max: 6.283, step: 0.01 },
          { type: 'toggle', path: 'settings.shadows', label: 'Cascaded shadows' },
        ], g))
        + card('Atmosphere', 'cloud', controlsHTML([
          { type: 'slider', path: 'settings.cloudCover', label: 'Cloud cover', min: 0, max: 1, step: 0.01 },
          { type: 'slider', path: 'settings.fog', label: 'Fog density', min: 0, max: 0.01, step: 0.0002 },
          { type: 'slider', path: 'settings.wetness', label: 'Surface wetness', min: 0, max: 1, step: 0.01 },
        ], g))
        + card('Camera', 'camera', controlsHTML([
          { type: 'slider', path: 'settings.exposure', label: 'Exposure', min: 0.3, max: 2.4, step: 0.01 },
          { type: 'slider', path: 'settings.ao', label: 'Ambient occlusion', min: 0, max: 1.5, step: 0.01 },
          { type: 'slider', path: 'settings.vignette', label: 'Vignette', min: 0, max: 1, step: 0.01 },
          { type: 'slider', path: 'settings.grain', label: 'Film grain', min: 0, max: 1, step: 0.01 },
        ], g));
    } else if (sel.id === 'junctions') {
      title = 'Intersections'; eyebrow = 'TOPOLOGY';
      badge = `${s.junctionCount()} junctions`;
      const modes = { cap: 0, weld: 0, endcap: 0, none: 0 };
      if (s.build) for (const p of s.build.plans.values()) modes[p.mode] = (modes[p.mode] || 0) + 1;
      body = card('Merged topology', 'junction',
        `<div class="metric">${s.junctionCount()}<small>junctions</small></div>
         <p class="muted">Every crossing is solved as one surface: arm ends are trimmed back, corner fillets are swept between neighbouring kerb stacks and the centre is closed with a quad fan. Road ends weld to the cap by shared vertices — no overlapping slabs.</p>
         <div class="field"><div class="control-line"><span>Full caps</span><strong>${modes.cap || 0}</strong></div>
         <div class="control-line"><span>Welded joins</span><strong>${modes.weld || 0}</strong></div>
         <div class="control-line"><span>End caps / cul-de-sacs</span><strong>${modes.endcap || 0}</strong></div></div>`)
        + card('Mesh', 'wire',
          `<div class="field">
            <div class="control-line"><span>Quads</span><strong>${(s.stats.quads ?? 0).toLocaleString()}</strong></div>
            <div class="control-line"><span>Triangles</span><strong>${(s.stats.tris ?? 0).toLocaleString()}</strong></div>
            <div class="control-line"><span>Vertices</span><strong>${(s.stats.verts ?? 0).toLocaleString()}</strong></div>
            <div class="control-line"><span>Quad ratio</span><strong>${quadRatio(s.stats)}%</strong></div>
          </div>
          <p class="muted">Quads are preserved as first-class topology and only triangulated at upload time, on the shorter diagonal.</p>`
          + controlsHTML([{ type: 'toggle', path: 'view.wire', label: 'Show quad topology' }], g));
    } else if (sel.kind === 'feature') {
      const meta = FEATURE_INFO[sel.id] || { title: sel.id, eyebrow: 'LAYER', icon: 'layers', text: '' };
      title = meta.title; eyebrow = meta.eyebrow;
      badge = s.settings[sel.id] ? 'Enabled' : 'Disabled';
      body = card(meta.title, meta.icon,
        `<p class="muted">${meta.text}</p>`
        + controlsHTML([{ type: 'toggle', path: `settings.${sel.id}`, label: 'Enabled' },
          ...(meta.controls || [])], g));
    } else {
      title = 'Network'; eyebrow = 'ROADFORGE';
      body = card('Scene', 'layers',
        `<div class="metric">${(s.stats.edges ?? 0)}<small>roads</small></div>
         <p class="muted">Pick a layer on the right or click an intersection in the viewport to edit it.</p>`);
    }

    this.el.inspector.innerHTML = `
      <div class="object-header">
        <div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1></div>
        <button class="enabled-pill ${badge === 'Disabled' ? 'off' : ''}"><span></span>${esc(badge || 'Live')}</button>
      </div>
      <div class="section-label"><span>Properties</span><span>${esc(this.stage === 'texture' ? 'Procedural bake' : 'Generator')}</span></div>
      <div class="cards">${body}</div>
      <div class="inspector-footer"><span>RoadForge · WebGPU</span><span class="footer-dot"></span><span>${(s.stats.buildMs ?? 0).toFixed(0)} ms build</span></div>`;

    this.el.crumb.textContent = this.stage === 'texture' ? 'Texture' : 'Network';
    this.el.badge.textContent = badge || '—';
  }

  renderStats() {
    const s = this.scene.stats;
    this.el.stats.innerHTML = [
      ['Quads', (s.quads ?? 0).toLocaleString()],
      ['Verts', (s.verts ?? 0).toLocaleString()],
      ['Props', (s.props ?? 0).toLocaleString()],
      ['Lights', (s.lights ?? 0).toLocaleString()],
      ['Build', `${(s.buildMs ?? 0).toFixed(0)} ms`],
    ].map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join('');
  }

  setSelectionFromViewport(kind, id) {
    this.selection = { kind, id };
    this.render();
  }

  render() {
    this.renderTree();
    this.renderInspector();
    this.renderStats();
  }
}

function quadRatio(stats) {
  const q = stats.quads ?? 0;
  const t = stats.tris ?? 0;
  if (!q && !t) return '0';
  return ((q / (q + t)) * 100).toFixed(1);
}

const FEATURE_INFO = {
  structures: { title: 'Bridges & viaducts', eyebrow: 'STRUCTURES', icon: 'bridge', text: 'Elevated spans grow a box-girder deck with fascia, soffit, tapered piers, pier caps, footings and abutments. Piers are kept clear of live carriageways automatically.' },
  trackwork: { title: 'Railway trackwork', eyebrow: 'STRUCTURES', icon: 'train', text: 'Timber sleepers every 620 mm and swept rail sections at 1435 mm gauge, following the alignment exactly.' },
  markings: { title: 'Road markings', eyebrow: 'SURFACE', icon: 'road', text: 'Analytically antialiased paint evaluated in the shader: centre lines, lane dashes, edge lines, stop bars, zebra crossings, turn arrows, hatching, cycle lanes and bay markings.' },
  potholes: { title: 'Wear & potholes', eyebrow: 'SURFACE', icon: 'cracks', text: 'A deterministic damage field displaces the carriageway mesh and drives wear, patch and polish masks in the shader.' },
  calming: { title: 'Traffic calming', eyebrow: 'SURFACE', icon: 'ruler', text: 'Round-top humps, flat-top tables and split cushions are modelled into the surface, with the longitudinal sampling refined around each one.' },
  works: { title: 'Construction works', eyebrow: 'SURFACE', icon: 'cone', text: 'Excavated lanes with exposed sub-base, tapered cone runs, barriers, site huts, pipe stacks and a lit works board.' },
  parking: { title: 'On-street parking', eyebrow: 'SURFACE', icon: 'parking', text: 'Marked bays with kerbside parked vehicles and meters on the footway.' },
  railings: { title: 'Guardrails & parapets', eyebrow: 'FURNITURE', icon: 'fence', text: 'W-beam barriers with posts on fast roads; solid parapets with tubular handrails along elevated structures.' },
  lighting: { title: 'Street lighting', eyebrow: 'FURNITURE', icon: 'lamp', text: 'Swan-neck columns, twin motorway masts and heritage lanterns, each with a clustered spot light feeding the forward renderer.' },
  signals: { title: 'Traffic signals', eyebrow: 'FURNITURE', icon: 'signal', text: 'Mast-arm and post signals with backboards, visors and pedestrian heads. The controller drives a two-phase cycle the AI traffic obeys.' },
  bollards: { title: 'Bollards', eyebrow: 'FURNITURE', icon: 'bollard', text: 'Four designs: steel with a reflective band, granite, cast bell and illuminated.' },
  billboards: { title: 'Signage & billboards', eyebrow: 'FURNITURE', icon: 'billboard', text: 'Lit hoardings on fast roads plus speed roundels and rectangular boards at junction approaches.' },
  furniture: { title: 'Planting & furniture', eyebrow: 'FURNITURE', icon: 'tree', text: 'Street trees, planters, benches, litter bins and hydrants on footways wide enough to take them.' },
  traffic: {
    title: 'AI traffic', eyebrow: 'SIMULATION', icon: 'car',
    text: 'Vehicles drive a real lane graph with intelligent-driver-model following, signal obedience and a junction reservation lock. Hard capped at 25.',
    controls: [{ type: 'slider', path: 'settings.vehicles', label: 'Vehicle count', min: 0, max: 25, step: 1, live: false }],
  },
  trains: { title: 'Trains', eyebrow: 'SIMULATION', icon: 'train', text: 'Locomotive plus coaches running the rail alignment on bogies.' },
  blocks: { title: 'City blocks', eyebrow: 'WORLD', icon: 'block', text: 'Faces of the planar road graph are filled with plazas, verges and courts — offset by each road\u2019s own section so the parcel meets the back of the footway exactly. No buildings.' },
};

const PALETTES = {
  default: [[0.08, 0.08, 0.085], [0.2, 0.2, 0.2], [0.42, 0.42, 0.42], [0.62, 0.62, 0.6], [0.3, 0.26, 0.22], [0.1, 0.14, 0.08], [0.015, 0.015, 0.018], [0.5, 0.42, 0.3]],
  base: [[0.07, 0.07, 0.076], [0.1, 0.1, 0.105], [0.17, 0.17, 0.17], [0.235, 0.233, 0.228], [0.3, 0.295, 0.285], [0.38, 0.385, 0.39], [0.055, 0.085, 0.035], [0.115, 0.112, 0.108]],
  moss: [[0.035, 0.055, 0.022], [0.06, 0.08, 0.03], [0.02, 0.04, 0.015], [0.09, 0.085, 0.05]],
  cracks: [[0.016, 0.016, 0.018], [0.03, 0.03, 0.03], [0.06, 0.055, 0.05], [0.0, 0.0, 0.0]],
  oil: [[0.012, 0.011, 0.01], [0.03, 0.025, 0.02], [0.05, 0.04, 0.02]],
  stain: [[0.09, 0.088, 0.082], [0.13, 0.07, 0.03], [0.05, 0.05, 0.048], [0.16, 0.15, 0.13]],
  paving: [[0.22, 0.215, 0.205], [0.3, 0.29, 0.27], [0.14, 0.135, 0.13], [0.42, 0.4, 0.37], [0.17, 0.125, 0.03], [0.09, 0.09, 0.095]],
};
