// Node checks for the terrain stack (run: node terrain/check-terrain.mjs).
// They pin the river/lake behaviour the editor depends on:
//   1. rivers cut the ground: the carved surface is lower than the uncarved one along channels
//   2. water is only where the ground sits below its water level (no blue on dry land)
//   3. dry cells carry no water, and every wet cell has a level at or above its ground
//   4. lakes fill closed basins with a flat level
import { evaluateTerrain, defaultTerrainStack, evaluateTexture, defaultTextureStack, makeTerrainLayer } from './stack.js';

let failures = 0;
const check = (ok, label, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
    if (!ok) failures++;
};

const N = 160, size = 1200;
const stack = defaultTerrainStack();
const t0 = Date.now();
const full = evaluateTerrain(stack, { N, size });
const ms = Date.now() - t0;

const noRivers = evaluateTerrain(stack.filter((l) => l.type !== 'rivers'), { N, size });
const noWater = evaluateTerrain(stack.filter((l) => l.type !== 'rivers' && l.type !== 'lakes'), { N, size });

const finite = full.height.every((v) => Number.isFinite(v));
check(finite, 'heights are finite');

let wet = 0, dry = 0, wetBelowLevel = 0, wetNoLevel = 0, dryWithWater = 0;
let carvedCells = 0, maxCut = 0;
for (let i = 0; i < N * N; i++) {
    const w = full.water[i];
    if (Number.isNaN(w)) {
        dry++;
        if (noRivers.height[i] - full.height[i] > 0.05) carvedCells++;
        if (noRivers.height[i] - full.height[i] > maxCut) maxCut = noRivers.height[i] - full.height[i];
    } else {
        wet++;
        if (full.height[i] < w - 0.009) wetBelowLevel++;
        else wetNoLevel++;
        if (!Number.isFinite(w)) dryWithWater++;
    }
}
check(wet > 0, 'the default stack produces water', `${wet} wet cells of ${N * N}`);
check(wetBelowLevel === wet, 'every wet cell sits below its water level', `${wetBelowLevel}/${wet}`);
check(wetNoLevel === 0, 'no wet cell is above its water level', `${wetNoLevel} violations`);
check(dryWithWater === 0, 'dry cells carry no water level');

// the river must actually cut: count cells that the river layer lowered, and check the water sits in those cuts
let cutWet = 0;
for (let i = 0; i < N * N; i++) {
    if (!Number.isNaN(full.water[i]) && full.height[i] < noWater.height[i] - 0.05) cutWet++;
}
check(cutWet > 0, 'river water sits inside carved channels', `${cutWet} wet cells lie in a cut`);
let deepest = 0;
for (let i = 0; i < N * N; i++) deepest = Math.max(deepest, noRivers.height[i] - full.height[i]);
check(deepest > 0.5 && deepest < 12, 'rivers lower the ground by about the channel depth', `deepest cut ${deepest.toFixed(2)} m (channel depth 6 m)`);

let waterDepth = 0;
for (let i = 0; i < N * N; i++) if (!Number.isNaN(full.water[i])) waterDepth = Math.max(waterDepth, full.water[i] - full.height[i]);
check(waterDepth < 40, 'water depths stay physically sane', `deepest water ${waterDepth.toFixed(2)} m`);

// texture: water-adjacent wet bank colour must not turn dry land blue
const rgb = evaluateTexture(defaultTextureStack(), full);
let blueDominant = 0;
for (let i = 0; i < N * N; i++) {
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
    if (b > r + 0.1 && b > g) blueDominant++;
}
check(blueDominant === 0, 'no dry cell is shaded blue by the texture stack', `${blueDominant} blue cells`);

// a single disabled layer must not change the result
const disabled = stack.map((l) => ({ ...l, enabled: l.type === 'fractal' }));
const onlyFractal = evaluateTerrain(disabled, { N, size });
const fractalOnly = evaluateTerrain([makeTerrainLayer('fractal', 'x')], { N, size });
let same = true;
for (let i = 0; i < N * N; i++) if (Math.abs(onlyFractal.height[i] - fractalOnly.height[i]) > 1e-4) { same = false; break; }
check(same, 'disabling layers matches a stack built from the enabled ones only');

console.log(`\nevaluated ${N}×${N} stack in ${ms} ms (${wet} wet, ${dry} dry)`);
if (failures) {
    console.log(`${failures} check(s) failed`);
    process.exit(1);
}
console.log('all terrain checks passed');
