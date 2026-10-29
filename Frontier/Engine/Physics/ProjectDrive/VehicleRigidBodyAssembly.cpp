//============================================================================================================================================
//                                                    VEHICLERIGIDBODYASSEMBLY.CPP
//============================================================================================================================================
// 🧩 Reusable Engine assembly binding VehicleSolver, VehicleSpawnSolver, and TyreVisualBridge onto a Jolt RigidBodySolver chassis.

#include "VehicleRigidBodyAssembly.h"

#include <algorithm>
#include <cmath>
#include <utility>

namespace Frontier::Vehicle
{

bool VehicleRigidBodyAssembly::Construct(
    RigidBodySolver&                     WorldSolver,
    const VehicleGeometry&               AuthoredGeometry,
    const VehicleRigidBodySpecification& Specification,
    GroundQuery                          SurfaceQuery) noexcept
{
    Retire();
    if (!WorldSolver.Active())
    {
        return false;
    }

    BoundWorld          = &WorldSolver;
    Geometry            = AuthoredGeometry;
    ActiveSpecification = Specification;
    AnalyticalGround    = std::move(SurfaceQuery);

    SolverConfiguration                         = VehicleSolverConfiguration{};
    SolverConfiguration.ActiveScheme            = DrivingScheme::PacejkaDrivetrain;
    ApplyGeometry(SolverConfiguration, Geometry);
    SolverConfiguration.Aero.Enabled            = true;
    SolverConfiguration.BrakeThermalEnabled     = Specification.EnableBrakeThermals;
    SolverConfiguration.TyreThermal.Enabled     = Specification.EnableTyreThermals;
    // Calibrated SBR/BR outer-tread thermal mass, belt-to-carcass conduction, rotational convection & auto-ignition kinetics
    // so VehicleHMI / Project-Drive tyres emit dense pyrolysis smoke before igniting only after >30 s of extreme burnout!
    SolverConfiguration.TyreThermal.IgnitionEnabled           = Specification.EnableTyreThermals;
    SolverConfiguration.TyreThermal.SurfaceHeatCapacity       = 3200.0;
    SolverConfiguration.TyreThermal.CarcassHeatCapacity       = 15800.0;
    SolverConfiguration.TyreThermal.SurfaceCarcassConductance = 88.0;
    SolverConfiguration.TyreThermal.SurfaceAirConductance     = 42.0;
    SolverConfiguration.TyreThermal.RoadConductance           = 54.0;
    SolverConfiguration.TyreThermal.SlidingHeatShare          = 0.58;
    SolverConfiguration.TyreThermal.IgnitionTemperature       = 683.15;
    SolverConfiguration.TyreThermal.IgnitionExposureSeconds   = 14.0;
    SolverConfiguration.TyreThermal.ExtinctionTemperature     = 505.15;

    ChassisState Requested{};
    Requested.Position    = Specification.RequestedPosition;
    Requested.Orientation = Specification.RequestedOrientation.Normalized();

    const GroundQuery CombinedGround = [this](const Vec3& Point, Vec3& OutSurface, Vec3& OutNormal) -> bool {
        return EvaluateGroundContact(Point, OutSurface, OutNormal);
    };

    ResolvedSpawnPose = Requested;
    if (Specification.FitToTerrain)
    {
        const VehicleSpawnReading SpawnReading =
            ResolveVehicleSpawn(SolverConfiguration, Requested, CombinedGround, Specification.SpawnClearanceMetres);
        if (!SpawnReading.Supported)
        {
            BoundWorld = nullptr;
            return false;
        }
        ResolvedSpawnPose = SpawnReading.Pose;
    }

    RigidBodyDescription ChassisDescription;
    ChassisDescription.Name                = Specification.Name;
    ChassisDescription.Shape.Category      = CollisionShapeCategory::Box;
    ChassisDescription.Shape.HalfExtents   = Specification.ChassisHalfExtents;
    ChassisDescription.Motion              = RigidBodyMotionCategory::Dynamic;
    ChassisDescription.Position            = ToPhysicsVector(ResolvedSpawnPose.Position);
    ChassisDescription.Orientation         = ToPhysicsQuaternion(ResolvedSpawnPose.Orientation);
    ChassisDescription.MassKilograms       = SolverConfiguration.ChassisMass;
    ChassisDescription.PrincipalInertia    = ToPhysicsVector(Geometry.Inertia());
    ChassisDescription.Friction            = Specification.ChassisFriction;
    ChassisDescription.Restitution         = Specification.ChassisRestitution;
    ChassisDescription.LinearDamping       = Specification.LinearDamping;
    ChassisDescription.AngularDamping      = Specification.AngularDamping;
    ChassisDescription.AllowSleeping       = false;
    ChassisDescription.ContinuousCollision = true;

    ChassisIdentity = BoundWorld->CreateBody(ChassisDescription);
    if (ChassisIdentity == InvalidRigidBody)
    {
        BoundWorld = nullptr;
        return false;
    }

    VehicleSolver::Hooks Hooks;
    Hooks.ReadChassis = [this]() -> ChassisState {
        return ReadChassisFromJolt();
    };
    Hooks.ApplyForceAtPoint = [this](const Vec3& ForceNewtons, const Vec3& WorldPoint) {
        if (BoundWorld != nullptr && ChassisIdentity != InvalidRigidBody)
        {
            BoundWorld->ApplyForceAtPoint(ChassisIdentity, ToPhysicsVector(ForceNewtons), ToPhysicsVector(WorldPoint));
        }
    };
    Hooks.ApplyTorque = [this](const Vec3& TorqueNewtonMetres) {
        if (BoundWorld != nullptr && ChassisIdentity != InvalidRigidBody)
        {
            BoundWorld->ApplyTorque(ChassisIdentity, ToPhysicsVector(TorqueNewtonMetres));
        }
    };
    Hooks.Ground = CombinedGround;

    DynamicsSolver.Build(SolverConfiguration, Hooks, ResolvedSpawnPose);
    if (!DynamicsSolver.Constructed())
    {
        BoundWorld->DestroyBody(ChassisIdentity);
        ChassisIdentity = InvalidRigidBody;
        BoundWorld      = nullptr;
        return false;
    }

    PendingInput                = DriverInput{};
    LatestSnapshot              = VehicleVisualSnapshot{};
    LatestSnapshot.Telemetry    = DynamicsSolver.Telemetry();
    LatestSnapshot.Telemetry.Chassis = ResolvedSpawnPose;
    TyreBridge.Reset(LatestSnapshot.Telemetry);
    RefreshVisualMatrices();

    AssemblyConstructed = true;
    return true;
}

void VehicleRigidBodyAssembly::Retire() noexcept
{
    if (BoundWorld != nullptr && ChassisIdentity != InvalidRigidBody && BoundWorld->Active())
    {
        BoundWorld->DestroyBody(ChassisIdentity);
    }
    ChassisIdentity     = InvalidRigidBody;
    BoundWorld          = nullptr;
    AssemblyConstructed = false;
}

void VehicleRigidBodyAssembly::AssignInput(const DriverInput& Command) noexcept
{
    PendingInput = Command;
    DynamicsSolver.AssignInput(Command);
}

void VehicleRigidBodyAssembly::ApplyStepForces(float Δτ) noexcept
{
    if (!AssemblyConstructed || BoundWorld == nullptr || !(Δτ > 0.0f))
    {
        return;
    }
    DynamicsSolver.AssignInput(PendingInput);
    DynamicsSolver.Step(Δτ);
}

void VehicleRigidBodyAssembly::SynchronizeAfterWorldStep(float Δτ) noexcept
{
    if (!AssemblyConstructed || BoundWorld == nullptr)
    {
        return;
    }

    LatestSnapshot.Telemetry         = DynamicsSolver.Telemetry();
    const ChassisState PostStepPose  = ReadChassisFromJolt();
    LatestSnapshot.Telemetry.Chassis = PostStepPose;
    LatestSnapshot.Telemetry.SpeedMetresPerSecond = PostStepPose.LinearVelocity.Length();
    LatestSnapshot.Telemetry.ForwardSpeed =
        Dot(PostStepPose.LinearVelocity, PostStepPose.Orientation.Rotate({1.0f, 0.0f, 0.0f}));

    for (size_t Corner = 0u; Corner < 4u; ++Corner)
    {
        const double ThermalGaugePressure = LatestSnapshot.Telemetry.Wheels[Corner].Thermal.GaugePressure;
        LatestSnapshot.TyrePressuresPascals[Corner] =
            (ActiveSpecification.EnableTyreThermals && ThermalGaugePressure > 50000.0) ? ThermalGaugePressure : 220000.0;
    }

    if (Δτ > 0.0f)
    {
        TyreBridge.Advance(
            LatestSnapshot.Telemetry,
            LatestSnapshot.TyrePressuresPascals.data(),
            ActiveSpecification.VisualTyreMode,
            static_cast<double>(Δτ));
    }

    ++LatestSnapshot.StepCounter;
    RefreshVisualMatrices();
}

bool VehicleRigidBodyAssembly::StepCoupled(float Δτ) noexcept
{
    if (!AssemblyConstructed || BoundWorld == nullptr || !(Δτ > 0.0f))
    {
        return false;
    }
    ApplyStepForces(Δτ);
    if (!BoundWorld->StepOnce())
    {
        return false;
    }
    SynchronizeAfterWorldStep(Δτ);
    return true;
}

void VehicleRigidBodyAssembly::ResetToSpawn() noexcept
{
    if (!AssemblyConstructed || BoundWorld == nullptr)
    {
        return;
    }

    BoundWorld->Teleport(
        ChassisIdentity,
        ToPhysicsVector(ResolvedSpawnPose.Position),
        ToPhysicsQuaternion(ResolvedSpawnPose.Orientation));

    PendingInput = DriverInput{};

    VehicleSolver::Hooks Hooks;
    Hooks.ReadChassis = [this]() -> ChassisState {
        return ReadChassisFromJolt();
    };
    Hooks.ApplyForceAtPoint = [this](const Vec3& ForceNewtons, const Vec3& WorldPoint) {
        if (BoundWorld != nullptr && ChassisIdentity != InvalidRigidBody)
        {
            BoundWorld->ApplyForceAtPoint(ChassisIdentity, ToPhysicsVector(ForceNewtons), ToPhysicsVector(WorldPoint));
        }
    };
    Hooks.ApplyTorque = [this](const Vec3& TorqueNewtonMetres) {
        if (BoundWorld != nullptr && ChassisIdentity != InvalidRigidBody)
        {
            BoundWorld->ApplyTorque(ChassisIdentity, ToPhysicsVector(TorqueNewtonMetres));
        }
    };
    Hooks.Ground = [this](const Vec3& Point, Vec3& OutSurface, Vec3& OutNormal) -> bool {
        return EvaluateGroundContact(Point, OutSurface, OutNormal);
    };

    DynamicsSolver.Build(SolverConfiguration, Hooks, ResolvedSpawnPose);
    LatestSnapshot.Telemetry         = DynamicsSolver.Telemetry();
    LatestSnapshot.Telemetry.Chassis = ResolvedSpawnPose;
    LatestSnapshot.StepCounter       = 0u;
    TyreBridge.Reset(LatestSnapshot.Telemetry);
    RefreshVisualMatrices();
}

ChassisState VehicleRigidBodyAssembly::ReadChassisFromJolt() const noexcept
{
    if (BoundWorld == nullptr || ChassisIdentity == InvalidRigidBody)
    {
        return ResolvedSpawnPose;
    }

    RigidBodyPose Pose{};
    if (!BoundWorld->QueryPose(ChassisIdentity, Pose))
    {
        return ResolvedSpawnPose;
    }

    return ChassisState{
        ToVehicleVector(Pose.Position),
        ToVehicleQuaternion(Pose.Orientation),
        ToVehicleVector(Pose.LinearVelocity),
        ToVehicleVector(Pose.AngularVelocity),
    };
}

bool VehicleRigidBodyAssembly::EvaluateGroundContact(
    const Vec3& ProbePoint,
    Vec3&       OutSurface,
    Vec3&       OutNormal) const noexcept
{
    if (AnalyticalGround)
    {
        return AnalyticalGround(ProbePoint, OutSurface, OutNormal);
    }

    if (ActiveSpecification.QueryJoltStaticGround && BoundWorld != nullptr && BoundWorld->Active())
    {
        const PhysicsVector3   RayOrigin{ProbePoint.x, ProbePoint.y, ProbePoint.z + 2.0f};
        const SceneCastReading Cast =
            BoundWorld->CastRay(RayOrigin, {0.0f, 0.0f, -1.0f}, 12.0f, ChassisIdentity);
        if (Cast.Contact)
        {
            OutSurface = ToVehicleVector(Cast.Position);
            OutNormal  = ToVehicleVector(Cast.Normal).Normalized();
            return OutNormal.LengthSq() > 0.25f;
        }
    }

    return false;
}

void VehicleRigidBodyAssembly::RefreshVisualMatrices() noexcept
{
    const ChassisState& Chassis = LatestSnapshot.Telemetry.Chassis;
    LatestSnapshot.ChassisWorld =
        ToPhysicsQuaternion(Chassis.Orientation).ToMatrix(ToPhysicsVector(Chassis.Position));

    for (size_t Corner = 0u; Corner < 4u; ++Corner)
    {
        const WheelTelemetry& Wheel = LatestSnapshot.Telemetry.Wheels[Corner];
        const Quat SpinRotation     = Quat::AxisAngle({0.0f, 1.0f, 0.0f}, Wheel.SpinAngle);
        const Quat WorldWheelQuat   = (Wheel.HubRotation * SpinRotation).Normalized();
        LatestSnapshot.WheelWorld[Corner] =
            ToPhysicsQuaternion(WorldWheelQuat).ToMatrix(ToPhysicsVector(Wheel.HubPosition));
    }
}

} // namespace Frontier::Vehicle
