import { splitterLayout } from "./splitters.js";
import { buildMedianIsland, sectionScale } from "./street-details.js";
import { clearRuns, inRamp } from "./footways.js";
import { add, sub, mul, lerp, normalizeXZ, normalXZ, dotXZ, cubic, distanceXZ, simplePolygon, } from "./math.js";
import { baseRoadHalfWidth, motorHalfWidth, connected, getNode, } from "./model.js";
import { insidePolygon } from "./sites.js";
import { surfacePoint, edgePoint, frameAt, ribbon, } from "./geometry.js";
/** Roadside furniture uses the exact same station frames as the driveable deck. */
export function buildSign(b, base, d, key) {
    b.box("sign", "pole", add(base, [0, 1.35, 0]), 0.065, 2.7, 0.065, d);
    const h = key.startsWith("speed-") ? 0.72 : key === "yield" ? 0.9 : 0.9, w = key === "exit" ? 1.7 : h;
    const center = add(base, [0, 2.28, 0]), right = [d[2], 0, -d[0]];
    const outline = key.startsWith("speed-")
        ? Array.from({ length: 40 }, (_, i) => [
            (Math.cos((i * Math.PI) / 20) * w) / 2,
            (Math.sin((i * Math.PI) / 20) * h) / 2,
        ])
        : key === "yield"
            ? [
                [-w / 2, h * 0.42],
                [w / 2, h * 0.42],
                [0, -h * 0.58],
            ]
            : [
                [-w / 2, -h / 2],
                [w / 2, -h / 2],
                [w / 2, h / 2],
                [-w / 2, h / 2],
            ];
    const face = (depth) => [
        add(center, mul(d, depth)),
        ...outline.map(([x, y]) => add(center, add(mul(right, x), add([0, y, 0], mul(d, depth))))),
    ];
    const indices = outline.flatMap((_, i) => [
        0,
        i + 1,
        ((i + 1) % outline.length) + 1,
    ]);
    b.append("sign", "pole", face(-0.035), indices.map((v, i) => i % 3 === 1 ? indices[i + 1] : i % 3 === 2 ? indices[i - 1] : v));
    const m = b.target("sign", `sign-${key}`), start = m.uvs.length;
    b.append("sign", `sign-${key}`, face(0.004), indices);
    const bias = key === "yield" ? 0.58 : 0.5, uv = [
        [0.5, bias],
        ...outline.map(([x, y]) => [x / w + 0.5, y / h + bias]),
    ].flat();
    for (let i = 0; i < uv.length; i++)
        m.uvs[start + i] = uv[i];
}
export function buildLamp(b, p, d, height = 7) {
    const n = normalXZ(d);
    b.box("lamp", "pole", add(p, [0, height / 2, 0]), 0.12, height, 0.12, d);
    b.box("lamp", "pole", add(p, add(mul(n, -0.55), [0, height - 0.08, 0])), 1.2, 0.1, 0.12, d);
    b.box("lamp", "pole", add(p, add(mul(n, -1.05), [0, height - 0.12, 0])), 0.65, 0.12, 0.34, d);
    b.box("lamp", "lamp-glow", add(p, add(mul(n, -1.05), [0, height - 0.19, 0])), 0.58, 0.018, 0.29, d);
}
export function buildRoadFurniture(b, span, project) {
    const r = span.road, first = span.frames[0].s, last = span.frames.at(-1).s;
    if (r.signs && last - first > 18) {
        for (const end of [false, true]) {
            const f = frameAt(span, end ? last - 9 : first + 9), side = r.oneWay ? 1 : end ? 1 : -1, p = add(edgePoint(f, side, "outer"), mul(f.n, side * 0.42)), d = mul(f.d, r.oneWay ? -1 : end ? -1 : 1);
            if (!inRamp(span.footway, f.s, side, 1))
                buildSign(b, p, d, `speed-${r.speedLimit}`);
            if ((end ? span.endJoint : span.startJoint) &&
                r.markingStyle === "motorway" &&
                !inRamp(span.footway, f.s + (end ? -6 : 6), side, 1))
                buildSign(b, add(p, mul(f.d, end ? -6 : 6)), d, "exit");
            if (allowsRoadsideParking(r) &&
                !inRamp(span.footway, f.s + (end ? -5 : 5), side, 1))
                buildSign(b, add(p, mul(f.d, end ? -5 : 5)), d, "parking");
        }
    }
    if (r.signs &&
        r.oneWay &&
        span.endJoint &&
        !getNode(project, r.end).signals &&
        connected(project, r.end).length >= 3 &&
        r.lanes < Math.max(...connected(project, r.end).map((r) => r.lanes)) &&
        last - first > 10) {
        const f = frameAt(span, last - 6);
        buildSign(b, add(edgePoint(f, 1, "outer"), mul(f.n, 0.4)), mul(f.d, -1), "yield");
    }
    if (r.streetLights)
        for (let s = first + 14; s < last - 8; s += 32) {
            const f = frameAt(span, s);
            for (const side of [-1, 1])
                if (!inRamp(span.footway, s, side, 1))
                    buildLamp(b, add(edgePoint(f, side, "outer"), mul(f.n, side * 0.25)), mul(f.d, side));
        }
}
export function buildMedian(b, span, project) {
    return buildMedianIsland(b, span, project);
}
const PARKING_LENGTH = 5.5, PARKING_WIDTH = 2.1, PARKING_PITCH = 6, PARKING_STROKE = 0.1;
export const allowsRoadsideParking = (r) => r.parking === "parallel" &&
    r.markings &&
    r.markingStyle === "urban" &&
    !r.bridge &&
    !(r.busLanes === "outer" && r.lanes <= (r.oneWay ? 1 : 2));
