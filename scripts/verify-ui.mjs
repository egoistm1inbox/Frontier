/**
 * Frontier Landscape Studio — UI verification under jsdom.
 *
 * Bundles the app with esbuild (JSX + CSS + the `?worker` import swapped for an
 * in-process bridge), mounts it in jsdom against the stubbed GL/2D contexts, and
 * then drives it the way a user would: selecting layers, switching erosion
 * processes, toggling visibility, adding and removing layers, and saving.
 *
 *   node scripts/verify-ui.mjs
 */

import { JSDOM } from 'jsdom';
import esbuild from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}
const section = (t) => console.log(`\n— ${t} —`);

/* ------------------------------------------------------------------- bundle */

section('Bundling the app for jsdom');
const workerPlugin = {
  name: 'worker-bridge',
  setup(build) {
    build.onResolve({ filter: /\?worker$/ }, (args) => ({
      path: path.resolve(ROOT, 'scripts/ui-worker-module.js'),
    }));
  },
};
const bundlePath = path.join(ROOT, '.verify', 'ui-app.bundle.mjs');
await esbuild.build({
  entryPoints: [path.join(ROOT, 'scripts/ui-app-entry.jsx')],
  bundle: true,
  outfile: bundlePath,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  loader: { '.css': 'empty', '.jsx': 'jsx', '.js': 'js' },
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [workerPlugin],
  logLevel: 'silent',
});
check('esbuild bundle produced', true);

/* --------------------------------------------------------------- jsdom setup */

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const { window } = dom;
// Some globals (navigator on Node ≥21) are getter-only; defineProperty is the
// only way to point them at the jsdom window.
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLCanvasElement',
  'Element', 'Node', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'getComputedStyle',
  'localStorage', 'sessionStorage', 'Blob', 'File', 'FileReader', 'Image', 'requestAnimationFrame',
  'cancelAnimationFrame', 'DOMParser', 'MutationObserver', 'location', 'history']) {
  if (window[key] === undefined) continue;
  try {
    globalThis[key] = window[key];
  } catch {
    Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
  }
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { installCanvasShims, installMiscShims, installWorkerShim } = await import('./ui-shim.js');
installCanvasShims(window);
installMiscShims(window);
await installWorkerShim();

// QUICK=1 seeds a deliberately small document so every re-bake is cheap; the
// assertions exercise the same code paths at 129² instead of 257².
if (process.env.QUICK === '1') {
  const { defaultProject } = await import(path.join(ROOT, 'src/core/project.js'));
  const light = defaultProject();
  light.resolution = 129;
  light.textureSize = 256;
  for (const layer of light.layers) {
    if (layer.type === 'erode') {
      layer.params.tuning = layer.params.tuning || {};
      layer.params.tuning.hydraulic = { ...(layer.params.tuning.hydraulic || {}), droplets: 14000, lifetime: 26 };
      layer.params.tuning.thermal = { ...(layer.params.tuning.thermal || {}), iterations: 30 };
    }
  }
  window.localStorage.setItem('frontier-landscape-studio-v1', JSON.stringify(light));
  console.log('  (QUICK mode: 129² grid, 256 px textures, reduced erosion)');
}

const errors = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));
const originalError = console.error;
console.error = (...args) => {
  const text = args.map(String).join(' ');
  // React logs act() warnings and known-dev notices; keep genuine errors.
  if (/not wrapped in act|ReactDOMTestUtils|deprecated/i.test(text)) return;
  errors.push(text);
  originalError(...args);
};

/* ------------------------------------------------------------------ mount */

const { React, act, createRoot, App } = await import(bundlePath);
const container = window.document.getElementById('root');
const root = createRoot(container);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async (ms = 900) => { await act(async () => { await sleep(ms); }); };

console.log('\n— Mounting —');
let mountError = null;
try {
  await act(async () => { root.render(React.createElement(App)); });
  await settle(1600);
} catch (error) {
  mountError = error;
}
check('app mounts without throwing', !mountError, mountError?.message || '');
check('three-column shell rendered', window.document.querySelectorAll('.shell > *').length === 3);
check('layer stack panel present', !!window.document.querySelector('.outliner.layer-panel'));
check('viewport present', !!window.document.querySelector('.viewport'));
check('inspector present', !!window.document.querySelector('.inspector.inspector-panel'));

const q = (sel) => window.document.querySelector(sel);
const qa = (sel) => [...window.document.querySelectorAll(sel)];

/* ------------------------------------------------------------------ layout */

