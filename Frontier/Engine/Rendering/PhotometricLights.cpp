/*==========================================================================================================================================
                                                PHOTOMETRICCLUSTEREXTENSION.CPP
==========================================================================================================================================*/
// 🧩 Conservative cone-sphere-box analytic luminaire clustering and O(1) alias-accelerated radiant facet importance grids.

#include "PhotometricLights.h"
#include "RadiantFacetDistribution.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <numeric>
#include <stdexcept>
#include <unordered_map>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    INTERNAL GEOMETRY
//------------------------------------------------------------------------------------------------------------------------

namespace
{

constexpr double PiConstant = 3.14159265358979323846;

double ExtractCoordinate(SpatialVector VectorPoint, std::uint32_t AxisIndex) noexcept
{
    return AxisIndex == 0u ? VectorPoint.X : (AxisIndex == 1u ? VectorPoint.Y : VectorPoint.Z);
}

double DotProduct(SpatialVector Left, SpatialVector Right) noexcept
{
    return Left.X * Right.X + Left.Y * Right.Y + Left.Z * Right.Z;
}

SpatialVector CrossProduct(SpatialVector Left, SpatialVector Right) noexcept
{
    return {
        Left.Y * Right.Z - Left.Z * Right.Y,
        Left.Z * Right.X - Left.X * Right.Z,
        Left.X * Right.Y - Left.Y * Right.X
    };
}

double VectorLength(SpatialVector VectorInput) noexcept
{
    return std::sqrt(DotProduct(VectorInput, VectorInput));
}

SpatialVector NormalizeOrFallback(SpatialVector VectorInput, SpatialVector FallbackUnit) noexcept
{
    const double LengthSquared = DotProduct(VectorInput, VectorInput);
    if (!(LengthSquared > 1e-24) || !std::isfinite(LengthSquared))
    {
        return FallbackUnit;
    }
    const double InverseLength = 1.0 / std::sqrt(LengthSquared);
    return {VectorInput.X * InverseLength, VectorInput.Y * InverseLength, VectorInput.Z * InverseLength};
}

void ConstructLuminaireBasis(SpatialVector ForwardInput, SpatialVector UpInput,
                             SpatialVector& OutForward, SpatialVector& OutRight, SpatialVector& OutUp) noexcept
{
    OutForward              = NormalizeOrFallback(ForwardInput, {0.0, 0.0, -1.0});
    SpatialVector Candidate = CrossProduct(UpInput, OutForward);
    if (DotProduct(Candidate, Candidate) <= 1e-16)
    {
        const SpatialVector AlternateUp = std::abs(OutForward.Z) < 0.9 ? SpatialVector{0.0, 0.0, 1.0}
                                                                       : SpatialVector{0.0, 1.0, 0.0};
        Candidate                       = CrossProduct(AlternateUp, OutForward);
    }
    OutRight = NormalizeOrFallback(Candidate, {1.0, 0.0, 0.0});
    OutUp    = CrossProduct(OutForward, OutRight);
}

double ExtractCandelaPolarCosineBound(const CandelaDistribution& Photometry)
{
    if (!Photometry.Loaded())
    {
        return -1.0;
    }
    const std::vector<double>& VerticalAngles   = Photometry.VerticalAngles();
    const std::vector<double>& HorizontalAngles = Photometry.HorizontalAngles();
    const std::vector<double>& CandelaSamples   = Photometry.CandelaSamples();
    if (VerticalAngles.empty() || HorizontalAngles.empty())
    {
        return -1.0;
    }

    std::size_t HighestPositiveVertical = 0u;
    bool        PositiveFound           = false;
    for (std::size_t HorizontalIndex = 0u; HorizontalIndex < HorizontalAngles.size(); ++HorizontalIndex)
    {
        for (std::size_t VerticalIndex = 0u; VerticalIndex < VerticalAngles.size(); ++VerticalIndex)
        {
            if (CandelaSamples[HorizontalIndex * VerticalAngles.size() + VerticalIndex] > 0.0)
            {
                HighestPositiveVertical = std::max(HighestPositiveVertical, VerticalIndex);
                PositiveFound           = true;
            }
        }
    }
    if (!PositiveFound)
    {
        return 1.0;
    }
    const std::size_t SupportLimitIndex = std::min(HighestPositiveVertical + 1u, VerticalAngles.size() - 1u);
    const double      LimitDegrees      = std::clamp(VerticalAngles[SupportLimitIndex], 0.0, 180.0);
    if (LimitDegrees >= 180.0 - 1e-7)
    {
        return -1.0;
    }
    return std::cos(LimitDegrees * (PiConstant / 180.0));
}

std::uint64_t HashCandelaDistribution(const CandelaDistribution& Photometry) noexcept
{
    std::uint64_t HashBits = 14695981039346656037ULL;
    auto MixDouble = [&](double Quantity)
    {
        std::uint64_t Word = 0u;
        std::memcpy(&Word, &Quantity, sizeof(Word));
        HashBits ^= Word;
        HashBits *= 1099511628211ULL;
    };
    MixDouble(Photometry.PeakCandela());
    for (double AngleDeg : Photometry.VerticalAngles())
    {
        MixDouble(AngleDeg);
    }
    for (double AngleDeg : Photometry.HorizontalAngles())
    {
        MixDouble(AngleDeg);
    }
    for (double SampleValue : Photometry.CandelaSamples())
    {
        MixDouble(SampleValue);
    }
    return HashBits;
}

std::uint32_t ObtainUniformCandelaGrid(const CandelaDistribution&                   Photometry,
                                       std::unordered_map<std::uint64_t, uint32_t>& GridCache,
                                       std::vector<float>&                          AngleAtlas)
{
    const std::uint64_t Signature = HashCandelaDistribution(Photometry);
    const auto          Found     = GridCache.find(Signature);
    if (Found != GridCache.end())
    {
        return Found->second;
    }

    const std::uint32_t GridOffset = static_cast<std::uint32_t>(AngleAtlas.size());
    AngleAtlas.reserve(AngleAtlas.size() +
                       std::size_t(PhotometricUniformThetaSamples) * PhotometricUniformPhiSamples);
    for (std::uint32_t PhiIndex = 0u; PhiIndex < PhotometricUniformPhiSamples; ++PhiIndex)
    {
        const double PhiDegrees = double(PhiIndex) * 5.0;
        for (std::uint32_t ThetaIndex = 0u; ThetaIndex < PhotometricUniformThetaSamples; ++ThetaIndex)
        {
            const double ThetaDegrees = double(ThetaIndex);
            AngleAtlas.push_back(static_cast<float>(Photometry.Relative(ThetaDegrees, PhiDegrees)));
        }
    }
    GridCache.emplace(Signature, GridOffset);
    return GridOffset;
}

std::array<std::uint32_t, 5> AppendLegacyCandelaTablesWithGridLink(const CandelaDistribution& Photometry,
                                                                   std::uint32_t              UniformGridOffset,
                                                                   std::vector<float>&        AngleAtlas)
{
    const std::vector<double>& VerticalAngles   = Photometry.VerticalAngles();
    const std::vector<double>& HorizontalAngles = Photometry.HorizontalAngles();
    const std::vector<double>& CandelaSamples   = Photometry.CandelaSamples();

    // Prefix slot [VerticalOffset - 1] stores UniformGridOffset for O(1) loop-free replay evaluation.
    AngleAtlas.push_back(static_cast<float>(UniformGridOffset));
    const std::uint32_t VerticalOffset = static_cast<std::uint32_t>(AngleAtlas.size());
    for (double AngleDeg : VerticalAngles)
    {
        AngleAtlas.push_back(static_cast<float>(AngleDeg));
    }
    const std::uint32_t HorizontalOffset = static_cast<std::uint32_t>(AngleAtlas.size());
    for (double AngleDeg : HorizontalAngles)
    {
        AngleAtlas.push_back(static_cast<float>(AngleDeg));
    }
    const std::uint32_t CandelaOffset = static_cast<std::uint32_t>(AngleAtlas.size());
    for (double SampleCandela : CandelaSamples)
    {
        AngleAtlas.push_back(static_cast<float>(SampleCandela));
    }
    return {
        VerticalOffset,
        static_cast<std::uint32_t>(VerticalAngles.size()),
        HorizontalOffset,
        static_cast<std::uint32_t>(HorizontalAngles.size()),
        CandelaOffset
    };
}

double EvaluateFacetAreaAndCentroid(const PathReplayFacet& Facet, SpatialVector& OutCentroid,
                                    double& OutBoundingRadius) noexcept
{
    const SpatialVector CornerA{Facet.A[0], Facet.A[1], Facet.A[2]};
    const SpatialVector CornerB{Facet.B[0], Facet.B[1], Facet.B[2]};
    const SpatialVector CornerC{Facet.C[0], Facet.C[1], Facet.C[2]};
    OutCentroid = {
        (CornerA.X + CornerB.X + CornerC.X) / 3.0,
        (CornerA.Y + CornerB.Y + CornerC.Y) / 3.0,
        (CornerA.Z + CornerB.Z + CornerC.Z) / 3.0
    };
    const double RadiusA = VectorLength({CornerA.X - OutCentroid.X, CornerA.Y - OutCentroid.Y, CornerA.Z - OutCentroid.Z});
    const double RadiusB = VectorLength({CornerB.X - OutCentroid.X, CornerB.Y - OutCentroid.Y, CornerB.Z - OutCentroid.Z});
    const double RadiusC = VectorLength({CornerC.X - OutCentroid.X, CornerC.Y - OutCentroid.Y, CornerC.Z - OutCentroid.Z});
    OutBoundingRadius    = std::max({RadiusA, RadiusB, RadiusC});

    const SpatialVector EdgeA{CornerB.X - CornerA.X, CornerB.Y - CornerA.Y, CornerB.Z - CornerA.Z};
    const SpatialVector EdgeB{CornerC.X - CornerA.X, CornerC.Y - CornerA.Y, CornerC.Z - CornerA.Z};
    return 0.5 * VectorLength(CrossProduct(EdgeA, EdgeB));
}

void ValidateGridBounds(const PhotometricClusterSpecification& ClusterSpecification, std::size_t& OutCellCount)
{
    OutCellCount = 1u;
    if (ClusterSpecification.AnalyticCellCapacity == 0u || ClusterSpecification.AnalyticCellCapacity > 4096u)
    {
        throw std::invalid_argument("Analytic cluster cell capacity is outside [1, 4096]");
    }
    if (ClusterSpecification.RadiantSlotsPerCell > 16u)
    {
        throw std::invalid_argument("Radiant cluster slots per cell exceed loop-free limit of 16");
    }
    if (!std::isfinite(ClusterSpecification.GlobalMixtureFraction) ||
        ClusterSpecification.GlobalMixtureFraction <= 0.0 || ClusterSpecification.GlobalMixtureFraction > 1.0)
    {
        throw std::invalid_argument("Global mixture fraction must lie in (0, 1]");
    }
    for (std::uint32_t AxisIndex = 0u; AxisIndex < 3u; ++AxisIndex)
    {
        const std::uint32_t ExtentAxis = ClusterSpecification.GridResolution[AxisIndex];
        const double        LowCoord   = ExtractCoordinate(ClusterSpecification.MinimumBoundary, AxisIndex);
        const double        HighCoord  = ExtractCoordinate(ClusterSpecification.MaximumBoundary, AxisIndex);
        if (ExtentAxis == 0u || ExtentAxis > 256u || OutCellCount > 1048576u / ExtentAxis ||
            !std::isfinite(LowCoord) || !std::isfinite(HighCoord) ||
            !std::isfinite(HighCoord - LowCoord) || !(HighCoord > LowCoord))
        {
            throw std::invalid_argument("Photometric cluster grid bounds or resolution rejected");
        }
        OutCellCount *= ExtentAxis;
    }
}

void BuildVoseAliasTable(const std::vector<std::uint32_t>& FacetIndices,
                         const std::vector<float>&         Probabilities,
                         std::vector<float>&               OutThresholds,
                         std::vector<std::uint32_t>&       OutAliases)
{
    const std::size_t Count = FacetIndices.size();
    OutThresholds.assign(Count, 1.0f);
    OutAliases = FacetIndices;
    if (Count <= 1u)
    {
        return;
    }

    std::vector<double>        Scaled(Count, 0.0);
    std::vector<std::size_t>   Underfull;
    std::vector<std::size_t>   Overfull;
    Underfull.reserve(Count);
    Overfull.reserve(Count);

    for (std::size_t Slot = 0u; Slot < Count; ++Slot)
    {
        Scaled[Slot] = double(Probabilities[Slot]) * double(Count);
        if (Scaled[Slot] < 1.0)
        {
            Underfull.push_back(Slot);
        }
        else
        {
            Overfull.push_back(Slot);
        }
    }

    while (!Underfull.empty() && !Overfull.empty())
    {
        const std::size_t SmallSlot = Underfull.back();
        Underfull.pop_back();
        const std::size_t LargeSlot = Overfull.back();
        Overfull.pop_back();

        OutThresholds[SmallSlot] = static_cast<float>(std::clamp(Scaled[SmallSlot], 0.0, 1.0));
        OutAliases[SmallSlot]    = FacetIndices[LargeSlot];
        Scaled[LargeSlot]        = (Scaled[LargeSlot] + Scaled[SmallSlot]) - 1.0;
        if (Scaled[LargeSlot] < 1.0)
        {
            Underfull.push_back(LargeSlot);
        }
        else
        {
            Overfull.push_back(LargeSlot);
        }
    }
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                           POLAR CONE & PHOTOMETRIC BOUNDS
//------------------------------------------------------------------------------------------------------------------------

double ExtractActivePolarCosineBound(const AnalyticLuminaireSpecification& Specification)
{
    if (Specification.Category == AnalyticLuminaireCategory::Directional)
    {
        return -1.0;
    }
    double CosineBound = -1.0;
    if (Specification.Category == AnalyticLuminaireCategory::Spot)
    {
        CosineBound = std::max(CosineBound, std::clamp(Specification.OuterConeCosine, -1.0, 1.0));
    }
    if (Specification.Photometry.Loaded())
    {
        CosineBound = std::max(CosineBound, ExtractCandelaPolarCosineBound(Specification.Photometry));
    }
    return CosineBound;
}

bool EvaluatePolarConeBoxIntersection(SpatialVector ConeApex, double ReachRadiusM,
                                      SpatialVector UnitForwardAxis, double CosineThetaMax,
                                      SpatialVector BoxLow, SpatialVector BoxHigh) noexcept
{
    double SquaredBoxDistance = 0.0;
    for (std::uint32_t AxisIndex = 0u; AxisIndex < 3u; ++AxisIndex)
    {
        const double ApexCoord    = ExtractCoordinate(ConeApex, AxisIndex);
        const double ClampedCoord = std::clamp(ApexCoord,
                                               ExtractCoordinate(BoxLow, AxisIndex),
                                               ExtractCoordinate(BoxHigh, AxisIndex));
        const double Delta        = ApexCoord - ClampedCoord;
        SquaredBoxDistance += Delta * Delta;
    }

    if (ReachRadiusM > 0.0)
    {
        const double RadiusSquared = ReachRadiusM * ReachRadiusM;
        const double Tolerance     = 64.0 * std::numeric_limits<double>::epsilon() *
                                     std::max({1.0, SquaredBoxDistance, RadiusSquared});
        if (SquaredBoxDistance > RadiusSquared + Tolerance)
        {
            return false;
        }
    }

    if (SquaredBoxDistance <= 1e-18 || CosineThetaMax <= -1.0 + 1e-7)
    {
        return true;
    }

    const SpatialVector ForwardUnit = NormalizeOrFallback(UnitForwardAxis, {0.0, 0.0, -1.0});
    const double        ClampedCos  = std::clamp(CosineThetaMax, -1.0, 1.0);

    if (ClampedCos >= 0.0)
    {
        double MaximumForwardProjection = 0.0;
        for (std::uint32_t AxisIndex = 0u; AxisIndex < 3u; ++AxisIndex)
        {
            const double ApexCoord = ExtractCoordinate(ConeApex, AxisIndex);
            const double AxisDir   = ExtractCoordinate(ForwardUnit, AxisIndex);
            const double LowDelta  = (ExtractCoordinate(BoxLow, AxisIndex) - ApexCoord) * AxisDir;
            const double HighDelta = (ExtractCoordinate(BoxHigh, AxisIndex) - ApexCoord) * AxisDir;
            MaximumForwardProjection += std::max(LowDelta, HighDelta);
        }
        if (MaximumForwardProjection <= -1e-7)
        {
            return false;
        }
    }

    const SpatialVector BoxCentre{
        0.5 * (BoxLow.X + BoxHigh.X),
        0.5 * (BoxLow.Y + BoxHigh.Y),
        0.5 * (BoxLow.Z + BoxHigh.Z)
    };
    const SpatialVector BoxHalfExtent{
        0.5 * (BoxHigh.X - BoxLow.X),
        0.5 * (BoxHigh.Y - BoxLow.Y),
        0.5 * (BoxHigh.Z - BoxLow.Z)
    };
    const double        BoxRadius    = VectorLength(BoxHalfExtent);
    const SpatialVector CentreOffset = {BoxCentre.X - ConeApex.X, BoxCentre.Y - ConeApex.Y, BoxCentre.Z - ConeApex.Z};
    const double        CentreDist   = VectorLength(CentreOffset);
    if (CentreDist <= BoxRadius + 1e-9)
    {
        return true;
    }

    const double SineAlpha   = BoxRadius / CentreDist;
    const double CosineAlpha = std::sqrt(std::max(0.0, 1.0 - SineAlpha * SineAlpha));
    const double SineMax     = std::sqrt(std::max(0.0, 1.0 - ClampedCos * ClampedCos));
    if (ClampedCos < 0.0 && SineAlpha >= SineMax - 1e-9)
    {
        return true;
    }

    const double MinimumCosineSum = ClampedCos * CosineAlpha - SineMax * SineAlpha;
    const double ForwardDot       = DotProduct(CentreOffset, ForwardUnit);
    return ForwardDot >= CentreDist * MinimumCosineSum - 1e-7 * (CentreDist + BoxRadius);
}

//------------------------------------------------------------------------------------------------------------------------
//                                           ANALYTIC CLUSTER DIVISION METHODS
//------------------------------------------------------------------------------------------------------------------------

void PhotometricLights::Partition(const std::vector<AnalyticLuminaireSpecification>& AnalyticLuminaires,
                                           const PhotometricClusterSpecification&             ClusterSpecification)
{
    std::size_t CellCount = 0u;
    ValidateGridBounds(ClusterSpecification, CellCount);
    if (AnalyticLuminaires.size() > 32768u ||
        (!AnalyticLuminaires.empty() && CellCount > 16777216u / AnalyticLuminaires.size()))
    {
        throw std::invalid_argument("Analytic luminaire count exceeds cluster assignment budget");
    }

    std::vector<double>        PolarBounds(AnalyticLuminaires.size(), -1.0);
    std::vector<SpatialVector> UnitAxes(AnalyticLuminaires.size());
    std::vector<bool>          RadiantMask(AnalyticLuminaires.size(), false);
    for (std::size_t LuminaireIndex = 0u; LuminaireIndex < AnalyticLuminaires.size(); ++LuminaireIndex)
    {
        const AnalyticLuminaireSpecification& Source = AnalyticLuminaires[LuminaireIndex];
        if (!std::isfinite(Source.Position.X) || !std::isfinite(Source.Position.Y) || !std::isfinite(Source.Position.Z) ||
            !std::isfinite(Source.ReachRadiusM) || Source.ReachRadiusM < 0.0 ||
            !std::isfinite(Source.IntensityRgb[0]) || !std::isfinite(Source.IntensityRgb[1]) ||
            !std::isfinite(Source.IntensityRgb[2]) || Source.IntensityRgb[0] < 0.0 ||
            Source.IntensityRgb[1] < 0.0 || Source.IntensityRgb[2] < 0.0)
        {
            throw std::invalid_argument("Analytic luminaire specification contains invalid coordinates or intensity");
        }
        if (Source.Category == AnalyticLuminaireCategory::Spot &&
            (!std::isfinite(Source.InnerConeCosine) || !std::isfinite(Source.OuterConeCosine) ||
             Source.InnerConeCosine <= Source.OuterConeCosine || Source.OuterConeCosine < -1.0 ||
             Source.InnerConeCosine > 1.0))
        {
            throw std::invalid_argument("Spot luminaire cone cosines require -1 <= outer < inner <= 1");
        }
        SpatialVector ForwardUnit{}, RightUnit{}, UpUnit{};
        ConstructLuminaireBasis(Source.ForwardAxis, Source.UpAxis, ForwardUnit, RightUnit, UpUnit);
        UnitAxes[LuminaireIndex]    = ForwardUnit;
        PolarBounds[LuminaireIndex] = ExtractActivePolarCosineBound(Source);
        RadiantMask[LuminaireIndex] = Source.ActiveEnabled &&
            (Source.IntensityRgb[0] > 0.0 || Source.IntensityRgb[1] > 0.0 || Source.IntensityRgb[2] > 0.0) &&
            (Source.Photometry.Loaded() || !Source.Photometry.CandelaSamples().empty()
                 ? Source.Photometry.Loaded()
                 : true);
    }

    PhotometricLights Replacement;
    Replacement.MinimumBoundary_ = ClusterSpecification.MinimumBoundary;
    Replacement.MaximumBoundary_ = ClusterSpecification.MaximumBoundary;
    Replacement.GridResolution_  = ClusterSpecification.GridResolution;
    Replacement.Cells_.resize(CellCount);
    Replacement.CellOverflowed_.assign(CellCount, false);
    Replacement.ExhaustiveIndices_.resize(AnalyticLuminaires.size());
    std::iota(Replacement.ExhaustiveIndices_.begin(), Replacement.ExhaustiveIndices_.end(), 0u);

    const SpatialVector GridSpan{
        ClusterSpecification.MaximumBoundary.X - ClusterSpecification.MinimumBoundary.X,
        ClusterSpecification.MaximumBoundary.Y - ClusterSpecification.MinimumBoundary.Y,
        ClusterSpecification.MaximumBoundary.Z - ClusterSpecification.MinimumBoundary.Z
    };
    const SpatialVector CellStep{
        GridSpan.X / ClusterSpecification.GridResolution[0],
        GridSpan.Y / ClusterSpecification.GridResolution[1],
        GridSpan.Z / ClusterSpecification.GridResolution[2]
    };

    const bool TightCulling = (ClusterSpecification.CullingMode == ClusterCullingMode::TightPolarCone);
    for (std::uint32_t CellZ = 0u; CellZ < ClusterSpecification.GridResolution[2]; ++CellZ)
    {
        for (std::uint32_t CellY = 0u; CellY < ClusterSpecification.GridResolution[1]; ++CellY)
        {
            for (std::uint32_t CellX = 0u; CellX < ClusterSpecification.GridResolution[0]; ++CellX)
            {
                const std::size_t CellIndex =
                    (std::size_t(CellZ) * ClusterSpecification.GridResolution[1] + CellY) *
                        ClusterSpecification.GridResolution[0] +
                    CellX;
                const SpatialVector CellLow{
                    ClusterSpecification.MinimumBoundary.X + CellX * CellStep.X,
                    ClusterSpecification.MinimumBoundary.Y + CellY * CellStep.Y,
                    ClusterSpecification.MinimumBoundary.Z + CellZ * CellStep.Z
                };
                const SpatialVector CellHigh{
                    CellLow.X + CellStep.X,
                    CellLow.Y + CellStep.Y,
                    CellLow.Z + CellStep.Z
                };

                for (std::uint32_t LuminaireIndex = 0u; LuminaireIndex < AnalyticLuminaires.size(); ++LuminaireIndex)
                {
                    if (TightCulling && !RadiantMask[LuminaireIndex])
                    {
                        continue;
                    }
                    const AnalyticLuminaireSpecification& Source = AnalyticLuminaires[LuminaireIndex];
                    bool OverlapsCell = false;
                    if (Source.Category == AnalyticLuminaireCategory::Directional)
                    {
                        OverlapsCell = true;
                    }
                    else if (TightCulling)
                    {
                        OverlapsCell = EvaluatePolarConeBoxIntersection(
                            Source.Position, Source.ReachRadiusM, UnitAxes[LuminaireIndex],
                            PolarBounds[LuminaireIndex], CellLow, CellHigh);
                    }
                    else
                    {
                        OverlapsCell = EvaluatePolarConeBoxIntersection(
                            Source.Position, Source.ReachRadiusM, {0.0, 0.0, -1.0}, -1.0, CellLow, CellHigh);
                    }

                    if (OverlapsCell)
                    {
                        if (Replacement.Cells_[CellIndex].size() < ClusterSpecification.AnalyticCellCapacity)
                        {
                            Replacement.Cells_[CellIndex].push_back(LuminaireIndex);
                            ++Replacement.TotalAssignments_;
                        }
                        else
                        {
                            Replacement.CellOverflowed_[CellIndex] = true;
                        }
                    }
                }
                if (Replacement.CellOverflowed_[CellIndex])
                {
                    ++Replacement.OverflowCells_;
                }
            }
        }
    }
    *this = std::move(Replacement);
}

const std::vector<std::uint32_t>& PhotometricLights::RetrieveCandidates(SpatialVector QueryPoint,
                                                                                 bool* FallbackActivated) const
{
    if (FallbackActivated != nullptr)
    {
        *FallbackActivated = false;
    }
    if (Cells_.empty())
    {
        if (FallbackActivated != nullptr)
        {
            *FallbackActivated = true;
        }
        return ExhaustiveIndices_;
    }

    std::array<std::uint32_t, 3> Coordinates{};
    for (std::uint32_t AxisIndex = 0u; AxisIndex < 3u; ++AxisIndex)
    {
        const double Coord     = ExtractCoordinate(QueryPoint, AxisIndex);
        const double LowCoord  = ExtractCoordinate(MinimumBoundary_, AxisIndex);
        const double HighCoord = ExtractCoordinate(MaximumBoundary_, AxisIndex);
        if (!std::isfinite(Coord) || Coord < LowCoord || Coord >= HighCoord)
        {
            if (FallbackActivated != nullptr)
            {
                *FallbackActivated = true;
            }
            return ExhaustiveIndices_;
        }
        const double Normalized = (Coord - LowCoord) / (HighCoord - LowCoord) * GridResolution_[AxisIndex];
        Coordinates[AxisIndex]  = std::min(static_cast<std::uint32_t>(Normalized), GridResolution_[AxisIndex] - 1u);
    }

    const std::size_t CellIndex =
        (std::size_t(Coordinates[2]) * GridResolution_[1] + Coordinates[1]) * GridResolution_[0] + Coordinates[0];
    if (CellOverflowed_[CellIndex])
    {
        if (FallbackActivated != nullptr)
        {
            *FallbackActivated = true;
        }
        return ExhaustiveIndices_;
    }
    return Cells_[CellIndex];
}

//------------------------------------------------------------------------------------------------------------------------
//                                           PHOTOMETRIC REFERENCE EVALUATORS
//------------------------------------------------------------------------------------------------------------------------

std::array<double, 3> EvaluateAnalyticLuminaireArrival(const AnalyticLuminaireSpecification& Specification,
                                                       SpatialVector                         ReceiverPoint,
                                                       SpatialVector&                        OutDirectionTowardSource,
                                                       double&                               OutSourceDistanceM) noexcept
{
    OutDirectionTowardSource = Specification.Position;
    OutSourceDistanceM       = 1e30;
    if (!Specification.ActiveEnabled ||
        (Specification.IntensityRgb[0] <= 0.0 && Specification.IntensityRgb[1] <= 0.0 &&
         Specification.IntensityRgb[2] <= 0.0))
    {
        return {0.0, 0.0, 0.0};
    }

    if (Specification.Category == AnalyticLuminaireCategory::Directional)
    {
        OutDirectionTowardSource = NormalizeOrFallback(Specification.Position, {0.0, 0.0, 1.0});
        return Specification.IntensityRgb;
    }

    const SpatialVector Delta{
        Specification.Position.X - ReceiverPoint.X,
        Specification.Position.Y - ReceiverPoint.Y,
        Specification.Position.Z - ReceiverPoint.Z
    };
    OutSourceDistanceM       = VectorLength(Delta);
    OutDirectionTowardSource = OutSourceDistanceM > 0.0
        ? SpatialVector{Delta.X / OutSourceDistanceM, Delta.Y / OutSourceDistanceM, Delta.Z / OutSourceDistanceM}
        : SpatialVector{0.0, 0.0, 1.0};
    if (Specification.ReachRadiusM > 0.0 && OutSourceDistanceM >= Specification.ReachRadiusM)
    {
        return {0.0, 0.0, 0.0};
    }

    double AngularGain = 1.0;
    if (Specification.Category == AnalyticLuminaireCategory::Spot || Specification.Photometry.Loaded())
    {
        SpatialVector ForwardUnit{}, RightUnit{}, UpUnit{};
        ConstructLuminaireBasis(Specification.ForwardAxis, Specification.UpAxis, ForwardUnit, RightUnit, UpUnit);
        const SpatialVector TowardReceiver{
            -OutDirectionTowardSource.X,
            -OutDirectionTowardSource.Y,
            -OutDirectionTowardSource.Z
        };
        const double PolarCosine = std::clamp(DotProduct(ForwardUnit, TowardReceiver), -1.0, 1.0);
        if (Specification.Category == AnalyticLuminaireCategory::Spot)
        {
            const double Ramp = std::clamp((PolarCosine - Specification.OuterConeCosine) /
                                               (Specification.InnerConeCosine - Specification.OuterConeCosine),
                                           0.0, 1.0);
            AngularGain = Ramp * Ramp * (3.0 - 2.0 * Ramp);
        }
        if (Specification.Photometry.Loaded())
        {
            const double ThetaDeg = std::acos(PolarCosine) * (180.0 / PiConstant);
            const double PhiDeg   = std::atan2(DotProduct(TowardReceiver, RightUnit),
                                               DotProduct(TowardReceiver, UpUnit)) *
                                  (180.0 / PiConstant);
            AngularGain *= Specification.Photometry.Relative(ThetaDeg, PhiDeg);
        }
    }

    double RangeWindow = 1.0;
    if (Specification.ReachRadiusM > 0.0)
    {
        const double Ratio   = OutSourceDistanceM / Specification.ReachRadiusM;
        const double Quartic = Ratio * Ratio * Ratio * Ratio;
        RangeWindow          = (1.0 - Quartic) * (1.0 - Quartic);
    }

    const double Scale = AngularGain * RangeWindow / std::max(OutSourceDistanceM * OutSourceDistanceM, 1e-6);
    return {
        Specification.IntensityRgb[0] * Scale,
        Specification.IntensityRgb[1] * Scale,
        Specification.IntensityRgb[2] * Scale
    };
}

double EvaluateRadiantFacetPhotometricFactor(const RadiantFacetPhotometry& Photometry,
                                             SpatialVector                 DirectionFromSourceToReceiver) noexcept
{
    const SpatialVector TowardReceiver = NormalizeOrFallback(DirectionFromSourceToReceiver, {0.0, 0.0, -1.0});
    SpatialVector       ForwardUnit{}, RightUnit{}, UpUnit{};
    ConstructLuminaireBasis(Photometry.ForwardAxis, Photometry.UpAxis, ForwardUnit, RightUnit, UpUnit);
    double PolarCosine = std::clamp(DotProduct(ForwardUnit, TowardReceiver), -1.0, 1.0);
    if (!Photometry.TwoSidedEnabled && PolarCosine <= 0.0)
    {
        return 0.0;
    }
    if (Photometry.TwoSidedEnabled && PolarCosine < 0.0)
    {
        PolarCosine = -PolarCosine;
    }
    if (!Photometry.Photometry.Loaded())
    {
        return 1.0;
    }
    const double ThetaDeg = std::acos(PolarCosine) * (180.0 / PiConstant);
    const double PhiDeg   = std::atan2(DotProduct(TowardReceiver, RightUnit),
                                       DotProduct(TowardReceiver, UpUnit)) *
                          (180.0 / PiConstant);
    return Photometry.Photometry.Relative(ThetaDeg, PhiDeg);
}

//------------------------------------------------------------------------------------------------------------------------
//                                              ATLAS COMPILER & VALIDATOR
//------------------------------------------------------------------------------------------------------------------------

CompiledPhotometricAtlas CompilePhotometricClusterAtlas(
    const std::vector<AnalyticLuminaireSpecification>& AnalyticLuminaires,
    const std::vector<PathReplayFacet>&                Facets,
    const std::vector<RadiantFacetPhotometry>&         FacetPhotometry,
    const PhotometricClusterSpecification&             ClusterSpecification,
    std::vector<float>&                                AngleAtlas)
{
    std::size_t CellCount = 0u;
    ValidateGridBounds(ClusterSpecification, CellCount);

    CompiledPhotometricAtlas                     Compiled;
    std::unordered_map<std::uint64_t, uint32_t> UniformGridCache;

    // 1. Global radiant facet cumulative distribution (strictly positive 24-bit support).
    const std::vector<float> GlobalDistribution = CompileRadiantFacetDistribution(Facets);
    Compiled.GlobalFacetOffset                  = static_cast<std::uint32_t>(AngleAtlas.size());
    AngleAtlas.insert(AngleAtlas.end(), GlobalDistribution.begin(), GlobalDistribution.end());

    // 2. Analytic luminaire footprints + deduplicated uniform candela grids + 3D cluster cell partition.
    PhotometricLights Division;
    Division.Partition(AnalyticLuminaires, ClusterSpecification);
    Compiled.ActiveCellAssignments = Division.TotalCellAssignments();
    Compiled.OverflowCellCount     = Division.OverflowCellTotal();

    Compiled.AnalyticLuminaires.resize(AnalyticLuminaires.size());
    for (std::size_t LuminaireIndex = 0u; LuminaireIndex < AnalyticLuminaires.size(); ++LuminaireIndex)
    {
        const AnalyticLuminaireSpecification& Source = AnalyticLuminaires[LuminaireIndex];
        AnalyticLuminaireFootprint            Packed{};

        SpatialVector ForwardUnit{}, RightUnit{}, UpUnit{};
        ConstructLuminaireBasis(Source.ForwardAxis, Source.UpAxis, ForwardUnit, RightUnit, UpUnit);
        const SpatialVector StoredPosition = (Source.Category == AnalyticLuminaireCategory::Directional)
            ? NormalizeOrFallback(Source.Position, {0.0, 0.0, 1.0})
            : Source.Position;
        const SpatialVector OrthogonalUp   = CrossProduct(RightUnit, ForwardUnit);

        Packed.PositionReach = {
            static_cast<float>(StoredPosition.X),
            static_cast<float>(StoredPosition.Y),
            static_cast<float>(StoredPosition.Z),
            static_cast<float>(Source.ReachRadiusM)
        };
        Packed.RadianceCategory = {
            static_cast<float>(Source.IntensityRgb[0]),
            static_cast<float>(Source.IntensityRgb[1]),
            static_cast<float>(Source.IntensityRgb[2]),
            static_cast<float>(static_cast<std::uint32_t>(Source.Category))
        };
        Packed.DirectionInner = {
            static_cast<float>(ForwardUnit.X),
            static_cast<float>(ForwardUnit.Y),
            static_cast<float>(ForwardUnit.Z),
            static_cast<float>(Source.InnerConeCosine)
        };
        Packed.UpOuter = {
            static_cast<float>(OrthogonalUp.X),
            static_cast<float>(OrthogonalUp.Y),
            static_cast<float>(OrthogonalUp.Z),
            static_cast<float>(Source.OuterConeCosine)
        };

        const double ActiveCosineBound = ExtractActivePolarCosineBound(Source);
        float        PeakCandela       = 1.0f;
        float        CandelaOffset     = 0.0f;
        if (Source.Photometry.Loaded())
        {
            const std::uint32_t UniformGridOffset = ObtainUniformCandelaGrid(
                Source.Photometry, UniformGridCache, AngleAtlas);
            const auto Offsets = AppendLegacyCandelaTablesWithGridLink(
                Source.Photometry, UniformGridOffset, AngleAtlas);
            Packed.Profile = {Offsets[0], Offsets[1], Offsets[2], Offsets[3]};
            PeakCandela    = static_cast<float>(Source.Photometry.PeakCandela());
            CandelaOffset  = static_cast<float>(Offsets[4]);
        }
        Packed.PeakActive = {
            PeakCandela,
            Source.ActiveEnabled ? 1.0f : 0.0f,
            CandelaOffset,
            static_cast<float>(2.0 + ActiveCosineBound)
        };
        Compiled.AnalyticLuminaires[LuminaireIndex] = Packed;
    }

    const std::uint32_t StrideWords = ClusterSpecification.AnalyticCellCapacity + 1u;
    Compiled.AnalyticClusterCells.assign(CellCount * StrideWords, 0u);
    const SpatialVector GridSpan{
        ClusterSpecification.MaximumBoundary.X - ClusterSpecification.MinimumBoundary.X,
        ClusterSpecification.MaximumBoundary.Y - ClusterSpecification.MinimumBoundary.Y,
        ClusterSpecification.MaximumBoundary.Z - ClusterSpecification.MinimumBoundary.Z
    };
    const SpatialVector CellStep{
        GridSpan.X / ClusterSpecification.GridResolution[0],
        GridSpan.Y / ClusterSpecification.GridResolution[1],
        GridSpan.Z / ClusterSpecification.GridResolution[2]
    };

    for (std::uint32_t CellZ = 0u; CellZ < ClusterSpecification.GridResolution[2]; ++CellZ)
    {
        for (std::uint32_t CellY = 0u; CellY < ClusterSpecification.GridResolution[1]; ++CellY)
        {
            for (std::uint32_t CellX = 0u; CellX < ClusterSpecification.GridResolution[0]; ++CellX)
            {
                const std::size_t CellIndex =
                    (std::size_t(CellZ) * ClusterSpecification.GridResolution[1] + CellY) *
                        ClusterSpecification.GridResolution[0] +
                    CellX;
                const SpatialVector CellCentre{
                    ClusterSpecification.MinimumBoundary.X + (CellX + 0.5) * CellStep.X,
                    ClusterSpecification.MinimumBoundary.Y + (CellY + 0.5) * CellStep.Y,
                    ClusterSpecification.MinimumBoundary.Z + (CellZ + 0.5) * CellStep.Z
                };
                bool FallbackActivated = false;
                const auto& CellEntries = Division.RetrieveCandidates(CellCentre, &FallbackActivated);
                const std::size_t FirstWord = CellIndex * StrideWords;
                if (FallbackActivated)
                {
                    Compiled.AnalyticClusterCells[FirstWord] = ClusterSpecification.AnalyticCellCapacity + 1u;
                }
                else
                {
                    Compiled.AnalyticClusterCells[FirstWord] = static_cast<std::uint32_t>(CellEntries.size());
                    for (std::size_t SlotIndex = 0u; SlotIndex < CellEntries.size(); ++SlotIndex)
                    {
                        Compiled.AnalyticClusterCells[FirstWord + 1u + SlotIndex] = CellEntries[SlotIndex];
                    }
                }
            }
        }
    }

    // 3. Optional O(1) direct-indexed Emissive-IES surface luminaire map + deduplicated uniform candela grids.
    std::vector<RadiantFacetPhotometry> SortedPhotometry = FacetPhotometry;
    std::sort(SortedPhotometry.begin(), SortedPhotometry.end(),
              [](const RadiantFacetPhotometry& Left, const RadiantFacetPhotometry& Right)
              { return Left.FacetIndex < Right.FacetIndex; });

    std::vector<const RadiantFacetPhotometry*> FacetPhotometryLookup(Facets.size(), nullptr);
    if (!SortedPhotometry.empty())
    {
        std::vector<std::uint32_t> EntryGridOffsets(SortedPhotometry.size(), 0u);
        for (std::size_t EntryIndex = 0u; EntryIndex < SortedPhotometry.size(); ++EntryIndex)
        {
            const RadiantFacetPhotometry& Entry = SortedPhotometry[EntryIndex];
            if (Entry.FacetIndex >= Facets.size() || !Entry.Photometry.Loaded())
            {
                throw std::invalid_argument("Radiant facet photometry targets invalid facet or unloaded IES profile");
            }
            if (EntryIndex > 0u && SortedPhotometry[EntryIndex - 1u].FacetIndex == Entry.FacetIndex)
            {
                throw std::invalid_argument("Duplicate radiant facet photometry entry for the same facet index");
            }
            FacetPhotometryLookup[Entry.FacetIndex] = &Entry;
            EntryGridOffsets[EntryIndex]            = ObtainUniformCandelaGrid(
                Entry.Photometry, UniformGridCache, AngleAtlas);
        }

        // Layout at FacetPhotometryOffset:
        // [0]: float(Facets.size())
        // [1 .. Facets.size()]: 0.0 (isotropic diffuse) or float(EntryAddress) in AngleAtlas
        // Followed by SortedPhotometry.size() * 12-float records.
        Compiled.FacetPhotometryOffset = static_cast<std::uint32_t>(AngleAtlas.size());
        AngleAtlas.push_back(static_cast<float>(Facets.size()));
        const std::size_t MapStart = AngleAtlas.size();
        AngleAtlas.resize(MapStart + Facets.size(), 0.0f);

        for (std::size_t EntryIndex = 0u; EntryIndex < SortedPhotometry.size(); ++EntryIndex)
        {
            const RadiantFacetPhotometry& Entry        = SortedPhotometry[EntryIndex];
            const std::uint32_t           EntryAddress = static_cast<std::uint32_t>(AngleAtlas.size());
            AngleAtlas[MapStart + Entry.FacetIndex]    = static_cast<float>(EntryAddress);

            SpatialVector ForwardUnit{}, RightUnit{}, UpUnit{};
            ConstructLuminaireBasis(Entry.ForwardAxis, Entry.UpAxis, ForwardUnit, RightUnit, UpUnit);
            const double CosineMax = Entry.TwoSidedEnabled
                ? -1.0
                : std::max(0.0, ExtractCandelaPolarCosineBound(Entry.Photometry));
            AngleAtlas.insert(AngleAtlas.end(), {
                static_cast<float>(ForwardUnit.X),
                static_cast<float>(ForwardUnit.Y),
                static_cast<float>(ForwardUnit.Z),
                static_cast<float>(EntryGridOffsets[EntryIndex]),
                static_cast<float>(RightUnit.X),
                static_cast<float>(RightUnit.Y),
                static_cast<float>(RightUnit.Z),
                static_cast<float>(CosineMax),
                Entry.TwoSidedEnabled ? 1.0f : 0.0f,
                static_cast<float>(Entry.FacetIndex),
                0.0f,
                0.0f
            });
        }
    }

    // 4. Spatial-photometric 3D O(1) Vose-alias + sorted-PMF radiant facet cluster table.
    struct LuminousFacetSummary
    {
        std::uint32_t                 FacetIndex        = 0u;
        SpatialVector                 Centroid{};
        double                        BoundingRadiusM   = 0.0;
        double                        FluxProxy         = 0.0;
        double                        AreaM2            = 0.0;
        const RadiantFacetPhotometry* PhotometryPointer = nullptr;
        SpatialVector                 ForwardUnit{};
        double                        CosineBound       = -1.0;
    };

    std::vector<LuminousFacetSummary> LuminousFacets;
    const std::size_t GlobalSourceCount = static_cast<std::size_t>(GlobalDistribution[0]);
    LuminousFacets.reserve(GlobalSourceCount);
    for (std::size_t GlobalIndex = 0u; GlobalIndex < GlobalSourceCount; ++GlobalIndex)
    {
        const std::uint32_t    FacetIndex = static_cast<std::uint32_t>(GlobalDistribution[1u + GlobalIndex * 4u]);
        const PathReplayFacet& Facet      = Facets[FacetIndex];
        SpatialVector          Centroid{};
        double                 BoundingRadius = 0.0;
        const double           AreaM2         = EvaluateFacetAreaAndCentroid(Facet, Centroid, BoundingRadius);
        const double           Luminance      = 0.2126 * Facet.Emissive[0] + 0.7152 * Facet.Emissive[1] +
                                                0.0722 * Facet.Emissive[2];
        LuminousFacetSummary Summary{};
        Summary.FacetIndex        = FacetIndex;
        Summary.Centroid          = Centroid;
        Summary.BoundingRadiusM   = BoundingRadius;
        Summary.AreaM2            = AreaM2;
        Summary.FluxProxy         = AreaM2 * Luminance;
        Summary.PhotometryPointer = FacetPhotometryLookup[FacetIndex];
        if (Summary.PhotometryPointer != nullptr)
        {
            SpatialVector RightUnit{}, UpUnit{};
            ConstructLuminaireBasis(Summary.PhotometryPointer->ForwardAxis, Summary.PhotometryPointer->UpAxis,
                                    Summary.ForwardUnit, RightUnit, UpUnit);
            Summary.CosineBound = Summary.PhotometryPointer->TwoSidedEnabled
                ? -1.0
                : std::max(0.0, ExtractCandelaPolarCosineBound(Summary.PhotometryPointer->Photometry));
        }
        LuminousFacets.push_back(Summary);
    }

    const std::uint32_t SlotsPerCell = ClusterSpecification.RadiantSlotsPerCell;
    if (!LuminousFacets.empty() && SlotsPerCell > 0u)
    {
        Compiled.ClusterFacetTableOffset = static_cast<std::uint32_t>(AngleAtlas.size());
        const std::size_t CellStride     = 1u + 5u * std::size_t(SlotsPerCell);
        AngleAtlas.resize(AngleAtlas.size() + CellCount * CellStride, 0.0f);

        const double CellHalfDiagonal = 0.5 * VectorLength(CellStep);
        for (std::uint32_t CellZ = 0u; CellZ < ClusterSpecification.GridResolution[2]; ++CellZ)
        {
            for (std::uint32_t CellY = 0u; CellY < ClusterSpecification.GridResolution[1]; ++CellY)
            {
                for (std::uint32_t CellX = 0u; CellX < ClusterSpecification.GridResolution[0]; ++CellX)
                {
                    const std::size_t CellIndex =
                        (std::size_t(CellZ) * ClusterSpecification.GridResolution[1] + CellY) *
                            ClusterSpecification.GridResolution[0] +
                        CellX;
                    const SpatialVector CellLow{
                        ClusterSpecification.MinimumBoundary.X + CellX * CellStep.X,
                        ClusterSpecification.MinimumBoundary.Y + CellY * CellStep.Y,
                        ClusterSpecification.MinimumBoundary.Z + CellZ * CellStep.Z
                    };
                    const SpatialVector CellHigh{
                        CellLow.X + CellStep.X,
                        CellLow.Y + CellStep.Y,
                        CellLow.Z + CellStep.Z
                    };
                    const SpatialVector CellCentre{
                        0.5 * (CellLow.X + CellHigh.X),
                        0.5 * (CellLow.Y + CellHigh.Y),
                        0.5 * (CellLow.Z + CellHigh.Z)
                    };

                    struct CandidateScore
                    {
                        std::uint32_t FacetIndex = 0u;
                        double        Score      = 0.0;
                    };
                    std::vector<CandidateScore> ScoredCandidates;
                    ScoredCandidates.reserve(LuminousFacets.size());

                    for (const LuminousFacetSummary& Source : LuminousFacets)
                    {
                        const SpatialVector ExpandedLow{
                            CellLow.X - Source.BoundingRadiusM,
                            CellLow.Y - Source.BoundingRadiusM,
                            CellLow.Z - Source.BoundingRadiusM
                        };
                        const SpatialVector ExpandedHigh{
                            CellHigh.X + Source.BoundingRadiusM,
                            CellHigh.Y + Source.BoundingRadiusM,
                            CellHigh.Z + Source.BoundingRadiusM
                        };
                        if (Source.PhotometryPointer != nullptr && !Source.PhotometryPointer->TwoSidedEnabled)
                        {
                            if (!EvaluatePolarConeBoxIntersection(Source.Centroid, 0.0, Source.ForwardUnit,
                                                                  Source.CosineBound, ExpandedLow, ExpandedHigh))
                            {
                                continue;
                            }
                        }

                        double BoxDistSquared = 0.0;
                        for (std::uint32_t AxisIndex = 0u; AxisIndex < 3u; ++AxisIndex)
                        {
                            const double CentroidCoord = ExtractCoordinate(Source.Centroid, AxisIndex);
                            const double ClampedCoord  = std::clamp(CentroidCoord,
                                                                    ExtractCoordinate(CellLow, AxisIndex),
                                                                    ExtractCoordinate(CellHigh, AxisIndex));
                            const double Delta         = CentroidCoord - ClampedCoord;
                            BoxDistSquared += Delta * Delta;
                        }
                        const double RegularizedDistSq = std::max({
                            BoxDistSquared,
                            0.25 * CellHalfDiagonal * CellHalfDiagonal + Source.AreaM2 / PiConstant,
                            1e-4
                        });

                        double PhotometricGain = 1.0;
                        if (Source.PhotometryPointer != nullptr)
                        {
                            double PeakCellFactor = EvaluateRadiantFacetPhotometricFactor(
                                *Source.PhotometryPointer,
                                {CellCentre.X - Source.Centroid.X,
                                 CellCentre.Y - Source.Centroid.Y,
                                 CellCentre.Z - Source.Centroid.Z});
                            for (std::uint32_t CornerBits = 0u; CornerBits < 8u; ++CornerBits)
                            {
                                const SpatialVector Corner{
                                    (CornerBits & 1u) != 0u ? CellHigh.X : CellLow.X,
                                    (CornerBits & 2u) != 0u ? CellHigh.Y : CellLow.Y,
                                    (CornerBits & 4u) != 0u ? CellHigh.Z : CellLow.Z
                                };
                                PeakCellFactor = std::max(PeakCellFactor,
                                    EvaluateRadiantFacetPhotometricFactor(
                                        *Source.PhotometryPointer,
                                        {Corner.X - Source.Centroid.X,
                                         Corner.Y - Source.Centroid.Y,
                                         Corner.Z - Source.Centroid.Z}));
                            }
                            PhotometricGain = std::max(PeakCellFactor, 0.05);
                        }

                        const double Score = (Source.FluxProxy * PhotometricGain) / RegularizedDistSq;
                        if (Score > 0.0 && std::isfinite(Score))
                        {
                            ScoredCandidates.push_back({Source.FacetIndex, Score});
                        }
                    }

                    if (ScoredCandidates.size() > SlotsPerCell)
                    {
                        std::partial_sort(ScoredCandidates.begin(),
                                          ScoredCandidates.begin() + SlotsPerCell,
                                          ScoredCandidates.end(),
                                          [](const CandidateScore& Left, const CandidateScore& Right)
                                          {
                                              return Left.Score > Right.Score ||
                                                     (Left.Score == Right.Score && Left.FacetIndex < Right.FacetIndex);
                                          });
                        ScoredCandidates.resize(SlotsPerCell);
                    }
                    std::sort(ScoredCandidates.begin(), ScoredCandidates.end(),
                              [](const CandidateScore& Left, const CandidateScore& Right)
                              { return Left.FacetIndex < Right.FacetIndex; });

                    const std::size_t CellBase = Compiled.ClusterFacetTableOffset + CellIndex * CellStride;
                    AngleAtlas[CellBase]       = static_cast<float>(ScoredCandidates.size());
                    if (!ScoredCandidates.empty())
                    {
                        double ScoreTotal = 0.0;
                        for (const CandidateScore& Entry : ScoredCandidates)
                        {
                            ScoreTotal += Entry.Score;
                        }
                        std::vector<std::uint32_t> CellFacetIndices(ScoredCandidates.size());
                        std::vector<float>         CellProbabilities(ScoredCandidates.size());
                        double CumulativeScore     = 0.0;
                        float  PreviousProbability = 0.0f;
                        for (std::size_t SlotIndex = 0u; SlotIndex < ScoredCandidates.size(); ++SlotIndex)
                        {
                            CumulativeScore += ScoredCandidates[SlotIndex].Score;
                            const std::uint32_t CumulativeTick = (SlotIndex + 1u == ScoredCandidates.size())
                                ? RadiantFacetProbabilityTicks
                                : static_cast<std::uint32_t>(SlotIndex + 1u) +
                                      static_cast<std::uint32_t>(std::floor(
                                          CumulativeScore / ScoreTotal *
                                          double(RadiantFacetProbabilityTicks - ScoredCandidates.size())));
                            const float CumulativeProbability =
                                float(CumulativeTick) / float(RadiantFacetProbabilityTicks);
                            const float SlotProbability       = CumulativeProbability - PreviousProbability;
                            CellFacetIndices[SlotIndex]       = ScoredCandidates[SlotIndex].FacetIndex;
                            CellProbabilities[SlotIndex]      = SlotProbability;
                            AngleAtlas[CellBase + 1u + 2u * SlotIndex + 0u] =
                                static_cast<float>(CellFacetIndices[SlotIndex]);
                            AngleAtlas[CellBase + 1u + 2u * SlotIndex + 1u] = SlotProbability;
                            PreviousProbability               = CumulativeProbability;
                        }

                        std::vector<float>         AliasThresholds;
                        std::vector<std::uint32_t> AliasTargets;
                        BuildVoseAliasTable(CellFacetIndices, CellProbabilities, AliasThresholds, AliasTargets);
                        const std::size_t AliasStart = CellBase + 1u + 2u * std::size_t(SlotsPerCell);
                        for (std::size_t SlotIndex = 0u; SlotIndex < ScoredCandidates.size(); ++SlotIndex)
                        {
                            AngleAtlas[AliasStart + 3u * SlotIndex + 0u] =
                                static_cast<float>(CellFacetIndices[SlotIndex]);
                            AngleAtlas[AliasStart + 3u * SlotIndex + 1u] = AliasThresholds[SlotIndex];
                            AngleAtlas[AliasStart + 3u * SlotIndex + 2u] =
                                static_cast<float>(AliasTargets[SlotIndex]);
                        }
                    }
                }
            }
        }
    }

    // 5. 16-float unified photometric cluster header.
    Compiled.PhotometricHeaderOffset = static_cast<std::uint32_t>(AngleAtlas.size());
    const bool AnalyticActive = ClusterSpecification.AnalyticChannelEnabled && !AnalyticLuminaires.empty();
    AngleAtlas.insert(AngleAtlas.end(), {
        static_cast<float>(ClusterSpecification.MinimumBoundary.X),
        static_cast<float>(ClusterSpecification.MinimumBoundary.Y),
        static_cast<float>(ClusterSpecification.MinimumBoundary.Z),
        static_cast<float>(AnalyticLuminaires.size()),
        static_cast<float>(ClusterSpecification.MaximumBoundary.X),
        static_cast<float>(ClusterSpecification.MaximumBoundary.Y),
        static_cast<float>(ClusterSpecification.MaximumBoundary.Z),
        static_cast<float>(ClusterSpecification.AnalyticCellCapacity),
        static_cast<float>(ClusterSpecification.GridResolution[0]),
        static_cast<float>(ClusterSpecification.GridResolution[1]),
        static_cast<float>(ClusterSpecification.GridResolution[2]),
        static_cast<float>(ClusterSpecification.GlobalMixtureFraction),
        static_cast<float>(SlotsPerCell),
        static_cast<float>(Compiled.ClusterFacetTableOffset),
        static_cast<float>(Compiled.FacetPhotometryOffset),
        AnalyticActive ? 1.0f : 0.0f
    });

    if (AngleAtlas.size() > std::size_t(UINT32_MAX))
    {
        throw std::runtime_error("Photometric cluster atlas exceeds 32-bit shader float addressing");
    }
    return Compiled;
}

void ValidatePhotometricClusterAtlas(const std::vector<float>& AngleAtlas, std::size_t HeaderOffset,
                                     std::size_t FacetCount, std::size_t AnalyticLuminaireCount)
{
    if (HeaderOffset > AngleAtlas.size() || AngleAtlas.size() - HeaderOffset < PhotometricClusterHeaderFloats)
    {
        throw std::runtime_error("Photometric cluster header span is outside AngleAtlas");
    }
    const float* Header = AngleAtlas.data() + HeaderOffset;
    for (std::size_t Word = 0u; Word < PhotometricClusterHeaderFloats; ++Word)
    {
        if (!std::isfinite(Header[Word]))
        {
            throw std::runtime_error("Photometric cluster header contains non-finite float");
        }
    }

    for (std::size_t AxisIndex = 0u; AxisIndex < 3u; ++AxisIndex)
    {
        if (!(Header[4u + AxisIndex] > Header[AxisIndex]) || Header[8u + AxisIndex] < 1.0f ||
            Header[8u + AxisIndex] > 256.0f || std::floor(Header[8u + AxisIndex]) != Header[8u + AxisIndex])
        {
            throw std::runtime_error("Photometric cluster header grid bounds or resolution invalid");
        }
    }

    if (std::size_t(Header[3]) != AnalyticLuminaireCount || Header[7] < 1.0f || Header[7] > 4096.0f ||
        Header[11] <= 0.0f || Header[11] > 1.0f || Header[12] < 0.0f || Header[12] > 16.0f)
    {
        throw std::runtime_error("Photometric cluster header parameters invalid");
    }

    const std::size_t GridCells          = std::size_t(Header[8]) * std::size_t(Header[9]) * std::size_t(Header[10]);
    const std::size_t SlotsPerCell       = std::size_t(Header[12]);
    const std::size_t ClusterTableOffset = std::size_t(Header[13]);
    const std::size_t PhotometryOffset   = std::size_t(Header[14]);

    if (ClusterTableOffset != 0u)
    {
        const std::size_t Stride     = 1u + 5u * SlotsPerCell;
        const std::size_t TableWords = GridCells * Stride;
        if (SlotsPerCell == 0u || ClusterTableOffset > AngleAtlas.size() ||
            AngleAtlas.size() - ClusterTableOffset < TableWords)
        {
            throw std::runtime_error("Clustered radiant facet table span is truncated");
        }
        for (std::size_t CellIndex = 0u; CellIndex < GridCells; ++CellIndex)
        {
            const float* CellData  = AngleAtlas.data() + ClusterTableOffset + CellIndex * Stride;
            const float  CountWord = CellData[0];
            if (CountWord < 0.0f || CountWord > float(SlotsPerCell) || std::floor(CountWord) != CountWord)
            {
                throw std::runtime_error("Clustered radiant cell count is invalid");
            }
            const std::size_t EntryCount = std::size_t(CountWord);
            double ProbabilitySum        = 0.0;
            float  PreviousFacet         = -1.0f;
            for (std::size_t SlotIndex = 0u; SlotIndex < EntryCount; ++SlotIndex)
            {
                const float* Slot = CellData + 1u + 2u * SlotIndex;
                if (Slot[0] <= PreviousFacet || double(Slot[0]) >= double(FacetCount) ||
                    std::floor(Slot[0]) != Slot[0] || Slot[1] <= 0.0f || Slot[1] > 1.0f)
                {
                    throw std::runtime_error("Clustered radiant cell probability entry is invalid");
                }
                PreviousFacet = Slot[0];
                ProbabilitySum += double(Slot[1]);
            }
            if (EntryCount > 0u && std::abs(ProbabilitySum - 1.0) >= 1e-5)
            {
                throw std::runtime_error("Clustered radiant cell probabilities do not sum to 1");
            }
        }
    }

    if (PhotometryOffset != 0u)
    {
        if (PhotometryOffset >= AngleAtlas.size())
        {
            throw std::runtime_error("Radiant facet photometry offset is outside AngleAtlas");
        }
        const float MappedFacets = AngleAtlas[PhotometryOffset];
        if (std::size_t(MappedFacets) != FacetCount ||
            PhotometryOffset + 1u + FacetCount > AngleAtlas.size())
        {
            throw std::runtime_error("Radiant facet photometry direct map span is invalid");
        }
        const std::size_t UniformGridWords =
            std::size_t(PhotometricUniformThetaSamples) * PhotometricUniformPhiSamples;
        for (std::size_t FacetIdx = 0u; FacetIdx < FacetCount; ++FacetIdx)
        {
            const float AddressWord = AngleAtlas[PhotometryOffset + 1u + FacetIdx];
            if (AddressWord != 0.0f)
            {
                const std::size_t EntryAddr = std::size_t(AddressWord);
                if (EntryAddr + RadiantFacetPhotometryFloats > AngleAtlas.size())
                {
                    throw std::runtime_error("Radiant facet photometry record exceeds AngleAtlas");
                }
                const std::size_t GridAddr = std::size_t(AngleAtlas[EntryAddr + 3u]);
                if (GridAddr + UniformGridWords > AngleAtlas.size())
                {
                    throw std::runtime_error("Uniform candela grid exceeds AngleAtlas");
                }
            }
        }
    }
}

double EvaluateClusteredFacetSelectionProbability(const std::vector<float>& AngleAtlas, std::size_t HeaderOffset,
                                                  std::size_t GlobalFacetOffset, SpatialVector OriginPoint,
                                                  std::uint32_t FacetIndex, bool HalfUniformGlobalMixture) noexcept
{
    if (GlobalFacetOffset >= AngleAtlas.size())
    {
        return 0.0;
    }
    const std::size_t GlobalCount = static_cast<std::size_t>(AngleAtlas[GlobalFacetOffset]);
    if (GlobalCount == 0u)
    {
        return 0.0;
    }

    std::size_t Low  = 0u;
    std::size_t High = GlobalCount;
    while (Low < High)
    {
        const std::size_t Mid = (Low + High) / 2u;
        if (static_cast<std::uint32_t>(AngleAtlas[GlobalFacetOffset + 1u + Mid * 4u]) < FacetIndex)
        {
            Low = Mid + 1u;
        }
        else
        {
            High = Mid;
        }
    }
    if (Low >= GlobalCount ||
        static_cast<std::uint32_t>(AngleAtlas[GlobalFacetOffset + 1u + Low * 4u]) != FacetIndex)
    {
        return 0.0;
    }
    double GlobalProbability = double(AngleAtlas[GlobalFacetOffset + 1u + Low * 4u + 1u]);
    if (HalfUniformGlobalMixture)
    {
        GlobalProbability = 0.5 * GlobalProbability + 0.5 / double(GlobalCount);
    }

    if (HeaderOffset + PhotometricClusterHeaderFloats > AngleAtlas.size())
    {
        return GlobalProbability;
    }
    const float*      Header             = AngleAtlas.data() + HeaderOffset;
    const std::size_t SlotsPerCell       = static_cast<std::size_t>(Header[12]);
    const std::size_t ClusterTableOffset = static_cast<std::size_t>(Header[13]);
    if (ClusterTableOffset == 0u || SlotsPerCell == 0u)
    {
        return GlobalProbability;
    }

    const double Coordinates[3] = {OriginPoint.X, OriginPoint.Y, OriginPoint.Z};
    std::size_t  CellCoords[3]  = {};
    for (std::size_t AxisIndex = 0u; AxisIndex < 3u; ++AxisIndex)
    {
        const double LowBound  = double(Header[AxisIndex]);
        const double HighBound = double(Header[4u + AxisIndex]);
        const double GridRes   = double(Header[8u + AxisIndex]);
        if (!std::isfinite(Coordinates[AxisIndex]) || Coordinates[AxisIndex] < LowBound ||
            Coordinates[AxisIndex] >= HighBound)
        {
            return GlobalProbability;
        }
        const double Normalized = (Coordinates[AxisIndex] - LowBound) / (HighBound - LowBound) * GridRes;
        CellCoords[AxisIndex]   = std::min(static_cast<std::size_t>(Normalized), static_cast<std::size_t>(GridRes) - 1u);
    }

    const std::size_t GridX      = static_cast<std::size_t>(Header[8]);
    const std::size_t GridY      = static_cast<std::size_t>(Header[9]);
    const std::size_t CellIndex  = (CellCoords[2] * GridY + CellCoords[1]) * GridX + CellCoords[0];
    const std::size_t Stride     = 1u + 5u * SlotsPerCell;
    const float*      CellData   = AngleAtlas.data() + ClusterTableOffset + CellIndex * Stride;
    const std::size_t LocalCount = static_cast<std::size_t>(CellData[0]);
    if (LocalCount == 0u)
    {
        return GlobalProbability;
    }

    double      LocalProbability = 0.0;
    std::size_t LocalLow         = 0u;
    std::size_t LocalHigh        = LocalCount;
    while (LocalLow < LocalHigh)
    {
        const std::size_t Mid = (LocalLow + LocalHigh) / 2u;
        if (static_cast<std::uint32_t>(CellData[1u + 2u * Mid]) < FacetIndex)
        {
            LocalLow = Mid + 1u;
        }
        else
        {
            LocalHigh = Mid;
        }
    }
    if (LocalLow < LocalCount && static_cast<std::uint32_t>(CellData[1u + 2u * LocalLow]) == FacetIndex)
    {
        LocalProbability = double(CellData[1u + 2u * LocalLow + 1u]);
    }

    const double GlobalFraction = double(Header[11]);
    return (1.0 - GlobalFraction) * LocalProbability + GlobalFraction * GlobalProbability;
}

} // namespace Frontier
