//============================================================================================================================================
//                                                   PROJECTDRIVEJOLTVALIDATION.CPP
//============================================================================================================================================
// 🧩 End-to-end validation of Engine RigidBodySolver (Jolt 5.6), VehicleRigidBodyAssembly, VehiclePhysicsThread, and Project-Drive.

#include "Engine/Physics/ProjectDrive/ChaseCameraProjection.h"
#include "Engine/Physics/ProjectDrive/DriverInputIntegrator.h"
#include "Engine/Physics/ProjectDrive/VehicleRigidBodyAssembly.h"
#include "Engine/Physics/ProjectDrive/VehicleSpawnSolver.h"
#include "Engine/Physics/RigidBodySolver.h"
#include "Engine/Physics/VehiclePhysicsThread.h"
#include "Projects/Project-Drive/Source/DriveCourse.h"
#include "Projects/Project-Drive/Source/DriveSimulation.h"

#include <ProjectInterchange.h>

#if !defined(_WIN32)
    #include <dlfcn.h>
#endif

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

namespace
{

int TotalChecks  = 0;
int FailedChecks = 0;

void RequireCondition(bool Condition, const char* Label, const char* Detail = "")
{
    ++TotalChecks;
    if (!Condition)
    {
        ++FailedChecks;
        std::fprintf(stderr, "[FAIL] %s %s\n", Label, Detail);
    }
}

bool FinitePose(const Frontier::Vehicle::ChassisState& Pose) noexcept
{
    return std::isfinite(Pose.Position.x) && std::isfinite(Pose.Position.y) && std::isfinite(Pose.Position.z) &&
           std::isfinite(Pose.Orientation.x) && std::isfinite(Pose.Orientation.y) &&
           std::isfinite(Pose.Orientation.z) && std::isfinite(Pose.Orientation.w) &&
           std::isfinite(Pose.LinearVelocity.x) && std::isfinite(Pose.LinearVelocity.y) &&
           std::isfinite(Pose.LinearVelocity.z) && std::isfinite(Pose.AngularVelocity.x) &&
           std::isfinite(Pose.AngularVelocity.y) && std::isfinite(Pose.AngularVelocity.z);
}

//------------------------------------------------------------------------------------------------------------------------
//                                           PHASE 1: JOLT RIGID BODY SOLVER
//------------------------------------------------------------------------------------------------------------------------

void ValidateRigidBodySolver()
{
    using namespace Frontier;

    const char* JoltVersion = RigidBodySolver::QueryJoltVersion();
    RequireCondition(std::strncmp(JoltVersion, "Jolt 5.6.", 9) == 0, "JoltVersion_5_6", JoltVersion);

    RigidBodyConfiguration Config;
    Config.Gravity          = {0.0f, 0.0f, -9.81f};
    Config.FixedStepSeconds = 1.0f / 240.0f;

    RigidBodySolver Solver;
    RequireCondition(Solver.Bring(Config), "RigidBodySolver_Bring");
    RequireCondition(Solver.Active() && Solver.Convert<bool>(), "RigidBodySolver_Active");

    // 1. Free-fall kinematics under exact gravity (LinearDamping = 0).
    RigidBodyDescription SphereDesc;
    SphereDesc.Name              = "Validation.FreeFallSphere";
    SphereDesc.Motion            = RigidBodyMotionCategory::Dynamic;
    SphereDesc.Shape.Category    = CollisionShapeCategory::Sphere;
    SphereDesc.Shape.Radius      = 0.25f;
    SphereDesc.Position          = {0.0f, 0.0f, 20.0f};
    SphereDesc.MassKilograms     = 10.0f;
    SphereDesc.LinearDamping     = 0.0f;
    SphereDesc.AngularDamping    = 0.0f;
    SphereDesc.AllowSleeping     = false;
    const RigidBodyIdentity Ball = Solver.CreateBody(SphereDesc);
    RequireCondition(Ball != InvalidRigidBody, "FreeFallSphere_Created");
    RequireCondition(std::fabs(Solver.QueryBodyMass(Ball) - 10.0f) < 1.0e-3f, "FreeFallSphere_Mass");

    for (int Step = 0; Step < 240; ++Step)
    {
        RequireCondition(Solver.StepOnce(), "FreeFallSphere_StepOnce");
    }

    RigidBodyPose BallPose{};
    RequireCondition(Solver.QueryPose(Ball, BallPose), "FreeFallSphere_QueryPose");
    const float ExpectedZ  = 20.0f - 0.5f * 9.81f * 1.0f;
    const float ExpectedVz = -9.81f;
    RequireCondition(std::fabs(BallPose.Position.Z - ExpectedZ) < 0.03f, "FreeFallSphere_PositionZ");
    RequireCondition(std::fabs(BallPose.LinearVelocity.Z - ExpectedVz) < 0.05f, "FreeFallSphere_VelocityZ");
    Solver.DestroyBody(Ball);

    // 2. +Z-up Heightfield creation + ray/sphere/cylinder sweeps.
    constexpr uint32_t SampleCount = 32u;
    std::vector<float> Grid(SampleCount * SampleCount, 0.0f);
    for (uint32_t Row = 0u; Row < SampleCount; ++Row)
    {
        for (uint32_t Column = 0u; Column < SampleCount; ++Column)
        {
            const float WorldX = -16.0f + static_cast<float>(Column) * 1.0f;
            Grid[Row * SampleCount + Column] = 0.10f * WorldX + 1.5f;
        }
    }

    HeightfieldDescription FieldDesc;
    FieldDesc.Name        = "Validation.SlopedHeightfield";
    FieldDesc.Samples     = Grid.data();
    FieldDesc.SampleCount = SampleCount;
    FieldDesc.Origin      = {-16.0f, 16.0f, 0.0f};
    FieldDesc.SpacingX    = 1.0f;
    FieldDesc.SpacingY    = 1.0f;
    FieldDesc.HeightScale = 1.0f;
    const RigidBodyIdentity Terrain = Solver.CreateHeightfieldBody(FieldDesc);
    RequireCondition(Terrain != InvalidRigidBody, "Heightfield_Created");
    Solver.OptimizeBroadPhase();

    const SceneCastReading RayHit = Solver.CastRay({4.0f, 0.0f, 10.0f}, {0.0f, 0.0f, -1.0f}, 20.0f);
    RequireCondition(RayHit.Contact && RayHit.Body == Terrain, "Heightfield_CastRay_Contact");
    RequireCondition(std::fabs(RayHit.Position.Z - 1.90f) < 0.03f, "Heightfield_CastRay_Elevation");
    RequireCondition(RayHit.Normal.Z > 0.98f && RayHit.Normal.X < -0.08f, "Heightfield_CastRay_Normal");

    const SceneCastReading SphereHit = Solver.CastSphere(0.30f, {0.0f, 0.0f, 5.0f}, {0.0f, 0.0f, -6.0f});
    RequireCondition(SphereHit.Contact && SphereHit.Body == Terrain, "Heightfield_CastSphere_Contact");

    const SceneCastReading CylinderHit =
        Solver.CastCylinder(0.35f, 0.20f, PhysicsQuaternion::Identity(), {2.0f, 0.0f, 5.0f}, {0.0f, 0.0f, -6.0f});
    RequireCondition(CylinderHit.Contact && CylinderHit.Body == Terrain, "Heightfield_CastCylinder_Contact");

    // 3. Explicit PrincipalInertia + ApplyForceAtPoint torque arm + DistanceSpring constraint.
    RigidBodyDescription BeamDesc;
    BeamDesc.Name               = "Validation.TorqueBody";
    BeamDesc.Motion             = RigidBodyMotionCategory::Dynamic;
    BeamDesc.Shape.Category     = CollisionShapeCategory::Box;
    BeamDesc.Shape.HalfExtents  = {1.0f, 0.5f, 0.25f};
    BeamDesc.Position           = {0.0f, 0.0f, 8.0f};
    BeamDesc.MassKilograms      = 100.0f;
    BeamDesc.PrincipalInertia   = {50.0f, 200.0f, 250.0f};
    BeamDesc.GravityFactor      = 0.0f;
    BeamDesc.LinearDamping      = 0.0f;
    BeamDesc.AngularDamping     = 0.0f;
    BeamDesc.AllowSleeping      = false;
    const RigidBodyIdentity Beam = Solver.CreateBody(BeamDesc);
    RequireCondition(Beam != InvalidRigidBody, "TorqueBody_Created");

    // Force +250 N along +Y at X = +1.0 m -> torque +250 N*m about +Z -> alpha_z = 250 / 250 = 1.0 rad/s^2.
    for (int Step = 0; Step < 240; ++Step)
    {
        Solver.ApplyForceAtPoint(Beam, {0.0f, 250.0f, 0.0f}, {1.0f, 0.0f, 8.0f});
        (void)Solver.StepOnce();
    }
    RigidBodyPose BeamPose{};
    RequireCondition(Solver.QueryPose(Beam, BeamPose), "TorqueBody_QueryPose");
    RequireCondition(BeamPose.AngularVelocity.Z > 0.85f && BeamPose.AngularVelocity.Z < 1.15f, "TorqueBody_PrincipalInertiaParity");

    RigidBodyDescription AnchorDesc;
    AnchorDesc.Name           = "Validation.SpringAnchor";
    AnchorDesc.Motion         = RigidBodyMotionCategory::Static;
    AnchorDesc.Shape.Category = CollisionShapeCategory::Sphere;
    AnchorDesc.Shape.Radius   = 0.1f;
    AnchorDesc.Position       = {0.0f, 0.0f, 12.0f};
    const RigidBodyIdentity Anchor = Solver.CreateBody(AnchorDesc);

    RigidBodyDescription BobDesc;
    BobDesc.Name           = "Validation.SpringBob";
    BobDesc.Motion         = RigidBodyMotionCategory::Dynamic;
    BobDesc.Shape.Category = CollisionShapeCategory::Sphere;
    BobDesc.Shape.Radius   = 0.2f;
    BobDesc.Position       = {0.0f, 0.0f, 9.5f};
    BobDesc.MassKilograms  = 20.0f;
    BobDesc.AllowSleeping  = false;
    const RigidBodyIdentity Bob = Solver.CreateBody(BobDesc);

    const ConstraintIdentity Spring =
        Solver.CreateDistanceSpring(Anchor, {0.0f, 0.0f, 12.0f}, Bob, {0.0f, 0.0f, 9.5f}, 1.5f, 2.0f, 3.0f, 0.5f);
    RequireCondition(Spring != InvalidConstraint, "DistanceSpring_Created");
    Solver.Advance(0.5f);
    RigidBodyPose BobPose{};
    RequireCondition(Solver.QueryPose(Bob, BobPose) && BobPose.Position.Z > 9.4f, "DistanceSpring_HoldsLoad");
    Solver.DestroyConstraint(Spring);

    std::printf(
        "PHASE_1_JOLT_RIGID_BODY_SOLVER version=\"%s\" freefall_z=%.4f heightfield_z=%.4f omega_z=%.4f spring_z=%.4f\n",
        JoltVersion,
        BallPose.Position.Z,
        RayHit.Position.Z,
        BeamPose.AngularVelocity.Z,
        BobPose.Position.Z);

    Solver.Retire();
    RequireCondition(!Solver.Active(), "RigidBodySolver_Retired");
}

//------------------------------------------------------------------------------------------------------------------------
//                                       PHASE 2: SPAWN SOLVER, INPUT & CAMERA
//------------------------------------------------------------------------------------------------------------------------

void ValidateSpawnInputAndCamera()
{
    using namespace Frontier::Vehicle;

    VehicleGeometry            Geometry;
    VehicleSolverConfiguration Configuration;
    ApplyGeometry(Configuration, Geometry);

    ChassisState Requested;
    Requested.Position       = {4.0f, 3.0f, 8.0f};
    Requested.LinearVelocity = {2.0f, -1.0f, 0.5f};

    float MinClearanceObserved = 1.0e9f;
    for (float Slope : {0.0f, 0.20f, -0.35f})
    {
        for (float Yaw : {0.0f, 0.7f, 2.1f, 3.14f, 4.3f, 5.9f})
        {
            Requested.Orientation   = {0.0f, 0.0f, std::sin(0.5f * Yaw), std::cos(0.5f * Yaw)};
            const Vec3  PlaneNormal = Vec3{-Slope, -0.13f, 1.0f}.Normalized();
            GroundQuery Ground      = [=](const Vec3& Point, Vec3& OutSurface, Vec3& OutNormal) {
                OutSurface = {Point.x, Point.y, 2.0f + Slope * Point.x + 0.13f * Point.y};
                OutNormal  = PlaneNormal;
                return true;
            };

            const VehicleSpawnReading Spawn = ResolveVehicleSpawn(Configuration, Requested, Ground, 0.02f);
            RequireCondition(Spawn.Supported && Spawn.GroundContacts == 4u, "SpawnSolver_SupportedSlope");
            RequireCondition(Spawn.Pose.LinearVelocity.LengthSq() == 0.0f, "SpawnSolver_ZeroVelocity");
            RequireCondition(Dot(Spawn.Pose.Orientation.Rotate({0.0f, 0.0f, 1.0f}), PlaneNormal) > 0.9999f, "SpawnSolver_NormalAlign");

            for (uint32_t Wheel = 0u; Wheel < 4u; ++Wheel)
            {
                const WheelMount&              Mount  = Configuration.Wheels[Wheel];
                const SuspensionSpecification& Strut  = Wheel < 2u ? Configuration.FrontStrut : Configuration.RearStrut;
                const float                    Mirror = Mount.LocalOffset.y < 0.0f ? -1.0f : 1.0f;
                const Vec3 LocalHub                   = Mount.SuspensionMount +
                                      Vec3{Strut.AxisX, Strut.AxisY * Mirror, Strut.AxisZ} *
                                          (Strut.FreeLength - Strut.StaticCompression);
                const Vec3 HubWorld = Spawn.Pose.Position + Spawn.Pose.Orientation.Rotate(LocalHub);
                Vec3       Surface{};
                Vec3       Normal{};
                (void)Ground(HubWorld, Surface, Normal);
                const float AxleDot = std::abs(Dot(Spawn.Pose.Orientation.Rotate({0.0f, 1.0f, 0.0f}), Normal));
                const float Support = Configuration.Tyre.Radius * std::sqrt(std::max(0.0f, 1.0f - AxleDot * AxleDot)) +
                                      Configuration.Tyre.Width * 0.5f * AxleDot;
                const float Clearance = Dot(HubWorld - Surface, Normal) - Support;
                MinClearanceObserved  = std::min(MinClearanceObserved, Clearance);
            }
        }
    }
    RequireCondition(MinClearanceObserved >= 0.01995f, "SpawnSolver_20mmClearance");
    RequireCondition(!ResolveVehicleSpawn(Configuration, Requested, {}).Supported, "SpawnSolver_RejectEmptyGround");

    DriverInputIntegrator Input;
    Input.ForwardThrottleKey(true);
    Input.ForwardSteerLeftKey(true);
    DriverCommand StepCommand = Input.Advance(0.20f);
    RequireCondition(StepCommand.Drive.Throttle > 0.5f && StepCommand.Drive.Steer > 0.4f, "InputIntegrator_DigitalRamp");
    Input.ReleaseControls();
    StepCommand = Input.Advance(0.01f);
    RequireCondition(StepCommand.Drive.Throttle == 0.0f && StepCommand.Drive.Steer == 0.0f, "InputIntegrator_ReleaseControls");

    ChaseCameraProjection Camera;
    Camera.SnapTo({0.0f, 0.0f, 0.53f}, {1.0f, 0.0f, 0.0f});
    Camera.AdvanceChase({12.0f, 0.0f, 0.53f}, {1.0f, 0.0f, 0.0f}, 45.0f, 0.25f);
    const ChaseCameraReading Reading = Camera.BuildReading(1920u, 1080u);
    RequireCondition(Reading.FieldOfViewDegrees > 66.0f && Reading.EyePosition.X > -7.0f, "ChaseCamera_SpeedFovAndSpring");
    RequireCondition(std::isfinite(Reading.ViewProjection.Columns[0][0]) && Reading.ProjectionMatrix.Columns[1][1] < 0.0f,
                     "ChaseCamera_VulkanClipMatrix");

    std::printf(
        "PHASE_2_SPAWN_INPUT_CAMERA min_clearance_m=%.5f fov_deg=%.2f eye_x=%.3f\n",
        MinClearanceObserved,
        Reading.FieldOfViewDegrees,
        Reading.EyePosition.X);
}

//------------------------------------------------------------------------------------------------------------------------
//                                  PHASE 3: JOLT VEHICLE + PROJECT-DRIVE PROVING GROUND
//------------------------------------------------------------------------------------------------------------------------

void ValidateJoltVehicleAndDriveCourse()
{
    using namespace Frontier;
    using namespace Frontier::Drive;

    // 3A. Rest equilibrium on Jolt proving ground (2.0 s, 480 steps at 240 Hz).
    {
        DriveSimulation Simulation;
        RequireCondition(Simulation.Bring(), "DriveSimulation_Bring_Rest");

        const DriveSnapshot Initial = Simulation.TakeSnapshot(1280u, 720u);
        for (int Frame = 0; Frame < 120; ++Frame)
        {
            Simulation.Advance(1.0 / 60.0);
        }
        const DriveSnapshot Settled = Simulation.TakeSnapshot(1280u, 720u);
        RequireCondition(FinitePose(Settled.Telemetry.Chassis), "DriveSimulation_RestFinite");
        RequireCondition(Settled.Telemetry.WheelsInContact == 4u, "DriveSimulation_RestFourWheelContact");
        const float HorizontalDrift = std::hypot(
            Settled.Telemetry.Chassis.Position.x - Initial.Telemetry.Chassis.Position.x,
            Settled.Telemetry.Chassis.Position.y - Initial.Telemetry.Chassis.Position.y);
        RequireCondition(HorizontalDrift < 0.05f, "DriveSimulation_RestHorizontalStability");
        RequireCondition(Settled.Telemetry.SpeedMetresPerSecond < 0.05f, "DriveSimulation_RestStationary");
        RequireCondition(Settled.Telemetry.TotalVerticalLoad > 9500.0f && Settled.Telemetry.TotalVerticalLoad < 15500.0f,
                         "DriveSimulation_RestVerticalLoad");
        std::printf(
            "PHASE_3A_REST_EQUILIBRIUM drift_m=%.5f speed_mps=%.5f load_N=%.1f com_z=%.4f\n",
            HorizontalDrift,
            Settled.Telemetry.SpeedMetresPerSecond,
            Settled.Telemetry.TotalVerticalLoad,
            Settled.Telemetry.Chassis.Position.z);
    }

    // 3B. Straight-line acceleration, AMT upshift, aero downforce, tyre carcass deformation & ABS braking on flat lane.
    {
        DriveDeploymentSpecification FlatLane;
        FlatLane.SpawnPosition = {-45.0f, -6.5f, 0.55f};   // Clear of ramp (|Y| <= 3.2) and kerb (Y >= 3.2)

        DriveSimulation Simulation;
        RequireCondition(Simulation.Bring(FlatLane), "DriveSimulation_Bring_AccelBrake");

        Vehicle::DriverInput FullThrottle{};
        FullThrottle.Throttle = 1.0f;
        Simulation.ForwardDirectInput(FullThrottle);
        for (int Frame = 0; Frame < 312; ++Frame)   // 5.2 s -> crosses 1st-gear 6800 rpm upshift with 0.50855 m tyres
        {
            Simulation.Advance(1.0 / 60.0);
        }

        const DriveSnapshot PeakSpeed = Simulation.TakeSnapshot(1280u, 720u);
        const double        SolidForce =
            Simulation.QueryVehicle().VisualTyres().Solid(2).QueryVerticalForce();
        const int           SolidContacts =
            Simulation.QueryVehicle().VisualTyres().Solid(2).QueryContactCount();
        RequireCondition(FinitePose(PeakSpeed.Telemetry.Chassis), "Accel_Finite");
        RequireCondition(PeakSpeed.Telemetry.ForwardSpeed > 24.0f, "Accel_ReachesHighSpeed");
        RequireCondition(PeakSpeed.Telemetry.GearIndex > 3, "Accel_AutoUpshift");
        RequireCondition(PeakSpeed.Telemetry.Wheels[0].AeroDownforce > 5.0f, "Accel_AeroDownforcePositive");
        RequireCondition(SolidForce > 100.0 && SolidContacts > 0, "Accel_TyreContinuumSolidActive");

        // Full foot brake with GT3 disc thermals + ABS.
        Vehicle::DriverInput FullBrake{};
        FullBrake.Brake = 1.0f;
        Simulation.ForwardDirectInput(FullBrake);
        bool AbsTriggered = false;
        for (int Frame = 0; Frame < 180; ++Frame)   // 3.0 s
        {
            Simulation.Advance(1.0 / 60.0);
            const DriveSnapshot StepSnap = Simulation.TakeSnapshot(1280u, 720u);
            for (uint32_t Wheel = 0u; Wheel < 4u; ++Wheel)
            {
                if (StepSnap.Telemetry.Wheels[Wheel].AbsActive)
                {
                    AbsTriggered = true;
                }
            }
        }
        const DriveSnapshot Braked = Simulation.TakeSnapshot(1280u, 720u);
        RequireCondition(Braked.Telemetry.ForwardSpeed < PeakSpeed.Telemetry.ForwardSpeed * 0.25f, "Brake_DeceleratesStrongly");
        RequireCondition(Braked.Telemetry.Wheels[0].BrakeTemp_K > 315.0f, "Brake_DiscThermalRise");

        std::printf(
            "PHASE_3B_ACCEL_BRAKE peak_mps=%.2f gear=%d aero_fl_N=%.1f tyre_solid_N=%.1f braked_mps=%.2f disc_K=%.1f abs=%d\n",
            PeakSpeed.Telemetry.ForwardSpeed,
            PeakSpeed.Telemetry.GearIndex,
            PeakSpeed.Telemetry.Wheels[0].AeroDownforce,
            SolidForce,
            Braked.Telemetry.ForwardSpeed,
            Braked.Telemetry.Wheels[0].BrakeTemp_K,
            AbsTriggered ? 1 : 0);
    }

    // 3C. Ramp launch, airborne phase, landing recovery, dynamic Jolt slalom cone collisions, and R respawn.
    {
        DriveDeploymentSpecification RampRun;
        RampRun.SpawnPosition = {-8.0f, 0.0f, 0.55f};

        DriveSimulation Simulation;
        RequireCondition(Simulation.Bring(RampRun), "DriveSimulation_Bring_RampAndCones");

        float    PeakChassisZ       = 0.0f;
        uint32_t MinWheelsInContact = 4u;
        bool     ReachedRampCrest   = false;

        Vehicle::DriverInput LaunchCommand{};
        LaunchCommand.Throttle = 1.0f;
        Simulation.ForwardDirectInput(LaunchCommand);

        for (int Frame = 0; Frame < 300; ++Frame)   // 5.0 s: climb ramp, launch airborne, land straight ahead & settle
        {
            const DriveSnapshot PreStep = Simulation.TakeSnapshot(1280u, 720u);
            if (PreStep.Telemetry.Chassis.Position.x > 15.0f)
            {
                Simulation.ForwardDirectInput(Vehicle::DriverInput{});
            }
            Simulation.Advance(1.0 / 60.0);
            const DriveSnapshot Snap = Simulation.TakeSnapshot(1280u, 720u);
            PeakChassisZ             = std::max(PeakChassisZ, Snap.Telemetry.Chassis.Position.z);
            if (Snap.Telemetry.Chassis.Position.x > 14.5f)
            {
                ReachedRampCrest   = true;
                MinWheelsInContact = std::min(MinWheelsInContact, Snap.Telemetry.WheelsInContact);
            }
        }

        const DriveSnapshot Landed = Simulation.TakeSnapshot(1280u, 720u);
        const Vehicle::Vec3 UpAxis = Landed.Telemetry.Chassis.Orientation.Rotate({0.0f, 0.0f, 1.0f});
        RequireCondition(FinitePose(Landed.Telemetry.Chassis), "RampJump_Finite");
        RequireCondition(ReachedRampCrest && PeakChassisZ > 1.65f, "RampJump_ClimbsCrest");
        RequireCondition(MinWheelsInContact == 0u, "RampJump_GoesAirborne");
        RequireCondition(Landed.Telemetry.WheelsInContact >= 3u && UpAxis.z > 0.85f, "RampJump_LandsUpright");

        // Verify lateral kerb vertical-wall normal query directly + dynamic Jolt slalom cone collision + Respawn.
        float SurfX = 0.0f, SurfY = 0.0f, SurfZ = 0.0f, NormX = 0.0f, NormY = 0.0f, NormZ = 0.0f;
        SampleCourseSurface(5.0f, 3.16f, 0.06f, SurfX, SurfY, SurfZ, NormX, NormY, NormZ);
        RequireCondition(NormY < -0.90f && std::fabs(SurfY - KerbConstants::CentreY) < 1.0e-3f, "Kerb_VerticalInnerWallNormal");

        uint32_t ConeTriangleCount = 0u;
        CollectCourseTriangles([&](float, float, float, float, float, float, float, float, float, uint32_t MaterialSlot) {
            if (MaterialSlot == MatCone)
            {
                ++ConeTriangleCount;
            }
        });
        RequireCondition(ConeTriangleCount == static_cast<uint32_t>(CourseConstants::ConeCount * 14 * 2),
                         "CourseTriangles_SlalomConesEmitted");

        // Spawn on the flat pad at {30.0, 2.4} directly in front of dynamic Jolt Cone 4 (X=38, Y=+2.4) & Cone 6 (X=48, Y=+2.4).
        DriveDeploymentSpecification ConeRun;
        ConeRun.SpawnPosition = {30.0f, 2.4f, 0.55f};
        DriveSimulation ConeSim;
        RequireCondition(ConeSim.Bring(ConeRun), "DriveSimulation_Bring_ConeImpact");
        Vehicle::DriverInput ConeDrive{};
        ConeDrive.Throttle = 1.0f;
        ConeSim.ForwardDirectInput(ConeDrive);
        for (int Frame = 0; Frame < 120; ++Frame)
        {
            ConeSim.Advance(1.0 / 60.0);
        }
        const DriveSnapshot AfterConeImpact = ConeSim.TakeSnapshot(1280u, 720u);
        RequireCondition(AfterConeImpact.DisplacedConeCount >= 1u, "SlalomCones_DynamicJoltImpact");

        // Press R (RequestRespawn) -> resets both ControlVehicle and all 8 Jolt cones, then settles onto struts!
        ConeSim.RequestRespawn();
        for (int SettleFrame = 0; SettleFrame < 30; ++SettleFrame)
        {
            ConeSim.Advance(1.0 / 60.0);
        }
        const DriveSnapshot AfterRespawn = ConeSim.TakeSnapshot(1280u, 720u);
        RequireCondition(AfterRespawn.DisplacedConeCount == 0u, "Respawn_RestoresDynamicCones");
        RequireCondition(std::fabs(AfterRespawn.Telemetry.Chassis.Position.x - 30.0f) < 0.05f &&
                             AfterRespawn.Telemetry.SpeedMetresPerSecond < 0.05f,
                         "Respawn_RestoresVehicleToDeploymentPoint");

        std::printf(
            "PHASE_3C_RAMP_KERB_CONES peak_z=%.3f min_air_contacts=%u land_x=%.2f land_contacts=%u land_up_z=%.3f displaced_cones=%u post_respawn_cones=%u\n",
            PeakChassisZ,
            MinWheelsInContact,
            Landed.Telemetry.Chassis.Position.x,
            Landed.Telemetry.WheelsInContact,
            UpAxis.z,
            AfterConeImpact.DisplacedConeCount,
            AfterRespawn.DisplacedConeCount);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                              PHASE 4: ASYNC PHYSICS THREAD, F8 POSSESSION & CODE IMAGE ABI
//------------------------------------------------------------------------------------------------------------------------

struct RecordedDiagnostics
{
    uint32_t    Count = 0u;
    std::string FirstMessage;
    std::string LastMessage;
};

void FRONTIER_CODE_IMAGE_CALL OnHostDiagnostic(const FrontierProjectDiagnostic* Diagnostic, void* Reception)
{
    if (Diagnostic == nullptr || Reception == nullptr)
    {
        return;
    }
    auto* Sink = static_cast<RecordedDiagnostics*>(Reception);
    ++Sink->Count;
    if (Diagnostic->Explanation != nullptr)
    {
        if (Sink->FirstMessage.empty())
        {
            Sink->FirstMessage = Diagnostic->Explanation;
        }
        Sink->LastMessage = Diagnostic->Explanation;
    }
}

void ValidateAsyncThreadAndCodeImage(const char* CodeImagePath)
{
    using namespace Frontier::Drive;

    // 4A. Live 240 Hz VehiclePhysicsThread + F8 eject/repossess.
    {
        DriveDeploymentSpecification AsyncSpec;
        AsyncSpec.SpawnPosition = {-30.0f, -6.5f, 0.55f};

        DriveSimulation Simulation;
        RequireCondition(Simulation.Bring(AsyncSpec), "Async_Bring");
        RequireCondition(Simulation.StartAsyncPhysics() && Simulation.AsyncPhysicsActive(), "Async_ThreadStarted");

        DriveControlReadings HeldThrottle{};
        HeldThrottle.ThrottleDown = true;
        Simulation.ForwardControls(HeldThrottle);

        for (int Tick = 0; Tick < 12; ++Tick)
        {
            Simulation.Advance(1.0 / 60.0);
            std::this_thread::sleep_for(std::chrono::milliseconds(15));
        }
        Simulation.Advance(1.0 / 60.0);

        const Frontier::VehiclePhysicsThreadMetrics Metrics = Simulation.QueryThreadMetrics();
        const DriveSnapshot                         Driving = Simulation.TakeSnapshot(1280u, 720u);
        RequireCondition(Metrics.StepCount >= 15u, "Async_StepsExecuted");
        RequireCondition(Driving.Telemetry.ForwardSpeed > 0.5f, "Async_VehicleAccelerated");

        // F8 eject while W is still held: driving input cuts immediately and FreeFlightEye stays fixed while car coasts.
        DriveControlReadings EjectEdge = HeldThrottle;
        EjectEdge.EjectPressed         = true;
        Simulation.ForwardControls(EjectEdge);
        RequireCondition(!Simulation.Possessed(), "Possession_EjectedOnF8");

        // Holding F8 must not re-toggle.
        Simulation.ForwardControls(EjectEdge);
        RequireCondition(!Simulation.Possessed(), "Possession_HeldF8NoRepeat");

        const Frontier::Vec3 EjectedEye = Simulation.TakeSnapshot(1280u, 720u).Camera.EyePosition;
        std::this_thread::sleep_for(std::chrono::milliseconds(40));
        Simulation.Advance(1.0 / 60.0);
        const DriveSnapshot Coasting = Simulation.TakeSnapshot(1280u, 720u);
        RequireCondition(std::fabs(Coasting.Camera.EyePosition.X - EjectedEye.X) < 1.0e-4f, "Possession_FreeFlightCameraHeld");
        RequireCondition(Coasting.Telemetry.Chassis.Position.x > Driving.Telemetry.Chassis.Position.x,
                         "Possession_SimulationContinuesWhileEjected");

        // Release and press F8 again -> repossess!
        DriveControlReadings Released{};
        Simulation.ForwardControls(Released);
        DriveControlReadings RepossessEdge{};
        RepossessEdge.EjectPressed = true;
        Simulation.ForwardControls(RepossessEdge);
        RequireCondition(Simulation.Possessed(), "Possession_RepossessedOnSecondF8");

        Simulation.StopAsyncPhysics();
        RequireCondition(!Simulation.AsyncPhysicsActive(), "Async_ThreadStoppedCleanly");

        std::printf(
            "PHASE_4A_ASYNC_AND_POSSESSION async_steps=%llu speed_mps=%.2f coast_dx=%.3f\n",
            static_cast<unsigned long long>(Metrics.StepCount),
            Driving.Telemetry.ForwardSpeed,
            Coasting.Telemetry.Chassis.Position.x - Driving.Telemetry.Chassis.Position.x);
    }

#if !defined(_WIN32)
    // 4B. Dynamic dlopen negotiation of compiled ProjectDrive.dll v3 code image.
    RequireCondition(CodeImagePath != nullptr && CodeImagePath[0] != '\0', "CodeImage_PathProvided");
    if (CodeImagePath != nullptr && CodeImagePath[0] != '\0')
    {
        void* Module = dlopen(CodeImagePath, RTLD_NOW | RTLD_LOCAL);
        RequireCondition(Module != nullptr, "CodeImage_Dlopen", Module == nullptr ? dlerror() : "");
        if (Module != nullptr)
        {
            using NegotiateFn = bool (*)(uint32_t, uint64_t, FrontierProjectInterchange*, char*, size_t);
            void* RawSymbol   = dlsym(Module, "ConstructProjectInterchange");
            RequireCondition(RawSymbol != nullptr, "CodeImage_SymbolResolved");

            NegotiateFn Negotiate = nullptr;
            std::memcpy(&Negotiate, &RawSymbol, sizeof(Negotiate));

            FrontierProjectInterchange Table{};
            Table.StructureSize = sizeof(Table);
            char Refusal[256]   = {};

            RequireCondition(
                !Negotiate(99u, FRONTIER_INTERFACE_FINGERPRINT, &Table, Refusal, sizeof(Refusal)),
                "CodeImage_RefusesWrongVersion");
            RequireCondition(
                !Negotiate(FRONTIER_CODE_INTERCHANGE_NUMBER, 0xdeadbeefULL, &Table, Refusal, sizeof(Refusal)),
                "CodeImage_RefusesWrongFingerprint");
            RequireCondition(
                Negotiate(FRONTIER_CODE_INTERCHANGE_NUMBER, FRONTIER_INTERFACE_FINGERPRINT, &Table, Refusal, sizeof(Refusal)),
                "CodeImage_NegotiatesV3");

            RecordedDiagnostics     Diagnostics{};
            FrontierHostInterchange HostTable{};
            HostTable.StructureSize     = sizeof(HostTable);
            HostTable.ReceiveDiagnostic = &OnHostDiagnostic;
            HostTable.ProjectReception  = &Diagnostics;

            RequireCondition(Table.ConstructProject(&HostTable, &Diagnostics), "CodeImage_ConstructProject");
            for (int Tick = 0; Tick < 60; ++Tick)
            {
                Table.AdvanceProject();
            }
            Table.RetireProject();

            RequireCondition(Diagnostics.Count >= 3u, "CodeImage_DiagnosticsEmitted");
            RequireCondition(Diagnostics.FirstMessage.find("Jolt 5.6.") != std::string::npos,
                             "CodeImage_ReportsJolt56",
                             Diagnostics.FirstMessage.c_str());

            std::printf(
                "PHASE_4B_CODE_IMAGE diagnostics=%u construct_msg=\"%s\"\n",
                Diagnostics.Count,
                Diagnostics.FirstMessage.c_str());

            dlclose(Module);
        }
    }
#else
    (void)CodeImagePath;
#endif
}

} // namespace

int main(int ArgumentCount, char** Arguments)
{
    const char* CodeImagePath = ArgumentCount > 1 ? Arguments[1] : "";

    ValidateRigidBodySolver();
    ValidateSpawnInputAndCamera();
    ValidateJoltVehicleAndDriveCourse();
    ValidateAsyncThreadAndCodeImage(CodeImagePath);

    std::printf(
        "PROJECT_DRIVE_JOLT_SUMMARY checks=%d failed=%d status=%s\n",
        TotalChecks,
        FailedChecks,
        FailedChecks == 0 ? "PASS" : "FAIL");
    return FailedChecks == 0 ? 0 : 1;
}
