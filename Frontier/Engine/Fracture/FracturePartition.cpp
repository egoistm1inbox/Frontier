/*==========================================================================================================================================
                                                       FRACTUREPARTITION.CPP
==========================================================================================================================================*/
// Deterministic native port of the convex half-space partitioning and clustered Voronoi path in
// Experimental Remastered/FractureEditor/Engine/ConvexPartitioning.js. Other solver families share the exact
// polyhedron and material accounting primitives; their source-specific kernels are ported independently.

#include "Frontier/Engine/Fracture/FracturePartition.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <limits>
#include <map>
#include <numeric>
#include <set>
#include <tuple>
#include <unordered_map>
#include <utility>

namespace Frontier::Fracture
{
namespace
{

constexpr double Epsilon = 1.0e-6;
constexpr double Tiny = 1.0e-12;
constexpr double Pi = 3.1415926535897932384626433832795;

Vec3 Add(const Vec3& A, const Vec3& B) noexcept { return { A[0] + B[0], A[1] + B[1], A[2] + B[2] }; }
Vec3 Sub(const Vec3& A, const Vec3& B) noexcept { return { A[0] - B[0], A[1] - B[1], A[2] - B[2] }; }
Vec3 Mul(const Vec3& A, double S) noexcept { return { A[0] * S, A[1] * S, A[2] * S }; }
double Dot(const Vec3& A, const Vec3& B) noexcept { return A[0] * B[0] + A[1] * B[1] + A[2] * B[2]; }
Vec3 Cross(const Vec3& A, const Vec3& B) noexcept
{
    return { A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0] };
}
double LengthSquared(const Vec3& V) noexcept { return Dot(V, V); }
double Length(const Vec3& V) noexcept { return std::sqrt(LengthSquared(V)); }
double Distance(const Vec3& A, const Vec3& B) noexcept { return Length(Sub(A, B)); }
Vec3 Normalize(const Vec3& V) noexcept
{
    const double L = Length(V);
    return L > Tiny ? Mul(V, 1.0 / L) : Vec3{ 0.0, 1.0, 0.0 };
}
Vec3 Perpendicular(const Vec3& N) noexcept
{
    const Vec3 Reference = std::fabs(N[1]) < 0.85 ? Vec3{ 0.0, 1.0, 0.0 } : Vec3{ 1.0, 0.0, 0.0 };
    return Normalize(Cross(N, Reference));
}

double ComponentMin(const Vec3& V) noexcept { return std::min({ V[0], V[1], V[2] }); }
double ComponentMax(const Vec3& V) noexcept { return std::max({ V[0], V[1], V[2] }); }

struct VertexKey
{
    int64_t X = 0, Y = 0, Z = 0;
    bool operator==(const VertexKey&) const noexcept = default;
};

struct VertexKeyHash
{
    size_t operator()(const VertexKey& K) const noexcept
    {
        uint64_t H = static_cast<uint64_t>(K.X) * 0x9E3779B185EBCA87ull;
        H ^= static_cast<uint64_t>(K.Y) + 0x9E3779B97F4A7C15ull + (H << 6) + (H >> 2);
        H ^= static_cast<uint64_t>(K.Z) + 0xC2B2AE3D27D4EB4Full + (H << 6) + (H >> 2);
        return static_cast<size_t>(H ^ (H >> 32));
    }
};

VertexKey KeyFor(const Vec3& P) noexcept
{
    return { static_cast<int64_t>(std::llround(P[0] * 1.0e6)),
             static_cast<int64_t>(std::llround(P[1] * 1.0e6)),
             static_cast<int64_t>(std::llround(P[2] * 1.0e6)) };
}

std::vector<uint32_t> DeduplicateCycle(const std::vector<uint32_t>& Indices)
{
    std::vector<uint32_t> Out;
    Out.reserve(Indices.size());
    for (size_t I = 0; I < Indices.size(); ++I)
    {
        const uint32_t Current = Indices[I];
        const uint32_t Previous = Out.empty() ? Indices.back() : Out.back();
        if (Current != Previous) Out.push_back(Current);
    }
    return Out;
}

struct ClipResult
{
    bool HasFront = false;
    bool HasBack = false;
    bool Split = false;
    Polyhedron Front;
    Polyhedron Back;
    double CutArea = 0.0;
};

uint32_t InsertVertex(Polyhedron& Into, std::unordered_map<VertexKey, uint32_t, VertexKeyHash>& Lookup, const Vec3& P)
{
    const VertexKey Key = KeyFor(P);
    const auto Existing = Lookup.find(Key);
    if (Existing != Lookup.end()) return Existing->second;
    const uint32_t Slot = static_cast<uint32_t>(Into.Vertices.size());
    Into.Vertices.push_back(P);
    Lookup.emplace(Key, Slot);
    return Slot;
}

ClipResult ClipAll(const Polyhedron& Shape, const Vec3& RawNormal, double PlaneOffset, uint32_t CutToken,
                   bool MarkInterior)
{
    ClipResult Out;
    if (Shape.Vertices.size() < 4 || Shape.Faces.size() < 4) return Out;
    const Vec3 N = Normalize(RawNormal);
    std::vector<double> Distances(Shape.Vertices.size());
    int Positive = 0, Negative = 0;
    for (size_t I = 0; I < Shape.Vertices.size(); ++I)
    {
        Distances[I] = Dot(N, Shape.Vertices[I]) - PlaneOffset;
        if (Distances[I] > Epsilon) ++Positive;
        else if (Distances[I] < -Epsilon) ++Negative;
    }
    if (Negative == 0)
    {
        Out.HasFront = true;
        Out.Front = Shape;
        return Out;
    }
    if (Positive == 0)
    {
        Out.HasBack = true;
        Out.Back = Shape;
        return Out;
    }

    Out.Split = true;
    Out.HasFront = Out.HasBack = true;
    std::unordered_map<VertexKey, uint32_t, VertexKeyHash> FrontLookup, BackLookup;
    FrontLookup.reserve(Shape.Vertices.size() + 8);
    BackLookup.reserve(Shape.Vertices.size() + 8);
    std::vector<Vec3> CutPoints;
    std::unordered_map<VertexKey, bool, VertexKeyHash> CutSeen;
    auto AddCutPoint = [&](const Vec3& P)
    {
        const VertexKey Key = KeyFor(P);
        if (CutSeen.emplace(Key, true).second) CutPoints.push_back(P);
    };

    for (const Face& SourceFace : Shape.Faces)
    {
        std::vector<uint32_t> FrontLoop, BackLoop;
        const size_t Count = SourceFace.Indices.size();
        if (Count < 3) continue;
        FrontLoop.reserve(Count + 2);
        BackLoop.reserve(Count + 2);
        for (size_t I = 0; I < Count; ++I)
        {
            const uint32_t IA = SourceFace.Indices[I];
            const uint32_t IB = SourceFace.Indices[(I + 1) % Count];
            if (IA >= Shape.Vertices.size() || IB >= Shape.Vertices.size()) continue;
            const double DA = Distances[IA], DB = Distances[IB];
            const Vec3& A = Shape.Vertices[IA];
            const Vec3& B = Shape.Vertices[IB];
            if (DA >= -Epsilon) FrontLoop.push_back(InsertVertex(Out.Front, FrontLookup, A));
            if (DA <= Epsilon) BackLoop.push_back(InsertVertex(Out.Back, BackLookup, A));
            if (std::fabs(DA) <= Epsilon) AddCutPoint(A);
            if ((DA > Epsilon && DB < -Epsilon) || (DA < -Epsilon && DB > Epsilon))
            {
                const double T = DA / (DA - DB);
                const Vec3 Point = Add(A, Mul(Sub(B, A), T));
                FrontLoop.push_back(InsertVertex(Out.Front, FrontLookup, Point));
                BackLoop.push_back(InsertVertex(Out.Back, BackLookup, Point));
                AddCutPoint(Point);
            }
        }
        FrontLoop = DeduplicateCycle(FrontLoop);
        BackLoop = DeduplicateCycle(BackLoop);
        if (FrontLoop.size() >= 3) Out.Front.Faces.push_back({ std::move(FrontLoop), SourceFace.CutToken, SourceFace.Interior });
        if (BackLoop.size() >= 3) Out.Back.Faces.push_back({ std::move(BackLoop), SourceFace.CutToken, SourceFace.Interior });
    }

    if (CutPoints.size() >= 3)
    {
        Vec3 Centre{};
        for (const Vec3& P : CutPoints) Centre = Add(Centre, P);
        Centre = Mul(Centre, 1.0 / CutPoints.size());
        const Vec3 AxisX = Normalize(Sub(CutPoints.front(), Centre));
        const Vec3 AxisY = Normalize(Cross(N, AxisX));
        std::sort(CutPoints.begin(), CutPoints.end(), [&](const Vec3& A, const Vec3& B) {
            const Vec3 RA = Sub(A, Centre), RB = Sub(B, Centre);
            return std::atan2(Dot(RA, AxisY), Dot(RA, AxisX)) < std::atan2(Dot(RB, AxisY), Dot(RB, AxisX));
        });
        for (size_t I = 1; I + 1 < CutPoints.size(); ++I)
            Out.CutArea += 0.5 * Length(Cross(Sub(CutPoints[I], CutPoints[0]), Sub(CutPoints[I + 1], CutPoints[0])));

        std::vector<uint32_t> FrontCap, BackCap;
        FrontCap.reserve(CutPoints.size()); BackCap.reserve(CutPoints.size());
        for (const Vec3& P : CutPoints)
        {
            FrontCap.push_back(InsertVertex(Out.Front, FrontLookup, P));
            BackCap.push_back(InsertVertex(Out.Back, BackLookup, P));
        }
        std::reverse(FrontCap.begin(), FrontCap.end());
        FrontCap = DeduplicateCycle(FrontCap);
        BackCap = DeduplicateCycle(BackCap);
        if (FrontCap.size() >= 3) Out.Front.Faces.push_back({ std::move(FrontCap), CutToken, MarkInterior });
        if (BackCap.size() >= 3) Out.Back.Faces.push_back({ std::move(BackCap), CutToken, MarkInterior });
    }

    if (Out.Front.Faces.size() < 4 || Out.Back.Faces.size() < 4)
    {
        Out = {};
        return Out;
    }
    return Out;
}

class RandomStream
{
  public:
    explicit RandomStream(uint32_t Seed) noexcept : State((Seed ? Seed : 42u) * 2654435761u) { if (State == 0) State = 1; }
    double Next() noexcept
    {
        State += 0x6D2B79F5u;
        uint32_t T = State;
        T = (T ^ (T >> 15)) * (T | 1u);
        T ^= T + ((T ^ (T >> 7)) * (T | 61u));
        return static_cast<double>(T ^ (T >> 14)) / 4294967296.0;
    }
  private:
    uint32_t State;
};

Vec3 ClampToBounds(const Vec3& P, const Metrics& M, double Margin) noexcept
{
    Vec3 Out{};
    for (int Axis = 0; Axis < 3; ++Axis)
    {
        const double Lo = M.BoundsMin[Axis] + std::min(Margin, 0.25 * M.Span[Axis]);
        const double Hi = M.BoundsMax[Axis] - std::min(Margin, 0.25 * M.Span[Axis]);
        Out[Axis] = std::clamp(P[Axis], Lo, Hi);
    }
    return Out;
}

std::vector<Vec3> GenerateVoronoiSeeds(const Metrics& Base, const Request& Input, uint32_t Ceiling, RandomStream& Random)
{
    std::vector<Vec3> Seeds;
    Seeds.reserve(Ceiling);
    const uint32_t MaxTries = Ceiling * 18;
    for (uint32_t Try = 0; Try < MaxTries && Seeds.size() < Ceiling; ++Try)
    {
        Vec3 Candidate{};
        if (Random.Next() < 0.62)
        {
            const double U = std::pow(Random.Next(), 1.65);
            const double Theta = Random.Next() * 2.0 * Pi;
            const double Phi = std::acos(std::clamp(2.0 * Random.Next() - 1.0, -1.0, 1.0));
            const double Radius = U * Base.Radius * 1.15;
            Candidate = ClampToBounds({ Input.ImpactPointMetres[0] + Radius * std::sin(Phi) * std::cos(Theta),
                                        Input.ImpactPointMetres[1] + Radius * std::cos(Phi),
                                        Input.ImpactPointMetres[2] + Radius * std::sin(Phi) * std::sin(Theta) },
                                      Base, 0.02);
        }
        else
        {
            Candidate = { Base.BoundsMin[0] + (0.06 + 0.88 * Random.Next()) * Base.Span[0],
                          Base.BoundsMin[1] + (0.06 + 0.88 * Random.Next()) * Base.Span[1],
                          Base.BoundsMin[2] + (0.06 + 0.88 * Random.Next()) * Base.Span[2] };
        }
        bool TooClose = false;
        for (const Vec3& Existing : Seeds)
        {
            if (Distance(Existing, Candidate) < Input.MinimumPieceSizeMetres * 0.75) { TooClose = true; break; }
        }
        if (!TooClose) Seeds.push_back(Candidate);
    }
    if (Seeds.size() < 2)
    {
        Seeds.push_back(Base.Centroid);
        Seeds.push_back(ClampToBounds(Add(Base.Centroid, { 0.1, 0.05, 0.0 }), Base, 0.001));
    }
    return Seeds;
}

Vec3 RotateGrainAxis(const Material& Mat, double GrainAngleRad) noexcept
{
    if (Mat.Kind == MaterialKind::Wood) return Normalize({ std::cos(GrainAngleRad), 0.0, std::sin(GrainAngleRad) });
    return { 0.0, 1.0, 0.0 };
}

Vec3 Lerp(const Vec3& A, const Vec3& B, double T) noexcept { return Add(A, Mul(Sub(B, A), T)); }

double EvaluateDirectionalToughness(const Material& Mat, const Vec3& PlaneNormal, double GrainAngleRad,
                                    RandomStream& Random) noexcept
{
    double Gc = Mat.FractureEnergyJPerM2;
    const Vec3 Grain = RotateGrainAxis(Mat, GrainAngleRad);
    if (Mat.Mode == FractureMode::Fibrous)
    {
        const double Across = std::fabs(Dot(PlaneNormal, Grain));
        Gc *= 1.0 + (Mat.AnisotropyRatio - 1.0) * Across * Across;
    }
    else if (Mat.BeddingWeakness > 0.0)
    {
        const double Align = std::fabs(Dot(PlaneNormal, Grain));
        Gc *= 1.0 - Mat.BeddingWeakness * std::pow(Align, 4.0);
    }
    const double U = std::clamp(Random.Next(), 1.0e-4, 0.9999);
    const double Weibull = std::pow(-std::log(1.0 - U), 1.0 / std::max(2.0, Mat.WeibullModulus));
    return Gc * std::clamp(Weibull, 0.35, 2.2);
}

Vec3 SampleStressCrackNormal(const Material& Mat, const Vec3& Centroid, const Request& Input,
                             double ObjectRadius, double GrainAngleRad, RandomStream& Random) noexcept
{
    const Vec3 Relative = Sub(Centroid, Input.ImpactPointMetres);
    const Vec3 Axial = Mul(Input.ImpactNormal, Dot(Relative, Input.ImpactNormal));
    const Vec3 RawRadial = Sub(Relative, Axial);
    const double R = Length(RawRadial);
    const Vec3 Radial = R > 1.0e-5 ? Mul(RawRadial, 1.0 / R) : Perpendicular(Input.ImpactNormal);
    const Vec3 Hoop = Normalize(Cross(Input.ImpactNormal, Radial));
    const Vec3 Grain = RotateGrainAxis(Mat, GrainAngleRad);
    Vec3 N{};
    if (Mat.Mode == FractureMode::PlateBrittle)
    {
        if (Mat.StoredEnergyJPerM3 > 0.0)
        {
            N = Normalize({ Random.Next() * 2.0 - 1.0, Random.Next() * 2.0 - 1.0, Random.Next() * 2.0 - 1.0 });
            N = Normalize(Add(N, Mul(Input.ImpactNormal, -Dot(N, Input.ImpactNormal) * 0.86)));
        }
        else
        {
            const double RingProb = std::min(1.0, std::pow(R / std::max(0.15, ObjectRadius * 0.48), 1.35)) *
                                                  (0.32 + Mat.RingBias);
            N = Random.Next() < RingProb ? Radial : Hoop;
            N = Normalize(Add(N, Mul(Input.ImpactNormal, -Dot(N, Input.ImpactNormal) * 0.88)));
        }
    }
    else if (Mat.Mode == FractureMode::Fibrous)
    {
        const Vec3 RandomVector{ Random.Next() * 2.0 - 1.0, Random.Next() * 2.0 - 1.0, Random.Next() * 2.0 - 1.0 };
        const Vec3 GrainCross = Cross(Grain, RandomVector);
        N = LengthSquared(GrainCross) > 1.0e-4 ? Normalize(GrainCross) : Perpendicular(Grain);
        const double NearImpact = std::max(0.0, 1.0 - R / std::max(0.2, ObjectRadius * 0.55));
        if (Random.Next() < 0.12 + 0.24 * NearImpact) N = Normalize(Add(Grain, Mul(Hoop, 0.28)));
    }
    else if (Mat.Mode == FractureMode::Ductile)
    {
        N = Normalize(Lerp(Hoop, Radial, Random.Next() * 0.65));
    }
    else
    {
        const double RingProb = std::min(1.0, std::pow(R / std::max(0.2, ObjectRadius * 0.62), 1.45)) * Mat.RingBias;
        N = Random.Next() < RingProb ? Radial : Hoop;
        if (Random.Next() < 0.30)
        {
            const Vec3 RandomVector = Normalize({ Random.Next() * 2.0 - 1.0, Random.Next() * 2.0 - 1.0,
                                                   Random.Next() * 2.0 - 1.0 });
            N = Normalize(Lerp(N, RandomVector, 0.72));
        }
        if (Mat.BeddingWeakness > 0.0 && Random.Next() < 0.32 + Mat.BeddingWeakness * 0.4)
            N = Normalize(Lerp(N, Grain, 0.82));
    }
    N = Add(N, { (Random.Next() - 0.5) * Mat.CrackJitter, (Random.Next() - 0.5) * Mat.CrackJitter,
                 (Random.Next() - 0.5) * Mat.CrackJitter });
    return Normalize(N);
}

Vec3 EvaluateFastBoussinesqNormal(const Material& Mat, const Metrics& Cell, const Request& Input,
                                  double ObjectRadius, double GrainAngleRad, RandomStream& Random) noexcept
{
    const Vec3 D = Mul(Input.ImpactNormal, -1.0);
    const Vec3 R0 = Sub(Cell.Centroid, Input.ImpactPointMetres);
    const double Axial = Dot(R0, D);
    Vec3 Radial = Sub(R0, Mul(D, Axial));
    double R = Length(Radial);
    if (R < 1.0e-5)
        Radial = std::fabs(D[0]) < 0.85 ? Vec3{ 0.0, D[2], -D[1] } : Vec3{ -D[2], 0.0, D[0] };
    R = Length(Radial);
    Radial = R > Tiny ? Mul(Radial, 1.0 / R) : Perpendicular(D);
    const Vec3 Hoop = Cross(D, Radial);
    Vec3 N = Hoop;
    if (Mat.Mode == FractureMode::PlateBrittle)
    {
        if (Mat.StoredEnergyJPerM3 > 0.0)
        {
            N = { Random.Next() * 2.0 - 1.0, Random.Next() * 2.0 - 1.0, Random.Next() * 2.0 - 1.0 };
            N = Sub(N, Mul(D, Dot(N, D) * 0.88));
        }
        else
        {
            const double Ratio = std::clamp(R / std::max(1.0e-4, ObjectRadius * 0.45), 0.0, 1.0);
            const double RingProb = std::pow(Ratio, 1.4) * (0.35 + Mat.RingBias);
            if (Random.Next() < RingProb) N = Radial;
            N = Sub(N, Mul(D, Dot(N, D) * 0.90));
        }
    }
    else if (Mat.Mode == FractureMode::Fibrous)
    {
        const Vec3 Grain = RotateGrainAxis(Mat, GrainAngleRad);
        const Vec3 RandomVector{ Random.Next() * 2.0 - 1.0, Random.Next() * 2.0 - 1.0, Random.Next() * 2.0 - 1.0 };
        N = Cross(Grain, RandomVector);
        const double Bend = std::max(0.0, 1.0 - R / std::max(1.0e-4, ObjectRadius * 0.5));
        if (Random.Next() < 0.12 + 0.24 * Bend) N = Add(Grain, Mul(Hoop, 0.22));
    }
    else if (Mat.Mode == FractureMode::BulkBrittle)
    {
        const double Ratio = std::clamp(R / std::max(1.0e-4, ObjectRadius * 0.58), 0.0, 1.0);
        const double RingProb = std::pow(Ratio, 1.45) * Mat.RingBias;
        if (R < ObjectRadius * 0.24 && Axial > 0.0 && Mat.HertzConeRadians > 0.0 && Random.Next() < 0.40)
        {
            const double S = std::sin(Mat.HertzConeRadians), C = std::cos(Mat.HertzConeRadians);
            N = Sub(Mul(Radial, S), Mul(D, C));
        }
        else if (Random.Next() < RingProb) N = Radial;
        if (Mat.BeddingWeakness > 0.0 && Random.Next() < 0.35 + Mat.BeddingWeakness * 0.4)
        {
            const Vec3 Grain = RotateGrainAxis(Mat, GrainAngleRad);
            N = Add(Mul(N, 0.2), Mul(Grain, 0.8));
        }
    }
    else
    {
        const double T = Random.Next() * 0.5;
        N = Lerp(Hoop, Radial, T);
    }
    N = Add(N, { (Random.Next() - 0.5) * Mat.CrackJitter, (Random.Next() - 0.5) * Mat.CrackJitter,
                 (Random.Next() - 0.5) * Mat.CrackJitter });
    return Normalize(N);
}

std::vector<Polyhedron> SolveFastRuntime(const Polyhedron& Base, const Metrics& BaseMetrics, const Request& Input,
                                         const Material& Mat, uint32_t Ceiling, RandomStream& Random,
                                         uint32_t& NextToken, double& SpentEnergy, double TotalEnergyBudget)
{
    struct Item { Polyhedron Shape; Metrics Measure; double Energy = 0.0; uint32_t Generation = 0; };
    const double MinSpan = std::max(0.015, Input.MinimumPieceSizeMetres);
    const double ObjectRadius = std::max(0.1, BaseMetrics.Radius);
    std::vector<Item> Work{ { Base, BaseMetrics, TotalEnergyBudget, 0 } };
    std::vector<Item> Done;

    // The upstream fast path first scores a four-plane Hertzian cone plug under the impact point.
    if (Mat.HertzConeRadians > 0.1 && TotalEnergyBudget > 80.0 && Ceiling >= 6)
    {
        constexpr int Sides = 4;
        const double ConeBudget = TotalEnergyBudget * 0.22;
        const Vec3 D = Mul(Input.ImpactNormal, -1.0);
        const double ContactRadius = std::max(0.03, ObjectRadius * 0.12);
        const Vec3 Anchor = Sub(Input.ImpactPointMetres, Mul(D, ContactRadius * 0.35));
        const Vec3 U0 = std::fabs(D[0]) < 0.85 ? Normalize({ 0.0, D[2], -D[1] }) : Normalize({ -D[2], 0.0, D[0] });
        const Vec3 U1 = Cross(D, U0);
        Polyhedron Core = std::move(Work.back().Shape);
        Work.clear();
        for (int S = 0; S < Sides && !Core.Vertices.empty(); ++S)
        {
            const double Angle = (S / static_cast<double>(Sides)) * 2.0 * Pi + Random.Next() * 0.16;
            const double C = std::cos(Angle), Sn = std::sin(Angle);
            const double Ch = std::sin(Mat.HertzConeRadians), Sh = std::cos(Mat.HertzConeRadians);
            const Vec3 Tangent = Add(Mul(U0, C), Mul(U1, Sn));
            const Vec3 PlaneNormal = Normalize(Sub(Mul(Tangent, Ch), Mul(D, Sh)));
            const double Offset = Dot(PlaneNormal, Anchor);
            ClipResult Split = ClipAll(Core, PlaneNormal, Offset, NextToken++, true);
            if (Split.Split)
            {
                SpentEnergy += 2.0 * Mat.FractureEnergyJPerM2 * Split.CutArea;
                Work.push_back({ std::move(Split.Front), {}, ConeBudget / Sides, 1 });
                Work.back().Measure = EvaluateMetrics(Work.back().Shape);
                Core = std::move(Split.Back);
            }
        }
        if (!Core.Vertices.empty())
            Work.push_back({ std::move(Core), {}, TotalEnergyBudget - ConeBudget * 0.5, 0 }), Work.back().Measure = EvaluateMetrics(Work.back().Shape);
    }

    const uint32_t MaxIterations = Ceiling * 5;
    for (uint32_t Iteration = 0; !Work.empty() && Work.size() + Done.size() < Ceiling && Iteration < MaxIterations; ++Iteration)
    {
        size_t Best = 0;
        double BestScore = -std::numeric_limits<double>::infinity();
        for (size_t I = 0; I < Work.size(); ++I)
        {
            const double Score = (Work[I].Energy + Work[I].Measure.Volume * 350.0) / (1.0 + Work[I].Generation * 0.32);
            if (Score > BestScore) { BestScore = Score; Best = I; }
        }
        Item Current = std::move(Work[Best]);
        Work.erase(Work.begin() + static_cast<std::ptrdiff_t>(Best));
        if (Current.Measure.Volume < 1.0e-6 || ComponentMin(Current.Measure.Span) < MinSpan * 0.8 || Current.Energy <= 0.0)
        {
            Done.push_back(std::move(Current));
            continue;
        }
        const Vec3 Normal = EvaluateFastBoussinesqNormal(Mat, Current.Measure, Input, ObjectRadius,
                                                         Input.GrainAngleDegrees * Pi / 180.0, Random);
        const double Jitter = (Random.Next() - 0.5) * 0.24 * Current.Measure.Radius;
        const Vec3 ToImpact = Sub(Input.ImpactPointMetres, Current.Measure.Centroid);
        const double DistImpact = Length(ToImpact);
        const double Pull = 0.10 * std::max(0.0, 1.0 - DistImpact / (ObjectRadius + 1.0e-5));
        const Vec3 Focus = Add(Current.Measure.Centroid, Mul(ToImpact, Pull));
        const double Offset = Dot(Normal, Focus) + Jitter;
        ClipResult Split = ClipAll(Current.Shape, Normal, Offset, NextToken++, true);
        if (!Split.Split)
        {
            Done.push_back(std::move(Current));
            continue;
        }
        Metrics FrontMetrics = EvaluateMetrics(Split.Front), BackMetrics = EvaluateMetrics(Split.Back);
        if (ComponentMin(FrontMetrics.Span) < MinSpan * 0.42 || ComponentMin(BackMetrics.Span) < MinSpan * 0.42)
        {
            Done.push_back(std::move(Current));
            continue;
        }
        const double LocalGc = EvaluateDirectionalToughness(Mat, Normal, Input.GrainAngleDegrees * Pi / 180.0, Random);
        const double Cost = 2.0 * LocalGc * Split.CutArea;
        if (Cost > Current.Energy && Done.size() + Work.size() >= 4)
        {
            Done.push_back(std::move(Current));
            continue;
        }
        SpentEnergy += Cost;
        const double Remaining = std::max(12.0, Current.Energy - Cost);
        const double Lambda = ObjectRadius * 0.55;
        const double WeightFront = FrontMetrics.Volume * std::exp(-Distance(FrontMetrics.Centroid, Input.ImpactPointMetres) / Lambda);
        const double WeightBack = BackMetrics.Volume * std::exp(-Distance(BackMetrics.Centroid, Input.ImpactPointMetres) / Lambda);
        const double WeightSum = WeightFront + WeightBack + 1.0e-12;
        Work.push_back({ std::move(Split.Front), FrontMetrics, Remaining * WeightFront / WeightSum, Current.Generation + 1 });
        Work.push_back({ std::move(Split.Back), BackMetrics, Remaining * WeightBack / WeightSum, Current.Generation + 1 });
    }
    for (Item& Rest : Work) { Rest.Energy = std::max(0.0, Rest.Energy); Done.push_back(std::move(Rest)); }
    std::sort(Done.begin(), Done.end(), [](const Item& A, const Item& B) { return A.Measure.Volume > B.Measure.Volume; });
    std::vector<Polyhedron> Out;
    Out.reserve(Done.size());
    for (Item& Piece : Done) Out.push_back(std::move(Piece.Shape));
    return Out;
}

std::vector<Polyhedron> SolveGriffith(const Polyhedron& Base, const Metrics& BaseMetrics, const Request& Input,
                                      const Material& Mat, uint32_t Ceiling, RandomStream& Random,
                                      uint32_t& NextToken, double& SpentEnergy, double TotalEnergyBudget)
{
    struct Item { Polyhedron Shape; Metrics Measure; double Energy = 0.0; };
    std::vector<Item> Pool{ { Base, BaseMetrics, TotalEnergyBudget } };
    const double GrainRad = Input.GrainAngleDegrees * Pi / 180.0;
    if (Mat.HertzConeRadians > 0.1)
    {
        for (int K = 0; K < 4 && Pool.size() < Ceiling; ++K)
        {
            const double Azimuth = (2.0 * Pi * K / 4.0) + Random.Next() * 0.35;
            const Vec3 Tangent = Add(Mul(Perpendicular(Input.ImpactNormal), std::cos(Azimuth)),
                                     Mul(Cross(Input.ImpactNormal, Perpendicular(Input.ImpactNormal)), std::sin(Azimuth)));
            const Vec3 ConeNormal = Normalize(Add(Mul(Tangent, std::sin(Mat.HertzConeRadians)),
                                                   Mul(Input.ImpactNormal, -std::cos(Mat.HertzConeRadians))));
            const Vec3 Anchor = Add(Input.ImpactPointMetres, Mul(Input.ImpactNormal, 0.14 * BaseMetrics.Radius));
            const double Offset = Dot(ConeNormal, Anchor) + (Random.Next() - 0.5) * 0.06 * BaseMetrics.Radius;
            std::sort(Pool.begin(), Pool.end(), [&](const Item& A, const Item& B) {
                return Distance(A.Measure.Centroid, Input.ImpactPointMetres) < Distance(B.Measure.Centroid, Input.ImpactPointMetres);
            });
            ClipResult Split = ClipAll(Pool.front().Shape, ConeNormal, Offset, NextToken++, true);
            if (!Split.Split) continue;
            Metrics A = EvaluateMetrics(Split.Front), B = EvaluateMetrics(Split.Back);
            if (std::min(ComponentMin(A.Span), ComponentMin(B.Span)) < Input.MinimumPieceSizeMetres * 0.6 ||
                A.Volume < 1.0e-6 || B.Volume < 1.0e-6) continue;
            const double Cost = 2.0 * Mat.FractureEnergyJPerM2 * Split.CutArea;
            SpentEnergy += Cost;
            const double Remaining = std::max(0.0, Pool.front().Energy - Cost);
            const double Ratio = A.Volume / (A.Volume + B.Volume);
            Pool.erase(Pool.begin());
            Pool.insert(Pool.begin(), { std::move(Split.Back), B, Remaining * (1.0 - Ratio) });
            Pool.insert(Pool.begin(), { std::move(Split.Front), A, Remaining * Ratio });
        }
    }
    for (uint32_t Guard = 0; Pool.size() < Ceiling && Guard < Ceiling * 10; ++Guard)
    {
        size_t TargetIndex = Pool.size();
        double BestPriority = -1.0;
        for (size_t I = 0; I < Pool.size(); ++I)
        {
            const Item& ItemAt = Pool[I];
            if (ComponentMax(ItemAt.Measure.Span) < Input.MinimumPieceSizeMetres * 2.1) continue;
            const double D = Distance(ItemAt.Measure.Centroid, Input.ImpactPointMetres);
            const double Proximity = Mat.StoredEnergyJPerM3 > 0.0 ? 1.0
                : 1.0 / (0.14 + std::pow(D / std::max(0.25, BaseMetrics.Radius), 1.35));
            const double Priority = (ItemAt.Energy + 18.0) * std::pow(ItemAt.Measure.Volume, 0.55) * Proximity;
            if (Priority > BestPriority) { BestPriority = Priority; TargetIndex = I; }
        }
        if (TargetIndex >= Pool.size()) break;
        const Item Target = Pool[TargetIndex];
        bool Chosen = false;
        ClipResult BestSplit;
        Metrics BestFront, BestBack;
        double BestCost = 0.0, BestScore = -1.0;
        for (int Candidate = 0; Candidate < 7; ++Candidate)
        {
            const Vec3 Normal = SampleStressCrackNormal(Mat, Target.Measure.Centroid, Input, BaseMetrics.Radius,
                                                        GrainRad, Random);
            const double Bias = (Random.Next() - 0.5) * 0.28 * Target.Measure.Radius;
            ClipResult Split = ClipAll(Target.Shape, Normal, Dot(Normal, Target.Measure.Centroid) + Bias,
                                       NextToken++, true);
            if (!Split.Split) continue;
            Metrics A = EvaluateMetrics(Split.Front), B = EvaluateMetrics(Split.Back);
            const double MinimumSpan = std::min(ComponentMin(A.Span), ComponentMin(B.Span));
            const double Balance = std::min(A.Volume, B.Volume) / std::max(A.Volume, B.Volume);
            if (MinimumSpan < Input.MinimumPieceSizeMetres * 0.45 || Balance < 0.12) continue;
            const double Cost = 2.0 * EvaluateDirectionalToughness(Mat, Normal, GrainRad, Random) * Split.CutArea;
            const double Score = (Balance * 1.4) / (1.0 + Cost / std::max(60.0, TotalEnergyBudget * 0.15));
            if (!Chosen || Score > BestScore)
            {
                Chosen = true; BestScore = Score; BestCost = Cost;
                BestSplit = std::move(Split); BestFront = A; BestBack = B;
            }
        }
        if (!Chosen)
        {
            Pool[TargetIndex].Energy *= 0.15;
            continue;
        }
        if (SpentEnergy + BestCost > TotalEnergyBudget * 1.35 && Pool.size() >= 4) break;
        SpentEnergy += BestCost;
        const double Remaining = std::max(0.0, Target.Energy - BestCost);
        const double Share = BestFront.Volume / (BestFront.Volume + BestBack.Volume);
        Pool.erase(Pool.begin() + static_cast<std::ptrdiff_t>(TargetIndex));
        Pool.insert(Pool.begin() + static_cast<std::ptrdiff_t>(TargetIndex),
                    { std::move(BestSplit.Back), BestBack, Remaining * (1.0 - Share) });
        Pool.insert(Pool.begin() + static_cast<std::ptrdiff_t>(TargetIndex),
                    { std::move(BestSplit.Front), BestFront, Remaining * Share });
    }
    std::vector<Polyhedron> Out;
    Out.reserve(Pool.size());
    for (Item& Piece : Pool) Out.push_back(std::move(Piece.Shape));
    return Out;
}

std::vector<Polyhedron> SolveVoronoi(const Polyhedron& BaseComplex, const Metrics& BaseMetrics,
                                     const Request& Input, uint32_t Ceiling, RandomStream& Random,
                                     uint32_t& NextToken)
{
    const std::vector<Vec3> Seeds = GenerateVoronoiSeeds(BaseMetrics, Input, Ceiling, Random);
    std::vector<Polyhedron> Cells;
    Cells.reserve(Seeds.size());
    std::map<std::pair<uint32_t, uint32_t>, uint32_t> PairTokens;
    auto TokenFor = [&](uint32_t A, uint32_t B)
    {
        const auto Key = std::minmax(A, B);
        const std::pair<uint32_t, uint32_t> P{ Key.first, Key.second };
        const auto Found = PairTokens.find(P);
        if (Found != PairTokens.end()) return Found->second;
        const uint32_t Token = NextToken++;
        PairTokens.emplace(P, Token);
        return Token;
    };

    for (uint32_t I = 0; I < Seeds.size(); ++I)
    {
        Polyhedron Cell = BaseComplex;
        std::vector<std::pair<double, uint32_t>> Neighbours;
        Neighbours.reserve(Seeds.size() - 1);
        for (uint32_t J = 0; J < Seeds.size(); ++J)
            if (I != J) Neighbours.emplace_back(Distance(Seeds[I], Seeds[J]), J);
        std::sort(Neighbours.begin(), Neighbours.end());
        for (const auto& [UnusedDistance, J] : Neighbours)
        {
            (void)UnusedDistance;
            const Vec3 Mid = Mul(Add(Seeds[I], Seeds[J]), 0.5);
            const Vec3 Normal = Normalize(Sub(Seeds[J], Seeds[I]));
            ClipResult Split = ClipAll(Cell, Normal, Dot(Normal, Mid), TokenFor(I, J), true);
            if (Split.Split) Cell = std::move(Split.Back); // Cell i is on the n·x <= d half-space.
            else if (!Split.HasBack) { Cell = {}; break; }
        }
        if (!Cell.Vertices.empty() && EvaluateMetrics(Cell).Volume > 1.0e-6) Cells.push_back(std::move(Cell));
    }
    return Cells;
}

Vec3 PrincipalDirection(const Vec3& Radial, const Vec3& ImpactNormal, double GrainAngle, double Anisotropy) noexcept;

struct PieceWork
{
    Polyhedron Shape;
    Metrics Measure;
    double Energy = 0.0;
};

std::vector<Polyhedron> SolveSequentialCuts(const Polyhedron& BaseComplex, const Metrics& BaseMetrics,
                                            const Request& Input, const Material& Mat, Solver Algorithm,
                                            uint32_t Ceiling, double EnergyBudget, RandomStream& Random,
                                            uint32_t& NextToken, double& SpentEnergy)
{
    std::vector<PieceWork> Pool{ { BaseComplex, BaseMetrics, EnergyBudget } };
    const Vec3 ImpactNormal = Normalize(Input.ImpactNormal);
    const double MinSpan = std::max(0.015, Input.MinimumPieceSizeMetres);
    const double GrainRad = Input.GrainAngleDegrees * Pi / 180.0;
    const uint32_t GuardLimit = Ceiling * 12;
    for (uint32_t Guard = 0; Pool.size() < Ceiling && Guard < GuardLimit; ++Guard)
    {
        size_t TargetIndex = Pool.size();
        double BestPriority = -1.0;
        for (size_t I = 0; I < Pool.size(); ++I)
        {
            const PieceWork& P = Pool[I];
            if (ComponentMax(P.Measure.Span) < MinSpan * 1.8) continue;
            const double DistanceFromImpact = Distance(P.Measure.Centroid, Input.ImpactPointMetres);
            const double Proximity = 1.0 / (0.14 + std::pow(DistanceFromImpact / std::max(0.25, BaseMetrics.Radius), 1.35));
            const double ModeBias = Algorithm == Solver::RuntimeBoussinesq ? 1.0 + 2.0 * std::exp(-DistanceFromImpact * 2.0)
                                   : Algorithm == Solver::EngineeringFem ? 1.0 + 1.0 / (0.2 + DistanceFromImpact)
                                   : 1.0;
            const double Priority = (P.Energy + 18.0) * std::pow(std::max(P.Measure.Volume, 1.0e-9), 0.55) * Proximity * ModeBias;
            if (Priority > BestPriority) { BestPriority = Priority; TargetIndex = I; }
        }
        if (TargetIndex >= Pool.size()) break;
        PieceWork& Target = Pool[TargetIndex];
        ClipResult BestSplit;
        Metrics BestFront, BestBack;
        double BestCutCost = 0.0, BestScore = -1.0;
        for (int Candidate = 0; Candidate < 9; ++Candidate)
        {
            const double CandidateTheta = Random.Next() * 2.0 * Pi;
            Vec3 Normal{};
            if (Algorithm == Solver::Wavefront)
            {
                const Vec3 TangentU = Perpendicular(ImpactNormal);
                const Vec3 TangentV = Normalize(Cross(ImpactNormal, TangentU));
                const double WaveTheta = 2.0 * Pi * (Guard % 7) / 7.0 + (Random.Next() - 0.5) * 0.35;
                Normal = Normalize(Add(Mul(TangentU, std::cos(WaveTheta)), Mul(TangentV, std::sin(WaveTheta))));
            }
            else if (Algorithm == Solver::Dendritic)
            {
                const Vec3 Direction = Normalize(Sub(Target.Measure.Centroid, Input.ImpactPointMetres));
                const Vec3 RandomSide = Normalize({ Random.Next() * 2.0 - 1.0, Random.Next() * 2.0 - 1.0,
                                                     Random.Next() * 2.0 - 1.0 });
                Normal = Normalize(Cross(Direction, RandomSide));
            }
            else if (Algorithm == Solver::EngineeringFem)
            {
                const Vec3 Relative = Sub(Target.Measure.Centroid, Input.ImpactPointMetres);
                const Vec3 InPlane = Sub(Relative, Mul(ImpactNormal, Dot(Relative, ImpactNormal)));
                const Vec3 Radial = Length(InPlane) > 1.0e-5 ? Normalize(InPlane) : Perpendicular(ImpactNormal);
                Normal = PrincipalDirection(Radial, ImpactNormal, GrainRad, Mat.AnisotropyRatio);
                if (Random.Next() < 0.18)
                {
                    const Vec3 Perturbation{ Random.Next() - 0.5, Random.Next() - 0.5, Random.Next() - 0.5 };
                    Normal = Normalize(Add(Normal, Mul(Perturbation, 0.15)));
                }
            }
            else
            {
                const Vec3 Grain{ std::cos(GrainRad), std::sin(GrainRad), 0.0 };
                const Vec3 TangentA = Perpendicular(ImpactNormal);
                const Vec3 TangentB = Normalize(Cross(ImpactNormal, TangentA));
                const double Nearness = 1.0 / (1.0 + Distance(Target.Measure.Centroid, Input.ImpactPointMetres));
                const double GrainMix = Algorithm == Solver::EngineeringFem ? 0.25 * Mat.AnisotropyRatio
                                        : Algorithm == Solver::RuntimeBoussinesq ? 0.15
                                        : 0.10 * Mat.AnisotropyRatio;
                Normal = Normalize(Add(Add(Mul(ImpactNormal, -0.45 + 0.25 * Random.Next()),
                                            Mul(TangentA, std::cos(CandidateTheta) * (0.55 + Nearness))),
                                        Add(Mul(TangentB, std::sin(CandidateTheta) * (0.55 + Nearness)), Mul(Grain, GrainMix))));
            }
            if (LengthSquared(Normal) < 0.1) Normal = Perpendicular(ImpactNormal);
            const double Offset = Dot(Normal, Target.Measure.Centroid) + (Random.Next() - 0.5) * 0.20 * Target.Measure.Radius;
            ClipResult Split = ClipAll(Target.Shape, Normal, Offset, NextToken++, true);
            if (!Split.Split) continue;
            Metrics FrontMetrics = EvaluateMetrics(Split.Front), BackMetrics = EvaluateMetrics(Split.Back);
            const double SmallerSpan = std::min(ComponentMin(FrontMetrics.Span), ComponentMin(BackMetrics.Span));
            const double SmallerVolume = std::min(FrontMetrics.Volume, BackMetrics.Volume);
            const double LargerVolume = std::max(FrontMetrics.Volume, BackMetrics.Volume);
            const double Balance = LargerVolume > Tiny ? SmallerVolume / LargerVolume : 0.0;
            if (SmallerSpan < MinSpan * 0.40 || Balance < 0.08 || SmallerVolume < 1.0e-7) continue;
            const double ToughnessScale = 1.0 + std::fabs(std::sin(2.0 * (CandidateTheta + GrainRad))) *
                                                   std::max(0.0, Mat.AnisotropyRatio - 1.0) * 0.2;
            const double Cost = 2.0 * Mat.FractureEnergyJPerM2 * ToughnessScale * Split.CutArea;
            const double Score = (1.4 * Balance) / (1.0 + Cost / std::max(60.0, EnergyBudget * 0.15));
            if (Score > BestScore)
            {
                BestScore = Score;
                BestSplit = std::move(Split);
                BestFront = FrontMetrics;
                BestBack = BackMetrics;
                BestCutCost = Cost;
            }
        }
        if (!BestSplit.Split)
        {
            Target.Energy *= 0.15;
            if (Target.Energy < 1.0) break;
            continue;
        }
        if (SpentEnergy + BestCutCost > EnergyBudget * 1.35 && Pool.size() >= 4) break;
        SpentEnergy += BestCutCost;
        const double Remaining = std::max(0.0, Target.Energy - BestCutCost);
        const double ShareFront = BestFront.Volume / std::max(Tiny, BestFront.Volume + BestBack.Volume);
        PieceWork Front{ std::move(BestSplit.Front), BestFront, Remaining * ShareFront };
        PieceWork Back{ std::move(BestSplit.Back), BestBack, Remaining * (1.0 - ShareFront) };
        Pool.erase(Pool.begin() + static_cast<std::ptrdiff_t>(TargetIndex));
        Pool.insert(Pool.begin() + static_cast<std::ptrdiff_t>(TargetIndex), std::move(Back));
        Pool.insert(Pool.begin() + static_cast<std::ptrdiff_t>(TargetIndex), std::move(Front));
    }
    std::vector<Polyhedron> Out;
    Out.reserve(Pool.size());
    for (PieceWork& Piece : Pool) Out.push_back(std::move(Piece.Shape));
    return Out;
}

std::vector<Polyhedron> SolveWavefront(const Polyhedron& Base, const Metrics& BaseMetrics, const Request& Input,
                                       const Material& Mat, uint32_t Ceiling, uint32_t& NextToken,
                                       double& Spent, RandomStream& Random, double TotalEnergyBudget)
{
    const Vec3 TangentU = Perpendicular(Input.ImpactNormal);
    const Vec3 TangentV = Normalize(Cross(Input.ImpactNormal, TangentU));
    const uint32_t Spokes = std::clamp<uint32_t>(
        static_cast<uint32_t>(std::floor(3.0 + std::sqrt(TotalEnergyBudget / std::max(12.0, Mat.FractureEnergyJPerM2 * 8.0)) + 0.5)),
        3u, 12u);
    std::vector<double> Angles;
    Angles.reserve(Spokes);
    for (uint32_t S = 0; S < Spokes; ++S)
        Angles.push_back(2.0 * Pi * S / Spokes + (Random.Next() - 0.5) * (0.38 / Spokes) * Pi);

    std::vector<Polyhedron> Pieces{ Base };
    for (const double Theta : Angles)
    {
        if (Pieces.size() >= Ceiling) break;
        const Vec3 Ray = Add(Mul(TangentU, std::cos(Theta)), Mul(TangentV, std::sin(Theta)));
        const Vec3 PlaneNormal = Normalize(Cross(Input.ImpactNormal, Ray));
        const double Offset = Dot(PlaneNormal, Input.ImpactPointMetres);
        std::vector<Polyhedron> Next;
        for (const Polyhedron& Piece : Pieces)
        {
            if (Pieces.size() + Next.size() >= Ceiling) { Next.push_back(Piece); continue; }
            const Metrics M = EvaluateMetrics(Piece);
            if (Dot(Sub(M.Centroid, Input.ImpactPointMetres), Ray) < -0.15 * BaseMetrics.Radius &&
                Next.size() + Pieces.size() > 2)
            {
                Next.push_back(Piece);
                continue;
            }
            ClipResult Split = ClipAll(Piece, PlaneNormal, Offset, NextToken++, true);
            if (Split.Split && EvaluateMetrics(Split.Front).Volume > 1.0e-5 && EvaluateMetrics(Split.Back).Volume > 1.0e-5)
            {
                Spent += 2.0 * Mat.FractureEnergyJPerM2 * Split.CutArea;
                Next.push_back(std::move(Split.Front));
                Next.push_back(std::move(Split.Back));
            }
            else Next.push_back(Piece);
        }
        Pieces = std::move(Next);
    }

    constexpr double Rings[] = { 0.24, 0.52, 0.84, 1.18 };
    for (const double RingFraction : Rings)
    {
        if (Pieces.size() >= Ceiling) break;
        const double RingRadius = RingFraction * BaseMetrics.Radius;
        std::vector<Polyhedron> Next;
        for (const Polyhedron& Piece : Pieces)
        {
            if (Pieces.size() + Next.size() >= Ceiling) { Next.push_back(Piece); continue; }
            const Metrics M = EvaluateMetrics(Piece);
            const Vec3 Relative = Sub(M.Centroid, Input.ImpactPointMetres);
            const Vec3 InPlane = Sub(Relative, Mul(Input.ImpactNormal, Dot(Relative, Input.ImpactNormal)));
            const double Radius = Length(InPlane);
            if (std::fabs(Radius - RingRadius) < M.Radius * 0.95 && ComponentMax(M.Span) > Input.MinimumPieceSizeMetres * 2.0)
            {
                const Vec3 RingNormal = Normalize(Add(Radius > 1.0e-5 ? Mul(InPlane, 1.0 / Radius) : TangentU,
                                                       Mul(Input.ImpactNormal, (Random.Next() - 0.5) * 0.22)));
                const Vec3 Anchor = Add(Input.ImpactPointMetres, Mul(RingNormal, RingRadius * (0.9 + Random.Next() * 0.2)));
                ClipResult Split = ClipAll(Piece, RingNormal, Dot(RingNormal, Anchor), NextToken++, true);
                if (Split.Split && EvaluateMetrics(Split.Front).Volume > 1.0e-5 && EvaluateMetrics(Split.Back).Volume > 1.0e-5)
                {
                    Spent += 2.0 * EvaluateDirectionalToughness(Mat, RingNormal,
                        Input.GrainAngleDegrees * Pi / 180.0, Random) * Split.CutArea;
                    Next.push_back(std::move(Split.Front));
                    Next.push_back(std::move(Split.Back));
                    continue;
                }
            }
            Next.push_back(Piece);
        }
        Pieces = std::move(Next);
    }
    return Pieces;
}

std::vector<Polyhedron> SolveDendritic(const Polyhedron& Base, const Metrics& BaseMetrics, const Request& Input,
                                       const Material& Mat, uint32_t Ceiling, uint32_t& NextToken,
                                       double& Spent, RandomStream& Random)
{
    std::vector<Polyhedron> Pieces{ Base };
    const Vec3 Side = Perpendicular(Input.ImpactNormal);
    const std::array<Vec3, 4> SpallDirections = {
        Normalize(Mul(Input.ImpactNormal, -1.0)),
        Normalize(Add(Mul(Input.ImpactNormal, -0.6), Side)),
        Normalize(Sub(Mul(Input.ImpactNormal, -0.6), Side)),
        Vec3{ 0.0, 1.0, 0.0 }
    };
    for (const Vec3& Direction : SpallDirections)
    {
        if (Pieces.size() >= std::min<uint32_t>(Ceiling, 7u)) break;
        const double ShellDepth = BaseMetrics.Radius * (0.48 + Random.Next() * 0.18);
        const double Offset = Dot(Direction, Add(BaseMetrics.Centroid, Mul(Direction, ShellDepth)));
        std::vector<Polyhedron> Next;
        for (const Polyhedron& Piece : Pieces)
        {
            ClipResult Split = ClipAll(Piece, Direction, Offset, NextToken++, true);
            if (Split.Split)
            {
                Spent += 2.0 * Mat.FractureEnergyJPerM2 * Split.CutArea;
                Next.push_back(std::move(Split.Front));
                Next.push_back(std::move(Split.Back));
            }
            else Next.push_back(Piece);
        }
        Pieces = std::move(Next);
    }

    std::vector<std::vector<Vec3>> Paths;
    Vec3 Cursor = Input.ImpactPointMetres;
    const Vec3 ExitTarget = Add(BaseMetrics.Centroid, Mul(Input.ImpactNormal, BaseMetrics.Radius * 0.85));
    std::vector<Vec3> Trunk{ Cursor };
    for (int Step = 1; Step <= 5; ++Step)
    {
        const double T = Step / 5.0;
        const Vec3 Jitter = Step < 5
            ? Vec3{ (Random.Next() - 0.5) * BaseMetrics.Radius * 0.45,
                    (Random.Next() - 0.5) * BaseMetrics.Radius * 0.45,
                    (Random.Next() - 0.5) * BaseMetrics.Radius * 0.45 }
            : Vec3{};
        Cursor = Add(Lerp(Input.ImpactPointMetres, ExitTarget, T), Jitter);
        Trunk.push_back(Cursor);
    }
    Paths.push_back(Trunk);
    const uint32_t BranchCount = std::clamp<uint32_t>(static_cast<uint32_t>(std::floor(Ceiling / 7.0 + 0.5)), 3u, 8u);
    for (uint32_t Branch = 0; Branch < BranchCount; ++Branch)
    {
        const Vec3 Anchor = Trunk[std::min<size_t>(Trunk.size() - 1, 1 + (Branch % (Trunk.size() - 1)))];
        const Vec3 End = Add(Anchor, { (Random.Next() - 0.5) * BaseMetrics.Radius * 1.3,
                                       (Random.Next() - 0.5) * BaseMetrics.Radius * 1.3,
                                       (Random.Next() - 0.5) * BaseMetrics.Radius * 1.3 });
        Paths.push_back({ Anchor, Lerp(Anchor, End, 0.52), End });
    }

    for (uint32_t Guard = 0; Pieces.size() < Ceiling && Guard < Ceiling * 6; ++Guard)
    {
        const auto Target = std::max_element(Pieces.begin(), Pieces.end(), [](const Polyhedron& A, const Polyhedron& B) {
            return EvaluateMetrics(A).Volume < EvaluateMetrics(B).Volume;
        });
        if (Target == Pieces.end()) break;
        const Metrics M = EvaluateMetrics(*Target);
        if (ComponentMax(M.Span) < Input.MinimumPieceSizeMetres * 1.8) break;
        const std::vector<Vec3>& Path = Paths[Guard % Paths.size()];
        const Vec3 SegmentA = Path.front(), SegmentB = Path.back();
        const Vec3 Direction = Normalize(Sub(SegmentB, SegmentA));
        const Vec3 RandomSide{ Random.Next() * 2.0 - 1.0, Random.Next() * 2.0 - 1.0, Random.Next() * 2.0 - 1.0 };
        const Vec3 CutNormal = Normalize(Cross(Direction, Normalize(RandomSide)));
        const Vec3 Anchor = Lerp(M.Centroid, SegmentA, 0.35);
        ClipResult Split = ClipAll(*Target, CutNormal, Dot(CutNormal, Anchor), NextToken++, true);
        if (!Split.Split) continue;
        const Metrics Front = EvaluateMetrics(Split.Front), Back = EvaluateMetrics(Split.Back);
        if (Front.Volume <= 1.0e-5 || Back.Volume <= 1.0e-5) continue;
        Spent += 2.0 * EvaluateDirectionalToughness(Mat, CutNormal,
            Input.GrainAngleDegrees * Pi / 180.0, Random) * Split.CutArea;
        const size_t Index = static_cast<size_t>(Target - Pieces.begin());
        Pieces.erase(Pieces.begin() + static_cast<std::ptrdiff_t>(Index));
        Pieces.insert(Pieces.begin() + static_cast<std::ptrdiff_t>(Index), std::move(Split.Back));
        Pieces.insert(Pieces.begin() + static_cast<std::ptrdiff_t>(Index), std::move(Split.Front));
    }
    return Pieces;
}

// Principal tensile direction of the compact native Boussinesq–Hertz stress tensor. The full browser bake
// solves the 12³ Navier–Cauchy lattice; this native real-time edit path keeps the same stress axes and
// constitutive anisotropy while the optional continuum lattice is scheduled for the offline bake path.
Vec3 PrincipalDirection(const Vec3& Radial, const Vec3& ImpactNormal, double GrainAngle, double Anisotropy) noexcept
{
    const Vec3 Hoop = Normalize(Cross(ImpactNormal, Radial));
    const Vec3 Grain = RotateGrainAxis(ResolveMaterial(MaterialKind::Wood), GrainAngle);
    const double GrainWeight = 0.02 * std::max(0.0, Anisotropy - 1.0);
    const Vec3 Axes[3] = { Radial, Hoop, ImpactNormal };
    const double Weight[3] = { 0.28, 1.0, -0.42 };
    double A[3][3]{};
    for (int Axis = 0; Axis < 3; ++Axis)
        for (int I = 0; I < 3; ++I)
            for (int J = 0; J < 3; ++J)
                A[I][J] += Weight[Axis] * Axes[Axis][I] * Axes[Axis][J];
    for (int I = 0; I < 3; ++I)
        for (int J = 0; J < 3; ++J)
            A[I][J] += GrainWeight * Grain[I] * Grain[J];
    double V[3][3] = { { 1, 0, 0 }, { 0, 1, 0 }, { 0, 0, 1 } };
    for (int Iteration = 0; Iteration < 16; ++Iteration)
    {
        int P = 0, Q = 1;
        if (std::fabs(A[0][2]) > std::fabs(A[P][Q])) { P = 0; Q = 2; }
        if (std::fabs(A[1][2]) > std::fabs(A[P][Q])) { P = 1; Q = 2; }
        if (std::fabs(A[P][Q]) < 1.0e-10) break;
        const double Theta = 0.5 * std::atan2(2.0 * A[P][Q], A[Q][Q] - A[P][P]);
        const double C = std::cos(Theta), S = std::sin(Theta);
        const double App = C*C*A[P][P] - 2*S*C*A[P][Q] + S*S*A[Q][Q];
        const double Aqq = S*S*A[P][P] + 2*S*C*A[P][Q] + C*C*A[Q][Q];
        for (int K = 0; K < 3; ++K)
        {
            if (K == P || K == Q) continue;
            const double Akp = C*A[K][P] - S*A[K][Q];
            const double Akq = S*A[K][P] + C*A[K][Q];
            A[K][P] = A[P][K] = Akp;
            A[K][Q] = A[Q][K] = Akq;
        }
        A[P][P] = App; A[Q][Q] = Aqq; A[P][Q] = A[Q][P] = 0.0;
        for (int K = 0; K < 3; ++K)
        {
            const double Vkp = C*V[K][P] - S*V[K][Q];
            const double Vkq = S*V[K][P] + C*V[K][Q];
            V[K][P] = Vkp; V[K][Q] = Vkq;
        }
    }
    int Largest = A[1][1] > A[0][0] ? 1 : 0;
    if (A[2][2] > A[Largest][Largest]) Largest = 2;
    return Normalize({ V[0][Largest], V[1][Largest], V[2][Largest] });
}

double FaceArea(const Polyhedron& Shape, const Face& F) noexcept
{
    if (F.Indices.size() < 3) return 0.0;
    const Vec3& O = Shape.Vertices[F.Indices[0]];
    double Area = 0.0;
    for (size_t I = 1; I + 1 < F.Indices.size(); ++I)
        Area += 0.5 * Length(Cross(Sub(Shape.Vertices[F.Indices[I]], O), Sub(Shape.Vertices[F.Indices[I + 1]], O)));
    return Area;
}

void BuildBonds(Result& Out, const Material& Mat, const Request& Input)
{
    struct TokenEntry { uint32_t Fragment; double Area; };
    std::map<uint32_t, std::vector<TokenEntry>> TokenGroups;
    for (const Fragment& F : Out.Fragments)
        for (const Face& Surface : F.Shape.Faces)
            if (Surface.Interior && Surface.CutToken > 0)
                TokenGroups[Surface.CutToken].push_back({ F.Index, FaceArea(F.Shape, Surface) });
    std::set<std::pair<uint32_t, uint32_t>> Seen;
    auto AddBond = [&](uint32_t A, uint32_t B, double SharedArea)
    {
        if (A == B || A >= Out.Fragments.size() || B >= Out.Fragments.size()) return;
        if (A > B) std::swap(A, B);
        if (!Seen.emplace(A, B).second) return;
        const Fragment& FA = Out.Fragments[A];
        const Fragment& FB = Out.Fragments[B];
        const Vec3 Mid = Mul(Add(FA.ShapeMetrics.Centroid, FB.ShapeMetrics.Centroid), 0.5);
        const double D = Distance(Mid, Input.ImpactPointMetres);
        const double Stress = 1.0 / (0.16 + std::pow(D / std::max(0.25, Out.BaseMetrics.Radius), 1.65));
        const double Capacity = (0.55 + 0.45 * Mat.TensileStrengthMPa / 60.0) * Input.BondStrengthScale *
                                (0.65 + std::min(1.4, SharedArea * 4.0));
        const double Ratio = Stress / std::max(0.15, Capacity * 2.4);
        Out.Bonds.push_back({ A, B, SharedArea, SharedArea * Mat.TensileStrengthMPa * 1.0e3 * Input.BondStrengthScale,
                              std::min(1.6, Ratio), Mat.StoredEnergyJPerM3 > 0.0 || Ratio >= 1.0 });
    };
    for (const auto& [Token, Entries] : TokenGroups)
    {
        (void)Token;
        for (size_t I = 0; I < Entries.size(); ++I)
            for (size_t J = I + 1; J < Entries.size(); ++J)
            {
                const Fragment& A = Out.Fragments[Entries[I].Fragment];
                const Fragment& B = Out.Fragments[Entries[J].Fragment];
                if (Distance(A.ShapeMetrics.Centroid, B.ShapeMetrics.Centroid) <=
                    (A.ShapeMetrics.Radius + B.ShapeMetrics.Radius) * 1.12)
                    AddBond(Entries[I].Fragment, Entries[J].Fragment, std::min(Entries[I].Area, Entries[J].Area));
            }
    }
    for (uint32_t I = 0; I < Out.Fragments.size(); ++I)
        for (uint32_t J = I + 1; J < Out.Fragments.size(); ++J)
        {
            const Fragment& A = Out.Fragments[I];
            const Fragment& B = Out.Fragments[J];
            if (Distance(A.ShapeMetrics.Centroid, B.ShapeMetrics.Centroid) <
                (A.ShapeMetrics.Radius + B.ShapeMetrics.Radius) * 0.78)
                AddBond(I, J, 0.04);
        }
}

bool IsFinite(const Vec3& V) noexcept
{
    return std::isfinite(V[0]) && std::isfinite(V[1]) && std::isfinite(V[2]);
}

bool IsClosedOrientedManifold(const Polyhedron& Shape) noexcept
{
    if (Shape.Vertices.size() < 4 || Shape.Faces.size() < 4) return false;
    struct EdgeUse { uint32_t Count = 0; int Orientation = 0; };
    std::map<std::pair<uint32_t, uint32_t>, EdgeUse> Edges;
    for (const Face& Surface : Shape.Faces)
    {
        if (Surface.Indices.size() < 3) return false;
        for (size_t I = 0; I < Surface.Indices.size(); ++I)
        {
            const uint32_t A = Surface.Indices[I];
            const uint32_t B = Surface.Indices[(I + 1) % Surface.Indices.size()];
            if (A >= Shape.Vertices.size() || B >= Shape.Vertices.size() || A == B) return false;
            const auto Key = std::minmax(A, B);
            EdgeUse& Use = Edges[{ Key.first, Key.second }];
            ++Use.Count;
            Use.Orientation += A < B ? 1 : -1;
        }
    }
    for (const auto& [Key, Use] : Edges)
    {
        (void)Key;
        if (Use.Count != 2 || Use.Orientation != 0) return false;
    }
    return !Edges.empty();
}

} // namespace

