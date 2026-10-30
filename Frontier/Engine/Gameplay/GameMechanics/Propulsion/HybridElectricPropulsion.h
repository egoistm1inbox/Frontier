/*==========================================================================================================================================
                                                   HYBRIDELECTRICPROPULSION.H
==========================================================================================================================================*/
// 🧩 Forced induction (Turbocharger + Supercharger + Twincharged), Oil/Coolant circuits, Battery/Motor BEV, and Hybrid powertrains.

#pragma once

#include "Engine/Gameplay/GameMechanics/Propulsion/PropulsionThermochemistry.h"

#include <array>
#include <cstdint>
#include <utility>
#include <vector>

namespace Frontier::Propulsion
{

//------------------------------------------------------------------------------------------------------------------------
//                                  FORCED INDUCTION (TURBOCHARGER / SUPERCHARGER / TWINCHARGED)
//------------------------------------------------------------------------------------------------------------------------

enum class AspirationArchitecture : std::uint8_t
{
    NaturallyAspirated = 0,
    Turbocharged       = 1,
    Supercharged       = 2,
    Twincharged        = 3
};

enum class SuperchargerCompressorGeometry : std::uint8_t
{
    RootsPositiveDisplacement     = 0,  // [-] flat boost from low RPM, ~62% adiabatic efficiency
    TwinScrewInternalCompression  = 1,  // [-] flat boost with internal compression, ~74% adiabatic efficiency
    CentrifugalImpeller           = 2   // [-] boost rises quadratically with crank speed, ~78% adiabatic efficiency
};

struct ForcedInductionSpecification
{
    AspirationArchitecture         Architecture              = AspirationArchitecture::Turbocharged;
    SuperchargerCompressorGeometry SuperchargerGeometry      = SuperchargerCompressorGeometry::TwinScrewInternalCompression;

    // Turbocharger parameters (aligned with GRIT TurbochargerSpecifications.h)
    double TurboShaftInertiaKgM2        = 4.0e-5; // [kg*m^2] rotating assembly moment of inertia
    double MaxTurboShaftRpm             = 180000.0;
    double IdleTurboShaftRpm            = 18000.0;
    double BaseWastegateBoostBar        = 1.20;   // [Bar]    93-AKI pump-tune boost ceiling
    double RaceOctaneWastegateBoostBar  = 1.60;   // [Bar]    unlocked automatically when fuel AKI >= 100!
    double CompressorChokeFlowKgPerSec  = 0.78;   // [kg/s]   twin-turbo GT3 choke limit on compressor map (~103 lb/min)
    double CompressorSurgeMarginRatio   = 0.08;   // [kg/s]   low-flow high-PR surge boundary slope
    bool   AntiLagEquipped              = false;  // [-]      retards/enriches off-throttle to hold turbine speed

    // Supercharger parameters (aligned with GRIT SuperchargerSpecifications.h)
    double SuperchargerPulleyRatio      = 2.35;   // [-]      compressor / crankshaft speed ratio
    double SuperchargerDisplacementLitre= 2.40;   // [L/rev]  swept volume per compressor revolution
    double SuperchargerPeakBoostBar     = 1.05;   // [Bar]    bypass-valve regulated boost target
};

struct ForcedInductionTelemetry
{
    double ManifoldGaugeBoostBar        = 0.0;    // [Bar]    net manifold gauge boost above ambient
    double TurboBoostContributionBar    = 0.0;    // [Bar]    exhaust-driven turbo boost component
    double SuperchargerBoostBar         = 0.0;    // [Bar]    belt-driven supercharger boost component
    double TurboShaftRpm                = 0.0;    // [rpm]    turbine/compressor shaft speed
    double AspiratedAirMassFlowKgPerSec = 0.0;    // [kg/s]   total air mass flow entering cylinders
    double ParasiticCrankTorqueNm       = 0.0;    // [N*m]    mechanical belt drag subtracted from crankshaft
    double CompressorAdiabaticEfficiency= 0.74;   // [-]      operating-point compressor efficiency
    bool   CompressorSurgeDetected      = false;  // [-]      true during throttle-snap surge flutter
    bool   CompressorChokeReached       = false;  // [-]      true when mass flow approaches sonic choke
    bool   RaceBoostMapActive           = false;  // [-]      true when high-octane fuel unlocks high boost target
};

class ForcedInductionAssembly
{
public:
    explicit ForcedInductionAssembly(const ForcedInductionSpecification& Spec = {});

