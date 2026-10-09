import React, { useState, useEffect, useRef, useCallback } from 'react';
import LayerStack from './LayerStack.jsx';
import Viewport from './Viewport.jsx';
import Inspector from './Inspector.jsx';
import { shapeLayer, erosionLayer, uid } from './terrain/pipeline.js';
import { presets, presetById } from './terrain/presets.js';

const STORE_KEY = 'frontier-terrain-project';

export const defaultLayers = () => [
  shapeLayer('Base shape', 'multifractal', { amplitude: 700, scale: 7, octaves: 5, gain: 0.7, offset: 0.35 }),
  erosionLayer('Rainfall erosion', 'hydraulic', { droplets: 60000, lifetime: 30, radius: 3 }),
  shapeLayer('Strata detail', 'strata', { amplitude: 180, scale: 8, layers: 16, width: 0.6, warp: 2 }, 'stratify', { layers: 12, width: 0.55, warp: 1.2 }, 'add', 0.6),
];

const defaultTerrain = { size: 256, seed: 1337, waterLevel: 90 };
const defaultView = { mode: 'satmap', palette: 'temperate', preview3d: false };

function readProject() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    if (stored.version === 1 && Array.isArray(stored.layers) && stored.layers.length) {
      return {
        layers: stored.layers,
        terrain: { ...defaultTerrain, ...(stored.terrain || {}) },
        view: { ...defaultView, ...(stored.view || {}) },
      };
    }
  } catch { /* corrupt storage — start fresh */ }
  return null;
}

