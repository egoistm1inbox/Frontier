import { sectionScale, motorLanes } from "./street-details.js";
import { surfacePoint, frameAt, ribbon, } from "./geometry.js";
import { roadHalfWidth, motorHalfWidth, cycleBufferWidth, } from "./model.js";
import { clearRuns } from "./footways.js";
import { offsetCornerPath } from "./corners.js";
import { meshSurfaceY } from "./road-details.js";
import { add, mul, dotXZ } from "./math.js";
const scaled = (span, nominal, f = span.frames[0]) => nominal * sectionScale(span, f);
function decal(b, span, s, offset, w, l, key, kind, direction = 1) {
    const f = frameAt(span, s), scale = sectionScale(span, f), point = (x, z) => add(surfacePoint(f, (offset + x) * scale, 0.024), mul(f.d, z * direction));
    b.quad(kind, key, [
        point(-w / 2, -l / 2),
        point(w / 2, -l / 2),
        point(w / 2, l / 2),
        point(-w / 2, l / 2),
    ], true, [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
    ]);
}
/** Motor lane counts remain unchanged. Cycle space is added outside them. */
export function buildRoadMobility(b, span) {
    const r = span.road, features = [], first = span.frames[0].s, last = span.frames.at(-1).s, hw = roadHalfWidth(r), motor = motorHalfWidth(r), frames = span.frames;
    const band = (kind, material, lo, hi) => b.strip(kind, material, frames.map((f) => surfacePoint(f, lo * sectionScale(span, f), 0.004)), frames.map((f) => surfacePoint(f, hi * sectionScale(span, f), 0.004)), true);
    if (r.busLanes === "outer")
        for (const side of r.oneWay || r.lanes === 1 ? [1] : [-1, 1]) {
            const outer = (r.lanes * r.laneWidth) / 2 + r.median / 2, inner = outer - r.laneWidth, center = (outer + inner) / 2;
            if (r.busSurface === "red")
                band("bus", "bus-red", side * inner, side * outer);
            if (r.markings) {
                ribbon(b, span, first + 0.5, last - 0.5, side * inner, 0.16);
                for (let s = first + 12; s < last - 5; s += 28)
                    decal(b, span, s, side * center, Math.min(2.5, r.laneWidth - 0.45), 3.4, "marking-bus", "bus", r.oneWay ? 1 : side * (r.trafficSide === "left" ? -1 : 1));
            }
            const f = frameAt(span, (first + last) / 2);
            features.push({
                id: `${r.id}:bus:${side}`,
                owner: r.id,
                ownerKind: "road",
                kind: "bus-lane",
                position: surfacePoint(f, scaled(span, side * center, f)),
                width: r.laneWidth,
                protected: false,
                side,
            });
        }
    if (r.sharedCycleStreet) {
        for (const lane of motorLanes(r)) {
            for (let s = first + 14; s < last - 10; s += 30)
                decal(b, span, s, lane.offset, 1.15, 2.3, "marking-bicycle", "cycle", lane.direction);
        }
        const f = frameAt(span, (first + last) / 2);
        features.push({
            id: `${r.id}:shared-cycle`,
            owner: r.id,
            ownerKind: "road",
            kind: "shared-cycle-street",
            position: surfacePoint(f, 0),
            width: r.lanes * r.laneWidth,
            protected: false,
        });
    }
    if (r.cycleMode === "none")
        return features;
    const buffer = cycleBufferWidth(r), inner = motor + buffer, outer = inner + r.cycleWidth;
    for (const side of [-1, 1]) {
        band("cycle", r.cycleColor === "asphalt" ? "asphalt" : `cycle-${r.cycleColor}`, side * inner, side * outer);
        const f = frameAt(span, (first + last) / 2);
        features.push({
            id: `${r.id}:cycle:${side}`,
            owner: r.id,
            ownerKind: "road",
            kind: "cycle-track",
            position: surfacePoint(f, scaled(span, (side * (inner + outer)) / 2, f)),
            width: r.cycleWidth,
            protected: r.cycleMode === "protected",
            side,
        });
        if (r.markings) {
            for (let s = first + 10; s < last - 4; s += 22)
                decal(b, span, s, (side * (inner + outer)) / 2, Math.min(1.1, r.cycleWidth - 0.3), 2.1, "marking-bicycle", "cycle", side);
            if (r.cycleMode === "painted")
                for (let s = first + 0.8; s < last - 0.5; s += 3)
                    ribbon(b, span, s, Math.min(last - 0.4, s + 1.8), side * (inner + 0.04), 0.1);
            for (const cut of span.footway?.ramps ?? [])
                if (cut.kind === "driveway" && cut.side === side)
                    for (let s = cut.s - cut.width / 2; s < cut.s + cut.width / 2; s += 0.65) {
                        for (const edge of [inner + 0.12, outer - 0.16])
                            ribbon(b, span, s, s + 0.25, side * edge, 0.3);
                    }
        }
        if (r.cycleMode === "painted" && buffer > 0 && r.markings) {
            // Paint-only door buffer: no separator obstructs an access or crossing.
            const margin = 7 + r.markingSetback;
            for (const [a, z] of clearRuns(span, side)) {
                const from = Math.max(a + 0.4, first + margin), to = Math.min(z - 0.4, last - margin);
                for (let s = from; s + buffer < to; s += 3) {
                    const point = (ds, offset) => {
                        const f = frameAt(span, s + ds);
                        return surfacePoint(f, side * offset * sectionScale(span, f), 0.018);
                    };
                    b.quad("marking", "paint", [
                        point(0, motor + 0.08),
                        point(0.1, motor + 0.08),
                        point(buffer, motor + buffer - 0.08),
                        point(buffer - 0.1, motor + buffer - 0.08),
                    ], true);
                }
            }
        }
        if (r.cycleMode !== "protected")
            continue;
        // Low, closed-volume concrete islands. Leave the entire access flare and
        // pedestrian crossing clear, rather than dropping a barrier through them.
        const margin = span.road.markingSetback + 7;
        for (const [a, z] of clearRuns(span, side, true)) {
            const from = Math.max(a, first + (span.startJoint ? margin : 1)), to = Math.min(z, last - (span.endJoint ? margin : 1));
            if (to - from < 2)
                continue;
            const fs = [
                frameAt(span, from),
                frameAt(span, Math.min(to, from + 0.85)),
                ...frames.filter((f) => f.s > from + 0.85 && f.s < to - 0.85),
                frameAt(span, Math.max(from, to - 0.85)),
                frameAt(span, to),
            ]
                .sort((a, z) => a.s - z.s)
                .filter((f, i, l) => !i || f.s - l[i - 1].s > 1e-6), center = motor + buffer / 2;
            const row = (sign, h) => fs.map((f) => {
                const t = Math.min(1, (f.s - from) / 0.85, (to - f.s) / 0.85), width = buffer * (0.08 + 0.76 * t), d = ((center + (sign * width) / 2) * f.hw) / hw;
                return surfacePoint(f, side * d, h);
            });
            const il = row(-1, 0.105), ol = row(1, 0.105), ib = row(-1, 0), ob = row(1, 0);
            b.strip("cycle", "curb", il, ol, true);
            b.strip("cycle", "curb", ib, il);
            b.strip("cycle", "curb", ol, ob);
            b.strip("cycle", "curb", ib, ob, false);
            for (const i of [0, fs.length - 1])
                b.quad("cycle", "curb", [ib[i], ob[i], ol[i], il[i]]);
        }
    }
    return features;
}
const cycleWidth = (a) => a.road.cycleMode === "none"
    ? 0
    : (a.road.cycleWidth * a.frame.hw) / roadHalfWidth(a.road);
