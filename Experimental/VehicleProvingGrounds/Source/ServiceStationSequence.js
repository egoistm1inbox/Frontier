//============================================================================================================================================
//                                                       SERVICESTATIONSEQUENCE.JS
//============================================================================================================================================
// 🧩 Industrial Automotive Megafactory (with interior presses, conveyors, silos, racks & live 6-axis welding robot arms)
//    + Automatic Fuel & 800V Electric Charging Bays served by bolted Multi-Axis Industrial Robot Arms & WebAudio synthesis.

import { CourseMaterial } from "./MaterialSpecification.js";
import { EmitBoxFacets, EmitCornerBoxFacets } from "./CourseStructure.js";
import { ConstructAxisQuaternion, MultiplyQuaternion, ConstructRigidTransform, RotateVector, ClampScalar } from "./TransformProjection.js";
import { ServiceAudio } from "./ServiceAudio.js";

//------------------------------------------------------------------------------------------------------------------------
//                  INDUSTRIAL ROBOT KINEMATIC CONSTANTS & WATERTIGHT 2-MANIFOLD GEOMETRY
//------------------------------------------------------------------------------------------------------------------------

export const IndustrialRobotSpec = Object.freeze({
    TurretBaseZ:    0.62,   // [m] Height of rotating J1 waist slew-ring above floor pedestal
    ShoulderFwdX:   0.16,   // [m] Forward radial offset of J2 shoulder trunnion on turret
    ShoulderLiftZ:  0.52,   // [m] Height of J2 shoulder trunnion above turret slew-ring (World Z = 1.14 m)
    UpperArmLen:    2.15,   // [m] J2 -> J3 cast-alloy lower/upper boom length
    ForearmLen:     1.95,   // [m] J3 -> J4 tubular elbow forearm length
    WristTipLen:    0.48    // [m] J4 -> active coupler / welding electrode tip along local +X
});

function EmitOctagonalCylinder(CenterX, CenterY, Z0, Z1, Radius, SideMat, TopMat, BotMat = CourseMaterial.SteelDark, Sides = 12)
{
    const Facets = [];
    for (let Seg = 0; Seg < Sides; ++Seg)
    {
        const A0 = (2.0 * Math.PI * Seg) / Sides;
        const A1 = (2.0 * Math.PI * (Seg + 1)) / Sides;
        const C0 = Math.cos(A0), S0 = Math.sin(A0);
        const C1 = Math.cos(A1), S1 = Math.sin(A1);
        const P00 = [CenterX + Radius * C0, CenterY + Radius * S0, Z0];
        const P10 = [CenterX + Radius * C1, CenterY + Radius * S1, Z0];
        const P11 = [CenterX + Radius * C1, CenterY + Radius * S1, Z1];
        const P01 = [CenterX + Radius * C0, CenterY + Radius * S0, Z1];
        const N0 = [C0, S0, 0.0], N1 = [C1, S1, 0.0];

        Facets.push({ Corners: [[CenterX, CenterY, Z0], P10, P00], Normals: [[0, 0, -1], [0, 0, -1], [0, 0, -1]], Family: BotMat });
        Facets.push({ Corners: [P00, P10, P11], Normals: [N0, N1, N1], Family: SideMat });
        Facets.push({ Corners: [P00, P11, P01], Normals: [N0, N1, N0], Family: SideMat });
        Facets.push({ Corners: [[CenterX, CenterY, Z1], P01, P11], Normals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]], Family: TopMat });
    }
    return Facets;
}

// Closed 2-manifold octagonal cylinder aligned along the Y axis (for J2 shoulder & J3 elbow servo joint drums).
function EmitYAxisCylinder(CenterX, Y0, Y1, CenterZ, Radius, SideMat, PosYMat, NegYMat = CourseMaterial.SteelDark, Sides = 10)
{
    const Facets = [];
    for (let Seg = 0; Seg < Sides; ++Seg)
    {
        const A0 = (2.0 * Math.PI * Seg) / Sides;
        const A1 = (2.0 * Math.PI * (Seg + 1)) / Sides;
        const S0 = Math.sin(A0), C0 = Math.cos(A0);
        const S1 = Math.sin(A1), C1 = Math.cos(A1);
        const P00 = [CenterX + Radius * S0, Y0, CenterZ + Radius * C0];
        const P10 = [CenterX + Radius * S1, Y0, CenterZ + Radius * C1];
        const P11 = [CenterX + Radius * S1, Y1, CenterZ + Radius * C1];
        const P01 = [CenterX + Radius * S0, Y1, CenterZ + Radius * C0];
        const N0 = [S0, 0.0, C0], N1 = [S1, 0.0, C1];

        // -Y cap (outward normal [0, -1, 0])
        Facets.push({ Corners: [[CenterX, Y0, CenterZ], P10, P00], Normals: [[0, -1, 0], [0, -1, 0], [0, -1, 0]], Family: NegYMat });
        // Radial side quads (outward normal [+sin A, 0, +cos A])
        Facets.push({ Corners: [P00, P10, P11], Normals: [N0, N1, N1], Family: SideMat });
        Facets.push({ Corners: [P00, P11, P01], Normals: [N0, N1, N0], Family: SideMat });
        // +Y cap (outward normal [0, +1, 0])
        Facets.push({ Corners: [[CenterX, Y1, CenterZ], P01, P11], Normals: [[0, 1, 0], [0, 1, 0], [0, 1, 0]], Family: PosYMat });
    }
    return Facets;
}

// 📝 Link 0: Heavy Bolted Industrial Robot Pedestal Base (concrete plinth + cast-iron slew column + servo controller box).
export function EmitIndustrialRobotPedestalFacets()
{
    const Facets = [];
    Facets.push(...EmitCornerBoxFacets([-0.64, -0.64, 0.00], [ 0.64,  0.64, 0.14], CourseMaterial.BarrierConcrete));
    Facets.push(...EmitOctagonalCylinder(0.0, 0.0, 0.15, 0.27, 0.50, CourseMaterial.SteelDark, CourseMaterial.SteelDark, CourseMaterial.SteelDark, 12));
    Facets.push(...EmitOctagonalCylinder(0.0, 0.0, 0.28, 0.60, 0.36, CourseMaterial.SteelDark, CourseMaterial.Aluminium, CourseMaterial.SteelDark, 12));
    // Rear high-voltage servo junction & pneumatic manifold box
    Facets.push(...EmitCornerBoxFacets([-0.60, -0.24, 0.16], [-0.40,  0.24, 0.56], CourseMaterial.PaintYellow));
    return Facets;
}

