// Fracture preview engine for the Fracture Editor. Deliberately small: it exists to drive the UI with real numbers,
// not to be a destruction solver. Two paths:
//   • Analytical convex sources (cube, sphere, cylinder, cone, pane, beam, convex rock): closed convex Voronoi cells,
//     clipped from the source polyhedron by bisector planes. Cut faces are capped, so volume is conserved exactly.
//   • Arbitrary meshes (e.g. the ControlVehicle body shell): every source triangle goes to its nearest seed, giving open
//     surface patches. Capping those needs convex decomposition, which is reported as pending rather than faked.
// Recipe fields follow FractureSpecification v2 in Frontier-OLD (Material, Energy, Seed, Ceiling, MinimumSize, X/Y/Z,
// Mode, PieceSdf, SdfResolution) plus the three quality switches the old card listed as fixed behaviour.

// Physical constants after Frontier-OLD FractureEditor/SourceDepot/Fragmentation/src/fracture/materials.ts.
// Gc (J/m²) is what decides how finely something shatters: crack area is bought with impact energy at 2·Gc per m².
export const MATERIALS = {
  concrete: { label: 'Concrete', mode: 'bulk-brittle', density: 2350, Gc: 140, stored: 0, grain: 1, cluster: 0.65, ring: 0.22, color: 0x9d9d97, interior: 0x7d7b74,
    note: 'Energy-limited bulk cuts concentrated around the impact. Reinforcement is not represented.' },
  rock: { label: 'Stone', mode: 'bulk-brittle', density: 2700, Gc: 95, stored: 0, grain: 1, cluster: 0.55, ring: 0.18, color: 0x7c7b78, interior: 0x93897f,
    note: 'Brittle stone with its own crack resistance. Bedding planes and surface dressing are not simulated.' },
  wood: { label: 'Wood', mode: 'fibrous', density: 520, Gc: 320, stored: 0, grain: 11, cluster: 0.35, ring: 0.05, color: 0xb5854a, interior: 0xd8b57d,
    note: 'Local X grain: cells stretch along the grain, so splits run lengthwise and cross-grain cuts cost more.' },
  glass: { label: 'Glass', mode: 'plate-brittle', density: 2500, Gc: 7, stored: 0, grain: 1, cluster: 0.8, ring: 0.42, color: 0xcfe6ea, interior: 0xa9cdd4,
    note: 'Brittle and radial. Thin panes split through their thickness in rings and spokes around the impact.' },
  tempered: { label: 'Tempered glass', mode: 'plate-brittle', density: 2500, Gc: 7, stored: 46000, grain: 1, cluster: 0.08, ring: 0.5, color: 0xbfe0e6, interior: 0x9fc6ce,
    note: 'Stored elastic energy (46 kJ/m³) dices the whole part into near-uniform cubes, bounded by the quality limits.' },
  plastic: { label: 'ABS plastic', mode: 'ductile', density: 1050, Gc: 460, stored: 0, grain: 1, cluster: 0.5, ring: 0.1, color: 0xd8552f, interior: 0xf0b9a4,
    note: 'High crack resistance keeps fragments few and large. Plastic deformation (denting) is not simulated.' },
};
export const MATERIAL_ORDER = ['concrete', 'rock', 'wood', 'glass', 'tempered', 'plastic'];

export const DEFAULT_RECIPE = {
  Enabled: false, Mode: 'dynamic', PieceSdf: false, SdfResolution: 64,
  Material: 'concrete', Energy: 2500, Seed: 42, Ceiling: 48, MinimumSize: 0.045, X: 0, Y: 0, Z: 0,
  NeedleRejection: true, ClosedCaps: true, QualityTriangulation: true, Baked: null,
};
export const LIMITS = { Energy: [0, 50000], Seed: [1, 999999], Ceiling: [2, 160], MinimumSize: [0.002, 0.3] };

