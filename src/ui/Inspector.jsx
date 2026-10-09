/**
 * Frontier Landscape Studio — the inspector.
 *
 * Right column, drawn with the reference editor's own components: sticky top
 * bar with a breadcrumb and save status, object header, PROPERTIES section
 * label, property switches, then a stack of cards ending in the footer line.
 *
 * Controls are generated from the parameter schema each layer declares, so an
 * erosion process can only ever show the sliders that actually drive it.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight, Check, RotateCcw, Eye, EyeOff, Trash2, Copy, ArrowUp, ArrowDown,
  Layers, Mountain, Palette, Globe, Waves, Droplet, SlidersHorizontal, Sun, Ruler,
  Download, Upload, Image as ImageIcon, Box, AlertTriangle, Play, Gauge, Map,
  Scan, Contrast, Snowflake, Thermometer, Wind, CloudRain, Anchor, Info, Filter,
  Route, Hammer, Crosshair, Dices, FileJson, Grid3x3, Waypoints, Maximize2,
  LoaderCircle,
} from 'lucide-react';
import { Card, Slider, Select, Toggle, Metric, RangeLabels, SeedField, ControlBlock, StatGrid, SectionLabel, Note, PropertySwitch, ColorField, num } from './controls.jsx';
import { layerIcon, erosionIcon } from './icons.jsx';
import {
  layerSchema, layerType, LAYER_LIBRARY, BLEND_MODES, MASK_TYPES, typeDefaults,
  erosionLayerParams, setErosionParam, EROSION_TYPES, erosionType,
} from '../core/layers.js';
import { MATERIALS, material, RULE_SOURCES } from '../core/textures.js';
import { RESOLUTIONS, estimateCost } from '../core/project.js';
import { previewLayer, fieldToImage, PREVIEW_SIZE } from '../core/preview.js';
import { rampColor, RAMPS } from '../core/textures.js';

/* ------------------------------------------------------------ small pieces */

function ParamControl({ param, value, onChange }) {
  switch (param.kind) {
    case 'range':
      return (
        <Slider
          label={param.label}
          value={value ?? param.value}
          min={param.min}
          max={param.max}
          step={param.step}
          unit={param.unit}
          hint={param.hint}
          onChange={onChange}
        />
      );
    case 'select':
      return (
        <Select
          label={param.label}
          value={value ?? param.value}
          options={param.options}
          note={param.hint}
          onChange={onChange}
        />
      );
    case 'toggle':
      return <Toggle label={param.label} hint={param.hint} value={!!value} onChange={onChange} />;
    case 'seed':
      return (
        <SeedField
          label={param.label}
          value={value ?? param.value}
          onChange={onChange}
          onRandomize={() => onChange(1 + Math.floor(Math.random() * 999998))}
        />
      );
    default:
      return null;
  }
}

/** Split a schema on `group` markers and render one card per group. */
function SchemaCards({ schema, params, onChange, accent, skip = new Set() }) {
  const groups = useMemo(() => {
    const out = [];
    let current = { label: 'Properties', items: [] };
    for (const item of schema) {
      if (item.kind === 'group') {
        if (current.items.length) out.push(current);
        current = { label: item.label, items: [] };
      } else if (!skip.has(item.key)) {
        current.items.push(item);
      }
    }
    if (current.items.length) out.push(current);
    return out;
  }, [schema, skip]);

  return groups.map((g) => (
    <Card key={g.label} title={g.label} icon={SlidersHorizontal} accent={accent}>
      {g.items.map((item) => (
        <ParamControl
          key={item.key}
          param={item}
          value={params[item.key]}
          onChange={(v) => onChange(item.key, v)}
        />
      ))}
    </Card>
  ));
}

/** Low-resolution thumbnail of what one layer contributes on its own. */
function LayerPreview({ layer, brushField, imported, accent }) {
  const canvasRef = useRef(null);
  const [token, setToken] = useState(0);

  useEffect(() => {
    const handle = setTimeout(() => setToken((t) => t + 1), 130);
    return () => clearTimeout(handle);
  }, [layer.params, layer.type, brushField, imported]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !token) return;
    let field = null;
    try {
      field = previewLayer(layer, brushField, imported);
    } catch { field = null; }
    const ctx = canvas.getContext('2d');
    canvas.width = PREVIEW_SIZE;
    canvas.height = PREVIEW_SIZE;
    if (!field) {
      ctx.fillStyle = '#1b1b1b';
      ctx.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
      ctx.fillStyle = '#6d6d6d';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Needs the full stack', PREVIEW_SIZE / 2, PREVIEW_SIZE / 2);
      return;
    }
    const image = ctx.createImageData(PREVIEW_SIZE, PREVIEW_SIZE);
    image.data.set(fieldToImage(field, PREVIEW_SIZE));
    ctx.putImageData(image, 0, 0);
  }, [token, layer, brushField, imported]);

  return (
    <div style={{ margin: '4px 0 16px', borderRadius: 13, overflow: 'hidden', border: '1px solid #ffffff14', background: '#191919' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: 'auto', aspectRatio: '1 / 1' }} aria-label={`${layer.name} preview`} />
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 10px', fontSize: 8, letterSpacing: 1, color: '#7d7d7d', borderTop: '1px solid #ffffff0d' }}>
        <span>LAYER OUTPUT</span>
        <span style={{ color: accent || '#8d8d8d' }}>ISOLATED</span>
      </div>
    </div>
  );
}

