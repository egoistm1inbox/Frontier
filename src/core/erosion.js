/**
 * Frontier Landscape Studio — erosion simulation.
 *
 * Six physically-motivated processes. Every type declares its own parameter
 * schema, and the inspector renders sliders straight from that schema, so a
 * type can never show a control it does not actually use.
 *
 * All heights are normalized to [0,1]; `strength` scales the process without
 * changing the shape of the terrain, and each routine also reports how much
 * material it moved so the editor can visualize the result honestly.
 */

import { mulberry32, clamp01 } from './noise.js';

/* ------------------------------------------------------------------ schema */

const P = (key, label, min, max, step, value, unit = '', hint = '') =>
  ({ kind: 'range', key, label, min, max, step, value, unit, hint });

export const EROSION_TYPES = [
  {
    id: 'hydraulic',
    name: 'Hydraulic erosion',
    family: 'Water',
    accent: '#81b8c8',
    summary: 'Rain droplets run downhill, pick up sediment and carve branching channels.',
    method: 'Particle transport · Mei et al. (2007)',
    cost: 'Medium',
    params: [
      P('droplets', 'Droplet count', 2000, 400000, 1000, 60000, '', 'Rain droplets released across the surface'),
      P('radius', 'Erosion radius', 1, 8, 1, 3, 'cells', 'How wide each droplet scours'),
      P('inertia', 'Inertia', 0.01, 0.95, 0.01, 0.08, '', 'Momentum carried past the steepest descent'),
      P('capacity', 'Sediment capacity', 1, 80, 0.5, 34, '', 'How much soil a droplet can hold per unit of speed'),
      P('minCapacity', 'Minimum capacity', 0, 0.4, 0.005, 0.02, '', 'Keeps flat pools from filling instantly'),
      P('erodeRate', 'Erosion rate', 0.01, 1, 0.01, 0.32, '', 'Fraction of spare capacity used to cut'),
      P('depositRate', 'Deposition rate', 0.01, 1, 0.01, 0.3, '', 'Fraction of excess sediment dropped per step'),
      P('maxErode', 'Max cut per step', 0.0002, 0.02, 0.0001, 0.0016, '', 'Stability clamp on a single droplet step'),
      P('gravity', 'Gravity', 0.5, 20, 0.1, 6, '', 'Acceleration from elevation loss'),
      P('lifetime', 'Droplet lifetime', 8, 200, 1, 42, 'steps', 'Steps before the droplet is absorbed'),
      P('initialSpeed', 'Initial speed', 0.05, 4, 0.05, 1, '', 'Speed a droplet starts with'),
      P('initialWater', 'Initial water', 0.05, 4, 0.05, 1, '', 'Water volume a droplet starts with'),
      P('rainfall', 'Rainfall', 0, 0.4, 0.005, 0.02, '', 'Water gained per step — longer, hungrier rivers'),
      P('evaporation', 'Evaporation', 0.0005, 0.2, 0.0005, 0.012, '', 'Water lost per step'),
    ],
  },
  {
    id: 'rainfall',
    name: 'Rainfall & sheet wash',
    family: 'Water',
    accent: '#7fb4d6',
    summary: 'Cellular runoff: rain accumulates, flows to lower neighbours and detaches soil.',
    method: 'Cellular hydraulic · virtual pipes',
    cost: 'Fast',
    params: [
      P('iterations', 'Iterations', 1, 400, 1, 60, '', 'Rainfall / routing passes'),
      P('rainfall', 'Rainfall', 0.0001, 0.05, 0.0001, 0.006, '', 'Water added per cell per iteration'),
      P('infiltration', 'Infiltration', 0, 0.5, 0.005, 0.06, '', 'Water soaked into the soil'),
      P('evaporation', 'Evaporation', 0, 0.2, 0.001, 0.01, '', 'Water lost to the air'),
      P('detachability', 'Soil detachability', 0, 1, 0.01, 0.4, '', 'How easily rain dislodges particles'),
      P('transport', 'Transport capacity', 0.1, 40, 0.1, 9, '', 'Sediment a flow can carry'),
      P('velocityExp', 'Velocity exponent', 0.2, 3, 0.05, 1.1, '', 'Non-linearity of speed vs. carrying power'),
      P('slopeExp', 'Slope exponent', 0.2, 3, 0.05, 1.4, '', 'Non-linearity of steepness vs. carrying power'),
      P('deposition', 'Deposition rate', 0.01, 1, 0.01, 0.35, '', 'How fast overloaded water drops its load'),
      P('flowLimit', 'Runoff limit', 0.001, 2, 0.001, 0.35, '', 'Stability clamp on a single flow pass'),
    ],
  },
  {
    id: 'thermal',
    name: 'Thermal erosion (talus)',
    family: 'Mass wasting',
    accent: '#c29583',
    summary: 'Material steeper than the angle of repose slides to its neighbours as scree.',
    method: 'Talus cone relaxation',
    cost: 'Fast',
    params: [
      P('iterations', 'Iterations', 1, 800, 1, 120, '', 'Relaxation passes'),
      P('talus', 'Talus angle', 5, 70, 0.5, 34, '°', 'Angle of repose — steeper slopes collapse'),
      P('rate', 'Transfer rate', 0.01, 1, 0.01, 0.45, '', 'Fraction of the excess moved per pass'),
      P('cohesion', 'Soil cohesion', 0, 1, 0.01, 0.25, '', 'Rock holds its shape; loose soil does not'),
      P('neighbours', 'Neighbourhood', 4, 8, 4, 8, '', '4-way or 8-way material sharing'),
      P('cull', 'Debris spread', 0, 1, 0.01, 0.5, '', 'How far fallen material fans out'),
    ],
  },
  {
    id: 'wind',
    name: 'Wind (aeolian)',
    family: 'Air',
    accent: '#a8c4a0',
    summary: 'Prevailing wind abrades exposed faces and drifts sand into dunes downwind.',
    method: 'Semi-Lagrangian sediment advection',
    cost: 'Fast',
    params: [
      P('iterations', 'Iterations', 1, 400, 1, 90, '', 'Advection passes'),
      P('direction', 'Wind bearing', 0, 360, 1, 225, '°', 'Clockwise from north'),
      P('speed', 'Wind speed', 1, 60, 0.5, 22, 'm/s', 'Abrasion scales with the square of speed'),
      P('abrasion', 'Abrasion rate', 0, 1, 0.01, 0.22, '', 'Fraction of loose material lifted per pass'),
      P('stepLength', 'Transport length', 0.4, 12, 0.1, 3.2, 'cells', 'How far sand travels between passes'),
      P('settling', 'Settling rate', 0, 1, 0.01, 0.14, '', 'Fraction of airborne sand dropped per pass'),
      P('cohesion', 'Surface cohesion', 0, 1, 0.01, 0.35, '', 'Bound soil resists lifting'),
      P('turbulence', 'Turbulence', 0, 1, 0.01, 0.3, '', 'Random eddies that break up uniform drift'),
      P('shelter', 'Wind shadow', 0, 1, 0.01, 0.6, '', 'Protection given by upwind relief'),
    ],
  },
  {
    id: 'glacial',
    name: 'Glacial erosion',
    family: 'Ice',
    accent: '#a9c8e0',
    summary: 'Ice follows the drainage, plucks bedrock and grinds it into U-shaped valleys.',
    method: 'Accumulation-driven sliding ice',
    cost: 'Slow',
    params: [
      P('iterations', 'Iterations', 1, 120, 1, 26, '', 'Ice-flow passes'),
      P('extent', 'Glacier extent', 0.001, 1, 0.001, 0.14, '', 'Drainage fraction that must be reached before ice forms'),
      P('snowline', 'Snowline', 0, 1, 0.01, 0.46, '', 'Elevation above which ice thickens; valley glaciers persist below it'),
      P('thickness', 'Ice thickness', 0.05, 4, 0.01, 1.1, '', 'Thicker ice slides faster and cuts deeper'),
      P('sliding', 'Sliding coefficient', 0.01, 1, 0.01, 0.42, '', 'How freely the ice moves over bedrock'),
      P('abrasion', 'Abrasion', 0, 1, 0.01, 0.35, '', 'Sanding of the valley floor'),
      P('plucking', 'Plucking', 0, 1, 0.01, 0.5, '', 'Ripping rock from the lee side of steps'),
      P('width', 'Valley width', 0, 14, 0.5, 6, 'cells', 'Widening that turns V-gullies into U-valleys'),
      P('deepen', 'Overdeepening', 0, 1, 0.01, 0.4, '', 'Extra scour that digs below the outlet'),
    ],
  },
  {
    id: 'coastal',
    name: 'Coastal (wave)',
    family: 'Water',
    accent: '#7dc3bf',
    summary: 'Waves undercut the shoreline, cliffs retreat inland and debris builds beaches.',
    method: 'Shoreline retreat + beach profile',
    cost: 'Fast',
    params: [
      P('iterations', 'Iterations', 1, 200, 1, 40, '', 'Storm seasons simulated'),
      P('seaLevel', 'Sea level', 0, 1, 0.005, 0.2, '', 'Normalized shoreline elevation'),
      P('energy', 'Wave energy', 0, 1, 0.01, 0.45, '', 'Fetch and storm intensity'),
      P('band', 'Attack band', 0.5, 40, 0.5, 12, 'cells', 'How far inland the waves reach'),
      P('retreat', 'Cliff retreat rate', 0, 1, 0.01, 0.35, '', 'Fraction of the undercut removed per season'),
      P('hardness', 'Rock hardness', 0, 1, 0.01, 0.45, '', 'Resistant rock retreats slowly'),
      P('beach', 'Beach deposition', 0, 1, 0.01, 0.8, '', 'Fraction of debris graded into the shore profile'),
      P('beachSlope', 'Beach gradient', 0.02, 1.5, 0.01, 0.35, '', 'Steep shingle or flat sand'),
      P('surge', 'Storm surge', 0, 0.3, 0.005, 0.06, '', 'Temporary sea-level rise during storms'),
    ],
  },
];

