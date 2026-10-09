// Thermal erosion (talus slumping). Where a slope is steeper than the angle of repose, material moves
// downhill to the neighbours that are lower than the threshold allows. Frost wedging, rockfall and creep
// all end up as this: steep faces relax to a talus cone, and scree collects at the foot of the slope.
// Model: Musgrave, Kolb & Mace 1989. Updates are in place with alternating sweep direction, which settles
// without the checkerboard oscillation a simultaneous update can produce.
// Border cells are open: material that reaches them leaves the map and is reported as `lost`.

const OFFS = [
  [-1, -1, Math.SQRT2], [0, -1, 1], [1, -1, Math.SQRT2],
  [-1, 0, 1], [1, 0, 1],
  [-1, 1, Math.SQRT2], [0, 1, 1], [1, 1, Math.SQRT2],
];

export async function erodeThermal(height, N, p, hooks = {}) {
  const h = height;
  const tanTalus = Math.tan((p.talus * Math.PI) / 180);
  const k = p.cellM / p.heightM; // normalised height per metre
  const deposition = new Float32Array(N * N);
  const ex = new Float64Array(8);
  const target = new Int32Array(8);
  const iters = Math.max(1, Math.round(p.iterations));
  let moved = 0;
  let lost = 0;

  // Sweeps are in place (Gauss-Seidel), and the scan direction alternates each pass. A simultaneous
  // (Jacobi) update of the whole grid can oscillate in a checkerboard at this rate; this form settles.
  for (let it = 0; it < iters; it++) {
    const forward = (it & 1) === 0;
    for (let yy = 0; yy < N - 2; yy++) {
      const y = forward ? yy + 1 : N - 2 - yy;
      for (let xx = 0; xx < N - 2; xx++) {
        const x = forward ? xx + 1 : N - 2 - xx;
        const c = y * N + x;
        const hc = h[c];
        let sumE = 0;
        let cnt = 0;
        for (let t = 0; t < 8; t++) {
          const o = OFFS[t];
          const j = (y + o[1]) * N + (x + o[0]);
          const e = hc - h[j] - tanTalus * k * o[2];
          if (e > 0) {
            ex[cnt] = e;
            target[cnt] = j;
            cnt++;
            sumE += e;
          }
        }
        if (sumE <= 0) continue;
        const m = p.rate * 0.5 * sumE;
        h[c] -= m;
        moved += m;
        for (let q = 0; q < cnt; q++) {
          const share = (m * ex[q]) / sumE;
          const j = target[q];
          const jx = j % N;
          const jy = (j - jx) / N;
          if (jx === 0 || jy === 0 || jx === N - 1 || jy === N - 1) {
            lost += share; // open border: material leaves the map
          } else {
            h[j] += share;
            deposition[j] += share;
          }
        }
      }
    }
    if (hooks.progress) hooks.progress((it + 1) / iters);
    if (hooks.tick) await hooks.tick();
    if (hooks.cancelled && hooks.cancelled()) return null;
  }
  return { deposition, moved, lost, iterations: iters };
}
