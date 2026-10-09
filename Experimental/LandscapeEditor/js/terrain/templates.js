// Starting points for New. Each template is an ordinary project: its layers can be edited, reordered and saved like any
// other. The mesa country template is the reference for the mesa layers, the stratigraphy, the basins and the desert
// satmap. Its parameters were tuned by eye on the 1k preview, so they are a starting point, not a fixed recipe.
import { createDefaultProject, createLayer, TERRAIN_DEFAULTS } from './project.js';

const layer = (type, name, params = {}, opts = {}) => createLayer(type, { name, params, ...opts });

export function createMesaProject() {
  const project = createDefaultProject();
  project.name = 'Mesa country';
  project.terrain = { ...TERRAIN_DEFAULTS, seaLevel: 0 }; // no sea: the lakes and playas are the only water
  project.layers = [
    layer('fbm', 'Plateau base', { frequency: 1.1, octaves: 6, gain: 0.45, warp: 0.25, relief: 0.35, offset: -0.28, seed: 3 }),
    layer('mesafield', 'Mesa field', { cells: 5, coverage: 0.5, size: 0.9, variation: 0.6, jitter: 0.6, top: 300, cliff: 0.2, talus: 0.75, irregularity: 0.4, rugosity: 0.05, seed: 31 }),
    layer('mesafield', 'Butte field', { cells: 11, coverage: 0.45, size: 0.75, variation: 0.6, jitter: 0.8, top: 150, cliff: 0.25, talus: 0.9, irregularity: 0.5, rugosity: 0.05, seed: 47 }),
    layer('strata', 'Stratigraphy', { units: 12, thickness: 40, base: 120, hard: 0.5, sharpness: 0.6, cliffs: 45, dip: 3, dipDirection: 90, warp: 20, seed: 17 }),
    layer('erosion', 'Fluvial canyons', { type: 'fluvial', fluvial: { erodibility: 0.05, uplift: 0.0003, iterations: 80, diffusion: 0.03 } }),
    layer('erosion', 'Thermal talus', { type: 'thermal', thermal: { talus: 50, rate: 0.3, iterations: 20 } }, { opacity: 0.6 }),
    layer('playa', 'Playa', { centreX: 66, centreY: 64, radius: 14, aspect: 0.7, angle: 30, level: 240, shore: 0.4, wobble: 0.3, seed: 8 }),
    layer('lake', 'Reservoir', { centreX: 24, centreY: 72, radius: 12, aspect: 0.55, angle: 110, level: 190, depth: 40, shore: 0.4, wobble: 0.3, seed: 9 }),
    layer('satmap', 'Mesa country texture', {
      palette: 'mesa', resolution: 1024, vegetation: 0.45, wetness: 0.2, rockSlope: 30, snowline: 3000,
      hillshade: 0.8, detail: 0.6, saturation: 1.05, contrast: 1.08, sunAzimuth: 300, sunElevation: 24,
      strata: 0.6, varnish: 0.35, sand: 0.8, shadow: 0.85,
    }),
  ];
  return project;
}

export const STACK_TEMPLATES = [
  {
    id: 'default',
    label: 'Default · continental',
    blurb: 'Hills, ridges and a coastline, with fluvial, thermal and hydraulic erosion.',
    build: createDefaultProject,
  },
  {
    id: 'mesa',
    label: 'Mesa country',
    blurb: 'Caprock mesas on stratified cliffs, talus aprons, a playa and a reservoir. Desert satmap with varnish, sand and cast shadows.',
    build: createMesaProject,
  },
];

export function buildTemplate(id) {
  const t = STACK_TEMPLATES.find((x) => x.id === id) || STACK_TEMPLATES[0];
  return t.build();
}
