/*==========================================================================================================================================
                                                    PHOTOMETRICWORKSPACECAPTURE.CPP
==========================================================================================================================================*/
// Offscreen proof of Photometric Studio's staged rig through the production C++ RenderingExtension and stored ReSTIR GI SPIR-V.
// SwiftShader is a CPU Vulkan device here; only the final ImGui composition is CPU-rasterized for PNG output.

#include "Engine/Interface/IconPresentation.h"
#include "Engine/Interface/InspectorControls.h"
#include "Engine/Interface/TypefaceRegistry.h"
#include "Engine/Lifecycle/ActivationSequence.h"
#include "EverestWorkspace.h"
#include "Exhibits/ControlCentre/Code/CpuRasterization.h"
#include "Frontier/Engine/Interface/Workspaces/PhotometricWorkspace.h"
#include "Frontier/Extensions/Rendering/RenderingExtension.h"
#include "UI/Editor/ControlCentrePanel.h"

#include <imgui.h>
#include <stb_image_write.h>

#include <algorithm>
#include <array>
#include <cstdio>
#include <functional>
#include <cstdlib>
#include <filesystem>
#include <stdexcept>
#include <string>
#include <vector>

namespace
{
constexpr int CaptureWidth = 1920;
constexpr int CaptureHeight = 1080;
constexpr uint64_t SceneTextureTag = 0x50484F544FULL;

void Require(bool Condition, const std::string& Message)
{
    if (!Condition) throw std::runtime_error(Message);
}

void WriteCapture(const std::filesystem::path& Path, const ImDrawData* DrawData,
                  const std::vector<uint8_t>& ScenePixels, uint32_t SceneWidth, uint32_t SceneHeight)
{
    FrontierExhibit::AcknowledgeTextures();
    std::vector<unsigned char> Pixels(static_cast<size_t>(CaptureWidth) * CaptureHeight * 3u, 14u);
    const std::function<FrontierExhibit::Image(ImTextureID)> Resolve = [&](ImTextureID Texture) {
        if (Texture == static_cast<ImTextureID>(SceneTextureTag))
            return FrontierExhibit::Image{ScenePixels.data(), static_cast<int>(SceneWidth), static_cast<int>(SceneHeight), 4};
        return FrontierExhibit::Image{};
    };
    for (const ImDrawList* List : DrawData->CmdLists)
        FrontierExhibit::RasterizeCommands(List, Pixels.data(), CaptureWidth, CaptureHeight,
                                            DrawData->DisplayPos, DrawData->FramebufferScale, nullptr, &Resolve);
    std::filesystem::create_directories(Path.parent_path());
    Require(stbi_write_png(Path.string().c_str(), CaptureWidth, CaptureHeight, 3, Pixels.data(), CaptureWidth * 3) != 0,
            "Failed to write CPU-composited scene capture: " + Path.string());
}
} // namespace

