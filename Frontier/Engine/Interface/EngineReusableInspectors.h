/*==========================================================================================================================================
                                                      ENGINEREUSABLEINSPECTORS.H
==========================================================================================================================================*/
// 🧩 Built-in reusable 1:1 inspectors for standard engine items (Sun, Sky, Clouds, Fog, Wind, Render, BVH/SDF, Surface Cache).

#pragma once

#include "Engine/Scene/InspectorCatalogue.h"

#include <cstddef>
#include <cstdint>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                             REUSABLE ENGINE PARAMETERS
//------------------------------------------------------------------------------------------------------------------------

struct EngineRenderParameters
{
    // Dual-tier GPU architecture (0 = RTX VK_KHR_ray_query ReSTIR Path Tracer, 1 = GTX Toroidal SDF GI + SAH-2 BVH Reflections)
    size_t   ArchitectureTierIndex       = 0;     // [-] - 0 RTX hardware ray query, 1 GTX SDF + BVH fallback
    bool     ClusteredGeometryEnabled    = true;  // [-] - 128-triangle lossless spatial clusters
    float    MaxPathBounces              = 3.0f;  // [bounces] - GI path bounce ceiling
    float    ReflectionBounces           = 2.0f;  // [bounces] - Specular bounce ceiling
    float    InitialRisCandidates        = 4.0f;  // [samples] - Initial RIS candidates (M)
    bool     RayTracedShadowsEnabled     = true;  // [-] - Exact BVH sun/lamp cone shadows
    bool     RayTracedReflectionsEnabled = true;  // [-] - GGX VNDF & mirror BVH reflections
    bool     MultiBounceNeeEnabled       = true;  // [-] - Secondary vertex NEE + RIS
    bool     RussianRouletteEnabled      = true;  // [-] - Unbiased throughput continuation
    bool     FireflySuppressionEnabled   = true;  // [-] - Jacobian + luminance outlier clamp; 0.0001 target floor
    bool     GlossyReflectionsEnabled    = true;  // [-] - Reflections composite enabled
    float    ReflectionScale             = 1.00f; // [x] - Specular intensity multiplier
    float    ReflectionRoughnessCutoff   = 0.80f; // [-] - Roughness threshold
    size_t   QualityGradeIndex           = 2;     // [-] - 0 Low, 1 Medium, 2 High
    size_t   TraceScaleIndex             = 0;     // [-] - 0 Full, 1 Half, 2 Quarter
    float    RenderScale                 = 1.00f; // [x] - Internal target scale
    bool     TemporalReuseEnabled        = true;  // [-] - Motion-guided reservoir carry
    bool     SpatialReuseEnabled         = true;  // [-] - Neighbour reservoir merge
    bool     VisibilityValidationEnabled = true;  // [-] - Re-traced occlusion validation
    bool     RadianceRefreshEnabled      = true;  // [-] - Reused sample radiance refresh
    float    SpatialCandidates           = 5.0f;  // [samples] - Spatial reuse count
    float    SpatialRadiusPixels         = 24.0f; // [px] - Spatial gather radius
    float    TemporalTallyLimit          = 20.0f; // [M] - Temporal history cap
    float    IndirectScale               = 1.00f; // [x] - Indirect radiance multiplier
    bool     AutoExposureEnabled         = true;  // [-] - Histogram auto-exposure
    float    ExposureCompensationEv      = 0.0f;  // [EV] - Exposure bias
    bool     SvgDenoiserEnabled          = true;  // [-] - Spatio-temporal SVGF filter
    bool     TemporalAntialiasEnabled    = true;  // [-] - TAA + tyre mark resolve
    size_t   InspectionModeIndex         = 0;     // [-] - 15-mode viewport inspection channel
    size_t   DistanceViewIndex           = 0;     // [-] - SDF / BVH diagnostic view
    bool     ReadoutOverlayVisible       = true;  // [-] - Viewport #hud overlay (H)
    bool     DistanceSliceInsetEnabled   = true;  // [-] - Viewport #overlay-dock SDF slice (I)
    float    SliceHeightMetres           = 0.85f; // [m] - World height of SDF diagnostic slice
    bool     FreezeDistanceUpdates       = false; // [-] - Freeze toroidal brick updates
    bool     CardRadiosityEnabled        = true;  // [-] - Multi-bounce inside surface cache
    float    CardStaticTileBudget        = 2048.0f;// [tiles/s] - Per-tick card relight budget

    // Live telemetry figures fed by renderer / simulation
    uint32_t ClusterCandidates           = 1482u; // [clusters] - 128-tri spatial clusters
    uint32_t ActiveTlasInstances         = 186u;  // [instances] - Scene occupants in TLAS
    uint32_t TotalTriangles              = 412860u;// [triangles] - Indexed triangle count
    uint32_t ToroidalBricks              = 12288u;// [bricks] - Resident SDF bricks
    uint32_t ScheduledCardTiles          = 1536u; // [tiles] - Surface cache tiles relit
    float    FrameDurationMilliseconds   = 6.94f; // [ms] - Frame wall duration
    float    OnePercentLowFps            = 124.0f;// [fps] - 1% low rate
};

