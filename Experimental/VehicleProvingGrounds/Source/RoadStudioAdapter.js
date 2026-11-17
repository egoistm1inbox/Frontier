//============================================================================================================================================
//                                                        ROADSTUDIOADAPTER.JS
//============================================================================================================================================
// Bridges the full Frontier Road Studio engine (Source/RoadStudio/Core/* — cubic Bézier alignments, tangent-fillet junctions,
// connected steel I-girder & concrete girder highway bridges, elastomeric bearings, chamfered piers, 2:1 earth embankments,
// auxiliary speed-change lanes, 7 physical barrier profiles, European bus/cycle lanes, parallel parking, kerbs & utilities)
// directly into Proving Grounds' WebGPU VertexRecords + 480 Hz CastSurfaceRay physics + Hovering Robotic Traffic Lights.

import { CourseMaterial } from "./MaterialSpecification.js";
import { SurfaceCategory } from "./RampSurfaceProjection.js";
import {
    makeDemo,
    makeTemplate,
    parseProject,
    presets,
    patterns,
    patternNames,
    railStyles,
    railNames,
    roadDefaults,
    makeNode,
    makeRoad,
    getNode,
    connected,
    controlPoints
} from "./RoadStudio/Core/model.js";
import { templateCatalog } from "./RoadStudio/Core/templates.js";
import {
    buildNetwork,
    surfaceHeight,
    sideHalfWidth
} from "./RoadStudio/Core/geometry.js";
import {
    insertRoad,
    splitRoad,
    findSnap,
    moveNode,
    translateRoad,
    resolveCrossings,
    deleteSelection
} from "./RoadStudio/Core/editing.js";
import { sampleAlignment, closestOnAlignment } from "./RoadStudio/Core/curves.js";
import { insertConnectedBridge } from "./RoadStudio/Core/bridge-insertion.js";

export {
    makeDemo,
    makeTemplate,
    parseProject,
    presets,
    patterns,
    patternNames,
    railStyles,
    railNames,
    roadDefaults,
    templateCatalog,
    makeNode,
    makeRoad,
    getNode,
    connected,
    controlPoints,
    buildNetwork,
    insertRoad,
    splitRoad,
    findSnap,
    sampleAlignment,
    closestOnAlignment,
    moveNode,
    translateRoad,
    resolveCrossings,
    deleteSelection,
    insertConnectedBridge
};

// Capacity: 262,144 triangles (786,432 vertices) — comfortably holds full connected highway bridges,
// diamond/trumpet/cloverleaf interchanges, Grand Prix circuits, and urban districts on the GPU.
export const RoadStudioVertexCapacity = 786432;

//------------------------------------------------------------------------------------------------------------------------
//                      COORDINATE MAPPING: ROAD STUDIO Y-UP (x, y, z) <-> PROVING GROUNDS Z-UP (X, Y, Z)
//------------------------------------------------------------------------------------------------------------------------
// Proper right-handed rotation Rx(+90°): (x, y, z) -> (AnchorX + x, AnchorY - z, AnchorZ + y), det = +1.
// Preserves outward CCW triangle winding while mapping +y (Studio elevation) -> +Z (Proving Grounds elevation).

export function StudioPointToWorld(Point, Anchor)
{
    return [
        Anchor[0] + Point[0],
        Anchor[1] - Point[2],
        Anchor[2] + Point[1]
    ];
}

export function WorldPointToStudio(WorldPoint, Anchor)
{
    return [
        WorldPoint[0] - Anchor[0],
        WorldPoint[2] - Anchor[2],
        Anchor[1] - WorldPoint[1]
    ];
}

export function StudioDirectionToWorld(Dir)
{
    return [Dir[0], -Dir[2], Dir[1]];
}

export function ComputeWorldAnchorForBounds(Bounds, LevelKey = "inversion")
{
    if (LevelKey === "city")
        return [0.0, 0.0, 0.0];
    const MinStudioX = Bounds && Number.isFinite(Bounds.min?.[0]) ? Bounds.min[0] : -85.0;
    if (LevelKey === "dday")
    {
        const AnchorX = Math.max(260.0, Math.ceil((185.0 - MinStudioX) / 10.0) * 10.0);
        return [AnchorX, 0.0, 0.0];
    }
    if (LevelKey === "inversion")
    {
        // Keep a clean >= 38 m buffer East of Tracks A–H (MaxX = 222 m), regardless of interchange width.
        const AnchorX = Math.max(360.0, Math.ceil((262.0 - MinStudioX) / 10.0) * 10.0);
        return [AnchorX, 0.0, 0.0];
    }
    const AnchorX = Math.max(220.0, Math.ceil((135.0 - MinStudioX) / 10.0) * 10.0);
    return [AnchorX, 0.0, 0.0];
}

//------------------------------------------------------------------------------------------------------------------------
//                                      MATERIAL & MESH PRIORITY MAPPING FOR WEBGPU GI
//------------------------------------------------------------------------------------------------------------------------

const MeshKindPriority = Object.freeze({
    asphalt:   0,
    structure: 1,
    curb:      2,
    paving:    3,
    cycle:     4,
    bus:       5,
    marking:   6,
    parking:   7,
    rail:      8,
    sign:      9,
    lamp:      10,
    gutter:    11,
    drain:     12,
    planting:  13,
    utility:   14,
    landscape: 15,
    building:  16
});

function ResolveCourseMaterial(MeshKind, MaterialKey, ArcU = 0.0)
{
    if (MaterialKey === "race-curb")
        return (Math.floor(Math.abs(ArcU) / 1.25) & 1) === 0 ? CourseMaterial.KerbRed : CourseMaterial.PaintWhite;
    if (MaterialKey === "asphalt")
        return CourseMaterial.Asphalt;
    if (MaterialKey === "concrete")
        return MeshKind === "structure" ? CourseMaterial.BarrierConcrete : CourseMaterial.ApronConcrete;
    if (MaterialKey === "cobble")
        return CourseMaterial.Stone;
    if (MaterialKey === "pavers" || MaterialKey === "paving-ashlar" || MaterialKey === "paving-linear" ||
        MaterialKey === "paving-slabs" || MaterialKey === "paving-terrazzo")
        return CourseMaterial.Concrete;
    if (MaterialKey === "paving-slate")
        return CourseMaterial.AsphaltPatch;
    if (MaterialKey === "paving-herringbone" || MaterialKey === "paving-running" || MaterialKey === "paving-basket")
        return CourseMaterial.WoodInterior;
    if (MaterialKey === "paving-permeable")
        return CourseMaterial.Gravel;
    if (MaterialKey === "curb" || MaterialKey === "wheel-stop")
        return CourseMaterial.BarrierConcrete;
    if (MaterialKey === "pave-border" || MaterialKey === "gutter")
        return CourseMaterial.AsphaltPatch;
    if (MaterialKey === "paint" || MaterialKey.startsWith("paint-wear-") || MaterialKey.startsWith("marking-"))
        return CourseMaterial.PaintWhite;
    if (MaterialKey === "yellow")
        return CourseMaterial.PaintYellow;
    if (MaterialKey === "accessible-blue" || MaterialKey === "sign-parking")
        return CourseMaterial.PaintBlue;
    if (MaterialKey === "sign-exit" || MaterialKey === "cycle-green")
        return CourseMaterial.PaintGreen;
    if (MaterialKey === "bus-red" || MaterialKey === "cycle-red")
        return CourseMaterial.KerbRed;
    if (MaterialKey === "tactile")
        return CourseMaterial.BannerAmber;
    if (MaterialKey === "steel")
        return CourseMaterial.Aluminium;
    if (MaterialKey === "girder" || MaterialKey === "steel-dark" || MaterialKey === "pole" ||
        MaterialKey.startsWith("utility-") || MaterialKey === "tree-grate" || MaterialKey === "drain-dark")
        return CourseMaterial.SteelDark;
    if (MaterialKey === "road-base" || MaterialKey === "foundation")
        return CourseMaterial.TunnelConcrete;
    if (MaterialKey === "soil")
        return CourseMaterial.Wood;
    if (MaterialKey === "lamp-glow")
        return CourseMaterial.LampWarm;
    if (MaterialKey === "signal-red")
        return CourseMaterial.TrafficRed;
    if (MaterialKey === "signal-green")
        return CourseMaterial.TrafficGreen;
    if (MaterialKey === "rubber")
        return CourseMaterial.Tyre;
    return CourseMaterial.Concrete;
}

