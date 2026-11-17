export const area2 = (p) => p.reduce((sum, a, i) => {
    const b = p[(i + 1) % p.length];
    return sum + a[0] * b[1] - b[0] * a[1];
}, 0) / 2;
export function centroid2(p) {
    const area = area2(p);
    if (Math.abs(area) < 1e-9)
        return [0, 0];
    const sum = p.reduce((s, a, i) => {
        const b = p[(i + 1) % p.length], w = a[0] * b[1] - b[0] * a[1];
        return [s[0] + (a[0] + b[0]) * w, s[1] + (a[1] + b[1]) * w];
    }, [0, 0]);
    return [sum[0] / (6 * area), sum[1] / (6 * area)];
}
export function compact2(p, eps = 1e-8) {
    const out = p.filter((v, i) => !i || Math.hypot(v[0] - p[i - 1][0], v[1] - p[i - 1][1]) > eps);
    if (out.length > 1 &&
        Math.hypot(out[0][0] - out.at(-1)[0], out[0][1] - out.at(-1)[1]) < eps)
        out.pop();
    return out;
}
/** Sutherland–Hodgman clipping for convex metric footprints; either winding. */
export function clipConvex2(subject, mask) {
    if (subject.length < 3 || mask.length < 3)
        return [];
    const sign = Math.sign(area2(mask));
    if (!sign)
        return [];
    let out = subject.map((p) => [...p]);
    for (let i = 0; i < mask.length && out.length; i++) {
        const a = mask[i], b = mask[(i + 1) % mask.length], distance = (p) => ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) * sign, input = out;
        out = [];
        let previous = input.at(-1), dp = distance(previous);
        for (const current of input) {
            const dc = distance(current), inside = dc >= -1e-9, before = dp >= -1e-9;
            if (inside !== before) {
                const t = dp / (dp - dc);
                out.push([
                    previous[0] + (current[0] - previous[0]) * t,
                    previous[1] + (current[1] - previous[1]) * t,
                ]);
            }
            if (inside)
                out.push(current);
            previous = current;
            dp = dc;
        }
        out = compact2(out);
    }
    return out.length >= 3 && Math.abs(area2(out)) > 1e-8 ? out : [];
}
export function rect2(x, z, width, depth) {
    return [
        [x - width / 2, z - depth / 2],
        [x + width / 2, z - depth / 2],
        [x + width / 2, z + depth / 2],
        [x - width / 2, z + depth / 2],
    ];
}
export function inside2(p, q, epsilon = 1e-8) {
    const sign = Math.sign(area2(p));
    return (p.length >= 3 &&
        p.every((a, i) => {
            const b = p[(i + 1) % p.length];
            return (((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])) *
                sign >=
                -epsilon);
        }));
}
/** Positive-area overlap. Touching edges are not a clearance collision. */
export const bounds2 = (p) => ({
    minX: Math.min(...p.map((v) => v[0])),
    maxX: Math.max(...p.map((v) => v[0])),
    minZ: Math.min(...p.map((v) => v[1])),
    maxZ: Math.max(...p.map((v) => v[1])),
});
export const overlap2 = (a, b, epsilon = 1e-6) => {
    if (a.length < 3 || b.length < 3)
        return false;
    const x = bounds2(a), y = bounds2(b);
    if (x.maxX <= y.minX + 1e-9 ||
        y.maxX <= x.minX + 1e-9 ||
        x.maxZ <= y.minZ + 1e-9 ||
        y.maxZ <= x.minZ + 1e-9)
        return false;
    return Math.abs(area2(clipConvex2(a, b))) > epsilon;
};
/** Boundary hit of a cardinal ray through the selected tangent coordinate. */
export function axisBoundary2(p, tangent, axis, maximum) {
    const cross = axis === 0 ? 1 : 0, values = [];
    for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length], lo = Math.min(a[cross], b[cross]), hi = Math.max(a[cross], b[cross]);
        if (tangent < lo - 1e-8 || tangent > hi + 1e-8)
            continue;
        if (Math.abs(a[cross] - b[cross]) < 1e-9) {
            values.push(a[axis], b[axis]);
            continue;
        }
        const t = (tangent - a[cross]) / (b[cross] - a[cross]);
        values.push(a[axis] + (b[axis] - a[axis]) * t);
    }
    return values.length
        ? maximum
            ? Math.max(...values)
            : Math.min(...values)
        : undefined;
}
