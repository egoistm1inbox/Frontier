/*==========================================================================================================================================
                                                 LIGHTNINGTHUNDEREXTENSION.CPP
==========================================================================================================================================*/
// 🧩 Branched dielectric-breakdown lightning, internal volumetric cloud flash, scene ReSTIR lighting, and delayed multi-segment thunder.

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             INCLUDES
------------------------------------------------------------------------------------------------------------------------------------------*/
#include "Engine/VisualEffects/LightningStorm.h"

#include <algorithm>
#include <cmath>

namespace Frontier
{
namespace
{
// Deterministic SplitMix64 generator for tortuous lightning path synthesis.
struct SplitMixRng
{
    uint64_t Seed = 1ull;

    [[nodiscard]] float NextSignedUnit() noexcept
    {
        Seed += 0x9E3779B97F4A7C15ull;
        uint64_t Z = Seed;
        Z          = (Z ^ (Z >> 30u)) * 0xBF58476D1CE4E5B9ull;
        Z          = (Z ^ (Z >> 27u)) * 0x94D049BB133111EBull;
        Z          = Z ^ (Z >> 31u);
        const double U = static_cast<double>(Z >> 11u) * (1.0 / 9007199254740992.0);
        return static_cast<float>(U * 2.0 - 1.0);
    }