    ForcedInductionTelemetry StepInduction(
        double EngineRpm,
        double MaxEngineRpm,
        double DisplacementLitres,
        double ThrottlePosition,
        double AmbientPressureBar,
        double AmbientAirKelvin,
        double AvailableFuelOctaneAki,
        double StepSeconds) noexcept;

    void Reset() noexcept;
    [[nodiscard]] const ForcedInductionSpecification& Specification() const noexcept { return Spec_; }

private:
    ForcedInductionSpecification Spec_{};
    double                       TurboShaftRpm_       = 18000.0;
    double                       PlenumBoostBar_      = 0.0;
    double                       PreviousThrottle_    = 0.0;
};

//------------------------------------------------------------------------------------------------------------------------
//                                    ENGINE OIL (5W-40) & COOLANT THERMOSTAT CIRCUITS
//------------------------------------------------------------------------------------------------------------------------

struct ThermalLubricationSpecification
{
    double OilVolumeLitres              = 6.5;    // [L]   GRIT 5W-40 dry/wet sump volume
    double OilViscosity40C_cSt          = 90.0;   // [cSt] kinematic viscosity at 40 C
    double OilViscosity100C_cSt         = 14.0;   // [cSt] kinematic viscosity at 100 C
    double OilReliefPressureKpa         = 700.0;  // [kPa] oil pump pressure relief valve cap
    double OilDegradationOnsetKelvin    = 403.15; // [K]   130 C thermal breakdown onset
    double OilCriticalDamageKelvin      = 423.15; // [K]   150 C severe bearing film risk

    double CoolantVolumeLitres          = 8.5;    // [L]   50/50 water-glycol circuit capacity
    double ThermostatStartOpenKelvin    = 358.15; // [K]   85 C wax thermostat crack-open
    double ThermostatFullOpenKelvin     = 368.15; // [K]   95 C full radiator bypass open
    double PressurizedBoilingKelvin     = 398.15; // [K]   125 C @ 1.4 bar radiator cap
};

struct ThermalLubricationTelemetry
{
    double CoolantKelvin                = 363.15; // [K]   jacket coolant temperature
    double EngineOilKelvin              = 368.15; // [K]   sump oil temperature
    double OilKinematicViscosityCst     = 15.5;   // [cSt] instantaneous Walther-equation viscosity
    double OilGalleryPressureKpa        = 420.0;  // [kPa] main bearing gallery pressure
    double ThermostatOpenFraction       = 0.50;   // [-]   [0..1] radiator flow valve position
    double ViscousFrictionTorqueLossNm  = 0.0;    // [N*m] cold-oil churning drag penalty
    double ThermalProtectionDerate      = 1.0;    // [-]   [0.35..1.0] ECU overheat limp-mode torque cap
    bool   CoolantOverboiling           = false;
    bool   OilFilmCritical              = false;
};

class ThermalLubricationCircuit
{
public:
    explicit ThermalLubricationCircuit(
        const ThermalLubricationSpecification& Spec = {},
        double InitialCoolantKelvin                 = 361.15,
        double InitialOilKelvin                     = 363.15);

