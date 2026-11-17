//============================================================================================================================================
//                                                        TRAFFICLIGHTSEQUENCE.JS
//============================================================================================================================================
// 🧩 Pole-less Hovering Robotic Intersection Traffic Signals:
//    Vertical 4-aspect (RED / ORANGE / YELLOW / GREEN) robotic traffic signal heads with sun-visor hoods & side antigrav thruster pods
//    that hover steadily in place above intersections (no ground pole, no chasing the player), displaying live signal state & road light!

import { CourseMaterial } from "./MaterialSpecification.js";
import {
    ConstructRigidTransform,
    ConstructAxisQuaternion,
    MultiplyQuaternion,
    RotateVector
} from "./TransformProjection.js";

function EmitBox(Min, Max, Family)
{
    const [X0, Y0, Z0] = Min;
    const [X1, Y1, Z1] = Max;
    const P000 = [X0, Y0, Z0], P100 = [X1, Y0, Z0], P110 = [X1, Y1, Z0], P010 = [X0, Y1, Z0];
    const P001 = [X0, Y0, Z1], P101 = [X1, Y0, Z1], P111 = [X1, Y1, Z1], P011 = [X0, Y1, Z1];
    const Quad = (A, B, C, D) => [
        { Corners: [A, B, C], Family },
        { Corners: [A, C, D], Family }
    ];
    return [
        ...Quad(P001, P101, P111, P011), // +Z
        ...Quad(P010, P110, P100, P000), // -Z
        ...Quad(P100, P110, P111, P101), // +X
        ...Quad(P010, P000, P001, P011), // -X
        ...Quad(P110, P010, P011, P111), // +Y
        ...Quad(P000, P100, P101, P001)  // -Y
    ];
}

function EmitVerticalPrismZ(CX, CY, Z0, Z1, Radius, SideMat, TopMat, BotMat, Sides = 10)
{
    const Facets = [];
    for (let Index = 0; Index < Sides; ++Index)
    {
        const A0 = (2.0 * Math.PI * Index) / Sides;
        const A1 = (2.0 * Math.PI * (Index + 1)) / Sides;
        const X0 = CX + Radius * Math.cos(A0), Y0 = CY + Radius * Math.sin(A0);
        const X1 = CX + Radius * Math.cos(A1), Y1 = CY + Radius * Math.sin(A1);
        Facets.push(
            { Corners: [[X0, Y0, Z0], [X1, Y1, Z0], [X1, Y1, Z1]], Family: SideMat },
            { Corners: [[X0, Y0, Z0], [X1, Y1, Z1], [X0, Y0, Z1]], Family: SideMat },
            { Corners: [[CX, CY, Z1], [X0, Y0, Z1], [X1, Y1, Z1]], Family: TopMat },
            { Corners: [[CX, CY, Z0], [X1, Y1, Z0], [X0, Y0, Z0]], Family: BotMat }
        );
    }
    return Facets;
}

// Horizontal octagonal lens cylinder along X ∈ [X0, X1] (shines out both +X front and -X rear faces!)
function EmitHorizontalLensX(X0, X1, Radius, LensMat, RimMat, Sides = 10)
{
    const Facets = [];
    for (let Index = 0; Index < Sides; ++Index)
    {
        const A0 = (2.0 * Math.PI * Index) / Sides;
        const A1 = (2.0 * Math.PI * (Index + 1)) / Sides;
        const Y0 = Radius * Math.cos(A0), Z0 = Radius * Math.sin(A0);
        const Y1 = Radius * Math.cos(A1), Z1 = Radius * Math.sin(A1);
        Facets.push(
            // Outer barrel
            { Corners: [[X0, Y0, Z0], [X0, Y1, Z1], [X1, Y1, Z1]], Family: RimMat },
            { Corners: [[X0, Y0, Z0], [X1, Y1, Z1], [X1, Y0, Z0]], Family: RimMat },
            // +X Front glowing signal face (outward +X: cross((Y0->Y1) in YZ): Y × Z = +X)
            { Corners: [[X1, 0.0, 0.0], [X1, Y0, Z0], [X1, Y1, Z1]], Family: LensMat },
            // -X Rear glowing signal face (outward -X)
            { Corners: [[X0, 0.0, 0.0], [X0, Y1, Z1], [X0, Y0, Z0]], Family: LensMat }
        );
    }
    return Facets;
}

