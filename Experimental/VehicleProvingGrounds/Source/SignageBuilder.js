//============================================================================================================================================
//                                                          SIGNAGEBUILDER.JS
//============================================================================================================================================
// 🧩 Highway Overhead Waypoint Gantries ("500 KM TO AIRPORT", "500 M TO X CITY"), Construction Zone Signage & Amber Work Lights,
//    Corrugated Steel W-Beam Highway Railguards, and Multi-Variant Knockable Traffic Cones (Drums, Slim Pylons, Stubby Cones).

import { CourseMaterial } from "./MaterialSpecification.js";
import { EmitQuad, EmitBoxFacets, EmitCornerBoxFacets, ConeConstants, ResolveConeHullPoints } from "./CourseStructure.js";

//------------------------------------------------------------------------------------------------------------------------
//                           5×7 VECTOR HIGHWAY SIGN FONT & DIRECTIONAL PICTOGRAMS
//------------------------------------------------------------------------------------------------------------------------

const GlyphRows5x7 = Object.freeze({
    A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
    H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
    K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
    X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
    "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
    "6": ["01111", "10000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00001", "11110"],
    "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
    ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
    ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
    "/": ["00111", "00011", "00101", "01000", "10000", "00000", "00000"],
    "\\": ["11100", "11000", "10100", "00010", "00001", "00000", "00000"],
    "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
    "^": ["00100", "01110", "10101", "00100", "00100", "00100", "00100"],
    "v": ["00100", "00100", "00100", "00100", "10101", "01110", "00100"],
    "<": ["00010", "00100", "01000", "11111", "01000", "00100", "00010"],
    ">": ["01000", "00100", "00010", "11111", "00010", "00100", "01000"]
});

// 📝 Emits crisp merged horizontal run-length quads for 3D highway & construction sign lettering in world space.
//    FaceOrigin is the sign face center; RightAxis (+U across sign) and UpAxis (+V up sign) form a right-handed frame
//    whose outward face normal is RightAxis × UpAxis (so CCW quad [BL, BR, TR, TL] faces the oncoming driver!).
export function EmitSignTextFacets(Facets, Text, FaceOrigin, RightAxis, UpAxis, CharHeight, Material, LiftOut = 0.008)
{
    const Upper = String(Text || "").toUpperCase();
    if (!Upper.length)
        return;
    const Normal = [
        RightAxis[1] * UpAxis[2] - RightAxis[2] * UpAxis[1],
        RightAxis[2] * UpAxis[0] - RightAxis[0] * UpAxis[2],
        RightAxis[0] * UpAxis[1] - RightAxis[1] * UpAxis[0]
    ];
    const PixelH = CharHeight / 7.0;
    const PixelW = PixelH * 0.88;
    const Advance = PixelW * 6.2;
    const TotalWidth = Upper.length * Advance - PixelW * 1.2;
    const StartU = -0.5 * TotalWidth;
    const TopV = 0.5 * CharHeight;

    const ToWorld = (U, V) => [
        FaceOrigin[0] + RightAxis[0] * U + UpAxis[0] * V + Normal[0] * LiftOut,
        FaceOrigin[1] + RightAxis[1] * U + UpAxis[1] * V + Normal[1] * LiftOut,
        FaceOrigin[2] + RightAxis[2] * U + UpAxis[2] * V + Normal[2] * LiftOut
    ];

    for (let CharIdx = 0; CharIdx < Upper.length; ++CharIdx)
    {
        const Ch = Upper[CharIdx];
        if (Ch === " ")
            continue;
        const Rows = GlyphRows5x7[Ch];
        if (!Rows)
            continue;
        const BaseU = StartU + CharIdx * Advance;
        for (let Row = 0; Row < 7; ++Row)
        {
            const Bits = Rows[Row];
            let Col = 0;
            while (Col < 5)
            {
                if (Bits[Col] !== "1")
                {
                    Col++;
                    continue;
                }
                let EndCol = Col + 1;
                while (EndCol < 5 && Bits[EndCol] === "1")
                    EndCol++;
                const U0 = BaseU + Col * PixelW;
                const U1 = BaseU + EndCol * PixelW;
                const V1 = TopV - Row * PixelH;
                const V0 = TopV - (Row + 1) * PixelH;
                EmitQuad(Facets, ToWorld(U0, V0), ToWorld(U1, V0), ToWorld(U1, V1), ToWorld(U0, V1), Material);
                Col = EndCol;
            }
        }
    }
}

