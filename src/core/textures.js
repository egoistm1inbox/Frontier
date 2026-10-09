/**
 * Frontier Landscape Studio — surface texturing.
 *
 * Two cooperating systems, both living in the layer stack:
 *
 *  · Splat layers   procedural materials blended by rules over height, slope,
 *                   flow accumulation and talus. This is what makes a cliff
 *                   read as rock and a valley floor read as grass without any
 *                   hand painting.
 *  · Satellite drape  a top-down projected texture. Generated procedurally from
 *                   the terrain itself, or supplied as a real imported image.
 *
 * The output is a single RGBA texture: RGB is albedo, A is smoothness
 * (1 − roughness) so the shader gets both from one sample.
 */

import { Perlin, fbm, cellular, clamp01, mulberry32 } from './noise.js';

/* ------------------------------------------------------------- materials */

export const MATERIALS = [
  { id: 'deepwater', name: 'Deep water', a: '#0d1c26', b: '#16323f', roughness: 0.06, detail: 0.25 },
  { id: 'shallows', name: 'Shallows', a: '#1d4a56', b: '#2f7180', roughness: 0.09, detail: 0.3 },
  { id: 'wet-sand', name: 'Wet sand', a: '#8d7c58', b: '#a8946a', roughness: 0.62, detail: 0.7 },
  { id: 'sand', name: 'Dry sand', a: '#c2ae7c', b: '#d8c795', roughness: 0.82, detail: 0.85 },
  { id: 'mud', name: 'Mudflat', a: '#4a3c2c', b: '#63513a', roughness: 0.5, detail: 0.6 },
  { id: 'grass', name: 'Grassland', a: '#4c6b33', b: '#6d8c45', roughness: 0.78, detail: 0.9 },
  { id: 'meadow', name: 'Dry meadow', a: '#7d8446', b: '#9aa25c', roughness: 0.8, detail: 0.9 },
  { id: 'forest', name: 'Forest', a: '#2f4a2a', b: '#41612f', roughness: 0.85, detail: 1 },
  { id: 'shrub', name: 'Scrub', a: '#5c6b3a', b: '#77844a', roughness: 0.82, detail: 0.9 },
  { id: 'dirt', name: 'Bare soil', a: '#6b5138', b: '#8a6b4a', roughness: 0.88, detail: 0.95 },
  { id: 'gravel', name: 'River gravel', a: '#6e6a63', b: '#8c877e', roughness: 0.72, detail: 0.9 },
  { id: 'scree', name: 'Scree / talus', a: '#7a7166', b: '#988d7e', roughness: 0.9, detail: 1 },
  { id: 'rock', name: 'Exposed rock', a: '#5b5751', b: '#78736b', roughness: 0.68, detail: 0.75 },
  { id: 'cliff', name: 'Dark cliff', a: '#413d39', b: '#57524c', roughness: 0.6, detail: 0.6 },
  { id: 'volcanic', name: 'Volcanic rock', a: '#2e2a29', b: '#453c39', roughness: 0.55, detail: 0.5 },
  { id: 'snow', name: 'Snow', a: '#dfe6ec', b: '#f4f8fb', roughness: 0.42, detail: 0.35 },
  { id: 'ice', name: 'Glacier ice', a: '#a9c6d8', b: '#cfe2ee', roughness: 0.2, detail: 0.3 },
];

export const material = (id) => MATERIALS.find((m) => m.id === id) || MATERIALS[11];