// 📝 Link 1: Rotating Waist Turret / J1 Carousel & J2 Shoulder Trunnion Yoke (local origin at [0, 0, TurretBaseZ]).
export function EmitIndustrialRobotTurretFacets()
{
    const Facets = [];
    // Rotating slew carousel drum
    Facets.push(...EmitOctagonalCylinder(0.0, 0.0, 0.00, 0.20, 0.37, CourseMaterial.ConeOrange, CourseMaterial.ConeOrange, CourseMaterial.SteelDark, 12));
    // Heavy rear cast-iron counterweight block + amber safety stripe
    Facets.push(...EmitCornerBoxFacets([-0.54, -0.24, 0.22], [-0.17,  0.24, 0.58], CourseMaterial.SteelDark));
    Facets.push(...EmitCornerBoxFacets([-0.58, -0.18, 0.34], [-0.55,  0.18, 0.46], CourseMaterial.BannerAmber));
    // Left & right cast-alloy shoulder yoke cheek plates supporting J2 pivot at [0.16, 0, 0.52]
    Facets.push(...EmitCornerBoxFacets([-0.14, -0.27, 0.22], [ 0.30, -0.17, 0.68], CourseMaterial.ConeOrange));
    Facets.push(...EmitCornerBoxFacets([-0.14,  0.17, 0.22], [ 0.30,  0.27, 0.68], CourseMaterial.ConeOrange));
    // Outboard J2 AC servo drive motor housing
    Facets.push(...EmitYAxisCylinder(0.16, 0.29, 0.47, 0.52, 0.15, CourseMaterial.SteelDark, CourseMaterial.PaintYellow, CourseMaterial.SteelDark, 10));
    return Facets;
}

// 📝 Link 2: Articulated Lower/Upper Boom Arm (J2 at [0,0,0] -> J3 at [+UpperArmLen, 0, 0]).
export function EmitIndustrialRobotUpperArmFacets()
{
    const L1 = IndustrialRobotSpec.UpperArmLen;
    const Facets = [];
    // Shoulder trunnion barrel
    Facets.push(...EmitYAxisCylinder(0.0, -0.15, 0.15, 0.0, 0.16, CourseMaterial.SteelDark, CourseMaterial.PaintYellow, CourseMaterial.PaintYellow, 10));
    // Twin parallel KUKA-orange structural cast-alloy spars
    Facets.push(...EmitCornerBoxFacets([0.18, -0.14, -0.11], [L1 - 0.18, -0.05, 0.11], CourseMaterial.ConeOrange));
    Facets.push(...EmitCornerBoxFacets([0.18,  0.05, -0.11], [L1 - 0.18,  0.14, 0.11], CourseMaterial.ConeOrange));
    // Central cross-brace web & top flexible hydraulic/cable dress-pack conduit
    Facets.push(...EmitCornerBoxFacets([0.85, -0.04, -0.08], [1.30,  0.04, 0.08], CourseMaterial.SteelDark));
    Facets.push(...EmitCornerBoxFacets([0.32, -0.045, 0.125],[L1 - 0.32, 0.045, 0.195], CourseMaterial.Tyre));
    // Elbow joint barrel at +L1
    Facets.push(...EmitYAxisCylinder(L1, -0.15, 0.15, 0.0, 0.14, CourseMaterial.SteelDark, CourseMaterial.PaintYellow, CourseMaterial.PaintYellow, 10));
    return Facets;
}

// 📝 Link 3: Articulated Elbow Forearm (J3 at [0,0,0] -> J4 Wrist at [+ForearmLen, 0, 0]).
export function EmitIndustrialRobotForearmFacets()
{
    const L2 = IndustrialRobotSpec.ForearmLen;
    const Facets = [];
    // Rear 3-axis wrist servo motor bank behind the elbow pivot
    Facets.push(...EmitCornerBoxFacets([-0.42, -0.14, -0.12], [-0.16,  0.14, 0.16], CourseMaterial.SteelDark));
    Facets.push(...EmitYAxisCylinder(0.0, -0.32, -0.17, 0.0, 0.12, CourseMaterial.SteelDark, CourseMaterial.SteelDark, CourseMaterial.PaintYellow, 10));
    // Tapered industrial orange forearm tube
    Facets.push(...EmitCornerBoxFacets([0.16, -0.095, -0.095], [L2 - 0.16, 0.095, 0.095], CourseMaterial.ConeOrange));
    // Looped black umbilical dress-pack along top of forearm
    Facets.push(...EmitCornerBoxFacets([0.28, -0.045, 0.105], [L2 - 0.28, 0.045, 0.175], CourseMaterial.Tyre));
    // Spherical-wrist gearbox collar at +L2
    Facets.push(...EmitCornerBoxFacets([L2 - 0.14, -0.08, -0.08], [L2, 0.08, 0.08], CourseMaterial.SteelDark));
    return Facets;
}

// 📝 Link 4a: 6-Axis Wrist + Automated Octane-100 Fuel Coupler End-Effector (tip at +0.48 m).
export function EmitIndustrialRobotCouplerFuelFacets()
{
    const Facets = [];
    Facets.push(...EmitCornerBoxFacets([0.02, -0.075, -0.075], [0.14, 0.075, 0.075], CourseMaterial.Aluminium));
    Facets.push(...EmitCornerBoxFacets([0.15, -0.090, -0.090], [0.34, 0.090, 0.090], CourseMaterial.WallCrimson));
    Facets.push(...EmitCornerBoxFacets([0.19, -0.095,  0.100], [0.32, 0.095, 0.150], CourseMaterial.BannerAmber));
    Facets.push(...EmitCornerBoxFacets([0.35, -0.055, -0.055], [0.48, 0.055, 0.055], CourseMaterial.GateLamp));
    return Facets;
}

// 📝 Link 4b: 6-Axis Wrist + 800V Megawatt CCS Liquid-Cooled EV Charge Coupler (tip at +0.48 m).
export function EmitIndustrialRobotCouplerEVFacets()
{
    const Facets = [];
    Facets.push(...EmitCornerBoxFacets([0.02, -0.075, -0.075], [0.14, 0.075, 0.075], CourseMaterial.Aluminium));
    Facets.push(...EmitCornerBoxFacets([0.15, -0.095, -0.095], [0.34, 0.095, 0.095], CourseMaterial.PaintWhite));
    Facets.push(...EmitCornerBoxFacets([0.19, -0.095,  0.105], [0.32, 0.095, 0.155], CourseMaterial.PaintGreen));
    Facets.push(...EmitCornerBoxFacets([0.35, -0.060, -0.060], [0.48, 0.060, 0.060], CourseMaterial.GateLamp));
    return Facets;
}

// 📝 Link 4c: 6-Axis Wrist + Automotive Body-in-White Servo Spot-Welding Gun (tip at +0.48 m).
export function EmitIndustrialRobotWelderFacets()
{
    const Facets = [];
    Facets.push(...EmitCornerBoxFacets([0.02, -0.075, -0.075], [0.14, 0.075, 0.075], CourseMaterial.Aluminium));
    Facets.push(...EmitCornerBoxFacets([0.15, -0.085, -0.105], [0.32, 0.085, 0.105], CourseMaterial.SteelDark));
    // Upper & lower copper spot-welding C-jaws + glowing weld electrode tip
    Facets.push(...EmitCornerBoxFacets([0.33, -0.040,  0.025], [0.48, 0.040,  0.080], CourseMaterial.BannerAmber));
    Facets.push(...EmitCornerBoxFacets([0.33, -0.040, -0.080], [0.48, 0.040, -0.025], CourseMaterial.BannerAmber));
    Facets.push(...EmitCornerBoxFacets([0.43, -0.025, -0.015], [0.48, 0.025,  0.015], CourseMaterial.GateLamp));
    return Facets;
}

