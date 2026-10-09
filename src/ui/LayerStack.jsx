/**
 * Frontier Landscape Studio — the layer stack.
 *
 * Left column of the shell, built from the reference editor's outliner: brand,
 * workspace label, document title, heading with a count pill and a **+** menu,
 * search, collapsible groups and tree rows. Rows are Photoshop-ordered — the
 * top row is the top of the stack and is baked last.
 */

import React, { useMemo, useState } from 'react';
import {
  Layers, Plus, X, Search, Eye, EyeOff, ChevronDown, ChevronRight, GripVertical,
  Mountain, Palette, Globe, Box, Brush, Waves, Droplet, Info,
} from 'lucide-react';
import { layerIcon } from './icons.jsx';
import { LAYER_LIBRARY } from '../core/layers.js';
import { MATERIALS } from '../core/textures.js';
import { BLEND_MODES } from '../core/layers.js';

const blendName = (id) => (BLEND_MODES.find((b) => b.id === id) || {}).name || id;

const CATEGORIES = ['Generator', 'Modifier', 'Process', 'Paint'];

function AddLayerMenu({ onAdd, onAddTexture, onClose }) {
  const [tab, setTab] = useState('shape');
  return (
    <div className="add-menu" role="dialog" aria-label="Add a layer">
      <div className="segments" style={{ margin: '2px 2px 8px' }}>
        <button type="button" aria-pressed={tab === 'shape'} onClick={() => setTab('shape')}>Height</button>
        <button type="button" aria-pressed={tab === 'surface'} onClick={() => setTab('surface')}>Surface</button>
      </div>

      {tab === 'shape' ? (
        <>
          {CATEGORIES.map((category) => {
            const types = LAYER_LIBRARY.filter((t) => t.category === category);
            if (!types.length) return null;
            return (
              <React.Fragment key={category}>
                <p>{category}</p>
                {types.map((type) => {
                  const Icon = layerIcon(type.id);
                  return (
                    <button
                      key={type.id}
                      type="button"
                      title={type.summary}
                      style={{ '--tile-color': type.accent }}
                      onClick={() => { onAdd(type.id); onClose(); }}
                    >
                      <Icon size={15} />
                      {type.name}
                      <small>{type.heavy ? 'Slow' : category.slice(0, 3)}</small>
                    </button>
                  );
                })}
              </React.Fragment>
            );
          })}
        </>
      ) : (
        <>
          <p>Texture layer</p>
          <button type="button" style={{ '--tile-color': '#c5a6d7' }} onClick={() => { onAddTexture('splat'); onClose(); }}>
            <Palette size={15} /> Splat material <small>Rule</small>
          </button>
          <button type="button" style={{ '--tile-color': '#8fa87c' }} onClick={() => { onAddTexture('satmap'); onClose(); }}>
            <Globe size={15} /> Satellite drape <small>Image</small>
          </button>
          <p>Material presets</p>
          {MATERIALS.map((m) => (
            <button
              key={m.id}
              type="button"
              style={{ '--tile-color': m.b }}
              onClick={() => { onAddTexture('splat', m.id); onClose(); }}
            >
              <span
                style={{
                  width: 15, height: 15, borderRadius: 5, flexShrink: 0,
                  background: `linear-gradient(135deg, ${m.a}, ${m.b})`, border: '1px solid #ffffff2b',
                }}
              />
              {m.name}
            </button>
          ))}
        </>
      )}
    </div>
  );
}

