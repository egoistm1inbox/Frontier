/*==========================================================================================================================================
                                                     EXPOSUREADAPTATION.H
==========================================================================================================================================*/
// 🧩 Eye-adaptation exposure integrator + Narkowicz ACES projection with dark-room emissive & ControlVehicle cabin protection.

#pragma once

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             INCLUDES
------------------------------------------------------------------------------------------------------------------------------------------*/
#include "Engine/Foundation/Math.h"

#include <cstdint>
#include <vector>

namespace Frontier
{
/*------------------------------------------------------------------------------------------------------------------------------------------
                                                 EXPOSURE PARAMETERS & STATE
------------------------------------------------------------------------------------------------------------------------------------------*/
struct ExposureSettings
{
    bool  AutoExposureEnabled             = true;  // [boolean] - 64x64 log-average luminance adaptation
    float ExposureCompensationEv          = 0.0f;  // [EV] - Artist exposure bias in stops
    float ManualExposureGain              = 0.82f; // [-] - Fixed gain when AutoExposureEnabled is false
    float MiddleGreyKey                   = 0.18f; // [-] - Standard 18% middle-grey target
    float TemporalSmoothingRate           = 0.06f; // [0..1] - Per-frame exponential adaptation blend (DisplayExposure.wgsl)
    bool  ProtectDarkEmissiveInteriors    = true;  // [boolean] - Prevent auto-exposure from brightening dark emissive rooms
    bool  ProtectVehicleCabins            = true;  // [boolean] - Prevent auto-exposure from brightening ControlVehicle cabin
    bool  CameraInDarkEmissiveInterior    = false; // [boolean] - Explicit interior volume hint (auto-detected too!)
    float VehicleCabinShare01             = 0.0f;  // [0..1] - Output of EvaluateVehicleCabinShare(CameraBodyLocal)
    float ProtectedDarkMaxGain            = 0.85f; // [-] - Maximum exposure gain allowed inside protected dark/cabin spaces
};

struct ExposureAdaptationState
{
    float    CurrentExposureGain          = 0.82f; // [-] - Active linear radiance multiplier before ACES
    float    TargetExposureGain           = 0.82f; // [-] - Unsmoothed target gain for this frame
    float    LogAverageLuminance          = 0.18f; // [cd/m^2 rel] - 64x64 lattice geometric-mean luminance
    float    MedianLuminance              = 0.18f; // [cd/m^2 rel] - 50th-percentile lattice luminance
    float    Percentile98Luminance        = 0.50f; // [cd/m^2 rel] - 98th-percentile emissive peak luminance
    bool     ProtectionClamped            = false; // [boolean] - True when dark-room emissive / cabin protection clamped gain
    uint32_t FrameCounter                 = 0u;    // [frames] - Integrated frame count
};

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                     EXPOSURE ADAPTATION
------------------------------------------------------------------------------------------------------------------------------------------*/
class ExposureAdaptation
{
public:
    // Exact port of CabinVolume.wgsl: 1.0 deep inside ControlVehicle's cabin, 0.0 outside, soft over 4 cm.
    [[nodiscard]] static float EvaluateVehicleCabinShare(Vec3 VehicleBodyLocalPosition) noexcept;

    // Rec. 709 linear luminance.
    [[nodiscard]] static float ResolveLuminance(Vec3 LinearRadiance) noexcept;

    // Narkowicz ACES filmic tone curve (DisplayPresent.wgsl).
    [[nodiscard]] static Vec3 ProjectNarkowiczAces(Vec3 ExposedRadiance) noexcept;

    // Exact quadratic inverse of Narkowicz ACES divided by CurrentExposureGain (CabinOverlay.wgsl ScreenRadiance),
    // ensuring self-lit vehicle cabin HMI tablets and gauge clusters read identically in pitch-dark cabins and noon sun.
    [[nodiscard]] static Vec3 EncodeDisplayReferredScreenRadiance(
        Vec3  LinearDisplaySrgb,
        float CurrentExposureGain) noexcept;

    // Integrates 64x64 lattice over linear HDR framebuffer and updates ExposureAdaptationState.
    static void IntegrateExposure(
        const std::vector<Vec3>& HdrLinearBuffer,
        uint32_t                 Width,
        uint32_t                 Height,
        const ExposureSettings&  Settings,
        ExposureAdaptationState& InOutState,
        bool                     InstantConverge = false) noexcept;

    // Applies exposure gain + Narkowicz ACES + sRGB encoding to linear HDR buffer.
    static void ToneMapBufferToSrgb8(
        const std::vector<Vec3>&       HdrLinearBuffer,
        uint32_t                       Width,
        uint32_t                       Height,
        const ExposureAdaptationState& State,
        std::vector<uint8_t>&          OutRgb8);
};

} // namespace Frontier