// 📝 Automatic Octane-100 Fuel Dispenser Island Unit.
export function EmitFuelDispenserPumpFacets()
{
    const Facets = [];
    Facets.push(...EmitCornerBoxFacets([-0.62, -0.42, 0.00], [0.62, 0.42, 0.18], CourseMaterial.BarrierConcrete));
    Facets.push(...EmitCornerBoxFacets([-0.48, -0.30, 0.19], [0.48, 0.30, 1.88], CourseMaterial.WallCrimson));
    Facets.push(...EmitCornerBoxFacets([-0.34, -0.33, 1.08], [0.34, 0.33, 1.62], CourseMaterial.GateLamp));
    Facets.push(...EmitCornerBoxFacets([-0.52, -0.34, 1.89], [0.52, 0.34, 2.18], CourseMaterial.BannerAmber));
    return Facets;
}

// 📝 Automatic 800V Electric Supercharger Pedestal Unit.
export function EmitElectricChargerPodFacets()
{
    const Facets = [];
    Facets.push(...EmitCornerBoxFacets([-0.62, -0.42, 0.00], [0.62, 0.42, 0.18], CourseMaterial.BarrierConcrete));
    Facets.push(...EmitCornerBoxFacets([-0.46, -0.26, 0.19], [0.46, 0.26, 2.12], CourseMaterial.PaintWhite));
    Facets.push(...EmitCornerBoxFacets([-0.24, -0.29, 0.52], [0.24, 0.29, 1.86], CourseMaterial.GateLamp));
    Facets.push(...EmitCornerBoxFacets([-0.50, -0.30, 2.13], [0.50, 0.30, 2.38], CourseMaterial.PaintGreen));
    return Facets;
}

// 📝 Interior Factory Hydraulic Stamping Press (heavy industrial yellow/steel gantry press inside the factory hall!).
export function EmitFactoryStampingPressFacets()
{
    const Facets = [];
    Facets.push(...EmitCornerBoxFacets([-2.10, -1.60, 0.00], [ 2.10,  1.60, 0.75], CourseMaterial.SteelDark));
    Facets.push(...EmitCornerBoxFacets([-1.95, -1.45, 0.76], [-1.25,  1.45, 5.20], CourseMaterial.PaintYellow));
    Facets.push(...EmitCornerBoxFacets([ 1.25, -1.45, 0.76], [ 1.95,  1.45, 5.20], CourseMaterial.PaintYellow));
    Facets.push(...EmitCornerBoxFacets([-2.15, -1.55, 5.21], [ 2.15,  1.55, 6.25], CourseMaterial.WallCobalt));
    Facets.push(...EmitCornerBoxFacets([-1.10, -1.15, 2.15], [ 1.10,  1.15, 3.35], CourseMaterial.SteelDark));
    Facets.push(...EmitCornerBoxFacets([-1.18, -1.20, 1.96], [ 1.18,  1.20, 2.12], CourseMaterial.BannerAmber));
    return Facets;
}

// 📝 Interior Factory Automated Assembly Conveyor Line with prototype chassis/battery pack workpieces on belt!
export function EmitFactoryConveyorLineFacets()
{
    const Facets = [];
    for (const LX of [-4.2, -1.4, 1.4, 4.2])
        Facets.push(...EmitCornerBoxFacets([LX - 0.22, -1.05, 0.00], [LX + 0.22, 1.05, 0.88], CourseMaterial.SteelDark));
    Facets.push(...EmitCornerBoxFacets([-5.00, -1.18, 0.89], [ 5.00,  1.18, 1.12], CourseMaterial.PaintYellow));
    Facets.push(...EmitCornerBoxFacets([-4.85, -0.96, 1.13], [ 4.85,  0.96, 1.20], CourseMaterial.Tyre));
    Facets.push(...EmitCornerBoxFacets([-3.20, -0.72, 1.21], [-0.80,  0.72, 1.78], CourseMaterial.Aluminium));
    Facets.push(...EmitCornerBoxFacets([ 0.80, -0.72, 1.21], [ 3.20,  0.72, 1.78], CourseMaterial.WallCobalt));
    Facets.push(...EmitCornerBoxFacets([ 1.20, -0.52, 1.79], [ 2.80,  0.52, 2.02], CourseMaterial.GateLamp));
    return Facets;
}

// 📝 Multi-tier Factory Heavy Pallet Storage Rack loaded with industrial containers.
export function EmitFactoryStorageRackFacets()
{
    const Facets = [];
    for (const SX of [-2.8, 0.0, 2.8])
        for (const SY of [-0.95, 0.95])
            Facets.push(...EmitCornerBoxFacets([SX - 0.12, SY - 0.12, 0.00], [SX + 0.12, SY + 0.12, 4.60], CourseMaterial.WallCobalt));
    for (const BeamZ of [1.45, 3.05])
        Facets.push(...EmitCornerBoxFacets([-2.95, -1.08, BeamZ], [2.95, 1.08, BeamZ + 0.16], CourseMaterial.ConeOrange));
    Facets.push(...EmitCornerBoxFacets([-2.45, -0.82, 0.01], [-0.45, 0.82, 1.32], CourseMaterial.PaintYellow));
    Facets.push(...EmitCornerBoxFacets([ 0.45, -0.82, 0.01], [ 2.45, 0.82, 1.32], CourseMaterial.WallCrimson));
    Facets.push(...EmitCornerBoxFacets([-2.35, -0.78, 1.62], [-0.35, 0.78, 2.92], CourseMaterial.PaintGreen));
    Facets.push(...EmitCornerBoxFacets([ 0.35, -0.78, 1.62], [ 2.35, 0.78, 2.92], CourseMaterial.Aluminium));
    Facets.push(...EmitCornerBoxFacets([-1.85, -0.75, 3.22], [ 1.85, 0.75, 4.35], CourseMaterial.ConeOrange));
    return Facets;
}

// 📝 Cylindrical Industrial Factory Chemical / Fuel Storage Silo Tank.
export function EmitFactoryTankSiloFacets()
{
    const Facets = [];
    Facets.push(...EmitCornerBoxFacets([-1.85, -1.85, 0.00], [1.85, 1.85, 0.38], CourseMaterial.BarrierConcrete));
    Facets.push(...EmitOctagonalCylinder(0.0, 0.0, 0.39, 5.80, 1.62, CourseMaterial.Aluminium, CourseMaterial.PaintWhite, CourseMaterial.SteelDark, 14));
    Facets.push(...EmitOctagonalCylinder(0.0, 0.0, 2.60, 3.25, 1.66, CourseMaterial.BannerAmber, CourseMaterial.BannerAmber, CourseMaterial.BannerAmber, 14));
    return Facets;
}

