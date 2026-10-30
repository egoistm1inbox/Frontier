/*==========================================================================================================================================
                                                    EXPOSUREADAPTATION.CPP
==========================================================================================================================================*/
// 🧩 Eye-adaptation exposure integrator + Narkowicz ACES projection with dark-room emissive & ControlVehicle cabin protection.

#include "Engine/Rendering/ExposureAdaptation.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace Frontier
{
namespace
{
[[nodiscard]] float ResolveBoxShare(Vec3 Point, Vec3 Minimum, Vec3 Maximum, float SoftMetres) noexcept
{
    const float Dx = std::min(Point.X - Minimum.X, Maximum.X - Point.X);
    const float Dy = std::min(Point.Y - Minimum.Y, Maximum.Y - Point.Y);
    const float Dz = std::min(Point.Z - Minimum.Z, Maximum.Z - Point.Z);
    const float Inside = std::min({Dx, Dy, Dz});
    return std::clamp(Inside / std::max(SoftMetres, 1.0e-4f), 0.0f, 1.0f);
}

[[nodiscard]] uint8_t EncodeSrgb8(float LinearChannel) noexcept
{
    const float Clamped = std::clamp(LinearChannel, 0.0f, 1.0f);
    const float Srgb = (Clamped <= 0.0031308f)
        ? (12.92f * Clamped)
        : (1.055f * std::pow(Clamped, 1.0f / 2.4f) - 0.055f);
    return static_cast<uint8_t>(std::clamp(std::lround(Srgb * 255.0f), 0L, 255L));
}

} // namespace

float ExposureAdaptation::EvaluateVehicleCabinShare(Vec3 VehicleBodyLocalPosition) noexcept
{
    const float Greenhouse = ResolveBoxShare(
        VehicleBodyLocalPosition,
        Vec3{-0.95f, -1.04f, -0.12f},
        Vec3{ 1.33f,  1.04f,  1.19f},
        0.04f);
    const float Tub = ResolveBoxShare(
        VehicleBodyLocalPosition,
        Vec3{-1.85f, -1.02f, -0.12f},
        Vec3{ 1.38f,  1.02f,  0.60f},
        0.04f);
    return std::max(Greenhouse, Tub);
}

float ExposureAdaptation::ResolveLuminance(Vec3 LinearRadiance) noexcept
{
    return std::max(0.0f, 0.2126f * LinearRadiance.X + 0.7152f * LinearRadiance.Y + 0.0722f * LinearRadiance.Z);
}

Vec3 ExposureAdaptation::ProjectNarkowiczAces(Vec3 ExposedRadiance) noexcept
{
    auto ProjectChannel = [](float X) noexcept
    {
        const float P = std::max(0.0f, X);
        return std::clamp((P * (2.51f * P + 0.03f)) / (P * (2.43f * P + 0.59f) + 0.14f), 0.0f, 1.0f);
    };
    return {
        ProjectChannel(ExposedRadiance.X),
        ProjectChannel(ExposedRadiance.Y),
        ProjectChannel(ExposedRadiance.Z)};
}

Vec3 ExposureAdaptation::EncodeDisplayReferredScreenRadiance(
    Vec3  LinearDisplaySrgb,
    float CurrentExposureGain) noexcept
{
    const float SafeExposure = (CurrentExposureGain > 1.0e-5f) ? CurrentExposureGain : 1.0f;
    auto InvertChannel = [SafeExposure](float DisplayChannel) noexcept
    {
        const float Y = std::clamp(DisplayChannel, 0.0f, 0.99f);
        const float A = 2.51f - 2.43f * Y;
        const float B = 0.03f - 0.59f * Y;
        const float X = (-B + std::sqrt(std::max(0.0f, B * B + 0.56f * A * Y))) / (2.0f * A);
        return std::max(0.0f, X / SafeExposure);
    };
    return {
        InvertChannel(LinearDisplaySrgb.X),
        InvertChannel(LinearDisplaySrgb.Y),
        InvertChannel(LinearDisplaySrgb.Z)};
}

void ExposureAdaptation::IntegrateExposure(
    const std::vector<Vec3>& HdrLinearBuffer,
    uint32_t                 Width,
    uint32_t                 Height,
    const ExposureSettings&  Settings,
    ExposureAdaptationState& InOutState,
    bool                     InstantConverge) noexcept
{
    if (Width == 0u || Height == 0u || HdrLinearBuffer.size() < static_cast<std::size_t>(Width) * Height)
    {
        return;
    }

    constexpr uint32_t LatticeDim   = 64u;
    constexpr uint32_t SampleCount  = LatticeDim * LatticeDim;
    std::array<float, SampleCount> Luminances{};
    double Log2Sum = 0.0;

    for (uint32_t Index = 0u; Index < SampleCount; ++Index)
    {
        const float U = (static_cast<float>(Index % LatticeDim) + 0.5f) / static_cast<float>(LatticeDim);
        const float V = (static_cast<float>(Index / LatticeDim) + 0.5f) / static_cast<float>(LatticeDim);
        const uint32_t Px = std::min(Width - 1u, static_cast<uint32_t>(U * static_cast<float>(Width)));
        const uint32_t Py = std::min(Height - 1u, static_cast<uint32_t>(V * static_cast<float>(Height)));
        const float Lum = ResolveLuminance(HdrLinearBuffer[static_cast<std::size_t>(Py) * Width + Px]);
        Luminances[Index] = Lum;
        Log2Sum += std::log2(std::max(Lum, 1.0e-5f));
    }

    std::sort(Luminances.begin(), Luminances.end());
    const float MedianLum = Luminances[SampleCount / 2u];
    const float P98Lum    = Luminances[(SampleCount * 98u) / 100u];
    const float LogAvg    = static_cast<float>(Log2Sum / static_cast<double>(SampleCount));
    const float AvgLum    = std::exp2(LogAvg);

    const float CompensationScale = std::exp2(Settings.ExposureCompensationEv);
    float TargetGain = Settings.ManualExposureGain * CompensationScale;
    bool  ClampedByProtection = false;

    if (Settings.AutoExposureEnabled)
    {
        // Standard eye adaptation (DisplayExposure.wgsl): partial adaptation below mesopic floor 0.1
        const float FloorLog = std::log2(0.10f);
        const float AdaptedLog = (LogAvg < FloorLog)
            ? (FloorLog + (LogAvg - FloorLog) * 0.66f)
            : LogAvg;
        TargetGain = std::clamp(Settings.MiddleGreyKey / std::exp2(AdaptedLog), 0.02f, 60.0f) * CompensationScale;

        // Protect dark rooms lit by emissive lighting & dark vehicle cabins so exposure NEVER boosts/washes them out!
        float ProtectionWeight = 0.0f;
        if (Settings.ProtectVehicleCabins)
        {
            ProtectionWeight = std::max(ProtectionWeight, std::clamp(Settings.VehicleCabinShare01, 0.0f, 1.0f));
        }
        if (Settings.ProtectDarkEmissiveInteriors)
        {
            if (Settings.CameraInDarkEmissiveInterior)
            {
                ProtectionWeight = 1.0f;
            }
            else if (MedianLum < 0.065f && P98Lum > std::max(0.28f, MedianLum * 8.0f))
            {
                // Auto-detected dark room / dark cockpit where dark walls surround localized emissive fixtures/screens:
                const float DarknessFactor = std::clamp((0.065f - MedianLum) / 0.050f, 0.0f, 1.0f);
                const float ContrastFactor = std::clamp((P98Lum / std::max(MedianLum, 1.0e-4f) - 8.0f) / 10.0f, 0.0f, 1.0f);
                ProtectionWeight = std::max(ProtectionWeight, DarknessFactor * ContrastFactor);
            }
        }

        if (ProtectionWeight > 1.0e-3f)
        {
            const float ProtectedCeiling = Settings.ProtectedDarkMaxGain * CompensationScale;
            if (TargetGain > ProtectedCeiling)
            {
                const float ClampedTarget = TargetGain * (1.0f - ProtectionWeight) + ProtectedCeiling * ProtectionWeight;
                ClampedByProtection = (ClampedTarget < TargetGain - 1.0e-4f);
                TargetGain = ClampedTarget;
            }
        }
    }

    float NextGain = TargetGain;
    if (!InstantConverge && InOutState.CurrentExposureGain > 0.0f && InOutState.FrameCounter >= 2u)
    {
        const float Blend = std::clamp(Settings.TemporalSmoothingRate, 0.01f, 1.0f);
        NextGain = std::exp2((1.0f - Blend) * std::log2(InOutState.CurrentExposureGain) + Blend * std::log2(TargetGain));
    }

    InOutState.CurrentExposureGain  = NextGain;
    InOutState.TargetExposureGain   = TargetGain;
    InOutState.LogAverageLuminance  = AvgLum;
    InOutState.MedianLuminance      = MedianLum;
    InOutState.Percentile98Luminance = P98Lum;
    InOutState.ProtectionClamped    = ClampedByProtection;
    ++InOutState.FrameCounter;
}

void ExposureAdaptation::ToneMapBufferToSrgb8(
    const std::vector<Vec3>&       HdrLinearBuffer,
    uint32_t                       Width,
    uint32_t                       Height,
    const ExposureAdaptationState& State,
    std::vector<uint8_t>&          OutRgb8)
{
    const std::size_t PixelCount = static_cast<std::size_t>(Width) * Height;
    OutRgb8.resize(PixelCount * 3u);
    const float Gain = (State.CurrentExposureGain > 0.0f) ? State.CurrentExposureGain : 1.0f;

    for (std::size_t Index = 0u; Index < PixelCount; ++Index)
    {
        const Vec3 Mapped = ProjectNarkowiczAces(HdrLinearBuffer[Index] * Gain);
        OutRgb8[Index * 3u + 0u] = EncodeSrgb8(Mapped.X);
        OutRgb8[Index * 3u + 1u] = EncodeSrgb8(Mapped.Y);
        OutRgb8[Index * 3u + 2u] = EncodeSrgb8(Mapped.Z);
    }
}

} // namespace Frontier