/** Diagnostic thumbnail taken from the last full bake. */
function BakeThumbnail({ field, res, ramp, label, right }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !field || !res) return;
    const size = 112;
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const sample = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      const sy = Math.min(res - 1, Math.round((y / (size - 1)) * (res - 1)));
      for (let x = 0; x < size; x++) {
        const sx = Math.min(res - 1, Math.round((x / (size - 1)) * (res - 1)));
        sample[y * size + x] = field[sy * res + sx];
      }
    }
    const image = ctx.createImageData(size, size);
    image.data.set(fieldToImage(sample, size, ramp ? (t) => rampColor(ramp, t) : null));
    ctx.putImageData(image, 0, 0);
  }, [field, res, ramp]);

  return (
    <div style={{ margin: '4px 0 14px', borderRadius: 13, overflow: 'hidden', border: '1px solid #ffffff14', background: '#191919' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: 'auto', aspectRatio: '1 / 1' }} aria-label={label} />
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 10px', fontSize: 8, letterSpacing: 1, color: '#7d7d7d', borderTop: '1px solid #ffffff0d' }}>
        <span>{label}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- the panels */

function LayerActions({ layer, onDuplicate, onDelete, onMove, canUp, canDown }) {
  return (
    <div className="layer-actions">
      <button className="frontier-button" type="button" onClick={() => onMove(-1)} disabled={!canUp} title="Move up the stack">
        <ArrowUp size={13} /> Up
      </button>
      <button className="frontier-button" type="button" onClick={() => onMove(1)} disabled={!canDown} title="Move down the stack">
        <ArrowDown size={13} /> Down
      </button>
      <button className="frontier-button" type="button" onClick={onDuplicate} title="Duplicate this layer">
        <Copy size={13} /> Duplicate
      </button>
      <button className="frontier-button danger" type="button" onClick={onDelete} title="Delete this layer">
        <Trash2 size={13} /> Delete
      </button>
    </div>
  );
}

function ShapeLayerInspector({ project, layer, index, onChange, onParam, onReset, onDuplicate, onDelete, onMove, brushField, imported, bake, bakeState, onRunErosion, onToggleView, viewMode }) {
  const type = layerType(layer.type);
  const Icon = layerIcon(layer.type);
  const schema = useMemo(() => layerSchema(layer.type), [layer.type]);
  const isErosion = layer.type === 'erode';
  const erosion = isErosion ? erosionType(layer.params.type) : null;
  const cost = useMemo(() => estimateCost(project), [project]);

  // Erosion layers get a quick switch straight to the map that shows their work.
  const diagnosticViews = [
    ['shaded', 'Shaded', Sun],
    ['erosion', 'Erosion', Filter],
    ['flow', 'Flow', Route],
    ['talus', 'Talus', Hammer],
  ];

  return (
    <>
      <div className="object-header">
        <div className="object-title">
          <div className="object-icon" style={{ '--accent': type.accent }}><Icon size={26} strokeWidth={1.5} /></div>
          <div>
            <div className="eyebrow">{type.category} layer · {String(project.layers.length - index).padStart(2, '0')} of {project.layers.length}</div>
            <h1>{layer.name}</h1>
          </div>
        </div>
        <div className="object-actions">
          <button className="reset" type="button" onClick={onReset} title="Reset this layer to its defaults">
            <RotateCcw size={14} /> Reset
          </button>
          <button
            className={`enabled-pill ${layer.enabled === false ? 'disabled' : ''}`}
            type="button"
            aria-pressed={layer.enabled !== false}
            onClick={() => onChange({ enabled: layer.enabled === false })}
          >
            <span />{layer.enabled === false ? 'Disabled' : 'Enabled'}
          </button>
        </div>
      </div>

      <SectionLabel
        left="PROPERTIES"
        right={isErosion ? `${erosion.name} · ${erosion.cost}` : type.summary}
      />

      <div className="property-switches" role="group" aria-label="Quick views">
        {isErosion ? diagnosticViews.map(([id, label, SwitchIcon]) => (
          <PropertySwitch key={id} label={label} icon={SwitchIcon} on={viewMode === id} onClick={() => onToggleView(id)} />
        )) : (
          <>
            <PropertySwitch label="Enabled" icon={Eye} on={layer.enabled !== false} onClick={() => onChange({ enabled: layer.enabled === false })} />
            <PropertySwitch label="Masked" icon={Filter} on={layer.params.maskType !== 'none'} onClick={() => onParam('maskType', layer.params.maskType === 'none' ? 'radial' : 'none')} />
            <PropertySwitch label={layer.params.invert ? 'Inverted' : 'Normal'} icon={Contrast} on={!!layer.params.invert} onClick={() => onParam('invert', !layer.params.invert)} />
          </>
        )}
      </div>

      <div className="cards">
        {isErosion ? (
          <ErosionCards
            layer={layer}
            erosion={erosion}
            onType={(t) => onChange({ params: { ...layer.params, type: t } })}
            onParam={onParam}
            onTuning={(key, value) => onChange({ params: setErosionParam(layer, key, value) })}
            bake={bake}
            bakeState={bakeState}
            onRun={onRunErosion}
            cost={cost}
          />
        ) : (
          <Card title="Layer output" icon={Layers} accent={type.accent}>
            <LayerPreview layer={layer} brushField={brushField} imported={imported} accent={type.accent} />
            <Slider label="Opacity" value={layer.opacity} min={0} max={1} step={0.01} onChange={(v) => onChange({ opacity: v })} />
            <RangeLabels left="Transparent" right="Full" />
            <Select
              label="Blend mode"
              value={layer.blend}
              options={BLEND_MODES.map((b) => ({ value: b.id, label: b.name }))}
              note={BLEND_MODES.find((b) => b.id === layer.blend)?.note}
              onChange={(v) => onChange({ blend: v })}
            />
            <label style={{ display: 'block', marginTop: 4 }}>
              <span style={{ display: 'block', fontSize: 9, letterSpacing: 1.2, textTransform: 'uppercase', color: '#8a8a8a', marginBottom: 8 }}>Layer name</span>
              <input className="frontier-input" value={layer.name} maxLength={48} onChange={(e) => onChange({ name: e.target.value })} />
            </label>
            <LayerActions
              layer={layer}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
              onMove={onMove}
              canUp={index < project.layers.length - 1}
              canDown={index > 0}
            />
          </Card>
        )}

        {isErosion ? null : (
          <SchemaCards
            schema={schema}
            params={layer.params}
            onChange={onParam}
            accent={type.accent}
            skip={new Set(['type', 'strength', 'verticalScale', 'seed'])}
          />
        )}
      </div>
    </>
  );
}

function ErosionCards({ layer, erosion, onType, onParam, onTuning, bake, bakeState, onRun, cost }) {
  const Icon = erosionIcon(erosion.id);
  const tuning = erosionLayerParams(layer);
  const moved = bake ? bake.erosionMoved : null;
  const running = bakeState.busy && bakeState.phase === 'erosion';

  return (
    <>
      <Card title="Erosion process" icon={Waves} accent={erosion.accent}>
        <Select
          label="Process type"
          value={erosion.id}
          options={EROSION_TYPES.map((t) => ({ value: t.id, label: t.name }))}
          note="Each process brings its own controls"
          onChange={onType}
        />
        <div className="process-hero" style={{ '--card-icon': erosion.accent }}>
          <span className="process-emblem"><Icon /></span>
          <div>
            <h3>{erosion.name}</h3>
            <p>{erosion.summary}</p>
            <span className="process-method">{erosion.method}</span>
          </div>
        </div>
        <Slider label="Strength" value={layer.params.strength ?? 1} min={0} max={2} step={0.01} onChange={(v) => onParam('strength', v)} hint="Scales the total displacement — 0 leaves the surface untouched" />
        <RangeLabels left="Off" right="Double" />
        <Slider label="Vertical scale" value={layer.params.verticalScale ?? 1} min={0.2} max={6} step={0.05} onChange={(v) => onParam('verticalScale', v)} hint="Taller terrain means steeper slopes, so angle-of-repose failures happen sooner" />
        <SeedField label="Simulation seed" value={layer.params.seed ?? 1337} onChange={(v) => onParam('seed', v)} onRandomize={() => onParam('seed', 1 + Math.floor(Math.random() * 999998))} />
        <div className="simulate-row">
          <button className="frontier-button primary" type="button" onClick={onRun} disabled={running}>
            {running ? <LoaderCircle className="spin" size={13} /> : <Play size={13} />}
            {running ? `Simulating ${Math.round((bakeState.progress || 0) * 100)}%` : 'Run simulation'}
          </button>
        </div>
        {bakeState.busy ? (
          <div className="progress-line">
            <i><b style={{ width: `${Math.round((bakeState.progress || 0) * 100)}%` }} /></i>
            <span>{bakeState.label || 'Working'}</span>
          </div>
        ) : null}
        {moved !== null && moved !== undefined ? (
          <Note>
            Last pass moved <strong>{moved.toFixed(2)}</strong> normalized units of material
            across the grid{cost.heavy ? ' — this stack is heavy, so bakes run in a worker' : ''}.
          </Note>
        ) : null}
      </Card>

      <Card title={`${erosion.name} controls`} icon={Icon} accent={erosion.accent}
        caption={<span className="small-pill">{erosion.params.length} controls</span>}>
        {erosion.params.map((param) => (
          <ParamControl
            key={param.key}
            param={param}
            value={tuning[param.key]}
            onChange={(v) => onTuning(param.key, v)}
          />
        ))}
        {erosion.id === 'hydraulic' ? (
          <Note>
            Droplets carry sediment up to a speed-dependent capacity. Where a
            droplet is under capacity it cuts; where it is over capacity, or
            forced uphill, it fills. <strong>{num(tuning.droplets)} droplets</strong> ×{' '}
            <strong>{tuning.lifetime} steps</strong> = {num(tuning.droplets * tuning.lifetime)} evaluations per pass.
          </Note>
        ) : null}
        {erosion.id === 'thermal' ? (
          <Note>
            Anything steeper than <strong>{tuning.talus}°</strong> sheds material to its{' '}
            {tuning.neighbours}-way neighbourhood until the surface rests at the angle of repose.
          </Note>
        ) : null}
        {erosion.id === 'wind' ? (
          <Note>
            Abrasion scales with the square of wind speed, so{' '}
            <strong>{tuning.speed} m/s</strong> lifts about {((tuning.speed / 20) ** 2).toFixed(2)}× the
            reference rate. Sand settles downwind at bearing <strong>{tuning.direction}°</strong>.
          </Note>
        ) : null}
        {erosion.id === 'glacial' ? (
          <Note>
            Ice forms where flow accumulation exceeds <strong>{(tuning.extent * 100).toFixed(1)}%</strong> of the
            network and the ground sits above the <strong>{Math.round(tuning.snowline * 100)}%</strong> snowline.
          </Note>
        ) : null}
        {erosion.id === 'coastal' ? (
          <Note>
            Waves attack a band of <strong>{tuning.band} cells</strong> around the{' '}
            <strong>{(tuning.seaLevel * 100).toFixed(1)}%</strong> shoreline. Debris is re-deposited as a beach
            graded at <strong>{tuning.beachSlope}</strong>.
          </Note>
        ) : null}
        {erosion.id === 'rainfall' ? (
          <Note>
            Each pass adds <strong>{tuning.rainfall}</strong> water per cell, routes it to lower neighbours and
            detaches or deposits soil against a capacity of{' '}
            <strong>velocity^{tuning.velocityExp} × slope^{tuning.slopeExp}</strong>.
          </Note>
        ) : null}
      </Card>

      {bake ? (
        <Card title="Erosion diagnostics" icon={Gauge} accent={erosion.accent}>
          <BakeThumbnail field={bake.erosionDelta} res={bake.resolution} ramp={RAMPS.erosion} label="CUT / FILL" right="blue cut · red fill" />
          <StatGrid items={[
            ['Cut', num(bake.stats.erodedTotal ?? 0, 2)],
            ['Filled', num(bake.stats.depositedTotal ?? 0, 2)],
            ['Net', num((bake.stats.depositedTotal ?? 0) - (bake.stats.erodedTotal ?? 0), 2)],
            ['Peak flow', num((bake.stats.flowMax ?? 0) * 100, 0), '%'],
          ]} />
          <Note>
            Switch the viewport to <strong>Erosion</strong>, <strong>Flow</strong> or <strong>Talus</strong> to see
            these maps over the whole landscape. They also drive the scree and riverbed texture rules.
          </Note>
        </Card>
      ) : null}
    </>
  );
}

/* --------------------------------------------------------- texture layers */

function SplatInspector({ project, layer, index, total, onChange, onParam, onDuplicate, onDelete, onMove, onPickMaterial }) {
  const p = layer.params;
  const mat = material(p.material);
  const rules = [
    ['height', 'Height', p.heightEnabled],
    ['slope', 'Slope', p.slopeEnabled],
    ['flow', 'Flow', p.flowEnabled],
    ['talus', 'Talus', p.talusEnabled],
    ['noise', 'Noise', p.noiseEnabled],
    ['cellular', 'Cells', p.cellularEnabled],
  ];

  return (
    <>
      <div className="object-header">
        <div className="object-title">
          <div className="object-icon" style={{ '--accent': '#c5a6d7' }}><Palette size={26} strokeWidth={1.5} /></div>
          <div>
            <div className="eyebrow">Splat material · {String(total - index).padStart(2, '0')} of {total}</div>
            <h1>{layer.name}</h1>
          </div>
        </div>
        <div className="object-actions">
          <button className="reset" type="button" onClick={() => onPickMaterial(mat.id)} title="Reset to the material preset">
            <RotateCcw size={14} /> Reset
          </button>
          <button
            className={`enabled-pill ${layer.enabled === false ? 'disabled' : ''}`}
            type="button"
            onClick={() => onChange({ enabled: layer.enabled === false })}
          >
            <span />{layer.enabled === false ? 'Disabled' : 'Enabled'}
          </button>
        </div>
      </div>

      <SectionLabel left="PROPERTIES" right="Material, placement rules & blend" />

      <div className="property-switches" role="group" aria-label="Placement rules">
        {rules.slice(0, 3).map(([key, label, on]) => (
          <PropertySwitch key={key} label={label} icon={key === 'height' ? Mountain : key === 'slope' ? Contrast : Route} on={!!on} onClick={() => onParam(`${key}Enabled`, !on)} />
        ))}
      </div>

      <div className="cards">
        <Card title="Material" icon={Palette} accent="#c5a6d7">
          <div className="material-row">
            <span className="material-swatch" style={{ background: `linear-gradient(135deg, ${p.colorA}, ${p.colorB})` }} />
            <div className="material-picker">
              <span>Base material</span>
              <select className="frontier-select" value={p.material} aria-label="Material preset" onChange={(e) => onPickMaterial(e.target.value)}>
                {MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
          <div className="preset-grid">
            {MATERIALS.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={p.material === m.id}
                title={m.name}
                onClick={() => onPickMaterial(m.id)}
              >
                <i style={{ background: `linear-gradient(135deg, ${m.a}, ${m.b})` }} />
                {m.name}
              </button>
            ))}
          </div>
          <div style={{ height: 14 }} />
          <ColorField label="Colour A" value={p.colorA} onChange={(v) => onParam('colorA', v)} />
          <ColorField label="Colour B" value={p.colorB} onChange={(v) => onParam('colorB', v)} />
          <Slider label="Variation" value={p.variation} min={0} max={1} step={0.01} onChange={(v) => onParam('variation', v)} hint="How far each patch drifts between the two colours" />
          <Slider label="Variation size" value={p.variationScale} min={1} max={120} step={0.5} onChange={(v) => onParam('variationScale', v)} />
          <Slider label="Roughness" value={p.roughness} min={0} max={1} step={0.01} onChange={(v) => onParam('roughness', v)} hint="Drives the specular highlight in the viewport" />
          <RangeLabels left="Glossy" right="Matte" />
        </Card>

        <Card title="Placement rules" icon={Filter} accent="#a4c6e6">
          <div className="rule-chips">
            {rules.map(([key, label, on]) => (
              <button
                key={key}
                type="button"
                className={`rule-chip ${on ? 'on' : ''}`}
                aria-pressed={!!on}
                onClick={() => onParam(`${key}Enabled`, !on)}
              >
                <i />{label}
              </button>
            ))}
          </div>

          {p.heightEnabled ? (
            <ControlBlock title="Height band" icon={Mountain} note={`${Math.round(p.heightMin * 100)}–${Math.round(p.heightMax * 100)}%`}>
              <Slider label="Low" value={p.heightMin} min={0} max={1} step={0.005} onChange={(v) => onParam('heightMin', Math.min(v, p.heightMax))} />
              <Slider label="High" value={p.heightMax} min={0} max={1} step={0.005} onChange={(v) => onParam('heightMax', Math.max(v, p.heightMin))} />
              <Slider label="Feather" value={p.heightFeather} min={0} max={0.5} step={0.005} onChange={(v) => onParam('heightFeather', v)} />
            </ControlBlock>
          ) : null}

          {p.slopeEnabled ? (
            <ControlBlock title="Slope band" icon={Contrast} note={`${Math.round(p.slopeMin * 90)}–${Math.round(p.slopeMax * 90)}°`}>
              <Slider label="Gentle limit" value={p.slopeMin} min={0} max={1} step={0.005} onChange={(v) => onParam('slopeMin', Math.min(v, p.slopeMax))} />
              <Slider label="Steep limit" value={p.slopeMax} min={0} max={1} step={0.005} onChange={(v) => onParam('slopeMax', Math.max(v, p.slopeMin))} />
              <Slider label="Feather" value={p.slopeFeather} min={0} max={0.5} step={0.005} onChange={(v) => onParam('slopeFeather', v)} />
            </ControlBlock>
          ) : null}

          {p.flowEnabled ? (
            <ControlBlock title="Flow accumulation" icon={Route} note="Riverbeds & gullies">
              <Slider label="Threshold" value={p.flowMin} min={0} max={1} step={0.005} onChange={(v) => onParam('flowMin', v)} hint="Only cells carrying this much runoff are affected" />
              <Slider label="Feather" value={p.flowFeather} min={0.01} max={0.5} step={0.005} onChange={(v) => onParam('flowFeather', v)} />
            </ControlBlock>
          ) : null}

          {p.talusEnabled ? (
            <ControlBlock title="Talus / debris" icon={Hammer} note="Scree from thermal erosion">
              <Slider label="Threshold" value={p.talusMin} min={0} max={1} step={0.005} onChange={(v) => onParam('talusMin', v)} />
              <Slider label="Feather" value={p.talusFeather} min={0.01} max={0.5} step={0.005} onChange={(v) => onParam('talusFeather', v)} />
            </ControlBlock>
          ) : null}

          {p.noiseEnabled ? (
            <ControlBlock title="Fractal mask" icon={Dices} note="Breaks up hard edges">
              <Slider label="Scale" value={p.noiseScale} min={1} max={160} step={0.5} onChange={(v) => onParam('noiseScale', v)} />
              <Slider label="Contrast" value={p.noiseContrast} min={0.1} max={4} step={0.05} onChange={(v) => onParam('noiseContrast', v)} />
              <Slider label="Threshold" value={p.noiseThreshold} min={0} max={1} step={0.01} onChange={(v) => onParam('noiseThreshold', v)} hint="Above 0 the mask becomes patchy rather than continuous" />
            </ControlBlock>
          ) : null}

          {p.cellularEnabled ? (
            <ControlBlock title="Cellular patches" icon={Box} note="Blobs of material">
              <Slider label="Cell size" value={p.cellularScale} min={1} max={80} step={0.5} onChange={(v) => onParam('cellularScale', v)} />
            </ControlBlock>
          ) : null}

          <ControlBlock title="Blend" icon={Layers}>
            <Toggle label="Invert the rule" value={!!p.invert} onChange={(v) => onParam('invert', v)} hint="Paint everywhere the rule does not apply" />
            <Slider label="Opacity" value={p.opacity} min={0} max={1} step={0.01} onChange={(v) => onParam('opacity', v)} />
          </ControlBlock>
        </Card>

        <Card title="Layer" icon={Layers} accent="#c5a6d7">
          <label style={{ display: 'block' }}>
            <span style={{ display: 'block', fontSize: 9, letterSpacing: 1.2, textTransform: 'uppercase', color: '#8a8a8a', marginBottom: 8 }}>Layer name</span>
            <input className="frontier-input" value={layer.name} maxLength={48} onChange={(e) => onChange({ name: e.target.value })} />
          </label>
          <LayerActions layer={layer} onDuplicate={onDuplicate} onDelete={onDelete} onMove={onMove} canUp={index < total - 1} canDown={index > 0} />
        </Card>
      </div>
    </>
  );
}

