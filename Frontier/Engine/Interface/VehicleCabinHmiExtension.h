/*==========================================================================================================================================
                                                 VEHICLECABINHMIEXTENSION.H
==========================================================================================================================================*/
// 🧩 Native Vehicle Cabin Digital Cluster, 12-App Central Infotainment Screen (5 launcher layouts), and Windshield HUD Telemetry.

#pragma once

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             INCLUDES
------------------------------------------------------------------------------------------------------------------------------------------*/
#include "Engine/Foundation/Math.h"

#include <array>
#include <cstdint>
#include <string_view>
#include <vector>

namespace Frontier
{
/*------------------------------------------------------------------------------------------------------------------------------------------
                                              LAUNCHER DESIGNS, APPS & TELEMETRY INPUT
------------------------------------------------------------------------------------------------------------------------------------------*/
enum class CabinLauncherDesign : uint8_t
{
    LaunchpadGrid   = 0u, // 4x3 icon canvas
    SplitDashboard  = 1u, // Hero telemetry + live tyres + weather cards
    CollectionsRail = 2u, // Vehicle / Connect / Personal columns
    FocusViewport      = 3u, // Active application full-stage card
    CalmConsole     = 4u  // Minimalist bottom rail + horizon summary
};

enum class CabinApplicationSlot : uint8_t
{
    VehicleSetup = 0u,
    DriveRoom    = 1u,
    Messages     = 2u,
    Contacts     = 3u,
    Navigation   = 4u,
    MediaPlayer  = 5u,
    TyreMonitor  = 6u,
    TelemetryLab = 7u,
    ClimateHvac  = 8u,
    GarageBay    = 9u,
    AccountCloud = 10u,
    CabinPreferences = 11u
};

struct CabinApplicationMetadata
{
    CabinApplicationSlot Slot{};
    std::string_view     Identifier{};
    std::string_view     DisplayTitle{};
    std::string_view     Caption{};
    Vec3                 AccentSrgb{};
    uint8_t              UnreadBadgeCount = 0u;
};

struct WheelHmiSnapshot
{
    float TreadTemperatureKelvin = 335.0f; // [K] - Calibrated outer tread temperature
    float TyrePressureKilopascal = 225.0f; // [kPa] - Cold/hot inflation pressure
    float EffectiveGripRatio     = 1.0f;   // [0..1.2] - Combined dry/wet/mud/snow/hail grip
    float StandingWaterMm        = 0.0f;   // [mm] - Local 2.5D puddle water depth under tread
    float MudConcentration01     = 0.0f;   // [0..1] - Local Bingham mud fraction
    float SnowSinkageMetres      = 0.0f;   // [m] - Carved snow rut depth
    bool  Smoking                = false;  // [boolean] - Plume tyre smoke onset active
};

struct VehicleCabinTelemetryFrame
{
    // Speed, RPM & Transmission
    float   VehicleSpeedMps        = 0.0f;    // [m/s] - Ground speed (converted to km/h or mph)
    float   EngineOrMotorRpm       = 900.0f;  // [rpm] - Crankshaft or primary rotor speed
    float   RedlineRpm             = 7500.0f; // [rpm] - Shift-bar redline ceiling
    int32_t EngagedGear            = 1;       // [-1 = R, 0 = N, 1..8 = forward gears]
    float   ThrottlePedal01        = 0.0f;    // [0..1]
    float   BrakePedal01           = 0.0f;    // [0..1]
    float   SteeringAngleDegrees   = 0.0f;    // [deg]
    float   LongitudinalG          = 0.0f;    // [g] - Acceleration / braking G
    float   LateralG               = 0.0f;    // [g] - Cornering G

    // Propulsion (ICE / Forced Induction / Additives / BEV / Hybrid)
    bool    ElectricPropulsionMode = false;   // [boolean] - True for BEV or EV-only hybrid drive
    float   FuelLevel01            = 0.78f;   // [0..1] - Tank remaining fraction
    float   BatteryCharge01        = 0.82f;   // [0..1] - High-voltage pack SoC
    float   ManifoldBoostBar       = 0.0f;    // [bar] - Gauge boost pressure (turbo / supercharger)
    float   NitrousBottle01        = 0.0f;    // [0..1] - N2O reserve
    bool    NitrousPurgingOrActive = false;
    bool    WaterMethanolActive    = false;
    float   CoolantTempCelsius     = 88.0f;   // [degC]
    float   OilTempCelsius         = 96.0f;   // [degC]
    float   OilPressureKilopascal  = 460.0f;  // [kPa]
    float   RegenOrDrivePowerKw    = 0.0f;    // [kW] - Positive = drive, Negative = regenerative braking

