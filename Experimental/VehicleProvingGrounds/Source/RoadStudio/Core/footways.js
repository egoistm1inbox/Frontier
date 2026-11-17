import { crossingStations } from "./street-details.js";
import { buildPlantingPit } from "./planting.js";
import earcut from "./earcut.js";
import { frameAt, edgePoint, sideHalfWidth, surfacePoint, sweepCurb, } from "./geometry.js";
import { add, clamp } from "./math.js";
import { addGratedInlet } from "./utilities.js";
export const rampWeight = (r, s) => clamp(1 - (Math.abs(s - r.s) - r.width / 2) / r.flare, 0, 1);
export const inRamp = (layout, s, side, margin = 0) => !!layout?.ramps.some((r) => r.side === side && Math.abs(s - r.s) < r.width / 2 + r.flare + margin);
/** Normalized cubic parameter survives road splits; station values are derived. */
export function stationForParameter(span, t) {
    const a = span.alignment.stations, i = a.findIndex((s) => s.t >= t);
    if (i <= 0)
        return i === 0 ? a[0].s : a.at(-1).s;
    return (a[i - 1].s +
        ((a[i].s - a[i - 1].s) * (t - a[i - 1].t)) /
            Math.max(1e-9, a[i].t - a[i - 1].t));
}
export function prepareFootways(span, project) {
    const r = span.road, first = span.frames[0].s, last = span.frames.at(-1).s, ramps = [], inlets = [];
    const addRamp = (spec) => {
        const f = frameAt(span, spec.s);
        if (f.sw < 1 ||
            r.bridge ||
            spec.s - spec.width / 2 - spec.flare < first + 0.08 ||
            spec.s + spec.width / 2 + spec.flare > last - 0.08)
            return;
        spec.run = Math.min(spec.run, Math.max(0.5, f.sw - 0.75));
        if (ramps.some((a) => a.side === spec.side &&
            Math.abs(a.s - spec.s) <
                (a.width + spec.width) / 2 + a.flare + spec.flare))
            return;
        ramps.push(spec);
    };
    if (r.cornerRamps && r.markingStyle === "urban" && r.curbStyle === "stone")
        for (const crossing of crossingStations(span, project)) {
            const id = crossing.node, s = crossing.s;
            for (const side of [-1, 1])
                addRamp({
                    id: `${r.id}:corner-ramp:${id}:${side}`,
                    kind: "corner-ramp",
                    side,
                    s,
                    width: r.rampWidth,
                    flare: 0.5,
                    run: r.rampRun,
                    apron: 0,
                });
        }
    for (const d of r.driveways)
        addRamp({
            id: `${r.id}:driveway:${d.id}`,
            kind: "driveway",
            side: d.side,
            s: stationForParameter(span, d.at),
            width: d.width,
            flare: 1,
            run: r.rampRun,
            apron: d.apron,
        });
    if (r.drainage &&
        r.drainageType !== "linear" &&
        (r.curbDrainType !== "hollow" || frameAt(span, first).curbHeight < 0.11))
        for (const side of [-1, 1])
            for (let s = first + (r.curbDrainType === "side-entry" ? 7 : 5); s < last - 2; s += r.inletSpacing) {
                if (!inRamp({ ramps, inlets }, s, side, 1))
                    inlets.push({
                        s,
                        side,
                        width: r.curbDrainType === "side-entry" ? 1.2 : 0.76,
                    });
            }
    const pits = [];
    if (r.treePits && !r.bridge)
        for (const side of [-1, 1])
            for (let s = first + 10; s < last - 8; s += r.pitSpacing) {
                const f = frameAt(span, s), lo = f.sw - r.pitWidth - 0.25, hi = f.sw - 0.25;
                if (lo < 2 ||
                    s + r.pitLength / 2 > last - 2 ||
                    inRamp({ ramps, inlets }, s, side, r.pitLength / 2 + 1) ||
                    Math.min(frameAt(span, s - r.pitLength / 2).sw, frameAt(span, s + r.pitLength / 2).sw) <
                        f.sw * 0.98)
                    continue;
                pits.push({
                    s,
                    side,
                    width: r.pitWidth,
                    length: r.pitLength,
                    lo: lo / f.sw,
                    hi: hi / f.sw,
                });
            }
    return { ramps, inlets, pits };
}
export function footwayPoint(span, s, side, across) {
    const f = frameAt(span, s), edge = edgePoint(f, side, "road"), p = surfacePoint(f, side * (sideHalfWidth(f, side) + f.cw + across));
    p[1] = edge[1] + f.curbHeight + (across * f.sidewalkCrossfall) / 100;
    let drop = 0;
    for (const ramp of span.footway?.ramps ?? [])
        if (ramp.side === side) {
            const weight = rampWeight(ramp, s), fade = clamp(1 - across / ramp.run, 0, 1);
            drop = Math.max(drop, (f.curbHeight - 0.006) * weight * fade);
        }
    p[1] -= drop;
    return p;
}
export function curbTopPoint(span, s, side) {
    const f = frameAt(span, s), p = footwayPoint(span, s, side, 0);
    p[0] -= f.n[0] * side * f.cw;
    p[2] -= f.n[2] * side * f.cw;
    return p;
}
function knots(span, side, modules = false) {
    const first = span.frames[0].s, last = span.frames.at(-1).s, list = modules ? [first, last] : span.frames.map((f) => f.s);
    for (const r of span.footway?.ramps ?? [])
        if (r.side === side) {
            const lo = r.s - r.width / 2 - r.flare, hi = r.s + r.width / 2 + r.flare;
            list.push(lo, r.s - r.width / 2, r.s, r.s + r.width / 2, hi);
            for (let s = lo; s < hi; s += 0.35)
                list.push(s);
        }
    for (const inlet of span.footway?.inlets ?? [])
        if (inlet.side === side && span.road.curbDrainType === "side-entry")
            list.push(inlet.s - inlet.width / 2, inlet.s + inlet.width / 2);
    for (const pit of span.footway?.pits ?? [])
        if (pit.side === side)
            list.push(pit.s - pit.length / 2, pit.s, pit.s + pit.length / 2);
    if (span.road.drainage &&
        span.road.drainageType !== "linear" &&
        span.road.curbDrainType === "hollow")
        for (let s = first; s < last; s += 0.65)
            list.push(s);
    return [
        first,
        ...[
            ...new Set(list
                .filter((s) => s > first + 1e-8 && s < last - 1e-8)
                .map((s) => Math.round(s * 1e8) / 1e8)),
        ].sort((a, b) => a - b),
        last,
    ];
}
/** Curb-side opening: a real gap, soffit, jambs, throat depth and seated chamber lid. */
export function buildSideInlet(b, span, inlet) {
    const { s, side, width } = inlet, f = frameAt(span, s), cw = f.cw, h = f.curbHeight, sample = (u, v, y) => {
        const frame = frameAt(span, s + u), p = surfacePoint(frame, side * (sideHalfWidth(frame, side) + v));
        p[1] = edgePoint(frame, side, "road")[1] + y;
        return p;
    };
    const box = (u0, u1, v0, v1, y0, y1, material = "concrete") => {
        const a = [
            sample(u0, v0, y0),
            sample(u1, v0, y0),
            sample(u1, v1, y0),
            sample(u0, v1, y0),
        ], z = [
            sample(u0, v0, y1),
            sample(u1, v0, y1),
            sample(u1, v1, y1),
            sample(u0, v1, y1),
        ];
        b.quad("drain", y0 > 0.04 ? "utility-recess" : material, a, false);
        b.quad("drain", material, z, true);
        for (let i = 0; i < 4; i++)
            b.quad("drain", material, [a[i], a[(i + 1) % 4], z[(i + 1) % 4], z[i]]);
    };
    box(-width / 2, -width / 2 + 0.11, 0, cw + 0.18, 0, h);
    box(width / 2 - 0.11, width / 2, 0, cw + 0.18, 0, h);
    box(-width / 2 + 0.11, width / 2 - 0.11, 0, cw + 0.18, h - 0.045, h);
    b.quad("drain", "utility-recess", [
        sample(-width / 2 + 0.11, cw + 0.12, 0.004),
        sample(width / 2 - 0.11, cw + 0.12, 0.004),
        sample(width / 2 - 0.11, cw + 0.12, h - 0.045),
        sample(-width / 2 + 0.11, cw + 0.12, h - 0.045),
    ]);
    b.quad("drain", "utility-recess", [
        sample(-width / 2 + 0.11, 0, 0.004),
        sample(width / 2 - 0.11, 0, 0.004),
        sample(width / 2 - 0.11, cw + 0.12, 0.004),
        sample(-width / 2 + 0.11, cw + 0.12, 0.004),
    ], true);
    const lid = (u, v, lift) => {
        const p = footwayPoint(span, s + u, side, v);
        return add(p, [0, lift, 0]);
    }, depth = Math.min(0.85, f.sw - 0.1), ring = (w, d, lift) => [
        lid(-w / 2, 0.03, lift),
        lid(w / 2, 0.03, lift),
        lid(w / 2, d, lift),
        lid(-w / 2, d, lift),
    ];
    const outside = ring(width - 0.04, depth, 0.003), inside = ring(width - 0.064, depth - 0.024, 0.005);
    b.strip("drain", "utility-recess", [...outside, outside[0]], [...inside, inside[0]], true);
    b.polygon("drain", "concrete", inside, undefined, true);
    for (const u of [-0.24, 0.24]) {
        const points = Array.from({ length: 12 }, (_, i) => lid(u + Math.cos((i * Math.PI) / 6) * 0.015, depth * 0.48 + Math.sin((i * Math.PI) / 6) * 0.015, 0.006));
        b.polygon("drain", "utility-recess", points, undefined, true);
    }
    return {
        id: `${b.owner}:side-inlet:${side}:${Math.round(s * 100)}`,
        owner: b.owner,
        ownerKind: b.ownerKind,
        kind: "curb-inlet",
        style: "side-entry",
        position: sample(0, 0.04, h * 0.45),
        length: width,
        direction: [-f.n[0] * side, 0, -f.n[2] * side],
    };
}
/** Hollow kerb modules use an actual triangulated arched hole, not a black decal. */
function hollowPanel(b, span, side, lo, hi, accessGrate = false) {
    const mid = (lo + hi) / 2, f = frameAt(span, mid);
    if (hi - lo < 0.35 ||
        f.curbHeight < 0.11 ||
        inRamp(span.footway, mid, side, 0.08))
        return false;
    const p = (s, v, y) => {
        const f = frameAt(span, s), q = surfacePoint(f, side * (sideHalfWidth(f, side) + v));
        q[1] = edgePoint(f, side, "road")[1] + y;
        return q;
    }, h = f.curbHeight - 0.015, w = Math.min(0.15, (hi - lo) * 0.3), height = Math.min(0.095, h - 0.025), floor = 0.01;
    const ring = [];
    for (let i = 0; i <= 12; i++) {
        const a = Math.PI - (i * Math.PI) / 12;
        ring.push([
            mid + (Math.cos(a) * w) / 2,
            floor + height * 0.5 + Math.sin(a) * height * 0.5,
        ]);
    }
    ring.push([mid + w / 2, floor], [mid - w / 2, floor]);
    const outer = [
        [lo, 0],
        [hi, 0],
        [hi, h],
        [lo, h],
    ], flat = [...outer, ...ring].flat(), indices = earcut(flat, [4], 2), points = [...outer, ...ring].map(([s, y]) => p(s, 0, y));
    b.append("curb", "curb", points, indices);
    const a = ring.map(([s, y]) => p(s, 0, y)), z = ring.map(([s, y]) => p(s, 0.065, y));
    b.strip("drain", "concrete", [...a, a[0]], [...z, z[0]]);
    b.append("drain", "utility-recess", ring.map(([s, y]) => p(s, 0.1, y)), earcut(ring.flat(), undefined, 2));
    const inner = [curbTopPoint(span, lo, side), curbTopPoint(span, hi, side)], out = [footwayPoint(span, lo, side, 0), footwayPoint(span, hi, side, 0)];
    const chamfer = inner.map((q) => add(q, [0, -0.015, 0]));
    b.strip("curb", "curb", chamfer, inner, true);
    if (accessGrate) {
        const loLid = mid - 0.22, hiLid = mid + 0.22, left = f.cw / 2 - 0.095, right = f.cw / 2 + 0.095, top = (s, v, lift = 0) => {
            const fr = frameAt(span, s), q = surfacePoint(fr, side * (sideHalfWidth(fr, side) + v));
            q[1] = edgePoint(fr, side, "road")[1] + fr.curbHeight + lift;
            return q;
        };
        for (const [a, z] of [
            [lo, loLid],
            [hiLid, hi],
        ])
            b.strip("curb", "curb", [top(a, 0), top(z, 0)], [top(a, f.cw), top(z, f.cw)], true);
        for (const [a, z] of [
            [0, left],
            [right, f.cw],
        ])
            b.strip("curb", "curb", [top(loLid, a), top(hiLid, a)], [top(loLid, z), top(hiLid, z)], true);
        addGratedInlet(b, (u, v, h = 0) => top(mid + u, f.cw / 2 + v, h), 0.19, 0.44);
    }
    else
        b.strip("curb", "curb", inner, out, true);
    return true;
}
export function buildSpanFootways(b, span, _project) {
    const r = span.road, features = [], services = [], plantings = [], pitKnots = new Map();
    for (const side of [-1, 1]) {
        const stations = knots(span, side), hollow = r.drainage &&
            r.drainageType !== "linear" &&
            r.curbDrainType === "hollow", curbStations = hollow ? knots(span, side, true) : stations, sideInlets = (span.footway?.inlets ?? []).filter((i) => i.side === side &&
            r.curbDrainType === "side-entry" &&
            frameAt(span, i.s).curbHeight >= 0.1 &&
            frameAt(span, i.s).sw >= 0.85);
        pitKnots.set(side, stations);
        const portStations = [], accessStations = [];
        let accessGrates = 0;
        for (let i = 0; i < curbStations.length - 1; i++) {
            const a = curbStations[i], z = curbStations[i + 1], mid = (a + z) / 2;
            if (sideInlets.some((inlet) => Math.abs(mid - inlet.s) < inlet.width / 2 - 0.000001))
                continue;
            const accessGrate = z - a > 0.46 &&
                Math.floor((a - stations[0]) / r.inletSpacing) !==
                    Math.floor((z - stations[0]) / r.inletSpacing);
            if (hollow && hollowPanel(b, span, side, a, z, accessGrate)) {
                if (accessGrate) {
                    accessGrates++;
                    accessStations.push(mid);
                }
                portStations.push(mid);
                continue;
            }
            sweepCurb(b, r.curbStyle === "race" ? "race-curb" : "curb", [
                edgePoint(frameAt(span, a), side, "road"),
                edgePoint(frameAt(span, z), side, "road"),
            ], [curbTopPoint(span, a, side), curbTopPoint(span, z, side)], [footwayPoint(span, a, side, 0), footwayPoint(span, z, side, 0)]);
        }
        if (portStations.length) {
            const first = stations[0], last = stations.at(-1), mid = accessStations.length
                ? accessStations[Math.floor(accessStations.length / 2)]
                : portStations[Math.floor(portStations.length / 2)], f = frameAt(span, mid), p = edgePoint(f, side, "road");
            p[1] += 0.07;
            services.push({
                id: `${r.id}:hollow:${side}`,
                owner: r.id,
                ownerKind: "road",
                kind: "curb-inlet",
                style: "hollow",
                position: p,
                length: last - first,
                ports: portStations.length,
                accessGrates,
                direction: [-f.n[0] * side, 0, -f.n[2] * side],
            });
        }
        for (const inlet of sideInlets)
            services.push(buildSideInlet(b, span, inlet));
        if (r.sidewalk > 0.01) {
            const fractions = [
                0,
                0.16 / Math.max(0.16, r.sidewalk),
                0.25,
                0.5,
                0.75,
                1,
            ];
            for (const ramp of span.footway?.ramps ?? [])
                if (ramp.side === side)
                    fractions.push(clamp(ramp.run / r.sidewalk, 0, 1));
            for (const pit of span.footway?.pits ?? [])
                if (pit.side === side)
                    fractions.push(pit.lo, pit.hi);
            const rows = [...new Set(fractions)].sort((a, b) => a - b);
            for (let k = 0; k < rows.length - 1; k++) {
                let run = 0;
                const strip = (a, z) => {
                    if (z <= a)
                        return;
                    b.strip("paving", `paving-${r.pattern}`, stations
                        .slice(a, z + 1)
                        .map((s) => footwayPoint(span, s, side, frameAt(span, s).sw * rows[k])), stations
                        .slice(a, z + 1)
                        .map((s) => footwayPoint(span, s, side, frameAt(span, s).sw * rows[k + 1])), true);
                };
                for (let i = 0; i < stations.length - 1; i++) {
                    const a = stations[i], z = stations[i + 1], hole = (span.footway?.pits ?? []).some((p) => p.side === side &&
                        a >= p.s - p.length / 2 - 1e-7 &&
                        z <= p.s + p.length / 2 + 1e-7 &&
                        rows[k] >= p.lo - 1e-8 &&
                        rows[k + 1] <= p.hi + 1e-8);
                    if (hole) {
                        strip(run, i);
                        run = i + 1;
                    }
                }
                strip(run, stations.length - 1);
            }
            const row = (across) => stations.map((s) => add(footwayPoint(span, s, side, across(s)), [0, 0.003, 0]));
            b.strip("paving", "pave-border", row(() => 0), row((s) => Math.min(0.16, frameAt(span, s).sw * 0.3)), true);
            b.strip("paving", "pave-border", row((s) => frameAt(span, s).sw - Math.min(0.16, frameAt(span, s).sw * 0.3)), row((s) => frameAt(span, s).sw), true);
        }
        b.strip("structure", "road-base", stations.map((s) => footwayPoint(span, s, side, frameAt(span, s).sw)), stations.map((s) => edgePoint(frameAt(span, s), side, "bottom")));
    }
    for (const ramp of span.footway?.ramps ?? []) {
        const f = frameAt(span, ramp.s), rise = f.curbHeight - 0.006, position = footwayPoint(span, ramp.s, ramp.side, ramp.run / 2);
        features.push({
            id: ramp.id,
            owner: r.id,
            kind: ramp.kind,
            side: ramp.side,
            position,
            width: ramp.width,
            run: ramp.run,
            rise,
            slope: (rise / ramp.run + f.sidewalkCrossfall / 100) * 100,
            landing: Math.max(0, f.sw - ramp.run),
            station: ramp.s,
            apron: ramp.apron,
        });
        if (ramp.kind === "corner-ramp" && r.tactile) {
            const offsets = [0.22, Math.min(0.77, ramp.run * 0.55)], rows = offsets.map((d) => [
                footwayPoint(span, ramp.s - ramp.width * 0.43, ramp.side, d),
                footwayPoint(span, ramp.s + ramp.width * 0.43, ramp.side, d),
            ].map((p) => add(p, [0, 0.004, 0])));
            const m = b.target("paving", "paving-tactile"), start = m.uvs.length;
            b.quad("paving", "paving-tactile", [rows[0][0], rows[0][1], rows[1][1], rows[1][0]], true);
            m.uvs.splice(start, 8, 0, 0, (ramp.width * 0.86) / 0.4, 0, (ramp.width * 0.86) / 0.4, (offsets[1] - offsets[0]) / 0.4, 0, (offsets[1] - offsets[0]) / 0.4);
        }
        if (ramp.kind === "driveway" && ramp.apron > 0) {
            const stations = [
                ramp.s - ramp.width / 2,
                ramp.s,
                ramp.s + ramp.width / 2,
            ], a = stations.map((s) => footwayPoint(span, s, ramp.side, frameAt(span, s).sw)), z = stations.map((s) => footwayPoint(span, s, ramp.side, frameAt(span, s).sw + ramp.apron));
            b.strip("paving", "concrete", a, z, true);
            for (const i of [0, 2])
                b.quad("structure", "road-base", [
                    a[i],
                    z[i],
                    add(z[i], [0, -0.18, 0]),
                    add(a[i], [0, -0.18, 0]),
                ]);
            b.strip("structure", "road-base", z, z.map((p) => add(p, [0, -0.18, 0])));
        }
    }
    for (const pit of span.footway?.pits ?? []) {
        const f = frameAt(span, pit.s), center = (pit.lo + pit.hi) / 2, sample = (u, v, h) => {
            const fr = frameAt(span, pit.s + u), ratio = center + (v / pit.width) * (pit.hi - pit.lo);
            return add(footwayPoint(span, pit.s + u, pit.side, fr.sw * ratio), [
                0,
                h,
                0,
            ]);
        };
        const fractions = (pitKnots.get(pit.side) ?? [])
            .filter((s) => s >= pit.s - pit.length / 2 - 1e-7 &&
            s <= pit.s + pit.length / 2 + 1e-7)
            .map((s) => (s - pit.s) / pit.length);
        buildPlantingPit(b, sample, pit.width, pit.length, r.pitGrate, 0.012, fractions);
        plantings.push({
            id: `${r.id}:pit:${pit.side}:${Math.round(pit.s * 100)}`,
            owner: r.id,
            ownerKind: "road",
            kind: "footway-pit",
            position: sample(0, 0, 0),
            width: pit.width,
            length: pit.length,
            grate: r.pitGrate,
            containsTree: false,
            clearWalkWidth: f.sw * pit.lo,
        });
    }
    return { features, services, plantings };
}
export function clearRuns(span, side, drivewaysOnly = false) {
    const first = span.frames[0].s, last = span.frames.at(-1).s, cuts = (span.footway?.ramps ?? [])
        .filter((r) => r.side === side && (!drivewaysOnly || r.kind === "driveway"))
        .map((r) => [
        Math.max(first, r.s - r.width / 2 - r.flare),
        Math.min(last, r.s + r.width / 2 + r.flare),
    ])
        .sort((a, b) => a[0] - b[0]);
    const runs = [];
    let cursor = first;
    for (const [a, b] of cuts) {
        if (a > cursor + 0.05)
            runs.push([cursor, a]);
        cursor = Math.max(cursor, b);
    }
    if (last > cursor + 0.05)
        runs.push([cursor, last]);
    return runs;
}
