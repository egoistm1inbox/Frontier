/*==========================================================================================================================================
                                                        SURFACEOPTICSPROFILE.H
==========================================================================================================================================*/
// 🧩 Shared physically based surface optics and GI participation profile.

#pragma once

#include <array>
#include <cstdint>

namespace Frontier
{

struct SurfaceOpticsProfile
{
    bool                 Enabled                     = true;
    std::array<float, 3> AlbedoRgb                   = { 0.74f, 0.77f, 0.81f };
    float                Roughness                   = 0.38f;
    float                Metallic                    = 0.08f;
    float                IndexOfRefraction           = 1.50f;
    float                EmissiveStrength            = 0.0f;
    bool                 CastShadows                 = true;
    bool                 ReceiveGlobalIllumination   = true;
    uint64_t             Revision                    = 0;

    void AdvanceRevision() noexcept { ++Revision; }
};

} // namespace Frontier
