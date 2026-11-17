import earcut from "./earcut.js";
import { add, mul, sub, distance, normalizeXZ, lerp, } from "./math.js";
/** A section sweep, including physical thickness and end caps. Profile
 * coordinates are metres, not a painted flat line or a billboard.
 */
function sweep(b, path, normals, profile, material, heightAt = () => 0, scaleY = false) {
    const rows = profile.map(([x, y]) => path.map((p, i) => add(p, add(mul(normals[i], x), [
        0,
        scaleY
            ? y * heightAt(i / (path.length - 1))
            : y + heightAt(i / (path.length - 1)),
        0,
    ]))));
    for (let i = 0; i < rows.length; i++)
        b.strip("rail", material, rows[i], rows[(i + 1) % rows.length]);
    const indices = earcut(profile.flat(), undefined, 2);
    for (const end of [0, path.length - 1])
        b.append("rail", material, rows.map((r) => r[end]), end === 0
            ? indices
            : indices.map((v, i) => indices[i - (i % 3) + (2 - (i % 3))]));
}
const rectangle = (w, lo, hi) => [
    [-w / 2, lo],
    [w / 2, lo],
    [w / 2, hi],
    [-w / 2, hi],
];
function cable(b, path, normals, level, height, r = 0.009) {
    const circle = Array.from({ length: 8 }, (_, i) => [
        Math.cos((i * Math.PI) / 4) * r,
        Math.sin((i * Math.PI) / 4) * r,
    ]);
    sweep(b, path, normals, circle, "steel", (t) => height(t) * level);
}
function atDistance(path, normals, stations, s) {
    const i = Math.max(1, stations.findIndex((d) => d >= s)), t = (s - stations[i - 1]) / Math.max(1e-8, stations[i] - stations[i - 1]);
    return {
        p: lerp(path[i - 1], path[i], t),
        n: normalizeXZ(lerp(normals[i - 1], normals[i], t)),
        d: normalizeXZ(sub(path[i], path[i - 1])),
    };
}
export function buildBarrierPath(b, path, normals, height, style, spacing, detail = "editing") {
    if (path.length < 2)
        return;
    const stations = [0];
    for (let i = 1; i < path.length; i++)
        stations.push(stations[i - 1] + distance(path[i], path[i - 1]));
    const length = stations.at(-1);
    if (length < 0.02)
        return;
    if (style === "concrete") {
        sweep(b, path, normals, [
            [-0.32, 0],
            [-0.24, 0.22],
            [-0.11, 0.82],
            [-0.1, 1],
            [0.1, 1],
            [0.11, 0.82],
            [0.24, 0.22],
            [0.32, 0],
        ], "curb", height, true);
        // Expansion seams remain metric along straight/curved runs.
        for (let s = 5; s < length - 0.5; s += 5) {
            const { p, n, d } = atDistance(path, normals, stations, s), h = height(s / length);
            b.box("rail", "steel-dark", add(p, [0, h - 0.015, 0]), 0.19, 0.014, 0.014, d);
            for (const side of [-1, 1])
                b.box("rail", "steel-dark", add(p, add(mul(n, side * 0.106), [0, h * 0.86, 0])), 0.012, h * 0.25, 0.012, d);
        }
        return;
    }
    if (style === "wbeam" || style === "thrie") {
        const waves = style === "thrie" ? 3 : 2, half = style === "thrie" ? 0.25 : 0.16;
        const face = Array.from({ length: waves * 2 + 1 }, (_, i) => [
            i % 2 ? 0.04 : -0.035,
            -half + (i * 2 * half) / (waves * 2),
        ]);
        const section = [
            ...face,
            ...face.map(([x, y]) => [x - 0.004, y]).reverse(),
        ];
        sweep(b, path, normals, section, "steel", (t) => height(t) - half);
    }
    else if (style === "boxbeam") {
        // A hollow box section with an open annular cap: not a solid square beam.
        const outer = rectangle(0.16, -0.1, 0.1), inner = rectangle(0.145, -0.086, 0.086);
        const rows = (profile) => profile.map(([x, y]) => path.map((p, i) => add(p, add(mul(normals[i], x), [
            0,
            height(i / (path.length - 1)) - 0.1 + y,
            0,
        ]))));
        const o = rows(outer), inn = rows(inner);
        for (let i = 0; i < 4; i++) {
            b.strip("rail", "steel", o[i], o[(i + 1) % 4]);
            b.strip("rail", "steel-dark", inn[(i + 1) % 4], inn[i]);
            for (const end of [0, path.length - 1])
                b.quad("rail", "steel", [
                    o[i][end],
                    o[(i + 1) % 4][end],
                    inn[(i + 1) % 4][end],
                    inn[i][end],
                ]);
        }
    }
    else if (style === "cable") {
        for (const level of [0.3, 0.5, 0.7, 0.9])
            cable(b, path, normals, level, height);
    }
    else if (style === "railing") {
        for (const level of [0.38, 0.7, 0.97])
            sweep(b, path, normals, rectangle(0.046, -0.023, 0.023), "pole", (t) => height(t) * level);
    }
    else if (style === "parapet") {
        sweep(b, path, normals, rectangle(0.24, 0, 0.2), "concrete");
        cable(b, path, normals, 0.96, height, 0.033);
        cable(b, path, normals, 0.28, height, 0.024);
        for (let s = 0.12; s < length - 0.08; s += 0.18) {
            const { p, d } = atDistance(path, normals, stations, s), h = height(s / length);
            b.box("rail", "pole", add(p, [0, (h * 0.93 + 0.23) / 2, 0]), 0.018, h * 0.93 - 0.23, 0.022, d);
        }
    }
    const pitch = style === "parapet" || style === "railing"
        ? Math.min(spacing, 2.5)
        : spacing;
    for (let s = Math.min(0.3, length / 3); s < length - 0.15; s += pitch) {
        const { p, n, d } = atDistance(path, normals, stations, s), h = height(s / length), postMaterial = style === "railing" || style === "parapet" ? "pole" : "steel-dark";
        const thick = style === "parapet" || style === "railing" ? 0.065 : 0.12;
        b.box("rail", postMaterial, add(p, add(mul(n, -0.06), [0, h / 2 - 0.04, 0])), thick, h + 0.08, 0.15, d);
        if (style === "wbeam" || style === "thrie" || style === "boxbeam") {
            const mount = style === "thrie" ? 0.25 : style === "boxbeam" ? 0.1 : 0.16;
            b.box("rail", "steel-dark", add(p, add(mul(n, -0.02), [0, h - mount, 0])), 0.12, 0.17, 0.12, d);
            // Two attachment heads and an occasional reflector plate.
            if (detail === "production" || Math.floor(s / pitch) % 4 === 0)
                for (const dy of [-0.09, 0.05])
                    b.box("rail", "steel", add(p, add(mul(n, 0.045), [0, h - mount + dy, 0])), 0.04, 0.04, 0.012, d);
            if (Math.floor(s / pitch) % 4 === 0)
                b.box("rail", "paint", add(p, add(mul(n, 0.059), [0, h - mount + 0.02, 0])), 0.075, 0.06, 0.01, d);
        }
        else if (style === "cable") {
            for (const level of [0.3, 0.5, 0.7, 0.9])
                b.box("rail", "steel", add(p, [0, h * level, 0]), 0.15, 0.024, 0.05, d);
        }
        if (style === "parapet" || style === "railing")
            b.box("rail", "steel", add(p, [0, 0.015, 0]), 0.16, 0.03, 0.19, d);
    }
}
