import { sideHalfWidth, surfacePoint, edgePoint } from "./geometry.js";
import { clipConvex2 } from "./polygons.js";
import { distance } from "./math.js";
const canonical = (n) => (n === 0 ? 0 : n);
const vector = (p) => p.map(canonical);
export function measureGeneratedSections(spans) {
    return spans.map((s) => {
        const scale = s.frames.map((f) => f.profileScale ?? 1), minimum = Math.min(...scale), frame = s.frames[scale.indexOf(minimum)], range = (fn) => {
            const values = s.frames.map(fn);
            return [Math.min(...values), Math.max(...values)];
        };
        return {
            owner: s.road.id,
            requestedLaneWidth: s.road.laneWidth,
            minimumLaneWidth: s.road.laneWidth * minimum,
            minimumProfileScale: minimum,
            minimumWidthStation: frame.s,
            minimumWidthParameter: frame.t,
            leftAsphaltRange: range((f) => sideHalfWidth(f, -1)),
            rightAsphaltRange: range((f) => sideHalfWidth(f, 1)),
            sidewalkRange: range((f) => f.sw),
            method: "generated-cross-sections",
        };
    });
}
const sectionPoints = (f) => [
    surfacePoint(f, 0),
    edgePoint(f, -1, "road"),
    edgePoint(f, 1, "road"),
    ...(f.sw > 1e-7 ? [edgePoint(f, -1, "outer"), edgePoint(f, 1, "outer")] : []),
];
/** Driving/footway mouths are checked against the actual top-sheet vertices.
 * Direct joins also compare opposite side order, since road directions can flip.
 */
export function measureSurfaceJoins(spans, junctions, meshes, tolerance = 0.001) {
    const incident = new Map();
    for (const s of spans)
        for (const node of [s.road.start, s.road.end]) {
            const list = incident.get(node) ?? [];
            list.push(s);
            incident.set(node, list);
        }
    const junctionMap = new Map(junctions.map((j) => [j.node.id, j]));
    const out = [];
    for (const [owner, list] of incident) {
        if (list.length < 2)
            continue;
        const frames = list.map((s) => s.road.start === owner ? s.frames[0] : s.frames.at(-1)), j = junctionMap.get(owner);
        let maximumGap = 0, comparedPoints = 0;
        if (j) {
            const points = [], hash = new Map(), key = (p) => p.map((v) => Math.round(v * 1e6)).join(":");
            for (const m of meshes.filter((m) => m.owner === owner &&
                ["asphalt", "paving", "cycle", "bus"].includes(m.kind)))
                for (let i = 0; i < m.indices.length; i += 3) {
                    const tri = triangle(m, i);
                    if (!tri || tri.area >= 0)
                        continue;
                    for (const p of tri.points) {
                        points.push(p);
                        const k = key(p), bucket = hash.get(k) ?? [];
                        bucket.push(p);
                        hash.set(k, bucket);
                    }
                }
            for (const f of frames)
                for (const p of sectionPoints(f)) {
                    const bucket = hash.get(key(p));
                    const gap = bucket?.length
                        ? Math.min(...bucket.map((q) => distance(p, q)))
                        : points.reduce((min, q) => Math.min(min, distance(p, q)), Infinity);
                    maximumGap = Math.max(maximumGap, gap);
                    comparedPoints++;
                }
        }
        else if (frames.length === 2) {
            const [a, b] = frames.map(sectionPoints), comparisons = [
                b,
                [b[0], b[2], b[1], ...(b.length > 3 ? [b[4], b[3]] : [])],
            ];
            maximumGap = Math.min(...comparisons.map((q) => Math.max(...a.map((p, i) => (q[i] ? distance(p, q[i]) : 1e6)))));
            comparedPoints = a.length;
        }
        else
            continue;
        out.push({
            owner,
            roads: list.map((s) => s.road.id),
            transition: j ? "junction" : "direct",
            maximumGap: Number.isFinite(maximumGap) ? canonical(maximumGap) : 1e6,
            comparedPoints,
            sealed: maximumGap <= tolerance,
            tolerance,
        });
    }
    return out;
}
function triangle(mesh, i) {
    const points = mesh.indices
        .slice(i, i + 3)
        .map((index) => mesh.positions.slice(index * 3, index * 3 + 3)), [a, b, c] = points, ux = b[0] - a[0], uz = b[2] - a[2], vx = c[0] - a[0], vz = c[2] - a[2], area = ux * vz - uz * vx;
    if (Math.abs(area) < 1e-9)
        return;
    return {
        mesh,
        points,
        area,
        outline: points.map((p) => [p[0], p[2]]),
        minX: Math.min(a[0], b[0], c[0]),
        maxX: Math.max(a[0], b[0], c[0]),
        minZ: Math.min(a[2], b[2], c[2]),
        maxZ: Math.max(a[2], b[2], c[2]),
        origin: a,
        gx: ((b[1] - a[1]) * vz - (c[1] - a[1]) * uz) / area,
        gz: (ux * (c[1] - a[1]) - vx * (b[1] - a[1])) / area,
    };
}
const height = (t, p) => t.origin[1] + t.gx * (p[0] - t.origin[0]) + t.gz * (p[1] - t.origin[2]);
function contains(t, p) {
    const sign = Math.sign(t.area);
    return t.outline.every((a, i) => {
        const b = t.outline[(i + 1) % 3];
        return (sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >=
            -1e-7);
    });
}
function lowerKind(m) {
    if (["paint", "yellow"].includes(m.material) ||
        m.material.startsWith("marking-"))
        return;
    if (["asphalt", "bus", "parking"].includes(m.kind))
        return "motor";
    if (m.kind === "cycle" && m.material !== "curb")
        return "cycle";
    if (m.kind === "paving")
        return "pedestrian";
}
class SurfaceIndex {
    cells = new Map();
    roofs = new Map();
    cellSize = 16;
    *keys(b) {
        for (let x = Math.floor(b.minX / this.cellSize); x <= Math.floor(b.maxX / this.cellSize); x++)
            for (let z = Math.floor(b.minZ / this.cellSize); z <= Math.floor(b.maxZ / this.cellSize); z++)
                yield `${x}:${z}`;
    }
    constructor(meshes) {
        for (const m of meshes) {
            const kind = lowerKind(m);
            if (!kind)
                continue;
            let roofs = this.roofs.get(m.owner);
            if (!roofs) {
                roofs = new Map();
                this.roofs.set(m.owner, roofs);
            }
            for (let i = 0; i < m.indices.length; i += 3) {
                const t = triangle(m, i);
                if (!t || t.area >= 0)
                    continue;
                t.lowerKind = kind;
                for (const key of this.keys(t)) {
                    const cell = this.cells.get(key) ?? [];
                    cell.push(t);
                    this.cells.set(key, cell);
                    const roof = roofs.get(key) ?? [];
                    roof.push(t);
                    roofs.set(key, roof);
                }
            }
        }
    }
    *query(t) {
        const visited = new Set();
        for (const key of this.keys(t))
            for (const p of this.cells.get(key) ?? []) {
                if (visited.has(p))
                    continue;
                visited.add(p);
                if (p.maxX < t.minX ||
                    p.minX > t.maxX ||
                    p.maxZ < t.minZ ||
                    p.minZ > t.maxZ)
                    continue;
                yield p;
            }
    }
    roof(owner, p) {
        const key = `${Math.floor(p[0] / this.cellSize)}:${Math.floor(p[1] / this.cellSize)}`;
        let y = -Infinity;
        for (const t of this.roofs.get(owner)?.get(key) ?? [])
            if (contains(t, p))
                y = Math.max(y, height(t, p));
        return Number.isFinite(y) ? y : undefined;
    }
}
/** Exact projected overlap of the generated triangular sheets. Clearance is
 * affine on each overlap polygon, so its minimum occurs at an overlap vertex.
 * The owner's real pavement roof distinguishes lower traffic from its own
 * connected surface. Vertical separation and positive-area overlap are required.
 */