// 📝 Emits a framed highway sign face border + two or one lines of crisp 3D lettering facing oncoming Yaw!
export function EmitSignPanelOverlay(Facets, Center, Yaw, Width, Height, BorderMaterial, TextMaterial, Line1, Line2 = "")
{
    // Oncoming traffic travels along (cos Yaw, sin Yaw), so sign face normal points (-cos Yaw, -sin Yaw, 0).
    // RightAxis × UpAxis = Normal => RightAxis = (sin Yaw, -cos Yaw, 0), UpAxis = (0, 0, 1).
    const CosY = Math.cos(Yaw), SinY = Math.sin(Yaw);
    const Right = [SinY, -CosY, 0.0];
    const Up = [0.0, 0.0, 1.0];
    const Normal = [-CosY, -SinY, 0.0];
    const Lift = 0.006;
    const Point = (U, V, Extra = Lift) => [
        Center[0] + Right[0] * U + Up[0] * V + Normal[0] * Extra,
        Center[1] + Right[1] * U + Up[1] * V + Normal[1] * Extra,
        Center[2] + Right[2] * U + Up[2] * V + Normal[2] * Extra
    ];
    const HW = 0.5 * Width - 0.08;
    const HH = 0.5 * Height - 0.08;
    const Border = 0.065;
    EmitQuad(Facets, Point(-HW, HH - Border), Point(HW, HH - Border), Point(HW, HH), Point(-HW, HH), BorderMaterial);
    EmitQuad(Facets, Point(-HW, -HH), Point(HW, -HH), Point(HW, -HH + Border), Point(-HW, -HH + Border), BorderMaterial);
    EmitQuad(Facets, Point(-HW, -HH + Border), Point(-HW + Border, -HH + Border), Point(-HW + Border, HH - Border), Point(-HW, HH - Border), BorderMaterial);
    EmitQuad(Facets, Point(HW - Border, -HH + Border), Point(HW, -HH + Border), Point(HW, HH - Border), Point(HW - Border, HH - Border), BorderMaterial);

    if (Line2)
    {
        const UpperCenter = [Center[0], Center[1], Center[2] + Height * 0.21];
        const LowerCenter = [Center[0], Center[1], Center[2] - Height * 0.22];
        EmitSignTextFacets(Facets, Line1, UpperCenter, Right, Up, Height * 0.30, TextMaterial, 0.011);
        EmitSignTextFacets(Facets, Line2, LowerCenter, Right, Up, Height * 0.25, TextMaterial, 0.011);
    }
    else
    {
        EmitSignTextFacets(Facets, Line1, Center, Right, Up, Height * 0.38, TextMaterial, 0.011);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                           MULTI-VARIANT CLOSED 2-MANIFOLD CONE EMITTERS & JOLT SPECS
//------------------------------------------------------------------------------------------------------------------------

// 📝 Closed 2-manifold solid of revolution around +Z from [0,0,0] through Profile = [[R, Z, Material], ...] to [0,0,ZTop].
function EmitRevolvedProfileFacets(Profile, TopZ, TopMaterial, Segments = 16)
{
    const Facets = [];
    const BaseR = Profile[0][0];
    const BaseMat = Profile[0][2];
    for (let Seg = 0; Seg < Segments; ++Seg)
    {
        const A0 = (2.0 * Math.PI * Seg) / Segments;
        const A1 = (2.0 * Math.PI * (Seg + 1)) / Segments;
        const C0 = Math.cos(A0), S0 = Math.sin(A0);
        const C1 = Math.cos(A1), S1 = Math.sin(A1);

        // Bottom cap fan (normal -Z: [center, A1, A0])
        Facets.push({
            Corners: [[0.0, 0.0, 0.0], [BaseR * C1, BaseR * S1, 0.0], [BaseR * C0, BaseR * S0, 0.0]],
            Normals: [[0.0, 0.0, -1.0], [0.0, 0.0, -1.0], [0.0, 0.0, -1.0]],
            Family:  BaseMat
        });

        for (let Band = 0; Band + 1 < Profile.length; ++Band)
        {
            const [R0, Z0] = Profile[Band];
            const [R1, Z1, BandMat] = Profile[Band + 1];
            const P00 = [R0 * C0, R0 * S0, Z0];
            const P10 = [R0 * C1, R0 * S1, Z0];
            const P11 = [R1 * C1, R1 * S1, Z1];
            const P01 = [R1 * C0, R1 * S0, Z1];
            const DZ = Z1 - Z0, DR = R0 - R1;
            const Len = Math.hypot(DZ, DR) || 1.0;
            const NR = DZ / Len, NZ = DR / Len;
            const N0 = [C0 * NR, S0 * NR, NZ];
            const N1 = [C1 * NR, S1 * NR, NZ];
            Facets.push({ Corners: [P00, P10, P11], Normals: [N0, N1, N1], Family: BandMat });
            Facets.push({ Corners: [P00, P11, P01], Normals: [N0, N1, N0], Family: BandMat });
        }

        const [LastR, LastZ] = Profile[Profile.length - 1];
        Facets.push({
            Corners: [[LastR * C0, LastR * S0, LastZ], [LastR * C1, LastR * S1, LastZ], [0.0, 0.0, TopZ]],
            Normals: [[0.0, 0.0, 1.0], [0.0, 0.0, 1.0], [0.0, 0.0, 1.0]],
            Family:  TopMaterial
        });
    }
    return Facets;
}

// ① Highway Construction Channelizer Barrel / Drum (96 cm tall orange & white striped barrel on weighted rubber base)
export function EmitConstructionDrumFacets()
{
    return EmitRevolvedProfileFacets([
        [0.31, 0.00, CourseMaterial.Tyre],
        [0.31, 0.06, CourseMaterial.Tyre],
        [0.24, 0.08, CourseMaterial.ConeOrange],
        [0.235, 0.26, CourseMaterial.ConeOrange],
        [0.230, 0.42, CourseMaterial.ConeStripe],
        [0.222, 0.58, CourseMaterial.ConeOrange],
        [0.215, 0.74, CourseMaterial.ConeStripe],
        [0.205, 0.92, CourseMaterial.ConeOrange],
        [0.140, 0.95, CourseMaterial.ConeOrange]
    ], 0.96, CourseMaterial.ConeOrange, 16);
}

// ② Tall Slim Yellow/White Motorway Delineator Pylon Cone (86 cm high-visibility lane delineator)
export function EmitSlimPylonConeFacets()
{
    return EmitRevolvedProfileFacets([
        [0.21, 0.00, CourseMaterial.Tyre],
        [0.21, 0.04, CourseMaterial.Tyre],
        [0.115, 0.06, CourseMaterial.PaintYellow],
        [0.102, 0.34, CourseMaterial.PaintYellow],
        [0.094, 0.48, CourseMaterial.ConeStripe],
        [0.086, 0.60, CourseMaterial.PaintYellow],
        [0.079, 0.72, CourseMaterial.ConeStripe],
        [0.070, 0.84, CourseMaterial.PaintYellow]
    ], 0.86, CourseMaterial.BannerAmber, 14);
}

// ③ Stubby Wide-Base Heavy Hazard Cone (50 cm low-CG cobalt & glowing amber construction hazard cone)
export function EmitShortWorkConeFacets()
{
    return EmitRevolvedProfileFacets([
        [0.25, 0.00, CourseMaterial.SteelDark],
        [0.25, 0.045, CourseMaterial.SteelDark],
        [0.185, 0.06, CourseMaterial.WallCobalt],
        [0.145, 0.22, CourseMaterial.WallCobalt],
        [0.115, 0.34, CourseMaterial.BannerAmber],
        [0.082, 0.46, CourseMaterial.WallCobalt],
        [0.052, 0.49, CourseMaterial.BannerAmber]
    ], 0.505, CourseMaterial.BannerAmber, 14);
}

function BuildOctagonalConeHull(BaseRadius, BaseH, TopRadius, TopZ)
{
    const Points = [];
    for (const [Z, Radius] of [[0.0, BaseRadius], [BaseH, BaseRadius], [TopZ, TopRadius]])
    {
        for (let Index = 0; Index < 8; ++Index)
        {
            const Angle = (2.0 * Math.PI * (Index + 0.5)) / 8.0;
            const R = Radius / Math.cos(Math.PI / 8.0);
            Points.push([R * Math.cos(Angle), R * Math.sin(Angle), Z]);
        }
    }
    return Points;
}

export const ConeVariantSpecs = Object.freeze({
    Cone: Object.freeze({
        Shape:        "Cone",
        Mass:         ConeConstants.Mass,
        CentreHeight: ConeConstants.CentreHeight,
        Inertia:      [0.09, 0.09, 0.058],
        HullPoints:   ResolveConeHullPoints()
    }),
    ConstructionDrum: Object.freeze({
        Shape:        "ConstructionDrum",
        Mass:         7.8,
        CentreHeight: 0.28,
        Inertia:      [0.42, 0.42, 0.24],
        HullPoints:   BuildOctagonalConeHull(0.31, 0.07, 0.20, 0.94)
    }),
    SlimPylonCone: Object.freeze({
        Shape:        "SlimPylonCone",
        Mass:         2.2,
        CentreHeight: 0.16,
        Inertia:      [0.07, 0.07, 0.032],
        HullPoints:   BuildOctagonalConeHull(0.21, 0.045, 0.075, 0.85)
    }),
    ShortWorkCone: Object.freeze({
        Shape:        "ShortWorkCone",
        Mass:         4.1,
        CentreHeight: 0.13,
        Inertia:      [0.08, 0.08, 0.075],
        HullPoints:   BuildOctagonalConeHull(0.25, 0.05, 0.06, 0.49)
    })
});

//------------------------------------------------------------------------------------------------------------------------
//                  HIGHWAY STEEL W-BEAM RAILGUARDS, WAYPOINT GANTRIES & CONSTRUCTION FIXTURES
//------------------------------------------------------------------------------------------------------------------------

// 📝 4.0 m Corrugated Steel Highway W-Beam Guardrail on twin I-posts (disjoint closed boxes -> exact 2-manifold!).
export function EmitGuardrailSectionFacets()
{
    const Facets = [];
    // Twin galvanized steel posts at X = ±1.35 m (Y: -0.14 .. -0.02, Z: 0.0 .. 0.80)
    Facets.push(...EmitCornerBoxFacets([-1.44, -0.15, 0.0], [-1.26, -0.02, 0.80], CourseMaterial.SteelDark));
    Facets.push(...EmitCornerBoxFacets([ 1.26, -0.15, 0.0], [ 1.44, -0.02, 0.80], CourseMaterial.SteelDark));
    // Lower & upper corrugated W-beam steel rails + central reflective safety stripe (separated by 6 mm for clean manifoldness)
    Facets.push(...EmitCornerBoxFacets([-2.00,  0.00, 0.44], [ 2.00,  0.11, 0.56], CourseMaterial.BarrierConcrete));
    Facets.push(...EmitCornerBoxFacets([-2.00,  0.01, 0.57], [ 2.00,  0.09, 0.64], CourseMaterial.PaintYellow));
    Facets.push(...EmitCornerBoxFacets([-2.00,  0.00, 0.65], [ 2.00,  0.11, 0.77], CourseMaterial.BarrierConcrete));
    return Facets;
}

// 📝 Flared retroreflective highway guardrail bullnose terminal end cap (1.5 m).
export function EmitGuardrailTerminalFacets()
{
    const Facets = [];
    Facets.push(...EmitCornerBoxFacets([-0.14, -0.15, 0.0], [0.14, -0.02, 0.80], CourseMaterial.SteelDark));
    Facets.push(...EmitCornerBoxFacets([-0.78,  0.00, 0.42], [0.78,  0.16, 0.79], CourseMaterial.PaintYellow));
    Facets.push(...EmitCornerBoxFacets([-0.42,  0.17, 0.48], [0.42,  0.21, 0.73], CourseMaterial.KerbRed));
    return Facets;
}

// 📝 Orange/white Type-III Construction A-Frame Barricade with twin glowing amber warning beacons on top!
export function EmitConstructionAFrameFacets()
{
    const Facets = [];
    // Left & right A-frame steel legs
    Facets.push(...EmitCornerBoxFacets([-0.28, -1.32, 0.0], [0.28, -1.16, 1.18], CourseMaterial.SteelDark));
    Facets.push(...EmitCornerBoxFacets([-0.28,  1.16, 0.0], [0.28,  1.32, 1.18], CourseMaterial.SteelDark));
    // Two horizontal orange/white reflective barricade rails
    Facets.push(...EmitCornerBoxFacets([-0.08, -1.14, 0.82], [0.08,  1.14, 1.08], CourseMaterial.ConeOrange));
    Facets.push(...EmitCornerBoxFacets([-0.08, -1.14, 0.44], [0.08,  1.14, 0.68], CourseMaterial.PaintWhite));
    // Twin glowing amber construction flasher lamps perched on top of the legs!
    Facets.push(...EmitCornerBoxFacets([-0.12, -1.30, 1.20], [0.12, -1.18, 1.44], CourseMaterial.BannerAmber));
    Facets.push(...EmitCornerBoxFacets([-0.12,  1.18, 1.20], [0.12,  1.30, 1.44], CourseMaterial.BannerAmber));
    return Facets;
}

// 📝 Tall Portable Construction Floodlight Tower (4.6 m mast + blazing dual amber/white floodlight head).
export function EmitWorkLightTowerFacets()
{
    const Facets = [];
    Facets.push(...EmitCornerBoxFacets([-0.48, -0.48, 0.00], [0.48,  0.48, 0.42], CourseMaterial.PaintYellow));
    Facets.push(...EmitCornerBoxFacets([-0.09, -0.09, 0.44], [0.09,  0.09, 4.25], CourseMaterial.SteelDark));
    Facets.push(...EmitCornerBoxFacets([-0.24, -0.78, 4.28], [0.24,  0.78, 4.66], CourseMaterial.SteelDark));
    Facets.push(...EmitCornerBoxFacets([-0.28, -0.72, 4.32], [-0.25, -0.08, 4.62], CourseMaterial.BannerAmber));
    Facets.push(...EmitCornerBoxFacets([-0.28,  0.08, 4.32], [-0.25,  0.72, 4.62], CourseMaterial.GateLamp));
    return Facets;
}

// 📝 Glowing Amber Trench-Edge Warning Beacon Post (1.32 m).
export function EmitAmberBeaconPostFacets()
{
    const Facets = [];
    Facets.push(...EmitCornerBoxFacets([-0.20, -0.20, 0.00], [0.20, 0.20, 0.08], CourseMaterial.SteelDark));
    Facets.push(...EmitCornerBoxFacets([-0.11, -0.11, 0.09], [0.11, 0.11, 1.02], CourseMaterial.ConeOrange));
    Facets.push(...EmitCornerBoxFacets([-0.15, -0.15, 1.04], [0.15, 0.15, 1.34], CourseMaterial.BannerAmber));
    return Facets;
}

export function ConstructInfrastructureShapes()
{
    return {
        // Multi-variant knockable traffic cones
        ConstructionDrum:   { Emit: EmitConstructionDrumFacets,  Voxel: 0.11, Cards: 6 },
        SlimPylonCone:      { Emit: EmitSlimPylonConeFacets,     Voxel: 0.11, Cards: 6 },
        ShortWorkCone:      { Emit: EmitShortWorkConeFacets,     Voxel: 0.09, Cards: 6 },

        // Highway steel W-beam guardrails
        GuardrailSection:   { Emit: EmitGuardrailSectionFacets,  Voxel: 0.26, Cards: 6 },
        GuardrailTerminal:  { Emit: EmitGuardrailTerminalFacets, Voxel: 0.24, Cards: 6 },

        // Construction site barricades, shoring & glowing work lights
        ConstructionAFrame: { Emit: EmitConstructionAFrameFacets, Voxel: 0.22, Cards: 6 },
        WorkLightTower:     { Emit: EmitWorkLightTowerFacets,     Voxel: 0.0,  Cards: 0, Distance: false },
        AmberBeaconPost:    { Emit: EmitAmberBeaconPostFacets,    Voxel: 0.0,  Cards: 0, Distance: false },
        TrenchShoringStrut: { Emit: () => EmitBoxFacets(0.56, 14.8, 0.52, CourseMaterial.SteelDark), Voxel: 0.0, Cards: 0, Distance: false },

        // Highway overhead waypoint gantries & roadside sign boards
        WaypointGantryLeg:  { Emit: () => EmitBoxFacets(0.68, 0.68, 7.80, CourseMaterial.SteelDark),  Voxel: 0.0, Cards: 0, Distance: false },
        WaypointGantryBeam: { Emit: () => EmitBoxFacets(0.86, 26.8, 0.78, CourseMaterial.SteelDark),  Voxel: 0.0, Cards: 0, Distance: false },
        WaypointBoardGreen: { Emit: () => EmitBoxFacets(0.20, 9.80, 2.50, CourseMaterial.PaintGreen), Voxel: 0.0, Cards: 0, Distance: false },
        WaypointBoardBlue:  { Emit: () => EmitBoxFacets(0.20, 9.20, 2.50, CourseMaterial.WallCobalt), Voxel: 0.0, Cards: 0, Distance: false },
        WaypointBoardAmber: { Emit: () => EmitBoxFacets(0.20, 10.6, 2.45, CourseMaterial.PaintYellow),Voxel: 0.0, Cards: 0, Distance: false },
        RoadsideSignPost:   { Emit: () => EmitBoxFacets(0.14, 0.14, 2.40, CourseMaterial.SteelDark),  Voxel: 0.0, Cards: 0, Distance: false },
        RoadsideBoardGreen: { Emit: () => EmitBoxFacets(0.14, 4.20, 1.55, CourseMaterial.PaintGreen), Voxel: 0.0, Cards: 0, Distance: false },
        RoadsideBoardAmber: { Emit: () => EmitBoxFacets(0.14, 4.20, 1.55, CourseMaterial.PaintYellow),Voxel: 0.0, Cards: 0, Distance: false },
        ChevronHazardBoard: { Emit: () => EmitBoxFacets(0.14, 2.80, 1.25, CourseMaterial.PaintYellow),Voxel: 0.0, Cards: 0, Distance: false }
    };
}
