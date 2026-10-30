/*====================================================================================================================================
                                                     DRIVESHOWCASERECORDS.H
====================================================================================================================================*/
// 🧩 25 live RecordEntry-derived scene components across 8 Outliner groups for the unified Project-Drive showcase.
//    Every component constructs its 1:1 VehicleHMI UI or SourceImages/General UI statistical infographic strictly
//    inside #if defined(FRONTIER_EDITOR_PROFILE) in its constructor, and compiles to zero editor UI in Shipping.

#pragma once

#include "Engine/Scene/RecordEntry.h"

#include <array>
#include <cstdint>
#include <memory>

namespace Frontier::Drive
{

//------------------------------------------------------------------------------------------------------------------------
//                                              LIVE TELEMETRY SNAPSHOT
//------------------------------------------------------------------------------------------------------------------------

struct ShowcaseTelemetrySnapshot
{
    // Render & Nanite
    float    LastFrameRenderMs        = 0.0f;    // [ms]
    uint32_t ActiveNaniteClusters     = 68u;     // [clusters]
    uint32_t TotalNaniteTriangles     = 14820u;  // [tris]
    uint32_t GlassIsolatedClusters    = 8u;      // [clusters]
    float    AdaptedSceneEv100        = 11.4f;   // [EV100]
    float    CabinProtectedGain       = 1.0f;    // [-]

    // Vehicle & GRIT Drivetrain
    float    SpeedKmh                 = 0.0f;    // [km/h]
    float    EngineRpm                = 850.0f;  // [rpm]
    int32_t  CurrentGear              = 1;       // [-]
    float    ThrottlePedal            = 0.0f;    // [0..1]
    float    BrakePedal               = 0.0f;    // [0..1]
    float    SteerAngleDeg            = 0.0f;    // [deg]
    float    LongitudinalG            = 0.0f;    // [g]
    float    LateralG                 = 0.0f;    // [g]
    float    WheelTempC[4]            = {48.0f, 48.0f, 52.0f, 52.0f}; // [C]
    float    WheelLoadKn[4]           = {3.9f, 3.9f, 4.1f, 4.1f};     // [kN]
    float    WheelSlip[4]             = {0.02f, 0.02f, 0.04f, 0.04f}; // [-]
    std::array<float, 48> SpeedHistory{};
    std::array<float, 48> RpmHistory{};

    // Physics, Fracture, Course & Portals
    double   PhysicsStepHz            = 240.0;   // [Hz]
    uint64_t PhysicsTotalSteps        = 0u;      // [steps]
    uint32_t DisplacedCones           = 0u;      // [cones]
    uint32_t FractureHullCount        = 1u;      // [hulls]
    float    FractureVolumeConserved  = 100.0f;  // [%]
    bool     FractureCleaved          = false;   // [-]
    uint32_t ActivePortalPairs        = 2u;      // [pairs]
    bool     PortalTransitBlocked     = false;   // [-]

    // Pyro, Weather, Snow, Water & Sparks
    float    PyroStepMs               = 0.85f;   // [ms]
    float    PyroPeakKelvin           = 1680.0f; // [K]
    float    PyroActiveVoxelsPct      = 31.5f;   // [%]
    std::array<float, 48> PyroMsHistory{};
    uint32_t ActiveRainStreaks        = 0u;      // [drops]
    uint32_t ActiveSnowFlakes         = 0u;      // [flakes]
    uint32_t ActiveHailStones         = 0u;      // [stones]
    uint32_t HailBounceEvents         = 0u;      // [bounces]
    uint32_t SnowConnectedComponents  = 1u;      // [meshes] - Invariant: == 1
    float    SnowPeakDepthCm          = 28.0f;   // [cm]
    uint32_t SnowTriangleCount        = 0u;      // [tris]
    std::array<float, 32> SnowCrossSectionCm{};
    float    WaterMeanDepthMm         = 18.5f;   // [mm]
    float    WaterMaxWaveSpeedMps     = 0.42f;   // [m/s]
    uint32_t WaterFoamParticles       = 0u;      // [particles] - Invariant: == 0
    uint32_t WaterSplashParticles     = 0u;      // [particles] - Invariant: == 0
    std::array<float, 32> WaterCrossSectionMm{};
    uint32_t ActiveSparkCount         = 0u;      // [sparks]

