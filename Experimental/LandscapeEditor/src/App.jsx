import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Glyph from './ui/Glyph.jsx';
import LayerStack from './ui/LayerStack.jsx';
import Inspector from './ui/Inspector.jsx';
import Viewport from './ui/Viewport.jsx';
import ContextMenu from './ui/ContextMenu.jsx';
import { createTerrainClient } from './workers/terrainClient.js';
import {
  createDefaultProject,
  createLayer,
  normaliseProject,
  makeId,
  clone,
  LayerKinds,
  ErosionTypes,
  EROSION_ORDER,
  PROJECT_FORMAT,
  PROJECT_VERSION,
} from './engine/specs.js';
import { encodeHeightPng16, encodeRgbaPng } from './engine/png.js';
import { blendImage } from './engine/satmap.js';

const STORAGE_KEY = 'frontier-landscape-editor:project:v1';
const COALESCE_MS = 900;
const EVALUATE_DELAY_MS = 140;

function loadStoredProject() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normaliseProject(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function clampNumber(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// zlib-wrapped deflate for PNG chunks (CompressionStream 'deflate' emits zlib framing).
async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const MENU_GROUPS = [
  { heading: 'Generate', kinds: ['fbm', 'ridge', 'island', 'offset'] },
  { heading: 'Shape', kinds: ['terrace', 'smooth', 'levels'] },
];

export function App() {
  const [project, setProject] = useState(() => loadStoredProject() ?? createDefaultProject());
  const [selection, setSelection] = useState({ kind: 'landscape' });
  const [result, setResult] = useState(null);
  const [preview, setPreview] = useState(null);
  const [job, setJob] = useState({ running: false, layerId: null, fraction: 0 });
  const [mode, setMode] = useState('shaded');
  const [view, setView] = useState({ exaggeration: 1, water: true, wireframe: false, projection: 'perspective' });
  const [widths, setWidths] = useState({ left: 316, right: 344 });
  const [frameNonce, setFrameNonce] = useState(0);
  const [menu, setMenu] = useState(null);
  const [toast, setToast] = useState(null);
  const [query, setQuery] = useState('');
  const [satImage, setSatImage] = useState(null);
  const [runNonce, setRunNonce] = useState(0);

  const historyRef = useRef({ past: [], future: [], key: '', time: 0 });
  const projectRef = useRef(project);
  projectRef.current = project;
  const clientRef = useRef(null);
  const jobIdRef = useRef(0);
  const forceRef = useRef(false);
  const dragRef = useRef(null);
  const toastTimer = useRef(0);
  const fileInput = useRef(null);
  const imageInput = useRef(null);
  const actionsRef = useRef({});

  const showToast = useCallback((message) => {
    setToast({ message, id: Date.now() });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  // Undo history. Slider drags share a coalesce key, so one drag is one undo step.
  const commit = useCallback((updater, coalesceKey = '') => {
    setProject((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      if (next === current) return current;
      const history = historyRef.current;
      const now = Date.now();
      const merge = coalesceKey && coalesceKey === history.key && now - history.time < COALESCE_MS;
      if (!merge) {
        history.past.push(current);
        if (history.past.length > 120) history.past.shift();
        history.future = [];
      }
      history.key = coalesceKey;
      history.time = now;
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    const history = historyRef.current;
    if (!history.past.length) {
      showToast('Nothing to undo');
      return;
    }
    setProject((current) => {
      const previous = history.past.pop();
      history.future.push(current);
      history.key = '';
      return previous;
    });
  }, [showToast]);

  const redo = useCallback(() => {
    const history = historyRef.current;
    if (!history.future.length) {
      showToast('Nothing to redo');
      return;
    }
    setProject((current) => {
      const next = history.future.pop();
      history.past.push(current);
      history.key = '';
      return next;
    });
  }, [showToast]);

  // Worker messages. Only the latest job id is applied.
  const handleMessage = useCallback(
    (message) => {
      if (message.type === 'error' && message.jobId === 0) {
        showToast('Worker error: ' + message.message);
        return;
      }
      if (message.jobId !== jobIdRef.current) return;
      if (message.type === 'progress') {
        setJob((current) => ({ ...current, running: true, layerId: message.layerId, fraction: message.fraction }));
      } else if (message.type === 'preview') {
        setPreview({ layerId: message.layerId, heights: message.heights });
      } else if (message.type === 'result') {
        setResult(message.result);
        setPreview(null);
        setJob({ running: false, layerId: null, fraction: 1 });
      } else if (message.type === 'error') {
        setPreview(null);
        setJob({ running: false, layerId: null, fraction: 0 });
        showToast('Evaluation failed: ' + message.message);
      }
    },
    [showToast],
  );

  useEffect(() => {
    const client = createTerrainClient(handleMessage);
    clientRef.current = client;
    return () => {
      client.terminate();
      clientRef.current = null;
    };
  }, [handleMessage]);

  // Autosave the project to this browser.
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    } catch {
      /* storage can be full or disabled; the editor still works */
    }
  }, [project]);

  // Evaluate after edits settle. Declared after the client effect so the client exists first.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const client = clientRef.current;
      if (!client) return;
      const force = forceRef.current;
      forceRef.current = false;
      jobIdRef.current = client.evaluate(project, force);
      setJob((current) => ({ ...current, running: true, layerId: null, fraction: 0 }));
    }, EVALUATE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [project, runNonce]);

  const runSimulation = useCallback(() => {
    forceRef.current = true;
    setRunNonce((n) => n + 1);
  }, []);

  const cancelJob = useCallback(() => {
    clientRef.current?.cancel();
    jobIdRef.current = 0;
    setPreview(null);
    setJob({ running: false, layerId: null, fraction: 0 });
    showToast('Simulation stopped');
  }, [showToast]);

  // Patches ------------------------------------------------------------------------------------
  const patchLayer = useCallback((id, fn, key) => commit((p) => ({ ...p, layers: p.layers.map((l) => (l.id === id ? fn(l) : l)) }), key), [commit]);

  const patchSettings = useCallback(
    (fn, key) =>
      commit((p) => {
        const settings = fn(p.settings);
        settings.seaLevel = clampNumber(settings.seaLevel, 0, settings.maxHeight);
        return { ...p, settings };
      }, key),
    [commit],
  );

  const patchSatmap = useCallback((fn, key) => commit((p) => ({ ...p, satmap: fn(p.satmap) }), key), [commit]);

  const toggleLayer = useCallback((id) => commit((p) => ({ ...p, layers: p.layers.map((l) => (l.id === id ? { ...l, enabled: !l.enabled } : l)) })), [commit]);

  const moveLayer = useCallback(
    (id, delta) =>
      commit((p) => {
        const index = p.layers.findIndex((l) => l.id === id);
        const target = index + delta;
        if (index < 0 || target < 0 || target >= p.layers.length) return p;
        const layers = p.layers.slice();
        [layers[index], layers[target]] = [layers[target], layers[index]];
        return { ...p, layers };
      }),
    [commit],
  );

  // target is an insertion index in the current array (0 = bottom of the stack).
  const reorderLayer = useCallback(
    (fromId, target) =>
      commit((p) => {
        const from = p.layers.findIndex((l) => l.id === fromId);
        if (from < 0) return p;
        const layers = p.layers.slice();
        const [item] = layers.splice(from, 1);
        let to = target > from ? target - 1 : target;
        to = clampNumber(to, 0, layers.length);
        if (to === from) return p;
        layers.splice(to, 0, item);
        return { ...p, layers };
      }),
    [commit],
  );

  const addLayer = useCallback(
    (kind, params) => {
      const layer = createLayer(kind, { params });
      const current = projectRef.current.layers;
      const above = selection.kind === 'layer' ? current.findIndex((l) => l.id === selection.id) : current.length - 1;
      commit((p) => {
        const layers = p.layers.slice();
        layers.splice(above + 1, 0, layer);
        return { ...p, layers };
      });
      setSelection({ kind: 'layer', id: layer.id });
      showToast('Added ' + layer.name);
    },
    [commit, selection, showToast],
  );

  const duplicateLayer = useCallback(
    (id) => {
      const current = projectRef.current.layers;
      const index = current.findIndex((l) => l.id === id);
      if (index < 0) return;
      const source = current[index];
      const copy = { ...clone(source), id: makeId(source.kind), name: source.name + ' copy', seed: source.seed + 1 };
      commit((p) => {
        const layers = p.layers.slice();
        layers.splice(index + 1, 0, copy);
        return { ...p, layers };
      });
      setSelection({ kind: 'layer', id: copy.id });
      showToast('Duplicated ' + source.name);
    },
    [commit, showToast],
  );

  const deleteLayer = useCallback(
    (id) => {
      const current = projectRef.current.layers;
      const index = current.findIndex((l) => l.id === id);
      if (index < 0) return;
      const removed = current[index];
      const neighbour = current[index - 1] ?? current[index + 1];
      commit((p) => ({ ...p, layers: p.layers.filter((l) => l.id !== id) }));
      setSelection(neighbour ? { kind: 'layer', id: neighbour.id } : { kind: 'landscape' });
      showToast('Deleted ' + removed.name + ' · Ctrl+Z to undo');
    },
    [commit, showToast],
  );

  const renameLayer = useCallback((id, name) => patchLayer(id, (l) => ({ ...l, name }), 'rename:' + id), [patchLayer]);

  const newProject = useCallback(() => {
    commit(createDefaultProject());
    setSelection({ kind: 'landscape' });
    setSatImage(null);
    showToast('New landscape · Ctrl+Z to undo');
  }, [commit, showToast]);

  const saveProject = useCallback(() => {
    const file = { format: PROJECT_FORMAT, version: PROJECT_VERSION, ...projectRef.current };
    downloadBlob(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }), 'landscape.frontier.json');
    showToast('Saved landscape.frontier.json');
  }, [showToast]);

  const onOpenFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      commit(normaliseProject(data));
      setSelection({ kind: 'landscape' });
      showToast('Opened ' + file.name);
    } catch {
      showToast('Could not open ' + file.name);
    }
  };

  const exportHeightmap = useCallback(async () => {
    const current = projectRef.current;
    if (!result) return;
    const bytes = await encodeHeightPng16(result.heights, result.size, deflate);
    downloadBlob(new Blob([bytes], { type: 'image/png' }), `heightmap-${current.settings.resolution}.png`);
    showToast('Heightmap PNG saved');
  }, [result, showToast]);

  const texture = useMemo(() => {
    if (!result) return null;
    if (!satImage || project.satmap.source !== 'imported') return result.texture;
    const size = result.textureSize;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const scale = Math.max(size / satImage.bitmap.width, size / satImage.bitmap.height);
    const width = satImage.bitmap.width * scale;
    const height = satImage.bitmap.height * scale;
    context.drawImage(satImage.bitmap, (size - width) / 2, (size - height) / 2, width, height);
    const pixels = context.getImageData(0, 0, size, size).data;
    return blendImage(result.texture, pixels, project.satmap.imageBlend);
  }, [result, satImage, project.satmap.source, project.satmap.imageBlend]);

  const exportSatmap = useCallback(async () => {
    if (!texture || !result) return;
    const bytes = await encodeRgbaPng(texture, result.textureSize, result.textureSize, deflate);
    downloadBlob(new Blob([bytes], { type: 'image/png' }), `satmap-${result.textureSize}.png`);
    showToast('Satmap PNG saved');
  }, [texture, result, showToast]);

  const pickImage = useCallback(() => imageInput.current?.click(), []);

  const onImageFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      setSatImage({ bitmap, name: file.name });
      commit((p) => ({ ...p, satmap: { ...p.satmap, source: 'imported' } }));
      showToast('Imported ' + file.name);
    } catch {
      showToast('Could not read that image');
    }
  };

  const clearImage = useCallback(() => {
    setSatImage(null);
    commit((p) => ({ ...p, satmap: { ...p.satmap, source: 'procedural' } }));
  }, [commit]);

  // Keyboard ----------------------------------------------------------------------------------
  const frame = useCallback(() => setFrameNonce((n) => n + 1), []);
  const selectedLayerId = selection.kind === 'layer' ? selection.id : null;
  actionsRef.current = {
    undo,
    redo,
    runSimulation,
    saveProject,
    frame,
    deleteSelected: () => selectedLayerId && deleteLayer(selectedLayerId),
    duplicateSelected: () => selectedLayerId && duplicateLayer(selectedLayerId),
    moveSelected: (delta) => selectedLayerId && moveLayer(selectedLayerId, delta),
  };

  useEffect(() => {
    const onKey = (event) => {
      const target = event.target;
      const typing = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const actions = actionsRef.current;
      if (mod && key === 'z' && !event.shiftKey && !typing) {
        event.preventDefault();
        actions.undo();
      } else if (mod && ((key === 'z' && event.shiftKey) || key === 'y') && !typing) {
        event.preventDefault();
        actions.redo();
      } else if (mod && key === 'r') {
        event.preventDefault();
        actions.runSimulation();
      } else if (mod && key === 's') {
        event.preventDefault();
        actions.saveProject();
      } else if (mod && key === 'd' && !typing) {
        event.preventDefault();
        actions.duplicateSelected();
      } else if (!typing && (event.key === 'Delete' || event.key === 'Backspace')) {
        actions.deleteSelected();
      } else if (!typing && event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        actions.moveSelected(event.key === 'ArrowUp' ? 1 : -1);
      } else if (!typing && !mod && !event.altKey && key === 'f') {
        actions.frame();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Dock resizing -----------------------------------------------------------------------------
  const startDrag = (event, side) => {
    event.preventDefault();
    dragRef.current = { side, startX: event.clientX, startWidth: side === 'left' ? widths.left : widths.right };
    document.body.classList.add('resizing');
  };

  useEffect(() => {
    const move = (event) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = event.clientX - drag.startX;
      setWidths((current) => {
        if (drag.side === 'left') {
          return { ...current, left: clampNumber(drag.startWidth + delta, 220, Math.min(520, window.innerWidth - current.right - 360)) };
        }
        return { ...current, right: clampNumber(drag.startWidth - delta, 260, Math.min(560, window.innerWidth - current.left - 360)) };
      });
    };
    const up = () => {
      dragRef.current = null;
      document.body.classList.remove('resizing');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  // Menus -------------------------------------------------------------------------------------
  const openMenuAt = (x, y, items) => setMenu({ x, y, items });

  const addMenuItems = () => [
    ...MENU_GROUPS.flatMap((group) => [
      { heading: group.heading },
      ...group.kinds.map((kind) => ({ label: LayerKinds[kind].shortLabel, icon: 'plus', onSelect: () => addLayer(kind) })),
    ]),
    { heading: 'Erode' },
    ...EROSION_ORDER.map((type) => ({
      label: ErosionTypes[type].shortLabel,
      icon: 'play',
      onSelect: () => addLayer('erosion', { type }),
    })),
  ];

  const layerMenuItems = (id) => {
    const layer = project.layers.find((l) => l.id === id);
    if (!layer) return [];
    const index = project.layers.findIndex((l) => l.id === id);
    return [
      { label: layer.enabled ? 'Hide layer' : 'Show layer', icon: 'eye', onSelect: () => toggleLayer(id) },
      { label: 'Duplicate', icon: 'duplicate', shortcut: 'Ctrl+D', onSelect: () => duplicateLayer(id) },
      { label: 'Move up', icon: 'up', shortcut: 'Alt+↑', disabled: index >= project.layers.length - 1, onSelect: () => moveLayer(id, 1) },
      { label: 'Move down', icon: 'down', shortcut: 'Alt+↓', disabled: index <= 0, onSelect: () => moveLayer(id, -1) },
      { separator: true },
      { label: 'Delete layer', icon: 'trash', shortcut: 'Del', danger: true, onSelect: () => deleteLayer(id) },
    ];
  };

  const onRowMenu = (event, target) => {
    event.preventDefault();
    event.stopPropagation();
    if (target.kind === 'layer') {
      setSelection({ kind: 'layer', id: target.id });
      openMenuAt(event.clientX, event.clientY, layerMenuItems(target.id));
    } else if (target.kind === 'satmap') {
      setSelection({ kind: 'satmap' });
      openMenuAt(event.clientX, event.clientY, [
        { label: 'Import image…', icon: 'upload', onSelect: pickImage },
        { label: 'Export satmap PNG', icon: 'download', onSelect: exportSatmap },
      ]);
    } else {
      setSelection({ kind: 'landscape' });
      openMenuAt(event.clientX, event.clientY, [
        { label: 'Frame terrain', icon: 'focus', shortcut: 'F', onSelect: frame },
        { label: 'Run simulation', icon: 'play', shortcut: 'Ctrl+R', onSelect: runSimulation },
        { separator: true },
        { label: 'Save project', icon: 'save', shortcut: 'Ctrl+S', onSelect: saveProject },
        { label: 'Open project…', icon: 'open', onSelect: () => fileInput.current?.click() },
      ]);
    }
  };

  const onLayersMenu = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    openMenuAt(rect.left, rect.bottom + 4, [
      { heading: 'Layers' },
      { label: 'Show all layers', icon: 'eye', onSelect: () => commit((p) => ({ ...p, layers: p.layers.map((l) => ({ ...l, enabled: true })) })) },
      { label: 'Hide all layers', icon: 'eye', onSelect: () => commit((p) => ({ ...p, layers: p.layers.map((l) => ({ ...l, enabled: false })) })) },
      { separator: true },
      { label: 'Replay erosion', icon: 'play', shortcut: 'Ctrl+R', onSelect: runSimulation },
    ]);
  };

  const onAddButton = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    openMenuAt(rect.left, rect.bottom + 4, addMenuItems());
  };

  // Derived -----------------------------------------------------------------------------------
  const runningLayer = project.layers.find((l) => l.id === job.layerId);
  const jobLabel = !job.running
    ? ''
    : runningLayer
      ? runningLayer.name
      : job.layerId === 'satmap'
        ? 'Satmap texture'
        : 'Preparing terrain';
  const viewWithSun = { ...view, sunAzimuth: project.satmap.sunAzimuth, sunElevation: project.satmap.sunElevation };
  const selectedLayer = selectedLayerId ? project.layers.find((l) => l.id === selectedLayerId) : null;
  const footerDescription =
    selection.kind === 'landscape'
      ? `Landscape · ${project.settings.resolution}² grid · ${(project.settings.size / (project.settings.resolution - 1)).toFixed(1)} m cells`
      : selection.kind === 'satmap'
        ? `Satmap · ${project.satmap.resolution}² texture`
        : selectedLayer
          ? `${LayerKinds[selectedLayer.kind]?.shortLabel ?? selectedLayer.kind} · ${selectedLayer.enabled ? 'enabled' : 'disabled'}`
          : 'Nothing selected';

  const inspectorActions = {
    patchSettings,
    patchSatmap,
    patchLayer,
    moveLayer,
    duplicateLayer,
    deleteLayer,
    replayErosion: runSimulation,
    newProject,
    openProjectDialog: () => fileInput.current?.click(),
    saveProject,
    exportHeightmap,
    exportSatmap,
    pickImage,
    clearImage,
    hasImage: !!satImage,
    imageName: satImage?.name ?? '',
  };

  return (
    <>
      <main className="workspace" style={{ '--left': widths.left + 'px', '--right': widths.right + 'px' }}>
        <section className="dock left" aria-label="Layers dock">
          <div className="tab-strip">
            <div className="document-tab active">
              <span>Layers</span>
            </div>
          </div>
          <div className="lx-panel">
            <LayerStack
              project={project}
              selection={selection}
              result={result}
              job={job}
              query={query}
              onQuery={setQuery}
              onSelect={setSelection}
              onSelectLandscape={() => setSelection({ kind: 'landscape' })}
              onToggle={toggleLayer}
              onReorder={reorderLayer}
              onRename={renameLayer}
              onMenu={onLayersMenu}
              onAddMenu={onAddButton}
              onRowMenu={onRowMenu}
            />
          </div>
          <div
            className="divider left"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize Layers panel"
            onPointerDown={(event) => startDrag(event, 'left')}
          />
        </section>
        <section className="dock centre" aria-label="Viewport dock">
          <div className="tab-strip">
            <div className="document-tab active">
              <span>Viewport</span>
            </div>
          </div>
          <div className="lx-panel lx-viewport">
            <Viewport
              settings={project.settings}
              result={result}
              preview={preview}
              texture={texture}
              job={{ ...job, label: jobLabel }}
              mode={mode}
              onMode={setMode}
              view={viewWithSun}
              onView={(patch) => setView((current) => ({ ...current, ...patch }))}
              onRun={runSimulation}
              onCancel={cancelJob}
              onFrame={frame}
              frameNonce={frameNonce}
            />
          </div>
        </section>
        <section className="dock right" aria-label="Inspector dock">
          <div className="tab-strip">
            <div className="document-tab active">
              <span>Inspector</span>
            </div>
          </div>
          <div className="inspector-scroll" key={selection.kind + (selection.id || '')}>
            <Inspector project={project} selection={selection} result={result} texture={texture} actions={inspectorActions} />
          </div>
          <footer className="inspector-footer">
            <span>{footerDescription}</span>
            <span>Web Worker · {job.running ? 'running' : 'idle'}</span>
          </footer>
          <div
            className="divider right"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize Inspector panel"
            onPointerDown={(event) => startDrag(event, 'right')}
          />
        </section>
      </main>
      <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={onOpenFile} />
      <input ref={imageInput} type="file" accept="image/*" hidden onChange={onImageFile} />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {toast && (
        <div className="lx-toast" role="status" key={toast.id}>
          <Glyph name="check" size={14} />
          <span>{toast.message}</span>
        </div>
      )}
    </>
  );
}