function ResolveDecalLift(MeshKind, MaterialKey)
{
    if (MeshKind === "marking" || MaterialKey === "paint" || MaterialKey === "yellow" || MaterialKey.startsWith("marking-"))
        return 0.010;
    if (MaterialKey === "pave-border" || MeshKind === "gutter" || MaterialKey === "tactile")
        return 0.008;
    if (MeshKind === "cycle" || MeshKind === "bus")
        return 0.006;
    return 0.0;
}

//------------------------------------------------------------------------------------------------------------------------
//                      STARTER IN-LEVEL DEMONSTRATION SHOWCASE & WORLD-SPACE TEMPLATE PLACEMENT
//------------------------------------------------------------------------------------------------------------------------

export function PlaceTemplateInWorld(Project, LevelKey = "inversion")
{
    if (Project.worldSpace)
        return Project;
    let MinX = Infinity;
    for (const N of Project.nodes)
        MinX = Math.min(MinX, N.position[0]);
    const ShiftX = LevelKey === "inversion"
        ? Math.max(360.0, Math.ceil((262.0 - (Number.isFinite(MinX) ? MinX : -85.0)) / 10.0) * 10.0)
        : Math.max(220.0, Math.ceil((135.0 - (Number.isFinite(MinX) ? MinX : -85.0)) / 10.0) * 10.0);
    for (const N of Project.nodes)
        N.position[0] += ShiftX;
    for (const S of Project.sites ?? [])
        S.position[0] += ShiftX;
    Project.worldSpace = true;
    return Project;
}

export function CreateCityPursuitStudioProject()
{
    // Connected Downtown 3×3 City Street Grid + Elevated 4-Lane Highway Overpass (Z = +6.4 m) + Interchange Ramps + East Clover Beltway!
    const Project = {
        version:    1,
        worldSpace: true,
        name:       "City Blocks, Alleys & Highway Interchange",
        nodes:      [],
        roads:      [],
        sites:      []
    };

    const AddWorldNode = (Id, Name, WorldX, WorldY, WorldZ = 0.0, Radius = 8.0, Signals = false, Crossings = false) =>
    {
        const N = makeNode([WorldX, WorldZ, -WorldY], Name);
        N.id = Id;
        N.radius = Radius;
        N.signals = Signals;
        N.crossings = Crossings;
        Project.nodes.push(N);
        return N;
    };

    const AddSpline = (Id, From, To, Name, Settings, H1 = null, H2 = null) =>
    {
        const R = makeRoad(From, To, Name, Settings, H1 ?? undefined, H2 ?? undefined);
        R.id = Id;
        Project.roads.push(R);
        return R;
    };

    // 3×3 Downtown Grid Nodes (X = -150, -55, +40; Y = +90, 0, -90)
    const NW = AddWorldNode("cn_nw", "West & North Junction",   -150.0,   90.0, 0.0, 8.0, false, true);
    const NM = AddWorldNode("cn_nm", "Midtown & North Signal",   -55.0,   90.0, 0.0, 8.5, true,  true);
    const NE = AddWorldNode("cn_ne", "Frontage & North Signal",   40.0,   90.0, 0.0, 8.5, true,  true);

    const CW = AddWorldNode("cn_cw", "West & Central Junction", -150.0,    0.0, 0.0, 8.5, true,  true);
    const CM = AddWorldNode("cn_cm", "Midtown Central Plaza",    -55.0,    0.0, 0.0, 9.5, true,  true);
    const CE = AddWorldNode("cn_ce", "Frontage & Central Signal", 40.0,    0.0, 0.0, 9.5, true,  true);

    const SW = AddWorldNode("cn_sw", "West & South Junction",   -150.0,  -90.0, 0.0, 8.0, false, true);
    const SM = AddWorldNode("cn_sm", "Midtown & South Signal",   -55.0,  -90.0, 0.0, 8.5, true,  true);
    const SE = AddWorldNode("cn_se", "Frontage & South Signal",   40.0,  -90.0, 0.0, 8.5, true,  true);

    // Highway Overpass & Interchange Nodes (X = +105 m overpass above Central Ave; X = +165 m East Clover Beltway)
    const HwN  = AddWorldNode("cn_hwn",  "North Highway Interchange", 105.0,  136.0, 0.0, 9.0, false, false);
    const AbN  = AddWorldNode("cn_abn",  "North Viaduct Abutment",    105.0,   52.0, 6.4, 6.5, false, false);
    const AbS  = AddWorldNode("cn_abs",  "South Viaduct Abutment",    105.0,  -52.0, 6.4, 6.5, false, false);
    const HwS  = AddWorldNode("cn_hws",  "South Highway Interchange", 105.0, -136.0, 0.0, 9.0, false, false);
    const CloverE = AddWorldNode("cn_clv","East Highway Clover",      165.0,    0.0, 0.0, 9.5, true,  false);

    const Urban2L = { lanes: 2, laneWidth: 3.6, sidewalk: 1.8, curbStyle: "granite", markingStyle: "urban", speedLimit: 60, drainage: false, manholes: false, signs: false };
    const Blvd4L  = { lanes: 4, laneWidth: 3.4, median: 1.2, sidewalk: 2.0, curbStyle: "granite", markingStyle: "urban", speedLimit: 60, drainage: false, manholes: false, signs: false };

    // East-West Downtown Avenues
    AddSpline("cr_n1", NW, NM, "North Boulevard West", Urban2L);
    AddSpline("cr_n2", NM, NE, "North Boulevard East", Urban2L);
    AddSpline("cr_c1", CW, CM, "Central Avenue West",  Blvd4L);
    AddSpline("cr_c2", CM, CE, "Central Avenue Mid",   Blvd4L);
    AddSpline("cr_c3", CE, CloverE, "Central Underpass Expressway", Blvd4L);
    AddSpline("cr_s1", SW, SM, "South Boulevard West", Urban2L);
    AddSpline("cr_s2", SM, SE, "South Boulevard East", Urban2L);

    // North-South Cross Streets
    AddSpline("cr_w1", SW, CW, "West Avenue South",    Urban2L);
    AddSpline("cr_w2", CW, NW, "West Avenue North",    Urban2L);
    AddSpline("cr_m1", SM, CM, "Midtown Street South", Urban2L);
    AddSpline("cr_m2", CM, NM, "Midtown Street North", Urban2L);
    AddSpline("cr_f1", SE, CE, "Frontage Road South",  Urban2L);
    AddSpline("cr_f2", CE, NE, "Frontage Road North",  Urban2L);

    // Elevated Highway Overpass (Embankment -> Steel I-Girder Bridge at Z=+6.4m over Central Ave -> Embankment)
    AddSpline("cr_hwrn", HwN, AbN, "North Highway Embankment", {
        lanes: 2, laneWidth: 3.8, shoulderWidth: 1.2, sidewalk: 0.7, markingStyle: "motorway",
        guardrails: true, railStyle: "wbeam", embankment: true, speedLimit: 110, drainage: false, manholes: false, signs: false
    }, [0.0, 1.8, 26.0], [0.0, 0.0, -26.0]);

    AddSpline("cr_hwbr", AbN, AbS, "City Highway Viaduct", {
        lanes: 2, laneWidth: 3.8, shoulderWidth: 1.2, sidewalk: 0.8, markingStyle: "motorway",
        bridge: true, bridgeFrom: 0.0, bridgeTo: 1.0, structure: "steel", bridgeDepth: 1.45, pierSpacing: 26.0,
        guardrails: true, railStyle: "parapet", speedLimit: 110, drainage: false, manholes: false, signs: false
    }, [0.0, 0.0, 32.0], [0.0, 0.0, -32.0]);

    AddSpline("cr_hwrs", AbS, HwS, "South Highway Embankment", {
        lanes: 2, laneWidth: 3.8, shoulderWidth: 1.2, sidewalk: 0.7, markingStyle: "motorway",
        guardrails: true, railStyle: "wbeam", embankment: true, speedLimit: 110, drainage: false, manholes: false, signs: false
    }, [0.0, 0.0, 26.0], [0.0, 1.8, -26.0]);

    // Sweeping Highway Interchange Ramps & Eastern Clover Beltway
    AddSpline("cr_rmpn", NE, HwN, "North Interchange Ramp", {
        lanes: 2, laneWidth: 3.7, shoulderWidth: 1.0, sidewalk: 0.6, markingStyle: "motorway",
        guardrails: true, railStyle: "wbeam", speedLimit: 90, drainage: false, manholes: false, signs: false
    }, [28.0, 0.0, -14.0], [-24.0, 0.0, 18.0]);

    AddSpline("cr_rmps", HwS, SE, "South Interchange Ramp", {
        lanes: 2, laneWidth: 3.7, shoulderWidth: 1.0, sidewalk: 0.6, markingStyle: "motorway",
        guardrails: true, railStyle: "wbeam", speedLimit: 90, drainage: false, manholes: false, signs: false
    }, [-24.0, 0.0, -18.0], [28.0, 0.0, 14.0]);

    AddSpline("cr_clvn", HwN, CloverE, "North-East Clover Beltway", {
        lanes: 2, laneWidth: 3.8, shoulderWidth: 1.1, sidewalk: 0.6, markingStyle: "motorway",
        guardrails: true, railStyle: "wbeam", speedLimit: 110, drainage: false, manholes: false, signs: false
    }, [38.0, 0.0, 12.0], [0.0, 0.0, -48.0]);

    AddSpline("cr_clvs", CloverE, HwS, "South-East Clover Beltway", {
        lanes: 2, laneWidth: 3.8, shoulderWidth: 1.1, sidewalk: 0.6, markingStyle: "motorway",
        guardrails: true, railStyle: "wbeam", speedLimit: 110, drainage: false, manholes: false, signs: false
    }, [0.0, 0.0, 48.0], [38.0, 0.0, -12.0]);

    return Project;
}

