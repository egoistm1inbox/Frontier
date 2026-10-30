/*==========================================================================================================================================
                                                 SOLARSKYENVIRONMENTPAYLOAD.H
==========================================================================================================================================*/
// 🧩 Coupled Bruneton/Hillaire atmospheric sky, limb-darkened solar disc, and cloud-slab payload for path replay.

#pragma once

#include "AtmosphereModel.h"

#include <array>
#include <cstdint>
#include <span>

namespace Frontier
{

inline constexpr std::uint32_t SkyRadiancePayloadFloats = 20u;   // [-] - five float4 records after camera block

struct SkyRadianceSpecification
{
    AtmosphereParameters Atmosphere        = {};                         // [-] - Rayleigh, Mie, and ozone medium
    SpatialVector        SolarDirection    = {0.32, 0.86, 0.39799497};   // [-] - unit vector toward solar disc centre
    SpatialVector        ZenithDirection   = {0.0, 1.0, 0.0};            // [-] - local planet-up unit vector
    SpectrumRgb          SolarIrradiance   = {18.5, 18.0, 17.2};         // [W/m^2] - top-of-atmosphere solar irradiance
    double               SolarAngularRadius = 0.00465421;                // [rad] - apparent solar half-angle (~0.2667 deg)
    double               ObserverAltitudeKm = 0.05;                      // [km] - observer elevation above sea level
    double               LimbDarkeningU1    = 0.397;                     // [-] - linear solar limb-darkening coefficient
    double               LimbDarkeningU2    = 0.196;                     // [-] - quadratic limb-darkening coefficient
    double               MultipleScatterScale = 1.0;                     // [-] - second-order scattering multiplier
    double               CloudBaseKm        = 1.6;                       // [km] - lower altitude of stratus/cumulus slab
    double               CloudTopKm         = 2.4;                       // [km] - upper altitude of stratus/cumulus slab
    double               CloudExtinctionKm  = 0.0;                       // [1/km] - peak slab optical extinction (0 = clear)
    double               CloudCoverage      = 0.0;                       // [-] - spatial cloud coverage fraction [0, 1]
};

//------------------------------------------------------------------------------------------------------------------------
//                                           PAYLOAD COMPILATION AND VALIDATION
//------------------------------------------------------------------------------------------------------------------------

[[nodiscard]] std::array<float, SkyRadiancePayloadFloats> CompileSkyRadiancePayload(
    const SkyRadianceSpecification& Specification);

void ValidateSkyRadiancePayload(std::span<const float> Payload);

//------------------------------------------------------------------------------------------------------------------------
//                                           REFERENCE RADIANCE AND IRRADIANCE
//------------------------------------------------------------------------------------------------------------------------

[[nodiscard]] double EvaluateCloudSlabTransmittance(const SkyRadianceSpecification& Specification,
                                                    SpatialVector                           OriginMeters,
                                                    SpatialVector                           Direction) noexcept;

[[nodiscard]] SpectrumRgb EvaluateSkyContinuumRadiance(const SkyRadianceSpecification& Specification,
                                                            SpatialVector                           OriginMeters,
                                                            SpatialVector                           Direction,
                                                            std::uint32_t                           Steps = 32u) noexcept;

[[nodiscard]] SpectrumRgb EvaluateSolarDiscLimbRadiance(const SkyRadianceSpecification& Specification,
                                                        SpatialVector                           OriginMeters,
                                                        SpatialVector                           Direction,
                                                        std::uint32_t                           Steps = 48u) noexcept;

[[nodiscard]] SpectrumRgb EvaluateSkyTotalRadiance(const SkyRadianceSpecification& Specification,
                                                        SpatialVector                           OriginMeters,
                                                        SpatialVector                           Direction,
                                                        std::uint32_t                           Steps = 32u) noexcept;

[[nodiscard]] SpectrumRgb IntegrateSolarDiscIrradiance(const SkyRadianceSpecification& Specification,
                                                       SpatialVector                           OriginMeters,
                                                       SpatialVector                           SurfaceNormal,
                                                       std::uint32_t                           RadialRings    = 32u,
                                                       std::uint32_t                           AzimuthSectors = 64u) noexcept;

} // namespace Frontier