export function measureSurfaceClearances(meshes, bridgeOwners) {
    if (!bridgeOwners.size)
        return [];
    const index = new SurfaceIndex(meshes), records = new Map();
    for (const m of meshes) {
        if (!bridgeOwners.has(m.owner) ||
            m.kind !== "structure" ||
            m.material === "soil")
            continue;
        for (let i = 0; i < m.indices.length; i += 3) {
            const underside = triangle(m, i);
            if (!underside || underside.area <= 0)
                continue;
            for (const lower of index.query(underside)) {
                if (lower.mesh.owner === m.owner)
                    continue;
                const overlap = clipConvex2(lower.outline, underside.outline);
                if (!overlap.length)
                    continue;
                const key = `${m.owner}\u0000${lower.mesh.owner}\u0000${lower.lowerKind}`;
                for (const p of overlap) {
                    const lowerY = height(lower, p), roof = index.roof(m.owner, p);
                    if (roof === undefined || roof - lowerY <= 0.7)
                        continue;
                    const y = height(underside, p), gap = y - lowerY, previous = records.get(key);
                    if (previous && previous.meters <= gap)
                        continue;
                    records.set(key, {
                        upper: m.owner,
                        lower: lower.mesh.owner,
                        upperOwnerKind: m.ownerKind,
                        lowerOwnerKind: lower.mesh.ownerKind,
                        lowerKind: lower.lowerKind,
                        meters: canonical(gap),
                        lowerPosition: vector([p[0], lowerY, p[1]]),
                        undersidePosition: vector([p[0], y, p[1]]),
                        upperSurfaceHeight: canonical(roof),
                        undersideMaterial: m.material,
                        method: "triangulated-surface-overlap",
                    });
                }
            }
        }
    }
    return [...records.values()];
}