export const erosionType = (id) => EROSION_TYPES.find((t) => t.id === id) || EROSION_TYPES[0];

export function erosionDefaults(id) {
  const type = erosionType(id);
  const out = {};
  for (const p of type.params) out[p.key] = p.value;
  return out;
}

/* ----------------------------------------------------------- field helpers */

export function zeros(n) { return new Float32Array(n); }

/** Bilinear height sample. */
export function sampleHeight(h, res, x, y) {
  const xi = x | 0, yi = y | 0;
  if (xi < 0 || yi < 0 || xi >= res - 1 || yi >= res - 1) return h[clampIdx(xi, yi, res)];
  const tx = x - xi, ty = y - yi;
  const i00 = yi * res + xi;
  const a = h[i00], b = h[i00 + 1], c = h[i00 + res], d = h[i00 + res + 1];
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

function lerp(a, b, t) { return a + (b - a) * t; }
const clampIdx = (x, y, res) =>
  (y < 0 ? 0 : y >= res ? res - 1 : y) * res + (x < 0 ? 0 : x >= res ? res - 1 : x);

/**
 * Bilinear gradient via the four surrounding cell slopes.
 * Returns [gx, gy] in normalized height per cell.
 */
export function sampleGradient(h, res, x, y) {
  const xi = Math.min(Math.max(x | 0, 0), res - 2);
  const yi = Math.min(Math.max(y | 0, 0), res - 2);
  const tx = x - xi, ty = y - yi;
  const i = yi * res + xi;
  const gx = lerp(h[i + 1] - h[i], h[i + res + 1] - h[i + res], ty);
  const gy = lerp(h[i + res] - h[i], h[i + res + 1] - h[i + 1], tx);
  return [gx, gy];
}

/** Distribute a quantity into the four surrounding cells. */
export function splatHeight(h, res, x, y, amount) {
  const xi = x | 0, yi = y | 0;
  if (xi < 0 || yi < 0 || xi >= res - 1 || yi >= res - 1) return 0;
  const tx = x - xi, ty = y - yi;
  const i = yi * res + xi;
  const w = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
  const idx = [i, i + 1, i + res, i + res + 1];
  for (let k = 0; k < 4; k++) h[idx[k]] += amount * w[k];
  return amount;
}

/** Disc brush weights, precomputed once per run. */
export function brushWeights(radius) {
  const r = Math.max(1, Math.round(radius));
  const cells = [], weights = [];
  let total = 0;
  for (let oy = -r; oy <= r; oy++) {
    for (let ox = -r; ox <= r; ox++) {
      const d = Math.sqrt(ox * ox + oy * oy);
      if (d > r) continue;
      const w = 1 - d / (r + 0.5);
      cells.push([ox, oy]);
      weights.push(w);
      total += w;
    }
  }
  for (let i = 0; i < weights.length; i++) weights[i] /= total;
  return { r, cells, weights, total };
}

/** Per-cell slope magnitude in normalized height per cell. */
export function slopeField(h, res) {
  const out = new Float32Array(res * res);
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const xm = Math.max(0, x - 1), xp = Math.min(res - 1, x + 1);
      const ym = Math.max(0, y - 1), yp = Math.min(res - 1, y + 1);
      const gx = (h[y * res + xp] - h[y * res + xm]) / (xp - xm || 1);
      const gy = (h[yp * res + x] - h[ym * res + x]) / (yp - ym || 1);
      out[y * res + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return out;
}

/** Fixed-capacity binary min-heap keyed on elevation. */
class MinHeap {
  constructor(capacity) {
    this.keys = new Float64Array(capacity + 1);
    this.values = new Int32Array(capacity + 1);
    this.size = 0;
  }
  push(key, value) {
    let i = ++this.size;
    this.keys[i] = key;
    this.values[i] = value;
    while (i > 1) {
      const parent = i >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      const k = this.keys[parent]; this.keys[parent] = this.keys[i]; this.keys[i] = k;
      const v = this.values[parent]; this.values[parent] = this.values[i]; this.values[i] = v;
      i = parent;
    }
  }
  pop() {
    const value = this.values[1];
    this.keys[1] = this.keys[this.size];
    this.values[1] = this.values[this.size];
    this.size--;
    let i = 1;
    for (;;) {
      const l = i << 1, r = l + 1;
      let smallest = i;
      if (l <= this.size && this.keys[l] < this.keys[smallest]) smallest = l;
      if (r <= this.size && this.keys[r] < this.keys[smallest]) smallest = r;
      if (smallest === i) break;
      const k = this.keys[smallest]; this.keys[smallest] = this.keys[i]; this.keys[i] = k;
      const v = this.values[smallest]; this.values[smallest] = this.values[i]; this.values[i] = v;
      i = smallest;
    }
    return value;
  }
}

/**
 * Priority-flood depression filling (Barnes et al. 2014).
 *
 * Eroded surfaces are full of pits and, worse, of exactly flat spots left by
 * deposition. D8 routing dead-ends on both, so every cell upstream of a flat
 * traps its water and the drainage network fragments. Filling first — with an
 * epsilon gradient across flats — guarantees a monotonic path to the border and
 * makes flow accumulation, glacier routing and the riverbed texture rules read
 * the landscape the way real hydrology does.
 */
export function fillSinks(h, res, epsilon = 1e-6) {
  const n = res * res;
  const filled = new Float32Array(h);
  const done = new Uint8Array(n);
  const heap = new MinHeap(n);

  for (let x = 0; x < res; x++) {
    for (const y of [0, res - 1]) {
      const i = y * res + x;
      if (!done[i]) { done[i] = 1; heap.push(filled[i], i); }
    }
  }
  for (let y = 0; y < res; y++) {
    for (const x of [0, res - 1]) {
      const i = y * res + x;
      if (!done[i]) { done[i] = 1; heap.push(filled[i], i); }
    }
  }

  while (heap.size > 0) {
    const i = heap.pop();
    const key = filled[i];
    const x = i % res, y = (i / res) | 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= res || ny >= res) continue;
        const j = ny * res + nx;
        if (done[j]) continue;
        done[j] = 1;
        // Raise anything at or below the current spill height just enough to
        // keep a downhill gradient towards the cell that flooded it.
        if (filled[j] <= key) filled[j] = key + epsilon;
        heap.push(filled[j], j);
      }
    }
  }
  return filled;
}