export function CreateStarterStudioProject(LevelKey = "inversion")
{
    if (LevelKey === "city")
        return CreateCityPursuitStudioProject();
    if (LevelKey === "dday")
    {
        const Project = { version: 1, worldSpace: true, name: "Atlantic Wall Rear Supply Road", nodes: [], roads: [], sites: [] };
        const W0 = makeNode([186.0, 0.0, -48.0], "Wall Rear North");
        W0.id = "dd_n0";
        const W1 = makeNode([254.0, 0.0,   0.0], "Fortress Logistics Hub");
        W1.id = "dd_n1";
        const W2 = makeNode([186.0, 0.0,  48.0], "Wall Rear South");
        W2.id = "dd_n2";
        Project.nodes.push(W0, W1, W2);
        const R1 = makeRoad(W0, W1, "Coastal Supply North", { lanes: 2, laneWidth: 3.6, sidewalk: 1.0, curbStyle: "granite", markingStyle: "center-only", drainage: false, manholes: false, signs: false });
        R1.id = "dd_r1";
        const R2 = makeRoad(W1, W2, "Coastal Supply South", { lanes: 2, laneWidth: 3.6, sidewalk: 1.0, curbStyle: "granite", markingStyle: "center-only", drainage: false, manholes: false, signs: false });
        R2.id = "dd_r2";
        Project.roads.push(R1, R2);
        return Project;
    }
    // Built-in Live-Editable Demonstration Showcase right in the level:
    // Connects directly into the Arena through the North-East & South-East gateways ([166, +66] & [166, -66]),
    // showcasing cubic Bézier S-curves, a 4-arm tangent-filleted crossroads with hovering traffic signal,
    // a 3-span Steel I-Girder Highway Bridge (+6.2 m) over an underpass avenue, protected cycleways, and race kerbs.
    const ShiftX = LevelKey === "inversion" ? 0.0 : -62.0;
    const Project = {
        version:    1,
        worldSpace: true,
        name:       "Spline & Highway Bridge Demo",
        nodes:      [],
        roads:      [],
        sites:      []
    };

    const AddWorldNode = (Id, Name, WorldX, WorldY, WorldZ = 0.0, Radius = 7.0, Signals = false, Crossings = false) =>
    {
        const N = makeNode([WorldX + ShiftX, WorldZ, -WorldY], Name);
        N.id = Id;
        N.radius = Radius;
        N.signals = Signals;
        N.crossings = Crossings;
        Project.nodes.push(N);
        return N;
    };

    const AddSpline = (Id, From, To, Name, Settings, H1 = null, H2 = null) =>
    {
        const R = makeRoad(From, To, Name, Settings, H1 ?? undefined, H2 ?? undefined);
        R.id = Id;
        Project.roads.push(R);
        return R;
    };

    const NEntryN = AddWorldNode("n01", "Arena North-East Gateway",  166.0,   66.0, 0.0, 7.0, false, false);
    const NCross  = AddWorldNode("n02", "Showcase Crossroads",       272.0,    0.0, 0.0, 9.5, true,  true);
    const NEast   = AddWorldNode("n03", "East Loop Turnaround",      396.0,    0.0, 0.0, 8.5, true,  false);
    const NRampN  = AddWorldNode("n04", "Bridge North Approach",     334.0,   96.0, 0.0, 7.0, false, false);
    const NAbutN  = AddWorldNode("n05", "North Bridge Abutment",     334.0,   38.0, 6.2, 6.0, false, false);
    const NAbutS  = AddWorldNode("n06", "South Bridge Abutment",     334.0,  -38.0, 6.2, 6.0, false, false);
    const NRampS  = AddWorldNode("n07", "Bridge South Approach",     334.0,  -96.0, 0.0, 8.0, false, false);
    const NEntryS = AddWorldNode("n08", "Arena South-East Gateway",  166.0,  -66.0, 0.0, 7.0, false, false);
    const NSouthJ = AddWorldNode("n09", "South Return Junction",     272.0,  -66.0, 0.0, 8.5, true,  true);

    // r01: Sweeping cubic Bézier S-curve from inside the Arena into Showcase Crossroads (enters pure West -> East)
    AddSpline("r01", NEntryN, NCross, "Gateway S-Curve Spline", {
        lanes: 2, laneWidth: 3.6, sidewalk: 2.2, cycleMode: "protected", cycleWidth: 1.8,
        curbStyle: "granite", markingStyle: "urban", pattern: "ashlar", speedLimit: 50, signs: false
    }, [48.0, 0.0, 0.0], [-48.0, 0.0, 0.0]);

    // r02: Underpass Boulevard passing cleanly beneath the +6.2 m Steel I-Girder Highway Bridge
    AddSpline("r02", NCross, NEast, "Underpass Boulevard", {
        lanes: 4, laneWidth: 3.4, median: 1.4, sidewalk: 2.4,
        curbStyle: "granite", markingStyle: "urban", pattern: "linear", speedLimit: 60, signs: false
    }, [40.0, 0.0, 0.0], [-40.0, 0.0, 0.0]);

    // r03 -> r04 -> r05: Connected 3-span Highway Bridge (2:1 North Embankment -> Steel I-Girder Viaduct -> 2:1 South Embankment)
    AddSpline("r03", NRampN, NAbutN, "North Bridge Embankment", {
        lanes: 2, laneWidth: 3.75, shoulderWidth: 1.2, sidewalk: 0.7, markingStyle: "motorway",
        guardrails: true, railStyle: "wbeam", embankment: true, drainage: false, manholes: false, signs: false
    }, [0.0, 1.8, 20.0], [0.0, 0.0, -20.0]);

    AddSpline("r04", NAbutN, NAbutS, "Steel I-Girder Viaduct", {
        lanes: 2, laneWidth: 3.75, shoulderWidth: 1.2, sidewalk: 0.9, markingStyle: "motorway",
        bridge: true, bridgeFrom: 0.0, bridgeTo: 1.0, structure: "steel", bridgeDepth: 1.45, pierSpacing: 25.0,
        guardrails: true, railStyle: "parapet", drainage: false, manholes: false, signs: false
    }, [0.0, 0.0, 25.0], [0.0, 0.0, -25.0]);

    AddSpline("r05", NAbutS, NRampS, "South Bridge Embankment", {
        lanes: 2, laneWidth: 3.75, shoulderWidth: 1.2, sidewalk: 0.7, markingStyle: "motorway",
        guardrails: true, railStyle: "wbeam", embankment: true, drainage: false, manholes: false, signs: false
    }, [0.0, 0.0, 20.0], [0.0, 1.8, -20.0]);

    // r06: Wide 180° Northern Highway Arch leaving Crossroads due North and entering NRampN due South (180° C¹ colinear with r03!)
    AddSpline("r06", NCross, NRampN, "North Bridge Loop", {
        lanes: 2, laneWidth: 3.6, sidewalk: 1.6, markingStyle: "urban",
        guardrails: true, railStyle: "railing", drainage: false, manholes: false, signs: false
    }, [0.0, 0.0, -76.0], [0.0, 0.0, -44.0]);

    // r07: Wide Sweeping East Curve from East Turnaround around the South-East into Bridge South Approach
    AddSpline("r07", NEast, NRampS, "East Sweeper Curve", {
        lanes: 2, laneWidth: 3.75, shoulderWidth: 1.0, sidewalk: 0.8, markingStyle: "motorway",
        guardrails: true, railStyle: "concrete", drainage: false, manholes: false, signs: false
    }, [0.0, 0.0, 56.0], [44.0, 0.0, 0.0]);

    // r08: Wide Southern Arch from Bridge South Approach into South Return Junction
    AddSpline("r08", NRampS, NSouthJ, "South Bridge Loop", {
        lanes: 2, laneWidth: 3.6, sidewalk: 1.6, markingStyle: "urban",
        drainage: false, manholes: false, signs: false
    }, [0.0, 0.0, 38.0], [34.0, 0.0, 24.0]);

    // r09: Orthogonal South-North Connector from South Return Junction up into Showcase Crossroads
    AddSpline("r09", NSouthJ, NCross, "Crossroads South Avenue", {
        lanes: 2, laneWidth: 3.6, sidewalk: 2.0, markingStyle: "urban",
        drainage: false, manholes: false, signs: false
    }, [0.0, 0.0, -22.0], [0.0, 0.0, 22.0]);

    // r10: Grand Prix Red/White Race-Kerb Return Straight back through the South-East Arena Gateway!
    AddSpline("r10", NSouthJ, NEntryS, "Grand Prix Kerb Return", {
        lanes: 2, laneWidth: 4.0, sidewalk: 0.8, curbStyle: "race", markingStyle: "center-only",
        guardrails: true, railStyle: "thrie", drainage: false, manholes: false, signs: false
    }, [-36.0, 0.0, 0.0], [36.0, 0.0, 0.0]);

    return Project;
}

