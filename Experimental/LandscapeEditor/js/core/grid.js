// Square-grid helpers. A map is a Float32Array of N*N cells, row-major, row 0 at the north edge.
// Heights are normalised to [0, 1]; the terrain settings convert them to metres.

export function bilinear(arr, N, x, y) {
  const maxc = N - 1;
  const cx = x < 0 ? 0 : x > maxc ? maxc : x;
  const cy = y < 0 ? 0 : y > maxc ? maxc : y;
  const ix = Math.min(Math.floor(cx), N - 2);
  const iy = Math.min(Math.floor(cy), N - 2);
  const fx = cx - ix;
  const fy = cy - iy;
  const i = iy * N + ix;
  const top = arr[i] + (arr[i + 1] - arr[i]) * fx;
  const bot = arr[i + N] + (arr[i + N + 1] - arr[i + N]) * fx;
  return top + (bot - top) * fy;
}

export function minMax(arr) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return { min: lo, max: hi };
}

export function mean(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / Math.max(1, arr.length);
}

// Separable box blur with a running sum, clamped at the edges. Radius is in cells.
export function boxBlur(src, N, radius, out = new Float32Array(src.length)) {
  const r = Math.max(0, Math.floor(radius));
  if (r === 0) {
    out.set(src);
    return out;
  }
  const tmp = new Float32Array(src.length);
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < N; y++) {
    const row = y * N;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[row + Math.min(N - 1, Math.max(0, k))];
    for (let x = 0; x < N; x++) {
      tmp[row + x] = acc * inv;
      const add = Math.min(N - 1, x + r + 1);
      const sub = Math.max(0, x - r);
      acc += src[row + add] - src[row + sub];
    }
  }
  for (let x = 0; x < N; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(N - 1, Math.max(0, k)) * N + x];
    for (let y = 0; y < N; y++) {
      out[y * N + x] = acc * inv;
      const add = Math.min(N - 1, y + r + 1);
      const sub = Math.max(0, y - r);
      acc += tmp[add * N + x] - tmp[sub * N + x];
    }
  }
  return out;
}

// Area-average an N×N field down to M×M (M <= N).
export function downsample(arr, N, M) {
  const out = new Float32Array(M * M);
  for (let y = 0; y < M; y++) {
    const y0 = Math.floor((y * N) / M);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * N) / M));
    for (let x = 0; x < M; x++) {
      const x0 = Math.floor((x * N) / M);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * N) / M));
      let s = 0;
      let c = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          s += arr[yy * N + xx];
          c++;
        }
      }
      out[y * M + x] = s / c;
    }
  }
  return out;
}

// Histogram-free percentile on a copy of the data (used by the viewport to pick display ranges).
export function percentile(arr, p) {
  const step = Math.max(1, Math.floor(arr.length / 65536));
  const sample = [];
  for (let i = 0; i < arr.length; i += step) sample.push(arr[i]);
  sample.sort((a, b) => a - b);
  return sample[Math.min(sample.length - 1, Math.max(0, Math.floor(p * (sample.length - 1))))];
}
