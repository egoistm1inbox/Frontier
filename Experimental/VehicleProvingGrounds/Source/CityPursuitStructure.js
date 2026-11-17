//============================================================================================================================================
//                                                        CITYPURSUITSTRUCTURE.JS
//============================================================================================================================================
// 🧩 Dedicated "City Pursuit & AI Lab" ("city") level geometry & police pursuit shape library:
//    • 4 Downtown City Superblocks subdivided by 9 m-wide cross-shaped escape alleys + overhead skybridge cover
//    • Watertight 2-manifold architectural block buildings, alley props, Police Helicopter (body + rotors), and Police Interceptor Drones
//    • Police Cruiser livery & roof Red/Blue lightbar + PIT push-bumper built directly onto the exact ControlVehicle body
//    • Analytical speed-limit zones (60 km/h City, 40 km/h Alleys, 110 km/h Highway) & road centerline query for fast RL self-training.

import { CourseMaterial } from "./MaterialSpecification.js";
import { EmitBoxFacets } from "./CourseStructure.js";
import { ConstructCabinFacets } from "./CabinStructure.js";
import { ResolveCoMAuthoredZ } from "./VehicleSpecification.js";
import { EmitConstructionDrumFacets } from "./SignageBuilder.js";
import { ConstructTrafficLightShapes } from "./TrafficLightSequence.js";

//------------------------------------------------------------------------------------------------------------------------
//                                  WATERTIGHT 2-MANIFOLD PRIMITIVE HELPERS
//------------------------------------------------------------------------------------------------------------------------

function EmitTranslatedBox(CX, CY, CZ, SX, SY, SZ, Material)
{
    const Raw = EmitBoxFacets(SX, SY, SZ, Material);
    return Raw.map((F) => ({
        Family:  F.Family,
        Corners: F.Corners.map((P) => [P[0] + CX, P[1] + CY, P[2] + CZ + 0.5 * SZ])
    }));
}

// 📝 Watertight stepped architectural block building: disjoint plinth, main shaft, and rooftop penthouse (separated by 12 mm gaps).
function EmitBlockBuildingFacets(WidthX, DepthY, HeightZ, FacadeMat, AccentMat, RoofMat = CourseMaterial.SteelDark)
{
    const Out = [];
    const PlinthH = 3.6;
    const MainH   = Math.max(4.0, HeightZ - PlinthH - 1.6);
    // ① Ground-floor granite/steel lobby plinth
    Out.push(...EmitTranslatedBox(0.0, 0.0, 0.0, WidthX, DepthY, PlinthH, CourseMaterial.SteelDark));
    // ② Main architectural block massing (14 mm vertical separation keeps every sub-box a strict disjoint closed 2-manifold)
    Out.push(...EmitTranslatedBox(0.0, 0.0, PlinthH + 0.014, WidthX - 0.36, DepthY - 0.36, MainH, FacadeMat));
    // ③ Horizontal architectural crown band
    const TopZ = PlinthH + 0.014 + MainH + 0.014;
    Out.push(...EmitTranslatedBox(0.0, 0.0, TopZ, WidthX - 0.16, DepthY - 0.16, 0.72, AccentMat));
    // ④ Rooftop mechanical penthouse
    Out.push(...EmitTranslatedBox(0.0, 0.0, TopZ + 0.734, WidthX * 0.44, DepthY * 0.44, 1.45, RoofMat));
    return Out;
}

// 📝 Overhead alley skybridge spanning between adjacent block buildings (provides helicopter LOS cover inside alleys!).
function EmitAlleySkybridgeFacets()
{
    const Out = [];
    // Spanning Y across a 9 m alley at Z = 5.4 m .. 7.4 m (plenty of clearance for cars & police drones underneath!)
    Out.push(...EmitTranslatedBox(0.0, 0.0, 5.40, 5.2, 8.6, 1.85, CourseMaterial.TunnelConcrete));
    Out.push(...EmitTranslatedBox(0.0, 0.0, 7.27, 5.5, 8.6, 0.24, CourseMaterial.SteelDark));
    return Out;
}

