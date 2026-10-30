/*==========================================================================================================================================
                                                   WINDFORCEFIELDEXTENSION.CPP
==========================================================================================================================================*/
// 🧩 Shared 3D Wind & Force-Field toroidal lattice driving Clouds, Fog, PlumeFluid, Vehicle Aero, and Cloud-Gated Weather Particles.

#include "Engine/VisualEffects/WindField.h"

#include <algorithm>
#include <cmath>

namespace Frontier
{

namespace
{

constexpr double PiNumber    = 3.14159265358979323846;
constexpr double TwoPiNumber = 6.28318530717958647692;

void CategoryPhysicsConstants(
    FallingParticleCategory Category,
    double&                 OutTerminalFallMps,
    double&                 OutRelaxationTauSec,
    float&                  OutNominalRadiusM) noexcept
{
    switch (Category)
    {
    case FallingParticleCategory::RainDrop:
        OutTerminalFallMps  = 9.20;
        OutRelaxationTauSec = 0.82;
        OutNominalRadiusM   = 0.0016f;
        break;
    case FallingParticleCategory::SnowFlake:
        OutTerminalFallMps  = 1.45;
        OutRelaxationTauSec = 0.18; // Low inertia -> follows wind shear, wakes & vortices tightly!
        OutNominalRadiusM   = 0.0042f;
        break;
    case FallingParticleCategory::HailPellet:
        OutTerminalFallMps  = 17.40;
        OutRelaxationTauSec = 2.35; // High ballistic inertia + asphalt restitution bounce!
        OutNominalRadiusM   = 0.0068f;
        break;
    case FallingParticleCategory::WindborneDebris:
        OutTerminalFallMps  = 0.92;
        OutRelaxationTauSec = 0.28; // Dry leaves / dust lifted & swirled by vehicle wakes & vortices!
        OutNominalRadiusM   = 0.0140f;
        break;
    }
}

// Analytical divergence-free 3D curl velocity u = curl(Psi), guaranteeing div(u) == 0 identically!
SpatialVector EvaluateDivergenceFreeCurlEddy(SpatialVector Point, double TimeSec, double ScaleM, double AmplitudeMps) noexcept
{
    if (AmplitudeMps <= 1.0e-5)
    {
        return { 0.0, 0.0, 0.0 };
    }
    const double K  = TwoPiNumber / std::max(2.0, ScaleM);
    const double X  = Point.X * K + 0.37 * TimeSec;
    const double Y  = Point.Y * K - 0.29 * TimeSec;
    const double Z  = Point.Z * K + 0.19 * TimeSec;

    // Stream vector potential Psi = (sin(Y)*cos(Z), sin(Z)*cos(X), sin(X)*cos(Y)) / K
    // curl(Psi) = (dPsiZ/dY - dPsiY/dZ, dPsiX/dZ - dPsiZ/dX, dPsiY/dX - dPsiX/dY)
    const double CurlX = -std::sin(X) * std::sin(Y) - std::cos(Z) * std::cos(X);
    const double CurlY = -std::sin(Y) * std::sin(Z) - std::cos(X) * std::cos(Y);
    const double CurlZ = -std::sin(Z) * std::sin(X) - std::cos(Y) * std::cos(Z);
    return {
        AmplitudeMps * 0.5 * CurlX,
        AmplitudeMps * 0.5 * CurlY,
        AmplitudeMps * 0.35 * CurlZ
    };
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                            SHARED 3D WIND & FORCE-FIELD LATTICE
//------------------------------------------------------------------------------------------------------------------------

WindField::WindField(const WindFieldConfiguration& Config)
{
    Reconfigure(Config);
}

void WindField::Reconfigure(const WindFieldConfiguration& Config)
{
    Config_ = Config;
    Config_.HorizontalDomainExtentM = std::max(16.0, Config_.HorizontalDomainExtentM);
    Config_.VerticalDomainHeightM   = std::max(8.0,  Config_.VerticalDomainHeightM);
    Config_.SurfaceRoughnessLengthM = std::max(0.005, Config_.SurfaceRoughnessLengthM);
    Config_.ReferenceAltitudeM      = std::max(1.0,  Config_.ReferenceAltitudeM);

    const std::size_t TotalFloats = static_cast<std::size_t>(LatticeDimX) * LatticeDimY * LatticeDimZ * 3u;
    VelocityXyz_.assign(TotalFloats, 0.0f);
    Primitives_.reserve(MaxForcePrimitives);
    StepField(Anchor_, 0.0);
}

void WindField::ClearForcePrimitives() noexcept
{
    Primitives_.clear();
}

void WindField::AppendForcePrimitive(const ForceFieldPrimitive& Primitive) noexcept
{
    if (Primitives_.size() < MaxForcePrimitives)
    {
        Primitives_.push_back(Primitive);
    }
}

void WindField::RegisterVehicleWake(
    SpatialVector ChassisPosition,
    SpatialVector ChassisVelocity,
    double        WakeRadiusM) noexcept
{
    const double Speed = std::sqrt(
        ChassisVelocity.X * ChassisVelocity.X +
        ChassisVelocity.Y * ChassisVelocity.Y +
        ChassisVelocity.Z * ChassisVelocity.Z);
    if (Speed < 0.5)
    {
        return;
    }
    ForceFieldPrimitive Wake{};
    Wake.Form             = ForcePrimitiveForm::VehicleSlipstreamWake;
    Wake.WorldCenter      = ChassisPosition;
    Wake.AxisOrVelocity   = ChassisVelocity;
    Wake.InfluenceRadiusM = std::max(1.5, WakeRadiusM);
    Wake.PeakSpeedMps     = 0.55 * Speed;
    AppendForcePrimitive(Wake);
}

SpatialVector WindField::EvaluateAnalyticVelocity(SpatialVector WorldPoint) const noexcept
{
    const double HeightAboveGround = std::max(0.05, WorldPoint.Z - Config_.GroundElevationM);
    const double Z0                = Config_.SurfaceRoughnessLengthM;
    const double LogDenom          = std::log((Config_.ReferenceAltitudeM + Z0) / Z0);
    const double AblFactor         = std::clamp(std::log((HeightAboveGround + Z0) / Z0) / std::max(0.2, LogDenom), 0.15, 1.85);

    // Traveling atmospheric gust front modulated along wind direction.
    const double WindMag = std::hypot(Config_.AmbientReferenceWindMps.X, Config_.AmbientReferenceWindMps.Y);
    const double DirX    = (WindMag > 1.0e-4) ? (Config_.AmbientReferenceWindMps.X / WindMag) : 1.0;
    const double DirY    = (WindMag > 1.0e-4) ? (Config_.AmbientReferenceWindMps.Y / WindMag) : 0.0;
    const double Phase   = TwoPiNumber * ((WorldPoint.X * DirX + WorldPoint.Y * DirY - 0.85 * std::max(2.0, WindMag) * ElapsedSeconds_) /
                                          std::max(10.0, Config_.GustWavelengthM));
    const double GustMod = 1.0 + Config_.GustAmplitudeFraction * (0.65 * std::sin(Phase) + 0.35 * std::sin(2.17 * Phase + 1.1));

    const SpatialVector Eddy = EvaluateDivergenceFreeCurlEddy(
        WorldPoint, ElapsedSeconds_, Config_.CurlSpatialScaleM, Config_.CurlTurbulenceMps);

    // Suppress vertical eddy penetration right at the ground plane (impermeability z -> 0).
    const double GroundWallDamp = std::clamp(HeightAboveGround / 2.5, 0.0, 1.0);

    SpatialVector Total = {
        Config_.AmbientReferenceWindMps.X * AblFactor * GustMod + Eddy.X,
        Config_.AmbientReferenceWindMps.Y * AblFactor * GustMod + Eddy.Y,
        (Config_.AmbientReferenceWindMps.Z + Eddy.Z) * GroundWallDamp
    };

    for (const ForceFieldPrimitive& P : Primitives_)
    {
        const double Dx   = WorldPoint.X - P.WorldCenter.X;
        const double Dy   = WorldPoint.Y - P.WorldCenter.Y;
        const double Dz   = WorldPoint.Z - P.WorldCenter.Z;
        const double R2   = Dx * Dx + Dy * Dy + Dz * Dz;
        const double InvS = 1.0 / std::max(0.5, P.InfluenceRadiusM * P.InfluenceRadiusM);

        switch (P.Form)
        {
        case ForcePrimitiveForm::DirectionalGustCorridor:
        {
            const double Env = std::exp(-R2 * InvS);
            Total.X += P.AxisOrVelocity.X * P.PeakSpeedMps * Env;
            Total.Y += P.AxisOrVelocity.Y * P.PeakSpeedMps * Env;
            Total.Z += P.AxisOrVelocity.Z * P.PeakSpeedMps * Env * GroundWallDamp;
            break;
        }
        case ForcePrimitiveForm::RadialImpulseWave:
        {
            const double Dist = std::sqrt(R2);
            if (Dist > 1.0e-4)
            {
                const double Env = (Dist / std::max(0.5, P.InfluenceRadiusM)) * std::exp(0.5 - 0.5 * R2 * InvS);
                Total.X += (Dx / Dist) * P.PeakSpeedMps * Env;
                Total.Y += (Dy / Dist) * P.PeakSpeedMps * Env;
                Total.Z += (Dz / Dist) * P.PeakSpeedMps * Env * GroundWallDamp;
            }
            break;
        }
        case ForcePrimitiveForm::VortexColumnUpdraft:
        {
            const double RadXY = std::hypot(Dx, Dy);
            const double VertEnv = std::exp(-(Dz * Dz) * 0.25 * InvS);
            if (RadXY > 1.0e-4)
            {
                // Rankine-Burgers smooth vortex core: V_theta ~ (r / R_c) * exp(1 - (r/R_c)^2)
                const double NormR    = RadXY / std::max(0.5, P.InfluenceRadiusM);
                const double SwirlMag = P.PeakSpeedMps * P.SwirlRatio * NormR * std::exp(0.5 - 0.5 * NormR * NormR) * VertEnv;
                Total.X += (-Dy / RadXY) * SwirlMag;
                Total.Y += ( Dx / RadXY) * SwirlMag;
                Total.Z += P.PeakSpeedMps * 0.45 * std::exp(-NormR * NormR) * VertEnv * GroundWallDamp;
            }
            break;
        }
        case ForcePrimitiveForm::VehicleSlipstreamWake:
        {
            const double VeloMag = std::sqrt(
                P.AxisOrVelocity.X * P.AxisOrVelocity.X +
                P.AxisOrVelocity.Y * P.AxisOrVelocity.Y +
                P.AxisOrVelocity.Z * P.AxisOrVelocity.Z);
            if (VeloMag > 0.2)
            {
                const double FwdX  = P.AxisOrVelocity.X / VeloMag;
                const double FwdY  = P.AxisOrVelocity.Y / VeloMag;
                const double Along = Dx * FwdX + Dy * FwdY; // >0 ahead of car, <0 in trailing wake!
                const double LatX  = Dx - Along * FwdX;
                const double LatY  = Dy - Along * FwdY;
                const double LatR2 = LatX * LatX + LatY * LatY + Dz * Dz;

                if (Along >= -1.5 && Along <= P.InfluenceRadiusM)
                {
                    // Bow wave pushes snow/fog laterally outward around chassis nose!
                    const double BowEnv = std::exp(-LatR2 * InvS * 1.4) * std::exp(-(Along * Along) * InvS);
                    Total.X += (LatX * 0.8 + 0.35 * P.AxisOrVelocity.X / VeloMag) * P.PeakSpeedMps * BowEnv;
                    Total.Y += (LatY * 0.8 + 0.35 * P.AxisOrVelocity.Y / VeloMag) * P.PeakSpeedMps * BowEnv;
                    Total.Z += 0.22 * P.PeakSpeedMps * BowEnv;
                }
                else if (Along < -1.5 && Along > -4.5 * P.InfluenceRadiusM)
                {
                    // Trailing low-pressure slipstream pulls smoke/snow/leaves forward + upward rooster-tail!
                    const double WakeDecay = std::exp(Along / (2.4 * P.InfluenceRadiusM)) * std::exp(-LatR2 * InvS);
                    Total.X += FwdX * P.PeakSpeedMps * 0.72 * WakeDecay;
                    Total.Y += FwdY * P.PeakSpeedMps * 0.72 * WakeDecay;
                    Total.Z += 0.34 * P.PeakSpeedMps * WakeDecay * GroundWallDamp;
                }
            }
            break;
        }
        }
    }

    return Total;
}

void WindField::StepField(SpatialVector AnchorPosition, double StepSeconds) noexcept
{
    Anchor_         = AnchorPosition;
    ElapsedSeconds_ += std::max(0.0, StepSeconds);

    const double HalfSpan = 0.5 * Config_.HorizontalDomainExtentM;
    const double MinX     = Anchor_.X - HalfSpan;
    const double MinY     = Anchor_.Y - HalfSpan;
    const double MinZ     = Config_.GroundElevationM;
    const double StepX    = Config_.HorizontalDomainExtentM / static_cast<double>(LatticeDimX - 1u);
    const double StepY    = Config_.HorizontalDomainExtentM / static_cast<double>(LatticeDimY - 1u);
    const double StepZ    = Config_.VerticalDomainHeightM   / static_cast<double>(LatticeDimZ - 1u);

    for (std::uint32_t K = 0u; K < LatticeDimZ; ++K)
    {
        const double Wz = MinZ + static_cast<double>(K) * StepZ;
        for (std::uint32_t J = 0u; J < LatticeDimY; ++J)
        {
            const double Wy = MinY + static_cast<double>(J) * StepY;
            for (std::uint32_t I = 0u; I < LatticeDimX; ++I)
            {
                const double Wx = MinX + static_cast<double>(I) * StepX;
                const SpatialVector V = EvaluateAnalyticVelocity({ Wx, Wy, Wz });
                const std::size_t Base = ((static_cast<std::size_t>(K) * LatticeDimY + J) * LatticeDimX + I) * 3u;
                VelocityXyz_[Base + 0u] = static_cast<float>(V.X);
                VelocityXyz_[Base + 1u] = static_cast<float>(V.Y);
                VelocityXyz_[Base + 2u] = static_cast<float>(V.Z);
            }
        }
    }

    // Integrate high-altitude wind for smooth CloudField drift.
    if (StepSeconds > 0.0)
    {
        const SpatialVector CloudWind = EvaluateAnalyticVelocity({ Anchor_.X, Anchor_.Y, Config_.GroundElevationM + 850.0 });
        IntegratedCloudDrift_.X += CloudWind.X * StepSeconds;
        IntegratedCloudDrift_.Y += CloudWind.Y * StepSeconds;
    }
}

SpatialVector WindField::SampleWindVelocity(SpatialVector WorldPoint) const noexcept
{
    const double HalfSpan = 0.5 * Config_.HorizontalDomainExtentM;
    const double Ux = (WorldPoint.X - (Anchor_.X - HalfSpan)) / Config_.HorizontalDomainExtentM * static_cast<double>(LatticeDimX - 1u);
    const double Uy = (WorldPoint.Y - (Anchor_.Y - HalfSpan)) / Config_.HorizontalDomainExtentM * static_cast<double>(LatticeDimY - 1u);
    const double Uz = (WorldPoint.Z - Config_.GroundElevationM) / Config_.VerticalDomainHeightM * static_cast<double>(LatticeDimZ - 1u);

    if (Ux < 0.0 || Ux >= static_cast<double>(LatticeDimX - 1u) ||
        Uy < 0.0 || Uy >= static_cast<double>(LatticeDimY - 1u) ||
        Uz < 0.0 || Uz >= static_cast<double>(LatticeDimZ - 1u))
    {
        return EvaluateAnalyticVelocity(WorldPoint);
    }

    const std::uint32_t I0 = static_cast<std::uint32_t>(Ux);
    const std::uint32_t J0 = static_cast<std::uint32_t>(Uy);
    const std::uint32_t K0 = static_cast<std::uint32_t>(Uz);
    const float Fx = static_cast<float>(Ux - static_cast<double>(I0));
    const float Fy = static_cast<float>(Uy - static_cast<double>(J0));
    const float Fz = static_cast<float>(Uz - static_cast<double>(K0));

    auto ReadNode = [this](std::uint32_t I, std::uint32_t J, std::uint32_t K) noexcept -> const float*
    {
        return &VelocityXyz_[((static_cast<std::size_t>(K) * LatticeDimY + J) * LatticeDimX + I) * 3u];
    };

    const float* C000 = ReadNode(I0,      J0,      K0);
    const float* C100 = ReadNode(I0 + 1u, J0,      K0);
    const float* C010 = ReadNode(I0,      J0 + 1u, K0);
    const float* C110 = ReadNode(I0 + 1u, J0 + 1u, K0);
    const float* C001 = ReadNode(I0,      J0,      K0 + 1u);
    const float* C101 = ReadNode(I0 + 1u, J0,      K0 + 1u);
    const float* C011 = ReadNode(I0,      J0 + 1u, K0 + 1u);
    const float* C111 = ReadNode(I0 + 1u, J0 + 1u, K0 + 1u);

    double Out[3]{};
    for (int Axis = 0; Axis < 3; ++Axis)
    {
        const float X00 = C000[Axis] + Fx * (C100[Axis] - C000[Axis]);
        const float X10 = C010[Axis] + Fx * (C110[Axis] - C010[Axis]);
        const float X01 = C001[Axis] + Fx * (C101[Axis] - C001[Axis]);
        const float X11 = C011[Axis] + Fx * (C111[Axis] - C011[Axis]);
        const float Y0  = X00 + Fy * (X10 - X00);
        const float Y1  = X01 + Fy * (X11 - X01);
        Out[Axis]       = static_cast<double>(Y0 + Fz * (Y1 - Y0));
    }
    return { Out[0], Out[1], Out[2] };
}

void WindField::SynchronizeCloudAdvection(CloudParameters& InOutClouds, double StepSeconds) const noexcept
{
    const double MidCloudZ = 0.5 * (InOutClouds.BaseHeightM + InOutClouds.TopHeightM);
    const SpatialVector UpperWind = EvaluateAnalyticVelocity({ Anchor_.X, Anchor_.Y, MidCloudZ });
    InOutClouds.WindXMps  = UpperWind.X;
    InOutClouds.WindYMps  = UpperWind.Y;
    InOutClouds.WindTimeS += std::max(0.0, StepSeconds);
}

SpatialVector WindField::EvaluateAdvectedFogSamplePoint(SpatialVector WorldPoint) const noexcept
{
    const SpatialVector LocalWind = SampleWindVelocity(WorldPoint);
    // Bounded dual-phase advection offset keeps FogMedium density coherent while streaming around wakes!
    const double Phase = std::fmod(ElapsedSeconds_, 4.0);
    return {
        WorldPoint.X - LocalWind.X * 0.35 * Phase,
        WorldPoint.Y - LocalWind.Y * 0.35 * Phase,
        std::max(Config_.GroundElevationM, WorldPoint.Z - LocalWind.Z * 0.25 * Phase)
    };
}

void WindField::SynchronizePlumeParameters(
    PlumeFluidParameters& InOutPlume,
    SpatialVector         PlumeAnchor) const noexcept
{
    const SpatialVector W = SampleWindVelocity({ PlumeAnchor.X, PlumeAnchor.Y, PlumeAnchor.Z + 1.5 });
    const double HorizMag = std::hypot(W.X, W.Y);
    InOutPlume.WindSpeed          = static_cast<float>(HorizMag);
    InOutPlume.WindHeadingDegrees = (HorizMag > 1.0e-4)
        ? static_cast<float>(std::atan2(W.Y, W.X) * (180.0 / PiNumber))
        : 0.0f;
}

SpatialVector WindField::EvaluateRelativeVehicleAirflow(
    SpatialVector ChassisPosition,
    SpatialVector ChassisVelocity) const noexcept
{
    const SpatialVector AmbientWind = EvaluateAnalyticVelocity({
        ChassisPosition.X,
        ChassisPosition.Y,
        ChassisPosition.Z + 0.8
    });
    return {
        ChassisVelocity.X - AmbientWind.X,
        ChassisVelocity.Y - AmbientWind.Y,
        ChassisVelocity.Z - AmbientWind.Z
    };
}

//------------------------------------------------------------------------------------------------------------------------
//                          CLOUD-GATED BUDGETED WEATHER & DEBRIS PARTICLE SPAWNER (VOSE ALIAS)
//------------------------------------------------------------------------------------------------------------------------

CloudGatedWeatherSpawner::CloudGatedWeatherSpawner(const WeatherParticleBudgetConfig& Config)
{
    Reconfigure(Config);
}

void CloudGatedWeatherSpawner::Reconfigure(const WeatherParticleBudgetConfig& Config)
{
    Config_                      = Config;
    Config_.StrictParticleBudget = std::max(1u, Config_.StrictParticleBudget);
    Config_.SpawnVolumeHorizontalM = std::max(8.0, Config_.SpawnVolumeHorizontalM);
    Config_.SpawnCeilingHeightM    = std::max(4.0, Config_.SpawnCeilingHeightM);
    RngCursor_                   = Config_.DeterministicSeed ? Config_.DeterministicSeed : 0x510EA7EULL;
    Pool_.assign(Config_.StrictParticleBudget, WeatherParticleRecord{});
    ColumnOpticalDepth_.fill(0.0f);
    AliasProbability_.fill(0.0f);
    AliasPartner_.fill(0u);
    Telemetry_                   = {};
    AliasValid_                  = false;
    VerifiedSpawnsTotal_         = 0u;
    VerifiedSpawnsCloud_         = 0u;
}

double CloudGatedWeatherSpawner::NextUniform01() noexcept
{
    // SplitMix64 deterministic PRNG — zero heap state, 53-bit double precision in [0, 1).
    RngCursor_ += 0x9E3779B97F4A7C15ULL;
    std::uint64_t Z = RngCursor_;
    Z = (Z ^ (Z >> 30u)) * 0xBF58476D1CE4E5B9ULL;
    Z = (Z ^ (Z >> 27u)) * 0x94D049BB133111EBULL;
    Z = Z ^ (Z >> 31u);
    return static_cast<double>(Z >> 11u) * (1.0 / 9007199254740992.0);
}

double CloudGatedWeatherSpawner::MeasureSlantedCloudOpticalDepth(
    const CloudParameters&        Clouds,
    const WindField& WindField,
    SpatialVector                 WorldPoint) const noexcept
{
    if (Clouds.Coverage <= 1.0e-5 && Clouds.UniformDensityOverride < 0.0)
    {
        return 0.0;
    }

    // Windborne debris can lift from surface shear without clouds if category == WindborneDebris,
    // whereas Rain, Snow, and Hail MUST originate strictly from precipitating clouds overhead!
    double FallSpeedMps = 9.0;
    double TauSec       = 0.5;
    float  NomRadius    = 0.002f;
    CategoryPhysicsConstants(Config_.Category, FallSpeedMps, TauSec, NomRadius);

    const double SlabThickness = std::max(1.0, Clouds.TopHeightM - Clouds.BaseHeightM);
    const SpatialVector MeanWind = WindField.SampleWindVelocity({
        WorldPoint.X, WorldPoint.Y, Config_.GroundElevationM + 0.5 * Config_.SpawnCeilingHeightM
    });

    // Back-project along mean wind fall slant from WorldPoint.Z up to Cloud BaseHeightM!
    const double FallAltitudeSpan = std::max(0.0, Clouds.BaseHeightM - WorldPoint.Z);
    // Clamp horizontal slant offset to a realistic sub-cloud shear cone so local cumulus shadows map intuitively.
    const double EffectiveDriftSec = std::min(12.0, FallAltitudeSpan / std::max(1.0, FallSpeedMps) * 0.05);
    const double CloudSourceX      = WorldPoint.X - MeanWind.X * EffectiveDriftSec;
    const double CloudSourceY      = WorldPoint.Y - MeanWind.Y * EffectiveDriftSec;

    constexpr int VerticalSamples = 6;
    const double Dz               = SlabThickness / static_cast<double>(VerticalSamples);
    double OpticalDepth           = 0.0;
    for (int S = 0; S < VerticalSamples; ++S)
    {
        const double SampleZ = Clouds.BaseHeightM + (static_cast<double>(S) + 0.5) * Dz;
        const double Density = CloudDensity(Clouds, { CloudSourceX, CloudSourceY, SampleZ });
        OpticalDepth += std::max(0.0, Density) * Clouds.ExtinctionPerM * Dz;
    }
    return OpticalDepth;
}

void CloudGatedWeatherSpawner::RebuildCloudColumnAliasTable(
    const CloudParameters&        Clouds,
    const WindField& WindField,
    SpatialVector                 AnchorPosition) noexcept
{
    const double HalfSpan  = 0.5 * Config_.SpawnVolumeHorizontalM;
    const double CellSize  = Config_.SpawnVolumeHorizontalM / static_cast<double>(ColumnGridDim);
    const double SpawnTopZ = Config_.GroundElevationM + Config_.SpawnCeilingHeightM;

    std::array<double, ColumnCellCount> Weights{};
    double WeightSum        = 0.0;
    double OpticalDepthSum  = 0.0;
    std::uint32_t PrecipCols = 0u;

    for (std::uint32_t Row = 0u; Row < ColumnGridDim; ++Row)
    {
        const double Cy = AnchorPosition.Y - HalfSpan + (static_cast<double>(Row) + 0.5) * CellSize;
        for (std::uint32_t Col = 0u; Col < ColumnGridDim; ++Col)
        {
            const double Cx = AnchorPosition.X - HalfSpan + (static_cast<double>(Col) + 0.5) * CellSize;
            const std::uint32_t Idx = Row * ColumnGridDim + Col;

            double Tau = 0.0;
            if (Config_.Category == FallingParticleCategory::WindborneDebris)
            {
                // Debris lifts where local surface wind speed exceeds 3.5 m/s threshold!
                const SpatialVector W = WindField.SampleWindVelocity({ Cx, Cy, Config_.GroundElevationM + 1.0 });
                const double Speed    = std::sqrt(W.X * W.X + W.Y * W.Y + W.Z * W.Z);
                Tau                   = std::max(0.0, Speed - 3.0) * 0.25;
            }
            else
            {
                Tau = MeasureSlantedCloudOpticalDepth(Clouds, WindField, { Cx, Cy, SpawnTopZ });
            }

            ColumnOpticalDepth_[Idx] = static_cast<float>(Tau);
            OpticalDepthSum         += Tau;

            if (Tau >= Config_.CloudOpticalDepthGate)
            {
                const double Excess = Tau - Config_.CloudOpticalDepthGate + 0.02;
                Weights[Idx] = Excess;
                WeightSum   += Excess;
                ++PrecipCols;
            }
            else
            {
                Weights[Idx] = 0.0;
            }
        }
    }

    Telemetry_.PrecipitatingCloudColumns = PrecipCols;
    Telemetry_.MeanOverheadCloudDepth    = OpticalDepthSum / static_cast<double>(ColumnCellCount);

    if (PrecipCols == 0u || WeightSum <= 1.0e-12 || Config_.WeatherIntensityZeroToOne <= 1.0e-5)
    {
        AliasValid_                      = false;
        Telemetry_.TargetActiveParticles = 0u;
        return;
    }

    // Scale active particle target smoothly by precipitating sky fraction * intensity, NEVER exceeding StrictParticleBudget!
    const double SkyPrecipFraction = static_cast<double>(PrecipCols) / static_cast<double>(ColumnCellCount);
    // Mild boost (pow 0.75) lets isolated storm cells look dense right beneath the cloud while keeping 0 particles in clear sky!
    const double BudgetUtilization = std::clamp(std::pow(SkyPrecipFraction, 0.75) * Config_.WeatherIntensityZeroToOne, 0.0, 1.0);
    Telemetry_.TargetActiveParticles = std::min(
        Config_.StrictParticleBudget,
        std::max(1u, static_cast<std::uint32_t>(std::llround(BudgetUtilization * static_cast<double>(Config_.StrictParticleBudget)))));

    // Construct Vose's O(1) Alias Table in fixed stack arrays (zero heap allocations!).
    std::array<double, ColumnCellCount>        ScaledProb{};
    std::array<std::uint16_t, ColumnCellCount> SmallList{};
    std::array<std::uint16_t, ColumnCellCount> LargeList{};
    std::uint32_t SmallCount = 0u;
    std::uint32_t LargeCount = 0u;

    const double NormScale = static_cast<double>(ColumnCellCount) / WeightSum;
    for (std::uint16_t Idx = 0u; Idx < ColumnCellCount; ++Idx)
    {
        ScaledProb[Idx] = Weights[Idx] * NormScale;
        if (ScaledProb[Idx] < 1.0)
        {
            SmallList[SmallCount++] = Idx;
        }
        else
        {
            LargeList[LargeCount++] = Idx;
        }
    }

    while (SmallCount > 0u && LargeCount > 0u)
    {
        const std::uint16_t Less = SmallList[--SmallCount];
        const std::uint16_t More = LargeList[--LargeCount];
        AliasProbability_[Less]  = static_cast<float>(ScaledProb[Less]);
        AliasPartner_[Less]      = More;
        ScaledProb[More]         = (ScaledProb[More] + ScaledProb[Less]) - 1.0;
        if (ScaledProb[More] < 1.0)
        {
            SmallList[SmallCount++] = More;
        }
        else
        {
            LargeList[LargeCount++] = More;
        }
    }
    while (LargeCount > 0u)
    {
        const std::uint16_t Idx = LargeList[--LargeCount];
        AliasProbability_[Idx]  = 1.0f;
        AliasPartner_[Idx]      = Idx;
    }
    while (SmallCount > 0u)
    {
        const std::uint16_t Idx = SmallList[--SmallCount];
        AliasProbability_[Idx]  = 1.0f;
        AliasPartner_[Idx]      = Idx;
    }

    AliasValid_ = true;
}

bool CloudGatedWeatherSpawner::RespawnParticleFromCloudAlias(
    WeatherParticleRecord&        Particle,
    const WindField& WindField,
    SpatialVector                 AnchorPosition) noexcept
{
    if (!AliasValid_)
    {
        Particle.Alive = false;
        ++Telemetry_.ClearSkySpawnRejections;
        return false;
    }

    // O(1) Vose Alias draw — guaranteed to pick a column with Weight > 0 (Tau >= CloudOpticalDepthGate)!
    const std::uint32_t RawSlot = std::min(
        ColumnCellCount - 1u,
        static_cast<std::uint32_t>(NextUniform01() * static_cast<double>(ColumnCellCount)));
    const std::uint16_t ChosenCol = (NextUniform01() < static_cast<double>(AliasProbability_[RawSlot]))
        ? static_cast<std::uint16_t>(RawSlot)
        : AliasPartner_[RawSlot];

    // Safety guard against floating-point rounding on zero-weight slots.
    if (ColumnOpticalDepth_[ChosenCol] < static_cast<float>(Config_.CloudOpticalDepthGate))
    {
        Particle.Alive = false;
        ++Telemetry_.ClearSkySpawnRejections;
        return false;
    }

    const std::uint32_t GridRow = ChosenCol / ColumnGridDim;
    const std::uint32_t GridCol = ChosenCol % ColumnGridDim;
    const double HalfSpan       = 0.5 * Config_.SpawnVolumeHorizontalM;
    const double CellSize       = Config_.SpawnVolumeHorizontalM / static_cast<double>(ColumnGridDim);

    // Jitter within inner 70% of the verified cloud column so particles stay smoothly distributed without bleeding into clear sky.
    const double Jx = (NextUniform01() - 0.5) * 0.70 * CellSize;
    const double Jy = (NextUniform01() - 0.5) * 0.70 * CellSize;
    const double Px = AnchorPosition.X - HalfSpan + (static_cast<double>(GridCol) + 0.5) * CellSize + Jx;
    const double Py = AnchorPosition.Y - HalfSpan + (static_cast<double>(GridRow) + 0.5) * CellSize + Jy;

    double FallSpeedMps = 9.0;
    double TauSec       = 0.5;
    float  NomRadius    = 0.002f;
    CategoryPhysicsConstants(Config_.Category, FallSpeedMps, TauSec, NomRadius);

    const double Pz = (Config_.Category == FallingParticleCategory::WindborneDebris)
        ? (Config_.GroundElevationM + 0.15 + 1.8 * NextUniform01())
        : (Config_.GroundElevationM + Config_.SpawnCeilingHeightM * (0.88 + 0.12 * NextUniform01()));

    const SpatialVector LocalWind = WindField.SampleWindVelocity({ Px, Py, Pz });
    Particle.Position      = { Px, Py, Pz };
    Particle.Velocity      = { LocalWind.X, LocalWind.Y, LocalWind.Z - FallSpeedMps * (0.88 + 0.24 * NextUniform01()) };
    Particle.RadiusMetres  = NomRadius * static_cast<float>(0.80 + 0.45 * NextUniform01());
    Particle.PhaseAngle    = static_cast<float>(TwoPiNumber * NextUniform01());
    Particle.SourceColumn  = ChosenCol;
    Particle.BounceCounter = 0u;
    Particle.Alive         = true;

    ++VerifiedSpawnsTotal_;
    if (ColumnOpticalDepth_[ChosenCol] >= static_cast<float>(Config_.CloudOpticalDepthGate))
    {
        ++VerifiedSpawnsCloud_;
    }
    return true;
}

CloudGatedSpawnerTelemetry CloudGatedWeatherSpawner::StepParticles(
    const CloudParameters&        Clouds,
    const WindField& WindField,
    SpatialVector                 AnchorPosition,
    double                        StepSeconds)
{
    const double Dt = std::clamp(StepSeconds, 0.0, 0.25);
    RebuildCloudColumnAliasTable(Clouds, WindField, AnchorPosition);

    double FallSpeedMps = 9.0;
    double TauSec       = 0.5;
    float  NomRadius    = 0.002f;
    CategoryPhysicsConstants(Config_.Category, FallSpeedMps, TauSec, NomRadius);

    const double HalfSpan   = 0.5 * Config_.SpawnVolumeHorizontalM;
    const double DragBlend  = (Dt > 0.0) ? (1.0 - std::exp(-Dt / std::max(0.02, TauSec))) : 0.0;
    const double TimeNow    = WindField.ElapsedSeconds();

    std::uint32_t AliveCount = 0u;
    for (std::uint32_t I = 0u; I < Config_.StrictParticleBudget; ++I)
    {
        WeatherParticleRecord& P = Pool_[I];

        // Retire surplus slots immediately if sky cleared or target budget dropped!
        if (!AliasValid_ || I >= Telemetry_.TargetActiveParticles)
        {
            P.Alive = false;
            continue;
        }

        if (!P.Alive)
        {
            if (RespawnParticleFromCloudAlias(P, WindField, AnchorPosition))
            {
                // Stagger initial altitude on cold-start activation so storm doesn't fall as a flat sheet.
                if (VerifiedSpawnsTotal_ <= Config_.StrictParticleBudget && Config_.Category != FallingParticleCategory::WindborneDebris)
                {
                    P.Position.Z = Config_.GroundElevationM + NextUniform01() * Config_.SpawnCeilingHeightM;
                }
            }
        }

        if (!P.Alive)
        {
            continue;
        }

        if (Dt > 0.0)
        {
            const SpatialVector Wind = WindField.SampleWindVelocity(P.Position);
            double FlutterX = 0.0;
            double FlutterY = 0.0;
            if (Config_.Category == FallingParticleCategory::SnowFlake ||
                Config_.Category == FallingParticleCategory::WindborneDebris)
            {
                const double Phase = static_cast<double>(P.PhaseAngle) + 6.8 * TimeNow;
                FlutterX = 0.65 * std::cos(Phase);
                FlutterY = 0.65 * std::sin(Phase * 1.13);
            }

            const SpatialVector TargetVelocity = {
                Wind.X + FlutterX,
                Wind.Y + FlutterY,
                Wind.Z - FallSpeedMps
            };

            if (Config_.Category == FallingParticleCategory::HailPellet && P.BounceCounter > 0u)
            {
                // During post-impact rebound arc, hail follows ballistic gravity + aerodynamic wind drag!
                P.Velocity.X += (Wind.X - P.Velocity.X) * (0.25 * DragBlend);
                P.Velocity.Y += (Wind.Y - P.Velocity.Y) * (0.25 * DragBlend);
                P.Velocity.Z -= 9.81 * Dt;
            }
            else
            {
                P.Velocity.X += (TargetVelocity.X - P.Velocity.X) * DragBlend;
                P.Velocity.Y += (TargetVelocity.Y - P.Velocity.Y) * DragBlend;
                P.Velocity.Z += (TargetVelocity.Z - P.Velocity.Z) * DragBlend;
            }

            P.Position.X += P.Velocity.X * Dt;
            P.Position.Y += P.Velocity.Y * Dt;
            P.Position.Z += P.Velocity.Z * Dt;

            // Ground plane interaction: Hail pellets rebound up to 2 times; Rain & Snow recycle into overhead clouds!
            if (P.Position.Z <= Config_.GroundElevationM)
            {
                if (Config_.Category == FallingParticleCategory::HailPellet && P.BounceCounter < 2u && std::abs(P.Velocity.Z) > 2.2)
                {
                    P.Position.Z  = Config_.GroundElevationM + 0.01;
                    P.Velocity.Z  = std::abs(P.Velocity.Z) * (0.50 - 0.14 * P.BounceCounter);
                    P.Velocity.X += (NextUniform01() - 0.5) * 2.8;
                    P.Velocity.Y += (NextUniform01() - 0.5) * 2.8;
                    ++P.BounceCounter;
                }
                else if (Config_.Category == FallingParticleCategory::WindborneDebris)
                {
                    P.Position.Z = Config_.GroundElevationM + 0.05;
                    P.Velocity.Z = std::max(0.4, std::abs(P.Velocity.Z) * 0.35);
                }
                else
                {
                    (void)RespawnParticleFromCloudAlias(P, WindField, AnchorPosition);
                }
            }

            // Recycle particles that blow outside the horizontal camera window back under an active cloud column!
            if (std::abs(P.Position.X - AnchorPosition.X) > HalfSpan * 1.15 ||
                std::abs(P.Position.Y - AnchorPosition.Y) > HalfSpan * 1.15 ||
                P.Position.Z > Config_.GroundElevationM + Config_.SpawnCeilingHeightM * 1.25)
            {
                (void)RespawnParticleFromCloudAlias(P, WindField, AnchorPosition);
            }
        }

        if (P.Alive)
        {
            ++AliveCount;
        }
    }

    Telemetry_.StrictParticleBudget      = Config_.StrictParticleBudget;
    Telemetry_.CurrentAliveParticles     = AliveCount;
    Telemetry_.SpawnedUnderCloudFraction = (VerifiedSpawnsTotal_ > 0u)
        ? (static_cast<double>(VerifiedSpawnsCloud_) / static_cast<double>(VerifiedSpawnsTotal_))
        : 1.0;
    return Telemetry_;
}

} // namespace Frontier