export function normalizeRecipe(input = {}) {
  const r = { ...DEFAULT_RECIPE, ...(input && typeof input === 'object' ? input : {}) };
  r.Enabled = r.Enabled === true; r.Mode = r.Mode === 'baked' ? 'baked' : 'dynamic'; r.PieceSdf = r.PieceSdf === true;
  r.SdfResolution = [32, 64, 128].includes(+r.SdfResolution) ? +r.SdfResolution : 64;
  if (!MATERIALS[r.Material]) r.Material = 'concrete';
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) { const v = +r[k]; r[k] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : DEFAULT_RECIPE[k]; }
  r.Seed = Math.round(r.Seed); r.Ceiling = Math.round(r.Ceiling);
  for (const k of ['X', 'Y', 'Z']) r[k] = Number.isFinite(+r[k]) ? +r[k] : 0;
  for (const k of ['NeedleRejection', 'ClosedCaps', 'QualityTriangulation']) r[k] = r[k] !== false;
  return r;
}

// Everything that changes geometry. Mode, SDF, bake receipts and the Simulate settings are excluded, so changing them
// never makes a bake stale.
export function signature(source, recipe) {
  const { Enabled, Mode, PieceSdf, SdfResolution, Baked, Thumb, EditedAt, Pieces, Simulation, ...geo } = normalizeRecipe(recipe);
  return hash(JSON.stringify({ v: 1, source: source.key, geo }));
}
function hash(text) { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); }

export function random(seed) { let a = seed >>> 0 || 1; return () => { a = (Math.imul(1664525, a) + 1013904223) >>> 0; return a / 4294967296; }; }

// ---------------------------------------------------------------------------------------------------- vectors
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ---------------------------------------------------------------------------------------------------- sources
// Specimen primitives, centred on the origin, metres. `planes` are outward [n, d] with n·p ≤ d inside.
export const SPECIMENS = [
  { id: 'cube', label: 'Cube', note: '1.0 m block', icon: 'cube' },
  { id: 'sphere', label: 'Sphere', note: 'Ø 1.0 m', icon: 'sphere' },
  { id: 'cylinder', label: 'Cylinder', note: 'Ø 0.8 × 1.2 m column', icon: 'cylinder' },
  { id: 'cone', label: 'Cone', note: 'Ø 1.0 × 1.1 m', icon: 'cone' },
  { id: 'pane', label: 'Thin pane', note: '1.70 × 1.15 m · 14 mm plate', icon: 'pane' },
  { id: 'beam', label: 'Beam', note: '2.4 × 0.20 × 0.14 m', icon: 'beam' },
  { id: 'rock', label: 'Convex rock', note: '≈ 1.1 m boulder', icon: 'rock' },
];

function boxPlanes(hx, hy, hz) { return [[[1, 0, 0], hx], [[-1, 0, 0], hx], [[0, 1, 0], hy], [[0, -1, 0], hy], [[0, 0, 1], hz], [[0, 0, -1], hz]]; }
function sphereDirs(subdiv) {
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

export function specimenSource(id) {
  const spec = SPECIMENS.find((s) => s.id === id) || SPECIMENS[0];
  let planes, half;
  if (spec.id === 'cube') { planes = boxPlanes(0.5, 0.5, 0.5); half = [0.5, 0.5, 0.5]; }
  else if (spec.id === 'sphere') { planes = sphereDirs(2).map((d) => [d, 0.5]); half = [0.5, 0.5, 0.5]; }
  else if (spec.id === 'cylinder') {
    planes = [[[0, 1, 0], 0.6], [[0, -1, 0], 0.6]]; half = [0.4, 0.6, 0.4];
    for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; planes.push([[Math.cos(a), 0, Math.sin(a)], 0.4 * Math.cos(Math.PI / 40)]); }
  } else if (spec.id === 'cone') {
    const r = 0.5, hh = 0.55; planes = [[[0, -1, 0], hh]]; half = [r, hh, r];
    for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2, n = norm([Math.cos(a) * 2 * hh, r, Math.sin(a) * 2 * hh]); planes.push([n, n[1] * hh]); }
  } else if (spec.id === 'pane') { planes = boxPlanes(0.85, 0.575, 0.007); half = [0.85, 0.575, 0.007]; }
  else if (spec.id === 'beam') { planes = boxPlanes(1.2, 0.1, 0.07); half = [1.2, 0.1, 0.07]; }
  else {
    const rnd = random(7331), radii = [0.6, 0.47, 0.55]; planes = []; half = radii.slice();
    for (const d of sphereDirs(1)) {
      const n = norm([d[0] + (rnd() - 0.5) * 0.45, d[1] + (rnd() - 0.5) * 0.45, d[2] + (rnd() - 0.5) * 0.45]);
      planes.push([n, Math.hypot(radii[0] * n[0], radii[1] * n[1], radii[2] * n[2]) * (0.86 + rnd() * 0.12)]);
    }
  }
  let poly = boxPoly(half.map((x) => x * 1.6 + 0.05));
  for (const [n, d] of planes) poly = clip(poly, n, d, false) || poly;
  const tri = triangulate(poly, true);
  const bounds = boundsOf(poly);
  return { kind: 'convex', key: 'specimen:' + spec.id, id: spec.id, label: spec.label, note: spec.note, icon: spec.icon, planes, poly, bounds,
    volume: polyVolume(poly), area: tri.area, thin: spec.id === 'pane', positions: tri.positions, normals: tri.normals };
}

