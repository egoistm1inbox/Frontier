/*==========================================================================================================================================
                                                       AUDIOFOUNDATION.H
==========================================================================================================================================*/
// 🧩 Engine Audio Foundation: zero-device spatial acoustics, physical Doppler kinematics, propulsion/tyre/weather harmonic descriptors,
//    mix-bus routing topology, and lock-free SnapshotExchange<AcousticFrameSnapshot> bridge (foundation contract only; DSP/assets deferred).

#pragma once

#include "Engine/Foundation/Math.h"
#include "Engine/Threading/SnapshotExchange.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace Frontier::Audio
{

//------------------------------------------------------------------------------------------------------------------------
//                                          MIX BUS TOPOLOGY & SPATIAL LISTENER
//------------------------------------------------------------------------------------------------------------------------

enum class AudioMixBusRoute : std::uint8_t
{
    MasterOutput        = 0,
    VehiclePropulsion   = 1,
    TyreAndSurface      = 2,
    WeatherAtmosphere   = 3,
    WorldImpacts        = 4,
    MultiplayerVoice    = 5,
    UserInterface       = 6
};

struct MixBusGainSettings
{
    std::array<float, 7> BusLinearGain = { 1.0f, 0.90f, 0.85f, 0.80f, 0.95f, 1.0f, 0.75f };
    float                SpeedOfSoundMps = 343.2f; // [m/s] dry air @ 20 C
};

struct AcousticListenerPose
{
    Vec3 Position = { 0.0f, 0.0f, 1.6f }; // [m]
    Vec3 Forward  = { 1.0f, 0.0f, 0.0f }; // [-] unit forward
    Vec3 Up       = { 0.0f, 0.0f, 1.0f }; // [-] unit up
    Vec3 Velocity = { 0.0f, 0.0f, 0.0f }; // [m/s]
};

//------------------------------------------------------------------------------------------------------------------------
//                                  SPATIAL ACOUSTIC SOURCE & POWERTRAIN HARMONIC BUS
//------------------------------------------------------------------------------------------------------------------------

struct AcousticSourceDescriptor
{
    std::uint32_t    SourceIdentifier     = 0u;
    AudioMixBusRoute BusRoute             = AudioMixBusRoute::WorldImpacts;
    Vec3             Position             = { 0.0f, 0.0f, 0.0f }; // [m]
    Vec3             Velocity             = { 0.0f, 0.0f, 0.0f }; // [m/s]
    float            ReferenceDistanceM   = 2.0f;                 // [m] inverse-distance clamp radius
    float            MaxAudibleDistanceM  = 180.0f;               // [m]
    float            BaseGainLinear       = 1.0f;                 // [0..2]
    float            BasePitchRatio       = 1.0f;                 // [0.25..4.0]
    float            DirectOcclusion01    = 0.0f;                 // [0..1] geometry low-pass occlusion factor
};

struct PropulsionHarmonicTelemetry
{
    float CrankshaftOrderHz       = 30.0f;  // [Hz]  (RPM / 60) * (Cylinders / 2) primary firing frequency
    float EngineLoadNormalized    = 0.0f;   // [0..1] intake/combustion bark weight
    float TurboWhistleFrequencyHz = 0.0f;   // [Hz]  blade-pass whistle from TurboShaftRpm
    float SuperchargerWhineHz     = 0.0f;   // [Hz]  positive-displacement lobe meshing frequency
    float ElectricInverterPitchHz = 0.0f;   // [Hz]  BEV/Hybrid rotor electrical pole-pair frequency
    float TyreSlipSquealGain01    = 0.0f;   // [0..1] lateral/longitudinal stick-slip excitation
    float RainHailImpactGain01    = 0.0f;   // [0..1] chassis/windscreen hydrometeor patter intensity
};

struct ResolvedSpatialAcousticMetrics
{
    float DistanceMetres     = 0.0f;
    float AttenuatedGain     = 0.0f;
    float DopplerPitchShift  = 1.0f;
    float StereoPanLeftRight = 0.0f; // [-1 = full left, +1 = full right]
};

// Exact classical acoustic Doppler shift + inverse-distance rolloff + interaural azimuth pan.
[[nodiscard]] inline ResolvedSpatialAcousticMetrics EvaluateSpatialAcoustics(
    const AcousticListenerPose&     Listener,
    const AcousticSourceDescriptor& Source,
    const MixBusGainSettings&       Settings = {}) noexcept
{
    ResolvedSpatialAcousticMetrics Out{};
    const Vec3  Delta = Source.Position - Listener.Position;
    const float Dist  = Length(Delta);
    Out.DistanceMetres = Dist;
    if (Dist >= Source.MaxAudibleDistanceM)
    {
        return Out;
    }

    const Vec3 DirToSource = (Dist > 1.0e-4f) ? (Delta * (1.0f / Dist)) : Listener.Forward;

    const float C          = std::max(100.0f, Settings.SpeedOfSoundMps);
    // DirToSource points Listener -> Source: approaching source has VSource < 0 => higher observed pitch!
    const float VListener  = std::clamp(Dot(Listener.Velocity, DirToSource), -0.75f * C, 0.75f * C);
    const float VSource    = std::clamp(Dot(Source.Velocity,   DirToSource), -0.75f * C, 0.75f * C);
    Out.DopplerPitchShift  = Source.BasePitchRatio * ((C + VListener) / std::max(25.0f, C + VSource));

    const float ClampedDist   = std::max(Source.ReferenceDistanceM, Dist);
    const float WindowFade    = 1.0f - std::clamp((Dist - 0.80f * Source.MaxAudibleDistanceM) /
                                                  std::max(1.0f, 0.20f * Source.MaxAudibleDistanceM), 0.0f, 1.0f);
    const float DistanceAtten = (Source.ReferenceDistanceM / ClampedDist) * WindowFade;
    const float OcclusionGain = 1.0f - 0.75f * std::clamp(Source.DirectOcclusion01, 0.0f, 1.0f);
    const float BusGain       = Settings.BusLinearGain[static_cast<std::size_t>(Source.BusRoute) % Settings.BusLinearGain.size()] *
                                Settings.BusLinearGain[0];

    Out.AttenuatedGain = Source.BaseGainLinear * DistanceAtten * OcclusionGain * BusGain;

    // Right axis = Forward x Up in right-handed Z-up world coordinates.
    const Vec3 RightAxis   = Normalise(Cross(Listener.Forward, Listener.Up));
    Out.StereoPanLeftRight = std::clamp(Dot(DirToSource, RightAxis), -1.0f, 1.0f);
    return Out;
}

//------------------------------------------------------------------------------------------------------------------------
//                                  LOCK-FREE SIMULATION -> AUDIO THREAD SNAPSHOT BRIDGE
//------------------------------------------------------------------------------------------------------------------------

struct AcousticFrameSnapshot
{
    static constexpr std::size_t MaxSpatialSources = 64u;

    std::uint64_t                                           FrameOrdinal      = 0u;
    AcousticListenerPose                                    Listener{};
    MixBusGainSettings                                      BusSettings{};
    PropulsionHarmonicTelemetry                             PlayerVehicleHarmonics{};
    std::uint32_t                                           ActiveSourceCount = 0u;
    std::array<AcousticSourceDescriptor, MaxSpatialSources> Sources{};
};

using AcousticSnapshotBridge = SnapshotExchange<AcousticFrameSnapshot>;

} // namespace Frontier::Audio