    // Networking
    uint32_t ReplicationPayloadBytes  = 48u;     // [B] - GRIT 48 B codec
    uint64_t ReplicatedPacketsSent    = 0u;      // [packets]
    float    ReplicationRmsPosErrMm   = 0.35f;   // [mm]
    std::array<float, 48> NetBitrateKbpsHistory{};
};

//------------------------------------------------------------------------------------------------------------------------
//                                        GROUP 1: RENDER (3 COMPONENTS)
//------------------------------------------------------------------------------------------------------------------------

class ShowcaseRenderPipelineRecord final : public RecordEntry
{
  public:
    explicit ShowcaseRenderPipelineRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);

    bool    Enabled              = true;
    int32_t TracingTier          = 1;      // 0 = GTX (SDF GI + BVH RT), 1 = RTX (Full RayQuery), 2 = Blinn Low-Res
    int32_t InspectionMode       = 0;      // 0 = Final, 1 = Direct Sun & Shadows, 2 = ReSTIR GI, 3 = Reflections, 4 = SDF, 5 = Normals, 6 = Albedo
    int32_t ViewportScalePercent = 50;     // 35 / 50 / 75 / 100 %
    double  GiBounceGain         = 1.10;   // [-]
    double  ReflectionSharpness  = 0.92;   // [-]
    double  NanitePixelError     = 1.00;   // [px]
    bool    EnableSpatialRestir  = true;
    bool    EnableAtrousDenoiser = true;
    bool    IsolateGlassNanite   = true;
};

class ShowcaseExposureCameraRecord final : public RecordEntry
{
  public:
    explicit ShowcaseExposureCameraRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);

    bool    Enabled               = true;
    int32_t ActiveCameraPreset    = 0;     // 0=Hero, 1=CabinHMI, 2=Portals, 3=Snow&Water, 4=Pyro&Fracture, 5=Chase, 6=Roof
    int32_t ToneMapper            = 0;     // 0 = Chromatic AgX, 1 = ACES Fitted
    double  ExposureCompensation  = 0.05;  // [EV]
    double  VerticalFovDeg        = 50.0;  // [deg]
    double  AdaptationSpeedUp     = 3.2;   // [EV/s]
    double  AdaptationSpeedDown   = 1.6;   // [EV/s]
    double  SolarFlareIntensity   = 0.65;  // [-]
    bool    ProtectDarkCabinHmi   = true;  // Prevents over-brightening dark cabins lit by emissive screens!
    bool    EnableSolarLensFlare  = true;
    bool    EnableMultiScaleBloom = true;
};

class ShowcaseAreaLightRigRecord final : public RecordEntry
{
  public:
    explicit ShowcaseAreaLightRigRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);

    bool   Enabled              = true;
    double GantryLuminanceNits  = 420.0;  // [cd/m^2] - Balanced so sunlit directional shadows stay razor-crisp!
    double GantryTempKelvin     = 5200.0; // [K]
    double PortalArchGlowNits   = 1450.0; // [cd/m^2]
    double AtrousPhiNormal      = 32.0;   // [-]
    double AtrousPhiDepth       = 0.12;   // [m]
    bool   SolidAngleNee        = true;
    bool   KarisSpecRepresentative = true;
};

//------------------------------------------------------------------------------------------------------------------------
//                                      GROUP 2: ENVIRONMENT (6 COMPONENTS)
//------------------------------------------------------------------------------------------------------------------------

class ShowcaseDirectionalSunRecord final : public RecordEntry
{
  public:
    explicit ShowcaseDirectionalSunRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);

    bool   Enabled            = true;
    double AzimuthDeg         = 118.0;   // [deg] - Side-lit across proving grounds for crisp foreground shadows!
    double ElevationDeg       = 28.5;    // [deg]
    double IlluminanceKlx     = 98.0;    // [klx]
    double AngularDiameterDeg = 0.545;   // [deg]
    double WarmTint           = 0.14;    // [0..1]
    bool   CastCloudShadows   = true;
    bool   CastPlumeShadows   = true;
};