/**
 * D8 flow accumulation: process cells high to low, pour one unit of water plus
 * everything upstream into the single steepest downhill neighbour. Routing runs
 * on a depression-filled surface unless one is supplied.
 */
export function flowAccumulation(h, res, filledSurface = null) {
  const n = res * res;
  const surface = filledSurface || fillSinks(h, res);
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  // Sort descending by height. TypedArray sort on indices is fast enough here.
  order.sort((a, b) => surface[b] - surface[a]);
  const accum = new Float32Array(n).fill(1);
  for (let k = 0; k < n; k++) {
    const i = order[k];
    const x = i % res, y = (i / res) | 0;
    let best = -1, bestDrop = 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= res || ny >= res) continue;
        const j = ny * res + nx;
        const drop = (surface[i] - surface[j]) / (ox && oy ? 1.4142136 : 1);
        if (drop > bestDrop) { bestDrop = drop; best = j; }
      }
    }
    if (best >= 0) accum[best] += accum[i];
  }
  return accum;
}

/** Log-compressed accumulation normalized to [0,1] for display and rules. */
export function normalizeFlow(accum) {
  const out = new Float32Array(accum.length);
  let max = 0;
  for (let i = 0; i < accum.length; i++) {
    const v = Math.log1p(accum[i]);
    out[i] = v;
    if (v > max) max = v;
  }
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] /= max;
  return out;
}