export function ConstructFactoryAndServiceShapes()
{
    return {
        // Multi-Axis Articulated Industrial Robot Arm Links (3D SDF + GI Cards + Dynamic!)
        IndustrialRobotPedestal:    { Emit: EmitIndustrialRobotPedestalFacets,    Voxel: 0.24, Cards: 6 },
        IndustrialRobotTurret:      { Emit: EmitIndustrialRobotTurretFacets,      Voxel: 0.22, Cards: 6 },
        IndustrialRobotUpperArm:    { Emit: EmitIndustrialRobotUpperArmFacets,    Voxel: 0.22, Cards: 6 },
        IndustrialRobotForearm:     { Emit: EmitIndustrialRobotForearmFacets,     Voxel: 0.20, Cards: 6 },
        IndustrialRobotCouplerFuel: { Emit: EmitIndustrialRobotCouplerFuelFacets, Voxel: 0.16, Cards: 6 },
        IndustrialRobotCouplerEV:   { Emit: EmitIndustrialRobotCouplerEVFacets,   Voxel: 0.16, Cards: 6 },
        IndustrialRobotWelder:      { Emit: EmitIndustrialRobotWelderFacets,      Voxel: 0.16, Cards: 6 },

        // Station Dispenser Islands & Canopies
        FuelDispenserPump:    { Emit: EmitFuelDispenserPumpFacets,    Voxel: 0.34, Cards: 6 },
        ElectricChargerPod:   { Emit: EmitElectricChargerPodFacets,   Voxel: 0.34, Cards: 6 },
        StationCanopyPillar:  { Emit: () => EmitBoxFacets(0.58,  0.58, 5.40, CourseMaterial.SteelDark),     Voxel: 0.0, Cards: 0, Distance: false },
        StationCanopyFuel:    { Emit: () => EmitBoxFacets(16.8, 10.6,  0.68, CourseMaterial.WallCrimson),   Voxel: 0.0, Cards: 0, Distance: false },
        StationCanopyEV:      { Emit: () => EmitBoxFacets(16.8, 10.6,  0.68, CourseMaterial.WallCobalt),    Voxel: 0.0, Cards: 0, Distance: false },
        StationCanopyLamp:    { Emit: () => EmitBoxFacets(12.4,  0.55, 0.14, CourseMaterial.GateLamp),      Voxel: 0.0, Cards: 0, Distance: false },

        // Drive-Through Industrial Megafactory Architecture & Interior Machinery Props
        FactoryColumn:        { Emit: () => EmitBoxFacets(1.10,  1.10, 11.2, CourseMaterial.SteelDark),     Voxel: 0.0, Cards: 0, Distance: false },
        FactoryWallPanel:     { Emit: () => EmitBoxFacets(13.6,  0.85, 10.4, CourseMaterial.TunnelConcrete),Voxel: 0.0, Cards: 0, Distance: false },
        FactoryEndWall:       { Emit: () => EmitBoxFacets(0.85, 17.6,  10.4, CourseMaterial.WallCobalt),    Voxel: 0.0, Cards: 0, Distance: false },
        FactoryDoorHeader:    { Emit: () => EmitBoxFacets(1.10, 20.4,   3.4, CourseMaterial.PaintYellow),   Voxel: 0.0, Cards: 0, Distance: false },
        FactoryRoofSlab:      { Emit: () => EmitBoxFacets(18.8, 56.4,   0.72,CourseMaterial.SteelDark),     Voxel: 0.0, Cards: 0, Distance: false },
        FactoryHighBayLamp:   { Emit: () => EmitBoxFacets(3.60,  0.75,  0.18,CourseMaterial.GateLamp),      Voxel: 0.0, Cards: 0, Distance: false },
        FactoryChimney:       { Emit: () => EmitOctagonalCylinder(0, 0, 0.0, 9.5, 1.15, CourseMaterial.SteelDark, CourseMaterial.KerbRed, CourseMaterial.SteelDark, 12), Voxel: 0.0, Cards: 0, Distance: false },
        FactoryStampingPress: { Emit: EmitFactoryStampingPressFacets, Voxel: 0.0, Cards: 0, Distance: false },
        FactoryConveyorLine:  { Emit: EmitFactoryConveyorLineFacets,  Voxel: 0.0, Cards: 0, Distance: false },
        FactoryStorageRack:   { Emit: EmitFactoryStorageRackFacets,   Voxel: 0.0, Cards: 0, Distance: false },
        FactoryTankSilo:      { Emit: EmitFactoryTankSiloFacets,      Voxel: 0.0, Cards: 0, Distance: false }
    };
}

//------------------------------------------------------------------------------------------------------------------------
//                      CLOSED-FORM ELBOW-UP 4-LINK INDUSTRIAL ROBOT INVERSE KINEMATICS
//------------------------------------------------------------------------------------------------------------------------

function LerpScalar(A, B, T)
{
    return A + (B - A) * T;
}

function LerpVec3(A, B, T)
{
    return [
        A[0] + (B[0] - A[0]) * T,
        A[1] + (B[1] - A[1]) * T,
        A[2] + (B[2] - A[2]) * T
    ];
}

function NormalizeVec3(V)
{
    const Len = Math.hypot(V[0], V[1], V[2]) || 1.0;
    return [V[0] / Len, V[1] / Len, V[2] / Len];
}

function SmoothStep01(T)
{
    const U = ClampScalar(T, 0.0, 1.0);
    return U * U * (3.0 - 2.0 * U);
}