function LayerRow({
  layer, index, total, selected, onSelect, onToggle, onDragStart, onDragOver, onDrop, dropEdge, dragging, busy,
}) {
  const Icon = layerIcon(layer.type);
  const isTexture = layer.kind === 'splat' || layer.kind === 'satmap';
  const blend = layer.kind ? (layer.enabled === false ? 'off' : 'on') : blendName(layer.blend);
  const opacity = layer.opacity === undefined ? 1 : layer.opacity;
  const swatch = layer.kind === 'splat'
    ? `linear-gradient(135deg, ${layer.params?.colorA || '#666'}, ${layer.params?.colorB || '#999'})`
    : layer.kind === 'satmap'
      ? 'linear-gradient(135deg, #5c7a4a, #8fa87c 45%, #6f83a8)'
      : null;

  return (
    <div
      className={[
        'tree-row', 'layer-row',
        selected ? 'selected' : '',
        layer.enabled === false ? 'disabled-layer' : '',
        dragging ? 'dragging' : '',
        dropEdge === 'above' ? 'drop-above' : '',
        dropEdge === 'below' ? 'drop-below' : '',
        busy ? 'processing' : '',
      ].filter(Boolean).join(' ')}
      style={{ '--entity-color': layer.color || (isTexture ? '#b8a6d2' : '#9a9a9a') }}
      draggable
      onDragStart={(e) => onDragStart(e, layer.id)}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, layer.id)}
    >
      <span className="drag-handle" aria-hidden="true"><GripVertical size={13} /></span>
      <button className="object-button" type="button" onClick={() => onSelect(layer.id)}>
        <span className="layer-index">{String(total - index).padStart(2, '0')}</span>
        <span className="layer-glyph" style={swatch ? { background: swatch, border: '1px solid #ffffff2b' } : undefined}>
          {swatch ? null : <Icon size={14} />}
        </span>
        <span className="layer-meta">
          <span>{layer.name}</span>
          <small>{isTexture ? (layer.kind === 'satmap' ? 'Satellite drape' : 'Splat material') : layer.type}</small>
        </span>
        {!isTexture && opacity < 1 ? <span className="blend-badge">{Math.round(opacity * 100)}%</span> : null}
        {!isTexture ? <span className="blend-badge">{blend === 'Replace' ? 'norm' : blend}</span> : null}
      </button>
      <button
        className="visibility"
        type="button"
        aria-label={`${layer.enabled === false ? 'Enable' : 'Disable'} ${layer.name}`}
        onClick={() => onToggle(layer.id)}
      >
        {layer.enabled === false ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
      <span className="layer-opacity"><i style={{ width: `${Math.round(opacity * 100)}%` }} /></span>
    </div>
  );
}

