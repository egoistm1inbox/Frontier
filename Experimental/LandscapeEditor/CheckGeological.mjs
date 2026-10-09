// Checks the geological landforms and the falloff mask: each landform is finite, deterministic and in range, it
// leaves the zero level (0.5) outside its footprint so Add blend changes nothing there, and its defining feature is
// there (the summit, the crater rim, the rift shoulders, the flat mesa top). The falloff mask is 1 inside its region,
// 0 outside, and respects its shape, softness and strength. Run: node CheckGeological.mjs
import assert from 'node:assert/strict';
import { LAYER_TYPES } from './js/terrain/layers.js';
import { GEOLOGICAL_IDS, generateGeological, geologicalRaw } from './js/terrain/geological.js';
import { falloffMask, normaliseFalloff, FALLOFF_DEFAULTS } from './js/terrain/falloff.js';

const W = 128;
const at = (h, x, y) => h[y * W + x];
const cell = (u) => Math.round(u * (W - 1)); // map fraction to cell index

// ---------------------------------------------------------------- every landform
for (const id of GEOLOGICAL_IDS) {
  const def = LAYER_TYPES[id];
  assert.equal(def.group, 'geological', `${id} is in the geological group`);
  assert.equal(def.blend, 'Add', `${id} blends in Add mode`);
  const p = { ...def.defaults };
  const h = generateGeological(id, W, p, 1337);
  assert.equal(h.length, W * W, `${id} fills the grid`);
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of h) {
    assert.ok(Number.isFinite(v), `${id} is finite`);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  assert.ok(lo >= 0 && hi <= 1, `${id} stays in [0, 1]`);
  assert.ok(hi - lo > 0.2, `${id} has relief (range ${(hi - lo).toFixed(2)})`);
  // Outside the footprint the layer sits at the zero level, so Add blend leaves that ground alone.
  for (const [x, y] of [[0, 0], [W - 1, 0], [0, W - 1], [W - 1, W - 1]]) {
    assert.ok(Math.abs(at(h, x, y) - 0.5) < 0.02, `${id} is at the zero level in the corner (${at(h, x, y).toFixed(3)})`);
  }
  assert.deepEqual(Array.from(generateGeological(id, W, p, 1337)), Array.from(h), `${id} is deterministic`);
  const other = generateGeological(id, W, p, 4242);
  let changed = 0;
  for (let i = 0; i < h.length; i++) if (h[i] !== other[i]) changed++;
  assert.ok(changed > 0.05 * h.length, `${id} changes with the seed`);
}

// ---------------------------------------------------------------- the defining feature of each landform
{
  const c = cell(0.5);
  const mid = at(generateGeological('cone', W, LAYER_TYPES.cone.defaults, 1337), c, c);
  assert.ok(mid > 0.9, `the mountain cone peaks at its centre (${mid.toFixed(3)})`);
  // The cone's footprint is 45% of the half-width (0.225 map units), so 0.15 out is on the flank.
  const flank = at(generateGeological('cone', W, LAYER_TYPES.cone.defaults, 1337), cell(0.5 + 0.15), c);
  assert.ok(mid > flank && flank > 0.5, 'the cone falls away toward its foot');
}
{
  const p = { ...LAYER_TYPES.stump.defaults, rugosity: 0 };
  const h = generateGeological('stump', W, p, 1337);
  const c = cell(0.5);
  const top = at(h, c, c);
  let spread = 0;
  for (let y = c - 8; y <= c + 8; y++) for (let x = c - 8; x <= c + 8; x++) spread = Math.max(spread, Math.abs(at(h, x, y) - top));
  assert.ok(spread < 1e-4, `the mesa has a flat top (spread ${spread})`);
}
{
  const p = { ...LAYER_TYPES.crater.defaults, rugosity: 0 };
  const h = generateGeological('crater', W, p, 1337);
  const c = cell(0.5);
  const rimX = cell(0.5 + 0.5 * 0.4 * 0.95); // just inside the rim, along x, for a radius of 40%
  const floor = at(h, c + 1, c);
  assert.ok(at(h, rimX, c) > floor + 0.2, `the crater rim stands above its floor (${at(h, rimX, c).toFixed(3)} vs ${floor.toFixed(3)})`);
}
{
  // The rift sits along its axis. With the default angle of 30 degrees, a point along the axis is lower than a point
  // at the same distance from the centre, off the axis.
  const p = { ...LAYER_TYPES.rift.defaults, rugosity: 0 };
  const h = generateGeological('rift', W, p, 1337);
  const c = cell(0.5);
  const th = (p.angle * Math.PI) / 180;
  const along = (d) => at(h, cell(0.5 + d * Math.cos(th)), cell(0.5 + d * Math.sin(th)));
  const across = (d) => at(h, cell(0.5 - d * Math.sin(th)), cell(0.5 + d * Math.cos(th)));
  assert.ok(along(0.15) < 0.4, `the rift floor is below the zero level (${along(0.15).toFixed(3)})`);
  // The shoulders sit at 1.8 valley widths from the axis, across the axis. Half a radius is 0.45 map units.
  const w = 0.25;
  const d = 1.8 * w * 0.45;
  const sx = 0.5 - d * Math.sin(th);
  const sy = 0.5 + d * Math.cos(th);
  const shoulder = at(h, cell(sx), cell(sy));
  assert.ok(shoulder > 0.55, `the rift has raised shoulders beside its floor (${shoulder.toFixed(3)})`);
  assert.ok(along(0.02) < shoulder, 'the valley is lower on its axis than on its shoulders');
  void c;
}

