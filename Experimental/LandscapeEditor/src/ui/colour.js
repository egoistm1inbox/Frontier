// Colour helpers shared by the viewport fields and the canvas previews. Everything here is
// plain JS so it can be unit-tested without a DOM.

export function hexToRgb(hex) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Builds a 256-entry lookup table (RGB, 0..1) from [t, hex] stops.
export function makeLut(stops) {
  const lut = new Float32Array(256 * 3);
  for (let i = 0; i < 256; i += 1) {
    const t = i / 255;
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s += 1) {
      if (t >= stops[s][0] && t <= stops[s + 1][0]) {
        a = stops[s];
        b = stops[s + 1];
        break;
      }
    }
    const span = b[0] - a[0] || 1;
    const k = Math.min(1, Math.max(0, (t - a[0]) / span));
    const ca = hexToRgb(a[1]);
    const cb = hexToRgb(b[1]);
    for (let c = 0; c < 3; c += 1) lut[i * 3 + c] = (ca[c] + (cb[c] - ca[c]) * k) / 255;
  }
  return lut;
}

const LAND = makeLut([
  [0, '#4f8c97'],
  [0.02, '#c8b98c'],
  [0.16, '#8d9d62'],
  [0.42, '#5f7e4b'],
  [0.62, '#7c7560'],
  [0.8, '#a09a8e'],
  [0.92, '#d6d3cb'],
  [1, '#f5f5f2'],
]);
const SLOPE = makeLut([
  [0, '#2f6b4f'],
  [0.25, '#a6c46b'],
  [0.5, '#efe2b0'],
  [0.75, '#c0604c'],
  [1, '#5a2e6b'],
]);
const FLOW = makeLut([
  [0, '#06111a'],
  [0.5, '#1d5f80'],
  [0.8, '#55c2e6'],
  [1, '#e7fbff'],
]);

function lutSample(lut, t, out, offset, scale = 1) {
  const i = Math.min(255, Math.max(0, Math.round(t * 255))) * 3;
  out[offset] = lut[i] * scale;
  out[offset + 1] = lut[i + 1] * scale;
  out[offset + 2] = lut[i + 2] * scale;
}

// Water colour from shallow (at sea level) to deep.
function waterColour(depthT, out, offset) {
  const deep = hexToRgb('#15324a');
  const shallow = hexToRgb('#3f7f9c');
  const k = Math.min(1, Math.max(0, depthT));
  for (let c = 0; c < 3; c += 1) out[offset + c] = (shallow[c] + (deep[c] - shallow[c]) * k) / 255;
}

// Fills an RGB float buffer for the chosen viewport mode. Heights are normalised (0..1 of
// maxHeight); slope is degrees; flow is 0..1; erosionDelta is normalised height change.
export function buildFields(mode, input) {
  const { heights, size, maxHeight, seaLevel, slope, flow, erosionDelta } = input;
  const n = size * size;
  const out = new Float32Array(n * 3);
  const sea = seaLevel / maxHeight;
  if (mode === 'shaded') {
    for (let i = 0; i < n; i += 1) {
      const h = heights[i];
      const o = i * 3;
      if (h < sea) {
        waterColour((sea - h) / Math.max(sea, 1e-3), out, o);
        continue;
      }
      const t = Math.min(1, (h - sea) / Math.max(1 - sea, 1e-3));
      const base = 0.46 + 0.34 * t;
      const shade = 1 - 0.32 * Math.min(1, Math.max(0, (slope[i] - 14) / 30));
      out[o] = base * shade * 0.94;
      out[o + 1] = (base * 0.96 + 0.02) * shade;
      out[o + 2] = (base * 0.84 + 0.02) * shade;
    }
    return out;
  }
  if (mode === 'height') {
    for (let i = 0; i < n; i += 1) {
      const h = heights[i];
      if (h < sea) waterColour((sea - h) / Math.max(sea, 1e-3), out, i * 3);
      else lutSample(LAND, (h - sea) / Math.max(1 - sea, 1e-3), out, i * 3);
    }
    return out;
  }
  if (mode === 'slope') {
    for (let i = 0; i < n; i += 1) lutSample(SLOPE, Math.min(1, slope[i] / 60), out, i * 3);
    return out;
  }
  if (mode === 'flow') {
    for (let i = 0; i < n; i += 1) {
      const f = Math.pow(flow[i], 1.4);
      lutSample(FLOW, f, out, i * 3);
    }
    return out;
  }
  if (mode === 'erosion') {
    let peak = 1e-9;
    for (let i = 0; i < n; i += 1) peak = Math.max(peak, Math.abs(erosionDelta[i]));
    const neutral = [0.29, 0.29, 0.29];
    const cut = [0.88, 0.33, 0.24];
    const fill = [0.25, 0.65, 0.84];
    for (let i = 0; i < n; i += 1) {
      const a = Math.min(1, Math.abs(erosionDelta[i]) / peak);
      const k = Math.pow(a, 0.6);
      const target = erosionDelta[i] < 0 ? cut : fill;
      const o = i * 3;
      for (let c = 0; c < 3; c += 1) out[o + c] = neutral[c] + (target[c] - neutral[c]) * k;
    }
    return out;
  }
  return null;
}

// Gradient stops for the legend strips. Each entry is [position 0..1, css colour].
export const LEGEND = {
  height: { stops: [[0, '#15324a'], [0.12, '#4f8c97'], [0.3, '#8d9d62'], [0.6, '#7c7560'], [1, '#f5f5f2']], labels: ['sea', 'low', 'high'] },
  slope: { stops: [[0, '#2f6b4f'], [0.25, '#a6c46b'], [0.5, '#efe2b0'], [0.75, '#c0604c'], [1, '#5a2e6b']], labels: ['0°', '15°', '30°', '45°', '60°'] },
  flow: { stops: [[0, '#06111a'], [0.5, '#1d5f80'], [0.8, '#55c2e6'], [1, '#e7fbff']], labels: ['trickle', 'stream', 'river'] },
  erosion: { stops: [[0, '#e0533d'], [0.5, '#4a4a4a'], [1, '#3fa7d6']], labels: ['erosion', 'none', 'deposition'] },
};

// Draws a normalised height array into a canvas using the altitude ramp.
export function drawHeights(canvas, heights, size, seaLevel, maxHeight) {
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const fields = buildFields('height', {
    heights,
    size,
    maxHeight,
    seaLevel,
  });
  for (let i = 0; i < size * size; i += 1) {
    image.data[i * 4] = fields[i * 3] * 255;
    image.data[i * 4 + 1] = fields[i * 3 + 1] * 255;
    image.data[i * 4 + 2] = fields[i * 3 + 2] * 255;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

export function drawRgba(canvas, rgba, size) {
  const ctx = canvas.getContext('2d');
  const image = new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), size, size);
  ctx.putImageData(image, 0, 0);
}
