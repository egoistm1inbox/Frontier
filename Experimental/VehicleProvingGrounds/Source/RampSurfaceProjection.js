//============================================================================================================================================
//                                                       RAMPSURFACEPROJECTION.JS
//============================================================================================================================================
// 🧩 Parametric 3D stunt-race surfaces (360° helical loop, full-pipe, 45° twisted ribbon, over-vert transitions) and watertight slab solids.

import { CourseMaterial } from "./MaterialSpecification.js";
import { AddVector, SubtractVector, ScaleVector, CrossVector, DotVector, NormalizeVector, LengthVector,
         MultiplyAddVector, RotateVector, ConjugateQuaternion, NormalizeQuaternion, ConstructAxisQuaternion,
         ClampScalar } from "./TransformProjection.js";

//------------------------------------------------------------------------------------------------------------------------
//                                                  SURFACE CATEGORIES
//------------------------------------------------------------------------------------------------------------------------

export const SurfaceCategory = Object.freeze({
    HelicalLoop:     0,   // [-] - 360° vertical inversion loop with C² cycloid lateral offset
    FullPipe:        1,   // [-] - Open-ended 360° cylindrical skate full-pipe with outer 45° transition skirts
    TwistedRibbon:   2,   // [-] - Smooth C¹ ruled helicoid twisting from 0° flat to 45° tilted racing deck and back
    TransitionRamp:  3,   // [-] - Cylindrical transition ramp from 0° up to 45°, 80° vert, or 125° over-vert + planar lip
    WaveDeck:        4,   // [-] - Multi-crest sinusoidal camelback roller deck with C¹ flat road tangency
    TabletopRamp:    5,   // [-] - Asymmetric quintic launch ramp -> elevated sky-tabletop -> swept receiver slope
    BankedTurn:      6,   // [-] - 180° progressive parabolic superelevated velodrome bowl with C² wall-ride coping
    HeartlineRibbon: 7,   // [-] - Elevated zero-G heartline S-twist sky-bridge (+α -> 0° -> −α)
    SubmergedTrench: 8,   // [-] - Excavated C² underground tunnel & sunken underpass with retaining walls and roof deck
    SerpentineWave:  9,   // [-] - Alternating-camber banked rhythm wave rollers (+α / −α / +α)
    CollapseDeck:    10,  // [-] - Progressive rear-to-front collapsing bridge / sinkhole road with per-bay live state
    SplineRoad:      11   // [-] - Real-time editable cubic Bézier spline road & flyover network
});

//------------------------------------------------------------------------------------------------------------------------
//                                               BASIS AND FRAME ALGEBRA
//------------------------------------------------------------------------------------------------------------------------

// 📝 Converts a right-handed orthonormal basis (AxisX, AxisY, AxisZ) into a unit quaternion [x, y, z, w] matching ConstructRigidTransform.
export function ConstructBasisQuaternion(AxisX, AxisY, AxisZ)
{
    const M00 = AxisX[0], M10 = AxisX[1], M20 = AxisX[2];
    const M01 = AxisY[0], M11 = AxisY[1], M21 = AxisY[2];
    const M02 = AxisZ[0], M12 = AxisZ[1], M22 = AxisZ[2];
    const Trace = M00 + M11 + M22;
    let Quaternion;
    if (Trace > 0.0)
    {
        const Root = Math.sqrt(Trace + 1.0) * 2.0;
        Quaternion = [(M21 - M12) / Root, (M02 - M20) / Root, (M10 - M01) / Root, 0.25 * Root];
    }
    else if (M00 > M11 && M00 > M22)
    {
        const Root = Math.sqrt(1.0 + M00 - M11 - M22) * 2.0;
        Quaternion = [0.25 * Root, (M01 + M10) / Root, (M02 + M20) / Root, (M21 - M12) / Root];
    }
    else if (M11 > M22)
    {
        const Root = Math.sqrt(1.0 + M11 - M00 - M22) * 2.0;
        Quaternion = [(M01 + M10) / Root, 0.25 * Root, (M12 + M21) / Root, (M02 - M20) / Root];
    }
    else
    {
        const Root = Math.sqrt(1.0 + M22 - M00 - M11) * 2.0;
        Quaternion = [(M02 + M20) / Root, (M12 + M21) / Root, 0.25 * Root, (M10 - M01) / Root];
    }
    return NormalizeQuaternion(Quaternion);
}

function ProjectWorldToSurface(Surface, WorldPoint)
{
    const Offset = SubtractVector(WorldPoint, Surface.Origin);
    const Cosine = Surface.CosineYaw, Sine = Surface.SineYaw;
    return [Cosine * Offset[0] + Sine * Offset[1], -Sine * Offset[0] + Cosine * Offset[1], Offset[2]];
}

function ProjectDirectionToSurface(Surface, WorldDirection)
{
    const Cosine = Surface.CosineYaw, Sine = Surface.SineYaw;
    return [Cosine * WorldDirection[0] + Sine * WorldDirection[1], -Sine * WorldDirection[0] + Cosine * WorldDirection[1], WorldDirection[2]];
}

function ProjectPointFromSurface(Surface, LocalPoint)
{
    const Cosine = Surface.CosineYaw, Sine = Surface.SineYaw;
    return [Surface.Origin[0] + Cosine * LocalPoint[0] - Sine * LocalPoint[1],
            Surface.Origin[1] + Sine * LocalPoint[0] + Cosine * LocalPoint[1],
            Surface.Origin[2] + LocalPoint[2]];
}

function ProjectDirectionFromSurface(Surface, LocalDirection)
{
    const Cosine = Surface.CosineYaw, Sine = Surface.SineYaw;
    return [Cosine * LocalDirection[0] - Sine * LocalDirection[1],
            Sine * LocalDirection[0] + Cosine * LocalDirection[1],
            LocalDirection[2]];
}

function IntersectBoundsRay(Origin, Direction, Minimum, Maximum, MaximumTravel)
{
    let Near = 0.0, Far = MaximumTravel;
    for (let Axis = 0; Axis < 3; ++Axis)
    {
        const Component = Direction[Axis];
        if (Math.abs(Component) < 1.0e-9)
        {
            if (Origin[Axis] < Minimum[Axis] || Origin[Axis] > Maximum[Axis])
                return false;
            continue;
        }
        const Reciprocal = 1.0 / Component;
        let Entry = (Minimum[Axis] - Origin[Axis]) * Reciprocal;
        let Exit  = (Maximum[Axis] - Origin[Axis]) * Reciprocal;
        if (Entry > Exit)
        {
            const Swap = Entry;
            Entry = Exit;
            Exit = Swap;
        }
        Near = Math.max(Near, Entry);
        Far  = Math.min(Far, Exit);
        if (Near > Far)
            return false;
    }
    return true;
}

//------------------------------------------------------------------------------------------------------------------------
//                                              WATERTIGHT SLAB SOLID BUILDER
//------------------------------------------------------------------------------------------------------------------------

// 📝 Builds a closed, outward counter-clockwise 2-manifold hexahedral grid slab from TopGrid[i][j] and BottomGrid[i][j],
//    where +i is forward (+u), +j is across (+v, right-to-left), and (∂P/∂u × ∂P/∂v) points along +TopNormal.
export function ConstructClosedGridSlabFacets(TopGrid, BottomGrid, TopNormals, TopFamilies, FlankFamily, UndersideFamily)
{
    const CountU = TopGrid.length - 1;
    const CountV = TopGrid[0].length - 1;
    const Facets = [];
    const AppendQuad = (A, B, C, D, Family) =>
    {
        Facets.push({ Corners: [A, B, C], Family });
        Facets.push({ Corners: [A, C, D], Family });
    };

    // ① Top driving surface with smooth corner normals
    for (let IndexU = 0; IndexU < CountU; ++IndexU)
    {
        for (let IndexV = 0; IndexV < CountV; ++IndexV)
        {
            const P00 = TopGrid[IndexU][IndexV],     P10 = TopGrid[IndexU + 1][IndexV];
            const P11 = TopGrid[IndexU + 1][IndexV + 1], P01 = TopGrid[IndexU][IndexV + 1];
            const Family = TopFamilies[IndexU][IndexV];
            if (TopNormals)
            {
                const N00 = TopNormals[IndexU][IndexV],     N10 = TopNormals[IndexU + 1][IndexV];
                const N11 = TopNormals[IndexU + 1][IndexV + 1], N01 = TopNormals[IndexU][IndexV + 1];
                Facets.push({ Corners: [P00, P10, P11], Normals: [N00, N10, N11], Family });
                Facets.push({ Corners: [P00, P11, P01], Normals: [N00, N11, N01], Family });
            }
            else
            {
                AppendQuad(P00, P10, P11, P01, Family);
            }
        }
    }

    // ② Underside shell (−N outward)
    for (let IndexU = 0; IndexU < CountU; ++IndexU)
    {
        for (let IndexV = 0; IndexV < CountV; ++IndexV)
        {
            AppendQuad(BottomGrid[IndexU][IndexV + 1], BottomGrid[IndexU + 1][IndexV + 1],
                       BottomGrid[IndexU + 1][IndexV], BottomGrid[IndexU][IndexV], UndersideFamily);
        }
    }

    // ③ Start cap (−u outward) and End cap (+u outward)
    for (let IndexV = 0; IndexV < CountV; ++IndexV)
    {
        AppendQuad(BottomGrid[0][IndexV], TopGrid[0][IndexV], TopGrid[0][IndexV + 1], BottomGrid[0][IndexV + 1], FlankFamily);
        AppendQuad(BottomGrid[CountU][IndexV + 1], TopGrid[CountU][IndexV + 1], TopGrid[CountU][IndexV], BottomGrid[CountU][IndexV], FlankFamily);
    }

    // ④ Right flank (IndexV = 0, −v outward) and Left flank (IndexV = CountV, +v outward)
    for (let IndexU = 0; IndexU < CountU; ++IndexU)
    {
        AppendQuad(BottomGrid[IndexU + 1][0], TopGrid[IndexU + 1][0], TopGrid[IndexU][0], BottomGrid[IndexU][0], FlankFamily);
        AppendQuad(BottomGrid[IndexU][CountV], TopGrid[IndexU][CountV], TopGrid[IndexU + 1][CountV], BottomGrid[IndexU + 1][CountV], FlankFamily);
    }

    return Facets;
}

// 📝 Re-expresses world-space facets into a compact surface-aligned local frame (FrameOrigin, FrameQuaternion).
export function TransformFacetsToLocalFrame(Facets, FrameOrigin, FrameQuaternion)
{
    const Inverse = ConjugateQuaternion(FrameQuaternion);
    return Facets.map((Facet) =>
    {
        const Corners = Facet.Corners.map((Corner) => RotateVector(Inverse, SubtractVector(Corner, FrameOrigin)));
        if (!Facet.Normals)
            return { Corners, Family: Facet.Family };
        const Normals = Facet.Normals.map((Normal) => RotateVector(Inverse, Normal));
        return { Corners, Normals, Family: Facet.Family };
    });
}

//------------------------------------------------------------------------------------------------------------------------
//                                             SURFACE CONSTRUCTORS
//------------------------------------------------------------------------------------------------------------------------

function FinalizeSurfaceBounds(Surface, LocalMinimum, LocalMaximum)
{
    const Corners = [
        [LocalMinimum[0], LocalMinimum[1], LocalMinimum[2]], [LocalMaximum[0], LocalMinimum[1], LocalMinimum[2]],
        [LocalMinimum[0], LocalMaximum[1], LocalMinimum[2]], [LocalMaximum[0], LocalMaximum[1], LocalMinimum[2]],
        [LocalMinimum[0], LocalMinimum[1], LocalMaximum[2]], [LocalMaximum[0], LocalMaximum[1], LocalMaximum[2]],
        [LocalMaximum[0], LocalMinimum[1], LocalMaximum[2]], [LocalMinimum[0], LocalMaximum[1], LocalMaximum[2]]
    ];
    const WorldMinimum = [Infinity, Infinity, Infinity], WorldMaximum = [-Infinity, -Infinity, -Infinity];
    for (const Corner of Corners)
    {
        const World = ProjectPointFromSurface(Surface, Corner);
        for (let Axis = 0; Axis < 3; ++Axis)
        {
            WorldMinimum[Axis] = Math.min(WorldMinimum[Axis], World[Axis] - 1.0);
            WorldMaximum[Axis] = Math.max(WorldMaximum[Axis], World[Axis] + 1.0);
        }
    }
    Surface.WorldMinimum = WorldMinimum;
    Surface.WorldMaximum = WorldMaximum;
    return Surface;
}

export function ConstructHelicalLoopSurface(Configuration)
{
    const Yaw = Configuration.Yaw || 0.0;
    const Radius = Configuration.Radius;
    const Width = Configuration.Width;
    const HelicalShift = Configuration.HelicalShift;
    const Thickness = Configuration.Thickness || 0.68;
    const KerbWidth = Configuration.KerbWidth || 0.55;
    const KerbHeight = Configuration.KerbHeight || 0.26;
    const Surface = {
        Category:     SurfaceCategory.HelicalLoop,
        Key:          Configuration.Key,
        Origin:       Configuration.Origin.slice(),
        Yaw,
        CosineYaw:    Math.cos(Yaw),
        SineYaw:      Math.sin(Yaw),
        Radius,
        Width,
        HalfWidth:    0.5 * Width,
        HelicalShift,
        Thickness,
        KerbWidth,
        KerbHeight,
        ShapePrefix:    Configuration.ShapePrefix || Configuration.Key,
        AccentMaterial: Configuration.AccentMaterial ?? CourseMaterial.PaintYellow
    };
    const MinY = Math.min(0.0, HelicalShift) - Surface.HalfWidth - 1.0;
    const MaxY = Math.max(0.0, HelicalShift) + Surface.HalfWidth + 1.0;
    return FinalizeSurfaceBounds(Surface, [-Radius - Thickness - 1.0, MinY, -Thickness - 0.5],
                                 [Radius + Thickness + 1.0, MaxY, 2.0 * Radius + Thickness + 1.0]);
}

export function ConstructFullPipeSurface(Configuration)
{
    const Yaw = Configuration.Yaw || 0.0;
    const Radius = Configuration.Radius;
    const Length = Configuration.Length;
    const Thickness = Configuration.Thickness || 0.72;
    const SkirtRadius = Configuration.SkirtRadius || 8.0;
    const SkirtAngle = Configuration.SkirtAngle || (Math.PI * 0.25);
    const SkirtSpan = SkirtRadius * Math.sin(SkirtAngle);
    const Surface = {
        Category:    SurfaceCategory.FullPipe,
        Key:         Configuration.Key,
        Origin:      Configuration.Origin.slice(),
        Yaw,
        CosineYaw:   Math.cos(Yaw),
        SineYaw:     Math.sin(Yaw),
        Radius,
        Length,
        HalfLength:  0.5 * Length,
        Thickness,
        SkirtRadius,
        SkirtAngle,
        SkirtSpan,
        OuterOffsetY: Radius + Thickness + SkirtSpan
    };
    const ReachY = Surface.OuterOffsetY + 1.0;
    return FinalizeSurfaceBounds(Surface, [-Surface.HalfLength - 1.0, -ReachY, -Thickness - 0.5],
                                 [Surface.HalfLength + 1.0, ReachY, 2.0 * Radius + Thickness + 1.0]);
}

export function ConstructTwistedRibbonSurface(Configuration)
{
    const Yaw = Configuration.Yaw || 0.0;
    const Length = Configuration.Length;
    const Width = Configuration.Width;
    const TwistLength = Configuration.TwistLength;
    const PeakAngle = Configuration.PeakAngle ?? (Math.PI * 0.25);
    const Thickness = Configuration.Thickness || 0.62;
    const Sign = Configuration.BankSign ?? 1.0;
    const Surface = {
        Category:    SurfaceCategory.TwistedRibbon,
        Key:         Configuration.Key,
        Origin:      Configuration.Origin.slice(),
        Yaw,
        CosineYaw:   Math.cos(Yaw),
        SineYaw:     Math.sin(Yaw),
        Length,
        HalfLength:  0.5 * Length,
        Width,
        TwistLength,
        PeakAngle:      PeakAngle * Sign,
        Thickness,
        ShapePrefix:    Configuration.ShapePrefix || Configuration.Key,
        AccentMaterial: Configuration.AccentMaterial ?? CourseMaterial.PaintBlue
    };
    return FinalizeSurfaceBounds(Surface, [-Surface.HalfLength - 1.0, -Width - Thickness - 1.0, -Thickness - 0.5],
                                 [Surface.HalfLength + 1.0, Width + Thickness + 1.0, Width + Thickness + 1.0]);
}

export function ConstructTransitionRampSurface(Configuration)
{
    const Yaw = Configuration.Yaw || 0.0;
    const Radius = Configuration.Radius;
    const Width = Configuration.Width;
    const MaximumAngle = Configuration.MaximumAngle;
    const Extension = Configuration.Extension || 0.0;
    const Thickness = Configuration.Thickness || 0.68;
    const EndSin = Math.sin(MaximumAngle), EndCos = Math.cos(MaximumAngle);
    const ArcEndX = Radius * EndSin;
    const ArcEndZ = Radius * (1.0 - EndCos);
    const TipX = ArcEndX + Extension * EndCos;
    const TipZ = ArcEndZ + Extension * EndSin;
    const MaximumX = Math.max(Radius, ArcEndX, TipX) + Thickness + 1.0;
    const MinimumX = Math.min(0.0, TipX) - Thickness - 1.0;
    const MaximumZ = Math.max(ArcEndZ, TipZ, MaximumAngle > Math.PI * 0.5 ? Radius + Radius * Math.sin(MaximumAngle - Math.PI * 0.5) : 0.0) + Thickness + 1.0;
    const Surface = {
        Category:     SurfaceCategory.TransitionRamp,
        Key:          Configuration.Key,
        Origin:       Configuration.Origin.slice(),
        Yaw,
        CosineYaw:    Math.cos(Yaw),
        SineYaw:      Math.sin(Yaw),
        Radius,
        Width,
        HalfWidth:    0.5 * Width,
        MaximumAngle,
        Extension,
        Thickness,
        ArcEndX,
        ArcEndZ,
        TipX,
        TipZ,
        ShapePrefix:    Configuration.ShapePrefix || Configuration.Key,
        AccentMaterial: Configuration.AccentMaterial ?? CourseMaterial.KerbRed
    };
    return FinalizeSurfaceBounds(Surface, [MinimumX, -Surface.HalfWidth - 1.0, -Thickness - 0.5],
                                 [MaximumX, Surface.HalfWidth + 1.0, MaximumZ]);
}

export function ConstructWaveDeckSurface(Configuration)
{
    const Yaw = Configuration.Yaw || 0.0;
    const Length = Configuration.Length;
    const Width = Configuration.Width;
    const WaveCount = Math.max(1, Math.round(Configuration.WaveCount || 3));
    const Amplitude = Configuration.Amplitude ?? 1.80;
    const Thickness = Configuration.Thickness || 0.58;
    const Surface = {
        Category:       SurfaceCategory.WaveDeck,
        Key:            Configuration.Key,
        Origin:         Configuration.Origin.slice(),
        Yaw,
        CosineYaw:      Math.cos(Yaw),
        SineYaw:        Math.sin(Yaw),
        Length,
        HalfLength:     0.5 * Length,
        Width,
        HalfWidth:      0.5 * Width,
        WaveCount,
        Amplitude,
        Thickness,
        KerbWidth:      Configuration.KerbWidth ?? 0.60,
        KerbHeight:     Configuration.KerbHeight ?? 0.22,
        ShapePrefix:    Configuration.ShapePrefix || Configuration.Key,
        AccentMaterial: Configuration.AccentMaterial ?? CourseMaterial.PaintBlue
    };
    return FinalizeSurfaceBounds(Surface, [-Surface.HalfLength - 1.0, -Surface.HalfWidth - 1.0, -Thickness - 0.5],
                                 [Surface.HalfLength + 1.0, Surface.HalfWidth + 1.0, Amplitude + Surface.KerbHeight + 1.0]);
}

export function ConstructTabletopRampSurface(Configuration)
{
    const Yaw = Configuration.Yaw || 0.0;
    const UpLength = Configuration.UpLength ?? 16.0;
    const DeckLength = Configuration.DeckLength ?? 12.0;
    const DownLength = Configuration.DownLength ?? 22.0;
    const TotalLength = UpLength + DeckLength + DownLength;
    const Width = Configuration.Width ?? 14.0;
    const Height = Configuration.Height ?? 3.6;
    const Thickness = Configuration.Thickness || 0.64;
    const Surface = {
        Category:       SurfaceCategory.TabletopRamp,
        Key:            Configuration.Key,
        Origin:         Configuration.Origin.slice(),
        Yaw,
        CosineYaw:      Math.cos(Yaw),
        SineYaw:        Math.sin(Yaw),
        UpLength,
        DeckLength,
        DownLength,
        TotalLength,
        Width,
        HalfWidth:      0.5 * Width,
        Height,
        Thickness,
        KerbWidth:      Configuration.KerbWidth ?? 0.60,
        KerbHeight:     Configuration.KerbHeight ?? 0.24,
        ShapePrefix:    Configuration.ShapePrefix || Configuration.Key,
        AccentMaterial: Configuration.AccentMaterial ?? CourseMaterial.KerbRed
    };
    return FinalizeSurfaceBounds(Surface, [-1.0, -Surface.HalfWidth - 1.0, -Thickness - 0.5],
                                 [TotalLength + 1.0, Surface.HalfWidth + 1.0, Height + Surface.KerbHeight + 1.2]);
}

