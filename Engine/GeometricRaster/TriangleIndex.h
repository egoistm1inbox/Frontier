//============================================================================================================================================
//                                                    TRIANGLEINDEX.H
//============================================================================================================================================
// CPU-owned flat scene records shared by SceneCodec, VisibilityRaster and the Vulkan upload boundary. Keeping these
// records below DeviceExchange lets the headless CPU proof build without a Vulkan SDK or driver.

#pragma once

#include <cstdint>
#include <string>

namespace Frontier {

struct TriangleIndex
{
    float    VertexAlphaX,  VertexAlphaY,  VertexAlphaZ;
    float    MaterialSlot;
    float    VertexBetaX,   VertexBetaY,   VertexBetaZ;
    float    TextureGammaU;
    float    VertexGammaX,  VertexGammaY, VertexGammaZ;
    float    TextureGammaV;
    float    TextureAlphaU, TextureAlphaV;
    float    TextureBetaU,  TextureBetaV;
};
static_assert(sizeof(TriangleIndex) == 64u, "TriangleIndex must be 64 bytes (std430 mirror)");

struct TriangleSpanRecord
{
    uint32_t    FirstTriangle = 0u;
    uint32_t    TriangleCount = 0u;
    std::string Name;
    bool        Dynamic = false;
};

} // namespace Frontier