// A compiled Content mesh (positions / indices / corner normals). Treated as a surface.
export function meshSource(record, key) {
  const P = record.positions, I = record.indices, tris = I.length / 3;
  const centroids = new Float32Array(tris * 3), areas = new Float32Array(tris);
  let area = 0;
  for (let t = 0; t < tris; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    for (let k = 0; k < 3; k++) centroids[t * 3 + k] = (P[a + k] + P[b + k] + P[c + k]) / 3;
    const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    areas[t] = len(cross(e1, e2)) / 2; area += areas[t];
  }
  const lo = record.bounds.lo, hi = record.bounds.hi;
  return { kind: 'mesh', key: key || 'mesh:' + record.id, id: record.id, label: record.name, note: `${record.format} · ${record.triangles.toLocaleString()} tris`, icon: 'mesh',
    record, centroids, areas, area, bounds: { lo: [...lo], hi: [...hi], centre: lo.map((v, k) => (v + hi[k]) / 2), size: hi.map((v, k) => v - lo[k]) },
    volume: (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]), closed: !!record.topology?.closed };
}

// ---------------------------------------------------------------------------------------------------- polyhedra
// A polyhedron is a list of faces { pts: [[x,y,z]…] CCW seen from outside, cut: bool (true = fracture surface) }.
function boxPoly([hx, hy, hz]) {
  const v = (x, y, z) => [x * hx, y * hy, z * hz];
  const f = (pts) => ({ pts, cut: false });
  return [
    f([v(1, -1, -1), v(1, 1, -1), v(1, 1, 1), v(1, -1, 1)]), f([v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1)]),
    f([v(-1, 1, -1), v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1)]), f([v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1)]),
    f([v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)]), f([v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1), v(1, -1, -1)]),
  ];
}

