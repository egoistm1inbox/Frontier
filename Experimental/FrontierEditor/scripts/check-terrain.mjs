#!/usr/bin/env node
// Terrain engine checks. No browser needed: they run the same modules the worker uses.
// Usage: npm run check:terrain   (exit code 1 when any check fails)

import { evaluateTerrain, evaluateTerrainCached, createTerrainCache } from '../terrain/stack.js';
import { evaluateTexturing, makeTextureLayer, toRGBA8 } from '../terrain/texturing.js';
import { buildPreset, PRESETS } from '../terrain/presets.js';
import { normalizeDoc } from '../terrain/document.js';
import { waterGeometry } from '../terrain/mesh.js';
import { encodeGray16, encodeRGBA8 } from '../terrain/png.js';
import { NO_WATER } from '../terrain/routing.js';

const WORLD = { size: 1024, resolution: 256, seed: 7 };
const SMALL = { size: 1024, resolution: 128, seed: 7 };
const lines = [];
let failures = 0;

async function check(name, fn) {
  try {
    const detail = await fn();
    lines.push(`PASS ${name}${detail ? ` (${detail})` : ''}`);
  } catch (err) {
    failures++;
    lines.push(`FAIL ${name}: ${err.message}`);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

// Ground height under a world point, using the same triangles as terrainGeometry.
function groundAt(h, N, size, x, z) {
  const fi = (x / size + 0.5) * (N - 1), fj = (z / size + 0.5) * (N - 1);
  const i = Math.min(N - 2, Math.max(0, Math.floor(fi))), j = Math.min(N - 2, Math.max(0, Math.floor(fj)));
  const u = fi - i, v = fj - j;
  const a = h[j * N + i], b = h[j * N + i + 1], d = h[(j + 1) * N + i], e = h[(j + 1) * N + i + 1];
  return u + v <= 1 ? a + (b - a) * u + (d - a) * v : e + (d - e) * (1 - u) + (b - e) * (1 - v);
}

// Fraction of texels whose three channels are all above a threshold (snow, paper, or washed-out colour).
const nearWhite = (out, t = 0.85) => {
  let n = 0;
  for (let i = 0; i < out.r.length; i++) if (out.r[i] > t && out.g[i] > t && out.b[i] > t) n++;
  return n / out.r.length;
};

// ---- documents -------------------------------------------------------------------------------
for (const p of PRESETS) {
  await check(`preset "${p.id}" survives normalisation unchanged`, () => {
    const d = buildPreset(p.id);
    const n = normalizeDoc(JSON.parse(JSON.stringify(d)));
    assert(n, 'normalizeDoc rejected a preset');
    assert(JSON.stringify(n.terrain) === JSON.stringify(d.terrain), 'terrain stack changed');
    assert(JSON.stringify(n.texturing) === JSON.stringify(d.texturing), 'texturing stack changed');
    return `${d.terrain.length} terrain + ${d.texturing.length} texturing layers`;
  });
}

await check('every preset mask has an id and an explicit enabled flag', () => {
  let masks = 0;
  for (const p of PRESETS) {
    const d = buildPreset(p.id);
    for (const l of [...d.terrain, ...d.texturing]) {
      for (const m of l.masks) {
        masks++;
        assert(typeof m.id === 'string' && m.id.length > 0, `${p.id}: mask without id`);
        assert(typeof m.enabled === 'boolean', `${p.id}: mask without enabled flag`);
      }
    }
  }
  return `${masks} masks`;
});

await check('a damaged document is repaired, not rejected', () => {
  const n = normalizeDoc({
    version: 1, world: { size: 'big' },
    terrain: [{ type: 'relief' }, { type: 'no-such-layer' }],
    texturing: [{ type: 'snow', masks: [{ type: 'height', enabled: false }] }],
  });
  assert(n, 'document rejected');
  assert(n.terrain.length === 1, 'unknown layer type should be dropped');
  assert(typeof n.terrain[0].id === 'string' && n.terrain[0].enabled === true, 'missing id/enabled should be filled');
  assert(n.texturing[0].masks[0].enabled === false, 'an explicit enabled:false must be kept');
  assert(n.world.size === 1024, 'a bad world size should fall back to the default');
});

// ---- masks ---------------------------------------------------------------------------------
await check('a mask without an enabled flag still applies; enabled:false is skipped', () => {
  const terrain = buildPreset('alpine').terrain;
  const { state } = evaluateTerrain(SMALL, terrain);
  const snowWith = (flag) => {
    const snow = makeTextureLayer('snow');
    const m = { id: 'k', type: 'height', blend: 'multiply', invert: false, opacity: 1, params: { min: 230, max: 1500, feather: 30 } };
    if (flag !== undefined) m.enabled = flag;
    snow.masks = [m];
    return snow;
  };
  const rock = makeTextureLayer('rock');
  const implicit = nearWhite(evaluateTexturing(state, [rock, snowWith(undefined)]).out);
  const disabled = nearWhite(evaluateTexturing(state, [rock, snowWith(false)]).out);
  assert(implicit < 0.5, `mask without a flag was ignored: snow covers ${(implicit * 100).toFixed(0)}%`);
  assert(disabled > 0.9, `enabled:false mask was not skipped: snow covers ${(disabled * 100).toFixed(0)}%`);
  return `snow above 230 m covers ${(implicit * 100).toFixed(1)}%; disabled mask covers ${(disabled * 100).toFixed(0)}%`;
});

// ---- heightfield and water --------------------------------------------------------------------
const evaluated = {};
for (const p of PRESETS) evaluated[p.id] = evaluateTerrain(WORLD, buildPreset(p.id).terrain).state;

await check('heightfield and water fields are finite', () => {
  for (const [id, st] of Object.entries(evaluated)) {
    for (let i = 0; i < st.height.length; i++) {
      assert(Number.isFinite(st.height[i]), `${id}: non-finite height at ${i}`);
    }
  }
  return Object.keys(evaluated).join(', ');
});

await check('river channels sit below the dry ground beside them (alpine)', () => {
  // compare each river cell with the dry cells on a ring four cells out, which lies beyond the channel
  const st = evaluated.alpine, N = st.N, h = st.height, R = 4;
  let sum = 0, n = 0;
  for (let j = R; j < N - R; j++) {
    for (let i = R; i < N - R; i++) {
      const c = j * N + i;
      if (st.riverMask[c] < 0.5) continue;
      let bank = 0, k = 0;
      for (let dj = -R; dj <= R; dj++) {
        for (let di = -R; di <= R; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== R) continue;
          const q = (j + dj) * N + i + di;
          if (st.riverMask[q] > 0.5) continue;
          bank += h[q];
          k++;
        }
      }
      if (k === 0) continue;
      sum += bank / k - h[c];
      n++;
    }
  }
  assert(n > 100, `too few river cells (${n})`);
  const drop = sum / n;
  assert(drop > 0.75, `channels are only ${drop.toFixed(2)} m below the dry ground beside them`);
  return `${n} river cells, mean ${drop.toFixed(1)} m below the dry ring`;
});

await check('the water mask never sits below the ground it covers', () => {
  for (const [id, st] of Object.entries(evaluated)) {
    for (let c = 0; c < st.N * st.N; c++) {
      if (st.water[c] > NO_WATER / 2) {
        assert(st.water[c] >= st.height[c] - 1e-4, `${id}: water level below ground at cell ${c}`);
      }
    }
  }
  return 'all presets';
});

await check('coast: sea cells lie below sea level', () => {
  const st = evaluated.coast;
  let n = 0;
  for (let c = 0; c < st.N * st.N; c++) {
    if (st.seaMask[c] > 0.5) {
      n++;
      assert(st.height[c] <= st.sea + 1e-3, `sea cell above sea level at ${c}`);
    }
  }
  assert(n > 1000, `too few sea cells (${n})`);
  return `${n} sea cells at ${st.sea} m`;
});

await check('the water surface stays on the terrain (all presets)', () => {
  const report = [];
  for (const [id, st] of Object.entries(evaluated)) {
    const g = waterGeometry(st.N, st.size, st.height, st.water);
    assert(g.count > 0, `${id}: no water surface`);
    let bad = 0, worst = 0;
    for (let k = 0; k < g.count; k++) {
      const x = g.pos[k * 3], y = g.pos[k * 3 + 1], z = g.pos[k * 3 + 2];
      assert(Number.isFinite(x + y + z), `${id}: NaN vertex`);
      if (g.depth[k] <= 0.001) continue;
      const err = Math.abs(y - groundAt(st.height, st.N, st.size, x, z) - g.depth[k]);
      worst = Math.max(worst, err);
      if (err > 0.05) bad++;
    }
    for (let t = 0; t < g.index.length; t++) assert(g.index[t] < g.count, `${id}: index out of range`);
    assert(bad === 0, `${id}: ${bad} wet vertices sit more than 5 cm off the water plane (worst ${worst.toFixed(2)} m)`);
    report.push(`${id} ${g.count} verts`);
  }
  return report.join(', ');
});

// ---- texture ----------------------------------------------------------------------------------
await check('no near-white albedo beyond the snow line (alpine)', () => {
  const { out } = evaluateTexturing(evaluated.alpine, buildPreset('alpine').texturing);
  const f = nearWhite(out);
  assert(f < 0.03, `${(f * 100).toFixed(1)}% of texels are near-white`);
  return `${(f * 100).toFixed(2)}% near-white`;
});

await check('dry ground is never blue-dominant', () => {
  const report = [];
  for (const id of ['alpine', 'coast', 'canyon']) {
    const st = evaluated[id];
    const { out } = evaluateTexturing(st, buildPreset(id).texturing);
    let blueDry = 0, dry = 0;
    for (let c = 0; c < st.N * st.N; c++) {
      const wet = st.water[c] > NO_WATER / 2 && st.water[c] > st.height[c] + 0.02;
      if (wet) continue;
      dry++;
      if (out.b[c] > Math.max(out.r[c], out.g[c]) + 0.02) blueDry++;
    }
    assert(blueDry === 0, `${id}: ${blueDry} dry texels are blue`);
    report.push(`${id} ${dry} dry texels`);
  }
  return report.join(', ');
});

// ---- incremental cache ------------------------------------------------------------------------
await check('cached evaluation matches a fresh one after an edit', () => {
  const layers = buildPreset('alpine').terrain;
  const cache = createTerrainCache();
  evaluateTerrainCached(SMALL, layers, cache);
  const edited = layers.map((l, i) => (i === layers.length - 1 ? { ...l, opacity: 0.5 } : l));
  const cached = evaluateTerrainCached(SMALL, edited, cache);
  const fresh = evaluateTerrain(SMALL, edited).state;
  assert(cached.reused > 0, 'the unchanged prefix was not reused');
  for (const key of ['height', 'water', 'riverMask', 'lakeMask']) {
    for (let i = 0; i < fresh[key].length; i++) {
      if (cached.state[key][i] !== fresh[key][i]) throw new Error(`${key} differs at ${i}`);
    }
  }
  return `reused ${cached.reused} of ${edited.length} layers`;
});

// ---- export -----------------------------------------------------------------------------------
const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
await check('16-bit heightmap PNG has the signature and a 16-bit IHDR', async () => {
  const w = 8, h = 4;
  const samples = new Uint16Array(w * h).map((_, i) => i * 1000);
  const bytes = Uint8Array.from(await encodeGray16(w, h, samples));
  assert(PNG_SIG.every((b, i) => bytes[i] === b), 'bad PNG signature');
  const width = (bytes[16] << 24 | bytes[17] << 16 | bytes[18] << 8 | bytes[19]) >>> 0;
  assert(width === w && bytes[24] === 16 && bytes[25] === 0, `IHDR width ${width}, bit depth ${bytes[24]}, colour type ${bytes[25]}`);
  return `${bytes.length} bytes`;
});

await check('albedo PNG has the signature and an 8-bit RGBA IHDR', async () => {
  const w = 4, h = 4;
  const { out } = evaluateTexturing(evaluateTerrain(SMALL, buildPreset('alpine').terrain).state, buildPreset('alpine').texturing);
  const rgba = toRGBA8({ r: out.r.subarray(0, w * h), g: out.g.subarray(0, w * h), b: out.b.subarray(0, w * h) });
  const bytes = Uint8Array.from(await encodeRGBA8(w, h, rgba));
  assert(PNG_SIG.every((b, i) => bytes[i] === b), 'bad PNG signature');
  assert(bytes[24] === 8 && bytes[25] === 6, `bit depth ${bytes[24]}, colour type ${bytes[25]}`);
  return `${bytes.length} bytes`;
});

console.log(lines.join('\n'));
console.log(failures ? `\n${failures} check(s) failed` : `\nall ${lines.length} checks passed`);
process.exit(failures ? 1 : 0);
