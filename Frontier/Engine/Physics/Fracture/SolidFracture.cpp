/*==========================================================================================================================================
                                                   SOLIDFRACTUREEXTENSION.CPP
==========================================================================================================================================*/
// 🧩 Griffith surface-energy budgeted 3D convex polyhedron fracture (6 material presets, volume conservation, adjacency bonds).

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             INCLUDES
------------------------------------------------------------------------------------------------------------------------------------------*/
#include "Engine/Physics/Fracture/SolidFracture.h"

#include <algorithm>
#include <cmath>
#include <numeric>

namespace Frontier
{
namespace
{
struct InternalConvexPolyhedron
{
    std::vector<std::vector<Vec3>> Faces; // Outward-wound convex polygons
};

struct SplitMix64Fracture
{
    uint64_t Seed = 1ull;

    [[nodiscard]] float NextSigned() noexcept
    {
        Seed += 0x9E3779B97F4A7C15ull;
        uint64_t Z = Seed;
        Z          = (Z ^ (Z >> 30u)) * 0xBF58476D1CE4E5B9ull;
        Z          = (Z ^ (Z >> 27u)) * 0x94D049BB133111EBull;
        Z          = Z ^ (Z >> 31u);
        return static_cast<float>(static_cast<double>(Z >> 11u) * (2.0 / 9007199254740992.0) - 1.0);
    }