function PrepareProjectForGpuBudget(Project)
{
    const Cloned = JSON.parse(JSON.stringify(Project));
    let ApproxLength = 0.0;
    const NodeMap = new Map(Cloned.nodes.map((N) => [N.id, N]));
    for (const R of Cloned.roads)
    {
        const A = NodeMap.get(R.start);
        const B = NodeMap.get(R.end);
        if (A && B)
            ApproxLength += Math.hypot(B.position[0] - A.position[0], B.position[2] - A.position[2]);
    }
    // On multi-kilometre highway interchanges (cloverleaf, trumpet, diamond, city), widen barrier post intervals
    // on the GPU streaming copy so all decks, girders, piers, bearings, curbs, and rails fit within 262k triangles.
    if (ApproxLength > 1400.0)
    {
        const PostMin = ApproxLength > 4000.0 ? 9.0 : 5.5;
        for (const R of Cloned.roads)
        {
            if (R.guardrails)
                R.postSpacing = Math.max(R.postSpacing ?? 3.4, PostMin);
            if (ApproxLength > 3500.0)
            {
                R.manholes = false;
                R.drainage = false;
            }
        }
    }
    return Cloned;
}

//------------------------------------------------------------------------------------------------------------------------
//                              480 HZ DRIVABLE PHYSICS SURFACES (SPANS + JUNCTIONS)
//------------------------------------------------------------------------------------------------------------------------

function PointInPolygon2D(X, Y, Poly)
{
    let Inside = false;
    for (let I = 0, J = Poly.length - 1; I < Poly.length; J = I++)
    {
        const Xi = Poly[I][0], Yi = Poly[I][1];
        const Xj = Poly[J][0], Yj = Poly[J][1];
        const Intersect = ((Yi > Y) !== (Yj > Y)) &&
                          (X < ((Xj - Xi) * (Y - Yi)) / ((Yj - Yi) || 1.0e-12) + Xi);
        if (Intersect)
            Inside = !Inside;
    }
    return Inside;
}

