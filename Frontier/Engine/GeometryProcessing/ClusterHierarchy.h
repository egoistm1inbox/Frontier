/*==========================================================================================================================================
                                                GLASSAWARECLUSTEREXTENSION.H
==========================================================================================================================================*/
// 🧩 Glass-aware virtualized cluster geometry: locked-border quadric tier sequence, IOR optical error cut, two-phase Hi-Z
//    occlusion (glass exempt from depth occlusion writes & backface cone cull), 64 KB LRU page residency, and 2-layer glass peel.

#pragma once

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             INCLUDES
------------------------------------------------------------------------------------------------------------------------------------------*/
#include "Engine/Foundation/Math.h"
#include "Engine/GeometryProcessing/QuadricTierBuild.h"

#include <cstdint>
#include <vector>

namespace Frontier
{
/*------------------------------------------------------------------------------------------------------------------------------------------
                                            MATERIAL & GLASS CLUSTER CLASSIFICATION
------------------------------------------------------------------------------------------------------------------------------------------*/
struct ClusterMaterialProfile
{
    uint32_t ClassificationId           = 0u;
    bool     TransmissiveGlass          = false;              // [boolean] - True for refractive glass / crystal / glazing
    float    RefractiveIndexIor         = 1.52f;              // [-] - Relative IOR (crown glass = 1.52, flint/crystal = 1.68)
    Vec3     SpectralAbsorptionPerMetre = {0.12f, 0.04f, 0.06f}; // [1/m] - Beer-Lambert internal glass absorption
    Vec3     AlbedoRgb                  = {0.75f, 0.76f, 0.78f};
    float    Roughness                  = 0.35f;
    float    Metallic                   = 0.0f;
};

struct GlassAwareClusterRecord
{
    uint32_t TierIndex                 = 0u;    // [0 = finest leaf .. N-1 = coarsest root]
    uint32_t ClusterIndexInTier        = 0u;
    uint32_t GlobalClusterId           = 0u;
    uint32_t ClassificationId          = 0u;
    bool     TransmissiveGlass         = false;
    float    RefractiveIndexIor        = 1.0f;
    float    OpticalDeviationBoost     = 1.0f;  // [-] - 1 + k_opt * (eta - 1) * sin(cone_half_angle) for curved glass
    double   SelfDeviationMetres       = 0.0;   // [m] - Monotonic geometric error at this tier
    double   CoarserDeviationMetres    = 1.0e9; // [m] - Group-coherent error of enclosing coarser tier (INF at root)
    Vector3  SphereCentre              = {};
    double   SphereRadiusMetres        = 0.0;
    Vector3  CoarserSphereCentre       = {};
    double   CoarserSphereRadiusMetres = 0.0;
    Vector3  ConeAxis                  = {};
    double   ConeCutoff                = -1.0;
    Vec3     BoundsMin                 = {};
    Vec3     BoundsMax                 = {};
    uint32_t TriangleCount             = 0u;
    uint32_t PageSlotIndex             = 0u;    // [idx] - 64 KB streaming page containing this cluster
    std::vector<uint32_t> EnclosedFinerGlobals; // [idx] - Finer global cluster IDs covered by this cluster
};

/*------------------------------------------------------------------------------------------------------------------------------------------
                                               64 KB STREAMING PAGE RESIDENCY
------------------------------------------------------------------------------------------------------------------------------------------*/
struct ClusterStreamingPage
{
    uint32_t              PageIndex        = 0u;
    uint32_t              ByteSize         = 0u;
    bool                  PinnedRoot       = false; // Root/coarsest pages never evict
    bool                  ResidentInMemory = true;
    uint64_t              LastTouchedTick  = 0u;
    std::vector<uint32_t> MemberGlobalIds;
};

/*------------------------------------------------------------------------------------------------------------------------------------------
                                           CAMERA VIEW & RUNTIME CULL TELEMETRY
------------------------------------------------------------------------------------------------------------------------------------------*/
struct ClusterCameraView
{
    Vec3     CameraOrigin     = {0.0f, -8.0f, 3.0f};
    Vec3     CameraTarget     = {0.0f, 0.0f, 0.8f};
    Vec3     CameraUp         = {0.0f, 0.0f, 1.0f};
    float    VerticalFovRad   = 0.85f;
    uint32_t ViewportWidthPx  = 960u;
    uint32_t ViewportHeightPx = 540u;
    float    ErrorThresholdPx = 1.25f;
};

struct ClusterRuntimeFrameReport
{
    std::vector<uint32_t> SelectedOpaqueGlobals;
    std::vector<uint32_t> SelectedGlassGlobals;
    uint32_t              TotalCutClusters            = 0u;
    uint32_t              FrustumCulledCount          = 0u;
    uint32_t              BackfaceConeCulledCount     = 0u;
    uint32_t              HiZOccludedOpaqueCount      = 0u;
    uint32_t              GlassExemptFromBackface     = 0u;
    uint32_t              OpaqueBehindGlassSurvived   = 0u;
    uint32_t              FallbackToResidentCoarser   = 0u;
    uint32_t              ActiveTrianglesAfterCull    = 0u;
    uint32_t              SourceLeafTriangles         = 0u;
};

/*------------------------------------------------------------------------------------------------------------------------------------------
                                        VISIBILITY BUFFER & TWO-LAYER GLASS PEEL
------------------------------------------------------------------------------------------------------------------------------------------*/
struct VisibilityPixelRecord
{
    bool     OpaqueValid          = false;
    uint32_t OpaqueGlobalCluster  = 0u;
    uint32_t OpaqueTierIndex      = 0u;
    uint32_t OpaqueTriangleInTier = 0u;
    uint32_t OpaqueClassification = 0u;
    float    OpaqueDepthM         = 1.0e9f;
    Vec3     OpaqueWorldPos       = {};
    Vec3     OpaqueWorldNormal    = {0.0f, 0.0f, 1.0f};
    Vec3     OpaqueBarycentrics   = {};
    float    OpaqueUvU            = 0.0f;
    float    OpaqueUvV            = 0.0f;

