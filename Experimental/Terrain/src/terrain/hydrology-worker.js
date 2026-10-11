// Rivers & Lakes — exact hydrology on the CPU (runs in a worker).
// 1. Priority-Flood + ε depression filling (Barnes, Lehman & Mulla 2014) with a FIFO pit queue.
// 2. D8 receivers on the filled surface, drainage area accumulated in reverse flood order.
// 3. River channels carved with width/depth from hydraulic geometry (w ∝ A^0.5, d ∝ A^0.35).
// 4. Lakes: depressions deeper than a threshold become flat water bodies at their spill level.

self.onmessage = (e) => {
  const { id, job } = e.data;
  try {
    const result = hydrology(job);
    self.postMessage({ id, result }, [result.heights.buffer, result.water.buffer, result.flow.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack || err) });
  }
};

class MinHeap {
  constructor(cap) { this.k = new Float32Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  push(key, val) {
    let i = this.n++;
    const k = this.k, v = this.v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0];
    const n = --this.n;
    if (n > 0) {
      const key = k[n], val = v[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= key) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = key; v[i] = val;
    }
    return top;
  }
}

function hydrology({ heights, N, world, hscale, cell, sea, params: p }) {
  const NN = N * N;
  const h = new Float32Array(NN);
  for (let i = 0; i < NN; i++) h[i] = heights[i] * hscale;
  const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
  const DY = [-1, -1, -1, 0, 0, 1, 1, 1];
  const DD = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];
  const seaOn = sea > -1e8;

  // ── 1. Priority-Flood + ε
  const filled = new Float32Array(h);
  const closed = new Uint8Array(NN);
  const order = new Int32Array(NN);
  const parent = new Int32Array(NN).fill(-1);
  const heap = new MinHeap(NN);
  const pit = new Int32Array(NN);
  let pitHead = 0, pitTail = 0, oc = 0;
  const EPS = 1e-3;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (x === 0 || y === 0 || x === N - 1 || y === N - 1 || (seaOn && h[i] <= sea)) {
        closed[i] = 1; heap.push(filled[i], i);
      }
    }
  }
  while (heap.n > 0 || pitHead < pitTail) {
    const c = pitHead < pitTail ? pit[pitHead++] : heap.pop();
    order[oc++] = c;
    const cx = c % N, cy = (c / N) | 0;
    const fc = filled[c];
    for (let k = 0; k < 8; k++) {
      const nx = cx + DX[k], ny = cy + DY[k];
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const n = ny * N + nx;
      if (closed[n]) continue;
      closed[n] = 1;
      parent[n] = c;
      if (filled[n] <= fc + EPS) { filled[n] = fc + EPS; pit[pitTail++] = n; }
      else heap.push(filled[n], n);
    }
  }
  const rank = new Int32Array(NN);
  for (let k = 0; k < oc; k++) rank[order[k]] = k;

  // ── 2. D8 receivers on the filled surface + accumulation in reverse flood order
  const rcv = new Int32Array(NN).fill(-1);
  for (let y = 1; y < N - 1; y++) {
    for (let x = 1; x < N - 1; x++) {
      const i = y * N + x;
      if (seaOn && h[i] <= sea) continue;
      let best = 0, bi = -1;
      const fi = filled[i];
      for (let k = 0; k < 8; k++) {
        const j = (y + DY[k]) * N + x + DX[k];
        const s = (fi - filled[j]) / DD[k];
        if (s > best) { best = s; bi = j; }
      }
      if (bi < 0 || rank[bi] > rank[i]) bi = parent[i];
      rcv[i] = bi;
    }
  }
  const area = new Float64Array(NN);
  const cellA = cell * cell;
  for (let i = 0; i < NN; i++) area[i] = cellA;
  for (let k = oc - 1; k >= 0; k--) {
    const i = order[k];
    const r = rcv[i];
    if (r >= 0) area[r] += area[i];
  }

  // ── 3. Lakes (connected depressions above thresholds)
  const out = new Float32Array(h);
  const wl = new Float32Array(NN).fill(-1e9);
  const lakeMin = p.lakeDepth;
  if (p.lakesOn) {
    const label = new Int32Array(NN).fill(-1);
    const stack = new Int32Array(NN);
    const minCells = Math.max(1, (p.lakeArea * 1e6) / cellA);
    const members = [];
    for (let s = 0; s < NN; s++) {
      if (label[s] !== -1 || filled[s] - h[s] < 0.05) continue;
      let sp = 0, maxDepth = 0;
      stack[sp++] = s; label[s] = s;
      members.length = 0;
      while (sp > 0) {
        const c = stack[--sp];
        members.push(c);
        maxDepth = Math.max(maxDepth, filled[c] - h[c]);
        const cx = c % N, cy = (c / N) | 0;
        for (let k = 0; k < 8; k++) {
          const nx = cx + DX[k], ny = cy + DY[k];
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const n = ny * N + nx;
          if (label[n] !== -1 || filled[n] - h[n] < 0.05) continue;
          label[n] = s; stack[sp++] = n;
        }
      }
      if (members.length >= minCells && maxDepth >= lakeMin) {
        // flat surface at the spill level (max filled value without the ε ramp)
        let lvl = -1e9;
        for (const c of members) lvl = Math.max(lvl, filled[c]);
        lvl -= EPS * 2;
        for (const c of members) wl[c] = lvl;
      }
    }
  }

  // ── 4. Rivers: carve channels along D8 paths with hydraulic geometry
  const thr = p.threshold * 1e6;
  const bed = new Float32Array(NN).fill(NaN);
  const depthOf = (A) => p.depth * Math.pow(A / 1e6, 0.35);
  const widthOf = (A) => Math.max(cell * 0.9, Math.min(600, p.width * Math.sqrt(A / 1e6)));
  // bed levels downstream-first so the profile never rises downstream
  for (let k = 0; k < oc; k++) {
    const i = order[k];
    if (area[i] < thr) continue;
    let b = filled[i] - depthOf(area[i]);
    const r = rcv[i];
    if (r >= 0 && !Number.isNaN(bed[r])) b = Math.max(b, bed[r] + 0.02);
    bed[i] = b;
  }
  const banks = p.banks;
  for (let k = oc - 1; k >= 0; k--) {
    const i = order[k];
    if (Number.isNaN(bed[i])) continue;
    if (wl[i] > -1e8) continue; // inside a lake the lake surface wins
    if (seaOn && h[i] <= sea) continue;
    const A = area[i];
    const d = depthOf(A), w = widthOf(A);
    const hw = w * 0.5;
    const bw = hw * (0.4 + 2.6 * banks) + cell * 1.5;
    const R = hw + bw;
    const Rc = Math.ceil(R / cell);
    const cx = i % N, cy = (i / N) | 0;
    const b = bed[i];
    const surf = b + d * 0.82;
    for (let dy = -Rc; dy <= Rc; dy++) {
      const y = cy + dy; if (y < 0 || y >= N) continue;
      for (let dx = -Rc; dx <= Rc; dx++) {
        const x = cx + dx; if (x < 0 || x >= N) continue;
        const dm = Math.hypot(dx, dy) * cell;
        if (dm > R) continue;
        const j = y * N + x;
        let t;
        if (dm <= hw) {
          const q = dm / hw;
          t = b + d * 0.3 * q * q;
        } else {
          let s = (dm - hw) / bw; s = s * s * (3 - 2 * s);
          const edge = b + d * 0.3;
          t = edge + (h[j] - edge) * s;
        }
        if (t < out[j]) out[j] = t;
        if (t < surf && surf > wl[j]) wl[j] = surf;
      }
    }
  }

  // ── outputs
  const water = new Float32Array(NN);
  const flow = new Float32Array(NN);
  const a0 = 1500, aref = world * world * 0.04, lnRef = Math.log(1 + aref / a0);
  for (let i = 0; i < NN; i++) {
    const depth = wl[i] - out[i];
    water[i] = depth > 0.02 ? depth : 0;
    flow[i] = Math.min(1, Math.log(1 + area[i] / a0) / lnRef);
    heights[i] = out[i] / hscale;
  }
  return { heights, water, flow };
}