class ShowcaseAtmosphereSkyRecord final : public RecordEntry
{
  public:
    explicit ShowcaseAtmosphereSkyRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);

    bool    Enabled               = true;
    int32_t SkyTimePreset         = 0;    // 0 = Golden Proving Grounds, 1 = Overcast Storm, 2 = Celestial Night
    double  MieTurbidity          = 2.35; // [-]
    double  RayleighScale         = 1.00; // [-]
    double  OzoneAbsorption       = 1.05; // [-]
    double  StarfieldBrightness   = 1.00; // [-]
    double  MoonIllumination      = 0.72; // [-]
    bool    MultiScatterLut       = true;
    bool    ShowRingedPlanet      = true;
};

class ShowcaseVolumetricCloudsRecord final : public RecordEntry
{
  public:
    explicit ShowcaseVolumetricCloudsRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);

    bool   Enabled            = true;
    double Coverage           = 0.28;    // [0..1] - Sunlit cumulus with crisp solar transmittance!
    double ExtinctionDensity  = 0.052;   // [1/m]
    double CloudBaseKm        = 1.45;    // [km]
    double CloudTopKm         = 4.20;    // [km]
    double AnvilAmount        = 0.32;    // [0..1]
    double SilverLining       = 0.78;    // [0..1]
    bool   IgnPhaseJitter64   = true;    // Zero-banding 64-step raymarch
};

class ShowcaseHeightFogRecord final : public RecordEntry
{
  public:
    explicit ShowcaseHeightFogRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);

    bool   Enabled            = true;
    double BaseDensity        = 0.00045; // [1/m] - Crisp foreground visibility + distant atmospheric depth!
    double HeightFalloff      = 0.14;    // [1/m]
    double StartDistanceM     = 12.0;    // [m]
    double AnisotropyG        = 0.62;    // [-0.9..0.9]
    bool   VisibleInPortals   = true;
};

class ShowcaseSkyPrecipitationRecord final : public RecordEntry
{
  public:
    explicit ShowcaseSkyPrecipitationRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);

    bool    Enabled             = true;
    int32_t WeatherMode         = 3;     // 0 = Clear, 1 = Rain, 2 = Snowfall, 3 = Mixed Rain+Snow+Hail Showcase
    double  RainIntensity       = 0.58;  // [0..1]
    double  SnowfallIntensity   = 0.76;  // [0..1]
    double  HailIntensity       = 0.64;  // [0..1]
    double  HailDiameterMm      = 19.0;  // [mm]
    double  HailRestitution     = 0.56;  // [0..1]
    bool    MultiBounceHail     = true;
    bool    FeedSnowMound       = true;
};

class ShowcaseLightningDischargeRecord final : public RecordEntry
{
  public:
    explicit ShowcaseLightningDischargeRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);

    bool   Enabled             = false;
    double StrikeCadencePerMin = 8.0;    // [1/min]
    double ChannelRadiance     = 14.0;   // [MW/sr]
    double BranchComplexity    = 0.68;   // [0..1]
    bool   TriggerStrikePulse  = false;
    bool   IlluminateCloudCore = true;
};

//------------------------------------------------------------------------------------------------------------------------
//                                      GROUP 3: FORCEFIELD (2 COMPONENTS)
//------------------------------------------------------------------------------------------------------------------------

class ShowcaseWindForcefieldRecord final : public RecordEntry
{
  public:
    explicit ShowcaseWindForcefieldRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);

    bool   Enabled             = true;
    double AzimuthDeg          = 38.0;   // [deg]
    double MeanSpeedMps        = 7.4;    // [m/s]
    double GustAmplitudeMps    = 4.2;    // [m/s]
    double CurlTurbulence      = 0.45;   // [0..1]
    bool   AdvectPlumeAndSnow  = true;
};

class ShowcaseGravitySolverRecord final : public RecordEntry
{
  public:
    explicit ShowcaseGravitySolverRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);

    bool   Enabled             = true;
    double GravityMps2         = 9.81;   // [m/s^2]
    double SolverTickHz        = 240.0;  // [Hz]
    double ContactFriction     = 0.94;   // [-]
    bool   AsyncPhysicsWorker  = false;
    bool   RequestCourseReset  = false;
};

//------------------------------------------------------------------------------------------------------------------------
//                                       GROUP 4: VEHICLE (6 COMPONENTS)
//------------------------------------------------------------------------------------------------------------------------

