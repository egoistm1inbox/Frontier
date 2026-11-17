//============================================================================================================================================
//                                                           TRAMSEQUENCE.JS
//============================================================================================================================================
// 🧩 Dedicated articulated streetcar tram & commuter rail train traffic system (separate module, corridor, physics & Inspector controls).

import { CourseMaterial } from "./MaterialSpecification.js";
import { EmitBoxFacets } from "./CourseStructure.js";
import { SubtractVector, CrossVector, DotVector, NormalizeVector,
         ConstructAxisQuaternion, ConstructRigidTransform, ClampScalar } from "./TransformProjection.js";

//------------------------------------------------------------------------------------------------------------------------
//                                      WATERTIGHT 2-MANIFOLD RAIL COACH GEOMETRY
//------------------------------------------------------------------------------------------------------------------------

// 📝 Emits a single-component closed outward-wound 2-manifold aerodynamic tram/train car body with multi-material bands.
export function EmitRailCoachFacets(Options)
{
    const HalfL = 0.5 * Options.Length;
    const HalfW = 0.5 * Options.Width;
    const Height = Options.Height;
    const NoseLength = Options.NoseLength ?? 1.35;
    const TaperScale = Options.TaperScale ?? 0.80;

    // 📝 8-point counter-clockwise cross-section loop in the (Y, Z) plane looking from -X toward +X:
    //    0: bottom-right -> 1: skirt-right -> 2: waist-right -> 3: cantrail-right ->
    //    4: cantrail-left -> 5: waist-left -> 6: skirt-left -> 7: bottom-left
    const BaseLoop = [
        [-HalfW * 0.88, 0.16],
        [-HalfW,        0.62],
        [-HalfW,        1.52],
        [-HalfW * 0.92, Height - 0.24],
        [ HalfW * 0.92, Height - 0.24],
        [ HalfW,        1.52],
        [ HalfW,        0.62],
        [ HalfW * 0.88, 0.16]
    ];
    // 📝 Material per perimeter band (0..7):
    //    0->1 bogie skirt, 1->2 lower livery, 2->3 panoramic window, 3->4 roof crown,
    //    4->5 panoramic window, 5->6 lower livery, 6->7 bogie skirt, 7->0 underfloor
    const BandMaterials = [
        Options.SkirtMaterial,
        Options.LiveryMaterial,
        Options.WindowMaterial,
        Options.RoofMaterial,
        Options.WindowMaterial,
        Options.LiveryMaterial,
        Options.SkirtMaterial,
        CourseMaterial.SteelDark
    ];

    const Stations = [
        { X: -HalfL,              ScaleY: TaperScale, LiftZ: 0.10, RoofDrop: 0.18 },
        { X: -HalfL + NoseLength, ScaleY: 1.0,        LiftZ: 0.0,  RoofDrop: 0.0  },
        { X:  HalfL - NoseLength, ScaleY: 1.0,        LiftZ: 0.0,  RoofDrop: 0.0  },
        { X:  HalfL,              ScaleY: TaperScale, LiftZ: 0.10, RoofDrop: 0.18 }
    ];

    const Rings = Stations.map((Station) => BaseLoop.map(([Y, Z], Index) =>
    {
        const IsUpper = Index >= 2 && Index <= 5;
        const AdjustedZ = IsUpper ? (Z - Station.RoofDrop) : (Z + Station.LiftZ);
        return [Station.X, Y * Station.ScaleY, AdjustedZ];
    }));

    const Facets = [];
    const PushTriangle = (A, B, C, Family) =>
    {
        Facets.push({ Corners: [A, B, C], Family });
    };

    const LoopCount = BaseLoop.length;
    for (let RingIdx = 0; RingIdx < Rings.length - 1; ++RingIdx)
    {
        const RingA = Rings[RingIdx];
        const RingB = Rings[RingIdx + 1];
        for (let Edge = 0; Edge < LoopCount; ++Edge)
        {
            const Next = (Edge + 1) % LoopCount;
            const P00 = RingA[Edge];
            const P01 = RingA[Next];
            const P11 = RingB[Next];
            const P10 = RingB[Edge];
            // 📝 Outward normal points away from coach interior: Cross(RingB - RingA, Next - Edge) -> (P00, P10, P11, P01)
            let Mat = BandMaterials[Edge];
            if (RingIdx === 2 && (Edge === 1 || Edge === 5))
                Mat = Options.FrontLampMaterial;
            else if (RingIdx === 0 && (Edge === 1 || Edge === 5))
                Mat = Options.TailLampMaterial;
            PushTriangle(P00, P10, P11, Mat);
            PushTriangle(P00, P11, P01, Mat);
        }
    }

    // 📝 Rear cap at Ring 0 (-X outward normal): fan from RearRing[0] closing Ring0[Edge] -> Ring0[Next]
    const RearRing = Rings[0];
    for (let Index = 1; Index + 1 < LoopCount; ++Index)
        PushTriangle(RearRing[0], RearRing[Index], RearRing[Index + 1], Options.TailLampMaterial);

    // 📝 Front nose cap at Ring 3 (+X outward normal): fan from FrontRing[0] closing FrontRing[Next] -> FrontRing[Edge]
    const FrontRing = Rings[Rings.length - 1];
    for (let Index = 1; Index + 1 < LoopCount; ++Index)
        PushTriangle(FrontRing[0], FrontRing[Index + 1], FrontRing[Index], Options.FrontLampMaterial);

    return Facets;
}

