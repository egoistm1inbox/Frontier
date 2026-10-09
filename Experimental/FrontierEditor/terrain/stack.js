// Layer stacks for the terrain editor: a Terrain stack (heights and water) and a Texture stack (colour).
// Every layer is a catalogue entry (category, parameters, apply function) plus per-layer settings: enabled,
// opacity and a mask. Layers evaluate top to bottom. Height layers blend as
//     h' = h + (candidate(h) − h) · mask · opacity
// so a generator, an erosion pass or a river carve all share one mask model, the way Gaea and Substance do it.

import { fbm, ridged, blocky, valueNoise } from './noise.js';
import { fillDepressions, flowReceivers, flowAccumulation, distanceFrom, slopeAndCurvature } from './hydrology.js';

export const TERRAIN_CATEGORIES = [
    { id: 'Generators', label: 'Generators', hint: 'Create height from nothing' },
    { id: 'Rugged', label: 'Rugged', hint: 'Outcrops, cliffs, terraces and strata' },
    { id: 'Erosion', label: 'Erosion', hint: 'Smooth and wear the surface' },
    { id: 'Water', label: 'Water', hint: 'Rivers cut channels; lakes fill basins' },
];

export const TEXTURE_CATEGORIES = [
    { id: 'Base', label: 'Base', hint: 'The ground colour everything else sits on' },
    { id: 'Rock', label: 'Rock', hint: 'Steep and exposed faces' },
    { id: 'Soil', label: 'Soil', hint: 'Flat ground and alluvium' },
    { id: 'Wetness', label: 'Wetness', hint: 'Banks and wet ground near water' },
    { id: 'Snow', label: 'Snow', hint: 'Snow cover above a line' },
    { id: 'Detail', label: 'Detail', hint: 'Grain and breakup' },
];

const NEIGHBOUR_STEPS = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2]];

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (a, b, v) => {
    const t = clamp01((v - a) / (b - a || 1e-9));
    return t * t * (3 - 2 * t);
};
// 1 inside [a, b], feathered by `soft` on each side.
const rangeWeight = (v, a, b, soft) => smoothstep(a - soft, a, v) * (1 - smoothstep(b, b + soft, v));

// ---------------------------------------------------------------------------------------------------------------
// Terrain layer catalogue
// ---------------------------------------------------------------------------------------------------------------

const P = (key, label, min, max, step, unit, value) => ({ key, label, min, max, step, unit, value });

