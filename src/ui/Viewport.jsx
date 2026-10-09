/**
 * Frontier Landscape Studio — the viewport.
 *
 * Centre column: WebGL2 terrain, orbit / pan / zoom, live sculpting, diagnostic
 * view modes and a HUD that reports what the bake actually produced.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera, MapPinned, Crosshair, Grid3x3, Waypoints, Waves, Brush, Sun,
  Maximize2, RotateCcw, ChevronRight, LoaderCircle, Move,
} from 'lucide-react';
import { TerrainRenderer, VIEW_MODE_LIST } from '../render/renderer.js';
import { VIEW_ICONS, TOOL_ICONS } from './icons.jsx';
import { RAMPS, rampColor, hexToRgb } from '../core/textures.js';

const rgbCss = (hex) => {
  const [r, g, b] = hexToRgb(hex);
  return [r / 255, g / 255, b / 255];
};

const rampGradient = (ramp) =>
  `linear-gradient(90deg, ${[0, 0.2, 0.4, 0.6, 0.8, 1]
    .map((t) => {
      const [r, g, b] = rampColor(ramp, t);
      return `rgb(${r | 0},${g | 0},${b | 0}) ${t * 100}%`;
    })
    .join(',')})`;

function Compass({ yaw }) {
  const deg = (-yaw * 180) / Math.PI;
  return (
    <svg className="compass" viewBox="0 0 62 62" aria-hidden="true">
      <circle cx="31" cy="31" r="26" fill="#14141499" stroke="#ffffff17" />
      <g transform={`rotate(${deg} 31 31)`}>
        <path d="M31 9 L36 31 L31 27 L26 31 Z" fill="#dcdcdc" />
        <path d="M31 53 L26 31 L31 35 L36 31 Z" fill="#6d6d6d" />
        <text x="31" y="7" textAnchor="middle" fontSize="7" fill="#e2e2e2" fontFamily="inherit">N</text>
      </g>
      <circle cx="31" cy="31" r="2.2" fill="#9a9a9a" />
    </svg>
  );
}

export default function Viewport({
  project, bake, viewMode, onViewMode, toggles, onToggle, sunDir,
  brush, onBrushChange, canPaint, activeBrushLayer, onStroke, bakeState,
  onCameraPreset, cameraRef, stats, apiRef,
}) {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const [error, setError] = useState('');
  const [hover, setHover] = useState(null);
  const dragRef = useRef(null);
  const paintRef = useRef(null);
  const stateRef = useRef({});
  const [time, setTime] = useState(0);
  const [fps, setFps] = useState(60);
  const frameCount = useRef(0);
  const lastFpsAt = useRef(performance.now());

  /* ------------------------------------------------------- renderer lifecycle */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    try {
      rendererRef.current = new TerrainRenderer(canvas);
      cameraRef.current = rendererRef.current.camera;
    } catch (e) {
      setError(e.message || 'Could not start WebGL.');
      return undefined;
    }
    const onLost = (e) => { e.preventDefault(); setError('Graphics context lost. Reload to continue.'); };
    canvas.addEventListener('webglcontextlost', onLost);
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      rendererRef.current = null;
    };
  }, [cameraRef]);

  /* ------------------------------------------------------- imperative handle */

  useEffect(() => {
    if (!apiRef) return undefined;
    apiRef.current = {
      patchHeight: (height, x0, y0, x1, y1) =>
        rendererRef.current?.patchHeight(height, x0, y0, x1, y1),
      getRenderer: () => rendererRef.current,
    };
    return () => { apiRef.current = null; };
  }, [apiRef]);

  /* ------------------------------------------------------------- upload data */

  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !bake || !bake.height) return;
    r.setHeight(bake.height, bake.resolution, project.worldSize, project.maxHeight);
    if (bake.albedo) r.setAlbedo(bake.albedo, bake.albedoSize);
    if (bake.detail) r.setDetailNormal(bake.detail, bake.detailSize);
    r.setDiagnostics({
      slope: { field: bake.slope, res: bake.resolution },
      flow: { field: bake.flow, res: bake.resolution },
      erosion: { field: bake.erosionDelta === undefined ? bake.erosion : bake.erosionDelta, res: bake.resolution },
      water: { field: bake.water, res: bake.resolution },
      talus: { field: bake.talus, res: bake.resolution },
      heightR8: { field: bake.height, res: bake.resolution },
    });
  }, [bake, project.worldSize, project.maxHeight]);

  /* ------------------------------------------------------------ render state */

  stateRef.current = useMemo(() => {
    const sun = project.sun;
    const view = project.view;
    return {
      viewMode,
      ortho: view.ortho,
      grid: toggles.grid,
      gridStep: view.gridStep,
      contours: toggles.contours,
      contourInterval: view.contourInterval,
      contourMajor: view.contourMajor,
      heightScale: project.heightScale,
      seaLevel: project.seaLevel,
      detailStrength: view.detailStrength,
      detailScale: view.detailScale,
      specular: view.specular,
      sunDir,
      sun: {
        color: rgbCss(sun.color),
        skyColor: rgbCss(sun.skyColor),
        ambient: sun.ambient,
        exposure: sun.exposure,
        intensity: sun.intensity,
        fog: sun.fog,
        fogColor: rgbCss(sun.fogColor),
      },
      sky: {
        top: rgbCss(view.sky.top),
        horizon: rgbCss(view.sky.horizon),
        ground: rgbCss(view.sky.ground),
      },
      water: {
        enabled: toggles.water && view.water.enabled,
        level: view.water.level,
        opacity: view.water.opacity,
        ripple: view.water.ripple,
        foam: view.water.foam,
        deepColor: rgbCss(view.water.deepColor),
      },
      brush: {
        pos: [0, 0, 0],
        radius: 0,
        falloff: brush.falloff,
        active: false,
      },
    };
  }, [project, viewMode, toggles, sunDir, brush.falloff]);

  /* -------------------------------------------------------------- draw loop */

  useEffect(() => {
    let frame = 0;
    const loop = (now) => {
      frame = requestAnimationFrame(loop);
      const r = rendererRef.current;
      if (!r) return;
      frameCount.current += 1;
      if (now - lastFpsAt.current > 500) {
        setFps(Math.round((frameCount.current * 1000) / (now - lastFpsAt.current)));
        frameCount.current = 0;
        lastFpsAt.current = now;
      }
      try {
        r.draw({ ...stateRef.current, time: now });
      } catch (e) {
        setError(e.message || 'Render failure.');
        cancelAnimationFrame(frame);
      }
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  /* ------------------------------------------------------------------ resize */

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return undefined;
    const observer = new ResizeObserver(() => r.resize());
    observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [error]);

  /* ------------------------------------------------------------- interaction */

  const toNdc = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1),
    ];
  };

  const setBrushCursor = useCallback((event) => {
    const r = rendererRef.current;
    if (!r) return;
    const [nx, ny] = toNdc(event);
    const hit = r.pick(nx, ny);
    if (!hit) { stateRef.current.brush.active = false; setHover(null); return; }
    const cell = project.worldSize / (project.resolution - 1);
    stateRef.current.brush.pos = hit.world;
    stateRef.current.brush.radius = brush.size * cell * 0.5;
    stateRef.current.brush.active = canPaint;
    setHover(hit);
    return hit;
  }, [project.worldSize, project.resolution, brush.size, canPaint]);

  const onPointerDown = (event) => {
    const r = rendererRef.current;
    if (!r) return;
    canvasRef.current.setPointerCapture(event.pointerId);
    const [nx, ny] = toNdc(event);
    const hit = r.pick(nx, ny);

    const painting = canPaint && event.button === 0 && !event.shiftKey && !event.altKey && hit;
    if (painting) {
      paintRef.current = { last: hit.uv, id: event.pointerId };
      stateRef.current.brush.active = true;
      onStroke('start', hit);
      return;
    }

    dragRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw: r.camera.yaw,
      pitch: r.camera.pitch,
      distance: r.camera.distance,
      target: [...r.camera.target],
      mode: event.button === 1 || event.button === 2 || event.shiftKey || event.altKey ? 'pan' : 'orbit',
    };
  };

  const onPointerMove = (event) => {
    const r = rendererRef.current;
    if (!r) return;

    if (paintRef.current && paintRef.current.id === event.pointerId) {
      const [nx, ny] = toNdc(event);
      const hit = r.pick(nx, ny);
      if (hit) {
        onStroke('move', hit, paintRef.current.last);
        paintRef.current.last = hit.uv;
        stateRef.current.brush.pos = hit.world;
      }
      return;
    }

    const drag = dragRef.current;
    if (drag && drag.id === event.pointerId) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (drag.mode === 'orbit') {
        r.camera.yaw = drag.yaw - dx * 0.0062;
        r.camera.pitch = Math.max(-1.45, Math.min(1.52, drag.pitch + dy * 0.0055));
      } else {
        const scale = r.camera.distance * 0.0016;
        const cy = Math.cos(r.camera.yaw), sy = Math.sin(r.camera.yaw);
        r.camera.target[0] = drag.target[0] - (dx * cy - dy * sy) * scale;
        r.camera.target[2] = drag.target[2] - (dx * sy + dy * cy) * scale;
        r.camera.target[1] = drag.target[1] + dy * scale * 0.35;
      }
      return;
    }

    setBrushCursor(event);
  };

  const endPointer = (event) => {
    if (paintRef.current && paintRef.current.id === event.pointerId) {
      onStroke('end', null);
      paintRef.current = null;
      return;
    }
    if (dragRef.current && dragRef.current.id === event.pointerId) dragRef.current = null;
  };

  const onWheel = (event) => {
    event.preventDefault();
    const r = rendererRef.current;
    if (!r) return;
    const factor = Math.exp(event.deltaY * 0.0011);
    r.camera.distance = Math.max(project.worldSize * 0.06, Math.min(project.worldSize * 6, r.camera.distance * factor));
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const handler = (e) => e.preventDefault();
    canvas.addEventListener('wheel', handler, { passive: false });
    return () => canvas.removeEventListener('wheel', handler);
  }, []);

  const elevation = hover ? Math.round(hover.world[1] ?? 0) : null;
  const legendRamp = VIEW_MODE_LIST.find((m) => m.id === viewMode)?.ramp;

  return (
    <section className="viewport" onContextMenu={(e) => e.preventDefault()}>
      <header className="viewport-top">
        <div className="viewport-title">
          <Camera size={14} />
          <span>Viewport</span>
          <ChevronRight size={13} />
          <span className="crumb-current">{VIEW_MODE_LIST.find((m) => m.id === viewMode)?.name || 'Shaded'}</span>
        </div>

        <div className="segments" role="group" aria-label="View mode">
          {VIEW_MODE_LIST.map((mode) => {
            const Icon = VIEW_ICONS[mode.id] || Sun;
            return (
              <button
                key={mode.id}
                type="button"
                aria-pressed={viewMode === mode.id}
                title={mode.name}
                onClick={() => onViewMode(mode.id)}
              >
                <Icon size={12} style={{ display: 'inline', verticalAlign: -2, marginRight: 5 }} />
                {mode.name}
              </button>
            );
          })}
        </div>

        <div className="viewport-tools">
          <button
            className="tool-toggle" type="button" aria-pressed={!!toggles.grid}
            title="Height grid" onClick={() => onToggle('grid')}
          ><Grid3x3 /></button>
          <button
            className="tool-toggle" type="button" aria-pressed={!!toggles.contours}
            title={`Contour lines every ${project.view.contourInterval} m`} onClick={() => onToggle('contours')}
          ><Waypoints /></button>
          <button
            className="tool-toggle" type="button" aria-pressed={!!toggles.water}
            title="Water plane" onClick={() => onToggle('water')}
          ><Waves /></button>
          <button
            className="tool-toggle" type="button" aria-pressed={!!project.view.ortho}
            title="Orthographic top view" onClick={() => onCameraPreset('top')}
          ><MapPinned /></button>
          <button
            className="tool-toggle" type="button" aria-pressed={false}
            title="Frame the landscape" onClick={() => onCameraPreset('frame')}
          ><Maximize2 /></button>
        </div>
      </header>

      <div className={`canvas-wrap ${canPaint ? 'sculpting' : ''} ${dragRef.current?.mode === 'orbit' ? 'orbiting' : ''}`}>
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onPointerLeave={(e) => { endPointer(e); stateRef.current.brush.active = false; setHover(null); }}
        />

        <Compass yaw={cameraRef.current?.yaw ?? 0.72} />

        <div className="viewport-hud">
          <div className="hud-chip">
            <i className={bakeState.busy ? 'busy' : ''} />
            <b>{bakeState.busy ? bakeState.label || 'Baking…' : 'Ready'}</b>
            {bakeState.busy ? `${Math.round((bakeState.progress || 0) * 100)}%` : `${fps} fps`}
          </div>
          <div className="hud-chip">
            <Move size={11} />
            {project.resolution}² · {(stats.triangles / 1000).toFixed(0)}k tris · {project.worldSize} m
          </div>
          {hover ? (
            <div className="hud-chip">
              <Crosshair size={11} />
              x {hover.uv[0].toFixed(3)} · y {hover.uv[1].toFixed(3)} · <b>{elevation} m</b>
            </div>
          ) : null}
        </div>

        {legendRamp ? (
          <div className="viewport-legend">
            <span>{VIEW_MODE_LIST.find((m) => m.id === viewMode)?.name} ramp</span>
            <div className="legend-ramp" style={{ background: rampGradient(legendRamp) }} />
            <div className="legend-scale">
              <span>{viewMode === 'height' ? '0 m' : viewMode === 'erosion' ? 'cut' : '0'}</span>
              <span>{viewMode === 'height' ? `${project.maxHeight} m` : viewMode === 'erosion' ? 'fill' : '1'}</span>
            </div>
          </div>
        ) : null}

        {bakeState.busy && bakeState.progress < 1 ? (
          <div className="viewport-progress"><i style={{ width: `${Math.max(2, bakeState.progress * 100)}%` }} /></div>
        ) : null}

        {error ? (
          <div className="viewport-empty">
            <div>
              <strong style={{ display: 'block', fontSize: 13, color: '#e0b0ac', marginBottom: 8 }}>{error}</strong>
              This editor needs WebGL 2. Try a current Chrome, Edge, Firefox or Safari build.
            </div>
          </div>
        ) : null}
      </div>

      <div className="brush-bar">
        <span
          className="tool-toggle"
          style={{
            pointerEvents: 'none',
            borderColor: canPaint ? '#5c6b52' : '#333333',
            color: canPaint ? '#cfe0c4' : '#6f6f6f',
            background: canPaint ? '#22281f' : '#1c1c1c',
          }}
          title={canPaint ? `Painting into “${activeBrushLayer?.name}”` : 'Select a Sculpt strokes layer to paint'}
        >
          <Brush />
        </span>

        <label>
          <span>Mode</span>
          <select
            className="frontier-select"
            style={{ width: 108, padding: '6px 8px' }}
            value={brush.mode}
            aria-label="Brush mode"
            onChange={(e) => onBrushChange('mode', e.target.value)}
          >
            {['raise', 'lower', 'smooth', 'flatten', 'plateau', 'noise', 'erase'].map((m) => (
              <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1)}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Size</span>
          <input
            type="range" min={2} max={90} step={1} value={brush.size} aria-label="Brush size"
            onChange={(e) => onBrushChange('size', +e.target.value)}
            style={{ '--progress': `${((brush.size - 2) / 88) * 100}%` }}
          />
          <strong>{brush.size}</strong>
        </label>

        <label>
          <span>Strength</span>
          <input
            type="range" min={0.001} max={1} step={0.001} value={brush.strength} aria-label="Brush strength"
            onChange={(e) => onBrushChange('strength', +e.target.value)}
            style={{ '--progress': `${((brush.strength - 0.001) / 0.999) * 100}%` }}
          />
          <strong>{brush.strength.toFixed(3)}</strong>
        </label>

        <label>
          <span>Falloff</span>
          <input
            type="range" min={0} max={1} step={0.01} value={brush.falloff} aria-label="Brush falloff"
            onChange={(e) => onBrushChange('falloff', +e.target.value)}
            style={{ '--progress': `${brush.falloff * 100}%` }}
          />
          <strong>{brush.falloff.toFixed(2)}</strong>
        </label>

        <span className="brush-hint">
          {canPaint
            ? 'Drag to sculpt · Shift-drag to orbit'
            : 'Select a “Sculpt strokes” layer to paint · Drag to orbit, Shift-drag to pan'}
        </span>
      </div>
    </section>
  );
}
