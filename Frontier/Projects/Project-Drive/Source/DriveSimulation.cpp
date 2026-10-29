//============================================================================================================================================
//                                                          DRIVESIMULATION.CPP
//============================================================================================================================================
// 🧩 Project-Drive scenario implementation: Jolt proving ground, ControlVehicle assembly, possession, chase camera, and snapshots.

#include "DriveSimulation.h"

#include <algorithm>
#include <cmath>

namespace Frontier::Drive
{

bool DriveSimulation::Bring(const DriveDeploymentSpecification& Deployment) noexcept
{
    Retire();

    DeploymentConfig                  = Deployment;
    DeploymentConfig.PhysicsStepHertz = std::max(60.0, DeploymentConfig.PhysicsStepHertz);
    ConeBodies.fill(InvalidRigidBody);

    RigidBodyConfiguration WorldConfig;
    WorldConfig.Gravity               = {0.0f, 0.0f, -9.81f};
    WorldConfig.FixedStepSeconds      = static_cast<float>(1.0 / DeploymentConfig.PhysicsStepHertz);
    WorldConfig.MaxStepsPerAdvance    = std::max(1u, DeploymentConfig.MaxStepsPerTick);
    WorldConfig.CollisionStepsPerStep = 1u;
    if (!WorldSolver.Bring(WorldConfig))
    {
        return false;
    }

    constexpr uint32_t GridSamples = 128u;
    constexpr float    GridSpacing = 1.5f;
    constexpr float    OriginX     = -96.0f;
    constexpr float    OriginY     = 96.0f;
    BuildCourseHeightfieldSamples(GridSamples, OriginX, OriginY, GridSpacing, HeightfieldSamples);

    HeightfieldDescription TerrainDesc;
    TerrainDesc.Name        = "DriveCourse.Heightfield";
    TerrainDesc.Samples     = HeightfieldSamples.data();
    TerrainDesc.SampleCount = GridSamples;
    TerrainDesc.Origin      = {OriginX, OriginY, 0.0f};
    TerrainDesc.SpacingX    = GridSpacing;
    TerrainDesc.SpacingY    = GridSpacing;
    TerrainDesc.HeightScale = 1.0f;
    TerrainDesc.Friction    = 0.95f;
    TerrainDesc.Restitution = 0.0f;
    TerrainBody             = WorldSolver.CreateHeightfieldBody(TerrainDesc);
    if (TerrainBody == InvalidRigidBody)
    {
        WorldSolver.Retire();
        return false;
    }

    {
        const float          Near  = CourseConstants::RampNearX;
        const float          Far   = CourseConstants::RampNearX + CourseConstants::RampRunX;
        const float          Rise  = CourseConstants::RampRise;
        const float          Width = CourseConstants::RampHalfWidth;
        RigidBodyDescription RampDesc;
        RampDesc.Name              = "DriveCourse.Ramp";
        RampDesc.Motion            = RigidBodyMotionCategory::Static;
        RampDesc.Shape.Category    = CollisionShapeCategory::ConvexHull;
        RampDesc.Shape.HullPoints  = {
            {Near, -Width, 0.0f},
            {Near, Width, 0.0f},
            {Far, -Width, 0.0f},
            {Far, Width, 0.0f},
            {Far, -Width, Rise},
            {Far, Width, Rise},
        };
        RampDesc.Friction    = 0.95f;
        RampDesc.Restitution = 0.02f;
        RampBody             = WorldSolver.CreateBody(RampDesc);
    }

    {
        const float          HalfLengthX = 0.5f * (KerbConstants::FarX - KerbConstants::NearX);
        const float          CentreX     = 0.5f * (KerbConstants::FarX + KerbConstants::NearX);
        const float          HalfDepthY  = 0.5f * KerbConstants::Depth;
        const float          CentreY     = KerbConstants::CentreY + HalfDepthY;
        const float          HalfHeightZ = 0.5f * KerbConstants::Height;
        RigidBodyDescription KerbDesc;
        KerbDesc.Name              = "DriveCourse.Kerb";
        KerbDesc.Motion            = RigidBodyMotionCategory::Static;
        KerbDesc.Shape.Category    = CollisionShapeCategory::Box;
        KerbDesc.Shape.HalfExtents = {HalfLengthX, HalfDepthY, HalfHeightZ};
        KerbDesc.Position          = {CentreX, CentreY, HalfHeightZ};
        KerbDesc.Friction          = 0.85f;
        KerbDesc.Restitution       = 0.05f;
        KerbBody                   = WorldSolver.CreateBody(KerbDesc);
    }

    {
        RigidBodyDescription BarrierDesc;
        BarrierDesc.Name              = "DriveCourse.SafetyBarrier";
        BarrierDesc.Motion            = RigidBodyMotionCategory::Static;
        BarrierDesc.Shape.Category    = CollisionShapeCategory::Box;
        BarrierDesc.Shape.HalfExtents = {0.5f, CourseConstants::BarrierHalfY, CourseConstants::BarrierHalfZ};
        BarrierDesc.Position          = {CourseConstants::BarrierCentreX, 0.0f, CourseConstants::BarrierHalfZ};
        BarrierDesc.Friction          = 0.65f;
        BarrierDesc.Restitution       = 0.12f;
        BarrierBody                   = WorldSolver.CreateBody(BarrierDesc);
    }

    WorldSolver.OptimizeBroadPhase();

    for (int ConeIndex = 0; ConeIndex < CourseConstants::ConeCount; ++ConeIndex)
    {
        float ConeX = 0.0f;
        float ConeY = 0.0f;
        ConeBaseOrigin(ConeIndex, ConeX, ConeY);

        RigidBodyDescription ConeDesc;
        ConeDesc.Name                = "DriveCourse.SlalomCone";
        ConeDesc.Motion              = RigidBodyMotionCategory::Dynamic;
        ConeDesc.Shape.Category      = CollisionShapeCategory::Cylinder;
        ConeDesc.Shape.Radius        = CourseConstants::ConeRadius;
        ConeDesc.Shape.HalfHeight    = 0.5f * CourseConstants::ConeHeight;
        ConeDesc.Position            = {ConeX, ConeY, 0.5f * CourseConstants::ConeHeight + 0.005f};
        ConeDesc.MassKilograms       = CourseConstants::ConeMassKg;
        ConeDesc.Friction            = 0.70f;
        ConeDesc.Restitution         = 0.18f;
        ConeDesc.LinearDamping       = 0.15f;
        ConeDesc.AngularDamping      = 0.20f;
        ConeDesc.AllowSleeping       = true;
        ConeDesc.ContinuousCollision = true;
        ConeBodies[static_cast<size_t>(ConeIndex)] = WorldSolver.CreateBody(ConeDesc);
    }

    Vehicle::VehicleRigidBodySpecification VehicleSpec;
    VehicleSpec.Name                 = "ProjectDrive.ControlVehicle";
    VehicleSpec.RequestedPosition    = DeploymentConfig.SpawnPosition;
    VehicleSpec.RequestedOrientation = DeploymentConfig.SpawnOrientation;
    VehicleSpec.SpawnClearanceMetres = 0.02f;
    VehicleSpec.FitToTerrain         = true;
    VehicleSpec.EnableBrakeThermals  = true;
    VehicleSpec.EnableTyreThermals   = true;

    if (!ControlVehicle.Construct(WorldSolver, AuthoredGeometry, VehicleSpec, MakeCourseGroundQuery()))
    {
        WorldSolver.Retire();
        return false;
    }

    const Vehicle::ChassisState& SpawnChassis = ControlVehicle.SpawnPose();
    const Vehicle::Vec3          SpawnForward = SpawnChassis.Orientation.Rotate({1.0f, 0.0f, 0.0f});
    ChaseCamera.SnapTo(
        {SpawnChassis.Position.x, SpawnChassis.Position.y, SpawnChassis.Position.z},
        {SpawnForward.x, SpawnForward.y, SpawnForward.z});
    FreeFlightEye = ChaseCamera.QueryEyePosition();
    FreeFlightAim = ChaseCamera.QueryAimPosition();

    InputIntegrator.ReleaseControls();
    CommandChannel.Clear();
    SnapshotChannel.Clear();

    ActiveDirectInput  = {};
    DirectInputLatched = false;
    PendingRespawn     = false;
    PreviousEjectKey   = false;
    PreviousRespawnKey = false;
    VehiclePossessed   = true;
    StepAccumulator    = 0.0;
    SimulatedSeconds   = 0.0;
    FrameCounter       = 0u;
    SimulationActive   = true;

    CapturePublishedPayload(LatestPayload);
    return true;
}

void DriveSimulation::Retire() noexcept
{
    StopAsyncPhysics();
    ControlVehicle.Retire();
    WorldSolver.Retire();
    ConeBodies.fill(InvalidRigidBody);
    TerrainBody      = InvalidRigidBody;
    RampBody         = InvalidRigidBody;
    KerbBody         = InvalidRigidBody;
    BarrierBody      = InvalidRigidBody;
    SimulationActive = false;
}

bool DriveSimulation::StartAsyncPhysics() noexcept
{
    if (!SimulationActive || PhysicsWorker.Active())
    {
        return false;
    }

    CommandChannel.Clear();
    SnapshotChannel.Clear();
    CapturePublishedPayload(LatestPayload);
    SnapshotChannel.Publish(LatestPayload);

    VehiclePhysicsThreadConfiguration WorkerConfig;
    WorkerConfig.StepHertz       = DeploymentConfig.PhysicsStepHertz;
    WorkerConfig.MaxCatchUpSteps = 8u;
    WorkerConfig.PinBusyWait     = false;

    return PhysicsWorker.Start(WorkerConfig, [this](uint64_t /*StepIndex*/, float FixedDeltaSeconds) {
        WorkerCommand Incoming{};
        if (CommandChannel.Consume(Incoming))
        {
            if (Incoming.Respawn)
            {
                ResetCoursePropsAndVehicle();
            }
            ControlVehicle.AssignInput(Incoming.Drive);
        }
        ExecuteSinglePhysicsStep(FixedDeltaSeconds);

        PhysicsChannelPayload Outgoing{};
        CapturePublishedPayload(Outgoing);
        SnapshotChannel.Publish(Outgoing);
    });
}

void DriveSimulation::StopAsyncPhysics() noexcept
{
    if (PhysicsWorker.Active())
    {
        PhysicsWorker.Stop();
        PhysicsChannelPayload FinalPayload{};
        if (SnapshotChannel.Peek(FinalPayload))
        {
            ApplyPublishedPayload(FinalPayload);
        }
    }
}

void DriveSimulation::ForwardControls(const DriveControlReadings& Readings) noexcept
{
    if (Readings.KeyboardCaptured)
    {
        PreviousEjectKey   = Readings.EjectPressed;
        PreviousRespawnKey = Readings.RespawnPressed;
        return;
    }

    if (Readings.EjectPressed && !PreviousEjectKey)
    {
        TogglePossession();
    }
    PreviousEjectKey = Readings.EjectPressed;

    if (VehiclePossessed)
    {
        InputIntegrator.ForwardThrottleKey(Readings.ThrottleDown);
        InputIntegrator.ForwardBrakeKey(Readings.BrakeDown);
        InputIntegrator.ForwardSteerLeftKey(Readings.SteerLeftDown);
        InputIntegrator.ForwardSteerRightKey(Readings.SteerRightDown);
        InputIntegrator.ForwardHandbrakeKey(Readings.HandbrakeDown);
        if (Readings.RespawnPressed && !PreviousRespawnKey)
        {
            RequestRespawn();
        }
        DirectInputLatched = false;
    }
    else
    {
        InputIntegrator.ReleaseControls();
        ActiveDirectInput  = {};
        DirectInputLatched = false;
    }
    PreviousRespawnKey = Readings.RespawnPressed;
}

void DriveSimulation::ForwardDirectInput(const Vehicle::DriverInput& DirectCommand) noexcept
{
    if (!VehiclePossessed)
    {
        ActiveDirectInput  = {};
        DirectInputLatched = false;
        return;
    }
    ActiveDirectInput  = DirectCommand;
    DirectInputLatched = true;
}

void DriveSimulation::TogglePossession() noexcept
{
    VehiclePossessed = !VehiclePossessed;
    if (!VehiclePossessed)
    {
        InputIntegrator.ReleaseControls();
        ActiveDirectInput  = {};
        DirectInputLatched = false;
        FreeFlightEye      = ChaseCamera.QueryEyePosition();
        FreeFlightAim      = ChaseCamera.QueryAimPosition();

        if (PhysicsWorker.Active())
        {
            WorkerCommand CutCommand{};
            CommandChannel.Publish(CutCommand);
        }
    }
    else
    {
        const Vehicle::ChassisState& Chassis = LatestPayload.VehicleSnapshot.Telemetry.Chassis;
        const Vehicle::Vec3          Forward = Chassis.Orientation.Rotate({1.0f, 0.0f, 0.0f});
        ChaseCamera.SnapTo(
            {Chassis.Position.x, Chassis.Position.y, Chassis.Position.z},
            {Forward.x, Forward.y, Forward.z});
    }
}

void DriveSimulation::RequestRespawn() noexcept
{
    if (!VehiclePossessed)
    {
        return;
    }
    PendingRespawn = true;
}

void DriveSimulation::Advance(double Δτ) noexcept
{
    if (!SimulationActive || !(Δτ > 0.0))
    {
        return;
    }

    const float                  FrameDelta = static_cast<float>(Δτ);
    const Vehicle::DriverCommand Integrated = InputIntegrator.Advance(FrameDelta);

    Vehicle::DriverInput ResolvedDrive{};
    if (VehiclePossessed)
    {
        ResolvedDrive = DirectInputLatched ? ActiveDirectInput : Integrated.Drive;
    }

    const bool RespawnThisFrame = PendingRespawn || (VehiclePossessed && Integrated.ResetVehicle);
    PendingRespawn              = false;

    if (PhysicsWorker.Active())
    {
        WorkerCommand OutgoingCommand{};
        OutgoingCommand.Drive   = ResolvedDrive;
        OutgoingCommand.Respawn = RespawnThisFrame;
        CommandChannel.Publish(OutgoingCommand);

        PhysicsChannelPayload FreshPayload{};
        if (SnapshotChannel.Peek(FreshPayload))
        {
            ApplyPublishedPayload(FreshPayload);
        }
    }
    else
    {
        if (RespawnThisFrame)
        {
            ResetCoursePropsAndVehicle();
            ResolvedDrive = {};
        }
        ControlVehicle.AssignInput(ResolvedDrive);

        const double FixedStep = 1.0 / DeploymentConfig.PhysicsStepHertz;
        StepAccumulator += Δτ;
        const double MaxBacklog = FixedStep * static_cast<double>(std::max(1u, DeploymentConfig.MaxStepsPerTick));
        if (StepAccumulator > MaxBacklog)
        {
            StepAccumulator = MaxBacklog;
        }

        while (StepAccumulator >= FixedStep)
        {
            ExecuteSinglePhysicsStep(static_cast<float>(FixedStep));
            StepAccumulator -= FixedStep;
        }

        CapturePublishedPayload(LatestPayload);
    }

    const Vehicle::ChassisState& Chassis = LatestPayload.VehicleSnapshot.Telemetry.Chassis;
    const Vehicle::Vec3          Forward = Chassis.Orientation.Rotate({1.0f, 0.0f, 0.0f});
    if (VehiclePossessed)
    {
        if (RespawnThisFrame)
        {
            ChaseCamera.SnapTo(
                {Chassis.Position.x, Chassis.Position.y, Chassis.Position.z},
                {Forward.x, Forward.y, Forward.z});
        }
        else
        {
            ChaseCamera.AdvanceChase(
                {Chassis.Position.x, Chassis.Position.y, Chassis.Position.z},
                {Forward.x, Forward.y, Forward.z},
                LatestPayload.VehicleSnapshot.Telemetry.SpeedMetresPerSecond,
                FrameDelta);
        }
    }

    SimulatedSeconds += Δτ;
    ++FrameCounter;
}

DriveSnapshot DriveSimulation::TakeSnapshot(uint32_t ViewportWidth, uint32_t ViewportHeight) const noexcept
{
    DriveSnapshot Out;
    Out.ChassisWorld     = LatestPayload.VehicleSnapshot.ChassisWorld;
    Out.WheelWorld       = LatestPayload.VehicleSnapshot.WheelWorld;
    Out.ConePoses        = LatestPayload.ConePoses;
    Out.Telemetry        = LatestPayload.VehicleSnapshot.Telemetry;
    Out.Possessed        = VehiclePossessed;
    Out.FrameIndex       = FrameCounter;
    Out.PhysicsSteps     = LatestPayload.StepIndex;
    Out.SimulatedSeconds = SimulatedSeconds;

    uint32_t DisplacedCones = 0u;
    for (int ConeIndex = 0; ConeIndex < CourseConstants::ConeCount; ++ConeIndex)
    {
        const size_t         Slot = static_cast<size_t>(ConeIndex);
        const RigidBodyPose& Pose = LatestPayload.ConePoses[Slot];
        Out.ConeWorld[Slot]       = Pose.Orientation.ToMatrix(Pose.Position);

        float OriginX = 0.0f;
        float OriginY = 0.0f;
        ConeBaseOrigin(ConeIndex, OriginX, OriginY);
        const float         Dx     = Pose.Position.X - OriginX;
        const float         Dy     = Pose.Position.Y - OriginY;
        const PhysicsVector3 ConeUp = Pose.Orientation.Rotate({0.0f, 0.0f, 1.0f});
        if ((Dx * Dx + Dy * Dy) > (0.35f * 0.35f) || ConeUp.Z < 0.75f)
        {
            ++DisplacedCones;
        }
    }
    Out.DisplacedConeCount = DisplacedCones;

    if (VehiclePossessed)
    {
        Out.Camera = ChaseCamera.BuildReading(ViewportWidth, ViewportHeight);
    }
    else
    {
        const float Aspect = ViewportHeight > 0u
                               ? static_cast<float>(std::max(1u, ViewportWidth)) / static_cast<float>(ViewportHeight)
                               : (16.0f / 9.0f);
        Out.Camera.EyePosition        = FreeFlightEye;
        Out.Camera.AimPosition        = FreeFlightAim;
        Out.Camera.FieldOfViewDegrees = 60.0f;
        Out.Camera.ViewMatrix         = LookAtMatrix(FreeFlightEye, FreeFlightAim, {0.0f, 0.0f, 1.0f});
        Out.Camera.ProjectionMatrix   = PerspectiveMatrix(60.0f * (3.14159265358979323846f / 180.0f), Aspect, 0.15f, 1000.0f);
        Out.Camera.ViewProjection     = Out.Camera.ProjectionMatrix * Out.Camera.ViewMatrix;
    }

    return Out;
}

void DriveSimulation::ExecuteSinglePhysicsStep(float FixedDeltaSeconds) noexcept
{
    (void)ControlVehicle.StepCoupled(FixedDeltaSeconds);
}

void DriveSimulation::ResetCoursePropsAndVehicle() noexcept
{
    InputIntegrator.ReleaseControls();
    ActiveDirectInput  = {};
    DirectInputLatched = false;
    ControlVehicle.ResetToSpawn();
    for (int ConeIndex = 0; ConeIndex < CourseConstants::ConeCount; ++ConeIndex)
    {
        const RigidBodyIdentity Body = ConeBodies[static_cast<size_t>(ConeIndex)];
        if (Body != InvalidRigidBody)
        {
            float ConeX = 0.0f;
            float ConeY = 0.0f;
            ConeBaseOrigin(ConeIndex, ConeX, ConeY);
            WorldSolver.Teleport(
                Body,
                {ConeX, ConeY, 0.5f * CourseConstants::ConeHeight + 0.005f},
                PhysicsQuaternion::Identity());
        }
    }
}

void DriveSimulation::CapturePublishedPayload(PhysicsChannelPayload& OutPayload) const noexcept
{
    OutPayload.VehicleSnapshot = ControlVehicle.Snapshot();
    OutPayload.StepIndex       = WorldSolver.QueryMetrics().StepCount;
    for (size_t Slot = 0u; Slot < ConeBodies.size(); ++Slot)
    {
        RigidBodyPose Pose{};
        if (ConeBodies[Slot] != InvalidRigidBody && WorldSolver.QueryPose(ConeBodies[Slot], Pose))
        {
            OutPayload.ConePoses[Slot] = Pose;
        }
    }
}

void DriveSimulation::ApplyPublishedPayload(const PhysicsChannelPayload& Payload) noexcept
{
    LatestPayload = Payload;
}

} // namespace Frontier::Drive
