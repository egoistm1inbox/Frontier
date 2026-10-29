//============================================================================================================================================
//                                                     CHASECAMERAPROJECTION.CPP
//============================================================================================================================================
// 🧩 Critically damped vehicle follow camera projection implementation.

#include "ChaseCameraProjection.h"

#include <algorithm>
#include <cmath>

namespace Frontier::Vehicle
{

namespace
{

constexpr float DegreesToRadians = 3.14159265358979323846f / 180.0f;

Frontier::Vec3 SanitizeForward(Frontier::Vec3 Forward) noexcept
{
    const float Magnitude = Length(Forward);
    return Magnitude > 1.0e-5f ? (Forward * (1.0f / Magnitude)) : Frontier::Vec3{1.0f, 0.0f, 0.0f};
}

} // namespace

ChaseCameraProjection::ChaseCameraProjection(const ChaseCameraConfiguration& InitialConfiguration) noexcept
    : ActiveConfiguration(InitialConfiguration)
    , FieldOfViewDegrees(InitialConfiguration.BaseFieldOfView)
{
}

void ChaseCameraProjection::SnapTo(Frontier::Vec3 TargetPosition, Frontier::Vec3 TargetForward) noexcept
{
    const Frontier::Vec3 Forward = SanitizeForward(TargetForward);

    EyeLocation = {
        TargetPosition.X - Forward.X * ActiveConfiguration.FollowDistance,
        TargetPosition.Y - Forward.Y * ActiveConfiguration.FollowDistance,
        TargetPosition.Z - Forward.Z * ActiveConfiguration.FollowDistance + ActiveConfiguration.FollowHeight,
    };
    AimLocation = {
        TargetPosition.X,
        TargetPosition.Y,
        TargetPosition.Z + ActiveConfiguration.LookAtHeight,
    };
    FieldOfViewDegrees = ActiveConfiguration.BaseFieldOfView;
    Seeded             = true;
}

void ChaseCameraProjection::AdvanceChase(
    Frontier::Vec3 TargetPosition,
    Frontier::Vec3 TargetForward,
    float          SpeedMetresPerSecond,
    float          Δτ) noexcept
{
    if (!Seeded)
    {
        SnapTo(TargetPosition, TargetForward);
        return;
    }
    if (!(Δτ > 0.0f))
    {
        return;
    }

    const Frontier::Vec3 Forward = SanitizeForward(TargetForward);
    const Frontier::Vec3 IdealEye{
        TargetPosition.X - Forward.X * ActiveConfiguration.FollowDistance,
        TargetPosition.Y - Forward.Y * ActiveConfiguration.FollowDistance,
        TargetPosition.Z - Forward.Z * ActiveConfiguration.FollowDistance + ActiveConfiguration.FollowHeight,
    };

    const float Blend = 1.0f - std::exp(-ActiveConfiguration.PositionSpring * Δτ);
    EyeLocation       = EyeLocation + (IdealEye - EyeLocation) * Blend;
    AimLocation       = {
        TargetPosition.X,
        TargetPosition.Y,
        TargetPosition.Z + ActiveConfiguration.LookAtHeight,
    };

    const float SpeedFraction =
        std::clamp(std::fabs(SpeedMetresPerSecond) / std::max(1.0f, ActiveConfiguration.SpeedForFullFov), 0.0f, 1.0f);
    FieldOfViewDegrees = ActiveConfiguration.BaseFieldOfView + ActiveConfiguration.SpeedFieldOfView * SpeedFraction;
}

ChaseCameraReading ChaseCameraProjection::BuildReading(uint32_t ViewportWidth, uint32_t ViewportHeight) const noexcept
{
    const float Aspect = ViewportHeight > 0u
                           ? static_cast<float>(std::max(1u, ViewportWidth)) / static_cast<float>(ViewportHeight)
                           : (16.0f / 9.0f);

    ChaseCameraReading Out;
    Out.EyePosition        = EyeLocation;
    Out.AimPosition        = AimLocation;
    Out.FieldOfViewDegrees = FieldOfViewDegrees;
    Out.ViewMatrix         = LookAtMatrix(EyeLocation, AimLocation, {0.0f, 0.0f, 1.0f});
    Out.ProjectionMatrix   = PerspectiveMatrix(
        FieldOfViewDegrees * DegreesToRadians,
        Aspect,
        ActiveConfiguration.NearClip,
        ActiveConfiguration.FarClip);
    Out.ViewProjection     = Out.ProjectionMatrix * Out.ViewMatrix;
    return Out;
}

} // namespace Frontier::Vehicle