export const TrafficSlotZ = Object.freeze({
    RED:    0.68,
    ORANGE: 0.23,
    YELLOW: -0.23,
    GREEN:  -0.68
});

export const TrafficAspectOrder = Object.freeze(["GREEN", "YELLOW", "ORANGE", "RED"]);

export function EmitHoverTrafficHousingFacets()
{
    const Facets = [];
    // ① Main vertical 4-lamp titanium signal cabinet (X ∈ [-0.24, +0.24], Y ∈ [-0.36, +0.36], Z ∈ [-1.04, +1.04]) — NO POLE!
    Facets.push(...EmitBox([-0.24, -0.36, -1.04], [0.24, 0.36, 1.04], CourseMaterial.SteelDark));

    // ② High-visibility yellow intersection signal faceplate bezel & sun-visor hoods on BOTH Front (+X) and Rear (-X)
    const Slots = [TrafficSlotZ.RED, TrafficSlotZ.ORANGE, TrafficSlotZ.YELLOW, TrafficSlotZ.GREEN];
    for (const Side of [-1.0, 1.0])
    {
        const BX0 = Side > 0 ? 0.242 : -0.264;
        const BX1 = Side > 0 ? 0.264 : -0.242;
        // Left & right vertical yellow frame rails
        Facets.push(...EmitBox([BX0, -0.35, -1.02], [BX1, -0.26, 1.02], CourseMaterial.PaintYellow));
        Facets.push(...EmitBox([BX0,  0.26, -1.02], [BX1,  0.35, 1.02], CourseMaterial.PaintYellow));
        // Top & bottom horizontal yellow frame caps
        Facets.push(...EmitBox([BX0, -0.255,  0.94], [BX1, 0.255,  1.02], CourseMaterial.PaintYellow));
        Facets.push(...EmitBox([BX0, -0.255, -1.02], [BX1, 0.255, -0.94], CourseMaterial.PaintYellow));

        const HX0 = Side > 0 ? 0.266 : -0.430;
        const HX1 = Side > 0 ? 0.430 : -0.266;
        const DX0 = Side > 0 ? 0.242 : -0.254;
        const DX1 = Side > 0 ? 0.254 : -0.242;

        for (const SZ of Slots)
        {
            // Dark smoked unlit backing lens cavity
            Facets.push(...EmitBox([DX0, -0.145, SZ - 0.14], [DX1, 0.145, SZ + 0.14], CourseMaterial.VehiclePlastic));
            // Projecting traffic-light sun-visor hood above each aspect!
            Facets.push(...EmitBox([HX0, -0.195, SZ + 0.145], [HX1,  0.195, SZ + 0.180], CourseMaterial.SteelDark));
            Facets.push(...EmitBox([HX0, -0.195, SZ - 0.010], [HX1, -0.162, SZ + 0.143], CourseMaterial.SteelDark));
            Facets.push(...EmitBox([HX0,  0.162, SZ - 0.010], [HX1,  0.195, SZ + 0.143], CourseMaterial.SteelDark));
        }
    }

    // ③ Robotic Side Antigravity Thruster Pods (Y = ±0.52 m) + Bottom Stabilizer Fins (Hovers cleanly in midair!)
    for (const SideY of [-1.0, 1.0])
    {
        const ArmY0 = SideY > 0 ? 0.362 : -0.440;
        const ArmY1 = SideY > 0 ? 0.440 : -0.362;
        Facets.push(...EmitBox([-0.11, ArmY0, -0.16], [0.11, ArmY1, 0.16], CourseMaterial.Aluminium));
        Facets.push(...EmitVerticalPrismZ(0.0, SideY * 0.56, -0.36, 0.36, 0.115,
                                          CourseMaterial.WallCobalt, CourseMaterial.SteelDark, CourseMaterial.GateLamp, 10));
    }

    // ④ Top Robotic Intersection Radar / V2X Sensor Crown & Bottom Antigrav Emitter Ring
    Facets.push(...EmitVerticalPrismZ(0.0, 0.0, 1.042, 1.22, 0.16, CourseMaterial.BannerAmber, CourseMaterial.Aluminium, CourseMaterial.SteelDark, 10));
    Facets.push(...EmitVerticalPrismZ(0.0, 0.0, -1.16, -1.042, 0.18, CourseMaterial.SteelDark, CourseMaterial.SteelDark, CourseMaterial.GateLamp, 10));

    return Facets;
}

