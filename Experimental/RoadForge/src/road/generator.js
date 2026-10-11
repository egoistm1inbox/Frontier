// RoadForge — procedural network generation.
//
// Everything is planarised on insertion: new centrelines split what they cross
// and snap to what they nearly touch, so the graph only ever contains real
// intersections. Crossings with a vertical separation above `gradeSep` are
// left alone — that is how bridges, underpasses and railway crossings appear.

import { RNG, clamp, smoothstep, segSegIntersect, pointSegDist2, TAU, wrapAngle } from '../core/math.js';
import { Noise } from '../core/noise.js';
import { RoadNetwork, makeNode, makeEdge, ROAD_CLASSES, uid } from './network.js';

const GRADE_SEP = 3.0;
const SNAP = 9.0;
const MIN_ANGLE = 0.42; // ~24° — anything tighter makes unusable topology

export const PRESETS = [
  { id: 'district', name: 'Mixed district', hint: 'Motorway, arterials, streets, rail' },
  { id: 'manhattan', name: 'Orthogonal grid', hint: 'Classic block grid with avenues' },
  { id: 'organic', name: 'Organic growth', hint: 'Curved, population-driven' },
  { id: 'interchange', name: 'Interchange study', hint: 'Diamond interchange + ramps' },
  { id: 'suburb', name: 'Suburban loop', hint: 'Loops, cul-de-sacs, bends' },
];

/* --------------------------------------------------------------- helpers */

