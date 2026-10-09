/**
 * Frontier Landscape Studio — engine verification.
 *
 * Runs the real bake pipeline in Node (no browser needed) and asserts that each
 * erosion process does what it claims, that the layer stack composes, and that
 * the surface texture pipeline produces usable imagery. Writes hillshaded PNGs
 * of the results so the output can be inspected visually as well as numerically.
 *
 *   node scripts/verify-core.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import zlib from 'node:zlib';

import { bakeStack, defaultLayers, createLayer, evaluateLayer, blendField, erosionLayerParams } from '../src/core/layers.js';
import { runErosion, EROSION_TYPES, erosionDefaults, slopeField, flowAccumulation, normalizeFlow, waterMask, fillSinks } from '../src/core/erosion.js';

/** Minimal chamfer distance transform, mirroring the one inside the engine. */
function distanceFromShore(seedMask, res) {
  const INF = 1e9;
  const d = new Float32Array(res * res);
  for (let i = 0; i < d.length; i++) d[i] = seedMask[i] ? 0 : INF;
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    const i = y * res + x; let b = d[i];
    if (x > 0) b = Math.min(b, d[i - 1] + 1);
    if (y > 0) b = Math.min(b, d[i - res] + 1);
    if (x > 0 && y > 0) b = Math.min(b, d[i - res - 1] + 1.4142);
    if (x < res - 1 && y > 0) b = Math.min(b, d[i - res + 1] + 1.4142);
    d[i] = b;
  }
  for (let y = res - 1; y >= 0; y--) for (let x = res - 1; x >= 0; x--) {
    const i = y * res + x; let b = d[i];
    if (x < res - 1) b = Math.min(b, d[i + 1] + 1);
    if (y < res - 1) b = Math.min(b, d[i + res] + 1);
    if (x < res - 1 && y < res - 1) b = Math.min(b, d[i + res + 1] + 1.4142);
    if (x > 0 && y < res - 1) b = Math.min(b, d[i + res - 1] + 1.4142);
    d[i] = b;
  }
  return d;
}
import { bakeSurfaceTexture, defaultTextureLayers, createSatmapLayer, detailNormalTexture, rampColor, RAMPS } from '../src/core/textures.js';
import { dab, stroke, emptyDelta, resampleField, falloffAt } from '../src/core/brush.js';
import { Perlin, fbm, ridged, cellular } from '../src/core/noise.js';
import { defaultProject } from '../src/core/project.js';

const OUT = new URL('../.verify/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}
const section = (t) => console.log(`\n— ${t} —`);

/* ------------------------------------------------------------ tiny PNG writer */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function writePng(path, width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy ? rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
      : Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
  return png.length;
}

/** Hillshade a height field the way the viewport lights it, for inspection. */
function hillshade(height, res, azimuthDeg = 315, altitudeDeg = 45, albedo = null) {
  const out = Buffer.alloc(res * res * 4);
  const az = (azimuthDeg * Math.PI) / 180, alt = (altitudeDeg * Math.PI) / 180;
  const lx = Math.cos(alt) * Math.sin(az), ly = Math.cos(alt) * Math.cos(az), lz = Math.sin(alt);
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const xm = Math.max(0, x - 1), xp = Math.min(res - 1, x + 1);
      const ym = Math.max(0, y - 1), yp = Math.min(res - 1, y + 1);
      const gx = (height[y * res + xp] - height[y * res + xm]) / (xp - xm || 1);
      const gy = (height[yp * res + x] - height[ym * res + x]) / (yp - ym || 1);
      const scale = res * 0.35;
      let nx = -gx * scale, ny = -gy * scale, nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const ndl = Math.max(0, nx * lx + ny * ly + nz * lz);
      const shade = 0.3 + ndl * 1.15;
      const i = y * res + x;
      const o = i * 4;
      if (albedo) {
        out[o] = clamp255(albedo[o] * shade);
        out[o + 1] = clamp255(albedo[o + 1] * shade);
        out[o + 2] = clamp255(albedo[o + 2] * shade);
      } else {
        const g = clamp255(height[i] * 235 * shade + 18);
        out[o] = clamp255(g * 0.96);
        out[o + 1] = g;
        out[o + 2] = clamp255(g * 1.06);
      }
      out[o + 3] = 255;
    }
  }
  return out;
}
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