function BuildSpanPhysicsSurface(Span, Anchor)
{
    const Frames = Span.frames;
    if (!Frames || Frames.length < 2)
        return null;

    const Stations = Frames.map((F) =>
    {
        const Center = StudioPointToWorld(F.p, Anchor);
        const RawTan = StudioDirectionToWorld(F.d);
        const TanLen = Math.hypot(RawTan[0], RawTan[1], RawTan[2]) || 1.0;
        const Tangent = [RawTan[0] / TanLen, RawTan[1] / TanLen, RawTan[2] / TanLen];
        // Studio normal F.n = [-d_z, 0, d_x] maps to World Right = [-F.n[0], F.n[2], 0] or [TangentY, -TangentX, 0]
        const RightXY = StudioDirectionToWorld(F.n);
        const RightLen = Math.hypot(RightXY[0], RightXY[1]) || 1.0;
        const SideAxis = [RightXY[0] / RightLen, RightXY[1] / RightLen];
        const LeftRoad = sideHalfWidth(F, -1);
        const RightRoad = sideHalfWidth(F, 1);
        const Extra = (F.cw ?? 0.16) + (F.sw ?? 0.0);
        return {
            P:         Center,
            Tangent,
            SideAxis,
            CrownRise: surfaceHeight(F),
            Crossfall: (F.crossfall ?? 2.0) * 0.01,
            CurbH:     F.curbHeight ?? 0.14,
            LeftRoad,
            RightRoad,
            LeftFull:  LeftRoad + Extra,
            RightFull: RightRoad + Extra
        };
    });

    let MinX = Infinity, MinY = Infinity, MinZ = Infinity;
    let MaxX = -Infinity, MaxY = -Infinity, MaxZ = -Infinity;
    const SegBounds = [];
    for (let I = 0; I < Stations.length - 1; ++I)
    {
        const A = Stations[I], B = Stations[I + 1];
        const Pad = Math.max(A.LeftFull, A.RightFull, B.LeftFull, B.RightFull) + 1.5;
        const SMinX = Math.min(A.P[0], B.P[0]) - Pad;
        const SMaxX = Math.max(A.P[0], B.P[0]) + Pad;
        const SMinY = Math.min(A.P[1], B.P[1]) - Pad;
        const SMaxY = Math.max(A.P[1], B.P[1]) + Pad;
        const SMinZ = Math.min(A.P[2], B.P[2]) - 1.5;
        const SMaxZ = Math.max(A.P[2], B.P[2]) + A.CrownRise + 2.8;
        SegBounds.push([SMinX, SMinY, SMinZ, SMaxX, SMaxY, SMaxZ]);
        MinX = Math.min(MinX, SMinX); MaxX = Math.max(MaxX, SMaxX);
        MinY = Math.min(MinY, SMinY); MaxY = Math.max(MaxY, SMaxY);
        MinZ = Math.min(MinZ, SMinZ); MaxZ = Math.max(MaxZ, SMaxZ);
    }

    const HasGuardrails = Boolean(Span.road.guardrails);
    const RailHeight = Span.road.railHeight ?? 0.85;

    return {
        Key:          `studio_span_${Span.road.id}`,
        Category:     SurfaceCategory.SplineRoad,
        Origin:       [0.0, 0.0, 0.0],
        CosineYaw:    1.0,
        SineYaw:      0.0,
        Yaw:          0.0,
        Friction:     1.04,
        WorldMinimum: [MinX, MinY, MinZ],
        WorldMaximum: [MaxX, MaxY, MaxZ],
        Bounds:       { Minimum: [MinX, MinY, MinZ], Maximum: [MaxX, MaxY, MaxZ] },
        CastRay(RayOrigin, RayDir, MaxTravel)
        {
            const EndX = RayOrigin[0] + RayDir[0] * MaxTravel;
            const EndY = RayOrigin[1] + RayDir[1] * MaxTravel;
            const EndZ = RayOrigin[2] + RayDir[2] * MaxTravel;
            const RMinX = Math.min(RayOrigin[0], EndX) - 0.35;
            const RMaxX = Math.max(RayOrigin[0], EndX) + 0.35;
            const RMinY = Math.min(RayOrigin[1], EndY) - 0.35;
            const RMaxY = Math.max(RayOrigin[1], EndY) + 0.35;
            const RMinZ = Math.min(RayOrigin[2], EndZ) - 0.35;
            const RMaxZ = Math.max(RayOrigin[2], EndZ) + 0.35;
            if (RMaxX < MinX || RMinX > MaxX || RMaxY < MinY || RMinY > MaxY || RMaxZ < MinZ || RMinZ > MaxZ)
                return null;

            let BestHit = null;
            for (let I = 0; I < Stations.length - 1; ++I)
            {
                const SB = SegBounds[I];
                if (RMaxX < SB[0] || RMinX > SB[3] || RMaxY < SB[1] || RMinY > SB[4] || RMaxZ < SB[2] || RMinZ > SB[5])
                    continue;
                const A = Stations[I], B = Stations[I + 1];
                const SegX = B.P[0] - A.P[0];
                const SegY = B.P[1] - A.P[1];
                const SegLenSq = SegX * SegX + SegY * SegY;
                if (SegLenSq < 1.0e-5)
                    continue;

                // Midpoint plane approximation for ray parameter T, refined once
                const MidZ = 0.5 * (A.P[2] + B.P[2] + A.CrownRise + B.CrownRise);
                let T = Math.abs(RayDir[2]) > 1.0e-5 ? (MidZ - RayOrigin[2]) / RayDir[2] : 0.5 * MaxTravel;
                T = Math.max(0.0, Math.min(MaxTravel, T));
                for (let Pass = 0; Pass < 2; ++Pass)
                {
                    const HX = RayOrigin[0] + RayDir[0] * T;
                    const HY = RayOrigin[1] + RayDir[1] * T;
                    const RawU = ((HX - A.P[0]) * SegX + (HY - A.P[1]) * SegY) / SegLenSq;
                    if (RawU < -0.04 || RawU > 1.04)
                        break;
                    const U = Math.max(0.0, Math.min(1.0, RawU));
                    const CX = A.P[0] + SegX * U;
                    const CY = A.P[1] + SegY * U;
                    const BaseZ = A.P[2] + (B.P[2] - A.P[2]) * U;
                    const Crown = A.CrownRise + (B.CrownRise - A.CrownRise) * U;
                    const CFall = A.Crossfall + (B.Crossfall - A.Crossfall) * U;
                    const SX = A.SideAxis[0] + (B.SideAxis[0] - A.SideAxis[0]) * U;
                    const SY = A.SideAxis[1] + (B.SideAxis[1] - A.SideAxis[1]) * U;
                    const Lat = (HX - CX) * SX + (HY - CY) * SY;
                    const LFull = A.LeftFull + (B.LeftFull - A.LeftFull) * U;
                    const RFull = A.RightFull + (B.RightFull - A.RightFull) * U;
                    if (Lat < -LFull - 0.18 || Lat > RFull + 0.18)
                        break;
                    const LRoad = A.LeftRoad + (B.LeftRoad - A.LeftRoad) * U;
                    const RRoad = A.RightRoad + (B.RightRoad - A.RightRoad) * U;
                    const CurbH = A.CurbH + (B.CurbH - A.CurbH) * U;
                    let SurfZ = BaseZ + Crown - Math.abs(Lat) * CFall;
                    if (Lat < -LRoad)
                    {
                        const EdgeZ = BaseZ + Crown - LRoad * CFall;
                        const Ramp = Math.min(1.0, (-Lat - LRoad) / 0.18);
                        SurfZ = EdgeZ + CurbH * Ramp;
                    }
                    else if (Lat > RRoad)
                    {
                        const EdgeZ = BaseZ + Crown - RRoad * CFall;
                        const Ramp = Math.min(1.0, (Lat - RRoad) / 0.18);
                        SurfZ = EdgeZ + CurbH * Ramp;
                    }
                    if (Pass === 0 && Math.abs(RayDir[2]) > 1.0e-5)
                    {
                        T = (SurfZ - RayOrigin[2]) / RayDir[2];
                        if (T < -0.05 || T > MaxTravel + 0.05)
                            break;
                        T = Math.max(0.0, Math.min(MaxTravel, T));
                    }
                    else
                    {
                        const HZ = RayOrigin[2] + RayDir[2] * T;
                        if (Math.abs(HZ - SurfZ) <= 0.42 && T >= 0.0 && T <= MaxTravel)
                        {
                            const GradeZ = (B.P[2] - A.P[2]) / Math.sqrt(SegLenSq);
                            const Tx = SegX / Math.sqrt(SegLenSq);
                            const Ty = SegY / Math.sqrt(SegLenSq);
                            const LatSlope = Lat >= 0.0 ? -CFall : CFall;
                            let Nx = -Tx * GradeZ - SX * LatSlope;
                            let Ny = -Ty * GradeZ - SY * LatSlope;
                            let Nz = 1.0;
                            const NLen = Math.hypot(Nx, Ny, Nz) || 1.0;
                            Nx /= NLen; Ny /= NLen; Nz /= NLen;
                            if (RayDir[0] * Nx + RayDir[1] * Ny + RayDir[2] * Nz < -1.0e-4 &&
                                (!BestHit || T < BestHit.Travel))
                            {
                                BestHit = {
                                    Travel:      T,
                                    LocalPoint:  [HX, HY, SurfZ],
                                    LocalNormal: [Nx, Ny, Nz]
                                };
                            }
                        }
                    }
                }
            }
            return BestHit;
        },
        QueryHullContact(SphereCenter, SphereRadius)
        {
            if (!HasGuardrails)
                return null;
            if (SphereCenter[0] < MinX - SphereRadius || SphereCenter[0] > MaxX + SphereRadius ||
                SphereCenter[1] < MinY - SphereRadius || SphereCenter[1] > MaxY + SphereRadius)
                return null;
            for (let I = 0; I < Stations.length - 1; ++I)
            {
                const A = Stations[I], B = Stations[I + 1];
                const SegX = B.P[0] - A.P[0], SegY = B.P[1] - A.P[1];
                const SegLenSq = SegX * SegX + SegY * SegY;
                if (SegLenSq < 1.0e-5)
                    continue;
                const RawU = ((SphereCenter[0] - A.P[0]) * SegX + (SphereCenter[1] - A.P[1]) * SegY) / SegLenSq;
                if (RawU < 0.02 || RawU > 0.98)
                    continue;
                const U = RawU;
                const CX = A.P[0] + SegX * U, CY = A.P[1] + SegY * U;
                const BaseZ = A.P[2] + (B.P[2] - A.P[2]) * U + A.CrownRise;
                if (SphereCenter[2] < BaseZ - 0.3 || SphereCenter[2] > BaseZ + RailHeight + SphereRadius)
                    continue;
                const SX = A.SideAxis[0] + (B.SideAxis[0] - A.SideAxis[0]) * U;
                const SY = A.SideAxis[1] + (B.SideAxis[1] - A.SideAxis[1]) * U;
                const Lat = (SphereCenter[0] - CX) * SX + (SphereCenter[1] - CY) * SY;
                const LWall = A.LeftFull + (B.LeftFull - A.LeftFull) * U;
                const RWall = A.RightFull + (B.RightFull - A.RightFull) * U;
                if (Lat < -(LWall - SphereRadius) && Lat > -(LWall + 0.9))
                {
                    return {
                        LocalNormal: [SX, SY, 0.0],
                        Depth:       SphereRadius - (LWall + Lat)
                    };
                }
                if (Lat > (RWall - SphereRadius) && Lat < (RWall + 0.9))
                {
                    return {
                        LocalNormal: [-SX, -SY, 0.0],
                        Depth:       SphereRadius - (RWall - Lat)
                    };
                }
            }
            return null;
        }
    };
}

