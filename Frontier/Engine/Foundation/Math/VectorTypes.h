/*==========================================================================================================================================
                                                            VECTORTYPES.H
==========================================================================================================================================*/
// 🧩 Templated 2D/3D/4D vector types and concept-constrained linear algebra across Frontier.

#pragma once

#include "Frontier/Engine/Foundation/Constants.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <concepts>
#include <cstddef>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    VECTOR TEMPLATES
//------------------------------------------------------------------------------------------------------------------------

template <std::floating_point ScalarT>
struct Vector2
{
    using ScalarType = ScalarT;

    ScalarT X = static_cast<ScalarT>(0);
    ScalarT Y = static_cast<ScalarT>(0);

    [[nodiscard]] constexpr ScalarT& operator[](size_t Index) noexcept { return Index == 0 ? X : Y; }
    [[nodiscard]] constexpr ScalarT  operator[](size_t Index) const noexcept { return Index == 0 ? X : Y; }

    [[nodiscard]] constexpr std::array<ScalarT, 2> ToArray() const noexcept { return { X, Y }; }
    [[nodiscard]] static constexpr Vector2         FromArray(const std::array<ScalarT, 2>& Values) noexcept
    {
        return { Values[0], Values[1] };
    }

    constexpr Vector2& operator+=(Vector2 Other) noexcept
    {
        X += Other.X;
        Y += Other.Y;
        return *this;
    }
    constexpr Vector2& operator-=(Vector2 Other) noexcept
    {
        X -= Other.X;
        Y -= Other.Y;
        return *this;
    }
    constexpr Vector2& operator*=(ScalarT Scale) noexcept
    {
        X *= Scale;
        Y *= Scale;
        return *this;
    }

    friend constexpr bool operator==(Vector2, Vector2) noexcept = default;
};

template <std::floating_point ScalarT>
struct Vector3
{
    using ScalarType = ScalarT;

    ScalarT X = static_cast<ScalarT>(0);
    ScalarT Y = static_cast<ScalarT>(0);
    ScalarT Z = static_cast<ScalarT>(0);

    [[nodiscard]] constexpr ScalarT& operator[](size_t Index) noexcept { return Index == 0 ? X : (Index == 1 ? Y : Z); }
    [[nodiscard]] constexpr ScalarT  operator[](size_t Index) const noexcept
    {
        return Index == 0 ? X : (Index == 1 ? Y : Z);
    }

    [[nodiscard]] constexpr std::array<ScalarT, 3> ToArray() const noexcept { return { X, Y, Z }; }
    [[nodiscard]] static constexpr Vector3         FromArray(const std::array<ScalarT, 3>& Values) noexcept
    {
        return { Values[0], Values[1], Values[2] };
    }

    constexpr Vector3& operator+=(Vector3 Other) noexcept
    {
        X += Other.X;
        Y += Other.Y;
        Z += Other.Z;
        return *this;
    }
    constexpr Vector3& operator-=(Vector3 Other) noexcept
    {
        X -= Other.X;
        Y -= Other.Y;
        Z -= Other.Z;
        return *this;
    }
    constexpr Vector3& operator*=(ScalarT Scale) noexcept
    {
        X *= Scale;
        Y *= Scale;
        Z *= Scale;
        return *this;
    }

    friend constexpr bool operator==(Vector3, Vector3) noexcept = default;
};

template <std::floating_point ScalarT>
struct Vector4
{
    using ScalarType = ScalarT;

    ScalarT X = static_cast<ScalarT>(0);
    ScalarT Y = static_cast<ScalarT>(0);
    ScalarT Z = static_cast<ScalarT>(0);
    ScalarT W = static_cast<ScalarT>(0);

    [[nodiscard]] constexpr ScalarT& operator[](size_t Index) noexcept
    {
        return Index == 0 ? X : (Index == 1 ? Y : (Index == 2 ? Z : W));
    }
    [[nodiscard]] constexpr ScalarT operator[](size_t Index) const noexcept
    {
        return Index == 0 ? X : (Index == 1 ? Y : (Index == 2 ? Z : W));
    }

    [[nodiscard]] constexpr std::array<ScalarT, 4> ToArray() const noexcept { return { X, Y, Z, W }; }
    [[nodiscard]] static constexpr Vector4         FromArray(const std::array<ScalarT, 4>& Values) noexcept
    {
        return { Values[0], Values[1], Values[2], Values[3] };
    }

