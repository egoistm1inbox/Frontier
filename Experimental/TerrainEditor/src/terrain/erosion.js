// Erosion simulation. All passes work on a normalized height field ([0,1])
// and return the modified field plus optional sediment / water-flux maps
// (both normalized 0..1) that feed the satmap's rivers and sedimentation
// channels. The pipeline rescales to meters afterwards.
//
// Types:
//   hydraulic — droplet-based runoff erosion/deposition (Hans Theobald Beyer /
//               Sebastian Lague style particle model)
//   thermal   — talus / repose-angle granular relaxation
//   fluvial   — D8 flow accumulation driven river channel carving
//   aeolian   — wind transport of a dry sand layer (dune building)

import { mulberry32, valueNoise, smoothstep, clamp01 } from './noise.js';

export function sampleHeight(h, size, x, y) {
  const x0 = Math.min(size - 2, Math.max(0, (x | 0)));
  const y0 = Math.min(size - 2, Math.max(0, (y | 0)));
  const fx = x - x0, fy = y - y0;
  const i = y0 * size + x0;
  const a = h[i], b = h[i + 1], c = h[i + size], d = h[i + size + 1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export function sampleGradient(h, size, x, y) {
  const x0 = Math.min(size - 2, Math.max(0, (x | 0)));
  const y0 = Math.min(size - 2, Math.max(0, (y | 0)));
  const fx = x - x0, fy = y - y0;
  const i = y0 * size + x0;
  const a = h[i], b = h[i + 1], c = h[i + size], d = h[i + size + 1];
  return [(b - a) * (1 - fy) + (d - c) * fy, (c - a) * (1 - fx) + (d - b) * fx];
}

function depositBilinear(field, size, x, y, amount) {
  const x0 = Math.min(size - 2, Math.max(0, (x | 0)));
  const y0 = Math.min(size - 2, Math.max(0, (y | 0)));
  const fx = x - x0, fy = y - y0;
  const i = y0 * size + x0;
  field[i] += amount * (1 - fx) * (1 - fy);
  field[i + 1] += amount * fx * (1 - fy);
  field[i + size] += amount * (1 - fx) * fy;
  field[i + size + 1] += amount * fx * fy;
}

function makeBrush(radius) {
  const r = Math.max(1, Math.min(8, Math.round(radius)));
  const offsets = [];
  let wsum = 0;
  for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
    const d = Math.hypot(ox, oy);
    if (d > r) continue;
    const w = 1 - d / (r + 1);
    offsets.push([ox, oy, w]);
    wsum += w;
  }
  for (const o of offsets) o[2] /= wsum;
  return offsets;
}

export function normalize01(field) {
  let max = 0;
  for (let i = 0; i < field.length; i++) if (field[i] > max) max = field[i];
  if (max > 0) for (let i = 0; i < field.length; i++) field[i] /= max;
  return field;
}

export function boxBlur(field, size, radius) {
  const r = Math.max(1, Math.round(radius));
  const tmp = new Float32Array(field.length);
  const out = new Float32Array(field.length);
  const width = r * 2 + 1;
  for (let y = 0; y < size; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += field[y * size + Math.min(size - 1, Math.max(0, x))];
    for (let x = 0; x < size; x++) {
      tmp[y * size + x] = acc / width;
      const xa = Math.min(size - 1, Math.max(0, x - r));
      const xb = Math.min(size - 1, Math.max(0, x + r + 1));
      acc += field[y * size + xb] - field[y * size + xa];
    }
  }
  for (let x = 0; x < size; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(size - 1, Math.max(0, y)) * size + x];
    for (let y = 0; y < size; y++) {
      out[y * size + x] = acc / width;
      const ya = Math.min(size - 1, Math.max(0, y - r));
      const yb = Math.min(size - 1, Math.max(0, y + r + 1));
      acc += tmp[yb * size + x] - tmp[ya * size + x];
    }
  }
  return out;
}

// Normalized slope magnitude [0,1] from a normalized height field.
export function computeSlopeN(heightN, size) {
  const out = new Float32Array(size * size);
  let max = 1e-9;
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
    const i = y * size + x;
    const gx = (heightN[i + 1] - heightN[i - 1]) * 0.5;
    const gy = (heightN[i + size] - heightN[i - size]) * 0.5;
    const m = Math.hypot(gx, gy);
    out[i] = m;
    if (m > max) max = m;
  }
  for (let i = 0; i < out.length; i++) out[i] /= max;
  return out;
}

