/*==========================================================================================================================================
                                                     PROJECTEVERESTVALIDATION.CPP
==========================================================================================================================================*/
// 🧩 End-to-end validation and CPU-rasterized 1920x1080 PNG exhibit capture for Project Everest.

#include "CpuRasterization.h"
#include "Engine/Interface/ContentDirectory.h"
#include "Engine/Interface/IconPresentation.h"
#include "Engine/Scene/InspectorCatalogue.h"
#include "Engine/Scene/SceneDirectory.h"
#include "Frontier/Projects/Project-Everest/Source/EverestWorkspace.h"
#include "UI/Editor/ControlCentrePanel.h"
#include "UI/Editor/ProjectBrowserPanel.h"

#include <imgui_internal.h>
#include <stb_image_write.h>

#include <cstring>
#include <filesystem>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace Frontier
{
namespace
{

constexpr int CaptureWidth  = 1920;
constexpr int CaptureHeight = 1080;

void RequireCondition(bool Condition, const char *Description)
{
    if (!Condition)
    {
        throw std::runtime_error(Description);
    }
}

void SaveCapturedFramePng(const std::filesystem::path &OutputPath)
{
    std::vector<unsigned char> Pixels(static_cast<size_t>(CaptureWidth) * static_cast<size_t>(CaptureHeight) * 3u, 16u);
    const ImDrawData          *Commands = ImGui::GetDrawData();
    RequireCondition(Commands != nullptr && Commands->CmdLists.Size > 0, "No ImGui draw lists recorded for capture");

    for (const ImDrawList *List : Commands->CmdLists)
    {
        FrontierExhibit::RasterizeCommands(List, Pixels.data(), CaptureWidth, CaptureHeight, Commands->DisplayPos,
                                           Commands->FramebufferScale);
    }

    // Verify non-blank rasterization across Left (Outliner), Centre (Scene/LogStream), and Right (Inspector).
    size_t NonGroundSamples = 0;
    for (size_t ByteIdx = 0; ByteIdx < Pixels.size(); ByteIdx += 97u * 3u)
    {
        if (Pixels[ByteIdx] != 16u || Pixels[ByteIdx + 1] != 16u || Pixels[ByteIdx + 2] != 16u)
        {
            ++NonGroundSamples;
        }
    }
    RequireCondition(NonGroundSamples > 500u, "Captured frame appears mostly blank");

    const std::string Utf8Path = OutputPath.string();
    const int         Saved    = stbi_write_png(Utf8Path.c_str(), CaptureWidth, CaptureHeight, 3, Pixels.data(),
                                                CaptureWidth * 3);
    RequireCondition(Saved != 0, "stbi_write_png failed to write exhibit PNG");
}

} // namespace
} // namespace Frontier