    constexpr Vector4& operator+=(Vector4 Other) noexcept
    {
        X += Other.X;
        Y += Other.Y;
        Z += Other.Z;
        W += Other.W;
        return *this;
    }
    constexpr Vector4& operator-=(Vector4 Other) noexcept
    {
        X -= Other.X;
        Y -= Other.Y;
        Z -= Other.Z;
        W -= Other.W;
        return *this;
    }
    constexpr Vector4& operator*=(ScalarT Scale) noexcept
    {
        X *= Scale;
        Y *= Scale;
        Z *= Scale;
        W *= Scale;
        return *this;
    }

    friend constexpr bool operator==(Vector4, Vector4) noexcept = default;
};

//------------------------------------------------------------------------------------------------------------------------
//                                                      OPERATORS
//------------------------------------------------------------------------------------------------------------------------

template <std::floating_point T>
[[nodiscard]] constexpr Vector2<T> operator+(Vector2<T> A, Vector2<T> B) noexcept { return { A.X + B.X, A.Y + B.Y }; }
template <std::floating_point T>
[[nodiscard]] constexpr Vector2<T> operator-(Vector2<T> A, Vector2<T> B) noexcept { return { A.X - B.X, A.Y - B.Y }; }
template <std::floating_point T>
[[nodiscard]] constexpr Vector2<T> operator-(Vector2<T> A) noexcept { return { -A.X, -A.Y }; }
template <std::floating_point T>
[[nodiscard]] constexpr Vector2<T> operator*(Vector2<T> A, T S) noexcept { return { A.X * S, A.Y * S }; }
template <std::floating_point T>
[[nodiscard]] constexpr Vector2<T> operator*(T S, Vector2<T> A) noexcept { return A * S; }
template <std::floating_point T>
[[nodiscard]] constexpr Vector2<T> operator/(Vector2<T> A, T S) noexcept { return { A.X / S, A.Y / S }; }

template <std::floating_point T>
[[nodiscard]] constexpr Vector3<T> operator+(Vector3<T> A, Vector3<T> B) noexcept
{
    return { A.X + B.X, A.Y + B.Y, A.Z + B.Z };
}
template <std::floating_point T>
[[nodiscard]] constexpr Vector3<T> operator-(Vector3<T> A, Vector3<T> B) noexcept
{
    return { A.X - B.X, A.Y - B.Y, A.Z - B.Z };
}
template <std::floating_point T>
[[nodiscard]] constexpr Vector3<T> operator-(Vector3<T> A) noexcept { return { -A.X, -A.Y, -A.Z }; }
template <std::floating_point T>
[[nodiscard]] constexpr Vector3<T> operator*(Vector3<T> A, T S) noexcept { return { A.X * S, A.Y * S, A.Z * S }; }
template <std::floating_point T>
[[nodiscard]] constexpr Vector3<T> operator*(T S, Vector3<T> A) noexcept { return A * S; }
template <std::floating_point T>
[[nodiscard]] constexpr Vector3<T> operator/(Vector3<T> A, T S) noexcept { return { A.X / S, A.Y / S, A.Z / S }; }

template <std::floating_point T>
[[nodiscard]] constexpr Vector4<T> operator+(Vector4<T> A, Vector4<T> B) noexcept
{
    return { A.X + B.X, A.Y + B.Y, A.Z + B.Z, A.W + B.W };
}
template <std::floating_point T>
[[nodiscard]] constexpr Vector4<T> operator-(Vector4<T> A, Vector4<T> B) noexcept
{
    return { A.X - B.X, A.Y - B.Y, A.Z - B.Z, A.W - B.W };
}
template <std::floating_point T>
[[nodiscard]] constexpr Vector4<T> operator-(Vector4<T> A) noexcept { return { -A.X, -A.Y, -A.Z, -A.W }; }
template <std::floating_point T>
[[nodiscard]] constexpr Vector4<T> operator*(Vector4<T> A, T S) noexcept
{
    return { A.X * S, A.Y * S, A.Z * S, A.W * S };
}
template <std::floating_point T>
[[nodiscard]] constexpr Vector4<T> operator*(T S, Vector4<T> A) noexcept { return A * S; }