Material ResolveMaterial(MaterialKind Kind) noexcept
{
    Material M;
    M.Kind = Kind;
    switch (Kind)
    {
    case MaterialKind::Concrete:
        M = Material{}; break;
    case MaterialKind::Granite:
        M.Kind = Kind; M.DensityKgPerM3 = 2700.0; M.FractureEnergyJPerM2 = 95.0; M.TensileStrengthMPa = 12.5;
        M.YoungModulusGPa = 55.0; M.PoissonRatio = 0.25; M.AnisotropyRatio = 1.4; M.Friction = 0.90;
        M.Restitution = 0.10; M.WeibullModulus = 9.0; M.HertzConeRadians = 1.02; M.BeddingWeakness = 0.55;
        M.RingBias = 0.18; M.CrackJitter = 0.28; M.CompressiveStrengthMPa = 165.0;
        M.InternalFrictionDegrees = 48.0; M.HurstExponent = 0.80; M.AggregateScale = 9.5; M.AggregateWeight = 0.44;
        M.ReliefAmplitudeMetres = 0.030; break;
    case MaterialKind::Wood:
        M.Kind = Kind; M.Mode = FractureMode::Fibrous; M.DensityKgPerM3 = 520.0; M.FractureEnergyJPerM2 = 320.0;
        M.TensileStrengthMPa = 78.0; M.YoungModulusGPa = 11.0; M.PoissonRatio = 0.35;
        M.AnisotropyRatio = 11.0; M.Friction = 0.58; M.Restitution = 0.22; M.WeibullModulus = 6.0;
        M.HertzConeRadians = 0.0; M.BeddingWeakness = 0.0; M.RingBias = 0.06; M.CrackJitter = 0.14;
        M.CompressiveStrengthMPa = 45.0; M.InternalFrictionDegrees = 24.0; M.HurstExponent = 0.72;
        M.AggregateScale = 14.0; M.AggregateWeight = 0.0; M.ReliefAmplitudeMetres = 0.042; break;
    case MaterialKind::Glass:
        M.Kind = Kind; M.Mode = FractureMode::PlateBrittle; M.DensityKgPerM3 = 2500.0; M.FractureEnergyJPerM2 = 7.0;
        M.TensileStrengthMPa = 45.0; M.YoungModulusGPa = 70.0; M.PoissonRatio = 0.22; M.AnisotropyRatio = 1.0;
        M.Friction = 0.28; M.Restitution = 0.16; M.WeibullModulus = 5.0; M.HertzConeRadians = 1.15;
        M.BeddingWeakness = 0.0; M.RingBias = 0.44; M.CrackJitter = 0.18; M.CompressiveStrengthMPa = 700.0;
        M.InternalFrictionDegrees = 30.0; M.HurstExponent = 0.55; M.AggregateScale = 12.0; M.AggregateWeight = 0.0;
        M.ReliefAmplitudeMetres = 0.014; break;
    case MaterialKind::Tempered:
        M.Kind = Kind; M.Mode = FractureMode::PlateBrittle; M.DensityKgPerM3 = 2500.0; M.FractureEnergyJPerM2 = 7.0;
        M.TensileStrengthMPa = 170.0; M.StoredEnergyJPerM3 = 46000.0; M.YoungModulusGPa = 70.0; M.PoissonRatio = 0.22;
        M.AnisotropyRatio = 1.0; M.Friction = 0.35; M.Restitution = 0.14; M.WeibullModulus = 12.0;
        M.HertzConeRadians = 0.0; M.BeddingWeakness = 0.0; M.RingBias = 0.52; M.CrackJitter = 0.72;
        M.CompressiveStrengthMPa = 900.0; M.InternalFrictionDegrees = 32.0; M.HurstExponent = 0.58;
        M.AggregateScale = 16.0; M.AggregateWeight = 0.0; M.ReliefAmplitudeMetres = 0.010; break;
    case MaterialKind::Plastic:
        M.Kind = Kind; M.Mode = FractureMode::Ductile; M.DensityKgPerM3 = 1050.0; M.FractureEnergyJPerM2 = 460.0;
        M.TensileStrengthMPa = 42.0; M.YoungModulusGPa = 2.2; M.PoissonRatio = 0.35; M.AnisotropyRatio = 1.0;
        M.Friction = 0.45; M.Restitution = 0.36; M.WeibullModulus = 20.0; M.HertzConeRadians = 0.0;
        M.BeddingWeakness = 0.0; M.RingBias = 0.12; M.CrackJitter = 0.48; M.CompressiveStrengthMPa = 68.0;
        M.InternalFrictionDegrees = 8.0; M.HurstExponent = 0.66; M.AggregateScale = 8.0; M.AggregateWeight = 0.0;
        M.ReliefAmplitudeMetres = 0.032; break;
    }
    return M;
}

