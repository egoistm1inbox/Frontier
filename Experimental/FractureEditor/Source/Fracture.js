// Voronoi fracture of analytical primitives.
//
//   1. Budget. Impact energy buys crack area at 2·Gc per m² (only ~2 % of the energy becomes new surface), which sets
//      how many pieces the impact can pay for, capped by the ceiling.
//   2. Seeds. Candidates cluster around the impact (Gaussian for bulk materials, rings and spokes for glass, stretched
//      along the grain for wood) and are accepted only where the exact signed distance says they are inside.
//   3. Cells. Each seed's Voronoi cell is a convex polyhedron: a bounding box clipped by bisector planes.
//   4. Pieces. A cell is intersected with every convex part of the primitive it overlaps. For segmented primitives
//      (torus, pipe) the chunks of one cell are rejoined across shared seam faces with a union-find, so a piece is
//      every connected region of its cell. Two chunks on either side of seam k belong together exactly when both
//      have a seam face on plane k, because the cell meets that plane in one convex region.
// Every face keeps where it came from: 'surface' faces are shaded with the exact normal of their surface group,
// 'cut' faces are the new fracture surface, 'seam' faces are internal and never drawn. Volume is conserved exactly.
import { primitiveParts, signedDistance, exactVolume, exactArea, describe, primitiveById, normalizeDims, traceSurface } from './Primitives.js';

export const MATERIALS = {
  concrete: { label: 'Concrete', mode: 'bulk-brittle', density: 2350, Gc: 140, stored: 0, grain: 1, cluster: 0.65, ring: 0.22, color: [0.62, 0.62, 0.59], interior: [0.49, 0.48, 0.45],
    note: 'Energy-limited bulk cuts concentrated around the impact. Reinforcement is not represented.' },
  rock: { label: 'Stone', mode: 'bulk-brittle', density: 2700, Gc: 95, stored: 0, grain: 1, cluster: 0.55, ring: 0.18, color: [0.49, 0.48, 0.47], interior: [0.58, 0.54, 0.5],
    note: 'Brittle stone with its own crack resistance. Bedding planes are not simulated.' },
  wood: { label: 'Wood', mode: 'fibrous', density: 520, Gc: 320, stored: 0, grain: 11, cluster: 0.35, ring: 0.05, color: [0.71, 0.52, 0.29], interior: [0.85, 0.71, 0.49],
    note: 'Local X grain: cells stretch along the grain, so splits run lengthwise.' },
  glass: { label: 'Glass', mode: 'plate-brittle', density: 2500, Gc: 7, stored: 0, grain: 1, cluster: 0.8, ring: 0.42, color: [0.78, 0.88, 0.9], interior: [0.62, 0.79, 0.82],
    note: 'Brittle and radial. Panes split through their thickness in rings and spokes around the impact.' },
  tempered: { label: 'Tempered', mode: 'plate-brittle', density: 2500, Gc: 7, stored: 46000, grain: 1, cluster: 0.08, ring: 0.5, color: [0.72, 0.85, 0.88], interior: [0.58, 0.76, 0.8],
    note: 'Stored elastic energy (46 kJ/m³) dices the whole part into near-uniform pieces.' },
  plastic: { label: 'ABS plastic', mode: 'ductile', density: 1050, Gc: 460, stored: 0, grain: 1, cluster: 0.5, ring: 0.1, color: [0.85, 0.33, 0.18], interior: [0.94, 0.72, 0.64],
    note: 'High crack resistance keeps fragments few and large. Denting is not simulated.' },
};
export const MATERIAL_ORDER = ['concrete', 'rock', 'wood', 'glass', 'tempered', 'plastic'];

// Method: 'baked' cuts the pieces ahead of time at full quality (the pattern is fixed, nothing runs at impact);
// 'realtime' cuts at the moment of impact in one pass, with the piece count capped to fit Budget milliseconds.
export const METHODS = {
  baked: { label: 'Baked', lead: 'Pre-fractured in the editor', pattern: 'Fixed at bake', quality: 'Full · needle rejection, quality fans' },
  realtime: { label: 'Realtime', lead: 'Fractured at the moment of impact', pattern: 'Follows every hit', quality: 'One pass · plain fans · budget-capped' },
};
export const BUDGETS = [4, 8, 16, 33];
// Fracture algorithms. Each one only proposes convex cells (from seeds or from cutting planes); every cell then goes
// through the same carving, seam rejoining and meshing, so volume is conserved whichever one is used. Some are only
// offered for one method: Uniform and Brick fill the whole part (too many cells to cut at impact); Recursive split
// spends cuts one at a time, which suits a realtime budget.
export const ALGORITHMS = {
  voronoi: { label: 'Clustered Voronoi', glyph: 'alg-voronoi', methods: ['baked', 'realtime'], seeded: true, lead: 'Cells crowd the hit; the material shapes them' },
  uniform: { label: 'Uniform Voronoi', glyph: 'alg-uniform', methods: ['baked'], seeded: true, lead: 'Even cells through the whole part' },
  radial: { label: 'Radial', glyph: 'alg-radial', methods: ['baked', 'realtime'], seeded: true, lead: 'Spokes and rings around the impact axis' },
  slices: { label: 'Planar slices', glyph: 'alg-slices', methods: ['baked', 'realtime'], seeded: false, lead: 'Straight through-cuts crossing near the hit' },
  brick: { label: 'Brick', glyph: 'alg-brick', methods: ['baked'], seeded: false, lead: 'Staggered courses, halved near the hit' },
  split: { label: 'Recursive split', glyph: 'alg-split', methods: ['realtime'], seeded: false, lead: 'Halve the piece nearest the hit, repeat' },
};
export const algorithmsFor = (method) => Object.keys(ALGORITHMS).filter((k) => ALGORITHMS[k].methods.includes(method));
export const IMPACTOR_DENSITY = 7850; // the impactor is a steel ball: its size and the energy give its mass and speed
// Material is the inside (bulk) material: it decides density, crack resistance and the pattern, and colours the cut
// faces. Surface is the outside material: it colours the original surface only.
export const DEFAULT_RECIPE = { Material: 'concrete', Surface: 'concrete', Energy: 2500, Seed: 42, Ceiling: 48, MinimumSize: 0.045, X: 0, Y: 0, Z: 0, NeedleRejection: true, ClosedCaps: true, QualityTriangulation: true, Method: 'baked', Budget: 16,
  Algorithm: 'voronoi', ImpactRadius: 0.05, DirMode: 'normal', DirYaw: 30, DirPitch: 25 };