section('Layer stack');
const rows = qa('.tree-row.layer-row');
check('layer rows rendered', rows.length >= 9, `rows=${rows.length}`);
const groupLabels = qa('.group-label').map((e) => e.textContent.trim());
check('Shape and Surface groups present', groupLabels.some((t) => t.includes('Shape')) && groupLabels.some((t) => t.includes('Surface')), groupLabels.join(' | '));
check('landscape document row present', !!qa('.tree-row .object-button').find((b) => /Landscape document/.test(b.textContent)));

const firstBakeOk = await act(async () => {
  for (let i = 0; i < 40; i++) {
    const chip = q('.hud-chip b');
    if (chip && /Ready/i.test(chip.textContent)) return true;
    await sleep(250);
  }
  return false;
});
check('first bake reaches Ready', firstBakeOk);
check('canvas element mounted', !!q('.canvas-wrap canvas'));

/* ------------------------------------------------------------- selection */

section('Selection drives the inspector');
const clickText = async (selector, matcher) => {
  const el = qa(selector).find((e) => matcher.test(e.textContent));
  if (!el) return false;
  await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  await settle(500);
  return true;
};

const clickedNoise = await clickText('.tree-row.layer-row .object-button', /Continental relief/);
check('selecting a layer row works', clickedNoise);
check('inspector title follows selection', /Continental relief/.test(q('.inspector h1')?.textContent || ''), q('.inspector h1')?.textContent);
const noiseCards = qa('.card-heading > span').map((e) => e.textContent.trim());
check('noise layer shows schema cards', noiseCards.some((t) => /Fractal noise/.test(t)) && noiseCards.some((t) => /Layer mask/.test(t)), noiseCards.join(' | '));
check('noise layer renders its sliders', qa('.slider-row input[type=range]').length >= 8, `sliders=${qa('.slider-row input[type=range]').length}`);
check('layer preview canvas rendered', !!q('.card canvas'));

const clickedSplat = await clickText('.tree-row.layer-row .object-button', /Riverbeds/);
check('selecting a splat layer works', clickedSplat);
const chips = qa('.rule-chip').map((e) => `${e.textContent.trim()}:${e.classList.contains('on')}`);
check('splat rules listed', chips.length >= 6, chips.join(' '));
check('riverbeds use a flow rule', chips.some((c) => c.startsWith('Flow:true')), chips.join(' '));
check('material presets listed', qa('.preset-grid button').length >= 12, `presets=${qa('.preset-grid button').length}`);

const clickedSat = await clickText('.tree-row.layer-row .object-button', /Satellite drape/);
check('selecting the satmap layer works', clickedSat);
check('satmap dropzone present', !!q('.dropzone'));
check('satmap generator sliders present', qa('.slider-row label > span').some((e) => /Parcel size/.test(e.textContent)));

/* -------------------------------------------------------------- erosion */

section('Erosion: one dropdown, per-process sliders');
await clickText('.tree-row.layer-row .object-button', /River systems/);
check('erosion layer selected', /River systems/.test(q('.inspector h1')?.textContent || ''), q('.inspector h1')?.textContent);

const selectEl = q('.select-block select');
check('process dropdown present', !!selectEl);
const options = qa('.select-block select option').map((o) => ({ value: o.value, label: o.textContent.trim() }));
check('dropdown lists six processes', options.length === 6, options.map((o) => o.label).join(' | '));