/* ------------------------------------------------------------ the processes */

/**
 * Particle hydraulic erosion.
 * Droplets are released at random, follow inertia-biased steepest descent,
 * carry sediment up to a speed-dependent capacity, cut when under-capacity and
 * fill when over-capacity or moving uphill.
 */
function hydraulic(h, res, p, seed, maps, onProgress) {
  const rand = mulberry32(seed);
  const brush = brushWeights(p.radius);
  const n = res * res;
  const { eroded, deposited } = maps;
  const count = Math.max(1, p.droplets | 0);
  const invN = 1 / n;

  for (let d = 0; d < count; d++) {
    if (onProgress && (d & 511) === 0) onProgress(d * invN, 'Hydraulic droplets');
    let px = 1 + rand() * (res - 3);
    let py = 1 + rand() * (res - 3);
    let dx = rand() * 2 - 1, dy = rand() * 2 - 1;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl; dy /= dl;
    let speed = p.initialSpeed;
    let water = p.initialWater;
    let sediment = 0;

    for (let step = 0; step < p.lifetime; step++) {
      const xi = px | 0, yi = py | 0;
      if (xi < 1 || yi < 1 || xi >= res - 2 || yi >= res - 2) break;
      const startHeight = sampleHeight(h, res, px, py);
      const [gx, gy] = sampleGradient(h, res, px, py);

      // Inertia-biased direction: keep some momentum, pull downhill.
      dx = dx * p.inertia - gx * (1 - p.inertia);
      dy = dy * p.inertia - gy * (1 - p.inertia);
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) break;
      dx /= len; dy /= len;

      const nx = px + dx, ny = py + dy;
      if (nx < 1 || ny < 1 || nx >= res - 2 || ny >= res - 2) break;
      const newHeight = sampleHeight(h, res, nx, ny);
      const dh = newHeight - startHeight;

      // Carry capacity grows with speed and water volume.
      const capacity = Math.max(-dh * speed * water * p.capacity, p.minCapacity);

      if (sediment > capacity || dh > 0) {
        // Filling the whole height difference would leave an exactly flat spot
        // and dead-end the drainage; 0.98 keeps a hair of gradient.
        const amount = dh > 0
          ? Math.min(dh * 0.98, sediment)
          : (sediment - capacity) * p.depositRate;
        if (amount > 1e-12) {
          sediment -= amount;
          splatHeight(h, res, px, py, amount);
          const cx = clampIdx(px | 0, py | 0, res);
          deposited[cx] += amount;
        }
      } else {
        const amount = Math.min((capacity - sediment) * p.erodeRate, -dh * 0.7, p.maxErode);
        if (amount > 1e-12) {
          // Never dig below the lowest point of the brush footprint. Allowing a
          // droplet to cut under its own floor punches pits that then trap water
          // and smear the surface instead of incising a channel.
          let floor = Infinity;
          const bx = px | 0, by = py | 0;
          for (let k = 0; k < brush.cells.length; k++) {
            const idx = clampIdx(bx + brush.cells[k][0], by + brush.cells[k][1], res);
            if (h[idx] < floor) floor = h[idx];
          }
          let removed = 0;
          for (let k = 0; k < brush.cells.length; k++) {
            const idx = clampIdx(bx + brush.cells[k][0], by + brush.cells[k][1], res);
            const want = amount * brush.weights[k];
            const take = Math.min(want, Math.max(0, h[idx] - floor));
            if (take > 0) { h[idx] -= take; eroded[idx] += take; removed += take; }
          }
          sediment += removed;
        }
      }

      speed = Math.sqrt(Math.max(0, speed * speed + dh * p.gravity));
      water = Math.max(0, water * (1 - p.evaporation) + p.rainfall);
      px = nx; py = ny;
      if (water <= 1e-6 || speed <= 1e-6) break;
    }

    // A droplet that leaves the map or runs dry drops whatever it is carrying,
    // so sediment builds alluvial fans at the margins instead of vanishing.
    if (sediment > 1e-9) {
      const ex = Math.min(Math.max(px, 1), res - 2);
      const ey = Math.min(Math.max(py, 1), res - 2);
      splatHeight(h, res, ex, ey, sediment);
      deposited[clampIdx(ex | 0, ey | 0, res)] += sediment;
    }
  }

  // Carving leaves the odd dead-end: a droplet that stops mid-channel leaves a
  // hole with no downhill exit. Every real hydrology pipeline fills those, so
  // the eroded surface always drains and the flow maps stay usable.
  const filled = fillSinks(h, res);
  for (let i = 0; i < n; i++) {
    const add = filled[i] - h[i];
    if (add > 1e-9) {
      h[i] = filled[i];
      deposited[i] += add;
    }
  }

  if (onProgress) onProgress(1, 'Hydraulic droplets');
}