export const LIMITS = { Energy: [0, 50000], Seed: [1, 999999], Ceiling: [2, 160], MinimumSize: [0.002, 0.3], Budget: [1, 100], ImpactRadius: [0.005, 0.5], DirYaw: [-180, 180], DirPitch: [-89, 89] };

export function normalizeRecipe(input = {}) {
  const r = { ...DEFAULT_RECIPE, ...(input && typeof input === 'object' ? input : {}) };
  if (!MATERIALS[r.Material]) r.Material = 'concrete';
  if (!MATERIALS[r.Surface]) r.Surface = r.Material;
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) { const v = +r[k]; r[k] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : DEFAULT_RECIPE[k]; }
  if (!METHODS[r.Method]) r.Method = 'baked';
  if (!algorithmsFor(r.Method).includes(r.Algorithm)) r.Algorithm = algorithmsFor(r.Method)[0];
  if (r.DirMode !== 'custom') r.DirMode = 'normal';
  r.Seed = Math.round(r.Seed); r.Ceiling = Math.round(r.Ceiling);
  for (const k of ['X', 'Y', 'Z']) r[k] = Number.isFinite(+r[k]) ? +r[k] : 0;
  for (const k of ['NeedleRejection', 'ClosedCaps', 'QualityTriangulation']) r[k] = r[k] !== false;
  return r;
}
export function random(seed) { let a = seed >>> 0 || 1; return () => { a = (Math.imul(1664525, a) + 1013904223) >>> 0; return a / 4294967296; }; }

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ---------------------------------------------------------------------------------------------------- polyhedra
// A polyhedron is a list of faces { pts (CCW from outside), tag, group }.
function boxPoly(lo, hi) {
  const v = (i, j, k) => [i ? hi[0] : lo[0], j ? hi[1] : lo[1], k ? hi[2] : lo[2]], f = (pts) => ({ pts, tag: 'outside', group: '' });
  return [
    f([v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)]), f([v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)]),
    f([v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)]), f([v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)]),
    f([v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)]), f([v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)]),
  ];
}

// Keep n·p ≤ d. Returns the clipped polyhedron, the same array if untouched, or null if nothing is left.
// The new cap face takes `tag` and `group`.
export function clip(poly, n, d, tag, group) {
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
    if (np.length >= 3) out.push({ pts: np, tag: face.tag, group: face.group });
  }
  if (!touched) return poly;
  if (!out.length) return null;
  const unique = [];
  for (const p of cap) if (!unique.some((q) => Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) < 1e-7)) unique.push(p);
  if (unique.length >= 3) {
    const c = mul(unique.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / unique.length);
    const u = norm(Math.abs(n[0]) < 0.9 ? cross(n, [1, 0, 0]) : cross(n, [0, 1, 0])), v = cross(n, u);
    unique.sort((p, q) => Math.atan2(dot(sub(p, c), v), dot(sub(p, c), u)) - Math.atan2(dot(sub(q, c), v), dot(sub(q, c), u)));
    out.push({ pts: unique, tag, group });
  }
  return out;
}
function clipPart(poly, part) {
  for (const pl of part.planes) { poly = clip(poly, pl.n, pl.d, pl.tag, pl.group); if (!poly) return null; }
  return poly;
}

function polyVolume(poly) {
  let v = 0; const o = poly[0].pts[0];
  for (const f of poly) for (let i = 1; i + 1 < f.pts.length; i++) v += dot(sub(f.pts[0], o), cross(sub(f.pts[i], o), sub(f.pts[i + 1], o))) / 6;
  return v;
}
function polyCentroid(poly) {
  let v = 0; const c = [0, 0, 0], o = poly[0].pts[0];
  for (const f of poly) for (let i = 1; i + 1 < f.pts.length; i++) {
    const a = f.pts[0], b = f.pts[i], e = f.pts[i + 1], w = dot(sub(a, o), cross(sub(b, o), sub(e, o))) / 6;
    v += w; for (let k = 0; k < 3; k++) c[k] += (w * (o[k] + a[k] + b[k] + e[k])) / 4;
  }
  return { volume: v, centre: v ? mul(c, 1 / v) : poly[0].pts[0] };
}
function faceNormal(pts) { let n = [0, 0, 0]; for (let i = 1; i + 1 < pts.length; i++) n = add(n, cross(sub(pts[i], pts[0]), sub(pts[i + 1], pts[0]))); return n; }
// Drop polygon corners closer than 0.2 mm to the previous one: clipping leaves near-duplicates that only make slivers.
function weld(pts) {
  const out = [];
  for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) > 2e-4) out.push(p); }
  while (out.length > 1) { const q = out[out.length - 1], p = out[0]; if (Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) > 2e-4) break; out.pop(); }
  return out;
}