export function ConstructTramShapes()
{
    return {
        // ① Articulated modern low-floor city streetcar tram unit (11.2 m × 2.65 m × 3.30 m)
        TramCarBody: {
            Emit: () => EmitRailCoachFacets({
                Length:            11.2,
                Width:             2.65,
                Height:            3.30,
                NoseLength:        1.25,
                TaperScale:        0.78,
                SkirtMaterial:     CourseMaterial.SteelDark,
                LiveryMaterial:    CourseMaterial.PaintYellow,
                WindowMaterial:    CourseMaterial.GateLamp,
                RoofMaterial:      CourseMaterial.PaintWhite,
                FrontLampMaterial: CourseMaterial.GateLamp,
                TailLampMaterial:  CourseMaterial.WallCrimson
            }),
            Voxel: 0.24,
            Cards: 8
        },
        // ② Express heavy-rail commuter / subway train coach (13.6 m × 2.92 m × 3.52 m)
        TrainCoachBody: {
            Emit: () => EmitRailCoachFacets({
                Length:            13.6,
                Width:             2.92,
                Height:            3.52,
                NoseLength:        1.45,
                TaperScale:        0.82,
                SkirtMaterial:     CourseMaterial.SteelDark,
                LiveryMaterial:    CourseMaterial.WallCobalt,
                WindowMaterial:    CourseMaterial.GateLamp,
                RoofMaterial:      CourseMaterial.ApronConcrete,
                FrontLampMaterial: CourseMaterial.PaintWhite,
                TailLampMaterial:  CourseMaterial.KerbRed
            }),
            Voxel: 0.25,
            Cards: 8
        },
        // ③ Raster-only steel grooved rail segment & overhead catenary masts (0 SDF slices!)
        TramRailBar: {
            Emit: () => EmitBoxFacets(22.0, 0.14, 0.08, CourseMaterial.SteelDark),
            Voxel: 0.0,
            Cards: 0.0,
            Distance: false
        },
        CatenaryPole: {
            Emit: () => EmitBoxFacets(0.32, 0.32, 6.8, CourseMaterial.SteelDark),
            Voxel: 0.0,
            Cards: 0.0,
            Distance: false
        },
        CatenaryArm: {
            Emit: () => EmitBoxFacets(0.20, 12.6, 0.20, CourseMaterial.SteelDark),
            Voxel: 0.0,
            Cards: 0.0,
            Distance: false
        }
    };
}

//------------------------------------------------------------------------------------------------------------------------
//                                        TRAM & TRAIN TRAFFIC CONTROLLER
//------------------------------------------------------------------------------------------------------------------------

