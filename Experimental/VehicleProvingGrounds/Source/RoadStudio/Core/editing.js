import { add, sub, cubic, derivative, distanceXZ, segmentIntersection, splitCubic, clamp, } from "./math.js";
import { makeNode, makeRoad, controlPoints, getNode, uid, } from "./model.js";
import { sampleAlignment, closestOnAlignment } from "./curves.js";
/** XZ crossings are refined on the actual cubics and then gated by elevation. */
export function detectCrossings(project, heightTolerance = 0.7) {
    const alignments = project.roads.map((r) => sampleAlignment(project, r));
    const cells = new Map();
    const result = [], checked = new Set();
    for (const a of alignments)
        for (let i = 1; i < a.stations.length; i++) {
            const p = a.stations[i - 1], q = a.stations[i];
            const x0 = Math.floor(Math.min(p.p[0], q.p[0]) / 20), x1 = Math.floor(Math.max(p.p[0], q.p[0]) / 20);
            const z0 = Math.floor(Math.min(p.p[2], q.p[2]) / 20), z1 = Math.floor(Math.max(p.p[2], q.p[2]) / 20);
            for (let x = x0; x <= x1; x++)
                for (let z = z0; z <= z1; z++) {
                    const key = `${x},${z}`, bucket = cells.get(key) ?? [];
                    for (const entry of bucket) {
                        if (entry.a.road.id === a.road.id)
                            continue;
                        const checkKey = `${a.road.id}:${i}:${entry.a.road.id}:${entry.index}`;
                        if (checked.has(checkKey))
                            continue;
                        checked.add(checkKey);
                        const b = entry.a, bp = b.stations[entry.index - 1], bq = b.stations[entry.index];
                        const hit = segmentIntersection(p.p, q.p, bp.p, bq.p);
                        if (!hit)
                            continue;
                        let ta = p.t + (q.t - p.t) * hit[0], tb = bp.t + (bq.t - bp.t) * hit[1];
                        for (let k = 0; k < 10; k++) {
                            const pa = cubic(a.points, ta), pb = cubic(b.points, tb), da = derivative(a.points, ta), db = derivative(b.points, tb);
                            const det = da[2] * db[0] - da[0] * db[2];
                            if (Math.abs(det) < 1e-10)
                                break;
                            const dx = pb[0] - pa[0], dz = pb[2] - pa[2];
                            ta = clamp(ta + (-db[2] * dx + db[0] * dz) / det, 0, 1);
                            tb = clamp(tb + (-da[2] * dx + da[0] * dz) / det, 0, 1);
                        }
                        const pa = cubic(a.points, ta), pb = cubic(b.points, tb);
                        if (Math.abs(pa[1] - pb[1]) > heightTolerance ||
                            distanceXZ(pa, pb) > 0.01)
                            continue;
                        // Shared endpoints are already topological connections, not new crossings.
                        const aNode = ta < 1e-5 ? a.road.start : ta > 1 - 1e-5 ? a.road.end : null;
                        const bNode = tb < 1e-5 ? b.road.start : tb > 1 - 1e-5 ? b.road.end : null;
                        if (aNode && bNode && aNode === bNode)
                            continue;
                        const point = [
                            (pa[0] + pb[0]) / 2,
                            (pa[1] + pb[1]) / 2,
                            (pa[2] + pb[2]) / 2,
                        ];
                        if (!result.some((r) => ((r.a === a.road.id && r.b === b.road.id) ||
                            (r.b === a.road.id && r.a === b.road.id)) &&
                            distanceXZ(r.point, point) < 0.1))
                            result.push({ a: a.road.id, b: b.road.id, ta, tb, point });
                    }
                    bucket.push({ a, index: i });
                    cells.set(key, bucket);
                }
        }
    return result;
}
function pieces(road, curve, cuts) {
    const sorted = cuts
        .filter((c) => c.t > 1e-5 && c.t < 1 - 1e-5)
        .sort((a, b) => a.t - b.t)
        .filter((c, i, a) => !i || c.t - a[i - 1].t > 1e-5);
    const out = [];
    let start = road.start, rest = curve, previous = 0;
    for (let i = 0; i <= sorted.length; i++) {
        const cut = sorted[i];
        const [segment, remainder] = cut
            ? splitCubic(rest, (cut.t - previous) / (1 - previous))
            : [rest, rest];
        const end = cut ? cut.node.id : road.end;
        const endpoint = cut ? cut.node.position : curve[3];
        out.push({
            ...road,
            id: i ? uid("road") : road.id,
            name: i
                ? `${road.name.split(" · Segment")[0]} · Segment ${i + 1}`
                : road.name,
            start,
            end,
            driveways: road.driveways
                .filter((d) => d.at >= previous && (cut ? d.at < cut.t : d.at <= 1))
                .map((d) => ({
                ...d,
                at: (d.at - previous) / ((cut?.t ?? 1) - previous),
            })),
            h1: sub(segment[1], segment[0]),
            h2: sub(segment[2], endpoint),
        });
        if (cut) {
            rest = remainder;
            rest[0] = cut.node.position;
            start = cut.node.id;
            previous = cut.t;
        }
    }
    return out;
}
export function splitRoad(project, roadId, t) {
    const road = project.roads.find((r) => r.id === roadId);
    if (t < 0.005)
        return getNode(project, road.start);
    if (t > 0.995)
        return getNode(project, road.end);
    const curve = controlPoints(project, road), node = makeNode(cubic(curve, t), `Junction ${String(project.nodes.filter((n) => project.roads.filter((r) => r.start === n.id || r.end === n.id).length >= 3).length + 1).padStart(2, "0")}`);
    project.nodes.push(node);
    project.roads.splice(project.roads.indexOf(road), 1, ...pieces(road, curve, [{ t, node }]));
    return node;
}
export function resolveCrossings(project) {
    const crossings = detectCrossings(project);
    if (!crossings.length)
        return 0;
    const cuts = new Map();
    const curves = new Map(project.roads.map((r) => [r.id, controlPoints(project, r)]));
    let count = 0;
    for (const crossing of crossings) {
        let node = project.nodes.find((n) => distanceXZ(n.position, crossing.point) < 0.16 &&
            Math.abs(n.position[1] - crossing.point[1]) < 0.7);
        if (!node) {
            node = makeNode(crossing.point, `Junction ${String(++count + project.nodes.filter((n) => n.name.startsWith("Junction")).length).padStart(2, "0")}`);
            project.nodes.push(node);
        }
        for (const [id, t] of [
            [crossing.a, crossing.ta],
            [crossing.b, crossing.tb],
        ]) {
            const road = project.roads.find((r) => r.id === id);
            if (t < 1e-5)
                road.start = node.id;
            else if (t > 1 - 1e-5)
                road.end = node.id;
            else {
                const list = cuts.get(id) ?? [];
                list.push({ t, node });
                cuts.set(id, list);
            }
        }
    }
    project.roads = project.roads.flatMap((road) => cuts.has(road.id)
        ? pieces(road, curves.get(road.id), cuts.get(road.id))
        : [road]);
    project.nodes = project.nodes.filter((n) => project.roads.some((r) => r.start === n.id || r.end === n.id));
    return crossings.length;
}
export function findSnap(project, point, tolerance, ignoreNode) {
    let node, distance = tolerance;
    for (const n of project.nodes) {
        const d = distanceXZ(n.position, point);
        if (n.id !== ignoreNode &&
            d < distance &&
            Math.abs(point[1] - n.position[1]) < 1) {
            node = n;
            distance = d;
        }
    }
    if (node)
        return {
            position: [...node.position],
            nodeId: node.id,
            roadId: undefined,
            t: 0,
        };
    let roadHit = null;
    for (const road of project.roads) {
        const near = closestOnAlignment(sampleAlignment(project, road), point);
        if (near.distance < distance && Math.abs(point[1] - near.point[1]) < 1) {
            distance = near.distance;
            roadHit = {
                position: near.point,
                roadId: road.id,
                nodeId: undefined,
                t: near.t,
            };
        }
    }
    return roadHit;
}
export function insertRoad(project, from, to, settings = {}) {
    const before = JSON.parse(JSON.stringify({ nodes: project.nodes, roads: project.roads }));
    const nodeAt = (position) => {
        const snap = findSnap(project, position, 1.25);
        if (snap?.nodeId)
            return getNode(project, snap.nodeId);
        if (snap?.roadId)
            return splitRoad(project, snap.roadId, snap.t);
        const n = makeNode(position);
        project.nodes.push(n);
        return n;
    };
    const a = nodeAt(from), b = nodeAt(to);
    if (a.id === b.id || distanceXZ(a.position, b.position) < 2) {
        project.nodes = before.nodes;
        project.roads = before.roads;
        return null;
    }
    const road = makeRoad(a, b, `Road ${String(project.roads.length + 1).padStart(2, "0")}`, settings);
    project.roads.push(road);
    resolveCrossings(project);
    return road.id;
}
export function moveNode(project, id, position) {
    const node = getNode(project, id);
    if (node)
        node.position = [...position];
}
export function translateRoad(project, id, delta) {
    const road = project.roads.find((r) => r.id === id);
    if (!road)
        return;
    for (const nodeId of [road.start, road.end]) {
        const node = getNode(project, nodeId);
        node.position = add(node.position, delta);
    }
}
export function deleteSelection(project, kind, id) {
    if (kind === "site") {
        project.sites = project.sites?.filter((s) => s.id !== id);
        return;
    }
    project.roads = project.roads.filter((r) => kind === "road" ? r.id !== id : r.start !== id && r.end !== id);
    project.nodes = project.nodes.filter((n) => project.roads.some((r) => r.start === n.id || r.end === n.id));
}