// Triangle soup for drawing: positions, per-corner normals (exact for curved surface groups, flat for cuts) and a
// per-triangle cut flag. Quality mode fans from the face centroid so long fans do not make slivers.
class Soup {
  constructor() { this.pos = []; this.nrm = []; this.cut = []; this.minQ = 1; this.area = 0; this.cutArea = 0; this.tris = 0; }
  add(poly, normals, { quality = true, caps = true } = {}) {
    for (const f of poly) {
      if (f.tag === 'seam' || f.tag === 'outside') continue;
      const isCut = f.tag === 'cut';
      if (isCut && !caps) continue;
      const pts = weld(f.pts); if (pts.length < 3) continue;
      const fn = faceNormal(pts); if (len(fn) < 2e-10) continue;
      const flat = norm(fn), smooth = !isCut && normals[f.group];
      const nrm = (p) => { if (!smooth) return flat; const s = smooth(p); return dot(s, flat) > 0.2 ? s : flat; };
      const tri = (a, b, c) => this.tri(a, b, c, nrm(a), nrm(b), nrm(c), isCut);
      if (quality && pts.length > 3) { const c = mul(pts.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / pts.length); for (let i = 0; i < pts.length; i++) tri(c, pts[i], pts[(i + 1) % pts.length]); }
      else for (let i = 1; i + 1 < pts.length; i++) tri(pts[0], pts[i], pts[i + 1]);
    }
  }
  tri(a, b, c, na, nb, nc, isCut) {
    const e0 = sub(b, a), e1 = sub(c, b), e2 = sub(a, c), A = len(cross(e0, sub(c, a))) / 2;
    if (A < 1e-12) return;
    const q = (4 * Math.sqrt(3) * A) / (dot(e0, e0) + dot(e1, e1) + dot(e2, e2));
    if (q < this.minQ) this.minQ = q;
    this.area += A; if (isCut) this.cutArea += A; this.tris++;
    this.pos.push(...a, ...b, ...c); this.nrm.push(...na, ...nb, ...nc); this.cut.push(isCut ? 1 : 0);
  }
  finish() { return { positions: new Float32Array(this.pos), normals: new Float32Array(this.nrm), cut: Uint8Array.from(this.cut), minQ: this.minQ, area: this.area, cutArea: this.cutArea, tris: this.tris }; }
}

// ---------------------------------------------------------------------------------------------------- source
export function buildSource(id, dims, detail = 'medium') {
  const spec = primitiveById(id), d = normalizeDims(spec.id, dims), t0 = performance.now();
  const { parts, normals, segmented, segments } = primitiveParts(spec.id, d, detail);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p.lo[k]); hi[k] = Math.max(hi[k], p.hi[k]); }
  const pad = 0.02 + 0.05 * Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const blo = lo.map((v) => v - pad), bhi = hi.map((v) => v + pad);
  const soup = new Soup();
  let volume = 0, faces = 0;
  for (const part of parts) {
    part.poly = clipPart(boxPoly(blo, bhi), part);
    if (!part.poly) continue;
    part.volume = polyVolume(part.poly); volume += part.volume; faces += part.poly.filter((f) => f.tag === 'surface').length;
    soup.add(part.poly, normals, { quality: true });
  }
  const mesh = soup.finish(), exact = exactVolume(spec.id, d);
  const bounds = { lo, hi, centre: lo.map((v, k) => (v + hi[k]) / 2), size: hi.map((v, k) => v - lo[k]) };
  bounds.radius = Math.hypot(...bounds.size) / 2;
  return {
    id: spec.id, key: `${spec.id}:${detail}:${JSON.stringify(d)}`, label: spec.label, note: describe(spec.id, d), icon: spec.icon, formula: spec.formula,
    dims: d, detail, parts, surfaceNormals: normals, segmented, segments, bounds, box: { lo: blo, hi: bhi },
    volume, exactVolume: exact, faceting: (volume - exact) / exact, area: mesh.area, exactArea: exactArea(spec.id, d), faces,
    thin: !!spec.thin, convex: spec.convex, positions: mesh.positions, normals: mesh.normals, tris: mesh.tris, ms: performance.now() - t0,
    sdf: (p) => signedDistance(spec.id, d, p),
    trace: (o, dir) => traceSurface(spec.id, d, o, dir),
  };
}

// Inside the faceted solid (what actually gets cut), with a small margin so seeds never sit on a face.
function insideSolid(source, p, margin = 1e-4) {
  return source.parts.some((part) => p[0] >= part.lo[0] - 1e-9 && p[0] <= part.hi[0] + 1e-9 && p[1] >= part.lo[1] - 1e-9 && p[1] <= part.hi[1] + 1e-9 && p[2] >= part.lo[2] - 1e-9 && p[2] <= part.hi[2] + 1e-9
    && part.planes.every((pl) => pl.tag === 'seam' ? dot(pl.n, p) <= pl.d + 1e-12 : dot(pl.n, p) <= pl.d - margin));
}