Material ResolveMaterialById(const char* Id) noexcept
{
    if (Id == nullptr) return ResolveMaterial(MaterialKind::Concrete);
    if (std::strcmp(Id, "granite") == 0) return ResolveMaterial(MaterialKind::Granite);
    if (std::strcmp(Id, "wood") == 0) return ResolveMaterial(MaterialKind::Wood);
    if (std::strcmp(Id, "glass") == 0) return ResolveMaterial(MaterialKind::Glass);
    if (std::strcmp(Id, "tempered") == 0) return ResolveMaterial(MaterialKind::Tempered);
    if (std::strcmp(Id, "plastic") == 0) return ResolveMaterial(MaterialKind::Plastic);
    return ResolveMaterial(MaterialKind::Concrete);
}

Polyhedron ConstructBox(double SizeXMetres, double SizeYMetres, double SizeZMetres)
{
    const double HX = 0.5 * SizeXMetres, HY = 0.5 * SizeYMetres, HZ = 0.5 * SizeZMetres;
    Polyhedron Out;
    Out.Vertices = { Vec3{ -HX, -HY, -HZ }, Vec3{ HX, -HY, -HZ }, Vec3{ HX, HY, -HZ }, Vec3{ -HX, HY, -HZ },
                     Vec3{ -HX, -HY, HZ }, Vec3{ HX, -HY, HZ }, Vec3{ HX, HY, HZ }, Vec3{ -HX, HY, HZ } };
    Out.Faces = { Face{ { 4, 5, 6, 7 }, 0, false }, Face{ { 3, 2, 1, 0 }, 0, false },
                  Face{ { 1, 2, 6, 5 }, 0, false }, Face{ { 3, 0, 4, 7 }, 0, false },
                  Face{ { 2, 3, 7, 6 }, 0, false }, Face{ { 0, 1, 5, 4 }, 0, false } };
    return Out;
}

