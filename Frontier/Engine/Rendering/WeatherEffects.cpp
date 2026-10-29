/*==========================================================================================================================================
                                                   WEATHER EFFECTS DEFINITION
==========================================================================================================================================*/

#include "WeatherEffects.h"

#include <algorithm>
#include <cmath>

namespace Frontier
{

namespace
{

SpatialVector Add(SpatialVector A, SpatialVector B) noexcept { return {A.X + B.X, A.Y + B.Y, A.Z + B.Z}; }
SpatialVector Sub(SpatialVector A, SpatialVector B) noexcept { return {A.X - B.X, A.Y - B.Y, A.Z - B.Z}; }
SpatialVector Mul(SpatialVector A, double S) noexcept { return {A.X * S, A.Y * S, A.Z * S}; }
double        Length(SpatialVector A) noexcept { return std::sqrt(A.X * A.X + A.Y * A.Y + A.Z * A.Z); }

double Wrap(double Value, double Extent) noexcept
{
    double R = std::fmod(Value, Extent);
    return R < 0.0 ? R + Extent : R;
}

uint32_t Hash32(uint64_t Seed, uint32_t Index, uint32_t Salt) noexcept
{
    uint64_t H = Seed + static_cast<uint64_t>(Index) * 0x9E3779B97F4A7C15ull +
                 static_cast<uint64_t>(Salt) * 0x85EBCA77C2B2AE63ull;
    H ^= H >> 29u;
    H *= 0xBF58476D1CE4E5B9ull;
    H ^= H >> 32u;
    return static_cast<uint32_t>(H >> 32u);
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                     PRECIPITATION
//------------------------------------------------------------------------------------------------------------------------

void PrecipitationField::Hashes(uint32_t Index, double& U0, double& U1, double& U2, double& U3) const noexcept
{
    U0 = Hash32(P_.Seed, Index, 0u) * (1.0 / 4294967296.0);
    U1 = Hash32(P_.Seed, Index, 1u) * (1.0 / 4294967296.0);
    U2 = Hash32(P_.Seed, Index, 2u) * (1.0 / 4294967296.0);
    U3 = Hash32(P_.Seed, Index, 3u) * (1.0 / 4294967296.0);
}

SpatialVector PrecipitationField::ParticleVelocity(uint32_t Index) const noexcept
{
    double U0, U1, U2, U3;
    Hashes(Index, U0, U1, U2, U3);
    const double Fall = P_.FallSpeedMps * (0.8 + 0.4 * U3);
    return {P_.WindXMps, P_.WindYMps, -Fall};
}

double PrecipitationField::VerticalPeriod(uint32_t Index) const noexcept
{
    const SpatialVector V = ParticleVelocity(Index);
    return V.Z < 0.0 ? P_.VolumeHeightM / -V.Z : 0.0;
}

SpatialVector PrecipitationField::ParticleAt(uint32_t Index, double TimeS, SpatialVector Anchor) const noexcept
{
    double U0, U1, U2, U3;
    Hashes(Index, U0, U1, U2, U3);
    const SpatialVector Velocity = ParticleVelocity(Index);
    const double E = P_.VolumeExtentM, H = P_.VolumeHeightM;
    // Base cell position + analytic advection, wrapped about the anchor.
    const double X = Anchor.X - 0.5 * E + Wrap(U0 * E + Velocity.X * TimeS - Anchor.X + 0.5 * E, E) ;
    const double Y = Anchor.Y - 0.5 * E + Wrap(U1 * E + Velocity.Y * TimeS - Anchor.Y + 0.5 * E, E);
    const double Z = Anchor.Z + Wrap(U2 * H + Velocity.Z * TimeS, H);
    return {X, Y, Z};
}

PrecipitationParameters PresetPrecipitationParameters(
    PrecipitationSpecies Species,
    double               Intensity01,
    uint64_t             Seed) noexcept
{
    const double Intensity = std::clamp(Intensity01, 0.0, 1.0);
    PrecipitationParameters Params{};
    Params.Seed = Seed;
    switch (Species)
    {
        case PrecipitationSpecies::Snow:
            Params.VolumeExtentM      = 38.0;
            Params.VolumeHeightM      = 22.0;
            Params.FallSpeedMps       = 1.25 + 0.55 * Intensity;
            Params.WindXMps           = 1.10 + 1.40 * Intensity;
            Params.WindYMps           = 0.45 + 0.65 * Intensity;
            Params.FlutterAmplitudeM  = 0.28 + 0.16 * Intensity;
            Params.FlutterFrequencyHz = 1.15;
            Params.HailRestitution    = 0.0;
            break;
        case PrecipitationSpecies::Hail:
            Params.VolumeExtentM      = 36.0;
            Params.VolumeHeightM      = 26.0;
            Params.FallSpeedMps       = 14.5 + 4.5 * Intensity;
            Params.WindXMps           = 2.20 + 2.00 * Intensity;
            Params.WindYMps           = 0.80 + 0.90 * Intensity;
            Params.FlutterAmplitudeM  = 0.0;
            Params.HailRestitution    = 0.52;
            break;
        case PrecipitationSpecies::Rain:
            Params.VolumeExtentM      = 40.0;
            Params.VolumeHeightM      = 25.0;
            Params.FallSpeedMps       = 8.20 + 2.60 * Intensity;
            Params.WindXMps           = 1.80 + 1.80 * Intensity;
            Params.WindYMps           = 0.50 + 0.70 * Intensity;
            Params.FlutterAmplitudeM  = 0.0;
            Params.HailRestitution    = 0.0;
            break;
        case PrecipitationSpecies::Clear:
        default:
            Params.FallSpeedMps       = 0.0;
            Params.WindXMps           = 0.0;
            Params.WindYMps           = 0.0;
            break;
    }
    return Params;
}

double EvaluateSurfaceSnowCover(
    SpatialVector WorldPosition,
    SpatialVector WorldNormal,
    double        AccumulatedDepthMetres) noexcept
{
    if (AccumulatedDepthMetres <= 1.0e-5 || WorldNormal.Z <= 0.18)
    {
        return 0.0;
    }
    const double UpAlignment = std::clamp((WorldNormal.Z - 0.18) / 0.82, 0.0, 1.0);
    const double DriftRipple = 0.86 + 0.14 * std::sin(WorldPosition.X * 0.37 + WorldPosition.Y * 0.23) *
                                             std::cos(WorldPosition.X * 0.19 - WorldPosition.Y * 0.41);
    const double DepthFactor = 1.0 - std::exp(-AccumulatedDepthMetres * 34.0 * DriftRipple);
    return std::clamp(UpAlignment * UpAlignment * DepthFactor, 0.0, 1.0);
}

double EvaluateWeatherRoadGripScale(
    PrecipitationSpecies Species,
    double               Intensity01,
    double               AccumulatedDepthMetres) noexcept
{
    const double Intensity = std::clamp(Intensity01, 0.0, 1.0);
    const double DepthTerm = std::clamp(AccumulatedDepthMetres / 0.05, 0.0, 1.0);
    switch (Species)
    {
        case PrecipitationSpecies::Rain:
            return 1.0 - 0.24 * Intensity;
        case PrecipitationSpecies::Snow:
            return std::clamp(1.0 - 0.42 * Intensity - 0.18 * DepthTerm, 0.36, 1.0);
        case PrecipitationSpecies::Hail:
            return std::clamp(1.0 - 0.38 * Intensity - 0.14 * DepthTerm, 0.42, 1.0);
        case PrecipitationSpecies::Clear:
        default:
            return 1.0;
    }
}

PrecipitationParticleSample PrecipitationField::EvaluateHydrometeor(
    uint32_t             Index,
    double               TimeS,
    SpatialVector        Anchor,
    PrecipitationSpecies Species,
    double               ShutterSeconds) const noexcept
{
    PrecipitationParticleSample Out{};
    if (Species == PrecipitationSpecies::Clear || P_.FallSpeedMps <= 1.0e-5)
    {
        return Out;
    }

    double U0, U1, U2, U3;
    Hashes(Index, U0, U1, U2, U3);
    const SpatialVector BaseVel = ParticleVelocity(Index);
    const double E = P_.VolumeExtentM;
    const double H = P_.VolumeHeightM;

    if (Species == PrecipitationSpecies::Snow)
    {
        constexpr double TwoPi = 6.283185307179586;
        const SpatialVector BasePos = ParticleAt(Index, TimeS, Anchor);
        const double Omega = TwoPi * P_.FlutterFrequencyHz * (0.72 + 0.56 * U2);
        const double Phase = TwoPi * U0;
        const double Amp   = P_.FlutterAmplitudeM * (0.55 + 0.70 * U1);
        const double Dx    = Amp * std::cos(Omega * TimeS + Phase);
        const double Dy    = Amp * std::sin(1.31 * Omega * TimeS + 1.7 * Phase);
        const double Vx    = BaseVel.X - Amp * Omega * std::sin(Omega * TimeS + Phase);
        const double Vy    = BaseVel.Y + Amp * 1.31 * Omega * std::cos(1.31 * Omega * TimeS + 1.7 * Phase);
        Out.Position       = { BasePos.X + Dx, BasePos.Y + Dy, BasePos.Z };
        Out.Velocity       = { Vx, Vy, BaseVel.Z };
        Out.RadiusMetres   = 0.0038 + 0.0034 * U3;
        Out.StreakLengthM  = Length(Out.Velocity) * std::min(ShutterSeconds, 0.012);
        return Out;
    }

    if (Species == PrecipitationSpecies::Hail)
    {
        const double FallSpeed  = -BaseVel.Z;
        const double FallTime   = H / std::max(FallSpeed, 0.5);
        const double Restit     = std::clamp(P_.HailRestitution * (0.85 + 0.30 * U2), 0.0, 0.85);
        const double ReboundVz  = FallSpeed * Restit;
        constexpr double Gravity = 9.81;
        const double BounceTime = (Restit > 0.02) ? (2.0 * ReboundVz / Gravity) : 0.0;
        const double CycleTime  = FallTime + BounceTime;
        const double CyclePhase = Wrap(U2 * CycleTime + TimeS, CycleTime);

        const double ImpactX = Anchor.X - 0.5 * E + Wrap(U0 * E + BaseVel.X * TimeS - Anchor.X + 0.5 * E, E);
        const double ImpactY = Anchor.Y - 0.5 * E + Wrap(U1 * E + BaseVel.Y * TimeS - Anchor.Y + 0.5 * E, E);

        if (CyclePhase <= FallTime)
        {
            const double Remaining = FallTime - CyclePhase;
            Out.Position   = { ImpactX - BaseVel.X * Remaining, ImpactY - BaseVel.Y * Remaining, P_.GroundElevationM + FallSpeed * Remaining };
            Out.Velocity   = BaseVel;
            Out.Rebounding = false;
        }
        else
        {
            const double Tb       = CyclePhase - FallTime;
            const double ScatterA = 6.283185307179586 * U3;
            const double ScatterV = 0.22 * FallSpeed;
            const double Sx       = BaseVel.X * 0.45 + ScatterV * std::cos(ScatterA);
            const double Sy       = BaseVel.Y * 0.45 + ScatterV * std::sin(ScatterA);
            const double Z        = P_.GroundElevationM + std::max(0.0, ReboundVz * Tb - 0.5 * Gravity * Tb * Tb);
            Out.Position          = { ImpactX + Sx * Tb, ImpactY + Sy * Tb, Z };
            Out.Velocity          = { Sx, Sy, ReboundVz - Gravity * Tb };
            Out.Rebounding        = true;
        }
        Out.RadiusMetres  = 0.0045 + 0.0045 * U3;
        Out.StreakLengthM = Length(Out.Velocity) * std::min(ShutterSeconds, 0.010);
        return Out;
    }

    // Rain streak kinematics.
    Out.Position      = ParticleAt(Index, TimeS, Anchor);
    Out.Velocity      = BaseVel;
    Out.RadiusMetres  = 0.0014 + 0.0010 * U3;
    Out.StreakLengthM = Length(BaseVel) * ShutterSeconds;
    return Out;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      LIGHTNING
//------------------------------------------------------------------------------------------------------------------------

namespace
{

void Displace(std::vector<SpatialVector>& Points, uint32_t Depth, double Roughness, DeterministicRandom& Random)
{
    for (uint32_t Level = 0; Level < Depth; ++Level)
    {
        std::vector<SpatialVector> Next;
        Next.reserve(Points.size() * 2 - 1);
        for (size_t I = 0; I + 1 < Points.size(); ++I)
        {
            Next.push_back(Points[I]);
            const SpatialVector A = Points[I], B = Points[I + 1];
            const SpatialVector Mid = Mul(Add(A, B), 0.5);
            const double SegLen = Length(Sub(B, A));
            const double Scale = Roughness * SegLen;
            SpatialVector Offset{(Random.NextUnit() - 0.5) * 2.0 * Scale, (Random.NextUnit() - 0.5) * 2.0 * Scale,
                                 (Random.NextUnit() - 0.5) * 2.0 * Scale};
            // Suppress the along-segment component so the channel never folds back on itself:
            // project out the component parallel to the segment (keeps it lightning, not scribble).
            if (SegLen > 0.0)
            {
                const SpatialVector Axis = Mul(Sub(B, A), 1.0 / SegLen);
                const double Along = Offset.X * Axis.X + Offset.Y * Axis.Y + Offset.Z * Axis.Z;
                Offset = Sub(Offset, Mul(Axis, Along));
            }
            Next.push_back(Add(Mid, Offset));
        }
        Next.push_back(Points.back());
        Points.swap(Next);
    }
}

} // namespace

LightningBolt GenerateLightningBolt(SpatialVector From, SpatialVector To, uint32_t Depth, double Roughness,
                                    uint64_t Seed, uint32_t MaxBranches)
{
    DeterministicRandom Random(Seed, 0xB017ull);
    LightningBolt Bolt;
    Bolt.MainChannel = {From, To};
    Displace(Bolt.MainChannel, std::min(Depth, 10u), Roughness, Random);

    const uint32_t BranchCount = MaxBranches > 0 ? Random.NextBelow(MaxBranches + 1) : 0;
    for (uint32_t B = 0; B < BranchCount && Bolt.MainChannel.size() > 4; ++B)
    {
        const size_t Root = 1 + Random.NextBelow(static_cast<uint32_t>(Bolt.MainChannel.size() - 2));
        const SpatialVector RootPoint = Bolt.MainChannel[Root];
        // Branch target: continue mostly toward To, skewed sideways and shortened.
        const SpatialVector ToTarget = Sub(To, RootPoint);
        const SpatialVector Skew{(Random.NextUnit() - 0.5) * 0.8, (Random.NextUnit() - 0.5) * 0.8,
                                 -0.3 * Random.NextUnit()};
        const SpatialVector End = Add(RootPoint, Add(Mul(ToTarget, 0.35), Mul(Skew, Length(ToTarget) * 0.35)));
        std::vector<SpatialVector> Branch{RootPoint, End};
        Displace(Branch, std::min(Depth, 7u), Roughness, Random);
        Bolt.Branches.push_back(std::move(Branch));
    }
    return Bolt;
}

double LightningIntensity(double TimeS, uint64_t Seed) noexcept
{
    if (TimeS < 0.0)
    {
        return 0.0;
    }
    DeterministicRandom Random(Seed ^ 0xF1A5ull, 0x57B0ull);
    double Intensity = std::exp(-TimeS / 0.045);   // main stroke, fast decay
    double RestrikeAt = 0.05;
    for (uint32_t Stroke = 0; Stroke < 3; ++Stroke)
    {
        RestrikeAt += 0.03 + 0.08 * Random.NextUnit();
        const double Strength = 0.35 + 0.45 * Random.NextUnit();
        const double Tau = 0.03 + 0.03 * Random.NextUnit();
        if (TimeS >= RestrikeAt)
        {
            Intensity += Strength * std::exp(-(TimeS - RestrikeAt) / Tau);
        }
    }
    return std::clamp(Intensity, 0.0, 1.0);
}

} // namespace Frontier