//------------------------------------------------------------------------------------------------------------------------
//                      POLICE HELICOPTER & POLICE INTERCEPTOR DRONE 2-MANIFOLD SOLIDS
//------------------------------------------------------------------------------------------------------------------------

export function EmitPoliceHelicopterBodyFacets()
{
    const Out = [];
    // ① Twin tubular landing skids & struts (disjoint by >= 12 mm)
    for (const Side of [-0.78, 0.78])
    {
        Out.push(...EmitTranslatedBox(0.10, Side, 0.00, 3.20, 0.10, 0.10, CourseMaterial.SteelDark));
        Out.push(...EmitTranslatedBox( 0.85, Side * 0.82, 0.12, 0.12, 0.10, 0.44, CourseMaterial.SteelDark));
        Out.push(...EmitTranslatedBox(-0.75, Side * 0.82, 0.12, 0.12, 0.10, 0.44, CourseMaterial.SteelDark));
    }
    // ② Law-enforcement white-and-midnight fuselage cabin + glazed nose cockpit
    Out.push(...EmitTranslatedBox( 0.15, 0.0, 0.58, 3.30, 1.48, 1.18, CourseMaterial.PaintWhite));
    Out.push(...EmitTranslatedBox( 1.98, 0.0, 0.72, 0.78, 1.24, 0.82, CourseMaterial.VehicleGlass));
    Out.push(...EmitTranslatedBox( 0.10, 0.0, 1.78, 1.85, 0.92, 0.36, CourseMaterial.WallCobalt));
    // ③ Under-nose high-intensity gimbal searchlight pod + red/blue belly beacons
    Out.push(...EmitTranslatedBox( 1.95, 0.0, 0.26, 0.38, 0.34, 0.28, CourseMaterial.Headlight));
    Out.push(...EmitTranslatedBox(-0.45,  0.52, 0.44, 0.30, 0.18, 0.10, CourseMaterial.TrafficRed));
    Out.push(...EmitTranslatedBox(-0.45, -0.52, 0.44, 0.30, 0.18, 0.10, CourseMaterial.DerezGlow));
    // ④ Tail boom & swept vertical stabilizer fin
    Out.push(...EmitTranslatedBox(-2.85, 0.0, 1.14, 2.62, 0.38, 0.38, CourseMaterial.SteelDark));
    Out.push(...EmitTranslatedBox(-4.18, 0.0, 1.10, 0.56, 0.14, 1.28, CourseMaterial.PaintWhite));
    return Out;
}

export function EmitPoliceHelicopterMainRotorFacets()
{
    const Out = [];
    Out.push(...EmitTranslatedBox(0.0, 0.0, 0.00, 0.36, 0.36, 0.18, CourseMaterial.SteelDark));
    Out.push(...EmitTranslatedBox(0.0, 0.0, 0.20, 7.60, 0.26, 0.05, CourseMaterial.SteelDark));
    Out.push(...EmitTranslatedBox(0.0, 0.0, 0.27, 0.26, 7.60, 0.05, CourseMaterial.PaintWhite));
    return Out;
}

export function EmitPoliceHelicopterTailRotorFacets()
{
    const Out = [];
    Out.push(...EmitTranslatedBox(0.0, 0.0, -0.68, 1.36, 0.06, 0.16, CourseMaterial.SteelDark));
    Out.push(...EmitTranslatedBox(0.0, 0.08, -0.68, 0.16, 0.06, 1.36, CourseMaterial.KerbRed));
    return Out;
}

export function EmitPoliceInterceptorDroneFacets()
{
    const Out = [];
    // Armored tactical pursuit chassis + red/blue pursuit strobes + 4 rotor shrouds
    Out.push(...EmitTranslatedBox(0.0, 0.0, 0.08, 0.76, 0.56, 0.22, CourseMaterial.SteelDark));
    Out.push(...EmitTranslatedBox(0.18,  0.18, 0.32, 0.28, 0.16, 0.08, CourseMaterial.TrafficRed));
    Out.push(...EmitTranslatedBox(0.18, -0.18, 0.32, 0.28, 0.16, 0.08, CourseMaterial.DerezGlow));
    Out.push(...EmitTranslatedBox(0.42, 0.0, 0.12, 0.12, 0.22, 0.12, CourseMaterial.Headlight));
    for (const [DX, DY] of [[0.46, 0.44], [0.46, -0.44], [-0.46, 0.44], [-0.46, -0.44]])
        Out.push(...EmitTranslatedBox(DX, DY, 0.14, 0.36, 0.36, 0.08, CourseMaterial.PaintWhite));
    return Out;
}

