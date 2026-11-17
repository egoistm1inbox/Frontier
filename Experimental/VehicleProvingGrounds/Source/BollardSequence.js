//============================================================================================================================================
//                                                            BOLLARDSEQUENCE.JS
//============================================================================================================================================
// 🧩 Proximity-triggered kinetic bollard corridors:
//    ① "linear" — simple linear retracting bollard gate rows that drop flush into road sockets when the player approaches;
//    ② "wave"   — long kinetic seesaw/travelling-wave bollard strip where one side & end rises while the opposite side & end falls.

import { OccupantStride } from "./FacetStructure.js";
import { CourseMaterial } from "./MaterialSpecification.js";
import { ConstructRigidTransform, ClampScalar } from "./TransformProjection.js";

function SmoothStep01(Value)
{
    const T = ClampScalar(Value, 0.0, 1.0);
    return T * T * (3.0 - 2.0 * T);
}

export class BollardSequence
{
    constructor(Host)
    {
        this.Host = Host;
        this.Clock = 0.0;
        this.Zones = [];
        this.Block = Host?.Scene?.BollardBlock || { First: 0, Count: 0, Zones: [] };

        let Cursor = this.Block.First;
        for (const Definition of (this.Block.Zones || []))
        {
            const Posts = Definition.Posts.map((Post) =>
            {
                const OccupantIndex = Cursor++;
                const InitialExtension = Definition.Mode === "linear" ? 1.0 : 0.5;
                return {
                    ...Post,
                    OccupantIndex,
                    Extension: InitialExtension,
                    Solid:     InitialExtension > 0.22
                };
            });
            this.Zones.push({
                ...Definition,
                Triggered:     false,
                ActiveTimer:   0.0,
                Activation:    0.0,
                AnnouncedOnce: false,
                Posts
            });
        }
        if (this.Zones.length > 0)
            this.ApplyTransforms(0.0, true);
    }

    // 📝 Evaluates whether Position (plus velocity lookahead) lies inside a trigger corridor box.
    IsInsideTrigger(Trigger, Position, Velocity = [0.0, 0.0, 0.0])
    {
        const CheckPoint = (Px, Py) =>
            Px >= Trigger.MinX && Px <= Trigger.MaxX && Py >= Trigger.MinY && Py <= Trigger.MaxY;
        if (CheckPoint(Position[0], Position[1]))
            return true;
        // Look ahead up to 0.85 s along vehicle velocity so high-speed runs open gates seamlessly ahead of the bumper
        for (const Lead of [0.35, 0.75])
        {
            if (CheckPoint(Position[0] + Velocity[0] * Lead, Position[1] + Velocity[1] * Lead))
                return true;
        }
        return false;
    }

