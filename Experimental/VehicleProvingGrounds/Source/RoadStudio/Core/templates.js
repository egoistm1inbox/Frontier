import { makeConnectedTemplate } from "./connected-layouts.js";
import { makeNode, makeRoad, presets, roadHalfWidth, roadDefaults, } from "./model.js";
import { makeSite } from "./sites.js";
import { mul, sub } from "./math.js";
export const templateCatalog = [
    {
        id: "city",
        name: "Connected city network",
        description: "Street hierarchy · shared cycle streets · highway flyovers · no buildings",
    },
    {
        id: "bridge",
        name: "Connected highway bridge",
        description: "Divided decks · four directional ramps · continuous lower avenue",
    },
    {
        id: "dumbbell",
        name: "Dumbbell junction",
        description: "Twin compact roundabouts · linked city approaches · curbed islands",
    },
    {
        id: "europe",
        name: "European mobility quarter",
        description: "Bus priority · protected cycling · open blocks · parking courts",
    },
    {
        id: "district",
        name: "Northbank district",
        description: "Urban junctions · paving · procedural parking",
    },
    {
        id: "merge",
        name: "Lane merge laboratory",
        description: "Recessed paving nose · continuous lane guides",
    },
    {
        id: "urban",
        name: "Harbour street circuit",
        description: "Street loop · lane detail · procedural parking",
    },
    {
        id: "signal",
        name: "Channelized crossroads",
        description: "Slip lanes · paved splitters · box markings",
    },
    {
        id: "cloverleaf",
        name: "Reference cloverleaf interchange",
        description: "120 m loops · collector-distributors · 96 m overpasses",
    },
    {
        id: "trumpet",
        name: "Reference trumpet interchange",
        description: "One 270° loop · semi-direct connector · 84 m stem spans",
    },
    {
        id: "race",
        name: "Grand prix paddock",
        description: "Closed racing circuit · rumble strips · pits",
    },
    {
        id: "waterfront",
        name: "Waterfront promenade",
        description: "Curved limestone walks · plazas · railing",
    },
    {
        id: "tee",
        name: "Three-way junction",
        description: "Shared T-joint · modern paved corners",
    },
    {
        id: "roundabout",
        name: "Garden roundabout",
        description: "One-way circulation · curbed paving",
    },
    {
        id: "diamond",
        name: "Diamond interchange",
        description: "Connected ramps · steel bridge · route signs",
    },
];
const ids = new Set([
    "europe",
    "merge",
    "urban",
    "signal",
    "cloverleaf",
    "trumpet",
    "race",
    "waterfront",
]);
export function makeAdvancedTemplate(type) {
    const connected = makeConnectedTemplate(type);
    if (connected)
        return connected;
    if (!ids.has(type))
        return null;
    const project = {
        version: 1,
        name: templateCatalog.find((t) => t.id === type).name,
        nodes: [],
        roads: [],
        sites: [],
    };
    const node = (name, x, z, y = 0, radius = 6) => {
        const n = makeNode([x, y, z], name);
        n.radius = radius;
        n.crossings = false;
        project.nodes.push(n);
        return n;
    };
    const road = (a, b, name, settings = {}, h1, h2) => {
        const r = makeRoad(a, b, name, settings, h1, h2);
        project.roads.push(r);
        return r;
    };
    const site = (kind, x, z, width, depth, yaw = 0) => {
        const s = makeSite(kind, [x, 0, z]);
        Object.assign(s, { width, depth, yaw });
        project.sites.push(s);
        return s;
    };
    const highway = {
        lanes: 4,
        laneWidth: 3.5,
        sidewalk: 0.8,
        pattern: "linear",
        guardrails: true,
        drainage: false,
        manholes: false,
        markingStyle: "motorway",
        signs: false,
        speedLimit: 100,
        median: 1.2,
    };
    const ramp = {
        lanes: 1,
        laneWidth: 4.2,
        sidewalk: 0.65,
        guardrails: true,
        drainage: false,
        manholes: false,
        oneWay: true,
        markingStyle: "motorway",
        signs: false,
        speedLimit: 60,
        pattern: "slate",
    };
    const city = {
        lanes: 2,
        laneWidth: 3.3,
        sidewalk: 3.4,
        pattern: "ashlar",
        signs: false,
        speedLimit: 40,
        streetLights: false,
    };
    const rotate = (p, i) => {
        const a = (i * Math.PI) / 2;
        return [
            p[0] * Math.cos(a) - p[2] * Math.sin(a),
            p[1],
            p[0] * Math.sin(a) + p[2] * Math.cos(a),
        ];
    };
    if (type === "europe") {
        const boulevard = {
            ...presets.find((p) => p.id === "euro-boulevard").settings,
            signs: false,
            streetLights: false,
        }, cycle = {
            ...presets.find((p) => p.id === "cycle-street").settings,
            sidewalk: 4.8,
            signs: false,
            streetLights: false,
        }, step = 110, grid = Array.from({ length: 3 }, (_, z) => Array.from({ length: 3 }, (_, x) => {
            const n = node(`Mobility junction ${z * 3 + x + 1}`, (x - 1) * step, (z - 1) * step, 0, 7);
            n.crossings = true;
            return n;
        })), horizontal = [];
        for (let z = 0; z < 3; z++)
            for (let x = 0; x < 2; x++)
                horizontal.push(road(grid[z][x], grid[z][x + 1], `Bus boulevard ${z + 1} / ${x + 1}`, boulevard));
        for (let x = 0; x < 3; x++)
            for (let z = 0; z < 2; z++)
                road(grid[z][x], grid[z + 1][x], `Cycle street ${x + 1} / ${z + 1}`, cycle);
        const frontage = (settings) => roadHalfWidth({ ...roadDefaults, ...settings }) +
            (settings.sidewalk ?? roadDefaults.sidewalk) +
            0.22, edgeX = frontage(cycle), edgeZ = frontage(boulevard), width = step - 2 * edgeX - 0.2, depth = step - 2 * edgeZ - 0.2, band = 3.2;
        for (let z = 0; z < 2; z++)
            for (let x = 0; x < 2; x++) {
                const cx = (x - 0.5) * step, cz = (z - 0.5) * step, label = String.fromCharCode(65 + z * 2 + x), block = site("urban-block", cx, cz, width, depth);
                Object.assign(block, {
                    name: `Block ${label} · open perimeter`,
                    pattern: "linear",
                    blockBand: band,
                    blockEntryWidth: 7,
                    blockEntrySide: "north",
                    cornerRadius: 2.2,
                    position: [cx, 0.152, cz],
                });
                const court = site("parking", cx, cz, width - 2 * band - 0.4, depth - 2 * band - 0.4), apron = band + 0.3;
                Object.assign(court, {
                    name: `Block ${label} · parking court`,
                    position: [cx, 0.152 + apron * 0.015, cz],
                    parkingIslands: true,
                    islandEvery: 6,
                    evBays: 4,
                    bayFinish: "permeable",
                    perimeterWidth: 1.4,
                    accessible: 2,
                    numbering: true,
                });
                const entry = horizontal[z * 2 + x];
                entry.driveways.push({
                    id: `block-${label.toLowerCase()}-entry`,
                    at: 0.5,
                    side: 1,
                    width: 7,
                    apron,
                });
            }
    }
    else if (type === "merge") {
        const c = node("Shared merge pivot", 0, 0), a = node("Incoming avenue", -140, 0), b = node("Through avenue", 180, 0), d = node("Slip approach", 164, 74);
        road(a, c, "Incoming avenue", city);
        road(c, b, "Through avenue", city);
        road(d, c, "Merging slip lane", { ...city, lanes: 1, laneWidth: 4.2, sidewalk: 2, oneWay: true }, [-56, 0, -25], [50, 0, 23]);
        c.setback = 3;
    }
    else if (type === "urban") {
        const raw = [
            [0, -130],
            [-80, -130],
            [-105, -105],
            [-105, 0],
            [-105, 105],
            [-80, 130],
            [0, 130],
            [80, 130],
            [105, 105],
            [105, 0],
            [105, -105],
            [80, -130],
        ];
        const ring = raw.map(([x, z], i) => node(`Circuit waypoint ${i + 1}`, x, z, 0, 10));
        const k = 13.8071, outer = { ...city, parking: "parallel" };
        for (let i = 0; i < ring.length; i++) {
            const a = ring[i], b = ring[(i + 1) % ring.length];
            const curve = i === 1
                ? [
                    [-k, 0, 0],
                    [0, 0, -k],
                ]
                : i === 4
                    ? [
                        [0, 0, k],
                        [-k, 0, 0],
                    ]
                    : i === 7
                        ? [
                            [k, 0, 0],
                            [0, 0, k],
                        ]
                        : i === 10
                            ? [
                                [0, 0, -k],
                                [k, 0, 0],
                            ]
                            : null;
            road(a, b, `Harbour circuit · ${String(i + 1).padStart(2, "0")}`, outer, ...(curve ?? [undefined, undefined]));
        }
        const center = node("City junction", 0, 0, 0, 11);
        center.crossings = true;
        center.boxJunction = true;
        center.signals = false;
        for (const index of [0, 3, 6, 9]) {
            ring[index].crossings = true;
            road(center, ring[index], `Central boulevard · ${index}`, {
                ...city,
                lanes: 4,
                laneWidth: 3.2,
                parking: "none",
            });
        }
        const parking = site("parking", 171, 0, 64, 36);
        parking.name = "Harbour parking court";
        parking.entrance = "west";
        parking.bays = 0;
        const entrance = node("Parking entry", 139, 0);
        road(ring[9], entrance, "Parking driveway", {
            lanes: 2,
            laneWidth: 3,
            sidewalk: 0.5,
            crossfall: 0,
            markings: false,
            signs: false,
            speedLimit: 20,
        }, [12, 0, 0], [-12, 0, 0]);
    }
    else if (type === "signal") {
        const c = node("Signalized crossing", 0, 0, 0, 6);
        c.crossings = true;
        c.boxJunction = true;
        c.signals = false;
        const arms = Array.from({ length: 4 }, (_, i) => {
            const p = rotate([0, 0, -56], i);
            return node(`Slip terminal ${i + 1}`, p[0], p[2], 0, 4);
        });
        const arterial = { ...city, lanes: 2, laneWidth: 3.25, sidewalk: 3.4 };
        arms.forEach((a, i) => {
            const p = rotate([0, 0, -135], i), end = node(`Avenue boundary ${i + 1}`, p[0], p[2]);
            road(end, a, `Avenue ${i + 1} · outer`, arterial);
            road(a, c, `Avenue ${i + 1} · inner`, arterial);
            road(a, arms[(i + 3) % 4], `Free-flow slip ${i + 1}`, {
                ...ramp,
                guardrails: false,
                sidewalk: 1.8,
                pattern: "linear",
                signs: false,
                speedLimit: 30,
                markingStyle: "urban",
                laneWidth: 3.5,
            }, rotate([-16, 0, 23], i), rotate([23, 0, -16], i));
            const q = rotate([-16, 0, -16], i), island = site("island", q[0], q[2], 10, 10, i * 90);
            island.name = `Rounded paved splitter island ${i + 1}`;
            island.cornerRadius = 0.9;
            island.pattern = "linear";
        });
    }
    else if (type === "cloverleaf" || type === "trumpet") {
        const w = node("West merge", -160, 0, 0, 4), e = node("East merge", 160, 0, 0, 4), n = node("North merge", 0, -160, 9, 4);
        road(node("West boundary", -430, 0), w, "Motorway · West", highway);
        road(w, e, "Motorway · Through", highway);
        road(e, node("East boundary", 430, 0), "Motorway · East", highway);
        road(node("North boundary", 0, -430), n, "Elevated approach · North", highway, [0, 0, 100], [0, 0, -100]);
        const s = type === "cloverleaf"
            ? node("South merge", 0, 160, 9, 4)
            : node("Flyover fork", 0, 100, 9, 7);
        road(n, s, "Steel flyover", { ...highway, bridge: true, structure: "steel" }, [0, 0, 95], [0, 0, -95]);
        if (type === "cloverleaf")
            road(s, node("South boundary", 0, 430), "Elevated approach · South", highway, [0, 0, 100], [0, 0, -100]);
        const hubs = [w, n, e, s], count = type === "cloverleaf" ? 4 : 1, radius = 55, k = 0.55228475 * radius;
        for (let quadrant = 0; quadrant < count; quadrant++) {
            const from = hubs[quadrant], to = hubs[(quadrant + 1) % 4], startY = from.position[1], endY = to.position[1];
            const positions = [
                [-90 + radius, 0, -92],
                [-90, 0, -92 - radius],
                [-90 - radius, 0, -92],
                [-90, 0, -92 + radius],
            ];
            const points = positions.map((p, i) => {
                const q = rotate(p, quadrant);
                return node(`Loop ${quadrant + 1} · ${i + 1}`, q[0], q[2], startY + (endY - startY) * (0.2 + i * 0.2), 3);
            });
            const settings = {
                ...ramp,
                bridge: true,
                structure: "concrete",
            };
            road(from, points[0], `Loop ${quadrant + 1} · entry`, settings, rotate([35, 0, -22], quadrant), rotate([0, 0, 35], quadrant));
            const handles = [
                [
                    [0, 0, -k],
                    [k, 0, 0],
                ],
                [
                    [-k, 0, 0],
                    [0, 0, -k],
                ],
                [
                    [0, 0, k],
                    [-k, 0, 0],
                ],
            ];
            for (let i = 0; i < 3; i++)
                road(points[i], points[i + 1], `Loop ${quadrant + 1} · arc ${i + 1}`, settings, rotate(handles[i][0], quadrant), rotate(handles[i][1], quadrant));
            road(points[3], to, `Loop ${quadrant + 1} · exit`, settings, rotate([42, 0, 0], quadrant), rotate([-22, 0, 35], quadrant));
        }
        if (type === "trumpet") {
            road(s, w, "West descending ramp", { ...ramp, bridge: true }, [-60, 0, 0], [24, 0, 40]);
            road(e, s, "East ascending ramp", { ...ramp, bridge: true }, [-24, 0, 40], [60, 0, 0]);
        }
    }
    else if (type === "race") {
        const settings = {
            ...presets.find((p) => p.id === "race").settings,
            lanes: 2,
            laneWidth: 5.2,
        };
        const raw = [
            [-140, -85],
            [-35, -115],
            [110, -88],
            [155, 0],
            [82, 85],
            [12, 43],
            [-58, 107],
            [-149, 37],
        ];
        const ring = raw.map(([x, z], i) => node(`Race sector ${i + 1}`, x, z, 0, 6));
        const tangents = ring.map((n, i) => mul(sub(ring[(i + 1) % ring.length].position, ring[(i + ring.length - 1) % ring.length].position), 0.17));
        for (let i = 0; i < ring.length; i++)
            road(ring[i], ring[(i + 1) % ring.length], `Grand prix · Sector ${i + 1}`, { ...settings, startingGrid: i === 0 }, tangents[i], mul(tangents[(i + 1) % ring.length], -1));
        const pad = site("parking", -15, -182, 106, 32);
        pad.name = "Paddock and pit parking";
        pad.bays = 0;
        pad.entrance = "south";
        const entry = node("Pit lane entry", -80, -145), exit = node("Pit lane exit", 70, -145), mid = node("Paddock access", -15, -145, 0, 4);
        const pitSettings = {
            ...settings,
            laneWidth: 3.3,
            sidewalk: 1,
            curbStyle: "stone",
            railStyle: "railing",
            markingStyle: "urban",
            speedLimit: 40,
        };
        road(ring[0], entry, "Pit entry taper", pitSettings, [4, 0, -43], [-23, 0, 0]);
        road(entry, mid, "Pit straight · West", pitSettings);
        road(mid, exit, "Pit straight · East", pitSettings);
        road(exit, ring[2], "Pit exit taper", pitSettings, [22, 0, 0], [-8, 0, -35]);
        const gate = node("Paddock gate", -15, -166);
        road(mid, gate, "Paddock driveway", {
            lanes: 2,
            laneWidth: 3,
            sidewalk: 0.5,
            crossfall: 0,
            markings: false,
            signs: false,
            speedLimit: 20,
        });
    }
    else if (type === "waterfront") {
        const walk = {
            ...presets.find((p) => p.id === "promenade").settings,
            crossfall: 1,
            railHeight: 1.1,
            postSpacing: 2.2,
        };
        const raw = [
            [-33, -185],
            [-19, -92],
            [-37, 0],
            [-12, 94],
            [-27, 187],
        ];
        const ring = raw.map(([x, z], i) => node(`Promenade waypoint ${i + 1}`, x, z));
        for (let i = 0; i < ring.length - 1; i++)
            road(ring[i], ring[i + 1], `Waterfront promenade · ${i + 1}`, walk, [18, 0, 32], [-18, 0, -32]);
        const cycle = raw.map(([x, z], i) => node(`Cycle waypoint ${i + 1}`, x - 28, z, 0, 2));
        for (let i = 0; i < cycle.length - 1; i++)
            road(cycle[i], cycle[i + 1], `Coastal cycleway · ${i + 1}`, {
                lanes: 1,
                laneWidth: 3.4,
                sidewalk: 0.4,
                surface: "asphalt",
                oneWay: true,
                markingStyle: "urban",
                curbStyle: "flush",
                drainage: false,
                manholes: false,
                markings: false,
            }, [18, 0, 32], [-18, 0, -32]);
        road(cycle[0], ring[0], "North promenade link", { ...walk, guardrails: false }, [6, 0, 0], [-6, 0, 0]);
        road(cycle[4], ring[4], "South promenade link", { ...walk, guardrails: false }, [6, 0, 0], [-6, 0, 0]);
        for (const z of [-135, 42, 140])
            site("plaza", -70, z, 25, 27).name = `Promenade terrace ${z}`;
    }
    return project;
}
