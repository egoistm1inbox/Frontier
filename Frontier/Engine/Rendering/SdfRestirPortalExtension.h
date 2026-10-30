/*==========================================================================================================================================
                                                 SDFRESTIRPORTALEXTENSION.H
==========================================================================================================================================*/
// 🧩 Dual-tier GI & reflections:
//    - GTX / Non-RTX Tier (SignedDistanceFieldGtx): SDF + OrientedSurfaceCard ReSTIR GI + Software BVH Triangle Reflections!
//    - RTX Tier (HardwareRayTracingRtx): Full Hardware RT RayQuery for BOTH ReSTIR GI AND Reflections/Shadows/Glass!
//    Includes Planar Mirrors, Seamless Portals, Closed-Dielectric Glass, Solid-Angle Area Luminaires, Spatial Reuse +
//    Edge-Stopping A-Trous Denoising, HDR Mie/Airy Bloom, and Full Celestial/Cloud/Fog/PlumeFluid Coupling.

#pragma once

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             INCLUDES
------------------------------------------------------------------------------------------------------------------------------------------*/
#include "Engine/Environment/CelestialPlanetaryExtension.h"
#include "Engine/Environment/LightningThunderExtension.h"
#include "Engine/Environment/SnowpackAccumulationExtension.h"
#include "Engine/Fluid/PlumeFluidExtension.h"
#include "Engine/Fluid/ShallowWaterMudExtension.h"
#include "Engine/Foundation/Math.h"
#include "Engine/Physics/Sparks/BallisticSparkExtension.h"
#include "Engine/Rendering/AtmosphereModel.h"
#include "Engine/Rendering/CloudField.h"
#include "Engine/Rendering/DistanceField.h"
#include "Engine/Rendering/FogMedium.h"
#include "Engine/Rendering/LensFlareModel.h"

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
    SignedDistanceFieldGtx = 0u, // GTX / Non-RTX: SDF + SurfaceCard ReSTIR GI + Software BVH Triangle Reflections
    HardwareRayTracingRtx  = 1u  // RTX Hardware RT Cores: Full Raytracing for BOTH ReSTIR GI and Reflections/Shadows
};

// 6-face oriented Surface Card entry capturing albedo & direct+emissive exitant radiance for GTX SDF ReSTIR GI!
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
    float    Roughness           = 0.65f;
    uint32_t CardOrMaterialIndex = 0u;
    float    Metallic            = 0.0f;
    bool     TransmissiveGlass   = false;
    float    RefractiveIndexIor  = 1.52f;
    Vec3     SpectralAbsorption  = {0.10f, 0.03f, 0.05f}; // [1/m] - Beer-Lambert internal absorption
    bool     SmoothVertexNormals     = false;
    Vec3     V0Normal{};
    Vec3     V1Normal{};
    Vec3     V2Normal{};
    bool     ProceduralMineralDetail = false;
    bool     SnowSubsurfaceScatter   = false;
};

struct BvhFlatBoundsRecord
{
    Vec3     BoundsMin{};
    Vec3     BoundsMax{};
    uint32_t LeftOrFirstTriangle = 0u;
    uint32_t RightBranchIndex    = 0u;
    uint32_t TriangleCount       = 0u; // > 0 => leaf, 0 => internal split (Left = LeftOrFirstTriangle, Right = RightBranchIndex)
};

/*------------------------------------------------------------------------------------------------------------------------------------------
                                        SOLID-ANGLE AREA LUMINAIRES, MIRRORS & PORTALS
------------------------------------------------------------------------------------------------------------------------------------------*/
struct AreaLuminaireDescriptor
{
    Vec3  CentreWorld{};
    Vec3  RightAxis{1.0f, 0.0f, 0.0f};
    Vec3  UpAxis{0.0f, 0.0f, 1.0f};
    Vec3  FrontNormal{0.0f, -1.0f, 0.0f};
    float HalfWidthMetres  = 0.6f;
    float HalfHeightMetres = 0.25f;
    Vec3  EmissiveRadianceRgb{12.0f, 10.0f, 8.0f}; // [W/(sr*m^2)] - Surface radiance
    bool  TwoSided        = false;
    bool  RegisterGeometry = true;                 // Automatically adds visible glowing luminaire quad to BVH
};