export const TERRAIN_LAYERS = {
    fractal: {
        label: 'Fractal noise', category: 'Generators', icon: 'Mountain', blurb: 'Rolling base relief',
        params: [P('amplitude', 'Amplitude', 0, 400, 1, 'm', 90), P('frequency', 'Frequency', 0.5, 8, 0.1, '/tile', 2.2), P('octaves', 'Octaves', 1, 8, 1, '', 6), P('seed', 'Seed', 0, 99, 1, '', 7)],
        apply(s, p, cand) {
            for (let y = 0; y < s.N; y++) for (let x = 0; x < s.N; x++) {
                const u = x / (s.N - 1) * p.frequency, v = y / (s.N - 1) * p.frequency;
                cand[y * s.N + x] = s.h[y * s.N + x] + p.amplitude * fbm(u, v, { octaves: p.octaves, seed: p.seed });
            }
        },
    },
    ridged: {
        label: 'Ridged mountains', category: 'Generators', icon: 'Mountain', blurb: 'Sharp crests and valleys',
        params: [P('amplitude', 'Amplitude', 0, 400, 1, 'm', 140), P('frequency', 'Frequency', 0.5, 6, 0.1, '/tile', 1.6), P('seed', 'Seed', 0, 99, 1, '', 3)],
        apply(s, p, cand) {
            for (let y = 0; y < s.N; y++) for (let x = 0; x < s.N; x++) {
                const u = x / (s.N - 1) * p.frequency, v = y / (s.N - 1) * p.frequency;
                cand[y * s.N + x] = s.h[y * s.N + x] + p.amplitude * ridged(u, v, { seed: p.seed });
            }
        },
    },
    outcrops: {
        label: 'Rugged outcrops', category: 'Rugged', icon: 'Mountain', blurb: 'Blocky plateaus and risers on the slopes',
        params: [P('amplitude', 'Block height', 0, 60, 0.5, 'm', 18), P('frequency', 'Block scale', 2, 20, 0.5, '/tile', 7), P('levels', 'Steps', 2, 8, 1, '', 4), P('seed', 'Seed', 0, 99, 1, '', 11)],
        apply(s, p, cand) {
            for (let y = 0; y < s.N; y++) for (let x = 0; x < s.N; x++) {
                const u = x / (s.N - 1) * p.frequency, v = y / (s.N - 1) * p.frequency;
                const i = y * s.N + x;
                cand[i] = s.h[i] + p.amplitude * blocky(u, v, { levels: p.levels, seed: p.seed });
            }
        },
    },
    terrace: {
        label: 'Strata terraces', category: 'Rugged', icon: 'Layers', blurb: 'Stepped bedding — flat benches with sharp risers',
        params: [P('step', 'Bed thickness', 2, 60, 0.5, 'm', 14), P('sharpness', 'Riser sharpness', 0, 1, 0.01, '', 0.6)],
        apply(s, p, cand) {
            const step = Math.max(0.5, p.step);
            for (let i = 0; i < s.N * s.N; i++) {
                const t = s.h[i] / step, f = t - Math.floor(t);
                const q = Math.floor(t) + smoothstep(0.5 + 0.5 * p.sharpness, 1, f);
                cand[i] = q * step;
            }
        },
    },
    sharpen: {
        label: 'Sharpen edges', category: 'Rugged', icon: 'Scissors', blurb: 'Pushes crests and breaks lips into cliff edges',
        params: [P('strength', 'Strength', 0, 2, 0.01, '', 0.6), P('radius', 'Radius', 1, 6, 1, 'cells', 2)],
        apply(s, p, cand) {
            const blur = boxBlur(s.h, s.N, p.radius);
            for (let i = 0; i < s.N * s.N; i++) cand[i] = s.h[i] + p.strength * (s.h[i] - blur[i]);
        },
    },
    thermal: {
        label: 'Thermal erosion', category: 'Erosion', icon: 'Wind', blurb: 'Rockfall: material slides past the talus angle',
        params: [P('iterations', 'Iterations', 1, 200, 1, '', 40), P('talus', 'Talus angle', 20, 60, 0.5, 'deg', 35), P('rate', 'Rate', 0, 0.5, 0.01, '', 0.4)],
        apply(s, p, cand) {
            const N = s.N, tan = Math.tan(p.talus * Math.PI / 180);
            const next = new Float32Array(N * N);
            for (let it = 0; it < p.iterations; it++) {
                next.set(cand);
                for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
                    const i = y * N + x;
                    for (const [dx, dy, d] of NEIGHBOUR_STEPS) {
                        const j = (y + dy) * N + (x + dx);
                        const excess = (cand[i] - cand[j]) - tan * d * s.cell;
                        if (excess > 0) {
                            const move = excess * p.rate * 0.5;
                            next[i] -= move;
                            next[j] += move;
                        }
                    }
                }
                cand.set(next);
            }
        },
    },
    rivers: {
        label: 'Rivers', category: 'Water', icon: 'Waves', blurb: 'Carves real channels, with water only inside the cut',
        params: [
            P('catchment', 'Catchment for a river', 0.005, 1, 0.005, 'km²', 0.05),
            P('widthScale', 'Width per √km²', 4, 40, 0.5, 'm', 18),
            P('maxWidth', 'Max width', 10, 200, 1, 'm', 60),
            P('depth', 'Channel depth', 0.5, 30, 0.5, 'm', 6),
            P('waterDepth', 'Water depth', 0.2, 5, 0.1, 'm', 1.2),
        ],
        apply(s, p, cand, out) {
            const N = s.N, cell = s.cell;
            const hyd = s.hydrology(s.h);
            const { filled, down, acc, order } = hyd;
            const areaKm2 = (a) => a * cell * cell / 1e6;
            const channel = new Uint8Array(N * N);
            for (let i = 0; i < N * N; i++) channel[i] = areaKm2(acc[i]) >= p.catchment ? 1 : 0;

            // Bed: monotone downstream so the water surface always grades toward the sea/outlet.
            const bed = new Float32Array(N * N);
            const grade = 0.002 * cell;
            for (const c of order) {
                if (!channel[c]) { bed[c] = s.h[c]; continue; }
                const d = p.depth * Math.min(1, 0.4 + 0.6 * Math.log10(1 + areaKm2(acc[c]) / p.catchment));
                // the bed sits `d` below the ground, but never above the downstream bed plus a gentle grade:
                // a channel can't run uphill, and it can't be cut deeper than its configured depth either
                const r = down[c];
                const downstream = r >= 0 ? bed[r] + grade : -Infinity;
                bed[c] = Math.min(s.h[c] - 0.1, Math.max(s.h[c] - d, downstream));
            }

            // Channel width grows with catchment; each bank cell inherits its nearest channel's bed and width.
            const maxR = p.maxWidth / (2 * cell) + 2;
            const { dist, owner } = distanceFrom(channel, N, maxR);
            const level = out.level;
            for (let i = 0; i < N * N; i++) {
                if (dist[i] > maxR || owner[i] < 0) continue;
                const src = owner[i];
                const width = Math.min(p.maxWidth, Math.max(1.5 * cell, p.widthScale * Math.sqrt(areaKm2(acc[src]))));
                const halfCells = width / (2 * cell);
                if (dist[i] > halfCells) continue;
                const f = 1 - smoothstep(0.55, 1, dist[i] / halfCells);
                const b = bed[src];
                const carved = Math.min(s.h[i], s.h[i] + (b - s.h[i]) * f);
                cand[i] = carved;
                level[i] = Math.max(level[i], b + p.waterDepth);
            }
        },
    },
    lakes: {
        label: 'Lakes', category: 'Water', icon: 'Droplets', blurb: 'Fills closed basins up to their spill level',
        params: [P('minDepth', 'Minimum depth', 0.2, 20, 0.1, 'm', 1.5)],
        apply(s, p, cand, out) {
            const N = s.N;
            const { filled } = s.hydrology(s.h);
            const basin = new Uint8Array(N * N);
            for (let i = 0; i < N * N; i++) basin[i] = filled[i] - s.h[i] > 1e-2 ? 1 : 0;
            // Keep only basins that are deep enough somewhere; each connected basin gets one flat level.
            const seen = new Uint8Array(N * N);
            for (let start = 0; start < N * N; start++) {
                if (!basin[start] || seen[start]) continue;
                const comp = [start];
                seen[start] = 1;
                let maxDepth = 0;
                for (let head = 0; head < comp.length; head++) {
                    const c = comp[head];
                    maxDepth = Math.max(maxDepth, filled[c] - s.h[c]);
                    const cx = c % N, cy = (c - cx) / N;
                    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                        const nx = cx + dx, ny = cy + dy;
                        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
                        const n = ny * N + nx;
                        if (basin[n] && !seen[n]) { seen[n] = 1; comp.push(n); }
                    }
                }
                if (maxDepth < p.minDepth) continue;
                for (const c of comp) out.level[c] = Math.max(out.level[c], filled[c]);
            }
            cand.set(s.h);
        },
    },
};