export function nodeNear(net, x, z, r = SNAP) {
  let best = null, bd = r * r;
  for (const n of net.nodes.values()) {
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

export function getOrCreateNode(net, x, z, y = 0, opts = {}) {
  const hit = nodeNear(net, x, z, opts.snap ?? SNAP);
  if (hit) return hit;
  return net.addNode(makeNode(x, z, y, opts));
}

export function splitEdge(net, e, x, z, y) {
  const n = net.addNode(makeNode(x, z, y ?? 0));
  const opts = { ...e };
  delete opts.id; delete opts.a; delete opts.b;
  net.removeEdge(e.id);
  const e1 = net.addEdge(makeEdge(e.a, n.id, e.cls, { ...opts, ha: null, hb: null }));
  const e2 = net.addEdge(makeEdge(n.id, e.b, e.cls, { ...opts, ha: null, hb: null }));
  return { node: n, e1, e2 };
}

/** Insert a straight centreline with full planarisation. */
export function connect(net, aId, bId, cls, opts = {}) {
  const A = net.node(aId), B = net.node(bId);
  if (!A || !B || aId === bId) return [];
  const made = [];
  const queue = [[aId, bId]];
  let guard = 0;
  while (queue.length && guard++ < 200) {
    const [p, q] = queue.shift();
    const P = net.node(p), Q = net.node(q);
    if (!P || !Q || p === q) continue;
    if (Math.hypot(Q.x - P.x, Q.z - P.z) < 4) continue;

    // crossing test against every existing edge
    let hit = null;
    for (const e of net.edges.values()) {
      if (e.a === p || e.b === p || e.a === q || e.b === q) continue;
      const E1 = net.node(e.a), E2 = net.node(e.b);
      const X = segSegIntersect([P.x, P.z], [Q.x, Q.z], [E1.x, E1.z], [E2.x, E2.z]);
      if (!X) continue;
      const yNew = P.y + (Q.y - P.y) * X.t;
      const yOld = E1.y + (E2.y - E1.y) * X.u;
      if (Math.abs(yNew - yOld) > GRADE_SEP) continue;     // grade separated
      hit = { e, X, yNew };
      break;
    }
    if (hit) {
      const { e, X } = hit;
      const near = nodeNear(net, X.p[0], X.p[1], 7);
      let nodeId;
      if (near && (near.id === e.a || near.id === e.b)) nodeId = near.id;
      else nodeId = splitEdge(net, e, X.p[0], X.p[1], hit.yNew).node.id;
      queue.push([p, nodeId], [nodeId, q]);
      continue;
    }
    // reject near-duplicate / too-sharp connections
    if (!angleOK(net, p, q) || !angleOK(net, q, p)) continue;
    const ed = net.addEdge(makeEdge(p, q, cls, opts));
    if (ed) made.push(ed);
  }
  return made;
}

function angleOK(net, from, to) {
  const A = net.node(from), B = net.node(to);
  const ang = Math.atan2(B.z - A.z, B.x - A.x);
  for (const e of net.edgesAt(from)) {
    const o = net.node(e.a === from ? e.b : e.a);
    const a2 = Math.atan2(o.z - A.z, o.x - A.x);
    if (Math.abs(wrapAngle(ang - a2)) < MIN_ANGLE) return false;
  }
  return true;
}

/* ------------------------------------------------------------- generators */

export function generate(preset = 'district', params = {}) {
  const p = {
    seed: 20260411, extent: 320, block: 68, density: 0.72, curviness: 0.35,
    highway: true, rail: true, relief: 0, ...params,
  };
  const net = new RoadNetwork();
  const rnd = new RNG(p.seed >>> 0);
  const noise = new Noise(p.seed);
  const ctx = { net, rnd, noise, p };
  switch (preset) {
    case 'manhattan': genGrid(ctx); break;
    case 'organic': genOrganic(ctx); break;
    case 'interchange': genInterchange(ctx); break;
    case 'suburb': genSuburb(ctx); break;
    default: genDistrict(ctx); break;
  }
  cleanup(net);
  return net;
}

function cleanup(net) {
  // Drop stubs that lead nowhere and nodes with no edges.
  for (let pass = 0; pass < 2; pass++) {
    for (const n of [...net.nodes.values()]) {
      const inc = net.edgesAt(n.id);
      if (inc.length === 0) net.removeNode(n.id);
    }
  }
  // Merge collinear degree-2 chains of the same class? Keep — they add control.
}

function genGrid({ net, rnd, p }) {
  const half = p.extent / 2;
  const cols = Math.max(2, Math.round(p.extent / p.block));
  const rows = Math.max(2, Math.round(p.extent / (p.block * 1.35)));
  const ids = [];
  for (let i = 0; i <= cols; i++) {
    const col = [];
    for (let j = 0; j <= rows; j++) {
      const x = -half + (i / cols) * p.extent + rnd.f(-4, 4) * p.curviness;
      const z = -half + (j / rows) * p.extent + rnd.f(-4, 4) * p.curviness;
      col.push(getOrCreateNode(net, x, z, 0).id);
    }
    ids.push(col);
  }
  for (let i = 0; i <= cols; i++) {
    const avenue = i % 3 === 0;
    for (let j = 0; j < rows; j++) {
      connect(net, ids[i][j], ids[i][j + 1], avenue ? 'arterial' : 'street');
    }
  }
  for (let j = 0; j <= rows; j++) {
    const avenue = j % 3 === 1;
    for (let i = 0; i < cols; i++) {
      if (rnd.chance(0.07) && !avenue) continue;
      connect(net, ids[i][j], ids[i + 1][j], avenue ? 'arterial' : 'street');
    }
  }
}

function genDistrict(ctx) {
  const { net, rnd, p, noise } = ctx;
  const half = p.extent / 2;

  // --- arterial armature -------------------------------------------------
  const cols = clamp(Math.round(p.extent / (p.block * 2.1)), 2, 6);
  const rowsN = clamp(Math.round(p.extent / (p.block * 2.1)), 2, 6);
  const grid = [];
  for (let i = 0; i <= cols; i++) {
    const col = [];
    for (let j = 0; j <= rowsN; j++) {
      const x = -half + (i / cols) * p.extent + noise.n2(i * 1.7, j * 0.9) * 16 * p.curviness;
      const z = -half + (j / rowsN) * p.extent + noise.n2(i * 0.6, j * 2.3) * 16 * p.curviness;
      col.push(getOrCreateNode(net, x, z, 0).id);
    }
    grid.push(col);
  }
  for (let i = 0; i <= cols; i++) {
    for (let j = 0; j < rowsN; j++) connect(net, grid[i][j], grid[i][j + 1], 'arterial');
  }
  for (let j = 0; j <= rowsN; j++) {
    for (let i = 0; i < cols; i++) connect(net, grid[i][j], grid[i + 1][j], 'arterial');
  }

  // --- local streets subdividing each block -------------------------------
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rowsN; j++) {
      const A = net.node(grid[i][j]), B = net.node(grid[i + 1][j]);
      const C = net.node(grid[i + 1][j + 1]), D = net.node(grid[i][j + 1]);
      if (!A || !B || !C || !D) continue;
      const nx = Math.max(1, Math.round(Math.hypot(B.x - A.x, B.z - A.z) / p.block));
      const nz = Math.max(1, Math.round(Math.hypot(D.x - A.x, D.z - A.z) / p.block));
      if (rnd.chance(0.12)) continue;              // leave a superblock
      const lerp2 = (P, Q, t) => [P.x + (Q.x - P.x) * t, P.z + (Q.z - P.z) * t];
      for (let a = 1; a < nx; a++) {
        const t = a / nx;
        const s = lerp2(A, B, t), e = lerp2(D, C, t);
        const n0 = getOrCreateNode(net, s[0], s[1]).id;
        const n1 = getOrCreateNode(net, e[0], e[1]).id;
        connect(net, n0, n1, rnd.chance(p.density) ? 'street' : 'residential');
      }
      for (let b = 1; b < nz; b++) {
        const t = b / nz;
        const s = lerp2(A, D, t), e = lerp2(B, C, t);
        const n0 = getOrCreateNode(net, s[0], s[1]).id;
        const n1 = getOrCreateNode(net, e[0], e[1]).id;
        if (rnd.chance(0.14)) continue;
        connect(net, n0, n1, rnd.chance(p.density) ? 'street' : 'residential');
      }
    }
  }

  // --- motorway on an embankment ------------------------------------------
  if (p.highway) {
    const y = 8.2;
    const pts = [];
    const n = 5;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = -half * 1.12 + t * p.extent * 1.12;
      const z = -half * 0.55 + Math.sin(t * Math.PI * 1.1) * p.extent * 0.22 + noise.n2(t * 3, 9) * 18;
      // touch down on embankment outside the ring, fly over the city
      const ease = smoothstep(clamp(Math.min(t, 1 - t) / 0.2, 0, 1));
      pts.push([x, z, 0.35 + (y - 0.35) * ease]);
    }
    let prev = null;
    const hwNodes = [];
    for (const [x, z, hy] of pts) {
      const nd = net.addNode(makeNode(x, z, hy, { tag: 'motorway' }));
      hwNodes.push(nd.id);
      if (prev) net.addEdge(makeEdge(prev, nd.id, 'highway', { bridge: 'auto' }));
      prev = nd.id;
    }
    // Diamond interchange onto the nearest arterial crossing
    buildDiamond(ctx, hwNodes);
  }

  // --- railway -------------------------------------------------------------
  // Rail never shares the road surface. The main line runs over the district
  // on a viaduct; the metro runs underneath it in a bored tunnel and climbs
  // out through a portal at the south edge.
  if (p.rail) {
    const yTop = 7.4;
    const pts = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      const z = -half * 1.18 + t * p.extent * 1.2;
      const x = half * 0.62 + Math.cos(t * 2.2) * 26;
      const ease = smoothstep(clamp(Math.min(t, 1 - t) / 0.19, 0, 1));
      pts.push([x, z, 0.5 + (yTop - 0.5) * ease]);
    }
    let prev = null;
    for (const [x, z, ry] of pts) {
      const nd = net.addNode(makeNode(x, z, ry, { tag: 'rail' }));
      if (prev) net.addEdge(makeEdge(prev, nd.id, 'rail', { bridge: 'always' }));
      prev = nd.id;
    }

    // Metro: deep under the centre, ramping to a portal in the south-west.
    const mpts = [];
    const mn = 5;
    for (let i = 0; i <= mn; i++) {
      const t = i / mn;
      const x = -half * 1.05 + t * p.extent * 1.1;
      const z = half * 0.18 + Math.sin(t * Math.PI * 0.9) * p.extent * 0.3;
      // surface at the far end so the portal and rolling stock are visible
      const y = t < 0.72 ? -7.6 : -7.6 + ((t - 0.72) / 0.28) ** 1.4 * 8.1;
      mpts.push([x, z, y]);
    }
    prev = null;
    mpts.forEach(([x, z, y], i) => {
      const nd = net.addNode(makeNode(x, z, y, { tag: 'metro' }));
      if (prev) {
        const buried = mpts[i - 1][2] < -3.4 && y < -3.4;
        net.addEdge(makeEdge(prev, nd.id, 'rail', {
          tunnel: buried, bridge: 'never', metro: true,
        }));
      }
      prev = nd.id;
    });
  }

  // --- cul-de-sacs ----------------------------------------------------------
  const ends = [...net.nodes.values()].filter((n) => net.degree(n.id) === 1 && n.tag == null);
  for (const n of ends) if (rnd.chance(0.5)) n.tag = 'cul-de-sac';

  // --- character --------------------------------------------------------
  decorate(ctx);
}

