/*==========================================================================================================================================
                                                        PLUMEFLUIDEXTENSION.H
==========================================================================================================================================*/
// 🧩 Native C++/Vulkan 3D smoke-and-fire fluid division: toroidal window, MacCormack transport, compatible pressure, aperiodic march.

#pragma once

#include "Engine/Rendering/PlumeLatticeFootprint.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                  QUALITY & PARAMETERS
//------------------------------------------------------------------------------------------------------------------------

enum class PlumeQualityGrade : std::uint8_t
{
    Low    = 0,   // [-] 64x64x20 fine thermo, 0.40 m cell
    Medium = 1,   // [-] 96x96x24 fine thermo, 0.30 m cell
    High   = 2,   // [-] 128x128x32 fine thermo, 0.25 m cell
    Ultra  = 3    // [-] 160x160x48 fine thermo, 0.20 m cell
};

enum class PlumeSolverVariant : std::uint8_t
{
    LegacyHtmlReference = 0,   // [-] 1st-order trilinear, collocated centred divergence, 32^3 periodic detail, blurry linear flame
    ProductionUpgraded  = 1    // [-] Clamped MacCormack, matched face-flux projection, aperiodic SO(3) detail, sharp reaction sheet
};

struct PlumeFluidParameters
{
    PlumeQualityGrade  Grade                = PlumeQualityGrade::High;             // [-]   active lattice resolution preset
    PlumeSolverVariant Variant              = PlumeSolverVariant::ProductionUpgraded; // [-] numerical & optical formulation
    float              SourceRateScale      = 1.00f;                               // [-]   multiplier on tyre/fire source intake
    float              SmokeDensityScale    = 1.00f;                               // [-]   multiplier on rubber vapour density
    float              HeatScale            = 1.00f;                               // [-]   multiplier on thermal source power
    float              SootScale            = 1.00f;                               // [-]   multiplier on combustion soot yield
    float              Buoyancy             = 2.40f;                               // [m/s^2/K] upward thermal acceleration
    float              ParticulateFall      = 0.22f;                               // [m/s^2] gravitational settling of heavy smoke
    float              VorticityStrength    = 3.40f;                               // [-]   Fedkiw-Stam-Jensen confinement gain
    float              SubgridTurbulence    = 0.65f;                               // [m/s] divergence-free subgrid curl speed
    float              TurbulenceFrequency  = 3.70f;                               // [1/m] spatial curl wave-number
    float              SmokeDissipation     = 0.12f;                               // [1/s] smoke decay rate
    float              HeatCooling          = 0.55f;                               // [1/s] radiative + convective cooling rate
    float              FlameDecay           = 3.80f;                               // [1/s] reaction consumption rate
    float              SootDissipation      = 0.16f;                               // [1/s] soot decay rate
    float              WindSpeed            = 0.85f;                               // [m/s] ambient horizontal wind speed
    float              WindHeadingDegrees   = 30.0f;                               // [deg] wind heading around +Z
    float              SmokeExtinction      = 0.58f;                               // [1/m] calibrated extinction (legacy HTML used 3.60)
    float              SmokeAlbedo          = 0.92f;                               // [-]   white vulcanised rubber single-scatter albedo
    float              SootExtinction       = 2.40f;                               // [1/m] carbonaceous soot extinction
    float              SootAlbedo           = 0.06f;                               // [-]   absorbing black soot single-scatter albedo
    float              PhaseAnisotropy      = 0.38f;                               // [-]   forward Henyey-Greenstein lobe g
    float              MultiScatterGain     = 0.82f;                               // [-]   3-octave Wrenninge multiple-scattering weight
    float              DetailStrength       = 0.72f;                               // [-]   sub-cell wispy edge erosion amplitude
    float              DetailFrequency      = 2.20f;                               // [1/m] base detail spatial frequency
    float              FlowWarpStrength     = 0.22f;                               // [s]   velocity-advected dual-phase warp horizon
    float              FlameCoreKelvin      = 3100.0f;                             // [K]   incandescent reaction-zone core temperature
    float              FlameTipKelvin       = 1150.0f;                             // [K]   cooling flame tip temperature
    float              FlameHalfHeat        = 34.0f;                               // [K]   temperature ramp half-saturation
    float              FlameRadianceScale   = 92.0f;                               // [-]   blackbody radiance gain
    float              FlameSheetSharpness  = 1.85f;                               // [-]   reaction-sheet edge contrast exponent
    float              CombustionExpansion  = 1.65f;                               // [1/s] reaction-front gas dilatation source
    float              BaroclinicStrength   = 2.15f;                               // [-]   grad(T) x grad(rho) mushroom-cap torque gain
    std::uint32_t      PressureSweeps       = 16u;                                 // [-]   warm-started pressure relaxation sweeps
    std::uint32_t      MarchSampleLimit     = 64u;                                 // [-]   upper bound on ray quadrature steps
};

