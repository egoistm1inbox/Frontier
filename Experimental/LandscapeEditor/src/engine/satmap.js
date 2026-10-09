// Procedural satmap: a satellite-style colour texture generated from the finished heightmap.
//
// Each texel is classified from altitude, slope, the drainage network and the erosion footprint:
//   - rivers and lakes from routed flow accumulation and sea level
//   - beaches in the shallow band above the sea
//   - forest below the treeline on gentle, wet ground, in organic patches
//   - bare rock on steep faces and above the treeline
//   - snow above the snowline on slopes that can hold it
//   - soil and alluvial fans from erosion scars and deposits
// The classes are blended, then lit with a baked hillshade so relief reads from above.

import { bilinear, clamp, hillshade, mix, slopeDegrees, smoothstep } from './grid.js';
import { createNoise } from './noise.js';

export function hexToRgb(hex) {
  const value = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!value) return [128, 128, 128];
  const n = parseInt(value[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Flow value above which a land cell counts as river. Density sets the share of land cells that
// are river: 3% of land at density 0, 0.4% at density 1. Using a share keeps the drainage density
// sensible for any terrain instead of depending on an absolute accumulation threshold.
function riverQuantile(flow, heights, size, sea, maxHeight, density) {
  const bins = 1024;
  const histogram = new Uint32Array(bins);
  let land = 0;
  for (let i = 0; i < heights.length; i += 1) {
    if (heights[i] * maxHeight <= sea) continue;
    land += 1;
    histogram[Math.min(bins - 1, Math.floor(flow[i] * bins))] += 1;
  }
  const d = clamp(density, 0, 1);
  const share = 0.03 * (1 - d) + 0.004 * d;
  const target = Math.max(1, share * land);
  let accumulated = 0;
  for (let b = bins - 1; b >= 0; b -= 1) {
    accumulated += histogram[b];
    if (accumulated >= target) return b / bins;
  }
  return 1;
}

export function buildSatmap({ heights, size, cellMetres, maxHeight, flow, erosionDelta, settings, satmap }) {
  const S = satmap.resolution;
  const out = new Uint8ClampedArray(S * S * 4);
  const slope = slopeDegrees(heights, size, cellMetres, maxHeight);
  const shade = hillshade(heights, size, cellMetres, maxHeight, satmap.sunAzimuth, satmap.sunElevation);
  const sinElevation = Math.max(0.2, Math.sin((satmap.sunElevation * Math.PI) / 180));

  const seed = settings.seed | 0;
  const noiseLow = createNoise(seed + 9001);
  const noiseMid = createNoise(seed + 9002);
  const noiseFine = createNoise(seed + 9003);
  const palette = Object.fromEntries(Object.entries(satmap.colours).map(([key, hex]) => [key, hexToRgb(hex)]));

  const sea = settings.seaLevel;
  const treeline = satmap.treeline;
  const snowline = satmap.snowline;
  const rockSlope = satmap.rockSlope;
  const riverThreshold = riverQuantile(flow, heights, size, sea, maxHeight, satmap.riverDensity);
  const span = size - 1;
  const cellScale = S / 256;
  const colour = [0, 0, 0];

  for (let ty = 0; ty < S; ty += 1) {
    for (let tx = 0; tx < S; tx += 1) {
      const gx = (tx / (S - 1)) * span;
      const gy = (ty / (S - 1)) * span;
      const h = bilinear(heights, size, gx, gy);
      const altitude = h * maxHeight;
      const s = bilinear(slope, size, gx, gy);
      const fl = bilinear(flow, size, gx, gy);
      const delta = bilinear(erosionDelta, size, gx, gy) * maxHeight;
      const lit = bilinear(shade, size, gx, gy);
      const altitudeFraction = altitude / maxHeight;

      const low = noiseLow(gx * 0.11, gy * 0.11);
      const mid = noiseMid(gx * 0.07, gy * 0.07);
      const fine = noiseFine(tx * 0.37 * cellScale, ty * 0.37 * cellScale);

      // Land classes, each weight in [0, 1].
      const treeFactor = 1 - smoothstep(treeline - 0.08, treeline + 0.04, altitudeFraction);
      const gentle = 1 - smoothstep(rockSlope * 0.6, rockSlope, s);
      const patches = smoothstep(-0.2, 0.2, mid + 0.35 * low);
      const wet = smoothstep(0.55, 0.9, fl) * satmap.wetness;
      const forest = clamp(satmap.vegetation * treeFactor * gentle * patches * (1.1 + wet), 0, 1);

      const bare = smoothstep(rockSlope - 6, rockSlope + 4, s);
      const highRock = smoothstep(treeline, treeline + 0.12, altitudeFraction) * 0.75;
      const rock = clamp(Math.max(bare, highRock), 0, 1);

      const snow =
        smoothstep(snowline - 0.03, snowline + 0.01, altitudeFraction) *
        (1 - smoothstep(rockSlope + 6, rockSlope + 22, s));

      const above = altitude - sea;
      const beach = (1 - smoothstep(satmap.beach * 0.4, satmap.beach + 0.5, above)) * (1 - smoothstep(3, 9, s)) * (above > -1 ? 1 : 0) * (satmap.beach > 0 ? 1 : 0);

      const scar = smoothstep(0.02, 0.2, -delta) * (0.4 + 0.6 * smoothstep(8, 25, s));
      const fan = smoothstep(0.02, 0.2, delta) * (1 - snow);
      const soil = clamp(Math.max(scar, fan) * 0.7, 0, 1);

      const shoreline = 1 - smoothstep(-0.5, 0.5, above);
      const riverMask = smoothstep(riverThreshold, riverThreshold + 0.02, fl) * (1 - shoreline) * (1 - snow * 0.8);
      const depth = clamp((sea - altitude) / (sea * 0.6 + 4), 0, 1);

      // Blend the classes.
      colour[0] = palette.grass[0];
      colour[1] = palette.grass[1];
      colour[2] = palette.grass[2];
      const blend = (key, amount) => {
        const c = palette[key];
        colour[0] = mix(colour[0], c[0], amount);
        colour[1] = mix(colour[1], c[1], amount);
        colour[2] = mix(colour[2], c[2], amount);
      };
      // Wet valleys are a little darker and more saturated.
      const wetGrass = wet * 0.25;
      colour[0] *= 1 - wetGrass;
      colour[1] *= 1 - wetGrass * 0.6;
      colour[2] *= 1 - wetGrass;
      blend('forest', forest);
      blend('soil', soil * (1 - forest));
      blend('rock', rock);
      blend('sand', beach);
      blend('snow', snow);

      // Colour variation and micro detail.
      const variation = 1 + satmap.variation * 0.14 * low + satmap.variation * 0.06 * mid;
      const detail = 1 + satmap.detail * 0.07 * fine;
      const texture = variation * detail;
      colour[0] *= texture;
      colour[1] *= texture;
      colour[2] *= texture;

      // Hillshade on land only.
      const landShade = satmap.shade * (1 - shoreline);
      const relief = clamp(lit / sinElevation, 0, 1.4);
      const shadeFactor = mix(1, 0.25 + 0.85 * relief, landShade);
      colour[0] *= shadeFactor;
      colour[1] *= shadeFactor;
      colour[2] *= shadeFactor;

      // Water last, so rivers and the sea sit on top of the land classes.
      const waterColour = [
        mix(palette.water[0] * 1.25, palette.water[0] * 0.55, depth),
        mix(palette.water[1] * 1.25, palette.water[1] * 0.55, depth),
        mix(palette.water[2] * 1.25, palette.water[2] * 0.55, depth),
      ];
      const water = clamp(Math.max(riverMask * 0.9, shoreline), 0, 1);
      const pixel = (ty * S + tx) * 4;
      out[pixel] = clamp(mix(colour[0], waterColour[0], water), 0, 255);
      out[pixel + 1] = clamp(mix(colour[1], waterColour[1], water), 0, 255);
      out[pixel + 2] = clamp(mix(colour[2], waterColour[2], water), 0, 255);
      out[pixel + 3] = 255;
    }
  }
  return out;
}

// Blends an imported satellite image (already resampled to S x S RGBA) over the procedural map.
export function blendImage(procedural, image, amount) {
  const out = new Uint8ClampedArray(procedural.length);
  const t = clamp(amount, 0, 1);
  for (let i = 0; i < procedural.length; i += 4) {
    out[i] = mix(procedural[i], image[i], t);
    out[i + 1] = mix(procedural[i + 1], image[i + 1], t);
    out[i + 2] = mix(procedural[i + 2], image[i + 2], t);
    out[i + 3] = 255;
  }
  return out;
}