function buildDiamond({ net, rnd }, hwNodes) {
  // Find a motorway segment that passes over an arterial and hang ramps off it.
  for (const e of [...net.edges.values()]) {
    if (e.cls !== 'highway') continue;
    const A = net.node(e.a), B = net.node(e.b);
    for (const o of [...net.edges.values()]) {
      if (o.cls !== 'arterial') continue;
      const C = net.node(o.a), D = net.node(o.b);
      const X = segSegIntersect([A.x, A.z], [B.x, B.z], [C.x, C.z], [D.x, D.z]);
      if (!X || X.t < 0.2 || X.t > 0.8) continue;
      const dx = (B.x - A.x), dz = (B.z - A.z);
      const L = Math.hypot(dx, dz) || 1;
      const dir = [dx / L, dz / L];
      const nrm = [dir[1], -dir[0]];
      const mk = (ox, oz, y) => net.addNode(makeNode(X.p[0] + ox, X.p[1] + oz, y));
      // split the motorway so the ramps have real nodes
      const s1 = splitEdge(net, e, X.p[0] - dir[0] * 95, X.p[1] - dir[1] * 95, A.y);
      const hwA = s1.node;
      const s2 = splitEdge(net, s1.e2, X.p[0] + dir[0] * 95, X.p[1] + dir[1] * 95, A.y);
      const hwB = s2.node;
      // ramp touchdowns on the arterial
      const t1 = splitEdge(net, o, X.p[0] - (D.x - C.x) * 0.0 - dir[0] * 0 + nrm[0] * 0 + (C.x - X.p[0]) * 0.33 + X.p[0] * 0,
        X.p[1] + (C.z - X.p[1]) * 0.33, 0);
      const land1 = t1.node;
      const t2 = splitEdge(net, t1.e2, X.p[0] + (D.x - X.p[0]) * 0.33, X.p[1] + (D.z - X.p[1]) * 0.33, 0);
      const land2 = t2.node;
      const mid1 = mk(nrm[0] * 26 - dir[0] * 48, nrm[1] * 26 - dir[1] * 48, 4.0);
      const mid2 = mk(-nrm[0] * 26 + dir[0] * 48, -nrm[1] * 26 + dir[1] * 48, 4.0);
      net.addEdge(makeEdge(hwA.id, mid1.id, 'ramp'));
      net.addEdge(makeEdge(mid1.id, land1.id, 'ramp'));
      net.addEdge(makeEdge(hwB.id, mid2.id, 'ramp'));
      net.addEdge(makeEdge(mid2.id, land2.id, 'ramp'));
      return true;
    }
  }
  return false;
}

