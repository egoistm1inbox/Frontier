// Fluvial erosion by the stream-power law, with hillslope diffusion and uplift.
//   dz/dt = U - K * A^m * S^n   (incision)   + D * laplacian(z)   (hillslope creep)
// A is drainage area (fraction of the map that drains through a cell), S is the downhill slope in
// metres per metre, and the depressions are filled first so every cell drains to the border.
// Rivers therefore grow where many cells drain (large A) and cut steeply (large S). Ridges between them
// are softened by diffusion and kept alive by uplift. This is the standard landform-evolution model
// (Howard & Kerby 1983, Whipple & Tucker 1999, Cordonnier et al. 2016 for the terrain-authoring form).
//
// Updates are explicit and ordered from the highest cell to the lowest, so a cell always sees the
// downstream height from the start of the step and can never cut below it.
import { routeFlow, stepLength } from '../core/flow.js';

export async function erodeFluvial(height, N, p, hooks = {}) {
  const h = height;
  const n = N * N;
  const iters = Math.max(1, Math.round(p.iterations));
  const dt = p.timeStep;
  const K = p.erodibility;
  const m = p.areaExponent;
  const nExp = p.slopeExponent;
  const U = p.uplift * dt;
  const D = Math.min(0.2, p.diffusion) * dt;
  const cellM = p.cellM;
  const heightM = p.heightM;
  const next = new Float32Array(n);
  let area = null;
  let incised = 0;
  let uplifted = 0;

  for (let it = 0; it < iters; it++) {
    const routed = routeFlow(h, N);
    area = routed.area;
    const { order, down } = routed;
    for (let k = n - 1; k >= 0; k--) {
      const c = order[k];
      const d = down[c];
      if (d < 0) continue;
      const cx = c % N;
      const cy = (c - cx) / N;
      if (cx === 0 || cy === 0 || cx === N - 1 || cy === N - 1) continue;
      const drop = h[c] - h[d];
      if (drop <= 0) continue;
      const step = stepLength(c, d, N);
      const slope = (drop * heightM) / (step * cellM);
      const a = area[c] / n;
      let e = dt * K * Math.pow(a, m) * Math.pow(slope, nExp);
      if (e > drop) e = drop;
      h[c] -= e;
      incised += e;
    }

    // Hillslope diffusion on the interior, using the start-of-step field so the update is symmetric.
    next.set(h);
    for (let y = 1; y < N - 1; y++) {
      for (let x = 1; x < N - 1; x++) {
        const c = y * N + x;
        const lap = h[c - 1] + h[c + 1] + h[c - N] + h[c + N] - 4 * h[c];
        // Uplift is capped at the top of the normalised range, so the height scale stays meaningful.
        const raised = h[c] + D * lap + U;
        next[c] = raised > 1 ? 1 : raised;
        uplifted += U;
      }
    }
    for (let y = 1; y < N - 1; y++) {
      for (let x = 1; x < N - 1; x++) {
        const c = y * N + x;
        h[c] = next[c];
      }
    }

    if (hooks.progress) hooks.progress((it + 1) / iters);
    if (hooks.tick) await hooks.tick();
    if (hooks.cancelled && hooks.cancelled()) return null;
  }
  // Area from the last routed state (before the final update) is the drainage used for display.
  return { flow: area, incised, uplifted, iterations: iters };
}