export function ConstructBankedTurnSurface(Configuration)
{
    const InnerRadius = Configuration.InnerRadius ?? 26.0;
    const OuterRadius = Configuration.OuterRadius ?? 42.0;
    const Width = OuterRadius - InnerRadius;
    const StartAngle = Configuration.StartAngle ?? (-0.5 * Math.PI);
    const SweepAngle = Configuration.SweepAngle ?? Math.PI;
    const MinimumSlope = Configuration.MinimumSlope ?? 0.24;
    const PeakSlope = Configuration.PeakSlope ?? 1.08;
    const CopingWidth = Configuration.CopingWidth ?? 2.4;
    const CopingLift = Configuration.CopingLift ?? 1.20;
    const Thickness = Configuration.Thickness || 0.68;
    const MaximumHeight = Width * 0.5 * (MinimumSlope + PeakSlope) + CopingLift + 1.5;
    const Surface = {
        Category:       SurfaceCategory.BankedTurn,
        Key:            Configuration.Key,
        Origin:         Configuration.Origin.slice(),
        Yaw:            0.0,
        CosineYaw:      1.0,
        SineYaw:        0.0,
        InnerRadius,
        OuterRadius,
        Width,
        StartAngle,
        SweepAngle,
        RampAngle:      Configuration.RampAngle ?? (0.20 * Math.PI),
        MinimumSlope,
        PeakSlope,
        CopingWidth,
        CopingLift,
        Thickness,
        ShapePrefix:    Configuration.ShapePrefix || Configuration.Key,
        AccentMaterial: Configuration.AccentMaterial ?? CourseMaterial.PaintYellow
    };
    return FinalizeSurfaceBounds(Surface, [-OuterRadius - 2.0, -OuterRadius - 2.0, -Thickness - 0.5],
                                 [OuterRadius + 2.0, OuterRadius + 2.0, MaximumHeight]);
}

export function ConstructHeartlineRibbonSurface(Configuration)
{
    const Yaw = Configuration.Yaw || 0.0;
    const Length = Configuration.Length ?? 84.0;
    const Width = Configuration.Width ?? 13.6;
    const BridgeHeight = Configuration.BridgeHeight ?? 5.4;
    const PeakAngle = (Configuration.PeakAngle ?? (44.0 * Math.PI / 180.0)) * (Configuration.BankSign ?? 1.0);
    const Thickness = Configuration.Thickness || 0.62;
    const MaximumZ = BridgeHeight + 0.5 * Width * Math.sin(Math.abs(PeakAngle)) + 1.5;
    const Surface = {
        Category:       SurfaceCategory.HeartlineRibbon,
        Key:            Configuration.Key,
        Origin:         Configuration.Origin.slice(),
        Yaw,
        CosineYaw:      Math.cos(Yaw),
        SineYaw:        Math.sin(Yaw),
        Length,
        HalfLength:     0.5 * Length,
        Width,
        HalfWidth:      0.5 * Width,
        BridgeHeight,
        PeakAngle,
        RampFraction:   Configuration.RampFraction ?? 0.16,
        CrossFraction:  Configuration.CrossFraction ?? 0.24,
        Thickness,
        KerbWidth:      Configuration.KerbWidth ?? 0.60,
        KerbHeight:     Configuration.KerbHeight ?? 0.22,
        ShapePrefix:    Configuration.ShapePrefix || Configuration.Key,
        AccentMaterial: Configuration.AccentMaterial ?? CourseMaterial.PaintBlue
    };
    return FinalizeSurfaceBounds(Surface, [-Surface.HalfLength - 1.0, -Surface.HalfWidth - 1.0, -Thickness - 0.5],
                                 [Surface.HalfLength + 1.0, Surface.HalfWidth + 1.0, MaximumZ]);
}

function ComputeWorldSpanBox(Surface, X0, X1, HalfSpanY)
{
    const Corners = [
        ProjectPointFromSurface(Surface, [X0, -HalfSpanY, 0.0]),
        ProjectPointFromSurface(Surface, [X1, -HalfSpanY, 0.0]),
        ProjectPointFromSurface(Surface, [X1,  HalfSpanY, 0.0]),
        ProjectPointFromSurface(Surface, [X0,  HalfSpanY, 0.0])
    ];
    return [
        Math.min(...Corners.map((C) => C[0])),
        Math.min(...Corners.map((C) => C[1])),
        Math.max(...Corners.map((C) => C[0])),
        Math.max(...Corners.map((C) => C[1]))
    ];
}

export function ConstructSubmergedTrenchSurface(Configuration)
{
    const Yaw = Configuration.Yaw || 0.0;
    const DeadEnd = Boolean(Configuration.DeadEnd);
    const DownLength = Configuration.DownLength ?? 28.0;
    const TunnelLength = Configuration.TunnelLength ?? 48.0;
    const UpLength = DeadEnd ? 0.0 : (Configuration.UpLength ?? 28.0);
    const TotalLength = DownLength + TunnelLength + UpLength;
    const Width = Configuration.Width ?? 13.6;
    const Depth = Configuration.Depth ?? 5.2;
    const Thickness = Configuration.Thickness ?? 0.64;
    const WallThickness = Configuration.WallThickness ?? 0.65;
    const WallTopZ = Configuration.WallTopZ ?? 0.55;
    const Roofed = Configuration.Roofed !== false;
    const GroundDeckOverRoof = Configuration.GroundDeckOverRoof !== false && Roofed;
    const RoofBottomZ = Configuration.RoofBottomZ ?? -0.78;
    const RoofTopZ = Configuration.RoofTopZ ?? -0.02;
    const Surface = {
        Category:           SurfaceCategory.SubmergedTrench,
        Key:                Configuration.Key,
        Origin:             Configuration.Origin.slice(),
        Yaw,
        CosineYaw:          Math.cos(Yaw),
        SineYaw:            Math.sin(Yaw),
        DeadEnd,
        DownLength,
        TunnelLength,
        UpLength,
        TotalLength,
        Width,
        HalfWidth:          0.5 * Width,
        Depth,
        Thickness,
        WallThickness,
        WallTopZ,
        Roofed,
        GroundDeckOverRoof,
        RoofBottomZ,
        RoofTopZ,
        KerbWidth:          Configuration.KerbWidth ?? 0.55,
        GalleryTileLength:  Configuration.GalleryTileLength ?? TunnelLength,
        ShapePrefix:        Configuration.ShapePrefix || Configuration.Key,
        AccentMaterial:     Configuration.AccentMaterial ?? CourseMaterial.GateLamp
    };
    const InnerSpanY = Surface.HalfWidth + 0.05;
    const OuterSpanY = Surface.HalfWidth + WallThickness + 0.10;
    const FarVisualX = DeadEnd ? (TotalLength + WallThickness) : (TotalLength - 0.4);
    const FarPhysX   = DeadEnd ? (TotalLength + 0.2) : (TotalLength - 0.8);
    const FullBox = ComputeWorldSpanBox(Surface, 0.8, FarPhysX, OuterSpanY);
    const EntryBox = ComputeWorldSpanBox(Surface, 0.8, DownLength, InnerSpanY);
    const MiddleBox = ComputeWorldSpanBox(Surface, DownLength, DownLength + TunnelLength, InnerSpanY);

    Surface.DistanceCutout = FullBox;
    Surface.VisualCutouts = GroundDeckOverRoof
        ? (DeadEnd
            ? [ComputeWorldSpanBox(Surface, 0.4, DownLength + 0.2, OuterSpanY)]
            : [ComputeWorldSpanBox(Surface, 0.4, DownLength + 0.2, OuterSpanY),
               ComputeWorldSpanBox(Surface, DownLength + TunnelLength - 0.2, FarVisualX, OuterSpanY)])
        : [ComputeWorldSpanBox(Surface, 0.4, FarVisualX, OuterSpanY)];
    const SubFloor = -50.0;
    Surface.PhysicsCutouts = GroundDeckOverRoof
        ? (DeadEnd
            ? [[...EntryBox, SubFloor, Infinity],
               [...MiddleBox, SubFloor, RoofBottomZ + 0.25]]
            : [[...EntryBox, SubFloor, Infinity],
               [...MiddleBox, SubFloor, RoofBottomZ + 0.25],
               [...ComputeWorldSpanBox(Surface, DownLength + TunnelLength, FarPhysX, InnerSpanY), SubFloor, Infinity]])
        : [[...ComputeWorldSpanBox(Surface, 0.8, FarPhysX, InnerSpanY), SubFloor, Infinity]];

    return FinalizeSurfaceBounds(Surface, [-1.0, -(Surface.HalfWidth + WallThickness + 1.0), -Depth - Thickness - 1.0],
                                 [TotalLength + WallThickness + 1.0, Surface.HalfWidth + WallThickness + 1.0, WallTopZ + 1.0]);
}

export function ConstructSerpentineWaveSurface(Configuration)
{
    const Yaw = Configuration.Yaw || 0.0;
    const Length = Configuration.Length ?? 72.0;
    const Width = Configuration.Width ?? 14.5;
    const WaveCount = Math.max(1, Math.round(Configuration.WaveCount ?? 3));
    const Amplitude = Configuration.Amplitude ?? 0.95;
    const PeakAngle = (Configuration.PeakAngle ?? (28.0 * Math.PI / 180.0)) * (Configuration.BankSign ?? 1.0);
    const Thickness = Configuration.Thickness ?? 0.58;
    const Surface = {
        Category:       SurfaceCategory.SerpentineWave,
        Key:            Configuration.Key,
        Origin:         Configuration.Origin.slice(),
        Yaw,
        CosineYaw:      Math.cos(Yaw),
        SineYaw:        Math.sin(Yaw),
        Length,
        HalfLength:     0.5 * Length,
        Width,
        HalfWidth:      0.5 * Width,
        WaveCount,
        Amplitude,
        PeakAngle,
        Thickness,
        KerbWidth:      Configuration.KerbWidth ?? 0.60,
        KerbHeight:     Configuration.KerbHeight ?? 0.22,
        ShapePrefix:    Configuration.ShapePrefix || Configuration.Key,
        AccentMaterial: Configuration.AccentMaterial ?? CourseMaterial.PaintYellow
    };
    const MaxZ = Amplitude + Surface.HalfWidth * Math.sin(Math.abs(PeakAngle)) + Surface.KerbHeight + 1.2;
    const MinZ = -Surface.HalfWidth * Math.sin(Math.abs(PeakAngle)) - Thickness - 0.8;
    return FinalizeSurfaceBounds(Surface, [-Surface.HalfLength - 1.0, -Surface.HalfWidth - 1.0, MinZ],
                                 [Surface.HalfLength + 1.0, Surface.HalfWidth + 1.0, MaxZ]);
}

export function ConstructCollapseDeckSurface(Configuration)
{
    const Yaw = Configuration.Yaw || 0.0;
    const UpLength = Configuration.UpLength ?? 0.0;
    const DeckLength = Configuration.DeckLength ?? 112.0;
    const DownLength = Configuration.DownLength ?? 0.0;
    const TotalLength = UpLength + DeckLength + DownLength;
    const Width = Configuration.Width ?? 14.0;
    const Height = Configuration.Height ?? 5.0;
    const Thickness = Configuration.Thickness ?? 0.62;
    const BayCount = Math.max(4, Math.round(Configuration.BayCount ?? 14));
    const BayIntact = new Uint8Array(BayCount);
    BayIntact.fill(1);
    const Surface = {
        Category:       SurfaceCategory.CollapseDeck,
        Key:            Configuration.Key,
        Origin:         Configuration.Origin.slice(),
        Yaw,
        CosineYaw:      Math.cos(Yaw),
        SineYaw:        Math.sin(Yaw),
        UpLength,
        DeckLength,
        DownLength,
        TotalLength,
        Width,
        HalfWidth:      0.5 * Width,
        Height,
        Thickness,
        BayCount,
        BayLength:      DeckLength / BayCount,
        BayDropZ:       new Float32Array(BayCount),
        BayPitch:       new Float32Array(BayCount),
        BayRoll:        new Float32Array(BayCount),
        BayIntact,
        ChasmDepth:     Configuration.ChasmDepth ?? 5.6,
        KerbWidth:      Configuration.KerbWidth ?? 0.60,
        KerbHeight:     Configuration.KerbHeight ?? 0.24,
        ShapePrefix:    Configuration.ShapePrefix || Configuration.Key,
        AccentMaterial: Configuration.AccentMaterial ?? CourseMaterial.PaintYellow
    };
    return FinalizeSurfaceBounds(Surface, [-1.0, -Surface.HalfWidth - 1.0, -Thickness - 1.5],
                                 [TotalLength + 1.0, Surface.HalfWidth + 1.0, Height + Surface.KerbHeight + 1.5]);
}

export function EvaluateCollapseDeckSpan(Surface, CoordinateX, CoordinateY)
{
    if (CoordinateX < 0.0 || CoordinateX > Surface.TotalLength)
        return null;
    if (Surface.UpLength > 1.0e-4 && CoordinateX < Surface.UpLength)
    {
        const Profile = EvaluateTabletopProfile(Surface, CoordinateX, CoordinateY);
        return { Supported: true, Height: Profile.Height, SlopeX: Profile.SlopeX, SlopeY: Profile.SlopeY };
    }
    const SpanEnd = Surface.UpLength + Surface.DeckLength;
    if (Surface.DownLength > 1.0e-4 && CoordinateX > SpanEnd)
    {
        const Profile = EvaluateTabletopProfile(Surface, CoordinateX, CoordinateY);
        return { Supported: true, Height: Profile.Height, SlopeX: Profile.SlopeX, SlopeY: Profile.SlopeY };
    }
    const RelX = ClampScalar(CoordinateX - Surface.UpLength, 0.0, Surface.DeckLength - 1.0e-5);
    const BayIndex = Math.min(Surface.BayCount - 1, Math.max(0, Math.floor(RelX / Surface.BayLength)));
    if (!Surface.BayIntact[BayIndex])
        return null;
    const BayCenterX = (BayIndex + 0.5) * Surface.BayLength;
    const LocalBayX = RelX - BayCenterX;
    const Pitch = Surface.BayPitch[BayIndex] || 0.0;
    const Roll = Surface.BayRoll[BayIndex] || 0.0;
    const Deflection = Math.min(0.0, (Surface.BayDropZ[BayIndex] || 0.0) - (0.5 * Surface.BayLength - LocalBayX) * Pitch);
    const Kerb = EvaluateLateralKerbLift(CoordinateY, Surface.HalfWidth, Surface.KerbWidth, Surface.KerbHeight, 1.0);
    return {
        Supported: true,
        Height:    Surface.Height + Deflection + CoordinateY * Roll + Kerb.Lift,
        SlopeX:    Deflection < 0.0 ? Pitch : 0.0,
        SlopeY:    Roll + Kerb.Slope
    };
}

//------------------------------------------------------------------------------------------------------------------------
//                                           PARAMETRIC EVALUATION HELPERS
//------------------------------------------------------------------------------------------------------------------------

// 📝 C² cycloid lateral shift y(θ) = S·(θ − sin θ)/(2π): zero slope and zero curvature at θ = 0 and θ = 2π.
function EvaluateHelicalShift(HelicalShift, θ)
{
    return HelicalShift * (θ - Math.sin(θ)) / (2.0 * Math.PI);
}

// 📝 Exact speed-independent helical cant slope ∂r/∂y = (S / (2π·R))·sin θ that supplies lateral acceleration d²y/dθ²·θ̇²
//    on the climb (θ ∈ (0, π)) and cancels lateral drift on the descent (θ ∈ (π, 2π)), leaving θ = π pure 180° inverted.
function EvaluateHelicalLateralSlope(Surface, θ, LateralOffset)
{
    const HelicalCant = -1.12 * (Surface.HelicalShift / (2.0 * Math.PI * Surface.Radius)) * Math.sin(θ);
    const InnerEdge = Surface.HalfWidth - Surface.KerbWidth;
    const Excess = Math.abs(LateralOffset) - InnerEdge;
    if (Excess <= 0.0)
        return { Lift: -HelicalCant * LateralOffset, LateralSlope: HelicalCant };
    const Taper = Math.sin(0.5 * θ);
    const Envelope = Taper * Taper;
    const Fraction = ClampScalar(Excess / Surface.KerbWidth, 0.0, 1.0);
    const Smooth = Fraction * Fraction * (3.0 - 2.0 * Fraction);
    const Derivative = (6.0 * Fraction * (1.0 - Fraction) / Surface.KerbWidth) * Math.sign(LateralOffset);
    return {
        Lift:         -HelicalCant * LateralOffset + Surface.KerbHeight * Envelope * Smooth,
        LateralSlope: HelicalCant + Surface.KerbHeight * Envelope * Derivative
    };
}

// 📝 Evaluates bank angle α(x) and derivative dα/dx along the TwistedRibbon's longitudinal coordinate x ∈ [−L/2, +L/2].
export function EvaluateRibbonTwist(Surface, CoordinateX)
{
    const DistanceFromEnd = Surface.HalfLength - Math.abs(CoordinateX);
    if (DistanceFromEnd <= 0.0)
        return { α: 0.0, Derivative: 0.0 };
    if (DistanceFromEnd >= Surface.TwistLength)
        return { α: Surface.PeakAngle, Derivative: 0.0 };
    const η = DistanceFromEnd / Surface.TwistLength;
    const Smooth = η * η * (3.0 - 2.0 * η);
    const SignX = CoordinateX >= 0.0 ? -1.0 : 1.0;
    const SmoothDerivative = (6.0 * η * (1.0 - η) / Surface.TwistLength) * SignX;
    return { α: Surface.PeakAngle * Smooth, Derivative: Surface.PeakAngle * SmoothDerivative };
}

function EvaluateQuinticSmooth(Fraction)
{
    const T = ClampScalar(Fraction, 0.0, 1.0);
    const T2 = T * T;
    return {
        Value:      T2 * T * (10.0 - 15.0 * T + 6.0 * T2),
        Derivative: 30.0 * T2 * (1.0 - T) * (1.0 - T)
    };
}

function EvaluateLateralKerbLift(LateralOffset, HalfWidth, KerbWidth, KerbHeight, Envelope = 1.0)
{
    const InnerEdge = HalfWidth - KerbWidth;
    const Excess = Math.abs(LateralOffset) - InnerEdge;
    if (Excess <= 0.0 || Envelope <= 0.0)
        return { Lift: 0.0, Slope: 0.0 };
    const Fraction = ClampScalar(Excess / KerbWidth, 0.0, 1.0);
    const Smooth = Fraction * Fraction * (3.0 - 2.0 * Fraction);
    const Slope = (6.0 * Fraction * (1.0 - Fraction) / KerbWidth) * Math.sign(LateralOffset) * KerbHeight * Envelope;
    return { Lift: KerbHeight * Envelope * Smooth, Slope };
}

export function EvaluateWaveDeckProfile(Surface, CoordinateX, CoordinateY = 0.0)
{
    const Fraction = ClampScalar((CoordinateX + Surface.HalfLength) / Surface.Length, 0.0, 1.0);
    const Phase = 2.0 * Math.PI * Surface.WaveCount * Fraction;
    const BaseZ = 0.5 * Surface.Amplitude * (1.0 - Math.cos(Phase));
    const SlopeX = (Math.PI * Surface.WaveCount * Surface.Amplitude / Surface.Length) * Math.sin(Phase);
    const Envelope = Math.sin(Math.PI * Surface.WaveCount * Fraction);
    const Kerb = EvaluateLateralKerbLift(CoordinateY, Surface.HalfWidth, Surface.KerbWidth, Surface.KerbHeight, Envelope * Envelope);
    return { Height: BaseZ + Kerb.Lift, SlopeX, SlopeY: Kerb.Slope };
}

export function EvaluateTabletopProfile(Surface, CoordinateX, CoordinateY = 0.0)
{
    const X = ClampScalar(CoordinateX, 0.0, Surface.TotalLength);
    let BaseZ = 0.0, SlopeX = 0.0, Envelope = 1.0;
    if (X < Surface.UpLength)
    {
        const Step = EvaluateQuinticSmooth(X / Surface.UpLength);
        BaseZ = Surface.Height * Step.Value;
        SlopeX = (Surface.Height / Surface.UpLength) * Step.Derivative;
        Envelope = Step.Value;
    }
    else if (X <= Surface.UpLength + Surface.DeckLength)
    {
        BaseZ = Surface.Height;
        SlopeX = 0.0;
        Envelope = 1.0;
    }
    else
    {
        const DownCoord = (X - Surface.UpLength - Surface.DeckLength) / Surface.DownLength;
        const Step = EvaluateQuinticSmooth(DownCoord);
        BaseZ = Surface.Height * (1.0 - Step.Value);
        SlopeX = -(Surface.Height / Surface.DownLength) * Step.Derivative;
        Envelope = 1.0 - Step.Value;
    }
    const Kerb = EvaluateLateralKerbLift(CoordinateY, Surface.HalfWidth, Surface.KerbWidth, Surface.KerbHeight, Envelope);
    return { Height: BaseZ + Kerb.Lift, SlopeX, SlopeY: Kerb.Slope };
}

export function EvaluateBankedTurnProfile(Surface, AcrossS, SweepProgress)
{
    const ClampedPhi = ClampScalar(SweepProgress, 0.0, Surface.SweepAngle);
    let Blend = 1.0, BlendDerivative = 0.0;
    if (ClampedPhi < Surface.RampAngle)
    {
        const Step = EvaluateQuinticSmooth(ClampedPhi / Surface.RampAngle);
        Blend = Step.Value;
        BlendDerivative = Step.Derivative / Surface.RampAngle;
    }
    else if (ClampedPhi > Surface.SweepAngle - Surface.RampAngle)
    {
        const Remaining = Surface.SweepAngle - ClampedPhi;
        const Step = EvaluateQuinticSmooth(Remaining / Surface.RampAngle);
        Blend = Step.Value;
        BlendDerivative = -Step.Derivative / Surface.RampAngle;
    }
    const S = ClampScalar(AcrossS, 0.0, Surface.Width);
    const SlopeRate = (Surface.PeakSlope - Surface.MinimumSlope) / Surface.Width;
    let CrossHeight = S * Surface.MinimumSlope + 0.5 * SlopeRate * S * S;
    let CrossSlope = Surface.MinimumSlope + SlopeRate * S;
    const CopingStart = Surface.Width - Surface.CopingWidth;
    if (S > CopingStart && Surface.CopingWidth > 1.0e-4)
    {
        const Eta = (S - CopingStart) / Surface.CopingWidth;
        CrossHeight += Surface.CopingLift * Eta * Eta * Eta;
        CrossSlope += (3.0 * Surface.CopingLift * Eta * Eta) / Surface.CopingWidth;
    }
    return {
        Height:    Blend * CrossHeight,
        SlopeS:    Blend * CrossSlope,
        SlopePhi:  BlendDerivative * CrossHeight
    };
}