    bool     FrontGlassValid      = false;
    uint32_t FrontGlassCluster    = 0u;
    uint32_t FrontGlassTier       = 0u;
    uint32_t GlassClassification  = 0u;
    float    FrontGlassDepthM     = 1.0e9f;
    Vec3     FrontGlassPos        = {};
    Vec3     FrontGlassNormal     = {0.0f, 0.0f, 1.0f};

    bool     BackGlassValid       = false;
    float    BackGlassDepthM      = 1.0e9f;
    Vec3     BackGlassPos         = {};
    Vec3     BackGlassNormal      = {0.0f, 0.0f, -1.0f};
};

/*------------------------------------------------------------------------------------------------------------------------------------------
                                             GLASS-AWARE CLUSTER EXTENSION
------------------------------------------------------------------------------------------------------------------------------------------*/
class ClusterHierarchy
{
public:
    static constexpr uint32_t StreamingPageCapacityBytes = 65536u; // 64 KB fixed virtualized page budget

    ClusterHierarchy() = default;

    void RegisterMaterialProfile(const ClusterMaterialProfile& Profile);

    // Welds FacetField, partitions class-pure <=128-triangle clusters, builds locked-border Quadric tiers,
    // computes IOR optical deviation boosts on curved glass, and packs 64 KB streaming pages!
    bool BuildFromFacetField(
        const FacetField&             SourceFacets,
        const TierBuildSpecification& Specification = TierBuildSpecification{});

    // Enforces a strict VRAM page byte budget (root pages pinned; LRU eviction + priority streaming).
    void EnforcePageResidencyBudget(
        uint32_t                 MaxResidentBytes,
        const ClusterCameraView& Camera,
        uint64_t                 FrameTick);

    // Executes the projected-error DAG antichain cut (with optical IOR boost on curved glass),
    // frustum + backface normal-cone culling (glass exempt), and two-phase Hi-Z pyramid occlusion
    // (glass tests against opaque Hi-Z without writing opaque Hi-Z depth!).
    [[nodiscard]] ClusterRuntimeFrameReport ExecuteGlassAwareCutAndTwoPhaseHiZ(
        const ClusterCameraView& Camera) const;

    // Rasterizes the selected cut into an exact Visibility Buffer + Front/Back Two-Layer Glass Peel!
    void RasterizeVisibilityAndTwoLayerGlassPeel(
        const ClusterCameraView&          Camera,
        const ClusterRuntimeFrameReport&  CutReport,
        std::vector<VisibilityPixelRecord>& OutPixels,
        std::vector<float>&               OutOpaqueHiZMip0) const;

    // Synthesises a 4-panel (Width x Height) RGBA8 diagnostic showcase:
    //   [Top-Left]     Cluster Visibility IDs (pastel per-cluster hash + cyan glass overlay)
    //   [Top-Right]    Live Screen-Space Tier Cut Heatmap (finest Tier 0 warm red -> coarsest cool blue; curved glass refined!)
    //   [Bottom-Left]  Hi-Z Occlusion & Two-Layer Glass Peel (green front glass, yellow 2-layer glass, un-culled objects behind!)
    //   [Bottom-Right] Deferred UV-Checker + Two-Layer Snell Refraction & Beer-Lambert Glass Absorption Resolve!
    void RenderFourPanelDiagnosticRgba8(
        const ClusterCameraView& Camera,
        std::vector<uint8_t>&    OutRgba8Pixels) const;

    [[nodiscard]] const ClusterTierSequence&                  TierSequence() const noexcept { return Sequence_; }
    [[nodiscard]] const std::vector<GlassAwareClusterRecord>& ClusterRecords() const noexcept { return Records_; }
    [[nodiscard]] const std::vector<ClusterStreamingPage>&    StreamingPages() const noexcept { return Pages_; }
    [[nodiscard]] const ClusterMaterialProfile&               FindMaterial(uint32_t ClassificationId) const noexcept;

private:
    std::vector<ClusterMaterialProfile>  Materials_;
    ClusterMaterialProfile               DefaultMaterial_{};
    ClusterTierSequence                  Sequence_{};
    std::vector<GlassAwareClusterRecord> Records_;
    std::vector<std::vector<uint32_t>>   TierClusterToGlobal_;
    std::vector<ClusterStreamingPage>    Pages_;
};

} // namespace Frontier