function App() {
  const stored = useRef(readProject());
  const [layers, setLayers] = useState(() => stored.current ? stored.current.layers : defaultLayers());
  const [terrain, setTerrain] = useState(() => stored.current ? stored.current.terrain : { ...defaultTerrain });
  const [view, setView] = useState(() => stored.current ? stored.current.view : { ...defaultView });
  const [selectedId, setSelectedId] = useState('terrain');
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState({ phase: 'idle', progress: 0, layerName: '', message: '' });
  const [saved, setSaved] = useState(!!stored.current);

  const workerRef = useRef(null);
  const runIdRef = useRef(0);
  const timerRef = useRef(null);
  const firstRender = useRef(true);

  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      const worker = new Worker(new URL('./terrain/worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const msg = e.data || {};
        if (msg.runId !== runIdRef.current) return; // stale run
        if (msg.type === 'progress') {
          setStatus({ phase: 'computing', progress: msg.progress, layerName: msg.layerName || '', message: '' });
        } else if (msg.type === 'done') {
          setResult(msg.result);
          setStatus({ phase: 'idle', progress: 1, layerName: '', message: '' });
        } else if (msg.type === 'error') {
          setStatus({ phase: 'error', progress: 0, layerName: '', message: msg.message || 'Computation failed' });
        }
      };
      workerRef.current = worker;
    }
    return workerRef.current;
  }, []);

  const scheduleCompute = useCallback((nextLayers, nextTerrain) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const runId = ++runIdRef.current;
      setStatus({ phase: 'computing', progress: 0, layerName: '', message: '' });
      getWorker().postMessage({ type: 'compute', runId, layers: nextLayers, terrain: nextTerrain });
    }, 350);
  }, [getWorker]);

  // Recompute whenever the stack or terrain settings change.
  useEffect(() => {
    scheduleCompute(layers, terrain);
  }, [layers, terrain, scheduleCompute]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (workerRef.current) workerRef.current.terminate();
  }, []);

  // Track unsaved changes.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    setSaved(false);
  }, [layers, terrain, view]);

  const save = useCallback(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, layers, terrain, view }));
      setSaved(true);
    } catch {
      setSaved(false);
      window.alert('Unable to save locally. Free browser storage, then try again.');
    }
  }, [layers, terrain, view]);

  // ------------------------------------------------------------- layer ops
  const patchLayer = useCallback((id, patch) => {
    setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  const patchLayerGroup = useCallback((id, group, patch) => {
    setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, [group]: { ...l[group], ...patch } } : l)));
  }, []);

  const addLayer = useCallback((kind) => {
    setLayers((ls) => {
      const n = ls.filter((l) => l.kind === kind).length + 1;
      const layer = kind === 'shape'
        ? shapeLayer(`Shape layer ${n}`, 'perlin', { amplitude: 300, scale: 8 })
        : erosionLayer(`Erosion layer ${n}`, 'hydraulic', { droplets: 40000 });
      setSelectedId(layer.id);
      return [...ls, layer];
    });
  }, []);

  const duplicateLayer = useCallback((id) => {
    setLayers((ls) => {
      const index = ls.findIndex((l) => l.id === id);
      if (index < 0) return ls;
      const copy = { ...JSON.parse(JSON.stringify(ls[index])), id: uid('copy'), name: ls[index].name + ' copy' };
      setSelectedId(copy.id);
      return [...ls.slice(0, index + 1), copy, ...ls.slice(index + 1)];
    });
  }, []);

  const deleteLayer = useCallback((id) => {
    setLayers((ls) => {
      const next = ls.filter((l) => l.id !== id);
      if (selectedId === id) setSelectedId(next.length ? next[Math.max(0, next.length - 1)].id : 'terrain');
      return next;
    });
  }, [selectedId]);

  const moveLayer = useCallback((id, dir) => {
    setLayers((ls) => {
      const index = ls.findIndex((l) => l.id === id);
      const target = index + dir;
      if (index < 0 || target < 0 || target >= ls.length) return ls;
      const next = [...ls];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const resetStack = useCallback(() => {
    setLayers(defaultLayers());
    setTerrain({ ...defaultTerrain, seed: 1000 + Math.floor(Math.random() * 9000) });
    setSelectedId('terrain');
  }, []);

  const applyPreset = useCallback((presetId) => {
    const preset = presetById(presetId);
    if (!preset) return;
    setLayers(preset.layers());
    setTerrain({ ...preset.terrain });
    setView((v) => ({ ...v, palette: preset.palette, mode: 'satmap' }));
    setSelectedId('terrain');
  }, []);

  const rerollSeed = useCallback(() => {
    setTerrain((t) => ({ ...t, seed: 1000 + Math.floor(Math.random() * 9000) }));
  }, []);

  const importProject = useCallback((project) => {
    if (!project || !Array.isArray(project.layers) || !project.layers.length) return;
    setLayers(project.layers);
    if (project.terrain) setTerrain((t) => ({ ...t, ...project.terrain }));
    if (project.view) setView((v) => ({ ...v, ...project.view }));
    setSelectedId('terrain');
  }, []);

  const selection = selectedId === 'terrain' ? 'terrain' : (layers.find((l) => l.id === selectedId) || 'terrain');

  return (
    <main className="shell">
      <LayerStack
        layers={layers}
        selectedId={selection === 'terrain' ? 'terrain' : selection.id}
        terrain={terrain}
        onSelect={setSelectedId}
        onToggle={(id) => {
          const layer = layers.find((l) => l.id === id);
          if (layer) patchLayer(id, { enabled: !layer.enabled });
        }}
        onAdd={addLayer}
        onMove={moveLayer}
        onDuplicate={duplicateLayer}
        onDelete={deleteLayer}
      />
      <Viewport
        result={result}
        status={status}
        view={view}
        terrain={terrain}
        presets={presets}
        onView={setView}
        onTerrain={setTerrain}
        onPreset={applyPreset}
        onReroll={rerollSeed}
      />
      <Inspector
        selection={selection}
        layers={layers}
        terrain={terrain}
        view={view}
        result={result}
        saved={saved}
        onSave={save}
        onUpdateLayer={patchLayer}
        onUpdateGroup={patchLayerGroup}
        onAdd={addLayer}
        onResetStack={resetStack}
        onTerrain={setTerrain}
        onView={setView}
        onImport={importProject}
      />
    </main>
  );
}

export default App;