const DrivableNodeMeshKinds = new Set([
    "asphalt", "paving", "curb", "cycle", "parking", "shoulder", "median"
]);

function BuildNodeMeshPhysicsSurface(NodeId, NodeMeshes, Anchor, FallbackJunction = null)
{
    const Tris = [];
    let MinX = Infinity, MinY = Infinity, MinZ = Infinity;
    let MaxX = -Infinity, MaxY = -Infinity, MaxZ = -Infinity;

    if (NodeMeshes && NodeMeshes.length > 0)
    {
        for (const Mesh of NodeMeshes)
        {
            if (!DrivableNodeMeshKinds.has(Mesh.kind))
                continue;
            const Pos = Mesh.positions;
            const Idx = Mesh.indices;
            for (let T = 0; T + 2 < Idx.length; T += 3)
            {
                const I0 = Idx[T], I1 = Idx[T + 1], I2 = Idx[T + 2];
                const AX = Anchor[0] + Pos[I0 * 3], AY = Anchor[1] - Pos[I0 * 3 + 2], AZ = Anchor[2] + Pos[I0 * 3 + 1];
                const BX = Anchor[0] + Pos[I1 * 3], BY = Anchor[1] - Pos[I1 * 3 + 2], BZ = Anchor[2] + Pos[I1 * 3 + 1];
                const CX = Anchor[0] + Pos[I2 * 3], CY = Anchor[1] - Pos[I2 * 3 + 2], CZ = Anchor[2] + Pos[I2 * 3 + 1];

                const E1X = BX - AX, E1Y = BY - AY, E1Z = BZ - AZ;
                const E2X = CX - AX, E2Y = CY - AY, E2Z = CZ - AZ;
                let NX = E1Y * E2Z - E1Z * E2Y;
                let NY = E1Z * E2X - E1X * E2Z;
                let NZ = E1X * E2Y - E1Y * E2X;
                const NLen = Math.hypot(NX, NY, NZ);
                if (NLen < 1.0e-8)
                    continue;
                NX /= NLen; NY /= NLen; NZ /= NLen;
                // Only upward-facing drivable carriageway, kerb ramp, cycleway & sidewalk triangles (exclude vertical kerb risers)
                if (NZ < 0.62)
                    continue;

                Tris.push({
                    AX, AY, AZ,
                    E1X, E1Y, E1Z,
                    E2X, E2Y, E2Z,
                    NX, NY, NZ,
                    TMinX: Math.min(AX, BX, CX), TMaxX: Math.max(AX, BX, CX),
                    TMinY: Math.min(AY, BY, CY), TMaxY: Math.max(AY, BY, CY)
                });
                MinX = Math.min(MinX, AX, BX, CX); MaxX = Math.max(MaxX, AX, BX, CX);
                MinY = Math.min(MinY, AY, BY, CY); MaxY = Math.max(MaxY, AY, BY, CY);
                MinZ = Math.min(MinZ, AZ, BZ, CZ); MaxZ = Math.max(MaxZ, AZ, BZ, CZ);
            }
        }
    }

    if (Tris.length > 0)
    {
        const GridN = 6;
        const SpanX = Math.max(1.0, MaxX - MinX);
        const SpanY = Math.max(1.0, MaxY - MinY);
        const Buckets = Array.from({ length: GridN * GridN }, () => []);
        for (let K = 0; K < Tris.length; ++K)
        {
            const Tri = Tris[K];
            const GX0 = Math.max(0, Math.min(GridN - 1, Math.floor(((Tri.TMinX - MinX) / SpanX) * GridN)));
            const GX1 = Math.max(0, Math.min(GridN - 1, Math.floor(((Tri.TMaxX - MinX) / SpanX) * GridN)));
            const GY0 = Math.max(0, Math.min(GridN - 1, Math.floor(((Tri.TMinY - MinY) / SpanY) * GridN)));
            const GY1 = Math.max(0, Math.min(GridN - 1, Math.floor(((Tri.TMaxY - MinY) / SpanY) * GridN)));
            for (let GY = GY0; GY <= GY1; ++GY)
                for (let GX = GX0; GX <= GX1; ++GX)
                    Buckets[GY * GridN + GX].push(K);
        }

        const PadMin = [MinX - 0.4, MinY - 0.4, MinZ - 1.0];
        const PadMax = [MaxX + 0.4, MaxY + 0.4, MaxZ + 1.8];
        let StampCounter = 1;
        const TestedStamp = new Int32Array(Tris.length);

        return {
            Key:          `studio_junction_${NodeId}`,
            Category:     SurfaceCategory.SplineRoad,
            Origin:       [0.0, 0.0, 0.0],
            CosineYaw:    1.0,
            SineYaw:      0.0,
            Yaw:          0.0,
            Friction:     1.04,
            WorldMinimum: PadMin,
            WorldMaximum: PadMax,
            Bounds:       { Minimum: PadMin, Maximum: PadMax },
            CastRay(RayOrigin, RayDir, MaxTravel)
            {
                const EndX = RayOrigin[0] + RayDir[0] * MaxTravel;
                const EndY = RayOrigin[1] + RayDir[1] * MaxTravel;
                const EndZ = RayOrigin[2] + RayDir[2] * MaxTravel;
                const RMinX = Math.min(RayOrigin[0], EndX) - 0.15;
                const RMaxX = Math.max(RayOrigin[0], EndX) + 0.15;
                const RMinY = Math.min(RayOrigin[1], EndY) - 0.15;
                const RMaxY = Math.max(RayOrigin[1], EndY) + 0.15;
                const RMinZ = Math.min(RayOrigin[2], EndZ) - 0.15;
                const RMaxZ = Math.max(RayOrigin[2], EndZ) + 0.15;
                if (RMaxX < PadMin[0] || RMinX > PadMax[0] ||
                    RMaxY < PadMin[1] || RMinY > PadMax[1] ||
                    RMaxZ < PadMin[2] || RMinZ > PadMax[2])
                    return null;

                const GX0 = Math.max(0, Math.min(GridN - 1, Math.floor(((RMinX - MinX) / SpanX) * GridN)));
                const GX1 = Math.max(0, Math.min(GridN - 1, Math.floor(((RMaxX - MinX) / SpanX) * GridN)));
                const GY0 = Math.max(0, Math.min(GridN - 1, Math.floor(((RMinY - MinY) / SpanY) * GridN)));
                const GY1 = Math.max(0, Math.min(GridN - 1, Math.floor(((RMaxY - MinY) / SpanY) * GridN)));

                const Stamp = (StampCounter = (StampCounter + 1) | 0) || (StampCounter = 1);
                let BestHit = null;

                for (let GY = GY0; GY <= GY1; ++GY)
                {
                    for (let GX = GX0; GX <= GX1; ++GX)
                    {
                        const Cell = Buckets[GY * GridN + GX];
                        for (let C = 0; C < Cell.length; ++C)
                        {
                            const K = Cell[C];
                            if (TestedStamp[K] === Stamp)
                                continue;
                            TestedStamp[K] = Stamp;
                            const Tri = Tris[K];
                            if (RayDir[0] * Tri.NX + RayDir[1] * Tri.NY + RayDir[2] * Tri.NZ >= -1.0e-5)
                                continue;

                            // Möller–Trumbore ray-triangle intersection with tiny edge-seam tolerance
                            const PX = RayDir[1] * Tri.E2Z - RayDir[2] * Tri.E2Y;
                            const PY = RayDir[2] * Tri.E2X - RayDir[0] * Tri.E2Z;
                            const PZ = RayDir[0] * Tri.E2Y - RayDir[1] * Tri.E2X;
                            const Det = Tri.E1X * PX + Tri.E1Y * PY + Tri.E1Z * PZ;
                            if (Math.abs(Det) < 1.0e-9)
                                continue;
                            const InvDet = 1.0 / Det;
                            const TX = RayOrigin[0] - Tri.AX;
                            const TY = RayOrigin[1] - Tri.AY;
                            const TZ = RayOrigin[2] - Tri.AZ;
                            const U = (TX * PX + TY * PY + TZ * PZ) * InvDet;
                            if (U < -2.0e-3 || U > 1.002)
                                continue;
                            const QX = TY * Tri.E1Z - TZ * Tri.E1Y;
                            const QY = TZ * Tri.E1X - TX * Tri.E1Z;
                            const QZ = TX * Tri.E1Y - TY * Tri.E1X;
                            const V = (RayDir[0] * QX + RayDir[1] * QY + RayDir[2] * QZ) * InvDet;
                            if (V < -2.0e-3 || U + V > 1.002)
                                continue;
                            const T = (Tri.E2X * QX + Tri.E2Y * QY + Tri.E2Z * QZ) * InvDet;
                            if (T >= 0.0 && T <= MaxTravel && (!BestHit || T < BestHit.Travel))
                            {
                                BestHit = {
                                    Travel:      T,
                                    LocalPoint:  [
                                        RayOrigin[0] + RayDir[0] * T,
                                        RayOrigin[1] + RayDir[1] * T,
                                        RayOrigin[2] + RayDir[2] * T
                                    ],
                                    LocalNormal: [Tri.NX, Tri.NY, Tri.NZ]
                                };
                            }
                        }
                    }
                }
                return BestHit;
            }
        };
    }

    if (!FallbackJunction)
        return null;
    const Ring = (FallbackJunction.outer && FallbackJunction.outer.length >= 3) ? FallbackJunction.outer : FallbackJunction.boundary;
    if (!Ring || Ring.length < 3)
        return null;
    const Poly2D = [];
    for (const P of Ring)
    {
        const W = StudioPointToWorld(P, Anchor);
        Poly2D.push([W[0], W[1]]);
        MinX = Math.min(MinX, W[0]); MaxX = Math.max(MaxX, W[0]);
        MinY = Math.min(MinY, W[1]); MaxY = Math.max(MaxY, W[1]);
        MinZ = Math.min(MinZ, W[2]); MaxZ = Math.max(MaxZ, W[2]);
    }
    const NodeW = StudioPointToWorld(FallbackJunction.node.position, Anchor);
    const CenterZ = NodeW[2] + 0.12;
    return {
        Key:          `studio_junction_${NodeId}`,
        Category:     SurfaceCategory.SplineRoad,
        Origin:       [0.0, 0.0, 0.0],
        CosineYaw:    1.0,
        SineYaw:      0.0,
        Yaw:          0.0,
        Friction:     1.04,
        WorldMinimum: [MinX - 0.5, MinY - 0.5, CenterZ - 1.2],
        WorldMaximum: [MaxX + 0.5, MaxY + 0.5, CenterZ + 1.8],
        Bounds:       { Minimum: [MinX - 0.5, MinY - 0.5, CenterZ - 1.2], Maximum: [MaxX + 0.5, MaxY + 0.5, CenterZ + 1.8] },
        CastRay(RayOrigin, RayDir, MaxTravel)
        {
            if (RayDir[2] >= -1.0e-5)
                return null;
            const T = (CenterZ - RayOrigin[2]) / RayDir[2];
            if (T < 0.0 || T > MaxTravel)
                return null;
            const HX = RayOrigin[0] + RayDir[0] * T;
            const HY = RayOrigin[1] + RayDir[1] * T;
            if (!PointInPolygon2D(HX, HY, Poly2D))
                return null;
            return { Travel: T, LocalPoint: [HX, HY, CenterZ], LocalNormal: [0.0, 0.0, 1.0] };
        }
    };
}

