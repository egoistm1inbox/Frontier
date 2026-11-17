/*==========================================================================================================================================
                                                           SPATIALBOUNDS.H
==========================================================================================================================================*/
// 🧩 Axis-aligned spatial bounds and ray/plane intersection primitives.

#pragma once

#include "Frontier/Engine/Foundation/Math/VectorTypes.h"

#include <algorithm>
#include <cmath>
#include <concepts>
#include <limits>
#include <optional>

namespace Frontier
{

template <std::floating_point ScalarT>
struct IntervalBounds3
{
    Vector3<ScalarT> Minimum{ std::numeric_limits<ScalarT>::infinity(),
                              std::numeric_limits<ScalarT>::infinity(),
                              std::numeric_limits<ScalarT>::infinity() };
    Vector3<ScalarT> Maximum{ -std::numeric_limits<ScalarT>::infinity(),
                              -std::numeric_limits<ScalarT>::infinity(),
                              -std::numeric_limits<ScalarT>::infinity() };

    [[nodiscard]] constexpr bool IsValid() const noexcept
    {
        return Minimum.X <= Maximum.X && Minimum.Y <= Maximum.Y && Minimum.Z <= Maximum.Z;
    }

    constexpr void Expand(Vector3<ScalarT> Point) noexcept
    {
        Minimum = ComponentMin(Minimum, Point);
        Maximum = ComponentMax(Maximum, Point);
    }

    constexpr void Expand(const IntervalBounds3& Other) noexcept
    {
        if (!Other.IsValid())
        {
            return;
        }
        Minimum = ComponentMin(Minimum, Other.Minimum);
        Maximum = ComponentMax(Maximum, Other.Maximum);
    }

    [[nodiscard]] constexpr Vector3<ScalarT> Centre() const noexcept
    {
        return (Minimum + Maximum) * static_cast<ScalarT>(0.5);
    }

    [[nodiscard]] constexpr Vector3<ScalarT> HalfExtents() const noexcept
    {
        return (Maximum - Minimum) * static_cast<ScalarT>(0.5);
    }

    [[nodiscard]] constexpr bool Contains(Vector3<ScalarT> Point) const noexcept
    {
        return Point.X >= Minimum.X && Point.X <= Maximum.X &&
               Point.Y >= Minimum.Y && Point.Y <= Maximum.Y &&
               Point.Z >= Minimum.Z && Point.Z <= Maximum.Z;
    }

    [[nodiscard]] constexpr bool Intersects(const IntervalBounds3& Other) const noexcept
    {
        return IsValid() && Other.IsValid() &&
               Minimum.X <= Other.Maximum.X && Maximum.X >= Other.Minimum.X &&
               Minimum.Y <= Other.Maximum.Y && Maximum.Y >= Other.Minimum.Y &&
               Minimum.Z <= Other.Maximum.Z && Maximum.Z >= Other.Minimum.Z;
    }
};

template <std::floating_point ScalarT>
struct Ray3
{
    Vector3<ScalarT> Origin{};
    Vector3<ScalarT> Direction{ static_cast<ScalarT>(0), static_cast<ScalarT>(0), static_cast<ScalarT>(1) };
};

template <std::floating_point ScalarT>
[[nodiscard]] inline std::optional<ScalarT> IntersectRayPlane(const Ray3<ScalarT>& Ray,
                                                              Vector3<ScalarT>     PlanePoint,
                                                              Vector3<ScalarT>     PlaneNormal) noexcept
{
    const ScalarT Denom = Dot(Ray.Direction, PlaneNormal);
    if (std::abs(Denom) <= MathematicalConstants<ScalarT>::HighPrecisionEps)
    {
        return std::nullopt;
    }
    const ScalarT T = Dot(PlanePoint - Ray.Origin, PlaneNormal) / Denom;
    if (T < static_cast<ScalarT>(0))
    {
        return std::nullopt;
    }
    return T;
}

template <std::floating_point ScalarT>
[[nodiscard]] inline ScalarT ClosestParameterOnAxis(const Ray3<ScalarT>& Ray,
                                                    Vector3<ScalarT>     AxisOrigin,
                                                    Vector3<ScalarT>     AxisDirection) noexcept
{
    const Vector3<ScalarT> W0  = AxisOrigin - Ray.Origin;
    const ScalarT          A   = Dot(AxisDirection, AxisDirection);
    const ScalarT          B   = Dot(AxisDirection, Ray.Direction);
    const ScalarT          C   = Dot(Ray.Direction, Ray.Direction);
    const ScalarT          D   = Dot(AxisDirection, W0);
    const ScalarT          E   = Dot(Ray.Direction, W0);
    const ScalarT          Den = A * C - B * B;
    if (std::abs(Den) <= MathematicalConstants<ScalarT>::HighPrecisionEps)
    {
        return static_cast<ScalarT>(0);
    }
    return (B * E - C * D) / Den;
}

using Bounds3f = IntervalBounds3<float>;
using Bounds3d = IntervalBounds3<double>;
using Ray3f    = Ray3<float>;
using Ray3d    = Ray3<double>;

} // namespace Frontier