/** Cellular sheet-wash erosion on a virtual water layer. */
function rainfall(h, res, p, seed, maps, onProgress) {
  const n = res * res;
  const water = maps.water;
  const sed = new Float32Array(n);
  const nextW = new Float32Array(n);
  const nextS = new Float32Array(n);
  const rand = mulberry32(seed);
  const steps = Math.max(1, p.iterations | 0);

  for (let it = 0; it < steps; it++) {
    if (onProgress) onProgress(it / steps, 'Sheet wash passes');
    for (let i = 0; i < n; i++) {
      water[i] += p.rainfall * (0.85 + rand() * 0.3);
      nextW[i] = water[i];
      nextS[i] = sed[i];
    }

    for (let y = 1; y < res - 1; y++) {
      for (let x = 1; x < res - 1; x++) {
        const i = y * res + x;
        const w = water[i];
        const s = sed[i];
        if (w <= 1e-9) continue;

        const nb = [i - 1, i + 1, i - res, i + res];
        const drop = [0, 0, 0, 0];
        let totalDrop = 0;
        for (let k = 0; k < 4; k++) {
          const d = h[i] - h[nb[k]];
          if (d > 0) { drop[k] = d; totalDrop += d; }
        }
        if (totalDrop <= 1e-12) continue;

        const flux = Math.min(w * 0.9, p.flowLimit * totalDrop);
        const velocity = flux / Math.max(w, 1e-9);
        const slope = totalDrop / 4;
        const capacity = p.transport
          * Math.pow(velocity + 1e-6, p.velocityExp)
          * Math.pow(slope + 1e-6, p.slopeExp);

        // Route water, and with it as much sediment as the flow can carry.
        const carried = Math.min(s, capacity);
        let sentSediment = 0;
        for (let k = 0; k < 4; k++) {
          if (drop[k] <= 0) continue;
          const share = drop[k] / totalDrop;
          const f = flux * share;
          nextW[nb[k]] += f;
          const load = carried * share;
          nextS[nb[k]] += load;
          sentSediment += load;
        }
        nextS[i] -= sentSediment;

        // Over capacity: the flow drops its excess load.
        const excess = s - carried;
        if (excess > 0) {
          const deposit = excess * p.deposition;
          h[i] += deposit;
          maps.deposited[i] += deposit;
          nextS[i] -= deposit;
        } else if (capacity - carried > 1e-9) {
          // Under capacity: detach soil from the bed.
          const take = Math.min((capacity - carried) * p.detachability * 0.2, Math.max(0, h[i]) * 0.02);
          if (take > 0) {
            h[i] -= take;
            maps.eroded[i] += take;
            nextS[i] += take;
          }
        }

        // Water soaking into the ground drops whatever it was holding.
        const infiltrated = w * p.infiltration;
        if (infiltrated > 1e-9 && nextS[i] > 0) {
          const load = nextS[i] * p.infiltration * 0.85;
          h[i] += load;
          maps.deposited[i] += load;
          nextS[i] -= load;
        }
      }
    }

    const retain = 1 - p.infiltration - p.evaporation;
    for (let i = 0; i < n; i++) {
      water[i] = Math.max(0, nextW[i] * retain);
      sed[i] = Math.max(0, nextS[i]);
      maps.flow[i] += water[i];
    }
  }

  // Whatever is still in suspension when the rain stops settles out; leaving it
  // suspended would silently delete soil from the mass balance.
  for (let i = 0; i < n; i++) {
    if (sed[i] > 1e-12) {
      h[i] += sed[i];
      maps.deposited[i] += sed[i];
      sed[i] = 0;
    }
  }
  if (onProgress) onProgress(1, 'Sheet wash passes');
}

/** Talus relaxation: anything steeper than the angle of repose slides. */
function thermal(h, res, p, seed, maps, onProgress) {
  const n = res * res;
  const steps = Math.max(1, p.iterations | 0);
  const buffer = new Float32Array(n);
  const fresh = new Float32Array(n);
  const eight = p.neighbours >= 8;
  const dirs = eight
    ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
    : [[1, 0], [-1, 0], [0, 1], [0, -1]];
  // The field is normalized, so a cell-to-cell height difference only means
  // something once it is converted with the grid's real aspect ratio. Without
  // this a 34° angle of repose would never trigger on any real landscape.
  const threshold = Math.tan((p.talus * Math.PI) / 180) * (p.aspect || 0.01) / Math.max(0.01, p.verticalScale || 1);
  const keep = 1 - p.cohesion * 0.85;

  for (let it = 0; it < steps; it++) {
    if (onProgress) onProgress(it / steps, 'Talus relaxation');
    buffer.set(h);
    for (let y = 1; y < res - 1; y++) {
      for (let x = 1; x < res - 1; x++) {
        const i = y * res + x;
        let excessTotal = 0;
        let lowerSum = 0;
        let lowerCount = 0;
        const transfers = [];
        for (const [ox, oy] of dirs) {
          const j = i + oy * res + ox;
          const d = h[i] - h[j];
          if (d > threshold) {
            // Diagonal neighbours are further away, so they take a smaller share.
            const weight = eight && ox && oy ? 0.5 : 1;
            const excess = (d - threshold) * weight;
            transfers.push([j, excess]);
            excessTotal += excess;
            lowerSum += h[j];
            lowerCount++;
          }
        }
        if (excessTotal <= 1e-12 || !lowerCount) continue;

        // Move at most halfway towards the mean of the lower neighbours. This
        // cap is what keeps the relaxation stable for any number of passes:
        // without it a single peak can shed more material than it has and the
        // field diverges.
        const lowerMean = lowerSum / lowerCount;
        const headroom = Math.max(0, (h[i] - lowerMean) * 0.5);
        const delta = Math.min(headroom, excessTotal) * p.rate * keep;
        if (delta <= 1e-12) continue;

        buffer[i] -= delta;
        let distributed = 0;
        for (let k = 0; k < transfers.length; k++) {
          const [j, excess] = transfers[k];
          // The last neighbour takes the remainder so nothing is lost to rounding.
          const share = k === transfers.length - 1 ? delta - distributed : delta * (excess / excessTotal);
          if (share <= 0) continue;
          buffer[j] += share;
          fresh[j] += share;
          maps.talus[j] += share;
          maps.deposited[j] += share;
          distributed += share;
        }
        maps.eroded[i] += distributed;
      }
    }

    // Debris spread: fan this pass's deposits into an apron so talus cones get
    // a natural skirt instead of piling into single cells. Mass is conserved
    // because the same amount leaves the cell as enters its ring.
    if (p.cull > 0) {
      const move = p.cull * 0.5;
      const ring = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      const weights = [0.16, 0.16, 0.16, 0.16, 0.09, 0.09, 0.09, 0.09];
      for (let y = 2; y < res - 2; y++) {
        for (let x = 2; x < res - 2; x++) {
          const i = y * res + x;
          const s = fresh[i];
          if (s <= 1e-12) continue;
          const amount = s * move;
          buffer[i] -= amount;
          for (let k = 0; k < 8; k++) {
            const j = i + ring[k][1] * res + ring[k][0];
            buffer[j] += amount * weights[k];
            maps.talus[j] += amount * weights[k];
          }
        }
      }
    }

    h.set(buffer);
    fresh.fill(0);
  }
  if (onProgress) onProgress(1, 'Talus relaxation');
}

