/*==========================================================================================================================================
                                                       VEHICLECABINHMI.H
==========================================================================================================================================*/
// 🧩 HTML VehicleHMI port into ControlVehicle: 3D cockpit fixtures (SlateCabinLayout/Fittings), 4 shaped instrument clusters
//    (Hexagon KINETIK / Arc / Trapezoid / Pill), 12 multicolour SVG icons (IconDepot), and live 3D ControlVehicle Garage turntable.

#pragma once

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             INCLUDES
------------------------------------------------------------------------------------------------------------------------------------------*/
#include "Engine/Foundation/Math.h"
#include "Engine/Rendering/BlinnRenderer.h"

#include <array>
#include <cstdint>
#include <string_view>
#include <vector>

namespace Frontier
{
class SceneRenderer;
struct CoupledWorldOpticalContext;

/*------------------------------------------------------------------------------------------------------------------------------------------
                                     CLUSTER OUTLINES, LAUNCHER DESIGNS, APPS & TELEMETRY
------------------------------------------------------------------------------------------------------------------------------------------*/
enum class ClusterOutlineShape : uint8_t
{
    Hexagon   = 0u, // Chamfered KINETIK hexagonal supercar cluster (VehicleHMI default)
    Arc       = 1u, // Sweeping twin-dial analog-digital arc cluster
    Trapezoid = 2u, // Angular motorsport shift-bar trapezoid
    Pill      = 3u  // Panoramic stadium-pill EV/Hybrid cluster
};

enum class GarageInspectionMode : uint8_t
{
    SolidStudio = 0u,
    GhostXRay   = 1u,
    Wireframe   = 2u,
    Scanline    = 3u
};

enum class CabinLauncherDesign : uint8_t
{
    LaunchpadGrid   = 0u, // 4x3 multicolour SVG icon canvas
    SplitDashboard  = 1u, // Live 3D ControlVehicle Garage turntable + 4-wheel thermal/hazard + G-circle stage
    CollectionsRail = 2u, // Vehicle / Connect / Personal columns
    FocusViewport   = 3u, // Active application full-stage card (full-screen 3D ControlVehicle Garage studio)
    CalmConsole     = 4u  // Minimalist bottom SVG dock + horizon summary
};

enum class CabinApplicationSlot : uint8_t
{
    VehicleSetup     = 0u,
    DriveRoom        = 1u,
    Messages         = 2u,
    Contacts         = 3u,
    Navigation       = 4u,
    MediaPlayer      = 5u,
    TyreMonitor      = 6u,
    TelemetryLab     = 7u,
    ClimateHvac      = 8u,
    GarageBay        = 9u,
    AccountCloud     = 10u,
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
    float   VehicleSpeedMps        = 0.0f;    // [m/s] - Ground speed
    float   EngineOrMotorRpm       = 900.0f;  // [rpm] - Crankshaft or primary rotor speed
    float   RedlineRpm             = 7500.0f; // [rpm] - Shift-bar redline ceiling
    int32_t EngagedGear            = 1;       // [-1 = R, 0 = N, 1..8 = forward gears]
    float   ThrottlePedal01        = 0.0f;    // [0..1]
    float   BrakePedal01           = 0.0f;    // [0..1]
    float   SteeringAngleDegrees   = 0.0f;    // [deg]
    float   LongitudinalG          = 0.0f;    // [g]
    float   LateralG               = 0.0f;    // [g]

    bool    ElectricPropulsionMode = false;
    float   FuelLevel01            = 0.78f;
    float   BatteryCharge01        = 0.82f;
    float   ManifoldBoostBar       = 0.0f;
    float   NitrousBottle01        = 0.0f;
    bool    NitrousPurgingOrActive = false;
    bool    WaterMethanolActive    = false;
    float   CoolantTempCelsius     = 88.0f;
    float   OilTempCelsius         = 96.0f;
    float   OilPressureKilopascal  = 460.0f;
    float   RegenOrDrivePowerKw    = 0.0f;

    std::array<WheelHmiSnapshot, 4u> Wheels{};

    float   AmbientTempCelsius     = 14.0f;
    float   WindSpeedMps           = 4.0f;
    float   RainIntensity01        = 0.0f;
    float   GroundSnowPeakCm       = 0.0f;
    bool    HailImpactWarning      = false;
    bool    AquaplaningWarning     = false;
    bool    BlackIceOrHailSlip     = false;
    bool    LightningProximityWarn = false;
    float   LastThunderDistanceKm  = 0.0f;
};

struct CabinHmiAlertDigest
{
    uint32_t ActiveShiftLedCount = 0u;
    bool     RedlineShiftFlash   = false;
    bool     TractionHazardLamp  = false;
    bool     ThermalWarningLamp  = false;
    bool     SevereWeatherBanner = false;
};

struct MountedControlVehicleCockpitRig
{
    Vec3    DriverEyeWorld{};          // [m] - Seated driver eye position inside ControlVehicle
    Vec3    DriverLookTargetWorld{};   // [m] - Natural forward look target showing cluster, tablet & road
    float   DriverVerticalFovRad = 1.15f;
    Vec3    HmiFocusEyeWorld{};        // [m] - Close-up interior camera aimed at 3D tablet & hexagonal cluster
    Vec3    HmiFocusTargetWorld{};     // [m] - Midpoint between wheel-mounted cluster & centre tablet
    int32_t ClusterDisplayTextureId = -1;
    int32_t TabletDisplayTextureId  = -1;
    uint32_t CockpitTrianglesAdded  = 0u;
};

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                       VEHICLE CABIN HMI
------------------------------------------------------------------------------------------------------------------------------------------*/
class VehicleCabinHmi
{
public:
    static constexpr uint32_t ApplicationCount = 12u;

