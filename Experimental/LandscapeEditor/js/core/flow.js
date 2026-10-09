// Hydrology on a height grid: depression filling (Priority-Flood, Barnes, Lehman & Mulla 2014) with a small
// epsilon gradient so filled flats still drain, D8 steepest-descent routing on the filled surface, and
// drainage area accumulated in topological order. Border cells are open outlets.

const OFFSETS = [
  [-1, -1, Math.SQRT2], [0, -1, 1], [1, -1, Math.SQRT2],
  [-1, 0, 1], [1, 0, 1],
  [-1, 1, Math.SQRT2], [0, 1, 1], [1, 1, Math.SQRT2],
];

// Returns:
//   filled  Float64Array  depression-free surface
//   order   Int32Array    cells in ascending filled height (a valid topological order: downstream first)
//   down    Int32Array    downstream neighbour index, -1 for border outlets
//   area    Float32Array  drainage area in cells, including the cell itself
export function routeFlow(h, N, epsilon = 1e-6) {
  const n = N * N;
  const filled = new Float64Array(n);
  const seen = new Uint8Array(n);
  const order = new Int32Array(n);
  const heapKey = new Float64Array(n + 1);
  const heapVal = new Int32Array(n + 1);
  let size = 0;

  const push = (key, val) => {
    let i = size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapKey[p] <= key) break;
      heapKey[i] = heapKey[p];
      heapVal[i] = heapVal[p];
      i = p;
    }
    heapKey[i] = key;
    heapVal[i] = val;
  };
  const pop = () => {
    const top = heapVal[0];
    size--;
    if (size > 0) {
      const key = heapKey[size];
      const val = heapVal[size];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= size) break;
        if (c + 1 < size && heapKey[c + 1] < heapKey[c]) c++;
        if (heapKey[c] >= key) break;
        heapKey[i] = heapKey[c];
        heapVal[i] = heapVal[c];
        i = c;
      }
      heapKey[i] = key;
      heapVal[i] = val;
    }
    return top;
  };
  const seed = (i) => {
    seen[i] = 1;
    filled[i] = h[i];
    push(filled[i], i);
  };
  for (let x = 0; x < N; x++) {
    seed(x);
    seed((N - 1) * N + x);
  }
  for (let y = 1; y < N - 1; y++) {
    seed(y * N);
    seed(y * N + N - 1);
  }

  let count = 0;
  while (size > 0) {
    const c = pop();
    order[count++] = c;
    const cx = c % N;
    const cy = (c - cx) / N;
    for (let k = 0; k < 8; k++) {
      const nx = cx + OFFSETS[k][0];
      const ny = cy + OFFSETS[k][1];
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const j = ny * N + nx;
      if (seen[j]) continue;
      seen[j] = 1;
      const floor = filled[c] + epsilon;
      const f = h[j] > floor ? h[j] : floor;
      filled[j] = f;
      push(f, j);
    }
  }

  const down = new Int32Array(n).fill(-1);
  for (let y = 1; y < N - 1; y++) {
    for (let x = 1; x < N - 1; x++) {
      const c = y * N + x;
      let best = -1;
      let bestSlope = 0;
      for (let k = 0; k < 8; k++) {
        const j = (y + OFFSETS[k][1]) * N + (x + OFFSETS[k][0]);
        const s = (filled[c] - filled[j]) / OFFSETS[k][2];
        if (s > bestSlope) {
          bestSlope = s;
          best = j;
        }
      }
      down[c] = best;
    }
  }

  // Walking from the highest filled cell down guarantees every donor is added before it is passed on.
  const area = new Float32Array(n).fill(1);
  for (let k = count - 1; k >= 0; k--) {
    const c = order[k];
    const d = down[c];
    if (d >= 0) area[d] += area[c];
  }
  return { filled, order, down, area };
}

// Index of the downstream neighbour's offset helper, exported for solvers that need the step length.
export function stepLength(c, d, N) {
  const dx = Math.abs((c % N) - (d % N));
  const dy = Math.abs(Math.floor(c / N) - Math.floor(d / N));
  return dx + dy === 2 ? Math.SQRT2 : 1;
}