//------------------------------------------------------------------------------------------------------------------------
//                                              VEHICLE TELEMETRY INTAKE ABI
//------------------------------------------------------------------------------------------------------------------------

struct PlumeWheelTelemetry
{
    std::array<float, 3> ContactPoint      = { 0.0f, 0.0f, 0.0f };   // [m]   world tyre contact patch centre
    std::array<float, 3> HubPosition       = { 0.0f, 0.0f, 0.51f };  // [m]   world wheel hub centre
    std::array<float, 3> LongitudinalAxis  = { 1.0f, 0.0f, 0.0f };   // [-]   unit wheel forward direction in world space
    std::array<float, 3> LateralAxis       = { 0.0f, 1.0f, 0.0f };   // [-]   unit wheel left direction in world space
    float                WheelRadius       = 0.50855f;               // [m]   outer tyre radius
    float                SurfaceSlipSpeed  = 0.0f;                   // [m/s] signed tread slip speed (spin*R - v_long)
    float                SlidingPowerWatts = 0.0f;                   // [W]   frictional dissipation |F_slip . v_slip|
    float                TreadKelvin       = 298.15f;                // [K]   tread surface temperature
    float                CombustionWatts   = 0.0f;                   // [W]   burning rubber heat release when ignited
    bool                 Grounded          = false;                  // [-]   true when tyre carries ground load
    bool                 Ignited           = false;                  // [-]   true when tread exceeds auto-ignition threshold
    bool                 Shredded          = false;                  // [-]   true when rubber carcass is gone
};

struct alignas(16) PlumeFireLightRecord
{
    std::array<std::uint32_t, 4>             Count          = { 0u, 0u, 0u, 0u };   // [-] x = active fire point lights [0..4]
    std::array<std::array<float, 4>, 4>      PositionRadius = {};                   // [m] xyz world position, w softening radius
    std::array<std::array<float, 4>, 4>      Radiance       = {};                   // [W/sr] rgb linear radiance, w = 0
};

static_assert(sizeof(PlumeFireLightRecord) == 144 && alignof(PlumeFireLightRecord) == 16);

struct PlumeDiagnostics
{
    float         RmsDivergenceBefore  = 0.0f;   // [1/s] velocity divergence norm prior to pressure projection
    float         RmsDivergenceAfter   = 0.0f;   // [1/s] velocity divergence norm after pressure projection
    float         PeakSmokeDensity     = 0.0f;   // [-]   maximum fine-cell rubber vapour scalar
    float         PeakHeatKelvin       = 0.0f;   // [K]   maximum fine-cell superheat above ambient
    float         PeakFlameScalar      = 0.0f;   // [-]   maximum fine-cell reaction progress variable
    float         ActiveVolumeCubicM   = 0.0f;   // [m^3] volume of cells above visibility threshold
    std::uint32_t ActiveSources        = 0u;     // [-]   packed Gaussian sources uploaded this step
    std::uint32_t Relocations          = 0u;     // [-]   cumulative toroidal window shifts
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  RAY-MARCH CAMERA VIEW
//------------------------------------------------------------------------------------------------------------------------

struct PlumeCameraView
{
    std::array<float, 3> CameraOrigin      = { -8.0f, 0.0f, 2.2f };    // [m]   eye position in world space
    std::array<float, 3> CameraForward     = { 1.0f, 0.0f, -0.12f };   // [-]   unit forward viewing axis
    std::array<float, 3> CameraRight       = { 0.0f, -1.0f, 0.0f };    // [-]   unit right screen axis
    std::array<float, 3> CameraUp          = { 0.12f, 0.0f, 1.0f };    // [-]   unit up screen axis
    std::array<float, 3> SunDirection      = { 0.45f, -0.35f, 0.82f }; // [-]   unit vector toward solar disc
    std::array<float, 3> SunIlluminance    = { 4.2f, 3.9f, 3.5f };     // [-]   linear solar irradiance
    std::array<float, 3> SkyRadiance       = { 0.36f, 0.50f, 0.78f };  // [-]   hemispherical sky ambient
    float                VerticalFovRad    = 0.96f;                    // [rad] vertical field of view
    std::uint32_t        Width             = 160u;                     // [px]  output width
    std::uint32_t        Height            = 96u;                      // [px]  output height
    std::uint32_t        SequenceOrdinal   = 0u;                       // [-]   temporal jitter index
};

struct PlumeSolidObstacleBox
{
    std::array<float, 3> Centre         = { 0.0f, 0.0f, 0.0f };   // [m]     world obstacle centre
    std::array<float, 3> HalfExtents    = { 1.0f, 1.0f, 1.0f };   // [m]     local half-sizes along X, Y, Z
    std::array<float, 3> LinearVelocity = { 0.0f, 0.0f, 0.0f };   // [m/s]   moving solid velocity (0 for static walls)
    float                YawRadians     = 0.0f;                   // [rad]   heading rotation around +Z
};

//------------------------------------------------------------------------------------------------------------------------
//                                                 PLUME FLUID EXTENSION
//------------------------------------------------------------------------------------------------------------------------

class PlumeFluid
{
public:
    static constexpr std::size_t SourceLimit   = 24u;
    static constexpr std::size_t ObstacleLimit = 64u;