/** Aeolian abrasion with semi-Lagrangian downwind sediment transport. */
function wind(h, res, p, seed, maps, onProgress) {
  const n = res * res;
  const rand = mulberry32(seed);
  const steps = Math.max(1, p.iterations | 0);
  const angle = (p.direction * Math.PI) / 180;
  const wx = Math.sin(angle), wy = -Math.cos(angle);
  const air = new Float32Array(n);
  const nextAir = new Float32Array(n);
  const exposure = new Float32Array(n);
  const speedFactor = Math.pow(p.speed / 20, 2);
  const stepLen = p.stepLength;

  for (let it = 0; it < steps; it++) {
    if (onProgress) onProgress(it / steps, 'Aeolian passes');
    // Exposure: relief above the upwind neighbourhood is abraded, lee is sheltered.
    for (let y = 2; y < res - 2; y++) {
      for (let x = 2; x < res - 2; x++) {
        const i = y * res + x;
        let up = 0, count = 0;
        for (let s = 1; s <= 3; s++) {
          const ux = Math.round(x - wx * s * 2), uy = Math.round(y - wy * s * 2);
          if (ux < 0 || uy < 0 || ux >= res || uy >= res) continue;
          up += h[uy * res + ux];
          count++;
        }
        const avg = count ? up / count : h[i];
        exposure[i] = Math.max(0, h[i] - avg);
      }
    }
    for (let i = 0; i < n; i++) {
      const turb = 1 + (rand() * 2 - 1) * p.turbulence;
      const shelter = 1 - p.shelter * clamp01(air[i] * 400);
      // Abrasion is overwhelmingly a function of how much a face stands proud of
      // its upwind surroundings; the blanket term is only the loose-surface floor.
      const exposed = clamp01(exposure[i] * 90);
      const lift = p.abrasion * speedFactor * (1 - p.cohesion)
        * (0.0004 * turb * Math.max(0.05, shelter) + 0.0085 * exposed * turb);
      const take = Math.min(h[i] * 0.05, lift);
      if (take > 0) { h[i] -= take; air[i] += take; maps.eroded[i] += take; }
    }
    // Advect airborne sand downwind and settle a fraction of it.
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const i = y * res + x;
        const sx = x - wx * stepLen, sy = y - wy * stepLen;
        const advected = sx < 0 || sy < 0 || sx > res - 1 || sy > res - 1 ? 0 : sampleHeight(air, res, sx, sy);
        nextAir[i] = advected;
        const settle = advected * p.settling;
        if (settle > 1e-12) {
          nextAir[i] -= settle;
          h[i] += settle;
          maps.deposited[i] += settle;
          maps.talus[i] += settle * 0.4;
        }
      }
    }
    air.set(nextAir);
  }
  if (onProgress) onProgress(1, 'Aeolian passes');
}

