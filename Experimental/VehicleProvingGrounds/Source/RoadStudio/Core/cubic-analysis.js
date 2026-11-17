import { polynomialValue as value, polynomialDerivative as derivative, polynomialProduct as product, polynomialSum as sum, polynomialScale as scale, polynomialRoots as roots, polynomialTaylor as taylor, uniqueParameters, } from "./polynomial.js";
const CACHE_LIMIT = 512, EPS = 2e-12;
const cache = new Map();
const norm = (c) => Math.max(0, ...c.map(Math.abs));
const clean = (v) => (v === 0 ? 0 : v);
function velocity(points, axis) {
    const c = 3 * (points[1][axis] - points[0][axis]), b = 6 * (points[2][axis] - 2 * points[1][axis] + points[0][axis]), a = 3 *
        (points[3][axis] -
            3 * points[2][axis] +
            3 * points[1][axis] -
            points[0][axis]);
    return [c, b, a];
}
function stopOrder(d, t) {
    const x = taylor(d.x, t), z = taylor(d.z, t), y = taylor(d.y, t);
    const order = x.findIndex((v, i) => Math.hypot(v, z[i]) > EPS), yOrder = y.findIndex((v) => Math.abs(v) > EPS);
    return { x, z, y, order, yOrder };
}
function gradeAt(d, t) {
    if (!d.planScale)
        return d.yScale ? null : 0;
    const speed = Math.hypot(value(d.x, t), value(d.z, t));
    if (speed > EPS)
        return (100 * d.yScale * Math.abs(value(d.y, t))) / (d.planScale * speed);
    const limit = stopOrder(d, t);
    if (!d.yScale || limit.yOrder < 0 || limit.yOrder > limit.order)
        return 0;
    if (limit.order < 0 || limit.yOrder < limit.order)
        return null;
    return ((100 * d.yScale * Math.abs(limit.y[limit.order])) /
        (d.planScale * Math.hypot(limit.x[limit.order], limit.z[limit.order])));
}
function radiusAt(d, t) {
    if (!d.planScale)
        return 0;
    const x = value(d.x, t), z = value(d.z, t), speed = Math.hypot(x, z);
    if (speed > EPS) {
        const determinant = x * (d.z[1] + 2 * d.z[2] * t) - z * (d.x[1] + 2 * d.x[2] * t);
        return Math.abs(determinant) > 1e-20
            ? (d.planScale * speed ** 3) / Math.abs(determinant)
            : Infinity;
    }
    const { x: tx, z: tz, order } = stopOrder(d, t);
    if (order < 0)
        return 0;
    if (t > 1e-10 && t < 1 - 1e-10 && order % 2)
        return 0;
    const k = taylor(d.determinant, t), threshold = Math.max(1e-15, norm(d.determinant) * 2e-12), kOrder = k.findIndex((v) => Math.abs(v) > threshold);
    if (kOrder < 0)
        return Infinity;
    const exponent = 3 * order - kOrder;
    return exponent > 0
        ? 0
        : exponent < 0
            ? Infinity
            : (d.planScale * Math.hypot(tx[order], tz[order]) ** 3) /
                Math.abs(k[kOrder]);
}
function differential(points) {
    const key = points.flat().map(clean).join(","), stored = cache.get(key);
    if (stored) {
        cache.delete(key);
        cache.set(key, stored);
        return stored;
    }
    const vx = velocity(points, 0), vz = velocity(points, 2), vy = velocity(points, 1), planScale = Math.max(norm(vx), norm(vz)), yScale = norm(vy), x = planScale ? scale(vx, 1 / planScale) : [0, 0, 0], z = planScale ? scale(vz, 1 / planScale) : [0, 0, 0], y = yScale ? scale(vy, 1 / yScale) : [0, 0, 0], q = sum(product(x, x), product(z, z)), qPrime = derivative(q), determinant = [
        x[0] * z[1] - z[0] * x[1],
        2 * (x[0] * z[2] - z[0] * x[2]),
        x[1] * z[2] - z[1] * x[2],
    ], speedExtrema = roots(qPrime), stops = uniqueParameters([
        0,
        1,
        ...roots(x),
        ...roots(z),
        ...speedExtrema,
    ]).filter((t) => Math.hypot(value(x, t), value(z, t)) < EPS), 
    // Stationary points of |K| / Q^(3/2) and |Y'| / sqrt(Q).
    candidatesRadius = uniqueParameters([
        0,
        1,
        ...roots(sum(scale(product(derivative(determinant), q), 2), scale(product(determinant, qPrime), 3), -1)),
        ...speedExtrema,
        ...stops,
    ]), candidatesGrade = uniqueParameters([
        0,
        1,
        ...roots(sum(scale(product(derivative(y), q), 2), product(y, qPrime), -1)),
        ...speedExtrema,
        ...stops,
    ]);
    const d = {
        x,
        z,
        y,
        planScale,
        yScale,
        determinant,
        stops,
        speedExtrema,
        candidatesRadius,
        candidatesGrade,
        inflections: roots(determinant),
        issues: [],
        minimumRadius: null,
        minimumRadiusParameter: null,
        maximumGrade: 0,
        maximumGradeParameter: 0,
    };
    if (!planScale)
        d.issues.push({ kind: "collapsed-plan", parameter: 0 });
    for (const t of stops) {
        const { order } = stopOrder(d, t), grade = gradeAt(d, t), radius = radiusAt(d, t);
        if (grade === null)
            d.issues.push({ kind: "vertical-tangent", parameter: t });
        if (t > 1e-10 && t < 1 - 1e-10 && order > 0 && order % 2)
            d.issues.push({ kind: "plan-reversal", parameter: t });
        else if (order > 0 && radius === 0)
            d.issues.push({ kind: "zero-radius-tangent", parameter: t });
    }
    let minimum = Infinity;
    for (const t of candidatesRadius) {
        const radius = radiusAt(d, t);
        if (radius < minimum) {
            minimum = radius;
            d.minimumRadiusParameter = t;
        }
    }
    d.minimumRadius = Number.isFinite(minimum) ? clean(minimum) : null;
    for (const t of candidatesGrade) {
        const grade = gradeAt(d, t);
        if (grade === null) {
            d.maximumGrade = null;
            d.maximumGradeParameter = t;
            break;
        }
        if (grade > d.maximumGrade) {
            d.maximumGrade = clean(grade);
            d.maximumGradeParameter = t;
        }
    }
    cache.set(key, d);
    if (cache.size > CACHE_LIMIT)
        cache.delete(cache.keys().next().value);
    return d;
}
function integratePlan(d) {
    if (!d.planScale)
        return 0;
    const speed = (t) => d.planScale * Math.hypot(value(d.x, t), value(d.z, t)), simpson = (a, z, fa, fm, fz) => ((z - a) * (fa + 4 * fm + fz)) / 6;
    const adaptive = (a, z, fa, fm, fz, prior, tolerance, depth) => {
        const m = (a + z) / 2, fl = speed((a + m) / 2), fr = speed((m + z) / 2), left = simpson(a, m, fa, fl, fm), right = simpson(m, z, fm, fr, fz), delta = left + right - prior;
        if (!depth || Math.abs(delta) <= 15 * tolerance)
            return left + right + delta / 15;
        return (adaptive(a, m, fa, fl, fm, left, tolerance / 2, depth - 1) +
            adaptive(m, z, fm, fr, fz, right, tolerance / 2, depth - 1));
    };
    const knots = uniqueParameters([0, ...d.speedExtrema, ...d.stops, 1]);
    let length = 0;
    for (let i = 1; i < knots.length; i++) {
        const a = knots[i - 1], z = knots[i], fa = speed(a), fm = speed((a + z) / 2), fz = speed(z);
        length += adaptive(a, z, fa, fm, fz, simpson(a, z, fa, fm, fz), 1e-5 * (z - a), 18);
    }
    return clean(Math.max(0, length));
}
/** Numerical roots of the exact cubic derivative equations, not a fixed grid.
 * Returned arrays are copies: mutating an API result cannot corrupt the cache.
 */
