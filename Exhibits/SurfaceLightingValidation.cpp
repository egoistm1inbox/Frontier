/*============================================================================================================================================
                                                SURFACELIGHTINGVALIDATION.CPP
============================================================================================================================================*/
// 🧩 Deterministic facet material layering, Blinn-Phong direct-light, matcap, and directional-shadow validation image

#include "Engine/GeometricRaster/FastSurfaceLighting.h"
#include "Engine/UVSpace/SurfaceAppearanceLayout.h"
#include "Exhibits/SoftwareCanvasRasterizer.h"

#include <imgui.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <vector>

namespace
{

using Frontier::GeometricRaster::EvaluateFastSurfaceLighting;
using Frontier::GeometricRaster::SurfaceLightingResult;
using Frontier::GeometricRaster::SurfaceLightingSample;
using Frontier::GeometricRaster::ViewVector3;
using Frontier::UVSpace::AppearanceIdentifier;
using Frontier::UVSpace::ColorTriplet;
using Frontier::UVSpace::InvalidAppearanceIdentifier;
using Frontier::UVSpace::InvalidMatcapImageIndex;
using Frontier::UVSpace::MatcapStackMethod;
using Frontier::UVSpace::SurfaceAppearance;
using Frontier::UVSpace::SurfaceAppearanceGpuUpload;
using Frontier::UVSpace::SurfaceAppearanceRegister;

bool VerifyCondition(bool Condition, const char* Description) noexcept
{
    if (!Condition)
    {
        std::fprintf(stderr, "[SurfaceLightingValidation] FAILED: %s\n", Description);
        return false;
    }

    return true;
}

SurfaceAppearance ConstructPrimaryAppearance()
{
    return SurfaceAppearance{
        .DiffuseReflectance  = { 0.60f, 0.38f, 0.18f },
        .LayerOpacity        = 1.0f,
        .SpecularReflectance = { 0.08f, 0.08f, 0.08f },
        .MatcapOpacity       = 0.0f,
        .GlossExponent       = 48.0f,
        .ShadowInfluence     = 1.0f,
        .MatcapImageIndex    = InvalidMatcapImageIndex,
        .MatcapStack         = MatcapStackMethod::Over,
        .LayerStack          = MatcapStackMethod::Over,
    };
}

SurfaceAppearance ConstructMatcapAppearance(
    uint32_t          ImageIndex,
    float             LayerOpacity,
    MatcapStackMethod LayerMethod)
{
    return SurfaceAppearance{
        .DiffuseReflectance  = { 0.0f, 0.0f, 0.0f },
        .LayerOpacity        = LayerOpacity,
        .SpecularReflectance = { 0.0f, 0.0f, 0.0f },
        .MatcapOpacity       = 1.0f,
        .GlossExponent       = 32.0f,
        .ShadowInfluence     = 0.0f,
        .MatcapImageIndex    = ImageIndex,
        .MatcapStack         = MatcapStackMethod::Over,
        .LayerStack          = LayerMethod,
    };
}

ImU32 ConstructImGuiColour(ColorTriplet Colour) noexcept
{
    const auto Quantize = [](float Intensity) noexcept -> int
    {
        return static_cast<int>(std::clamp(Intensity, 0.0f, 1.0f) * 255.0f + 0.5f);
    };

    return IM_COL32(Quantize(Colour.Red), Quantize(Colour.Green), Quantize(Colour.Blue), 255);
}

bool ConstructSurfaceLightingVisual(
    const SurfaceLightingResult& Bright,
    const SurfaceLightingResult& Shadowed,
    const SurfaceLightingResult& OneMatcap,
    const SurfaceLightingResult& LayeredMatcaps)
{
    ImGuiContext* ImageContext = ImGui::CreateContext();
    ImGui::SetCurrentContext(ImageContext);
    ImGuiIO& ImageIo = ImGui::GetIO();
    ImageIo.IniFilename = nullptr;
    ImageIo.DisplaySize = ImVec2(1280.0f, 680.0f);
    (void)Frontier::Exhibits::LoadProjectZeroDmSansFont(ImageIo, 13.0f);

    ImGui::NewFrame();
    ImDrawList* DrawBuffer = ImGui::GetForegroundDrawList();
    DrawBuffer->AddText(
        ImVec2(40.0f, 28.0f),
        IM_COL32(236, 240, 247, 255),
        "Surface Lighting Validation  |  Blinn-Phong + Ordered Matcaps + Directional Shadow");
    DrawBuffer->AddText(
        ImVec2(40.0f, 56.0f),
        IM_COL32(160, 170, 184, 255),
        "One registered appearance can serve any facet; every facet can use an ordered image layer sequence.");

    const std::array<const char*, 4u> Captions = {
        "Direct light",
        "Directional shadow",
        "Direct light + one matcap",
        "Direct light + two matcaps",
    };
    const std::array<ColorTriplet, 4u> Colours = {
        Bright.Radiance,
        Shadowed.Radiance,
        OneMatcap.Radiance,
        LayeredMatcaps.Radiance,
    };

    for (std::size_t SwatchIndex = 0u; SwatchIndex < Captions.size(); ++SwatchIndex)
    {
        const float Left = 40.0f + static_cast<float>(SwatchIndex) * 306.0f;
        const ImVec2 UpperLeft(Left, 112.0f);
        const ImVec2 LowerRight(Left + 274.0f, 502.0f);
        DrawBuffer->AddRectFilled(UpperLeft, LowerRight, IM_COL32(24, 27, 34, 255), 8.0f);
        DrawBuffer->AddRect(UpperLeft, LowerRight, IM_COL32(68, 76, 90, 255), 8.0f);
        DrawBuffer->AddRectFilled(
            ImVec2(Left + 18.0f, 150.0f),
            ImVec2(Left + 256.0f, 410.0f),
            ConstructImGuiColour(Colours[SwatchIndex]),
            6.0f);
        DrawBuffer->AddText(ImVec2(Left + 18.0f, 124.0f), IM_COL32(228, 232, 238, 255), Captions[SwatchIndex]);

        char RadianceText[96]{};
        std::snprintf(
            RadianceText,
            sizeof(RadianceText),
            "Linear RGB  %.3f  %.3f  %.3f",
            Colours[SwatchIndex].Red,
            Colours[SwatchIndex].Green,
            Colours[SwatchIndex].Blue);
        DrawBuffer->AddText(ImVec2(Left + 18.0f, 430.0f), IM_COL32(170, 180, 194, 255), RadianceText);
    }

    DrawBuffer->AddRectFilled(ImVec2(40.0f, 538.0f), ImVec2(1240.0f, 638.0f), IM_COL32(18, 21, 27, 255), 6.0f);
    DrawBuffer->AddText(
        ImVec2(62.0f, 558.0f),
        IM_COL32(123, 201, 151, 255),
        "Verified: facet 0 = 1 layer   |   facet 1 = 2 layers   |   facet 2 = 3 layers   |   facet 3 = 0 layers");
    DrawBuffer->AddText(
        ImVec2(62.0f, 590.0f),
        IM_COL32(170, 180, 194, 255),
        "GPU upload uses 64 B appearance entries, 16 B facet ranges, and a compact ordered identifier sequence.");

    ImGui::Render();
    Frontier::Exhibits::SoftwareRasterCanvas OutputCanvas(
        1280u,
        680u,
        Frontier::Components::RgbaColor8{ 10u, 12u, 16u, 255u });
    OutputCanvas.RasterizeImGuiBatches(ImGui::GetDrawData(), 0, 0);
    ImGui::DestroyContext(ImageContext);

    const auto OutputPath = Frontier::Exhibits::ResolveRepositoryRootPath() /
                            "Exhibits/Images/SurfaceLighting/MatcapLayeredLighting.png";
    return VerifyCondition(OutputCanvas.EncodePngToFile(OutputPath), "write MatcapLayeredLighting.png");
}

} // namespace