export const hexToRgb = (hex) => {
  const h = String(hex).replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const int = parseInt(v, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
};

export const rgbToHex = (r, g, b) =>
  '#' + [r, g, b].map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('');

/* -------------------------------------------------------- texture layers */

/** Rules a splat layer can be driven by. */
export const RULE_SOURCES = [
  { id: 'height', name: 'Height' },
  { id: 'slope', name: 'Slope' },
  { id: 'flow', name: 'Flow accumulation' },
  { id: 'talus', name: 'Talus / debris' },
  { id: 'noise', name: 'Fractal noise' },
  { id: 'cellular', name: 'Cellular patches' },
];

export const splatDefaults = (preset = {}) => ({
  material: 'rock',
  colorA: '#5b5751',
  colorB: '#78736b',
  roughness: 0.68,
  variation: 0.55,
  variationScale: 26,
  detail: 0.75,
  detailScale: 140,
  opacity: 1,
  heightEnabled: true,
  heightMin: 0,
  heightMax: 1,
  heightFeather: 0.12,
  slopeEnabled: true,
  slopeMin: 0,
  slopeMax: 1,
  slopeFeather: 0.18,
  flowEnabled: false,
  flowMin: 0.5,
  flowFeather: 0.25,
  talusEnabled: false,
  talusMin: 0.05,
  talusFeather: 0.25,
  noiseEnabled: true,
  noiseScale: 18,
  noiseContrast: 1,
  noiseThreshold: 0,
  cellularEnabled: false,
  cellularScale: 12,
  invert: false,
  ...preset,
});

let texCounter = 0;
export const newTextureId = () => `tex-${Date.now().toString(36)}-${(texCounter += 1)}`;

/** A ready-made, physically plausible surface stack. */
export function defaultTextureLayers() {
  const mk = (name, materialId, preset, extra = {}) => {
    const m = material(materialId);
    return {
      id: newTextureId(),
      kind: 'splat',
      name,
      enabled: true,
      material: materialId,
      color: m.id === 'rock' ? '#7a7166' : m.a,
      params: splatDefaults({
        material: materialId,
        colorA: m.a,
        colorB: m.b,
        roughness: m.roughness,
        detail: m.detail,
        ...preset,
      }),
      ...extra,
    };
  };

  return [
    mk('Bedrock', 'rock', {
      heightEnabled: false,
      slopeEnabled: true, slopeMin: 0.28, slopeMax: 1, slopeFeather: 0.3,
      noiseEnabled: true, noiseScale: 9, noiseContrast: 1.2,
    }),
    mk('Cliff face', 'cliff', {
      heightEnabled: false,
      slopeEnabled: true, slopeMin: 0.62, slopeMax: 1, slopeFeather: 0.16,
      noiseEnabled: true, noiseScale: 30, noiseContrast: 1.6, noiseThreshold: 0.35,
      variationScale: 14,
    }),
    mk('Scree slopes', 'scree', {
      heightEnabled: false,
      slopeEnabled: true, slopeMin: 0.2, slopeMax: 0.55, slopeFeather: 0.2,
      talusEnabled: true, talusMin: 0.02, talusFeather: 0.3,
      noiseEnabled: true, noiseScale: 40, noiseContrast: 1.3,
    }),
    mk('Riverbeds', 'gravel', {
      heightEnabled: false,
      slopeEnabled: false,
      flowEnabled: true, flowMin: 0.42, flowFeather: 0.22,
      noiseEnabled: true, noiseScale: 60, noiseContrast: 1.1,
      variationScale: 70,
    }),
    mk('Forest', 'forest', {
      heightEnabled: true, heightMin: 0.04, heightMax: 0.52, heightFeather: 0.14,
      slopeEnabled: true, slopeMin: 0, slopeMax: 0.42, slopeFeather: 0.2,
      noiseEnabled: true, noiseScale: 12, noiseContrast: 1.5, noiseThreshold: 0.22,
      cellularEnabled: true, cellularScale: 9,
    }),
    mk('Grassland', 'grass', {
      heightEnabled: true, heightMin: 0.02, heightMax: 0.44, heightFeather: 0.2,
      slopeEnabled: true, slopeMin: 0, slopeMax: 0.34, slopeFeather: 0.22,
      noiseEnabled: true, noiseScale: 15, noiseContrast: 1.15, noiseThreshold: 0.1,
    }),
    mk('Dry meadow', 'meadow', {
      heightEnabled: true, heightMin: 0.05, heightMax: 0.3, heightFeather: 0.14,
      slopeEnabled: true, slopeMin: 0, slopeMax: 0.18, slopeFeather: 0.12,
      noiseEnabled: true, noiseScale: 22, noiseContrast: 1.4, noiseThreshold: 0.45,
    }),
    mk('Beach', 'sand', {
      heightEnabled: true, heightMin: 0.0, heightMax: 0.09, heightFeather: 0.05,
      slopeEnabled: true, slopeMin: 0, slopeMax: 0.3, slopeFeather: 0.18,
      noiseEnabled: true, noiseScale: 55, noiseContrast: 1.1,
    }),
    mk('Mudflats', 'mud', {
      heightEnabled: true, heightMin: 0.0, heightMax: 0.055, heightFeather: 0.03,
      slopeEnabled: true, slopeMin: 0, slopeMax: 0.1, slopeFeather: 0.06,
      noiseEnabled: true, noiseScale: 34, noiseContrast: 1.3, noiseThreshold: 0.5,
    }),
    mk('Snowline', 'snow', {
      heightEnabled: true, heightMin: 0.62, heightMax: 1, heightFeather: 0.14,
      slopeEnabled: true, slopeMin: 0, slopeMax: 0.62, slopeFeather: 0.28,
      noiseEnabled: true, noiseScale: 18, noiseContrast: 1.2, noiseThreshold: 0.18,
    }),
  ];
}

export function createSplatLayer(name = 'New material', materialId = 'rock') {
  const m = material(materialId);
  return {
    id: newTextureId(), kind: 'splat', name, enabled: true, material: materialId, color: m.a,
    params: splatDefaults({ material: materialId, colorA: m.a, colorB: m.b, roughness: m.roughness, detail: m.detail }),
  };
}

export function createSatmapLayer() {
  return {
    id: newTextureId(),
    kind: 'satmap',
    name: 'Satellite drape',
    enabled: false,
    material: 'satmap',
    color: '#8fa87c',
    params: {
      source: 'procedural',          // 'procedural' | 'image'
      mode: 'blend',                 // 'replace' | 'blend' | 'multiply'
      opacity: 0.85,
      tiling: 1,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      brightness: 1,
      contrast: 1,
      saturation: 1,
      warmth: 0,
      sharpness: 0.5,
      // Procedural satellite generator
      seed: 4211,
      parcelScale: 26,
      parcelContrast: 0.5,
      vegetation: 0.62,
      aridity: 0.34,
      riverWidth: 1.6,
      riverThreshold: 0.4,
      waterDepth: 0.42,
      coastalShallows: 0.55,
      clouds: 0,
      cloudScale: 5,
      rockBlend: 0.6,               // keep procedural rock on steep faces
      slopeProtect: 0.45,
      snowBlend: 0.7,
      // Imported image
      image: null,                  // { width, height, data: number[] } at runtime
      imageName: '',
      fit: 'cover',
      planar: true,
    },
  };
}

export function defaultTextureStack() {
  return { layers: [...defaultTextureLayers(), createSatmapLayer()], sun: defaultSun() };
}

export function defaultSun() {
  return {
    azimuth: 138,
    elevation: 42,
    intensity: 1.1,
    color: '#fff2dc',
    ambient: 0.42,
    skyColor: '#8fb4d8',
    exposure: 1,
    fog: 0.16,
    fogColor: '#9fb0c0',
  };
}

/* -------------------------------------------------------------- sampling */

/** Bilinear sample of a grid field using normalized UV. */
function sampleField(f, res, u, v) {
  const x = clamp01(u) * (res - 1);
  const y = clamp01(v) * (res - 1);
  const xi = Math.min(res - 2, x | 0), yi = Math.min(res - 2, y | 0);
  const tx = x - xi, ty = y - yi;
  const i = yi * res + xi;
  const a = f[i], b = f[i + 1], c = f[i + res], d = f[i + res + 1];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/** Sample an imported image with wrap, bilinear filtering. */
function sampleImage(img, u, v) {
  if (!img || !img.data) return [128, 128, 128];
  const w = img.width, h = img.height;
  let x = u * w, y = v * h;
  x = ((x % w) + w) % w;
  y = ((y % h) + h) % h;
  const x0 = Math.floor(x) % w, y0 = Math.floor(y) % h;
  const x1 = (x0 + 1) % w, y1 = (y0 + 1) % h;
  const tx = x - Math.floor(x), ty = y - Math.floor(y);
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const a = img.data[(y0 * w + x0) * 4 + c];
    const b = img.data[(y0 * w + x1) * 4 + c];
    const cc = img.data[(y1 * w + x0) * 4 + c];
    const d = img.data[(y1 * w + x1) * 4 + c];
    out[c] = (a + (b - a) * tx) * (1 - ty) + (cc + (d - cc) * tx) * ty;
  }
  return out;
}

const bandMask = (value, min, max, feather) => {
  const f = Math.max(1e-5, feather);
  const lo = clamp01((value - (min - f)) / (2 * f));
  const hi = clamp01(((max + f) - value) / (2 * f));
  return Math.min(lo, hi);
};

const smoothstepMask = (value, threshold, feather) =>
  clamp01((value - (threshold - feather)) / (2 * Math.max(1e-5, feather)));

/**
 * Procedural satellite imagery derived from the terrain itself, so the drape
 * always agrees with the shape underneath: rivers follow real flow accumulation,
 * coastlines follow real height, and farmland sits on real flat ground.
 */
function proceduralSatellite(ctx, u, v, out) {
  const { heightField, slopeField, flowField, res, sat, perlin, perlin2 } = ctx;
  const h = sampleField(heightField, res, u, v);
  const slope = sampleField(slopeField, res, u, v);
  const flow = sampleField(flowField, res, u, v);
  const sea = ctx.seaLevel;

  // Land features must not print across the ocean floor.
  const landMask = clamp01((h - sea) * 30);

  // Vegetation / aridity base tones.
  const arid = sat.aridity;
  const veg = sat.vegetation;
  const patch = fbm(perlin, u * 7 + 11.3, v * 7 + 4.1, 5, 2.1, 0.5);
  const dryPatch = fbm(perlin2, u * 4.2 + 21.7, v * 4.2 + 9.3, 4, 2.0, 0.5);
  const micro = fbm(perlin2, u * 46, v * 46, 3, 2, 0.5);

  // Rain-shadow patches: some of the island is scrub and dry grass, not forest.
  const vegHere = clamp01(veg * (0.35 + 0.9 * dryPatch));
  const dryHere = clamp01(arid * (1.25 - dryPatch));
  let r = 96 + (patch * 46 + dryHere * 34 - arid * 18) * (0.3 + 0.7 * landMask);
  let g = 108 + (patch * 40 + vegHere * 30 - dryHere * 22 - arid * 26) * (0.3 + 0.7 * landMask);
  let b = 66 + (patch * 26 - vegHere * 14 + dryHere * 8 + arid * 22) * (0.3 + 0.7 * landMask);

  // Agricultural parcels: voronoi cells with their own tone, only on flat land.
  if (sat.parcelContrast > 0) {
    const flat = clamp01(1 - slope * 9) * landMask;
    const cell = cellular(u * sat.parcelScale, v * sat.parcelScale, sat.seed, 0);
    const tone = fbm(perlin, cell * 6.5 + 2.2, cell * 3.1, 2, 2, 0.5);
    const mix = sat.parcelContrast * flat * 0.55;
    r += (tone - 0.5) * 70 * mix;
    g += (tone - 0.35) * 62 * mix;
    b += (tone - 0.7) * 46 * mix;
    // Parcel boundaries read as tracks and hedgerows.
    const edge = cellular(u * sat.parcelScale, v * sat.parcelScale, sat.seed, 1);
    const line = clamp01(1 - edge * 5.5) * flat * sat.parcelContrast;
    r += line * 34; g += line * 30; b += line * 20;
  }

  // Elevation grading against the height the land actually occupies, so a
  // 600 m island still reads as lowland-to-summit rather than one flat green.
  const alt = clamp01((h - sea) / 0.42);
  r += alt * 40 - (1 - alt) * 8;
  g += alt * 22 - (1 - alt) * 4;
  b += alt * 8;

  // Rock on steep faces so the drape does not smear over cliffs.
  const rocky = clamp01(slope * 9 - 0.2) * sat.rockBlend;
  const rockTone = 96 + micro * 46;
  r += (rockTone - r) * rocky * 0.8;
  g += (rockTone * 0.95 - g) * rocky * 0.8;
  b += (rockTone * 0.9 - b) * rocky * 0.8;

  // Snow above the snowline.
  const snow = smoothstepMask(alt, 0.82, 0.09) * sat.snowBlend * clamp01(1 - slope * 4);
  r += (236 - r) * snow; g += (242 - g) * snow; b += (248 - b) * snow;

  // Rivers and lakes from the real drainage network, on land only — below sea
  // level the water plane is the ocean itself, not a channel.
  const river = smoothstepMask(flow, sat.riverThreshold, 0.06 + sat.riverWidth * 0.05) * landMask;
  const waterDepth = sat.waterDepth;
  r += (44 - r) * river * 0.82; g += (78 - g) * river * 0.82; b += (92 - b) * river * 0.82;

  const underWater = clamp01((sea - h) / Math.max(0.005, waterDepth * 0.3));
  if (underWater > 0) {
    const shallow = sat.coastalShallows;
    const depthTone = clamp01(underWater / Math.max(0.05, shallow));
    const sr = 42 - depthTone * 22, sg = 96 - depthTone * 58, sb = 112 - depthTone * 62;
    r += (sr - r) * underWater; g += (sg - g) * underWater; b += (sb - b) * underWater;
  }

  // Fine sensor noise: real satellite imagery is never perfectly smooth.
  const grain = (micro - 0.5) * (10 + sat.sharpness * 22);
  r += grain; g += grain; b += grain;

  // Optional cloud shadow / haze pass.
  if (sat.clouds > 0) {
    const c = fbm(perlin2, u * sat.cloudScale + 3.7, v * sat.cloudScale + 8.1, 5, 2, 0.55);
    const cloud = clamp01((c - (1 - sat.clouds)) / Math.max(0.05, sat.clouds));
    r += (238 - r) * cloud * 0.85; g += (242 - g) * cloud * 0.85; b += (246 - b) * cloud * 0.85;
  }

  out[0] = r; out[1] = g; out[2] = b;
  out[3] = 1 - (0.55 + rocky * 0.2 + snow * 0.2 - river * 0.5);
}

/**
 * Bake the surface stack into an RGBA texture.
 *
 * @returns {{ data: Uint8Array, size: number }} albedo in RGB, smoothness in A
 */
export function bakeSurfaceTexture(opts) {
  const {
    res, heightField, slopeField, flowField, talusField,
    layers, size = 1024, seaLevel = 0.2, seed = 1,
  } = opts;

  const data = new Uint8Array(size * size * 4);
  const perlinCache = new Map();
  const perlinFor = (s) => {
    if (!perlinCache.has(s)) perlinCache.set(s, new Perlin(s));
    return perlinCache.get(s);
  };
  const perlin = perlinFor(seed);
  const perlin2 = perlinFor(seed + 977);

  const splats = layers.filter((l) => l.kind === 'splat' && l.enabled !== false);
  const sat = layers.find((l) => l.kind === 'satmap');
  const satOn = sat && sat.enabled !== false;
  const satP = sat ? sat.params : null;
  const rand = mulberry32(seed);

  // Pre-resolve splat colors once per layer.
  const resolved = splats.map((l) => {
    const p = l.params;
    return {
      p,
      a: hexToRgb(p.colorA),
      b: hexToRgb(p.colorB),
      rough: clamp01(p.roughness),
      noise: perlinFor(p.noiseScale ? (seed + Math.round(p.noiseScale * 97)) | 0 : seed),
      detail: perlinFor((seed + Math.round(p.detailScale * 13)) | 0),
      varNoise: perlinFor((seed + Math.round(p.variationScale * 31)) | 0),
    };
  });

  const satCtx = satOn && satP.source === 'procedural'
    ? { heightField, slopeField, flowField, res, sat: satP, perlin, perlin2, seaLevel }
    : null;

  const satImg = satOn && satP.source === 'image' && satP.image ? satP.image : null;
  const rot = satOn ? (satP.rotation * Math.PI) / 180 : 0;
  const cosR = Math.cos(rot), sinR = Math.sin(rot);

  const tmp = [0, 0, 0, 0];

  for (let y = 0; y < size; y++) {
    const v = y / (size - 1);
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const i = (y * size + x) * 4;

      const h = sampleField(heightField, res, u, v);
      const slope = sampleField(slopeField, res, u, v);
      const flow = sampleField(flowField, res, u, v);
      const talus = talusField ? sampleField(talusField, res, u, v) : 0;

      // Base: the deepest material, so gaps fall back to something sensible.
      let r = 64, g = 62, b = 58;
      let rough = 0.8;

      for (const layer of resolved) {
        const p = layer.p;
        let w = 1;
        if (p.heightEnabled) w *= bandMask(h, p.heightMin, p.heightMax, p.heightFeather);
        if (p.slopeEnabled) w *= bandMask(slope, p.slopeMin, p.slopeMax, p.slopeFeather);
        if (p.flowEnabled) w *= smoothstepMask(flow, p.flowMin, p.flowFeather);
        if (p.talusEnabled) w *= smoothstepMask(clamp01(talus * 24), p.talusMin, p.talusFeather);
        if (p.noiseEnabled) {
          const nv = fbm(layer.noise, u * p.noiseScale, v * p.noiseScale, 4, 2, 0.5);
          const shaped = clamp01(Math.pow(nv, 1 / Math.max(0.05, p.noiseContrast)));
          w *= p.noiseThreshold > 0 ? smoothstepMask(shaped, p.noiseThreshold, 0.18) : shaped;
        }
        if (p.cellularEnabled) {
          const cv = 1 - cellular(u * p.cellularScale, v * p.cellularScale, (seed + 31) | 0, 0);
          w *= clamp01(cv * 1.4);
        }
        if (p.invert) w = 1 - w;
        w *= p.opacity;
        if (w <= 0.001) continue;

        // Two-tone variation keeps large areas from looking like flat paint.
        const vm = clamp01(fbm(layer.varNoise, u * p.variationScale, v * p.variationScale, 4, 2, 0.5));
        const t = clamp01((vm - 0.5) * p.variation + 0.5);
        const cr = layer.a[0] + (layer.b[0] - layer.a[0]) * t;
        const cg = layer.a[1] + (layer.b[1] - layer.a[1]) * t;
        const cb = layer.a[2] + (layer.b[2] - layer.a[2]) * t;
        r += (cr - r) * w; g += (cg - g) * w; b += (cb - b) * w;
        rough += (layer.rough - rough) * w;
      }

      // Micro detail: high-frequency luminance variation shared by all layers.
      const dm = (fbm(perlin2, u * 190, v * 190, 3, 2, 0.5) - 0.5) * 22;
      r += dm; g += dm; b += dm;

      if (satOn) {
        // Sample the drape with tiling, offset and rotation around the centre.
        const du = u - 0.5, dv = v - 0.5;
        const su = (du * cosR - dv * sinR) * satP.tiling + 0.5 + satP.offsetX;
        const sv = (du * sinR + dv * cosR) * satP.tiling + 0.5 + satP.offsetY;
        if (satCtx) proceduralSatellite(satCtx, clamp01(su), clamp01(sv), tmp);
        else if (satImg) {
          const c = sampleImage(satImg, su, sv);
          tmp[0] = c[0]; tmp[1] = c[1]; tmp[2] = c[2];
          tmp[3] = 0.45;
        } else {
          tmp[0] = r; tmp[1] = g; tmp[2] = b; tmp[3] = 1 - rough;
        }

        let sr = tmp[0], sg = tmp[1], sb = tmp[2];
        // Grade the drape.
        sr = (sr - 128) * satP.contrast + 128 * satP.brightness;
        sg = (sg - 128) * satP.contrast + 128 * satP.brightness;
        sb = (sb - 128) * satP.contrast + 128 * satP.brightness;
        const lum = sr * 0.299 + sg * 0.587 + sb * 0.114;
        sr = lum + (sr - lum) * satP.saturation;
        sg = lum + (sg - lum) * satP.saturation;
        sb = lum + (sb - lum) * satP.saturation;
        sr += satP.warmth * 18; sb -= satP.warmth * 18;

        // Steep faces keep their procedural rock so cliffs stay readable.
        const protect = clamp01(slope * 5 - 0.3) * satP.slopeProtect;
        const w = clamp01(satP.opacity) * (1 - protect);

        if (satP.mode === 'multiply') {
          r *= 1 - w + (sr / 255) * w;
          g *= 1 - w + (sg / 255) * w;
          b *= 1 - w + (sb / 255) * w;
        } else if (satP.mode === 'replace') {
          r += (sr - r) * w; g += (sg - g) * w; b += (sb - b) * w;
        } else {
          r += (sr - r) * w; g += (sg - g) * w; b += (sb - b) * w;
        }
        rough += (1 - tmp[3] - rough) * w * 0.6;
      }

      data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
      data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      data[i + 3] = clamp01(1 - rough) * 255;
    }
  }

  return { data, size };
}

