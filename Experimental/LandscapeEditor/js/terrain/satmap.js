// Satmap: a procedural satellite-style surface colour map, derived from the finished terrain.
// It does not try to be photographic. It places land cover where a real satellite image would show it:
//   water below sea level (deeper is darker), sand just above it, bare rock on steep faces, scree at their foot,
//   alluvial soil on wet flats, vegetation that thins with slope and altitude, forest in the wet valleys,
//   and snow above the snow line. Hillshade and cavity shading give the relief, and field-scale patches
//   and grain give the texture a satellite look.
// Desert palettes (the Mesa country palette) add bedrock that follows the stratigraphy, desert varnish on cliffs,
// talus, washes and sand, playa clay with cracks, shrubs and juniper on the caprock, lake water, and cast shadows.
// Those features are switched on by their parameters and the palette, so the temperate palettes render as before.
import { bilinear } from '../core/grid.js';
import { makeNoise, fbm } from '../core/noise.js';
import { clamp, smoothstep, hash2 } from '../core/rng.js';
import { strataNoise, strataOffset, strataUnit } from './strata.js';
import { shadowFor } from './shadows.js';

const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

export const PALETTES = {
  temperate: {
    label: 'Temperate',
    deep: rgb('#1d4a66'), shallow: rgb('#3f7f94'), sand: rgb('#c9b98c'),
    grass: rgb('#5f8c3c'), dry: rgb('#8f9a58'), forest: rgb('#2c5a2b'), conifer: rgb('#1f3f2a'),
    scrub: rgb('#7d7f4b'), rock: rgb('#7a7165'), scree: rgb('#978f85'), soil: rgb('#8a7656'), snow: rgb('#eef2f5'),
  },
  arid: {
    label: 'Arid',
    deep: rgb('#2b5d6e'), shallow: rgb('#6f9a9a'), sand: rgb('#dcc08a'),
    grass: rgb('#b7a46b'), dry: rgb('#c9ad74'), forest: rgb('#6b7449'), conifer: rgb('#4f5d3a'),
    scrub: rgb('#9c8a5c'), rock: rgb('#9c6b4a'), scree: rgb('#b8a383'), soil: rgb('#c49a5e'), snow: rgb('#ece8df'),
  },
  alpine: {
    label: 'Alpine',
    deep: rgb('#1a3f5a'), shallow: rgb('#4d7e8c'), sand: rgb('#b9b09a'),
    grass: rgb('#7f9a55'), dry: rgb('#8e9462'), forest: rgb('#2b4a33'), conifer: rgb('#1f3a2b'),
    scrub: rgb('#6f7a50'), rock: rgb('#6f6a66'), scree: rgb('#8f8c88'), soil: rgb('#7c6a4f'), snow: rgb('#f5f8fb'),
  },
  tropical: {
    label: 'Tropical',
    deep: rgb('#145a6b'), shallow: rgb('#3ba3a0'), sand: rgb('#e0cf9a'),
    grass: rgb('#58a04a'), dry: rgb('#8fa650'), forest: rgb('#1f6b2a'), conifer: rgb('#175a2a'),
    scrub: rgb('#6d8f3a'), rock: rgb('#7a6d57'), scree: rgb('#8c8270'), soil: rgb('#7a6040'), snow: rgb('#f2f4f4'),
  },
  boreal: {
    label: 'Boreal',
    deep: rgb('#1e3f58'), shallow: rgb('#4c7a84'), sand: rgb('#b7a88a'),
    grass: rgb('#6c7f55'), dry: rgb('#8a8c62'), forest: rgb('#1e3a2a'), conifer: rgb('#183025'),
    scrub: rgb('#5f6b4a'), rock: rgb('#6a6862'), scree: rgb('#8a8780'), soil: rgb('#6a5a46'), snow: rgb('#e6ecef'),
  },
  autumn: {
    label: 'Autumn',
    deep: rgb('#22475c'), shallow: rgb('#4f8084'), sand: rgb('#d2bd8c'),
    grass: rgb('#a88d3d'), dry: rgb('#b9a14f'), forest: rgb('#a0462a'), conifer: rgb('#5f4a26'),
    scrub: rgb('#8e6b31'), rock: rgb('#7b6a5b'), scree: rgb('#948a7b'), soil: rgb('#8b6b3e'), snow: rgb('#eef0f0'),
  },
  mesa: {
    label: 'Mesa country',
    desert: true,
    deep: rgb('#1d4d5a'), shallow: rgb('#5f9b9b'), sand: rgb('#dcc291'),
    grass: rgb('#8f8a52'), dry: rgb('#b8a06a'), forest: rgb('#5b6842'), conifer: rgb('#46563a'),
    scrub: rgb('#5f6b47'), rock: rgb('#a86a4c'), scree: rgb('#a18d7b'), soil: rgb('#b8976a'), snow: rgb('#f1eee8'),
    strata: [rgb('#7d3d2c'), rgb('#b65d3d'), rgb('#d99d7b'), rgb('#ead9bd'), rgb('#caa066'), rgb('#8c7679')],
    caprock: rgb('#c9baa4'), varnish: rgb('#2b231e'), wash: rgb('#cfb084'), playa: rgb('#d9d1c2'), mud: rgb('#6f604f'),
  },
};

