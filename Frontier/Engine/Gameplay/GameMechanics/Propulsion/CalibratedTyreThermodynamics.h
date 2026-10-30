/*==========================================================================================================================================
                                                 CALIBRATEDTYRETHERMODYNAMICS.H
==========================================================================================================================================*/
// 🧩 Calibrated 3-node tyre thermodynamics, GRIT .tyrx compounds, rotational forced convection, radiation, pyrolysis, and aquaplaning.
//    Preserves legacy TyreThermalSolver.{h,cpp} untouched for historical TyreOracle parity while fixing premature burnout ignition.

#pragma once

#include <array>
#include <cstdint>
#include <string>

namespace Frontier::Propulsion
{

//------------------------------------------------------------------------------------------------------------------------
//                                        GRIT .TYRX COMPOUND PRESETS & SPECIFICATION
//------------------------------------------------------------------------------------------------------------------------

enum class GritTyreCompoundPreset : std::uint8_t
{
    Gt3SlickDry            = 0,  // [-] GRIT Tire_GT3_Slick_Dry.tyrx (185 kPa, h_conv=48, 3.0 mm slick, opt 85..105 C)
    Lmp3EnduranceSlick     = 1,  // [-] GRIT Tire_LMP3_Slick_Dry.tyrx (190 kPa, h_conv=50, endurance carcass)
    GtmSuperSticky200Tw    = 2,  // [-] GRIT Tire_GTM_Street_SuperSticky.tyrx (220 kPa, trackday semi-slick)
    StreetDriftSemiSlick   = 3,  // [-] GRIT Tire_Street_SemiSlick_Drifting.tyrx (250 kPa, thick drift tread block)
    RallyGravelSoft        = 4   // [-] GRIT Tire_Offroad_Rally_Dirt.tyrx (195 kPa, 11.5 mm deep lugs, high water evacuation)
};

struct CalibratedTyreCompoundSpec
{
    std::string Name                          = "Gt3SlickDry";
    double      OuterRadiusMetres             = 0.340;    // [m]       unloaded rolling radius
    double      TreadWidthMetres              = 0.305;    // [m]       contact belt width
    double      InitialTreadDepthMillimetres  = 3.0;      // [mm]      groove/tread thickness for wear & aquaplaning
    double      EnclosedGasVolumeM3           = 0.036;    // [m^3]     internal rim+carcass cavity volume
    double      ColdInflationGaugePa          = 185000.0; // [Pa]      cold gauge set-point (185 kPa GT3 slick)

    // Calibrated 3-node thermal capacities & conductances
    double      TreadBeltHeatCapacityJK       = 4200.0;   // [J/K]     ~2.2 kg active outer tread belt (legacy was 1800 J/K!)
    double      CarcassBulkHeatCapacityJK     = 15800.0;  // [J/K]     plies, sidewalls & innerliner
    double      TreadToCarcassConductanceWK   = 92.0;     // [W/K]     vulcanized belt-to-ply conduction (legacy was 28 W/K!)
    double      CarcassToGasConductanceWK     = 6.5;      // [W/K]     innerliner-to-cavity convection
    double      RoadContactConductanceWK      = 54.0;     // [W/K]     asphalt thermal sink across footprint
    double      StillAirNaturalConvectionWK   = 14.0;     // [W/K]     buoyant natural cooling at 0 m/s & 0 rad/s
    double      ForcedConvectionCoeffWM2K     = 48.0;     // [W/m^2/K] GRIT .tyrx boundary-layer forced convection @ ref speed
    double      InfraredEmissivity            = 0.94;     // [-]       carbon-black vulcanized rubber grey-body emissivity
    double      RubberSlidingHeatPartition    = 0.58;     // [-]       share of frictional slip power entering rubber vs road

    // Compound thermal grip envelope
    double      PeakLongitudinalMu            = 1.68;     // [-]       dry peak friction coefficient
    double      ColdGripFloor                 = 0.78;     // [-]       cold rubber glass-transition penalty multiplier
    double      OptimumWindowLowKelvin        = 355.15;   // [K]       82 C start of optimal viscoelastic grip window
    double      OptimumWindowHighKelvin       = 381.15;   // [K]       108 C end of optimal grip plateau
    double      BlisterFadeKelvin             = 493.15;   // [K]       220 C greased/blistered hot grip floor temperature
    double      HotBlisterGripFloor           = 0.56;     // [-]       hot overheated friction floor (reduces burnout slip power!)