// ---------------------------------------------------------------- falloff mask
{
  const N = 100;
  const circle = falloffMask(N, { ...FALLOFF_DEFAULTS, enabled: true, radius: 60, softness: 0, strength: 100 });
  const at2 = (m, x, y) => m[y * N + x];
  assert.equal(at2(circle, 50, 50), 1, 'the centre is inside the region');
  assert.equal(at2(circle, 0, 0), 0, 'a corner is outside a radius of 60%');
  assert.ok(circle.every((v) => v === 0 || v === 1), 'with softness 0 the edge is a step');
  const soft = falloffMask(N, { ...FALLOFF_DEFAULTS, enabled: true, radius: 60, softness: 100, strength: 100 });
  let between = 0;
  for (const v of soft) if (v > 0.01 && v < 0.99) between++;
  assert.ok(between > 0, 'softness gives a band of intermediate values');
  const half = falloffMask(N, { ...FALLOFF_DEFAULTS, enabled: true, radius: 60, softness: 0, strength: 50 });
  assert.ok(Math.abs(at2(half, 0, 0) - 0.5) < 1e-6, 'strength 50 leaves half the layer outside the region');
  // A square and a circle differ on the diagonal: (90, 90) is 0.8 across in each direction, so it is inside a square
  // of radius 90% but outside the circle of the same radius.
  const sq = falloffMask(N, { ...FALLOFF_DEFAULTS, enabled: true, shape: 'square', radius: 90, softness: 0, strength: 100 });
  const ci = falloffMask(N, { ...FALLOFF_DEFAULTS, enabled: true, shape: 'circle', radius: 90, softness: 0, strength: 100 });
  assert.equal(at2(sq, 90, 90), 1, 'the square includes the diagonal point');
  assert.equal(at2(ci, 90, 90), 0, 'the circle excludes the diagonal point');
  assert.equal(falloffMask(N, { ...FALLOFF_DEFAULTS, enabled: false }), null, 'a falloff that is off gives no mask');
  assert.equal(falloffMask(N, undefined), null, 'a missing falloff gives no mask');
}

// ---------------------------------------------------------------- falloff settings read from a file
{
  const n = normaliseFalloff({ enabled: 'yes', shape: 'hexagon', centreX: 500, centreY: -3, radius: 999, softness: 'x', strength: 40 });
  assert.equal(n.enabled, false, 'only a true flag turns the falloff on');
  assert.equal(n.shape, FALLOFF_DEFAULTS.shape, 'unknown shapes fall back');
  assert.equal(n.centreX, 100, 'the centre is clamped to the map');
  assert.equal(n.centreY, 0, 'the centre is clamped to the map');
  assert.equal(n.radius, 150, 'the radius is clamped');
  assert.equal(n.softness, FALLOFF_DEFAULTS.softness, 'non-numbers fall back');
  assert.equal(n.strength, 40);
  assert.deepEqual(normaliseFalloff(null), FALLOFF_DEFAULTS, 'a missing block gives the defaults');
}

// ---------------------------------------------------------------- the raw fields are signed where they should be
{
  const crater = geologicalRaw('crater', 64, { ...LAYER_TYPES.crater.defaults }, 1337);
  assert.ok(crater.some((v) => v < 0) && crater.some((v) => v > 0), 'a crater has both a rim and a floor');
  const cone = geologicalRaw('cone', 64, { ...LAYER_TYPES.cone.defaults }, 1337);
  assert.ok(cone.every((v) => v >= 0), 'a cone is never below its base');
}

console.log(`CheckGeological: all checks passed for ${GEOLOGICAL_IDS.length} landforms and the falloff mask`);