function genOrganic({ net, rnd, noise, p }) {
  const half = p.extent / 2;
  const pop = (x, z) => 0.5 + 0.5 * noise.fbm(x / 190, z / 190, 4);
  const seeds = [];
  const root = net.addNode(makeNode(0, 0, 0));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + rnd.f(-0.3, 0.3);
    seeds.push({ node: root.id, ang: a, cls: 'arterial', life: 9 });
  }
  let guard = 0;
  while (seeds.length && guard++ < 900) {
    const s = seeds.shift();
    const from = net.node(s.node);
    if (!from || s.life <= 0) continue;
    const dens = pop(from.x, from.z);
    const len = clamp(p.block * (0.75 + dens * 0.8), 28, 120);
    const ang = s.ang + rnd.f(-0.42, 0.42) * p.curviness + noise.n2(from.x / 140, from.z / 140) * 0.5 * p.curviness;
    const x = from.x + Math.cos(ang) * len;
    const z = from.z + Math.sin(ang) * len;
    if (Math.abs(x) > half * 1.15 || Math.abs(z) > half * 1.15) continue;
    const target = getOrCreateNode(net, x, z, 0, { snap: 18 });
    const made = connect(net, s.node, target.id, s.cls);
    if (!made.length) continue;
    seeds.push({ node: target.id, ang, cls: s.cls, life: s.life - 1 });
    if (rnd.chance(0.55 * dens)) {
      seeds.push({
        node: target.id, ang: ang + (rnd.chance(0.5) ? 1 : -1) * (Math.PI / 2 + rnd.f(-0.25, 0.25)),
        cls: s.cls === 'arterial' ? 'street' : 'residential', life: Math.max(2, s.life - 3),
      });
    }
  }
  decorate({ net, rnd, p, noise });
}