export function analyzeCubic(points) {
    const d = differential(points);
    d.planLength ??= integratePlan(d);
    return {
        planLength: d.planLength,
        minimumRadius: d.minimumRadius,
        minimumRadiusParameter: d.minimumRadiusParameter,
        maximumGrade: d.maximumGrade,
        maximumGradeParameter: d.maximumGradeParameter,
        stationaryParameters: [...d.stops],
        criticalParameters: criticalCurveParameters(points),
        issues: d.issues.map((i) => ({ ...i })),
        method: "polynomial-extrema",
    };
}
/** Mesh knots are LOD independent, including stationary/inflection points and
 * the actual controlling radius/grade positions. Extra candidates never alter
 * the editable cubic or turn a monotone stationary straight into a reversal.
 */
export function criticalCurveParameters(points) {
    const d = differential(points);
    return uniqueParameters([
        ...(d.minimumRadiusParameter === null ? [] : [d.minimumRadiusParameter]),
        d.maximumGradeParameter,
        ...d.stops,
        ...d.inflections,
    ]).filter((t) => t > 1e-12 && t < 1 - 1e-12);
}
export function cubicProfile(points) {
    const d = differential(points);
    return {
        radiusAt: (t) => radiusAt(d, t),
        gradeAt: (t) => gradeAt(d, t),
        tangentAt: (t) => {
            const x = value(d.x, t), z = value(d.z, t), speed = Math.hypot(x, z);
            if (speed > EPS)
                return [clean(x / speed), 0, clean(z / speed)];
            const limit = stopOrder(d, t);
            if (limit.order < 0)
                return null;
            const sign = t >= 1 - 1e-12 && limit.order % 2 ? -1 : 1, length = Math.hypot(limit.x[limit.order], limit.z[limit.order]);
            return [
                clean((sign * limit.x[limit.order]) / length),
                0,
                clean((sign * limit.z[limit.order]) / length),
            ];
        },
        signedGradeAt: (t) => {
            const grade = gradeAt(d, t);
            if (grade === null || grade === 0)
                return grade;
            const speed = Math.hypot(value(d.x, t), value(d.z, t));
            if (speed > EPS)
                return clean(Math.sign(value(d.y, t)) * grade);
            const limit = stopOrder(d, t), sign = t >= 1 - 1e-12 && limit.order % 2 ? -1 : 1;
            return clean(sign * Math.sign(limit.y[limit.order]) * grade);
        },
    };
}
