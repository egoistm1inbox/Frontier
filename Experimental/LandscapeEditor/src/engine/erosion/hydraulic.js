// Water erosion.
//
// erodeDroplets: particle-based hydraulic erosion. Each droplet runs downhill with inertia,
//   carries sediment up to a speed-dependent capacity, erodes with a brush and deposits when it
//   slows down or climbs (after Mei, Decaudin and Hu 2007, and Lague 2020).
// erodeStreamPower: stream-power incision, E = K * A^m * S^n, routed over the Priority-Flood
//   network, with hillslope diffusion. Channels form where upstream area is large and slopes are
//   steep, and the valley heads retreat, which is what produces dendritic drainage.

import { routeFlow, accumulate } from '../flow.js';

const CHECKPOINT_DROPLETS = 2048;

// The droplet solver works in "cell units": one unit of height equals one cell spacing. That keeps
// the slope and capacity dynamics independent of the grid resolution and the height scale, so the
// published defaults behave the same at any size.
export async function erodeDroplets(height, size, params, ctx) {
  const unitsPerNormal = ctx.maxHeight / ctx.cellMetres;
  const work = new Float32Array(height.length);
  for (let i = 0; i < work.length; i += 1) work[i] = height[i] * unitsPerNormal;
  const drops = Math.max(0, Math.round(params.droplets));
  const lifetime = Math.max(1, Math.round(params.lifetime));
  const inertia = params.inertia;
  const capacityFactor = params.capacity;
  const minCapacity = params.minCapacity;
  const erodeSpeed = params.erodeSpeed;
  const depositSpeed = params.depositSpeed;
  const evaporation = params.evaporation;
  const gravity = params.gravity;
  const radius = Math.max(1, Math.round(params.radius));
  const last = size - 1;
  const random = ctx.random;

  // Brush offsets and weights (linear falloff inside the radius).
  const brushX = [];
  const brushY = [];
  const brushW = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < radius) {
        brushX.push(dx);
        brushY.push(dy);
        brushW.push(radius - d);
      }
    }
  }
  const brushCount = brushW.length;

  let removed = 0;
  let deposited = 0;
  for (let drop = 0; drop < drops; drop += 1) {
    if (drop % CHECKPOINT_DROPLETS === 0) await ctx.checkpoint(drop / drops);
    let px = random() * last;
    let py = random() * last;
    let dirX = 0;
    let dirY = 0;
    let speed = 1;
    let water = 1;
    let sediment = 0;

    for (let step = 0; step < lifetime; step += 1) {
      const ix = Math.floor(px);
      const iy = Math.floor(py);
      if (ix < 0 || iy < 0 || ix >= last || iy >= last) break;
      const fx = px - ix;
      const fy = py - iy;
      const i00 = iy * size + ix;
      const i10 = i00 + 1;
      const i01 = i00 + size;
      const i11 = i01 + 1;
      const h00 = work[i00];
      const h10 = work[i10];
      const h01 = work[i01];
      const h11 = work[i11];
      const gradX = (h10 - h00) * (1 - fy) + (h11 - h01) * fy;
      const gradY = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
      const heightOld = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;

      dirX = dirX * inertia - gradX * (1 - inertia);
      dirY = dirY * inertia - gradY * (1 - inertia);
      const length = Math.sqrt(dirX * dirX + dirY * dirY);
      if (length > 1e-12) {
        dirX /= length;
        dirY /= length;
      } else {
        const angle = random() * Math.PI * 2;
        dirX = Math.cos(angle);
        dirY = Math.sin(angle);
      }
      px += dirX;
      py += dirY;
      if (px < 0 || py < 0 || px >= last || py >= last) break;

      const nx = Math.floor(px);
      const ny = Math.floor(py);
      const mx = px - nx;
      const my = py - ny;
      const n00 = ny * size + nx;
      const heightNew =
        work[n00] * (1 - mx) * (1 - my) +
        work[n00 + 1] * mx * (1 - my) +
        work[n00 + size] * (1 - mx) * my +
        work[n00 + size + 1] * mx * my;
      const deltaH = heightNew - heightOld;
      const capacity = Math.max(-deltaH * speed * water * capacityFactor, minCapacity);

      if (sediment > capacity || deltaH > 0) {
        // Deposit: uphill steps fill pits, and oversupplied droplets drop their load.
        const amount = deltaH > 0 ? Math.min(deltaH, sediment) : (sediment - capacity) * depositSpeed;
        sediment -= amount;
        deposited += amount;
        work[i00] += amount * (1 - fx) * (1 - fy);
        work[i10] += amount * fx * (1 - fy);
        work[i01] += amount * (1 - fx) * fy;
        work[i11] += amount * fx * fy;
      } else {
        // Erode a brush around the droplet's previous cell, limited by the drop it just made.
        const amount = Math.min((capacity - sediment) * erodeSpeed, -deltaH);
        let weightSum = 0;
        for (let k = 0; k < brushCount; k += 1) {
          const x = ix + brushX[k];
          const y = iy + brushY[k];
          if (x >= 0 && y >= 0 && x < size && y < size) weightSum += brushW[k];
        }
        if (weightSum > 0) {
          const scale = amount / weightSum;
          for (let k = 0; k < brushCount; k += 1) {
            const x = ix + brushX[k];
            const y = iy + brushY[k];
            if (x < 0 || y < 0 || x >= size || y >= size) continue;
            const index = y * size + x;
            const wanted = brushW[k] * scale;
            const taken = Math.min(wanted, work[index]);
            work[index] -= taken;
            sediment += taken;
            removed += taken;
          }
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed + deltaH * gravity));
      water *= 1 - evaporation;
    }
  }
  // Back to normalised heights. One unit of removed or deposited height is one cell spacing of
  // rock, so the volume in cubic metres is units * cellSpacing * cellArea.
  for (let i = 0; i < work.length; i += 1) height[i] = work[i] / unitsPerNormal;
  const unitVolume = ctx.cellMetres * ctx.cellMetres * ctx.cellMetres;
  return { removedVolume: removed * unitVolume, depositedVolume: deposited * unitVolume };
}

