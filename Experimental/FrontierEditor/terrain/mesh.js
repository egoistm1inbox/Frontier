// Render arrays for the viewport: plain typed arrays, so the same code runs in Node tests.
// World space: x and z span [-size/2, size/2], y is height in metres (y-up, like three.js).

import { NO_WATER } from './routing.js';

export function terrainGeometry(N, size, height) {
  const total = N * N, cell = size / (N - 1);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const c = j * N + i;
      pos[c * 3] = (i / (N - 1) - 0.5) * size;
      pos[c * 3 + 1] = height[c];
      pos[c * 3 + 2] = (j / (N - 1) - 0.5) * size;
      uv[c * 2] = i / (N - 1);
      uv[c * 2 + 1] = j / (N - 1);
      const il = Math.max(0, i - 1), ir = Math.min(N - 1, i + 1);
      const jd = Math.max(0, j - 1), ju = Math.min(N - 1, j + 1);
      const dhx = (height[j * N + ir] - height[j * N + il]) / ((ir - il) * cell || 1);
      const dhz = (height[ju * N + i] - height[jd * N + i]) / ((ju - jd) * cell || 1);
      const l = Math.hypot(dhx, 1, dhz);
      nor[c * 3] = -dhx / l;
      nor[c * 3 + 1] = 1 / l;
      nor[c * 3 + 2] = -dhz / l;
    }
  }
  const index = new Uint32Array((N - 1) * (N - 1) * 6);
  let k = 0;
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      const a = j * N + i, b = a + 1, d = a + N, e = d + 1;
      index[k++] = a; index[k++] = d; index[k++] = b;
      index[k++] = b; index[k++] = d; index[k++] = e;
    }
  }
  return { pos, nor, uv, index };
}

// Water surface, clipped to the terrain. The sim's wet mask is per cell, so its edge would be a staircase
// wherever the bank is lower than the water level. Instead the water is flood-filled: starting from the
// wet cells, neighbours join while the ground is below their body's level. A flood cell may not join a
// body with a different level (no bleeding between lakes), and the fill stops FLOOD_RINGS cells out.
// Each terrain triangle is then cut where (level − ground) crosses zero, so the shoreline is the true
// contour of the water plane. Where a water cell borders dry ground deeper than the fill allows, the
// edge is placed on the water cell itself with zero depth, so the water fades out instead of hanging
// over the ground. The depth attribute is the true depth at each vertex: zero at the shore.
const FLOOD_RINGS = 4;      // the fill may spread this many cells beyond the sim's wet cells
const FLOOD_DEPTH = 2.0;    // and only onto ground at most this far below the level
const LEVEL_TOL = 0.25;     // a fill cell may not join a body whose level differs by more than this

export function waterGeometry(N, size, height, water) {
  const T = N * N;
  const seedLevel = new Float32Array(T).fill(NaN);
  for (let c = 0; c < T; c++) {
    if (water[c] > NO_WATER / 2 && water[c] > height[c] + 0.02) seedLevel[c] = water[c];
  }
  const eachNeighbour = (c, fn) => {
    const i = c % N, j = (c - i) / N;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (di === 0 && dj === 0) continue;
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
        fn(jj * N + ii);
      }
    }
  };
  // flood fill: body[c] is the level of the water body that covers vertex c, or NaN when it is dry
  const body = new Float32Array(T).fill(NaN);
  const ring = new Int16Array(T).fill(-1);
  const queue = new Int32Array(T);
  let qh = 0, qt = 0;
  for (let c = 0; c < T; c++) {
    if (!Number.isNaN(seedLevel[c])) { body[c] = seedLevel[c]; ring[c] = 0; queue[qt++] = c; }
  }
  while (qh < qt) {
    const c = queue[qh++];
    if (ring[c] >= FLOOD_RINGS) continue;
    eachNeighbour(c, (u) => {
      if (ring[u] >= 0) return;
      const g = body[c] - height[u];
      if (!(g > 0 && g <= FLOOD_DEPTH)) return;
      let ok = true;
      eachNeighbour(u, (q) => { if (!Number.isNaN(seedLevel[q]) && Math.abs(seedLevel[q] - body[c]) > LEVEL_TOL) ok = false; });
      if (!ok) return;
      ring[u] = ring[c] + 1;
      body[u] = body[c];
      queue[qt++] = u;
    });
  }

  const pos = [], depth = [], index = [];
  const vert = (x, yy, z, dep) => { pos.push(x, yy, z); depth.push(dep); return depth.length - 1; };
  const corner = (i, j) => {
    const c = j * N + i;
    return { x: (i / (N - 1) - 0.5) * size, z: (j / (N - 1) - 0.5) * size, h: height[c], lvl: body[c] };
  };
  // Sutherland–Hodgman against "under water". A crossing is placed where the ground meets the level of
  // the body endpoint, so it sits exactly on the water plane; the triangle winding is kept.
  const clipAndEmit = (A, B, C) => {
    const tri = [A, B, C];
    const poly = [];
    for (let k = 0; k < 3; k++) {
      const p = tri[k], q = tri[(k + 1) % 3];
      const pIn = !Number.isNaN(p.lvl), qIn = !Number.isNaN(q.lvl);
      if (pIn) poly.push({ x: p.x, z: p.z, y: p.lvl, dep: p.lvl - p.h });
      if (pIn !== qIn) {
        const inner = pIn ? p : q, outer = pIn ? q : p;
        const L = inner.lvl;
        const gi = L - inner.h;                       // depth at the inner corner (positive)
        const go = L - outer.h;                       // depth at the outer corner
        // ground meets the level between the corners: place the crossing there (exact contour).
        // A dry corner deeper than the level cannot be crossed (the cell is too deep to flood): the
        // crossing sits on the inner corner with zero depth, so the water fades out instead of hanging.
        const u = go >= 0 ? 0 : gi / (gi - go);
        poly.push({ x: inner.x + (outer.x - inner.x) * u, z: inner.z + (outer.z - inner.z) * u, y: L, dep: 0 });
      }
    }
    for (let k = 1; k + 1 < poly.length; k++) {
      const v0 = poly[0], v1 = poly[k], v2 = poly[k + 1];
      index.push(vert(v0.x, v0.y, v0.z, v0.dep), vert(v1.x, v1.y, v1.z, v1.dep), vert(v2.x, v2.y, v2.z, v2.dep));
    }
  };
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      const a = j * N + i;
      // a cell with no water corner cannot be crossed by the surface
      if (Number.isNaN(body[a]) && Number.isNaN(body[a + 1]) && Number.isNaN(body[a + N]) && Number.isNaN(body[a + N + 1])) continue;
      const A = corner(i, j), B = corner(i + 1, j), D = corner(i, j + 1), E = corner(i + 1, j + 1);
      // same winding and split as the terrain: (A, D, B) and (B, D, E), normals face up
      clipAndEmit(A, D, B);
      clipAndEmit(B, D, E);
    }
  }
  return {
    pos: new Float32Array(pos),
    depth: new Float32Array(depth),
    index: new Uint32Array(index),
    count: depth.length,
  };
}
