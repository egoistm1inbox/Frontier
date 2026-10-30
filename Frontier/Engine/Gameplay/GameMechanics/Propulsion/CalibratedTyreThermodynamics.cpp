/*==========================================================================================================================================
                                                CALIBRATEDTYRETHERMODYNAMICS.CPP
==========================================================================================================================================*/
// 🧩 Calibrated 3-node tyre thermodynamics, GRIT .tyrx compounds, rotational forced convection, radiation, pyrolysis, and aquaplaning.

#include "Engine/Gameplay/GameMechanics/Propulsion/CalibratedTyreThermodynamics.h"

#include <algorithm>
#include <cmath>

namespace Frontier::Propulsion
{

namespace
{

constexpr double PiVal                  = 3.14159265358979323846;
constexpr double StefanBoltzmannConst   = 5.670374419e-8; // [W/(m^2*K^4)]
constexpr double DryAirGasConstJkgK     = 287.058;        // [J/(kg*K)]
constexpr double DryAirCvJkgK           = 718.0;          // [J/(kg*K)]

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

CalibratedTyreCompoundSpec ConstructGritTyreCompound(GritTyreCompoundPreset Preset)
{
    CalibratedTyreCompoundSpec C{};
    // Calibrated outer cap (~1.55 kg active tread rubber = 2950 J/K) + strong belt-to-carcass conduction (88 W/K):
    // produces white smoke at ~5-7 s of full burnout and delays open-flame auto-ignition to ~34-44 s of continuous WOT burnout!
    C.TreadBeltHeatCapacityJK   = 2950.0;
    C.CarcassBulkHeatCapacityJK = 15800.0;
    C.TreadToCarcassConductanceWK = 88.0;

    switch (Preset)
    {
    case GritTyreCompoundPreset::Gt3SlickDry:
        C.Name                         = "Gt3SlickDry";
        C.OuterRadiusMetres            = 0.340;
        C.TreadWidthMetres             = 0.315;
        C.InitialTreadDepthMillimetres = 3.0;
        C.ColdInflationGaugePa         = 185000.0;
        C.ForcedConvectionCoeffWM2K    = 48.0;
        C.PeakLongitudinalMu           = 1.68;
        C.ColdGripFloor                = 0.74;
        C.OptimumWindowLowKelvin       = 358.15;
        C.OptimumWindowHighKelvin      = 383.15;
        C.BlisterFadeKelvin            = 493.15;
        C.HotBlisterGripFloor          = 0.56;
        C.AutoIgnitionThresholdKelvin  = 683.15;
        C.RequiredIgnitionIntegralSec  = 14.0;
        break;

    case GritTyreCompoundPreset::Lmp3EnduranceSlick:
        C.Name                         = "Lmp3EnduranceSlick";
        C.OuterRadiusMetres            = 0.345;
        C.TreadWidthMetres             = 0.325;
        C.InitialTreadDepthMillimetres = 3.2;
        C.ColdInflationGaugePa         = 190000.0;
        C.ForcedConvectionCoeffWM2K    = 50.0;
        C.PeakLongitudinalMu           = 1.64;
        C.ColdGripFloor                = 0.72;
        C.OptimumWindowLowKelvin       = 363.15;
        C.OptimumWindowHighKelvin      = 390.15;
        C.BlisterFadeKelvin            = 505.15;
        C.HotBlisterGripFloor          = 0.58;
        C.AbrasionWearKgPerJoule       = 3.4e-8;
        C.AutoIgnitionThresholdKelvin  = 693.15;
        C.RequiredIgnitionIntegralSec  = 15.0;
        break;

    case GritTyreCompoundPreset::GtmSuperSticky200Tw:
        C.Name                         = "GtmSuperSticky200Tw";
        C.OuterRadiusMetres            = 0.338;
        C.TreadWidthMetres             = 0.285;
        C.InitialTreadDepthMillimetres = 5.5;
        C.ColdInflationGaugePa         = 220000.0;
        C.ForcedConvectionCoeffWM2K    = 44.0;
        C.PeakLongitudinalMu           = 1.38;
        C.ColdGripFloor                = 0.84;
        C.OptimumWindowLowKelvin       = 338.15;
        C.OptimumWindowHighKelvin      = 371.15;
        C.BlisterFadeKelvin            = 478.15;
        C.HotBlisterGripFloor          = 0.57;
        C.AutoIgnitionThresholdKelvin  = 678.15;
        C.RequiredIgnitionIntegralSec  = 13.5;
        break;

    case GritTyreCompoundPreset::StreetDriftSemiSlick:
        C.Name                         = "StreetDriftSemiSlick";
        C.OuterRadiusMetres            = 0.334;
        C.TreadWidthMetres             = 0.265;
        C.InitialTreadDepthMillimetres = 7.4;
        C.ColdInflationGaugePa         = 250000.0;
        C.TreadBeltHeatCapacityJK      = 3350.0; // Deeper sacrificial drift tread block
        C.ForcedConvectionCoeffWM2K    = 42.0;
        C.PeakLongitudinalMu           = 1.22;
        C.ColdGripFloor                = 0.88;
        C.OptimumWindowLowKelvin       = 333.15;
        C.OptimumWindowHighKelvin      = 378.15;
        C.BlisterFadeKelvin            = 498.15;
        C.HotBlisterGripFloor          = 0.62;
        C.WearableTreadMassKg          = 3.20;
        C.AutoIgnitionThresholdKelvin  = 688.15;
        C.RequiredIgnitionIntegralSec  = 16.0;
        break;

    case GritTyreCompoundPreset::RallyGravelSoft:
        C.Name                         = "RallyGravelSoft";
        C.OuterRadiusMetres            = 0.330;
        C.TreadWidthMetres             = 0.215;
        C.InitialTreadDepthMillimetres = 11.5;
        C.ColdInflationGaugePa         = 195000.0;
        C.ForcedConvectionCoeffWM2K    = 46.0;
        C.PeakLongitudinalMu           = 1.15;
        C.ColdGripFloor                = 0.92;
        C.OptimumWindowLowKelvin       = 318.15;
        C.OptimumWindowHighKelvin      = 358.15;
        C.BlisterFadeKelvin            = 458.15;
        C.HotBlisterGripFloor          = 0.54;
        C.AutoIgnitionThresholdKelvin  = 673.15;
        C.RequiredIgnitionIntegralSec  = 13.0;
        break;
    }
    return C;
}

CalibratedTyreThermodynamics::CalibratedTyreThermodynamics(const CalibratedTyreCompoundSpec& Compound)
    : Spec_(Compound)
{
    ResetCold(293.15, 101325.0);
}

void CalibratedTyreThermodynamics::ResetCold(double AmbientKelvin, double AtmosphericPa) noexcept
{
    const double AmbK = std::clamp(AmbientKelvin, 230.0, 340.0);
    const double AtmP = std::max(50000.0, AtmosphericPa);

    PreviousVolumeM3_     = std::max(0.010, Spec_.EnclosedGasVolumeM3);
    EnclosedAirMassKg_    = (Spec_.ColdInflationGaugePa + AtmP) * PreviousVolumeM3_ / (DryAirGasConstJkgK * AmbK);
    RemainingTreadMassKg_ = std::max(0.2, Spec_.WearableTreadMassKg);
    RemainingFuelMassKg_  = std::max(0.2, Spec_.CombustibleCarcassMassKg);

    Telemetry_                            = CalibratedTyreWheelTelemetry{};
    Telemetry_.TreadSurfaceKelvin         = AmbK;
    Telemetry_.ContactPatchFlashKelvin    = AmbK;
    Telemetry_.CarcassBulkKelvin          = AmbK;
    Telemetry_.EnclosedGasKelvin          = AmbK;
    Telemetry_.GaugePressurePa            = Spec_.ColdInflationGaugePa;
    Telemetry_.RemainingTreadMillimetres  = Spec_.InitialTreadDepthMillimetres;
    Telemetry_.ThermalGripMultiplier      = Spec_.ColdGripFloor;
    Telemetry_.AquaplaningGripMultiplier  = 1.0;
    Telemetry_.CombinedGripMultiplier     = Spec_.ColdGripFloor;
}

CalibratedTyreWheelTelemetry CalibratedTyreThermodynamics::StepWheel(
    const CalibratedTyreStepInput& Input,
    double                         StepSeconds) noexcept
{
    const double Dt   = std::clamp(StepSeconds, 1.0e-5, 0.25);
    const double AmbK = std::clamp(Input.AmbientAirKelvin, 230.0, 345.0);
    const double RdK  = std::clamp(Input.RoadSurfaceKelvin, 230.0, 365.0);
    const double AtmP = std::max(50000.0, Input.AtmosphericPressurePa);
    const double Vol  = (Input.EnclosedVolumeOverrideM3 > 0.005) ? Input.EnclosedVolumeOverrideM3 : Spec_.EnclosedGasVolumeM3;

    // 1. Adiabatic gas compression/expansion work from carcass deflection.
    const double GammaGas = 1.0 + DryAirGasConstJkgK / DryAirCvJkgK;
    double TSurf          = Telemetry_.TreadSurfaceKelvin;
    double TCarc          = Telemetry_.CarcassBulkKelvin;
    double TGas           = Telemetry_.EnclosedGasKelvin * std::pow(PreviousVolumeM3_ / Vol, GammaGas - 1.0);
    PreviousVolumeM3_     = Vol;

    // 2. Peripheral wheel-spin + translational boundary-layer airflow!
    //    Fixes stationary burnout bug: spinning wheel at 115 rad/s * 0.34 m = 39 m/s sheds boundary-layer heat rapidly!
    const double PeripheralRimSpeedMps = std::abs(Input.WheelAngularVelocityRadSec) * Spec_.OuterRadiusMetres;
    const double EffectiveAirspeedMps  = std::hypot(std::max(0.0, Input.ChassisAirspeedMps), 0.82 * PeripheralRimSpeedMps);
    const double ExposedAreaM2         = 2.0 * PiVal * Spec_.OuterRadiusMetres * (Spec_.TreadWidthMetres + 0.11); // tread + sidewalls
    const double TurbulentNuScale      = std::pow(EffectiveAirspeedMps / 28.0, 0.78); // Nu ~ Re^0.8 turbulent boundary layer
    const double AirSurfaceCondWK      = Spec_.StillAirNaturalConvectionWK + Spec_.ForcedConvectionCoeffWM2K * ExposedAreaM2 * TurbulentNuScale;
    const double AirCarcassCondWK      = 3.5 + 0.18 * Spec_.ForcedConvectionCoeffWM2K * ExposedAreaM2 * TurbulentNuScale;

    // 3. Sliding dissipation (optionally applying current viscoelastic hot-grip fade when caller passes cold/raw slip power).
    double EffectiveSlipWatts = Input.Grounded ? std::max(0.0, Input.RawFrictionalSlipPowerWatts) : 0.0;
    if (Input.ApplyInternalThermalGripFade)
    {
        EffectiveSlipWatts *= Telemetry_.CombinedGripMultiplier;
    }

    // 4. Jaeger moving-heat-source contact-patch flash temperature + endothermic rubber pyrolysis smoke & Archard wear!
    const double ContactFlashK = TSurf + 0.00085 * EffectiveSlipWatts;
    const double OverOptKelvin = std::max(0.0, TSurf - Spec_.OptimumWindowHighKelvin);
    const double WearAccel     = 1.0 + (OverOptKelvin / 75.0) + 0.35 * std::pow(OverOptKelvin / 95.0, 2.0);
    const double WearKgPerSec  = (RemainingTreadMassKg_ > 1.0e-4)
        ? (Spec_.AbrasionWearKgPerJoule * WearAccel * EffectiveSlipWatts)
        : 0.0;
    RemainingTreadMassKg_ = std::max(0.0, RemainingTreadMassKg_ - WearKgPerSec * Dt);

    const double PyrolysisShare = SmoothStep01(Spec_.SmokePyrolysisOnsetKelvin - 25.0, Spec_.SmokePyrolysisOnsetKelvin + 75.0, ContactFlashK);
    const double VaporKgPerSec  = WearKgPerSec * (0.12 + 0.60 * PyrolysisShare);
    const double PyroCoolingW   = VaporKgPerSec * Spec_.PyrolysisLatentEnthalpyJPerKg;

    // 5. Stefan-Boltzmann grey-body thermal radiation: Q_rad = eps * sigma * A * (T_surf^4 - T_amb^4).
    const double RadCoolingW = std::max(
        0.0,
        Spec_.InfraredEmissivity * StefanBoltzmannConst * ExposedAreaM2 * (std::pow(TSurf, 4.0) - std::pow(AmbK, 4.0)));
    // Linearized radiative conductance for unconditionally stable backward-Euler implicit step!
    const double RadLinearCondWK = (TSurf > AmbK + 0.5) ? (RadCoolingW / (TSurf - AmbK)) : 0.0;

    // 6. Arrhenius thermal-oxidation auto-ignition integral (prevents premature 8-second burnout fire!).
    if (TSurf >= Spec_.AutoIgnitionThresholdKelvin - 32.0)
    {
        // Arrhenius rate = 1.0 at T_ign, rises exponentially above T_ign, slow pre-oxidation just below T_ign.
        const double ArrheniusRate = std::exp(std::clamp((TSurf - Spec_.AutoIgnitionThresholdKelvin) / 24.0, -3.0, 2.2));
        Telemetry_.ArrheniusIgnitionIntegral += ArrheniusRate * Dt;
    }
    else
    {
        // Rapidly quench radical accumulation when tyre cools below pyrolysis/oxidation zone!
        Telemetry_.ArrheniusIgnitionIntegral = std::max(0.0, Telemetry_.ArrheniusIgnitionIntegral - 1.8 * Dt);
    }

    if (RemainingFuelMassKg_ > 1.0e-4 && Telemetry_.ArrheniusIgnitionIntegral >= Spec_.RequiredIgnitionIntegralSec)
    {
        Telemetry_.IgnitedOnFire = true;
    }
    if (RemainingFuelMassKg_ <= 1.0e-4 || TSurf < Spec_.ExtinctionThresholdKelvin)
    {
        Telemetry_.IgnitedOnFire = false;
    }

    double CombustionTotalW = 0.0;
    if (Telemetry_.IgnitedOnFire)
    {
        const double BurnedKg = std::min(RemainingFuelMassKg_, Spec_.ActiveFlameBurnRateKgPerSec * Dt);
        RemainingFuelMassKg_ -= BurnedKg;
        CombustionTotalW      = (BurnedKg * Spec_.RubberCombustionEnthalpyJPerKg) / Dt;
    }

    // 7. Implicit 3x3 backward-Euler solve across [TreadBelt, CarcassBulk, EnclosedGas].
    const double LoadFactor     = Input.Grounded ? std::clamp(Input.NormalLoadNewtons / 3800.0, 0.25, 1.85) : 0.0;
    const double RoadCondWK     = Spec_.RoadContactConductanceWK * LoadFactor;
    const double SurfCarcWK     = Spec_.TreadToCarcassConductanceWK;
    const double CarcGasWK      = Spec_.CarcassToGasConductanceWK;
    const double GasCapJK       = std::max(8.0, EnclosedAirMassKg_ * DryAirCvJkgK);
    const double NetSourceWatts = std::max(0.0, EffectiveSlipWatts * Spec_.RubberSlidingHeatPartition + 0.10 * CombustionTotalW - PyroCoolingW);

    double M[3][4] = {
        {
            Spec_.TreadBeltHeatCapacityJK / Dt + AirSurfaceCondWK + RadLinearCondWK + RoadCondWK + SurfCarcWK,
            -SurfCarcWK,
            0.0,
            (Spec_.TreadBeltHeatCapacityJK / Dt) * TSurf + NetSourceWatts + (AirSurfaceCondWK + RadLinearCondWK) * AmbK + RoadCondWK * RdK
        },
        {
            -SurfCarcWK,
            Spec_.CarcassBulkHeatCapacityJK / Dt + AirCarcassCondWK + SurfCarcWK + CarcGasWK,
            -CarcGasWK,
            (Spec_.CarcassBulkHeatCapacityJK / Dt) * TCarc + AirCarcassCondWK * AmbK
        },
        {
            0.0,
            -CarcGasWK,
            GasCapJK / Dt + CarcGasWK,
            (GasCapJK / Dt) * TGas
        }
    };

    for (int Pivot = 0; Pivot < 3; ++Pivot)
    {
        const double Diag = M[Pivot][Pivot];
        for (int Col = Pivot; Col < 4; ++Col)
        {
            M[Pivot][Col] /= Diag;
        }
        for (int Row = 0; Row < 3; ++Row)
        {
            if (Row == Pivot)
            {
                continue;
            }
            const double Factor = M[Row][Pivot];
            for (int Col = Pivot; Col < 4; ++Col)
            {
                M[Row][Col] -= Factor * M[Pivot][Col];
            }
        }
    }

    TSurf = std::clamp(M[0][3], 220.0, 1250.0);
    TCarc = std::clamp(M[1][3], 220.0, 950.0);
    TGas  = std::clamp(M[2][3], 220.0, 750.0);

    // 8. Ideal-gas hot inflation pressure + viscoelastic thermal grip + NASA Horne aquaplaning.
    const double GaugePa = std::max(0.0, (EnclosedAirMassKg_ * DryAirGasConstJkgK * TGas) / Vol - AtmP);

    const double ColdWarmup = SmoothStep01(278.15, Spec_.OptimumWindowLowKelvin, TSurf);
    const double HotBlister = SmoothStep01(Spec_.OptimumWindowHighKelvin, Spec_.BlisterFadeKelvin, TSurf);
    const double TempGrip   = (Spec_.ColdGripFloor + (1.0 - Spec_.ColdGripFloor) * ColdWarmup) *
                              (1.0 - HotBlister * (1.0 - Spec_.HotBlisterGripFloor));

    // Optimal hot pressure is ~1.10 * cold pressure; severe under/over-inflation reduces contact patch uniformity.
    const double TargetHotPa = Spec_.ColdInflationGaugePa * 1.09;
    const double PressDev    = std::abs(GaugePa - TargetHotPa) / std::max(50000.0, TargetHotPa);
    const double PressGrip   = std::clamp(1.0 - 0.26 * PressDev, 0.55, 1.0);

    const double TreadFrac   = (Spec_.WearableTreadMassKg > 0.0) ? (RemainingTreadMassKg_ / Spec_.WearableTreadMassKg) : 0.0;
    const double TreadMm     = Spec_.InitialTreadDepthMillimetres * TreadFrac;

    // NASA Horne dynamic hydroplaning velocity: V_p [m/s] = (6.36 * sqrt(P_kPa) / 3.6) * GrooveEvacFactor
    double AquaGrip = 1.0;
    if (Input.StandingWaterFilmMillimetres > 0.15 && Input.Grounded)
    {
        const double PressKpa          = std::max(80.0, GaugePa * 1.0e-3);
        const double GrooveEvacBonus   = 0.80 + 0.16 * std::max(0.0, TreadMm - 2.2);
        const double ExcessWaterDepth  = std::max(0.0, Input.StandingWaterFilmMillimetres - 0.55 * TreadMm);
        const double HydroSpeedMps     = (6.36 * std::sqrt(PressKpa) / 3.6) * GrooveEvacBonus / (1.0 + 0.10 * ExcessWaterDepth);
        const double WetDampDamping    = 0.86; // baseline wet rubber boundary-lubrication reduction
        const double WedgeLiftFraction = SmoothStep01(0.68 * HydroSpeedMps, 1.12 * HydroSpeedMps, std::abs(Input.ChassisAirspeedMps));
        AquaGrip                       = WetDampDamping * (1.0 - 0.88 * WedgeLiftFraction);
    }

    Telemetry_.TreadSurfaceKelvin           = TSurf;
    Telemetry_.ContactPatchFlashKelvin      = TSurf + 0.00085 * EffectiveSlipWatts;
    Telemetry_.CarcassBulkKelvin            = TCarc;
    Telemetry_.EnclosedGasKelvin            = TGas;
    Telemetry_.GaugePressurePa              = GaugePa;
    Telemetry_.EffectiveBoundaryAirspeedMps = EffectiveAirspeedMps;
    Telemetry_.ForcedConvectionConductWK    = AirSurfaceCondWK;
    Telemetry_.RadiativeCoolingWatts        = RadCoolingW;
    Telemetry_.PyrolysisCoolingWatts        = PyroCoolingW;
    Telemetry_.SmokeVaporReleaseKgPerSec    = VaporKgPerSec;
    Telemetry_.ThermalGripMultiplier        = TempGrip * PressGrip;
    Telemetry_.AquaplaningGripMultiplier    = AquaGrip;
    Telemetry_.CombinedGripMultiplier       = Telemetry_.ThermalGripMultiplier * AquaGrip;
    Telemetry_.RemainingTreadMillimetres    = TreadMm;
    Telemetry_.CombustionHeatReleaseWatts   = CombustionTotalW;
    Telemetry_.EmittingPyrolysisSmoke       = (Telemetry_.ContactPatchFlashKelvin >= Spec_.SmokePyrolysisOnsetKelvin && EffectiveSlipWatts > 250.0);
    return Telemetry_;
}

} // namespace Frontier::Propulsion
