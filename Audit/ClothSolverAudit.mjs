/*============================================================================================================================================
                                                          CLOTHSOLVERAUDIT.MJS
============================================================================================================================================*/
// Independent audit of the six cloth solvers (A–F) in SultanAladin/Frontier-1 @ arena/56d5516e-frontier-1.
// Runs the shipped solver unmodified, then runs patched copies that isolate one suspected defect at a time.
//
//   Usage:
//     git clone --depth 1 -b arena/56d5516e-frontier-1 https://github.com/SultanAladin/Frontier-1.git /tmp/f1
//     CLOTH_EDITOR_DIR=/tmp/f1/Experimental/ClothEditor node Audit/ClothSolverAudit.mjs
//
// Nothing in the cloned repository is modified: patched solver copies are written to a temp folder.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const Dir = process.env.CLOTH_EDITOR_DIR || '/tmp/f1/Experimental/ClothEditor';
const Frames = Number(process.env.AUDIT_FRAMES || 180);
const Spacing = Number(process.env.AUDIT_SPACING_MM || 16.5);
const Preset = process.env.AUDIT_PRESET || 'coutureDress';

const engine = (f) => pathToFileURL(path.join(Dir, 'Engine', f)).href;
const { MannequinAvatar } = await import(engine('MannequinAvatar.js'));
const { cloneTextileMaterial } = await import(engine('TextileCatalog.js'));
const { buildGarmentPresetSpec } = await import(engine('GarmentPresets.js'));
const { compileGarmentNetwork } = await import(engine('PatternDraftNetwork.js'));
const { OrthotropicClothSolver } = await import(engine('OrthotropicClothSolver.js'));

const SolverSource = fs.readFileSync(path.join(Dir, 'Engine', 'OrthotropicClothSolver.js'), 'utf8');
const TempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloth-audit-'));

// Write a patched copy of the solver and import it. Each patch must match exactly once or the audit aborts.
async function loadPatchedSolver(tag, patches)
{
    let src = SolverSource;
    for (const [from, to] of patches)
    {
        const count = src.split(from).length - 1;
        if (count !== 1) throw new Error(`[${tag}] patch anchor matched ${count} times: ${from.slice(0, 80)}`);
        src = src.replace(from, to);
    }
    const file = path.join(TempDir, `Solver_${tag}.mjs`);
    fs.writeFileSync(file, src);
    return (await import(pathToFileURL(file).href)).OrthotropicClothSolver;
}

const bin = fs.readFileSync(path.join(Dir, 'Assets', 'FrontierMannequin.bin'));
const avatar = MannequinAvatar.fromArrayBuffer(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
avatar.ensureSignedDistanceVolume();
const spec = buildGarmentPresetSpec(Preset, avatar);
const net = compileGarmentNetwork(spec, avatar, { particleSpacingMm: Spacing });

function measure(solver)
{
    const p = solver.positions;
    const n = p.length / 3;
    const hit = { phi: 0, dist: 0, qx: 0, qy: 0, qz: 0, nx: 0, ny: 1, nz: 0 };
    let gap = 0, gapN = 0;
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; ++i)
    {
        for (let k = 0; k < 3; ++k) { lo[k] = Math.min(lo[k], p[i * 3 + k]); hi[k] = Math.max(hi[k], p[i * 3 + k]); }
        if (avatar.sampleSignedDistance(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], 0.0, hit)) { gap += hit.phi; gapN++; }
    }
    const tel = solver.evaluateTelemetry();
    return {
        gapMm: gapN ? (gap / gapN) * 1000 : NaN,
        volM3: (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]),
        rms: solver.rmsSpeedMmS,
        yarn: tel.meanYarnStretch,
        shear: tel.meanShearDeg,
        nan: Array.prototype.some.call(p, (v) => !Number.isFinite(v)),
    };
}

