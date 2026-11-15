// Analytical primitives for the Fracture Editor.
//
// A primitive is a set of named dimensions. Everything else is derived from those numbers:
//   sdf(p)    exact signed distance (negative inside). Used to accept fracture seeds and to sphere-trace the impact
//             point, so a click lands on the true surface rather than on a facet.
//   parts     convex polyhedra as outward plane lists. Convex shapes have a single part. The torus and the pipe are not
//             convex, so they are split into wedge segments; the faces those segments share are tagged 'seam', are never
//             drawn, and let the fracture rejoin pieces that a seam would otherwise split.
//   normals   per surface group, the exact surface normal. Faceted geometry is shaded as the true curved surface, and
//             fracture cut faces stay flat.
//   volume    closed-form volume, compared with the faceted volume as the faceting error.

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const TAU = Math.PI * 2;
// Facet distances that preserve area rather than inscribe, so faceting barely changes volume:
// the apothem of an N-gon with the area of a circle, and the circumradius of an N-gon with that area.
const apothem = (r, N) => r * Math.sqrt(Math.PI / (N * Math.tan(Math.PI / N)));
const circumradius = (r, N) => r * Math.sqrt(TAU / (N * Math.sin(TAU / N)));

export const DETAIL = {
  low: { label: 'Low', around: 24, sphere: 1 },
  medium: { label: 'Medium', around: 40, sphere: 2 },
  high: { label: 'High', around: 64, sphere: 3 },
};

// Dimension fields: [key, label, unit, min, max, step, default].
export const PRIMITIVES = [
  { id: 'box', label: 'Box', icon: 'editor-cube', convex: true, formula: 'W · H · D',
    dims: [['W', 'Width', 'm', 0.1, 3, 0.01, 1], ['H', 'Height', 'm', 0.1, 3, 0.01, 1], ['D', 'Depth', 'm', 0.1, 3, 0.01, 1]] },
  { id: 'sphere', label: 'Sphere', icon: 'editor-sphere', convex: true, formula: '4⁄3 π r³',
    dims: [['R', 'Radius', 'm', 0.1, 1.5, 0.01, 0.5]] },
  { id: 'cylinder', label: 'Cylinder', icon: 'editor-cylinder', convex: true, formula: 'π r² h',
    dims: [['R', 'Radius', 'm', 0.05, 1.5, 0.01, 0.4], ['H', 'Height', 'm', 0.1, 3, 0.01, 1.2]] },
  { id: 'cone', label: 'Cone', icon: 'editor-cone', convex: true, formula: '1⁄3 π r² h',
    dims: [['R', 'Base radius', 'm', 0.1, 1.5, 0.01, 0.5], ['H', 'Height', 'm', 0.1, 3, 0.01, 1.1]] },
  { id: 'capsule', label: 'Capsule', icon: 'editor-capsule', convex: true, formula: 'π r² l + 4⁄3 π r³',
    dims: [['R', 'Radius', 'm', 0.05, 1, 0.01, 0.3], ['L', 'Shaft length', 'm', 0, 2.5, 0.01, 0.7]] },
  { id: 'torus', label: 'Torus', icon: 'editor-torus', convex: false, formula: '2 π² R r²',
    dims: [['R', 'Ring radius', 'm', 0.15, 1.5, 0.01, 0.5], ['r', 'Tube radius', 'm', 0.04, 0.6, 0.01, 0.19]] },
  { id: 'pipe', label: 'Pipe', icon: 'editor-cylinder', convex: false, formula: 'π (R² − r²) h',
    dims: [['R', 'Outer radius', 'm', 0.1, 1.5, 0.01, 0.48], ['r', 'Bore radius', 'm', 0.02, 1.4, 0.01, 0.34], ['H', 'Height', 'm', 0.05, 3, 0.01, 0.8]] },
  { id: 'pane', label: 'Pane', icon: 'editor-pane', convex: true, thin: true, formula: 'W · H · t',
    dims: [['W', 'Width', 'm', 0.2, 3, 0.01, 1.7], ['H', 'Height', 'm', 0.2, 3, 0.01, 1.15], ['T', 'Thickness', 'mm', 2, 60, 1, 14]] },
  { id: 'hex', label: 'Hex column', icon: 'editor-hex-column', convex: true, formula: '2√3 a² h',
    dims: [['F', 'Across flats', 'm', 0.1, 2, 0.01, 0.56], ['H', 'Height', 'm', 0.1, 3, 0.01, 1.2]] },
];
export const primitiveById = (id) => PRIMITIVES.find((p) => p.id === id) || PRIMITIVES[0];

