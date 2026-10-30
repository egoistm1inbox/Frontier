/*==========================================================================================================================================
                                                 SNOWPACKACCUMULATIONEXTENSION.H
==========================================================================================================================================*/
// 🧩 Single-PolygonSurface snowpack & hail accumulation, vehicle adhesion, Snow Pit rut carving, and thermodynamic melt into puddles.

#pragma once

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             INCLUDES
------------------------------------------------------------------------------------------------------------------------------------------*/
#include "Engine/VisualEffects/WindField.h"
#include "Engine/Fluid/ShallowWater.h"
#include "Engine/Foundation/Math.h"

#include <cstdint>
#include <vector>

namespace Frontier
{
/*------------------------------------------------------------------------------------------------------------------------------------------
                                                   CONFIGURATION & SURFACE RECORDS
------------------------------------------------------------------------------------------------------------------------------------------*/
struct SnowpackDomainSpec
{
    uint32_t CellsX                    = 96u;     // [count] - Ground snowpack cells along world X
    uint32_t CellsY                    = 96u;     // [count] - Ground snowpack cells along world Y
    float    CellSizeMetres            = 0.50f;   // [m] - Grid spacing for ground snowpack continuum
    float    OriginX                   = -24.0f;  // [m] - Domain south-west X origin
    float    OriginY                   = -24.0f;  // [m] - Domain south-west Y origin
    float    FreshSnowDensityKgM3      = 120.0f;  // [kg/m^3] - Fresh powder snow density upon flake fusion
    float    PackedSnowDensityKgM3     = 480.0f;  // [kg/m^3] - Maximum tyre-compacted snowpack density
    float    HailBulkDensityKgM3       = 780.0f;  // [kg/m^3] - Granular settled hail-pellet layer density
    float    FlakeEquivalentMassKg     = 1.8e-3f; // [kg] - Representative snow packet mass fused per retired flake
    float    HailPelletMassKg          = 8.5e-3f; // [kg] - Representative hail packet mass fused per settled pellet
    float    SurfaceInclusionThreshold = 1.0e-3f; // [m] - Minimum snow+hail thickness to weld into PolygonSurface
    float    AmbientTemperatureKelvin  = 271.15f; // [K] - Ambient air temperature governing Stefan melt (> 273.15 K)
    float    ConvectiveHeatCoeffWm2K   = 28.0f;   // [W/(m^2*K)] - Air-to-ice convective heat transfer coefficient
    float    AngleOfReposeDegrees      = 36.5f;   // [deg] - Dry powder snow critical avalanche slump angle
    float    SastrugiAmplitudeMetres   = 0.0085f; // [m] - Wind-carved snow sastrugi & natural powder micro-relief
    Vec3     PrevailingWindDirection   = {0.88f, 0.47f, 0.0f}; // [unit] - Aligns wind-rippled sastrugi & drift kernels
    bool     EnforceSingleConnectedMesh = false;  // [-] - Retains strictly 1 contiguous coalesced 3D mesh component
};

struct SnowpackPolygonVertex
{
    Vec3  Position{};         // [m] - Welded surface vertex position
    Vec3  Normal{};           // [unit] - Smooth surface normal capturing tyre ruts, berms, and snow-pit slopes
    float SnowThicknessM{};   // [m] - Local snow thickness at this vertex
    float HailIceFraction{};  // [0..1] - Granular hail-ice fraction (0 = pure powder/packed snow, 1 = pure hail ice)
    float CompactionRatio{};  // [0..1] - Compaction ratio driving subsurface scattering vs icy specular sheen
};

// Contiguous single welded triangle surface (strictly NO per-flake particles once landed, and NO floor texture whitening!).
struct SnowpackPolygonSurface
{
    std::vector<SnowpackPolygonVertex> Vertices;                      // [records] - Welded contiguous surface vertices
    std::vector<uint32_t>              Indices;                       // [indices] - Triangle index buffer (3 per triangle)
    uint32_t                           ActiveQuadCount         = 0u;  // [count] - Active snow-covered grid quads welded into surface
    uint32_t                           ConnectedComponentCount = 0u;  // [count] - Topological connected mesh components (1 = single mesh!)
    float                              PeakThicknessM          = 0.0f;// [m] - Deepest snow/hail thickness across the surface
    double                             TotalSolidMassKg        = 0.0; // [kg] - Total conserved snow + hail solid mass in this surface
};

struct VehicleSnowEnvelope
{
    Vec3  WorldCentre{0.0f, 0.0f, 0.70f};  // [m] - Vehicle chassis world centre
    Vec3  ForwardAxis{1.0f, 0.0f, 0.0f};   // [unit] - Chassis forward unit axis
    Vec3  RightAxis{0.0f, 1.0f, 0.0f};     // [unit] - Chassis right unit axis
    Vec3  UpAxis{0.0f, 0.0f, 1.0f};        // [unit] - Chassis up unit axis
    Vec3  HalfExtents{2.25f, 0.95f, 0.65f};// [m] - Half-length, half-width, half-height of exterior body shell
    float ForwardSpeedMps  = 0.0f;         // [m/s] - Aerodynamic airspeed for wind-shear snow shedding
    float ChassisAccelMps2 = 0.0f;         // [m/s^2] - Lateral/braking acceleration magnitude for inertia sloughing
};

struct SnowWheelRutInput
{
    Vec3  WheelContactWorld{};              // [m] - Wheel contact centre in world space
    Vec3  WheelForwardWorld{1.0f, 0.0f, 0.0f};// [unit] - Wheel rolling direction in world space
    float TyreWidthMetres   = 0.255f;       // [m] - Tyre section width carving the rut
    float TyreRadiusMetres  = 0.335f;       // [m] - Unloaded tyre outer radius
    float NormalLoadNewtons = 3800.0f;      // [N] - Vertical wheel load compacting the snowpack
    float WheelForwardSpeed = 0.0f;         // [m/s] - Rolling ground speed
};

struct SnowWheelRutResponse
{
    float UncompactedDepthMetres    = 0.0f; // [m] - Snow depth ahead of / beneath wheel prior to compaction
    float CarvedSinkageMetres       = 0.0f; // [m] - Physical vertical rut depth carved into the snowpack
    float CompactionResistanceN     = 0.0f; // [N] - Wong-Bekker snow-compaction & bulldozing drag force
    float EffectiveSnowGripScale    = 1.0f; // [0..1] - Effective tyre-road friction multiplier (powder / packed / hail ice)
    float DisplacedBermHeightMetres = 0.0f; // [m] - Height added to lateral trackside snow berms
};

struct HailAcousticPingRecord
{
    Vec3  WorldPosition{};   // [m] - Hailstone bounce contact point
    float ImpactSpeedMps{};  // [m/s] - Normal impact speed driving audio amplitude
    bool  MetallicBodyHit{}; // [boolean] - True when hail struck vehicle roof/hood sheet metal vs ground
};

struct SnowpackTelemetrySummary
{
    uint64_t RetiredSnowflakesFused  = 0u;  // [count] - Airborne snowflakes retired & fused into single PolygonSurface
    uint64_t RetiredHailPelletsFused = 0u;  // [count] - Bounced hail pellets retired & fused into hail PolygonSurface
    uint64_t HailBounceContacts      = 0u;  // [count] - Cumulative ballistic hail skitter bounces prior to settling
    double   GroundSolidMassKg       = 0.0; // [kg] - Total solid snow + hail mass on ground
    double   VehicleAdheredMassKg    = 0.0; // [kg] - Total snow mass sticking to vehicle exterior PolygonSurface
    double   CumulativeMeltedWaterKg = 0.0; // [kg] - Total melted snow/hail mass injected into 2.5D shallow-water puddles
};

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                  SNOWPACK ACCUMULATION EXTENSION
------------------------------------------------------------------------------------------------------------------------------------------*/
class SnowSurface
{
public:
    static constexpr uint32_t VehicleGridLength = 24u;
    static constexpr uint32_t VehicleGridWidth  = 12u;

