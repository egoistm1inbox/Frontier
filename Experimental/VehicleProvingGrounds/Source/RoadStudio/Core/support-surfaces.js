import { clipConvex2, area2 } from "./polygons.js";
import { lerp } from "./math.js";
/** Spatially indexed, actual solid surface triangles, including trimmed curved
 * junction footways, parking and gated plot bands. Empty holes/gateways never
 * acquire a bounding-rectangle collision slab. This index is rebuild-local and
 * is not exported or stored in the editable project.
 */
export class SupportSurfaceIndex {
    cells = new Map();
    cellSize = 32;
    triangleCount;
    constructor(meshes, regions) {
        let count = 0;
        for (const mesh of meshes) {
            if (!["asphalt", "paving", "parking", "bus", "cycle", "planting"].includes(mesh.kind) ||
                mesh.material.startsWith("marking-") ||
                ["paint", "yellow"].includes(mesh.material))
                continue;
            let nearby = regions;
            if (regions) {
                let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity;
                const v = mesh.positions;
                for (let k = 0; k < v.length; k += 3) {
                    minX = Math.min(minX, v[k]);
                    maxX = Math.max(maxX, v[k]);
                    minZ = Math.min(minZ, v[k + 2]);
                    maxZ = Math.max(maxZ, v[k + 2]);
                    minY = Math.min(minY, v[k + 1]);
                }
                nearby = regions.filter((r) => r.maxY >= minY &&
                    r.maxX >= minX &&
                    r.minX <= maxX &&
                    r.maxZ >= minZ &&
                    r.minZ <= maxZ);
                if (!nearby.length)
                    continue;
            }
            for (let i = 0; i < mesh.indices.length; i += 3) {
                const offsets = mesh.indices.slice(i, i + 3).map((v) => v * 3), p = mesh.positions, [a, b, c] = offsets, projectedArea = (p[b] - p[a]) * (p[c + 2] - p[a + 2]) -
                    (p[b + 2] - p[a + 2]) * (p[c] - p[a]);
                if (Math.abs(projectedArea) < 1e-8)
                    continue; // Vertical faces cannot occupy a horizontal footprint.
                const tri = {
                    mesh,
                    offsets,
                    minX: Math.min(...offsets.map((k) => p[k])),
                    maxX: Math.max(...offsets.map((k) => p[k])),
                    minZ: Math.min(...offsets.map((k) => p[k + 2])),
                    maxZ: Math.max(...offsets.map((k) => p[k + 2])),
                    minY: Math.min(...offsets.map((k) => p[k + 1])),
                    maxY: Math.max(...offsets.map((k) => p[k + 1])),
                };
                if (nearby &&
                    !nearby.some((r) => r.maxY >= tri.minY &&
                        r.maxX >= tri.minX &&
                        r.minX <= tri.maxX &&
                        r.maxZ >= tri.minZ &&
                        r.minZ <= tri.maxZ))
                    continue;
                for (const key of this.keys(tri)) {
                    const cell = this.cells.get(key);
                    if (cell)
                        cell.push(tri);
                    else
                        this.cells.set(key, [tri]);
                }
                count++;
            }
        }
        this.triangleCount = count;
    }
    *keys(b) {
        for (let x = Math.floor(b.minX / this.cellSize); x <= Math.floor(b.maxX / this.cellSize); x++)
            for (let z = Math.floor(b.minZ / this.cellSize); z <= Math.floor(b.maxZ / this.cellSize); z++)
                yield `${x}:${z}`;
    }
    clear(envelope, ignoreOwner) {
        const { outline, minY, maxY } = envelope;
        if (outline.length < 3)
            return true;
        const bounds = {
            minX: Math.min(...outline.map((p) => p[0])),
            maxX: Math.max(...outline.map((p) => p[0])),
            minZ: Math.min(...outline.map((p) => p[1])),
            maxZ: Math.max(...outline.map((p) => p[1])),
        }, visited = new Set();
        for (const key of this.keys(bounds))
            for (const tri of this.cells.get(key) ?? []) {
                if (visited.has(tri))
                    continue;
                visited.add(tri);
                if (tri.mesh.owner === ignoreOwner ||
                    tri.minY > maxY + 1e-8 ||
                    tri.maxY < minY - 1e-8 ||
                    tri.minX > bounds.maxX ||
                    tri.maxX < bounds.minX ||
                    tri.minZ > bounds.maxZ ||
                    tri.maxZ < bounds.minZ)
                    continue;
                let poly = tri.offsets.map((k) => tri.mesh.positions.slice(k, k + 3));
                // Clip height BEFORE projecting: a long sloped triangle's low vertex does
                // not falsely block a footing beside its high end.
                for (const [height, above] of [
                    [minY, true],
                    [maxY, false],
                ]) {
                    if (poly.length < 3)
                        break;
                    const out = [];
                    let a = poly.at(-1), da = above ? a[1] - height : height - a[1];
                    for (const b of poly) {
                        const db = above ? b[1] - height : height - b[1];
                        if (da >= 0 !== db >= 0)
                            out.push(lerp(a, b, da / (da - db)));
                        if (db >= 0)
                            out.push(b);
                        a = b;
                        da = db;
                    }
                    poly = out;
                }
                if (poly.length >= 3 &&
                    Math.abs(area2(clipConvex2(poly.map((p) => [p[0], p[2]]), outline))) > 1e-6)
                    return false;
            }
        return true;
    }
}
export function supportOutline(point, normal, direction, width, depth, margin = 0.2) {
    const w = width / 2 + margin, d = depth / 2 + margin;
    return [
        [-w, -d],
        [w, -d],
        [w, d],
        [-w, d],
    ].map(([u, v]) => [
        point[0] + normal[0] * u + direction[0] * v,
        point[2] + normal[2] * u + direction[2] * v,
    ]);
}