//------------------------------------------------------------------------------------------------------------------------
//                   POLICE INTERCEPTOR CRUISER (EXACT SAME CONTROLVEHICLE + LIGHTBAR & PUSH-BAR)
//------------------------------------------------------------------------------------------------------------------------

export function ConstructPoliceVehicleBodyFacets(ProjectedBodyFacets)
{
    const Rebase = ResolveCoMAuthoredZ();
    // Remap BodyCoat into high-contrast Black-and-White Police Interceptor livery!
    const LiveryFacets = ProjectedBodyFacets.map((F) =>
    {
        if (F.Family !== CourseMaterial.BodyCoat)
            return F;
        const AvgX = (F.Corners[0][0] + F.Corners[1][0] + F.Corners[2][0]) / 3.0;
        const AvgZ = (F.Corners[0][2] + F.Corners[1][2] + F.Corners[2][2]) / 3.0;
        const IsWhiteDoorOrRoof = (AvgX > -0.78 && AvgX < 0.92) || AvgZ > (1.05 - Rebase);
        return {
            ...F,
            Family: IsWhiteDoorOrRoof ? CourseMaterial.PaintWhite : CourseMaterial.SteelDark
        };
    });

    const AddBodyBox = (CX, CY, CZAuthored, SX, SY, SZ, Family) =>
    {
        for (const F of EmitBoxFacets(SX, SY, SZ, Family))
        {
            LiveryFacets.push({
                Family,
                Corners: F.Corners.map((P) => [P[0] + CX, P[1] + CY, P[2] + CZAuthored - Rebase])
            });
        }
    };

    // ① Roof Police Red/Blue Emergency Lightbar (left/driver side Crimson Red, right/passenger side Cobalt/Cyan Blue)
    AddBodyBox(0.12,  0.38, 1.36, 0.14, 0.06, 0.05, CourseMaterial.SteelDark);
    AddBodyBox(0.12, -0.38, 1.36, 0.14, 0.06, 0.05, CourseMaterial.SteelDark);
    AddBodyBox(0.12,  0.00, 1.40, 0.18, 0.18, 0.07, CourseMaterial.VehiclePlastic);
    AddBodyBox(0.12,  0.30, 1.40, 0.18, 0.38, 0.075, CourseMaterial.TrafficRed);
    AddBodyBox(0.12, -0.30, 1.40, 0.18, 0.38, 0.075, CourseMaterial.DerezGlow);

    // ② Front Heavy-Duty Steel PIT Push-Bumper (bullbar)
    AddBodyBox(2.36,  0.34, 0.48, 0.10, 0.06, 0.44, CourseMaterial.SteelDark);
    AddBodyBox(2.36, -0.34, 0.48, 0.10, 0.06, 0.44, CourseMaterial.SteelDark);
    AddBodyBox(2.40,  0.00, 0.56, 0.07, 0.82, 0.07, CourseMaterial.SteelDark);
    AddBodyBox(2.40,  0.00, 0.36, 0.07, 0.82, 0.07, CourseMaterial.SteelDark);

    return [...LiveryFacets, ...ConstructCabinFacets()];
}

export const PolicePursuitShapes = Object.freeze({
    PoliceHelicopterBody:      { Emit: EmitPoliceHelicopterBodyFacets,      Voxel: 0.12, Cards: 12.0, Distance: false },
    PoliceHelicopterMainRotor: { Emit: EmitPoliceHelicopterMainRotorFacets, Voxel: 0.12, Cards: 8.0,  Distance: false },
    PoliceHelicopterTailRotor: { Emit: EmitPoliceHelicopterTailRotorFacets, Voxel: 0.08, Cards: 8.0,  Distance: false },
    PoliceInterceptorDrone:    { Emit: EmitPoliceInterceptorDroneFacets,    Voxel: 0.08, Cards: 10.0, Distance: false }
});