export default function LayerStack({
  project, selectedId, onSelect, onAddLayer, onAddTextureLayer, onToggleLayer,
  onReorderShape, onReorderTexture, query, setQuery, stats, busyLayerId, onRename,
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const [dragId, setDragId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  const shape = project.layers;
  const surface = project.texture?.layers || [];

  const filter = (list) => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((l) => l.name.toLowerCase().includes(q) || l.type.toLowerCase().includes(q));
  };
  const shapeList = useMemo(() => filter(shape), [shape, query]);
  const surfaceList = useMemo(() => filter(surface), [surface, query]);

  const reorder = (list, listKind, fromId, toId, edge) => {
    const from = list.findIndex((l) => l.id === fromId);
    let to = list.findIndex((l) => l.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    if (edge === 'above') to -= 1;
    if (to < 0) to = 0;
    if (to > list.length - 1) to = list.length - 1;
    // The displayed list is reversed relative to bake order.
    const n = list.length;
    if (listKind === 'shape') onReorderShape(n - 1 - from, n - 1 - to);
    else onReorderTexture(n - 1 - from, n - 1 - to);
  };

  const handleDragOver = (event, id) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const edge = event.clientY < rect.top + rect.height / 2 ? 'above' : 'below';
    setDropTarget({ id, edge });
  };

  const handleDrop = (event, id, list, kind) => {
    event.preventDefault();
    if (dragId && dragId !== id) reorder(list, kind, dragId, id, dropTarget?.edge || 'below');
    setDragId(null);
    setDropTarget(null);
  };

  const group = (title, icon, list, kind, count) => {
    const Icon = icon;
    const open = !collapsed[kind] || !!query;
    return (
      <div className="group">
        <button
          className="group-label"
          type="button"
          aria-expanded={open}
          onClick={() => setCollapsed((s) => ({ ...s, [kind]: !s[kind] }))}
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Icon size={12} />
          <span>{title}</span>
          <span className="group-count">{count}</span>
        </button>
        {(open || !!query) && list.map((layer, displayIndex) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            index={displayIndex}
            total={list.length}
            selected={selectedId === layer.id}
            busy={busyLayerId === layer.id}
            onSelect={onSelect}
            onToggle={onToggleLayer}
            dragging={dragId === layer.id}
            dropEdge={dropTarget?.id === layer.id ? dropTarget.edge : null}
            onDragStart={(e, id) => { setDragId(id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); }}
            onDragOver={(e) => handleDragOver(e, layer.id)}
            onDrop={(e, id) => handleDrop(e, id, list, kind)}
          />
        ))}
        {(open || !!query) && !list.length && <p className="empty">No layers match.</p>}
      </div>
    );
  };

  return (
    <aside className="outliner layer-panel">
      <div className="brand">
        <div className="brand-symbol"><Layers size={24} strokeWidth={1.5} /></div>
        <span className="brand-name">frontier<span className="brand-dot">.</span></span>
        <span className="version">LANDSCAPE / 01</span>
      </div>

      <div className="scene-label">
        WORKSPACE <span className="status-dot" />
      </div>
      <div className="scene-title">
        <input
          value={project.name}
          aria-label="Landscape name"
          maxLength={48}
          onChange={(e) => onRename(e.target.value)}
        />
        <span className="scene-extension">.landscape</span>
      </div>

      <div className="outliner-heading">
        <h2>Layer stack <span>{String(shape.length + surface.length).padStart(2, '0')}</span></h2>
        <button
          className="icon-button"
          type="button"
          aria-label="Add a layer"
          title="Add a layer"
          onClick={() => setAddOpen((v) => !v)}
        >
          {addOpen ? <X size={17} /> : <Plus size={17} />}
        </button>
      </div>

      {addOpen && (
        <AddLayerMenu
          onAdd={onAddLayer}
          onAddTexture={onAddTextureLayer}
          onClose={() => setAddOpen(false)}
        />
      )}

      <label className="search">
        <Search size={15} />
        <input
          placeholder="Find a layer…"
          value={query}
          aria-label="Search layers"
          onChange={(e) => setQuery(e.target.value)}
        />
        {query
          ? <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X size={13} /></button>
          : <span>⌕</span>}
      </label>

      <div className="stack-scroll">
        <div
          className={`tree-row ${selectedId === 'landscape' ? 'selected' : ''}`}
          style={{ '--entity-color': '#d6a078', marginBottom: 10 }}
        >
          <button className="object-button" type="button" onClick={() => onSelect('landscape')}>
            <span className="layer-glyph" style={{ width: 28, height: 28 }}>
              <Mountain size={15} />
            </span>
            <span className="layer-meta">
              <span>Landscape document</span>
              <small>Grid · sun · water · export</small>
            </span>
            <span className="blend-badge">{shape.length + surface.length} layers</span>
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 14px 9px', fontSize: 8, letterSpacing: 1.3, color: '#6f6f6f' }}>
          <Info size={11} /> TOP OF STACK · BAKES LAST
        </div>
        {group('Surface', Palette, [...surfaceList].reverse(), 'surface', surface.length)}
        {group('Shape', Mountain, [...shapeList].reverse(), 'shape', shape.length)}
        <div style={{ padding: '2px 14px 14px', fontSize: 8, letterSpacing: 1.3, color: '#5f5f5f', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Box size={11} /> BASE · BAKES FIRST
        </div>
      </div>

      <div className="stack-summary">
        <dl>
          <div><dt>Grid</dt><dd>{project.resolution}<small>²</small></dd></div>
          <div><dt>Triangles</dt><dd>{(stats.triangles / 1000).toFixed(0)}<small>k</small></dd></div>
          <div><dt>Relief</dt><dd>{Math.round(stats.range || 0)}<small>m</small></dd></div>
          <div><dt>Bake</dt><dd>{stats.ms ? `${Math.round(stats.ms)}` : '—'}<small>ms</small></dd></div>
        </dl>
      </div>

      <div className="outliner-bottom">
        <div className="world-icon"><Brush size={17} /></div>
        <div style={{ minWidth: 0 }}>
          <strong>Landscape Studio</strong>
          <span>{project.resolution}² · {project.worldSize} m</span>
        </div>
        <span className="little-dot" />
      </div>
    </aside>
  );
}