    [[nodiscard]] float NextZeroToOne() noexcept
    {
        return 0.5f * (NextSignedUnit() + 1.0f);
    }
};

void SubdivideBoltRecursive(
    Vec3                               Start,
    Vec3                               End,
    uint32_t                           RemainingDepth,
    float                              JitterAmplitude,
    float                              ChannelRadius,
    float                              RelativeIntensity,
    bool                               AllowForks,
    SplitMixRng&                       Rng,
    std::vector<LightningBoltSegment>& OutSegments)
{
    if (RemainingDepth == 0u)
    {
        OutSegments.push_back({Start, End, ChannelRadius, RelativeIntensity});
        return;
    }

    const Vec3 Mid = (Start + End) * 0.5f +
                     Vec3{
                         Rng.NextSignedUnit() * JitterAmplitude,
                         Rng.NextSignedUnit() * JitterAmplitude,
                         Rng.NextSignedUnit() * JitterAmplitude * 0.22f};

    SubdivideBoltRecursive(
        Start,
        Mid,
        RemainingDepth - 1u,
        JitterAmplitude * 0.52f,
        ChannelRadius,
        RelativeIntensity,
        AllowForks,
        Rng,
        OutSegments);

    SubdivideBoltRecursive(
        Mid,
        End,
        RemainingDepth - 1u,
        JitterAmplitude * 0.52f,
        ChannelRadius,
        RelativeIntensity,
        AllowForks,
        Rng,
        OutSegments);

    // Dielectric stepped-leader branching off upper/mid segments!
    if (AllowForks && RemainingDepth >= 2u && Rng.NextZeroToOne() < 0.42f)
    {
        const Vec3 TrunkSpan = End - Mid;
        const Vec3 ForkEnd   = Mid + TrunkSpan * 0.72f +
                             Vec3{
                                 Rng.NextSignedUnit() * JitterAmplitude * 1.45f,
                                 Rng.NextSignedUnit() * JitterAmplitude * 1.45f,
                                 -std::abs(Rng.NextSignedUnit()) * JitterAmplitude * 0.40f};
        SubdivideBoltRecursive(
            Mid,
            ForkEnd,
            RemainingDepth - 2u,
            JitterAmplitude * 0.45f,
            ChannelRadius * 0.48f,
            RelativeIntensity * 0.42f,
            false,
            Rng,
            OutSegments);
    }
}

[[nodiscard]] float EvaluateReturnStrokePulse(double ElapsedSinceStrike, double DurationSeconds) noexcept
{
    if (ElapsedSinceStrike < 0.0 || ElapsedSinceStrike > DurationSeconds)
    {
        return 0.0f;
    }
    // Primary Heidler/double-exponential return stroke + realistic 85 ms dart-leader secondary restrike!
    const double T1     = ElapsedSinceStrike;
    const double MainP  = std::exp(-T1 / 0.032) * (1.0 - std::exp(-T1 / 0.0018));
    const double T2     = ElapsedSinceStrike - 0.088;
    const double ReStrk = (T2 > 0.0) ? (0.62 * std::exp(-T2 / 0.048) * (1.0 - std::exp(-T2 / 0.0022))) : 0.0;
    const double Glow   = 0.14 * std::exp(-T1 / 0.18);
    return static_cast<float>(std::clamp(MainP + ReStrk + Glow, 0.0, 1.25));
}
} // namespace

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                      LIGHTNING & THUNDER CORE
------------------------------------------------------------------------------------------------------------------------------------------*/
LightningStorm::LightningStorm(const LightningStormConfig& Config)
    : Config_(Config)
{
}

void LightningStorm::Reconfigure(const LightningStormConfig& Config) noexcept
{
    Config_ = Config;
}

double LightningStorm::SpeedOfSoundMetresPerSecond() const noexcept
{
    const double TempCelsius = static_cast<double>(Config_.AmbientTemperatureKelvin) - 273.15;
    return std::clamp(331.3 + 0.606 * TempCelsius, 290.0, 390.0);
}

bool LightningStorm::TriggerCloudToGroundStrike(
    const CloudParameters&             Clouds,
    Vec3                               SearchCentreWorld,
    Vec3                               GroundTargetWorld,
    const Audio::AcousticListenerPose& Listener,
    uint64_t                           RandomSeed)
{
    // Locate the densest storm-cloud column near SearchCentreWorld (lightning requires real convective cloud mass!).
    const double MidCloudZ = 0.38 * Clouds.TopHeightM + 0.62 * Clouds.BaseHeightM;
    double       BestDens  = 0.0;
    Vec3         BestCell  = Vec3{SearchCentreWorld.X, SearchCentreWorld.Y, static_cast<float>(MidCloudZ)};

    for (int Gy = -4; Gy <= 4; ++Gy)
    {
        for (int Gx = -4; Gx <= 4; ++Gx)
        {
            const double Sx    = static_cast<double>(SearchCentreWorld.X) + static_cast<double>(Gx) * 180.0;
            const double Sy    = static_cast<double>(SearchCentreWorld.Y) + static_cast<double>(Gy) * 180.0;
            const double D0    = CloudDensity(Clouds, SpatialVector{Sx, Sy, Clouds.BaseHeightM + 120.0});
            const double D1    = CloudDensity(Clouds, SpatialVector{Sx, Sy, MidCloudZ});
            const double RawD  = 0.55 * D0 + 0.45 * D1;
            const double Dist  = std::hypot(static_cast<double>(Gx) * 180.0, static_cast<double>(Gy) * 180.0);
            const double Score = (RawD > 1.0e-4) ? (RawD + 1.0e-4 / (1.0 + 0.002 * Dist)) : 0.0;
            if (Score > BestDens)
            {
                BestDens = Score;
                BestCell = Vec3{static_cast<float>(Sx), static_cast<float>(Sy), static_cast<float>(Clouds.BaseHeightM + 160.0)};
            }
        }
    }

    if (BestDens <= 1.0e-4)
    {
        return false; // Clear sky cannot produce cloud-to-ground lightning!
    }

    CloudOriginWorld_      = BestCell;
    GroundStrikeWorld_     = GroundTargetWorld;
    LastStrikeTimeSeconds_ = ClockSeconds_;
    CurrentFlashEnvelope_  = 1.0f;

    ActiveSegments_.clear();
    SplitMixRng  Rng{RandomSeed ^ (static_cast<uint64_t>(NextBoltIdentifier_) * 0x9E3779B97F4A7C15ull)};
    const float  VerticalSpan = std::max(120.0f, CloudOriginWorld_.Z - GroundStrikeWorld_.Z);
    const uint32_t Depth      = std::clamp(Config_.SubdivisionGenerations, 2u, 7u);

    SubdivideBoltRecursive(
        CloudOriginWorld_,
        GroundStrikeWorld_,
        Depth,
        VerticalSpan * 0.14f,
        0.55f,
        1.0f,
        true,
        Rng,
        ActiveSegments_);

    // Schedule speed-of-sound multi-segment thunder arrivals along main trunk segments!
    const double               SpeedSound = SpeedOfSoundMetresPerSecond();
    Audio::MixBusGainSettings  MixSettings{};
    MixSettings.SpeedOfSoundMps = static_cast<float>(SpeedSound);

    const uint32_t BoltId = NextBoltIdentifier_++;
    const std::size_t Stride = std::max<std::size_t>(1u, ActiveSegments_.size() / 12u);

    for (std::size_t S = 0u; S < ActiveSegments_.size(); S += Stride)
    {
        const auto& Seg = ActiveSegments_[S];
        if (Seg.RelativeIntensity < 0.75f)
        {
            continue; // Main return-stroke channel dominates shockwave thunder
        }

        const Vec3  Mid      = (Seg.StartWorld + Seg.EndWorld) * 0.5f;
        const Vec3  ToList   = Mid - Listener.Position;
        const float Distance = std::max(1.0f, Length(ToList));
        const double DelayS  = static_cast<double>(Distance) / SpeedSound;

        ScheduledThunderSegment Wave{};
        Wave.BoltIdentifier      = BoltId;
        Wave.SegmentMidpoint     = Mid;
        Wave.StrikeTimeSeconds   = ClockSeconds_;
        Wave.ArrivalTimeSeconds  = ClockSeconds_ + DelayS;
        Wave.DistanceToListenerM = Distance;
        // ISO 9613-1 high-frequency air absorption: close strike (<150 m) is sharp N-wave crack; >1200 m is deep rumble!
        Wave.HighFreqCrackRatio  = std::exp(-Distance / 380.0f);
        Wave.HighFrequencyRolloffHz     = 140.0f + 9800.0f * std::exp(-Distance / 420.0f);

        Wave.AudioSource.SourceIdentifier    = (BoltId << 8u) | static_cast<uint32_t>(S & 0xFFu);
        Wave.AudioSource.BusRoute            = Audio::AudioMixBusRoute::WeatherAtmosphere;
        Wave.AudioSource.Position            = Mid;
        Wave.AudioSource.ReferenceDistanceM  = 35.0f;
        Wave.AudioSource.MaxAudibleDistanceM = 12000.0f;
        Wave.AudioSource.BaseGainLinear      = std::clamp((Config_.PeakReturnStrokeAmps / 30000.0f) * 1.6f, 0.2f, 2.0f);
        Wave.AudioSource.BasePitchRatio      = 0.72f + 0.55f * Wave.HighFreqCrackRatio;
        Wave.SpatialMetrics                  = Audio::EvaluateSpatialAcoustics(Listener, Wave.AudioSource, MixSettings);
        Wave.PeakShockGain                   = Wave.SpatialMetrics.AttenuatedGain;

        ThunderTimeline_.push_back(Wave);
    }

    RebuildCameraAlignedRibbonSurface(Listener.Position);
    return true;
}

void LightningStorm::AdvanceStormTimeline(
    double                             DtSeconds,
    const Audio::AcousticListenerPose& Listener,
    Vec3                               ViewerPosition)
{
    ClockSeconds_ += std::max(0.0, DtSeconds);
    CurrentFlashEnvelope_ = EvaluateReturnStrokePulse(ClockSeconds_ - LastStrikeTimeSeconds_, Config_.FlashDurationSeconds);

    if (CurrentFlashEnvelope_ > 1.0e-3f)
    {
        RebuildCameraAlignedRibbonSurface(ViewerPosition);
    }
    else
    {
        RibbonSurface_.Vertices.clear();
        RibbonSurface_.Indices.clear();
    }

    NewlyArrivedWaves_.clear();
    Audio::MixBusGainSettings MixSettings{};
    MixSettings.SpeedOfSoundMps = static_cast<float>(SpeedOfSoundMetresPerSecond());

    for (auto& Wave : ThunderTimeline_)
    {
        if (!Wave.ArrivedAtListener && ClockSeconds_ >= Wave.ArrivalTimeSeconds)
        {
            Wave.ArrivedAtListener = true;
            Wave.SpatialMetrics    = Audio::EvaluateSpatialAcoustics(Listener, Wave.AudioSource, MixSettings);
            Wave.PeakShockGain     = Wave.SpatialMetrics.AttenuatedGain;
            NewlyArrivedWaves_.push_back(Wave);
        }
    }
}

Vec3 LightningStorm::EvaluateCloudInternalFlashRadiance(Vec3 SampleWorldPoint, double LocalCloudDensity) const noexcept
{
    if (CurrentFlashEnvelope_ <= 1.0e-4f || LocalCloudDensity <= 1.0e-5)
    {
        return Vec3{0.0f, 0.0f, 0.0f};
    }

    // Multiple-scattering diffusion inside storm clouds around the upper bolt root!
    const Vec3  Delta   = SampleWorldPoint - CloudOriginWorld_;
    const float DistM   = Length(Delta);
    const float DiffLen = std::max(50.0f, Config_.CloudDiffusionLengthM);
    const float NormD   = DistM / DiffLen;
    const float Kernel  = std::exp(-NormD) / (1.0f + NormD * NormD);
    const float Scatter = static_cast<float>(std::clamp(LocalCloudDensity * 1.8, 0.0, 1.4));
    const float Scale   = CurrentFlashEnvelope_ * (Config_.PeakReturnStrokeAmps / 30000.0f) * 28.0f * Kernel * Scatter;

    // 28,000 K ionized nitrogen-oxygen blue-violet-white emission spectrum!
    return Vec3{0.76f * Scale, 0.86f * Scale, 1.15f * Scale};
}

Vec3 LightningStorm::EvaluateSceneFlashIrradiance(Vec3 SurfacePoint, Vec3 SurfaceNormal) const noexcept
{
    if (CurrentFlashEnvelope_ <= 1.0e-4f || ActiveSegments_.empty())
    {
        return Vec3{0.0f, 0.0f, 0.0f};
    }

    Vec3              AccumIrradiance{0.0f, 0.0f, 0.0f};
    const std::size_t Stride     = std::max<std::size_t>(1u, ActiveSegments_.size() / 8u);
    const float       PowerScale = CurrentFlashEnvelope_ * (Config_.PeakReturnStrokeAmps / 30000.0f) * 42000.0f;

    for (std::size_t S = 0u; S < ActiveSegments_.size(); S += Stride)
    {
        const auto& Seg = ActiveSegments_[S];
        const Vec3  Mid = (Seg.StartWorld + Seg.EndWorld) * 0.5f;
        const Vec3  ToL = Mid - SurfacePoint;
        const float D2  = std::max(25.0f, Dot(ToL, ToL));
        const Vec3  Dir = ToL * (1.0f / std::sqrt(D2));
        const float Ndl = std::max(0.12f, Dot(SurfaceNormal, Dir)); // 0.12 sky-bounce wrap for storm cloud sheen
        const float E   = (PowerScale * Seg.RelativeIntensity * Ndl) / D2;
        AccumIrradiance = AccumIrradiance + Vec3{0.78f * E, 0.88f * E, 1.12f * E};
    }
    return AccumIrradiance;
}

void LightningStorm::PopulateActiveFlashLuminaires(std::vector<LightningFlashLuminaire>& OutLuminaires) const
{
    OutLuminaires.clear();
    if (CurrentFlashEnvelope_ <= 1.0e-4f || ActiveSegments_.empty())
    {
        return;
    }

    const std::size_t Stride    = std::max<std::size_t>(1u, ActiveSegments_.size() / 6u);
    const float       Intensity = CurrentFlashEnvelope_ * (Config_.PeakReturnStrokeAmps / 30000.0f) * 65000.0f;

    for (std::size_t S = 0u; S < ActiveSegments_.size(); S += Stride)
    {
        const auto& Seg = ActiveSegments_[S];
        if (Seg.RelativeIntensity < 0.5f)
        {
            continue;
        }
        LightningFlashLuminaire Lum{};
        Lum.Position         = (Seg.StartWorld + Seg.EndWorld) * 0.5f;
        Lum.RadiantIntensity = Vec3{0.78f, 0.88f, 1.15f} * (Intensity * Seg.RelativeIntensity);
        Lum.InfluenceRadiusM = 2500.0f;
        OutLuminaires.push_back(Lum);
    }
}

void LightningStorm::RebuildCameraAlignedRibbonSurface(Vec3 ViewerPosition)
{
    RibbonSurface_.Vertices.clear();
    RibbonSurface_.Indices.clear();
    if (CurrentFlashEnvelope_ <= 1.0e-4f || ActiveSegments_.empty())
    {
        return;
    }

    RibbonSurface_.Vertices.reserve(ActiveSegments_.size() * 4u);
    RibbonSurface_.Indices.reserve(ActiveSegments_.size() * 6u);

    for (const auto& Seg : ActiveSegments_)
    {
        const Vec3 Axis    = Seg.EndWorld - Seg.StartWorld;
        const float SegLen = Length(Axis);
        if (SegLen <= 1.0e-3f)
        {
            continue;
        }
        const Vec3 Tangent = Axis * (1.0f / SegLen);
        const Vec3 ViewVec = Normalise(((Seg.StartWorld + Seg.EndWorld) * 0.5f) - ViewerPosition);
        Vec3       Side    = Cross(Tangent, ViewVec);
        Side               = (Length(Side) > 1.0e-4f) ? Normalise(Side) : Vec3{1.0f, 0.0f, 0.0f};

        const float HalfW = std::max(0.12f, Seg.ChannelRadiusM * (0.7f + 0.6f * CurrentFlashEnvelope_));
        const Vec3  Rad   = Vec3{0.82f, 0.92f, 1.25f} * (120.0f * CurrentFlashEnvelope_ * Seg.RelativeIntensity);

        const uint32_t Base = static_cast<uint32_t>(RibbonSurface_.Vertices.size());
        RibbonSurface_.Vertices.push_back({Seg.StartWorld - Side * HalfW, Rad, -1.0f});
        RibbonSurface_.Vertices.push_back({Seg.StartWorld + Side * HalfW, Rad, +1.0f});
        RibbonSurface_.Vertices.push_back({Seg.EndWorld + Side * HalfW, Rad, +1.0f});
        RibbonSurface_.Vertices.push_back({Seg.EndWorld - Side * HalfW, Rad, -1.0f});

        RibbonSurface_.Indices.push_back(Base + 0u);
        RibbonSurface_.Indices.push_back(Base + 1u);
        RibbonSurface_.Indices.push_back(Base + 2u);
        RibbonSurface_.Indices.push_back(Base + 0u);
        RibbonSurface_.Indices.push_back(Base + 2u);
        RibbonSurface_.Indices.push_back(Base + 3u);
    }
}

} // namespace Frontier