// ---------------------------------------------------------------------------------------------------- impactor
export function surfaceNormal(source, p) {
  const e = 1e-4, f = (x, y, z) => source.sdf([x, y, z]);
  return norm([f(p[0] + e, p[1], p[2]) - f(p[0] - e, p[1], p[2]), f(p[0], p[1] + e, p[2]) - f(p[0], p[1] - e, p[2]), f(p[0], p[1], p[2] + e) - f(p[0], p[1], p[2] - e)]);
}
// Travel direction from yaw (about Y; 0 = moving towards −Z) and pitch (positive = coming down from above).
export function travelFromAngles(yawDeg, pitchDeg) {
  const y = (yawDeg * Math.PI) / 180, p = (pitchDeg * Math.PI) / 180;
  return [-Math.cos(p) * Math.sin(y), -Math.sin(p), -Math.cos(p) * Math.cos(y)];
}
export function anglesFromTravel(t) { return { yaw: (Math.atan2(-t[0], -t[2]) * 180) / Math.PI, pitch: (Math.asin(Math.max(-1, Math.min(1, -t[1]))) * 180) / Math.PI }; }
// Where the blow goes: along the inward surface normal, or a custom travel direction. `cos` is the normal component
// of the blow (1 = head-on, 0 = grazing); only that share of the energy opens cracks.
export function impactDirection(source, recipe, point = [recipe.X, recipe.Y, recipe.Z]) {
  const normal = surfaceNormal(source, point);
  const travel = recipe.DirMode === 'custom' ? travelFromAngles(recipe.DirYaw, recipe.DirPitch) : mul(normal, -1);
  return { travel, normal, cos: Math.max(0, -dot(travel, normal)) };
}
export function impactor(recipe) {
  const mass = IMPACTOR_DENSITY * (4 / 3) * Math.PI * recipe.ImpactRadius ** 3;
  return { mass, speed: Math.sqrt((2 * Math.max(0, recipe.Energy)) / mass) };
}
const basis = (n) => { const u = norm(Math.abs(n[1]) < 0.9 ? cross(n, [0, 1, 0]) : cross(n, [1, 0, 0])); return [u, cross(n, u)]; };

// ---------------------------------------------------------------------------------------------------- budget
export function budget(source, recipe, normalShare = 1) {
  const m = MATERIALS[recipe.Material], blow = 0.25 + 0.75 * normalShare; // an oblique blow opens fewer cracks
  const energy = recipe.Energy * 0.02 * blow + (recipe.Energy > 0 ? m.stored * source.volume * 0.02 : 0);
  const crackArea = energy / (2 * m.Gc);
  const unit = 0.0075 * Math.pow(Math.max(1e-6, source.volume), 2 / 3);
  const requested = recipe.Energy <= 0 ? 1 : Math.max(1, Math.round(1 + crackArea / unit));
  const target = Math.min(recipe.Ceiling, requested);
  const size = Math.max(...source.bounds.size);
  return { energy, crackArea, requested, target, capped: requested > recipe.Ceiling, blow, falloff: size * (0.15 + 0.42 * Math.min(1, recipe.Energy / 20000)) + recipe.ImpactRadius * 1.5 };
}

// ---------------------------------------------------------------------------------------------------- realtime cost
// Cutting time is close to linear in the cell count: a fixed cost for the shape (clipping every convex part and its
// facets) plus a cost per cell. Both are fitted per shape from the last fractures this page ran, so the realtime cap
// reflects this machine. Until the counts vary enough to fit a slope, a typical slope is assumed.
const COST_SAMPLES = new Map(); // source.key → [[cells, ms], …]
const PRIOR_PER_CELL = 0.6;
export function cellCost(source, algorithm = 'voronoi') {
  const list = COST_SAMPLES.get(`${source.key}|${algorithm}`) || [];
  if (!list.length) return { base: 0.25 * source.parts.length + 0.5, per: PRIOR_PER_CELL };
  const n = list.length, mx = list.reduce((a, p) => a + p[0], 0) / n, my = list.reduce((a, p) => a + p[1], 0) / n;
  const sxx = list.reduce((a, p) => a + (p[0] - mx) ** 2, 0), sxy = list.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0);
  const per = sxx / n > 9 ? Math.max(0.05, sxy / sxx) : PRIOR_PER_CELL * Math.max(0.25, Math.min(4, my / (0.25 * source.parts.length + 0.5 + PRIOR_PER_CELL * mx)));
  return { base: Math.max(0, my - per * mx), per };
}
function learnCost(source, algorithm, ms, cells) {
  const key = `${source.key}|${algorithm}`, list = COST_SAMPLES.get(key) || [];
  list.push([cells, ms]); if (list.length > 16) list.shift();
  COST_SAMPLES.set(key, list);
}
// How many cells fit the realtime budget: 85 % of it for cutting, the rest for seeding and buffers.
export function realtimeCap(source, recipe) { const c = cellCost(source, normalizeRecipe(recipe).Algorithm); return Math.max(2, Math.floor((recipe.Budget * 0.85 - c.base) / c.per)); }

