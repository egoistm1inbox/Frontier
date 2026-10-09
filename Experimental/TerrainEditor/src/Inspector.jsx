import React, { useMemo, useRef } from 'react';
import {
  ChevronRight, Check, RotateCcw, Eye, EyeOff, Globe, Layers, Map, Download, Upload,
  SlidersHorizontal, Sparkles, MapPin, Droplets, Flame, Waves, Wind, Zap, Mountain, Play,
} from 'lucide-react';
import { generators, generatorById, generatorDefaults } from './terrain/generators.js';
import { masks, maskById, maskDefaults } from './terrain/masks.js';
import { erosionTypes, erosionById } from './terrain/erosion.js';
import { blendModes, buildMaskContext, previewShapeLayer, evalGeneratorField, evalMaskField } from './terrain/pipeline.js';
import { mapModes, buildImageData, heightToGrayRGBA } from './terrain/render2d.js';
import { palettes } from './terrain/satmap.js';

const erosionIcons = { hydraulic: Droplets, thermal: Flame, fluvial: Waves, aeolian: Wind };

// ------------------------------------------------------------------ helpers

function formatValue(value, def) {
  if (def.format === 'k') return `${Math.round(value / 1000)}k`;
  if (def.step >= 1) return Math.round(value).toLocaleString('en-US');
  const decimals = Math.max(0, Math.ceil(-Math.log10(def.step)));
  return Number(value).toFixed(decimals);
}

function Card({ title, icon: Icon, children, wide, accent }) {
  return (
    <section className={`card ${wide ? 'wide-card' : ''}`} style={accent ? { '--card-icon': accent } : undefined}>
      <div className="card-heading"><span>{Icon && <Icon size={16} />}{title}</span></div>
      <fieldset className="card-body">{children}</fieldset>
    </section>
  );
}

function Slider({ def, value, onChange }) {
  const pct = ((value - def.min) / (def.max - def.min)) * 100;
  return (
    <label className="prop-slider">
      <span className="slider-head"><span>{def.label}</span>
        <span className="slider-value">{formatValue(value, def)}{def.unit || ''}</span></span>
      <input type="range" aria-label={def.label} min={def.min} max={def.max} step={def.step} value={value}
        onChange={(e) => onChange(+e.target.value)} style={{ '--progress': `${pct}%` }} />
    </label>
  );
}

function Select({ label, value, options, onChange }) {
  return (
    <label className="prop-select">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  );
}

function FieldPreview({ field, size, label, diverging }) {
  const ref = useRef(null);
  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !field) return;
    const px = 96;
    canvas.width = px; canvas.height = px;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(px, px);
    // field is size×size; downsample by nearest cell
    const step = size / px;
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < field.length; i++) { if (field[i] < min) min = field[i]; if (field[i] > max) max = field[i]; }
    const range = (max - min) || 1;
    for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
      const v = field[Math.min(size - 1, Math.floor(y * step)) * size + Math.min(size - 1, Math.floor(x * step))];
      const t = (v - min) / range;
      const o = (y * px + x) * 4;
      if (diverging) {
        // signed ramp: blue → charcoal → warm
        img.data[o] = 40 + t * 200;
        img.data[o + 1] = 44 + (t < 0.5 ? t * 2 * 30 : 30 + (t - 0.5) * 2 * 160);
        img.data[o + 2] = 70 + (t < 0.5 ? (1 - t * 2) * 60 : 200 - (t - 0.5) * 2 * 100);
      } else {
        const g = Math.round(28 + t * 210);
        img.data[o] = g; img.data[o + 1] = g; img.data[o + 2] = g;
      }
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [field, size, diverging]);
  return (
    <div className="field-preview-wrap">
      <canvas ref={ref} className="field-preview" aria-label={label} />
      <span>{label}</span>
    </div>
  );
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function rgbaToPNG(rgba, size, filename) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  c.getContext('2d').putImageData(new ImageData(rgba, size, size), 0, 0);
  c.toBlob((b) => b && downloadBlob(b, filename), 'image/png');
}