// Keep n·p ≤ d. Returns the clipped polyhedron, the same object if untouched, or null if nothing is left.
function clip(poly, n, d, capIsCut = true) {
  const eps = 1e-9, out = [], cap = [];
  let touched = false;
  for (const face of poly) {
    const pts = face.pts, ds = pts.map((p) => dot(n, p) - d);
    let max = -Infinity, min = Infinity;
    for (const x of ds) { if (x > max) max = x; if (x < min) min = x; }
    if (max <= eps) { out.push(face); for (let i = 0; i < pts.length; i++) if (ds[i] > -eps) cap.push(pts[i]); continue; }
    touched = true;
    if (min >= -eps) { for (let i = 0; i < pts.length; i++) if (ds[i] < eps) cap.push(pts[i]); continue; }
    const np = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], da = ds[i], db = ds[(i + 1) % pts.length];
      if (da <= eps) np.push(a);
      if (Math.abs(da) <= eps) cap.push(a);
      if ((da < -eps && db > eps) || (da > eps && db < -eps)) { const t = da / (da - db), p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; np.push(p); cap.push(p); }
    }
    if (np.length >= 3) out.push({ pts: np, cut: face.cut });
  }
  if (!touched) return poly;
  if (!out.length) return null;
  const unique = [];
  for (const p of cap) if (!unique.some((q) => Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) < 1e-7)) unique.push(p);
  if (unique.length >= 3) {
    const c = mul(unique.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / unique.length);
    const u = norm(Math.abs(n[0]) < 0.9 ? cross(n, [1, 0, 0]) : cross(n, [0, 1, 0])), v = cross(n, u);
    unique.sort((p, q) => Math.atan2(dot(sub(p, c), v), dot(sub(p, c), u)) - Math.atan2(dot(sub(q, c), v), dot(sub(q, c), u)));
    out.push({ pts: unique, cut: capIsCut });
  }
  return out;
}

function boundsOf(poly) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const f of poly) for (const p of f.pts) for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k]; }
  return { lo, hi, centre: lo.map((v, k) => (v + hi[k]) / 2), size: hi.map((v, k) => v - lo[k]) };
}
function polyVolume(poly) {
  let v = 0; const o = poly[0].pts[0];
  for (const f of poly) for (let i = 1; i + 1 < f.pts.length; i++) v += dot(sub(f.pts[0], o), cross(sub(f.pts[i], o), sub(f.pts[i + 1], o))) / 6;
  return v;
}
// Drop polygon corners closer than 0.2 mm to the previous one: clipping leaves near-duplicates that only make slivers.
function weld(pts) {
  const out = [];
  for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) > 2e-4) out.push(p); }
  while (out.length > 1) { const q = out[out.length - 1], p = out[0]; if (Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) > 2e-4) break; out.pop(); }
  return out;
}
function faceArea(pts) { let s = [0, 0, 0]; for (let i = 1; i + 1 < pts.length; i++) s = add(s, cross(sub(pts[i], pts[0]), sub(pts[i + 1], pts[0]))); return len(s) / 2; }

// Triangulate for drawing. Quality-aware = fan from the face centroid (no slivers from long fans); otherwise fan from vertex 0.
function triangulate(poly, quality, includeCut = true) {
  const pos = [], nrm = [], cut = [];
  let minQ = 1, area = 0, cutArea = 0, tris = 0;
  const push = (a, b, c, n, isCut) => {
    const e0 = sub(b, a), e1 = sub(c, b), e2 = sub(a, c), A = len(cross(e0, sub(c, a))) / 2;
    if (A < 1e-12) return;
    const q = (4 * Math.sqrt(3) * A) / (dot(e0, e0) + dot(e1, e1) + dot(e2, e2));
    if (q < minQ) minQ = q;
    area += A; if (isCut) cutArea += A; tris++;
    pos.push(...a, ...b, ...c); nrm.push(...n, ...n, ...n); cut.push(isCut ? 1 : 0);
  };
  for (const f of poly) {
    if (f.cut && !includeCut) continue;
    const pts = weld(f.pts); if (pts.length < 3 || faceArea(pts) < 1e-10) continue;
    let n = [0, 0, 0]; for (let i = 1; i + 1 < pts.length; i++) n = add(n, cross(sub(pts[i], pts[0]), sub(pts[i + 1], pts[0]))); n = norm(n);
    if (quality && pts.length > 3) { const c = mul(pts.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / pts.length); for (let i = 0; i < pts.length; i++) push(c, pts[i], pts[(i + 1) % pts.length], n, f.cut); }
    else for (let i = 1; i + 1 < pts.length; i++) push(pts[0], pts[i], pts[i + 1], n, f.cut);
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm), cut: Uint8Array.from(cut), minQ, area, cutArea, tris };
}

