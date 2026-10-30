/*====================================================================================================================================
                                                     DRIVESHOWCASEWORLD.H
====================================================================================================================================*/
// 🧩 Unified Project-Drive live world orchestrating DriveSimulation (Jolt v5.6.0 + GRIT), Dual-Tier SceneRenderer (GTX/RTX)
//    + BlinnRenderer, 3D VehicleCabinHmi + CabinIconDepot, Circular/Rectangular PortalMechanics + Mirror, 5.13x PlumeFluid,
//    Coupled SkyPrecipitation (Rain/Snow/Hail), Single-Mesh SnowSurface (CC==1), Smooth 2.5D ShallowWater (0 foam/0 splash),
//    SparkParticles, Griffith SolidFracture, Glass-Aware ClusterHierarchy, and 48 B StateReplication.

#pragma once

#include "DriveShowcaseRecords.h"
#include "DriveSimulation.h"
#include "VehicleHmiScene.h"

#include "Engine/Fluid/PlumeFluid.h"
#include "Engine/Fluid/ShallowWater.h"
#include "Engine/Gameplay/GameMechanics/PortalMechanics.h"
#include "Engine/Gameplay/GameMechanics/VehicleCabinHmi.h"
#include "Engine/GeometryProcessing/ClusterHierarchy.h"
#include "Engine/Networking/StateReplication.h"
#include "Engine/Particles/SkyPrecipitation.h"
#include "Engine/Particles/SparkParticles.h"
#include "Engine/Physics/Fracture/SolidFracture.h"
#include "Engine/Rendering/AtmosphereModel.h"
#include "Engine/Rendering/BlinnRenderer.h"
#include "Engine/Rendering/ExposureAdaptation.h"
#include "Engine/Rendering/SceneRenderer.h"
#include "Engine/VisualEffects/CelestialSky.h"
#include "Engine/VisualEffects/LightningStorm.h"
#include "Engine/VisualEffects/SnowSurface.h"
#include "Engine/VisualEffects/WindField.h"

#include <cstdint>
#include <string>
#include <vector>

namespace Frontier::Drive
{

enum class ShowcaseTransportMode : uint8_t
{
    Play     = 0u, // Live runtime: possesses vehicle / autopilot + steps Jolt, weather, fluid, sparks & networking
    Pause    = 1u, // Frozen clock: simulation paused while Inspector & Outliner edits still update the 3D scene live!
    Simulate = 2u  // Editor simulation: steps all physics/weather/fluid systems while keeping free editor camera!
};

enum class ShowcaseCameraPreset : int32_t
{
    HeroOverview       = 0,
    CabinCockpitHmi    = 1,
    CircularPortals    = 2,
    SnowMoundAndWater  = 3,
    PyroAndFracture    = 4,
    DynamicChase       = 5,
    TopCalibration     = 6
};

class DriveShowcaseWorld
{
  public:
    DriveShowcaseWorld();
    ~DriveShowcaseWorld() = default;

    DriveShowcaseWorld(const DriveShowcaseWorld &)            = delete;
    DriveShowcaseWorld &operator=(const DriveShowcaseWorld &) = delete;

    [[nodiscard]] bool Initialize(const std::string &ProjectRootPath);

    void SetTransportMode(ShowcaseTransportMode Mode) noexcept;
    [[nodiscard]] ShowcaseTransportMode GetTransportMode() const noexcept { return TransportMode_; }

    void StepSingleTick(double DtSeconds = 1.0 / 60.0);
    void TickFrame(double DtSeconds, const DriveControlReadings &Controls);
    void ResetAllSystems();

    void SetCameraPreset(ShowcaseCameraPreset Preset) noexcept;
    [[nodiscard]] ShowcaseCameraPreset GetCameraPreset() const noexcept;
    void OrbitFreeCamera(float DeltaYawRad, float DeltaPitchRad, float DeltaZoomM) noexcept;

