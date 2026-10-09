// Terrain workspace: a layer stack for the heightfield, a second stack for the texture, a viewport,
// and an inspector. The document is plain JSON; evaluation runs in terrain/worker.js.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Layers, Undo2, Redo2, RefreshCw, Maximize2, Download, Globe } from 'lucide-react';
import './style.css';
import './terrain.css';
import { PRESETS, buildPreset } from './terrain/presets.js';
import { makeTerrainLayer, makeMask, newId } from './terrain/stack.js';
import { makeTextureLayer } from './terrain/texturing.js';
import { normalizeDoc } from './terrain/document.js';
import { TERRAIN_TYPES } from './terrain/catalog-terrain.js';
import { TEXTURE_TYPES } from './terrain/catalog-texture.js';
import { MASK_TYPES } from './terrain/catalog-mask.js';
import { TerrainView } from './terrain/view.js';
import { encodeGray16, encodeRGBA8 } from './terrain/png.js';
import { NO_WATER } from './terrain/routing.js';
import { StackList, Picker, LayerPanel, MaskPanel, WorldPanel, SaveBadge } from './terrain/ui.jsx';

const STORE_KEY = 'frontier-terrain-v1';
const VIEW_KEY = 'frontier-terrain-view';
const VIEW_MODES = [
  ['shaded', 'Shaded'], ['height', 'Height'], ['slope', 'Slope'], ['hardness', 'Hardness'], ['sediment', 'Sediment'], ['water', 'Water'],
];
const HISTORY_LIMIT = 100;
const GROUP_MS = 900; // slider drags within this window share one undo step

function loadDoc() {
  try {
    const d = normalizeDoc(JSON.parse(localStorage.getItem(STORE_KEY) || 'null'));
    if (d) return d;
  } catch { /* unreadable storage: start from the default preset */ }
  return { ...buildPreset('alpine'), preset: 'alpine' };
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function computeStats(msg) {
  const { height: h, water: w, lakeMask, seaMask, riverMask } = msg.fields;
  const n = h.length;
  let lo = Infinity, hi = -Infinity, wet = 0, lakes = 0, sea = 0, rivers = 0;
  for (let c = 0; c < n; c++) {
    const hc = h[c];
    if (hc < lo) lo = hc;
    if (hc > hi) hi = hc;
    if (w[c] > NO_WATER / 2 && w[c] > hc + 0.02) wet++;
    if (lakeMask[c] > 0.5) lakes++;
    if (seaMask[c] > 0.5) sea++;
    if (riverMask[c] > 0.5) rivers++;
  }
  return { lo, hi, wetPct: (100 * wet) / n, lakes, sea, rivers, seaLevel: msg.sea };
}

const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);