    explicit SnowSurface(const SnowpackDomainSpec& Spec = {});

    void Reconfigure(const SnowpackDomainSpec& Spec);
    void SynchronizeTerrainElevationFromWater(const ShallowWaterSimulation& WaterDomain);

    // Authors a deep drivable Snow Pit / Drift Pile directly in the continuum field so vehicles carve deep ruts & berms!
    void SculptSnowPitOrDrift(
        float CentreX,
        float CentreY,
        float RadiusMetres,
        float PeakSnowDepthMetres,
        float InitialDensityKgM3 = 165.0f) noexcept;

    // Retires landed snowflakes immediately and settles low-energy bounced hail pellets into ground & vehicle fields,
    // plus evaluates aerodynamic/inertial shedding off the vehicle and Stefan thermodynamic melt into 2.5D water puddles!
    void FuseWeatherAndAdvancePhaseChange(
        CloudGatedWeatherSpawner&  WeatherSpawner,
        const VehicleSnowEnvelope& VehicleEnvelope,
        ShallowWaterSimulation*  OptionalPuddleReceiver,
        float                      DtSeconds,
        float                      AmbientTemperatureKelvin);

    // Physically fuses an individual landing sky snowflake (from SkyPrecipitation) into the continuum snowfield
    // using a wind-drifted Gaussian crystal-packet footprint so falling snowflakes organically build a 3D snow mound!
    void DepositSnowflakeTouchdown(
        Vec3  HitWorld,
        Vec3  ImpactVelocityMps,
        float SnowPacketMassKg,
        float DriftSpreadRadiusMetres = 0.32f) noexcept;

