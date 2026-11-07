/**
 * Static + dynamic wiring check for the HUD and boot code.
 * Catches missing element ids and null-deref bugs without a browser.
 *   node tools/dom-smoke.mjs
 */
import fs from 'node:fs';
const root = new URL('../', import.meta.url);
const html = fs.readFileSync(new URL('index.html', root), 'utf8');

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`  FAIL ${msg}`);
};

// ---- 1. every '#id' referenced in JS must exist in the markup
const jsFiles = fs.readdirSync(new URL('src/', root)).filter((f) => f.endsWith('.js'));
const dynamic = new Set(); // created / looked up at runtime by class
for (const f of jsFiles) {
  const src = fs.readFileSync(new URL(`src/${f}`, root), 'utf8');
  for (const m of src.matchAll(/querySelector(?:All)?\(\s*['"]#([a-zA-Z0-9_-]+)['"]/g)) {
    if (!htmlIds.has(m[1])) fail(`${f}: missing element #${m[1]} in index.html`);
  }
}
console.log(`checked ${jsFiles.length} modules against ${htmlIds.size} element ids`);

// ---- 2. ids the HUD reaches into must be present
const hudSrc = fs.readFileSync(new URL('src/hud.js', root), 'utf8');
const wanted = ['speed-val', 'speed-bar', 'boost-bar', 'hull-bar', 'lap-val', 'pos-val', 'time-val',
  'best-val', 'drift-tag', 'boost-tag', 'splash', 'toast', 'shard-val', 'minimap', 'rivals',
  'final', 'cam-mode', 'tacho-needle'];
const hudBlock = hudSrc.match(/this\.el = \{([\s\S]*?)\n    \};/)[1];
for (const w of wanted) if (!hudBlock.includes(`#${w}`)) fail(`hud.js no longer maps #${w}`);
for (const id of wanted) if (!htmlIds.has(id)) fail(`index.html missing #${id}`);

// ---- 3. run the HUD against a fake DOM
const makeEl = () => ({
  textContent: '', innerHTML: '', className: '', style: {},
  classList: { add() {}, remove() {}, contains: () => false },
  querySelector: () => makeEl(),
  getContext: () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: () => true }),
  width: 188, height: 188,
});
const ctxStub = new Proxy(
  { getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) },
  { get: (t, k) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: () => true }
);
const fakeCanvas = () => ({ width: 0, height: 0, style: {}, getContext: () => ctxStub });
globalThis.document = {
  createElement: () => fakeCanvas(),
  querySelector: (sel) => (htmlIds.has(sel.replace('#', '')) ? makeEl() : null),
  addEventListener() {},
};
globalThis.window = { addEventListener() {}, innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1 };

const { HUD } = await import('../src/hud.js');
const { Track, PALETTE } = await import('../src/track.js');
const { Ship } = await import('../src/ships.js');
const THREE = await import('three');

const hud = new HUD(makeEl());
const track = new Track(new THREE.Scene());
const ship = new Ship({ scene: new THREE.Scene(), track, color: PALETTE.cyan, accent: 0xffffff, name: 'YOU', isPlayer: true });
ship.placeAt(0, 0);
const race = { lap: 0, totalLaps: 3, raceTime: 12.5, bestLap: 0, position: 3, shards: 4, standings: [{ name: 'YOU', isPlayer: true, gap: 0 }] };

try {
  hud.update(1 / 60, { ship, race, track, camMode: 'CHASE' });
  hud.splash('LAP 2 / 3', 1200);
  hud.splash('LAP 2 / 3', 1200); // must not throw / must not re-fire instantly
  hud.toast('BEST LAP 0:29.53');
  hud.drawMinimap(track, [ship]);
  hud.showFinal({ position: 1, time: 89.8, bestLap: 29.5, shards: 12 });
  hud.hideFinal();
} catch (err) {
  fail(`HUD runtime error: ${err.message}`);
}
console.log(failures ? `\n${failures} FAILURES` : '\nDOM SMOKE TEST PASSED');
process.exit(failures ? 1 : 0);