// ---------------------------------------------------------------------------------------------------- fracture
export function fracture(source, input) {
  const t0 = performance.now();
  const realtime = normalizeRecipe(input).Method === 'realtime';
  // Realtime runs one pass: no needle-rejection re-cut, plain fans. Caps stay on so every piece is closed.
  const recipe = normalizeRecipe(realtime ? { ...input, NeedleRejection: false, QualityTriangulation: false } : input);
  const m = MATERIALS[recipe.Material], rnd = random(recipe.Seed);
  const B = source.bounds, size = Math.max(...B.size), impact = [recipe.X, recipe.Y, recipe.Z];
  const dir = impactDirection(source, recipe, impact), travel = dir.travel, alg = ALGORITHMS[recipe.Algorithm];
  const plan = budget(source, recipe, dir.cos);
  const costBefore = cellCost(source, recipe.Algorithm), cap = realtime ? realtimeCap(source, recipe) : Infinity;
  if (realtime && plan.target > cap) { plan.target = cap; plan.budgetCapped = true; }
  const grain = Math.sqrt(m.grain), S = [1 / grain, 1, 1]; // Voronoi metric: compress X so cells stretch along the grain
  const metric = (a, b) => Math.hypot((a[0] - b[0]) * S[0], (a[1] - b[1]) * S[1], (a[2] - b[2]) * S[2]);
  const stats = { candidates: 0, refusedOutside: 0, refusedSpan: 0, refusedNeedle: 0, chunks: 0, rejoined: 0, split: 0 };
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
  const axes = [0, 1, 2].sort((a, b) => B.size[b] - B.size[a]);
  const uniform = () => B.lo.map((lo, k) => lo + rnd() * B.size[k]);
  const [tu, tv] = basis(travel);
  const clustered = () => {
    if (rnd() > m.cluster) return uniform();
    if (m.mode === 'plate-brittle') {
      const theta = rnd() * Math.PI * 2, rMax = size * 0.62, step = rMax / 5;
      let r = rMax * Math.pow(rnd(), 1.7);
      r += (Math.round(r / step) * step - r) * m.ring;
      const p = impact.slice(); p[axes[0]] += Math.cos(theta) * r; p[axes[1]] += Math.sin(theta) * r;
      if (source.thin) p[axes[2]] = B.lo[axes[2]] + rnd() * B.size[axes[2]]; else p[axes[2]] += gauss() * plan.falloff * 0.3;
      return p;
    }
    // A cone into the part: spread across the blow, deeper along it.
    const sigma = plan.falloff * 0.55, a = gauss() * sigma, b = gauss() * sigma, c = Math.abs(gauss()) * sigma * 1.3 - sigma * 0.15;
    const p = [0, 1, 2].map((k) => impact[k] + tu[k] * a + tv[k] * b + travel[k] * c);
    p[0] = impact[0] + (p[0] - impact[0]) * grain;
    return p;
  };
  // Radial: a centre cell, then rings of spokes around the impact axis (the pane normal on thin parts), denser inside.
  const radialSeeds = () => {
    const axis = source.thin ? [0, 1, 2].map((k) => (k === axes[2] ? 1 : 0)) : travel, [u, v] = basis(axis);
    // On solid parts the pattern repeats in a few layers along the blow, so most rings land inside the material.
    const layers = source.thin ? [0] : [0.2, 0.55, 0.95], rMax = source.thin ? size * 0.62 : Math.min(size * 0.62, plan.falloff * 1.8);
    const rings = Math.max(2, Math.round(Math.sqrt(plan.target / 3))), spokes = Math.max(5, Math.round((plan.target * (source.thin ? 1 : 1.6)) / rings));
    const list = [{ p: impact.map((x, k) => x + travel[k] * plan.falloff * 0.15), priority: 2 }];
    layers.forEach((depth, layer) => {
      for (let k = 0; k < rings; k++) {
        const r = rMax * Math.pow((k + 0.8) / rings, 1.5);
        for (let j = 0; j < spokes; j++) {
          const a = (2 * Math.PI * (j + ((k + layer) % 2) * 0.5 + (rnd() - 0.5) * 0.2)) / spokes, rr = r * (0.92 + rnd() * 0.16);
          const p = [0, 1, 2].map((i) => impact[i] + (u[i] * Math.cos(a) + v[i] * Math.sin(a)) * rr + axis[i] * depth * plan.falloff);
          if (source.thin) p[axes[2]] = B.centre[axes[2]];
          list.push({ p, priority: 1 - k / rings - layer * 0.15 });
        }
      }
    });
    return list;
  };

  const timings = { seeds: 0, cells: 0, needles: 0 };
  let tick = performance.now();
  let seeds = [], polys = null;
  if (!alg.seeded) {
    const args = { source, plan, impact, travel, rnd, gauss };
    polys = plan.target <= 1 ? [tightBox(source)] : recipe.Algorithm === 'slices' ? slicePolys(args) : recipe.Algorithm === 'brick' ? brickPolys(args) : splitPolys(args);
  } else if (plan.target > 1) {
    let candidates = [];
    if (recipe.Algorithm === 'radial') {
      for (const c of radialSeeds()) { stats.candidates++; if (insideSolid(source, c.p)) candidates.push(c); else stats.refusedOutside++; }
    } else {
      const even = recipe.Algorithm === 'uniform', want = Math.min(4000, plan.target * (realtime ? 6 : 14));
      for (let tries = 0; candidates.length < want && tries < want * 8; tries++) {
        const p = even ? uniform() : clustered(); stats.candidates++;
        if (!insideSolid(source, p)) { stats.refusedOutside++; continue; }
        candidates.push({ p, priority: even ? rnd() : Math.exp(-metric(p, impact) / plan.falloff) * (0.55 + 0.45 * rnd()) });
      }
    }
    candidates.sort((a, b) => b.priority - a.priority);
    for (const c of candidates) {
      if (seeds.length >= plan.target) break;
      if (seeds.some((s) => metric(s.p, c.p) < recipe.MinimumSize * 2)) { stats.refusedSpan++; continue; }
      seeds.push(c);
    }
  }
  const single = alg.seeded ? seeds.length < 2 : polys.length < 2;
  if (alg.seeded && single) seeds = [{ p: B.centre.slice(), priority: 1 }];

  timings.seeds = performance.now() - tick; tick = performance.now();
  let pieces = alg.seeded ? cells(source, seeds, S, recipe, stats) : carveAll(source, polys, recipe, stats);
  timings.cells = performance.now() - tick; tick = performance.now();
  learnCost(source, recipe.Algorithm, timings.seeds + timings.cells, alg.seeded ? seeds.length : polys.length);
  if (alg.seeded && recipe.NeedleRejection && pieces.length > 2) {
    const needles = pieces.filter((p) => p.span < recipe.MinimumSize);
    if (needles.length) {
      const drop = new Set(needles.map((p) => p.seed)), kept = seeds.filter((_, i) => !drop.has(i));
      if (kept.length >= 2) { stats.refusedNeedle = drop.size; seeds = kept; for (const k of ['chunks', 'rejoined', 'split']) stats[k] = 0; pieces = cells(source, seeds, S, recipe, stats); }
    }
  }
  const cellCount = alg.seeded ? seeds.length : polys.length;

  timings.needles = performance.now() - tick;
  let minQ = 1, tris = 0, cutArea = 0, volume = 0;
  pieces.sort((a, b) => metric(a.centre, impact) - metric(b.centre, impact));
  pieces.forEach((pc, i) => {
    pc.id = i;
    pc.distance = metric(pc.centre, impact);
    pc.priority = Math.exp(-pc.distance / plan.falloff);
    pc.mass = pc.volume * m.density;
    minQ = Math.min(minQ, pc.minQ); tris += pc.tris; cutArea += pc.cutArea; volume += pc.volume;
  });
  const volumes = pieces.map((p) => p.volume);
  const ms = performance.now() - t0;
  const log = [
    `budget  ${plan.energy.toFixed(0)} J into surface → ${plan.crackArea.toFixed(3)} m² crack area → ${plan.requested} pieces requested${plan.capped ? ` · capped at ${recipe.Ceiling}` : ''}`,
    realtime ? `method  realtime · ${alg.label} · ${recipe.Budget} ms budget fits ${cap} cells at ${costBefore.per.toFixed(2)} ms per cell + ${costBefore.base.toFixed(1)} ms for the shape${plan.budgetCapped ? ' · budget-capped' : ''} · cut in ${ms.toFixed(1)} ms${ms > recipe.Budget ? ' (over budget)' : ''}` : `method  baked · ${alg.label} · full quality, cut ahead of time`,
    `impact  ${recipe.Energy.toFixed(0)} J · Ø ${(recipe.ImpactRadius * 200).toFixed(0)} cm impactor · ${(dir.cos * 100).toFixed(0)} % head-on · ${recipe.DirMode === 'custom' ? `custom yaw ${recipe.DirYaw.toFixed(0)}° pitch ${recipe.DirPitch.toFixed(0)}°` : 'along the surface normal'}`,
    `cells   ${cellCount} ${alg.label} cells → ${pieces.length} closed pieces · ${tris.toLocaleString()} tris · ${ms.toFixed(0)} ms`,
  ];
  if (source.segmented) log.push(`seams   ${stats.chunks} convex chunks across ${source.segments} segments · ${stats.rejoined} rejoined at seams${stats.split ? ` · ${stats.split} cell(s) split into separate pieces` : ''}`);
  if (stats.refusedSpan) log.push(`span    ${stats.refusedSpan} candidate seed(s) refused, closer than ${(recipe.MinimumSize * 2000).toFixed(0)} mm to an accepted seed`);
  if (stats.refusedNeedle) log.push(`needles ${stats.refusedNeedle} cell(s) thinner than ${(recipe.MinimumSize * 1000).toFixed(0)} mm merged into their neighbours`);
  return {
    recipe, source, pieces, impact, plan, ms, log, stats, single, timings, seedCount: cellCount, algorithm: recipe.Algorithm, travel, normal: dir.normal, headOn: dir.cos,
    method: recipe.Method, realtime: realtime ? { budget: recipe.Budget, cap, cost: costBefore, over: ms > recipe.Budget } : null,
    metrics: {
      pieces: pieces.length, cells: cellCount, tris, minQ, occupied: (volume / source.volume) * 100, cutArea,
      smallest: Math.min(...volumes), largest: Math.max(...volumes), mass: volume * m.density, bytes: tris * 3 * 24 + pieces.length * 64,
      refused: stats.refusedSpan + stats.refusedNeedle,
    },
  };
}

