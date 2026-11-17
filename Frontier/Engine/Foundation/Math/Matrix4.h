/*==========================================================================================================================================
                                                              MATRIX4.H
==========================================================================================================================================*/
// 🧩 Column-major templated 4x4 matrices and Vulkan clip-space transforms.

#pragma once

#include "Frontier/Engine/Foundation/Math/Quaternion.h"
#include "Frontier/Engine/Foundation/Math/VectorTypes.h"

#include <cmath>
#include <concepts>
#include <cstdint>

namespace Frontier
{

// Column-major 4x4 matching Vulkan/Slang/GLSL layout: Columns[column][row], point transforms as M * p.
template <std::floating_point ScalarT>
struct Matrix4
{
    using ScalarType = ScalarT;

    ScalarT Columns[4][4] = {};

    [[nodiscard]] static constexpr Matrix4 Identity() noexcept
    {
        Matrix4 M;
        const ScalarT One = static_cast<ScalarT>(1);
        M.Columns[0][0]   = One;
        M.Columns[1][1]   = One;
        M.Columns[2][2]   = One;
        M.Columns[3][3]   = One;
        return M;
    }
};

template <std::floating_point T>
[[nodiscard]] constexpr Matrix4<T> operator*(const Matrix4<T>& A, const Matrix4<T>& B) noexcept
{
    Matrix4<T> Out;
    for (uint32_t Column = 0; Column < 4; ++Column)
    {
        for (uint32_t Row = 0; Row < 4; ++Row)
        {
            T Sum = static_cast<T>(0);
            for (uint32_t K = 0; K < 4; ++K)
            {
                Sum += A.Columns[K][Row] * B.Columns[Column][K];
            }
            Out.Columns[Column][Row] = Sum;
        }
    }
    return Out;
}

template <std::floating_point T>
[[nodiscard]] constexpr Vector4<T> Transform(const Matrix4<T>& M, Vector4<T> P) noexcept
{
    return {
        M.Columns[0][0] * P.X + M.Columns[1][0] * P.Y + M.Columns[2][0] * P.Z + M.Columns[3][0] * P.W,
        M.Columns[0][1] * P.X + M.Columns[1][1] * P.Y + M.Columns[2][1] * P.Z + M.Columns[3][1] * P.W,
        M.Columns[0][2] * P.X + M.Columns[1][2] * P.Y + M.Columns[2][2] * P.Z + M.Columns[3][2] * P.W,
        M.Columns[0][3] * P.X + M.Columns[1][3] * P.Y + M.Columns[2][3] * P.Z + M.Columns[3][3] * P.W,
    };
}

template <std::floating_point T>
[[nodiscard]] constexpr Vector3<T> TransformPoint(const Matrix4<T>& M, Vector3<T> P) noexcept
{
    const Vector4<T> Homogeneous = Transform(M, { P.X, P.Y, P.Z, static_cast<T>(1) });
    const T          InverseW =
        Homogeneous.W != static_cast<T>(0) ? static_cast<T>(1) / Homogeneous.W : static_cast<T>(0);
    return { Homogeneous.X * InverseW, Homogeneous.Y * InverseW, Homogeneous.Z * InverseW };
}

template <std::floating_point T>
[[nodiscard]] constexpr Vector3<T> TransformDirection(const Matrix4<T>& M, Vector3<T> D) noexcept
{
    const Vector4<T> Homogeneous = Transform(M, { D.X, D.Y, D.Z, static_cast<T>(0) });
    return { Homogeneous.X, Homogeneous.Y, Homogeneous.Z };
}

template <std::floating_point T>
[[nodiscard]] constexpr Matrix4<T> TranslationMatrix(Vector3<T> Offset) noexcept
{
    Matrix4<T> M    = Matrix4<T>::Identity();
    M.Columns[3][0] = Offset.X;
    M.Columns[3][1] = Offset.Y;
    M.Columns[3][2] = Offset.Z;
    return M;
}

template <std::floating_point T>
[[nodiscard]] constexpr Matrix4<T> ScaleMatrix(Vector3<T> Scale) noexcept
{
    Matrix4<T> M    = Matrix4<T>::Identity();
    M.Columns[0][0] = Scale.X;
    M.Columns[1][1] = Scale.Y;
    M.Columns[2][2] = Scale.Z;
    return M;
}

template <std::floating_point T>
[[nodiscard]] inline Matrix4<T> RotationMatrix(Vector3<T> Axis, T AngleRadians) noexcept
{
    const Vector3<T> A = Normalise(Axis);
    const T          C = std::cos(AngleRadians);
    const T          S = std::sin(AngleRadians);
    const T          O = static_cast<T>(1) - C;

    Matrix4<T> M    = Matrix4<T>::Identity();
    M.Columns[0][0] = O * A.X * A.X + C;
    M.Columns[0][1] = O * A.X * A.Y + S * A.Z;
    M.Columns[0][2] = O * A.X * A.Z - S * A.Y;
    M.Columns[1][0] = O * A.X * A.Y - S * A.Z;
    M.Columns[1][1] = O * A.Y * A.Y + C;
    M.Columns[1][2] = O * A.Y * A.Z + S * A.X;
    M.Columns[2][0] = O * A.X * A.Z + S * A.Y;
    M.Columns[2][1] = O * A.Y * A.Z - S * A.X;
    M.Columns[2][2] = O * A.Z * A.Z + C;
    return M;
}

template <std::floating_point T>
[[nodiscard]] inline Matrix4<T> FromQuaternion(Quaternion<T> Rotation) noexcept
{
    const auto Axes = Rotation.ToBasisColumns();
    Matrix4<T> M    = Matrix4<T>::Identity();
    for (uint32_t Col = 0; Col < 3; ++Col)
    {
        M.Columns[Col][0] = Axes[Col].X;
        M.Columns[Col][1] = Axes[Col].Y;
        M.Columns[Col][2] = Axes[Col].Z;
    }
    return M;
}

template <std::floating_point T>
[[nodiscard]] inline Matrix4<T> ComposeTrs(Vector3<T> Position, Quaternion<T> Rotation, Vector3<T> Scale) noexcept
{
    Matrix4<T> M = FromQuaternion(Rotation);
    for (uint32_t Row = 0; Row < 3; ++Row)
    {
        M.Columns[0][Row] *= Scale.X;
        M.Columns[1][Row] *= Scale.Y;
        M.Columns[2][Row] *= Scale.Z;
    }
    M.Columns[3][0] = Position.X;
    M.Columns[3][1] = Position.Y;
    M.Columns[3][2] = Position.Z;
    return M;
}

template <std::floating_point T>
[[nodiscard]] inline Matrix4<T> LookAtMatrix(Vector3<T> Eye, Vector3<T> Target, Vector3<T> Up) noexcept
{
    const Vector3<T> Forward = Normalise(Target - Eye);
    const Vector3<T> Right   = Normalise(Cross(Forward, Up));
    const Vector3<T> TrueUp  = Cross(Right, Forward);

    Matrix4<T> M    = Matrix4<T>::Identity();
    M.Columns[0][0] = Right.X;
    M.Columns[1][0] = Right.Y;
    M.Columns[2][0] = Right.Z;
    M.Columns[0][1] = TrueUp.X;
    M.Columns[1][1] = TrueUp.Y;
    M.Columns[2][1] = TrueUp.Z;
    M.Columns[0][2] = -Forward.X;
    M.Columns[1][2] = -Forward.Y;
    M.Columns[2][2] = -Forward.Z;
    M.Columns[3][0] = -Dot(Right, Eye);
    M.Columns[3][1] = -Dot(TrueUp, Eye);
    M.Columns[3][2] = Dot(Forward, Eye);
    return M;
}

// Vulkan clip space: depth in [0, 1], Y pointing down.
template <std::floating_point T>
[[nodiscard]] inline Matrix4<T> PerspectiveMatrix(T VerticalFovRadians, T Aspect, T Near, T Far) noexcept
{
    const T Tangent = std::tan(VerticalFovRadians * static_cast<T>(0.5));

    Matrix4<T> M;
    M.Columns[0][0] = static_cast<T>(1) / (Aspect * Tangent);
    M.Columns[1][1] = -static_cast<T>(1) / Tangent;
    M.Columns[2][2] = Far / (Near - Far);
    M.Columns[2][3] = -static_cast<T>(1);
    M.Columns[3][2] = (Far * Near) / (Near - Far);
    return M;
}

using Mat4f = Matrix4<float>;
using Mat4d = Matrix4<double>;
using Mat4  = Mat4f;

} // namespace Frontier