/** Paired curbside cycle curves share the exact analytic junction construction. */
export function buildJunctionMobility(b, node, arms, paths, asphalt) {
    const features = [], height = (p) => {
        for (const mesh of asphalt) {
            const y = meshSurfaceY(mesh, p);
            if (y !== undefined)
                return [p[0], y + 0.004, p[2]];
        }
        return undefined;
    };
    const end = (a, side, inset) => surfacePoint(a.frame, side * (a.isStart ? 1 : -1) * (a.frame.hw - inset), 0.004);
    for (let i = 0; i < arms.length; i++) {
        const a = arms[i], z = arms[(i + 1) % arms.length], wa = cycleWidth(a), wz = cycleWidth(z);
        if (wa === 0 || wz === 0)
            continue;
        const path = paths[i], inside = offsetCornerPath(path, end(a, 1, wa), end(z, -1, wz), -wa, -wz), outside = offsetCornerPath(path, end(a, 1, 0.04), end(z, -1, 0.04), -0.04, -0.04), material = a.road.cycleColor === "asphalt"
            ? "asphalt"
            : `cycle-${a.road.cycleColor}`;
        for (let j = 0; j < inside.length - 1; j++) {
            const pts = [
                height(inside[j]),
                height(inside[j + 1]),
                height(outside[j + 1]),
                height(outside[j]),
            ];
            if (pts.every((p) => p !== undefined))
                b.quad("cycle", material, pts, true);
        }
        const mid = Math.floor(inside.length / 2);
        features.push({
            id: `${node.id}:cycle:${i}`,
            owner: node.id,
            ownerKind: "node",
            kind: "cycle-connection",
            position: add(mul(inside[mid], 0.5), mul(outside[mid], 0.5)),
            width: (a.road.cycleWidth + z.road.cycleWidth) / 2,
            protected: false,
        });
    }
    // Set-back cycle crossings form the protected-junction perimeter. They are
    // laid on the actual triangulated deck, not a floating flat rectangle.
    if (!node.crossings ||
        arms.length < 3 ||
        arms.some((a, i) => dotXZ(a.d, arms[(i + 1) % arms.length].d) > 0.72))
        return features;
    for (const a of arms) {
        if (a.road.cycleMode !== "protected")
            continue;
        const width = cycleWidth(a), reach = a.frame.hw - 0.07, n = a.n, d = mul(a.d, -1), p = (x, s) => add(add(a.center, mul(n, x)), mul(d, s)), lo = 0.7, hi = lo + width;
        for (let x = -reach; x < reach - 0.01; x += 0.75) {
            const next = Math.min(reach, x + 0.75), pts = [
                height(p(x, lo)),
                height(p(next, lo)),
                height(p(next, hi)),
                height(p(x, hi)),
            ];
            if (pts.every((v) => v !== undefined))
                b.quad("cycle", a.road.cycleColor === "asphalt"
                    ? "asphalt"
                    : `cycle-${a.road.cycleColor}`, pts, true);
        }
        if (a.road.markings)
            for (const s of [lo, hi])
                for (let x = -reach; x < reach - 0.3; x += 1.2) {
                    const next = Math.min(reach, x + 0.55), pts = [
                        height(p(x, s - 0.065)),
                        height(p(next, s - 0.065)),
                        height(p(next, s + 0.065)),
                        height(p(x, s + 0.065)),
                    ];
                    if (pts.every((v) => v !== undefined))
                        b.quad("cycle", "paint", pts.map((p) => add(p, [0, 0.021, 0])), true);
                }
        features.push({
            id: `${node.id}:crossing:${a.road.id}`,
            owner: node.id,
            ownerKind: "node",
            kind: "cycle-crossing",
            position: p(0, (lo + hi) / 2),
            width: a.road.cycleWidth,
            protected: false,
        });
    }
    return features;
}
