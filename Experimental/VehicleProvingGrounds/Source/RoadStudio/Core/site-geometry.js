import { buildPlanningSite } from "./planning-sites.js";
import { buildPlantingPit } from "./planting.js";
import { addManhole, addGratedInlet } from "./utilities.js";
import { centroid2, clipConvex2, rect2, inside2, overlap2, axisBoundary2, bounds2, } from "./polygons.js";
import { MeshBuilder } from "./geometry.js";
import { siteOutline, sitePoint } from "./sites.js";
import { add, sub, lerp, normalizeXZ, distanceXZ, } from "./math.js";
export function parkingFootprint(site, inset = 0) {
    return siteOutline({ ...site, position: [0, 0, 0], yaw: 0 }, inset).map((p) => [p[0], p[2]]);
}
export function parkingEntry(site) {
    const footprint = parkingFootprint(site), center = centroid2(footprint), ns = site.entrance === "north" || site.entrance === "south", axis = ns ? 1 : 0, sign = site.entrance === "south" || site.entrance === "east" ? 1 : -1, tangent = ns ? center[0] : center[1], hit = axisBoundary2(footprint, tangent, axis, sign > 0);
    const anchor = ns ? [tangent, hit ?? 0] : [hit ?? 0, tangent];
    return { center: anchor, axis, sign, width: site.entryWidth };
}
/** Metric modules are clipped and joined to an actual entry corridor before allocating bays. */
export function parkingPlan(site) {
    const angle = (site.parkingAngle * Math.PI) / 180, sin = Math.sin(angle), cos = Math.cos(angle), rim = site.perimeterWidth + 0.22, coreW = site.width - 2 * rim, coreD = site.depth - 2 * rim, rowDepth = site.bayDepth * sin +
        Math.max(site.bayWidth, site.accessible ? Math.max(3.6, site.bayWidth + 1) : 0) *
            cos, aisle = site.aisleWidth, moduleDepth = rowDepth * 2 + aisle, pairs = site.parkingLayout === "single"
        ? 0
        : Math.max(0, Math.floor(coreD / moduleDepth)), count = site.parkingLayout === "double" ? Math.min(1, pairs) : pairs, single = site.parkingLayout === "single" && coreD >= rowDepth + aisle, footprint = parkingFootprint(site, rim), outer = parkingFootprint(site), bays = [], warnings = [], entryBase = parkingEntry(site), ns = entryBase.axis === 1, e = site.entryWidth;
    const sx = ns
        ? entryBase.center[0]
        : entryBase.center[0] - entryBase.sign * (rim + e / 2), spine = {
        x: sx,
        z: 0,
        width: e,
        depth: Math.max(0, coreD),
        polygon: clipConvex2(rect2(sx, 0, e, Math.max(0, coreD)), footprint),
    };
    const apronRect = ns
        ? rect2(sx, entryBase.center[1] - (entryBase.sign * (rim + e / 2)) / 2, e, rim + e / 2 + 0.05)
        : rect2(entryBase.center[0] - (entryBase.sign * (rim + e)) / 2, entryBase.center[1], rim + e + 0.05, e);
    const entry = { ...entryBase, apron: clipConvex2(apronRect, outer) };
    const aisles = [], specs = [];
    const makeAisle = (z) => {
        aisles.push({
            z,
            width: aisle,
            polygon: clipConvex2(rect2(0, z, Math.max(0, coreW), aisle), footprint),
            connected: false,
        });
        return aisles.length - 1;
    };
    if (single) {
        const z = -coreD / 2 + rowDepth / 2, index = makeAisle(z + rowDepth / 2 + aisle / 2);
        specs.push({ z, side: -1, row: 0, aisle: index });
    }
    else
        for (let i = 0; i < count; i++) {
            const z = (i - (count - 1) / 2) * moduleDepth, index = makeAisle(z);
            specs.push({ z: z - aisle / 2 - rowDepth / 2, side: -1, row: i * 2, aisle: index }, {
                z: z + aisle / 2 + rowDepth / 2,
                side: 1,
                row: i * 2 + 1,
                aisle: index,
            });
        }
    if (!specs.length)
        warnings.push("Footprint is too shallow for the selected bay and aisle dimensions.");
    const reachesEntry = overlap2(spine.polygon, entry.apron);
    for (const a of aisles)
        a.connected = reachesEntry && overlap2(a.polygon, spine.polygon);
    let isolated = 0;
    for (const spec of specs)
        if (!aisles[spec.aisle].connected)
            isolated++;
    if (isolated)
        warnings.push(`${isolated} proposed rows are outside the entry-connected circulation; they are excluded.`);
    if (!reachesEntry && specs.length)
        warnings.push("The entry does not reach a driveable spine within this footprint. Choose another side or widen the footprint.");
    let accessibleLeft = site.accessible;
    const priority = site.entrance === "south" ? [...specs].reverse() : specs, occupied = new Map();
    const cells = (p) => {
        const b = bounds2(p), keys = [];
        for (let x = Math.floor(b.minX / 6); x <= Math.floor(b.maxX / 6); x++)
            for (let z = Math.floor(b.minZ / 6); z <= Math.floor(b.maxZ / 6); z++)
                keys.push(`${x}:${z}`);
        return keys;
    };
    const collisions = (p) => {
        const candidates = new Set(cells(p).flatMap((key) => occupied.get(key) ?? []));
        return [...candidates].some((o) => overlap2(p, o));
    };
    const remember = (p) => {
        for (const key of cells(p)) {
            if (!occupied.has(key))
                occupied.set(key, []);
            occupied.get(key).push(p);
        }
    };
    const circulation = [
        spine.polygon,
        ...aisles.filter((a) => a.connected).map((a) => a.polygon),
    ];
    for (const spec of priority) {
        if (!aisles[spec.aisle].connected)
            continue;
        const minX = site.entrance === "west" ? spine.x + e / 2 : -coreW / 2, maxX = site.entrance === "east" ? spine.x - e / 2 : coreW / 2, segments = ns
            ? [
                [minX, spine.x - e / 2 - 0.15],
                [spine.x + e / 2 + 0.15, maxX],
            ]
            : [[minX, maxX]], rowCandidates = [];
        for (const [lo, hi] of segments) {
            let cursor = lo + 0.32 + (site.bayDepth * cos) / 2, used = 0;
            while (cursor < hi && used < 90) {
                let accessible = accessibleLeft > 0;
                if (accessible &&
                    hi - cursor <
                        Math.max(3.6, site.bayWidth + 1) / sin + 1.25 / sin + 0.32)
                    accessible = false;
                const width = accessible
                    ? Math.max(3.6, site.bayWidth + 1)
                    : site.bayWidth, pitch = width / sin, x = cursor + pitch / 2, depth = site.bayDepth, side = spec.side, forward = [cos * side, sin * side], right = [sin, -cos];
                const rect = (offset, w) => [
                    [-1, -1],
                    [1, -1],
                    [1, 1],
                    [-1, 1],
                ].map(([a, b]) => [
                    x +
                        right[0] * (offset + (a * w) / 2) +
                        (forward[0] * b * depth) / 2,
                    spec.z +
                        right[1] * (offset + (a * w) / 2) +
                        (forward[1] * b * depth) / 2,
                ]);
                const corners = rect(0, width), transferCorners = accessible
                    ? rect(width / 2 + 0.625, 1.25)
                    : undefined;
                cursor += pitch;
                used++;
                if (site.bays > 0 && rowCandidates.length >= site.bays)
                    break;
                const xMin = Math.min(...corners.map((p) => p[0])), xMax = Math.max(...corners.map((p) => p[0])), transfer = accessible ? 1.25 / sin : 0;
                if (xMax > hi - 0.12 ||
                    xMin < lo + 0.05 ||
                    (transfer && xMax + transfer > hi - 0.05))
                    continue;
                const shapes = transferCorners ? [corners, transferCorners] : [corners];
                if (shapes.some((p) => !p.every((v) => inside2(footprint, v)) ||
                    circulation.some((c) => overlap2(p, c)) ||
                    collisions(p)))
                    continue;
                rowCandidates.push({
                    x,
                    z: spec.z,
                    width,
                    depth,
                    side,
                    angle: site.parkingAngle,
                    row: spec.row,
                    accessible,
                    number: 0,
                    corners,
                    aisle: accessible ? xMax + transfer / 2 : undefined,
                    transferCorners,
                });
                shapes.forEach(remember);
                if (accessible) {
                    accessibleLeft--;
                    cursor += transfer;
                }
            }
        }
        bays.push(...rowCandidates);
    }
    bays
        .sort((a, b) => a.row - b.row || a.x - b.x)
        .forEach((b, i) => (b.number = i + 1));
    if (accessibleLeft > 0)
        warnings.push(`${accessibleLeft} requested accessible spaces do not fit the current footprint.`);
    const islands = [], visible = [], rowCounts = new Map();
    for (const bay of bays) {
        const n = (rowCounts.get(bay.row) ?? 0) + 1;
        rowCounts.set(bay.row, n);
        if (site.parkingIslands && !bay.accessible && n % site.islandEvery === 0)
            islands.push(bay);
        else
            visible.push(bay);
    }
    let ev = site.evBays;
    visible.forEach((bay, i) => {
        bay.number = i + 1;
        if (!bay.accessible && ev > 0) {
            bay.ev = true;
            ev--;
        }
    });
    if (ev > 0)
        warnings.push("Not enough normal spaces for the requested EV reservation.");
    return {
        bays: visible,
        islands,
        rows: specs.filter((s) => aisles[s.aisle].connected).length,
        aisles,
        spine,
        entry,
        rowDepth,
        warnings,
    };
}
export const parkingLayout = (site) => parkingPlan(site).bays;
function localPoint(site, p) {
    const q = sub(p, site.position), a = (-site.yaw * Math.PI) / 180;
    return [
        q[0] * Math.cos(a) - q[2] * Math.sin(a),
        q[0] * Math.sin(a) + q[2] * Math.cos(a),
    ];
}
function entryFace(site, a, z) {
    const p = localPoint(site, a), q = localPoint(site, z), entry = parkingEntry(site), outward = [q[1] - p[1], p[0] - q[0]];
    return outward[entry.axis] * entry.sign > 1e-8;
}
function openEntry(site, p) {
    const entry = parkingEntry(site), q = localPoint(site, p), tangent = entry.axis === 0 ? 1 : 0;
    return Math.abs(q[tangent] - entry.center[tangent]) < entry.width / 2 + 1e-8;
}
function entryCuts(site, a, z) {
    const entry = parkingEntry(site), tangent = entry.axis === 0 ? 1 : 0, p = localPoint(site, a), q = localPoint(site, z), cuts = [0, 1], delta = q[tangent] - p[tangent];
    if (Math.abs(delta) > 1e-9)
        for (const sign of [-1, 1]) {
            const t = (entry.center[tangent] + (sign * entry.width) / 2 - p[tangent]) / delta;
            if (t > 1e-9 && t < 1 - 1e-9)
                cuts.push(t);
        }
    return cuts.sort((a, b) => a - b);
}
function paintLine(b, site, a, z, width = 0.095, material = "paint") {
    const d = normalizeXZ([z[0] - a[0], 0, z[1] - a[1]]), n = [(-d[2] * width) / 2, (d[0] * width) / 2], quad = [
        [a[0] - n[0], a[1] - n[1]],
        [a[0] + n[0], a[1] + n[1]],
        [z[0] + n[0], z[1] + n[1]],
        [z[0] - n[0], z[1] - n[1]],
    ], polygon = clipConvex2(quad, parkingFootprint(site, site.perimeterWidth + 0.22));
    const key = material === "paint"
        ? `paint-wear-${Math.round(site.paintWear * 20) * 5}`
        : material;
    if (polygon.length >= 3)
        b.polygon("marking", key, polygon.map((p) => sitePoint(site, p[0], p[1], 0.124)), undefined, true);
}
function groundDecal(b, site, x, z, w, d, material) {
    const m = b.target("marking", material), start = m.uvs.length;
    b.quad("marking", material, [
        sitePoint(site, x - w / 2, z - d / 2, 0.125),
        sitePoint(site, x + w / 2, z - d / 2, 0.125),
        sitePoint(site, x + w / 2, z + d / 2, 0.125),
        sitePoint(site, x - w / 2, z + d / 2, 0.125),
    ], true);
    [0, 0, 1, 0, 1, 1, 0, 1].forEach((v, i) => (m.uvs[start + i] = v));
}
/** No environment dressing is generated. Legacy architecture/water is excluded. */
export function buildSiteGeometry(site, services = [], plantings = [], blocks = []) {
    if (site.kind === "urban-block" || site.kind === "tree-pit")
        return buildPlanningSite(site, plantings, blocks);
    if (site.kind === "block" || site.kind === "water")
        return [];
    const b = new MeshBuilder(site.id, "site"), outline = siteOutline(site), close = (row) => [...row, row[0]];
    const parking = site.kind === "parking" ? parkingPlan(site) : undefined, 
    // Cut the soil opening, not the entire bay cell. Back-to-back cells may
    // touch; disjoint inset openings keep earcut from bridging over a hole.
    holes = (parking?.islands ?? []).map((slot) => {
        const a = (slot.angle * Math.PI) / 180, forward = [Math.cos(a) * slot.side, Math.sin(a) * slot.side], right = [Math.sin(a), -Math.cos(a)];
        return [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
        ].map(([v, u]) => sitePoint(site, slot.x +
            (right[0] * v * (slot.width - 0.24)) / 2 +
            (forward[0] * u * (slot.depth - 0.24)) / 2, slot.z +
            (right[1] * v * (slot.width - 0.24)) / 2 +
            (forward[1] * u * (slot.depth - 0.24)) / 2, 0.12));
    });
    b.faceWithHoles(site.kind === "parking" ? "parking" : "paving", site.kind === "parking" ? "asphalt" : `paving-${site.pattern}`, outline, holes);
    const bottom = outline.map((p) => add(p, [0, -0.3, 0]));
    b.strip("structure", "road-base", close(outline), close(bottom));
    b.polygon("structure", "road-base", bottom, undefined, false);
    const inner = siteOutline(site, site.kind === "parking" ? site.perimeterWidth : 0.18, 0.121), outer = siteOutline(site, 0.02, 0.121);
    b.strip("paving", `paving-${site.pattern}`, close(outer), close(inner), true);
    const curbRows = [
        siteOutline(site, 0, 0.12),
        siteOutline(site, 0, 0.252),
        siteOutline(site, 0.016, 0.268),
        siteOutline(site, 0.184, 0.268),
        siteOutline(site, 0.2, 0.252),
        siteOutline(site, 0.2, 0.121),
    ];
    for (let i = 0; i < outline.length; i++) {
        const k = (i + 1) % outline.length, cuts = site.kind === "parking"
            ? entryCuts(site, outline[i], outline[k])
            : [0, 1], faces = site.kind === "parking" && entryFace(site, outline[i], outline[k]);
        const cap = (t) => {
            const points = curbRows.map((row) => lerp(row[i], row[k], t));
            b.append("curb", "curb", points, [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5]);
        };
        for (let interval = 0; interval < cuts.length - 1; interval++) {
            const start = cuts[interval], end = cuts[interval + 1], mid = lerp(outline[i], outline[k], (start + end) / 2);
            if (faces && openEntry(site, mid))
                continue;
            const steps = Math.max(1, Math.ceil((distanceXZ(outline[i], outline[k]) * (end - start)) / 1.2));
            for (let part = 0; part < steps; part++) {
                const t = start + ((end - start) * part) / steps, u = start + ((end - start) * (part + 1)) / steps;
                for (let row = 0; row < curbRows.length - 1; row++) {
                    const a = curbRows[row], z = curbRows[row + 1];
                    b.quad("curb", "curb", [
                        lerp(a[i], a[k], t),
                        lerp(a[i], a[k], u),
                        lerp(z[i], z[k], u),
                        lerp(z[i], z[k], t),
                    ], row > 0 && row < 4);
                }
            }
            if (faces) {
                if (start > 1e-8)
                    cap(start);
                if (end < 1 - 1e-8)
                    cap(end);
            }
        }
    }
    if (site.kind === "parking") {
        const plan = parking;
        if (plan.entry.apron.length >= 3)
            b.polygon("parking", "asphalt", plan.entry.apron.map((p) => sitePoint(site, p[0], p[1], 0.122)), undefined, true);
        for (const island of plan.islands) {
            const a = (island.angle * Math.PI) / 180, forward = [Math.cos(a) * island.side, Math.sin(a) * island.side], right = [Math.sin(a), -Math.cos(a)];
            const sample = (u, v, h) => sitePoint(site, island.x + forward[0] * u + right[0] * v, island.z + forward[1] * u + right[1] * v, 0.12 + h);
            buildPlantingPit(b, sample, island.width, island.depth, false, 0.1);
            plantings.push({
                id: `${site.id}:island:${island.row}:${island.x.toFixed(3)}`,
                owner: site.id,
                ownerKind: "site",
                kind: "parking-island",
                position: sample(0, 0, 0),
                width: island.width,
                length: island.depth,
                grate: false,
                containsTree: false,
            });
        }
        for (const slot of plan.bays) {
            const [a, z, c, d] = slot.corners;
            if (site.bayFinish !== "asphalt")
                b.polygon("parking", site.bayFinish === "permeable" ? "paving-permeable" : "concrete", slot.corners.map(([x, z]) => sitePoint(site, x, z, 0.122)), undefined, true);
            if (slot.ev)
                groundDecal(b, site, slot.x, slot.z, 0.9, 0.9, "marking-ev");
            paintLine(b, site, a, d);
            paintLine(b, site, z, c);
            paintLine(b, site, d, c);
            if (slot.accessible) {
                groundDecal(b, site, slot.x, slot.z, 1.05, 1.05, "marking-accessible");
                if (slot.transferCorners) {
                    const [p, q, r, z] = slot.transferCorners;
                    for (let t = 0.08; t < 0.95; t += 0.11) {
                        const u = Math.min(0.97, t + 0.06), a = [
                            p[0] + (z[0] - p[0]) * t,
                            p[1] + (z[1] - p[1]) * t,
                        ], end = [
                            q[0] + (r[0] - q[0]) * u,
                            q[1] + (r[1] - q[1]) * u,
                        ];
                        paintLine(b, site, a, end, 0.08);
                    }
                }
            }
            if (site.numbering)
                groundDecal(b, site, slot.x, slot.z + slot.side * (site.bayDepth / 2 - 0.55), 0.5, 0.5, `marking-bay-${slot.number}`);
        }
        // Circulation arrows are positioned only in verified driveable aisles.
        for (const aisle of plan.aisles.filter((a) => a.connected)) {
            for (const x of [-site.width * 0.24, site.width * 0.24]) {
                const direction = x < 0 ? 1 : -1, z = aisle.z;
                if (!rect2(x, z, 1.55, 0.85).every((p) => inside2(aisle.polygon, p)))
                    continue;
                paintLine(b, site, [x - direction * 0.7, z], [x + direction * 0.7, z], 0.11);
                paintLine(b, site, [x + direction * 0.7, z], [x + direction * 0.18, z - 0.35], 0.11);
                paintLine(b, site, [x + direction * 0.7, z], [x + direction * 0.18, z + 0.35], 0.11);
            }
        }
        if (site.manholes) {
            const mask = parkingFootprint(site), r = site.manholeDiameter / 2 + 0.06;
            for (const [i, aisle] of plan.aisles
                .filter((a) => a.connected)
                .entries()) {
                const center = centroid2(aisle.polygon), circle = Array.from({ length: 32 }, (_, k) => [
                    center[0] + Math.cos((k * Math.PI) / 16) * r,
                    center[1] + Math.sin((k * Math.PI) / 16) * r,
                ]);
                if (!circle.every((p) => inside2(mask, p) && inside2(aisle.polygon, p)))
                    continue;
                addManhole(b, (u, v, h = 0) => sitePoint(site, center[0] + u, center[1] + v, 0.12 + h), site.manholeDiameter);
                services.push({
                    id: `${site.id}:manhole:${i}`,
                    owner: site.id,
                    ownerKind: "site",
                    kind: "manhole",
                    position: sitePoint(site, ...center, 0.13),
                    diameter: site.manholeDiameter,
                });
            }
        }
        // Shallow perimeter drainage detail, entirely in the paved edge course.
        if (site.drainage)
            for (const side of [-1, 1])
                for (let x = -site.width / 2 + 3; x < site.width / 2 - 2; x += 12) {
                    const z = side * (site.depth / 2 - 0.55), center = sitePoint(site, x, z, 0.13);
                    const footprint = parkingFootprint(site);
                    if (!rect2(x, z, 0.62, 0.3).every((p) => inside2(footprint, p)))
                        continue;
                    const entry = parkingEntry(site);
                    if (entry.axis === 1 &&
                        side === entry.sign &&
                        openEntry(site, sitePoint(site, x, z)))
                        continue;
                    addGratedInlet(b, (u, v, h = 0) => sitePoint(site, x + u, z + v, 0.12 + h), 0.28, 0.6);
                    services.push({
                        id: `${site.id}:inlet:${side}:${x}`,
                        owner: site.id,
                        ownerKind: "site",
                        kind: "curb-inlet",
                        position: center,
                        length: 0.6,
                    });
                }
    }
    else if (site.kind === "island") {
        const center = siteOutline(site, 1.2, 0.124);
        b.polygon("paving", "paving-slate", center, undefined, true);
    }
    return b.output();
}