function cells(source, seeds, S, recipe, stats) {
  const S2 = S.map((s) => s * s), sp = seeds.map((s) => [s.p[0] * S[0], s.p[1] * S[1], s.p[2] * S[2]]);
  const out = [];
  seeds.forEach((seed, i) => {
    // 3. The cell: bounding box clipped by bisectors, nearest neighbours first, stopping once no bisector can reach.
    const order = seeds.map((_, j) => j).filter((j) => j !== i).sort((a, b) => dist2(sp[a], sp[i]) - dist2(sp[b], sp[i]));
    let cell = boxPoly(source.box.lo, source.box.hi), R = reach(cell, seed.p, S);
    for (const j of order) {
      const dm = Math.sqrt(dist2(sp[j], sp[i]));
      if (dm * 0.5 > R) break;
      const b = seeds[j].p, a = seed.p;
      let n = [(b[0] - a[0]) * S2[0], (b[1] - a[1]) * S2[1], (b[2] - a[2]) * S2[2]], d = (dot(sp[j], sp[j]) - dot(sp[i], sp[i])) / 2;
      const l = len(n); n = mul(n, 1 / l); d /= l;
      const next = clip(cell, n, d, 'cut', 'cut');
      if (!next) { cell = null; break; }
      if (next !== cell) { cell = next; R = reach(cell, seed.p, S); }
    }
    if (cell) carveCell(source, cell, i, seed.p, recipe, stats, out);
  });
  return out;
}