// ------------------------------------------------------------ terrain inspector

function TerrainInspector({ terrain, view, result, layers, saved, onSave, onAdd, onResetStack, onTerrain, onView, onImport }) {
  const fileRef = useRef(null);
  const sizeOptions = [128, 192, 256, 384, 512];

  const exportView = () => {
    if (!result) return;
    const rgba = buildImageData(view.mode, result, view.palette, terrain.seed);
    rgbaToPNG(rgba, result.size, `frontier-${view.mode}.png`);
  };
  const exportHeight = () => {
    if (!result) return;
    rgbaToPNG(heightToGrayRGBA(result.heightN, result.size), result.size, 'frontier-heightmap.png');
  };
  const exportStack = () => {
    downloadBlob(new Blob([JSON.stringify({ version: 1, layers, terrain, view }, null, 2)], { type: 'application/json' }), 'frontier-layerstack.json');
  };

  return (
    <section className="inspector" style={{ '--accent': '#a8bbeb' }}>
      <header className="inspector-top">
        <div>Inspector <ChevronRight size={13} /><span>Terrain</span></div>
        <button className={`save-status ${saved ? 'saved' : ''}`} onClick={onSave}>
          {saved ? <Check size={13} /> : <span className="unsaved-dot" />}{saved ? 'All changes saved' : 'Save changes'}
        </button>
      </header>
      <div className="inspector-content">
        <div className="object-header">
          <div className="object-title"><div><div className="eyebrow">Heightmap landscape</div><h1>Terrain</h1></div></div>
          <div className="object-actions">
            <button className="reset" onClick={onResetStack}><RotateCcw size={14} />Reset stack</button>
          </div>
        </div>
        <div className="section-label"><span>WORLD</span><span>grid, seed & datum</span></div>
        <div className="cards">
          <Card title="World" icon={Globe} wide accent="#a8bbeb">
            <div className="world-grid">
              <Select label="Map size" value={terrain.size}
                options={sizeOptions.map((s) => ({ id: s, label: `${s} × ${s}` }))}
                onChange={(v) => onTerrain({ ...terrain, size: +v })} />
              <label className="prop-select">
                <span>Seed</span>
                <div className="seed-row">
                  <input type="number" value={terrain.seed} min={0} max={999999}
                    onChange={(e) => onTerrain({ ...terrain, seed: Math.max(0, Math.min(999999, +e.target.value || 0)) })} />
                  <button title="Reroll seed" onClick={() => onTerrain({ ...terrain, seed: 1000 + Math.floor(Math.random() * 9000) })}><RotateCcw size={13} /></button>
                </div>
              </label>
            </div>
            <Slider def={{ key: 'waterLevel', label: 'Sea level', min: 0, max: result ? Math.max(1, Math.ceil(result.max)) : 1500, step: 1, def: 0, unit: ' m' }}
              value={terrain.waterLevel} onChange={(v) => onTerrain({ ...terrain, waterLevel: v })} />
            <div className="range-labels"><span>0 m · dry</span><span>{result ? `${Math.ceil(result.max)} m · peak` : '—'}</span></div>
            {result && (
              <div className="stat-grid">
                <div><span>Min</span><strong>{Math.round(result.min)} m</strong></div>
                <div><span>Mean</span><strong>{Math.round(result.mean)} m</strong></div>
                <div><span>Peak</span><strong>{Math.round(result.max)} m</strong></div>
                <div><span>Layers</span><strong>{layers.filter((l) => l.enabled).length} / {layers.length}</strong></div>
              </div>
            )}
          </Card>

          <Card title="Layer stack" icon={Layers} accent="#d6a078">
            <div className="metric">{layers.length}<small>layers</small></div>
            <p className="muted">Layers apply bottom-up: shapes add height, erosion passes simulate weathering on everything below them.</p>
            <div className="btn-row">
              <button className="tool-button" onClick={() => onAdd('shape')}><Mountain size={13} />Add shape</button>
              <button className="tool-button" onClick={() => onAdd('erosion')}><Droplets size={13} />Add erosion</button>
            </div>
          </Card>

          <Card title="Satmap" icon={Map} accent="#81b8c8">
            <Select label="Map mode" value={view.mode} options={mapModes} onChange={(v) => onView({ ...view, mode: v })} />
            <Select label="Palette" value={view.palette} options={palettes} onChange={(v) => onView({ ...view, palette: v })} />
            <label className="prop-select">
              <span>Preview</span>
              <div className="seg-row">
                <button className={!view.preview3d ? 'on' : ''} onClick={() => onView({ ...view, preview3d: false })}>2D map</button>
                <button className={view.preview3d ? 'on' : ''} onClick={() => onView({ ...view, preview3d: true })}>3D relief</button>
              </div>
            </label>
            <p className="muted">Satmap paints from the stack's channels — height, rivers, sedimentation and strata — as a stylized satellite view.</p>
          </Card>

          <Card title="Export" icon={Download} accent="#93c779">
            <div className="btn-row">
              <button className="tool-button" disabled={!result} onClick={exportView}><Download size={13} />Satmap PNG</button>
              <button className="tool-button" disabled={!result} onClick={exportHeight}><Download size={13} />Heightmap PNG</button>
            </div>
            <div className="btn-row">
              <button className="tool-button" onClick={exportStack}><Download size={13} />Stack JSON</button>
              <button className="tool-button" onClick={() => fileRef.current?.click()}><Upload size={13} />Import JSON</button>
            </div>
            <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                try { onImport(JSON.parse(reader.result)); }
                catch { window.alert('That file is not a valid Frontier layer stack.'); }
              };
              reader.readAsText(file);
              e.target.value = '';
            }} />
          </Card>
        </div>
        <footer className="inspector-footer">
          <span><span className="footer-dot" />Changes apply in real time</span>
          <span>Terrain <span className="footer-slash">/</span> Layerstack</span>
        </footer>
      </div>
    </section>
  );
}