// Given fixed floor BasePos [BX, BY, BZ], desired ToolTipWorld [TX, TY, TZ], and unit ToolDir [UX, UY, UZ],
// solves exact elbow-up industrial robot joint transforms for Pedestal, Turret, UpperArm, Forearm, and Wrist!
export function SolveIndustrialRobotArmIK(BasePos, BaseYaw, ToolTipWorld, ToolDir)
{
    const { TurretBaseZ, ShoulderFwdX, ShoulderLiftZ, UpperArmLen, ForearmLen, WristTipLen } = IndustrialRobotSpec;
    const Dir = NormalizeVec3(ToolDir);

    // Wrist pivot J4 sits WristTipLen behind the desired tool tip along -Dir
    const WristGoal = [
        ToolTipWorld[0] - Dir[0] * WristTipLen,
        ToolTipWorld[1] - Dir[1] * WristTipLen,
        ToolTipWorld[2] - Dir[2] * WristTipLen
    ];

    const DX = WristGoal[0] - BasePos[0];
    const DY = WristGoal[1] - BasePos[1];
    const WaistYaw = Math.hypot(DX, DY) > 1.0e-4 ? Math.atan2(DY, DX) : BaseYaw;
    const CosW = Math.cos(WaistYaw), SinW = Math.sin(WaistYaw);

    const TurretPos = [BasePos[0], BasePos[1], BasePos[2] + TurretBaseZ];
    const ShoulderPos = [
        BasePos[0] + CosW * ShoulderFwdX,
        BasePos[1] + SinW * ShoulderFwdX,
        TurretPos[2] + ShoulderLiftZ
    ];

    // Planar radial & vertical coordinates from J2 shoulder to J4 wrist in the waist half-plane
    const RadialDist = Math.hypot(DX, DY) - ShoulderFwdX;
    const VertDist   = WristGoal[2] - ShoulderPos[2];
    const RawChord   = Math.hypot(RadialDist, VertDist);
    const MinReach   = Math.abs(UpperArmLen - ForearmLen) + 0.06;
    const MaxReach   = UpperArmLen + ForearmLen - 0.02;
    const Chord      = ClampScalar(RawChord, MinReach, MaxReach);

    // Elbow-up Law of Cosines
    const CosShoulder = ClampScalar(
        (UpperArmLen * UpperArmLen + Chord * Chord - ForearmLen * ForearmLen) / (2.0 * UpperArmLen * Chord),
        -1.0, 1.0
    );
    const BaseElev = Math.atan2(VertDist, RadialDist);
    const Elev1    = BaseElev + Math.acos(CosShoulder);

    const ElbowPos = [
        ShoulderPos[0] + UpperArmLen * Math.cos(Elev1) * CosW,
        ShoulderPos[1] + UpperArmLen * Math.sin(Elev1) * 0.0 + UpperArmLen * Math.cos(Elev1) * SinW,
        ShoulderPos[2] + UpperArmLen * Math.sin(Elev1)
    ];

    // Forearm points from ElbowPos toward WristGoal (clamped cleanly if target exceeds max reach)
    const ForeDX = WristGoal[0] - ElbowPos[0];
    const ForeDY = WristGoal[1] - ElbowPos[1];
    const ForeDZ = WristGoal[2] - ElbowPos[2];
    const ForeRad = (ForeDX * CosW + ForeDY * SinW);
    const Elev2   = Math.atan2(ForeDZ, ForeRad);

    const WristPos = [
        ElbowPos[0] + ForearmLen * Math.cos(Elev2) * CosW,
        ElbowPos[1] + ForearmLen * Math.cos(Elev2) * SinW,
        ElbowPos[2] + ForearmLen * Math.sin(Elev2)
    ];
    const ActualTip = [
        WristPos[0] + Dir[0] * WristTipLen,
        WristPos[1] + Dir[1] * WristTipLen,
        WristPos[2] + Dir[2] * WristTipLen
    ];

    const QPedestal = ConstructAxisQuaternion([0.0, 0.0, 1.0], BaseYaw);
    const QTurret   = ConstructAxisQuaternion([0.0, 0.0, 1.0], WaistYaw);
    const QUpper    = MultiplyQuaternion(QTurret, ConstructAxisQuaternion([0.0, 1.0, 0.0], -Elev1));
    const QForearm  = MultiplyQuaternion(QTurret, ConstructAxisQuaternion([0.0, 1.0, 0.0], -Elev2));

    const WristYaw  = Math.atan2(Dir[1], Dir[0]);
    const WristElev = Math.asin(ClampScalar(Dir[2], -1.0, 1.0));
    const QWrist    = MultiplyQuaternion(
        ConstructAxisQuaternion([0.0, 0.0, 1.0], WristYaw),
        ConstructAxisQuaternion([0.0, 1.0, 0.0], -WristElev)
    );

    return {
        PedestalPos: BasePos,
        QPedestal,
        TurretPos,
        QTurret,
        ShoulderPos,
        QUpper,
        ElbowPos,
        QForearm,
        WristPos,
        QWrist,
        ActualTip,
        WaistYaw,
        ShoulderElev: Elev1,
        ForearmElev:  Elev2
    };
}

//------------------------------------------------------------------------------------------------------------------------
//         AUTOMATIC FUEL & 800V EV INDUSTRIAL ROBOT ARMS + MEGAFACTORY ASSEMBLY WELDING ROBOTS
//------------------------------------------------------------------------------------------------------------------------

export class ServiceStationSequence
{
    constructor(Scene, RawStations = [], RawFactoryRobots = [], AnnounceCallback = null)
    {
        this.Scene         = Scene;
        this.Enabled       = true;
        this.Audio         = new ServiceAudio();
        this.Announce      = AnnounceCallback;
        this.Clock         = 0.0;
        this.FuelLevel     = 0.34;   // [0..1] simulated vehicle fuel tank level (refilled to 100% at Auto-Fuel Station!)
        this.ChargeLevel   = 0.28;   // [0..1] simulated 800V EV battery SoC (charged to 100% at Auto-EV Station!)
        this.ServicedCount = 0;
        this.Stations      = [];
        this.FactoryRobots = [];
        this.BuildRobots(RawStations, RawFactoryRobots);
    }

    BuildRobots(RawStations, RawFactoryRobots)
    {
        if (!this.Scene || !this.Scene.ServiceBlock)
            return;
        let Cursor = this.Scene.ServiceBlock.First;

        this.Stations = RawStations.map((Spec) =>
        {
            const PedestalOccupant = Cursor++;
            const TurretOccupant   = Cursor++;
            const UpperArmOccupant = Cursor++;
            const ForearmOccupant  = Cursor++;
            const WristOccupant    = Cursor++;
            const BasePos = (Spec.BasePosition || Spec.DockPosition).slice();
            const BaseYaw = Spec.BaseYaw ?? Spec.DockYaw ?? (-0.5 * Math.PI);
            const Home = this.ComputeHomeTip(BasePos, BaseYaw, 0.0);

            return {
                Id:               Spec.Id,
                Name:             Spec.Name,
                Kind:             Spec.Kind,   // "fuel" | "electric"
                BayCenter:        Spec.BayCenter.slice(),
                BayHalfExtent:    Spec.BayHalfExtent || [7.8, 4.4],
                BasePosition:     BasePos,
                BaseYaw,
                PedestalOccupant,
                TurretOccupant,
                UpperArmOccupant,
                ForearmOccupant,
                WristOccupant,
                State:            "idle",      // "idle" | "stopping" | "deploying" | "coupling" | "dispensing" | "retracting" | "complete"
                StateTimer:       0.0,
                Progress:         0.0,
                StartLevel:       0.25,
                AnchorCarPos:     [0.0, 0.0, 0.0],
                TargetPortPos:    [Spec.BayCenter[0], Spec.BayCenter[1], 0.85],
                PrePortPos:       Home.TipPos.slice(),
                PortOutward:      [0.0, 1.0, 0.0],
                RetractFromTip:   Home.TipPos.slice(),
                RetractFromDir:   Home.ToolDir.slice(),
                CurrentTipPos:    Home.TipPos.slice(),
                CurrentToolDir:   Home.ToolDir.slice(),
                LastIK:           null
            };
        });

        this.FactoryRobots = RawFactoryRobots.map((Spec, Idx) =>
        {
            const PedestalOccupant = Cursor++;
            const TurretOccupant   = Cursor++;
            const UpperArmOccupant = Cursor++;
            const ForearmOccupant  = Cursor++;
            const WristOccupant    = Cursor++;
            return {
                Id:               Spec.Id || `factory_robot_${Idx + 1}`,
                Name:             Spec.Name || `Factory Industrial Robot ${Idx + 1}`,
                BasePosition:     Spec.BasePosition.slice(),
                BaseYaw:          Spec.BaseYaw ?? (0.5 * Math.PI),
                WeldTargets:      Spec.WeldTargets.map((T) => T.slice()),
                PhaseOffset:      Spec.PhaseOffset ?? (Idx * 1.55),
                CycleDuration:    Spec.CycleDuration ?? 4.8,
                SparkCooldown:    0.0,
                PedestalOccupant,
                TurretOccupant,
                UpperArmOccupant,
                ForearmOccupant,
                WristOccupant,
                CurrentTipPos:    Spec.BasePosition.slice(),
                CurrentToolDir:   [Math.cos(Spec.BaseYaw ?? 0.0), Math.sin(Spec.BaseYaw ?? 0.0), -0.5],
                LastIK:           null
            };
        });

        this.ApplyTransforms(true);
    }