// ---------------------------------------------------------------------------------------------------- budget
// Crack area the impact can pay for, and the piece count that area corresponds to. Only ~2 % of impact energy goes
// into new surface; the rest is kinetic. Stored energy (tempered glass) is released over the whole volume.
export function budget(source, recipe) {
  const m = MATERIALS[recipe.Material], solidVolume = source.kind === 'convex' ? source.volume : source.area * 0.004;
  const energy = recipe.Energy * 0.02 + (recipe.Energy > 0 ? m.stored * solidVolume * 0.02 : 0);
  const crackArea = energy / (2 * m.Gc);
  const unit = 0.0075 * Math.pow(Math.max(1e-6, solidVolume), 2 / 3);
  const requested = recipe.Energy <= 0 ? 1 : Math.max(1, Math.round(1 + crackArea / unit));
  const target = Math.min(recipe.Ceiling, requested);
  return { energy, crackArea, requested, target, capped: requested > recipe.Ceiling, falloff: Math.max(source.bounds.size[0], source.bounds.size[1], source.bounds.size[2]) * (0.22 + 0.45 * Math.min(1, recipe.Energy / 20000)) };
}

// ---------------------------------------------------------------------------------------------------- fracture
export function fracture(source, input) {
  const t0 = performance.now();
  const recipe = normalizeRecipe(input), m = MATERIALS[recipe.Material], rnd = random(recipe.Seed);
  const B = source.bounds, size = Math.max(B.size[0], B.size[1], B.size[2]);
  const impact = [recipe.X, recipe.Y, recipe.Z];
  const plan = budget(source, recipe);
  const grain = Math.sqrt(m.grain); // Voronoi metric: compress X so cells stretch along the grain
  const S = [1 / grain, 1, 1];
  const metric = (a, b) => Math.hypot((a[0] - b[0]) * S[0], (a[1] - b[1]) * S[1], (a[2] - b[2]) * S[2]);
  const log = [];
  const stats = { candidates: 0, refusedSpan: 0, refusedNeedle: 0, refusedOutside: 0 };

  const inside = (p) => source.kind !== 'convex' || source.planes.every(([n, d]) => dot(n, p) <= d - 1e-4);
  const surfacePoint = () => {
    let r = rnd() * source.area, t = 0; const A = source.areas;
    for (; t < A.length - 1 && r > A[t]; t++) r -= A[t];
    const P = source.record.positions, I = source.record.indices, a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    let u = rnd(), v = rnd(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    return [0, 1, 2].map((k) => P[a + k] + (P[b + k] - P[a + k]) * u + (P[c + k] - P[a + k]) * v);
  };
  const uniformPoint = () => source.kind === 'mesh' ? surfacePoint() : B.lo.map((lo, k) => lo + rnd() * B.size[k]);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
  // Plate axes for radial (glass) patterns: the two largest extents.
  const axes = [0, 1, 2].sort((a, b) => B.size[b] - B.size[a]);

  const candidate = () => {
    if (rnd() > m.cluster) return uniformPoint();
    if (m.mode === 'plate-brittle') {
      const theta = rnd() * Math.PI * 2, rMax = size * 0.62, step = rMax / 5;
      let r = rMax * Math.pow(rnd(), 1.7);
      r = r + (Math.round(r / step) * step - r) * m.ring;
      const p = impact.slice(); p[axes[0]] += Math.cos(theta) * r; p[axes[1]] += Math.sin(theta) * r; p[axes[2]] = B.lo[axes[2]] + rnd() * B.size[axes[2]];
      return source.kind === 'mesh' ? nearestSurface(p) : p;
    }
    const sigma = plan.falloff * 0.55;
    const p = [impact[0] + gauss() * sigma * grain, impact[1] + gauss() * sigma, impact[2] + gauss() * sigma];
    return source.kind === 'mesh' ? nearestSurface(p) : p;
  };
  const nearestSurface = (p) => {
    // Snap a free point to the closest triangle centroid (cheap surface projection for shells).
    let best = 0, bd = Infinity; const C = source.centroids;
    for (let t = 0; t < C.length / 3; t += 1) { const dx = C[t * 3] - p[0], dy = C[t * 3 + 1] - p[1], dz = C[t * 3 + 2] - p[2], d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = t; } }
    return [C[best * 3], C[best * 3 + 1], C[best * 3 + 2]];
  };

  // Candidates ranked by cut priority (closer to the impact first), jittered so the pattern is not a perfect ring.
  let seeds = [];
  if (plan.target > 1) {
    const pool = [];
    const want = Math.min(4000, plan.target * 14);
    for (let i = 0, tries = 0; pool.length < want && tries < want * 6; tries++) {
      const p = candidate(); stats.candidates++;
      if (!inside(p)) { stats.refusedOutside++; continue; }
      const d = metric(p, impact), priority = Math.exp(-d / plan.falloff) * (0.55 + 0.45 * rnd());
      pool.push({ p, priority, d }); i++;
    }
    pool.sort((a, b) => b.priority - a.priority);
    const span = recipe.MinimumSize;
    for (const c of pool) {
      if (seeds.length >= plan.target) break;
      if (seeds.some((s) => metric(s.p, c.p) < span * 2)) { stats.refusedSpan++; continue; }
      seeds.push(c);
    }
  }
  if (seeds.length < 2) seeds = [{ p: source.kind === 'mesh' ? B.centre : [0, 0, 0], priority: 1, d: 0 }];
  log.push(`budget  ${plan.energy.toFixed(0)} J into surface → ${plan.crackArea.toFixed(3)} m² crack area → ${plan.requested} pieces requested${plan.capped ? ` · capped at ${recipe.Ceiling}` : ''}`);

  let pieces = source.kind === 'convex' ? convexCells(source, seeds, S, recipe) : surfacePatches(source, seeds, S);
  if (source.kind === 'convex' && recipe.NeedleRejection && pieces.length > 2) {
    const needles = pieces.filter((p) => p.span < recipe.MinimumSize);
    if (needles.length) {
      const drop = new Set(needles.map((p) => p.seed)), kept = seeds.filter((s, i) => !drop.has(i));
      if (kept.length >= 2) { stats.refusedNeedle = needles.length; seeds = kept; pieces = convexCells(source, seeds, S, recipe); }
      if (stats.refusedNeedle) log.push(`needles ${needles.length} cell(s) thinner than ${(recipe.MinimumSize * 1000).toFixed(0)} mm merged into their neighbours`);
    }
  }

  // Display meshes + receipt numbers.
  let minQ = 1, tris = 0, vertices = 0, cutArea = 0, volume = 0;
  pieces.forEach((pc, i) => {
    pc.id = i;
    pc.distance = metric(pc.centre, impact);
    pc.priority = Math.exp(-pc.distance / plan.falloff);
    pc.mass = source.kind === 'convex' ? pc.volume * m.density : pc.area * 0.004 * m.density;
    if (pc.minQ < minQ) minQ = pc.minQ;
    tris += pc.tris; vertices += pc.tris * 3; cutArea += pc.cutArea || 0; volume += pc.volume || 0;
  });
  const volumes = pieces.map((p) => (source.kind === 'convex' ? p.volume : p.area));
  const ms = performance.now() - t0;
  log.push(`cells   ${pieces.length} ${source.kind === 'convex' ? 'closed convex cells' : 'open surface patches'} · ${tris.toLocaleString()} tris · ${ms.toFixed(0)} ms`);
  if (stats.refusedSpan) log.push(`span    ${stats.refusedSpan} candidate seed(s) refused — closer than ${(recipe.MinimumSize * 2000).toFixed(0)} mm to an accepted seed`);
  return {
    recipe, source, pieces, impact, plan, ms, log, stats,
    metrics: {
      pieces: pieces.length, tris, vertices, minQ: source.kind === 'convex' ? minQ : null,
      occupied: source.kind === 'convex' ? (volume / source.volume) * 100 : null,
      closed: source.kind === 'convex' && recipe.ClosedCaps,
      cutArea, smallest: Math.min(...volumes), largest: Math.max(...volumes),
      bytes: vertices * 24 + pieces.length * 64,
      refused: stats.refusedSpan + stats.refusedNeedle,
    },
  };
}

