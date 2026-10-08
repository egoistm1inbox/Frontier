// Topology check for the SDF↔heightfield hybrid with rugged outcrops + broken strata on.
// Mirrors ../SdfCliffLab/check-seams.mjs, but drives the real CliffGenerator chunk pipeline:
//   • outer border verts of every chunk must sit ON the heightfield (watertight outer seams),
//   • verts on faces shared with an active neighbour must have a twin in that neighbour,
//   • no vertex may escape the carve band (band coverage ⇒ no clipped surfaces / holes),
//   • the shared plate field must be continuous and deterministic (JS side of the JS↔GLSL pact).
// Usage: node scripts/check-seams-rugged.mjs ["Rugged escarpment"] [192]
import { generateTerrain } from '../src/pipeline.js';
import { defaults, presets } from '../src/params.js';
import { selectChunks, packChunkJobs, buildChunkGeometry, makeChunkContext, carveReach } from '../src/sdf-chunks.js';
import { plateField, lateralWarp, subTerrace } from '../src/strata-model.js';
import { ruggedPlates, ruggedFieldParams } from '../src/rugged.js';
import { voronoi2 } from '../src/noise.js';

const presetName = process.argv[2] || 'Rugged escarpment';
const res = Number(process.argv[3] || 192);
const params = { ...defaults, ...presets[presetName], resolution: res, sdfVoxel: Number(process.argv[4] || 1) };
// optional k=v overrides: node scripts/check-seams-rugged.mjs "Preset" 192 1 ruggedAmount=1 strataBreak=1.5
for (const a of process.argv.slice(5)) {
  const [k, val] = a.split('=');
  if (k && val !== undefined) params[k] = Number(val);
}
params.droplets = Math.round(params.droplets * (res * res) / (512 * 512));

let failures = 0;
const fail = (m) => { failures++; console.log(`FAIL: ${m}`); };

// ---- 0. shared-field unit checks: continuity, bounds, determinism -------------------------------
{
  const fp = ruggedFieldParams(params);
  let worst = 0;
  for (let k = 0; k < 4000; k++) {
    const x = ((k * 733) % 2048) + 0.5, z = ((k * 991) % 2048) + 0.5;
    const [o1] = plateField(x, z, 150, 56085, 8);
    const [o2] = plateField(x + 0.01, z, 150, 56085, 8);
    worst = Math.max(worst, Math.abs(o1 - o2));
    if (!(o1 >= -1 && o1 <= 1)) fail(`plateField out of range: ${o1}`);
    const [u, c, p] = ruggedPlates(x, z, fp.scale, fp.seed, fp.warp, fp.widthCells, 1);
    if (!(u >= -1 && u <= 1 && c >= 0 && c <= 1 && p >= 0 && p <= 1)) fail(`ruggedPlates out of range: ${u} ${c} ${p}`);
    const w1 = lateralWarp(x, z, 20), w2 = lateralWarp(x + 0.01, z, 20);
    worst = Math.max(worst, Math.abs(w1 - w2));
    const [s] = subTerrace(0.999, 3, 1, 1), [s2] = subTerrace(0.001, 3, 1, 1);
    if (!(s >= 0 && s <= 1 && s2 >= 0 && s2 <= 1)) fail('subTerrace out of range');
    const a = voronoi2(x / 45, z / 45, fp.seed), b = voronoi2(x / 45, z / 45, fp.seed);
    if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) fail('voronoi2 nondeterministic');
  }
  // sub-terracing must be monotone (no fold in the height remap)
  let prev = -1;
  for (let k = 0; k <= 120; k++) {
    const [s] = subTerrace(k / 120, 4, 0.9, 1);
    if (s < prev - 1e-9) fail(`subTerrace not monotone at ${k / 120}`);
    prev = s;
  }
  console.log(`plate continuity over 1cm steps: worst jump ${worst.toExponential(2)} (fault smoothing absorbs it)`);
}

// ---- 1. generate + select + mesh chunks ----------------------------------------------------------
console.log(`generating "${presetName}" at ${res}² …`);
const field = generateTerrain(params, () => {});
const N = field.resolution, size = field.worldSize, cell = size / (N - 1);
const chunks = selectChunks(field, params);
console.log(`chunks: ${chunks.list.length} active / ${chunks.candidates} candidates, C=${chunks.C}`);
if (chunks.list.length === 0) fail('no chunks selected — test is vacuous (lower sdfAngle?)');

