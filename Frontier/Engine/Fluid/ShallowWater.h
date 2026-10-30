/*==========================================================================================================================================
                                                   SHALLOWWATERMUDEXTENSION.H
==========================================================================================================================================*/
// 🧩 2.5D Saint-Venant shallow-water & Bingham-plastic mud solver (puddles, fords, mud pits, two-way nested domain link, zero foam/splash).

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                        SHALLOW-WATER & BINGHAM-MUD CONFIGURATION
//------------------------------------------------------------------------------------------------------------------------

enum class WaterBoundaryCondition : std::uint8_t
{
    SolidReflectiveWall = 0,   // [-] zero normal discharge across domain border
    AbsorbingSponge     = 1,   // [-] quadratic sponge relaxation toward SeaSurfaceElevationM
    IncidentWaveMaker   = 2    // [-] linear long-wave swell + sponge relaxation
};

struct ShallowWaterConfiguration
{
    std::uint32_t          CellsX                  = 128u;    // [-]     grid columns along +X
    std::uint32_t          CellsY                  = 128u;    // [-]     grid rows along +Y
    float                  CellSizeMetres          = 0.50f;   // [m]     horizontal cell spacing dx = dy
    std::array<float, 2>   WorldOriginXY           = { -32.0f, -32.0f }; // [m] world minimum corner
    float                  GravityMps2             = 9.81f;   // [m/s^2] gravitational acceleration
    float                  DryThresholdMetres      = 1.0e-4f; // [m]     wet/dry front cutoff
    float                  KinematicViscosityM2ps  = 1.5e-3f; // [m^2/s] eddy viscosity
    float                  ClearWaterManning       = 0.016f;  // [s/m^(1/3)] asphalt/concrete Manning roughness
    float                  MudManning              = 0.065f;  // [s/m^(1/3)] rough mud bed Manning coefficient
    float                  MaximumVelocityMps      = 14.0f;   // [m/s]   CFL velocity clamp
    // O'Brien & Julien (1988) Bingham-plastic mud rheology: mu = A*(exp(B*cv)-1), tau_y = C*(exp(D*cv)-1)
    float                  SedimentDensityKgPerM3  = 2650.0f; // [kg/m^3] quartz/clay grain density
    float                  MaxVolumetricSediment   = 0.48f;   // [-]     maximum packing fraction cv at c = 1
    float                  MudViscosityCoeffPaSec  = 0.038f;  // [Pa*s]  alpha_1 exponential mud viscosity scale
    float                  MudViscosityExponent    = 14.5f;   // [-]     beta_1 exponential mud viscosity slope
    float                  MudYieldStressCoeffPa   = 0.45f;   // [Pa]    alpha_2 Bingham yield stress scale
    float                  MudYieldStressExponent  = 15.2f;   // [-]     beta_2 Bingham yield stress slope
    float                  MudDiffusionM2ps        = 0.004f;  // [m^2/s] conservative wet-neighbour sediment mixing
    // Rain puddle & drainage hydrology (strictly NO foam and NO splash!)
    float                  ThinFilmDrainDepthM     = 0.0025f; // [m]     films thinner than 2.5 mm infiltrate/evaporate
    float                  InfiltrationRateMps     = 2.0e-5f; // [m/s]   porous asphalt drainage rate
    float                  ObjectCouplingRatePerS  = 18.0f;   // [1/s]   submerged wheel/hull velocity coupling rate
    float                  SpongeWidthMetres       = 4.0f;    // [m]     open-boundary relaxation rim width
    float                  SpongeRelaxRatePerS     = 3.5f;    // [1/s]   open-boundary relaxation rate
    float                  SeaSurfaceElevationM    = -10.0f;  // [m]     open-boundary reference water level
    float                  HoleCrossFadeMetres     = 6.0f;    // [m]     71ce888b nested coarse/fine border cross-fade width
    bool                   SecondOrderHydrostatic  = true;    // [-]     2nd-order Audusse-Minmod lake-at-rest upgrade
    std::array<WaterBoundaryCondition, 4> Boundaries = {
        WaterBoundaryCondition::SolidReflectiveWall,
        WaterBoundaryCondition::SolidReflectiveWall,
        WaterBoundaryCondition::SolidReflectiveWall,
        WaterBoundaryCondition::SolidReflectiveWall
    };
};

//------------------------------------------------------------------------------------------------------------------------
//                                       SUBMERGED BODY, SOURCE & WHEEL INTERACTION
//------------------------------------------------------------------------------------------------------------------------

struct SubmergedSolidStamp
{
    std::array<float, 3> Centre         = { 0.0f, 0.0f, 0.0f };   // [m]   world centre of wheel patch or chassis hull
    std::array<float, 3> HalfExtents    = { 0.25f, 0.15f, 0.25f };// [m]   half-width X, half-length Y, half-height Z
    std::array<float, 2> HorizontalVel  = { 0.0f, 0.0f };         // [m/s] horizontal body velocity (u, v)
    float                YawRadians     = 0.0f;                   // [rad] heading angle around +Z
    float                LidStiffness   = 1.0f;                   // [-]   pressure-head displacement weight
};

