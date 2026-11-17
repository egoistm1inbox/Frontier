// Particle workspace validation: the U2 UI shell (top bar, outliner, Stage / Plan viewport, inspector pages,
// transport, log drawer, library, export preview) with scripted pointer interaction and PPM evidence per page.
// Value controls hold shell-local figures; commands raise NOOP toasts and warm log lines and change nothing.

#include "Frontier/Engine/Interface/Workspaces/ParticleWorkspace.h"
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
        ParticleWorkspaceState State{};
        ConstructParticleWorkspaceState(State);
        AssetBrowserLink Link{};

        const auto Frame = [&]()
        {
            ImGui::NewFrame();
            ConstructParticleWorkspace(State, Faces, IO.DisplaySize, &Link);
            ImGui::Render();
        };
        const auto RectCentre = [&](const char* Name)
        {
            ImVec2 Min{}, Max{};
            char   Missing[128]{};
            std::snprintf(Missing, sizeof(Missing), "Missing validation rect %s", Name);
            Confirm(QueryParticleWorkspaceRect(State, Name, Min, Max), Missing);
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

        // 1. Boot: the lab scene selects its first effect; the catalogue holds all 52 presets in PE.Presets order.
        Frame();
        Frame();
        Confirm(QueryParticlePresetCount() == 52, "The catalogue lost presets");
        Confirm(QueryParticlePresetById("sparks") == 0, "sparks is not preset 0");
        Confirm(QueryParticlePresetById("fireworks") == 31, "fireworks is not the last main preset");
        Confirm(QueryParticlePresetById("trim-trail") == 35, "The fibre presets are out of order");
        Confirm(QueryParticlePresetById("derez-cube") == 36, "The transition presets are out of order");
        Confirm(State.Selected == 0, "The workspace did not boot on the first lab effect");
        Confirm(!State.Log.empty(), "The boot produced no log lines");
        Confirm(State.Log.front().Channel == "WORKSPACE", "The boot line missed its WORKSPACE channel");
        Confirm(static_cast<int>(State.Effects.size()) == 4, "The lab scene lost effects");
        Confirm(static_cast<int>(State.Forces.size()) == 4, "The lab scene lost forces");
        Confirm(State.Effects[0].Parameters.Capacity == 3000, "The sparks capacity missed its preset figure");
        Confirm(State.Effects[1].Parameters.ReleaseShape == ParticleReleaseShape::Disc, "The leaves release missed its disc");
        RectCentre("Outliner/Scene");
        RectCentre("Outliner/Wind");
        RectCentre("Outliner/Effect0");
        RectCentre("Outliner/Effect3");
        RectCentre("Outliner/Force0");
        RectCentre("Outliner/Force3");
        RectCentre("Inspector/Tab0");
        RectCentre("Inspector/Tab3");
        RectCentre("Inspector/Effect/Action0");
        RectCentre("Inspector/Effect/Action2");
        RectCentre("Footer/Log");
        RectCentre("Surface/Stage");
        RectCentre("Transport/Play");
        RectCentre("Transport/Strike");
        RectCentre("Transport/Burst");
        RectCentre("Minimap");
        RectCentre("Probe");
        RectCentre("Legend");
        RectCentre("Hud/Readouts");
        RectCentre("Hud/Pill0");
        RectCentre("Hud/Pill2");
        RectCentre("Viewport/Camera");
        RectCentre("Viewport/Overlay");
        RectCentre("Toolbar/Mode0");
        RectCentre("Toolbar/Engine");

        // 2. Outliner selection swaps inspector pages: effect, scene, wind, force.
        Click("Outliner/Effect1");
        Confirm(State.Selected == 1, "Clicking Leaves did not select it");
        RectCentre("Inspector/Tab0");
        Click("Outliner/Scene");
        Confirm(State.Selected == ParticleWorkspaceState::SelectedScene, "Clicking the scene did not select it");
        RectCentre("Inspector/Scene/Action0");
        RectCentre("Inspector/Scene/Action2");
        {
            ImVec2 Min{}, Max{};
            Confirm(!QueryParticleWorkspaceRect(State, "Inspector/Tab0", Min, Max), "The scene page kept the effect tabs");
        }
        Click("Outliner/Wind");
        Confirm(State.Selected == ParticleWorkspaceState::SelectedWind, "Clicking Ambient Wind did not select it");
        RectCentre("Inspector/Wind/Action0");
        Click("Outliner/Force2");
        Confirm(State.Selected == ParticleWorkspaceState::SelectedForceBase + 2, "Clicking Tornado did not select it");
        RectCentre("Inspector/Force/Action0");
        RectCentre("Inspector/Force/Action1");
        Click("Outliner/Effect0");
        Confirm(State.Selected == 0, "Reselecting Sparks failed");

        // 3. Effect tabs switch the page body.
        Confirm(State.Effects[0].InspectorTab == 0, "The effect did not boot on Overview");
        Click("Inspector/Tab2");
        Confirm(State.Effects[0].InspectorTab == 2, "Clicking Motion did not switch tabs");
        Click("Inspector/Tab3");
        Confirm(State.Effects[0].InspectorTab == 3, "Clicking Modules did not switch tabs");
        Click("Inspector/Tab0");
        Confirm(State.Effects[0].InspectorTab == 0, "Clicking Overview did not switch back");

        // 4. Transport is a literal NOOP: toast + log, no state change. So are Strike and Burst.
        Click("Transport/Play");
        Confirm(!State.ClockPlaying, "The NOOP play key flipped the clock");
        Confirm(State.ClockTime == 0.0, "The NOOP play key moved the playhead");
        Confirm(Toast::QueryVisible(), "The NOOP play key raised no toast");
        Confirm(!State.Log.empty() && State.Log.front().Channel == "TRANSPORT", "The NOOP play key logged no TRANSPORT line");
        Click("Transport/Step");
        Confirm(State.ClockTime == 0.0, "The NOOP step key moved the playhead");
        Click("Transport/Speed1");
        Confirm(State.ClockRate == 1, "The NOOP speed key changed the rate");
        Click("Transport/Reset");
        Confirm(State.ClockTime == 0.0, "The NOOP reset key touched the clock");
        Click("Transport/Strike");
        Confirm(Toast::QueryVisible(), "Strike raised no toast");
        Confirm(!State.Log.empty() && State.Log.front().Channel == "STRIKE", "Strike logged no STRIKE line");
        Click("Transport/Burst");
        Confirm(Toast::QueryVisible(), "Burst raised no toast");
        Confirm(!State.Log.empty() && State.Log.front().Channel == "BURST", "Burst logged no BURST line");
        Click("Transport/Ruler");
        Confirm(Toast::QueryVisible(), "Scrubbing raised no toast");
        Confirm(State.ClockTime == 0.0, "Scrubbing moved the playhead");

        // 5. The log drawer opens, clears locally, and closes.
        Click("Footer/Log");
        Confirm(State.LogOpen, "The log pill did not open the drawer");
        RectCentre("Log/Clear");
        Confirm(!State.Log.empty(), "The log lost its lines before Clear");
        Click("Log/Clear");
        Confirm(State.Log.empty(), "Clear did not empty the shell-local log");
        Click("Footer/Log");
        Confirm(!State.LogOpen, "The log pill did not close the drawer");

        // 6. View modes swap the centre surface.
        Click("Toolbar/Mode1");
        Confirm(State.ViewMode == 1, "The Plan pill did not switch view modes");
        RectCentre("Surface/Plan");
        Click("Toolbar/Mode0");
        Confirm(State.ViewMode == 0, "The Stage pill did not switch back");

        // 7. The library delegates to the shared Asset Browser; the handoff refuses like the old card did.
        Click("Outliner/Scene");
        Click("Inspector/Scene/Action0");
        Confirm(State.LibraryOpen, "Open library did not open the library");
        RectCentre("Library/Browse");
        RectCentre("Library/Close");
        Click("Library/Browse");
        Confirm(!State.LibraryOpen, "The browse row did not close the library");
        Confirm(Link.OpenRequested, "The browse row did not request the browser");
        Confirm(Link.OpenWorkspace == AssetBrowserWorkspaceParticle, "The browse row requested the wrong workspace");
        Link.OpenRequested = false;
        Link.OpenWorkspace = -1;
        std::snprintf(Link.OpenRecordId, sizeof(Link.OpenRecordId), "particle/sparks");
        Link.OpenRecordWorkspace = AssetBrowserWorkspaceParticle;
        Frame();
        Frame();
        Confirm(!Link.HasHandoff(), "The shell did not consume the handoff");
        Confirm(Toast::QueryVisible(), "The handoff raised no toast");
        Confirm(!State.Log.empty() && State.Log.front().Channel == "LIBRARY", "The handoff logged no LIBRARY line");
        Confirm(static_cast<int>(State.Effects.size()) == 4, "The NOOP handoff mutated the scene");

        // 8. The export preview renders shell state only; downloading refuses.
        Click("Inspector/Scene/Action1");
        Confirm(State.ExportOpen, "Export TOML did not open the preview");
        Confirm(State.ExportText.find("scene = \"lab\"") != std::string::npos, "The export preview lost the scene line");
        Confirm(State.ExportText.find("identifier = \"sparks\"") != std::string::npos, "The export preview lost sparks");
        Confirm(State.ExportText.find("capacity = 3000") != std::string::npos, "The export preview lost the sparks capacity");
        Confirm(State.ExportText.find("behaviour = \"ballistic\"") != std::string::npos, "The export preview lost the behaviour");
        RectCentre("Export/Download");
        RectCentre("Export/Close");
        Click("Export/Download");
        Confirm(State.ExportOpen, "The NOOP download closed the preview");
        Confirm(Toast::QueryVisible(), "The NOOP download raised no toast");
        Click("Export/Close");
        Confirm(!State.ExportOpen, "The export close key did not close the preview");

        // 9. Scene tabs, add, remove, copy, and reset-all refuse with NOOP toasts and keep the scene.
        Click("Top/Scenario1");
        Confirm(State.Scene == 0, "The NOOP scene tab switched the scene");
        Confirm(Toast::QueryVisible(), "The NOOP scene tab raised no toast");
        Click("Outliner/Add");
        Confirm(static_cast<int>(State.Effects.size()) == 4, "The NOOP add key mutated the scene");
        Confirm(Toast::QueryVisible(), "The NOOP add key raised no toast");
        Click("Outliner/Effect0");
        Click("Inspector/Effect/Action2");
        Confirm(static_cast<int>(State.Effects.size()) == 4, "The NOOP remove key mutated the scene");
        Confirm(Toast::QueryVisible(), "The NOOP remove key raised no toast");
        Click("Inspector/Effect/Action1");
        Confirm(Toast::QueryVisible(), "The NOOP copy key raised no toast");
        Click("Outliner/Scene");
        Click("Inspector/Scene/Action2");
        Confirm(Toast::QueryVisible(), "The NOOP reset-all key raised no toast");

        // 10. HUD pills flip local overlays; the outliner eye flips the effect.
        const bool TrailsWere = State.ShowTrails;
        Click("Hud/Pill0");
        Confirm(State.ShowTrails != TrailsWere, "The HUD Trails pill did not flip");
        Confirm(!State.Log.empty() && State.Log.front().Channel == "VIEW", "The HUD pill logged no VIEW line");
        const bool EffectWas = State.Effects[3].Enabled;
        Click("Outliner/Effect3/Eye");
        Confirm(State.Effects[3].Enabled != EffectWas, "The outliner eye did not flip the effect");

        // 11. The camera select restages silently; its option rects exist only while open.
        {
            const size_t LogSize = State.Log.size();
            Click("Viewport/Camera");
            RectCentre("Viewport/Camera/Option0");
            RectCentre("Viewport/Camera/Option2");
            Click("Viewport/Camera/Option1");
            Confirm(State.Camera == 1, "The camera option did not restage");
            Confirm(State.Log.size() == LogSize, "The silent camera select logged");
            Frame();
            ImVec2 Min{}, Max{};
            Confirm(!QueryParticleWorkspaceRect(State, "Viewport/Camera/Option1", Min, Max),
                    "The camera option rect survived the popup");
        }

        // 12. The minimap pick retargets the probe and logs VIEW.
        Click("Minimap");
        Confirm(State.FollowTarget >= 0 && State.FollowTarget < 4, "The minimap pick missed every effect");
        Confirm(!State.Log.empty() && State.Log.front().Channel == "VIEW", "The minimap pick logged no VIEW line");

        // 13. Stage drags orbit silently.
        {
            const size_t LogSize = State.Log.size();
            const double YawWas  = State.OrbitYaw;
            Drag("Surface/Stage", 40.0f, 0.0f);
            Confirm(State.OrbitYaw != YawWas, "Dragging the stage did not orbit");
            Confirm(State.Log.size() == LogSize, "The silent orbit logged");
        }

        // 14. Effect reset restores the preset locally.
        Click("Outliner/Effect0");
        State.Effects[0].Parameters.ReleaseRate = 999.0;
        Frame();
        Click("Inspector/Effect/Action0");
        Confirm(State.Effects[0].Parameters.ReleaseRate == 160.0, "Reset did not restore the sparks rate");
        Confirm(Toast::QueryVisible(), "Reset raised no toast");
        Confirm(!State.Log.empty() && State.Log.front().Channel == "EFFECT", "Reset logged no EFFECT line");

        // 15. Evidence: one frame per inspector page family.
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
            if (!Image) throw std::runtime_error("Could not write Particle workspace PPM evidence");
        };
        if (ArgumentCount >= 2)
        {
            std::string Stem = Arguments[1];
            const size_t Dot = Stem.rfind(".ppm");
            if (Dot != std::string::npos && Dot + 4 == Stem.size()) Stem.erase(Dot);
            Click("Outliner/Effect0");
            RenderEvidence((Stem + "-effect.ppm").c_str());
            Click("Inspector/Tab3");
            RenderEvidence((Stem + "-modules.ppm").c_str());
            Click("Outliner/Scene");
            RenderEvidence((Stem + "-scene.ppm").c_str());
            Click("Outliner/Wind");
            RenderEvidence((Stem + "-wind.ppm").c_str());
            Click("Outliner/Force2");
            RenderEvidence((Stem + "-force.ppm").c_str());
        }

        std::fprintf(stdout, "ParticleWorkspaceValidation: boot/select/tabs/transport/NOOP/log/mode/library/export/HUD/camera/minimap/orbit/reset checks passed\n");
        ImGui::DestroyContext();
        return 0;
    }
    catch (const std::exception& Failure)
    {
        ImGui::DestroyContext();
        std::fprintf(stderr, "ParticleWorkspaceValidation: %s\n", Failure.what());
        return 1;
    }
}