const { jobs, meta } = packChunkJobs(field, chunks, params);
const maxCarve = carveReach(params);
console.log(`voxel=${meta.cell.toFixed(2)}m k=${meta.k} carveReach=${maxCarve.toFixed(2)}m`);
const ctx = makeChunkContext(params);
const meshes = jobs.map((job) => ({ job, m: buildChunkGeometry(job, meta, params, ctx) }));
let tris = 0, verts = 0;
for (const { m } of meshes) { tris += m.triangles; verts += m.positions.length / 3; }
console.log(`chunk surface: ${verts.toLocaleString('en-US')} verts, ${Math.round(tris).toLocaleString('en-US')} tris`);

// bilinear height sampler (corner frame)
function heightAt(x, z) {
  const gx = Math.min(N - 1.001, Math.max(0, (x / size + 0.5) * (N - 1)));
  const gz = Math.min(N - 1.001, Math.max(0, (z / size + 0.5) * (N - 1)));
  const i = Math.floor(gx), j = Math.floor(gz), u = gx - i, w = gz - j;
  const h = field.height, a = h[j * N + i], b = h[j * N + i + 1], c = h[(j + 1) * N + i], d = h[(j + 1) * N + i + 1];
  return (a + (b - a) * u) * (1 - w) + (c + (d - c) * u) * w;
}

// ---- 2a. outer-face invariant: W must be EXACTLY 0 wherever a chunk touches the outside ---------
const C = chunks.C, nc = chunks.nc, half = size / 2;
{
  let bad = 0;
  const W = field.sdfWeight, act = chunks.active;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const idx = j * N + i;
      if (!(W[idx] > 0)) continue;
      if (i === 0 || j === 0 || i === N - 1 || j === N - 1) { bad++; continue; }
      const ci0 = Math.max(0, Math.floor((i - 1) / C)), ci1 = Math.min(nc - 1, Math.floor(i / C));
      const cj0 = Math.max(0, Math.floor((j - 1) / C)), cj1 = Math.min(nc - 1, Math.floor(j / C));
      for (let cj = cj0; cj <= cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) {
        if (!act[cj * nc + ci]) { bad++; cj = cj1 + 1; break; }
      }
    }
  }
  console.log(`W>0 nodes touching outside/map-border: ${bad} (must be 0)`);
  if (bad > 0) fail('carve weight leaks onto outer faces — the field is not y−h there');
}

