/*==========================================================================================================================================
                                                           SPATIALPROFILE.H
==========================================================================================================================================*/
// 🧩 Shared 3D spatial placement profile (position, orientation, non-uniform scale, and matrix derivation).

#pragma once

#include "Frontier/Engine/Foundation/Math.h"

#include <cstdint>

namespace Frontier
{

struct SpatialProfile
{
    Vec3d    PositionMetres{ 0.0, 0.0, 0.0 };
    Vec3d    OrientationDegrees{ 0.0, 0.0, 0.0 };
    Vec3d    Scale{ 1.0, 1.0, 1.0 };
    uint64_t Revision = 0;

    void AdvanceRevision() noexcept { ++Revision; }

    [[nodiscard]] Quatd RotationQuaternion() const noexcept
    {
        return Quatd::FromEulerDegreesZYX(OrientationDegrees);
    }

    [[nodiscard]] Mat4d WorldMatrix() const noexcept
    {
        return ComposeTrs(PositionMetres, RotationQuaternion(), Scale);
    }

    [[nodiscard]] double DistanceTo(const SpatialProfile& Other) const noexcept
    {
        return Distance(PositionMetres, Other.PositionMetres);
    }

    friend bool operator==(const SpatialProfile& Left, const SpatialProfile& Right) noexcept
    {
        return Left.PositionMetres == Right.PositionMetres &&
               Left.OrientationDegrees == Right.OrientationDegrees &&
               Left.Scale == Right.Scale;
    }
};

} // namespace Frontier