struct FluidDischargeSource
{
    std::array<float, 2> WorldCenterXY          = { 0.0f, 0.0f }; // [m]
    float                RadiusMetres           = 1.5f;           // [m]
    float                VolumetricFlowM3PerSec = 0.0f;           // [m^3/s] >0 inflow, <0 drain
    std::array<float, 2> InflowDirectionXY      = { 1.0f, 0.0f }; // [-]
    float                InflowSpeedMps         = 0.0f;           // [m/s]
    float                SedimentConcentration  = 0.0f;           // [0..1] 0 = clear water, 1 = dense mud
};

struct SurfaceFluidSample
{
    float BedElevationMetres     = 0.0f;                    // [m]     terrain / road bed height B
    float FluidDepthMetres       = 0.0f;                    // [m]     liquid column thickness h >= 0
    float FreeSurfaceElevationM  = 0.0f;                    // [m]     eta = B + h
    float MudConcentration       = 0.0f;                    // [0..1]  0 = pure rain/water, 1 = thick Bingham mud
    std::array<float, 2> VelocityXY = { 0.0f, 0.0f };       // [m/s]   depth-averaged horizontal flow (u, v)
    std::array<float, 3> SurfaceNormal = { 0.0f, 0.0f, 1.0f }; // [-]  free-surface optical normal for reflections/caustics
    float NestedCrossFadeAlpha   = 1.0f;                    // [0..1]  71ce888b smooth inner-domain cross-fade weight
};

struct WheelFluidInteraction
{
    float                StandingWaterMillimetres = 0.0f;                 // [mm]  feeds CalibratedTyreThermodynamics Horne hydroplaning!
    float                MudConcentration         = 0.0f;                 // [0..1] mud fraction in contact patch
    float                TractionMultiplier       = 1.0f;                 // [0..1] combined wet/mud boundary grip factor
    std::array<float, 3> HydrodynamicDragNewtons  = { 0.0f, 0.0f, 0.0f }; // [N]   fluid displacement + Bingham mud suction drag
    float                BuoyancyLiftNewtons      = 0.0f;                 // [N]   Archimedean displaced fluid lift
};

struct ShallowWaterDiagnostics
{
    double        TotalLiquidVolumeCubicM = 0.0;   // [m^3]   sum(h * dx^2) across entire grid
    double        TotalSedimentVolumeM3   = 0.0;   // [m^3]   sum(c * h * dx^2) across entire grid
    float         PeakFluidDepthMetres    = 0.0f;  // [m]     deepest puddle / ford / mud pool cell
    float         PeakFlowSpeedMps        = 0.0f;  // [m/s]   peak depth-averaged speed
    std::uint32_t WettedCellCount         = 0u;    // [-]     cells with h > DryThresholdMetres
    std::uint32_t SubstepsExecuted        = 0u;    // [-]     CFL-bounded substeps taken
};

//------------------------------------------------------------------------------------------------------------------------
//                                          SHALLOW-WATER & MUD EXTENSION
//------------------------------------------------------------------------------------------------------------------------

class ShallowWaterSimulation
{
public:
    static constexpr std::size_t MaxSources = 16u;

    explicit ShallowWaterSimulation(const ShallowWaterConfiguration& Configuration = {});

    void Reconfigure(const ShallowWaterConfiguration& Configuration);
    void ResetField() noexcept;

    // Terrain / asphalt bed sculpting & initialization (supports puddle depressions, river channels, mud pits!).
    void AssignBedElevationGrid(const std::vector<float>& BedHeightsMetres);
    void SculptBedDepressionOrMound(
        std::array<float, 2> WorldCenterXY,
        float                RadiusMetres,
        float                DeltaElevationMetres) noexcept;
    void FillBasinRegion(
        std::array<float, 2> WorldCenterXY,
        float                RadiusMetres,
        float                SurfaceElevationMetres,
        float                MudConcentrationZeroToOne) noexcept;

    // Rain puddle & hail-melt hydrological coupling (cloud-gated so dry clear-sky columns receive 0 rain!).
    void DepositSpatiallyGatedRain(
        float                BaseRainRateMetresPerSec,
        const float*         CloudColumnOpticalDepths32x32,
        float                CloudOpticalGate,
        std::array<float, 2> CloudGridAnchorXY,
        float                CloudGridSpanMetres,
        float                StepSeconds) noexcept;

    void InjectLocalLiquidOrMeltVolume(
        std::array<float, 2> WorldPositionXY,
        float                RadiusMetres,
        float                AddedDepthMetres,
        float                MudConcentrationZeroToOne = 0.0f) noexcept;

    // Dynamic solid stamps & inflow/drain sources.
    void ClearSubmergedSolids() noexcept;
    void RegisterSubmergedSolid(const SubmergedSolidStamp& Solid) noexcept;
    void ClearDischargeSources() noexcept;
    void AppendDischargeSource(const FluidDischargeSource& Source) noexcept;