Polyhedron ConstructSolid(SolidKind Kind, const Vec3& Scale, uint32_t Seed)
{
    Polyhedron Solid;
    if (Kind == SolidKind::Monolith) Solid = ConstructBox(0.96, 1.92, 0.96);
    else if (Kind == SolidKind::CurtainPane) Solid = ConstructBox(1.90, 1.38, 0.065);
    else if (Kind == SolidKind::TimberBeam) Solid = ConstructBox(2.15, 0.36, 0.28);
    else if (Kind == SolidKind::Cube) Solid = ConstructBox(1.32, 1.32, 1.32);
    else if (Kind == SolidKind::Boulder || Kind == SolidKind::HollowCore)
    {
        Solid = ConstructBox(1.70, 1.48, 1.56);
        RandomStream Random(Seed + 109);
        const uint32_t Cuts = Kind == SolidKind::HollowCore ? 18u : 14u;
        for (uint32_t I = 0; I < Cuts; ++I)
        {
            const double Theta = (2.0 * Pi * I) / Cuts + (Random.Next() - 0.5) * 0.35;
            const double Phi = std::acos(1.0 - 2.0 * ((I + 0.5) / Cuts)) + (Random.Next() - 0.5) * 0.25;
            const Vec3 Normal = Normalize({ std::sin(Phi) * std::cos(Theta), std::cos(Phi) * 1.08,
                                            std::sin(Phi) * std::sin(Theta) });
            const double Offset = 0.64 + Random.Next() * 0.16;
            ClipResult Clipped = ClipAll(Solid, Normal, Offset, 0, false);
            if (Clipped.Split) Solid = std::move(Clipped.Back);
        }
    }
    else
    {
        const bool IsCone = Kind == SolidKind::Cone;
        constexpr uint32_t Sides = 22;
        const double Radius = IsCone ? 0.76 : 0.62;
        const double HalfHeight = 0.5 * (IsCone ? 1.72 : 1.75);
        Solid.Vertices.reserve(IsCone ? Sides + 1 : Sides * 2);
        for (uint32_t I = 0; I < Sides; ++I)
        {
            const double Angle = 2.0 * Pi * I / Sides;
            Solid.Vertices.push_back({ Radius * std::cos(Angle), -HalfHeight, Radius * std::sin(Angle) });
        }
        if (IsCone)
        {
            const uint32_t Apex = static_cast<uint32_t>(Solid.Vertices.size());
            Solid.Vertices.push_back({ 0.0, HalfHeight, 0.0 });
            std::vector<uint32_t> Bottom;
            for (uint32_t I = 0; I < Sides; ++I) Bottom.push_back(I);
            Solid.Faces.push_back({ std::move(Bottom), 0, false });
            for (uint32_t I = 0; I < Sides; ++I)
                Solid.Faces.push_back({ { (I + 1) % Sides, I, Apex }, 0, false });
        }
        else
        {
            for (uint32_t I = 0; I < Sides; ++I)
            {
                const double Angle = 2.0 * Pi * I / Sides;
                Solid.Vertices.push_back({ Radius * std::cos(Angle), HalfHeight, Radius * std::sin(Angle) });
            }
            std::vector<uint32_t> Bottom, Top;
            for (uint32_t I = 0; I < Sides; ++I) Bottom.push_back(I);
            for (uint32_t I = 0; I < Sides; ++I) Top.push_back(2 * Sides - 1 - I);
            Solid.Faces.push_back({ std::move(Bottom), 0, false });
            Solid.Faces.push_back({ std::move(Top), 0, false });
            for (uint32_t I = 0; I < Sides; ++I)
                Solid.Faces.push_back({ { (I + 1) % Sides, I, Sides + I, Sides + (I + 1) % Sides }, 0, false });
        }
        Vec3 Centre{};
        for (const Vec3& P : Solid.Vertices) Centre = Add(Centre, P);
        Centre = Mul(Centre, 1.0 / Solid.Vertices.size());
        for (Face& F : Solid.Faces)
        {
            Vec3 FaceCentre{}, Normal{};
            for (size_t I = 0; I < F.Indices.size(); ++I)
            {
                const Vec3& A = Solid.Vertices[F.Indices[I]];
                const Vec3& B = Solid.Vertices[F.Indices[(I + 1) % F.Indices.size()]];
                FaceCentre = Add(FaceCentre, A);
                Normal = Add(Normal, Cross(A, B));
            }
            FaceCentre = Mul(FaceCentre, 1.0 / F.Indices.size());
            if (Dot(Normal, Sub(FaceCentre, Centre)) < 0.0) std::reverse(F.Indices.begin(), F.Indices.end());
        }
    }
    for (Vec3& P : Solid.Vertices)
        for (int Axis = 0; Axis < 3; ++Axis) P[Axis] *= Scale[Axis];
    return Solid;
}

