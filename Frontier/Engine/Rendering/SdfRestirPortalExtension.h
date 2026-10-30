/*==========================================================================================================================================
                                                 SDFRESTIRPORTALEXTENSION.H
==========================================================================================================================================*/
// 🧩 Dual-tier GI & reflections: GTX SDF ReSTIR + SurfaceCards and RTX BVH ReSTIR, with Portals, Mirrors & full volumetrics.

#pragma once

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             INCLUDES
------------------------------------------------------------------------------------------------------------------------------------------*/
#include "Engine/Environment/LightningThunderExtension.h"
#include "Engine/Fluid/PlumeFluidExtension.h"
#include "Engine/Fluid/ShallowWaterMudExtension.h"
#include "Engine/Foundation/Math.h"
#include "Engine/Physics/Sparks/BallisticSparkExtension.h"
#include "Engine/Rendering/AtmosphereModel.h"
#include "Engine/Rendering/CloudField.h"
#include "Engine/Rendering/DistanceField.h"
#include "Engine/Rendering/FogMedium.h"

#include <array>
#include <cstdint>
#include <vector>

namespace Frontier
{
/*------------------------------------------------------------------------------------------------------------------------------------------
                                             DUAL HARDWARE TIER & SURFACE CARD ATLAS
------------------------------------------------------------------------------------------------------------------------------------------*/
enum class GpuTracingTier : uint8_t
{
    SignedDistanceFieldGtx = 0u, // Low-end non-RTX GPUs: sphere-traced SDF + SurfaceCards + SDF ReSTIR
    HardwareRayTracingRtx  = 1u  // RTX / RayQuery GPUs: exact BVH triangle ray-tracing + Raytraced ReSTIR
};

// 6-face oriented Surface Card entry capturing albedo & direct+emissive exitant radiance for GTX SDF ReSTIR!
struct OrientedSurfaceCard
{
    Vec3                  CentreWorld{};
    Vec3                  HalfExtents{1.0f, 1.0f, 1.0f};
    Vec3                  AlbedoRgb{0.65f, 0.65f, 0.65f};
    Vec3                  EmissiveRadianceRgb{0.0f, 0.0f, 0.0f};
    float                 Roughness = 0.65f;
    float                 Metallic  = 0.0f;
    std::array<Vec3, 6u>  FaceIrradianceCache{}; // [+X, -X, +Y, -Y, +Z, -Z] cached exitant radiance [W/(sr*m^2)]
};

struct RtxSceneTriangle
{
    Vec3     V0{};
    Vec3     V1{};
    Vec3     V2{};
    Vec3     Normal{};
    Vec3     AlbedoRgb{0.65f, 0.65f, 0.65f};
    Vec3     EmissiveRgb{0.0f, 0.0f, 0.0f};
    float    Roughness = 0.65f;
    uint32_t CardOrMaterialIndex = 0u;
};

struct BvhFlatBoundsRecord
{
    Vec3     BoundsMin{};
    Vec3     BoundsMax{};
    uint32_t LeftOrFirstTriangle = 0u;
    uint32_t RightBranchIndex     = 0u;
    uint32_t TriangleCount       = 0u; // > 0 => leaf, 0 => internal split (Left = LeftOrFirstTriangle, Right = RightBranchIndex)
};

/*------------------------------------------------------------------------------------------------------------------------------------------
                                               PLANAR MIRRORS & SEAMLESS PORTALS
------------------------------------------------------------------------------------------------------------------------------------------*/
struct PlanarMirrorAperture
{
    Vec3  CentreWorld{};
    Vec3  RightAxis{1.0f, 0.0f, 0.0f};   // [unit] - Mirror horizontal tangent
    Vec3  UpAxis{0.0f, 0.0f, 1.0f};      // [unit] - Mirror vertical tangent
    Vec3  FrontNormal{0.0f, -1.0f, 0.0f};// [unit] - Reflective front normal
    float HalfWidthMetres  = 2.0f;       // [m] - Aperture half-width
    float HalfHeightMetres = 1.5f;       // [m] - Aperture half-height
    Vec3  ReflectanceTint{0.96f, 0.97f, 0.98f}; // [-] - Silvered mirror Fresnel tint
    Vec3  FrameTintRgb{0.12f, 0.13f, 0.15f};    // [-] - Thin bezel border colour
};

struct SeamlessPortalAperture
{
    Vec3  EntryCentreWorld{};
    Vec3  EntryRightAxis{1.0f, 0.0f, 0.0f};
    Vec3  EntryUpAxis{0.0f, 0.0f, 1.0f};
    Vec3  EntryFrontNormal{0.0f, -1.0f, 0.0f};

