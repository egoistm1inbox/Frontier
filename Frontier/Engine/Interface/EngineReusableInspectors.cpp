/*==========================================================================================================================================
                                                     ENGINEREUSABLEINSPECTORS.CPP
==========================================================================================================================================*/
// 🧩 Built-in reusable 1:1 inspectors for standard engine items (Sun, Sky, Clouds, Fog, Wind, Render, BVH/SDF, Surface Cache).

#include "EngineReusableInspectors.h"

#if defined(FRONTIER_WITH_INTERFACE_SDK)
#include "EverestInterfaceKit.h"
#endif

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

namespace Frontier
{

namespace
{

constexpr std::array<const char *, 15> InspectionModeCaptions = {
    "Final lit",
    "Direct lighting",
    "Indirect GI (ReSTIR / SDF)",
    "Reflections (BVH / SDF)",
    "Surface cache radiosity",
    "Global distance field",
    "Two-level BVH heatmap",
    "128-tri geometry clusters",
    "Base albedo",
    "World normals",
    "Roughness & metallic",
    "Motion vectors",
    "SVGF variance & history",
    "3D light cluster occupancy",
    "Volumetric plume & fog",
};

constexpr std::array<const char *, 4> DistanceViewCaptions = {
    "Sphere-trace step count",
    "Cascade level tint",
    "Surface normal gradient",
    "Brick occupancy bounds",
};

} // namespace

const char *const *QueryEverestInspectionModes(size_t &OutCount) noexcept
{
    OutCount = InspectionModeCaptions.size();
    return InspectionModeCaptions.data();
}

void ApplyEnvironmentLightingPreset(EngineEnvironmentParameters &Environment, size_t PresetIndex) noexcept
{
    Environment.LightingPresetIndex = std::min<size_t>(PresetIndex, 3);
    switch (Environment.LightingPresetIndex)
    {
        case 0: // Clear
            Environment.SunElevationDegrees  = 26.5f;
            Environment.SunAzimuthDegrees    = -42.0f;
            Environment.SunTemperatureKelvin = 5650.0f;
            Environment.SolarIlluminance     = 14.5f;
            Environment.CloudCoverage        = 0.32f;
            break;
        case 1: // Golden hour
            Environment.SunElevationDegrees  = 6.0f;
            Environment.SunAzimuthDegrees    = -108.0f;
            Environment.SunTemperatureKelvin = 3350.0f;
            Environment.SolarIlluminance     = 8.5f;
            Environment.CloudCoverage        = 0.48f;
            break;
        case 2: // Overcast
            Environment.SunElevationDegrees  = 38.0f;
            Environment.SunAzimuthDegrees    = -18.0f;
            Environment.SunTemperatureKelvin = 6400.0f;
            Environment.SolarIlluminance     = 5.2f;
            Environment.CloudCoverage        = 0.88f;
            break;
        case 3: // Night
            Environment.SunElevationDegrees  = -14.0f;
            Environment.SunAzimuthDegrees    = 128.0f;
            Environment.SunTemperatureKelvin = 4100.0f;
            Environment.SolarIlluminance     = 1.0f;
            Environment.EmitterScale         = 2.10f;
            break;
    }
}

#if defined(FRONTIER_WITH_INTERFACE_SDK)

float ConstructEngineReusableInspectorBody(EngineInspectorDomain Domain, uint32_t AccentRgb, float OriginX,
                                           float OriginY, float Width, const EngineReusableInspectorContext &Context)
{
    ImDrawList                 *Canvas   = ImGui::GetWindowDrawList();
    const KitFaces              Faces    = ResolveKitFaces();
    const EverestSurfaceTokens  Tokens   = ResolveEverestTokens();
    const float                 CardLeft = OriginX + 12.0f;
    const float                 CardW    = std::max(120.0f, Width - 24.0f);
    float                       CursorY  = OriginY + 6.0f;

    EngineRenderParameters      FallbackRender{};
    EngineEnvironmentParameters FallbackEnv{};
    EngineRenderParameters      &Render      = Context.Render != nullptr ? *Context.Render : FallbackRender;
    EngineEnvironmentParameters &Environment = Context.Environment != nullptr ? *Context.Environment : FallbackEnv;

    switch (Domain)
    {
        case EngineInspectorDomain::RenderSettings:
        {
            // Card 00: Clustered geometry
            {
                EverestCardRegion Card = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                          "Clustered geometry", EverestGlyphCategory::Boxes, AccentRgb,
                                                          0);
                ConstructToggleRow(Canvas, Faces, Tokens, Card, "##ClusterCull", "GPU cluster frustum culling",
                                   Render.ClusteredGeometryEnabled);
                ConstructMutedParagraph(
                    Canvas, Faces, Tokens, Card,
                    "Lossless 128-triangle spatial clusters for eligible static surfaces. GPU-written indirect draws.");
                char CandText[32]  = {};
                char BytesText[32] = {};
                std::snprintf(CandText, sizeof(CandText), "%u", Render.ClusterCandidates);
                std::snprintf(BytesText, sizeof(BytesText), "%.1f KiB",
                              static_cast<double>(Render.TotalTriangles * 3u * 4u) / 1024.0);
                const EverestStatisticCell Stats[2] = {{"Cluster candidates", CandText}, {"Index payload", BytesText}};
                ConstructStatisticRow(Canvas, Faces, Tokens, Card, Stats, 2);
                CursorY += EndEverestCard(Canvas, Tokens, Card);
            }
            // Card 01: RTX ReSTIR Path Tracer vs GTX Distance-Field GI + SAH-2 BVH Reflections
            {
                const bool RtxActive   = (Render.ArchitectureTierIndex == 0);
                EverestCardRegion Card = BeginEverestCard(
                    Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                    RtxActive ? "RTX \xC2\xB7 ReSTIR Path Tracer" : "GTX \xC2\xB7 SDF GI + BVH Reflections",
                    EverestGlyphCategory::Zap, AccentRgb, 1);

                char HeroText[64] = {};
                if (RtxActive)
                {
                    std::snprintf(HeroText, sizeof(HeroText), "%.0fB GI \xC2\xB7 %.0fB Refl \xC2\xB7 M=%.0f",
                                  static_cast<double>(Render.MaxPathBounces),
                                  static_cast<double>(Render.ReflectionBounces),
                                  static_cast<double>(Render.InitialRisCandidates));
                }
                else
                {
                    std::snprintf(HeroText, sizeof(HeroText), "SDF GI + BVH");
                }
                ConstructHeroMetric(Canvas, Faces, Tokens, Card, HeroText, "",
                                    RtxActive ? "RTX VK_KHR_ray_query" : "GTX fallback tier", !RtxActive);
                ConstructMutedParagraph(
                    Canvas, Faces, Tokens, Card,
                    RtxActive
                        ? "Hardware VK_KHR_ray_query over TLAS + Binned-SAH BLAS, GPU emissive facet CDF, RIS NEE, MIS "
                          "and 0.0001 ReSTIR target floor."
                        : "GTX fallback: Toroidal SDF cascade GI + multi-bounce Surface Cache radiosity paired with "
                          "16-bin SAH-2 ordered software BVH reflections.");

                const char *TierOptions[2] = {"RTX \xC2\xB7 ReSTIR Path Tracer", "GTX \xC2\xB7 SDF + BVH Fallback"};
                ConstructSegmentedRow(Canvas, Faces, Tokens, Card, "##ArchTier", "Renderer architecture", TierOptions,
                                      2, Render.ArchitectureTierIndex);
                ConstructPrecisionSlider(Canvas, Faces, Tokens, Card, "##GiBounces", "GI path bounces",
                                         Render.MaxPathBounces, 1.0f, 4.0f, "", 0, "1 bounce", "4 bounces");
                ConstructPrecisionSlider(Canvas, Faces, Tokens, Card, "##ReflBounces", "Reflection bounces",
                                         Render.ReflectionBounces, 1.0f, 4.0f, "", 0, "1 bounce", "4 bounces");
                ConstructPrecisionSlider(Canvas, Faces, Tokens, Card, "##RisM", "Initial RIS path candidates",
                                         Render.InitialRisCandidates, 1.0f, 4.0f, "", 0, "Fast", "Low variance");
                ConstructToggleRow(Canvas, Faces, Tokens, Card, "##RtShadows", "Ray-traced direct & IES shadows",
                                   Render.RayTracedShadowsEnabled,
                                   "Blocked-visibility NEE guard across sun cone, lamps & headlights");
                ConstructToggleRow(Canvas, Faces, Tokens, Card, "##RtRefl", "BVH multi-bounce reflections",
                                   Render.RayTracedReflectionsEnabled,
                                   "Hardware RayQuery on RTX; 16-bin SAH-2 ordered BVH on GTX");
                ConstructToggleRow(Canvas, Faces, Tokens, Card, "##MbNee", "Multi-bounce NEE + Facet CDF",
                                   Render.MultiBounceNeeEnabled, "Fence-published GPU emissive area CDF");
                ConstructToggleRow(Canvas, Faces, Tokens, Card, "##Firefly", "Firefly & Jacobian clamp",
                                   Render.FireflySuppressionEnabled, "Retains 0.0001 target floor + multi-stratum PDF");
                CursorY += EndEverestCard(Canvas, Tokens, Card);
            }
            // Card 02: Resolution & Quality + ReSTIR Reuse
            {
                EverestCardRegion Card = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                          "Global illumination \xC2\xB7 ReSTIR & SVGF",
                                                          EverestGlyphCategory::Sparkles, AccentRgb, 2);
                const char *QualityGrades[3] = {"Low", "Medium", "High"};
                const char *TraceScales[3]   = {"Full", "Half", "Quarter"};
                ConstructSegmentedRow(Canvas, Faces, Tokens, Card, "##QualGrade", "Quality grade", QualityGrades, 3,
                                      Render.QualityGradeIndex);
                ConstructSegmentedRow(Canvas, Faces, Tokens, Card, "##TraceScale", "Trace resolution", TraceScales, 3,
                                      Render.TraceScaleIndex);
                ConstructToggleRow(Canvas, Faces, Tokens, Card, "##TempReuse", "Temporal reservoir reuse",
                                   Render.TemporalReuseEnabled, "Motion-vector reprojected history");
                ConstructToggleRow(Canvas, Faces, Tokens, Card, "##SpatReuse", "Spatial neighbour merge",
                                   Render.SpatialReuseEnabled);
                ConstructPrecisionSlider(Canvas, Faces, Tokens, Card, "##SpatRadius", "Spatial radius",
                                         Render.SpatialRadiusPixels, 2.0f, 48.0f, "px", 0);
                ConstructPrecisionSlider(Canvas, Faces, Tokens, Card, "##IndirectScale", "Indirect intensity",
                                         Render.IndirectScale, 0.0f, 3.0f, "\xC3\x97", 2);
                ConstructToggleRow(Canvas, Faces, Tokens, Card, "##Svgf", "Denoiser (SVGF)", Render.SvgDenoiserEnabled);
                CursorY += EndEverestCard(Canvas, Tokens, Card);
            }
            // Card 03: Debug views & Timing
            {
                EverestCardRegion Card = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                          "Debug views & timing", EverestGlyphCategory::Activity,
                                                          AccentRgb, 3);
                size_t ModeCount = 0;
                const char *const *Modes = QueryEverestInspectionModes(ModeCount);
                ConstructDropdownRow(Canvas, Faces, Tokens, Card, "##InspectorModePopup", "Display channel", Modes,
                                     ModeCount, Render.InspectionModeIndex);
                ConstructToggleRow(Canvas, Faces, Tokens, Card, "##HudToggle", "Readout overlay (H)",
                                   Render.ReadoutOverlayVisible);
                ConstructToggleRow(Canvas, Faces, Tokens, Card, "##SliceToggle", "Distance slice inset (I)",
                                   Render.DistanceSliceInsetEnabled);
                char FpsText[32] = {};
                std::snprintf(FpsText, sizeof(FpsText), "%.0f",
                              1000.0 / std::max(0.5, static_cast<double>(Render.FrameDurationMilliseconds)));
                ConstructHeroMetric(Canvas, Faces, Tokens, Card, FpsText, "fps", "1% low 124", false);
                CursorY += EndEverestCard(Canvas, Tokens, Card);
            }
            break;
        }

        case EngineInspectorDomain::AccelerationAndDistance:
        {
            {
                EverestCardRegion Card = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                          "Two-Level BVH (TLAS + BLAS)", EverestGlyphCategory::Zap,
                                                          AccentRgb, 1);
                char InstText[32] = {};
                std::snprintf(InstText, sizeof(InstText), "%u", Render.ActiveTlasInstances);
                ConstructHeroMetric(Canvas, Faces, Tokens, Card, InstText, "instances", "SAH-2 live", false);
                const EverestStatisticCell Stats[3] = {
                    {"TLAS regions", "372"},
                    {"BLAS interior", "184,920"},
                    {"Triangles", "412,860"},
                };
                ConstructStatisticRow(Canvas, Faces, Tokens, Card, Stats, 3);
                ConstructMutedParagraph(
                    Canvas, Faces, Tokens, Card,
                    "TLAS rebuilt over active occupants each tick; 16-bin SAH-2 BLAS serves hardware RayQuery on RTX "
                    "and software ordered traversal for GTX reflections.");
                CursorY += EndEverestCard(Canvas, Tokens, Card);
            }
            {
                EverestCardRegion Card = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                          "Cascades \xC2\xB7 Toroidal SDF",
                                                          EverestGlyphCategory::GridLattice, AccentRgb, 2);
                char BrickText[32] = {};
                std::snprintf(BrickText, sizeof(BrickText), "%u", Render.ToroidalBricks);
                ConstructHeroMetric(Canvas, Faces, Tokens, Card, BrickText, "bricks",
                                    Render.FreezeDistanceUpdates ? "frozen" : "updating",
                                    Render.FreezeDistanceUpdates);
                ConstructToggleRow(Canvas, Faces, Tokens, Card, "##FreezeSdf", "Freeze field updates",
                                   Render.FreezeDistanceUpdates);
                ConstructDropdownRow(Canvas, Faces, Tokens, Card, "##SdfViewPopup", "Field diagnostic view",
                                     DistanceViewCaptions.data(), DistanceViewCaptions.size(),
                                     Render.DistanceViewIndex);
                ConstructPrecisionSlider(Canvas, Faces, Tokens, Card, "##SdfSliceH", "Slice height",
                                         Render.SliceHeightMetres, 0.05f, 4.0f, "m", 2);
                ConstructMonospaceReadout(Canvas, Faces, Tokens, Card,
                                          {"C0  0.12 m/vox   4,096 bricks   0.42 ms",
                                           "C1  0.48 m/vox   4,096 bricks   0.31 ms",
                                           "C2  1.92 m/vox   4,096 bricks   0.19 ms"});
                CursorY += EndEverestCard(Canvas, Tokens, Card);
            }
            break;
        }

        case EngineInspectorDomain::SurfaceCache:
        {
            EverestCardRegion Card = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                      "Surface cache", EverestGlyphCategory::LayoutGrid, AccentRgb, 1);
            char TileText[32] = {};
            std::snprintf(TileText, sizeof(TileText), "%u", Render.ScheduledCardTiles);
            ConstructHeroMetric(Canvas, Faces, Tokens, Card, TileText, "tiles", "relit live", false);
            ConstructToggleRow(Canvas, Faces, Tokens, Card, "##CardRad", "Card radiosity", Render.CardRadiosityEnabled,
                               "Multi-bounce diffuse cache feeding GTX SDF GI & secondary vertices");
            ConstructPrecisionSlider(Canvas, Faces, Tokens, Card, "##CardBudget", "Static tiles per tick",
                                     Render.CardStaticTileBudget, 0.0f, 8192.0f, "", 0, "Lazy", "Eager");
            ConstructMonospaceReadout(Canvas, Faces, Tokens, Card,
                                      {"Atlas 4096\xC3\x97" "4096 RGBA16F \xC2\xB7 94.2% occupancy",
                                       "6-face oriented card projections \xC2\xB7 186 occupants"});
            CursorY += EndEverestCard(Canvas, Tokens, Card);
            break;
        }

        case EngineInspectorDomain::GeometryClusters:
        {
            EverestCardRegion Card = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                      "Virtualized 128-tri clusters", EverestGlyphCategory::Boxes,
                                                      AccentRgb, 1);
            char ClusterText[32] = {};
            std::snprintf(ClusterText, sizeof(ClusterText), "%u", Render.ClusterCandidates);
            ConstructHeroMetric(Canvas, Faces, Tokens, Card, ClusterText, "clusters", "GPU culled", false);
            ConstructToggleRow(Canvas, Faces, Tokens, Card, "##GeomClusterOn", "Enable GPU frustum + cone cull",
                               Render.ClusteredGeometryEnabled);
            const EverestActionButton OpenCluster{"Open Cluster Studio", EverestGlyphCategory::Boxes,
                                                  EverestButtonStyle::Studio};
            if (ConstructActionButtons(Canvas, Faces, Tokens, Card, "##OpenClusterBtn", &OpenCluster, 1) == 0 &&
                Context.OpenStudio != nullptr)
            {
                *Context.OpenStudio = DedicatedStudioDomain::ClusterStudio;
            }
            CursorY += EndEverestCard(Canvas, Tokens, Card);
            break;
        }

        case EngineInspectorDomain::Diagnostics:
        {
            EverestCardRegion Card = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                      "GPU timing & pipeline diagnostics",
                                                      EverestGlyphCategory::Activity, AccentRgb, 1);
            char MsText[32] = {};
            std::snprintf(MsText, sizeof(MsText), "%.2f", static_cast<double>(Render.FrameDurationMilliseconds));
            ConstructHeroMetric(Canvas, Faces, Tokens, Card, MsText, "ms", "144 Hz budget", false);
            ConstructMonospaceReadout(Canvas, Faces, Tokens, Card,
                                      {"PrimaryVisibility           0.68 ms",
                                       "FacetCdfPreparation         0.04 ms",
                                       "ReSTIR_InitialAndTemporal   1.84 ms",
                                       "ReSTIR_SpatialReuse         1.12 ms",
                                       "RayTracedReflections        1.36 ms",
                                       "SVGF_Reconstruction         0.62 ms",
                                       "VolumetricPlumeAndTAA       0.89 ms"});
            CursorY += EndEverestCard(Canvas, Tokens, Card);
            break;
        }

        case EngineInspectorDomain::Sun:
        {
            // Property switches row (Shadows, Spot, Disc, Haze, Aerial) — exact EnvironmentInspector.js parity!
            const EverestPropertyToggle PropToggles[5] = {
                {"Shadows", &Environment.SunShadowsEnabled},
                {"Spot", &Environment.SolarSpotEnabled},
                {"Disc", &Environment.SolarDiscEnabled},
                {"Haze", &Environment.AtmosphericHazeEnabled},
                {"Aerial", &Environment.AerialPerspectiveEnabled},
            };
            float SwitchRowH = 0.0f;
            ConstructPropertySwitchRow(Faces, Tokens, "##SunPropSwitches", ImVec2(OriginX, CursorY), Width, PropToggles,
                                       5, SwitchRowH);
            CursorY += SwitchRowH;

            // Card 01: Lighting preset
            {
                EverestCardRegion Card = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                          "Lighting preset", EverestGlyphCategory::Sunrise, AccentRgb,
                                                          1);
                const char *Presets[4] = {"Clear", "Golden hour", "Overcast", "Night"};
                if (ConstructSegmentedRow(Canvas, Faces, Tokens, Card, "##SunPreset", nullptr, Presets, 4,
                                          Environment.LightingPresetIndex))
                {
                    ApplyEnvironmentLightingPreset(Environment, Environment.LightingPresetIndex);
                }
                ConstructMutedParagraph(
                    Canvas, Faces, Tokens, Card,
                    "Night drops the sun below the horizon: street lamps, hangar strips and vehicle beams illuminate "
                    "the proving grounds through the surface cache and ReSTIR reservoirs.");
                CursorY += EndEverestCard(Canvas, Tokens, Card);
            }
            // Card 02: Sun direction + SunTrajectoryArc instrument
            {
                EverestCardRegion Card = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                          "Sun direction", EverestGlyphCategory::Orbit, AccentRgb, 2);
                char ElevText[32] = {};
                std::snprintf(ElevText, sizeof(ElevText), "%.1f", static_cast<double>(Environment.SunElevationDegrees));
                const bool Below = Environment.SunElevationDegrees < 0.0f;
                ConstructHeroMetric(Canvas, Faces, Tokens, Card, ElevText, "\xC2\xB0",
                                    Below ? "below horizon" : "above horizon", Below);
                ConstructSunArcInstrument(Canvas, Faces, Tokens, Card, Environment.SunElevationDegrees,
                                          Environment.SunAzimuthDegrees);
                ConstructPrecisionSlider(Canvas, Faces, Tokens, Card, "##SunElev", "Elevation",
                                         Environment.SunElevationDegrees, -90.0f, 90.0f, "\xC2\xB0", 1, "Night",
                                         "Zenith");
                ConstructPrecisionSlider(Canvas, Faces, Tokens, Card, "##SunAzim", "Azimuth",
                                         Environment.SunAzimuthDegrees, -180.0f, 180.0f, "\xC2\xB0", 0);
                ConstructPrecisionSlider(Canvas, Faces, Tokens, Card, "##SunRadius", "Disc angular radius",
                                         Environment.SunAngularRadiusDegrees, 0.05f, 2.0f, "\xC2\xB0", 2);
                CursorY += EndEverestCard(Canvas, Tokens, Card);
            }
            // Card 03: Light intensity
            {
                EverestCardRegion Card = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                          "Light intensity", EverestGlyphCategory::Lightbulb, AccentRgb,
                                                          3);
                ConstructCapsuleSlider(Canvas, Faces, Tokens, Card, "##SunTemp", "Blackbody temperature",
                                       Environment.SunTemperatureKelvin, 2000.0f, 10000.0f, "K", 0);
                ConstructCapsuleSlider(Canvas, Faces, Tokens, Card, "##SunIllum", "Solar intensity",
                                       Environment.SolarIlluminance, 1.0f, 30.0f, "", 1);
                ConstructCapsuleSlider(Canvas, Faces, Tokens, Card, "##SkyScale", "Sky intensity",
                                       Environment.SkyIntensityScale, 0.0f, 3.0f, "\xC3\x97", 2);
                ConstructCapsuleSlider(Canvas, Faces, Tokens, Card, "##EmitScale", "Emitters (lamps, flames)",
                                       Environment.EmitterScale, 0.0f, 4.0f, "\xC3\x97", 2);
                CursorY += EndEverestCard(Canvas, Tokens, Card);
            }
            // Card 04: 3D Clustered Lighting
            {
                EverestCardRegion Card = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                          "3D Clustered Lighting", EverestGlyphCategory::Sparkles,
                                                          AccentRgb, 4);
                char ActiveText[32] = {};
                std::snprintf(ActiveText, sizeof(ActiveText), "%u", Environment.ActiveClusterLights);
                ConstructHeroMetric(Canvas, Faces, Tokens, Card, ActiveText, "active lights", "318/1024 cells", false);
                const EverestStatisticCell Stats[3] = {
                    {"Point lights", "18"},
                    {"Street lamps", "22"},
                    {"Vehicle beams", "4"},
                };
                ConstructStatisticRow(Canvas, Faces, Tokens, Card, Stats, 3);
                ConstructToggleRow(Canvas, Faces, Tokens, Card, "##ClusterMask", "3D cluster bitmask culling",
                                   Environment.ClusterBitmaskCullEnabled,
                                   "16\xC3\x97" "16\xC3\x97" "4 grid with 64-bit light masks & firstTrailingBit traversal");
                CursorY += EndEverestCard(Canvas, Tokens, Card);
            }
            break;
        }

        case EngineInspectorDomain::Atmosphere:
        {
            EverestCardRegion Card = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                      "Sky & aerial perspective", EverestGlyphCategory::Sunrise,
                                                      AccentRgb, 1, "Hillaire LUT + raymarched aerial froxels");
            ConstructCapsuleSlider(Canvas, Faces, Tokens, Card, "##AtmRayleigh", "Rayleigh scattering",
                                   Environment.RayleighScatteringScale, 0.1f, 3.0f, "\xC3\x97", 2);
            ConstructCapsuleSlider(Canvas, Faces, Tokens, Card, "##AtmMie", "Mie aerosol turbidity",
                                   Environment.MieTurbidity, 1.0f, 10.0f, "", 2);
            ConstructCapsuleSlider(Canvas, Faces, Tokens, Card, "##AtmAniso", "Mie phase anisotropy (g)",
                                   Environment.MieAnisotropyG, 0.0f, 0.96f, "", 2);
            ConstructCapsuleSlider(Canvas, Faces, Tokens, Card, "##AtmOzone", "Ozone Chappuis absorption",
                                   Environment.OzoneAbsorptionScale, 0.0f, 3.0f, "\xC3\x97", 2);
            ConstructCapsuleSlider(Canvas, Faces, Tokens, Card, "##AtmMulti", "Multiple scattering order",
                                   Environment.MultiScatteringFactor, 0.0f, 2.0f, "\xC3\x97", 2);
            CursorY += EndEverestCard(Canvas, Tokens, Card);
            break;
        }

        case EngineInspectorDomain::Clouds:
        case EngineInspectorDomain::LocalCloud:
        {
            EverestCardRegion Card = BeginEverestCard(
                Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                Domain == EngineInspectorDomain::Clouds ? "Volumetric cloudscape" : "Local cloud volume",
                EverestGlyphCategory::CloudFog, AccentRgb, 1);
            ConstructCapsuleSlider(Canvas, Faces, Tokens, Card, "##CloudCov", "Macro coverage",
                                   Environment.CloudCoverage, 0.0f, 1.0f, "", 2);
            ConstructCapsuleSlider(Canvas, Faces, Tokens, Card, "##CloudBase", "Layer base altitude",
                                   Environment.CloudBaseKilometres, 0.4f, 6.0f, "km", 2);
            ConstructCapsuleSlider(Canvas, Faces, Tokens, Card, "##CloudThick", "Vertical thickness",
                                   Environment.CloudThicknessKilometres, 0.5f, 6.0f, "km", 2);
            ConstructCapsuleSlider(Canvas, Faces, Tokens, Card, "##CloudSilver", "Dual-lobe silver lining",
                                   Environment.CloudSilverLining, 0.0f, 1.5f, "", 2);
            if (Domain == EngineInspectorDomain::LocalCloud && Context.Spatial != nullptr)
            {
                CursorY += EndEverestCard(Canvas, Tokens, Card);
                float TransformH = 0.0f;
                ConstructWorldTransformCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW, AccentRgb,
                                            Context.Spatial->CoordinatesMetres, Context.Spatial->FocusRequested,
                                            TransformH);
                CursorY += TransformH;
                return CursorY - OriginY;
            }
            CursorY += EndEverestCard(Canvas, Tokens, Card);
            break;
        }

        case EngineInspectorDomain::HeightFog:
        case EngineInspectorDomain::AtmosphericFog:
        case EngineInspectorDomain::LocalVolumetricFog:
        {
            EverestCardRegion Card = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                      "Participating media & fog", EverestGlyphCategory::CloudFog,
                                                      AccentRgb, 1);
            ConstructCapsuleSlider(Canvas, Faces, Tokens, Card, "##FogDens", "Extinction density",
                                   Environment.HeightFogDensity, 0.0f, 0.15f, "1/m", 3);
            ConstructCapsuleSlider(Canvas, Faces, Tokens, Card, "##FogFall", "Altitude falloff",
                                   Environment.HeightFogFalloff, 0.01f, 1.0f, "1/m", 2);
            ConstructCapsuleSlider(Canvas, Faces, Tokens, Card, "##FogScat", "Single-scatter albedo",
                                   Environment.VolumetricFogScattering, 0.0f, 1.0f, "", 2);
            CursorY += EndEverestCard(Canvas, Tokens, Card);
            break;
        }

        case EngineInspectorDomain::LensFlare:
        case EngineInspectorDomain::Stars:
        case EngineInspectorDomain::Moons:
        case EngineInspectorDomain::Lightning:
        {
            EverestCardRegion Card = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                      "Celestial & optical phenomena", EverestGlyphCategory::Sparkles,
                                                      AccentRgb, 1);
            ConstructCapsuleSlider(Canvas, Faces, Tokens, Card, "##OptFlare", "Aperture ghost gain",
                                   Environment.LensFlareIntensity, 0.0f, 2.0f, "\xC3\x97", 2);
            ConstructCapsuleSlider(Canvas, Faces, Tokens, Card, "##OptStars", "Sidereal magnitude limit",
                                   Environment.StarMagnitudeLimit, 2.0f, 7.5f, "mag", 1);
            ConstructCapsuleSlider(Canvas, Faces, Tokens, Card, "##OptMoon", "Lunar phase illumination",
                                   Environment.LunarPhase, 0.0f, 1.0f, "", 2);
            ConstructCapsuleSlider(Canvas, Faces, Tokens, Card, "##OptBolt", "Storm discharge rate",
                                   Environment.LightningFrequency, 0.0f, 30.0f, "/min", 1);
            CursorY += EndEverestCard(Canvas, Tokens, Card);
            break;
        }

        case EngineInspectorDomain::Wind:
        {
            EverestCardRegion Card = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                      "Ambient wind forcefield", EverestGlyphCategory::Wind, AccentRgb,
                                                      1, "Couples clouds, smoke plume, sparks & foliage");
            char WindSpeed[32] = {};
            std::snprintf(WindSpeed, sizeof(WindSpeed), "%.1f",
                          static_cast<double>(Environment.WindSpeedMetresPerSecond));
            ConstructHeroMetric(Canvas, Faces, Tokens, Card, WindSpeed, "m/s", "coupled", false);
            ConstructPrecisionSlider(Canvas, Faces, Tokens, Card, "##WindSpd", "Wind speed",
                                     Environment.WindSpeedMetresPerSecond, 0.0f, 28.0f, "m/s", 1, "Still", "Gale");
            ConstructPrecisionSlider(Canvas, Faces, Tokens, Card, "##WindHdg", "Wind heading",
                                     Environment.WindHeadingDegrees, -180.0f, 180.0f, "\xC2\xB0", 0);
            ConstructPrecisionSlider(Canvas, Faces, Tokens, Card, "##WindGust", "Gust turbulence",
                                     Environment.WindGustStrength, 0.0f, 1.0f, "", 2);
            CursorY += EndEverestCard(Canvas, Tokens, Card);
            break;
        }

        case EngineInspectorDomain::TransformOnly:
        {
            float DummyCoords[3] = {0.0f, 0.0f, 0.0f};
            bool  DummyFocus     = false;
            float TransformH     = 0.0f;
            ConstructWorldTransformCard(
                Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW, AccentRgb,
                Context.Spatial != nullptr ? Context.Spatial->CoordinatesMetres : DummyCoords,
                Context.Spatial != nullptr ? Context.Spatial->FocusRequested : DummyFocus, TransformH);
            CursorY += TransformH;
            break;
        }
    }

    return CursorY - OriginY;
}

#endif // FRONTIER_WITH_INTERFACE_SDK

} // namespace Frontier