export class TramSequence
{
    constructor(Scene, Consists = [])
    {
        this.Scene      = Scene;
        this.Consists   = [];
        this.Enabled    = true;
        this.SpeedScale = 1.0;
        this.Clock      = 0.0;

        let OccupantCursor = Scene && Scene.TramBlock ? Scene.TramBlock.First : 0;
        for (const Spec of Consists)
        {
            const Cars = [];
            for (let CarIdx = 0; CarIdx < Spec.CarCount; ++CarIdx)
            {
                Cars.push({
                    Occupant:      OccupantCursor++,
                    OffsetAlong:   -CarIdx * Spec.CarSpacing,
                    HalfExtent:    [0.5 * Spec.CarLength, 0.5 * Spec.CarWidth, 0.5 * Spec.CarHeight],
                    WorldPosition: [Spec.StartX, Spec.LaneY, Spec.BaseZ || 0.0],
                    WorldVelocity: [0.0, 0.0, 0.0],
                    ObstacleBox:   null
                });
            }
            this.Consists.push({
                Id:            Spec.Id,
                Name:          Spec.Name,
                Kind:          Spec.Kind || "tram",
                Shape:         Spec.Shape,
                StartX:        Spec.StartX,
                EndX:          Spec.EndX,
                LaneY:         Spec.LaneY,
                BaseZ:         Spec.BaseZ ?? 0.0,
                Direction:     Spec.Direction ?? 1.0,
                CruiseSpeed:   Spec.CruiseSpeed ?? 12.5,
                StationX:      Spec.StationX ?? null,
                StationDwell:  Spec.StationDwell ?? 2.4,
                CarHeight:     Spec.CarHeight ?? 3.30,
                HeadProgress:  Spec.InitialProgress ?? 0.0,
                DwellTimer:    0.0,
                CurrentSpeed:  Spec.CruiseSpeed ?? 12.5,
                StationPassed: false,
                Cars
            });
        }

        this.SyncAllConsists(0.0);
    }

    RegisterDynamicObstacles(ObstacleArray)
    {
        if (!Array.isArray(ObstacleArray))
            return ObstacleArray;
        for (const Consist of this.Consists)
        {
            for (const Car of Consist.Cars)
            {
                if (!Car.ObstacleBox)
                {
                    Car.ObstacleBox = {
                        Minimum: [0.0, 0.0, -100.0],
                        Maximum: [0.0, 0.0, -99.0],
                        DynamicTram: true,
                        Velocity: Car.WorldVelocity
                    };
                }
                if (!ObstacleArray.includes(Car.ObstacleBox))
                    ObstacleArray.push(Car.ObstacleBox);
            }
        }
        this.UpdateObstacleBounds();
        return ObstacleArray;
    }

    UpdateObstacleBounds()
    {
        for (const Consist of this.Consists)
        {
            for (const Car of Consist.Cars)
            {
                if (!Car.ObstacleBox)
                    continue;
                const [HX, HY, HZ] = Car.HalfExtent;
                const [PX, PY, PZ] = Car.WorldPosition;
                Car.ObstacleBox.Minimum[0] = PX - HX;
                Car.ObstacleBox.Minimum[1] = PY - HY;
                Car.ObstacleBox.Minimum[2] = PZ;
                Car.ObstacleBox.Maximum[0] = PX + HX;
                Car.ObstacleBox.Maximum[1] = PY + HY;
                Car.ObstacleBox.Maximum[2] = PZ + 2.0 * HZ;
            }
        }
    }

