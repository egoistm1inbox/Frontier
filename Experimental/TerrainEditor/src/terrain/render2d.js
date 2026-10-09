// 2D map rendering: turns the pipeline channels into pixels for each of the
// viewport's map modes (satmap, hillshade, height, slope, rivers, sediment,
// strata).

import { colorize, paletteById } from './satmap.js';
import { smoothstep, clamp01, lerp } from './noise.js';

export const mapModes = [
  { id: 'satmap', label: 'Satmap' },
  { id: 'hillshade', label: 'Hillshade' },
  { id: 'height', label: 'Height' },
  { id: 'slope', label: 'Slope' },
  { id: 'rivers', label: 'Rivers' },
  { id: 'sediment', label: 'Sediment' },
  { id: 'strata', label: 'Strata' },
];

export function hillshade(heightN, size, azimuthDeg = 315, elevationDeg = 42, exaggeration = 2.5) {
  const out = new Float32Array(size * size);
  const az = azimuthDeg * Math.PI / 180, el = elevationDeg * Math.PI / 180;
  const sun = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
    const i = y * size + x;
    const gx = (heightN[i + 1] - heightN[i - 1]) * 0.5 * exaggeration;
    const gy = (heightN[i + size] - heightN[i - size]) * 0.5 * exaggeration;
    // normal in (x, y-up, z) space; gy maps to z
    const nx = -gx, nz = -gy, ny = 1;
    const len = Math.hypot(nx, ny, nz) || 1;
    const d = (nx * sun[0] + ny * sun[1] + nz * sun[2]) / len;
    out[i] = 0.32 + 0.68 * Math.max(0, d);
  }
  return out;
}

function heightRamp(t, pal, waterN) {
  if (t < waterN) {
    const depth = clamp01((waterN - t) / Math.max(0.06, waterN));
    const c = mixRGB(pal.shallow, pal.deep, depth * 0.85);
    return c;
  }
  const u = clamp01((t - waterN) / Math.max(1e-4, 1 - waterN));
  if (u > pal.snowStart) return pal.snow;
  if (u > 0.45) return mixRGB(pal.scree, pal.snow, (u - 0.45) / (pal.snowStart - 0.45));
  if (u > 0.02) return mixRGB(pal.grass, pal.scree, (u - 0.02) / 0.43);
  return pal.sand;
}

function mixRGB(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function buildImageData(mode, data, paletteId, seed = 1) {
  const size = data.size;
  const sat = colorize(data, paletteId, seed);
  if (mode === 'satmap') return sat;
  const pal = paletteById(paletteId);
  const out = new Uint8ClampedArray(sat);
  const { heightN, slopeN, rivers, sediment, strata, strataPhase, waterN } = data;

  if (mode === 'hillshade') {
    const shade = hillshade(heightN, size);
    for (let i = 0; i < size * size; i++) {
      const s = 0.35 + 0.75 * shade[i];
      out[i * 4] *= s; out[i * 4 + 1] *= s; out[i * 4 + 2] *= s;
    }
    return out;
  }

  if (mode === 'height') {
    for (let i = 0; i < size * size; i++) {
      const c = heightRamp(heightN[i], pal, waterN);
      out[i * 4] = c[0] * 255; out[i * 4 + 1] = c[1] * 255; out[i * 4 + 2] = c[2] * 255;
    }
    return out;
  }

  if (mode === 'slope') {
    for (let i = 0; i < size * size; i++) {
      const c = mixRGB([52, 66, 54], [208, 84, 60], smoothstep(0.15, 0.85, slopeN[i]));
      out[i * 4] = c[0] * 255; out[i * 4 + 1] = c[1] * 255; out[i * 4 + 2] = c[2] * 255;
    }
    return out;
  }

  // overlay modes: dimmed height base + channel overlay
  const overlay = mode === 'rivers' ? rivers : mode === 'sediment' ? sediment : strata;
  for (let i = 0; i < size * size; i++) {
    const c = heightRamp(heightN[i], pal, waterN);
    let r = c[0] * 0.3, g = c[1] * 0.3, b = c[2] * 0.3;
    if (mode === 'rivers') {
      const v = smoothstep(0.18, 0.6, overlay[i]);
      const w = mixRGB([r, g, b], pal.river, v * 0.95);
      r = w[0]; g = w[1]; b = w[2];
    } else if (mode === 'sediment') {
      const v = smoothstep(0.2, 0.75, overlay[i]);
      const w = mixRGB([r, g, b], pal.sediment, v * 0.8);
      r = w[0]; g = w[1]; b = w[2];
    } else {
      const v = clamp01(overlay[i]);
      const band = strataPhase[i] > 0.5 ? pal.strataA : pal.strataB;
      const w = mixRGB([r, g, b], band, v * 0.85);
      r = w[0]; g = w[1]; b = w[2];
    }
    out[i * 4] = r * 255; out[i * 4 + 1] = g * 255; out[i * 4 + 2] = b * 255;
  }
  return out;
}

// Draws an RGBA buffer onto a canvas, letterboxed to fit, with a vignette.
export function drawToCanvas(canvas, rgba, size) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssSize = Math.min(canvas.clientWidth || size, canvas.clientHeight || size);
  if (cssSize <= 0) return;
  const px = Math.round(cssSize * dpr);
  if (canvas.width !== px || canvas.height !== px) { canvas.width = px; canvas.height = px; }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, px, px);
  const off = document.createElement('canvas');
  off.width = size; off.height = size;
  off.getContext('2d').putImageData(new ImageData(rgba, size, size), 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(off, 0, 0, px, px);
  // vignette
  const grad = ctx.createRadialGradient(px / 2, px / 2, px * 0.35, px / 2, px / 2, px * 0.72);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.32)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, px, px);
}

// Grayscale heightmap export (8-bit PNG data URL source buffer).
export function heightToGrayRGBA(heightN, size) {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(clamp01(heightN[i]) * 255);
    out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
  }
  return out;
}
