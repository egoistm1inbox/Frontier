/*==========================================================================================================================================
                                                   SCENEVIEWPORTWORKSPACECAPTURE.CPP
==========================================================================================================================================*/
// 🧩 The Everest workspace with its live Scene Viewport and transparent particle overlay, captured offscreen: the real workspace,
//    scene and particle extensions, the two presented images read back and alpha-composited by the interface rasterizer.

#include "Engine/Interface/IconPresentation.h"
#include "Engine/Interface/InspectorRuntime.h"
#include "Frontier/Extensions/Rendering/RenderingExtension.h"
#include "Frontier/Extensions/Particle/ParticleExtension.h"
#include "EverestWorkspace.h"
#include "Exhibits/ControlCentre/Code/CpuRasterization.h"
#include "UI/Editor/ControlCentrePanel.h"

#include <imgui.h>
#include <stb_image_write.h>

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <cstdio>
#include <filesystem>
#include <stdexcept>
#include <string>
#include <vector>

namespace
{

constexpr int      CaptureWidth        = 1920;
constexpr int      CaptureHeight       = 1080;
constexpr uint64_t ViewportTag         = 0x5CE7E5u;   // [-] ImTextureID the capture resolves to the read-back scene image
constexpr uint64_t ParticleViewportTag = 0x5CE7E6u;   // [-] ImTextureID the capture resolves to the read-back particle layer

void Require(bool Condition, const std::string& Message)
{
    if (!Condition) throw std::runtime_error(Message);
}

} // namespace

