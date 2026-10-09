// Hydrology on a height grid: depression filling (Priority-Flood, Barnes, Lehman & Mulla 2014) with a small
// epsilon gradient so filled flats still drain, D8 steepest-descent routing on the filled surface, and
// drainage area accumulated in topological order. Border cells are open outlets.
//
// The flood uses a bucket queue (heights quantised to 2^16 levels) instead of a binary heap. Each cell is
// pushed once, so the queue costs O(n) rather than O(n log n), which matters because fluvial erosion routes
// the grid on every iteration. Within a bucket the order is arbitrary, which only changes which of two
// near-equal paths wins a flat. Accumulation does not depend on that order: it walks the receiver graph
// topologically (Kahn's algorithm), so every donor is added before the cell it drains through.

// Eight neighbours, flat typed arrays for the hot loops: x offset, y offset, step length, inverse step length.
const DX = new Int32Array([-1, 0, 1, -1, 1, -1, 0, 1]);
const DY = new Int32Array([-1, -1, -1, 0, 0, 1, 1, 1]);
const STEP = new Float64Array([Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2]);
const INV_STEP = new Float64Array(STEP.map((s) => 1 / s));

const BUCKETS = 1 << 16;

// Returns:
//   filled  Float64Array  depression-free surface
//   order   Int32Array    cells in ascending filled height (approximately; within a bucket the order is arbitrary)
//   down    Int32Array    downstream neighbour index, -1 for border outlets
//   area    Float32Array  drainage area in cells, including the cell itself
export function routeFlow(h, N, epsilon = 1e-6) {
  const n = N * N;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = h[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const scale = (BUCKETS - 1) / Math.max(hi - lo, 1e-9);

  const filled = new Float64Array(n);
  const seen = new Uint8Array(n);
  const order = new Int32Array(n);
  const head = new Int32Array(BUCKETS).fill(-1);
  const link = new Int32Array(n);
  let count = 0;

  // Heights at or above lo, so the bucket index is never negative. The top bucket absorbs the epsilon overshoot.
  const push = (c, v) => {
    let b = ((v - lo) * scale) | 0;
    if (b >= BUCKETS) b = BUCKETS - 1;
    link[c] = head[b];
    head[b] = c;
  };
  const seed = (c) => {
    seen[c] = 1;
    filled[c] = h[c];
    push(c, h[c]);
  };
  for (let x = 0; x < N; x++) {
    seed(x);
    seed((N - 1) * N + x);
  }
  for (let y = 1; y < N - 1; y++) {
    seed(y * N);
    seed(y * N + N - 1);
  }

  // A neighbour's filled height is never below its parent's, so it always lands in the current or a later bucket.
  for (let b = 0; b < BUCKETS; b++) {
    while (head[b] !== -1) {
      const c = head[b];
      head[b] = link[c];
      order[count++] = c;
      const cx = c % N;
      const cy = (c - cx) / N;
      const floor = filled[c] + epsilon;
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k];
        const ny = cy + DY[k];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const j = ny * N + nx;
        if (seen[j]) continue;
        seen[j] = 1;
        const hj = h[j];
        const f = hj > floor ? hj : floor;
        filled[j] = f;
        push(j, f);
      }
    }
  }

  const down = new Int32Array(n).fill(-1);
  const offs = new Int32Array([-N - 1, -N, -N + 1, -1, 1, N - 1, N, N + 1]);
  for (let y = 1; y < N - 1; y++) {
    for (let x = 1; x < N - 1; x++) {
      const c = y * N + x;
      const fc = filled[c];
      let best = -1;
      let bestSlope = 0;
      for (let k = 0; k < 8; k++) {
        const j = c + offs[k];
        const s = (fc - filled[j]) * INV_STEP[k];
        if (s > bestSlope) {
          bestSlope = s;
          best = j;
        }
      }
      down[c] = best;
    }
  }

  // Kahn's algorithm on the receiver graph. A cell is released once all of its donors have passed their area on.
  const indeg = new Int32Array(n);
  for (let c = 0; c < n; c++) {
    const d = down[c];
    if (d >= 0) indeg[d]++;
  }
  const area = new Float32Array(n).fill(1);
  const queue = new Int32Array(n);
  let qh = 0;
  let qt = 0;
  for (let c = 0; c < n; c++) if (indeg[c] === 0) queue[qt++] = c;
  while (qh < qt) {
    const c = queue[qh++];
    const d = down[c];
    if (d >= 0) {
      area[d] += area[c];
      if (--indeg[d] === 0) queue[qt++] = d;
    }
  }
  return { filled, order, down, area };
}

// Length of the step from cell c to its neighbour d: 1 for orthogonal, sqrt(2) for diagonal.
export function stepLength(c, d, N) {
  const dx = Math.abs((c % N) - (d % N));
  const dy = Math.abs(Math.floor(c / N) - Math.floor(d / N));
  return dx + dy === 2 ? Math.SQRT2 : 1;
}
