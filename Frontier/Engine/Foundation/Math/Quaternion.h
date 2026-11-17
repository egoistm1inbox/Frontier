/*==========================================================================================================================================
                                                             QUATERNION.H
==========================================================================================================================================*/
// 🧩 Templated unit quaternion, ZYX Euler conversions, axis-angle, vector rotation, and spherical interpolation.

#pragma once

#include "Frontier/Engine/Foundation/Math/VectorTypes.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <concepts>

namespace Frontier
{

template <std::floating_point ScalarT>
struct Quaternion
{
    using ScalarType = ScalarT;

    ScalarT X = static_cast<ScalarT>(0);
    ScalarT Y = static_cast<ScalarT>(0);
    ScalarT Z = static_cast<ScalarT>(0);
    ScalarT W = static_cast<ScalarT>(1);

    [[nodiscard]] static constexpr Quaternion Identity() noexcept { return {}; }

    [[nodiscard]] constexpr std::array<ScalarT, 4> ToArray() const noexcept { return { X, Y, Z, W }; }
    [[nodiscard]] static constexpr Quaternion      FromArray(const std::array<ScalarT, 4>& Values) noexcept
    {
        return { Values[0], Values[1], Values[2], Values[3] };
    }

    [[nodiscard]] constexpr Quaternion Conjugate() const noexcept { return { -X, -Y, -Z, W }; }

    [[nodiscard]] constexpr ScalarT LengthSquared() const noexcept { return X * X + Y * Y + Z * Z + W * W; }

    [[nodiscard]] inline ScalarT Length() const noexcept { return std::sqrt(LengthSquared()); }

    [[nodiscard]] inline Quaternion Normalised() const noexcept
    {
        const ScalarT Mag = Length();
        if (Mag <= MathematicalConstants<ScalarT>::HighPrecisionEps)
        {
            return Identity();
        }
        const ScalarT Inv = static_cast<ScalarT>(1) / Mag;
        return { X * Inv, Y * Inv, Z * Inv, W * Inv };
    }

    [[nodiscard]] constexpr Quaternion operator*(Quaternion Rhs) const noexcept
    {
        return {
            W * Rhs.X + X * Rhs.W + Y * Rhs.Z - Z * Rhs.Y,
            W * Rhs.Y - X * Rhs.Z + Y * Rhs.W + Z * Rhs.X,
            W * Rhs.Z + X * Rhs.Y - Y * Rhs.X + Z * Rhs.W,
            W * Rhs.W - X * Rhs.X - Y * Rhs.Y - Z * Rhs.Z,
        };
    }

    [[nodiscard]] constexpr Vector3<ScalarT> RotateVector(Vector3<ScalarT> V) const noexcept
    {
        const Vector3<ScalarT> U{ X, Y, Z };
        const Vector3<ScalarT> T = Cross(U, V) * static_cast<ScalarT>(2);
        return V + T * W + Cross(U, T);
    }

    [[nodiscard]] static inline Quaternion FromAxisAngle(Vector3<ScalarT> Axis, ScalarT AngleRadians) noexcept
    {
        const Vector3<ScalarT> Unit = Normalise(Axis);
        if (Frontier::LengthSquared(Unit) <= MathematicalConstants<ScalarT>::HighPrecisionEps)
        {
            return Identity();
        }
        const ScalarT Half = AngleRadians * static_cast<ScalarT>(0.5);
        const ScalarT S    = std::sin(Half);
        const ScalarT C    = std::cos(Half);
        return { Unit.X * S, Unit.Y * S, Unit.Z * S, C };
    }

    // R = Rz(Yaw) * Ry(Pitch) * Rx(Roll), matching PlacementGizmo and ConstructPlacement.
    [[nodiscard]] static inline Quaternion FromEulerDegreesZYX(Vector3<ScalarT> EulerDegrees) noexcept
    {
        const ScalarT Half = static_cast<ScalarT>(0.5);
        const ScalarT Rx   = DegreesToRadians(EulerDegrees.X) * Half;
        const ScalarT Ry   = DegreesToRadians(EulerDegrees.Y) * Half;
        const ScalarT Rz   = DegreesToRadians(EulerDegrees.Z) * Half;

        const ScalarT Cx = std::cos(Rx), Sx = std::sin(Rx);
        const ScalarT Cy = std::cos(Ry), Sy = std::sin(Ry);
        const ScalarT Cz = std::cos(Rz), Sz = std::sin(Rz);

        return Quaternion{
            Sx * Cy * Cz - Cx * Sy * Sz,
            Cx * Sy * Cz + Sx * Cy * Sz,
            Cx * Cy * Sz - Sx * Sy * Cz,
            Cx * Cy * Cz + Sx * Sy * Sz,
        }.Normalised();
    }

