import React from 'react';
import Glyph from './Glyph.jsx';
import { Card, NumberControl, SelectControl, SwitchControl, TextControl, ColourControl, Readout, Button, Note, HeightPreview, RgbaPreview } from './Controls.jsx';
import { LayerKinds, ErosionTypes, EROSION_ORDER, BLEND_MODES, MaskControls, SIZES, RESOLUTIONS, SATMAP_RESOLUTIONS, SatmapControls, SatmapColours, describeLayer, defaultLayerName } from '../engine/specs.js';
import { formatMetres, formatVolume, formatKm, formatMs } from './format.js';

const randomSeed = () => Math.floor(Math.random() * 100000);

export default function Inspector({ project, selection, result, texture, actions }) {
  if (selection.kind === 'landscape') return <LandscapeInspector project={project} result={result} actions={actions} />;
  if (selection.kind === 'satmap') return <SatmapInspector project={project} result={result} texture={texture} actions={actions} />;
  const layer = project.layers.find((entry) => entry.id === selection.id);
  if (!layer) return <div className="empty-dock">Select a layer in the stack</div>;
  return <LayerInspector layer={layer} project={project} result={result} actions={actions} />;
}

function LandscapeInspector({ project, result, actions }) {
  const settings = project.settings;
  const set = (key, value) => actions.patchSettings((s) => ({ ...s, [key]: value }), 'settings:' + key);
  const stats = result?.stats;
  return (
    <>
      <Card title="Preview" glyph="landscape" wide>
        {result ? (
          <HeightPreview heights={result.heights} size={result.size} seaLevel={settings.seaLevel} maxHeight={settings.maxHeight} />
        ) : (
          <Note>Evaluating the stack…</Note>
        )}
        {stats && (
          <>
            <Readout label="Relief" value={`${formatMetres(stats.minMetres)} – ${formatMetres(stats.maxMetres)}`} />
            <Readout label="Water cover" value={Math.round(stats.waterFraction * 100) + '%'} />
            <Readout label="Mean slope" value={stats.meanSlope.toFixed(1) + '°'} />
            <Readout label="Eroded" value={formatVolume(stats.erodedVolume)} />
            <Readout label="Deposited" value={formatVolume(stats.depositedVolume)} />
            <Readout label="Evaluation" value={formatMs(stats.milliseconds)} />
          </>
        )}
      </Card>
      <Card title="Terrain" glyph="sliders">
        <SelectControl
          label="Extent"
          value={settings.size}
          options={SIZES.map((size) => ({ value: size, label: formatKm(size) + ' square' }))}
          onChange={(value) => set('size', value)}
        />
        <SelectControl
          label="Grid resolution"
          value={settings.resolution}
          options={RESOLUTIONS.map((size) => ({ value: size, label: `${size} × ${size}` }))}
          onChange={(value) => set('resolution', value)}
        />
        <NumberControl label="Max relief" value={settings.maxHeight} min={50} max={2000} step={10} unit="m" onChange={(value) => set('maxHeight', value)} />
        <NumberControl label="Sea level" value={settings.seaLevel} min={0} max={settings.maxHeight} step={1} unit="m" onChange={(value) => set('seaLevel', value)} />
        <div className="lx-inline-row">
          <NumberControl label="Seed" value={settings.seed} min={0} max={99999} step={1} onChange={(value) => set('seed', value)} />
          <Button title="Shuffle the seed of the landscape" onClick={() => set('seed', randomSeed())}>
            <Glyph name="dice" size={15} />
            Shuffle
          </Button>
        </div>
        <Note>Grid resolution and extent change the cell size. Layers are recomputed, so large grids take longer.</Note>
      </Card>
      <Card title="Project" glyph="save">
        <div className="lx-button-grid">
          <Button onClick={actions.newProject}>
            <Glyph name="reset" size={15} />
            New
          </Button>
          <Button onClick={actions.openProjectDialog}>
            <Glyph name="open" size={15} />
            Open…
          </Button>
          <Button onClick={actions.saveProject}>
            <Glyph name="save" size={15} />
            Save
          </Button>
          <Button onClick={actions.exportHeightmap} disabled={!result}>
            <Glyph name="download" size={15} />
            Heightmap
          </Button>
          <Button onClick={actions.exportSatmap} disabled={!result}>
            <Glyph name="download" size={15} />
            Satmap
          </Button>
        </div>
        <Note>Heightmap PNG is 16-bit greyscale, scaled to the max relief. Save writes a JSON file you can reopen.</Note>
      </Card>
      <Card title="Shortcuts" glyph="sliders">
        <dl className="lx-shortcuts">
          <dt>Undo / redo</dt>
          <dd>Ctrl+Z · Ctrl+Shift+Z</dd>
          <dt>Duplicate / delete</dt>
          <dd>Ctrl+D · Del</dd>
          <dt>Move layer</dt>
          <dd>Alt+↑ · Alt+↓</dd>
          <dt>Replay erosion</dt>
          <dd>Ctrl+R</dd>
          <dt>Frame terrain</dt>
          <dd>F</dd>
        </dl>
      </Card>
    </>
  );
}