class ShowcaseControlVehicleRecord final : public RecordEntry
{
  public:
    explicit ShowcaseControlVehicleRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);

    bool    Enabled             = true;
    int32_t PaintPreset         = 0;     // 0 = Alpine Silver, 1 = Frontier Mint, 2 = Signal Orange, 3 = Deep Cobalt
    int32_t DriveProgram        = 1;     // 0 = Parked Showcase, 1 = Autopilot Oval/Slalom, 2 = Manual WASD
    double  ChassisMassKg       = 1580.0;// [kg]
    double  CgHeightM           = 0.49;  // [m]
    double  AeroDragCd          = 0.29;  // [-]
    double  CruiseTargetKmh     = 58.0;  // [km/h]
    bool    DoorsClosed         = true;
    bool    TriggerRespawn      = false;
};

class ShowcasePropulsionDrivetrainRecord final : public RecordEntry
{
  public:
    explicit ShowcasePropulsionDrivetrainRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);

    bool    Enabled             = true;
    int32_t DrivetrainLayout    = 2;     // 0 = RWD, 1 = FWD, 2 = AWD Torque-Split
    double  PeakTorqueNm        = 540.0; // [Nm]
    double  RedlineRpm          = 7400.0;// [rpm]
    double  FrontTorqueSplit    = 0.38;  // [0..1]
    double  FinalDriveRatio     = 3.73;  // [-]
    bool    AutoTransmission    = true;
    bool    TractionControl     = true;
};

class ShowcaseSuspensionCornerRecord final : public RecordEntry
{
  public:
    explicit ShowcaseSuspensionCornerRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);

    bool   Enabled              = true;
    double FrontSpringKnPerM    = 42.0;  // [kN/m]
    double RearSpringKnPerM     = 46.0;  // [kN/m]
    double BumpDampingNsPerM    = 3800.0;// [Ns/m]
    double ReboundDampingNsPerM = 5200.0;// [Ns/m]
    double RideHeightOffsetMm   = 0.0;   // [mm]
    bool   AntiRollBars         = true;
};

class ShowcaseTyreThermalRecord final : public RecordEntry
{
  public:
    explicit ShowcaseTyreThermalRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);

    bool    Enabled             = true;
    int32_t CompoundChoice      = 1;     // 0 = All-Weather, 1 = Proving Grounds Sport, 2 = Studded Snow
    double  PeakFrictionMu      = 1.18;  // [-]
    double  InflationBar        = 2.35;  // [bar]
    double  ThermalHeatingRate  = 1.00;  // [-]
    bool    EmitWheelSparksOnRim= true;
};

class ShowcaseCabinHmiRecord final : public RecordEntry
{
  public:
    explicit ShowcaseCabinHmiRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);

    bool    Enabled               = true;
    int32_t HmiThemeMode          = 0;   // 0 = Sport Telemetry, 1 = Navigation ADAS, 2 = Weather & Tyre Matrix
    double  ClusterLuminanceNits  = 420.0;// [cd/m^2]
    double  CentreScreenNits      = 380.0;// [cd/m^2]
    double  AmbientTrimStripNits  = 65.0; // [cd/m^2]
    double  SteeringWheelAngleDeg = 0.0;  // [deg]
    bool    AdasRadarCorridor     = true;
    bool    CabinIconDepotActive  = true;
};

class ShowcaseHeadlampOpticsRecord final : public RecordEntry
{
  public:
    explicit ShowcaseHeadlampOpticsRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);

    bool   Enabled              = true;
    bool   HighBeamActive       = false;
    bool   DaytimeRunningStrip  = true;
    bool   BrakeLampOverride    = false;
    double HeadlampIntensityCd  = 28500.0;// [cd]
    double BeamPitchDeg         = -1.4;  // [deg]
    double AdaptiveSwivelDeg    = 12.0;  // [deg]
};

//------------------------------------------------------------------------------------------------------------------------
//                                       GROUP 5: EFFECTS (4 COMPONENTS)
//------------------------------------------------------------------------------------------------------------------------

