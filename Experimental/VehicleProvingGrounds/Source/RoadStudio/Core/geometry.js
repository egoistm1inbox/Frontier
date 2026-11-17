import { measureGeneratedSections, measureSurfaceJoins, measureSurfaceClearances, } from "./pavement-audit.js";
import { cubicProfile } from "./cubic-analysis.js";
import { supportsAuxiliary, auxiliaryDimensions, auxiliaryWidthAt, } from "./road-sections.js";
import { buildAuxiliaryLane, } from "./auxiliary-lanes.js";
import { buildApproachFill, buildRetainedJoint, } from "./embankments.js";
import { bridgeAt, parameterStation } from "./bridge-profile.js";
import { reviewDesign, curveDesignMetrics, curveIssueMessages, measureGradeJoins, } from "./design-controls.js";
import { SupportSurfaceIndex } from "./support-surfaces.js";
import { sectionScale, motorLanes, crossingStations, canExtendCurbs, extensionWeight, streetFeatures, } from "./street-details.js";
import { buildBridgeSpan, buildBridgeJoint, bridgeDepthAt, girderOffsets, } from "./bridges.js";
import { buildBarrierPath } from "./barriers.js";
import { buildRoadMobility, buildJunctionMobility, } from "./mobility.js";
import { blockSolidAt } from "./planning-sites.js";
import { cornerPath, offsetCornerPath, effectiveCornerRadius, } from "./corners.js";
import { prepareFootways, stationForParameter, buildSpanFootways, clearRuns, } from "./footways.js";
import { addGratedInlet, buildRoadManholes, buildLinearDrain, roadSampler, } from "./utilities.js";
import { geometryProfiles, normaliseDetail, } from "./quality.js";
import { siteOutline, insidePolygon } from "./sites.js";
import { parkingLayout, parkingPlan } from "./site-geometry.js";
import { buildSiteGeometry } from "./site-geometry.js";
import { buildRoadFurniture, buildMedian, buildParallelParking, buildJunctionMarkings, buildTrafficSignals, } from "./road-details.js";
import earcut from "./earcut.js";
import { cubic, add, sub, mul, lerp, normalizeXZ, normalXZ, dotXZ, crossXZ, distance, distanceXZ, segmentIntersection, simplePolygon, polygonArea, } from "./math.js";
import { detectCrossings } from "./editing.js";
import { controlPoints, connected, getNode, validateGenerationBudget, roadHalfWidth, baseRoadHalfWidth, roadHalfWidthAt, roadCurbWidth, roadMaterial, } from "./model.js";
import { sampleAlignment, stationAt, trimmedStations, offsetStation, } from "./curves.js";
const SURFACE = 0.12, CURB = 0.16;
export const sideHalfWidth = (f, side) => f.hw + (side === f.auxSide ? (f.auxWidth ?? 0) : 0);
export function edgePoint(f, side, part) {
    const hw = sideHalfWidth(f, side), edgeHeight = surfaceHeight(f) - (hw * f.crossfall) / 100;
    const width = part === "road" || part === "curbIn"
        ? hw
        : part === "curbOut"
            ? hw + f.cw
            : hw + f.cw + f.sw;
    const height = part === "road"
        ? edgeHeight
        : part === "bottom"
            ? -(f.roadBaseDepth ?? 0.48)
            : edgeHeight +
                f.curbHeight +
                (part === "outer" ? (f.sw * f.sidewalkCrossfall) / 100 : 0);
    return offsetStation(f, side * width, height);
}
export const surfaceHeight = (f) => f.crownHeight ?? Math.max(SURFACE, 0.04 + (f.hw * f.crossfall) / 100);
export function surfacePoint(f, offset, extra = 0) {
    return offsetStation(f, offset, surfaceHeight(f) - (Math.abs(offset) * f.crossfall) / 100 + extra);
}
export class MeshBuilder {
    owner;
    ownerKind;
    meshes = new Map();
    constructor(owner, ownerKind) {
        this.owner = owner;
        this.ownerKind = ownerKind;
    }
    target(kind, material) {
        const key = `${kind}:${material}`;
        if (!this.meshes.has(key))
            this.meshes.set(key, {
                name: ["cycle", "bus", "planting", "rail", "structure"].includes(kind)
                    ? `${this.owner} ${kind} ${material}`
                    : `${this.owner} ${kind}`,
                owner: this.owner,
                ownerKind: this.ownerKind,
                kind,
                material,
                positions: [],
                indices: [],
                uvs: [],
            });
        return this.meshes.get(key);
    }
    append(kind, material, points, indices, upward) {
        const mesh = this.target(kind, material), base = mesh.positions.length / 3;
        let projection = "xz";
        if ((["curb", "cycle"].includes(kind) && material === "curb") ||
            (kind === "drain" && material === "concrete") ||
            ["rail", "structure"].includes(kind)) {
            for (let i = 0; i < indices.length; i += 3) {
                const u = sub(points[indices[i + 1]], points[indices[i]]), v = sub(points[indices[i + 2]], points[indices[i]]), x = Math.abs(u[1] * v[2] - u[2] * v[1]), y = Math.abs(u[2] * v[0] - u[0] * v[2]), z = Math.abs(u[0] * v[1] - u[1] * v[0]);
                if (Math.max(x, y, z) < 1e-10)
                    continue;
                if (y < Math.max(x, z))
                    projection = x > z ? "zy" : "xy";
                break;
            }
        }
        points.forEach((p) => {
            mesh.positions.push(...p);
            mesh.uvs.push(projection === "zy" ? p[2] : p[0], projection === "xz" ? p[2] : p[1]);
        });
        for (let i = 0; i < indices.length; i += 3) {
            let [a, b, c] = indices.slice(i, i + 3);
            const u = sub(points[b], points[a]), v = sub(points[c], points[a]);
            const nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
            if (Math.hypot(nx, ny, nz) < 1e-10)
                continue;
            if (upward !== undefined && (upward ? ny < 0 : ny > 0))
                [b, c] = [c, b];
            mesh.indices.push(base + a, base + b, base + c);
        }
    }
    quad(kind, material, points, upward, uv) {
        const mesh = this.target(kind, material), start = mesh.uvs.length;
        this.append(kind, material, points, [0, 1, 2, 0, 2, 3], upward);
        if (uv)
            uv.flat().forEach((v, i) => (mesh.uvs[start + i] = v));
    }
    strip(kind, material, a, b, upward) {
        const points = a.flatMap((p, i) => [p, b[i]]), indices = [];
        for (let i = 0; i < a.length - 1; i++) {
            const k = i * 2;
            indices.push(k, k + 1, k + 3, k, k + 3, k + 2);
        }
        const mesh = this.target(kind, material), uvStart = mesh.uvs.length;
        this.append(kind, material, points, indices, upward);
        if (["rail", "structure"].includes(kind) &&
            ["steel", "steel-dark", "girder", "pole", "concrete"].includes(material)) {
            let arc = 0;
            for (let i = 0; i < a.length; i++) {
                if (i)
                    arc += distance(lerp(a[i], b[i], 0.5), lerp(a[i - 1], b[i - 1], 0.5));
                mesh.uvs[uvStart + i * 4] = arc;
                mesh.uvs[uvStart + i * 4 + 1] = 0;
                mesh.uvs[uvStart + i * 4 + 2] = arc;
                mesh.uvs[uvStart + i * 4 + 3] = distance(a[i], b[i]);
            }
        }
        if (material === "race-curb") {
            let arc = 0;
            for (let i = 0; i < a.length; i++) {
                if (i)
                    arc += distance(a[i], a[i - 1]);
                mesh.uvs[uvStart + i * 4] = arc;
                mesh.uvs[uvStart + i * 4 + 1] = 0;
                mesh.uvs[uvStart + i * 4 + 2] = arc;
                mesh.uvs[uvStart + i * 4 + 3] = 1;
            }
        }
        else if (["asphalt", "paving", "curb", "cycle", "bus"].includes(kind) &&
            material !== "utility-grate" &&
            a.length === b.length) {
            let arc = 0;
            for (let i = 0; i < a.length; i++) {
                if (i)
                    arc += distance(lerp(a[i], b[i], 0.5), lerp(a[i - 1], b[i - 1], 0.5));
                const spanW = distance(a[i], b[i]);
                mesh.uvs[uvStart + i * 4] = arc;
                mesh.uvs[uvStart + i * 4 + 1] = 0;
                mesh.uvs[uvStart + i * 4 + 2] = arc;
                mesh.uvs[uvStart + i * 4 + 3] = spanW;
            }
        }
    }
    faceWithHoles(kind, material, boundary, holes, upward = true) {
        const rows = [boundary, ...holes.filter((h) => h.length >= 3)], points = rows.flat(), starts = [];
        let count = boundary.length;
        for (const row of rows.slice(1)) {
            starts.push(count);
            count += row.length;
        }
        this.append(kind, material, points, earcut(points.flatMap((p) => [p[0], p[2]]), starts, 2), upward);
    }
    polygon(kind, material, boundary, center, upward = true) {
        const points = boundary.filter((p, i) => !i || distance(p, boundary[i - 1]) > 1e-7);
        if (points.length < 3)
            return;
        // A star-shaped junction uses a crowned fan, retaining EVERY mouth vertex,
        // including the center of the carriageway. This is the seam guarantee.
        if (center &&
            points.every((p, i) => crossXZ(sub(p, center), sub(points[(i + 1) % points.length], center)) >= -1e-7)) {
            const count = points.length, indices = points.flatMap((_, i) => [count, i, (i + 1) % count]);
            this.append(kind, material, [...points, center], indices, upward);
            return;
        }
        let indices = earcut(points.flatMap((p) => [p[0], p[2]]));
        // Earcut may discard collinear boundary vertices. Reinsert them into the
        // boundary triangle, so shared crowned cross-sections remain watertight.
        const used = new Set(indices);
        for (let k = 0; k < points.length; k++)
            if (!used.has(k)) {
                let found = false;
                for (let j = 0; j < indices.length && !found; j += 3)
                    for (let e = 0; e < 3; e++) {
                        const ids = indices.slice(j, j + 3), a = ids[e], b = ids[(e + 1) % 3], c = ids[(e + 2) % 3];
                        const ab = sub(points[b], points[a]), ak = sub(points[k], points[a]);
                        const projection = dotXZ(ab, ak) / Math.max(1e-12, dotXZ(ab, ab));
                        if (projection > 1e-7 &&
                            projection < 1 - 1e-7 &&
                            Math.abs(crossXZ(ab, ak)) < 1e-5) {
                            indices.splice(j, 3, a, k, c, k, b, c);
                            used.add(k);
                            found = true;
                            break;
                        }
                    }
            }
        this.append(kind, material, points, indices, upward);
    }
    box(kind, material, center, width, height, depth, d = [0, 0, 1]) {
        const right = [d[2], 0, -d[0]];
        const p = (x, y, z) => add(center, add(mul(right, (x * width) / 2), add([0, (y * height) / 2, 0], mul(d, (z * depth) / 2))));
        const verts = [
            p(-1, -1, -1),
            p(1, -1, -1),
            p(1, 1, -1),
            p(-1, 1, -1),
            p(-1, -1, 1),
            p(1, -1, 1),
            p(1, 1, 1),
            p(-1, 1, 1),
        ];
        for (const face of [
            [0, 3, 2, 1],
            [4, 5, 6, 7],
            [0, 4, 7, 3],
            [1, 2, 6, 5],
            [3, 7, 6, 2],
            [0, 1, 5, 4],
        ])
            this.quad(kind, material, face.map((i) => verts[i]));
    }
    output() {
        return [...this.meshes.values()].filter((m) => m.indices.length);
    }
}
export function pavingBands(b, inner, outer, widths) {
    const band = 0.16, up = (p) => add(p, [0, 0.004, 0]);
    b.strip("paving", "pave-border", inner.map(up), inner.map((p, k) => up(lerp(p, outer[k], Math.min(0.3, band / Math.max(0.01, widths[k]))))), true);
    b.strip("paving", "pave-border", outer.map((p, k) => up(lerp(p, inner[k], Math.min(0.3, band / Math.max(0.01, widths[k]))))), outer.map(up), true);
}
/** A shared metric curb profile keeps the chamfer exact at body/junction seams. */
export function curbSections(base, inner, outer) {
    const sizes = base.map((p, i) => Math.min(0.015, Math.abs(inner[i][1] - p[1]) * 0.22, distanceXZ(inner[i], outer[i]) * 0.2));
    return [
        base,
        inner.map((p, i) => add(p, [0, -sizes[i], 0])),
        inner.map((p, i) => lerp(p, outer[i], sizes[i] / Math.max(1e-9, distanceXZ(p, outer[i])))),
        outer,
    ];
}
export function sweepCurb(b, material, base, inner, outer) {
    const rows = curbSections(base, inner, outer);
    for (let i = 0; i < rows.length - 1; i++)
        b.strip("curb", material, rows[i], rows[i + 1], i > 0 ? true : undefined);
}
function needsJoint(project, node, alignments) {
    const roads = connected(project, node.id);
    if (roads.length >= 3)
        return true;
    if (roads.length !== 2)
        return false;
    if (roads.every((r) => bridgeAt(r, r.start === node.id ? 0 : 1)) &&
        (roads[0].structure !== roads[1].structure ||
            Math.abs(roads[0].bridgeDepth - roads[1].bridgeDepth) > 0.001))
        return true;
    const profiles = roads.map((r) => {
        const alignment = alignments.get(r.id), isStart = r.start === node.id, station = isStart ? alignment.stations[0] : alignment.stations.at(-1), radius = cubicProfile(alignment.points).radiusAt(station.t), scale = Math.max(0.05, Math.min(1, (radius * 0.78) / (roadHalfWidth(r) + r.sidewalk + 0.6))), f = frameWithWidth(station, r, scale, alignment.length), sign = isStart ? 1 : -1;
        return {
            f,
            left: sideHalfWidth(f, sign),
            right: sideHalfWidth(f, -sign),
        };
    }), [a, z] = profiles;
    // Compare the surfaces that really meet at this node, in outward-arm
    // coordinates. Equal maximum widths can hide opposite auxiliary sides or a
    // different crown/curb profile, leaving a slit across the driving surface.
    if (Math.abs(a.left - z.right) > 0.01 ||
        Math.abs(a.right - z.left) > 0.01 ||
        Math.abs(surfaceHeight(a.f) - surfaceHeight(z.f)) > 0.001 ||
        Math.abs(a.f.crossfall - z.f.crossfall) > 0.001 ||
        Math.abs(a.f.sw - z.f.sw) > 0.02 ||
        Math.abs(a.f.cw - z.f.cw) > 0.001 ||
        Math.abs(a.f.curbHeight - z.f.curbHeight) > 0.001 ||
        Math.abs(a.f.sidewalkCrossfall - z.f.sidewalkCrossfall) > 0.001 ||
        roads[0].lanes !== roads[1].lanes ||
        Math.abs(roads[0].laneWidth - roads[1].laneWidth) > 0.001 ||
        Math.abs(roads[0].median - roads[1].median) > 0.001 ||
        roads[0].curbStyle !== roads[1].curbStyle)
        return true;
    const dirs = roads.map((r) => {
        const a = alignments.get(r.id);
        return mul(r.start === node.id ? a.stations[0].d : a.stations.at(-1).d, r.start === node.id ? 1 : -1);
    });
    return dotXZ(dirs[0], dirs[1]) > -Math.cos((12 * Math.PI) / 180);
}
function trimDistance(project, node, alignments) {
    const roads = connected(project, node.id), widths = roads.map((r) => roadHalfWidthAt(r, r.start === node.id ? 0 : alignments.get(r.id).length, alignments.get(r.id).length) -
        (canExtendCurbs(r) && effectiveCrossing(project, node.id) ? 2.1 : 0)), maxWidth = Math.max(...widths);
    const angles = roads
        .map((r) => {
        const a = alignments.get(r.id), d = r.start === node.id ? a.stations[0].d : mul(a.stations.at(-1).d, -1);
        return Math.atan2(d[2], d[0]);
    })
        .sort((a, b) => a - b);
    let minAngle = Math.PI;
    angles.forEach((angle, i) => {
        const gap = (angles[(i + 1) % angles.length] - angle + Math.PI * 2) % (Math.PI * 2);
        minAngle = Math.min(minAngle, gap);
    });
    const radius = effectiveCornerRadius(node.radius, roads.map((r) => ({
        sw: r.sidewalk +
            (canExtendCurbs(r) && effectiveCrossing(project, node.id) ? 2.1 : 0),
        cw: roadCurbWidth(r),
    })));
    return (Math.max(radius + maxWidth + 0.8, (radius + maxWidth) / Math.max(0.075, Math.tan(minAngle / 2)) + 0.8) + (node.setback ?? 0));
}
function frameWithWidth(s, road, scale = 1, length = 1) {
    return {
        ...s,
        auxWidth: auxiliaryWidthAt(road, s.s, length) * scale,
        auxSide: road.trafficSide === "left" ? -1 : 1,
        profileScale: scale,
        crownHeight: Math.max(SURFACE, 0.04 +
            (roadHalfWidthAt(road, s.s, length) * scale * road.crossfall) / 100),
        roadBaseDepth: bridgeAt(road, s.t) ? 0.28 : 0.48,
        hw: baseRoadHalfWidth(road) * scale,
        sw: road.sidewalk * scale,
        cw: roadCurbWidth(road) * scale,
        crossfall: road.crossfall,
        sidewalkCrossfall: road.sidewalkCrossfall,
        curbHeight: road.curbStyle === "flush"
            ? road.markingStyle === "motorway"
                ? 0
                : Math.min(0.04, road.curbHeight)
            : road.curbStyle === "race"
                ? Math.min(0.08, road.curbHeight)
                : road.curbHeight,
    };
}
function hasSelfCrossing(alignment) {
    const stations = alignment.stations;
    if (alignment.length > 1 &&
        distanceXZ(stations[0].p, stations.at(-1).p) < 0.1 &&
        Math.abs(stations[0].p[1] - stations.at(-1).p[1]) < 0.7)
        return true;
    const cells = new Map();
    for (let i = 1; i < stations.length; i++) {
        const a = stations[i - 1], b = stations[i];
        for (let x = Math.floor(Math.min(a.p[0], b.p[0]) / 20); x <= Math.floor(Math.max(a.p[0], b.p[0]) / 20); x++)
            for (let z = Math.floor(Math.min(a.p[2], b.p[2]) / 20); z <= Math.floor(Math.max(a.p[2], b.p[2]) / 20); z++) {
                const key = `${x},${z}`, bucket = cells.get(key) ?? [];
                for (const segment of bucket) {
                    if (Math.abs(i - segment.index) <= 2)
                        continue;
                    const hit = segmentIntersection(a.p, b.p, segment.a.p, segment.b.p);
                    if (hit &&
                        hit[0] > 1e-5 &&
                        hit[0] < 1 - 1e-5 &&
                        hit[1] > 1e-5 &&
                        hit[1] < 1 - 1e-5) {
                        const ay = a.p[1] + (b.p[1] - a.p[1]) * hit[0], by = segment.a.p[1] + (segment.b.p[1] - segment.a.p[1]) * hit[1];
                        if (Math.abs(ay - by) < 0.7)
                            return true;
                    }
                }
                bucket.push({ a, b, index: i });
                cells.set(key, bucket);
            }
    }
    return false;
}
function makeFrames(stations, road, diagnostics, project, startJoint, endJoint, length) {
    let limited = false;
    const differential = cubicProfile(controlPoints(project, road));
    const frames = stations.map((s) => {
        const radius = differential.radiusAt(s.t);
        const scale = Math.min(1, (radius * 0.78) / (roadHalfWidth(road) + road.sidewalk + 0.6));
        if (scale < 0.98)
            limited = true;
        const f = frameWithWidth(s, road, Math.max(0.05, scale), length);
        if (canExtendCurbs(road)) {
            const weight = extensionWeight(s.s, stations[0].s, stations.at(-1).s, startJoint && effectiveCrossing(project, road.start), endJoint && effectiveCrossing(project, road.end));
            const inset = 2.1 * (f.profileScale ?? 1) * weight;
            // Consume ONLY the parking bay, never a motor lane. Outside boundary stays fixed.
            const outsideRise = (f.sw * f.sidewalkCrossfall) / 100 - (inset * f.crossfall) / 100;
            f.hw -= inset;
            f.sw += inset;
            // Anchor the existing outer walk elevation while the bulb fills the bay.
            f.sidewalkCrossfall = (outsideRise / Math.max(0.05, f.sw)) * 100;
        }
        return f;
    });
    if (limited)
        diagnostics.push({
            level: "warning",
            message: `${road.name}: offsets narrowed to prevent a tight-curve fold.`,
            owner: road.id,
        });
    return frames;
}
export function frameAt(span, s) {
    if (s <= span.frames[0].s)
        return span.frames[0];
    if (s >= span.frames.at(-1).s)
        return span.frames.at(-1);
    const i = span.frames.findIndex((f) => f.s >= s), a = span.frames[i - 1], b = span.frames[i], t = (s - a.s) / Math.max(1e-8, b.s - a.s);
    const station = stationAt(span.alignment, s);
    return {
        ...station,
        roadBaseDepth: bridgeAt(span.road, station.t) ? 0.28 : 0.48,
        profileScale: (a.profileScale ?? 1) +
            ((b.profileScale ?? 1) - (a.profileScale ?? 1)) * t,
        auxWidth: (a.auxWidth ?? 0) + ((b.auxWidth ?? 0) - (a.auxWidth ?? 0)) * t,
        auxSide: a.auxSide,
        crownHeight: surfaceHeight(a) + (surfaceHeight(b) - surfaceHeight(a)) * t,
        hw: a.hw + (b.hw - a.hw) * t,
        sw: a.sw + (b.sw - a.sw) * t,
        cw: a.cw + (b.cw - a.cw) * t,
        crossfall: span.road.crossfall,
        curbHeight: a.curbHeight,
        sidewalkCrossfall: a.sidewalkCrossfall + (b.sidewalkCrossfall - a.sidewalkCrossfall) * t,
    };
}
export function ribbon(builder, span, from, to, offset, width, material = "paint") {
    if (to - from < 0.04)
        return;
    const frames = [
        frameAt(span, from),
        ...span.frames.filter((f) => f.s > from && f.s < to),
        frameAt(span, to),
    ];
    builder.strip("marking", material, frames.map((f) => surfacePoint(f, (offset - width / 2) * sectionScale(span, f), 0.018)), frames.map((f) => surfacePoint(f, (offset + width / 2) * sectionScale(span, f), 0.018)), true);
}
function crosswalk(builder, span, s) {
    const f = frameAt(span, s), width = f.hw * 2 - 0.36, length = span.road.rampWidth, stripes = Math.max(3, Math.floor(width / 0.85));
    for (let i = 0; i < stripes; i++) {
        const offset = -width / 2 + ((i + 0.5) * width) / stripes;
        if (span.road.median >= 1.2 &&
            Math.abs(offset) < (span.road.median * sectionScale(span, f)) / 2 + 0.18)
            continue;
        const p = (dx, ds) => surfacePoint(frameAt(span, s + ds), offset + dx, 0.023);
        builder.quad("marking", "paint", [
            p(-0.24, -length / 2),
            p(0.24, -length / 2),
            p(0.24, length / 2),
            p(-0.24, length / 2),
        ], true);
    }
}
export function arrow(builder, f, offset, direction) {
    const shape = [
        [-0.12, -1.5],
        [0.12, -1.5],
        [0.12, 0.3],
        [0.48, 0.3],
        [0, 1.3],
        [-0.48, 0.3],
        [-0.12, 0.3],
    ];
    builder.polygon("marking", "paint", shape.map(([x, z]) => add(surfacePoint(f, offset + x, 0.024), mul(f.d, z * direction))), undefined, true);
}
export function minimumApproachAngle(project, nodeId) {
    const angles = connected(project, nodeId)
        .map((r) => {
        const a = sampleAlignment(project, r), d = r.start === nodeId ? a.stations[0].d : mul(a.stations.at(-1).d, -1);
        return Math.atan2(d[2], d[0]);
    })
        .sort((a, b) => a - b);
    if (angles.length < 2)
        return Math.PI;
    return Math.min(...angles.map((a, i) => (angles[(i + 1) % angles.length] - a + Math.PI * 2) % (Math.PI * 2)));
}
export function effectiveCrossing(project, nodeId) {
    return (getNode(project, nodeId).crossings &&
        connected(project, nodeId).some((r) => r.markingStyle === "urban") &&
        minimumApproachAngle(project, nodeId) > Math.PI * 0.29);
}
function buildMarkings(builder, span, project) {
    const road = span.road;
    if (!road.markings)
        return;
    const start = span.frames[0].s, end = span.frames.at(-1).s;
    const startCrossing = span.startJoint && effectiveCrossing(project, road.start), endCrossing = span.endJoint && effectiveCrossing(project, road.end);
    const from = start + (startCrossing ? 5 : 0.35) + road.markingSetback, to = end - (endCrossing ? 5 : 0.35) - road.markingSetback;
    const hw = (road.lanes * road.laneWidth + road.median) / 2, travel = (road.lanes * road.laneWidth) / 2;
    for (const side of [-1, 1])
        for (const [a, z] of clearRuns(span, side, true)) {
            const first = Math.max(start + 0.3, a), last = Math.min(end - 0.3, z), offset = side *
                (travel +
                    road.median / 2 +
                    (road.markingStyle === "motorway" && road.shoulderWidth > 0
                        ? 0.065
                        : -0.22));
            if (supportsAuxiliary(road) &&
                road.auxiliaryLane !== "none" &&
                side === (road.trafficSide === "left" ? -1 : 1)) {
                const fs = [
                    frameAt(span, first),
                    ...span.frames.filter((f) => f.s > first && f.s < last),
                    frameAt(span, last),
                ], edge = (dx) => fs.map((f) => surfacePoint(f, (offset + dx) * sectionScale(span, f) +
                    side * (f.auxWidth ?? 0), 0.018));
                if (last - first > 0.04)
                    builder.strip("marking", "paint", edge(-0.065), edge(0.065), true);
            }
            else
                ribbon(builder, span, first, last, offset, 0.13);
        }
    for (let lane = 1; lane < road.lanes &&
        road.markingStyle !== "race" &&
        !road.sharedCycleStreet; lane++) {
        const offset = -travel +
            road.laneWidth * lane +
            (lane < road.lanes / 2
                ? -road.median / 2
                : lane > road.lanes / 2
                    ? road.median / 2
                    : 0);
        if (lane === road.lanes / 2 && road.median > 0)
            continue;
        if (road.lanes >= 4 &&
            lane === road.lanes / 2 &&
            !road.oneWay &&
            road.markingStyle === "urban") {
            ribbon(builder, span, from, to, offset - 0.12, 0.1, "paint");
            ribbon(builder, span, from, to, offset + 0.12, 0.1, "paint");
        }
        else
            for (let s = Math.ceil(from / 6) * 6; s < to - 0.1; s += road.markingStyle === "motorway" ? 10 : 6)
                ribbon(builder, span, s, Math.min(to, s + (road.markingStyle === "motorway" ? 5 : 2.7)), offset, 0.13);
    }
    if (road.markingStyle === "race" && road.startingGrid) {
        const a = from + 3, z = Math.min(to, from + 5.2);
        if (z > a)
            for (let row = 0; row < 2; row++)
                for (let cell = 0; cell < 16; cell++) {
                    const f = frameAt(span, a + ((z - a) * row) / 2), g = frameAt(span, a + ((z - a) * (row + 1)) / 2), lo = -f.hw + (f.hw * 2 * cell) / 16, hi = -f.hw + (f.hw * 2 * (cell + 1)) / 16;
                    builder.quad("marking", (cell + row) % 2 ? "paint" : "rubber", [
                        surfacePoint(f, lo, 0.022),
                        surfacePoint(f, hi, 0.022),
                        surfacePoint(g, -g.hw + (g.hw * 2 * (cell + 1)) / 16, 0.022),
                        surfacePoint(g, -g.hw + (g.hw * 2 * cell) / 16, 0.022),
                    ], true);
                }
        for (let lane = 0; lane < 2; lane++)
            for (let i = 0; i < 5; i++) {
                const s = from + 10 + i * 7;
                if (s + 2 < to) {
                    ribbon(builder, span, s, s + 2, (lane === 0 ? -1 : 1) * travel * 0.5 - 0.65, 0.11);
                    ribbon(builder, span, s, s + 2, (lane === 0 ? -1 : 1) * travel * 0.5 + 0.65, 0.11);
                }
            }
    }
    for (const crossing of crossingStations(span, project)) {
        if (end - start > 14) {
            const s = crossing.s - crossing.direction * (road.rampWidth / 2 + 0.8);
            const incoming = motorLanes(road).filter((l) => l.direction === crossing.direction);
            for (const lane of incoming)
                ribbon(builder, span, s - 0.18, s + 0.18, lane.offset, road.laneWidth - 0.1);
        }
        crosswalk(builder, span, crossing.s);
    }
    if (road.markingStyle === "urban" &&
        !road.sharedCycleStreet &&
        end - start > 32) {
        const draw = (s, dir) => {
            const f = frameAt(span, s);
            const shape = [
                [-0.12, -1.5],
                [0.12, -1.5],
                [0.12, 0.3],
                [0.48, 0.3],
                [0, 1.3],
                [-0.48, 0.3],
                [-0.12, 0.3],
            ];
            for (const lane of motorLanes(road).filter((l) => !l.bus && l.direction === dir))
                builder.polygon("marking", "paint", shape.map(([x, ds]) => {
                    const at = frameAt(span, s + ds * dir);
                    return surfacePoint(at, (lane.offset + x) * sectionScale(span, at), 0.024);
                }), undefined, true);
        };
        if (span.startJoint && !road.oneWay)
            draw(start + 12, -1);
        if (span.endJoint)
            draw(end - 12, 1);
        else if (span.startJoint && road.oneWay)
            draw(start + 12, 1);
    }
}
function buildRails(builder, span) {
    if (!span.road.guardrails)
        return;
    for (const side of [-1, 1])
        for (const [a, z] of clearRuns(span, side)) {
            const frames = [
                frameAt(span, a),
                ...span.frames.filter((f) => f.s > a && f.s < z),
                frameAt(span, z),
            ];
            buildBarrierPath(builder, frames.map((f) => edgePoint(f, side, "outer")), frames.map((f) => mul(f.n, side)), () => span.road.railHeight, span.road.railStyle, span.road.postSpacing, span.detail);
        }
}
function addInlet(builder, span, station, side) {
    const f = frameAt(span, station), offset = side * (sideHalfWidth(f, side) - 0.28);
    addGratedInlet(builder, roadSampler(span, station, offset));
    return {
        id: `${builder.owner}:inlet:${side}:${Math.round(station * 100)}`,
        owner: builder.owner,
        ownerKind: builder.ownerKind,
        kind: "curb-inlet",
        style: "grate",
        position: surfacePoint(f, offset, 0.015),
    };
}
function buildDrainage(builder, span, services) {
    if (!span.road.drainage)
        return 0;
    let inlets = 0;
    for (const side of [-1, 1]) {
        const a = span.frames.map((f) => surfacePoint(f, side * (sideHalfWidth(f, side) - 0.035), 0.004)), b = span.frames.map((f) => surfacePoint(f, side * (sideHalfWidth(f, side) - 0.15), 0.004));
        builder.strip("gutter", "gutter", a, b, true);
        if (span.road.drainageType !== "curb")
            services.push(buildLinearDrain(builder, span, side));
        if (span.road.drainageType !== "linear" &&
            (span.road.curbDrainType !== "hollow" || span.frames[0].curbHeight < 0.11))
            for (const inlet of (span.footway?.inlets ?? []).filter((i) => i.side === side)) {
                if (span.road.curbDrainType === "side-entry" &&
                    services.some((s) => s.style === "side-entry" &&
                        s.id.endsWith(`${side}:${Math.round(inlet.s * 100)}`)))
                    continue;
                services.push(addInlet(builder, span, inlet.s, side));
                inlets++;
            }
    }
    return inlets;
}
function buildSpan(span, project) {
    const b = new MeshBuilder(span.road.id, "road"), frames = span.frames, road = span.road;
    const center = frames.map((f) => surfacePoint(f, 0)), left = frames.map((f) => edgePoint(f, 1, "road")), right = frames.map((f) => edgePoint(f, -1, "road"));
    b.strip("asphalt", roadMaterial(road), left, center, true);
    b.strip("asphalt", roadMaterial(road), center, right, true);
    const footwayResult = buildSpanFootways(b, span, project);
    b.strip("structure", "road-base", frames.map((f) => edgePoint(f, 1, "bottom")), frames.map((f) => edgePoint(f, -1, "bottom")), false);
    // Only true dead ends get a cap. Shared straight joins abut without overlap.
    for (const [f, id] of [
        [frames[0], road.start],
        [frames.at(-1), road.end],
    ])
        if (connected(project, id).length === 1) {
            const profile = (side) => curbSections([edgePoint(f, side, "road")], [edgePoint(f, side, "curbIn")], [edgePoint(f, side, "curbOut")]).map((row) => row[0]);
            const top = [
                edgePoint(f, -1, "outer"),
                ...profile(-1).reverse(),
                surfacePoint(f, 0),
                ...profile(1),
                edgePoint(f, 1, "outer"),
            ];
            for (let i = 0; i < top.length - 1; i++)
                b.quad("structure", "road-base", [
                    top[i],
                    top[i + 1],
                    [top[i + 1][0], f.p[1] - (f.roadBaseDepth ?? 0.48), top[i + 1][2]],
                    [top[i][0], f.p[1] - (f.roadBaseDepth ?? 0.48), top[i][2]],
                ]);
        }
    const mobility = buildRoadMobility(b, span);
    buildMarkings(b, span, project);
    const auxiliaryLane = buildAuxiliaryLane(b, span);
    const refuges = buildMedian(b, span, project);
    const streetDetails = [...streetFeatures(span, project), ...refuges];
    const roadsideParking = buildParallelParking(b, span);
    buildRoadFurniture(b, span, project);
    buildRails(b, span);
    const services = [...footwayResult.services, ...buildRoadManholes(b, span)], inlets = buildDrainage(b, span, services);
    return {
        meshes: b.output(),
        inlets,
        services,
        streetDetails,
        roadsideParking,
        auxiliaryLane,
        footways: footwayResult.features,
        plantings: footwayResult.plantings,
        mobility,
    };
}
/** Public corner sampler; topology/offsets use the same analytic construction. */
export function cornerCurve(a, da, b, db, requestedRadius, detail = "editing") {
    return cornerPath(a, da, b, db, requestedRadius, detail).points;
}
function buildCornerRails(builder, curve, a, b, normals, detail) {
    if (!a.road.guardrails || !b.road.guardrails)
        return;
    const height = (t) => a.road.railHeight * (1 - t) + b.road.railHeight * t, spacing = (a.road.postSpacing + b.road.postSpacing) / 2;
    if (a.road.railStyle === b.road.railStyle) {
        buildBarrierPath(builder, curve, normals, height, a.road.railStyle, spacing, detail);
        return;
    }
    const i = Math.floor(curve.length / 2);
    buildBarrierPath(builder, curve.slice(0, i + 1), normals.slice(0, i + 1), (t) => height(t * 0.5), a.road.railStyle, spacing, detail);
    buildBarrierPath(builder, curve.slice(i), normals.slice(i), (t) => height(0.5 + t * 0.5), b.road.railStyle, spacing, detail);
    const d = normalizeXZ(sub(curve[Math.min(i + 1, curve.length - 1)], curve[Math.max(0, i - 1)]));
    builder.box("rail", "steel", add(curve[i], [0, height(0.5) - 0.04, 0]), 0.21, 0.18, 0.45, d);
}
function makeArm(span, node) {
    const isStart = span.road.start === node.id, f = isStart ? span.frames[0] : span.frames.at(-1), sign = isStart ? 1 : -1;
    const d = mul(f.d, sign), n = normalXZ(d);
    return {
        road: span.road,
        frame: f,
        d,
        n,
        angle: Math.atan2(d[2], d[0]),
        isStart,
        center: surfacePoint(f, 0),
        left: edgePoint(f, sign, "road"),
        right: edgePoint(f, -sign, "road"),
        outerLeft: edgePoint(f, sign, "outer"),
        outerRight: edgePoint(f, -sign, "outer"),
    };
}
function armPart(arm, side, part) {
    return edgePoint(arm.frame, side * (arm.isStart ? 1 : -1), part);
}
function buildJunction(node, spans, diagnostics, detail) {
    const b = new MeshBuilder(node.id, "node"), arms = spans.map((s) => makeArm(s, node)).sort((a, b) => a.angle - b.angle);
    const boundary = [], outer = [], corners = [], pavedCorners = [], paths = [];
    const material = arms.reduce((a, r) => (r.road.lanes > a.road.lanes ? r : a), arms[0]);
    const junctionRoad = material.road, asphaltMaterial = roadMaterial(junctionRoad);
    const radius = effectiveCornerRadius(node.radius, arms.map((a) => a.frame));
    const baseDepth = arms.some((a) => bridgeAt(a.road, a.isStart ? 0 : 1)) &&
        node.position[1] > 1.6
        ? 0.28
        : 0.48;
    let inlets = 0;
    const services = [];
    for (let i = 0; i < arms.length; i++) {
        const a = arms[i], next = arms[(i + 1) % arms.length], path = cornerPath(a.left, a.d, next.right, next.d, radius, detail), curve = path.points;
        const curbIn = curve.map((p, k) => add(p, [
            0,
            a.frame.curbHeight +
                (next.frame.curbHeight - a.frame.curbHeight) * path.fractions[k],
            0,
        ]));
        curbIn[0] = armPart(a, 1, "curbIn");
        curbIn[curbIn.length - 1] = armPart(next, -1, "curbIn");
        const curbOut = offsetCornerPath(path, armPart(a, 1, "curbOut"), armPart(next, -1, "curbOut"), a.frame.cw, next.frame.cw);
        const paved = offsetCornerPath(path, a.outerLeft, next.outerRight, a.frame.cw + a.frame.sw, next.frame.cw + next.frame.sw);
        buildCornerRails(b, paved, a, next, path.normals, detail);
        corners.push(curve);
        pavedCorners.push(paved);
        paths.push(path);
        boundary.push(a.right, a.center, a.left, ...curve.slice(1, -1));
        outer.push(a.outerRight, a.outerLeft, ...paved.slice(1, -1));
        sweepCurb(b, a.road.curbStyle === "race" && next.road.curbStyle === "race"
            ? "race-curb"
            : "curb", curve, curbIn, curbOut);
        if (a.frame.sw > 0 || next.frame.sw > 0) {
            b.strip("paving", `paving-${a.road.pattern}`, curbOut, paved, true);
            pavingBands(b, curbOut, paved, curbOut.map((p, k) => distanceXZ(p, paved[k])));
        }
        const bottom = paved.map((p) => [p[0], node.position[1] - baseDepth, p[2]]);
        bottom[0] = armPart(a, 1, "bottom");
        bottom[bottom.length - 1] = armPart(next, -1, "bottom");
        b.strip("structure", "road-base", paved, bottom);
        if (a.road.drainage &&
            a.road.drainageType !== "linear" &&
            a.road.curbDrainType === "grate") {
            const span = spans.find((s) => s.road.id === a.road.id);
            const station = a.isStart
                ? span.frames[0].s + 1.2
                : span.frames.at(-1).s - 1.2;
            if (span.length > 3) {
                services.push(addInlet(b, span, station, a.isStart ? 1 : -1));
                inlets++;
            }
        }
    }
    const valid = simplePolygon(boundary) && Math.abs(polygonArea(boundary)) > 0.1;
    if (!valid)
        diagnostics.push({
            level: "error",
            message: `${node.name}: overlapping approaches. Move the node or separate nearly parallel arms.`,
            owner: node.id,
        });
    b.polygon("asphalt", asphaltMaterial, boundary, add(node.position, [0, SURFACE, 0]));
    const mobility = buildJunctionMobility(b, node, arms, paths, b.output().filter((m) => m.kind === "asphalt"));
    const splitters = buildJunctionMarkings(b, node, arms, b.target("asphalt", asphaltMaterial), paths);
    buildTrafficSignals(b, node, arms);
    const bottom = outer.map((p) => [p[0], node.position[1] - baseDepth, p[2]]);
    arms.forEach((arm) => {
        for (const [top, bot] of [
            [arm.outerLeft, armPart(arm, 1, "bottom")],
            [arm.outerRight, armPart(arm, -1, "bottom")],
        ]) {
            const k = outer.indexOf(top);
            if (k >= 0)
                bottom[k] = bot;
        }
    });
    b.polygon("structure", "road-base", bottom, add(node.position, [0, -baseDepth, 0]), false);
    const retained = arms.some((a) => a.road.embankment) &&
        !arms.some((a) => bridgeAt(a.road, a.isStart ? 0 : 1));
    const type = arms.some((a, i) => (arms[(i + 1) % arms.length].angle - a.angle + Math.PI * 2) %
        (Math.PI * 2) <
        Math.PI * 0.29)
        ? "Merge"
        : arms.length === 2
            ? "Bend"
            : arms.length === 3
                ? "3-way"
                : arms.length === 4
                    ? "4-way"
                    : `${arms.length}-way`;
    return {
        junction: {
            node,
            arms,
            boundary,
            outer,
            corners,
            pavedCorners,
            type,
            valid,
            radius,
            requestedRadius: node.radius,
            cornerRadii: paths.map((p) => p.radius),
        },
        meshes: b.output(),
        inlets,
        services,
        mobility,
        splitters,
        bottom,
        retained,
    };
}
/** Short mouths cannot contain an arbitrarily wide inward offset. Fit the
 * shared approach footway once, then taper it along the road before meshing;
 * pinning a 12 m end onto a 2 m fillet would otherwise create another spike. */