export function EvaluateHeartlineProfile(Surface, CoordinateX)
{
    const U = ClampScalar((CoordinateX + Surface.HalfLength) / Surface.Length, 0.0, 1.0);
    const InvL = 1.0 / Surface.Length;
    const Ramp = Surface.RampFraction;
    const HalfCross = 0.5 * Surface.CrossFraction;

    let CenterZ = Surface.BridgeHeight, SlopeZ = 0.0;
    if (U < Ramp)
    {
        const Step = EvaluateQuinticSmooth(U / Ramp);
        CenterZ = Surface.BridgeHeight * Step.Value;
        SlopeZ = Surface.BridgeHeight * Step.Derivative * (InvL / Ramp);
    }
    else if (U > 1.0 - Ramp)
    {
        const Step = EvaluateQuinticSmooth((1.0 - U) / Ramp);
        CenterZ = Surface.BridgeHeight * Step.Value;
        SlopeZ = -Surface.BridgeHeight * Step.Derivative * (InvL / Ramp);
    }

    let α = 0.0, DerivativeAlpha = 0.0;
    if (U < Ramp)
    {
        const Step = EvaluateQuinticSmooth(U / Ramp);
        α = Surface.PeakAngle * Step.Value;
        DerivativeAlpha = Surface.PeakAngle * Step.Derivative * (InvL / Ramp);
    }
    else if (U < 0.5 - HalfCross)
    {
        α = Surface.PeakAngle;
    }
    else if (U <= 0.5 + HalfCross)
    {
        const Step = EvaluateQuinticSmooth((U - (0.5 - HalfCross)) / Surface.CrossFraction);
        α = Surface.PeakAngle * (1.0 - 2.0 * Step.Value);
        DerivativeAlpha = -2.0 * Surface.PeakAngle * Step.Derivative * (InvL / Surface.CrossFraction);
    }
    else if (U <= 1.0 - Ramp)
    {
        α = -Surface.PeakAngle;
    }
    else
    {
        const Step = EvaluateQuinticSmooth((1.0 - U) / Ramp);
        α = -Surface.PeakAngle * Step.Value;
        DerivativeAlpha = Surface.PeakAngle * Step.Derivative * (InvL / Ramp);
    }
    return { CenterZ, SlopeZ, α, DerivativeAlpha };
}

export function EvaluateSubmergedTrenchFloor(Surface, CoordinateX)
{
    if (CoordinateX <= 0.0)
        return { Height: 0.0, SlopeX: 0.0 };
    if (CoordinateX < Surface.DownLength)
    {
        const Step = EvaluateQuinticSmooth(CoordinateX / Surface.DownLength);
        return {
            Height: -Surface.Depth * Step.Value,
            SlopeX: -Surface.Depth * Step.Derivative / Surface.DownLength
        };
    }
    const AscentStart = Surface.DownLength + Surface.TunnelLength;
    if (Surface.DeadEnd || Surface.UpLength <= 1.0e-4)
        return { Height: -Surface.Depth, SlopeX: 0.0 };
    if (CoordinateX <= AscentStart)
        return { Height: -Surface.Depth, SlopeX: 0.0 };
    if (CoordinateX < Surface.TotalLength)
    {
        const Step = EvaluateQuinticSmooth((CoordinateX - AscentStart) / Surface.UpLength);
        return {
            Height: -Surface.Depth * (1.0 - Step.Value),
            SlopeX:  Surface.Depth * Step.Derivative / Surface.UpLength
        };
    }
    return { Height: 0.0, SlopeX: 0.0 };
}

export function EvaluateSerpentineWaveProfile(Surface, CoordinateX, CoordinateY)
{
    const U = ClampScalar((CoordinateX + Surface.HalfLength) / Surface.Length, 0.0, 1.0);
    const InvL = 1.0 / Surface.Length;
    const Ramp = 1.0 / (Surface.WaveCount * 4.0);
    let Env = 1.0, dEnv = 0.0;
    if (U < Ramp)
    {
        const Step = EvaluateQuinticSmooth(U / Ramp);
        Env = Step.Value;
        dEnv = Step.Derivative * (InvL / Ramp);
    }
    else if (U > 1.0 - Ramp)
    {
        const Step = EvaluateQuinticSmooth((1.0 - U) / Ramp);
        Env = Step.Value;
        dEnv = -Step.Derivative * (InvL / Ramp);
    }
    const Phase = 2.0 * Math.PI * Surface.WaveCount * U;
    const dPhase = 2.0 * Math.PI * Surface.WaveCount * InvL;
    const SinP = Math.sin(Phase), CosP = Math.cos(Phase);
    const BaseH = 0.5 * Surface.Amplitude * (1.0 - CosP);
    const dBaseH = 0.5 * Surface.Amplitude * SinP * dPhase;
    const CenterZ = Env * BaseH;
    const dCenterZ = dEnv * BaseH + Env * dBaseH;
    const α = Surface.PeakAngle * Env * SinP;
    const dAlpha = Surface.PeakAngle * (dEnv * SinP + Env * CosP * dPhase);
    const Kerb = EvaluateLateralKerbLift(CoordinateY, Surface.HalfWidth, Surface.KerbWidth, Surface.KerbHeight, Env);
    const SinA = Math.sin(α), CosA = Math.cos(α);
    return {
        Height: CenterZ + CoordinateY * SinA + Kerb.Lift,
        SlopeX: dCenterZ + CoordinateY * CosA * dAlpha,
        SlopeY: SinA + Kerb.Slope,
        α
    };
}

//------------------------------------------------------------------------------------------------------------------------
//                                              EXACT RAY INTERSECTION
//------------------------------------------------------------------------------------------------------------------------

function CastHelicalLoopRay(Surface, Origin, Direction, MaximumTravel)
{
    const Radius = Surface.Radius;
    const ShiftedZ = Origin[2] - Radius;
    const QuadraticA = Direction[0] * Direction[0] + Direction[2] * Direction[2];
    const Candidates = [];
    if (QuadraticA > 1.0e-10)
    {
        const HalfB = Origin[0] * Direction[0] + ShiftedZ * Direction[2];
        const QuadraticC = Origin[0] * Origin[0] + ShiftedZ * ShiftedZ - Radius * Radius;
        const Discriminant = HalfB * HalfB - QuadraticA * QuadraticC;
        if (Discriminant >= 0.0)
        {
            const Root = Math.sqrt(Discriminant);
            Candidates.push((-HalfB - Root) / QuadraticA, (-HalfB + Root) / QuadraticA);
        }
    }
    let Best = null;
    for (const InitialTravel of Candidates)
    {
        if (InitialTravel < -0.05 || InitialTravel > MaximumTravel + 0.35)
            continue;
        const BasePoint = MultiplyAddVector(Origin, Direction, Math.max(0.0, InitialTravel));
        let RawAngle = Math.atan2(BasePoint[0], Radius - BasePoint[2]);
        let θ = RawAngle >= 0.0 ? RawAngle : RawAngle + 2.0 * Math.PI;
        // 📝 Near θ = 0 / 2π (bottom of the loop), match whichever helical branch (y ≈ 0 vs y ≈ HelicalShift) the ray is over.
        if (θ < 0.35 && Math.abs(BasePoint[1] - Surface.HelicalShift) < Math.abs(BasePoint[1]))
            continue;
        if (θ > 2.0 * Math.PI - 0.35 && Math.abs(BasePoint[1]) < Math.abs(BasePoint[1] - Surface.HelicalShift))
            continue;
        let Lateral = BasePoint[1] - EvaluateHelicalShift(Surface.HelicalShift, θ);
        if (Math.abs(Lateral) > Surface.HalfWidth)
            continue;

        // 📝 Refine travel if the ray lands on the bevelled outer guide kerb.
        let Travel = InitialTravel;
        for (let Iteration = 0; Iteration < 3; ++Iteration)
        {
            const Sample = MultiplyAddVector(Origin, Direction, Travel);
            const SampleRaw = Math.atan2(Sample[0], Radius - Sample[2]);
            θ = SampleRaw >= 0.0 ? SampleRaw : SampleRaw + 2.0 * Math.PI;
            Lateral = Sample[1] - EvaluateHelicalShift(Surface.HelicalShift, θ);
            const Kerb = EvaluateHelicalLateralSlope(Surface, θ, Lateral);
            if (Math.abs(Kerb.Lift) <= 1.0e-6)
                break;
            const TargetRadius = Radius - Kerb.Lift;
            const Radial = Math.hypot(Sample[0], Sample[2] - Radius);
            const RadialDirection = (Sample[0] * Direction[0] + (Sample[2] - Radius) * Direction[2]) / Math.max(Radial, 1.0e-6);
            if (Math.abs(RadialDirection) < 1.0e-5)
                break;
            Travel += (TargetRadius - Radial) / RadialDirection;
        }
        if (Travel < 0.0 || Travel > MaximumTravel)
            continue;
        const HitLocal = MultiplyAddVector(Origin, Direction, Travel);
        const FinalRaw = Math.atan2(HitLocal[0], Radius - HitLocal[2]);
        θ = FinalRaw >= 0.0 ? FinalRaw : FinalRaw + 2.0 * Math.PI;
        Lateral = HitLocal[1] - EvaluateHelicalShift(Surface.HelicalShift, θ);
        if (Math.abs(Lateral) > Surface.HalfWidth)
            continue;
        const Kerb = EvaluateHelicalLateralSlope(Surface, θ, Lateral);
        const InwardRadial = [-Math.sin(θ), 0.0, Math.cos(θ)];
        const NormalLocal = NormalizeVector([InwardRadial[0], -Kerb.LateralSlope, InwardRadial[2]]);
        if (DotVector(Direction, NormalLocal) > -0.15)
            continue;
        if (!Best || Travel < Best.Travel)
            Best = { Travel, LocalPoint: HitLocal, LocalNormal: NormalLocal };
    }
    return Best;
}

function CastFullPipeRay(Surface, Origin, Direction, MaximumTravel)
{
    let Best = null;
    const Radius = Surface.Radius;
    const ShiftedZ = Origin[2] - Radius;
    const QuadraticA = Direction[1] * Direction[1] + Direction[2] * Direction[2];

    // ① Inner 360° pipe cylinder: y² + (z − R)² = R²
    if (QuadraticA > 1.0e-10)
    {
        const HalfB = Origin[1] * Direction[1] + ShiftedZ * Direction[2];
        const QuadraticC = Origin[1] * Origin[1] + ShiftedZ * ShiftedZ - Radius * Radius;
        const Discriminant = HalfB * HalfB - QuadraticA * QuadraticC;
        if (Discriminant >= 0.0)
        {
            const Root = Math.sqrt(Discriminant);
            for (const Travel of [(-HalfB - Root) / QuadraticA, (-HalfB + Root) / QuadraticA])
            {
                if (Travel < 0.0 || Travel > MaximumTravel)
                    continue;
                const HitLocal = MultiplyAddVector(Origin, Direction, Travel);
                if (Math.abs(HitLocal[0]) > Surface.HalfLength)
                    continue;
                const NormalLocal = [0.0, -HitLocal[1] / Radius, (Radius - HitLocal[2]) / Radius];
                if (DotVector(Direction, NormalLocal) > -0.15)
                    continue;
                if (!Best || Travel < Best.Travel)
                    Best = { Travel, LocalPoint: HitLocal, LocalNormal: NormalLocal };
            }
        }

        // ② Outer 45° quarter-pipe transition skirts on both flanks of the pipe
        const SkirtRadius = Surface.SkirtRadius;
        for (const Side of [-1.0, 1.0])
        {
            const CentreY = Side * Surface.OuterOffsetY;
            const CentreZ = SkirtRadius;
            const RelY = Origin[1] - CentreY, RelZ = Origin[2] - CentreZ;
            const SkirtB = RelY * Direction[1] + RelZ * Direction[2];
            const SkirtC = RelY * RelY + RelZ * RelZ - SkirtRadius * SkirtRadius;
            const SkirtDisc = SkirtB * SkirtB - QuadraticA * SkirtC;
            if (SkirtDisc < 0.0)
                continue;
            const SkirtRoot = Math.sqrt(SkirtDisc);
            for (const Travel of [(-SkirtB - SkirtRoot) / QuadraticA, (-SkirtB + SkirtRoot) / QuadraticA])
            {
                if (Travel < 0.0 || Travel > MaximumTravel)
                    continue;
                const HitLocal = MultiplyAddVector(Origin, Direction, Travel);
                if (Math.abs(HitLocal[0]) > Surface.HalfLength)
                    continue;
                const TowardWall = Side * (CentreY - HitLocal[1]);
                if (TowardWall < 0.0 || TowardWall > Surface.SkirtSpan || HitLocal[2] > SkirtRadius * (1.0 - Math.cos(Surface.SkirtAngle)) + 0.05)
                    continue;
                const NormalLocal = [0.0, (CentreY - HitLocal[1]) / SkirtRadius, (CentreZ - HitLocal[2]) / SkirtRadius];
                if (DotVector(Direction, NormalLocal) > -0.15)
                    continue;
                if (!Best || Travel < Best.Travel)
                    Best = { Travel, LocalPoint: HitLocal, LocalNormal: NormalLocal };
            }
        }
    }
    return Best;
}

function CastTwistedRibbonRay(Surface, Origin, Direction, MaximumTravel)
{
    const Steps = 16;
    const EvaluateResidual = (Travel) =>
    {
        const X = Origin[0] + Direction[0] * Travel;
        const Y = Origin[1] + Direction[1] * Travel;
        const Z = Origin[2] + Direction[2] * Travel;
        const { α } = EvaluateRibbonTwist(Surface, ClampScalar(X, -Surface.HalfLength, Surface.HalfLength));
        return Z * Math.cos(α) - Y * Math.sin(α);
    };

    let PreviousTravel = 0.0;
    let PreviousResidual = EvaluateResidual(0.0);
    for (let Step = 1; Step <= Steps; ++Step)
    {
        const CurrentTravel = (MaximumTravel * Step) / Steps;
        const CurrentResidual = EvaluateResidual(CurrentTravel);
        if (PreviousResidual >= 0.0 && CurrentResidual <= 0.0)
        {
            let Low = PreviousTravel, High = CurrentTravel;
            for (let Iteration = 0; Iteration < 14; ++Iteration)
            {
                const Middle = 0.5 * (Low + High);
                if (EvaluateResidual(Middle) >= 0.0)
                    Low = Middle;
                else
                    High = Middle;
            }
            const Travel = 0.5 * (Low + High);
            const HitLocal = MultiplyAddVector(Origin, Direction, Travel);
            if (Math.abs(HitLocal[0]) <= Surface.HalfLength)
            {
                const { α, Derivative } = EvaluateRibbonTwist(Surface, HitLocal[0]);
                const Across = HitLocal[1] * Math.cos(α) + HitLocal[2] * Math.sin(α);
                if (Across >= 0.0 && Across <= Surface.Width)
                {
                    const NormalLocal = NormalizeVector([-Across * Derivative, -Math.sin(α), Math.cos(α)]);
                    if (DotVector(Direction, NormalLocal) <= -0.15)
                        return { Travel, LocalPoint: HitLocal, LocalNormal: NormalLocal };
                }
            }
        }
        PreviousTravel = CurrentTravel;
        PreviousResidual = CurrentResidual;
    }
    return null;
}

function CastTransitionRampRay(Surface, Origin, Direction, MaximumTravel)
{
    let Best = null;
    const Radius = Surface.Radius;
    const ShiftedZ = Origin[2] - Radius;
    const QuadraticA = Direction[0] * Direction[0] + Direction[2] * Direction[2];

    // ① Circular transition arc x = R·sin θ, z = R·(1 − cos θ), θ ∈ [0, MaximumAngle]
    if (QuadraticA > 1.0e-10)
    {
        const HalfB = Origin[0] * Direction[0] + ShiftedZ * Direction[2];
        const QuadraticC = Origin[0] * Origin[0] + ShiftedZ * ShiftedZ - Radius * Radius;
        const Discriminant = HalfB * HalfB - QuadraticA * QuadraticC;
        if (Discriminant >= 0.0)
        {
            const Root = Math.sqrt(Discriminant);
            for (const Travel of [(-HalfB - Root) / QuadraticA, (-HalfB + Root) / QuadraticA])
            {
                if (Travel < 0.0 || Travel > MaximumTravel)
                    continue;
                const HitLocal = MultiplyAddVector(Origin, Direction, Travel);
                if (Math.abs(HitLocal[1]) > Surface.HalfWidth)
                    continue;
                const rawAngle = Math.atan2(HitLocal[0], Radius - HitLocal[2]);
                const θ = rawAngle >= -1.0e-4 ? rawAngle : rawAngle + 2.0 * Math.PI;
                if (θ < 0.0 || θ > Surface.MaximumAngle)
                    continue;
                const NormalLocal = [-Math.sin(θ), 0.0, Math.cos(θ)];
                if (DotVector(Direction, NormalLocal) > -0.15)
                    continue;
                if (!Best || Travel < Best.Travel)
                    Best = { Travel, LocalPoint: HitLocal, LocalNormal: NormalLocal };
            }
        }
    }

    // ② Tangential planar deck extension past MaximumAngle (e.g., 45° launch/landing lip)
    if (Surface.Extension > 1.0e-4)
    {
        const NormalLocal = [-Math.sin(Surface.MaximumAngle), 0.0, Math.cos(Surface.MaximumAngle)];
        const Denominator = DotVector(Direction, NormalLocal);
        if (Denominator <= -0.15)
        {
            const Anchor = [Surface.ArcEndX, 0.0, Surface.ArcEndZ];
            const Travel = DotVector(SubtractVector(Anchor, Origin), NormalLocal) / Denominator;
            if (Travel >= 0.0 && Travel <= MaximumTravel)
            {
                const HitLocal = MultiplyAddVector(Origin, Direction, Travel);
                const Tangent = [Math.cos(Surface.MaximumAngle), 0.0, Math.sin(Surface.MaximumAngle)];
                const Along = (HitLocal[0] - Surface.ArcEndX) * Tangent[0] + (HitLocal[2] - Surface.ArcEndZ) * Tangent[2];
                if (Along >= -0.02 && Along <= Surface.Extension && Math.abs(HitLocal[1]) <= Surface.HalfWidth)
                {
                    if (!Best || Travel < Best.Travel)
                        Best = { Travel, LocalPoint: HitLocal, LocalNormal: NormalLocal };
                }
            }
        }
    }
    return Best;
}

function CastWaveDeckRay(Surface, Origin, Direction, MaximumTravel)
{
    const Steps = 16;
    const EvaluateResidual = (Travel) =>
    {
        const X = Origin[0] + Direction[0] * Travel;
        const Y = Origin[1] + Direction[1] * Travel;
        const Z = Origin[2] + Direction[2] * Travel;
        return Z - EvaluateWaveDeckProfile(Surface, X, Y).Height;
    };
    let PreviousTravel = 0.0, PreviousResidual = EvaluateResidual(0.0);
    for (let Step = 1; Step <= Steps; ++Step)
    {
        const CurrentTravel = (MaximumTravel * Step) / Steps;
        const CurrentResidual = EvaluateResidual(CurrentTravel);
        if (PreviousResidual >= -0.02 && CurrentResidual <= 0.0)
        {
            let Low = PreviousTravel, High = CurrentTravel;
            for (let Iteration = 0; Iteration < 14; ++Iteration)
            {
                const Middle = 0.5 * (Low + High);
                if (EvaluateResidual(Middle) >= 0.0) Low = Middle; else High = Middle;
            }
            const Travel = 0.5 * (Low + High);
            const HitLocal = MultiplyAddVector(Origin, Direction, Travel);
            if (Math.abs(HitLocal[0]) <= Surface.HalfLength && Math.abs(HitLocal[1]) <= Surface.HalfWidth)
            {
                const Profile = EvaluateWaveDeckProfile(Surface, HitLocal[0], HitLocal[1]);
                const NormalLocal = NormalizeVector([-Profile.SlopeX, -Profile.SlopeY, 1.0]);
                if (DotVector(Direction, NormalLocal) <= -0.15)
                    return { Travel, LocalPoint: HitLocal, LocalNormal: NormalLocal };
            }
        }
        PreviousTravel = CurrentTravel;
        PreviousResidual = CurrentResidual;
    }
    return null;
}

function CastTabletopRampRay(Surface, Origin, Direction, MaximumTravel)
{
    const Steps = 16;
    const EvaluateResidual = (Travel) =>
    {
        const X = Origin[0] + Direction[0] * Travel;
        const Y = Origin[1] + Direction[1] * Travel;
        const Z = Origin[2] + Direction[2] * Travel;
        return Z - EvaluateTabletopProfile(Surface, X, Y).Height;
    };
    let PreviousTravel = 0.0, PreviousResidual = EvaluateResidual(0.0);
    for (let Step = 1; Step <= Steps; ++Step)
    {
        const CurrentTravel = (MaximumTravel * Step) / Steps;
        const CurrentResidual = EvaluateResidual(CurrentTravel);
        if (PreviousResidual >= -0.02 && CurrentResidual <= 0.0)
        {
            let Low = PreviousTravel, High = CurrentTravel;
            for (let Iteration = 0; Iteration < 14; ++Iteration)
            {
                const Middle = 0.5 * (Low + High);
                if (EvaluateResidual(Middle) >= 0.0) Low = Middle; else High = Middle;
            }
            const Travel = 0.5 * (Low + High);
            const HitLocal = MultiplyAddVector(Origin, Direction, Travel);
            if (HitLocal[0] >= 0.0 && HitLocal[0] <= Surface.TotalLength && Math.abs(HitLocal[1]) <= Surface.HalfWidth)
            {
                const Profile = EvaluateTabletopProfile(Surface, HitLocal[0], HitLocal[1]);
                const NormalLocal = NormalizeVector([-Profile.SlopeX, -Profile.SlopeY, 1.0]);
                if (DotVector(Direction, NormalLocal) <= -0.15)
                    return { Travel, LocalPoint: HitLocal, LocalNormal: NormalLocal };
            }
        }
        PreviousTravel = CurrentTravel;
        PreviousResidual = CurrentResidual;
    }
    return null;
}

