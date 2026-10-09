// Panels for the terrain workspace: the two stack lists, the layer picker and the inspector cards.
// Controlled components: state lives in terrain.jsx, and every edit goes through the `act` callbacks.
// Undo grouping: a drag passes the same `group` string on every tick, so it becomes one undo step.

import React, { useEffect, useState } from 'react';
import {
  Mountain, SlidersHorizontal, Rows3, Boxes, CircleDot, TrendingDown, Route, Droplets, Waves, Droplet,
  Anchor, Layers, Eye, EyeOff, Plus, X, Copy, ChevronUp, ChevronDown, Trash2, Search, Spline, Ruler,
  Gem, Sparkles, PaintBucket, Leaf, Snowflake, Scan, CloudRain, Sprout, MountainSnow, TrendingUp,
  Filter, Globe, Download, Check,
} from 'lucide-react';
import { TERRAIN_TYPES, TERRAIN_CATEGORIES, TERRAIN_BLEND_MODES } from './catalog-terrain.js';
import { TEXTURE_TYPES, TEXTURE_CATEGORIES, TEXTURE_BLEND_MODES } from './catalog-texture.js';
import { MASK_TYPES, MASK_BLEND_MODES } from './catalog-mask.js';

export const TERRAIN_ICON = {
  relief: Mountain, shape: SlidersHorizontal, smooth: Layers, strata: Rows3, rugged: Boxes, boulders: CircleDot,
  thermal: TrendingDown, fluvial: Route, hydraulic: Droplets, rivers: Waves, lakes: Droplet, sea: Anchor,
};
export const TEXTURE_ICON = {
  fill: PaintBucket, rock: Gem, cliff: MountainSnow, soil: Sprout, grass: Leaf, snow: Snowflake,
  gravel: CircleDot, silt: Droplet, water: Droplets, cavity: Scan, wetness: CloudRain, grain: Sparkles,
};
export const MASK_ICON = {
  height: Mountain, slope: TrendingUp, curvature: Spline, flow: Route, distance: Ruler, water: Waves, hardness: Gem, noise: Sparkles,
};
export const CATEGORY_ICON = {
  base: Mountain, shape: SlidersHorizontal, rugged: Boxes, cliffs: Rows3, erosion: Route, water: Waves,
  fill: PaintBucket, surface: Layers, detail: Sparkles,
};
const MASK_TAG = { multiply: 'AND', add: 'OR', subtract: 'SUB', max: 'MAX', min: 'MIN', replace: 'SET' };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const decimalsOf = (step) => (String(step).split('.')[1] || '').length;

export function layerDefs(kind) {
  return kind === 'terrain' ? TERRAIN_TYPES : TEXTURE_TYPES;
}