    // Advances staggered MAC Saint-Venant + Bingham mud one frame (automatic CFL substepping).
    ShallowWaterDiagnostics StepSimulation(
        float                StepSeconds,
        std::array<float, 2> WindVelocityTenMetresXY = { 0.0f, 0.0f });

    // Evaluates smooth bilinear surface elevation, optical normal, mud fraction, and 71ce888b cross-fade alpha.
    [[nodiscard]] SurfaceFluidSample SampleSurface(std::array<float, 2> WorldXY) const noexcept;

    // Evaluates two-way tyre/wheel interaction (standing water mm, mud grip, hydrodynamic/mud drag, buoyancy)
    // AND stamps the wheel's displacement & velocity back into the fluid solver for next step's wake!
    [[nodiscard]] WheelFluidInteraction CoupleWheelContact(
        std::array<float, 3> WheelContactWorld,
        std::array<float, 3> WheelVelocityWorld,
        float                WheelRadiusMetres,
        float                TyreWidthMetres,
        float                YawRadians);

    // Evaluates multi-probe hull buoyancy & drag for deep water fords (matching 71ce888b Buoyancy.js).
    [[nodiscard]] std::array<float, 3> EvaluateHullBuoyancyAndDragForce(
        std::array<float, 3> HullCenterWorld,
        std::array<float, 3> HullHalfExtents,
        std::array<float, 3> HullVelocityWorld,
        float                YawRadians);

    [[nodiscard]] const ShallowWaterConfiguration& Configuration() const noexcept { return Config_; }
    [[nodiscard]] const ShallowWaterDiagnostics&   Diagnostics() const noexcept   { return Diagnostics_; }
    [[nodiscard]] const std::vector<float>&        BedElevationData() const noexcept  { return Bed_; }
    [[nodiscard]] const std::vector<float>&        DepthAndMudData() const noexcept   { return DepthMud_; }
    [[nodiscard]] const std::vector<float>&        StaggeredVelocityData() const noexcept { return VelocityUV_; }

    // Internal accessors used by NestedWaterDomainLink for two-way coarse <-> fine synchronization.
    void OverwriteCellDepthAndMud(std::uint32_t CellX, std::uint32_t CellY, float DepthM, float MudConc) noexcept;
    void OverwriteCellVelocity(std::uint32_t CellX, std::uint32_t CellY, float VelU, float VelV) noexcept;

private:
    void ExecuteSingleCflSubstep(float SubstepDt, std::array<float, 2> WindVelocityXY) noexcept;

    ShallowWaterConfiguration           Config_{};
    ShallowWaterDiagnostics             Diagnostics_{};
    float                               ElapsedSeconds_ = 0.0f;
    std::vector<float>                  Bed_;             // Nx * Ny bed elevation B [m]
    std::vector<float>                  DepthMud_;        // Nx * Ny * 2: [0]=h [m], [1]=c [0..1]
    std::vector<float>                  DepthMudScratch_; // Nx * Ny * 2
    std::vector<float>                  VelocityUV_;      // Nx * Ny * 2: staggered (u_{i+1/2,j}, v_{i,j+1/2}) [m/s]
    std::vector<float>                  VelocityScratch_; // Nx * Ny * 2
    std::vector<float>                  OutflowLimiter_;  // Nx * Ny positivity limiter in [0, 1]
    std::vector<float>                  ObjectSpanStiff_; // Nx * Ny * 4: [bot, top, stiff, pad]
    std::vector<float>                  ObjectVelUV_;     // Nx * Ny * 2: [vx, vy]
    std::vector<FluidDischargeSource>   Sources_;
};

//------------------------------------------------------------------------------------------------------------------------
//                      TWO-WAY COARSE <-> FINE NESTED DOMAIN LINK (71ce888b + SEAM CROSS-FADE)
//------------------------------------------------------------------------------------------------------------------------

class NestedWaterDomainLink
{
public:
    // Injects coarse boundary ghost bands into the fine domain before stepping, and restricts interior fine
    // volume-conservative depth, mud concentration, and momentum back into the coarse grid afterwards!
    static void SynchronizeCoarseToFineRim(
        const ShallowWaterSimulation& CoarseDomain,
        ShallowWaterSimulation&       FineDomain,
        std::uint32_t                   RimCells = 3u) noexcept;

    static void RestrictFineInteriorToCoarse(
        const ShallowWaterSimulation& FineDomain,
        ShallowWaterSimulation&       CoarseDomain,
        std::uint32_t                   InteriorMarginCells = 4u) noexcept;

    // Evaluates composite nested water/mud surface at WorldXY using 71ce888b's border cross-fade (zero seam!).
    [[nodiscard]] static SurfaceFluidSample SampleNestedCompositeSurface(
        const ShallowWaterSimulation& CoarseDomain,
        const ShallowWaterSimulation& FineDomain,
        std::array<float, 2>            WorldXY) noexcept;
};

} // namespace Frontier