class ShowcasePyroPlumeRecord final : public RecordEntry
{
  public:
    explicit ShowcasePyroPlumeRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);

    bool    Enabled              = true;
    int32_t PlumePreset          = 0;    // 0 = Campfire Steady, 1 = Hero Detonation, 2 = Tyre Burnout Ring
    int32_t QualityGrade         = 1;    // 0 = Fast, 1 = Balanced (5.13x SIMD), 2 = Hero
    double  FuelInjectionRate    = 1.25; // [-]
    double  BurnTemperatureK     = 1680.0;// [K]
    double  BuoyancyLift         = 4.80; // [m/s^2]
    double  VorticityConfinement = 2.60; // [-]
    bool    TriggerDetonationBurst = false;
    bool    SelfShadowScattering = true;
};

class ShowcaseSnowMoundRecord final : public RecordEntry
{
  public:
    explicit ShowcaseSnowMoundRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);

    bool   Enabled               = true;
    double AccumulationRateScale = 1.00; // [-]
    double CompactionStiffness   = 0.62; // [0..1]
    double SubsurfaceScatter     = 0.78; // [0..1]
    bool   CarveWheelFurrows     = true;
    bool   RebuildWarmupDrift    = false;
};

class ShowcaseShallowWaterRecord final : public RecordEntry
{
  public:
    explicit ShowcaseShallowWaterRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);

    bool   Enabled               = true;
    double BasinMeanDepthMm      = 22.0; // [mm]
    double WaveCflSpeed          = 1.00; // [-]
    double VelocityDamping       = 0.985;// [-]
    double FresnelReflectivity   = 0.92; // [0..1]
    bool   CoupleRaindropRipples = true;
    bool   CoupleTyreDisplacement= true;
};

class ShowcaseSparkEmitterRecord final : public RecordEntry
{
  public:
    explicit ShowcaseSparkEmitterRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);

    bool   Enabled               = true;
    double EmissionRatePerSec    = 140.0;// [1/s]
    double LaunchSpeedMps        = 11.5; // [m/s]
    double BounceRestitution     = 0.64; // [0..1]
    double ShutterStreakMs       = 14.0; // [ms]
    bool   TriggerSparkBurst     = false;
};

//------------------------------------------------------------------------------------------------------------------------
//                                     GROUP 6: DESTRUCTION (1 COMPONENT)
//------------------------------------------------------------------------------------------------------------------------

class ShowcaseSolidFractureRecord final : public RecordEntry
{
  public:
    explicit ShowcaseSolidFractureRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);

    bool    Enabled               = true;
    int32_t TargetVoronoiSites    = 28;   // [hulls]
    double  ImpactEnergyKj        = 18.5; // [kJ]
    double  FractureToughnessKc   = 1.45; // [MPa*sqrt(m)]
    double  RadialShardGapM       = 0.22; // [m]
    bool    CleavedState          = true;
    bool    TriggerCleaveNow      = false;
    bool    TriggerResetIntact    = false;
};

//------------------------------------------------------------------------------------------------------------------------
//                                        GROUP 7: LEVEL (2 COMPONENTS)
//------------------------------------------------------------------------------------------------------------------------

class ShowcaseProvingGroundsCourseRecord final : public RecordEntry
{
  public:
    explicit ShowcaseProvingGroundsCourseRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);

    bool   Enabled               = true;
    double AsphaltRoughness      = 0.34; // [0..1]
    double WetRoadPatchiness     = 0.48; // [0..1]
    double RampElevationScale    = 1.00; // [-]
    bool   ShowSlalomCones       = true;
    bool   ShowCalibrationGantry = true;
};

class ShowcaseSeamlessPortalsRecord final : public RecordEntry
{
  public:
    explicit ShowcaseSeamlessPortalsRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);

    bool    Enabled               = true;
    int32_t PrimaryApertureShape  = 1;    // 0 = Rectangular Arch, 1 = Circular Ring + Rectangular Pair
    double  CircularPortalRadiusM = 2.15; // [m]
    double  MaxRecursionHops      = 3.0;  // [hops]
    bool    ExitSideDuplicateMesh = true; // Renders split duplicate mesh emerging on exit side!
    bool    BlockSolidObstacles   = true; // Blocks transit when exit aperture is obstructed!
    bool    EnablePlanarMirror    = true;
};

