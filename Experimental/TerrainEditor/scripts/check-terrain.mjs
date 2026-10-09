// Headless validation of the terrain engine: noise ranges, generator and
// mask contracts, every erosion pass, the full pipeline for every preset,
// the satmap painter, blend modes and determinism.
//
//   node scripts/check-terrain.mjs   (or: npm run check)

import { fbm, ridged, billow, multifractal, voronoiF1, perlinNoise, clamp01 } from '../src/terrain/noise.js';
import { generators, generatorById, generatorDefaults } from '../src/terrain/generators.js';
import { masks, maskById, maskDefaults } from '../src/terrain/masks.js';
import { erosionTypes, erosionById, erodeHydraulic, erodeThermal, erodeFluvial, erodeAeolian, computeSlopeN } from '../src/terrain/erosion.js';
import { computeTerrain, buildMaskContext, shapeLayer, erosionLayer } from '../src/terrain/pipeline.js';
import { presets } from '../src/terrain/presets.js';
import { colorize, palettes, paletteById } from '../src/terrain/satmap.js';
import { buildImageData, mapModes, heightToGrayRGBA, hillshade } from '../src/terrain/render2d.js';

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function finite(arr) {
  for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) return false;
  return true;
}
function inRange(arr, lo, hi) {
  for (let i = 0; i < arr.length; i++) if (arr[i] < lo || arr[i] > hi) return false;
  return true;
}
function mean(arr) { let s = 0; for (const v of arr) s += v; return s / arr.length; }

console.log('noise fields');
{
  let ok = true;
  for (let y = 0; y < 64 && ok; y++) for (let x = 0; x < 64 && ok; x++) {
    const p = perlinNoise(x * 0.37, y * 0.41, 7);
    if (p < -0.05 || p > 1.05) ok = false;
  }
  check('perlin noise stays ~[0,1]', ok);
  check('fbm in [-1,1]', (() => { const s = 4096; for (let i = 0; i < s; i++) { const v = fbm(i * 0.11, i * 0.07, { octaves: 5, seed: i }); if (v < -1.001 || v > 1.001) return false; } return true; })());
  check('ridged in [0,1]', (() => { for (let i = 0; i < 2048; i++) { const v = ridged(i * 0.13, i * 0.09, { octaves: 4, seed: i }); if (v < -0.001 || v > 1.001) return false; } return true; })());
  check('billow in [-1,1]', (() => { for (let i = 0; i < 2048; i++) { const v = billow(i * 0.13, i * 0.09, { octaves: 4, seed: i }); if (v < -1.001 || v > 1.001) return false; } return true; })());
  check('multifractal finite', (() => { for (let i = 0; i < 2048; i++) { const v = multifractal(i * 0.13, i * 0.09, { octaves: 4, seed: i }); if (!Number.isFinite(v)) return false; } return true; })());
  check('voronoi finite', Number.isFinite(voronoiF1(3.7, 8.2, 42)));
}

console.log('generators');
{
  const size = 48;
  const h = new Float32Array(size * size).fill(0.4);
  const ctx = buildMaskContext(h, size, 0.2, 99);
  for (const gen of generators) {
    const params = generatorDefaults(gen.id);
    const field = new Float32Array(size * size);
    let ok = true;
    for (let y = 0; y < size && ok; y++) for (let x = 0; x < size && ok; x++) {
      const u = x / size * params.scale, v = y / size * params.scale;
      const val = gen.fn(u, v, { ...params, _size: size }, 5, x, y);
      field[y * size + x] = val;
      if (!Number.isFinite(val) || val < -1.6 || val > 1.6) ok = false;
    }
    check(`${gen.label} produces finite [-1,1]-ish field`, ok && finite(field));
  }
  // strata phase available
  const strata = generatorById('strata');
  check('strata generator exposes band phase', typeof strata.phase === 'function');
}

