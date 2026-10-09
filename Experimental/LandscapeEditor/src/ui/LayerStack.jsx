import React, { useState } from 'react';
import Glyph from './Glyph.jsx';
import Icon from './Icon.jsx';
import { LayerKinds, ErosionTypes, describeLayer } from '../engine/specs.js';
import { formatMs } from './format.js';

export function layerIcon(layer) {
  if (layer.kind === 'erosion') return ErosionTypes[layer.params.type]?.icon ?? 'erosion';
  return LayerKinds[layer.kind]?.icon ?? 'noise';
}

// Left dock: the layer stack, top of the stack first, with the landscape root and the satmap surface.
export default function LayerStack({ project, selection, result, job, query, onQuery, onSelect, onToggle, onReorder, onRename, onMenu, onAddMenu, onRowMenu, onSelectLandscape }) {
  const layers = project.layers;
  const shown = [...layers].reverse();
  const enabled = layers.filter((layer) => layer.enabled).length;
  const disabled = layers.length - enabled;
  const q = query.trim().toLowerCase();
  const [dragId, setDragId] = useState(null);
  const [drop, setDrop] = useState(null);
  const [renaming, setRenaming] = useState(null);

  const isSelected = (kind, id) => selection.kind === kind && (kind !== 'layer' || selection.id === id);

  const finishRename = (layer, text) => {
    setRenaming(null);
    const next = text.trim();
    if (next && next !== layer.name) onRename(layer.id, next);
  };

  return (
    <>
      <div className="outliner-heading">
        <h1>Layers</h1>
        <small>
          {layers.length} in stack · {project.settings.resolution}²
        </small>
        <button type="button" aria-label="Layer menu" title="Layer menu" onClick={(event) => onMenu(event)}>
          <Glyph name="filter" size={15} />
        </button>
      </div>
      <div className="stats lx-stats">
        <div>
          <span className="status-disc">
            <Glyph name="check" size={15} />
          </span>
          <small>Enabled</small>
          <strong>{enabled}</strong>
        </div>
        <div>
          <span className="muted-disc">△</span>
          <small>Disabled</small>
          <strong>{disabled}</strong>
        </div>
      </div>
      <div className="outliner-search">
        <label>
          <Glyph name="search" size={15} />
          <input
            aria-label="Search layers"
            placeholder="Search layers"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
          />
        </label>
        <button type="button" aria-label="Add layer" onClick={(event) => onAddMenu(event)}>
          <Glyph name="plus" size={13} />
          Add layer
          <Glyph name="chevron" size={12} />
        </button>
      </div>
      <div className="outliner-rows" role="tree" aria-label="Layer stack">
        <div
          role="treeitem"
          aria-selected={isSelected('landscape')}
          tabIndex={0}
          className={'outliner-row ' + (isSelected('landscape') ? 'selected' : '')}
          style={{ '--depth': 0 }}
          onClick={onSelectLandscape}
          onContextMenu={(event) => onRowMenu(event, { kind: 'landscape' })}
        >
          <span className="row-disclosure empty" aria-hidden="true">
            <Glyph name="chevron" size={12} />
          </span>
          <Icon name="terrain" size={24} />
          <span className="lx-row-text">
            <strong>Landscape</strong>
            <small>
              {project.settings.size} m · {project.settings.maxHeight} m relief
            </small>
          </span>
        </div>
        <div className="lx-group-label">Stack · top first</div>
        {shown.map((layer) => {
          if (q && !layer.name.toLowerCase().includes(q) && !LayerKinds[layer.kind].label.toLowerCase().includes(q)) return null;
          const selected = isSelected('layer', layer.id);
          const dropClass = drop && drop.id === layer.id ? (drop.position === 'before' ? ' lx-drop-before' : ' lx-drop-after') : '';
          const busy = job?.running && job.layerId === layer.id;
          const metrics = result?.layers?.find((entry) => entry.id === layer.id);
          return (
            <div
              key={layer.id}
              role="treeitem"
              aria-selected={selected}
              tabIndex={0}
              draggable={renaming !== layer.id}
              className={'outliner-row lx-layer ' + (selected ? 'selected ' : '') + (layer.enabled ? '' : 'hidden-row ') + (busy ? 'busy ' : '') + dropClass}
              style={{ '--depth': 1 }}
              onClick={() => onSelect({ kind: 'layer', id: layer.id })}
              onDoubleClick={() => setRenaming(layer.id)}
              onContextMenu={(event) => onRowMenu(event, { kind: 'layer', id: layer.id })}
              onKeyDown={(event) => {
                if (event.key === 'F2') setRenaming(layer.id);
                if (event.key === 'Enter') onSelect({ kind: 'layer', id: layer.id });
              }}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', layer.id);
                setDragId(layer.id);
              }}
              onDragOver={(event) => {
                if (!dragId || dragId === layer.id) return;
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                if (!drop || drop.id !== layer.id || drop.position !== position) setDrop({ id: layer.id, position });
              }}
              onDragLeave={() => setDrop((current) => (current && current.id === layer.id ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                if (!dragId || dragId === layer.id) return;
                const index = layers.findIndex((entry) => entry.id === layer.id);
                // 'before' means visually above, which is a higher stack index.
                const target = drop && drop.position === 'before' ? index + 1 : index;
                onReorder(dragId, target);
                setDragId(null);
                setDrop(null);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDrop(null);
              }}
            >
              <span className="row-disclosure empty" aria-hidden="true">
                <Glyph name="chevron" size={12} />
              </span>
              <Icon name={layerIcon(layer)} size={24} />
              <span className="lx-row-text">
                {renaming === layer.id ? (
                  <input
                    autoFocus
                    aria-label="Rename layer"
                    defaultValue={layer.name}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === 'Enter') finishRename(layer, event.currentTarget.value);
                      if (event.key === 'Escape') setRenaming(null);
                    }}
                    onBlur={(event) => finishRename(layer, event.currentTarget.value)}
                  />
                ) : (
                  <strong>{layer.name}</strong>
                )}
                <small>
                  {layer.enabled ? describeLayer(layer) : 'Off · ' + describeLayer(layer)}
                  {metrics?.cached && layer.enabled ? ' · cached' : ''}
                </small>
              </span>
              <button
                type="button"
                className="visibility"
                aria-label={(layer.enabled ? 'Hide ' : 'Show ') + layer.name}
                title={layer.enabled ? 'Hide layer' : 'Show layer'}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggle(layer.id);
                }}
              >
                <Glyph name="eye" size={15} />
              </button>
              {busy && (
                <span className="lx-progress lx-row-progress" aria-hidden="true">
                  <i style={{ '--p': `${Math.round((job.fraction || 0) * 100)}%` }} />
                </span>
              )}
            </div>
          );
        })}
        <div className="lx-group-label">Surface</div>
        <div
          role="treeitem"
          aria-selected={isSelected('satmap')}
          tabIndex={0}
          className={'outliner-row ' + (isSelected('satmap') ? 'selected' : '')}
          style={{ '--depth': 1 }}
          onClick={() => onSelect({ kind: 'satmap' })}
          onContextMenu={(event) => onRowMenu(event, { kind: 'satmap' })}
        >
          <span className="row-disclosure empty" aria-hidden="true">
            <Glyph name="chevron" size={12} />
          </span>
          <Icon name="satmap" size={24} />
          <span className="lx-row-text">
            <strong>Satmap texture</strong>
            <small>
              {project.satmap.source === 'imported' ? 'Imported image blend' : 'Procedural'} · {project.satmap.resolution}²
            </small>
          </span>
        </div>
      </div>
      <footer className="outliner-footer">
        <span>
          <small>EVAL</small>
          <b>{result ? formatMs(result.stats.milliseconds) : '—'}</b>
        </span>
        <span>
          <small>CACHED</small>
          <b>
            {result ? result.cacheHits : 0}/{layers.length}
          </b>
        </span>
        <span>
          <small>SIZE</small>
          <b>{project.settings.size} m</b>
        </span>
      </footer>
    </>
  );
}