function ResolveBankedTurnSweep(Surface, X, Y)
{
    let Delta = Math.atan2(Y, X) - Surface.StartAngle;
    while (Delta < -Math.PI * 0.5) Delta += 2.0 * Math.PI;
    while (Delta > 1.5 * Math.PI)  Delta -= 2.0 * Math.PI;
    return Delta;
}

function CastBankedTurnRay(Surface, Origin, Direction, MaximumTravel)
{
    const Steps = 16;
    const EvaluateResidual = (Travel) =>
    {
        const X = Origin[0] + Direction[0] * Travel;
        const Y = Origin[1] + Direction[1] * Travel;
        const Z = Origin[2] + Direction[2] * Travel;
        const Radial = Math.hypot(X, Y);
        const Sweep = ResolveBankedTurnSweep(Surface, X, Y);
        return Z - EvaluateBankedTurnProfile(Surface, Radial - Surface.InnerRadius, Sweep).Height;
    };
    let PreviousTravel = 0.0, PreviousResidual = EvaluateResidual(0.0);
    for (let Step = 1; Step <= Steps; ++Step)
    {
        const CurrentTravel = (MaximumTravel * Step) / Steps;
        const CurrentResidual = EvaluateResidual(CurrentTravel);
        if (PreviousResidual >= -0.02 && CurrentResidual <= 0.0)
        {
            let Low = PreviousTravel, High = CurrentTravel;
            for (let Iteration = 0; Iteration < 14; ++Iteration)
            {
                const Middle = 0.5 * (Low + High);
                if (EvaluateResidual(Middle) >= 0.0) Low = Middle; else High = Middle;
            }
            const Travel = 0.5 * (Low + High);
            const HitLocal = MultiplyAddVector(Origin, Direction, Travel);
            const Radial = Math.hypot(HitLocal[0], HitLocal[1]);
            const Sweep = ResolveBankedTurnSweep(Surface, HitLocal[0], HitLocal[1]);
            if (Radial >= Surface.InnerRadius - 0.05 && Radial <= Surface.OuterRadius + 0.05 &&
                Sweep >= -0.005 && Sweep <= Surface.SweepAngle + 0.005)
            {
                const Profile = EvaluateBankedTurnProfile(Surface, Radial - Surface.InnerRadius, Sweep);
                const CosA = HitLocal[0] / Math.max(Radial, 1.0e-4);
                const SinA = HitLocal[1] / Math.max(Radial, 1.0e-4);
                const TangentR = [CosA, SinA, Profile.SlopeS];
                const TangentPhi = [-Radial * SinA, Radial * CosA, Profile.SlopePhi];
                const NormalLocal = NormalizeVector(CrossVector(TangentR, TangentPhi));
                if (DotVector(Direction, NormalLocal) <= -0.15)
                    return { Travel, LocalPoint: HitLocal, LocalNormal: NormalLocal };
            }
        }
        PreviousTravel = CurrentTravel;
        PreviousResidual = CurrentResidual;
    }
    return null;
}

function CastHeartlineRibbonRay(Surface, Origin, Direction, MaximumTravel)
{
    const Steps = 16;
    const EvaluateResidual = (Travel) =>
    {
        const X = Origin[0] + Direction[0] * Travel;
        const Y = Origin[1] + Direction[1] * Travel;
        const Z = Origin[2] + Direction[2] * Travel;
        const { CenterZ, α } = EvaluateHeartlineProfile(Surface, X);
        return (Z - CenterZ) * Math.cos(α) - Y * Math.sin(α);
    };
    let PreviousTravel = 0.0, PreviousResidual = EvaluateResidual(0.0);
    for (let Step = 1; Step <= Steps; ++Step)
    {
        const CurrentTravel = (MaximumTravel * Step) / Steps;
        const CurrentResidual = EvaluateResidual(CurrentTravel);
        if (PreviousResidual >= -0.02 && CurrentResidual <= 0.0)
        {
            let Low = PreviousTravel, High = CurrentTravel;
            for (let Iteration = 0; Iteration < 14; ++Iteration)
            {
                const Middle = 0.5 * (Low + High);
                if (EvaluateResidual(Middle) >= 0.0) Low = Middle; else High = Middle;
            }
            const Travel = 0.5 * (Low + High);
            const HitLocal = MultiplyAddVector(Origin, Direction, Travel);
            if (Math.abs(HitLocal[0]) <= Surface.HalfLength)
            {
                const { CenterZ, SlopeZ, α, DerivativeAlpha } = EvaluateHeartlineProfile(Surface, HitLocal[0]);
                const Across = HitLocal[1] * Math.cos(α) + (HitLocal[2] - CenterZ) * Math.sin(α);
                if (Across >= -Surface.HalfWidth && Across <= Surface.HalfWidth)
                {
                    const Kerb = EvaluateLateralKerbLift(Across, Surface.HalfWidth, Surface.KerbWidth, Surface.KerbHeight, 1.0);
                    const NormalLocal = NormalizeVector([
                        -SlopeZ * Math.cos(α) - Across * DerivativeAlpha,
                        -Math.sin(α) - Kerb.Slope * Math.cos(α),
                        Math.cos(α) - Kerb.Slope * Math.sin(α)
                    ]);
                    if (DotVector(Direction, NormalLocal) <= -0.15)
                        return { Travel, LocalPoint: HitLocal, LocalNormal: NormalLocal };
                }
            }
        }
        PreviousTravel = CurrentTravel;
        PreviousResidual = CurrentResidual;
    }
    return null;
}

function CastSubmergedTrenchRay(Surface, Origin, Direction, MaximumTravel)
{
    let Best = null;
    // ① Overhead subterranean tunnel ceiling slab (z = RoofBottomZ, downward normal [0, 0, -1]) or top road deck (z = RoofTopZ)
    if (Surface.Roofed && Math.abs(Direction[2]) > 1.0e-5)
    {
        const RoofX0 = Surface.DownLength, RoofX1 = Surface.DownLength + Surface.TunnelLength;
        if (Direction[2] > 0.0)
        {
            const Travel = (Surface.RoofBottomZ - Origin[2]) / Direction[2];
            if (Travel >= 0.0 && Travel <= MaximumTravel)
            {
                const Hit = MultiplyAddVector(Origin, Direction, Travel);
                if (Hit[0] >= RoofX0 && Hit[0] <= RoofX1 && Math.abs(Hit[1]) <= Surface.HalfWidth + 0.1)
                    Best = { Travel, LocalPoint: Hit, LocalNormal: [0.0, 0.0, -1.0] };
            }
        }
        else if (Surface.GroundDeckOverRoof && Origin[2] > Surface.RoofTopZ - 0.15)
        {
            const Travel = (Surface.RoofTopZ - Origin[2]) / Direction[2];
            if (Travel >= 0.0 && Travel <= MaximumTravel)
            {
                const Hit = MultiplyAddVector(Origin, Direction, Travel);
                if (Hit[0] >= RoofX0 && Hit[0] <= RoofX1 && Math.abs(Hit[1]) <= Surface.HalfWidth + Surface.WallThickness)
                    Best = { Travel, LocalPoint: Hit, LocalNormal: [0.0, 0.0, 1.0] };
            }
        }
    }

    // ② Excavated C² dive ramp -> subterranean gallery floor -> ascent ramp
    const Steps = 20;
    const EvaluateResidual = (Travel) =>
    {
        const X = Origin[0] + Direction[0] * Travel;
        const Z = Origin[2] + Direction[2] * Travel;
        return Z - EvaluateSubmergedTrenchFloor(Surface, X).Height;
    };
    let PreviousTravel = 0.0, PreviousResidual = EvaluateResidual(0.0);
    if (PreviousResidual < 0.0 && PreviousResidual >= -Surface.Thickness &&
        Origin[0] >= 0.0 && Origin[0] <= Surface.TotalLength && Math.abs(Origin[1]) <= Surface.HalfWidth)
    {
        const Floor = EvaluateSubmergedTrenchFloor(Surface, Origin[0]);
        const NormalLocal = NormalizeVector([-Floor.SlopeX, 0.0, 1.0]);
        if (DotVector(Direction, NormalLocal) <= -0.10)
            return { Travel: 0.0, LocalPoint: [Origin[0], Origin[1], Floor.Height], LocalNormal: NormalLocal };
    }
    for (let Step = 1; Step <= Steps; ++Step)
    {
        const CurrentTravel = (MaximumTravel * Step) / Steps;
        const CurrentResidual = EvaluateResidual(CurrentTravel);
        if (PreviousResidual >= -0.02 && CurrentResidual <= 0.0)
        {
            let Low = PreviousTravel, High = CurrentTravel;
            for (let Iteration = 0; Iteration < 14; ++Iteration)
            {
                const Middle = 0.5 * (Low + High);
                if (EvaluateResidual(Middle) >= 0.0) Low = Middle; else High = Middle;
            }
            const Travel = 0.5 * (Low + High);
            const HitLocal = MultiplyAddVector(Origin, Direction, Travel);
            if (HitLocal[0] >= 0.0 && HitLocal[0] <= Surface.TotalLength && Math.abs(HitLocal[1]) <= Surface.HalfWidth)
            {
                const Floor = EvaluateSubmergedTrenchFloor(Surface, HitLocal[0]);
                const NormalLocal = NormalizeVector([-Floor.SlopeX, 0.0, 1.0]);
                if (DotVector(Direction, NormalLocal) <= -0.10 && (!Best || Travel < Best.Travel))
                    Best = { Travel, LocalPoint: HitLocal, LocalNormal: NormalLocal };
                break;
            }
        }
        PreviousTravel = CurrentTravel;
        PreviousResidual = CurrentResidual;
    }
    return Best;
}

function CastSerpentineWaveRay(Surface, Origin, Direction, MaximumTravel)
{
    const Steps = 20;
    const EvaluateResidual = (Travel) =>
    {
        const X = Origin[0] + Direction[0] * Travel;
        const Y = Origin[1] + Direction[1] * Travel;
        const Z = Origin[2] + Direction[2] * Travel;
        return Z - EvaluateSerpentineWaveProfile(Surface, X, Y).Height;
    };
    let PreviousTravel = 0.0, PreviousResidual = EvaluateResidual(0.0);
    if (PreviousResidual < 0.0 && PreviousResidual >= -Surface.Thickness &&
        Math.abs(Origin[0]) <= Surface.HalfLength && Math.abs(Origin[1]) <= Surface.HalfWidth)
    {
        const Profile = EvaluateSerpentineWaveProfile(Surface, Origin[0], Origin[1]);
        const NormalLocal = NormalizeVector([-Profile.SlopeX, -Profile.SlopeY, 1.0]);
        if (DotVector(Direction, NormalLocal) <= -0.15)
            return { Travel: 0.0, LocalPoint: [Origin[0], Origin[1], Profile.Height], LocalNormal: NormalLocal };
    }
    for (let Step = 1; Step <= Steps; ++Step)
    {
        const CurrentTravel = (MaximumTravel * Step) / Steps;
        const CurrentResidual = EvaluateResidual(CurrentTravel);
        if (PreviousResidual >= -0.02 && CurrentResidual <= 0.0)
        {
            let Low = PreviousTravel, High = CurrentTravel;
            for (let Iteration = 0; Iteration < 14; ++Iteration)
            {
                const Middle = 0.5 * (Low + High);
                if (EvaluateResidual(Middle) >= 0.0) Low = Middle; else High = Middle;
            }
            const Travel = 0.5 * (Low + High);
            const HitLocal = MultiplyAddVector(Origin, Direction, Travel);
            if (Math.abs(HitLocal[0]) <= Surface.HalfLength && Math.abs(HitLocal[1]) <= Surface.HalfWidth)
            {
                const Profile = EvaluateSerpentineWaveProfile(Surface, HitLocal[0], HitLocal[1]);
                const NormalLocal = NormalizeVector([-Profile.SlopeX, -Profile.SlopeY, 1.0]);
                if (DotVector(Direction, NormalLocal) <= -0.15)
                    return { Travel, LocalPoint: HitLocal, LocalNormal: NormalLocal };
            }
        }
        PreviousTravel = CurrentTravel;
        PreviousResidual = CurrentResidual;
    }
    return null;
}

function CastCollapseDeckRay(Surface, Origin, Direction, MaximumTravel)
{
    const Steps = 20;
    let PreviousTravel = 0.0;
    let PreviousSpan = EvaluateCollapseDeckSpan(Surface, Origin[0], Origin[1]);
    let PreviousResidual = PreviousSpan ? (Origin[2] - PreviousSpan.Height) : null;

    for (let Step = 1; Step <= Steps; ++Step)
    {
        const CurrentTravel = (MaximumTravel * Step) / Steps;
        const X = Origin[0] + Direction[0] * CurrentTravel;
        const Y = Origin[1] + Direction[1] * CurrentTravel;
        const Z = Origin[2] + Direction[2] * CurrentTravel;
        const CurrentSpan = EvaluateCollapseDeckSpan(Surface, X, Y);
        const CurrentResidual = CurrentSpan ? (Z - CurrentSpan.Height) : null;
        if (PreviousResidual !== null && CurrentResidual !== null && PreviousResidual >= -0.02 && CurrentResidual <= 0.0)
        {
            let Low = PreviousTravel, High = CurrentTravel;
            for (let Iteration = 0; Iteration < 14; ++Iteration)
            {
                const Middle = 0.5 * (Low + High);
                const MX = Origin[0] + Direction[0] * Middle;
                const MY = Origin[1] + Direction[1] * Middle;
                const MZ = Origin[2] + Direction[2] * Middle;
                const MSpan = EvaluateCollapseDeckSpan(Surface, MX, MY);
                if (!MSpan || (MZ - MSpan.Height) >= 0.0) Low = Middle;
                else High = Middle;
            }
            const Travel = 0.5 * (Low + High);
            const HitLocal = MultiplyAddVector(Origin, Direction, Travel);
            if (HitLocal[0] >= 0.0 && HitLocal[0] <= Surface.TotalLength && Math.abs(HitLocal[1]) <= Surface.HalfWidth)
            {
                const Span = EvaluateCollapseDeckSpan(Surface, HitLocal[0], HitLocal[1]);
                if (Span && Span.Supported)
                {
                    const NormalLocal = NormalizeVector([-Span.SlopeX, -Span.SlopeY, 1.0]);
                    if (DotVector(Direction, NormalLocal) <= -0.15)
                        return { Travel, LocalPoint: HitLocal, LocalNormal: NormalLocal };
                }
            }
        }
        PreviousTravel = CurrentTravel;
        PreviousResidual = CurrentResidual;
    }
    return null;
}

// 📝 Intersects a 3D strut or sensor ray (Origin, Direction) against all active ramp surfaces and returns the closest hit.
export function CastSurfaceRay(Surfaces, Origin, Direction, MaximumTravel)
{
    if (!Surfaces || Surfaces.length === 0)
        return null;
    let Closest = null;
    for (let Index = 0; Index < Surfaces.length; ++Index)
    {
        const Surface = Surfaces[Index];
        if (!IntersectBoundsRay(Origin, Direction, Surface.WorldMinimum, Surface.WorldMaximum, MaximumTravel))
            continue;
        const LocalOrigin = ProjectWorldToSurface(Surface, Origin);
        const LocalDirection = ProjectDirectionToSurface(Surface, Direction);
        let Candidate = null;
        switch (Surface.Category)
        {
            case SurfaceCategory.HelicalLoop:     Candidate = CastHelicalLoopRay(Surface, LocalOrigin, LocalDirection, MaximumTravel); break;
            case SurfaceCategory.FullPipe:        Candidate = CastFullPipeRay(Surface, LocalOrigin, LocalDirection, MaximumTravel); break;
            case SurfaceCategory.TwistedRibbon:   Candidate = CastTwistedRibbonRay(Surface, LocalOrigin, LocalDirection, MaximumTravel); break;
            case SurfaceCategory.TransitionRamp:  Candidate = CastTransitionRampRay(Surface, LocalOrigin, LocalDirection, MaximumTravel); break;
            case SurfaceCategory.WaveDeck:        Candidate = CastWaveDeckRay(Surface, LocalOrigin, LocalDirection, MaximumTravel); break;
            case SurfaceCategory.TabletopRamp:    Candidate = CastTabletopRampRay(Surface, LocalOrigin, LocalDirection, MaximumTravel); break;
            case SurfaceCategory.BankedTurn:      Candidate = CastBankedTurnRay(Surface, LocalOrigin, LocalDirection, MaximumTravel); break;
            case SurfaceCategory.HeartlineRibbon: Candidate = CastHeartlineRibbonRay(Surface, LocalOrigin, LocalDirection, MaximumTravel); break;
            case SurfaceCategory.SubmergedTrench: Candidate = CastSubmergedTrenchRay(Surface, LocalOrigin, LocalDirection, MaximumTravel); break;
            case SurfaceCategory.SerpentineWave:  Candidate = CastSerpentineWaveRay(Surface, LocalOrigin, LocalDirection, MaximumTravel); break;
            case SurfaceCategory.CollapseDeck:    Candidate = CastCollapseDeckRay(Surface, LocalOrigin, LocalDirection, MaximumTravel); break;
            case SurfaceCategory.SplineRoad:      Candidate = Surface.CastRay ? Surface.CastRay(LocalOrigin, LocalDirection, MaximumTravel) : null; break;
        }
        if (Candidate && (!Closest || Candidate.Travel < Closest.Travel))
        {
            Closest = {
                Travel:  Candidate.Travel,
                Point:   ProjectPointFromSurface(Surface, Candidate.LocalPoint),
                Normal:  ProjectDirectionFromSurface(Surface, Candidate.LocalNormal),
                Surface
            };
        }
    }
    return Closest;
}

//------------------------------------------------------------------------------------------------------------------------
//                                             HULL PENETRATION QUERIES
//------------------------------------------------------------------------------------------------------------------------

function QuerySlabPenetration(SignedNormalOffset, Thickness, Radius, NormalLocal)
{
    // 📝 Slab occupies SignedNormalOffset ∈ [−Thickness, 0]; driving surface is SignedNormalOffset = 0 (+NormalLocal).
    if (SignedNormalOffset > Radius || SignedNormalOffset < -Thickness - Radius)
        return null;
    const ExitDriving = Radius - SignedNormalOffset;
    const ExitUnderside = SignedNormalOffset + Thickness + Radius;
    if (ExitDriving <= ExitUnderside)
        return { LocalNormal: NormalLocal, Depth: ExitDriving };
    return { LocalNormal: ScaleVector(NormalLocal, -1.0), Depth: ExitUnderside };
}