int main()
{
    SurfaceAppearanceRegister AppearanceRegister{};
    AppearanceRegister.ResizeFacetCount(4u);

    const AppearanceIdentifier PrimaryIdentifier = AppearanceRegister.RegisterAppearance(ConstructPrimaryAppearance());
    const AppearanceIdentifier AmberMatcapIdentifier = AppearanceRegister.RegisterAppearance(
        ConstructMatcapAppearance(0u, 0.68f, MatcapStackMethod::Over));
    const AppearanceIdentifier CyanMatcapIdentifier = AppearanceRegister.RegisterAppearance(
        ConstructMatcapAppearance(1u, 0.42f, MatcapStackMethod::Additive));

    const std::array<AppearanceIdentifier, 1u> PrimaryLayers = { PrimaryIdentifier };
    const std::array<AppearanceIdentifier, 2u> OneMatcapLayers = { PrimaryIdentifier, AmberMatcapIdentifier };
    const std::array<AppearanceIdentifier, 3u> LayeredMatcapLayers = {
        PrimaryIdentifier,
        AmberMatcapIdentifier,
        CyanMatcapIdentifier,
    };
    const std::array<AppearanceIdentifier, 1u> InvalidLayers = { InvalidAppearanceIdentifier };

    if (!VerifyCondition(PrimaryIdentifier != InvalidAppearanceIdentifier, "register primary appearance") ||
        !VerifyCondition(AmberMatcapIdentifier != InvalidAppearanceIdentifier, "register amber matcap") ||
        !VerifyCondition(CyanMatcapIdentifier != InvalidAppearanceIdentifier, "register cyan matcap") ||
        !VerifyCondition(AppearanceRegister.AssignFacetLayerSequence(0u, PrimaryLayers), "assign facet 0") ||
        !VerifyCondition(AppearanceRegister.AssignFacetLayerSequence(1u, OneMatcapLayers), "assign facet 1") ||
        !VerifyCondition(AppearanceRegister.AssignFacetLayerSequence(2u, LayeredMatcapLayers), "assign facet 2") ||
        !VerifyCondition(!AppearanceRegister.AssignFacetLayerSequence(3u, InvalidLayers), "reject unknown appearance") ||
        !VerifyCondition(AppearanceRegister.QueryFacetLayerSequence(0u).size() == 1u, "one layer on facet 0") ||
        !VerifyCondition(AppearanceRegister.QueryFacetLayerSequence(1u).size() == 2u, "two layers on facet 1") ||
        !VerifyCondition(AppearanceRegister.QueryFacetLayerSequence(2u).size() == 3u, "three layers on facet 2") ||
        !VerifyCondition(AppearanceRegister.QueryFacetLayerSequence(3u).empty(), "no layers on facet 3"))
    {
        return 1;
    }

    const SurfaceAppearanceGpuUpload Upload = AppearanceRegister.ConstructGpuUpload();
    if (!VerifyCondition(Upload.AppearanceSequence.size() == 3u, "three registered GPU appearances") ||
        !VerifyCondition(Upload.FacetAppearanceSequence.size() == 4u, "four GPU facet ranges") ||
        !VerifyCondition(Upload.LayerIdentifierSequence.size() == 6u, "six GPU layer identifiers") ||
        !VerifyCondition(Upload.FacetAppearanceSequence[2u].LayerCount == 3u, "third facet retains ordered layers"))
    {
        return 1;
    }

    const SurfaceAppearance* PrimaryAppearance = AppearanceRegister.QueryAppearance(PrimaryIdentifier);
    const SurfaceAppearance* AmberMatcapAppearance = AppearanceRegister.QueryAppearance(AmberMatcapIdentifier);
    const SurfaceAppearance* CyanMatcapAppearance = AppearanceRegister.QueryAppearance(CyanMatcapIdentifier);
    if (!VerifyCondition(PrimaryAppearance != nullptr, "query primary appearance") ||
        !VerifyCondition(AmberMatcapAppearance != nullptr, "query amber matcap") ||
        !VerifyCondition(CyanMatcapAppearance != nullptr, "query cyan matcap"))
    {
        return 1;
    }

    const std::array<SurfaceAppearance, 1u> PrimaryOnly = { *PrimaryAppearance };
    const std::array<SurfaceAppearance, 2u> PrimaryAmber = { *PrimaryAppearance, *AmberMatcapAppearance };
    const std::array<SurfaceAppearance, 3u> PrimaryAmberCyan = {
        *PrimaryAppearance,
        *AmberMatcapAppearance,
        *CyanMatcapAppearance,
    };
    const std::array<ColorTriplet, 2u> MatcapImageColours = {
        ColorTriplet{ 0.92f, 0.27f, 0.07f },
        ColorTriplet{ 0.05f, 0.72f, 0.96f },
    };

    SurfaceLightingSample BrightSample{
        .NormalInViewSpace      = ViewVector3{ 0.0f, 0.0f, 1.0f },
        .ViewerVector           = ViewVector3{ 0.0f, 0.0f, 1.0f },
        .LightVector            = ViewVector3{ 0.0f, 0.0f, 1.0f },
        .AmbientIlluminance     = ColorTriplet{ 0.05f, 0.05f, 0.05f },
        .DirectionalIlluminance = ColorTriplet{ 0.95f, 0.95f, 0.95f },
        .ShadowVisibility       = 1.0f,
    };
    SurfaceLightingSample ShadowedSample = BrightSample;
    ShadowedSample.ShadowVisibility = 0.0f;

    const SurfaceLightingResult Bright = EvaluateFastSurfaceLighting(BrightSample, PrimaryOnly, MatcapImageColours);
    const SurfaceLightingResult Shadowed = EvaluateFastSurfaceLighting(ShadowedSample, PrimaryOnly, MatcapImageColours);
    const SurfaceLightingResult OneMatcap = EvaluateFastSurfaceLighting(BrightSample, PrimaryAmber, MatcapImageColours);
    const SurfaceLightingResult LayeredMatcaps = EvaluateFastSurfaceLighting(BrightSample, PrimaryAmberCyan, MatcapImageColours);
    const auto MatcapCoordinate = Frontier::GeometricRaster::ConstructMatcapTextureCoordinate({ 0.0f, 0.0f, 1.0f });

    if (!VerifyCondition(Bright.Radiance.Red > Shadowed.Radiance.Red, "shadow reduces direct red radiance") ||
        !VerifyCondition(Bright.Radiance.Green > Shadowed.Radiance.Green, "shadow reduces direct green radiance") ||
        !VerifyCondition(OneMatcap.Radiance.Red > Bright.Radiance.Red, "amber matcap changes direct radiance") ||
        !VerifyCondition(LayeredMatcaps.Radiance.Blue > OneMatcap.Radiance.Blue, "second matcap changes ordered radiance") ||
        !VerifyCondition(std::abs(MatcapCoordinate.U - 0.5f) < 0.00001f, "central normal maps to central matcap U") ||
        !VerifyCondition(std::abs(MatcapCoordinate.V - 0.5f) < 0.00001f, "central normal maps to central matcap V"))
    {
        return 1;
    }

    if (!ConstructSurfaceLightingVisual(Bright, Shadowed, OneMatcap, LayeredMatcaps))
    {
        return 1;
    }

    std::printf("[SurfaceLightingValidation] Facet layer, Blinn-Phong, matcap, shadow, GPU layout, and image checks passed.\n");
    return 0;
}
