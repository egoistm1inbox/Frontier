/*==========================================================================================================================================
                                                  ENGINESYSTEMSVALIDATION.CPP
==========================================================================================================================================*/
// 🧩 End-to-end physical, numerical & architectural verification across Plume/Smoke Fluid, Calibrated Tyre Ignition, Fuel/Mix/N2O Chemistry,
//    Turbo/Supercharger/BEV/Hybrid Propulsion, Cloud-Gated Budgeted Weather + Wind Force-Field, FP1 Networking, FrameGraph/TaskGraph & Audio.

#include "Engine/Audio/AudioFoundation.h"
#include "Engine/Networking/StateReplication.h"
#include "Engine/Physics/TyreThermalSolver.h"
#include "Engine/Gameplay/GameMechanics/Propulsion/CalibratedTyreThermodynamics.h"
#include "Engine/Gameplay/GameMechanics/Propulsion/HybridElectricPropulsion.h"
#include "Engine/Gameplay/GameMechanics/Propulsion/PropulsionThermochemistry.h"
#include "Engine/Rendering/FrameGraphExecution.h"
#include "Engine/Fluid/PlumeFluid.h"
#include "Engine/VisualEffects/WindField.h"
#include "Engine/Threading/TaskGraphExtension.h"

#include "Projects/Project-Drive/Source/DriveSimulation.h"
#include "TransportCodec.h" // Project-Networking wire codec parity check!

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <numeric>
#include <string>
#include <vector>

