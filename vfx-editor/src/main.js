import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VfxEffect } from './vfx-engine.js';
import { PRESETS, SHAPES } from './presets.js';

// ---------- state ----------
let presetIndex = 0;
let params = structuredClone(PRESETS[0].params);
let playing = true;
let autoRotate = true;
let bloomStrength = params.bloom;

// ---------- three setup ----------
const viewport = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = params.exposure;
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(params.background);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
camera.position.set(0, 1.6, 10.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotate = autoRotate;
controls.autoRotateSpeed = 0.7;
controls.minDistance = 3;
controls.maxDistance = 30;

const effect = new VfxEffect(scene, params);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(1280, 720), bloomStrength, 0.65, 0.12);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);
resize();

// ---------- UI: presets ----------
const presetList = document.getElementById('presetList');
function renderPresets() {
  presetList.innerHTML = '';
  PRESETS.forEach((p, i) => {
    const el = document.createElement('button');
    el.className = 'preset' + (i === presetIndex ? ' active' : '');
    el.innerHTML = `<span class="thumb" style="background:${p.thumb}"></span>
      <span class="pmeta"><span class="pname">${p.name}</span><span class="pref">${p.ref}</span></span>`;
    el.onclick = () => loadPreset(i);
    presetList.appendChild(el);
  });
}

function loadPreset(i) {
  presetIndex = i;
  params = structuredClone(PRESETS[i].params);
  bloomStrength = params.bloom;
  document.getElementById('effectName').textContent = PRESETS[i].name;
  document.getElementById('effectRef').textContent = PRESETS[i].ref;
  effect.time = 0;
  effect.applyParams(params, true);
  applyLook();
  renderPresets();
  buildControls();
}

// ---------- UI: controls ----------
const SCHEMA = [
  { group: 'Emitter' },
  { k: 'shape', label: 'Shape', type: 'select', options: SHAPES },
  { k: 'count', label: 'Particle count', type: 'range', min: 1000, max: 60000, step: 500 },
  { k: 'life', label: 'Loop life (s)', type: 'range', min: 1, max: 12, step: 0.1 },
  { k: 'speed', label: 'Speed', type: 'range', min: 0.1, max: 3, step: 0.05 },
  { k: 'radius', label: 'Radius', type: 'range', min: 0.5, max: 9, step: 0.1 },
  { k: 'spread', label: 'Spread', type: 'range', min: 0, max: 1, step: 0.01 },
  { group: 'Motion · Flow Field' },
  { k: 'turbulence', label: 'Turbulence', type: 'range', min: 0, max: 1.5, step: 0.01 },
  { k: 'curl', label: 'Curl', type: 'range', min: 0, max: 1.5, step: 0.01 },
  { k: 'twist', label: 'Twist', type: 'range', min: 0, max: 2.5, step: 0.01 },
  { k: 'waveFreq', label: 'Wave frequency', type: 'range', min: 0.1, max: 4, step: 0.05 },
  { k: 'waveAmp', label: 'Wave amplitude', type: 'range', min: 0, max: 2.5, step: 0.05 },
  { k: 'flowSpeed', label: 'Flow speed', type: 'range', min: 0, max: 5, step: 0.1 },
  { k: 'flowLength', label: 'Flow length', type: 'range', min: 4, max: 22, step: 0.5 },
  { k: 'gravity', label: 'Gravity', type: 'range', min: -1, max: 1.5, step: 0.01 },
  { k: 'drag', label: 'Drag', type: 'range', min: 0, max: 1, step: 0.01 },
  { k: 'dirY', label: 'Direction bias Y', type: 'range', min: -1, max: 1, step: 0.05 },
  { group: 'Streaks & Points' },
  { k: 'showStreaks', label: 'Show streaks', type: 'check' },
  { k: 'streakLength', label: 'Streak length', type: 'range', min: 0.005, max: 0.2, step: 0.005 },
  { k: 'streakOpacity', label: 'Streak opacity', type: 'range', min: 0, max: 1.5, step: 0.01 },
  { k: 'showPoints', label: 'Show points', type: 'check' },
  { k: 'pointSize', label: 'Point size', type: 'range', min: 0.4, max: 6, step: 0.1 },
  { k: 'pointOpacity', label: 'Point opacity', type: 'range', min: 0, max: 1.5, step: 0.01 },
  { k: 'coreGlow', label: 'Core glow', type: 'range', min: 0, max: 2, step: 0.05 },
  { group: 'Color' },
  { k: 'colorA', label: 'Head (hot)', type: 'color' },
  { k: 'colorB', label: 'Mid', type: 'color' },
  { k: 'colorC', label: 'Tail (deep)', type: 'color' },
  { k: 'background', label: 'Background', type: 'color' },
  { group: 'Post' },
  { k: 'bloom', label: 'Bloom', type: 'range', min: 0, max: 2.5, step: 0.05 },
  { k: 'exposure', label: 'Exposure', type: 'range', min: 0.4, max: 1.8, step: 0.01 },
];

