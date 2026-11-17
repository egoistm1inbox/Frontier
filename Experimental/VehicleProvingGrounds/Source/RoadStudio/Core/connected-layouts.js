import { referenceLayout as ref } from "./design-basis.js";
import { distanceXZ } from "./math.js";
import { sampleAlignment } from "./curves.js";
/** Original, directionally connected road layouts. No scenery/building meshes.
 * Coordinates are metres. Motorway grade separation is in the graph, not props.
 */
import { makeNode, makeRoad, presets, } from "./model.js";
import { makeSite } from "./sites.js";
import { splitRoad } from "./editing.js";
const highway = {
    lanes: 2,
    laneWidth: ref.laneWidth,
    shoulderWidth: ref.mainShoulder,
    roadClass: "mainline",
    embankment: true,
    oneWay: true,
    guardrails: true,
    railHeight: 0.95,
    postSpacing: 2.5,
    curbStyle: "flush",
    curbHeight: 0.05,
    markingStyle: "motorway",
    markingSetback: 1,
    signs: false,
    drainage: false,
    manholes: false,
    cornerRamps: false,
    speedLimit: 100,
    sidewalk: 0,
    structure: "steel",
    bridgeDepth: ref.deckDepth,
    pierSpacing: 30,
    railStyle: "boxbeam",
    crossfall: 1.5,
};
const ramp = {
    ...highway,
    lanes: 1,
    laneWidth: ref.rampLane,
    shoulderWidth: ref.rampShoulder,
    sidewalk: 0,
    roadClass: "connector",
    railStyle: "thrie",
    railHeight: 0.95,
    postSpacing: 2.5,
    speedLimit: 60,
    bridge: false,
    structure: "concrete",
    bridgeDepth: 1.05,
};
function author(name) {
    const project = {
        version: 1,
        name,
        nodes: [],
        roads: [],
        sites: [],
    };
    const node = (name, point, radius = 3, crossings = false) => {
        const n = makeNode(point, name);
        n.radius = radius;
        n.crossings = crossings;
        project.nodes.push(n);
        return n;
    };
    const road = (a, b, name, settings, h1, h2) => {
        const r = makeRoad(a, b, name, settings, h1, h2);
        // Level grade tangents at landings/bridge seams; handles remain editable.
        r.h1[1] = 0;
        r.h2[1] = 0;
        project.roads.push(r);
        return r;
    };
    return { project, node, road };
}
const rotate = (p, quadrant) => {
    const a = (-quadrant * Math.PI) / 2, c = Math.cos(a), s = Math.sin(a);
    return [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c];
};
// The profile is a single smooth transition from fill to a short level overpass.
// Node grades are carried into the cubic handles, rather than reset at every port.
function motorwayHeight(s, halfSpan, landing = 390) {
    const t = Math.max(0, Math.min(1, (landing - Math.abs(s)) / (landing - halfSpan)));
    return ref.deckElevation * t * t * (3 - 2 * t);
}
function motorwayGrade(s, halfSpan, landing = 390) {
    const t = Math.max(0, Math.min(1, (landing - Math.abs(s)) / (landing - halfSpan)));
    return ((-Math.sign(s) * ref.deckElevation * 6 * t * (1 - t)) / (landing - halfSpan));
}
function setGrades(r, start, end) {
    r.h1[1] = start * Math.hypot(r.h1[0], r.h1[2]);
    r.h2[1] = -end * Math.hypot(r.h2[0], r.h2[2]);
    return r;
}
function loopRoads(a, points, prefix, quadrant = 0, radius = ref.loopRadius, startGrade = 0, endGrade = 0) {
    const length = Math.PI * radius * 1.5, sy = points[0].position[1], ey = points[3].position[1], height = (t) => (2 * t * t * t - 3 * t * t + 1) * sy +
        (t * t * t - 2 * t * t + t) * length * startGrade +
        (-2 * t * t * t + 3 * t * t) * ey +
        (t * t * t - t * t) * length * endGrade, grade = (t) => ((6 * t * t - 6 * t) * sy +
        (3 * t * t - 4 * t + 1) * length * startGrade +
        (-6 * t * t + 6 * t) * ey +
        (3 * t * t - 2 * t) * length * endGrade) /
        length, k = radius * 0.5522847498307936, handles = [
        [
            [k, 0, k * 0.08],
            [0, 0, -k],
        ],
        [
            [0, 0, k],
            [k, 0, 0],
        ],
        [
            [-k, 0, 0],
            [k * 0.08, 0, k],
        ],
    ];
    for (let i = 1; i < 3; i++)
        points[i].position[1] = height(i / 3);
    for (let i = 0; i < 3; i++)
        setGrades(a.road(points[i], points[i + 1], `${prefix} loop · 90° ${i + 1}`, {
            ...ramp,
            laneWidth: ref.loopLane,
            roadClass: "loop",
            speedLimit: 50,
        }, rotate(handles[i][0], quadrant), rotate(handles[i][1], quadrant)), grade(i / 3), grade((i + 1) / 3));
}
function cloverleaf() {
    const a = author("Reference cloverleaf · collector-distributor carriageways"), { node, road, project } = a, labels = ["Eastbound", "Northbound", "Westbound", "Southbound"], mainStations = [-1600, -1300, -1000, -390, -48, 48, 390, 1000, 1300, 1600], loopPort = ref.collectorOffset + ref.loopRadius, cdStations = [-1000, -850, -loopPort, -48, 48, loopPort, 850, 1000], main = labels.map((label, q) => mainStations.map((s) => node(`${label} motorway · ${s} m`, rotate([s, q % 2 ? motorwayHeight(s, 48) : 0, ref.carriagewayOffset], q), 1.2))), collectors = labels.map((label, q) => cdStations.map((s) => node(`${label} C-D · ${s} m`, rotate([s, q % 2 ? motorwayHeight(s, 48) : 0, ref.collectorOffset], q), 1.2))), port = (rows, q, s, values) => rows[q][values.indexOf(s)];
    main.forEach((row, q) => row.slice(0, -1).forEach((n, i) => {
        const lo = mainStations[i], hi = mainStations[i + 1];
        setGrades(road(n, row[i + 1], `${labels[q]} motorway · ${i + 1}`, {
            ...highway,
            auxiliaryLane: hi === -1300 ? "exit" : lo === 1300 ? "entry" : "none",
            auxiliaryLength: hi === -1300 ? ref.exitRun : ref.entranceRun,
            auxiliaryTaper: ref.laneTaper,
            bridge: !!(q % 2 && lo === -48 && hi === 48),
        }), q % 2 ? motorwayGrade(lo, 48) : 0, q % 2 ? motorwayGrade(hi, 48) : 0);
    }));
    collectors.forEach((row, q) => {
        row.slice(0, -1).forEach((n, i) => {
            const lo = cdStations[i], hi = cdStations[i + 1];
            setGrades(road(n, row[i + 1], `${labels[q]} collector-distributor · ${i + 1}`, {
                ...ramp,
                laneWidth: ref.laneWidth,
                roadClass: "collector",
                lanes: lo >= -loopPort && hi <= loopPort ? 2 : 1,
                speedLimit: 60,
                bridge: !!(q % 2 && lo === -48 && hi === 48),
                structure: "steel",
                bridgeDepth: ref.deckDepth,
            }), q % 2 ? motorwayGrade(lo, 48) : 0, q % 2 ? motorwayGrade(hi, 48) : 0);
        });
        road(port(main, q, -1300, mainStations), row[0], `${labels[q]} C-D entry · deceleration connection`, {
            ...ramp,
            laneWidth: ref.laneWidth,
            roadClass: "collector",
            speedLimit: 70,
        }, rotate([140, 0, 12], q), rotate([-130, 0, 0], q));
        road(row.at(-1), port(main, q, 1300, mainStations), `${labels[q]} C-D exit · acceleration connection`, {
            ...ramp,
            laneWidth: ref.laneWidth,
            roadClass: "collector",
            speedLimit: 70,
        }, rotate([130, 0, 0], q), rotate([-140, 0, 12], q));
    });
    for (let q = 0; q < 4; q++) {
        const source = port(collectors, q, loopPort, cdStations), target = port(collectors, (q + 1) % 4, -loopPort, cdStations), c = loopPort, r = ref.loopRadius, p1 = node(`${labels[q]} loop · outer quadrant`, rotate([c + r, 0, c], q), 1.2), p2 = node(`${labels[q]} loop · return quadrant`, rotate([c, 0, c + r], q), 1.2);
        loopRoads(a, [source, p1, p2, target], labels[q], q, r, q % 2 ? motorwayGrade(loopPort, 48) : 0, (q + 1) % 2 ? motorwayGrade(-loopPort, 48) : 0);
        const start = port(collectors, q, -850, cdStations), end = port(collectors, (q + 3) % 4, 850, cdStations), radius = 850 - ref.collectorOffset, k = radius * 0.5522847498307936;
        road(start, end, `${labels[q]} direct right-turn connector`, { ...ramp, speedLimit: 70, railStyle: "wbeam" }, rotate([k, 0, k * 0.08], q), rotate([-k * 0.08, 0, -k], q));
    }
    return project;
}
/** Conventional 260 m diamond, 90-degree street terminals, 48 m overpass.
 * Raised approaches and ramps are supported by fill, not kilometres of piers. */