function App() {
  const [doc, setDoc] = useState(loadDoc);
  const docRef = useRef(doc);
  const hist = useRef({ past: [], future: [], group: null, at: 0 });
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [sel, setSel] = useState({ stack: 'terrain', id: null, mask: null });
  const [picker, setPicker] = useState(null);
  const [viewMode, setViewMode] = useState(() => {
    const m = localStorage.getItem(VIEW_KEY);
    return VIEW_MODES.some(([id]) => id === m) ? m : 'shaded';
  });
  const [exportOpen, setExportOpen] = useState(false);
  const [progress, setProgress] = useState(null);
  const [terrainInfo, setTerrainInfo] = useState(null);
  const [textureInfo, setTextureInfo] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const workerRef = useRef(null);
  const fieldsRef = useRef(null);
  const albedoRef = useRef(null);
  const framedSize = useRef(null);
  // One job of each kind in flight. Requests that arrive meanwhile set `pending`, and the latest
  // document is sent when the current job finishes, so results never lag more than one job behind.
  const jobs = useRef({
    terrain: { busy: false, pending: false, fresh: false, id: 0 },
    texture: { busy: false, pending: false, id: 0 },
  });

  // ---- document and history -------------------------------------------------------------------
  const syncHistory = () => {
    const h = hist.current;
    setHistory({ canUndo: h.past.length > 0, canRedo: h.future.length > 0 });
  };

  const commit = (next, group = null) => {
    const h = hist.current;
    const now = Date.now();
    const coalesce = group && h.group === group && now - h.at < GROUP_MS;
    if (!coalesce) h.past = [...h.past.slice(-(HISTORY_LIMIT - 1)), docRef.current];
    h.future = [];
    h.group = group;
    h.at = now;
    docRef.current = next;
    setDoc(next);
    syncHistory();
  };

  const undo = () => {
    const h = hist.current;
    if (!h.past.length) return;
    const prev = h.past[h.past.length - 1];
    h.past = h.past.slice(0, -1);
    h.future = [docRef.current, ...h.future].slice(0, HISTORY_LIMIT);
    h.group = null;
    docRef.current = prev;
    setDoc(prev);
    syncHistory();
  };

  const redo = () => {
    const h = hist.current;
    if (!h.future.length) return;
    const next = h.future[0];
    h.future = h.future.slice(1);
    h.past = [...h.past, docRef.current];
    h.group = null;
    docRef.current = next;
    setDoc(next);
    syncHistory();
  };

  const mutateList = (kind, id, fn, group = null) => {
    const d = docRef.current;
    const list = d[kind];
    const i = list.findIndex((l) => l.id === id);
    if (i < 0) return;
    const next = list.slice();
    next[i] = fn(list[i]);
    commit({ ...d, [kind]: next }, group);
  };

  const mutateMask = (kind, layerId, maskId, fn, group = null) => {
    mutateList(kind, layerId, (layer) => ({ ...layer, masks: layer.masks.map((m) => (m.id === maskId ? fn(m) : m)) }), group);
  };

  const addLayer = (kind, type) => {
    const d = docRef.current;
    const layer = kind === 'terrain' ? makeTerrainLayer(type) : makeTextureLayer(type);
    commit({ ...d, [kind]: [...d[kind], layer] });
    setSel({ stack: kind, id: layer.id, mask: null });
    setPicker(null);
  };

  const act = {
    selectLayer: (kind, id) => setSel({ stack: kind, id, mask: null }),
    selectMask: (kind, id, mask) => setSel({ stack: kind, id, mask }),
    toggleLayer: (kind, id) => mutateList(kind, id, (l) => ({ ...l, enabled: !l.enabled })),
    patchLayer: (kind, id, patch, group) => mutateList(kind, id, (l) => ({ ...l, ...patch }), group),
    patchParam: (kind, id, key, value, group) => mutateList(kind, id, (l) => ({ ...l, params: { ...l.params, [key]: value } }), group),
    moveLayer: (kind, id, dir) => {
      const d = docRef.current;
      const list = d[kind].slice();
      const i = list.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      commit({ ...d, [kind]: list });
    },
    duplicateLayer: (kind, id) => {
      const d = docRef.current;
      const list = d[kind];
      const i = list.findIndex((l) => l.id === id);
      if (i < 0) return;
      const src = list[i];
      const copy = {
        ...src,
        id: newId(kind === 'terrain' ? 't' : 'x'),
        params: { ...src.params },
        masks: src.masks.map((m) => ({ ...m, id: newId('m'), params: { ...m.params } })),
      };
      commit({ ...d, [kind]: [...list.slice(0, i + 1), copy, ...list.slice(i + 1)] });
      setSel({ stack: kind, id: copy.id, mask: null });
    },
    removeLayer: (kind, id) => {
      const d = docRef.current;
      commit({ ...d, [kind]: d[kind].filter((l) => l.id !== id) });
      setSel({ stack: kind, id: null, mask: null });
    },
    addMask: (kind, layerId, type) => {
      const mask = makeMask(type, 'multiply');
      mutateList(kind, layerId, (l) => ({ ...l, masks: [...l.masks, mask] }));
      setSel({ stack: kind, id: layerId, mask: mask.id });
    },
    removeMask: (kind, layerId, maskId) => {
      mutateList(kind, layerId, (l) => ({ ...l, masks: l.masks.filter((m) => m.id !== maskId) }));
      setSel({ stack: kind, id: layerId, mask: null });
    },
    toggleMask: (kind, layerId, maskId) => mutateMask(kind, layerId, maskId, (m) => ({ ...m, enabled: !m.enabled })),
    patchMask: (kind, layerId, maskId, patch, group) => mutateMask(kind, layerId, maskId, (m) => ({ ...m, ...patch }), group),
    patchMaskParam: (kind, layerId, maskId, key, value, group) =>
      mutateMask(kind, layerId, maskId, (m) => ({ ...m, params: { ...m.params, [key]: value } }), group),
    setWorld: (patch, group) => {
      const d = docRef.current;
      commit({ ...d, world: { ...d.world, ...patch } }, group);
    },
    loadPreset: (id) => {
      commit({ ...buildPreset(id), preset: id });
      setSel({ stack: 'world', id: null, mask: null });
    },
  };

  // ---- evaluation jobs ------------------------------------------------------------------------
  const runTerrain = (fresh = false) => {
    const j = jobs.current.terrain;
    if (j.busy) { j.pending = true; j.fresh = j.fresh || fresh; return; }
    const d = docRef.current;
    const useFresh = fresh || j.fresh;
    j.busy = true; j.pending = false; j.fresh = false; j.id += 1;
    setProgress({ kind: 'terrain', index: -1, count: d.terrain.length, label: '' });
    workerRef.current?.postMessage({ type: 'terrain', id: j.id, world: d.world, layers: d.terrain, fresh: useFresh });
  };

  const runTexture = () => {
    const j = jobs.current.texture;
    if (j.busy) { j.pending = true; return; }
    j.busy = true; j.pending = false; j.id += 1;
    workerRef.current?.postMessage({ type: 'texture', id: j.id, layers: docRef.current.texturing });
  };

  const onWorker = (msg) => {
    const J = jobs.current;
    if (msg.type === 'progress') {
      const job = J[msg.stage === 'texture' ? 'texture' : 'terrain'];
      if (job.id === msg.id) setProgress({ kind: msg.stage, index: msg.index, count: msg.count, label: msg.label });
      return;
    }
    if (msg.type === 'terrain-done') {
      J.terrain.busy = false;
      fieldsRef.current = { ...msg.fields, N: msg.N, size: msg.size, sea: msg.sea };
      const view = viewRef.current;
      if (view) {
        view.setTerrain({ N: msg.N, size: msg.size, ...msg.fields });
        if (framedSize.current !== msg.size) { framedSize.current = msg.size; view.frame(); }
      }
      setStats(computeStats(msg));
      setTerrainInfo({ ms: msg.ms, reused: msg.reused, count: msg.count, timings: msg.timings });
      setError(null);
      if (J.terrain.pending) runTerrain(false);
      runTexture();
      if (!J.terrain.busy && !J.texture.busy) setProgress(null);
      return;
    }
    if (msg.type === 'texture-done') {
      J.texture.busy = false;
      if (!msg.skipped) {
        albedoRef.current = { N: msg.N, rgba: msg.rgba };
        viewRef.current?.setAlbedo({ N: msg.N, rgba: msg.rgba, rough: msg.rough });
        setTextureInfo({ ms: msg.ms, timings: msg.timings, count: msg.count });
      }
      if (J.texture.pending) runTexture();
      if (!J.terrain.busy && !J.texture.busy) setProgress(null);
      return;
    }
    if (msg.type === 'error') {
      if (msg.id === J.terrain.id) { J.terrain.busy = false; J.terrain.pending = false; }
      if (msg.id === J.texture.id) { J.texture.busy = false; J.texture.pending = false; }
      setProgress(null);
      setError(msg.message);
    }
  };

  // Effects run in declaration order: the worker and viewport exist before the first job is posted.
  useEffect(() => {
    const worker = new Worker(new URL('./terrain/worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => onWorker(e.data);
    workerRef.current = worker;
    const view = new TerrainView(hostRef.current);
    view.setMode(viewMode);
    viewRef.current = view;
    // development only: lets the browser checks drive the camera
    if (import.meta.env.DEV) window.__terrainView = view;
    return () => {
      worker.terminate();
      view.dispose();
      workerRef.current = null;
      viewRef.current = null;
      if (import.meta.env.DEV) delete window.__terrainView;
    };
  }, []);

  const terrainKey = useMemo(() => JSON.stringify([doc.world, doc.terrain]), [doc.world, doc.terrain]);
  const textureKey = useMemo(() => JSON.stringify(doc.texturing), [doc.texturing]);
  useEffect(() => { runTerrain(false); }, [terrainKey]);
  useEffect(() => { runTexture(); }, [textureKey]);

  // ---- persistence, keyboard, view ------------------------------------------------------------
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(doc));
        setSavedAt(Date.now());
      } catch {
        setSavedAt(null);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [doc]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select')) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const changeMode = (mode) => {
    setViewMode(mode);
    localStorage.setItem(VIEW_KEY, mode);
    viewRef.current?.setMode(mode);
  };

  const exportFile = async (what) => {
    const d = docRef.current;
    const base = d.preset || 'terrain';
    if (what === 'stack') {
      const json = JSON.stringify({ format: 'frontier-terrain', ...d }, null, 2);
      download(new Blob([json], { type: 'application/json' }), `${base}.terrain.json`);
      return;
    }
    if (what === 'heightmap') {
      const f = fieldsRef.current;
      if (!f) return;
      const { N, height } = f;
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < height.length; i++) { if (height[i] < lo) lo = height[i]; if (height[i] > hi) hi = height[i]; }
      const span = Math.max(1e-6, hi - lo);
      const samples = new Uint16Array(N * N);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.round(((height[i] - lo) / span) * 65535);
      const bytes = await encodeGray16(N, N, samples);
      download(new Blob([bytes], { type: 'image/png' }), `${base}-${N}px-16bit-${Math.round(lo)}-${Math.round(hi)}m.png`);
      return;
    }
    if (what === 'albedo') {
      const a = albedoRef.current;
      if (!a) return;
      const bytes = await encodeRGBA8(a.N, a.N, a.rgba);
      download(new Blob([bytes], { type: 'image/png' }), `${base}-${a.N}px-albedo.png`);
    }
  };

  // ---- derived view state ---------------------------------------------------------------------
  const selKind = sel.stack === 'terrain' || sel.stack === 'texturing' ? sel.stack : null;
  const selLayer = selKind ? doc[selKind].find((l) => l.id === sel.id) || null : null;
  const selMask = selLayer && sel.mask ? selLayer.masks.find((m) => m.id === sel.mask) || null : null;
  const selIndex = selLayer ? doc[selKind].indexOf(selLayer) : -1;
  const presetName = (PRESETS.find((p) => p.id === doc.preset) || { name: 'Custom terrain' }).name;
  const w = doc.world;
  const cell = w.size / (w.resolution - 1);

  const timingFor = (kind, layer, index) => {
    const info = kind === 'terrain' ? terrainInfo : textureInfo;
    if (!layer.enabled) return 'Disabled, so it is skipped.';
    if (!info) return 'Not evaluated yet.';
    const hit = info.timings.find((t) => t.id === layer.id);
    if (hit) return `Last run ${fmtMs(hit.ms)}.`;
    if (kind === 'terrain' && index < info.reused) return 'Reused from the cache; nothing below it changed.';
    return 'Evaluated with the stack.';
  };

  let progressText = null;
  if (progress) {
    const defs = progress.kind === 'terrain' ? TERRAIN_TYPES : TEXTURE_TYPES;
    const name = defs[progress.label] ? defs[progress.label].name : progress.label;
    const verb = progress.kind === 'terrain' ? 'Evaluating' : 'Painting';
    progressText = progress.index < 0 ? `${verb} · starting` : `${verb} · ${name} (${progress.index + 1}/${progress.count})`;
  }
  const progressPct = progress && progress.index >= 0 ? ((progress.index + 1) / progress.count) * 100 : 0;
  const idleText = terrainInfo
    ? `Terrain ${fmtMs(terrainInfo.ms)} · ${Math.min(terrainInfo.reused, terrainInfo.count)} of ${terrainInfo.count} layers reused`
    : 'Waiting for the first evaluation';
  const texText = textureInfo ? ` · texture ${fmtMs(textureInfo.ms)}` : '';

  const crumbs = selLayer
    ? [
      selKind === 'terrain' ? 'Terrain stack' : 'Texturing stack',
      (selKind === 'terrain' ? TERRAIN_TYPES : TEXTURE_TYPES)[selLayer.type]?.name || selLayer.type,
      ...(selMask ? [MASK_TYPES[selMask.type]?.name || selMask.type] : []),
    ]
    : ['World'];

  return (
    <main className="shell terrain-shell">
      <aside className="outliner terrain-outliner">
        <div className="brand">
          <div className="brand-symbol"><Layers size={24} strokeWidth={1.5} /></div>
          <span>frontier<span className="brand-dot">.</span></span>
          <span className="version">TERRAIN / 01</span>
        </div>
        <div className="scene-label">WORKSPACE <span className="status-dot" /></div>
        <div className="scene-title"><span>{presetName}</span><span className="scene-extension">.terrain</span></div>
        <StackList kind="terrain" title="Terrain stack" layers={doc.terrain} sel={sel} act={act} onAdd={setPicker} />
        <StackList kind="texturing" title="Texturing stack" layers={doc.texturing} sel={sel} act={act} onAdd={setPicker} />
        <button className={`outliner-bottom world-row ${sel.stack === 'world' || !selLayer ? 'selected' : ''}`} onClick={() => setSel({ stack: 'world', id: null, mask: null })}>
          <span className="world-icon"><Globe size={17} /></span>
          <span className="world-text">
            <strong>World</strong>
            <span>{w.size} m · {w.resolution} × {w.resolution}</span>
          </span>
          <span className="little-dot" />
        </button>
      </aside>

      <section className="terrain-viewport">
        <div className="viewport-canvas" ref={hostRef} />
        <div className="viewport-bar top">
          <div className="segmented view-modes" role="group" aria-label="View mode">
            {VIEW_MODES.map(([id, label]) => (
              <button key={id} className={viewMode === id ? 'on' : ''} onClick={() => changeMode(id)}>{label}</button>
            ))}
          </div>
          <div className="viewport-tools">
            <button className="tool-button icon" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!history.canUndo} onClick={undo}><Undo2 size={15} /></button>
            <button className="tool-button icon" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!history.canRedo} onClick={redo}><Redo2 size={15} /></button>
            <button className="tool-button" title="Re-run every layer from scratch" onClick={() => runTerrain(true)}><RefreshCw size={14} />Regenerate</button>
            <button className="tool-button" onClick={() => viewRef.current?.frame()}><Maximize2 size={14} />Frame</button>
            <div className="menu-anchor">
              <button className="tool-button" aria-expanded={exportOpen} onClick={() => setExportOpen((o) => !o)}><Download size={14} />Export</button>
              {exportOpen && (
                <div className="menu" onMouseLeave={() => setExportOpen(false)}>
                  <button onClick={() => { setExportOpen(false); exportFile('heightmap'); }}>Heightmap · 16-bit PNG</button>
                  <button onClick={() => { setExportOpen(false); exportFile('albedo'); }}>Albedo · PNG</button>
                  <button onClick={() => { setExportOpen(false); exportFile('stack'); }}>Stacks · JSON</button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="viewport-bar bottom">
          <div className="chips">
            <span className="chip">{w.resolution} × {w.resolution}</span>
            <span className="chip">{w.size} m · {cell.toFixed(1)} m / cell</span>
            {stats && <span className="chip">{stats.lo.toFixed(0)} – {stats.hi.toFixed(0)} m</span>}
            {stats && <span className="chip">Water {stats.wetPct.toFixed(1)} %</span>}
            {stats && <span className="chip">Lakes {stats.lakes.toLocaleString()}</span>}
            {stats && stats.sea > 0 && <span className="chip">Sea {stats.sea.toLocaleString()}</span>}
          </div>
          <div className="status-box">
            {progressText ? (
              <>
                <span>{progressText}</span>
                <div className="progress"><span style={{ width: `${progressPct}%` }} /></div>
              </>
            ) : (
              <span>{idleText}{texText}</span>
            )}
          </div>
        </div>
        {error && <pre className="viewport-error">{error}</pre>}
      </section>

      <section className="inspector terrain-inspector">
        <header className="inspector-top">
          <div className="crumbs">
            <span>Inspector</span>
            {crumbs.map((c, i) => (
              <React.Fragment key={`${c}-${i}`}>
                <span>›</span>
                <span className={i === crumbs.length - 1 ? 'current' : ''}>{c}</span>
              </React.Fragment>
            ))}
          </div>
          <SaveBadge savedAt={savedAt} />
        </header>
        <div className="inspector-content">
          {selLayer && selMask ? (
            <MaskPanel kind={selKind} layer={selLayer} mask={selMask} act={act} onBack={() => setSel({ stack: selKind, id: selLayer.id, mask: null })} />
          ) : selLayer ? (
            <LayerPanel
              kind={selKind}
              layer={selLayer}
              index={selIndex}
              total={doc[selKind].length}
              timing={timingFor(selKind, selLayer, selIndex)}
              act={act}
              onOpenMask={(maskId) => setSel({ stack: selKind, id: selLayer.id, mask: maskId })}
            />
          ) : (
            <WorldPanel doc={doc} stats={stats} presets={PRESETS} presetId={doc.preset} act={act} onExport={exportFile} />
          )}
        </div>
      </section>

      {picker && (
        <Picker kind={picker} onPick={(type) => addLayer(picker, type)} onClose={() => setPicker(null)} />
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