int main(int ArgumentCount, char** Arguments)
{
    using namespace Frontier;
    try
    {
        std::setvbuf(stdout, nullptr, _IONBF, 0);
        Require(ArgumentCount >= 5, "usage: SceneViewportWorkspaceCapture <EngineContent> <Projects/Everest> <ShaderRoot> <Out.png> [Refreshes] "
                                    "[Select type or type:name] [Inspector sections, e.g. 0,1,2]");
        const std::filesystem::path ContentDir  = std::filesystem::absolute(Arguments[1]);
        const std::filesystem::path EverestRoot = std::filesystem::absolute(Arguments[2]);
        const std::filesystem::path ShaderRoot  = std::filesystem::absolute(Arguments[3]);
        const std::filesystem::path OutputPath  = std::filesystem::absolute(Arguments[4]);
        const int                   Refreshes   = ArgumentCount > 5 ? std::atoi(Arguments[5]) : 10;
        const std::string           SelectType  = ArgumentCount > 6 ? Arguments[6] : "";
        std::vector<int>            Sections;
        if (ArgumentCount > 7)
            for (const char* Cursor = Arguments[7]; *Cursor != '\0';)
            {
                Sections.push_back(std::atoi(Cursor));
                while (*Cursor != '\0' && *Cursor != ',') ++Cursor;
                if (*Cursor == ',') ++Cursor;
            }
        std::filesystem::create_directories(OutputPath.parent_path());

        ImGui::CreateContext();
        ImGuiIO& Io    = ImGui::GetIO();
        Io.DisplaySize = ImVec2(static_cast<float>(CaptureWidth), static_cast<float>(CaptureHeight));
        Io.DeltaTime   = 1.0f / 30.0f;
        Io.IniFilename = nullptr;
        Io.ConfigFlags |= ImGuiConfigFlags_DockingEnable | ImGuiConfigFlags_NavEnableKeyboard;   // 📝 before the first NewFrame, as the workspace expects
        Io.BackendFlags |= ImGuiBackendFlags_RendererHasTextures | ImGuiBackendFlags_RendererHasVtxOffset;
        ImGui::GetPlatformIO().Renderer_TextureMaxWidth  = 4096;
        ImGui::GetPlatformIO().Renderer_TextureMaxHeight = 4096;
        IconPresentation::Attach(ContentDir / "Icons");
        const std::filesystem::path Preferences = OutputPath.parent_path() / "Personal.projectspace";
        std::filesystem::remove(Preferences);
        ActivationOwnership Ownership(new ControlCentrePanel(ContentDir / "FontArchives", Preferences, EverestRoot / "Everest.projectspace"));
        auto* Centre = static_cast<ControlCentrePanel*>(Ownership.get());
        Require(Centre->Initialize() && Centre->Activate(), "ControlCentrePanel initialization failed");

        // 📝 The same bridge the editor uses; here it opens its own device and the image comes back to the CPU.
        Everest::EverestWorkspace     Workspace(*Centre, EverestRoot);
        Frontier::RenderingExtension Bridge(EverestRoot, ShaderRoot, nullptr);
        Frontier::ParticleExtension   ParticleBridge(ShaderRoot, nullptr);
        std::vector<uint8_t>          ViewportPixels;
        std::vector<uint8_t>          ParticlePixels;
        std::array<uint32_t, 2>       ViewportExtent = {0, 0};
        std::array<uint32_t, 2>       ParticleExtent = {0, 0};
        Frontier::SceneViewportRequest LastSceneRequest{};
        bool                          SawParticleRequest = false;
        bool                          CompositeValidated = false;
        std::string                   LastStatus;
        Workspace.PresentSceneViewport = [&](const Frontier::SceneViewportRequest& Request) {
            LastSceneRequest = Request;
            const auto Start = std::chrono::steady_clock::now();
            const Frontier::SceneViewportRefresh Outcome = Bridge.Render(Request, Workspace.QueryWorldSpace(), Workspace.QueryElapsedSeconds());
            Frontier::SceneViewportImage Image;
            Image.Status  = Outcome.Status;
            Image.Readout = Outcome.Readout;
            Image.Extent  = Outcome.Extent;
            LastStatus    = Outcome.Status;
            if (Outcome.View != VK_NULL_HANDLE && Bridge.AccessViewport()->ReadPresented(ViewportPixels))
            {
                ViewportExtent = Outcome.Extent;
                Image.Texture  = ViewportTag;
            }
            std::printf("  viewport image %u x %u for a %.0f x %.0f panel in %.1f s — %s\n", Outcome.Extent[0], Outcome.Extent[1], Request.PanelWidth,
                        Request.PanelHeight, std::chrono::duration<double>(std::chrono::steady_clock::now() - Start).count(), Outcome.Status.c_str());
            return Image;
        };
        Workspace.PresentParticleViewport = [&](const Frontier::ParticleViewportRequest& Request) {
            Require(Request.Plan != nullptr, "the scene particle presenter received no refresh plan");
            Require(Request.Plan->ViewWidth == ViewportExtent[0] && Request.Plan->ViewHeight == ViewportExtent[1],
                    "particle render extent differs from the live scene viewport extent");
            const Frontier::ParticleCameraPose ScenePose{LastSceneRequest.CameraPosition, LastSceneRequest.CameraTarget,
                                                          LastSceneRequest.CameraUp, LastSceneRequest.VerticalFieldOfView};
            const Frontier::ParticleCameraPose ParticlePose = Frontier::ConvertSceneCameraToParticleAxes(ScenePose);
            const Frontier::ParticleCameraReading ExpectedCamera = Frontier::ResolveParticleCamera(
                ParticlePose, static_cast<double>(ViewportExtent[0]) / std::max(1u, ViewportExtent[1]));
            Require(Request.Plan->Camera.Eye == ParticlePose.Position && Request.Plan->Camera.ViewProjection == ExpectedCamera.ViewProjection,
                    "particle render does not use the live scene camera pose and projection");
            SawParticleRequest = true;
            Frontier::ParticleViewportImage Image;
            Frontier::ParticleViewportOutcome Outcome = ParticleBridge.Render(Request);
            Image = std::move(Outcome.Image);
            if (Outcome.View != VK_NULL_HANDLE && ParticleBridge.AccessSequence() != nullptr)
            {
                std::string Diagnostic;
                if (ParticleBridge.AccessSequence()->ReadPresentedImage(ParticlePixels, &Diagnostic))
                {
                    ParticleExtent = Image.Extent;
                    Image.Texture  = ParticleViewportTag;
                }
                else
                {
                    Image.Failure = Diagnostic;
                }
            }
            return Image;
        };

        // 📝 The capture shows the demo's readout (H) and distance slice (I), which the editor starts with off.
        Workspace.AccessViewportOverlays().ReadoutVisible       = true;
        RecordToken Selected{};
        if (!SelectType.empty())
        {
            // 📝 "Type" selects the first record of that type, "Type:Name" the record of that name.
            const size_t      Colon = SelectType.find(':');
            const std::string Type  = SelectType.substr(0, Colon);
            const std::string Name  = Colon == std::string::npos ? std::string{} : SelectType.substr(Colon + 1);
            SceneRecordBase*  Entry = Name.empty() ? Workspace.QueryWorldSpace().FindFirstByType(Type) : nullptr;
            for (const SceneRecordBase* Candidate : Workspace.QueryWorldSpace().FindAllByType(Type))
                if (!Name.empty() && Candidate->QueryRecordName() == Name) Entry = Workspace.QueryWorldSpace().FindRecord(Candidate->QueryToken());
            Require(Entry != nullptr, "no record " + SelectType);
            Selected = Entry->QueryToken();
            Workspace.QueryOutliner().Select(Selected);
        }
        for (int Tick = 0; Tick < Refreshes; ++Tick)
        {
            Centre->PrepareInterface();
            ImGui::NewFrame();
            (void)Centre->Integrate(1.0 / 30.0);
            (void)Workspace.ConfigurePlatform();
            Workspace.ConstructInterface(1.0 / 30.0);
            Centre->ConstructInterface();
            ImGui::Render();
            FrontierExhibit::AcknowledgeTextures();
        }
        Require(!ViewportPixels.empty(), "no scene viewport image was presented: " + LastStatus);
        Require(SawParticleRequest, "the Particles record did not request a main-viewport particle layer");
        Require(ParticleExtent == ViewportExtent, "the particle image was not rendered at the actual scene viewport extent");
        Require(ParticleExtent[0] > 0 && ParticleExtent[1] > 0 &&
                    ParticlePixels.size() == static_cast<size_t>(ParticleExtent[0]) * ParticleExtent[1] * 4u,
                "no main-viewport particle layer was read back");
        size_t AlphaCoverage = 0;
        size_t PartialAlphaCoverage = 0;
        for (size_t Byte = 3; Byte < ParticlePixels.size(); Byte += 4)
        {
            const uint8_t Alpha = ParticlePixels[Byte];
            AlphaCoverage += Alpha > 8 ? 1u : 0u;
            PartialAlphaCoverage += Alpha > 8 && Alpha < 248 ? 1u : 0u;
        }
        Require(AlphaCoverage > 0, "the main-viewport particle layer has no visible alpha coverage");
        Require(PartialAlphaCoverage > 0, "the main-viewport particle layer lost its partial-alpha particles");
        Require(ParticlePixels[3] == 0 && ParticlePixels[ParticlePixels.size() - 1] == 0,
                "the transparent particle layer covers its image corners");
        std::printf("  particle layer %u x %u, %zu alpha-covered pixels\n", ParticleExtent[0], ParticleExtent[1], AlphaCoverage);

        const auto WriteCapture = [&](const std::filesystem::path& Target) {
            const ImDrawData* DrawData = ImGui::GetDrawData();
            const std::array<unsigned char, 4> TransparentPixel{};
            const auto RasterizeDisplay = [&](bool IncludeParticles) {
                std::vector<unsigned char> Pixels(static_cast<size_t>(CaptureWidth) * CaptureHeight * 3u, 14u);
                const std::function<FrontierExhibit::Image(ImTextureID)> Resolve = [&](ImTextureID Texture) {
                    if (Texture == ViewportTag)
                        return FrontierExhibit::Image{ViewportPixels.data(), static_cast<int>(ViewportExtent[0]), static_cast<int>(ViewportExtent[1]), 4};
                    if (Texture == ParticleViewportTag)
                        return IncludeParticles
                            ? FrontierExhibit::Image{ParticlePixels.data(), static_cast<int>(ParticleExtent[0]), static_cast<int>(ParticleExtent[1]), 4}
                            : FrontierExhibit::Image{TransparentPixel.data(), 1, 1, 4};
                    return FrontierExhibit::Image{};
                };
                for (const ImDrawList* List : DrawData->CmdLists)
                    FrontierExhibit::RasterizeCommands(List, Pixels.data(), CaptureWidth, CaptureHeight, DrawData->DisplayPos,
                                                       DrawData->FramebufferScale, nullptr, &Resolve);
                return Pixels;
            };
            std::vector<unsigned char> Pixels = RasterizeDisplay(true);
            if (!CompositeValidated)
            {
                const std::vector<unsigned char> SceneOnlyPixels = RasterizeDisplay(false);
                size_t CompositeChangedPixels = 0;
                for (size_t Byte = 0; Byte < Pixels.size(); Byte += 3)
                {
                    if (Pixels[Byte] != SceneOnlyPixels[Byte] || Pixels[Byte + 1] != SceneOnlyPixels[Byte + 1] ||
                        Pixels[Byte + 2] != SceneOnlyPixels[Byte + 2]) ++CompositeChangedPixels;
                }
                Require(CompositeChangedPixels > 0, "alpha-composited particles did not change the live scene viewport image");
                std::printf("  alpha compositing changed %zu screen pixels over the scene-only capture\n", CompositeChangedPixels);
                CompositeValidated = true;
            }
            Require(stbi_write_png(Target.string().c_str(), CaptureWidth, CaptureHeight, 3, Pixels.data(), CaptureWidth * 3) != 0, "PNG write failed");
            std::printf("[SceneViewportWorkspaceCapture] %s (viewport %u x %u)\n", Target.string().c_str(), ViewportExtent[0], ViewportExtent[1]);
        };
        WriteCapture(OutputPath);

        // 📝 The viewport bar's inspection select writes the RenderPipeline record; the next refresh reads it. Here the record
        //    is set to the demo's "Normals" view (8) and one more refresh is captured beside the main image.
        if (auto* Pipeline = dynamic_cast<RenderPipelineRecord*>(Workspace.QueryWorldSpace().FindFirstByType("RenderPipeline")))
        {
            Pipeline->AccessConfiguration().InspectionModeIndex = 8;
            Pipeline->AccessConfiguration().AdvanceRevision();
            Centre->PrepareInterface();
            ImGui::NewFrame();
            (void)Centre->Integrate(1.0 / 30.0);
            Workspace.ConstructInterface(1.0 / 30.0);
            Centre->ConstructInterface();
            ImGui::Render();
            FrontierExhibit::AcknowledgeTextures();
            std::filesystem::path Normals = OutputPath;
            Normals.replace_filename(OutputPath.stem().string() + "-Normals" + OutputPath.extension().string());
            WriteCapture(Normals);

            // 📝 Debug view 15: the analytic illumination instead of the global illumination (Render settings › Debug views).
            Pipeline->AccessConfiguration().InspectionModeIndex  = 0;
            Pipeline->AccessConfiguration().DirectShading        = true;
            Pipeline->AccessConfiguration().AdvanceRevision();
            for (int Tick = 0; Tick < 2; ++Tick)
            {
                Centre->PrepareInterface();
                ImGui::NewFrame();
                (void)Centre->Integrate(1.0 / 30.0);
                Workspace.ConstructInterface(1.0 / 30.0);
                Centre->ConstructInterface();
                ImGui::Render();
                FrontierExhibit::AcknowledgeTextures();
            }
            std::filesystem::path Direct = OutputPath;
            Direct.replace_filename(OutputPath.stem().string() + "-Direct" + OutputPath.extension().string());
            WriteCapture(Direct);
            Pipeline->AccessConfiguration().DirectShading = false;
            Pipeline->AccessConfiguration().AdvanceRevision();
        }

        // 📝 The selected record's Inspector page, section by section, each in a column tall enough for the whole section (the
        //    workspace's column shows only its top); the measurements are the ones the refreshes above published.
        if (Selected.IsValid() && !Sections.empty())
        {
            RecordInspector* Page = InspectorRuntime::Instance().FindInspector(Selected);
            Require(Page != nullptr, "the selected record has no inspector");
            if (auto* Pipeline = dynamic_cast<RenderPipelineRecord*>(Workspace.QueryWorldSpace().FindRecord(Selected)))
                Pipeline->AccessConfiguration().InspectionModeIndex = 0;
            constexpr int ColumnWidth = 470, ColumnHeight = 2900;
            for (const int Section : Sections)
            {
                Page->ConfigureSection(Section);
                for (int Settle = 0; Settle < 3; ++Settle)
                {
                    Io.DisplaySize = ImVec2(static_cast<float>(ColumnWidth), static_cast<float>(ColumnHeight));
                    Centre->PrepareInterface();
                    ImGui::NewFrame();
                    ImGui::SetNextWindowPos(ImVec2(0.0f, 0.0f));
                    ImGui::SetNextWindowSize(ImVec2(static_cast<float>(ColumnWidth), static_cast<float>(ColumnHeight)));
                    ImGui::Begin("##InspectorSectionCapture", nullptr, ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoSavedSettings);
                    bool DeleteRequested = false;
                    InspectorRuntime::Instance().InspectRecord(Selected, DeleteRequested);
                    ImGui::End();
                    ImGui::Render();
                    FrontierExhibit::AcknowledgeTextures();
                }
                const ImDrawData* DrawData = ImGui::GetDrawData();
                std::vector<unsigned char> Pixels(static_cast<size_t>(ColumnWidth) * ColumnHeight * 3u, 14u);
                for (const ImDrawList* List : DrawData->CmdLists)
                    FrontierExhibit::RasterizeCommands(List, Pixels.data(), ColumnWidth, ColumnHeight, DrawData->DisplayPos, DrawData->FramebufferScale, nullptr,
                                                       nullptr);
                // 📝 Cropped below the last row whose inner columns differ from the page fill: the page fills the whole column, so
                //    the reference is a row just above the column's bottom edge, where no section reaches.
                const int  Reference  = ColumnHeight - 12;
                const auto RowDiffers = [&](int Row) {
                    for (int Column = 24 * 3; Column < (ColumnWidth - 24) * 3; ++Column)
                        if (std::abs(int(Pixels[static_cast<size_t>(Row) * ColumnWidth * 3 + Column]) -
                                     int(Pixels[static_cast<size_t>(Reference) * ColumnWidth * 3 + Column])) > 6)
                            return true;
                    return false;
                };
                int Used = Reference;
                while (Used > 0 && !RowDiffers(Used)) --Used;
                Used = std::min(ColumnHeight, Used + 24);
                std::filesystem::path Target = OutputPath;
                Target.replace_filename(OutputPath.stem().string() + "-Section-" + std::to_string(Section) + OutputPath.extension().string());
                Require(stbi_write_png(Target.string().c_str(), ColumnWidth, Used, 3, Pixels.data(), ColumnWidth * 3) != 0, "PNG write failed");
                std::printf("[SceneViewportWorkspaceCapture] %s (section %d, %d px)\n", Target.string().c_str(), Section, Used);
            }
        }

        Workspace.PresentSceneViewport = nullptr;
        Workspace.PresentParticleViewport = nullptr;
        Ownership.reset();
        FrontierExhibit::AcknowledgeTextures();
        ImGui::GetIO().BackendFlags = 0;
        ImGui::DestroyContext();
        return 0;
    }
    catch (const std::exception& Failure)
    {
        std::fprintf(stderr, "[SceneViewportWorkspaceCapture] FAILED: %s\n", Failure.what());
        return 1;
    }
}
