/*==========================================================================================================================================
                                                        EVERESTSCENEASSEMBLY.H
==========================================================================================================================================*/
// 🧩 Project Everest RAII scene records (EngineReusable, ProjectCustom, DedicatedStudio) and dedicated studio workspaces.

#pragma once

#include "Engine/Interface/EngineReusableInspectors.h"
#include "Engine/Scene/InspectorCatalogue.h"
#include "Engine/Scene/RecordEntry.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                             VEHICLE & STUDIO PARAMETERS
//------------------------------------------------------------------------------------------------------------------------

struct EverestVehicleParameters
{
    size_t   ActiveDivisionTab        = 0;      // [-] - 0 Overview, 1 Chassis, 2 Engine, 3 Tyres, 4 Suspension, 5 Lights, 6 HMI, 7 Mirrors
    size_t   SelectedWheelIndex       = 2;      // [-] - 0 FL, 1 FR, 2 RL, 3 RR
    size_t   ActiveTyreSubTab         = 0;      // [-] - 0 Tyre, 1 Marks, 2 Smoke & fire, 3 Rim sparks, 4 Burnout
    size_t   ContinuumModelIndex      = 0;      // [-] - 0 3D Hex8 FEM, 1 2D Shell, 2 XPBD, 3 Spring
    size_t   HeadlightBeamIndex       = 1;      // [-] - 0 Off, 1 Low beam, 2 High beam, 3 Fog
    size_t   RoofFixtureIndex         = 0;      // [-] - 0 Slim LED lightbar, 1 Dual rally pods
    size_t   MirrorRefreshIndex       = 1;      // [-] - 0 Off, 1 When visible, 2 Always
    size_t   CameraRigIndex           = 0;      // [-] - 0 Chase, 1 Orbit, 2 Cockpit, 3 HMI, 4 Tyre RL
    bool     FreeCameraActive         = false;  // [-] - Chase rigs vs Free camera (F8)
    bool     ShowCollisionOverlay     = true;   // [-] - Diagnostic x-ray hull points
    bool     CountersteerAssist       = true;   // [-] - Speed-aware slip assist
    float    AssistStrength           = 0.45f;  // [-] - Assist gain
    bool     LineLockEnabled          = true;   // [-] - W + S front caliper clamp
    float    FrontColdPressureKpa     = 220.0f; // [kPa] - Front axle cold pressure
    float    RearColdPressureKpa      = 210.0f; // [kPa] - Rear axle cold pressure
    bool     TreadWearEnabled         = true;   // [-] - Sliding abrasion
    float    WearRateScale            = 4.0f;   // [x] - Demo wear multiplier
    bool     TyreFailureEnabled       = true;   // [-] - Burst on thermal/wear limit
    bool     ThermalGripLossEnabled   = true;   // [-] - Hot/flat grip drop
    bool     LayRubberMarksEnabled    = true;   // [-] - Road-deposit atlas
    float    MarkDepositStrength      = 1.25f;  // [x] - Deposit gain
    float    LaidRubberMetres         = 148.0f; // [m] - Accumulated tyre mark length
    bool     SharedSmokeDomainEnabled = true;   // [-] - Toroidal vehicle-following plume
    size_t   TestPlumeIndex           = 1;      // [-] - 0 Off, 1 Smoke plume, 2 Fire
    float    SmokeEmissionRate        = 1.35f;  // [x] - Source emission multiplier
    float    SmokeDissipationRate     = 0.22f;  // [1/s] - Density decay
    float    SmokeCoolingRate         = 0.34f;  // [1/s] - Thermal cooling
    float    FlameTipKelvin           = 1280.0f;// [K] - Tip blackbody temperature
    float    FlameCoreKelvin          = 2650.0f;// [K] - Core blackbody temperature
    bool     MetalSparksEnabled       = true;   // [-] - Rim/chassis scrape filings
    float    SparkBurstVariation      = 0.65f;  // [x] - Spark streak variance
    bool     RoofAuxiliaryEnabled     = true;   // [-] - Forward multi-lens flood
    bool     CabinScreensEnabled      = true;   // [-] - Centre tablet + hex cluster
    float    CabinScreenBrightness    = 0.92f;  // [x] - Display luminance
    float    TabletHousingScale       = 1.00f;  // [x] - Centre tablet scale
    float    CockpitFovDegrees        = 70.0f;  // [deg] - Interior FOV
    bool     SeeThroughGlazing        = true;   // [-] - 72% Fresnel glazing
    float    GlazingTransmission      = 0.72f;  // [-] - Optical transmission
    float    SpeedKilometresPerHour   = 84.0f;  // [km/h] - Live vehicle speed
    float    EngineRpm                = 5420.0f;// [rpm] - Live crankshaft speed
    float    TurboBoostBar            = 1.18f;  // [bar] - Manifold gauge boost
    int      EngagedGear              = 3;      // [-] - Transmission ratio index
    float    DriftAngleDegrees        = 14.2f;  // [deg] - Rear slip angle
    float    WheelSurfaceCelsius[4]   = {68.0f, 71.0f, 118.0f, 124.0f}; // [C] - Per-corner tread temp
    float    WheelTreadPercent[4]     = {96.0f, 95.0f, 82.0f, 80.0f};   // [%] - Remaining tread
    EngineSpatialParameters Spatial{{-4.20f, 0.00f, 12.50f}, false};    // [m] - World transform
};