console.log('masks');
{
  const size = 48;
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = Math.hypot(x - size / 2, y - size / 2);
  const ctx = buildMaskContext(h, size, 40, 7);
  for (const mask of masks) {
    const params = maskDefaults(mask.id);
    let ok = true;
    for (let y = 0; y < size && ok; y++) for (let x = 0; x < size && ok; x++) {
      const v = mask.fn(ctx, x, y, params);
      if (!Number.isFinite(v) || v < -0.001 || v > 1.001) ok = false;
    }
    check(`${mask.label} mask in [0,1]`, ok);
  }
  // coastal mask must be ~0 at the water and 1 inland.
  // dome heightfield h = 60 - dist, waterLevel 50 → water ring at the rim,
  // dry land in the middle.
  const size2 = 48;
  const h2 = new Float32Array(size2 * size2);
  for (let y = 0; y < size2; y++) for (let x = 0; x < size2; x++) h2[y * size2 + x] = 60 - Math.hypot(x - size2 / 2, y - size2 / 2);
  const ctx2 = buildMaskContext(h2, size2, 50, 7);
  const params = maskDefaults('coastal');
  const coastal = maskById('coastal');
  const inWater = coastal.fn(ctx2, 2, 24, { ...params, falloff: 0.5, edge: 0.02 });
  const deepInland = coastal.fn(ctx2, 24, 24, { ...params, falloff: 0.5, edge: 0.02 });
  check('coastal mask fades at the coast', inWater < 0.5 && deepInland > 0.9, `water=${inWater.toFixed(2)} inland=${deepInland.toFixed(2)}`);
  // cliffs mask follows slope
  const cliffs = maskById('cliffs');
  const onSteep = cliffs.fn(ctx, 24, 24, { slopeMin: 0.2, slopeMax: 0.6, strength: 1 }); // center = flat (cone tip)
  check('cliffs mask low on flat ground', onSteep < 0.2, `got ${onSteep.toFixed(2)}`);
}

console.log('erosion passes');
{
  const size = 96;
  const base = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    base[y * size + x] = 0.55 + 0.35 * fbm(x / size * 6, y / size * 6, { octaves: 4, seed: 3 })
      + 0.1 * Math.sin(x * 0.4) * Math.cos(y * 0.31);
  }
  const slopeBefore = computeSlopeN(base, size);

  // hydraulic
  const hyd = erodeHydraulic(base, size, { ...erosionById('hydraulic').defaults, droplets: 12000 }, 11);
  check('hydraulic output finite', finite(hyd.height));
  check('hydraulic produces sediment', hyd.sediment.some((v) => v > 0.01));
  check('hydraulic produces water flux', hyd.flux.some((v) => v > 0.01));
  const roughBefore = mean(slopeBefore);
  const roughAfter = mean(computeSlopeN(hyd.height, size));
  check('hydraulic erosion reduces mean slope', roughAfter < roughBefore, `${roughBefore.toFixed(4)} → ${roughAfter.toFixed(4)}`);

  // thermal
  const therm = erodeThermal(base, size, { ...erosionById('thermal').defaults, iterations: 40 }, 5);
  const tRoughAfter = mean(computeSlopeN(therm.height, size));
  check('thermal erosion reduces mean slope', tRoughAfter < roughBefore, `${roughBefore.toFixed(4)} → ${tRoughAfter.toFixed(4)}`);
  check('thermal moves material (sediment map)', therm.sediment.some((v) => v > 0));

  // fluvial
  const fluv = erodeFluvial(base, size, { ...erosionById('fluvial').defaults, passes: 2 }, 9);
  check('fluvial carves (mean height drops)', mean(fluv.height) < mean(base));
  check('fluvial produces rivers flux', fluv.flux.some((v) => v > 0.3));
  check('fluvial deposits alluvium', fluv.sediment.some((v) => v > 0.01));

  // aeolian
  const aeol = erodeAeolian(base, size, { ...erosionById('aeolian').defaults, iterations: 20 }, 13);
  check('aeolian output finite and changed', finite(aeol.height) && aeol.height.some((v, i) => v !== base[i]));
  check('aeolian tracks sand (sediment)', aeol.sediment.some((v) => v > 0.01));
}

