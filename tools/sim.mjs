/**
 * Headless handling / race simulation.
 *
 * Stubs the DOM so the real gameplay modules can be driven without a browser,
 * then runs a full race and reports lap times, wall hits and stability.
 *
 *   node tools/sim.mjs
 */
import * as THREE from 'three';

/* ------------------------------------------------------------------ DOM stub */
const ctx2d = new Proxy(
  {
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: () => ({ width: 10 }),
  },
  {
    get: (t, k) => (k in t ? t[k] : () => {}),
    set: () => true,
  }
);

globalThis.document = {
  createElement: (tag) => ({
    tagName: tag,
    width: 0,
    height: 0,
    style: {},
    getContext: () => ctx2d,
    addEventListener() {},
  }),
  querySelector: () => null,
  addEventListener() {},
  body: { appendChild() {} },
};
globalThis.window = {
  addEventListener() {},
  innerWidth: 1600,
  innerHeight: 900,
  devicePixelRatio: 1,
  AudioContext: null,
  webkitAudioContext: null,
};
globalThis.self = globalThis.window;
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [] }, configurable: true });
globalThis.requestAnimationFrame = () => 0;

/* ------------------------------------------------------------------ modules */
const { Track, PALETTE } = await import('../src/track.js');
const { Ship, AIDriver, TUNING } = await import('../src/ships.js');

const scene = new THREE.Scene();
const track = new Track(scene);

console.log(`track length      : ${track.length.toFixed(1)} m`);
console.log(`samples           : ${track.N}`);
console.log(
  `width range       : ${Math.min(...track.samples.map((s) => s.hw)).toFixed(1)} – ${Math.max(
    ...track.samples.map((s) => s.hw)
  ).toFixed(1)} m`
);
console.log(
  `bank range        : ${(Math.min(...track.samples.map((s) => s.bank)) * 180 / Math.PI).toFixed(1)}° – ${(
    Math.max(...track.samples.map((s) => s.bank)) * 180 / Math.PI
  ).toFixed(1)}°`
);

/* ------------------------------------------------------- handling micro-test */
function handlingProbe() {
  const ship = new Ship({ scene, track, color: PALETTE.cyan, accent: 0xffffff, name: 'probe', isPlayer: true });
  ship.placeAt(0, 0);
  ship.free = true;
  const dt = 1 / 120;
  let maxSpeed = 0;
  // straight-line acceleration test
  for (let i = 0; i < 120 * 12; i++) {
    ship.update(dt, { steer: 0, throttle: 1, brake: 0, drift: false, boost: false }, i * dt);
    maxSpeed = Math.max(maxSpeed, ship.speed);
  }
  const accelTime = (() => {
    const s2 = new Ship({ scene, track, color: 0xffffff, accent: 0xffffff, name: 'p2' });
    s2.placeAt(0, 0);
    s2.free = true;
    let t = 0;
    while (s2.speed < TUNING.maxSpeed * 0.9 && t < 20) {
      s2.update(dt, { steer: 0, throttle: 1, brake: 0, drift: false, boost: false }, t);
      t += dt;
    }
    return t;
  })();

  // drift test: does the hull rotate and slide?
  const s3 = new Ship({ scene, track, color: 0xffffff, accent: 0xffffff, name: 'p3' });
  s3.placeAt(0, 0);
  s3.free = true;
  for (let i = 0; i < 300; i++) s3.update(dt, { steer: 0, throttle: 1, brake: 0, drift: false, boost: false }, 0);
  const yaw0 = s3.yaw;
  const slipSamples = [];
  for (let i = 0; i < 90; i++) {
    s3.update(dt, { steer: 1, throttle: 1, brake: 0, drift: true, boost: false }, 0);
    const fwd = s3.forward;
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    slipSamples.push(Math.abs(s3.vel.dot(right)));
  }
  const yawDelta = Math.abs(s3.yaw - yaw0);

  // grip test (no drift): should slide far less
  const s4 = new Ship({ scene, track, color: 0xffffff, accent: 0xffffff, name: 'p4' });
  s4.placeAt(0, 0);
  s4.free = true;
  for (let i = 0; i < 300; i++) s4.update(dt, { steer: 0, throttle: 1, brake: 0, drift: false, boost: false }, 0);
  const gripSlip = [];
  for (let i = 0; i < 90; i++) {
    s4.update(dt, { steer: 1, throttle: 1, brake: 0, drift: false, boost: false }, 0);
    const fwd = s4.forward;
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    gripSlip.push(Math.abs(s4.vel.dot(right)));
  }

  return {
    maxSpeed,
    accelTime,
    driftYawDegPerSec: (yawDelta / 0.75) * (180 / Math.PI),
    driftAvgSlip: slipSamples.reduce((a, b) => a + b, 0) / slipSamples.length,
    gripAvgSlip: gripSlip.reduce((a, b) => a + b, 0) / gripSlip.length,
  };
}