/**
 * Small, tileable detail-normal texture used to break up the surface at close
 * range. Generated once per session; the shader tiles it in world space.
 */
export function detailNormalTexture(size = 256, seed = 7) {
  const perlin = new Perlin(seed);
  const data = new Uint8Array(size * size * 4);
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Tileable by summing noise at integer frequencies around the torus.
      const u = x / size, v = y / size;
      let s = 0;
      for (let f = 1; f <= 4; f++) {
        const a = (u * f) % 1, b = (v * f) % 1;
        s += perlin.noise(a * 8 * f + f * 13.1, b * 8 * f + f * 7.7) / f;
      }
      heights[y * size + x] = s;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = heights[y * size + ((x - 1 + size) % size)];
      const rr = heights[y * size + ((x + 1) % size)];
      const u = heights[((y - 1 + size) % size) * size + x];
      const d = heights[((y + 1) % size) * size + x];
      let nx = (l - rr) * 3, ny = (u - d) * 3, nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  return { data, size };
}

/** Ramps used by the diagnostic view modes. */
export const RAMPS = {
  height: [[0.00, '#20303c'], [0.18, '#3d6152'], [0.34, '#6d8449'], [0.5, '#9c9a5c'],
    [0.66, '#a68a63'], [0.8, '#8d8279'], [0.9, '#cfd3d8'], [1.0, '#ffffff']],
  slope: [[0.00, '#1c2a24'], [0.2, '#3f6b45'], [0.4, '#9aa347'], [0.6, '#d08b3c'], [0.8, '#c8503a'], [1.0, '#f2e9e2']],
  flow: [[0.00, '#151a20'], [0.25, '#22404f'], [0.5, '#2f7385'], [0.72, '#63b0bd'], [0.88, '#b7dcd8'], [1.0, '#ffffff']],
  erosion: [[0.00, '#3b6f8f'], [0.35, '#7fa8b8'], [0.5, '#2a2a2a'], [0.65, '#c08a5a'], [1.0, '#e05a3c']],
  aspect: [[0.00, '#8fb4d8'], [0.25, '#d8c48f'], [0.5, '#a88fb4'], [0.75, '#8fd8b4'], [1.0, '#8fb4d8']],
};

export function rampColor(ramp, t) {
  const x = clamp01(t);
  for (let i = 1; i < ramp.length; i++) {
    if (x <= ramp[i][0]) {
      const [t0, c0] = ramp[i - 1];
      const [t1, c1] = ramp[i];
      const f = t1 === t0 ? 0 : (x - t0) / (t1 - t0);
      const a = hexToRgb(c0), b = hexToRgb(c1);
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }
  }
  const last = hexToRgb(ramp[ramp.length - 1][1]);
  return last;
}
