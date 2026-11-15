// Fracture simulation check: node Tests/FractureSimulationCheck.mjs
// Every specimen is fractured at its default impact and baked for the default duration. Fails if:
//   • the energy shares do not add up to the kinetic budget;
//   • a held piece moves;
//   • a released piece ends below the ground;
//   • the poses stop being finite;
//   • the bake takes longer than the time budget.
// Also checks that more impact energy releases at least as many fragments.
globalThis.performance ??= { now: () => Date.now() };
const E = await import(new URL('../Source/FractureEngine.js', import.meta.url).href);
const P = await import(new URL('../Source/FractureSimulation.js', import.meta.url).href);
let failed = 0;
const fail = (msg) => { failed++; console.log('FAIL', msg); };

for (const { id } of E.SPECIMENS) {
  const src = E.specimenSource(id), imp = E.defaultImpact(src);
  const res = E.fracture(src, { Material: 'concrete', Energy: 6000, X: imp[0], Y: imp[1], Z: imp[2], Ceiling: 64 });
  const cache = P.simulate(res, {});
  const sh = cache.shares, sum = sh.energy.reduce((a, v) => a + v, 0);
  if (Math.abs(sum - sh.kinetic) > 1e-6 * Math.max(1, sh.kinetic)) fail(`${id}: shares ${sum} ≠ kinetic ${sh.kinetic}`);
  const pose = { x: [0, 0, 0], q: [0, 0, 0, 1], kinetic: 0 };
  let lowest = Infinity, heldMoved = 0, finite = true;
  res.pieces.forEach((pc, i) => {
    P.sample(cache, cache.duration, i, pose);
    if (![...pose.x, ...pose.q].every(Number.isFinite)) finite = false;
    if (!sh.released[i] && Math.hypot(...pose.x.map((v, k) => v - pc.centre[k])) > 1e-6) heldMoved++;
    if (sh.released[i]) lowest = Math.min(lowest, pose.x[1] - cache.ground);
  });
  if (!finite) fail(`${id}: non-finite pose`);
  if (heldMoved) fail(`${id}: ${heldMoved} held piece(s) moved`);
  if (lowest < -0.05) fail(`${id}: a released piece ended ${(-lowest * 100).toFixed(1)} cm below the ground`);
  if (cache.ms > 1500) fail(`${id}: bake took ${cache.ms.toFixed(0)} ms`);
  const hi = P.impactShares(E.fracture(src, { Material: 'concrete', Energy: 30000, X: imp[0], Y: imp[1], Z: imp[2], Ceiling: 64 }), {});
  console.log(failed ? '    ' : 'ok  ', id.padEnd(9), 'pieces', String(res.pieces.length).padStart(3), 'released', String(sh.releasedCount).padStart(3),
    'kinetic', sh.kinetic.toFixed(0).padStart(5) + ' J', 'peak', sh.peak.toFixed(1).padStart(7) + ' J', 'settled', cache.settled === null ? '  —  ' : cache.settled.toFixed(2) + ' s',
    'bake', cache.ms.toFixed(0) + ' ms', '· 30 kJ releases', hi.releasedCount);
  if (hi.releasedCount < sh.releasedCount) fail(`${id}: more energy released fewer pieces`);
}
console.log(failed ? `${failed} check(s) failed` : 'all simulations passed');
process.exit(failed ? 1 : 0);
