/*==========================================================================================================================================
                                                    WINDFORCEFIELDEXTENSION.H
==========================================================================================================================================*/
// 🧩 Shared 3D Wind & Force-Field toroidal lattice driving Clouds, Fog, PlumeFluid, Vehicle Aero, and Cloud-Gated Weather Particles.

#pragma once

#include "Engine/Rendering/CloudField.h"
#include "Engine/Rendering/FogMedium.h"
#include "Engine/Fluid/PlumeFluid.h"
#include "Engine/Rendering/WeatherEffects.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                      FORCE PRIMITIVES & SHARED 3D WIND LATTICE
//------------------------------------------------------------------------------------------------------------------------

enum class ForcePrimitiveForm : std::uint8_t
{
    DirectionalGustCorridor = 0, // [-] localized wind shear / canyon jet along AxisDirection
    RadialImpulseWave       = 1, // [-] outward spherical/cylindrical blast or blowout impulse
    VortexColumnUpdraft     = 2, // [-] tangential swirl + vertical suction (dust devil / wake vortex)
    VehicleSlipstreamWake   = 3  // [-] moving vehicle bow wave + trailing turbulent wake
};

struct ForceFieldPrimitive
{
    ForcePrimitiveForm Form             = ForcePrimitiveForm::VortexColumnUpdraft;
    SpatialVector      WorldCenter      = { 0.0, 0.0, 0.0 }; // [m]
    SpatialVector      AxisOrVelocity   = { 0.0, 0.0, 1.0 }; // [-] axis for vortex/gust, or [m/s] chassis velocity for wake
    double             InfluenceRadiusM = 6.0;               // [m] radial falloff scale
    double             PeakSpeedMps     = 8.0;               // [m/s] induced velocity magnitude
    double             SwirlRatio       = 1.0;               // [-] tangential-to-axial ratio for VortexColumnUpdraft
};

struct WindFieldConfiguration
{
    SpatialVector AmbientReferenceWindMps = { 5.5, 1.8, 0.0 }; // [m/s] wind vector at ReferenceAltitudeM
    double        ReferenceAltitudeM      = 10.0;              // [m]   meteorological anemometer height
    double        SurfaceRoughnessLengthM = 0.08;              // [m]   ABL roughness z0 (open proving ground)
    double        HorizontalDomainExtentM = 128.0;             // [m]   32x32 lattice horizontal span around anchor
    double        VerticalDomainHeightM   = 48.0;              // [m]   16-slice lattice vertical height above ground
    double        GroundElevationM        = 0.0;               // [m]
    double        GustAmplitudeFraction   = 0.28;              // [-]   traveling atmospheric gust wave amplitude
    double        GustWavelengthM         = 95.0;              // [m]
    double        CurlTurbulenceMps       = 1.15;              // [m/s] divergence-free 3D eddy speed
    double        CurlSpatialScaleM       = 14.0;              // [m]
};

class WindField
{
public:
    static constexpr std::uint32_t LatticeDimX        = 32u;
    static constexpr std::uint32_t LatticeDimY        = 32u;
    static constexpr std::uint32_t LatticeDimZ        = 16u;
    static constexpr std::size_t   MaxForcePrimitives = 16u;

    explicit WindField(const WindFieldConfiguration& Config = {});

    void Reconfigure(const WindFieldConfiguration& Config);
    void ClearForcePrimitives() noexcept;
    void AppendForcePrimitive(const ForceFieldPrimitive& Primitive) noexcept;
    void RegisterVehicleWake(SpatialVector ChassisPosition, SpatialVector ChassisVelocity, double WakeRadiusM = 3.6) noexcept;

    // Rebuilds the 32x32x16 3D wind vector lattice around AnchorPosition in < 0.08 ms on 1 CPU core.
    void StepField(SpatialVector AnchorPosition, double StepSeconds) noexcept;