export function defaultDims(id) { return Object.fromEntries(primitiveById(id).dims.map((d) => [d[0], d[6]])); }

export function normalizeDims(id, input = {}) {
  const spec = primitiveById(id), out = {};
  for (const [key, , , lo, hi, , def] of spec.dims) { const v = +input[key]; out[key] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def; }
  // Keep the shapes valid: the bore must leave a wall, the tube must not swallow the ring.
  if (id === 'pipe') out.r = Math.min(out.r, out.R - 0.02);
  if (id === 'torus') out.r = Math.min(out.r, out.R * 0.92);
  return out;
}

// Short human description: "Ø 1.00 m", "Ø 0.80 × 1.20 m", …
export function describe(id, d) {
  const m = (v) => v.toFixed(2);
  switch (id) {
    case 'box': return `${m(d.W)} × ${m(d.H)} × ${m(d.D)} m`;
    case 'sphere': return `Ø ${m(d.R * 2)} m`;
    case 'cylinder': return `Ø ${m(d.R * 2)} × ${m(d.H)} m`;
    case 'cone': return `Ø ${m(d.R * 2)} × ${m(d.H)} m`;
    case 'capsule': return `Ø ${m(d.R * 2)} × ${m(d.L + d.R * 2)} m`;
    case 'torus': return `R ${m(d.R)} · r ${m(d.r)} m`;
    case 'pipe': return `Ø ${m(d.R * 2)} / ${m(d.r * 2)} × ${m(d.H)} m`;
    case 'pane': return `${m(d.W)} × ${m(d.H)} m · ${d.T.toFixed(0)} mm`;
    case 'hex': return `${m(d.F)} AF × ${m(d.H)} m`;
    default: return '';
  }
}

export function exactVolume(id, d) {
  switch (id) {
    case 'box': return d.W * d.H * d.D;
    case 'sphere': return (4 / 3) * Math.PI * d.R ** 3;
    case 'cylinder': return Math.PI * d.R * d.R * d.H;
    case 'cone': return (Math.PI * d.R * d.R * d.H) / 3;
    case 'capsule': return Math.PI * d.R * d.R * d.L + (4 / 3) * Math.PI * d.R ** 3;
    case 'torus': return 2 * Math.PI * Math.PI * d.R * d.r * d.r;
    case 'pipe': return Math.PI * (d.R * d.R - d.r * d.r) * d.H;
    case 'pane': return d.W * d.H * d.T / 1000;
    case 'hex': return 2 * Math.sqrt(3) * (d.F / 2) ** 2 * d.H;
    default: return 0;
  }
}

export function exactArea(id, d) {
  switch (id) {
    case 'box': return 2 * (d.W * d.H + d.H * d.D + d.W * d.D);
    case 'sphere': return 4 * Math.PI * d.R * d.R;
    case 'cylinder': return TAU * d.R * (d.R + d.H);
    case 'cone': return Math.PI * d.R * (d.R + Math.hypot(d.R, d.H));
    case 'capsule': return TAU * d.R * d.L + 4 * Math.PI * d.R * d.R;
    case 'torus': return 4 * Math.PI * Math.PI * d.R * d.r;
    case 'pipe': return TAU * (d.R + d.r) * d.H + 2 * Math.PI * (d.R * d.R - d.r * d.r);
    case 'pane': { const t = d.T / 1000; return 2 * (d.W * d.H + d.H * t + d.W * t); }
    case 'hex': { const a = d.F / 2, s = (2 * a) / Math.sqrt(3); return 6 * s * d.H + 2 * 2 * Math.sqrt(3) * a * a; }
    default: return 0;
  }
}