    ThermalLubricationTelemetry StepThermalCircuit(
        double CombustionRejectPowerKw,
        double EngineRpm,
        double VehicleAirspeedMps,
        double AmbientAirKelvin,
        double StepSeconds) noexcept;

private:
    ThermalLubricationSpecification Spec_{};
    double                          CoolantKelvin_ = 361.15;
    double                          OilKelvin_     = 363.15;
};

//------------------------------------------------------------------------------------------------------------------------
//                              TRACTION BATTERY PACK (LI-ION / LI-POLYMER / SOLID-STATE)
//------------------------------------------------------------------------------------------------------------------------

enum class BatteryCellChemistry : std::uint8_t
{
    LithiumIonNmc           = 0, // [-] GRIT 90 kWh / 400 V balanced energy/power pack
    LithiumPolymerHp        = 1, // [-] High C-rate motorsport hybrid buffer pack (800 V, ultra-low R_int)
    SolidElectrolyteLithium = 2  // [-] Next-gen 800 V solid-electrolyte pack (420 Wh/kg, high regen & thermal ceiling)
};

struct TractionBatterySpecification
{
    BatteryCellChemistry Chemistry              = BatteryCellChemistry::LithiumIonNmc;
    double               NominalEnergyKwh       = 90.0;    // [kWh]   usable energy capacity (3.24e8 J for 90 kWh)
    double               NominalPackVoltage     = 400.0;   // [V]     nominal bus voltage at 50% SoC
    double               MaxDischargePowerKw    = 400.0;   // [kW]    peak discharge power limit
    double               MaxRegenChargePowerKw  = 200.0;   // [kW]    peak regenerative charge limit
    double               InternalResistanceOhm  = 0.050;   // [Ohm]   pack series resistance at 25 C
    double               ThermalMassJoulesPerK  = 50000.0; // [J/K]   cell + cold-plate thermal capacitance
    double               ActiveChillerConductWK = 85.0;    // [W/K]   liquid cold-plate + passive cooling conductance
    double               DerateOnsetKelvin      = 325.15;  // [K]     52 C cell thermal derating threshold
    double               PackMassKg             = 480.0;   // [kg]    total pack structural + cell mass
};

[[nodiscard]] TractionBatterySpecification ConstructPresetBatteryPack(BatteryCellChemistry Chemistry);

struct TractionBatteryTelemetry
{
    double ChargeFraction               = 0.80;   // [-]   [0..1] State-of-Charge (SoC)
    double StoredEnergyMegajoules       = 259.2;  // [MJ]  remaining chemical energy
    double OpenCircuitVoltage           = 408.0;  // [V]   unloaded pack voltage
    double TerminalBusVoltage           = 400.0;  // [V]   loaded bus voltage (V_oc - I * R_int)
    double PackCurrentAmps              = 0.0;    // [A]   >0 discharging, <0 regenerative charging
    double ElectricalBusPowerKw         = 0.0;    // [kW]  net power delivered (>0) or absorbed (<0)
    double JouleHeatLossKw              = 0.0;    // [kW]  I^2 * R_int internal heating
    double CellTemperatureKelvin        = 298.15; // [K]   cell core temperature
    double AvailableDischargePowerKw    = 400.0;  // [kW]  instantaneous SoC & thermally gated discharge ceiling
    double AvailableRegenPowerKw        = 200.0;  // [kW]  instantaneous SoC & thermally gated charge ceiling
};

class TractionBatteryPack
{
public:
    explicit TractionBatteryPack(const TractionBatterySpecification& Spec = {}, double InitialChargeFraction = 0.80);

    TractionBatteryTelemetry StepElectricalLoad(
        double RequestedBusPowerKw,
        double AmbientAirKelvin,
        double StepSeconds) noexcept;

    [[nodiscard]] double AvailableDischargePowerKw() const noexcept;
    [[nodiscard]] double AvailableRegenPowerKw() const noexcept;
    [[nodiscard]] double ChargeFraction() const noexcept            { return ChargeFraction_; }
    [[nodiscard]] double CellTemperatureKelvin() const noexcept     { return CellKelvin_; }
    [[nodiscard]] const TractionBatterySpecification& Specification() const noexcept { return Spec_; }

private:
    [[nodiscard]] double ComputeOpenCircuitVoltage(double Soc) const noexcept;
    [[nodiscard]] double ComputeEffectiveResistanceOhm() const noexcept;

