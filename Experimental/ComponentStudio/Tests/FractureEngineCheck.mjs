// Fracture engine check: node Tests/FractureEngineCheck.mjs
// Every specimen × material is fractured at its default impact. Fails if a solve yields no pieces, the pieces do not
// fill the source volume, a piece is open, or a solve exceeds the ceiling.
globalThis.performance ??= { now: () => Date.now() };
const E = await import(new URL('../Source/FractureEngine.js', import.meta.url).href);
let failed = 0;
for (const { id } of E.SPECIMENS) {
  const src = E.specimenSource(id);
  for (const mat of E.MATERIAL_ORDER) {
    const imp = E.defaultImpact(src), ceiling = mat === 'tempered' ? 160 : 48;
    const r = E.fracture(src, { Material: mat, X: imp[0], Y: imp[1], Z: imp[2], Ceiling: ceiling });
    const ok = r.metrics.pieces > 1 && r.metrics.pieces <= ceiling && Math.abs(r.metrics.occupied - 100) < 0.5 && r.metrics.closed;
    if (!ok) failed++;
    console.log(ok ? 'ok  ' : 'FAIL', id.padEnd(9), mat.padEnd(9), 'pieces', String(r.metrics.pieces).padStart(3), 'of', String(r.plan.requested).padStart(5),
      'occupied', r.metrics.occupied.toFixed(3) + '%', 'minQ', r.metrics.minQ.toFixed(3), 'tris', String(r.metrics.tris).padStart(5), 'refused', String(r.metrics.refused).padStart(4), r.ms.toFixed(0) + ' ms');
  }
}
console.log(failed ? `${failed} solve(s) failed` : 'all solves passed');
process.exit(failed ? 1 : 0);