    // O(1) trilinear lattice sample inside the active volume, falling back smoothly to analytic ABL + primitives outside.
    [[nodiscard]] SpatialVector SampleWindVelocity(SpatialVector WorldPoint) const noexcept;

    // Cross-subsystem couplers (Clouds, Fog, Plume Smoke/Fire, Vehicle Aerodynamics).
    void SynchronizeCloudAdvection(CloudParameters& InOutClouds, double StepSeconds) const noexcept;
    [[nodiscard]] SpatialVector EvaluateAdvectedFogSamplePoint(SpatialVector WorldPoint) const noexcept;
    void SynchronizePlumeParameters(PlumeFluidParameters& InOutPlume, SpatialVector PlumeAnchor) const noexcept;
    [[nodiscard]] SpatialVector EvaluateRelativeVehicleAirflow(
        SpatialVector ChassisPosition,
        SpatialVector ChassisVelocity) const noexcept;

    [[nodiscard]] const WindFieldConfiguration& Configuration() const noexcept { return Config_; }
    [[nodiscard]] double ElapsedSeconds() const noexcept                       { return ElapsedSeconds_; }
    [[nodiscard]] const std::vector<float>& LatticeVelocityXyz() const noexcept { return VelocityXyz_; }

private:
    [[nodiscard]] SpatialVector EvaluateAnalyticVelocity(SpatialVector WorldPoint) const noexcept;

    WindFieldConfiguration             Config_{};
    SpatialVector                      Anchor_          = { 0.0, 0.0, 0.0 };
    SpatialVector                      IntegratedCloudDrift_ = { 0.0, 0.0, 0.0 };
    double                             ElapsedSeconds_  = 0.0;
    std::vector<ForceFieldPrimitive>   Primitives_;
    std::vector<float>                 VelocityXyz_;    // 32 * 32 * 16 * 3 floats (192 KB L2-resident)
};

//------------------------------------------------------------------------------------------------------------------------
//                          CLOUD-GATED BUDGETED WEATHER & DEBRIS PARTICLE SPAWNER (VOSE ALIAS)
//------------------------------------------------------------------------------------------------------------------------

enum class FallingParticleCategory : std::uint8_t
{
    RainDrop        = 0,
    SnowFlake       = 1,
    HailPellet      = 2,
    WindborneDebris = 3
};

struct WeatherParticleBudgetConfig
{
    FallingParticleCategory Category                  = FallingParticleCategory::SnowFlake;
    std::uint32_t           StrictParticleBudget      = 4096u; // [-] hard memory & CPU ceiling — never exceeded!
    double                  SpawnVolumeHorizontalM    = 64.0;  // [m] horizontal width around camera/vehicle anchor
    double                  SpawnCeilingHeightM       = 28.0;  // [m] top of local simulation box (slanted from CloudField!)
    double                  GroundElevationM          = 0.0;   // [m] road/ground collision elevation
    double                  CloudOpticalDepthGate     = 0.08;  // [-] minimum overhead cloud optical depth to precipitate!
    double                  WeatherIntensityZeroToOne = 1.0;   // [0..1] storm precipitation rate
    std::uint64_t           DeterministicSeed         = 0x510EA7EULL;
};

struct WeatherParticleRecord
{
    SpatialVector Position      = { 0.0, 0.0, 0.0 }; // [m]
    SpatialVector Velocity      = { 0.0, 0.0, 0.0 }; // [m/s]
    float         RadiusMetres  = 0.003f;            // [m]
    float         PhaseAngle    = 0.0f;              // [rad] per-particle flutter / tumble phase
    std::uint16_t SourceColumn  = 0u;                // [-]   [0..1023] cloud grid cell that spawned this particle
    std::uint8_t  BounceCounter = 0u;                // [-]   hail ground bounces completed
    bool          Alive         = false;             // [-]
};

