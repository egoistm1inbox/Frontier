import { frameAt, surfacePoint, edgePoint, effectiveCrossing, } from "./geometry.js";
import { roadHalfWidth } from "./model.js";
import { clamp, add, mul } from "./math.js";
export const sectionScale = (span, f) => f.profileScale ?? f.hw / roadHalfWidth(span.road);
export function motorLanes(r) {
    const travel = (r.lanes * r.laneWidth) / 2, sense = r.trafficSide === "left" ? -1 : 1;
    return Array.from({ length: r.lanes }, (_, i) => ({
        index: i,
        offset: -travel +
            r.laneWidth * (i + 0.5) +
            (i + 0.5 < r.lanes / 2 ? -r.median / 2 : r.median / 2),
        direction: r.oneWay ? 1 : i + 0.5 < r.lanes / 2 ? -sense : sense,
        bus: r.busLanes === "outer" && (i === r.lanes - 1 || (!r.oneWay && i === 0)),
    }));
}
export function crossingStations(span, project) {
    const r = span.road, first = span.frames[0].s, last = span.frames.at(-1).s;
    if (r.markingStyle !== "urban" || r.bridge || last - first < 9)
        return [];
    return [
        {
            end: "start",
            node: r.start,
            joint: span.startJoint,
            s: first + 2.3,
            direction: -1,
        },
        {
            end: "end",
            node: r.end,
            joint: span.endJoint,
            s: last - 2.3,
            direction: 1,
        },
    ].filter((a) => a.joint && effectiveCrossing(project, a.node));
}
export function extensionWeight(s, first, last, start, end) {
    const weight = (distance) => clamp((9 - distance) / 4, 0, 1);
    return Math.max(start ? weight(s - first) : 0, end ? weight(last - s) : 0);
}
export const canExtendCurbs = (r) => r.curbExtensions &&
    r.parking === "parallel" &&
    r.cycleMode === "none" &&
    !r.bridge &&
    r.markingStyle === "urban";
/** One continuous rounded median. Crossing throats are cut out of the
 * island range; refuge noses don't overlap a second, independently tapered median. */
export function buildMedianIsland(b, span, project) {
    const r = span.road, features = [];
    if (r.median < 0.15)
        return features;
    const crossings = crossingStations(span, project), first = span.frames[0].s, last = span.frames.at(-1).s, margin = 12 + r.markingSetback, start = crossings.find((c) => c.end === "start"), end = crossings.find((c) => c.end === "end"), a = start && r.median >= 1.2
        ? start.s + r.rampWidth / 2 + 0.25
        : first + margin, z = end && r.median >= 1.2 ? end.s - r.rampWidth / 2 - 0.25 : last - margin, radius = Math.min(r.median / 2, (z - a) / 3);
    if (z - a < 2)
        return features;
    const values = [
        a,
        ...span.frames.filter((f) => f.s > a && f.s < z).map((f) => f.s),
        z,
        ...Array.from({ length: 9 }, (_, i) => a + radius * (1 - Math.cos((i * Math.PI) / 16))),
        ...Array.from({ length: 9 }, (_, i) => z - radius * (1 - Math.cos((i * Math.PI) / 16))),
    ]
        .sort((a, b) => a - b)
        .filter((s, i, arr) => i === 0 || s - arr[i - 1] > 1e-6);
    const row = (side, raised) => values.map((s) => {
        const f = frameAt(span, s), distance = Math.min(s - a, z - s), t = clamp(distance / radius, 0, 1), w = (r.median / 2) *
            Math.sqrt(Math.max(0, 1 - (1 - t) ** 2)) *
            sectionScale(span, f);
        return surfacePoint(f, side * Math.max(0.055, w), raised ? 0.14 : 0.016);
    });
    const l = row(-1, true), rr = row(1, true), lb = row(-1, false), rb = row(1, false);
    b.strip("paving", "paving-slate", l, rr, true);
    b.strip("curb", "curb", lb, l);
    b.strip("curb", "curb", rr, rb);
    for (const i of [0, values.length - 1])
        b.quad("curb", "curb", [lb[i], rb[i], rr[i], l[i]]);
    if (r.median < 1.2 || r.oneWay || !r.markings)
        return features;
    for (const c of crossings) {
        const f = frameAt(span, c.s), scale = sectionScale(span, f), width = r.median * scale, length = r.rampWidth;
        if (r.tactile)
            for (const side of [-1, 1]) {
                const outer = width / 2 - 0.09, inner = Math.max(0.05, outer - 0.5), p = (s, off) => surfacePoint(frameAt(span, s), off, 0.006);
                b.quad("paving", "paving-tactile", [
                    p(c.s - length * 0.43, side * inner),
                    p(c.s + length * 0.43, side * inner),
                    p(c.s + length * 0.43, side * outer),
                    p(c.s - length * 0.43, side * outer),
                ], true, [
                    [0, 0],
                    [(length * 0.86) / 0.4, 0],
                    [(length * 0.86) / 0.4, (outer - inner) / 0.4],
                    [0, (outer - inner) / 0.4],
                ]);
            }
        features.push({
            id: `${r.id}:refuge:${c.end}`,
            owner: r.id,
            kind: "crossing-refuge",
            position: surfacePoint(f, 0),
            station: c.s,
            width,
            length,
            end: c.end,
        });
    }
    return features;
}
export function streetFeatures(span, project) {
    const features = [], r = span.road;
    for (const c of crossingStations(span, project)) {
        const f = frameAt(span, c.s);
        if (r.markings)
            features.push({
                id: `${r.id}:crosswalk:${c.end}`,
                owner: r.id,
                kind: "crosswalk",
                position: surfacePoint(f, 0),
                station: c.s,
                width: f.hw * 2 - 0.36,
                length: r.rampWidth,
                end: c.end,
            });
        if (r.markings && span.frames.at(-1).s - span.frames[0].s > 14) {
            const station = c.s - c.direction * (r.rampWidth / 2 + 0.8), sf = frameAt(span, station);
            for (const lane of motorLanes(r).filter((l) => l.direction === c.direction))
                features.push({
                    id: `${r.id}:stop:${c.end}:${lane.index}`,
                    owner: r.id,
                    kind: "stop-line",
                    station,
                    position: surfacePoint(sf, lane.offset * sectionScale(span, sf)),
                    width: (r.laneWidth - 0.1) * sectionScale(span, sf),
                    length: 0.36,
                    direction: c.direction,
                    end: c.end,
                });
        }
        if (canExtendCurbs(r))
            for (const side of [-1, 1])
                features.push({
                    id: `${r.id}:bulb:${c.end}:${side}`,
                    owner: r.id,
                    kind: "curb-extension",
                    position: add(edgePoint(f, side, "curbOut"), mul(f.n, side * 0.7)),
                    station: c.s,
                    width: 2.1 * sectionScale(span, f),
                    length: 9,
                    side,
                    end: c.end,
                });
    }
    if (r.sharedCycleStreet) {
        const s = (span.frames[0].s + span.frames.at(-1).s) / 2, f = frameAt(span, s);
        features.push({
            id: `${r.id}:shared-cycle`,
            owner: r.id,
            kind: "shared-cycle-street",
            position: surfacePoint(f, 0),
            station: s,
            width: r.lanes * r.laneWidth * sectionScale(span, f),
            length: span.length,
        });
    }
    return features;
}