//------------------------------------------------------------------------------------------------------------------------
//                         CITY PURSUIT & AI LAB ("city") BLOCKS, ALLEYS & WAYPOINT GRAPH
//------------------------------------------------------------------------------------------------------------------------

export const CityPursuitShapes = Object.freeze({
    CityBlockLow:       { Emit: () => EmitBlockBuildingFacets(31.0, 26.0, 13.5, CourseMaterial.Concrete,        CourseMaterial.PaintWhite), Voxel: 0.30, Cards: 10.0 },
    CityBlockMid:       { Emit: () => EmitBlockBuildingFacets(31.0, 26.0, 20.5, CourseMaterial.WallChalk,       CourseMaterial.WallCobalt), Voxel: 0.32, Cards: 10.0 },
    CityBlockTall:      { Emit: () => EmitBlockBuildingFacets(31.0, 26.0, 28.0, CourseMaterial.ApronConcrete,   CourseMaterial.BannerAmber), Voxel: 0.35, Cards: 10.0 },
    CityBlockTower:     { Emit: () => EmitBlockBuildingFacets(28.0, 24.0, 35.0, CourseMaterial.TunnelConcrete,  CourseMaterial.WallCrimson), Voxel: 0.38, Cards: 10.0 },
    CityAlleySkybridge: { Emit: EmitAlleySkybridgeFacets,                                                                                   Voxel: 0.18, Cards: 12.0 },
    ConstructionDrum:   { Emit: EmitConstructionDrumFacets,                                                                                 Voxel: 0.05, Cards: 12.0 },
    ...ConstructTrafficLightShapes(),
    ...PolicePursuitShapes
});

// 📝 4 Downtown Superblocks: each split by a 10 m-wide North-South alley and a 10 m-wide East-West alley!
//    Block NW: X ∈ [-142, -63], Y ∈ [14, 80]  (Alley X = -102.5, Alley Y = 47.0)
//    Block NE: X ∈ [-47,  +32], Y ∈ [14, 80]  (Alley X = -7.5,   Alley Y = 47.0)
//    Block SW: X ∈ [-142, -63], Y ∈ [-80, -14] (Alley X = -102.5, Alley Y = -47.0)
//    Block SE: X ∈ [-47,  +32], Y ∈ [-80, -14] (Alley X = -7.5,   Alley Y = -47.0)
export const CityAlleyCorridors = Object.freeze([
    // East-West alleys (with overhead skybridges -> block Helicopter LOS!)
    { Id: "alley_nw_ew", MinX: -143.0, MaxX: -62.0, MinY:  41.5, MaxY:  52.5, Axis: "X", Covered: true },
    { Id: "alley_ne_ew", MinX:  -48.0, MaxX:  33.0, MinY:  41.5, MaxY:  52.5, Axis: "X", Covered: true },
    { Id: "alley_sw_ew", MinX: -143.0, MaxX: -62.0, MinY: -52.5, MaxY: -41.5, Axis: "X", Covered: true },
    { Id: "alley_se_ew", MinX:  -48.0, MaxX:  33.0, MinY: -52.5, MaxY: -41.5, Axis: "X", Covered: true },
    // North-South alleys
    { Id: "alley_nw_ns", MinX: -108.0, MaxX: -97.0, MinY:  13.0, MaxY:  81.0, Axis: "Y", Covered: false },
    { Id: "alley_ne_ns", MinX:  -13.0, MaxX:  -2.0, MinY:  13.0, MaxY:  81.0, Axis: "Y", Covered: false },
    { Id: "alley_sw_ns", MinX: -108.0, MaxX: -97.0, MinY: -81.0, MaxY: -13.0, Axis: "Y", Covered: false },
    { Id: "alley_se_ns", MinX:  -13.0, MaxX:  -2.0, MinY: -81.0, MaxY: -13.0, Axis: "Y", Covered: false }
]);