function run(SolverClass, mode, label, perFrame = null)
{
    const s = new SolverClass(net, cloneTextileMaterial(spec.defaultTextile), avatar);
    s.solverMode = mode;
    const t0 = performance.now();
    let peak = 0;
    for (let f = 0; f < Frames; ++f)
    {
        if (perFrame) perFrame(s, f);
        s.stepFrame(1 / 60);
        peak = Math.max(peak, s.rmsSpeedMmS);
    }
    const ms = (performance.now() - t0) / Frames;
    const m = measure(s);
    const row = { label, mode, ms: ms.toFixed(1), gapMm: m.gapMm.toFixed(1), volM3: m.volM3.toFixed(3),
        rms: `${peak.toFixed(0)} -> ${m.rms.toFixed(1)}`, yarn: m.yarn.toFixed(3), shearDeg: m.shear.toFixed(1), nan: m.nan };
    console.log(JSON.stringify(row));
    return { s, row };
}

console.log(`# Preset ${Preset}, ${net.pointCount} pts / ${net.faceCount} tris, ${Frames} frames @ 60 FPS, spacing ${Spacing} mm`);
const spawn = new OrthotropicClothSolver(net, cloneTextileMaterial(spec.defaultTextile), avatar);
const ms0 = measure(spawn);
console.log(`# Spawn shell: gap ${ms0.gapMm.toFixed(1)} mm, bbox ${ms0.volM3.toFixed(3)} m^3`);

// ── 0. Baseline: all six shipped solvers ──────────────────────────────────────────────────────────────────
console.log('\n## 0. Shipped solvers (unmodified)');
const base = {};
for (const mode of ['avbd', 'xpbd', 'scr', 'gn_knot', 'jgs2', 'kes_aa'])
    base[mode] = run(OrthotropicClothSolver, mode, `shipped ${mode}`);

// ── 1. Option C: do the Cosserat quaternions influence the cloth at all? ─────────────────────────────────
// Scramble every edge quaternion to a random unit quaternion before every frame. If positions stay bit-identical
// to the shipped run, the rod orientations have zero influence on the simulated garment.
console.log('\n## 1. Option C — scramble all rod quaternions every frame');
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
const scrambled = run(OrthotropicClothSolver, 'scr', 'scr + random quaternions', (s) =>
{
    const q = s.edgeQuats;
    for (let e = 0; e < q.length; e += 4)
    {
        const x = rnd(), y = rnd(), z = rnd(), w = rnd();
        const l = Math.hypot(x, y, z, w) || 1;
        q[e] = x / l; q[e + 1] = y / l; q[e + 2] = z / l; q[e + 3] = w / l;
    }
});
let maxDiff = 0;
for (let i = 0; i < scrambled.s.positions.length; ++i)
    maxDiff = Math.max(maxDiff, Math.abs(scrambled.s.positions[i] - base.scr.s.positions[i]));
console.log(`# max |x_scrambled - x_shipped| = ${maxDiff}  ${maxDiff === 0 ? '=> quaternions are DEAD STATE (no effect on positions)' : '=> quaternions matter'}`);

// ── 2. Option F: modulus applied twice (C11 * wrapStrain(.., C11)) ───────────────────────────────────────
console.log('\n## 2. Option F — fix the squared modulus (stress = C11^2 * strain)');
const FixF = await loadPatchedSolver('F_singleModulus', [
    ['let su = C11 * envU.tension + c12eff * envV.tension;', 'let su = envU.tension + c12eff * envV.strain;'],
    ['let sv = c12eff * envU.tension + C22 * envV.tension;', 'let sv = c12eff * envU.strain + envV.tension;'],
    ['let tu = C11 * envU.tangent;', 'let tu = envU.tangent;'],
    ['let tv = C22 * envV.tangent;', 'let tv = envV.tangent;'],
]);
run(FixF, 'kes_aa', 'kes_aa single modulus');
const FixFNoAA = await loadPatchedSolver('F_singleModulus_noAA', [
    ['let su = C11 * envU.tension + c12eff * envV.tension;', 'let su = envU.tension + c12eff * envV.strain;'],
    ['let sv = c12eff * envU.tension + C22 * envV.tension;', 'let sv = c12eff * envU.strain + envV.tension;'],
    ['let tu = C11 * envU.tangent;', 'let tu = envU.tangent;'],
    ['let tv = C22 * envV.tangent;', 'let tv = envV.tangent;'],
    ['this._andersonAccelerate(startPos, h);\n        this._applyGrabProjection();', 'this._applyGrabProjection();'],
]);
run(FixFNoAA, 'kes_aa', 'kes_aa single modulus, no Anderson');