function fieldToBuffer(field, res, ramp = null) {
  const out = Buffer.alloc(res * res * 4);
  for (let i = 0; i < res * res; i++) {
    const v = Math.max(0, Math.min(1, field[i]));
    const [r, g, b] = ramp ? rampColor(ramp, v) : [v * 255, v * 255, v * 255];
    out[i * 4] = clamp255(r);
    out[i * 4 + 1] = clamp255(g);
    out[i * 4 + 2] = clamp255(b);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/* ------------------------------------------------------------- field metrics */

function metrics(h) {
  let min = Infinity, max = -Infinity, sum = 0;
  for (let i = 0; i < h.length; i++) {
    if (!Number.isFinite(h[i])) return { finite: false };
    if (h[i] < min) min = h[i];
    if (h[i] > max) max = h[i];
    sum += h[i];
  }
  return { finite: true, min, max, mean: sum / h.length, range: max - min };
}

function meanSlope(h, res) {
  const s = slopeField(h, res);
  let sum = 0, max = 0;
  for (let i = 0; i < s.length; i++) { sum += s[i]; if (s[i] > max) max = s[i]; }
  return { mean: sum / s.length, max };
}

/**
 * Drainage diagnostics. Two signatures of a properly incised landscape:
 *  · pits — cells lower than every neighbour, where flow dead-ends. Erosion
 *    fills these, so a real hydraulic pass must reduce them sharply.
 *  · peak accumulation — how much water the most integrated channel delivers.
 *    A connected network raises it; a pitted surface scatters it.
 */
function drainageDiagnostics(h, res) {
  let pits = 0;
  for (let y = 1; y < res - 1; y++) {
    for (let x = 1; x < res - 1; x++) {
      const i = y * res + x;
      let lowest = true;
      for (let oy = -1; oy <= 1 && lowest; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          if (h[i + oy * res + ox] <= h[i]) { lowest = false; break; }
        }
      }
      if (lowest) pits++;
    }
  }
  const filled = fillSinks(h, res);
  const accum = flowAccumulation(h, res, filled);
  let max = 0, total = 0, channels = 0;
  for (let i = 0; i < accum.length; i++) {
    if (accum[i] > max) max = accum[i];
    total += accum[i];
  }
  const channelThreshold = Math.max(20, max * 0.05);
  for (let i = 0; i < accum.length; i++) if (accum[i] > channelThreshold) channels++;

  // Incision: how far the main channels sit below their own surroundings. Once
  // sinks are filled every island already drains to one outlet, so peak
  // accumulation says nothing — channel depth is what carving actually means.
  const channelCells = [];
  for (let i = 0; i < accum.length; i++) if (accum[i] > max * 0.02) channelCells.push(i);
  let depthSum = 0;
  for (const i of channelCells) {
    const x = i % res, y = (i / res) | 0;
    if (x < 3 || y < 3 || x >= res - 3 || y >= res - 3) continue;
    let ring = 0, count = 0;
    for (let oy = -3; oy <= 3; oy++) {
      for (let ox = -3; ox <= 3; ox++) {
        const d = Math.hypot(ox, oy);
        if (d < 2 || d > 3.2) continue;
        ring += h[(y + oy) * res + (x + ox)];
        count++;
      }
    }
    if (count) depthSum += (ring / count) - h[i];
  }
  const incision = channelCells.length ? depthSum / channelCells.length : 0;

  return { pits, maxAccum: max, total, channels, channelThreshold, incision, channelCells: channelCells.length };
}

/* ------------------------------------------------------------------ run tests */

const RES = 193;
console.log(`Frontier Landscape Studio — engine verification at ${RES}²\n`);

section('Noise');
{
  const perlin = new Perlin(1234);
  const a = fbm(perlin, 0.31, 0.77, 6, 2, 0.5);
  const b = fbm(new Perlin(1234), 0.31, 0.77, 6, 2, 0.5);
  check('noise is deterministic for a seed', a === b, `${a} vs ${b}`);
  const c = fbm(new Perlin(9999), 0.31, 0.77, 6, 2, 0.5);
  check('different seeds differ', a !== c);
  let min = 1, max = 0;
  for (let i = 0; i < 4000; i++) {
    const v = fbm(perlin, (i % 63) * 0.37, ((i / 63) | 0) * 0.41, 6, 2, 0.5);
    if (v < min) min = v; if (v > max) max = v;
  }
  check('fbm stays inside [0,1]', min >= 0 && max <= 1, `${min.toFixed(3)}..${max.toFixed(3)}`);
  check('fbm actually varies', max - min > 0.3, `range ${(max - min).toFixed(3)}`);
  let rmin = 1, rmax = 0;
  for (let i = 0; i < 3000; i++) {
    const v = ridged(perlin, (i % 55) * 0.29, ((i / 55) | 0) * 0.33, 5, 2, 0.5, 1.5);
    if (v < rmin) rmin = v; if (v > rmax) rmax = v;
  }
  check('ridged stays inside [0,1]', rmin >= 0 && rmax <= 1, `${rmin.toFixed(3)}..${rmax.toFixed(3)}`);
  const cell = cellular(3.4, 7.8, 12, 0);
  check('cellular is finite and bounded', Number.isFinite(cell) && cell >= 0 && cell <= 1, String(cell));
}

section('Default layer stack bakes');
let baked;
{
  const layers = defaultLayers();
  check('default stack has at least 8 layers', layers.length >= 8, `n=${layers.length}`);
  const start = Date.now();
  baked = bakeStack(layers, RES, { captureBefore: layers.filter((l) => l.type === 'brush').map((l) => l.id) });
  const ms = Date.now() - start;
  const m = metrics(baked.height);
  check('height field is finite everywhere', m.finite);
  check('height field uses the range', m.range > 0.25, `range=${m.range.toFixed(3)}`);
  check('height stays inside [0,1]', m.min >= -1e-6 && m.max <= 1 + 1e-6, `${m.min.toFixed(4)}..${m.max.toFixed(4)}`);
  check('stack bakes in reasonable time', ms < 30000, `${ms} ms`);
  check('captures the pre-brush surface', Object.keys(baked.captures || {}).length === 1);
  check('reports erosion diagnostics', baked.eroded.length === RES * RES && baked.deposited.length === RES * RES);
  check('flow accumulation is normalized', metrics(baked.flowNorm).max <= 1.0001, metrics(baked.flowNorm).max.toFixed(4));
  writeFileSync(`${OUT}core-01-default-stack.png`, '');
  writePng(`${OUT}core-01-default-stack.png`, RES, RES, hillshade(baked.height, RES));
}

section('Blend modes');
{
  const base = new Float32Array([0.5, 0.5, 0.5, 0.5]);
  const layer = new Float32Array([1.0, 0.0, 0.5, 0.25]);
  const cases = [
    // base 0.5 everywhere, layer [1, 0, 0.5, 0.25]
    ['replace', 1, [1, 0, 0.5, 0.25]],
    ['replace', 0.5, [0.75, 0.25, 0.5, 0.375]],
    ['add', 1, [1.5, 0.5, 1, 0.75]],
    ['subtract', 1, [-0.5, 0.5, 0, 0.25]],
    ['multiply', 1, [0.5, 0, 0.25, 0.125]],
    ['screen', 1, [1, 0.5, 0.75, 0.625]],
    ['min', 1, [0.5, 0, 0.5, 0.25]],
    ['max', 1, [1, 0.5, 0.5, 0.5]],
    ['average', 1, [0.75, 0.25, 0.5, 0.375]],
    ['difference', 1, [0.5, 0.5, 0, 0.25]],
  ];
  for (const [mode, opacity, expected] of cases) {
    const out = new Float32Array(base);
    blendField(out, layer, mode, opacity);
    const ok = expected.every((e, i) => Math.abs(e - out[i]) < 1e-6);
    check(`blend ${mode} @${opacity}`, ok, `got [${Array.from(out).map((v) => v.toFixed(3)).join(',')}] want [${expected.join(',')}]`);
  }
  const half = new Float32Array(base);
  blendField(half, layer, 'replace', 0);
  check('opacity 0 is a no-op', half.every((v, i) => Math.abs(v - base[i]) < 1e-9));
}

section('Every layer type produces a usable field');
{
  const ids = ['base', 'noise', 'cellular', 'island', 'cone', 'terrace', 'ramp', 'smooth', 'sharpen', 'flatten', 'normalize', 'brush', 'import'];
  const input = new Float32Array(RES * RES);
  for (let i = 0; i < input.length; i++) input[i] = 0.5 + 0.3 * Math.sin(i * 0.001);
  for (const id of ids) {
    const layer = createLayer(id);
    if (id === 'brush') {
      const f = emptyDelta(RES);
      dab(f, input, RES, { x: RES / 2, y: RES / 2, radius: 14, strength: 0.2, mode: 'raise', falloff: 0.6 });
      var field = evaluateLayer(id, layer.params, RES, input, { brushField: f });
    } else if (id === 'import') {
      var field = evaluateLayer(id, layer.params, RES, input, { imported: input });
    } else {
      var field = evaluateLayer(id, layer.params, RES, input, {});
    }
    const m = metrics(field);
    check(`${id} layer is finite`, m.finite);
    check(`${id} layer has variation`, m.range > 0.001, `range=${m.range.toFixed(4)}`);
  }
}

section('Erosion processes');
const erosionResults = {};
for (const type of EROSION_TYPES) {
  const before = new Float32Array(baked.height);
  const work = new Float32Array(before);
  const params = erosionDefaults(type.id);
  // Keep the verification quick without changing what is being measured.
  if (type.id === 'hydraulic') params.droplets = 70000;
  if (type.id === 'glacial') params.iterations = 12;
  if (type.id === 'rainfall') params.iterations = 30;
  if (type.id === 'wind') params.iterations = 40;
  if (type.id === 'coastal') params.iterations = 20;
  if (type.id === 'thermal') params.iterations = 60;

  const start = Date.now();
  const ASPECT = (2048 / (RES - 1)) / 900;   // cellSize / maxHeight, as the editor computes it
  const result = runErosion(type.id, work, RES, params, { strength: 1, seed: 7, aspect: ASPECT, verticalScale: 1 });
  const ms = Date.now() - start;
  erosionResults[type.id] = { before, after: work, result, params, ms };

  const m = metrics(work);
  check(`${type.id}: finite output`, m.finite);
  check(`${type.id}: stays in range`, m.min >= -1e-6 && m.max <= 1.0001, `${m.min.toFixed(4)}..${m.max.toFixed(4)}`);
  check(`${type.id}: actually moved material`, result.moved > 1e-5, `moved=${result.moved.toExponential(2)}`);
  check(`${type.id}: recorded erosion map`, result.maps.eroded.some((v) => v > 0));
  check(`${type.id}: recorded deposition map`, result.maps.deposited.some((v) => v > 0));
  // Hydraulic, thermal and coastal move material around the map and must
  // conserve it. Aeolian drift and glacial scour genuinely export sediment.
  const TOLERANCE = { wind: 0.3, glacial: 0.2 };
  const tolerance = TOLERANCE[type.id] ?? 0.06;
  check(`${type.id}: mass is conserved within ${Math.round(tolerance * 100)}%`, (() => {
    const a = before.reduce((s, v) => s + v, 0);
    const b = work.reduce((s, v) => s + v, 0);
    return Math.abs(a - b) / Math.max(1e-9, a) < tolerance;
  })(), `${(before.reduce((s, v) => s + v, 0) / work.reduce((s, v) => s + v, 0)).toFixed(4)}x`);

  writePng(`${OUT}core-10-erosion-${type.id}.png`, RES, RES, hillshade(work, RES));
  const delta = new Float32Array(RES * RES);
  for (let i = 0; i < delta.length; i++) delta[i] = 0.5 + (work[i] - before[i]) * 900;
  writePng(`${OUT}core-11-delta-${type.id}.png`, RES, RES, fieldToBuffer(delta, RES, RAMPS.erosion));
}

section('Erosion behaves physically');
{
  // Hydraulic erosion must integrate the drainage network: sinks get filled and
  // the largest channel ends up carrying more water than before.
  const hyd = erosionResults.hydraulic;
  const hydBefore = drainageDiagnostics(hyd.before, RES);
  const hydAfter = drainageDiagnostics(hyd.after, RES);
  check('hydraulic erosion does not shatter the surface into sinks', hydAfter.pits < hydBefore.pits * 1.35,
    `${hydBefore.pits} → ${hydAfter.pits} pits`);
  check('hydraulic erosion incises its channels deeper', hydAfter.incision > hydBefore.incision,
    `channel depth below surrounding ground ${(hydBefore.incision * 1000).toFixed(2)} → ${(hydAfter.incision * 1000).toFixed(2)} (×10⁻³)`);
  check('hydraulic erosion lengthens the channel network', hydAfter.channels > hydBefore.channels,
    `${hydBefore.channels} → ${hydAfter.channels} cells above ${hydAfter.channelThreshold.toFixed(0)} accumulation`);

  const slopeBefore = meanSlope(hyd.before, RES);
  const slopeAfter = meanSlope(hyd.after, RES);
  check('hydraulic erosion incises channels (max slope rises)', slopeAfter.max >= slopeBefore.max * 0.8,
    `max slope ${slopeBefore.max.toFixed(4)} → ${slopeAfter.max.toFixed(4)}`);

  // Thermal erosion must relax slopes towards the angle of repose.
  const th = erosionResults.thermal;
  const thBefore = meanSlope(th.before, RES);
  const thAfter = meanSlope(th.after, RES);
  check('thermal erosion reduces mean slope', thAfter.mean < thBefore.mean,
    `${thBefore.mean.toFixed(5)} → ${thAfter.mean.toFixed(5)}`);
  check('thermal erosion reduces the steepest slope', thAfter.max < thBefore.max,
    `${thBefore.max.toFixed(4)} → ${thAfter.max.toFixed(4)}`);
  check('thermal erosion leaves a talus map', th.result.maps.talus.some((v) => v > 0));

  // Wind must transport material along its bearing. The unambiguous signature
  // is that the deposition centroid migrates downwind relative to the erosion
  // centroid: sand is picked up here and dropped further along the wind vector.
  const wind = erosionResults.wind;
  const bearing = (wind.params.direction * Math.PI) / 180;
  const wx = Math.sin(bearing), wy = -Math.cos(bearing);
  const centroid = (field) => {
    let total = 0, projected = 0;
    for (let y = 0; y < RES; y++) {
      for (let x = 0; x < RES; x++) {
        const v = field[y * RES + x];
        if (v <= 0) continue;
        total += v;
        projected += v * (((x - RES / 2) * wx + (y - RES / 2) * wy) / RES);
      }
    }
    return total > 0 ? projected / total : 0;
  };
  const erosionCentroid = centroid(wind.result.maps.eroded);
  const depositionCentroid = centroid(wind.result.maps.deposited);
  check('wind moves its deposition centroid downwind', depositionCentroid > erosionCentroid,
    `erosion centroid ${erosionCentroid.toFixed(4)} → deposition centroid ${depositionCentroid.toFixed(4)} (positive is downwind)`);
  check('wind drift is measurably directional', Math.abs(depositionCentroid - erosionCentroid) > 1e-3,
    `shift ${(depositionCentroid - erosionCentroid).toFixed(4)}`);

  // Rainfall must build a channel network too.
  const rain = erosionResults.rainfall;
  check('rainfall builds flow accumulation', rain.result.maps.flow.some((v) => v > 0));
  check('rainfall records detachment', rain.result.maps.eroded.some((v) => v > 0));
  check('rainfall records deposition', rain.result.maps.deposited.some((v) => v > 0));
  const rainBefore = drainageDiagnostics(rain.before, RES);
  const rainAfter = drainageDiagnostics(rain.after, RES);
  check('sheet wash does not create new sinks', rainAfter.pits <= rainBefore.pits * 1.15,
    `${rainBefore.pits} → ${rainAfter.pits} pits`);

  // Coastal erosion must attack the shore band, not the inland interior. The
  // band is measured across the ground (a distance transform), matching how the
  // process itself decides where waves can reach.
  const coast = erosionResults.coastal;
  const level = coast.params.seaLevel;
  const shoreSeed = new Uint8Array(RES * RES);
  for (let i = 0; i < shoreSeed.length; i++) if (Math.abs(coast.before[i] - level) < 0.012) shoreSeed[i] = 1;
  const dist = distanceFromShore(shoreSeed, RES);
  const band = coast.params.band;
  let inBand = 0, outside = 0, inBandCells = 0, outsideCells = 0;
  for (let i = 0; i < coast.before.length; i++) {
    const e = coast.result.maps.eroded[i];
    if (dist[i] <= band) { inBand += e; inBandCells++; }
    else { outside += e; outsideCells++; }
  }
  const perIn = inBand / Math.max(1, inBandCells);
  const perOut = outside / Math.max(1, outsideCells);
  check('coastal erosion concentrates inside the wave band', perIn > perOut * 1.5,
    `per-cell erosion ${(perIn * 1e4).toFixed(2)} in-band vs ${(perOut * 1e4).toFixed(2)} inland (×10⁻⁴)`);

  // Glacial erosion must follow the drainage network.
  const gl = erosionResults.glacial;
  check('glacial erosion recorded scour', gl.result.maps.eroded.some((v) => v > 0));
  check('glacial erosion left a flow map', gl.result.maps.flow.some((v) => v > 0));
  check('glacial erosion deposits till / moraine', gl.result.maps.deposited.some((v) => v > 0));
  check('glacial erosion leaves a debris map', gl.result.maps.talus.some((v) => v > 0));
}

section('Strength and seeds');
{
  const zero = new Float32Array(baked.height);
  const ASPECT2 = (2048 / (RES - 1)) / 900;
  runErosion('hydraulic', zero, RES, erosionDefaults('hydraulic'), { strength: 0, seed: 3, aspect: ASPECT2, maps: { eroded: new Float32Array(RES * RES), deposited: new Float32Array(RES * RES), flow: new Float32Array(RES * RES), water: new Float32Array(RES * RES), talus: new Float32Array(RES * RES) } });
  check('strength 0 leaves the surface untouched', zero.every((v, i) => Math.abs(v - baked.height[i]) < 1e-9));

  const seedA = new Float32Array(baked.height);
  const seedB = new Float32Array(baked.height);
  const seedA2 = new Float32Array(baked.height);
  const p = { ...erosionDefaults('hydraulic'), droplets: 9000 };
  const mk = () => ({ eroded: new Float32Array(RES * RES), deposited: new Float32Array(RES * RES), flow: new Float32Array(RES * RES), water: new Float32Array(RES * RES), talus: new Float32Array(RES * RES) });
  runErosion('hydraulic', seedA, RES, p, { strength: 1, seed: 11, aspect: ASPECT2, maps: mk() });
  runErosion('hydraulic', seedB, RES, p, { strength: 1, seed: 22, aspect: ASPECT2, maps: mk() });
  runErosion('hydraulic', seedA2, RES, p, { strength: 1, seed: 11, aspect: ASPECT2, maps: mk() });
  let diffSeeds = 0, sameSeeds = 0;
  for (let i = 0; i < seedA.length; i++) {
    if (Math.abs(seedA[i] - seedB[i]) > 1e-9) diffSeeds++;
    if (Math.abs(seedA[i] - seedA2[i]) > 1e-9) sameSeeds++;
  }
  check('different seeds give different results', diffSeeds > RES * RES * 0.2, `${diffSeeds} cells differ`);
  check('the same seed reproduces exactly', sameSeeds === 0, `${sameSeeds} cells differ`);
}

section('Surface texturing');
let albedo;
{
  const slope = slopeField(baked.height, RES);
  const flow = normalizeFlow(flowAccumulation(baked.height, RES));
  const talus = erosionResults.thermal.result.maps.talus;
  const layers = [...defaultTextureLayers(), { ...createSatmapLayer(), enabled: false }];

  const texSize = 384;
  const start = Date.now();
  const out = bakeSurfaceTexture({
    res: RES, heightField: baked.height, slopeField: slope, flowField: flow, talusField: talus,
    layers, size: texSize, seaLevel: 0.2, seed: 4821,
  });
  const ms = Date.now() - start;
  albedo = Buffer.from(out.data.buffer, out.data.byteOffset, out.data.byteLength);

  check('albedo has the right size', out.data.length === texSize * texSize * 4, `${out.data.length}`);
  check('albedo is not a single flat colour', (() => {
    const seen = new Set();
    for (let i = 0; i < out.data.length; i += 4 * 37) seen.add(`${out.data[i]},${out.data[i + 1]},${out.data[i + 2]}`);
    return seen.size > 400;
  })());
  check('albedo is fully opaque', (() => {
    for (let i = 3; i < out.data.length; i += 4) if (out.data[i] > 255) return false;
    return true;
  })());
  check('smoothness channel varies (not a constant)', (() => {
    let min = 255, max = 0;
    for (let i = 3; i < out.data.length; i += 4 * 11) { if (out.data[i] < min) min = out.data[i]; if (out.data[i] > max) max = out.data[i]; }
    return max - min > 8;
  })());
  check(`splat bake is fast enough (${ms} ms at ${texSize}²)`, ms < 20000);

  const opaqueAlbedo = Buffer.from(albedo);
  for (let i = 3; i < opaqueAlbedo.length; i += 4) opaqueAlbedo[i] = 255;
  writePng(`${OUT}core-20-splat-albedo.png`, texSize, texSize, opaqueAlbedo);
  writePng(`${OUT}core-21-splat-lit.png`, RES, RES, hillshade(baked.height, RES, 315, 45, (() => {
    // Resample the albedo down to grid resolution for a lit composite.
    const buf = Buffer.alloc(RES * RES * 4);
    for (let y = 0; y < RES; y++) {
      for (let x = 0; x < RES; x++) {
        const sx = Math.min(texSize - 1, Math.round((x / (RES - 1)) * (texSize - 1)));
        const sy = Math.min(texSize - 1, Math.round((y / (RES - 1)) * (texSize - 1)));
        const s = (sy * texSize + sx) * 4, d = (y * RES + x) * 4;
        buf[d] = albedo[s]; buf[d + 1] = albedo[s + 1]; buf[d + 2] = albedo[s + 2]; buf[d + 3] = 255;
      }
    }
    return buf;
  })()));

  // Satellite drape.
  const withSat = [...defaultTextureLayers(), { ...createSatmapLayer(), enabled: true }];
  const sat = bakeSurfaceTexture({
    res: RES, heightField: baked.height, slopeField: slope, flowField: flow, talusField: talus,
    layers: withSat, size: texSize, seaLevel: 0.2, seed: 4821,
  });
  let differing = 0;
  for (let i = 0; i < sat.data.length; i += 4) {
    if (Math.abs(sat.data[i] - out.data[i]) > 3 || Math.abs(sat.data[i + 1] - out.data[i + 1]) > 3) differing++;
  }
  check('satellite drape changes the surface', differing > sat.data.length / 4 * 0.4,
    `${((differing / (sat.data.length / 4)) * 100).toFixed(1)}% of texels differ`);
  const opaqueSat = Buffer.from(sat.data.buffer, sat.data.byteOffset, sat.data.byteLength);
  for (let i = 3; i < opaqueSat.length; i += 4) opaqueSat[i] = 255;
  writePng(`${OUT}core-22-satmap-procedural.png`, texSize, texSize, opaqueSat);

  // A zero-opacity drape must fall back to the splat result exactly.
  const off = [...defaultTextureLayers(), (() => { const l = createSatmapLayer(); l.enabled = true; l.params.opacity = 0; return l; })()];
  const offOut = bakeSurfaceTexture({
    res: RES, heightField: baked.height, slopeField: slope, flowField: flow, talusField: talus,
    layers: off, size: 128, seaLevel: 0.2, seed: 4821,
  });
  const baseSmall = bakeSurfaceTexture({
    res: RES, heightField: baked.height, slopeField: slope, flowField: flow, talusField: talus,
    layers: [...defaultTextureLayers(), { ...createSatmapLayer(), enabled: false }], size: 128, seaLevel: 0.2, seed: 4821,
  });
  let drift = 0;
  for (let i = 0; i < offOut.data.length; i += 4) if (Math.abs(offOut.data[i] - baseSmall.data[i]) > 1) drift++;
  check('a zero-opacity drape is a no-op', drift < offOut.data.length / 4 * 0.02, `${drift} texels drifted`);

  // Imported-image path: feed a synthetic satellite tile.
  const imgSize = 64;
  const imgData = new Uint8Array(imgSize * imgSize * 4);
  for (let y = 0; y < imgSize; y++) {
    for (let x = 0; x < imgSize; x++) {
      const i = (y * imgSize + x) * 4;
      imgData[i] = (x * 4) % 256; imgData[i + 1] = (y * 4) % 256; imgData[i + 2] = 128; imgData[i + 3] = 255;
    }
  }
  const importedLayer = createSatmapLayer();
  importedLayer.enabled = true;
  importedLayer.params.source = 'image';
  importedLayer.params.image = { width: imgSize, height: imgSize, data: Array.from(imgData) };
  importedLayer.params.opacity = 1;
  importedLayer.params.slopeProtect = 0;
  const importedOut = bakeSurfaceTexture({
    res: RES, heightField: baked.height, slopeField: slope, flowField: flow, talusField: talus,
    layers: [...defaultTextureLayers(), importedLayer], size: 128, seaLevel: 0.2, seed: 4821,
  });
  let red = 0;
  for (let i = 0; i < importedOut.data.length; i += 4) if (importedOut.data[i] > 150) red++;
  check('imported satellite image is sampled', red > importedOut.data.length / 4 * 0.1,
    `${((red / (importedOut.data.length / 4)) * 100).toFixed(1)}% of texels carry the image's red ramp`);
}

section('Detail normals');
{
  const detail = detailNormalTexture(128, 7);
  check('detail texture has the right size', detail.data.length === 128 * 128 * 4);
  let zSum = 0, varied = new Set();
  for (let i = 0; i < detail.data.length; i += 4) {
    zSum += detail.data[i + 2];
    varied.add(`${detail.data[i] >> 2},${detail.data[i + 1] >> 2}`);
  }
  check('detail normals point mostly up', zSum / (detail.data.length / 4) > 200, `mean z ${(zSum / (detail.data.length / 4)).toFixed(1)}`);
  check('detail normals vary across the tile', varied.size > 60, `unique=${varied.size}`);
}

section('Brushes');
{
  const base = new Float32Array(RES * RES).fill(0.4);
  const delta = emptyDelta(RES);
  dab(delta, base, RES, { x: RES / 2, y: RES / 2, radius: 18, strength: 0.25, mode: 'raise', falloff: 0.5 });
  const centre = delta[(RES / 2 | 0) * RES + (RES / 2 | 0)];
  const edge = delta[0];
  check('raise lifts the centre', centre > 0.05, `centre=${centre.toFixed(4)}`);
  check('raise leaves the outside untouched', Math.abs(edge) < 1e-9, `edge=${edge}`);

  const lower = emptyDelta(RES);
  dab(lower, base, RES, { x: RES / 2, y: RES / 2, radius: 18, strength: 0.25, mode: 'lower', falloff: 0.5 });
  check('lower cuts the centre', lower[(RES / 2 | 0) * RES + (RES / 2 | 0)] < -0.05);

  const flat = emptyDelta(RES);
  for (let i = 0; i < 40; i++) dab(flat, base, RES, { x: RES / 2, y: RES / 2, radius: 18, strength: 0.4, mode: 'flatten', falloff: 0.4, level: 0.7 });
  const flatCentre = base[(RES / 2 | 0) * RES + (RES / 2 | 0)] + flat[(RES / 2 | 0) * RES + (RES / 2 | 0)];
  check('flatten converges on its target level', Math.abs(flatCentre - 0.7) < 0.02, `level=${flatCentre.toFixed(4)}`);

  const noisy = new Float32Array(RES * RES);
  const noisePerlin = new Perlin(5150);
  for (let y = 0; y < RES; y++) {
    for (let x = 0; x < RES; x++) {
      noisy[y * RES + x] = 0.5 + 0.35 * fbm(noisePerlin, (x / RES) * 30, (y / RES) * 30, 5, 2, 0.5) - 0.17;
    }
  }
  const smoothDelta = emptyDelta(RES);
  for (let i = 0; i < 25; i++) dab(smoothDelta, noisy, RES, { x: RES / 2, y: RES / 2, radius: 20, strength: 0.5, mode: 'smooth', falloff: 0.2 });
  const roughness = (field) => {
    let total = 0;
    for (let y = 1; y < RES - 1; y++) {
      for (let x = 1; x < RES - 1; x++) {
        const i = y * RES + x;
        total += Math.abs(field[i] - field[i - 1]) + Math.abs(field[i] - field[i - RES]);
      }
    }
    return total / field.length;
  };
  const smoothed = new Float32Array(RES * RES);
  for (let i = 0; i < smoothed.length; i++) smoothed[i] = noisy[i] + smoothDelta[i];
  const before = roughness(noisy), after = roughness(smoothed);
  check('smooth reduces local roughness', after < before, `${before.toFixed(5)} → ${after.toFixed(5)}`);

  const erased = new Float32Array(delta);
  dab(erased, base, RES, { x: RES / 2, y: RES / 2, radius: 18, strength: 0.5, mode: 'erase', falloff: 0.5 });
  check('erase removes painted height', Math.abs(erased[(RES / 2 | 0) * RES + (RES / 2 | 0)]) < Math.abs(centre));

  // Stroke interpolation must cover the gap between two far-apart samples.
  const stroked = emptyDelta(RES);
  stroke(stroked, base, RES, { x: 30, y: RES / 2 }, { x: RES - 30, y: RES / 2 }, { radius: 8, strength: 0.12, mode: 'raise', falloff: 0.6 });
  let painted = 0;
  for (let x = 30; x < RES - 30; x += 4) if (stroked[(RES / 2 | 0) * RES + x] > 1e-4) painted++;
  check('a stroke paints continuously, not as dots', painted > (RES - 60) / 4 * 0.8, `${painted} of ${Math.round((RES - 60) / 4)} samples`);

  check('brush falloff is 1 at the centre', Math.abs(falloffAt(0, 10, 0.5) - 1) < 1e-9);
  check('brush falloff is 0 at the rim', falloffAt(10, 10, 0.5) < 1e-6);

  const resampled = resampleField(delta, RES, 97);
  check('brush fields resample on resolution change', resampled.length === 97 * 97 && Number.isFinite(resampled[4800]));
}

section('Water and diagnostics');
{
  const mask = waterMask(baked.height, RES, 0.2, 0.01);
  let wet = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] > 0.5) wet++;
  check('water mask marks the low ground', wet > 0 && wet < mask.length, `${((wet / mask.length) * 100).toFixed(1)}% submerged`);
  writePng(`${OUT}core-30-water-mask.png`, RES, RES, fieldToBuffer(mask, RES, RAMPS.flow));
  writePng(`${OUT}core-31-flow.png`, RES, RES, fieldToBuffer(baked.flowNorm, RES, RAMPS.flow));
  writePng(`${OUT}core-32-slope.png`, RES, RES, fieldToBuffer(slopeField(baked.height, RES), RES, RAMPS.slope));
  writePng(`${OUT}core-33-height-ramp.png`, RES, RES, fieldToBuffer(baked.height, RES, RAMPS.height));
}

section('Project model');
{
  const project = defaultProject();
  check('default project is complete', !!project.layers?.length && !!project.texture?.layers?.length && !!project.sun && !!project.view);
  check('default project has a satellite layer', project.texture.layers.some((l) => l.kind === 'satmap'));
  check('every shape layer has a known type', project.layers.every((l) => ['base', 'noise', 'cellular', 'island', 'cone', 'terrace', 'ramp', 'smooth', 'sharpen', 'flatten', 'normalize', 'erode', 'brush', 'import'].includes(l.type)));
  const tuning = erosionLayerParams(project.layers.find((l) => l.type === 'erode'));
  check('erosion layers resolve their tuning', typeof tuning.droplets === 'number');
  const serialized = JSON.stringify(project, (k, v) => (k === 'image' ? undefined : v));
  check('project serializes', JSON.parse(serialized).resolution === project.resolution);
  check('no imagery is embedded by default', !serialized.includes('"data":['));
}

console.log(`\n${passed} checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
console.log(`\nWrote verification images to ${OUT}`);