// D8 flow accumulation. Returns normalized accumulation and flux direction grid.
export function computeFlow(heightN, size, seed) {
  const n = size * size;
  const rng = mulberry32(seed);
  const eff = new Float32Array(n);
  for (let i = 0; i < n; i++) eff[i] = heightN[i] + rng() * 1e-4;
  const nbrs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const dirs = new Int32Array(n).fill(-1);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    let best = eff[i], bi = -1;
    for (const [dx, dy] of nbrs) {
      const xi = x + dx, yi = y + dy;
      if (xi < 0 || yi < 0 || xi >= size || yi >= size) continue;
      const v = eff[yi * size + xi];
      if (v < best) { best = v; bi = yi * size + xi; }
    }
    dirs[i] = bi;
  }
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const sorted = Array.from(order).sort((a, b) => eff[b] - eff[a]);
  const accum = new Float32Array(n).fill(1);
  for (const i of sorted) {
    const j = dirs[i];
    if (j >= 0) accum[j] += accum[i];
  }
  let amax = 1;
  for (let i = 0; i < n; i++) if (accum[i] > amax) amax = accum[i];
  return { accum, amax, dirs };
}

// ---------------------------------------------------------------- hydraulic

export function erodeHydraulic(hNorm, size, p, seed, onProgress) {
  const n = size * size;
  const out = Float32Array.from(hNorm);
  const sediment = new Float32Array(n);
  const flux = new Float32Array(n);
  const margin = Math.max(2, Math.min(12, Math.round(p.radius) + 1));
  const rng = mulberry32(seed);
  const brush = makeBrush(p.radius);
  const droplets = Math.max(1, p.droplets | 0);
  const lifetime = Math.max(1, p.lifetime | 0);

  for (let d = 0; d < droplets; d++) {
    let x = margin + rng() * (size - 1 - 2 * margin);
    let y = margin + rng() * (size - 1 - 2 * margin);
    let dirX = 0, dirY = 0, speed = p.initialSpeed, water = p.initialWater, sed = 0;
    for (let s = 0; s < lifetime; s++) {
      if (x < 0 || y < 0 || x >= size - 1 || y >= size - 1) break;
      const nodeX = x | 0, nodeY = y | 0;
      const [gx, gy] = sampleGradient(out, size, x, y);
      dirX = dirX * p.inertia - gx * (1 - p.inertia);
      dirY = dirY * p.inertia - gy * (1 - p.inertia);
      const len = Math.hypot(dirX, dirY);
      if (len < 1e-5) {
        const a = rng() * Math.PI * 2;
        dirX = Math.cos(a); dirY = Math.sin(a);
      } else { dirX /= len; dirY /= len; }
      const oldH = sampleHeight(out, size, x, y);
      x += dirX; y += dirY;
      if (x < 0 || y < 0 || x >= size - 1 || y >= size - 1) break;
      const newH = sampleHeight(out, size, x, y);
      const dH = newH - oldH;
      const cap = Math.max(-dH, p.minSlope) * speed * water * p.capacity;
      if (sed > cap || dH > 0) {
        const amt = dH > 0 ? Math.min(dH, sed - cap) : (sed - cap) * p.depositSpeed;
        if (amt > 0) {
          sed -= amt;
          depositBilinear(sediment, size, x, y, amt);
          depositBilinear(out, size, x, y, amt);
        }
      } else {
        const amt = Math.min((cap - sed) * p.erodeSpeed, -dH);
        if (amt > 0) {
          for (const [ox, oy, w] of brush) {
            const xi = nodeX + ox, yi = nodeY + oy;
            if (xi >= 0 && yi >= 0 && xi < size && yi < size) out[yi * size + xi] -= amt * w;
          }
          sed += amt;
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed - dH * p.gravity));
      water *= (1 - p.evaporate);
      flux[nodeY * size + nodeX] += water * 0.05;
    }
    if ((d & 511) === 0 && onProgress) onProgress(d / droplets);
  }
  if (onProgress) onProgress(1);
  normalize01(sediment);
  normalize01(flux);
  return { height: out, sediment, flux };
}

export const hydraulicDefaults = {
  droplets: 60000, lifetime: 30, inertia: 0.05, capacity: 4, minSlope: 0.01,
  erodeSpeed: 0.3, depositSpeed: 0.3, evaporate: 0.01, gravity: 4, radius: 3,
  initialWater: 1, initialSpeed: 1,
};

