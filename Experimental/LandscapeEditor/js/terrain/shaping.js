// Shaping operations: they change the heights that already exist, rather than generating new ones.
import { boxBlur } from '../core/grid.js';
import { clamp } from '../core/rng.js';

// Stepped plateaus. `sharpness` 0 keeps a smooth ramp, 1 gives hard cliffs between terraces.
export function applyTerrace(h, N, p) {
  const out = new Float32Array(h.length);
  const steps = Math.max(2, Math.round(p.steps));
  const sharp = clamp(p.sharpness, 0, 0.98);
  for (let i = 0; i < h.length; i++) {
    const t = clamp(h[i], 0, 1) * steps;
    const level = Math.floor(t);
    const f = t - level;
    // Stretch the middle of each step so the riser is steeper as sharpness rises.
    const g = clamp((f - 0.5) / (1 - sharp) + 0.5, 0, 1);
    out[i] = (level + g) / steps;
  }
  return out;
}

// Repeated box blur. Radius and iterations approximate a Gaussian of the same width.
export function applySmooth(h, N, p) {
  let cur = h;
  const iters = Math.max(1, Math.round(p.iterations));
  for (let k = 0; k < iters; k++) cur = boxBlur(cur, N, Math.max(1, Math.round(p.radius)));
  return cur;
}

// Input window, gamma, output window. Black and white points are in normalised height.
export function applyLevels(h, N, p) {
  const out = new Float32Array(h.length);
  const lo = Math.min(p.low, p.high - 0.001);
  const hi = Math.max(p.high, lo + 0.001);
  const invGamma = 1 / Math.max(0.05, p.gamma);
  for (let i = 0; i < h.length; i++) {
    const t = clamp((h[i] - lo) / (hi - lo), 0, 1);
    out[i] = Math.pow(t, invGamma);
  }
  return out;
}
