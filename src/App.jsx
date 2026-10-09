/**
 * Frontier Landscape Studio — application shell.
 *
 * Owns the project document, drives the bake worker, routes selection between
 * the three columns and handles live sculpting against the pre-brush snapshot
 * so painting never waits for a full re-bake.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PipelineWorker from './core/pipeline.worker.js?worker';

import LayerStack from './ui/LayerStack.jsx';
import Viewport from './ui/Viewport.jsx';
import Inspector, {
  ShapeLayerInspector, SplatInspector, SatmapInspector, LandscapeInspector,
} from './ui/Inspector.jsx';

import './styles/frontier.css';
import './styles/landscape.css';

import {
  defaultProject, loadProject, saveProject, serializeProject, moveLayer,
  RESOLUTIONS,
} from './core/project.js';
import {
  createLayer, layerType, typeDefaults, defaultLayers, erosionLayerParams,
  setErosionParam, LAYER_LIBRARY,
} from './core/layers.js';
import {
  createSplatLayer, createSatmapLayer, material, splatDefaults, defaultTextureLayers,
} from './core/textures.js';
import { emptyDelta, resampleField, dab as applyDab, stroke as applyStroke } from './core/brush.js';
import {
  exportHeightmapPng, exportHeightmapR16, exportNormalMapPng, exportAlbedoPng,
  exportObj, exportProjectJson, importHeightmap, importSatmap,
} from './core/exporters.js';
import { clamp01 } from './core/noise.js';

const LANDSCAPE_ID = 'landscape';

export default function App() {
  const [project, setProject] = useState(() => loadProject());
  const [selection, setSelection] = useState({ kind: 'landscape', id: LANDSCAPE_ID });
  const [saved, setSaved] = useState(true);
  const [bake, setBake] = useState(null);
  const [bakeState, setBakeState] = useState({ busy: true, progress: 0, label: 'Starting', phase: 'layer' });
  const [viewMode, setViewMode] = useState('shaded');
  const [toggles, setToggles] = useState({ grid: false, contours: false, water: true });
  const [query, setQuery] = useState('');
  const [bakeToken, setBakeToken] = useState(0);
  const [draggingImage, setDraggingImage] = useState(false);

  const workerRef = useRef(null);
  const requestIdRef = useRef(0);
  const brushFields = useRef(new Map());
  const captures = useRef(new Map());
  const importedField = useRef(null);
  const cameraRef = useRef({ yaw: 0.72, pitch: 0.62, distance: 2600, target: [0, 0, 0], fov: 46 });
  const viewportApi = useRef(null);
  const projectRef = useRef(project);
  const paintingRef = useRef(false);
  projectRef.current = project;

  /* ------------------------------------------------------------ worker setup */

  useEffect(() => {
    const worker = new PipelineWorker();
    workerRef.current = worker;
    worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === 'progress') {
        setBakeState({ busy: true, progress: message.fraction, label: message.label, phase: message.phase });
        return;
      }
      if (message.type === 'error') {
        setBakeState({ busy: false, progress: 1, label: message.message, phase: 'error', error: message.message });
        return;
      }
      if (message.type !== 'done') return;
      setBake(finalizeBake(message));
      const newCaptures = {};
      for (const [id, buffer] of Object.entries(message.captures || {})) {
        newCaptures[id] = new Float32Array(buffer);
      }
      captures.current = new Map(Object.entries(newCaptures));
      setBakeState({ busy: false, progress: 1, label: 'Ready', phase: 'done' });
    };
    worker.onerror = (error) => {
      setBakeState({ busy: false, progress: 1, label: 'Worker failed', phase: 'error', error: error.message });
    };
    return () => { worker.terminate(); workerRef.current = null; };
  }, []);

  /** Turn transferred buffers into the typed arrays the renderer expects. */
  function finalizeBake(message) {
    const res = message.resolution;
    const n = res * res;
    const height = new Float32Array(message.height);
    const eroded = new Float32Array(message.eroded);
    const deposited = new Float32Array(message.deposited);
    const flow = new Float32Array(message.flow);
    const talusRaw = new Float32Array(message.talus);

    let erodedTotal = 0, depositedTotal = 0, flowMax = 0, land = 0;
    const sea = projectRef.current.seaLevel;
    for (let i = 0; i < n; i++) {
      erodedTotal += eroded[i];
      depositedTotal += deposited[i];
      if (flow[i] > flowMax) flowMax = flow[i];
      if (height[i] > sea) land += 1;
    }
    // Talus accumulates without bound; compress it the same way the worker did.
    const talus = new Float32Array(n);
    let talusMax = 0;
    for (let i = 0; i < n; i++) {
      const v = Math.log1p(Math.max(0, talusRaw[i]) * 4000);
      talus[i] = v;
      if (v > talusMax) talusMax = v;
    }
    if (talusMax > 0) for (let i = 0; i < n; i++) talus[i] /= talusMax;

    return {
      resolution: res,
      height,
      slope: new Float32Array(message.slope),
      water: new Float32Array(message.water),
      flow,
      talus,
      eroded,
      deposited,
      erosionDelta: new Float32Array(message.erosionDelta),
      albedo: message.albedo ? new Uint8Array(message.albedo) : null,
      albedoSize: message.albedoSize,
      detail: message.detail ? new Uint8Array(message.detail) : null,
      detailSize: message.detailSize,
      ms: message.ms,
      stats: {
        ...message.stats,
        erodedTotal,
        depositedTotal,
        flowMax,
        landFraction: land / n,
        erosionMoved: erodedTotal + depositedTotal,
      },
    };
  }

  /* -------------------------------------------------------------- bake loop */

  const requestBake = useCallback((immediate = false) => {
    const worker = workerRef.current;
    if (!worker) return;
    const p = projectRef.current;
    const id = (requestIdRef.current += 1);
    const res = p.resolution;

    const brushBuffers = {};
    for (const [layerId, field] of brushFields.current.entries()) {
      if (field.length === res * res) brushBuffers[layerId] = field;
    }
    const captureBefore = p.layers
      .filter((l) => l.type === 'brush' && l.enabled !== false)
      .map((l) => l.id);

    setBakeState((s) => ({ ...s, busy: true, progress: 0, label: 'Queued', phase: 'layer' }));
    worker.postMessage({
      id,
      type: 'bake',
      payload: {
        layers: serializeLayers(p.layers),
        resolution: res,
        brushBuffers,
        captureBefore,
        importedBuffer: importedField.current && importedField.current.length === res * res
          ? importedField.current
          : null,
        texture: { layers: p.texture.layers },
        textureSize: p.textureSize || 1024,
        seaLevel: p.seaLevel,
        seed: p.seed,
        worldSize: p.worldSize,
        maxHeight: p.maxHeight,
        wantTexture: true,
      },
    });
  }, []);

  /** Structured-clone-safe copy: imagery stays out of the message. */
  function serializeLayers(layers) {
    return layers.map((l) => ({
      ...l,
      params: Object.fromEntries(Object.entries(l.params || {}).filter(([k]) => k !== 'image')),
    }));
  }

  useEffect(() => {
    const heavy = project.layers.some((l) => l.enabled !== false && l.type === 'erode');
    const delay = paintingRef.current ? 900 : heavy ? 380 : 120;
    const handle = setTimeout(() => requestBake(), delay);
    return () => clearTimeout(handle);
  }, [project, bakeToken, requestBake]);

  /* ------------------------------------------------------------- sun vector */

  const sunDir = useMemo(() => {
    const az = (project.sun.azimuth * Math.PI) / 180;
    const el = (project.sun.elevation * Math.PI) / 180;
    const ce = Math.cos(el);
    const v = [ce * Math.sin(az), Math.sin(el), ce * Math.cos(az)];
    const len = Math.hypot(...v) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
  }, [project.sun.azimuth, project.sun.elevation]);

  /* --------------------------------------------------------------- selection */

  const selectedLayer = useMemo(() => {
    if (selection.kind === 'shape') return project.layers.find((l) => l.id === selection.id) || null;
    if (selection.kind === 'surface') return project.texture.layers.find((l) => l.id === selection.id) || null;
    return null;
  }, [selection, project]);

  const selectedIndex = useMemo(() => {
    if (!selectedLayer) return -1;
    const list = selection.kind === 'shape' ? project.layers : project.texture.layers;
    return list.findIndex((l) => l.id === selectedLayer.id);
  }, [selectedLayer, selection.kind, project]);

  const onSelect = useCallback((id) => {
    if (id === LANDSCAPE_ID) { setSelection({ kind: 'landscape', id }); return; }
    const p = projectRef.current;
    if (p.layers.some((l) => l.id === id)) {
      setSelection({ kind: 'shape', id });
      const layer = p.layers.find((l) => l.id === id);
      if (layer && layer.type === 'brush') {
        // Selecting a sculpt layer adopts its stored brush settings.
        setProject((prev) => ({
          ...prev,
          brush: {
            ...prev.brush,
            mode: layer.params.mode || prev.brush.mode,
            size: layer.params.size || prev.brush.size,
            strength: layer.params.strength ?? prev.brush.strength,
            falloff: layer.params.falloff ?? prev.brush.falloff,
            level: layer.params.level ?? prev.brush.level,
          },
        }));
      }
      return;
    }
    if (p.texture.layers.some((l) => l.id === id)) setSelection({ kind: 'surface', id });
  }, []);

  /* ------------------------------------------------------- project mutation */

  const markDirty = () => setSaved(false);

  const update = useCallback((updater) => {
    setProject((prev) => updater(prev));
    markDirty();
  }, []);

  const patchProject = useCallback((patch) => update((p) => ({ ...p, ...patch })), [update]);

  const updateShapeLayer = useCallback((id, patch) => {
    update((p) => ({
      ...p,
      layers: p.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    }));
  }, [update]);

  const setShapeParam = useCallback((id, key, value) => {
    update((p) => ({
      ...p,
      layers: p.layers.map((l) => (l.id === id ? { ...l, params: { ...l.params, [key]: value } } : l)),
    }));
  }, [update]);

  const updateTextureLayer = useCallback((id, patch) => {
    update((p) => ({
      ...p,
      texture: { ...p.texture, layers: p.texture.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) },
    }));
  }, [update]);

  const setTextureParam = useCallback((id, key, value) => {
    update((p) => ({
      ...p,
      texture: {
        ...p.texture,
        layers: p.texture.layers.map((l) => (l.id === id ? { ...l, params: { ...l.params, [key]: value } } : l)),
      },
    }));
  }, [update]);

  const addLayer = useCallback((typeId) => {
    const layer = createLayer(typeId);
    update((p) => ({ ...p, layers: [...p.layers, layer] }));
    setSelection({ kind: 'shape', id: layer.id });
  }, [update]);

  const addTextureLayer = useCallback((kind, materialId) => {
    const layer = kind === 'satmap' ? createSatmapLayer() : createSplatLayer(material(materialId).name, materialId);
    update((p) => ({ ...p, texture: { ...p.texture, layers: [...p.texture.layers, layer] } }));
    setSelection({ kind: 'surface', id: layer.id });
  }, [update]);

  const toggleLayer = useCallback((id) => {
    update((p) => {
      if (p.layers.some((l) => l.id === id)) {
        return { ...p, layers: p.layers.map((l) => (l.id === id ? { ...l, enabled: l.enabled === false } : l)) };
      }
      return {
        ...p,
        texture: { ...p.texture, layers: p.texture.layers.map((l) => (l.id === id ? { ...l, enabled: l.enabled === false } : l)) },
      };
    });
  }, [update]);

  const duplicateLayer = useCallback((id, kind) => {
    update((p) => {
      if (kind === 'shape') {
        const i = p.layers.findIndex((l) => l.id === id);
        if (i < 0) return p;
        const copy = { ...p.layers[i], id: `${id}-copy-${Date.now().toString(36)}`, name: `${p.layers[i].name} copy`, params: { ...p.layers[i].params } };
        if (copy.type === 'brush') {
          brushFields.current.set(copy.id, new Float32Array(brushFields.current.get(id) || emptyDelta(p.resolution)));
        }
        const layers = [...p.layers];
        layers.splice(i + 1, 0, copy);
        setSelection({ kind: 'shape', id: copy.id });
        return { ...p, layers };
      }
      const i = p.texture.layers.findIndex((l) => l.id === id);
      if (i < 0) return p;
      const copy = { ...p.texture.layers[i], id: `${id}-copy-${Date.now().toString(36)}`, name: `${p.texture.layers[i].name} copy`, params: { ...p.texture.layers[i].params } };
      const layers = [...p.texture.layers];
      layers.splice(i + 1, 0, copy);
      setSelection({ kind: 'surface', id: copy.id });
      return { ...p, texture: { ...p.texture, layers } };
    });
  }, [update]);

  const deleteLayer = useCallback((id, kind) => {
    update((p) => {
      if (kind === 'shape') {
        brushFields.current.delete(id);
        captures.current.delete(id);
        return { ...p, layers: p.layers.filter((l) => l.id !== id) };
      }
      return { ...p, texture: { ...p.texture, layers: p.texture.layers.filter((l) => l.id !== id) } };
    });
    setSelection({ kind: 'landscape', id: LANDSCAPE_ID });
  }, [update]);

  const moveSelected = useCallback((direction) => {
    if (selection.kind === 'landscape') return;
    update((p) => {
      if (selection.kind === 'shape') {
        const i = p.layers.findIndex((l) => l.id === selection.id);
        // Display order is reversed, so "up" in the panel is a higher index here.
        const j = i - direction;
        if (i < 0 || j < 0 || j >= p.layers.length) return p;
        return { ...p, layers: moveLayer(p.layers, i, j) };
      }
      const i = p.texture.layers.findIndex((l) => l.id === selection.id);
      const j = i - direction;
      if (i < 0 || j < 0 || j >= p.texture.layers.length) return p;
      return { ...p, texture: { ...p.texture, layers: moveLayer(p.texture.layers, i, j) } };
    });
  }, [selection, update]);

  const resetLayer = useCallback((id, kind) => {
    update((p) => {
      if (kind === 'shape') {
        return {
          ...p,
          layers: p.layers.map((l) => (l.id === id
            ? { ...l, params: { ...typeDefaults(l.type), ...(l.type === 'erode' ? { tuning: l.params.tuning, type: l.params.type } : {}) }, opacity: 1 }
            : l)),
        };
      }
      return {
        ...p,
        texture: {
          ...p.texture,
          layers: p.texture.layers.map((l) => (l.id === id
            ? (l.kind === 'satmap' ? { ...l, params: { ...createSatmapLayer().params, image: l.params.image, imageName: l.params.imageName, imagePreview: l.params.imagePreview } }
              : { ...l, params: splatDefaults({ material: l.params.material, colorA: l.params.colorA, colorB: l.params.colorB, roughness: l.params.roughness }) })
            : l)),
        },
      };
    });
  }, [update]);

  /* ---------------------------------------------------------- brush painting */

  const canPaint = selection.kind === 'shape' && selectedLayer?.type === 'brush' && selectedLayer.enabled !== false;

  const onBrushChange = useCallback((key, value) => {
    update((p) => {
      const brush = { ...p.brush, [key]: value };
      // Keep the selected sculpt layer in step with the tool so its stored
      // settings are what the next selection restores.
      const layers = p.layers.map((l) => (
        selection.kind === 'shape' && l.id === selection.id && l.type === 'brush'
          ? { ...l, params: { ...l.params, [key]: value } }
          : l
      ));
      return { ...p, brush, layers };
    });
  }, [selection, update]);

  const onStroke = useCallback((phase, hit, lastUv) => {
    if (!canPaint || !hit) {
      if (phase === 'end') { paintingRef.current = false; setBakeToken((t) => t + 1); }
      return;
    }
    const p = projectRef.current;
    const layer = p.layers.find((l) => l.id === selection.id);
    if (!layer || layer.type !== 'brush') return;

    const res = p.resolution;
    const n = res * res;
    let field = brushFields.current.get(layer.id);
    if (!field || field.length !== n) {
      field = res && field ? resampleField(field, Math.round(Math.sqrt(field.length)), res) : emptyDelta(res);
      brushFields.current.set(layer.id, field);
    }

    const base = captures.current.get(layer.id) || bake?.height || new Float32Array(n);
    const brush = p.brush;
    const settings = {
      radius: Math.max(1, brush.size * 0.5),
      strength: brush.strength * 0.055,
      mode: brush.mode,
      falloff: brush.falloff,
      level: brush.level,
      seed: layer.params.seed || 1337,
      noiseScale: layer.params.noiseScale || 8,
    };

    const toGrid = (uv) => ({ x: clamp01(uv[0]) * (res - 1), y: clamp01(uv[1]) * (res - 1) });
    const point = toGrid(hit.uv);

    if (phase === 'start') {
      paintingRef.current = true;
      applyDab(field, base, res, { ...settings, x: point.x, y: point.y });
    } else if (phase === 'move') {
      const from = lastUv ? toGrid(lastUv) : point;
      applyStroke(field, base, res, from, point, settings);
    } else if (phase === 'end') {
      paintingRef.current = false;
      setBakeToken((t) => t + 1);
      return;
    }

    // Live preview: base plus this layer's delta, patched into the mesh.
    const opacity = layer.opacity ?? 1;
    const display = new Float32Array(n);
    for (let i = 0; i < n; i++) display[i] = clamp01(base[i] + field[i] * opacity);
    const pad = Math.ceil(settings.radius) + 3;
    const from = lastUv ? toGrid(lastUv) : point;
    const x0 = Math.max(0, Math.floor(Math.min(point.x, from.x) - pad));
    const x1 = Math.min(res - 1, Math.ceil(Math.max(point.x, from.x) + pad));
    const y0 = Math.max(0, Math.floor(Math.min(point.y, from.y) - pad));
    const y1 = Math.min(res - 1, Math.ceil(Math.max(point.y, from.y) + pad));
    viewportApi.current?.patchHeight?.(display, x0, y0, x1, y1);
  }, [canPaint, selection.id, bake]);

  /* ------------------------------------------------------------ resolution */

  useEffect(() => {
    const res = project.resolution;
    for (const [id, field] of [...brushFields.current.entries()]) {
      const srcRes = Math.round(Math.sqrt(field.length));
      if (srcRes !== res) brushFields.current.set(id, resampleField(field, srcRes, res));
    }
    if (importedField.current) {
      const srcRes = Math.round(Math.sqrt(importedField.current.length));
      if (srcRes !== res) importedField.current = resampleField(importedField.current, srcRes, res);
    }
  }, [project.resolution]);

  /* ---------------------------------------------------------------- actions */

  const onToggle = useCallback((key) => setToggles((t) => ({ ...t, [key]: !t[key] })), []);

  const onCameraPreset = useCallback((name) => {
    const cam = cameraRef.current;
    const p = projectRef.current;
    if (!cam) return;
    if (name === 'top') {
      cam.pitch = 1.5; cam.yaw = -Math.PI / 2;
      cam.distance = p.worldSize * 1.15;
      cam.target = [0, 0, 0];
      setProject((prev) => ({ ...prev, view: { ...prev.view, ortho: true } }));
    } else if (name === 'perspective') {
      cam.pitch = 0.62; cam.yaw = 0.72;
      cam.distance = p.worldSize * 1.3;
      cam.target = [0, p.maxHeight * 0.12, 0];
      setProject((prev) => ({ ...prev, view: { ...prev.view, ortho: false } }));
    } else {
      cam.pitch = 0.62; cam.yaw = 0.72;
      cam.distance = p.worldSize * 1.3;
      cam.target = [0, p.maxHeight * 0.12, 0];
      setProject((prev) => ({ ...prev, view: { ...prev.view, ortho: false } }));
    }
  }, []);

  // Keep the orbit distance sensible when the world size changes.
  useEffect(() => {
    const cam = cameraRef.current;
    if (!cam) return;
    cam.distance = Math.max(project.worldSize * 0.4, Math.min(project.worldSize * 3, cam.distance));
  }, [project.worldSize]);

  const onSave = useCallback(() => {
    const result = saveProject(projectRef.current);
    if (result.ok) setSaved(true);
    else window.alert(`Could not save locally: ${result.error}. Imported satellite imagery is never stored — remove it and try again.`);
  }, []);

  const onExport = useCallback(async (what) => {
    const b = bake;
    if (!b) return;
    const name = (projectRef.current.name || 'landscape').replace(/[^\w-]+/g, '-').toLowerCase();
    try {
      if (what === 'png') await exportHeightmapPng(b.height, b.resolution, `${name}-height.png`);
      else if (what === 'r16') exportHeightmapR16(b.height, b.resolution, `${name}-height.r16`);
      else if (what === 'normal') await exportNormalMapPng(b.height, b.resolution, 4, `${name}-normal.png`);
      else if (what === 'albedo') {
        if (!b.albedo) { window.alert('The surface texture has not finished baking yet.'); return; }
        await exportAlbedoPng(b.albedo, b.albedoSize, `${name}-albedo.png`);
      } else if (what === 'obj') exportObj(b.height, b.resolution, projectRef.current.worldSize, projectRef.current.maxHeight, `${name}.obj`);
      else if (what === 'json') exportProjectJson(projectRef.current, `${name}.landscape.json`);
    } catch (error) {
      window.alert(`Export failed: ${error.message || error}`);
    }
  }, [bake]);

  const onImportHeightmap = useCallback(async (file) => {
    const p = projectRef.current;
    try {
      const result = await importHeightmap(file, p.resolution);
      importedField.current = result.field;
      let existing = p.layers.find((l) => l.type === 'import');
      if (existing) {
        update((prev) => ({
          ...prev,
          layers: prev.layers.map((l) => (l.id === existing.id ? { ...l, name: file.name.replace(/\.[^.]+$/, '') } : l)),
        }));
        setSelection({ kind: 'shape', id: existing.id });
      } else {
        const layer = createLayer('import', { name: file.name.replace(/\.[^.]+$/, '') });
        layer.blend = 'replace';
        update((prev) => ({ ...prev, layers: [layer, ...prev.layers] }));
        setSelection({ kind: 'shape', id: layer.id });
      }
      setBakeToken((t) => t + 1);
    } catch (error) {
      window.alert(`Could not import that heightmap: ${error.message || error}`);
    }
  }, [update]);

  const onImportSatmap = useCallback(async (file) => {
    try {
      const image = await importSatmap(file);
      const preview = await makeThumbnail(file, 88);
      update((p) => ({
        ...p,
        texture: {
          ...p.texture,
          layers: p.texture.layers.map((l) => (l.id === selection.id
            ? {
              ...l,
              enabled: true,
              params: {
                ...l.params,
                source: 'image',
                image,
                imageName: image.name,
                imageBytes: image.bytes,
                imagePreview: preview,
              },
            }
            : l)),
        },
      }));
      setBakeToken((t) => t + 1);
    } catch (error) {
      window.alert(`Could not import that image: ${error.message || error}`);
    }
  }, [selection.id, update]);

  const onClearSatmap = useCallback(() => {
    update((p) => ({
      ...p,
      texture: {
        ...p.texture,
        layers: p.texture.layers.map((l) => (l.id === selection.id
          ? { ...l, params: { ...l.params, image: null, imageName: '', imagePreview: '', source: 'procedural' } }
          : l)),
      },
    }));
  }, [selection.id, update]);

  const onResetAll = useCallback(() => {
    if (!window.confirm('Reset the whole landscape to the default stack? This cannot be undone.')) return;
    brushFields.current = new Map();
    captures.current = new Map();
    importedField.current = null;
    const fresh = defaultProject();
    setProject(fresh);
    setSelection({ kind: 'landscape', id: LANDSCAPE_ID });
    setSaved(false);
  }, []);

  /* --------------------------------------------------------------- keyboard */

  useEffect(() => {
    const onKey = (event) => {
      const tag = event.target.tagName;
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || event.target.isContentEditable) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        onSave();
        return;
      }
      if (event.key === '1') setViewMode('shaded');
      else if (event.key === '2') setViewMode('height');
      else if (event.key === '3') setViewMode('slope');
      else if (event.key === '4') setViewMode('flow');
      else if (event.key === '5') setViewMode('erosion');
      else if (event.key === 'g') onToggle('grid');
      else if (event.key === 'c') onToggle('contours');
      else if (event.key === 'w') onToggle('water');
      else if (event.key === 'f') onCameraPreset('frame');
      else if (event.key === 't') onCameraPreset('top');
      else if (event.key === 'Escape') setSelection({ kind: 'landscape', id: LANDSCAPE_ID });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSave, onToggle, onCameraPreset]);

  /* ------------------------------------------------------------------ stats */

  const stats = useMemo(() => {
    const res = project.resolution;
    const triangles = (res - 1) * (res - 1) * 2;
    const range = bake ? (bake.stats.max - bake.stats.min) * project.maxHeight : project.maxHeight;
    return { triangles, range, ms: bake?.ms || 0 };
  }, [project.resolution, project.maxHeight, bake]);

  /* ------------------------------------------------------------------ render */

  const inspectorBody = (() => {
    if (selection.kind === 'landscape' || !selectedLayer) {
      return (
        <LandscapeInspector
          project={project}
          bake={bake}
          bakeState={bakeState}
          saved={saved}
          toggles={toggles}
          onToggle={onToggle}
          onSave={onSave}
          onRebake={() => setBakeToken((t) => t + 1)}
          onChange={patchProject}
          onSun={(key, value) => update((p) => ({ ...p, sun: { ...p.sun, [key]: value } }))}
          onView={(key, value) => update((p) => ({ ...p, view: { ...p.view, [key]: value } }))}
          onWater={(key, value) => update((p) => ({ ...p, view: { ...p.view, water: { ...p.view.water, [key]: value } } }))}
          onExport={onExport}
          onImportHeightmap={onImportHeightmap}
        />
      );
    }

    if (selection.kind === 'shape') {
      return (
        <ShapeLayerInspector
          project={project}
          layer={selectedLayer}
          index={selectedIndex}
          bake={bake}
          bakeState={bakeState}
          viewMode={viewMode}
          brushField={brushFields.current.get(selectedLayer.id) || null}
          imported={importedField.current}
          onChange={(patch) => updateShapeLayer(selectedLayer.id, patch)}
          onParam={(key, value) => setShapeParam(selectedLayer.id, key, value)}
          onReset={() => resetLayer(selectedLayer.id, 'shape')}
          onDuplicate={() => duplicateLayer(selectedLayer.id, 'shape')}
          onDelete={() => deleteLayer(selectedLayer.id, 'shape')}
          onMove={moveSelected}
          onToggleView={setViewMode}
          onRunErosion={() => setBakeToken((t) => t + 1)}
        />
      );
    }

    if (selectedLayer.kind === 'satmap') {
      return (
        <SatmapInspector
          layer={selectedLayer}
          dragging={draggingImage}
          setDragging={setDraggingImage}
          onChange={(patch) => updateTextureLayer(selectedLayer.id, patch)}
          onParam={(key, value) => setTextureParam(selectedLayer.id, key, value)}
          onImportImage={onImportSatmap}
          onClearImage={onClearSatmap}
          onDelete={() => deleteLayer(selectedLayer.id, 'surface')}
          onDuplicate={() => duplicateLayer(selectedLayer.id, 'surface')}
        />
      );
    }

    return (
      <SplatInspector
        project={project}
        layer={selectedLayer}
        index={selectedIndex}
        total={project.texture.layers.length}
        onChange={(patch) => updateTextureLayer(selectedLayer.id, patch)}
        onParam={(key, value) => setTextureParam(selectedLayer.id, key, value)}
        onDuplicate={() => duplicateLayer(selectedLayer.id, 'surface')}
        onDelete={() => deleteLayer(selectedLayer.id, 'surface')}
        onMove={moveSelected}
        onPickMaterial={(materialId) => {
          const m = material(materialId);
          updateTextureLayer(selectedLayer.id, {
            material: materialId,
            params: {
              ...selectedLayer.params,
              material: materialId,
              colorA: m.a,
              colorB: m.b,
              roughness: m.roughness,
              detail: m.detail,
            },
          });
        }}
      />
    );
  })();

  return (
    <main className="shell">
      <LayerStack
        project={project}
        selectedId={selection.kind === 'landscape' ? LANDSCAPE_ID : selection.id}
        onSelect={onSelect}
        onAddLayer={addLayer}
        onAddTextureLayer={addTextureLayer}
        onToggleLayer={toggleLayer}
        onReorderShape={(from, to) => update((p) => ({ ...p, layers: moveLayer(p.layers, from, to) }))}
        onReorderTexture={(from, to) => update((p) => ({ ...p, texture: { ...p.texture, layers: moveLayer(p.texture.layers, from, to) } }))}
        onRename={(name) => update((p) => ({ ...p, name }))}
        query={query}
        setQuery={setQuery}
        stats={stats}
        busyLayerId={bakeState.busy && selectedLayer?.type === 'erode' ? selectedLayer.id : null}
      />

      <Viewport
        project={project}
        bake={bake}
        viewMode={viewMode}
        onViewMode={setViewMode}
        toggles={toggles}
        onToggle={onToggle}
        sunDir={sunDir}
        brush={project.brush}
        onBrushChange={onBrushChange}
        canPaint={canPaint}
        activeBrushLayer={canPaint ? selectedLayer : null}
        onStroke={onStroke}
        bakeState={bakeState}
        onCameraPreset={onCameraPreset}
        cameraRef={cameraRef}
        stats={stats}
        apiRef={viewportApi}
      />

      <Inspector
        project={project}
        selection={{ ...selection, layer: selectedLayer }}
        saved={saved}
        onSave={onSave}
        bake={bake}
        bakeState={bakeState}
      >
        {inspectorBody}
      </Inspector>
    </main>
  );
}

/** Tiny thumbnail so the inspector can show the imported asset cheaply. */
function makeThumbnail(file, size) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      image.onerror = () => resolve('');
      image.src = reader.result;
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}
