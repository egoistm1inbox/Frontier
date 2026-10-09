// Terrain layer catalogue. Layers are grouped into categories for the picker; the stack itself is a
// plain ordered list, so categories are labels, not nesting.
//
//   generator  adds a height contribution (metres). Blend: add | subtract.
//   effect     rewrites the surface and its channels. Blend: normal (mix by mask × opacity).
//
// Each run() gets the mutable state `st` (height, hardness, water, riverMask, lakeMask, seaMask,
// sediment, outcrop, sea), the resolved params `p`, and a context with derived maps (see stack.js).

import { buildRelief } from './relief.js';
import { thermalErosion, hydraulicErosion, blurField } from './erosion.js';
import { fluvialErosion } from './fluvial.js';
import { ruggedPushPull } from './rugged.js';
import { addOutcrops } from './outcrops.js';
import { applyStrata } from './strata.js';
import { carveRivers } from './rivers.js';
import { fillLakes, applySea } from './water.js';
import { NO_WATER } from './routing.js';

export const TERRAIN_CATEGORIES = [
  { id: 'base', name: 'Base', blurb: 'Where the land starts' },
  { id: 'shape', name: 'Shaping', blurb: 'Reshape the height curve' },
  { id: 'rugged', name: 'Rugged outcrops', blurb: 'Blocks, ledges and boulders on steep ground' },
  { id: 'cliffs', name: 'Cliffs & strata', blurb: 'Bedded rock faces and terraces' },
  { id: 'erosion', name: 'Erosion', blurb: 'Weathering and drainage carving' },
  { id: 'water', name: 'Water', blurb: 'Rivers, lakes and sea level' },
];

// Blend modes offered per layer kind. Generators add or subtract a height contribution. Effects mix the
// rewritten surface in by mask × opacity; min and max keep only the cut or only the fill.
export const TERRAIN_BLEND_MODES = {
  generator: [{ id: 'add', label: 'Add' }, { id: 'subtract', label: 'Subtract' }],
  effect: [{ id: 'normal', label: 'Normal' }, { id: 'min', label: 'Cut only (min)' }, { id: 'max', label: 'Fill only (max)' }],
};

const range = (h) => {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < h.length; i++) { if (h[i] < lo) lo = h[i]; if (h[i] > hi) hi = h[i]; }
  return { lo, hi };
};

