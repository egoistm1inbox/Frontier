// Fluid workspace validation: the U3 UI shell (top bar, scene outliner, preset library, viewport bar, plume stage,
// transport, timeline, Source / Simulation / Rendering inspector, bake dialog, log drawer, status bar) with scripted
// pointer interaction and PPM evidence per tab. Value controls hold shell-local figures; commands raise NOOP toasts
// and warm log lines and change nothing.

#include "Frontier/Engine/Interface/Workspaces/FluidWorkspace.h"
#include "Frontier/Engine/Interface/Controls/Toast.h"
#include "Frontier/Engine/Interface/InspectorControls.h"
#include "Engine/Interface/TypefaceRegistry.h"
#include "Exhibits/ControlCentre/Code/CpuRasterization.h"

#include <imgui.h>

#include <cstdio>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace
{

void Confirm(bool Condition, const char* Description)
{
    if (!Condition) throw std::runtime_error(Description);
}

} // namespace

int main(int ArgumentCount, char** Arguments)
{
    using namespace Frontier;
    try
    {
        ImGui::CreateContext();
        ImGui::StyleColorsDark();
        ImGuiIO& IO = ImGui::GetIO();
        IO.DisplaySize = ImVec2(1560.0f, 1900.0f);
        IO.DeltaTime = 1.0f / 60.0f;
        // 📝 Production typefaces (DM Sans + the JetBrains Mono symbol fallback) so evidence matches the app;
        //    argv[2] is the font-archive root, defaulting to the in-tree EngineContent path.
        TypefaceRegistry   FontRegistry;
        static const char* WantedFonts[] = { "DM Sans", "JetBrains Mono" };
        const char*        ArchiveRoot   = ArgumentCount >= 3 ? Arguments[2] : "EngineContent/FontArchives";
        const uint32_t     FontFamilies  = FontRegistry.Load(ArchiveRoot, WantedFonts, 2);
        if (ArgumentCount >= 3) Confirm(FontFamilies == 2, "The font archive root did not yield DM Sans and JetBrains Mono");
        if (FontFamilies == 0) IO.Fonts->AddFontDefault();
        else TypefaceRegistry::Install(&FontRegistry);
        IO.Fonts->Build();

        const EditorTypefaces Faces = EditorTypefaces::Resolve();
        FluidWorkspaceState State{};
        ConstructFluidWorkspaceState(State);
        AssetBrowserLink Link{};

        const auto Frame = [&]()
        {
            ImGui::NewFrame();
            ConstructFluidWorkspace(State, Faces, IO.DisplaySize, &Link);
            ImGui::Render();
        };
        const auto RectCentre = [&](const char* Name)
        {
            ImVec2 Min{}, Max{};
            char   Missing[128]{};
            std::snprintf(Missing, sizeof(Missing), "Missing validation rect %s", Name);
            Confirm(QueryFluidWorkspaceRect(State, Name, Min, Max), Missing);
            Confirm(Max.x > Min.x && Max.y > Min.y, Missing);
            return ImVec2(0.5f * (Min.x + Max.x), 0.5f * (Min.y + Max.y));
        };
        const auto Click = [&](const char* Name)
        {
            const ImVec2 At = RectCentre(Name);
            IO.AddMousePosEvent(At.x, At.y);
            Frame();
            IO.AddMouseButtonEvent(ImGuiMouseButton_Left, true);
            Frame();
            IO.AddMouseButtonEvent(ImGuiMouseButton_Left, false);
            Frame();
            Frame();
        };
        const auto Drag = [&](const char* Name, float Dx, float Dy)
        {
            const ImVec2 At = RectCentre(Name);
            IO.AddMousePosEvent(At.x, At.y);
            Frame();
            IO.AddMouseButtonEvent(ImGuiMouseButton_Left, true);
            Frame();
            IO.AddMousePosEvent(At.x + Dx, At.y + Dy);
            Frame();
            Frame();
            IO.AddMouseButtonEvent(ImGuiMouseButton_Left, false);
            Frame();
            Frame();
        };

        // 1. Boot: the emitter selects with the Source tab; the catalogue holds all 18 presets in pinned order.
        Frame();
        Frame();
        Confirm(QueryFluidPresetCount() == 18, "The catalogue lost presets");
        Confirm(QueryFluidPresetById("ue5_pyro_default") == 0, "Pyro plume is not preset 0");
        Confirm(QueryFluidPresetById("obstacle_deflection") == 5, "Smoke deflection is out of order");
        Confirm(QueryFluidPresetById("small_gust") == 13, "Small gust is out of order");
        Confirm(QueryFluidPresetById("low_gpu_performance") == 17, "Lightweight plume is not the last preset");
        Confirm(State.Selected == FluidWorkspaceState::SelectedEmitter, "The workspace did not boot on the fire emitter");
        Confirm(State.InspectorTab == FluidWorkspaceState::TabSource, "The inspector did not boot on Source");
        Confirm(State.Log.size() == 1, "The boot produced the wrong number of log lines");
        Confirm(State.Log.front().Channel == "WORKSPACE", "The boot line missed its WORKSPACE channel");
        Confirm(State.Parameters.GridResolution == 48, "The grid missed its 48 default");
        Confirm(State.Parameters.EmitterRate == 1.0, "The emission rate missed its default");
        Confirm(State.Parameters.ObstacleType == 0, "The collider missed its None default");
        Confirm(State.Parameters.SunIntensity == 2.2, "The sun missed its default");
        Confirm(State.Parameters.ShowFloorGrid, "The floor grid missed its default");
        Confirm(!State.Parameters.ShowBoundingBox, "The bounds overlay missed its default");
        RectCentre("Outliner/Row0");
        RectCentre("Outliner/Row3");
        RectCentre("Outliner/Eye1");
        RectCentre("Outliner/Eye3");
        RectCentre("Outliner/Filter0");
        RectCentre("Outliner/Filter3");
        RectCentre("Outliner/Add");
        RectCentre("Inspector/Tab0");
        RectCentre("Inspector/Tab2");
        RectCentre("Inspector/Reset");
        RectCentre("Footer/Log");
        RectCentre("Surface/Plume");
        RectCentre("Surface/Tool0");
        RectCentre("Surface/Tool2");
        RectCentre("Surface/Turntable");
        RectCentre("Transport/Reset");
        RectCentre("Transport/Play");
        RectCentre("Transport/Step");
        RectCentre("Transport/Speed");
        RectCentre("Transport/BurstKind");
        RectCentre("Transport/Trigger");
        RectCentre("Timeline/Ruler");
        RectCentre("Viewport/Camera");
        RectCentre("Viewport/Flipbook");
        RectCentre("Viewport/Diagnostics");
        RectCentre("Viewport/Channel");
        RectCentre("Viewport/Overlays");
        RectCentre("Viewport/Focus");
        RectCentre("Viewport/Maximize");
        RectCentre("Library/Browse");
        RectCentre("TopBar/Doc");
        RectCentre("TopBar/Add");
        RectCentre("TopBar/Samples");
        RectCentre("TopBar/Import");
        RectCentre("TopBar/Export");
        RectCentre("TopBar/Help");
        {
            ImVec2 Min{}, Max{};
            Confirm(!QueryFluidWorkspaceRect(State, "Bake/Close", Min, Max), "The bake dialog leaked rects while closed");
        }

        // 2. Outliner selection maps nodes to tabs: collider/emitter to Source, domain to Simulation, sun to Rendering.
        Click("Outliner/Row2");
        Confirm(State.Selected == 2, "Clicking the collider did not select it");
        Confirm(State.InspectorTab == FluidWorkspaceState::TabSource, "The collider missed the Source tab");
        Confirm(State.OpenCollider, "Selecting the collider did not open its group");
        Click("Outliner/Row0");
        Confirm(State.Selected == 0, "Clicking the domain did not select it");
        Confirm(State.InspectorTab == FluidWorkspaceState::TabSimulation, "The domain missed the Simulation tab");
        Click("Outliner/Row3");
        Confirm(State.Selected == 3, "Clicking the sun did not select it");
        Confirm(State.InspectorTab == FluidWorkspaceState::TabRendering, "The sun missed the Rendering tab");
        Confirm(State.OpenLight, "Selecting the sun did not open its group");
        Click("Outliner/Row1");
        Confirm(State.Selected == 1, "Reselecting the emitter failed");
        Confirm(State.InspectorTab == FluidWorkspaceState::TabSource, "The emitter missed the Source tab");

        // 3. Inspector tabs switch the page body on any selection.
        Click("Inspector/Tab1");
        Confirm(State.InspectorTab == 1, "Clicking Simulation did not switch tabs");
        Click("Inspector/Tab2");
        Confirm(State.InspectorTab == 2, "Clicking Rendering did not switch tabs");
        Click("Inspector/Tab0");
        Confirm(State.InspectorTab == 0, "Clicking Source did not switch back");

        // 4. Transport: play and speed are silent local view state; step, reset, trigger, and scrub refuse.
        {
            const size_t LogSize = State.Log.size();
            Click("Transport/Play");
            Confirm(State.Parameters.Paused, "The play key did not pause the shell clock");
            Confirm(State.Log.size() == LogSize, "The silent play key logged");
            Click("Transport/Play");
            Confirm(!State.Parameters.Paused, "The play key did not resume");
        }
        Click("Transport/Step");
        Confirm(Toast::QueryVisible(), "The NOOP step key raised no toast");
        Confirm(!State.Log.empty() && State.Log.front().Channel == "TRANSPORT", "The NOOP step key logged no TRANSPORT line");
        Click("Transport/Reset");
        Confirm(Toast::QueryVisible(), "The NOOP reset key raised no toast");
        {
            const size_t LogSize = State.Log.size();
            Click("Transport/Speed");
            RectCentre("Transport/Speed/Option0");
            RectCentre("Transport/Speed/Option3");
            Click("Transport/Speed/Option3");
            Confirm(State.Parameters.TimeScale == 2.0, "The speed option did not restage the time scale");
            Confirm(State.Log.size() == LogSize, "The silent speed select logged");
            Click("Transport/Speed");
            Click("Transport/Speed/Option2");
            Confirm(State.Parameters.TimeScale == 1.0, "The speed option did not restore 1.0×");
        }
        Click("Transport/Trigger");
        Confirm(Toast::QueryVisible(), "Trigger raised no toast");
        Confirm(!State.Log.empty() && State.Log.front().Channel == "TRANSPORT", "Trigger logged no TRANSPORT line");
        Click("Timeline/Ruler");
        Confirm(Toast::QueryVisible(), "Scrubbing raised no toast");

        // 5. The log drawer opens, clears locally, and closes.
        Click("Footer/Log");
        Confirm(State.LogOpen, "The log pill did not open the drawer");
        RectCentre("Log/Clear");
        Confirm(!State.Log.empty(), "The log lost its lines before Clear");
        Click("Log/Clear");
        Confirm(State.Log.empty(), "Clear did not empty the shell-local log");
        Click("Footer/Log");
        Confirm(!State.LogOpen, "The log pill did not close the drawer");

        // 6. Viewport bar: camera restages silently, channel logs, overlays flip, diagnostics/focus/maximize refuse.
        {
            const size_t LogSize = State.Log.size();
            Click("Viewport/Camera");
            RectCentre("Viewport/Camera/Option0");
            RectCentre("Viewport/Camera/Option3");
            Click("Viewport/Camera/Option2");
            Confirm(State.Camera == 2, "The camera option did not restage");
            Confirm(State.Log.size() == LogSize, "The silent camera select logged");
            Frame();
            ImVec2 Min{}, Max{};
            Confirm(!QueryFluidWorkspaceRect(State, "Viewport/Camera/Option2", Min, Max),
                    "The camera option rect survived the popup");
            Click("Viewport/Camera");
            Click("Viewport/Camera/Option0");
            Confirm(State.Camera == 0, "The camera option did not restore Perspective");
        }
        Click("Viewport/Channel");
        RectCentre("Viewport/Channel/Option0");
        RectCentre("Viewport/Channel/Option8");
        Click("Viewport/Channel/Option4");
        Confirm(State.Parameters.RenderChannel == 4, "The channel option did not restage");
        Confirm(!State.Log.empty() && State.Log.front().Channel == "RENDER", "The channel select logged no RENDER line");
        Click("Viewport/Channel");
        Click("Viewport/Channel/Option0");
        const bool BoundsWere = State.Parameters.ShowBoundingBox;
        Click("Viewport/Overlays");
        Confirm(State.Parameters.ShowBoundingBox != BoundsWere, "The overlays key did not flip the bounds");
        Confirm(!State.Log.empty() && State.Log.front().Channel == "RENDER", "The overlays key logged no RENDER line");
        Click("Viewport/Overlays");
        Click("Viewport/Diagnostics");
        Confirm(Toast::QueryVisible(), "Diagnostics raised no toast");
        Click("Viewport/Focus");
        Confirm(Toast::QueryVisible(), "Focus raised no toast");
        Click("Viewport/Maximize");
        Confirm(Toast::QueryVisible(), "Maximize raised no toast");

        // 7. The library delegates to the shared Asset Browser; the handoff refuses like the old card did.
        Click("Library/Browse");
        Confirm(Link.OpenRequested, "The browse row did not request the browser");
        Confirm(Link.OpenWorkspace == AssetBrowserWorkspaceFluid, "The browse row requested the wrong workspace");
        Link.OpenRequested = false;
        Link.OpenWorkspace = -1;
        std::snprintf(Link.OpenRecordId, sizeof(Link.OpenRecordId), "fluid/ue5_pyro_default");
        Link.OpenRecordWorkspace = AssetBrowserWorkspaceFluid;
        Frame();
        Frame();
        Confirm(!Link.HasHandoff(), "The shell did not consume the handoff");
        Confirm(Toast::QueryVisible(), "The handoff raised no toast");
        Confirm(!State.Log.empty() && State.Log.front().Channel == "LIBRARY", "The handoff logged no LIBRARY line");

        // 8. The bake dialog stages settings locally; baking refuses, cancel/close dismiss silently.
        Click("Viewport/Flipbook");
        Confirm(State.BakeOpen, "Flipbook did not open the bake dialog");
        RectCentre("Bake/Frames");
        RectCentre("Bake/Size");
        RectCentre("Bake/Rate");
        RectCentre("Bake/WarmUp");
        RectCentre("Bake/Transparent");
        RectCentre("Bake/Burst");
        RectCentre("Bake/Start");
        RectCentre("Bake/Cancel");
        RectCentre("Bake/Close");
        Click("Bake/WarmUp");
        Confirm(State.BakeWarmup == 0.30, "The warm-up stepper did not stage");
        Click("Bake/Frames");
        Click("Bake/Frames/Option3");
        Confirm(State.BakeCount == 64, "The frames option did not stage");
        const bool TransparentWas = State.BakeTransparent;
        Click("Bake/Transparent");
        Confirm(State.BakeTransparent != TransparentWas, "The transparent pill did not flip");
        Click("Bake/Start");
        Confirm(!State.BakeOpen, "The NOOP bake key left the dialog open");
        Confirm(Toast::QueryVisible(), "The NOOP bake key raised no toast");
        Confirm(!State.Log.empty() && State.Log.front().Channel == "BAKE", "The NOOP bake key logged no BAKE line");
        Click("Viewport/Flipbook");
        Confirm(State.BakeOpen, "Flipbook did not reopen the bake dialog");
        Click("Bake/Cancel");
        Confirm(!State.BakeOpen, "Cancel did not close the bake dialog");
        Click("Viewport/Flipbook");
        Click("Bake/Close");
        Confirm(!State.BakeOpen, "The bake close key did not close the dialog");

        // 9. Top-bar suite keys refuse with NOOP toasts.
        Click("TopBar/Add");
        Confirm(Toast::QueryVisible(), "The NOOP add key raised no toast");
        Click("TopBar/Samples");
        Confirm(Toast::QueryVisible(), "Samples raised no toast");
        Click("TopBar/Import");
        Confirm(Toast::QueryVisible(), "Import raised no toast");
        Click("TopBar/Export");
        Confirm(Toast::QueryVisible(), "Export raised no toast");
        Click("TopBar/Help");
        Confirm(Toast::QueryVisible(), "Help raised no toast");

        // 10. Outliner filters narrow locally; eyes flip nodes; add refuses.
        Click("Outliner/Filter2");
        {
            ImVec2 Min{}, Max{};
            Confirm(!QueryFluidWorkspaceRect(State, "Outliner/Row0", Min, Max), "The geometry filter kept the domain");
        }
        RectCentre("Outliner/Row2");
        Click("Outliner/Filter0");
        RectCentre("Outliner/Row0");
        Click("Outliner/Eye1");
        Confirm(!State.Parameters.EmitterEnabled, "The emitter eye did not mute");
        Confirm(!State.Log.empty() && State.Log.front().Channel == "SCENE", "The emitter eye logged no SCENE line");
        Click("Outliner/Eye1");
        Confirm(State.Parameters.EmitterEnabled, "The emitter eye did not restore");
        Click("Outliner/Eye2");
        Confirm(State.Parameters.ObstacleType == 1, "The collider eye did not stage a sphere");
        Click("Outliner/Eye2");
        Confirm(State.Parameters.ObstacleType == 0, "The collider eye did not clear");
        Click("Outliner/Eye3");
        Confirm(State.Parameters.SunIntensity == 0.0, "The sun eye did not mute");
        Click("Outliner/Eye3");
        Confirm(State.Parameters.SunIntensity == 2.2, "The sun eye did not restore the intensity");
        Click("Outliner/Add");
        Confirm(Toast::QueryVisible(), "The NOOP outliner add raised no toast");

        // 11. Tools switch silently, turntable logs, plume drags orbit silently.
        {
            const size_t LogSize = State.Log.size();
            Click("Surface/Tool1");
            Confirm(State.Tool == 1, "The brush tool did not stage");
            Confirm(State.Log.size() == LogSize, "The silent tool switch logged");
            Click("Surface/Tool0");
            Confirm(State.Tool == 0, "The orbit tool did not restore");
        }
        Click("Surface/Turntable");
        Confirm(State.Parameters.AutoTurntable, "Turntable did not stage");
        Confirm(!State.Log.empty() && State.Log.front().Channel == "VIEW", "Turntable logged no VIEW line");
        Click("Surface/Turntable");
        Confirm(!State.Parameters.AutoTurntable, "Turntable did not restore");
        {
            const size_t LogSize = State.Log.size();
            const double YawWas  = State.OrbitYaw;
            Drag("Surface/Plume", 40.0f, 0.0f);
            Confirm(State.OrbitYaw != YawWas, "Dragging the plume did not orbit");
            Confirm(State.Log.size() == LogSize, "The silent orbit logged");
        }

        // 12. Inspector reset restores the staged tab locally.
        Click("Outliner/Row1");
        State.Parameters.EmitterRate = 999.0;
        Frame();
        Click("Inspector/Reset");
        Confirm(State.Parameters.EmitterRate == 1.0, "Reset did not restore the emission rate");
        Confirm(Toast::QueryVisible(), "Reset raised no toast");
        Confirm(!State.Log.empty() && State.Log.front().Channel == "SCENE", "Reset logged no SCENE line");

        // 13. Evidence: one frame per inspector tab.
        const auto RenderEvidence = [&](const char* Path)
        {
            IO.AddMousePosEvent(-1.0f, -1.0f);
            Frame();
            FrontierExhibit::AcknowledgeTextures();
            const int Width  = static_cast<int>(IO.DisplaySize.x * IO.DisplayFramebufferScale.x);
            const int Height = static_cast<int>(IO.DisplaySize.y * IO.DisplayFramebufferScale.y);
            std::vector<unsigned char> Pixels(static_cast<size_t>(Width) * Height * 3, 0x18);
            const ImDrawData* DrawData = ImGui::GetDrawData();
            for (const ImDrawList* DrawList : DrawData->CmdLists)
                FrontierExhibit::RasterizeCommands(DrawList, Pixels.data(), Width, Height, DrawData->DisplayPos, DrawData->FramebufferScale);
            std::ofstream Image(Path, std::ios::binary);
            Image << "P6\n" << Width << ' ' << Height << "\n255\n";
            Image.write(reinterpret_cast<const char*>(Pixels.data()), static_cast<std::streamsize>(Pixels.size()));
            if (!Image) throw std::runtime_error("Could not write Fluid workspace PPM evidence");
        };
        if (ArgumentCount >= 2)
        {
            std::string Stem = Arguments[1];
            const size_t Dot = Stem.rfind(".ppm");
            if (Dot != std::string::npos && Dot + 4 == Stem.size()) Stem.erase(Dot);
            Click("Outliner/Row1");
            RenderEvidence((Stem + "-source.ppm").c_str());
            Click("Outliner/Row0");
            RenderEvidence((Stem + "-simulation.ppm").c_str());
            Click("Outliner/Row3");
            RenderEvidence((Stem + "-rendering.ppm").c_str());
        }

        std::fprintf(stdout, "FluidWorkspaceValidation: boot/select/tabs/transport/log/viewport/library/bake/topbar/outliner/tools/reset checks passed\n");
        ImGui::DestroyContext();
        return 0;
    }
    catch (const std::exception& Failure)
    {
        ImGui::DestroyContext();
        std::fprintf(stderr, "FluidWorkspaceValidation: %s\n", Failure.what());
        return 1;
    }
}
