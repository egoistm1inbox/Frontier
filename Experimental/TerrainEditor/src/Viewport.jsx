import React, { useEffect, useRef, useState } from 'react';
import { Globe, Map, Box, RotateCcw, AlertTriangle } from 'lucide-react';
import { buildImageData, drawToCanvas, mapModes } from './terrain/render2d.js';
import { palettes } from './terrain/satmap.js';
import { colorize } from './terrain/satmap.js';
import { Preview3D } from './terrain/render3d.js';

function Preview3DView({ result, palette, seed }) {
  const canvasRef = useRef(null);
  const p3Ref = useRef(null);
  const camRef = useRef({ az: 55, el: 34, dist: 2.1 });
  const [exag, setExag] = useState(0.12);
  const [failed, setFailed] = useState(false);
  const dragRef = useRef(null);

  useEffect(() => {
    try {
      p3Ref.current = new Preview3D(canvasRef.current);
    } catch {
      setFailed(true);
    }
    return () => { if (p3Ref.current) { p3Ref.current.dispose(); p3Ref.current = null; } };
  }, []);

  useEffect(() => {
    if (!p3Ref.current || !result) return;
    const color = colorize(result, palette, seed);
    p3Ref.current.setData(result.heightN, color, result.size);
    p3Ref.current.setWater(result.waterN);
  }, [result, palette, seed]);

  useEffect(() => {
    let raf = 0;
    let mounted = true;
    const loop = () => {
      if (!mounted) return;
      if (p3Ref.current) {
        p3Ref.current.setExaggeration(exag);
        p3Ref.current.render();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { mounted = false; cancelAnimationFrame(raf); };
  }, [exag]);

  if (failed) return <div className="vp-empty">3D preview unavailable — WebGL is disabled in this browser.</div>;

  return (
    <div className="viewport-3d">
      <canvas
        ref={canvasRef}
        className="viewport-canvas"
        onPointerDown={(e) => {
          dragRef.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!dragRef.current) return;
          const dx = e.clientX - dragRef.current.x, dy = e.clientY - dragRef.current.y;
          dragRef.current = { x: e.clientX, y: e.clientY };
          const cam = camRef.current;
          cam.az = (cam.az + dx * 0.45) % 360;
          cam.el = Math.min(86, Math.max(6, cam.el - dy * 0.3));
          if (p3Ref.current) p3Ref.current.setCamera(cam);
        }}
        onPointerUp={() => { dragRef.current = null; }}
        onWheel={(e) => {
          const cam = camRef.current;
          cam.dist = Math.min(4.5, Math.max(1.1, cam.dist * Math.pow(1.0015, e.deltaY)));
          if (p3Ref.current) p3Ref.current.setCamera(cam);
        }}
      />
      <div className="vp-3d-controls">
        <label>
          <span>Relief</span>
          <input type="range" min={0.03} max={0.32} step={0.01} value={exag}
            onChange={(e) => setExag(+e.target.value)} style={{ '--progress': `${((exag - 0.03) / 0.29) * 100}%` }} />
        </label>
        <button onClick={() => { camRef.current = { az: 55, el: 34, dist: 2.1 }; if (p3Ref.current) p3Ref.current.setCamera(camRef.current); }}>
          <RotateCcw size={12} /> Reset view
        </button>
        <span className="vp-hint">drag to orbit · scroll to zoom</span>
      </div>
    </div>
  );
}

function Viewport({ result, status, view, terrain, presets, onView, onTerrain, onPreset, onReroll }) {
  const canvasRef = useRef(null);
  const waterMax = result ? Math.max(1, Math.ceil(result.max)) : 1500;

  useEffect(() => {
    if (view.preview3d || !result || !canvasRef.current) return;
    const rgba = buildImageData(view.mode, result, view.palette, terrain.seed);
    drawToCanvas(canvasRef.current, rgba, result.size);
  }, [result, view.mode, view.palette, view.preview3d, terrain.seed]);

  return (
    <section className="viewport">
      <header className="viewport-top">
        <div className="vp-brand"><Globe size={14} /><span>Viewport</span><span className="vp-chip">{result ? `${result.size}²` : '—'}</span></div>
        <label className="vp-field">
          <span>Preset</span>
          <select value="" onChange={(e) => { if (e.target.value) onPreset(e.target.value); }}>
            <option value="">Load preset…</option>
            {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label className="vp-field">
          <span>Map</span>
          <select value={view.mode} onChange={(e) => onView({ ...view, mode: e.target.value })}>
            {mapModes.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <label className="vp-field">
          <span>Palette</span>
          <select value={view.palette} onChange={(e) => onView({ ...view, palette: e.target.value })}>
            {palettes.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <div className="vp-seg" role="group" aria-label="Preview mode">
          <button className={!view.preview3d ? 'on' : ''} title="2D map" onClick={() => onView({ ...view, preview3d: false })}><Map size={14} /></button>
          <button className={view.preview3d ? 'on' : ''} title="3D preview" onClick={() => onView({ ...view, preview3d: true })}><Box size={14} /></button>
        </div>
        <button className="vp-button" onClick={onReroll} title="New random seed"><RotateCcw size={14} /><span>New seed</span></button>
        <label className="vp-water">
          <span>Sea level</span>
          <input type="range" min={0} max={waterMax} step={1} value={Math.min(terrain.waterLevel, waterMax)}
            onChange={(e) => onTerrain({ ...terrain, waterLevel: +e.target.value })}
            style={{ '--progress': `${(Math.min(terrain.waterLevel, waterMax) / waterMax) * 100}%` }} />
          <span className="vp-water-val">{terrain.waterLevel} m</span>
        </label>
      </header>

      <div className="viewport-stage">
        {view.preview3d
          ? <Preview3DView result={result} palette={view.palette} seed={terrain.seed} />
          : <canvas ref={canvasRef} className="viewport-canvas" />}
        {!result && status.phase !== 'computing' && (
          <div className="vp-empty"><Globe size={28} strokeWidth={1} /><p>Building terrain…</p></div>
        )}
        {status.phase === 'computing' && (
          <div className="vp-progress">
            <i style={{ '--w': `${Math.round(status.progress * 100)}%` }} />
            <span>Simulating{status.layerName ? ` · ${status.layerName}` : '…'} {Math.round(status.progress * 100)}%</span>
          </div>
        )}
        {status.phase === 'error' && (
          <div className="vp-error"><AlertTriangle size={14} /><span>{status.message}</span></div>
        )}
      </div>
    </section>
  );
}

export default Viewport;
