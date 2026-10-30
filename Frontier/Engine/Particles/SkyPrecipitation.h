/*==========================================================================================================================================
                                                     SKYPRECIPITATION.H
==========================================================================================================================================*/
// 🧩 Wind-advected 3D falling sky precipitation (dendritic snow, sleet, rain streaks, bouncing hailstones) with coupled touchdown physics.

#pragma once

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             INCLUDES
------------------------------------------------------------------------------------------------------------------------------------------*/
#include "Engine/Foundation/Math.h"

#include <array>
#include <cstdint>
#include <vector>

namespace Frontier
{
/*------------------------------------------------------------------------------------------------------------------------------------------
                                                PRECIPITATION CONFIGURATION & RECORDS
------------------------------------------------------------------------------------------------------------------------------------------*/
enum class SkyPrecipitationPhase : uint8_t
{
    DendriticSnow = 0u, // Soft wind-fluttering crystalline snowflakes (1.0..1.85 m/s) accumulating into snow mounds
    SleetGraupel  = 1u, // Dense ice pellets (3.2..5.0 m/s fall speed)
    Rainfall      = 2u, // High-speed slanted specular/refractive rain streaks (7.2..10.4 m/s) feeding 2.5D puddles
    Hailstorm     = 3u  // Layered rime-ice hailstones (11.5..17.2 m/s) with multi-bounce ballistic ground/vehicle rebounds
};

struct SkyPrecipitationConfig
{
    SkyPrecipitationPhase Phase                    = SkyPrecipitationPhase::DendriticSnow;
    Vec3                  DomainCentreXY           = {0.0f, 0.0f, 0.0f};   // [m] - Horizontal centre of sky precipitation volume
    Vec3                  DomainHalfExtent         = {18.0f, 18.0f, 9.0f}; // [m] - Half-extents X, Y and half-height Z
    float                 GroundFloorZ             = 0.0f;                 // [m] - Base ground elevation fallback
    uint32_t              ParticleCount            = 2600u;                // [count] - Active 3D hydrometeors in volume
    float                 Intensity01              = 1.0f;                 // [0..1] - Scales active particle budget & optical density
    float                 FlakeRadiusScale         = 1.0f;                 // [-] - Multiplier on physical crystal/drop/hail radius
    bool                  EnableMoundConvergence   = false;                // [-] - Models leeward wind-eddy snowfall convergence
    Vec3                  ConvergenceCentreWorld   = {0.0f, 0.0f, 0.0f};   // [m] - Centre of leeward snow-drift accumulation zone
    float                 ConvergenceRadiusMetres  = 3.4f;                 // [m] - Characteristic eddy capture radius
    float                 ConvergenceStrength      = 0.0f;                 // [0..2] - Horizontal eddy pull + downdraft focus gain
    float                 HailRestitution          = 0.48f;                // [0..1] - Normal restitution coefficient for hail bounces
    uint32_t              MaxHailBounces           = 3u;                   // [count] - Parabolic rebounds before hail settles
    uint64_t              RandomSeed               = 0x510FA11ULL;         // [-] - Deterministic SplitMix64 initialization seed
};

struct SkyPrecipitationParticle
{
    Vec3     PositionWorld{};          // [m] - Current 3D world position
    Vec3     VelocityMps{};            // [m/s] - Instantaneous 3D velocity (terminal + wind + flutter or ballistic rebound)
    float    RadiusMetres    = 0.005f; // [m] - Physical flake / raindrop / hailstone radius
    float    TerminalFallMps = 1.35f;  // [m/s] - Terminal gravitational settling speed
    float    FlutterAmpMps   = 0.48f;  // [m/s] - Horizontal aerodynamic flutter amplitude
    float    FlutterFreqRad  = 3.4f;   // [rad/s] - Flutter oscillation frequency
    float    FlutterPhase    = 0.0f;   // [rad] - Per-particle deterministic phase & crystal orientation angle
    float    Reflectance     = 0.94f;  // [0..1] - Single-scatter crystal / ice albedo
    uint16_t BounceCount     = 0u;     // [count] - Completed elastic ground/obstacle rebounds (Hailstorm)
    uint16_t InReboundArc    = 0u;     // [0/1] - Non-zero while executing ballistic rebound parabola after impact
};

struct PrecipitationTouchdownEvent
{
    Vec3                  HitPositionWorld{};           // [m] - Exact 3D contact point on snow mound, puddle, rock, or vehicle
    Vec3                  ImpactVelocityMps{};          // [m/s] - Pre-impact 3D hydrometeor velocity
    float                 HydrometeorRadiusM = 0.005f;  // [m] - Physical particle radius
    SkyPrecipitationPhase Phase              = SkyPrecipitationPhase::DendriticSnow;
    uint32_t              BounceCount        = 0u;      // [count] - Rebound index at contact
};

struct SkyPrecipitationTelemetry
{
    uint32_t ActiveParticles      = 0u;   // [count] - Active 3D hydrometeors in sky volume
    uint32_t AirborneRebounding   = 0u;   // [count] - Hailstones currently mid-air in post-impact rebound arcs
    uint64_t RecycledTouchdowns   = 0u;   // [count] - Cumulative particles reaching ground/mound & recycling to ceiling
    uint64_t HailBounceContacts   = 0u;   // [count] - Cumulative elastic hailstone rebounds off ground/vehicles/rocks
    float    MeanFallSpeedMps     = 0.0f; // [m/s] - Mean downward speed of falling particles
    float    MeanHorizontalSpeed  = 0.0f; // [m/s] - Mean horizontal wind-drift speed
};

using PrecipitationWindSampler = Vec3 (*)(Vec3 WorldPoint, const void* UserContext) noexcept;

// Queries ground / snow-mound / obstacle / vehicle surface height & normal directly beneath or around a falling particle.
using PrecipitationSurfaceQuery = bool (*)(
    Vec3        WorldPoint,
    float&      OutSurfaceZ,
    Vec3&       OutSurfaceNormalUnit,
    float&      OutRestitutionScale,
    const void* SurfaceContext) noexcept;

// Receives exact landing snowflakes, raindrops, or settled hailstones to physically accumulate snow mounds / puddles!
using PrecipitationTouchdownSink = void (*)(
    const PrecipitationTouchdownEvent& Event,
    void*                              SinkContext) noexcept;

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                      SKY PRECIPITATION
------------------------------------------------------------------------------------------------------------------------------------------*/
class SkyPrecipitation
{
public:
    explicit SkyPrecipitation(const SkyPrecipitationConfig& Config = {});