export const PALETTE_OPTIONS = Object.entries(PALETTES).map(([id, p]) => [id, p.label]);

// F2 - F1 of a jittered cell pattern (Worley). It is near zero along the cell boundaries, which read as cracks.
function crackle(X, Y, seed) {
  const cells = 110;
  const fx = X * cells;
  const fy = Y * cells;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  let f1 = 9;
  let f2 = 9;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx;
      const cy = iy + dy;
      const d = Math.hypot(fx - (cx + hash2(cx, cy, seed)), fy - (cy + hash2(cx, cy, seed + 1)));
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) f2 = d;
    }
  }
  return f2 - f1;
}

// Painter for a satmap of size x size pixels. Returns paintRows(out, j0, j1), which fills rows j0..j1-1 of an
// RGBA buffer (size*size*4 bytes, row 0 at the north edge, same orientation as the heightmap). Rows can be
// painted in chunks, so the export can report progress and yield between them.
//
// analysis carries the derived fields and, from the stack, optional context:
//   strata   the stratigraphic column (from the topmost Stratigraphy layer), used for banding
//   water    water-surface level per cell (lake basins), 0 where there is none
//   playa    dry-lake floor share per cell
//   shadows  a cache for cast-shadow maps, keyed by sun
export function satmapPainter(p, size, h, N, analysis, terrain, seed = 1) {
  const pal = PALETTES[p.palette] || PALETTES.temperate;
  const { gx, gy, slope, ridge, wet, heightM } = analysis;
  const dep = analysis.deposition || null;
  const seaM = terrain.seaLevel * heightM;
  const az = (p.sunAzimuth * Math.PI) / 180;
  const el = (p.sunElevation * Math.PI) / 180;
  const sx = Math.sin(az) * Math.cos(el);
  const sy = -Math.cos(az) * Math.cos(el);
  const sz = Math.sin(el);
  const patchNoise = makeNoise((seed * 9176 + 17) >>> 0);
  const fieldNoise = makeNoise((seed * 1237 + 71) >>> 0);
  const inv = 1 / size;
  const span = N - 1;
  const hillAmt = clamp(p.hillshade, 0, 1);
  const detail = clamp(p.detail, 0, 1);
  const veg = clamp(p.vegetation, 0, 1);
  const wetInfl = clamp(p.wetness, 0, 1);
  const rockSlope = p.rockSlope;
  const snowM = p.snowline;
  const sat = clamp(p.saturation, 0, 2);
  const con = clamp(p.contrast, 0.5, 1.6);

  // Desert features. Each is off at zero and only the desert palette reads them.
  const desert = !!pal.desert;
  const strataW = desert ? clamp(p.strata ?? 0, 0, 1) : 0;
  const strata = strataW > 0 && analysis.strata ? analysis.strata : null;
  const strataNz = strata ? strataNoise(strata) : null;
  const varnishW = desert ? clamp(p.varnish ?? 0, 0, 1) : 0;
  const sandW = desert ? clamp(p.sand ?? 0, 0, 1) : 0;
  const shadowW = clamp(p.shadow ?? 0, 0, 1);
  const shadow = shadowW > 0 ? shadowFor(analysis, h, N, p.sunAzimuth, p.sunElevation) : null;
  const waterLevel = desert && analysis.water ? analysis.water : null;
  const playaMask = desert && analysis.playa ? analysis.playa : null;
  const streakNz = varnishW > 0 ? makeNoise((seed * 3331 + 5) >>> 0) : null;
  const rippleNz = desert ? makeNoise((seed * 4421 + 3) >>> 0) : null;

  const col = [0, 0, 0];
  const mix = (a, b, t) => {
    col[0] += (b[0] - a[0]) * t;
    col[1] += (b[1] - a[1]) * t;
    col[2] += (b[2] - a[2]) * t;
  };

  return function paintRows(out, j0, j1) {
    for (let j = j0; j < j1; j++) {
      const v = (j + 0.5) * inv * span;
      const u0 = j * inv;
      for (let i = 0; i < size; i++) {
        const u = (i + 0.5) * inv * span;
        const hv = bilinear(h, N, u, v);
        const alt = hv * heightM;
        const s = bilinear(slope, N, u, v);
        const rd = bilinear(ridge, N, u, v);
        const w = smoothstep(0.3, 0.95, bilinear(wet, N, u, v)); // emphasise the channels
        const d = dep ? bilinear(dep, N, u, v) : 0;
        const uu = i * inv;
        const patch = fbm(patchNoise, uu * 9, u0 * 9, 3, 2.1, 0.5); // field-scale variation, roughly [-0.5, 0.5]
        const field = fieldNoise(uu * 60, u0 * 60) * 0.5 + 0.5;
        const grain = hash2(i, j, seed);

        const depth = seaM - alt; // positive under water
        const waterW = smoothstep(-1.5, 2.0, depth);
        const deepW = smoothstep(4, 70, depth);
        const beachW = smoothstep(-3, 2, alt - seaM) * (1 - smoothstep(4, 14, alt - seaM)) * (1 - smoothstep(4, 14, s));

        const snowW = smoothstep(snowM - 160, snowM + 30, alt + patch * 60) * (1 - 0.7 * smoothstep(34, 52, s));
        const rockW = clamp(smoothstep(rockSlope - 8, rockSlope + 8, s) + 0.35 * smoothstep(0.004, 0.02, rd), 0, 1);
        const screeW = smoothstep(rockSlope - 20, rockSlope - 8, s) * (1 - rockW);
        const vegW = veg * (1 - smoothstep(rockSlope - 14, rockSlope - 2, s)) * (1 - snowW) * (1 - waterW);
        const alpineF = smoothstep(0.45, 0.8, hv);
        const wetness = clamp(w * wetInfl + patch * 0.35 + 0.15 * (field - 0.5), 0, 1);
        const forestW = clamp(vegW * smoothstep(0.3, 0.62, wetness + 0.08 * (1 - alpineF)), 0, 1);
        const grassW = clamp(vegW - forestW, 0, 1);
        const scrubW = clamp(vegW * smoothstep(0.55, 0.25, wetness) * 0.7, 0, 1);
        const soilW = clamp((d * 1.2 + smoothstep(0.55, 0.9, w) * 0.5) * (1 - smoothstep(3, 9, s)), 0, 1) * (1 - waterW) * (1 - snowW);

        const nxg = bilinear(gx, N, u, v);
        const nyg = bilinear(gy, N, u, v);
        let lakeShade = 0;

        if (!desert) {
          col[0] = pal.rock[0];
          col[1] = pal.rock[1];
          col[2] = pal.rock[2];
          mix(col, pal.scree, screeW);
          mix(col, pal.soil, soilW * (1 - rockW));
          const grassTone = pal.dry;
          const lush = pal.grass;
          const tone = [
            grassTone[0] + (lush[0] - grassTone[0]) * wetness,
            grassTone[1] + (lush[1] - grassTone[1]) * wetness,
            grassTone[2] + (lush[2] - grassTone[2]) * wetness,
          ];
          mix(col, tone, grassW);
          mix(col, pal.scrub, scrubW);
          mix(col, pal.forest, forestW * (1 - alpineF));
          mix(col, pal.conifer, forestW * alpineF);
          mix(col, pal.sand, beachW * (1 - snowW));
          mix(col, pal.snow, snowW);
          mix(col, pal.shallow, waterW * (1 - deepW));
          mix(col, pal.deep, waterW * deepW);
        } else {
          // Bedrock: the stratigraphic unit at this height, on cliffs and on flat caprock. Gentle ground is desert floor.
          let bed = pal.rock;
          let capW = 0;
          if (strata) {
            const k = strataUnit(strata, hv - strataOffset(strata, strataNz, u / span, v / span));
            if (k >= 0) {
              const top = k === strata.K - 1;
              const sc0 = top ? pal.caprock : pal.strata[k % pal.strata.length];
              const tone = 1 + 0.12 * (hash2(k, 3, seed + 19) - 0.5) + 0.06 * patch; // each unit differs a little
              const sc = [sc0[0] * tone, sc0[1] * tone, sc0[2] * tone];
              // The bands show on true cliffs only. On the steep talus they would draw contour stripes.
              const band = strataW * smoothstep(rockSlope + 6, rockSlope + 16, s);
              bed = [pal.rock[0] + (sc[0] - pal.rock[0]) * band, pal.rock[1] + (sc[1] - pal.rock[1]) * band, pal.rock[2] + (sc[2] - pal.rock[2]) * band];
              if (top) capW = 1 - smoothstep(3, 8, s);
            }
          }
          const bedW = clamp(rockW + 0.9 * capW * (1 - rockW), 0, 1);
          col[0] = pal.soil[0];
          col[1] = pal.soil[1];
          col[2] = pal.soil[2];
          mix(col, bed, bedW);
          mix(col, pal.scree, screeW * (1 - capW));

          // Desert varnish: dark streaks that run down steep faces. The noise is stretched along the slope.
          if (varnishW > 0) {
            const gl = Math.hypot(nxg, nyg);
            const ex = gl > 1e-6 ? nxg / gl : 0;
            const ey = gl > 1e-6 ? nyg / gl : 1;
            const X = u / span;
            const Y = v / span;
            const streak = fbm(streakNz, (X * -ey + Y * ex) * 220, (X * ex + Y * ey) * 12, 3, 2.1, 0.5);
            mix(col, pal.varnish, varnishW * smoothstep(rockSlope + 12, rockSlope + 26, s) * smoothstep(0.0, 0.5, streak) * 0.8);
          }

          // Washes and sand on gentle ground and in the dry channels.
          const open = (1 - bedW) * (1 - waterW) * (1 - snowW);
          const flatW = 1 - smoothstep(3, 9, s);
          const channel = smoothstep(0.35, 0.8, w);
          const sandField = smoothstep(-0.05, 0.25, patch + 0.3 * (field - 0.5));
          const washW = sandW * open * clamp(flatW * 0.8 + channel * 0.9, 0, 1) * (0.35 + 0.65 * sandField);
          mix(col, pal.wash, washW);
          if (washW > 0) {
            // Wind ripples on the sand: fine streaks, stretched across the wind, scaled by how much sand lies here.
            const X = u / span;
            const Y = v / span;
            const rp = fbm(rippleNz, (X * 0.9 + Y * 0.44) * 420, (-X * 0.44 + Y * 0.9) * 90, 2, 2.0, 0.5);
            const k = 1 + 0.09 * rp * washW;
            col[0] *= k;
            col[1] *= k;
            col[2] *= k;
          }

          // Playa: pale clay with a crack network, where the playa layer lies.
          let playaM = 0;
          if (playaMask) {
            playaM = clamp(bilinear(playaMask, N, u, v), 0, 1);
            if (playaM > 0.01) {
              const crack = smoothstep(0.02, 0.09, crackle(u / span, v / span, seed + 11));
              const clay = [pal.playa[0] * (0.8 + 0.2 * crack), pal.playa[1] * (0.8 + 0.2 * crack), pal.playa[2] * (0.8 + 0.2 * crack)];
              mix(col, clay, playaM);
            }
          }

          // Shrubs in patches on the open ground, juniper on the caprock, grass in the damp channels.
          const cluster = smoothstep(-0.1, 0.3, patch);
          const speck = smoothstep(0.45, 0.6, hash2(i, j, seed + 7));
          mix(col, pal.scrub, clamp(veg * open * (1 - playaM) * cluster * speck * 1.4, 0, 1));
          mix(col, pal.forest, clamp(veg * capW * smoothstep(0.1, 0.5, field) * 0.85, 0, 1));
          mix(col, pal.grass, clamp(veg * open * channel * 0.5, 0, 1));

          mix(col, pal.sand, beachW * (1 - snowW));
          mix(col, pal.snow, snowW);

          // Lake water: shallow pale teal on the shore, deeper teal in the middle, with a muddy rim.
          if (waterLevel) {
            const wl = bilinear(waterLevel, N, u, v);
            if (wl > 0) {
              const depthM = wl * heightM - alt;
              const lakeIn = smoothstep(-0.6, 0.6, depthM);
              if (lakeIn > 0) {
                const deepL = smoothstep(1.5, 30, depthM);
                const rim = 1 - smoothstep(0.6, 3.5, depthM);
                const lc = [0, 1, 2].map((c) => {
                  const base = pal.shallow[c] + (pal.deep[c] - pal.shallow[c]) * deepL;
                  return base + (pal.mud[c] - base) * rim * 0.7;
                });
                mix(col, lc, lakeIn);
                lakeShade = lakeIn;
              }
            }
          }
          mix(col, pal.shallow, waterW * (1 - deepW));
          mix(col, pal.deep, waterW * deepW);
        }

        // Hillshade from the gradient, with cast shadows where a ridge or cliff blocks the sun. Water is flat.
        const nl = Math.hypot(nxg, nyg, 1);
        const dot = clamp((-nxg * sx - nyg * sy + sz) / nl, 0, 1);
        const lit = shadow ? bilinear(shadow, N, u, v) : 1;
        const direct = 1 - shadowW * (1 - lit);
        const water = Math.max(waterW, lakeShade);
        const shade = (1 - water) * (1 - hillAmt + hillAmt * (0.2 + 0.95 * dot * direct)) + water;
        const cavity = 1 - 0.14 * smoothstep(0.002, 0.02, -rd) * (1 - water);
        const texture = 1 + detail * ((grain - 0.5) * 0.12 + (field - 0.5) * 0.09);

        let r = col[0] * shade * cavity * texture;
        let g = col[1] * shade * cavity * texture;
        let b = col[2] * shade * cavity * texture;
        const lum = 0.3 * r + 0.59 * g + 0.11 * b;
        r = lum + (r - lum) * sat;
        g = lum + (g - lum) * sat;
        b = lum + (b - lum) * sat;
        r = (r - 128) * con + 128;
        g = (g - 128) * con + 128;
        b = (b - 128) * con + 128;

        const o = (j * size + i) * 4;
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
        out[o + 3] = 255;
        col[0] = 0;
        col[1] = 0;
        col[2] = 0;
      }
    }
    return out;
  };
}

// Whole satmap in one call: used for the viewport preview. Returns Uint8ClampedArray RGBA, size*size*4.
export function renderSatmap(p, size, h, N, analysis, terrain, seed = 1) {
  const out = new Uint8ClampedArray(size * size * 4);
  satmapPainter(p, size, h, N, analysis, terrain, seed)(out, 0, size);
  return out;
}
