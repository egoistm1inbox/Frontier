//============================================================================================================================================
//                                                           DRIVESIMULATION.H
//============================================================================================================================================
// 🧩 Project-Drive scenario orchestrating the Jolt proving ground, ControlVehicle assembly, possession, chase camera, and snapshots.

#pragma once

#include "DriveCourse.h"

#include "Engine/Foundation/Math.h"
#include "Engine/Physics/ProjectDrive/ChaseCameraProjection.h"
#include "Engine/Physics/ProjectDrive/DriverInputIntegrator.h"
#include "Engine/Physics/ProjectDrive/VehicleRigidBodyAssembly.h"
#include "Engine/Physics/RigidBodySolver.h"
#include "Engine/Physics/VehiclePhysicsThread.h"

#include <array>
#include <cstdint>
#include <vector>

namespace Frontier::Drive
{

//------------------------------------------------------------------------------------------------------------------------
//                                               DEPLOYMENT & SNAPSHOT RECORDS
//------------------------------------------------------------------------------------------------------------------------

struct DriveDeploymentSpecification
{
    Vehicle::Vec3 SpawnPosition    {0.0f, 0.0f, 0.55f};          // [m]  - Authored [DeploymentPoint] position
    Vehicle::Quat SpawnOrientation {0.0f, 0.0f, 0.0f, 1.0f};     // [-]  - Authored [DeploymentPoint] rotation
    double        PhysicsStepHertz = 240.0;                      // [Hz] - Fixed Jolt + VehicleSolver step rate
    uint32_t      MaxStepsPerTick  = 16u;                        // [-]  - Synchronous step backlog guard per Advance()
};

struct DriveControlReadings
{
    bool ThrottleDown   = false;   // [-] - W key
    bool BrakeDown      = false;   // [-] - S key
    bool SteerLeftDown  = false;   // [-] - A key
    bool SteerRightDown = false;   // [-] - D key
    bool HandbrakeDown  = false;   // [-] - Space key
    bool RespawnPressed = false;   // [-] - R key pulse
    bool EjectPressed   = false;   // [-] - F8 edge pulse (possess / eject toggle)
    bool KeyboardCaptured = false; // [-] - True when modal/text input captures keys
};

struct DriveSnapshot
{
    Frontier::Mat4                                                ChassisWorld       = Mat4::Identity();
    std::array<Frontier::Mat4, 4>                                 WheelWorld         {
        Mat4::Identity(),
        Mat4::Identity(),
        Mat4::Identity(),
        Mat4::Identity(),
    };
    std::array<Frontier::Mat4, CourseConstants::ConeCount>        ConeWorld          {};
    std::array<RigidBodyPose, CourseConstants::ConeCount>         ConePoses          {};
    uint32_t                                                      DisplacedConeCount = 0u;      // [-] - Cones moved > 0.35 m or tipped
    Vehicle::ChaseCameraReading                                   Camera             {};
    Vehicle::VehicleTelemetry                                     Telemetry          {};
    bool                                                          Possessed          = true;    // [-] - False while ejected via F8
    uint64_t                                                      FrameIndex         = 0u;      // [frames]
    uint64_t                                                      PhysicsSteps       = 0u;      // [steps]
    double                                                        SimulatedSeconds   = 0.0;     // [s]
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    DRIVE SIMULATION
//------------------------------------------------------------------------------------------------------------------------

class DriveSimulation
{
  public:
    DriveSimulation() noexcept = default;
    ~DriveSimulation() noexcept
    {
        Retire();
    }

    DriveSimulation(const DriveSimulation&)            = delete;
    DriveSimulation& operator=(const DriveSimulation&) = delete;

    [[nodiscard]] bool Bring(const DriveDeploymentSpecification& Deployment = {}) noexcept;
    void               Retire() noexcept;