struct CloudGatedSpawnerTelemetry
{
    std::uint32_t StrictParticleBudget       = 0u;   // [-] configured hard particle budget
    std::uint32_t TargetActiveParticles      = 0u;   // [-] budget * cloud-coverage * intensity
    std::uint32_t CurrentAliveParticles      = 0u;   // [-] currently simulated particles (0 in clear sky!)
    std::uint32_t PrecipitatingCloudColumns  = 0u;   // [-] out of 32x32 = 1024 overhead columns
    std::uint32_t ClearSkySpawnRejections    = 0u;   // [-] diagnostic count proving 0 spawns in clear columns
    double        MeanOverheadCloudDepth     = 0.0;  // [-] average optical depth across 32x32 column grid
    double        SpawnedUnderCloudFraction  = 1.0;  // [-] fraction of newly spawned particles with tau >= gate (1.0!)
};

class CloudGatedWeatherSpawner
{
public:
    static constexpr std::uint32_t ColumnGridDim   = 32u;
    static constexpr std::uint32_t ColumnCellCount = ColumnGridDim * ColumnGridDim;

    explicit CloudGatedWeatherSpawner(const WeatherParticleBudgetConfig& Config = {});

    void Reconfigure(const WeatherParticleBudgetConfig& Config);

    // Rebuilds 32x32 wind-slanted overhead CloudField column weights + Vose O(1) Alias Table, then advances
    // all active particles under WindField drag, turbulence, and ballistic ground rebound!
    CloudGatedSpawnerTelemetry StepParticles(
        const CloudParameters&        Clouds,
        const WindField& WindField,
        SpatialVector                 AnchorPosition,
        double                        StepSeconds);

    // Evaluates exact overhead cloud optical depth at the wind-slanted source above WorldPoint (used for verification!).
    [[nodiscard]] double MeasureSlantedCloudOpticalDepth(
        const CloudParameters&        Clouds,
        const WindField& WindField,
        SpatialVector                 WorldPoint) const noexcept;

    [[nodiscard]] const WeatherParticleBudgetConfig&        Configuration() const noexcept { return Config_; }
    [[nodiscard]] const std::vector<WeatherParticleRecord>& Particles() const noexcept { return Pool_; }
    [[nodiscard]] const CloudGatedSpawnerTelemetry&         Telemetry() const noexcept { return Telemetry_; }
    [[nodiscard]] const std::array<float, ColumnCellCount>& ColumnOpticalDepths() const noexcept { return ColumnOpticalDepth_; }

    // Retires an airborne flake or settled hail pellet immediately once fused into a contiguous PolygonSurface.
    void RetireParticleSlot(std::size_t SlotIndex) noexcept
    {
        if (SlotIndex < Pool_.size() && Pool_[SlotIndex].Alive)
        {
            Pool_[SlotIndex].Alive = false;
            if (Telemetry_.CurrentAliveParticles > 0u)
            {
                --Telemetry_.CurrentAliveParticles;
            }
        }
    }

private:
    void RebuildCloudColumnAliasTable(
        const CloudParameters&        Clouds,
        const WindField& WindField,
        SpatialVector                 AnchorPosition) noexcept;

    bool RespawnParticleFromCloudAlias(
        WeatherParticleRecord&        Particle,
        const WindField& WindField,
        SpatialVector                 AnchorPosition) noexcept;

    [[nodiscard]] double NextUniform01() noexcept;

    WeatherParticleBudgetConfig              Config_{};
    std::vector<WeatherParticleRecord>       Pool_;
    std::array<float, ColumnCellCount>       ColumnOpticalDepth_{};
    std::array<float, ColumnCellCount>       AliasProbability_{};
    std::array<std::uint16_t, ColumnCellCount> AliasPartner_{};
    CloudGatedSpawnerTelemetry               Telemetry_{};
    std::uint64_t                            RngCursor_           = 0x510EA7EULL;
    bool                                     AliasValid_          = false;
    std::uint32_t                            VerifiedSpawnsTotal_ = 0u;
    std::uint32_t                            VerifiedSpawnsCloud_ = 0u;
};

} // namespace Frontier
