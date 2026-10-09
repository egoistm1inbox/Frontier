import { buildHybrid, defaults } from './hybrid.js';
const p = { ...defaults, ...Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')).map(([k, v]) => [k, Number(v)])) };
const r = buildHybrid(p);
console.log(JSON.stringify(r.stats));
const { field, sampler, chunks, chunkMeshes } = r;
const C = p.chunkCells, span = C * field.spacing, half = field.size / 2;
let outer = 0, outerBad = 0, maxErr = 0;
const shared = new Map(); // key plane -> arrays per side
chunks.list.forEach((c, n) => {
  const m = chunkMeshes[n];
  const x0 = c.ci * span - half, x1 = x0 + span, z0 = c.cj * span - half, z1 = z0 + span;
  const nb = (di, dj) => { const i = c.ci + di, j = c.cj + dj; return i < 0 || j < 0 || i >= chunks.nc || j >= chunks.nc ? 0 : chunks.active[j * chunks.nc + i]; };
  for (let i = 0; i < m.positions.length; i += 3) {
    const x = m.positions[i], y = m.positions[i + 1], z = m.positions[i + 2];
    const sides = [];
    if (Math.abs(x - x0) < 1e-6) sides.push(['x', c.ci, c.cj, nb(-1, 0)]);
    if (Math.abs(x - x1) < 1e-6) sides.push(['x', c.ci + 1, c.cj, nb(1, 0)]);
    if (Math.abs(z - z0) < 1e-6) sides.push(['z', c.cj, c.ci, nb(0, -1)]);
    if (Math.abs(z - z1) < 1e-6) sides.push(['z', c.cj + 1, c.ci, nb(0, 1)]);
    for (const [ax, line, other, act] of sides) {
      if (!act) { outer++; const err = Math.abs(y - sampler.height(x, z)); if (err > maxErr) maxErr = err; if (err > 1e-3) outerBad++; }
      else { const key = `${ax}:${line}`; if (!shared.has(key)) shared.set(key, []); shared.get(key).push([x, y, z, n]); }
    }
  }
});
// shared planes: every vertex must have a twin from the other chunk
let sharedPts = 0, unmatched = 0;
for (const [key, pts] of shared) {
  const byChunk = new Map(); for (const q of pts) { if (!byChunk.has(q[3])) byChunk.set(q[3], []); byChunk.get(q[3]).push(q); }
  const groups = [...byChunk.values()]; if (groups.length < 2) continue;
  for (const q of pts) {
    sharedPts++;
    let ok = false;
    for (const q2 of pts) { if (q2[3] !== q[3] && Math.abs(q2[0] - q[0]) < 1e-4 && Math.abs(q2[1] - q[1]) < 1e-4 && Math.abs(q2[2] - q[2]) < 1e-4) { ok = true; break; } }
    if (!ok) unmatched++;
  }
}
console.log(`outer boundary verts ${outer}, off heightfield (>1mm): ${outerBad}, max err ${maxErr.toExponential(2)} m`);
console.log(`shared-plane verts ${sharedPts}, unmatched: ${unmatched}`);
// overhang check: count chunk verts whose normal points downward (true overhang surface)
let over = 0; for (const m of chunkMeshes) for (let i = 1; i < m.normals.length; i += 3) if (m.normals[i] < -0.2) over++;
console.log(`overhang-facing verts: ${over}`);