    Vec3  ExitCentreWorld{};
    Vec3  ExitRightAxis{1.0f, 0.0f, 0.0f};
    Vec3  ExitUpAxis{0.0f, 0.0f, 1.0f};
    Vec3  ExitFrontNormal{0.0f, 1.0f, 0.0f};

    float HalfWidthMetres  = 1.8f;
    float HalfHeightMetres = 1.6f;
    Vec3  PortalRimGlowRgb{0.18f, 0.62f, 1.15f}; // Subtle diagnostic rim border around aperture frame
};

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                  RESTIR GI RESERVOIR RECORD
------------------------------------------------------------------------------------------------------------------------------------------*/
struct DualTierGiReservoir
{
    Vec3     SamplePositionWorld{}; // [m] - Secondary hit surface position (or teleported portal world pos)
    Vec3     SampleNormalWorld{};   // [unit] - Secondary hit surface normal
    Vec3     SampleRadianceRgb{};   // [W/(sr*m^2)] - Outgoing radiance at secondary hit
    float    WeightSum          = 0.0f;
    float    TargetPdf          = 0.0f;
    float    IntegrationWeightW = 0.0f;
    uint32_t SampleCountM       = 0u;
};

/*------------------------------------------------------------------------------------------------------------------------------------------
                                             COUPLED WORLD ENVIRONMENT DESCRIPTOR
------------------------------------------------------------------------------------------------------------------------------------------*/
struct CoupledWorldOpticalContext
{
    AtmosphereParameters             Atmosphere{};
    const TransmittanceLut*          AtmosphereLut      = nullptr;
    CloudParameters                  Clouds{};
    FogParameters                    Fog{};
    Vec3                             SunDirectionUnit   = {0.38f, -0.45f, 0.81f};
    Vec3                             SunIrradianceRgb   = {14.0f, 13.4f, 12.6f};
    const PlumeFluidExtension*       PlumeFluid         = nullptr;
    const ShallowWaterMudExtension*  ShallowWater       = nullptr;
    const LightningThunderExtension* Lightning          = nullptr;
    const BallisticSparkExtension*   Sparks             = nullptr;
    uint32_t                         MaxApertureBounces = 3u;
    uint32_t                         RestirCandidateK   = 6u;
};

struct TracedRayDiagnostics
{
    bool     HitSolidGeometry       = false;
    bool     HitWaterSurface        = false;
    uint32_t MirrorReflections      = 0u;
    uint32_t PortalTransitions      = 0u;
    float    PlumeOpticalOpacity    = 0.0f;
    float    CloudReflectionLuminance = 0.0f;
    Vec3     FinalRadianceRgb{};
};

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                SDF & RTX RESTIR PORTAL EXTENSION
------------------------------------------------------------------------------------------------------------------------------------------*/
class SdfRestirPortalExtension
{
public:
    SdfRestirPortalExtension() = default;

    void ClearScene() noexcept;

    // Registers a solid box into BOTH the GTX SDF scene + SurfaceCardAtlas AND the RTX triangle BVH!
    uint32_t RegisterDualTierSolidBox(
        Vec3  CentreWorld,
        Vec3  HalfExtents,
        Vec3  AlbedoRgb,
        float Roughness   = 0.65f,
        Vec3  EmissiveRgb = {0.0f, 0.0f, 0.0f});

    // Registers an arbitrary triangle surface (such as SnowpackPolygonSurface or convex fracture fragments) for RTX + SDF bounds!
    void RegisterPolygonTriangle(const RtxSceneTriangle& Triangle);

    void RegisterPlanarMirror(const PlanarMirrorAperture& Mirror);
    void RegisterSeamlessPortal(const SeamlessPortalAperture& Portal);

    // Builds RTX flat bounding-volume tree and bakes direct sun/plume/spark/lightning irradiance into GTX SurfaceCards!
    void FinalizeSceneAndBakeSurfaceCards(const CoupledWorldOpticalContext& Context);

    // Transforms an arbitrary ray across Portal's entry aperture into its exit aperture frame!
    static void TransformRayAcrossPortal(
        const SeamlessPortalAperture& Portal,
        Vec3                          HitPointOnEntry,
        Vec3                          IncomingDirectionUnit,
        Vec3&                         OutTeleportedOrigin,
        Vec3&                         OutTeleportedDirection) noexcept;