    VehicleCabinHmi();

    void SelectLauncherDesign(CabinLauncherDesign Design) noexcept { ActiveDesign_ = Design; }
    void SelectActiveApplication(CabinApplicationSlot Slot) noexcept { ActiveApp_ = Slot; }
    void SelectClusterOutline(ClusterOutlineShape Outline) noexcept { ClusterOutline_ = Outline; }
    void SelectGaragePaintSwatch(uint32_t SwatchIndex) noexcept { GaragePaintSwatch_ = SwatchIndex % 6u; }
    void SelectGarageInspectionMode(GarageInspectionMode Mode) noexcept { GarageMode_ = Mode; }
    void SetGarageTurntableYawRadians(float YawRadians) noexcept { GarageTurntableYawRad_ = YawRadians; }

    // Loads ControlVehicle{Body,Rim,Tyre}.facet so GarageBay & SplitDashboard render the real 3D ControlVehicle inside the HMI!
    bool LoadControlVehicleMeshesForHmi(std::string_view GeometryDirectoryPath);
    [[nodiscard]] bool HasLoadedControlVehicleMeshes() const noexcept { return HasVehicleMeshes_; }

    [[nodiscard]] CabinLauncherDesign  SelectedLauncherDesign() const noexcept { return ActiveDesign_; }
    [[nodiscard]] CabinApplicationSlot SelectedApplication() const noexcept { return ActiveApp_; }
    [[nodiscard]] ClusterOutlineShape  SelectedClusterOutline() const noexcept { return ClusterOutline_; }

    [[nodiscard]] static const std::array<CabinApplicationMetadata, ApplicationCount>& Catalogue() noexcept;
    [[nodiscard]] static CabinHmiAlertDigest EvaluateAlerts(const VehicleCabinTelemetryFrame& Telemetry) noexcept;

    // Synthesizes crisp RGBA8 Shaped Instrument Cluster (Hexagon KINETIK / Arc / Trapezoid / Pill).
    void SynthesizeInstrumentClusterRgba8(
        uint32_t                          Width,
        uint32_t                          Height,
        const VehicleCabinTelemetryFrame& Telemetry,
        std::vector<uint8_t>&             OutRgba8) const;

    // Synthesizes crisp RGBA8 Central Infotainment Tablet (12 multicolour SVG icons, 5 launcher layouts,
    // and LIVE 3D ControlVehicle turntable rendered inside the HMI Garage viewport via BlinnRenderer!).
    void SynthesizeCentralScreenRgba8(
        uint32_t                          Width,
        uint32_t                          Height,
        const VehicleCabinTelemetryFrame& Telemetry,
        std::vector<uint8_t>&             OutRgba8) const;

    // Synthesizes translucent RGBA8 Windshield / Exterior HUD overlay.
    void SynthesizeWindshieldHudRgba8(
        uint32_t                          Width,
        uint32_t                          Height,
        const VehicleCabinTelemetryFrame& Telemetry,
        std::vector<uint8_t>&             OutRgba8) const;

    // Mounts the complete physical 3D ControlVehicle exterior + dielectric glass + 3D cockpit dash, seats, toroidal steering wheel,
    // UV-textured 3D Hexagonal Cluster & 3D Centre Tablet + 3 Planar Mirrors into SceneRenderer, and configures CabinShare exposure!
    MountedControlVehicleCockpitRig MountControlVehicle3DCockpit(
        Vec3                              VehicleOriginWorld,
        float                             VehicleYawRadians,
        const VehicleCabinTelemetryFrame& Telemetry,
        SceneRenderer&                    Renderer,
        CoupledWorldOpticalContext&       InOutOpticalContext) const;

private:
    CabinLauncherDesign  ActiveDesign_          = CabinLauncherDesign::SplitDashboard;
    CabinApplicationSlot ActiveApp_             = CabinApplicationSlot::GarageBay;
    ClusterOutlineShape  ClusterOutline_        = ClusterOutlineShape::Hexagon;
    uint32_t             GaragePaintSwatch_     = 1u; // Crimson Corsa default
    GarageInspectionMode GarageMode_            = GarageInspectionMode::SolidStudio;
    float                GarageTurntableYawRad_ = 0.62f;
    bool                 HasVehicleMeshes_      = false;
    BlinnFacetMesh       BodyMesh_{};
    BlinnFacetMesh       RimLeftMesh_{};
    BlinnFacetMesh       RimRightMesh_{};
    BlinnFacetMesh       TyreMesh_{};
};

} // namespace Frontier