struct PlanarMirrorAperture
{
    Vec3  CentreWorld{};
    Vec3  RightAxis{1.0f, 0.0f, 0.0f};          // [unit] - Mirror horizontal tangent
    Vec3  UpAxis{0.0f, 0.0f, 1.0f};             // [unit] - Mirror vertical tangent
    Vec3  FrontNormal{0.0f, -1.0f, 0.0f};       // [unit] - Reflective front normal
    float HalfWidthMetres  = 2.0f;              // [m] - Aperture half-width
    float HalfHeightMetres = 1.5f;              // [m] - Aperture half-height
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
    Vec3  PortalRimGlowRgb{0.18f, 0.62f, 1.15f};
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
    uint32_t SdfGiQueries       = 0u; // Non-zero ONLY on GTX SDF GI tier
    uint32_t RtxGiQueries       = 0u; // Non-zero ONLY on RTX Hardware RayQuery GI tier
};

/*------------------------------------------------------------------------------------------------------------------------------------------
                                             COUPLED WORLD ENVIRONMENT DESCRIPTOR
------------------------------------------------------------------------------------------------------------------------------------------*/
struct CoupledWorldOpticalContext
{
    AtmosphereParameters               Atmosphere{};
    const TransmittanceLut*            AtmosphereLut      = nullptr;
    CloudParameters                    Clouds{};
    FogParameters                      Fog{};
    Vec3                               SunDirectionUnit          = {0.38f, -0.45f, 0.81f};
    Vec3                               SunIrradianceRgb          = {14.0f, 13.4f, 12.6f};
    Vec3 CelestialSunDirectionUnit = {0.0f, 0.0f, 0.0f}; // Optional exoatmospheric sun dir for Moon/Planets
    Vec3                               CelestialSunRadianceRgb   = {14.8f, 14.2f, 13.5f};
    const PlumeFluidExtension*         PlumeFluid                = nullptr;
    const ShallowWaterMudExtension*    ShallowWater       = nullptr;
    const LightningThunderExtension*   Lightning          = nullptr;
    const BallisticSparkExtension*     Sparks             = nullptr;
    const CelestialPlanetaryExtension* CelestialSky       = nullptr;
    uint32_t                           MaxApertureBounces           = 4u;
    uint32_t                           RestirCandidateK             = 8u;
    bool                               EnableSpatialReuse           = true;
    bool                               EnableWaveletFilter          = true;
    bool                               EnableSolarLensFlare         = false;
    float                              WaterCapillaryRippleStrength = 0.012f;
    SunDiscProfile                     SolarDisc{};
    FlareOpticsProfile                 LensFlareOptics{};
    float                              HdrBloomStrength             = 0.24f;
    float                              ExposureScale                = 0.82f;
};

struct TracedRayDiagnostics
{
    bool     HitSolidGeometry            = false;
    bool     HitWaterSurface             = false;
    bool     HitDielectricGlass          = false;
    uint32_t MirrorReflections           = 0u;
    uint32_t PortalTransitions           = 0u;
    uint32_t BvhTriangleReflectionRays   = 0u; // BVH triangle reflection/glass/mirror/water rays (active on BOTH GTX and RTX!)
    uint32_t SdfGiRays                   = 0u; // SDF + SurfaceCard GI rays (active ONLY on GTX!)
    uint32_t RtxTriangleGiRays           = 0u; // Hardware RT triangle GI rays (active ONLY on RTX!)
    float    PlumeOpticalOpacity         = 0.0f;
    float    CloudReflectionLuminance    = 0.0f;
    float    CelestialLuminance          = 0.0f;
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

    // Registers a solid box into BOTH the GTX SDF scene + SurfaceCardAtlas AND the triangle BVH!
    uint32_t RegisterDualTierSolidBox(
        Vec3  CentreWorld,
        Vec3  HalfExtents,
        Vec3  AlbedoRgb,
        float Roughness   = 0.65f,
        Vec3  EmissiveRgb = {0.0f, 0.0f, 0.0f},
        float Metallic    = 0.0f);

    // Registers a ground/plaza slab with anti-aliased multi-octave mineral stone/asphalt micro-aggregate detail!
    uint32_t RegisterTexturedGroundSlab(
        Vec3  CentreWorld,
        Vec3  HalfExtents,
        Vec3  BaseAlbedoRgb,
        float BaseRoughness = 0.46f,
        float Metallic      = 0.04f);