    explicit PlumeFluid(const PlumeFluidParameters& Parameters = {});

    void Reconfigure(const PlumeFluidParameters& Parameters);
    void UpdatePhysicalParameters(const PlumeFluidParameters& Parameters);
    void ClearState() noexcept;

    // Registers solid obstacles (walls, tunnel ceilings, cones, vehicle chassis) for Neumann collision deflection.
    void ClearSolidObstacles() noexcept;
    void RegisterSolidObstacle(const PlumeSolidObstacleBox& Obstacle) noexcept;

    // Projects 4-wheel slip/thermal telemetry + optional transient bursts into bounded Gaussian sources & fire lights.
    void IngestVehicleTelemetry(
        const std::array<float, 3>&                VehiclePosition,
        const std::array<PlumeWheelTelemetry, 4>&  Wheels,
        float                                      StepSeconds) noexcept;

    void AppendTransientPlumeSource(
        const std::array<float, 3>& Position,
        float                       Radius,
        const std::array<float, 3>& Velocity,
        float                       SmokeRate,
        float                       HeatRate,
        float                       FlameRate,
        float                       SootRate) noexcept;

    // Injects an explosive fireball detonation (Experimental/Fluid hero_detonation): radial shockwave impulse,
    // superheated reaction core, turbulent outer soot ring, and internal fire point-light illumination.
    void InjectDetonationBlast(
        const std::array<float, 3>& BlastCentreWorld,
        float                       BlastRadiusMetres,
        float                       ShockSpeedMps        = 11.5f,
        float                       CoreSuperheatKelvin  = 420.0f,
        float                       CoreFlameProgress    = 1.45f,
        float                       OuterSootDensity     = 1.85f) noexcept;

    // Advances toroidal lattice one simulation step (advection -> curl/vorticity -> pressure -> thermo -> self-shadow).
    PlumeDiagnostics AdvanceSimulation(
        const std::array<float, 3>& AnchorPosition,
        const std::array<float, 3>& SunDirection,
        float                       StepSeconds);

    // Evaluates premultiplied RGBA (rgb = linear scattered + blackbody radiance, a = transmittance) over the view frustum.
    void MarchVolumeView(
        const PlumeCameraView&      View,
        const float*                OpaqueDistanceMetres,
        std::vector<float>&         OutPremultipliedRgba) const;

    // Evaluates single-ray plume radiance & transmittance [rgb, T] from Origin along unit Direction up to MaxDistance.
    [[nodiscard]] std::array<float, 4> EvaluatePlumeRay(
        const std::array<float, 3>& Origin,
        const std::array<float, 3>& Direction,
        float                       MaxDistance,
        float                       JitterOffset,
        const std::array<float, 3>& SunDirection,
        const std::array<float, 3>& SunIlluminance,
        const std::array<float, 3>& SkyRadiance) const noexcept;

    // Evaluates volumetric Beer-Lambert shadow transmittance T in [0, 1] cast by smoke & soot onto scene receivers.
    [[nodiscard]] float EvaluateShadowTransmittance(
        const std::array<float, 3>& Origin,
        const std::array<float, 3>& Direction,
        float                       MaxDistance) const noexcept;

    // Evaluates direct scene irradiance [rgb] from active plume fire seats & incandescent gas pockets onto a surface.
    [[nodiscard]] std::array<float, 3> EvaluateSceneIllumination(
        const std::array<float, 3>& ReceiverPosition,
        const std::array<float, 3>& ReceiverNormal) const noexcept;

