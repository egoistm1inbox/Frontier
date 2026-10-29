//============================================================================================================================================
//                                                      CHASECAMERAPROJECTION.H
//============================================================================================================================================
// 🧩 Critically damped vehicle follow camera projection producing +Z-up world eye/aim coordinates and Vulkan clip matrices.

#pragma once

#include "Engine/Foundation/Math.h"

#include <cstdint>

namespace Frontier::Vehicle
{

struct ChaseCameraConfiguration
{
    float FollowDistance   = 7.0f;     // [m]   - Trailing offset behind chassis origin along forward axis
    float FollowHeight     = 2.6f;     // [m]   - Vertical elevation above chassis origin
    float LookAtHeight     = 0.8f;     // [m]   - Aim offset above chassis origin
    float PositionSpring   = 6.0f;     // [1/s] - Exponential chase follow rate
    float BaseFieldOfView  = 60.0f;    // [deg] - Vertical field of view at rest
    float SpeedFieldOfView = 12.0f;    // [deg] - Additional vertical field of view at full speed
    float SpeedForFullFov  = 60.0f;    // [m/s] - Speed at which full FOV widening is reached
    float NearClip         = 0.15f;    // [m]   - Perspective near plane
    float FarClip          = 1000.0f;  // [m]   - Perspective far plane
};

struct ChaseCameraReading
{
    Frontier::Vec3 EyePosition        {};                  // [m]   - World-space camera eye location
    Frontier::Vec3 AimPosition        {};                  // [m]   - World-space camera aim target
    float          FieldOfViewDegrees = 60.0f;             // [deg] - Resolved vertical field of view
    Frontier::Mat4 ViewMatrix         = Mat4::Identity();  // [-]   - Right-handed world-to-view matrix
    Frontier::Mat4 ProjectionMatrix   = Mat4::Identity();  // [-]   - Vulkan [0,1] Y-down clip matrix
    Frontier::Mat4 ViewProjection     = Mat4::Identity();  // [-]   - Combined ProjectionMatrix * ViewMatrix
};

class ChaseCameraProjection
{
  public:
    ChaseCameraProjection() noexcept = default;
    explicit ChaseCameraProjection(const ChaseCameraConfiguration& InitialConfiguration) noexcept;

    void AssignConfiguration(const ChaseCameraConfiguration& RequestedConfiguration) noexcept
    {
        ActiveConfiguration = RequestedConfiguration;
    }

    [[nodiscard]] const ChaseCameraConfiguration& QueryConfiguration() const noexcept
    {
        return ActiveConfiguration;
    }

    void SnapTo(Frontier::Vec3 TargetPosition, Frontier::Vec3 TargetForward) noexcept;

    void AdvanceChase(
        Frontier::Vec3 TargetPosition,
        Frontier::Vec3 TargetForward,
        float          SpeedMetresPerSecond,
        float          Δτ) noexcept;

    [[nodiscard]] ChaseCameraReading BuildReading(uint32_t ViewportWidth, uint32_t ViewportHeight) const noexcept;

    [[nodiscard]] Frontier::Vec3 QueryEyePosition() const noexcept { return EyeLocation; }
    [[nodiscard]] Frontier::Vec3 QueryAimPosition() const noexcept { return AimLocation; }
    [[nodiscard]] float          QueryFieldOfViewDegrees() const noexcept { return FieldOfViewDegrees; }

  private:
    ChaseCameraConfiguration ActiveConfiguration {};
    Frontier::Vec3           EyeLocation         {-7.0f, 0.0f, 2.6f};   // [m]   - Filtered world-space eye position
    Frontier::Vec3           AimLocation         {0.0f, 0.0f, 0.8f};    // [m]   - World-space aim target
    float                    FieldOfViewDegrees  = 60.0f;               // [deg] - Speed-modulated vertical FOV
    bool                     Seeded              = false;               // [-]   - True after initial SnapTo
};

} // namespace Frontier::Vehicle