function genSuburb({ net, rnd, noise, p }) {
  const half = p.extent / 2;
  const ring = [];
  const R = half * 0.62;
  const N = 14;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const r = R * (0.82 + noise.n2(Math.cos(a) * 2, Math.sin(a) * 2) * 0.22);
    ring.push(getOrCreateNode(net, Math.cos(a) * r, Math.sin(a) * r, 0).id);
  }
  for (let i = 0; i < N; i++) connect(net, ring[i], ring[(i + 1) % N], 'street');
  // spine
  const n0 = getOrCreateNode(net, -half, 0, 0).id;
  const n1 = getOrCreateNode(net, half, 0, 0).id;
  connect(net, n0, n1, 'arterial');
  // cul-de-sacs off the ring
  for (let i = 0; i < N; i++) {
    if (!rnd.chance(0.75)) continue;
    const a = (i / N) * TAU;
    const base = net.node(ring[i]);
    const len = rnd.f(38, 72);
    const end = net.addNode(makeNode(base.x + Math.cos(a) * len, base.z + Math.sin(a) * len, 0, { tag: 'cul-de-sac' }));
    connect(net, ring[i], end.id, 'residential');
  }
  decorate({ net, rnd, p, noise });
}

function genInterchange({ net, rnd, noise, p }) {
  const half = p.extent / 2;
  // Motorway west→east on structure
  const hw = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    hw.push(net.addNode(makeNode(-half * 1.2 + t * p.extent * 1.2, Math.sin(t * 2.4) * 22, 9.0, { tag: 'motorway' })).id);
  }
  for (let i = 0; i < hw.length - 1; i++) net.addEdge(makeEdge(hw[i], hw[i + 1], 'highway'));
  // Arterial north→south below
  const ar = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    ar.push(net.addNode(makeNode(Math.cos(t * 2) * 10, -half * 1.1 + t * p.extent * 1.1, 0)).id);
  }
  for (let i = 0; i < ar.length - 1; i++) connect(net, ar[i], ar[i + 1], 'arterial');
  // Four ramps
  const mid = net.node(hw[3]);
  const land = net.node(ar[2]);
  const quads = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (const [sx, sz] of quads) {
    const a = net.addNode(makeNode(mid.x + sx * 70, mid.z + sz * 12, 7.0));
    const b = net.addNode(makeNode(mid.x + sx * 118, mid.z + sz * 62, 3.2));
    const c = net.addNode(makeNode(land.x + sx * 16, land.z + sz * 96, 0.0));
    net.addEdge(makeEdge(a.id, b.id, 'ramp'));
    net.addEdge(makeEdge(b.id, c.id, 'ramp'));
    connect(net, c.id, ar[sz > 0 ? 3 : 1], 'ramp');
    // graft the ramp head onto the motorway
    const near = nodeNear(net, a.x, a.z, 400);
    for (const e of net.edges.values()) {
      if (e.cls !== 'highway') continue;
      const A = net.node(e.a), B = net.node(e.b);
      const pr = pointSegDist2(a.x, a.z, A.x, A.z, B.x, B.z);
      if (pr.d2 < 60 * 60 && pr.t > 0.05 && pr.t < 0.95) {
        const sp = splitEdge(net, e, pr.x, pr.z, A.y + (B.y - A.y) * pr.t);
        net.addEdge(makeEdge(sp.node.id, a.id, 'ramp'));
        break;
      }
    }
  }
  decorate({ net, rnd, p, noise });
}

/** Sprinkle realistic wear, bumps, parking, works zones. */
function decorate({ net, rnd, p }) {
  for (const e of net.edges.values()) {
    if (e.cls === 'rail') continue;
    e.wear = clamp(rnd.f(0.18, 0.85), 0, 1);
    e.patches = rnd.f(0.05, 0.8);
    e.potholes = e.cls === 'highway' ? rnd.f(0, 0.12) : rnd.f(0, 0.55) * (e.wear > 0.5 ? 1 : 0.3);
    if ((e.cls === 'residential' || e.cls === 'street') && rnd.chance(0.22)) {
      const count = rnd.i(1, 2);
      for (let i = 0; i < count; i++) {
        e.bumps.push({ s: rnd.f(0.25, 0.75), kind: rnd.pick(['hump', 'table', 'cushion']) });
      }
    }
    if (rnd.chance(0.07) && e.cls !== 'highway') {
      const s0 = rnd.f(0.15, 0.55);
      e.construction = { s0, s1: Math.min(0.92, s0 + rnd.f(0.15, 0.3)), side: rnd.sign() };
    }
    if (e.cls === 'street' && rnd.chance(0.3)) { e.bikeLaneR = true; e.parkingR = 0; }
  }
  for (const n of net.nodes.values()) {
    const d = net.degree(n.id);
    if (d >= 3) {
      const big = net.edgesAt(n.id).some((e) => e.cls === 'arterial' || e.cls === 'highway');
      n.signals = big ? 'signals' : (rnd.chance(0.5) ? 'stop' : 'none');
    }
  }
}
