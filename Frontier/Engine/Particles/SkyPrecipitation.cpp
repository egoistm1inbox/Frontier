/*==========================================================================================================================================
                                                    SKYPRECIPITATION.CPP
==========================================================================================================================================*/
// 🧩 Wind-advected 3D falling sky precipitation (dendritic snow, sleet pellets, rain streaks) with spatial-grid optical evaluation.

#include "Engine/Particles/SkyPrecipitation.h"

#include <algorithm>
#include <cmath>

namespace Frontier
{
namespace
{
constexpr float TwoPiConst = 6.28318530717958647692f;

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

        if (Config_.Phase == SkyPrecipitationPhase::DendriticSnow)
        {
            P.RadiusMetres    = (0.0040f + 0.0055f * Rng.Next01()) * Config_.FlakeRadiusScale;
            P.TerminalFallMps = 1.02f + 0.78f * Rng.Next01();
            P.FlutterAmpMps   = 0.32f + 0.52f * Rng.Next01();
            P.FlutterFreqRad  = 2.2f + 2.8f * Rng.Next01();
            P.Reflectance     = 0.90f + 0.08f * Rng.Next01();
        }
        else if (Config_.Phase == SkyPrecipitationPhase::SleetGraupel)
        {
            P.RadiusMetres    = (0.0025f + 0.0030f * Rng.Next01()) * Config_.FlakeRadiusScale;
            P.TerminalFallMps = 3.20f + 1.65f * Rng.Next01();
            P.FlutterAmpMps   = 0.14f + 0.18f * Rng.Next01();
            P.FlutterFreqRad  = 4.0f + 2.0f * Rng.Next01();
            P.Reflectance     = 0.84f + 0.08f * Rng.Next01();
        }
        else
        {
            P.RadiusMetres    = (0.0012f + 0.0014f * Rng.Next01()) * Config_.FlakeRadiusScale;
            P.TerminalFallMps = 6.80f + 2.60f * Rng.Next01();
            P.FlutterAmpMps   = 0.04f;
            P.FlutterFreqRad  = 3.0f;
            P.Reflectance     = 0.62f;
        }
        P.FlutterPhase = TwoPiConst * Rng.Next01();
        P.VelocityMps  = {0.0f, 0.0f, -P.TerminalFallMps};
    }

    ElapsedSeconds_ = 0.0f;
    Telemetry_      = {};
    Telemetry_.ActiveParticles = static_cast<uint32_t>(Particles_.size());
    RebuildSpatialAccelerationGrid();
}