export const hydraulicParams = [
  { key: 'droplets', label: 'Droplets', min: 2000, max: 400000, step: 1000, def: 60000, format: 'k' },
  { key: 'lifetime', label: 'Lifetime', min: 10, max: 60, step: 1, def: 30, unit: ' steps' },
  { key: 'inertia', label: 'Flow inertia', min: 0, max: 0.5, step: 0.01, def: 0.05 },
  { key: 'capacity', label: 'Sediment capacity', min: 0.5, max: 10, step: 0.1, def: 4 },
  { key: 'minSlope', label: 'Min slope', min: 0.001, max: 0.05, step: 0.001, def: 0.01 },
  { key: 'erodeSpeed', label: 'Erode speed', min: 0.05, max: 1, step: 0.01, def: 0.3 },
  { key: 'depositSpeed', label: 'Deposit speed', min: 0.05, max: 1, step: 0.01, def: 0.3 },
  { key: 'evaporate', label: 'Evaporation', min: 0.001, max: 0.05, step: 0.001, def: 0.01 },
  { key: 'gravity', label: 'Gravity', min: 1, max: 10, step: 0.1, def: 4 },
  { key: 'radius', label: 'Brush radius', min: 1, max: 8, step: 1, def: 3, unit: ' cells' },
];

// ------------------------------------------------------------------ thermal

export function erodeThermal(hNorm, size, p, seed, onProgress) {
  const out = Float32Array.from(hNorm);
  const sediment = new Float32Array(size * size);
  const delta = new Float32Array(size * size);
  const { iterations, talus, fraction } = p;
  const nbrs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let it = 0; it < iterations; it++) {
    // Double-buffered relaxation: all moves are computed from a snapshot of
    // the field, then applied at once. In-place updates would let material
    // bounce between neighbours and amplify without bound.
    delta.fill(0);
    for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      const h = out[i];
      let excess = 0, count = 0;
      for (const [dx, dy] of nbrs) {
        const diff = h - out[i + dy * size + dx];
        if (diff > talus) { excess += diff - talus; count++; }
      }
      if (count > 0) {
        const total = excess * fraction;
        const per = total / count;
        delta[i] -= total;
        for (const [dx, dy] of nbrs) {
          const j = i + dy * size + dx;
          if (h - out[j] > talus) delta[j] += per;
        }
      }
    }
    for (let i = 0; i < out.length; i++) {
      out[i] += delta[i];
      if (delta[i] > 0) sediment[i] += delta[i];
    }
    if (onProgress && (it & 3) === 0) onProgress((it + 1) / iterations);
  }
  if (onProgress) onProgress(1);
  normalize01(sediment);
  return { height: out, sediment, flux: null };
}

export const thermalDefaults = { iterations: 60, talus: 0.02, fraction: 0.5 };
export const thermalParams = [
  { key: 'iterations', label: 'Iterations', min: 5, max: 200, step: 1, def: 60 },
  { key: 'talus', label: 'Talus threshold', min: 0.005, max: 0.1, step: 0.001, def: 0.02 },
  { key: 'fraction', label: 'Relaxation', min: 0.1, max: 1, step: 0.05, def: 0.5 },
];

// ------------------------------------------------------------------ fluvial

export function erodeFluvial(hNorm, size, p, seed, onProgress) {
  const n = size * size;
  const { accum, amax } = computeFlow(hNorm, size, seed);
  const carve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = accum[i] / amax;
    const s = smoothstep(p.threshold, 1, a);
    carve[i] = p.depth * Math.pow(s, p.power);
  }
  let field = carve;
  if (p.meander > 0) {
    const warped = new Float32Array(n);
    const warp = p.meander * size * 0.06;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const wx = valueNoise(x * 0.05, y * 0.05, seed) * 2 - 1;
      const wy = valueNoise(x * 0.05 + 31.7, y * 0.05 + 17.3, seed + 5) * 2 - 1;
      const sx = Math.min(size - 1.001, Math.max(0, x + wx * warp));
      const sy = Math.min(size - 1.001, Math.max(0, y + wy * warp));
      warped[i] = sampleHeight(carve, size, sx, sy);
    }
    field = warped;
  }
  if (p.width > 0) field = boxBlur(field, size, p.width);
  const out = Float32Array.from(hNorm);
  const sediment = new Float32Array(n);
  for (let pass = 0; pass < p.passes; pass++) {
    for (let i = 0; i < n; i++) {
      const c = field[i] / p.passes;
      out[i] -= c;
      sediment[i] += c * p.deposition;
    }
    if (onProgress) onProgress((pass + 1) / p.passes);
  }
  normalize01(sediment);
  const flux = new Float32Array(n);
  for (let i = 0; i < n; i++) flux[i] = Math.sqrt(accum[i] / amax);
  return { height: out, sediment, flux };
}

export const fluvialDefaults = {
  passes: 3, depth: 0.08, power: 0.5, width: 2, meander: 0.5, threshold: 0.3, deposition: 0.5,
};
export const fluvialParams = [
  { key: 'passes', label: 'Carving passes', min: 1, max: 6, step: 1, def: 3 },
  { key: 'depth', label: 'Channel depth', min: 0.01, max: 0.25, step: 0.005, def: 0.08 },
  { key: 'power', label: 'Accumulation power', min: 0.2, max: 1.5, step: 0.05, def: 0.5 },
  { key: 'width', label: 'Channel width', min: 0, max: 6, step: 0.5, def: 2, unit: ' cells' },
  { key: 'meander', label: 'Meander', min: 0, max: 1, step: 0.05, def: 0.5 },
  { key: 'threshold', label: 'Flow threshold', min: 0, max: 0.8, step: 0.02, def: 0.3 },
  { key: 'deposition', label: 'Alluvial deposit', min: 0, max: 1, step: 0.05, def: 0.5 },
];

