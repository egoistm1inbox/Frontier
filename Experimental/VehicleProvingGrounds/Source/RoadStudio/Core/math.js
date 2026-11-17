export const add = (a, b) => [
    a[0] + b[0],
    a[1] + b[1],
    a[2] + b[2],
];
export const sub = (a, b) => [
    a[0] - b[0],
    a[1] - b[1],
    a[2] - b[2],
];
export const mul = (v, s) => [v[0] * s, v[1] * s, v[2] * s];
export const lerp = (a, b, t) => add(mul(a, 1 - t), mul(b, t));
export const length = (v) => Math.hypot(...v);
export const distance = (a, b) => length(sub(a, b));
export const distanceXZ = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
export const dotXZ = (a, b) => a[0] * b[0] + a[2] * b[2];
export const crossXZ = (a, b) => a[0] * b[2] - a[2] * b[0];
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const normalizeXZ = (v) => {
    const l = Math.hypot(v[0], v[2]);
    return l > 1e-9 ? [v[0] / l, 0, v[2] / l] : [1, 0, 0];
};
export const normalXZ = (d) => [-d[2], 0, d[0]];
export const cubic = (p, t) => {
    const u = 1 - t;
    return [0, 1, 2].map((k) => u ** 3 * p[0][k] +
        3 * u * u * t * p[1][k] +
        3 * u * t * t * p[2][k] +
        t ** 3 * p[3][k]);
};
export const derivative = (p, t) => {
    const u = 1 - t;
    return [0, 1, 2].map((k) => 3 * u * u * (p[1][k] - p[0][k]) +
        6 * u * t * (p[2][k] - p[1][k]) +
        3 * t * t * (p[3][k] - p[2][k]));
};
export function splitCubic(p, t) {
    const a = lerp(p[0], p[1], t), b = lerp(p[1], p[2], t), c = lerp(p[2], p[3], t);
    const d = lerp(a, b, t), e = lerp(b, c, t), f = lerp(d, e, t);
    return [
        [p[0], a, d, f],
        [f, e, c, p[3]],
    ];
}
export function segmentIntersection(a, b, c, d) {
    const r = sub(b, a), s = sub(d, c), det = crossXZ(r, s);
    if (Math.abs(det) < 1e-10)
        return null;
    const q = sub(c, a), t = crossXZ(q, s) / det, u = crossXZ(q, r) / det;
    return t >= -1e-7 && t <= 1 + 1e-7 && u >= -1e-7 && u <= 1 + 1e-7
        ? [clamp(t, 0, 1), clamp(u, 0, 1)]
        : null;
}
export function nearestSegment(p, a, b) {
    const ab = sub(b, a), d = dotXZ(ab, ab);
    const t = d < 1e-12 ? 0 : clamp(dotXZ(sub(p, a), ab) / d, 0, 1);
    const point = lerp(a, b, t);
    return { t, point, distance: distanceXZ(p, point) };
}
export function polygonArea(p) {
    return p.reduce((s, a, i) => s + crossXZ(a, p[(i + 1) % p.length]), 0) * 0.5;
}
export function resampleLine(p, count) {
    const lengths = [0];
    for (let i = 1; i < p.length; i++)
        lengths.push(lengths[i - 1] + distance(p[i - 1], p[i]));
    const total = lengths.at(-1);
    if (total < 1e-8)
        return Array.from({ length: count }, () => [...p[0]]);
    let j = 0;
    return Array.from({ length: count }, (_, i) => {
        const s = (total * i) / (count - 1);
        while (j < p.length - 2 && lengths[j + 1] < s)
            j++;
        return lerp(p[j], p[j + 1], (s - lengths[j]) / Math.max(1e-9, lengths[j + 1] - lengths[j]));
    });
}
export function simplePolygon(p) {
    for (let i = 0; i < p.length; i++)
        for (let j = i + 2; j < p.length; j++) {
            if (i === 0 && j === p.length - 1)
                continue;
            const hit = segmentIntersection(p[i], p[(i + 1) % p.length], p[j], p[(j + 1) % p.length]);
            if (hit &&
                hit[0] > 1e-5 &&
                hit[0] < 1 - 1e-5 &&
                hit[1] > 1e-5 &&
                hit[1] < 1 - 1e-5)
                return false;
        }
    return true;
}