function diamond(a, x, west) {
    const { node, road } = a, values = [-1000, -800, -450, -24, 24, 450, 800, 1000], rows = [values, [...values].reverse()].map((stations, q) => stations.map((z) => node(`${q ? "Northbound" : "Southbound"} ${z} m`, [
        x + (q ? 1 : -1) * ref.carriagewayOffset,
        Math.abs(z) <= 450 ? ref.deckElevation : 0,
        z,
    ], 1.2)));
    for (let q = 0; q < 2; q++) {
        const row = rows[q];
        row.slice(0, -1).forEach((n, i) => road(n, row[i + 1], `${q ? "Northbound" : "Southbound"} highway · ${i + 1}`, {
            ...highway,
            auxiliaryLane: i === 1 ? "exit" : i === 5 ? "entry" : "none",
            auxiliaryLength: i === 1 ? ref.exitRun : ref.entranceRun,
            auxiliaryTaper: ref.laneTaper,
            bridge: Math.abs(n.position[2]) === 24 &&
                Math.abs(row[i + 1].position[2]) === 24,
        }));
    }
    const w = node("West ramp terminals", [x - 130, 0, 0], 24, true), e = node("East ramp terminals", [x + 130, 0, 0], 24, true);
    w.signals = e.signals = true;
    const street = {
        lanes: 2,
        laneWidth: 3.25,
        median: 1.8,
        sidewalk: 3.4,
        cycleMode: "protected",
        cycleWidth: 1.8,
        cycleSeparator: 0.5,
        pattern: "linear",
        curbDrainType: "side-entry",
        streetLights: !!west,
        signs: !!west,
        speedLimit: 50,
    }, boundary = west ?? node("City west approach", [x - 350, 0, 0], 5.2);
    road(boundary, w, "City bridge approach · West", street);
    road(w, e, "Lower avenue · continuous underpass", street);
    road(e, node("City east approach", [x + 350, 0, 0], 5.2), "City bridge approach · East", street);
    road(rows[0][2], w, "Southbound exit · connected descent", ramp, [-12, 0, 170], [0, 0, -140]);
    road(w, rows[0][5], "Southbound entry · connected ascent", ramp, [0, 0, 140], [-12, 0, -170]);
    road(rows[1][2], e, "Northbound exit · connected descent", ramp, [12, 0, -170], [0, 0, 140]);
    road(e, rows[1][5], "Northbound entry · connected ascent", ramp, [0, 0, -140], [12, 0, 170]);
    return a.project;
}
/** A genuine single-loop trumpet: two direct connections, one 270-degree
 * loop and one outer semi-direct connector. The two stem decks cross the
 * through freeway; the loop lead remains below them, with no at-grade joint. */