void SkyPrecipitation::StepPrecipitation(
    float                    DtSeconds,
    Vec3                     FallbackWindMps,
    PrecipitationWindSampler WindSampler,
    const void*              WindContext)
{
    if (DtSeconds <= 0.0f || Particles_.empty())
    {
        return;
    }

    ElapsedSeconds_ += DtSeconds;
    double SumFall = 0.0;
    double SumHoriz = 0.0;

    for (SkyPrecipitationParticle& P : Particles_)
    {
        Vec3 LocalWind = FallbackWindMps;
        if (WindSampler != nullptr)
        {
            LocalWind = WindSampler(P.PositionWorld, WindContext);
        }

        const float Arg = P.FlutterPhase + ElapsedSeconds_ * P.FlutterFreqRad;
        const Vec3 Flutter{
            P.FlutterAmpMps * std::cos(Arg),
            P.FlutterAmpMps * std::sin(Arg * 1.17f + 0.8f),
            0.12f * P.FlutterAmpMps * std::sin(Arg * 0.73f)};

        P.VelocityMps = {
            LocalWind.X * 0.86f + Flutter.X,
            LocalWind.Y * 0.86f + Flutter.Y,
            LocalWind.Z * 0.35f - P.TerminalFallMps + Flutter.Z};

        P.PositionWorld = P.PositionWorld + P.VelocityMps * DtSeconds;
        P.PositionWorld.X = WrapAxis(P.PositionWorld.X, VolumeMin_.X, VolumeMax_.X);
        P.PositionWorld.Y = WrapAxis(P.PositionWorld.Y, VolumeMin_.Y, VolumeMax_.Y);

        if (P.PositionWorld.Z < VolumeMin_.Z)
        {
            P.PositionWorld.Z = VolumeMax_.Z - std::fmod(VolumeMin_.Z - P.PositionWorld.Z, VolumeMax_.Z - VolumeMin_.Z);
            ++Telemetry_.RecycledTouchdowns;
        }
        else if (P.PositionWorld.Z > VolumeMax_.Z)
        {
            P.PositionWorld.Z = VolumeMin_.Z + std::fmod(P.PositionWorld.Z - VolumeMax_.Z, VolumeMax_.Z - VolumeMin_.Z);
        }

        SumFall += static_cast<double>( std::max(0.0f, -P.VelocityMps.Z) );
        SumHoriz += static_cast<double>( std::sqrt(P.VelocityMps.X * P.VelocityMps.X + P.VelocityMps.Y * P.VelocityMps.Y) );
    }

    const double InvN = 1.0 / static_cast<double>(Particles_.size());
    Telemetry_.ActiveParticles     = static_cast<uint32_t>(Particles_.size());
    Telemetry_.MeanFallSpeedMps    = static_cast<float>(SumFall * InvN);
    Telemetry_.MeanHorizontalSpeed = static_cast<float>(SumHoriz * InvN);

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

    // Ray-AABB clip against precipitation sky volume
    float TEnter = 0.08f;
    float TExit  = std::min(MaxDistanceM, 36.0f);
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
            float T0 = (BMin[Axis] - Orig[Axis]) * InvD;
            float T1 = (BMax[Axis] - Orig[Axis]) * InvD;
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

    // Crystal Mie/forward-back phase lighting on falling snowflakes
    const float CosTheta = Dot(RayDirectionUnit, SunDirectionUnit);
    const float ForwardScatter = 0.32f + 0.68f * std::pow(0.5f + 0.5f * CosTheta, 3.0f);
    const Vec3  FlakeIllum = SkyAmbientRgb * 1.15f + SunIrradianceRgb * (0.22f * ForwardScatter);

    const float CellSizeX = (VolumeMax_.X - VolumeMin_.X) / static_cast<float>(GridNx);
    const float CellSizeY = (VolumeMax_.Y - VolumeMin_.Y) / static_cast<float>(GridNy);
    const float CellSizeZ = (VolumeMax_.Z - VolumeMin_.Z) / static_cast<float>(GridNz);
    const float StepStride = 0.65f * std::min({CellSizeX, CellSizeY, CellSizeZ});
    const float ShutterSec = (Config_.Phase == SkyPrecipitationPhase::Rainfall) ? 0.032f : 0.022f;
    const float SafeAngRad = std::clamp(PixelAngularRadians, 0.0005f, 0.0040f);

    Vec3  AccumRadiance{0.0f, 0.0f, 0.0f};
    float Transmittance = 1.0f;

    uint32_t PrevCell = 0xFFFFFFFFu;
    for (float T = TEnter; T <= TExit && Transmittance > 0.08f; T += StepStride)
    {
        const Vec3 SampleP = RayOrigin + RayDirectionUnit * T;
        const int32_t Cx = std::clamp(static_cast<int32_t>((SampleP.X - VolumeMin_.X) / CellSizeX), 0, static_cast<int32_t>(GridNx) - 1);
        const int32_t Cy = std::clamp(static_cast<int32_t>((SampleP.Y - VolumeMin_.Y) / CellSizeY), 0, static_cast<int32_t>(GridNy) - 1);
        const int32_t Cz = std::clamp(static_cast<int32_t>((SampleP.Z - VolumeMin_.Z) / CellSizeZ), 0, static_cast<int32_t>(GridNz) - 1);
        const uint32_t Cell = static_cast<uint32_t>((Cz * static_cast<int32_t>(GridNy) + Cy) * static_cast<int32_t>(GridNx) + Cx);
        if (Cell == PrevCell)
        {
            continue;
        }
        PrevCell = Cell;

        const uint32_t Begin = CellOffsets_[Cell];
        const uint32_t End   = CellOffsets_[Cell + 1u];
        for (uint32_t Slot = Begin; Slot < End; ++Slot)
        {
            const SkyPrecipitationParticle& Flake = Particles_[SortedIndices_[Slot]];
            const Vec3  Head   = Flake.PositionWorld;
            const float ProjT  = Dot(Head - RayOrigin, RayDirectionUnit);
            if (ProjT <= 0.12f || ProjT >= MaxDistanceM)
            {
                continue;
            }

            // Shutter-streaked wind-drifted snowflake/hydrometeor segment
            const Vec3  Tail   = Head - Flake.VelocityMps * ShutterSec;
            const Vec3  Seg    = Head - Tail;
            const float SegLen = Length(Seg);

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
            if (HitRayT <= 0.12f || HitRayT >= MaxDistanceM)
            {
                continue;
            }

            // Near-field soft crystal bokeh + minimum 1.05-pixel distant anti-aliased visibility
            const float MinPixelR = HitRayT * SafeAngRad * 1.15f;
            const float BokehGrow = (HitRayT < 2.6f) ? (1.0f + (2.6f - HitRayT) * 0.85f) : 1.0f;
            const float EffectiveR = std::max(Flake.RadiusMetres * BokehGrow, MinPixelR);

            const Vec3  FlakePt = Tail + Seg * Along01;
            const Vec3  RayPt   = RayOrigin + RayDirectionUnit * HitRayT;
            const Vec3  Diff    = RayPt - FlakePt;
            const float DistSq  = Dot(Diff, Diff);
            if (DistSq >= EffectiveR * EffectiveR)
            {
                continue;
            }

            const float U2 = DistSq / std::max(EffectiveR * EffectiveR, 1.0e-8f);
            // Crystalline core + soft bokeh rim, energy-compensated when sub-pixel expanded
            const float AreaScale = std::clamp((Flake.RadiusMetres * BokehGrow) / EffectiveR, 0.28f, 1.0f);
            const float Profile   = std::pow(1.0f - U2, 1.65f) * AreaScale;
            const float Opacity   = std::clamp(0.78f * Profile * Config_.Intensity01, 0.0f, 0.88f);
            const Vec3  CrystalColor = FlakeIllum * (Flake.Reflectance * (0.88f + 0.24f * (1.0f - U2)));

            AccumRadiance = AccumRadiance + CrystalColor * (Transmittance * Opacity);
            Transmittance *= (1.0f - Opacity * 0.65f);
        }
    }

    // Subtle distant snowfall atmospheric veil for realistic winter depth
    if (Config_.Phase == SkyPrecipitationPhase::DendriticSnow && Config_.Intensity01 > 0.05f)
    {
        const float VeilDepth = std::max(0.0f, std::min(MaxDistanceM, 65.0f) - 4.0f);
        const float VeilAlpha = (1.0f - std::exp(-0.0055f * Config_.Intensity01 * VeilDepth));
        const Vec3  VeilRad   = (SkyAmbientRgb * 0.95f + SunIrradianceRgb * 0.08f);
        AccumRadiance = AccumRadiance + VeilRad * (Transmittance * VeilAlpha);
        Transmittance *= (1.0f - VeilAlpha);
    }

    if (OutTransmittance != nullptr)
    {
        *OutTransmittance = Transmittance;
    }
    return AccumRadiance;
}

} // namespace Frontier