// ---------------------------------------------------------------------------------------------------- distance
// 2D signed distance to a closed polygon in the (ρ, y) half-plane of a solid of revolution. Edges that lie on the
// axis are not boundary, so they are skipped for distance but kept for the inside test.
function profileDistance(rho, y, pts) {
  let best = Infinity, inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[j], b = pts[i];
    if ((a[1] > y) !== (b[1] > y) && rho < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    if (a[0] === 0 && b[0] === 0) continue;
    const ex = b[0] - a[0], ey = b[1] - a[1], t = Math.max(0, Math.min(1, ((rho - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey || 1)));
    best = Math.min(best, Math.hypot(rho - a[0] - ex * t, y - a[1] - ey * t));
  }
  return inside ? -best : best;
}

export function signedDistance(id, d, p) {
  const [x, y, z] = p, rho = Math.hypot(x, z);
  switch (id) {
    case 'box': return boxDistance(p, [d.W / 2, d.H / 2, d.D / 2]);
    case 'pane': return boxDistance(p, [d.W / 2, d.H / 2, d.T / 2000]);
    case 'sphere': return Math.hypot(x, y, z) - d.R;
    case 'cylinder': return profileDistance(rho, y, [[0, -d.H / 2], [d.R, -d.H / 2], [d.R, d.H / 2], [0, d.H / 2]]);
    case 'cone': return profileDistance(rho, y, [[0, -d.H / 2], [d.R, -d.H / 2], [0, d.H / 2]]);
    case 'capsule': { const c = Math.max(-d.L / 2, Math.min(d.L / 2, y)); return Math.hypot(x, y - c, z) - d.R; }
    case 'torus': return Math.hypot(rho - d.R, y) - d.r;
    case 'pipe': return profileDistance(rho, y, [[d.r, -d.H / 2], [d.R, -d.H / 2], [d.R, d.H / 2], [d.r, d.H / 2]]);
    case 'hex': {
      const a = d.F / 2; let m = Math.abs(y) - d.H / 2, side = -Infinity;
      for (let k = 0; k < 6; k++) { const t = (k / 6) * TAU; side = Math.max(side, x * Math.cos(t) + z * Math.sin(t) - a); }
      return side > 0 && m > 0 ? Math.hypot(side, m) : Math.max(side, m);
    }
    default: return 1;
  }
}
function boxDistance(p, h) {
  const q = [Math.abs(p[0]) - h[0], Math.abs(p[1]) - h[1], Math.abs(p[2]) - h[2]];
  return Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)) + Math.min(Math.max(q[0], q[1], q[2]), 0);
}

// Exact outward normal of a curved surface group at p.
const NORMALS = {
  sphere: () => (p) => norm(p),
  radial: () => (p) => norm([p[0], 0, p[2]]),
  bore: () => (p) => norm([-p[0], 0, -p[2]]),
  cone: (d) => (p) => { const a = Math.atan2(p[2], p[0]); return norm([Math.cos(a) * d.H, d.R, Math.sin(a) * d.H]); },
  capsule: (d) => (p) => { const c = Math.max(-d.L / 2, Math.min(d.L / 2, p[1])); return norm([p[0], p[1] - c, p[2]]); },
  tube: (d) => (p) => { const r = Math.hypot(p[0], p[2]) || 1; return norm([p[0] - (p[0] / r) * d.R, p[1], p[2] - (p[2] / r) * d.R]); },
};

// ---------------------------------------------------------------------------------------------------- facets
// Unit directions of a subdivided icosahedron: 42, 162 or 642 for subdivision 1, 2 or 3.
export function sphereDirections(subdiv) {
  const t = (1 + Math.sqrt(5)) / 2;
  let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
  let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < subdiv; s++) {
    const cache = new Map(), nf = [];
    const mid = (a, b) => { const k = a < b ? a + ',' + b : b + ',' + a; if (!cache.has(k)) { cache.set(k, v.length); v.push(norm(add(v[a], v[b]))); } return cache.get(k); };
    for (const [a, b, c] of f) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    f = nf;
  }
  return v;
}