// 4–5. One convex cell ∩ every convex part it overlaps, chunks rejoined across seams, one piece per connected group.
function carveCell(source, cell, i, seedPoint, recipe, stats, out) {
  // 4. Cell ∩ each overlapping convex part.
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const f of cell) for (const p of f.pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  const chunks = [];
  for (const part of source.parts) {
    if (part.lo[0] > hi[0] || part.hi[0] < lo[0] || part.lo[1] > hi[1] || part.hi[1] < lo[1] || part.lo[2] > hi[2] || part.hi[2] < lo[2]) continue;
    const poly = clipPart(cell, part);
    if (!poly) continue;
    const { volume, centre } = polyCentroid(poly);
    if (volume < 1e-10) continue;
    const seams = new Set();
    for (const f of poly) if (f.tag === 'seam' && len(faceNormal(f.pts)) > 2e-8) seams.add(f.group);
    chunks.push({ poly, volume, centre, seams });
  }
  if (!chunks.length) return;
  stats.chunks += chunks.length;
  // Union-find across seams.
  const parent = chunks.map((_, k) => k), find = (k) => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  const bySeam = new Map();
  chunks.forEach((c, k) => { for (const s of c.seams) { if (bySeam.has(s)) { const a = find(bySeam.get(s)), b = find(k); if (a !== b) { parent[a] = b; stats.rejoined++; } } else bySeam.set(s, k); } });
  const groups = new Map();
  chunks.forEach((c, k) => { const r = find(k); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(c); });
  if (groups.size > 1) stats.split += 1;
  for (const list of groups.values()) out.push(piece(source, list, i, seedPoint, recipe));
}
// ---------------------------------------------------------------------------------------------------- plane-cut cells
function splitPoly(poly, n, d) { return [clip(poly, n, d, 'cut', 'cut'), clip(poly, mul(n, -1), -d, 'cut', 'cut')].filter(Boolean); }
// Exact: does this region keep any volume after clipping by an overlapping convex part?
function touchesSolid(source, poly) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const f of poly) for (const p of f.pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  return source.parts.some((part) => !(part.lo[0] > hi[0] || part.hi[0] < lo[0] || part.lo[1] > hi[1] || part.hi[1] < lo[1] || part.lo[2] > hi[2] || part.hi[2] < lo[2])
    && (() => { const c = clipPart(poly, part); return c && polyVolume(c) > 1e-10; })());
}
// Plane-cut cells start from the tight bounds (the Voronoi box is padded, which would waste cuts on empty space).
const tightBox = (source) => { const B = source.bounds, e = 1e-4; return boxPoly(B.lo.map((v) => v - e), B.hi.map((v) => v + e)); };
function cutBox(lo, hi) { return boxPoly(lo, hi).map((f) => ({ ...f, tag: 'cut', group: 'cut' })); }
// Planar slices: random planes through the hit region, mostly running along the blow. Each plane splits the regions
// it crosses, nearest the hit first, until the target count of regions inside the part is reached.
function slicePolys({ source, plan, impact, travel, rnd, gauss }) {
  const [u, v] = basis(travel), spread = plan.falloff * 0.45;
  let items = [{ poly: tightBox(source), touch: true }], count = 1;
  for (let k = 0; k < 60 && count < plan.target; k++) {
    const a = rnd() * Math.PI, tilt = (rnd() - 0.5) * 0.6;
    const n = norm([0, 1, 2].map((i) => u[i] * Math.cos(a) + v[i] * Math.sin(a) + travel[i] * tilt));
    const c = [0, 1, 2].map((i) => impact[i] + (u[i] * gauss() + v[i] * gauss()) * spread + travel[i] * Math.abs(gauss()) * spread);
    const order = items.map((it) => ({ it, dist: len(sub(polyCentroid(it.poly).centre, c)) })).sort((p, q) => p.dist - q.dist).map((o) => o.it);
    const next = new Set(items);
    for (const it of order) {
      if (count >= plan.target) break;
      const halves = splitPoly(it.poly, n, dot(n, c));
      if (halves.length < 2) continue;
      next.delete(it);
      const parts = halves.map((poly) => ({ poly, touch: touchesSolid(source, poly) }));
      for (const p of parts) next.add(p);
      count += parts.filter((p) => p.touch).length - (it.touch ? 1 : 0);
    }
    items = [...next];
  }
  return items.map((it) => it.poly);
}
// Brick: courses along +Y, staggered by half a brick, sized from the part volume; bricks near the hit are halved.
function brickPolys({ source, plan, impact }) {
  const e = 1e-4, B = { lo: source.bounds.lo.map((v) => v - e), hi: source.bounds.hi.map((v) => v + e) }, [along, across] = [0, 2].sort((a, b) => (B.hi[b] - B.lo[b]) - (B.hi[a] - B.lo[a]));
  const build = (s) => {
    const h = s * 0.7, L = s * 1.7, W = Math.min(s * 0.85, B.hi[across] - B.lo[across]), out = [];
    for (let row = 0, y = B.lo[1]; y < B.hi[1] - 1e-9; row++, y += h) {
      for (let z = B.lo[across]; z < B.hi[across] - 1e-9; z += W) {
        for (let x = B.lo[along] - (row % 2) * L * 0.5; x < B.hi[along] - 1e-9; x += L) {
          const lo = [0, 0, 0], hi = [0, 0, 0];
          lo[1] = y; hi[1] = Math.min(B.hi[1], y + h); lo[across] = z; hi[across] = Math.min(B.hi[across], z + W);
          lo[along] = Math.max(B.lo[along], x); hi[along] = Math.min(B.hi[along], x + L);
          const mid = lo.map((v, k) => (v + hi[k]) / 2);
          if (len(sub(mid, impact)) < plan.falloff * 0.7) { const m2 = mid[along]; const a = hi.slice(); a[along] = m2; const b = lo.slice(); b[along] = m2; out.push([lo, a], [b, hi]); }
          else out.push([lo, hi]);
        }
      }
    }
    return out;
  };
  let s = Math.cbrt(source.volume / Math.max(1, plan.target)), boxes = build(s);
  for (let k = 0; k < 24; k++) {
    const inside = boxes.filter(([lo, hi]) => touchesSolid(source, cutBox(lo, hi))).length;
    if (inside <= plan.target) break;
    s *= 1.1; boxes = build(s);
  }
  return boxes.map(([lo, hi]) => cutBox(lo, hi));
}
// Recursive split: halve the region that is biggest and closest to the hit, across its longest side and tilted by the
// blow, until the target count is reached. Each cut is one plane, so the cost per piece is flat.
function splitPolys({ source, plan, impact, travel, rnd }) {
  let items = [{ poly: tightBox(source), touch: true }], count = 1;
  for (let k = 0; k < plan.target * 6 && count < plan.target; k++) {
    let best = null, score = -1;
    for (const it of items) {
      if (!it.touch) continue;
      it.info ||= polyCentroid(it.poly);
      const sc = it.info.volume * Math.exp(-len(sub(it.info.centre, impact)) / plan.falloff);
      if (sc > score) { score = sc; best = it; }
    }
    if (!best) break;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const f of best.poly) for (const p of f.pts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
    const e = [0, 1, 2].reduce((a, i) => (hi[i] - lo[i] > hi[a] - lo[a] ? i : a), 0);
    const n = norm([0, 1, 2].map((i) => (i === e ? 1 : 0) + travel[i] * 0.35 + (rnd() - 0.5) * 0.5));
    const c = best.info.centre.map((v, i) => v + (rnd() - 0.5) * (hi[i] - lo[i]) * 0.2);
    const halves = splitPoly(best.poly, n, dot(n, c));
    if (halves.length < 2) { best.touch = false; continue; }
    const parts = halves.map((poly) => ({ poly, touch: touchesSolid(source, poly) }));
    items.splice(items.indexOf(best), 1, ...parts);
    count += parts.filter((p) => p.touch).length - 1;
  }
  return items.map((it) => it.poly);
}
function carveAll(source, polys, recipe, stats) {
  const out = [];
  polys.forEach((poly, i) => carveCell(source, poly, i, polyCentroid(poly).centre, recipe, stats, out));
  return out;
}