    // Pyrolysis smoke, Archard abrasion, and Arrhenius auto-ignition kinetics
    double      SmokePyrolysisOnsetKelvin     = 433.15;   // [K]       160 C oil volatilization & white rubber smoke onset
    double      PyrolysisLatentEnthalpyJPerKg = 1.65e6;   // [J/kg]    endothermic heat carried away by vaporized rubber smoke
    double      AbrasionWearKgPerJoule        = 4.8e-8;   // [kg/J]    baseline Archard wear rate
    double      WearableTreadMassKg           = 2.35;     // [kg]      sacrificial tread rubber mass
    double      CombustibleCarcassMassKg      = 2.60;     // [kg]      rubber fuel mass once ignited
    double      AutoIgnitionThresholdKelvin   = 683.15;   // [K]       410 C SBR/BR rubber auto-ignition threshold
    double      RequiredIgnitionIntegralSec   = 13.5;     // [s]       Arrhenius exposure integral required to catch fire!
    double      ExtinctionThresholdKelvin     = 505.15;   // [K]       232 C flame quench threshold
    double      ActiveFlameBurnRateKgPerSec   = 0.0024;   // [kg/s]    sustained rubber combustion rate
    double      RubberCombustionEnthalpyJPerKg= 3.10e7;   // [J/kg]    exothermic heat release (90% to plume, 10% to tread)
};

[[nodiscard]] CalibratedTyreCompoundSpec ConstructGritTyreCompound(GritTyreCompoundPreset Preset);

//------------------------------------------------------------------------------------------------------------------------
//                                        PER-WHEEL BOUNDARY INPUTS & TELEMETRY
//------------------------------------------------------------------------------------------------------------------------

struct CalibratedTyreStepInput
{
    double RawFrictionalSlipPowerWatts = 0.0;     // [W]     unattenuated or current contact |Fx*Vsx| + |Fy*Vsy|
    bool   ApplyInternalThermalGripFade= false;   // [-]     true when caller has NOT already scaled F_slip by GripMultiplier
    double WheelAngularVelocityRadSec  = 0.0;     // [rad/s] wheel spin speed (drives peripheral forced convection |w*R|!)
    double ChassisAirspeedMps          = 0.0;     // [m/s]   translational airflow speed across wheel arch
    double NormalLoadNewtons           = 3800.0;  // [N]     vertical contact load (scales footprint road conduction)
    double EnclosedVolumeOverrideM3    = 0.0;     // [m^3]   <=0 uses compound nominal EnclosedGasVolumeM3
    double AmbientAirKelvin            = 293.15;  // [K]
    double RoadSurfaceKelvin           = 296.15;  // [K]
    double AtmosphericPressurePa       = 101325.0;// [Pa]
    double StandingWaterFilmMillimetres= 0.0;     // [mm]    road water film depth for NASA Horne aquaplaning
    bool   Grounded                    = true;    // [-]
};

struct CalibratedTyreWheelTelemetry
{
    double TreadSurfaceKelvin          = 293.15;  // [K]     circumferential outer belt temperature
    double ContactPatchFlashKelvin     = 293.15;  // [K]     Jaeger contact-patch flash skin temperature
    double CarcassBulkKelvin           = 293.15;  // [K]
    double EnclosedGasKelvin           = 293.15;  // [K]
    double GaugePressurePa             = 185000.0;// [Pa]
    double EffectiveBoundaryAirspeedMps= 0.0;     // [m/s]   sqrt(V_chassis^2 + (0.82 * |omega * R|)^2)
    double ForcedConvectionConductWK   = 14.0;    // [W/K]   instantaneous convective conductance to air
    double RadiativeCoolingWatts       = 0.0;     // [W]     Stefan-Boltzmann grey-body infrared loss
    double PyrolysisCoolingWatts       = 0.0;     // [W]     endothermic smoke vaporization cooling
    double SmokeVaporReleaseKgPerSec   = 0.0;     // [kg/s]  physical rubber vapor rate feeding PlumeFluid!
    double ThermalGripMultiplier       = 1.0;     // [-]     viscoelastic temperature * pressure grip factor
    double AquaplaningGripMultiplier   = 1.0;     // [-]     [0.08..1.0] wet hydroplaning lift attenuation
    double CombinedGripMultiplier      = 1.0;     // [-]     ThermalGripMultiplier * AquaplaningGripMultiplier
    double RemainingTreadMillimetres   = 3.0;     // [mm]
    double ArrheniusIgnitionIntegral   = 0.0;     // [s]     progress toward RequiredIgnitionIntegralSec
    double CombustionHeatReleaseWatts  = 0.0;     // [W]
    bool   EmittingPyrolysisSmoke      = false;   // [-]     true when T_surface >= SmokePyrolysisOnsetKelvin under slip
    bool   IgnitedOnFire               = false;   // [-]     true ONLY after sustained extreme burnout (>30 s)!
};

class CalibratedTyreThermodynamics
{
public:
    explicit CalibratedTyreThermodynamics(const CalibratedTyreCompoundSpec& Compound = ConstructGritTyreCompound(GritTyreCompoundPreset::Gt3SlickDry));

    void ResetCold(double AmbientKelvin = 293.15, double AtmosphericPa = 101325.0) noexcept;

    CalibratedTyreWheelTelemetry StepWheel(const CalibratedTyreStepInput& Input, double StepSeconds) noexcept;

    [[nodiscard]] const CalibratedTyreWheelTelemetry& LatestTelemetry() const noexcept { return Telemetry_; }
    [[nodiscard]] const CalibratedTyreCompoundSpec&   Compound() const noexcept        { return Spec_; }

private:
    CalibratedTyreCompoundSpec   Spec_{};
    CalibratedTyreWheelTelemetry Telemetry_{};
    double                       EnclosedAirMassKg_    = 0.0;
    double                       PreviousVolumeM3_     = 0.036;
    double                       RemainingTreadMassKg_ = 2.35;
    double                       RemainingFuelMassKg_  = 2.60;
};

} // namespace Frontier::Propulsion
