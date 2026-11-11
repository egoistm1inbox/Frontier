/*============================================================================================================================================
                                                 SURFACEAPPEARANCELAYOUT.CPP
============================================================================================================================================*/
// 🧩 GPU-descriptor packing and facet layer registration for native UV and surface-authoring workspaces

#include "Engine/UVSpace/SurfaceAppearanceLayout.h"

#include <limits>

namespace Frontier::UVSpace
{

//------------------------------------------------------------------------------------------------------------------------
//                                                FACET LAYER REGISTRATION
//------------------------------------------------------------------------------------------------------------------------

void SurfaceAppearanceRegister::ResizeFacetCount(uint32_t RequestedFacetCount)
{
    FacetLayerSequences.resize(RequestedFacetCount);
}

AppearanceIdentifier SurfaceAppearanceRegister::RegisterAppearance(const SurfaceAppearance& Appearance)
{
    if (AppearanceSequence.size() >= static_cast<std::size_t>(std::numeric_limits<AppearanceIdentifier>::max()))
    {
        return InvalidAppearanceIdentifier;
    }

    const AppearanceIdentifier Identifier = static_cast<AppearanceIdentifier>(AppearanceSequence.size());
    AppearanceSequence.push_back(Appearance);
    return Identifier;
}

bool SurfaceAppearanceRegister::OverwriteAppearance(
    AppearanceIdentifier    Identifier,
    const SurfaceAppearance& Appearance)
{
    if (Identifier >= AppearanceSequence.size())
    {
        return false;
    }

    AppearanceSequence[Identifier] = Appearance;
    return true;
}

bool SurfaceAppearanceRegister::AssignFacetLayerSequence(
    uint32_t                                FacetIndex,
    std::span<const AppearanceIdentifier> OrderedIdentifiers)
{
    if (FacetIndex >= FacetLayerSequences.size())
    {
        return false;
    }

    for (const AppearanceIdentifier Identifier : OrderedIdentifiers)
    {
        if (Identifier >= AppearanceSequence.size())
        {
            return false;
        }
    }

    FacetLayerSequences[FacetIndex].assign(OrderedIdentifiers.begin(), OrderedIdentifiers.end());
    return true;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   INSPECTION QUERIES
//------------------------------------------------------------------------------------------------------------------------

uint32_t SurfaceAppearanceRegister::QueryFacetCount() const noexcept
{
    return static_cast<uint32_t>(FacetLayerSequences.size());
}

const SurfaceAppearance* SurfaceAppearanceRegister::QueryAppearance(AppearanceIdentifier Identifier) const noexcept
{
    if (Identifier >= AppearanceSequence.size())
    {
        return nullptr;
    }

    return &AppearanceSequence[Identifier];
}

std::span<const AppearanceIdentifier> SurfaceAppearanceRegister::QueryFacetLayerSequence(uint32_t FacetIndex) const noexcept
{
    if (FacetIndex >= FacetLayerSequences.size())
    {
        return {};
    }

    return FacetLayerSequences[FacetIndex];
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   GPU UPLOAD PACKING
//------------------------------------------------------------------------------------------------------------------------

SurfaceAppearanceGpuUpload SurfaceAppearanceRegister::ConstructGpuUpload() const
{
    SurfaceAppearanceGpuUpload Upload{};
    Upload.AppearanceSequence.reserve(AppearanceSequence.size());
    Upload.FacetAppearanceSequence.reserve(FacetLayerSequences.size());

    for (const SurfaceAppearance& Appearance : AppearanceSequence)
    {
        Upload.AppearanceSequence.push_back(SurfaceAppearanceGpu{
            .DiffuseRed             = Appearance.DiffuseReflectance.Red,
            .DiffuseGreen           = Appearance.DiffuseReflectance.Green,
            .DiffuseBlue            = Appearance.DiffuseReflectance.Blue,
            .LayerOpacity           = Appearance.LayerOpacity,
            .SpecularRed            = Appearance.SpecularReflectance.Red,
            .SpecularGreen          = Appearance.SpecularReflectance.Green,
            .SpecularBlue           = Appearance.SpecularReflectance.Blue,
            .MatcapOpacity          = Appearance.MatcapOpacity,
            .GlossExponent          = Appearance.GlossExponent,
            .ShadowInfluence        = Appearance.ShadowInfluence,
            .MatcapImageIndex       = Appearance.MatcapImageIndex,
            .MatcapStackMethodIndex = static_cast<uint32_t>(Appearance.MatcapStack),
            .LayerStackMethodIndex  = static_cast<uint32_t>(Appearance.LayerStack),
        });
    }

    for (const std::vector<AppearanceIdentifier>& LayerIdentifiers : FacetLayerSequences)
    {
        const uint32_t FirstLayerIndex = static_cast<uint32_t>(Upload.LayerIdentifierSequence.size());
        Upload.LayerIdentifierSequence.insert(
            Upload.LayerIdentifierSequence.end(),
            LayerIdentifiers.begin(),
            LayerIdentifiers.end());
        Upload.FacetAppearanceSequence.push_back(SurfaceFacetAppearanceGpu{
            .FirstLayerIndex = FirstLayerIndex,
            .LayerCount      = static_cast<uint32_t>(LayerIdentifiers.size()),
        });
    }

    return Upload;
}

} // namespace Frontier::UVSpace
