/*==========================================================================================================================================
                                                       PLUMEFLUIDEXTENSION.CPP
==========================================================================================================================================*/
// 🧩 Native C++/Vulkan 3D smoke-and-fire fluid division implementation.

#include "Engine/Fluid/PlumeFluid.h"

#include <algorithm>
#include <cmath>
#include <numbers>

namespace Frontier
{

namespace
{

constexpr float FloorWorldZ           = -0.50f;
constexpr float SpeedCeiling          = 28.0f;
constexpr float SourcePowerOnset      = 200.0f;
constexpr float SourceReleaseRatio    = 0.60f;
constexpr float SourceOnsetSeconds    = 0.05f;
constexpr float SourceReleaseSeconds  = 0.08f;
constexpr float SourcePowerFull       = 18000.0f;
constexpr float MinimumSlipSpeed      = 0.35f;
constexpr float WarmBaseKelvin        = 333.15f;
constexpr float WarmSpanKelvin        = 190.0f;
constexpr float PatchRadiusMetres     = 0.16f;
constexpr float PiConstant            = 3.14159265358979323846f;
constexpr float InversePiConstant     = 0.31830988618379067154f;

[[nodiscard]] inline float ClampScalar(float X, float Low, float High) noexcept
{
    return std::max(Low, std::min(High, X));
}

[[nodiscard]] inline float SmoothStepScalar(float Edge0, float Edge1, float X) noexcept
{
    const float T = ClampScalar((X - Edge0) / std::max(Edge1 - Edge0, 1.0e-5f), 0.0f, 1.0f);
    return T * T * (3.0f - 2.0f * T);
}

[[nodiscard]] inline std::int32_t PositiveModulo(std::int32_t Coordinate, std::int32_t Extent) noexcept
{
    const std::int32_t Remainder = Coordinate % Extent;
    return (Remainder < 0) ? (Remainder + Extent) : Remainder;
}

[[nodiscard]] inline std::uint32_t HashLatticeCell(std::int32_t X, std::int32_t Y, std::int32_t Z) noexcept
{
    std::uint32_t H = static_cast<std::uint32_t>(X) * 374761393u
                    + static_cast<std::uint32_t>(Y) * 668265263u
                    + static_cast<std::uint32_t>(Z) * 2147483647u;
    H = (H ^ (H >> 13u)) * 1274126177u;
    return H ^ (H >> 16u);
}

// Smooth 3D value-gradient noise with optional periodic modulo (Period > 0 reproduces the 32^3 HTML tile).
[[nodiscard]] float SampleSmoothNoise3D(float X, float Y, float Z, std::int32_t Period) noexcept
{
    const float Fx = std::floor(X);
    const float Fy = std::floor(Y);
    const float Fz = std::floor(Z);
    const std::int32_t Ix = static_cast<std::int32_t>(Fx);
    const std::int32_t Iy = static_cast<std::int32_t>(Fy);
    const std::int32_t Iz = static_cast<std::int32_t>(Fz);
    const float Tx = X - Fx;
    const float Ty = Y - Fy;
    const float Tz = Z - Fz;
    const float Ux = Tx * Tx * (3.0f - 2.0f * Tx);
    const float Uy = Ty * Ty * (3.0f - 2.0f * Ty);
    const float Uz = Tz * Tz * (3.0f - 2.0f * Tz);

    auto Corner = [Period](std::int32_t Cx, std::int32_t Cy, std::int32_t Cz) noexcept -> float
    {
        if (Period > 0)
        {
            Cx = PositiveModulo(Cx, Period);
            Cy = PositiveModulo(Cy, Period);
            Cz = PositiveModulo(Cz, Period);
        }
        return static_cast<float>(HashLatticeCell(Cx, Cy, Cz) & 0x00FFFFFFu) * (1.0f / 16777215.0f);
    };

    const float C000 = Corner(Ix,     Iy,     Iz);
    const float C100 = Corner(Ix + 1, Iy,     Iz);
    const float C010 = Corner(Ix,     Iy + 1, Iz);
    const float C110 = Corner(Ix + 1, Iy + 1, Iz);
    const float C001 = Corner(Ix,     Iy,     Iz + 1);
    const float C101 = Corner(Ix + 1, Iy,     Iz + 1);
    const float C011 = Corner(Ix,     Iy + 1, Iz + 1);
    const float C111 = Corner(Ix + 1, Iy + 1, Iz + 1);

    const float C00 = C000 + (C100 - C000) * Ux;
    const float C10 = C010 + (C110 - C010) * Ux;
    const float C01 = C001 + (C101 - C001) * Ux;
    const float C11 = C011 + (C111 - C011) * Ux;
    const float C0  = C00  + (C10  - C00)  * Uy;
    const float C1  = C01  + (C11  - C01)  * Uy;
    return C0 + (C1 - C0) * Uz;
}

[[nodiscard]] inline float EvaluateHenyeyGreenstein(float Cosine, float G) noexcept
{
    const float G2    = G * G;
    const float Denom = std::max(1.0f + G2 - 2.0f * G * Cosine, 1.0e-4f);
    return (1.0f - G2) / (4.0f * PiConstant * Denom * std::sqrt(Denom));
}

[[nodiscard]] inline float EvaluateDualLobeSmokePhase(float Cosine, float Anisotropy) noexcept
{
    const float Forward  = EvaluateHenyeyGreenstein(Cosine, Anisotropy);
    const float Backward = EvaluateHenyeyGreenstein(Cosine, -0.65f * Anisotropy);
    return Backward + 0.72f * (Forward - Backward);
}

void GradeDimensions(
    PlumeQualityGrade             Grade,
    std::array<std::uint32_t, 3>& OutThermoExtent,
    float&                        OutFineCellMetres) noexcept
{
    switch (Grade)
    {
        case PlumeQualityGrade::Low:
            OutThermoExtent   = { 64u, 64u, 20u };
            OutFineCellMetres = 0.40f;
            break;
        case PlumeQualityGrade::Medium:
            OutThermoExtent   = { 96u, 96u, 24u };
            OutFineCellMetres = 0.30f;
            break;
        case PlumeQualityGrade::Ultra:
            OutThermoExtent   = { 160u, 160u, 48u };
            OutFineCellMetres = 0.20f;
            break;
        case PlumeQualityGrade::High:
        default:
            OutThermoExtent   = { 128u, 128u, 32u };
            OutFineCellMetres = 0.25f;
            break;
    }
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                              CONSTRUCTION & CONFIGURATION
//------------------------------------------------------------------------------------------------------------------------

PlumeFluid::PlumeFluid(const PlumeFluidParameters& Parameters)
{
    Reconfigure(Parameters);
}

void PlumeFluid::Reconfigure(const PlumeFluidParameters& Parameters)
{
    Parameters_ = Parameters;
    GradeDimensions(Parameters_.Grade, ThermoExtent_, FineCellMetres_);
    VelocityExtent_   = { ThermoExtent_[0] / 2u, ThermoExtent_[1] / 2u, ThermoExtent_[2] / 2u };
    CoarseCellMetres_ = 2.0f * FineCellMetres_;

    const std::size_t CoarseCount = static_cast<std::size_t>(VelocityExtent_[0]) * VelocityExtent_[1] * VelocityExtent_[2];
    const std::size_t FineCount   = static_cast<std::size_t>(ThermoExtent_[0]) * ThermoExtent_[1] * ThermoExtent_[2];

    VelocityCurrent_.assign(CoarseCount * 4u, 0.0f);
    VelocityScratch_.assign(CoarseCount * 4u, 0.0f);
    CurlField_.assign(CoarseCount * 4u, 0.0f);
    DivergenceField_.assign(CoarseCount, 0.0f);
    PressureCurrent_.assign(CoarseCount, 0.0f);
    PressureScratch_.assign(CoarseCount, 0.0f);
    ThermoCurrent_.assign(FineCount * 4u, 0.0f);
    ThermoScratch_.assign(FineCount * 4u, 0.0f);
    ThermoBackward_.assign(FineCount * 4u, 0.0f);
    LightTransmittance_.assign(CoarseCount * 2u, 1.0f);
    FaceFluxScratch_.assign(CoarseCount * 4u, 0.0f);
    MacroBrickExtent_ = {
        (ThermoExtent_[0] + 7u) / 8u,
        (ThermoExtent_[1] + 7u) / 8u,
        (ThermoExtent_[2] + 7u) / 8u
    };
    MacroOccupancy_.assign(
        static_cast<std::size_t>(MacroBrickExtent_[0]) * MacroBrickExtent_[1] * MacroBrickExtent_[2],
        0u);

    ClearState();
}

void PlumeFluid::UpdatePhysicalParameters(const PlumeFluidParameters& Parameters)
{
    if (ThermoCurrent_.empty() || VelocityCurrent_.empty() || Parameters.Grade != Parameters_.Grade)
    {
        Reconfigure(Parameters);
        return;
    }
    Parameters_ = Parameters;
}

void PlumeFluid::ClearState() noexcept
{
    std::fill(VelocityCurrent_.begin(), VelocityCurrent_.end(), 0.0f);
    std::fill(VelocityScratch_.begin(), VelocityScratch_.end(), 0.0f);
    std::fill(CurlField_.begin(), CurlField_.end(), 0.0f);
    std::fill(DivergenceField_.begin(), DivergenceField_.end(), 0.0f);
    std::fill(PressureCurrent_.begin(), PressureCurrent_.end(), 0.0f);
    std::fill(PressureScratch_.begin(), PressureScratch_.end(), 0.0f);
    std::fill(ThermoCurrent_.begin(), ThermoCurrent_.end(), 0.0f);
    std::fill(ThermoScratch_.begin(), ThermoScratch_.end(), 0.0f);
    std::fill(ThermoBackward_.begin(), ThermoBackward_.end(), 0.0f);
    std::fill(LightTransmittance_.begin(), LightTransmittance_.end(), 1.0f);
    std::fill(FaceFluxScratch_.begin(), FaceFluxScratch_.end(), 0.0f);
    std::fill(MacroOccupancy_.begin(), MacroOccupancy_.end(), 0u);

    OriginXY_       = { 0, 0 };
    PriorOriginXY_  = { 1 << 20, 1 << 20 };
    ElapsedSeconds_ = 0.0f;
    Relocations_    = 0u;
    WheelOnsets_    = {};
    Sources_.clear();
    Obstacles_.clear();
    FireLights_     = {};
    Diagnostics_    = {};
    CoverageLow_    = { 1, 1, 1 };
    CoverageHigh_   = { 0, 0, 0 };
}

void PlumeFluid::ClearSolidObstacles() noexcept
{
    Obstacles_.clear();
}

void PlumeFluid::RegisterSolidObstacle(const PlumeSolidObstacleBox& Obstacle) noexcept
{
    if (Obstacles_.size() < ObstacleLimit)
    {
        Obstacles_.push_back(Obstacle);
    }
}

bool PlumeFluid::PointInsideSolidObstacles(
    float Px, float Py, float Pz,
    std::array<float, 3>* OutNearWakeVelocity,
    float*                OutWakeBlend) const noexcept
{
    if (OutWakeBlend)
    {
        *OutWakeBlend = 0.0f;
    }
    if (Obstacles_.empty())
    {
        return false;
    }
    for (const PlumeSolidObstacleBox& Box : Obstacles_)
    {
        const float Dx  = Px - Box.Centre[0];
        const float Dy  = Py - Box.Centre[1];
        const float Dz  = Pz - Box.Centre[2];
        const float Cos = std::cos(-Box.YawRadians);
        const float Sin = std::sin(-Box.YawRadians);
        const float Lx  = std::abs(Dx * Cos - Dy * Sin);
        const float Ly  = std::abs(Dx * Sin + Dy * Cos);
        const float Lz  = std::abs(Dz);
        if (Lx <= Box.HalfExtents[0] && Ly <= Box.HalfExtents[1] && Lz <= Box.HalfExtents[2])
        {
            return true;
        }
        // Moving-solid boundary-layer drag shell (e.g. driving vehicle deflecting & entraining smoke!).
        if (OutNearWakeVelocity != nullptr && OutWakeBlend != nullptr)
        {
            const float SpeedSq = Box.LinearVelocity[0] * Box.LinearVelocity[0] +
                                  Box.LinearVelocity[1] * Box.LinearVelocity[1] +
                                  Box.LinearVelocity[2] * Box.LinearVelocity[2];
            if (SpeedSq > 0.04f)
            {
                const float Ex = std::max(0.0f, Lx - Box.HalfExtents[0]);
                const float Ey = std::max(0.0f, Ly - Box.HalfExtents[1]);
                const float Ez = std::max(0.0f, Lz - Box.HalfExtents[2]);
                const float ShellDistSq = Ex * Ex + Ey * Ey + Ez * Ez;
                const float ShellReach  = 1.15f * CoarseCellMetres_;
                if (ShellDistSq < ShellReach * ShellReach)
                {
                    const float Blend = 1.0f - std::sqrt(ShellDistSq) / ShellReach;
                    if (Blend > *OutWakeBlend)
                    {
                        *OutWakeBlend        = Blend;
                        *OutNearWakeVelocity = Box.LinearVelocity;
                    }
                }
            }
        }
    }
    return false;
}

//------------------------------------------------------------------------------------------------------------------------
//                                           BLACKBODY & APERIODIC DETAIL OPTICS
//------------------------------------------------------------------------------------------------------------------------

std::array<float, 3> PlumeFluid::EvaluateBlackbodyRadiance(float Kelvin) noexcept
{
    const float T = ClampScalar(Kelvin, 700.0f, 5500.0f);
    // Physically calibrated Planckian chromaticity + T^4 Stefan-Boltzmann scaling normalised at 1500 K.
    const float H = T * 0.01f;
    const float Red = 1.0f;
    const float Green = ClampScalar(0.39008158f * std::log(std::max(H, 1.0f)) - 0.63184144f, 0.0f, 1.0f);
    const float Blue  = (H <= 19.0f)
        ? 0.0f
        : ClampScalar(0.54320679f * std::log(std::max(H - 10.0f, 1.0f)) - 1.19625409f, 0.0f, 1.0f);
    // Linearise sRGB chromaticity and apply compressed perceptual-HDR thermal power.
    const float LinR  = std::pow(Red,   2.2f);
    const float LinG  = std::pow(Green, 2.2f);
    const float LinB  = std::pow(Blue,  2.2f);
    const float Ratio = T / 1550.0f;
    const float Power = Ratio * Ratio * Ratio * std::sqrt(Ratio);
    return { LinR * Power, LinG * Power, LinB * Power };
}

float PlumeFluid::EvaluateDetailFieldSample(
    const std::array<float, 3>& WorldPosition,
    const std::array<float, 3>& LocalVelocity,
    float                       ElapsedSeconds,
    float                       DetailFrequency,
    float                       FlowWarpStrength,
    PlumeSolverVariant          Variant) noexcept
{
    if (Variant == PlumeSolverVariant::LegacyHtmlReference)
    {
        // Reproduces the exact HTML PlumeMarch.wgsl 32^3 axis-aligned repeating tile defect.
        const float Cx = (WorldPosition[0] - 0.25f * ElapsedSeconds) * DetailFrequency * 32.0f * (1.0f / 32.0f) * 8.0f;
        const float Cy = (WorldPosition[1] - 0.14f * ElapsedSeconds) * DetailFrequency * 8.0f;
        const float Cz = (WorldPosition[2] - 0.55f * ElapsedSeconds) * DetailFrequency * 8.0f;
        const float N0 = SampleSmoothNoise3D(Cx,        Cy,        Cz,        32);
        const float N1 = SampleSmoothNoise3D(Cx * 2.0f, Cy * 2.0f, Cz * 2.0f, 32);
        const float N2 = SampleSmoothNoise3D(Cx * 4.0f, Cy * 4.0f, Cz * 4.0f, 32);
        return 0.50f * N0 + 0.30f * N1 + 0.20f * N2;
    }

    // Production aperiodic detail:
    // 1) Dual-phase Lagrangian flow-advected domain warp (breaks stationary grid locking).
    // 2) Three incommensurate SO(3) golden-ratio-rotated octaves (zero rational 3D lattice period).
    const float PhaseA = ElapsedSeconds - std::floor(ElapsedSeconds);
    const float PhaseB = std::fmod(PhaseA + 0.5f, 1.0f);
    const float WeightA = 0.5f - 0.5f * std::cos(2.0f * PiConstant * PhaseA);

    auto EvalWarped = [&](float Phase) noexcept -> float
    {
        const float Wx = WorldPosition[0] - LocalVelocity[0] * FlowWarpStrength * Phase - 0.28f * ElapsedSeconds;
        const float Wy = WorldPosition[1] - LocalVelocity[1] * FlowWarpStrength * Phase - 0.17f * ElapsedSeconds;
        const float Wz = WorldPosition[2] - LocalVelocity[2] * FlowWarpStrength * Phase - 0.52f * ElapsedSeconds;

        const float Qx = Wx * DetailFrequency * 3.1f;
        const float Qy = Wy * DetailFrequency * 3.1f;
        const float Qz = Wz * DetailFrequency * 3.1f;

        // Octave 0: unrotated non-periodic base
        const float O0 = SampleSmoothNoise3D(Qx, Qy, Qz, 0);

        // Octave 1: SO(3) irrational rotation + golden frequency phi = 1.61803399
        constexpr float Phi1 = 1.61803399f;
        const float R1x = Phi1 * ( 0.809017f * Qx + 0.500000f * Qy - 0.309017f * Qz) + 17.31f;
        const float R1y = Phi1 * (-0.309017f * Qx + 0.809017f * Qy + 0.500000f * Qz) - 29.73f;
        const float R1z = Phi1 * ( 0.500000f * Qx - 0.309017f * Qy + 0.809017f * Qz) + 41.19f;
        const float O1  = SampleSmoothNoise3D(R1x, R1y, R1z, 0);

        // Octave 2: orthogonal irrational rotation + frequency phi^2 = 2.61803399 + billow fold
        constexpr float Phi2 = 2.61803399f;
        const float R2x = Phi2 * ( 0.309017f * Qx - 0.809017f * Qy + 0.500000f * Qz) - 53.07f;
        const float R2y = Phi2 * ( 0.500000f * Qx + 0.309017f * Qy + 0.809017f * Qz) + 11.89f;
        const float R2z = Phi2 * (-0.809017f * Qx - 0.500000f * Qy + 0.309017f * Qz) - 37.41f;
        const float O2  = 1.0f - std::fabs(2.0f * SampleSmoothNoise3D(R2x, R2y, R2z, 0) - 1.0f);

        return 0.52f * O0 + 0.31f * O1 + 0.17f * O2;
    };

    const float WarpDispSq = FlowWarpStrength * FlowWarpStrength *
                             (LocalVelocity[0] * LocalVelocity[0] +
                              LocalVelocity[1] * LocalVelocity[1] +
                              LocalVelocity[2] * LocalVelocity[2]);
    if (WarpDispSq < 1.0e-5f)
    {
        return EvalWarped(PhaseA);
    }
    const float SampleA = EvalWarped(PhaseA);
    const float SampleB = EvalWarped(PhaseB);
    return SampleB + WeightA * (SampleA - SampleB);
}

//------------------------------------------------------------------------------------------------------------------------
//                                              VEHICLE TELEMETRY INTAKE
//------------------------------------------------------------------------------------------------------------------------

void PlumeFluid::IngestVehicleTelemetry(
    const std::array<float, 3>&               VehiclePosition,
    const std::array<PlumeWheelTelemetry, 4>& Wheels,
    float                                     StepSeconds) noexcept
{
    (void)VehiclePosition;
    Sources_.clear();
    FireLights_ = {};
    const float Dt = std::max(StepSeconds, 1.0e-4f);

    for (std::size_t W = 0u; W < 4u; ++W)
    {
        const PlumeWheelTelemetry& Wheel = Wheels[W];
        WheelOnsetEnvelope&        Onset = WheelOnsets_[W];

        const bool SlipEligible = Wheel.Grounded && !Wheel.Shredded &&
                                  (std::fabs(Wheel.SurfaceSlipSpeed) >= MinimumSlipSpeed || Wheel.SlidingPowerWatts >= SourcePowerOnset);

        if (SlipEligible && Wheel.SlidingPowerWatts >= SourcePowerOnset)
        {
            Onset.RequestSeconds += Dt;
            Onset.QuietSeconds    = 0.0f;
            if (Onset.RequestSeconds >= SourceOnsetSeconds)
            {
                Onset.Active = true;
            }
        }
        else if (Wheel.SlidingPowerWatts < SourcePowerOnset * SourceReleaseRatio || !Wheel.Grounded || Wheel.Shredded)
        {
            Onset.QuietSeconds   += Dt;
            Onset.RequestSeconds  = 0.0f;
            if (Onset.QuietSeconds >= SourceReleaseSeconds)
            {
                Onset.Active = false;
            }
        }

        if (Onset.Active && Sources_.size() < SourceLimit)
        {
            const float PowerNorm = ClampScalar((Wheel.SlidingPowerWatts - SourcePowerOnset) / (SourcePowerFull - SourcePowerOnset), 0.05f, 1.8f);
            const float Warmth    = ClampScalar((Wheel.TreadKelvin - WarmBaseKelvin) / WarmSpanKelvin, 0.12f, 1.25f);
            const float SmokeRate = 18.0f * PowerNorm * Warmth * Parameters_.SourceRateScale * Parameters_.SmokeDensityScale;
            const float HeatRate  = (8.0f + 0.0018f * Wheel.SlidingPowerWatts) * Parameters_.HeatScale;

            // Spinning tread throws rubber vapour rearward along the contact tangent.
            const float FlingSpeed = ClampScalar(-0.35f * Wheel.SurfaceSlipSpeed, -9.0f, 9.0f);
            const std::array<float, 3> PatchVelocity = {
                Wheel.LongitudinalAxis[0] * FlingSpeed,
                Wheel.LongitudinalAxis[1] * FlingSpeed,
                0.65f
            };
            AppendTransientPlumeSource(
                { Wheel.ContactPoint[0], Wheel.ContactPoint[1], Wheel.ContactPoint[2] + 0.08f },
                PatchRadiusMetres,
                PatchVelocity,
                SmokeRate * 0.68f,
                HeatRate,
                0.0f,
                0.0f);

            // Wheel-arch shedding source behind and above hub.
            const std::array<float, 3> ArchPosition = {
                Wheel.HubPosition[0] - Wheel.LongitudinalAxis[0] * (0.65f * Wheel.WheelRadius),
                Wheel.HubPosition[1] - Wheel.LongitudinalAxis[1] * (0.65f * Wheel.WheelRadius),
                Wheel.HubPosition[2] + 0.35f * Wheel.WheelRadius
            };
            AppendTransientPlumeSource(
                ArchPosition,
                0.22f,
                { PatchVelocity[0] * 0.55f, PatchVelocity[1] * 0.55f, 1.15f },
                SmokeRate * 0.32f,
                HeatRate * 0.45f,
                0.0f,
                0.0f);
        }

        if (Wheel.Ignited && !Wheel.Shredded && Wheel.CombustionWatts > 50.0f)
        {
            const float FireNorm  = ClampScalar(Wheel.CombustionWatts / 25000.0f, 0.25f, 2.5f);
            const float FlameRate = 9.5f * FireNorm * Parameters_.SourceRateScale;
            const float SootRate  = 11.0f * FireNorm * Parameters_.SootScale;
            const float FireHeat  = 58.0f * FireNorm * Parameters_.HeatScale;

            for (float Side : { -1.0f, 1.0f })
            {
                const std::array<float, 3> Seat = {
                    Wheel.HubPosition[0] - 0.12f * Wheel.LongitudinalAxis[0] + Side * 0.22f * Wheel.LateralAxis[0],
                    Wheel.HubPosition[1] - 0.12f * Wheel.LongitudinalAxis[1] + Side * 0.22f * Wheel.LateralAxis[1],
                    Wheel.ContactPoint[2] + 0.22f
                };
                AppendTransientPlumeSource(
                    Seat,
                    0.19f,
                    { 0.0f, 0.0f, 2.60f },
                    0.8f * FireNorm,
                    FireHeat,
                    FlameRate,
                    SootRate);
            }

            const std::uint32_t LightIdx = FireLights_.Count[0];
            if (LightIdx < 4u)
            {
                const float Gain = 0.00045f * Wheel.CombustionWatts;
                FireLights_.PositionRadius[LightIdx] = {
                    Wheel.HubPosition[0],
                    Wheel.HubPosition[1],
                    Wheel.ContactPoint[2] + 0.35f,
                    0.45f
                };
                FireLights_.Radiance[LightIdx] = { 1.00f * Gain, 0.46f * Gain, 0.14f * Gain, 0.0f };
                FireLights_.Count[0] = LightIdx + 1u;
            }
        }
    }
}

void PlumeFluid::AppendTransientPlumeSource(
    const std::array<float, 3>& Position,
    float                       Radius,
    const std::array<float, 3>& Velocity,
    float                       SmokeRate,
    float                       HeatRate,
    float                       FlameRate,
    float                       SootRate) noexcept
{
    if (Sources_.size() >= SourceLimit)
    {
        return;
    }
    PlumeSourceFootprint Src{};
    Src.PositionRadius = { Position[0], Position[1], Position[2], std::max(Radius, 0.05f) };
    Src.Velocity       = { Velocity[0], Velocity[1], Velocity[2], 0.0f };
    Src.Rates          = { std::max(SmokeRate, 0.0f), std::max(HeatRate, 0.0f), std::max(FlameRate, 0.0f), std::max(SootRate, 0.0f) };
    Sources_.push_back(Src);

    // Register transient fire/pyro point light so surrounding smoke billows & nearby terrain receive internal fire glow!
    if (FlameRate > 0.20f && FireLights_.Count[0] < 4u)
    {
        const std::uint32_t LightIdx = FireLights_.Count[0];
        const float Gain = std::min(48.0f, 3.2f * FlameRate + 0.018f * HeatRate);
        FireLights_.PositionRadius[LightIdx] = { Position[0], Position[1], Position[2] + 0.30f * Radius, std::max(0.40f, 0.65f * Radius) };
        FireLights_.Radiance[LightIdx]       = { 1.00f * Gain, 0.48f * Gain, 0.14f * Gain, 0.0f };
        FireLights_.Count[0]                 = LightIdx + 1u;
    }
}

void PlumeFluid::InjectDetonationBlast(
    const std::array<float, 3>& BlastCentreWorld,
    float                       BlastRadiusMetres,
    float                       ShockSpeedMps,
    float                       CoreSuperheatKelvin,
    float                       CoreFlameProgress,
    float                       OuterSootDensity) noexcept
{
    const float Radius = std::max(0.35f, BlastRadiusMetres);
    const std::int32_t Vx = static_cast<std::int32_t>(VelocityExtent_[0]);
    const std::int32_t Vy = static_cast<std::int32_t>(VelocityExtent_[1]);
    const std::int32_t Vz = static_cast<std::int32_t>(VelocityExtent_[2]);
    const std::int32_t Tx = static_cast<std::int32_t>(ThermoExtent_[0]);
    const std::int32_t Ty = static_cast<std::int32_t>(ThermoExtent_[1]);
    const std::int32_t Tz = static_cast<std::int32_t>(ThermoExtent_[2]);

    // Ensure toroidal window is anchored near blast if uninitialized
    if (PriorOriginXY_[0] > (1 << 18))
    {
        OriginXY_ = {
            static_cast<std::int32_t>(std::floor(BlastCentreWorld[0] / CoarseCellMetres_)) - Vx / 2,
            static_cast<std::int32_t>(std::floor(BlastCentreWorld[1] / CoarseCellMetres_)) - Vy / 2};
        PriorOriginXY_ = OriginXY_;
    }

    const float WorldMinX = static_cast<float>(OriginXY_[0]) * CoarseCellMetres_;
    const float WorldMinY = static_cast<float>(OriginXY_[1]) * CoarseCellMetres_;

    // 1. Outward spherical + upward buoyant shockwave velocity impulse (Experimental/Fluid blastActive)
    for (std::int32_t Z = 0; Z < Vz; ++Z)
    {
        const float Pz = FloorWorldZ + (static_cast<float>(Z) + 0.5f) * CoarseCellMetres_;
        for (std::int32_t Y = 0; Y < Vy; ++Y)
        {
            const float Py = WorldMinY + (static_cast<float>(Y) + 0.5f) * CoarseCellMetres_;
            for (std::int32_t X = 0; X < Vx; ++X)
            {
                const float Px = WorldMinX + (static_cast<float>(X) + 0.5f) * CoarseCellMetres_;
                const float Dx = Px - BlastCentreWorld[0];
                const float Dy = Py - BlastCentreWorld[1];
                const float Dz = Pz - BlastCentreWorld[2];
                const float Dist = std::sqrt(Dx * Dx + Dy * Dy + Dz * Dz);
                if (Dist > Radius * 1.45f)
                {
                    continue;
                }
                const std::size_t I4 = ((static_cast<std::size_t>(Z) * static_cast<std::size_t>(Vy) +
                                         static_cast<std::size_t>(Y)) * static_cast<std::size_t>(Vx) +
                                         static_cast<std::size_t>(X)) * 4u;
                if (VelocityCurrent_[I4 + 3u] > 0.5f)
                {
                    continue;
                }
                const float InvD = 1.0f / std::max(Dist, 0.12f);
                const float RadialEnv = std::exp(-1.65f * (Dist * Dist) / (Radius * Radius));
                const float Lobe = 0.72f + 0.56f * EvaluateDetailFieldSample(
                    {Px, Py, Pz}, {0.0f, 0.0f, 0.0f}, ElapsedSeconds_ + 1.7f, 1.35f, 0.0f, Parameters_.Variant);
                const float Speed = ShockSpeedMps * RadialEnv * Lobe;
                VelocityCurrent_[I4 + 0u] += (Dx * InvD) * Speed;
                VelocityCurrent_[I4 + 1u] += (Dy * InvD) * Speed;
                VelocityCurrent_[I4 + 2u] += std::max(-0.2f * Speed, (Dz * InvD) * Speed + 0.42f * ShockSpeedMps * RadialEnv);
            }
        }
    }

    // 2. Multi-lobed incandescent fireball core + rolling dark outer soot shell + bright white-grey vapour cap
    for (std::int32_t Z = 0; Z < Tz; ++Z)
    {
        const float Pz = FloorWorldZ + (static_cast<float>(Z) + 0.5f) * FineCellMetres_;
        for (std::int32_t Y = 0; Y < Ty; ++Y)
        {
            const float Py = WorldMinY + (static_cast<float>(Y) + 0.5f) * FineCellMetres_;
            for (std::int32_t X = 0; X < Tx; ++X)
            {
                const float Px = WorldMinX + (static_cast<float>(X) + 0.5f) * FineCellMetres_;
                const float Dx = Px - BlastCentreWorld[0];
                const float Dy = Py - BlastCentreWorld[1];
                const float Dz = (Pz - BlastCentreWorld[2]) * 0.88f;
                const float RNorm = std::sqrt(Dx * Dx + Dy * Dy + Dz * Dz) / Radius;
                if (RNorm > 1.35f)
                {
                    continue;
                }
                const float Turb = EvaluateDetailFieldSample(
                    {Px * 1.4f, Py * 1.4f, Pz * 1.4f}, {0.0f, 0.0f, 0.0f}, ElapsedSeconds_ + 0.5f, 1.65f, 0.0f, Parameters_.Variant);
                const float WarpedR = RNorm + (Turb - 0.5f) * 0.42f;
                if (WarpedR > 1.08f)
                {
                    continue;
                }

                const float CoreWeight  = std::max(0.0f, 1.0f - WarpedR / 0.78f);
                const float ShellWeight = std::exp(-5.5f * (WarpedR - 0.72f) * (WarpedR - 0.72f));
                const float VapourWeight = std::exp(-3.2f * (WarpedR - 0.88f) * (WarpedR - 0.88f));

                const std::size_t T4 = ((static_cast<std::size_t>(Z) * static_cast<std::size_t>(Ty) +
                                         static_cast<std::size_t>(Y)) * static_cast<std::size_t>(Tx) +
                                         static_cast<std::size_t>(X)) * 4u;
                ThermoCurrent_[T4 + 0u] = std::max(ThermoCurrent_[T4 + 0u], 0.05f * OuterSootDensity * VapourWeight);
                ThermoCurrent_[T4 + 1u] = std::max(ThermoCurrent_[T4 + 1u], CoreSuperheatKelvin * (0.38f * ShellWeight + CoreWeight));
                ThermoCurrent_[T4 + 2u] = std::max(ThermoCurrent_[T4 + 2u], CoreFlameProgress * std::pow(CoreWeight, 0.70f));
                ThermoCurrent_[T4 + 3u] = std::max(ThermoCurrent_[T4 + 3u], OuterSootDensity * (0.70f * ShellWeight + 0.95f * VapourWeight));

                CoverageLow_[0]  = std::min(CoverageLow_[0], X);
                CoverageLow_[1]  = std::min(CoverageLow_[1], Y);
                CoverageLow_[2]  = std::min(CoverageLow_[2], Z);
                CoverageHigh_[0] = std::max(CoverageHigh_[0], X);
                CoverageHigh_[1] = std::max(CoverageHigh_[1], Y);
                CoverageHigh_[2] = std::max(CoverageHigh_[2], Z);
                const std::size_t BIdx = ((static_cast<std::size_t>(Z / 8) * MacroBrickExtent_[1] +
                                           static_cast<std::size_t>(Y / 8)) * MacroBrickExtent_[0] +
                                          static_cast<std::size_t>(X / 8));
                if (BIdx < MacroOccupancy_.size())
                {
                    MacroOccupancy_[BIdx] = 1u;
                }
            }
        }
    }

    if (FireLights_.Count[0] < 4u)
    {
        const std::uint32_t LightIdx = FireLights_.Count[0];
        const float BlastLum = 36.0f * CoreFlameProgress * Radius;
        FireLights_.PositionRadius[LightIdx] = { BlastCentreWorld[0], BlastCentreWorld[1], BlastCentreWorld[2], 0.55f * Radius };
        FireLights_.Radiance[LightIdx]       = { 1.00f * BlastLum, 0.54f * BlastLum, 0.18f * BlastLum, 0.0f };
        FireLights_.Count[0]                 = LightIdx + 1u;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                              SIMULATION TRANSPORT & PRESSURE
//------------------------------------------------------------------------------------------------------------------------

void PlumeFluid::InjectVelocityFieldForTesting(const std::vector<float>& VelocityRgba)
{
    if (VelocityRgba.size() == VelocityCurrent_.size())
    {
        VelocityCurrent_ = VelocityRgba;
    }
}

void PlumeFluid::ProjectPressureOnlyForTesting(PlumeDiagnostics& OutMetrics)
{
    const std::int32_t Nx = static_cast<std::int32_t>(VelocityExtent_[0]);
    const std::int32_t Ny = static_cast<std::int32_t>(VelocityExtent_[1]);
    const std::int32_t Nz = static_cast<std::int32_t>(VelocityExtent_[2]);
    const float H = CoarseCellMetres_;

    auto CellIndex = [Nx, Ny](std::int32_t X, std::int32_t Y, std::int32_t Z) noexcept -> std::size_t
    {
        return (static_cast<std::size_t>(Z) * static_cast<std::size_t>(Ny) + static_cast<std::size_t>(Y)) *
                   static_cast<std::size_t>(Nx) +
               static_cast<std::size_t>(X);
    };
    auto LoadVel = [&](std::int32_t X, std::int32_t Y, std::int32_t Z) noexcept -> std::array<float, 4>
    {
        const std::int32_t Cx = std::max(0, std::min(Nx - 1, X));
        const std::int32_t Cy = std::max(0, std::min(Ny - 1, Y));
        const std::int32_t Cz = std::max(0, std::min(Nz - 1, Z));
        const std::size_t  I4 = CellIndex(Cx, Cy, Cz) * 4u;
        return { VelocityCurrent_[I4 + 0u], VelocityCurrent_[I4 + 1u], VelocityCurrent_[I4 + 2u], VelocityCurrent_[I4 + 3u] };
    };

    auto MeasureCollocatedFaceFluxDivRms = [&]() noexcept -> float
    {
        // Measures true cell-control-volume face-flux divergence (and near-grid checkerboard residual).
        double SumSq = 0.0;
        std::size_t FluidCells = 0u;
        for (std::int32_t Z = 1; Z < Nz - 1; ++Z)
        {
            for (std::int32_t Y = 1; Y < Ny - 1; ++Y)
            {
                for (std::int32_t X = 1; X < Nx - 1; ++X)
                {
                    const auto C = LoadVel(X, Y, Z);
                    if (C[3] > 0.5f)
                    {
                        continue;
                    }
                    const float FaceXp = 0.5f * (C[0] + LoadVel(X + 1, Y, Z)[0]);
                    const float FaceXm = 0.5f * (LoadVel(X - 1, Y, Z)[0] + C[0]);
                    const float FaceYp = 0.5f * (C[1] + LoadVel(X, Y + 1, Z)[1]);
                    const float FaceYm = 0.5f * (LoadVel(X, Y - 1, Z)[1] + C[1]);
                    const float FaceZp = 0.5f * (C[2] + LoadVel(X, Y, Z + 1)[2]);
                    const float FaceZm = 0.5f * (LoadVel(X, Y, Z - 1)[2] + C[2]);
                    // Also capture high-k mode oscillation: ||u_{i+1} - 2 u_i + u_{i-1}|| / (4h)
                    const float CheckerX = (LoadVel(X + 1, Y, Z)[0] - 2.0f * C[0] + LoadVel(X - 1, Y, Z)[0]) / (4.0f * H);
                    const float CheckerY = (LoadVel(X, Y + 1, Z)[1] - 2.0f * C[1] + LoadVel(X, Y - 1, Z)[1]) / (4.0f * H);
                    const float CheckerZ = (LoadVel(X, Y, Z + 1)[2] - 2.0f * C[2] + LoadVel(X, Y, Z - 1)[2]) / (4.0f * H);
                    const float Div = ((FaceXp - FaceXm) + (FaceYp - FaceYm) + (FaceZp - FaceZm)) / H;
                    SumSq += static_cast<double>(Div * Div + CheckerX * CheckerX + CheckerY * CheckerY + CheckerZ * CheckerZ);
                    ++FluidCells;
                }
            }
        }
        return (FluidCells > 0u) ? static_cast<float>(std::sqrt(SumSq / static_cast<double>(FluidCells))) : 0.0f;
    };

    OutMetrics.RmsDivergenceBefore = MeasureCollocatedFaceFluxDivRms();

    if (Parameters_.Variant == PlumeSolverVariant::LegacyHtmlReference)
    {
        // Legacy HTML PlumePressure.wgsl: centred 2h divergence + 6-point 1h Laplacian + centred 2h gradient.
        for (std::int32_t Z = 0; Z < Nz; ++Z)
        {
            for (std::int32_t Y = 0; Y < Ny; ++Y)
            {
                for (std::int32_t X = 0; X < Nx; ++X)
                {
                    const auto Own = LoadVel(X, Y, Z);
                    const float Flux = (LoadVel(X + 1, Y, Z)[0] - LoadVel(X - 1, Y, Z)[0]) +
                                       (LoadVel(X, Y + 1, Z)[1] - LoadVel(X, Y - 1, Z)[1]) +
                                       (LoadVel(X, Y, Z + 1)[2] - LoadVel(X, Y, Z - 1)[2]);
                    DivergenceField_[CellIndex(X, Y, Z)] = (Own[3] > 0.5f) ? 0.0f : (0.5f * Flux / H);
                }
            }
        }
        auto NeighbourP = [&](std::int32_t X, std::int32_t Y, std::int32_t Z, float Centre) noexcept -> float
        {
            if (Z < 0) return Centre;
            if (X < 0 || X >= Nx || Y < 0 || Y >= Ny || Z >= Nz) return 0.0f;
            if (LoadVel(X, Y, Z)[3] > 0.5f) return Centre;
            return PressureCurrent_[CellIndex(X, Y, Z)];
        };
        for (std::uint32_t Sweep = 0u; Sweep < Parameters_.PressureSweeps; ++Sweep)
        {
            for (std::int32_t Z = 0; Z < Nz; ++Z)
            {
                for (std::int32_t Y = 0; Y < Ny; ++Y)
                {
                    for (std::int32_t X = 0; X < Nx; ++X)
                    {
                        const std::size_t Idx = CellIndex(X, Y, Z);
                        const float C = PressureCurrent_[Idx];
                        if (LoadVel(X, Y, Z)[3] > 0.5f)
                        {
                            PressureScratch_[Idx] = C;
                            continue;
                        }
                        const float Sum = NeighbourP(X + 1, Y, Z, C) + NeighbourP(X - 1, Y, Z, C) +
                                          NeighbourP(X, Y + 1, Z, C) + NeighbourP(X, Y - 1, Z, C) +
                                          NeighbourP(X, Y, Z + 1, C) + NeighbourP(X, Y, Z - 1, C);
                        PressureScratch_[Idx] = (Sum - DivergenceField_[Idx] * H * H) * (1.0f / 6.0f);
                    }
                }
            }
            PressureCurrent_.swap(PressureScratch_);
        }
        for (std::int32_t Z = 0; Z < Nz; ++Z)
        {
            for (std::int32_t Y = 0; Y < Ny; ++Y)
            {
                for (std::int32_t X = 0; X < Nx; ++X)
                {
                    const std::size_t Idx = CellIndex(X, Y, Z);
                    const auto Own = LoadVel(X, Y, Z);
                    if (Own[3] > 0.5f) continue;
                    const float C = PressureCurrent_[Idx];
                    const float Gx = 0.5f * (NeighbourP(X + 1, Y, Z, C) - NeighbourP(X - 1, Y, Z, C)) / H;
                    const float Gy = 0.5f * (NeighbourP(X, Y + 1, Z, C) - NeighbourP(X, Y - 1, Z, C)) / H;
                    const float Gz = 0.5f * (NeighbourP(X, Y, Z + 1, C) - NeighbourP(X, Y, Z - 1, C)) / H;
                    VelocityCurrent_[Idx * 4u + 0u] = Own[0] - Gx;
                    VelocityCurrent_[Idx * 4u + 1u] = Own[1] - Gy;
                    VelocityCurrent_[Idx * 4u + 2u] = Own[2] - Gz;
                }
            }
        }
    }
    else
    {
        // Production matched MAC face-flux projection + Rhie-Chow checkerboard filter (0 heap allocations per step):
        // 1) Convert collocated velocity to staggered positive-face fluxes F_{i+1/2}, zeroing floor/solid faces.
        if (FaceFluxScratch_.size() != VelocityCurrent_.size())
        {
            FaceFluxScratch_.assign(VelocityCurrent_.size(), 0.0f);
        }
        else
        {
            std::fill(FaceFluxScratch_.begin(), FaceFluxScratch_.end(), 0.0f);
        }
        std::vector<float>& FaceU = FaceFluxScratch_;
        auto IsFluid = [&](std::int32_t X, std::int32_t Y, std::int32_t Z) noexcept -> bool
        {
            if (Z < 0) return false;
            if (X < 0 || X >= Nx || Y < 0 || Y >= Ny || Z >= Nz) return true; // open air lateral/top
            return LoadVel(X, Y, Z)[3] <= 0.5f;
        };
        for (std::int32_t Z = 0; Z < Nz; ++Z)
        {
            for (std::int32_t Y = 0; Y < Ny; ++Y)
            {
                for (std::int32_t X = 0; X < Nx; ++X)
                {
                    const std::size_t I4 = CellIndex(X, Y, Z) * 4u;
                    const auto C = LoadVel(X, Y, Z);
                    if (C[3] > 0.5f) continue;
                    FaceU[I4 + 0u] = IsFluid(X + 1, Y, Z) ? 0.5f * (C[0] + LoadVel(X + 1, Y, Z)[0]) : 0.0f;
                    FaceU[I4 + 1u] = IsFluid(X, Y + 1, Z) ? 0.5f * (C[1] + LoadVel(X, Y + 1, Z)[1]) : 0.0f;
                    FaceU[I4 + 2u] = IsFluid(X, Y, Z + 1) ? 0.5f * (C[2] + LoadVel(X, Y, Z + 1)[2]) : 0.0f;
                }
            }
        }
        auto FaceXm = [&](std::int32_t X, std::int32_t Y, std::int32_t Z) noexcept -> float
        {
            return (X > 0) ? FaceU[CellIndex(X - 1, Y, Z) * 4u + 0u] : (IsFluid(-1, Y, Z) ? LoadVel(0, Y, Z)[0] : 0.0f);
        };
        auto FaceYm = [&](std::int32_t X, std::int32_t Y, std::int32_t Z) noexcept -> float
        {
            return (Y > 0) ? FaceU[CellIndex(X, Y - 1, Z) * 4u + 1u] : (IsFluid(X, -1, Z) ? LoadVel(X, 0, Z)[1] : 0.0f);
        };
        auto FaceZm = [&](std::int32_t X, std::int32_t Y, std::int32_t Z) noexcept -> float
        {
            return (Z > 0) ? FaceU[CellIndex(X, Y, Z - 1) * 4u + 2u] : 0.0f; // impermeable ground z = 0
        };

        // 2) Exact face-flux divergence matching the 6-point Laplacian stencil!
        for (std::int32_t Z = 0; Z < Nz; ++Z)
        {
            for (std::int32_t Y = 0; Y < Ny; ++Y)
            {
                for (std::int32_t X = 0; X < Nx; ++X)
                {
                    const std::size_t Idx = CellIndex(X, Y, Z);
                    if (LoadVel(X, Y, Z)[3] > 0.5f)
                    {
                        DivergenceField_[Idx] = 0.0f;
                        continue;
                    }
                    const std::size_t I4 = Idx * 4u;
                    const float Flux = (FaceU[I4 + 0u] - FaceXm(X, Y, Z)) +
                                       (FaceU[I4 + 1u] - FaceYm(X, Y, Z)) +
                                       (FaceU[I4 + 2u] - FaceZm(X, Y, Z));
                    DivergenceField_[Idx] = Flux / H;
                }
            }
        }

        auto NeighbourP = [&](std::int32_t X, std::int32_t Y, std::int32_t Z, float Centre) noexcept -> float
        {
            if (Z < 0) return Centre; // Neumann floor
            if (X < 0 || X >= Nx || Y < 0 || Y >= Ny || Z >= Nz) return 0.0f; // Dirichlet open sky/sides
            if (LoadVel(X, Y, Z)[3] > 0.5f) return Centre; // Neumann solid
            return PressureCurrent_[CellIndex(X, Y, Z)];
        };

        // Red-Black Gauss-Seidel / SOR (w = 1.25) converges >3x faster than plain Jacobi on matched 6-point Poisson!
        constexpr float Omega = 1.22f;
        for (std::uint32_t Sweep = 0u; Sweep < Parameters_.PressureSweeps; ++Sweep)
        {
            for (int Parity = 0; Parity < 2; ++Parity)
            {
                for (std::int32_t Z = 0; Z < Nz; ++Z)
                {
                    for (std::int32_t Y = 0; Y < Ny; ++Y)
                    {
                        for (std::int32_t X = 0; X < Nx; ++X)
                        {
                            if (((X + Y + Z) & 1) != Parity) continue;
                            const std::size_t Idx = CellIndex(X, Y, Z);
                            const float C = PressureCurrent_[Idx];
                            if (LoadVel(X, Y, Z)[3] > 0.5f) continue;
                            const float Sum = NeighbourP(X + 1, Y, Z, C) + NeighbourP(X - 1, Y, Z, C) +
                                              NeighbourP(X, Y + 1, Z, C) + NeighbourP(X, Y - 1, Z, C) +
                                              NeighbourP(X, Y, Z + 1, C) + NeighbourP(X, Y, Z - 1, C);
                            const float Target = (Sum - DivergenceField_[Idx] * H * H) * (1.0f / 6.0f);
                            PressureCurrent_[Idx] = C + Omega * (Target - C);
                        }
                    }
                }
            }
        }

        // 3) Project face fluxes directly (guaranteed div(u_face*) -> 0) and reconstruct divergence-free cell centres!
        for (std::int32_t Z = 0; Z < Nz; ++Z)
        {
            for (std::int32_t Y = 0; Y < Ny; ++Y)
            {
                for (std::int32_t X = 0; X < Nx; ++X)
                {
                    const std::size_t I4 = CellIndex(X, Y, Z) * 4u;
                    const float C = PressureCurrent_[CellIndex(X, Y, Z)];
                    FaceU[I4 + 0u] = IsFluid(X + 1, Y, Z) ? (FaceU[I4 + 0u] - (NeighbourP(X + 1, Y, Z, C) - C) / H) : 0.0f;
                    FaceU[I4 + 1u] = IsFluid(X, Y + 1, Z) ? (FaceU[I4 + 1u] - (NeighbourP(X, Y + 1, Z, C) - C) / H) : 0.0f;
                    FaceU[I4 + 2u] = IsFluid(X, Y, Z + 1) ? (FaceU[I4 + 2u] - (NeighbourP(X, Y, Z + 1, C) - C) / H) : 0.0f;
                }
            }
        }
        for (std::int32_t Z = 0; Z < Nz; ++Z)
        {
            for (std::int32_t Y = 0; Y < Ny; ++Y)
            {
                for (std::int32_t X = 0; X < Nx; ++X)
                {
                    const std::size_t Idx = CellIndex(X, Y, Z);
                    const std::size_t I4  = Idx * 4u;
                    if (LoadVel(X, Y, Z)[3] > 0.5f)
                    {
                        VelocityScratch_[I4 + 0u] = 0.0f;
                        VelocityScratch_[I4 + 1u] = 0.0f;
                        VelocityScratch_[I4 + 2u] = 0.0f;
                        VelocityScratch_[I4 + 3u] = 1.0f;
                        continue;
                    }
                    const float Ux = 0.5f * (FaceU[I4 + 0u] + FaceXm(X, Y, Z));
                    const float Uy = 0.5f * (FaceU[I4 + 1u] + FaceYm(X, Y, Z));
                    const float Uz = 0.5f * (FaceU[I4 + 2u] + FaceZm(X, Y, Z));
                    VelocityScratch_[I4 + 0u] = Ux;
                    VelocityScratch_[I4 + 1u] = Uy;
                    VelocityScratch_[I4 + 2u] = Uz;
                    VelocityScratch_[I4 + 3u] = 0.0f;
                }
            }
        }
        VelocityCurrent_.swap(VelocityScratch_);
    }

    OutMetrics.RmsDivergenceAfter = MeasureCollocatedFaceFluxDivRms();
}

PlumeDiagnostics PlumeFluid::AdvanceSimulation(
    const std::array<float, 3>& AnchorPosition,
    const std::array<float, 3>& SunDirection,
    float                       StepSeconds)
{
    const float Dt = ClampScalar(StepSeconds, 1.0f / 240.0f, 1.0f / 24.0f);
    ElapsedSeconds_ += Dt;

    const std::int32_t Vx = static_cast<std::int32_t>(VelocityExtent_[0]);
    const std::int32_t Vy = static_cast<std::int32_t>(VelocityExtent_[1]);
    const std::int32_t Vz = static_cast<std::int32_t>(VelocityExtent_[2]);
    const std::int32_t Tx = static_cast<std::int32_t>(ThermoExtent_[0]);
    const std::int32_t Ty = static_cast<std::int32_t>(ThermoExtent_[1]);
    const std::int32_t Tz = static_cast<std::int32_t>(ThermoExtent_[2]);

    // 1. Toroidal window update around AnchorPosition.
    const std::int32_t DesiredOx = static_cast<std::int32_t>(std::floor(AnchorPosition[0] / CoarseCellMetres_)) - Vx / 2;
    const std::int32_t DesiredOy = static_cast<std::int32_t>(std::floor(AnchorPosition[1] / CoarseCellMetres_)) - Vy / 2;
    PriorOriginXY_ = OriginXY_;
    if (PriorOriginXY_[0] > (1 << 18))
    {
        OriginXY_      = { DesiredOx, DesiredOy };
        PriorOriginXY_ = OriginXY_;
    }
    else if (std::abs(DesiredOx - OriginXY_[0]) >= 4 || std::abs(DesiredOy - OriginXY_[1]) >= 4)
    {
        OriginXY_ = { DesiredOx, DesiredOy };
        ++Relocations_;
    }

    const float WindRad = Parameters_.WindHeadingDegrees * (PiConstant / 180.0f);
    const std::array<float, 3> Wind = {
        Parameters_.WindSpeed * std::cos(WindRad),
        Parameters_.WindSpeed * std::sin(WindRad),
        0.0f
    };

    // Populate checked Engine PlumeLatticeFootprint (256 B).
    Footprint_.VelocityOrigin      = { OriginXY_[0], OriginXY_[1], 0, 0 };
    Footprint_.PriorVelocityOrigin = { PriorOriginXY_[0], PriorOriginXY_[1], 0, static_cast<std::int32_t>(Sources_.size()) };
    Footprint_.VelocityExtent      = { VelocityExtent_[0], VelocityExtent_[1], VelocityExtent_[2], 0u };
    Footprint_.ThermoExtent        = { ThermoExtent_[0], ThermoExtent_[1], ThermoExtent_[2], 0u };
    Footprint_.Lattice             = { FineCellMetres_, CoarseCellMetres_, FloorWorldZ, Dt };
    Footprint_.Forces              = { Parameters_.Buoyancy, Parameters_.ParticulateFall, Parameters_.VorticityStrength, Parameters_.SubgridTurbulence };
    Footprint_.Retention           = {
        std::exp(-Parameters_.SmokeDissipation * Dt),
        std::exp(-Parameters_.HeatCooling * Dt),
        std::exp(-Parameters_.FlameDecay * Dt),
        std::exp(-0.35f * Dt)
    };
    Footprint_.Wind                = { Wind[0], Wind[1], Wind[2], ElapsedSeconds_ };
    Footprint_.Optical             = { Parameters_.SmokeExtinction, Parameters_.SmokeAlbedo, Parameters_.SootExtinction, static_cast<float>(Parameters_.MarchSampleLimit) };
    const float SunLen             = std::max(std::sqrt(SunDirection[0] * SunDirection[0] + SunDirection[1] * SunDirection[1] + SunDirection[2] * SunDirection[2]), 1.0e-5f);
    Footprint_.Sun                 = { SunDirection[0] / SunLen, SunDirection[1] / SunLen, SunDirection[2] / SunLen, Parameters_.SootAlbedo };
    Footprint_.Combustion          = { 1.35f * Parameters_.SootScale, 32.0f * Parameters_.HeatScale, std::exp(-Parameters_.SootDissipation * Dt), 0.0f };
    Footprint_.Scattering          = { Parameters_.MultiScatterGain, Parameters_.PhaseAnisotropy, 1.0f, 1.0f };
    Footprint_.Detail              = { Parameters_.DetailStrength, Parameters_.DetailFrequency, Parameters_.TurbulenceFrequency, Parameters_.FlowWarpStrength };
    Footprint_.Flame               = { Parameters_.FlameCoreKelvin, Parameters_.FlameTipKelvin, Parameters_.FlameHalfHeat, Parameters_.FlameSheetSharpness };

    if (Sources_.empty())
    {
        Footprint_.SourceMinimum = {  1.0e6f,  1.0e6f,  1.0e6f, FineCellMetres_ };
        Footprint_.SourceMaximum = { -1.0e6f, -1.0e6f, -1.0e6f, Parameters_.FlameRadianceScale };
    }
    else
    {
        std::array<float, 3> SMin = {  1.0e6f,  1.0e6f,  1.0e6f };
        std::array<float, 3> SMax = { -1.0e6f, -1.0e6f, -1.0e6f };
        for (const PlumeSourceFootprint& S : Sources_)
        {
            const float R = 3.0f * S.PositionRadius[3];
            for (int A = 0; A < 3; ++A)
            {
                SMin[A] = std::min(SMin[A], S.PositionRadius[A] - R);
                SMax[A] = std::max(SMax[A], S.PositionRadius[A] + R);
            }
        }
        Footprint_.SourceMinimum = { SMin[0], SMin[1], SMin[2], FineCellMetres_ };
        Footprint_.SourceMaximum = { SMax[0], SMax[1], SMax[2], Parameters_.FlameRadianceScale };
        ValidatePlumeSourceFootprints(Sources_.data(), Sources_.size());
    }
    ValidatePlumeLatticeFootprint(Footprint_, SourceLimit);

    const float WorldMinX = static_cast<float>(OriginXY_[0]) * CoarseCellMetres_;
    const float WorldMinY = static_cast<float>(OriginXY_[1]) * CoarseCellMetres_;
    const float PriorMinX = static_cast<float>(PriorOriginXY_[0]) * CoarseCellMetres_;
    const float PriorMinY = static_cast<float>(PriorOriginXY_[1]) * CoarseCellMetres_;

    auto CoarseIdx = [Vx, Vy](std::int32_t X, std::int32_t Y, std::int32_t Z) noexcept -> std::size_t
    {
        return (static_cast<std::size_t>(Z) * static_cast<std::size_t>(Vy) + static_cast<std::size_t>(Y)) *
                   static_cast<std::size_t>(Vx) +
               static_cast<std::size_t>(X);
    };
    auto FineIdx = [Tx, Ty](std::int32_t X, std::int32_t Y, std::int32_t Z) noexcept -> std::size_t
    {
        return (static_cast<std::size_t>(Z) * static_cast<std::size_t>(Ty) + static_cast<std::size_t>(Y)) *
                   static_cast<std::size_t>(Tx) +
               static_cast<std::size_t>(X);
    };

    auto SampleTrilinear = [](const std::vector<float>& Field, std::int32_t Nx, std::int32_t Ny, std::int32_t Nz,
                              float OriginX, float OriginY, float CellSize,
                              float Px, float Py, float Pz,
                              std::array<float, 4>* OutMin8 = nullptr,
                              std::array<float, 4>* OutMax8 = nullptr) noexcept -> std::array<float, 4>
    {
        const float Gx = (Px - OriginX) / CellSize - 0.5f;
        const float Gy = (Py - OriginY) / CellSize - 0.5f;
        const float Gz = (Pz - FloorWorldZ) / CellSize - 0.5f;
        if (Gx < -0.5f || Gy < -0.5f || Gz < -0.5f ||
            Gx > static_cast<float>(Nx) - 0.5f || Gy > static_cast<float>(Ny) - 0.5f || Gz > static_cast<float>(Nz) - 0.5f)
        {
            if (OutMin8) *OutMin8 = { 0.0f, 0.0f, 0.0f, 0.0f };
            if (OutMax8) *OutMax8 = { 0.0f, 0.0f, 0.0f, 0.0f };
            return { 0.0f, 0.0f, 0.0f, 0.0f };
        }
        const float ClampedX = ClampScalar(Gx, 0.0f, static_cast<float>(Nx - 1) - 1.0e-5f);
        const float ClampedY = ClampScalar(Gy, 0.0f, static_cast<float>(Ny - 1) - 1.0e-5f);
        const float ClampedZ = ClampScalar(Gz, 0.0f, static_cast<float>(Nz - 1) - 1.0e-5f);
        const std::int32_t X0 = static_cast<std::int32_t>(std::floor(ClampedX));
        const std::int32_t Y0 = static_cast<std::int32_t>(std::floor(ClampedY));
        const std::int32_t Z0 = static_cast<std::int32_t>(std::floor(ClampedZ));
        const std::int32_t X1 = std::min(X0 + 1, Nx - 1);
        const std::int32_t Y1 = std::min(Y0 + 1, Ny - 1);
        const std::int32_t Z1 = std::min(Z0 + 1, Nz - 1);
        const float Fx = ClampedX - static_cast<float>(X0);
        const float Fy = ClampedY - static_cast<float>(Y0);
        const float Fz = ClampedZ - static_cast<float>(Z0);

        auto At = [&](std::int32_t X, std::int32_t Y, std::int32_t Z) noexcept -> const float*
        {
            const std::size_t Idx = ((static_cast<std::size_t>(Z) * static_cast<std::size_t>(Ny) + static_cast<std::size_t>(Y)) *
                                         static_cast<std::size_t>(Nx) +
                                     static_cast<std::size_t>(X)) * 4u;
            return &Field[Idx];
        };
        const float* P000 = At(X0, Y0, Z0); const float* P100 = At(X1, Y0, Z0);
        const float* P010 = At(X0, Y1, Z0); const float* P110 = At(X1, Y1, Z0);
        const float* P001 = At(X0, Y0, Z1); const float* P101 = At(X1, Y0, Z1);
        const float* P011 = At(X0, Y1, Z1); const float* P111 = At(X1, Y1, Z1);

        std::array<float, 4> Result{};
        std::array<float, 4> Low  = {  1.0e30f,  1.0e30f,  1.0e30f,  1.0e30f };
        std::array<float, 4> High = { -1.0e30f, -1.0e30f, -1.0e30f, -1.0e30f };
        const float* Corners[8] = { P000, P100, P010, P110, P001, P101, P011, P111 };
        for (int C = 0; C < 4; ++C)
        {
            for (const float* Ptr : Corners)
            {
                Low[C]  = std::min(Low[C],  Ptr[C]);
                High[C] = std::max(High[C], Ptr[C]);
            }
            const float C00 = P000[C] + (P100[C] - P000[C]) * Fx;
            const float C10 = P010[C] + (P110[C] - P010[C]) * Fx;
            const float C01 = P001[C] + (P101[C] - P001[C]) * Fx;
            const float C11 = P011[C] + (P111[C] - P011[C]) * Fx;
            const float C0  = C00 + (C10 - C00) * Fy;
            const float C1  = C01 + (C11 - C01) * Fy;
            Result[C] = C0 + (C1 - C0) * Fz;
        }
        if (OutMin8) *OutMin8 = Low;
        if (OutMax8) *OutMax8 = High;
        return Result;
    };

    // 2. Coarse velocity advection + buoyancy + source momentum.
    for (std::int32_t Z = 0; Z < Vz; ++Z)
    {
        const float Pz = FloorWorldZ + (static_cast<float>(Z) + 0.5f) * CoarseCellMetres_;
        for (std::int32_t Y = 0; Y < Vy; ++Y)
        {
            const float Py = WorldMinY + (static_cast<float>(Y) + 0.5f) * CoarseCellMetres_;
            for (std::int32_t X = 0; X < Vx; ++X)
            {
                const float Px = WorldMinX + (static_cast<float>(X) + 0.5f) * CoarseCellMetres_;
                const std::size_t I4 = CoarseIdx(X, Y, Z) * 4u;
                std::array<float, 3> WakeVel = { 0.0f, 0.0f, 0.0f };
                float                WakeMix = 0.0f;
                if (Pz < 0.0f || PointInsideSolidObstacles(Px, Py, Pz, &WakeVel, &WakeMix))
                {
                    VelocityScratch_[I4 + 0u] = 0.0f;
                    VelocityScratch_[I4 + 1u] = 0.0f;
                    VelocityScratch_[I4 + 2u] = 0.0f;
                    VelocityScratch_[I4 + 3u] = 1.0f;
                    continue;
                }
                const auto Own = SampleTrilinear(VelocityCurrent_, Vx, Vy, Vz, PriorMinX, PriorMinY, CoarseCellMetres_, Px, Py, Pz);
                const auto Adv = SampleTrilinear(VelocityCurrent_, Vx, Vy, Vz, PriorMinX, PriorMinY, CoarseCellMetres_,
                                                 Px - Own[0] * Dt, Py - Own[1] * Dt, Pz - Own[2] * Dt);
                float Ux = Wind[0] + (Adv[0] - Wind[0]) * Footprint_.Retention[3];
                float Uy = Wind[1] + (Adv[1] - Wind[1]) * Footprint_.Retention[3];
                float Uz = Wind[2] + (Adv[2] - Wind[2]) * Footprint_.Retention[3];
                if (WakeMix > 0.0f)
                {
                    const float Couple = ClampScalar(WakeMix * 0.72f, 0.0f, 1.0f);
                    Ux += (WakeVel[0] - Ux) * Couple;
                    Uy += (WakeVel[1] - Uy) * Couple;
                    Uz += (WakeVel[2] - Uz) * Couple;
                }

                const auto Thermo = SampleTrilinear(ThermoCurrent_, Tx, Ty, Tz, PriorMinX, PriorMinY, FineCellMetres_, Px, Py, Pz);
                const float Lift  = Footprint_.Forces[0] * Thermo[1] / (1.0f + 0.125f * Thermo[1]);
                Uz += (Lift - Footprint_.Forces[1] * (Thermo[0] + Thermo[3])) * Dt;

                for (const PlumeSourceFootprint& Src : Sources_)
                {
                    const float Dx = Px - Src.PositionRadius[0];
                    const float Dy = Py - Src.PositionRadius[1];
                    const float Dz = Pz - Src.PositionRadius[2];
                    const float R  = std::max(Src.PositionRadius[3], 0.5f * CoarseCellMetres_);
                    const float D2 = (Dx * Dx + Dy * Dy + Dz * Dz) / (R * R);
                    if (D2 < 9.0f)
                    {
                        const float Weight = std::exp(-0.5f * D2);
                        const float Push   = 1.0f - std::exp(-Weight * Dt * (4.0f + 0.15f * (Src.Rates[0] + Src.Rates[3]) + 0.05f * Src.Rates[2]));
                        Ux += (Src.Velocity[0] - Ux) * Push;
                        Uy += (Src.Velocity[1] - Uy) * Push;
                        Uz += (Src.Velocity[2] - Uz) * Push;
                    }
                }
                const float Speed = std::sqrt(Ux * Ux + Uy * Uy + Uz * Uz);
                if (Speed > SpeedCeiling)
                {
                    const float Scale = SpeedCeiling / Speed;
                    Ux *= Scale; Uy *= Scale; Uz *= Scale;
                }
                VelocityScratch_[I4 + 0u] = Ux;
                VelocityScratch_[I4 + 1u] = Uy;
                VelocityScratch_[I4 + 2u] = Uz;
                VelocityScratch_[I4 + 3u] = 0.0f;
            }
        }
    }
    VelocityCurrent_.swap(VelocityScratch_);

    // 3. Vorticity confinement (Fedkiw-Stam-Jensen) on coarse lattice.
    if (Parameters_.VorticityStrength > 0.0f)
    {
        auto LoadV = [&](std::int32_t X, std::int32_t Y, std::int32_t Z) noexcept -> const float*
        {
            const std::int32_t Cx = std::max(0, std::min(Vx - 1, X));
            const std::int32_t Cy = std::max(0, std::min(Vy - 1, Y));
            const std::int32_t Cz = std::max(0, std::min(Vz - 1, Z));
            return &VelocityCurrent_[CoarseIdx(Cx, Cy, Cz) * 4u];
        };
        const float Inv2H = 0.5f / CoarseCellMetres_;
        for (std::int32_t Z = 0; Z < Vz; ++Z)
        {
            for (std::int32_t Y = 0; Y < Vy; ++Y)
            {
                for (std::int32_t X = 0; X < Vx; ++X)
                {
                    const float* Xp = LoadV(X + 1, Y, Z); const float* Xm = LoadV(X - 1, Y, Z);
                    const float* Yp = LoadV(X, Y + 1, Z); const float* Ym = LoadV(X, Y - 1, Z);
                    const float* Zp = LoadV(X, Y, Z + 1); const float* Zm = LoadV(X, Y, Z - 1);
                    const float Wx = ((Yp[2] - Ym[2]) - (Zp[1] - Zm[1])) * Inv2H;
                    const float Wy = ((Zp[0] - Zm[0]) - (Xp[2] - Xm[2])) * Inv2H;
                    const float Wz = ((Xp[1] - Xm[1]) - (Yp[0] - Ym[0])) * Inv2H;
                    const std::size_t I4 = CoarseIdx(X, Y, Z) * 4u;
                    CurlField_[I4 + 0u] = Wx;
                    CurlField_[I4 + 1u] = Wy;
                    CurlField_[I4 + 2u] = Wz;
                    CurlField_[I4 + 3u] = std::sqrt(Wx * Wx + Wy * Wy + Wz * Wz);
                }
            }
        }
        auto CurlMag = [&](std::int32_t X, std::int32_t Y, std::int32_t Z) noexcept -> float
        {
            const std::int32_t Cx = std::max(0, std::min(Vx - 1, X));
            const std::int32_t Cy = std::max(0, std::min(Vy - 1, Y));
            const std::int32_t Cz = std::max(0, std::min(Vz - 1, Z));
            return CurlField_[CoarseIdx(Cx, Cy, Cz) * 4u + 3u];
        };
        for (std::int32_t Z = 0; Z < Vz; ++Z)
        {
            for (std::int32_t Y = 0; Y < Vy; ++Y)
            {
                for (std::int32_t X = 0; X < Vx; ++X)
                {
                    const std::size_t I4 = CoarseIdx(X, Y, Z) * 4u;
                    if (VelocityCurrent_[I4 + 3u] > 0.5f) continue;
                    const float NxG = (CurlMag(X + 1, Y, Z) - CurlMag(X - 1, Y, Z)) * Inv2H;
                    const float NyG = (CurlMag(X, Y + 1, Z) - CurlMag(X, Y - 1, Z)) * Inv2H;
                    const float NzG = (CurlMag(X, Y, Z + 1) - CurlMag(X, Y, Z - 1)) * Inv2H;
                    const float Len = std::sqrt(NxG * NxG + NyG * NyG + NzG * NzG);
                    if (Len > 1.0e-5f)
                    {
                        const float Ex = NxG / Len, Ey = NyG / Len, Ez = NzG / Len;
                        const float Wx = CurlField_[I4 + 0u], Wy = CurlField_[I4 + 1u], Wz = CurlField_[I4 + 2u];
                        const float Gain = Parameters_.VorticityStrength * CoarseCellMetres_ * Dt;
                        VelocityCurrent_[I4 + 0u] += Gain * (Ey * Wz - Ez * Wy);
                        VelocityCurrent_[I4 + 1u] += Gain * (Ez * Wx - Ex * Wz);
                        VelocityCurrent_[I4 + 2u] += Gain * (Ex * Wy - Ey * Wx);
                    }
                }
            }
        }
    }

    // 3b. Baroclinic vorticity torque (grad(T) x grad(rho)) on ProductionUpgraded:
    //     Curls rising hot fireballs against denser outer soot shells into authentic Kelvin-Helmholtz mushroom rings!
    if (Parameters_.Variant == PlumeSolverVariant::ProductionUpgraded && Parameters_.BaroclinicStrength > 0.0f &&
        CoverageLow_[0] <= CoverageHigh_[0])
    {
        const float Inv2C = 0.5f / CoarseCellMetres_;
        const std::int32_t BMinX = std::max(1, CoverageLow_[0] / 2 - 2);
        const std::int32_t BMaxX = std::min(Vx - 2, CoverageHigh_[0] / 2 + 2);
        const std::int32_t BMinY = std::max(1, CoverageLow_[1] / 2 - 2);
        const std::int32_t BMaxY = std::min(Vy - 2, CoverageHigh_[1] / 2 + 2);
        const std::int32_t BMinZ = std::max(1, CoverageLow_[2] / 2 - 2);
        const std::int32_t BMaxZ = std::min(Vz - 2, CoverageHigh_[2] / 2 + 2);
        auto SampleFineAtCoarse = [&](std::int32_t Cx, std::int32_t Cy, std::int32_t Cz) noexcept -> std::array<float, 2>
        {
            const std::int32_t Fx = std::clamp(Cx * 2, 0, Tx - 1);
            const std::int32_t Fy = std::clamp(Cy * 2, 0, Ty - 1);
            const std::int32_t Fz = std::clamp(Cz * 2, 0, Tz - 1);
            const std::size_t  F4 = FineIdx(Fx, Fy, Fz) * 4u;
            return { ThermoCurrent_[F4 + 1u], ThermoCurrent_[F4 + 0u] + ThermoCurrent_[F4 + 3u] };
        };
        for (std::int32_t Z = BMinZ; Z <= BMaxZ; ++Z)
        {
            for (std::int32_t Y = BMinY; Y <= BMaxY; ++Y)
            {
                for (std::int32_t X = BMinX; X <= BMaxX; ++X)
                {
                    const std::size_t I4 = CoarseIdx(X, Y, Z) * 4u;
                    if (VelocityCurrent_[I4 + 3u] > 0.5f) continue;
                    const auto Xp = SampleFineAtCoarse(X + 1, Y, Z), Xm = SampleFineAtCoarse(X - 1, Y, Z);
                    const auto Yp = SampleFineAtCoarse(X, Y + 1, Z), Ym = SampleFineAtCoarse(X, Y - 1, Z);
                    const auto Zp = SampleFineAtCoarse(X, Y, Z + 1), Zm = SampleFineAtCoarse(X, Y, Z - 1);
                    const float GtX = (Xp[0] - Xm[0]) * Inv2C, GtY = (Yp[0] - Ym[0]) * Inv2C, GtZ = (Zp[0] - Zm[0]) * Inv2C;
                    const float GrX = (Xp[1] - Xm[1]) * Inv2C, GrY = (Yp[1] - Ym[1]) * Inv2C, GrZ = (Zp[1] - Zm[1]) * Inv2C;
                    const float Bx = GtY * GrZ - GtZ * GrY;
                    const float By = GtZ * GrX - GtX * GrZ;
                    const float Bz = GtX * GrY - GtY * GrX;
                    const float BMag = std::sqrt(Bx * Bx + By * By + Bz * Bz);
                    if (BMag > 1.0e-3f)
                    {
                        const float Scale = std::min(2.6f, Parameters_.BaroclinicStrength * 0.0045f * BMag) * Dt / BMag;
                        VelocityCurrent_[I4 + 0u] += Bx * Scale;
                        VelocityCurrent_[I4 + 1u] += By * Scale;
                        VelocityCurrent_[I4 + 2u] += Bz * Scale;
                    }
                }
            }
        }
    }

    // 4. Compatible pressure projection.
    Diagnostics_               = {};
    Diagnostics_.ActiveSources = static_cast<std::uint32_t>(Sources_.size());
    Diagnostics_.Relocations   = Relocations_;
    ProjectPressureOnlyForTesting(Diagnostics_);

    // 4b. Combustion reaction-front gas expansion impulse on ProductionUpgraded (billowing outward pyro lobes):
    if (Parameters_.Variant == PlumeSolverVariant::ProductionUpgraded && Parameters_.CombustionExpansion > 0.0f &&
        CoverageLow_[0] <= CoverageHigh_[0])
    {
        const float Inv2C = 0.5f / CoarseCellMetres_;
        const std::int32_t EMinX = std::max(1, CoverageLow_[0] / 2 - 2);
        const std::int32_t EMaxX = std::min(Vx - 2, CoverageHigh_[0] / 2 + 2);
        const std::int32_t EMinY = std::max(1, CoverageLow_[1] / 2 - 2);
        const std::int32_t EMaxY = std::min(Vy - 2, CoverageHigh_[1] / 2 + 2);
        const std::int32_t EMinZ = std::max(1, CoverageLow_[2] / 2 - 1);
        const std::int32_t EMaxZ = std::min(Vz - 2, CoverageHigh_[2] / 2 + 2);
        auto FlameAt = [&](std::int32_t Cx, std::int32_t Cy, std::int32_t Cz) noexcept -> float
        {
            const std::size_t F4 = FineIdx(std::clamp(Cx * 2, 0, Tx - 1), std::clamp(Cy * 2, 0, Ty - 1), std::clamp(Cz * 2, 0, Tz - 1)) * 4u;
            return ThermoCurrent_[F4 + 2u];
        };
        for (std::int32_t Z = EMinZ; Z <= EMaxZ; ++Z)
        {
            for (std::int32_t Y = EMinY; Y <= EMaxY; ++Y)
            {
                for (std::int32_t X = EMinX; X <= EMaxX; ++X)
                {
                    const std::size_t I4 = CoarseIdx(X, Y, Z) * 4u;
                    if (VelocityCurrent_[I4 + 3u] > 0.5f) continue;
                    // Outward expansion down negative reaction gradient (-grad(Flame))!
                    const float Ex = -(FlameAt(X + 1, Y, Z) - FlameAt(X - 1, Y, Z)) * Inv2C;
                    const float Ey = -(FlameAt(X, Y + 1, Z) - FlameAt(X, Y - 1, Z)) * Inv2C;
                    const float Ez = -(FlameAt(X, Y, Z + 1) - FlameAt(X, Y, Z - 1)) * Inv2C;
                    const float Gain = Parameters_.CombustionExpansion * 0.45f * Dt;
                    VelocityCurrent_[I4 + 0u] = ClampScalar(VelocityCurrent_[I4 + 0u] + Ex * Gain, -SpeedCeiling, SpeedCeiling);
                    VelocityCurrent_[I4 + 1u] = ClampScalar(VelocityCurrent_[I4 + 1u] + Ey * Gain, -SpeedCeiling, SpeedCeiling);
                    VelocityCurrent_[I4 + 2u] = ClampScalar(VelocityCurrent_[I4 + 2u] + std::max(0.0f, Ez) * Gain, -SpeedCeiling, SpeedCeiling);
                }
            }
        }
    }

    // 5. Fine thermo transport with Dilated Active-Region Narrow-Band Execution:
    //    Compute conservative active fine window [ActMin..ActMax] enclosing prior active plume + advection apron + all sources!
    std::array<std::int32_t, 3> ActMin = { Tx, Ty, Tz };
    std::array<std::int32_t, 3> ActMax = { -1, -1, -1 };
    const std::int32_t ShiftFineX = (OriginXY_[0] - PriorOriginXY_[0]) * 2;
    const std::int32_t ShiftFineY = (OriginXY_[1] - PriorOriginXY_[1]) * 2;
    const std::int32_t ApronCells = static_cast<std::int32_t>(std::ceil((SpeedCeiling * Dt) / FineCellMetres_)) + 5;
    if (CoverageLow_[0] <= CoverageHigh_[0])
    {
        ActMin[0] = std::max(0, CoverageLow_[0] - ShiftFineX - ApronCells);
        ActMin[1] = std::max(0, CoverageLow_[1] - ShiftFineY - ApronCells);
        ActMin[2] = std::max(0, CoverageLow_[2] - ApronCells);
        ActMax[0] = std::min(Tx - 1, CoverageHigh_[0] - ShiftFineX + ApronCells);
        ActMax[1] = std::min(Ty - 1, CoverageHigh_[1] - ShiftFineY + ApronCells);
        ActMax[2] = std::min(Tz - 1, CoverageHigh_[2] + ApronCells + 3);
    }
    for (const PlumeSourceFootprint& Src : Sources_)
    {
        const float R = 3.2f * std::max(Src.PositionRadius[3], FineCellMetres_);
        const std::int32_t Sx0 = std::max(0, static_cast<std::int32_t>(std::floor((Src.PositionRadius[0] - R - WorldMinX) / FineCellMetres_)) - 2);
        const std::int32_t Sy0 = std::max(0, static_cast<std::int32_t>(std::floor((Src.PositionRadius[1] - R - WorldMinY) / FineCellMetres_)) - 2);
        const std::int32_t Sz0 = std::max(0, static_cast<std::int32_t>(std::floor((Src.PositionRadius[2] - R - FloorWorldZ) / FineCellMetres_)) - 2);
        const std::int32_t Sx1 = std::min(Tx - 1, static_cast<std::int32_t>(std::ceil((Src.PositionRadius[0] + R - WorldMinX) / FineCellMetres_)) + 2);
        const std::int32_t Sy1 = std::min(Ty - 1, static_cast<std::int32_t>(std::ceil((Src.PositionRadius[1] + R - WorldMinY) / FineCellMetres_)) + 2);
        const std::int32_t Sz1 = std::min(Tz - 1, static_cast<std::int32_t>(std::ceil((Src.PositionRadius[2] + R - FloorWorldZ) / FineCellMetres_)) + 2);
        ActMin[0] = std::min(ActMin[0], Sx0); ActMin[1] = std::min(ActMin[1], Sy0); ActMin[2] = std::min(ActMin[2], Sz0);
        ActMax[0] = std::max(ActMax[0], Sx1); ActMax[1] = std::max(ActMax[1], Sy1); ActMax[2] = std::max(ActMax[2], Sz1);
    }

    auto SampleFineVelocity = [&](float Px, float Py, float Pz, float Activity) noexcept -> std::array<float, 3>
    {
        const auto Base = SampleTrilinear(VelocityCurrent_, Vx, Vy, Vz, WorldMinX, WorldMinY, CoarseCellMetres_, Px, Py, Pz);
        if (Parameters_.SubgridTurbulence <= 1.0e-5f)
        {
            return { Base[0], Base[1], Base[2] };
        }
        const float Fq  = Parameters_.TurbulenceFrequency;
        const float T   = ElapsedSeconds_;
        const float A1x = Px * Fq + 0.43f * T, A1y = Py * Fq - 0.31f * T, A1z = Pz * Fq + 0.27f * T;
        const float A2x = Px * Fq * 2.37f - 0.61f * T + 1.7f;
        const float A2y = Py * Fq * 2.37f + 0.53f * T + 4.1f;
        const float A2z = Pz * Fq * 2.37f - 0.89f * T + 2.9f;
        const float Sx  = (std::sin(A1y) - std::sin(A1z)) + 0.45f * (std::sin(A2y) - std::sin(A2z));
        const float Sy  = (std::sin(A1z) - std::sin(A1x)) + 0.45f * (std::sin(A2z) - std::sin(A2x));
        const float Sz  = (std::sin(A1x) - std::sin(A1y)) + 0.45f * (std::sin(A2x) - std::sin(A2y));
        const float Gain = Parameters_.SubgridTurbulence * (0.28f + 0.72f * Activity);
        return { Base[0] + Gain * Sx, Base[1] + Gain * Sy, Base[2] + Gain * Sz };
    };

    std::fill(ThermoScratch_.begin(), ThermoScratch_.end(), 0.0f);
    std::fill(ThermoBackward_.begin(), ThermoBackward_.end(), 0.0f);
    std::fill(MacroOccupancy_.begin(), MacroOccupancy_.end(), 0u);

    // Pass 5a: Forward semi-Lagrangian predictor restricted to conservative active narrow-band [ActMin..ActMax]!
    for (std::int32_t Z = ActMin[2]; Z <= ActMax[2]; ++Z)
    {
        const float Pz = FloorWorldZ + (static_cast<float>(Z) + 0.5f) * FineCellMetres_;
        for (std::int32_t Y = ActMin[1]; Y <= ActMax[1]; ++Y)
        {
            const float Py = WorldMinY + (static_cast<float>(Y) + 0.5f) * FineCellMetres_;
            for (std::int32_t X = ActMin[0]; X <= ActMax[0]; ++X)
            {
                const float Px = WorldMinX + (static_cast<float>(X) + 0.5f) * FineCellMetres_;
                const std::size_t I4 = FineIdx(X, Y, Z) * 4u;
                if (Pz < 0.0f || PointInsideSolidObstacles(Px, Py, Pz))
                {
                    continue;
                }
                const auto Here     = SampleTrilinear(ThermoCurrent_, Tx, Ty, Tz, PriorMinX, PriorMinY, FineCellMetres_, Px, Py, Pz);
                const float Act     = ClampScalar(0.6f * (Here[0] + Here[3]) + 0.02f * Here[1] + Here[2], 0.0f, 1.0f);
                const float SlipZ   = 0.85f * ClampScalar(Here[1] / 40.0f, 0.0f, 1.0f) + 1.45f * ClampScalar(Here[2], 0.0f, 1.0f);
                const auto Vel0     = SampleFineVelocity(Px, Py, Pz, Act);
                const float Mx      = Px - Vel0[0] * 0.5f * Dt;
                const float My      = Py - Vel0[1] * 0.5f * Dt;
                const float Mz      = Pz - (Vel0[2] + SlipZ) * 0.5f * Dt;
                const auto VelMid   = SampleFineVelocity(Mx, My, Mz, Act);
                const auto Advected = SampleTrilinear(ThermoCurrent_, Tx, Ty, Tz, PriorMinX, PriorMinY, FineCellMetres_,
                                                      Px - VelMid[0] * Dt, Py - VelMid[1] * Dt, Pz - (VelMid[2] + SlipZ) * Dt);
                for (std::size_t C = 0u; C < 4u; ++C)
                {
                    ThermoScratch_[I4 + C] = Advected[C];
                }
            }
        }
    }

    // Pass 5b: Clamped MacCormack corrector (ProductionUpgraded) + combustion + retention + Gaussian sources + macro-bricks!
    CoverageLow_  = { Tx, Ty, Tz };
    CoverageHigh_ = { -1, -1, -1 };
    std::size_t ActiveCells = 0u;

    for (std::int32_t Z = ActMin[2]; Z <= ActMax[2]; ++Z)
    {
        const float Pz = FloorWorldZ + (static_cast<float>(Z) + 0.5f) * FineCellMetres_;
        for (std::int32_t Y = ActMin[1]; Y <= ActMax[1]; ++Y)
        {
            const float Py = WorldMinY + (static_cast<float>(Y) + 0.5f) * FineCellMetres_;
            for (std::int32_t X = ActMin[0]; X <= ActMax[0]; ++X)
            {
                const float Px = WorldMinX + (static_cast<float>(X) + 0.5f) * FineCellMetres_;
                const std::size_t I4 = FineIdx(X, Y, Z) * 4u;
                if (Pz < 0.0f)
                {
                    continue;
                }

                std::array<float, 4> Val = {
                    ThermoScratch_[I4 + 0u],
                    ThermoScratch_[I4 + 1u],
                    ThermoScratch_[I4 + 2u],
                    ThermoScratch_[I4 + 3u]
                };

                if (Parameters_.Variant == PlumeSolverVariant::ProductionUpgraded &&
                    (Val[0] > 1.0e-5f || Val[1] > 1.0e-3f || Val[2] > 1.0e-5f || Val[3] > 1.0e-5f))
                {
                    const auto Here   = SampleTrilinear(ThermoCurrent_, Tx, Ty, Tz, PriorMinX, PriorMinY, FineCellMetres_, Px, Py, Pz);
                    const float Act   = ClampScalar(0.6f * (Here[0] + Here[3]) + 0.02f * Here[1] + Here[2], 0.0f, 1.0f);
                    const float SlipZ = 0.85f * ClampScalar(Here[1] / 40.0f, 0.0f, 1.0f) + 1.45f * ClampScalar(Here[2], 0.0f, 1.0f);
                    const auto Vel0   = SampleFineVelocity(Px, Py, Pz, Act);
                    const float DepX  = Px - Vel0[0] * Dt;
                    const float DepY  = Py - Vel0[1] * Dt;
                    const float DepZ  = Pz - (Vel0[2] + SlipZ) * Dt;

                    std::array<float, 4> Min8{}, Max8{};
                    (void)SampleTrilinear(ThermoCurrent_, Tx, Ty, Tz, PriorMinX, PriorMinY, FineCellMetres_, DepX, DepY, DepZ, &Min8, &Max8);
                    const auto Back = SampleTrilinear(ThermoScratch_, Tx, Ty, Tz, WorldMinX, WorldMinY, FineCellMetres_,
                                                      Px + Vel0[0] * Dt, Py + Vel0[1] * Dt, Pz + (Vel0[2] + SlipZ) * Dt);
                    for (int C = 0; C < 4; ++C)
                    {
                        Val[C] = ClampScalar(Val[C] + 0.5f * (Here[C] - Back[C]), Min8[C], Max8[C]);
                    }
                }

                // Combustion: burning reaction progress sheds soot and superheats local gas.
                const float Burning = std::max(Val[2], 0.0f) * Dt;
                Val[1] += Burning * Footprint_.Combustion[1];
                Val[3] += Burning * Footprint_.Combustion[0];

                // Retention decay.
                Val[0] *= Footprint_.Retention[0];
                Val[1] *= Footprint_.Retention[1];
                Val[2] *= Footprint_.Retention[2];
                Val[3] *= Footprint_.Combustion[2];

                // Gaussian source injection.
                for (const PlumeSourceFootprint& Src : Sources_)
                {
                    const float Dx = Px - Src.PositionRadius[0];
                    const float Dy = Py - Src.PositionRadius[1];
                    const float Dz = Pz - Src.PositionRadius[2];
                    const float R  = std::max(Src.PositionRadius[3], 0.65f * FineCellMetres_);
                    const float D2 = (Dx * Dx + Dy * Dy + Dz * Dz) / (R * R);
                    if (D2 < 9.0f)
                    {
                        const float Weight = std::exp(-0.5f * D2) * Dt;
                        Val[0] += Src.Rates[0] * Weight;
                        Val[1] += Src.Rates[1] * Weight;
                        Val[2] += Src.Rates[2] * Weight;
                        Val[3] += Src.Rates[3] * Weight;
                    }
                }

                Val[0] = ClampScalar(Val[0], 0.0f, 64.0f);
                Val[1] = ClampScalar(Val[1], 0.0f, 4096.0f);
                Val[2] = ClampScalar(Val[2], 0.0f, 16.0f);
                Val[3] = ClampScalar(Val[3], 0.0f, 64.0f);

                for (int C = 0; C < 4; ++C)
                {
                    ThermoBackward_[I4 + static_cast<std::size_t>(C)] = Val[C];
                }

                Diagnostics_.PeakSmokeDensity = std::max(Diagnostics_.PeakSmokeDensity, Val[0] + Val[3]);
                Diagnostics_.PeakHeatKelvin   = std::max(Diagnostics_.PeakHeatKelvin,   Val[1]);
                Diagnostics_.PeakFlameScalar  = std::max(Diagnostics_.PeakFlameScalar,  Val[2]);

                if (Val[0] > 0.002f || Val[3] > 0.002f || Val[2] > 0.01f)
                {
                    CoverageLow_[0]  = std::min(CoverageLow_[0],  X);
                    CoverageLow_[1]  = std::min(CoverageLow_[1],  Y);
                    CoverageLow_[2]  = std::min(CoverageLow_[2],  Z);
                    CoverageHigh_[0] = std::max(CoverageHigh_[0], X);
                    CoverageHigh_[1] = std::max(CoverageHigh_[1], Y);
                    CoverageHigh_[2] = std::max(CoverageHigh_[2], Z);
                    const std::size_t BIdx = ((static_cast<std::size_t>(Z / 8) * MacroBrickExtent_[1] +
                                               static_cast<std::size_t>(Y / 8)) * MacroBrickExtent_[0] +
                                              static_cast<std::size_t>(X / 8));
                    if (BIdx < MacroOccupancy_.size())
                    {
                        MacroOccupancy_[BIdx] = 1u;
                    }
                    ++ActiveCells;
                }
            }
        }
    }
    ThermoCurrent_.swap(ThermoBackward_);
    Diagnostics_.ActiveVolumeCubicM = static_cast<float>(ActiveCells) * FineCellMetres_ * FineCellMetres_ * FineCellMetres_;

    // 6. Sun & zenith self-shadow transmittance restricted to active coarse envelope!
    const std::array<float, 3> SunDir = { Footprint_.Sun[0], Footprint_.Sun[1], Footprint_.Sun[2] };
    auto OpticalDepth = [&](float Px, float Py, float Pz, float Dx, float Dy, float Dz) noexcept -> float
    {
        float Depth  = 0.0f;
        float Travel = 0.25f * CoarseCellMetres_;
        for (int Step = 0; Step < 8; ++Step)
        {
            const float Length = FineCellMetres_ * (1.0f + 0.6f * static_cast<float>(Step));
            const float Sx     = Px + Dx * (Travel + 0.5f * Length);
            const float Sy     = Py + Dy * (Travel + 0.5f * Length);
            const float Sz     = Pz + Dz * (Travel + 0.5f * Length);
            const auto  Th     = SampleTrilinear(ThermoCurrent_, Tx, Ty, Tz, WorldMinX, WorldMinY, FineCellMetres_, Sx, Sy, Sz);
            Depth  += (Th[0] * Parameters_.SmokeExtinction + Th[3] * Parameters_.SootExtinction) * Length;
            Travel += Length;
        }
        return Depth;
    };

    std::fill(LightTransmittance_.begin(), LightTransmittance_.end(), 1.0f);
    if (CoverageLow_[0] <= CoverageHigh_[0])
    {
        const std::int32_t LMinX = std::max(0, CoverageLow_[0] / 2 - 2);
        const std::int32_t LMaxX = std::min(Vx - 1, CoverageHigh_[0] / 2 + 2);
        const std::int32_t LMinY = std::max(0, CoverageLow_[1] / 2 - 2);
        const std::int32_t LMaxY = std::min(Vy - 1, CoverageHigh_[1] / 2 + 2);
        const std::int32_t LMinZ = std::max(0, CoverageLow_[2] / 2 - 2);
        const std::int32_t LMaxZ = std::min(Vz - 1, CoverageHigh_[2] / 2 + 2);
        for (std::int32_t Z = LMinZ; Z <= LMaxZ; ++Z)
        {
            const float Pz = FloorWorldZ + (static_cast<float>(Z) + 0.5f) * CoarseCellMetres_;
            for (std::int32_t Y = LMinY; Y <= LMaxY; ++Y)
            {
                const float Py = WorldMinY + (static_cast<float>(Y) + 0.5f) * CoarseCellMetres_;
                for (std::int32_t X = LMinX; X <= LMaxX; ++X)
                {
                    const float Px = WorldMinX + (static_cast<float>(X) + 0.5f) * CoarseCellMetres_;
                    const std::size_t I2 = CoarseIdx(X, Y, Z) * 2u;
                    LightTransmittance_[I2 + 0u] = std::exp(-0.65f * OpticalDepth(Px, Py, Pz, SunDir[0], SunDir[1], SunDir[2]));
                    LightTransmittance_[I2 + 1u] = std::exp(-0.50f * OpticalDepth(Px, Py, Pz, 0.0f, 0.0f, 1.0f));
                }
            }
        }
    }

    return Diagnostics_;
}

//------------------------------------------------------------------------------------------------------------------------
//                                           SINGLE-RAY & VIEW VOLUME MARCHING
//------------------------------------------------------------------------------------------------------------------------

std::array<float, 4> PlumeFluid::EvaluatePlumeRay(
    const std::array<float, 3>& Origin,
    const std::array<float, 3>& Direction,
    float                       MaxDistance,
    float                       JitterOffset,
    const std::array<float, 3>& SunDirection,
    const std::array<float, 3>& SunIlluminance,
    const std::array<float, 3>& SkyRadiance) const noexcept
{
    if (CoverageLow_[0] > CoverageHigh_[0] || CoverageLow_[1] > CoverageHigh_[1] || CoverageLow_[2] > CoverageHigh_[2])
    {
        return { 0.0f, 0.0f, 0.0f, 1.0f };
    }

    const float WorldMinX = static_cast<float>(OriginXY_[0]) * CoarseCellMetres_;
    const float WorldMinY = static_cast<float>(OriginXY_[1]) * CoarseCellMetres_;

    const std::array<float, 3> BoxMin = {
        WorldMinX + static_cast<float>(CoverageLow_[0] - 1) * FineCellMetres_,
        WorldMinY + static_cast<float>(CoverageLow_[1] - 1) * FineCellMetres_,
        FloorWorldZ + static_cast<float>(CoverageLow_[2] - 1) * FineCellMetres_
    };
    const std::array<float, 3> BoxMax = {
        WorldMinX + static_cast<float>(CoverageHigh_[0] + 2) * FineCellMetres_,
        WorldMinY + static_cast<float>(CoverageHigh_[1] + 2) * FineCellMetres_,
        FloorWorldZ + static_cast<float>(CoverageHigh_[2] + 2) * FineCellMetres_
    };

    float Enter = 0.0f;
    float Exit  = MaxDistance;
    for (int Axis = 0; Axis < 3; ++Axis)
    {
        const float D = Direction[Axis];
        if (std::fabs(D) < 1.0e-8f)
        {
            if (Origin[Axis] < BoxMin[Axis] || Origin[Axis] > BoxMax[Axis])
            {
                return { 0.0f, 0.0f, 0.0f, 1.0f };
            }
        }
        else
        {
            const float Inv = 1.0f / D;
            const float T0  = (BoxMin[Axis] - Origin[Axis]) * Inv;
            const float T1  = (BoxMax[Axis] - Origin[Axis]) * Inv;
            Enter = std::max(Enter, std::min(T0, T1));
            Exit  = std::min(Exit,  std::max(T0, T1));
        }
    }
    if (Exit <= Enter)
    {
        return { 0.0f, 0.0f, 0.0f, 1.0f };
    }

    const std::int32_t Tx = static_cast<std::int32_t>(ThermoExtent_[0]);
    const std::int32_t Ty = static_cast<std::int32_t>(ThermoExtent_[1]);
    const std::int32_t Tz = static_cast<std::int32_t>(ThermoExtent_[2]);
    const std::int32_t Vx = static_cast<std::int32_t>(VelocityExtent_[0]);
    const std::int32_t Vy = static_cast<std::int32_t>(VelocityExtent_[1]);
    const std::int32_t Vz = static_cast<std::int32_t>(VelocityExtent_[2]);

    auto SampleThermoPoint = [&](float Px, float Py, float Pz) noexcept -> std::array<float, 4>
    {
        const float Gx = (Px - WorldMinX) / FineCellMetres_ - 0.5f;
        const float Gy = (Py - WorldMinY) / FineCellMetres_ - 0.5f;
        const float Gz = (Pz - FloorWorldZ) / FineCellMetres_ - 0.5f;
        if (Gx < 0.0f || Gy < 0.0f || Gz < 0.0f ||
            Gx >= static_cast<float>(Tx - 1) || Gy >= static_cast<float>(Ty - 1) || Gz >= static_cast<float>(Tz - 1))
        {
            return { 0.0f, 0.0f, 0.0f, 0.0f };
        }
        const std::int32_t X0 = static_cast<std::int32_t>(Gx);
        const std::int32_t Y0 = static_cast<std::int32_t>(Gy);
        const std::int32_t Z0 = static_cast<std::int32_t>(Gz);
        const float Fx = Gx - static_cast<float>(X0);
        const float Fy = Gy - static_cast<float>(Y0);
        const float Fz = Gz - static_cast<float>(Z0);

        auto At = [&](std::int32_t X, std::int32_t Y, std::int32_t Z) noexcept -> const float*
        {
            const std::size_t Idx = ((static_cast<std::size_t>(Z) * static_cast<std::size_t>(Ty) + static_cast<std::size_t>(Y)) *
                                         static_cast<std::size_t>(Tx) +
                                     static_cast<std::size_t>(X)) * 4u;
            return &ThermoCurrent_[Idx];
        };
        const float* P000 = At(X0, Y0, Z0); const float* P100 = At(X0 + 1, Y0, Z0);
        const float* P010 = At(X0, Y0 + 1, Z0); const float* P110 = At(X0 + 1, Y0 + 1, Z0);
        const float* P001 = At(X0, Y0, Z0 + 1); const float* P101 = At(X0 + 1, Y0, Z0 + 1);
        const float* P011 = At(X0, Y0 + 1, Z0 + 1); const float* P111 = At(X0 + 1, Y0 + 1, Z0 + 1);

        std::array<float, 4> Out{};
        for (int C = 0; C < 4; ++C)
        {
            const float C00 = P000[C] + (P100[C] - P000[C]) * Fx;
            const float C10 = P010[C] + (P110[C] - P010[C]) * Fx;
            const float C01 = P001[C] + (P101[C] - P001[C]) * Fx;
            const float C11 = P011[C] + (P111[C] - P011[C]) * Fx;
            Out[C] = std::max(0.0f, (C00 + (C10 - C00) * Fy) * (1.0f - Fz) + (C01 + (C11 - C01) * Fy) * Fz);
        }
        return Out;
    };

    auto SampleCoarseVelocityAndLight = [&](float Px, float Py, float Pz, std::array<float, 2>& OutLight) noexcept -> std::array<float, 3>
    {
        const float Gx = ClampScalar((Px - WorldMinX) / CoarseCellMetres_ - 0.5f, 0.0f, static_cast<float>(Vx - 1) - 1.0e-5f);
        const float Gy = ClampScalar((Py - WorldMinY) / CoarseCellMetres_ - 0.5f, 0.0f, static_cast<float>(Vy - 1) - 1.0e-5f);
        const float Gz = ClampScalar((Pz - FloorWorldZ) / CoarseCellMetres_ - 0.5f, 0.0f, static_cast<float>(Vz - 1) - 1.0e-5f);
        const std::int32_t X0 = static_cast<std::int32_t>(std::floor(Gx));
        const std::int32_t Y0 = static_cast<std::int32_t>(std::floor(Gy));
        const std::int32_t Z0 = static_cast<std::int32_t>(std::floor(Gz));
        const std::int32_t X1 = std::min(X0 + 1, Vx - 1);
        const std::int32_t Y1 = std::min(Y0 + 1, Vy - 1);
        const std::int32_t Z1 = std::min(Z0 + 1, Vz - 1);
        const float Fx = Gx - static_cast<float>(X0);
        const float Fy = Gy - static_cast<float>(Y0);
        const float Fz = Gz - static_cast<float>(Z0);

        auto CIdx = [&](std::int32_t X, std::int32_t Y, std::int32_t Z) noexcept -> std::size_t
        {
            return (static_cast<std::size_t>(Z) * static_cast<std::size_t>(Vy) + static_cast<std::size_t>(Y)) *
                       static_cast<std::size_t>(Vx) +
                   static_cast<std::size_t>(X);
        };
        const std::size_t I000 = CIdx(X0, Y0, Z0), I100 = CIdx(X1, Y0, Z0);
        const std::size_t I010 = CIdx(X0, Y1, Z0), I110 = CIdx(X1, Y1, Z0);
        const std::size_t I001 = CIdx(X0, Y0, Z1), I101 = CIdx(X1, Y0, Z1);
        const std::size_t I011 = CIdx(X0, Y1, Z1), I111 = CIdx(X1, Y1, Z1);

        auto Trilerp = [&](const std::vector<float>& Arr, std::size_t Stride, std::size_t Comp) noexcept -> float
        {
            const float C00 = Arr[I000 * Stride + Comp] * (1.0f - Fx) + Arr[I100 * Stride + Comp] * Fx;
            const float C10 = Arr[I010 * Stride + Comp] * (1.0f - Fx) + Arr[I110 * Stride + Comp] * Fx;
            const float C01 = Arr[I001 * Stride + Comp] * (1.0f - Fx) + Arr[I101 * Stride + Comp] * Fx;
            const float C11 = Arr[I011 * Stride + Comp] * (1.0f - Fx) + Arr[I111 * Stride + Comp] * Fx;
            return (C00 * (1.0f - Fy) + C10 * Fy) * (1.0f - Fz) + (C01 * (1.0f - Fy) + C11 * Fy) * Fz;
        };

        OutLight = { Trilerp(LightTransmittance_, 2u, 0u), Trilerp(LightTransmittance_, 2u, 1u) };
        return { Trilerp(VelocityCurrent_, 4u, 0u), Trilerp(VelocityCurrent_, 4u, 1u), Trilerp(VelocityCurrent_, 4u, 2u) };
    };

    const float StrideScale = (Parameters_.Variant == PlumeSolverVariant::ProductionUpgraded) ? 0.58f : 0.90f;
    const std::uint32_t StepCount = static_cast<std::uint32_t>(
        ClampScalar(std::ceil((Exit - Enter) / (StrideScale * FineCellMetres_)), 6.0f, static_cast<float>(Parameters_.MarchSampleLimit)));
    const float Step = (Exit - Enter) / static_cast<float>(StepCount);

    const float Cosine = Direction[0] * SunDirection[0] + Direction[1] * SunDirection[1] + Direction[2] * SunDirection[2];
    const float Phase0 = EvaluateDualLobeSmokePhase(Cosine, Parameters_.PhaseAnisotropy);
    const float Phase1 = EvaluateDualLobeSmokePhase(Cosine, 0.50f * Parameters_.PhaseAnisotropy);
    const float Phase2 = EvaluateDualLobeSmokePhase(Cosine, 0.25f * Parameters_.PhaseAnisotropy);

    const float SmokeExtCoeff = (Parameters_.Variant == PlumeSolverVariant::LegacyHtmlReference) ? 3.60f : Parameters_.SmokeExtinction;
    const float Flicker       = 0.5f + 0.5f * std::sin(ElapsedSeconds_ * 23.0f);

    std::array<float, 3> Radiance = { 0.0f, 0.0f, 0.0f };
    float Transmittance = 1.0f;

    for (std::uint32_t Index = 0u; Index < StepCount && Transmittance > 0.008f; ++Index)
    {
        const float T = Enter + (static_cast<float>(Index) + JitterOffset) * Step;
        const std::array<float, 3> Pos = {
            Origin[0] + Direction[0] * T,
            Origin[1] + Direction[1] * T,
            Origin[2] + Direction[2] * T
        };

        // Fast O(1) 8x8x8 macro-occupancy brick skip before any 8-corner trilinear lookup!
        if (!MacroOccupancy_.empty())
        {
            const std::int32_t Bx = static_cast<std::int32_t>(std::floor((Pos[0] - WorldMinX) / FineCellMetres_)) / 8;
            const std::int32_t By = static_cast<std::int32_t>(std::floor((Pos[1] - WorldMinY) / FineCellMetres_)) / 8;
            const std::int32_t Bz = static_cast<std::int32_t>(std::floor((Pos[2] - FloorWorldZ) / FineCellMetres_)) / 8;
            if (Bx < 0 || By < 0 || Bz < 0 ||
                Bx >= static_cast<std::int32_t>(MacroBrickExtent_[0]) ||
                By >= static_cast<std::int32_t>(MacroBrickExtent_[1]) ||
                Bz >= static_cast<std::int32_t>(MacroBrickExtent_[2]))
            {
                continue;
            }
            const std::size_t BIdx = ((static_cast<std::size_t>(Bz) * MacroBrickExtent_[1] +
                                       static_cast<std::size_t>(By)) * MacroBrickExtent_[0] +
                                      static_cast<std::size_t>(Bx));
            if (MacroOccupancy_[BIdx] == 0u)
            {
                ++Index; // Double-step across empty 8x8x8 macro-bricks!
                continue;
            }
        }

        auto Thermo = SampleThermoPoint(Pos[0], Pos[1], Pos[2]);
        if (Thermo[0] < 1.0e-3f && Thermo[3] < 1.0e-3f && Thermo[2] < 1.0e-3f)
        {
            continue;
        }

        std::array<float, 2> SelfShadow = { 1.0f, 1.0f };
        const auto LocalVel = SampleCoarseVelocityAndLight(Pos[0], Pos[1], Pos[2], SelfShadow);

        // Skip expensive high-frequency erosion deep inside already-opaque soot cores (Transmittance < 0.14)
        const float Noise = (Transmittance > 0.14f || Thermo[2] > 0.015f)
            ? EvaluateDetailFieldSample(
                  Pos, LocalVel, ElapsedSeconds_, Parameters_.DetailFrequency, Parameters_.FlowWarpStrength, Parameters_.Variant)
            : 0.50f;

        auto ErodeDensity = [&](float Density) noexcept -> float
        {
            const float Thin = 1.0f - ClampScalar(Density * 0.65f, 0.0f, 1.0f);
            return std::max(0.0f,
                Density * (1.0f + Parameters_.DetailStrength * (Noise - 0.5f) * 1.68f) -
                Parameters_.DetailStrength * Thin * (1.0f - Noise) * 0.48f * std::min(Density, 1.3f));
        };

        const float SmokeDensity = ErodeDensity(Thermo[0]);
        const float SootDensity  = ErodeDensity(Thermo[3]);

        float FlameEmissionScale = 0.0f;
        float FlameKelvin        = Parameters_.FlameTipKelvin;
        float FlameExtinction    = 0.0f;

        if (Parameters_.Variant == PlumeSolverVariant::LegacyHtmlReference)
        {
            // Blurry linear HTML flame formulation.
            const float BlurryFlame = Thermo[2] * (0.45f + 1.10f * (0.75f * Noise + 0.25f * Flicker));
            const float HeatRatio   = Thermo[1] / (Thermo[1] + Parameters_.FlameHalfHeat);
            FlameKelvin             = Parameters_.FlameTipKelvin + (1800.0f - Parameters_.FlameTipKelvin) * HeatRatio;
            FlameEmissionScale      = 80.0f * std::min(BlurryFlame, 1.5f);
            FlameExtinction         = BlurryFlame * 0.80f;
        }
        else if (Thermo[2] > 0.015f)
        {
            // Production crisp premixed reaction-sheet level-set sharpening:
            // High-frequency turbulent wrinkling erodes the outer reaction contour cleanly to zero instead of leaving a blurry halo,
            // while core reaction zones reach incandescent 3100 K white-yellow surrounded by vivid orange tongues and dark soot tips.
            const float Wrinkle     = (Noise - 0.46f) * 0.56f + (Flicker - 0.5f) * 0.12f;
            const float ErodedFuel  = std::max(0.0f, Thermo[2] + Wrinkle * std::min(Thermo[2] * 1.6f, 0.85f));
            const float SheetMask   = SmoothStepScalar(0.16f, 0.88f, ErodedFuel);
            const float CrispFlame  = std::pow(SheetMask, Parameters_.FlameSheetSharpness);
            const float CoreFactor  = SmoothStepScalar(0.42f, 1.25f, ErodedFuel * (0.65f + 0.35f * Thermo[1] / (Thermo[1] + Parameters_.FlameHalfHeat)));
            FlameKelvin             = Parameters_.FlameTipKelvin + (Parameters_.FlameCoreKelvin - Parameters_.FlameTipKelvin) * CoreFactor;
            FlameEmissionScale      = Parameters_.FlameRadianceScale * CrispFlame;
            FlameExtinction         = CrispFlame * 0.55f;
        }

        const float SmokeExt    = SmokeDensity * SmokeExtCoeff;
        const float SootExt     = SootDensity  * Parameters_.SootExtinction;
        const float Particulate = SmokeExt + SootExt;
        const float Extinction  = Particulate + FlameExtinction;
        if (Extinction < 1.0e-4f && FlameEmissionScale < 1.0e-4f)
        {
            continue;
        }

        const float Absorbed = 1.0f - std::exp(-Extinction * Step);
        const float Albedo   = (Particulate > 1.0e-5f)
            ? ((SmokeExt * Parameters_.SmokeAlbedo + SootExt * Parameters_.SootAlbedo) / Particulate)
            : 0.0f;
        const float Share    = (Extinction > 1.0e-5f) ? (Particulate / Extinction) : 0.0f;

        // Beers-Powder dark-edge / bright-silver-lining + O(1) single-voxel sun-gradient billowing lobe relief!
        float Powder = 1.0f;
        if (Parameters_.Variant == PlumeSolverVariant::ProductionUpgraded)
        {
            Powder = 1.0f - 0.54f * std::exp(-2.4f * Extinction * Step);
            if (Transmittance > 0.22f && Particulate > 0.12f)
            {
                const float ProbeH = 1.35f * FineCellMetres_;
                const std::int32_t Sx = std::clamp(static_cast<std::int32_t>((Pos[0] + SunDirection[0] * ProbeH - WorldMinX) / FineCellMetres_), 0, Tx - 1);
                const std::int32_t Sy = std::clamp(static_cast<std::int32_t>((Pos[1] + SunDirection[1] * ProbeH - WorldMinY) / FineCellMetres_), 0, Ty - 1);
                const std::int32_t Sz = std::clamp(static_cast<std::int32_t>((Pos[2] + SunDirection[2] * ProbeH - FloorWorldZ) / FineCellMetres_), 0, Tz - 1);
                const std::size_t  S4 = ((static_cast<std::size_t>(Sz) * static_cast<std::size_t>(Ty) + static_cast<std::size_t>(Sy)) *
                                             static_cast<std::size_t>(Tx) +
                                         static_cast<std::size_t>(Sx)) * 4u;
                const float RhoHere    = Thermo[0] + Thermo[3];
                const float RhoSun     = ThermoCurrent_[S4 + 0u] + ThermoCurrent_[S4 + 3u];
                const float LobeRelief = ClampScalar((RhoHere - RhoSun) / std::max(0.25f, RhoHere), -0.60f, 0.85f);
                Powder *= (1.0f + 0.62f * LobeRelief);
            }
        }

        const float ShadowSqrt  = std::sqrt(std::max(0.0f, SelfShadow[0]));
        const float ShadowQuart = std::sqrt(ShadowSqrt);
        const float Shadow16th  = std::sqrt(std::sqrt(ShadowQuart));
        const float MultiOctave = Phase0 * SelfShadow[0] +
                                  Parameters_.MultiScatterGain * Albedo *
                                      (0.60f * Phase1 * ShadowQuart +
                                       0.36f * Phase2 * Shadow16th);

        std::array<float, 3> FireIrradiance = { 0.0f, 0.0f, 0.0f };
        for (std::uint32_t L = 0u; L < std::min(FireLights_.Count[0], 4u); ++L)
        {
            const float Dx   = FireLights_.PositionRadius[L][0] - Pos[0];
            const float Dy   = FireLights_.PositionRadius[L][1] - Pos[1];
            const float Dz   = FireLights_.PositionRadius[L][2] - Pos[2];
            const float R    = FireLights_.PositionRadius[L][3];
            const float Atten = 0.07957747f / (Dx * Dx + Dy * Dy + Dz * Dz + R * R);
            FireIrradiance[0] += FireLights_.Radiance[L][0] * Atten;
            FireIrradiance[1] += FireLights_.Radiance[L][1] * Atten;
            FireIrradiance[2] += FireLights_.Radiance[L][2] * Atten;
        }

        const float SkyOcc       = 0.18f + 0.82f * std::pow(SelfShadow[1], 0.6f);
        const float GroundFactor = std::max(SunDirection[2], 0.0f) * 0.12f * InversePiConstant;
        std::array<float, 3> Blackbody = { 0.0f, 0.0f, 0.0f };
        if (FlameEmissionScale > 0.0f)
        {
            if (Parameters_.Variant == PlumeSolverVariant::ProductionUpgraded)
            {
                // Saturated 4-stop pyro emission ramp (Experimental/Fluid parity: prevents ACES HDR white desaturation):
                // [0.00] deep ember crimson -> [0.38] rich hydrocarbon orange -> [0.72] vivid amber-gold -> [1.00] white-gold core
                const float K = std::clamp(
                    (FlameKelvin - Parameters_.FlameTipKelvin) /
                    std::max(1.0f, Parameters_.FlameCoreKelvin - Parameters_.FlameTipKelvin),
                    0.0f, 1.0f);
                if (K < 0.38f)
                {
                    const float U = K / 0.38f;
                    Blackbody = { 0.85f + 0.15f * U, 0.05f + 0.27f * U, 0.005f + 0.020f * U };
                }
                else if (K < 0.74f)
                {
                    const float U = (K - 0.38f) / 0.36f;
                    Blackbody = { 1.00f, 0.32f + 0.40f * U, 0.025f + 0.115f * U };
                }
                else
                {
                    const float U = (K - 0.74f) / 0.26f;
                    Blackbody = { 1.00f, 0.72f + 0.23f * U, 0.14f + 0.54f * U };
                }
                const float ThermalGain = 0.28f + 1.55f * K * K;
                Blackbody[0] *= ThermalGain;
                Blackbody[1] *= ThermalGain;
                Blackbody[2] *= ThermalGain;
            }
            else
            {
                Blackbody = EvaluateBlackbodyRadiance(FlameKelvin);
            }
        }

        // Experimental/Fluid internal pyro scattering: hot gas & internal fire lights glow right around active reaction seats,
        // leaving the upper cooling carbonaceous soot column deep dark charcoal-grey with sunlit silver-amber rims!
        const float LocalHeatGlow = (Parameters_.Variant == PlumeSolverVariant::ProductionUpgraded)
            ? (SmoothStepScalar(230.0f, 460.0f, Thermo[1]) * SmoothStepScalar(0.06f, 0.55f, Thermo[2]) *
               std::exp(-(SmokeDensity + SootDensity) * 1.35f))
            : 0.0f;
        const float NearSeatMask = std::exp(-(SmokeDensity + SootDensity) * 1.45f);
        const std::array<float, 3> InternalEmber = {
            (std::min(1.6f, FireIrradiance[0] * 0.11f) + 1.85f * LocalHeatGlow) * NearSeatMask,
            (std::min(0.62f, FireIrradiance[1] * 0.09f) + 0.52f * LocalHeatGlow) * NearSeatMask,
            (std::min(0.14f, FireIrradiance[2] * 0.06f) + 0.06f * LocalHeatGlow) * NearSeatMask
        };
        const float EffectivePath = (Extinction > 1.0e-4f) ? (Absorbed / Extinction) : Step;

        for (int C = 0; C < 3; ++C)
        {
            const float ExtScatter = (SunIlluminance[C] * MultiOctave * Powder +
                                      SkyRadiance[C] * SkyOcc +
                                      SunIlluminance[C] * GroundFactor) *
                                     (Albedo * Share * Absorbed);
            const float IntScatter = InternalEmber[C] * (Share * Absorbed * 0.68f);
            const float FlameRad   = Blackbody[C] * FlameEmissionScale * EffectivePath;
            Radiance[C] += Transmittance * (ExtScatter + IntScatter + FlameRad);
        }
        Transmittance *= (1.0f - Absorbed);
    }

    return { Radiance[0], Radiance[1], Radiance[2], Transmittance };
}

float PlumeFluid::EvaluateShadowTransmittance(
    const std::array<float, 3>& Origin,
    const std::array<float, 3>& Direction,
    float                       MaxDistance) const noexcept
{
    if (CoverageLow_[0] > CoverageHigh_[0] || MaxDistance <= 1.0e-4f)
    {
        return 1.0f;
    }

    const float WorldMinX = static_cast<float>(OriginXY_[0]) * CoarseCellMetres_;
    const float WorldMinY = static_cast<float>(OriginXY_[1]) * CoarseCellMetres_;
    const std::array<float, 3> BoxMin = {
        WorldMinX + static_cast<float>(CoverageLow_[0]) * FineCellMetres_,
        WorldMinY + static_cast<float>(CoverageLow_[1]) * FineCellMetres_,
        FloorWorldZ + static_cast<float>(CoverageLow_[2]) * FineCellMetres_
    };
    const std::array<float, 3> BoxMax = {
        WorldMinX + static_cast<float>(CoverageHigh_[0] + 1) * FineCellMetres_,
        WorldMinY + static_cast<float>(CoverageHigh_[1] + 1) * FineCellMetres_,
        FloorWorldZ + static_cast<float>(CoverageHigh_[2] + 1) * FineCellMetres_
    };

    float TEnter = 0.0f;
    float TExit  = MaxDistance;
    for (int Axis = 0; Axis < 3; ++Axis)
    {
        const float D = Direction[static_cast<std::size_t>(Axis)];
        if (std::abs(D) < 1.0e-7f)
        {
            if (Origin[static_cast<std::size_t>(Axis)] < BoxMin[static_cast<std::size_t>(Axis)] ||
                Origin[static_cast<std::size_t>(Axis)] > BoxMax[static_cast<std::size_t>(Axis)])
            {
                return 1.0f;
            }
        }
        else
        {
            const float InvD = 1.0f / D;
            float T0 = (BoxMin[static_cast<std::size_t>(Axis)] - Origin[static_cast<std::size_t>(Axis)]) * InvD;
            float T1 = (BoxMax[static_cast<std::size_t>(Axis)] - Origin[static_cast<std::size_t>(Axis)]) * InvD;
            if (T0 > T1) std::swap(T0, T1);
            TEnter = std::max(TEnter, T0);
            TExit  = std::min(TExit,  T1);
            if (TExit <= TEnter)
            {
                return 1.0f;
            }
        }
    }

    const std::int32_t Tx = static_cast<std::int32_t>(ThermoExtent_[0]);
    const std::int32_t Ty = static_cast<std::int32_t>(ThermoExtent_[1]);
    const std::int32_t Tz = static_cast<std::int32_t>(ThermoExtent_[2]);
    const float Span      = TExit - TEnter;
    const int   Steps     = std::clamp(static_cast<int>(std::ceil(Span / (1.15f * FineCellMetres_))), 1, 32);
    const float Dt        = Span / static_cast<float>(Steps);

    float OpticalDepth = 0.0f;
    for (int S = 0; S < Steps; ++S)
    {
        const float T  = TEnter + (static_cast<float>(S) + 0.5f) * Dt;
        const float Px = Origin[0] + Direction[0] * T;
        const float Py = Origin[1] + Direction[1] * T;
        const float Pz = Origin[2] + Direction[2] * T;
        const float Gx = (Px - WorldMinX) / FineCellMetres_ - 0.5f;
        const float Gy = (Py - WorldMinY) / FineCellMetres_ - 0.5f;
        const float Gz = (Pz - FloorWorldZ) / FineCellMetres_ - 0.5f;
        if (Gx < 0.0f || Gy < 0.0f || Gz < 0.0f ||
            Gx >= static_cast<float>(Tx - 1) || Gy >= static_cast<float>(Ty - 1) || Gz >= static_cast<float>(Tz - 1))
        {
            continue;
        }
        const std::int32_t X0 = static_cast<std::int32_t>(Gx);
        const std::int32_t Y0 = static_cast<std::int32_t>(Gy);
        const std::int32_t Z0 = static_cast<std::int32_t>(Gz);
        const float Fx = Gx - static_cast<float>(X0);
        const float Fy = Gy - static_cast<float>(Y0);
        const float Fz = Gz - static_cast<float>(Z0);

        auto At4 = [&](std::int32_t X, std::int32_t Y, std::int32_t Z) noexcept -> const float*
        {
            const std::size_t Idx = ((static_cast<std::size_t>(Z) * static_cast<std::size_t>(Ty) +
                                      static_cast<std::size_t>(Y)) * static_cast<std::size_t>(Tx) +
                                     static_cast<std::size_t>(X)) * 4u;
            return &ThermoCurrent_[Idx];
        };
        const float* P000 = At4(X0, Y0, Z0);         const float* P100 = At4(X0 + 1, Y0, Z0);
        const float* P010 = At4(X0, Y0 + 1, Z0);     const float* P110 = At4(X0 + 1, Y0 + 1, Z0);
        const float* P001 = At4(X0, Y0, Z0 + 1);     const float* P101 = At4(X0 + 1, Y0, Z0 + 1);
        const float* P011 = At4(X0, Y0 + 1, Z0 + 1); const float* P111 = At4(X0 + 1, Y0 + 1, Z0 + 1);

        auto TrilerpComp = [&](int C) noexcept -> float
        {
            const float C00 = P000[C] + (P100[C] - P000[C]) * Fx;
            const float C10 = P010[C] + (P110[C] - P010[C]) * Fx;
            const float C01 = P001[C] + (P101[C] - P001[C]) * Fx;
            const float C11 = P011[C] + (P111[C] - P011[C]) * Fx;
            return std::max(0.0f, (C00 + (C10 - C00) * Fy) * (1.0f - Fz) + (C01 + (C11 - C01) * Fy) * Fz);
        };
        const float Smoke = TrilerpComp(0);
        const float Soot  = TrilerpComp(3);
        OpticalDepth += (Smoke * Parameters_.SmokeExtinction + Soot * Parameters_.SootExtinction) * Dt;
        if (OpticalDepth > 8.0f)
        {
            return 0.0f;
        }
    }
    return std::exp(-OpticalDepth);
}

std::array<float, 3> PlumeFluid::EvaluateSceneIllumination(
    const std::array<float, 3>& ReceiverPosition,
    const std::array<float, 3>& ReceiverNormal) const noexcept
{
    std::array<float, 3> Irradiance = { 0.0f, 0.0f, 0.0f };

    // 1. Active PlumeFireLightRecord point lobes (windowed inverse-square + self-plume soot attenuation).
    const std::uint32_t ActiveFires = std::min(FireLights_.Count[0], 4u);
    for (std::uint32_t I = 0u; I < ActiveFires; ++I)
    {
        const float Dx    = FireLights_.PositionRadius[I][0] - ReceiverPosition[0];
        const float Dy    = FireLights_.PositionRadius[I][1] - ReceiverPosition[1];
        const float Dz    = FireLights_.PositionRadius[I][2] - ReceiverPosition[2];
        const float Dist2 = Dx * Dx + Dy * Dy + Dz * Dz;
        constexpr float Reach = 18.0f;
        if (Dist2 >= Reach * Reach || Dist2 <= 1.0e-6f)
        {
            continue;
        }
        const float Dist  = std::sqrt(Dist2);
        const std::array<float, 3> Dir = { Dx / Dist, Dy / Dist, Dz / Dist };
        const float CosTheta = ReceiverNormal[0] * Dir[0] + ReceiverNormal[1] * Dir[1] + ReceiverNormal[2] * Dir[2];
        if (CosTheta <= 0.0f)
        {
            continue;
        }
        const float SoftR  = std::max(FireLights_.PositionRadius[I][3], 0.28f);
        const float Ratio2 = Dist2 / (Reach * Reach);
        const float Window = (1.0f - Ratio2) * (1.0f - Ratio2);
        const float PlumeT = (Dist > 1.2f)
            ? (0.35f + 0.65f * EvaluateShadowTransmittance(ReceiverPosition, Dir, Dist - 0.6f))
            : 1.0f;
        const float Scale  = CosTheta * Window * PlumeT / (Dist2 + SoftR * SoftR);
        Irradiance[0] += FireLights_.Radiance[I][0] * Scale;
        Irradiance[1] += FireLights_.Radiance[I][1] * Scale;
        Irradiance[2] += FireLights_.Radiance[I][2] * Scale;
    }

    // 2. Volumetric incandescent gas pockets (when transient explosions/flames burn in ThermoCurrent_ without wheel fire).
    if (Diagnostics_.PeakFlameScalar > 0.04f && CoverageLow_[0] <= CoverageHigh_[0])
    {
        const float WorldMinX = static_cast<float>(OriginXY_[0]) * CoarseCellMetres_;
        const float WorldMinY = static_cast<float>(OriginXY_[1]) * CoarseCellMetres_;
        const std::int32_t Tx = static_cast<std::int32_t>(ThermoExtent_[0]);
        const std::int32_t Ty = static_cast<std::int32_t>(ThermoExtent_[1]);
        const float CellVol   = FineCellMetres_ * FineCellMetres_ * FineCellMetres_;

        // Stride by 2 across active reaction bounds for bounded O(1)-fast hot-gas lighting!
        for (std::int32_t Z = CoverageLow_[2]; Z <= CoverageHigh_[2]; Z += 2)
        {
            const float Pz = FloorWorldZ + (static_cast<float>(Z) + 0.5f) * FineCellMetres_;
            for (std::int32_t Y = CoverageLow_[1]; Y <= CoverageHigh_[1]; Y += 2)
            {
                const float Py = WorldMinY + (static_cast<float>(Y) + 0.5f) * FineCellMetres_;
                for (std::int32_t X = CoverageLow_[0]; X <= CoverageHigh_[0]; X += 2)
                {
                    const std::size_t I4 = ((static_cast<std::size_t>(Z) * static_cast<std::size_t>(Ty) +
                                             static_cast<std::size_t>(Y)) * static_cast<std::size_t>(Tx) +
                                             static_cast<std::size_t>(X)) * 4u;
                    const float Flame = ThermoCurrent_[I4 + 2u];
                    const float Heat  = ThermoCurrent_[I4 + 1u];
                    if (Flame < 0.06f && Heat < 90.0f)
                    {
                        continue;
                    }
                    const float Px    = WorldMinX + (static_cast<float>(X) + 0.5f) * FineCellMetres_;
                    const float Dx    = Px - ReceiverPosition[0];
                    const float Dy    = Py - ReceiverPosition[1];
                    const float Dz    = Pz - ReceiverPosition[2];
                    const float Dist2 = Dx * Dx + Dy * Dy + Dz * Dz;
                    if (Dist2 > 196.0f || Dist2 < 1.0e-5f)
                    {
                        continue;
                    }
                    const float Dist     = std::sqrt(Dist2);
                    const float CosTheta = (ReceiverNormal[0] * Dx + ReceiverNormal[1] * Dy + ReceiverNormal[2] * Dz) / Dist;
                    if (CosTheta <= 0.0f)
                    {
                        continue;
                    }
                    const float Kelvin = Parameters_.FlameTipKelvin +
                                         (Parameters_.FlameCoreKelvin - Parameters_.FlameTipKelvin) *
                                             ClampScalar(Flame, 0.0f, 1.0f);
                    const auto Bb      = EvaluateBlackbodyRadiance(Kelvin);
                    const float Weight = (8.0f * CellVol) * Parameters_.FlameRadianceScale * 0.14f *
                                         ClampScalar(Flame + 0.002f * Heat, 0.0f, 2.0f) * CosTheta / (Dist2 + 0.35f);
                    Irradiance[0] += Bb[0] * Weight;
                    Irradiance[1] += Bb[1] * Weight;
                    Irradiance[2] += Bb[2] * Weight;
                }
            }
        }
    }

    return Irradiance;
}

void PlumeFluid::MarchVolumeView(
    const PlumeCameraView& View,
    const float*           OpaqueDistanceMetres,
    std::vector<float>&    OutPremultipliedRgba) const
{
    const std::size_t PixelCount = static_cast<std::size_t>(View.Width) * static_cast<std::size_t>(View.Height);
    OutPremultipliedRgba.assign(PixelCount * 4u, 0.0f);

    const float TanHalfY = std::tan(0.5f * View.VerticalFovRad);
    const float Aspect   = static_cast<float>(View.Width) / static_cast<float>(std::max(View.Height, 1u));
    const float TanHalfX = TanHalfY * Aspect;

    const bool HalfRateBlur = (Parameters_.Variant == PlumeSolverVariant::LegacyHtmlReference);
    const std::uint32_t StepDiv = HalfRateBlur ? 2u : 1u;
    const std::uint32_t TraceW  = std::max(1u, View.Width  / StepDiv);
    const std::uint32_t TraceH  = std::max(1u, View.Height / StepDiv);
    std::vector<float> TraceBuffer(static_cast<std::size_t>(TraceW) * TraceH * 4u, 0.0f);

    for (std::uint32_t Py = 0u; Py < TraceH; ++Py)
    {
        const float ScreenV = 1.0f - 2.0f * ((static_cast<float>(Py) + 0.5f) / static_cast<float>(TraceH));
        for (std::uint32_t Px = 0u; Px < TraceW; ++Px)
        {
            const float ScreenU = 2.0f * ((static_cast<float>(Px) + 0.5f) / static_cast<float>(TraceW)) - 1.0f;
            float Rx = View.CameraForward[0] + ScreenU * TanHalfX * View.CameraRight[0] + ScreenV * TanHalfY * View.CameraUp[0];
            float Ry = View.CameraForward[1] + ScreenU * TanHalfX * View.CameraRight[1] + ScreenV * TanHalfY * View.CameraUp[1];
            float Rz = View.CameraForward[2] + ScreenU * TanHalfX * View.CameraRight[2] + ScreenV * TanHalfY * View.CameraUp[2];
            const float InvLen = 1.0f / std::max(std::sqrt(Rx * Rx + Ry * Ry + Rz * Rz), 1.0e-6f);
            Rx *= InvLen; Ry *= InvLen; Rz *= InvLen;

            const std::size_t SrcPixel = static_cast<std::size_t>(std::min(Py * StepDiv, View.Height - 1u)) * View.Width +
                                         std::min(Px * StepDiv, View.Width - 1u);
            const float MaxDist = OpaqueDistanceMetres ? OpaqueDistanceMetres[SrcPixel] : 250.0f;

            const float IgNoise = std::fmod(52.9829189f * std::fmod(0.06711056f * static_cast<float>(Px) + 0.00583715f * static_cast<float>(Py), 1.0f) +
                                            0.61803398875f * static_cast<float>(View.SequenceOrdinal & 255u), 1.0f);
            const auto Sample = EvaluatePlumeRay(
                View.CameraOrigin, { Rx, Ry, Rz }, MaxDist, IgNoise, View.SunDirection, View.SunIlluminance, View.SkyRadiance);

            const std::size_t T4 = (static_cast<std::size_t>(Py) * TraceW + Px) * 4u;
            TraceBuffer[T4 + 0u] = Sample[0];
            TraceBuffer[T4 + 1u] = Sample[1];
            TraceBuffer[T4 + 2u] = Sample[2];
            TraceBuffer[T4 + 3u] = Sample[3];
        }
    }

    if (!HalfRateBlur)
    {
        OutPremultipliedRgba.swap(TraceBuffer);
        return;
    }

    // Bilinear upsample reproducing the half-resolution TraceScale=2 blur of LegacyHtmlReference.
    for (std::uint32_t Y = 0u; Y < View.Height; ++Y)
    {
        const float Gy = ClampScalar((static_cast<float>(Y) + 0.5f) * 0.5f - 0.5f, 0.0f, static_cast<float>(TraceH - 1u));
        const std::uint32_t Y0 = static_cast<std::uint32_t>(Gy);
        const std::uint32_t Y1 = std::min(Y0 + 1u, TraceH - 1u);
        const float Fy = Gy - static_cast<float>(Y0);
        for (std::uint32_t X = 0u; X < View.Width; ++X)
        {
            const float Gx = ClampScalar((static_cast<float>(X) + 0.5f) * 0.5f - 0.5f, 0.0f, static_cast<float>(TraceW - 1u));
            const std::uint32_t X0 = static_cast<std::uint32_t>(Gx);
            const std::uint32_t X1 = std::min(X0 + 1u, TraceW - 1u);
            const float Fx = Gx - static_cast<float>(X0);
            const std::size_t D4 = (static_cast<std::size_t>(Y) * View.Width + X) * 4u;
            for (std::size_t C = 0u; C < 4u; ++C)
            {
                const float V00 = TraceBuffer[(static_cast<std::size_t>(Y0) * TraceW + X0) * 4u + C];
                const float V10 = TraceBuffer[(static_cast<std::size_t>(Y0) * TraceW + X1) * 4u + C];
                const float V01 = TraceBuffer[(static_cast<std::size_t>(Y1) * TraceW + X0) * 4u + C];
                const float V11 = TraceBuffer[(static_cast<std::size_t>(Y1) * TraceW + X1) * 4u + C];
                OutPremultipliedRgba[D4 + C] = (V00 + (V10 - V00) * Fx) * (1.0f - Fy) + (V01 + (V11 - V01) * Fx) * Fy;
            }
        }
    }
}

} // namespace Frontier
