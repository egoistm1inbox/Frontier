// Terrain layer registry.
// Every layer type is a schema (drives the inspector) plus GPU code (drives the build).
// kind 'point'  → evaluated by the shared point template (one dispatch, any neighbourhood reads allowed)
// kind 'sim'    → custom multi-pass simulation implemented in sims.js
// role 'generator' → returns a layer value that is blended onto the input height
// role 'modifier'  → returns a new height, mixed with the input by opacity × mask

export const BLEND_MODES = ['Add', 'Max', 'Min', 'Subtract', 'Multiply', 'Replace', 'Smooth max', 'Smooth min'];
export const MASK_MODES = ['None', 'Height', 'Slope', 'Noise', 'Radial'];

const pos = (cards = 'Placement') => ({
  posX: { label: 'Position X', type: 'float', min: 0, max: 1, step: 0.001, default: 0.5, unit: '%', card: cards, ui: 'xy', pair: 'posY' },
  posY: { label: 'Position Y', type: 'float', min: 0, max: 1, step: 0.001, default: 0.5, unit: '%', card: cards, ui: 'hidden' },
});

export const TERRAIN_TYPES = {
  // ───────────────────────────── PRIMITIVES ─────────────────────────────
  mountains: {
    label: 'Mountains', category: 'Primitives', icon: 'mountain', color: '#d6a078', role: 'generator', kind: 'point',
    blurb: 'Massifs, ranges and fields of ridged peaks', defaultBlend: 1,
    cards: [
      { id: 'Form', icon: 'mountain', metric: 'height', note: 'Peak elevation above the base' },
      { id: 'Ridges', icon: 'spline', metric: 'ridgeScale', note: 'Primary ridge wavelength' },
      { id: 'Placement', icon: 'crosshair' },
    ],
    params: {
      shape: { label: 'Shape', type: 'enum', options: ['Massif', 'Range', 'Field'], default: 1, card: 'Form' },
      height: { label: 'Peak height', type: 'float', min: 50, max: 5000, step: 10, default: 1900, unit: 'm', card: 'Form' },
      scale: { label: 'Footprint', type: 'float', min: 0.5, max: 24, step: 0.1, default: 7.5, unit: 'km', card: 'Form' },
      bulk: { label: 'Bulk', type: 'float', min: 0.4, max: 2.5, step: 0.01, default: 1.15, unit: '×', card: 'Form', hint: ['Broad', 'Spiky'] },
      ridgeScale: { label: 'Ridge wavelength', type: 'float', min: 0.2, max: 8, step: 0.05, default: 2.2, unit: 'km', card: 'Ridges' },
      ridgeAmount: { label: 'Ridge strength', type: 'float', min: 0, max: 1, step: 0.01, default: 0.85, unit: '%', card: 'Ridges' },
      sharpness: { label: 'Sharpness', type: 'float', min: 1, max: 4, step: 0.05, default: 2.1, unit: '×', card: 'Ridges' },
      detail: { label: 'Detail octaves', type: 'int', min: 2, max: 12, step: 1, default: 9, card: 'Ridges' },
      roughness: { label: 'Roughness', type: 'float', min: 0.2, max: 0.7, step: 0.01, default: 0.5, unit: '%', card: 'Ridges' },
      erosive: { label: 'Pre-erosion', type: 'float', min: 0, max: 1, step: 0.01, default: 0.45, unit: '%', card: 'Ridges' },
      warp: { label: 'Warp', type: 'float', min: 0, max: 1, step: 0.01, default: 0.35, unit: '%', card: 'Placement' },
      rotation: { label: 'Rotation', type: 'float', min: -180, max: 180, step: 1, default: 18, unit: '°', card: 'Placement', ui: 'dial' },
      ...pos(),
    },
    wgsl: /* wgsl */`
fn layer(uv: vec2f, hin: f32, gid: vec2u) -> f32 {
  let s = C.seed;
  let R = rot2(radians(P.rotation));
  var q = R * ((uv - vec2f(P.posX, P.posY)) * C.world / (P.scale * 500.0));
  let wq = warp2(q, P.warp * 0.5, 0.8, s + 3u);
  var base = 0.0;
  if (P.shape < 0.5) {
    let r = length(wq);
    base = 1.0 - sstep(0.0, 1.0, r);
  } else if (P.shape < 1.5) {
    let r = length(vec2f(wq.x * 0.42, wq.y * 1.75));
    base = 1.0 - sstep(0.0, 1.0, r);
  } else {
    base = clamp(0.62 + 0.6 * fbm(wq * 0.55, 4, 2.0, 0.5, s + 5u), 0.0, 1.0);
  }
  let pr = R * ((uv - 0.5) * C.world / (P.ridgeScale * 1000.0));
  let prw = warp2(pr, 0.15 + P.warp * 0.5, 0.35, s + 9u);
  let oct = i32(P.detail);
  let rr = ridged(prw, oct, 2.03, P.roughness, P.sharpness, s);
  let er = erosive(prw * 0.7, oct, 2.0, 0.5, 2.0 + 10.0 * P.erosive, s + 17u) * 0.5 + 0.5;
  let detail = mix(rr, rr * 0.55 + er * 0.6, P.erosive);
  let core = 0.35 + 0.65 * base;
  var h = base * mix(1.0, detail * 1.3 + 0.08, P.ridgeAmount * core);
  h = pow(max(h, 0.0), P.bulk);
  return h * P.height / C.hscale;
}`,
  },

  noise: {
    label: 'Noise', category: 'Primitives', icon: 'waves', color: '#b3b3d5', role: 'generator', kind: 'point',
    blurb: 'fBm, ridged, billow, Swiss, erosive and cellular fields', defaultBlend: 0,
    cards: [
      { id: 'Field', icon: 'waves', metric: 'height', note: 'Amplitude of the noise field' },
      { id: 'Fractal', icon: 'activity', metric: 'scale', note: 'Largest feature size' },
      { id: 'Warp', icon: 'spline', switch: 'warpOn' },
      { id: 'Transform', icon: 'move' },
    ],
    switches: [{ key: 'warpOn', label: 'Domain warp', icon: 'spline' }],
    params: {
      ntype: { label: 'Type', type: 'enum', options: ['fBm', 'Ridged', 'Billow', 'Swiss', 'Erosive', 'Cells', 'Cracks'], default: 1, card: 'Field' },
      height: { label: 'Amplitude', type: 'float', min: 0, max: 3000, step: 5, default: 420, unit: 'm', card: 'Field' },
      contrast: { label: 'Contrast', type: 'float', min: 0.2, max: 3, step: 0.01, default: 1, unit: '×', card: 'Field' },
      bias: { label: 'Bias', type: 'float', min: -0.6, max: 0.6, step: 0.01, default: 0, card: 'Field' },
      scale: { label: 'Feature size', type: 'float', min: 0.05, max: 16, step: 0.01, default: 1.6, unit: 'km', card: 'Fractal' },
      detail: { label: 'Octaves', type: 'int', min: 1, max: 12, step: 1, default: 8, card: 'Fractal' },
      roughness: { label: 'Roughness', type: 'float', min: 0.2, max: 0.8, step: 0.01, default: 0.5, unit: '%', card: 'Fractal' },
      lacunarity: { label: 'Lacunarity', type: 'float', min: 1.5, max: 3, step: 0.01, default: 2.05, unit: '×', card: 'Fractal' },
      sharpness: { label: 'Ridge sharpness', type: 'float', min: 1, max: 4, step: 0.05, default: 2, unit: '×', card: 'Fractal' },
      warpOn: { label: 'Domain warp', type: 'bool', default: true, card: 'Warp' },
      warp: { label: 'Warp strength', type: 'float', min: 0, max: 2, step: 0.01, default: 0.45, unit: '×', card: 'Warp' },
      warpScale: { label: 'Warp frequency', type: 'float', min: 0.05, max: 2, step: 0.01, default: 0.35, unit: '×', card: 'Warp' },
      rotation: { label: 'Rotation', type: 'float', min: -180, max: 180, step: 1, default: 0, unit: '°', card: 'Transform', ui: 'dial' },
      offsetX: { label: 'Offset X', type: 'float', min: -50, max: 50, step: 0.01, default: 0, card: 'Transform' },
      offsetY: { label: 'Offset Y', type: 'float', min: -50, max: 50, step: 0.01, default: 0, card: 'Transform' },
    },
    wgsl: /* wgsl */`
fn layer(uv: vec2f, hin: f32, gid: vec2u) -> f32 {
  var p = rot2(radians(P.rotation)) * ((uv - 0.5) * C.world / (P.scale * 1000.0)) + vec2f(P.offsetX, P.offsetY);
  if (P.warpOn > 0.5) { p = warp2(p, P.warp, P.warpScale, C.seed + 101u); }
  let oct = i32(P.detail);
  let t = i32(P.ntype + 0.5);
  var v = 0.0;
  switch t {
    case 0: { v = fbm(p, oct, P.lacunarity, P.roughness, C.seed) * 0.5 + 0.5; }
    case 1: { v = ridged(p, oct, P.lacunarity, P.roughness, P.sharpness, C.seed); }
    case 2: { v = billow(p, oct, P.lacunarity, P.roughness, C.seed) * 0.5 + 0.5; }
    case 3: { v = swiss(p, oct, P.lacunarity, P.roughness, 0.3, C.seed); }
    case 4: { v = erosive(p, oct, P.lacunarity, P.roughness, 4.0, C.seed) * 0.5 + 0.5; }
    case 5: { let f = voronoi(p, 1.0, C.seed); v = clamp(f.x * 1.1, 0.0, 1.0); }
    case 6: { let f = voronoi(p, 1.0, C.seed); v = 1.0 - clamp((f.y - f.x) * 2.2, 0.0, 1.0); }
    default: { v = 0.0; }
  }
  v = max((v - 0.5) * P.contrast + 0.5 + P.bias, 0.0);
  return v * P.height / C.hscale;
}`,
  },

  volcano: {
    label: 'Volcano', category: 'Primitives', icon: 'flame', color: '#d98f73', role: 'generator', kind: 'point',
    blurb: 'Stratovolcano with caldera and radial gullies', defaultBlend: 6,
    cards: [
      { id: 'Cone', icon: 'triangle', metric: 'height', note: 'Summit elevation' },
      { id: 'Caldera', icon: 'circle-dot', metric: 'caldera', note: 'Summit crater as share of radius' },
      { id: 'Flanks', icon: 'spline' },
      { id: 'Placement', icon: 'crosshair' },
    ],
    params: {
      height: { label: 'Summit height', type: 'float', min: 100, max: 5000, step: 10, default: 1700, unit: 'm', card: 'Cone' },
      radius: { label: 'Base radius', type: 'float', min: 0.5, max: 12, step: 0.05, default: 3.6, unit: 'km', card: 'Cone' },
      concavity: { label: 'Flank concavity', type: 'float', min: 0.8, max: 3.5, step: 0.01, default: 1.9, unit: '×', card: 'Cone', hint: ['Shield', 'Strato'] },
      caldera: { label: 'Caldera size', type: 'float', min: 0, max: 0.45, step: 0.005, default: 0.11, unit: '%', card: 'Caldera' },
      calderaDepth: { label: 'Caldera depth', type: 'float', min: 0, max: 800, step: 5, default: 220, unit: 'm', card: 'Caldera' },
      rim: { label: 'Rim lip', type: 'float', min: 0, max: 1, step: 0.01, default: 0.4, unit: '%', card: 'Caldera' },
      gullies: { label: 'Gully depth', type: 'float', min: 0, max: 1, step: 0.01, default: 0.6, unit: '%', card: 'Flanks' },
      gullyFreq: { label: 'Gully count', type: 'float', min: 2, max: 40, step: 0.5, default: 14, card: 'Flanks' },
      warp: { label: 'Irregularity', type: 'float', min: 0, max: 1, step: 0.01, default: 0.3, unit: '%', card: 'Flanks' },
      ...pos(),
    },
    wgsl: /* wgsl */`
fn layer(uv: vec2f, hin: f32, gid: vec2u) -> f32 {
  var q = (uv - vec2f(P.posX, P.posY)) * C.world / (P.radius * 1000.0);
  q = warp2(q, P.warp * 0.22, 1.4, C.seed + 31u);
  let r = length(q);
  let a = atan2(q.y, q.x);
  let k = P.concavity;
  var cone = pow(max(0.0, 1.0 - r), k);
  let ring = vec3f(cos(a), sin(a), 0.0) * P.gullyFreq * 0.16;
  let g1 = 1.0 - abs(gnoise3(ring + vec3f(0.0, 0.0, r * 2.5), C.seed + 3u));
  let g2 = 1.0 - abs(gnoise3(ring * 2.7 + vec3f(5.1, 1.3, r * 6.0), C.seed + 4u));
  let g = g1 * 0.65 + g2 * 0.35;
  cone *= 1.0 + P.gullies * (g - 0.62) * 0.55 * sstep(0.03, 0.35, r) * (1.0 - sstep(0.8, 1.0, r));
  let cr = P.caldera;
  if (cr > 0.002) {
    let rimH = pow(max(0.0, 1.0 - cr), k);
    let outer = select(cone, rimH, r < cr);
    let floorH = rimH - P.calderaDepth / max(P.height, 1.0);
    let t = sstep(cr * 0.62, cr * 1.02, r);
    cone = mix(max(floorH, 0.0), outer, t);
    cone += P.rim * 0.04 * exp(-pow((r - cr) / (0.06 * max(cr, 0.05) + 0.01), 2.0));
  }
  return max(cone, 0.0) * P.height / C.hscale;
}`,
  },

  crater: {
    label: 'Crater', category: 'Primitives', icon: 'circle-dashed', color: '#c7b39a', role: 'generator', kind: 'point',
    blurb: 'Impact crater with rim, ejecta and central peak', defaultBlend: 0,
    cards: [
      { id: 'Bowl', icon: 'circle-dashed', metric: 'radius', note: 'Rim radius' },
      { id: 'Rim', icon: 'circle' },
      { id: 'Placement', icon: 'crosshair' },
    ],
    params: {
      radius: { label: 'Radius', type: 'float', min: 0.1, max: 10, step: 0.01, default: 1.4, unit: 'km', card: 'Bowl' },
      depth: { label: 'Depth', type: 'float', min: 0, max: 1500, step: 5, default: 380, unit: 'm', card: 'Bowl' },
      peak: { label: 'Central peak', type: 'float', min: 0, max: 1, step: 0.01, default: 0.35, unit: '%', card: 'Bowl' },
      rimHeight: { label: 'Rim height', type: 'float', min: 0, max: 800, step: 5, default: 160, unit: 'm', card: 'Rim' },
      rimWidth: { label: 'Rim width', type: 'float', min: 0.04, max: 0.6, step: 0.01, default: 0.18, unit: '%', card: 'Rim' },
      ejecta: { label: 'Ejecta', type: 'float', min: 0, max: 1, step: 0.01, default: 0.6, unit: '%', card: 'Rim' },
      warp: { label: 'Irregularity', type: 'float', min: 0, max: 1, step: 0.01, default: 0.35, unit: '%', card: 'Rim' },
      ...pos(),
    },
    wgsl: /* wgsl */`
fn layer(uv: vec2f, hin: f32, gid: vec2u) -> f32 {
  var q = (uv - vec2f(P.posX, P.posY)) * C.world / (P.radius * 1000.0);
  q = warp2(q, P.warp * 0.12, 2.2, C.seed + 11u);
  let r = length(q);
  let bowl = -P.depth * (1.0 - r * r) * (1.0 - sstep(0.85, 1.0, r));
  let rim = P.rimHeight * exp(-pow((r - 1.0) / P.rimWidth, 2.0));
  let ang = atan2(q.y, q.x);
  let rays = 0.6 + 0.4 * (1.0 - abs(gnoise3(vec3f(cos(ang), sin(ang), 0.0) * 6.0 + vec3f(0.0, 0.0, r * 0.7), C.seed + 5u)));
  let ej = select(0.0, P.rimHeight * 0.55 * P.ejecta * pow(1.0 / max(r, 1.0), 3.0) * rays, r > 1.0);
  let pk = P.peak * P.depth * 0.7 * exp(-pow(r / 0.16, 2.0));
  return (bowl + rim + ej + pk) / C.hscale;
}`,
  },

  mesa: {
    label: 'Canyonlands', category: 'Primitives', icon: 'land-plot', color: '#d39a6a', role: 'generator', kind: 'point',
    blurb: 'Stepped mesas, buttes and meandering canyons', defaultBlend: 0,
    cards: [
      { id: 'Plateaus', icon: 'land-plot', metric: 'height', note: 'Plateau relief' },
      { id: 'Cliffs', icon: 'layers' },
      { id: 'Canyons', icon: 'waves-arrow-down', metric: 'canyonDepth', note: 'Canyon incision' },
    ],
    params: {
      height: { label: 'Relief', type: 'float', min: 50, max: 3000, step: 10, default: 900, unit: 'm', card: 'Plateaus' },
      scale: { label: 'Mesa size', type: 'float', min: 0.3, max: 16, step: 0.05, default: 4.5, unit: 'km', card: 'Plateaus' },
      coverage: { label: 'Coverage', type: 'float', min: 0, max: 1, step: 0.01, default: 0.55, unit: '%', card: 'Plateaus' },
      levels: { label: 'Strata levels', type: 'int', min: 1, max: 14, step: 1, default: 5, card: 'Cliffs' },
      cliff: { label: 'Cliff steepness', type: 'float', min: 0, max: 1, step: 0.01, default: 0.82, unit: '%', card: 'Cliffs' },
      talus: { label: 'Talus apron', type: 'float', min: 0, max: 1, step: 0.01, default: 0.45, unit: '%', card: 'Cliffs' },
      canyonDepth: { label: 'Canyon depth', type: 'float', min: 0, max: 1, step: 0.01, default: 0.7, unit: '%', card: 'Canyons' },
      canyonWidth: { label: 'Canyon width', type: 'float', min: 0, max: 1, step: 0.01, default: 0.4, unit: '%', card: 'Canyons' },
      meander: { label: 'Meander', type: 'float', min: 0, max: 1.5, step: 0.01, default: 0.7, unit: '×', card: 'Canyons' },
    },
    wgsl: /* wgsl */`
fn layer(uv: vec2f, hin: f32, gid: vec2u) -> f32 {
  let p = (uv - 0.5) * C.world / (P.scale * 1000.0);
  let pw = warp2(p, 0.25 + P.meander * 0.35, 0.7, C.seed + 2u);
  var n = fbm(pw, 6, 2.0, 0.5, C.seed) * 0.62 + P.coverage;
  let cp = warp2(p * 1.2, P.meander * 0.8, 0.8, C.seed + 5u);
  let c = abs(fbm(cp, 5, 2.0, 0.45, C.seed + 9u));
  let w = 0.015 + P.canyonWidth * 0.09;
  let canyon = 1.0 - sstep(w, w + 0.035 + 0.05 * P.talus, c);
  n = clamp(n - canyon * P.canyonDepth * 0.85, 0.0, 1.0);
  let L = P.levels;
  let t = n * L;
  let k = floor(t);
  let f = t - k;
  let rw = mix(0.5, 0.035, P.cliff);
  var rise = sstep(1.0 - rw, 1.0, f);
  rise = mix(rise, sqrt(rise), P.talus * 0.6);
  let apron = P.talus * 0.18 * sstep(0.55, 1.0 - rw, f);
  var h = (k + max(rise, apron)) / L;
  h += fbm(p * 9.0, 4, 2.0, 0.5, C.seed + 77u) * 0.012;
  return h * P.height / C.hscale;
}`,
  },

  dunes: {
    label: 'Dunes', category: 'Primitives', icon: 'wind', color: '#e0b77a', role: 'generator', kind: 'point',
    blurb: 'Wind-built transverse dunes with slip faces', defaultBlend: 0,
    cards: [
      { id: 'Dunes', icon: 'wind', metric: 'height', note: 'Crest height' },
      { id: 'Wind', icon: 'navigation', metric: 'direction', note: 'Prevailing wind bearing' },
    ],
    params: {
      height: { label: 'Crest height', type: 'float', min: 1, max: 300, step: 1, default: 60, unit: 'm', card: 'Dunes' },
      wavelength: { label: 'Wavelength', type: 'float', min: 20, max: 3000, step: 5, default: 520, unit: 'm', card: 'Dunes' },
      asym: { label: 'Slip-face asymmetry', type: 'float', min: 0.5, max: 0.95, step: 0.01, default: 0.78, unit: '%', card: 'Dunes' },
      irregular: { label: 'Irregularity', type: 'float', min: 0, max: 1, step: 0.01, default: 0.55, unit: '%', card: 'Dunes' },
      secondary: { label: 'Secondary dunes', type: 'float', min: 0, max: 1, step: 0.01, default: 0.35, unit: '%', card: 'Dunes' },
      direction: { label: 'Wind bearing', type: 'float', min: 0, max: 360, step: 1, default: 60, unit: '°', card: 'Wind', ui: 'dial' },
    },
    wgsl: /* wgsl */`
fn duneProfile(ph: f32, a: f32) -> f32 {
  let t = fract(ph);
  var pr = select((1.0 - t) / (1.0 - a), t / a, t < a);
  pr = sstep(0.0, 1.0, pr);
  return pr;
}
fn layer(uv: vec2f, hin: f32, gid: vec2u) -> f32 {
  let pm = (uv - 0.5) * C.world;
  let q = rot2(-radians(P.direction)) * pm / P.wavelength;
  let iw = P.irregular;
  let ph = q.x + fbm(vec2f(q.y * 0.18, q.x * 0.06), 4, 2.0, 0.5, C.seed + 4u) * iw * 2.2;
  let amp = 0.45 + 0.55 * clamp(fbm(vec2f(q.y * 0.22, ph * 0.12), 4, 2.0, 0.5, C.seed + 8u) * 0.8 + 0.5, 0.0, 1.0);
  var h = duneProfile(ph, P.asym) * amp;
  let q2 = rot2(0.6) * q * 2.7;
  let ph2 = q2.x + fbm(q2 * 0.2, 3, 2.0, 0.5, C.seed + 12u) * iw * 2.0;
  h += duneProfile(ph2, P.asym) * P.secondary * 0.28 * (0.5 + 0.5 * amp);
  h += (fbm(q * 0.12, 4, 2.0, 0.5, C.seed + 21u) * 0.5 + 0.5) * 0.6;
  return h * P.height / C.hscale;
}`,
  },

  shape: {
    label: 'Shape', category: 'Primitives', icon: 'square-dashed', color: '#a5b8c7', role: 'generator', kind: 'point',
    blurb: 'Island, edge falloff, gradient, cone or plateau', defaultBlend: 4,
    cards: [
      { id: 'Shape', icon: 'square-dashed', metric: 'radius', note: 'Inner extent before falloff' },
      { id: 'Edge', icon: 'spline' },
      { id: 'Placement', icon: 'crosshair' },
    ],
    params: {
      form: { label: 'Form', type: 'enum', options: ['Island', 'Edge', 'Gradient', 'Cone', 'Plateau'], default: 0, card: 'Shape' },
      height: { label: 'Height (additive modes)', type: 'float', min: -3000, max: 3000, step: 5, default: 600, unit: 'm', card: 'Shape' },
      radius: { label: 'Extent', type: 'float', min: 0, max: 1, step: 0.005, default: 0.62, unit: '%', card: 'Shape' },
      falloff: { label: 'Falloff', type: 'float', min: 0.01, max: 1, step: 0.005, default: 0.32, unit: '%', card: 'Edge' },
      coast: { label: 'Edge noise', type: 'float', min: 0, max: 1, step: 0.01, default: 0.45, unit: '%', card: 'Edge' },
      coastScale: { label: 'Edge noise size', type: 'float', min: 0.1, max: 8, step: 0.05, default: 1.8, unit: 'km', card: 'Edge' },
      direction: { label: 'Gradient bearing', type: 'float', min: 0, max: 360, step: 1, default: 0, unit: '°', card: 'Placement', ui: 'dial' },
      ...pos(),
    },
    wgsl: /* wgsl */`
fn layer(uv: vec2f, hin: f32, gid: vec2u) -> f32 {
  let pm = (uv - 0.5) * C.world;
  let n = fbm(pm / (P.coastScale * 1000.0), 6, 2.0, 0.5, C.seed + 55u) * P.coast * 0.35;
  let c = uv - vec2f(P.posX, P.posY);
  let f = max(P.falloff, 0.005);
  var v = 0.0;
  let form = i32(P.form + 0.5);
  switch form {
    case 0: { let r = length(c) * 2.0 + n; v = 1.0 - sstep(P.radius, P.radius + f, r); }
    case 1: { let e = max(abs(c.x), abs(c.y)) * 2.0 + n; v = 1.0 - sstep(P.radius, P.radius + f, e); }
    case 2: { let d = vec2f(cos(radians(P.direction)), sin(radians(P.direction))); v = clamp(dot(c, d) / f + 0.5 + n, 0.0, 1.0); }
    case 3: { let r = length(c) * 2.0 + n; v = max(0.0, 1.0 - r / max(P.radius + f, 0.01)); }
    case 4: { v = 1.0 + n; }
    default: { v = 0.0; }
  }
  if (C.blend == 4u) { return v; }
  return v * P.height / C.hscale;
}`,
  },

  // ───────────────────────────── MODIFIERS ─────────────────────────────
  warp: {
    label: 'Warp', category: 'Modifiers', icon: 'spline', color: '#bea4e1', role: 'modifier', kind: 'point',
    blurb: 'Domain-warp the terrain into organic flow',
    cards: [{ id: 'Warp', icon: 'spline', metric: 'amount', note: 'Maximum displacement' }],
    params: {
      amount: { label: 'Displacement', type: 'float', min: 0, max: 2000, step: 5, default: 320, unit: 'm', card: 'Warp' },
      scale: { label: 'Feature size', type: 'float', min: 0.1, max: 16, step: 0.05, default: 2.5, unit: 'km', card: 'Warp' },
      detail: { label: 'Octaves', type: 'int', min: 1, max: 8, step: 1, default: 4, card: 'Warp' },
      swirl: { label: 'Swirl', type: 'float', min: 0, max: 1, step: 0.01, default: 0.3, unit: '%', card: 'Warp' },
    },
    wgsl: /* wgsl */`
fn layer(uv: vec2f, hin: f32, gid: vec2u) -> f32 {
  let p = (uv - 0.5) * C.world / (P.scale * 1000.0);
  let oct = i32(P.detail);
  var w = vec2f(fbm(p + vec2f(3.1, 7.7), oct, 2.0, 0.5, C.seed), fbm(p + vec2f(-11.3, 2.9), oct, 2.0, 0.5, C.seed + 5u));
  let nd = gnoised(p * 0.6, C.seed + 9u);
  w = mix(w, vec2f(-nd.z, nd.y) * 0.6, P.swirl);
  let tp = vec2f(gid) + 0.5 + w * P.amount / C.cell;
  return hBil(tp);
}`,
  },

  terrace: {
    label: 'Terrace', category: 'Modifiers', icon: 'layers', color: '#cab281', role: 'modifier', kind: 'point',
    blurb: 'Stratified steps with tilt, jitter and noise',
    cards: [
      { id: 'Steps', icon: 'layers', metric: 'stepHeight', note: 'Height of each stratum' },
      { id: 'Strata', icon: 'trending-up' },
    ],
    params: {
      stepHeight: { label: 'Step height', type: 'float', min: 2, max: 600, step: 1, default: 85, unit: 'm', card: 'Steps' },
      flatness: { label: 'Tread width', type: 'float', min: 0, max: 0.95, step: 0.01, default: 0.6, unit: '%', card: 'Steps' },
      steepness: { label: 'Riser steepness', type: 'float', min: 0, max: 1, step: 0.01, default: 0.7, unit: '%', card: 'Steps' },
      uneven: { label: 'Uneven strata', type: 'float', min: 0, max: 1, step: 0.01, default: 0.45, unit: '%', card: 'Steps' },
      intensity: { label: 'Intensity', type: 'float', min: 0, max: 1, step: 0.01, default: 0.85, unit: '%', card: 'Steps' },
      tilt: { label: 'Dip angle', type: 'float', min: 0, max: 20, step: 0.1, default: 2.5, unit: '°', card: 'Strata' },
      tiltDir: { label: 'Dip bearing', type: 'float', min: 0, max: 360, step: 1, default: 140, unit: '°', card: 'Strata', ui: 'dial' },
      noise: { label: 'Strata noise', type: 'float', min: 0, max: 300, step: 1, default: 40, unit: 'm', card: 'Strata' },
      noiseScale: { label: 'Noise size', type: 'float', min: 0.1, max: 10, step: 0.05, default: 1.2, unit: 'km', card: 'Strata' },
    },
    wgsl: /* wgsl */`
fn layer(uv: vec2f, hin: f32, gid: vec2u) -> f32 {
  let hm = hin * C.hscale;
  let pm = (uv - 0.5) * C.world;
  let d = vec2f(cos(radians(P.tiltDir)), sin(radians(P.tiltDir)));
  let tilt = dot(pm, d) * tan(radians(P.tilt));
  let nz = fbm(pm / (P.noiseScale * 1000.0), 5, 2.0, 0.5, C.seed + 33u) * P.noise;
  let x = (hm + tilt + nz) / P.stepHeight;
  let k = floor(x);
  let f = x - k;
  let j = (hash1(u32(i32(k) + 65536) * 2654435761u ^ C.seed) - 0.5) * P.uneven;
  let tread = clamp(P.flatness + j * 0.8, 0.0, 0.97);
  let top = mix(1.0, min(tread + 0.03, 1.0), P.steepness);
  let rise = sstep(tread, max(top, tread + 0.001), f);
  let ht = (k + rise) * P.stepHeight - tilt - nz;
  return mix(hm, ht, P.intensity) / C.hscale;
}`,
  },

  curve: {
    label: 'Height Curve', category: 'Modifiers', icon: 'trending-up', color: '#9fc3d8', role: 'modifier', kind: 'point',
    blurb: 'Levels, gamma and a free curve over elevation', needsLUT: true, needsStats: true,
    cards: [
      { id: 'Curve', icon: 'trending-up', ui: 'curve' },
      { id: 'Levels', icon: 'sliders-horizontal' },
    ],
    params: {
      curve: { label: 'Curve', type: 'curve', default: [[0, 0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.75], [1, 1]], card: 'Curve', gpu: false },
      autoLevel: { label: 'Auto-level input', type: 'bool', default: true, card: 'Levels' },
      inMin: { label: 'Input low', type: 'float', min: -500, max: 6000, step: 5, default: 0, unit: 'm', card: 'Levels' },
      inMax: { label: 'Input high', type: 'float', min: 0, max: 6000, step: 5, default: 2400, unit: 'm', card: 'Levels' },
      gamma: { label: 'Gamma', type: 'float', min: 0.2, max: 4, step: 0.01, default: 1, unit: '×', card: 'Levels' },
      outMin: { label: 'Output low', type: 'float', min: -500, max: 6000, step: 5, default: 0, unit: 'm', card: 'Levels' },
      outMax: { label: 'Output high', type: 'float', min: 0, max: 6000, step: 5, default: 2400, unit: 'm', card: 'Levels' },
    },
    wgsl: /* wgsl */`
fn layer(uv: vec2f, hin: f32, gid: vec2u) -> f32 {
  let hm = hin * C.hscale;
  var lo = P.inMin; var hi = P.inMax;
  if (P.autoLevel > 0.5) { lo = stats[0] * C.hscale; hi = stats[1] * C.hscale; }
  var x = clamp((hm - lo) / max(hi - lo, 1e-3), 0.0, 1.0);
  x = pow(x, P.gamma);
  let fi = x * 255.0;
  let i0 = u32(floor(fi));
  let i1 = min(i0 + 1u, 255u);
  x = mix(lut[i0], lut[i1], fi - floor(fi));
  return (P.outMin + x * (P.outMax - P.outMin)) / C.hscale;
}`,
  },

  smoothen: {
    label: 'Smooth', category: 'Modifiers', icon: 'circle', color: '#a8c2cc', role: 'modifier', kind: 'point', needsAux: true,
    blurb: 'Gaussian smooth, sharpen or valley fill',
    cards: [{ id: 'Filter', icon: 'circle', metric: 'radius', note: 'Filter radius' }],
    params: {
      mode: { label: 'Mode', type: 'enum', options: ['Smooth', 'Sharpen', 'Fill valleys', 'Soften peaks'], default: 0, card: 'Filter' },
      radius: { label: 'Radius', type: 'float', min: 1, max: 600, step: 1, default: 40, unit: 'm', card: 'Filter', aux: 'blur' },
      strength: { label: 'Strength', type: 'float', min: 0, max: 1, step: 0.01, default: 0.6, unit: '%', card: 'Filter' },
    },
    wgsl: /* wgsl */`
fn layer(uv: vec2f, hin: f32, gid: vec2u) -> f32 {
  let b = aux[gid.y * C.N + gid.x];
  let m = i32(P.mode + 0.5);
  switch m {
    case 0: { return mix(hin, b, P.strength); }
    case 1: { return hin + (hin - b) * P.strength * 2.0; }
    case 2: { return hin + max(b - hin, 0.0) * P.strength; }
    case 3: { return hin - max(hin - b, 0.0) * P.strength; }
    default: { return hin; }
  }
}`,
  },

  // ───────────────────────────── SIMULATION ─────────────────────────────
  fluvial: {
    label: 'Fluvial Erosion', category: 'Erosion', icon: 'waves-arrow-down', color: '#81b8c8', role: 'modifier', kind: 'sim',
    blurb: 'Stream-power river incision: dendritic valleys and ridgelines',
    produces: ['flow', 'wear', 'deposit'],
    cards: [
      { id: 'Rivers', icon: 'waves-arrow-down', metric: 'strength', note: 'Channel downcutting' },
      { id: 'Time', icon: 'activity', metric: 'duration', note: 'Simulated duration' },
      { id: 'Uplift', icon: 'mountain', switch: 'upliftOn' },
      { id: 'Hillslopes', icon: 'triangle' },
    ],
    switches: [
      { key: 'upliftOn', label: 'Tectonic uplift', icon: 'mountain' },
      { key: 'fillPits', label: 'Lake sediment', icon: 'droplets' },
    ],
    params: {
      strength: { label: 'Downcutting', type: 'float', min: 0, max: 1, step: 0.01, default: 0.55, unit: '%', card: 'Rivers' },
      concavity: { label: 'Channel concavity', type: 'float', min: 0.3, max: 0.7, step: 0.01, default: 0.45, card: 'Rivers' },
      spread: { label: 'Channelling', type: 'float', min: 0, max: 1, step: 0.01, default: 0.4, unit: '%', card: 'Rivers', hint: ['Dispersive', 'Channelled'] },
      rainVar: { label: 'Rain variation', type: 'float', min: 0, max: 1, step: 0.01, default: 0.3, unit: '%', card: 'Rivers' },
      duration: { label: 'Duration', type: 'float', min: 0.05, max: 1, step: 0.01, default: 0.45, unit: '%', card: 'Time' },
      upliftOn: { label: 'Tectonic uplift', type: 'bool', default: false, card: 'Uplift' },
      uplift: { label: 'Uplift rate', type: 'float', min: 0, max: 1, step: 0.01, default: 0.5, unit: '%', card: 'Uplift' },
      keepHeight: { label: 'Preserve peak height', type: 'bool', default: true, card: 'Uplift' },
      talus: { label: 'Hillslope angle', type: 'float', min: 15, max: 60, step: 0.5, default: 38, unit: '°', card: 'Hillslopes' },
      soften: { label: 'Soil creep', type: 'float', min: 0, max: 1, step: 0.01, default: 0.15, unit: '%', card: 'Hillslopes' },
      fillPits: { label: 'Lake sediment', type: 'bool', default: true, card: 'Hillslopes' },
      fillRate: { label: 'Sediment fill', type: 'float', min: 0, max: 1, step: 0.01, default: 0.4, unit: '%', card: 'Hillslopes' },
    },
  },

  hydraulic: {
    label: 'Hydraulic Erosion', category: 'Erosion', icon: 'droplets', color: '#75c7df', role: 'modifier', kind: 'sim',
    blurb: 'Millions of rain droplets carve gullies and lay sediment',
    produces: ['flow', 'wear', 'deposit'],
    cards: [
      { id: 'Rain', icon: 'droplets', metric: 'rain', note: 'Droplets per terrain cell' },
      { id: 'Sediment', icon: 'shovel' },
      { id: 'Droplet', icon: 'droplet' },
    ],
    switches: [{ key: 'depositOn', label: 'Deposition', icon: 'shovel' }, { key: 'smoothOn', label: 'Smoothing', icon: 'circle' }],
    params: {
      rain: { label: 'Rainfall', type: 'float', min: 0.1, max: 12, step: 0.1, default: 3, unit: '×', card: 'Rain' },
      erosion: { label: 'Erosion rate', type: 'float', min: 0, max: 1, step: 0.01, default: 0.45, unit: '%', card: 'Rain' },
      capacity: { label: 'Carry capacity', type: 'float', min: 0.5, max: 16, step: 0.1, default: 5, unit: '×', card: 'Sediment' },
      depositOn: { label: 'Deposition', type: 'bool', default: true, card: 'Sediment' },
      deposition: { label: 'Deposition rate', type: 'float', min: 0, max: 1, step: 0.01, default: 0.3, unit: '%', card: 'Sediment' },
      smoothOn: { label: 'Smoothing', type: 'bool', default: true, card: 'Sediment' },
      smoothing: { label: 'Result smoothing', type: 'float', min: 0, max: 1, step: 0.01, default: 0.35, unit: '%', card: 'Sediment' },
      inertia: { label: 'Inertia', type: 'float', min: 0, max: 0.95, step: 0.01, default: 0.25, unit: '%', card: 'Droplet' },
      evaporation: { label: 'Evaporation', type: 'float', min: 0.002, max: 0.1, step: 0.001, default: 0.018, card: 'Droplet' },
      brush: { label: 'Brush radius', type: 'float', min: 1, max: 60, step: 0.5, default: 14, unit: 'm', card: 'Droplet' },
      lifetime: { label: 'Path length', type: 'float', min: 0.1, max: 6, step: 0.05, default: 1.2, unit: 'km', card: 'Droplet' },
    },
  },

  thermal: {
    label: 'Thermal Erosion', category: 'Erosion', icon: 'pickaxe', color: '#c29583', role: 'modifier', kind: 'sim',
    blurb: 'Weathered rock slides into talus at its angle of repose',
    produces: ['talus'],
    cards: [{ id: 'Talus', icon: 'pickaxe', metric: 'angle', note: 'Angle of repose' }],
    params: {
      angle: { label: 'Repose angle', type: 'float', min: 10, max: 70, step: 0.5, default: 34, unit: '°', card: 'Talus' },
      variance: { label: 'Angle variance', type: 'float', min: 0, max: 1, step: 0.01, default: 0.35, unit: '%', card: 'Talus' },
      iterations: { label: 'Iterations', type: 'int', min: 4, max: 400, step: 1, default: 60, card: 'Talus' },
      rate: { label: 'Slide rate', type: 'float', min: 0.05, max: 1, step: 0.01, default: 0.5, unit: '%', card: 'Talus' },
    },
  },

  hydrology: {
    label: 'Rivers & Lakes', category: 'Water', icon: 'waves', color: '#74bdd4', role: 'modifier', kind: 'sim',
    blurb: 'Exact drainage: carves river channels, fills lakes with water',
    produces: ['water', 'flow'],
    cards: [
      { id: 'Rivers', icon: 'waves', metric: 'threshold', note: 'Catchment needed to form a river' },
      { id: 'Channel', icon: 'waves-arrow-down' },
      { id: 'Lakes', icon: 'droplets', switch: 'lakesOn' },
    ],
    switches: [{ key: 'lakesOn', label: 'Lakes', icon: 'droplets' }, { key: 'valleysOn', label: 'Valley carving', icon: 'mountain' }],
    params: {
      threshold: { label: 'River source area', type: 'float', min: 0.05, max: 20, step: 0.05, default: 3.5, unit: 'km²', card: 'Rivers' },
      width: { label: 'Width scale', type: 'float', min: 2, max: 120, step: 1, default: 18, unit: 'm', card: 'Channel' },
      depth: { label: 'Depth scale', type: 'float', min: 0.5, max: 40, step: 0.5, default: 6, unit: 'm', card: 'Channel' },
      banks: { label: 'Bank softness', type: 'float', min: 0, max: 1, step: 0.01, default: 0.55, unit: '%', card: 'Channel' },
      valleysOn: { label: 'Valley carving', type: 'bool', default: true, card: 'Channel' },
      valley: { label: 'Valley width', type: 'float', min: 0, max: 1, step: 0.01, default: 0.4, unit: '%', card: 'Channel' },
      lakesOn: { label: 'Lakes', type: 'bool', default: true, card: 'Lakes' },
      lakeDepth: { label: 'Min lake depth', type: 'float', min: 0.2, max: 30, step: 0.1, default: 3.5, unit: 'm', card: 'Lakes' },
      lakeArea: { label: 'Min lake area', type: 'float', min: 0, max: 2, step: 0.01, default: 0.2, unit: 'km²', card: 'Lakes' },
    },
  },

  snow: {
    label: 'Snowfall', category: 'Water', icon: 'snowflake', color: '#a4c6e6', role: 'modifier', kind: 'sim',
    blurb: 'Snow accumulates by altitude, aspect and wind, then avalanches',
    produces: ['snow'],
    cards: [
      { id: 'Snowline', icon: 'mountain-snow', metric: 'snowline', note: 'Lowest altitude snow settles' },
      { id: 'Settling', icon: 'snowflake' },
      { id: 'Exposure', icon: 'sun' },
    ],
    params: {
      snowline: { label: 'Snowline', type: 'float', min: 0, max: 5000, step: 10, default: 1500, unit: 'm', card: 'Snowline' },
      fade: { label: 'Transition', type: 'float', min: 10, max: 1200, step: 5, default: 260, unit: 'm', card: 'Snowline' },
      depth: { label: 'Snow depth', type: 'float', min: 0.1, max: 30, step: 0.1, default: 4, unit: 'm', card: 'Settling' },
      maxSlope: { label: 'Max slope', type: 'float', min: 10, max: 80, step: 0.5, default: 46, unit: '°', card: 'Settling' },
      avalanche: { label: 'Avalanche iterations', type: 'int', min: 0, max: 200, step: 1, default: 40, card: 'Settling' },
      addHeight: { label: 'Add snow to height', type: 'bool', default: true, card: 'Settling' },
      aspect: { label: 'Shade preference', type: 'float', min: 0, max: 1, step: 0.01, default: 0.45, unit: '%', card: 'Exposure' },
      aspectDir: { label: 'Shaded bearing', type: 'float', min: 0, max: 360, step: 1, default: 0, unit: '°', card: 'Exposure', ui: 'dial' },
      drift: { label: 'Wind drift', type: 'float', min: 0, max: 1, step: 0.01, default: 0.5, unit: '%', card: 'Exposure' },
    },
  },
};

