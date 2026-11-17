// UV workspace validation: the U6 UI shell (asset tab bar, island outliner with importance buckets, UDIM
// chips, selection-mode/tool/pivot/snap/lens/shade HUD, split 2D atlas + 3D mesh stage, Blender operator dock,
// log drawer, status bar, 4-tab inspector, hotkey sheet) with scripted pointer interaction and PPM evidence per
// showcase state. Value controls hold shell-local figures and log PARAM lines; solver-bound commands raise NOOP
// toasts and warm log lines and change nothing.

#include "Frontier/Engine/Interface/Workspaces/UvWorkspace.h"
#include "Frontier/Engine/Interface/Controls/Toast.h"
#include "Frontier/Engine/Interface/InspectorControls.h"
#include "Engine/Interface/TypefaceRegistry.h"
#include "Exhibits/ControlCentre/Code/CpuRasterization.h"

#include <imgui.h>

#include <cmath>
#include <cstdio>
#include <cstring>
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
        UvWorkspaceState State{};
        ConstructUvWorkspaceState(State);
        AssetBrowserLink Link{};

        const auto Frame = [&]()
        {
            ImGui::NewFrame();
            ConstructUvWorkspace(State, Faces, IO.DisplaySize, &Link);
            ImGui::Render();
        };
        const auto RectCentre = [&](const char* Name)
        {
            ImVec2 Min{}, Max{};
            char   Missing[128]{};
            std::snprintf(Missing, sizeof(Missing), "Missing validation rect %s", Name);
            Confirm(QueryUvWorkspaceRect(State, Name, Min, Max), Missing);
            Confirm(Max.x > Min.x && Max.y > Min.y, Missing);
            return ImVec2(0.5f * (Min.x + Max.x), 0.5f * (Min.y + Max.y));
        };
        const auto HasRect = [&](const char* Name)
        {
            ImVec2 Min{}, Max{};
            return QueryUvWorkspaceRect(State, Name, Min, Max) && Max.x > Min.x && Max.y > Min.y;
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

        // 1. Boot: the studio opens on the Aero Coupe GT with the packing tab; catalogues hold pinned order and
        //    the closed-form shares reproduce the Node budgets exactly.
        Frame();
        Frame();
        Confirm(QueryUvAssetCount() == 4, "The asset catalogue lost entries");
        Confirm(std::strcmp(QueryUvAsset(0).Label, "Aero Coupe GT") == 0, "The coupe is out of order");
        Confirm(std::strcmp(QueryUvAsset(3).Label, "UDIM Arch Kit") == 0, "The arch kit is out of order");
        Confirm(QueryUvIslandCount(0) == 30, "The coupe lost islands");
        Confirm(QueryUvIslandCount(1) == 20, "The crate lost islands");
        Confirm(QueryUvIslandCount(2) == 15, "The bust lost islands");
        Confirm(QueryUvIslandCount(3) == 20, "The arch kit lost islands");
        Confirm(QueryUvGroupCount(0) == 2 && QueryUvGroupCount(3) == 4, "Group tables drifted");
        Confirm(std::strcmp(QueryUvGroup(0, 0).Name, "Hero Body Panels") == 0, "The hero group drifted");
        Confirm(QueryUvTileCount(0) == 2 && QueryUvTileCount(3) == 4, "Tile tables drifted");
        Confirm(QueryUvTile(3, 3).Resolution == 1024, "The hardware tile lost its 1K resolution");
        Confirm(QueryUvSelectionModeCount() == 4 && QueryUvToolCount() == 8, "Mode/tool tables drifted");
        Confirm(QueryUvLensCount() == 6 && QueryUvShadeCount() == 7, "Lens/shade tables drifted");
        Confirm(State.Asset == 0, "The workspace did not boot the coupe");
        Confirm(State.InspectorTab == UvWorkspaceState::TabPacking, "The workspace did not boot packing");
        Confirm(State.SelectionMode == UvWorkspaceState::ModeIsland, "The workspace did not boot island mode");
        Confirm(State.Tool == UvWorkspaceState::ToolSelect, "The workspace did not boot the select tool");
        Confirm(State.StageMode == UvWorkspaceState::StageSplit, "The workspace did not boot split stage");
        Confirm(State.Lens == UvWorkspaceState::LensImportance, "The workspace did not boot the importance lens");
        Confirm(State.Shade == UvWorkspaceState::ShadeChecker, "The workspace did not boot the checker shading");
        Confirm(State.ActiveUdim == 1001, "The workspace did not boot UDIM 1001");
        Confirm(State.Selected == -1, "The workspace booted with a stray selection");
        Confirm(std::fabs(State.SmartAngleDeg - 55.0) < 1.0e-9, "The smart angle missed 55°");
        Confirm(std::fabs(State.MarginPx - 12.0) < 1.0e-9, "The pack margin missed 12 px");
        Confirm(State.Log.size() == 1, "The boot produced the wrong number of log lines");
        Confirm(State.Log.front().Channel == "DOC", "The boot line missed its DOC channel");
        Confirm(std::fabs(QueryUvGroupActualShare(0, 0) - 70.0) < 0.75, "The hero share left its 70% band");
        Confirm(std::fabs(QueryUvGroupActualShare(0, 1) - 10.0) < 0.75, "The trim share left its 10% band");
        Confirm(std::fabs(QueryUvRemainderActualShare(0) - 20.0) < 0.75, "The remainder left its 20% band");
        Confirm(std::fabs(QueryUvTileOccupancy(0, 1001) - 76.65) < 0.75, "The tile occupancy left its band");
        Confirm(QueryUvOverlapCount(0) == 0 && QueryUvFlippedCount(0) == 0, "The coupe is not clean");
        Confirm(QueryUvAsset(0).MeanStretchPct > 17.0 && QueryUvAsset(0).MeanStretchPct < 18.5,
                "The coupe stretch left its 17-18.5% band");

        // 2. Outliner: island rows select silently; eye and lock keys flip shell-local flags with PARAM lines.
        Click("Outliner/Row0");
        Confirm(State.Selected == 0, "Clicking the hood did not select it");
        Confirm(State.IslandPicked[0], "The hood pick did not latch");
        Click("Outliner/Row4");
        Confirm(State.Selected == 4, "Clicking the decklid did not select it");
        Confirm(!State.IslandPicked[0], "The hood pick survived a fresh click");
        Click("Outliner/Eye4");
        Confirm(State.IslandHidden[4], "The decklid eye did not hide it");
        Confirm(State.Log.front().Channel == "PARAM", "The hide missed its PARAM channel");
        Click("Outliner/Eye4");
        Confirm(!State.IslandHidden[4], "The decklid eye did not restore it");
        Click("Outliner/Lock4");
        Confirm(State.IslandLocked[4], "The decklid lock did not latch");
        Click("Outliner/Lock4");
        Confirm(!State.IslandLocked[4], "The decklid lock did not release");
        Click("Outliner/Row0");

        // 3. Filters: selected/grouped/issues narrow the rows; All restores them.
        Click("Outliner/Filter1");
        Confirm(State.OutlinerFilter == UvWorkspaceState::FilterSelected, "The selected filter did not engage");
        Confirm(HasRect("Outliner/Row0"), "The picked hood vanished under the selected filter");
        Confirm(!HasRect("Outliner/Row1"), "An unpicked row survived the selected filter");
        Click("Outliner/Filter2");
        Confirm(HasRect("Outliner/Row0"), "The hero hood vanished under the grouped filter");
        Confirm(!HasRect("Outliner/Row15"), "A remainder row survived the grouped filter");
        Click("Outliner/Filter3");
        Confirm(!HasRect("Outliner/Row0"), "A clean row survived the issues filter");
        Click("Outliner/Filter0");
        Confirm(HasRect("Outliner/Row15"), "All did not restore the remainder rows");

        // 4. Assets: each tab restages the census, tiles, seams, and stretch pins.
        Click("TopBar/Asset1");
        Confirm(State.Asset == 1, "The crate tab did not stage");
        Confirm(State.Selected == -1, "The restage kept a stray selection");
        Confirm(QueryUvIslandCount(1) == 20 && QueryUvTileCount(1) == 1, "The crate census drifted");
        Confirm(QueryUvAsset(1).Seams == 98, "The crate seam count drifted");
        Confirm(QueryUvAsset(1).MeanStretchPct == 0.0, "The crate lost its zero stretch");
        Confirm(std::fabs(QueryUvGroupActualShare(1, 0) - 65.0) < 0.75, "The crate hero left its 65% band");
        Click("TopBar/Asset2");
        Confirm(State.Asset == 2, "The bust tab did not stage");
        Confirm(QueryUvIslandCount(2) == 15, "The bust census drifted");
        Confirm(std::fabs(State.GroupTarget[0] - 72.0) < 1.0e-9, "The bust hero target missed 72%");
        Click("TopBar/Asset3");
        Confirm(State.Asset == 3, "The arch-kit tab did not stage");
        Confirm(QueryUvTileCount(3) == 4, "The arch-kit tile census drifted");
        Confirm(std::fabs(QueryUvTileOccupancy(3, 1002) - 65.33) < 0.75, "The column tile occupancy drifted");
        Confirm(QueryUvAsset(3).AvgTexel > 7.4 && QueryUvAsset(3).AvgTexel < 7.6, "The kit texel drifted");
        Click("TopBar/Asset0");
        Confirm(State.Asset == 0, "The coupe tab did not restore");
        Confirm(State.Log.front().Channel == "DOC", "The restage missed its DOC channel");

        // 4b. The browse pill requests the browser; asset handoffs restage like the tabs.
        Click("TopBar/Browse");
        Confirm(Link.OpenRequested, "The browse pill did not request the browser");
        Confirm(Link.OpenWorkspace == AssetBrowserWorkspaceUv, "The browse pill requested the wrong workspace");
        Link.OpenRequested = false;
        Link.OpenWorkspace = -1;
        std::snprintf(Link.OpenRecordId, sizeof(Link.OpenRecordId), "uv/bust");
        Link.OpenRecordWorkspace = AssetBrowserWorkspaceUv;
        Frame();
        Frame();
        Confirm(!Link.HasHandoff(), "The shell did not consume the handoff");
        Confirm(State.Asset == 2, "The bust handoff did not restage");
        Confirm(State.Selected == -1, "The handoff restage kept a stray selection");
        std::snprintf(Link.OpenRecordId, sizeof(Link.OpenRecordId), "uv/coupe");
        Link.OpenRecordWorkspace = AssetBrowserWorkspaceUv;
        Frame();
        Frame();
        Confirm(State.Asset == 0, "The coupe handoff did not restore");

        // 5. Stage HUD: modes, tools, lens, shade, pivots, snaps, and toggles flip shell-local state silently.
        const int HudNoops = State.NoopCount;
        Click("Stage/Mode1");
        Confirm(State.SelectionMode == UvWorkspaceState::ModeEdge, "Edge mode did not engage");
        Click("Stage/Mode3");
        Confirm(State.SelectionMode == UvWorkspaceState::ModeIsland, "Island mode did not restore");
        Click("Stage/Tool6");
        Confirm(State.Tool == UvWorkspaceState::ToolSeam, "The seam brush did not engage");
        Click("Stage/Tool0");
        Confirm(State.Tool == UvWorkspaceState::ToolSelect, "The select tool did not restore");
        Click("Stage/Lens");
        Confirm(State.Lens == UvWorkspaceState::LensClean, "The lens did not advance to clean");
        Click("Stage/Lens");
        Click("Stage/Lens");
        Click("Stage/Lens");
        Click("Stage/Lens");
        Click("Stage/Lens");
        Confirm(State.Lens == UvWorkspaceState::LensImportance, "The lens did not wrap to importance");
        Click("Stage/Shade");
        Confirm(State.Shade == UvWorkspaceState::ShadeFlat, "The shading did not advance to flat");
        Click("Stage/Pivot");
        Confirm(State.Pivot == UvWorkspaceState::PivotBounds, "The pivot did not advance to bounds");
        Click("Stage/Snap");
        Confirm(State.Snap == UvWorkspaceState::SnapGrid, "The snap did not advance to grid");
        Click("Stage/Sync");
        Confirm(!State.SyncSelection, "Sync did not disengage");
        Click("Stage/Sync");
        Confirm(State.SyncSelection, "Sync did not restore");
        Click("Stage/Checker");
        Confirm(!State.ShowChecker, "The checker did not hide");
        Click("Stage/Checker");
        Confirm(State.ShowChecker, "The checker did not restore");
        Click("Stage/Cam1");
        Confirm(State.Camera == UvWorkspaceState::CameraFront, "The front camera did not engage");
        Click("Stage/Wire");
        Confirm(!State.ShowWire3D, "The wireframe did not hide");
        Click("Stage/Wire");
        Click("Stage/Cam0");
        Click("Stage/Shade");
        Click("Stage/Shade");
        Click("Stage/Shade");
        Click("Stage/Shade");
        Click("Stage/Shade");
        Click("Stage/Shade");
        Confirm(State.Shade == UvWorkspaceState::ShadeChecker, "The shading did not wrap to checker");
        Click("Stage/Pivot");
        Click("Stage/Pivot");
        Click("Stage/Pivot");
        Click("Stage/Snap");
        Click("Stage/Snap");
        Click("Stage/Snap");
        Confirm(State.Pivot == UvWorkspaceState::PivotMedian && State.Snap == UvWorkspaceState::SnapOff,
                "Pivot/snap did not wrap home");
        Confirm(State.NoopCount == HudNoops, "Silent HUD flips tripped a NOOP");

        // 6. Stage modes: 2D-only keeps the tool rail, 3D-only hides it, split restores both.
        Click("TopBar/Stage1");
        Confirm(State.StageMode == UvWorkspaceState::StageUv, "The 2D stage did not engage");
        Confirm(HasRect("Stage/Tool0"), "The tool rail vanished from the 2D stage");
        Click("TopBar/Stage2");
        Confirm(State.StageMode == UvWorkspaceState::StageMesh, "The 3D stage did not engage");
        Confirm(!HasRect("Stage/Tool0"), "The tool rail survived the 3D stage");
        Confirm(HasRect("Stage/Cam0"), "The camera bar vanished from the 3D stage");
        Click("TopBar/Stage0");
        Confirm(State.StageMode == UvWorkspaceState::StageSplit, "Split stage did not restore");

        // 7. Inspector: all four tabs construct without tripping a NOOP.
        {
            const int NoopsBefore = State.NoopCount;
            Click("Inspector/Tab1");
            Confirm(State.InspectorTab == UvWorkspaceState::TabUnwrap, "The unwrap tab did not open");
            Frame();
            Click("Inspector/Tab2");
            Confirm(State.InspectorTab == UvWorkspaceState::TabUdim, "The UDIM tab did not open");
            (void)RectCentre("Inspector/Cell1001");
            (void)RectCentre("Inspector/Cell1024");
            Frame();
            Click("Inspector/Tab3");
            Confirm(State.InspectorTab == UvWorkspaceState::TabCheck, "The diagnostics tab did not open");
            (void)RectCentre("Inspector/SelectOverlaps");
            (void)RectCentre("Inspector/AutoRepair");
            Frame();
            Click("Inspector/Tab0");
            (void)RectCentre("Inspector/Pack");
            Confirm(State.NoopCount == NoopsBefore, "Rendering inspector tabs tripped a NOOP");
        }

        // 8. UDIM matrix: live tiles focus silently, outliner chips follow, empty slots refuse.
        Click("TopBar/Asset3");
        Click("Inspector/Tab2");
        Click("Inspector/Cell1002");
        Confirm(State.ActiveUdim == 1002, "The column cell did not focus UDIM 1002");
        Click("Outliner/Udim1003");
        Confirm(State.ActiveUdim == 1003, "The timber chip did not focus UDIM 1003");
        Click("Inspector/Cell1001");
        Confirm(State.ActiveUdim == 1001, "The arch cell did not restore UDIM 1001");
        {
            const int NoopsBefore = State.NoopCount;
            Click("TopBar/Asset0");
            Click("Inspector/Cell1003");
            Confirm(State.NoopCount == NoopsBefore + 1, "Adding UDIM 1003 to the coupe did not NOOP");
            Confirm(State.Log.front().Channel == "UDIM", "The tile refusal missed its UDIM channel");
            Confirm(State.ActiveUdim == 1001, "The refused tile moved the active UDIM");
        }
        Click("Inspector/Tab0");

        // 9. Operator dock: every solver-bound burst key refuses and latches its channel.
        {
            const int NoopsBefore = State.NoopCount;
            Click("Dock/Unwrap");
            Confirm(State.NoopCount == NoopsBefore + 1, "Unwrap did not NOOP");
            Confirm(State.UnwrapNoopRaised, "The unwrap latch did not set");
            Click("Dock/Pack");
            Confirm(State.NoopCount == NoopsBefore + 2, "Pack did not NOOP");
            Confirm(State.PackNoopRaised, "The pack latch did not set");
            Click("Dock/Relax");
            Click("Dock/Avg");
            Click("Dock/Pin");
            Click("Dock/Unpin");
            Click("Dock/Seam");
            Click("Dock/ClearSeam");
            Click("Dock/EdgeMenu");
            Click("Dock/Stitch");
            Click("Dock/Weld");
            Click("Dock/Split");
            Confirm(State.NoopCount == NoopsBefore + 12, "The dock did not refuse all twelve ops");
            Confirm(State.Log.front().Channel == "SPLIT", "The split refusal missed its SPLIT channel");
        }

        // 10. Top bar: undo/redo/import/export refuse; the help key opens the sheet.
        {
            const int NoopsBefore = State.NoopCount;
            Click("TopBar/Undo");
            Confirm(State.NoopCount == NoopsBefore + 1, "Undo did not NOOP");
            Click("TopBar/Redo");
            Confirm(State.NoopCount == NoopsBefore + 2, "Redo did not NOOP");
            Click("TopBar/Import");
            Confirm(State.NoopCount == NoopsBefore + 3, "Import OBJ did not NOOP");
            Click("TopBar/Export");
            Confirm(State.NoopCount == NoopsBefore + 4, "Export OBJ did not NOOP");
            Confirm(State.ExportObjNoopRaised, "The export latch did not set");
            Confirm(State.Log.front().Channel == "EXPORT", "The export refusal missed its EXPORT channel");
        }
        Click("TopBar/Help");
        Confirm(State.HelpOpen, "The help key did not open the sheet");
        Click("Help/Close");
        Confirm(!State.HelpOpen, "The sheet close key did not dismiss the sheet");

        // 11. Log drawer: the dock toggle opens it above the dock and Clear empties the log.
        Click("Dock/Log");
        Confirm(State.LogOpen, "The log key did not open the drawer");
        Frame();
        Click("Console/Clear");
        Confirm(State.Log.empty(), "Clear did not empty the operator log");
        Click("Dock/Log");
        Confirm(!State.LogOpen, "The log key did not close the drawer");

        // 12. Inspector actions: pack refuses, overlap select focuses the lens, auto-repair refuses.
        Click("Inspector/Tab0");
        {
            const int NoopsBefore = State.NoopCount;
            Click("Inspector/Pack");
            Confirm(State.NoopCount == NoopsBefore + 1, "The inspector pack did not NOOP");
        }
        Click("Inspector/Tab3");
        Click("Inspector/SelectOverlaps");
        Confirm(State.Lens == UvWorkspaceState::LensOverlap, "Overlap select did not focus the overlap lens");
        Confirm(State.Log.front().Channel == "SELECT", "The overlap select missed its SELECT channel");
        {
            const int NoopsBefore = State.NoopCount;
            Click("Inspector/AutoRepair");
            Confirm(State.NoopCount == NoopsBefore + 1, "Auto-repair did not NOOP");
        }
        Click("Inspector/Tab0");

        // 13. Reset: the inspector pill restages the asset and clears the selection.
        Click("Outliner/Row2");
        Confirm(State.Selected == 2, "The flank did not select");
        Click("Inspector/Reset");
        Confirm(State.Selected == -1, "Reset kept the selection");
        Confirm(State.AssetName == QueryUvAsset(0).Label, "Reset did not restore the asset name");
        Confirm(State.Log.front().Channel == "DOC", "Reset missed its DOC channel");

        // 14. Evidence: one frame per showcase state.
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
            if (!Image) throw std::runtime_error("Could not write UV workspace PPM evidence");
        };
        // 📝 Settle: let the NOOP toasts expire so the evidence frames show the bare workspace.
        for (int I = 0; I < 360; ++I) Frame();
        if (ArgumentCount >= 2)
        {
            std::string Stem = Arguments[1];
            const size_t Dot = Stem.rfind(".ppm");
            if (Dot != std::string::npos && Dot + 4 == Stem.size()) Stem.erase(Dot);
            ConstructUvWorkspaceState(State);
            Frame();
            RenderEvidence((Stem + "-overview.ppm").c_str());
            Click("Stage/Lens");
            Click("Stage/Lens");
            RenderEvidence((Stem + "-texel.ppm").c_str());
            Click("TopBar/Asset3");
            Click("Inspector/Tab2");
            RenderEvidence((Stem + "-udim.ppm").c_str());
            Click("TopBar/Asset0");
            Click("Inspector/Tab3");
            RenderEvidence((Stem + "-diagnostics.ppm").c_str());
        }

        std::fprintf(stdout, "UvWorkspaceValidation: boot/select/filter/assets/hud/stages/inspector/udim/dock/topbar/log/actions/reset checks passed\n");
        ImGui::DestroyContext();
        return 0;
    }
    catch (const std::exception& Failure)
    {
        ImGui::DestroyContext();
        std::fprintf(stderr, "UvWorkspaceValidation: %s\n", Failure.what());
        return 1;
    }
}