function QuerySurfacePointLocal(Surface, LocalPoint, Radius)
{
    if (Surface.Category === SurfaceCategory.HelicalLoop)
    {
        const Radial = Math.hypot(LocalPoint[0], LocalPoint[2] - Surface.Radius);
        if (Radial < 1.0e-4)
            return null;
        const RawAngle = Math.atan2(LocalPoint[0], Surface.Radius - LocalPoint[2]);
        const θ = RawAngle >= 0.0 ? RawAngle : RawAngle + 2.0 * Math.PI;
        if (θ < 0.35 && Math.abs(LocalPoint[1] - Surface.HelicalShift) < Math.abs(LocalPoint[1]))
            return null;
        if (θ > 2.0 * Math.PI - 0.35 && Math.abs(LocalPoint[1]) < Math.abs(LocalPoint[1] - Surface.HelicalShift))
            return null;
        const Lateral = LocalPoint[1] - EvaluateHelicalShift(Surface.HelicalShift, θ);
        if (Math.abs(Lateral) > Surface.HalfWidth + Radius)
            return null;
        const Kerb = EvaluateHelicalLateralSlope(Surface, θ, ClampScalar(Lateral, -Surface.HalfWidth, Surface.HalfWidth));
        const SignedOffset = (Surface.Radius - Kerb.Lift) - Radial;
        const NormalLocal = NormalizeVector([-Math.sin(θ), -Kerb.LateralSlope, Math.cos(θ)]);
        return QuerySlabPenetration(SignedOffset, Surface.Thickness, Radius, NormalLocal);
    }
    if (Surface.Category === SurfaceCategory.FullPipe)
    {
        if (Math.abs(LocalPoint[0]) > Surface.HalfLength + Radius)
            return null;
        const Radial = Math.hypot(LocalPoint[1], LocalPoint[2] - Surface.Radius);
        if (Radial > 1.0e-4)
        {
            const SignedOffset = Surface.Radius - Radial;
            const NormalLocal = [0.0, -LocalPoint[1] / Radial, (Surface.Radius - LocalPoint[2]) / Radial];
            const PipeHit = QuerySlabPenetration(SignedOffset, Surface.Thickness, Radius, NormalLocal);
            if (PipeHit)
                return PipeHit;
        }
        for (const Side of [-1.0, 1.0])
        {
            const CentreY = Side * Surface.OuterOffsetY, CentreZ = Surface.SkirtRadius;
            const TowardWall = Side * (CentreY - LocalPoint[1]);
            if (TowardWall < 0.0 || TowardWall > Surface.SkirtSpan)
                continue;
            const SkirtRadial = Math.hypot(LocalPoint[1] - CentreY, LocalPoint[2] - CentreZ);
            if (SkirtRadial < 1.0e-4)
                continue;
            const SignedOffset = Surface.SkirtRadius - SkirtRadial;
            const NormalLocal = [0.0, (CentreY - LocalPoint[1]) / SkirtRadial, (CentreZ - LocalPoint[2]) / SkirtRadial];
            const SkirtHit = QuerySlabPenetration(SignedOffset, Surface.Thickness, Radius, NormalLocal);
            if (SkirtHit)
                return SkirtHit;
        }
        return null;
    }
    if (Surface.Category === SurfaceCategory.TwistedRibbon)
    {
        if (Math.abs(LocalPoint[0]) > Surface.HalfLength + Radius)
            return null;
        const ClampedX = ClampScalar(LocalPoint[0], -Surface.HalfLength, Surface.HalfLength);
        const { α, Derivative } = EvaluateRibbonTwist(Surface, ClampedX);
        const Across = LocalPoint[1] * Math.cos(α) + LocalPoint[2] * Math.sin(α);
        if (Across < -Radius || Across > Surface.Width + Radius)
            return null;
        const SignedOffset = LocalPoint[2] * Math.cos(α) - LocalPoint[1] * Math.sin(α);
        const NormalLocal = NormalizeVector([-ClampScalar(Across, 0.0, Surface.Width) * Derivative, -Math.sin(α), Math.cos(α)]);
        return QuerySlabPenetration(SignedOffset, Surface.Thickness, Radius, NormalLocal);
    }
    if (Surface.Category === SurfaceCategory.TransitionRamp)
    {
        if (Math.abs(LocalPoint[1]) > Surface.HalfWidth + Radius)
            return null;
        const RawAngle = Math.atan2(LocalPoint[0], Surface.Radius - LocalPoint[2]);
        const θ = RawAngle >= -1.0e-4 ? RawAngle : RawAngle + 2.0 * Math.PI;
        if (θ >= 0.0 && θ <= Surface.MaximumAngle)
        {
            const Radial = Math.hypot(LocalPoint[0], LocalPoint[2] - Surface.Radius);
            if (Radial > 1.0e-4)
            {
                const SignedOffset = Surface.Radius - Radial;
                const NormalLocal = [-Math.sin(θ), 0.0, Math.cos(θ)];
                return QuerySlabPenetration(SignedOffset, Surface.Thickness, Radius, NormalLocal);
            }
        }
        if (Surface.Extension > 1.0e-4)
        {
            const Tangent = [Math.cos(Surface.MaximumAngle), 0.0, Math.sin(Surface.MaximumAngle)];
            const NormalLocal = [-Math.sin(Surface.MaximumAngle), 0.0, Math.cos(Surface.MaximumAngle)];
            const RelX = LocalPoint[0] - Surface.ArcEndX, RelZ = LocalPoint[2] - Surface.ArcEndZ;
            const Along = RelX * Tangent[0] + RelZ * Tangent[2];
            if (Along >= -Radius && Along <= Surface.Extension + Radius)
            {
                const SignedOffset = RelX * NormalLocal[0] + RelZ * NormalLocal[2];
                return QuerySlabPenetration(SignedOffset, Surface.Thickness, Radius, NormalLocal);
            }
        }
    }
    if (Surface.Category === SurfaceCategory.WaveDeck)
    {
        if (Math.abs(LocalPoint[0]) > Surface.HalfLength + Radius || Math.abs(LocalPoint[1]) > Surface.HalfWidth + Radius)
            return null;
        const Profile = EvaluateWaveDeckProfile(Surface, LocalPoint[0], LocalPoint[1]);
        const NormalLocal = NormalizeVector([-Profile.SlopeX, -Profile.SlopeY, 1.0]);
        const SignedOffset = (LocalPoint[2] - Profile.Height) * NormalLocal[2];
        return QuerySlabPenetration(SignedOffset, Surface.Thickness, Radius, NormalLocal);
    }
    if (Surface.Category === SurfaceCategory.TabletopRamp)
    {
        if (LocalPoint[0] < -Radius || LocalPoint[0] > Surface.TotalLength + Radius || Math.abs(LocalPoint[1]) > Surface.HalfWidth + Radius)
            return null;
        const Profile = EvaluateTabletopProfile(Surface, LocalPoint[0], LocalPoint[1]);
        const NormalLocal = NormalizeVector([-Profile.SlopeX, -Profile.SlopeY, 1.0]);
        const SignedOffset = (LocalPoint[2] - Profile.Height) * NormalLocal[2];
        return QuerySlabPenetration(SignedOffset, Surface.Thickness, Radius, NormalLocal);
    }
    if (Surface.Category === SurfaceCategory.BankedTurn)
    {
        const Radial = Math.hypot(LocalPoint[0], LocalPoint[1]);
        if (Radial < Surface.InnerRadius - Radius || Radial > Surface.OuterRadius + Radius)
            return null;
        const Sweep = ResolveBankedTurnSweep(Surface, LocalPoint[0], LocalPoint[1]);
        if (Sweep < -0.05 || Sweep > Surface.SweepAngle + 0.05)
            return null;
        const Profile = EvaluateBankedTurnProfile(Surface, Radial - Surface.InnerRadius, Sweep);
        const CosA = LocalPoint[0] / Math.max(Radial, 1.0e-4);
        const SinA = LocalPoint[1] / Math.max(Radial, 1.0e-4);
        const NormalLocal = NormalizeVector(CrossVector([CosA, SinA, Profile.SlopeS], [-Radial * SinA, Radial * CosA, Profile.SlopePhi]));
        const SignedOffset = (LocalPoint[2] - Profile.Height) * Math.max(0.35, NormalLocal[2]);
        return QuerySlabPenetration(SignedOffset, Surface.Thickness, Radius, NormalLocal);
    }
    if (Surface.Category === SurfaceCategory.HeartlineRibbon)
    {
        if (Math.abs(LocalPoint[0]) > Surface.HalfLength + Radius)
            return null;
        const { CenterZ, SlopeZ, α, DerivativeAlpha } = EvaluateHeartlineProfile(Surface, LocalPoint[0]);
        const Across = LocalPoint[1] * Math.cos(α) + (LocalPoint[2] - CenterZ) * Math.sin(α);
        if (Across < -Surface.HalfWidth - Radius || Across > Surface.HalfWidth + Radius)
            return null;
        const Kerb = EvaluateLateralKerbLift(Across, Surface.HalfWidth, Surface.KerbWidth, Surface.KerbHeight, 1.0);
        const SignedOffset = (LocalPoint[2] - CenterZ) * Math.cos(α) - LocalPoint[1] * Math.sin(α) - Kerb.Lift;
        const NormalLocal = NormalizeVector([
            -SlopeZ * Math.cos(α) - ClampScalar(Across, -Surface.HalfWidth, Surface.HalfWidth) * DerivativeAlpha,
            -Math.sin(α) - Kerb.Slope * Math.cos(α),
            Math.cos(α) - Kerb.Slope * Math.sin(α)
        ]);
        return QuerySlabPenetration(SignedOffset, Surface.Thickness, Radius, NormalLocal);
    }
    if (Surface.Category === SurfaceCategory.SubmergedTrench)
    {
        if (LocalPoint[0] < -Radius || LocalPoint[0] > Surface.TotalLength + Radius)
            return null;
        const AbsY = Math.abs(LocalPoint[1]);
        if (AbsY > Surface.HalfWidth + Surface.WallThickness + Radius)
            return null;
        const Floor = EvaluateSubmergedTrenchFloor(Surface, ClampScalar(LocalPoint[0], 0.0, Surface.TotalLength));
        let Best = null;

        // ① Floor & ramp slab
        if (AbsY <= Surface.HalfWidth + Radius)
        {
            const NormalFloor = NormalizeVector([-Floor.SlopeX, 0.0, 1.0]);
            const FloorHit = QuerySlabPenetration((LocalPoint[2] - Floor.Height) * NormalFloor[2], Surface.Thickness, Radius, NormalFloor);
            if (FloorHit)
                Best = FloorHit;
        }

        // ② Left & right vertical tunnel retaining walls (flush below Z = 0 across GroundDeckOverRoof crossings!)
        const OverRoofGallery = Surface.Roofed && Surface.GroundDeckOverRoof &&
                                LocalPoint[0] >= Surface.DownLength && LocalPoint[0] <= Surface.DownLength + Surface.TunnelLength;
        const LocalWallTopZ = OverRoofGallery ? (Surface.RoofBottomZ + 0.05) : Surface.WallTopZ;
        if (LocalPoint[0] >= 1.2 && LocalPoint[0] <= Surface.TotalLength - 1.2 &&
            LocalPoint[2] >= Floor.Height - 0.1 && LocalPoint[2] <= LocalWallTopZ + Radius &&
            AbsY > Surface.HalfWidth - Radius && AbsY < Surface.HalfWidth + Surface.WallThickness + Radius)
        {
            const SignY = LocalPoint[1] >= 0.0 ? 1.0 : -1.0;
            const InnerDepth = Radius - (Surface.HalfWidth - AbsY);
            const OuterDepth = (Surface.HalfWidth + Surface.WallThickness + Radius) - AbsY;
            if (InnerDepth > 0.0 && InnerDepth <= OuterDepth && (!Best || InnerDepth > Best.Depth))
                Best = { Depth: InnerDepth, LocalNormal: [0.0, -SignY, 0.0] };
            else if (OuterDepth > 0.0 && OuterDepth < InnerDepth && (!Best || OuterDepth > Best.Depth))
                Best = { Depth: OuterDepth, LocalNormal: [0.0, SignY, 0.0] };
        }

        // ③ Overhead roof slab over subterranean tunnel gallery
        if (Surface.Roofed && LocalPoint[0] >= Surface.DownLength - Radius &&
            LocalPoint[0] <= Surface.DownLength + Surface.TunnelLength + Radius &&
            AbsY <= Surface.HalfWidth + Surface.WallThickness)
        {
            const RoofThickness = Surface.RoofTopZ - Surface.RoofBottomZ;
            const RoofHit = QuerySlabPenetration(LocalPoint[2] - Surface.RoofTopZ, RoofThickness, Radius, [0.0, 0.0, 1.0]);
            if (RoofHit && (!Best || RoofHit.Depth > Best.Depth))
                Best = RoofHit;
        }

        // ④ Dead-end subterranean bulkhead wall at far end of excavation pit
        if (Surface.DeadEnd &&
            LocalPoint[0] > Surface.TotalLength - Radius &&
            LocalPoint[0] < Surface.TotalLength + Surface.WallThickness + Radius &&
            AbsY <= Surface.HalfWidth + Surface.WallThickness &&
            LocalPoint[2] >= -Surface.Depth - 0.25 && LocalPoint[2] <= Surface.WallTopZ + Radius)
        {
            const InnerX = Radius - (Surface.TotalLength - LocalPoint[0]);
            const OuterX = (Surface.TotalLength + Surface.WallThickness + Radius) - LocalPoint[0];
            if (InnerX > 0.0 && InnerX <= OuterX && (!Best || InnerX > Best.Depth))
                Best = { Depth: InnerX, LocalNormal: [-1.0, 0.0, 0.0] };
            else if (OuterX > 0.0 && OuterX < InnerX && (!Best || OuterX > Best.Depth))
                Best = { Depth: OuterX, LocalNormal: [1.0, 0.0, 0.0] };
        }
        return Best;
    }
    if (Surface.Category === SurfaceCategory.SerpentineWave)
    {
        if (Math.abs(LocalPoint[0]) > Surface.HalfLength + Radius || Math.abs(LocalPoint[1]) > Surface.HalfWidth + Radius)
            return null;
        const Profile = EvaluateSerpentineWaveProfile(Surface, LocalPoint[0], LocalPoint[1]);
        const NormalLocal = NormalizeVector([-Profile.SlopeX, -Profile.SlopeY, 1.0]);
        const SignedOffset = (LocalPoint[2] - Profile.Height) * NormalLocal[2];
        return QuerySlabPenetration(SignedOffset, Surface.Thickness, Radius, NormalLocal);
    }
    if (Surface.Category === SurfaceCategory.CollapseDeck)
    {
        if (LocalPoint[0] < -Radius || LocalPoint[0] > Surface.TotalLength + Radius || Math.abs(LocalPoint[1]) > Surface.HalfWidth + Radius)
            return null;
        const ClampedX = ClampScalar(LocalPoint[0], 0.0, Surface.TotalLength);
        const Span = EvaluateCollapseDeckSpan(Surface, ClampedX, ClampScalar(LocalPoint[1], -Surface.HalfWidth, Surface.HalfWidth));
        if (!Span || !Span.Supported)
            return null;
        const NormalLocal = NormalizeVector([-Span.SlopeX, -Span.SlopeY, 1.0]);
        const SignedOffset = (LocalPoint[2] - Span.Height) * NormalLocal[2];
        const SlabHit = QuerySlabPenetration(SignedOffset, Surface.Thickness, Radius, NormalLocal);
        if (!SlabHit)
            return null;
        // 📝 Separating-axis ledge check against exposed fracture seams beside collapsed bays so falling hulls slide cleanly off ledges.
        let Best = SlabHit;
        const SpanEnd = Surface.UpLength + Surface.DeckLength;
        if (ClampedX >= Surface.UpLength && ClampedX <= SpanEnd)
        {
            const RelX = ClampScalar(ClampedX - Surface.UpLength, 0.0, Surface.DeckLength - 1.0e-5);
            const BayIndex = Math.min(Surface.BayCount - 1, Math.max(0, Math.floor(RelX / Surface.BayLength)));
            if (BayIndex > 0 && !Surface.BayIntact[BayIndex - 1])
            {
                const RearLedgeDepth = (RelX - BayIndex * Surface.BayLength) + Radius;
                if (RearLedgeDepth > 0.0 && RearLedgeDepth < Best.Depth)
                    Best = { LocalNormal: [-1.0, 0.0, 0.0], Depth: RearLedgeDepth };
            }
            if (BayIndex + 1 < Surface.BayCount && !Surface.BayIntact[BayIndex + 1])
            {
                const FrontLedgeDepth = ((BayIndex + 1) * Surface.BayLength - RelX) + Radius;
                if (FrontLedgeDepth > 0.0 && FrontLedgeDepth < Best.Depth)
                    Best = { LocalNormal: [1.0, 0.0, 0.0], Depth: FrontLedgeDepth };
            }
        }
        return Best;
    }
    if (Surface.Category === SurfaceCategory.SplineRoad && typeof Surface.QueryHullContact === "function")
        return Surface.QueryHullContact(LocalPoint, Radius);
    return null;
}

// 📝 Queries deepest hull point/sphere contact against all 3D ramp solids.
export function QuerySurfaceHullContact(Surfaces, Point, Radius)
{
    if (!Surfaces || Surfaces.length === 0)
        return null;
    let Deepest = null;
    for (let Index = 0; Index < Surfaces.length; ++Index)
    {
        const Surface = Surfaces[Index];
        if (Point[0] + Radius < Surface.WorldMinimum[0] || Point[0] - Radius > Surface.WorldMaximum[0] ||
            Point[1] + Radius < Surface.WorldMinimum[1] || Point[1] - Radius > Surface.WorldMaximum[1] ||
            Point[2] + Radius < Surface.WorldMinimum[2] || Point[2] - Radius > Surface.WorldMaximum[2])
            continue;
        const LocalPoint = ProjectWorldToSurface(Surface, Point);
        const Hit = QuerySurfacePointLocal(Surface, LocalPoint, Radius);
        if (Hit && Hit.Depth > 0.0 && (!Deepest || Hit.Depth > Deepest.Depth))
        {
            Deepest = {
                Normal:       ProjectDirectionFromSurface(Surface, Hit.LocalNormal),
                Depth:        Hit.Depth,
                SurfaceIndex: 10000 + Index
            };
        }
    }
    return Deepest;
}

//------------------------------------------------------------------------------------------------------------------------
//                                      MODULAR SEGMENT SHAPE & PLACEMENT GENERATION
//------------------------------------------------------------------------------------------------------------------------

// 📝 Generates surface-aligned modular FacetSets, 3D quaternion Placements, and Jolt convex terrain hulls from Surfaces.
export function ConstructSurfaceSegmentDescriptors(Surfaces)
{
    const Shapes = {};
    const Placements = [];
    const TerrainHulls = [];

    for (const Surface of Surfaces)
    {
        if (Surface.Category === SurfaceCategory.HelicalLoop)
            AppendHelicalLoopSegments(Surface, Shapes, Placements, TerrainHulls);
        else if (Surface.Category === SurfaceCategory.FullPipe)
            AppendFullPipeSegments(Surface, Shapes, Placements, TerrainHulls);
        else if (Surface.Category === SurfaceCategory.TwistedRibbon)
            AppendTwistedRibbonSegments(Surface, Shapes, Placements, TerrainHulls);
        else if (Surface.Category === SurfaceCategory.TransitionRamp)
            AppendTransitionRampSegments(Surface, Shapes, Placements, TerrainHulls);
        else if (Surface.Category === SurfaceCategory.WaveDeck)
            AppendWaveDeckSegments(Surface, Shapes, Placements);
        else if (Surface.Category === SurfaceCategory.TabletopRamp)
            AppendTabletopRampSegments(Surface, Shapes, Placements);
        else if (Surface.Category === SurfaceCategory.BankedTurn)
            AppendBankedTurnSegments(Surface, Shapes, Placements);
        else if (Surface.Category === SurfaceCategory.HeartlineRibbon)
            AppendHeartlineRibbonSegments(Surface, Shapes, Placements);
        else if (Surface.Category === SurfaceCategory.SubmergedTrench)
            AppendSubmergedTrenchSegments(Surface, Shapes, Placements);
        else if (Surface.Category === SurfaceCategory.SerpentineWave)
            AppendSerpentineWaveSegments(Surface, Shapes, Placements);
        else if (Surface.Category === SurfaceCategory.CollapseDeck)
            AppendCollapseDeckSegments(Surface, Shapes, Placements);
    }

    return { Shapes, Placements, TerrainHulls };
}

function AppendHelicalLoopSegments(Surface, Shapes, Placements, TerrainHulls)
{
    const SegmentCount = 12;
    const HalfSegments = 6;
    const SubSlices = 5;
    const LateralStops = [-Surface.HalfWidth, -(Surface.HalfWidth - Surface.KerbWidth), -0.65, 0.65,
                          Surface.HalfWidth - Surface.KerbWidth, Surface.HalfWidth];

    for (let Segment = 0; Segment < SegmentCount; ++Segment)
    {
        const IsMirror = Segment >= HalfSegments;
        const CanonicalSeg = IsMirror ? (SegmentCount - 1 - Segment) : Segment;
        const Angle0 = (2.0 * Math.PI * Segment) / SegmentCount;
        const Angle1 = (2.0 * Math.PI * (Segment + 1)) / SegmentCount;
        const CanonAngleMid = (2.0 * Math.PI * (CanonicalSeg + 0.5)) / SegmentCount;
        const TopGrid = [], BottomGrid = [], TopNormals = [], TopFamilies = [];

        for (let StepU = 0; StepU <= SubSlices; ++StepU)
        {
            const θ = Angle0 + (Angle1 - Angle0) * (StepU / SubSlices);
            const ShiftY = EvaluateHelicalShift(Surface.HelicalShift, θ);
            const BaseX = Surface.Radius * Math.sin(θ);
            const BaseZ = Surface.Radius * (1.0 - Math.cos(θ)) + 0.008;
            const RadialInward = [-Math.sin(θ), 0.0, Math.cos(θ)];
            const RowTop = [], RowBottom = [], RowNormals = [], RowFamilies = [];

            for (let StepV = 0; StepV < LateralStops.length; ++StepV)
            {
                const Lateral = LateralStops[StepV];
                const Kerb = EvaluateHelicalLateralSlope(Surface, θ, Lateral);
                const TopLocal = [BaseX + RadialInward[0] * Kerb.Lift, ShiftY + Lateral, BaseZ + RadialInward[2] * Kerb.Lift];
                const BottomLocal = MultiplyAddVector(TopLocal, RadialInward, -Surface.Thickness);
                const NormalLocal = NormalizeVector([RadialInward[0], -Kerb.LateralSlope, RadialInward[2]]);
                RowTop.push(ProjectPointFromSurface(Surface, TopLocal));
                RowBottom.push(ProjectPointFromSurface(Surface, BottomLocal));
                RowNormals.push(ProjectDirectionFromSurface(Surface, NormalLocal));
                if (StepV < LateralStops.length - 1)
                {
                    const EdgeKerb = StepV === 0 || StepV === LateralStops.length - 2;
                    const CentreStripe = StepV === 2;
                    const KerbColour = (CanonicalSeg & 1) ? CourseMaterial.PaintWhite : CourseMaterial.KerbRed;
                    const CrownGlow = CanonicalSeg >= 4 ? CourseMaterial.GateLamp : Surface.AccentMaterial;
                    RowFamilies.push(EdgeKerb ? KerbColour : (CentreStripe ? ((CanonicalSeg % 2 === 0) ? CrownGlow : CourseMaterial.ApronConcrete)
                                                                            : CourseMaterial.ApronConcrete));
                }
            }
            TopGrid.push(RowTop);
            BottomGrid.push(RowBottom);
            TopNormals.push(RowNormals);
            if (StepU < SubSlices)
                TopFamilies.push(RowFamilies);
        }

        const Sign = IsMirror ? -1.0 : 1.0;
        const CanonShift = EvaluateHelicalShift(Surface.HelicalShift, CanonAngleMid);
        const MidLocal = [
            Sign * Surface.Radius * Math.sin(CanonAngleMid),
            IsMirror ? (Surface.HelicalShift - CanonShift) : CanonShift,
            Surface.Radius * (1.0 - Math.cos(CanonAngleMid))
        ];
        const FrameOrigin = ProjectPointFromSurface(Surface, MidLocal);
        const AxisX = ProjectDirectionFromSurface(Surface, [Sign * Math.cos(CanonAngleMid), 0.0, Math.sin(CanonAngleMid)]);
        const AxisY = ProjectDirectionFromSurface(Surface, [0.0, Sign, 0.0]);
        const AxisZ = ProjectDirectionFromSurface(Surface, [-Sign * Math.sin(CanonAngleMid), 0.0, Math.cos(CanonAngleMid)]);
        const FrameQuaternion = ConstructBasisQuaternion(AxisX, AxisY, AxisZ);

        const ShapeKey = `${Surface.ShapePrefix}_Arc_${String(CanonicalSeg).padStart(2, "0")}`;
        if (!IsMirror && !Shapes[ShapeKey])
        {
            const WorldFacets = ConstructClosedGridSlabFacets(TopGrid, BottomGrid, TopNormals, TopFamilies,
                                                              CourseMaterial.SteelDark, CourseMaterial.TunnelConcrete);
            Shapes[ShapeKey] = {
                Emit:  () => TransformFacetsToLocalFrame(WorldFacets, FrameOrigin, FrameQuaternion),
                Voxel: 0.34,
                Cards: 8
            };
        }
        Placements.push({
            Shape:       ShapeKey,
            Name:        `${Surface.Key} segment ${Segment}`,
            Position:    FrameOrigin,
            Orientation: FrameQuaternion,
            Yaw:         0.0,
            Material:    -1,
            Collider:    false
        });
        if (Segment <= 2 || Segment >= 9)
            TerrainHulls.push([...TopGrid.flat(), ...BottomGrid.flat()]);
    }
}