/** Ice flows along the drainage network, abrading and plucking the bed. */
function glacial(h, res, p, seed, maps, onProgress) {
  const n = res * res;
  const accum = normalizeFlow(flowAccumulation(h, res));
  const steps = Math.max(1, p.iterations | 0);
  const ice = new Float32Array(n);
  const nextIce = new Float32Array(n);
  const load = new Float32Array(n);       // debris the ice is carrying
  const nextLoad = new Float32Array(n);

  for (let it = 0; it < steps; it++) {
    if (onProgress) onProgress(it / steps, 'Glacial passes');
    for (let i = 0; i < n; i++) {
      // Ice needs both a catchment (accumulation) and altitude, but the altitude
      // gate is graded rather than a hard cut-off — valley glaciers survive well
      // below the snowline, they are just thinner.
      const drainage = clamp01((accum[i] - p.extent) * 6);
      const altitude = clamp01((h[i] - p.snowline) * 3.5 + 0.35);
      const formed = p.thickness * drainage * altitude;
      ice[i] = formed > 1e-4 ? formed : ice[i] * 0.35;
    }
    nextIce.set(ice);
    nextLoad.set(load);
    for (let y = 1; y < res - 1; y++) {
      for (let x = 1; x < res - 1; x++) {
        const i = y * res + x;
        if (ice[i] <= 1e-4) continue;
        // Steepest descent gives the sliding direction.
        let bx = 0, by = 0, bestDrop = 1e-6;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            const j = i + oy * res + ox;
            const drop = h[i] - h[j];
            if (drop > bestDrop) { bestDrop = drop; bx = ox; by = oy; }
          }
        }
        if (!bx && !by) continue;
        const j = i + by * res + bx;
        const velocity = clamp01(bestDrop * 12) * p.sliding * ice[i];
        nextIce[i] -= velocity;
        nextIce[j] += velocity;
        if (nextIce[i] < 0) { nextIce[j] += nextIce[i]; nextIce[i] = 0; }

        // Everything the ice removes becomes its load rather than vanishing.
        let taken = 0;

        // Abrasion scours the bed; plucking attacks the lee side of a step.
        const scour = velocity * p.abrasion * 0.5;
        if (scour > 0) {
          const take = Math.min(Math.max(0, h[i]) * 0.05, scour);
          h[i] -= take;
          maps.eroded[i] += take;
          maps.flow[i] += take * 3;
          taken += take;
        }
        const pluck = Math.max(0, bestDrop - 0.004) * p.plucking * ice[i] * 0.6;
        if (pluck > 0) {
          const take = Math.min(Math.max(0, h[j]) * 0.05, pluck);
          h[j] -= take;
          maps.eroded[j] += take;
          maps.talus[j] += take;
          taken += take;
        }
        // Widen the valley so V-gullies open into U-profiles. Material pulled
        // off the walls joins the load; it is not created at the valley floor.
        if (p.width > 0.5) {
          const w = Math.round(p.width * clamp01(ice[i] * 0.8));
          for (let r = 1; r <= w; r++) {
            const sides = [[r, 0], [-r, 0], [0, r], [0, -r]];
            for (const [ox, oy] of sides) {
              const cx = x + ox, cy = y + oy;
              if (cx < 1 || cy < 1 || cx >= res - 1 || cy >= res - 1) continue;
              const k = cy * res + cx;
              const pull = Math.max(0, h[i] - h[k]) * 0.02 * p.deepen * (1 - r / (w + 1));
              if (pull > 0) {
                const take = Math.min(Math.max(0, h[k]) * 0.05, pull);
                h[k] -= take;
                maps.eroded[k] += take;
                taken += take;
              }
            }
          }
        }
        nextLoad[i] += taken;

        // Transport capacity scales with ice thickness. Where the ice thins —
        // the terminus, or a widening valley floor — it drops its load as till.
        const capacity = p.thickness * ice[i] * 0.6 + 1e-6;
        const over = nextLoad[i] - capacity;
        if (over > 0) {
          const deposit = over * 0.55;
          h[i] += deposit;
          maps.deposited[i] += deposit;
          maps.talus[i] += deposit;
          nextLoad[i] -= deposit;
        }

        // Debris travels with the ice.
        const carried = Math.min(nextLoad[i], capacity);
        nextLoad[i] -= carried;
        nextLoad[j] += carried;
      }
    }
    ice.set(nextIce);
    load.set(nextLoad);
    for (let i = 0; i < n; i++) {
      ice[i] = Math.max(0, ice[i]);
      load[i] = Math.max(0, load[i]);
    }
  }

  // Melting ice leaves everything it was carrying behind as moraine.
  for (let i = 0; i < n; i++) {
    if (load[i] > 1e-12) {
      h[i] += load[i];
      maps.deposited[i] += load[i];
      maps.talus[i] += load[i];
      load[i] = 0;
    }
  }
  if (onProgress) onProgress(1, 'Glacial passes');
}

/**
 * Two-pass chamfer distance transform: horizontal distance in cells from the
 * nearest seed cell. Wave attack is measured across the ground, not in height,
 * so a beach 10 cells inland is attacked and a cliff 2 cells inland is not.
 */
function distanceTransform(seedMask, res) {
  const INF = 1e9;
  const dist = new Float32Array(res * res);
  const d1 = 1, d2 = 1.4142136;
  for (let i = 0; i < dist.length; i++) dist[i] = seedMask[i] ? 0 : INF;
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const i = y * res + x;
      let best = dist[i];
      if (x > 0) best = Math.min(best, dist[i - 1] + d1);
      if (y > 0) best = Math.min(best, dist[i - res] + d1);
      if (x > 0 && y > 0) best = Math.min(best, dist[i - res - 1] + d2);
      if (x < res - 1 && y > 0) best = Math.min(best, dist[i - res + 1] + d2);
      dist[i] = best;
    }
  }
  for (let y = res - 1; y >= 0; y--) {
    for (let x = res - 1; x >= 0; x--) {
      const i = y * res + x;
      let best = dist[i];
      if (x < res - 1) best = Math.min(best, dist[i + 1] + d1);
      if (y < res - 1) best = Math.min(best, dist[i + res] + d1);
      if (x < res - 1 && y < res - 1) best = Math.min(best, dist[i + res + 1] + d2);
      if (x > 0 && y < res - 1) best = Math.min(best, dist[i + res - 1] + d2);
      dist[i] = best;
    }
  }
  return dist;
}

