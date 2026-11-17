/*==========================================================================================================================================
                                                      THERMALCHEMICALPROFILES.H
==========================================================================================================================================*/
// 🧩 Shared thermodynamic and chemical reaction kinetics profiles built on PhysicalConstants.

#pragma once

#include "Frontier/Engine/Foundation/Constants.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace Frontier
{

enum class MatterPhase : uint8_t
{
    Solid  = 0,
    Liquid = 1,
    Gas    = 2,
    Plasma = 3,
};

struct ThermalProfile
{
    bool     Enabled                 = true;
    double   TemperatureKelvin       = 293.15;
    double   SpecificHeatJPerKgK     = 900.0;
    double   ThermalConductivityWPerMK = 205.0;
    double   SurfaceEmissivity       = 0.85;
    bool     RadiativeCooling        = true;
    uint64_t Revision                = 0;

    void AdvanceRevision() noexcept { ++Revision; }

    [[nodiscard]] double TemperatureCelsius() const noexcept
    {
        return TemperatureKelvin - PhysicsConstantsD::KelvinZeroCelsius;
    }

    void ConfigureCelsius(double Celsius) noexcept
    {
        TemperatureKelvin = std::max(0.01, Celsius + PhysicsConstantsD::KelvinZeroCelsius);
        AdvanceRevision();
    }

    [[nodiscard]] double SensibleHeatJoules(double MassKilograms, double ReferenceKelvin = 293.15) const noexcept
    {
        return MassKilograms * SpecificHeatJPerKgK * (TemperatureKelvin - ReferenceKelvin);
    }

    [[nodiscard]] double RadiativeFluxWPerM2() const noexcept
    {
        const double T2 = TemperatureKelvin * TemperatureKelvin;
        return std::clamp(SurfaceEmissivity, 0.0, 1.0) * PhysicsConstantsD::StefanBoltzmannWPerM2K4 * T2 * T2;
    }
};

struct ChemicalProfile
{
    bool        Enabled                    = true;
    double      MolarMassGramsPerMole      = 18.015;
    double      AmountMoles                = 2.0;
    double      ConcentrationMolPerLitre   = 1.0;
    double      ActivationEnergyKjPerMol   = 48.5;
    double      PreExponentialFactorPerSec = 1.0e5;
    double      EnthalpyDeltaKjPerMol      = -57.1;
    MatterPhase Phase                      = MatterPhase::Liquid;
    bool        ReversibleEquilibrium      = true;
    bool        CatalyzedPathway           = false;
    uint64_t    Revision                   = 0;

    void AdvanceRevision() noexcept { ++Revision; }

    [[nodiscard]] double SubstanceMassKilograms() const noexcept
    {
        return std::max(0.0, AmountMoles * MolarMassGramsPerMole * 1.0e-3);
    }

    [[nodiscard]] double ArrheniusRateConstant(double TemperatureKelvin) const noexcept
    {
        const double SafeKelvin = std::max(1.0, TemperatureKelvin);
        const double EffectiveEa =
            (CatalyzedPathway ? ActivationEnergyKjPerMol * 0.65 : ActivationEnergyKjPerMol) * 1000.0;
        return PreExponentialFactorPerSec *
               std::exp(-EffectiveEa / (PhysicsConstantsD::UniversalGasConstantJPerMolK * SafeKelvin));
    }

    [[nodiscard]] double ReactionHeatKilojoules() const noexcept
    {
        return AmountMoles * EnthalpyDeltaKjPerMol;
    }
};

} // namespace Frontier