// Cheap separable box blur over an N×N field (edges clamped).
function boxBlur(src, N, r) {
    const tmp = new Float32Array(N * N), out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        let s = 0, n = 0;
        for (let k = -r; k <= r; k++) { const xx = Math.min(N - 1, Math.max(0, x + k)); s += src[y * N + xx]; n++; }
        tmp[y * N + x] = s / n;
    }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        let s = 0, n = 0;
        for (let k = -r; k <= r; k++) { const yy = Math.min(N - 1, Math.max(0, y + k)); s += tmp[yy * N + x]; n++; }
        out[y * N + x] = s / n;
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Texture layer catalogue
// ---------------------------------------------------------------------------------------------------------------

export const TEXTURE_LAYERS = {
    ground: { label: 'Ground', category: 'Base', icon: 'Layers', blurb: 'Base ground colour', colour: '#8c8473', params: [] },
    rock: { label: 'Exposed rock', category: 'Rock', icon: 'Mountain', blurb: 'Steep faces show bare rock', colour: '#6f6a64', params: [], mask: { slope: [32, 90] } },
    soil: { label: 'Soil & alluvium', category: 'Soil', icon: 'Layers', blurb: 'Gentle ground takes soil colour', colour: '#8f7a55', params: [], mask: { slope: [0, 12] } },
    banks: { label: 'Wet banks', category: 'Wetness', icon: 'Droplets', blurb: 'Dark, damp ground beside water', colour: '#4e4636', params: [], mask: { waterDist: [0, 6] } },
    snow: { label: 'Snow', category: 'Snow', icon: 'Mountain', blurb: 'Snow cover above a line', colour: '#e8ecef', params: [], mask: { height: [60, 1e6] } },
    grain: { label: 'Grain breakup', category: 'Detail', icon: 'Sparkles', blurb: 'Noise breakup to stop flat colour', colour: '#a09585', params: [], mask: { noise: 0.5 } },
};

// Mask defaults (neutral): every range open, no noise.
export function defaultMask() {
    return { slope: [0, 90], height: [-1e6, 1e6], waterDist: [0, 1e6], noise: 0, invert: false, noiseScale: 4, seed: 5 };
}

export function makeTerrainLayer(type, id) {
    const spec = TERRAIN_LAYERS[type];
    const params = Object.fromEntries(spec.params.map((q) => [q.key, q.value]));
    return { id, type, enabled: true, opacity: 1, params, mask: defaultMask() };
}

export function makeTextureLayer(type, id) {
    const spec = TEXTURE_LAYERS[type];
    const mask = Object.assign(defaultMask(), spec.mask || {});
    return { id, type, enabled: true, opacity: 1, colour: spec.colour, mask };
}