function LayerInspector({ layer, project, result, actions }) {
  const spec = LayerKinds[layer.kind];
  const index = project.layers.findIndex((entry) => entry.id === layer.id);
  const outcome = result?.layers?.find((entry) => entry.id === layer.id);
  const metrics = outcome?.metrics;
  const setLayer = (key, value) => actions.patchLayer(layer.id, (l) => ({ ...l, [key]: value }), `layer:${layer.id}:${key}`);
  const setParam = (key, value) => actions.patchLayer(layer.id, (l) => ({ ...l, params: { ...l.params, [key]: value } }), `layer:${layer.id}:${key}`);
  const setMask = (key, value) => actions.patchLayer(layer.id, (l) => ({ ...l, mask: { ...l.mask, [key]: value } }), `mask:${layer.id}:${key}`);
  const erosionType = layer.kind === 'erosion' ? layer.params.type : null;
  const erosion = erosionType ? ErosionTypes[erosionType] : null;
  const setErosionParam = (key, value) =>
    actions.patchLayer(
      layer.id,
      (l) => ({ ...l, params: { ...l.params, [l.params.type]: { ...l.params[l.params.type], [key]: value } } }),
      `layer:${layer.id}:${erosionType}:${key}`,
    );
  const hasBlend = !!spec.generator;
  const hideAmplitude = layer.blend === 'multiply';

  return (
    <>
      <Card title="Layer" glyph="layers" aside={`${index + 1} of ${project.layers.length}`}>
        <TextControl label="Name" value={layer.name} onChange={(value) => setLayer('name', value)} />
        <SwitchControl label="Enabled" value={layer.enabled} onChange={(value) => setLayer('enabled', value)} />
        <Readout label="Type" value={erosion ? erosion.shortLabel : spec.shortLabel} />
        {hasBlend && (
          <SelectControl label="Blend" value={layer.blend} options={BLEND_MODES} onChange={(value) => setLayer('blend', value)} />
        )}
        <NumberControl label="Opacity" value={layer.opacity} min={0} max={1} step={0.01} decimals={0} unit="%" scale={100} onChange={(value) => setLayer('opacity', value)} />
        <div className="lx-inline-row">
          <NumberControl label="Seed" value={layer.seed} min={0} max={99999} step={1} onChange={(value) => setLayer('seed', value)} />
          <Button title="New random seed for this layer" onClick={() => setLayer('seed', randomSeed())}>
            <Glyph name="dice" size={15} />
            Shuffle
          </Button>
        </div>
        <Note>{erosion ? erosion.summary : spec.description}</Note>
        <div className="lx-button-grid">
          <Button onClick={() => actions.moveLayer(layer.id, 1)} disabled={index >= project.layers.length - 1} title="Move up the stack · Alt+↑">
            <Glyph name="up" size={15} />
            Move up
          </Button>
          <Button onClick={() => actions.moveLayer(layer.id, -1)} disabled={index <= 0} title="Move down the stack · Alt+↓">
            <Glyph name="down" size={15} />
            Move down
          </Button>
          <Button onClick={() => actions.duplicateLayer(layer.id)} title="Duplicate · Ctrl+D">
            <Glyph name="duplicate" size={15} />
            Duplicate
          </Button>
          <Button onClick={() => actions.deleteLayer(layer.id)} title="Delete · Del">
            <Glyph name="trash" size={15} />
            Delete
          </Button>
        </div>
      </Card>

      {erosion && (
        <Card title="Erosion process" glyph="reset" accent="#ffb454">
          <SelectControl
            label="Process"
            value={erosionType}
            options={EROSION_ORDER.map((id) => ({ value: id, label: ErosionTypes[id].label }))}
            onChange={(value) =>
              actions.patchLayer(
                layer.id,
                (l) => {
                  // A layer keeps a default name until the user renames it; the name follows the process.
                  const wasDefault = l.name.toLowerCase() === defaultLayerName('erosion', { type: l.params.type }).toLowerCase();
                  return {
                    ...l,
                    name: wasDefault ? defaultLayerName('erosion', { type: value }) : l.name,
                    params: { ...l.params, type: value },
                  };
                },
                `layer:${layer.id}:type`,
              )
            }
          />
          <Note>{erosion.summary}</Note>
          <div className="lx-button-grid">
            <Button primary onClick={actions.replayErosion} title="Replay this erosion from the terrain below it">
              <Glyph name="play" size={14} />
              Replay simulation
            </Button>
          </div>
        </Card>
      )}

      {erosion && (
        <Card title={erosion.shortLabel + ' settings'} glyph="sliders" className="lx-erosion-card">
          {erosion.controls.map((control) =>
            control.type === 'select' ? (
              <SelectControl
                key={control.key}
                label={control.label}
                value={layer.params[erosionType][control.key]}
                options={control.options}
                onChange={(value) => setErosionParam(control.key, value)}
              />
            ) : (
              <NumberControl
                key={control.key}
                label={control.label}
                value={layer.params[erosionType][control.key]}
                min={control.min}
                max={control.max}
                step={control.step}
                decimals={control.decimals}
                unit={control.unit}
                onChange={(value) => setErosionParam(control.key, value)}
              />
            ),
          )}
        </Card>
      )}

      {!erosion && spec.controls.length > 0 && (
        <Card title="Parameters" glyph="sliders">
          {spec.controls
            .filter((control) => !(control.amplitude && hideAmplitude))
            .map((control) => (
              <NumberControl
                key={control.key}
                label={control.label}
                value={layer.params[control.key]}
                min={control.min}
                max={control.max}
                step={control.step}
                decimals={control.decimals}
                unit={control.unit}
                onChange={(value) => setParam(control.key, value)}
              />
            ))}
          {hideAmplitude && <Note>Multiply blend ignores amplitude. The falloff alone sets the shape.</Note>}
        </Card>
      )}

      <Card title="Mask" glyph="eye" aside={layer.mask.enabled ? 'on' : 'off'}>
        <SwitchControl label="Restrict to mask" value={layer.mask.enabled} onChange={(value) => setMask('enabled', value)} />
        {MaskControls.map((control) => (
          <NumberControl
            key={control.key}
            label={control.label}
            value={layer.mask[control.key]}
            min={control.min}
            max={control.max}
            step={control.step}
            decimals={control.decimals}
            unit={control.unit}
            disabled={!layer.mask.enabled}
            onChange={(value) => setMask(control.key, value)}
          />
        ))}
        <SwitchControl label="Invert mask" value={layer.mask.invert} disabled={!layer.mask.enabled} onChange={(value) => setMask('invert', value)} />
      </Card>

      <Card title="Output" glyph="image" wide>
        {outcome?.snapshot ? (
          <HeightPreview heights={outcome.snapshot} size={64} seaLevel={project.settings.seaLevel} maxHeight={project.settings.maxHeight} />
        ) : (
          <Note>Output appears after the stack evaluates.</Note>
        )}
        {outcome && (
          <>
            <Readout label="Status" value={!layer.enabled ? 'Off, passes through' : outcome.cached ? 'Cached' : 'Computed'} />
            {metrics && (
              <>
                <Readout label="Range" value={`${formatMetres(metrics.minMetres)} – ${formatMetres(metrics.maxMetres)}`} />
                <Readout label="Changed" value={Math.round(metrics.changedFraction * 100) + '% of cells'} />
              </>
            )}
            {metrics?.simulated && (
              <>
                <Readout label="Removed" value={formatVolume(metrics.removedVolume)} />
                <Readout label="Deposited" value={formatVolume(metrics.depositedVolume)} />
              </>
            )}
            {metrics && <Readout label="Time" value={formatMs(metrics.milliseconds)} />}
          </>
        )}
        <Note>{describeLayer(layer)}</Note>
      </Card>
    </>
  );
}