// Seeds are always available for every layer.
for (const t of Object.values(TERRAIN_TYPES)) {
  t.params.seed = { label: 'Seed', type: 'seed', default: 1, card: '_seed' };
}

export const TERRAIN_CATEGORIES = [
  { id: 'Primitives', icon: 'mountain', note: 'Shapes that create elevation' },
  { id: 'Modifiers', icon: 'sliders-horizontal', note: 'Reshape what is below' },
  { id: 'Erosion', icon: 'droplets', note: 'Physically based weathering' },
  { id: 'Water', icon: 'waves', note: 'Hydrology and snow' },
];

const RESERVED = new Set(['type', 'filter', 'common', 'smooth', 'shared', 'set', 'get', 'move', 'mod', 'match', 'pass', 'target', 'layout', 'resource', 'precision', 'partition', 'patch', 'meta', 'module', 'new', 'of', 'from', 'self', 'static', 'std', 'use', 'with', 'where', 'enum', 'struct', 'var', 'let', 'const', 'fn', 'loop', 'for', 'if', 'else', 'switch', 'case', 'default', 'return', 'break', 'continue', 'true', 'false', 'override', 'alias', 'array', 'bool', 'f32', 'i32', 'u32', 'vec2', 'vec3', 'vec4', 'texture', 'sampler', 'uniform', 'storage', 'private', 'function', 'workgroup', 'ptr', 'bitcast', 'discard', 'diagnostic', 'requires', 'enable', 'while', 'do', 'continuing']);
for (const [name, t] of Object.entries(TERRAIN_TYPES)) {
  for (const k of Object.keys(t.params)) if (RESERVED.has(k)) throw new Error(`Param ${name}.${k} uses a reserved WGSL word`);
}

export function defaultParams(type) {
  const t = TERRAIN_TYPES[type];
  const p = {};
  for (const [k, d] of Object.entries(t.params)) p[k] = Array.isArray(d.default) ? d.default.map(x => Array.isArray(x) ? [...x] : x) : d.default;
  return p;
}

let uid = 0;
export function newId(prefix = 'L') { return prefix + Date.now().toString(36) + (uid++).toString(36) + Math.floor(Math.random() * 1e4).toString(36); }

export function makeTerrainLayer(type, overrides = {}) {
  const t = TERRAIN_TYPES[type];
  return {
    id: newId('t'), type, name: overrides.name || t.label, enabled: true,
    params: { ...defaultParams(type), ...(overrides.params || {}) },
    blend: { mode: t.defaultBlend ?? 0, opacity: 1, smooth: 120, ...(overrides.blend || {}) },
    mask: { mode: 0, min: 0, max: 2400, falloff: 120, scale: 2, invert: false, ...(overrides.mask || {}) },
  };
}