function AppendFullPipeSegments(Surface, Shapes, Placements, TerrainHulls)
{
    // ① One instanced sector FacetSet (22.5° × 12 m) builds all 64 tiles of the 360° Full-Pipe
    const AngularSectors = 16;
    const AxialRings = 4;
    const SectorSpan = (2.0 * Math.PI) / AngularSectors;
    const RingLength = Surface.Length / AxialRings;
    const SubAngles = 4;
    const SectorKey = `${Surface.Key}_Sector`;
    const LampSectorKey = `${Surface.Key}_CrownSector`;

    const BuildPipeSector = (CrownLamp) =>
    {
        const TopGrid = [], BottomGrid = [], TopNormals = [], TopFamilies = [];
        const AxialStops = [-0.5 * RingLength, -0.18 * RingLength, 0.18 * RingLength, 0.5 * RingLength];
        for (let StepU = 0; StepU < AxialStops.length; ++StepU)
        {
            const CoordX = AxialStops[StepU];
            const RowTop = [], RowBottom = [], RowNormals = [], RowFamilies = [];
            for (let StepV = 0; StepV <= SubAngles; ++StepV)
            {
                const φ = -0.5 * SectorSpan + SectorSpan * (StepV / SubAngles);
                const TopLocal = [CoordX, Surface.Radius * Math.sin(φ), -Surface.Radius * Math.cos(φ) + Surface.Radius];
                const RadialOut = [0.0, Math.sin(φ), -Math.cos(φ)];
                const BottomLocal = MultiplyAddVector(TopLocal, RadialOut, Surface.Thickness);
                const NormalLocal = ScaleVector(RadialOut, -1.0);
                // Express directly in sector-midpoint frame where midpoint (0, 0, 0) has +X axial, +Y tangent, +Z inward normal (0,0,1)
                RowTop.push([TopLocal[0], TopLocal[1], TopLocal[2]]);
                RowBottom.push([BottomLocal[0], BottomLocal[1], BottomLocal[2]]);
                RowNormals.push(NormalLocal);
                if (StepV < SubAngles)
                {
                    const MidBand = StepU === 1;
                    RowFamilies.push(CrownLamp && MidBand ? CourseMaterial.LampCool
                                                          : (MidBand && StepV === 1 ? CourseMaterial.PaintBlue : CourseMaterial.ApronConcrete));
                }
            }
            TopGrid.push(RowTop);
            BottomGrid.push(RowBottom);
            TopNormals.push(RowNormals);
            if (StepU < AxialStops.length - 1)
                TopFamilies.push(RowFamilies);
        }
        return ConstructClosedGridSlabFacets(TopGrid, BottomGrid, TopNormals, TopFamilies,
                                             CourseMaterial.TunnelConcrete, CourseMaterial.Cladding);
    };

    Shapes[SectorKey]     = { Emit: () => BuildPipeSector(false), Voxel: 0.17, Cards: 8 };
    Shapes[LampSectorKey] = { Emit: () => BuildPipeSector(true),  Voxel: 0.17, Cards: 8 };

    for (let Sector = 0; Sector < AngularSectors; ++Sector)
    {
        const Angle = Sector * SectorSpan;
        const Crown = Sector === 7 || Sector === 8 || Sector === 9;
        for (let Ring = 0; Ring < AxialRings; ++Ring)
        {
            const LocalX = -Surface.HalfLength + (Ring + 0.5) * RingLength;
            const Lift = Sector === 0 ? 0.012 : 0.0;
            const AnchorLocal = [LocalX, Surface.Radius * Math.sin(Angle), Surface.Radius * (1.0 - Math.cos(Angle)) + Lift];
            const AxisX = ProjectDirectionFromSurface(Surface, [1.0, 0.0, 0.0]);
            const AxisY = ProjectDirectionFromSurface(Surface, [0.0, Math.cos(Angle), Math.sin(Angle)]);
            const AxisZ = ProjectDirectionFromSurface(Surface, [0.0, -Math.sin(Angle), Math.cos(Angle)]);
            Placements.push({
                Shape:       Crown ? LampSectorKey : SectorKey,
                Name:        `${Surface.Key} ring ${Ring} sector ${Sector}`,
                Position:    ProjectPointFromSurface(Surface, AnchorLocal),
                Orientation: ConstructBasisQuaternion(AxisX, AxisY, AxisZ),
                Yaw:         0.0,
                Material:    -1,
                Collider:    false
            });
        }
    }

    // ② Outer 45° quarter-pipe transition skirts along both sides of the Full-Pipe
    const SkirtKey = `${Surface.Key}_Skirt`;
    const BuildSkirtSegment = () =>
    {
        const TopGrid = [], BottomGrid = [], TopNormals = [], TopFamilies = [];
        const SubArc = 5;
        const AxialStops = [-0.5 * RingLength, 0.5 * RingLength];
        for (let StepU = 0; StepU < AxialStops.length; ++StepU)
        {
            const CoordX = AxialStops[StepU];
            const RowTop = [], RowBottom = [], RowNormals = [], RowFamilies = [];
            for (let StepV = 0; StepV <= SubArc; ++StepV)
            {
                const φ = Surface.SkirtAngle * (StepV / SubArc);
                const TopLocal = [CoordX, Surface.SkirtRadius * Math.sin(φ), Surface.SkirtRadius * (1.0 - Math.cos(φ)) + 0.01];
                const NormalLocal = [0.0, -Math.sin(φ), Math.cos(φ)];
                const BottomLocal = [TopLocal[0], TopLocal[1], -0.45];
                RowTop.push(TopLocal);
                RowBottom.push(BottomLocal);
                RowNormals.push(NormalLocal);
                if (StepV < SubArc)
                    RowFamilies.push(StepV === SubArc - 1 ? CourseMaterial.PaintYellow : CourseMaterial.ApronConcrete);
            }
            TopGrid.push(RowTop);
            BottomGrid.push(RowBottom);
            TopNormals.push(RowNormals);
            if (StepU === 0)
                TopFamilies.push(RowFamilies);
        }
        return ConstructClosedGridSlabFacets(TopGrid, BottomGrid, TopNormals, TopFamilies,
                                             CourseMaterial.BarrierConcrete, CourseMaterial.BarrierConcrete);
    };
    Shapes[SkirtKey] = { Emit: BuildSkirtSegment, Voxel: 0.24, Cards: 8 };

    for (const Side of [1.0, -1.0])
    {
        const YawOffset = Side > 0.0 ? Math.PI : 0.0;
        const TotalYaw = Surface.Yaw + YawOffset;
        const Orientation = ConstructAxisQuaternion([0.0, 0.0, 1.0], TotalYaw);
        for (let Ring = 0; Ring < AxialRings; ++Ring)
        {
            const LocalX = -Surface.HalfLength + (Ring + 0.5) * RingLength;
            const AnchorLocal = [LocalX, Side * Surface.OuterOffsetY, 0.0];
            Placements.push({
                Shape:       SkirtKey,
                Name:        `${Surface.Key} outer skirt ${Side > 0 ? "N" : "S"}${Ring}`,
                Position:    ProjectPointFromSurface(Surface, AnchorLocal),
                Orientation,
                Yaw:         TotalYaw,
                Material:    -1,
                Collider:    false
            });
        }
    }
}

function AppendTwistedRibbonSegments(Surface, Shapes, Placements, TerrainHulls)
{
    const SegmentCount = 10;
    const SubSlices = 4;
    const LateralStops = [0.0, 0.45, 0.45 * Surface.Width, 0.55 * Surface.Width, Surface.Width - 0.55, Surface.Width];

    for (let Segment = 0; Segment < SegmentCount; ++Segment)
    {
        const X0 = -Surface.HalfLength + (Surface.Length * Segment) / SegmentCount;
        const X1 = -Surface.HalfLength + (Surface.Length * (Segment + 1)) / SegmentCount;
        const XMid = 0.5 * (X0 + X1);
        const TopGrid = [], BottomGrid = [], TopNormals = [], TopFamilies = [];

        for (let StepU = 0; StepU <= SubSlices; ++StepU)
        {
            const CoordX = X0 + (X1 - X0) * (StepU / SubSlices);
            const { α, Derivative } = EvaluateRibbonTwist(Surface, CoordX);
            const RowTop = [], RowBottom = [], RowNormals = [], RowFamilies = [];
            for (let StepV = 0; StepV < LateralStops.length; ++StepV)
            {
                const Across = LateralStops[StepV];
                const TopLocal = [CoordX, Across * Math.cos(α), Across * Math.sin(α) + 0.012];
                const NormalLocal = NormalizeVector([-Across * Derivative, -Math.sin(α), Math.cos(α)]);
                const BottomLocal = MultiplyAddVector(TopLocal, NormalLocal, -Surface.Thickness);
                RowTop.push(ProjectPointFromSurface(Surface, TopLocal));
                RowBottom.push(ProjectPointFromSurface(Surface, BottomLocal));
                RowNormals.push(ProjectDirectionFromSurface(Surface, NormalLocal));
                if (StepV < LateralStops.length - 1)
                {
                    const UpperEdge = StepV === LateralStops.length - 2;
                    const CentreBand = StepV === 2;
                    RowFamilies.push(UpperEdge ? ((Segment & 1) ? CourseMaterial.PaintWhite : CourseMaterial.KerbRed)
                                               : (CentreBand ? ((Segment & 1) ? Surface.AccentMaterial : CourseMaterial.ApronConcrete)
                                                             : CourseMaterial.ApronConcrete));
                }
            }
            TopGrid.push(RowTop);
            BottomGrid.push(RowBottom);
            TopNormals.push(RowNormals);
            if (StepU < SubSlices)
                TopFamilies.push(RowFamilies);
        }

        const MidTwist = EvaluateRibbonTwist(Surface, XMid);
        const MidAcross = 0.5 * Surface.Width;
        const MidLocal = [XMid, MidAcross * Math.cos(MidTwist.α), MidAcross * Math.sin(MidTwist.α)];
        const FrameOrigin = ProjectPointFromSurface(Surface, MidLocal);
        const AxisX = ProjectDirectionFromSurface(Surface, [1.0, 0.0, 0.0]);
        const AxisY = ProjectDirectionFromSurface(Surface, [0.0, Math.cos(MidTwist.α), Math.sin(MidTwist.α)]);
        const AxisZ = ProjectDirectionFromSurface(Surface, [0.0, -Math.sin(MidTwist.α), Math.cos(MidTwist.α)]);
        const FrameQuaternion = ConstructBasisQuaternion(AxisX, AxisY, AxisZ);

        const WorldFacets = ConstructClosedGridSlabFacets(TopGrid, BottomGrid, TopNormals, TopFamilies,
                                                          CourseMaterial.SteelDark, CourseMaterial.BarrierConcrete);
        const SymmetricPlateau = Math.abs(X0) <= Surface.HalfLength - Surface.TwistLength &&
                                 Math.abs(X1) <= Surface.HalfLength - Surface.TwistLength;
        const ShapeKey = SymmetricPlateau
            ? `${Surface.ShapePrefix}_Ribbon_Plateau`
            : `${Surface.ShapePrefix}_Ribbon_${String(Segment).padStart(2, "0")}`;
        if (!Shapes[ShapeKey])
        {
            Shapes[ShapeKey] = {
                Emit:  () => TransformFacetsToLocalFrame(WorldFacets, FrameOrigin, FrameQuaternion),
                Voxel: 0.44,
                Cards: 9
            };
        }
        Placements.push({
            Shape:       ShapeKey,
            Name:        `${Surface.Key} ribbon ${Segment}`,
            Position:    FrameOrigin,
            Orientation: FrameQuaternion,
            Yaw:         0.0,
            Material:    -1,
            Collider:    false
        });
        TerrainHulls.push([...TopGrid.flat(), ...BottomGrid.flat()]);
    }
}

function AppendTransitionRampSegments(Surface, Shapes, Placements, TerrainHulls)
{
    const ArcSegments = Math.max(3, Math.ceil(Surface.MaximumAngle / (Math.PI / 7.5)));
    const WidthTiles = Math.max(1, Math.round(Surface.Width / 14.0));
    const TileWidth = Surface.Width / WidthTiles;
    const SubSlices = 4;
    const AngularSpan = Surface.MaximumAngle / ArcSegments;
    const SharedArcKey = `${Surface.ShapePrefix}_ArcTile`;

    // 📝 One congruent local-tangent arc tile instanced across all angular steps and width lanes of this ramp
    if (!Shapes[SharedArcKey])
    Shapes[SharedArcKey] = {
        Emit: () =>
        {
            const TopGrid = [], BottomGrid = [], TopNormals = [], TopFamilies = [];
            const LateralStops = [-0.5 * TileWidth, -0.5 * TileWidth + 0.45, -0.55, 0.55, 0.5 * TileWidth - 0.45, 0.5 * TileWidth];
            for (let StepU = 0; StepU <= SubSlices; ++StepU)
            {
                const θ = -0.5 * AngularSpan + AngularSpan * (StepU / SubSlices);
                const LocalX = Surface.Radius * Math.sin(θ);
                const LocalZ = Surface.Radius * (1.0 - Math.cos(θ));
                const NormalInFrame = [-Math.sin(θ), 0.0, Math.cos(θ)];
                const RowTop = [], RowBottom = [], RowNormals = [], RowFamilies = [];
                for (let StepV = 0; StepV < LateralStops.length; ++StepV)
                {
                    const Lateral = LateralStops[StepV];
                    const TopPt = [LocalX, Lateral, LocalZ + 0.008];
                    const BotPt = MultiplyAddVector(TopPt, NormalInFrame, -Surface.Thickness);
                    RowTop.push(TopPt);
                    RowBottom.push(BotPt);
                    RowNormals.push(NormalInFrame);
                    if (StepV < LateralStops.length - 1)
                    {
                        const Edge = StepV === 0 || StepV === LateralStops.length - 2;
                        const Centre = StepV === 2;
                        RowFamilies.push(Edge ? ((StepU & 1) ? CourseMaterial.PaintWhite : CourseMaterial.KerbRed)
                                              : (Centre ? Surface.AccentMaterial : CourseMaterial.ApronConcrete));
                    }
                }
                TopGrid.push(RowTop);
                BottomGrid.push(RowBottom);
                TopNormals.push(RowNormals);
                if (StepU < SubSlices)
                    TopFamilies.push(RowFamilies);
            }
            return ConstructClosedGridSlabFacets(TopGrid, BottomGrid, TopNormals, TopFamilies,
                                                 CourseMaterial.SteelDark, CourseMaterial.TunnelConcrete);
        },
        Voxel: 0.18,
        Cards: 10
    };

    for (let Segment = 0; Segment < ArcSegments; ++Segment)
    {
        const Angle0 = (Surface.MaximumAngle * Segment) / ArcSegments;
        const Angle1 = (Surface.MaximumAngle * (Segment + 1)) / ArcSegments;
        const AngleMid = 0.5 * (Angle0 + Angle1);
        const AxisX = ProjectDirectionFromSurface(Surface, [Math.cos(AngleMid), 0.0, Math.sin(AngleMid)]);
        const AxisY = ProjectDirectionFromSurface(Surface, [0.0, 1.0, 0.0]);
        const AxisZ = ProjectDirectionFromSurface(Surface, [-Math.sin(AngleMid), 0.0, Math.cos(AngleMid)]);
        const Orientation = ConstructBasisQuaternion(AxisX, AxisY, AxisZ);

        for (let Tile = 0; Tile < WidthTiles; ++Tile)
        {
            const TileCentreY = -Surface.HalfWidth + (Tile + 0.5) * TileWidth;
            const AnchorLocal = [Surface.Radius * Math.sin(AngleMid), TileCentreY, Surface.Radius * (1.0 - Math.cos(AngleMid))];
            Placements.push({
                Shape:       SharedArcKey,
                Name:        `${Surface.Key} arc ${Segment} tile ${Tile}`,
                Position:    ProjectPointFromSurface(Surface, AnchorLocal),
                Orientation,
                Yaw:         0.0,
                Material:    -1,
                Collider:    false
            });
        }
    }

    if (Surface.Extension > 1.0e-4)
    {
        const ExtKey = `${Surface.ShapePrefix}_Deck`;
        const BuildExtTile = () =>
        {
            const HalfExt = 0.5 * Surface.Extension;
            const LateralStops = [-0.5 * TileWidth, -0.5 * TileWidth + 0.45, -0.55, 0.55, 0.5 * TileWidth - 0.45, 0.5 * TileWidth];
            const TopGrid = [], BottomGrid = [], TopNormals = [], TopFamilies = [];
            for (const CoordU of [-HalfExt, HalfExt])
            {
                const RowTop = [], RowBottom = [], RowNormals = [], RowFamilies = [];
                for (let StepV = 0; StepV < LateralStops.length; ++StepV)
                {
                    const Lateral = LateralStops[StepV];
                    RowTop.push([CoordU, Lateral, 0.0]);
                    RowBottom.push([CoordU, Lateral, -Surface.Thickness]);
                    RowNormals.push([0.0, 0.0, 1.0]);
                    if (StepV < LateralStops.length - 1)
                    {
                        const Edge = StepV === 0 || StepV === LateralStops.length - 2;
                        const Centre = StepV === 2;
                        RowFamilies.push(Edge ? CourseMaterial.PaintYellow : (Centre ? CourseMaterial.GateLamp : CourseMaterial.ApronConcrete));
                    }
                }
                TopGrid.push(RowTop);
                BottomGrid.push(RowBottom);
                TopNormals.push(RowNormals);
                if (CoordU < 0.0)
                    TopFamilies.push(RowFamilies);
            }
            return ConstructClosedGridSlabFacets(TopGrid, BottomGrid, TopNormals, TopFamilies,
                                                 CourseMaterial.SteelDark, CourseMaterial.TunnelConcrete);
        };
        if (!Shapes[ExtKey])
            Shapes[ExtKey] = { Emit: BuildExtTile, Voxel: 0.14, Cards: 12 };

        const θ = Surface.MaximumAngle;
        const AxisX = ProjectDirectionFromSurface(Surface, [Math.cos(θ), 0.0, Math.sin(θ)]);
        const AxisY = ProjectDirectionFromSurface(Surface, [0.0, 1.0, 0.0]);
        const AxisZ = ProjectDirectionFromSurface(Surface, [-Math.sin(θ), 0.0, Math.cos(θ)]);
        const Orientation = ConstructBasisQuaternion(AxisX, AxisY, AxisZ);
        const MidX = Surface.ArcEndX + 0.5 * Surface.Extension * Math.cos(θ);
        const MidZ = Surface.ArcEndZ + 0.5 * Surface.Extension * Math.sin(θ);

        for (let Tile = 0; Tile < WidthTiles; ++Tile)
        {
            const TileCentreY = -Surface.HalfWidth + (Tile + 0.5) * TileWidth;
            Placements.push({
                Shape:       ExtKey,
                Name:        `${Surface.Key} extension tile ${Tile}`,
                Position:    ProjectPointFromSurface(Surface, [MidX, TileCentreY, MidZ]),
                Orientation,
                Yaw:         0.0,
                Material:    -1,
                Collider:    false
            });
        }
    }
}

function BuildOrthonormalTangentBasis(TangentX, LateralHint)
{
    const UnitX = NormalizeVector(TangentX);
    const RawZ = CrossVector(UnitX, LateralHint);
    const UnitZ = NormalizeVector(RawZ);
    const UnitY = NormalizeVector(CrossVector(UnitZ, UnitX));
    return { AxisX: UnitX, AxisY: UnitY, AxisZ: UnitZ };
}