// 📝 Checks if world point [X, Y, Z] is sheltered from overhead helicopter searchlight (inside narrow alley or under highway bridge).
export function IsPointOccludedFromHelicopter(Position)
{
    const [X, Y, Z] = Position;
    // Under the X = +105 m Elevated Steel I-Girder Highway Overpass along Central Ave
    if (Math.abs(X - 105.0) < 12.0 && Math.abs(Y) < 48.0 && Z < 4.5)
        return true;
    for (const Alley of CityAlleyCorridors)
    {
        if (X >= Alley.MinX && X <= Alley.MaxX && Y >= Alley.MinY && Y <= Alley.MaxY && Z < 4.8)
            return true;
    }
    return false;
}

// 📝 Posted speed limit [km/h] by road class: 110 km/h on Highway/Beltway, 40 km/h in Back Alleys, 60 km/h on Downtown Streets.
export function QueryCitySpeedLimitKmh(Position)
{
    const [X, Y, Z] = Position;
    if (Z > 2.2 || X > 78.0)
        return 110;
    for (const Alley of CityAlleyCorridors)
    {
        if (X >= Alley.MinX && X <= Alley.MaxX && Y >= Alley.MinY && Y <= Alley.MaxY)
            return 40;
    }
    return 60;
}

// 📝 Analytical road/alley/highway segment table for fast O(1) RL state observation (tangent alignment + cross-track error).
export const CityRoadSegments = Object.freeze([
    // East-West Avenues
    { A: [-150,   0], B: [ 165,   0], SpeedLimit: 60 },
    { A: [-150,  90], B: [  40,  90], SpeedLimit: 60 },
    { A: [-150, -90], B: [  40, -90], SpeedLimit: 60 },
    // North-South Streets
    { A: [-150, -90], B: [-150,  90], SpeedLimit: 60 },
    { A: [ -55, -90], B: [ -55,  90], SpeedLimit: 60 },
    { A: [  40, -90], B: [  40,  90], SpeedLimit: 60 },
    // Highway Overpass & Beltway Loop
    { A: [ 105, -136], B: [ 105, 136], SpeedLimit: 110 },
    { A: [  40,   90], B: [ 105, 136], SpeedLimit: 90 },
    { A: [ 105, -136], B: [  40, -90], SpeedLimit: 90 },
    { A: [ 105,  136], B: [ 165,   0], SpeedLimit: 110 },
    { A: [ 165,    0], B: [ 105,-136], SpeedLimit: 110 },
    // Escape Alleys
    { A: [-150,  47], B: [  40,  47], SpeedLimit: 40 },
    { A: [-150, -47], B: [  40, -47], SpeedLimit: 40 },
    { A: [-102.5, -90], B: [-102.5, 90], SpeedLimit: 40 },
    { A: [  -7.5, -90], B: [  -7.5, 90], SpeedLimit: 40 }
]);

export function QueryNearestCityRoadFrame(X, Y)
{
    let BestDist = Infinity;
    let BestTan  = [1.0, 0.0];
    let SignedLat = 0.0;
    for (const Seg of CityRoadSegments)
    {
        const VX = Seg.B[0] - Seg.A[0], VY = Seg.B[1] - Seg.A[1];
        const LenSq = VX * VX + VY * VY;
        const T = Clamp01(((X - Seg.A[0]) * VX + (Y - Seg.A[1]) * VY) / (LenSq || 1.0));
        const PX = Seg.A[0] + VX * T, PY = Seg.A[1] + VY * T;
        const DX = X - PX, DY = Y - PY;
        const D = Math.hypot(DX, DY);
        if (D < BestDist)
        {
            const L = Math.sqrt(LenSq) || 1.0;
            BestDist  = D;
            BestTan   = [VX / L, VY / L];
            SignedLat = (DX * (-VY / L) + DY * (VX / L));
        }
    }
    return { Distance: BestDist, Tangent: BestTan, LateralOffset: SignedLat };
}

function Clamp01(V)
{
    return V < 0.0 ? 0.0 : (V > 1.0 ? 1.0 : V);
}