console.log('pipeline: default stack + presets');
{
  const runPreset = (preset) => computeTerrain({
    layers: preset.layers(),
    size: 96,
    seed: preset.terrain.seed,
    waterLevel: preset.terrain.waterLevel,
    budget: 0.08,
  });

  const defaultStack = [
    shapeLayer('Base', 'multifractal', { amplitude: 700, scale: 7 }),
    erosionLayer('Rain', 'hydraulic', { droplets: 20000 }),
  ];
  const def = computeTerrain({ layers: defaultStack, size: 96, seed: 42, waterLevel: 90, budget: 0.08 });
  check('default stack: finite height', finite(def.height));
  check('default stack: has relief', def.max - def.min > 100, `range=${(def.max - def.min).toFixed(0)} m`);
  check('default stack: channels in [0,1]',
    inRange(def.heightN, 0, 1) && inRange(def.rivers, 0, 1) && inRange(def.sediment, 0, 1) && inRange(def.strata, 0, 1));
  check('default stack: water level normalized', def.waterN >= 0 && def.waterN <= 1);

  for (const preset of presets) {
    const res = runPreset(preset);
    const okFinite = finite(res.height) && finite(res.heightN) && finite(res.rivers) && finite(res.sediment);
    const okRelief = res.max - res.min > 20;
    const okChannels = inRange(res.rivers, 0, 1) && inRange(res.sediment, 0, 1) && inRange(res.strata, 0, 1);
    check(`preset "${preset.label}": finite + relief + channels`, okFinite && okRelief && okChannels,
      `range=${(res.max - res.min).toFixed(0)} m`);

    // satmap paint for the preset
    const rgba = colorize(res, preset.palette, preset.terrain.seed);
    let okPixels = rgba.length === res.size * res.size * 4;
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) { okPixels = false; break; }
    check(`preset "${preset.label}": satmap RGBA valid`, okPixels);

    // every map mode renders
    for (const mode of mapModes) {
      const img = buildImageData(mode.id, res, preset.palette, preset.terrain.seed);
      if (!finite(img)) { check(`preset "${preset.label}" mode ${mode.id}`, false); break; }
      if (mode.id === mapModes[mapModes.length - 1].id) check(`preset "${preset.label}": all map modes render`, true);
    }
  }

  // determinism
  const a = computeTerrain({ layers: defaultStack, size: 64, seed: 77, waterLevel: 50, budget: 0.08 });
  const b = computeTerrain({ layers: defaultStack, size: 64, seed: 77, waterLevel: 50, budget: 0.08 });
  let same = true;
  for (let i = 0; i < a.height.length; i++) if (a.height[i] !== b.height[i]) { same = false; break; }
  check('same seed → identical heightmap', same);

  // disabled layers are skipped
  const only = computeTerrain({ layers: [shapeLayer('A', 'perlin', { amplitude: 300 }), { ...shapeLayer('B', 'perlin', { amplitude: 900 }), enabled: false }], size: 64, seed: 5, waterLevel: 0 });
  const single = computeTerrain({ layers: [shapeLayer('A', 'perlin', { amplitude: 300 })], size: 64, seed: 5, waterLevel: 0 });
  let sameSingle = true;
  for (let i = 0; i < only.height.length; i++) if (Math.abs(only.height[i] - single.height[i]) > 1e-4) { sameSingle = false; break; }
  check('disabled layer contributes nothing', sameSingle);

  // blend modes
  const add = computeTerrain({ layers: [shapeLayer('A', 'perlin', { amplitude: 300 })], size: 64, seed: 5, waterLevel: 0 });
  const sub = computeTerrain({ layers: [{ ...shapeLayer('A', 'perlin', { amplitude: 300 }), blend: 'subtract' }], size: 64, seed: 5, waterLevel: 0 });
  let mirrored = true;
  for (let i = 0; i < add.height.length; i++) if (Math.abs(add.height[i] + sub.height[i]) > 1e-3) { mirrored = false; break; }
  check('subtract blend mirrors add blend', mirrored);
}

console.log('satmap + export buffers');
{
  const palIds = palettes.map((p) => p.id);
  check('six palettes defined', palIds.length === 6, palIds.join(','));
  for (const id of palIds) {
    const pal = paletteById(id);
    check(`palette ${id} has all channels`, ['deep', 'shallow', 'sand', 'grass', 'forest', 'rock', 'scree', 'snow', 'river', 'sediment', 'strataA', 'strataB'].every((k) => Array.isArray(pal[k])));
  }
  const size = 32;
  const data = {
    size, waterN: 0.3,
    heightN: new Float32Array(size * size).fill(0.5),
    slopeN: new Float32Array(size * size).fill(0.2),
    rivers: new Float32Array(size * size).fill(0.4),
    sediment: new Float32Array(size * size).fill(0.4),
    strata: new Float32Array(size * size).fill(0.6),
    strataPhase: new Float32Array(size * size).fill(0.5),
  };
  const gray = heightToGrayRGBA(data.heightN, size);
  check('heightmap export buffer valid', gray.length === size * size * 4 && inRange(gray, 0, 255));
  const shade = hillshade(data.heightN, size);
  check('hillshade in [0,1]', inRange(shade, 0, 1.01));
  const img = buildImageData('satmap', { ...data, strata: new Float32Array(size * size).fill(0) }, 'temperate', 1);
  check('satmap buffer length', img.length === size * size * 4);
  check('clamp01 helper', clamp01(2) === 1 && clamp01(-2) === 0);
}

console.log('erosion registry');
{
  check('four erosion types', erosionTypes.length === 4, erosionTypes.map((e) => e.id).join(','));
  for (const type of erosionTypes) {
    check(`${type.label} has sliders + defaults + runner`,
      Array.isArray(type.params) && type.params.length >= 3 && typeof type.defaults === 'object' && typeof type.run === 'function');
  }
}

console.log(failures === 0 ? '\nAll terrain checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