function diffuseInPlace(height, size, coefficient) {
  const copy = Float32Array.from(height);
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const i = y * size + x;
      const average = (copy[i - 1] + copy[i + 1] + copy[i - size] + copy[i + size]) * 0.25;
      height[i] = copy[i] + coefficient * (average - copy[i]);
    }
  }
}

export async function erodeStreamPower(height, size, params, ctx) {
  const total = size * size;
  const cell = ctx.cellMetres;
  const maxHeight = ctx.maxHeight;
  const cellArea = cell * cell;
  const diagonalMetres = cell * Math.SQRT2;
  const iterations = Math.max(0, Math.round(params.iterations));
  const erodibility = params.erodibility;
  const areaExponent = params.areaExponent;
  const slopeExponent = params.slopeExponent;
  const timeStep = params.timeStep;
  const diffusion = params.diffusion * 0.5;
  let removed = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    await ctx.checkpoint(iteration / iterations, height);
    // Route on the depression-filled surface. Inside a filled basin the surface is flat apart from
    // the tiny epsilon steps that route water to the outlet. Measuring slope on the filled surface
    // means basins do not incise along those flood rings; only the outlet is cut, which drains it.
    const { filled, order, receiver } = routeFlow(height, size);
    const area = accumulate(order, receiver, total);

    // Lowest cells first, so each receiver is already lowered when its donors are processed.
    for (let k = 0; k < total; k += 1) {
      const cellIndex = order[k];
      const next = receiver[cellIndex];
      if (next < 0) continue;
      const drop = (filled[cellIndex] - filled[next]) * maxHeight;
      if (drop <= 0) continue;
      const offset = Math.abs(cellIndex - next);
      const diagonal = offset !== 1 && offset !== size;
      const slope = drop / (diagonal ? diagonalMetres : cell);
      const areaKm2 = (area[cellIndex] * cellArea) / 1e6;
      let incision = erodibility * Math.pow(areaKm2, areaExponent) * Math.pow(slope, slopeExponent) * timeStep;
      // Stability: never cut more than half of the drop in one step.
      if (incision > 0.5 * drop) incision = 0.5 * drop;
      height[cellIndex] -= incision / maxHeight;
      removed += incision * cellArea;
    }
    if (diffusion > 0) diffuseInPlace(height, size, diffusion);
  }
  return { removedVolume: removed, depositedVolume: 0 };
}
