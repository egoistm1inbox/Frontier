import { criticalCurveParameters, cubicProfile } from "./cubic-analysis.js";
import { add, sub, cubic, normalizeXZ, normalXZ, distance, nearestSegment, lerp, clamp, splitCubic, } from "./math.js";
import { controlPoints } from "./model.js";
const profiles = new WeakMap();
function alignmentProfile(a) {
    let profile = profiles.get(a);
    if (!profile) {
        profile = cubicProfile(a.points);
        profiles.set(a, profile);
    }
    return profile;
}
export function sampleAlignment(project, road, profile = { maxSegment: 2.8, maxDeviation: 0.045 }) {
    const points = controlPoints(project, road).map((p) => [...p]), differential = cubicProfile(points);
    const sampled = [{ p: points[0], t: 0 }];
    const subdivide = (p, ta, tb, depth) => {
        const chord = distance(p[0], p[3]);
        const flatness = Math.max(nearestSegment(p[1], p[0], p[3]).distance, nearestSegment(p[2], p[0], p[3]).distance);
        if (depth >= (profile.maxDepth ?? 12) ||
            (chord <= profile.maxSegment &&
                flatness <= profile.maxDeviation &&
                distance(p[0], p[1]) + distance(p[1], p[2]) + distance(p[2], p[3]) <=
                    chord + profile.maxDeviation * 4))
            sampled.push({ p: p[3], t: tb });
        else {
            const [left, right] = splitCubic(p, 0.5), mid = (ta + tb) / 2;
            subdivide(left, ta, mid, depth + 1);
            subdivide(right, mid, tb, depth + 1);
        }
    };
    const knots = [...criticalCurveParameters(points), 1];
    let remaining = points, from = 0;
    for (const to of knots) {
        if (to - from < 1e-12)
            continue;
        if (to >= 1 - 1e-12)
            subdivide(remaining, from, 1, 0);
        else {
            const [left, right] = splitCubic(remaining, (to - from) / (1 - from));
            subdivide(left, from, to, 0);
            remaining = right;
        }
        from = to;
    }
    const unique = sampled.filter((v, i) => i === 0 || distance(v.p, sampled[i - 1].p) > 1e-5);
    if (unique.length === 1)
        unique.push({ p: points[3], t: 1 });
    let s = 0;
    const stations = unique.map((v, i) => {
        if (i)
            s += distance(v.p, unique[i - 1].p);
        const d = differential.tangentAt(v.t) ?? normalizeXZ(sub(points[3], points[0]));
        return { ...v, d, n: normalXZ(d), s };
    });
    const alignment = { road, points, stations, length: s };
    profiles.set(alignment, differential);
    return alignment;
}
export function stationAt(a, s) {
    s = clamp(s, 0, a.length);
    let lo = 0, hi = a.stations.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (a.stations[mid].s < s)
            lo = mid;
        else
            hi = mid;
    }
    const left = a.stations[lo], right = a.stations[hi];
    const t = left.t +
        ((right.t - left.t) * (s - left.s)) / Math.max(1e-8, right.s - left.s);
    const p = cubic(a.points, t), d = alignmentProfile(a).tangentAt(t) ??
        normalizeXZ(sub(a.points[3], a.points[0]));
    return { p, d, n: normalXZ(d), s, t };
}
export function trimmedStations(a, start, end) {
    const lo = clamp(start, 0, a.length), hi = clamp(a.length - end, lo, a.length);
    return [
        stationAt(a, lo),
        ...a.stations.filter((f) => f.s > lo + 1e-5 && f.s < hi - 1e-5),
        stationAt(a, hi),
    ];
}
export function closestOnAlignment(a, point) {
    let best = { distance: Infinity, t: 0, point: a.points[0], s: 0 };
    for (let i = 1; i < a.stations.length; i++) {
        const x = a.stations[i - 1], y = a.stations[i], near = nearestSegment(point, x.p, y.p);
        if (near.distance < best.distance) {
            const t = x.t + (y.t - x.t) * near.t;
            best = {
                distance: near.distance,
                t,
                point: cubic(a.points, t),
                s: x.s + (y.s - x.s) * near.t,
            };
        }
    }
    // Bounded ternary refinement makes curve snapping independent of tessellation.
    let lo = Math.max(0, best.t - 0.025), hi = Math.min(1, best.t + 0.025);
    for (let i = 0; i < 20; i++) {
        const ta = lo + (hi - lo) / 3, tb = hi - (hi - lo) / 3;
        if (nearestSegment(point, cubic(a.points, ta), cubic(a.points, ta)).distance <
            nearestSegment(point, cubic(a.points, tb), cubic(a.points, tb)).distance)
            hi = tb;
        else
            lo = ta;
    }
    best.t = (lo + hi) / 2;
    best.point = cubic(a.points, best.t);
    best.distance = Math.hypot(point[0] - best.point[0], point[2] - best.point[2]);
    return best;
}
export function offsetStation(f, offset, elevation = 0) {
    return add(f.p, [f.n[0] * offset, elevation, f.n[2] * offset]);
}
export function pointOnPolyline(points, t) {
    const v = clamp(t, 0, 1) * (points.length - 1), i = Math.min(points.length - 2, Math.floor(v));
    return lerp(points[i], points[i + 1], v - i);
}
