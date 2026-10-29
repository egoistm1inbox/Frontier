//============================================================================================================================================
//                                                     VEHICLERIGIDBODYASSEMBLY.H
//============================================================================================================================================
// 🧩 Reusable Engine assembly binding VehicleSolver, VehicleSpawnSolver, and TyreVisualBridge onto a Jolt RigidBodySolver chassis.

#pragma once

#include "Engine/Foundation/Math.h"
#include "Engine/Physics/ProjectDrive/TyreVisualBridge.h"
#include "Engine/Physics/ProjectDrive/VehicleGeometry.h"
#include "Engine/Physics/ProjectDrive/VehicleSolver.h"
#include "Engine/Physics/ProjectDrive/VehicleSpawnSolver.h"
#include "Engine/Physics/RigidBodySolver.h"

#include <array>
#include <cstdint>
#include <string>

namespace Frontier::Vehicle
{

//------------------------------------------------------------------------------------------------------------------------
//                                                  CONVERSION FUNCTIONS
//------------------------------------------------------------------------------------------------------------------------

[[nodiscard]] inline PhysicsVector3 ToPhysicsVector(const Vec3& Vector) noexcept
{
    return {Vector.x, Vector.y, Vector.z};
}

[[nodiscard]] inline Vec3 ToVehicleVector(const PhysicsVector3& Vector) noexcept
{
    return {Vector.X, Vector.Y, Vector.Z};
}

[[nodiscard]] inline PhysicsQuaternion ToPhysicsQuaternion(const Quat& Rotation) noexcept
{
    return {Rotation.x, Rotation.y, Rotation.z, Rotation.w};
}

[[nodiscard]] inline Quat ToVehicleQuaternion(const PhysicsQuaternion& Rotation) noexcept
{
    return {Rotation.X, Rotation.Y, Rotation.Z, Rotation.W};
}

//------------------------------------------------------------------------------------------------------------------------
//                                                ASSEMBLY SPECIFICATION
//------------------------------------------------------------------------------------------------------------------------

struct VehicleRigidBodySpecification
{
    std::string        Name                   = "Vehicle.Chassis";          // [-]   - Diagnostic label in RigidBodySolver
    PhysicsVector3     ChassisHalfExtents     {1.72f, 0.90f, 0.25f};        // [m]   - Collision box within axle approach/departure span
    Vec3               RequestedPosition      {0.0f, 0.0f, 0.55f};          // [m]   - Requested world spawn location
    Quat               RequestedOrientation   {0.0f, 0.0f, 0.0f, 1.0f};     // [-]   - Requested world spawn orientation
    float              SpawnClearanceMetres   = 0.02f;                      // [m]   - Initial tyre-to-ground spawn margin
    float              LinearDamping          = 0.01f;                      // [1/s] - Residual Jolt linear damping (aero owns drag)
    float              AngularDamping         = 0.05f;                      // [1/s] - Residual Jolt angular damping
    float              ChassisFriction        = 0.45f;                      // [-]   - Body-shell collision friction
    float              ChassisRestitution     = 0.08f;                      // [-]   - Body-shell impact restitution
    bool               FitToTerrain           = true;                       // [-]   - Run ResolveVehicleSpawn before creation
    bool               QueryJoltStaticGround  = false;                      // [-]   - Fallback to Jolt CastRay when SurfaceQuery is empty
    bool               EnableBrakeThermals    = true;                       // [-]   - Enable GT3 disc thermals and ABS modulation
    bool               EnableTyreThermals     = true;                       // [-]   - Enable tyre carcass thermal + pressure model
    DemoTyreVisualMode VisualTyreMode         = DemoTyreVisualMode::Solid;  // [-]   - Visual carcass solver driven per step
};

struct VehicleVisualSnapshot
{
    Frontier::Mat4               ChassisWorld      = Mat4::Identity();   // [-] - World transform of sprung chassis CoM
    std::array<Frontier::Mat4, 4> WheelWorld       {
        Mat4::Identity(),
        Mat4::Identity(),
        Mat4::Identity(),
        Mat4::Identity(),
    };                                                                   // [-] - World transform of each wheel (hub + spin)
    VehicleTelemetry             Telemetry            {};                                           // [-]  - Full powertrain, suspension, and slip telemetry
    std::array<double, 4>        TyrePressuresPascals {220000.0, 220000.0, 220000.0, 220000.0};     // [Pa] - Per-corner gauge pressure fed to visual bridge
    uint64_t                     StepCounter          = 0u;                                         // [-]  - Fixed physics steps completed
};

//------------------------------------------------------------------------------------------------------------------------
//                                             VEHICLE RIGID BODY ASSEMBLY
//------------------------------------------------------------------------------------------------------------------------

class VehicleRigidBodyAssembly
{
  public:
    VehicleRigidBodyAssembly() noexcept = default;