function convexCells(source, seeds, S, recipe) {
  const S2 = S.map((s) => s * s), sp = seeds.map((s) => [s.p[0] * S[0], s.p[1] * S[1], s.p[2] * S[2]]);
  const out = [];
  seeds.forEach((seed, i) => {
    const order = seeds.map((_, j) => j).filter((j) => j !== i).sort((a, b) => dist2(sp[a], sp[i]) - dist2(sp[b], sp[i]));
    let poly = source.poly, R = radius(poly, seed.p, S);
    for (const j of order) {
      const dm = Math.sqrt(dist2(sp[j], sp[i]));
      if (dm * 0.5 > R) break;
      const a = seed.p, b = seeds[j].p;
      let n = [(b[0] - a[0]) * S2[0], (b[1] - a[1]) * S2[1], (b[2] - a[2]) * S2[2]];
      let d = (dot(sp[j], sp[j]) - dot(sp[i], sp[i])) / 2;
      const l = len(n); n = mul(n, 1 / l); d /= l;
      const next = clip(poly, n, d, true);
      if (!next) { poly = null; break; }
      if (next !== poly) { poly = next; R = radius(poly, seed.p, S); }
    }
    if (!poly) return;
    const volume = polyVolume(poly);
    if (volume < 1e-9) return;
    const tri = triangulate(poly, recipe.QualityTriangulation, recipe.ClosedCaps);
    const b = boundsOf(poly), centre = centroid(poly);
    // Thinnest direction ≈ twice the smallest seed-to-face distance (inscribed thickness).
    let thin = Infinity;
    for (const f of poly) { if (!f.cut) continue; const p = f.pts; let n = [0, 0, 0]; for (let k = 1; k + 1 < p.length; k++) n = add(n, cross(sub(p[k], p[0]), sub(p[k + 1], p[0]))); n = norm(n); const c = mul(p.reduce((s, q) => add(s, q), [0, 0, 0]), 1 / p.length); thin = Math.min(thin, Math.abs(dot(n, sub(c, centre)))); }
    out.push({ seed: i, seedPoint: seed.p, poly, volume, centre, bounds: b, span: thin * 2, faces: poly.length, cutFaces: poly.filter((f) => f.cut).length,
      positions: tri.positions, normals: tri.normals, cut: tri.cut, minQ: tri.minQ, tris: tri.tris, area: tri.area, cutArea: tri.cutArea });
  });
  return out;
}
function surfacePatches(source, seeds, S) {
  const C = source.centroids, T = C.length / 3, owner = new Int32Array(T), P = source.record.positions, I = source.record.indices, CN = source.record.cornerNormals;
  for (let t = 0; t < T; t++) {
    let best = 0, bd = Infinity;
    for (let s = 0; s < seeds.length; s++) { const p = seeds[s].p, dx = (C[t * 3] - p[0]) * S[0], dy = C[t * 3 + 1] - p[1], dz = C[t * 3 + 2] - p[2], d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = s; } }
    owner[t] = best;
  }
  const buckets = seeds.map(() => []);
  for (let t = 0; t < T; t++) buckets[owner[t]].push(t);
  const out = [];
  buckets.forEach((list, s) => {
    if (!list.length) return;
    const pos = new Float32Array(list.length * 9), nrm = new Float32Array(list.length * 9);
    let area = 0; const c = [0, 0, 0]; const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    list.forEach((t, k) => {
      for (let j = 0; j < 3; j++) {
        const v = I[t * 3 + j] * 3;
        for (let a = 0; a < 3; a++) { const x = P[v + a]; pos[k * 9 + j * 3 + a] = x; if (x < lo[a]) lo[a] = x; if (x > hi[a]) hi[a] = x; nrm[k * 9 + j * 3 + a] = CN ? CN[(t * 3 + j) * 3 + a] : 0; }
      }
      area += source.areas[t]; for (let a = 0; a < 3; a++) c[a] += C[t * 3 + a] * source.areas[t];
    });
    out.push({ seed: s, seedPoint: seeds[s].p, triangles: list, volume: 0, area, centre: mul(c, 1 / (area || 1)), bounds: { lo, hi, centre: lo.map((v, k) => (v + hi[k]) / 2), size: hi.map((v, k) => v - lo[k]) },
      span: Math.min(...hi.map((v, k) => v - lo[k])), faces: list.length, cutFaces: 0, positions: pos, normals: nrm, cut: new Uint8Array(list.length), minQ: 1, tris: list.length, cutArea: 0 });
  });
  return out;
}
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
function radius(poly, c, S) { let r = 0; for (const f of poly) for (const p of f.pts) r = Math.max(r, Math.hypot((p[0] - c[0]) * S[0], (p[1] - c[1]) * S[1], (p[2] - c[2]) * S[2])); return r; }
function centroid(poly) {
  let v = 0; const c = [0, 0, 0], o = poly[0].pts[0];
  for (const f of poly) for (let i = 1; i + 1 < f.pts.length; i++) {
    const a = f.pts[0], b = f.pts[i], d = f.pts[i + 1], w = dot(sub(a, o), cross(sub(b, o), sub(d, o))) / 6;
    v += w; for (let k = 0; k < 3; k++) c[k] += w * (o[k] + a[k] + b[k] + d[k]) / 4;
  }
  return v ? mul(c, 1 / v) : poly[0].pts[0];
}