// Numeric control: slider for dragging, number box for exact values. The number box keeps its own
// draft while typing, so "0." does not snap to "0.00" mid-keystroke.
export function Slider({ label, unit = '', value, min, max, step = 1, onChange }) {
  const [draft, setDraft] = useState(null);
  const d = decimalsOf(step);
  const v = Number.isFinite(value) ? value : min;
  const pct = max > min ? clamp(((v - min) / (max - min)) * 100, 0, 100) : 0;
  return (
    <div className="param">
      <div className="control-line">
        <span>{label}</span>
        <span className="param-value">
          <input
            className="num-input"
            type="number"
            min={min}
            max={max}
            step={step}
            value={draft ?? v.toFixed(d)}
            onFocus={() => setDraft(v.toFixed(d))}
            onBlur={() => setDraft(null)}
            onChange={(e) => {
              setDraft(e.target.value);
              const n = Number(e.target.value);
              if (e.target.value !== '' && Number.isFinite(n)) onChange(clamp(n, min, max));
            }}
          />
          {unit && <small>{unit}</small>}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={clamp(v, min, max)}
        style={{ '--progress': `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function OptionControl({ label, options, value, onChange }) {
  const opts = options.map((o) => (typeof o === 'string' ? { id: o, label: o } : o));
  return (
    <div className="param">
      <div className="control-line"><span>{label}</span></div>
      {opts.length <= 4 ? (
        <div className="segmented full">
          {opts.map((o) => (
            <button key={o.id} className={o.id === value ? 'on' : ''} onClick={() => onChange(o.id)}>{o.label}</button>
          ))}
        </div>
      ) : (
        <select className="select block" value={value} onChange={(e) => onChange(e.target.value)}>
          {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      )}
    </div>
  );
}

export function ColourControl({ label, value, onChange }) {
  return (
    <div className="param">
      <div className="control-line"><span>{label}</span><span className="hex">{value}</span></div>
      <input className="colour" type="color" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// One control for any catalogue parameter: colour, option list or number.
export function ParamControl({ spec, value, onChange }) {
  if (spec.colour) {
    const v = /^#[0-9a-fA-F]{6}$/.test(value) ? value : spec.value;
    return <ColourControl label={spec.label} value={v} onChange={onChange} />;
  }
  if (spec.options) {
    return <OptionControl label={spec.label} options={spec.options} value={spec.options.includes(value) ? value : spec.value} onChange={onChange} />;
  }
  const v = typeof value === 'number' && Number.isFinite(value) ? value : spec.value;
  return <Slider label={spec.label} unit={spec.unit || ''} value={v} min={spec.min} max={spec.max} step={spec.step} onChange={onChange} />;
}

export function FieldSelect({ label, value, options, onChange }) {
  return (
    <label className="field-row">
      <span>{label}</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function Switch({ label, on, onChange }) {
  return (
    <div className="toggle-row">
      <span>{label}</span>
      <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} onClick={() => onChange(!on)}><span /></button>
    </div>
  );
}

export function Card({ title, icon: Icon, wide = false, aside = null, children }) {
  return (
    <section className={`card terrain-card ${wide ? 'wide-card' : ''}`}>
      <div className="card-heading">
        <span>{Icon && <Icon size={16} />}{title}</span>
        {aside}
      </div>
      <div className="card-body">{children}</div>
    </section>
  );
}

// Outliner: one stack, top of the stack first (the last layer evaluated sits on top, as in Gaea).
export function StackList({ kind, title, layers, sel, act, onAdd }) {
  const defs = layerDefs(kind);
  const icons = kind === 'terrain' ? TERRAIN_ICON : TEXTURE_ICON;
  const top = [...layers].reverse();
  const cats = kind === 'terrain' ? TERRAIN_CATEGORIES : TEXTURE_CATEGORIES;
  return (
    <div className="stack-section">
      <div className="outliner-heading stack-heading">
        <h2>{title}<span>{String(layers.length).padStart(2, '0')}</span></h2>
        <button className="icon-button" aria-label={`Add ${title.toLowerCase()} layer`} title="Add layer" onClick={() => onAdd(kind)}>
          <Plus size={17} />
        </button>
      </div>
      <div className="stack-list">
        {top.map((layer, n) => {
          const Icon = icons[layer.type] || Layers;
          const def = defs[layer.type];
          const isSel = sel.stack === kind && sel.id === layer.id;
          // a category label starts each run of consecutive layers that share a category
          const catId = def?.category;
          const prevCat = n > 0 ? defs[top[n - 1].type]?.category : null;
          const catName = (cats.find((c) => c.id === catId) || {}).name || catId || '';
          return (
            <React.Fragment key={layer.id}>
            {catId !== prevCat && <div className="stack-category">{catName}</div>}
            <div className="stack-group">
              <div className={`tree-row layer-row ${isSel && !sel.mask ? 'selected' : ''} ${layer.enabled ? '' : 'hidden-object'}`}>
                <button className="object-button" onClick={() => act.selectLayer(kind, layer.id)}>
                  <Icon size={15} />
                  <span className="row-name">{def ? def.name : layer.type}</span>
                  {layer.masks.length > 0 && <span className="mask-badge" title="Masks on this layer">{layer.masks.length}</span>}
                </button>
                <button
                  className="visibility"
                  title={layer.enabled ? 'Disable layer' : 'Enable layer'}
                  aria-label={layer.enabled ? 'Disable layer' : 'Enable layer'}
                  onClick={() => act.toggleLayer(kind, layer.id)}
                >
                  {layer.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
              </div>
              {layer.masks.map((mask) => {
                const MIcon = MASK_ICON[mask.type] || Filter;
                const mSel = isSel && sel.mask === mask.id;
                return (
                  <div className={`tree-row mask-row ${mSel ? 'selected' : ''} ${mask.enabled ? '' : 'hidden-object'}`} key={mask.id}>
                    <button className="object-button" onClick={() => act.selectMask(kind, layer.id, mask.id)}>
                      <MIcon size={13} />
                      <span className="row-name">{MASK_TYPES[mask.type] ? MASK_TYPES[mask.type].name : mask.type}</span>
                      <span className="mask-tag">{mask.invert ? 'NOT ' : ''}{MASK_TAG[mask.blend] || 'AND'}</span>
                    </button>
                    <button
                      className="visibility"
                      title={mask.enabled ? 'Disable mask' : 'Enable mask'}
                      aria-label={mask.enabled ? 'Disable mask' : 'Enable mask'}
                      onClick={() => act.toggleMask(kind, layer.id, mask.id)}
                    >
                      {mask.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>
                  </div>
                );
              })}
            </div>
            </React.Fragment>
          );
        })}
        {layers.length === 0 && <p className="empty">No layers yet. Use + to add one.</p>}
      </div>
    </div>
  );
}

// Layer picker: categories on the left, one card per layer type. Escape or a click outside closes it.
export function Picker({ kind, onPick, onClose }) {
  const cats = kind === 'terrain' ? TERRAIN_CATEGORIES : TEXTURE_CATEGORIES;
  const defs = layerDefs(kind);
  const icons = kind === 'terrain' ? TERRAIN_ICON : TEXTURE_ICON;
  const [cat, setCat] = useState(cats[0].id);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const q = query.trim().toLowerCase();
  const entries = Object.entries(defs).filter(([, d]) => (q ? `${d.name} ${d.blurb}`.toLowerCase().includes(q) : d.category === cat));
  const countFor = (id) => Object.values(defs).filter((d) => d.category === id).length;
  return (
    <div className="picker-backdrop" onMouseDown={onClose}>
      <section className="picker" role="dialog" aria-label={kind === 'terrain' ? 'Add terrain layer' : 'Add texturing layer'} onMouseDown={(e) => e.stopPropagation()}>
        <header className="picker-top">
          <div>
            <div className="eyebrow">{kind === 'terrain' ? 'Terrain stack' : 'Texturing stack'}</div>
            <h2>{kind === 'terrain' ? 'Add a terrain layer' : 'Add a texturing layer'}</h2>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </header>
        <label className="search picker-search">
          <Search size={15} />
          <input autoFocus placeholder="Search layers" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="picker-body">
          <nav className="picker-nav">
            {cats.map((c) => {
              const Icon = CATEGORY_ICON[c.id] || Layers;
              return (
                <button key={c.id} className={!q && cat === c.id ? 'on' : ''} onClick={() => { setCat(c.id); setQuery(''); }}>
                  <Icon size={14} /><span>{c.name}</span><small>{countFor(c.id)}</small>
                </button>
              );
            })}
          </nav>
          <div className="picker-grid">
            {entries.map(([id, d]) => {
              const Icon = icons[id] || Layers;
              return (
                <button key={id} className="picker-card" onClick={() => onPick(id)}>
                  <Icon size={18} />
                  <strong>{d.name}</strong>
                  <span>{d.blurb}</span>
                  {kind === 'terrain' && <em>{d.kind === 'generator' ? 'Generator · adds height' : 'Effect · rewrites the surface'}</em>}
                </button>
              );
            })}
            {entries.length === 0 && <p className="empty">Nothing matches “{query}”.</p>}
          </div>
        </div>
      </section>
    </div>
  );
}

// Layer inspector: blend and opacity, parameters, then the mask stack.
export function LayerPanel({ kind, layer, index, total, timing, act, onOpenMask }) {
  const [addType, setAddType] = useState('height');
  const def = layerDefs(kind)[layer.type];
  const Icon = (kind === 'terrain' ? TERRAIN_ICON : TEXTURE_ICON)[layer.type] || Layers;
  const cat = (kind === 'terrain' ? TERRAIN_CATEGORIES : TEXTURE_CATEGORIES).find((c) => c.id === def.category);
  const blends = kind === 'terrain' ? TERRAIN_BLEND_MODES[def.kind] : TEXTURE_BLEND_MODES;
  const above = total - index - 1;
  const below = index;
  const position = `Stack position ${total - index} of ${total}: ${below === 0 ? 'evaluated first' : `evaluated after ${below} layer${below === 1 ? '' : 's'}`}${above ? `, ${above} above` : ''}.`;
  return (
    <>
      <header className="object-header">
        <div className="object-title">
          <div>
            <div className="eyebrow">{cat ? cat.name : 'Layer'} · {kind === 'terrain' ? 'Terrain layer' : 'Texturing layer'}</div>
            <h1>{def.name}</h1>
          </div>
        </div>
        <div className="object-actions">
          <button className="icon-only" title="Move up the stack" aria-label="Move up the stack" disabled={index >= total - 1} onClick={() => act.moveLayer(kind, layer.id, 1)}><ChevronUp size={15} /></button>
          <button className="icon-only" title="Move down the stack" aria-label="Move down the stack" disabled={index <= 0} onClick={() => act.moveLayer(kind, layer.id, -1)}><ChevronDown size={15} /></button>
          <button className="icon-only" title="Duplicate layer" aria-label="Duplicate layer" onClick={() => act.duplicateLayer(kind, layer.id)}><Copy size={14} /></button>
          <button className="icon-only danger" title="Delete layer" aria-label="Delete layer" onClick={() => act.removeLayer(kind, layer.id)}><Trash2 size={14} /></button>
          <button className={`enabled-pill ${layer.enabled ? '' : 'disabled'}`} onClick={() => act.toggleLayer(kind, layer.id)}>
            <span />{layer.enabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>
      </header>
      <p className="muted lede">{def.blurb}</p>
      <div className="cards">
        <Card title="Layer" icon={Icon}>
          <FieldSelect label="Blend" value={layer.blend} options={blends} onChange={(v) => act.patchLayer(kind, layer.id, { blend: v })} />
          <Slider
            label="Opacity" unit="%" value={Math.round((layer.opacity ?? 1) * 100)} min={0} max={100} step={1}
            onChange={(v) => act.patchLayer(kind, layer.id, { opacity: v / 100 }, `o:${layer.id}`)}
          />
          <p className="muted">{position}</p>
          <p className="muted">{timing}</p>
        </Card>
        <Card title="Parameters" icon={SlidersHorizontal} wide>
          {def.params.map((spec) => (
            <ParamControl
              key={spec.key}
              spec={spec}
              value={layer.params[spec.key]}
              onChange={(v) => act.patchParam(kind, layer.id, spec.key, v, `p:${layer.id}:${spec.key}`)}
            />
          ))}
        </Card>
        <Card title="Masks" icon={Filter} wide aside={<span className="count-tag">{layer.masks.length}</span>}>
          <p className="muted first">Read top to bottom. Each mask narrows where this layer lands; with no masks it applies everywhere.</p>
          <div className="mask-list">
            {layer.masks.map((m) => {
              const MI = MASK_ICON[m.type] || Filter;
              return (
                <div className={`mask-item ${m.enabled ? '' : 'off'}`} key={m.id}>
                  <button className="mask-open" onClick={() => onOpenMask(m.id)}>
                    <MI size={14} />
                    <span>{MASK_TYPES[m.type] ? MASK_TYPES[m.type].name : m.type}</span>
                    <small>{(MASK_BLEND_MODES.find((b) => b.id === m.blend) || { label: m.blend }).label}{m.invert ? ' · inverted' : ''}</small>
                  </button>
                  <button className="icon-only" title={m.enabled ? 'Disable mask' : 'Enable mask'} aria-label={m.enabled ? 'Disable mask' : 'Enable mask'} onClick={() => act.toggleMask(kind, layer.id, m.id)}>
                    {m.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="add-row">
            <select className="select" value={addType} onChange={(e) => setAddType(e.target.value)} aria-label="Mask type">
              {Object.entries(MASK_TYPES).map(([id, d]) => <option key={id} value={id}>{d.name}</option>)}
            </select>
            <button className="tool-button" onClick={() => act.addMask(kind, layer.id, addType)}><Plus size={14} />Add mask</button>
          </div>
        </Card>
      </div>
    </>
  );
}

// Mask inspector: combine mode, opacity, invert, and the mask's own parameters.
export function MaskPanel({ kind, layer, mask, act, onBack }) {
  const def = MASK_TYPES[mask.type];
  const Icon = MASK_ICON[mask.type] || Filter;
  const layerDef = layerDefs(kind)[layer.type];
  return (
    <>
      <header className="object-header">
        <div className="object-title">
          <div>
            <div className="eyebrow"><button className="crumb" onClick={onBack}>{layerDef ? layerDef.name : 'Layer'}</button> · Mask</div>
            <h1>{def.name}</h1>
          </div>
        </div>
        <div className="object-actions">
          <button className="icon-only danger" title="Delete mask" aria-label="Delete mask" onClick={() => act.removeMask(kind, layer.id, mask.id)}><Trash2 size={14} /></button>
          <button className={`enabled-pill ${mask.enabled ? '' : 'disabled'}`} onClick={() => act.toggleMask(kind, layer.id, mask.id)}>
            <span />{mask.enabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>
      </header>
      <p className="muted lede">{def.blurb}</p>
      <div className="cards">
        <Card title="Combine" icon={Icon}>
          <FieldSelect label="Combine with masks above" value={mask.blend} options={MASK_BLEND_MODES} onChange={(v) => act.patchMask(kind, layer.id, mask.id, { blend: v })} />
          <Slider
            label="Opacity" unit="%" value={Math.round((mask.opacity ?? 1) * 100)} min={0} max={100} step={1}
            onChange={(v) => act.patchMask(kind, layer.id, mask.id, { opacity: v / 100 }, `mo:${mask.id}`)}
          />
          <Switch label="Invert" on={!!mask.invert} onChange={(v) => act.patchMask(kind, layer.id, mask.id, { invert: v })} />
          <p className="muted">The first mask sets the base; each later one combines with the result.</p>
        </Card>
        <Card title="Parameters" icon={SlidersHorizontal} wide>
          {def.params.map((spec) => (
            <ParamControl
              key={spec.key}
              spec={spec}
              value={mask.params[spec.key]}
              onChange={(v) => act.patchMaskParam(kind, layer.id, mask.id, spec.key, v, `mp:${mask.id}:${spec.key}`)}
            />
          ))}
        </Card>
      </div>
    </>
  );
}

export const RESOLUTIONS = [128, 192, 256, 320, 384, 512];

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

// World inspector: grid size and resolution, live statistics, starting stacks, export.
export function WorldPanel({ doc, stats, presets, presetId, act, onExport }) {
  const w = doc.world;
  const cell = w.size / (w.resolution - 1);
  const presetName = (presets.find((p) => p.id === presetId) || { name: 'Custom terrain' }).name;
  const seaText = stats ? (stats.sea > 0 ? `${stats.sea.toLocaleString()} cells` : 'none') : '—';
  return (
    <>
      <header className="object-header">
        <div className="object-title">
          <div>
            <div className="eyebrow">World</div>
            <h1>{presetName}</h1>
          </div>
        </div>
      </header>
      <p className="muted lede">
        The heightfield is the working representation. Every layer runs on this grid, and the viewport,
        the heightmap and the texture all come from the same evaluation.
      </p>
      <div className="cards">
        <Card title="Grid" icon={Globe} wide>
          <Slider label="Terrain size" unit="m" value={w.size} min={256} max={4096} step={64} onChange={(v) => act.setWorld({ size: v }, 'w:size')} />
          <FieldSelect
            label="Resolution"
            value={String(w.resolution)}
            options={RESOLUTIONS.map((n) => ({ id: String(n), label: `${n} × ${n}` }))}
            onChange={(v) => act.setWorld({ resolution: Number(v) })}
          />
          <p className="muted">Cell size {cell.toFixed(1)} m. Erosion cost grows with resolution; 256 × 256 keeps edits responsive.</p>
        </Card>
        <Card title="Statistics" icon={Layers} wide>
          <div className="stat-grid">
            <Stat label="Height range" value={stats ? `${stats.lo.toFixed(0)} – ${stats.hi.toFixed(0)} m` : '—'} />
            <Stat label="Water cover" value={stats ? `${stats.wetPct.toFixed(1)} %` : '—'} />
            <Stat label="Lake cells" value={stats ? stats.lakes.toLocaleString() : '—'} />
            <Stat label="River cells" value={stats ? stats.rivers.toLocaleString() : '—'} />
            <Stat label="Sea" value={seaText} />
            <Stat label="Sea level" value={stats && Number.isFinite(stats.seaLevel) ? `${stats.seaLevel} m` : '—'} />
          </div>
        </Card>
        <Card title="Starting stacks" icon={Mountain} wide>
          <div className="preset-list">
            {presets.map((p) => (
              <button key={p.id} className={`preset ${presetId === p.id ? 'on' : ''}`} onClick={() => act.loadPreset(p.id)}>
                <strong>{p.name}</strong>
                <span>{p.blurb}</span>
              </button>
            ))}
          </div>
          <p className="muted">Loading a preset replaces both stacks. Undo brings the previous ones back.</p>
        </Card>
        <Card title="Export" icon={Download} wide>
          <div className="export-row">
            <button className="tool-button" onClick={() => onExport('heightmap')}>Heightmap · 16-bit PNG</button>
            <button className="tool-button" onClick={() => onExport('albedo')}>Albedo · PNG</button>
            <button className="tool-button" onClick={() => onExport('stack')}>Stacks · JSON</button>
          </div>
          <p className="muted">Voxel (SDF) output is planned and not built yet.</p>
        </Card>
      </div>
    </>
  );
}

export function SaveBadge({ savedAt }) {
  return (
    <span className={`save-status ${savedAt ? 'saved' : ''}`}>
      {savedAt ? <Check size={13} /> : <span className="unsaved-dot" />}
      {savedAt ? 'Saved in this browser' : 'Saving…'}
    </span>
  );
}