export function ConstructTrafficLightShapes()
{
    return {
        HoverTrafficHousing: { Emit: EmitHoverTrafficHousingFacets, Voxel: 0.24, Cards: 6 },
        TrafficAspectRed:    { Emit: () => EmitHorizontalLensX(-0.285, 0.285, 0.135, CourseMaterial.TrafficRed,    CourseMaterial.TrafficRed),    Voxel: 0.0, Cards: 0, Distance: false },
        TrafficAspectOrange: { Emit: () => EmitHorizontalLensX(-0.285, 0.285, 0.135, CourseMaterial.TrafficOrange, CourseMaterial.TrafficOrange), Voxel: 0.0, Cards: 0, Distance: false },
        TrafficAspectYellow: { Emit: () => EmitHorizontalLensX(-0.285, 0.285, 0.135, CourseMaterial.TrafficYellow, CourseMaterial.TrafficYellow), Voxel: 0.0, Cards: 0, Distance: false },
        TrafficAspectGreen:  { Emit: () => EmitHorizontalLensX(-0.285, 0.285, 0.135, CourseMaterial.TrafficGreen,  CourseMaterial.TrafficGreen),  Voxel: 0.0, Cards: 0, Distance: false }
    };
}

//------------------------------------------------------------------------------------------------------------------------
//                                  HOVERING INTERSECTION TRAFFIC SIGNAL CONTROLLER
//------------------------------------------------------------------------------------------------------------------------

const ParkedPosition = Object.freeze([0.0, 0.0, -140.0]);
const QuarterTurnZ   = ConstructAxisQuaternion([0.0, 0.0, 1.0], 0.5 * Math.PI);

const AspectLightColours = Object.freeze({
    RED:    [1.00, 0.12, 0.06],
    ORANGE: [1.00, 0.36, 0.05],
    YELLOW: [1.00, 0.82, 0.10],
    GREEN:  [0.10, 1.00, 0.28]
});

export class TrafficLightSequence
{
    constructor(Scene, BaseSignals = [], DynamicReserveCount = 4)
    {
        this.Scene        = Scene;
        this.Enabled      = true;
        this.CycleSpeed   = 1.0;
        this.OverrideMode = "AUTO";   // "AUTO" | "GREEN" | "YELLOW" | "ORANGE" | "RED"
        this.Durations    = { GREEN: 6.5, YELLOW: 2.2, ORANGE: 1.8, RED: 6.0 };
        this.Clock        = 0.0;
        this.Units        = [];
        this.DynamicSlots = [];
        this.BuildUnits(BaseSignals, DynamicReserveCount);
    }

    BuildUnits(BaseSignals, DynamicReserveCount)
    {
        const Block = this.Scene?.TrafficBlock;
        if (!Block)
            return;

        let HousingCursor = Block.HousingFirst;
        let LensCursor    = Block.LensFirst;
        const TotalCount  = BaseSignals.length + DynamicReserveCount;

        for (let Index = 0; Index < TotalCount; ++Index)
        {
            const Spec = Index < BaseSignals.length ? BaseSignals[Index] : null;
            const Unit = {
                Id:              Spec ? Spec.Id : `editor_signal_${Index - BaseSignals.length}`,
                Name:            Spec ? Spec.Name : `Junction Signal #${Index - BaseSignals.length + 1}`,
                DynamicSlot:     !Spec,
                Active:          !!Spec,
                Anchor:          Spec ? Spec.Anchor.slice() : ParkedPosition.slice(),
                Yaw:             Spec ? (Spec.Yaw || 0.0) : 0.0,
                PhaseOffset:     Spec ? (Spec.PhaseOffset ?? (Index * 3.7)) : (Index * 2.9),
                HousingOccupant: HousingCursor++,
                LensOccupants: {
                    RED:    LensCursor++,
                    ORANGE: LensCursor++,
                    YELLOW: LensCursor++,
                    GREEN:  LensCursor++
                },
                CurrentAspect:    "GREEN",
                RemainingSeconds: 6.5,
                WorldPosition:    Spec ? Spec.Anchor.slice() : ParkedPosition.slice()
            };
            this.Units.push(Unit);
            if (!Spec)
                this.DynamicSlots.push(Unit);
        }
        this.UpdateAllPoses(true);
    }