// Default stacks: a usable starting point, so the viewport is never empty.
export function defaultTerrainStack() {
    return [
        makeTerrainLayer('fractal', 'L1'),
        makeTerrainLayer('ridged', 'L2'),
        { ...makeTerrainLayer('outcrops', 'L3'), opacity: 0.6 },
        makeTerrainLayer('thermal', 'L4'),
        makeTerrainLayer('rivers', 'L5'),
        makeTerrainLayer('lakes', 'L6'),
    ];
}

export function defaultTextureStack() {
    return [
        makeTextureLayer('ground', 'T1'),
        makeTextureLayer('soil', 'T2'),
        makeTextureLayer('rock', 'T3'),
        makeTextureLayer('banks', 'T4'),
        makeTextureLayer('snow', 'T5'),
        makeTextureLayer('grain', 'T6'),
    ];
}

// ---------------------------------------------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------------------------------------------

function layerMask(mask, h, slope, waterDist, N, cell, i, x, y) {
    let m = 1;
    if (mask.slope) m *= rangeWeight(slope[i], mask.slope[0], mask.slope[1], 1.5);
    if (mask.height) m *= rangeWeight(h[i], mask.height[0], mask.height[1], 0.5);
    if (mask.waterDist && waterDist) m *= rangeWeight(waterDist[i], mask.waterDist[0], mask.waterDist[1], 1.5);
    if (mask.noise > 0) {
        const n = valueNoise(x / (N - 1) * mask.noiseScale, y / (N - 1) * mask.noiseScale, mask.seed);
        m *= 1 - mask.noise * (1 - n);
    }
    return mask.invert ? 1 - m : m;
}

// Evaluate the terrain stack. Returns the heightfield, a water-level field (NaN where dry) and the slope map.
export function evaluateTerrain(stack, { N = 256, size = 1000 } = {}) {
    const cell = size / (N - 1);
    let h = new Float32Array(N * N);
    const level = new Float32Array(N * N).fill(-Infinity);
    let cache = null;
    const s = {
        N, cell, size, h,
        hydrology(height) {
            if (cache && cache.key === height) return cache.value;
            const filled = fillDepressions(height, N);
            const down = flowReceivers(filled, N, cell);
            const acc = flowAccumulation(filled, down, N);
            const order = Array.from({ length: N * N }, (_, i) => i).sort((a, b) => filled[a] - filled[b]);
            const value = { filled, down, acc, order };
            cache = { key: height, value };
            return value;
        },
    };
    for (const layer of stack) {
        if (!layer.enabled || layer.opacity <= 0) continue;
        const spec = TERRAIN_LAYERS[layer.type];
        if (!spec) continue;
        s.h = h;
        // the candidate starts as the current ground, so cells a layer does not touch are unchanged
        const cand = Float32Array.from(h);
        const out = { level };
        spec.apply(s, layer.params, cand, out);
        const { slope } = slopeAndCurvature(h, N, cell);
        const next = new Float32Array(N * N);
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
            const i = y * N + x;
            const m = layerMask(layer.mask, h, slope, null, N, cell, i, x, y) * layer.opacity;
            next[i] = h[i] + (cand[i] - h[i]) * m;
        }
        h = next;
    }
    // Final water: a cell is wet when the (final) ground sits below the level its water layer set.
    const water = new Float32Array(N * N).fill(NaN);
    for (let i = 0; i < N * N; i++) {
        if (level[i] > -Infinity && h[i] < level[i] - 0.01) water[i] = level[i];
    }
    const { slope } = slopeAndCurvature(h, N, cell);
    return { N, cell, size, height: h, water, slope };
}

// Evaluate the texture stack into RGB (0..1) per cell, given the terrain result.
export function evaluateTexture(stack, terrain) {
    const { N, cell, height: h, slope, water } = terrain;
    const rgb = new Float32Array(N * N * 3);
    // distance (m) from each cell to the nearest wet cell
    const wet = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) wet[i] = Number.isNaN(water[i]) ? 0 : 1;
    const { dist } = distanceFrom(wet, N, 40 / cell);
    const waterDist = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) waterDist[i] = dist[i] * cell;

    let first = true;
    for (const layer of stack) {
        if (!layer.enabled || layer.opacity <= 0) continue;
        const col = hexToRgb(layer.colour);
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
            const i = y * N + x;
            let m = layerMask(layer.mask, h, slope, waterDist, N, cell, i, x, y) * layer.opacity;
            if (first) m = 1;
            const k = i * 3;
            rgb[k] += (col[0] - rgb[k]) * m;
            rgb[k + 1] += (col[1] - rgb[k + 1]) * m;
            rgb[k + 2] += (col[2] - rgb[k + 2]) * m;
        }
        first = false;
    }
    return rgb;
}

export function hexToRgb(hex) {
    const v = parseInt(hex.replace('#', ''), 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
