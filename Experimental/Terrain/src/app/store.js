// Project state with undo/redo (JSON snapshots) and localStorage autosave.
const KEY = 'frontier-terrain:project:v1';
const MAX_HISTORY = 100;

export class Store {
  constructor() {
    this.p = null;
    this.history = [];
    this.index = -1;
    this.listeners = new Set();
    this.sel = { tab: 'terrain', terrain: null, texture: null, scene: 'sun' };
    this._saveT = 0;
    this.savedAt = 0;
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(kind, info = {}) { for (const fn of this.listeners) fn(kind, info); }

  load(project, { keepHistory = false } = {}) {
    this.p = project;
    if (!keepHistory) { this.history = [JSON.stringify(project)]; this.index = 0; }
    const t = project.terrain.layers, x = project.texture.layers;
    this.sel.terrain = t.length ? t[t.length - 1].id : null;
    this.sel.texture = x.length ? x[x.length - 1].id : null;
    this.emit('load');
    this.save();
  }
  // Live edit (drag in progress): no history entry.
  change(kind, info = {}) { this.emit(kind, { ...info, live: true }); }
  // Finished edit: snapshot for undo and autosave.
  commit(kind, info = {}) {
    const s = JSON.stringify(this.p);
    if (s !== this.history[this.index]) {
      this.history = this.history.slice(0, this.index + 1);
      this.history.push(s);
      if (this.history.length > MAX_HISTORY) this.history.shift();
      this.index = this.history.length - 1;
    }
    this.emit(kind, { ...info, live: false });
    this.save();
  }
  canUndo() { return this.index > 0; }
  canRedo() { return this.index < this.history.length - 1; }
  undo() { if (this.canUndo()) this._restore(this.index - 1); }
  redo() { if (this.canRedo()) this._restore(this.index + 1); }
  _restore(i) {
    const prev = this.p;
    this.index = i;
    this.p = JSON.parse(this.history[i]);
    const sameT = JSON.stringify([prev.world, prev.terrain]) === JSON.stringify([this.p.world, this.p.terrain]);
    const sameX = JSON.stringify(prev.texture) === JSON.stringify(this.p.texture);
    const fixSel = (list, id) => (list.find(l => l.id === id) ? id : (list.length ? list[list.length - 1].id : null));
    this.sel.terrain = fixSel(this.p.terrain.layers, this.sel.terrain);
    this.sel.texture = fixSel(this.p.texture.layers, this.sel.texture);
    this.emit('restore', { terrain: !sameT, texture: !sameX });
    this.save();
  }
  save() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(this.p)); this.savedAt = Date.now(); this.emit('saved'); }
      catch (e) { console.warn('autosave failed', e); }
    }, 400);
  }
  static restore() {
    try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; }
  }
  static clearSaved() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
}