namespace
{

int TotalChecks  = 0;
int PassedChecks = 0;

void VerifyCondition(bool Condition, const char* Label, const std::string& Detail)
{
    ++TotalChecks;
    if (Condition)
    {
        ++PassedChecks;
        std::printf("ok %d - %s | %s\n", TotalChecks, Label, Detail.c_str());
    }
    else
    {
        std::printf("not ok %d - %s | %s\n", TotalChecks, Label, Detail.c_str());
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                  1. PLUME & SMOKE FLUID PHYSICS VERIFICATION
//------------------------------------------------------------------------------------------------------------------------

void VerifyPlumeAndSmokePhysics()
{
    using namespace Frontier;

    // 1A. Zero-dissipation scalar smoke mass conservation & non-negativity.
    PlumeFluidParameters MassParams{};
    MassParams.Grade            = PlumeQualityGrade::Medium;
    MassParams.Variant          = PlumeSolverVariant::ProductionUpgraded;
    MassParams.SmokeDissipation = 0.0f;
    MassParams.WindSpeed        = 0.5f;
    MassParams.Buoyancy         = 0.8f;

    PlumeFluid MassPlume(MassParams);
    const std::array<float, 3> SunDir = { 0.45f, -0.35f, 0.82f };
    MassPlume.AppendTransientPlumeSource({ 0.0f, 0.0f, 1.8f }, 0.85f, { 0.2f, 0.0f, 0.5f }, 40.0f, 12.0f, 0.0f, 0.0f);
    (void)MassPlume.AdvanceSimulation({ 0.0f, 0.0f, 0.0f }, SunDir, 1.0f / 60.0f);

    auto IntegrateSmokeMassAndMin = [](const PlumeFluid& Plume, double& OutMinVal, double& OutCentroidZ) -> double
    {
        const auto& Thermo = Plume.ThermoData();
        const auto  Ext    = Plume.ThermoExtent();
        const double CellM = 0.30; // Medium grade fine cell = 0.30 m
        const double CellV = CellM * CellM * CellM;
        double SumMass     = 0.0;
        double WeightedZ   = 0.0;
        OutMinVal          = 0.0;
        for (std::uint32_t Z = 0u; Z < Ext[2]; ++Z)
        {
            const double WorldZ = -0.50 + (static_cast<double>(Z) + 0.5) * CellM;
            for (std::uint32_t Y = 0u; Y < Ext[1]; ++Y)
            {
                for (std::uint32_t X = 0u; X < Ext[0]; ++X)
                {
                    const std::size_t Idx = ((static_cast<std::size_t>(Z) * Ext[1] + Y) * Ext[0] + X) * 4u;
                    const double Smoke    = Thermo[Idx + 0u];
                    OutMinVal             = std::min(OutMinVal, Smoke);
                    SumMass              += Smoke * CellV;
                    WeightedZ            += Smoke * CellV * WorldZ;
                }
            }
        }
        OutCentroidZ = (SumMass > 1.0e-9) ? (WeightedZ / SumMass) : 0.0;
        return SumMass;
    };

    double MinSmoke0 = 0.0, CentroidZ0 = 0.0;
    const double MassInitial = IntegrateSmokeMassAndMin(MassPlume, MinSmoke0, CentroidZ0);

    // Clear transient source so steps 2..25 evolve purely under zero-source MacCormack transport!
    MassPlume.IngestVehicleTelemetry({ 0.0f, 0.0f, 0.0f }, {}, 1.0f / 60.0f);

    double GlobalMinSmoke = MinSmoke0;
    for (int Step = 0; Step < 24; ++Step)
    {
        (void)MassPlume.AdvanceSimulation({ 0.0f, 0.0f, 0.0f }, SunDir, 1.0f / 60.0f);
        double StepMin = 0.0, DummyZ = 0.0;
        (void)IntegrateSmokeMassAndMin(MassPlume, StepMin, DummyZ);
        GlobalMinSmoke = std::min(GlobalMinSmoke, StepMin);
    }
    double MinSmokeEnd = 0.0, CentroidZEnd = 0.0;
    const double MassFinal     = IntegrateSmokeMassAndMin(MassPlume, MinSmokeEnd, CentroidZEnd);
    const double RetainedRatio = (MassInitial > 1.0e-9) ? (MassFinal / MassInitial) : 0.0;

    char Buf[256];
    std::snprintf(Buf, sizeof(Buf), "initial=%.5f, final=%.5f, retained=%.4f, min_scalar=%.6f",
                  MassInitial, MassFinal, RetainedRatio, GlobalMinSmoke);
    VerifyCondition(MassInitial > 0.01 && RetainedRatio >= 0.92 && RetainedRatio <= 1.05 && GlobalMinSmoke >= -1.0e-6,
                    "PlumeFluid zero-dissipation smoke mass conservation & positivity", Buf);

    // 1B. Archimedean thermal buoyancy: hot fire plume rises strongly vs cold heavy particulate smoke.
    PlumeFluidParameters BuoyParams = MassParams;
    BuoyParams.Buoyancy        = 2.60f;
    BuoyParams.ParticulateFall = 0.35f;

    PlumeFluid ColdPlume(BuoyParams);
    PlumeFluid HotPlume(BuoyParams);
    for (int Step = 0; Step < 30; ++Step)
    {
        ColdPlume.AppendTransientPlumeSource({ 0.0f, 0.0f, 1.6f }, 0.65f, { 0.0f, 0.0f, 0.0f }, 25.0f,   0.0f, 0.0f, 0.0f);
        HotPlume.AppendTransientPlumeSource ({ 0.0f, 0.0f, 1.6f }, 0.65f, { 0.0f, 0.0f, 0.0f }, 25.0f, 130.0f, 6.0f, 2.0f);
        (void)ColdPlume.AdvanceSimulation({ 0.0f, 0.0f, 0.0f }, SunDir, 1.0f / 30.0f);
        (void)HotPlume.AdvanceSimulation ({ 0.0f, 0.0f, 0.0f }, SunDir, 1.0f / 30.0f);
    }
    double ColdMin = 0.0, HotMin = 0.0, ColdZ = 0.0, HotZ = 0.0;
    (void)IntegrateSmokeMassAndMin(ColdPlume, ColdMin, ColdZ);
    (void)IntegrateSmokeMassAndMin(HotPlume,  HotMin,  HotZ);
    std::snprintf(Buf, sizeof(Buf), "cold_centroid_z=%.3f m, hot_centroid_z=%.3f m, delta_z=+%.3f m",
                  ColdZ, HotZ, HotZ - ColdZ);
    VerifyCondition(HotZ > ColdZ + 0.65, "PlumeFluid Archimedean thermal buoyancy plume rise", Buf);

    // 1C. Clamped MacCormack vs 1st-Order Semi-Lagrangian sharpness & toroidal window relocation stability.
    PlumeFluidParameters LegacyAdv = MassParams;
    LegacyAdv.Variant   = PlumeSolverVariant::LegacyHtmlReference;
    LegacyAdv.WindSpeed = 5.5f;
    PlumeFluidParameters MacAdv    = LegacyAdv;
    MacAdv.Variant      = PlumeSolverVariant::ProductionUpgraded;

    PlumeFluid LegacySim(LegacyAdv);
    PlumeFluid MacSim(MacAdv);
    LegacySim.AppendTransientPlumeSource({ -2.0f, 0.0f, 2.0f }, 0.55f, { 0.0f, 0.0f, 0.0f }, 55.0f, 0.0f, 0.0f, 0.0f);
    MacSim.AppendTransientPlumeSource   ({ -2.0f, 0.0f, 2.0f }, 0.55f, { 0.0f, 0.0f, 0.0f }, 55.0f, 0.0f, 0.0f, 0.0f);
    for (int Step = 0; Step < 20; ++Step)
    {
        // Shift anchor across lattice cells to trigger toroidal window relocations simultaneously!
        const float AnchorX = 0.35f * static_cast<float>(Step);
        (void)LegacySim.AdvanceSimulation({ AnchorX, 0.0f, 0.0f }, SunDir, 1.0f / 30.0f);
        (void)MacSim.AdvanceSimulation   ({ AnchorX, 0.0f, 0.0f }, SunDir, 1.0f / 30.0f);
    }
    const float LegPeak = LegacySim.Diagnostics().PeakSmokeDensity;
    const float MacPeak = MacSim.Diagnostics().PeakSmokeDensity;
    const auto  Relocs  = MacSim.Diagnostics().Relocations;
    std::snprintf(Buf, sizeof(Buf), "mac_peak=%.4f vs legacy_peak=%.4f, toroidal_relocations=%u",
                  MacPeak, LegPeak, Relocs);
    VerifyCondition(MacPeak > LegPeak * 1.05f && Relocs >= 3u && std::isfinite(MacPeak),
                    "PlumeFluid MacCormack sharpness & toroidal window relocation invariance", Buf);
}

//------------------------------------------------------------------------------------------------------------------------
//                    2. PREMATURE TYRE FIRE FIX, GRIT .TYRX COMPOUNDS & LIVE JOLT BURNOUT
//------------------------------------------------------------------------------------------------------------------------

void VerifyTyreThermodynamicsAndIgnitionFix()
{
    using namespace Frontier;
    using namespace Frontier::Propulsion;

    // 2A. Compare Legacy TyreThermalSolver vs CalibratedTyreThermodynamics under identical 115 kW stationary RWD burnout!
    TyreThermalSolver LegacySolver(4);
    TyreIgnitionMode  LegacyMode{}; // Default 623.15 K, 4.0 s exposure
    double LegacyIgniteTimeSec = -1.0;
    for (int Step = 1; Step <= 600; ++Step)
    {
        TyreThermalReading R[4]{};
        for (int W = 0; W < 4; ++W)
        {
            R[W].ContactFraction = 1.0;
            R[W].Airspeed        = 0.0; // Stationary line-lock burnout!
            R[W].SlidingPower    = (W >= 2) ? 115000.0 : 0.0;
        }
        LegacySolver.Advance(R, 0.1, LegacyMode);
        if (LegacyIgniteTimeSec < 0.0 && LegacySolver.QueryBurning())
        {
            LegacyIgniteTimeSec = Step * 0.1;
        }
    }

    CalibratedTyreThermodynamics CalibratedRear(ConstructGritTyreCompound(GritTyreCompoundPreset::Gt3SlickDry));
    double CalibratedSmokeOnsetSec  = -1.0;
    double CalibratedIgniteTimeSec  = -1.0;
    double TempAt15Sec              = 0.0;
    bool   BurningAt25Sec           = false;

    for (int Step = 1; Step <= 600; ++Step)
    {
        CalibratedTyreStepInput In{};
        In.RawFrictionalSlipPowerWatts  = 115000.0;
        In.ApplyInternalThermalGripFade = true;
        In.WheelAngularVelocityRadSec   = 122.0; // ~41.5 m/s spinning peripheral tread speed!
        In.ChassisAirspeedMps           = 0.0;
        In.NormalLoadNewtons            = 4100.0;
        In.Grounded                     = true;

        const auto Tel = CalibratedRear.StepWheel(In, 0.1);
        const double TimeS = Step * 0.1;
        if (CalibratedSmokeOnsetSec < 0.0 && Tel.EmittingPyrolysisSmoke)
        {
            CalibratedSmokeOnsetSec = TimeS;
        }
        if (Step == 150)
        {
            TempAt15Sec = Tel.TreadSurfaceKelvin;
        }
        if (Step == 250)
        {
            BurningAt25Sec = Tel.IgnitedOnFire;
        }
        if (CalibratedIgniteTimeSec < 0.0 && Tel.IgnitedOnFire)
        {
            CalibratedIgniteTimeSec = TimeS;
        }
    }

    char Buf[256];
    std::snprintf(Buf, sizeof(Buf),
                  "legacy_fire=%.1f s -> calibrated_smoke=%.1f s, T_15s=%.1f K, burning@25s=%d, calibrated_fire=%.1f s",
                  LegacyIgniteTimeSec, CalibratedSmokeOnsetSec, TempAt15Sec, BurningAt25Sec ? 1 : 0,
                  CalibratedIgniteTimeSec);
    // Either ignites only after >= 30 s of extreme WOT burnout, or thermally equilibrates safely below runaway fire at 25 s!
    const bool DelayedFireOk = (LegacyIgniteTimeSec > 0.0 && LegacyIgniteTimeSec < 14.5) &&
                               (CalibratedSmokeOnsetSec >= 1.5 && CalibratedSmokeOnsetSec <= 10.0) &&
                               (!BurningAt25Sec) &&
                               (CalibratedIgniteTimeSec < 0.0 || CalibratedIgniteTimeSec >= 30.0);
    VerifyCondition(DelayedFireOk, "Premature tyre ignition fixed (smoke at ~3-8 s, zero fire at 25 s)", Buf);

    // 2B. Verify aggressive 12-second drift + 5-second straight cooldown NEVER ignites and recovers Arrhenius integral!
    CalibratedTyreThermodynamics DriftTyre(ConstructGritTyreCompound(GritTyreCompoundPreset::StreetDriftSemiSlick));
    bool DriftEverIgnited = false;
    for (int Step = 0; Step < 170; ++Step)
    {
        const bool InDrift = (Step < 120);
        CalibratedTyreStepInput In{};
        In.RawFrictionalSlipPowerWatts  = InDrift ? 48000.0 : 1200.0;
        In.ApplyInternalThermalGripFade = true;
        In.WheelAngularVelocityRadSec   = InDrift ? 95.0 : 68.0;
        In.ChassisAirspeedMps           = InDrift ? 18.0 : 24.0;
        In.Grounded                     = true;
        const auto Tel = DriftTyre.StepWheel(In, 0.1);
        DriftEverIgnited = DriftEverIgnited || Tel.IgnitedOnFire;
    }
    std::snprintf(Buf, sizeof(Buf), "drift_ignited=%d, post_cooldown_T=%.1f K, arrhenius_integral=%.3f s",
                  DriftEverIgnited ? 1 : 0, DriftTyre.LatestTelemetry().TreadSurfaceKelvin,
                  DriftTyre.LatestTelemetry().ArrheniusIgnitionIntegral);
    VerifyCondition(!DriftEverIgnited && DriftTyre.LatestTelemetry().ArrheniusIgnitionIntegral < 1.0,
                    "12 s drift + 5 s straight cooldown produces zero premature tyre fire", Buf);

    // 2C. NASA Horne wet aquaplaning across GRIT Gt3SlickDry (3.0 mm) vs RallyGravelSoft (11.5 mm) on 4.5 mm standing water!
    CalibratedTyreThermodynamics SlickWet(ConstructGritTyreCompound(GritTyreCompoundPreset::Gt3SlickDry));
    CalibratedTyreThermodynamics RallyWet(ConstructGritTyreCompound(GritTyreCompoundPreset::RallyGravelSoft));
    CalibratedTyreStepInput WetIn{};
    WetIn.ChassisAirspeedMps           = 38.0; // 136.8 km/h through standing puddle!
    WetIn.WheelAngularVelocityRadSec   = 112.0;
    WetIn.StandingWaterFilmMillimetres = 4.5;
    WetIn.Grounded                     = true;
    const auto SlickTel = SlickWet.StepWheel(WetIn, 0.05);
    const auto RallyTel = RallyWet.StepWheel(WetIn, 0.05);
    std::snprintf(Buf, sizeof(Buf), "gt3_slick_aqua_grip=%.3f vs rally_grooved_aqua_grip=%.3f @ 38 m/s in 4.5 mm water",
                  SlickTel.AquaplaningGripMultiplier, RallyTel.AquaplaningGripMultiplier);
    VerifyCondition(SlickTel.AquaplaningGripMultiplier < 0.35 &&
                    RallyTel.AquaplaningGripMultiplier > SlickTel.AquaplaningGripMultiplier + 0.25,
                    "GRIT .tyrx NASA Horne wet aquaplaning differentiation (Slick vs Deep-Lug Rally)", Buf);

    // 2D. Live coupled Jolt 5.6.0 DriveSimulation 15-second full-throttle donut/powerslide verification!
    Drive::DriveSimulation Sim;
    const bool Brought = Sim.Bring();
    Vehicle::DriverInput BurnCmd{};
    BurnCmd.Throttle = 1.0f;
    BurnCmd.Steer    = 0.88f; // High-power RWD powerslide/donut across proving ground!
    Sim.ForwardDirectInput(BurnCmd);
    for (int Frame = 0; Frame < 450; ++Frame) // 15.0 seconds @ 30 Hz (3,600 Jolt 240 Hz steps!)
    {
        Sim.Advance(1.0 / 30.0);
    }
    const Drive::DriveSnapshot Snap = Sim.TakeSnapshot(1280u, 720u);
    const bool AnyBurningAt15s = Snap.Telemetry.Wheels[2].Thermal.Ignited || Snap.Telemetry.Wheels[3].Thermal.Ignited;
    const double RearTreadK    = std::max(Snap.Telemetry.Wheels[2].Thermal.SurfaceTemperature,
                                          Snap.Telemetry.Wheels[3].Thermal.SurfaceTemperature);
    Sim.Retire();
    std::snprintf(Buf, sizeof(Buf), "jolt_steps=%llu, rear_tread_T=%.1f K, premature_fire_at_15s=%d",
                  static_cast<unsigned long long>(Snap.PhysicsSteps), RearTreadK, AnyBurningAt15s ? 1 : 0);
    VerifyCondition(Brought && Snap.PhysicsSteps >= 3500u && RearTreadK > 300.0 && !AnyBurningAt15s,
                    "Coupled Jolt 5.6.0 DriveSimulation 15 s WOT powerslide free of premature tyre fire", Buf);
}

//------------------------------------------------------------------------------------------------------------------------
//              3. FUEL CHEMISTRY, MIXTURES, N2O/WMI ADDITIVES, TURBO/SC, OIL/COOLANT, BEV & HYBRIDS
//------------------------------------------------------------------------------------------------------------------------

void VerifyPropulsionChemistryAndTopologies()
{
    using namespace Frontier::Propulsion;
    char Buf[256];

    // 3A. Fuel presets, custom game-authored hyper-fuel, E50 synergistic mixture & Nitromethane energy per kg air.
    const auto Gas93  = ConstructPresetFuelSpecies(StandardFuelPreset::PumpGasoline93);
    const auto Eth85  = ConstructPresetFuelSpecies(StandardFuelPreset::EthanolE85);
    const auto Nitro  = ConstructPresetFuelSpecies(StandardFuelPreset::NitromethaneCh3No2);

    FuelSpeciesSpecification CustomHyperFuel{};
    CustomHyperFuel.Name                          = "FrontierSynthAzide120";
    CustomHyperFuel.DensityKgPerLitre             = 0.845;
    CustomHyperFuel.LowerHeatingEnthalpyMjPerKg   = 47.20;
    CustomHyperFuel.StoichiometricAirFuelRatio    = 11.40;
    CustomHyperFuel.ResearchOctaneNumber          = 126.0;
    CustomHyperFuel.MotorOctaneNumber             = 114.0;
    CustomHyperFuel.LatentHeatVaporizationKjPerKg = 620.0;
    CustomHyperFuel.OxygenMassFraction            = 0.14;
    CustomHyperFuel.LaminarFlameSpeedMps          = 0.78;

    const auto BlendE50  = EvaluateFuelMixtureChemistry({ { Gas93, 0.50 }, { Eth85, 0.50 } });
    const auto PureNitro = EvaluateFuelMixtureChemistry({ { Nitro, 1.0 } });
    const double LinearMidAki = 0.5 * (0.5 * (Gas93.ResearchOctaneNumber + Gas93.MotorOctaneNumber) +
                                       0.5 * (Eth85.ResearchOctaneNumber + Eth85.MotorOctaneNumber));

    std::snprintf(Buf, sizeof(Buf), "E50_AKI=%.2f (linear=%.2f), Nitro_spec_E=%.3f MJ/kg_air (2.21x Gas93), custom_valid=%d",
                  BlendE50.EffectiveAntiKnockIndex, LinearMidAki, PureNitro.SpecificStoichiometricEnergy,
                  ValidateFuelSpecies(CustomHyperFuel) ? 1 : 0);
    VerifyCondition(ValidateFuelSpecies(CustomHyperFuel) &&
                    BlendE50.EffectiveAntiKnockIndex > LinearMidAki + 0.8 &&
                    PureNitro.SpecificStoichiometricEnergy > 6.4,
                    "Fuel thermochemistry, synergistic alcohol blending & Nitromethane/custom fuels", Buf);

    // 3B. Nitrous Oxide (N2O) Wet Shot vs Dry Shot & Water-Methanol anti-knock recovery under 1.55 bar boost!
    CombustionOperatingConditions HighBoostCond{};
    HighBoostCond.BaseAirMassFlowKgPerSec = 0.28;
    HighBoostCond.ManifoldBoostBar        = 1.55;
    HighBoostCond.AmbientAirKelvin        = 303.15;
    HighBoostCond.CompressionRatio        = 10.2;
    HighBoostCond.EngineRpm               = 6200.0;
    HighBoostCond.CommandedLambda         = 0.87;
    HighBoostCond.AdditiveTriggered       = false;

    FuelAndAdditiveTankReservoir TankPump(60.0);
    TankPump.ConfigureSingleFuel(Gas93, 50.0);
    const auto BaseKnockRes = TankPump.StepCombustion(HighBoostCond, 0.1);

    FuelAndAdditiveTankReservoir TankWmi(60.0);
    TankWmi.ConfigureSingleFuel(Gas93, 50.0);
    TankWmi.InstallAdditive(ConstructWaterMethanolInjection(0.024), 5.0);
    HighBoostCond.AdditiveTriggered = true;
    const auto WmiRes = TankWmi.StepCombustion(HighBoostCond, 0.1);

    FuelAndAdditiveTankReservoir TankWetN2o(60.0);
    TankWetN2o.ConfigureSingleFuel(ConstructPresetFuelSpecies(StandardFuelPreset::RaceGasolineC16), 50.0);
    TankWetN2o.InstallAdditive(ConstructNitrousWetShot(150.0), 4.54);
    HighBoostCond.AdditiveTriggered = false;
    const auto C16BaseRes = TankWetN2o.StepCombustion(HighBoostCond, 0.1);
    HighBoostCond.AdditiveTriggered = true;
    const auto WetN2oRes  = TankWetN2o.StepCombustion(HighBoostCond, 0.1);

    FuelAndAdditiveTankReservoir TankDryN2o(60.0);
    TankDryN2o.ConfigureSingleFuel(ConstructPresetFuelSpecies(StandardFuelPreset::RaceGasolineC16), 50.0);
    TankDryN2o.InstallAdditive(ConstructNitrousDryShot(150.0), 4.54);
    const auto DryN2oRes = TankDryN2o.StepCombustion(HighBoostCond, 0.1);

    std::snprintf(Buf, sizeof(Buf),
                  "93AKI_knock=%.3f -> WMI_knock=%.3f (dT=-%.1f K); WetN2O_gain=%.2fx (lambda=%.2f) vs DryN2O_lambda=%.2f",
                  BaseKnockRes.KnockRetardPenalty, WmiRes.KnockRetardPenalty,
                  BaseKnockRes.IntakeChargeKelvin - WmiRes.IntakeChargeKelvin,
                  WetN2oRes.EffectiveTorqueMultiplier / std::max(0.01, C16BaseRes.EffectiveTorqueMultiplier),
                  WetN2oRes.ActualLambda, DryN2oRes.ActualLambda);
    VerifyCondition(BaseKnockRes.KnockRetardPenalty < 0.85 &&
                    WmiRes.KnockRetardPenalty > BaseKnockRes.KnockRetardPenalty + 0.12 &&
                    WetN2oRes.EffectiveTorqueMultiplier > C16BaseRes.EffectiveTorqueMultiplier * 1.24 &&
                    WetN2oRes.ActualLambda < 0.96 && DryN2oRes.ActualLambda > 1.05,
                    "Additives: N2O Wet vs Dry stoichiometry & Water-Methanol knock suppression", Buf);

    // 3C. Forced Induction: Supercharger instant low-RPM boost + belt drag vs Turbo spool + C16 RaceBoostMap + Surge!
    ForcedInductionSpecification ScSpec{};
    ScSpec.Architecture         = AspirationArchitecture::Supercharged;
    ScSpec.SuperchargerGeometry = SuperchargerCompressorGeometry::TwinScrewInternalCompression;
    ForcedInductionAssembly Supercharger(ScSpec);
    const auto ScLowRpm = Supercharger.StepInduction(2200.0, 7500.0, 5.0, 1.0, 1.01325, 295.15, 93.0, 0.15);

    ForcedInductionSpecification TurboSpec{};
    TurboSpec.Architecture              = AspirationArchitecture::Turbocharged;
    TurboSpec.CompressorSurgeMarginRatio= 0.25;
    ForcedInductionAssembly Turbo93(TurboSpec);
    ForcedInductionAssembly TurboC16(TurboSpec);
    ForcedInductionTelemetry T93{}, TC16{};
    for (int Step = 0; Step < 25; ++Step)
    {
        T93  = Turbo93.StepInduction (6000.0, 7800.0, 3.8, 1.0, 1.01325, 295.15,  93.0, 0.05);
        TC16 = TurboC16.StepInduction(6000.0, 7800.0, 3.8, 1.0, 1.01325, 295.15, 118.0, 0.05);
    }
    const auto SurgeCheck = TurboC16.StepInduction(6000.0, 7800.0, 3.8, 0.02, 1.01325, 295.15, 118.0, 0.02);

    std::snprintf(Buf, sizeof(Buf),
                  "SC@2200rpm=%.2f bar (belt_drag=%.1f Nm); Turbo_93=%.2f bar vs Turbo_C16=%.2f bar; snap_surge=%d",
                  ScLowRpm.ManifoldGaugeBoostBar, ScLowRpm.ParasiticCrankTorqueNm,
                  T93.ManifoldGaugeBoostBar, TC16.ManifoldGaugeBoostBar, SurgeCheck.CompressorSurgeDetected ? 1 : 0);
    VerifyCondition(ScLowRpm.ManifoldGaugeBoostBar > 0.85 && ScLowRpm.ParasiticCrankTorqueNm > 18.0 &&
                    TC16.ManifoldGaugeBoostBar > T93.ManifoldGaugeBoostBar + 0.25 &&
                    SurgeCheck.CompressorSurgeDetected,
                    "Forced Induction: Twin-Screw Supercharger belt physics & Turbo octane-gated boost/surge", Buf);

    // 3D. 5W-40 Engine Oil Walther viscosity & Coolant thermostat regulation.
    ThermalLubricationCircuit ColdCircuit({}, 303.15, 313.15);
    ThermalLubricationCircuit HotCircuit ({}, 369.15, 373.15);
    const auto ColdLub = ColdCircuit.StepThermalCircuit(15.0, 3500.0, 10.0, 293.15, 0.0);
    const auto HotLub  = HotCircuit.StepThermalCircuit (90.0, 6500.0, 35.0, 293.15, 0.0);
    std::snprintf(Buf, sizeof(Buf), "oil_40C=%.1f cSt -> oil_100C=%.1f cSt, thermo_open=%.2f, gallery=%.0f kPa",
                  ColdLub.OilKinematicViscosityCst, HotLub.OilKinematicViscosityCst,
                  HotLub.ThermostatOpenFraction, HotLub.OilGalleryPressureKpa);
    VerifyCondition(std::abs(ColdLub.OilKinematicViscosityCst - 90.0) < 1.5 &&
                    std::abs(HotLub.OilKinematicViscosityCst  - 14.0) < 1.0 &&
                    HotLub.ThermostatOpenFraction > 0.95 && HotLub.OilGalleryPressureKpa <= 700.1,
                    "GRIT 5W-40 Engine Oil Walther viscosity & Coolant wax-thermostat circuit", Buf);

    // 3E. BEV Quad-Motor Torque Vectoring + Regenerative Braking SoC Recovery + Hybrid Through-The-Road AWD!
    UnifiedPropulsionConfiguration BevCfg{};
    BevCfg.Topology = PowertrainTopology::BatteryElectricQuadMotorVector;
    BevCfg.Battery  = ConstructPresetBatteryPack(BatteryCellChemistry::SolidElectrolyteLithium);
    UnifiedPropulsionAssembly QuadBev(BevCfg, 0.0, 0.75);

    UnifiedPropulsionInputs BevLaunch{};
    BevLaunch.ThrottlePosition   = 1.0;
    BevLaunch.SteeringNormalized = 0.65; // Cornering right/left -> active yaw torque vectoring!
    BevLaunch.FrontAxleOmegaRadSec = 25.0;
    BevLaunch.RearAxleOmegaRadSec  = 25.0;
    const auto LaunchOut = QuadBev.StepPropulsion(BevLaunch, 0.5);
    const double SocAfterLaunch = QuadBev.BatteryPack().ChargeFraction();

    UnifiedPropulsionInputs BevRegen{};
    BevRegen.ThrottlePosition     = 0.0;
    BevRegen.BrakePosition        = 0.85;
    BevRegen.FrontAxleOmegaRadSec = 95.0;
    BevRegen.RearAxleOmegaRadSec  = 95.0;
    const auto RegenOut = QuadBev.StepPropulsion(BevRegen, 2.0);
    const double SocAfterRegen = QuadBev.BatteryPack().ChargeFraction();

    UnifiedPropulsionConfiguration TtrHybridCfg{};
    TtrHybridCfg.Topology       = PowertrainTopology::HybridThroughTheRoadAwd;
    TtrHybridCfg.HybridStrategy = HybridDeploymentStrategy::QualifyingMaxAttack;
    UnifiedPropulsionAssembly TtrHybrid(TtrHybridCfg, 50.0, 0.80);
    UnifiedPropulsionInputs HybIn{};
    HybIn.ThrottlePosition     = 1.0;
    HybIn.FrontAxleOmegaRadSec = 55.0;
    HybIn.RearAxleOmegaRadSec  = 55.0;
    const auto HybAttack = TtrHybrid.StepPropulsion(HybIn, 0.2);
    TtrHybrid.AssignHybridStrategy(HybridDeploymentStrategy::ElectricOnlyStealth);
    const auto HybStealth = TtrHybrid.StepPropulsion(HybIn, 0.2);

    std::snprintf(Buf, sizeof(Buf),
                  "BEV_drive=%.0f Nm (vector_diff=%.0f Nm), regen=%.0f Nm (SoC %.5f->%.5f); TTR_AWD(F=%.0f,R=%.0f), EV_fuel=%.6f",
                  LaunchOut.TotalAxleDriveNm, LaunchOut.WheelDriveTorqueNm[2] - LaunchOut.WheelDriveTorqueNm[3],
                  RegenOut.TotalRegenBrakeNm, SocAfterLaunch, SocAfterRegen,
                  HybAttack.WheelDriveTorqueNm[0] + HybAttack.WheelDriveTorqueNm[1],
                  HybAttack.WheelDriveTorqueNm[2] + HybAttack.WheelDriveTorqueNm[3],
                  HybStealth.Combustion.FuelConsumptionKgPerSec);
    VerifyCondition(LaunchOut.TotalAxleDriveNm > 5000.0 &&
                    (LaunchOut.WheelDriveTorqueNm[2] > LaunchOut.WheelDriveTorqueNm[3] + 200.0) &&
                    RegenOut.TotalRegenBrakeNm > 1500.0 && SocAfterRegen > SocAfterLaunch &&
                    (HybAttack.WheelDriveTorqueNm[0] > 400.0 && HybAttack.WheelDriveTorqueNm[2] > 800.0) &&
                    HybStealth.Combustion.FuelConsumptionKgPerSec == 0.0 && HybStealth.TotalAxleDriveNm > 800.0,
                    "BEV Quad-Motor vectoring/regen & Through-The-Road AWD Hybrid topologies", Buf);
}

//------------------------------------------------------------------------------------------------------------------------
//                4. CLOUD-GATED BUDGETED WEATHER PARTICLES & SHARED 3D WIND / FORCE-FIELD
//------------------------------------------------------------------------------------------------------------------------

void VerifyCloudGatedWeatherAndWindField()
{
    using namespace Frontier;
    char Buf[256];

    WindFieldConfiguration WindCfg{};
    WindCfg.AmbientReferenceWindMps = { 6.5, 2.2, 0.0 };
    WindField WindField(WindCfg);

    ForceFieldPrimitive Vortex{};
    Vortex.Form             = ForcePrimitiveForm::VortexColumnUpdraft;
    Vortex.WorldCenter      = { 8.0, 0.0, 2.0 };
    Vortex.InfluenceRadiusM = 5.0;
    Vortex.PeakSpeedMps     = 14.0;
    WindField.AppendForcePrimitive(Vortex);
    WindField.RegisterVehicleWake({ 0.0, 0.0, 0.5 }, { 28.0, 0.0, 0.0 }, 3.8);
    WindField.StepField({ 0.0, 0.0, 0.0 }, 0.05);

    // 4A. Clear-sky zero-waste check: Coverage = 0.0 MUST spawn 0 particles!
    CloudParameters ClearSky{};
    ClearSky.Coverage = 0.0;

    WeatherParticleBudgetConfig SnowCfg{};
    SnowCfg.Category               = FallingParticleCategory::SnowFlake;
    SnowCfg.StrictParticleBudget   = 2048u;
    SnowCfg.SpawnVolumeHorizontalM = 2400.0; // Spans multiple 1.4 km CloudField cumulus cells & clear-sky gaps!
    CloudGatedWeatherSpawner SnowSpawner(SnowCfg);
    const auto ClearTel = SnowSpawner.StepParticles(ClearSky, WindField, { 0.0, 0.0, 0.0 }, 1.0 / 30.0);

    // 4B. Patchy cumulus sky (Coverage = 0.54): verify strict budget & 100.0% cloud-column gating!
    CloudParameters PatchyClouds{};
    PatchyClouds.Coverage    = 0.54;
    PatchyClouds.BaseHeightM = 800.0;
    PatchyClouds.TopHeightM  = 1650.0;

    CloudGatedSpawnerTelemetry PatchyTel{};
    for (int Step = 0; Step < 45; ++Step)
    {
        WindField.StepField({ 0.0, 0.0, 0.0 }, 1.0 / 30.0);
        WindField.SynchronizeCloudAdvection(PatchyClouds, 1.0 / 30.0);
        PatchyTel = SnowSpawner.StepParticles(PatchyClouds, WindField, { 0.0, 0.0, 0.0 }, 1.0 / 30.0);
    }

    // Also verify Hail ground restitution bounce under storm clouds!
    WeatherParticleBudgetConfig HailCfg = SnowCfg;
    HailCfg.Category             = FallingParticleCategory::HailPellet;
    HailCfg.StrictParticleBudget = 1024u;
    CloudGatedWeatherSpawner HailSpawner(HailCfg);
    std::uint32_t BouncedHailCount = 0u;
    for (int Step = 0; Step < 60; ++Step)
    {
        (void)HailSpawner.StepParticles(PatchyClouds, WindField, { 0.0, 0.0, 0.0 }, 1.0 / 30.0);
        for (const auto& P : HailSpawner.Particles())
        {
            if (P.Alive && P.BounceCounter > 0u)
            {
                ++BouncedHailCount;
            }
        }
    }

    // Verify shared WindForceField couples into Fog, PlumeFluid, and Vehicle relative airflow!
    PlumeFluidParameters SyncedPlume{};
    WindField.SynchronizePlumeParameters(SyncedPlume, { 0.0, 0.0, 0.0 });
    const SpatialVector VortexSample = WindField.SampleWindVelocity({ 10.5, 0.0, 2.5 });
    const SpatialVector RelAirflow   = WindField.EvaluateRelativeVehicleAirflow({ 0.0, 0.0, 0.5 }, { 30.0, 0.0, 0.0 });

    std::snprintf(Buf, sizeof(Buf),
                  "clear_sky_alive=%u; patchy_cols=%u/1024, alive=%u/%u, under_cloud=%.4f, hail_bounces=%u, vortex_vy=%.2f m/s",
                  ClearTel.CurrentAliveParticles, PatchyTel.PrecipitatingCloudColumns,
                  PatchyTel.CurrentAliveParticles, PatchyTel.StrictParticleBudget,
                  PatchyTel.SpawnedUnderCloudFraction, BouncedHailCount, VortexSample.Y);
    VerifyCondition(ClearTel.CurrentAliveParticles == 0u &&
                    PatchyTel.PrecipitatingCloudColumns > 50u && PatchyTel.PrecipitatingCloudColumns < 980u &&
                    PatchyTel.CurrentAliveParticles > 0u &&
                    PatchyTel.CurrentAliveParticles <= PatchyTel.StrictParticleBudget &&
                    PatchyTel.SpawnedUnderCloudFraction == 1.0 &&
                    BouncedHailCount > 10u &&
                    std::abs(VortexSample.Y) > 4.0 &&
                    SyncedPlume.WindSpeed > 1.0f &&
                    RelAirflow.X < 28.0,
                    "Cloud-gated Vose-Alias weather spawner (0 clear-sky waste) & shared 3D Wind/Force-Field", Buf);
}

//------------------------------------------------------------------------------------------------------------------------
//                5. ENGINE-WIDE MULTIPLAYER NETWORKING (FP1 PARITY, 48B VEHICLE, DELTA & RECONCILE)
//------------------------------------------------------------------------------------------------------------------------

void VerifyEngineNetworking()
{
    using namespace Frontier;
    using namespace Frontier::Networking;
    char Buf[256];

    // 5A. Smallest-three 32-bit quaternion accuracy & GRIT 48-byte vehicle wire quantization.
    DecodedVehicleReplicationSample OrigVeh{};
    OrigVeh.ObjectIdentifier      = 77u;
    OrigVeh.Position              = { 142.35f, -38.90f, 1.42f };
    OrigVeh.Orientation           = UnitQuaternion::FromAxisAngle({ 0.2f, 0.3f, 0.9327f }, 1.18f);
    OrigVeh.LinearVelocity        = { 41.25f, -3.40f, 0.15f };
    OrigVeh.AngularVelocity       = { 0.05f, -0.12f, 0.85f };
    OrigVeh.SuspensionDeflectionM = { 0.042f, 0.068f, 0.054f, 0.080f };
    OrigVeh.WheelSpinRadSec       = { 122.0f, 122.0f, 136.0f, 136.0f };
    OrigVeh.Steering              = -0.42f;
    OrigVeh.Throttle              = 0.92f;
    OrigVeh.GearNumber            = 4;
    OrigVeh.AdditiveActive        = true;
    OrigVeh.SmokingActive         = true;
    OrigVeh.ManifoldBoostBar      = 1.5f;
    OrigVeh.EnergyReservePercent  = 84.0f;
    OrigVeh.EngineRpm             = 6840.0f;

    const CompactVehicleWireRecord WireVeh = QuantizeVehicleSample(OrigVeh);
    const DecodedVehicleReplicationSample DecVeh = DequantizeVehicleSample(WireVeh);
    const float DotQ = std::clamp(
        std::abs(OrigVeh.Orientation.X * DecVeh.Orientation.X + OrigVeh.Orientation.Y * DecVeh.Orientation.Y +
                 OrigVeh.Orientation.Z * DecVeh.Orientation.Z + OrigVeh.Orientation.W * DecVeh.Orientation.W),
        0.0f, 1.0f);
    const float AngleErrorDeg = 2.0f * std::acos(DotQ) * (180.0f / 3.14159265f);
    const double Bandwidth50Cars30HzKbps = (50.0 * sizeof(CompactVehicleWireRecord) * 30.0) / 1000.0;

    std::snprintf(Buf, sizeof(Buf), "sizeof=%zu B (50 cars @ 30Hz = %.1f KB/s), quat_err=%.4f deg, boost=%.1f bar, N2O=%d",
                  sizeof(CompactVehicleWireRecord), Bandwidth50Cars30HzKbps, AngleErrorDeg,
                  DecVeh.ManifoldBoostBar, DecVeh.AdditiveActive ? 1 : 0);
    VerifyCondition(sizeof(CompactVehicleWireRecord) == 48u && AngleErrorDeg < 0.12f &&
                    std::abs(DecVeh.LinearVelocity.X - OrigVeh.LinearVelocity.X) < 0.02f &&
                    DecVeh.GearNumber == 4 && DecVeh.AdditiveActive && DecVeh.SmokingActive,
                    "GRIT 48-byte vehicle codec & smallest-three 32-bit quaternion compression", Buf);

    // 5B. WorldReplicationRegistry delta compression + Project-Networking TransportCodec 'FP1' binary parity!
    WorldReplicationRegistry ServerWorld;
    WorldReplicationRegistry ClientWorld;
    SequenceAckTracker       ServerAck;
    SequenceAckTracker       ClientAck;

    for (std::uint32_t Id = 1u; Id <= 40u; ++Id)
    {
        ReplicatedObjectDescriptor Obj{};
        Obj.ObjectIdentifier    = Id;
        Obj.ArchetypeIdentifier = (Id <= 4u) ? 10u : 2u; // 4 dynamic actors + 36 static props
        Obj.Position            = { static_cast<float>(Id) * 2.0f, 0.0f, 1.0f };
        Obj.CustomChannels      = { 100.0f, 1.0f, 0.0f, 0.0f };
        ServerWorld.UpsertObject(Obj);
    }
    ServerWorld.CaptureTickSnapshot(10u);

    std::vector<std::uint8_t> KeyframePkt;
    std::uint32_t KeyframeObjs = 0u;
    const bool EncodedKey = ServerWorld.BuildDeltaSnapshotPacket(10u, 0u, { 20.0f, 0.0f, 0.0f }, ServerAck, KeyframePkt, KeyframeObjs);

    // Decode exact same wire bytes through Project-Networking's PacketCodec::Decode!
    ::Networking::ReplicationKind ProjNetKind{};
    const std::uint8_t* ProjNetPayload = nullptr;
    std::size_t ProjNetLen             = 0u;
    const bool ProjNetOk = ::Networking::PacketCodec::Decode(
        KeyframePkt.data(), KeyframePkt.size(), ProjNetKind, ProjNetPayload, ProjNetLen);

    std::uint32_t RxTick = 0u;
    const bool AppliedKey = ClientWorld.ApplyIncomingSnapshotPacket(KeyframePkt.data(), KeyframePkt.size(), 0.030, ClientAck, RxTick);

    // Client sends redundant CommandStream back to Server -> acknowledges baseline tick 10!
    ClientPredictionReconciler Predictor;
    auto StepKinematic = [](Vec3& Pos, Vec3& Vel, const NetworkCommandFrame& Cmd, float Dt) {
        Vel.X += Cmd.MoveForward * 12.0f * Dt;
        Pos.X += Vel.X * Dt;
    };
    Vec3 PredPos{ 0.0f, 0.0f, 0.0f }, PredVel{ 0.0f, 0.0f, 0.0f };
    for (std::uint32_t T = 1u; T <= 12u; ++T)
    {
        NetworkCommandFrame Cmd{ T, 1.0f, 0.0f, 0.0f, 1u };
        StepKinematic(PredPos, PredVel, Cmd, 1.0f / 60.0f);
        Predictor.RecordPredictedTick(Cmd, PredPos, PredVel);
    }
    std::vector<std::uint8_t> CmdPkt;
    const bool CmdEncOk = Predictor.EncodeRedundantCommandPacket(4u, ClientAck, CmdPkt);
    std::vector<NetworkCommandFrame> DecodedCmds;
    const bool CmdDecOk = ClientPredictionReconciler::DecodeCommandPacket(CmdPkt.data(), CmdPkt.size(), 0.060, ServerAck, DecodedCmds);

    // Now move ONLY 3 objects on tick 11 and encode delta against ServerAck.HighestConfirmedBaselineTick() (10)!
    for (std::uint32_t Id = 1u; Id <= 3u; ++Id)
    {
        ReplicatedObjectDescriptor Moved = *ServerWorld.FindObject(Id);
        Moved.Position.X += 1.25f;
        ServerWorld.UpsertObject(Moved);
    }
    ServerWorld.CaptureTickSnapshot(11u);
    std::vector<std::uint8_t> DeltaPkt;
    std::uint32_t DeltaObjs = 0u;
    const bool EncodedDelta = ServerWorld.BuildDeltaSnapshotPacket(
        11u, ServerAck.HighestConfirmedBaselineTick(), { 20.0f, 0.0f, 0.0f }, ServerAck, DeltaPkt, DeltaObjs);

    // Reconcile an authoritative server nudge at tick 6 and replay ticks 7..12!
    Vec3 ReconciledPos{}, ReconciledVel{};
    const bool Replayed = Predictor.ReconcileAuthoritativePose(
        6u, { 2.50f, 0.0f, 0.0f }, { 5.0f, 0.0f, 0.0f }, 1.0f / 60.0f, 0.05f, StepKinematic, ReconciledPos, ReconciledVel);

    // Hermite remote interpolator smoothness check.
    HermitePoseInterpolator Interp(0.050);
    Interp.PushTimedSample(1.000, {  0.0f, 0.0f, 0.0f }, { 0.0f, 0.0f, 0.0f, 1.0f }, { 20.0f, 0.0f, 0.0f });
    Interp.PushTimedSample(1.050, {  1.0f, 0.0f, 0.0f }, { 0.0f, 0.0f, 0.0f, 1.0f }, { 20.0f, 0.0f, 0.0f });
    Vec3 MidPos{}, MidVel{};
    UnitQuaternion MidRot{};
    Interp.EvaluateAtRenderTime(1.075, MidPos, MidRot, MidVel); // TargetTime = 1.025 -> exact midpoint 0.50 m @ 20 m/s!

    std::snprintf(Buf, sizeof(Buf),
                  "FP1_parity=%d, keyframe=%u objs (%zu B) -> delta=%u objs (%zu B), replay=%d (x=%.3f), hermite_x=%.3f",
                  ProjNetOk ? 1 : 0, KeyframeObjs, KeyframePkt.size(), DeltaObjs, DeltaPkt.size(),
                  Replayed ? 1 : 0, ReconciledPos.X, MidPos.X);
    VerifyCondition(EncodedKey && ProjNetOk && ProjNetKind == ::Networking::ReplicationKind::Snapshot &&
                    AppliedKey && CmdEncOk && CmdDecOk && DecodedCmds.size() == 8u &&
                    EncodedDelta && KeyframeObjs == 40u && DeltaObjs == 3u &&
                    Replayed && ReconciledPos.X > 3.0f && std::abs(MidPos.X - 0.50f) < 1.0e-3f,
                    "Engine FP1 wire parity, baseline delta compression, Hermite spline & client reconciliation", Buf);
}

//------------------------------------------------------------------------------------------------------------------------
//              6. TASKGRAPH, COMPILED FRAMEGRAPH, DEDICATED RENDERTHREAD & AUDIO FOUNDATION
//------------------------------------------------------------------------------------------------------------------------

void VerifyTaskGraphFrameGraphAndAudio()
{
    using namespace Frontier;
    char Buf[256];

    WorkerPool Pool(4u, "ValidationPool");

    // 6A. Multi-domain DAG TaskGraphSchedule execution + cycle rejection.
    TaskGraphSchedule Dag;
    std::atomic<int> OrderTrace{ 0 };
    int StampNet = 0, StampWind = 0, StampWeather = 0, StampPhys = 0, StampAudio = 0, StampJoin = 0;

    const TaskHandle TNet     = Dag.DeclareTask("NetworkReceive", TaskDomainTag::NetworkSnapshot, [&]() { StampNet     = ++OrderTrace; });
    const TaskHandle TWind    = Dag.DeclareTask("WindLattice",    TaskDomainTag::WeatherAndFluid, [&]() { StampWind    = ++OrderTrace; });
    const TaskHandle TWeather = Dag.DeclareTask("CloudParticles", TaskDomainTag::WeatherAndFluid, [&]() { StampWeather = ++OrderTrace; }, { TWind });
    const TaskHandle TPhys    = Dag.DeclareTask("VehicleStep",    TaskDomainTag::PhysicsStep,     [&]() { StampPhys    = ++OrderTrace; }, { TNet, TWind });
    const TaskHandle TAudio   = Dag.DeclareTask("AudioSnapshot",  TaskDomainTag::AudioPrep,       [&]() { StampAudio   = ++OrderTrace; }, { TPhys, TWeather });
    const TaskHandle TJoin    = Dag.DeclareTask("PublishFrame",   TaskDomainTag::RenderRecord,    [&]() { StampJoin    = ++OrderTrace; }, { TAudio });
    (void)TJoin;

    TaskExecutionMetrics DagMetrics{};
    std::string DagDiag;
    const bool DagOk = Dag.ExecuteOnPool(Pool, DagMetrics, DagDiag);

    TaskGraphSchedule CyclicDag;
    const TaskHandle Ca = CyclicDag.DeclareTask("CycleA", TaskDomainTag::GeneralCompute, {});
    const TaskHandle Cb = CyclicDag.DeclareTask("CycleB", TaskDomainTag::GeneralCompute, {}, { Ca });
    CyclicDag.AddPrecedenceEdge(Cb, Ca);
    std::string CycleDiag;
    const bool CycleRejected = !CyclicDag.CompileSchedule(CycleDiag);

    std::snprintf(Buf, sizeof(Buf), "tasks=%u, depth=%u, width=%u, causality=%d, cycle_rejected=%d",
                  DagMetrics.TotalTasksExecuted, DagMetrics.CriticalPathDepth, DagMetrics.MaxWavefrontWidth,
                  (StampWind < StampWeather && StampNet < StampPhys && StampPhys < StampAudio && StampAudio < StampJoin) ? 1 : 0,
                  CycleRejected ? 1 : 0);
    VerifyCondition(DagOk && DagMetrics.TotalTasksExecuted == 6u &&
                    StampWind < StampWeather && StampNet < StampPhys &&
                    StampPhys < StampAudio && StampWeather < StampAudio && StampAudio < StampJoin &&
                    CycleRejected,
                    "Multi-threaded TaskGraphSchedule DAG ordering & cycle refusal", Buf);

    // 6B. CompiledFrameGraphPlan (SubmissionOrder + BarrierDerivation + TransientTargetAtlas + parallel recording) + RenderThread!
    CompiledFrameGraphPlan FrameGraph;
    FrameGraph.DeclareTarget({ "SceneDepth",     TargetFormat::Depth32Float, 1920u, 1080u, false, TargetUsage::Undefined });
    FrameGraph.DeclareTarget({ "GBufferAlbedo",  TargetFormat::Rgba16Float,  1920u, 1080u, false, TargetUsage::Undefined });
    FrameGraph.DeclareTarget({ "DirectRestir",   TargetFormat::Rgba16Float,  1920u, 1080u, false, TargetUsage::Undefined });
    FrameGraph.DeclareTarget({ "PlumeVolumetric",TargetFormat::Rgba16Float,  1920u, 1080u, false, TargetUsage::Undefined });
    FrameGraph.DeclareTarget({ "HdrComposite",   TargetFormat::Rgba16Float,  1920u, 1080u, false, TargetUsage::Undefined });
    FrameGraph.DeclareTarget({ "DisplaySwapchain",TargetFormat::Bgra8Unorm,  1920u, 1080u, true,  TargetUsage::Present });

    FrameGraph.DeclareSubmissionUnit({ "SurfaceRaster", {
        { "SceneDepth",    TargetUsage::DepthWrite },
        { "GBufferAlbedo", TargetUsage::ColourWrite }
    }, {} }, [](std::uint32_t Pos, const auto&) { return 100u + Pos; });

    FrameGraph.DeclareSubmissionUnit({ "RestirDirectLighting", {
        { "SceneDepth",    TargetUsage::DepthRead },
        { "GBufferAlbedo", TargetUsage::Sampled },
        { "DirectRestir",  TargetUsage::StorageWrite }
    }, {} }, [](std::uint32_t Pos, const auto&) { return 200u + Pos; });

    FrameGraph.DeclareSubmissionUnit({ "VolumetricPlumeAndWeather", {
        { "SceneDepth",      TargetUsage::DepthRead },
        { "PlumeVolumetric", TargetUsage::StorageWrite }
    }, {} }, [](std::uint32_t Pos, const auto&) { return 300u + Pos; });

    FrameGraph.DeclareSubmissionUnit({ "AtmosphereAndFluidComposite", {
        { "DirectRestir",    TargetUsage::Sampled },
        { "PlumeVolumetric", TargetUsage::Sampled },
        { "HdrComposite",    TargetUsage::StorageWrite }
    }, {} }, [](std::uint32_t Pos, const auto&) { return 400u + Pos; });

    FrameGraph.DeclareSubmissionUnit({ "DisplayToneMapPresent", {
        { "HdrComposite",     TargetUsage::Sampled },
        { "DisplaySwapchain", TargetUsage::ColourWrite },
        { "DisplaySwapchain", TargetUsage::Present }
    }, {} }, [](std::uint32_t Pos, const auto&) { return 500u + Pos; });

    FrameGraphCompileMetrics FgMetrics{};
    std::string FgDiag;
    const bool FgCompiled = FrameGraph.CompilePlan(FgMetrics, FgDiag);

    std::vector<RecordedCommandPacket> Packets;
    std::atomic<std::uint64_t> RenderThreadRecordedUnits{ 0u };
    DedicatedRenderThreadExtension RenderThread;
    const bool RtStarted = RenderThread.Start([&](const RenderFrameEnvelope& Env)
    {
        std::vector<RecordedCommandPacket> LocalPackets;
        std::string Err;
        if (FrameGraph.ExecuteParallelRecording(Pool, LocalPackets, Err))
        {
            RenderThreadRecordedUnits.fetch_add(LocalPackets.size(), std::memory_order_acq_rel);
        }
        (void)Env;
    });

    for (std::uint64_t Ord = 1u; Ord <= 12u; ++Ord)
    {
        RenderThread.PublishSimulationFrame({ Ord, static_cast<double>(Ord) / 60.0, 1.0, static_cast<std::uint32_t>(Ord), 1024u, 8u });
        RenderThread.WaitUntilOrdinalRendered(Ord);
    }
    const auto RtDiag = RenderThread.QueryDiagnostics();
    RenderThread.Retire();

    // 6C. AudioFoundation physical Doppler shift, inverse-distance attenuation & SnapshotExchange bridge.
    Audio::AcousticListenerPose Listener{};
    Listener.Position = { 0.0f, 0.0f, 1.6f };
    Listener.Forward  = { 1.0f, 0.0f, 0.0f };
    Listener.Up       = { 0.0f, 0.0f, 1.0f };

    Audio::AcousticSourceDescriptor ApproachingCar{};
    ApproachingCar.BusRoute            = Audio::AudioMixBusRoute::VehiclePropulsion;
    ApproachingCar.Position            = { 25.0f, -15.0f, 0.8f }; // Ahead and to the right (+Y is left, -Y is right!)
    ApproachingCar.Velocity            = { -45.0f, 0.0f, 0.0f };  // Approaching listener rapidly!
    ApproachingCar.ReferenceDistanceM  = 4.0f;
    ApproachingCar.MaxAudibleDistanceM = 200.0f;

    Audio::AcousticSourceDescriptor RecedingCar = ApproachingCar;
    RecedingCar.Velocity = { +45.0f, 0.0f, 0.0f };

    const auto AppMetrics = Audio::EvaluateSpatialAcoustics(Listener, ApproachingCar);
    const auto RecMetrics = Audio::EvaluateSpatialAcoustics(Listener, RecedingCar);

    Audio::AcousticSnapshotBridge AudioBridge;
    Audio::AcousticFrameSnapshot AudioSnap{};
    AudioSnap.FrameOrdinal                          = 42u;
    AudioSnap.PlayerVehicleHarmonics.CrankshaftOrderHz = (7200.0f / 60.0f) * 3.0f; // 6-cyl @ 7200 RPM = 360 Hz
    AudioSnap.ActiveSourceCount                     = 1u;
    AudioSnap.Sources[0]                            = ApproachingCar;
    AudioBridge.Publish(AudioSnap);
    Audio::AcousticFrameSnapshot TakenAudio{};
    const bool AudioBridgeOk = AudioBridge.Take(TakenAudio);

    std::snprintf(Buf, sizeof(Buf),
                  "FG_units=%u, barriers=%u, VRAM_saved=%.1f%%, RT_frames=%llu; Doppler(in=%.3f, out=%.3f, pan=%.2f)",
                  FgMetrics.ResolvedUnitCount, FgMetrics.TotalBarrierCount,
                  FgMetrics.MemorySavingsFraction * 100.0,
                  static_cast<unsigned long long>(RtDiag.RenderedFrames),
                  AppMetrics.DopplerPitchShift, RecMetrics.DopplerPitchShift, AppMetrics.StereoPanLeftRight);
    VerifyCondition(FgCompiled && FgMetrics.ResolvedUnitCount == 5u &&
                    FgMetrics.MemorySavingsFraction >= 0.20 &&
                    RtStarted && RtDiag.RenderedFrames == 12u && RenderThreadRecordedUnits.load() == 60u &&
                    AppMetrics.DopplerPitchShift > 1.10f && RecMetrics.DopplerPitchShift < 0.92f &&
                    AppMetrics.StereoPanLeftRight > 0.30f &&
                    AudioBridgeOk && TakenAudio.FrameOrdinal == 42u,
                    "CompiledFrameGraphPlan VRAM aliasing, DedicatedRenderThread & AudioFoundation Doppler", Buf);
}

} // namespace

int main()
{
    std::printf("TAP version 13\n");
    std::printf("# Frontier Engine Systems End-to-End Physical & Architectural Verification\n");

    VerifyPlumeAndSmokePhysics();
    VerifyTyreThermodynamicsAndIgnitionFix();
    VerifyPropulsionChemistryAndTopologies();
    VerifyCloudGatedWeatherAndWindField();
    VerifyEngineNetworking();
    VerifyTaskGraphFrameGraphAndAudio();

    std::printf("1..%d\n", TotalChecks);
    std::printf("# Summary: %d/%d checks passed.\n", PassedChecks, TotalChecks);
    return (PassedChecks == TotalChecks) ? EXIT_SUCCESS : EXIT_FAILURE;
}
