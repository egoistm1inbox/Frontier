import { MeshBuilder } from "./geometry.js";
import { siteOutline, sitePoint, insidePolygon } from "./sites.js";
import { buildPlantingPit } from "./planting.js";
import { add, lerp, polygonArea } from "./math.js";
/** World-space containment of the real solid band; open plots and gate
 * throats are deliberately not collision footprints. */
export function blockSolidAt(site, p) {
    if (!insidePolygon(p, siteOutline(site)))
        return false;
    const band = Math.min(site.blockBand, Math.min(site.width, site.depth) * 0.3);
    if (site.blockInterior !== "paved" &&
        insidePolygon(p, siteOutline(site, band)))
        return false;
    const angle = (-site.yaw * Math.PI) / 180, dx = p[0] - site.position[0], dz = p[2] - site.position[2], x = dx * Math.cos(angle) - dz * Math.sin(angle), z = dx * Math.sin(angle) + dz * Math.cos(angle), side = site.blockEntrySide, width = Math.min(site.blockEntryWidth, (side === "north" || side === "south" ? site.width : site.depth) * 0.65);
    const inGate = width > 0 &&
        ((side === "north" && z <= 0 && Math.abs(x) <= width / 2) ||
            (side === "south" && z >= 0 && Math.abs(x) <= width / 2) ||
            (side === "east" && x >= 0 && Math.abs(z) <= width / 2) ||
            (side === "west" && x <= 0 && Math.abs(z) <= width / 2));
    return !inGate;
}
/** Convex subtraction preserves vertex heights, including vertical plinth faces. */
function outsideMask(poly, mask) {
    const sign = Math.sign(polygonArea(mask)), pieces = [];
    let remainder = poly;
    for (let i = 0; i < mask.length && remainder.length >= 3; i++) {
        const a = mask[i], z = mask[(i + 1) % mask.length], value = (p) => ((z[0] - a[0]) * (p[2] - a[2]) - (z[2] - a[2]) * (p[0] - a[0])) * sign;
        const clip = (inside) => {
            const out = [];
            let previous = remainder.at(-1), dp = value(previous);
            for (const current of remainder) {
                const dc = value(current), before = inside ? dp >= -1e-8 : dp <= 1e-8, after = inside ? dc >= -1e-8 : dc <= 1e-8;
                if (before !== after)
                    out.push(lerp(previous, current, dp / (dp - dc)));
                if (after)
                    out.push(current);
                previous = current;
                dp = dc;
            }
            return out;
        };
        const outside = clip(false);
        if (outside.length >= 3)
            pieces.push(outside);
        remainder = clip(true);
    }
    return pieces;
}
export function buildPlanningSite(site, plantings, blocks) {
    const b = new MeshBuilder(site.id, "site");
    if (site.kind === "tree-pit") {
        buildPlantingPit(b, (u, v, h) => sitePoint(site, v, u, 0.12 + h), site.width, site.depth, site.pitGrate);
        plantings.push({
            id: `${site.id}:pit`,
            owner: site.id,
            ownerKind: "site",
            kind: "tree-pit",
            position: sitePoint(site, 0, 0, 0.12),
            width: site.width,
            length: site.depth,
            grate: site.pitGrate,
            containsTree: false,
        });
        return b.output();
    }
    const band = Math.min(site.blockBand, Math.min(site.width, site.depth) * 0.3), outer = siteOutline(site, 0, 0.12), inner = siteOutline(site, band, 0.12), close = (r) => [...r, r[0]], bottom = outer.map((p) => add(p, [0, -0.25, 0])), insideBottom = inner.map((p) => add(p, [0, -0.25, 0])), entryWidth = Math.min(site.blockEntryWidth, (site.blockEntrySide === "north" || site.blockEntrySide === "south"
        ? site.width
        : site.depth) * 0.65), side = site.blockEntrySide;
    const mask = entryWidth === 0
        ? []
        : (side === "north"
            ? [
                [-entryWidth / 2, -site.depth / 2 - 1],
                [entryWidth / 2, -site.depth / 2 - 1],
                [entryWidth / 2, 0],
                [-entryWidth / 2, 0],
            ]
            : side === "south"
                ? [
                    [-entryWidth / 2, 0],
                    [entryWidth / 2, 0],
                    [entryWidth / 2, site.depth / 2 + 1],
                    [-entryWidth / 2, site.depth / 2 + 1],
                ]
                : side === "west"
                    ? [
                        [-site.width / 2 - 1, -entryWidth / 2],
                        [0, -entryWidth / 2],
                        [0, entryWidth / 2],
                        [-site.width / 2 - 1, entryWidth / 2],
                    ]
                    : [
                        [0, -entryWidth / 2],
                        [site.width / 2 + 1, -entryWidth / 2],
                        [site.width / 2 + 1, entryWidth / 2],
                        [0, entryWidth / 2],
                    ]).map(([x, z]) => sitePoint(site, x, z));
    const strip = (kind, material, a, z, up) => {
        if (!mask.length) {
            b.strip(kind, material, close(a), close(z), up);
            return;
        }
        for (let i = 0; i < a.length; i++) {
            const k = (i + 1) % a.length;
            for (const tri of [
                [a[i], z[i], z[k]],
                [a[i], z[k], a[k]],
            ])
                for (const p of outsideMask(tri, mask)) {
                    const indices = [];
                    for (let j = 1; j < p.length - 1; j++)
                        indices.push(0, j, j + 1);
                    b.append(kind, material, p, indices, up);
                }
        }
    };
    strip("paving", `paving-${site.pattern}`, outer, inner, true);
    // The default plot is genuinely open; no hidden slab/roof fills the ring.
    if (site.blockInterior === "paved")
        b.polygon("paving", `paving-${site.pattern}`, inner, undefined, true);
    strip("paving", "pave-border", siteOutline(site, 0.04, 0.124), siteOutline(site, 0.2, 0.124), true);
    strip("paving", "pave-border", siteOutline(site, Math.max(0.21, band - 0.16), 0.124), siteOutline(site, band, 0.124), true);
    strip("structure", "road-base", outer, bottom);
    strip("structure", "road-base", inner, insideBottom);
    strip("structure", "road-base", bottom, insideBottom, false);
    blocks.push({
        id: `${site.id}:block`,
        owner: site.id,
        position: sitePoint(site, 0, 0, 0.12),
        bandWidth: band,
        interior: site.blockInterior,
        plotArea: Math.abs(polygonArea(inner)),
        hasBuildings: false,
        entry: entryWidth ? { side, width: entryWidth } : null,
    });
    return b.output();
}
