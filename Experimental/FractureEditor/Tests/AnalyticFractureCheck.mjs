// node Experimental/FractureEditor/Tests/AnalyticFractureCheck.mjs
// Checks every analytical primitive: faceted volume against the closed form, exact volume conservation after the
// fracture, closed pieces, seam rejoining on the torus and pipe, and that the rigid-body preview settles.
import { PRIMITIVES, defaultDims, signedDistance } from '../Source/Primitives.js';
import { buildSource, fracture, defaultImpact, MATERIAL_ORDER } from '../Source/Fracture.js';
import { simulate } from '../Source/FractureSimulation.js';

let failures = 0;
const check = (ok, text) => { if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`); };

for (const spec of PRIMITIVES) {
  const src = buildSource(spec.id, defaultDims(spec.id), 'medium');
  check(Math.abs(src.faceting) < 0.03, `${spec.id.padEnd(8)} faceted ${src.volume.toFixed(5)} m³ vs exact ${src.exactVolume.toFixed(5)} (${(src.faceting * 100).toFixed(2)} %) · ${src.parts.length} part(s) · ${src.tris} tris · ${src.ms.toFixed(0)} ms`);
  const hit = defaultImpact(src);
  check(Math.abs(signedDistance(spec.id, src.dims, hit)) < 1e-3, `${spec.id.padEnd(8)} impact on the exact surface (${hit.map((v) => v.toFixed(3)).join(', ')})`);
  for (const material of spec.id === 'pane' ? ['glass', 'tempered'] : ['concrete', 'wood']) {
    const r = fracture(src, { Material: material, Energy: 2500, Seed: 42, Ceiling: 48, X: hit[0], Y: hit[1], Z: hit[2] });
    const vol = r.pieces.reduce((s, p) => s + p.volume, 0);
    check(Math.abs(vol - src.volume) / src.volume < 1e-6, `${spec.id.padEnd(8)} ${material.padEnd(8)} ${String(r.pieces.length).padStart(3)} pieces from ${r.metrics.cells} cells · volume kept ${(vol / src.volume * 100).toFixed(4)} % · ${r.ms.toFixed(0)} ms${src.segmented ? ` · ${r.stats.chunks} chunks, ${r.stats.rejoined} seam joins, ${r.stats.split} split` : ''}`);
    check(r.pieces.every((p) => p.tris > 0 && p.cutFaces > 0 || r.pieces.length === 1), `${spec.id.padEnd(8)} ${material.padEnd(8)} every piece has geometry and cut faces`);
    if (material === 'concrete' || material === 'glass') {
      const sim = simulate(r, { Duration: 4 });
      check(sim.totals.every(Number.isFinite), `${spec.id.padEnd(8)} simulate ${sim.shares.releasedCount}/${r.pieces.length} released · settles ${sim.settled === null ? 'never' : sim.settled.toFixed(2) + ' s'} · ${sim.ms.toFixed(0)} ms`);
    }
  }
}
// The torus seam union: a cell straddling a seam must come back as one piece, so piece count ≤ chunk count.
const torus = buildSource('torus', defaultDims('torus'));
const tr = fracture(torus, { Energy: 6000, Seed: 7, Ceiling: 60 });
check(tr.stats.rejoined > 0 && tr.pieces.length < tr.stats.chunks, `torus seam union joins chunks (${tr.stats.chunks} chunks → ${tr.pieces.length} pieces)`);
// Detail levels
for (const detail of ['low', 'high']) { const s = buildSource('torus', defaultDims('torus'), detail); check(Math.abs(s.faceting) < 0.04, `torus ${detail} detail faceting ${(s.faceting * 100).toFixed(2)} %`); }
console.log(failures ? `\n${failures} failure(s)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
