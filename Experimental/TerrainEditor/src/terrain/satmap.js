// Satmap texturing: a stylized satellite-style paint of the terrain, driven
// by the channels the layer stack produces — height, rivers, sedimentation
// and strata — plus slope-derived rock and snow. Deliberately painterly
// rather than a literal satellite photo.

import { fbm, smoothstep, clamp01, lerp } from './noise.js';

export const palettes = [
  { id: 'temperate', label: 'Temperate', rockSlope: 0.58, snowStart: 0.72, mottle: 0.14,
    deep: [22, 48, 80], shallow: [56, 122, 148], sand: [216, 198, 150],
    grass: [122, 152, 82], forest: [74, 112, 62], rock: [128, 118, 104],
    scree: [152, 140, 122], snow: [240, 242, 244], river: [96, 150, 190],
    sediment: [206, 178, 128], strataA: [196, 138, 92], strataB: [150, 100, 66] },
  { id: 'desert', label: 'Desert', rockSlope: 0.62, snowStart: 0.97, mottle: 0.12,
    deep: [24, 52, 84], shallow: [64, 130, 150], sand: [226, 194, 134],
    grass: [172, 152, 92], forest: [152, 134, 82], rock: [162, 112, 74],
    scree: [178, 130, 86], snow: [238, 232, 220], river: [90, 140, 180],
    sediment: [234, 208, 152], strataA: [212, 152, 98], strataB: [168, 110, 66] },
  { id: 'canyon', label: 'Sandstone', rockSlope: 0.6, snowStart: 0.9, mottle: 0.12,
    deep: [30, 50, 70], shallow: [70, 110, 120], sand: [222, 198, 152],
    grass: [162, 142, 86], forest: [142, 122, 72], rock: [122, 80, 58],
    scree: [152, 106, 74], snow: [242, 238, 230], river: [100, 140, 170],
    sediment: [226, 192, 142], strataA: [208, 144, 94], strataB: [158, 102, 66] },
  { id: 'alpine', label: 'Alpine', rockSlope: 0.5, snowStart: 0.6, mottle: 0.13,
    deep: [20, 44, 74], shallow: [70, 130, 150], sand: [212, 202, 172],
    grass: [110, 140, 80], forest: [70, 100, 60], rock: [120, 120, 124],
    scree: [148, 148, 152], snow: [244, 246, 248], river: [96, 150, 190],
    sediment: [200, 190, 160], strataA: [172, 152, 132], strataB: [132, 114, 98] },
  { id: 'volcanic', label: 'Volcanic', rockSlope: 0.52, snowStart: 0.78, mottle: 0.16,
    deep: [16, 36, 60], shallow: [50, 100, 120], sand: [54, 48, 46],
    grass: [98, 112, 64], forest: [70, 84, 48], rock: [64, 62, 66],
    scree: [86, 82, 86], snow: [238, 240, 242], river: [110, 160, 190],
    sediment: [122, 106, 90], strataA: [98, 82, 74], strataB: [70, 58, 54] },
  { id: 'arctic', label: 'Arctic', rockSlope: 0.55, snowStart: 0.35, mottle: 0.1,
    deep: [28, 54, 84], shallow: [90, 140, 160], sand: [202, 206, 198],
    grass: [142, 150, 126], forest: [122, 134, 112], rock: [130, 132, 136],
    scree: [152, 154, 158], snow: [246, 248, 250], river: [110, 160, 195],
    sediment: [192, 194, 186], strataA: [172, 174, 178], strataB: [142, 144, 148] },
];

export function paletteById(id) {
  return palettes.find((p) => p.id === id) || palettes[0];
}

function lerpRGB(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// data: { heightN, slopeN, rivers, sediment, strata, strataPhase, waterN }
export function colorize(data, paletteId, seed = 1) {
  const pal = paletteById(paletteId);
  const { heightN, slopeN, rivers, sediment, strata, strataPhase, waterN } = data;
  const size = data.size;
  const out = new Uint8ClampedArray(size * size * 4);
  const waterSpan = Math.max(0.06, waterN);

  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, o = i * 4;
    const h = heightN[i];
    let r, g, b;
    if (h < waterN - 1e-6) {
      const depth = clamp01((waterN - h) / waterSpan);
      [r, g, b] = lerpRGB(pal.shallow, pal.deep, depth * 0.85);
      const m = 0.5 + 0.5 * fbm(x / size * 5 + seed, y / size * 5 - seed, { octaves: 2, seed });
      r *= 0.9 + 0.2 * m; g *= 0.9 + 0.2 * m; b *= 0.92 + 0.16 * m;
    } else {
      const t = clamp01((h - waterN) / Math.max(1e-4, 1 - waterN));
      const slope = slopeN[i];
      const m = 0.5 + 0.5 * fbm(x / size * 7 + seed * 3, y / size * 7 + seed * 7, { octaves: 2, seed: seed + 9 });
      if (t < 0.02) {
        [r, g, b] = pal.sand;
      } else if (slope > pal.rockSlope) {
        [r, g, b] = lerpRGB(pal.rock, pal.scree, clamp01(t * 1.4));
      } else if (t > pal.snowStart) {
        const patch = smoothstep(0.4, 0.7, m);
        [r, g, b] = lerpRGB(lerpRGB(pal.rock, pal.scree, 0.5), pal.snow, patch);
      } else if (t > 0.42) {
        [r, g, b] = lerpRGB(pal.forest, pal.scree, clamp01((t - 0.42) / 0.3));
      } else {
        [r, g, b] = lerpRGB(pal.grass, pal.forest, smoothstep(0.3, 0.7, m));
      }
      // rivers from the flow channels
      const rv = smoothstep(0.22, 0.55, rivers[i]);
      if (rv > 0) [r, g, b] = lerpRGB([r, g, b], pal.river, rv * 0.9);
      // sedimentation in valleys and deltas
      const sv = smoothstep(0.25, 0.7, sediment[i]);
      if (sv > 0) [r, g, b] = lerpRGB([r, g, b], pal.sediment, sv * 0.55);
      // strata bands from the stack
      const st = strata[i];
      if (st > 0.04) {
        const band = strataPhase[i] > 0.5 ? pal.strataA : pal.strataB;
        [r, g, b] = lerpRGB([r, g, b], band, clamp01(st) * 0.7);
      }
      // large-scale mottle keeps it painterly, not literal
      const mm = 1 - pal.mottle * 0.5 + pal.mottle * m;
      r *= mm; g *= mm; b *= mm;
    }
    out[o] = r * 255; out[o + 1] = g * 255; out[o + 2] = b * 255; out[o + 3] = 255;
  }
  return out;
}