// Size distribution for the quality card: log-spaced bins of piece volume (or patch area).
export function histogram(result, bins = 12) {
  const values = result.pieces.map((p) => (result.source.kind === 'convex' ? p.volume : p.area)).filter((v) => v > 0);
  if (!values.length) return { counts: [], lo: 0, hi: 0 };
  const lo = Math.log10(Math.min(...values)), hi = Math.log10(Math.max(...values)) + 1e-9;
  const counts = new Array(bins).fill(0);
  for (const v of values) counts[Math.min(bins - 1, Math.floor(((Math.log10(v) - lo) / (hi - lo || 1)) * bins))]++;
  return { counts, lo: 10 ** lo, hi: 10 ** hi };
}

// Ray against the source surface (local space) for impact placement.
export function raySource(source, origin, dir) {
  let best = Infinity, hit = null;
  const test = (a, b, c) => {
    const e1 = sub(b, a), e2 = sub(c, a), p = cross(dir, e2), det = dot(e1, p);
    if (Math.abs(det) < 1e-12) return;
    const inv = 1 / det, s = sub(origin, a), u = dot(s, p) * inv; if (u < 0 || u > 1) return;
    const q = cross(s, e1), v = dot(dir, q) * inv; if (v < 0 || u + v > 1) return;
    const t = dot(e2, q) * inv; if (t > 1e-5 && t < best) { best = t; hit = add(origin, mul(dir, t)); }
  };
  if (source.kind === 'convex') { const P = source.positions; for (let i = 0; i < P.length; i += 9) test([P[i], P[i + 1], P[i + 2]], [P[i + 3], P[i + 4], P[i + 5]], [P[i + 6], P[i + 7], P[i + 8]]); }
  else { const P = source.record.positions, I = source.record.indices; for (let t = 0; t < I.length; t += 3) test([P[I[t] * 3], P[I[t] * 3 + 1], P[I[t] * 3 + 2]], [P[I[t + 1] * 3], P[I[t + 1] * 3 + 1], P[I[t + 1] * 3 + 2]], [P[I[t + 2] * 3], P[I[t + 2] * 3 + 1], P[I[t + 2] * 3 + 2]]); }
  return hit;
}

// Default impact: on the surface, facing the default camera (front-right, slightly above).
export function defaultImpact(source) {
  const B = source.bounds, c = B.centre, r = Math.max(...B.size);
  const origin = [c[0] + r * 1.2, c[1] + r * 0.6, c[2] + r * 1.6], dir = norm(sub(c, origin));
  return raySource(source, origin, dir) || c;
}