class ShowcasePlaceableObjectRecord final : public RecordEntry
{
  public:
    ShowcasePlaceableObjectRecord(const char *StableIdStr, const char *DisplayLabel,
                                  int32_t InitialShape, int32_t InitialMaterial,
                                  double InitialX, double InitialY, double InitialZ,
                                  double HalfX, double HalfY, double HalfZ,
                                  bool InitiallyEnabled,
                                  const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);

    bool    Enabled        = true;
    int32_t ShapePreset    = 0;    // 0 = Chicane Block, 1 = Stepped Pedestal, 2 = Calibration Arch, 3 = Nanite Prism
    int32_t MaterialPreset = 0;    // 0 = Concrete, 1 = Signal Orange, 2 = Anodized Copper, 3 = Obsidian, 4 = Crown Glass
    double  PosX           = 0.0;  // [m]
    double  PosY           = 0.0;  // [m]
    double  PosZ           = 0.65; // [m]
    double  HalfExtentX    = 0.85; // [m]
    double  HalfExtentY    = 0.55; // [m]
    double  HalfExtentZ    = 0.65; // [m]
    double  YawDeg         = 0.0;  // [deg]
    double  Roughness      = 0.42; // [0..1]
    double  Metallic       = 0.08; // [0..1]
};

//------------------------------------------------------------------------------------------------------------------------
//                                      GROUP 8: NETWORKING (1 COMPONENT)
//------------------------------------------------------------------------------------------------------------------------

class ShowcaseStateReplicationRecord final : public RecordEntry
{
  public:
    explicit ShowcaseStateReplicationRecord(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);

    bool   Enabled               = true;
    double SendRateHz            = 60.0; // [Hz]
    double SimulatedRttMs        = 24.0; // [ms]
    double PacketJitterMs        = 2.5;  // [ms]
    bool   HermiteInterpolation  = true;
    bool   RenderGhostComparison = false;
};

//------------------------------------------------------------------------------------------------------------------------
//                                         BUNDLE OF ALL 25 SCENE RECORDS
//------------------------------------------------------------------------------------------------------------------------

struct ShowcaseRecordBundle
{
    ShowcaseRenderPipelineRecord        RenderPipeline;
    ShowcaseExposureCameraRecord        ExposureCamera;
    ShowcaseAreaLightRigRecord          AreaLightRig;

    ShowcaseDirectionalSunRecord        DirectionalSun;
    ShowcaseAtmosphereSkyRecord         AtmosphereSky;
    ShowcaseVolumetricCloudsRecord      VolumetricClouds;
    ShowcaseHeightFogRecord             HeightFog;
    ShowcaseSkyPrecipitationRecord      SkyPrecipitation;
    ShowcaseLightningDischargeRecord    LightningDischarge;

    ShowcaseWindForcefieldRecord        WindForcefield;
    ShowcaseGravitySolverRecord         GravitySolver;

    ShowcaseControlVehicleRecord        ControlVehicle;
    ShowcasePropulsionDrivetrainRecord  PropulsionDrivetrain;
    ShowcaseSuspensionCornerRecord      SuspensionCorners;
    ShowcaseTyreThermalRecord           TyreThermal;
    ShowcaseCabinHmiRecord              CabinHmi;
    ShowcaseHeadlampOpticsRecord        HeadlampOptics;

    ShowcasePyroPlumeRecord             PyroPlume;
    ShowcaseSnowMoundRecord             SnowMound;
    ShowcaseShallowWaterRecord          ShallowWater;
    ShowcaseSparkEmitterRecord          SparkEmitter;

    ShowcaseSolidFractureRecord         SolidFracture;

    ShowcaseProvingGroundsCourseRecord  ProvingGroundsCourse;
    ShowcaseSeamlessPortalsRecord       SeamlessPortals;
    ShowcasePlaceableObjectRecord       PlaceableChicaneBlock;
    ShowcasePlaceableObjectRecord       PlaceableNanitePedestal;
    ShowcasePlaceableObjectRecord       PlaceableOpticalArch;
    ShowcasePlaceableObjectRecord       SpawnedObjectSlot0;
    ShowcasePlaceableObjectRecord       SpawnedObjectSlot1;

    ShowcaseStateReplicationRecord      StateReplication;

    ShowcaseRecordBundle(const ShowcaseTelemetrySnapshot *Telemetry, uint64_t *DirtyRevision);
};

} // namespace Frontier::Drive