Metrics EvaluateMetrics(const Polyhedron& Shape) noexcept
{
    Metrics Out;
    if (Shape.Vertices.empty()) return Out;
    Out.BoundsMin = { std::numeric_limits<double>::infinity(), std::numeric_limits<double>::infinity(),
                      std::numeric_limits<double>::infinity() };
    Out.BoundsMax = { -std::numeric_limits<double>::infinity(), -std::numeric_limits<double>::infinity(),
                      -std::numeric_limits<double>::infinity() };
    const Vec3 Origin = Shape.Vertices.front();
    double SignedVol6 = 0.0;
    Vec3 CentroidAccumulator{};
    for (const Face& F : Shape.Faces)
    {
        if (F.Indices.size() < 3) continue;
        if (F.Interior) Out.CrackArea += FaceArea(Shape, F);
        for (size_t I = 1; I + 1 < F.Indices.size(); ++I)
        {
            const uint32_t I0 = F.Indices[0], I1 = F.Indices[I], I2 = F.Indices[I + 1];
            if (I0 >= Shape.Vertices.size() || I1 >= Shape.Vertices.size() || I2 >= Shape.Vertices.size()) continue;
            const Vec3& P0 = Shape.Vertices[I0];
            const Vec3& P1 = Shape.Vertices[I1];
            const Vec3& P2 = Shape.Vertices[I2];
            const double Tet6 = Dot(Sub(P0, Origin), Cross(Sub(P1, Origin), Sub(P2, Origin)));
            SignedVol6 += Tet6;
            CentroidAccumulator = Add(CentroidAccumulator, Mul(Add(Add(Origin, P0), Add(P1, P2)), 0.25 * Tet6));
        }
    }
    Out.Volume = std::fabs(SignedVol6) / 6.0;
    Out.Centroid = std::fabs(SignedVol6) > 1.0e-12 ? Mul(CentroidAccumulator, 1.0 / SignedVol6) : Origin;
    for (const Vec3& P : Shape.Vertices)
    {
        for (int Axis = 0; Axis < 3; ++Axis)
        {
            Out.BoundsMin[Axis] = std::min(Out.BoundsMin[Axis], P[Axis]);
            Out.BoundsMax[Axis] = std::max(Out.BoundsMax[Axis], P[Axis]);
        }
        Out.Radius = std::max(Out.Radius, Distance(P, Out.Centroid));
    }
    Out.Span = Sub(Out.BoundsMax, Out.BoundsMin);
    return Out;
}

