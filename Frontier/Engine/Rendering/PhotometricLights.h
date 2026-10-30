/*==========================================================================================================================================
                                                 PHOTOMETRICCLUSTEREXTENSION.H
==========================================================================================================================================*/
// 🧩 Conservative cone-sphere-box analytic luminaire clustering and O(1) alias-accelerated radiant facet importance grids.

#pragma once

#include "CandelaDistribution.h"
#include "ClusterNesting.h"
#include "PathReplayFootprint.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                  LUMINAIRE CATEGORIES
//------------------------------------------------------------------------------------------------------------------------

enum class AnalyticLuminaireCategory : std::uint32_t
{
    Directional = 0,
    Point       = 1,
    Spot        = 2
};

enum class ClusterCullingMode : std::uint32_t
{
    SphereReach    = 0,
    TightPolarCone = 1
};

//------------------------------------------------------------------------------------------------------------------------
//                                              GPU & AUTHORING SPECIFICATIONS
//------------------------------------------------------------------------------------------------------------------------

// 📝 Matches LightShape in LightInfluence.slang byte-for-byte (96 B, 16-byte aligned).
struct alignas(16) AnalyticLuminaireFootprint
{
    std::array<float, 4>         PositionReach{};     // [m, m, m, m]  - world position (or unit direction) and reach radius
    std::array<float, 4>         RadianceCategory{};  // [W/sr]        - spectral intensity and category (0 dir, 1 point, 2 spot)
    std::array<float, 4>         DirectionInner{};    // [-]           - unit forward axis and inner spot cosine
    std::array<float, 4>         UpOuter{};           // [-]           - reference up axis and outer spot cosine
    std::array<std::uint32_t, 4> Profile{};           // [index]       - vertical (offset, count) and horizontal (offset, count)
    std::array<float, 4>         PeakActive{};        // [cd, -, -, -] - peak candela, active gate, candela offset, cone encoding
};
static_assert(sizeof(AnalyticLuminaireFootprint) == 96 && alignof(AnalyticLuminaireFootprint) == 16);

struct AnalyticLuminaireSpecification
{
    AnalyticLuminaireCategory Category        = AnalyticLuminaireCategory::Point;
    SpatialVector             Position{};                                 // [m]    - world position (or unit direction when directional)
    double                    ReachRadiusM    = 0.0;                      // [m]    - zero denotes unbounded support
    std::array<double, 3>     IntensityRgb    = {1.0, 1.0, 1.0};          // [W/sr] - spectral radiant intensity (or irradiance)
    SpatialVector             ForwardAxis     = {0.0, 0.0, -1.0};         // [-]    - polar theta = 0 luminaire axis
    SpatialVector             UpAxis          = {0.0, 1.0, 0.0};          // [-]    - azimuthal reference axis
    double                    InnerConeCosine = 0.90;                     // [-]    - cos(theta_inner) for spot smoothstep
    double                    OuterConeCosine = 0.70;                     // [-]    - cos(theta_outer) for spot cutoff
    CandelaDistribution       Photometry{};                               // [cd]   - optional Type-C LM-63 candela distribution
    bool                      ActiveEnabled   = true;                     // [-]    - zero-output gate without deleting table slot
};

// 📝 Attaches an optional Type-C LM-63 photometric candela distribution to an emissive surface facet (Emissive-IES).
struct RadiantFacetPhotometry
{
    std::uint32_t       FacetIndex      = 0;                  // [index] - target triangle index in PathReplayFacet array
    SpatialVector       ForwardAxis     = {0.0, 0.0, -1.0};   // [-]     - polar theta = 0 emission axis
    SpatialVector       UpAxis          = {0.0, 1.0, 0.0};    // [-]     - azimuthal reference axis
    CandelaDistribution Photometry{};                         // [cd]    - Type-C LM-63 candela table
    bool                TwoSidedEnabled = false;              // [-]     - false restricts exitance to forward hemisphere
};

struct PhotometricClusterSpecification
{
    SpatialVector                MinimumBoundary        = {-16.0, -16.0, 0.0};   // [m]     - lower world-space cluster corner
    SpatialVector                MaximumBoundary        = {16.0, 16.0, 8.0};     // [m]     - upper world-space cluster corner
    std::array<std::uint32_t, 3> GridResolution         = {8u, 8u, 4u};          // [cells] - 3D cluster lattice dimensions
    std::uint32_t                AnalyticCellCapacity   = 16u;                   // [count] - max analytic luminaires per cell before fallback
    std::uint32_t                RadiantSlotsPerCell    = 8u;                    // [count] - top-K local radiant facets per cell (<= 16)
    double                       GlobalMixtureFraction  = 0.15;                  // [-]     - defensive global CDF weight in (0, 1]
    ClusterCullingMode           CullingMode            = ClusterCullingMode::TightPolarCone;
    bool                         AnalyticChannelEnabled = true;                  // [-]     - enables clustered analytic sampling in replay
};

//------------------------------------------------------------------------------------------------------------------------
//                                                 COMPILED ATLAS FOOTPRINT
//------------------------------------------------------------------------------------------------------------------------

