// Texturing layer catalogue (Substance-style generators). A texturing layer paints a colour and a
// roughness for every texel, then blends into the stack through its mask stack. Masks come from the
// same catalogue as the terrain masks, so "snow above 260 m" or "rivers only" work the same way.

export const TEXTURE_BLEND_MODES = [
  { id: 'normal', label: 'Normal' }, { id: 'multiply', label: 'Multiply' }, { id: 'overlay', label: 'Overlay' },
  { id: 'screen', label: 'Screen' }, { id: 'add', label: 'Add' }, { id: 'darken', label: 'Darken' }, { id: 'lighten', label: 'Lighten' },
];

export const TEXTURE_CATEGORIES = [
  { id: 'fill', name: 'Fills', blurb: 'Base colour of the ground' },
  { id: 'surface', name: 'Surfaces', blurb: 'Soil, vegetation, snow and river beds' },
  { id: 'detail', name: 'Detail', blurb: 'Cavity, wetness and grain' },
  { id: 'water', name: 'Water', blurb: 'Only where water actually is' },
];

const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16) / 255);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export const TEXTURE_TYPES = {
  fill: {
    name: 'Fill', category: 'fill', blend: 'normal', blurb: 'A flat colour everywhere',
    params: [
      { key: 'colour', label: 'Colour', colour: true, value: '#8a7a66' },
      { key: 'roughness', label: 'Roughness', min: 0, max: 1, step: 0.01, value: 0.8 },
    ],
    paint(tc, p, L) {
      const c = hex(p.colour);
      for (let i = 0; i < L.r.length; i++) { L.r[i] = c[0]; L.g[i] = c[1]; L.b[i] = c[2]; L.rough[i] = p.roughness; }
    },
  },

  rock: {
    name: 'Rock', category: 'fill', blend: 'normal', blurb: 'Bedrock colour from the hardness of each bed',
    params: [
      { key: 'hard', label: 'Hard beds', colour: true, value: '#b9ad99' },
      { key: 'soft', label: 'Soft beds', colour: true, value: '#7d6d5b' },
      { key: 'variation', label: 'Variation', min: 0, max: 1, step: 0.01, value: 0.5 },
      { key: 'grain', label: 'Grain', min: 0, max: 1, step: 0.01, value: 0.35 },
      { key: 'roughness', label: 'Roughness', min: 0, max: 1, step: 0.01, value: 0.9 },
    ],
    paint(tc, p, L) {
      const hard = hex(p.hard), soft = hex(p.soft);
      const n = tc.noise(120, 21), g = tc.grain;
      for (let i = 0; i < L.r.length; i++) {
        const c = mix(soft, hard, tc.hard[i]);
        const k = (1 + p.variation * (n[i] - 0.5)) * (1 + p.grain * (g[i] - 0.5) * 0.4);
        L.r[i] = c[0] * k; L.g[i] = c[1] * k; L.b[i] = c[2] * k; L.rough[i] = p.roughness;
      }
    },
  },

  cliff: {
    name: 'Cliff face', category: 'fill', blend: 'normal', blurb: 'Darker, blockier rock on steep faces',
    params: [
      { key: 'colour', label: 'Colour', colour: true, value: '#4d443a' },
      { key: 'grain', label: 'Grain', min: 0, max: 1, step: 0.01, value: 0.5 },
      { key: 'roughness', label: 'Roughness', min: 0, max: 1, step: 0.01, value: 0.92 },
    ],
    defaultMasks: [{ type: 'slope', params: { min: 38, max: 90, feather: 6 } }],
    paint(tc, p, L) {
      const c = hex(p.colour), g = tc.grain;
      for (let i = 0; i < L.r.length; i++) {
        const k = 1 + p.grain * (g[i] - 0.5) * 0.6;
        L.r[i] = c[0] * k; L.g[i] = c[1] * k; L.b[i] = c[2] * k; L.rough[i] = p.roughness;
      }
    },
  },

  soil: {
    name: 'Soil', category: 'surface', blend: 'normal', blurb: 'Earth on gentle ground',
    params: [
      { key: 'colour', label: 'Colour', colour: true, value: '#6e5c46' },
      { key: 'grain', label: 'Grain', min: 0, max: 1, step: 0.01, value: 0.4 },
      { key: 'roughness', label: 'Roughness', min: 0, max: 1, step: 0.01, value: 0.9 },
    ],
    paint(tc, p, L) {
      const c = hex(p.colour), g = tc.grain;
      for (let i = 0; i < L.r.length; i++) {
        const k = 1 + p.grain * (g[i] - 0.5) * 0.6;
        L.r[i] = c[0] * k; L.g[i] = c[1] * k; L.b[i] = c[2] * k; L.rough[i] = p.roughness;
      }
    },
    defaultMasks: [{ type: 'slope', params: { min: 0, max: 26, feather: 6 } }],
  },

  grass: {
    name: 'Grass', category: 'surface', blend: 'normal', blurb: 'Vegetation in patches',
    params: [
      { key: 'colourA', label: 'Colour A', colour: true, value: '#5b6b38' },
      { key: 'colourB', label: 'Colour B', colour: true, value: '#7f8b4c' },
      { key: 'patches', label: 'Patch scale', unit: 'm', min: 20, max: 600, step: 5, value: 90 },
      { key: 'roughness', label: 'Roughness', min: 0, max: 1, step: 0.01, value: 0.85 },
    ],
    paint(tc, p, L) {
      const a = hex(p.colourA), b = hex(p.colourB);
      const n = tc.noise(p.patches, 33);
      for (let i = 0; i < L.r.length; i++) {
        const c = mix(a, b, n[i]);
        L.r[i] = c[0]; L.g[i] = c[1]; L.b[i] = c[2]; L.rough[i] = p.roughness;
      }
    },
    defaultMasks: [{ type: 'slope', params: { min: 0, max: 38, feather: 6 } }],
  },

  snow: {
    name: 'Snow', category: 'surface', blend: 'normal', blurb: 'Snow cover above a height line',
    params: [
      { key: 'colour', label: 'Colour', colour: true, value: '#e8ecef' },
      { key: 'roughness', label: 'Roughness', min: 0, max: 1, step: 0.01, value: 0.55 },
    ],
    paint(tc, p, L) {
      const c = hex(p.colour);
      for (let i = 0; i < L.r.length; i++) { L.r[i] = c[0]; L.g[i] = c[1]; L.b[i] = c[2]; L.rough[i] = p.roughness; }
    },
    defaultMasks: [{ type: 'height', params: { min: 260, max: 2000, feather: 40 } }, { type: 'slope', params: { min: 0, max: 48, feather: 6 }, blend: 'multiply' }],
  },

  gravel: {
    name: 'Gravel', category: 'surface', blend: 'normal', blurb: 'Pebbles in river beds',
    params: [
      { key: 'colourA', label: 'Colour A', colour: true, value: '#a0968a' },
      { key: 'colourB', label: 'Colour B', colour: true, value: '#68645d' },
      { key: 'roughness', label: 'Roughness', min: 0, max: 1, step: 0.01, value: 0.8 },
    ],
    paint(tc, p, L) {
      const a = hex(p.colourA), b = hex(p.colourB), g = tc.grain;
      for (let i = 0; i < L.r.length; i++) {
        const c = mix(a, b, g[i]);
        L.r[i] = c[0]; L.g[i] = c[1]; L.b[i] = c[2]; L.rough[i] = p.roughness;
      }
    },
    defaultMasks: [{ type: 'water', params: { kind: 'river', feather: 0.25 } }],
  },

  silt: {
    name: 'Silt', category: 'surface', blend: 'normal', blurb: 'Fine sediment on lake floors',
    params: [
      { key: 'colour', label: 'Colour', colour: true, value: '#a69c83' },
      { key: 'roughness', label: 'Roughness', min: 0, max: 1, step: 0.01, value: 0.7 },
    ],
    paint(tc, p, L) {
      const c = hex(p.colour);
      for (let i = 0; i < L.r.length; i++) { L.r[i] = c[0]; L.g[i] = c[1]; L.b[i] = c[2]; L.rough[i] = p.roughness; }
    },
    defaultMasks: [{ type: 'water', params: { kind: 'lake', feather: 0.25 } }],
  },

  water: {
    name: 'Water', category: 'water', blend: 'normal', blurb: 'Wet bed under the water surface; neutral, never blue on dry ground',
    params: [
      { key: 'shallow', label: 'Shallow bed', colour: true, value: '#5d5a4a' },
      { key: 'deep', label: 'Deep bed', colour: true, value: '#2e2d28' },
      { key: 'roughness', label: 'Roughness', min: 0, max: 1, step: 0.01, value: 0.12 },
    ],
    paint(tc, p, L) {
      const s = hex(p.shallow), d = hex(p.deep);
      for (let i = 0; i < L.r.length; i++) {
        const c = mix(s, d, tc.wetN[i]);
        L.r[i] = c[0]; L.g[i] = c[1]; L.b[i] = c[2]; L.rough[i] = p.roughness;
      }
    },
    defaultMasks: [{ type: 'water', params: { kind: 'any', feather: 0.2 } }],
  },

  cavity: {
    name: 'Cavity', category: 'detail', blend: 'multiply', blurb: 'Darkens hollows and gullies',
    params: [
      { key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, value: 0.5 },
    ],
    paint(tc, p, L) {
      for (let i = 0; i < L.r.length; i++) {
        const v = 1 - p.strength * Math.min(1, Math.max(0, -tc.curv[i]));
        L.r[i] = v; L.g[i] = v; L.b[i] = v; L.rough[i] = 1;
      }
    },
  },

  wetness: {
    name: 'Wetness', category: 'detail', blend: 'multiply', blurb: 'Darkens ground where drainage collects',
    params: [
      { key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, value: 0.35 },
    ],
    paint(tc, p, L) {
      for (let i = 0; i < L.r.length; i++) {
        const v = 1 - p.strength * tc.flow[i];
        L.r[i] = v; L.g[i] = v; L.b[i] = v; L.rough[i] = 1 - 0.5 * p.strength * tc.flow[i];
      }
    },
    defaultMasks: [{ type: 'flow', params: { min: 0.5, max: 1, feather: 0.12 } }],
  },

  grain: {
    name: 'Grain', category: 'detail', blend: 'overlay', blurb: 'Fine overlay noise for surface breakup',
    params: [
      { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, value: 0.4 },
    ],
    paint(tc, p, L) {
      const g = tc.grain;
      for (let i = 0; i < L.r.length; i++) {
        const v = 0.5 + p.amount * (g[i] - 0.5);
        L.r[i] = v; L.g[i] = v; L.b[i] = v; L.rough[i] = 1;
      }
    },
  },
};

export const TEXTURE_DEFAULT_ORDER = ['rock', 'cliff', 'soil', 'grass', 'snow', 'gravel', 'silt', 'water', 'cavity', 'wetness'];
