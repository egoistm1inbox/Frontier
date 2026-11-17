import { surfacePoint, frameAt, sideHalfWidth, } from "./geometry.js";
/** All lids and grilles follow the actual crown/grade, not a flat world-Y plane. */
export function addManhole(b, sample, diameter = 0.65, segments = 64) {
    const radius = diameter / 2, ring = (r, h) => Array.from({ length: segments + 1 }, (_, i) => sample(Math.cos((i * Math.PI * 2) / segments) * r, Math.sin((i * Math.PI * 2) / segments) * r, h));
    b.strip("utility", "utility-iron", ring(radius, -0.04), ring(radius, 0.006));
    b.strip("utility", "utility-iron", ring(radius, 0.006), ring(radius * 0.94, 0.01), true);
    b.strip("utility", "utility-recess", ring(radius * 0.94, 0.006), ring(radius * 0.86, 0.006), true);
    b.strip("utility", "utility-iron", ring(radius * 0.86, 0.006), ring(radius * 0.84, 0.008), true);
    const boundary = ring(radius * 0.84, 0.008).slice(0, -1), center = sample(0, 0, 0.008), points = [center, ...boundary], indices = boundary.flatMap((_, i) => [0, i + 1, ((i + 1) % segments) + 1]), m = b.target("utility", "utility-cover"), uvStart = m.uvs.length;
    b.append("utility", "utility-cover", points, indices, true);
    const uv = [
        0.5,
        0.5,
        ...boundary.flatMap((_, i) => [
            0.5 + Math.cos((i * Math.PI * 2) / segments) * 0.5,
            0.5 + Math.sin((i * Math.PI * 2) / segments) * 0.5,
        ]),
    ];
    uv.forEach((v, i) => (m.uvs[uvStart + i] = v));
    // Four recessed lifting/fastener pockets are geometry, not painted props.
    for (let j = 0; j < 4; j++) {
        const a = (j * Math.PI) / 2 + 0.4, u = Math.cos(a) * radius * 0.67, v = Math.sin(a) * radius * 0.67, r = diameter * 0.019;
        const p = Array.from({ length: 12 }, (_, i) => sample(u + Math.cos((i * Math.PI) / 6) * r, v + Math.sin((i * Math.PI) / 6) * r, 0.009));
        b.polygon("utility", "utility-recess", p, undefined, true);
    }
}
export function addGratedInlet(b, sample, width = 0.42, length = 0.76) {
    const row = (w, l, h) => [
        sample(-l / 2, -w / 2, h),
        sample(l / 2, -w / 2, h),
        sample(l / 2, w / 2, h),
        sample(-l / 2, w / 2, h),
    ], close = (r) => [...r, r[0]];
    b.strip("drain", "utility-iron", close(row(width, length, -0.04)), close(row(width, length, 0.006)));
    b.strip("drain", "utility-iron", close(row(width, length, 0.006)), close(row(width - 0.035, length - 0.035, 0.012)), true);
    b.strip("drain", "utility-iron", close(row(width - 0.035, length - 0.035, 0.012)), close(row(width - 0.1, length - 0.1, 0.012)), true);
    b.polygon("drain", "utility-recess", row(width - 0.1, length - 0.1, 0.004), undefined, true);
    for (let s = -length / 2 + 0.09; s < length / 2 - 0.07; s += 0.085) {
        const h = 0.013, w = width - 0.1, bar = 0.025;
        b.quad("drain", "utility-iron", [
            sample(s - bar / 2, -w / 2, h),
            sample(s + bar / 2, -w / 2, h),
            sample(s + bar / 2, w / 2, h),
            sample(s - bar / 2, w / 2, h),
        ], true);
    }
    for (const v of [-0.075, 0.075])
        b.quad("drain", "utility-iron", [
            sample(-length / 2 + 0.06, v - 0.012, 0.012),
            sample(length / 2 - 0.06, v - 0.012, 0.012),
            sample(length / 2 - 0.06, v + 0.012, 0.012),
            sample(-length / 2 + 0.06, v + 0.012, 0.012),
        ], true);
}
export function roadSampler(span, station, offset) {
    return (u, v, h = 0) => surfacePoint(frameAt(span, station + u), offset + v, h);
}
export function buildRoadManholes(b, span) {
    const r = span.road;
    if (!r.manholes || r.bridge)
        return [];
    const first = span.frames[0].s, last = span.frames.at(-1).s, result = [];
    for (let s = first + 14; s < last - 6; s += r.manholeSpacing) {
        const f = frameAt(span, s), limit = f.hw - r.manholeDiameter / 2 - 0.16, offset = Math.max(-limit, Math.min(limit, (r.manholeOffset * f.hw) /
            Math.max(0.001, (r.lanes * r.laneWidth) / 2 +
                (r.parking === "parallel" ? 2.35 : 0) +
                r.median / 2)));
        if (limit <= 0)
            continue;
        const medianLimit = r.median / 2 + r.manholeDiameter / 2 + 0.18;
        let safeOffset = offset;
        if (r.median > 0 && Math.abs(safeOffset) < medianLimit)
            safeOffset = (safeOffset > 0 ? 1 : -1) * medianLimit;
        if (Math.abs(safeOffset) > limit)
            continue;
        if (Array.from({ length: 32 }, (_, i) => (i * Math.PI) / 16).some((a) => Math.abs(safeOffset + (Math.sin(a) * r.manholeDiameter) / 2) >
            frameAt(span, s + (Math.cos(a) * r.manholeDiameter) / 2).hw - 0.07))
            continue;
        addManhole(b, roadSampler(span, s, safeOffset), r.manholeDiameter);
        result.push({
            id: `${r.id}:manhole:${Math.round(s * 100)}`,
            owner: r.id,
            ownerKind: "road",
            kind: "manhole",
            position: surfacePoint(f, safeOffset, 0.01),
            diameter: r.manholeDiameter,
        });
    }
    return result;
}
export function buildLinearDrain(b, span, side) {
    const rows = (offset, h) => span.frames.map((f) => surfacePoint(f, side * (sideHalfWidth(f, side) - offset), h)), outer = rows(0.05, 0.004), inner = rows(0.27, 0.004);
    b.strip("drain", "utility-recess", outer, inner, true);
    b.strip("drain", "utility-iron", rows(0.04, 0.008), rows(0.065, 0.008), true);
    b.strip("drain", "utility-iron", rows(0.255, 0.008), rows(0.28, 0.008), true);
    const m = b.target("drain", "utility-grate"), start = m.uvs.length;
    b.strip("drain", "utility-grate", rows(0.065, 0.007), rows(0.255, 0.007), true);
    span.frames.forEach((f, i) => {
        m.uvs[start + i * 4] = f.s;
        m.uvs[start + i * 4 + 1] = 0;
        m.uvs[start + i * 4 + 2] = f.s;
        m.uvs[start + i * 4 + 3] = 1;
    });
    const f = span.frames[Math.floor(span.frames.length / 2)];
    return {
        id: `${span.road.id}:channel:${side}`,
        owner: span.road.id,
        ownerKind: "road",
        kind: "channel-drain",
        position: surfacePoint(f, side * (sideHalfWidth(f, side) - 0.16), 0.008),
        length: span.length,
    };
}
