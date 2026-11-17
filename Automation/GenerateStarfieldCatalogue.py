import math

# Real prominent astronomical stars (RA deg, Dec deg, Visual Magnitude, Linear RGB)
PROMINENT_STARS = [
    ("Sirius", 101.287, -16.716, -1.46, (0.95, 0.98, 1.0)),
    ("Canopus", 95.988, -52.696, -0.74, (1.0, 0.98, 0.95)),
    ("Rigil Kentaurus", 219.902, -60.834, -0.01, (1.0, 0.94, 0.82)),
    ("Arcturus", 213.915, 19.182, -0.05, (1.0, 0.78, 0.48)),
    ("Vega", 279.235, 38.784, 0.03, (0.93, 0.96, 1.0)),
    ("Capella", 79.172, 45.998, 0.08, (1.0, 0.92, 0.75)),
    ("Rigel", 78.634, -8.202, 0.13, (0.85, 0.92, 1.0)),
    ("Procyon", 114.825, 5.225, 0.38, (1.0, 0.97, 0.92)),
    ("Achernar", 24.429, -57.237, 0.46, (0.84, 0.90, 1.0)),
    ("Betelgeuse", 88.793, 7.407, 0.50, (1.0, 0.65, 0.35)),
    ("Hadar", 210.956, -60.373, 0.61, (0.82, 0.88, 1.0)),
    ("Altair", 297.696, 8.868, 0.76, (0.98, 0.98, 1.0)),
    ("Acrux", 186.650, -63.099, 0.76, (0.80, 0.86, 1.0)),
    ("Aldebaran", 68.980, 16.509, 0.85, (1.0, 0.70, 0.38)),
    ("Antares", 247.352, -26.432, 1.06, (1.0, 0.58, 0.28)),
    ("Spica", 201.298, -11.161, 0.97, (0.82, 0.88, 1.0)),
    ("Pollux", 116.166, 28.026, 1.14, (1.0, 0.82, 0.58)),
    ("Fomalhaut", 344.413, -29.622, 1.16, (0.98, 0.99, 1.0)),
    ("Deneb", 310.358, 45.280, 1.25, (0.96, 0.98, 1.0)),
    ("Mimosa", 191.930, -59.689, 1.25, (0.80, 0.86, 1.0)),
    ("Regulus", 152.093, 11.967, 1.35, (0.88, 0.93, 1.0)),
    ("Adhara", 104.656, -28.972, 1.50, (0.82, 0.88, 1.0)),
    ("Castor", 113.650, 31.888, 1.58, (0.98, 0.99, 1.0)),
    ("Gacrux", 187.791, -57.113, 1.63, (1.0, 0.62, 0.32)),
    ("Shaula", 263.402, -37.104, 1.62, (0.81, 0.87, 1.0)),
    ("Bellatrix", 81.283, 6.350, 1.64, (0.82, 0.88, 1.0)),
    ("Elnath", 81.573, 28.608, 1.65, (0.89, 0.94, 1.0)),
    ("Miaplacidus", 138.300, -69.717, 1.68, (0.97, 0.98, 1.0)),
    ("Alnilam", 84.053, -1.202, 1.69, (0.80, 0.86, 1.0)),
    ("Alnitak", 85.190, -1.943, 1.77, (0.80, 0.86, 1.0)),
    ("Alioth", 193.507, 55.960, 1.77, (0.98, 0.99, 1.0)),
    ("Kaus Australis", 276.043, -34.384, 1.85, (0.88, 0.93, 1.0)),
    ("Mirfak", 51.081, 49.861, 1.81, (1.0, 0.97, 0.92)),
    ("Dubhe", 165.932, 61.751, 1.79, (1.0, 0.78, 0.48)),
    ("Regor", 122.383, -47.337, 1.81, (0.80, 0.86, 1.0)),
    ("Wezen", 107.098, -26.393, 1.83, (1.0, 0.96, 0.85)),
    ("Alkaid", 206.885, 49.313, 1.86, (0.81, 0.87, 1.0)),
    ("Sargas", 264.329, -42.998, 1.87, (1.0, 0.92, 0.75)),
    ("Avior", 125.628, -59.509, 1.86, (1.0, 0.70, 0.38)),
    ("Menkalinan", 89.882, 44.947, 1.90, (0.98, 0.99, 1.0)),
    ("Atria", 252.166, -69.028, 1.92, (1.0, 0.68, 0.35)),
    ("Alhena", 99.428, 16.399, 1.93, (0.98, 0.99, 1.0)),
    ("Peacock", 306.412, -56.735, 1.94, (0.82, 0.88, 1.0)),
    ("Alsephina", 131.182, -54.710, 1.96, (0.98, 0.99, 1.0)),
    ("Mirzam", 95.675, -17.956, 1.98, (0.81, 0.87, 1.0)),
    ("Alphard", 141.696, -8.659, 1.98, (1.0, 0.72, 0.40)),
    ("Polaris", 37.954, 89.264, 1.98, (1.0, 0.96, 0.88)),
    ("Hamal", 31.793, 23.462, 2.01, (1.0, 0.78, 0.48)),
]

