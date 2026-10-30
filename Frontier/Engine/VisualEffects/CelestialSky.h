/*==========================================================================================================================================
                                               CELESTIALPLANETARYEXTENSION.H
==========================================================================================================================================*/
// 🧩 Complete celestial & planetary environment: 41k Hipparcos star catalogue (32x32 octahedral cell index) + Milky Way,
//    authored custom stars with Airy starbursts & scene lighting, textured cratered Moon + 6-body lunar presets, and
//    3D planets with simulated spherical Rayleigh/Mie/Ozone atmospheres, multi-band ring systems, and mutual ring/planet shadows.

#pragma once

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             INCLUDES
------------------------------------------------------------------------------------------------------------------------------------------*/
#include "Engine/Foundation/Math.h"
#include "Engine/Rendering/CelestialModel.h"

#include <array>
#include <cstdint>
#include <string>
#include <vector>

namespace Frontier
{
/*------------------------------------------------------------------------------------------------------------------------------------------
                                        OCTAHEDRAL STAR CATALOGUE & CUSTOM STARS
------------------------------------------------------------------------------------------------------------------------------------------*/
struct BinnedCatalogueStar
{
    Vec3  DirectionUnit{}; // [unit] - Local observer East (+X), North (+Y), Up (+Z) direction
    Vec3  ChromaticityRgb{}; // [-] - Ballesteros (2012) B-V Planckian chromaticity
    float RelativeFlux = 0.0f; // [-] - 10^(-0.4 * Magnitude) flux relative to mag 0
    float Magnitude    = 6.0f;
};

struct CustomStarDescriptor
{
    Vec3  DirectionUnit       = {0.22f, 0.72f, 0.66f}; // [unit] - Observer-frame direction toward custom star
    float AngularRadiusRad    = 0.0022f;               // [rad]  - Resolved photosphere angular radius
    float TemperatureKelvin   = 9200.0f;               // [K]    - Photosphere blackbody temperature (1800..35000 K)
    float RadianceGain        = 18.0f;                 // [-]    - Photosphere + corona brightness gain
    float CoronaGlowStrength  = 0.85f;                 // [-]    - Exponential corona + 6-blade Airy diffraction spikes
    float SceneIrradianceGain = 0.35f;                 // [W/m^2]- Direct starlight cast onto terrain, clouds, snow & water
};

/*------------------------------------------------------------------------------------------------------------------------------------------
                                              LUNAR ATLAS & MOON DESCRIPTORS
------------------------------------------------------------------------------------------------------------------------------------------*/
enum class LunarSurfacePreset : uint8_t
{
    LunaSelenographic = 0u, // Earth's Moon (real 2048x1024 MoonAlbedo2048.ppm + crater micro-relief)
    EmberVolcanic     = 1u, // Basaltic mare + glowing volcanic fissure tint & warm haze
    GlacierEuropa     = 2u, // High-albedo fractured water-ice crust & lineae
    SulfurIo          = 3u, // Sulfur-silicate volcanic plains
    ShroudTitan       = 4u, // Dense orange-gold photochemical nitrogen-methane haze shroud
    ShardCaptured     = 5u  // Dark high-contrast cratered asteroid moonlet
};

struct LunarBodyDescriptor
{
    LunarSurfacePreset Preset                  = LunarSurfacePreset::LunaSelenographic;
    Vec3               DirectionUnit           = {-0.34f, 0.76f, 0.55f};
    float              AngularRadiusRad        = 0.016f;  // [rad] - Apparent radius (0.0046 real, larger for telephoto/showcase)
    float              SurfaceBrightness       = 2.6f;
    float              EarthshineStrength      = 0.045f;
    float              AtmosphericHaze         = 0.04f;   // [0..1]- Limb softening & atmospheric rim scatter
    float              AxialTiltRad            = 0.117f;  // [rad] - 6.7 deg for Luna
    float              SpinLongitudeRad        = 0.0f;
    float              SceneBounceIrradiance   = 0.28f;   // [W/m^2]- Moonlight cast onto scene surfaces & water
};

/*------------------------------------------------------------------------------------------------------------------------------------------
                                  SIMULATED PLANETARY ATMOSPHERE & RINGED PLANETS
------------------------------------------------------------------------------------------------------------------------------------------*/
struct PlanetaryAtmosphereProfile
{
    bool  Enabled                = true;
    float ShellHeightFraction    = 0.095f;                      // [-] - Atmosphere height as fraction of PlanetRadius
    Vec3  RayleighScattering     = {5.8e-6f, 13.5e-6f, 33.1e-6f}; // [1/m] - Wavelength-dependent Rayleigh coefficients
    float RayleighScaleFraction  = 0.016f;                      // [-] - H_R / PlanetRadius
    float MieScattering          = 18.0e-6f;                    // [1/m] - Aerosol / cloud-top haze scattering
    float MieScaleFraction       = 0.0045f;                     // [-] - H_M / PlanetRadius
    float MieAnisotropyG         = 0.76f;                       // [-0.9..0.95] - Cornette-Shanks forward asymmetry
    Vec3  AbsorptionCoefficients = {0.65e-6f, 1.88e-6f, 0.12e-6f}; // [1/m] - Ozone / Methane band absorption
    float OpticalDensityScale    = 5.2e5f;                      // [m] - Maps normalized unit sphere to physical column depth
};

struct PlanetaryRingDescriptor
{
    bool  Enabled               = true;
    Vec3  RingNormalUnit        = {0.18f, -0.32f, 0.93f}; // [unit] - Tilted ring-plane normal
    float InnerRadiusRatio      = 1.24f;                  // [-] - Inner C/D-ring edge in units of PlanetRadius
    float OuterRadiusRatio      = 2.38f;                  // [-] - Outer A/F-ring edge in units of PlanetRadius
    Vec3  InnerTintRgb          = {0.58f, 0.52f, 0.45f};  // [-] - Silicate-rich C/B inner ring albedo
    Vec3  OuterTintRgb          = {0.86f, 0.82f, 0.74f};  // [-] - Water-ice B/A outer ring albedo
    float PeakOpticalDepth      = 1.65f;                  // [-] - B-ring peak normal optical depth
    float IcePhaseAsymmetryG    = 0.38f;                  // [-] - Forward/backscatter ring phase parameter
};

enum class PlanetarySurfaceArchetype : uint8_t
{
    BandedGasGiant      = 0u, // Zonal jet bands, Kelvin-Helmholtz eddies & anticyclonic Great Oval
    OceanicTerrestrial  = 1u, // Deep oceans, specular sun glint, continents, polar caps & cyclone swirls
    RustyDesertWorld    = 2u, // Iron-oxide dunes, basaltic basins, CO2 dust haze & polar frost
    MethaneIceGiant     = 3u  // Deep azure-cyan methane bands & high-altitude bright cirrus streaks
};

struct PlanetaryBodyDescriptor
{
    PlanetarySurfaceArchetype  Archetype          = PlanetarySurfaceArchetype::BandedGasGiant;
    Vec3                       DirectionUnit      = {0.28f, 0.82f, 0.50f}; // [unit] - Observer-frame direction to planet centre
    float                      AngularRadiusRad   = 0.072f;                // [rad]  - Apparent solid/cloud-top radius
    Vec3                       SpinAxisUnit       = {0.18f, -0.32f, 0.93f};
    float                      SpinPhaseRad       = 0.65f;
    float                      SurfaceAlbedoScale = 1.35f;
    PlanetaryAtmosphereProfile Atmosphere{};
    PlanetaryRingDescriptor    Rings{};
};

/*------------------------------------------------------------------------------------------------------------------------------------------
                                            CELESTIAL EVALUATION DIAGNOSTICS
------------------------------------------------------------------------------------------------------------------------------------------*/
struct CelestialRaySample
{
    Vec3  RadianceRgb{};                // [W/(sr*m^2)] - Total celestial radiance along ray
    float OcclusionTransmittance = 1.0f;// [0..1] - 0 if blocked by solid Moon/Planet, partial through rings/limb
    bool  HitLunarDisc           = false;
    bool  HitPlanetBody          = false;
    bool  HitPlanetAtmosphere    = false;
    bool  HitPlanetaryRings      = false;
    bool  InPlanetShadowOnRings  = false;
    bool  InRingShadowOnPlanet   = false;
};

/*------------------------------------------------------------------------------------------------------------------------------------------
                                             CELESTIAL PLANETARY EXTENSION
------------------------------------------------------------------------------------------------------------------------------------------*/
class CelestialSky
{
public:
    static constexpr uint32_t OctahedralGridAxis  = 32u;
    static constexpr uint32_t OctahedralCellCount = OctahedralGridAxis * OctahedralGridAxis;

