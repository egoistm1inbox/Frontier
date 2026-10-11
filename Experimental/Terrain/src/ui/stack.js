// Layer stack column: Terrain / Texture / Scene tabs. Rows are shown top-of-stack first.
import { h, ic, clear, popMenu } from './dom.js';
import { TERRAIN_TYPES, BLEND_MODES, newId } from '../terrain/layer-types.js';
import { TEXTURE_TYPES, TEX_BLEND } from '../texture/layer-types.js';
import { SCENE_ITEMS } from './inspector.js';

export class StackPanel {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.tabs = h('div.tabs');
    this.addBtn = h('button.add-btn', ic('plus', 15), h('span', 'Add layer'), h('span.kbd', '⇧A'));
    this.addBtn.addEventListener('click', () => app.openConstruct());
    this.head = h('div.stack-head', this.tabs, this.addBtn);
    this.label = h('div.stack-label', h('span', 'Stack'), h('span', ''));
    this.list = h('div.stack-list');
    this.foot = h('div.stack-foot', h('span.l', ''), h('span.r', ''));
    root.append(this.head, this.label, this.list, this.foot);
    for (const [k, label, icn] of [['terrain', 'Terrain', 'mountain'], ['texture', 'Texture', 'palette'], ['scene', 'Scene', 'sun']]) {
      const b = h('button', { 'data-tab': k }, ic(icn, 13), label);
      b.addEventListener('click', () => app.selectTab(k));
      this.tabs.append(b);
    }
  }
  get store() { return this.app.store; }

  render() {
    const s = this.store.sel;
    this.tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === s.tab));
    this.addBtn.style.display = s.tab === 'scene' ? 'none' : '';
    clear(this.list);
    if (s.tab === 'scene') return this._scene();
    const isT = s.tab === 'terrain';
    const layers = isT ? this.store.p.terrain.layers : this.store.p.texture.layers;
    this.label.firstChild.textContent = isT ? 'Terrain stack' : 'Material stack';
    this.label.lastChild.textContent = `${layers.length} layer${layers.length === 1 ? '' : 's'} · top → bottom`;
    if (!layers.length) {
      this.list.append(h('div.empty', isT ? 'The terrain stack is empty.' : 'No materials yet.', h('br'), 'Use “Add layer” to start.'));
    }
    for (let i = layers.length - 1; i >= 0; i--) this.list.append(this._row(layers[i], i, layers, isT));
    const b = this.app.lastBuild;
    this.foot.querySelector('.l').textContent = b ? `${b.N}² · ${(b.ms / 1000).toFixed(2)} s` : 'Not built';
    this.foot.querySelector('.r').textContent = isT ? 'Bottom layer evaluates first' : 'Top material wins';
  }

  _row(layer, index, layers, isT) {
    const app = this.app;
    const t = isT ? TERRAIN_TYPES[layer.type] : (TEXTURE_TYPES[layer.type] || TEXTURE_TYPES.base);
    const sel = this.store.sel[this.store.sel.tab] === layer.id;
    const color = isT ? t.color : layer.params.colorA;
    const blend = isT ? (t.role === 'generator' ? BLEND_MODES[layer.blend.mode] : 'Modifier') : TEX_BLEND[layer.blend.mode];
    const thumb = h('div.thumb', app.thumbCanvas(layer, isT ? 'terrain' : 'texture', 96), h('span.badge', ic(t.icon, 10, color)));
    const nm = h('div.nm', layer.name);
    const sub = h('div.sub', h('span.sw', { style: { background: color } }), `${t.label} · ${blend}${layer.blend.opacity < 0.999 ? ' ' + Math.round(layer.blend.opacity * 100) + '%' : ''}`);
    const eye = h('button.eye', { title: layer.enabled ? 'Hide' : 'Show' }, ic(layer.enabled ? 'eye' : 'eye-off', 14));
    const dup = h('button', { title: 'Duplicate (Ctrl+D)' }, ic('copy', 13));
    const more = h('button', { title: 'More' }, ic('ellipsis', 14));
    const row = h('div.row' + (sel ? '.sel' : '') + (layer.enabled ? '' : '.off'), { draggable: true }, thumb, h('div.meta', nm, sub), h('div.acts', dup, more, eye));
    row.addEventListener('click', () => app.select(layer.id));
    row.addEventListener('dblclick', (e) => { if (!e.target.closest('.acts')) this._rename(layer, nm); });
    eye.addEventListener('click', (e) => { e.stopPropagation(); layer.enabled = !layer.enabled; this.store.commit(isT ? 'terrain' : 'texture', { id: layer.id }); this.render(); app.inspector.render(); });
    dup.addEventListener('click', (e) => { e.stopPropagation(); app.duplicate(layer.id); });
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      popMenu(more, [
        { label: 'Rename', icon: 'pencil', action: () => this._rename(layer, nm) },
        { label: 'Duplicate', icon: 'copy', right: 'Ctrl D', action: () => app.duplicate(layer.id) },
        { label: 'Move up', icon: 'arrow-up', action: () => app.move(layer.id, +1) },
        { label: 'Move down', icon: 'arrow-down', action: () => app.move(layer.id, -1) },
        { sep: true },
        { label: layer.enabled ? 'Disable' : 'Enable', icon: layer.enabled ? 'eye-off' : 'eye', action: () => { layer.enabled = !layer.enabled; this.store.commit(isT ? 'terrain' : 'texture'); this.render(); app.inspector.render(); } },
        { label: 'Delete', icon: 'trash-2', right: 'Del', action: () => app.remove(layer.id) },
      ], { alignRight: true });
    });
    // drag reorder
    row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', layer.id); e.dataTransfer.effectAllowed = 'move'; row.classList.add('drag'); this._dragId = layer.id; });
    row.addEventListener('dragend', () => { row.classList.remove('drag'); this.list.querySelectorAll('.row').forEach(r => r.classList.remove('drop-above', 'drop-below')); });
    row.addEventListener('dragover', (e) => {
      if (!this._dragId || this._dragId === layer.id) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      const above = e.clientY < r.top + r.height / 2;
      row.classList.toggle('drop-above', above); row.classList.toggle('drop-below', !above);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-above', 'drop-below'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const id = this._dragId; this._dragId = null;
      if (!id || id === layer.id) return;
      const r = row.getBoundingClientRect();
      const above = e.clientY < r.top + r.height / 2; // above in the list = higher in the stack
      const from = layers.findIndex(l => l.id === id);
      const [moved] = layers.splice(from, 1);
      let to = layers.findIndex(l => l.id === layer.id);
      if (above) to += 1;
      layers.splice(to, 0, moved);
      this.store.commit(isT ? 'terrain' : 'texture');
      this.render();
    });
    return row;
  }

  _rename(layer, nm) {
    const inp = h('input.rename', { value: layer.name });
    nm.replaceWith(inp); inp.focus(); inp.select();
    const done = (ok) => {
      if (ok && inp.value.trim()) layer.name = inp.value.trim();
      this.store.commit('meta');
      this.render(); this.app.inspector.render();
    };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    inp.addEventListener('blur', () => done(true));
    inp.addEventListener('click', (e) => e.stopPropagation());
  }

  _scene() {
    this.label.firstChild.textContent = 'Scene';
    this.label.lastChild.textContent = 'Light, air, water and camera';
    for (const it of SCENE_ITEMS) {
      const sel = this.store.sel.scene === it.key;
      const row = h('div.row.scene-row' + (sel ? '.sel' : ''), h('div.thumb', ic(it.icon, 18, it.color)), h('div.meta', h('div.nm', it.label), h('div.sub', it.sub)), h('div'));
      row.addEventListener('click', () => this.app.selectScene(it.key));
      this.list.append(row);
    }
    this.foot.querySelector('.l').textContent = 'Physically based sky';
    this.foot.querySelector('.r').textContent = 'Hillaire 2020';
  }
}
export { newId };
