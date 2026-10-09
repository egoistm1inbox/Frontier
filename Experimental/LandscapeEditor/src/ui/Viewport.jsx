import React, { useEffect, useMemo, useRef } from 'react';
import { TerrainScene } from './TerrainScene.js';
import Glyph from './Glyph.jsx';
import Icon from './Icon.jsx';
import { buildFields, LEGEND } from './colour.js';
import { slopeDegrees } from '../engine/grid.js';
import { formatKm, formatMetres, formatMs, formatVolume } from './format.js';

export const VIEW_MODES = [
  { id: 'shaded', label: 'Shaded' },
  { id: 'satmap', label: 'Satmap' },
  { id: 'height', label: 'Height' },
  { id: 'slope', label: 'Slope' },
  { id: 'flow', label: 'Drainage' },
  { id: 'erosion', label: 'Erosion' },
];

export default function Viewport({ settings, result, preview, texture, job, mode, onMode, view, onView, onRun, onCancel, onFrame, frameNonce }) {
  const hostRef = useRef(null);
  const sceneRef = useRef(null);
  const heights = preview?.heights ?? result?.heights ?? null;
  const size = result?.size ?? settings.resolution;
  const cellMetres = settings.size / (size - 1);
  const running = !!job?.running;

  // The scene is created once and disposed with the component.
  useEffect(() => {
    const scene = new TerrainScene(hostRef.current);
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Geometry first, then colours: colours depend on the same heights, so they must follow.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !heights) return;
    scene.setTerrain({
      heights,
      size,
      worldSize: settings.size,
      maxHeight: settings.maxHeight,
      exaggeration: view.exaggeration,
      seaLevel: settings.seaLevel,
    });
  }, [heights, size, settings.size, settings.maxHeight, settings.seaLevel, view.exaggeration]);

  const needsSlope = !!heights && (mode === 'slope' || mode === 'shaded');
  const slope = useMemo(
    () => (needsSlope ? slopeDegrees(heights, size, cellMetres, settings.maxHeight) : null),
    [needsSlope, heights, size, cellMetres, settings.maxHeight],
  );

  const colours = useMemo(() => {
    if (!heights) return null;
    const fieldMode = mode === 'satmap' ? 'shaded' : mode === 'flow' && !result ? 'shaded' : mode === 'erosion' && !result ? 'shaded' : mode;
    return buildFields(fieldMode, {
      heights,
      size,
      maxHeight: settings.maxHeight,
      seaLevel: settings.seaLevel,
      slope: slope ?? new Float32Array(heights.length),
      flow: result?.flow,
      erosionDelta: result?.erosionDelta,
    });
  }, [heights, size, mode, slope, result, settings.maxHeight, settings.seaLevel]);

  useEffect(() => {
    sceneRef.current?.setColours(colours);
  }, [colours]);

  useEffect(() => {
    sceneRef.current?.setTexture(texture ?? null, result?.textureSize ?? 0);
  }, [texture, result?.textureSize]);

  useEffect(() => {
    sceneRef.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    sceneRef.current?.setWater(view.water);
  }, [view.water]);

  useEffect(() => {
    sceneRef.current?.setWireframe(view.wireframe);
  }, [view.wireframe]);

  useEffect(() => {
    sceneRef.current?.setSun(view.sunAzimuth, view.sunElevation);
  }, [view.sunAzimuth, view.sunElevation]);

  useEffect(() => {
    sceneRef.current?.setProjection(view.projection);
  }, [view.projection]);

  useEffect(() => {
    if (frameNonce) sceneRef.current?.frame();
  }, [frameNonce]);

  const stats = result?.stats;
  const legend = LEGEND[mode];
  const erosionPeak = result ? peakErosion(result.erosionDelta) * settings.maxHeight : 0;
  const badge = running ? 'SIMULATING' : mode === 'satmap' ? 'SATMAP' : mode.toUpperCase();

  return (
    <>
      <div className="viewport-toolbar" role="toolbar" aria-label="Viewport tools">
        <div className="viewport-heading-row">
          <div className="viewport-identity">
            <Icon name="terrain" size={24} />
            <div>
              <strong>Landscape</strong>
              <span>
                {size}² cells · {formatKm(settings.size)} · {settings.maxHeight} m
              </span>
            </div>
            <span className={'viewport-preview-badge ' + (running ? 'live' : '')} title="Rendering mode">
              {badge}
            </span>
          </div>
          <div className="viewport-modes" role="group" aria-label="View mode">
            {VIEW_MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={mode === item.id}
                className={mode === item.id ? 'active' : ''}
                onClick={() => onMode(item.id)}
              >
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="viewport-action-row">
          {running ? (
            <button type="button" className="viewport-construct lx-stop" onClick={onCancel} title="Stop the simulation">
              <Glyph name="stop" size={14} />
              <span>Cancel</span>
            </button>
          ) : (
            <button
              type="button"
              className="viewport-construct"
              onClick={onRun}
              title="Replay the erosion layers · Ctrl+R"
            >
              <Glyph name="play" size={14} />
              <span>Run simulation</span>
              <kbd>Ctrl+R</kbd>
            </button>
          )}
          <button type="button" className="viewport-icon-button" aria-label="Frame terrain" title="Frame terrain · F" onClick={onFrame}>
            <Glyph name="focus" size={17} />
          </button>
          <button
            type="button"
            className="viewport-icon-button"
            aria-label="Toggle water"
            aria-pressed={view.water}
            title="Sea surface"
            onClick={() => onView({ water: !view.water })}
          >
            <Glyph name="water" size={17} />
          </button>
          <button
            type="button"
            className="viewport-icon-button"
            aria-label="Toggle wireframe"
            aria-pressed={view.wireframe}
            title="Wireframe"
            onClick={() => onView({ wireframe: !view.wireframe })}
          >
            <Glyph name="wire" size={17} />
          </button>
          <span className="viewport-tool-divider" />
          <label className="viewport-projection" title="Camera projection">
            <span>View</span>
            <select aria-label="Viewport projection" value={view.projection} onChange={(event) => onView({ projection: event.target.value })}>
              <option value="perspective">Perspective</option>
              <option value="top">Top</option>
            </select>
          </label>
          <label className="viewport-projection" title="Vertical exaggeration">
            <span>Relief</span>
            <select
              aria-label="Vertical exaggeration"
              value={String(view.exaggeration)}
              onChange={(event) => onView({ exaggeration: Number(event.target.value) })}
            >
              {[1, 1.5, 2, 3].map((value) => (
                <option key={value} value={String(value)}>
                  {value}×
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="scene-image lx-scene">
        <div className="lx-scene-host" ref={hostRef} />
        {running && (
          <div className="lx-hud lx-hud-progress" role="status" aria-live="polite">
            <div className="lx-hud-title">
              <span>{job.label || 'Evaluating'}</span>
              <b>{Math.round((job.fraction || 0) * 100)}%</b>
            </div>
            <div className="lx-progress" style={{ '--p': `${Math.round((job.fraction || 0) * 100)}%` }}>
              <i />
            </div>
          </div>
        )}
        {!result && !running && <div className="lx-hud">Evaluating terrain…</div>}
        {legend && (
          <div className="lx-legend" aria-label="Legend">
            {mode === 'erosion' ? (
              <span className="lx-legend-caption">Peak change ±{erosionPeak.toFixed(1)} m</span>
            ) : (
              <span className="lx-legend-caption">{mode === 'height' ? 'Altitude' : mode === 'slope' ? 'Slope' : 'Drainage'}</span>
            )}
            <div className="lx-legend-bar" style={{ background: `linear-gradient(to right, ${legend.stops.map(([t, c]) => `${c} ${Math.round(t * 100)}%`).join(', ')})` }} />
            <div className="lx-legend-labels">
              {legend.labels.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
          </div>
        )}
      </div>
      <footer className="viewport-footer" title="Measured from the current evaluation">
        {stats ? (
          <>
            RELIEF <b>{formatMetres(stats.minMetres)}–{formatMetres(stats.maxMetres)}</b> · SEA <b>{formatMetres(settings.seaLevel)}</b> · WATER{' '}
            <b>{Math.round(stats.waterFraction * 100)}%</b> · MEAN SLOPE <b>{stats.meanSlope.toFixed(1)}°</b> · ERODED{' '}
            <b>{formatVolume(stats.erodedVolume)}</b> · DEPOSITED <b>{formatVolume(stats.depositedVolume)}</b> · EVAL{' '}
            <b>{formatMs(stats.milliseconds)}</b>
          </>
        ) : (
          'NO EVALUATION YET'
        )}
      </footer>
    </>
  );
}

function peakErosion(delta) {
  if (!delta) return 0;
  let peak = 0;
  for (let i = 0; i < delta.length; i += 1) peak = Math.max(peak, Math.abs(delta[i]));
  return peak;
}