    CelestialSky();

    void ClearBodies() noexcept;

    // Loads J2000 Hipparcos CSV (e.g. Exhibits/NightSky/Data/Hipparcos8.csv) via DecodeHipparcosCatalogue
    // and builds the 32x32 octahedral cell lookup table (with boundary glow overlap).
    bool LoadHipparcosCatalogueCsv(
        const std::string& CsvPath,
        double             JulianUt1    = 2461343.85,
        double             LatitudeDeg  = -26.188,
        double             LongitudeDeg = 28.320);

    // Populates deterministic power-law star catalogue when CSV is not requested.
    void BuildProceduralStarCatalogue(uint32_t StarCount = 12000u, uint64_t Seed = 0x51A7CA7A109FULL);

    // Loads 2048x1024 MoonAlbedo2048.ppm (IEC sRGB decoded) for LunaSelenographic moons.
    bool LoadLunaAlbedoMapPpm(const std::string& PpmPath);

    void RegisterCustomStar(const CustomStarDescriptor& Star);
    void RegisterLunarBody(const LunarBodyDescriptor& Moon);
    void RegisterPlanetaryBody(const PlanetaryBodyDescriptor& Planet);

    void ConfigureStarfieldAppearance(
        float StarBrightnessGain   = 1.25f,
        float MagnitudeLimit       = 7.8f,
        float MilkyWayBandStrength = 1.15f,
        float ScintillationAmount  = 0.25f,
        float TimeSeconds          = 0.0f) noexcept;

