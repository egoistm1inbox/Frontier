/*==========================================================================================================================================
                                                       WEATHER EFFECTS
                                     ------------------------------------------------------------------
                 Analytic precipitation volume + deterministic lightning bolt generation
                      (plan §8.1: Precipitation*, LightningRaster — visual side; thunder audio
                        remains Phase 8 per plan §10.3).
==========================================================================================================================================*/

// 🧩 Weather effects: precipitation as a closed-form function of time (no integrator drift — each
//    particle's position wraps analytically inside a camera-centred volume, so density is conserved
//    exactly at every instant), and lightning as midpoint-displacement polylines with a multi-stroke
//    intensity envelope. Both fully deterministic per seed.

#pragma once

#include "ClusterNesting.h"
#include "Engine/Foundation/DeterministicRandom.h"

#include <cstdint>
#include <vector>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     PRECIPITATION
//------------------------------------------------------------------------------------------------------------------------

struct PrecipitationParameters
{
    double   VolumeExtentM      = 40.0;     // [m]   horizontal wrap extent around the anchor
    double   VolumeHeightM      = 25.0;     // [m]   vertical wrap height above surface
    double   FallSpeedMps       = 9.0;      // [m/s] rain ~9.0, snow ~1.45, hail ~16.5
    double   WindXMps           = 2.0;      // [m/s] ambient east/forward wind
    double   WindYMps           = 0.5;      // [m/s] ambient north/left wind
    double   FlutterAmplitudeM  = 0.0;      // [m]   helical/curl drift amplitude (snow ~0.34, rain/hail 0)
    double   FlutterFrequencyHz = 1.15;     // [Hz]  snowflake swirl frequency
    double   HailRestitution    = 0.50;     // [-]   ice-pellet bounce restitution on road/chassis [0..0.85]
    double   GroundElevationM   = 0.0;      // [m]   impact plane Z for ballistic hail rebound
    uint64_t Seed               = 0x9A17ull;
};

enum class PrecipitationSpecies : uint8_t
{
    Clear = 0,   // [-] dry conditions
    Rain  = 1,   // [-] elongated refractive rain streaks + wet specular road
    Snow  = 2,   // [-] curling crystalline flakes + normal-projected snow blanket
    Hail  = 3    // [-] high-velocity ice pellets + parabolic restitution bounce
};

struct PrecipitationParticleSample
{
    SpatialVector Position       = { 0.0, 0.0, 0.0 };   // [m]   instantaneous particle position
    SpatialVector Velocity       = { 0.0, 0.0, 0.0 };   // [m/s] instantaneous velocity (including flutter/rebound)
    double        RadiusMetres   = 0.002;               // [m]   optical hydrometeor radius
    double        StreakLengthM  = 0.0;                 // [m]   shutter motion-blur streak length
    bool          Rebounding     = false;               // [-]   true during post-impact hail bounce arc
};

[[nodiscard]] PrecipitationParameters PresetPrecipitationParameters(
    PrecipitationSpecies Species,
    double               Intensity01 = 1.0,
    uint64_t             Seed        = 0x9A17ull) noexcept;

// Normal-projected snow/ice cover in [0, 1] for upward-facing road, roof, and hangar surfaces.
[[nodiscard]] double EvaluateSurfaceSnowCover(
    SpatialVector WorldPosition,
    SpatialVector WorldNormal,
    double        AccumulatedDepthMetres) noexcept;

// Road tyre grip multiplier induced by wet rain film, packed snow, or hail ice pellets.
[[nodiscard]] double EvaluateWeatherRoadGripScale(
    PrecipitationSpecies Species,
    double               Intensity01,
    double               AccumulatedDepthMetres = 0.0) noexcept;

class PrecipitationField
{
  public:
    explicit PrecipitationField(const PrecipitationParameters& Parameters) noexcept : P_(Parameters) {}

    // Position of particle Index at time TimeS, wrapped into the volume around Anchor.
    [[nodiscard]] SpatialVector ParticleAt(uint32_t Index, double TimeS, SpatialVector Anchor) const noexcept;

    // Velocity of particle Index (m/s) — per-particle fall-speed variation from its hash.
    [[nodiscard]] SpatialVector ParticleVelocity(uint32_t Index) const noexcept;

    // Species-aware particle kinematics (snow helical curl flutter + hail ballistic surface rebound).
    [[nodiscard]] PrecipitationParticleSample EvaluateHydrometeor(
        uint32_t             Index,
        double               TimeS,
        SpatialVector        Anchor,
        PrecipitationSpecies Species,
        double               ShutterSeconds = 1.0 / 60.0) const noexcept;

    // Exact wrap period of particle Index in the vertical axis (seconds).
    [[nodiscard]] double VerticalPeriod(uint32_t Index) const noexcept;

  private:
    void Hashes(uint32_t Index, double& U0, double& U1, double& U2, double& U3) const noexcept;
    PrecipitationParameters P_;
};

//------------------------------------------------------------------------------------------------------------------------
//                                                      LIGHTNING
//------------------------------------------------------------------------------------------------------------------------

struct LightningBolt
{
    std::vector<SpatialVector>              MainChannel;   // 2^Depth + 1 points, From -> To
    std::vector<std::vector<SpatialVector>> Branches;      // each starts on the main channel
};

// Midpoint-displacement bolt. Depth subdivisions, Roughness as the fraction of segment length
// allowed as lateral offset. Endpoints are exact.
[[nodiscard]] LightningBolt GenerateLightningBolt(SpatialVector From, SpatialVector To, uint32_t Depth,
                                                  double Roughness, uint64_t Seed, uint32_t MaxBranches = 3);

// Multi-stroke flash envelope: main stroke at t=0 with 2-3 restrikes; intensity in [0, 1].
// TimeS measured from the first stroke; the seed fixes restrike timing/strength per bolt id.
[[nodiscard]] double LightningIntensity(double TimeS, uint64_t Seed) noexcept;

} // namespace Frontier