//------------------------------------------------------------------------------------------------------------------------
//                          MAIN COMPILER: PROJECT -> WEBGPU VERTEXRECORDS + PHYSICS + SIGNALS
//------------------------------------------------------------------------------------------------------------------------

export function CompileStudioProjectForWorld(Project, Options = {})
{
    const LevelKey = Options.LevelKey ?? "inversion";
    const VertexCapacity = Options.VertexCapacity ?? RoadStudioVertexCapacity;
    const Prepared = PrepareProjectForGpuBudget(Project);
    const Network = buildNetwork(Prepared, { detail: "editing" });
    const Anchor = Options.Anchor ?? (Project.worldSpace ? [0.0, 0.0, 0.0] : ComputeWorldAnchorForBounds(Network.bounds, LevelKey));

    // Sort meshes so essential road/bridge/curb/paving/marking/barrier geometry always streams first
    const OrderedMeshes = [...Network.meshes].sort((A, B) =>
    {
        const PA = MeshKindPriority[A.kind] ?? 20;
        const PB = MeshKindPriority[B.kind] ?? 20;
        return PA - PB;
    });

    const RawBytes = new ArrayBuffer(VertexCapacity * 32);
    const VertexScalars = new Float32Array(RawBytes);
    const VertexIntegers = new Uint32Array(RawBytes);
    let VertexCount = 0;

    for (const Mesh of OrderedMeshes)
    {
        const Pos = Mesh.positions;
        const Uvs = Mesh.uvs;
        const Idx = Mesh.indices;
        const Lift = ResolveDecalLift(Mesh.kind, Mesh.material);
        const IsRaceCurb = Mesh.material === "race-curb";
        const FixedMaterial = IsRaceCurb ? 0 : ResolveCourseMaterial(Mesh.kind, Mesh.material, 0.0);

        for (let T = 0; T + 2 < Idx.length; T += 3)
        {
            if (VertexCount + 3 > VertexCapacity)
                break;
            const I0 = Idx[T], I1 = Idx[T + 1], I2 = Idx[T + 2];
            const P0X = Anchor[0] + Pos[I0 * 3],     P0Y = Anchor[1] - Pos[I0 * 3 + 2], P0Z = Anchor[2] + Pos[I0 * 3 + 1];
            const P1X = Anchor[0] + Pos[I1 * 3],     P1Y = Anchor[1] - Pos[I1 * 3 + 2], P1Z = Anchor[2] + Pos[I1 * 3 + 1];
            const P2X = Anchor[0] + Pos[I2 * 3],     P2Y = Anchor[1] - Pos[I2 * 3 + 2], P2Z = Anchor[2] + Pos[I2 * 3 + 1];

            const UX = P1X - P0X, UY = P1Y - P0Y, UZ = P1Z - P0Z;
            const VX = P2X - P0X, VY = P2Y - P0Y, VZ = P2Z - P0Z;
            let NX = UY * VZ - UZ * VY;
            let NY = UZ * VX - UX * VZ;
            let NZ = UX * VY - UY * VX;
            const NLen = Math.hypot(NX, NY, NZ);
            if (NLen < 1.0e-9)
                continue;
            NX /= NLen; NY /= NLen; NZ /= NLen;

            const Mat = (IsRaceCurb
                ? ResolveCourseMaterial(Mesh.kind, Mesh.material, ((Uvs[I0 * 2] ?? 0) + (Uvs[I1 * 2] ?? 0) + (Uvs[I2 * 2] ?? 0)) / 3.0)
                : FixedMaterial) >>> 0;

            const LX = NX * Lift, LY = NY * Lift, LZ = NZ * Lift;
            let Base = VertexCount * 8;
            VertexScalars[Base]      = P0X + LX; VertexScalars[Base + 1]  = P0Y + LY; VertexScalars[Base + 2] = P0Z + LZ; VertexIntegers[Base + 3] = Mat;
            VertexScalars[Base + 4]  = NX;       VertexScalars[Base + 5]  = NY;       VertexScalars[Base + 6] = NZ;       VertexIntegers[Base + 7] = 0;
            Base += 8;
            VertexScalars[Base]      = P1X + LX; VertexScalars[Base + 1]  = P1Y + LY; VertexScalars[Base + 2] = P1Z + LZ; VertexIntegers[Base + 3] = Mat;
            VertexScalars[Base + 4]  = NX;       VertexScalars[Base + 5]  = NY;       VertexScalars[Base + 6] = NZ;       VertexIntegers[Base + 7] = 0;
            Base += 8;
            VertexScalars[Base]      = P2X + LX; VertexScalars[Base + 1]  = P2Y + LY; VertexScalars[Base + 2] = P2Z + LZ; VertexIntegers[Base + 3] = Mat;
            VertexScalars[Base + 4]  = NX;       VertexScalars[Base + 5]  = NY;       VertexScalars[Base + 6] = NZ;       VertexIntegers[Base + 7] = 0;
            VertexCount += 3;
        }
        if (VertexCount + 3 > VertexCapacity)
            break;
    }

    const PhysicsSurfaces = [];
    for (const Span of Network.spans)
    {
        const Surf = BuildSpanPhysicsSurface(Span, Anchor);
        if (Surf)
            PhysicsSurfaces.push(Surf);
    }

    // Group node meshes (both at-grade junctions AND elevated bridgeJoints!) by owner node id
    const NodeMeshesById = new Map();
    for (const Mesh of Network.meshes)
    {
        if (Mesh.ownerKind !== "node")
            continue;
        let List = NodeMeshesById.get(Mesh.owner);
        if (!List)
        {
            List = [];
            NodeMeshesById.set(Mesh.owner, List);
        }
        List.push(Mesh);
    }
    const JuncById = new Map(Network.junctions.map((J) => [J.node.id, J]));
    const AllNodeIds = new Set([...NodeMeshesById.keys(), ...JuncById.keys()]);
    for (const NodeId of AllNodeIds)
    {
        const Surf = BuildNodeMeshPhysicsSurface(NodeId, NodeMeshesById.get(NodeId), Anchor, JuncById.get(NodeId));
        if (Surf)
            PhysicsSurfaces.push(Surf);
    }

    // Spawn Pole-less Hovering Robotic 4-Aspect Traffic Lights above signalized / major 3+ arm urban junctions
    const DynamicSignals = [];
    for (const Junc of Network.junctions)
    {
        if (DynamicSignals.length >= 6)
            break;
        const WantsSignal = Boolean(Junc.node.signals) ||
                            (Junc.arms.length >= 3 && Junc.arms.some((A) => A.road.markingStyle === "urban"));
        if (!WantsSignal)
            continue;
        const W = StudioPointToWorld(Junc.node.position, Anchor);
        const LeadArm = Junc.arms[0];
        const ArmDir = LeadArm ? StudioDirectionToWorld(LeadArm.d) : [1.0, 0.0, 0.0];
        DynamicSignals.push({
            Id:          `tl_studio_${Junc.node.id}`,
            Name:        `${Junc.node.name} Hover Signal`,
            Position:    [W[0], W[1], W[2]],
            Yaw:         Math.atan2(ArmDir[1], ArmDir[0]),
            PhaseOffset: DynamicSignals.length * 3.8
        });
    }

    return {
        Network,
        Anchor,
        Vertices: VertexScalars.subarray(0, VertexCount * 8),
        VertexCount,
        TriangleCount: Math.floor(VertexCount / 3),
        PhysicsSurfaces,
        DynamicSignals
    };
}

