/*============================================================================================================================================
                                                  ASTRONOMICALSTARFIELDCATALOGUE.H
============================================================================================================================================*/
// Fixed astronomical star catalogue (48 prominent stars) + Spherical Celestial Coordinate Frame

#pragma once

#include <array>
#include <cstdint>

namespace Frontier::GeometricRaster
{

struct AstronomicalStarRecord
{
    float DirX;
    float DirY;
    float DirZ;
    float Magnitude;
    float ColorR;
    float ColorG;
    float ColorB;
    float TwinkleSeed;
};

struct AstronomicalCatalogueTable
{
    static constexpr uint32_t StarCount = 48u;
    static const std::array<AstronomicalStarRecord, 48>& QueryStars() noexcept;
};

} // namespace Frontier::GeometricRaster