export const TERRAIN_TYPES = {
  relief: {
    name: 'Relief', category: 'base', kind: 'generator', blurb: 'Warped mountains, ridges and lowlands',
    params: [
      { key: 'seed', label: 'Seed', min: 1, max: 999, step: 1, value: 7 },
      { key: 'wavelength', label: 'Feature size', unit: 'm', min: 60, max: 2000, step: 10, value: 520 },
      { key: 'height', label: 'Peak height', unit: 'm', min: 5, max: 1200, step: 5, value: 380 },
      { key: 'base', label: 'Base elevation', unit: 'm', min: -300, max: 400, step: 5, value: 0 },
      { key: 'octaves', label: 'Detail octaves', min: 1, max: 8, step: 1, value: 7 },
      { key: 'roughness', label: 'Roughness', min: 0, max: 1, step: 0.01, value: 0.5 },
      { key: 'ridge', label: 'Ridged crests', min: 0, max: 1, step: 0.01, value: 0.6 },
      { key: 'warp', label: 'Domain warp', min: 0, max: 1, step: 0.01, value: 0.5 },
      { key: 'peaks', label: 'Peak sharpness', min: 0, max: 1, step: 0.01, value: 0.5 },
      { key: 'continent', label: 'Lowland extent', min: 0, max: 1, step: 0.01, value: 0.4 },
      { key: 'plateau', label: 'Plateau tops', min: 0, max: 1, step: 0.01, value: 0 },
    ],
    run: (st, p) => buildRelief(st.N, st.size, p),
  },

  shape: {
    name: 'Shape', category: 'shape', kind: 'effect', blurb: 'Gamma, scale and offset of the height curve',
    params: [
      { key: 'gamma', label: 'Curve', min: 0.4, max: 2.5, step: 0.01, value: 1 },
      { key: 'scale', label: 'Relief scale', min: 0.2, max: 2, step: 0.01, value: 1 },
      { key: 'offset', label: 'Offset', unit: 'm', min: -200, max: 200, step: 1, value: 0 },
    ],
    run(st, p) {
      const { lo, hi } = range(st.height);
      const span = Math.max(1e-3, hi - lo);
      for (let i = 0; i < st.height.length; i++) {
        const t = Math.pow(Math.max(0, Math.min(1, (st.height[i] - lo) / span)), p.gamma);
        st.height[i] = lo + t * span * p.scale + p.offset;
      }
    },
  },

  smooth: {
    name: 'Smooth', category: 'shape', kind: 'effect', blurb: 'Relax the surface with a box blur',
    params: [{ key: 'passes', label: 'Passes', min: 1, max: 30, step: 1, value: 3 }],
    run(st, p) {
      const out = blurField(st.height, st.N, p.passes);
      st.height.set(out);
    },
  },

  strata: {
    name: 'Stratify', category: 'cliffs', kind: 'effect', blurb: 'Bedded terraces where the ground is steep',
    params: [
      { key: 'band', label: 'Bed thickness', unit: 'm', min: 4, max: 80, step: 1, value: 26 },
      { key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, value: 0.6 },
      { key: 'hardnessContrast', label: 'Hardness contrast', min: 0, max: 1, step: 0.01, value: 0.7 },
      { key: 'dip', label: 'Dip', unit: '°', min: 0, max: 30, step: 0.5, value: 6 },
      { key: 'dipDirection', label: 'Dip direction', unit: '°', min: 0, max: 360, step: 1, value: 120 },
      { key: 'variation', label: 'Thickness variation', min: 0, max: 1.5, step: 0.01, value: 0.5 },
      { key: 'packaging', label: 'Packaging', min: 0, max: 1, step: 0.01, value: 0.6 },
      { key: 'hardShare', label: 'Hard share', min: 0, max: 1, step: 0.01, value: 0.6 },
      { key: 'lateral', label: 'Lateral jitter', min: 0, max: 0.6, step: 0.01, value: 0.18 },
      { key: 'seed', label: 'Seed', min: 1, max: 999, step: 1, value: 11 },
    ],
    run(st, p) {
      const adapter = {
        resolution: st.N, worldSize: st.size,
        strataBand: p.band, strataStrength: p.strength, hardnessContrast: p.hardnessContrast,
        strataDip: p.dip, strataDipDirection: p.dipDirection, strataVariation: p.variation,
        strataPackaging: p.packaging, strataHardShare: p.hardShare, strataLateral: p.lateral, seed: p.seed,
      };
      st.hardness = applyStrata(st.height, adapter, () => {}, st.outcrop);
    },
  },

  rugged: {
    name: 'Rugged outcrops', category: 'rugged', kind: 'effect', blurb: 'Pushes steep faces sideways into blocks and ledges',
    params: [
      { key: 'amount', label: 'Amount', unit: 'm', min: 0, max: 60, step: 0.5, value: 14 },
      { key: 'scale', label: 'Block size', unit: 'm', min: 20, max: 300, step: 5, value: 70 },
      { key: 'blockiness', label: 'Blockiness', min: 0, max: 1, step: 0.01, value: 0.7 },
      { key: 'ledges', label: 'Ledges', min: 0, max: 1.5, step: 0.01, value: 0.5 },
      { key: 'slopeMin', label: 'Slope from', unit: '°', min: 10, max: 60, step: 1, value: 28 },
      { key: 'slopeMax', label: 'Slope to', unit: '°', min: 20, max: 80, step: 1, value: 50 },
      { key: 'seed', label: 'Seed', min: 1, max: 999, step: 1, value: 5 },
    ],
    run(st, p) {
      ruggedPushPull(st.height, st.N, st.size, { ...p, bands: 3 }, [st.hardness]);
    },
  },

  boulders: {
    name: 'Boulder outcrops', category: 'rugged', kind: 'effect', blurb: 'Clusters of half-buried core-stones',
    params: [
      { key: 'density', label: 'Density', min: 0, max: 1, step: 0.01, value: 0.35 },
      { key: 'size', label: 'Boulder size', unit: 'm', min: 4, max: 60, step: 1, value: 12 },
      { key: 'spacing', label: 'Cluster spacing', unit: 'm', min: 40, max: 600, step: 5, value: 200 },
      { key: 'count', label: 'Boulders per cluster', min: 1, max: 12, step: 1, value: 4 },
      { key: 'aspect', label: 'Aspect', min: 0.3, max: 1.2, step: 0.01, value: 0.65 },
      { key: 'bury', label: 'Burial', min: 0, max: 1, step: 0.01, value: 0.45 },
      { key: 'ridge', label: 'Ridge bias', min: 0, max: 1, step: 0.01, value: 0.3 },
      { key: 'slopeMax', label: 'Max slope', unit: '°', min: 5, max: 60, step: 1, value: 25 },
      { key: 'spread', label: 'Spread', min: 0.5, max: 3, step: 0.01, value: 1.5 },
      { key: 'weather', label: 'Weathering', min: 0, max: 1, step: 0.01, value: 0.6 },
      { key: 'seed', label: 'Seed', min: 1, max: 999, step: 1, value: 9 },
    ],
    run(st, p) {
      const outcrop = addOutcrops(st.height, {
        resolution: st.N, worldSize: st.size, seed: p.seed,
        outcropDensity: p.density, outcropSize: p.size, outcropSpacing: p.spacing, outcropCount: p.count,
        outcropAspect: p.aspect, outcropBury: p.bury, outcropRidge: p.ridge, outcropSlopeMax: p.slopeMax,
        outcropSpread: p.spread, outcropWeather: p.weather,
      });
      st.outcrop = outcrop;
    },
  },

  thermal: {
    name: 'Thermal erosion', category: 'erosion', kind: 'effect', blurb: 'Talus slumps under the angle of repose',
    params: [
      { key: 'iterations', label: 'Iterations', min: 0, max: 120, step: 1, value: 24 },
      { key: 'rate', label: 'Rate', min: 0, max: 1, step: 0.01, value: 0.5 },
      { key: 'talusSoft', label: 'Repose (soft)', unit: '°', min: 15, max: 60, step: 1, value: 33 },
      { key: 'talusHard', label: 'Repose (hard)', unit: '°', min: 40, max: 85, step: 1, value: 78 },
    ],
    run(st, p) {
      thermalErosion(st.height, st.hardness, {
        resolution: st.N, worldSize: st.size, thermalIterations: p.iterations, thermalRate: p.rate,
        talusSoft: p.talusSoft, talusHard: p.talusHard,
      });
    },
  },

  fluvial: {
    name: 'Stream-power incision', category: 'erosion', kind: 'effect', blurb: 'Carves dendritic valleys from drainage area',
    params: [
      { key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, value: 0.65 },
      { key: 'iterations', label: 'Iterations', min: 1, max: 80, step: 1, value: 30 },
      { key: 'concavity', label: 'Concavity', min: 0.2, max: 0.8, step: 0.01, value: 0.45 },
      { key: 'uplift', label: 'Uplift', min: 0, max: 1, step: 0.01, value: 0.3 },
      { key: 'diffusion', label: 'Hillslope diffusion', min: 0, max: 1, step: 0.01, value: 0.3 },
      { key: 'deposition', label: 'Deposition', min: 0, max: 1, step: 0.01, value: 0.6 },
      { key: 'basinFill', label: 'Basin fill', min: 0, max: 1, step: 0.01, value: 0.2 },
    ],
    run(st, p) {
      const r = fluvialErosion(st.height, st.hardness, st.N, st.size, {
        strength: p.strength, iterations: p.iterations, concavity: p.concavity, uplift: p.uplift,
        diffusion: p.diffusion, deposition: p.deposition, basinFill: p.basinFill, seaLevel: st.sea,
      });
      if (r && r.sediment) st.sediment = r.sediment;
    },
  },

  hydraulic: {
    name: 'Hydraulic erosion', category: 'erosion', kind: 'effect', blurb: 'Droplets cut gullies and fan out deposits',
    params: [
      { key: 'droplets', label: 'Droplets', min: 2000, max: 200000, step: 1000, value: 40000 },
      { key: 'lifetime', label: 'Droplet lifetime', min: 5, max: 120, step: 1, value: 40 },
      { key: 'radius', label: 'Erosion radius', unit: 'cells', min: 1, max: 6, step: 1, value: 3 },
      { key: 'inertia', label: 'Inertia', min: 0, max: 1, step: 0.01, value: 0.1 },
      { key: 'capacity', label: 'Sediment capacity', min: 0, max: 10, step: 0.1, value: 5 },
      { key: 'erode', label: 'Erode speed', min: 0, max: 1, step: 0.01, value: 0.35 },
      { key: 'deposit', label: 'Deposit speed', min: 0, max: 1, step: 0.01, value: 0.25 },
      { key: 'evaporation', label: 'Evaporation', min: 0, max: 0.1, step: 0.001, value: 0.015 },
      { key: 'hardness', label: 'Hardness resist', min: 0, max: 1, step: 0.01, value: 0.85 },
    ],
    run(st, p) {
      const { lo, hi } = range(st.height);
      hydraulicErosion(st.height, st.hardness, {
        resolution: st.N, heightScale: Math.max(1, hi - lo), droplets: p.droplets, inertia: p.inertia,
        sedimentCapacity: p.capacity, minCapacity: 0.01, erodeSpeed: p.erode, depositSpeed: p.deposit,
        evaporation: p.evaporation, gravity: 4, dropletLifetime: p.lifetime, erosionRadius: p.radius,
        hardnessInfluence: p.hardness, initialSpeed: 1, seed: 1,
      });
    },
  },

  rivers: {
    name: 'Rivers', category: 'water', kind: 'effect',
    blurb: 'Drainage carves channels into the ground; water only inside them',
    params: [
      { key: 'catchment', label: 'Smallest catchment', unit: 'km²', min: 0.002, max: 0.2, step: 0.001, value: 0.02 },
      { key: 'widthAt1km2', label: 'Width at 1 km²', unit: 'm', min: 10, max: 160, step: 1, value: 80 },
      { key: 'maxWidth', label: 'Maximum width', unit: 'm', min: 10, max: 250, step: 1, value: 90 },
      { key: 'depthScale', label: 'Depth', min: 0.2, max: 3, step: 0.01, value: 1 },
      { key: 'waterFraction', label: 'Water fill', min: 0.1, max: 0.9, step: 0.01, value: 0.45 },
      { key: 'bankAngle', label: 'Bank angle', unit: '°', min: 10, max: 60, step: 1, value: 32 },
      { key: 'minGrade', label: 'Minimum grade', min: 0, max: 0.02, step: 0.0005, value: 0.002 },
      { key: 'smooth', label: 'Centreline smoothing', min: 0, max: 4, step: 1, value: 2 },
    ],
    run(st, p) {
      const res = carveRivers(st.height, st.N, st.cell, {
        sea: st.sea, minCatchmentKm2: p.catchment, widthAt1km2: p.widthAt1km2, maxWidth: p.maxWidth,
        depthScale: p.depthScale, waterFraction: p.waterFraction, bankAngle: p.bankAngle,
        minGrade: p.minGrade, smooth: p.smooth,
      });
      for (let i = 0; i < st.water.length; i++) {
        if (res.water[i] > NO_WATER / 2) st.water[i] = Math.max(st.water[i], res.water[i]);
      }
      st.riverMask.set(res.riverMask);
    },
  },

  lakes: {
    name: 'Lakes', category: 'water', kind: 'effect',
    blurb: 'Flat water in closed basins, to a level below the spill point',
    params: [
      { key: 'fill', label: 'Fill level', min: 0, max: 1, step: 0.01, value: 0.35 },
      { key: 'minDepth', label: 'Minimum basin depth', unit: 'm', min: 0.2, max: 10, step: 0.1, value: 2.5 },
      { key: 'minArea', label: 'Minimum area', unit: 'm²', min: 20, max: 5000, step: 10, value: 800 },
      { key: 'maxAreaFrac', label: 'Maximum share of map', min: 0, max: 0.6, step: 0.01, value: 0.03 },
    ],
    run(st, p) {
      fillLakes(st.height, st.N, st.cell, {
        sea: st.sea, fill: p.fill, minDepth: p.minDepth, minArea: p.minArea, maxAreaFrac: p.maxAreaFrac,
      }, st.water, st.lakeMask);
    },
  },

  sea: {
    name: 'Sea level', category: 'water', kind: 'effect',
    blurb: 'Sets the sea level for the layers below it and floods what lies under it',
    params: [{ key: 'level', label: 'Sea level', unit: 'm', min: -200, max: 400, step: 1, value: 0 }],
    run(st, p) {
      st.sea = p.level;
      applySea(st.height, st.N, p.level, st.water, st.seaMask);
    },
  },
};

// Starting layers for a new terrain stack.
export const TERRAIN_DEFAULT_ORDER = ['relief', 'strata', 'rugged', 'thermal', 'fluvial', 'hydraulic', 'rivers', 'lakes'];