export function ResolveSpawnPoseForSelection(Compiled, Project, Selection = null)
{
    const { Network, Anchor } = Compiled;
    if (Selection && Selection.kind === "road")
    {
        const Span = Network.spans.find((S) => S.road.id === Selection.id);
        if (Span && Span.frames.length >= 2)
        {
            const Idx = Math.min(Math.floor(Span.frames.length * 0.25), Span.frames.length - 1);
            const F = Span.frames[Idx];
            const W = StudioPointToWorld(F.p, Anchor);
            const D = StudioDirectionToWorld(F.d);
            return {
                Name:     Span.road.name,
                Position: [W[0], W[1], W[2] + surfaceHeight(F) + 0.68],
                YawRad:   Math.atan2(D[1], D[0])
            };
        }
    }
    if (Selection && Selection.kind === "node")
    {
        const Node = Project.nodes.find((N) => N.id === Selection.id);
        if (Node)
        {
            const W = StudioPointToWorld(Node.position, Anchor);
            const Junc = Network.junctions.find((J) => J.node.id === Node.id);
            const Dir = Junc?.arms[0] ? StudioDirectionToWorld(Junc.arms[0].d) : [1.0, 0.0, 0.0];
            return {
                Name:     Node.name,
                Position: [W[0], W[1], W[2] + 0.80],
                YawRad:   Math.atan2(Dir[1], Dir[0])
            };
        }
    }
    // Prefer an elevated bridge span if present so "Drive on Network" showcases bridges immediately!
    const BridgeSpan = Network.spans.find((S) => S.road.bridge && S.frames.length >= 3) || Network.spans[0];
    if (BridgeSpan && BridgeSpan.frames.length >= 2)
    {
        const Idx = Math.floor(BridgeSpan.frames.length * 0.5);
        const F = BridgeSpan.frames[Idx];
        const W = StudioPointToWorld(F.p, Anchor);
        const D = StudioDirectionToWorld(F.d);
        return {
            Name:     BridgeSpan.road.name,
            Position: [W[0], W[1], W[2] + surfaceHeight(F) + 0.68],
            YawRad:   Math.atan2(D[1], D[0])
        };
    }
    return {
        Name:     Project.name || "Road Studio Network",
        Position: [Anchor[0], Anchor[1], Anchor[2] + 0.80],
        YawRad:   0.0
    };
}