    // Evaluates complete celestial radiance along DirectionUnit (Stars + Milky Way + Custom Stars + Moons +
    // Ringed Planets with Simulated Spherical Atmospheres), properly ordered & occulted!
    [[nodiscard]] CelestialRaySample EvaluateCelestialRay(
        Vec3  DirectionUnit,
        Vec3  PrimarySunDirectionUnit,
        Vec3  PrimarySunRadianceRgb,
        float SolarElevationDegrees,
        float PixelFootprintRad = 0.0018f) const noexcept;

    // Returns combined direct scene irradiance [W/m^2] from visible Moons and Custom Stars!
    [[nodiscard]] Vec3 EvaluateNocturnalDirectIrradiance(
        Vec3 SurfaceNormalUnit,
        Vec3 PrimarySunDirectionUnit,
        Vec3 PrimarySunRadianceRgb) const noexcept;

    [[nodiscard]] static Vec3 KelvinToBlackbodyChromaticity(float Kelvin) noexcept;
    [[nodiscard]] static uint32_t OctahedralCellForDirection(Vec3 DirectionUnit) noexcept;

    [[nodiscard]] uint32_t SourceCatalogueStarCount() const noexcept { return SourceStarCount_; }
    [[nodiscard]] uint32_t BinnedCatalogueEntryCount() const noexcept { return static_cast<uint32_t>(BinnedStars_.size()); }
    [[nodiscard]] bool     LunaMapReady() const noexcept { return LunaAlbedoMap_.Loaded(); }
    [[nodiscard]] const std::vector<CustomStarDescriptor>&    CustomStars() const noexcept { return CustomStars_; }
    [[nodiscard]] const std::vector<LunarBodyDescriptor>&     LunarBodies() const noexcept { return Moons_; }
    [[nodiscard]] const std::vector<PlanetaryBodyDescriptor>& PlanetaryBodies() const noexcept { return Planets_; }

private:
    struct CellSpan
    {
        uint32_t First = 0u;
        uint32_t Count = 0u;
    };

    void RebuildOctahedralStarIndex(const std::vector<StarRecord>& Records);

    [[nodiscard]] Vec3 EvaluateCatalogueStarsAndMilkyWay(
        Vec3  DirectionUnit,
        float NightVisibilityFactor,
        float PixelFootprintRad) const noexcept;

    [[nodiscard]] Vec3 EvaluateCustomStarsAlongRay(
        Vec3  DirectionUnit,
        float PixelFootprintRad) const noexcept;

    [[nodiscard]] CelestialRaySample EvaluateSinglePlanetAndRings(
        const PlanetaryBodyDescriptor& Planet,
        Vec3                           RayDirUnit,
        Vec3                           SunDirUnit,
        Vec3                           SunColRgb,
        float                          PixelFootprintRad) const noexcept;

    [[nodiscard]] CelestialRaySample EvaluateSingleMoon(
        const LunarBodyDescriptor& Moon,
        Vec3                       RayDirUnit,
        Vec3                       SunDirUnit,
        Vec3                       SunColRgb,
        float                      PixelFootprintRad) const noexcept;

    LunarAlbedoMap                        LunaAlbedoMap_{};
    uint32_t                              SourceStarCount_       = 0u;
    std::array<CellSpan, OctahedralCellCount> StarCells_{};
    std::vector<BinnedCatalogueStar>      BinnedStars_;
    std::vector<CustomStarDescriptor>     CustomStars_;
    std::vector<LunarBodyDescriptor>      Moons_;
    std::vector<PlanetaryBodyDescriptor>  Planets_;

    float StarBrightnessGain_   = 1.25f;
    float MagnitudeLimit_       = 7.8f;
    float MilkyWayBandStrength_ = 1.15f;
    float ScintillationAmount_  = 0.25f;
    float TimeSeconds_          = 0.0f;
};

} // namespace Frontier