function AppendWaveDeckSegments(Surface, Shapes, Placements)
{
    const PeriodLength = Surface.Length / Surface.WaveCount;
    const SegmentsPerWave = 4;
    const SubSlices = 4;
    const LateralStops = [-Surface.HalfWidth, -(Surface.HalfWidth - Surface.KerbWidth), -0.65, 0.65,
                          Surface.HalfWidth - Surface.KerbWidth, Surface.HalfWidth];

    for (let Seg = 0; Seg < SegmentsPerWave; ++Seg)
    {
        const RelX0 = (PeriodLength * Seg) / SegmentsPerWave;
        const RelX1 = (PeriodLength * (Seg + 1)) / SegmentsPerWave;
        const BaseX0 = -Surface.HalfLength + RelX0;
        const BaseX1 = -Surface.HalfLength + RelX1;
        const BaseXMid = 0.5 * (BaseX0 + BaseX1);
        const MidProfile = EvaluateWaveDeckProfile(Surface, BaseXMid, 0.0);
        const LocalBasis = BuildOrthonormalTangentBasis([1.0, 0.0, MidProfile.SlopeX], [0.0, 1.0, 0.0]);
        const CanonicalAnchor = [BaseXMid, 0.0, MidProfile.Height];
        const CanonicalQuat = ConstructBasisQuaternion(LocalBasis.AxisX, LocalBasis.AxisY, LocalBasis.AxisZ);

        const TopGrid = [], BottomGrid = [], TopNormals = [], TopFamilies = [];
        for (let StepU = 0; StepU <= SubSlices; ++StepU)
        {
            const X = BaseX0 + (BaseX1 - BaseX0) * (StepU / SubSlices);
            const RowTop = [], RowBottom = [], RowNormals = [], RowFamilies = [];
            for (let StepV = 0; StepV < LateralStops.length; ++StepV)
            {
                const Y = LateralStops[StepV];
                const Profile = EvaluateWaveDeckProfile(Surface, X, Y);
                const NormalLocal = NormalizeVector([-Profile.SlopeX, -Profile.SlopeY, 1.0]);
                const TopPt = [X, Y, Profile.Height];
                const BotPt = MultiplyAddVector(TopPt, NormalLocal, -Surface.Thickness);
                RowTop.push(TopPt);
                RowBottom.push(BotPt);
                RowNormals.push(NormalLocal);
                if (StepV < LateralStops.length - 1)
                {
                    const Edge = StepV === 0 || StepV === LateralStops.length - 2;
                    const Centre = StepV === 2;
                    RowFamilies.push(Edge ? ((Seg & 1) ? CourseMaterial.PaintWhite : CourseMaterial.KerbRed)
                                          : (Centre ? Surface.AccentMaterial : CourseMaterial.Asphalt));
                }
            }
            TopGrid.push(RowTop);
            BottomGrid.push(RowBottom);
            TopNormals.push(RowNormals);
            if (StepU < SubSlices)
                TopFamilies.push(RowFamilies);
        }

        const ShapeKey = `${Surface.Key}_Wave_${Seg}`;
        const CanonicalFacets = ConstructClosedGridSlabFacets(TopGrid, BottomGrid, TopNormals, TopFamilies,
                                                              CourseMaterial.SteelDark, CourseMaterial.TunnelConcrete);
        Shapes[ShapeKey] = {
            Emit:  () => TransformFacetsToLocalFrame(CanonicalFacets, CanonicalAnchor, CanonicalQuat),
            Voxel: 0.34,
            Cards: 8
        };

        const WorldQuat = ConstructBasisQuaternion(
            ProjectDirectionFromSurface(Surface, LocalBasis.AxisX),
            ProjectDirectionFromSurface(Surface, LocalBasis.AxisY),
            ProjectDirectionFromSurface(Surface, LocalBasis.AxisZ)
        );
        for (let Wave = 0; Wave < Surface.WaveCount; ++Wave)
        {
            const AnchorLocal = [BaseXMid + Wave * PeriodLength, 0.0, MidProfile.Height];
            Placements.push({
                Shape:       ShapeKey,
                Name:        `${Surface.Key} wave ${Wave} seg ${Seg}`,
                Position:    ProjectPointFromSurface(Surface, AnchorLocal),
                Orientation: WorldQuat,
                Yaw:         0.0,
                Material:    -1,
                Collider:    false
            });
        }
    }
}

function AppendTabletopRampSegments(Surface, Shapes, Placements)
{
    const SymmetricEnds = Math.abs(Surface.UpLength - Surface.DownLength) < 1.0e-4;
    const StopsX = SymmetricEnds
        ? [
            0.0, 0.5 * Surface.UpLength, Surface.UpLength,
            Surface.UpLength + 0.5 * Surface.DeckLength, Surface.UpLength + Surface.DeckLength,
            Surface.UpLength + Surface.DeckLength + 0.5 * Surface.DownLength, Surface.TotalLength
          ]
        : [
            0.0, 0.5 * Surface.UpLength, Surface.UpLength,
            Surface.UpLength + Surface.DeckLength,
            Surface.UpLength + Surface.DeckLength + Surface.DownLength / 3.0,
            Surface.UpLength + Surface.DeckLength + (2.0 * Surface.DownLength) / 3.0,
            Surface.TotalLength
          ];
    const SubSlices = 4;
    const LateralStops = [-Surface.HalfWidth, -(Surface.HalfWidth - Surface.KerbWidth), -0.65, 0.65,
                          Surface.HalfWidth - Surface.KerbWidth, Surface.HalfWidth];

    for (let Seg = 0; Seg < StopsX.length - 1; ++Seg)
    {
        const IsMirror = SymmetricEnds && Seg >= 4;
        const CanonicalSeg = IsMirror ? (5 - Seg) : (SymmetricEnds && Seg === 3 ? 2 : Seg);
        const Sign = IsMirror ? -1.0 : 1.0;
        const X0 = StopsX[Seg], X1 = StopsX[Seg + 1], XMid = 0.5 * (X0 + X1);
        const MidProfile = EvaluateTabletopProfile(Surface, XMid, 0.0);
        const LocalBasis = BuildOrthonormalTangentBasis([Sign, 0.0, Sign * MidProfile.SlopeX], [0.0, Sign, 0.0]);
        const FrameOrigin = ProjectPointFromSurface(Surface, [XMid, 0.0, MidProfile.Height]);
        const FrameQuaternion = ConstructBasisQuaternion(
            ProjectDirectionFromSurface(Surface, LocalBasis.AxisX),
            ProjectDirectionFromSurface(Surface, LocalBasis.AxisY),
            ProjectDirectionFromSurface(Surface, LocalBasis.AxisZ)
        );

        const TopGrid = [], BottomGrid = [], TopNormals = [], TopFamilies = [];
        for (let StepU = 0; StepU <= SubSlices; ++StepU)
        {
            const X = X0 + (X1 - X0) * (StepU / SubSlices);
            const RowTop = [], RowBottom = [], RowNormals = [], RowFamilies = [];
            for (let StepV = 0; StepV < LateralStops.length; ++StepV)
            {
                const Y = LateralStops[StepV];
                const Profile = EvaluateTabletopProfile(Surface, X, Y);
                const NormalWorld = ProjectDirectionFromSurface(Surface, NormalizeVector([-Profile.SlopeX, -Profile.SlopeY, 1.0]));
                const TopWorld = ProjectPointFromSurface(Surface, [X, Y, Profile.Height]);
                const BotWorld = MultiplyAddVector(TopWorld, NormalWorld, -Surface.Thickness);
                RowTop.push(TopWorld);
                RowBottom.push(BotWorld);
                RowNormals.push(NormalWorld);
                if (StepV < LateralStops.length - 1)
                {
                    const Edge = StepV === 0 || StepV === LateralStops.length - 2;
                    const Centre = StepV === 2;
                    const SkyGlow = CanonicalSeg === 2 ? CourseMaterial.GateLamp : Surface.AccentMaterial;
                    RowFamilies.push(Edge ? ((CanonicalSeg & 1) ? CourseMaterial.PaintWhite : CourseMaterial.KerbRed)
                                          : (Centre ? SkyGlow : CourseMaterial.ApronConcrete));
                }
            }
            TopGrid.push(RowTop);
            BottomGrid.push(RowBottom);
            TopNormals.push(RowNormals);
            if (StepU < SubSlices)
                TopFamilies.push(RowFamilies);
        }

        const ShapeKey = `${Surface.ShapePrefix}_Sec_${CanonicalSeg}`;
        if (!IsMirror && !(SymmetricEnds && Seg === 3) && !Shapes[ShapeKey])
        {
            const WorldFacets = ConstructClosedGridSlabFacets(TopGrid, BottomGrid, TopNormals, TopFamilies,
                                                              CourseMaterial.SteelDark, CourseMaterial.TunnelConcrete);
            Shapes[ShapeKey] = {
                Emit:  () => TransformFacetsToLocalFrame(WorldFacets, FrameOrigin, FrameQuaternion),
                Voxel: 0.38,
                Cards: 8
            };
        }
        Placements.push({
            Shape:       ShapeKey,
            Name:        `${Surface.Key} section ${Seg}`,
            Position:    FrameOrigin,
            Orientation: FrameQuaternion,
            Yaw:         0.0,
            Material:    -1,
            Collider:    false
        });
    }
}

function AppendBankedTurnSegments(Surface, Shapes, Placements)
{
    const SectorCount = 10;
    const SubU = 4;
    const RadialStops = [
        Surface.Width, Surface.Width - 0.85, Surface.Width - Surface.CopingWidth,
        0.50 * Surface.Width + 0.55, 0.50 * Surface.Width - 0.55, 0.35 * Surface.Width, 0.9, 0.0
    ];
    const MidRadius = Surface.InnerRadius + 0.5 * Surface.Width;

    for (let Sector = 0; Sector < SectorCount; ++Sector)
    {
        const Phi0 = (Surface.SweepAngle * Sector) / SectorCount;
        const Phi1 = (Surface.SweepAngle * (Sector + 1)) / SectorCount;
        const PhiMid = 0.5 * (Phi0 + Phi1);
        const HalfSpan = 0.5 * (Phi1 - Phi0);
        const IsApex = Phi0 >= Surface.RampAngle - 1.0e-5 && Phi1 <= Surface.SweepAngle - Surface.RampAngle + 1.0e-5;
        const Kind = IsApex ? "Apex" : `Transition_${Sector}`;
        const ShapeKey = `${Surface.ShapePrefix}_${Kind}`;

        const MidProfile = EvaluateBankedTurnProfile(Surface, 0.5 * Surface.Width, PhiMid);
        // 📝 Canonical sector frame at θ = 0: X points radially outward, Y points CCW along track, Z points bowl-normal
        const CanonicalBasis = BuildOrthonormalTangentBasis([1.0, 0.0, MidProfile.SlopeS], [0.0, 1.0, MidProfile.SlopePhi / MidRadius]);
        const CanonicalAnchor = [MidRadius, 0.0, MidProfile.Height];
        const CanonicalQuat = ConstructBasisQuaternion(CanonicalBasis.AxisX, CanonicalBasis.AxisY, CanonicalBasis.AxisZ);

        if (!Shapes[ShapeKey])
        {
            const TopGrid = [], BottomGrid = [], TopNormals = [], TopFamilies = [];
            for (let StepU = 0; StepU <= SubU; ++StepU)
            {
                const RelTheta = -HalfSpan + (2.0 * HalfSpan * StepU) / SubU;
                const EvalPhi = IsApex ? 0.5 * Surface.SweepAngle : (PhiMid + RelTheta);
                const CosT = Math.cos(RelTheta), SinT = Math.sin(RelTheta);
                const RowTop = [], RowBottom = [], RowNormals = [], RowFamilies = [];
                for (let StepV = 0; StepV < RadialStops.length; ++StepV)
                {
                    const S = RadialStops[StepV];
                    const R = Surface.InnerRadius + S;
                    const Profile = EvaluateBankedTurnProfile(Surface, S, EvalPhi);
                    const NormalCanon = NormalizeVector(CrossVector([CosT, SinT, Profile.SlopeS], [-R * SinT, R * CosT, Profile.SlopePhi]));
                    const TopPt = [R * CosT, R * SinT, Profile.Height];
                    const BotPt = MultiplyAddVector(TopPt, NormalCanon, -Surface.Thickness);
                    RowTop.push(TopPt);
                    RowBottom.push(BotPt);
                    RowNormals.push(NormalCanon);
                    if (StepV < RadialStops.length - 1)
                    {
                        const OuterCoping = StepV <= 1;
                        const InnerKerb = StepV === RadialStops.length - 2;
                        const RacingLine = StepV === 3;
                        const AltStripe = ((Sector + StepU) & 1) ? CourseMaterial.PaintWhite : CourseMaterial.KerbRed;
                        RowFamilies.push((InnerKerb || OuterCoping) ? AltStripe
                                       : (RacingLine ? Surface.AccentMaterial : CourseMaterial.Asphalt));
                    }
                }
                TopGrid.push(RowTop);
                BottomGrid.push(RowBottom);
                TopNormals.push(RowNormals);
                if (StepU < SubU)
                    TopFamilies.push(RowFamilies);
            }
            const CanonicalFacets = ConstructClosedGridSlabFacets(TopGrid, BottomGrid, TopNormals, TopFamilies,
                                                                  CourseMaterial.SteelDark, CourseMaterial.BarrierConcrete);
            Shapes[ShapeKey] = {
                Emit:  () => TransformFacetsToLocalFrame(CanonicalFacets, CanonicalAnchor, CanonicalQuat),
                Voxel: 0.56,
                Cards: 8
            };
        }

        const WorldAngle = Surface.StartAngle + PhiMid;
        const CosW = Math.cos(WorldAngle), SinW = Math.sin(WorldAngle);
        const RotateZ = (V) => [CosW * V[0] - SinW * V[1], SinW * V[0] + CosW * V[1], V[2]];
        const WorldAnchor = AddVector(Surface.Origin, RotateZ(CanonicalAnchor));
        const WorldQuat = ConstructBasisQuaternion(
            RotateZ(CanonicalBasis.AxisX),
            RotateZ(CanonicalBasis.AxisY),
            RotateZ(CanonicalBasis.AxisZ)
        );
        Placements.push({
            Shape:       ShapeKey,
            Name:        `${Surface.Key} bowl sector ${Sector}`,
            Position:    WorldAnchor,
            Orientation: WorldQuat,
            Yaw:         0.0,
            Material:    -1,
            Collider:    false
        });
    }
}

function AppendHeartlineRibbonSegments(Surface, Shapes, Placements)
{
    const HalfSegments = 6;
    const SubSlices = 4;
    const LateralStops = [-Surface.HalfWidth, -(Surface.HalfWidth - Surface.KerbWidth), -0.65, 0.65,
                          Surface.HalfWidth - Surface.KerbWidth, Surface.HalfWidth];

    for (let Seg = 0; Seg < HalfSegments; ++Seg)
    {
        const X0 = -Surface.HalfLength + (Surface.HalfLength * Seg) / HalfSegments;
        const X1 = -Surface.HalfLength + (Surface.HalfLength * (Seg + 1)) / HalfSegments;
        const XMid = 0.5 * (X0 + X1);
        const Mid = EvaluateHeartlineProfile(Surface, XMid);
        const LocalBasis = BuildOrthonormalTangentBasis(
            [1.0, 0.0, Mid.SlopeZ],
            [0.0, Math.cos(Mid.α), Math.sin(Mid.α)]
        );
        const CanonicalAnchor = [XMid, 0.0, Mid.CenterZ];
        const CanonicalQuat = ConstructBasisQuaternion(LocalBasis.AxisX, LocalBasis.AxisY, LocalBasis.AxisZ);

        const TopGrid = [], BottomGrid = [], TopNormals = [], TopFamilies = [];
        for (let StepU = 0; StepU <= SubSlices; ++StepU)
        {
            const X = X0 + (X1 - X0) * (StepU / SubSlices);
            const P = EvaluateHeartlineProfile(Surface, X);
            const CosA = Math.cos(P.α), SinA = Math.sin(P.α);
            const RowTop = [], RowBottom = [], RowNormals = [], RowFamilies = [];
            for (let StepV = 0; StepV < LateralStops.length; ++StepV)
            {
                const S = LateralStops[StepV];
                const Kerb = EvaluateLateralKerbLift(S, Surface.HalfWidth, Surface.KerbWidth, Surface.KerbHeight, 1.0);
                const NormalLocal = NormalizeVector([
                    -P.SlopeZ * CosA - S * P.DerivativeAlpha,
                    -SinA - Kerb.Slope * CosA,
                    CosA - Kerb.Slope * SinA
                ]);
                const TopPt = [X, S * CosA - Kerb.Lift * SinA, P.CenterZ + S * SinA + Kerb.Lift * CosA];
                const BotPt = MultiplyAddVector(TopPt, NormalLocal, -Surface.Thickness);
                RowTop.push(TopPt);
                RowBottom.push(BotPt);
                RowNormals.push(NormalLocal);
                if (StepV < LateralStops.length - 1)
                {
                    const Edge = StepV === 0 || StepV === LateralStops.length - 2;
                    const Centre = StepV === 2;
                    const Glow = Seg === HalfSegments - 1 ? CourseMaterial.GateLamp : Surface.AccentMaterial;
                    RowFamilies.push(Edge ? ((Seg & 1) ? CourseMaterial.PaintWhite : CourseMaterial.KerbRed)
                                          : (Centre ? Glow : CourseMaterial.Asphalt));
                }
            }
            TopGrid.push(RowTop);
            BottomGrid.push(RowBottom);
            TopNormals.push(RowNormals);
            if (StepU < SubSlices)
                TopFamilies.push(RowFamilies);
        }

        const ShapeKey = `${Surface.ShapePrefix}_Heart_${Seg}`;
        if (!Shapes[ShapeKey])
        {
            const CanonicalFacets = ConstructClosedGridSlabFacets(TopGrid, BottomGrid, TopNormals, TopFamilies,
                                                                  CourseMaterial.SteelDark, CourseMaterial.BarrierConcrete);
            Shapes[ShapeKey] = {
                Emit:  () => TransformFacetsToLocalFrame(CanonicalFacets, CanonicalAnchor, CanonicalQuat),
                Voxel: 0.34,
                Cards: 8
            };
        }

        // ① First half x ∈ [−L/2, 0] (+PeakAngle) and ② 180°-rotated second half x ∈ [0, +L/2] (−PeakAngle)
        for (const Sign of [1.0, -1.0])
        {
            const HalfAnchor = [Sign * CanonicalAnchor[0], Sign * CanonicalAnchor[1], CanonicalAnchor[2]];
            const RotAxisX = [Sign * LocalBasis.AxisX[0], Sign * LocalBasis.AxisX[1], LocalBasis.AxisX[2]];
            const RotAxisY = [Sign * LocalBasis.AxisY[0], Sign * LocalBasis.AxisY[1], LocalBasis.AxisY[2]];
            const RotAxisZ = [Sign * LocalBasis.AxisZ[0], Sign * LocalBasis.AxisZ[1], LocalBasis.AxisZ[2]];
            const WorldQuat = ConstructBasisQuaternion(
                ProjectDirectionFromSurface(Surface, RotAxisX),
                ProjectDirectionFromSurface(Surface, RotAxisY),
                ProjectDirectionFromSurface(Surface, RotAxisZ)
            );
            Placements.push({
                Shape:       ShapeKey,
                Name:        `${Surface.Key} ${Sign > 0.0 ? "entry" : "exit"} ${Seg}`,
                Position:    ProjectPointFromSurface(Surface, HalfAnchor),
                Orientation: WorldQuat,
                Yaw:         0.0,
                Material:    -1,
                Collider:    false
            });
        }
    }
}