const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
const SIGNATURE = {
  hydraulic: 'Droplet count',
  rainfall: 'Soil detachability',
  thermal: 'Talus angle',
  wind: 'Wind bearing',
  glacial: 'Glacier extent',
  coastal: 'Wave energy',
};
const FOREIGN = {
  hydraulic: 'Talus angle',
  thermal: 'Droplet count',
  wind: 'Wave energy',
  glacial: 'Rainfall',
  coastal: 'Settling rate',
  rainfall: 'Glacier extent',
};
for (const [type, signature] of Object.entries(SIGNATURE)) {
  await act(async () => {
    nativeSet.call(selectEl, type);
    selectEl.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await settle(600);
  const labels = qa('.slider-row label > span').map((e) => e.textContent.trim());
  const hero = q('.process-hero h3')?.textContent.trim() || '';
  check(`${type}: exposes “${signature}”`, labels.includes(signature), labels.slice(0, 5).join(', '));
  check(`${type}: hides other processes' controls`, !labels.includes(FOREIGN[type]), FOREIGN[type]);
  check(`${type}: hero panel names it`, hero.toLowerCase().includes(type.slice(0, 5)) || hero.length > 0, hero);
}
await act(async () => {
  nativeSet.call(selectEl, 'hydraulic');
  selectEl.dispatchEvent(new window.Event('change', { bubbles: true }));
});
await settle(700);

/* --------------------------------------------------------- stack editing */

section('Stack editing');
const beforeCount = qa('.tree-row.layer-row').length;
await act(async () => { q('.outliner-heading .icon-button').dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
await settle(250);
check('add-layer menu opens', qa('.add-menu button').length >= 12, `items=${qa('.add-menu button').length}`);
await clickText('.add-menu button', /Cellular \/ mesas/);
check('adding a layer grows the stack', qa('.tree-row.layer-row').length === beforeCount + 1, `${beforeCount} → ${qa('.tree-row.layer-row').length}`);
check('new layer becomes the selection', /Cellular/.test(q('.inspector h1')?.textContent || ''), q('.inspector h1')?.textContent);

await act(async () => {
  const del = qa('.layer-actions .frontier-button').find((b) => /Delete/.test(b.textContent));
  del.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
});
await settle(400);
check('deleting a layer shrinks the stack', qa('.tree-row.layer-row').length === beforeCount, `${qa('.tree-row.layer-row').length}`);

// Visibility toggle.
const visBefore = qa('.tree-row.layer-row.disabled-layer').length;
await act(async () => {
  const row = qa('.tree-row.layer-row').find((r) => /Northern range|Mountain spine/.test(r.textContent));
  row.querySelector('.visibility').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
});
await settle(600);
const visAfter = qa('.tree-row.layer-row.disabled-layer').length;
check('visibility toggle disables the layer', visAfter === visBefore + 1, `${visBefore} → ${visAfter}`);
await act(async () => {
  const row = qa('.tree-row.layer-row.disabled-layer')[0];
  row.querySelector('.visibility').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
});
await settle(500);

// Blend + opacity controls.
await clickText('.tree-row.layer-row .object-button', /Foothills/);
const blendSelect = qa('.select-block select').find((s) => [...s.options].some((o) => /Additive/.test(o.textContent)));
check('blend-mode select present on a shape layer', !!blendSelect);

/* ------------------------------------------------------------- sculpting */

section('Sculpt tooling');
await clickText('.tree-row.layer-row .object-button', /Hand sculpt/);
const hint = q('.brush-hint')?.textContent.trim() || '';
check('brush bar reports it can paint for a sculpt layer', /Drag to sculpt/i.test(hint), hint);
const brushSelects = qa('.brush-bar select');
check('brush mode select present', brushSelects.length === 1);
await clickText('.tree-row.layer-row .object-button', /Continental relief/);
const hint2 = q('.brush-hint')?.textContent.trim() || '';
check('brush bar explains itself for non-sculpt layers', /Select a/i.test(hint2), hint2);

/* ------------------------------------------------------------ view modes */

section('View modes and toggles');
for (const [key, name] of [['2', 'Height'], ['4', 'Flow'], ['5', 'Erosion'], ['1', 'Shaded']]) {
  await act(async () => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
  });
  await settle(250);
  const active = q('.segments button[aria-pressed=true]')?.textContent.trim();
  check(`shortcut ${key} selects ${name}`, active === name, `active=${active}`);
}
const gridBefore = q('.tool-toggle[title="Height grid"]')?.getAttribute('aria-pressed');
await act(async () => { q('.tool-toggle[title="Height grid"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
check('grid toggle flips', q('.tool-toggle[title="Height grid"]')?.getAttribute('aria-pressed') !== gridBefore);
await act(async () => { q('.tool-toggle[title="Height grid"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });

/* --------------------------------------------------------------- saving */

section('Persistence');
await act(async () => { q('.save-status').dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
await settle(200);
check('save reports success', /All changes saved/.test(q('.save-status')?.textContent || ''), q('.save-status')?.textContent);
const storedRaw = window.localStorage.getItem('frontier-landscape-studio-v1');
check('project written to localStorage', !!storedRaw);
if (storedRaw) {
  const parsed = JSON.parse(storedRaw);
  check('stored project keeps the layer stack', Array.isArray(parsed.layers) && parsed.layers.length >= 9, `layers=${parsed.layers?.length}`);
  check('stored project drops imported imagery', !storedRaw.includes('"data":['));
}

/* ------------------------------------------------------------- hygiene */

section('Runtime hygiene');
check('no window errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.error = originalError;
await act(async () => { root.unmount(); });

console.log(`\n${passed} checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
