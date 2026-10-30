/*==========================================================================================================================================
                                                         VEHICLEHMISCENE.H
==========================================================================================================================================*/
// 🧩 Ported VehicleHMI proving-grounds scene, ControlVehicle FCT1 facet archives, 3-mode tyre surface deformation, and showcase renderer.

#pragma once

#include "DriveSimulation.h"

#include "Engine/Physics/ProjectDrive/TyreVisualBridge.h"
#include "Engine/Physics/TyreSurfaceProjection.h"
#include "Engine/Gameplay/GameMechanics/Propulsion/CalibratedTyreThermodynamics.h"
#include "Engine/Gameplay/GameMechanics/Propulsion/HybridElectricPropulsion.h"
#include "Engine/Gameplay/GameMechanics/Propulsion/PropulsionThermochemistry.h"
#include "Engine/Rendering/AtmosphereModel.h"
#include "Engine/Rendering/CloudField.h"
#include "Engine/Rendering/FogMedium.h"
#include "Engine/Rendering/PhotometricLights.h"
#include "Engine/Fluid/PlumeFluid.h"
#include "Engine/Rendering/WeatherEffects.h"
#include "Engine/VisualEffects/WindField.h"

#include <array>
#include <cstdint>
#include <string>
#include <vector>

namespace Frontier::Drive
{

//------------------------------------------------------------------------------------------------------------------------
//                                              MATERIAL & POLYGON SURFACE RECORDS
//------------------------------------------------------------------------------------------------------------------------

enum ProvingGroundMaterial : std::uint32_t
{
    PgmCheckerLight    = 0u,
    PgmCheckerDark     = 1u,
    PgmSurround        = 2u,
    PgmRamp            = 3u,
    PgmBump            = 4u,
    PgmCone            = 5u,
    PgmBodyCoat        = 6u,
    PgmVehicleGlass    = 7u,
    PgmVehiclePlastic  = 8u,
    PgmTyre            = 9u,
    PgmHub             = 10u,
    PgmBrake           = 11u,
    PgmVehicleTrim     = 12u,
    PgmHeadlight       = 13u,
    PgmTaillight       = 14u,
    PgmVehicleDefault  = 15u,
    PgmWallCrimson     = 16u,
    PgmWallViridian    = 17u,
    PgmWallChalk       = 18u,
    PgmWallCobalt      = 19u,
    PgmTunnelConcrete  = 20u,
    PgmAsphalt         = 26u,
    PgmAsphaltPatch    = 27u,
    PgmApronConcrete   = 28u,
    PgmPaintWhite      = 29u,
    PgmPaintYellow     = 30u,
    PgmKerbRed         = 31u,
    PgmGrass           = 33u,
    PgmCladding        = 35u,
    PgmContainerOrange = 36u,
    PgmContainerBlue   = 37u,
    PgmContainerRed    = 40u,
    PgmSteelDark       = 41u,
    PgmLampWarm        = 42u,
    PgmLampCool        = 43u,
    PgmBarrierConcrete = 44u,
    PgmGlass           = 48u,
    PgmConeOrange      = 60u,
    PgmConeBand        = 61u,
    PgmConeBase        = 62u,
    PgmGateLamp        = 66u,
    PgmGateLampRed     = 67u,
    PgmSteeringWheel   = 73u,
    PgmDisplayGlass    = 74u,
    PgmRimBase         = 81u,
    PgmMirror          = 82u,
    PgmAluminium       = 83u,
    PgmGold            = 84u,
    PgmShowcaseGlass   = 85u,
    PgmMaterialLimit   = 88u
};

struct SurfaceReflectanceRecord
{
    std::array<float, 3> Albedo         = { 0.5f, 0.5f, 0.5f };   // [-]     linear Rec.709 base reflectance or metal F0
    float                Roughness      = 0.5f;                   // [-]     microfacet GGX roughness
    float                Metalness      = 0.0f;                   // [-]     0 = dielectric, 1 = conductor
    float                CoatWeight     = 0.0f;                   // [-]     automotive clearcoat layer weight
    float                CoatRoughness  = 0.03f;                  // [-]     clearcoat roughness
    float                Transmission   = 0.0f;                   // [-]     dielectric transmission weight
    float                RefractiveIdx  = 1.50f;                  // [-]     dielectric index of refraction
    std::array<float, 3> RadiantOutput  = { 0.0f, 0.0f, 0.0f };   // [W/sr/m^2] self-luminous surface radiance
};

struct FacetArchiveSurface
{
    std::uint32_t              VertexCount   = 0u;
    std::uint32_t              FacetCount    = 0u;
    std::array<float, 3>       BoundsMinimum = { 0.0f, 0.0f, 0.0f };
    std::array<float, 3>       BoundsMaximum = { 0.0f, 0.0f, 0.0f };
    std::vector<float>         Positions;       // [m] 3 * VertexCount
    std::vector<std::uint32_t> Indices;         // [-] 3 * FacetCount
    std::vector<std::uint32_t> Families;        // [-] FacetCount
    std::vector<float>         CornerNormals;   // [-] 9 * FacetCount (optional)
};

struct ControlVehicleArchives
{
    FacetArchiveSurface Body;
    FacetArchiveSurface Rim;
    FacetArchiveSurface Tyre;
    bool                Valid = false;
};

struct WorldFacetTriangle
{
    std::array<float, 3> V0;
    std::array<float, 3> V1;
    std::array<float, 3> V2;
    std::array<float, 3> N0;
    std::array<float, 3> N1;
    std::array<float, 3> N2;
    std::uint32_t        Family = 0u;
};

//------------------------------------------------------------------------------------------------------------------------
//                                           SHOWCASE ENVIRONMENT & RENDER OPTIONS
//------------------------------------------------------------------------------------------------------------------------

struct ShowcaseEnvironmentSettings
{
    std::array<float, 3>     SunDirection          = { 0.48f, -0.36f, 0.80f }; // [-]   unit solar direction
    float                    SunElevationDeg       = 24.0f;                    // [deg] solar elevation (controls twilight/golden hour)
    float                    CloudCoverage         = 0.48f;                    // [0..1] volumetric cumulus cloud fraction
    float                    FogBaseDensity        = 0.011f;                   // [1/m] exponential height-fog extinction at z = 0
    float                    FogHeightFalloff      = 0.16f;                    // [1/m] fog vertical scale factor
    bool                     HeadlightsActive      = true;                     // [-]   analytic-IES low/high beam + roof LED bar
    bool                     StreetlampsActive     = true;                     // [-]   roadway batwing IES poles + hangar/tunnel lamps
    DemoTyreVisualMode       TyreDeformationMode   = DemoTyreVisualMode::Solid;// [-]   Spring / XPBD Projection / 3D Hex8 FEM Solid
    PrecipitationSpecies     WeatherSpecies              = PrecipitationSpecies::Clear;
    float                    WeatherIntensity            = 0.0f;                     // [0..1] precipitation rate
    float                    SnowDepthMetres             = 0.0f;                     // [m]   accumulated ground/roof snow blanket
    std::array<float, 3>     WindVelocityTenMetres       = { 4.2f, 1.4f, 0.0f };     // [m/s] 10 m shared WindForceField vector
    std::uint32_t            StrictWeatherParticleBudget = 1280u;                    // [-]   hard cap for CloudGatedWeatherSpawner
    float                    ElapsedSeconds              = 0.0f;                     // [s]   animation clock
};

struct ShowcaseCameraPose
{
    std::array<float, 3> Eye           = { -12.0f, -6.5f, 2.4f };
    std::array<float, 3> Target        = {   2.0f,  0.5f, 0.9f };
    float                VerticalFovDeg = 50.0f;
};

//------------------------------------------------------------------------------------------------------------------------
//                                                   PUBLIC FUNCTIONS
//------------------------------------------------------------------------------------------------------------------------

[[nodiscard]] std::array<SurfaceReflectanceRecord, PgmMaterialLimit> ConstructProvingGroundMaterials() noexcept;

[[nodiscard]] bool LoadFacetArchiveFromFile(const std::string& FilePath, FacetArchiveSurface& OutArchive);

[[nodiscard]] ControlVehicleArchives LoadControlVehicleArchives(const std::string& GeometryDirectory);

// Builds the static VehicleHMI proving-grounds architecture (pad, markings, kerbs, ramp, hangar, tunnel, tower,
// materials garden, smash alley, traffic signals, streetlamp poles).
void BuildStaticVehicleHmiProvingGrounds(
    std::vector<WorldFacetTriangle>& OutTriangles,
    float                            RampNearX = CourseConstants::RampNearX);

// Appends dynamic Jolt cones + full-fidelity ControlVehicle (body + 4 rims + 4 deformed tyres + steered wheel + LED bar).
void AppendDynamicVehicleAndCones(
    const DriveSnapshot&                  Snapshot,
    const ControlVehicleArchives&         Archives,
    const ProjectDriveTyreVisualBridge*   TyreBridge,
    DemoTyreVisualMode                    TyreMode,
    const std::array<double, 4>&          GaugePressuresPa,
    std::vector<WorldFacetTriangle>&      OutTriangles);

// Populates tight-clustered Analytic-IES (headlights, roof bar, streetlamp poles) + Hangar/Tunnel luminaires.
void PopulateProvingGroundPhotometricLights(
    const DriveSnapshot&                         Snapshot,
    const ShowcaseEnvironmentSettings&           Settings,
    std::vector<AnalyticLuminaireSpecification>& OutLuminaires,
    PhotometricLights&                  OutClusters);

// Renders an anti-aliased HDR->ACES tone-mapped RGB8 frame of the complete scene (with BVH reflections/shadows,
// Atmosphere + CloudField + clustered FogMedium + PlumeFluid smoke/fire + WeatherEffects snow/hail/rain).
void RenderVehicleHmiShowcaseImage(
    const std::vector<WorldFacetTriangle>&              Triangles,
    const std::vector<AnalyticLuminaireSpecification>&  Luminaires,
    const PhotometricLights&                   LightClusters,
    const PlumeFluid*                           PlumeFluid,
    const ShowcaseCameraPose&                           Camera,
    const ShowcaseEnvironmentSettings&                  Environment,
    std::uint32_t                                       Width,
    std::uint32_t                                       Height,
    std::vector<std::uint8_t>&                          OutRgb8);

} // namespace Frontier::Drive