    TractionBatterySpecification Spec_{};
    double                       ChargeFraction_ = 0.80;
    double                       CellKelvin_     = 298.15;
};

//------------------------------------------------------------------------------------------------------------------------
//                                  ELECTRIC TRACTION MOTOR & INVERTER DRIVE UNIT
//------------------------------------------------------------------------------------------------------------------------

struct ElectricMotorSpecification
{
    double PeakDriveTorqueNm            = 600.0;   // [N*m]    0..BaseSpeedRpm constant-torque ceiling
    double PeakMechanicalPowerKw        = 320.0;   // [kW]     field-weakening constant-power ceiling
    double MaxRotorRpm                  = 16000.0; // [rpm]    mechanical rotor redline
    double BaseCornerRpm                = 5100.0;  // [rpm]    transition from constant torque to constant power
    double MaxRegenTorqueNm             = 400.0;   // [N*m]    regenerative braking torque limit
    double DriveEfficiency              = 0.93;    // [-]      inverter + PMSM motoring efficiency
    double RegenEfficiency              = 0.87;    // [-]      regenerative conversion efficiency
    double RotorInertiaKgM2             = 0.080;   // [kg*m^2] rotor polar moment of inertia
    double ReductionGearRatio           = 8.20;    // [-]      single-speed fixed reduction (1.0 if P2 shaft-mounted)
};

struct ElectricMotorTelemetry
{
    double RotorRpm                     = 0.0;     // [rpm]
    double OutputShaftTorqueNm          = 0.0;     // [N*m]    post-reduction axle/shaft torque (>0 drive, <0 regen)
    double MechanicalPowerKw            = 0.0;     // [kW]     shaft mechanical power
    double ElectricalBusLoadKw          = 0.0;     // [kW]     DC bus demand (>0 discharge, <0 regen return)
    double StatorTemperatureKelvin      = 305.15;  // [K]      winding thermal monitor
};

class ElectricDriveUnit
{
public:
    explicit ElectricDriveUnit(const ElectricMotorSpecification& Spec = {});

    [[nodiscard]] double MaxAvailableRotorTorqueNm(double RotorRpm, double AvailableBatteryKw) const noexcept;
    [[nodiscard]] double MaxAvailableRegenRotorTorqueNm(double RotorRpm, double AvailableBatteryRegenKw) const noexcept;

    ElectricMotorTelemetry EvaluateCommand(
        double OutputShaftAngularVelocityRadSec,
        double DriveDemandZeroToOne,
        double RegenDemandZeroToOne,
        double AvailableBatteryDischargeKw,
        double AvailableBatteryRegenKw,
        double AmbientAirKelvin,
        double StepSeconds) noexcept;

    [[nodiscard]] const ElectricMotorSpecification& Specification() const noexcept { return Spec_; }

private:
    ElectricMotorSpecification Spec_{};
    double                     StatorKelvin_ = 303.15;
};

//------------------------------------------------------------------------------------------------------------------------
//                          UNIFIED POWERTRAIN TOPOLOGY (ICE / BEV / P2 HYBRID / TTR E-AXLE HYBRID)
//------------------------------------------------------------------------------------------------------------------------

enum class PowertrainTopology : std::uint8_t
{
    InternalCombustionOnly          = 0,    // [-] Pure ICE (NA / Turbo / Supercharged / Twincharged)
    BatteryElectricRwd              = 1,    // [-] Single rear ElectricDriveUnit + TractionBatteryPack
    BatteryElectricDualMotorAwd     = 2,    // [-] Front + Rear ElectricDriveUnits + torque split + blended regen
    BatteryElectricQuadMotorVector  = 3,    // [-] 4 independent wheel motors with active yaw torque vectoring
    HybridParallelP2                = 4,    // [-] ICE + transmission-mounted P2 e-motor + high-rate battery
    HybridThroughTheRoadAwd         = 5     // [-] Rear Turbo/SC ICE + Front electric e-axle (hypercar TTR-AWD)
};

enum class HybridDeploymentStrategy : std::uint8_t
{
    ElectricOnlyStealth             = 0,    // [-] Zero fuel burn; pure electric propulsion up to battery limit
    BalancedEfficiency              = 1,    // [-] Blends e-assist for turbo-lag fill + harvests regen
    QualifyingMaxAttack             = 2,    // [-] Full ICE + full e-motor + optional N2O/additive deployment
    ChargeSustainRecovery           = 3     // [-] Uses surplus ICE load + aggressive regen to recharge battery
};

struct UnifiedPropulsionConfiguration
{
    PowertrainTopology              Topology            = PowertrainTopology::HybridThroughTheRoadAwd;
    HybridDeploymentStrategy        HybridStrategy      = HybridDeploymentStrategy::BalancedEfficiency;
    ForcedInductionSpecification    Induction{};
    ThermalLubricationSpecification Lubrication{};
    TractionBatterySpecification    Battery             = ConstructPresetBatteryPack(BatteryCellChemistry::LithiumPolymerHp);
    ElectricMotorSpecification      PrimaryElectric{};
    ElectricMotorSpecification      SecondaryElectric{};

