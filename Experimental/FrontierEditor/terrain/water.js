// Standing water: lakes in closed basins and the sea surface.
//
// Lakes: a basin is a set of cells that the priority flood would fill (a real depression, not a river
// bed). Its water surface is one flat level between the basin floor and its spill height, and only
// cells under that level are wet, connected to the deepest point. The ground is not moved, so the
// shoreline is the terrain's own contour.
// Sea: every cell at or below the sea level is wet, with a flat surface at that level.

import { fillDepressions } from './routing.js';
import { clamp01 } from './noise.js';

export function fillLakes(height, N, cell, opts, water, lakeMask) {
  const total = N * N;
  const sea = opts.sea == null ? -Infinity : opts.sea;
  const { filled } = fillDepressions(height, N, sea, 1e-4);
  const minDepth = opts.minDepth ?? 0.6;
  const minArea = opts.minArea ?? 150;
  const maxArea = (opts.maxAreaFrac ?? 0.15) * (N * cell) * (N * cell);
  const fill = clamp01(opts.fill ?? 0.7);
  const isBasin = (c) => filled[c] - height[c] > minDepth && height[c] > sea;
  const neighbours = (c, out) => {
    const i = c % N, j = (c - i) / N;
    let k = 0;
    if (i > 0) out[k++] = c - 1;
    if (i < N - 1) out[k++] = c + 1;
    if (j > 0) out[k++] = c - N;
    if (j < N - 1) out[k++] = c + N;
    return k;
  };

  const seen = new Uint8Array(total);      // basin membership (each cell belongs to one basin)
  const wetSeen = new Uint8Array(total);   // flood of the wet part of a basin
  const stack = new Int32Array(total);
  const nb = new Int32Array(4);
  let lakes = 0, lakeCells = 0;
  for (let s = 0; s < total; s++) {
    if (seen[s] || !isBasin(s)) continue;
    // 1. collect the basin: 4-connected depression cells
    let top = 0, count = 0, spill = -Infinity, minH = Infinity, deepest = s;
    stack[top++] = s;
    seen[s] = 1;
    const basin = [];
    while (top > 0) {
      const c = stack[--top];
      basin.push(c);
      count++;
      if (filled[c] > spill) spill = filled[c];
      if (height[c] < minH) { minH = height[c]; deepest = c; }
      const k = neighbours(c, nb);
      for (let q = 0; q < k; q++) {
        const n = nb[q];
        if (seen[n] || !isBasin(n)) continue;
        seen[n] = 1;
        stack[top++] = n;
      }
    }
    const area = count * cell * cell;
    if (area < minArea || area > maxArea) continue;
    const level = minH + fill * (spill - minH);
    if (level <= minH) continue;

    // 2. wet part: flood from the deepest point through ground below the level
    let ftop = 0, wet = 0;
    stack[ftop++] = deepest;
    wetSeen[deepest] = 1;
    while (ftop > 0) {
      const c = stack[--ftop];
      water[c] = Math.max(water[c], level);
      lakeMask[c] = 1;
      wet++;
      const k = neighbours(c, nb);
      for (let q = 0; q < k; q++) {
        const n = nb[q];
        if (wetSeen[n] || height[n] >= level) continue;
        wetSeen[n] = 1;
        stack[ftop++] = n;
      }
    }
    if (wet > 0) { lakes++; lakeCells += wet; }
  }
  return { lakes, lakeCells };
}

export function applySea(height, N, sea, water, seaMask) {
  let cells = 0;
  for (let c = 0; c < N * N; c++) {
    if (height[c] > sea) continue;
    water[c] = Math.max(water[c], sea);
    seaMask[c] = 1;
    cells++;
  }
  return { cells };
}