struct EverestFractureParameters
{
    size_t   MaterialIndex            = 0;       // [-] - 0 Concrete, 1 Brick, 2 Timber, 3 Cast Iron, 4 Glass, 5 Stone
    size_t   PartitionModeIndex       = 0;       // [-] - 0 Dynamic impact cut, 1 Baked pattern
    bool     AutoReassembleEnabled    = true;    // [-] - Reassemble after lifetime
    bool     VehicleDebrisCollision   = true;    // [-] - Two-way Jolt hull contact
    float    ReassembleSeconds        = 24.0f;   // [s] - Debris persistence window
    float    SeparationImpulse        = 1.10f;   // [x] - Fragment separation scalar
    float    BreakThresholdJoules     = 18500.0f;// [J] - Threshold kinetic energy
    float    FragmentCeiling          = 28.0f;   // [pcs] - Max convex pieces
    float    PreviewSeparation        = 0.24f;   // [-] - Exploded preview slider
    uint32_t IntactPropCount          = 16u;     // [props] - Intact props in course
    uint32_t TotalPropCount           = 18u;     // [props] - Total breakable props
    uint32_t ActiveFragmentCount      = 34u;     // [fragments] - Live convex rigid bodies
};

struct EverestParticleParameters
{
    size_t   ActiveEmitterIndex       = 0;       // [-] - 0 Tyre Plume Ribbon, 1 Rim Filings, 2 Derez Dissolve, 3 Dust Wake
    bool     GpuSimEnabled            = true;    // [-] - Compute buffer integration
    bool     DepthSoftFadeEnabled     = true;    // [-] - Soft scene depth fade
    float    EmissionRatePerSecond    = 640.0f;  // [1/s] - Spawn rate
    float    LifetimeSeconds          = 2.40f;   // [s] - Particle lifetime
    float    InitialSpeedMetresPerSec = 8.5f;    // [m/s] - Launch speed
    float    DragCoefficient          = 0.35f;   // [1/s] - Aerodynamic drag
    uint32_t LiveParticleCount        = 14820u;  // [particles] - Resident GPU particles
};

//------------------------------------------------------------------------------------------------------------------------
//                                             TYPED RAII SCENE RECORDS
//------------------------------------------------------------------------------------------------------------------------