//------------------------------------------------------------------------------------------------------------------------
//                                                  ALGEBRAIC OPERATIONS
//------------------------------------------------------------------------------------------------------------------------

template <std::floating_point T>
[[nodiscard]] constexpr T Dot(Vector2<T> A, Vector2<T> B) noexcept { return A.X * B.X + A.Y * B.Y; }

template <std::floating_point T>
[[nodiscard]] constexpr T Cross(Vector2<T> A, Vector2<T> B) noexcept { return A.X * B.Y - A.Y * B.X; }

template <std::floating_point T>
[[nodiscard]] constexpr T Dot(Vector3<T> A, Vector3<T> B) noexcept { return A.X * B.X + A.Y * B.Y + A.Z * B.Z; }

template <std::floating_point T>
[[nodiscard]] constexpr Vector3<T> Cross(Vector3<T> A, Vector3<T> B) noexcept
{
    return { A.Y * B.Z - A.Z * B.Y, A.Z * B.X - A.X * B.Z, A.X * B.Y - A.Y * B.X };
}

template <std::floating_point T>
[[nodiscard]] constexpr T Dot(Vector4<T> A, Vector4<T> B) noexcept
{
    return A.X * B.X + A.Y * B.Y + A.Z * B.Z + A.W * B.W;
}

template <typename VectorT>
[[nodiscard]] constexpr typename VectorT::ScalarType LengthSquared(VectorT Value) noexcept
{
    return Dot(Value, Value);
}

template <typename VectorT>
[[nodiscard]] inline typename VectorT::ScalarType Length(VectorT Value) noexcept
{
    return std::sqrt(LengthSquared(Value));
}

template <typename VectorT>
[[nodiscard]] inline typename VectorT::ScalarType Distance(VectorT A, VectorT B) noexcept
{
    return Length(B - A);
}

template <typename VectorT>
[[nodiscard]] inline VectorT Normalise(VectorT Value) noexcept
{
    using ScalarT             = typename VectorT::ScalarType;
    const ScalarT MagnitudeSq = LengthSquared(Value);
    if (MagnitudeSq <= static_cast<ScalarT>(0))
    {
        return VectorT{};
    }
    const ScalarT Inv = static_cast<ScalarT>(1) / std::sqrt(MagnitudeSq);
    return Value * Inv;
}

template <typename VectorT>
[[nodiscard]] constexpr VectorT Lerp(VectorT A, VectorT B, typename VectorT::ScalarType Factor) noexcept
{
    return A + (B - A) * Factor;
}

template <std::floating_point T>
[[nodiscard]] constexpr Vector3<T> Hadamard(Vector3<T> A, Vector3<T> B) noexcept
{
    return { A.X * B.X, A.Y * B.Y, A.Z * B.Z };
}

template <std::floating_point T>
[[nodiscard]] constexpr Vector3<T> ComponentMin(Vector3<T> A, Vector3<T> B) noexcept
{
    return { std::min(A.X, B.X), std::min(A.Y, B.Y), std::min(A.Z, B.Z) };
}

template <std::floating_point T>
[[nodiscard]] constexpr Vector3<T> ComponentMax(Vector3<T> A, Vector3<T> B) noexcept
{
    return { std::max(A.X, B.X), std::max(A.Y, B.Y), std::max(A.Z, B.Z) };
}

template <std::floating_point T>
[[nodiscard]] inline bool IsFinite(Vector3<T> V) noexcept
{
    return std::isfinite(V.X) && std::isfinite(V.Y) && std::isfinite(V.Z);
}

template <std::floating_point TargetT, std::floating_point SourceT>
[[nodiscard]] constexpr Vector3<TargetT> CastVector(Vector3<SourceT> V) noexcept
{
    return { static_cast<TargetT>(V.X), static_cast<TargetT>(V.Y), static_cast<TargetT>(V.Z) };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      ALIASES
//------------------------------------------------------------------------------------------------------------------------

using Vec2f = Vector2<float>;
using Vec2d = Vector2<double>;
using Vec3f = Vector3<float>;
using Vec3d = Vector3<double>;
using Vec4f = Vector4<float>;
using Vec4d = Vector4<double>;

// Legacy single-precision aliases retained for existing viewport callers.
using Vec2 = Vec2f;
using Vec3 = Vec3f;
using Vec4 = Vec4f;

} // namespace Frontier