    ComputeHomeTip(BasePos, BaseYaw, BreathPhase = 0.0)
    {
        const C = Math.cos(BaseYaw), S = Math.sin(BaseYaw);
        return {
            TipPos: [
                BasePos[0] + C * 1.18,
                BasePos[1] + S * 1.18,
                BasePos[2] + 2.32 + 0.035 * Math.sin(BreathPhase)
            ],
            ToolDir: NormalizeVec3([C * 0.78, S * 0.78, -0.62])
        };
    }

    Notify(Message)
    {
        const Handler = this.OnAnnounce || this.Announce;
        if (typeof Handler === "function")
            Handler(Message);
    }

    EmitCouplerSparks(Sparks, WorldPoint, Count, Temperature = 2100.0)
    {
        if (!Sparks)
            return;
        if (typeof Sparks.EmitBurst === "function")
        {
            Sparks.EmitBurst({
                Origin:      WorldPoint,
                Normal:      [0.0, 0.0, 1.0],
                Tangent:     [1.0, 0.0, 0.25],
                Velocity:    [0.0, 0.0, 1.6],
                Count,
                Speed:       4.2,
                Spread:      1.05,
                Lifetime:    0.55,
                Temperature
            });
        }
        else if (typeof Sparks.Emit === "function")
        {
            Sparks.Emit([{
                Point:    WorldPoint.slice(),
                Velocity: [0.0, 0.0, 3.2],
                Normal:   [0.0, 0.0, 1.0],
                Strength: Math.max(1.2, Count * 0.25),
                Rim:      null
            }], 1.0 / 60.0);
        }
    }

    get BatteryLevel()
    {
        return this.ChargeLevel;
    }

    set BatteryLevel(Value)
    {
        this.ChargeLevel = ClampScalar(Number(Value) || 0.0, 0.0, 1.0);
    }

    Reset(ResetLevels = false)
    {
        this.Audio.StopDispensing();
        if (ResetLevels)
        {
            this.FuelLevel   = 0.34;
            this.ChargeLevel = 0.28;
        }
        for (const Station of this.Stations)
        {
            const Home = this.ComputeHomeTip(Station.BasePosition, Station.BaseYaw, 0.0);
            Station.State          = "idle";
            Station.StateTimer     = 0.0;
            Station.Progress       = 0.0;
            Station.CurrentTipPos  = Home.TipPos;
            Station.CurrentToolDir = Home.ToolDir;
        }
        this.ApplyTransforms(true);
    }

    ComputeVehiclePortTargets(Station, Vehicle)
    {
        const CarPos  = Vehicle.Position;
        const CarQuat = Vehicle.Orientation || [0.0, 0.0, 0.0, 1.0];
        const Fwd     = RotateVector(CarQuat, [1.0, 0.0, 0.0]);
        const Left    = RotateVector(CarQuat, [0.0, 1.0, 0.0]);
        const Up      = RotateVector(CarQuat, [0.0, 0.0, 1.0]);

        // Choose whichever flank of the vehicle faces the industrial robot pedestal so the arm never crosses over the roof!
        const ToBaseX  = Station.BasePosition[0] - CarPos[0];
        const ToBaseY  = Station.BasePosition[1] - CarPos[1];
        const SideSign = (ToBaseX * Left[0] + ToBaseY * Left[1]) >= 0.0 ? 1.0 : -1.0;
        const Outward  = [Left[0] * SideSign, Left[1] * SideSign, Left[2] * SideSign];

        // Rear quarter-panel fuel tank / 800V charge port in world space (clamped cleanly within arm reach)
        const RawPort = [
            CarPos[0] - 1.18 * Fwd[0] + 0.94 * Outward[0] + 0.24 * Up[0],
            CarPos[1] - 1.18 * Fwd[1] + 0.94 * Outward[1] + 0.24 * Up[1],
            Math.max(0.58, CarPos[2] - 1.18 * Fwd[2] + 0.94 * Outward[2] + 0.24 * Up[2])
        ];

        const OutLen = Math.hypot(Outward[0], Outward[1]) || 1.0;
        const NX = Outward[0] / OutLen, NY = Outward[1] / OutLen;
        const PrePort = [
            RawPort[0] + NX * 0.42,
            RawPort[1] + NY * 0.42,
            RawPort[2] + 0.12
        ];
        const InsertDir = NormalizeVec3([-NX, -NY, -0.14]);
        return { PortWorld: RawPort, PrePortWorld: PrePort, Outward: [NX, NY, 0.0], InsertDir };
    }

