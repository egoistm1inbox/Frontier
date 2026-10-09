// Grid helpers shared by the terrain engine and the viewport.
// Heights are stored normalised to [0, 1] in a square Float32Array, index = y * size + x.
// Metres are obtained by multiplying by the maximum height; cell spacing is in metres.

export const clamp = (value, low, high) => (value < low ? low : value > high ? high : value);

export function smoothstep(low, high, value) {
  if (high - low < 1e-9) return value < low ? 0 : 1;
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
}

export function mix(a, b, t) {
  return a + (b - a) * t;
}

// Bilinear sample at a fractional cell position (x, y in cell units), clamped to the grid.
export function bilinear(values, size, x, y) {
  const last = size - 1;
  const cx = clamp(x, 0, last);
  const cy = clamp(y, 0, last);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, last);
  const y1 = Math.min(y0 + 1, last);
  const fx = cx - x0;
  const fy = cy - y0;
  const a = values[y0 * size + x0];
  const b = values[y0 * size + x1];
  const c = values[y1 * size + x0];
  const d = values[y1 * size + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

// Surface gradient in metres per metre (central differences, one-sided at the edges).
export function gradientAt(height, size, index, cellMetres, maxHeight) {
  const x = index % size;
  const y = (index - x) / size;
  const xl = x > 0 ? x - 1 : x;
  const xr = x < size - 1 ? x + 1 : x;
  const yu = y > 0 ? y - 1 : y;
  const yd = y < size - 1 ? y + 1 : y;
  const dzdx = ((height[y * size + xr] - height[y * size + xl]) * maxHeight) / ((xr - xl) * cellMetres);
  const dzdy = ((height[yd * size + x] - height[yu * size + x]) * maxHeight) / ((yd - yu) * cellMetres);
  return [dzdx, dzdy];
}

export function slopeDegrees(height, size, cellMetres, maxHeight) {
  const out = new Float32Array(size * size);
  for (let i = 0; i < size * size; i += 1) {
    const [dzdx, dzdy] = gradientAt(height, size, i, cellMetres, maxHeight);
    out[i] = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
  }
  return out;
}

// Separable box blur with clamped edges. Returns a new array.
export function boxBlur(values, size, radius, passes) {
  let src = Float32Array.from(values);
  const tmp = new Float32Array(size * size);
  const r = Math.max(1, Math.round(radius));
  const inv = 1 / (2 * r + 1);
  const clampIndex = (i) => (i < 0 ? 0 : i >= size ? size - 1 : i);
  for (let pass = 0; pass < passes; pass += 1) {
    const dst = new Float32Array(size * size);
    for (let y = 0; y < size; y += 1) {
      const row = y * size;
      let sum = 0;
      for (let k = -r; k <= r; k += 1) sum += src[row + clampIndex(k)];
      for (let x = 0; x < size; x += 1) {
        tmp[row + x] = sum * inv;
        sum += src[row + clampIndex(x + r + 1)] - src[row + clampIndex(x - r)];
      }
    }
    for (let x = 0; x < size; x += 1) {
      let sum = 0;
      for (let k = -r; k <= r; k += 1) sum += tmp[clampIndex(k) * size + x];
      for (let y = 0; y < size; y += 1) {
        dst[y * size + x] = sum * inv;
        sum += tmp[clampIndex(y + r + 1) * size + x] - tmp[clampIndex(y - r) * size + x];
      }
    }
    src = dst;
  }
  return src;
}

// Lambert shading of the surface for a sun at the given azimuth (degrees, 0 = +x) and elevation.
export function hillshade(height, size, cellMetres, maxHeight, azimuthDeg, elevationDeg) {
  const out = new Float32Array(size * size);
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const lx = Math.cos(el) * Math.cos(az);
  const ly = Math.cos(el) * Math.sin(az);
  const lz = Math.sin(el);
  for (let i = 0; i < size * size; i += 1) {
    const [dzdx, dzdy] = gradientAt(height, size, i, cellMetres, maxHeight);
    const length = Math.hypot(dzdx, dzdy, 1);
    const shade = (-dzdx * lx - dzdy * ly + lz) / length;
    out[i] = clamp(shade, 0, 1);
  }
  return out;
}

export function minMax(values) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

// Area-average downsample to a square thumbnail (used for layer previews).
export function downsample(values, size, target) {
  const out = new Float32Array(target * target);
  const step = size / target;
  for (let ty = 0; ty < target; ty += 1) {
    for (let tx = 0; tx < target; tx += 1) {
      const x0 = Math.floor(tx * step);
      const y0 = Math.floor(ty * step);
      const x1 = Math.max(x0 + 1, Math.floor((tx + 1) * step));
      const y1 = Math.max(y0 + 1, Math.floor((ty + 1) * step));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1 && y < size; y += 1) {
        for (let x = x0; x < x1 && x < size; x += 1) {
          sum += values[y * size + x];
          count += 1;
        }
      }
      out[ty * target + tx] = count ? sum / count : 0;
    }
  }
  return out;
}
