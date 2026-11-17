/** Small, bounded polynomial operations for cubic alignment analysis.
 * Coefficients are in ascending power order. No geometry/model dependencies.
 */
export function polynomialValue(c, t) {
    let value = 0;
    for (let i = c.length - 1; i >= 0; i--)
        value = value * t + c[i];
    return value;
}
export function polynomialDerivative(c) {
    return c.length > 1 ? c.slice(1).map((v, i) => v * (i + 1)) : [0];
}
export function polynomialProduct(a, b) {
    const c = Array(a.length + b.length - 1).fill(0);
    for (let i = 0; i < a.length; i++)
        for (let j = 0; j < b.length; j++)
            c[i + j] += a[i] * b[j];
    return c;
}
export function polynomialSum(a, b, factor = 1) {
    return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? 0) + factor * (b[i] ?? 0));
}
export function polynomialScale(a, factor) {
    return a.map((v) => v * factor);
}
export function uniqueParameters(values, tolerance = 2e-11) {
    const sorted = values
        .filter(Number.isFinite)
        .map((t) => Math.min(1, Math.max(0, t)))
        .sort((a, b) => a - b);
    return sorted.filter((t, i) => !i || t - sorted[i - 1] > tolerance);
}
/** Taylor coefficients around t. Degree is at most five in this application. */
export function polynomialTaylor(c, t) {
    const out = [];
    let derivative = [...c], factorial = 1;
    for (let j = 0; j < c.length; j++) {
        if (j)
            factorial *= j;
        out.push(polynomialValue(derivative, t) / factorial);
        derivative = polynomialDerivative(derivative);
    }
    return out;
}
function normalized(c) {
    const scale = Math.max(0, ...c.map(Math.abs));
    if (!scale)
        return [0];
    const a = c.map((v) => v / scale);
    while (a.length > 1 && Math.abs(a.at(-1)) < 4e-15)
        a.pop();
    return a;
}
/** Isolate all real roots on [0,1] by derivative critical points. Monotonic
 * intervals permit bounded bisection; checking their endpoints retains repeated
 * roots that a sign-change scan alone would miss. A constant zero polynomial
 * has no isolated roots and returns an empty list.
 */
export function polynomialRoots(c) {
    const a = normalized(c), degree = a.length - 1;
    if (!degree)
        return [];
    if (degree === 1) {
        const t = -a[0] / a[1];
        return t >= -2e-14 && t <= 1 + 2e-14 ? [Math.min(1, Math.max(0, t))] : [];
    }
    if (degree === 2) {
        const [C, B, A] = a, discriminant = B * B - 4 * A * C;
        if (discriminant < -2e-14)
            return [];
        const d = Math.sqrt(Math.abs(discriminant) <= 2e-14 ? 0 : Math.max(0, discriminant));
        if (d < 1e-14) {
            const t = -B / (2 * A);
            return t >= -2e-14 && t <= 1 + 2e-14 ? [Math.min(1, Math.max(0, t))] : [];
        }
        const q = -0.5 * (B + (B >= 0 ? d : -d)), roots = q ? [q / A, C / q] : [-B / (2 * A)];
        return uniqueParameters(roots.filter((t) => t >= -2e-14 && t <= 1 + 2e-14));
    }
    const knots = uniqueParameters([
        0,
        ...polynomialRoots(polynomialDerivative(a)),
        1,
    ]), roots = [];
    for (const t of knots)
        if (Math.abs(polynomialValue(a, t)) < 8e-14)
            roots.push(t);
    for (let i = 1; i < knots.length; i++) {
        let lo = knots[i - 1], hi = knots[i], fLo = polynomialValue(a, lo);
        const fHi = polynomialValue(a, hi);
        if (Math.abs(fLo) < 8e-14 ||
            Math.abs(fHi) < 8e-14 ||
            Math.sign(fLo) === Math.sign(fHi))
            continue;
        for (let j = 0; j < 64 && hi - lo > 4e-15; j++) {
            const mid = (lo + hi) / 2, f = polynomialValue(a, mid);
            if (f === 0) {
                lo = hi = mid;
                break;
            }
            if (Math.sign(f) === Math.sign(fLo)) {
                lo = mid;
                fLo = f;
            }
            else
                hi = mid;
        }
        roots.push((lo + hi) / 2);
    }
    return uniqueParameters(roots);
}