export function ResolveCityPlacements()
{
    const Placements = [];
    const Superblocks = [
        { Prefix: "NW Block", CX: -102.5, CY:  47.0, Shapes: ["CityBlockMid",  "CityBlockTall", "CityBlockLow",   "CityBlockTower"] },
        { Prefix: "NE Block", CX:   -7.5, CY:  47.0, Shapes: ["CityBlockTall", "CityBlockLow",  "CityBlockTower", "CityBlockMid"] },
        { Prefix: "SW Block", CX: -102.5, CY: -47.0, Shapes: ["CityBlockLow",  "CityBlockMid",  "CityBlockTower", "CityBlockTall"] },
        { Prefix: "SE Block", CX:   -7.5, CY: -47.0, Shapes: ["CityBlockTower","CityBlockTall", "CityBlockMid",   "CityBlockLow"] }
    ];

    // Each superblock has 4 quadrant buildings leaving a 10 m-wide N-S alley & 10 m-wide E-W alley right through the middle!
    // Quadrant offsets: X = ±21.0 m (building width 31 m -> inner edge at ±5.5 m => 11.0 m clear N-S alley!),
    //                   Y = ±18.5 m (building depth 26 m -> inner edge at ±5.5 m => 11.0 m clear E-W alley!)
    const QuadOffsets = [[-21.0, 18.5], [21.0, 18.5], [-21.0, -18.5], [21.0, -18.5]];
    for (const Block of Superblocks)
    {
        for (let Q = 0; Q < 4; ++Q)
        {
            const [OX, OY] = QuadOffsets[Q];
            Placements.push({
                Name:     `${Block.Prefix} Building ${Q + 1}`,
                Shape:    Block.Shapes[Q],
                Position: [Block.CX + OX, Block.CY + OY, 0.0],
                Yaw:      0.0,
                Collider: true
            });
        }
        // Overhead alley skybridges across the East-West alley (creates true covered alley chases!)
        Placements.push({
            Name:     `${Block.Prefix} West Alley Skybridge`,
            Shape:    "CityAlleySkybridge",
            Position: [Block.CX - 21.0, Block.CY, 0.0],
            Yaw:      0.0,
            Collider: false
        });
        Placements.push({
            Name:     `${Block.Prefix} East Alley Skybridge`,
            Shape:    "CityAlleySkybridge",
            Position: [Block.CX + 21.0, Block.CY, 0.0],
            Yaw:      0.0,
            Collider: false
        });
    }

    // Perimeter skyline backdrop towers outside the West & North-West avenues
    const Skyline = [
        [-192.0,  64.0, "CityBlockTower"],
        [-192.0,   0.0, "CityBlockTall"],
        [-192.0, -64.0, "CityBlockMid"],
        [-102.5, 126.0, "CityBlockMid"],
        [  -7.5, 126.0, "CityBlockTall"],
        [-102.5,-126.0, "CityBlockTall"],
        [  -7.5,-126.0, "CityBlockLow"]
    ];
    Skyline.forEach(([X, Y, Shape], Idx) =>
    {
        Placements.push({
            Name:     `Skyline Tower ${Idx + 1}`,
            Shape,
            Position: [X, Y, 0.0],
            Yaw:      0.0,
            Collider: true
        });
    });

    return Placements;
}

export function ResolveCityCones()
{
    const Cones = [];
    // Alley construction drums & chicane cones for dramatic alley pursuits
    const Spots = [
        [-118.0,  47.0], [ -86.0,  45.5], [ -24.0,  48.2], [  10.0,  46.0],
        [-118.0, -47.0], [ -86.0, -45.5], [ -24.0, -48.2], [  10.0, -46.0],
        [-102.5,  28.0], [-102.5, -28.0], [  -7.5,  28.0], [  -7.5, -28.0]
    ];
    Spots.forEach(([X, Y], I) =>
    {
        Cones.push({
            Name:     `Alley Drum ${I + 1}`,
            Group:    "lone",
            Shape:    (I & 1) === 0 ? "ConstructionDrum" : "Cone",
            Position: [X, Y, 0.0],
            Yaw:      I * 0.7
        });
    });
    return Cones;
}

