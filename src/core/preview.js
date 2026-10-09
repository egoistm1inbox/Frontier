/**
 * Frontier Landscape Studio — single-layer previews.
 *
 * The inspector shows what one layer contributes on its own, at low resolution,
 * so a slider's effect is visible without waiting for the full bake. Modifiers
 * are previewed against a synthetic test surface: a dome crossed by ridges,
 * which makes blur, sharpen, flatten and terrace read clearly.
 */

import { Perlin, fbm, clamp01 } from './noise.js';
import { layerType } from './layers.js';

const PREVIEW_SIZE = 112;

/** A synthetic input surface for modifier previews. */
export function testSurface(res = PREVIEW_SIZE) {
  const out = new Float32Array(res * res);
  const perlin = new Perlin(2024);
  const cx = res * 0.5, cy = res * 0.52;
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const d = Math.hypot((x - cx) / (res * 0.5), (y - cy) / (res * 0.5));
      const dome = clamp01(1 - Math.pow(d, 1.8));
      const ridges = Math.abs(perlin.noise((x / res) * 7.5, (y / res) * 7.5));
      const detail = fbm(perlin, (x / res) * 22, (y / res) * 22, 4, 2, 0.5);
      out[y * res + x] = clamp01(dome * 0.72 + (1 - ridges) * 0.22 + detail * 0.14);
    }
  }
  return out;
}

let cachedInput = null;
export function previewInput() {
  if (!cachedInput) cachedInput = testSurface(PREVIEW_SIZE);
  return cachedInput;
}

/**
 * Evaluate one layer in isolation.
 * Returns a normalized Float32Array, or null when the layer cannot be previewed
 * on its own (erosion needs the real stack; brushes need painted data).
 */
export function previewLayer(layer, brushField = null, imported = null) {
  const res = PREVIEW_SIZE;
  const type = layerType(layer.type);
  const n = res * res;
  const input = type.modifier ? previewInput() : new Float32Array(n);

  if (layer.type === 'erode') return null;
  if (layer.type === 'brush') return brushField ? resample(brushField, brushField.length ? Math.sqrt(brushField.length) | 0 : res, res) : null;
  if (layer.type === 'import' && !imported) return null;

  // Re-import the baker lazily so this module stays cheap to load.
  const field = evaluate(layer.type, layer.params || {}, res, input, { brushField, imported });
  if (!field) return null;

  let min = Infinity, max = -Infinity;
  for (let i = 0; i < n; i++) { if (field[i] < min) min = field[i]; if (field[i] > max) max = field[i]; }
  const span = max - min;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = span < 1e-6 ? 0.5 : (field[i] - min) / span;
  return out;
}

function resample(src, srcRes, dstRes) {
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

/** Render a normalized field to an ImageData-ready RGBA array. */
export function fieldToImage(field, res, ramp = null) {
  const data = new Uint8ClampedArray(res * res * 4);
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      // Flip so the preview matches the viewport orientation.
      const src = (res - 1 - y) * res + x;
      const dst = (y * res + x) * 4;
      const v = clamp01(field[src]);
      // Cheap hillshade so previews read as terrain rather than flat gray.
      const l = field[(res - 1 - y) * res + Math.max(0, x - 1)];
      const r = field[(res - 1 - y) * res + Math.min(res - 1, x + 1)];
      const u = field[Math.min(res - 1, res - y) * res + x];
      const d = field[Math.max(0, res - 2 - y) * res + x];
      const shade = clamp01(0.68 + ((l - r) + (u - d)) * 7);
      if (ramp) {
        const [cr, cg, cb] = ramp(v);
        data[dst] = cr * shade; data[dst + 1] = cg * shade; data[dst + 2] = cb * shade;
      } else {
        const g = v * 235 * shade + 12;
        data[dst] = g * 0.98; data[dst + 1] = g; data[dst + 2] = g * 1.03;
      }
      data[dst + 3] = 255;
    }
  }
  return data;
}

/** The layer baker is shared with the full-stack pipeline. */
import { evaluateLayer } from './layers.js';
function evaluate(type, params, res, input, ctx) {
  return evaluateLayer(type, params, res, input, ctx);
}

export { PREVIEW_SIZE };