    // Evaluates full radiance along (Origin, Direction) in the chosen GPU tier (SignedDistanceFieldGtx OR HardwareRayTracingRtx),
    // recursing seamlessly through Planar Mirrors, Portals, and 2.5D Water Reflections while integrating Volumetric Clouds,
    // Atmosphere, Height Fog, PlumeFluid Smoke/Fire, Plume Shadows, Fire Illumination, Sparks, and ReSTIR GI!
    [[nodiscard]] TracedRayDiagnostics TraceCoupledRadianceRay(
        GpuTracingTier                    Tier,
        Vec3                              RayOriginWorld,
        Vec3                              RayDirectionUnit,
        const CoupledWorldOpticalContext& Context,
        uint64_t                          PixelRandomSeed = 0x123456789ABCDEF0ull) const noexcept;

    // Evaluates 1-bounce ReSTIR GI reservoir (RIS + M-clamping) + optional spatial neighbor merge!
    [[nodiscard]] DualTierGiReservoir SampleRestirIndirectReservoir(
        GpuTracingTier                    Tier,
        Vec3                              ShadingPointWorld,
        Vec3                              ShadingNormalUnit,
        const CoupledWorldOpticalContext& Context,
        uint64_t                          RandomSeed) const noexcept;

    static DualTierGiReservoir MergeSpatialReservoirs(
        const DualTierGiReservoir& Primary,
        const DualTierGiReservoir& Neighbor,
        Vec3                       PrimaryPoint,
        Vec3                       PrimaryNormal,
        uint64_t                   Seed) noexcept;

    // Renders a complete linear-to-sRGB tonemapped RGBA8 frame for either SignedDistanceFieldGtx or HardwareRayTracingRtx!
    void RenderViewportRgba8(
        GpuTracingTier                    Tier,
        uint32_t                          Width,
        uint32_t                          Height,
        Vec3                              CameraOriginWorld,
        Vec3                              CameraTargetWorld,
        float                             VerticalFovRadians,
        const CoupledWorldOpticalContext& Context,
        std::vector<uint8_t>&             OutRgba8Pixels) const;

    [[nodiscard]] const DistanceFieldScene&                  SdfScene() const noexcept { return SdfScene_; }
    [[nodiscard]] const std::vector<OrientedSurfaceCard>&    SurfaceCards() const noexcept { return SurfaceCards_; }
    [[nodiscard]] const std::vector<RtxSceneTriangle>&       RtxTriangles() const noexcept { return Triangles_; }
    [[nodiscard]] const std::vector<PlanarMirrorAperture>&   Mirrors() const noexcept { return Mirrors_; }
    [[nodiscard]] const std::vector<SeamlessPortalAperture>& Portals() const noexcept { return Portals_; }

private:
    struct InternalSurfaceHit
    {
        bool     Hit           = false;
        float    DistanceM     = 1.0e9f;
        Vec3     Position{};
        Vec3     Normal{};
        Vec3     AlbedoRgb{};
        Vec3     EmissiveRgb{};
        float    Roughness     = 0.65f;
        uint32_t CardIndex     = UINT32_MAX;
    };

    [[nodiscard]] InternalSurfaceHit TraceTierSolidGeometry(
        GpuTracingTier Tier,
        Vec3           Origin,
        Vec3           DirectionUnit,
        float          MaxDistanceM) const noexcept;

    [[nodiscard]] bool TraceTierVisibilityShadow(
        GpuTracingTier Tier,
        Vec3           Origin,
        Vec3           DirectionUnit,
        float          MaxDistanceM) const noexcept;

    [[nodiscard]] Vec3 EvaluateVolumetricSegmentAndSky(
        Vec3                              SegmentOrigin,
        Vec3                              SegmentDirectionUnit,
        float                             SegmentLengthM,
        bool                              ReachedInfinitySky,
        const CoupledWorldOpticalContext& Context,
        float&                            OutPlumeOpacity,
        float&                            OutCloudLuminance) const noexcept;

    [[nodiscard]] Vec3 EvaluateDirectSurfaceLighting(
        GpuTracingTier                    Tier,
        Vec3                              Point,
        Vec3                              Normal,
        Vec3                              Albedo,
        const CoupledWorldOpticalContext& Context) const noexcept;

    uint32_t BuildBvhRecursive(uint32_t StartTri, uint32_t TriCount);

    DistanceFieldScene                  SdfScene_{};
    std::vector<uint32_t>               SdfPrimitiveToCard_;
    std::vector<OrientedSurfaceCard>    SurfaceCards_;
    std::vector<RtxSceneTriangle>       Triangles_;
    std::vector<BvhFlatBoundsRecord>    BvhRecords_;
    std::vector<PlanarMirrorAperture>   Mirrors_;
    std::vector<SeamlessPortalAperture> Portals_;
};

} // namespace Frontier