    [[nodiscard]] bool StartAsyncPhysics() noexcept;
    void               StopAsyncPhysics() noexcept;
    [[nodiscard]] bool AsyncPhysicsActive() const noexcept { return PhysicsWorker.Active(); }

    void ForwardControls(const DriveControlReadings& Readings) noexcept;
    void ForwardDirectInput(const Vehicle::DriverInput& DirectCommand) noexcept;
    void TogglePossession() noexcept;
    void RequestRespawn() noexcept;

    void Advance(double Δτ) noexcept;

    [[nodiscard]] DriveSnapshot                       TakeSnapshot(uint32_t ViewportWidth, uint32_t ViewportHeight) const noexcept;
    [[nodiscard]] bool                                Active() const noexcept { return SimulationActive; }
    [[nodiscard]] bool                                Possessed() const noexcept { return VehiclePossessed; }
    [[nodiscard]] const RigidBodySolver&              QueryWorld() const noexcept { return WorldSolver; }
    [[nodiscard]] const Vehicle::VehicleRigidBodyAssembly& QueryVehicle() const noexcept { return ControlVehicle; }
    [[nodiscard]] VehiclePhysicsThreadMetrics         QueryThreadMetrics() const noexcept { return PhysicsWorker.QueryMetrics(); }

  private:
    struct PhysicsChannelPayload
    {
        Vehicle::VehicleVisualSnapshot                        VehicleSnapshot {};
        std::array<RigidBodyPose, CourseConstants::ConeCount> ConePoses       {};
        uint64_t                                              StepIndex       = 0u;
    };

    struct WorkerCommand
    {
        Vehicle::DriverInput Drive   {};
        bool                 Respawn = false;
    };

    void ExecuteSinglePhysicsStep(float FixedDeltaSeconds) noexcept;
    void ResetCoursePropsAndVehicle() noexcept;
    void CapturePublishedPayload(PhysicsChannelPayload& OutPayload) const noexcept;
    void ApplyPublishedPayload(const PhysicsChannelPayload& Payload) noexcept;

    DriveDeploymentSpecification                          DeploymentConfig   {};
    std::vector<float>                                    HeightfieldSamples;
    RigidBodySolver                                       WorldSolver;
    RigidBodyIdentity                                     TerrainBody        = InvalidRigidBody;
    RigidBodyIdentity                                     RampBody           = InvalidRigidBody;
    RigidBodyIdentity                                     KerbBody           = InvalidRigidBody;
    RigidBodyIdentity                                     BarrierBody        = InvalidRigidBody;
    std::array<RigidBodyIdentity, CourseConstants::ConeCount> ConeBodies     {};

    Vehicle::VehicleGeometry                              AuthoredGeometry   {};
    Vehicle::VehicleRigidBodyAssembly                     ControlVehicle     {};
    Vehicle::DriverInputIntegrator                        InputIntegrator    {};
    Vehicle::ChaseCameraProjection                        ChaseCamera        {};
    Frontier::Vec3                                        FreeFlightEye      {-7.0f, 0.0f, 2.6f};
    Frontier::Vec3                                        FreeFlightAim      {0.0f, 0.0f, 0.8f};

    VehiclePhysicsThread                                  PhysicsWorker;
    PhysicsChannel<WorkerCommand>                         CommandChannel;
    PhysicsChannel<PhysicsChannelPayload>                 SnapshotChannel;

    PhysicsChannelPayload                                 LatestPayload      {};
    Vehicle::DriverInput                                  ActiveDirectInput  {};
    bool                                                  DirectInputLatched = false;
    bool                                                  PendingRespawn     = false;
    bool                                                  PreviousEjectKey   = false;
    bool                                                  PreviousRespawnKey = false;
    bool                                                  VehiclePossessed   = true;
    bool                                                  SimulationActive   = false;
    double                                                StepAccumulator    = 0.0;
    double                                                SimulatedSeconds   = 0.0;
    uint64_t                                              FrameCounter       = 0u;
};

} // namespace Frontier::Drive