// A plane is { n, d, tag: 'surface' | 'seam', group } with n·p ≤ d inside.
const surface = (n, d, group = 'flat') => ({ n: norm(n), d, tag: 'surface', group });
const boxPlanes = (hx, hy, hz) => [surface([1, 0, 0], hx), surface([-1, 0, 0], hx), surface([0, 1, 0], hy), surface([0, -1, 0], hy), surface([0, 0, 1], hz), surface([0, 0, -1], hz)];

// Wedge planes between angles a0 and a1 around Y. Seam k is the plane at angle 2πk/N.
function wedge(a0, a1, s, count) {
  return [
    { n: [Math.sin(a0), 0, -Math.cos(a0)], d: 0, tag: 'seam', group: 'seam:' + s },
    { n: [-Math.sin(a1), 0, Math.cos(a1)], d: 0, tag: 'seam', group: 'seam:' + ((s + 1) % count) },
  ];
}

// Convex parts (plane lists with an axis-aligned bound) and the per-group normal functions.
export function primitiveParts(id, d, detail = 'medium') {
  const q = DETAIL[detail] || DETAIL.medium, N = q.around, parts = [];
  const normals = { flat: null };
  const one = (planes, lo, hi) => parts.push({ planes, lo, hi, segment: 0 });
  if (id === 'box') one(boxPlanes(d.W / 2, d.H / 2, d.D / 2), [-d.W / 2, -d.H / 2, -d.D / 2], [d.W / 2, d.H / 2, d.D / 2]);
  else if (id === 'pane') { const t = d.T / 2000; one(boxPlanes(d.W / 2, d.H / 2, t), [-d.W / 2, -d.H / 2, -t], [d.W / 2, d.H / 2, t]); }
  else if (id === 'sphere') {
    normals.sphere = NORMALS.sphere(d);
    // Planes at the mean of the inscribed and tangent distances keep the faceted volume close to 4⁄3 π r³.
    const dirs = sphereDirections(q.sphere), k = q.sphere === 1 ? 0.968 : q.sphere === 2 ? 0.992 : 0.998;
    one(dirs.map((n) => surface(n, d.R * k, 'sphere')), [-d.R, -d.R, -d.R], [d.R, d.R, d.R]);
  } else if (id === 'cylinder') {
    normals.radial = NORMALS.radial(d);
    const planes = [surface([0, 1, 0], d.H / 2), surface([0, -1, 0], d.H / 2)];
    for (let i = 0; i < N; i++) { const a = ((i + 0.5) / N) * TAU; planes.push(surface([Math.cos(a), 0, Math.sin(a)], apothem(d.R, N), 'radial')); }
    one(planes, [-d.R, -d.H / 2, -d.R], [d.R, d.H / 2, d.R]);
  } else if (id === 'cone') {
    normals.cone = NORMALS.cone(d);
    const planes = [surface([0, -1, 0], d.H / 2)], ri = apothem(d.R, N);
    for (let i = 0; i < N; i++) { const a = ((i + 0.5) / N) * TAU, n = norm([Math.cos(a) * d.H, ri, Math.sin(a) * d.H]); planes.push(surface(n, n[1] * d.H / 2, 'cone')); }
    one(planes, [-d.R, -d.H / 2, -d.R], [d.R, d.H / 2, d.R]);
  } else if (id === 'capsule') {
    normals.capsule = NORMALS.capsule(d);
    const planes = [], ri = d.R * 0.994;
    for (let i = 0; i < N; i++) { const a = ((i + 0.5) / N) * TAU; planes.push(surface([Math.cos(a), 0, Math.sin(a)], ri, 'capsule')); }
    for (const n of sphereDirections(q.sphere)) if (Math.abs(n[1]) > 0.05) planes.push(surface(n, ri + Math.abs(n[1]) * d.L / 2, 'capsule'));
    one(planes, [-d.R, -d.L / 2 - d.R, -d.R], [d.R, d.L / 2 + d.R, d.R]);
  } else if (id === 'hex') {
    const a = d.F / 2, s = a / Math.cos(Math.PI / 6), planes = [surface([0, 1, 0], d.H / 2), surface([0, -1, 0], d.H / 2)];
    for (let k = 0; k < 6; k++) { const t = (k / 6) * TAU; planes.push(surface([Math.cos(t), 0, Math.sin(t)], a)); }
    one(planes, [-s, -d.H / 2, -s], [s, d.H / 2, s]);
  } else if (id === 'torus') {
    normals.tube = NORMALS.tube(d);
    const M = Math.max(12, Math.round(N / 2)), tr = circumradius(d.r, M), rr = (d.R * TAU) / (N * Math.sin(TAU / N));
    // A wedge holds A · ρ · sin(2π/N) for a section of area A centred at ρ, so ρ = 2πR / (N sin 2π/N) keeps Pappus' 2π²Rr².
    const ring = (a, f) => { const rho = rr + tr * Math.cos(f); return [rho * Math.cos(a), tr * Math.sin(f), rho * Math.sin(a)]; };
    for (let s = 0; s < N; s++) {
      const a0 = (s / N) * TAU, a1 = ((s + 1) / N) * TAU, am = (a0 + a1) / 2, planes = wedge(a0, a1, s, N);
      const centre = [d.R * Math.cos(am), 0, d.R * Math.sin(am)];
      const lo = [Infinity, -tr, Infinity], hi = [-Infinity, tr, -Infinity];
      for (let k = 0; k < M; k++) {
        const f0 = (k / M) * TAU, f1 = ((k + 1) / M) * TAU, A = ring(a0, f0), B = ring(a0, f1), C = ring(a1, f0);
        let n = norm(cross(sub(B, A), sub(C, A)));
        if (dot(n, sub(A, centre)) < 0) n = n.map((v) => -v);
        planes.push({ n, d: dot(n, A), tag: 'surface', group: 'tube' });
        for (const P of [A, B, C, ring(a1, f1)]) for (const c of [0, 2]) { lo[c] = Math.min(lo[c], P[c]); hi[c] = Math.max(hi[c], P[c]); }
      }
      parts.push({ planes, lo, hi, segment: s });
    }
  } else if (id === 'pipe') {
    normals.radial = NORMALS.radial(d); normals.bore = NORMALS.bore(d);
    const ao = apothem(d.R, N), ai = apothem(d.r, N), co = ao / Math.cos(Math.PI / N);
    for (let s = 0; s < N; s++) {
      const a0 = (s / N) * TAU, a1 = ((s + 1) / N) * TAU, am = (a0 + a1) / 2, u = [Math.cos(am), 0, Math.sin(am)];
      const planes = [...wedge(a0, a1, s, N), surface(u, ao, 'radial'), surface(u.map((v) => -v), -ai, 'bore'), surface([0, 1, 0], d.H / 2), surface([0, -1, 0], d.H / 2)];
      const ci = ai / Math.cos(Math.PI / N), xs = [ci * Math.cos(a0), ci * Math.cos(a1), co * Math.cos(a0), co * Math.cos(a1)], zs = [ci * Math.sin(a0), ci * Math.sin(a1), co * Math.sin(a0), co * Math.sin(a1)];
      parts.push({ planes, lo: [Math.min(...xs), -d.H / 2, Math.min(...zs)], hi: [Math.max(...xs), d.H / 2, Math.max(...zs)], segment: s });
    }
  }
  return { parts, normals, segmented: parts.length > 1, segments: parts.length };
}

// Sphere-trace the exact distance field. Returns the hit point and outward normal, or null.
export function traceSurface(id, d, origin, dir, far = 60) {
  let t = 0;
  for (let i = 0; i < 256 && t < far; i++) {
    const p = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t], s = signedDistance(id, d, p);
    if (s < 1e-5) return { point: p, normal: gradient(id, d, p), t };
    t += Math.max(s * 0.9, 1e-4);
  }
  return null;
}
export function gradient(id, d, p) {
  const e = 1e-4, f = (x, y, z) => signedDistance(id, d, [x, y, z]);
  return norm([f(p[0] + e, p[1], p[2]) - f(p[0] - e, p[1], p[2]), f(p[0], p[1] + e, p[2]) - f(p[0], p[1] - e, p[2]), f(p[0], p[1], p[2] + e) - f(p[0], p[1], p[2] - e)]);
}