inline constexpr std::uint32_t PhotometricClusterHeaderFloats = 16u;
inline constexpr std::uint32_t RadiantFacetPhotometryFloats   = 12u;
inline constexpr std::uint32_t PhotometricUniformThetaSamples = 181u;
inline constexpr std::uint32_t PhotometricUniformPhiSamples   = 73u;
inline constexpr std::uint32_t PhotometricTightClusterMask    = 128u;

struct CompiledPhotometricAtlas
{
    std::vector<AnalyticLuminaireFootprint> AnalyticLuminaires;              // [records] - GPU binding(0) LightShape array
    std::vector<std::uint32_t>              AnalyticClusterCells;            // [words]   - GPU binding(5) flat (Capacity + 1) cell table
    std::uint32_t                           PhotometricHeaderOffset = 0u;    // [floats]  - start of 16-float header inside AngleAtlas
    std::uint32_t                           GlobalFacetOffset       = 0u;    // [floats]  - start of global RadiantFacetDistribution
    std::uint32_t                           ClusterFacetTableOffset = 0u;    // [floats]  - start of 3D O(1) alias radiant facet table
    std::uint32_t                           FacetPhotometryOffset   = 0u;    // [floats]  - start of O(1) facet->photometry map (0 = none)
    std::uint64_t                           ActiveCellAssignments   = 0u;    // [count]   - total retained cell->luminaire entries
    std::uint32_t                           OverflowCellCount       = 0u;    // [cells]   - cells exceeding AnalyticCellCapacity
};

//------------------------------------------------------------------------------------------------------------------------
//                                              DIVISION & REFERENCE FUNCTIONS
//------------------------------------------------------------------------------------------------------------------------

// 📝 Conservative polar-cone + sphere vs axis-aligned box predicate (zero false negatives across (0, pi]).
[[nodiscard]] bool EvaluatePolarConeBoxIntersection(SpatialVector ConeApex, double ReachRadiusM,
                                                    SpatialVector UnitForwardAxis, double CosineThetaMax,
                                                    SpatialVector BoxLow, SpatialVector BoxHigh) noexcept;

// 📝 Extracts exact active polar cosine bound from Spot cutoff and Type-C LM-63 non-zero candela support.
[[nodiscard]] double ExtractActivePolarCosineBound(const AnalyticLuminaireSpecification& Specification);

class PhotometricLights
{
  public:
    void Partition(const std::vector<AnalyticLuminaireSpecification>& AnalyticLuminaires,
                   const PhotometricClusterSpecification&             ClusterSpecification);

    [[nodiscard]] const std::vector<std::uint32_t>& RetrieveCandidates(SpatialVector QueryPoint,
                                                                       bool*         FallbackActivated = nullptr) const;

    [[nodiscard]] std::uint64_t TotalCellAssignments() const noexcept { return TotalAssignments_; }
    [[nodiscard]] std::uint32_t OverflowCellTotal() const noexcept { return OverflowCells_; }
    [[nodiscard]] std::size_t   CellTotal() const noexcept { return Cells_.size(); }

  private:
    SpatialVector                           MinimumBoundary_{};
    SpatialVector                           MaximumBoundary_{};
    std::array<std::uint32_t, 3>            GridResolution_{};
    std::vector<std::vector<std::uint32_t>> Cells_;
    std::vector<bool>                       CellOverflowed_;
    std::vector<std::uint32_t>              ExhaustiveIndices_;
    std::uint64_t                           TotalAssignments_ = 0u;
    std::uint32_t                           OverflowCells_    = 0u;
};

// 📝 Appends global facet CDF, deduplicated uniform (theta, phi) candela grids, O(1) Emissive-IES map, and O(1) Vose alias cells.
[[nodiscard]] CompiledPhotometricAtlas CompilePhotometricClusterAtlas(
    const std::vector<AnalyticLuminaireSpecification>& AnalyticLuminaires,
    const std::vector<PathReplayFacet>&                Facets,
    const std::vector<RadiantFacetPhotometry>&         FacetPhotometry,
    const PhotometricClusterSpecification&             ClusterSpecification,
    std::vector<float>&                                AngleAtlas);

void ValidatePhotometricClusterAtlas(const std::vector<float>& AngleAtlas, std::size_t HeaderOffset,
                                     std::size_t FacetCount, std::size_t AnalyticLuminaireCount);

// 📝 Double-precision CPU reference evaluators matching GPU LightInfluence.slang and PhotometricLuminaire.slang.
[[nodiscard]] std::array<double, 3> EvaluateAnalyticLuminaireArrival(
    const AnalyticLuminaireSpecification& Specification, SpatialVector ReceiverPoint,
    SpatialVector& OutDirectionTowardSource, double& OutSourceDistanceM) noexcept;

[[nodiscard]] double EvaluateRadiantFacetPhotometricFactor(
    const RadiantFacetPhotometry& Photometry, SpatialVector DirectionFromSourceToReceiver) noexcept;

[[nodiscard]] double EvaluateClusteredFacetSelectionProbability(
    const std::vector<float>& AngleAtlas, std::size_t HeaderOffset, std::size_t GlobalFacetOffset,
    SpatialVector OriginPoint, std::uint32_t FacetIndex, bool HalfUniformGlobalMixture) noexcept;

} // namespace Frontier
