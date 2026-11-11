/*============================================================================================================================================
                                                  FASTSURFACELIGHTING.H
============================================================================================================================================*/
// 🧩 Portable CPU reference calculations matching the GPU Blinn-Phong, matcap layering, and directional-shadow shader

#pragma once

//------------------------------------------------------------------------------------------------------------------------
//                                                        INCLUDES
//------------------------------------------------------------------------------------------------------------------------

#include "Engine/UVSpace/SurfaceAppearanceLayout.h"

#include <span>

namespace Frontier::GeometricRaster
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     STRUCTURES
//------------------------------------------------------------------------------------------------------------------------

struct ViewVector3
{
    float X = 0.0f; // [-] - Horizontal Cartesian component
    float Y = 0.0f; // [-] - Vertical Cartesian component
    float Z = 1.0f; // [-] - Depth Cartesian component
};

struct SurfaceLightingSample
{
    ViewVector3                NormalInViewSpace       = { 0.0f, 0.0f, 1.0f }; // [-]   - Normalized facet normal in view space
    ViewVector3                ViewerVector            = { 0.0f, 0.0f, 1.0f }; // [-]   - Direction from surface toward camera
    ViewVector3                LightVector             = { 0.0f, 0.0f, 1.0f }; // [-]   - Direction from surface toward directional light
    UVSpace::ColorTriplet      AmbientIlluminance      = { 0.04f, 0.04f, 0.04f }; // [0-1+] - Unshadowed ambient radiance
    UVSpace::ColorTriplet      DirectionalIlluminance  = { 1.0f, 1.0f, 1.0f }; // [0-1+] - Directional-light radiance
    float                      ShadowVisibility        = 1.0f;                  // [0-1] - Filtered directional shadow result
};

struct MatcapTextureCoordinate
{
    float U = 0.5f; // [0-1] - Horizontal matcap sample coordinate
    float V = 0.5f; // [0-1] - Vertical matcap sample coordinate
};

struct SurfaceLightingResult
{
    UVSpace::ColorTriplet  Radiance                 = {}; // [0-1+] - Linear surface radiance before display conversion
    MatcapTextureCoordinate MatcapCoordinate        = {}; // [0-1]   - Shared camera-space matcap sample coordinate
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  FUNCTION PROTOTYPES
//------------------------------------------------------------------------------------------------------------------------

[[nodiscard]] MatcapTextureCoordinate ConstructMatcapTextureCoordinate(ViewVector3 NormalInViewSpace) noexcept;

[[nodiscard]] SurfaceLightingResult EvaluateFastSurfaceLighting(
    const SurfaceLightingSample&                        LightingSample,
    std::span<const UVSpace::SurfaceAppearance>         OrderedAppearances,
    std::span<const UVSpace::ColorTriplet>              MatcapImageColours) noexcept;

} // namespace Frontier::GeometricRaster