    // Allows the Spline Road Editor to station hovering robotic traffic lights above user-created road junctions!
    SyncEditorJunctionSignals(Signals = [])
    {
        for (let SlotIdx = 0; SlotIdx < this.DynamicSlots.length; ++SlotIdx)
        {
            const Unit = this.DynamicSlots[SlotIdx];
            const Spec = Signals[SlotIdx] || null;
            if (Spec)
            {
                Unit.Active = true;
                Unit.Name   = Spec.Name || `Road Junction #${SlotIdx + 1}`;
                Unit.Anchor = [Spec.Position[0], Spec.Position[1], (Spec.Position[2] || 0.0) + 4.45];
                Unit.Yaw    = Spec.Yaw || 0.0;
            }
            else
            {
                Unit.Active        = false;
                Unit.Anchor        = ParkedPosition.slice();
                Unit.WorldPosition = ParkedPosition.slice();
            }
            if (this.Scene?.Occupants)
            {
                if (this.Scene.Occupants[Unit.HousingOccupant])
                    this.Scene.Occupants[Unit.HousingOccupant].Inactive = !Unit.Active;
                for (const Key of TrafficAspectOrder)
                    if (this.Scene.Occupants[Unit.LensOccupants[Key]])
                        this.Scene.Occupants[Unit.LensOccupants[Key]].Inactive = !Unit.Active;
            }
        }
        this.UpdateAllPoses(false);
    }

    ResolveAspectAtTime(LocalTime)
    {
        const Mode = String(this.OverrideMode || "AUTO").toUpperCase();
        if (Mode !== "AUTO" && TrafficSlotZ[Mode] !== undefined)
            return { Aspect: Mode, Remaining: 99.0 };

        const G = this.Durations.GREEN;
        const Y = this.Durations.YELLOW;
        const O = this.Durations.ORANGE;
        const R = this.Durations.RED;
        const Period = Math.max(0.5, G + Y + O + R);
        const T = ((LocalTime % Period) + Period) % Period;
        if (T < G)
            return { Aspect: "GREEN",  Remaining: G - T };
        if (T < G + Y)
            return { Aspect: "YELLOW", Remaining: G + Y - T };
        if (T < G + Y + O)
            return { Aspect: "ORANGE", Remaining: G + Y + O - T };
        return { Aspect: "RED", Remaining: Period - T };
    }

    Advance(DeltaSeconds)
    {
        if (!this.Enabled || !this.Scene || !this.Scene.TrafficBlock || !(DeltaSeconds > 0.0))
            return false;
        const Step = Math.min(DeltaSeconds, 0.05);
        this.Clock += Step * Math.max(0.0, this.CycleSpeed);
        this.UpdateAllPoses(false);
        return true;
    }