    Advance(Vehicle, DeltaSeconds, Sparks = null)
    {
        if (!this.Scene || (this.Stations.length === 0 && this.FactoryRobots.length === 0))
            return false;
        const Step = Math.min(Math.max(DeltaSeconds, 0.0), 0.05);
        if (!this.Enabled || Step <= 0.0)
            return false;

        this.Clock += Step;
        const CarPos = Vehicle?.Position || [9999.0, 9999.0, 0.0];
        const CarVel = Vehicle?.LinearVelocity || [0.0, 0.0, 0.0];
        const Speed  = Math.hypot(CarVel[0], CarVel[1], CarVel[2]);

        if (Speed > 3.0)
        {
            this.FuelLevel   = Math.max(0.04, this.FuelLevel   - Step * Speed * 0.00018);
            this.ChargeLevel = Math.max(0.04, this.ChargeLevel - Step * Speed * 0.00022);
        }

        // ① Advance Station Refueling & 800V Supercharging Industrial Robot Arms
        for (const Station of this.Stations)
        {
            const InBay =
                Math.abs(CarPos[0] - Station.BayCenter[0]) <= Station.BayHalfExtent[0] &&
                Math.abs(CarPos[1] - Station.BayCenter[1]) <= Station.BayHalfExtent[1] &&
                Math.abs(CarPos[2]) < 2.2;

            const Home = this.ComputeHomeTip(
                Station.BasePosition,
                Station.BaseYaw,
                this.Clock * 1.6 + (Station.Kind === "electric" ? 1.5 : 0.0)
            );

            if (Station.State === "idle")
            {
                Station.CurrentTipPos  = Home.TipPos;
                Station.CurrentToolDir = Home.ToolDir;
                if (InBay && Speed < 1.45)
                {
                    Station.State = "stopping";
                    Station.StateTimer = 0.0;
                }
            }
            else if (Station.State === "stopping")
            {
                Station.CurrentTipPos  = Home.TipPos;
                Station.CurrentToolDir = Home.ToolDir;
                if (!InBay || Speed > 1.85)
                {
                    Station.State = "idle";
                    Station.StateTimer = 0.0;
                }
                else
                {
                    Station.StateTimer += Step;
                    if (Station.StateTimer >= 0.28)
                    {
                        const Targets = this.ComputeVehiclePortTargets(Station, Vehicle);
                        Station.AnchorCarPos  = CarPos.slice();
                        Station.TargetPortPos = Targets.PortWorld;
                        Station.PrePortPos    = Targets.PrePortWorld;
                        Station.PortOutward   = Targets.Outward;
                        Station.StartLevel    = Station.Kind === "electric" ? this.ChargeLevel : this.FuelLevel;
                        Station.Progress      = 0.0;
                        Station.State         = "deploying";
                        Station.StateTimer    = 0.0;
                        this.Audio.PlayStationWelcome(Station.Kind);
                        this.Notify(Station.Kind === "electric"
                            ? "⚡ Auto-EV Bay: 6-Axis Industrial Robot Arm deploying to 800V port..."
                            : "⛽ Auto-Fuel Bay: 6-Axis Industrial Robot Arm deploying to fuel port...");
                    }
                }
            }
            else if (Station.State === "deploying")
            {
                const MovedDist = Math.hypot(CarPos[0] - Station.AnchorCarPos[0], CarPos[1] - Station.AnchorCarPos[1]);
                if (!InBay || Speed > 2.6 || MovedDist > 1.8)
                {
                    this.AbortStation(Station);
                    continue;
                }
                const Targets = this.ComputeVehiclePortTargets(Station, Vehicle);
                Station.TargetPortPos = Targets.PortWorld;
                Station.PrePortPos    = Targets.PrePortWorld;
                Station.PortOutward   = Targets.Outward;
                Station.StateTimer   += Step;
                const T = SmoothStep01(Station.StateTimer / 1.05);

                // Smooth arched swing from Home pose to PrePort staging position aligned with the port axis
                const MidLift = 0.35 * Math.sin(Math.PI * T);
                const Pos = LerpVec3(Home.TipPos, Station.PrePortPos, T);
                Pos[2] += MidLift;
                Station.CurrentTipPos  = Pos;
                Station.CurrentToolDir = NormalizeVec3(LerpVec3(Home.ToolDir, Targets.InsertDir, T));

                if (Station.StateTimer >= 1.05)
                {
                    Station.State = "coupling";
                    Station.StateTimer = 0.0;
                }
            }
            else if (Station.State === "coupling")
            {
                const MovedDist = Math.hypot(CarPos[0] - Station.AnchorCarPos[0], CarPos[1] - Station.AnchorCarPos[1]);
                if (!InBay || Speed > 2.6 || MovedDist > 1.8)
                {
                    this.AbortStation(Station);
                    continue;
                }
                const Targets = this.ComputeVehiclePortTargets(Station, Vehicle);
                Station.TargetPortPos = Targets.PortWorld;
                Station.PrePortPos    = Targets.PrePortWorld;
                Station.PortOutward   = Targets.Outward;
                Station.StateTimer   += Step;
                const T = SmoothStep01(Station.StateTimer / 0.55);

                // Precision linear Cartesian insertion along -Outward straight into the vehicle's port!
                Station.CurrentTipPos  = LerpVec3(Station.PrePortPos, Station.TargetPortPos, T);
                Station.CurrentToolDir = Targets.InsertDir;

                if (Station.StateTimer >= 0.55)
                {
                    Station.State = "dispensing";
                    Station.StateTimer = 0.0;
                    this.Audio.PlayCouplerLatch(Station.Kind);
                    this.Audio.StartDispensing(Station.Kind);
                    this.EmitCouplerSparks(Sparks, Station.TargetPortPos, 10, Station.Kind === "electric" ? 2600.0 : 1850.0);
                }
            }
            else if (Station.State === "dispensing")
            {
                const MovedDist = Math.hypot(CarPos[0] - Station.AnchorCarPos[0], CarPos[1] - Station.AnchorCarPos[1]);
                if (!InBay || Speed > 2.6 || MovedDist > 1.8)
                {
                    this.AbortStation(Station);
                    continue;
                }
                const Targets = this.ComputeVehiclePortTargets(Station, Vehicle);
                Station.TargetPortPos  = Targets.PortWorld;
                Station.PrePortPos     = Targets.PrePortWorld;
                Station.PortOutward    = Targets.Outward;
                Station.CurrentTipPos  = Station.TargetPortPos.slice();
                Station.CurrentToolDir = Targets.InsertDir;

                Station.StateTimer += Step;
                Station.Progress = ClampScalar(Station.StateTimer / 2.60, 0.0, 1.0);
                this.Audio.UpdateDispensing(Station.Progress);

                if (Station.Kind === "electric")
                    this.ChargeLevel = LerpScalar(Station.StartLevel, 1.0, Station.Progress);
                else
                    this.FuelLevel = LerpScalar(Station.StartLevel, 1.0, Station.Progress);

                if (Station.Progress >= 1.0)
                {
                    Station.RetractFromTip = Station.CurrentTipPos.slice();
                    Station.RetractFromDir = Station.CurrentToolDir.slice();
                    Station.State          = "retracting";
                    Station.StateTimer     = 0.0;
                    this.ServicedCount++;
                    this.Audio.PlayCompletionChime(Station.Kind);
                    this.EmitCouplerSparks(Sparks, Station.TargetPortPos, 14, Station.Kind === "electric" ? 2800.0 : 1950.0);
                    this.Notify(Station.Kind === "electric"
                        ? "⚡ 800V Battery 100% Charged (85 kWh) — Industrial Robot Arm retracting!"
                        : "⛽ Octane-100 Tank 100% Full (60 L) — Industrial Robot Arm retracting!");
                }
            }
            else if (Station.State === "retracting")
            {
                Station.StateTimer += Step;
                if (Station.StateTimer < 0.30)
                {
                    // Linear pull-back clear of fender before folding upward
                    const U = SmoothStep01(Station.StateTimer / 0.30);
                    const SafeClear = [
                        Station.RetractFromTip[0] + Station.PortOutward[0] * 0.42,
                        Station.RetractFromTip[1] + Station.PortOutward[1] * 0.42,
                        Station.RetractFromTip[2] + 0.16
                    ];
                    Station.CurrentTipPos  = LerpVec3(Station.RetractFromTip, SafeClear, U);
                    Station.CurrentToolDir = Station.RetractFromDir;
                }
                else
                {
                    const U = SmoothStep01((Station.StateTimer - 0.30) / 0.80);
                    const SafeClear = [
                        Station.RetractFromTip[0] + Station.PortOutward[0] * 0.42,
                        Station.RetractFromTip[1] + Station.PortOutward[1] * 0.42,
                        Station.RetractFromTip[2] + 0.16
                    ];
                    const Pos = LerpVec3(SafeClear, Home.TipPos, U);
                    Pos[2] += 0.30 * Math.sin(Math.PI * U);
                    Station.CurrentTipPos  = Pos;
                    Station.CurrentToolDir = NormalizeVec3(LerpVec3(Station.RetractFromDir, Home.ToolDir, U));
                }

                if (Station.StateTimer >= 1.10)
                {
                    Station.State = InBay ? "complete" : "idle";
                    Station.StateTimer = 0.0;
                }
            }
            else if (Station.State === "complete")
            {
                Station.CurrentTipPos  = Home.TipPos;
                Station.CurrentToolDir = Home.ToolDir;
                if (!InBay)
                {
                    Station.State = "idle";
                    Station.Progress = 0.0;
                }
            }
        }

        // ② Advance Megafactory Assembly-Line Industrial Spot-Welding Robot Arms
        for (const Robot of this.FactoryRobots)
        {
            Robot.SparkCooldown = Math.max(0.0, Robot.SparkCooldown - Step);
            const Targets = Robot.WeldTargets;
            if (!Targets || Targets.length === 0)
                continue;

            const CyclePos = ((this.Clock + Robot.PhaseOffset) / Robot.CycleDuration) * Targets.length;
            const SegIdx   = Math.floor(CyclePos) % Targets.length;
            const NextIdx  = (SegIdx + 1) % Targets.length;
            const SubT     = CyclePos - Math.floor(CyclePos);

            const CurWeld  = Targets[SegIdx];
            const NextWeld = Targets[NextIdx];

            // Dwell on chassis seam (SubT < 0.42) -> spot-weld spark -> arched index to next seam (SubT 0.42..1.0)!
            if (SubT < 0.42)
            {
                const MicroWeave = 0.04 * Math.sin(SubT * Math.PI * 4.0);
                Robot.CurrentTipPos = [CurWeld[0] + MicroWeave, CurWeld[1], CurWeld[2]];
                const ToSeam = [CurWeld[0] - Robot.BasePosition[0], CurWeld[1] - Robot.BasePosition[1]];
                const HLen = Math.hypot(ToSeam[0], ToSeam[1]) || 1.0;
                Robot.CurrentToolDir = NormalizeVec3([(ToSeam[0] / HLen) * 0.65, (ToSeam[1] / HLen) * 0.65, -0.76]);

                // Emit welding sparks when car is nearby inside/approaching Track H so we don't waste particles across the map
                if (SubT > 0.14 && SubT < 0.22 && Robot.SparkCooldown <= 0.0 &&
                    Math.hypot(CarPos[0] - Robot.BasePosition[0], CarPos[1] - Robot.BasePosition[1]) < 95.0)
                {
                    Robot.SparkCooldown = 0.75;
                    this.EmitCouplerSparks(Sparks, CurWeld, 8, 2500.0);
                }
            }
            else
            {
                const MoveU = SmoothStep01((SubT - 0.42) / 0.58);
                const Pos = LerpVec3(CurWeld, NextWeld, MoveU);
                Pos[2] += 0.62 * Math.sin(Math.PI * MoveU);
                Robot.CurrentTipPos = Pos;
                const ToSeam = [Pos[0] - Robot.BasePosition[0], Pos[1] - Robot.BasePosition[1]];
                const HLen = Math.hypot(ToSeam[0], ToSeam[1]) || 1.0;
                Robot.CurrentToolDir = NormalizeVec3([
                    (ToSeam[0] / HLen) * 0.72,
                    (ToSeam[1] / HLen) * 0.72,
                    -0.69 + 0.25 * Math.sin(Math.PI * MoveU)
                ]);
            }
        }

        this.ApplyTransforms(false);
        return true;
    }