    // Physically fuses a settled post-bounce hailstone into the granular hail-ice continuum layer.
    void DepositHailstoneTouchdown(
        Vec3  HitWorld,
        float HailPacketMassKg,
        float SpreadRadiusMetres = 0.20f) noexcept;

    // Mass-conserving dry-powder angle-of-repose avalanche slumping + wind saltation transport (windward ramp -> leeward crest).
    void RelaxAngleOfReposeAndWindDrift(
        Vec3     PrevailingWindMps,
        float    DtSeconds,
        uint32_t SubIterations = 3u) noexcept;

    // Exact topological BFS over shared triangle vertices: returns the number of disconnected triangle islands (1 = single mesh!).
    [[nodiscard]] static uint32_t CountConnectedMeshComponents(const SnowpackPolygonSurface& Surface);

    // Wong-Bekker snow compaction + mass-conserving lateral berm extrusion when a wheel drives through snow or the Snow Pit!
    SnowWheelRutResponse CarveWheelRutAndEvaluateResistance(const SnowWheelRutInput& Wheel) noexcept;

    // Rebuilds ONE single welded contiguous SnowpackPolygonSurface for the ground and ONE for the vehicle exterior!
    void RebuildContiguousPolygonSurfaces(const VehicleSnowEnvelope& VehicleEnvelope);

    [[nodiscard]] float SampleGroundSurfaceElevation(float WorldX, float WorldY) const noexcept;
    [[nodiscard]] float SampleGroundSnowThickness(float WorldX, float WorldY) const noexcept;
    [[nodiscard]] float SampleGroundHailThickness(float WorldX, float WorldY) const noexcept;
    [[nodiscard]] float SampleGroundSnowDensity(float WorldX, float WorldY) const noexcept;

    [[nodiscard]] const SnowpackDomainSpec&                  Specification() const noexcept { return Spec_; }
    [[nodiscard]] const SnowpackPolygonSurface&              GroundPolygonSurface() const noexcept { return GroundSurface_; }
    [[nodiscard]] const SnowpackPolygonSurface&              VehiclePolygonSurface() const noexcept { return VehicleSurface_; }
    [[nodiscard]] const SnowpackTelemetrySummary&            Telemetry() const noexcept { return Telemetry_; }
    [[nodiscard]] const std::vector<HailAcousticPingRecord>& RecentHailPings() const noexcept { return RecentHailPings_; }

private:
    [[nodiscard]] std::size_t CellIndex(uint32_t I, uint32_t J) const noexcept
    {
        return static_cast<std::size_t>(J) * Spec_.CellsX + I;
    }

    void DepositGroundSnowMass(float WorldX, float WorldY, float MassKg, bool GranularHail) noexcept;

    SnowpackDomainSpec                  Spec_{};
    std::vector<float>                  TerrainElevation_;
    std::vector<float>                  SnowDepthMetres_;
    std::vector<float>                  SnowDensityKgM3_;
    std::vector<float>                  HailDepthMetres_;
    std::vector<float>                  VehicleSnowMassKg_;
    SnowpackPolygonSurface              GroundSurface_{};
    SnowpackPolygonSurface              VehicleSurface_{};
    std::vector<HailAcousticPingRecord> RecentHailPings_;
    SnowpackTelemetrySummary            Telemetry_{};
};

} // namespace Frontier