function SatmapInspector({ layer, onChange, onParam, onImportImage, onClearImage, onDelete, onDuplicate, dragging, setDragging }) {
  const p = layer.params;
  const fileRef = useRef(null);
  const hasImage = !!p.image;

  return (
    <>
      <div className="object-header">
        <div className="object-title">
          <div className="object-icon" style={{ '--accent': '#8fa87c' }}><Globe size={26} strokeWidth={1.5} /></div>
          <div>
            <div className="eyebrow">Satellite drape</div>
            <h1>{layer.name}</h1>
          </div>
        </div>
        <div className="object-actions">
          <button
            className={`enabled-pill ${layer.enabled === false ? 'disabled' : ''}`}
            type="button"
            onClick={() => onChange({ enabled: layer.enabled === false })}
          >
            <span />{layer.enabled === false ? 'Disabled' : 'Enabled'}
          </button>
        </div>
      </div>

      <SectionLabel left="PROPERTIES" right="Projected satellite texture over the surface stack" />

      <div className="property-switches" role="group" aria-label="Satmap controls">
        <PropertySwitch label={p.source === 'image' ? 'Imported' : 'Generated'} icon={p.source === 'image' ? ImageIcon : Scan} on={p.source === 'image'} onClick={() => onParam('source', p.source === 'image' ? 'procedural' : 'image')} />
        <PropertySwitch label="Drape" icon={Globe} on={layer.enabled !== false} onClick={() => onChange({ enabled: layer.enabled === false })} />
        <PropertySwitch label="Rock guard" icon={Mountain} on={p.slopeProtect > 0} onClick={() => onParam('slopeProtect', p.slopeProtect > 0 ? 0 : 0.45)} />
      </div>

      <div className="cards">
        <Card title="Source" icon={Scan} accent="#8fa87c">
          <Select
            label="Texture source"
            value={p.source}
            options={[
              { value: 'procedural', label: 'Generated from the terrain' },
              { value: 'image', label: 'Imported satellite image' },
            ]}
            note="Generated imagery always agrees with the height field"
            onChange={(v) => onParam('source', v)}
          />
          <div
            className={`dropzone ${dragging ? 'over' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click(); }}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) onImportImage(f); }}
          >
            <Upload size={20} />
            <strong>Drop a satellite image</strong>
            <span>PNG, JPEG or WebP · resampled to 2048 px max · stays in this browser</span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: 'none' }}
            aria-label="Satellite image file"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onImportImage(f); }}
          />
          {hasImage ? (
            <div className="asset-chip">
              <img src={p.imagePreview || ''} alt="" />
              <div>
                <strong>{p.imageName || 'Satellite image'}</strong>
                <small>{p.image?.width} × {p.image?.height} · {(p.imageBytes ? (p.imageBytes / 1024).toFixed(0) : 0)} KB source</small>
              </div>
              <button className="icon-button" type="button" aria-label="Remove image" onClick={onClearImage}><Trash2 size={14} /></button>
            </div>
          ) : null}
          {p.source === 'image' && !hasImage ? (
            <Note>Imported source selected but no image is loaded — the drape falls back to the procedural generator.</Note>
          ) : null}
        </Card>

        {p.source === 'procedural' ? (
          <Card title="Procedural satellite" icon={Globe} accent="#8fa87c" caption={<span className="small-pill">Derived from terrain</span>}>
            <Slider label="Vegetation" value={p.vegetation} min={0} max={1} step={0.01} onChange={(v) => onParam('vegetation', v)} hint="Green density across the lowlands" />
            <RangeLabels left="Arid" right="Lush" />
            <Slider label="Aridity" value={p.aridity} min={0} max={1} step={0.01} onChange={(v) => onParam('aridity', v)} />
            <Slider label="Parcel size" value={p.parcelScale} min={4} max={90} step={0.5} onChange={(v) => onParam('parcelScale', v)} hint="Farmland and field boundaries" />
            <Slider label="Parcel contrast" value={p.parcelContrast} min={0} max={1} step={0.01} onChange={(v) => onParam('parcelContrast', v)} />
            <Slider label="River threshold" value={p.riverThreshold} min={0.05} max={0.95} step={0.005} onChange={(v) => onParam('riverThreshold', v)} hint="Flow accumulation at which a channel appears" />
            <Slider label="River width" value={p.riverWidth} min={0.2} max={6} step={0.1} onChange={(v) => onParam('riverWidth', v)} />
            <Slider label="Water depth" value={p.waterDepth} min={0.05} max={1} step={0.01} onChange={(v) => onParam('waterDepth', v)} />
            <Slider label="Coastal shallows" value={p.coastalShallows} min={0} max={1} step={0.01} onChange={(v) => onParam('coastalShallows', v)} />
            <Slider label="Rock blend" value={p.rockBlend} min={0} max={1} step={0.01} onChange={(v) => onParam('rockBlend', v)} hint="Bare rock showing through on steep faces" />
            <Slider label="Snow blend" value={p.snowBlend} min={0} max={1} step={0.01} onChange={(v) => onParam('snowBlend', v)} />
            <Slider label="Cloud shadow" value={p.clouds} min={0} max={1} step={0.01} onChange={(v) => onParam('clouds', v)} />
            <Slider label="Cloud size" value={p.cloudScale} min={1} max={24} step={0.5} onChange={(v) => onParam('cloudScale', v)} disabled={p.clouds <= 0} />
            <Slider label="Sensor sharpness" value={p.sharpness} min={0} max={1} step={0.01} onChange={(v) => onParam('sharpness', v)} />
            <SeedField label="Seed" value={p.seed} onChange={(v) => onParam('seed', v)} onRandomize={() => onParam('seed', 1 + Math.floor(Math.random() * 999998))} />
          </Card>
        ) : null}

        <Card title="Projection" icon={Map} accent="#9cbde7">
          <Slider label="Tiling" value={p.tiling} min={0.1} max={8} step={0.01} onChange={(v) => onParam('tiling', v)} hint="Repeats across the grid — keep at 1 for one full scene tile" />
          <Slider label="Offset X" value={p.offsetX} min={-1} max={1} step={0.005} onChange={(v) => onParam('offsetX', v)} />
          <Slider label="Offset Y" value={p.offsetY} min={-1} max={1} step={0.005} onChange={(v) => onParam('offsetY', v)} />
          <Slider label="Rotation" value={p.rotation} min={0} max={360} step={1} unit="°" onChange={(v) => onParam('rotation', v)} />
          <RangeLabels left="North" right="North" />
        </Card>

        <Card title="Grade & composite" icon={Contrast} accent="#d3bea0">
          <Select
            label="Composite mode"
            value={p.mode}
            options={[
              { value: 'blend', label: 'Blend over splat layers' },
              { value: 'replace', label: 'Replace splat layers' },
              { value: 'multiply', label: 'Multiply into splat layers' },
            ]}
            onChange={(v) => onParam('mode', v)}
          />
          <Slider label="Opacity" value={p.opacity} min={0} max={1} step={0.01} onChange={(v) => onParam('opacity', v)} />
          <Slider label="Brightness" value={p.brightness} min={0.3} max={2} step={0.01} onChange={(v) => onParam('brightness', v)} />
          <Slider label="Contrast" value={p.contrast} min={0.3} max={2.5} step={0.01} onChange={(v) => onParam('contrast', v)} />
          <Slider label="Saturation" value={p.saturation} min={0} max={2.5} step={0.01} onChange={(v) => onParam('saturation', v)} />
          <RangeLabels left="Monochrome" right="Vivid" />
          <Slider label="Warmth" value={p.warmth} min={-1} max={1} step={0.01} onChange={(v) => onParam('warmth', v)} />
          <Slider label="Rock guard" value={p.slopeProtect} min={0} max={1} step={0.01} onChange={(v) => onParam('slopeProtect', v)} hint="Keeps procedural rock on steep faces so cliffs stay readable" />
        </Card>

        <Card title="Layer" icon={Layers} accent="#8fa87c">
          <label style={{ display: 'block' }}>
            <span style={{ display: 'block', fontSize: 9, letterSpacing: 1.2, textTransform: 'uppercase', color: '#8a8a8a', marginBottom: 8 }}>Layer name</span>
            <input className="frontier-input" value={layer.name} maxLength={48} onChange={(e) => onChange({ name: e.target.value })} />
          </label>
          <div className="layer-actions">
            <button className="frontier-button" type="button" onClick={onDuplicate}><Copy size={13} /> Duplicate</button>
            <button className="frontier-button danger" type="button" onClick={onDelete}><Trash2 size={13} /> Delete</button>
          </div>
        </Card>
      </div>
    </>
  );
}

/* --------------------------------------------------------- landscape root */

function LandscapeInspector({ project, onChange, onSun, onView, onWater, onExport, onImportHeightmap, bake, bakeState, onRebake, saved, onSave, toggles, onToggle }) {
  const fileRef = useRef(null);
  const cost = useMemo(() => estimateCost(project), [project]);
  const sun = project.sun;
  const view = project.view;

  return (
    <>
      <div className="object-header">
        <div className="object-title">
          <div className="object-icon" style={{ '--accent': '#d6a078' }}><Mountain size={28} strokeWidth={1.5} /></div>
          <div>
            <div className="eyebrow">Landscape document</div>
            <h1>{project.name}</h1>
          </div>
        </div>
        <div className="object-actions">
          <button className="frontier-button" type="button" onClick={onRebake} disabled={bakeState.busy}>
            <RotateCcw size={13} /> Re-bake
          </button>
        </div>
      </div>

      <SectionLabel left="DOCUMENT" right="Grid, elevation, lighting, water & export" />

      <div className="property-switches" role="group" aria-label="Viewport overlays">
        <PropertySwitch label="Water" icon={Waves} on={!!toggles.water} onClick={() => onToggle('water')} />
        <PropertySwitch label="Contours" icon={Waypoints} on={!!toggles.contours} onClick={() => onToggle('contours')} />
        <PropertySwitch label="Grid" icon={Grid3x3} on={!!toggles.grid} onClick={() => onToggle('grid')} />
        <PropertySwitch label="Specular" icon={Sun} on={view.specular} onClick={() => onView('specular', !view.specular)} />
      </div>

      <div className="cards">
        <Card title="Terrain grid" icon={Grid3x3} accent="#d6a078">
          <Select
            label="Resolution"
            value={project.resolution}
            options={RESOLUTIONS.map((r) => ({ value: r.value, label: `${r.label} · ${r.note}` }))}
            note="Changing this resamples every painted stroke"
            onChange={(v) => onChange({ resolution: v })}
          />
          <Slider label="World size" value={project.worldSize} min={256} max={16384} step={64} unit=" m" onChange={(v) => onChange({ worldSize: v })} hint="Distance across the grid — sets the real slope every erosion process sees" />
          <Slider label="Relief" value={project.maxHeight} min={20} max={6000} step={10} unit=" m" onChange={(v) => onChange({ maxHeight: v })} />
          <Slider label="Vertical exaggeration" value={project.heightScale} min={0.1} max={4} step={0.01} onChange={(v) => onChange({ heightScale: v })} hint="Display only — erosion still runs on the true proportions" />
          <Slider label="Sea level" value={project.seaLevel} min={0} max={1} step={0.005} onChange={(v) => { onChange({ seaLevel: v }); onWater('level', v); }} />
          <RangeLabels left="Sea bed" right="Summit" />
          <SeedField label="Master seed" value={project.seed} onChange={(v) => onChange({ seed: v })} onRandomize={() => onChange({ seed: 1 + Math.floor(Math.random() * 999998) })} />
          {cost.heavy ? (
            <div className="warning-strip">
              <AlertTriangle size={13} />
              <span>
                {num(cost.cells)} cells with {cost.erosionUnits.toFixed(1)} M erosion evaluations per bake.
                Runs in a worker, but expect seconds rather than milliseconds.
              </span>
            </div>
          ) : null}
        </Card>

        <Card title="Sun & atmosphere" icon={Sun} accent="#e8b65f">
          <Slider label="Azimuth" value={sun.azimuth} min={0} max={360} step={1} unit="°" onChange={(v) => onSun('azimuth', v)} />
          <Slider label="Elevation" value={sun.elevation} min={-10} max={90} step={0.5} unit="°" onChange={(v) => onSun('elevation', v)} />
          <RangeLabels left="Below horizon" right="Overhead" />
          <Slider label="Intensity" value={sun.intensity} min={0} max={3} step={0.01} onChange={(v) => onSun('intensity', v)} />
          <Slider label="Ambient" value={sun.ambient} min={0} max={1.5} step={0.01} onChange={(v) => onSun('ambient', v)} />
          <Slider label="Exposure" value={sun.exposure} min={0.2} max={2.5} step={0.01} onChange={(v) => onSun('exposure', v)} />
          <Slider label="Haze" value={sun.fog} min={0} max={1} step={0.01} onChange={(v) => onSun('fog', v)} />
          <ColorField label="Sun colour" value={sun.color} onChange={(v) => onSun('color', v)} />
          <ColorField label="Sky colour" value={sun.skyColor} onChange={(v) => onSun('skyColor', v)} />
          <ColorField label="Haze colour" value={sun.fogColor} onChange={(v) => onSun('fogColor', v)} />
        </Card>

        <Card title="Water" icon={Waves} accent="#74bdd4" on={view.water.enabled}>
          <Toggle label="Water plane" value={view.water.enabled} onChange={(v) => onWater('enabled', v)} />
          <Slider label="Level" value={view.water.level} min={0} max={1} step={0.005} onChange={(v) => { onWater('level', v); onChange({ seaLevel: v }); }} hint="Normalized against the relief range" />
          <Slider label="Opacity" value={view.water.opacity} min={0} max={1} step={0.01} onChange={(v) => onWater('opacity', v)} />
          <Slider label="Ripple" value={view.water.ripple} min={0} max={2} step={0.01} onChange={(v) => onWater('ripple', v)} />
          <Slider label="Shore foam" value={view.water.foam} min={0} max={1} step={0.01} onChange={(v) => onWater('foam', v)} />
          <ColorField label="Deep colour" value={view.water.deepColor} onChange={(v) => onWater('deepColor', v)} />
        </Card>

        <Card title="Surface detail" icon={Scan} accent="#cab281">
          <Slider label="Detail normal" value={view.detailStrength} min={0} max={1.5} step={0.01} onChange={(v) => onView('detailStrength', v)} hint="Tiled micro-relief so close-up ground is not plastic" />
          <Slider label="Detail scale" value={view.detailScale} min={4} max={220} step={1} onChange={(v) => onView('detailScale', v)} />
          <Slider label="Texture size" value={project.textureSize || 1024} min={256} max={2048} step={256} unit=" px" onChange={(v) => onChange({ textureSize: v })} note="Albedo bake resolution" />
          <Toggle label="Specular highlights" value={view.specular} onChange={(v) => onView('specular', v)} />
          <Slider label="Contour interval" value={view.contourInterval} min={5} max={250} step={5} unit=" m" onChange={(v) => onView('contourInterval', v)} />
          <Slider label="Index contour every" value={view.contourMajor} min={2} max={20} step={1} onChange={(v) => onView('contourMajor', v)} />
        </Card>

        <Card title="Import & export" icon={Download} accent="#a8bbeb">
          <div className="action-grid">
            <button className="frontier-button" type="button" onClick={() => onExport('png')}><ImageIcon size={13} /> Height PNG</button>
            <button className="frontier-button" type="button" onClick={() => onExport('r16')}><FileJson size={13} /> Raw .r16</button>
            <button className="frontier-button" type="button" onClick={() => onExport('normal')}><Scan size={13} /> Normal map</button>
            <button className="frontier-button" type="button" onClick={() => onExport('albedo')}><Palette size={13} /> Albedo PNG</button>
            <button className="frontier-button" type="button" onClick={() => onExport('obj')}><Box size={13} /> Wavefront OBJ</button>
            <button className="frontier-button" type="button" onClick={() => onExport('json')}><Download size={13} /> Project JSON</button>
          </div>
          <button className="frontier-button" type="button" style={{ width: '100%', marginTop: 8 }} onClick={() => fileRef.current?.click()}>
            <Upload size={13} /> Import a heightmap PNG
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: 'none' }}
            aria-label="Heightmap file"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onImportHeightmap(f); }}
          />
          <Note>
            Exports use the baked field at {project.resolution}². The <strong>.r16</strong> file is little-endian
            16-bit raw, row-major, bottom row first — the format most engines and Gaea / World Machine expect.
          </Note>
        </Card>

        {bake ? (
          <Card title="Bake report" icon={Gauge} accent="#9cbde7">
            <StatGrid items={[
              ['Peak', num((bake.stats.max || 0) * project.maxHeight, 0), 'm'],
              ['Low', num((bake.stats.min || 0) * project.maxHeight, 0), 'm'],
              ['Mean', num((bake.stats.mean || 0) * project.maxHeight, 0), 'm'],
              ['Relief', num(((bake.stats.max || 0) - (bake.stats.min || 0)) * project.maxHeight, 0), 'm'],
              ['Above sea', num((bake.stats.landFraction || 0) * 100, 1), '%'],
              ['Bake time', num(bake.ms || 0, 0), 'ms'],
            ]} />
          </Card>
        ) : null}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ shell */

export default function Inspector(props) {
  const {
    project, selection, saved, onSave, bake, bakeState, children,
  } = props;

  const crumb = selection.kind === 'landscape'
    ? 'Landscape'
    : selection.kind === 'surface' ? 'Surface' : 'Shape';
  const current = selection.kind === 'landscape'
    ? project.name
    : selection.layer?.name || 'Layer';

  return (
    <section className="inspector inspector-panel" style={{ '--accent': selection.layer?.color || '#d6a078' }}>
      <header className="inspector-top">
        <div>
          <span>Inspector</span>
          <ChevronRight size={13} />
          <span>{crumb}</span>
          <ChevronRight size={13} />
          <span className="crumb-current">{current}</span>
        </div>
        <button className={`save-status ${saved ? 'saved' : ''}`} type="button" onClick={onSave}>
          {saved ? <Check size={13} /> : <span className="unsaved-dot" />}
          {bakeState.busy ? 'Baking…' : saved ? 'All changes saved' : 'Save changes'}
        </button>
      </header>
      <div className="inspector-content">{children}</div>
      <footer className="inspector-footer" style={{ padding: '0 22px 20px' }}>
        <span><span className="footer-dot" />{bakeState.busy ? `Working · ${bakeState.label || ''}` : 'Changes apply in real time'}</span>
        <span>{project.resolution}² <span className="footer-slash">/</span> {project.worldSize} m</span>
      </footer>
    </section>
  );
}

export { ShapeLayerInspector, SplatInspector, SatmapInspector, LandscapeInspector };