    // 4-Wheel Corner Telemetry [FL, FR, RL, RR]
    std::array<WheelHmiSnapshot, 4u> Wheels{};

    // Coupled Weather & Surface Hazards
    float   AmbientTempCelsius     = 14.0f;   // [degC]
    float   WindSpeedMps           = 4.0f;    // [m/s]
    float   RainIntensity01        = 0.0f;    // [0..1]
    float   GroundSnowPeakCm       = 0.0f;    // [cm]
    bool    HailImpactWarning      = false;
    bool    AquaplaningWarning     = false;
    bool    BlackIceOrHailSlip     = false;
    bool    LightningProximityWarn = false;
    float   LastThunderDistanceKm  = 0.0f;    // [km]
};

struct CabinHmiAlertDigest
{
    uint32_t ActiveShiftLedCount  = 0u;    // [0..10] - Illuminated RPM shift-bar LEDs
    bool     RedlineShiftFlash    = false; // [boolean] - True when RPM >= 94% RedlineRpm
    bool     TractionHazardLamp   = false; // [boolean] - Aquaplaning, hail ice, or deep snow slip
    bool     ThermalWarningLamp   = false; // [boolean] - Coolant > 112 C, Oil > 130 C, or tyre > 405 K
    bool     SevereWeatherBanner  = false; // [boolean] - Hail impact or close lightning (< 3 km)
};

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                   VEHICLE CABIN HMI EXTENSION
------------------------------------------------------------------------------------------------------------------------------------------*/
class VehicleCabinHmiExtension
{
public:
    static constexpr uint32_t ApplicationCount = 12u;

    VehicleCabinHmiExtension();

    void SelectLauncherDesign(CabinLauncherDesign Design) noexcept { ActiveDesign_ = Design; }
    void SelectActiveApplication(CabinApplicationSlot Slot) noexcept { ActiveApp_ = Slot; }

    [[nodiscard]] CabinLauncherDesign  SelectedLauncherDesign() const noexcept { return ActiveDesign_; }
    [[nodiscard]] CabinApplicationSlot SelectedApplication() const noexcept { return ActiveApp_; }

    [[nodiscard]] static const std::array<CabinApplicationMetadata, ApplicationCount>& Catalogue() noexcept;
    [[nodiscard]] static CabinHmiAlertDigest EvaluateAlerts(const VehicleCabinTelemetryFrame& Telemetry) noexcept;

    // Synthesizes crisp anti-aliased RGBA8 Digital Instrument Cluster (speedometer arc, tach arc, shift LEDs,
    // gear readout, boost/SoC/fuel gauges, oil/coolant bars, and hazard telltales) ready for cockpit GPU upload!
    void SynthesizeInstrumentClusterRgba8(
        uint32_t                          Width,
        uint32_t                          Height,
        const VehicleCabinTelemetryFrame& Telemetry,
        std::vector<uint8_t>&             OutRgba8) const;

    // Synthesizes crisp anti-aliased RGBA8 Central Infotainment Screen (status bar, 5 switchable launcher layouts,
    // 12 cabin apps, live 4-wheel thermal/water/mud/snow cards, G-circle, and weather radar)!
    void SynthesizeCentralScreenRgba8(
        uint32_t                          Width,
        uint32_t                          Height,
        const VehicleCabinTelemetryFrame& Telemetry,
        std::vector<uint8_t>&             OutRgba8) const;

    // Synthesizes transparent RGBA8 Windshield / Exterior HUD overlay onto or standalone for viewport compositing!
    void SynthesizeWindshieldHudRgba8(
        uint32_t                          Width,
        uint32_t                          Height,
        const VehicleCabinTelemetryFrame& Telemetry,
        std::vector<uint8_t>&             OutRgba8) const;

private:
    CabinLauncherDesign  ActiveDesign_ = CabinLauncherDesign::SplitDashboard;
    CabinApplicationSlot ActiveApp_    = CabinApplicationSlot::TelemetryLab;
};

} // namespace Frontier