stars = []
for name, ra_deg, dec_deg, mag, col in PROMINENT_STARS:
    ra = math.radians(ra_deg)
    dec = math.radians(dec_deg)
    ux = math.cos(dec) * math.cos(ra)
    uy = math.cos(dec) * math.sin(ra)
    uz = math.sin(dec)
    stars.append({
        "name": name,
        "dir": (ux, uy, uz),
        "mag": mag,
        "color": col,
        "twinkle": (ra_deg * 37.0 + dec_deg * 19.0) % 100.0 / 100.0
    })

print(f"Generated {len(stars)} astronomical catalogue stars.")

# C++ Header
cpp_path = "Engine/GeometricRaster/Atmosphere/AstronomicalStarfieldCatalogue.h"
with open(cpp_path, "w") as f:
    f.write(f"""/*============================================================================================================================================
                                                  ASTRONOMICALSTARFIELDCATALOGUE.H
============================================================================================================================================*/
// Fixed astronomical star catalogue ({len(stars)} prominent stars) + Spherical Celestial Coordinate Frame

#pragma once

#include <array>
#include <cstdint>

namespace Frontier::GeometricRaster
{{

struct AstronomicalStarRecord
{{
    float DirX;
    float DirY;
    float DirZ;
    float Magnitude;
    float ColorR;
    float ColorG;
    float ColorB;
    float TwinkleSeed;
}};

struct AstronomicalCatalogueTable
{{
    static constexpr uint32_t StarCount = {len(stars)}u;
    static const std::array<AstronomicalStarRecord, {len(stars)}>& QueryStars() noexcept;
}};

}} // namespace Frontier::GeometricRaster
""")

cpp_impl_path = "Engine/GeometricRaster/Atmosphere/AstronomicalStarfieldCatalogue.cpp"
with open(cpp_impl_path, "w") as f:
    f.write(f"""/*============================================================================================================================================
                                                 ASTRONOMICALSTARFIELDCATALOGUE.CPP
============================================================================================================================================*/
// Implementation of fixed astronomical star catalogue table

#include "Engine/GeometricRaster/Atmosphere/AstronomicalStarfieldCatalogue.h"

namespace Frontier::GeometricRaster
{{

namespace
{{

const std::array<AstronomicalStarRecord, {len(stars)}> StaticStars = {{{{
""")
    for s in stars:
        d = s["dir"]
        c = s["color"]
        f.write(f"    {{ {d[0]:.7f}f, {d[1]:.7f}f, {d[2]:.7f}f, {s['mag']:.2f}f, {c[0]:.3f}f, {c[1]:.3f}f, {c[2]:.3f}f, {s['twinkle']:.4f}f }},\n")
    f.write(f"""}}}};

}} // namespace

const std::array<AstronomicalStarRecord, {len(stars)}>& AstronomicalCatalogueTable::QueryStars() noexcept
{{
    return StaticStars;
}}

}} // namespace Frontier::GeometricRaster
""")

slang_path = "Engine/Shaders/Atmosphere/AstronomicalStarfieldCatalogue.slang"
with open(slang_path, "w") as f:
    f.write(f"""/*============================================================================================================================================
                                                 ASTRONOMICALSTARFIELDCATALOGUE.SLANG
============================================================================================================================================*/
// Fixed astronomical star catalogue ({len(stars)} prominent navigation stars) for GPU Compute

module AstronomicalStarfieldCatalogue;

static const uint AstroStarCount = {len(stars)}u;

struct AstroGpuStar
{{
    float4 DirMag;       // xyz = UnitDir, w = Magnitude
    float4 ColorTwinkle; // xyz = LinearColor, w = TwinkleSeed
}};

static const AstroGpuStar FixedAstroStars[{len(stars)}] = {{
""")
    for s in stars:
        d = s["dir"]
        c = s["color"]
        f.write(f"    {{ float4({d[0]:.7f}, {d[1]:.7f}, {d[2]:.7f}, {s['mag']:.2f}), float4({c[0]:.3f}, {c[1]:.3f}, {c[2]:.3f}, {s['twinkle']:.4f}) }},\n")
    f.write("""};
""")

print("Successfully written C++ and Slang files.")
