// Depression filling and D8 routing shared by the river, lake and stream-power solvers.
// Extracted unchanged from the Frontier cliff-generator prototype (hydrology.js: Heap, fillDepressions,
// flowDirections). The river carving that used to live beside them is rewritten in rivers.js.



// Binary min-heap on (key, index) pairs stored in parallel typed arrays.
class Heap {
  constructor(capacity) { this.k = new Float64Array(capacity); this.v = new Int32Array(capacity); this.n = 0; }
  push(key, val) {
    let i = this.n++;
    const k = this.k, v = this.v;
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const topV = v[0];
    const lastK = k[--this.n], lastV = v[this.n];
    let i = 0;
    for (;;) {
      let c = i * 2 + 1; if (c >= this.n) break;
      if (c + 1 < this.n && k[c + 1] < k[c]) c++;
      if (k[c] >= lastK) break;
      k[i] = k[c]; v[i] = v[c]; i = c;
    }
    k[i] = lastK; v[i] = lastV;
    return topV;
  }
  get size() { return this.n; }
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
const DL = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

// Priority flood: returns the filled surface and the processing order (increasing filled height).
export function fillDepressions(height, N, seaLevel = -Infinity, eps = 1e-4) {
  const filled = new Float32Array(N * N);
  const closed = new Uint8Array(N * N);
  const order = new Int32Array(N * N);
  const heap = new Heap(N * N + 8);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const idx = j * N + i;
      const border = i === 0 || j === 0 || i === N - 1 || j === N - 1;
      if (border || height[idx] <= seaLevel) {
        filled[idx] = Math.max(height[idx], seaLevel);
        closed[idx] = 1; heap.push(filled[idx], idx);
      }
    }
  }
  let n = 0;
  while (heap.size) {
    const c = heap.pop();
    order[n++] = c;
    const ci = c % N, cj = (c - ci) / N;
    for (let d = 0; d < 8; d++) {
      const ni = ci + DX[d], nj = cj + DZ[d];
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const nidx = nj * N + ni;
      if (closed[nidx]) continue;
      closed[nidx] = 1;
      filled[nidx] = Math.max(height[nidx], filled[c] + eps * DL[d]);
      heap.push(filled[nidx], nidx);
    }
  }
  return { filled, order };
}

// D8 downstream neighbour on the filled surface (-1 at outlets).
export function flowDirections(filled, N) {
  const down = new Int32Array(N * N).fill(-1);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const idx = j * N + i;
      let best = -1, bestDrop = 0;
      for (let d = 0; d < 8; d++) {
        const ni = i + DX[d], nj = j + DZ[d];
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const nidx = nj * N + ni;
        const drop = (filled[idx] - filled[nidx]) / DL[d];
        if (drop > bestDrop) { bestDrop = drop; best = nidx; }
      }
      down[idx] = best;
    }
  }
  return down;
}

export const NO_WATER = -1e6;