    void Reconfigure(const SkyPrecipitationConfig& Config);

    // Standard step (toroidal horizontal wrap + flat GroundFloorZ recycle) kept 100% compatible with all existing suites.
    void StepPrecipitation(
        float                    DtSeconds,
        Vec3                     FallbackWindMps = {1.8f, 0.6f, 0.0f},
        PrecipitationWindSampler WindSampler     = nullptr,
        const void*              WindContext     = nullptr);

    // Physically coupled step: queries live snow-mound / terrain / vehicle elevation, bounces hailstones on parabolic arcs,
    // and delivers landed snowflakes/raindrops/hail directly to TouchdownSink so falling snow builds the 3D snow mound!
    void StepCoupledPrecipitation(
        float                      DtSeconds,
        Vec3                       FallbackWindMps,
        PrecipitationWindSampler   WindSampler,
        const void*                WindContext,
        PrecipitationSurfaceQuery  SurfaceQuery,
        const void*                SurfaceContext,
        PrecipitationTouchdownSink TouchdownSink,
        void*                      SinkContext);

    // Evaluates sunlit + sky-lit falling snowflakes, slanted rain streaks & shafts, or falling/bouncing hailstones along a ray.
    [[nodiscard]] Vec3 EvaluateRayPrecipitation(
        Vec3   RayOrigin,
        Vec3   RayDirectionUnit,
        float  MaxDistanceM,
        Vec3   SunDirectionUnit,
        Vec3   SunIrradianceRgb,
        Vec3   SkyAmbientRgb,
        float  PixelAngularRadians = 0.00145f,
        float* OutTransmittance    = nullptr) const noexcept;

    [[nodiscard]] const SkyPrecipitationConfig&                 Configuration() const noexcept { return Config_; }
    [[nodiscard]] const std::vector<SkyPrecipitationParticle>&  Particles() const noexcept { return Particles_; }
    [[nodiscard]] const SkyPrecipitationTelemetry&              Telemetry() const noexcept { return Telemetry_; }

private:
    void RespawnParticleAtCeiling(SkyPrecipitationParticle& P, uint32_t ParticleIndex) noexcept;
    void RebuildSpatialAccelerationGrid();

    static constexpr uint32_t GridNx = 24u;
    static constexpr uint32_t GridNy = 24u;
    static constexpr uint32_t GridNz = 12u;
    static constexpr uint32_t GridCellCount = GridNx * GridNy * GridNz;

    SkyPrecipitationConfig                   Config_{};
    float                                    ElapsedSeconds_ = 0.0f;
    uint64_t                                 RespawnCounter_ = 1u;
    Vec3                                     VolumeMin_{};
    Vec3                                     VolumeMax_{};
    std::vector<SkyPrecipitationParticle>    Particles_{};
    std::array<uint32_t, GridCellCount + 1u> CellOffsets_{};
    std::vector<uint32_t>                    SortedIndices_{};
    SkyPrecipitationTelemetry                Telemetry_{};
};

} // namespace Frontier
