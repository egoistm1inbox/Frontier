// Checks the export-size heightmap: a copy when the output equals the working grid, and a bicubic upscale with
// capped synthesised detail when it is larger. Run: node CheckExport.mjs
import assert from 'node:assert/strict';
import { exportHeight16 } from './js/terrain/export.js';

const W = 33;
const smooth = (x, y) => 0.5 + 0.3 * Math.sin(x * 0.4) * Math.cos(y * 0.3); // in [0.2, 0.8]
const h = new Float32Array(W * W);
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) h[y * W + x] = smooth(x, y);
const terr = { extentM: 16000, heightM: 1000 };
const flat = { slope: new Float32Array(W * W) }; // zero slope: no synthesised detail
const steep = { slope: new Float32Array(W * W).fill(60) };
const run = async (N, an, seed = 1, hooks = {}) => new Uint16Array(await exportHeight16({ h, W, N, an, terr, seed, hooks }));
const toUnit = (v) => v / 65535;

// ---------------------------------------------------------------- output equals working grid: a straight copy
{
  const out = await run(W, flat);
  assert.equal(out.length, W * W);
  for (let i = 0; i < out.length; i++) assert.equal(out[i], Math.round(h[i] * 65535), 'copy is exact at the working resolution');
}

// ---------------------------------------------------------------- upscale: exact at working samples, smooth between them
{
  const N = 2 * W - 1; // (W - 1) / (N - 1) = 0.5: every second output cell is a working sample
  const out = await run(N, flat);
  assert.equal(out.length, N * N);
  let worstKnot = 0;
  for (let Y = 0; Y < N; Y += 2) {
    for (let X = 0; X < N; X += 2) {
      const want = h[(Y / 2) * W + X / 2];
      worstKnot = Math.max(worstKnot, Math.abs(toUnit(out[Y * N + X]) - want));
    }
  }
  assert.ok(worstKnot <= 1 / 65535 + 1e-9, `working samples are reproduced exactly (worst ${worstKnot})`);
  // Between samples the bicubic follows the terrain closely in the interior. The outermost column is a little
  // looser: the Catmull-Rom neighbour past the edge repeats the edge sample, so it is one order less accurate.
  let worstInterior = 0;
  let worstEdge = 0;
  for (let Y = 0; Y < N; Y += 2) {
    for (let X = 1; X < N; X += 2) {
      const u = X / 2;
      const v = Y / 2;
      const err = Math.abs(toUnit(out[Y * N + X]) - smooth(u, v));
      if (u >= 2 && u <= W - 4 && v >= 2 && v <= W - 3) worstInterior = Math.max(worstInterior, err);
      else worstEdge = Math.max(worstEdge, err);
    }
  }
  assert.ok(worstInterior < 0.001, `interior cells between samples follow the terrain (worst ${worstInterior.toFixed(5)})`);
  assert.ok(worstEdge < 0.01, `edge cells stay within 0.01 of the terrain (worst ${worstEdge.toFixed(4)})`);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(Math.abs(toUnit(mean(out)) - mean(h)) < 0.005, 'upscaling keeps the mean height');
}

// ---------------------------------------------------------------- detail: capped, zero on flat ground, deterministic
{
  const N = 4 * W - 3; // 4x upscale, two octaves
  const a = await run(N, flat);
  const b = await run(N, steep, 1);
  let maxDiff = 0;
  let changed = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(toUnit(b[i]) - toUnit(a[i]));
    if (d > maxDiff) maxDiff = d;
    if (d > 1 / 65535) changed++;
  }
  assert.ok(changed > 0.5 * a.length, 'steep ground gets detail');
  assert.ok(maxDiff <= 0.021, `detail is capped at 0.02 (max ${maxDiff.toFixed(4)})`);
  const again = await run(N, steep, 1);
  assert.deepEqual(Array.from(again), Array.from(b), 'the same seed gives the same detail');
  const other = await run(N, steep, 2);
  assert.ok(Array.from(other).some((v, i) => v !== b[i]), 'a different seed gives different detail');
}

// ---------------------------------------------------------------- progress reports, and bad sizes are refused
{
  const fractions = [];
  await run(2 * W, flat, 1, { progress: (f) => fractions.push(f) });
  assert.ok(fractions.length >= 1, 'progress is reported');
  assert.equal(fractions[fractions.length - 1], 1, 'progress ends at 1');
  assert.ok(fractions.every((f, i) => i === 0 || f >= fractions[i - 1]), 'progress never goes back');
  await assert.rejects(() => run(16, flat), /smaller than the working grid/, 'an output smaller than the working grid is refused');
}

console.log('CheckExport: all checks passed');
