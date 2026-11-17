/*==========================================================================================================================================
                                                             CONSTANTS.H
==========================================================================================================================================*/
// 🧩 Single consolidated source of mathematical and physical constants across Frontier Engine and Extensions.

#pragma once

#include <cmath>
#include <concepts>
#include <numbers>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                 MATHEMATICAL CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

template <std::floating_point ScalarT>
struct MathematicalConstants
{
    static constexpr ScalarT Pi               = std::numbers::pi_v<ScalarT>;
    static constexpr ScalarT TwoPi            = static_cast<ScalarT>(2) * Pi;
    static constexpr ScalarT Tau              = TwoPi;
    static constexpr ScalarT HalfPi           = static_cast<ScalarT>(0.5) * Pi;
    static constexpr ScalarT QuarterPi        = static_cast<ScalarT>(0.25) * Pi;
    static constexpr ScalarT InversePi        = std::numbers::inv_pi_v<ScalarT>;
    static constexpr ScalarT InverseTwoPi     = static_cast<ScalarT>(0.5) * InversePi;
    static constexpr ScalarT DegreesToRadians = Pi / static_cast<ScalarT>(180);
    static constexpr ScalarT RadiansToDegrees = static_cast<ScalarT>(180) / Pi;
    static constexpr ScalarT GoldenRatio      = std::numbers::phi_v<ScalarT>;
    static constexpr ScalarT Epsilon          = static_cast<ScalarT>(1.0e-6);
    static constexpr ScalarT HighPrecisionEps = static_cast<ScalarT>(1.0e-12);
};

using MathConstantsF = MathematicalConstants<float>;
using MathConstantsD = MathematicalConstants<double>;

//------------------------------------------------------------------------------------------------------------------------
//                                                  PHYSICAL CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

template <std::floating_point ScalarT>
struct PhysicalConstants
{
    static constexpr ScalarT StandardGravityMps2             = static_cast<ScalarT>(9.80665);          // [m/s^2]
    static constexpr ScalarT StandardAtmosphericPressurePa   = static_cast<ScalarT>(101325.0);         // [Pa]
    static constexpr ScalarT StandardSeaLevelDensityKgM3     = static_cast<ScalarT>(1.225);            // [kg/m^3]
    static constexpr ScalarT UniversalGasConstantJPerMolK    = static_cast<ScalarT>(8.314462618);      // [J/(mol*K)]
    static constexpr ScalarT StefanBoltzmannWPerM2K4         = static_cast<ScalarT>(5.670374419e-8);   // [W/(m^2*K^4)]
    static constexpr ScalarT SpeedOfLightMps                 = static_cast<ScalarT>(299792458.0);      // [m/s]
    static constexpr ScalarT KelvinZeroCelsius               = static_cast<ScalarT>(273.15);           // [K]
    static constexpr ScalarT StandardAmbientTemperatureK     = static_cast<ScalarT>(293.15);           // [K] 20 C
    static constexpr ScalarT AstronomicalUnitMetres          = static_cast<ScalarT>(149597870700.0);   // [m]
    static constexpr ScalarT EarthMeanRadiusMetres           = static_cast<ScalarT>(6371000.0);        // [m]
    static constexpr ScalarT WaterDensityKgM3                = static_cast<ScalarT>(998.2);            // [kg/m^3]
    static constexpr ScalarT AirDynamicViscosityPaS          = static_cast<ScalarT>(1.81e-5);          // [Pa*s]
};

using PhysicsConstantsF = PhysicalConstants<float>;
using PhysicsConstantsD = PhysicalConstants<double>;

//------------------------------------------------------------------------------------------------------------------------
//                                                  ANGLE HELPERS
//------------------------------------------------------------------------------------------------------------------------

template <std::floating_point ScalarT>
[[nodiscard]] constexpr ScalarT DegreesToRadians(ScalarT Degrees) noexcept
{
    return Degrees * MathematicalConstants<ScalarT>::DegreesToRadians;
}

template <std::floating_point ScalarT>
[[nodiscard]] constexpr ScalarT RadiansToDegrees(ScalarT Radians) noexcept
{
    return Radians * MathematicalConstants<ScalarT>::RadiansToDegrees;
}

template <std::floating_point ScalarT>
[[nodiscard]] inline ScalarT WrapAngleDegrees360(ScalarT Degrees) noexcept
{
    ScalarT Wrapped = std::fmod(Degrees, static_cast<ScalarT>(360));
    if (Wrapped < static_cast<ScalarT>(0))
    {
        Wrapped += static_cast<ScalarT>(360);
    }
    return Wrapped;
}

template <std::floating_point ScalarT>
[[nodiscard]] inline ScalarT WrapAngleRadiansSigned(ScalarT Radians) noexcept
{
    return std::remainder(Radians, MathematicalConstants<ScalarT>::TwoPi);
}

} // namespace Frontier