    // Exposes GPU-ready std140/std430 buffers matching Shaders/PlumeFluidTransport.slang & Shaders/PlumeFluidMarch.slang.
    [[nodiscard]] const PlumeLatticeFootprint&              Footprint() const noexcept      { return Footprint_; }
    [[nodiscard]] const std::vector<PlumeSourceFootprint>&  Sources() const noexcept        { return Sources_; }
    [[nodiscard]] const PlumeFireLightRecord&               FireLights() const noexcept     { return FireLights_; }
    [[nodiscard]] const PlumeDiagnostics&                   Diagnostics() const noexcept    { return Diagnostics_; }
    [[nodiscard]] const std::vector<float>&                 ThermoData() const noexcept     { return ThermoCurrent_; }
    [[nodiscard]] const std::vector<float>&                 VelocityData() const noexcept   { return VelocityCurrent_; }
    [[nodiscard]] const std::vector<float>&                 LightData() const noexcept      { return LightTransmittance_; }
    [[nodiscard]] std::array<std::uint32_t, 3>              ThermoExtent() const noexcept   { return ThermoExtent_; }
    [[nodiscard]] std::array<std::uint32_t, 3>              VelocityExtent() const noexcept { return VelocityExtent_; }

    // Direct accessors for controlled numerical validation (checkerboard divergence, periodic tiling, flame sharpness).
    void InjectVelocityFieldForTesting(const std::vector<float>& VelocityRgba);
    void ProjectPressureOnlyForTesting(PlumeDiagnostics& OutMetrics);
    [[nodiscard]] static float EvaluateDetailFieldSample(
        const std::array<float, 3>& WorldPosition,
        const std::array<float, 3>& LocalVelocity,
        float                       ElapsedSeconds,
        float                       DetailFrequency,
        float                       FlowWarpStrength,
        PlumeSolverVariant          Variant) noexcept;
    [[nodiscard]] static std::array<float, 3> EvaluateBlackbodyRadiance(float Kelvin) noexcept;

private:
    [[nodiscard]] bool PointInsideSolidObstacles(
        float Px, float Py, float Pz,
        std::array<float, 3>* OutNearWakeVelocity = nullptr,
        float*                OutWakeBlend        = nullptr) const noexcept;

    struct WheelOnsetEnvelope
    {
        float RequestSeconds = 0.0f;
        float QuietSeconds   = 0.0f;
        bool  Active         = false;
    };

    PlumeFluidParameters               Parameters_{};
    PlumeLatticeFootprint              Footprint_{};
    std::array<std::uint32_t, 3>       ThermoExtent_       = { 128u, 128u, 32u };
    std::array<std::uint32_t, 3>       VelocityExtent_     = { 64u, 64u, 16u };
    float                              FineCellMetres_     = 0.25f;
    float                              CoarseCellMetres_   = 0.50f;
    std::array<std::int32_t, 2>        OriginXY_           = { 0, 0 };
    std::array<std::int32_t, 2>        PriorOriginXY_      = { 1 << 20, 1 << 20 };
    float                              ElapsedSeconds_     = 0.0f;
    std::uint32_t                      Relocations_        = 0u;
    std::array<WheelOnsetEnvelope, 4>  WheelOnsets_{};
    std::vector<PlumeSourceFootprint>  Sources_;
    std::vector<PlumeSolidObstacleBox> Obstacles_;
    PlumeFireLightRecord               FireLights_{};
    PlumeDiagnostics                   Diagnostics_{};
    std::array<std::int32_t, 3>        CoverageLow_        = { 1, 1, 1 };
    std::array<std::int32_t, 3>        CoverageHigh_       = { 0, 0, 0 };

    std::vector<float>                 VelocityCurrent_;
    std::vector<float>                 VelocityScratch_;
    std::vector<float>                 CurlField_;
    std::vector<float>                 DivergenceField_;
    std::vector<float>                 PressureCurrent_;
    std::vector<float>                 PressureScratch_;
    std::vector<float>                 ThermoCurrent_;
    std::vector<float>                 ThermoScratch_;
    std::vector<float>                 ThermoBackward_;
    std::vector<float>                 LightTransmittance_;
    std::vector<float>                 FaceFluxScratch_;
    std::array<std::uint32_t, 3>       MacroBrickExtent_   = { 16u, 16u, 4u };
    std::vector<std::uint8_t>          MacroOccupancy_;
};

} // namespace Frontier