bool Clip(const Polyhedron& Shape, const Vec3& PlaneNormal, double PlaneOffset, uint32_t CutToken,
          Polyhedron& OutFront, Polyhedron& OutBack, double& OutCutAreaM2)
{
    ClipResult Result = ClipAll(Shape, PlaneNormal, PlaneOffset, CutToken, true);
    OutFront = {};
    OutBack = {};
    OutCutAreaM2 = 0.0;
    if (!Result.Split) return false;
    OutFront = std::move(Result.Front);
    OutBack = std::move(Result.Back);
    OutCutAreaM2 = Result.CutArea;
    return true;
}

double EvaluateRayleighWaveSpeed(const Material& Mat) noexcept
{
    if (!(Mat.DensityKgPerM3 > 0.0) || !(Mat.YoungModulusGPa > 0.0) || !(Mat.PoissonRatio > -1.0)) return 0.0;
    const double Shear = (Mat.YoungModulusGPa * 1.0e9) / (2.0 * (1.0 + Mat.PoissonRatio));
    return 0.92 * std::sqrt(Shear / Mat.DensityKgPerM3);
}

Result Execute(const Request& RawInput, const Material& MaterialProperties)
{
    Request Input = RawInput;
    for (double H : Input.HalfExtentMetres)
        if (!std::isfinite(H) || !(H > 1.0e-4))
        {
            Result Invalid;
            Invalid.Diagnostic = "Fracture extents must be finite and positive.";
            return Invalid;
        }
    return Execute(ConstructBox(Input.HalfExtentMetres[0] * 2.0, Input.HalfExtentMetres[1] * 2.0,
                                Input.HalfExtentMetres[2] * 2.0), Input, MaterialProperties);
}