// ------------------------------------------------------------------ aeolian

export function erodeAeolian(hNorm, size, p, seed, onProgress) {
  const n = size * size;
  const out = Float32Array.from(hNorm);
  const slope = computeSlopeN(hNorm, size);
  let sand = new Float32Array(n);
  for (let i = 0; i < n; i++) sand[i] = Math.max(0, 1 - slope[i] / p.slopeMax);
  const a = p.direction * Math.PI / 180;
  const wx = Math.cos(a), wy = Math.sin(a);
  const t = Math.max(0.5, p.transport);
  const duneHeight = 0.06;

  for (let it = 0; it < p.iterations; it++) {
    const next = new Float32Array(n);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const ux = x - wx * t, uy = y - wy * t;
      const influx = sampleHeight(sand, size, ux, uy);
      const here = sand[i];
      // climbing downwind chokes transport (deposition), descending frees it
      const hUp = sampleHeight(out, size, ux, uy);
      const climb = (out[i] - hUp) / t;
      const cap = p.strength * (0.35 + 0.65 * Math.max(0, 1 - clamp01(climb * 6)));
      const loss = Math.min(here, p.erosion * cap);
      const gain = Math.min(influx * 0.92, influx * 0.92 * (0.6 + p.deposition * clamp01(climb * 8) * 1.6));
      next[i] = clamp01(here - loss + gain);
    }
    sand = next;
    if (onProgress && (it & 3) === 0) onProgress((it + 1) / p.iterations);
  }
  if (onProgress) onProgress(1);
  // apply the sand delta to the heightfield and add wind ripple detail
  const sediment = new Float32Array(n);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const delta = (sand[i] - 0.5) * duneHeight * 2;
    out[i] = clamp01(out[i] + delta);
    const phase = (x * wx + y * wy) / p.wavelength * Math.PI * 2;
    out[i] = clamp01(out[i] + Math.sin(phase) * p.ripple * duneHeight * 0.5 * sand[i]);
    sediment[i] = sand[i];
  }
  normalize01(sediment);
  return { height: out, sediment, flux: null };
}

export const aeolianDefaults = {
  iterations: 40, strength: 0.6, direction: 20, transport: 2.5,
  erosion: 0.45, deposition: 0.35, ripple: 0.4, slopeMax: 0.35, wavelength: 18,
};
export const aeolianParams = [
  { key: 'iterations', label: 'Iterations', min: 5, max: 120, step: 1, def: 40 },
  { key: 'strength', label: 'Wind strength', min: 0.1, max: 1, step: 0.05, def: 0.6 },
  { key: 'direction', label: 'Wind direction', min: 0, max: 360, step: 1, def: 20, unit: '°' },
  { key: 'transport', label: 'Transport length', min: 1, max: 6, step: 0.5, def: 2.5, unit: ' cells' },
  { key: 'erosion', label: 'Erosion rate', min: 0.05, max: 1, step: 0.05, def: 0.45 },
  { key: 'deposition', label: 'Deposition rate', min: 0.05, max: 1, step: 0.05, def: 0.35 },
  { key: 'ripple', label: 'Ripple detail', min: 0, max: 0.8, step: 0.05, def: 0.4 },
  { key: 'slopeMax', label: 'Max dune slope', min: 0.1, max: 0.8, step: 0.01, def: 0.35 },
  { key: 'wavelength', label: 'Ripple wavelength', min: 6, max: 48, step: 1, def: 18, unit: ' cells' },
];

// ------------------------------------------------------------------ registry

export const erosionTypes = [
  { id: 'hydraulic', label: 'Hydraulic (rainfall)', params: hydraulicParams, defaults: hydraulicDefaults, run: erodeHydraulic },
  { id: 'thermal', label: 'Thermal (talus)', params: thermalParams, defaults: thermalDefaults, run: erodeThermal },
  { id: 'fluvial', label: 'Fluvial (rivers)', params: fluvialParams, defaults: fluvialDefaults, run: erodeFluvial },
  { id: 'aeolian', label: 'Aeolian (wind)', params: aeolianParams, defaults: aeolianDefaults, run: erodeAeolian },
];

export function erosionById(id) {
  return erosionTypes.find((e) => e.id === id) || erosionTypes[0];
}
