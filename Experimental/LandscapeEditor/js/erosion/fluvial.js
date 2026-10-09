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
import { routeFlow } from '../core/flow.js';

// Drainage is re-routed every ROUTE_EVERY iterations. Routing is the expensive part (a full depression fill), and
// the drainage area changes slowly, so the last routing is reused in between. Its downstream pointers stay valid:
// a cell whose drop has become non-positive is skipped, and a cut never goes below its downstream height.
export const ROUTE_EVERY = 3;

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

  const every = Math.max(1, Math.round(p.routeEvery ?? ROUTE_EVERY));
  let order = null;
  let down = null;
  for (let it = 0; it < iters; it++) {
    if (it % every === 0) {
      const routed = routeFlow(h, N);
      area = routed.area;
      order = routed.order;
      down = routed.down;
    }
    for (let k = n - 1; k >= 0; k--) {
      const c = order[k];
      const d = down[c];
      if (d < 0) continue;
      const cx = c % N;
      const cy = (c - cx) / N;
      if (cx === 0 || cy === 0 || cx === N - 1 || cy === N - 1) continue;
      const drop = h[c] - h[d];
      if (drop <= 0) continue;
      // Orthogonal steps differ by 1 or N in index, diagonal steps by N-1 or N+1.
      const di = d > c ? d - c : c - d;
      const step = di === 1 || di === N ? 1 : Math.SQRT2;
      const slope = (drop * heightM) / (step * cellM);
      const a = area[c] / n;
      const ap = m === 0.5 ? Math.sqrt(a) : Math.pow(a, m);
      const sp = nExp === 1 ? slope : Math.pow(slope, nExp);
      let e = dt * K * ap * sp;
      if (e > drop) e = drop;
      h[c] -= e;
      incised += e;
    }

    // Hillslope diffusion on the interior, using the start-of-step field so the update is symmetric. Uplift is
    // applied to every cell, border included: lifting only the interior would leave a step at the map edge.
    // Uplift is capped at the top of the normalised range, so the height scale stays meaningful.
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const c = y * N + x;
        const interior = x > 0 && y > 0 && x < N - 1 && y < N - 1;
        const lap = interior ? h[c - 1] + h[c + 1] + h[c - N] + h[c + N] - 4 * h[c] : 0;
        const raised = h[c] + D * lap + U;
        next[c] = raised > 1 ? 1 : raised;
        uplifted += U;
      }
    }
    h.set(next);

    if (hooks.progress) hooks.progress((it + 1) / iters);
    if (hooks.tick) await hooks.tick();
    if (hooks.cancelled && hooks.cancelled()) return null;
  }
  // Area from the last routed state (before the final update) is the drainage used for display.
  return { flow: area, incised, uplifted, iterations: iters };
}
