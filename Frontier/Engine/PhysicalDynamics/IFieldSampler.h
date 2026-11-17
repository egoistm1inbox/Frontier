/*==========================================================================================================================================
                                                             IFIELDSAMPLER.H
==========================================================================================================================================*/
// 🧩 Unified 3D environmental force-field interface sampled identically by ParticleSpace, FluidSpace, Physics, and Clouds.

#pragma once

#include "Engine/Scene/EngineConfigurations.h"
#include "Frontier/Engine/Foundation/Math.h"

#include <cstdint>

namespace Frontier
{

struct FieldPointSample
{
    Vec3d  AirVelocityMps{};
    Vec3d  RadialPressureGradientPaPerM{};
    double PressureDeficitPascals      = 0.0;
    double FunnelCondensationDensity   = 0.0;
    double HelicalTwistRadians         = 0.0;
    double ParticulateExtinctionPerM   = 0.0;
    Vec3d  ParticulateScatteringAlbedo = { 0.58, 0.48, 0.36 };
};

// 📝 Coordinate conversion between Frontier world axes (X east, Y north, Z up) and ForceField axes (X east, Y up, Z south).
[[nodiscard]] constexpr Vec3d WorldToFieldAxes(const Vec3d& WorldPoint) noexcept
{
    return { WorldPoint.X, WorldPoint.Z, -WorldPoint.Y };
}

[[nodiscard]] constexpr Vec3d FieldToWorldAxes(const Vec3d& FieldVector) noexcept
{
    return { FieldVector.X, -FieldVector.Z, FieldVector.Y };
}

class IFieldSampler
{
  public:
    virtual ~IFieldSampler() = default;

    [[nodiscard]] virtual bool   QueryFieldEnabled() const noexcept      = 0;
    [[nodiscard]] virtual double QueryGroundPlaneYMeters() const noexcept = 0;

    [[nodiscard]] virtual Vec3d SampleFieldFlow(const Vec3d& FieldPointMeters,
                                                double       CellSpanMeters   = 0.0,
                                                bool         IncludeCurlSwirl = false) const noexcept = 0;

    [[nodiscard]] virtual Vec3d SampleFieldContribution(ForceContribution Contribution,
                                                        const Vec3d&      FieldPointMeters,
                                                        double            CellSpanMeters   = 0.0,
                                                        bool              IncludeCurlSwirl = true,
                                                        int32_t           Solo             = -1) const noexcept = 0;

    [[nodiscard]] virtual FieldPointSample EvaluateFullField(const Vec3d& FieldPointMeters,
                                                             bool         IncludeCurlSwirl = false,
                                                             double       CellSpanMeters   = 0.0) const noexcept = 0;

    // 📝 Convenience helper for Z-up callers (Physics, Level, Particle world anchor).
    [[nodiscard]] Vec3d SampleWorldFlow(const Vec3d& WorldPointMeters,
                                        double       CellSpanMeters   = 0.0,
                                        bool         IncludeCurlSwirl = false) const noexcept
    {
        return FieldToWorldAxes(SampleFieldFlow(WorldToFieldAxes(WorldPointMeters), CellSpanMeters, IncludeCurlSwirl));
    }
};

} // namespace Frontier