function trumpet() {
    const a = author("Reference trumpet · one loop and semi-direct connector"), { node, road, project } = a, mainSouth = [-1500, -1100, -650, 0, 650, 1050, 1250].map((z) => node(`Southbound through · ${z} m`, [-ref.carriagewayOffset, 0, z], 1.2)), mainNorth = [1250, 850, 450, 0, -650, -1100, -1500].map((z) => node(`Northbound through · ${z} m`, [ref.carriagewayOffset, 0, z], 1.2)), stemValues = [-1150, -950, -650, -390, -32, 52, 350], stem = stemValues.map((x) => node(`Eastbound stem · ${x} m`, [
        x,
        x <= -390 ? 0 : x >= -32 ? ref.deckElevation : motorwayHeight(x, 32),
        4.5,
    ], 1.2));
    for (const [label, row] of [
        ["Southbound", mainSouth],
        ["Northbound", mainNorth],
    ])
        row.slice(0, -1).forEach((n, i) => {
            const exit = label === "Southbound"
                ? row[i + 1].position[2] === -650
                : row[i + 1].position[2] === 450, entry = label === "Southbound"
                ? n.position[2] === 650
                : n.position[2] === -1100;
            road(n, row[i + 1], `${label} motorway · ${i + 1}`, {
                ...highway,
                auxiliaryLane: exit ? "exit" : entry ? "entry" : "none",
                auxiliaryLength: exit ? ref.exitRun : ref.entranceRun,
                auxiliaryTaper: ref.laneTaper,
            });
        });
    stem.slice(0, -1).forEach((n, i) => road(n, stem[i + 1], `Eastbound stem · ${i + 1}`, {
        ...ramp,
        lanes: stemValues[i] < -650 ? 2 : 1,
        laneWidth: ref.laneWidth,
        speedLimit: 70,
        roadClass: stemValues[i] < -650 ? "mainline" : "connector",
        bridge: stemValues[i] === -32,
        structure: "steel",
        bridgeDepth: ref.deckDepth,
    }));
    const r = ref.loopRadius, k = r * 0.5522847498307936, cy = -r - 4.5, cx = r + 32, loopA = node("Trumpet loop · entry", [32, 0, cy], 1.2), loopB = node("Trumpet loop · crown quadrant", [cx, 0, cy - r], 1.2), loopC = node("Trumpet loop · return quadrant", [cx + r, 0, cy], 1.2), loopD = node("Trumpet loop · bridge landing", [cx, ref.deckElevation, -4.5], 1.2), outboundValues = [52, -32, -390, -650, -950, -1150], outbound = outboundValues.map((x) => node(`Westbound stem · ${x} m`, [
        x,
        x <= -390 ? 0 : x >= -32 ? ref.deckElevation : motorwayHeight(x, 32),
        -4.5,
    ], 1.2)), out = [loopD, ...outbound];
    out.slice(0, -1).forEach((n, i) => road(n, out[i + 1], `Westbound stem · ${i + 1}`, {
        ...ramp,
        lanes: n.position[0] <= -650 ? 2 : 1,
        laneWidth: ref.laneWidth,
        speedLimit: 70,
        roadClass: n.position[0] <= -650 ? "mainline" : "connector",
        bridge: n.position[0] === 52,
        structure: "steel",
        bridgeDepth: ref.deckDepth,
    }));
    road(mainNorth.find((n) => n.position[2] === 450), loopA, "Northbound loop lead · below stem overpass", { ...ramp, speedLimit: 60 }, [36, 0, -180], [0, 0, 180]);
    loopRoads(a, [loopA, loopB, loopC, loopD], "Trumpet", 1, r);
    // Left-turn semi-direct route wraps outside the one loop, without a second loop.
    const semiB = node("Semi-direct · north turn", [650, 0, -295.5], 1.2), semiC = node("Semi-direct · west turn", [350, 0, -595.5], 1.2), semiEnd = mainNorth.find((n) => n.position[2] === -1100), semi = [stem.at(-1), semiB, semiC, semiEnd], h = 300 * 0.5522847498307936, semiRoads = [
        road(semi[0], semi[1], "Trumpet semi-direct · quarter 1", { ...ramp, speedLimit: 60 }, [h, 0, 0], [0, 0, h]),
        road(semi[1], semi[2], "Trumpet semi-direct · quarter 2", { ...ramp, speedLimit: 60 }, [0, 0, -h], [h, 0, 0]),
        road(semi[2], semi[3], "Trumpet semi-direct · northbound merge", { ...ramp, speedLimit: 60 }, [-235, 0, -12], [12, 0, 210]),
    ];
    const lengths = semiRoads.map((r) => {
        const st = sampleAlignment(project, r).stations;
        return st
            .slice(1)
            .reduce((sum, s, i) => sum + distanceXZ(s.p, st[i].p), 0);
    }), total = lengths.reduce((s, l) => s + l, 0);
    let distance = 0;
    semi.forEach((n, i) => {
        if (i)
            distance += lengths[i - 1];
        const t = distance / total;
        n.position[1] = ref.deckElevation * (1 - t * t * (3 - 2 * t));
    });
    distance = 0;
    semiRoads.forEach((r, i) => {
        const g = (s) => (-ref.deckElevation * 6 * (s / total) * (1 - s / total)) / total;
        setGrades(r, g(distance), g(distance + lengths[i]));
        distance += lengths[i];
    });
    const sourceStem = stem.find((n) => n.position[0] === -650), targetSouth = mainSouth.find((n) => n.position[2] === 650), sourceSouth = mainSouth.find((n) => n.position[2] === -650), targetStem = outbound.find((n) => n.position[0] === -650), dx = 641.5 * 0.5522847498307936, dz = 645.5 * 0.5522847498307936;
    road(sourceStem, targetSouth, "Stem to southbound · direct right-turn connector", { ...ramp, speedLimit: 70 }, [dx, 0, dz * 0.08], [-dx * 0.08, 0, -dz]);
    road(sourceSouth, targetStem, "Southbound to stem · direct right-turn connector", { ...ramp, speedLimit: 70 }, [-dx * 0.08, 0, dz], [dx, 0, -dz * 0.08]);
    return project;
}
function city() {
    const a = author("Connected city network · streets and highway bridges"), { project, node, road } = a;
    const coords = [-280, -140, 0, 140, 280], grid = coords.map((z) => coords.map((x) => node(`${x === 0 ? "Central avenue" : `Street ${x / 140 + 3}`} / ${z === 0 ? "Civic boulevard" : `Cross street ${z / 140 + 3}`}`, [x, 0, z], 5.5, true)));
    grid[2][2].signals = true;
    const local = {
        lanes: 2,
        laneWidth: 3.05,
        sidewalk: 3.2,
        parking: "parallel",
        curbExtensions: true,
        pattern: "herringbone",
        speedLimit: 30,
        streetLights: true,
        signs: true,
        curbDrainType: "side-entry",
        manholeSpacing: 48,
    };
    const boulevard = {
        ...presets.find((p) => p.id === "euro-boulevard").settings,
        lanes: 4,
        laneWidth: 3.15,
        median: 1.8,
        sidewalk: 4.6,
        treePits: true,
        pitWidth: 1.4,
        pitLength: 2.4,
        pitSpacing: 22,
        curbDrainType: "side-entry",
        streetLights: true,
        manholeSpacing: 48,
    };
    for (let z = 0; z < 5; z++)
        for (let x = 0; x < 4; x++)
            road(grid[z][x], grid[z][x + 1], z === 2
                ? `Civic boulevard · ${x + 1}`
                : `Neighbourhood street ${z + 1} · ${x + 1}`, z === 2
                ? boulevard
                : { ...local, sharedCycleStreet: z === 1 || z === 3 });
    for (let x = 0; x < 5; x++)
        for (let z = 0; z < 4; z++)
            road(grid[z][x], grid[z + 1][x], x === 2
                ? `Central avenue · ${z + 1}`
                : `Local connector ${x + 1} · ${z + 1}`, x === 2
                ? {
                    ...boulevard,
                    busLanes: "none",
                    cycleMode: "painted",
                    median: 1.4,
                }
                : local);
    for (let z = 0; z < 4; z++)
        for (let x = 0; x < 4; x++) {
            const cx = (coords[x] + coords[x + 1]) / 2, cz = (coords[z] + coords[z + 1]) / 2;
            const block = makeSite("urban-block", [cx, 0, cz]);
            Object.assign(block, {
                name: `Open city plot ${z * 4 + x + 1} · no buildings`,
                width: 84,
                depth: 84,
                blockBand: 2.8,
                blockInterior: "open",
                blockEntrySide: "north",
                blockEntryWidth: 10,
                pattern: "linear",
                cornerRadius: 2.2,
            });
            project.sites.push(block);
            if (z % 3 === 0 && x % 3 === 0) {
                const court = makeSite("parking", [cx, 0, cz]);
                Object.assign(court, {
                    name: `Connected parking court ${z * 4 + x + 1}`,
                    width: 60,
                    depth: 46,
                    entrance: "north",
                    entryWidth: 10,
                    parkingIslands: true,
                    islandEvery: 5,
                    evBays: 4,
                    bayFinish: "permeable",
                    bays: 0,
                });
                project.sites.push(court);
                const host = project.roads.find((r) => r.start === grid[z][x].id && r.end === grid[z][x + 1].id);
                const connection = splitRoad(project, host.id, 0.5);
                connection.name = `Parking access ${z * 4 + x + 1}`;
                connection.crossings = false;
                connection.radius = 3;
                const gate = node(`Court entrance ${z * 4 + x + 1}`, [cx, 0, cz - 23], 2.5);
                road(connection, gate, "Parking access · connected gate", {
                    lanes: 2,
                    laneWidth: 3,
                    sidewalk: 0.8,
                    cornerRamps: false,
                    crossfall: 0,
                    markings: false,
                    drainage: false,
                    manholes: false,
                    speedLimit: 20,
                    curbStyle: "flush",
                });
            }
        }
    // Continuous protected underpass links the city grid to the motorway ramps.
    diamond(a, 540, grid[2][4]);
    return project;
}
function dumbbell() {
    const a = author("Dumbbell junction · linked roundabouts"), { node, road, project } = a, radius = 19;
    const circles = [-78, 78].map((cx, q) => {
        const points = Array.from({ length: 8 }, (_, i) => {
            const angle = (-i * Math.PI) / 4;
            return node(`${q ? "East" : "West"} roundabout · ${i + 1}`, [cx + Math.cos(angle) * radius, 0, Math.sin(angle) * radius], 2.4);
        });
        for (let i = 0; i < 8; i++) {
            const angle = (-i * Math.PI) / 4, next = (-(i + 1) * Math.PI) / 4, h = ((radius * 4) / 3) * Math.tan(Math.PI / 16);
            road(points[i], points[(i + 1) % 8], `${q ? "East" : "West"} circulation · ${i + 1}`, {
                lanes: 1,
                laneWidth: 5.5,
                oneWay: true,
                sidewalk: 3.2,
                markingSetback: 0.5,
                cornerRamps: false,
                drainage: true,
                manholes: false,
                speedLimit: 30,
                pattern: "linear",
            }, [Math.sin(angle) * h, 0, -Math.cos(angle) * h], [-Math.sin(next) * h, 0, Math.cos(next) * h]);
        }
        const center = makeSite("plaza", [cx, 0, 0]);
        Object.assign(center, {
            name: `${q ? "East" : "West"} roundabout central paving`,
            width: 29,
            depth: 29,
            shape: "circle",
            pattern: "slate",
            cornerRadius: 2,
        });
        project.sites.push(center);
        return points;
    });
    const approach = {
        lanes: 2,
        laneWidth: 3.2,
        sidewalk: 3.6,
        pattern: "linear",
        signs: true,
        speedLimit: 30,
    };
    road(circles[0][0], circles[1][4], "Roundabout link · two-way avenue", approach);
    for (let q = 0; q < 2; q++)
        for (const [i, dx, dz] of [
            [q ? 0 : 4, q ? 125 : -125, 0],
            [2, 0, -125],
            [6, 0, 125],
        ]) {
            const n = circles[q][i], end = node(`${q ? "East" : "West"} approach ${i}`, [n.position[0] + dx, 0, n.position[2] + dz], 4);
            road(end, n, `Roundabout approach · ${q + 1}/${i}`, approach);
        }
    return project;
}
export function makeConnectedTemplate(id) {
    if (id === "cloverleaf")
        return cloverleaf();
    if (id === "trumpet")
        return trumpet();
    if (id === "city")
        return city();
    if (id === "bridge" || id === "diamond")
        return diamond(author(id === "bridge"
            ? "Connected highway bridge · directional ramps"
            : "Divided diamond interchange"), 0);
    if (id === "dumbbell")
        return dumbbell();
    return null;
}