export function ResolveCityBreakables()
{
    // Smashable wooden alley cargo crates inside the 4 downtown escape alleys!
    const Crates = [
        { Name: "NW Alley Crate", Pos: [-94.0,  48.5] },
        { Name: "NE Alley Crate", Pos: [  2.0,  45.5] },
        { Name: "SW Alley Crate", Pos: [-94.0, -48.5] },
        { Name: "SE Alley Crate", Pos: [  2.0, -45.5] }
    ];
    return Crates.map((C, I) => ({
        Name:     C.Name,
        Material: "wood",
        Mode:     "baked",
        Shape:    { Kind: "box", Extent: [1.25, 1.25, 1.15] },
        Position: [C.Pos[0], C.Pos[1], 0.0],
        Yaw:      0.22 * (I + 1),
        Approach: [1.0, 0.0, 0.0],
        Capacity: 10,
        Energy:   4200,
        Seed:     9101 + I * 37
    }));
}

export function ResolveCityTrafficLights()
{
    return [
        { Id: "tl_city_nw", Name: "North-West Plaza Signal",     Anchor: [-150.0,  90.0, 4.45], Yaw: 0.0, PhaseOffset: 0.0 },
        { Id: "tl_city_se", Name: "South-East Frontage Signal",  Anchor: [  40.0, -90.0, 4.45], Yaw: Math.PI * 0.5, PhaseOffset: 5.5 }
    ];
}

export function EmitCityGroundFacets()
{
    // Flat urban asphalt & dark slate plaza ground plane covering [-900..+900]² (alleys & plazas sit directly on dark asphalt!)
    const Extent = 900.0;
    const Inner  = 240.0;
    const Facets = [];
    const Quad = (X0, Y0, X1, Y1, Z, Family) =>
    {
        Facets.push(
            { Family, Corners: [[X0, Y0, Z], [X1, Y0, Z], [X1, Y1, Z]] },
            { Family, Corners: [[X0, Y0, Z], [X1, Y1, Z], [X0, Y1, Z]] }
        );
    };
    // Downtown asphalt plaza & alley floor
    Quad(-Inner, -Inner, Inner, Inner, 0.0, CourseMaterial.AsphaltPatch);
    // Surrounding highway greenbelt apron
    Quad(-Extent, -Extent, -Inner,  Extent, 0.0, CourseMaterial.Grass);
    Quad( Inner,  -Extent,  Extent, Extent, 0.0, CourseMaterial.Grass);
    Quad(-Inner,  -Extent,  Inner, -Inner,  0.0, CourseMaterial.Grass);
    Quad(-Inner,   Inner,   Inner,  Extent, 0.0, CourseMaterial.Grass);
    return Facets;
}

export const CityPursuitSpawn = Object.freeze({
    Position: [-122.0, 0.0, 0.63],
    Yaw:      0.0
});

export const CityPursuitZones = Object.freeze([
    { Name: "Central Ave · Downtown",   Position: [-122.0,    0.0], Yaw:   0.0 },
    { Name: "NW Covered Escape Alley",  Position: [-132.0,   47.0], Yaw:   0.0 },
    { Name: "Highway North Ramp",       Position: [  52.0,   96.0], Yaw:  35.0 },
    { Name: "Elevated Highway Viaduct", Position: [ 105.0,   38.0], Yaw: -90.0 },
    { Name: "East Beltway Clover",      Position: [ 162.0,   12.0], Yaw: -95.0 },
    { Name: "SE Alley Ambush",          Position: [ -38.0,  -47.0], Yaw:   0.0 }
]);

export const CityClearZones = Object.freeze([
    [-60.0, -14.0,  60.0,  14.0], // Central Ave corridor
    [-60.0, -60.0, -42.0,  60.0], // Midtown N-S Ave corridor
    [ 27.0, -60.0,  53.0,  60.0], // Frontage N-S Ave corridor
    [-60.0,  40.0,  60.0,  54.0], // North E-W Escape Alley
    [-60.0, -54.0,  60.0, -40.0], // South E-W Escape Alley
    [-14.0, -60.0,   0.0,  60.0]  // East N-S Escape Alley
]);