// -------------------------------------------------------------- layer inspector

function LayerInspector({ layer, terrain, result, saved, onSave, onUpdateLayer, onUpdateGroup }) {
  const isShape = layer.kind === 'shape';
  const gen = generatorById(isShape ? layer.generator : layer.driver);
  const mask = maskById(layer.mask);
  const erosion = erosionById(layer.erosionType);
  const ErosionIcon = erosionIcons[erosion.id] || Droplets;
  const accent = isShape ? '#d6a078' : ({ hydraulic: '#81b8c8', thermal: '#e69c79', fluvial: '#74bdd4', aeolian: '#d8c077' })[erosion.id];

  // live mini-previews of the generator/driver field and the mask
  const preview = useMemo(() => {
    const size = 96;
    const h = result ? result.height : new Float32Array(terrain.size * terrain.size);
    const ctx = buildMaskContext(h, terrain.size, terrain.waterLevel, terrain.seed);
    if (isShape) {
      const field = evalGeneratorField(layer.generator, layer.genParams, ctx, 7);
      const m = layer.mask === 'none' ? null : evalMaskField(layer.mask, layer.maskParams, ctx);
      const amplitude = layer.genParams.amplitude ?? 600;
      const contrib = new Float32Array(size * size);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        // sample the full-res context fields by nearest cell
        const sx = Math.floor(x / size * terrain.size), sy = Math.floor(y / size * terrain.size);
        const fi = sy * terrain.size + sx;
        const i = y * size + x;
        const g = field.field[fi] ?? 0;
        const mv = m ? m.mask[fi] ?? 1 : 1;
        contrib[i] = g * amplitude * mv * layer.opacity;
      }
      const maskPrev = m ? downsample(m.mask, terrain.size, size) : null;
      return { contrib, mask: maskPrev, size };
    }
    // erosion: driver field × mask = intensity field
    const field = evalGeneratorField(layer.driver, layer.driverParams, ctx, 7);
    const m = layer.mask === 'none' ? null : evalMaskField(layer.mask, layer.maskParams, ctx);
    const inten = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const sx = Math.floor(x / size * terrain.size), sy = Math.floor(y / size * terrain.size);
      const fi = sy * terrain.size + sx;
      const g = ((field.field[fi] ?? 0) + 1) * 0.5;
      inten[y * size + x] = g * (m ? m.mask[fi] ?? 1 : 1) * layer.intensity * layer.opacity;
    }
    return { contrib: inten, mask: m ? downsample(m.mask, terrain.size, size) : null, size };
  }, [layer, result, terrain, isShape]);

  return (
    <section className="inspector" style={{ '--accent': accent }}>
      <header className="inspector-top">
        <div>Inspector <ChevronRight size={13} /><span>{isShape ? 'Shape layer' : 'Erosion layer'}</span></div>
        <button className={`save-status ${saved ? 'saved' : ''}`} onClick={onSave}>
          {saved ? <Check size={13} /> : <span className="unsaved-dot" />}{saved ? 'All changes saved' : 'Save changes'}
        </button>
      </header>
      <div className="inspector-content">
        <div className="object-header">
          <div className="object-title">
            <div>
              <div className="eyebrow">{isShape ? 'Shape layer · generator + mask' : `Erosion layer · ${erosion.label}`}</div>
              <h1>{layer.name}</h1>
            </div>
          </div>
          <div className="object-actions">
            <button className={`enabled-pill ${layer.enabled ? '' : 'disabled'}`} onClick={() => onUpdateLayer(layer.id, { enabled: !layer.enabled })}>
              <span />{layer.enabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        </div>

        <div className="section-label"><span>LAYER</span><span>blend & visibility</span></div>
        <div className="cards">
          <Card title="Layer" icon={SlidersHorizontal} wide accent={accent}>
            <label className="prop-select">
              <span>Name</span>
              <input className="name-input" value={layer.name} maxLength={40}
                onChange={(e) => onUpdateLayer(layer.id, { name: e.target.value })} />
            </label>
            {isShape && (
              <Select label="Blend mode" value={layer.blend} options={blendModes}
                onChange={(v) => onUpdateLayer(layer.id, { blend: v })} />
            )}
            <Slider def={{ key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01, def: 1 }} value={layer.opacity}
              onChange={(v) => onUpdateLayer(layer.id, { opacity: v })} />
            <div className="range-labels"><span>Subtle</span><span>Full strength</span></div>
            {!isShape && (
              <Slider def={{ key: 'intensity', label: 'Intensity', min: 0, max: 2, step: 0.05, def: 1 }} value={layer.intensity}
                onChange={(v) => onUpdateLayer(layer.id, { intensity: v })} />
            )}
            <p className="muted">
              {isShape
                ? 'Contribution is blended into the terrain accumulated by the layers below.'
                : 'Runs on the terrain accumulated below this layer; results carry upward.'}
            </p>
          </Card>

          <Card title={isShape ? 'Generator' : 'Erosion driver'} icon={isShape ? Sparkles : Zap} accent={accent}>
            <Select
              label={isShape ? 'Generator' : 'Driver field'}
              value={isShape ? layer.generator : layer.driver}
              options={[{ id: 'none', label: 'None (uniform)' }, ...generators]}
              onChange={(v) => {
                if (isShape) onUpdateLayer(layer.id, { generator: v, genParams: { ...generatorDefaults(v), ...(v === layer.generator ? layer.genParams : {}) } });
                else onUpdateLayer(layer.id, { driver: v, driverParams: { ...generatorDefaults(v), ...(v === layer.driver ? layer.driverParams : {}) } });
              }}
            />
            {(isShape || layer.driver !== 'none') && gen.params
              .filter((p) => p.key !== 'amplitude' || isShape)
              .map((def) => (
                <Slider key={def.key} def={def}
                  value={(isShape ? layer.genParams : layer.driverParams)[def.key] ?? def.def}
                  onChange={(v) => onUpdateGroup(layer.id, isShape ? 'genParams' : 'driverParams', { [def.key]: v })} />
              ))}
            {!isShape && layer.driver !== 'none' && (
              <p className="muted">Noise field scaling where this erosion pass works. “None” erodes uniformly.</p>
            )}
            {preview.contrib && (
              <div className="preview-row">
                <FieldPreview field={preview.contrib} size={preview.size} label={isShape ? 'Layer field' : 'Intensity'} diverging={isShape} />
                {preview.mask && <FieldPreview field={preview.mask} size={preview.size} label="Mask" />}
              </div>
            )}
          </Card>

          <Card title="Mask" icon={MapPin} accent={accent}>
            <Select label="Mask" value={layer.mask} options={masks}
              onChange={(v) => onUpdateLayer(layer.id, { mask: v, maskParams: { ...maskDefaults(v), ...(v === layer.mask ? layer.maskParams : {}) } })} />
            {mask.params.map((def) => (
              <Slider key={def.key} def={def} value={layer.maskParams[def.key] ?? def.def}
                onChange={(v) => onUpdateGroup(layer.id, 'maskParams', { [def.key]: v })} />
            ))}
            <p className="muted">
              {mask.id === 'none' && 'The layer applies everywhere.'}
              {mask.id === 'coastal' && 'Fades the layer out toward the coastline and the map edge.'}
              {mask.id === 'mountain' && 'Confines the layer to separated ranges — a smooth falloff so mountains are not one continuous mass.'}
              {mask.id === 'stratify' && 'Stacks the layer into tilted, warped bands — sedimentary strata.'}
              {mask.id === 'rifts' && 'Concentrates the layer along fault-like rift lines.'}
              {mask.id === 'cliffs' && 'Applies the layer only on steep faces.'}
            </p>
          </Card>

          {!isShape && (
            <Card title="Erosion" icon={ErosionIcon} wide accent={accent}>
              <Select label="Erosion type" value={layer.erosionType} options={erosionTypes}
                onChange={(v) => onUpdateLayer(layer.id, { erosionType: v, eroParams: { ...erosionById(v).defaults, ...(v === layer.erosionType ? layer.eroParams : {}) } })} />
              {erosion.params.map((def) => (
                <Slider key={def.key} def={def} value={layer.eroParams[def.key] ?? def.def}
                  onChange={(v) => onUpdateGroup(layer.id, 'eroParams', { [def.key]: v })} />
              ))}
              <p className="muted">
                {erosion.id === 'hydraulic' && 'Droplet runoff: rain carries sediment downhill, carving channels and depositing deltas. Drives the rivers and sedimentation channels.'}
                {erosion.id === 'thermal' && 'Talus relaxation: material slumps wherever slopes exceed the repose angle, softening cliffs into scree.'}
                {erosion.id === 'fluvial' && 'Flow accumulation carves a meandering river network proportional to the drainage area.'}
                {erosion.id === 'aeolian' && 'Wind transports a dry sand layer downwind, piling it into asymmetric dunes with ripple detail.'}
              </p>
            </Card>
          )}
        </div>

        <footer className="inspector-footer">
          <span><span className="footer-dot" />Changes apply in real time</span>
          <span>{layer.name} <span className="footer-slash">/</span> {isShape ? 'Shape' : erosion.label}</span>
        </footer>
      </div>
    </section>
  );
}

function downsample(field, from, to) {
  const out = new Float32Array(to * to);
  const step = from / to;
  for (let y = 0; y < to; y++) for (let x = 0; x < to; x++) {
    out[y * to + x] = field[Math.min(from - 1, Math.floor(y * step)) * from + Math.min(from - 1, Math.floor(x * step))];
  }
  return out;
}

function Inspector(props) {
  const { selection } = props;
  if (selection === 'terrain') return <TerrainInspector {...props} />;
  return <LayerInspector layer={selection} {...props} />;
}

export default Inspector;