    [[nodiscard]] inline Vector3<ScalarT> ToEulerDegreesZYX() const noexcept
    {
        const Quaternion Q    = Normalised();
        const ScalarT    Two  = static_cast<ScalarT>(2);
        const ScalarT    One  = static_cast<ScalarT>(1);
        const ScalarT    SinP = std::clamp(Two * (Q.W * Q.Y - Q.Z * Q.X), -One, One);
        const ScalarT    Roll = std::atan2(Two * (Q.W * Q.X + Q.Y * Q.Z), One - Two * (Q.X * Q.X + Q.Y * Q.Y));
        const ScalarT    Pitch = std::asin(SinP);
        const ScalarT    Yaw   = std::atan2(Two * (Q.W * Q.Z + Q.X * Q.Y), One - Two * (Q.Y * Q.Y + Q.Z * Q.Z));
        return { RadiansToDegrees(Roll), RadiansToDegrees(Pitch), RadiansToDegrees(Yaw) };
    }

    [[nodiscard]] inline std::array<Vector3<ScalarT>, 3> ToBasisColumns() const noexcept
    {
        const Quaternion Q   = Normalised();
        const ScalarT    Two = static_cast<ScalarT>(2);
        const ScalarT    Xx  = Q.X * Q.X, Yy = Q.Y * Q.Y, Zz = Q.Z * Q.Z;
        const ScalarT    Xy  = Q.X * Q.Y, Xz = Q.X * Q.Z, Yz = Q.Y * Q.Z;
        const ScalarT    Wx  = Q.W * Q.X, Wy = Q.W * Q.Y, Wz = Q.W * Q.Z;
        return {
            Vector3<ScalarT>{ static_cast<ScalarT>(1) - Two * (Yy + Zz), Two * (Xy + Wz), Two * (Xz - Wy) },
            Vector3<ScalarT>{ Two * (Xy - Wz), static_cast<ScalarT>(1) - Two * (Xx + Zz), Two * (Yz + Wx) },
            Vector3<ScalarT>{ Two * (Xz + Wy), Two * (Yz - Wx), static_cast<ScalarT>(1) - Two * (Xx + Yy) },
        };
    }

    [[nodiscard]] static inline Quaternion Slerp(Quaternion A, Quaternion B, ScalarT Factor) noexcept
    {
        A            = A.Normalised();
        B            = B.Normalised();
        ScalarT CosT = A.X * B.X + A.Y * B.Y + A.Z * B.Z + A.W * B.W;
        if (CosT < static_cast<ScalarT>(0))
        {
            B    = { -B.X, -B.Y, -B.Z, -B.W };
            CosT = -CosT;
        }
        if (CosT > static_cast<ScalarT>(0.9995))
        {
            return Quaternion{
                A.X + (B.X - A.X) * Factor,
                A.Y + (B.Y - A.Y) * Factor,
                A.Z + (B.Z - A.Z) * Factor,
                A.W + (B.W - A.W) * Factor,
            }.Normalised();
        }
        const ScalarT Angle    = std::acos(std::clamp(CosT, static_cast<ScalarT>(-1), static_cast<ScalarT>(1)));
        const ScalarT SinAngle = std::sin(Angle);
        const ScalarT WeightA  = std::sin((static_cast<ScalarT>(1) - Factor) * Angle) / SinAngle;
        const ScalarT WeightB  = std::sin(Factor * Angle) / SinAngle;
        return {
            A.X * WeightA + B.X * WeightB,
            A.Y * WeightA + B.Y * WeightB,
            A.Z * WeightA + B.Z * WeightB,
            A.W * WeightA + B.W * WeightB,
        };
    }

    friend constexpr bool operator==(Quaternion, Quaternion) noexcept = default;
};

using Quatf = Quaternion<float>;
using Quatd = Quaternion<double>;

} // namespace Frontier
