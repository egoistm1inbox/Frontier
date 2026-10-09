// Generator registry: every base-shape (and erosion driver) field the
// layer stack can use. A generator maps normalized grid coordinates to a
// signed field in [-1,1]; the pipeline scales it by the layer amplitude.

import { fbm, ridged, billow, multifractal, voronoiF1, perlinNoise, smoothstep, fract } from './noise.js';

const P = {
  amplitude: { key: 'amplitude', label: 'Amplitude', min: 20, max: 2000, step: 10, def: 600, unit: ' m' },
  scale: { key: 'scale', label: 'Scale', min: 1, max: 48, step: 0.5, def: 8, unit: '×' },
  octaves: { key: 'octaves', label: 'Octaves', min: 1, max: 8, step: 1, def: 5 },
  persistence: { key: 'persistence', label: 'Persistence', min: 0.1, max: 0.9, step: 0.05, def: 0.5 },
  lacunarity: { key: 'lacunarity', label: 'Lacunarity', min: 1.4, max: 3.5, step: 0.1, def: 2 },
};

export const generators = [
  {
    id: 'perlin', label: 'Perlin noise',
    params: [P.scale, P.octaves, P.persistence, P.lacunarity, P.amplitude],
    fn: (u, v, p, seed) => fbm(u, v, { octaves: p.octaves, persistence: p.persistence, lacunarity: p.lacunarity, seed }),
  },
  {
    id: 'multifractal', label: 'Multifractal (fBm)',
    params: [
      P.scale, P.octaves, P.lacunarity,
      { key: 'gain', label: 'Gain', min: 0.2, max: 0.95, step: 0.01, def: 0.7 },
      { key: 'offset', label: 'Offset', min: 0, max: 1.5, step: 0.05, def: 0.4 },
      P.amplitude,
    ],
    fn: (u, v, p, seed) => multifractal(u, v, { octaves: p.octaves, lacunarity: p.lacunarity, gain: p.gain, offset: p.offset, seed }),
  },
  {
    id: 'ridged', label: 'Ridged noise',
    params: [P.scale, P.octaves, P.persistence, P.lacunarity,
      { key: 'gain', label: 'Ridge weight', min: 1, max: 4, step: 0.1, def: 2 }, P.amplitude],
    fn: (u, v, p, seed) => ridged(u, v, {
      octaves: p.octaves, persistence: p.persistence, lacunarity: p.lacunarity, gain: p.gain, seed,
    }) * 2 - 1,
  },
  {
    id: 'mountain', label: 'Mountain (billow + ridge)',
    params: [P.scale, P.octaves, P.persistence, P.lacunarity,
      { key: 'ridgeMix', label: 'Ridge mix', min: 0, max: 1, step: 0.05, def: 0.5 }, P.amplitude],
    fn: (u, v, p, seed) => {
      const b = billow(u, v, { octaves: p.octaves, persistence: p.persistence, lacunarity: p.lacunarity, seed });
      const r = ridged(u, v, { octaves: p.octaves, persistence: p.persistence, lacunarity: p.lacunarity, gain: 2, seed }) * 2 - 1;
      return b * (1 - p.ridgeMix) + r * p.ridgeMix;
    },
  },
  {
    id: 'voronoi', label: 'Voronoi cells',
    params: [P.scale, { key: 'jitter', label: 'Cell jitter', min: 0, max: 1, step: 0.05, def: 0.9 }, P.amplitude],
    fn: (u, v, p, seed) => Math.min(1, voronoiF1(u, v, seed, p.jitter) * 0.75) * 2 - 1,
  },
  {
    id: 'warped', label: 'Domain-warped',
    params: [P.scale, P.octaves, P.persistence, P.lacunarity,
      { key: 'warp', label: 'Warp strength', min: 0, max: 3, step: 0.05, def: 1.2 }, P.amplitude],
    fn: (u, v, p, seed) => {
      const qx = fbm(u + 5.2, v + 1.3, { octaves: 2, seed: seed + 3.1 });
      const qy = fbm(u + 9.7, v + 7.1, { octaves: 2, seed: seed + 8.4 });
      return fbm(u + p.warp * qx * 2, v + p.warp * qy * 2, {
        octaves: p.octaves, persistence: p.persistence, lacunarity: p.lacunarity, seed,
      });
    },
  },
  {
    id: 'strata', label: 'Strata (terraced)',
    params: [P.scale,
      { key: 'layers', label: 'Stacks', min: 4, max: 64, step: 1, def: 18 },
      { key: 'width', label: 'Band width', min: 0.2, max: 0.95, step: 0.01, def: 0.6 },
      { key: 'warp', label: 'Warp', min: 0, max: 6, step: 0.1, def: 2.5 },
      P.amplitude],
    fn: (u, v, p, seed, x, y) => {
      const size = p._size || 256;
      const base = fbm(u, v, { octaves: 3, seed });
      const warpField = fbm(u * 0.5 + 31.7, v * 0.5 + 17.3, { octaves: 2, seed: seed + 11 });
      const t = base * p.warp + (y / size) * p.layers + warpField * p.warp;
      const f = fract(t);
      const tri = 1 - Math.abs(f - 0.5) * 2;
      const band = smoothstep(1 - p.width, 1, tri);
      const detail = fbm(u * 2, v * 2, { octaves: 3, seed: seed + 5 });
      return (band * 2 - 1) * (0.55 + 0.45 * detail);
    },
    phase: (u, v, p, seed, x, y) => {
      const size = p._size || 256;
      const base = fbm(u, v, { octaves: 3, seed });
      const warpField = fbm(u * 0.5 + 31.7, v * 0.5 + 17.3, { octaves: 2, seed: seed + 11 });
      return fract(base * p.warp + (y / size) * p.layers + warpField * p.warp);
    },
  },
  {
    id: 'rifted', label: 'Rifted (fault lines)',
    params: [P.scale,
      { key: 'stretch', label: 'Stretch', min: 1, max: 16, step: 0.5, def: 6 },
      { key: 'angle', label: 'Angle', min: 0, max: 360, step: 1, def: 25, unit: '°' },
      { key: 'warp', label: 'Warp', min: 0, max: 4, step: 0.1, def: 1.5 },
      P.octaves, P.amplitude],
    fn: (u, v, p, seed) => {
      const a = p.angle * Math.PI / 180;
      const ca = Math.cos(a), sa = Math.sin(a);
      const rx = (u * ca - v * sa) / p.stretch;
      const ry = u * sa + v * ca;
      const wx = fbm(rx + 7.7, ry + 3.1, { octaves: 2, seed: seed + 2 });
      const wy = fbm(rx + 1.9, ry + 5.5, { octaves: 2, seed: seed + 6 });
      return fbm(rx + p.warp * wx, ry + p.warp * wy, { octaves: p.octaves, seed });
    },
  },
  {
    id: 'dunes', label: 'Dunes (wind ripples)',
    params: [
      { key: 'wavelength', label: 'Wavelength', min: 6, max: 80, step: 1, def: 26, unit: ' cells' },
      { key: 'asymmetry', label: 'Asymmetry', min: 0, max: 2, step: 0.05, def: 0.9 },
      { key: 'direction', label: 'Wind direction', min: 0, max: 360, step: 1, def: 15, unit: '°' },
      { key: 'fieldScale', label: 'Dune fields', min: 2, max: 10, step: 0.5, def: 4, unit: '×' },
      P.amplitude],
    fn: (u, v, p, seed, x, y) => {
      const size = p._size || 256;
      const a = p.direction * Math.PI / 180;
      const d = (x * Math.cos(a) + y * Math.sin(a));
      const s = Math.sin(d / p.wavelength * Math.PI * 2);
      const asym = Math.sign(s) * Math.pow(Math.abs(s), 1 / (1 + p.asymmetry));
      const field = fbm(x / (size / p.fieldScale), y / (size / p.fieldScale), { octaves: 3, seed });
      return asym * 0.72 + field * 0.28;
    },
  },
  {
    id: 'island', label: 'Island (radial falloff)',
    params: [
      { key: 'radius', label: 'Radius', min: 0.3, max: 0.95, step: 0.01, def: 0.62 },
      { key: 'falloff', label: 'Edge falloff', min: 0.05, max: 0.5, step: 0.01, def: 0.22 },
      P.scale, P.octaves, P.persistence, P.amplitude],
    fn: (u, v, p, seed, x, y) => {
      const size = p._size || 256;
      const d = Math.hypot(x - size / 2, y - size / 2) / (size * 0.5);
      const fo = 1 - smoothstep(p.radius, p.radius + p.falloff, d);
      const base = fbm(u, v, { octaves: p.octaves, persistence: p.persistence, seed });
      return base * (0.25 + 0.75 * fo);
    },
  },
];

export function generatorById(id) {
  return generators.find((g) => g.id === id) || generators[0];
}

export function generatorDefaults(id) {
  const gen = generatorById(id);
  const out = {};
  for (const def of gen.params) out[def.key] = def.def;
  return out;
}