function piece(source, chunks, seed, seedPoint, recipe) {
  const soup = new Soup();
  let volume = 0; const c = [0, 0, 0], lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  let faces = 0, cutFaces = 0;
  for (const ch of chunks) {
    volume += ch.volume; for (let k = 0; k < 3; k++) c[k] += ch.centre[k] * ch.volume;
    soup.add(ch.poly, source.surfaceNormals, { quality: recipe.QualityTriangulation, caps: recipe.ClosedCaps });
    for (const f of ch.poly) { if (f.tag === 'seam') continue; faces++; if (f.tag === 'cut') cutFaces++; for (const p of f.pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); } }
  }
  const centre = mul(c, 1 / volume), mesh = soup.finish();
  // Thickness: twice the smallest distance from the centroid to a cut plane (an inscribed estimate).
  let thin = Infinity;
  for (const ch of chunks) for (const f of ch.poly) {
    if (f.tag !== 'cut') continue;
    const n = norm(faceNormal(f.pts)); thin = Math.min(thin, Math.abs(dot(n, sub(f.pts[0], centre))));
  }
  return {
    seed, seedPoint, chunks: chunks.length, volume, centre, faces, cutFaces, span: thin * 2,
    bounds: { lo, hi, centre: lo.map((v, k) => (v + hi[k]) / 2), size: hi.map((v, k) => v - lo[k]) },
    positions: mesh.positions, normals: mesh.normals, cut: mesh.cut, minQ: mesh.minQ, tris: mesh.tris, area: mesh.area, cutArea: mesh.cutArea,
  };
}
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
function reach(poly, c, S) { let r = 0; for (const f of poly) for (const p of f.pts) r = Math.max(r, Math.hypot((p[0] - c[0]) * S[0], (p[1] - c[1]) * S[1], (p[2] - c[2]) * S[2])); return r; }

// Size distribution: log-spaced bins of piece volume.
export function histogram(result, bins = 14) {
  const values = result.pieces.map((p) => p.volume).filter((v) => v > 0);
  if (!values.length) return { counts: [], lo: 0, hi: 0 };
  const lo = Math.log10(Math.min(...values)), hi = Math.log10(Math.max(...values)) + 1e-9;
  const counts = new Array(bins).fill(0);
  for (const v of values) counts[Math.min(bins - 1, Math.floor(((Math.log10(v) - lo) / (hi - lo || 1)) * bins))]++;
  return { counts, lo: 10 ** lo, hi: 10 ** hi };
}

// Default impact: on the exact surface, facing the default camera (front-right, slightly above).
export function defaultImpact(source) {
  const B = source.bounds, c = B.centre, r = Math.max(...B.size);
  const origin = [c[0] + r * 1.2, c[1] + r * 0.6, c[2] + r * 1.6], dir = norm(sub(c, origin));
  if (source.id === 'torus' || source.id === 'pipe') { // aim at the rim, not through the hole
    const target = [c[0] + source.dims.R * 0.7, c[1] + (source.dims.H ? source.dims.H * 0.2 : 0), c[2] + source.dims.R * 0.7];
    const o2 = [target[0] + r * 1.2, target[1] + r * 0.6, target[2] + r * 1.6], hit = source.trace(o2, norm(sub(target, o2)));
    if (hit) return hit.point;
  }
  const hit = source.trace(origin, dir);
  return hit ? hit.point : c.slice();
}

// A baked fracture hit somewhere else: the same pre-cut pieces, re-ranked by distance from the new hit, so the
// rigid-body preview releases and launches them from there. (A realtime fracture re-cuts instead.)
export function rehit(result, point) {
  const S = [1 / Math.sqrt(MATERIALS[result.recipe.Material].grain), 1, 1];
  const metric = (a, b) => Math.hypot((a[0] - b[0]) * S[0], (a[1] - b[1]) * S[1], (a[2] - b[2]) * S[2]);
  const pieces = result.pieces.map((pc) => { const distance = metric(pc.centre, point); return { ...pc, distance, priority: Math.exp(-distance / result.plan.falloff) }; });
  const travel = result.recipe.DirMode === 'custom' ? result.travel : mul(surfaceNormal(result.source, point), -1);
  return { ...result, pieces, impact: point.slice(), travel, rehit: true };
}
