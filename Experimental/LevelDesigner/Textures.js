// Procedural surface textures, painted on canvases at first use and cached: floors (polished concrete, epoxy,
// marble, oak, terrazzo, honed stone, rubber, lit glass), walls (board-formed concrete, plaster, block), and the
// small things the lobby pieces need (bark, leaves, fabric, brushed metal, grass). Every texture tiles seamlessly
// (periodic noise), so a floor can repeat across a room without seams.
import { THREE } from '../Shared/Studio/Render.js';

// ------------------------------------------------------------------------------------------------------ noise
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

// Periodic value noise: a lattice of random values that wraps every `period` cells.
function lattice(period, seed) {
  const r = rng(seed), v = new Float32Array(period * period);
  for (let i = 0; i < v.length; i++) v[i] = r();
  return v;
}
const smooth = (t) => t * t * (3 - 2 * t);
function noiseAt(lat, period, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi);
  const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
  const a = lat[y0 * period + x0], b = lat[y0 * period + x1], c = lat[y1 * period + x0], d = lat[y1 * period + x1];
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}
// fbm over the unit square [0,1)², tiling. `base` = lattice cells across the tile at the first octave.
function makeFbm(seed, base = 4, octaves = 5) {
  const lats = [];
  for (let o = 0; o < octaves; o++) lats.push(lattice(base << o, seed + o * 101));
  return (u, v, oct = octaves) => {
    let sum = 0, amp = 0.5, norm = 0;
    for (let o = 0; o < oct; o++) {
      const p = base << o;
      sum += noiseAt(lats[o], p, u * p, v * p) * amp;
      norm += amp; amp *= 0.5;
    }
    return sum / norm;
  };
}

