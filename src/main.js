import { HybridFluidSimulation, defaultParameters } from './simulation.js';
import { HydroRenderer } from './renderer.js';

const simulation = new HybridFluidSimulation();
const canvas = document.querySelector('#hydroCanvas');
const renderer = new HydroRenderer(canvas, simulation);

const element = (selector) => document.querySelector(selector);
const elements = (selector) => [...document.querySelectorAll(selector)];
const toast = element('#toast');
let toastTimer = 0;
let lastMetricUpdate = 0;
let frames = 0;
let fpsAnchor = performance.now();
let smoothedFps = 60;
let guideDismissed = false;

const labels = {
  waveAmplitude: (value) => `${Number(value).toFixed(2)} m`,
  windSpeed: (value) => `${Number(value).toFixed(1)} m/s`,
  waveResponse: (value) => `${Number(value).toFixed(1)} m/s`,
  surfaceDamping: (value) => Number(value).toFixed(2),
  surfaceCellSize: (value) => `${Number(value).toFixed(2)} m`,
  surfaceResolution: (value) => `${Math.round(Number(value))}²`,
  clipmapLevels: (value) => `${Math.round(Number(value))} levels`,
  splashIntensity: (value) => `${Number(value).toFixed(2)}×`,
  dropletCount: (value) => `${Math.round(Number(value))}`,
  splashCellSize: (value) => `${Number(value).toFixed(2)} m`,
  solverIterations: (value) => `${Math.round(Number(value))} passes`,
  coupling: (value) => `${Number(value).toFixed(2)}×`,
  foamPersistence: (value) => `${Number(value).toFixed(1)} s`,
  foamGain: (value) => `${Number(value).toFixed(2)}×`,
};

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2400);
}

function setRangeFill(input) {
  const minimum = Number(input.min || 0);
  const maximum = Number(input.max || 1);
  const value = Number(input.value);
  const percent = ((value - minimum) / Math.max(0.00001, maximum - minimum)) * 100;
  input.style.setProperty('--fill', `${percent}%`);
}

function updateParameterPresentation(name, value) {
  const input = element(`[data-param="${name}"]`);
  const output = element(`[data-output="${name}"]`);
  if (input) {
    input.value = value;
    setRangeFill(input);
  }
  if (output) output.value = labels[name] ? labels[name](value) : String(value);
}