/** Waves undercut the shoreline; cliffs step back and debris builds a beach. */
function coastal(h, res, p, seed, maps, onProgress) {
  const steps = Math.max(1, p.iterations | 0);
  const band = Math.max(1, p.band);
  const n = res * res;
  const rand = mulberry32(seed);

  for (let it = 0; it < steps; it++) {
    if (onProgress) onProgress(it / steps, 'Storm seasons');
    const slope = slopeField(h, res);
    // Storms arrive on a changing tide so the attack band walks inland.
    const surge = it % 3 === 2 ? p.surge * (0.6 + rand() * 0.8) : 0;
    const level = p.seaLevel + surge;

    // Seed the distance transform on the shoreline itself.
    const shore = new Uint8Array(n);
    let shoreCount = 0;
    for (let i = 0; i < n; i++) {
      if (Math.abs(h[i] - level) < 0.012) { shore[i] = 1; shoreCount++; }
    }
    if (shoreCount === 0) break;
    const dist = distanceTransform(shore, res);

    let removed = 0;
    const cuts = [];
    for (let y = 1; y < res - 1; y++) {
      for (let x = 1; x < res - 1; x++) {
        const i = y * res + x;
        const d = dist[i];
        if (d > band) continue;
        // Waves break hardest right at the waterline and lose energy inland.
        const proximity = 1 - d / band;
        const steep = clamp01(slope[i] * 12);
        const wet = h[i] < level + 0.02 ? 1 : 0.55;
        const attack = p.energy * proximity * proximity * (0.3 + steep) * wet
          * (1 - p.hardness * 0.85) * 0.02;
        const take = Math.min(Math.max(0, h[i] - (level - 0.06)), attack);
        if (take > 1e-9) { cuts.push([i, take]); removed += take; }
      }
    }
    if (!cuts.length) break;

    for (const [i, take] of cuts) {
      const cut = take * p.retreat;
      h[i] -= cut;
      maps.eroded[i] += cut;
    }

    // All the debris is redistributed: part as a graded beach, part offshore,
    // so the process conserves mass instead of deleting the coastline.
    const total = removed * p.retreat;
    let placed = 0;
    const budget = new Float32Array(n);
    for (const [i] of cuts) {
      const x = i % res, y = (i / res) | 0;
      const reach = 4;
      for (let oy = -reach; oy <= reach; oy++) {
        for (let ox = -reach; ox <= reach; ox++) {
          const cx = x + ox, cy = y + oy;
          if (cx < 0 || cy < 0 || cx >= res || cy >= res) continue;
          const d = Math.hypot(ox, oy);
          if (d > reach) continue;
          const k = cy * res + cx;
          const w = Math.max(0, 1 - d / (reach + 0.5));
          // Beach profile grades down away from the shoreline.
          const target = h[k] < level
            ? level - p.beachSlope * 0.03 * dist[k]
            : level - p.beachSlope * 0.03 * (dist[k] + 1);
          if (h[k] + budget[k] < target) budget[k] += w;
        }
      }
    }
    let budgetSum = 0;
    for (let i = 0; i < n; i++) budgetSum += budget[i];
    if (budgetSum > 0) {
      for (let i = 0; i < n; i++) {
        if (budget[i] <= 0) continue;
        const share = total * (budget[i] / budgetSum);
        h[i] += share;
        budget[i] = share;
        maps.deposited[i] += share;
        maps.talus[i] += share;
        placed += share;
      }
    }
    // Anything the profile could not absorb settles just offshore.
    const leftover = total - placed;
    if (leftover > 1e-9 && cuts.length) {
      const per = leftover / cuts.length;
      for (const [i] of cuts) {
        h[i] += per;
        maps.deposited[i] += per;
        maps.talus[i] += per;
      }
    }
  }
  if (onProgress) onProgress(1, 'Storm seasons');
}

const PROCESSES = { hydraulic, rainfall, thermal, wind, glacial, coastal };

/* ------------------------------------------------------------------- driver */

/**
 * Run one erosion pass in place.
 *
 * @param {string} type       erosion type id
 * @param {Float32Array} h    normalized height field, mutated in place
 * @param {number} res        grid resolution (res × res)
 * @param {object} params     parameters for that type
 * @param {object} opts       { strength, seed, aspect, verticalScale, onProgress, maps }
 *                            `aspect` is cellSize / maxHeight, which converts the
 *                            normalized field into real slope for angle thresholds.
 * @returns {object} diagnostic maps and statistics
 */
export function runErosion(type, h, res, params, opts = {}) {
  const process = PROCESSES[type];
  if (!process) throw new Error(`Unknown erosion type: ${type}`);
  const strength = opts.strength === undefined ? 1 : opts.strength;
  const seed = opts.seed || 1;
  const n = res * res;
  const maps = opts.maps || {
    eroded: zeros(n),
    deposited: zeros(n),
    flow: zeros(n),
    water: zeros(n),
    talus: zeros(n),
  };

  if (strength <= 0) return { maps, changed: 0, moved: 0 };

  // Work on a scaled copy so the strength slider multiplies the displacement
  // rather than re-tuning each algorithm's internal constants.
  const work = new Float32Array(n);
  for (let i = 0; i < n; i++) work[i] = h[i];
  const before = new Float32Array(n);
  before.set(work);

  const localMaps = {
    eroded: zeros(n),
    deposited: zeros(n),
    flow: zeros(n),
    water: zeros(n),
    talus: zeros(n),
  };
  const scaled = {
    ...params,
    aspect: opts.aspect === undefined ? 0.01 : opts.aspect,
    verticalScale: opts.verticalScale === undefined ? (params.verticalScale || 1) : opts.verticalScale,
  };
  process(work, res, scaled, seed, localMaps, opts.onProgress);

  // Blend the eroded result back by `strength` so 0 is a no-op and 1 is full.
  let moved = 0;
  for (let i = 0; i < n; i++) {
    const delta = (work[i] - before[i]) * strength;
    // The field must stay normalized for the layer stack to compose, so the
    // blend is clamped; processes that would leave the map lose that material.
    h[i] = clamp01(before[i] + delta);
    maps.eroded[i] += localMaps.eroded[i] * strength;
    maps.deposited[i] += localMaps.deposited[i] * strength;
    maps.flow[i] += localMaps.flow[i];
    maps.water[i] += localMaps.water[i];
    maps.talus[i] += localMaps.talus[i] * strength;
    moved += Math.abs(delta);
  }
  return { maps, moved, changed: moved / n };
}

/**
 * Standing-water / lake mask derived from the height field and a sea level.
 * Cheap flood fill by threshold: anything below the level counts as water,
 * with a feathered edge used by the shader and the texture rules.
 */
export function waterMask(h, res, seaLevel, feather = 0.01) {
  const out = new Float32Array(res * res);
  for (let i = 0; i < out.length; i++) {
    const d = h[i] - seaLevel;
    out[i] = d < 0 ? 1 : clamp01(1 - d / Math.max(feather, 1e-6));
  }
  return out;
}