// ---------------------------------------------------------------------------------------------------- canvas
function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}
function paintPixels(size, fn) {
  const c = canvas(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const [r, g, b, a = 255] = fn(x / size, y / size, x, y);
    const i = (y * size + x) * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
// Canvas pixels are sRGB: read the hex digits directly (THREE.Color would hand back linear values).
const hex = (h) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (x) => Math.min(1, Math.max(0, x));

function texture(c, { srgb = true, repeat = 1 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.repeat.set(repeat, repeat);
  return t;
}

const cache = new Map();
function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

// ---------------------------------------------------------------------------------------------- surface sets
// Each painter returns { map, roughnessMap?, bumpMap?, emissiveMap? } canvases; `metres` = how many metres one tile
// covers in the world (used to set texture repeat on large surfaces).
const PAINTERS = {
  // Polished concrete: cool mottled grey, trowel clouds, fine pores. Rough where the trowel left haze.
  concrete: () => {
    const n = makeFbm(11, 3, 6), pore = makeFbm(12, 64, 2);
    const S = 512, base = hex('#8f9296'), dark = hex('#6d7074'), light = hex('#adb0b3');
    const rough = [];
    const map = paintPixels(S, (u, v) => {
      const m = n(u, v), p = pore(u, v);
      let c = m < 0.5 ? mix(dark, base, m * 2) : mix(base, light, (m - 0.5) * 2);
      if (p > 0.78) c = mix(c, dark, 0.5);
      rough.push(0.35 + m * 0.3 + (p > 0.78 ? 0.3 : 0));
      return c;
    });
    return { map, roughnessMap: grey(S, rough), metres: 6 };
  },
  // Epoxy: satin grey resin with scattered colour flakes.
  epoxy: () => {
    const S = 512, r = rng(31), n = makeFbm(32, 4, 3);
    const c = paintPixels(S, (u, v) => mix(hex('#5d6268'), hex('#6b7077'), n(u, v)));
    const ctx = c.getContext('2d');
    const flakes = ['#e8e8e8', '#202226', '#9aa3ad', '#3a4048', '#c9c2b5'];
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = flakes[(r() * flakes.length) | 0];
      const x = r() * S, y = r() * S, s = 0.6 + r() * 1.8;
      ctx.save(); ctx.translate(x, y); ctx.rotate(r() * 3.14); ctx.fillRect(-s, -s * 0.6, s * 2, s * 1.2); ctx.restore();
    }
    return { map: c, metres: 3 };
  },
  // White marble: soft grey veins from warped stripes.
  marble: () => {
    const S = 1024, n = makeFbm(41, 3, 6), w = makeFbm(42, 2, 4);
    const white = hex('#eceae6'), vein = hex('#8c8a88'), warm = hex('#d9d4cc');
    const rough = [];
    const map = paintPixels(S, (u, v) => {
      const t = Math.sin((u + v * 0.6) * Math.PI * 4 + n(u, v) * 9 + w(u, v) * 4);
      const veinK = Math.pow(1 - Math.abs(t), 18) * 0.85 + Math.pow(1 - Math.abs(t), 4) * 0.15;
      let c = mix(white, warm, w(u, v) * 0.6);
      c = mix(c, vein, veinK);
      rough.push(0.12 + veinK * 0.1);
      return c;
    });
    return { map, roughnessMap: grey(S, rough), metres: 4 };
  },
  // Oak planks: 8 boards per tile, staggered ends, grain lines and a dark seam.
  oak: () => {
    const S = 1024, grain = makeFbm(51, 4, 5), fine = makeFbm(52, 128, 2), r = rng(53);
    const boards = 8, tones = Array.from({ length: boards * 2 }, () => r());
    const ends = Array.from({ length: boards }, () => r());
    const height = [];
    const map = paintPixels(S, (u, v) => {
      const b = Math.floor(v * boards), bv = v * boards - b;
      const shifted = (u + ends[b]) % 1;
      const half = shifted < 0.5 ? 0 : 1, bu = (shifted * 2) % 1;
      const tone = tones[b * 2 + half];
      const g = grain(u * 0.25 + tone, v * 4 + tone * 3);
      const lines = Math.pow(Math.abs(Math.sin((bv + g * 3) * Math.PI * 7)), 6);
      let c = mix(hex('#a07448'), hex('#c49a6c'), tone * 0.7 + g * 0.3);
      c = mix(c, hex('#7a5232'), lines * 0.35 + fine(u, v) * 0.15);
      const seam = bv < 0.012 || bv > 0.988 || bu < 0.004 || bu > 0.996;
      if (seam) c = mix(c, hex('#3a2616'), 0.8);
      height.push(seam ? 0 : 0.8 + lines * 0.2);
      return c;
    });
    return { map, bumpMap: grey(S, height), metres: 4 };
  },
  // Terrazzo: warm white cement with chips of stone and glass.
  terrazzo: () => {
    const S = 1024, r = rng(61), n = makeFbm(62, 4, 3);
    const c = paintPixels(S, (u, v) => mix(hex('#e3dfd8'), hex('#d6d1c8'), n(u, v)));
    const ctx = c.getContext('2d');
    const chips = ['#9b9690', '#5b5853', '#c6b9a6', '#2f2f31', '#b77a5b', '#e9e7e2', '#7f8a8c'];
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = chips[(r() * chips.length) | 0];
      const x = r() * S, y = r() * S, s = 2 + Math.pow(r(), 3) * 16;
      ctx.beginPath();
      const k = 5 + ((r() * 3) | 0);
      for (let j = 0; j < k; j++) { const a = (j / k) * 6.283 + r() * 0.8, rr = s * (0.6 + r() * 0.5); ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      ctx.fill();
    }
    return { map: c, metres: 3 };
  },
  // Honed stone: 2 × 2 large-format tiles with fine grout and soft cloudy variation.
  stone: () => {
    const S = 1024, n = makeFbm(71, 4, 6), r = rng(72), tone = [r(), r(), r(), r()];
    const height = [];
    const map = paintPixels(S, (u, v) => {
      const tx = u < 0.5 ? 0 : 1, ty = v < 0.5 ? 0 : 1;
      const gu = (u * 2) % 1, gv = (v * 2) % 1;
      const grout = gu < 0.004 || gu > 0.996 || gv < 0.004 || gv > 0.996;
      let c = mix(hex('#b5aea3'), hex('#c9c3b8'), n(u, v) * 0.7 + tone[ty * 2 + tx] * 0.3);
      if (grout) c = hex('#8a847b');
      height.push(grout ? 0 : 1);
      return c;
    });
    return { map, bumpMap: grey(S, height), metres: 2.4 };
  },
  // Coin rubber: black studded flooring (garages, workshops).
  rubber: () => {
    const S = 256, n = makeFbm(81, 8, 3), height = [];
    const map = paintPixels(S, (u, v) => {
      const cu = (u * 8) % 1 - 0.5, cv = (v * 8) % 1 - 0.5, d = Math.hypot(cu, cv);
      const stud = d < 0.28 ? 1 : d < 0.32 ? 1 - (d - 0.28) / 0.04 : 0;
      height.push(0.3 + stud * 0.7);
      return mix(hex('#1b1c1e'), hex('#2a2b2e'), n(u, v) * 0.6 + stud * 0.3);
    });
    return { map, bumpMap: grey(S, height), metres: 1.2 };
  },
  // Lit glass: smoked glass tiles with a light grid glowing up from below.
  litglass: () => {
    const S = 512, glow = [];
    const map = paintPixels(S, (u, v) => {
      const gu = (u * 2) % 1, gv = (v * 2) % 1;
      const e = Math.min(Math.min(gu, 1 - gu), Math.min(gv, 1 - gv));
      const line = clamp01(1 - e / 0.012);
      glow.push(line);
      return mix(hex('#0b0c0f'), hex('#16181c'), line);
    });
    return { map, emissiveMap: grey(S, glow, true), metres: 2 };
  },
  // Board-formed concrete: horizontal timber-board imprints, tie holes on a grid.
  boardConcrete: () => {
    const S = 1024, n = makeFbm(91, 3, 5), g = makeFbm(92, 2, 4), r = rng(93), boards = 10;
    const tones = Array.from({ length: boards }, () => r());
    const height = [];
    const map = paintPixels(S, (u, v) => {
      const b = Math.floor(v * boards), bv = v * boards - b;
      const grain = Math.abs(Math.sin((u * 3 + g(u, v * 0.3 + b) * 2) * Math.PI * 8)) * 0.08;
      let c = mix(hex('#9c9a96'), hex('#b8b5b0'), n(u, v) * 0.6 + tones[b] * 0.3 + grain);
      const seam = bv < 0.02;
      const hu = (u * 4) % 1 - 0.5, hv = (v * 2.5) % 1 - 0.5, hole = Math.hypot(hu * 4, hv * 2.5 * 4 / 2.5) < 0.06;
      if (seam) c = mix(c, hex('#7c7a76'), 0.7);
      if (hole) c = hex('#55534f');
      height.push(hole ? 0 : seam ? 0.4 : 0.9 + grain);
      return c;
    });
    return { map, bumpMap: grey(S, height), metres: 5 };
  },
  // Lime plaster: very soft warm white clouds.
  plaster: () => {
    const S = 512, n = makeFbm(101, 3, 6);
    return { map: paintPixels(S, (u, v) => mix(hex('#e9e5df'), hex('#f5f2ec'), n(u, v))), metres: 4 };
  },
  // Painted block wall (garage): 400 × 200 mm blocks, half bond.
  block: () => {
    const S = 512, n = makeFbm(111, 16, 3), height = [];
    const map = paintPixels(S, (u, v) => {
      const row = Math.floor(v * 10), bu = (u * 5 + (row % 2) * 0.5) % 1, bv = v * 10 - row;
      const joint = bu < 0.02 || bv < 0.04;
      height.push(joint ? 0 : 0.8 + n(u, v) * 0.2);
      return joint ? hex('#a9abae') : mix(hex('#cfd1d3'), hex('#dcdee0'), n(u, v));
    });
    return { map, bumpMap: grey(S, height), metres: 2 };
  },
  bark: () => {
    const S = 256, n = makeFbm(121, 4, 5), height = [];
    const map = paintPixels(S, (u, v) => {
      const ridges = Math.pow(Math.abs(Math.sin((u * 6 + n(u * 0.5, v * 2) * 2.5) * Math.PI)), 0.6);
      height.push(ridges);
      return mix(hex('#3b2e24'), hex('#7a6a5a'), ridges * 0.8 + n(u, v) * 0.2);
    });
    return { map, bumpMap: grey(S, height), metres: 1 };
  },
  fabric: () => {
    const S = 256, n = makeFbm(131, 8, 3);
    return { map: paintPixels(S, (u, v, x, y) => { const w = ((x >> 1) + (y >> 1)) % 2 ? 0.06 : 0; const k = n(u, v) * 0.5 + w; return mix(hex('#bdbdbd'), hex('#ffffff'), k); }), metres: 0.5 };
  },
  brushed: () => {
    const S = 256, n = makeFbm(141, 2, 2), r = rng(142);
    const rows = Array.from({ length: S }, () => r());
    const rough = [];
    const map = paintPixels(S, (u, v, x, y) => { const k = rows[y] * 0.6 + n(u, v) * 0.4; rough.push(0.25 + k * 0.2); return mix(hex('#d8dadd'), hex('#f2f3f5'), k); });
    return { map, roughnessMap: grey(S, rough), metres: 0.6 };
  },
  grass: () => {
    const S = 512, n = makeFbm(151, 6, 5), fine = makeFbm(152, 128, 2);
    return { map: paintPixels(S, (u, v) => mix(mix(hex('#3f5d2a'), hex('#6a8a3e'), n(u, v)), hex('#2d4520'), fine(u, v) * 0.45)), metres: 4 };
  },
  // Leaf cluster card (RGBA): a spray of leaves on transparent, used on instanced foliage cards.
  leaves: () => {
    const S = 256, c = canvas(S), ctx = c.getContext('2d'), r = rng(161);
    for (let i = 0; i < 26; i++) {
      const x = S / 2 + (r() - 0.5) * S * 0.7, y = S / 2 + (r() - 0.5) * S * 0.7, a = r() * 6.283, len = 30 + r() * 26;
      const tone = r();
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = `rgb(${50 + tone * 50 | 0},${90 + tone * 60 | 0},${36 + tone * 30 | 0})`;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(len * 0.5, -len * 0.32, len, 0); ctx.quadraticCurveTo(len * 0.5, len * 0.32, 0, 0); ctx.fill();
      ctx.strokeStyle = 'rgba(20,40,15,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len * 0.9, 0); ctx.stroke();
      ctx.restore();
    }
    return { map: c, metres: 1 };
  },
};

function grey(S, values, srgb = false) {
  const c = canvas(S), ctx = c.getContext('2d'), img = ctx.createImageData(S, S), d = img.data;
  for (let i = 0; i < values.length; i++) { const k = clamp01(values[i]) * 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = k; d[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  c.srgb = srgb;
  return c;
}

// Textures for a surface name. Returned textures are shared; clone() them before changing repeat per use.
export function surfaceTextures(name) {
  return cached(name, () => {
    const painted = PAINTERS[name]();
    const out = { metres: painted.metres || 1, swatch: painted.map };
    out.map = texture(painted.map);
    if (painted.roughnessMap) out.roughnessMap = texture(painted.roughnessMap, { srgb: false });
    if (painted.bumpMap) out.bumpMap = texture(painted.bumpMap, { srgb: false });
    if (painted.emissiveMap) out.emissiveMap = texture(painted.emissiveMap, { srgb: true });
    return out;
  });
}

// A swatch image (data URL) of a surface, for the Details tiles.
export function surfaceSwatch(name, size = 96) {
  return cached(`swatch:${name}:${size}`, () => {
    const src = surfaceTextures(name).swatch;
    const c = canvas(size), ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0, src.width * 0.5, src.height * 0.5, 0, 0, size, size);
    return c.toDataURL('image/png');
  });
}

// Copies of a surface's textures repeated so that one tile covers `metres` metres over a `width` × `height` surface.
export function tiled(name, width, height, metresOverride = null) {
  const t = surfaceTextures(name), m = metresOverride || t.metres;
  const out = {};
  for (const k of ['map', 'roughnessMap', 'bumpMap', 'emissiveMap']) {
    if (!t[k]) continue;
    const c = t[k].clone();
    c.repeat.set(width / m, height / m);
    c.needsUpdate = true;
    out[k] = c;
  }
  return out;
}

export const SURFACE_NAMES = Object.keys(PAINTERS);