    Advance(Seconds)
    {
        if (this.Zones.length === 0)
            return;
        const Step = Math.min(Math.max(Seconds, 0.0), 0.1);
        this.Clock += Step;
        const Vehicle = this.Host.Vehicle;
        const Position = Vehicle ? Vehicle.Position : [1.0e6, 1.0e6, 0.0];
        const Velocity = (Vehicle && Vehicle.LinearVelocity) ? Vehicle.LinearVelocity : [0.0, 0.0, 0.0];

        let AnyMoved = false;
        let ObstaclesChanged = false;

        for (const Zone of this.Zones)
        {
            const Inside = this.IsInsideTrigger(Zone.Trigger, Position, Velocity);
            const WasTriggered = Zone.Triggered;
            if (Inside)
                Zone.ActiveTimer = Zone.HoldSeconds ?? 1.6;
            else
                Zone.ActiveTimer = Math.max(0.0, Zone.ActiveTimer - Step);

            Zone.Triggered = Zone.ActiveTimer > 0.0;
            if (Zone.Triggered && !WasTriggered && this.Host.Shell)
            {
                const Label = Zone.Mode === "wave"
                    ? `${Zone.Name} — Kinetic Wave Active`
                    : `${Zone.Name} — Bollards Opening`;
                this.Host.Shell.Announce(Label);
            }

            const TargetActivation = Zone.Triggered ? 1.0 : 0.0;
            const Rate = Zone.Triggered ? (Zone.OpenSpeed ?? 3.6) : (Zone.CloseSpeed ?? 1.8);
            const NextActivation = Zone.Activation + ClampScalar(TargetActivation - Zone.Activation, -Rate * Step, Rate * Step);
            if (Math.abs(NextActivation - Zone.Activation) > 1.0e-5)
                AnyMoved = true;
            Zone.Activation = NextActivation;

            // Update beacon material override (Crimson standby -> GateLamp active)
            if (Zone.BeaconOccupant !== undefined && Zone.BeaconOccupant >= 0)
            {
                const Beacon = this.Host.Scene.Occupants[Zone.BeaconOccupant];
                const DesiredMaterial = Zone.Triggered ? CourseMaterial.GateLamp : CourseMaterial.WallCrimson;
                if (Beacon && Beacon.Material !== DesiredMaterial)
                {
                    Beacon.Material = DesiredMaterial;
                    const Scalars = this.Host.Scene.EncodeOccupantRange(this.Host.Volumes, Zone.BeaconOccupant, 1);
                    if (this.Host.Exchange && this.Host.OccupantRecords)
                        this.Host.Exchange.Device.queue.writeBuffer(this.Host.OccupantRecords, Zone.BeaconOccupant * OccupantStride, Scalars);
                }
            }

            for (const Post of Zone.Posts)
            {
                let TargetExtension = 1.0;
                if (Zone.Mode === "linear")
                {
                    // ① Simple linear retracting bollard strip: staggered front-to-back linear drop into floor sockets
                    const Cascade = SmoothStep01((Zone.Activation * 1.35) - 0.35 * Post.NormalizedU);
                    TargetExtension = 1.0 - Cascade;
                }
                else
                {
                    // ② Travelling seesaw wave strip:
                    //    θ(u, side, t) = π·u − ω·t + π·sideIndex
                    //    - Entry end (u = 0) and far end (u = 1) differ by π rad (180°): when one end rises, the far end sinks!
                    //    - Left rank (side = 0) and Right rank (side = 1) differ by π rad (180°): 1 side goes UP while the other goes DOWN!
                    const Omega = Zone.Triggered ? (Zone.WaveSpeed ?? 3.4) : 0.85;
                    const Phase = Math.PI * Post.NormalizedU - Omega * this.Clock + (Post.Side > 0 ? 0.0 : Math.PI);
                    const Wave = 0.5 + 0.5 * Math.sin(Phase);
                    const AmplitudeBlend = 0.30 + 0.70 * Zone.Activation;
                    TargetExtension = Wave * AmplitudeBlend;

                    // Inner-lane proximity pocket dips directly ahead of the bumper while outer wave columns surge full height
                    if (Post.InnerLane && Zone.Triggered)
                    {
                        const Dist = Math.hypot(Post.Position[0] - Position[0], Post.Position[1] - Position[1]);
                        const Pocket = SmoothStep01((Dist - 6.5) / 8.5);
                        TargetExtension *= Pocket;
                    }
                    AnyMoved = true;
                }

                const Delta = TargetExtension - Post.Extension;
                if (Math.abs(Delta) > 1.0e-4)
                {
                    const MaxStep = (Zone.Mode === "wave" ? 6.5 : 4.5) * Step;
                    Post.Extension += ClampScalar(Delta, -MaxStep, MaxStep);
                    AnyMoved = true;
                }

                const Occupant = this.Host.Scene.Occupants[Post.OccupantIndex];
                Occupant.Moving = Math.abs(Delta) > 1.0e-3 || (Zone.Mode === "wave" && Zone.Triggered);

                const NowSolid = Post.Extension > 0.24;
                if (NowSolid !== Post.Solid)
                {
                    Post.Solid = NowSolid;
                    Occupant.Obstacle = NowSolid;
                    ObstaclesChanged = true;
                }
            }
        }

        if (AnyMoved)
            this.ApplyTransforms(Step, false);

        if (ObstaclesChanged && this.Host.Vehicle)
        {
            this.Host.Vehicle.AssignObstacles(this.Host.Scene.QueryObstacleBounds());
            if (this.Host.Trams)
                this.Host.Trams.RegisterDynamicObstacles(this.Host.Vehicle.Obstacles);
        }
    }

    ApplyTransforms(_Step, Initial)
    {
        const Scene = this.Host.Scene;
        for (const Zone of this.Zones)
        {
            for (const Post of Zone.Posts)
            {
                // Retracted (Extension = 0): top of bollard sits 2 cm proud of floor socket; Raised (1): full MaxLift above road
                const SinkZ = Post.Position[2] - Post.Height + 0.03 + Post.Extension * (Post.Height - 0.03);
                const HalfYaw = 0.5 * (Post.Yaw || 0.0);
                const Transform = ConstructRigidTransform(
                    [Post.Position[0], Post.Position[1], SinkZ],
                    [0.0, 0.0, Math.sin(HalfYaw), Math.cos(HalfYaw)]
                );
                Scene.AssignOccupantTransform(Post.OccupantIndex, Transform);
                if (Initial)
                    Scene.RetainOccupantTransform(Post.OccupantIndex);
            }
        }
        if (this.Block.Count > 0 && this.Host.Volumes && this.Host.Exchange && this.Host.OccupantRecords)
        {
            const Scalars = Scene.EncodeOccupantRange(this.Host.Volumes, this.Block.First, this.Block.Count);
            this.Host.Exchange.Device.queue.writeBuffer(this.Host.OccupantRecords, this.Block.First * OccupantStride, Scalars);
        }
    }

    QueryReadout()
    {
        if (this.Zones.length === 0)
            return [];
        return this.Zones.map((Zone) =>
            `${Zone.Name} (${Zone.Mode}): ${Zone.Triggered ? "OPEN / ACTIVE" : "STANDBY"} · ${(Zone.Activation * 100).toFixed(0)}%`
        );
    }
}
