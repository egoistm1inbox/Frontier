/*==========================================================================================================================================
                                                        VEHICLEHMISCENE.CPP
==========================================================================================================================================*/
// 🧩 Ported VehicleHMI proving-grounds scene, ControlVehicle FCT1 facet loader, 3-mode tyre deformation, and BVH showcase renderer.

#include "VehicleHmiScene.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <fstream>
#include <numeric>
#include <sstream>
#include <thread>

namespace Frontier::Drive
{

namespace
{

constexpr float PiScalar        = 3.14159265358979323846f;
constexpr float DegToRadScalar  = PiScalar / 180.0f;
constexpr float BodyCoMRebaseZ  = 0.11285f; // [m] 0.53 - (0.50855 - 0.0914) from VehicleSpecification

using Float3 = std::array<float, 3>;

[[nodiscard]] inline Float3 Add3(const Float3& A, const Float3& B) noexcept
{
    return { A[0] + B[0], A[1] + B[1], A[2] + B[2] };
}

[[nodiscard]] inline Float3 Sub3(const Float3& A, const Float3& B) noexcept
{
    return { A[0] - B[0], A[1] - B[1], A[2] - B[2] };
}

[[nodiscard]] inline Float3 Mul3(const Float3& A, float S) noexcept
{
    return { A[0] * S, A[1] * S, A[2] * S };
}

[[nodiscard]] inline float Dot3(const Float3& A, const Float3& B) noexcept
{
    return A[0] * B[0] + A[1] * B[1] + A[2] * B[2];
}

[[nodiscard]] inline Float3 Cross3(const Float3& A, const Float3& B) noexcept
{
    return {
        A[1] * B[2] - A[2] * B[1],
        A[2] * B[0] - A[0] * B[2],
        A[0] * B[1] - A[1] * B[0]
    };
}

[[nodiscard]] inline Float3 Normalize3(const Float3& V) noexcept
{
    const float L = std::sqrt(Dot3(V, V));
    return (L > 1.0e-8f) ? Float3{ V[0] / L, V[1] / L, V[2] / L } : Float3{ 0.0f, 0.0f, 1.0f };
}

[[nodiscard]] inline Float3 TransformPointMat4(const Frontier::Mat4& M, const Float3& P) noexcept
{
    return {
        M.Columns[0][0] * P[0] + M.Columns[1][0] * P[1] + M.Columns[2][0] * P[2] + M.Columns[3][0],
        M.Columns[0][1] * P[0] + M.Columns[1][1] * P[1] + M.Columns[2][1] * P[2] + M.Columns[3][1],
        M.Columns[0][2] * P[0] + M.Columns[1][2] * P[1] + M.Columns[2][2] * P[2] + M.Columns[3][2]
    };
}

[[nodiscard]] inline Float3 TransformNormalMat4(const Frontier::Mat4& M, const Float3& N) noexcept
{
    return Normalize3({
        M.Columns[0][0] * N[0] + M.Columns[1][0] * N[1] + M.Columns[2][0] * N[2],
        M.Columns[0][1] * N[0] + M.Columns[1][1] * N[1] + M.Columns[2][1] * N[2],
        M.Columns[0][2] * N[0] + M.Columns[1][2] * N[1] + M.Columns[2][2] * N[2]
    });
}

void AppendTriangleAutoNormal(
    std::vector<WorldFacetTriangle>& Out,
    const Float3&                    A,
    const Float3&                    B,
    const Float3&                    C,
    std::uint32_t                    Family)
{
    const Float3 Normal = Normalize3(Cross3(Sub3(B, A), Sub3(C, A)));
    Out.push_back(WorldFacetTriangle{ A, B, C, Normal, Normal, Normal, Family });
}

void AppendQuadOutward(
    std::vector<WorldFacetTriangle>& Out,
    const Float3&                    A,
    const Float3&                    B,
    const Float3&                    C,
    const Float3&                    D,
    std::uint32_t                    Family)
{
    AppendTriangleAutoNormal(Out, A, B, C, Family);
    AppendTriangleAutoNormal(Out, A, C, D, Family);
}

void AppendOrientedBox(
    std::vector<WorldFacetTriangle>&    Out,
    const Float3&                       BaseCentre,
    float                               SizeX,
    float                               SizeY,
    float                               SizeZ,
    float                               YawRadians,
    const std::array<std::uint32_t, 6>& FaceFamilies)
{
    const float Hx = 0.5f * SizeX;
    const float Hy = 0.5f * SizeY;
    const float Cy = std::cos(YawRadians);
    const float Sy = std::sin(YawRadians);

    auto WorldCorner = [&](float Lx, float Ly, float Lz) noexcept -> Float3
    {
        return {
            BaseCentre[0] + Lx * Cy - Ly * Sy,
            BaseCentre[1] + Lx * Sy + Ly * Cy,
            BaseCentre[2] + Lz
        };
    };

    const Float3 P000 = WorldCorner(-Hx, -Hy, 0.0f);
    const Float3 P100 = WorldCorner( Hx, -Hy, 0.0f);
    const Float3 P110 = WorldCorner( Hx,  Hy, 0.0f);
    const Float3 P010 = WorldCorner(-Hx,  Hy, 0.0f);
    const Float3 P001 = WorldCorner(-Hx, -Hy, SizeZ);
    const Float3 P101 = WorldCorner( Hx, -Hy, SizeZ);
    const Float3 P111 = WorldCorner( Hx,  Hy, SizeZ);
    const Float3 P011 = WorldCorner(-Hx,  Hy, SizeZ);

    // +Z top, -Z bottom, +X front, -X back, +Y left, -Y right
    AppendQuadOutward(Out, P001, P101, P111, P011, FaceFamilies[0]);
    AppendQuadOutward(Out, P010, P110, P100, P000, FaceFamilies[1]);
    AppendQuadOutward(Out, P100, P110, P111, P101, FaceFamilies[2]);
    AppendQuadOutward(Out, P010, P000, P001, P011, FaceFamilies[3]);
    AppendQuadOutward(Out, P110, P010, P011, P111, FaceFamilies[4]);
    AppendQuadOutward(Out, P000, P100, P101, P001, FaceFamilies[5]);
}

void AppendSolidBox(
    std::vector<WorldFacetTriangle>& Out,
    const Float3&                    BaseCentre,
    float                            SizeX,
    float                            SizeY,
    float                            SizeZ,
    float                            YawRadians,
    std::uint32_t                    Family)
{
    AppendOrientedBox(Out, BaseCentre, SizeX, SizeY, SizeZ, YawRadians, { Family, Family, Family, Family, Family, Family });
}

void AppendUvSphere(
    std::vector<WorldFacetTriangle>& Out,
    const Float3&                    Centre,
    float                            Radius,
    int                              Rings,
    int                              Sectors,
    std::uint32_t                    Family)
{
    for (int R = 0; R < Rings; ++R)
    {
        const float Theta0 = PiScalar * static_cast<float>(R)     / static_cast<float>(Rings);
        const float Theta1 = PiScalar * static_cast<float>(R + 1) / static_cast<float>(Rings);
        for (int S = 0; S < Sectors; ++S)
        {
            const float Phi0 = 2.0f * PiScalar * static_cast<float>(S)     / static_cast<float>(Sectors);
            const float Phi1 = 2.0f * PiScalar * static_cast<float>(S + 1) / static_cast<float>(Sectors);

            auto Dir = [](float Th, float Ph) noexcept -> Float3
            {
                return { std::sin(Th) * std::cos(Ph), std::sin(Th) * std::sin(Ph), std::cos(Th) };
            };
            const Float3 N00 = Dir(Theta0, Phi0);
            const Float3 N10 = Dir(Theta1, Phi0);
            const Float3 N11 = Dir(Theta1, Phi1);
            const Float3 N01 = Dir(Theta0, Phi1);

            const Float3 P00 = Add3(Centre, Mul3(N00, Radius));
            const Float3 P10 = Add3(Centre, Mul3(N10, Radius));
            const Float3 P11 = Add3(Centre, Mul3(N11, Radius));
            const Float3 P01 = Add3(Centre, Mul3(N01, Radius));

            if (R > 0)
            {
                Out.push_back(WorldFacetTriangle{ P00, P10, P11, N00, N10, N11, Family });
            }
            if (R + 1 < Rings)
            {
                Out.push_back(WorldFacetTriangle{ P00, P11, P01, N00, N11, N01, Family });
            }
        }
    }
}

void AppendCylinderStack(
    std::vector<WorldFacetTriangle>& Out,
    const Float3&                    BaseCentre,
    float                            Radius,
    float                            Height,
    int                              Sides,
    std::uint32_t                    Family)
{
    for (int I = 0; I < Sides; ++I)
    {
        const float A0 = 2.0f * PiScalar * static_cast<float>(I)     / static_cast<float>(Sides);
        const float A1 = 2.0f * PiScalar * static_cast<float>(I + 1) / static_cast<float>(Sides);
        const Float3 N0 = { std::cos(A0), std::sin(A0), 0.0f };
        const Float3 N1 = { std::cos(A1), std::sin(A1), 0.0f };
        const Float3 B0 = { BaseCentre[0] + Radius * N0[0], BaseCentre[1] + Radius * N0[1], BaseCentre[2] };
        const Float3 B1 = { BaseCentre[0] + Radius * N1[0], BaseCentre[1] + Radius * N1[1], BaseCentre[2] };
        const Float3 T0 = { B0[0], B0[1], BaseCentre[2] + Height };
        const Float3 T1 = { B1[0], B1[1], BaseCentre[2] + Height };

        Out.push_back(WorldFacetTriangle{ B0, B1, T1, N0, N1, N1, Family });
        Out.push_back(WorldFacetTriangle{ B0, T1, T0, N0, N1, N0, Family });
        AppendTriangleAutoNormal(Out, { BaseCentre[0], BaseCentre[1], BaseCentre[2] + Height }, T0, T1, Family);
    }
}

void AppendEn13422Cone(
    std::vector<WorldFacetTriangle>& Out,
    const Frontier::Mat4&            WorldTransform,
    float                            LocalZShift)
{
    // EN-13422 cone with square base + retroreflective white bands (matching CourseStructure.js).
    constexpr int   Sides = 16;
    constexpr float BaseH = 0.03f;
    constexpr float TopZ  = 0.68f;
    constexpr float RBot  = 0.155f;
    constexpr float RTop  = 0.034f;
    const float Splits[6] = { BaseH, 0.28f, 0.38f, 0.45f, 0.52f, TopZ };
    const std::uint32_t Bands[5] = { PgmConeOrange, PgmConeBand, PgmConeOrange, PgmConeBand, PgmConeOrange };

    auto Xform = [&](const Float3& P) noexcept -> Float3
    {
        return TransformPointMat4(WorldTransform, { P[0], P[1], P[2] + LocalZShift });
    };

    const float Bh = 0.19f;
    AppendQuadOutward(Out, Xform({ -Bh, -Bh, BaseH }), Xform({ Bh, -Bh, BaseH }), Xform({ Bh, Bh, BaseH }), Xform({ -Bh, Bh, BaseH }), PgmConeBase);

    for (int Ring = 0; Ring < 5; ++Ring)
    {
        const float Z0 = Splits[Ring];
        const float Z1 = Splits[Ring + 1];
        const float R0 = RBot + (RTop - RBot) * ((Z0 - BaseH) / (TopZ - BaseH));
        const float R1 = RBot + (RTop - RBot) * ((Z1 - BaseH) / (TopZ - BaseH));
        for (int S = 0; S < Sides; ++S)
        {
            const float A0 = 2.0f * PiScalar * static_cast<float>(S)     / static_cast<float>(Sides);
            const float A1 = 2.0f * PiScalar * static_cast<float>(S + 1) / static_cast<float>(Sides);
            const Float3 P00 = Xform({ R0 * std::cos(A0), R0 * std::sin(A0), Z0 });
            const Float3 P10 = Xform({ R0 * std::cos(A1), R0 * std::sin(A1), Z0 });
            const Float3 P11 = Xform({ R1 * std::cos(A1), R1 * std::sin(A1), Z1 });
            const Float3 P01 = Xform({ R1 * std::cos(A0), R1 * std::sin(A0), Z1 });
            AppendQuadOutward(Out, P00, P10, P11, P01, Bands[Ring]);
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                            FLAT SAH BOUNDING VOLUME ACCELERATOR
//------------------------------------------------------------------------------------------------------------------------

struct BoundingBox3
{
    Float3 Low  = {  1.0e30f,  1.0e30f,  1.0e30f };
    Float3 High = { -1.0e30f, -1.0e30f, -1.0e30f };

    void Expand(const Float3& P) noexcept
    {
        for (int A = 0; A < 3; ++A)
        {
            Low[A]  = std::min(Low[A],  P[A]);
            High[A] = std::max(High[A], P[A]);
        }
    }

    void ExpandBox(const BoundingBox3& B) noexcept
    {
        Expand(B.Low);
        Expand(B.High);
    }
};

struct SpatialBoundingCell
{
    BoundingBox3  Bounds{};
    std::uint32_t LeftOrFirst = 0u;
    std::uint32_t RightIndex  = 0u;
    std::uint32_t TriCount    = 0u;
};

class TriangleBoundingAccelerator
{
public:
    void Build(const std::vector<WorldFacetTriangle>& Triangles)
    {
        Triangles_ = &Triangles;
        const std::size_t Count = Triangles.size();
        Order_.resize(Count);
        std::iota(Order_.begin(), Order_.end(), 0u);
        Centroids_.resize(Count);
        TriBounds_.resize(Count);
        for (std::size_t I = 0u; I < Count; ++I)
        {
            BoundingBox3 B{};
            B.Expand(Triangles[I].V0);
            B.Expand(Triangles[I].V1);
            B.Expand(Triangles[I].V2);
            TriBounds_[I] = B;
            Centroids_[I] = {
                (Triangles[I].V0[0] + Triangles[I].V1[0] + Triangles[I].V2[0]) * (1.0f / 3.0f),
                (Triangles[I].V0[1] + Triangles[I].V1[1] + Triangles[I].V2[1]) * (1.0f / 3.0f),
                (Triangles[I].V0[2] + Triangles[I].V1[2] + Triangles[I].V2[2]) * (1.0f / 3.0f)
            };
        }
        Cells_.clear();
        Cells_.reserve(Count * 2u + 1u);
        if (Count > 0u)
        {
            BuildRecursive(0u, static_cast<std::uint32_t>(Count));
        }
    }

    struct HitRecord
    {
        float         Distance = 1.0e30f;
        Float3        Position = { 0.0f, 0.0f, 0.0f };
        Float3        Normal   = { 0.0f, 0.0f, 1.0f };
        std::uint32_t Family   = 0u;
        bool          Hit      = false;
    };

    [[nodiscard]] HitRecord TraceClosest(const Float3& Origin, const Float3& Direction, float MaxDistance) const noexcept
    {
        HitRecord Best{};
        Best.Distance = MaxDistance;
        if (Cells_.empty() || !Triangles_)
        {
            return Best;
        }

        const Float3 InvDir = {
            1.0f / ((std::fabs(Direction[0]) < 1.0e-8f) ? 1.0e-8f : Direction[0]),
            1.0f / ((std::fabs(Direction[1]) < 1.0e-8f) ? 1.0e-8f : Direction[1]),
            1.0f / ((std::fabs(Direction[2]) < 1.0e-8f) ? 1.0e-8f : Direction[2])
        };

        std::uint32_t Stack[64];
        int StackPtr = 0;
        Stack[StackPtr++] = 0u;

        while (StackPtr > 0)
        {
            const SpatialBoundingCell& Cell = Cells_[Stack[--StackPtr]];
            if (!IntersectBox(Cell.Bounds, Origin, InvDir, Best.Distance))
            {
                continue;
            }
            if (Cell.TriCount > 0u)
            {
                for (std::uint32_t K = 0u; K < Cell.TriCount; ++K)
                {
                    const WorldFacetTriangle& Tri = (*Triangles_)[Order_[Cell.LeftOrFirst + K]];
                    float T = 0.0f, U = 0.0f, V = 0.0f;
                    if (IntersectTriangle(Origin, Direction, Tri, Best.Distance, T, U, V))
                    {
                        Best.Distance = T;
                        Best.Hit      = true;
                        Best.Family   = Tri.Family;
                        Best.Position = Add3(Origin, Mul3(Direction, T));
                        const float W = 1.0f - U - V;
                        Float3 N = Normalize3({
                            W * Tri.N0[0] + U * Tri.N1[0] + V * Tri.N2[0],
                            W * Tri.N0[1] + U * Tri.N1[1] + V * Tri.N2[1],
                            W * Tri.N0[2] + U * Tri.N1[2] + V * Tri.N2[2]
                        });
                        if (Dot3(N, Direction) > 0.0f && Tri.Family != PgmShowcaseGlass)
                        {
                            N = Mul3(N, -1.0f);
                        }
                        Best.Normal = N;
                    }
                }
            }
            else
            {
                Stack[StackPtr++] = Cell.RightIndex;
                Stack[StackPtr++] = Cell.LeftOrFirst;
            }
        }
        return Best;
    }

    [[nodiscard]] bool TraceOccluded(const Float3& Origin, const Float3& Direction, float MaxDistance) const noexcept
    {
        if (Cells_.empty() || !Triangles_)
        {
            return false;
        }
        const Float3 InvDir = {
            1.0f / ((std::fabs(Direction[0]) < 1.0e-8f) ? 1.0e-8f : Direction[0]),
            1.0f / ((std::fabs(Direction[1]) < 1.0e-8f) ? 1.0e-8f : Direction[1]),
            1.0f / ((std::fabs(Direction[2]) < 1.0e-8f) ? 1.0e-8f : Direction[2])
        };

        std::uint32_t Stack[64];
        int StackPtr = 0;
        Stack[StackPtr++] = 0u;

        while (StackPtr > 0)
        {
            const SpatialBoundingCell& Cell = Cells_[Stack[--StackPtr]];
            if (!IntersectBox(Cell.Bounds, Origin, InvDir, MaxDistance))
            {
                continue;
            }
            if (Cell.TriCount > 0u)
            {
                for (std::uint32_t K = 0u; K < Cell.TriCount; ++K)
                {
                    const WorldFacetTriangle& Tri = (*Triangles_)[Order_[Cell.LeftOrFirst + K]];
                    if (Tri.Family == PgmShowcaseGlass || Tri.Family == PgmGlass)
                    {
                        continue;
                    }
                    float T = 0.0f, U = 0.0f, V = 0.0f;
                    if (IntersectTriangle(Origin, Direction, Tri, MaxDistance, T, U, V))
                    {
                        return true;
                    }
                }
            }
            else
            {
                Stack[StackPtr++] = Cell.RightIndex;
                Stack[StackPtr++] = Cell.LeftOrFirst;
            }
        }
        return false;
    }

private:
    [[nodiscard]] static bool IntersectBox(const BoundingBox3& B, const Float3& O, const Float3& InvD, float MaxT) noexcept
    {
        float TMin = 1.0e-4f;
        float TMax = MaxT;
        for (int A = 0; A < 3; ++A)
        {
            const float T0 = (B.Low[A]  - O[A]) * InvD[A];
            const float T1 = (B.High[A] - O[A]) * InvD[A];
            TMin = std::max(TMin, std::min(T0, T1));
            TMax = std::min(TMax, std::max(T0, T1));
            if (TMax < TMin)
            {
                return false;
            }
        }
        return true;
    }

    [[nodiscard]] static bool IntersectTriangle(
        const Float3&             O,
        const Float3&             D,
        const WorldFacetTriangle& Tri,
        float                     MaxT,
        float&                    OutT,
        float&                    OutU,
        float&                    OutV) noexcept
    {
        const Float3 E1  = Sub3(Tri.V1, Tri.V0);
        const Float3 E2  = Sub3(Tri.V2, Tri.V0);
        const Float3 P   = Cross3(D, E2);
        const float  Det = Dot3(E1, P);
        if (std::fabs(Det) < 1.0e-8f)
        {
            return false;
        }
        const float  InvDet = 1.0f / Det;
        const Float3 Tvec   = Sub3(O, Tri.V0);
        const float  U      = Dot3(Tvec, P) * InvDet;
        if (U < 0.0f || U > 1.0f)
        {
            return false;
        }
        const Float3 Q = Cross3(Tvec, E1);
        const float  V = Dot3(D, Q) * InvDet;
        if (V < 0.0f || U + V > 1.0f)
        {
            return false;
        }
        const float T = Dot3(E2, Q) * InvDet;
        if (T <= 1.5e-3f || T >= MaxT)
        {
            return false;
        }
        OutT = T;
        OutU = U;
        OutV = V;
        return true;
    }

    std::uint32_t BuildRecursive(std::uint32_t Begin, std::uint32_t End)
    {
        const std::uint32_t CellIndex = static_cast<std::uint32_t>(Cells_.size());
        Cells_.push_back(SpatialBoundingCell{});

        BoundingBox3 Bounds{};
        BoundingBox3 CentroidBounds{};
        for (std::uint32_t I = Begin; I < End; ++I)
        {
            Bounds.ExpandBox(TriBounds_[Order_[I]]);
            CentroidBounds.Expand(Centroids_[Order_[I]]);
        }
        Cells_[CellIndex].Bounds = Bounds;

        const std::uint32_t Count = End - Begin;
        if (Count <= 6u)
        {
            Cells_[CellIndex].LeftOrFirst = Begin;
            Cells_[CellIndex].TriCount    = Count;
            return CellIndex;
        }

        int Axis = 0;
        float BestSpan = CentroidBounds.High[0] - CentroidBounds.Low[0];
        for (int A = 1; A < 3; ++A)
        {
            const float Span = CentroidBounds.High[A] - CentroidBounds.Low[A];
            if (Span > BestSpan)
            {
                BestSpan = Span;
                Axis     = A;
            }
        }
        if (BestSpan < 1.0e-5f)
        {
            Cells_[CellIndex].LeftOrFirst = Begin;
            Cells_[CellIndex].TriCount    = Count;
            return CellIndex;
        }

        const std::uint32_t Mid = Begin + Count / 2u;
        std::nth_element(
            Order_.begin() + Begin,
            Order_.begin() + Mid,
            Order_.begin() + End,
            [&](std::uint32_t Lhs, std::uint32_t Rhs) { return Centroids_[Lhs][Axis] < Centroids_[Rhs][Axis]; });

        const std::uint32_t Left  = BuildRecursive(Begin, Mid);
        const std::uint32_t Right = BuildRecursive(Mid, End);
        Cells_[CellIndex].LeftOrFirst = Left;
        Cells_[CellIndex].RightIndex  = Right;
        Cells_[CellIndex].TriCount    = 0u;
        return CellIndex;
    }

    const std::vector<WorldFacetTriangle>* Triangles_ = nullptr;
    std::vector<std::uint32_t>             Order_;
    std::vector<Float3>                    Centroids_;
    std::vector<BoundingBox3>              TriBounds_;
    std::vector<SpatialBoundingCell>       Cells_;
};

[[nodiscard]] inline std::uint8_t AcesTonemapSrgbByte(float LinearX) noexcept
{
    const float X = std::max(0.0f, LinearX);
    const float Mapped = (X * (2.51f * X + 0.03f)) / (X * (2.43f * X + 0.59f) + 0.14f);
    const float Clamped = std::clamp(Mapped, 0.0f, 1.0f);
    const float Srgb = (Clamped <= 0.0031308f) ? (12.92f * Clamped) : (1.055f * std::pow(Clamped, 1.0f / 2.4f) - 0.055f);
    return static_cast<std::uint8_t>(std::clamp(std::lround(Srgb * 255.0f), 0l, 255l));
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                              MATERIAL SPECIFICATION TABLE
//------------------------------------------------------------------------------------------------------------------------

std::array<SurfaceReflectanceRecord, PgmMaterialLimit> ConstructProvingGroundMaterials() noexcept
{
    std::array<SurfaceReflectanceRecord, PgmMaterialLimit> Table{};
    auto Dielectric = [](float R, float G, float B, float Rough) noexcept -> SurfaceReflectanceRecord
    {
        SurfaceReflectanceRecord M{};
        M.Albedo    = { R, G, B };
        M.Roughness = Rough;
        return M;
    };
    auto Conductor = [](float R, float G, float B, float Rough) noexcept -> SurfaceReflectanceRecord
    {
        SurfaceReflectanceRecord M{};
        M.Albedo    = { R, G, B };
        M.Roughness = Rough;
        M.Metalness = 1.0f;
        return M;
    };

    Table[PgmCheckerLight]    = Dielectric(0.82f, 0.82f, 0.84f, 0.35f);
    Table[PgmCheckerDark]     = Dielectric(0.05f, 0.05f, 0.06f, 0.35f);
    Table[PgmSurround]        = Dielectric(0.35f, 0.36f, 0.38f, 0.55f);
    Table[PgmRamp]            = Dielectric(0.36f, 0.38f, 0.42f, 0.38f);
    Table[PgmBump]            = Dielectric(0.90f, 0.72f, 0.08f, 0.45f);
    Table[PgmCone]            = Dielectric(0.95f, 0.35f, 0.05f, 0.40f);

    // ControlVehicle metallic lime-gold clearcoat body paint (DriveSceneAuthor profile).
    Table[PgmBodyCoat]               = Dielectric(0.530f, 0.624f, 0.015f, 0.078f);
    Table[PgmBodyCoat].CoatWeight    = 1.0f;
    Table[PgmBodyCoat].CoatRoughness = 0.03f;
    Table[PgmBodyCoat].Metalness     = 0.38f;

    Table[PgmVehicleGlass]               = Dielectric(0.028f, 0.034f, 0.042f, 0.02f);
    Table[PgmVehicleGlass].CoatWeight    = 1.0f;
    Table[PgmVehicleGlass].CoatRoughness = 0.015f;

    Table[PgmVehiclePlastic]  = Dielectric(0.016f, 0.018f, 0.022f, 0.48f);
    Table[PgmTyre]            = Dielectric(0.037f, 0.037f, 0.039f, 0.76f);
    Table[PgmRimBase]         = Conductor(0.58f, 0.60f, 0.64f, 0.20f);
    Table[PgmHub]             = Conductor(0.10f, 0.32f, 0.78f, 0.18f);
    Table[PgmHub].RadiantOutput = { 0.0f, 0.04f, 0.14f };
    Table[PgmBrake]           = Conductor(0.52f, 0.14f, 0.06f, 0.28f);
    Table[PgmVehicleTrim]     = Conductor(0.76f, 0.77f, 0.80f, 0.24f);

    Table[PgmHeadlight]               = Dielectric(0.85f, 0.90f, 1.00f, 0.08f);
    Table[PgmHeadlight].RadiantOutput = { 16.0f, 17.5f, 20.0f };
    Table[PgmTaillight]               = Dielectric(0.85f, 0.08f, 0.05f, 0.10f);
    Table[PgmTaillight].RadiantOutput = { 9.5f, 0.25f, 0.12f };
    Table[PgmVehicleDefault]          = Dielectric(0.65f, 0.65f, 0.68f, 0.45f);

    Table[PgmWallCrimson]     = Dielectric(0.72f, 0.06f, 0.05f, 0.62f);
    Table[PgmWallViridian]    = Dielectric(0.05f, 0.52f, 0.16f, 0.65f);
    Table[PgmWallChalk]       = Dielectric(0.80f, 0.80f, 0.78f, 0.72f);
    Table[PgmWallCobalt]      = Dielectric(0.07f, 0.22f, 0.74f, 0.62f);
    Table[PgmTunnelConcrete]  = Dielectric(0.52f, 0.51f, 0.49f, 0.82f);

    Table[PgmAsphalt]         = Dielectric(0.058f, 0.060f, 0.066f, 0.78f);
    Table[PgmAsphaltPatch]    = Dielectric(0.082f, 0.080f, 0.078f, 0.74f);
    Table[PgmApronConcrete]   = Dielectric(0.42f,  0.41f,  0.39f,  0.85f);
    Table[PgmPaintWhite]      = Dielectric(0.78f,  0.78f,  0.76f,  0.52f);
    Table[PgmPaintYellow]     = Dielectric(0.82f,  0.58f,  0.06f,  0.52f);
    Table[PgmKerbRed]         = Dielectric(0.68f,  0.06f,  0.05f,  0.56f);
    Table[PgmGrass]           = Dielectric(0.09f,  0.19f,  0.06f,  0.92f);

    Table[PgmCladding]               = Dielectric(0.52f, 0.55f, 0.58f, 0.38f);
    Table[PgmCladding].Metalness     = 0.65f;
    Table[PgmContainerOrange] = Dielectric(0.76f, 0.24f, 0.04f, 0.52f);
    Table[PgmContainerBlue]   = Dielectric(0.05f, 0.16f, 0.46f, 0.52f);
    Table[PgmContainerRed]    = Dielectric(0.58f, 0.06f, 0.05f, 0.45f);
    Table[PgmSteelDark]       = Conductor(0.18f, 0.19f, 0.21f, 0.34f);

    Table[PgmLampWarm]               = Dielectric(0.95f, 0.85f, 0.65f, 0.25f);
    Table[PgmLampWarm].RadiantOutput = { 8.5f, 6.2f, 3.1f };
    Table[PgmLampCool]               = Dielectric(0.90f, 0.95f, 1.00f, 0.25f);
    Table[PgmLampCool].RadiantOutput = { 7.5f, 8.8f, 10.5f };

    Table[PgmBarrierConcrete] = Dielectric(0.50f, 0.49f, 0.47f, 0.84f);
    Table[PgmGlass]           = Dielectric(0.08f, 0.14f, 0.18f, 0.04f);
    Table[PgmConeOrange]      = Dielectric(0.96f, 0.32f, 0.04f, 0.42f);
    Table[PgmConeBand]        = Dielectric(0.88f, 0.89f, 0.92f, 0.28f);
    Table[PgmConeBase]        = Dielectric(0.04f, 0.04f, 0.05f, 0.82f);

    Table[PgmGateLamp]               = Dielectric(0.20f, 0.90f, 0.35f, 0.20f);
    Table[PgmGateLamp].RadiantOutput = { 0.4f, 6.5f, 1.4f };
    Table[PgmGateLampRed]               = Dielectric(0.90f, 0.15f, 0.12f, 0.20f);
    Table[PgmGateLampRed].RadiantOutput = { 7.2f, 0.35f, 0.25f };

    Table[PgmSteeringWheel]   = Dielectric(0.05f, 0.05f, 0.06f, 0.42f);
    Table[PgmDisplayGlass]    = Dielectric(0.03f, 0.08f, 0.14f, 0.05f);
    Table[PgmDisplayGlass].RadiantOutput = { 0.08f, 0.35f, 0.55f };

    // Materials garden reference showcase materials.
    Table[PgmMirror]                 = Conductor(0.96f, 0.97f, 0.98f, 0.015f);
    Table[PgmAluminium]              = Conductor(0.913f, 0.921f, 0.925f, 0.06f);
    Table[PgmGold]                   = Conductor(1.000f, 0.766f, 0.336f, 0.07f);
    Table[PgmShowcaseGlass]          = Dielectric(0.96f, 0.99f, 1.00f, 0.015f);
    Table[PgmShowcaseGlass].Transmission  = 0.92f;
    Table[PgmShowcaseGlass].RefractiveIdx = 1.52f;

    return Table;
}

//------------------------------------------------------------------------------------------------------------------------
//                                             FCT1 BINARY FACET ARCHIVE LOADER
//------------------------------------------------------------------------------------------------------------------------

bool LoadFacetArchiveFromFile(const std::string& FilePath, FacetArchiveSurface& OutArchive)
{
    std::ifstream Stream(FilePath, std::ios::binary);
    if (!Stream.good())
    {
        return false;
    }

    char Magic[4] = {};
    Stream.read(Magic, 4);
    if (std::memcmp(Magic, "FCT1", 4) != 0)
    {
        return false;
    }

    std::uint32_t Header[3] = {};
    float         Bounds[6] = {};
    std::uint32_t Reserved[2] = {};
    Stream.read(reinterpret_cast<char*>(Header),   sizeof(Header));
    Stream.read(reinterpret_cast<char*>(Bounds),   sizeof(Bounds));
    Stream.read(reinterpret_cast<char*>(Reserved), sizeof(Reserved));
    if (!Stream.good() || Header[0] == 0u || Header[1] == 0u || Header[0] > 200000u || Header[1] > 400000u)
    {
        return false;
    }

    OutArchive.VertexCount   = Header[0];
    OutArchive.FacetCount    = Header[1];
    OutArchive.BoundsMinimum = { Bounds[0], Bounds[1], Bounds[2] };
    OutArchive.BoundsMaximum = { Bounds[3], Bounds[4], Bounds[5] };

    OutArchive.Positions.resize(static_cast<std::size_t>(OutArchive.VertexCount) * 3u);
    OutArchive.Indices.resize(static_cast<std::size_t>(OutArchive.FacetCount) * 3u);
    OutArchive.Families.resize(OutArchive.FacetCount);

    Stream.read(reinterpret_cast<char*>(OutArchive.Positions.data()),
                static_cast<std::streamsize>(OutArchive.Positions.size() * sizeof(float)));
    Stream.read(reinterpret_cast<char*>(OutArchive.Indices.data()),
                static_cast<std::streamsize>(OutArchive.Indices.size() * sizeof(std::uint32_t)));
    Stream.read(reinterpret_cast<char*>(OutArchive.Families.data()),
                static_cast<std::streamsize>(OutArchive.Families.size() * sizeof(std::uint32_t)));

    if ((Header[2] & 1u) != 0u)
    {
        OutArchive.CornerNormals.resize(static_cast<std::size_t>(OutArchive.FacetCount) * 9u);
        Stream.read(reinterpret_cast<char*>(OutArchive.CornerNormals.data()),
                    static_cast<std::streamsize>(OutArchive.CornerNormals.size() * sizeof(float)));
    }
    else
    {
        OutArchive.CornerNormals.clear();
    }

    return Stream.good();
}

ControlVehicleArchives LoadControlVehicleArchives(const std::string& GeometryDirectory)
{
    ControlVehicleArchives Archives{};
    const bool BodyOk = LoadFacetArchiveFromFile(GeometryDirectory + "/ControlVehicleBody.facet", Archives.Body);
    const bool RimOk  = LoadFacetArchiveFromFile(GeometryDirectory + "/ControlVehicleRim.facet",  Archives.Rim);
    const bool TyreOk = LoadFacetArchiveFromFile(GeometryDirectory + "/ControlVehicleTyre.facet", Archives.Tyre);
    Archives.Valid = BodyOk && RimOk && TyreOk;
    return Archives;
}

//------------------------------------------------------------------------------------------------------------------------
//                                      STATIC VEHICLEHMI PROVING GROUNDS ARCHITECTURE
//------------------------------------------------------------------------------------------------------------------------

void BuildStaticVehicleHmiProvingGrounds(
    std::vector<WorldFacetTriangle>& OutTriangles,
    float                            RampNearX)
{
    OutTriangles.clear();
    OutTriangles.reserve(14000u);

    // 1. Grass surround + 216 m x 120 m asphalt proving pad + road markings.
    AppendQuadOutward(OutTriangles,
                      { -220.0f, -220.0f, -0.02f }, { 260.0f, -220.0f, -0.02f },
                      {  260.0f,  220.0f, -0.02f }, { -220.0f,  220.0f, -0.02f }, PgmGrass);

    constexpr float PadMinX = -60.0f, PadMaxX = 156.0f;
    constexpr float PadMinY = -60.0f, PadMaxY =  60.0f;
    constexpr float Cell    = 8.0f;
    const int Rows = static_cast<int>((PadMaxX - PadMinX) / Cell);
    const int Cols = static_cast<int>((PadMaxY - PadMinY) / Cell);
    for (int R = 0; R < Rows; ++R)
    {
        for (int C = 0; C < Cols; ++C)
        {
            const float X0 = PadMinX + static_cast<float>(R) * Cell;
            const float X1 = X0 + Cell;
            const float Y0 = PadMinY + static_cast<float>(C) * Cell;
            const float Y1 = Y0 + Cell;
            const float Hash = std::fmod(std::fabs(std::sin(static_cast<float>(R) * 12.9898f + static_cast<float>(C) * 78.233f) * 43758.5453f), 1.0f);
            const std::uint32_t Mat = (Hash < 0.14f) ? PgmAsphaltPatch : PgmAsphalt;
            AppendQuadOutward(OutTriangles, { X0, Y0, 0.0f }, { X1, Y0, 0.0f }, { X1, Y1, 0.0f }, { X0, Y1, 0.0f }, Mat);
        }
    }

    auto RoadPaint = [&](float X0, float Y0, float X1, float Y1, std::uint32_t Mat)
    {
        AppendQuadOutward(OutTriangles, { X0, Y0, 0.005f }, { X1, Y0, 0.005f }, { X1, Y1, 0.005f }, { X0, Y1, 0.005f }, Mat);
    };
    RoadPaint(-54.0f,  5.70f, 52.0f,  5.92f, PgmPaintWhite);
    RoadPaint(-54.0f, -5.92f, 52.0f, -5.70f, PgmPaintWhite);
    RoadPaint(-36.2f, -5.70f, -35.6f, 5.70f, PgmPaintWhite);
    for (int Dash = 0; Dash < 16; ++Dash)
    {
        const float X0 = -50.0f + static_cast<float>(Dash) * 6.2f;
        RoadPaint(X0, -0.10f, X0 + 3.0f, 0.10f, PgmPaintYellow);
    }

    // 2. North & south alternating red/white kerbs + Jump Ramp wedge.
    for (int Strip = 0; Strip < 2; ++Strip)
    {
        const float Ky = (Strip == 0) ? 6.15f : -6.15f;
        for (int Seg = 0; Seg < 18; ++Seg)
        {
            const float Kx = -50.0f + static_cast<float>(Seg) * 4.0f;
            const std::uint32_t Mat = (Seg & 1) ? PgmPaintWhite : PgmKerbRed;
            AppendSolidBox(OutTriangles, { Kx, Ky, 0.0f }, 4.0f, 0.32f, 0.12f, 0.0f, Mat);
        }
    }
    // Also retain Project-Drive inner kerb at y = +3.35 m.
    AppendSolidBox(OutTriangles, { 6.0f, 3.35f, 0.0f }, 40.0f, 0.30f, 0.12f, 0.0f, PgmKerbRed);

    {
        const float Near = RampNearX;
        const float Far  = RampNearX + CourseConstants::RampRunX;
        const float Rise = CourseConstants::RampRise;
        const float W    = CourseConstants::RampHalfWidth;
        AppendQuadOutward(OutTriangles, { Near, -W, 0.0f }, { Far, -W, Rise }, { Far,  W, Rise }, { Near,  W, 0.0f }, PgmRamp);
        AppendQuadOutward(OutTriangles, { Far,  -W, 0.0f }, { Far,  W, 0.0f }, { Far,  W, Rise }, { Far,  -W, Rise }, PgmRamp);
        AppendTriangleAutoNormal(OutTriangles, { Near, -W, 0.0f }, { Far, -W, 0.0f }, { Far, -W, Rise }, PgmRamp);
        AppendTriangleAutoNormal(OutTriangles, { Near,  W, 0.0f }, { Far,  W, Rise }, { Far,  W, 0.0f }, PgmRamp);
    }

    // 3. Perimeter & Smash Alley Jersey barriers.
    for (float X = -56.0f; X <= 152.0f; X += 8.0f)
    {
        AppendSolidBox(OutTriangles, { X,  58.5f, 0.0f }, 7.6f, 0.55f, 0.82f, 0.0f, PgmBarrierConcrete);
        AppendSolidBox(OutTriangles, { X, -58.5f, 0.0f }, 7.6f, 0.55f, 0.82f, 0.0f, PgmBarrierConcrete);
    }
    for (float Y = -52.0f; Y <= 52.0f; Y += 8.0f)
    {
        AppendSolidBox(OutTriangles, { -58.5f, Y, 0.0f }, 7.6f, 0.55f, 0.82f, 90.0f * DegToRadScalar, PgmBarrierConcrete);
        AppendSolidBox(OutTriangles, { 154.5f, Y, 0.0f }, 7.6f, 0.55f, 0.82f, 90.0f * DegToRadScalar, PgmBarrierConcrete);
    }
    for (int B = 0; B < 14; ++B)
    {
        const float X = -6.0f + 3.5f * static_cast<float>(B);
        AppendSolidBox(OutTriangles, { X, -19.6f, 0.0f }, 3.2f, 0.50f, 0.80f, 0.0f, PgmBarrierConcrete);
        AppendSolidBox(OutTriangles, { X, -34.4f, 0.0f }, 3.2f, 0.50f, 0.80f, 0.0f, PgmBarrierConcrete);
    }

    // 4. Garage / Hangar (crimson back wall, cladding side walls, slatted roof, 6 lamp strips, red cabinets, tyre stacks).
    for (int P = 0; P < 7; ++P)
    {
        const float X = 22.0f + 4.0f * static_cast<float>(P);
        AppendOrientedBox(OutTriangles, { X, 46.2f, 0.0f }, 4.0f, 0.40f, 8.0f, 0.0f,
                          { PgmCladding, PgmCladding, PgmCladding, PgmCladding, PgmCladding, PgmWallCrimson });
    }
    for (int P = 0; P < 4; ++P)
    {
        const float Y = 32.0f + 4.0f * static_cast<float>(P);
        AppendSolidBox(OutTriangles, { 19.8f, Y, 0.0f }, 4.0f, 0.40f, 8.0f,  90.0f * DegToRadScalar, PgmCladding);
        AppendSolidBox(OutTriangles, { 48.2f, Y, 0.0f }, 4.0f, 0.40f, 8.0f, -90.0f * DegToRadScalar, PgmCladding);
    }
    for (int Slat = 0; Slat < 6; ++Slat)
    {
        const float Y = 31.0f + 3.0f * static_cast<float>(Slat);
        AppendSolidBox(OutTriangles, { 34.0f, Y, 8.00f }, 28.8f, 2.00f, 0.30f, 0.0f, PgmCladding);
        AppendSolidBox(OutTriangles, { 34.0f, Y, 7.82f }, 24.0f, 0.25f, 0.12f, 0.0f, PgmLampCool);
    }
    for (float X : { 24.0f, 27.0f, 41.0f, 44.0f })
    {
        AppendSolidBox(OutTriangles, { X, 45.3f, 0.0f }, 2.0f, 0.60f, 1.80f, 0.0f, PgmContainerRed);
    }
    AppendCylinderStack(OutTriangles, { 46.6f, 43.8f, 0.0f }, 0.34f, 1.20f, 12, PgmTyre);
    AppendCylinderStack(OutTriangles, { 45.8f, 43.5f, 0.0f }, 0.34f, 1.20f, 12, PgmTyre);

    // 5. South Tunnel (cobalt & chalk GI walls, roof slabs, 8 tunnel lamps).
    for (int Seg = 0; Seg < 8; ++Seg)
    {
        const float X = -26.0f + 4.0f * static_cast<float>(Seg);
        AppendSolidBox(OutTriangles, { X, -43.75f, 0.0f }, 4.0f, 0.50f, 4.50f, 0.0f, PgmWallCobalt);
        AppendSolidBox(OutTriangles, { X, -52.25f, 0.0f }, 4.0f, 0.50f, 4.50f, 0.0f, PgmWallChalk);
        AppendSolidBox(OutTriangles, { X, -48.00f, 4.5f }, 4.0f, 9.00f, 0.50f, 0.0f, PgmTunnelConcrete);
        if ((Seg % 2) == 0)
        {
            AppendSolidBox(OutTriangles, { X, -44.10f, 3.6f }, 3.0f, 0.14f, 0.16f, 0.0f, PgmLampCool);
            AppendSolidBox(OutTriangles, { X, -51.90f, 3.6f }, 3.0f, 0.14f, 0.16f, 0.0f, PgmLampCool);
        }
    }

    // 6. Control Tower.
    AppendSolidBox(OutTriangles, { -54.0f, -11.0f,  0.0f }, 5.0f, 5.0f, 9.0f, 0.0f, PgmBarrierConcrete);
    AppendSolidBox(OutTriangles, { -54.0f, -11.0f,  9.0f }, 6.5f, 6.5f, 2.6f, 0.0f, PgmGlass);
    AppendSolidBox(OutTriangles, { -54.0f, -11.0f, 11.6f }, 7.5f, 7.5f, 0.4f, 0.0f, PgmSteelDark);

    // 7. Materials Garden (Aluminium sphere, Gold sphere, ShowcaseGlass sphere, and Standing Mirror — placed both at
    //    LevelStructure's [-34..-26.5, +11.5] AND mirrored alongside the main showcase straight [-6..+2, +7.6] so chase
    //    and hero cameras catch live reflections of ControlVehicle, clouds, and smoke!).
    auto PlaceMaterialsGarden = [&](float BaseX, float BaseY)
    {
        AppendUvSphere(OutTriangles, { BaseX + 0.0f, BaseY, 0.60f }, 0.60f, 14, 22, PgmAluminium);
        AppendUvSphere(OutTriangles, { BaseX + 2.4f, BaseY, 0.60f }, 0.60f, 14, 22, PgmGold);
        AppendUvSphere(OutTriangles, { BaseX + 4.8f, BaseY, 0.60f }, 0.60f, 14, 22, PgmShowcaseGlass);
        AppendOrientedBox(OutTriangles, { BaseX + 7.6f, BaseY + 0.4f, 0.0f }, 2.6f, 0.16f, 2.1f, 0.0f,
                          { PgmSteelDark, PgmSteelDark, PgmSteelDark, PgmSteelDark, PgmSteelDark, PgmMirror });
    };
    PlaceMaterialsGarden(-34.0f, 11.5f);
    PlaceMaterialsGarden( -5.5f,  7.8f);

    // 8. Traffic Light Fixtures & Roadway Batwing Streetlamp Poles.
    const float TrafficSites[6][3] = {
        { -36.0f,  8.5f,    0.0f }, { -36.0f, -8.5f,    0.0f },
        {   4.0f,  8.5f,    0.0f }, {   4.0f, -8.5f,    0.0f },
        {  64.0f, 18.0f,  -90.0f }, {  18.0f, 26.0f,    0.0f }
    };
    for (const auto& T : TrafficSites)
    {
        const float Yaw = T[2] * DegToRadScalar;
        AppendSolidBox(OutTriangles, { T[0], T[1], 0.0f }, 0.16f, 0.16f, 3.8f, Yaw, PgmSteelDark);
        AppendSolidBox(OutTriangles, { T[0] + 0.25f * std::cos(Yaw), T[1] + 0.25f * std::sin(Yaw), 2.5f },
                       0.30f, 0.40f, 1.20f, Yaw, PgmSteelDark);
        AppendSolidBox(OutTriangles, { T[0] + 0.41f * std::cos(Yaw), T[1] + 0.41f * std::sin(Yaw), 3.32f },
                       0.04f, 0.26f, 0.26f, Yaw, PgmGateLampRed);
        AppendSolidBox(OutTriangles, { T[0] + 0.41f * std::cos(Yaw), T[1] + 0.41f * std::sin(Yaw), 2.96f },
                       0.04f, 0.26f, 0.26f, Yaw, PgmLampWarm);
        AppendSolidBox(OutTriangles, { T[0] + 0.41f * std::cos(Yaw), T[1] + 0.41f * std::sin(Yaw), 2.60f },
                       0.04f, 0.26f, 0.26f, Yaw, PgmGateLamp);
    }

    const float StreetPoles[14][3] = {
        { -45.0f,  10.0f, -90.0f }, { -15.0f,  10.0f, -90.0f }, {  15.0f,  10.0f, -90.0f }, {  45.0f,  10.0f, -90.0f },
        { -30.0f, -10.0f,  90.0f }, {   0.0f, -10.0f,  90.0f }, {  30.0f, -10.0f,  90.0f }, { -48.0f,  30.0f,   0.0f },
        {   8.0f,  30.0f,   0.0f }, {  20.0f, -38.0f,  90.0f }, {  85.0f,  -8.0f, 180.0f }, {  85.0f,  24.0f, 180.0f },
        { 115.0f,  -8.0f,   0.0f }, { 115.0f,  24.0f,   0.0f }
    };
    for (const auto& P : StreetPoles)
    {
        const float Yaw = P[2] * DegToRadScalar;
        AppendSolidBox(OutTriangles, { P[0], P[1], 0.0f }, 0.28f, 0.28f, 10.8f, Yaw, PgmSteelDark);
        AppendOrientedBox(OutTriangles,
                          { P[0] + 0.75f * std::cos(Yaw), P[1] + 0.75f * std::sin(Yaw), 10.6f },
                          1.80f, 0.60f, 0.28f, Yaw,
                          { PgmSteelDark, PgmLampWarm, PgmSteelDark, PgmSteelDark, PgmSteelDark, PgmSteelDark });
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                  DYNAMIC CONTROLVEHICLE + DEFORMED TYRES + JOLT CONES
//------------------------------------------------------------------------------------------------------------------------

void AppendDynamicVehicleAndCones(
    const DriveSnapshot&                Snapshot,
    const ControlVehicleArchives&       Archives,
    const ProjectDriveTyreVisualBridge* TyreBridge,
    DemoTyreVisualMode                  TyreMode,
    const std::array<double, 4>&        GaugePressuresPa,
    std::vector<WorldFacetTriangle>&    OutTriangles)
{
    // 1. Dynamic Jolt slalom cones (shifted -0.275 m from cylinder CoM to cone base).
    for (std::size_t C = 0u; C < Snapshot.ConeWorld.size(); ++C)
    {
        AppendEn13422Cone(OutTriangles, Snapshot.ConeWorld[C], -0.5f * CourseConstants::ConeHeight);
    }

    if (!Archives.Valid)
    {
        return;
    }

    // 2. ControlVehicle body (2,924 facets) rebased by CoM Z + steering-wheel articulation + roof slim LED lightbar.
    const float SteerAngle = Snapshot.Telemetry.Wheels[0].SteerAngleRad * 9.0f;
    const Float3 ColumnPivot = { 0.42f, 0.36f, 0.62f };
    const Float3 ColumnAxis  = Normalize3({ -0.94f, 0.0f, 0.34f });

    auto TurnAboutColumn = [&](const Float3& V, bool IsPoint) noexcept -> Float3
    {
        const Float3 Rel = IsPoint ? Sub3(V, ColumnPivot) : V;
        const float Cs   = std::cos(SteerAngle);
        const float Sn   = std::sin(SteerAngle);
        const Float3 Cr  = Cross3(ColumnAxis, Rel);
        const float  Dt  = Dot3(ColumnAxis, Rel);
        const Float3 Rot = {
            Rel[0] * Cs + Cr[0] * Sn + ColumnAxis[0] * Dt * (1.0f - Cs),
            Rel[1] * Cs + Cr[1] * Sn + ColumnAxis[1] * Dt * (1.0f - Cs),
            Rel[2] * Cs + Cr[2] * Sn + ColumnAxis[2] * Dt * (1.0f - Cs)
        };
        return IsPoint ? Add3(ColumnPivot, Rot) : Rot;
    };

    // Precompute smooth vertex normals for ControlVehicleBody where corner normals are omitted.
    std::vector<Float3> BodySmoothNormals(Archives.Body.VertexCount, { 0.0f, 0.0f, 0.0f });
    for (std::uint32_t F = 0u; F < Archives.Body.FacetCount; ++F)
    {
        const std::uint32_t I0 = Archives.Body.Indices[F * 3u + 0u];
        const std::uint32_t I1 = Archives.Body.Indices[F * 3u + 1u];
        const std::uint32_t I2 = Archives.Body.Indices[F * 3u + 2u];
        const Float3 P0 = { Archives.Body.Positions[I0 * 3u], Archives.Body.Positions[I0 * 3u + 1u], Archives.Body.Positions[I0 * 3u + 2u] };
        const Float3 P1 = { Archives.Body.Positions[I1 * 3u], Archives.Body.Positions[I1 * 3u + 1u], Archives.Body.Positions[I1 * 3u + 2u] };
        const Float3 P2 = { Archives.Body.Positions[I2 * 3u], Archives.Body.Positions[I2 * 3u + 1u], Archives.Body.Positions[I2 * 3u + 2u] };
        const Float3 Fn = Cross3(Sub3(P1, P0), Sub3(P2, P0));
        for (std::uint32_t Idx : { I0, I1, I2 })
        {
            BodySmoothNormals[Idx] = Add3(BodySmoothNormals[Idx], Fn);
        }
    }
    for (Float3& N : BodySmoothNormals)
    {
        N = Normalize3(N);
    }

    for (std::uint32_t F = 0u; F < Archives.Body.FacetCount; ++F)
    {
        const std::uint32_t Fam = std::min<std::uint32_t>(Archives.Body.Families[F], PgmMaterialLimit - 1u);
        const std::uint32_t Idx[3] = {
            Archives.Body.Indices[F * 3u + 0u],
            Archives.Body.Indices[F * 3u + 1u],
            Archives.Body.Indices[F * 3u + 2u]
        };
        Float3 WP[3]{}, WN[3]{};
        for (int C = 0; C < 3; ++C)
        {
            Float3 LP = {
                Archives.Body.Positions[Idx[C] * 3u + 0u],
                Archives.Body.Positions[Idx[C] * 3u + 1u],
                Archives.Body.Positions[Idx[C] * 3u + 2u] - BodyCoMRebaseZ
            };
            Float3 LN = BodySmoothNormals[Idx[C]];
            if (Fam == PgmSteeringWheel)
            {
                LP = TurnAboutColumn(LP, true);
                LN = TurnAboutColumn(LN, false);
            }
            WP[C] = TransformPointMat4(Snapshot.ChassisWorld, LP);
            WN[C] = TransformNormalMat4(Snapshot.ChassisWorld, LN);
        }
        OutTriangles.push_back(WorldFacetTriangle{ WP[0], WP[1], WP[2], WN[0], WN[1], WN[2], Fam });
    }

    // Roof slim LED auxiliary lightbar on ControlVehicle roof.
    auto AppendBodyBox = [&](const Float3& LocalCentre, float Sx, float Sy, float Sz, std::uint32_t Fam)
    {
        std::vector<WorldFacetTriangle> LocalTris;
        AppendSolidBox(LocalTris, { LocalCentre[0], LocalCentre[1], LocalCentre[2] - 0.5f * Sz - BodyCoMRebaseZ }, Sx, Sy, Sz, 0.0f, Fam);
        for (WorldFacetTriangle& T : LocalTris)
        {
            T.V0 = TransformPointMat4(Snapshot.ChassisWorld, T.V0);
            T.V1 = TransformPointMat4(Snapshot.ChassisWorld, T.V1);
            T.V2 = TransformPointMat4(Snapshot.ChassisWorld, T.V2);
            T.N0 = TransformNormalMat4(Snapshot.ChassisWorld, T.N0);
            T.N1 = TransformNormalMat4(Snapshot.ChassisWorld, T.N1);
            T.N2 = TransformNormalMat4(Snapshot.ChassisWorld, T.N2);
            OutTriangles.push_back(T);
        }
    };
    AppendBodyBox({ 0.25f,  0.44f, 1.35f }, 0.10f, 0.04f, 0.05f, PgmSteelDark);
    AppendBodyBox({ 0.25f, -0.44f, 1.35f }, 0.10f, 0.04f, 0.05f, PgmSteelDark);
    AppendBodyBox({ 0.25f,  0.00f, 1.38f }, 0.12f, 0.94f, 0.07f, PgmVehiclePlastic);
    AppendBodyBox({ 0.31f,  0.00f, 1.38f }, 0.02f, 0.88f, 0.05f, PgmHeadlight);

    // 3. Four wheels: ControlVehicleRim (1,568 facets each) + live-deformed ControlVehicleTyre (3,968 facets each).
    for (int W = 0; W < 4; ++W)
    {
        const Frontier::Mat4& WheelM   = Snapshot.WheelWorld[static_cast<std::size_t>(W)];
        const bool            RightSide = (W == 1 || W == 3);
        const float           MirrorY   = RightSide ? -1.0f : 1.0f;

        // Rim facets (mirror Y on right-hand side so spokes face outward symmetrically).
        for (std::uint32_t F = 0u; F < Archives.Rim.FacetCount; ++F)
        {
            const std::uint32_t RawFam = Archives.Rim.Families[F];
            const std::uint32_t Fam    = (RawFam == PgmTyre) ? PgmRimBase : std::min<std::uint32_t>(RawFam, PgmMaterialLimit - 1u);
            const int Order[3] = { 0, RightSide ? 2 : 1, RightSide ? 1 : 2 };
            Float3 WP[3]{}, WN[3]{};
            for (int K = 0; K < 3; ++K)
            {
                const int C = Order[K];
                const std::uint32_t Vi = Archives.Rim.Indices[F * 3u + static_cast<std::uint32_t>(C)];
                const Float3 LP = {
                    Archives.Rim.Positions[Vi * 3u + 0u],
                    Archives.Rim.Positions[Vi * 3u + 1u] * MirrorY,
                    Archives.Rim.Positions[Vi * 3u + 2u]
                };
                const Float3 LN = (!Archives.Rim.CornerNormals.empty())
                    ? Float3{
                          Archives.Rim.CornerNormals[F * 9u + static_cast<std::uint32_t>(C) * 3u + 0u],
                          Archives.Rim.CornerNormals[F * 9u + static_cast<std::uint32_t>(C) * 3u + 1u] * MirrorY,
                          Archives.Rim.CornerNormals[F * 9u + static_cast<std::uint32_t>(C) * 3u + 2u]
                      }
                    : Float3{ 0.0f, MirrorY, 0.0f };
                WP[K] = TransformPointMat4(WheelM, LP);
                WN[K] = TransformNormalMat4(WheelM, LN);
            }
            OutTriangles.push_back(WorldFacetTriangle{ WP[0], WP[1], WP[2], WN[0], WN[1], WN[2], Fam });
        }

        // Deformed Tyre facets (Spring / 160-Node XPBD / 128-Hex8 3D Neo-Hookean FEM).
        const Vehicle::WheelTelemetry& Wt = Snapshot.Telemetry.Wheels[W];
        // Project world ground-down direction into the spun wheel frame to locate exact contact patch angle.
        const Float3 WheelX = { WheelM.Columns[0][0], WheelM.Columns[0][1], WheelM.Columns[0][2] };
        const Float3 WheelZ = { WheelM.Columns[2][0], WheelM.Columns[2][1], WheelM.Columns[2][2] };
        const Float3 DownW  = Wt.InContact
            ? Float3{ -Wt.ContactNormal.x, -Wt.ContactNormal.y, -Wt.ContactNormal.z }
            : Float3{ 0.0f, 0.0f, -1.0f };

        TyreDeformationRecord Deform{};
        Deform.ContactAngle      = std::atan2(Dot3(DownW, WheelZ), Dot3(DownW, WheelX));
        Deform.Deflection        = Wt.InContact
            ? std::clamp((Wt.TyreDeflection > 1.0e-5f) ? Wt.TyreDeflection : (Wt.VerticalLoad / 225000.0f), 0.0f, 0.055f)
            : 0.0f;
        Deform.GaugePressure     = static_cast<float>(GaugePressuresPa[static_cast<std::size_t>(W)]);
        Deform.LateralDistortion = Wt.InContact ? std::clamp(-Wt.LateralForce / 135000.0f, -0.038f, 0.038f) : 0.0f;
        Deform.Shredded          = false;

        for (std::uint32_t F = 0u; F < Archives.Tyre.FacetCount; ++F)
        {
            Float3 WP[3]{}, WN[3]{};
            for (int C = 0; C < 3; ++C)
            {
                const std::uint32_t Vi = Archives.Tyre.Indices[F * 3u + static_cast<std::uint32_t>(C)];
                const float InPos[3] = {
                    Archives.Tyre.Positions[Vi * 3u + 0u],
                    Archives.Tyre.Positions[Vi * 3u + 1u],
                    Archives.Tyre.Positions[Vi * 3u + 2u]
                };
                const float SrcNrm[3] = {
                    (!Archives.Tyre.CornerNormals.empty()) ? Archives.Tyre.CornerNormals[F * 9u + static_cast<std::uint32_t>(C) * 3u + 0u] : 0.0f,
                    (!Archives.Tyre.CornerNormals.empty()) ? Archives.Tyre.CornerNormals[F * 9u + static_cast<std::uint32_t>(C) * 3u + 1u] : 0.0f,
                    (!Archives.Tyre.CornerNormals.empty()) ? Archives.Tyre.CornerNormals[F * 9u + static_cast<std::uint32_t>(C) * 3u + 2u] : 1.0f
                };
                float OutPos[3]{}, OutNrm[3]{};

                if (TyreBridge != nullptr && TyreMode == DemoTyreVisualMode::Solid)
                {
                    ResolveContinuumWheelVertex(
                        Deform, true,
                        TyreBridge->Solid(W).QueryRestPositions(),
                        TyreBridge->Solid(W).QueryLocalPositions(),
                        InPos, SrcNrm, OutPos, OutNrm);
                }
                else if (TyreBridge != nullptr && TyreMode == DemoTyreVisualMode::Projection)
                {
                    ResolveContinuumWheelVertex(
                        Deform, true,
                        TyreBridge->Projection(W).QueryRestPositions(),
                        TyreBridge->Projection(W).QueryLocalPositions(),
                        InPos, SrcNrm, OutPos, OutNrm);
                }
                else
                {
                    ResolveDeformedWheelVertex(Deform, true, InPos, SrcNrm, OutPos, OutNrm);
                }

                WP[C] = TransformPointMat4(WheelM, { OutPos[0], OutPos[1], OutPos[2] });
                WN[C] = TransformNormalMat4(WheelM, { OutNrm[0], OutNrm[1], OutNrm[2] });
            }
            OutTriangles.push_back(WorldFacetTriangle{ WP[0], WP[1], WP[2], WN[0], WN[1], WN[2], PgmTyre });
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                  TIGHT-CLUSTERED PROVING GROUND PHOTOMETRIC LUMINAIRES
//------------------------------------------------------------------------------------------------------------------------

void PopulateProvingGroundPhotometricLights(
    const DriveSnapshot&                         Snapshot,
    const ShowcaseEnvironmentSettings&           Settings,
    std::vector<AnalyticLuminaireSpecification>& OutLuminaires,
    PhotometricLights&                  OutClusters)
{
    OutLuminaires.clear();

    // Build reusable Type-C LM-63 automotive beam & roadway batwing candela distributions.
    std::istringstream AutomotiveIesStream(
        "IESNA:LM-63-2002\nTILT=NONE\n1 1000 1.0 7 1 1 2 0.1 0.1 0.1 1.0 1.0 0.0\n"
        "0 8 18 32 50 90 180\n0\n1000 920 640 220 30 0 0\n");
    const CandelaDistribution AutomotiveBeam = CandelaDistribution::Read(AutomotiveIesStream);

    std::istringstream BatwingIesStream(
        "IESNA:LM-63-2002\nTILT=NONE\n1 1000 1.0 7 1 1 2 0.2 0.2 0.1 1.0 1.0 0.0\n"
        "0 25 52 68 78 90 180\n0\n550 780 1000 620 80 0 0\n");
    const CandelaDistribution RoadwayBatwing = CandelaDistribution::Read(BatwingIesStream);

    if (Settings.HeadlightsActive)
    {
        const Float3 Fwd = Normalize3({
            Snapshot.ChassisWorld.Columns[0][0],
            Snapshot.ChassisWorld.Columns[0][1],
            Snapshot.ChassisWorld.Columns[0][2] - 0.06f
        });
        const Float3 Up = Normalize3({
            Snapshot.ChassisWorld.Columns[2][0],
            Snapshot.ChassisWorld.Columns[2][1],
            Snapshot.ChassisWorld.Columns[2][2]
        });

        for (float SideY : { 0.65f, -0.65f })
        {
            const Float3 Pos = TransformPointMat4(Snapshot.ChassisWorld, { 2.35f, SideY, 0.22f });
            AnalyticLuminaireSpecification Beam{};
            Beam.Category        = AnalyticLuminaireCategory::Spot;
            Beam.Position        = { Pos[0], Pos[1], Pos[2] };
            Beam.ReachRadiusM    = 68.0;
            Beam.IntensityRgb    = { 85.0, 92.0, 105.0 };
            Beam.ForwardAxis     = { Fwd[0], Fwd[1], Fwd[2] };
            Beam.UpAxis          = { Up[0], Up[1], Up[2] };
            Beam.InnerConeCosine = std::cos(18.0 * PiScalar / 180.0);
            Beam.OuterConeCosine = std::cos(42.0 * PiScalar / 180.0);
            Beam.Photometry      = AutomotiveBeam;
            OutLuminaires.push_back(Beam);
        }

        // Roof slim LED floodlight bar.
        const Float3 RoofPos = TransformPointMat4(Snapshot.ChassisWorld, { 0.32f, 0.0f, 1.28f });
        AnalyticLuminaireSpecification RoofBar{};
        RoofBar.Category        = AnalyticLuminaireCategory::Spot;
        RoofBar.Position        = { RoofPos[0], RoofPos[1], RoofPos[2] };
        RoofBar.ReachRadiusM    = 85.0;
        RoofBar.IntensityRgb    = { 110.0, 120.0, 135.0 };
        RoofBar.ForwardAxis     = { Fwd[0], Fwd[1], Fwd[2] };
        RoofBar.UpAxis          = { Up[0], Up[1], Up[2] };
        RoofBar.InnerConeCosine = std::cos(24.0 * PiScalar / 180.0);
        RoofBar.OuterConeCosine = std::cos(48.0 * PiScalar / 180.0);
        RoofBar.Photometry      = AutomotiveBeam;
        OutLuminaires.push_back(RoofBar);

        // Taillight local red road glow.
        for (float SideY : { 0.68f, -0.68f })
        {
            const Float3 TailPos = TransformPointMat4(Snapshot.ChassisWorld, { -2.85f, SideY, 0.36f });
            AnalyticLuminaireSpecification Tail{};
            Tail.Category        = AnalyticLuminaireCategory::Spot;
            Tail.Position        = { TailPos[0], TailPos[1], TailPos[2] };
            Tail.ReachRadiusM    = 14.0;
            Tail.IntensityRgb    = { 14.0, 0.8, 0.5 };
            Tail.ForwardAxis     = { -Fwd[0], -Fwd[1], -0.25 };
            Tail.UpAxis          = { 0.0, 0.0, 1.0 };
            Tail.InnerConeCosine = std::cos(35.0 * PiScalar / 180.0);
            Tail.OuterConeCosine = std::cos(70.0 * PiScalar / 180.0);
            OutLuminaires.push_back(Tail);
        }
    }

    if (Settings.StreetlampsActive)
    {
        const double Poles[10][3] = {
            { -45.0,  9.2, 10.4 }, { -15.0,  9.2, 10.4 }, { 15.0,  9.2, 10.4 }, { 45.0,  9.2, 10.4 },
            { -30.0, -9.2, 10.4 }, {   0.0, -9.2, 10.4 }, { 30.0, -9.2, 10.4 },
            {  34.0, 34.0,  7.6 }, {  34.0, 43.0,  7.6 }, { -14.0, -48.0, 3.5 }
        };
        for (int I = 0; I < 10; ++I)
        {
            AnalyticLuminaireSpecification Lamp{};
            Lamp.Category        = AnalyticLuminaireCategory::Spot;
            Lamp.Position        = { Poles[I][0], Poles[I][1], Poles[I][2] };
            Lamp.ReachRadiusM    = (I < 7) ? 32.0 : 22.0;
            Lamp.IntensityRgb    = (I < 7) ? std::array<double, 3>{ 95.0, 68.0, 36.0 } : std::array<double, 3>{ 65.0, 78.0, 95.0 };
            Lamp.ForwardAxis     = { 0.0, 0.0, -1.0 };
            Lamp.UpAxis          = { 1.0, 0.0,  0.0 };
            Lamp.InnerConeCosine = std::cos(45.0 * PiScalar / 180.0);
            Lamp.OuterConeCosine = std::cos(78.0 * PiScalar / 180.0);
            Lamp.Photometry      = RoadwayBatwing;
            OutLuminaires.push_back(Lamp);
        }
    }

    PhotometricClusterSpecification Spec{};
    Spec.MinimumBoundary      = { -64.0, -64.0, -1.0 };
    Spec.MaximumBoundary      = {  96.0,  64.0, 15.0 };
    Spec.GridResolution       = { 20u, 16u, 6u };
    Spec.AnalyticCellCapacity = 16u;
    Spec.CullingMode          = ClusterCullingMode::TightPolarCone;
    OutClusters.Partition(OutLuminaires, Spec);
}

//------------------------------------------------------------------------------------------------------------------------
//                                           HIGH-FIDELITY SHOWCASE FRAME RENDERER
//------------------------------------------------------------------------------------------------------------------------

void RenderVehicleHmiShowcaseImage(
    const std::vector<WorldFacetTriangle>&             Triangles,
    const std::vector<AnalyticLuminaireSpecification>& Luminaires,
    const PhotometricLights&                  LightClusters,
    const PlumeFluid*                          PlumeFluid,
    const ShowcaseCameraPose&                          Camera,
    const ShowcaseEnvironmentSettings&                 Environment,
    std::uint32_t                                      Width,
    std::uint32_t                                      Height,
    std::vector<std::uint8_t>&                         OutRgb8)
{
    OutRgb8.assign(static_cast<std::size_t>(Width) * Height * 3u, 0u);
    if (Width == 0u || Height == 0u)
    {
        return;
    }

    const auto Materials = ConstructProvingGroundMaterials();
    TriangleBoundingAccelerator Bvh;
    Bvh.Build(Triangles);

    // Prepare Engine Atmosphere LUT, CloudField, FogMedium, and WeatherEffects.
    AtmosphereParameters AtmosParams{};
    TransmittanceLut     AtmosLut;
    AtmosLut.Bake(AtmosParams, 64u, 16u, 24u);

    const float ElevRad = Environment.SunElevationDeg * DegToRadScalar;
    const Float3 RawSun = Normalize3({ Environment.SunDirection[0], Environment.SunDirection[1], std::sin(ElevRad) });
    const SpatialVector SunDirD = { RawSun[0], RawSun[1], RawSun[2] };
    const double DaylightFactor = std::clamp((std::sin(ElevRad) + 0.08) / 0.55, 0.04, 1.0);
    const SpectrumRgb SunIrradiance = { 5.4 * DaylightFactor, 4.9 * DaylightFactor, 4.3 * DaylightFactor };

    WindFieldConfiguration WindCfg{};
    WindCfg.AmbientReferenceWindMps = {
        Environment.WindVelocityTenMetres[0],
        Environment.WindVelocityTenMetres[1],
        Environment.WindVelocityTenMetres[2]
    };
    WindField WindField(WindCfg);
    WindField.StepField({ Camera.Target[0], Camera.Target[1], 0.0 }, Environment.ElapsedSeconds);

    CloudParameters Clouds{};
    Clouds.BaseHeightM     = 750.0;
    Clouds.TopHeightM      = 1550.0;
    Clouds.Coverage        = Environment.CloudCoverage;
    Clouds.ExtinctionPerM  = 0.014;
    Clouds.AmbientRadiance = { 0.14 * DaylightFactor, 0.18 * DaylightFactor, 0.26 * DaylightFactor };
    WindField.SynchronizeCloudAdvection(Clouds, Environment.ElapsedSeconds * 4.0);

    FogParameters Fog{};
    Fog.DensityAtBase  = Environment.FogBaseDensity;
    Fog.BaseHeightM    = 0.0;
    Fog.FalloffHeightM = 1.0 / std::max(Environment.FogHeightFalloff, 0.02f);
    Fog.Colour         = { 0.34 * DaylightFactor + 0.03, 0.42 * DaylightFactor + 0.04, 0.56 * DaylightFactor + 0.07 };
    (void)Fog;

    auto EvaluateSkyAndClouds = [&](const Float3& RayOrigin, const Float3& RayDir) noexcept -> Float3
    {
        const SpatialVector PlanetPosKm = { 0.0, 0.0, AtmosParams.GroundRadiusKm + std::max(0.002, RayOrigin[2] * 0.001) };
        const Float3 SkyDir = Normalize3({ RayDir[0], RayDir[1], std::max(RayDir[2], 0.015f) });
        const SpectrumRgb Sky = SingleScattering(
            AtmosParams, PlanetPosKm, { SkyDir[0], SkyDir[1], SkyDir[2] }, SunDirD, SunIrradiance, &AtmosLut, 14u);
        Float3 Col = {
            static_cast<float>(Sky.R * 2.4 + 0.012),
            static_cast<float>(Sky.G * 2.4 + 0.016),
            static_cast<float>(Sky.B * 2.4 + 0.028)
        };

        // Crisp solar disc + circumsolar corona.
        const float SunCos = Dot3(RayDir, RawSun);
        if (SunCos > 0.9994f)
        {
            const float Disc = (SunCos - 0.9994f) / 0.0006f;
            Col = Add3(Col, { 18.0f * Disc, 15.5f * Disc, 12.0f * Disc });
        }
        else if (SunCos > 0.96f)
        {
            const float Glow = std::pow((SunCos - 0.96f) / 0.04f, 3.0f) * static_cast<float>(DaylightFactor);
            Col = Add3(Col, { 1.4f * Glow, 1.0f * Glow, 0.65f * Glow });
        }

        if (RayDir[2] > 0.035f && Environment.CloudCoverage > 0.01f)
        {
            const CloudMarchResult Cm = MarchClouds(
                Clouds,
                { RayOrigin[0], RayOrigin[1], RayOrigin[2] },
                { RayDir[0], RayDir[1], RayDir[2] },
                SunDirD,
                SunIrradiance,
                22000.0,
                16u,
                4u);
            const float Tr = static_cast<float>(Cm.Transmittance);
            Col = {
                Col[0] * Tr + static_cast<float>(Cm.Radiance.R) * 1.15f,
                Col[1] * Tr + static_cast<float>(Cm.Radiance.G) * 1.15f,
                Col[2] * Tr + static_cast<float>(Cm.Radiance.B) * 1.15f
            };
        }
        return Col;
    };

    const Float3 SkyZenith = EvaluateSkyAndClouds(Camera.Eye, { 0.0f, 0.0f, 1.0f });

    auto ShadeSurfaceHit = [&](const auto& Self, const TriangleBoundingAccelerator::HitRecord& Hit,
                               const Float3& ViewRayDir, int Depth) noexcept -> Float3
    {
        SurfaceReflectanceRecord Mat = Materials[std::min<std::uint32_t>(Hit.Family, PgmMaterialLimit - 1u)];

        // Apply weather surface effects: snow accumulation blanket or rain/hail wet-road specular film.
        if (Environment.SnowDepthMetres > 1.0e-4f && Hit.Family != PgmHeadlight && Hit.Family != PgmTaillight &&
            Hit.Family != PgmLampCool && Hit.Family != PgmLampWarm)
        {
            const float SnowCover = static_cast<float>(EvaluateSurfaceSnowCover(
                { Hit.Position[0], Hit.Position[1], Hit.Position[2] },
                { Hit.Normal[0], Hit.Normal[1], Hit.Normal[2] },
                Environment.SnowDepthMetres));
            if (SnowCover > 0.01f)
            {
                Mat.Albedo[0] = Mat.Albedo[0] + (0.88f - Mat.Albedo[0]) * SnowCover;
                Mat.Albedo[1] = Mat.Albedo[1] + (0.91f - Mat.Albedo[1]) * SnowCover;
                Mat.Albedo[2] = Mat.Albedo[2] + (0.96f - Mat.Albedo[2]) * SnowCover;
                Mat.Roughness = Mat.Roughness + (0.72f - Mat.Roughness) * SnowCover;
                Mat.Metalness *= (1.0f - SnowCover);
            }
        }
        else if (Environment.WeatherSpecies == PrecipitationSpecies::Rain && Environment.WeatherIntensity > 0.05f &&
                 Hit.Normal[2] > 0.7f)
        {
            Mat.Roughness  *= (1.0f - 0.62f * Environment.WeatherIntensity);
            Mat.CoatWeight  = std::max(Mat.CoatWeight, 0.65f * Environment.WeatherIntensity);
            Mat.CoatRoughness = 0.04f;
        }

        const Float3 V = Mul3(ViewRayDir, -1.0f);
        const Float3 N = Hit.Normal;
        const float  NdotV = std::max(Dot3(N, V), 1.0e-4f);

        Float3 Radiance = Mat.RadiantOutput;

        // Hemispherical sky ambient + ground bounce.
        const float UpVis = 0.5f + 0.5f * N[2];
        const Float3 AmbientIrr = {
            SkyZenith[0] * (0.32f + 0.68f * UpVis),
            SkyZenith[1] * (0.32f + 0.68f * UpVis),
            SkyZenith[2] * (0.32f + 0.68f * UpVis)
        };
        const float DiffuseWeight = (1.0f - Mat.Metalness) * (1.0f - Mat.Transmission);
        Radiance = Add3(Radiance, {
            Mat.Albedo[0] * AmbientIrr[0] * DiffuseWeight * 0.55f,
            Mat.Albedo[1] * AmbientIrr[1] * DiffuseWeight * 0.55f,
            Mat.Albedo[2] * AmbientIrr[2] * DiffuseWeight * 0.55f
        });

        auto AccumulateDirectBrdf = [&](const Float3& L, const Float3& Li)
        {
            const float NdotL = Dot3(N, L);
            if (NdotL <= 0.0f)
            {
                return;
            }
            const Float3 H     = Normalize3(Add3(V, L));
            const float  NdotH = std::max(Dot3(N, H), 0.0f);
            const float  VdotH = std::max(Dot3(V, H), 0.0f);

            const float Alpha  = std::max(Mat.Roughness * Mat.Roughness, 0.002f);
            const float Alpha2 = Alpha * Alpha;
            const float Den    = NdotH * NdotH * (Alpha2 - 1.0f) + 1.0f;
            const float Dggx   = Alpha2 / std::max(PiScalar * Den * Den, 1.0e-6f);

            const Float3 F0 = {
                0.04f * (1.0f - Mat.Metalness) + Mat.Albedo[0] * Mat.Metalness,
                0.04f * (1.0f - Mat.Metalness) + Mat.Albedo[1] * Mat.Metalness,
                0.04f * (1.0f - Mat.Metalness) + Mat.Albedo[2] * Mat.Metalness
            };
            const float Schlick = std::pow(1.0f - VdotH, 5.0f);
            const Float3 F = {
                F0[0] + (1.0f - F0[0]) * Schlick,
                F0[1] + (1.0f - F0[1]) * Schlick,
                F0[2] + (1.0f - F0[2]) * Schlick
            };
            const float K  = (Mat.Roughness + 1.0f) * (Mat.Roughness + 1.0f) * 0.125f;
            const float G1 = NdotV / (NdotV * (1.0f - K) + K);
            const float G2 = NdotL / (NdotL * (1.0f - K) + K);
            const float SpecGeom = (Dggx * G1 * G2) / std::max(4.0f * NdotV * NdotL, 1.0e-4f);

            // Automotive clearcoat lobe.
            float CoatSpec = 0.0f;
            if (Mat.CoatWeight > 0.01f)
            {
                const float Ca2  = std::max(Mat.CoatRoughness * Mat.CoatRoughness, 0.0009f);
                const float CDen = NdotH * NdotH * (Ca2 - 1.0f) + 1.0f;
                const float CD   = Ca2 / std::max(PiScalar * CDen * CDen, 1.0e-6f);
                CoatSpec         = Mat.CoatWeight * (0.04f + 0.96f * Schlick) * CD * 0.25f;
            }

            for (int C = 0; C < 3; ++C)
            {
                const float Diff = DiffuseWeight * Mat.Albedo[C] * (1.0f / PiScalar);
                const float Spec = F[C] * SpecGeom + CoatSpec;
                Radiance[C] += Li[C] * NdotL * (Diff + Spec);
            }
        };

        // 1. Direct sun with hard BVH shadow ray.
        if (RawSun[2] > 0.0f && Dot3(N, RawSun) > 0.0f)
        {
            const Float3 ShadowOrig = Add3(Hit.Position, Mul3(N, 0.012f));
            if (!Bvh.TraceOccluded(ShadowOrig, RawSun, 180.0f))
            {
                AccumulateDirectBrdf(RawSun, {
                    static_cast<float>(SunIrradiance.R),
                    static_cast<float>(SunIrradiance.G),
                    static_cast<float>(SunIrradiance.B)
                });
            }
        }

        // 2. O(1) Tight-clustered Analytic-IES luminaires (headlights, roof bar, batwing streetlamps, hangar/tunnel).
        if (!Luminaires.empty() && LightClusters.CellTotal() > 0u)
        {
            const auto& Candidates = LightClusters.RetrieveCandidates({ Hit.Position[0], Hit.Position[1], Hit.Position[2] });
            for (std::uint32_t LightIdx : Candidates)
            {
                if (LightIdx >= Luminaires.size())
                {
                    continue;
                }
                SpatialVector ToLightD{};
                double        DistM = 0.0;
                const auto Arrival = EvaluateAnalyticLuminaireArrival(
                    Luminaires[LightIdx],
                    { Hit.Position[0], Hit.Position[1], Hit.Position[2] },
                    ToLightD,
                    DistM);
                if (Arrival[0] + Arrival[1] + Arrival[2] <= 1.0e-5)
                {
                    continue;
                }
                const Float3 L = { static_cast<float>(ToLightD.X), static_cast<float>(ToLightD.Y), static_cast<float>(ToLightD.Z) };
                if (Dot3(N, L) <= 0.0f)
                {
                    continue;
                }
                if (DistM > 1.2 && Bvh.TraceOccluded(Add3(Hit.Position, Mul3(N, 0.015f)), L, static_cast<float>(DistM - 0.25)))
                {
                    continue;
                }
                AccumulateDirectBrdf(L, {
                    static_cast<float>(Arrival[0]),
                    static_cast<float>(Arrival[1]),
                    static_cast<float>(Arrival[2])
                });
            }
        }

        // 3. Fire point lights from active burning tyres / plumes.
        if (PlumeFluid != nullptr)
        {
            const PlumeFireLightRecord& Fl = PlumeFluid->FireLights();
            for (std::uint32_t I = 0u; I < std::min(Fl.Count[0], 4u); ++I)
            {
                const Float3 Offset = {
                    Fl.PositionRadius[I][0] - Hit.Position[0],
                    Fl.PositionRadius[I][1] - Hit.Position[1],
                    Fl.PositionRadius[I][2] - Hit.Position[2]
                };
                const float Dist2 = Dot3(Offset, Offset) + Fl.PositionRadius[I][3] * Fl.PositionRadius[I][3];
                const Float3 L    = Normalize3(Offset);
                const float Atten = 1.0f / std::max(Dist2, 0.08f);
                AccumulateDirectBrdf(L, {
                    Fl.Radiance[I][0] * Atten,
                    Fl.Radiance[I][1] * Atten,
                    Fl.Radiance[I][2] * Atten
                });
            }
        }

        // 4. Secondary mirror / metallic / clearcoat / refractive glass ray (showcase reflections!).
        if (Depth < 1 && (Mat.Metalness > 0.35f || Mat.CoatWeight > 0.5f || Mat.Transmission > 0.5f) && Mat.Roughness < 0.22f)
        {
            const Float3 ReflDir = Normalize3(Sub3(ViewRayDir, Mul3(N, 2.0f * Dot3(ViewRayDir, N))));
            const Float3 ReflOrg = Add3(Hit.Position, Mul3(N, 0.015f));
            const auto   ReflHit = Bvh.TraceClosest(ReflOrg, ReflDir, 140.0f);
            const Float3 ReflRad = ReflHit.Hit ? Self(Self, ReflHit, ReflDir, Depth + 1) : EvaluateSkyAndClouds(ReflOrg, ReflDir);

            const float Schlick = std::pow(1.0f - NdotV, 5.0f);
            if (Mat.Transmission > 0.5f)
            {
                // Snell refractive ray through ShowcaseGlass sphere.
                const float Eta  = 1.0f / Mat.RefractiveIdx;
                const float CosI = -Dot3(N, ViewRayDir);
                const float K2   = 1.0f - Eta * Eta * (1.0f - CosI * CosI);
                const Float3 RefrDir = (K2 > 0.0f)
                    ? Normalize3(Add3(Mul3(ViewRayDir, Eta), Mul3(N, Eta * CosI - std::sqrt(K2))))
                    : ReflDir;
                const Float3 RefrOrg = Sub3(Hit.Position, Mul3(N, 0.02f));
                const auto   RefrHit = Bvh.TraceClosest(RefrOrg, RefrDir, 140.0f);
                const Float3 RefrRad = RefrHit.Hit ? Self(Self, RefrHit, RefrDir, Depth + 1) : EvaluateSkyAndClouds(RefrOrg, RefrDir);
                const float  Fresnel = 0.04f + 0.96f * Schlick;
                for (int C = 0; C < 3; ++C)
                {
                    Radiance[C] = Fresnel * ReflRad[C] + (1.0f - Fresnel) * Mat.Albedo[C] * RefrRad[C];
                }
            }
            else
            {
                const float Weight = (Mat.Metalness > 0.5f) ? (0.72f * (1.0f - Mat.Roughness)) : (0.06f + 0.45f * Schlick);
                for (int C = 0; C < 3; ++C)
                {
                    const float Tint = (Mat.Metalness > 0.5f) ? Mat.Albedo[C] : 1.0f;
                    Radiance[C] = Radiance[C] * (1.0f - 0.5f * Weight) + ReflRad[C] * Tint * Weight;
                }
            }
        }

        return Radiance;
    };

    const Float3 Forward = Normalize3(Sub3(Camera.Target, Camera.Eye));
    const Float3 Right   = Normalize3(Cross3(Forward, { 0.0f, 0.0f, 1.0f }));
    const Float3 Up      = Normalize3(Cross3(Right, Forward));
    const float  TanY    = std::tan(0.5f * Camera.VerticalFovDeg * DegToRadScalar);
    const float  TanX    = TanY * (static_cast<float>(Width) / static_cast<float>(Height));

    // Budgeted, cloud-gated falling hydrometeors (Rain / Snow / Hail) coupled to WindField!
    // Spawns STRICTLY beneath verified cloud columns — zero wasted particles under clear sky!
    struct ScreenParticle
    {
        Float3 P0;
        Float3 P1;
        float  RadiusPx;
        Float3 Colour;
    };
    std::vector<ScreenParticle> WeatherParticles;
    if (Environment.WeatherSpecies != PrecipitationSpecies::Clear && Environment.WeatherIntensity > 0.02f)
    {
        const std::uint32_t ScaledBudget = static_cast<std::uint32_t>(
            std::clamp(Environment.WeatherIntensity, 0.0f, 1.0f) * static_cast<float>(Environment.StrictWeatherParticleBudget));
        if (ScaledBudget > 0u)
        {
            WeatherParticleBudgetConfig SpawnerCfg{};
            SpawnerCfg.Category = (Environment.WeatherSpecies == PrecipitationSpecies::Snow)
                ? FallingParticleCategory::SnowFlake
                : (Environment.WeatherSpecies == PrecipitationSpecies::Hail)
                    ? FallingParticleCategory::HailPellet
                    : FallingParticleCategory::RainDrop;
            SpawnerCfg.StrictParticleBudget      = ScaledBudget;
            SpawnerCfg.SpawnVolumeHorizontalM    = 64.0;
            SpawnerCfg.SpawnCeilingHeightM       = 24.0;
            SpawnerCfg.WeatherIntensityZeroToOne = Environment.WeatherIntensity;

            CloudGatedWeatherSpawner Spawner(SpawnerCfg);
            const Float3 Anchor = Add3(Camera.Eye, Mul3(Forward, 14.0f));
            for (int WarmStep = 0; WarmStep < 8; ++WarmStep)
            {
                (void)Spawner.StepParticles(Clouds, WindField, { Anchor[0], Anchor[1], 0.0 }, 1.0 / 30.0);
            }

            const float DtStreak = (Environment.WeatherSpecies == PrecipitationSpecies::Rain) ? 0.022f : 0.010f;
            const Float3 Col = (Environment.WeatherSpecies == PrecipitationSpecies::Snow)
                ? Float3{ 0.90f, 0.94f, 1.00f }
                : (Environment.WeatherSpecies == PrecipitationSpecies::Hail)
                    ? Float3{ 0.80f, 0.90f, 1.00f }
                    : Float3{ 0.55f, 0.68f, 0.85f };
            const float Rad = (Environment.WeatherSpecies == PrecipitationSpecies::Snow) ? 1.85f
                            : (Environment.WeatherSpecies == PrecipitationSpecies::Hail) ? 1.65f
                                                                                         : 0.95f;

            WeatherParticles.reserve(Spawner.Particles().size());
            for (const WeatherParticleRecord& P : Spawner.Particles())
            {
                if (!P.Alive)
                {
                    continue;
                }
                const Float3 P0 = { static_cast<float>(P.Position.X), static_cast<float>(P.Position.Y), static_cast<float>(P.Position.Z) };
                const Float3 V  = { static_cast<float>(P.Velocity.X), static_cast<float>(P.Velocity.Y), static_cast<float>(P.Velocity.Z) };
                const Float3 P1 = Add3(P0, Mul3(V, DtStreak));
                WeatherParticles.push_back(ScreenParticle{ P0, P1, Rad, Col });
            }
        }
    }

    std::vector<float> HdrBuffer(static_cast<std::size_t>(Width) * Height * 3u, 0.0f);
    std::vector<float> DepthBuffer(static_cast<std::size_t>(Width) * Height, 250.0f);

    const unsigned int ThreadCount = std::max(1u, std::min(4u, std::thread::hardware_concurrency()));
    std::vector<std::thread> Workers;
    Workers.reserve(ThreadCount);

    for (unsigned int Tid = 0u; Tid < ThreadCount; ++Tid)
    {
        Workers.emplace_back([&, Tid]()
        {
            // 2x rotated-grid supersampling per pixel for clean silhouette & specular edges.
            constexpr float SubOffsets[2][2] = { { 0.25f, 0.75f }, { 0.75f, 0.25f } };
            for (std::uint32_t Y = Tid; Y < Height; Y += ThreadCount)
            {
                for (std::uint32_t X = 0u; X < Width; ++X)
                {
                    Float3 PixelHdr = { 0.0f, 0.0f, 0.0f };
                    float  PrimaryDist = 240.0f;

                    for (int Sub = 0; Sub < 2; ++Sub)
                    {
                        const float U = 2.0f * ((static_cast<float>(X) + SubOffsets[Sub][0]) / static_cast<float>(Width)) - 1.0f;
                        const float V = 1.0f - 2.0f * ((static_cast<float>(Y) + SubOffsets[Sub][1]) / static_cast<float>(Height));
                        const Float3 RayDir = Normalize3(Add3(Forward, Add3(Mul3(Right, U * TanX), Mul3(Up, V * TanY))));

                        const auto Hit = Bvh.TraceClosest(Camera.Eye, RayDir, 240.0f);
                        Float3 SampleHdr = Hit.Hit
                            ? ShadeSurfaceHit(ShadeSurfaceHit, Hit, RayDir, 0)
                            : EvaluateSkyAndClouds(Camera.Eye, RayDir);
                        const float HitDist = Hit.Hit ? Hit.Distance : 160.0f;
                        if (Sub == 0)
                        {
                            PrimaryDist = HitDist;
                        }

                        // Exponential height fog + tight-clustered headlight/streetlamp volumetric shafts!
                        if (Environment.FogBaseDensity > 1.0e-5f)
                        {
                            const double FogT = FogTransmittance(
                                Fog,
                                { Camera.Eye[0], Camera.Eye[1], Camera.Eye[2] },
                                { RayDir[0], RayDir[1], RayDir[2] },
                                std::min<double>(HitDist, 120.0));
                            const SpectrumRgb BaseFogged = ApplyFog(
                                Fog, { SampleHdr[0], SampleHdr[1], SampleHdr[2] }, FogT);
                            SampleHdr = {
                                static_cast<float>(BaseFogged.R),
                                static_cast<float>(BaseFogged.G),
                                static_cast<float>(BaseFogged.B)
                            };

                            // Clustered volumetric light-shaft quadrature (6 steps in near field).
                            if (!Luminaires.empty() && Sub == 0)
                            {
                                const float MaxVolDist = std::min(HitDist, 48.0f);
                                constexpr int VolSteps = 6;
                                const float StepLen    = MaxVolDist / static_cast<float>(VolSteps);
                                Float3 VolScatter      = { 0.0f, 0.0f, 0.0f };
                                for (int S = 0; S < VolSteps; ++S)
                                {
                                    const float D = (static_cast<float>(S) + 0.5f) * StepLen;
                                    const Float3 P = Add3(Camera.Eye, Mul3(RayDir, D));
                                    const float Rho = Environment.FogBaseDensity * std::exp(-std::max(P[2], 0.0f) * Environment.FogHeightFalloff);
                                    const auto& Cands = LightClusters.RetrieveCandidates({ P[0], P[1], P[2] });
                                    for (std::uint32_t Li : Cands)
                                    {
                                        if (Li >= Luminaires.size()) continue;
                                        SpatialVector ToL{};
                                        double DistL = 0.0;
                                        const auto Arr = EvaluateAnalyticLuminaireArrival(
                                            Luminaires[Li], { P[0], P[1], P[2] }, ToL, DistL);
                                        VolScatter[0] += static_cast<float>(Arr[0]) * Rho * StepLen * 0.14f;
                                        VolScatter[1] += static_cast<float>(Arr[1]) * Rho * StepLen * 0.14f;
                                        VolScatter[2] += static_cast<float>(Arr[2]) * Rho * StepLen * 0.14f;
                                    }
                                }
                                SampleHdr = Add3(SampleHdr, VolScatter);
                            }
                        }

                        PixelHdr = Add3(PixelHdr, Mul3(SampleHdr, 0.5f));
                    }

                    // Composite 3D Fluid Smoke & Fire volume ray-march against opaque depth.
                    if (PlumeFluid != nullptr)
                    {
                        const float U = 2.0f * ((static_cast<float>(X) + 0.5f) / static_cast<float>(Width)) - 1.0f;
                        const float V = 1.0f - 2.0f * ((static_cast<float>(Y) + 0.5f) / static_cast<float>(Height));
                        const Float3 RayDir = Normalize3(Add3(Forward, Add3(Mul3(Right, U * TanX), Mul3(Up, V * TanY))));
                        const float Jitter = std::fmod(52.9829189f * std::fmod(0.06711056f * static_cast<float>(X) + 0.00583715f * static_cast<float>(Y), 1.0f), 1.0f);
                        const auto PlumeRgba = PlumeFluid->EvaluatePlumeRay(
                            Camera.Eye, RayDir, PrimaryDist, Jitter,
                            RawSun,
                            { static_cast<float>(SunIrradiance.R), static_cast<float>(SunIrradiance.G), static_cast<float>(SunIrradiance.B) },
                            SkyZenith);
                        PixelHdr = {
                            PixelHdr[0] * PlumeRgba[3] + PlumeRgba[0],
                            PixelHdr[1] * PlumeRgba[3] + PlumeRgba[1],
                            PixelHdr[2] * PlumeRgba[3] + PlumeRgba[2]
                        };
                    }

                    const std::size_t Idx = static_cast<std::size_t>(Y) * Width + X;
                    DepthBuffer[Idx]       = PrimaryDist;
                    HdrBuffer[Idx * 3u + 0u] = PixelHdr[0];
                    HdrBuffer[Idx * 3u + 1u] = PixelHdr[1];
                    HdrBuffer[Idx * 3u + 2u] = PixelHdr[2];
                }
            }
        });
    }
    for (std::thread& T : Workers)
    {
        T.join();
    }

    // Screen-projected depth-tested Rain / Snow / Hail streaks & ice pellets.
    auto ProjectWorldToScreen = [&](const Float3& P, float& OutSx, float& OutSy, float& OutDepth) noexcept -> bool
    {
        const Float3 Rel = Sub3(P, Camera.Eye);
        const float  Z   = Dot3(Rel, Forward);
        if (Z <= 0.25f)
        {
            return false;
        }
        const float NdcX = Dot3(Rel, Right) / (Z * TanX);
        const float NdcY = Dot3(Rel, Up)    / (Z * TanY);
        OutSx    = (0.5f * NdcX + 0.5f) * static_cast<float>(Width);
        OutSy    = (0.5f - 0.5f * NdcY) * static_cast<float>(Height);
        OutDepth = Z;
        return OutSx >= -8.0f && OutSx <= static_cast<float>(Width + 8u) &&
               OutSy >= -8.0f && OutSy <= static_cast<float>(Height + 8u);
    };

    for (const ScreenParticle& Sp : WeatherParticles)
    {
        float X0 = 0.0f, Y0 = 0.0f, Z0 = 0.0f;
        float X1 = 0.0f, Y1 = 0.0f, Z1 = 0.0f;
        if (!ProjectWorldToScreen(Sp.P0, X0, Y0, Z0) || !ProjectWorldToScreen(Sp.P1, X1, Y1, Z1))
        {
            continue;
        }
        const float Dx = X1 - X0;
        const float Dy = Y1 - Y0;
        const int Steps = std::max(1, static_cast<int>(std::ceil(std::hypot(Dx, Dy))));
        const int RadPx = std::max(0, static_cast<int>(std::ceil(Sp.RadiusPx)));
        for (int S = 0; S <= Steps; ++S)
        {
            const float Frac = static_cast<float>(S) / static_cast<float>(Steps);
            const int Cx = static_cast<int>(std::lround(X0 + Dx * Frac));
            const int Cy = static_cast<int>(std::lround(Y0 + Dy * Frac));
            for (int Oy = -RadPx; Oy <= RadPx; ++Oy)
            {
                for (int Ox = -RadPx; Ox <= RadPx; ++Ox)
                {
                    const int Px = Cx + Ox;
                    const int Py = Cy + Oy;
                    if (Px < 0 || Px >= static_cast<int>(Width) || Py < 0 || Py >= static_cast<int>(Height))
                    {
                        continue;
                    }
                    const std::size_t Idx = static_cast<std::size_t>(Py) * Width + static_cast<std::size_t>(Px);
                    if (Z0 >= DepthBuffer[Idx])
                    {
                        continue;
                    }
                    const float Dist2 = static_cast<float>(Ox * Ox + Oy * Oy);
                    const float W     = std::exp(-Dist2 / std::max(Sp.RadiusPx * Sp.RadiusPx, 0.5f)) * 0.48f;
                    HdrBuffer[Idx * 3u + 0u] += Sp.Colour[0] * W;
                    HdrBuffer[Idx * 3u + 1u] += Sp.Colour[1] * W;
                    HdrBuffer[Idx * 3u + 2u] += Sp.Colour[2] * W;
                }
            }
        }
    }

    // ACES filmic tonemap to RGB8.
    const std::size_t TotalPixels = static_cast<std::size_t>(Width) * Height;
    for (std::size_t I = 0u; I < TotalPixels; ++I)
    {
        OutRgb8[I * 3u + 0u] = AcesTonemapSrgbByte(HdrBuffer[I * 3u + 0u]);
        OutRgb8[I * 3u + 1u] = AcesTonemapSrgbByte(HdrBuffer[I * 3u + 1u]);
        OutRgb8[I * 3u + 2u] = AcesTonemapSrgbByte(HdrBuffer[I * 3u + 2u]);
    }
}

} // namespace Frontier::Drive