// ── 3. Option D: contact Hessian uses the TANGENT projector (I - nn^T) and pushes the point INTO the face ──
console.log('\n## 3. Option D — contact Hessian (I - nn^T -> nn^T) and contact force sign');
const FixD = await loadPatchedSolver('D_contactFix', [
    ['linkContact(fIdx[f * 3], c, this.contactBary[c * 3]);', 'linkContact(fIdx[f * 3], c, -this.contactBary[c * 3]);'],
    ['pushContact(fIdx[f * 3], c, this.contactBary[c * 3]);', 'pushContact(fIdx[f * 3], c, -this.contactBary[c * 3]);'],
    ['pushContact(fIdx[f * 3 + 1], c, this.contactBary[c * 3 + 1]);', 'pushContact(fIdx[f * 3 + 1], c, -this.contactBary[c * 3 + 1]);'],
    ['pushContact(fIdx[f * 3 + 2], c, this.contactBary[c * 3 + 2]);', 'pushContact(fIdx[f * 3 + 2], c, -this.contactBary[c * 3 + 2]);'],
    ['                pushContact(-1 - f, c, 1.0);', '                pushContact(-1 - f, c, -1.0);'],
    [`                    if (share <= 0.0) continue;`, `                    if (share === 0.0) continue;\n                    const role = share > 0.0 ? 1.0 : -1.0;`],
    [`const kc = contactK * share * Math.pow(1.2, Math.min(life, 12));`, `const kc = contactK * Math.abs(share) * Math.pow(1.2, Math.min(life, 12));`],
    [`h00 += kc * (1.0 - nx * nx); h01 += kc * (-nx * ny); h02 += kc * (-nx * nz);
                    h11 += kc * (1.0 - ny * ny); h12 += kc * (-ny * nz); h22 += kc * (1.0 - nz * nz);`,
     `const kh = kc * Math.abs(share);
                    h00 += kh * nx * nx; h01 += kh * nx * ny; h02 += kh * nx * nz;
                    h11 += kh * ny * ny; h12 += kh * ny * nz; h22 += kh * nz * nz;`],
    [`rx -= kc * depth * nx; ry -= kc * depth * ny; rz -= kc * depth * nz;`,
     `rx += role * kc * depth * nx; ry += role * kc * depth * ny; rz += role * kc * depth * nz;`],
]);
run(FixD, 'gn_knot', 'gn_knot contact fix');

// Freeze probe: Option D keeps ONE global step scale (_gnStepScale) that drops by 0.9x every substep in which any
// single contact is deeper than 2.5 mm (floor 0.10) and multiplies EVERY vertex's Newton step. Trace it, then
// disable it to see what it is hiding.
const NoThrottle = ['if (deepest > 0.0025) this._gnStepScale = Math.max(0.10, this._gnStepScale * 0.9);', 'if (false) this._gnStepScale = 0.1;'];
const ShippedNoThrottle = await loadPatchedSolver('D_noThrottle', [NoThrottle]);
function throttleTrace(SolverClass, label)
{
    let minScale = 1, slowFrames = 0;
    const trace = [];
    run(SolverClass, 'gn_knot', label, (s, f) =>
    {
        if (f === 0) return;
        minScale = Math.min(minScale, s._gnStepScale);
        if (s._gnStepScale < 0.5) slowFrames++;
        if (f % 20 === 0) trace.push(s._gnStepScale.toFixed(2));
    });
    console.log(`#   step-scale: min ${minScale.toFixed(2)}, frames below 0.5 = ${slowFrames}/${Frames}, every 20 frames: ${trace.join(' ')}`);
}
throttleTrace(OrthotropicClothSolver, 'gn_knot shipped (throttle trace)');
throttleTrace(ShippedNoThrottle, 'gn_knot shipped, global throttle disabled');

// ── 4. Option E: is the "Schur" term doing anything? ─────────────────────────────────────────────────────
console.log('\n## 4. Option E — remove the fabricated 1-ring Schur coupling (kE = 0 => plain block Jacobi)');
const NoSchur = await loadPatchedSolver('E_noSchur', [
    ['const kE = (0.25 / deg) * diagScale;', 'const kE = 0.0;'],
]);
run(NoSchur, 'jgs2', 'jgs2 without Schur term');

console.log(`\n# patched copies written to ${TempDir}`);
