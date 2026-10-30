/*==========================================================================================================================================
                                                    PROPULSIONTHERMOCHEMISTRY.CPP
==========================================================================================================================================*/
// 🧩 Real-chemistry fuel species, multi-fuel mixtures, oxidizer/coolant additives (N2O, WMI, custom), and tank depletion dynamics.

#include "Engine/Gameplay/GameMechanics/Propulsion/PropulsionThermochemistry.h"

#include <algorithm>
#include <cmath>

namespace Frontier::Propulsion
{

namespace
{

constexpr double AtmosphericAirOxygenMassShare = 0.2314;         // [kg_O2 / kg_air] dry troposphere standard
constexpr double AirIsobaricHeatCapacityKjKgK  = 1.006;          // [kJ/(kg*K)] dry air Cp
constexpr double BaselineSpecificStoichEnergy  = 42.40 / 14.12;  // [MJ/kg_air] PumpGasoline93 reference (~3.0028 MJ/kg_air)

} // namespace

FuelSpeciesSpecification ConstructPresetFuelSpecies(StandardFuelPreset Preset)
{
    FuelSpeciesSpecification S{};
    switch (Preset)
    {
    case StandardFuelPreset::PumpGasoline93:
        S.Name                          = "PumpGasoline93";
        S.DensityKgPerLitre             = 0.748;
        S.LowerHeatingEnthalpyMjPerKg   = 42.40;
        S.StoichiometricAirFuelRatio    = 14.12;
        S.ResearchOctaneNumber          = 98.0;
        S.MotorOctaneNumber             = 88.0; // AKI = 93.0
        S.LatentHeatVaporizationKjPerKg = 380.0;
        S.OxygenMassFraction            = 0.035;
        S.LaminarFlameSpeedMps          = 0.42;
        S.AdiabaticFlameKelvin          = 2265.0;
        break;

    case StandardFuelPreset::RaceGasolineC16:
        S.Name                          = "RaceGasolineC16";
        S.DensityKgPerLitre             = 0.735;
        S.LowerHeatingEnthalpyMjPerKg   = 43.80;
        S.StoichiometricAirFuelRatio    = 14.60;
        S.ResearchOctaneNumber          = 120.0;
        S.MotorOctaneNumber             = 116.0; // AKI = 118.0
        S.LatentHeatVaporizationKjPerKg = 340.0;
        S.OxygenMassFraction            = 0.000;
        S.LaminarFlameSpeedMps          = 0.44;
        S.AdiabaticFlameKelvin          = 2290.0;
        break;

    case StandardFuelPreset::EthanolE85:
        S.Name                          = "EthanolE85";
        S.DensityKgPerLitre             = 0.781;
        S.LowerHeatingEnthalpyMjPerKg   = 29.20;
        S.StoichiometricAirFuelRatio    = 9.76;  // Specific energy = 2.992 MJ/kg_air + huge evaporative cooling!
        S.ResearchOctaneNumber          = 108.0;
        S.MotorOctaneNumber             = 92.0;
        S.LatentHeatVaporizationKjPerKg = 845.0;
        S.OxygenMassFraction            = 0.295;
        S.LaminarFlameSpeedMps          = 0.52;
        S.AdiabaticFlameKelvin          = 2195.0;
        break;

    case StandardFuelPreset::MethanolM100:
        S.Name                          = "MethanolM100";
        S.DensityKgPerLitre             = 0.792;
        S.LowerHeatingEnthalpyMjPerKg   = 19.93;
        S.StoichiometricAirFuelRatio    = 6.45;  // Specific energy = 3.090 MJ/kg_air + 1,100 kJ/kg latent cooling!
        S.ResearchOctaneNumber          = 114.0;
        S.MotorOctaneNumber             = 94.0;
        S.LatentHeatVaporizationKjPerKg = 1103.0;
        S.OxygenMassFraction            = 0.499;
        S.LaminarFlameSpeedMps          = 0.56;
        S.AdiabaticFlameKelvin          = 2143.0;
        break;

    case StandardFuelPreset::NitromethaneCh3No2:
        S.Name                          = "NitromethaneCH3NO2";
        S.DensityKgPerLitre             = 1.137;
        S.LowerHeatingEnthalpyMjPerKg   = 11.30;
        S.StoichiometricAirFuelRatio    = 1.70;  // 6.65 MJ/kg_air -> >2.2x cylinder energy per breath of air!
        S.ResearchOctaneNumber          = 110.0;
        S.MotorOctaneNumber             = 96.0;
        S.LatentHeatVaporizationKjPerKg = 561.0;
        S.OxygenMassFraction            = 0.524;
        S.LaminarFlameSpeedMps          = 0.68;
        S.AdiabaticFlameKelvin          = 2673.0;
        break;

    case StandardFuelPreset::HydrogenGasCompressed:
        S.Name                          = "HydrogenH2";
        S.DensityKgPerLitre             = 0.042; // 700 bar compressed tank density
        S.LowerHeatingEnthalpyMjPerKg   = 120.00;
        S.StoichiometricAirFuelRatio    = 34.30;
        S.ResearchOctaneNumber          = 130.0;
        S.MotorOctaneNumber             = 110.0;
        S.LatentHeatVaporizationKjPerKg = 0.0;   // gaseous injection
        S.OxygenMassFraction            = 0.0;
        S.LaminarFlameSpeedMps          = 2.10;
        S.AdiabaticFlameKelvin          = 2380.0;
        break;

    case StandardFuelPreset::JetKeroseneJp8:
        S.Name                          = "JetKeroseneJP8";
        S.DensityKgPerLitre             = 0.804;
        S.LowerHeatingEnthalpyMjPerKg   = 43.00;
        S.StoichiometricAirFuelRatio    = 14.70;
        S.ResearchOctaneNumber          = 55.0;
        S.MotorOctaneNumber             = 50.0;
        S.LatentHeatVaporizationKjPerKg = 251.0;
        S.OxygenMassFraction            = 0.0;
        S.LaminarFlameSpeedMps          = 0.38;
        S.AdiabaticFlameKelvin          = 2270.0;
        break;

    case StandardFuelPreset::SyntheticElectroFuel:
        S.Name                          = "SyntheticElectroFuel";
        S.DensityKgPerLitre             = 0.762;
        S.LowerHeatingEnthalpyMjPerKg   = 45.60;
        S.StoichiometricAirFuelRatio    = 14.25;
        S.ResearchOctaneNumber          = 114.0;
        S.MotorOctaneNumber             = 104.0;
        S.LatentHeatVaporizationKjPerKg = 460.0;
        S.OxygenMassFraction            = 0.080;
        S.LaminarFlameSpeedMps          = 0.58;
        S.AdiabaticFlameKelvin          = 2330.0;
        break;
    }
    return S;
}

bool ValidateFuelSpecies(const FuelSpeciesSpecification& Species) noexcept
{
    return std::isfinite(Species.DensityKgPerLitre) && Species.DensityKgPerLitre > 0.005 &&
           std::isfinite(Species.LowerHeatingEnthalpyMjPerKg) && Species.LowerHeatingEnthalpyMjPerKg > 1.0 &&
           std::isfinite(Species.StoichiometricAirFuelRatio) && Species.StoichiometricAirFuelRatio > 0.2 &&
           std::isfinite(Species.ResearchOctaneNumber) && Species.ResearchOctaneNumber >= 20.0 &&
           std::isfinite(Species.MotorOctaneNumber) && Species.MotorOctaneNumber >= 20.0 &&
           std::isfinite(Species.LatentHeatVaporizationKjPerKg) && Species.LatentHeatVaporizationKjPerKg >= 0.0 &&
           std::isfinite(Species.OxygenMassFraction) && Species.OxygenMassFraction >= 0.0 && Species.OxygenMassFraction < 0.90;
}

BlendedFuelProperties EvaluateFuelMixtureChemistry(const std::vector<FuelComponentShare>& Components)
{
    double TotalVol = 0.0;
    for (const FuelComponentShare& C : Components)
    {
        if (C.VolumeFraction > 0.0 && ValidateFuelSpecies(C.Species))
        {
            TotalVol += C.VolumeFraction;
        }
    }
    if (TotalVol <= 1.0e-9)
    {
        return EvaluateFuelMixtureChemistry({ { ConstructPresetFuelSpecies(StandardFuelPreset::PumpGasoline93), 1.0 } });
    }

    double DensitySum = 0.0;
    for (const FuelComponentShare& C : Components)
    {
        if (C.VolumeFraction > 0.0 && ValidateFuelSpecies(C.Species))
        {
            DensitySum += (C.VolumeFraction / TotalVol) * C.Species.DensityKgPerLitre;
        }
    }

    double LhvMass        = 0.0;
    double AfrMass        = 0.0;
    double LatentMass     = 0.0;
    double OxygenMass     = 0.0;
    double InvFlameSum    = 0.0;
    double LinearAkiVol   = 0.0;
    double AlcoholVolFrac = 0.0;

    for (const FuelComponentShare& C : Components)
    {
        if (C.VolumeFraction <= 0.0 || !ValidateFuelSpecies(C.Species))
        {
            continue;
        }
        const double VolWeight  = C.VolumeFraction / TotalVol;
        const double MassWeight = (VolWeight * C.Species.DensityKgPerLitre) / DensitySum;
        const double Aki        = 0.5 * (C.Species.ResearchOctaneNumber + C.Species.MotorOctaneNumber);

        LhvMass      += MassWeight * C.Species.LowerHeatingEnthalpyMjPerKg;
        AfrMass      += MassWeight * C.Species.StoichiometricAirFuelRatio;
        LatentMass   += MassWeight * C.Species.LatentHeatVaporizationKjPerKg;
        OxygenMass   += MassWeight * C.Species.OxygenMassFraction;
        InvFlameSum  += MassWeight / std::max(0.05, C.Species.LaminarFlameSpeedMps);
        LinearAkiVol += VolWeight  * Aki;

        if (C.Species.OxygenMassFraction > 0.20 && C.Species.LatentHeatVaporizationKjPerKg > 700.0)
        {
            AlcoholVolFrac += VolWeight;
        }
    }

    // Real-world oxygenated alcohol + hydrocarbon non-linear synergistic octane blending bonus (peaks around E30-E50).
    const double SynergyBonus = 4.5 * AlcoholVolFrac * (1.0 - AlcoholVolFrac);

    BlendedFuelProperties Out{};
    Out.DensityKgPerLitre             = DensitySum;
    Out.LowerHeatingEnthalpyMjPerKg   = LhvMass;
    Out.VolumetricEnergyMjPerLitre    = DensitySum * LhvMass;
    Out.StoichiometricAirFuelRatio    = std::max(0.5, AfrMass);
    Out.EffectiveAntiKnockIndex       = LinearAkiVol + SynergyBonus;
    Out.LatentHeatVaporizationKjPerKg = LatentMass;
    Out.OxygenMassFraction            = OxygenMass;
    Out.LaminarFlameSpeedMps          = 1.0 / std::max(1.0e-4, InvFlameSum);
    Out.SpecificStoichiometricEnergy  = Out.LowerHeatingEnthalpyMjPerKg / Out.StoichiometricAirFuelRatio;
    return Out;
}

AdditiveSpecification ConstructNitrousWetShot(double NominalShotHorsepower)
{
    // ~0.00058 kg/s liquid N2O per nominal wheel horsepower (~36.36% O2 + exothermic cleavage).
    const double ClampedHp = std::clamp(NominalShotHorsepower, 25.0, 500.0);
    AdditiveSpecification A{};
    A.Name                       = "NitrousOxideWetShot";
    A.Category                   = AdditiveCategory::OxidizerGas;
    A.MassFlowRateKgPerSec       = 0.00058 * ClampedHp;
    A.ReleasedOxygenMassFraction = 0.3636;
    A.DecompositionHeatKjPerKg   = 1863.0;
    A.VaporizationCoolingKjPerKg = 376.0;
    A.SupplementalFuelRatio      = 0.112; // Matched enrichment jet keeps lambda safe (~0.86)!
    A.AntiKnockBonusIndex        = -1.5;  // Higher cylinder peak pressure slightly raises octane demand
    A.FlameSpeedMultiplier       = 1.22;
    A.BottleCapacityKg           = 4.54;
    return A;
}

AdditiveSpecification ConstructNitrousDryShot(double NominalShotHorsepower)
{
    AdditiveSpecification A = ConstructNitrousWetShot(NominalShotHorsepower);
    A.Name                  = "NitrousOxideDryShot";
    A.SupplementalFuelRatio = 0.0; // Injects N2O without auxiliary fuel jet -> risks lean-out knock!
    return A;
}

AdditiveSpecification ConstructWaterMethanolInjection(double FlowKgPerSec)
{
    AdditiveSpecification A{};
    A.Name                       = "WaterMethanol50_50";
    A.Category                   = AdditiveCategory::ChargeCoolant;
    A.MassFlowRateKgPerSec       = std::clamp(FlowKgPerSec, 0.002, 0.080);
    A.ReleasedOxygenMassFraction = 0.0;
    A.DecompositionHeatKjPerKg   = 0.0;
    A.VaporizationCoolingKjPerKg = 1680.0; // 50% H2O (2257 kJ/kg) + 50% CH3OH (1103 kJ/kg)
    A.SupplementalFuelRatio      = 0.0;
    A.AntiKnockBonusIndex        = 11.0;   // Steam thermal ballast + methanol radical scavenging
    A.FlameSpeedMultiplier       = 1.03;
    A.BottleCapacityKg           = 6.00;
    return A;
}

AdditiveSpecification ConstructOctaneBoosterAdditive(double AkiBoost)
{
    AdditiveSpecification A{};
    A.Name                       = "TolueneMmtOctaneCatalyst";
    A.Category                   = AdditiveCategory::OctaneCatalyst;
    A.MassFlowRateKgPerSec       = 0.0005;
    A.ReleasedOxygenMassFraction = 0.0;
    A.DecompositionHeatKjPerKg   = 0.0;
    A.VaporizationCoolingKjPerKg = 0.0;
    A.SupplementalFuelRatio      = 0.0;
    A.AntiKnockBonusIndex        = std::clamp(AkiBoost, 0.0, 20.0);
    A.FlameSpeedMultiplier       = 1.00;
    A.BottleCapacityKg           = 1.00;
    return A;
}

//------------------------------------------------------------------------------------------------------------------------
//                                      FUEL & ADDITIVE TANK RESERVOIR DYNAMICS
//------------------------------------------------------------------------------------------------------------------------

FuelAndAdditiveTankReservoir::FuelAndAdditiveTankReservoir(double CapacityLitres)
    : TankCapacityLitres_(std::max(1.0, CapacityLitres)),
      RemainingFuelLitres_(std::max(1.0, CapacityLitres))
{
    ConfigureSingleFuel(ConstructPresetFuelSpecies(StandardFuelPreset::PumpGasoline93), CapacityLitres);
}

void FuelAndAdditiveTankReservoir::ConfigureSingleFuel(const FuelSpeciesSpecification& Species, double InitialLitres)
{
    ConfigureMixture({ { Species, 1.0 } }, InitialLitres);
}

void FuelAndAdditiveTankReservoir::ConfigureMixture(const std::vector<FuelComponentShare>& Mixture, double InitialLitres)
{
    Mixture_             = EvaluateFuelMixtureChemistry(Mixture);
    RemainingFuelLitres_ = std::clamp(InitialLitres, 0.0, TankCapacityLitres_);
}

void FuelAndAdditiveTankReservoir::InstallAdditive(const AdditiveSpecification& Additive, double InitialBottleKg)
{
    Additive_            = Additive;
    AdditiveInstalled_   = true;
    RemainingAdditiveKg_ = std::clamp(InitialBottleKg, 0.0, std::max(0.1, Additive.BottleCapacityKg));
}

double FuelAndAdditiveTankReservoir::FuelLevelFraction() const noexcept
{
    return (TankCapacityLitres_ > 0.0) ? std::clamp(RemainingFuelLitres_ / TankCapacityLitres_, 0.0, 1.0) : 0.0;
}

double FuelAndAdditiveTankReservoir::EstimateRemainingSeconds(double ConsumptionKgPerSec) const noexcept
{
    return (ConsumptionKgPerSec > 1.0e-7) ? (RemainingFuelMassKg() / ConsumptionKgPerSec) : 999999.0;
}

CombustionChargeResult FuelAndAdditiveTankReservoir::StepCombustion(
    const CombustionOperatingConditions& Conditions,
    double                               StepSeconds) noexcept
{
    CombustionChargeResult Out{};
    if (RemainingFuelLitres_ <= 1.0e-6 || Conditions.BaseAirMassFlowKgPerSec <= 1.0e-6)
    {
        Out.EffectiveTorqueMultiplier = 0.0;
        return Out;
    }

    const double Dt      = std::max(0.0, StepSeconds);
    const double BaseAir = Conditions.BaseAirMassFlowKgPerSec;
    const double Lambda0 = std::clamp(Conditions.CommandedLambda, 0.65, 1.35);

    // 1. Post-compressor + intercooler manifold temperature before fuel/additive latent cooling.
    const double PressureRatio = 1.0 + std::max(0.0, Conditions.ManifoldBoostBar) / 1.01325;
    const double CompTempRise  = Conditions.AmbientAirKelvin * (std::pow(PressureRatio, 0.2857) - 1.0) / 0.72;
    const double IntercooledK  = Conditions.AmbientAirKelvin + 0.32 * CompTempRise; // 68% intercooler effectiveness

    // 2. Active additive / N2O / WMI mass flow & extra oxygen liberation.
    double AddFlowKgS     = 0.0;
    double ExtraAirEqKgS  = 0.0;
    double AddCoolingKw   = 0.0;
    double AddExothermKw  = 0.0;
    double ExtraFuelKgS   = 0.0;
    double AkiBonus       = 0.0;
    double FlameSpeedGain = 1.0;

    if (AdditiveInstalled_ && Additive_.Category == AdditiveCategory::OctaneCatalyst && RemainingAdditiveKg_ > 1.0e-5)
    {
        AkiBonus = Additive_.AntiKnockBonusIndex;
    }

    if (AdditiveInstalled_ && Conditions.AdditiveTriggered && RemainingAdditiveKg_ > 1.0e-4)
    {
        AddFlowKgS     = std::min(Additive_.MassFlowRateKgPerSec, RemainingAdditiveKg_ / std::max(Dt, 1.0e-4));
        const double ReleasedO2KgS = AddFlowKgS * std::clamp(Additive_.ReleasedOxygenMassFraction, 0.0, 0.85);
        ExtraAirEqKgS  = ReleasedO2KgS / AtmosphericAirOxygenMassShare;
        AddCoolingKw   = AddFlowKgS * Additive_.VaporizationCoolingKjPerKg;
        AddExothermKw  = AddFlowKgS * Additive_.DecompositionHeatKjPerKg;
        ExtraFuelKgS   = AddFlowKgS * std::max(0.0, Additive_.SupplementalFuelRatio);
        AkiBonus      += Additive_.AntiKnockBonusIndex;
        FlameSpeedGain = std::max(0.5, Additive_.FlameSpeedMultiplier);
    }

    // 3. Fuel mass flow & evaporative intake charge cooling.
    const double BaseFuelKgS  = BaseAir / (Mixture_.StoichiometricAirFuelRatio * Lambda0);
    const double TotalFuelKgS = BaseFuelKgS + ExtraFuelKgS;
    const double FuelEvapKw   = TotalFuelKgS * Mixture_.LatentHeatVaporizationKjPerKg * 0.55; // 55% vaporizes in intake charge
    const double MixtureCpKwK = std::max(0.02, BaseAir + AddFlowKgS) * AirIsobaricHeatCapacityKjKgK;
    const double CoolingDropK = std::clamp((FuelEvapKw + AddCoolingKw) / MixtureCpKwK, 0.0, 52.0);

    Out.IntakeChargeKelvin = std::max(245.0, IntercooledK - CoolingDropK);
    Out.ChargeDensityGain  = std::clamp(Conditions.AmbientAirKelvin / Out.IntakeChargeKelvin, 0.88, 1.22);

    // 4. Resulting lambda (dry N2O without supplemental fuel leans the mixture out!).
    const double TotalEffectiveAir = BaseAir * Out.ChargeDensityGain + ExtraAirEqKgS;
    const double StoichFuelNeeded  = TotalEffectiveAir / Mixture_.StoichiometricAirFuelRatio;
    Out.ActualLambda               = (TotalFuelKgS > 1.0e-8) ? (StoichFuelNeeded / TotalFuelKgS) : 2.0;

    // 5. Knock / Octane requirement vs available AKI.
    const double CrTerm       = 82.0 + 3.4 * (Conditions.CompressionRatio - 9.0);
    const double BoostTerm    = 11.5 * std::max(0.0, Conditions.ManifoldBoostBar);
    const double TempTerm     = 0.14 * (Out.IntakeChargeKelvin - 298.15);
    const double LeanPenalty  = (Out.ActualLambda > 1.02) ? 18.0 * (Out.ActualLambda - 1.02) : 0.0;
    Out.RequiredOctaneAki     = CrTerm + BoostTerm + TempTerm + LeanPenalty;
    Out.AvailableOctaneAki    = Mixture_.EffectiveAntiKnockIndex + AkiBonus;

    const double OctaneDeficit = std::max(0.0, Out.RequiredOctaneAki - Out.AvailableOctaneAki);
    // ECU knock-sensor spark retard (~3.2% torque loss per AKI point deficit, severe detonation below 0.55).
    Out.KnockRetardPenalty = std::clamp(1.0 - 0.032 * OctaneDeficit, 0.52, 1.0);

    // 6. Combusting chemical power relative to baseline PumpGasoline93 aspirated charge.
    const double OxidizerLimitedFuel = std::min(TotalFuelKgS, StoichFuelNeeded / 0.82); // rich limit beyond lambda=0.82 leaves unburnt fuel
    const double ChemicalHeatMw      = OxidizerLimitedFuel * Mixture_.LowerHeatingEnthalpyMjPerKg + AddExothermKw * 1.0e-3;
    const double BaselineHeatMw      = (BaseAir / 0.88) * BaselineSpecificStoichEnergy;

    // High laminar flame speed (H2, CH3NO2, Methanol, N2O) improves constant-volume burn completeness at high RPM.
    const double EffectiveFlameMps = Mixture_.LaminarFlameSpeedMps * FlameSpeedGain;
    const double BurnFactor        = std::clamp(0.96 + 0.06 * std::tanh((EffectiveFlameMps - 0.42) * 1.4), 0.90, 1.06);
    Out.ThermalEfficiency          = std::clamp((1.0 - std::pow(1.0 / std::max(4.0, Conditions.CompressionRatio), 0.35)) * 0.68 * BurnFactor, 0.24, 0.46);

    const double RawRatio = (BaselineHeatMw > 1.0e-8) ? (ChemicalHeatMw / BaselineHeatMw) : 1.0;
    Out.EffectiveTorqueMultiplier = std::clamp(RawRatio * BurnFactor * Out.KnockRetardPenalty, 0.0, 3.6);
    Out.FuelConsumptionKgPerSec   = TotalFuelKgS;
    Out.AdditiveConsumptionKgPerS = AddFlowKgS;

    // 7. Deplete tank & bottle over StepSeconds.
    if (Dt > 0.0)
    {
        const double FuelLitresUsed = (TotalFuelKgS * Dt) / std::max(0.01, Mixture_.DensityKgPerLitre);
        RemainingFuelLitres_ = std::max(0.0, RemainingFuelLitres_ - FuelLitresUsed);
        if (AddFlowKgS > 0.0)
        {
            RemainingAdditiveKg_ = std::max(0.0, RemainingAdditiveKg_ - AddFlowKgS * Dt);
        }
    }

    return Out;
}

} // namespace Frontier::Propulsion