const probe = handlingProbe();
console.log('\n--- handling probe ---');
console.log(`top speed (no boost)  : ${(probe.maxSpeed * 3.6).toFixed(0)} km/h`);
console.log(`0-90% speed time      : ${probe.accelTime.toFixed(2)} s`);
console.log(`drift yaw rate        : ${probe.driftYawDegPerSec.toFixed(0)} °/s`);
console.log(`drift lateral slip    : ${probe.driftAvgSlip.toFixed(1)} m/s`);
console.log(`grip lateral slip     : ${probe.gripAvgSlip.toFixed(1)} m/s`);

/* ------------------------------------------------------------- full race sim */
const ships = [];
const drivers = [];

const player = new Ship({ scene, track, color: PALETTE.cyan, accent: 0x9ff5ff, name: 'YOU', isPlayer: true });
ships.push(player);

const rivals = [
  { name: 'NOVA-7', color: PALETTE.magenta, accent: 0xff8fe0, skill: 1.0 },
  { name: 'VOLT', color: PALETTE.violet, accent: 0xc9a6ff, skill: 0.98 },
  { name: 'SABLE', color: PALETTE.amber, accent: 0xffd97a, skill: 0.965 },
  { name: 'KITE', color: PALETTE.lime, accent: 0xb6ffcf, skill: 0.95 },
  { name: 'ORACLE', color: 0x3f7bff, accent: 0x9bc0ff, skill: 0.94 },
];
rivals.forEach((def, i) => {
  const s = new Ship({ scene, track, color: def.color, accent: def.accent, name: def.name, skill: def.skill });
  ships.push(s);
  drivers.push(new AIDriver(s, track, { lane: (i % 2 === 0 ? -1 : 1) * (0.16 + i * 0.11), aggression: def.skill }));
});

const N = track.N;
const rowGap = 9;
ships.forEach((ship, i) => {
  const side = i % 2 === 0 ? -0.3 : 0.3;
  const offset = 18 + i * rowGap;
  ship.placeAt(offset % N, side);
});

// a scripted "decent human": follows the AI but with wander + drift/boost usage
const humanLine = new AIDriver(player, track, { lane: 0, aggression: 0.93 });

const laps = [];
let lapStart = 0;
let wallHits = 0;
let simTime = 0;
let nan = false;
const dt = 1 / 120;
const TOTAL_LAPS = 3;
let done = 0;

player.onLap = () => {
  laps.push(simTime - lapStart);
  lapStart = simTime;
  if (laps.length >= TOTAL_LAPS && !done) done = simTime;
};

const racers = ships.map((s, i) => ({ ship: s, driver: i === 0 ? humanLine : drivers[i - 1] }));

for (const r of racers) {
  r.ship.onWall = () => {
    if (r.ship === player) wallHits++;
  };
}

let steps = 0;
let travelled = 0;
const prevPos = player.pos.clone();
const maxSteps = 120 * 400;
while ((done === 0 || simTime < done + 0.001) && steps < maxSteps) {
  simTime += dt;
  steps++;
  for (const r of racers) {
    const gap = player.progress - r.ship.progress;
    r.driver.rubber = THREE.MathUtils.clamp(1 + gap * 0.00016, 0.9, 1.07);
    r.driver.update(dt, { elapsed: simTime, ships });
    if (!Number.isFinite(r.ship.pos.x) || !Number.isFinite(r.ship.speed)) nan = true;
  }
  travelled += player.pos.distanceTo(prevPos);
  prevPos.copy(player.pos);
  {
  }
}

const sorted = [...ships].sort((a, b) => b.progress - a.progress);
console.log('\n--- 3 lap race sim ---');
console.log(`sim realtime          : ${simTime.toFixed(1)} s`);
console.log(`player lap times      : ${laps.map((l) => l.toFixed(2)).join('  ')}`);
console.log(`player avg speed      : ${((travelled / simTime) * 3.6).toFixed(0)} km/h  (dist ${travelled.toFixed(0)} m)`);
console.log(`player wall hits      : ${wallHits}`);
console.log(`NaN detected          : ${nan}`);
console.log(
  `finish order          : ${sorted.map((s) => `${s.name}(${(s.progress / N).toFixed(2)} laps)`).join(' > ')}`
);
const aiStuck = ships.filter((s) => s.progress < N * 2.6).map((s) => s.name);
console.log(`rivals failing to finish 3 laps: ${aiStuck.length ? aiStuck.join(', ') : 'none'}`);

let ok = true;
const check = (label, cond) => {
  if (!cond) {
    ok = false;
    console.log(`  FAIL ${label}`);
  }
};
console.log('\n--- assertions ---');
check('no NaN', !nan);
check('player finished 3 laps', laps.length >= TOTAL_LAPS);
check('lap time plausible (15-70s)', laps.every((l) => l > 15 && l < 70));
check('player completed 3 real laps', travelled > track.length * 2.9);
check('drift slides more than grip', probe.driftAvgSlip > probe.gripAvgSlip * 1.5);
check('top speed 330-370 km/h', probe.maxSpeed > 92 && probe.maxSpeed < 103);
check('accelerates 0-90% in <7s', probe.accelTime < 7);
check('wall hits stay rare', wallHits < 60);
check('all rivals progress', aiStuck.length === 0);
console.log(ok ? '\nALL CHECKS PASSED' : '\nCHECKS FAILED');
process.exit(ok ? 0 : 1);