function fitJunctionFootways(nodes, spans, diagnostics) {
    const caps = new Map();
    for (const node of nodes) {
        const arms = spans
            .filter((s) => s.road.start === node.id || s.road.end === node.id)
            .map((s) => makeArm(s, node))
            .sort((a, z) => a.angle - z.angle);
        if (arms.length < 2)
            continue;
        const radius = effectiveCornerRadius(node.radius, arms.map((a) => a.frame));
        for (let i = 0; i < arms.length; i++) {
            const a = arms[i], z = arms[(i + 1) % arms.length], path = cornerPath(a.left, a.d, z.right, z.d, radius, "production"), limit = Math.min(...path.insetLimits);
            if (!Number.isFinite(limit))
                continue;
            for (const arm of [a, z]) {
                const f = arm.frame, prior = caps.get(f) ?? { sw: f.sw, cw: f.cw }, cw = Math.min(prior.cw, Math.max(0.03, limit * 0.25)), sw = Math.min(prior.sw, Math.max(0.08, limit - cw - 0.4));
                caps.set(f, { sw, cw });
            }
        }
    }
    for (const span of spans) {
        const first = span.frames[0], last = span.frames.at(-1), a = caps.get(first) ?? { sw: first.sw, cw: first.cw }, z = caps.get(last) ?? { sw: last.sw, cw: last.cw };
        let limited = false;
        for (const f of span.frames) {
            const sw = Math.min(f.sw, a.sw + (f.s - first.s) * 0.65, z.sw + (last.s - f.s) * 0.65), cw = Math.min(f.cw, a.cw + (f.s - first.s) * 0.05, z.cw + (last.s - f.s) * 0.05);
            if (sw < f.sw - 0.01 || cw < f.cw - 0.01)
                limited = true;
            f.sw = sw;
            f.cw = cw;
        }
        if (limited)
            diagnostics.push({
                owner: span.road.id,
                level: "warning",
                message: `${span.road.name}: footways tapered to fit a short junction approach. Lengthen the road to retain the requested width.`,
            });
    }
}
export function buildNetwork(project, options = {}) {
    const detail = normaliseDetail(options.detail), profile = geometryProfiles[detail];
    validateGenerationBudget(project);
    // Dense meshes need a separate preflight budget, before any allocation.
    if (detail === "production") {
        const estimate = project.roads.reduce((sum, r) => {
            const p = getNode(project, r.start).position, q = getNode(project, r.end).position;
            return (sum +
                distance([0, 0, 0], r.h1) +
                distance(add(p, r.h1), add(q, r.h2)) +
                distance([0, 0, 0], r.h2));
        }, 0);
        if (estimate > 32000)
            throw new RangeError("Production geometry budget: 32 km of control-polygon length per editor tile. Export larger worlds as separate tiles.");
    }
    const diagnostics = [], alignments = new Map(project.roads.map((r) => [r.id, sampleAlignment(project, r, profile)]));
    const jointNodes = project.nodes.filter((n) => needsJoint(project, n, alignments)), jointIDs = new Set(jointNodes.map((n) => n.id));
    const blockedFill = new Set(), structureIssues = [];
    const structureIssue = (owner, kind, position, message) => {
        structureIssues.push({ owner, kind, position: [...position], message });
        diagnostics.push({ owner, level: "error", message });
    };
    const backs = new Map(jointNodes.map((n) => [n.id, trimDistance(project, n, alignments)]));
    const spans = [], meshes = [], junctions = [], services = [], footways = [], plantings = [], blocks = [], mobility = [], bridges = [], streetDetails = [], roadsideParking = [], embankments = [], auxiliaryLanes = [], splitters = [], bridgeJoints = [];
    let length = 0, inlets = 0, maxGrade = 0;
    for (const road of project.roads) {
        const alignment = alignments.get(road.id);
        length += alignment.length;
        const metric = curveDesignMetrics(alignment.points);
        if (metric.maximumGrade === null)
            maxGrade = null;
        else if (maxGrade !== null)
            maxGrade = Math.max(maxGrade, metric.maximumGrade);
        for (const issue of metric.issues)
            diagnostics.push({
                level: "error",
                owner: road.id,
                message: `${road.name}: ${curveIssueMessages[issue.kind]} (curve ${(issue.parameter * 100).toFixed(4)}%).`,
            });
        if (metric.planLength < 0.2) {
            diagnostics.push({
                level: "error",
                owner: road.id,
                message: `${road.name}: zero-length horizontal road.`,
            });
            continue;
        }
        if (hasSelfCrossing(alignment))
            diagnostics.push({
                level: "error",
                message: `${road.name}: self-crossing alignment. Adjust the Bézier handles or use separate connected roads.`,
                owner: road.id,
            });
        if (alignment.length < 0.2) {
            diagnostics.push({
                level: "error",
                message: `${road.name}: zero-length road.`,
                owner: road.id,
            });
            continue;
        }
        const requiredA = backs.get(road.start) ?? 0, requiredB = backs.get(road.end) ?? 0;
        // Spend the available approach length, not a hard 43% at BOTH ends.
        // A free-ended 94 m road can give an acute merge its full fillet runout.
        const available = Math.max(0, alignment.length - Math.min(4, alignment.length * 0.2)), factor = Math.min(1, available / Math.max(1e-8, requiredA + requiredB)), start = requiredA * factor, end = requiredB * factor;
        if (factor < 0.99)
            diagnostics.push({
                level: "warning",
                message: `${road.name}: short approach limits the junction radius.`,
                owner: road.id,
            });
        const stations = trimmedStations(alignment, start, end), stationFirst = stations[0].s, stationLast = stations.at(-1).s;
        if (road.bridge)
            for (const t of [road.bridgeFrom, road.bridgeTo]) {
                const s = parameterStation(alignment, t);
                if (s > stationFirst + 1e-7 &&
                    s < stationLast - 1e-7 &&
                    !stations.some((f) => Math.abs(f.s - s) < 1e-7))
                    stations.push(stationAt(alignment, s));
            }
        if (road.auxiliaryLane !== "none" && supportsAuxiliary(road)) {
            const { run, taper, scale } = auxiliaryDimensions(road, alignment.length);
            const knots = road.auxiliaryLane === "exit"
                ? [alignment.length - run - taper, alignment.length - run]
                : [run, run + taper];
            for (const s of knots)
                if (s > stationFirst + 1e-7 &&
                    s < stationLast - 1e-7 &&
                    !stations.some((f) => Math.abs(f.s - s) < 1e-7))
                    stations.push(stationAt(alignment, s));
            if (scale < 0.999)
                diagnostics.push({
                    owner: road.id,
                    level: "warning",
                    message: `${road.name}: speed-change lane/taper shortened to fit. Lengthen the alignment to retain the requested ${road.auxiliaryLength + road.auxiliaryTaper} m.`,
                });
        }
        stations.sort((a, b) => a.s - b.s);
        // Near-straight degree-two joins share a canonical cross-section normal.
        // A tiny handle-angle mismatch cannot leave a hairline gap in the deck.
        for (const [index, nodeID] of [
            [0, road.start],
            [stations.length - 1, road.end],
        ]) {
            const incident = connected(project, nodeID);
            if (jointIDs.has(nodeID) || incident.length !== 2)
                continue;
            const dirs = incident.map((r) => {
                const a = alignments.get(r.id);
                return mul(r.start === nodeID ? a.stations[0].d : a.stations.at(-1).d, r.start === nodeID ? 1 : -1);
            });
            const canonical = normalizeXZ(sub(dirs[0], dirs[1]));
            const sign = (incident[0].id === road.id ? 1 : -1) *
                (road.start === nodeID ? 1 : -1);
            stations[index].d = mul(canonical, sign);
            stations[index].n = normalXZ(stations[index].d);
        }
        const frames = makeFrames(stations, road, diagnostics, project, jointIDs.has(road.start), jointIDs.has(road.end), alignment.length);
        const span = {
            road,
            detail,
            alignment,
            frames,
            startJoint: jointIDs.has(road.start),
            endJoint: jointIDs.has(road.end),
            length: alignment.length - start - end,
        };
        spans.push(span);
    }
    for (const join of measureGradeJoins(project))
        if (join.assessed && !join.continuous)
            diagnostics.push({
                owner: join.owner,
                level: "warning",
                message: `${getNode(project, join.owner).name}: vertical grade discontinuity ${join.delta === null ? "is unbounded" : `${join.delta.toFixed(2)} percentage points`}. Retune the connected vertical handles.`,
            });
    fitJunctionFootways(jointNodes, spans, diagnostics);
    for (const span of spans) {
        const road = span.road;
        span.footway = prepareFootways(span, project);
        if (span.footway.ramps.filter((a) => a.kind === "driveway").length <
            road.driveways.length)
            diagnostics.push({
                owner: road.id,
                level: "warning",
                message: `${road.name}: an entry is too close to a junction, overlaps another ramp, or needs a wider non-bridge sidewalk. Move the entry or widen the footway.`,
            });
        const result = buildSpan(span, project);
        meshes.push(...result.meshes);
        inlets += result.inlets;
        services.push(...result.services);
        footways.push(...result.footways);
        plantings.push(...result.plantings);
        mobility.push(...result.mobility);
        streetDetails.push(...result.streetDetails);
        roadsideParking.push(...result.roadsideParking);
        if (result.auxiliaryLane)
            auxiliaryLanes.push(result.auxiliaryLane);
    }
    for (const node of jointNodes) {
        const result = buildJunction(node, spans.filter((s) => s.road.start === node.id || s.road.end === node.id), diagnostics, detail);
        junctions.push(result.junction);
        bridgeJoints.push({
            node,
            arms: result.junction.arms,
            bottom: result.bottom,
            retained: result.retained,
        });
        mobility.push(...result.mobility);
        splitters.push(...result.splitters);
        meshes.push(...result.meshes);
        inlets += result.inlets;
        services.push(...result.services);
    }
    if (maxGrade !== null && maxGrade > 14)
        diagnostics.push({
            level: "warning",
            message: `Maximum grade is ${maxGrade.toFixed(1)}%. Lengthen the approach or reduce its elevation.`,
            owner: "",
        });
    const clearances = [];
    for (const site of project.sites ?? []) {
        meshes.push(...buildSiteGeometry(site, services, plantings, blocks));
        if (site.kind === "parking")
            for (const message of parkingPlan(site).warnings)
                diagnostics.push({
                    level: "warning",
                    owner: site.id,
                    message: `${site.name}: ${message}`,
                });
        if (site.kind === "water" || site.kind === "block")
            continue;
        const footprint = siteOutline(site), minX = Math.min(...footprint.map((p) => p[0])), maxX = Math.max(...footprint.map((p) => p[0])), minZ = Math.min(...footprint.map((p) => p[2])), maxZ = Math.max(...footprint.map((p) => p[2]));
        const contains = (p) => site.kind === "urban-block"
            ? blockSolidAt(site, p)
            : insidePolygon(p, footprint);
        const hits = spans.some((span) => span.frames.some((f) => {
            if (Math.abs(f.p[1] - site.position[1]) > 0.7 ||
                f.p[0] < minX - f.hw ||
                f.p[0] > maxX + f.hw ||
                f.p[2] < minZ - f.hw ||
                f.p[2] > maxZ + f.hw)
                return false;
            // An access driveway may deliberately abut a parking entrance.
            if (site.kind === "parking" &&
                (f.s < 6 || span.alignment.length - f.s < 6))
                return false;
            return (contains(f.p) ||
                contains(edgePoint(f, -1, "road")) ||
                contains(edgePoint(f, 1, "road")));
        })) ||
            junctions.some((j) => Math.abs(j.node.position[1] - site.position[1]) < 0.7 &&
                (contains(j.node.position) ||
                    footprint.some((p) => contains(p) && insidePolygon(p, j.boundary))));
        if (hits)
            diagnostics.push({
                level: "warning",
                message: `${site.name}: footprint encroaches into a driveable road. Move or resize the site.`,
                owner: site.id,
            });
    }
    // Structural supports come after the complete road/site surfaces, so their
    // exclusion masks use real junction returns and clipped plot/parking bands.
    if (spans.some((s) => s.road.bridge)) {
        const regions = spans
            .filter((s) => s.road.bridge)
            .map((s) => {
            const x = s.frames.map((f) => f.p[0]), z = s.frames.map((f) => f.p[2]), margin = Math.max(3, ...s.frames.map((f) => Math.max(sideHalfWidth(f, -1), sideHalfWidth(f, 1)) +
                f.cw +
                f.sw +
                1.5));
            return {
                minX: Math.min(...x) - margin,
                maxX: Math.max(...x) + margin,
                minZ: Math.min(...z) - margin,
                maxZ: Math.max(...z) + margin,
                maxY: Math.max(...s.frames.map((f) => f.p[1])) - 0.28 + 0.02,
            };
        });
        for (const j of bridgeJoints.filter((j) => j.arms.some((a) => a.road.bridge))) {
            const margin = Math.max(3, ...j.arms.map((a) => Math.max(sideHalfWidth(a.frame, -1), sideHalfWidth(a.frame, 1)) +
                a.frame.cw +
                a.frame.sw +
                1.5));
            regions.push({
                minX: j.node.position[0] - margin,
                maxX: j.node.position[0] + margin,
                minZ: j.node.position[2] - margin,
                maxZ: j.node.position[2] + margin,
                maxY: j.node.position[1] -
                    Math.max(...j.arms
                        .filter((a) => a.road.bridge)
                        .map((a) => a.road.bridgeDepth)) +
                    0.02,
            });
        }
        const surfaces = new SupportSurfaceIndex(meshes, regions), allAlignments = [...alignments.values()];
        const layoutCounts = new Map();
        for (const span of spans.filter((s) => s.road.bridge)) {
            const a = Math.max(span.frames[0].s, parameterStation(span.alignment, span.road.bridgeFrom)), z = Math.min(span.frames.at(-1).s, parameterStation(span.alignment, span.road.bridgeTo)), fs = [
                frameAt(span, a),
                ...span.frames.filter((f) => f.s > a && f.s < z),
                frameAt(span, z),
            ];
            layoutCounts.set(span.road.id, Math.max(...fs.map((f) => girderOffsets(f).length)));
        }
        // Equal-width, near-straight connected decks share one girder pattern.
        // A taper upstream must not end six lines against a neighbour's five.
        const incidentByNode = new Map(), parent = new Map([...layoutCounts.keys()].map((id) => [id, id]));
        for (const span of spans)
            for (const id of [span.road.start, span.road.end]) {
                const list = incidentByNode.get(id) ?? [];
                list.push(span);
                incidentByNode.set(id, list);
            }
        const root = (id) => {
            const p = parent.get(id);
            if (p !== id)
                parent.set(id, root(p));
            return parent.get(id);
        };
        for (const node of project.nodes) {
            const incident = incidentByNode.get(node.id) ?? [];
            if (incident.length !== 2 ||
                !incident.every((s) => bridgeAt(s.road, s.road.start === node.id ? 0 : 1)))
                continue;
            const [a, z] = incident.map((s) => s.road.start === node.id ? s.frames[0] : s.frames.at(-1)), dirs = incident.map((s, i) => mul(i === 0 ? a.d : z.d, s.road.start === node.id ? 1 : -1)), w = (f) => sideHalfWidth(f, 1) + sideHalfWidth(f, -1) + 2 * (f.sw + f.cw);
            if (Math.abs(w(a) - w(z)) > 0.02 ||
                dotXZ(dirs[0], dirs[1]) > -Math.cos(Math.PI / 15))
                continue;
            parent.set(root(incident[1].road.id), root(incident[0].road.id));
        }
        const componentCount = new Map();
        for (const [id, count] of layoutCounts) {
            const key = root(id);
            componentCount.set(key, Math.max(componentCount.get(key) ?? 0, count));
        }
        for (const id of layoutCounts.keys())
            layoutCounts.set(id, componentCount.get(root(id)));
        for (const span of spans.filter((s) => s.road.bridge)) {
            const builder = new MeshBuilder(span.road.id, "road"), bridge = buildBridgeSpan(builder, span, project, allAlignments, surfaces, layoutCounts.get(span.road.id));
            meshes.push(...builder.output());
            if (bridge) {
                bridges.push(bridge);
                for (const excluded of bridge.excludedAbutments ?? []) {
                    blockedFill.add(span.road.id);
                    if (Math.abs(excluded.station - span.frames[0].s) < 1e-6 &&
                        bridgeAt(span.road, 0))
                        connected(project, span.road.start)
                            .filter((r) => r.embankment)
                            .forEach((r) => blockedFill.add(r.id));
                    if (Math.abs(excluded.station - span.frames.at(-1).s) < 1e-6 &&
                        bridgeAt(span.road, 1))
                        connected(project, span.road.end)
                            .filter((r) => r.embankment)
                            .forEach((r) => blockedFill.add(r.id));
                    structureIssue(span.road.id, "abutment", excluded.position, `${span.road.name}: ${excluded.part} overlaps a lower road, footway or paved site. Abutment and associated approach fill withheld; move the structural bounds.`);
                }
            }
        }
        const girderCounts = new Map(bridges
            .filter((b) => b.kind === "span")
            .map((b) => [b.owner, b.girderCount]));
        for (const { node, arms, bottom } of bridgeJoints) {
            const builder = new MeshBuilder(node.id, "node"), bridge = buildBridgeJoint(builder, node, arms, bottom, allAlignments, surfaces, girderCounts);
            meshes.push(...builder.output());
            if (bridge)
                bridges.push(bridge);
        }
    }
    for (const crossing of detectCrossings(project, Infinity)) {
        const a = alignments.get(crossing.a), b = alignments.get(crossing.b);
        const heightAt = (curve, t) => {
            const u = 1 - t;
            return (u * u * u * curve[0][1] +
                3 * u * u * t * curve[1][1] +
                3 * u * t * t * curve[2][1] +
                t * t * t * curve[3][1]);
        };
        const ay = heightAt(a.points, crossing.ta), by = heightAt(b.points, crossing.tb), gap = Math.abs(ay - by);
        if (gap <= 0.7) {
            diagnostics.push({
                level: "warning",
                message: "Unresolved at-grade crossing. Finish the edit or rebuild to create a shared junction.",
                owner: crossing.a,
            });
            continue;
        }
        const upper = ay > by ? a.road : b.road, upperSpan = spans.find((s) => s.road.id === upper.id), depth = bridgeAt(upper, ay > by ? crossing.ta : crossing.tb) && upperSpan
            ? bridgeDepthAt(upperSpan, stationForParameter(upperSpan, ay > by ? crossing.ta : crossing.tb), bridges)
            : 0.48, lower = ay > by ? b.road : a.road, meters = gap -
            depth -
            Math.max(SURFACE, 0.04 + (roadHalfWidth(lower) * lower.crossfall) / 100);
        clearances.push({ a: crossing.a, b: crossing.b, meters });
        if (upper.embankment &&
            !bridgeAt(upper, ay > by ? crossing.ta : crossing.tb)) {
            blockedFill.add(upper.id);
            const point = cubic(ay > by ? a.points : b.points, ay > by ? crossing.ta : crossing.tb);
            structureIssue(upper.id, "approach-fill", point, `${upper.name}: earth-supported approach crosses a lower road outside its structural interval. Fill withheld; extend the bridge or change the crossing alignment.`);
        }
        if (meters < 4.5)
            diagnostics.push({
                level: "warning",
                message: `Low overpass clearance: ${meters.toFixed(2)} m. Raise the deck to provide at least 4.5 m.`,
                owner: upper.id,
            });
    }
    const surfaceClearances = measureSurfaceClearances(meshes, new Set(bridges.map((b) => b.owner)));
    for (const c of surfaceClearances) {
        if (c.lowerKind === "motor" &&
            c.upperOwnerKind === "road" &&
            c.lowerOwnerKind === "road") {
            const previous = clearances.find((p) => (p.a === c.upper && p.b === c.lower) ||
                (p.a === c.lower && p.b === c.upper));
            if (previous)
                previous.meters = Math.min(previous.meters, c.meters);
            else
                clearances.push({ a: c.upper, b: c.lower, meters: c.meters });
        }
        if (c.meters < -0.001) {
            blockedFill.add(c.upper);
            if (c.upperOwnerKind === "node")
                connected(project, c.upper)
                    .filter((r) => r.embankment)
                    .forEach((r) => blockedFill.add(r.id));
            structureIssue(c.upper, "surface-intersection", c.undersidePosition, `Bridge structure intersects a lower ${c.lowerKind} pavement surface (${c.meters.toFixed(3)} m gap). Raise/reposition the structure before mesh export.`);
        }
        else if (c.lowerKind === "motor" &&
            c.meters < 4.5 &&
            !diagnostics.some((d) => d.owner === c.upper && d.message.startsWith("Low overpass clearance")))
            diagnostics.push({
                owner: c.upper,
                level: "warning",
                message: `Low measured pavement clearance: ${c.meters.toFixed(3)} m. Raise the deck to provide at least 4.5 m.`,
            });
    }
    // Add approach earthwork only after crossing/abutment checks. A failed
    // geometric edit must not create a wall or soil mass across lower traffic.
    for (const span of spans) {
        if (!span.road.embankment || blockedFill.has(span.road.id))
            continue;
        const b = new MeshBuilder(span.road.id, "road");
        embankments.push(...buildApproachFill(b, span));
        meshes.push(...b.output());
    }
    for (const { node, arms, bottom, retained } of bridgeJoints) {
        if (!retained || arms.some((a) => blockedFill.has(a.road.id)))
            continue;
        const b = new MeshBuilder(node.id, "node"), fill = buildRetainedJoint(b, node.id, bottom, true);
        if (fill)
            embankments.push(fill);
        meshes.push(...b.output());
    }
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const mesh of meshes)
        for (let i = 0; i < mesh.positions.length; i += 3)
            for (let k = 0; k < 3; k++) {
                min[k] = Math.min(min[k], mesh.positions[i + k]);
                max[k] = Math.max(max[k], mesh.positions[i + k]);
            }
    if (!meshes.length) {
        min.fill(-30);
        max.fill(30);
    }
    const generatedSections = measureGeneratedSections(spans), surfaceJoins = measureSurfaceJoins(spans, junctions, meshes);
    for (const join of surfaceJoins.filter((j) => !j.sealed))
        diagnostics.push({
            owner: join.owner,
            level: "error",
            message: `Pavement join has a ${join.maximumGap.toFixed(4)} m surface gap. Review its cross-section transition before mesh export.`,
        });
    return {
        generatedSections,
        surfaceJoins,
        surfaceClearances,
        designReview: reviewDesign(project, clearances, bridges, splitters, structureIssues, { generatedSections, surfaceJoins, surfaceClearances }),
        embankments,
        auxiliaryLanes,
        detail,
        footways,
        plantings,
        blocks,
        mobility,
        bridges,
        streetDetails,
        roadsideParking,
        splitters,
        barriers: [
            ...spans
                .filter((s) => s.road.guardrails)
                .map((s) => ({
                owner: s.road.id,
                ownerKind: "road",
                style: s.road.railStyle,
                length: s.length,
                height: s.road.railHeight,
                postSpacing: s.road.postSpacing,
                sides: 2,
                physicalGeometry: true,
            })),
            ...junctions.flatMap((j) => j.arms.flatMap((a, i) => {
                const z = j.arms[(i + 1) % j.arms.length], points = j.pavedCorners[i];
                if (!a.road.guardrails || !z.road.guardrails)
                    return [];
                return [
                    {
                        owner: j.node.id,
                        ownerKind: "node",
                        style: a.road.railStyle,
                        ...(a.road.railStyle !== z.road.railStyle
                            ? { transitionTo: z.road.railStyle }
                            : {}),
                        length: points
                            .slice(1)
                            .reduce((s, p, i) => s + distance(p, points[i]), 0),
                        height: (a.road.railHeight + z.road.railHeight) / 2,
                        postSpacing: (a.road.postSpacing + z.road.postSpacing) / 2,
                        sides: 1,
                        physicalGeometry: true,
                    },
                ];
            })),
        ],
        spans,
        junctions,
        meshes,
        diagnostics,
        length,
        inlets: services
            .filter((s) => s.kind === "curb-inlet")
            .reduce((n, s) => n + (s.ports ?? 1), 0),
        maxGrade,
        clearances,
        services,
        manholes: services.filter((s) => s.kind === "manhole").length,
        parkingSpaces: roadsideParking.length +
            (project.sites ?? [])
                .filter((s) => s.kind === "parking")
                .reduce((sum, s) => sum + parkingLayout(s).length, 0),
        bounds: { min, max },
        triangles: meshes.reduce((s, m) => s + m.indices.length / 3, 0),
        vertices: meshes.reduce((s, m) => s + m.positions.length / 3, 0),
    };
}
