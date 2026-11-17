import { uid } from "./model.js";
import { add, clamp, simplePolygon, polygonArea } from "./math.js";
export const siteCatalog = [
    {
        id: "parking",
        name: "Procedural parking",
        description: "Auto rows · bay angle · drive aisles",
        icon: "square-parking",
    },
    {
        id: "urban-block",
        name: "Urban block perimeter",
        description: "Paved frontage · open plot / courtyard",
        icon: "layout-template",
    },
    {
        id: "tree-pit",
        name: "Empty tree planting pit",
        description: "Recessed soil · frame / optional grate",
        icon: "square-dashed",
    },
    {
        id: "plaza",
        name: "Paving surface",
        description: "Metric stone courses · edge detail",
        icon: "grid-2x2",
    },
    {
        id: "island",
        name: "Curbed splitter",
        description: "Rounded footprint · paving only",
        icon: "triangle",
    },
];
export function makeSite(kind, position) {
    return {
        cornerRadius: 2.2,
        blockBand: 3.2,
        blockInterior: "open",
        blockEntrySide: "north",
        blockEntryWidth: 0,
        pitGrate: false,
        parkingIslands: false,
        islandEvery: 7,
        bayFinish: "asphalt",
        evBays: 0,
        id: uid("site"),
        name: siteCatalog.find((s) => s.id === kind)?.name ??
            `Legacy ${kind} (excluded)`,
        kind,
        position: [...position],
        yaw: 0,
        width: kind === "tree-pit"
            ? 1.8
            : kind === "urban-block"
                ? 64
                : kind === "water"
                    ? 120
                    : kind === "block"
                        ? 62
                        : kind === "parking"
                            ? 54
                            : kind === "plaza"
                                ? 40
                                : 24,
        depth: kind === "tree-pit"
            ? 3
            : kind === "urban-block"
                ? 64
                : kind === "water"
                    ? 240
                    : kind === "block"
                        ? 70
                        : kind === "parking"
                            ? 34
                            : kind === "plaza"
                                ? 36
                                : 24,
        pattern: "ashlar",
        shape: kind === "island" ? "triangle" : "rectangle",
        landscape: false,
        buildingHeight: 0,
        bays: 0,
        accessible: 2,
        entrance: "north",
        bayWidth: 2.8,
        bayDepth: 5.2,
        aisleWidth: 6.5,
        perimeterWidth: 1.8,
        entryWidth: 7,
        parkingAngle: 90,
        parkingLayout: "automatic",
        numbering: false,
        paintWear: 0.08,
        drainage: true,
        manholes: kind === "parking",
        manholeDiameter: 0.65,
    };
}
export function sitePoint(site, x, z, y = 0) {
    const a = (site.yaw * Math.PI) / 180;
    return add(site.position, [
        x * Math.cos(a) - z * Math.sin(a),
        y,
        x * Math.sin(a) + z * Math.cos(a),
    ]);
}
/** Convex rounded footprints, shared by plan, selection, placement and meshes. */
export function siteOutline(site, inset = 0, y = 0.12) {
    const w = Math.max(0.25, site.width / 2 - inset), d = Math.max(0.25, site.depth / 2 - inset);
    if (site.shape === "circle")
        return Array.from({ length: 64 }, (_, i) => sitePoint(site, Math.cos((i * Math.PI) / 32) * w, Math.sin((i * Math.PI) / 32) * d, y));
    if (site.kind === "tree-pit")
        return [
            [-w, -d],
            [w, -d],
            [w, d],
            [-w, d],
        ].map(([x, z]) => sitePoint(site, x, z, y));
    let raw;
    if (site.shape === "triangle") {
        const hw = site.width / 2, hd = site.depth / 2, base = [
            [-hw, -hd],
            [hw, -hd],
            [-hw, hd],
        ], inradius = (site.width + site.depth - Math.hypot(site.width, site.depth)) / 2, amount = Math.min(inset, inradius * 0.78);
        raw = base.map((point, i) => {
            const previous = base[(i + 2) % 3], next = base[(i + 1) % 3], a = [point[0] - previous[0], point[1] - previous[1]], b = [next[0] - point[0], next[1] - point[1]], la = Math.hypot(...a), lb = Math.hypot(...b), na = [-a[1] / la, a[0] / la], nb = [-b[1] / lb, b[0] / lb], factor = amount / (1 + na[0] * nb[0] + na[1] * nb[1]);
            return [
                point[0] + (na[0] + nb[0]) * factor,
                point[1] + (na[1] + nb[1]) * factor,
            ];
        });
    }
    else
        raw = [
            [-w, -d],
            [w, -d],
            [w, d],
            [-w, d],
        ];
    const minEdge = Math.min(...raw.map((p, i) => Math.hypot(p[0] - raw[(i + 1) % raw.length][0], p[1] - raw[(i + 1) % raw.length][1])));
    const rounding = Math.min(Math.max(0.05, site.cornerRadius - inset), w * 0.3, d * 0.3, minEdge * 0.27), out = [];
    raw.forEach((v, i) => {
        const previous = raw[(i + raw.length - 1) % raw.length], next = raw[(i + 1) % raw.length];
        const da = Math.hypot(previous[0] - v[0], previous[1] - v[1]), db = Math.hypot(next[0] - v[0], next[1] - v[1]);
        const a = [
            v[0] + ((previous[0] - v[0]) * rounding) / da,
            v[1] + ((previous[1] - v[1]) * rounding) / da,
        ], b = [
            v[0] + ((next[0] - v[0]) * rounding) / db,
            v[1] + ((next[1] - v[1]) * rounding) / db,
        ];
        for (let j = 0; j <= 8; j++) {
            const t = j / 8, u = 1 - t;
            out.push(sitePoint(site, u * u * a[0] + 2 * u * t * v[0] + t * t * b[0], u * u * a[1] + 2 * u * t * v[1] + t * t * b[1], y));
        }
    });
    return out;
}
export function insidePolygon(p, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i], b = polygon[j];
        if (a[2] > p[2] !== b[2] > p[2] &&
            p[0] < ((b[0] - a[0]) * (p[2] - a[2])) / (b[2] - a[2]) + a[0])
            inside = !inside;
    }
    return inside;
}
export function parseSites(raw, patterns) {
    if (raw === undefined)
        return [];
    if (!Array.isArray(raw) || raw.length > 200)
        throw new Error("Invalid site collection (maximum 200).");
    const ids = new Set();
    return raw
        .map((value) => {
        if (!value || typeof value !== "object")
            throw new Error("Invalid site.");
        const e = value;
        if (typeof e.id !== "string" ||
            e.id.length > 100 ||
            ids.has(e.id) ||
            ![
                "parking",
                "plaza",
                "island",
                "block",
                "water",
                "urban-block",
                "tree-pit",
            ].includes(String(e.kind)))
            throw new Error("Invalid or duplicate site ID/type.");
        ids.add(e.id);
        if (!Array.isArray(e.position) ||
            e.position.length !== 3 ||
            e.position.some((n) => typeof n !== "number" ||
                !Number.isFinite(n) ||
                Math.abs(n) > 100000))
            throw new Error("Invalid site position.");
        const fallback = makeSite(e.kind, e.position);
        const num = (key, min, max) => typeof e[key] === "number" && Number.isFinite(e[key])
            ? clamp(e[key], min, max)
            : fallback[key];
        const site = {
            ...fallback,
            id: e.id,
            name: typeof e.name === "string" ? e.name.slice(0, 80) : fallback.name,
            yaw: num("yaw", -360, 360),
            width: num("width", e.kind === "tree-pit" ? 0.8 : 8, e.kind === "tree-pit" ? 6 : 250),
            depth: num("depth", e.kind === "tree-pit" ? 0.8 : 8, e.kind === "tree-pit" ? 8 : 400),
            cornerRadius: num("cornerRadius", 0.05, 10),
            blockBand: num("blockBand", 1, 8),
            blockInterior: e.blockInterior === "paved" ? "paved" : "open",
            blockEntrySide: ["north", "south", "east", "west"].includes(String(e.blockEntrySide))
                ? e.blockEntrySide
                : "north",
            blockEntryWidth: num("blockEntryWidth", 0, 12),
            pitGrate: e.pitGrate === true,
            parkingIslands: e.parkingIslands === true,
            islandEvery: Math.round(num("islandEvery", 3, 12)),
            bayFinish: ["asphalt", "permeable", "concrete"].includes(String(e.bayFinish))
                ? e.bayFinish
                : "asphalt",
            evBays: Math.round(num("evBays", 0, 30)),
            buildingHeight: num("buildingHeight", 0, 80),
            bays: Math.round(num("bays", 0, 70)),
            accessible: Math.round(num("accessible", 0, 6)),
            pattern: patterns.includes(String(e.pattern))
                ? e.pattern
                : "ashlar",
            shape: e.kind === "tree-pit"
                ? "rectangle"
                : ["rectangle", "triangle", "circle"].includes(String(e.shape))
                    ? e.shape
                    : fallback.shape,
            landscape: false,
            entrance: ["north", "south", "east", "west"].includes(String(e.entrance))
                ? e.entrance
                : "north",
            bayWidth: num("bayWidth", 2.4, 3.6),
            bayDepth: num("bayDepth", 4.5, 6.5),
            aisleWidth: num("aisleWidth", 4, 9),
            perimeterWidth: num("perimeterWidth", 0.3, 4),
            entryWidth: num("entryWidth", 3.5, 10),
            parkingAngle: [45, 60, 90].includes(Number(e.parkingAngle))
                ? Number(e.parkingAngle)
                : 90,
            parkingLayout: ["automatic", "double", "single"].includes(String(e.parkingLayout))
                ? e.parkingLayout
                : "automatic",
            numbering: e.numbering === true,
            paintWear: num("paintWear", 0, 0.35),
            drainage: e.drainage !== false,
            manholes: e.manholes !== false && e.kind === "parking",
            manholeDiameter: num("manholeDiameter", 0.45, 1),
        };
        const polygon = siteOutline(site);
        if (!simplePolygon(polygon) ||
            Math.abs(polygonArea(polygon)) < (site.kind === "tree-pit" ? 0.3 : 1))
            throw new Error("Degenerate site footprint.");
        return site;
    })
        .filter((s) => s.kind !== "block" && s.kind !== "water");
}