    AbortStation(Station)
    {
        this.Audio.PlayAbortRelease();
        this.Notify(Station.Kind === "electric"
            ? "⚡ Auto-EV Charge released — vehicle departed bay"
            : "⛽ Auto-Fuel Coupler released — vehicle departed bay");
        Station.RetractFromTip = Station.CurrentTipPos.slice();
        Station.RetractFromDir = Station.CurrentToolDir.slice();
        Station.State = "retracting";
        Station.StateTimer = 0.0;
    }

    WriteRobotOccupants(Robot, IK, InitialSnap)
    {
        const Write = (OccupantIdx, Pos, Quat, MovingFlag) =>
        {
            const Occ = this.Scene.Occupants[OccupantIdx];
            if (!Occ)
                return;
            if (!InitialSnap)
                Occ.PreviousTransform.set(Occ.Transform);
            Occ.Transform = ConstructRigidTransform(Pos, Quat);
            if (InitialSnap)
                Occ.PreviousTransform = Occ.Transform.slice();
            Occ.Moving = !InitialSnap && MovingFlag;
        };

        Write(Robot.PedestalOccupant, IK.PedestalPos, IK.QPedestal, false);
        Write(Robot.TurretOccupant,   IK.TurretPos,   IK.QTurret,   true);
        Write(Robot.UpperArmOccupant, IK.ShoulderPos, IK.QUpper,    true);
        Write(Robot.ForearmOccupant,  IK.ElbowPos,    IK.QForearm,  true);
        Write(Robot.WristOccupant,    IK.WristPos,    IK.QWrist,    true);
    }

    ApplyTransforms(InitialSnap = false)
    {
        for (const Station of this.Stations)
        {
            const IK = SolveIndustrialRobotArmIK(
                Station.BasePosition,
                Station.BaseYaw,
                Station.CurrentTipPos,
                Station.CurrentToolDir
            );
            Station.LastIK = IK;
            this.WriteRobotOccupants(Station, IK, InitialSnap);
        }
        for (const Robot of this.FactoryRobots)
        {
            const IK = SolveIndustrialRobotArmIK(
                Robot.BasePosition,
                Robot.BaseYaw,
                Robot.CurrentTipPos,
                Robot.CurrentToolDir
            );
            Robot.LastIK = IK;
            this.WriteRobotOccupants(Robot, IK, InitialSnap);
        }
    }

    QuerySummary()
    {
        const Active = this.Stations.find((S) => S.State !== "idle" && S.State !== "complete");
        return {
            StationCount:      this.Stations.length,
            FactoryRobotCount: this.FactoryRobots.length,
            TotalRobotCount:   this.Stations.length + this.FactoryRobots.length,
            ActiveKind:        Active ? Active.Kind : null,
            ActiveName:        Active ? Active.Name : null,
            ActiveState:       Active ? Active.State : "idle",
            ActivePercent:     Active ? Math.round(Active.Progress * 100) : 0,
            FuelPercent:       Math.round(this.FuelLevel * 100),
            ChargePercent:     Math.round(this.ChargeLevel * 100),
            BatteryPercent:    Math.round(this.ChargeLevel * 100),
            ServicedCount:     this.ServicedCount,
            CompletedServices: this.ServicedCount
        };
    }
}
