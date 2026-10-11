// RoadForge — city blocks.
//
// Faces of the planar road graph become real ground: plazas, verges, parking
// courts. Each face edge is offset by THAT road's own outer profile width, so
// the block boundary lands exactly on the back of the footway — no guessing,
// no gaps, no buildings.

import { MAT } from './materials.js';
import { earcut, insetPolygon } from '../core/mesh.js';
import { hash32, clamp, RNG } from '../core/math.js';

/** Trace the faces of the planar graph (next = clockwise-most turn). */
export function planarFaces(net) {
  const around = new Map(); // nodeId -> [{edge, other, ang}] sorted CCW
  for (const n of net.nodes.values()) {
    const list = net.edgesAt(n.id).map((e) => {
      const o = net.node(e.a === n.id ? e.b : e.a);
      return { edge: e, other: o.id, ang: Math.atan2(o.z - n.z, o.x - n.x) };
    });
    list.sort((p, q) => p.ang - q.ang);
    around.set(n.id, list);
  }
  const key = (e, from) => `${e.id}:${e.a === from ? 0 : 1}`;
  const visited = new Set();
  const faces = [];
  for (const e0 of net.edges.values()) {
    for (const start of [e0.a, e0.b]) {
      if (visited.has(key(e0, start))) continue;
      const loop = [];
      let edge = e0;
      let from = start;
      let guard = 0;
      while (guard++ < 4000) {
        const k = key(edge, from);
        if (visited.has(k)) break;
        visited.add(k);
        const to = edge.a === from ? edge.b : edge.a;
        loop.push({ edge, from, to });
        const list = around.get(to);
        if (!list || !list.length) break;
        const F = net.node(from), T = net.node(to);
        const back = Math.atan2(F.z - T.z, F.x - T.x);
        let best = null, bestD = Infinity;
        for (const cand of list) {
          let d = back - cand.ang;
          while (d <= 1e-9) d += Math.PI * 2;
          while (d > Math.PI * 2 + 1e-9) d -= Math.PI * 2;
          if (d < bestD) { bestD = d; best = cand; }
        }
        if (!best) break;
        edge = best.edge;
        from = to;
      }
      if (loop.length >= 3) faces.push(loop);
    }
  }
  return faces;
}

function loopArea(net, loop) {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const P = net.node(loop[i].from);
    const Q = net.node(loop[i].to);
    a += P.x * Q.z - Q.x * P.z;
  }
  return a * 0.5;
}

/** Offset distance from the centreline to the back of the footway, per side. */
function sideOffset(profiles, edge, forward) {
  const p = profiles.get(edge.id);
  if (!p) return 6;
  const pts = p.pts;
  return forward ? Math.abs(pts[0].u) : Math.abs(pts[pts.length - 1].u);
}

/**
 * Build the block polygon for a face by offsetting each segment by its own
 * road width and intersecting consecutive offset lines.
 */
export function facePolygon(net, profiles, loop, extra = 0.0) {
  const n = loop.length;
  const lines = [];
  const ccw = loopArea(net, loop) > 0;
  for (let i = 0; i < n; i++) {
    const P = net.node(loop[i].from);
    const Q = net.node(loop[i].to);
    let dx = Q.x - P.x, dz = Q.z - P.z;
    const L = Math.hypot(dx, dz) || 1;
    dx /= L; dz /= L;
    // interior is to the left when the loop is CCW
    const nx = ccw ? -dz : dz;
    const nz = ccw ? dx : -dx;
    // Interior side relative to the edge's own forward direction:
    // the face walks a->b when loop[i].from === edge.a.
    const walkForward = loop[i].from === loop[i].edge.a;
    // left of the walking direction is the interior; profile left is -u.
    const interiorIsEdgeLeft = ccw ? walkForward : !walkForward;
    const d = sideOffset(profiles, loop[i].edge, interiorIsEdgeLeft) + extra;
    lines.push({ px: P.x + nx * d, pz: P.z + nz * d, dx, dz });
  }
  const poly = [];
  for (let i = 0; i < n; i++) {
    const A = lines[(i + n - 1) % n];
    const B = lines[i];
    const N = net.node(loop[i].from);
    const det = A.dx * -B.dz - A.dz * -B.dx;
    let p = null;
    if (Math.abs(det) > 1e-6) {
      const rx = B.px - A.px, rz = B.pz - A.pz;
      const t = (rx * -B.dz - rz * -B.dx) / det;
      p = [A.px + A.dx * t, A.pz + A.dz * t];
      // miter limit: a runaway spike means the two roads are nearly parallel
      const reach = Math.hypot(p[0] - N.x, p[1] - N.z);
      const limit = Math.max(Math.hypot(B.px - N.x, B.pz - N.z), 4) * 2.6;
      if (!Number.isFinite(reach) || reach > limit) p = null;
    }
    if (!p) {
      p = [(A.px + B.px) * 0.5, (A.pz + B.pz) * 0.5];
    }
    poly.push(p);
  }
  return poly;
}

function polyArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  }
  return a * 0.5;
}

function selfIntersects(poly) {
  const n = poly.length;
  if (n > 40) return false;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = poly[j], d = poly[(j + 1) % n];
      if (segHit(a, b, c, d)) return true;
    }
  }
  return false;
}
function segHit(a, b, c, d) {
  const s = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return s(a, b, c) !== s(a, b, d) && s(c, d, a) !== s(c, d, b);
}

/**
 * Emit block ground. Returns descriptors so props (benches, trees, parking)
 * can be scattered inside them later.
 */
export function buildBlocks(mb, net, profiles, opts = {}) {
  const seed = opts.seed || 1;
  const rnd = new RNG(seed ^ 0x9e37);
  const faces = planarFaces(net);
  const out = [];
  let outerArea = 0;
  const areas = faces.map((f) => loopArea(net, f));
  for (const a of areas) outerArea = Math.max(outerArea, Math.abs(a));

  faces.forEach((loop, fi) => {
    const a = areas[fi];
    if (a <= 60) return;                             // outer face / wrong side
    if (Math.abs(a) >= outerArea - 1e-6) return;
    if (loop.some((l) => l.edge.cls === 'rail')) return;
    let poly = facePolygon(net, profiles, loop, 0.02);
    if (poly.length < 3) return;
    if (polyArea(poly) <= 8) return;                 // offsets swallowed the face
    if (selfIntersects(poly)) {
      poly = insetPolygon(loop.map((l) => {
        const P = net.node(l.from); return [P.x, P.z];
      }), 8.5);
      if (selfIntersects(poly) || polyArea(poly) <= 8) return;
    }
    const area = Math.abs(polyArea(poly));
    const h = hash32(loop.map((l) => l.edge.id).join('|'));
    const r = (h % 1000) / 1000;
    let mat = MAT.GRASS;
    let wear = 0.25;
    if (area < 420) { mat = r < 0.45 ? MAT.PLAZA : MAT.GRASS; wear = 0.35; }
    else if (r < 0.2) mat = MAT.PLAZA;
    else if (r < 0.32) mat = MAT.DIRT;
    out.push({ poly, area, mat, wear, loop, id: `blk${fi}`, seed: h });
  });

  // Emit: base ground first (below), then blocks.
  for (const b of out) {
    mb.setCtx(b.mat, 0, 0, 0);
    const y = (opts.groundAt ? opts.groundAt(b.poly[0][0], b.poly[0][1]) : 0) - 0.03;
    const uvS = b.mat === MAT.GRASS ? 0.09 : 0.16;
    const idx = b.poly.map((p) => mb.vert([p[0], y, p[1]], [p[0] * uvS, p[1] * uvS],
      [0, 0, b.wear, 0]));
    const tri = earcut(b.poly);
    for (let i = 0; i < tri.length; i += 3) mb.tri(idx[tri[i]], idx[tri[i + 1]], idx[tri[i + 2]]);
  }
  return out;
}

/** Big ground plane under everything (subdivided so lighting varies). */
export function buildGround(mb, bounds, opts = {}) {
  const pad = opts.pad ?? 260;
  const x0 = bounds.min[0] - pad, x1 = bounds.max[0] + pad;
  const z0 = bounds.min[2] - pad, z1 = bounds.max[2] + pad;
  const cells = clamp(Math.round(Math.max(x1 - x0, z1 - z0) / 26), 8, 54);
  const groundAt = opts.groundAt || (() => 0);
  mb.setCtx(MAT.GRASS, 0, 0, 0);
  const grid = [];
  for (let j = 0; j <= cells; j++) {
    const row = [];
    for (let i = 0; i <= cells; i++) {
      const x = x0 + ((x1 - x0) * i) / cells;
      const z = z0 + ((z1 - z0) * j) / cells;
      row.push(mb.vert([x, groundAt(x, z) - 0.12, z], [x * 0.05, z * 0.05], [0, 0, 0.5, 0]));
    }
    grid.push(row);
  }
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      mb.quad(grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]);
    }
  }
}