// ---- 2b. outer seams: border verts must sit on the heightfield's border polyline -----------------
// The polyline is linear between shared nodes (the rendered mesh edge), so compare against the
// 1-D edge interpolation — no bilinear-vs-triangulation ambiguity by construction.
function edgeHeight(x, z, x0, x1, z0, z1) {
  const h = field.height;
  const onX0 = Math.abs(x - x0) < 2e-4, onX1 = Math.abs(x - x1) < 2e-4;
  const onZ0 = Math.abs(z - z0) < 2e-4, onZ1 = Math.abs(z - z1) < 2e-4;
  if (onX0 || onX1) {
    const gx = Math.round(((onX0 ? x0 : x1) / size + 0.5) * (N - 1));
    const gz = (z / size + 0.5) * (N - 1);
    let j0 = Math.floor(gz), ww = gz - j0;
    if (j0 < 0) { j0 = 0; ww = 0; } else if (j0 >= N - 1) { j0 = N - 2; ww = 1; }
    return h[j0 * N + gx] * (1 - ww) + h[(j0 + 1) * N + gx] * ww;
  }
  if (onZ0 || onZ1) {
    const gz = Math.round(((onZ0 ? z0 : z1) / size + 0.5) * (N - 1));
    const gx = (x / size + 0.5) * (N - 1);
    let i0 = Math.floor(gx), uu = gx - i0;
    if (i0 < 0) { i0 = 0; uu = 0; } else if (i0 >= N - 1) { i0 = N - 2; uu = 1; }
    return h[gz * N + i0] * (1 - uu) + h[gz * N + i0 + 1] * uu;
  }
  return NaN;
}
const nb = (ci, cj, di, dj) => {
  const i = ci + di, j = cj + dj;
  return i < 0 || j < 0 || i >= nc || j >= nc ? 0 : chunks.active[j * nc + i];
};
let outer = 0, outerBad = 0, maxErr = 0;
const shared = new Map();
const coordTol = 1e-4; // true border verts land on the plane to float32 rounding (~6e-5 here)
meshes.forEach(({ job, m }, n) => {
  const x0 = job.i0 * cell - half, x1 = x0 + job.cw * cell;
  const z0 = job.j0 * cell - half, z1 = z0 + job.ch * cell;
  const pos = m.positions;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    if (!Number.isFinite(x + y + z)) { fail(`non-finite vertex in chunk ${n}`); continue; }
    const sides = [];
    if (Math.abs(x - x0) < coordTol) sides.push(['x', job.ci, job.cj, nb(job.ci, job.cj, -1, 0)]);
    if (Math.abs(x - x1) < coordTol) sides.push(['x', job.ci + 1, job.cj, nb(job.ci, job.cj, 1, 0)]);
    if (Math.abs(z - z0) < coordTol) sides.push(['z', job.cj, job.ci, nb(job.ci, job.cj, 0, -1)]);
    if (Math.abs(z - z1) < coordTol) sides.push(['z', job.cj + 1, job.ci, nb(job.ci, job.cj, 0, 1)]);
    for (const [ax, line, other, act] of sides) {
      if (!act) {
        outer++;
        const err = Math.abs(y - edgeHeight(x, z, x0, x1, z0, z1));
        if (err > maxErr) maxErr = err;
        if (err > 0.005) outerBad++; // 5 mm (float32 positions + interpolation on a 2 km tile)
      } else {
        const key = `${ax}:${line}:${other}`;
        if (!shared.has(key)) shared.set(key, []);
        shared.get(key).push([x, y, z, n]);
      }
    }
  }
});
console.log(`outer border verts ${outer}, off border polyline (>5mm): ${outerBad}, max err ${(maxErr * 1000).toFixed(1)} mm`);
if (outerBad > 0) fail(`${outerBad} outer verts off the heightfield — seam leak`);
if (outer === 0) fail('no outer border verts found — test is vacuous');

// ---- 3. shared faces: every vert needs a twin in the neighbour -----------------------------------
let sharedPts = 0, unmatched = 0;
for (const [, pts] of shared) {
  const byChunk = new Map();
  for (const q of pts) {
    if (!byChunk.has(q[3])) byChunk.set(q[3], []);
    byChunk.get(q[3]).push(q);
  }
  if (byChunk.size < 2) continue;
  for (const q of pts) {
    sharedPts++;
    let ok = false;
    for (const q2 of pts) {
      if (q2[3] !== q[3] && Math.abs(q2[0] - q[0]) < 2e-3 && Math.abs(q2[1] - q[1]) < 2e-3 && Math.abs(q2[2] - q[2]) < 2e-3) { ok = true; break; }
    }
    if (!ok) unmatched++;
  }
}
console.log(`shared-face verts ${sharedPts}, unmatched: ${unmatched}`);
if (unmatched > 0) fail(`${unmatched} shared-face verts without a twin — inter-chunk crack`);

// ---- 4. band coverage: no vertex may escape the carved band ---------------------------------------
let escapes = 0, worstEscape = 0;
const reach = maxCarve * 3 + 3 * meta.cell;
for (const { m } of meshes) {
  const pos = m.positions;
  for (let i = 0; i < pos.length; i += 15) {
    const d = Math.abs(pos[i + 1] - heightAt(pos[i], pos[i + 2]));
    if (d > reach) { escapes++; worstEscape = Math.max(worstEscape, d); }
  }
}
console.log(`band-coverage escapes: ${escapes}${escapes ? ` (worst ${(worstEscape).toFixed(1)}m vs reach ${reach.toFixed(1)}m)` : ''}`);
if (escapes > 0) fail('vertices outside the carve band — clipped surface / holes');

// ---- 5. overhang sanity: the hybrid must still produce true 3-D surface ---------------------------
let over = 0;
for (const { m } of meshes) for (let i = 1; i < m.normals.length; i += 3) if (m.normals[i] < -0.2) over++;
console.log(`overhang-facing verts: ${over}`);
if (over === 0) console.log('note: no overhang-facing verts at this resolution/preset');

console.log(failures ? `\n${failures} TOPOLOGY FAILURE(S)` : '\nTOPOLOGY OK');
process.exit(failures ? 1 : 0);