struct EngineEnvironmentParameters
{
    size_t   LightingPresetIndex         = 0;      // [-] - 0 Clear, 1 Golden hour, 2 Overcast, 3 Night
    bool     SunShadowsEnabled           = true;   // [-] - Property switch: Shadows
    bool     SolarSpotEnabled            = true;   // [-] - Property switch: Spot
    bool     SolarDiscEnabled            = true;   // [-] - Property switch: Disc
    bool     AtmosphericHazeEnabled      = true;   // [-] - Property switch: Haze
    bool     AerialPerspectiveEnabled    = true;   // [-] - Property switch: Aerial
    float    SunElevationDegrees         = 26.5f;  // [deg] - Solar elevation (-90..90)
    float    SunAzimuthDegrees           = -42.0f; // [deg] - Solar azimuth (-180..180)
    float    SunAngularRadiusDegrees     = 0.27f;  // [deg] - Solar disc half-angle
    float    SunTemperatureKelvin        = 5650.0f;// [K] - Blackbody CCT
    float    SolarIlluminance            = 14.5f;  // [lx scale] - Direct sun scalar
    float    SkyIntensityScale           = 1.00f;  // [x] - Hemispheric sky scalar
    float    EmitterScale                = 1.25f;  // [x] - Lamps, strips & flames scalar
    bool     ClusterBitmaskCullEnabled   = true;   // [-] - 16x16x4 64-bit light grid
    uint32_t ActiveClusterLights         = 44u;    // [lights] - Point + IES street + vehicle beams

    // Atmosphere & Aerial Perspective (Observatory capsule sliders)
    float    RayleighScatteringScale     = 1.00f;  // [x] - Molecular Rayleigh cross-section
    float    MieTurbidity                = 2.15f;  // [-] - Aerosol turbidity
    float    MieAnisotropyG              = 0.80f;  // [-] - Cornette-Shanks phase g
    float    OzoneAbsorptionScale        = 1.00f;  // [x] - Chappuis band ozone absorption
    float    MultiScatteringFactor       = 1.00f;  // [x] - Multiple scattering LUT weight

    // Volumetric Clouds & Local Cloud
    float    CloudCoverage               = 0.42f;  // [-] - Macro cloud coverage fraction
    float    CloudBaseKilometres         = 1.65f;  // [km] - Stratus/cumulus base altitude
    float    CloudThicknessKilometres    = 2.40f;  // [km] - Vertical layer thickness
    float    CloudSilverLining           = 0.72f;  // [-] - Forward lobe silver-lining boost
    float    LocalCloudDensity           = 0.55f;  // [-] - Local volume density

    // Fog, Celestial, Lens Flare & Forcefield Wind
    float    HeightFogDensity            = 0.018f; // [1/m] - Base exponential extinction
    float    HeightFogFalloff            = 0.14f;  // [1/m] - Altitude decay exponent
    float    VolumetricFogScattering     = 0.65f;  // [-] - Froxel single-scatter albedo
    float    StarMagnitudeLimit          = 5.8f;   // [mag] - Sidereal visibility ceiling
    float    LunarPhase                  = 0.68f;  // [-] - Waxing gibbous illumination
    float    LensFlareIntensity          = 0.45f;  // [x] - Aperture ghost gain
    float    LightningFrequency          = 0.0f;   // [1/min] - Storm discharge rate
    float    WindSpeedMetresPerSecond    = 4.8f;   // [m/s] - Ambient wind speed
    float    WindHeadingDegrees          = 32.0f;  // [deg] - Ambient wind heading
    float    WindGustStrength            = 0.35f;  // [-] - Gust envelope modulation
};

struct EngineSpatialParameters
{
    float CoordinatesMetres[3] = {0.0f, 0.0f, 0.0f}; // [m] - World X, Y, Z position
    bool  FocusRequested       = false;              // [-] - Frame-target trigger
};

struct EngineReusableInspectorContext
{
    EngineRenderParameters      *Render      = nullptr; // [-] - Shared render configuration
    EngineEnvironmentParameters *Environment = nullptr; // [-] - Shared atmosphere/sun/fog configuration
    EngineSpatialParameters     *Spatial     = nullptr; // [-] - Optional per-record spatial coordinates
    DedicatedStudioDomain       *OpenStudio  = nullptr; // [-] - Receives studio-open requests from cards
};

[[nodiscard]] const char *const *QueryEverestInspectionModes(size_t &OutCount) noexcept;
void ApplyEnvironmentLightingPreset(EngineEnvironmentParameters &Environment, size_t PresetIndex) noexcept;

#if defined(FRONTIER_WITH_INTERFACE_SDK)
// Renders the complete scrollable body of any EngineReusable inspector domain. Returns consumed pixel height.
float ConstructEngineReusableInspectorBody(EngineInspectorDomain Domain, uint32_t AccentRgb, float OriginX,
                                           float OriginY, float Width, const EngineReusableInspectorContext &Context);
#endif

} // namespace Frontier
