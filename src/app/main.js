import { GpuErosionEngine } from '../erosion/gpu-erosion-engine.js';
import { ErosionLayerStackUI } from '../erosion/layer-stack-ui.js';
import { DEFAULT_CUSTOM_ARCH_CURVES } from '../geology/custom-arch-spline.js';
import { FORMATION_PRESETS, LITHOLOGY_PALETTES, resolveParams } from '../geology/presets.js';
import { exportFormationToGLB } from '../io/glb-exporter.js';
import { exportFormationToOBJ } from '../io/obj-exporter.js';
import { ArchCurveGizmoOverlay } from './arch-curve-gizmo.js';
import { RockStudioViewport } from './viewport.js';

// ============================================================================
// SCHEMA DEFINITIONS: 3D ROCK & CLIFF STUDIO
// ============================================================================

const SLIDER_SCHEMA = {
  tectonics: [
    { key: 'dipAngle',       label: 'Bedding / Foliation Dip', min: 0,   max: 78,  step: 1,    fmt: (v) => `${v}°` },
    { key: 'strikeAngle',    label: 'Strike Azimuth',          min: -90, max: 90,  step: 1,    fmt: (v) => `${v}°` },
    { key: 'jointDensity',   label: 'Joint Set Density',       min: 0.2, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
    { key: 'jointAperture',  label: 'Joint Notch Aperture',    min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
    { key: 'faultIntensity', label: 'Fault Slip & Gullies',    min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
  ],
  macro: [
    { key: 'scale',            label: 'Real-World Scale',       min: 2.5, max: 28,  step: 0.5,  fmt: (v) => `${Number(v).toFixed(1)}m` },
    { key: 'overhangStrength', label: 'Overhangs & Competency', min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
    { key: 'pluckingAmount',   label: 'Block Plucking',         min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
    { key: 'talusAmount',      label: 'Talus & Fallen Slabs',   min: 0.0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
  ],
  detail: [
    { key: 'cleavageSharpness', label: 'Cleavage Planarity',     min: 0.15, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
    { key: 'facetAmplitude',    label: 'Stepped Scarplet Depth', min: 0.0,  max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
    { key: 'edgeWear',          label: 'Chisel Chamfer & Wear',  min: 0.0,  max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
    { key: 'creaseAngle',       label: 'Crease Split Angle',     min: 22,   max: 85,  step: 1,    fmt: (v) => `${v}°` },
  ],
};

const CATEGORIES = ['All', 'Arch', 'Sedimentary', 'Desert', 'Cliff', 'Outcrop', 'Boulder', 'Fracture Demo'];
const QUICK_SEEDS = [4029, 7714, 1984, 9301, 5518, 2607];

const state = {
  studioMode: window.location.hash === '#rock' ? 'rock' : 'erosion',
  params: resolveParams({ archetype: 'desert-arch', seed: 4029, quality: 'medium', decimation: 1.0 }),
  categoryFilter: 'All',
  latestResult: null,
  autoFrameNext: true,
  rockInitializedOnce: false,
  curveMode: false,
  customCurveActive: false,
};

// ============================================================================
// VIEWPORTS & WORKER INITIALIZATION
// ============================================================================

const progressBar = document.getElementById('progress-bar');
const progressFill = document.getElementById('progress-fill');
const statusToast = document.getElementById('status-toast');
const viewportEl = document.getElementById('viewport-canvas');
const stageEl = document.querySelector('.viewport-stage');
const erosionCanvas = document.getElementById('erosion-canvas');

let erosionEngine = null;
let erosionLayerStackUI = null;
let fatalGpuError = null;
let viewport = null;
let curveOverlay = null;
let curveToolBound = false;

function ensureRockViewport() {
  if (viewport) return viewport;
  try {
    viewport = new RockStudioViewport(viewportEl);
    viewport.setActive(false);
    curveOverlay = new ArchCurveGizmoOverlay(stageEl, {
      getCameraAdapter: () => (state.studioMode === 'rock' && viewport ? viewport.getCameraAdapter() : null),
      onCurveChanged: () => updateCurveReadout(),
      onCurveCommitted: (curves) => {
        state.customCurveActive = true;
        updateCurveReadout();
        state.params.customArchCurves = curves;
        requestSynthesis(false);
      },
    });
    if (!curveToolBound) {
      curveToolBound = true;
      initCurveTool();
    }
  } catch (err) {
    console.error('Rock Studio viewport error:', err);
  }
  return viewport;
}

function updateErosionHud(tel) {
  const elSteps = document.getElementById('er-stat-steps');
  const elEval = document.getElementById('er-stat-eval');
  const elCaves = document.getElementById('er-stat-caves');
  const elCut = document.getElementById('er-stat-cut');
  const elSed = document.getElementById('er-stat-sed');
  const elWater = document.getElementById('er-stat-water');
  const elFps = document.getElementById('er-stat-fps');

  if (elSteps) elSteps.textContent = String(tel.layerCount ?? tel.steps ?? 0);
  if (elEval) elEval.textContent = `${(tel.evalMs ?? 0).toFixed(1)} ms`;
  if (elCaves) elCaves.textContent = `${(tel.caveTris ?? 0).toLocaleString()} tris`;
  if (elCut) elCut.textContent = `${(tel.coarseSedM3 ?? 0).toLocaleString()} m³`;
  if (elSed) elSed.textContent = `${(tel.fineSedM3 ?? 0).toLocaleString()} m³`;
  if (elWater) elWater.textContent = `${(tel.waterVolumeM3 ?? 0).toLocaleString()} m³`;
  if (elFps) elFps.textContent = `${tel.fps ?? 60} FPS`;
}

try {
  erosionEngine = new GpuErosionEngine(erosionCanvas, updateErosionHud);
} catch (err) {
  fatalGpuError = err.message || String(err);
  console.error('GPU Terrain Pipeline initialization error:', err);
  statusToast.classList.remove('hidden');
  statusToast.textContent = `GPU Pipeline Error: ${fatalGpuError}`;
}

const worker = new Worker(new URL('../worker/gen-worker.js', import.meta.url), { type: 'module' });
let reqCounter = 0;
let busy = false;
let pendingRequest = null;

function requestSynthesis(autoFrame = false) {
  ensureRockViewport();
  if (autoFrame) state.autoFrameNext = true;
  const payload = { params: { ...state.params } };
  if (busy) {
    pendingRequest = payload;
    return;
  }
  dispatchToWorker(payload);
}

function dispatchToWorker(payload) {
  busy = true;
  const id = ++reqCounter;
  if (state.studioMode === 'rock') {
    progressBar.classList.remove('hidden');
    progressFill.style.width = '5%';
    statusToast.classList.remove('hidden');
    statusToast.textContent = 'Synthesizing 3D geology...';
  }
  worker.postMessage({ id, params: payload.params });
}

worker.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'progress') {
    if (state.studioMode === 'rock') {
      progressFill.style.width = `${Math.round(msg.progress * 100)}%`;
      statusToast.textContent = msg.stage;
    }
    return;
  }

  busy = false;
  if (msg.type === 'done') {
    if (curveOverlay && state.customCurveActive) {
      curveOverlay.setCurves(state.params.customArchCurves || DEFAULT_CUSTOM_ARCH_CURVES, false);
      updateCurveReadout();
    }

    state.latestResult = {
      params: msg.params,
      lithology: msg.lithology,
      stats: msg.stats,
      mesh: msg.mesh,
    };

    const selectLith = document.getElementById('select-lithology');
    if (selectLith && msg.lithology) selectLith.value = msg.lithology;

    if (viewport) {
      viewport.setFormationMesh(
        msg.mesh,
        msg.lithology,
        msg.stats.dimensions,
        state.autoFrameNext
      );
    }
    state.autoFrameNext = false;
    updateRockHud(msg.stats);
  } else if (msg.type === 'error') {
    console.error('Geology worker error:', msg.message);
    statusToast.classList.remove('hidden');
    statusToast.textContent = `Error: ${msg.message}`;
  }

  if (pendingRequest) {
    const next = pendingRequest;
    pendingRequest = null;
    dispatchToWorker(next);
  } else {
    progressBar.classList.add('hidden');
    if (!fatalGpuError) {
      statusToast.classList.add('hidden');
    }
  }
};

function updateRockHud(stats) {
  const [dx, dy, dz] = stats.dimensions;
  document.getElementById('stat-dims').textContent = `${dx}×${dy}×${dz}m`;
  document.getElementById('stat-tris').textContent = stats.triangles.toLocaleString();
  document.getElementById('stat-verts').textContent = stats.vertices.toLocaleString();
  document.getElementById('stat-blocks').textContent = `${stats.blockCount}`;
  document.getElementById('stat-time').textContent = `${stats.elapsedMs}ms`;
}

// ============================================================================
// WORKSPACE SWITCHING (TERRAIN STUDIO <-> 3D ROCK & CLIFF STUDIO)
// ============================================================================

function setStudioMode(mode) {
  state.studioMode = mode === 'rock' ? 'rock' : 'erosion';
  const isTerrain = state.studioMode === 'erosion';

  document.getElementById('mode-btn-erosion').classList.toggle('active', isTerrain);
  document.getElementById('mode-btn-rock').classList.toggle('active', !isTerrain);

  document.getElementById('left-erosion-panels').classList.toggle('hidden-panel', !isTerrain);
  document.getElementById('right-erosion-panels').classList.toggle('hidden-panel', !isTerrain);
  document.getElementById('tp-terrain-bars').classList.toggle('hidden-panel', !isTerrain);
  document.getElementById('tp-terrain-header-actions').classList.toggle('hidden-panel', !isTerrain);
  document.getElementById('hud-erosion').classList.toggle('hidden-panel', !isTerrain);
  document.getElementById('cb-shelf-root').classList.toggle('hidden-panel', !isTerrain);
  document.getElementById('erosion-canvas').classList.toggle('hidden-panel', !isTerrain);
  document.getElementById('spline-gizmo-svg').classList.toggle('hidden-panel', !isTerrain);
  document.getElementById('tp-scene-nav').classList.toggle('hidden-panel', !isTerrain);
  document.getElementById('tp-scene-caption').classList.toggle('hidden-panel', !isTerrain);

  document.getElementById('left-rock-panels').classList.toggle('hidden-panel', isTerrain);
  document.getElementById('right-rock-panels').classList.toggle('hidden-panel', isTerrain);
  document.getElementById('hud-rock').classList.toggle('hidden-panel', isTerrain);
  document.getElementById('viewport-canvas').classList.toggle('hidden-panel', isTerrain);
  document.getElementById('rock-camera-bar').classList.toggle('hidden-panel', isTerrain);

  const leftTabLabel = document.getElementById('tp-left-tab-label');
  if (leftTabLabel) leftTabLabel.textContent = isTerrain ? 'Layer stack' : 'Rock archetypes';

  if (isTerrain) {
    progressBar.classList.add('hidden');
    if (!fatalGpuError) {
      statusToast.classList.add('hidden');
    }
    if (curveOverlay && state.curveMode) setCurveMode(false);
    if (viewport) viewport.setActive(false);
    if (erosionEngine) {
      erosionEngine.resizeIfNeeded();
      erosionEngine.start();
    }
    window.history.replaceState(null, '', '#terrain');
  } else {
    if (erosionEngine) erosionEngine.stop();
    const vp = ensureRockViewport();
    if (vp) vp.setActive(true);
    if (!state.rockInitializedOnce) {
      state.rockInitializedOnce = true;
      requestSynthesis(true);
    } else if (state.latestResult && vp) {
      vp.frameCamera('hero');
    }
    window.history.replaceState(null, '', '#rock');
  }
}

document.getElementById('mode-btn-erosion').addEventListener('click', () => setStudioMode('erosion'));
document.getElementById('mode-btn-rock').addEventListener('click', () => setStudioMode('rock'));

// ============================================================================
// FRONTIER TERRAIN STUDIO PIPELINE CONTROLS
// ============================================================================

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function initTerrainStudio() {
  if (!erosionEngine) return;

  erosionLayerStackUI = new ErosionLayerStackUI(erosionEngine);

  const playBtn = document.getElementById('btn-er-play');
  const syncPlayBtn = () => {
    const running = Boolean(erosionEngine.pipeline.liveSimRunning);
    erosionEngine.playing = running;
    playBtn.textContent = running ? '⏸ Pause Sim' : '▶ Live Sim';
    playBtn.classList.toggle('active-play', running);
  };
  syncPlayBtn();
  playBtn.addEventListener('click', () => {
    erosionEngine.pipeline.liveSimRunning = !erosionEngine.pipeline.liveSimRunning;
    syncPlayBtn();
  });

  document.getElementById('btn-er-reset').addEventListener('click', () => {
    erosionEngine.pipeline.evaluateStack({ reseedPlacements: true, fastPreview: false });
    erosionLayerStackUI.renderAll();
  });

  // Camera Presets in Viewport Scene Nav
  document.getElementById('btn-er-frame').addEventListener('click', () => {
    erosionEngine.resetCamera();
  });

  document.getElementById('btn-cam-cliff').addEventListener('click', () => {
    erosionEngine.camera.yaw = 0.62;
    erosionEngine.camera.pitch = 0.19;
    erosionEngine.camera.distance = 310;
    erosionEngine.camera.target = [12, 48, -14];
  });

  document.getElementById('btn-cam-top').addEventListener('click', () => {
    erosionEngine.camera.yaw = 0.0;
    erosionEngine.camera.pitch = 1.38;
    erosionEngine.camera.distance = 680;
    erosionEngine.camera.target = [0, 40, 0];
  });

  // Export Constructed Terrain Mesh (.GLB / .OBJ)
  document.getElementById('btn-er-export-glb').addEventListener('click', () => {
    const mesh = erosionEngine.extractMeshForExport(2);
    const slug = erosionEngine.pipeline.activePresetId || 'terrain';
    const glb = exportFormationToGLB({
      mesh,
      lithology: 'canyonSand',
      params: { archetype: slug, seed: 4029 },
    });
    downloadBlob(
      new Blob([glb], { type: 'model/gltf-binary' }),
      `frontier_${slug}_${erosionEngine.pipeline.layers.length}layers.glb`
    );
  });

  document.getElementById('btn-er-export-obj').addEventListener('click', () => {
    const mesh = erosionEngine.extractMeshForExport(2);
    const slug = erosionEngine.pipeline.activePresetId || 'terrain';
    const objText = exportFormationToOBJ({
      mesh,
      params: { archetype: slug, seed: 4029 },
    });
    downloadBlob(
      new Blob([objText], { type: 'text/plain' }),
      `frontier_${slug}_${erosionEngine.pipeline.layers.length}layers.obj`
    );
  });
}

// ============================================================================
// 3D ROCK & CLIFF STUDIO CONTROLS
// ============================================================================

const sliderRefs = new Map();

function updateCurveReadout() {
  const readout = document.getElementById('curve-point-readout');
  const pill = document.getElementById('curve-mode-pill');
  const radSlider = document.getElementById('slider-curve-radius');
  const radOut = document.getElementById('out-curve-radius');
  if (!curveOverlay) return;

  const pt = curveOverlay.getSelectedPoint();
  if (pill) {
    pill.textContent = !state.curveMode ? 'Off' : curveOverlay.placeMode ? 'Placing' : 'Gizmo';
  }
  if (!readout) return;
  if (!pt) {
    const total = curveOverlay.getCurves().reduce((n, c) => n + c.length, 0);
    readout.textContent = `${total} control points`;
    return;
  }
  readout.textContent = `P${curveOverlay.selectedPointIdx + 1} · r ${(pt.r ?? 1).toFixed(2)}×`;
  if (radSlider) radSlider.value = String(pt.r ?? 1.0);
  if (radOut) radOut.textContent = `${(pt.r ?? 1.0).toFixed(2)}×`;
}

function setCurveMode(flag) {
  state.curveMode = Boolean(flag);
  if (!curveOverlay) return;
  curveOverlay.setEnabled(state.curveMode);
  curveOverlay.setPlaceMode(state.curveMode);
  updateCurveReadout();
}

function initCurveTool() {
  if (!curveOverlay) return;
  document.getElementById('btn-curve-draw').addEventListener('click', () => {
    if (state.studioMode !== 'rock') setStudioMode('rock');
    state.curveMode = !state.curveMode;
    if (state.curveMode) {
      curveOverlay.clearForClickDraw(0);
      state.params.customArchCurves = curveOverlay.getCurves();
      setCurveMode(true);
    } else {
      setCurveMode(false);
    }
  });

  document.getElementById('btn-curve-reset').addEventListener('click', () => {
    curveOverlay.setCurves(DEFAULT_CUSTOM_ARCH_CURVES);
    state.params.customArchCurves = curveOverlay.getCurves();
    state.customCurveActive = true;
    setCurveMode(true);
    requestSynthesis(true);
  });

  document.getElementById('btn-curve-branch').addEventListener('click', () => {
    curveOverlay.addBranchArch([0, 0, 3.4], 0.86);
    state.params.customArchCurves = curveOverlay.getCurves();
    state.customCurveActive = true;
    setCurveMode(true);
    requestSynthesis(true);
  });

  document.getElementById('btn-curve-delete').addEventListener('click', () => {
    curveOverlay.deleteSelectedPoint();
    state.params.customArchCurves = curveOverlay.getCurves();
    requestSynthesis(false);
  });

  const radSlider = document.getElementById('slider-curve-radius');
  radSlider.addEventListener('input', () => {
    curveOverlay.setSelectedPointRadius(Number(radSlider.value), false);
    document.getElementById('out-curve-radius').textContent = `${Number(radSlider.value).toFixed(2)}×`;
  });
  radSlider.addEventListener('change', () => {
    curveOverlay.setSelectedPointRadius(Number(radSlider.value), true);
  });

  document.getElementById('archetype-list').addEventListener('pointerdown', () => {
    if (state.customCurveActive) {
      state.customCurveActive = false;
      delete state.params.customArchCurves;
      setCurveMode(false);
    }
  }, true);
}

function buildCategoryFilterBar() {
  const bar = document.getElementById('cat-filter-bar');
  bar.innerHTML = '';
  for (const cat of CATEGORIES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `cat-chip ${state.categoryFilter === cat ? 'active' : ''}`;
    btn.textContent = cat === 'Fracture Demo' ? 'Cracks' : cat;
    btn.addEventListener('click', () => {
      state.categoryFilter = cat;
      bar.querySelectorAll('.cat-chip').forEach((el) => el.classList.toggle('active', el === btn));
      buildArchetypeCards();
    });
    bar.appendChild(btn);
  }
}

function buildArchetypeCards() {
  const container = document.getElementById('archetype-list');
  container.innerHTML = '';
  for (const preset of Object.values(FORMATION_PRESETS)) {
    if (state.categoryFilter !== 'All' && preset.category !== state.categoryFilter) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `archetype-card ${preset.id === state.params.archetype ? 'active' : ''}`;
    btn.dataset.id = preset.id;
    btn.innerHTML = `
      <div class="arch-name">${preset.name}</div>
      <div class="arch-sub">${preset.category}</div>
    `;
    btn.addEventListener('click', () => selectArchetype(preset.id));
    container.appendChild(btn);
  }
}

function selectArchetype(archId) {
  const preset = FORMATION_PRESETS[archId];
  if (!preset) return;
  state.params = resolveParams({
    archetype: archId,
    seed: state.params.seed,
    quality: state.params.quality,
    decimation: state.params.decimation,
  });
  document.getElementById('active-category').textContent = preset.category;
  document.querySelectorAll('#archetype-list .archetype-card').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === archId);
  });
  syncSlidersFromState();
  requestSynthesis(true);
}

function buildSliders(groupKey, mountId) {
  const mount = document.getElementById(mountId);
  mount.innerHTML = '';
  for (const spec of SLIDER_SCHEMA[groupKey]) {
    const wrap = document.createElement('div');
    wrap.className = 'slider-group';
    const val = state.params[spec.key];
    wrap.innerHTML = `
      <div class="slider-label">
        <span>${spec.label}</span>
        <output>${spec.fmt(val)}</output>
      </div>
      <input type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${val}" />
    `;
    const input = wrap.querySelector('input');
    const out = wrap.querySelector('output');
    input.addEventListener('input', () => {
      const num = Number(input.value);
      state.params[spec.key] = num;
      out.textContent = spec.fmt(num);
      requestSynthesis(false);
    });
    sliderRefs.set(spec.key, { input, out, spec });
    mount.appendChild(wrap);
  }
}

function syncSlidersFromState() {
  for (const [key, ref] of sliderRefs.entries()) {
    const val = state.params[key];
    ref.input.value = val;
    ref.out.textContent = ref.spec.fmt(val);
  }
}

function buildSeedStrip() {
  const strip = document.getElementById('seed-strip');
  strip.innerHTML = '';
  for (const s of QUICK_SEEDS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `seed-chip ${Number(state.params.seed) === s ? 'active' : ''}`;
    b.textContent = `#${s}`;
    b.addEventListener('click', () => setSeed(s));
    strip.appendChild(b);
  }
}

function setSeed(newSeed) {
  state.params.seed = Number(newSeed) || 1;
  document.getElementById('input-seed').value = state.params.seed;
  document.querySelectorAll('.seed-chip').forEach((chip) => {
    chip.classList.toggle('active', chip.textContent === `#${state.params.seed}`);
  });
  requestSynthesis(false);
}

function initShadingControls() {
  const lithSelect = document.getElementById('select-lithology');
  for (const [key, pal] of Object.entries(LITHOLOGY_PALETTES)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = pal.name;
    lithSelect.appendChild(opt);
  }
  lithSelect.value = 'navajoRed';

  const shadingSelect = document.getElementById('select-shading');
  const rowLith = document.getElementById('row-lithology');
  rowLith.style.display = shadingSelect.value === 'lithology' ? 'flex' : 'none';

  shadingSelect.addEventListener('change', () => {
    const mode = shadingSelect.value;
    rowLith.style.display = mode === 'lithology' ? 'flex' : 'none';
    ensureRockViewport()?.setShadingMode(mode);
  });

  lithSelect.addEventListener('change', () => ensureRockViewport()?.setLithologyOverride(lithSelect.value));
  document.getElementById('select-rock-fabric').addEventListener('change', (e) => {
    ensureRockViewport()?.setFabricMode(Number(e.target.value) || 0);
  });

  const sunAz = document.getElementById('slider-sun-az');
  const sunEl = document.getElementById('slider-sun-el');
  const updateSun = () => {
    const az = Number(sunAz.value);
    const el = Number(sunEl.value);
    document.getElementById('out-sun-az').textContent = `${az}°`;
    document.getElementById('out-sun-el').textContent = `${el}°`;
    ensureRockViewport()?.setSunAngles(az, el);
  };
  sunAz.addEventListener('input', updateSun);
  sunEl.addEventListener('input', updateSun);

  document.getElementById('chk-human').addEventListener('change', (e) => ensureRockViewport()?.setScaleHumanVisible(e.target.checked));
  document.getElementById('chk-wireframe').addEventListener('change', (e) => ensureRockViewport()?.setWireframe(e.target.checked));
  document.getElementById('chk-turntable').addEventListener('change', (e) => ensureRockViewport()?.setTurntable(e.target.checked));
}

function initRockActionButtons() {
  document.getElementById('btn-random-seed').addEventListener('click', () => setSeed(Math.floor(1000 + Math.random() * 9000)));
  document.getElementById('btn-apply-seed').addEventListener('click', () => setSeed(Number(document.getElementById('input-seed').value)));

  document.querySelectorAll('#quality-buttons button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#quality-buttons button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.params.quality = btn.dataset.q;
      requestSynthesis(false);
    });
  });

  document.getElementById('select-decimation').addEventListener('change', (e) => {
    state.params.decimation = Number(e.target.value);
    requestSynthesis(false);
  });

  document.getElementById('btn-reset-params').addEventListener('click', () => selectArchetype(state.params.archetype));

  document.querySelectorAll('#rock-camera-bar .cam-btn').forEach((btn) => {
    btn.addEventListener('click', () => ensureRockViewport()?.frameCamera(btn.dataset.cam));
  });

  document.getElementById('btn-export-glb').addEventListener('click', () => {
    if (!state.latestResult) return;
    const glb = exportFormationToGLB(state.latestResult);
    downloadBlob(new Blob([glb], { type: 'model/gltf-binary' }), `frontier_${state.params.archetype}_${state.params.seed}.glb`);
  });

  document.getElementById('btn-export-obj').addEventListener('click', () => {
    if (!state.latestResult) return;
    const objText = exportFormationToOBJ(state.latestResult);
    downloadBlob(new Blob([objText], { type: 'text/plain' }), `frontier_${state.params.archetype}_${state.params.seed}.obj`);
  });

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    if (state.studioMode === 'erosion' && erosionEngine) {
      if (e.key === 'f' || e.key === 'F') {
        erosionEngine.resetCamera();
      } else if (e.code === 'Space') {
        e.preventDefault();
        document.getElementById('btn-er-play').click();
      }
      return;
    }
    if (e.key === 'f' || e.key === 'F') ensureRockViewport()?.frameCamera('hero');
  });
}

// Boot Frontier Terrain Studio + Rock Studio Controls
initTerrainStudio();
buildCategoryFilterBar();
buildArchetypeCards();
buildSliders('tectonics', 'sliders-tectonics');
buildSliders('macro', 'sliders-macro');
buildSliders('detail', 'sliders-detail');
buildSeedStrip();
initShadingControls();
initRockActionButtons();
setStudioMode(state.studioMode);