    [[nodiscard]] bool Construct(
        RigidBodySolver&                     WorldSolver,
        const VehicleGeometry&               AuthoredGeometry,
        const VehicleRigidBodySpecification& Specification = {},
        GroundQuery                          SurfaceQuery  = {}) noexcept;

    void Retire() noexcept;

    void AssignInput(const DriverInput& Command) noexcept;

    // Steps tyre/suspension/drivetrain/aero forces onto the Jolt chassis; caller then steps WorldSolver (StepOnce or Advance)
    // and invokes SynchronizeAfterWorldStep(Δτ) so telemetry and visual tyre bridges reflect the post-integration chassis pose.
    void ApplyStepForces(float Δτ) noexcept;
    void SynchronizeAfterWorldStep(float Δτ) noexcept;

    // Convenience coupled fixed step when this vehicle is the sole stepper of WorldSolver:
    // ApplyStepForces(Δτ) -> WorldSolver.StepOnce() -> SynchronizeAfterWorldStep(Δτ).
    [[nodiscard]] bool StepCoupled(float Δτ) noexcept;

    void ResetToSpawn() noexcept;

    [[nodiscard]] bool                              Constructed() const noexcept { return AssemblyConstructed; }
    [[nodiscard]] RigidBodyIdentity                 ChassisBody() const noexcept { return ChassisIdentity; }
    [[nodiscard]] const VehicleSolverConfiguration& Configuration() const noexcept { return SolverConfiguration; }
    [[nodiscard]] const VehicleTelemetry&           Telemetry() const noexcept { return LatestSnapshot.Telemetry; }
    [[nodiscard]] const VehicleVisualSnapshot&      Snapshot() const noexcept { return LatestSnapshot; }
    [[nodiscard]] const ProjectDriveTyreVisualBridge& VisualTyres() const noexcept { return TyreBridge; }
    [[nodiscard]] const ChassisState&               SpawnPose() const noexcept { return ResolvedSpawnPose; }

  private:
    [[nodiscard]] ChassisState ReadChassisFromJolt() const noexcept;
    [[nodiscard]] bool         EvaluateGroundContact(const Vec3& ProbePoint, Vec3& OutSurface, Vec3& OutNormal) const noexcept;
    void                       RefreshVisualMatrices() noexcept;

    RigidBodySolver*              BoundWorld          = nullptr;
    RigidBodyIdentity             ChassisIdentity     = InvalidRigidBody;
    VehicleGeometry               Geometry            {};
    VehicleRigidBodySpecification ActiveSpecification {};
    VehicleSolverConfiguration    SolverConfiguration {};
    VehicleSolver                 DynamicsSolver      {};
    GroundQuery                   AnalyticalGround    {};
    ChassisState                  ResolvedSpawnPose   {};
    DriverInput                   PendingInput        {};
    ProjectDriveTyreVisualBridge  TyreBridge          {};
    VehicleVisualSnapshot         LatestSnapshot      {};
    bool                          AssemblyConstructed = false;
};

} // namespace Frontier::Vehicle
