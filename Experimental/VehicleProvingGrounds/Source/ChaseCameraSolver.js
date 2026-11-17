//============================================================================================================================================
//                                                           CHASECAMERASOLVER.JS
//============================================================================================================================================
// 🧩 Critically damped follow projection behind the vehicle, with an orbit offset the pointer can drag around it.

// 📝 Frontier's ChaseCameraSolver: eye FollowDistance behind and FollowHeight above, exponential follow at
//    PositionSpring, aim LookAtHeight above the chassis, field of view widened with speed. The orbit offset is the
//    exhibit's addition so the distance field and the vehicle can be inspected from any side while driving.
import { NormalizeVector, SubtractVector, AddVector, ScaleVector, CrossVector, DotVector, MultiplyAddVector, ClampScalar } from "./TransformProjection.js";
import { ResolveCourseHeight } from "./CourseStructure.js";
import { CastSurfaceRay } from "./RampSurfaceProjection.js";

export const ChaseCameraConfiguration = Object.freeze({
    FollowDistance:   7.0,    // [m]
    FollowHeight:     2.6,    // [m]
    LookAtHeight:     0.8,    // [m]
    PositionSpring:   6.0,    // [1/s]
    RestFieldOfView:  60.0,   // [deg]
    SpeedFieldOfView: 12.0,   // [deg]
    SpeedForFullFov:  60.0    // [m/s]
});

export class ChaseCameraSolver
{
    constructor()
    {
        this.Eye          = [-7.0, 0.0, 3.1];
        this.Target       = [0.0, 0.0, 1.3];
        this.Up           = [0.0, 0.0, 1.0];
        this.ForwardBasis = [1.0, 0.0, 0.0];
        this.FieldOfView  = ChaseCameraConfiguration.RestFieldOfView;
        this.Seeded       = false;
        this.OrbitYaw     = 0.0;   // [rad] - pointer offset around the vehicle
        this.OrbitPitch   = 0.0;   // [rad]
        this.OrbitScale   = 1.0;   // [-]   - wheel zoom
        this.Surfaces     = [];
    }

    ResolveFrame(Forward, VehicleUp = [0.0, 0.0, 1.0], SurfaceContact = true)
    {
        const WorldUp = [0.0, 0.0, 1.0];
        // 📝 Smoothly transition from world-up on gentle ground to full vehicle-up on 45° banks, 90° walls & 180° loops.
        const Steepness = ClampScalar((0.95 - VehicleUp[2]) / 0.50, 0.0, 1.0);
        const Blend = SurfaceContact ? (0.65 * Steepness + 0.35 * Steepness * Steepness) : (VehicleUp[2] < 0.25 ? Steepness : 0.25 * Steepness);
        const DesiredUp = NormalizeVector(AddVector(ScaleVector(WorldUp, 1.0 - Blend), ScaleVector(VehicleUp, Blend)));
        let ProjectedForward = SubtractVector(Forward, ScaleVector(DesiredUp, DotVector(Forward, DesiredUp)));
        if ( Math.hypot(ProjectedForward[0], ProjectedForward[1], ProjectedForward[2]) < 1.0e-4 )
            ProjectedForward = SubtractVector(this.ForwardBasis, ScaleVector(DesiredUp, DotVector(this.ForwardBasis, DesiredUp)));
        const FrameForward = NormalizeVector(ProjectedForward);
        const FrameLeft = NormalizeVector(CrossVector(DesiredUp, FrameForward));
        return { FrameForward, FrameLeft, FrameUp: DesiredUp };
    }

    ResolveIdealEye(Position, Forward, VehicleUp = [0.0, 0.0, 1.0], SurfaceContact = true)
    {
        const { FrameForward, FrameLeft, FrameUp } = this.ResolveFrame(Forward, VehicleUp, SurfaceContact);
        const Distance = ChaseCameraConfiguration.FollowDistance * this.OrbitScale;
        const Height = ChaseCameraConfiguration.FollowHeight * this.OrbitScale + Distance * Math.sin(this.OrbitPitch);
        const Horizontal = Distance * Math.cos(this.OrbitPitch);
        const Cosine = Math.cos(this.OrbitYaw), Sine = Math.sin(this.OrbitYaw);
        const Behind = AddVector(ScaleVector(FrameForward, -Cosine), ScaleVector(FrameLeft, -Sine));
        return AddVector(MultiplyAddVector(Position, Behind, Horizontal), ScaleVector(FrameUp, Height));
    }

    SnapTo(Position, Forward, VehicleUp = [0.0, 0.0, 1.0], SurfaceContact = true)
    {
        const { FrameForward, FrameUp } = this.ResolveFrame(Forward, VehicleUp, SurfaceContact);
        this.Up = FrameUp;
        this.ForwardBasis = FrameForward;
        this.Eye = this.ResolveIdealEye(Position, Forward, VehicleUp, SurfaceContact);
        this.Target = MultiplyAddVector(Position, this.Up, ChaseCameraConfiguration.LookAtHeight);
        this.FieldOfView = ChaseCameraConfiguration.RestFieldOfView;
        this.Seeded = true;
    }