const controlsEl = document.getElementById('controls');
function buildControls() {
  controlsEl.innerHTML = '';
  for (const item of SCHEMA) {
    if (item.group) {
      const h = document.createElement('div');
      h.className = 'group';
      h.textContent = item.group;
      controlsEl.appendChild(h);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'row';
    if (item.type === 'select') {
      row.innerHTML = `<label>${item.label}</label>`;
      const sel = document.createElement('select');
      item.options.forEach((o, i) => {
        const op = document.createElement('option');
        op.value = i; op.textContent = o;
        if (params[item.k] === i) op.selected = true;
        sel.appendChild(op);
      });
      sel.onchange = () => { params[item.k] = +sel.value; effect.applyParams(params); };
      row.appendChild(sel);
    } else if (item.type === 'check') {
      row.innerHTML = `<label>${item.label}</label>`;
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = !!params[item.k];
      c.onchange = () => { params[item.k] = c.checked; effect.applyParams(params); };
      row.appendChild(c);
    } else if (item.type === 'color') {
      row.innerHTML = `<label>${item.label}</label>`;
      const c = document.createElement('input');
      c.type = 'color';
      c.value = params[item.k];
      c.oninput = () => { params[item.k] = c.value; effect.applyParams(params); applyLook(); };
      row.appendChild(c);
    } else {
      const val = params[item.k];
      row.innerHTML = `<label>${item.label}<span class="val">${val}</span></label>`;
      const r = document.createElement('input');
      r.type = 'range';
      r.min = item.min; r.max = item.max; r.step = item.step; r.value = val;
      const span = row.querySelector('.val');
      let rebuildT = null;
      r.oninput = () => {
        params[item.k] = +r.value;
        span.textContent = r.value;
        if (item.k === 'count') {
          // debounce buffer rebuilds while dragging
          clearTimeout(rebuildT);
          rebuildT = setTimeout(() => effect.applyParams(params, true), 160);
          updateStats();
        } else {
          effect.applyParams(params);
        }
        if (item.k === 'bloom' || item.k === 'exposure') applyLook();
      };
      row.appendChild(r);
    }
    controlsEl.appendChild(row);
  }
}

function applyLook() {
  scene.background.set(params.background);
  document.getElementById('viewport').style.background = params.background;
  bloomPass.strength = params.bloom;
  renderer.toneMappingExposure = params.exposure;
}

// ---------- toolbar ----------
document.getElementById('btnPlay').onclick = (e) => {
  playing = !playing;
  e.currentTarget.textContent = playing ? '⏸ Pause' : '▶ Play';
  e.currentTarget.classList.toggle('off', !playing);
};
document.getElementById('btnBurst').onclick = () => effect.triggerBurst(1.0);
document.getElementById('btnRotate').onclick = (e) => {
  autoRotate = !autoRotate;
  controls.autoRotate = autoRotate;
  e.currentTarget.classList.toggle('off', !autoRotate);
};
document.getElementById('btnShot').onclick = () => {
  composer.render();
  const a = document.createElement('a');
  a.download = `frontier-vfx-${PRESETS[presetIndex].id}.png`;
  a.href = renderer.domElement.toDataURL('image/png');
  a.click();
  toast('Snapshot saved as PNG');
};
document.getElementById('btnExport').onclick = () => {
  const data = {
    format: 'frontier-vfx/1',
    preset: PRESETS[presetIndex].id,
    params,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.download = `frontier-vfx-${PRESETS[presetIndex].id}.json`;
  a.href = URL.createObjectURL(blob);
  a.click();
  toast('Effect exported as JSON — load it in your engine via the runtime');
};
document.getElementById('btnImport').onclick = () => document.getElementById('fileInput').click();
document.getElementById('fileInput').onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const data = JSON.parse(rd.result);
      params = data.params || data;
      effect.applyParams(params, true);
      applyLook();
      buildControls();
      updateStats();
      toast(`Imported ${data.preset || 'custom'} effect`);
    } catch { toast('Could not parse that JSON file'); }
  };
  rd.readAsText(f);
};

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- stats ----------
const statsEl = document.getElementById('stats');
function updateStats() {
  statsEl.textContent = `${Number(params.count).toLocaleString()} particles · ${(params.count * 2).toLocaleString()} streak verts`;
}

// ---------- loop ----------
const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0, fps = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  effect.update(dt, playing);
  controls.update();
  composer.render();
  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  document.getElementById('fps').textContent = `${fps} fps`;
}

// ---------- init ----------
renderPresets();
loadPreset(0);
updateStats();
animate();