    // Renders the active 3D viewport into RGBA8 pixels (re-renders only when scene/camera/simulation is dirty).
    bool RenderViewportIfNeeded(uint32_t TargetPanelWidth, uint32_t TargetPanelHeight,
                                std::vector<uint8_t> &OutRgba8,
                                uint32_t &OutRenderW, uint32_t &OutRenderH);

    void ForceViewportDirty() noexcept { ++SceneDirtyRevision_; }

    [[nodiscard]] ShowcaseRecordBundle            &Records() noexcept { return Records_; }
    [[nodiscard]] const ShowcaseRecordBundle      &Records() const noexcept { return Records_; }
    [[nodiscard]] const ShowcaseTelemetrySnapshot &Telemetry() const noexcept { return Telemetry_; }
    [[nodiscard]] double                           SimulatedTimeSeconds() const noexcept { return WorldClockSeconds_; }

  private:
    void WarmupSnowMoundAndPuddles();
    void RebuildFractureMonolith();
    void AdvanceCoupledSubsystems(float DtSeconds);
    void RebuildAndRender3DViewport(uint32_t RenderW, uint32_t RenderH, std::vector<uint8_t> &OutRgba8);

    ShowcaseTelemetrySnapshot               Telemetry_{};
    uint64_t                                SceneDirtyRevision_    = 1u;
    uint64_t                                RenderedRevision_      = 0u;
    uint32_t                                LastRenderW_           = 0u;
    uint32_t                                LastRenderH_           = 0u;
    ShowcaseRecordBundle                    Records_;

    ShowcaseTransportMode                   TransportMode_         = ShowcaseTransportMode::Play;
    std::string                             ProjectRoot_;
    std::string                             GeometryDir_;
    double                                  WorldClockSeconds_     = 0.0;
    uint32_t                                HistoryCursor_         = 0u;

    // Core Jolt + GRIT Driving Simulation
    DriveSimulation                         DriveSim_{};
    DriveSnapshot                           LatestDriveSnap_{};
    BlinnFacetMesh                          BlinnBodyMesh_{};
    BlinnFacetMesh                          BlinnWheelMesh_{};

    // Rendering, Cabin HMI, Portals & Nanite
    AtmosphereParameters                    AtmosParams_{};
    TransmittanceLut                        SkyLut_{};
    CelestialSky                            CelestialDome_{};
    ExposureAdaptationState                 AutoExposureState_{};
    VehicleCabinHmi                         CabinHmi_{};
    MountedControlVehicleCockpitRig         LatestCockpitRig_{};
    PortalMechanics                         PortalFilter_{};
    BlinnRenderer                           LowResBlinn_{};
    ClusterHierarchy                        NaniteHierarchy_{};

    // Coupled Weather, Fluid, Snow, Water, Sparks, Fracture & Networking
    WindField                               WindSolver_{};
    PlumeFluid                              PyroSolver_;
    ShallowWaterSimulation                  WaterPuddles_;
    SnowSurface                             SnowMound_;
    SkyPrecipitation                        SnowfallSolver_;
    SkyPrecipitation                        RainfallSolver_;
    SkyPrecipitation                        HailstormSolver_;
    LightningStorm                          LightningSolver_{};
    SparkParticles                          SparkSolver_{};
    SolidFracture                           FractureEngine_{};
    std::vector<ConvexSolidFragment>        FractureFragments_;
    std::vector<FragmentAdjacencyBond>      FractureBonds_;
    Networking::SequenceAckTracker          NetAckTracker_{};
    double                                  NetSendAccumulator_    = 0.0;

    // Interactive Camera Orbit Offsets
    float                                   OrbitYawOffsetRad_     = 0.0f;
    float                                   OrbitPitchOffsetRad_   = 0.0f;
    float                                   OrbitZoomOffsetM_      = 0.0f;
};

} // namespace Frontier::Drive