function SatmapInspector({ project, result, texture, actions }) {
  const satmap = project.satmap;
  const set = (key, value) => actions.patchSatmap((s) => ({ ...s, [key]: value }), 'satmap:' + key);
  const setColour = (key, value) => actions.patchSatmap((s) => ({ ...s, colours: { ...s.colours, [key]: value } }), 'satmap:colour:' + key);
  return (
    <>
      <Card title="Preview" glyph="satmap" wide aside={`${satmap.resolution}²`}>
        {texture && result ? <RgbaPreview rgba={texture} size={result.textureSize} /> : <Note>Evaluating the satmap…</Note>}
        <Note>
          Satmap colours each cell from its altitude, slope, drainage and erosion. Rivers come from the routed flow, and beaches from the coastal band.
        </Note>
      </Card>
      <Card title="Source" glyph="image">
        <SelectControl
          label="Source"
          value={satmap.source}
          options={[
            { value: 'procedural', label: 'Procedural classes' },
            { value: 'imported', label: 'Procedural + imported image' },
          ]}
          onChange={(value) => set('source', value)}
        />
        <SelectControl
          label="Texture resolution"
          value={satmap.resolution}
          options={SATMAP_RESOLUTIONS.map((size) => ({ value: size, label: `${size} × ${size}` }))}
          onChange={(value) => set('resolution', value)}
        />
        <div className="lx-button-grid">
          <Button onClick={actions.pickImage}>
            <Glyph name="upload" size={15} />
            Import image…
          </Button>
          <Button onClick={actions.clearImage} disabled={!actions.hasImage}>
            <Glyph name="close" size={15} />
            Clear image
          </Button>
        </div>
        {actions.hasImage && (
          <>
            <Note>Imported “{actions.imageName}” is kept for this session and is not saved in the project file.</Note>
            <NumberControl label="Image blend" value={satmap.imageBlend} min={0} max={1} step={0.01} unit="%" scale={100} onChange={(value) => set('imageBlend', value)} />
          </>
        )}
      </Card>
      <Card title="Biomes & water" glyph="water">
        {SatmapControls.biomes.map((control) => (
          <NumberControl
            key={control.key}
            label={control.label}
            value={satmap[control.key]}
            min={control.min}
            max={control.max}
            step={control.step}
            decimals={control.decimals}
            unit={control.unit}
            scale={control.scale ?? 1}
            onChange={(value) => set(control.key, value)}
          />
        ))}
      </Card>
      <Card title="Light & detail" glyph="sun">
        {SatmapControls.detail.map((control) => (
          <NumberControl
            key={control.key}
            label={control.label}
            value={satmap[control.key]}
            min={control.min}
            max={control.max}
            step={control.step}
            decimals={control.decimals}
            unit={control.unit}
            scale={control.scale ?? 1}
            onChange={(value) => set(control.key, value)}
          />
        ))}
      </Card>
      <Card title="Palette" glyph="landscape">
        {SatmapColours.map((colour) => (
          <ColourControl key={colour.key} label={colour.label} value={satmap.colours[colour.key]} onChange={(value) => setColour(colour.key, value)} />
        ))}
      </Card>
    </>
  );
}