// Standard engine item: constructor auto-registers in SceneDirectory + binds reusable engine inspector.
class EverestEngineRecord final : public RecordEntry
{
  public:
    EverestEngineRecord(RecordClassification Classification, const char *DisplayName, EngineInspectorDomain Domain,
                        const char *GroupCaption, const char *EyebrowCaption, const char *MetaCaption,
                        uint32_t AccentRgb, EngineSpatialParameters *OptionalSpatial = nullptr,
                        DedicatedStudioDomain LinkedStudio = DedicatedStudioDomain::None,
                        RecordToken Enclosure = {});

    EngineSpatialParameters LocalSpatial{};
};

// User-authored custom item: ControlVehicle with 8 system tabs + 4 wheel selectors + 5 tyre sub-tabs.
class ControlVehicleRecord final : public RecordEntry
{
  public:
    ControlVehicleRecord(EverestVehicleParameters &Parameters, DedicatedStudioDomain &StudioTrigger);
};

// Dedicated Studio item: Fracture domain & breakable course props.
class EverestFractureRecord final : public RecordEntry
{
  public:
    EverestFractureRecord(const char *DisplayName, bool IsIndividualProp, EverestFractureParameters &Parameters,
                          DedicatedStudioDomain &StudioTrigger);
};

// Dedicated Studio item: GPU Particle & Derez VFX authoring record.
class EverestParticleRecord final : public RecordEntry
{
  public:
    EverestParticleRecord(const char *DisplayName, bool IsDerezEffect, EverestParticleParameters &Parameters,
                          DedicatedStudioDomain &StudioTrigger);
};

// Course / Level item with custom proving-grounds controls.
class EverestCourseRecord final : public RecordEntry
{
  public:
    EverestCourseRecord(const char *DisplayName, const char *MetaCaption, const char *DescriptionText);

  private:
    std::string StoredDescription;
    float       DensityMultiplier = 1.0f;
    bool        ActiveSegment     = true;
};

//------------------------------------------------------------------------------------------------------------------------
//                                           PROVING GROUNDS SCENE ASSEMBLY
//------------------------------------------------------------------------------------------------------------------------

class EverestSceneAssembly
{
  public:
    EverestSceneAssembly();
    ~EverestSceneAssembly();

    EverestSceneAssembly(const EverestSceneAssembly &)            = delete;
    EverestSceneAssembly &operator=(const EverestSceneAssembly &) = delete;

    // Dynamically spawns or destroys a user test record to prove RAII Outliner + Inspector registration.
    RecordToken ConstructDynamicTestProp(const char *DisplayName);
    bool        DestroyDynamicRecord(RecordToken Token);

    [[nodiscard]] const std::vector<RecordToken> &QueryOrderedTokens() const noexcept { return OrderedTokens; }
    [[nodiscard]] RecordToken QueryRenderSettingsToken() const noexcept { return RenderSettingsToken; }
    [[nodiscard]] RecordToken QuerySunToken() const noexcept { return SunToken; }
    [[nodiscard]] RecordToken QueryVehicleToken() const noexcept { return VehicleToken; }
    [[nodiscard]] RecordToken QueryFractureToken() const noexcept { return FractureToken; }
    [[nodiscard]] RecordToken QueryParticlesToken() const noexcept { return ParticlesToken; }

    EngineRenderParameters      Render{};
    EngineEnvironmentParameters Environment{};
    EverestVehicleParameters    Vehicle{};
    EverestFractureParameters   Fracture{};
    EverestParticleParameters   Particles{};
    DedicatedStudioDomain       PendingStudioRequest = DedicatedStudioDomain::None;

#if defined(FRONTIER_WITH_INTERFACE_SDK)
    void ConstructParticleStudioInterface();
    void ConstructFractureStudioInterface();
    void ConstructFluidPlumeStudioInterface();
#endif

  private:
    std::vector<std::unique_ptr<RecordEntry>> OwnedRecords;
    std::vector<RecordToken>                  OrderedTokens;
    RecordToken                               RenderSettingsToken{};
    RecordToken                               SunToken{};
    RecordToken                               VehicleToken{};
    RecordToken                               FractureToken{};
    RecordToken                               ParticlesToken{};
};

} // namespace Frontier