    [[nodiscard]] float NextUnit() noexcept
    {
        return 0.5f * (NextSigned() + 1.0f);
    }
};

[[nodiscard]] double EvaluatePolyhedronVolumeAndCentroid(const InternalConvexPolyhedron& Poly, Vec3& OutCentroid) noexcept
{
    if (Poly.Faces.empty())
    {
        OutCentroid = Vec3{0.0f, 0.0f, 0.0f};
        return 0.0;
    }

    // Use mean vertex as numerical reference origin for high-precision tetrahedral divergence integration!
    Vec3   Ref{0.0f, 0.0f, 0.0f};
    size_t Count = 0u;
    for (const auto& Face : Poly.Faces)
    {
        for (const Vec3& V : Face)
        {
            Ref = Ref + V;
            ++Count;
        }
    }
    if (Count == 0u)
    {
        OutCentroid = Vec3{0.0f, 0.0f, 0.0f};
        return 0.0;
    }
    Ref = Ref * (1.0f / static_cast<float>(Count));

    double SixVolume = 0.0;
    double Cx        = 0.0;
    double Cy        = 0.0;
    double Cz        = 0.0;

    for (const auto& Face : Poly.Faces)
    {
        if (Face.size() < 3u)
        {
            continue;
        }
        const Vec3 A = Face[0] - Ref;
        for (size_t I = 1u; I + 1u < Face.size(); ++I)
        {
            const Vec3   B    = Face[I] - Ref;
            const Vec3   C    = Face[I + 1u] - Ref;
            const double Det6 = static_cast<double>(A.X) * (static_cast<double>(B.Y) * C.Z - static_cast<double>(B.Z) * C.Y) +
                                static_cast<double>(A.Y) * (static_cast<double>(B.Z) * C.X - static_cast<double>(B.X) * C.Z) +
                                static_cast<double>(A.Z) * (static_cast<double>(B.X) * C.Y - static_cast<double>(B.Y) * C.X);
            SixVolume += Det6;
            Cx += Det6 * 0.25 * (static_cast<double>(A.X) + B.X + C.X);
            Cy += Det6 * 0.25 * (static_cast<double>(A.Y) + B.Y + C.Y);
            Cz += Det6 * 0.25 * (static_cast<double>(A.Z) + B.Z + C.Z);
        }
    }

    if (std::abs(SixVolume) <= 1.0e-12)
    {
        OutCentroid = Ref;
        return 0.0;
    }

    OutCentroid = Vec3{
        Ref.X + static_cast<float>(Cx / SixVolume),
        Ref.Y + static_cast<float>(Cy / SixVolume),
        Ref.Z + static_cast<float>(Cz / SixVolume)};
    return std::abs(SixVolume) / 6.0;
}

// Clips a closed convex polyhedron against plane Dot(PlaneNormal, X - PlanePoint) <= 0 (Back) and >= 0 (Front),
// reconstructing watertight convex cap polygons on both halves and returning the exact cut-cap area [m^2]!
bool BisectConvexPolyhedron(
    const InternalConvexPolyhedron& Input,
    Vec3                            PlanePoint,
    Vec3                            PlaneNormalUnit,
    InternalConvexPolyhedron&       OutBack,
    InternalConvexPolyhedron&       OutFront,
    double&                         OutCutCapAreaM2)
{
    constexpr float Eps = 1.0e-5f;
    OutBack.Faces.clear();
    OutFront.Faces.clear();
    OutCutCapAreaM2 = 0.0;

    std::vector<Vec3> CapPoints;

    auto AppendUniqueCapPoint = [&](Vec3 P)
    {
        for (const Vec3& Existing : CapPoints)
        {
            const Vec3 D = Existing - P;
            if (Dot(D, D) < 1.0e-8f)
            {
                return;
            }
        }
        CapPoints.push_back(P);
    };

    for (const auto& Face : Input.Faces)
    {
        if (Face.size() < 3u)
        {
            continue;
        }
        std::vector<Vec3> BackPoly;
        std::vector<Vec3> FrontPoly;
        const size_t      N = Face.size();

        for (size_t I = 0u; I < N; ++I)
        {
            const Vec3  Curr  = Face[I];
            const Vec3  Next  = Face[(I + 1u) % N];
            const float DCurr = Dot(PlaneNormalUnit, Curr - PlanePoint);
            const float DNext = Dot(PlaneNormalUnit, Next - PlanePoint);

            if (DCurr <= Eps)
            {
                BackPoly.push_back(Curr);
            }
            if (DCurr >= -Eps)
            {
                FrontPoly.push_back(Curr);
            }
            if (std::abs(DCurr) <= Eps)
            {
                AppendUniqueCapPoint(Curr);
            }

            if ((DCurr < -Eps && DNext > Eps) || (DCurr > Eps && DNext < -Eps))
            {
                const float T     = DCurr / (DCurr - DNext);
                const Vec3  Inter = Curr + (Next - Curr) * T;
                BackPoly.push_back(Inter);
                FrontPoly.push_back(Inter);
                AppendUniqueCapPoint(Inter);
            }
        }

        if (BackPoly.size() >= 3u)
        {
            OutBack.Faces.push_back(std::move(BackPoly));
        }
        if (FrontPoly.size() >= 3u)
        {
            OutFront.Faces.push_back(std::move(FrontPoly));
        }
    }

    if (CapPoints.size() < 3u || OutBack.Faces.empty() || OutFront.Faces.empty())
    {
        return false;
    }

    // Order CapPoints angularly around PlaneNormalUnit so cap faces have exact outward winding!
    Vec3 CapCentre{0.0f, 0.0f, 0.0f};
    for (const Vec3& P : CapPoints)
    {
        CapCentre = CapCentre + P;
    }
    CapCentre = CapCentre * (1.0f / static_cast<float>(CapPoints.size()));

    const Vec3 ReferenceAxis = (std::abs(PlaneNormalUnit.Z) < 0.9f) ? Vec3{0.0f, 0.0f, 1.0f} : Vec3{1.0f, 0.0f, 0.0f};
    const Vec3 TangentU   = Normalise(Cross(ReferenceAxis, PlaneNormalUnit));
    const Vec3 TangentV   = Cross(PlaneNormalUnit, TangentU);

    std::sort(
        CapPoints.begin(),
        CapPoints.end(),
        [&](const Vec3& A, const Vec3& B)
        {
            const Vec3  Da = A - CapCentre;
            const Vec3  Db = B - CapCentre;
            const float Aa = std::atan2(Dot(Da, TangentV), Dot(Da, TangentU));
            const float Ab = std::atan2(Dot(Db, TangentV), Dot(Db, TangentU));
            return Aa < Ab;
        });

    double Area = 0.0;
    for (size_t I = 1u; I + 1u < CapPoints.size(); ++I)
    {
        const Vec3 E1 = CapPoints[I] - CapPoints[0];
        const Vec3 E2 = CapPoints[I + 1u] - CapPoints[0];
        Area += 0.5 * static_cast<double>(Length(Cross(E1, E2)));
    }
    if (Area <= 1.0e-7)
    {
        return false;
    }

    // Back half lies in Dot(N, X - P) <= 0, so its outward cap normal is +PlaneNormalUnit (CCW in U,V)!
    OutBack.Faces.push_back(CapPoints);

    // Front half lies in Dot(N, X - P) >= 0, so its outward cap normal is -PlaneNormalUnit (reversed winding)!
    std::vector<Vec3> ReversedCap = CapPoints;
    std::reverse(ReversedCap.begin(), ReversedCap.end());
    OutFront.Faces.push_back(std::move(ReversedCap));

    Vec3         BackCent{}, FrontCent{};
    const double BackVol  = EvaluatePolyhedronVolumeAndCentroid(OutBack, BackCent);
    const double FrontVol = EvaluatePolyhedronVolumeAndCentroid(OutFront, FrontCent);
    if (BackVol <= 1.0e-8 || FrontVol <= 1.0e-8)
    {
        return false;
    }

    OutCutCapAreaM2 = Area;
    return true;
}

ConvexSolidFragment MaterializeFragmentFromPolyhedron(
    const InternalConvexPolyhedron& Poly,
    uint32_t                        Identifier,
    float                           DensityKgM3)
{
    ConvexSolidFragment Frag{};
    Frag.FragmentIdentifier = Identifier;

    Vec3         Centroid{};
    const double Vol       = EvaluatePolyhedronVolumeAndCentroid(Poly, Centroid);
    Frag.CentroidWorld     = Centroid;
    Frag.VolumeCubicMetres = static_cast<float>(Vol);
    Frag.MassKilograms     = static_cast<float>(Vol) * DensityKgM3;

    Vec3 BMin{1.0e9f, 1.0e9f, 1.0e9f};
    Vec3 BMax{-1.0e9f, -1.0e9f, -1.0e9f};

    auto AppendUniqueHullVertex = [&](Vec3 V)
    {
        BMin.X = std::min(BMin.X, V.X);
        BMin.Y = std::min(BMin.Y, V.Y);
        BMin.Z = std::min(BMin.Z, V.Z);
        BMax.X = std::max(BMax.X, V.X);
        BMax.Y = std::max(BMax.Y, V.Y);
        BMax.Z = std::max(BMax.Z, V.Z);

        for (const Vec3& Existing : Frag.HullVertices)
        {
            const Vec3 D = Existing - V;
            if (Dot(D, D) < 1.0e-8f)
            {
                return;
            }
        }
        Frag.HullVertices.push_back(V);
    };

    for (const auto& Face : Poly.Faces)
    {
        if (Face.size() < 3u)
        {
            continue;
        }
        for (const Vec3& V : Face)
        {
            AppendUniqueHullVertex(V);
        }

        const Vec3 E1  = Face[1] - Face[0];
        const Vec3 E2  = Face[2] - Face[0];
        Vec3       Nrm = Cross(E1, E2);
        Nrm            = (Length(Nrm) > 1.0e-7f) ? Normalise(Nrm) : Vec3{0.0f, 0.0f, 1.0f};
        if (Dot(Nrm, Face[0] - Centroid) < 0.0f)
        {
            Nrm = -Nrm;
        }

        const uint32_t Base = static_cast<uint32_t>(Frag.PolygonSurface.Vertices.size());
        for (const Vec3& V : Face)
        {
            Frag.PolygonSurface.Vertices.push_back(V);
        }
        for (size_t I = 1u; I + 1u < Face.size(); ++I)
        {
            Frag.PolygonSurface.Indices.push_back(Base);
            Frag.PolygonSurface.Indices.push_back(Base + static_cast<uint32_t>(I));
            Frag.PolygonSurface.Indices.push_back(Base + static_cast<uint32_t>(I + 1u));
            Frag.PolygonSurface.Normals.push_back(Nrm);
        }
    }

    const Vec3 Span = BMax - BMin;
    const float M12 = Frag.MassKilograms / 12.0f;
    Frag.DiagonalInertiaKgM2 = Vec3{
        std::max(1.0e-5f, M12 * (Span.Y * Span.Y + Span.Z * Span.Z)),
        std::max(1.0e-5f, M12 * (Span.X * Span.X + Span.Z * Span.Z)),
        std::max(1.0e-5f, M12 * (Span.X * Span.X + Span.Y * Span.Y))};

    return Frag;
}

InternalConvexPolyhedron BuildBoxPolyhedron(Vec3 Centre, Vec3 HalfExtents)
{
    const float X0 = Centre.X - HalfExtents.X, X1 = Centre.X + HalfExtents.X;
    const float Y0 = Centre.Y - HalfExtents.Y, Y1 = Centre.Y + HalfExtents.Y;
    const float Z0 = Centre.Z - HalfExtents.Z, Z1 = Centre.Z + HalfExtents.Z;

    const Vec3 P000{X0, Y0, Z0}, P100{X1, Y0, Z0}, P110{X1, Y1, Z0}, P010{X0, Y1, Z0};
    const Vec3 P001{X0, Y0, Z1}, P101{X1, Y0, Z1}, P111{X1, Y1, Z1}, P011{X0, Y1, Z1};

    InternalConvexPolyhedron Box{};
    Box.Faces = {
        {P000, P010, P110, P100}, // -Z bottom
        {P001, P101, P111, P011}, // +Z top
        {P000, P100, P101, P001}, // -Y south
        {P110, P010, P011, P111}, // +Y north
        {P010, P000, P001, P011}, // -X west
        {P100, P110, P111, P101}  // +X east
    };
    return Box;
}
} // namespace

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                       MATERIAL LOOKUP TABLE
------------------------------------------------------------------------------------------------------------------------------------------*/
FractureMaterialProperties LookupFractureMaterialProperties(FractureMaterialPreset Preset) noexcept
{
    FractureMaterialProperties M{};
    M.Preset = Preset;
    switch (Preset)
    {
    case FractureMaterialPreset::ReinforcedConcrete:
        M.DensityKgM3            = 2380.0f;
        M.ElasticThresholdJoules = 120.0f;
        M.FractureToughnessJm2   = 155.0f;
        M.Restitution            = 0.18f;
        M.Friction               = 0.74f;
        M.MaxFragmentBudget      = 28u;
        break;
    case FractureMaterialPreset::NaturalGraniteStone:
        M.DensityKgM3            = 2680.0f;
        M.ElasticThresholdJoules = 180.0f;
        M.FractureToughnessJm2   = 210.0f;
        M.Restitution            = 0.24f;
        M.Friction               = 0.72f;
        M.MaxFragmentBudget      = 24u;
        break;
    case FractureMaterialPreset::AnisotropicWoodGrain:
        M.DensityKgM3            = 640.0f;
        M.ElasticThresholdJoules = 45.0f;
        M.FractureToughnessJm2   = 95.0f;
        M.Restitution            = 0.28f;
        M.Friction               = 0.58f;
        M.MaxFragmentBudget      = 22u;
        M.WoodGrainDirection     = Vec3{0.0f, 0.0f, 1.0f};
        break;
    case FractureMaterialPreset::AnnealedWindowGlass:
        M.DensityKgM3            = 2500.0f;
        M.ElasticThresholdJoules = 8.0f;
        M.FractureToughnessJm2   = 9.0f;
        M.Restitution            = 0.35f;
        M.Friction               = 0.32f;
        M.MaxFragmentBudget      = 36u;
        break;
    case FractureMaterialPreset::TemperedSafetyGlass:
        M.DensityKgM3            = 2520.0f;
        M.ElasticThresholdJoules = 42.0f; // High residual compression threshold, then instant full-sheet dicing!
        M.FractureToughnessJm2   = 4.5f;
        M.Restitution            = 0.32f;
        M.Friction               = 0.36f;
        M.MaxFragmentBudget      = 48u;
        break;
    case FractureMaterialPreset::AutomotivePolymerAbs:
        M.DensityKgM3            = 1060.0f;
        M.ElasticThresholdJoules = 95.0f;
        M.FractureToughnessJm2   = 320.0f;
        M.Restitution            = 0.40f;
        M.Friction               = 0.50f;
        M.MaxFragmentBudget      = 12u;
        break;
    }
    return M;
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                     FRACTURE EXECUTION CORE
------------------------------------------------------------------------------------------------------------------------------------------*/
ConvexSolidFragment SolidFracture::CreateIntactBoxSolid(
    Vec3  BoxCentreWorld,
    Vec3  HalfExtentsMetres,
    float DensityKgM3)
{
    const InternalConvexPolyhedron Box = BuildBoxPolyhedron(BoxCentreWorld, HalfExtentsMetres);
    return MaterializeFragmentFromPolyhedron(Box, 0u, DensityKgM3);
}

FractureExecutionSummary SolidFracture::CleaveConvexSolid(
    const ConvexSolidFragment&          IntactSolid,
    const FractureMaterialProperties&   Material,
    const FractureImpactDescriptor&     Impact,
    std::vector<ConvexSolidFragment>&   OutFragments,
    std::vector<FragmentAdjacencyBond>& OutAdjacencyBonds) const
{
    OutFragments.clear();
    OutAdjacencyBonds.clear();

    FractureExecutionSummary Summary{};
    Summary.IntactVolumeM3 = IntactSolid.VolumeCubicMetres;

    // Reconstruct convex polyhedron faces from IntactSolid's bounding/hull vertices or triangles.
    Vec3 BMin{1.0e9f, 1.0e9f, 1.0e9f};
    Vec3 BMax{-1.0e9f, -1.0e9f, -1.0e9f};
    for (const Vec3& V : IntactSolid.HullVertices)
    {
        BMin.X = std::min(BMin.X, V.X);
        BMin.Y = std::min(BMin.Y, V.Y);
        BMin.Z = std::min(BMin.Z, V.Z);
        BMax.X = std::max(BMax.X, V.X);
        BMax.Y = std::max(BMax.Y, V.Y);
        BMax.Z = std::max(BMax.Z, V.Z);
    }
    const Vec3 Centre      = (BMin + BMax) * 0.5f;
    const Vec3 HalfExtents = (BMax - BMin) * 0.5f;

    InternalConvexPolyhedron RootPoly = BuildBoxPolyhedron(Centre, HalfExtents);
    Vec3                     RootCent{};
    Summary.IntactVolumeM3 = EvaluatePolyhedronVolumeAndCentroid(RootPoly, RootCent);

    const double AvailableEnergyJ = static_cast<double>(Impact.ImpactKineticEnergyJ - Material.ElasticThresholdJoules);
    if (AvailableEnergyJ <= 0.0 || Summary.IntactVolumeM3 <= 1.0e-8)
    {
        OutFragments.push_back(IntactSolid);
        Summary.FractureOccurred        = false;
        Summary.SumFragmentVolumeM3     = Summary.IntactVolumeM3;
        Summary.VolumeConservationRatio = 1.0;
        Summary.AnchoredFragmentCount   = 1u;
        return Summary;
    }

    // Griffith fracture surface-energy budget: E_fracture = 2 * gamma_f * A_cut!
    const double TwoGamma          = std::max(1.0, 2.0 * static_cast<double>(Material.FractureToughnessJm2));
    const double MaxCutAreaBudget  = AvailableEnergyJ / TwoGamma;
    const uint32_t TargetCap       = std::max(2u, Material.MaxFragmentBudget);

    std::vector<InternalConvexPolyhedron> Pieces;
    Pieces.push_back(std::move(RootPoly));

    SplitMix64Fracture Rng{Impact.DeterministicSeed};
    const Vec3         GrainAxis = (Length(Material.WoodGrainDirection) > 1.0e-4f)
                                       ? Normalise(Material.WoodGrainDirection)
                                       : Vec3{0.0f, 0.0f, 1.0f};
    const Vec3         ImpactDir = (Length(Impact.ImpactDirection) > 1.0e-4f)
                                       ? Normalise(Impact.ImpactDirection)
                                       : Vec3{1.0f, 0.0f, 0.0f};

    double AccumulatedCutAreaM2 = 0.0;
    uint32_t GuardIterations    = 0u;

    while (Pieces.size() < TargetCap && AccumulatedCutAreaM2 < MaxCutAreaBudget && GuardIterations < TargetCap * 5u)
    {
        ++GuardIterations;

        // Pick largest fragment biased toward the impact point so fracture concentrates near the collision!
        size_t BestIdx   = 0u;
        double BestScore = -1.0;
        Vec3   BestCent{};

        for (size_t K = 0u; K < Pieces.size(); ++K)
        {
            Vec3         C{};
            const double V    = EvaluatePolyhedronVolumeAndCentroid(Pieces[K], C);
            const float  Dist = Length(C - Impact.ImpactPointWorld);
            const double ProximityWeight = 1.0 / (0.25 + static_cast<double>(Dist));
            const double Score           = V * (0.35 + 0.65 * ProximityWeight);
            if (Score > BestScore)
            {
                BestScore = Score;
                BestIdx   = K;
                BestCent  = C;
            }
        }

        // Material-specific cleavage plane normal!
        Vec3 PlaneNormal{};
        Vec3 PlaneOrigin = BestCent;

        if (Material.Preset == FractureMaterialPreset::AnisotropicWoodGrain)
        {
            // 85% of splits cleave parallel to wood fibres (normal perpendicular to GrainAxis) -> long splinters!
            const Vec3 RandVec{Rng.NextSigned(), Rng.NextSigned(), Rng.NextSigned()};
            if (Rng.NextUnit() < 0.85f)
            {
                const Vec3 Perp = RandVec - GrainAxis * Dot(RandVec, GrainAxis);
                PlaneNormal     = (Length(Perp) > 1.0e-4f) ? Normalise(Perp) : Vec3{1.0f, 0.0f, 0.0f};
            }
            else
            {
                PlaneNormal = Normalise(GrainAxis + RandVec * 0.22f);
            }
        }
        else if (Material.Preset == FractureMaterialPreset::AnnealedWindowGlass)
        {
            // Alternating radial spiderweb rays through ImpactPointWorld and concentric circumferential rings!
            const Vec3 FromImpact = BestCent - Impact.ImpactPointWorld;
            if ((GuardIterations % 2u) == 1u)
            {
                const Vec3 RadialCross = Cross(FromImpact, ImpactDir) +
                                         Vec3{Rng.NextSigned(), Rng.NextSigned(), Rng.NextSigned()} * 0.15f;
                PlaneNormal = (Length(RadialCross) > 1.0e-4f) ? Normalise(RadialCross) : Vec3{0.0f, 1.0f, 0.0f};
                PlaneOrigin = Impact.ImpactPointWorld + (BestCent - Impact.ImpactPointWorld) * 0.15f;
            }
            else
            {
                PlaneNormal = (Length(FromImpact) > 1.0e-4f) ? Normalise(FromImpact) : Vec3{0.0f, 0.0f, 1.0f};
            }
        }
        else if (Material.Preset == FractureMaterialPreset::TemperedSafetyGlass)
        {
            // Orthogonal quasi-crystalline dicing into small equiaxed cubes!
            const int Axis = static_cast<int>(GuardIterations % 3u);
            Vec3      Base = (Axis == 0) ? Vec3{1.0f, 0.0f, 0.0f} : ((Axis == 1) ? Vec3{0.0f, 1.0f, 0.0f} : Vec3{0.0f, 0.0f, 1.0f});
            PlaneNormal    = Normalise(Base + Vec3{Rng.NextSigned(), Rng.NextSigned(), Rng.NextSigned()} * 0.18f);
        }
        else
        {
            // Concrete / Granite / ABS: isotropic Voronoi-like stochastic cleavage planes!
            const Vec3 RandVec{Rng.NextSigned(), Rng.NextSigned(), Rng.NextSigned()};
            PlaneNormal = (Length(RandVec) > 1.0e-4f) ? Normalise(RandVec) : Vec3{1.0f, 0.0f, 0.0f};
            PlaneOrigin = BestCent + Vec3{Rng.NextSigned(), Rng.NextSigned(), Rng.NextSigned()} * (0.08f * Length(HalfExtents));
        }

        InternalConvexPolyhedron HalfA{}, HalfB{};
        double                   CutArea = 0.0;
        if (BisectConvexPolyhedron(Pieces[BestIdx], PlaneOrigin, PlaneNormal, HalfA, HalfB, CutArea))
        {
            // Enforce Griffith energy limit after at least 1 primary cleavage if impact exceeded threshold!
            if (Pieces.size() >= 2u && (AccumulatedCutAreaM2 + CutArea) > MaxCutAreaBudget * 1.15)
            {
                break;
            }
            AccumulatedCutAreaM2 += CutArea;
            Pieces[BestIdx] = std::move(HalfA);
            Pieces.push_back(std::move(HalfB));
        }
    }

    // Materialize fragments, compute impulse ejection vs anchored structural retention, and build adjacency bonds!
    const float ShockRadius = std::max(
        0.35f,
        Length(HalfExtents) * static_cast<float>(std::clamp(std::sqrt(AvailableEnergyJ / 1800.0), 0.30, 2.50)));

    double TotalMassDetached = 0.0;
    OutFragments.reserve(Pieces.size());

    for (size_t K = 0u; K < Pieces.size(); ++K)
    {
        ConvexSolidFragment Frag = MaterializeFragmentFromPolyhedron(
            Pieces[K],
            static_cast<uint32_t>(K),
            Material.DensityKgM3);

        const float DistToHit = Length(Frag.CentroidWorld - Impact.ImpactPointWorld);
        const bool  NearBase  = Impact.AnchoredBaseAtMinZ && (Frag.CentroidWorld.Z < BMin.Z + 0.28f * (BMax.Z - BMin.Z));

        if (NearBase && DistToHit > ShockRadius * 0.65f)
        {
            Frag.AnchoredIntact = true;
            ++Summary.AnchoredFragmentCount;
        }
        else
        {
            Frag.AnchoredIntact = false;
            TotalMassDetached += Frag.MassKilograms;
            ++Summary.DetachedFragmentCount;
        }

        Summary.SumFragmentVolumeM3 += Frag.VolumeCubicMetres;
        OutFragments.push_back(std::move(Frag));
    }

    // Distribute momentum impulse physically across detached fragments weighted by proximity to ImpactPointWorld!
    const float InvDetachedMass = (TotalMassDetached > 1.0e-3) ? static_cast<float>(1.0 / TotalMassDetached) : 0.0f;
    for (auto& Frag : OutFragments)
    {
        if (Frag.AnchoredIntact)
        {
            continue;
        }
        const Vec3  Radial    = Frag.CentroidWorld - Impact.ImpactPointWorld;
        const float Dist      = std::max(0.08f, Length(Radial));
        const Vec3  OutDir    = Normalise(ImpactDir * 0.68f + Radial * (0.32f / Dist));
        const float Falloff   = 1.0f / (1.0f + 0.65f * Dist);
        const float BaseSpeed = std::min(28.0f, Impact.ImpulseNewtonSeconds * InvDetachedMass * (0.6f + 0.8f * Falloff));
        Frag.LinearVelocityMps  = OutDir * BaseSpeed;
        Frag.AngularVelocityRad = Cross(Radial, OutDir) * (2.4f / Dist);
    }

    // Build internal FragmentAdjacencyBond records between nearby fragment pairs!
    for (size_t I = 0u; I < OutFragments.size(); ++I)
    {
        for (size_t J = I + 1u; J < OutFragments.size(); ++J)
        {
            const float Dist = Length(OutFragments[I].CentroidWorld - OutFragments[J].CentroidWorld);
            const float RefR = std::cbrt(OutFragments[I].VolumeCubicMetres) + std::cbrt(OutFragments[J].VolumeCubicMetres);
            if (Dist < RefR * 1.15f)
            {
                FragmentAdjacencyBond Bond{};
                Bond.FragmentA         = static_cast<uint32_t>(I);
                Bond.FragmentB         = static_cast<uint32_t>(J);
                Bond.ContactAreaM2     = 0.35f * RefR * RefR;
                Bond.TensileStrengthPa = Material.FractureToughnessJm2 * 2200.0f;
                Bond.SeveredByImpact   = !(OutFragments[I].AnchoredIntact && OutFragments[J].AnchoredIntact);
                OutAdjacencyBonds.push_back(Bond);
            }
        }
    }

    Summary.FractureOccurred        = (OutFragments.size() > 1u);
    Summary.VolumeConservationRatio = (Summary.IntactVolumeM3 > 1.0e-9)
                                          ? (Summary.SumFragmentVolumeM3 / Summary.IntactVolumeM3)
                                          : 1.0;
    Summary.CreatedCutSurfaceAreaM2 = AccumulatedCutAreaM2;
    Summary.ConsumedFractureEnergyJ = AccumulatedCutAreaM2 * TwoGamma;
    return Summary;
}

} // namespace Frontier
