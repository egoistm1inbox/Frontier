/*==========================================================================================================================================
                                                     SKYPRECIPITATION.H
==========================================================================================================================================*/
// 🧩 Wind-advected 3D falling sky precipitation (dendritic snow, sleet pellets, rain streaks) with spatial-grid optical evaluation.

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
    DendriticSnow = 0u, // Soft wind-fluttering crystalline snowflakes (1.0..1.85 m/s fall speed)
    SleetGraupel  = 1u, // Dense ice pellets (3.2..5.0 m/s fall speed)
    Rainfall      = 2u  // High-speed specular rain streaks (6.5..9.5 m/s fall speed)
};

struct SkyPrecipitationConfig
{
    SkyPrecipitationPhase Phase            = SkyPrecipitationPhase::DendriticSnow;
    Vec3                  DomainCentreXY   = {0.0f, 0.0f, 0.0f};   // [m] - Horizontal centre of toroidal sky volume
    Vec3                  DomainHalfExtent = {18.0f, 18.0f, 9.0f}; // [m] - Covers X, Y around camera and Z in [0, 2*Z]
    float                 GroundFloorZ     = 0.0f;                 // [m] - Base ground elevation where flakes recycle to top
    uint32_t              ParticleCount    = 2600u;                // [count] - Active 3D falling hydrometeors in volume
    float                 Intensity01      = 1.0f;                 // [0..1] - Scales active particle fraction & optical density
    float                 FlakeRadiusScale = 1.0f;                 // [-] - Multiplier on physical crystal radius
    uint64_t              RandomSeed       = 0x510FA11ULL;         // [-] - Deterministic SplitMix64 initialization seed
};

struct SkyPrecipitationParticle
{
    Vec3  PositionWorld{};          // [m] - Current 3D world position
    Vec3  VelocityMps{};            // [m] - Instantaneous 3D wind + terminal + flutter velocity
    float RadiusMetres    = 0.005f; // [m] - Physical flake/drop radius
    float TerminalFallMps = 1.35f;  // [m/s] - Terminal gravitational settling speed
    float FlutterAmpMps   = 0.48f;  // [m/s] - Horizontal aerodynamic flutter amplitude
    float FlutterFreqRad  = 3.4f;   // [rad/s] - Flutter oscillation frequency
    float FlutterPhase    = 0.0f;   // [rad] - Per-flake deterministic phase
    float Reflectance     = 0.94f;  // [0..1] - Crystal single-scatter albedo
};

struct SkyPrecipitationTelemetry
{
    uint32_t ActiveParticles      = 0u;   // [count] - Active hydrometeors in sky volume
    uint64_t RecycledTouchdowns   = 0u;   // [count] - Cumulative flakes reaching GroundFloorZ and wrapping to ceiling
    float    MeanFallSpeedMps     = 0.0f; // [m/s] - Mean vertical fall speed
    float    MeanHorizontalSpeed  = 0.0f; // [m/s] - Mean horizontal wind drift speed
};

using PrecipitationWindSampler = Vec3 (*)(Vec3 WorldPoint, const void* UserContext) noexcept;

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                      SKY PRECIPITATION
------------------------------------------------------------------------------------------------------------------------------------------*/
class SkyPrecipitation
{
public:
    explicit SkyPrecipitation(const SkyPrecipitationConfig& Config = {});

    void Reconfigure(const SkyPrecipitationConfig& Config);

    // Steps all 3D falling snowflakes/hydrometeors with optional 3D WindField sampler, sinusoidal flutter, toroidal wrap,
    // and rebuilds the 3D uniform spatial grid for O(1)-per-cell camera/reflection ray evaluation.
    void StepPrecipitation(
        float                    DtSeconds,
        Vec3                     FallbackWindMps = {1.8f, 0.6f, 0.0f},
        PrecipitationWindSampler WindSampler     = nullptr,
        const void*              WindContext     = nullptr);

    // Evaluates sunlit + sky-lit falling snowflakes/streaks along a ray [0, MaxDistanceM] (occluded by solid geometry).
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
    void RebuildSpatialAccelerationGrid();

    static constexpr uint32_t GridNx = 16u;
    static constexpr uint32_t GridNy = 16u;
    static constexpr uint32_t GridNz = 8u;
    static constexpr uint32_t GridCellCount = GridNx * GridNy * GridNz;

    SkyPrecipitationConfig                   Config_{};
    float                                    ElapsedSeconds_ = 0.0f;
    Vec3                                     VolumeMin_{};
    Vec3                                     VolumeMax_{};
    std::vector<SkyPrecipitationParticle>    Particles_{};
    std::array<uint32_t, GridCellCount + 1u> CellOffsets_{};
    std::vector<uint32_t>                    SortedIndices_{};
    SkyPrecipitationTelemetry                Telemetry_{};
};

} // namespace Frontier