    // Registers a smooth-normal, subsurface-scattering contiguous SnowpackPolygonSurface!
    void RegisterSmoothSnowSurface(const SnowpackPolygonSurface& Surface);

    // Clips a triangle against half-spacedot(P - PlanePoint, PlaneKeepNormal) >= 0 and registers surviving sub-triangles!
    void RegisterHalfSpaceClippedTriangle(
        const RtxSceneTriangle& Triangle,
        Vec3                    PlanePoint,
        Vec3                    PlaneKeepNormal);

    // Registers a triangle of an object straddling a Portal: keeps ONLY the entering side in front of Entry,
    // hides everything behind Entry, and places ONLY the emerging side in front of Exit!
    void RegisterPortalTransitingTriangle(
        const RtxSceneTriangle&       EntryWorldTriangle,
        const SeamlessPortalAperture& Portal);

    static Vec3 TransformPointAcrossPortal(
        const SeamlessPortalAperture& Portal,
        Vec3                          WorldPoint) noexcept;

    static Vec3 TransformVectorAcrossPortal(
        const SeamlessPortalAperture& Portal,
        Vec3                          WorldVector) noexcept;

    // Registers a smooth UV-tessellated sphere (opaque/metallic OR closed refractive dielectric glass)!
    void RegisterSmoothSphere(
        Vec3  CentreWorld,
        float RadiusMetres,
        Vec3  AlbedoRgb,
        float Roughness          = 0.08f,
        float Metallic           = 0.0f,
        bool  TransmissiveGlass  = false,
        float RefractiveIndexIor = 1.52f,
        Vec3  SpectralAbsorption = {0.14f, 0.04f, 0.06f},
        uint32_t LongitudeSlices = 28u,
        uint32_t LatitudeStacks  = 18u);

    // Registers a solid-angle rectangular Area Luminaire (noiseless NEE + Karis specular + emissive geometry)!
    void RegisterAreaLuminaire(const AreaLuminaireDescriptor& Luminaire);

    // Registers an arbitrary triangle surface (SnowpackPolygonSurface, Glass-Aware Cluster Cut, Fracture hulls)!
    void RegisterPolygonTriangle(const RtxSceneTriangle& Triangle);

    void RegisterPlanarMirror(const PlanarMirrorAperture& Mirror);
    void RegisterSeamlessPortal(const SeamlessPortalAperture& Portal);

    // Builds binned-median O(log N) triangle BVH (used by GTX reflections AND full RTX) and bakes GTX SurfaceCards!
    void FinalizeSceneAndBakeSurfaceCards(const CoupledWorldOpticalContext& Context);

    static void TransformRayAcrossPortal(
        const SeamlessPortalAperture& Portal,
        Vec3                          HitPointOnEntry,
        Vec3                          IncomingDirectionUnit,
        Vec3&                         OutTeleportedOrigin,
        Vec3&                         OutTeleportedDirection) noexcept;

    // Evaluates coupled radiance along (Origin, Direction):
    //   - GTX (SignedDistanceFieldGtx): Triangle BVH for Primary/Reflections/Mirrors/Portals/Glass + SDF & SurfaceCards for GI!
    //   - RTX (HardwareRayTracingRtx):  Triangle BVH / Hardware RayQuery for Primary, Shadows, GI, Reflections, Portals & Glass!
    [[nodiscard]] TracedRayDiagnostics TraceCoupledRadianceRay(
        GpuTracingTier                    Tier,
        Vec3                              RayOriginWorld,
        Vec3                              RayDirectionUnit,
        const CoupledWorldOpticalContext& Context,
        uint64_t                          PixelRandomSeed = 0x123456789ABCDEF0ull) const noexcept;

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

    // Production viewport renderer with Screen-Space Spatial Reservoir Reuse, 3-Step Edge-Stopping A-Trous Wavelet
    // Denoising, Glossy BVH/RT Reflections, Multi-Scale HDR Mie/Airy Bloom, and Chromatic-Preserving AgX/ACES Tonemap!
    void RenderViewportRgba8(
        GpuTracingTier                    Tier,
        uint32_t                          Width,
        uint32_t                          Height,
        Vec3                              CameraOriginWorld,
        Vec3                              CameraTargetWorld,
        float                             VerticalFovRadians,
        const CoupledWorldOpticalContext& Context,
        std::vector<uint8_t>&             OutRgba8Pixels) const;

