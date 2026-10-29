/*==========================================================================================================================================
                                                     PROPULSIONTHERMOCHEMISTRY.H
==========================================================================================================================================*/
// 🧩 Real-chemistry fuel species, multi-fuel mixtures, oxidizer/coolant additives (N2O, WMI, custom), and tank depletion dynamics.

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace Frontier::Propulsion
{

//------------------------------------------------------------------------------------------------------------------------
//                                              CHEMICAL FUEL SPECIES SPECIFICATION
//------------------------------------------------------------------------------------------------------------------------

enum class StandardFuelPreset : std::uint8_t
{
    PumpGasoline93        = 0,   // [-] E10 pump unleaded (RON 98 / AKI 93, LHV 42.4 MJ/kg, AFR 14.1)
    RaceGasolineC16       = 1,   // [-] Leaded/oxygenated race gas (RON 118, LHV 43.8 MJ/kg, AFR 14.6)
    EthanolE85            = 2,   // [-] 85% ethanol + 15% gasoline (RON 108, LHV 29.2 MJ/kg, AFR 9.76, high latent cooling)
    MethanolM100          = 3,   // [-] Pure CH3OH (RON 114, LHV 19.9 MJ/kg, AFR 6.45, extreme evaporative cooling)
    NitromethaneCh3No2    = 4,   // [-] CH3NO2 monopropellant/fuel (52.4% internal O2, LHV 11.3 MJ/kg, AFR 1.70!)
    HydrogenGasCompressed = 5,   // [-] H2 @ 700 bar (RON 130+, LHV 120.0 MJ/kg, AFR 34.3, ultra-fast flame speed)
    JetKeroseneJp8        = 6,   // [-] Heavy turbine/compression fuel (LHV 43.0 MJ/kg, AFR 14.7)
    SyntheticElectroFuel  = 7    // [-] Game-authored high-energy carbon-neutral e-fuel (RON 112, LHV 45.6 MJ/kg)
};

struct FuelSpeciesSpecification
{
    std::string Name                          = "PumpGasoline93"; // [-]       identifier for UI / TOML authoring
    double      DensityKgPerLitre             = 0.748;            // [kg/L]    liquid/compressed storage density
    double      LowerHeatingEnthalpyMjPerKg   = 42.40;            // [MJ/kg]   net chemical heat release per kg fuel
    double      StoichiometricAirFuelRatio    = 14.12;            // [kg_a/kg_f] dry air mass per unit fuel mass at lambda = 1
    double      ResearchOctaneNumber          = 98.0;             // [RON]     auto-ignition knock resistance index
    double      MotorOctaneNumber             = 90.0;             // [MON]     high-load thermal knock resistance index
    double      LatentHeatVaporizationKjPerKg = 380.0;            // [kJ/kg]   intake air cooling enthalpy upon port/DI evaporation
    double      OxygenMassFraction            = 0.035;            // [-]       intramolecular oxygen mass share [0..1)
    double      LaminarFlameSpeedMps          = 0.42;             // [m/s]     burn rate scaling thermal efficiency at high RPM
    double      AdiabaticFlameKelvin          = 2265.0;           // [K]       stoichiometric constant-pressure flame temperature
};

[[nodiscard]] FuelSpeciesSpecification ConstructPresetFuelSpecies(StandardFuelPreset Preset);
[[nodiscard]] bool ValidateFuelSpecies(const FuelSpeciesSpecification& Species) noexcept;

//------------------------------------------------------------------------------------------------------------------------
//                                        FUEL MIXTURE (MULTI-COMPONENT BLEND CHEMISTRY)
//------------------------------------------------------------------------------------------------------------------------

struct FuelComponentShare
{
    FuelSpeciesSpecification Species{};
    double                   VolumeFraction = 1.0; // [-] volumetric tank proportion (> 0, normalized on blend)
};

struct BlendedFuelProperties
{
    double DensityKgPerLitre             = 0.748;   // [kg/L]      volumetric weighted density
    double LowerHeatingEnthalpyMjPerKg   = 42.40;   // [MJ/kg]     mass-fraction weighted LHV
    double VolumetricEnergyMjPerLitre    = 31.72;   // [MJ/L]      rho * LHV
    double StoichiometricAirFuelRatio    = 14.12;   // [kg_a/kg_f] mass-fraction weighted O2 demand
    double EffectiveAntiKnockIndex       = 94.0;    // [(R+M)/2]   including synergistic alcohol/aromatics blending boost
    double LatentHeatVaporizationKjPerKg = 380.0;   // [kJ/kg]     mass-weighted evaporative cooling enthalpy
    double OxygenMassFraction            = 0.035;   // [-]         mass-weighted fuel-borne oxygen
    double LaminarFlameSpeedMps          = 0.42;    // [m/s]       Le Chatelier-style blended flame speed
    double SpecificStoichiometricEnergy  = 3.003;   // [MJ/kg_air] LHV / AFR_stoich — true cylinder torque potential per kg air!
};

[[nodiscard]] BlendedFuelProperties EvaluateFuelMixtureChemistry(const std::vector<FuelComponentShare>& Components);

//------------------------------------------------------------------------------------------------------------------------
//                                  ADDITIVES & DIRECT OXIDIZER / CHARGE-COOLING INJECTION
//------------------------------------------------------------------------------------------------------------------------

enum class AdditiveCategory : std::uint8_t
{
    OxidizerGas          = 0,   // [-] e.g., Nitrous Oxide (N2O) or custom hyper-peroxide oxidizer
    ChargeCoolant        = 1,   // [-] e.g., 50/50 Water-Methanol Injection (WMI) or Cryo-CO2 intercooler spray
    OctaneCatalyst       = 2,   // [-] e.g., Toluene / MMT / Ferrocene anti-knock in-tank additive
    CombustionAccelerator= 3    // [-] game-authorable flame-speed / thermal-efficiency catalyst
};

struct AdditiveSpecification
{
    std::string      Name                          = "NitrousOxideWetShot";
    AdditiveCategory Category                      = AdditiveCategory::OxidizerGas;
    double           MassFlowRateKgPerSec          = 0.065;   // [kg/s]  injected mass flow while active (~100 hp shot = 0.065 kg/s N2O)
    double           ReleasedOxygenMassFraction    = 0.3636;  // [-]     2 N2O -> 2 N2 + O2 releases 32 / 88.02 = 36.36% pure O2!
    double           DecompositionHeatKjPerKg      = 1860.0;  // [kJ/kg] exothermic N2O bond cleavage (+82 kJ/mol = +1,863 kJ/kg!)
    double           VaporizationCoolingKjPerKg    = 376.0;   // [kJ/kg] liquid N2O -> gas phase change cooling
    double           SupplementalFuelRatio         = 0.112;   // [kg_f/kg_add] wet-shot enrichment fuel mass per kg additive (0 = dry shot)
    double           AntiKnockBonusIndex           = 0.0;     // [AKI]   octane delta (positive for WMI/MMT, negative if harsh oxidizer)
    double           FlameSpeedMultiplier          = 1.18;    // [-]     burn-rate multiplier
    double           BottleCapacityKg              = 4.54;    // [kg]    standard 10-lb bottle = 4.54 kg
};

[[nodiscard]] AdditiveSpecification ConstructNitrousWetShot(double NominalShotHorsepower = 125.0);
[[nodiscard]] AdditiveSpecification ConstructNitrousDryShot(double NominalShotHorsepower = 75.0);
[[nodiscard]] AdditiveSpecification ConstructWaterMethanolInjection(double FlowKgPerSec = 0.018);
[[nodiscard]] AdditiveSpecification ConstructOctaneBoosterAdditive(double AkiBoost = 6.5);

//------------------------------------------------------------------------------------------------------------------------
//                                  COMBUSTION CHARGE & TANK RUNTIME EVALUATION
//------------------------------------------------------------------------------------------------------------------------

struct CombustionOperatingConditions
{
    double BaseAirMassFlowKgPerSec = 0.24;     // [kg/s] aspirated + turbo/supercharger air mass flow into manifold
    double ManifoldBoostBar        = 0.85;     // [Bar]  gauge boost pressure above 1.013 bar ambient
    double AmbientAirKelvin        = 298.15;   // [K]    ambient intake temperature
    double CompressionRatio        = 9.5;      // [-]    geometric cylinder compression ratio
    double EngineRpm               = 5500.0;   // [rpm]  crankshaft speed
    double CommandedLambda         = 0.88;     // [-]    target equivalence air/fuel ratio (0.85..0.90 = power rich)
    bool   AdditiveTriggered       = false;    // [-]    driver N2O / WMI button active + WOT gate
};

struct CombustionChargeResult
{
    double EffectiveTorqueMultiplier = 1.0;    // [-]   net torque multiplier vs baseline PumpGasoline93 without knock
    double IntakeChargeKelvin        = 298.15; // [K]   post-intercooler + fuel/additive evaporative charge temperature
    double ChargeDensityGain         = 1.0;    // [-]   T_ref / T_charge volumetric density bonus
    double RequiredOctaneAki         = 91.0;   // [AKI] knock requirement from CR + boost + intake temperature
    double AvailableOctaneAki        = 94.0;   // [AKI] mixture + additive effective anti-knock index
    double KnockRetardPenalty        = 1.0;    // [-]   [0.55..1.0] spark-retard / detonation power loss when AKI < required
    double ActualLambda              = 0.88;   // [-]   resulting lambda (detects lean-out on dry N2O without fuel headroom!)
    double FuelConsumptionKgPerSec   = 0.0;    // [kg/s] total tank fuel draw
    double AdditiveConsumptionKgPerS = 0.0;    // [kg/s] bottle draw
    double ThermalEfficiency         = 0.34;   // [-]   indicated -> brake thermodynamic efficiency
};

class FuelAndAdditiveTankReservoir
{
public:
    explicit FuelAndAdditiveTankReservoir(double CapacityLitres = 74.0);

    void ConfigureSingleFuel(const FuelSpeciesSpecification& Species, double InitialLitres);
    void ConfigureMixture(const std::vector<FuelComponentShare>& Mixture, double InitialLitres);
    void InstallAdditive(const AdditiveSpecification& Additive, double InitialBottleKg);

    CombustionChargeResult StepCombustion(const CombustionOperatingConditions& Conditions, double StepSeconds) noexcept;

    [[nodiscard]] const BlendedFuelProperties& MixtureProperties() const noexcept { return Mixture_; }
    [[nodiscard]] double RemainingFuelLitres() const noexcept                     { return RemainingFuelLitres_; }
    [[nodiscard]] double RemainingFuelMassKg() const noexcept                     { return RemainingFuelLitres_ * Mixture_.DensityKgPerLitre; }
    [[nodiscard]] double FuelLevelFraction() const noexcept;
    [[nodiscard]] double RemainingAdditiveKg() const noexcept                     { return RemainingAdditiveKg_; }
    [[nodiscard]] bool   FuelWarningActive() const noexcept                       { return FuelLevelFraction() <= WarningFraction_; }
    [[nodiscard]] bool   FuelCriticalActive() const noexcept                      { return FuelLevelFraction() <= CriticalFraction_; }
    [[nodiscard]] double EstimateRemainingSeconds(double ConsumptionKgPerSec) const noexcept;

private:
    BlendedFuelProperties Mixture_{};
    AdditiveSpecification Additive_{};
    bool                  AdditiveInstalled_   = false;
    double                TankCapacityLitres_  = 74.0;
    double                RemainingFuelLitres_ = 74.0;
    double                RemainingAdditiveKg_ = 0.0;
    double                WarningFraction_     = 0.15;
    double                CriticalFraction_    = 0.05;
};

} // namespace Frontier::Propulsion