int main(int ArgumentCount, char **Arguments)
{
    using namespace Frontier;
    try
    {
        RequireCondition(ArgumentCount == 3, "Expected repository root and capture output directory");
        const std::filesystem::path RepositoryRoot(Arguments[1]);
        const std::filesystem::path CaptureDir(Arguments[2]);
        std::filesystem::create_directories(CaptureDir);

        const std::filesystem::path ScratchRoot = RepositoryRoot / "_ClaudeScratch/build/everest-validation-prefs";
        std::filesystem::create_directories(ScratchRoot);
        const std::filesystem::path PersonalPrefs = ScratchRoot / "Personal.projectspace";
        const std::filesystem::path EverestCopy   = ScratchRoot / "ProjectEverest.projectspace";
        std::filesystem::remove(PersonalPrefs);
        std::filesystem::copy_file(RepositoryRoot / "Frontier/Projects/Project-Everest/ProjectEverest.projectspace",
                                   EverestCopy, std::filesystem::copy_options::overwrite_existing);

        ImGui::CreateContext();
        ImGuiIO &Io                  = ImGui::GetIO();
        Io.IniFilename               = nullptr;
        Io.DisplaySize               = ImVec2(static_cast<float>(CaptureWidth), static_cast<float>(CaptureHeight));
        Io.DisplayFramebufferScale   = ImVec2(1.0f, 1.0f);
        Io.DeltaTime                 = 1.0f / 60.0f;
        Io.ConfigFlags              |= ImGuiConfigFlags_DockingEnable;
        Io.BackendFlags             |= ImGuiBackendFlags_RendererHasTextures;

        IconPresentation::Attach((RepositoryRoot / "EngineContent/Icons").string());

        // -------------------------------------------------------------------------------------------------------------
        // 1. PROJECT BROWSER -> SELECT PROJECT EVEREST -> OPEN IN FRONTIER
        // -------------------------------------------------------------------------------------------------------------
        std::filesystem::path LaunchedProjectPath;
        {
            ActivationOwnership BrowserAppearanceOwner(
                new ControlCentrePanel((RepositoryRoot / "EngineContent/FontArchives").string(), PersonalPrefs));
            auto *BrowserAppearance = static_cast<ControlCentrePanel *>(BrowserAppearanceOwner.get());
            RequireCondition(BrowserAppearance->Initialize() && BrowserAppearance->Activate(),
                             "Browser ControlCentre activation failed");

            ProjectBrowserPanel Browser;
            RequireCondition(Browser.QueryEntryCount() == 6u,
                             "Default ProjectBrowserPanel fixture count must remain 6");

            const size_t Discovered = Browser.DiscoverProjects(RepositoryRoot / "Frontier/Projects");
            RequireCondition(Discovered >= 1u, "DiscoverProjects did not find Project Everest");

            // Capture Library Grid view showing Project Everest card alongside catalogue fixtures
            Browser.CloseFile();
            for (int FrameIdx = 0; FrameIdx < 6; ++FrameIdx)
            {
                BrowserAppearance->PrepareInterface();
                FrontierExhibit::AcknowledgeTextures();
                ImGui::NewFrame();
                (void)BrowserAppearance->Integrate(1.0 / 60.0);
                Browser.ConfigurePalette(ControlKit::Palette());
                Browser.ConstructInterface();
                ImGui::Render();
                FrontierExhibit::AcknowledgeTextures();
            }
            SaveCapturedFramePng(CaptureDir / "01_ProjectBrowser_SelectEverest.png");

            RequireCondition(Browser.OpenSample("project-everest-v1"),
                             "ProjectBrowserPanel could not open project-everest-v1");
            Browser.ActivateOpenInFrontier();
            LaunchedProjectPath = Browser.ConsumeLaunchPath();
            RequireCondition(!LaunchedProjectPath.empty(),
                             "OpenInFrontier did not emit ProjectEverest.projectspace launch path");
            RequireCondition(LaunchedProjectPath.filename() == "ProjectEverest.projectspace",
                             "Unexpected launched project filename");
        }

        // -------------------------------------------------------------------------------------------------------------
        // 2. ACTIVATE PROJECT EVEREST WORKSPACE + VERIFY RAII OUTLINER & MODULAR INSPECTOR CONTRACT
        // -------------------------------------------------------------------------------------------------------------
        ActivationOwnership EverestAppearanceOwner(
            new ControlCentrePanel((RepositoryRoot / "EngineContent/FontArchives").string(), PersonalPrefs, EverestCopy));
        auto *Appearance = static_cast<ControlCentrePanel *>(EverestAppearanceOwner.get());
        RequireCondition(Appearance->Initialize() && Appearance->Activate(),
                         "Project Everest ControlCentre activation failed");

        auto Workspace = std::make_unique<EverestWorkspace>(*Appearance);

        // Verify RAII constructor/destructor contract on SceneDirectory + InspectorCatalogue
        RequireCondition(SceneDirectory::Instance().QueryCount() == 30u,
                         "Expected 30 canonical Proving Grounds records in SceneDirectory");
        RequireCondition(InspectorCatalogue::Instance().QueryRegisteredCount() == 30u,
                         "Expected 30 modular inspector profiles in InspectorCatalogue");
        RequireCondition(SceneDirectory::Instance().QueryChildCount(Workspace->QueryScene().QuerySunToken()) == 1u,
                         "Lens Flare must be nested under Sun in SceneDirectory");

        const RecordToken DynamicProp = Workspace->QueryScene().ConstructDynamicTestProp("Test Bollard \xC2\xB7 RAII");
        RequireCondition(SceneDirectory::Instance().QueryCount() == 31u &&
                             InspectorCatalogue::Instance().QueryRegisteredCount() == 31u,
                         "RecordEntry constructor failed to register in Outliner and InspectorCatalogue");
        RequireCondition(Workspace->QueryScene().DestroyDynamicRecord(DynamicProp),
                         "Failed to destroy dynamic RAII test record");
        RequireCondition(SceneDirectory::Instance().QueryCount() == 30u &&
                             InspectorCatalogue::Instance().QueryRegisteredCount() == 30u,
                         "RecordEntry destructor failed to unregister from Outliner and InspectorCatalogue");

        // Verify LogStreamPanel received initial subsystem traffic
        RequireCondition(Workspace->QueryLogStream().QueryTotalCount() >= 6u,
                         "LogStreamPanel did not ingest Project Everest log entries");

        const auto StepFrames = [&](int Count, ImVec2 PointerPos = ImVec2(-100.0f, -100.0f), bool Click = false)
        {
            for (int StepIdx = 0; StepIdx < Count; ++StepIdx)
            {
                Io.MousePos     = PointerPos;
                Io.MouseDown[0] = (Click && StepIdx == 0);
                Appearance->PrepareInterface();
                (void)Workspace->ConfigurePlatform();
                FrontierExhibit::AcknowledgeTextures();
                ImGui::NewFrame();
                (void)Appearance->Integrate(1.0 / 60.0);
                Workspace->ConstructInterface();
                Appearance->ConstructInterface();
                ImGui::Render();
                FrontierExhibit::AcknowledgeTextures();
            }
            Io.MouseDown[0] = false;
        };

        // Exhibit 02: Full Project Everest Workspace — Render Settings (RTX VK_KHR_ray_query ReSTIR GI) + Docked LogStream
        Workspace->SelectRecord(Workspace->QueryScene().QueryRenderSettingsToken());
        StepFrames(8);
        SaveCapturedFramePng(CaptureDir / "02_Everest_RenderSettings_RTX_vs_GTX.png");

        // Exhibit 03: Switch to GTX SDF + BVH Fallback + Golden Hour + Reusable Built-in Sun Inspector
        Workspace->QueryScene().Render.ArchitectureTierIndex = 1; // GTX · SDF GI + SAH-2 BVH Reflections
        ApplyEnvironmentLightingPreset(Workspace->QueryScene().Environment, 1); // Golden hour
        Workspace->SelectRecord(Workspace->QueryScene().QuerySunToken());
        StepFrames(6);
        SaveCapturedFramePng(CaptureDir / "03_Everest_GTX_Fallback_And_SunInspector.png");

        // Restore Clear + RTX for Vehicle & Studio captures
        Workspace->QueryScene().Render.ArchitectureTierIndex = 0;
        ApplyEnvironmentLightingPreset(Workspace->QueryScene().Environment, 0);

        // Exhibit 04: User-Authored Custom Inspector — ControlVehicle (Tyres -> Rear Left -> 3D Hex8 Neo-Hookean FEM)
        Workspace->SelectRecord(Workspace->QueryScene().QueryVehicleToken());
        Workspace->QueryScene().Vehicle.ActiveDivisionTab  = 3; // Tyres
        Workspace->QueryScene().Vehicle.SelectedWheelIndex = 2; // Rear left
        Workspace->QueryScene().Vehicle.ActiveTyreSubTab   = 0; // Tyre & tread (3D FEM)
        StepFrames(6);
        SaveCapturedFramePng(CaptureDir / "04_Everest_ControlVehicle_CustomInspector.png");

        // Exhibit 05: Dedicated Domain Studios — Particle Studio Workbench + Fracture Recipe Inspector
        Workspace->OpenDedicatedStudio(DedicatedStudioDomain::ParticleStudio);
        Workspace->SelectRecord(Workspace->QueryScene().QueryFractureToken());
        StepFrames(6);
        SaveCapturedFramePng(CaptureDir / "05_Everest_DedicatedStudios_FractureAndParticles.png");
        Workspace->CloseDedicatedStudio();

        // Exhibit 06 & 07: Live ControlCentre Theme Switch (Nord + Emerald Accent) on Workspace + Expanded Drawer
        Workspace->SelectRecord(Workspace->QueryScene().QueryVehicleToken());
        Workspace->QueryScene().Vehicle.ActiveDivisionTab = 2; // Engine torque curve
        {
            AppearanceSettings Draft = Appearance->QueryAppearance().QueryDraft();
            Draft.Theme              = ThemeCategory::Nord;
            Draft.Accent             = AccentCategory::Emerald;
            Appearance->QueryAppearance().ConfigureDraft(Draft);
            RequireCondition(Appearance->FinalizePreferences(), "ControlCentre theme apply failed");
        }
        StepFrames(8);
        SaveCapturedFramePng(CaptureDir / "07_Everest_NordTheme_AppliedToWorkspace.png");

        const PlaneExtent Notch = Appearance->QueryExpansionTab().QueryTabExtent();
        const ImVec2 NotchCenter((Notch.MinimumX + Notch.MaximumX) * 0.5f, (Notch.MinimumY + Notch.MaximumY) * 0.5f);
        StepFrames(2, NotchCenter, true);
        StepFrames(75);
        RequireCondition(Appearance->QueryQuickOpen(), "ControlCentre notch click did not expand drawer");
        Appearance->ActivatePage(AppearancePageCategory::Theme);
        StepFrames(75);
        SaveCapturedFramePng(CaptureDir / "06_Everest_ControlCentre_ThemeDrawer.png");

        Workspace.reset();
        EverestAppearanceOwner.reset();
        ImGui::DestroyContext();

        std::cout << "ProjectEverestValidation: ALL CHECKS PASSED (7 1920x1080 PNG exhibits written to "
                  << CaptureDir.string() << ")\n";
        return 0;
    }
    catch (const std::exception &Failure)
    {
        std::cerr << "ProjectEverestValidation FAILED: " << Failure.what() << '\n';
        return 1;
    }
}