    [[nodiscard]] const DistanceFieldScene&                   SdfScene() const noexcept { return SdfScene_; }
    [[nodiscard]] const std::vector<OrientedSurfaceCard>&     SurfaceCards() const noexcept { return SurfaceCards_; }
    [[nodiscard]] const std::vector<RtxSceneTriangle>&        RtxTriangles() const noexcept { return Triangles_; }
    [[nodiscard]] const std::vector<AreaLuminaireDescriptor>& AreaLuminaires() const noexcept { return Luminaires_; }
    [[nodiscard]] const std::vector<PlanarMirrorAperture>&    Mirrors() const noexcept { return Mirrors_; }
    [[nodiscard]] const std::vector<SeamlessPortalAperture>&  Portals() const noexcept { return Portals_; }

private:
    struct InternalSurfaceHit
    {
        bool     Hit                = false;
        float    DistanceM          = 1.0e9f;
        Vec3     Position{};
        Vec3     Normal{};          // Front-facing shading normal
        Vec3     GeometricOutward{}; // Outward geometric/vertex normal (determines glass entry vs exit!)
        Vec3     AlbedoRgb{};
        Vec3     EmissiveRgb{};
        float    Roughness          = 0.65f;
        float    Metallic           = 0.0f;
        bool     TransmissiveGlass     = false;
        bool     SnowSubsurfaceScatter = false;
        float    RefractiveIndexIor    = 1.52f;
        Vec3     SpectralAbsorption    = {0.10f, 0.03f, 0.05f};
        uint32_t CardIndex             = UINT32_MAX;
    };

    [[nodiscard]] bool IntersectShallowWaterSurface(
        Vec3                              Origin,
        Vec3                              DirectionUnit,
        float                             MaxDistanceM,
        const CoupledWorldOpticalContext& Context,
        float&                            OutHitDistanceM,
        Vec3&                             OutWaterHitWorld,
        SurfaceFluidSample&               OutSample) const noexcept;

    [[nodiscard]] double EvaluateSolarFlareVisibility(
        Vec3                              CameraOriginWorld,
        Vec3                              SunDirectionUnit,
        const CoupledWorldOpticalContext& Context) const noexcept;

    uint32_t BuildBvhRecursive(uint32_t StartTri, uint32_t TriCount);

    // Sphere-traces SDF + SurfaceCards (exclusively used by GTX Diffuse ReSTIR GI & GTX Card Radiosity!)
    [[nodiscard]] InternalSurfaceHit TraceSdfSurfaceCards(
        Vec3  Origin,
        Vec3  DirectionUnit,
        float MaxDistanceM) const noexcept;

    // Near-first ordered BVH + Moller-Trumbore triangle ray-tracer (used by GTX BVH Reflections AND full RTX!)
    [[nodiscard]] InternalSurfaceHit TraceTriangleBvh(
        Vec3  Origin,
        Vec3  DirectionUnit,
        float MaxDistanceM,
        bool  IgnoreTransmissiveGlass = false) const noexcept;

    [[nodiscard]] bool TraceShadowUnoccluded(
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
        float&                            OutCloudLuminance,
        float&                            OutCelestialLuminance) const noexcept;

    [[nodiscard]] Vec3 EvaluateDirectSurfaceLighting(
        GpuTracingTier                    Tier,
        Vec3                              Point,
        Vec3                              Normal,
        Vec3                              ViewDirUnit,
        Vec3                              Albedo,
        float                             Roughness,
        float                             Metallic,
        const CoupledWorldOpticalContext& Context,
        bool                              SnowSubsurface = false) const noexcept;

    DistanceFieldScene                   SdfScene_{};
    std::vector<uint32_t>                SdfPrimitiveToCard_;
    std::vector<OrientedSurfaceCard>     SurfaceCards_;
    std::vector<RtxSceneTriangle>        Triangles_;
    std::vector<BvhFlatBoundsRecord>     BvhRecords_;
    std::vector<AreaLuminaireDescriptor> Luminaires_;
    std::vector<PlanarMirrorAperture>    Mirrors_;
    std::vector<SeamlessPortalAperture>  Portals_;
};

} // namespace Frontier
