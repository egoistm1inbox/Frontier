/*====================================================================================================================================
                                                    DRIVESHOWCASERECORDS.CPP
====================================================================================================================================*/
// 🧩 Implementation of the 25 Project-Drive scene records. Every constructor builds its editor Inspector & Outliner
//    registration strictly inside #if defined(FRONTIER_EDITOR_PROFILE).

#include "DriveShowcaseRecords.h"

#include "InfographicWidgets.h"

#include "Engine/Scene/SceneDirectory.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <string>

namespace Frontier::Drive
{

namespace
{

#if defined(FRONTIER_EDITOR_PROFILE)
void RegisterShowcaseEditorRecord(RecordToken Token, const char *DisplayName, RecordEditorDescription &&Desc)
{
    SceneDirectory &Dir = SceneDirectory::Instance();
    Dir.ConfigureName(Token, DisplayName);
    Dir.ConfigureEditorDescription(Token, std::move(Desc));
}

std::string FormatMeta1(const char *Fmt, double A)
{
    char Buf[48] = {};
    std::snprintf(Buf, sizeof(Buf), Fmt, A);
    return Buf;
}
#endif

} // namespace

//====================================================================================================================================
//                                        GROUP 1: RENDER (3 COMPONENTS)
//====================================================================================================================================

ShowcaseRenderPipelineRecord::ShowcaseRenderPipelineRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RecordEntry(RecordClassification::Interface)
{
    (void)Telemetry;
    (void)DirtyRevision;
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Desc;
    Desc.StableId    = "render_pipeline";
    Desc.Group       = "Render";
    Desc.DisplayName = "Renderer & Nanite Tier";
    Desc.Category    = "Dual-Tier GTX/RTX + Blinn + Nanite DAG";
    Desc.Glyph       = "layers";
    Desc.Colour      = "#38bdf8";
    Desc.Description = "Switches live between GTX (SDF ReSTIR GI + software BVH RT reflections), RTX (full RayQuery GI & "
                       "reflections), and Low-Res Blinn, coupled with glass-isolated Nanite cluster hierarchy.";
    Desc.Enabled     = &Enabled;
    Desc.Revision    = DirtyRevision;
    Desc.QueryLiveMeta = [this]() -> std::string {
        return TracingTier == 0 ? "GTX SDF" : (TracingTier == 1 ? "RTX RT" : "Blinn");
    };
    Desc.ConstructInfographic = [this, Telemetry]() {
        if (Telemetry == nullptr) return;
        char FrameBuf[32] = {}, ClustBuf[32] = {}, TriBuf[32] = {};
        std::snprintf(FrameBuf, sizeof(FrameBuf), "%.1f ms", Telemetry->LastFrameRenderMs);
        std::snprintf(ClustBuf, sizeof(ClustBuf), "%u", Telemetry->ActiveNaniteClusters);
        std::snprintf(TriBuf, sizeof(TriBuf), "%.1fk", static_cast<float>(Telemetry->TotalNaniteTriangles) * 0.001f);
        const Infographics::KpiBadgeItem Kpis[3] = {
            {"TIER", TracingTier == 0 ? "GTX" : (TracingTier == 1 ? "RTX" : "BLINN"), FrameBuf, 0x38bdf8u},
            {"NANITE DAG", ClustBuf, "K1 clusters", 0x2fe6a7u},
            {"TRIANGLES", TriBuf, "8 glass-isolated", 0xa78bfau},
        };
        Infographics::DrawKpiRow(Kpis, 3);
        const Infographics::SegmentSlice Slices[4] = {
            {"Primary/BVH", 0.36f, 0x38bdf8u},
            {"ReSTIR GI",   0.29f, 0x2fe6a7u},
            {"Volumetrics", 0.22f, 0xfbbf24u},
            {"A-Trous",     0.13f, 0xa78bfau},
        };
        Infographics::DrawSegmentedDistributionCard("FRAME STAGE BUDGET", FrameBuf, Slices, 4);
    };
    Desc.ChoiceFields.push_back({"GPU Tracing Tier", {{"GTX SDF+BVH", 0}, {"RTX Full RT", 1}, {"Blinn Low-Res", 2}}, &TracingTier, true});
    Desc.ChoiceFields.push_back({"Display Inspection", {{"Final", 0}, {"Shadows", 1}, {"GI", 2}, {"Refl", 3}, {"SDF", 4}, {"Nrm", 5}}, &InspectionMode, true});
    Desc.ChoiceFields.push_back({"Viewport Resolution Scale", {{"35%", 35}, {"50%", 50}, {"75%", 75}, {"100%", 100}}, &ViewportScalePercent, true});
    Desc.Switches.push_back({"Screen-Space ReSTIR Spatial Reuse", &EnableSpatialRestir});
    Desc.Switches.push_back({"3-Step Edge-Stopping A-Trous Denoiser", &EnableAtrousDenoiser});
    Desc.Switches.push_back({"Glass-Isolated Nanite DAG Cut", &IsolateGlassNanite});
    Desc.ScalarFields.push_back({"Indirect GI Gain", "-", 0.0, 2.5, 0.05, 2, &GiBounceGain, "SHADING & NANITE"});
    Desc.ScalarFields.push_back({"Reflection Sharpness", "-", 0.1, 1.0, 0.02, 2, &ReflectionSharpness, "SHADING & NANITE"});
    Desc.ScalarFields.push_back({"Nanite Error Threshold", "px", 0.25, 4.0, 0.05, 2, &NanitePixelError, "SHADING & NANITE"});
    RegisterShowcaseEditorRecord(Token(), Desc.DisplayName, std::move(Desc));
#endif
}

ShowcaseExposureCameraRecord::ShowcaseExposureCameraRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RecordEntry(RecordClassification::Camera)
{
    (void)Telemetry;
    (void)DirtyRevision;
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Desc;
    Desc.StableId    = "camera_exposure";
    Desc.Group       = "Render";
    Desc.DisplayName = "Camera & Auto-Exposure";
    Desc.Category    = "Photometric EV100 & Cabin Guard";
    Desc.Glyph       = "camera";
    Desc.Colour      = "#f472b6";
    Desc.Description = "1:1 VehicleHMI camera rig with histogram auto-exposure that protects dark vehicle cabins and rooms "
                       "lit by emissive HMI displays from over-brightening, plus solar lens flare and AgX/ACES.";
    Desc.Enabled     = &Enabled;
    Desc.Revision    = DirtyRevision;
    Desc.QueryLiveMeta = [Telemetry]() -> std::string {
        return Telemetry ? FormatMeta1("EV %.1f", Telemetry->AdaptedSceneEv100) : "EV 11.4";
    };
    Desc.ConstructInfographic = [Telemetry]() {
        if (Telemetry == nullptr) return;
        Infographics::DrawTwinRadialGauges("SCENE EV100", Telemetry->AdaptedSceneEv100, 2.0f, 16.5f, "EV100", 0xf472b6u,
                                           "CABIN CLAMP", Telemetry->CabinProtectedGain, 0.2f, 1.5f, "x gain", 0x2fe6a7u);
    };
    Desc.ChoiceFields.push_back({"Camera Viewpoint", {
        {"Hero", 0}, {"Cabin", 1}, {"Portal", 2}, {"Snow", 3}, {"Pyro", 4}, {"Chase", 5}}, &ActiveCameraPreset, true});
    Desc.ChoiceFields.push_back({"Display Transform", {{"Chromatic AgX", 0}, {"ACES Fitted", 1}}, &ToneMapper, true});
    Desc.Switches.push_back({"Dark Cabin Emissive Exposure Guard", &ProtectDarkCabinHmi});
    Desc.Switches.push_back({"Anamorphic Solar Lens Flare", &EnableSolarLensFlare});
    Desc.Switches.push_back({"Multi-Scale HDR Bloom", &EnableMultiScaleBloom});
    Desc.ScalarFields.push_back({"Exposure Compensation", "EV", -3.0, 3.0, 0.05, 2, &ExposureCompensation, "OPTICS & ADAPTATION"});
    Desc.ScalarFields.push_back({"Vertical Field of View", "deg", 28.0, 85.0, 0.5, 1, &VerticalFovDeg, "OPTICS & ADAPTATION"});
    Desc.ScalarFields.push_back({"Speed Brighten", "EV/s", 0.5, 8.0, 0.1, 1, &AdaptationSpeedUp, "OPTICS & ADAPTATION"});
    Desc.ScalarFields.push_back({"Speed Darken", "EV/s", 0.3, 6.0, 0.1, 1, &AdaptationSpeedDown, "OPTICS & ADAPTATION"});
    Desc.ScalarFields.push_back({"Solar Lens Flare Gain", "-", 0.0, 1.5, 0.05, 2, &SolarFlareIntensity, "OPTICS & ADAPTATION"});
    RegisterShowcaseEditorRecord(Token(), Desc.DisplayName, std::move(Desc));
#endif
}

ShowcaseAreaLightRigRecord::ShowcaseAreaLightRigRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RecordEntry(RecordClassification::Illumination)
{
    (void)Telemetry;
    (void)DirtyRevision;
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Desc;
    Desc.StableId    = "area_luminaires";
    Desc.Group       = "Render";
    Desc.DisplayName = "Area Luminaires & A-Trous";
    Desc.Category    = "Solid-Angle NEE + B3 Wavelet";
    Desc.Glyph       = "sun";
    Desc.Colour      = "#fbbf24";
    Desc.Description = "Solid-angle rectangular area luminaires with Karis GGX representative-point specular and 3-step "
                       "edge-stopping A-Trous wavelet denoising across primary, mirror, glass, and portal views.";
    Desc.Enabled     = &Enabled;
    Desc.Revision    = DirtyRevision;
    Desc.QueryLiveMeta = [this]() -> std::string { return FormatMeta1("%.0f nits", GantryLuminanceNits); };
    Desc.ConstructInfographic = [this]() {
        char NitsBuf[32] = {}, KelvBuf[32] = {};
        std::snprintf(NitsBuf, sizeof(NitsBuf), "%.0f", GantryLuminanceNits);
        std::snprintf(KelvBuf, sizeof(KelvBuf), "%.0f K", GantryTempKelvin);
        const Infographics::KpiBadgeItem Kpis[2] = {
            {"GANTRY NITS", NitsBuf, "Solid-angle NEE", 0xfbbf24u},
            {"COLOUR TEMP", KelvBuf, "3-step A-Trous", 0x38bdf8u},
        };
        Infographics::DrawKpiRow(Kpis, 2);
    };
    Desc.Switches.push_back({"Exact Solid-Angle Polygon NEE", &SolidAngleNee});
    Desc.Switches.push_back({"Karis GGX Representative Specular", &KarisSpecRepresentative});
    Desc.ScalarFields.push_back({"Gantry Luminaire", "nits", 0.0, 8000.0, 50.0, 0, &GantryLuminanceNits, "PHOTOMETRIC RIG"});
    Desc.ScalarFields.push_back({"Correlated Colour Temp", "K", 2400.0, 9000.0, 100.0, 0, &GantryTempKelvin, "PHOTOMETRIC RIG"});
    Desc.ScalarFields.push_back({"Portal Arch Emissive", "nits", 0.0, 5000.0, 50.0, 0, &PortalArchGlowNits, "PHOTOMETRIC RIG"});
    Desc.ScalarFields.push_back({"A-Trous Normal Weight", "-", 4.0, 64.0, 1.0, 0, &AtrousPhiNormal, "WAVELET FILTER"});
    Desc.ScalarFields.push_back({"A-Trous Depth Sigma", "m", 0.02, 0.50, 0.01, 2, &AtrousPhiDepth, "WAVELET FILTER"});
    RegisterShowcaseEditorRecord(Token(), Desc.DisplayName, std::move(Desc));
#endif
}

//====================================================================================================================================
//                                      GROUP 2: ENVIRONMENT (6 COMPONENTS)
//====================================================================================================================================

ShowcaseDirectionalSunRecord::ShowcaseDirectionalSunRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RecordEntry(RecordClassification::Illumination)
{
    (void)Telemetry;
    (void)DirtyRevision;
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Desc;
    Desc.StableId    = "sun";
    Desc.Group       = "Environment";
    Desc.DisplayName = "Sun";
    Desc.Category    = "Directional Solar Luminaire";
    Desc.Glyph       = "sun";
    Desc.Colour      = "#fbbf24";
    Desc.Description = "1:1 VehicleHMI directional solar luminaire with Beer-Lambert volumetric cloud & pyro plume "
                       "transmittance shadows.";
    Desc.Enabled     = &Enabled;
    Desc.Revision    = DirtyRevision;
    Desc.QueryLiveMeta = [this]() -> std::string { return FormatMeta1("%.1f deg", ElevationDeg); };
    Desc.Actions.push_back({"Dawn 6 deg", 0, "", [this]() { ElevationDeg = 6.0; AzimuthDeg = 98.0; }});
    Desc.Actions.push_back({"Golden 21 deg", 1, "", [this]() { ElevationDeg = 21.5; AzimuthDeg = 212.0; }});
    Desc.Actions.push_back({"Zenith 62 deg", 0, "", [this]() { ElevationDeg = 62.0; AzimuthDeg = 180.0; }});
    Desc.Switches.push_back({"Volumetric Cloud Transmittance Shadows", &CastCloudShadows});
    Desc.Switches.push_back({"Pyro Plume Beer-Lambert Shadows", &CastPlumeShadows});
    Desc.ScalarFields.push_back({"Azimuth", "deg", 0.0, 360.0, 1.0, 1, &AzimuthDeg, "SOLAR EPHEMERIS"});
    Desc.ScalarFields.push_back({"Elevation", "deg", -12.0, 88.0, 0.5, 1, &ElevationDeg, "SOLAR EPHEMERIS"});
    Desc.ScalarFields.push_back({"Illuminance", "klx", 0.0, 130.0, 1.0, 1, &IlluminanceKlx, "SOLAR EPHEMERIS"});
    Desc.ScalarFields.push_back({"Angular Disc Diameter", "deg", 0.25, 2.0, 0.01, 3, &AngularDiameterDeg, "SOLAR EPHEMERIS"});
    Desc.ScalarFields.push_back({"Warm Horizon Tint", "-", 0.0, 1.0, 0.02, 2, &WarmTint, "SOLAR EPHEMERIS"});
    RegisterShowcaseEditorRecord(Token(), Desc.DisplayName, std::move(Desc));
#endif
}

ShowcaseAtmosphereSkyRecord::ShowcaseAtmosphereSkyRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RecordEntry(RecordClassification::Environment)
{
    (void)Telemetry;
    (void)DirtyRevision;
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Desc;
    Desc.StableId    = "sky_atmosphere";
    Desc.Group       = "Environment";
    Desc.DisplayName = "Sky & Celestial Dome";
    Desc.Category    = "Rayleigh/Mie + 41k Hipparcos Stars";
    Desc.Glyph       = "globe";
    Desc.Colour      = "#60a5fa";
    Desc.Description = "1:1 VehicleHMI multiple-scattering Rayleigh/Mie ozone sky coupled with 41,000 Hipparcos stars, "
                       "Milky Way panorama, textured lunar disc, and ringed exoplanet.";
    Desc.Enabled     = &Enabled;
    Desc.Revision    = DirtyRevision;
    Desc.QueryLiveMeta = [this]() -> std::string {
        return SkyTimePreset == 2 ? "Celestial" : (SkyTimePreset == 1 ? "Storm" : "Daylight");
    };
    Desc.ChoiceFields.push_back({"Atmosphere Preset", {{"Proving Grounds", 0}, {"Storm Overcast", 1}, {"Celestial Night", 2}}, &SkyTimePreset, true});
    Desc.Switches.push_back({"Multiple-Scattering Sky LUT", &MultiScatterLut});
    Desc.Switches.push_back({"Render Ringed Planet & Moon", &ShowRingedPlanet});
    Desc.ScalarFields.push_back({"Mie Aerosol Turbidity", "-", 1.0, 8.0, 0.05, 2, &MieTurbidity, "ATMOSPHERIC OPTICS"});
    Desc.ScalarFields.push_back({"Rayleigh Density Scale", "-", 0.2, 2.5, 0.05, 2, &RayleighScale, "ATMOSPHERIC OPTICS"});
    Desc.ScalarFields.push_back({"Ozone Chappuis Band", "-", 0.0, 2.5, 0.05, 2, &OzoneAbsorption, "ATMOSPHERIC OPTICS"});
    Desc.ScalarFields.push_back({"Hipparcos Starfield Gain", "-", 0.0, 3.0, 0.05, 2, &StarfieldBrightness, "CELESTIAL"});
    Desc.ScalarFields.push_back({"Lunar Albedo Phase", "-", 0.0, 1.5, 0.05, 2, &MoonIllumination, "CELESTIAL"});
    RegisterShowcaseEditorRecord(Token(), Desc.DisplayName, std::move(Desc));
#endif
}

ShowcaseVolumetricCloudsRecord::ShowcaseVolumetricCloudsRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RecordEntry(RecordClassification::Environment)
{
    (void)Telemetry;
    (void)DirtyRevision;
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Desc;
    Desc.StableId    = "clouds";
    Desc.Group       = "Environment";
    Desc.DisplayName = "Volumetric Clouds";
    Desc.Category    = "64-Step Zero-Banding CloudField";
    Desc.Glyph       = "cloud";
    Desc.Colour      = "#93c5fd";
    Desc.Description = "1:1 VehicleHMI cumulus/stratocumulus deck raymarched at 64 steps with interleaved gradient noise "
                       "phase jitter (0 banding) and visible in mirrors and portals on both GTX and RTX.";
    Desc.Enabled     = &Enabled;
    Desc.Revision    = DirtyRevision;
    Desc.QueryLiveMeta = [this]() -> std::string { return FormatMeta1("%.0f%% cov", Coverage * 100.0); };
    Desc.Switches.push_back({"64-Step IGN Phase Jitter (Zero Banding)", &IgnPhaseJitter64});
    Desc.ScalarFields.push_back({"Cloud Coverage", "-", 0.0, 1.0, 0.01, 2, &Coverage, "CLOUD DECK"});
    Desc.ScalarFields.push_back({"Extinction Density", "1/m", 0.005, 0.20, 0.002, 3, &ExtinctionDensity, "CLOUD DECK"});
    Desc.ScalarFields.push_back({"Cloud Base Altitude", "km", 0.6, 3.5, 0.05, 2, &CloudBaseKm, "CLOUD DECK"});
    Desc.ScalarFields.push_back({"Cloud Top Altitude", "km", 2.0, 8.0, 0.10, 2, &CloudTopKm, "CLOUD DECK"});
    Desc.ScalarFields.push_back({"Cumulonimbus Anvil", "-", 0.0, 1.0, 0.02, 2, &AnvilAmount, "SCATTERING"});
    Desc.ScalarFields.push_back({"Dual-Lobe Silver Lining", "-", 0.0, 1.0, 0.02, 2, &SilverLining, "SCATTERING"});
    RegisterShowcaseEditorRecord(Token(), Desc.DisplayName, std::move(Desc));
#endif
}

ShowcaseHeightFogRecord::ShowcaseHeightFogRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RecordEntry(RecordClassification::Environment)
{
    (void)Telemetry;
    (void)DirtyRevision;
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Desc;
    Desc.StableId    = "fog";
    Desc.Group       = "Environment";
    Desc.DisplayName = "Exponential Height Fog";
    Desc.Category    = "Participating Atmospheric Haze";
    Desc.Glyph       = "wind";
    Desc.Colour      = "#94a3b8";
    Desc.Description = "1:1 VehicleHMI exponential height fog with solar Henyey-Greenstein inscattering, coupled across "
                       "planar mirrors and seamless portals.";
    Desc.Enabled     = &Enabled;
    Desc.Revision    = DirtyRevision;
    Desc.QueryLiveMeta = [this]() -> std::string { return FormatMeta1("%.4f /m", BaseDensity); };
    Desc.Switches.push_back({"Couple Across Mirrors & Portals", &VisibleInPortals});
    Desc.ScalarFields.push_back({"Base Extinction", "1/m", 0.0, 0.06, 0.0005, 4, &BaseDensity, "HEIGHT FOG"});
    Desc.ScalarFields.push_back({"Altitude Falloff", "1/m", 0.01, 0.80, 0.01, 2, &HeightFalloff, "HEIGHT FOG"});
    Desc.ScalarFields.push_back({"Start Distance", "m", 0.0, 80.0, 1.0, 1, &StartDistanceM, "HEIGHT FOG"});
    Desc.ScalarFields.push_back({"Phase Anisotropy g", "-", -0.5, 0.92, 0.02, 2, &AnisotropyG, "HEIGHT FOG"});
    RegisterShowcaseEditorRecord(Token(), Desc.DisplayName, std::move(Desc));
#endif
}

ShowcaseSkyPrecipitationRecord::ShowcaseSkyPrecipitationRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RecordEntry(RecordClassification::Environment)
{
    (void)Telemetry;
    (void)DirtyRevision;
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Desc;
    Desc.StableId    = "precipitation";
    Desc.Group       = "Environment";
    Desc.DisplayName = "Rain, Snow & Hailstorm";
    Desc.Category    = "Coupled Ballistic SkyPrecipitation";
    Desc.Glyph       = "cloud-rain";
    Desc.Colour      = "#38bdf8";
    Desc.Description = "Coupled 3-species SkyPrecipitation solver: velocity-streaked rain feeding puddles, turbulent "
                       "snowflakes accumulating the 3D SnowSurface mound, and multi-bounce ballistic hailstones.";
    Desc.Enabled     = &Enabled;
    Desc.Revision    = DirtyRevision;
    Desc.QueryLiveMeta = [Telemetry]() -> std::string {
        if (!Telemetry) return "Mixed";
        char Buf[48] = {};
        std::snprintf(Buf, sizeof(Buf), "%u+%u+%u", Telemetry->ActiveRainStreaks, Telemetry->ActiveSnowFlakes, Telemetry->ActiveHailStones);
        return Buf;
    };
    Desc.ConstructInfographic = [Telemetry]() {
        if (Telemetry == nullptr) return;
        char RBuf[24] = {}, SBuf[24] = {}, HBuf[24] = {}, BBuf[32] = {};
        std::snprintf(RBuf, sizeof(RBuf), "%u", Telemetry->ActiveRainStreaks);
        std::snprintf(SBuf, sizeof(SBuf), "%u", Telemetry->ActiveSnowFlakes);
        std::snprintf(HBuf, sizeof(HBuf), "%u", Telemetry->ActiveHailStones);
        std::snprintf(BBuf, sizeof(BBuf), "%u bounces", Telemetry->HailBounceEvents);
        const Infographics::KpiBadgeItem Kpis[3] = {
            {"RAIN STREAKS", RBuf, "Feeds puddles", 0x38bdf8u},
            {"SNOWFLAKES",   SBuf, "Feeds CC=1 mound", 0xe2e8f0u},
            {"HAILSTONES",   HBuf, BBuf, 0xfbbf24u},
        };
        Infographics::DrawKpiRow(Kpis, 3);
        const float Tot = static_cast<float>(std::max(1u, Telemetry->ActiveRainStreaks + Telemetry->ActiveSnowFlakes + Telemetry->ActiveHailStones));
        const Infographics::SegmentSlice Slices[3] = {
            {"Rain", static_cast<float>(Telemetry->ActiveRainStreaks) / Tot, 0x38bdf8u},
            {"Snow", static_cast<float>(Telemetry->ActiveSnowFlakes) / Tot,  0xe2e8f0u},
            {"Hail", static_cast<float>(Telemetry->ActiveHailStones) / Tot,  0xfbbf24u},
        };
        Infographics::DrawSegmentedDistributionCard("PRECIPITATION SPECIES MIX", BBuf, Slices, 3);
    };
    Desc.ChoiceFields.push_back({"Weather Regime", {{"Clear", 0}, {"Rain", 1}, {"Snow", 2}, {"Tri-Storm", 3}}, &WeatherMode, true});
    Desc.Switches.push_back({"Multi-Bounce Chassis & Ground Hail", &MultiBounceHail});
    Desc.Switches.push_back({"Deposit Snowfall Into 3D Mound", &FeedSnowMound});
    Desc.ScalarFields.push_back({"Rainfall Rate", "-", 0.0, 1.0, 0.02, 2, &RainIntensity, "COUPLED PRECIPITATION"});
    Desc.ScalarFields.push_back({"Snowfall Rate", "-", 0.0, 1.0, 0.02, 2, &SnowfallIntensity, "COUPLED PRECIPITATION"});
    Desc.ScalarFields.push_back({"Hailstorm Rate", "-", 0.0, 1.0, 0.02, 2, &HailIntensity, "COUPLED PRECIPITATION"});
    Desc.ScalarFields.push_back({"Hailstone Diameter", "mm", 6.0, 38.0, 0.5, 1, &HailDiameterMm, "HAIL BALLISTICS"});
    Desc.ScalarFields.push_back({"Hailstone Restitution", "-", 0.15, 0.85, 0.02, 2, &HailRestitution, "HAIL BALLISTICS"});
    RegisterShowcaseEditorRecord(Token(), Desc.DisplayName, std::move(Desc));
#endif
}

ShowcaseLightningDischargeRecord::ShowcaseLightningDischargeRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RecordEntry(RecordClassification::Illumination)
{
    (void)Telemetry;
    (void)DirtyRevision;
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Desc;
    Desc.StableId    = "lightning";
    Desc.Group       = "Environment";
    Desc.DisplayName = "Lightning Discharge";
    Desc.Category    = "Dielectric Leader Bolt";
    Desc.Glyph       = "zap";
    Desc.Colour      = "#c084fc";
    Desc.Description = "1:1 VehicleHMI branched cloud-to-ground lightning discharge with internal volumetric cloud "
                       "scattering.",
    Desc.Enabled     = &Enabled;
    Desc.Revision    = DirtyRevision;
    Desc.QueryLiveMeta = [this]() -> std::string { return Enabled ? "Armed" : "Standby"; };
    Desc.Actions.push_back({"Trigger Bolt Strike", 1, "", [this]() { Enabled = true; TriggerStrikePulse = true; }});
    Desc.Switches.push_back({"In-Cloud Volumetric Scattering", &IlluminateCloudCore});
    Desc.ScalarFields.push_back({"Strike Cadence", "1/min", 0.5, 30.0, 0.5, 1, &StrikeCadencePerMin, "DISCHARGE"});
    Desc.ScalarFields.push_back({"Channel Radiance", "MW/sr", 1.0, 40.0, 0.5, 1, &ChannelRadiance, "DISCHARGE"});
    Desc.ScalarFields.push_back({"Leader Branching", "-", 0.0, 1.0, 0.02, 2, &BranchComplexity, "DISCHARGE"});
    RegisterShowcaseEditorRecord(Token(), Desc.DisplayName, std::move(Desc));
#endif
}

//====================================================================================================================================
//                                      GROUP 3: FORCEFIELD (2 COMPONENTS)
//====================================================================================================================================

ShowcaseWindForcefieldRecord::ShowcaseWindForcefieldRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RecordEntry(RecordClassification::Physics)
{
    (void)Telemetry;
    (void)DirtyRevision;
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Desc;
    Desc.StableId    = "wind";
    Desc.Group       = "Forcefield";
    Desc.DisplayName = "Wind Forcefield";
    Desc.Category    = "3D Turbulent WindField";
    Desc.Glyph       = "wind";
    Desc.Colour      = "#2dd4bf";
    Desc.Description = "1:1 VehicleHMI 3D divergence-free curl-noise wind field advecting Volumetric Clouds, PlumeFluid "
                       "pyro smoke, Rain/Snow/Hail trajectories, and SparkParticles.";
    Desc.Enabled     = &Enabled;
    Desc.Revision    = DirtyRevision;
    Desc.QueryLiveMeta = [this]() -> std::string { return FormatMeta1("%.1f m/s", MeanSpeedMps); };
    Desc.ConstructInfographic = [this]() {
        char Badge[32] = {};
        std::snprintf(Badge, sizeof(Badge), "Curl %.2f", CurlTurbulence);
        Infographics::DrawPolarVectorCompass("WIND VECTOR & GUST ROSE", static_cast<float>(AzimuthDeg),
                                             static_cast<float>(MeanSpeedMps), static_cast<float>(GustAmplitudeMps),
                                             Badge, 0x2dd4bfu);
    };
    Desc.Switches.push_back({"Couple Into Pyro, Clouds & Weather", &AdvectPlumeAndSnow});
    Desc.ScalarFields.push_back({"Wind Azimuth", "deg", 0.0, 360.0, 1.0, 0, &AzimuthDeg, "AERODYNAMIC FLOW"});
    Desc.ScalarFields.push_back({"Mean Wind Speed", "m/s", 0.0, 28.0, 0.2, 1, &MeanSpeedMps, "AERODYNAMIC FLOW"});
    Desc.ScalarFields.push_back({"Gust Amplitude", "m/s", 0.0, 16.0, 0.2, 1, &GustAmplitudeMps, "AERODYNAMIC FLOW"});
    Desc.ScalarFields.push_back({"Curl-Noise Turbulence", "-", 0.0, 1.0, 0.02, 2, &CurlTurbulence, "AERODYNAMIC FLOW"});
    RegisterShowcaseEditorRecord(Token(), Desc.DisplayName, std::move(Desc));
#endif
}

ShowcaseGravitySolverRecord::ShowcaseGravitySolverRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RecordEntry(RecordClassification::Physics)
{
    (void)Telemetry;
    (void)DirtyRevision;
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Desc;
    Desc.StableId    = "jolt_solver";
    Desc.Group       = "Forcefield";
    Desc.DisplayName = "Jolt Physics Solver";
    Desc.Category    = "Jolt v5.6.0 240 Hz RigidBodySolver";
    Desc.Glyph       = "cpu";
    Desc.Colour      = "#f87171";
    Desc.Description = "Deterministic 240 Hz Jolt v5.6.0 rigid-body & heightfield contact solver driving ControlVehicle, "
                       "slalom cones, elevation ramp, and fractured hulls.";
    Desc.Enabled     = &Enabled;
    Desc.Revision    = DirtyRevision;
    Desc.QueryLiveMeta = [this]() -> std::string { return FormatMeta1("%.0f Hz", SolverTickHz); };
    Desc.ConstructInfographic = [Telemetry]() {
        if (!Telemetry) return;
        char StepBuf[32] = {}, ConeBuf[32] = {};
        std::snprintf(StepBuf, sizeof(StepBuf), "%llu", static_cast<unsigned long long>(Telemetry->PhysicsTotalSteps));
        std::snprintf(ConeBuf, sizeof(ConeBuf), "%u / 14", Telemetry->DisplacedCones);
        const Infographics::KpiBadgeItem Kpis[2] = {
            {"SOLVER STEPS", StepBuf, "Jolt v5.6.0 240 Hz", 0xf87171u},
            {"CONES HIT",    ConeBuf, "Dynamic contacts", 0xfbbf24u},
        };
        Infographics::DrawKpiRow(Kpis, 2);
    };
    Desc.Actions.push_back({"Reset Course & Cones", 1, "", [this]() { RequestCourseReset = true; }});
    Desc.Switches.push_back({"Async Dedicated Physics Thread", &AsyncPhysicsWorker});
    Desc.ScalarFields.push_back({"Gravitational Accel", "m/s2", 1.62, 19.62, 0.05, 2, &GravityMps2, "RIGID BODY SOLVER"});
    Desc.ScalarFields.push_back({"Fixed Substep Rate", "Hz", 60.0, 480.0, 30.0, 0, &SolverTickHz, "RIGID BODY SOLVER"});
    Desc.ScalarFields.push_back({"Asphalt Contact Mu", "-", 0.20, 1.40, 0.02, 2, &ContactFriction, "RIGID BODY SOLVER"});
    RegisterShowcaseEditorRecord(Token(), Desc.DisplayName, std::move(Desc));
#endif
}

//====================================================================================================================================
//                                       GROUP 4: VEHICLE (6 COMPONENTS)
//====================================================================================================================================

ShowcaseControlVehicleRecord::ShowcaseControlVehicleRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RecordEntry(RecordClassification::Vehicle)
{
    (void)Telemetry;
    (void)DirtyRevision;
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Desc;
    Desc.StableId    = "vehicle";
    Desc.Group       = "Vehicle";
    Desc.DisplayName = "ControlVehicle Chassis";
    Desc.Category    = "3D Facet Vehicle + Jolt Assembly";
    Desc.Glyph       = "car";
    Desc.Colour      = "#e1d34a";
    Desc.Description = "1:1 ControlVehicle body, glass, rims, tyres, and interior HMI cockpit driven by Jolt v5.6.0 + "
                       "GRIT propulsion. Supports Autopilot Slalom or live WASD driving.";
    Desc.Enabled     = &Enabled;
    Desc.Revision    = DirtyRevision;
    Desc.QueryLiveMeta = [Telemetry]() -> std::string {
        return Telemetry ? FormatMeta1("%.0f km/h", Telemetry->SpeedKmh) : "0 km/h";
    };
    Desc.ConstructInfographic = [Telemetry]() {
        if (!Telemetry) return;
        Infographics::DrawTwinRadialGauges("VEHICLE SPEED", Telemetry->SpeedKmh, 0.0f, 180.0f, "km/h", 0xe1d34au,
                                           "ENGINE SPEED",  Telemetry->EngineRpm, 0.0f, 7600.0f, "RPM", 0x2fe6a7u);
        char LiveSpd[48] = {};
        std::snprintf(LiveSpd, sizeof(LiveSpd), "Gear %d \xC2\xB7 %.1f km/h", Telemetry->CurrentGear, Telemetry->SpeedKmh);
        Infographics::DrawSparklineCard("VELOCITY TELEMETRY TRACE", LiveSpd,
                                        Telemetry->SpeedHistory.data(), Telemetry->SpeedHistory.size(),
                                        0.0f, 140.0f, 0xe1d34au);
    };
    Desc.Actions.push_back({"Respawn Origin", 1, "", [this]() { TriggerRespawn = true; }});
    Desc.ChoiceFields.push_back({"Clearcoat Paint", {{"Pearl", 0}, {"Emerald", 1}, {"Crimson", 2}, {"Cobalt", 3}}, &PaintPreset, true});
    Desc.ChoiceFields.push_back({"Driver Control Mode", {{"Parked", 0}, {"Autopilot", 1}, {"WASD Live", 2}}, &DriveProgram, true});
    Desc.Switches.push_back({"Latch Cabin Doors Closed", &DoorsClosed});
    Desc.ScalarFields.push_back({"Curb Mass", "kg", 950.0, 2600.0, 10.0, 0, &ChassisMassKg, "CHASSIS INERTIA"});
    Desc.ScalarFields.push_back({"Centre of Gravity Z", "m", 0.32, 0.78, 0.01, 2, &CgHeightM, "CHASSIS INERTIA"});
    Desc.ScalarFields.push_back({"Aero Drag Cd", "-", 0.18, 0.55, 0.01, 2, &AeroDragCd, "AERODYNAMICS"});
    Desc.ScalarFields.push_back({"Autopilot Target Speed", "km/h", 15.0, 130.0, 1.0, 0, &CruiseTargetKmh, "AUTOPILOT"});
    RegisterShowcaseEditorRecord(Token(), Desc.DisplayName, std::move(Desc));
#endif
}

ShowcasePropulsionDrivetrainRecord::ShowcasePropulsionDrivetrainRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RecordEntry(RecordClassification::Vehicle)
{
    (void)Telemetry;
    (void)DirtyRevision;
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Desc;
    Desc.StableId    = "propulsion";
    Desc.Group       = "Vehicle";
    Desc.DisplayName = "GRIT Propulsion & Gearbox";
    Desc.Category    = "Engine Torque + AWD Differentials";
    Desc.Glyph       = "gauge";
    Desc.Colour      = "#2fe6a7";
    Desc.Description = "1:1 GRIT powertrain: tabular full-load torque curve, 6-speed automatic shift logic, viscous AWD "
                       "centre torque split, and wheel-slip traction control.";
    Desc.Enabled     = &Enabled;
    Desc.Revision    = DirtyRevision;
    Desc.QueryLiveMeta = [Telemetry]() -> std::string {
        return Telemetry ? FormatMeta1("%.0f RPM", Telemetry->EngineRpm) : "850 RPM";
    };
    Desc.ConstructInfographic = [Telemetry]() {
        if (!Telemetry) return;
        char LiveRpm[48] = {};
        std::snprintf(LiveRpm, sizeof(LiveRpm), "%.0f RPM \xC2\xB7 Thr %.0f%%", Telemetry->EngineRpm, Telemetry->ThrottlePedal * 100.0f);
        Infographics::DrawSparklineCard("ENGINE RPM HISTORY", LiveRpm,
                                        Telemetry->RpmHistory.data(), Telemetry->RpmHistory.size(),
                                        600.0f, 7600.0f, 0x2fe6a7u);
    };
    Desc.ChoiceFields.push_back({"Driveline Architecture", {{"RWD", 0}, {"FWD", 1}, {"AWD Split", 2}}, &DrivetrainLayout, true});
    Desc.Switches.push_back({"Automatic Gearshift Schedule", &AutoTransmission});
    Desc.Switches.push_back({"Slip-Regulated Traction Control", &TractionControl});
    Desc.ScalarFields.push_back({"Peak Engine Torque", "Nm", 220.0, 980.0, 10.0, 0, &PeakTorqueNm, "POWERTRAIN"});
    Desc.ScalarFields.push_back({"Fuel Cut Redline", "rpm", 5000.0, 9000.0, 100.0, 0, &RedlineRpm, "POWERTRAIN"});
    Desc.ScalarFields.push_back({"Front Axle Torque Share", "-", 0.0, 1.0, 0.02, 2, &FrontTorqueSplit, "POWERTRAIN"});
    Desc.ScalarFields.push_back({"Final Drive Ratio", "-", 2.60, 5.10, 0.05, 2, &FinalDriveRatio, "POWERTRAIN"});
    RegisterShowcaseEditorRecord(Token(), Desc.DisplayName, std::move(Desc));
#endif
}

ShowcaseSuspensionCornerRecord::ShowcaseSuspensionCornerRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RecordEntry(RecordClassification::Vehicle)
{
    (void)Telemetry;
    (void)DirtyRevision;
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Desc;
    Desc.StableId    = "suspension";
    Desc.Group       = "Vehicle";
    Desc.DisplayName = "Coilover Suspension";
    Desc.Category    = "4-Corner Damper & Anti-Roll";
    Desc.Glyph       = "sliders";
    Desc.Colour      = "#34d399";
    Desc.Description = "1:1 VehicleHMI front/rear progressive spring rates, asymmetric bump/rebound damping, and roll-bar "
                       "stiffness.";
    Desc.Enabled     = &Enabled;
    Desc.Revision    = DirtyRevision;
    Desc.QueryLiveMeta = [this]() -> std::string { return FormatMeta1("%.0f kN/m", FrontSpringKnPerM); };
    Desc.Switches.push_back({"Couple Front & Rear Anti-Roll Bars", &AntiRollBars});
    Desc.ScalarFields.push_back({"Front Spring Rate", "kN/m", 18.0, 95.0, 1.0, 1, &FrontSpringKnPerM, "SPRINGS & DAMPERS"});
    Desc.ScalarFields.push_back({"Rear Spring Rate", "kN/m", 18.0, 95.0, 1.0, 1, &RearSpringKnPerM, "SPRINGS & DAMPERS"});
    Desc.ScalarFields.push_back({"Compression Bump", "Ns/m", 1200.0, 9000.0, 100.0, 0, &BumpDampingNsPerM, "SPRINGS & DAMPERS"});
    Desc.ScalarFields.push_back({"Extension Rebound", "Ns/m", 1500.0, 11000.0, 100.0, 0, &ReboundDampingNsPerM, "SPRINGS & DAMPERS"});
    Desc.ScalarFields.push_back({"Ride Height Trim", "mm", -35.0, 45.0, 1.0, 0, &RideHeightOffsetMm, "SPRINGS & DAMPERS"});
    RegisterShowcaseEditorRecord(Token(), Desc.DisplayName, std::move(Desc));
#endif
}

ShowcaseTyreThermalRecord::ShowcaseTyreThermalRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RecordEntry(RecordClassification::Tyre)
{
    (void)Telemetry;
    (void)DirtyRevision;
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Desc;
    Desc.StableId    = "tyres";
    Desc.Group       = "Vehicle";
    Desc.DisplayName = "GRIT .tyrx Tyres & Thermals";
    Desc.Category    = "Pacejka Slip + 3-Layer Carcass";
    Desc.Glyph       = "disc";
    Desc.Colour      = "#63a8ff";
    Desc.Description = "GRIT .tyrx calibrated tyre contact model with live 4-corner tread/carcass temperatures, normal "
                       "loads, combined slip, snow furrow carving, and puddle displacement.";
    Desc.Enabled     = &Enabled;
    Desc.Revision    = DirtyRevision;
    Desc.QueryLiveMeta = [Telemetry]() -> std::string {
        return Telemetry ? FormatMeta1("%.0f C", Telemetry->WheelTempC[0]) : "48 C";
    };
    Desc.ConstructInfographic = [Telemetry]() {
        if (!Telemetry) return;
        Infographics::DrawQuadWheelMatrixCard(Telemetry->WheelTempC, Telemetry->WheelLoadKn, Telemetry->WheelSlip);
    };
    Desc.ChoiceFields.push_back({"Tyre Compound", {{"All-Weather", 0}, {"Sport .tyrx", 1}, {"Snow Stud", 2}}, &CompoundChoice, true});
    Desc.Switches.push_back({"Emit Rim Sparks Under Extreme Slip", &EmitWheelSparksOnRim});
    Desc.ScalarFields.push_back({"Peak Friction Mu", "-", 0.45, 1.65, 0.02, 2, &PeakFrictionMu, "CONTACT PATCH"});
    Desc.ScalarFields.push_back({"Cold Inflation Pressure", "bar", 1.60, 3.20, 0.05, 2, &InflationBar, "CONTACT PATCH"});
    Desc.ScalarFields.push_back({"Frictional Flash Heating", "-", 0.0, 2.50, 0.05, 2, &ThermalHeatingRate, "CONTACT PATCH"});
    RegisterShowcaseEditorRecord(Token(), Desc.DisplayName, std::move(Desc));
#endif
}

ShowcaseCabinHmiRecord::ShowcaseCabinHmiRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RecordEntry(RecordClassification::Interface)
{
    (void)Telemetry;
    (void)DirtyRevision;
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Desc;
    Desc.StableId    = "cabin_hmi";
    Desc.Group       = "Vehicle";
    Desc.DisplayName = "3D Cabin VehicleHMI";
    Desc.Category    = "Diegetic Cluster + CabinIconDepot";
    Desc.Glyph       = "monitor";
    Desc.Colour      = "#38bdf8";
    Desc.Description = "1:1 diegetic 3D VehicleCabinHmi inside ControlVehicle: live digital speed/gear/ADAS instrument "
                       "cluster, centre infotainment map, CabinIconDepot telltales, and emissive ambient trim.";
    Desc.Enabled     = &Enabled;
    Desc.Revision    = DirtyRevision;
    Desc.QueryLiveMeta = [this]() -> std::string { return FormatMeta1("%.0f nits", ClusterLuminanceNits); };
    Desc.Actions.push_back({"Focus Cabin Camera", 1, "", [DirtyRevision]() {
        if (DirtyRevision) ++(*DirtyRevision);
    }});
    Desc.ChoiceFields.push_back({"HMI Display Page", {{"Sport Gauge", 0}, {"ADAS Corridor", 1}, {"Thermal/Weather", 2}}, &HmiThemeMode, true});
    Desc.Switches.push_back({"Render ADAS Lane & Radar Corridor", &AdasRadarCorridor});
    Desc.Switches.push_back({"Illuminate ISO CabinIconDepot Telltales", &CabinIconDepotActive});
    Desc.ScalarFields.push_back({"Driver Cluster Luminance", "nits", 40.0, 900.0, 10.0, 0, &ClusterLuminanceNits, "CABIN DISPLAYS"});
    Desc.ScalarFields.push_back({"Centre Console Screen", "nits", 40.0, 900.0, 10.0, 0, &CentreScreenNits, "CABIN DISPLAYS"});
    Desc.ScalarFields.push_back({"Ambient LED Trim Strip", "nits", 0.0, 250.0, 5.0, 0, &AmbientTrimStripNits, "CABIN DISPLAYS"});
    Desc.ScalarFields.push_back({"Steering Wheel Trim", "deg", -360.0, 360.0, 2.0, 0, &SteeringWheelAngleDeg, "CABIN DISPLAYS"});
    RegisterShowcaseEditorRecord(Token(), Desc.DisplayName, std::move(Desc));
#endif
}

ShowcaseHeadlampOpticsRecord::ShowcaseHeadlampOpticsRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RecordEntry(RecordClassification::Illumination)
{
    (void)Telemetry;
    (void)DirtyRevision;
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Desc;
    Desc.StableId    = "headlamps";
    Desc.Group       = "Vehicle";
    Desc.DisplayName = "Headlamps & Taillamps";
    Desc.Category    = "ECE Cut-Off Projectors + DRL";
    Desc.Glyph       = "sun";
    Desc.Colour      = "#fde047";
    Desc.Description = "1:1 VehicleHMI projector headlamps with steering-coupled swivel, DRL signature blades, and "
                       "brake-coupled ruby taillamps.";
    Desc.Enabled     = &Enabled;
    Desc.Revision    = DirtyRevision;
    Desc.QueryLiveMeta = [this]() -> std::string { return HighBeamActive ? "High Beam" : "Low Beam"; };
    Desc.Switches.push_back({"Engage Main High Beams", &HighBeamActive});
    Desc.Switches.push_back({"Daytime Running Signature Blades", &DaytimeRunningStrip});
    Desc.Switches.push_back({"Force Brake Taillamp Illumination", &BrakeLampOverride});
    Desc.ScalarFields.push_back({"Luminous Intensity", "cd", 0.0, 65000.0, 500.0, 0, &HeadlampIntensityCd, "HEADLAMP OPTICS"});
    Desc.ScalarFields.push_back({"Vertical Cut-Off Pitch", "deg", -6.0, 4.0, 0.1, 1, &BeamPitchDeg, "HEADLAMP OPTICS"});
    Desc.ScalarFields.push_back({"Steering Swivel Authority", "deg", 0.0, 24.0, 0.5, 1, &AdaptiveSwivelDeg, "HEADLAMP OPTICS"});
    RegisterShowcaseEditorRecord(Token(), Desc.DisplayName, std::move(Desc));
#endif
}

//====================================================================================================================================
//                                       GROUP 5: EFFECTS (4 COMPONENTS)
//====================================================================================================================================

ShowcasePyroPlumeRecord::ShowcasePyroPlumeRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RecordEntry(RecordClassification::Environment)
{
    (void)Telemetry;
    (void)DirtyRevision;
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Desc;
    Desc.StableId    = "pyro_plume";
    Desc.Group       = "Effects";
    Desc.DisplayName = "Pyro PlumeFluid (5.13x)";
    Desc.Category    = "Sparse-Tile Red-Black Combustion";
    Desc.Glyph       = "flame";
    Desc.Colour      = "#f97316";
    Desc.Description = "5.13x accelerated PlumeFluid combustion & buoyant smoke solver with blackbody emission, Beer-"
                       "Lambert self-shadowing, and full reflection inside mirrors & seamless portals.";
    Desc.Enabled     = &Enabled;
    Desc.Revision    = DirtyRevision;
    Desc.QueryLiveMeta = [Telemetry]() -> std::string {
        return Telemetry ? FormatMeta1("%.2f ms", Telemetry->PyroStepMs) : "0.85 ms";
    };
    Desc.ConstructInfographic = [Telemetry]() {
        if (!Telemetry) return;
        Infographics::DrawBlackbodyRampCard("BLACKBODY COMBUSTION SPECTRUM",
                                            Telemetry->PyroPeakKelvin, Telemetry->PyroActiveVoxelsPct);
        char MsCap[48] = {};
        std::snprintf(MsCap, sizeof(MsCap), "%.2f ms/step (5.13x SIMD)", Telemetry->PyroStepMs);
        Infographics::DrawSparklineCard("SOLVER STEP COST TRACE", MsCap,
                                        Telemetry->PyroMsHistory.data(), Telemetry->PyroMsHistory.size(),
                                        0.0f, 3.5f, 0xf97316u);
    };
    Desc.Actions.push_back({"Ignite Detonation Burst", 1, "", [this]() { TriggerDetonationBurst = true; }});
    Desc.ChoiceFields.push_back({"Combustion Preset", {{"Campfire", 0}, {"Detonation", 1}, {"Burnout", 2}}, &PlumePreset, true});
    Desc.ChoiceFields.push_back({"Voxel Solver Grade", {{"Fast", 0}, {"Balanced", 1}, {"Hero", 2}}, &QualityGrade, true});
    Desc.Switches.push_back({"Multi-Scattering Soot Self-Shadow", &SelfShadowScattering});
    Desc.ScalarFields.push_back({"Fuel Injection Rate", "-", 0.0, 3.0, 0.05, 2, &FuelInjectionRate, "PYRO THERMODYNAMICS"});
    Desc.ScalarFields.push_back({"Core Flame Temperature", "K", 700.0, 2150.0, 25.0, 0, &BurnTemperatureK, "PYRO THERMODYNAMICS"});
    Desc.ScalarFields.push_back({"Thermal Buoyancy Lift", "m/s2", 0.5, 12.0, 0.2, 1, &BuoyancyLift, "PYRO THERMODYNAMICS"});
    Desc.ScalarFields.push_back({"Vorticity Confinement", "-", 0.0, 6.0, 0.1, 1, &VorticityConfinement, "PYRO THERMODYNAMICS"});
    RegisterShowcaseEditorRecord(Token(), Desc.DisplayName, std::move(Desc));
#endif
}

ShowcaseSnowMoundRecord::ShowcaseSnowMoundRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RecordEntry(RecordClassification::Geometry)
{
    (void)Telemetry;
    (void)DirtyRevision;
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Desc;
    Desc.StableId    = "snow_mound";
    Desc.Group       = "Effects";
    Desc.DisplayName = "3D SnowSurface Mound";
    Desc.Category    = "Single-Mesh (CC=1) Accumulated Snow";
    Desc.Glyph       = "mountain";
    Desc.Colour      = "#e2e8f0";
    Desc.Description = "Snowfall-accumulated 3D Marching-Squares SnowSurface mound (0 pre-sculpted blob, 0 floor-texture "
                       "whitening, verified ConnectedComponents == 1) with live tyre furrow carving.";
    Desc.Enabled     = &Enabled;
    Desc.Revision    = DirtyRevision;
    Desc.QueryLiveMeta = [Telemetry]() -> std::string {
        if (!Telemetry) return "CC=1";
        char Buf[40] = {};
        std::snprintf(Buf, sizeof(Buf), "CC=%u \xC2\xB7 %.0fcm", Telemetry->SnowConnectedComponents, Telemetry->SnowPeakDepthCm);
        return Buf;
    };
    Desc.ConstructInfographic = [Telemetry]() {
        if (!Telemetry) return;
        char CcBuf[24] = {}, PkBuf[24] = {}, TrBuf[24] = {};
        std::snprintf(CcBuf, sizeof(CcBuf), "%u mesh", Telemetry->SnowConnectedComponents);
        std::snprintf(PkBuf, sizeof(PkBuf), "%.1f cm", Telemetry->SnowPeakDepthCm);
        std::snprintf(TrBuf, sizeof(TrBuf), "%u", Telemetry->SnowTriangleCount);
        const Infographics::KpiBadgeItem Kpis[3] = {
            {"TOPOLOGY",   CcBuf, "Invariant CC == 1", 0x2fe6a7u},
            {"PEAK DRIFT", PkBuf, "Snowfall-deposited", 0xe2e8f0u},
            {"TRIANGLES",  TrBuf, "Marching-Squares", 0x38bdf8u},
        };
        Infographics::DrawKpiRow(Kpis, 3);
        Infographics::DrawProfileCrossSectionCard("DRIFT MOUND CROSS-SECTION (CM)", PkBuf,
                                                  Telemetry->SnowCrossSectionCm.data(),
                                                  Telemetry->SnowCrossSectionCm.size(),
                                                  40.0f, 0xe2e8f0u);
    };
    Desc.Actions.push_back({"Re-Deposit Fresh Drift", 1, "", [this]() { RebuildWarmupDrift = true; }});
    Desc.Switches.push_back({"Carve Real-Time Tyre Tracks & Furrows", &CarveWheelFurrows});
    Desc.ScalarFields.push_back({"Snowfall Deposition Gain", "-", 0.0, 3.0, 0.05, 2, &AccumulationRateScale, "SNOW SURFACE"});
    Desc.ScalarFields.push_back({"Wheel Compaction Stiffness", "-", 0.1, 1.0, 0.02, 2, &CompactionStiffness, "SNOW SURFACE"});
    Desc.ScalarFields.push_back({"Subsurface Albedo Scatter", "-", 0.2, 1.0, 0.02, 2, &SubsurfaceScatter, "SNOW SURFACE"});
    RegisterShowcaseEditorRecord(Token(), Desc.DisplayName, std::move(Desc));
#endif
}

ShowcaseShallowWaterRecord::ShowcaseShallowWaterRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RecordEntry(RecordClassification::Environment)
{
    (void)Telemetry;
    (void)DirtyRevision;
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Desc;
    Desc.StableId    = "shallow_water";
    Desc.Group       = "Effects";
    Desc.DisplayName = "ShallowWater Puddles";
    Desc.Category    = "Smooth 2.5D SWE (0 Foam, 0 Splash)";
    Desc.Glyph       = "droplet";
    Desc.Colour      = "#06b6d4";
    Desc.Description = "Smooth 2.5D shallow-water heightfield basin with bisected wet shoreline, raindrop ripples, tyre "
                       "wake waves, and strict 0 foam / 0 splash specular clarity.";
    Desc.Enabled     = &Enabled;
    Desc.Revision    = DirtyRevision;
    Desc.QueryLiveMeta = [Telemetry]() -> std::string {
        return Telemetry ? FormatMeta1("%.1f mm", Telemetry->WaterMeanDepthMm) : "22.0 mm";
    };
    Desc.ConstructInfographic = [Telemetry]() {
        if (!Telemetry) return;
        char DpBuf[24] = {}, FmBuf[24] = {}, SpBuf[24] = {};
        std::snprintf(DpBuf, sizeof(DpBuf), "%.1f mm", Telemetry->WaterMeanDepthMm);
        std::snprintf(FmBuf, sizeof(FmBuf), "%u", Telemetry->WaterFoamParticles);
        std::snprintf(SpBuf, sizeof(SpBuf), "%u", Telemetry->WaterSplashParticles);
        const Infographics::KpiBadgeItem Kpis[3] = {
            {"MEAN DEPTH", DpBuf, "Bisected shoreline", 0x06b6d4u},
            {"FOAM",       FmBuf, "Strict 0 invariant", 0x2fe6a7u},
            {"SPLASH",     SpBuf, "Strict 0 invariant", 0x2fe6a7u},
        };
        Infographics::DrawKpiRow(Kpis, 3);
        Infographics::DrawProfileCrossSectionCard("WATER SURFACE RIPPLE PROFILE (MM)", DpBuf,
                                                  Telemetry->WaterCrossSectionMm.data(),
                                                  Telemetry->WaterCrossSectionMm.size(),
                                                  36.0f, 0x06b6d4u);
    };
    Desc.Switches.push_back({"Raindrop Capillary Ripples", &CoupleRaindropRipples});
    Desc.Switches.push_back({"Tyre Hydrodynamic Wake", &CoupleTyreDisplacement});
    Desc.ScalarFields.push_back({"Basin Water Depth", "mm", 4.0, 55.0, 0.5, 1, &BasinMeanDepthMm, "2.5D SHALLOW WATER"});
    Desc.ScalarFields.push_back({"Gravity Wave Speed Scale", "-", 0.3, 2.0, 0.05, 2, &WaveCflSpeed, "2.5D SHALLOW WATER"});
    Desc.ScalarFields.push_back({"Viscous Ripple Damping", "-", 0.90, 0.999, 0.002, 3, &VelocityDamping, "2.5D SHALLOW WATER"});
    Desc.ScalarFields.push_back({"Dielectric Fresnel Mirror", "-", 0.2, 1.0, 0.02, 2, &FresnelReflectivity, "2.5D SHALLOW WATER"});
    RegisterShowcaseEditorRecord(Token(), Desc.DisplayName, std::move(Desc));
#endif
}

ShowcaseSparkEmitterRecord::ShowcaseSparkEmitterRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RecordEntry(RecordClassification::Illumination)
{
    (void)Telemetry;
    (void)DirtyRevision;
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Desc;
    Desc.StableId    = "sparks";
    Desc.Group       = "Effects";
    Desc.DisplayName = "Ballistic SparkParticles";
    Desc.Category    = "Velocity-Swept Glowing Sparks";
    Desc.Glyph       = "sparkles";
    Desc.Colour      = "#fb923c";
    Desc.Description = "Crisp shutter-swept ballistic SparkParticles with aerodynamic drag, multi-surface specular bounce, "
                       "and T^4 radiative blackbody cooling.";
    Desc.Enabled     = &Enabled;
    Desc.Revision    = DirtyRevision;
    Desc.QueryLiveMeta = [Telemetry]() -> std::string {
        if (!Telemetry) return "Active";
        char Buf[32] = {};
        std::snprintf(Buf, sizeof(Buf), "%u live", Telemetry->ActiveSparkCount);
        return Buf;
    };
    Desc.Actions.push_back({"Emit Impact Spark Shower", 1, "", [this]() { TriggerSparkBurst = true; }});
    Desc.ScalarFields.push_back({"Continuous Spawn Rate", "1/s", 0.0, 500.0, 10.0, 0, &EmissionRatePerSec, "BALLISTIC SPARKS"});
    Desc.ScalarFields.push_back({"Ejection Speed", "m/s", 2.0, 28.0, 0.5, 1, &LaunchSpeedMps, "BALLISTIC SPARKS"});
    Desc.ScalarFields.push_back({"Asphalt Bounce Restitution", "-", 0.1, 0.92, 0.02, 2, &BounceRestitution, "BALLISTIC SPARKS"});
    Desc.ScalarFields.push_back({"Motion-Blur Shutter Window", "ms", 2.0, 35.0, 0.5, 1, &ShutterStreakMs, "BALLISTIC SPARKS"});
    RegisterShowcaseEditorRecord(Token(), Desc.DisplayName, std::move(Desc));
#endif
}

//====================================================================================================================================
//                                     GROUP 6: DESTRUCTION (1 COMPONENT)
//====================================================================================================================================

ShowcaseSolidFractureRecord::ShowcaseSolidFractureRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RecordEntry(RecordClassification::Geometry)
{
    (void)Telemetry;
    (void)DirtyRevision;
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Desc;
    Desc.StableId    = "solid_fracture";
    Desc.Group       = "Destruction";
    Desc.DisplayName = "Griffith SolidFracture";
    Desc.Category    = "3D Voronoi Convex Cleavage";
    Desc.Glyph       = "box";
    Desc.Colour      = "#a78bfa";
    Desc.Description = "Griffith strain-energy brittle fracture cleaving concrete calibration monoliths into watertight "
                       "3D Voronoi convex hulls with 100.00% volume conservation.";
    Desc.Enabled     = &Enabled;
    Desc.Revision    = DirtyRevision;
    Desc.QueryLiveMeta = [Telemetry]() -> std::string {
        if (!Telemetry) return "28 hulls";
        char Buf[32] = {};
        std::snprintf(Buf, sizeof(Buf), "%u hulls", Telemetry->FractureHullCount);
        return Buf;
    };
    Desc.ConstructInfographic = [Telemetry]() {
        if (!Telemetry) return;
        char HBuf[24] = {}, VBuf[24] = {};
        std::snprintf(HBuf, sizeof(HBuf), "%u", Telemetry->FractureHullCount);
        std::snprintf(VBuf, sizeof(VBuf), "%.2f%%", Telemetry->FractureVolumeConserved);
        const Infographics::KpiBadgeItem Kpis[2] = {
            {"CONVEX HULLS", HBuf, Telemetry->FractureCleaved ? "Cleaved shards" : "Intact monolith", 0xa78bfau},
            {"VOLUME KEPT",  VBuf, "Exact plane clip", 0x2fe6a7u},
        };
        Infographics::DrawKpiRow(Kpis, 2);
        const Infographics::SegmentSlice Slices[3] = {
            {"Core Shards", 0.44f, 0xa78bfau},
            {"Mid Spalls",  0.35f, 0x38bdf8u},
            {"Fine Chips",  0.21f, 0xfbbf24u},
        };
        Infographics::DrawSegmentedDistributionCard("VORONOI FRAGMENT MASS DISTRIBUTION", VBuf, Slices, 3);
    };
    Desc.Actions.push_back({"Cleave Monolith", 1, "", [this]() { CleavedState = true; TriggerCleaveNow = true; }});
    Desc.Actions.push_back({"Reset Intact", 0, "", [this]() { CleavedState = false; TriggerResetIntact = true; }});
    Desc.ChoiceFields.push_back({"Voronoi Seed Count", {{"12 Hulls", 12}, {"20 Hulls", 20}, {"28 Hulls", 28}, {"36 Hulls", 36}}, &TargetVoronoiSites, true});
    Desc.ScalarFields.push_back({"Impact Kinetic Energy", "kJ", 1.0, 60.0, 0.5, 1, &ImpactEnergyKj, "GRIFFITH MECHANICS"});
    Desc.ScalarFields.push_back({"Fracture Toughness Kc", "MPa", 0.4, 4.0, 0.05, 2, &FractureToughnessKc, "GRIFFITH MECHANICS"});
    Desc.ScalarFields.push_back({"Shard Inspection Separation", "m", 0.0, 0.65, 0.01, 2, &RadialShardGapM, "GRIFFITH MECHANICS"});
    RegisterShowcaseEditorRecord(Token(), Desc.DisplayName, std::move(Desc));
#endif
}

//====================================================================================================================================
//                                        GROUP 7: LEVEL (2 COMPONENTS)
//====================================================================================================================================

ShowcaseProvingGroundsCourseRecord::ShowcaseProvingGroundsCourseRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RecordEntry(RecordClassification::Content)
{
    (void)Telemetry;
    (void)DirtyRevision;
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Desc;
    Desc.StableId    = "proving_grounds";
    Desc.Group       = "Level";
    Desc.DisplayName = "Proving Grounds Arena";
    Desc.Category    = "Track Pad + Cones + Ramp + Gantry";
    Desc.Glyph       = "map";
    Desc.Colour      = "#2dd4bf";
    Desc.Description = "1:1 VehicleHMI proving-grounds arena: calibrated asphalt pad, 14 Jolt dynamic slalom cones, "
                       "launch ramp, kerbs, and photometric luminaire gantry.";
    Desc.Enabled     = &Enabled;
    Desc.Revision    = DirtyRevision;
    Desc.QueryLiveMeta = [Telemetry]() -> std::string {
        if (!Telemetry) return "14 cones";
        char Buf[32] = {};
        std::snprintf(Buf, sizeof(Buf), "%u hit", Telemetry->DisplacedCones);
        return Buf;
    };
    Desc.Switches.push_back({"Render 14 Dynamic Slalom Cones", &ShowSlalomCones});
    Desc.Switches.push_back({"Render Overhead Calibration Gantry", &ShowCalibrationGantry});
    Desc.ScalarFields.push_back({"Asphalt Micro-Roughness", "-", 0.05, 0.85, 0.02, 2, &AsphaltRoughness, "SURFACE MATERIALS"});
    Desc.ScalarFields.push_back({"Wet Specular Patchiness", "-", 0.0, 1.0, 0.02, 2, &WetRoadPatchiness, "SURFACE MATERIALS"});
    Desc.ScalarFields.push_back({"Test Ramp Height Scale", "-", 0.25, 1.75, 0.05, 2, &RampElevationScale, "COURSE GEOMETRY"});
    RegisterShowcaseEditorRecord(Token(), Desc.DisplayName, std::move(Desc));
#endif
}

ShowcaseSeamlessPortalsRecord::ShowcaseSeamlessPortalsRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RecordEntry(RecordClassification::Geometry)
{
    (void)Telemetry;
    (void)DirtyRevision;
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Desc;
    Desc.StableId    = "portals_mirrors";
    Desc.Group       = "Level";
    Desc.DisplayName = "Portals & Planar Mirror";
    Desc.Category    = "Circular & Rectangular PortalMechanics";
    Desc.Glyph       = "aperture";
    Desc.Colour      = "#38bdf8";
    Desc.Description = "Seamless circular & rectangular portals + planar inspection mirror working identically on GTX "
                       "and RTX, reflecting clouds/sky/fog/pyro, rendering split exit-side duplicate meshes, and "
                       "blocking transit when obstructed.";
    Desc.Enabled     = &Enabled;
    Desc.Revision    = DirtyRevision;
    Desc.QueryLiveMeta = [this]() -> std::string { return PrimaryApertureShape == 1 ? "Circular+Rect" : "Rect Pair"; };
    Desc.ConstructInfographic = [this, Telemetry]() {
        if (!Telemetry) return;
        const Infographics::KpiBadgeItem Kpis[2] = {
            {"APERTURES", PrimaryApertureShape == 1 ? "Circular + Rect" : "Rectangular", "GTX & RTX parity", 0x38bdf8u},
            {"EXIT GUARD", BlockSolidObstacles ? "Armed" : "Bypassed", ExitSideDuplicateMesh ? "Split mesh ON" : "Split OFF", 0x2fe6a7u},
        };
        Infographics::DrawKpiRow(Kpis, 2);
    };
    Desc.ChoiceFields.push_back({"Aperture Topology", {{"Rectangular Arch", 0}, {"Circular + Rect", 1}}, &PrimaryApertureShape, true});
    Desc.Switches.push_back({"Emit Exit-Side Split Duplicate Mesh", &ExitSideDuplicateMesh});
    Desc.Switches.push_back({"Block Transit On Exit Obstruction", &BlockSolidObstacles});
    Desc.Switches.push_back({"Trackside Planar Calibration Mirror", &EnablePlanarMirror});
    Desc.ScalarFields.push_back({"Circular Portal Radius", "m", 1.10, 3.40, 0.05, 2, &CircularPortalRadiusM, "PORTAL MECHANICS"});
    Desc.ScalarFields.push_back({"Ray Recursion Hop Limit", "hops", 1.0, 4.0, 1.0, 0, &MaxRecursionHops, "PORTAL MECHANICS"});
    RegisterShowcaseEditorRecord(Token(), Desc.DisplayName, std::move(Desc));
#endif
}

ShowcasePlaceableObjectRecord::ShowcasePlaceableObjectRecord(
    const char *StableIdStr, const char *DisplayLabel,
    int32_t InitialShape, int32_t InitialMaterial,
    double InitialX, double InitialY, double InitialZ,
    double HalfX, double HalfY, double HalfZ,
    bool InitiallyEnabled,
    const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RecordEntry(RecordClassification::Geometry)
    , Enabled(InitiallyEnabled)
    , ShapePreset(InitialShape)
    , MaterialPreset(InitialMaterial)
    , PosX(InitialX)
    , PosY(InitialY)
    , PosZ(InitialZ)
    , HalfExtentX(HalfX)
    , HalfExtentY(HalfY)
    , HalfExtentZ(HalfZ)
{
    (void)StableIdStr;
    (void)DisplayLabel;
    (void)Telemetry;
    (void)DirtyRevision;
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Desc;
    Desc.StableId             = StableIdStr;
    Desc.Group                = "Level";
    Desc.DisplayName          = DisplayLabel;
    Desc.Category             = "Placeable 3D Static Mesh & Nanite Asset";
    Desc.Glyph                = "box";
    Desc.Colour               = "#8fb3a4";
    Desc.DedicatedEditorTitle = "3D Object & Nanite LOD Studio";
    Desc.Description          = "Placeable 3D scene object backed by OS zero-copy shared memory. Edit transform, half-extents, "
                                "Nanite cluster shape, and PBR material live in both its Dedicated 3D Studio and the main viewport.";
    Desc.Enabled              = &Enabled;
    Desc.Revision             = DirtyRevision;
    Desc.QueryLiveMeta        = [this]() -> std::string {
        char Buf[48] = {};
        std::snprintf(Buf, sizeof(Buf), "(%.1f, %.1f) m", PosX, PosY);
        return Buf;
    };
    Desc.ConstructInfographic = [this]() {
        char PosBuf[32] = {}, ExtBuf[32] = {};
        std::snprintf(PosBuf, sizeof(PosBuf), "%.1f, %.1f, %.1f", PosX, PosY, PosZ);
        std::snprintf(ExtBuf, sizeof(ExtBuf), "%.2fx%.2fx%.2f", HalfExtentX * 2.0, HalfExtentY * 2.0, HalfExtentZ * 2.0);
        static const char *const MatNames[5] = {"Concrete", "Orange", "Copper", "Obsidian", "Glass"};
        const Infographics::KpiBadgeItem Kpis[3] = {
            {"WORLD POS", PosBuf, "Shared RAM 0-copy", 0x8fb3a4u},
            {"DIMENSIONS", ExtBuf, "Dual-tier SDF+BVH", 0x38bdf8u},
            {"MATERIAL", MatNames[std::clamp(MaterialPreset, 0, 4)], "Cast sun shadow", 0xe8c27au},
        };
        Infographics::DrawKpiRow(Kpis, 3);
    };
    Desc.Actions.push_back({"Snap To Ground", 0, "", [this]() { PosZ = HalfExtentZ; }});
    Desc.Actions.push_back({"Rotate +45 deg", 0, "", [this]() {
        YawDeg = std::fmod(YawDeg + 45.0, 360.0);
    }});
    Desc.ChoiceFields.push_back({"3D Mesh Topology", {{"Chicane", 0}, {"Pedestal", 1}, {"Arch", 2}, {"Prism", 3}}, &ShapePreset, true});
    Desc.ChoiceFields.push_back({"Surface Material", {{"Concrete", 0}, {"Orange", 1}, {"Copper", 2}, {"Obsidian", 3}, {"Glass", 4}}, &MaterialPreset, true});
    Desc.ScalarFields.push_back({"World Position X", "m", -24.0, 28.0, 0.1, 2, &PosX, "3D TRANSFORM"});
    Desc.ScalarFields.push_back({"World Position Y", "m", -24.0, 24.0, 0.1, 2, &PosY, "3D TRANSFORM"});
    Desc.ScalarFields.push_back({"World Position Z", "m", 0.05, 8.0, 0.05, 2, &PosZ, "3D TRANSFORM"});
    Desc.ScalarFields.push_back({"Yaw Orientation", "deg", -180.0, 180.0, 1.0, 0, &YawDeg, "3D TRANSFORM"});
    Desc.ScalarFields.push_back({"Half-Extent X", "m", 0.15, 4.5, 0.05, 2, &HalfExtentX, "DIMENSIONS & PBR"});
    Desc.ScalarFields.push_back({"Half-Extent Y", "m", 0.15, 4.5, 0.05, 2, &HalfExtentY, "DIMENSIONS & PBR"});
    Desc.ScalarFields.push_back({"Half-Extent Z", "m", 0.15, 4.5, 0.05, 2, &HalfExtentZ, "DIMENSIONS & PBR"});
    Desc.ScalarFields.push_back({"Surface Roughness", "-", 0.04, 0.98, 0.02, 2, &Roughness, "DIMENSIONS & PBR"});
    Desc.ScalarFields.push_back({"Metallic Factor", "-", 0.0, 1.0, 0.02, 2, &Metallic, "DIMENSIONS & PBR"});
    RegisterShowcaseEditorRecord(Token(), Desc.DisplayName, std::move(Desc));
#endif
}

//====================================================================================================================================
//                                      GROUP 8: NETWORKING (1 COMPONENT)
//====================================================================================================================================

ShowcaseStateReplicationRecord::ShowcaseStateReplicationRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RecordEntry(RecordClassification::Interface)
{
    (void)Telemetry;
    (void)DirtyRevision;
#if defined(FRONTIER_EDITOR_PROFILE)
    RecordEditorDescription Desc;
    Desc.StableId    = "state_replication";
    Desc.Group       = "Networking";
    Desc.DisplayName = "48 B StateReplication";
    Desc.Category    = "GRIT 384-Bit Quantized Codec";
    Desc.Glyph       = "radio";
    Desc.Colour      = "#34d399";
    Desc.Description = "Deterministic 48-byte (384-bit) quantized vehicle state replication stream with smallest-three "
                       "quaternion packing, Hermite jitter buffer, and sub-millimetre reconstruction.";
    Desc.Enabled     = &Enabled;
    Desc.Revision    = DirtyRevision;
    Desc.QueryLiveMeta = [this]() -> std::string { return FormatMeta1("48B @ %.0fHz", SendRateHz); };
    Desc.ConstructInfographic = [this, Telemetry]() {
        if (!Telemetry) return;
        char PktBuf[32] = {}, ErrBuf[32] = {}, RateBuf[32] = {};
        std::snprintf(PktBuf, sizeof(PktBuf), "%llu", static_cast<unsigned long long>(Telemetry->ReplicatedPacketsSent));
        std::snprintf(ErrBuf, sizeof(ErrBuf), "%.2f mm", Telemetry->ReplicationRmsPosErrMm);
        std::snprintf(RateBuf, sizeof(RateBuf), "%.1f kbps", static_cast<float>(SendRateHz) * 48.0f * 8.0f * 0.001f);
        const Infographics::KpiBadgeItem Kpis[3] = {
            {"PAYLOAD",  "48 B", "384 bits fixed", 0x34d399u},
            {"PACKETS",  PktBuf, RateBuf, 0x38bdf8u},
            {"RMS POS",  ErrBuf, "Hermite interp", 0xa78bfau},
        };
        Infographics::DrawKpiRow(Kpis, 3);
        const Infographics::SegmentSlice Bits[4] = {
            {"Pos 96b",  96.0f / 384.0f, 0x38bdf8u},
            {"Rot 48b",  48.0f / 384.0f, 0x2fe6a7u},
            {"Vel 96b",  96.0f / 384.0f, 0xfbbf24u},
            {"Whl 144b", 144.0f / 384.0f, 0xa78bfau},
        };
        Infographics::DrawSegmentedDistributionCard("384-BIT PACKET BIT ALLOCATION", "48 Bytes", Bits, 4);
    };
    Desc.Switches.push_back({"Cubic Hermite Snapshot Interpolation", &HermiteInterpolation});
    Desc.Switches.push_back({"Render Replicated Ghost Overlay", &RenderGhostComparison});
    Desc.ScalarFields.push_back({"Snapshot Tick Rate", "Hz", 10.0, 120.0, 5.0, 0, &SendRateHz, "REPLICATION LINK"});
    Desc.ScalarFields.push_back({"Simulated Network RTT", "ms", 0.0, 180.0, 2.0, 0, &SimulatedRttMs, "REPLICATION LINK"});
    Desc.ScalarFields.push_back({"Packet Arrival Jitter", "ms", 0.0, 35.0, 0.5, 1, &PacketJitterMs, "REPLICATION LINK"});
    RegisterShowcaseEditorRecord(Token(), Desc.DisplayName, std::move(Desc));
#endif
}

//====================================================================================================================================
//                                         BUNDLE OF ALL 25 SCENE RECORDS
//====================================================================================================================================

ShowcaseRecordBundle::ShowcaseRecordBundle(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision)
    : RenderPipeline(Telemetry, DirtyRevision)
    , ExposureCamera(Telemetry, DirtyRevision)
    , AreaLightRig(Telemetry, DirtyRevision)
    , DirectionalSun(Telemetry, DirtyRevision)
    , AtmosphereSky(Telemetry, DirtyRevision)
    , VolumetricClouds(Telemetry, DirtyRevision)
    , HeightFog(Telemetry, DirtyRevision)
    , SkyPrecipitation(Telemetry, DirtyRevision)
    , LightningDischarge(Telemetry, DirtyRevision)
    , WindForcefield(Telemetry, DirtyRevision)
    , GravitySolver(Telemetry, DirtyRevision)
    , ControlVehicle(Telemetry, DirtyRevision)
    , PropulsionDrivetrain(Telemetry, DirtyRevision)
    , SuspensionCorners(Telemetry, DirtyRevision)
    , TyreThermal(Telemetry, DirtyRevision)
    , CabinHmi(Telemetry, DirtyRevision)
    , HeadlampOptics(Telemetry, DirtyRevision)
    , PyroPlume(Telemetry, DirtyRevision)
    , SnowMound(Telemetry, DirtyRevision)
    , ShallowWater(Telemetry, DirtyRevision)
    , SparkEmitter(Telemetry, DirtyRevision)
    , SolidFracture(Telemetry, DirtyRevision)
    , ProvingGroundsCourse(Telemetry, DirtyRevision)
    , SeamlessPortals(Telemetry, DirtyRevision)
    , PlaceableChicaneBlock("placeable_chicane_block", "Chicane Barrier 3D Object",
                            0, 1, -1.6, -2.9, 0.55, 0.72, 0.34, 0.55, true, Telemetry, DirtyRevision)
    , PlaceableNanitePedestal("placeable_nanite_pedestal", "Calibration Pedestal 3D Object",
                              1, 2, 1.2, 2.7, 0.78, 0.52, 0.52, 0.78, true, Telemetry, DirtyRevision)
    , PlaceableOpticalArch("placeable_optical_arch", "Acoustic Archway 3D Object",
                           2, 0, 8.8, -3.4, 1.35, 0.48, 1.25, 1.35, true, Telemetry, DirtyRevision)
    , SpawnedObjectSlot0("spawned_3d_object_0", "Placed Custom 3D Object A",
                         3, 3, -0.4, 1.9, 0.65, 0.55, 0.55, 0.65, false, Telemetry, DirtyRevision)
    , SpawnedObjectSlot1("spawned_3d_object_1", "Placed Custom 3D Object B",
                         0, 4, 3.2, -4.4, 0.70, 0.60, 0.45, 0.70, false, Telemetry, DirtyRevision)
    , StateReplication(Telemetry, DirtyRevision)
{
}

} // namespace Frontier::Drive
