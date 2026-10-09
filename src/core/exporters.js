/**
 * Frontier Landscape Studio — import and export.
 *
 * Heightmaps leave the editor as 8-bit grayscale PNG for quick exchange, as raw
 * 16-bit `.r16` for engines that want full precision, and as a tangent-space
 * normal map. The albedo bake and the project document round it out.
 */

import { clamp01 } from './noise.js';

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function canvasFrom(data, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  image.data.set(data);
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

/** 8-bit grayscale heightmap. */
export async function exportHeightmapPng(height, res, filename = 'heightmap.png') {
  const data = new Uint8ClampedArray(res * res * 4);
  for (let i = 0; i < res * res; i++) {
    // Flip vertically so the PNG matches the conventional texture orientation.
    const x = i % res, y = (i / res) | 0;
    const v = Math.round(clamp01(height[(res - 1 - y) * res + x]) * 255);
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  const blob = await canvasToBlob(canvasFrom(data, res, res));
  download(blob, filename);
  return blob;
}

/** Raw little-endian 16-bit heightmap — the format most engines ingest. */
export function exportHeightmapR16(height, res, filename = 'heightmap.r16') {
  const buffer = new ArrayBuffer(res * res * 2);
  const view = new DataView(buffer);
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const src = (res - 1 - y) * res + x;
      view.setUint16((y * res + x) * 2, Math.round(clamp01(height[src]) * 65535), true);
    }
  }
  download(new Blob([buffer], { type: 'application/octet-stream' }), filename);
  return buffer.byteLength;
}

/** Tangent-space normal map derived from the height field. */
export async function exportNormalMapPng(height, res, strength = 3, filename = 'normal.png') {
  const data = new Uint8ClampedArray(res * res * 4);
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const xm = Math.max(0, x - 1), xp = Math.min(res - 1, x + 1);
      const ym = Math.max(0, y - 1), yp = Math.min(res - 1, y + 1);
      const dx = (height[y * res + xp] - height[y * res + xm]) * strength;
      const dy = (height[yp * res + x] - height[ym * res + x]) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const out = ((res - 1 - y) * res + x) * 4;
      data[out] = (nx * 0.5 + 0.5) * 255;
      data[out + 1] = (ny * 0.5 + 0.5) * 255;
      data[out + 2] = (nz * 0.5 + 0.5) * 255;
      data[out + 3] = 255;
    }
  }
  const blob = await canvasToBlob(canvasFrom(data, res, res));
  download(blob, filename);
  return blob;
}

/** The baked surface albedo, straight out of the texture pipeline. */
export async function exportAlbedoPng(albedo, size, filename = 'albedo.png') {
  const blob = await canvasToBlob(canvasFrom(new Uint8ClampedArray(albedo), size, size));
  download(blob, filename);
  return blob;
}

/** Wavefront OBJ — useful for taking the landscape into a DCC tool. */
export function exportObj(height, res, worldSize = 2048, maxHeight = 900, filename = 'landscape.obj') {
  const step = res > 513 ? 2 : 1;
  const lines = ['# Frontier Landscape Studio', `# ${res}x${res} heightfield, step ${step}`];
  const cell = worldSize / (res - 1);
  const indexAt = (x, y) => (y / step) * Math.ceil((res - 1) / step + 1) + (x / step) + 1;
  for (let y = 0; y < res; y += step) {
    for (let x = 0; x < res; x += step) {
      const wx = (x - (res - 1) / 2) * cell;
      const wz = ((res - 1) / 2 - y) * cell;
      lines.push(`v ${wx.toFixed(4)} ${(height[y * res + x] * maxHeight).toFixed(4)} ${wz.toFixed(4)}`);
    }
  }
  const cols = Math.floor((res - 1) / step) + 1;
  for (let y = 0; y < cols - 1; y++) {
    for (let x = 0; x < cols - 1; x++) {
      const a = y * cols + x + 1, b = a + 1, c = a + cols, d = c + 1;
      lines.push(`f ${a} ${c} ${b}`, `f ${b} ${c} ${d}`);
    }
  }
  const text = lines.join('\n');
  download(new Blob([text], { type: 'text/plain' }), filename);
  return text.length;
}

/** Project document, minus any imported imagery. */
export function exportProjectJson(project, filename) {
  const clean = JSON.parse(JSON.stringify(project, (key, value) => (key === 'image' ? undefined : value)));
  download(new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' }),
    filename || `${(project.name || 'landscape').replace(/[^\w-]+/g, '-').toLowerCase()}.landscape.json`);
  return clean;
}

/* ------------------------------------------------------------------ import */

export function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('That file could not be decoded as an image.'));
      image.src = reader.result;
    };
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Load a grayscale heightmap and resample it onto the working grid.
 * The image's own resolution is preserved for later export.
 */
export async function importHeightmap(file, res) {
  const image = await readImageFile(file);
  const w = image.naturalWidth, h = image.naturalHeight;
  if (!w || !h) throw new Error('Empty image.');
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, w, h).data;
  const field = new Float32Array(res * res);
  let min = Infinity, max = -Infinity;
  for (let y = 0; y < res; y++) {
    const sy = Math.min(h - 1, Math.round((y / (res - 1)) * (h - 1)));
    for (let x = 0; x < res; x++) {
      const sx = Math.min(w - 1, Math.round((x / (res - 1)) * (w - 1)));
      const i = ((h - 1 - sy) * w + sx) * 4;
      const v = (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114) / 255;
      field[y * res + x] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  // Normalize so an imported map always uses the full range.
  const span = max - min || 1;
  for (let i = 0; i < field.length; i++) field[i] = (field[i] - min) / span;
  return { field, width: w, height: h, name: file.name, min, max };
}

/** Load a satellite image for draping. Kept at native resolution. */
export async function importSatmap(file, maxSize = 2048) {
  const image = await readImageFile(file);
  let w = image.naturalWidth, h = image.naturalHeight;
  const scale = Math.min(1, maxSize / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, w, h);
  const pixels = ctx.getImageData(0, 0, w, h).data;

  // Pad to a square so planar UVs stay simple, keeping the aspect via offset.
  const size = Math.max(w, h);
  const data = new Uint8Array(size * size * 4);
  const offX = ((size - w) / 2) | 0, offY = ((size - h) / 2) | 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 4;
      const dst = ((y + offY) * size + (x + offX)) * 4;
      data[dst] = pixels[src]; data[dst + 1] = pixels[src + 1];
      data[dst + 2] = pixels[src + 2]; data[dst + 3] = 255;
    }
  }
  return {
    width: size,
    height: size,
    data: Array.from(data),
    sourceWidth: w,
    sourceHeight: h,
    name: file.name,
    bytes: file.size,
  };
}