function AppendSubmergedTrenchSegments(Surface, Shapes, Placements)
{
    const GalleryRepeat = Math.max(1, Math.round(Surface.TunnelLength / (Surface.GalleryTileLength || Surface.TunnelLength)));
    const GalleryFloorTiles = GalleryRepeat * 2;
    const StopsX = [0.0, 0.5 * Surface.DownLength, Surface.DownLength];
    for (let Tile = 1; Tile <= GalleryFloorTiles; ++Tile)
        StopsX.push(Surface.DownLength + (Surface.TunnelLength * Tile) / GalleryFloorTiles);
    const HasExit = !Surface.DeadEnd && Surface.UpLength > 1.0e-4;
    if (HasExit)
        StopsX.push(Surface.DownLength + Surface.TunnelLength + 0.5 * Surface.UpLength, Surface.TotalLength);

    const SubSlices = 4;
    const LateralStops = [-Surface.HalfWidth, -(Surface.HalfWidth - Surface.KerbWidth), -0.65, 0.65,
                          Surface.HalfWidth - Surface.KerbWidth, Surface.HalfWidth];

    // ① Sub-grade C² dive ramp -> subterranean floor -> daylight ascent ramp (180° Z-symmetry when UpLength === DownLength)
    const SymmetricEnds = HasExit && Math.abs(Surface.DownLength - Surface.UpLength) < 1.0e-4;
    const ExitStartSeg = 2 + GalleryFloorTiles;
    for (let Seg = 0; Seg < StopsX.length - 1; ++Seg)
    {
        const IsMirror = SymmetricEnds && Seg >= ExitStartSeg;
        const IsGalleryFloor = Seg >= 2 && Seg < ExitStartSeg;
        const CanonicalSeg = IsMirror ? (StopsX.length - 2 - Seg) : (IsGalleryFloor ? 2 : Seg);
        const X0 = StopsX[Seg], X1 = StopsX[Seg + 1], XMid = 0.5 * (X0 + X1);
        const MidFloor = EvaluateSubmergedTrenchFloor(Surface, XMid);
        const Sign = IsMirror ? -1.0 : 1.0;
        const LocalBasis = BuildOrthonormalTangentBasis([Sign, 0.0, Sign * MidFloor.SlopeX], [0.0, Sign, 0.0]);
        const FrameOrigin = ProjectPointFromSurface(Surface, [XMid, 0.0, MidFloor.Height]);
        const FrameQuaternion = ConstructBasisQuaternion(
            ProjectDirectionFromSurface(Surface, LocalBasis.AxisX),
            ProjectDirectionFromSurface(Surface, LocalBasis.AxisY),
            ProjectDirectionFromSurface(Surface, LocalBasis.AxisZ)
        );
        const ShapeKey = `${Surface.ShapePrefix}_Floor_${CanonicalSeg}`;
        if (!IsMirror && (!IsGalleryFloor || Seg === 2) && !Shapes[ShapeKey])
        {
            const TopGrid = [], BottomGrid = [], TopNormals = [], TopFamilies = [];
            for (let StepU = 0; StepU <= SubSlices; ++StepU)
            {
                const X = X0 + (X1 - X0) * (StepU / SubSlices);
                const Floor = EvaluateSubmergedTrenchFloor(Surface, X);
                const NormalWorld = ProjectDirectionFromSurface(Surface, NormalizeVector([-Floor.SlopeX, 0.0, 1.0]));
                const RowTop = [], RowBottom = [], RowNormals = [], RowFamilies = [];
                for (let StepV = 0; StepV < LateralStops.length; ++StepV)
                {
                    const Y = LateralStops[StepV];
                    const TopWorld = ProjectPointFromSurface(Surface, [X, Y, Floor.Height]);
                    const BotWorld = MultiplyAddVector(TopWorld, NormalWorld, -Surface.Thickness);
                    RowTop.push(TopWorld);
                    RowBottom.push(BotWorld);
                    RowNormals.push(NormalWorld);
                    if (StepV < LateralStops.length - 1)
                    {
                        const Edge = StepV === 0 || StepV === LateralStops.length - 2;
                        const Centre = StepV === 2;
                        const InGallery = CanonicalSeg === 2;
                        RowFamilies.push(Edge ? ((CanonicalSeg & 1) ? CourseMaterial.PaintYellow : CourseMaterial.KerbRed)
                                              : (Centre ? (InGallery ? CourseMaterial.GateLamp : Surface.AccentMaterial)
                                                        : CourseMaterial.Asphalt));
                    }
                }
                TopGrid.push(RowTop);
                BottomGrid.push(RowBottom);
                TopNormals.push(RowNormals);
                if (StepU < SubSlices)
                    TopFamilies.push(RowFamilies);
            }
            const WorldFacets = ConstructClosedGridSlabFacets(TopGrid, BottomGrid, TopNormals, TopFamilies,
                                                              CourseMaterial.SteelDark, CourseMaterial.TunnelConcrete);
            Shapes[ShapeKey] = {
                Emit:  () => TransformFacetsToLocalFrame(WorldFacets, FrameOrigin, FrameQuaternion),
                Voxel: 0.36,
                Cards: 8
            };
        }
        Placements.push({
            Shape:       ShapeKey,
            Name:        `${Surface.Key} floor ${Seg}`,
            Position:    FrameOrigin,
            Orientation: FrameQuaternion,
            Yaw:         0.0,
            Material:    -1,
            Collider:    false
        });
    }

    // ② Left & right concrete subterranean retaining walls (180° Z-symmetry reuses Wall_0 for exit wall; GalleryRepeat tiles middle wall)
    const WallSpans = [[1.2, Surface.DownLength, 0, false]];
    for (let Tile = 0; Tile < GalleryRepeat; ++Tile)
    {
        const GX0 = Surface.DownLength + (Surface.TunnelLength * Tile) / GalleryRepeat;
        const GX1 = Surface.DownLength + (Surface.TunnelLength * (Tile + 1)) / GalleryRepeat;
        WallSpans.push([GX0, GX1, 1, false]);
    }
    if (HasExit)
        WallSpans.push([Surface.DownLength + Surface.TunnelLength, Surface.TotalLength - 1.2, SymmetricEnds ? 0 : 2, SymmetricEnds]);

    for (let SpanIndex = 0; SpanIndex < WallSpans.length; ++SpanIndex)
    {
        const [WX0, WX1, CanonicalSpan, IsMirrorWall] = WallSpans[SpanIndex];
        const WXMid = 0.5 * (WX0 + WX1);
        const FlushMidWall = CanonicalSpan === 1 && Surface.Roofed && Surface.GroundDeckOverRoof;
        const SpanTopZ = FlushMidWall ? Surface.RoofTopZ : Surface.WallTopZ;
        const WallShapeKey = FlushMidWall ? `${Surface.ShapePrefix}_RoofWall_1` : `${Surface.ShapePrefix}_Wall_${CanonicalSpan}`;
        const Sign = IsMirrorWall ? -1.0 : 1.0;
        for (const Side of [-1.0, 1.0])
        {
            const InnerY = Side < 0.0 ? -(Surface.HalfWidth + Surface.WallThickness) : Surface.HalfWidth;
            const OuterY = Side < 0.0 ? -Surface.HalfWidth : (Surface.HalfWidth + Surface.WallThickness);
            const CentreY = 0.5 * (InnerY + OuterY);
            const MidFloor = EvaluateSubmergedTrenchFloor(Surface, WXMid).Height;
            const FrameOrigin = ProjectPointFromSurface(Surface, [WXMid, CentreY, 0.5 * (SpanTopZ + MidFloor)]);
            // 📝 Orient local Z across the thin 0.70 m wall width (and local Y vertically) so 3D SDF uses ~8 Z-slices!
            const FrameQuaternion = ConstructBasisQuaternion(
                ProjectDirectionFromSurface(Surface, [Sign, 0.0, 0.0]),
                ProjectDirectionFromSurface(Surface, [0.0, 0.0, 1.0]),
                ProjectDirectionFromSurface(Surface, [0.0, -Sign, 0.0])
            );
            if (!IsMirrorWall && !Shapes[WallShapeKey])
            {
                const TopGrid = [], BottomGrid = [], TopNormals = [], TopFamilies = [];
                const WallStopsY = [InnerY, OuterY];
                for (let StepU = 0; StepU <= SubSlices; ++StepU)
                {
                    const X = WX0 + (WX1 - WX0) * (StepU / SubSlices);
                    const BotZ = EvaluateSubmergedTrenchFloor(Surface, X).Height - 0.35;
                    const RowTop = [], RowBottom = [], RowNormals = [];
                    for (const Y of WallStopsY)
                    {
                        RowTop.push(ProjectPointFromSurface(Surface, [X, Y, SpanTopZ]));
                        RowBottom.push(ProjectPointFromSurface(Surface, [X, Y, BotZ]));
                        RowNormals.push([0.0, 0.0, 1.0]);
                    }
                    TopGrid.push(RowTop);
                    BottomGrid.push(RowBottom);
                    TopNormals.push(RowNormals);
                    if (StepU < SubSlices)
                        TopFamilies.push([CanonicalSpan === 1 ? CourseMaterial.WallCobalt : CourseMaterial.BarrierConcrete]);
                }
                const WorldFacets = ConstructClosedGridSlabFacets(TopGrid, BottomGrid, TopNormals, TopFamilies,
                                                                  CourseMaterial.TunnelConcrete, CourseMaterial.TunnelConcrete);
                Shapes[WallShapeKey] = {
                    Emit:  () => TransformFacetsToLocalFrame(WorldFacets, FrameOrigin, FrameQuaternion),
                    Voxel: 0.24,
                    Cards: 8
                };
            }
            Placements.push({
                Shape:       WallShapeKey,
                Name:        `${Surface.Key} wall ${Side > 0 ? "L" : "R"}${SpanIndex}`,
                Position:    FrameOrigin,
                Orientation: FrameQuaternion,
                Yaw:         0.0,
                Material:    -1,
                Collider:    false
            });
        }
    }

    // ③ Subterranean tunnel roof ceiling deck + glowing portal headers (tiled across GalleryRepeat)
    if (Surface.Roofed)
    {
        const SpanY = Surface.HalfWidth + Surface.WallThickness;
        const RoofKey = `${Surface.ShapePrefix}_Roof`;
        const RoofQuat = ConstructBasisQuaternion(
            ProjectDirectionFromSurface(Surface, [1.0, 0.0, 0.0]),
            ProjectDirectionFromSurface(Surface, [0.0, 1.0, 0.0]),
            ProjectDirectionFromSurface(Surface, [0.0, 0.0, 1.0])
        );
        for (let Tile = 0; Tile < GalleryRepeat; ++Tile)
        {
            const RX0 = Surface.DownLength + (Surface.TunnelLength * Tile) / GalleryRepeat;
            const RX1 = Surface.DownLength + (Surface.TunnelLength * (Tile + 1)) / GalleryRepeat;
            const RXMid = 0.5 * (RX0 + RX1);
            const RoofOrigin = ProjectPointFromSurface(Surface, [RXMid, 0.0, 0.5 * (Surface.RoofTopZ + Surface.RoofBottomZ)]);
            if (!Shapes[RoofKey])
            {
                const RoofStopsY = [-SpanY, -SpanY + 0.8, -1.2, 1.2, SpanY - 0.8, SpanY];
                const TopGrid = [], BottomGrid = [], TopNormals = [], TopFamilies = [];
                for (let StepU = 0; StepU <= 2; ++StepU)
                {
                    const X = RX0 + (RX1 - RX0) * (StepU / 2);
                    const RowTop = [], RowBottom = [], RowNormals = [], RowFamilies = [];
                    for (let StepV = 0; StepV < RoofStopsY.length; ++StepV)
                    {
                        const Y = RoofStopsY[StepV];
                        RowTop.push(ProjectPointFromSurface(Surface, [X, Y, Surface.RoofTopZ]));
                        RowBottom.push(ProjectPointFromSurface(Surface, [X, Y, Surface.RoofBottomZ]));
                        RowNormals.push([0.0, 0.0, 1.0]);
                        if (StepV < RoofStopsY.length - 1)
                        {
                            const Edge = StepV === 0 || StepV === RoofStopsY.length - 2;
                            const Centre = StepV === 2;
                            RowFamilies.push(Edge ? CourseMaterial.PaintWhite
                                                  : (Centre ? CourseMaterial.PaintYellow : CourseMaterial.Asphalt));
                        }
                    }
                    TopGrid.push(RowTop);
                    BottomGrid.push(RowBottom);
                    TopNormals.push(RowNormals);
                    if (StepU < 2)
                        TopFamilies.push(RowFamilies);
                }
                const WorldFacets = ConstructClosedGridSlabFacets(TopGrid, BottomGrid, TopNormals, TopFamilies,
                                                                  CourseMaterial.WallCobalt, CourseMaterial.TunnelConcrete);
                Shapes[RoofKey] = {
                    Emit:  () => TransformFacetsToLocalFrame(WorldFacets, RoofOrigin, RoofQuat),
                    Voxel: 0.24,
                    Cards: 8
                };
            }
            Placements.push({
                Shape:       RoofKey,
                Name:        `${Surface.Key} subway roof ${Tile}`,
                Position:    RoofOrigin,
                Orientation: RoofQuat,
                Yaw:         0.0,
                Material:    -1,
                Collider:    false
            });
        }
    }

    // ④ Subterranean Dead-End Bulkhead Wall (when DeadEnd: true — seals the far end of an underground construction pit!)
    if (Surface.DeadEnd)
    {
        const SpanY = Surface.HalfWidth + Surface.WallThickness;
        const BulkheadKey = `${Surface.ShapePrefix}_DeadEndWall`;
        const BX0 = Surface.TotalLength;
        const BX1 = Surface.TotalLength + Surface.WallThickness;
        const BotZ = -Surface.Depth - 0.35;
        const TopZ = Surface.WallTopZ;
        const BulkheadOrigin = ProjectPointFromSurface(Surface, [0.5 * (BX0 + BX1), 0.0, 0.5 * (TopZ + BotZ)]);
        // 📝 Orient local Z along the thin 0.65 m bulkhead thickness so 3D SDF uses ~8 Z-slices!
        const BulkheadQuat = ConstructBasisQuaternion(
            ProjectDirectionFromSurface(Surface, [0.0, 1.0, 0.0]),
            ProjectDirectionFromSurface(Surface, [0.0, 0.0, 1.0]),
            ProjectDirectionFromSurface(Surface, [1.0, 0.0, 0.0])
        );
        if (!Shapes[BulkheadKey])
        {
            const BulkStopsY = [-SpanY, -SpanY + 1.2, -2.8, 0.0, 2.8, SpanY - 1.2, SpanY];
            const TopGrid = [], BottomGrid = [], TopNormals = [], TopFamilies = [];
            for (let StepU = 0; StepU <= 2; ++StepU)
            {
                const X = BX0 + (BX1 - BX0) * (StepU / 2);
                const RowTop = [], RowBottom = [], RowNormals = [], RowFamilies = [];
                for (let StepV = 0; StepV < BulkStopsY.length; ++StepV)
                {
                    const Y = BulkStopsY[StepV];
                    RowTop.push(ProjectPointFromSurface(Surface, [X, Y, TopZ]));
                    RowBottom.push(ProjectPointFromSurface(Surface, [X, Y, BotZ]));
                    RowNormals.push([0.0, 0.0, 1.0]);
                    if (StepV < BulkStopsY.length - 1)
                        RowFamilies.push((StepV & 1) ? CourseMaterial.BannerAmber : CourseMaterial.SteelDark);
                }
                TopGrid.push(RowTop);
                BottomGrid.push(RowBottom);
                TopNormals.push(RowNormals);
                if (StepU < 2)
                    TopFamilies.push(RowFamilies);
            }
            const WorldFacets = ConstructClosedGridSlabFacets(TopGrid, BottomGrid, TopNormals, TopFamilies,
                                                              CourseMaterial.BannerAmber, CourseMaterial.TunnelConcrete);
            Shapes[BulkheadKey] = {
                Emit:  () => TransformFacetsToLocalFrame(WorldFacets, BulkheadOrigin, BulkheadQuat),
                Voxel: 0.24,
                Cards: 8
            };
        }
        Placements.push({
            Shape:       BulkheadKey,
            Name:        `${Surface.Key} dead-end bulkhead`,
            Position:    BulkheadOrigin,
            Orientation: BulkheadQuat,
            Yaw:         0.0,
            Material:    -1,
            Collider:    false
        });
    }
}

function AppendSerpentineWaveSegments(Surface, Shapes, Placements)
{
    const SegmentsPerWave = 4;
    const SegmentCount = Surface.WaveCount * SegmentsPerWave;
    const SubSlices = 4;
    const LateralStops = [-Surface.HalfWidth, -(Surface.HalfWidth - Surface.KerbWidth), -0.65, 0.65,
                          Surface.HalfWidth - Surface.KerbWidth, Surface.HalfWidth];

    for (let Seg = 0; Seg < SegmentCount; ++Seg)
    {
        const X0 = -Surface.HalfLength + (Surface.Length * Seg) / SegmentCount;
        const X1 = -Surface.HalfLength + (Surface.Length * (Seg + 1)) / SegmentCount;
        const XMid = 0.5 * (X0 + X1);
        const Mid = EvaluateSerpentineWaveProfile(Surface, XMid, 0.0);
        const IsExitFade = Seg === SegmentCount - 1;
        const IsEndFade = Seg === 0 || IsExitFade;
        const Sign = IsExitFade ? -1.0 : 1.0;
        const LocalBasis = BuildOrthonormalTangentBasis([Sign, 0.0, Sign * Mid.SlopeX], [0.0, Sign, Sign * Mid.SlopeY]);
        const FrameOrigin = ProjectPointFromSurface(Surface, [XMid, 0.0, Mid.Height]);
        const FrameQuaternion = ConstructBasisQuaternion(
            ProjectDirectionFromSurface(Surface, LocalBasis.AxisX),
            ProjectDirectionFromSurface(Surface, LocalBasis.AxisY),
            ProjectDirectionFromSurface(Surface, LocalBasis.AxisZ)
        );
        const CanonicalKind = IsEndFade ? "Fade_0" : `Period_${Seg % SegmentsPerWave}`;
        const ShapeKey = `${Surface.ShapePrefix}_${CanonicalKind}`;
        if (!IsExitFade && !Shapes[ShapeKey])
        {
            const TopGrid = [], BottomGrid = [], TopNormals = [], TopFamilies = [];
            for (let StepU = 0; StepU <= SubSlices; ++StepU)
            {
                const X = X0 + (X1 - X0) * (StepU / SubSlices);
                const RowTop = [], RowBottom = [], RowNormals = [], RowFamilies = [];
                for (let StepV = 0; StepV < LateralStops.length; ++StepV)
                {
                    const Y = LateralStops[StepV];
                    const Profile = EvaluateSerpentineWaveProfile(Surface, X, Y);
                    const NormalWorld = ProjectDirectionFromSurface(Surface, NormalizeVector([-Profile.SlopeX, -Profile.SlopeY, 1.0]));
                    const TopWorld = ProjectPointFromSurface(Surface, [X, Y, Profile.Height]);
                    const BotWorld = MultiplyAddVector(TopWorld, NormalWorld, -Surface.Thickness);
                    RowTop.push(TopWorld);
                    RowBottom.push(BotWorld);
                    RowNormals.push(NormalWorld);
                    if (StepV < LateralStops.length - 1)
                    {
                        const Edge = StepV === 0 || StepV === LateralStops.length - 2;
                        const Centre = StepV === 2;
                        RowFamilies.push(Edge ? ((Seg & 1) ? CourseMaterial.PaintWhite : CourseMaterial.KerbRed)
                                              : (Centre ? Surface.AccentMaterial : CourseMaterial.Asphalt));
                    }
                }
                TopGrid.push(RowTop);
                BottomGrid.push(RowBottom);
                TopNormals.push(RowNormals);
                if (StepU < SubSlices)
                    TopFamilies.push(RowFamilies);
            }
            const WorldFacets = ConstructClosedGridSlabFacets(TopGrid, BottomGrid, TopNormals, TopFamilies,
                                                              CourseMaterial.SteelDark, CourseMaterial.TunnelConcrete);
            Shapes[ShapeKey] = {
                Emit:  () => TransformFacetsToLocalFrame(WorldFacets, FrameOrigin, FrameQuaternion),
                Voxel: 0.56,
                Cards: 8
            };
        }
        Placements.push({
            Shape:       ShapeKey,
            Name:        `${Surface.Key} serpentine ${Seg}`,
            Position:    FrameOrigin,
            Orientation: FrameQuaternion,
            Yaw:         0.0,
            Material:    -1,
            Collider:    false
        });
    }
}

// 📝 Emits solid approach & exit ramps for elevated CollapseDecks while leaving the fracturing middle span to CollapseSequence.
function AppendCollapseDeckSegments(Surface, Shapes, Placements)
{
    if (Surface.UpLength <= 1.0e-4 && Surface.DownLength <= 1.0e-4)
        return;
    const SubSlices = 4;
    const LateralStops = [-Surface.HalfWidth, -(Surface.HalfWidth - Surface.KerbWidth), -0.65, 0.65,
                          Surface.HalfWidth - Surface.KerbWidth, Surface.HalfWidth];
    const SymmetricEnds = Math.abs(Surface.UpLength - Surface.DownLength) < 1.0e-4;
    const RampSpans = [];
    if (Surface.UpLength > 1.0e-4)
    {
        RampSpans.push([0.0, 0.5 * Surface.UpLength, 0, false]);
        RampSpans.push([0.5 * Surface.UpLength, Surface.UpLength, 1, false]);
    }
    if (Surface.DownLength > 1.0e-4)
    {
        const ExitStart = Surface.UpLength + Surface.DeckLength;
        RampSpans.push([ExitStart, ExitStart + 0.5 * Surface.DownLength, SymmetricEnds ? 1 : 2, SymmetricEnds]);
        RampSpans.push([ExitStart + 0.5 * Surface.DownLength, Surface.TotalLength, SymmetricEnds ? 0 : 3, SymmetricEnds]);
    }
    for (let Index = 0; Index < RampSpans.length; ++Index)
    {
        const [X0, X1, CanonicalSeg, IsMirror] = RampSpans[Index];
        const Sign = IsMirror ? -1.0 : 1.0;
        const XMid = 0.5 * (X0 + X1);
        const MidProfile = EvaluateTabletopProfile(Surface, XMid, 0.0);
        const LocalBasis = BuildOrthonormalTangentBasis([Sign, 0.0, Sign * MidProfile.SlopeX], [0.0, Sign, 0.0]);
        const FrameOrigin = ProjectPointFromSurface(Surface, [XMid, 0.0, MidProfile.Height]);
        const FrameQuaternion = ConstructBasisQuaternion(
            ProjectDirectionFromSurface(Surface, LocalBasis.AxisX),
            ProjectDirectionFromSurface(Surface, LocalBasis.AxisY),
            ProjectDirectionFromSurface(Surface, LocalBasis.AxisZ)
        );
        const ShapeKey = `${Surface.ShapePrefix}_Sec_${CanonicalSeg}`;
        if (!IsMirror && !Shapes[ShapeKey])
        {
            const TopGrid = [], BottomGrid = [], TopNormals = [], TopFamilies = [];
            for (let StepU = 0; StepU <= SubSlices; ++StepU)
            {
                const X = X0 + (X1 - X0) * (StepU / SubSlices);
                const RowTop = [], RowBottom = [], RowNormals = [], RowFamilies = [];
                for (let StepV = 0; StepV < LateralStops.length; ++StepV)
                {
                    const Y = LateralStops[StepV];
                    const Profile = EvaluateTabletopProfile(Surface, X, Y);
                    const NormalWorld = ProjectDirectionFromSurface(Surface, NormalizeVector([-Profile.SlopeX, -Profile.SlopeY, 1.0]));
                    const TopWorld = ProjectPointFromSurface(Surface, [X, Y, Profile.Height]);
                    const BotWorld = MultiplyAddVector(TopWorld, NormalWorld, -Surface.Thickness);
                    RowTop.push(TopWorld);
                    RowBottom.push(BotWorld);
                    RowNormals.push(NormalWorld);
                    if (StepV < LateralStops.length - 1)
                    {
                        const Edge = StepV === 0 || StepV === LateralStops.length - 2;
                        const Centre = StepV === 2;
                        RowFamilies.push(Edge ? ((CanonicalSeg & 1) ? CourseMaterial.PaintWhite : CourseMaterial.KerbRed)
                                              : (Centre ? Surface.AccentMaterial : CourseMaterial.ApronConcrete));
                    }
                }
                TopGrid.push(RowTop);
                BottomGrid.push(RowBottom);
                TopNormals.push(RowNormals);
                if (StepU < SubSlices)
                    TopFamilies.push(RowFamilies);
            }
            const WorldFacets = ConstructClosedGridSlabFacets(TopGrid, BottomGrid, TopNormals, TopFamilies,
                                                              CourseMaterial.SteelDark, CourseMaterial.TunnelConcrete);
            Shapes[ShapeKey] = {
                Emit:  () => TransformFacetsToLocalFrame(WorldFacets, FrameOrigin, FrameQuaternion),
                Voxel: 0.38,
                Cards: 8
            };
        }
        Placements.push({
            Shape:       ShapeKey,
            Name:        `${Surface.Key} approach ${Index}`,
            Position:    FrameOrigin,
            Orientation: FrameQuaternion,
            Yaw:         0.0,
            Material:    -1,
            Collider:    false
        });
    }
}
