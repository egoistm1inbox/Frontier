/*==========================================================================================================================================
                                                PHOTOMETRICCLUSTERVALIDATION.CPP
==========================================================================================================================================*/
// 🧩 Host CTest validation for FrontierAtmosphericOptics and FrontierPhotometricLights Engine libraries.

#include "Engine/Rendering/AtmosphereModel.h"
#include "Engine/Rendering/CelestialModel.h"
#include "Engine/Rendering/CloudField.h"
#include "Engine/Rendering/FogMedium.h"
#include "Engine/Rendering/LensFlareModel.h"
#include "Engine/Rendering/PathReplaySubmissionSequence.h"
#include "Engine/Rendering/PathReplayVulkan.h"
#include "Engine/Rendering/PhotometricLights.h"
#include "Engine/Rendering/SolarOpticsPayload.h"
#include "Engine/Rendering/WeatherEffects.h"

#include <cmath>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <random>
#include <sstream>
#include <stdexcept>
#include <vector>

namespace
{

void RequireCheck(bool Condition, const char* Message)
{
    if (!Condition)
    {
        throw std::runtime_error(Message);
    }
}

Frontier::SpatialVector UnitVector(Frontier::SpatialVector Input)
{
    const double Length = std::sqrt(Input.X * Input.X + Input.Y * Input.Y + Input.Z * Input.Z);
    return {Input.X / Length, Input.Y / Length, Input.Z / Length};
}

Frontier::CandelaDistribution BuildNarrowDownlightIes()
{
    // Type-C LM-63-2002 luminaire with 90-degree quadrant symmetry and zero candela above 60 degrees,
    // even though the declared vertical grid spans [0, 180] degrees (real-world architectural convention).
    std::ostringstream Stream;
    Stream << "IESNA:LM-63-2002\n"
           << "[TEST] NarrowPhotometricFixture\n"
           << "TILT=NONE\n"
           << "1 1200 1.0 7 3 1 2 0.1 0.1 0.0 1.0 1.0 24.0\n"
           << "0 15 30 45 60 90 180\n"
           << "0 45 90\n"
           // H = 0 deg
           << "1000 880 520 140 0 0 0\n"
           // H = 45 deg
           << "1000 820 430 95 0 0 0\n"
           // H = 90 deg (asymmetric automotive/street cutoff)
           << "1000 740 310 50 0 0 0\n";
    std::istringstream Input(Stream.str());
    return Frontier::CandelaDistribution::Read(Input);
}

void ValidateAtmosphericOpticsEngineTargets()
{
    using namespace Frontier;

    // 1. Atmosphere + Celestial ephemeris sanity.
    const AtmosphereParameters Atmosphere{};
    const SpatialVector        NoonSun   = UnitVector({0.25, 0.15, 0.95});
    const SpectrumRgb          ZenithSky = SingleScattering(
        Atmosphere, {0.0, 0.0, Atmosphere.GroundRadiusKm + 0.002}, {0.0, 0.0, 1.0}, NoonSun, {10.0, 10.0, 10.0});
    RequireCheck(ZenithSky.B > ZenithSky.R && ZenithSky.B > 0.0,
                 "Rayleigh zenith sky radiance must be positive and blue-dominant at noon");

    const double        JulianDay = JulianDate(2026, 10u, 29u, 10.0);
    const SolarPosition SolarPos  = SunPosition(JulianDay, -26.19, 28.32);
    const SpatialVector LocalSun  = SunDirectionLocal(SolarPos);
    const double        SunNorm   = std::sqrt(LocalSun.X * LocalSun.X + LocalSun.Y * LocalSun.Y + LocalSun.Z * LocalSun.Z);
    RequireCheck(std::abs(SunNorm - 1.0) < 1e-9 && LocalSun.Z > 0.2,
                 "Celestial solar ephemeris must produce a unit upward daytime vector");

    // 2. CloudField closed-form Beer-Lambert agreement under UniformDensityOverride + stochastic FBM coverage.
    CloudParameters UniformSlab{};
    UniformSlab.BaseHeightM            = 500.0;
    UniformSlab.TopHeightM             = 1000.0;
    UniformSlab.ExtinctionPerM         = 0.002;
    UniformSlab.UniformDensityOverride = 1.0;
    const CloudMarchResult VerticalMarch = MarchClouds(
        UniformSlab, {0.0, 0.0, 0.0}, {0.0, 0.0, 1.0}, NoonSun, {10.0, 10.0, 10.0}, 5000.0, 64u, 6u);
    const double ExpectedTransmittance   = std::exp(-0.002 * 500.0);
    RequireCheck(std::abs(VerticalMarch.Transmittance - ExpectedTransmittance) < 2e-3 && VerticalMarch.Radiance.R > 0.0,
                 "Uniform CloudField vertical march must match analytic Beer-Lambert transmittance");

    CloudParameters TexturedClouds{};
    TexturedClouds.Coverage = 0.60;
    const CloudMarchResult TexturedMarch = MarchClouds(
        TexturedClouds, {0.0, 0.0, 0.0}, UnitVector({0.3, 0.1, 0.95}), NoonSun, {8.0, 7.8, 7.5}, 12000.0, 48u, 6u);
    RequireCheck(TexturedMarch.Transmittance > 0.0 && TexturedMarch.Transmittance <= 1.0,
                 "Procedural FBM CloudField transmittance must stay bounded in (0, 1]");

    // 3. FogMedium exact exponential integral + single-scatter quadrature.
    FogParameters Fog{};
    Fog.DensityAtBase  = 0.025;
    Fog.BaseHeightM    = 2.0;
    Fog.FalloffHeightM = 12.0;
    const double HorizontalT = FogTransmittance(Fog, {0.0, 0.0, 1.0}, {1.0, 0.0, 0.0}, 40.0);
    RequireCheck(std::abs(HorizontalT - std::exp(-0.025 * 40.0)) < 1e-12,
                 "Below-base horizontal FogTransmittance must match closed-form exp(-rho * d)");
    const FogRadianceIntegral ScatteredFog = IntegrateFogRadiance(
        Fog, {0.0, 0.0, 1.0}, {1.0, 0.0, 0.0}, 40.0, 32u, 0.85,
        [](SpatialVector) { return SpectrumRgb{0.5, 0.6, 0.8}; });
    RequireCheck(std::abs(ScatteredFog.Transmittance - HorizontalT) < 1e-12 &&
                     std::abs(ScatteredFog.Radiance.G - (1.0 - HorizontalT) * 0.85 * 0.6) < 1e-6,
                 "Uniform-incident IntegrateFogRadiance must satisfy exact radiative transfer identity");

    // 4. SolarOpticsPayload + LensFlareModel starburst/ghost/halo evaluation.
    SolarOpticsParameters Optics{};
    Optics.SunDirection   = NoonSun;
    Optics.DiscIrradiance = {12.0, 11.5, 10.8};
    const std::vector<float> OpticsPayload = CompileSolarOpticsPayload(Optics);
    RequireCheck(OpticsPayload.size() == SolarOpticsPayloadFloats,
                 "SolarOpticsPayload size must equal 32 header floats + 1536 * 4 disc samples");
    double DiscWeightTotal = 0.0;
    for (std::uint32_t SampleIdx = 0u; SampleIdx < SolarSourceCount; ++SampleIdx)
    {
        DiscWeightTotal += OpticsPayload[SolarOpticsHeaderFloats + 4u * SampleIdx + 2u];
    }
    RequireCheck(std::abs(DiscWeightTotal - 1.0) < 1e-5,
                 "Limb-darkened solar visibility weights must normalize to unity");
    const SpectrumRgb FlareSample = EvaluateLensFlareRadiance(
        0.18, 0.05, 0.10, 0.05, Optics.DiscIrradiance, 1.0, Optics.Flare);
    RequireCheck(FlareSample.R > 0.0 && FlareSample.G > 0.0 && FlareSample.B > 0.0,
                 "LensFlareModel must produce positive starburst/glare irradiance near the projected solar disc");
}

void ValidateAnalyticTightConeClustering()
{
    using namespace Frontier;

    const CandelaDistribution NarrowIes = BuildNarrowDownlightIes();
    RequireCheck(NarrowIes.Loaded() && std::abs(NarrowIes.PeakCandela() - 1000.0) < 1e-9,
                 "Synthetic LM-63 Type-C narrow IES fixture failed to load");

    // Build a 64-luminaire multi-bay fixture: 24 Spot+IES, 16 Point+IES, 12 Narrow Spots, 4 Points, 8 Inactive.
    std::vector<AnalyticLuminaireSpecification> Luminaires;
    Luminaires.reserve(64u);
    std::mt19937_64 Generator(0x51A7E2026ULL);
    std::uniform_real_distribution<double> CoordX(-14.0, 14.0);
    std::uniform_real_distribution<double> CoordY(-14.0, 14.0);
    std::uniform_real_distribution<double> CoordZ(2.5, 7.5);

    for (std::uint32_t Index = 0u; Index < 64u; ++Index)
    {
        AnalyticLuminaireSpecification Spec{};
        Spec.Position      = {CoordX(Generator), CoordY(Generator), CoordZ(Generator)};
        Spec.ReachRadiusM  = 11.0;
        Spec.IntensityRgb  = {45.0, 42.0, 38.0};
        Spec.ForwardAxis   = UnitVector({0.15 * std::sin(double(Index)), -0.15 * std::cos(double(Index)), -1.0});
        Spec.UpAxis        = {0.0, 1.0, 0.0};
        Spec.ActiveEnabled = (Index < 56u);
        if (Index < 24u)
        {
            Spec.Category        = AnalyticLuminaireCategory::Spot;
            Spec.InnerConeCosine = std::cos(22.0 * 3.14159265358979323846 / 180.0);
            Spec.OuterConeCosine = std::cos(32.0 * 3.14159265358979323846 / 180.0);
            Spec.Photometry      = NarrowIes;
        }
        else if (Index < 40u)
        {
            Spec.Category   = AnalyticLuminaireCategory::Point;
            Spec.Photometry = NarrowIes;
        }
        else if (Index < 52u)
        {
            Spec.Category        = AnalyticLuminaireCategory::Spot;
            Spec.InnerConeCosine = std::cos(18.0 * 3.14159265358979323846 / 180.0);
            Spec.OuterConeCosine = std::cos(26.0 * 3.14159265358979323846 / 180.0);
        }
        else
        {
            Spec.Category = AnalyticLuminaireCategory::Point;
        }
        Luminaires.push_back(Spec);
    }

    PhotometricClusterSpecification LegacySpec{};
    LegacySpec.MinimumBoundary      = {-16.0, -16.0, 0.0};
    LegacySpec.MaximumBoundary      = {16.0, 16.0, 8.0};
    LegacySpec.GridResolution       = {8u, 8u, 4u};
    LegacySpec.AnalyticCellCapacity = 64u;
    LegacySpec.CullingMode          = ClusterCullingMode::SphereReach;

    PhotometricClusterSpecification TightSpec = LegacySpec;
    TightSpec.CullingMode                     = ClusterCullingMode::TightPolarCone;

    PhotometricLights LegacyDivision;
    PhotometricLights TightDivision;
    LegacyDivision.Partition(Luminaires, LegacySpec);
    TightDivision.Partition(Luminaires, TightSpec);

    RequireCheck(TightDivision.OverflowCellTotal() == 0u,
                 "Tight polar-cone clustering must have zero cell overflows at capacity 64");
    RequireCheck(TightDivision.TotalCellAssignments() * 2u < LegacyDivision.TotalCellAssignments(),
                 "Tight polar-cone + active culling must cut 3D cell assignments by more than 2x");

    // Prove ZERO false negatives across 4,000 random interior query points against exhaustive evaluation.
    std::uniform_real_distribution<double> ProbeX(-15.9, 15.9);
    std::uniform_real_distribution<double> ProbeY(-15.9, 15.9);
    std::uniform_real_distribution<double> ProbeZ(0.05, 7.95);
    std::uint64_t ExhaustiveVisits = 0u;
    std::uint64_t LegacyVisits     = 0u;
    std::uint64_t TightVisits      = 0u;
    for (std::uint32_t Probe = 0u; Probe < 4000u; ++Probe)
    {
        const SpatialVector Point{ProbeX(Generator), ProbeY(Generator), ProbeZ(Generator)};
        std::array<double, 3> ExhaustiveSum{0.0, 0.0, 0.0};
        for (std::size_t Idx = 0u; Idx < Luminaires.size(); ++Idx)
        {
            SpatialVector Dir{};
            double        Dist = 0.0;
            const auto    Rgb  = EvaluateAnalyticLuminaireArrival(Luminaires[Idx], Point, Dir, Dist);
            ExhaustiveSum[0] += Rgb[0];
            ExhaustiveSum[1] += Rgb[1];
            ExhaustiveSum[2] += Rgb[2];
        }
        ExhaustiveVisits += Luminaires.size();

        bool Fallback = false;
        const auto& LegacyList = LegacyDivision.RetrieveCandidates(Point, &Fallback);
        LegacyVisits += LegacyList.size();

        const auto& TightList = TightDivision.RetrieveCandidates(Point, &Fallback);
        RequireCheck(!Fallback, "Interior probe unexpectedly triggered cluster fallback");
        TightVisits += TightList.size();

        std::array<double, 3> TightSum{0.0, 0.0, 0.0};
        for (std::uint32_t Idx : TightList)
        {
            SpatialVector Dir{};
            double        Dist = 0.0;
            const auto    Rgb  = EvaluateAnalyticLuminaireArrival(Luminaires[Idx], Point, Dir, Dist);
            TightSum[0] += Rgb[0];
            TightSum[1] += Rgb[1];
            TightSum[2] += Rgb[2];
        }

        const double MaxDelta = std::max({
            std::abs(ExhaustiveSum[0] - TightSum[0]),
            std::abs(ExhaustiveSum[1] - TightSum[1]),
            std::abs(ExhaustiveSum[2] - TightSum[2])
        });
        RequireCheck(MaxDelta <= 1e-12,
                     "Tight polar-cone clustering produced a false negative vs exhaustive illumination");
    }
    RequireCheck(TightVisits * 4u < ExhaustiveVisits && TightVisits * 2u < LegacyVisits,
                 "Tight polar-cone candidate visits must beat both exhaustive (>4x) and sphere-box (>2x)");
}

void ValidateClusteredEmissiveIesAndContracts()
{
    using namespace Frontier;

    const CandelaDistribution NarrowIes = BuildNarrowDownlightIes();

    // 48 emissive facets across 6 bays (-15..+15 m); half are Emissive-IES downlights, half diffuse panels.
    std::vector<PathReplayFacet>        Facets(48u);
    std::vector<RadiantFacetPhotometry> PhotometryEntries;
    for (std::uint32_t Index = 0u; Index < 48u; ++Index)
    {
        const float BayX = -13.5f + 5.4f * float(Index % 6u);
        const float BayY = -10.5f + 3.0f * float(Index / 6u);
        const float TopZ = 5.6f;
        PathReplayFacet Facet{};
        Facet.A        = {BayX - 0.20f, BayY - 0.20f, TopZ, 1.0f};
        Facet.B        = {BayX + 0.20f, BayY - 0.20f, TopZ, 1.0f};
        Facet.C        = {BayX + 0.20f, BayY + 0.20f, TopZ, 1.0f};
        Facet.NormalA  = {0.0f, 0.0f, -1.0f, 0.0f};
        Facet.NormalB  = {0.0f, 0.0f, -1.0f, 0.0f};
        Facet.NormalC  = {0.0f, 0.0f, -1.0f, 0.0f};
        Facet.Emissive = {32.0f, 30.0f, 26.0f, 0.0f};
        Facets[Index]  = Facet;

        if ((Index % 2u) == 0u)
        {
            RadiantFacetPhotometry Entry{};
            Entry.FacetIndex      = Index;
            Entry.ForwardAxis     = {0.0, 0.0, -1.0};
            Entry.UpAxis          = {0.0, 1.0, 0.0};
            Entry.Photometry      = NarrowIes;
            Entry.TwoSidedEnabled = false;
            PhotometryEntries.push_back(Entry);
        }
    }

    PhotometricClusterSpecification ClusterSpec{};
    ClusterSpec.MinimumBoundary        = {-16.0, -16.0, 0.0};
    ClusterSpec.MaximumBoundary        = {16.0, 16.0, 6.0};
    ClusterSpec.GridResolution         = {6u, 6u, 3u};
    ClusterSpec.RadiantSlotsPerCell    = 6u;
    ClusterSpec.GlobalMixtureFraction  = 0.15;
    ClusterSpec.AnalyticChannelEnabled = false;

    std::vector<float>       AngleAtlas(68u, 0.0f);
    CompiledPhotometricAtlas Compiled = CompilePhotometricClusterAtlas(
        {}, Facets, PhotometryEntries, ClusterSpec, AngleAtlas);
    ValidatePhotometricClusterAtlas(AngleAtlas, Compiled.PhotometricHeaderOffset, Facets.size(), 0u);

    // Verify O(1) Vose alias table in cell 0 reproduces exact local PMF across 65,536 stratified draws.
    {
        const std::size_t   SlotsPerCell = ClusterSpec.RadiantSlotsPerCell;
        const std::size_t   CellBase     = Compiled.ClusterFacetTableOffset;
        const std::size_t   LocalCount   = static_cast<std::size_t>(AngleAtlas[CellBase]);
        const std::size_t   AliasStart   = CellBase + 1u + 2u * SlotsPerCell;
        std::vector<double> AliasHits(Facets.size(), 0.0);
        constexpr std::uint32_t DrawsPerSlot = 4096u;
        for (std::size_t Slot = 0u; Slot < LocalCount; ++Slot)
        {
            const std::uint32_t Primary   = static_cast<std::uint32_t>(AngleAtlas[AliasStart + 3u * Slot + 0u]);
            const float         Threshold = AngleAtlas[AliasStart + 3u * Slot + 1u];
            const std::uint32_t Alias     = static_cast<std::uint32_t>(AngleAtlas[AliasStart + 3u * Slot + 2u]);
            for (std::uint32_t Step = 0u; Step < DrawsPerSlot; ++Step)
            {
                const float U = (float(Step) + 0.5f) / float(DrawsPerSlot);
                AliasHits[U < Threshold ? Primary : Alias] += 1.0 / double(LocalCount * DrawsPerSlot);
            }
        }
        for (std::size_t Slot = 0u; Slot < LocalCount; ++Slot)
        {
            const std::uint32_t FacetIdx  = static_cast<std::uint32_t>(AngleAtlas[CellBase + 1u + 2u * Slot]);
            const double        ExactProb = double(AngleAtlas[CellBase + 1u + 2u * Slot + 1u]);
            RequireCheck(std::abs(AliasHits[FacetIdx] - ExactProb) < 5e-4,
                         "Vose alias table frequencies must match compiled cell PMF within stratification step");
        }
    }

    // Verify exact PMF normalization and strictly positive support at interior and exterior points.
    const std::array<SpatialVector, 3> TestOrigins{{
        {-13.2, -10.2, 0.01},
        {2.5, 4.1, 1.20},
        {42.0, -30.0, 3.0}
    }};
    for (const SpatialVector& Origin : TestOrigins)
    {
        double ProbabilitySum = 0.0;
        for (std::uint32_t FacetIdx = 0u; FacetIdx < Facets.size(); ++FacetIdx)
        {
            const double Prob = EvaluateClusteredFacetSelectionProbability(
                AngleAtlas, Compiled.PhotometricHeaderOffset, Compiled.GlobalFacetOffset,
                Origin, FacetIdx, true);
            RequireCheck(Prob > 1e-4, "Defensive global mixture must keep every luminous facet strictly reachable");
            ProbabilitySum += Prob;
        }
        RequireCheck(std::abs(ProbabilitySum - 1.0) < 1e-5,
                     "Clustered radiant facet selection PMF must sum to 1.0 everywhere");
    }

    // Monte Carlo variance comparison at floor receiver under Bay 0 (-13.5, -10.5, 0):
    // Global Power CDF vs Clustered Spatial-Photometric CDF at 1 sample/trial over 4,096 trials.
    const SpatialVector FloorReceiver{-13.4, -10.3, 0.0};
    double ExactIrradiance = 0.0;
    for (std::uint32_t FacetIdx = 0u; FacetIdx < Facets.size(); ++FacetIdx)
    {
        const PathReplayFacet& F = Facets[FacetIdx];
        // 8x8 barycentric quadrature per triangle.
        const SpatialVector CornerA{F.A[0], F.A[1], F.A[2]};
        const SpatialVector CornerB{F.B[0], F.B[1], F.B[2]};
        const SpatialVector CornerC{F.C[0], F.C[1], F.C[2]};
        const double        Area   = 0.5 * 0.40 * 0.40;
        const double        Lum    = 0.2126 * F.Emissive[0] + 0.7152 * F.Emissive[1] + 0.0722 * F.Emissive[2];
        double              SubSum = 0.0;
        for (std::uint32_t UIdx = 0u; UIdx < 8u; ++UIdx)
        {
            for (std::uint32_t VIdx = 0u; VIdx < 8u; ++VIdx)
            {
                const double Root  = std::sqrt((UIdx + 0.5) / 8.0);
                const double Along = (VIdx + 0.5) / 8.0;
                const SpatialVector Pt{
                    CornerA.X * (1.0 - Root) + CornerB.X * (Root * (1.0 - Along)) + CornerC.X * (Root * Along),
                    CornerA.Y * (1.0 - Root) + CornerB.Y * (Root * (1.0 - Along)) + CornerC.Y * (Root * Along),
                    CornerA.Z
                };
                const SpatialVector Delta{Pt.X - FloorReceiver.X, Pt.Y - FloorReceiver.Y, Pt.Z - FloorReceiver.Z};
                const double        DistSq = Delta.X * Delta.X + Delta.Y * Delta.Y + Delta.Z * Delta.Z;
                const double        Dist   = std::sqrt(DistSq);
                const double        Cosine = Delta.Z / Dist;
                double              Photo  = 1.0;
                if ((FacetIdx % 2u) == 0u)
                {
                    Photo = EvaluateRadiantFacetPhotometricFactor(
                        PhotometryEntries[FacetIdx / 2u], {-Delta.X / Dist, -Delta.Y / Dist, -Delta.Z / Dist});
                }
                SubSum += (Lum * Photo * Cosine * Cosine * Area / DistSq) / 3.14159265358979323846;
            }
        }
        ExactIrradiance += SubSum / 64.0;
    }

    std::vector<double> GlobalProbs(Facets.size(), 1.0 / double(Facets.size()));
    std::vector<double> ClusterProbs(Facets.size(), 0.0);
    for (std::uint32_t FacetIdx = 0u; FacetIdx < Facets.size(); ++FacetIdx)
    {
        ClusterProbs[FacetIdx] = EvaluateClusteredFacetSelectionProbability(
            AngleAtlas, Compiled.PhotometricHeaderOffset, Compiled.GlobalFacetOffset,
            FloorReceiver, FacetIdx, false);
    }

    auto MeasureOneSampleRmse = [&](const std::vector<double>& Probs, double& OutMean) -> double
    {
        std::discrete_distribution<std::uint32_t> Discrete(Probs.begin(), Probs.end());
        std::mt19937_64                           Rng(0xC1057E2ULL);
        std::uniform_real_distribution<double>    Unit(0.0, 1.0);
        double Sum   = 0.0;
        double SqErr = 0.0;
        constexpr std::uint32_t Samples = 4096u;
        for (std::uint32_t S = 0u; S < Samples; ++S)
        {
            const std::uint32_t    Idx = Discrete(Rng);
            const PathReplayFacet& F   = Facets[Idx];
            const double           Root  = std::sqrt(Unit(Rng));
            const double           Along = Unit(Rng);
            const SpatialVector    Pt{
                F.A[0] * (1.0 - Root) + F.B[0] * (Root * (1.0 - Along)) + F.C[0] * (Root * Along),
                F.A[1] * (1.0 - Root) + F.B[1] * (Root * (1.0 - Along)) + F.C[1] * (Root * Along),
                F.A[2]
            };
            const SpatialVector Delta{Pt.X - FloorReceiver.X, Pt.Y - FloorReceiver.Y, Pt.Z - FloorReceiver.Z};
            const double        DistSq = Delta.X * Delta.X + Delta.Y * Delta.Y + Delta.Z * Delta.Z;
            const double        Dist   = std::sqrt(DistSq);
            const double        Cosine = Delta.Z / Dist;
            const double        Area   = 0.5 * 0.40 * 0.40;
            const double        Lum    = 0.2126 * F.Emissive[0] + 0.7152 * F.Emissive[1] + 0.0722 * F.Emissive[2];
            double              Photo  = 1.0;
            if ((Idx % 2u) == 0u)
            {
                Photo = EvaluateRadiantFacetPhotometricFactor(
                    PhotometryEntries[Idx / 2u], {-Delta.X / Dist, -Delta.Y / Dist, -Delta.Z / Dist});
            }
            const double Estimate =
                ((Lum * Photo * Cosine * Cosine * Area / DistSq) / 3.14159265358979323846) / Probs[Idx];
            Sum += Estimate;
            SqErr += (Estimate - ExactIrradiance) * (Estimate - ExactIrradiance);
        }
        OutMean = Sum / double(Samples);
        return std::sqrt(SqErr / double(Samples));
    };

    double GlobalMean  = 0.0;
    double ClusterMean = 0.0;
    const double GlobalRmse  = MeasureOneSampleRmse(GlobalProbs, GlobalMean);
    const double ClusterRmse = MeasureOneSampleRmse(ClusterProbs, ClusterMean);
    RequireCheck(std::abs(ClusterMean - ExactIrradiance) < 3.5 * (ClusterRmse / std::sqrt(4096.0)),
                 "Clustered Emissive-IES importance estimator failed unbiasedness mean gate");
    RequireCheck(ClusterRmse * 2.5 < GlobalRmse,
                 "Clustered Spatial-Photometric CDF must reduce 1-spp RMSE by >2.5x vs Global Power CDF");

    // Verify PathReplayVulkan RecordPathReplay photometric offset validation contract.
    PathReplayVulkanAccess Access{};
    Access.PipelineLayout       = reinterpret_cast<VkPipelineLayout>(1);
    Access.Descriptors          = reinterpret_cast<VkDescriptorSet>(1);
    Access.Generate             = reinterpret_cast<VkPipeline>(1);
    Access.Resolve              = reinterpret_cast<VkPipeline>(1);
    Access.BindPipeline         = [](VkCommandBuffer, VkPipelineBindPoint, VkPipeline) {};
    Access.BindDescriptors      = [](VkCommandBuffer, VkPipelineBindPoint, VkPipelineLayout,
                                     std::uint32_t, std::uint32_t, const VkDescriptorSet*,
                                     std::uint32_t, const std::uint32_t*) {};
    Access.PushConstants        = [](VkCommandBuffer, VkPipelineLayout, VkShaderStageFlags,
                                     std::uint32_t, std::uint32_t, const void*) {};
    Access.Dispatch             = [](VkCommandBuffer, std::uint32_t, std::uint32_t, std::uint32_t) {};
    Access.PipelineBarrier      = [](VkCommandBuffer, VkPipelineStageFlags, VkPipelineStageFlags,
                                     VkDependencyFlags, std::uint32_t, const VkMemoryBarrier*,
                                     std::uint32_t, const VkBufferMemoryBarrier*,
                                     std::uint32_t, const VkImageMemoryBarrier*) {};
    Access.MaxGroupCountX       = 65535u;
    Access.MaxPushConstantBytes = 128u;

    PathReplayVulkanBuffers Buffers{};
    Buffers.ReceiverRecords     = 64u;
    Buffers.FacetRecords        = Facets.size();
    Buffers.EnclosureRecords    = 1u;
    Buffers.AngleFloats         = AngleAtlas.size();
    Buffers.OutputColourRecords = PathReplayRequiredCompactOutputRecords(64u, false, false, false);
    Buffers.CounterWords        = PathReplayCounterWords;

    LightComputeFootprint Extent{};
    Extent.Dimensions     = {64u, 0u, 0u, 0u};
    Extent.Minimum        = {0.0f, 0.0f, 0.0f, 0.0f};
    Extent.Maximum        = {0.001f, 0.0f, 0.0f, 0.0f};
    Extent.Grid           = {0u, 0u, 0u, 1u};
    Extent.Sampling       = {1u, 1u, static_cast<std::uint32_t>(Facets.size()), 16u};
    Extent.History        = {8u, 8u, 0u, 1u};
    Extent.Reconstruction = {1u, 1u, static_cast<std::uint32_t>(Facets.size()), 16u};
    Extent.Primary        = {0u, 0u, 2u,
                             PathReplaySampleFacets | PathReplayPowerWeightedFacets |
                                 PathReplayBalanceSampling | PathReplayPowerMis |
                                 PathReplayCompactStorage | PathReplayPhotometricClusters};
    std::memcpy(&Extent.Maximum[1], &Compiled.GlobalFacetOffset, sizeof(std::uint32_t));
    const std::uint32_t EncodedHeader = Compiled.PhotometricHeaderOffset + 1u;
    std::memcpy(&Extent.Maximum[2], &EncodedHeader, sizeof(std::uint32_t));

    RecordPathReplay(reinterpret_cast<VkCommandBuffer>(1), Access, Buffers, Extent);

    // Missing PhotometricOffset when flag is set must throw.
    bool CaughtZeroOffset = false;
    try
    {
        LightComputeFootprint Invalid = Extent;
        Invalid.Maximum[2]            = 0.0f;
        RecordPathReplay(reinterpret_cast<VkCommandBuffer>(1), Access, Buffers, Invalid);
    }
    catch (const std::invalid_argument&)
    {
        CaughtZeroOffset = true;
    }
    RequireCheck(CaughtZeroOffset, "RecordPathReplay must reject PathReplayPhotometricClusters with zero offset");

    // Undersized AngleFloats for PhotometricHeader must throw.
    bool CaughtShortAtlas = false;
    try
    {
        PathReplayVulkanBuffers ShortBuffers = Buffers;
        ShortBuffers.AngleFloats             = Compiled.PhotometricHeaderOffset + 8u;
        RecordPathReplay(reinterpret_cast<VkCommandBuffer>(1), Access, ShortBuffers, Extent);
    }
    catch (const std::invalid_argument&)
    {
        CaughtShortAtlas = true;
    }
    RequireCheck(CaughtShortAtlas, "RecordPathReplay must reject truncated PhotometricHeader AngleFloats");
}

} // namespace

int main()
{
    try
    {
        ValidateAtmosphericOpticsEngineTargets();
        ValidateAnalyticTightConeClustering();
        ValidateClusteredEmissiveIesAndContracts();
        std::cout << "PhotometricClusterValidation: PASS\n";
        return 0;
    }
    catch (const std::exception& Error)
    {
        std::cerr << "PhotometricClusterValidation FAILED: " << Error.what() << "\n";
        return 1;
    }
}