    SyncAllConsists(Dt)
    {
        const Scale = this.Enabled ? this.SpeedScale : 0.0;
        for (const Consist of this.Consists)
        {
            const SpanLength = Math.abs(Consist.EndX - Consist.StartX);
            const Dir = Consist.Direction;
            const TargetCruise = Consist.CruiseSpeed * Scale;

            if (Dt > 0.0 && Scale > 1.0e-4)
            {
                const HeadWorldX = Consist.StartX + Dir * Consist.HeadProgress;
                if (Consist.StationX !== null && !Consist.StationPassed)
                {
                    const DistToStation = (Consist.StationX - HeadWorldX) * Dir;
                    if (DistToStation <= 0.6 && DistToStation >= -2.5)
                    {
                        Consist.CurrentSpeed = 0.0;
                        Consist.DwellTimer += Dt;
                        if (Consist.DwellTimer >= Consist.StationDwell)
                        {
                            Consist.StationPassed = true;
                            Consist.DwellTimer = 0.0;
                        }
                    }
                    else if (DistToStation > 0.6 && DistToStation < 24.0)
                    {
                        const SlowFactor = ClampScalar(DistToStation / 24.0, 0.18, 1.0);
                        Consist.CurrentSpeed = TargetCruise * SlowFactor;
                    }
                    else
                        Consist.CurrentSpeed += (TargetCruise - Consist.CurrentSpeed) * Math.min(1.0, Dt * 2.8);
                }
                else
                {
                    Consist.CurrentSpeed += (TargetCruise - Consist.CurrentSpeed) * Math.min(1.0, Dt * 2.5);
                }

                Consist.HeadProgress += Consist.CurrentSpeed * Dt;
                if (Consist.HeadProgress > SpanLength)
                {
                    Consist.HeadProgress -= SpanLength;
                    Consist.StationPassed = false;
                }
            }
            else if (Scale <= 1.0e-4)
            {
                Consist.CurrentSpeed = 0.0;
            }

            const Yaw = Dir >= 0.0 ? 0.0 : Math.PI;
            const Orientation = ConstructAxisQuaternion([0.0, 0.0, 1.0], Yaw);

            for (let CarIdx = 0; CarIdx < Consist.Cars.length; ++CarIdx)
            {
                const Car = Consist.Cars[CarIdx];
                let RelAlong = Consist.HeadProgress + Car.OffsetAlong;
                if (RelAlong < 0.0)
                    RelAlong += SpanLength;
                const WorldX = Consist.StartX + Dir * RelAlong;
                Car.WorldPosition[0] = WorldX;
                Car.WorldPosition[1] = Consist.LaneY;
                Car.WorldPosition[2] = Consist.BaseZ;
                Car.WorldVelocity[0] = Dir * Consist.CurrentSpeed;
                Car.WorldVelocity[1] = 0.0;
                Car.WorldVelocity[2] = 0.0;

                if (this.Scene && this.Scene.Occupants[Car.Occupant])
                {
                    const Occupant = this.Scene.Occupants[Car.Occupant];
                    Occupant.PreviousTransform.set(Occupant.Transform);
                    Occupant.Transform = ConstructRigidTransform(Car.WorldPosition, Orientation);
                    Occupant.Moving = Consist.CurrentSpeed > 0.05;
                }
            }
        }
        this.UpdateObstacleBounds();
    }

    // 📝 Resolves kinematic momentum push if the player's car clips a moving tram or express train!
    ResolveVehicleInteraction(Vehicle)
    {
        if (!Vehicle || !Vehicle.Position || !Vehicle.LinearVelocity)
            return;
        const [VX, VY, VZ] = Vehicle.Position;
        const VehicleRadiusX = 2.25;
        const VehicleRadiusY = 1.05;

        for (const Consist of this.Consists)
        {
            for (const Car of Consist.Cars)
            {
                const [HX, HY, HZ] = Car.HalfExtent;
                const [CX, CY, CZ] = Car.WorldPosition;
                if (VZ > CZ + 2.0 * HZ + 0.6 || VZ + 1.4 < CZ)
                    continue;
                const OverlapX = (HX + VehicleRadiusX) - Math.abs(VX - CX);
                const OverlapY = (HY + VehicleRadiusY) - Math.abs(VY - CY);
                if (OverlapX <= 0.0 || OverlapY <= 0.0)
                    continue;

                let Normal;
                let Depth;
                if (OverlapX < OverlapY)
                {
                    Normal = [VX >= CX ? 1.0 : -1.0, 0.0, 0.0];
                    Depth = OverlapX;
                }
                else
                {
                    Normal = [0.0, VY >= CY ? 1.0 : -1.0, 0.0];
                    Depth = OverlapY;
                }
                Vehicle.Position[0] += Normal[0] * (Depth + 0.03);
                Vehicle.Position[1] += Normal[1] * (Depth + 0.03);

                const RelVel = SubtractVector(Vehicle.LinearVelocity, Car.WorldVelocity);
                const RelNormal = DotVector(RelVel, Normal);
                if (RelNormal < 0.0)
                {
                    const Bounce = -1.32 * RelNormal;
                    Vehicle.LinearVelocity[0] += Normal[0] * Bounce + Car.WorldVelocity[0] * 0.18;
                    Vehicle.LinearVelocity[1] += Normal[1] * Bounce;
                }
            }
        }
    }

    Advance(Vehicle, Dt)
    {
        if (!(Dt > 0.0))
            return false;
        const Step = Math.min(Dt, 0.05);
        this.Clock += Step;
        this.SyncAllConsists(Step);
        this.ResolveVehicleInteraction(Vehicle);
        return this.Enabled && this.SpeedScale > 1.0e-4;
    }

    QuerySummary()
    {
        let CarTotal = 0;
        for (const Consist of this.Consists)
            CarTotal += Consist.Cars.length;
        return {
            Enabled:      this.Enabled,
            SpeedScale:   this.SpeedScale,
            ConsistCount: this.Consists.length,
            CarCount:     CarTotal
        };
    }
}
