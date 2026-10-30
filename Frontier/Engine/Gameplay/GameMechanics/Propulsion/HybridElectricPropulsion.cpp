/*==========================================================================================================================================
                                                  HYBRIDELECTRICPROPULSION.CPP
==========================================================================================================================================*/
// 🧩 Forced induction (Turbocharger + Supercharger + Twincharged), Oil/Coolant circuits, Battery/Motor BEV, and Hybrid powertrains.

#include "Engine/Gameplay/GameMechanics/Propulsion/HybridElectricPropulsion.h"

#include <algorithm>
#include <cmath>

namespace Frontier::Propulsion
{

namespace
{

constexpr double PiConstant       = 3.14159265358979323846;
constexpr double RpmToRadPerSec   = (2.0 * PiConstant) / 60.0;
constexpr double RadPerSecToRpm   = 60.0 / (2.0 * PiConstant);
constexpr double DryAirGasConst   = 287.058; // [J/(kg*K)]
constexpr double DryAirCp         = 1006.0;  // [J/(kg*K)]

double SmoothStep01(double Edge0, double Edge1, double X) noexcept
{
    if (Edge1 <= Edge0)
    {
        return (X >= Edge1) ? 1.0 : 0.0;
    }
    const double T = std::clamp((X - Edge0) / (Edge1 - Edge0), 0.0, 1.0);
    return T * T * (3.0 - 2.0 * T);
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                  FORCED INDUCTION (TURBOCHARGER / SUPERCHARGER / TWINCHARGED)
//------------------------------------------------------------------------------------------------------------------------

ForcedInductionAssembly::ForcedInductionAssembly(const ForcedInductionSpecification& Spec)
    : Spec_(Spec),
      TurboShaftRpm_(Spec.IdleTurboShaftRpm)
{
}

void ForcedInductionAssembly::Reset() noexcept
{
    TurboShaftRpm_    = Spec_.IdleTurboShaftRpm;
    PlenumBoostBar_   = 0.0;
    PreviousThrottle_ = 0.0;
}

ForcedInductionTelemetry ForcedInductionAssembly::StepInduction(
    double EngineRpm,
    double MaxEngineRpm,
    double DisplacementLitres,
    double ThrottlePosition,
    double AmbientPressureBar,
    double AmbientAirKelvin,
    double AvailableFuelOctaneAki,
    double StepSeconds) noexcept
{
    ForcedInductionTelemetry Out{};
    const double Dt       = std::clamp(StepSeconds, 1.0e-5, 0.25);
    const double Rpm      = std::clamp(EngineRpm, 500.0, std::max(1000.0, MaxEngineRpm));
    const double Throttle = std::clamp(ThrottlePosition, 0.0, 1.0);
    const double AmbPa    = std::max(40000.0, AmbientPressureBar * 100000.0);
    const double AmbK     = std::clamp(AmbientAirKelvin, 220.0, 350.0);
    const double AmbRho   = AmbPa / (DryAirGasConst * AmbK);

    // 4-stroke swept intake volumetric flow: (V_disp * RPM / 120) * VE * ThrottleFlow
    const double RpmNorm       = Rpm / std::max(1000.0, MaxEngineRpm);
    const double VolEfficiency = 0.78 + 0.20 * std::sin(PiConstant * std::clamp((RpmNorm - 0.12) / 0.78, 0.0, 1.0));
    const double ThrottleFlow  = 0.07 + 0.93 * std::pow(Throttle, 0.85);
    const double BaseMassFlow  = (DisplacementLitres * 1.0e-3) * (Rpm / 120.0) * AmbRho * VolEfficiency * ThrottleFlow;

    // Unlock GRIT RaceTuneOctane (1.60 bar vs 1.20 bar) when fuel/additive anti-knock index >= 100.0!
    Out.RaceBoostMapActive       = (AvailableFuelOctaneAki >= 100.0);
    const double WastegateTarget = Out.RaceBoostMapActive ? Spec_.RaceOctaneWastegateBoostBar : Spec_.BaseWastegateBoostBar;

    const bool IncludesSupercharger = (Spec_.Architecture == AspirationArchitecture::Supercharged ||
                                       Spec_.Architecture == AspirationArchitecture::Twincharged);
    const bool IncludesTurbocharger = (Spec_.Architecture == AspirationArchitecture::Turbocharged ||
                                       Spec_.Architecture == AspirationArchitecture::Twincharged);

    double ScBoostBar = 0.0;
    double ScEfficiency = 0.74;
    if (IncludesSupercharger)
    {
        const double CompRpm = Rpm * Spec_.SuperchargerPulleyRatio;
        switch (Spec_.SuperchargerGeometry)
        {
        case SuperchargerCompressorGeometry::RootsPositiveDisplacement:
            ScEfficiency = 0.62;
            ScBoostBar   = Spec_.SuperchargerPeakBoostBar * SmoothStep01(900.0, 2400.0, Rpm) * Throttle;
            break;
        case SuperchargerCompressorGeometry::TwinScrewInternalCompression:
            ScEfficiency = 0.74;
            ScBoostBar   = Spec_.SuperchargerPeakBoostBar * SmoothStep01(850.0, 2100.0, Rpm) * Throttle;
            break;
        case SuperchargerCompressorGeometry::CentrifugalImpeller:
        {
            ScEfficiency = 0.78;
            const double SpeedSq = std::pow(std::clamp(CompRpm / (MaxEngineRpm * Spec_.SuperchargerPulleyRatio), 0.0, 1.15), 2.0);
            ScBoostBar = Spec_.SuperchargerPeakBoostBar * SpeedSq * Throttle;
            break;
        }
        }
        // In Twincharged mode, electromagnetic clutch/bypass smoothly phases out supercharger once turbo spools above 4200 RPM!
        if (Spec_.Architecture == AspirationArchitecture::Twincharged)
        {
            ScBoostBar *= (1.0 - SmoothStep01(3600.0, 5200.0, Rpm));
        }
    }

    double TurboBoostBar = 0.0;
    if (IncludesTurbocharger)
    {
        // Exhaust enthalpy torque driving turbine vs compressor load torque over TurboShaftInertiaKgM2.
        const double ExhaustFlowProxy = BaseMassFlow * (1.0 + PlenumBoostBar_ / std::max(0.5, AmbientPressureBar));
        const double AlsFloor         = Spec_.AntiLagEquipped ? 0.62 : 0.0;
        const double EffectiveDrive   = std::max(Throttle, AlsFloor * SmoothStep01(2500.0, 4500.0, Rpm));
        const double TargetShaftRpm   = Spec_.IdleTurboShaftRpm +
            (Spec_.MaxTurboShaftRpm - Spec_.IdleTurboShaftRpm) *
            std::clamp(EffectiveDrive * SmoothStep01(1400.0, 3600.0, Rpm) * (0.55 + 0.65 * (ExhaustFlowProxy / 0.22)), 0.0, 1.0);

        // Angular acceleration inversely proportional to physical shaft inertia (4.0e-5 kg*m^2 standard vs large turbo lag).
        const double InertiaScale = 4.0e-5 / std::max(1.0e-6, Spec_.TurboShaftInertiaKgM2);
        const double SpoolRate    = ((TargetShaftRpm > TurboShaftRpm_) ? 4.2 : 2.6) * InertiaScale;
        TurboShaftRpm_ += (TargetShaftRpm - TurboShaftRpm_) * (1.0 - std::exp(-SpoolRate * Dt));
        TurboShaftRpm_  = std::clamp(TurboShaftRpm_, Spec_.IdleTurboShaftRpm, Spec_.MaxTurboShaftRpm);

        // GRIT BoostPressureCurve (20k..180k RPM -> quadratic compressor pressure rise) + wastegate clamp.
        const double NormShaft = std::clamp((TurboShaftRpm_ - 20000.0) / std::max(10000.0, Spec_.MaxTurboShaftRpm - 20000.0), 0.0, 1.0);
        const double RawTurbo  = 2.15 * NormShaft * NormShaft;

        // GRIT CompressorMap choke attenuation when mass flow approaches sonic throat limit.
        const double EstFlow = BaseMassFlow * (1.0 + RawTurbo / std::max(0.5, AmbientPressureBar));
        if (EstFlow >= 0.90 * Spec_.CompressorChokeFlowKgPerSec)
        {
            Out.CompressorChokeReached = (EstFlow >= Spec_.CompressorChokeFlowKgPerSec);
        }
        const double ChokeDerate = 1.0 - 0.55 * SmoothStep01(0.88 * Spec_.CompressorChokeFlowKgPerSec, 1.12 * Spec_.CompressorChokeFlowKgPerSec, EstFlow);
        TurboBoostBar = std::min(WastegateTarget, RawTurbo * ChokeDerate) * (0.12 + 0.88 * Throttle);

        // Detect throttle-snap compressor surge when plenum is pressurized and throttle snaps shut rapidly.
        const double ThrottleDropRate = (PreviousThrottle_ - Throttle) / Dt;
        if (PlenumBoostBar_ > 0.35 && Throttle < 0.18 && ThrottleDropRate > 1.5 && EstFlow < Spec_.CompressorSurgeMarginRatio)
        {
            Out.CompressorSurgeDetected = true;
        }
    }
    else
    {
        TurboShaftRpm_ = 0.0;
    }

    // Compound / parallel plenum pressure relaxation.
    double TargetPlenumBar = 0.0;
    if (Spec_.Architecture == AspirationArchitecture::Twincharged)
    {
        // Compounded sequential pressure ratio: PR_total = PR_sc * PR_turbo (clamped by wastegate).
        const double PrSc    = 1.0 + ScBoostBar / AmbientPressureBar;
        const double PrTurbo = 1.0 + TurboBoostBar / AmbientPressureBar;
        TargetPlenumBar      = std::min(WastegateTarget, AmbientPressureBar * (PrSc * PrTurbo - 1.0));
    }
    else
    {
        TargetPlenumBar = ScBoostBar + TurboBoostBar;
    }

    PlenumBoostBar_ += (TargetPlenumBar - PlenumBoostBar_) * (1.0 - std::exp(-18.0 * Dt));
    PlenumBoostBar_  = std::max(0.0, PlenumBoostBar_);
    PreviousThrottle_ = Throttle;

    // Total aspirated + boosted air mass flow & supercharger belt parasitic crank torque.
    const double TotalPressureRatio     = 1.0 + PlenumBoostBar_ / std::max(0.4, AmbientPressureBar);
    const double CompTempRatio          = 1.0 + (std::pow(TotalPressureRatio, 0.2857) - 1.0) / 0.72;
    const double IntercooledDensityGain = TotalPressureRatio / (1.0 + 0.32 * (CompTempRatio - 1.0));
    Out.AspiratedAirMassFlowKgPerSec    = BaseMassFlow * IntercooledDensityGain;

    if (IncludesSupercharger && ScBoostBar > 1.0e-4)
    {
        const double ScPr          = 1.0 + ScBoostBar / std::max(0.4, AmbientPressureBar);
        const double ScPowerWatts  = Out.AspiratedAirMassFlowKgPerSec * DryAirCp * AmbK * (std::pow(ScPr, 0.2857) - 1.0) / ScEfficiency;
        const double CrankOmega    = std::max(50.0, Rpm * RpmToRadPerSec);
        Out.ParasiticCrankTorqueNm = ScPowerWatts / CrankOmega;
    }

    Out.ManifoldGaugeBoostBar         = PlenumBoostBar_;
    Out.TurboBoostContributionBar     = TurboBoostBar;
    Out.SuperchargerBoostBar          = ScBoostBar;
    Out.TurboShaftRpm                 = TurboShaftRpm_;
    Out.CompressorAdiabaticEfficiency = IncludesSupercharger && !IncludesTurbocharger ? ScEfficiency : 0.73;
    return Out;
}

//------------------------------------------------------------------------------------------------------------------------
//                                    ENGINE OIL (5W-40) & COOLANT THERMOSTAT CIRCUITS
//------------------------------------------------------------------------------------------------------------------------

ThermalLubricationCircuit::ThermalLubricationCircuit(
    const ThermalLubricationSpecification& Spec,
    double InitialCoolantKelvin,
    double InitialOilKelvin)
    : Spec_(Spec),
      CoolantKelvin_(InitialCoolantKelvin),
      OilKelvin_(InitialOilKelvin)
{
}

ThermalLubricationTelemetry ThermalLubricationCircuit::StepThermalCircuit(
    double CombustionRejectPowerKw,
    double EngineRpm,
    double VehicleAirspeedMps,
    double AmbientAirKelvin,
    double StepSeconds) noexcept
{
    const double Dt      = std::clamp(StepSeconds, 0.0, 0.5);
    const double AmbK    = std::clamp(AmbientAirKelvin, 230.0, 340.0);
    const double HeatW   = std::max(0.0, CombustionRejectPowerKw) * 1000.0;
    const double RpmClmp = std::clamp(EngineRpm, 0.0, 12000.0);

    // 78% of rejected cylinder/friction heat enters water jacket; 22% + bearing shear enters 5W-40 oil sump.
    const double BearingShearW  = 180.0 * std::pow(RpmClmp / 3000.0, 1.85);
    const double JacketInputW   = 0.78 * HeatW;
    const double OilInputW      = 0.22 * HeatW + BearingShearW;

    // Wax-pellet thermostat opens smoothly between 85 C and 95 C.
    const double ThermoOpen = SmoothStep01(Spec_.ThermostatStartOpenKelvin, Spec_.ThermostatFullOpenKelvin, CoolantKelvin_);

    // Radiator airflow conductance (electric fan provides floor when stationary in burnout / traffic!).
    const double FanActive      = (CoolantKelvin_ >= Spec_.ThermostatFullOpenKelvin - 2.0) ? 14.0 : 3.5;
    const double EffAirspeed    = std::hypot(std::max(0.0, VehicleAirspeedMps), FanActive);
    const double BypassCondWK   = 18.0;
    const double RadiatorCondWK = BypassCondWK + ThermoOpen * (165.0 + 24.0 * std::sqrt(EffAirspeed));

    // Oil-to-coolant liquid heat exchanger + sump airflow cooling.
    const double OilExchangerWK = 95.0;
    const double SumpAirCondWK  = 14.0 + 2.5 * std::sqrt(EffAirspeed);
    const double ExchangerFluxW = OilExchangerWK * (OilKelvin_ - CoolantKelvin_);

    const double CoolantCapJK = std::max(2.0, Spec_.CoolantVolumeLitres) * 1.04 * 3650.0; // 50/50 water-glycol ~3.8 kJ/(L*K)
    const double OilCapJK     = std::max(2.0, Spec_.OilVolumeLitres) * 0.85 * 2050.0;     // synthetic oil ~1.74 kJ/(L*K)

    if (Dt > 0.0)
    {
        const double dCoolant = (JacketInputW + ExchangerFluxW - RadiatorCondWK * (CoolantKelvin_ - AmbK)) / CoolantCapJK;
        const double dOil     = (OilInputW - ExchangerFluxW - SumpAirCondWK * (OilKelvin_ - AmbK)) / OilCapJK;
        CoolantKelvin_ = std::clamp(CoolantKelvin_ + dCoolant * Dt, 230.0, 440.0);
        OilKelvin_     = std::clamp(OilKelvin_ + dOil * Dt, 230.0, 460.0);
    }

    // Walther ASTM D341 kinematic viscosity interpolation anchored at 40 C (313.15 K) and 100 C (373.15 K).
    const double T1 = 313.15;
    const double T2 = 373.15;
    const double Z1 = std::log10(std::log10(Spec_.OilViscosity40C_cSt + 0.7));
    const double Z2 = std::log10(std::log10(Spec_.OilViscosity100C_cSt + 0.7));
    const double BSlope = (Z1 - Z2) / (std::log10(T2) - std::log10(T1));
    const double AConst = Z1 + BSlope * std::log10(T1);
    const double ZCurr  = AConst - BSlope * std::log10(std::clamp(OilKelvin_, 255.0, 450.0));
    const double ViscCst = std::clamp(std::pow(10.0, std::pow(10.0, ZCurr)) - 0.7, 2.5, 2500.0);

    // Oil gallery pressure rises with RPM * sqrt(viscosity) up to 700 kPa relief valve.
    const double RawPressKpa = 95.0 + (RpmClmp / 1000.0) * 68.0 * std::sqrt(ViscCst / 14.0);
    const double GalleryKpa  = std::min(Spec_.OilReliefPressureKpa, RawPressKpa);

    // Cold thick oil (>25 cSt) causes hydrodynamic churning torque loss; overheating triggers ECU limp protection.
    const double ColdDragNm = (ViscCst > 22.0) ? std::min(28.0, 0.14 * (ViscCst - 22.0) * (0.4 + 0.6 * (RpmClmp / 4000.0))) : 0.0;
    const double CoolDerate = 1.0 - 0.60 * SmoothStep01(Spec_.PressurizedBoilingKelvin - 6.0, Spec_.PressurizedBoilingKelvin + 8.0, CoolantKelvin_);
    const double OilDerate  = 1.0 - 0.65 * SmoothStep01(Spec_.OilDegradationOnsetKelvin, Spec_.OilCriticalDamageKelvin, OilKelvin_);

    ThermalLubricationTelemetry Out{};
    Out.CoolantKelvin               = CoolantKelvin_;
    Out.EngineOilKelvin             = OilKelvin_;
    Out.OilKinematicViscosityCst    = ViscCst;
    Out.OilGalleryPressureKpa       = GalleryKpa;
    Out.ThermostatOpenFraction      = ThermoOpen;
    Out.ViscousFrictionTorqueLossNm = ColdDragNm;
    Out.ThermalProtectionDerate     = std::min(CoolDerate, OilDerate);
    Out.CoolantOverboiling          = (CoolantKelvin_ >= Spec_.PressurizedBoilingKelvin);
    Out.OilFilmCritical             = (OilKelvin_ >= Spec_.OilCriticalDamageKelvin || (RpmClmp > 1500.0 && GalleryKpa < 120.0));
    return Out;
}

//------------------------------------------------------------------------------------------------------------------------
//                              TRACTION BATTERY PACK (LI-ION / LI-POLYMER / SOLID-STATE)
//------------------------------------------------------------------------------------------------------------------------

TractionBatterySpecification ConstructPresetBatteryPack(BatteryCellChemistry Chemistry)
{
    TractionBatterySpecification B{};
    B.Chemistry = Chemistry;
    switch (Chemistry)
    {
    case BatteryCellChemistry::LithiumIonNmc:
        B.NominalEnergyKwh      = 90.0;    // Exact GRIT BatterySpecifications.h baseline!
        B.NominalPackVoltage    = 400.0;
        B.MaxDischargePowerKw   = 400.0;
        B.MaxRegenChargePowerKw = 200.0;
        B.InternalResistanceOhm = 0.050;
        B.ThermalMassJoulesPerK = 50000.0;
        B.ActiveChillerConductWK= 85.0;
        B.DerateOnsetKelvin     = 325.15;
        B.PackMassKg            = 485.0;
        break;

    case BatteryCellChemistry::LithiumPolymerHp:
        B.NominalEnergyKwh      = 9.2;     // Lightweight high-power hybrid buffer pack
        B.NominalPackVoltage    = 800.0;
        B.MaxDischargePowerKw   = 260.0;
        B.MaxRegenChargePowerKw = 220.0;
        B.InternalResistanceOhm = 0.026;
        B.ThermalMassJoulesPerK = 18000.0;
        B.ActiveChillerConductWK= 110.0;
        B.DerateOnsetKelvin     = 328.15;
        B.PackMassKg            = 62.0;
        break;

    case BatteryCellChemistry::SolidElectrolyteLithium:
        B.NominalEnergyKwh      = 112.0;
        B.NominalPackVoltage    = 800.0;
        B.MaxDischargePowerKw   = 680.0;
        B.MaxRegenChargePowerKw = 380.0;
        B.InternalResistanceOhm = 0.018;
        B.ThermalMassJoulesPerK = 58000.0;
        B.ActiveChillerConductWK= 125.0;
        B.DerateOnsetKelvin     = 343.15;  // Solid electrolyte tolerates 70 C before derate!
        B.PackMassKg            = 310.0;
        break;
    }
    return B;
}

TractionBatteryPack::TractionBatteryPack(const TractionBatterySpecification& Spec, double InitialChargeFraction)
    : Spec_(Spec),
      ChargeFraction_(std::clamp(InitialChargeFraction, 0.02, 1.0))
{
}

double TractionBatteryPack::ComputeOpenCircuitVoltage(double Soc) const noexcept
{
    const double S = std::clamp(Soc, 0.01, 1.0);
    // Realistic cell OCV curve: ~0.88 * V_nom near empty, 1.00 * V_nom @ 50%, ~1.09 * V_nom @ 100% SoC.
    const double NormVoltage = 0.90 + 0.14 * S + 0.05 * std::pow(S, 3.0) - 0.04 * std::exp(-18.0 * S);
    return Spec_.NominalPackVoltage * NormVoltage;
}

double TractionBatteryPack::ComputeEffectiveResistanceOhm() const noexcept
{
    // Cold cells (< 288 K) and nearly empty cells (< 15% SoC) exhibit elevated ionic resistance.
    const double ColdScale = (CellKelvin_ < 298.15) ? (1.0 + 0.032 * (298.15 - CellKelvin_)) : 1.0;
    const double SocScale  = 1.0 + 0.65 * std::exp(-14.0 * ChargeFraction_);
    return Spec_.InternalResistanceOhm * ColdScale * SocScale;
}

double TractionBatteryPack::AvailableDischargePowerKw() const noexcept
{
    const double SocEnvelope  = SmoothStep01(0.02, 0.14, ChargeFraction_);
    const double TempEnvelope = 1.0 - 0.75 * SmoothStep01(Spec_.DerateOnsetKelvin, Spec_.DerateOnsetKelvin + 18.0, CellKelvin_);
    return Spec_.MaxDischargePowerKw * SocEnvelope * TempEnvelope;
}

double TractionBatteryPack::AvailableRegenPowerKw() const noexcept
{
    // Taper regenerative charging smoothly above 88% SoC -> 0 kW at 99% SoC so cells never overvoltage!
    const double SocHeadroom  = 1.0 - SmoothStep01(0.88, 0.99, ChargeFraction_);
    const double ColdLimit    = SmoothStep01(263.15, 283.15, CellKelvin_); // Prevent lithium plating when freezing
    const double HotLimit     = 1.0 - 0.70 * SmoothStep01(Spec_.DerateOnsetKelvin, Spec_.DerateOnsetKelvin + 18.0, CellKelvin_);
    return Spec_.MaxRegenChargePowerKw * SocHeadroom * ColdLimit * HotLimit;
}

TractionBatteryTelemetry TractionBatteryPack::StepElectricalLoad(
    double RequestedBusPowerKw,
    double AmbientAirKelvin,
    double StepSeconds) noexcept
{
    const double Dt       = std::clamp(StepSeconds, 0.0, 0.5);
    const double MaxDisKw = AvailableDischargePowerKw();
    const double MaxRegKw = AvailableRegenPowerKw();
    const double BusKw    = std::clamp(RequestedBusPowerKw, -MaxRegKw, MaxDisKw);

    const double Voc      = ComputeOpenCircuitVoltage(ChargeFraction_);
    const double Rint     = ComputeEffectiveResistanceOhm();
    const double PowerW   = BusKw * 1000.0;

    // Solve quadratic P_bus = V_term * I = (V_oc - I * R_int) * I  =>  R_int * I^2 - V_oc * I + P_bus = 0.
    const double Discrim  = std::max(0.0, Voc * Voc - 4.0 * Rint * PowerW);
    const double CurrentA = (Rint > 1.0e-6) ? ((Voc - std::sqrt(Discrim)) / (2.0 * Rint)) : (PowerW / std::max(12.0, Voc));
    const double Vterm    = std::max(0.5 * Spec_.NominalPackVoltage, Voc - CurrentA * Rint);
    const double JouleW   = CurrentA * CurrentA * Rint;

    // Chemical power extracted from cells = Voc * I = P_bus + I^2 * R_int (losses always increase discharge / reduce charge!).
    const double ChemicalPowerW = Voc * CurrentA;
    const double CapacityJoules = std::max(1.0e5, Spec_.NominalEnergyKwh * 3.6e6);

    if (Dt > 0.0)
    {
        ChargeFraction_ = std::clamp(ChargeFraction_ - (ChemicalPowerW * Dt) / CapacityJoules, 0.0, 1.0);
        const double ChillerTargetK = std::clamp(AmbientAirKelvin, 288.15, 303.15); // Active thermal loop targets 15..30 C
        const double CoolingW       = Spec_.ActiveChillerConductWK * (CellKelvin_ - ChillerTargetK);
        CellKelvin_ = std::clamp(CellKelvin_ + ((JouleW - CoolingW) * Dt) / std::max(1000.0, Spec_.ThermalMassJoulesPerK), 240.0, 400.0);
    }

    TractionBatteryTelemetry Out{};
    Out.ChargeFraction            = ChargeFraction_;
    Out.StoredEnergyMegajoules    = (ChargeFraction_ * CapacityJoules) * 1.0e-6;
    Out.OpenCircuitVoltage        = Voc;
    Out.TerminalBusVoltage        = Vterm;
    Out.PackCurrentAmps           = CurrentA;
    Out.ElectricalBusPowerKw      = BusKw;
    Out.JouleHeatLossKw           = JouleW * 1.0e-3;
    Out.CellTemperatureKelvin     = CellKelvin_;
    Out.AvailableDischargePowerKw = AvailableDischargePowerKw();
    Out.AvailableRegenPowerKw     = AvailableRegenPowerKw();
    return Out;
}

//------------------------------------------------------------------------------------------------------------------------
//                                  ELECTRIC TRACTION MOTOR & INVERTER DRIVE UNIT
//------------------------------------------------------------------------------------------------------------------------

ElectricDriveUnit::ElectricDriveUnit(const ElectricMotorSpecification& Spec)
    : Spec_(Spec)
{
}

double ElectricDriveUnit::MaxAvailableRotorTorqueNm(double RotorRpm, double AvailableBatteryKw) const noexcept
{
    const double AbsRpm = std::abs(RotorRpm);
    if (AbsRpm >= Spec_.MaxRotorRpm)
    {
        return 0.0;
    }
    const double Omega = std::max(1.0, AbsRpm * RpmToRadPerSec);
    const double PowerCapKw = std::min(Spec_.PeakMechanicalPowerKw, AvailableBatteryKw * Spec_.DriveEfficiency);
    const double FieldWeakeningNm = (PowerCapKw * 1000.0) / Omega;
    const double RedlineTaper = 1.0 - SmoothStep01(0.93 * Spec_.MaxRotorRpm, Spec_.MaxRotorRpm, AbsRpm);
    return std::min(Spec_.PeakDriveTorqueNm, FieldWeakeningNm) * RedlineTaper;
}

double ElectricDriveUnit::MaxAvailableRegenRotorTorqueNm(double RotorRpm, double AvailableBatteryRegenKw) const noexcept
{
    const double AbsRpm = std::abs(RotorRpm);
    // Fade regenerative braking smoothly to zero below ~180 rotor RPM (~2-3 km/h) so vehicle settles cleanly at rest.
    const double LowSpeedFade = SmoothStep01(40.0, 220.0, AbsRpm);
    const double Omega        = std::max(1.0, AbsRpm * RpmToRadPerSec);
    const double MaxMechRegKw = AvailableBatteryRegenKw / std::max(0.5, Spec_.RegenEfficiency);
    const double PowerCapNm   = (MaxMechRegKw * 1000.0) / Omega;
    return std::min(Spec_.MaxRegenTorqueNm, PowerCapNm) * LowSpeedFade;
}

ElectricMotorTelemetry ElectricDriveUnit::EvaluateCommand(
    double OutputShaftAngularVelocityRadSec,
    double DriveDemandZeroToOne,
    double RegenDemandZeroToOne,
    double AvailableBatteryDischargeKw,
    double AvailableBatteryRegenKw,
    double AmbientAirKelvin,
    double StepSeconds) noexcept
{
    const double Gear     = std::max(0.5, Spec_.ReductionGearRatio);
    const double RotorOm  = OutputShaftAngularVelocityRadSec * Gear;
    const double RotorRpm = RotorOm * RadPerSecToRpm;

    const double ThermalDerate = 1.0 - 0.70 * SmoothStep01(413.15, 443.15, StatorKelvin_);
    const double MaxDriveNm    = MaxAvailableRotorTorqueNm(RotorRpm, AvailableBatteryDischargeKw) * ThermalDerate;
    const double MaxRegenNm    = MaxAvailableRegenRotorTorqueNm(RotorRpm, AvailableBatteryRegenKw) * ThermalDerate;

    const double DriveCmd = std::clamp(DriveDemandZeroToOne, 0.0, 1.0);
    const double RegenCmd = (DriveCmd > 0.05) ? 0.0 : std::clamp(RegenDemandZeroToOne, 0.0, 1.0);
    const double SignDir  = (RotorOm >= -0.5) ? 1.0 : -1.0;

    const double RotorTorqueNm = DriveCmd * MaxDriveNm - SignDir * RegenCmd * MaxRegenNm;
    const double MechPowerKw   = (RotorTorqueNm * RotorOm) * 1.0e-3;
    const double ElecPowerKw   = (MechPowerKw >= 0.0)
        ? (MechPowerKw / std::max(0.5, Spec_.DriveEfficiency))
        : (MechPowerKw * Spec_.RegenEfficiency);

    const double LossW = std::abs(ElecPowerKw - MechPowerKw) * 1000.0;
    const double Dt    = std::clamp(StepSeconds, 0.0, 0.5);
    if (Dt > 0.0)
    {
        StatorKelvin_ = std::clamp(StatorKelvin_ + ((LossW - 42.0 * (StatorKelvin_ - AmbientAirKelvin)) * Dt) / 14000.0, 240.0, 480.0);
    }

    ElectricMotorTelemetry Out{};
    Out.RotorRpm                = RotorRpm;
    Out.OutputShaftTorqueNm     = RotorTorqueNm * Gear;
    Out.MechanicalPowerKw       = MechPowerKw;
    Out.ElectricalBusLoadKw     = ElecPowerKw;
    Out.StatorTemperatureKelvin = StatorKelvin_;
    return Out;
}

//------------------------------------------------------------------------------------------------------------------------
//                          UNIFIED POWERTRAIN TOPOLOGY (ICE / BEV / P2 HYBRID / TTR E-AXLE HYBRID)
//------------------------------------------------------------------------------------------------------------------------

UnifiedPropulsionAssembly::UnifiedPropulsionAssembly(
    const UnifiedPropulsionConfiguration& Config,
    double InitialFuelLitres,
    double InitialBatterySoc)
    : Config_(Config),
      FuelTank_(74.0),
      Induction_(Config.Induction),
      Lubrication_(Config.Lubrication),
      Battery_(Config.Battery, InitialBatterySoc),
      PrimaryMotor_(Config.PrimaryElectric),
      SecondaryMotor_(Config.SecondaryElectric)
{
    FuelTank_.ConfigureSingleFuel(ConstructPresetFuelSpecies(StandardFuelPreset::PumpGasoline93), InitialFuelLitres);
}

double UnifiedPropulsionAssembly::EvaluateBaseAspiratedTorqueCurve(double EngineRpm) const noexcept
{
    const double Span = std::max(1000.0, Config_.RedlineEngineRpm - Config_.IdleEngineRpm);
    const double X    = std::clamp((EngineRpm - Config_.IdleEngineRpm) / Span, 0.0, 1.08);
    if (X >= 1.03)
    {
        return 0.0; // Soft/hard rev limiter fuel cut
    }
    // Broad realistic torque curve peaking near 62% of RPM band, tapering at redline.
    const double Shape = 0.68 + 0.32 * std::sin(PiConstant * std::pow(std::clamp(X / 0.96, 0.0, 1.0), 0.78));
    return Config_.NaturallyAspiratedPeakNm * Shape;
}

UnifiedPropulsionOutput UnifiedPropulsionAssembly::StepPropulsion(
    const UnifiedPropulsionInputs& Inputs,
    double                         StepSeconds) noexcept
{
    UnifiedPropulsionOutput Out{};
    const double Throttle = std::clamp(Inputs.ThrottlePosition, 0.0, 1.0);
    const double Brake    = std::clamp(Inputs.BrakePosition, 0.0, 1.0);
    const double OnePedalRegen = (Throttle < 0.04 && Brake < 0.02) ? 0.14 : 0.0;
    const double RegenDemand   = std::clamp(Brake * 0.85 + OnePedalRegen, 0.0, 1.0);

    const bool PureElectric =
        (Config_.Topology == PowertrainTopology::BatteryElectricRwd ||
         Config_.Topology == PowertrainTopology::BatteryElectricDualMotorAwd ||
         Config_.Topology == PowertrainTopology::BatteryElectricQuadMotorVector ||
         (Config_.Topology != PowertrainTopology::InternalCombustionOnly &&
          Config_.HybridStrategy == HybridDeploymentStrategy::ElectricOnlyStealth));

    const bool IncludesCombustion = !PureElectric;
    const bool IncludesElectric   = (Config_.Topology != PowertrainTopology::InternalCombustionOnly);

    // 1. Evaluate ICE + Forced Induction + Fuel/Mixture/Additive Chemistry + Oil/Coolant Circuits.
    double IceAxleTorqueNm = 0.0;
    if (IncludesCombustion)
    {
        const double RearRpm = std::abs(Inputs.RearAxleOmegaRadSec) * Config_.FinalGearboxMultiplier * RadPerSecToRpm;
        Out.EngineRpm        = std::clamp(std::max(Config_.IdleEngineRpm + 750.0 * Throttle, RearRpm), Config_.IdleEngineRpm, Config_.RedlineEngineRpm);

        const double AvailAki = FuelTank_.MixtureProperties().EffectiveAntiKnockIndex;
        Out.Induction = Induction_.StepInduction(
            Out.EngineRpm,
            Config_.RedlineEngineRpm,
            Config_.DisplacementLitres,
            Throttle,
            Inputs.AmbientPressureBar,
            Inputs.AmbientAirKelvin,
            AvailAki,
            StepSeconds);

        CombustionOperatingConditions CombCond{};
        CombCond.BaseAirMassFlowKgPerSec = Out.Induction.AspiratedAirMassFlowKgPerSec;
        CombCond.ManifoldBoostBar        = Out.Induction.ManifoldGaugeBoostBar;
        CombCond.AmbientAirKelvin        = Inputs.AmbientAirKelvin;
        CombCond.CompressionRatio        = Config_.CompressionRatio;
        CombCond.EngineRpm               = Out.EngineRpm;
        CombCond.CommandedLambda         = (Throttle > 0.72) ? 0.86 : 0.98;
        CombCond.AdditiveTriggered       = Inputs.AdditiveButtonActive && (Throttle > 0.80);

        Out.Combustion = FuelTank_.StepCombustion(CombCond, StepSeconds);

        const double BoostDensityRatio = 1.0 + Out.Induction.ManifoldGaugeBoostBar / std::max(0.5, Inputs.AmbientPressureBar);
        const double GrossIndicatedNm  = EvaluateBaseAspiratedTorqueCurve(Out.EngineRpm) *
                                         Throttle *
                                         BoostDensityRatio *
                                         Out.Combustion.EffectiveTorqueMultiplier;

        // Heat rejected to coolant & oil (~85% of brake power in modern water-cooled ICE).
        const double EstShaftKw = std::max(0.0, GrossIndicatedNm * (Out.EngineRpm * RpmToRadPerSec) * 1.0e-3);
        Out.Lubrication = Lubrication_.StepThermalCircuit(
            0.85 * EstShaftKw + 4.5,
            Out.EngineRpm,
            std::abs(Inputs.ChassisForwardSpeedMps),
            Inputs.AmbientAirKelvin,
            StepSeconds);

        const double EngineBrakingNm = (Throttle < 0.05 && RearRpm > Config_.IdleEngineRpm + 250.0)
            ? (-24.0 * (Out.EngineRpm / 3000.0))
            : 0.0;

        Out.IceCrankshaftNm = (GrossIndicatedNm - Out.Induction.ParasiticCrankTorqueNm - Out.Lubrication.ViscousFrictionTorqueLossNm) *
                              Out.Lubrication.ThermalProtectionDerate + EngineBrakingNm;
        IceAxleTorqueNm = Out.IceCrankshaftNm * Config_.FinalGearboxMultiplier * 0.92;
    }

    // 2. Evaluate Electric Drive Units & Battery Bus Load across BEV / Hybrid topologies.
    double BusPowerRequestKw = 0.0;
    const double AvailDisKw  = Battery_.AvailableDischargePowerKw();
    const double AvailRegKw  = Battery_.AvailableRegenPowerKw();

    switch (Config_.Topology)
    {
    case PowertrainTopology::InternalCombustionOnly:
        Out.WheelDriveTorqueNm = { 0.0, 0.0, 0.5 * IceAxleTorqueNm, 0.5 * IceAxleTorqueNm };
        break;

    case PowertrainTopology::BatteryElectricRwd:
        Out.PrimaryMotor = PrimaryMotor_.EvaluateCommand(
            Inputs.RearAxleOmegaRadSec, Throttle, RegenDemand, AvailDisKw, AvailRegKw, Inputs.AmbientAirKelvin, StepSeconds);
        BusPowerRequestKw = Out.PrimaryMotor.ElectricalBusLoadKw;
        Out.WheelDriveTorqueNm = { 0.0, 0.0, 0.5 * Out.PrimaryMotor.OutputShaftTorqueNm, 0.5 * Out.PrimaryMotor.OutputShaftTorqueNm };
        break;

    case PowertrainTopology::BatteryElectricDualMotorAwd:
        Out.PrimaryMotor = PrimaryMotor_.EvaluateCommand(
            Inputs.RearAxleOmegaRadSec, Throttle, RegenDemand * 0.45, 0.60 * AvailDisKw, 0.45 * AvailRegKw, Inputs.AmbientAirKelvin, StepSeconds);
        Out.SecondaryMotor = SecondaryMotor_.EvaluateCommand(
            Inputs.FrontAxleOmegaRadSec, Throttle * 0.85, RegenDemand * 0.55, 0.40 * AvailDisKw, 0.55 * AvailRegKw, Inputs.AmbientAirKelvin, StepSeconds);
        BusPowerRequestKw = Out.PrimaryMotor.ElectricalBusLoadKw + Out.SecondaryMotor.ElectricalBusLoadKw;
        Out.WheelDriveTorqueNm = {
            0.5 * Out.SecondaryMotor.OutputShaftTorqueNm,
            0.5 * Out.SecondaryMotor.OutputShaftTorqueNm,
            0.5 * Out.PrimaryMotor.OutputShaftTorqueNm,
            0.5 * Out.PrimaryMotor.OutputShaftTorqueNm
        };
        break;

    case PowertrainTopology::BatteryElectricQuadMotorVector:
    {
        Out.PrimaryMotor = PrimaryMotor_.EvaluateCommand(
            Inputs.RearAxleOmegaRadSec, Throttle, RegenDemand * 0.50, 0.55 * AvailDisKw, 0.50 * AvailRegKw, Inputs.AmbientAirKelvin, StepSeconds);
        Out.SecondaryMotor = SecondaryMotor_.EvaluateCommand(
            Inputs.FrontAxleOmegaRadSec, Throttle, RegenDemand * 0.50, 0.45 * AvailDisKw, 0.50 * AvailRegKw, Inputs.AmbientAirKelvin, StepSeconds);
        BusPowerRequestKw = Out.PrimaryMotor.ElectricalBusLoadKw + Out.SecondaryMotor.ElectricalBusLoadKw;

        // Active yaw torque vectoring shifts outer-wheel drive torque proportionally to steering angle!
        const double YawBias = std::clamp(Inputs.SteeringNormalized, -1.0, 1.0) * 0.28;
        const double FrontAxle = Out.SecondaryMotor.OutputShaftTorqueNm;
        const double RearAxle  = Out.PrimaryMotor.OutputShaftTorqueNm;
        Out.WheelDriveTorqueNm = {
            0.5 * FrontAxle * (1.0 + YawBias),
            0.5 * FrontAxle * (1.0 - YawBias),
            0.5 * RearAxle  * (1.0 + YawBias),
            0.5 * RearAxle  * (1.0 - YawBias)
        };
        break;
    }

    case PowertrainTopology::HybridParallelP2:
    case PowertrainTopology::HybridThroughTheRoadAwd:
    {
        double ElectricDriveScale = Throttle;
        double ElectricRegenScale = RegenDemand;
        if (Config_.HybridStrategy == HybridDeploymentStrategy::BalancedEfficiency)
        {
            // Fill low-RPM / turbo-lag torque hole aggressively, taper once turbo boost is fully online!
            const double LagFill = 1.0 - 0.55 * SmoothStep01(0.45, 1.15, Out.Induction.ManifoldGaugeBoostBar);
            ElectricDriveScale   = Throttle * LagFill;
        }
        else if (Config_.HybridStrategy == HybridDeploymentStrategy::ChargeSustainRecovery && Throttle > 0.15 && IceAxleTorqueNm > 400.0)
        {
            // Harvest ~15% of ICE shaft load to replenish battery while cruising!
            ElectricDriveScale = 0.0;
            ElectricRegenScale = 0.22;
        }

        const double MotorOmega = (Config_.Topology == PowertrainTopology::HybridThroughTheRoadAwd)
            ? Inputs.FrontAxleOmegaRadSec
            : Inputs.RearAxleOmegaRadSec;

        Out.PrimaryMotor = PrimaryMotor_.EvaluateCommand(
            MotorOmega, ElectricDriveScale, ElectricRegenScale, AvailDisKw, AvailRegKw, Inputs.AmbientAirKelvin, StepSeconds);
        BusPowerRequestKw = Out.PrimaryMotor.ElectricalBusLoadKw;

        if (Config_.Topology == PowertrainTopology::HybridThroughTheRoadAwd)
        {
            // Front electric e-axle + Rear ICE axle!
            Out.WheelDriveTorqueNm = {
                0.5 * Out.PrimaryMotor.OutputShaftTorqueNm,
                0.5 * Out.PrimaryMotor.OutputShaftTorqueNm,
                0.5 * IceAxleTorqueNm,
                0.5 * IceAxleTorqueNm
            };
        }
        else
        {
            const double CombinedRear = IceAxleTorqueNm + Out.PrimaryMotor.OutputShaftTorqueNm;
            Out.WheelDriveTorqueNm = { 0.0, 0.0, 0.5 * CombinedRear, 0.5 * CombinedRear };
        }
        break;
    }
    }

    if (IncludesElectric)
    {
        Out.Battery = Battery_.StepElectricalLoad(BusPowerRequestKw, Inputs.AmbientAirKelvin, StepSeconds);
    }

    for (double WheelNm : Out.WheelDriveTorqueNm)
    {
        if (WheelNm >= 0.0)
        {
            Out.TotalAxleDriveNm += WheelNm;
        }
        else
        {
            Out.TotalRegenBrakeNm += -WheelNm;
        }
    }

    return Out;
}

} // namespace Frontier::Propulsion
