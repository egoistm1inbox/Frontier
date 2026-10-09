import React, { useState, useEffect } from 'react';
import {
  Layers, Mountain, Droplets, Flame, Waves, Wind, Search, Plus, X, Globe,
  Eye, EyeOff, ChevronUp, Copy, Trash2,
} from 'lucide-react';
import { erosionById } from './terrain/erosion.js';

const erosionIcons = { hydraulic: Droplets, thermal: Flame, fluvial: Waves, aeolian: Wind };
const erosionColors = { hydraulic: '#81b8c8', thermal: '#e69c79', fluvial: '#74bdd4', aeolian: '#d8c077' };
const shapeColor = '#d6a078';
const rootColor = '#a8bbeb';

function layerIcon(layer) {
  if (layer.kind === 'shape') return { Icon: Mountain, color: shapeColor };
  const type = erosionById(layer.erosionType);
  return { Icon: erosionIcons[type.id] || Droplets, color: erosionColors[type.id] || '#81b8c8' };
}

function layerKindLabel(layer) {
  if (layer.kind === 'shape') return 'Shape · generator';
  return `Erosion · ${erosionById(layer.erosionType).label.split(' (')[0]}`;
}

function LayerStack({ layers, selectedId, terrain, onSelect, onToggle, onAdd, onMove, onDuplicate, onDelete }) {
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const visible = layers.filter((l) => l.name.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  useEffect(() => {
    document.querySelector('.tree-row.selected')?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, layers.length]);

  return (
    <aside className="layerstack">
      <div className="brand">
        <div className="brand-symbol"><Layers size={24} strokeWidth={1.5} /></div>
        <span>frontier<span className="brand-dot">.</span></span>
        <span className="version">TERRAIN / 01</span>
      </div>
      <div className="scene-label">WORKSPACE <span className="status-dot" /></div>
      <div className="scene-title"><span>Untitled landscape</span><span className="scene-extension">.terrain</span></div>

      <div className="stack-heading">
        <h2>Layerstack <span>{layers.length.toString().padStart(2, '0')}</span></h2>
        <button className="icon-button" aria-label="Add layer" title="Add layer · Shift+A"
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}>
          {menuOpen ? <X size={17} /> : <Plus size={17} />}
        </button>
      </div>
      {menuOpen && (
        <>
          <div className="add-backdrop" onClick={() => setMenuOpen(false)} />
          <div className="add-menu" role="menu">
            <button role="menuitem" onClick={() => { setMenuOpen(false); onAdd('shape'); }}>
              <Mountain size={15} /> Shape layer <span>generator + mask</span>
            </button>
            <button role="menuitem" onClick={() => { setMenuOpen(false); onAdd('erosion'); }}>
              <Droplets size={15} /> Erosion layer <span>simulation pass</span>
            </button>
          </div>
        </>
      )}

      <label className="search">
        <Search size={15} />
        <input placeholder="Find a layer..." value={query} onChange={(e) => setQuery(e.target.value)} />
        {query ? <button aria-label="Clear search" onClick={() => setQuery('')}><X size={13} /></button> : <span>⌕</span>}
      </label>

      <div className="tree" aria-label="Layer stack">
        <div
          className={`tree-row ${selectedId === 'terrain' ? 'selected' : ''}`}
          style={{ '--entity-color': rootColor }}
          onClick={() => onSelect('terrain')}
        >
          <button className="object-button"><Globe size={15} /><span>Terrain</span></button>
          <span className="row-tag">heightmap · {terrain.size}²</span>
        </div>
        {visible.map((layer, index) => {
          const { Icon, color } = layerIcon(layer);
          const selected = selectedId === layer.id;
          return (
            <React.Fragment key={layer.id}>
              <div
                className={`tree-row ${selected ? 'selected' : ''} ${!layer.enabled ? 'hidden-object' : ''}`}
                style={{ '--entity-color': color }}
              >
                <button className="object-button" onClick={() => onSelect(layer.id)}>
                  <Icon size={15} />
                  <span className="layer-name-cell">
                    <span>{layer.name}</span>
                    <small>{layerKindLabel(layer)}</small>
                  </span>
                  <span className="row-index">{layers.indexOf(layer) + 1}</span>
                </button>
                <button className="visibility" aria-label={`${layer.enabled ? 'Hide' : 'Show'} ${layer.name}`}
                  onClick={() => onToggle(layer.id)}>
                  {layer.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
              </div>
              {selected && (
                <div className="layer-actions">
                  <button title="Move up (applied earlier)" disabled={index === 0} onClick={() => onMove(layer.id, -1)}><ChevronUp size={13} /></button>
                  <button title="Move down (applied later)" disabled={index === layers.length - 1} onClick={() => onMove(layer.id, 1)}><ChevronUp size={13} style={{ transform: 'rotate(180deg)' }} /></button>
                  <button title="Duplicate layer" onClick={() => onDuplicate(layer.id)}><Copy size={13} /></button>
                  <button title="Delete layer" onClick={() => onDelete(layer.id)}><Trash2 size={13} /></button>
                  <span className="layer-actions-tag">{layer.kind === 'shape' ? layer.blend : layer.erosionType} · {Math.round(layer.opacity * 100)}%</span>
                </div>
              )}
            </React.Fragment>
          );
        })}
        {!visible.length && <p className="empty">No layers found.</p>}
      </div>

      <div className="stack-bottom">
        <div className="world-icon"><Globe size={17} /></div>
        <div><strong>Untitled landscape</strong><span>Local project · heightmap</span></div>
        <span className="little-dot" />
      </div>
    </aside>
  );
}

export default LayerStack;