    UpdateAllPoses(InitialSnap = false)
    {
        for (let Index = 0; Index < this.Units.length; ++Index)
        {
            const Unit = this.Units[Index];
            const WriteOcc = (OccIdx, Pos, Quat) =>
            {
                const Occ = this.Scene.Occupants[OccIdx];
                if (!Occ)
                    return;
                if (!InitialSnap)
                    Occ.PreviousTransform.set(Occ.Transform);
                Occ.Transform = ConstructRigidTransform(Pos, Quat);
                if (InitialSnap)
                    Occ.PreviousTransform = Occ.Transform.slice();
                Occ.Moving = !InitialSnap && Unit.Active;
            };

            if (!Unit.Active)
            {
                const IdQ = [0.0, 0.0, 0.0, 1.0];
                WriteOcc(Unit.HousingOccupant, ParkedPosition, IdQ);
                for (const Key of TrafficAspectOrder)
                    WriteOcc(Unit.LensOccupants[Key], ParkedPosition, QuarterTurnZ);
                continue;
            }

            // Gentle stationary antigrav hover in place over the intersection (NEVER chases the vehicle!)
            const Phase = this.Clock * 1.85 + Index * 1.3;
            const HoverZ = Unit.Anchor[2] + 0.085 * Math.sin(Phase);
            const MicroRoll  = 0.022 * Math.sin(Phase * 0.8);
            const MicroPitch = 0.018 * Math.cos(Phase * 0.65);

            const QYaw   = ConstructAxisQuaternion([0.0, 0.0, 1.0], Unit.Yaw);
            const QPitch = ConstructAxisQuaternion([0.0, 1.0, 0.0], MicroPitch);
            const QRoll  = ConstructAxisQuaternion([1.0, 0.0, 0.0], MicroRoll);
            const QBody  = MultiplyQuaternion(MultiplyQuaternion(QYaw, QPitch), QRoll);

            const Pos = [Unit.Anchor[0], Unit.Anchor[1], HoverZ];
            Unit.WorldPosition = Pos;

            const State = this.ResolveAspectAtTime(this.Clock + Unit.PhaseOffset);
            Unit.CurrentAspect    = State.Aspect;
            Unit.RemainingSeconds = State.Remaining / Math.max(0.1, this.CycleSpeed);

            WriteOcc(Unit.HousingOccupant, Pos, QBody);

            const UpWorld = RotateVector(QBody, [0.0, 0.0, 1.0]);
            const TuckedQ = MultiplyQuaternion(QBody, QuarterTurnZ);

            for (const Key of TrafficAspectOrder)
            {
                if (Key === Unit.CurrentAspect)
                {
                    const ZOff = TrafficSlotZ[Key];
                    const ActivePos = [
                        Pos[0] + UpWorld[0] * ZOff,
                        Pos[1] + UpWorld[1] * ZOff,
                        Pos[2] + UpWorld[2] * ZOff
                    ];
                    WriteOcc(Unit.LensOccupants[Key], ActivePos, QBody);
                }
                else
                {
                    // Tucked 90° inside the opaque 0.48 m × 0.72 m titanium cabinet!
                    WriteOcc(Unit.LensOccupants[Key], Pos, TuckedQ);
                }
            }
        }
    }

    // Casts real colored Red / Orange / Yellow / Green clustered light onto the asphalt intersection below each hovering signal!
    QueryLightPoles()
    {
        if (!this.Enabled)
            return [];
        const Lights = [];
        for (const Unit of this.Units)
        {
            if (!Unit.Active)
                continue;
            const Colour = AspectLightColours[Unit.CurrentAspect] || AspectLightColours.GREEN;
            Lights.push({
                X:         Unit.WorldPosition[0],
                Y:         Unit.WorldPosition[1],
                Z:         Unit.WorldPosition[2] - 0.85,
                Colour,
                Intensity: 56.0,
                Reach:     26.0
            });
        }
        return Lights;
    }

    QueryNearestSignal(Position)
    {
        if (!Position)
            return null;
        let Best = null;
        let BestDist = Infinity;
        for (const Unit of this.Units)
        {
            if (!Unit.Active)
                continue;
            const Dist = Math.hypot(Position[0] - Unit.WorldPosition[0], Position[1] - Unit.WorldPosition[1]);
            if (Dist < BestDist)
            {
                BestDist = Dist;
                Best = Unit;
            }
        }
        if (!Best)
            return null;
        return {
            Id:               Best.Id,
            Name:             Best.Name,
            Aspect:           Best.CurrentAspect,
            RemainingSeconds: Best.RemainingSeconds,
            Distance:         BestDist,
            Position:         Best.WorldPosition.slice()
        };
    }

    QuerySummary(VehiclePosition = null)
    {
        const ActiveUnits = this.Units.filter((U) => U.Active);
        const Counts = { RED: 0, ORANGE: 0, YELLOW: 0, GREEN: 0 };
        for (const U of ActiveUnits)
            Counts[U.CurrentAspect] = (Counts[U.CurrentAspect] || 0) + 1;
        return {
            ActiveCount: ActiveUnits.length,
            Counts,
            Nearest:     this.QueryNearestSignal(VehiclePosition)
        };
    }
}
