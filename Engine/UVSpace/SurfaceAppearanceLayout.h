/*============================================================================================================================================
                                                  SURFACEAPPEARANCELAYOUT.H
============================================================================================================================================*/
// 🧩 Facet-owned material layer registration with GPU-ready descriptors for Blinn-Phong lighting and stacked matcaps

#pragma once

//------------------------------------------------------------------------------------------------------------------------
//                                                        INCLUDES
//------------------------------------------------------------------------------------------------------------------------

#include <cstdint>
#include <limits>
#include <span>
#include <vector>

namespace Frontier::UVSpace
{

//------------------------------------------------------------------------------------------------------------------------
//                                                      CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

using AppearanceIdentifier = uint32_t;

inline constexpr AppearanceIdentifier InvalidAppearanceIdentifier = std::numeric_limits<AppearanceIdentifier>::max();
inline constexpr uint32_t             InvalidMatcapImageIndex     = std::numeric_limits<uint32_t>::max();

//------------------------------------------------------------------------------------------------------------------------
//                                                    ENUMERATIONS
//------------------------------------------------------------------------------------------------------------------------

enum class MatcapStackMethod : uint32_t
{
    Over     = 0u, // [-] - Interpolate foreground colour over accumulated colour
    Additive = 1u, // [-] - Add foreground colour scaled by opacity
    Multiply = 2u, // [-] - Multiply accumulated colour by foreground colour
};

//------------------------------------------------------------------------------------------------------------------------
//                                                     STRUCTURES
//------------------------------------------------------------------------------------------------------------------------

struct ColorTriplet
{
    float Red   = 0.0f; // [0-1+] - Linear red radiance or reflectance
    float Green = 0.0f; // [0-1+] - Linear green radiance or reflectance
    float Blue  = 0.0f; // [0-1+] - Linear blue radiance or reflectance
};

struct SurfaceAppearance
{
    ColorTriplet       DiffuseReflectance  = { 0.70f, 0.70f, 0.70f }; // [0-1] - Lambert reflectance tint
    float              LayerOpacity        = 1.0f;                    // [0-1] - Contribution of this ordered layer
    ColorTriplet       SpecularReflectance = { 0.04f, 0.04f, 0.04f }; // [0-1] - Blinn lobe tint at normal incidence
    float              MatcapOpacity       = 0.0f;                    // [0-1] - Contribution of the optional matcap image
    float              GlossExponent       = 32.0f;                   // [-]   - Blinn lobe concentration [1..1024]
    float              ShadowInfluence     = 1.0f;                    // [0-1] - Direct-light visibility influence
    uint32_t           MatcapImageIndex    = InvalidMatcapImageIndex; // [idx] - Descriptor-array image index
    MatcapStackMethod  MatcapStack         = MatcapStackMethod::Over; // [-]   - Matcap and direct-light ordering method
    MatcapStackMethod  LayerStack          = MatcapStackMethod::Over; // [-]   - Layer and accumulated-radiance ordering method
};

struct alignas(16) SurfaceAppearanceGpu
{
    float    DiffuseRed             = 0.70f;                    // [0-1] - Lambert reflectance red channel
    float    DiffuseGreen           = 0.70f;                    // [0-1] - Lambert reflectance green channel
    float    DiffuseBlue            = 0.70f;                    // [0-1] - Lambert reflectance blue channel
    float    LayerOpacity           = 1.0f;                     // [0-1] - Ordered-layer contribution
    float    SpecularRed            = 0.04f;                    // [0-1] - Blinn lobe red channel
    float    SpecularGreen          = 0.04f;                    // [0-1] - Blinn lobe green channel
    float    SpecularBlue           = 0.04f;                    // [0-1] - Blinn lobe blue channel
    float    MatcapOpacity          = 0.0f;                     // [0-1] - Matcap contribution
    float    GlossExponent          = 32.0f;                    // [-]   - Blinn lobe concentration
    float    ShadowInfluence        = 1.0f;                     // [0-1] - Direct-light shadow influence
    uint32_t MatcapImageIndex       = InvalidMatcapImageIndex;  // [idx] - Matcap descriptor-array image index
    uint32_t MatcapStackMethodIndex = 0u;                       // [-]   - MatcapStackMethod ordinal
    uint32_t LayerStackMethodIndex  = 0u;                       // [-]   - MatcapStackMethod ordinal
    uint32_t Padding0               = 0u;                       // [B]   - Explicit GPU structure padding
    uint32_t Padding1               = 0u;                       // [B]   - Explicit GPU structure padding
    uint32_t Padding2               = 0u;                       // [B]   - Explicit GPU structure padding
};

static_assert(sizeof(SurfaceAppearanceGpu) == 64u, "SurfaceAppearanceGpu layout must remain 64 bytes.");
static_assert(alignof(SurfaceAppearanceGpu) == 16u, "SurfaceAppearanceGpu alignment must remain 16 bytes.");

struct alignas(16) SurfaceFacetAppearanceGpu
{
    uint32_t FirstLayerIndex = 0u; // [idx]   - First appearance identifier in LayerIdentifierSequence
    uint32_t LayerCount      = 0u; // [count] - Ordered appearance count for this facet
    uint32_t Padding0        = 0u; // [B]     - Explicit GPU structure padding
    uint32_t Padding1        = 0u; // [B]     - Explicit GPU structure padding
};

static_assert(sizeof(SurfaceFacetAppearanceGpu) == 16u, "SurfaceFacetAppearanceGpu layout must remain 16 bytes.");
static_assert(alignof(SurfaceFacetAppearanceGpu) == 16u, "SurfaceFacetAppearanceGpu alignment must remain 16 bytes.");

struct SurfaceAppearanceGpuUpload
{
    std::vector<SurfaceAppearanceGpu>      AppearanceSequence{};       // [count] - GPU appearance definitions
    std::vector<SurfaceFacetAppearanceGpu> FacetAppearanceSequence{};  // [count] - GPU facet-to-layer ranges
    std::vector<uint32_t>                  LayerIdentifierSequence{};  // [count] - Ordered appearance identifiers
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  FUNCTION PROTOTYPES
//------------------------------------------------------------------------------------------------------------------------

class SurfaceAppearanceRegister
{
public:
    SurfaceAppearanceRegister() noexcept = default;

    void ResizeFacetCount(uint32_t RequestedFacetCount);

    [[nodiscard]] AppearanceIdentifier RegisterAppearance(const SurfaceAppearance& Appearance);
    [[nodiscard]] bool                 OverwriteAppearance(AppearanceIdentifier Identifier, const SurfaceAppearance& Appearance);
    [[nodiscard]] bool                 AssignFacetLayerSequence(
        uint32_t                          FacetIndex,
        std::span<const AppearanceIdentifier> OrderedIdentifiers);

    [[nodiscard]] uint32_t                        QueryFacetCount() const noexcept;
    [[nodiscard]] const SurfaceAppearance*        QueryAppearance(AppearanceIdentifier Identifier) const noexcept;
    [[nodiscard]] std::span<const AppearanceIdentifier> QueryFacetLayerSequence(uint32_t FacetIndex) const noexcept;
    [[nodiscard]] SurfaceAppearanceGpuUpload      ConstructGpuUpload() const;

private:
    std::vector<SurfaceAppearance>                    AppearanceSequence{};      // [count] - Registered material definitions
    std::vector<std::vector<AppearanceIdentifier>>    FacetLayerSequences{};     // [count] - Ordered material identifiers per facet
};

} // namespace Frontier::UVSpace