    // ICE core parameters (used when Topology includes combustion)
    double DisplacementLitres       = 3.8;      // [L]
    double CompressionRatio         = 9.6;      // [-]
    double IdleEngineRpm            = 900.0;    // [rpm]
    double RedlineEngineRpm         = 7800.0;   // [rpm]
    double NaturallyAspiratedPeakNm = 430.0;    // [N*m] unboosted PumpGasoline93 sea-level reference peak torque
    double FinalGearboxMultiplier   = 9.2;      // [-]   combined transmission * final-drive ratio for ICE path
};

struct UnifiedPropulsionInputs
{
    double ThrottlePosition         = 0.0;      // [0..1]
    double BrakePosition            = 0.0;      // [0..1] blended regenerative + friction braking input
    bool   AdditiveButtonActive     = false;    // [-]    triggers N2O / WMI when WOT
    double SteeringNormalized       = 0.0;      // [-1..1] used for quad-motor yaw torque vectoring
    double FrontAxleOmegaRadSec     = 0.0;      // [rad/s] average front wheel angular velocity
    double RearAxleOmegaRadSec      = 0.0;      // [rad/s] average rear wheel angular velocity
    double ChassisForwardSpeedMps   = 0.0;      // [m/s]
    double AmbientAirKelvin         = 295.15;   // [K]
    double AmbientPressureBar       = 1.01325;  // [Bar]
};

struct UnifiedPropulsionOutput
{
    std::array<double, 4>        WheelDriveTorqueNm  = { 0.0, 0.0, 0.0, 0.0 }; // [FL, FR, RL, RR] net propulsion/regen torque!
    double                       TotalAxleDriveNm    = 0.0;
    double                       TotalRegenBrakeNm   = 0.0;
    double                       EngineRpm           = 0.0;
    double                       IceCrankshaftNm     = 0.0;
    ForcedInductionTelemetry     Induction{};
    CombustionChargeResult       Combustion{};
    ThermalLubricationTelemetry  Lubrication{};
    TractionBatteryTelemetry     Battery{};
    ElectricMotorTelemetry       PrimaryMotor{};
    ElectricMotorTelemetry       SecondaryMotor{};
};

class UnifiedPropulsionAssembly
{
public:
    explicit UnifiedPropulsionAssembly(
        const UnifiedPropulsionConfiguration& Config = {},
        double InitialFuelLitres                     = 65.0,
        double InitialBatterySoc                     = 0.80);

    FuelAndAdditiveTankReservoir&       FuelReservoir() noexcept             { return FuelTank_; }
    const FuelAndAdditiveTankReservoir& FuelReservoir() const noexcept       { return FuelTank_; }
    TractionBatteryPack&                BatteryPack() noexcept               { return Battery_; }
    const TractionBatteryPack&          BatteryPack() const noexcept         { return Battery_; }
    void AssignHybridStrategy(HybridDeploymentStrategy Strategy) noexcept    { Config_.HybridStrategy = Strategy; }

    UnifiedPropulsionOutput StepPropulsion(const UnifiedPropulsionInputs& Inputs, double StepSeconds) noexcept;

private:
    [[nodiscard]] double EvaluateBaseAspiratedTorqueCurve(double EngineRpm) const noexcept;

    UnifiedPropulsionConfiguration Config_{};
    FuelAndAdditiveTankReservoir   FuelTank_;
    ForcedInductionAssembly        Induction_;
    ThermalLubricationCircuit      Lubrication_;
    TractionBatteryPack            Battery_;
    ElectricDriveUnit              PrimaryMotor_;
    ElectricDriveUnit              SecondaryMotor_;
};

} // namespace Frontier::Propulsion