function hydrateParameterControls() {
  for (const input of elements('[data-param]')) {
    const name = input.dataset.param;
    updateParameterPresentation(name, simulation.parameters[name]);
    input.addEventListener('input', () => {
      const value = Number(input.value);
      simulation.setParameter(name, value);
      updateParameterPresentation(name, value);
      if (name === 'splashCellSize') simulation.rebuildVolume();
      if (name === 'surfaceCellSize' || name === 'surfaceResolution' || name === 'clipmapLevels') simulation.rebuildSurface();
    });
  }
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remaining.toFixed(2).padStart(5, '0')}`;
}

function updateToggle(option, checked, siblingId) {
  renderer.setOption(option, checked);
  if (siblingId) {
    const sibling = element(siblingId);
    if (sibling && sibling.checked !== checked) sibling.checked = checked;
  }
}

function setPaused(paused) {
  simulation.paused = paused;
  const button = element('#playButton');
  const state = element('#runtimeState');
  button.classList.toggle('selected', !paused);
  button.querySelector('span').textContent = paused ? 'Play' : 'Pause';
  button.querySelector('use').setAttribute('href', paused ? '#icon-play' : '#icon-pause');
  button.title = paused ? 'Resume simulation (Space)' : 'Pause simulation (Space)';
  state.textContent = paused ? 'PAUSED' : 'LIVE';
  state.parentElement.classList.toggle('paused', paused);
  const modeChip = element('.mode-chip');
  modeChip.innerHTML = `<span class="mode-dot"></span>${paused ? 'PAUSED' : 'RUNNING'} <strong>HYBRID</strong>`;
}

function triggerImpact(source = 'toolbar') {
  const target = renderer.camera.target;
  const event = simulation.spawnImpact({
    x: target[0] + (simulation.random() - 0.5) * 1.8,
    z: target[2] + 8 + (simulation.random() - 0.5) * 1.2,
    speed: 8.4,
    mass: 1,
    radius: 1.1,
    source,
  });
  guideDismissed = true;
  element('#viewportGuide').classList.add('hidden');
  showToast(`${event.id} registered in ${event.gridHits.length} surface grid${event.gridHits.length === 1 ? '' : 's'}.`);
}

function resetSimulation() {
  simulation.reset();
  element('#viewportGuide').classList.remove('hidden');
  guideDismissed = false;
  showToast('Hybrid water state reset.');
}

function applyPreset(name) {
  const presets = {
    open: {
      waveAmplitude: 0.78, windSpeed: 13, waveResponse: 5.4, surfaceDamping: 0.42,
      splashIntensity: 1.1, dropletCount: 74, splashCellSize: 0.28, solverIterations: 3,
      coupling: 1.0, foamPersistence: 6.5, foamGain: 0.72,
    },
    calm: {
      waveAmplitude: 0.28, windSpeed: 4.5, waveResponse: 3.8, surfaceDamping: 0.67,
      splashIntensity: 0.82, dropletCount: 46, splashCellSize: 0.30, solverIterations: 2,
      coupling: 0.86, foamPersistence: 4.2, foamGain: 0.38,
    },
    breaker: {
      waveAmplitude: 1.08, windSpeed: 15.5, waveResponse: 6.2, surfaceDamping: 0.32,
      splashIntensity: 1.62, dropletCount: 128, splashCellSize: 0.21, solverIterations: 5,
      coupling: 1.34, foamPersistence: 10.0, foamGain: 1.12,
    },
    storm: {
      waveAmplitude: 1.62, windSpeed: 24, waveResponse: 7.4, surfaceDamping: 0.25,
      splashIntensity: 1.34, dropletCount: 102, splashCellSize: 0.25, solverIterations: 5,
      coupling: 1.13, foamPersistence: 11.5, foamGain: 1.26,
    },
  };
  const preset = presets[name];
  if (!preset) return;
  for (const [parameter, value] of Object.entries(preset)) {
    simulation.setParameter(parameter, value);
    updateParameterPresentation(parameter, value);
  }
  simulation.rebuildVolume();
  simulation.rebuildSurface();
  simulation.reset();
  showToast(`${name === 'open' ? 'Open swell' : `${name[0].toUpperCase()}${name.slice(1)}`} preset applied.`);
}

function renderContactList() {
  const contactList = element('#contactList');
  const contacts = simulation.contacts.slice(0, 8);
  if (!contacts.length) {
    contactList.innerHTML = '<li class="empty-contact">No contacts yet. Add an impact.</li>';
    return;
  }
  contactList.innerHTML = contacts.map((contact) => {
    const cell = contact.surfaceGrids[0]?.cell || ['—', '—'];
    return `<li><code>${contact.id}</code><span>${contact.type} · S${contact.surfaceGrids[0]?.level ?? '—'} [${cell.join(',')}]</span><time>${contact.time.toFixed(2)}s</time></li>`;
  }).join('');
}

function updateMetrics() {
  const metrics = simulation.metrics();
  element('#particleMetric').textContent = metrics.particles.toLocaleString();
  element('#cellMetric').textContent = metrics.occupiedCells.toLocaleString();
  element('#contactMetric').textContent = metrics.contactCount.toLocaleString();
  element('#timelineTime').textContent = formatTime(metrics.time);
  element('#surfaceGridSummary').textContent = `${simulation.ocean.levels.length} rings${metrics.remoteSurfaceTiles ? ` + ${metrics.remoteSurfaceTiles} tile${metrics.remoteSurfaceTiles === 1 ? '' : 's'}` : ''} · ${metrics.nearCoverage.toFixed(0)} m near`;
  element('#chunkSummary').textContent = `${metrics.chunks} active chunk${metrics.chunks === 1 ? '' : 's'}`;
  element('#nearCoverage').textContent = `${metrics.nearCoverage.toFixed(1)} × ${metrics.nearCoverage.toFixed(1)} m`;
  element('#farCoverage').textContent = `${metrics.farCoverage.toFixed(0)} × ${metrics.farCoverage.toFixed(0)} m`;
  element('#volumeCellReadout').textContent = `${simulation.parameters.splashCellSize.toFixed(2)} m`;
  element('#occupiedReadout').textContent = metrics.occupiedCells.toLocaleString();
  element('#cacheStatus').textContent = metrics.chunks ? `${metrics.chunks} chunks` : 'resident';
  element('#timelineFill').style.width = `${12 + (metrics.time * 5.5) % 81}%`;
  renderContactList();
}

function selectTab(tab) {
  for (const button of elements('.tab-button')) {
    const selected = button.dataset.tab === tab;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  }
  for (const panel of elements('.tab-panel')) panel.classList.toggle('active', panel.dataset.panel === tab);
}

function wireControls() {
  hydrateParameterControls();

  element('#playButton').addEventListener('click', () => setPaused(!simulation.paused));
  element('#impactButton').addEventListener('click', () => triggerImpact('toolbar'));
  element('#rainButton').addEventListener('click', () => {
    simulation.rain({ count: 8, centerX: renderer.camera.target[0], centerZ: renderer.camera.target[2] + 13 });
    guideDismissed = true;
    element('#viewportGuide').classList.add('hidden');
    showToast('Eight rain sources registered across the world grid.');
  });
  element('#resetButton').addEventListener('click', resetSimulation);
  element('#presetSelect').addEventListener('change', (event) => applyPreset(event.target.value));
  element('#presentationButton').addEventListener('click', () => document.body.classList.toggle('high-contrast'));

  for (const button of elements('.tab-button')) button.addEventListener('click', () => selectTab(button.dataset.tab));
  for (const row of elements('[data-system-focus]')) {
    row.addEventListener('click', () => {
      for (const sibling of elements('.tree-row')) sibling.classList.toggle('selected', sibling === row);
      const system = row.dataset.systemFocus;
      const titles = { surface: 'Ocean surface', volume: 'Splash volume', coupling: 'Hybrid coupling' };
      element('#inspectorTitle').textContent = titles[system];
      selectTab(system === 'volume' ? 'simulation' : system === 'surface' ? 'simulation' : 'debug');
      const targetSummary = element(system === 'volume' ? '.control-group:nth-of-type(2)' : system === 'surface' ? '.control-group:nth-of-type(1)' : '.debug-card');
      targetSummary?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  const renderToggleMap = [
    ['#renderGrid', 'showGrid', '#toggleGrid'],
    ['#renderFoam', 'showFoam', '#toggleFoam'],
    ['#renderVolume', 'showVolume', '#toggleVolume'],
    ['#renderContacts', 'showContacts', null],
    ['#renderClipmaps', 'showClipmaps', null],
  ];
  for (const [selector, option, sibling] of renderToggleMap) {
    element(selector).addEventListener('change', (event) => updateToggle(option, event.target.checked, sibling));
  }
  for (const [selector, option, sibling] of [
    ['#toggleGrid', 'showGrid', '#renderGrid'],
    ['#toggleFoam', 'showFoam', '#renderFoam'],
    ['#toggleVolume', 'showVolume', '#renderVolume'],
  ]) element(selector).addEventListener('change', (event) => updateToggle(option, event.target.checked, sibling));

  const quality = element('#renderQuality');
  const qualityOutput = element('#qualityOutput');
  const exposure = element('#exposure');
  const exposureOutput = element('#exposureOutput');
  const updateQuality = () => {
    renderer.setQuality(quality.value);
    qualityOutput.value = ['draft', 'balanced', 'dense'][Number(quality.value) - 1];
    setRangeFill(quality);
  };
  const updateExposure = () => {
    renderer.setOption('exposure', Number(exposure.value));
    exposureOutput.value = `${Number(exposure.value).toFixed(2)}×`;
    setRangeFill(exposure);
  };
  quality.addEventListener('input', updateQuality);
  exposure.addEventListener('input', updateExposure);
  updateQuality();
  updateExposure();

  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    const point = renderer.pickWater(event.clientX - rect.left, event.clientY - rect.top);
    if (point) element('#coordinateReadout').textContent = `WORLD ${point.x.toFixed(1)} / ${point.y.toFixed(1)} / ${point.z.toFixed(1)} m`;
  });
  canvas.addEventListener('pointerup', () => {
    if (!guideDismissed) {
      guideDismissed = true;
      element('#viewportGuide').classList.add('hidden');
    }
  });

  element('#copyContract').addEventListener('click', async () => {
    const contact = simulation.contacts[0];
    if (!contact) {
      showToast('Create an impact first; no ImpactRecord is available yet.');
      return;
    }
    const payload = {
      id: contact.id,
      worldPosition: [Number(contact.x.toFixed(3)), 0, Number(contact.z.toFixed(3))],
      normalMomentum: Number(contact.energy.toFixed(4)),
      surfaceGrids: contact.surfaceGrids,
      sparseVolumeCell: contact.volumeCell,
    };
    const content = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(content);
      showToast('Latest world-space ImpactRecord copied to clipboard.');
    } catch {
      showToast(`Impact payload: ${content.replaceAll('\n', ' ')}`);
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (event.code === 'Space') {
      event.preventDefault();
      setPaused(!simulation.paused);
    } else if (event.key.toLowerCase() === 'i') {
      triggerImpact('shortcut');
    } else if (event.key.toLowerCase() === 'r') {
      resetSimulation();
    } else if (event.key.toLowerCase() === 'g') {
      const next = !renderer.options.showGrid;
      updateToggle('showGrid', next, '#toggleGrid');
      element('#renderGrid').checked = next;
    }
  });
}

function animate(now) {
  if (!animate.lastTime) animate.lastTime = now;
  const elapsed = Math.min((now - animate.lastTime) / 1000, 0.08);
  animate.lastTime = now;
  animate.accumulator = Math.min((animate.accumulator || 0) + elapsed, 0.1);
  const fixedStep = 1 / 60;
  let updates = 0;
  while (animate.accumulator >= fixedStep && updates < 4) {
    simulation.step(fixedStep);
    animate.accumulator -= fixedStep;
    updates += 1;
  }
  renderer.render();

  frames += 1;
  if (now - fpsAnchor > 520) {
    const instantaneous = frames * 1000 / (now - fpsAnchor);
    smoothedFps = smoothedFps * 0.65 + instantaneous * 0.35;
    element('#fpsReadout').textContent = `${Math.round(smoothedFps)} FPS`;
    frames = 0;
    fpsAnchor = now;
  }
  if (now - lastMetricUpdate > 100) {
    updateMetrics();
    lastMetricUpdate = now;
  }
  requestAnimationFrame(animate);
}

wireControls();
updateMetrics();
// Start with a restrained source so the initial viewport communicates both systems.
simulation.spawnImpact({ x: -1.5, z: 35, speed: 7.1, mass: 0.58, radius: 0.72, source: 'seed' });
requestAnimationFrame(animate);

// Make the core objects inspectable from DevTools without making the UI depend
// on globals. This is useful when replacing this Canvas reference with a GPU
// backend in a Frontier editor host.
window.FrontierHydro = { simulation, renderer, parameters: defaultParameters };