/** Bays occupy only the allocated 2.3 m parking band, never a motor/bus lane
 * or the cycle zone outside it. Recess the complete painted box from mouths
 * and access flares; don't report squeezed or folded boxes as usable spaces. */
export function parallelParkingBays(span) {
    const r = span.road;
    if (!allowsRoadsideParking(r))
        return [];
    const first = span.frames[0].s + 10 + PARKING_STROKE / 2, last = span.frames.at(-1).s - 10 - PARKING_STROKE / 2, hw = motorHalfWidth(r), inner = hw - 2.2, outer = hw - 0.1, center = (inner + outer) / 2, bays = [];
    for (const side of [-1, 1]) {
        const runs = clearRuns(span, side);
        for (let s = first; s + PARKING_LENGTH <= last; s += PARKING_PITCH) {
            const end = s + PARKING_LENGTH;
            if (!runs.some(([a, z]) => s - 0.35 >= a && end + 0.35 <= z))
                continue;
            const station = (s + end) / 2, frames = [
                frameAt(span, s - PARKING_STROKE / 2),
                ...span.frames.filter((f) => f.s > s && f.s < end),
                frameAt(span, station),
                frameAt(span, end + PARKING_STROKE / 2),
            ], scale = Math.min(...frames.map((f) => sectionScale(span, f)));
            if (PARKING_WIDTH * scale < 1.9 ||
                frames.some((f) => (outer + PARKING_STROKE / 2) * sectionScale(span, f) > f.hw - 0.02))
                continue;
            const point = (at, offset) => {
                const f = frameAt(span, at);
                return surfacePoint(f, side * offset * sectionScale(span, f), 0.018);
            }, boundary = [
                point(s, inner),
                point(s, outer),
                point(end, outer),
                point(end, inner),
            ], length = Math.min(distanceXZ(boundary[0], boundary[3]), distanceXZ(boundary[1], boundary[2]));
            if (!simplePolygon(boundary) || length < 5)
                continue;
            bays.push({
                id: `${r.id}:parallel-bay:${side}:${s.toFixed(3)}`,
                owner: r.id,
                kind: "parallel-bay",
                side,
                startStation: s,
                endStation: end,
                station,
                position: point(station, center),
                length,
                width: PARKING_WIDTH * scale,
                direction: r.oneWay ? 1 : side * (r.trafficSide === "left" ? -1 : 1),
                boundary,
            });
        }
    }
    return bays;
}
export function buildParallelParking(b, span) {
    const bays = parallelParkingBays(span), hw = motorHalfWidth(span.road), inner = hw - 2.2, outer = hw - 0.1, center = (inner + outer) / 2, sideCounts = new Map();
    for (const bay of bays) {
        const { startStation: s, endStation: end, side } = bay;
        for (const edge of [inner, outer])
            ribbon(b, span, s, end, side * edge, PARKING_STROKE);
        for (const cap of [s, end])
            ribbon(b, span, cap - PARKING_STROKE / 2, cap + PARKING_STROKE / 2, side * center, PARKING_WIDTH + PARKING_STROKE);
        const index = sideCounts.get(side) ?? 0;
        sideCounts.set(side, index + 1);
        if (index % 4)
            continue;
        // White road paint, not a blue sign or a parked-car prop. Each vertex follows
        // the crowned station surface; the UV orientation follows traffic handedness.
        const point = (x, ds) => {
            const f = frameAt(span, bay.station + ds * bay.direction);
            return surfacePoint(f, (side * center + x * bay.direction) * sectionScale(span, f), 0.024);
        };
        b.quad("marking", "marking-parking-bay", [
            point(-0.55, -0.7),
            point(0.55, -0.7),
            point(0.55, 0.7),
            point(-0.55, 0.7),
        ], true, [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
        ]);
    }
    return bays;
}
export function buildTrafficSignals(b, node, arms) {
    if (!node.signals)
        return;
    for (let i = 0; i < arms.length; i++) {
        const a = arms[i];
        if (a.road.oneWay && a.isStart)
            continue; // No signal facing a purely outgoing one-way arm.
        const keepLeft = a.road.trafficSide === "left", p = add(keepLeft ? a.outerLeft : a.outerRight, mul(a.d, 3.8)), n = mul(a.n, keepLeft ? -1 : 1);
        b.box("sign", "pole", add(p, [0, 2.5, 0]), 0.12, 5, 0.12, a.d);
        b.box("sign", "pole", add(p, add(mul(n, 1.3), [0, 4.85, 0])), 2.7, 0.12, 0.1, a.d);
        const center = add(p, add(mul(n, 2.5), [0, 4.4, 0]));
        b.box("sign", "pole", center, 0.36, 1.15, 0.22, a.d);
        for (let j = 0; j < 3; j++) {
            const q = add(center, add(mul(a.d, 0.13), [0, (1 - j) * 0.32, 0])), right = [a.d[2], 0, -a.d[0]], ring = Array.from({ length: 17 }, (_, k) => add(q, add(mul(right, Math.cos((k * Math.PI) / 8) * 0.115), [
                0,
                Math.sin((k * Math.PI) / 8) * 0.115,
                0,
            ])));
            const active = i % 2 === 0 ? j === 2 : j === 0, mat = active ? (j === 0 ? "signal-red" : "signal-green") : "signal-off";
            b.append("sign", mat, [q, ...ring], Array.from({ length: 16 }, (_, k) => [0, k + 1, k + 2]).flat());
        }
    }
}
/** Exact barycentric surface sampling prevents floating/inset junction paint. */
export function meshSurfaceY(mesh, p) {
    const v = mesh.positions;
    for (let i = 0; i < mesh.indices.length; i += 3) {
        const a = mesh.indices[i] * 3, b = mesh.indices[i + 1] * 3, c = mesh.indices[i + 2] * 3;
        const den = (v[b + 2] - v[c + 2]) * (v[a] - v[c]) +
            (v[c] - v[b]) * (v[a + 2] - v[c + 2]);
        if (Math.abs(den) < 1e-9)
            continue;
        const u = ((v[b + 2] - v[c + 2]) * (p[0] - v[c]) +
            (v[c] - v[b]) * (p[2] - v[c + 2])) /
            den, t = ((v[c + 2] - v[a + 2]) * (p[0] - v[c]) +
            (v[a] - v[c]) * (p[2] - v[c + 2])) /
            den;
        if (u >= -1e-7 && t >= -1e-7 && u + t <= 1 + 1e-7)
            return v[a + 1] * u + v[b + 1] * t + v[c + 1] * (1 - u - t);
    }
    return undefined;
}
export function buildJunctionMarkings(b, node, arms, surface, paths = []) {
    if (!arms.some((a) => a.road.markings) || arms.length < 2)
        return [];
    const splitters = splitterLayout(node, arms, paths, surface);
    const paint = (a, z, width = 0.12, material = "paint", avoidGore = false) => {
        const count = Math.max(1, Math.ceil(distanceXZ(a, z) / 0.7)), d = normalizeXZ(sub(z, a)), n = normalXZ(d);
        for (let i = 0; i < count; i++) {
            const p = lerp(a, z, i / count), q = lerp(a, z, (i + 1) / count), quad = [
                add(p, mul(n, -width / 2)),
                add(p, mul(n, width / 2)),
                add(q, mul(n, width / 2)),
                add(q, mul(n, -width / 2)),
            ];
            if (avoidGore &&
                splitters.some((s) => quad.some((p) => insidePolygon(p, s.outline))))
                continue;
            const heights = quad.map((point) => meshSurfaceY(surface, point));
            if (heights.some((y) => y === undefined))
                continue;
            b.quad("marking", material, quad.map((v, k) => [v[0], heights[k] + 0.023, v[2]]), true);
        }
    };
    const boundsHalf = Math.min(...arms.map((a) => a.frame.hw)) * 0.9;
    if (node.boxJunction && arms.length >= 3) {
        const h = Math.max(2.4, boundsHalf), p = (x, z) => add(node.position, [x, 0, z]);
        for (const sign of [-1, 1]) {
            paint(p(-h, sign * h), p(h, sign * h), 0.14, "yellow");
            paint(p(sign * h, -h), p(sign * h, h), 0.14, "yellow");
        }
        for (let v = -h * 2; v <= h * 2; v += 2.7)
            for (const slope of [-1, 1]) {
                const points = [];
                for (const x of [-h, h]) {
                    const z = slope * x + v;
                    if (Math.abs(z) <= h)
                        points.push([x, z]);
                }
                for (const z of [-h, h]) {
                    const x = (z - v) / slope;
                    if (Math.abs(x) <= h)
                        points.push([x, z]);
                }
                if (points.length >= 2)
                    paint(p(...points[0]), p(...points[1]), 0.09, "yellow");
            }
    }
    // Preserve the dominant through-lane separators through a merge/transition.
    let pair = null, score = -Infinity;
    for (let i = 0; i < arms.length; i++)
        for (let j = i + 1; j < arms.length; j++) {
            const opposite = -dotXZ(arms[i].d, arms[j].d);
            if (opposite < 0.55)
                continue;
            const weight = opposite * Math.min(arms[i].road.lanes, arms[j].road.lanes);
            if (weight > score) {
                score = weight;
                pair = [arms[i], arms[j]];
            }
        }
    const merge = arms.some((a, i) => (arms[(i + 1) % arms.length].angle - a.angle + Math.PI * 2) %
        (Math.PI * 2) <
        Math.PI * 0.29);
    if (pair && (merge || arms.length === 2)) {
        const [a, z] = pair, lanes = Math.min(a.road.lanes, z.road.lanes), reach = distanceXZ(a.center, z.center) * 0.33;
        for (let lane = 1; lane < lanes; lane++) {
            if (lane === lanes / 2 && (a.road.median > 0 || z.road.median > 0))
                continue;
            const fraction = -1 + (lane * 2) / lanes, offset = (arm) => (((arm.road.lanes * arm.road.laneWidth) / 2) * fraction +
                (Math.sign(fraction) * arm.road.median) / 2) *
                (arm.frame.profileScale ??
                    arm.frame.hw / baseRoadHalfWidth(arm.road)), p = add(a.center, mul(a.n, offset(a))), q = add(z.center, mul(z.n, -offset(z)));
            const curve = [p, add(p, mul(a.d, -reach)), add(q, mul(z.d, -reach)), q];
            for (let i = 0; i < 40; i += 4) {
                const u = cubic(curve, i / 40), v = cubic(curve, (i + 1.8) / 40);
                if (node.boxJunction &&
                    Math.max(Math.abs(u[0] - node.position[0]), Math.abs(u[2] - node.position[2])) <
                        boundsHalf + 1)
                    continue;
                paint(u, v, 0.11, "paint", true);
            }
        }
        // Keep the additional-lane divider continuous across a one-way motorway
        // split/merge. Its through-lane edge must not move when only the OUTER
        // pavement edge widens. Surface/gore clipping remains mandatory.
        if (a.road.oneWay &&
            z.road.oneWay &&
            a.isStart !== z.isStart &&
            Math.max(a.frame.auxWidth ?? 0, z.frame.auxWidth ?? 0) > 0.3) {
            const point = (arm) => {
                const side = arm.road.trafficSide === "left" ? -1 : 1, scale = arm.frame.profileScale ??
                    arm.frame.hw / baseRoadHalfWidth(arm.road), offset = side *
                    ((arm.road.lanes * arm.road.laneWidth + arm.road.median) / 2 +
                        0.065) *
                    scale;
                return add(arm.center, mul(arm.frame.n, offset));
            }, p = point(a), q = point(z), curve = [p, add(p, mul(a.d, -reach)), add(q, mul(z.d, -reach)), q];
            for (let i = 0; i < 40; i += 4)
                paint(cubic(curve, i / 40), cubic(curve, (i + 1.8) / 40), 0.11, "paint", true);
        }
    }
    // A single metric chevron fan per real split, recessed from the curb nose.
    for (const gore of splitters) {
        const normal = normalXZ(gore.direction), side = (s, sign) => add(add(gore.paintedTip, mul(gore.direction, s)), mul(normal, sign * (s / gore.length) * gore.halfWidth));
        paint(side(0, -1), side(gore.length, -1), 0.14);
        paint(side(0, 1), side(gore.length, 1), 0.14);
        for (let s = 2.8; s < gore.length - 0.5; s += 2.8) {
            const tip = add(gore.paintedTip, mul(gore.direction, Math.min(gore.length - 0.3, s + 1.2)));
            paint(side(s, -1), tip, 0.16);
            paint(tip, side(s, 1), 0.16);
        }
    }
    return splitters;
}
