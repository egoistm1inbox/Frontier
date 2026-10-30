/*==========================================================================================================================================
                                                    SKYPRECIPITATION.CPP
==========================================================================================================================================*/
// 🧩 Wind-advected 3D falling sky precipitation (dendritic snow, sleet, rain streaks, bouncing hailstones) with coupled touchdown physics.

#include "Engine/Particles/SkyPrecipitation.h"

#include <algorithm>
#include <cmath>

namespace Frontier
{
namespace
{
constexpr float TwoPiConst  = 6.28318530717958647692f;
constexpr float GravityMps2 = 9.81f;

struct SplitMixPrecipRng
{
    uint64_t State = 1ull;

    [[nodiscard]] float Next01() noexcept
    {
        State += 0x9E3779B97F4A7C15ull;
        uint64_t Z = State;
        Z = (Z ^ (Z >> 30u)) * 0xBF58476D1CE4E5B9ull;
        Z = (Z ^ (Z >> 27u)) * 0x94D049BB133111EBull;
        Z = Z ^ (Z >> 31u);
        return static_cast<float>(static_cast<double>(Z >> 11u) * (1.0 / 9007199254740992.0));
    }
};

[[nodiscard]] float WrapAxis(float Value, float Lo, float Hi) noexcept
{
    const float Span = Hi - Lo;
    if (Span <= 1.0e-5f)
    {
        return Lo;
    }
    float Offset = std::fmod(Value - Lo, Span);
    if (Offset < 0.0f)
    {
        Offset += Span;
    }
    return Lo + Offset;
}

[[nodiscard]] float HashCurtainNoise2D(float X, float Y) noexcept
{
    const float Ix = std::floor(X);
    const float Iy = std::floor(Y);
    const float Fx = X - Ix;
    const float Fy = Y - Iy;
    const float Ux = Fx * Fx * (3.0f - 2.0f * Fx);
    const float Uy = Fy * Fy * (3.0f - 2.0f * Fy);

    auto H = [](float A, float B) noexcept -> float
    {
        const float S = std::sin(A * 127.1f + B * 311.7f) * 43758.5453f;
        return S - std::floor(S);
    };
    const float N00 = H(Ix, Iy);
    const float N10 = H(Ix + 1.0f, Iy);
    const float N01 = H(Ix, Iy + 1.0f);
    const float N11 = H(Ix + 1.0f, Iy + 1.0f);
    return (N00 * (1.0f - Ux) + N10 * Ux) * (1.0f - Uy) + (N01 * (1.0f - Ux) + N11 * Ux) * Uy;
}

} // namespace

SkyPrecipitation::SkyPrecipitation(const SkyPrecipitationConfig& Config)
{
    Reconfigure(Config);
}

void SkyPrecipitation::Reconfigure(const SkyPrecipitationConfig& Config)
{
    Config_ = Config;
    const float Hx = std::max(2.0f, Config_.DomainHalfExtent.X);
    const float Hy = std::max(2.0f, Config_.DomainHalfExtent.Y);
    const float Hz = std::max(1.5f, Config_.DomainHalfExtent.Z);

    VolumeMin_ = {Config_.DomainCentreXY.X - Hx, Config_.DomainCentreXY.Y - Hy, Config_.GroundFloorZ};
    VolumeMax_ = {Config_.DomainCentreXY.X + Hx, Config_.DomainCentreXY.Y + Hy, Config_.GroundFloorZ + 2.0f * Hz};

    const uint32_t ActiveBudget = static_cast<uint32_t>(std::lround(
        static_cast<float>(Config_.ParticleCount) * std::clamp(Config_.Intensity01, 0.0f, 1.0f)));
    Particles_.resize(ActiveBudget);

    SplitMixPrecipRng Rng{Config_.RandomSeed};
    for (SkyPrecipitationParticle& P : Particles_)
    {
        P.PositionWorld = {
            VolumeMin_.X + Rng.Next01() * (VolumeMax_.X - VolumeMin_.X),
            VolumeMin_.Y + Rng.Next01() * (VolumeMax_.Y - VolumeMin_.Y),
            VolumeMin_.Z + Rng.Next01() * (VolumeMax_.Z - VolumeMin_.Z)};
        P.BounceCount  = 0u;
        P.InReboundArc = 0u;

        if (Config_.Phase == SkyPrecipitationPhase::DendriticSnow)
        {
            // Natural Marshall-Palmer / Gunn-Marshall dendritic crystal & aggregate size spectrum!
            const float SizeRoll = Rng.Next01();
            const float BaseR    = (SizeRoll < 0.72f) ? (0.0036f + 0.0044f * Rng.Next01())
                                                      : (0.0075f + 0.0052f * Rng.Next01());
            P.RadiusMetres    = BaseR * Config_.FlakeRadiusScale;
            P.TerminalFallMps = 0.98f + 0.84f * Rng.Next01();
            P.FlutterAmpMps   = 0.34f + 0.56f * Rng.Next01();
            P.FlutterFreqRad  = 2.1f + 3.0f * Rng.Next01();
            P.Reflectance     = 0.92f + 0.07f * Rng.Next01();
        }
        else if (Config_.Phase == SkyPrecipitationPhase::SleetGraupel)
        {
            P.RadiusMetres    = (0.0026f + 0.0030f * Rng.Next01()) * Config_.FlakeRadiusScale;
            P.TerminalFallMps = 3.20f + 1.65f * Rng.Next01();
            P.FlutterAmpMps   = 0.14f + 0.18f * Rng.Next01();
            P.FlutterFreqRad  = 4.0f + 2.0f * Rng.Next01();
            P.Reflectance     = 0.85f + 0.08f * Rng.Next01();
        }
        else if (Config_.Phase == SkyPrecipitationPhase::Hailstorm)
        {
            // Layered opaque/translucent rime-ice hailstones (diameter 9 mm .. 22 mm, fast terminal speed 11.5..17.2 m/s)!
            P.RadiusMetres    = (0.0046f + 0.0062f * Rng.Next01()) * Config_.FlakeRadiusScale;
            P.TerminalFallMps = 11.5f + 5.7f * Rng.Next01();
            P.FlutterAmpMps   = 0.08f + 0.12f * Rng.Next01();
            P.FlutterFreqRad  = 5.2f + 2.5f * Rng.Next01();
            P.Reflectance     = 0.91f + 0.08f * Rng.Next01();
        }
        else
        {
            // Oblate falling raindrops (diameter 2.4 mm .. 5.8 mm, high terminal speed 7.2..10.4 m/s)!
            P.RadiusMetres    = (0.0014f + 0.0016f * Rng.Next01()) * Config_.FlakeRadiusScale;
            P.TerminalFallMps = 7.20f + 3.20f * Rng.Next01();
            P.FlutterAmpMps   = 0.05f;
            P.FlutterFreqRad  = 3.2f;
            P.Reflectance     = 0.78f + 0.14f * Rng.Next01();
        }
        P.FlutterPhase = TwoPiConst * Rng.Next01();
        P.VelocityMps  = {0.0f, 0.0f, -P.TerminalFallMps};
    }

    ElapsedSeconds_            = 0.0f;
    RespawnCounter_            = 1u;
    Telemetry_                 = {};
    Telemetry_.ActiveParticles = static_cast<uint32_t>(Particles_.size());
    RebuildSpatialAccelerationGrid();
}

void SkyPrecipitation::RespawnParticleAtCeiling(SkyPrecipitationParticle& P, uint32_t ParticleIndex) noexcept
{
    SplitMixPrecipRng Rng{Config_.RandomSeed ^ (RespawnCounter_ * 0x9E3779B97F4A7C15ull) ^ (static_cast<uint64_t>(ParticleIndex) * 0xBF58476D1CE4E5B9ull)};
    ++RespawnCounter_;

    const float SpanX = VolumeMax_.X - VolumeMin_.X;
    const float SpanY = VolumeMax_.Y - VolumeMin_.Y;
    const float SpanZ = VolumeMax_.Z - VolumeMin_.Z;

    // When leeward wind-eddy mound convergence is enabled, a physical storm-curtain fraction spawns in the upwind feeder plume
    // so continuous curtains of snowflakes visibly descend together onto the growing 3D snow mound!
    if (Config_.EnableMoundConvergence && Config_.ConvergenceStrength > 0.01f && Rng.Next01() < std::clamp(0.46f * Config_.ConvergenceStrength, 0.0f, 0.68f))
    {
        const float Angle = TwoPiConst * Rng.Next01();
        const float Rad   = Config_.ConvergenceRadiusMetres * std::sqrt(Rng.Next01()) * 1.15f;
        P.PositionWorld.X = WrapAxis(Config_.ConvergenceCentreWorld.X + std::cos(Angle) * Rad, VolumeMin_.X, VolumeMax_.X);
        P.PositionWorld.Y = WrapAxis(Config_.ConvergenceCentreWorld.Y + std::sin(Angle) * Rad, VolumeMin_.Y, VolumeMax_.Y);
    }
    else
    {
        P.PositionWorld.X = VolumeMin_.X + Rng.Next01() * SpanX;
        P.PositionWorld.Y = VolumeMin_.Y + Rng.Next01() * SpanY;
    }

    P.PositionWorld.Z = VolumeMax_.Z - 0.04f * SpanZ * Rng.Next01();
    P.BounceCount     = 0u;
    P.InReboundArc    = 0u;
    P.VelocityMps     = {0.0f, 0.0f, -P.TerminalFallMps};
}

void SkyPrecipitation::StepPrecipitation(
    float                    DtSeconds,
    Vec3                     FallbackWindMps,
    PrecipitationWindSampler WindSampler,
    const void*              WindContext)
{
    StepCoupledPrecipitation(DtSeconds, FallbackWindMps, WindSampler, WindContext, nullptr, nullptr, nullptr, nullptr);
}

void SkyPrecipitation::StepCoupledPrecipitation(
    float                      DtSeconds,
    Vec3                       FallbackWindMps,
    PrecipitationWindSampler   WindSampler,
    const void*                WindContext,
    PrecipitationSurfaceQuery  SurfaceQuery,
    const void*                SurfaceContext,
    PrecipitationTouchdownSink TouchdownSink,
    void*                      SinkContext)
{
    if (DtSeconds <= 0.0f || Particles_.empty())
    {
        return;
    }

    ElapsedSeconds_ += DtSeconds;
    double   SumFall       = 0.0;
    double   SumHoriz      = 0.0;
    uint32_t ReboundCount  = 0u;

    for (uint32_t Idx = 0u; Idx < static_cast<uint32_t>(Particles_.size()); ++Idx)
    {
        SkyPrecipitationParticle& P = Particles_[Idx];

        if (P.InReboundArc != 0u && Config_.Phase == SkyPrecipitationPhase::Hailstorm)
        {
            // Ballistic hailstone parabolic rebound under gravity + light aerodynamic drag!
            Vec3 LocalWind = FallbackWindMps;
            if (WindSampler != nullptr)
            {
                LocalWind = WindSampler(P.PositionWorld, WindContext);
            }
            const float Drag = std::max(0.0f, 1.0f - 0.42f * DtSeconds);
            P.VelocityMps.X  = P.VelocityMps.X * Drag + LocalWind.X * (0.08f * DtSeconds);
            P.VelocityMps.Y  = P.VelocityMps.Y * Drag + LocalWind.Y * (0.08f * DtSeconds);
            P.VelocityMps.Z -= GravityMps2 * DtSeconds;
            P.PositionWorld  = P.PositionWorld + P.VelocityMps * DtSeconds;
            ++ReboundCount;
        }
        else
        {
            Vec3 LocalWind = FallbackWindMps;
            if (WindSampler != nullptr)
            {
                LocalWind = WindSampler(P.PositionWorld, WindContext);
            }

            const float Arg = P.FlutterPhase + ElapsedSeconds_ * P.FlutterFreqRad;
            const Vec3  Flutter{
                P.FlutterAmpMps * std::cos(Arg),
                P.FlutterAmpMps * std::sin(Arg * 1.17f + 0.8f),
                0.14f * P.FlutterAmpMps * std::sin(Arg * 0.73f)};

            const float WindCouple = (Config_.Phase == SkyPrecipitationPhase::DendriticSnow) ? 0.88f
                                   : (Config_.Phase == SkyPrecipitationPhase::Rainfall)      ? 0.58f
                                                                                             : 0.34f;
            Vec3 TargetVel{
                LocalWind.X * WindCouple + Flutter.X,
                LocalWind.Y * WindCouple + Flutter.Y,
                LocalWind.Z * 0.32f - P.TerminalFallMps + Flutter.Z};

            // Leeward wind-eddy convergence: snow curtains decelerate horizontally and converge gently into the leeward mound!
            if (Config_.EnableMoundConvergence && Config_.ConvergenceStrength > 0.01f)
            {
                const float Dx    = Config_.ConvergenceCentreWorld.X - P.PositionWorld.X;
                const float Dy    = Config_.ConvergenceCentreWorld.Y - P.PositionWorld.Y;
                const float R     = std::max(0.6f, Config_.ConvergenceRadiusMetres);
                const float Dist2 = Dx * Dx + Dy * Dy;
                if (Dist2 < (2.8f * R) * (2.8f * R))
                {
                    const float EddyWeight = std::exp(-0.5f * Dist2 / (R * R)) * Config_.ConvergenceStrength;
                    const float HeightFade = std::clamp(1.25f - (P.PositionWorld.Z - Config_.GroundFloorZ) / std::max(2.0f, VolumeMax_.Z - VolumeMin_.Z), 0.25f, 1.0f);
                    const float Pull       = 0.52f * EddyWeight * HeightFade;
                    TargetVel.X            = TargetVel.X * (1.0f - 0.55f * EddyWeight * HeightFade) + Dx * Pull;
                    TargetVel.Y            = TargetVel.Y * (1.0f - 0.55f * EddyWeight * HeightFade) + Dy * Pull;
                    TargetVel.Z           -= 0.32f * EddyWeight;
                }
            }

            P.VelocityMps   = TargetVel;
            P.PositionWorld = P.PositionWorld + P.VelocityMps * DtSeconds;
        }

        P.PositionWorld.X = WrapAxis(P.PositionWorld.X, VolumeMin_.X, VolumeMax_.X);
        P.PositionWorld.Y = WrapAxis(P.PositionWorld.Y, VolumeMin_.Y, VolumeMax_.Y);

        // Query exact ground / live 3D snow-mound / boulder / vehicle hood height!
        float SurfaceZ    = VolumeMin_.Z;
        Vec3  SurfaceNorm = {0.0f, 0.0f, 1.0f};
        float RestScale   = 1.0f;
        if (SurfaceQuery != nullptr)
        {
            float QueryZ = VolumeMin_.Z;
            Vec3  QueryN = {0.0f, 0.0f, 1.0f};
            float QueryR = 1.0f;
            if (SurfaceQuery(P.PositionWorld, QueryZ, QueryN, QueryR, SurfaceContext))
            {
                SurfaceZ    = QueryZ;
                SurfaceNorm = Normalise(QueryN);
                RestScale   = QueryR;
            }
        }

        if (P.PositionWorld.Z <= SurfaceZ + P.RadiusMetres)
        {
            const Vec3 ImpactPos{P.PositionWorld.X, P.PositionWorld.Y, SurfaceZ};
            const Vec3 ImpactVel = P.VelocityMps;

            if (Config_.Phase == SkyPrecipitationPhase::Hailstorm)
            {
                const float VdotN = Dot(ImpactVel, SurfaceNorm);
                const float NormalImpactSpeed = -VdotN;
                const float EffectiveRest     = std::clamp(Config_.HailRestitution * RestScale, 0.12f, 0.78f);

                if (P.BounceCount < Config_.MaxHailBounces && NormalImpactSpeed > 1.35f)
                {
                    // Elastic rigid-ice hailstone rebound off asphalt, boulder, or vehicle roof/hood!
                    SplitMixPrecipRng BounceRng{Config_.RandomSeed ^ (static_cast<uint64_t>(Idx) * 7919ull) ^ (static_cast<uint64_t>(P.BounceCount + 1u) * 104729ull)};
                    const Vec3  Reflected = ImpactVel - SurfaceNorm * ((1.0f + EffectiveRest) * VdotN);
                    const float JitterX   = (BounceRng.Next01() - 0.5f) * 2.2f;
                    const float JitterY   = (BounceRng.Next01() - 0.5f) * 2.2f;

                    P.PositionWorld   = ImpactPos + SurfaceNorm * (P.RadiusMetres + 0.008f);
                    P.VelocityMps     = Vec3{Reflected.X * 0.48f + JitterX, Reflected.Y * 0.48f + JitterY, std::clamp(Reflected.Z, 0.42f, 3.35f)};
                    P.BounceCount     = static_cast<uint16_t>(P.BounceCount + 1u);
                    P.InReboundArc    = 1u;
                    ++Telemetry_.HailBounceContacts;
                    ++ReboundCount;
                }
                else
                {
                    if (TouchdownSink != nullptr)
                    {
                        PrecipitationTouchdownEvent Ev{};
                        Ev.HitPositionWorld   = ImpactPos;
                        Ev.ImpactVelocityMps  = ImpactVel;
                        Ev.HydrometeorRadiusM = P.RadiusMetres;
                        Ev.Phase              = Config_.Phase;
                        Ev.BounceCount        = P.BounceCount;
                        TouchdownSink(Ev, SinkContext);
                    }
                    ++Telemetry_.RecycledTouchdowns;
                    RespawnParticleAtCeiling(P, Idx);
                }
            }
            else
            {
                if (TouchdownSink != nullptr)
                {
                    PrecipitationTouchdownEvent Ev{};
                    Ev.HitPositionWorld   = ImpactPos;
                    Ev.ImpactVelocityMps  = ImpactVel;
                    Ev.HydrometeorRadiusM = P.RadiusMetres;
                    Ev.Phase              = Config_.Phase;
                    Ev.BounceCount        = 0u;
                    TouchdownSink(Ev, SinkContext);
                }
                ++Telemetry_.RecycledTouchdowns;
                if (SurfaceQuery != nullptr)
                {
                    RespawnParticleAtCeiling(P, Idx);
                }
                else
                {
                    P.PositionWorld.Z = VolumeMax_.Z - std::fmod(SurfaceZ + P.RadiusMetres - P.PositionWorld.Z, std::max(0.5f, VolumeMax_.Z - VolumeMin_.Z));
                }
            }
        }
        else if (P.PositionWorld.Z > VolumeMax_.Z)
        {
            P.PositionWorld.Z = VolumeMin_.Z + std::fmod(P.PositionWorld.Z - VolumeMax_.Z, std::max(0.5f, VolumeMax_.Z - VolumeMin_.Z));
        }

        SumFall  += static_cast<double>(std::max(0.0f, -P.VelocityMps.Z));
        SumHoriz += static_cast<double>(std::sqrt(P.VelocityMps.X * P.VelocityMps.X + P.VelocityMps.Y * P.VelocityMps.Y));
    }

    const double InvN               = 1.0 / static_cast<double>(Particles_.size());
    Telemetry_.ActiveParticles      = static_cast<uint32_t>(Particles_.size());
    Telemetry_.AirborneRebounding   = ReboundCount;
    Telemetry_.MeanFallSpeedMps     = static_cast<float>(SumFall * InvN);
    Telemetry_.MeanHorizontalSpeed  = static_cast<float>(SumHoriz * InvN);

    RebuildSpatialAccelerationGrid();
}

void SkyPrecipitation::RebuildSpatialAccelerationGrid()
{
    CellOffsets_.fill(0u);
    SortedIndices_.resize(Particles_.size());
    if (Particles_.empty())
    {
        return;
    }

    const Vec3 InvSpan{
        static_cast<float>(GridNx) / std::max(1.0e-4f, VolumeMax_.X - VolumeMin_.X),
        static_cast<float>(GridNy) / std::max(1.0e-4f, VolumeMax_.Y - VolumeMin_.Y),
        static_cast<float>(GridNz) / std::max(1.0e-4f, VolumeMax_.Z - VolumeMin_.Z)};

    auto ComputeCell = [&](Vec3 Pos) noexcept -> uint32_t
    {
        const uint32_t Cx = std::min(GridNx - 1u, static_cast<uint32_t>(std::max(0.0f, (Pos.X - VolumeMin_.X) * InvSpan.X)));
        const uint32_t Cy = std::min(GridNy - 1u, static_cast<uint32_t>(std::max(0.0f, (Pos.Y - VolumeMin_.Y) * InvSpan.Y)));
        const uint32_t Cz = std::min(GridNz - 1u, static_cast<uint32_t>(std::max(0.0f, (Pos.Z - VolumeMin_.Z) * InvSpan.Z)));
        return (Cz * GridNy + Cy) * GridNx + Cx;
    };

    for (const SkyPrecipitationParticle& P : Particles_)
    {
        ++CellOffsets_[ComputeCell(P.PositionWorld) + 1u];
    }
    for (uint32_t Cell = 0u; Cell < GridCellCount; ++Cell)
    {
        CellOffsets_[Cell + 1u] += CellOffsets_[Cell];
    }

    std::array<uint32_t, GridCellCount> WriteCursor{};
    std::copy(CellOffsets_.begin(), CellOffsets_.begin() + GridCellCount, WriteCursor.begin());

    for (uint32_t Index = 0u; Index < static_cast<uint32_t>(Particles_.size()); ++Index)
    {
        const uint32_t Cell = ComputeCell(Particles_[Index].PositionWorld);
        SortedIndices_[WriteCursor[Cell]++] = Index;
    }
}

Vec3 SkyPrecipitation::EvaluateRayPrecipitation(
    Vec3   RayOrigin,
    Vec3   RayDirectionUnit,
    float  MaxDistanceM,
    Vec3   SunDirectionUnit,
    Vec3   SunIrradianceRgb,
    Vec3   SkyAmbientRgb,
    float  PixelAngularRadians,
    float* OutTransmittance) const noexcept
{
    if (OutTransmittance != nullptr)
    {
        *OutTransmittance = 1.0f;
    }
    if (Particles_.empty() || MaxDistanceM <= 0.1f)
    {
        return {0.0f, 0.0f, 0.0f};
    }

    // Ray-AABB clip against active 3D precipitation sky volume
    float       TEnter  = 0.08f;
    float       TExit   = std::min(MaxDistanceM, 42.0f);
    const float Orig[3] = {RayOrigin.X, RayOrigin.Y, RayOrigin.Z};
    const float Dir[3]  = {RayDirectionUnit.X, RayDirectionUnit.Y, RayDirectionUnit.Z};
    const float BMin[3] = {VolumeMin_.X, VolumeMin_.Y, VolumeMin_.Z};
    const float BMax[3] = {VolumeMax_.X, VolumeMax_.Y, VolumeMax_.Z};

    for (int Axis = 0; Axis < 3; ++Axis)
    {
        if (std::abs(Dir[Axis]) < 1.0e-6f)
        {
            if (Orig[Axis] < BMin[Axis] || Orig[Axis] > BMax[Axis])
            {
                return {0.0f, 0.0f, 0.0f};
            }
        }
        else
        {
            const float InvD = 1.0f / Dir[Axis];
            float       T0   = (BMin[Axis] - Orig[Axis]) * InvD;
            float       T1   = (BMax[Axis] - Orig[Axis]) * InvD;
            if (T0 > T1)
            {
                std::swap(T0, T1);
            }
            TEnter = std::max(TEnter, T0);
            TExit  = std::min(TExit, T1);
            if (TEnter >= TExit)
            {
                return {0.0f, 0.0f, 0.0f};
            }
        }
    }

    // Build orthonormal camera-plane basis (RightU, UpV) perpendicular to RayDirectionUnit for 6-fold crystal bokeh & hail sphere normals!
    const Vec3 RefUp  = (std::abs(RayDirectionUnit.Z) < 0.92f) ? Vec3{0.0f, 0.0f, 1.0f} : Vec3{1.0f, 0.0f, 0.0f};
    const Vec3 BasisU = Normalise(Cross(RayDirectionUnit, RefUp));
    const Vec3 BasisV = Cross(BasisU, RayDirectionUnit);

    const float CosTheta       = Dot(RayDirectionUnit, SunDirectionUnit);
    const float ForwardScatter = 0.35f + 0.65f * std::pow(0.5f + 0.5f * CosTheta, 2.6f);
    const Vec3  SnowIllum      = SkyAmbientRgb * 1.45f + SunIrradianceRgb * (0.30f * ForwardScatter);
    const Vec3  RainIllum      = SkyAmbientRgb * 1.65f + SunIrradianceRgb * (0.42f * ForwardScatter) + Vec3{0.32f, 0.40f, 0.52f};
    const Vec3  HailIllum      = SkyAmbientRgb * 1.55f + SunIrradianceRgb * (0.34f * ForwardScatter);

    const float CellSizeX  = (VolumeMax_.X - VolumeMin_.X) / static_cast<float>(GridNx);
    const float CellSizeY  = (VolumeMax_.Y - VolumeMin_.Y) / static_cast<float>(GridNy);
    const float CellSizeZ  = (VolumeMax_.Z - VolumeMin_.Z) / static_cast<float>(GridNz);
    const float StepStride = 0.58f * std::min({CellSizeX, CellSizeY, CellSizeZ});
    const float SafeAngRad = std::clamp(PixelAngularRadians, 0.0005f, 0.0040f);

    const float BaseShutterSec = (Config_.Phase == SkyPrecipitationPhase::Rainfall)  ? 0.038f
                               : (Config_.Phase == SkyPrecipitationPhase::Hailstorm) ? 0.0055f
                                                                                     : 0.020f;

    // Prevent individual hydrometeors < 0.58 m from the camera pinhole from blooming into giant screen-blocking blobs!
    const float MinCameraClearanceM = (Config_.Phase == SkyPrecipitationPhase::DendriticSnow) ? 0.58f : 0.68f;

    Vec3  AccumRadiance{0.0f, 0.0f, 0.0f};
    float Transmittance = 1.0f;

    uint32_t PrevCell = 0xFFFFFFFFu;
    for (float T = TEnter; T <= TExit && Transmittance > 0.06f; T += StepStride)
    {
        const Vec3    SampleP = RayOrigin + RayDirectionUnit * T;
        const int32_t Cx      = std::clamp(static_cast<int32_t>((SampleP.X - VolumeMin_.X) / CellSizeX), 0, static_cast<int32_t>(GridNx) - 1);
        const int32_t Cy      = std::clamp(static_cast<int32_t>((SampleP.Y - VolumeMin_.Y) / CellSizeY), 0, static_cast<int32_t>(GridNy) - 1);
        const int32_t Cz      = std::clamp(static_cast<int32_t>((SampleP.Z - VolumeMin_.Z) / CellSizeZ), 0, static_cast<int32_t>(GridNz) - 1);
        const uint32_t Cell   = static_cast<uint32_t>((Cz * static_cast<int32_t>(GridNy) + Cy) * static_cast<int32_t>(GridNx) + Cx);
        if (Cell == PrevCell)
        {
            continue;
        }
        PrevCell = Cell;

        const uint32_t Begin = CellOffsets_[Cell];
        const uint32_t End   = CellOffsets_[Cell + 1u];
        for (uint32_t Slot = Begin; Slot < End; ++Slot)
        {
            const SkyPrecipitationParticle& P     = Particles_[SortedIndices_[Slot]];
            const Vec3                      Head  = P.PositionWorld;
            const float                     ProjT = Dot(Head - RayOrigin, RayDirectionUnit);
            if (ProjT <= MinCameraClearanceM || ProjT >= MaxDistanceM)
            {
                continue;
            }

            // Rebounding hailstones use a crisp short shutter (0.0045s) so individual bouncing ice stones + upward arcs are sharp!
            const float ShutterSec = (P.InReboundArc != 0u) ? 0.0045f : BaseShutterSec;
            const Vec3  Tail       = Head - P.VelocityMps * ShutterSec;
            const Vec3  Seg        = Head - Tail;
            const float SegLen     = Length(Seg);

            float Along01 = 0.5f;
            float HitRayT = ProjT;
            if (SegLen > 1.0e-4f)
            {
                const Vec3  W0    = RayOrigin - Tail;
                const float B     = Dot(RayDirectionUnit, Seg);
                const float C     = Dot(Seg, Seg);
                const float D     = Dot(RayDirectionUnit, W0);
                const float E     = Dot(Seg, W0);
                const float Denom = C - B * B;
                if (Denom > 1.0e-7f)
                {
                    Along01 = std::clamp((E - B * D) / Denom, 0.0f, 1.0f);
                }
                HitRayT = Dot((Tail + Seg * Along01) - RayOrigin, RayDirectionUnit);
            }
            if (HitRayT <= MinCameraClearanceM || HitRayT >= MaxDistanceM)
            {
                continue;
            }

            const Vec3  StreakPt = Tail + Seg * Along01;
            const Vec3  RayPt    = RayOrigin + RayDirectionUnit * HitRayT;
            const Vec3  Diff     = RayPt - StreakPt;
            const float DistSq   = Dot(Diff, Diff);

            if (Config_.Phase == SkyPrecipitationPhase::Rainfall)
            {
                // Crisp slanted specular/refractive raindrop streak!
                const float MinPixelR  = HitRayT * SafeAngRad * 1.18f;
                const float EffectiveR = std::max(P.RadiusMetres * 1.35f, MinPixelR);
                if (DistSq >= EffectiveR * EffectiveR)
                {
                    continue;
                }
                const float U          = std::sqrt(DistSq) / std::max(EffectiveR, 1.0e-6f);
                const float Taper      = std::sin(Along01 * 3.14159265f); // Smooth shutter fade at head & tail!
                const float Core       = std::exp(-3.4f * U * U) * (0.35f + 0.65f * Taper);
                const float Opacity    = std::clamp(0.62f * Core * Config_.Intensity01, 0.0f, 0.78f);
                const Vec3  StreakTint = RainIllum * (P.Reflectance * (0.95f + 0.55f * (1.0f - U)));

                AccumRadiance = AccumRadiance + StreakTint * (Transmittance * Opacity);
                Transmittance *= (1.0f - Opacity * 0.35f);
            }
            else if (Config_.Phase == SkyPrecipitationPhase::Hailstorm)
            {
                // Layered opaque/translucent rime-ice hailstone with 3D sphere sun glint!
                const float MinPixelR  = HitRayT * SafeAngRad * 1.25f;
                const float EffectiveR = std::max(P.RadiusMetres * 1.15f, MinPixelR);
                if (DistSq >= EffectiveR * EffectiveR)
                {
                    continue;
                }
                const float Du      = Dot(Diff, BasisU) / EffectiveR;
                const float Dv      = Dot(Diff, BasisV) / EffectiveR;
                const float R2      = std::min(1.0f, Du * Du + Dv * Dv);
                const float Nz      = std::sqrt(std::max(0.0f, 1.0f - R2));
                const Vec3  SphereN = Normalise(BasisU * Du + BasisV * Dv - RayDirectionUnit * Nz);
                const float SpecGlint = std::pow(std::max(0.0f, Dot(SphereN, SunDirectionUnit)), 14.0f);
                const float IceRim    = 0.72f + 0.28f * Nz;
                const float Opacity   = std::clamp(0.88f * (1.0f - R2 * R2) * Config_.Intensity01, 0.0f, 0.92f);
                const Vec3  BaseHail  = HailIllum * (P.Reflectance * IceRim);
                const Vec3  IceColor  = Vec3{BaseHail.X * 0.92f, BaseHail.Y * 0.97f, BaseHail.Z * 1.05f} +
                                       SunIrradianceRgb * (0.55f * SpecGlint);

                AccumRadiance = AccumRadiance + IceColor * (Transmittance * Opacity);
                Transmittance *= (1.0f - Opacity * 0.72f);
            }
            else
            {
                // Dendritic Snowflake: foreground 6-fold hexagonal crystal bokeh + mid/far sunlit white snow crystals!
                const float MinPixelR  = HitRayT * SafeAngRad * 1.16f;
                const float BokehGrow  = (HitRayT < 2.3f) ? (1.0f + (2.3f - HitRayT) * 0.45f) : 1.0f;
                const float EffectiveR = std::max(P.RadiusMetres * BokehGrow, MinPixelR);
                if (DistSq >= EffectiveR * EffectiveR)
                {
                    continue;
                }

                const float Du      = Dot(Diff, BasisU) / EffectiveR;
                const float Dv      = Dot(Diff, BasisV) / EffectiveR;
                const float RNorm   = std::sqrt(std::min(1.0f, Du * Du + Dv * Dv));
                const float Theta   = std::atan2(Dv, Du) + P.FlutterPhase;
                // 6-fold hexagonal ice-dendrite modulation on resolved flakes!
                const float Dendrite = 0.84f + 0.24f * std::cos(6.0f * Theta) * RNorm;
                const float AreaComp = std::clamp((P.RadiusMetres * BokehGrow) / EffectiveR, 0.42f, 1.0f);
                const float Profile  = std::pow(1.0f - RNorm * RNorm, 1.35f) * Dendrite * AreaComp;
                const float Opacity  = std::clamp(0.86f * Profile * Config_.Intensity01, 0.0f, 0.92f);
                const Vec3  Crystal  = SnowIllum * (P.Reflectance * (0.94f + 0.28f * (1.0f - RNorm * RNorm)));

                AccumRadiance = AccumRadiance + Crystal * (Transmittance * Opacity);
                Transmittance *= (1.0f - Opacity * 0.62f);
            }
        }
    }

    // Volumetric distant storm curtains / snowfall sheets / rain shafts (virga) in the background sky!
    if (Config_.Intensity01 > 0.05f && MaxDistanceM > 6.0f)
    {
        const float VeilDepth = std::max(0.0f, std::min(MaxDistanceM, 68.0f) - 5.0f);
        const float Azimuth   = std::atan2(RayDirectionUnit.Y, RayDirectionUnit.X);
        const float Elev      = RayDirectionUnit.Z;
        if (Config_.Phase == SkyPrecipitationPhase::DendriticSnow)
        {
            const float Curtain = 0.65f + 0.35f * HashCurtainNoise2D(Azimuth * 5.5f - ElapsedSeconds_ * 0.25f, Elev * 8.0f + ElapsedSeconds_ * 0.4f);
            const float VeilAlpha = (1.0f - std::exp(-0.0072f * Config_.Intensity01 * Curtain * VeilDepth));
            const Vec3  VeilRad   = (SkyAmbientRgb * 1.12f + SunIrradianceRgb * 0.11f);
            AccumRadiance = AccumRadiance + VeilRad * (Transmittance * VeilAlpha);
            Transmittance *= (1.0f - VeilAlpha);
        }
        else if (Config_.Phase == SkyPrecipitationPhase::Rainfall)
        {
            // Slanted storm rain shafts descending from overcast nimbus cloud bases!
            const float SlantCoord = Azimuth * 9.0f + Elev * 3.2f - ElapsedSeconds_ * 0.35f;
            const float Shafts     = 0.52f + 0.48f * HashCurtainNoise2D(SlantCoord, Elev * 6.5f + ElapsedSeconds_ * 1.1f);
            const float VeilAlpha  = (1.0f - std::exp(-0.0068f * Config_.Intensity01 * Shafts * VeilDepth));
            const Vec3  VeilRad    = (SkyAmbientRgb * 0.92f + SunIrradianceRgb * 0.07f + Vec3{0.08f, 0.11f, 0.15f});
            AccumRadiance = AccumRadiance + VeilRad * (Transmittance * VeilAlpha);
            Transmittance *= (1.0f - VeilAlpha);
        }
        else if (Config_.Phase == SkyPrecipitationPhase::Hailstorm)
        {
            const float Shafts    = 0.60f + 0.40f * HashCurtainNoise2D(Azimuth * 7.5f, Elev * 7.0f + ElapsedSeconds_ * 1.4f);
            const float VeilAlpha = (1.0f - std::exp(-0.0055f * Config_.Intensity01 * Shafts * VeilDepth));
            const Vec3  VeilRad   = (SkyAmbientRgb * 0.98f + SunIrradianceRgb * 0.08f);
            AccumRadiance = AccumRadiance + VeilRad * (Transmittance * VeilAlpha);
            Transmittance *= (1.0f - VeilAlpha);
        }
    }

    if (OutTransmittance != nullptr)
    {
        *OutTransmittance = Transmittance;
    }
    return AccumRadiance;
}

} // namespace Frontier