    AdvanceChase(Position, Forward, Speed, Δτ, VehicleUp = [0.0, 0.0, 1.0], SurfaceContact = true)
    {
        if (!this.Seeded)
        {
            this.SnapTo(Position, Forward, VehicleUp, SurfaceContact);
            return;
        }
        const { FrameForward, FrameUp } = this.ResolveFrame(Forward, VehicleUp, SurfaceContact);
        const Follow = 1.0 - Math.exp(-ChaseCameraConfiguration.PositionSpring * Δτ);
        const UpFollow = 1.0 - Math.exp(-8.5 * Δτ);
        this.Up = NormalizeVector(AddVector(this.Up, ScaleVector(SubtractVector(FrameUp, this.Up), UpFollow)));
        this.ForwardBasis = FrameForward;
        const Ideal = this.ResolveIdealEye(Position, Forward, VehicleUp, SurfaceContact);
        this.Eye = AddVector(this.Eye, ScaleVector(SubtractVector(Ideal, this.Eye), Follow));
        this.Target = MultiplyAddVector(Position, this.Up, ChaseCameraConfiguration.LookAtHeight);
        if (this.Surfaces && this.Surfaces.length > 0)
        {
            const Span = SubtractVector(this.Eye, this.Target);
            const Distance = Math.hypot(Span[0], Span[1], Span[2]);
            if (Distance > 0.25)
            {
                const RayDir = ScaleVector(Span, 1.0 / Distance);
                const RoofHit = CastSurfaceRay(this.Surfaces, this.Target, RayDir, Distance);
                if (RoofHit && RoofHit.Travel > 0.6 && RoofHit.Travel < Distance)
                    this.Eye = MultiplyAddVector(this.Target, RayDir, Math.max(0.8, RoofHit.Travel - 0.38));
            }
        }
        if (this.Up[2] > 0.25)
        {
            const LocalFloor = Math.min(Position[2] - 0.25, ResolveCourseHeight(this.Eye[0], this.Eye[1], Position[2]));
            this.Eye[2] = Math.max(this.Eye[2], LocalFloor + 0.35);
        }
        const Widen = ClampScalar(Math.abs(Speed) / Math.max(1.0, ChaseCameraConfiguration.SpeedForFullFov), 0.0, 1.0);
        this.FieldOfView = ChaseCameraConfiguration.RestFieldOfView + ChaseCameraConfiguration.SpeedFieldOfView * Widen;
    }
}

// 📝 Free flight (Project-Drive's F8): WASD along the view, Q/E down/up, pointer drag to look, Shift to hurry.
export class FreeCameraSolver
{
    constructor()
    {
        this.Eye   = [-18.0, -14.0, 9.0];
        this.Yaw   = Math.atan2(14.0, 18.0);
        this.Pitch = -0.32;
        this.FieldOfView = 60.0;
    }

    ResolveForward()
    {
        return [Math.cos(this.Pitch) * Math.cos(this.Yaw), Math.cos(this.Pitch) * Math.sin(this.Yaw), Math.sin(this.Pitch)];
    }

    AdvanceFlight(Keys, Δτ)
    {
        const Forward = this.ResolveForward();
        const Right = NormalizeVector([Forward[1], -Forward[0], 0.0]);
        const Speed = (Keys.has("ShiftLeft") || Keys.has("ShiftRight")) ? 30.0 : 9.0;
        let Move = [0.0, 0.0, 0.0];
        if (Keys.has("KeyW") || Keys.has("ArrowUp"))    Move = AddVector(Move, Forward);
        if (Keys.has("KeyS") || Keys.has("ArrowDown"))  Move = SubtractVector(Move, Forward);
        if (Keys.has("KeyD") || Keys.has("ArrowRight")) Move = AddVector(Move, Right);
        if (Keys.has("KeyA") || Keys.has("ArrowLeft"))  Move = SubtractVector(Move, Right);
        if (Keys.has("KeyE")) Move[2] += 1.0;
        if (Keys.has("KeyQ")) Move[2] -= 1.0;
        this.Eye = MultiplyAddVector(this.Eye, Move, Speed * Δτ);
        this.Eye[2] = Math.max(this.Eye[2], ResolveCourseHeight(this.Eye[0], this.Eye[1], -100.0) + 0.2);
    }

    AssignFromChase(Eye, Target)
    {
        this.Eye = Eye.slice();
        const Direction = NormalizeVector(SubtractVector(Target, Eye));
        this.Yaw = Math.atan2(Direction[1], Direction[0]);
        this.Pitch = Math.asin(ClampScalar(Direction[2], -1.0, 1.0));
    }
}
