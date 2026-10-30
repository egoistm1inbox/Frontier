/*==========================================================================================================================================
                                                  LIGHTNINGTHUNDEREXTENSION.H
==========================================================================================================================================*/
// 🧩 Branched dielectric-breakdown lightning, internal volumetric cloud flash, scene ReSTIR lighting, and delayed multi-segment thunder.

#pragma once

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             INCLUDES
------------------------------------------------------------------------------------------------------------------------------------------*/
#include "Engine/Audio/AudioFoundation.h"
#include "Engine/Foundation/Math.h"
#include "Engine/Rendering/CloudField.h"

#include <cstdint>
#include <vector>

namespace Frontier
{
/*------------------------------------------------------------------------------------------------------------------------------------------
                                                  LIGHTNING & THUNDER STRUCTURES
------------------------------------------------------------------------------------------------------------------------------------------*/
struct LightningBoltSegment
{
    Vec3  StartWorld{};        // [m] - Segment start point (descending from cloud base or branch)
    Vec3  EndWorld{};          // [m] - Segment end point
    float ChannelRadiusM{};    // [m] - Main-trunk vs fork-branch plasma channel radius
    float RelativeIntensity{}; // [0..1] - Relative current fraction (1.0 on return trunk, 0.25..0.55 on forks)
};

struct LightningRibbonVertex
{
    Vec3  Position{};    // [m] - World-space ribbon vertex
    Vec3  RadianceRgb{}; // [W/(sr*m^2)] - Blue-white 28,000 K plasma channel radiance
    float CrossCoord{};  // [-1..+1] - Cross-channel coordinate for core-to-corona falloff
};

struct LightningBoltPolygonSurface
{
    std::vector<LightningRibbonVertex> Vertices;
    std::vector<uint32_t>              Indices;
};

struct LightningFlashLuminaire
{
    Vec3  Position{};         // [m] - World-space point along lightning trunk
    Vec3  RadiantIntensity{}; // [W/sr] - Instantaneous spectral radiant intensity for SDF/RTX ReSTIR & fog
    float InfluenceRadiusM{}; // [m] - Effective scene illumination range
};

struct ScheduledThunderSegment
{
    uint32_t                             BoltIdentifier      = 0u;     // [id] - Originating lightning discharge id
    Vec3                                 SegmentMidpoint     = {};     // [m] - 3D acoustic origin along the bolt channel
    double                               StrikeTimeSeconds   = 0.0;    // [s] - Simulation timestamp of optical flash
    double                               ArrivalTimeSeconds  = 0.0;    // [s] - Exact speed-of-sound acoustic arrival timestamp
    float                                DistanceToListenerM = 0.0f;   // [m] - Slant distance from bolt segment to listener
    float                                PeakShockGain       = 0.0f;   // [0..2] - Inverse-distance + trunk-current acoustic amplitude
    float                                HighFreqCrackRatio  = 0.0f;   // [0..1] - 1 = sharp nearby N-wave crack, 0 = distant low rumble
    float                                HighFrequencyRolloffHz     = 800.0f; // [Hz] - ISO 9613-1 distance-attenuated air-absorption cutoff
    bool                                 ArrivedAtListener   = false;  // [boolean] - True once SimulationClock >= ArrivalTimeSeconds
    Audio::AcousticSourceDescriptor      AudioSource{};
    Audio::ResolvedSpatialAcousticMetrics SpatialMetrics{};
};

struct LightningStormConfig
{
    float    AmbientTemperatureKelvin = 288.15f;  // [K] - Governs speed of sound c = 331.3 + 0.606 * (T - 273.15)
    float    CloudDiffusionLengthM    = 680.0f;   // [m] - Multiple-scattering glow diffusion radius inside storm clouds
    float    PeakReturnStrokeAmps     = 32000.0f; // [A] - Peak return-stroke current (30 kA typical CG strike)
    float    FlashDurationSeconds     = 0.42f;    // [s] - Optical return-stroke + dart-leader restrike window
    uint32_t SubdivisionGenerations   = 5u;       // [count] - Recursive 3D midpoint tortuosity generations
};

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                   LIGHTNING THUNDER EXTENSION
------------------------------------------------------------------------------------------------------------------------------------------*/
class LightningStorm
{
public:
    explicit LightningStorm(const LightningStormConfig& Config = {});

    void Reconfigure(const LightningStormConfig& Config) noexcept;

    // Locates dense overhead CloudField storm cell near SearchCentreWorld and synthesizes a branched 3D tortuous bolt
    // + schedules speed-of-sound multi-segment thunder arrivals for Listener!
    bool TriggerCloudToGroundStrike(
        const CloudParameters&             Clouds,
        Vec3                               SearchCentreWorld,
        Vec3                               GroundTargetWorld,
        const Audio::AcousticListenerPose& Listener,
        uint64_t                           RandomSeed = 0x9E3779B97F4A7C15ull);

    // Advances optical double-exponential return-stroke + secondary restrike pulse and releases arrived thunder waves!
    void AdvanceStormTimeline(
        double                             DtSeconds,
        const Audio::AcousticListenerPose& Listener,
        Vec3                               ViewerPosition);

    // Volumetric internal cloud scattering glow: illuminates CloudField storm anvils from the inside during a flash!
    [[nodiscard]] Vec3 EvaluateCloudInternalFlashRadiance(Vec3 SampleWorldPoint, double LocalCloudDensity) const noexcept;

    // Scene, wet-puddle, fog, mirror & portal direct flash irradiance + luminaire export for SDF/RTX ReSTIR!
    [[nodiscard]] Vec3 EvaluateSceneFlashIrradiance(Vec3 SurfacePoint, Vec3 SurfaceNormal) const noexcept;
    void PopulateActiveFlashLuminaires(std::vector<LightningFlashLuminaire>& OutLuminaires) const;

    [[nodiscard]] double SpeedOfSoundMetresPerSecond() const noexcept;
    [[nodiscard]] float  InstantaneousFlashEnvelope() const noexcept { return CurrentFlashEnvelope_; }
    [[nodiscard]] double SimulationClockSeconds() const noexcept { return ClockSeconds_; }

    [[nodiscard]] const std::vector<LightningBoltSegment>&    ActiveBoltSegments() const noexcept { return ActiveSegments_; }
    [[nodiscard]] const LightningBoltPolygonSurface&          BoltPolygonSurface() const noexcept { return RibbonSurface_; }
    [[nodiscard]] const std::vector<ScheduledThunderSegment>& PendingAndArrivedThunder() const noexcept { return ThunderTimeline_; }
    [[nodiscard]] const std::vector<ScheduledThunderSegment>& NewlyArrivedThunderWaves() const noexcept { return NewlyArrivedWaves_; }

private:
    void RebuildCameraAlignedRibbonSurface(Vec3 ViewerPosition);

    LightningStormConfig                 Config_{};
    double                               ClockSeconds_          = 0.0;
    double                               LastStrikeTimeSeconds_ = -100.0;
    uint32_t                             NextBoltIdentifier_    = 1u;
    float                                CurrentFlashEnvelope_  = 0.0f;
    Vec3                                 CloudOriginWorld_{};
    Vec3                                 GroundStrikeWorld_{};
    std::vector<LightningBoltSegment>    ActiveSegments_;
    LightningBoltPolygonSurface          RibbonSurface_{};
    std::vector<ScheduledThunderSegment> ThunderTimeline_;
    std::vector<ScheduledThunderSegment> NewlyArrivedWaves_;
};

} // namespace Frontier