int main(int ArgumentCount, char** Arguments)
{
    using namespace Frontier;
    try
    {
        Require(ArgumentCount >= 5,
                "usage: PhotometricWorkspaceCapture <EngineContent> <Projects/Everest> <ShaderRoot> <OutputDirectory> [refreshes-per-rig]");
        std::setvbuf(stdout, nullptr, _IONBF, 0);
        const std::filesystem::path ContentDir = std::filesystem::absolute(Arguments[1]);
        const std::filesystem::path ProjectRoot = std::filesystem::absolute(Arguments[2]);
        const std::filesystem::path ShaderRoot = std::filesystem::absolute(Arguments[3]);
        const std::filesystem::path OutputDir = std::filesystem::absolute(Arguments[4]);
        const int RefreshesPerRig = ArgumentCount > 5 ? std::clamp(std::atoi(Arguments[5]), 1, 8) : 2;

        ImGui::CreateContext();
        ImGuiIO& IO = ImGui::GetIO();
        IO.DisplaySize = ImVec2(static_cast<float>(CaptureWidth), static_cast<float>(CaptureHeight));
        IO.DeltaTime = 1.0f / 30.0f;
        IO.IniFilename = nullptr;
        IO.ConfigFlags |= ImGuiConfigFlags_DockingEnable | ImGuiConfigFlags_NavEnableKeyboard;
        IO.BackendFlags |= ImGuiBackendFlags_RendererHasTextures | ImGuiBackendFlags_RendererHasVtxOffset;
        ImGui::GetPlatformIO().Renderer_TextureMaxWidth = 4096;
        ImGui::GetPlatformIO().Renderer_TextureMaxHeight = 4096;
        IconPresentation::Attach(ContentDir / "Icons");

        const std::filesystem::path Preferences = OutputDir / "Personal.projectspace";
        std::filesystem::remove(Preferences);
        ActivationOwnership Ownership(new ControlCentrePanel(ContentDir / "FontArchives", Preferences, ProjectRoot / "Everest.projectspace"));
        auto* Centre = static_cast<ControlCentrePanel*>(Ownership.get());
        Require(Centre->Initialize() && Centre->Activate(), "Control Centre initialization failed");

        TypefaceRegistry FontRegistry;
        static const char* Fonts[] = {"DM Sans", "JetBrains Mono"};
        const uint32_t Loaded = FontRegistry.Load(ContentDir / "FontArchives", Fonts, 2);
        if (Loaded == 2) TypefaceRegistry::Install(&FontRegistry);
        else IO.Fonts->AddFontDefault();
        IO.Fonts->Build();

        Everest::EverestWorkspace Workspace(*Centre, ProjectRoot);
        RenderingExtension Renderer(ProjectRoot, ShaderRoot, nullptr);
        auto* Pipeline = dynamic_cast<RenderPipelineRecord*>(Workspace.QueryWorldSpace().FindFirstByType("RenderPipeline"));
        Require(Pipeline != nullptr, "Everest has no RenderPipeline record for the staged photometric preview");
        auto& PipelineSettings = Pipeline->AccessConfiguration();
        PipelineSettings.Enabled = true;
        PipelineSettings.HardwareRayQueryTier = true;
        PipelineSettings.DirectShading = true; // The request must override this fast-preview branch and still select ReSTIR GI.
        PipelineSettings.QualityTier = 0;
        PipelineSettings.RenderScale = 0.5f;
        PipelineSettings.TraceScale = 4;
        PipelineSettings.InitialCandidates = 1;
        PipelineSettings.MaxBounces = 2;

        PhotometricWorkspaceState State;
        ConstructPhotometricWorkspaceState(State);
        EditorTypefaces Faces = EditorTypefaces::Resolve();
        std::vector<uint8_t> ScenePixels;
        std::array<uint32_t, 2> SceneExtent{};
        SceneViewportReadout LastReadout{};
        std::string LastStatus;
        const PhotometricViewportPresenter Present = [&](const SceneViewportRequest& Request) {
            const SceneViewportRefresh Outcome = Renderer.Render(Request, Workspace.QueryWorldSpace(), Workspace.QueryElapsedSeconds());
            LastReadout = Outcome.Readout;
            LastStatus = Outcome.Status;
            SceneViewportImage Image;
            Image.Status = Outcome.Status;
            Image.Readout = Outcome.Readout;
            Image.Extent = Outcome.Extent;
            if (Outcome.View != VK_NULL_HANDLE && Renderer.AccessViewport() != nullptr && Renderer.AccessViewport()->ReadPresented(ScenePixels))
            {
                SceneExtent = Outcome.Extent;
                Image.Texture = SceneTextureTag;
            }
            return Image;
        };

        const std::array<const char*, 4> Names = {"roadway", "gallery", "softbox-studio", "lunar"};
        for (int Rig = 0; Rig < static_cast<int>(Names.size()); ++Rig)
        {
            if (Rig != 0) ApplyPhotometricScenario(State, Rig);
            ScenePixels.clear();
            for (int Refresh = 0; Refresh < RefreshesPerRig; ++Refresh)
            {
                ImGui::NewFrame();
                ConstructPhotometricWorkspace(State, Faces, IO.DisplaySize, nullptr, Present, IO.DeltaTime);
                ImGui::Render();
                FrontierExhibit::AcknowledgeTextures();
                Require(!ScenePixels.empty(), "Native ReSTIR GI did not return an image for the " + std::string(Names[Rig]) + " rig: " + LastStatus);
            }
            Require(LastReadout.RayTracing && LastReadout.RendererTag.find("ReSTIR") != std::string::npos,
                    "The photometric proof used the wrong backend: " + LastReadout.RendererTag);
            Require(SceneExtent[0] > 0 && SceneExtent[1] > 0 && ScenePixels.size() == static_cast<size_t>(SceneExtent[0]) * SceneExtent[1] * 4u,
                    "Native renderer readback dimensions do not match its reported extent");
            const std::filesystem::path Path = OutputDir / (std::string("Photometric-") + Names[Rig] + "-RTX-ReSTIR-GI.png");
            WriteCapture(Path, ImGui::GetDrawData(), ScenePixels, SceneExtent[0], SceneExtent[1]);
            std::printf("%s: %s · %u×%u · %.1f ms · wrote %s\n", Names[Rig], LastReadout.RendererTag.c_str(),
                        SceneExtent[0], SceneExtent[1], LastReadout.RefreshMilliseconds, Path.string().c_str());
        }
        ImGui::DestroyContext();
        return 0;
    }
    catch (const std::exception& Failure)
    {
        if (ImGui::GetCurrentContext() != nullptr) ImGui::DestroyContext();
        std::fprintf(stderr, "PhotometricWorkspaceCapture: %s\n", Failure.what());
        return 1;
    }
}