Result Execute(const Polyhedron& BaseSolid, const Request& RawInput, const Material& MaterialProperties)
{
    const auto StartTime = std::chrono::steady_clock::now();
    Result Out;
    Request Input = RawInput;
    if (!IsFinite(Input.ImpactPointMetres) || !IsFinite(Input.ImpactNormal) || !std::isfinite(Input.EnergyJoules) ||
        !std::isfinite(Input.MinimumPieceSizeMetres) || !std::isfinite(Input.BondStrengthScale) ||
        !std::isfinite(Input.GrainAngleDegrees))
    {
        Out.Diagnostic = "Fracture inputs must be finite.";
        return Out;
    }
    const uint32_t CeilingMaximum = Input.Algorithm == Solver::RuntimeBoussinesq ? 256u : 160u;
    Input.FragmentCeiling = std::clamp<uint32_t>(Input.FragmentCeiling, 2u, CeilingMaximum);
    Input.EnergyJoules = std::clamp(Input.EnergyJoules, 0.0, 1.0e9);
    Input.BondStrengthScale = std::clamp(Input.BondStrengthScale, 0.0, 16.0);
    Input.ImpactNormal = Normalize(Input.ImpactNormal);
    const Material Mat = MaterialProperties;
    if (!(Mat.DensityKgPerM3 > 0.0) || !(Mat.FractureEnergyJPerM2 >= 0.0) ||
        !std::isfinite(Mat.DensityKgPerM3) || !std::isfinite(Mat.FractureEnergyJPerM2))
    {
        Out.Diagnostic = "Fracture material density and fracture energy are invalid.";
        return Out;
    }

    Polyhedron Base = BaseSolid;
    Out.BaseMetrics = EvaluateMetrics(Base);
    if (!(Out.BaseMetrics.Volume > 1.0e-8) || !std::isfinite(Out.BaseMetrics.Volume))
    {
        Out.Diagnostic = "The source solid is degenerate.";
        return Out;
    }
    Input.MinimumPieceSizeMetres = std::clamp(Input.MinimumPieceSizeMetres, 0.015,
                                               std::max(0.015, 2.0 * ComponentMax(Out.BaseMetrics.Span)));
    const uint32_t Ceiling = Input.FragmentCeiling;
    const double StoredEnergy = std::max(0.0, Mat.StoredEnergyJPerM3) * Out.BaseMetrics.Volume;
    const double MinimumEnergy = Input.Algorithm == Solver::RuntimeBoussinesq ? 10.0 : 40.0;
    Out.TotalEnergyBudgetJ = std::max(MinimumEnergy, Input.EnergyJoules) + StoredEnergy;
    RandomStream Random(Input.Seed);
    uint32_t NextToken = Input.Algorithm == Solver::RuntimeBoussinesq ? 10u : 1u;
    double SpentEnergy = 0.0;
    std::vector<Polyhedron> RawPieces;
    switch (Input.Algorithm)
    {
    case Solver::RuntimeBoussinesq:
        RawPieces = SolveFastRuntime(Base, Out.BaseMetrics, Input, Mat, Ceiling, Random, NextToken,
                                     SpentEnergy, Out.TotalEnergyBudgetJ);
        break;
    case Solver::EngineeringFem:
    {
        uint64_t RandomDraws = 0;
        RawPieces = SolveEngineeringPartition(Base, Out.BaseMetrics, Input, Mat, Ceiling,
                                              Out.TotalEnergyBudgetJ, SpentEnergy, RandomDraws);
        for (uint64_t Draw = 0; Draw < RandomDraws; ++Draw) (void)Random.Next();
        break;
    }
    case Solver::Griffith:
        RawPieces = SolveGriffith(Base, Out.BaseMetrics, Input, Mat, Ceiling, Random, NextToken,
                                  SpentEnergy, Out.TotalEnergyBudgetJ);
        break;
    case Solver::Wavefront:
        RawPieces = SolveWavefront(Base, Out.BaseMetrics, Input, Mat, Ceiling, NextToken, SpentEnergy,
                                   Random, Out.TotalEnergyBudgetJ);
        break;
    case Solver::Voronoi:
        RawPieces = SolveVoronoi(Base, Out.BaseMetrics, Input, Ceiling, Random, NextToken);
        for (const Polyhedron& P : RawPieces) SpentEnergy += EvaluateMetrics(P).CrackArea * Mat.FractureEnergyJPerM2;
        break;
    case Solver::Dendritic:
        RawPieces = SolveDendritic(Base, Out.BaseMetrics, Input, Mat, Ceiling, NextToken, SpentEnergy, Random);
        break;
    default:
        RawPieces = SolveGriffith(Base, Out.BaseMetrics, Input, Mat, Ceiling, Random, NextToken,
                                  SpentEnergy, Out.TotalEnergyBudgetJ);
        break;
    }
    if (RawPieces.empty()) RawPieces.push_back(Base);

    Out.Fragments.reserve(RawPieces.size());
    double EjectionBase = std::sqrt((2.0 * std::max(15.0, Out.TotalEnergyBudgetJ * 0.08)) /
                                    std::max(0.8, Out.BaseMetrics.Volume * Mat.DensityKgPerM3));
    EjectionBase = std::isfinite(EjectionBase) ? EjectionBase : 0.0;
    for (uint32_t I = 0; I < RawPieces.size(); ++I)
    {
        Fragment F;
        F.Index = I;
        F.Shape = std::move(RawPieces[I]);
        F.ShapeMetrics = EvaluateMetrics(F.Shape);
        const double D = Distance(F.ShapeMetrics.Centroid, Input.ImpactPointMetres);
        F.ProximityToImpact = std::max(0.0, 1.0 - D / std::max(0.25, Out.BaseMetrics.Radius * 1.65));
        F.MassKg = std::max(0.01, F.ShapeMetrics.Volume * Mat.DensityKgPerM3);
        const Vec3 Outward = Normalize(Add(Sub(F.ShapeMetrics.Centroid, Input.ImpactPointMetres), Mul(Input.ImpactNormal, 0.35)));
        const double Speed = std::min(18.0, EjectionBase * (0.28 + 1.45 * F.ProximityToImpact * F.ProximityToImpact));
        F.InitialVelocityMps = Mul(Outward, Speed);
        const double J0 = Random.Next() - 0.5, J1 = Random.Next() - 0.5, J2 = Random.Next() - 0.5;
        const double SpinScale = 9.0 * (0.3 + F.ProximityToImpact);
        F.InitialAngularVelocityRadPerSec = { J0 * SpinScale, J1 * SpinScale, J2 * SpinScale };
        F.StressRatio = std::min(1.0, 0.18 + F.ProximityToImpact * 0.92);
        Out.TotalFragmentVolumeM3 += F.ShapeMetrics.Volume;
        Out.TotalCrackAreaM2 += F.ShapeMetrics.CrackArea;
        Out.Fragments.push_back(std::move(F));
    }
    Out.TotalCrackAreaM2 *= 0.5;
    Out.VolumeDriftRatio = Out.BaseMetrics.Volume > 1.0e-9
                               ? std::fabs(Out.TotalFragmentVolumeM3 - Out.BaseMetrics.Volume) / Out.BaseMetrics.Volume
                               : 0.0;
    Out.SpentSurfaceEnergyJ = std::min(Out.TotalEnergyBudgetJ,
                                      SpentEnergy > 0.0 ? SpentEnergy : 2.0 * Mat.FractureEnergyJPerM2 * Out.TotalCrackAreaM2);
    Out.RayleighSpeedMps = EvaluateRayleighWaveSpeed(Mat);
    BuildBonds(Out, Mat, Input);
    Out.WatertightManifold = !Out.Fragments.empty() && Out.VolumeDriftRatio < 1.0e-4 &&
                             std::all_of(Out.Fragments.begin(), Out.Fragments.end(), [](const Fragment& F) {
                                 return IsClosedOrientedManifold(F.Shape);
                             });
    Out.ComputeMilliseconds = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - StartTime).count();
    Out.Success = Out.WatertightManifold && Out.Fragments.size() <= Ceiling;
    if (!Out.Success) Out.Diagnostic = "The native fracture partition failed its volume-conservation check.";
    return Out;
}

} // namespace Frontier::Fracture
