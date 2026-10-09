/**
 * Frontier Landscape Studio — sculpt brushes.
 *
 * Painting never writes to the baked terrain. Each brush layer owns a delta
 * field, and strokes accumulate into it, so the layer can be muted, faded with
 * opacity, masked, reordered or deleted like any other layer.
 */

import { Perlin, fbm, clamp01 } from './noise.js';

/** Radial falloff: 1 at the centre, 0 at the rim. */
export function falloffAt(distance, radius, falloff) {
  const t = clamp01(distance / Math.max(0.0001, radius));
  const hardness = clamp01(falloff);
  // hardness 0 → perfectly soft, hardness 1 → flat-top disc with a sharp rim
  const soft = 0.5 * (1 + Math.cos(Math.PI * t));
  const hard = t < 0.92 ? 1 : clamp01((1 - t) / 0.08);
  return soft * (1 - hardness) + hard * hardness;
}

/**
 * Apply one dab.
 *
 * @param {Float32Array} delta   the brush layer's accumulated field
 * @param {Float32Array} base    the surface as baked without this brush layer
 * @param {number} res           grid resolution
 * @param {object} dab           { x, y, radius, strength, falloff, mode, level, seed, noiseScale }
 */
export function dab(delta, base, res, dab) {
  const { x, y, radius, strength, mode, falloff = 0.5, level = 0.3, seed = 1, noiseScale = 8 } = dab;
  const r = Math.max(1, radius);
  const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(res - 1, Math.ceil(x + r));
  const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(res - 1, Math.ceil(y + r));
  if (x1 < x0 || y1 < y0) return;

  const perlin = mode === 'noise' ? new Perlin(seed) : null;

  if (mode === 'smooth' || mode === 'flatten' || mode === 'plateau') {
    // These need the current surface, which is base plus whatever is painted.
    const current = new Float32Array(res * res);
    for (let i = 0; i < current.length; i++) current[i] = base[i] + delta[i];

    if (mode === 'smooth') {
      for (let gy = y0; gy <= y1; gy++) {
        for (let gx = x0; gx <= x1; gx++) {
          const d = Math.hypot(gx - x, gy - y);
          if (d > r) continue;
          const w = falloffAt(d, r, falloff) * strength;
          if (w <= 0) continue;
          const i = gy * res + gx;
          const xm = Math.max(0, gx - 2), xp = Math.min(res - 1, gx + 2);
          const ym = Math.max(0, gy - 2), yp = Math.min(res - 1, gy + 2);
          let sum = 0, count = 0;
          for (let yy = ym; yy <= yp; yy++) {
            for (let xx = xm; xx <= xp; xx++) { sum += current[yy * res + xx]; count++; }
          }
          const avg = sum / Math.max(1, count);
          delta[i] += (avg - current[i]) * w;
        }
      }
      return;
    }

    const target = mode === 'plateau' ? level : level;
    const soft = mode === 'flatten' ? 1 : 0.86;
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const d = Math.hypot(gx - x, gy - y);
        if (d > r) continue;
        const w = falloffAt(d, r, falloff) * strength * soft;
        if (w <= 0) continue;
        const i = gy * res + gx;
        delta[i] += (target - current[i]) * w;
      }
    }
    return;
  }

  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      const d = Math.hypot(gx - x, gy - y);
      if (d > r) continue;
      const w = falloffAt(d, r, falloff);
      if (w <= 0) continue;
      const i = gy * res + gx;
      switch (mode) {
        case 'raise':
          delta[i] += w * strength;
          break;
        case 'lower':
          delta[i] -= w * strength;
          break;
        case 'noise': {
          const n = fbm(perlin, (gx / res) * noiseScale, (gy / res) * noiseScale, 4, 2, 0.5);
          delta[i] += (n - 0.5) * 2 * w * strength;
          break;
        }
        case 'erase':
          delta[i] *= 1 - w * Math.min(1, strength * 4);
          break;
        default:
          delta[i] += w * strength;
      }
    }
  }
}

/**
 * Interpolate a pointer drag into evenly spaced dabs so fast strokes do not
 * leave a dotted line.
 */
export function stroke(delta, base, res, from, to, dabSettings, spacing = 0.28) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const step = Math.max(spacing * dabSettings.radius, 0.35);
  const count = Math.max(1, Math.ceil(dist / step));
  for (let i = 0; i <= count; i++) {
    const t = count === 0 ? 1 : i / count;
    dab(delta, base, res, {
      ...dabSettings,
      x: from.x + dx * t,
      y: from.y + dy * t,
      // Taper the ends slightly so strokes do not stamp hard dots.
      strength: dabSettings.strength * (count === 0 ? 1 : 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, Math.max(0.05, t)))),
    });
  }
}

export function emptyDelta(res) { return new Float32Array(res * res); }

/** Resample a brush field when the grid resolution changes. */
export function resampleField(src, srcRes, dstRes) {
  if (srcRes === dstRes) return new Float32Array(src);
  const out = new Float32Array(dstRes * dstRes);
  for (let y = 0; y < dstRes; y++) {
    const sy = (y / (dstRes - 1)) * (srcRes - 1);
    const y0 = Math.min(srcRes - 2, Math.floor(sy)), ty = sy - y0;
    for (let x = 0; x < dstRes; x++) {
      const sx = (x / (dstRes - 1)) * (srcRes - 1);
      const x0 = Math.min(srcRes - 2, Math.floor(sx)), tx = sx - x0;
      const i = y0 * srcRes + x0;
      out[y * dstRes + x] =
        (src[i] * (1 - tx) + src[i + 1] * tx) * (1 - ty) +
        (src[i + srcRes] * (1 - tx) + src[i + srcRes + 1] * tx) * ty;
    }
  }
  return out;
}
