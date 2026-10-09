// Hydraulic erosion by water droplets. Each droplet is a particle that follows the local gradient with
// inertia, keeps a sediment load and a water volume, and speeds up on descent. It erodes while it can carry
// more than its capacity (capacity grows with speed, water and slope), deposits when the flow slows, and
// drops what it holds when it evaporates or leaves the map.
// Model: Mei, Decaudin & Hu 2007 (droplet form), Št'ava et al. 2008 (brush erosion), Beyer 2015.
// Heights are normalised, so the constants are dimensionless and scale with the terrain's height range.
import { mulberry32 } from '../core/rng.js';

const TWO_PI = Math.PI * 2;

export async function erodeHydraulic(height, N, p, hooks = {}) {
  const h = height;
  const n = N * N;
  const rnd = mulberry32((p.seed >>> 0) || 1);
  const droplets = Math.max(1, Math.round(p.density * n));
  const life = Math.max(1, Math.round(p.lifetime));
  const r = Math.max(1, Math.round(p.radius));
  const inertia = p.inertia;
  const capacityFactor = p.capacity;
  const minSlope = p.minSlope;
  const erodeSpeed = p.erodeSpeed;
  const depositSpeed = p.depositSpeed;
  const evaporation = p.evaporation;
  const gravity = p.gravity;

  // Brush: a cone of radius r, normalised so one unit of erosion removes one unit in total.
  const brushDx = [];
  const brushDy = [];
  const brushW = [];
  let wsum = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= r) continue;
      const w = r - d;
      brushDx.push(dx);
      brushDy.push(dy);
      brushW.push(w);
      wsum += w;
    }
  }
  for (let k = 0; k < brushW.length; k++) brushW[k] /= wsum;
  const brushCount = brushW.length;

  const deposition = new Float32Array(n);
  let eroded = 0;
  let deposited = 0;
  let lost = 0;
  const limit = N - 1;

  for (let d = 0; d < droplets; d++) {
    let x = 1 + rnd() * (N - 3);
    let y = 1 + rnd() * (N - 3);
    let dirX = 0;
    let dirY = 0;
    let speed = 1;
    let water = 1;
    let sediment = 0;

    for (let s = 0; s < life; s++) {
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const fx = x - ix;
      const fy = y - iy;
      const i0 = iy * N + ix;
      const h00 = h[i0];
      const h10 = h[i0 + 1];
      const h01 = h[i0 + N];
      const h11 = h[i0 + N + 1];
      const gradX = (h10 - h00) * (1 - fy) + (h11 - h01) * fy;
      const gradY = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
      const hOld = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;

      // Direction: keep part of the previous heading (inertia), bend the rest toward the downhill gradient.
      dirX = dirX * inertia - gradX * (1 - inertia);
      dirY = dirY * inertia - gradY * (1 - inertia);
      let len = Math.sqrt(dirX * dirX + dirY * dirY);
      if (len < 1e-9) {
        const a = rnd() * TWO_PI;
        dirX = Math.cos(a);
        dirY = Math.sin(a);
      } else {
        dirX /= len;
        dirY /= len;
      }

      const nx = x + dirX;
      const ny = y + dirY;
      if (nx < 0 || ny < 0 || nx >= limit || ny >= limit) {
        lost += sediment;
        sediment = 0;
        break;
      }

      const jx = Math.floor(nx);
      const jy = Math.floor(ny);
      const gx = nx - jx;
      const gy = ny - jy;
      const j0 = jy * N + jx;
      const hNew = h[j0] * (1 - gx) * (1 - gy) + h[j0 + 1] * gx * (1 - gy) + h[j0 + N] * (1 - gx) * gy + h[j0 + N + 1] * gx * gy;
      const dh = hNew - hOld; // negative when the droplet moves downhill

      // Sediment capacity grows with speed, water volume and downhill drop; never zero, so flats still erode a little.
      const capacity = Math.max(-dh * speed * water * capacityFactor, minSlope);

      if (sediment > capacity || dh > 0) {
        // Over capacity, or climbing a rise: drop material. Climbing drops at most the height gained.
        const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - capacity) * depositSpeed;
        if (amount > 0) {
          sediment -= amount;
          deposited += amount;
          depositBilinear(h, deposition, i0, N, fx, fy, amount);
        }
      } else {
        // Under capacity: scrape the surface around the droplet, but never more than the drop it would make.
        const want = Math.min((capacity - sediment) * erodeSpeed, -dh);
        if (want > 0) {
          const cx0 = ix;
          const cy0 = iy;
          for (let k = 0; k < brushCount; k++) {
            const bx = cx0 + brushDx[k];
            const by = cy0 + brushDy[k];
            if (bx < 0 || by < 0 || bx >= N || by >= N) continue;
            const ci = by * N + bx;
            let w = want * brushW[k];
            if (h[ci] < w) w = h[ci];
            if (w <= 0) continue;
            h[ci] -= w;
            sediment += w;
            eroded += w;
          }
        }
      }

      // Energy: falling downhill converts height into speed (v^2 grows by g times the drop).
      speed = Math.sqrt(Math.max(speed * speed - dh * gravity, 0));
      water *= 1 - evaporation;
      x = nx;
      y = ny;
      if (water < 0.01) break;
    }

    // What the droplet still carries is dropped where it ends (conserving mass unless it left the map).
    if (sediment > 0) {
      const ix = Math.min(N - 2, Math.max(0, Math.floor(x)));
      const iy = Math.min(N - 2, Math.max(0, Math.floor(y)));
      depositBilinear(h, deposition, iy * N + ix, N, x - ix, y - iy, sediment);
      deposited += sediment;
    }

    if ((d & 2047) === 2047) {
      if (hooks.progress) hooks.progress((d + 1) / droplets);
      if (hooks.tick) await hooks.tick();
      if (hooks.cancelled && hooks.cancelled()) return null;
    }
  }
  if (hooks.progress) hooks.progress(1);
  return { deposition, eroded, deposited, lost, droplets };
}

function depositBilinear(h, deposition, i0, N, fx, fy, amount) {
  const w00 = (1 - fx) * (1 - fy) * amount;
  const w10 = fx * (1 - fy) * amount;
  const w01 = (1 - fx) * fy * amount;
  const w11 = fx * fy * amount;
  h[i0] += w00;
  h[i0 + 1] += w10;
  h[i0 + N] += w01;
  h[i0 + N + 1] += w11;
  deposition[i0] += w00;
  deposition[i0 + 1] += w10;
  deposition[i0 + N] += w01;
  deposition[i0 + N + 1] += w11;
}
