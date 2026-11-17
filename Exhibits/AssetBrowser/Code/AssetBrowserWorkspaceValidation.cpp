// Asset Browser validation: the one generic browser over the six workspace catalogues (150 pinned records),
// with scripted pointer interaction, notch travel checks, workspace-link handoff checks, and PPM evidence per
// showcase state. Record actions hand off through the shared link and log; nothing reaches the engines.

#include "Frontier/Engine/Interface/Workspaces/AssetBrowserWorkspace.h"
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
        IO.DisplaySize = ImVec2(1560.0f, 1000.0f);
        IO.DeltaTime = 1.0f / 60.0f;
        TypefaceRegistry   FontRegistry;
        static const char* WantedFonts[] = { "DM Sans", "JetBrains Mono" };
        const char*        ArchiveRoot   = ArgumentCount >= 3 ? Arguments[2] : "EngineContent/FontArchives";
        const uint32_t     FontFamilies  = FontRegistry.Load(ArchiveRoot, WantedFonts, 2);
        if (ArgumentCount >= 3) Confirm(FontFamilies == 2, "The font archive root did not yield DM Sans and JetBrains Mono");
        if (FontFamilies == 0) IO.Fonts->AddFontDefault();
        else TypefaceRegistry::Install(&FontRegistry);
        IO.Fonts->Build();

        const EditorTypefaces Faces = EditorTypefaces::Resolve();
        AssetBrowserWorkspaceState State{};
        ConstructAssetBrowserWorkspaceState(State);
        AssetBrowserLink Link{};

        std::vector<int> Filtered;
        const auto Frame = [&]()
        {
            ImGui::NewFrame();
            ConstructAssetBrowserWorkspace(State, Faces, IO.DisplaySize, &Link);
            ImGui::Render();
        };
        const auto RectCentre = [&](const char* Name)
        {
            ImVec2 Min{}, Max{};
            char   Missing[160]{};
            std::snprintf(Missing, sizeof(Missing), "Missing validation rect %s", Name);
            Confirm(QueryAssetBrowserWorkspaceRect(State, Name, Min, Max), Missing);
            Confirm(Max.x > Min.x && Max.y > Min.y, Missing);
            return ImVec2(0.5f * (Min.x + Max.x), 0.5f * (Min.y + Max.y));
        };
        const auto HasRect = [&](const char* Name)
        {
            ImVec2 Min{}, Max{};
            return QueryAssetBrowserWorkspaceRect(State, Name, Min, Max) && Max.x > Min.x && Max.y > Min.y;
        };
        // 📝 Frontier ImGui eases wheel scrolls over several frames: wait until the tracked rect parks.
        const auto SettleTree = [&](const char* Name)
        {
            ImVec2 A{}, B{}, PA{ 1.0e9f, 1.0e9f }, PB{};
            for (int I = 0; I < 240; ++I)
            {
                Frame();
                QueryAssetBrowserWorkspaceRect(State, Name, A, B);
                if (A.x == PA.x && A.y == PA.y && B.x == PB.x && B.y == PB.y) return;
                PA = A;
                PB = B;
            }
            throw std::runtime_error("The tree scroll never settled");
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
        const auto SpringHeight = [&]()
        {
            return State.Motion.Spring(State.SheetChannel).Current;
        };

        // 1. Census: 150 records pinned 1:1 from the six workspace query APIs, in workspace order.
        Frame();
        Frame();
        Confirm(QueryAssetBrowserRecordCount() == 150, "The browser lost records");
        Confirm(QueryAssetBrowserWorkspaceRecordCount(AssetBrowserWorkspaceParticle) == 52, "Particle lost presets");
        Confirm(QueryAssetBrowserWorkspaceRecordCount(AssetBrowserWorkspaceFluid) == 18, "Fluid lost presets");
        Confirm(QueryAssetBrowserWorkspaceRecordCount(AssetBrowserWorkspaceFracture) == 27, "Fracture lost records");
        Confirm(QueryAssetBrowserWorkspaceRecordCount(AssetBrowserWorkspaceForceField) == 17, "Force Fields lost types");
        Confirm(QueryAssetBrowserWorkspaceRecordCount(AssetBrowserWorkspacePhotometric) == 32, "Photometric lost records");
        Confirm(QueryAssetBrowserWorkspaceRecordCount(AssetBrowserWorkspaceUv) == 4, "UV lost assets");
        Confirm(QueryAssetBrowserRecordById("particle/sparks") == 0, "sparks is not record 0");
        Confirm(QueryAssetBrowserRecordById("fluid/ue5_pyro_default") == 52, "The pyro plume is out of order");
        Confirm(QueryAssetBrowserRecordById("fracture-mat/concrete") == 70, "Concrete is out of order");
        Confirm(QueryAssetBrowserRecordById("fracture-solver/griffith") == 78, "Griffith is out of order");
        Confirm(QueryAssetBrowserRecordById("fracture/cylinder-plastic") == 89, "The ABS drum is out of order");
        Confirm(QueryAssetBrowserRecordById("fracture/construct-polymer") == 96, "The polymer construct is out of order");
        Confirm(QueryAssetBrowserRecordById("forcefield/WindGenerator") == 97, "WindGenerator is out of order");
        Confirm(QueryAssetBrowserRecordById("photo-light/pointlight") == 114, "The point light is out of order");
        Confirm(QueryAssetBrowserRecordById("photo-moon/Luna") == 121, "Luna is out of order");
        Confirm(QueryAssetBrowserRecordById("photo-ies-m/LowBeam") == 127, "LowBeam is out of order");
        Confirm(QueryAssetBrowserRecordById("photo-ies-p/Batwing") == 136, "Batwing is out of order");
        Confirm(QueryAssetBrowserRecordById("photo-rig/lunar") == 145, "The lunar rig is out of order");
        Confirm(QueryAssetBrowserRecordById("uv/coupe") == 146, "The coupe is out of order");
        Confirm(QueryAssetBrowserRecordById("uv/udim_kit") == 149, "The arch kit is not the last record");
        Confirm(QueryAssetBrowserRecordById("nope/missing") == -1, "Unknown ids must miss");
        Confirm(QueryAssetBrowserKindCount() == 10, "The kind table drifted");
        Confirm(std::strcmp(QueryAssetBrowserKindName(0), "Asset") == 0, "Kinds are not sorted");
        Confirm(State.Log.size() == 1 && State.Log.front().Channel == "BROWSER", "The boot missed its BROWSER line");
        // 📝 Spot-check folders, meta, and tags against the HTML prototype.
        {
            const AssetBrowserRecord& Coupe = QueryAssetBrowserRecord(QueryAssetBrowserRecordById("uv/coupe"));
            Confirm(Coupe.Folder == "UV Studio/Assets" && Coupe.Kind == "Asset", "The coupe folder/kind drifted");
            Confirm(Coupe.Meta.size() == 3 && Coupe.Meta[0].Value == "30", "The coupe lost its island count");
            Confirm(Coupe.Meta[1].Value == "1001 · 1002", "The coupe lost its UDIM list");
            const AssetBrowserRecord& Sparks = QueryAssetBrowserRecord(0);
            Confirm(Sparks.Tags.size() == 2 && Sparks.Tags[0] == "effects" && Sparks.Tags[1] == "ballistic",
                    "sparks lost its tags");
            const AssetBrowserRecord& Joist =
                QueryAssetBrowserRecord(QueryAssetBrowserRecordById("fracture/timber_beam-wood"));
            Confirm(Joist.Meta[1].Value == "Spruce Wood", "The joist lost its material label");
            Confirm(Joist.Tags[0] == "stone-and-timber", "The joist tag slug drifted");
        }

        // 2. Filters: folder, kind, and query narrow the pinned order; sorts reorder it.
        QueryAssetBrowserFiltered(State, Filtered);
        Confirm(Filtered.size() == 150, "The unfiltered browser is not whole");
        State.Folder = "UV Studio";
        QueryAssetBrowserFiltered(State, Filtered);
        Confirm(Filtered.size() == 4, "The UV folder lost assets");
        State.Folder = "all";
        State.Kind   = 7; // 🧩 Preset in the sorted kind table.
        Confirm(std::strcmp(QueryAssetBrowserKindName(State.Kind), "Preset") == 0, "Preset left kind slot 7");
        QueryAssetBrowserFiltered(State, Filtered);
        Confirm(Filtered.size() == 78, "The Preset kind lost records");
        State.Kind = -1;
        std::snprintf(State.SearchText, sizeof(State.SearchText), "tornado");
        QueryAssetBrowserFiltered(State, Filtered);
        Confirm(Filtered.size() == 4, "The tornado query missed (want debris + column + 2 fluid plumes)");
        std::snprintf(State.SearchText, sizeof(State.SearchText), "zxqv-none");
        QueryAssetBrowserFiltered(State, Filtered);
        Confirm(Filtered.empty(), "A nonsense query matched");
        State.SearchText[0] = '\0';
        State.Folder        = "fav";
        QueryAssetBrowserFiltered(State, Filtered);
        Confirm(Filtered.empty(), "An empty favorites shelf showed records");
        State.Folder = "all";
        State.Sort   = AssetBrowserWorkspaceState::SortWorkspace;
        QueryAssetBrowserFiltered(State, Filtered);
        Confirm(QueryAssetBrowserRecord(Filtered.front()).Workspace == "Fluid Studio", "Workspace sort drifted");
        State.Sort = AssetBrowserWorkspaceState::SortName;
        QueryAssetBrowserFiltered(State, Filtered);
        Confirm(QueryAssetBrowserRecord(Filtered.front()).Name == "Aero Coupe GT", "Name sort drifted");

        // 3. Sheet: the browser boots open at full travel; the notch tap docks and raises it.
        Confirm(State.SheetOpen, "The browser did not boot open");
        Confirm(std::fabs(SpringHeight() - State.SheetTravel) < 1.0f, "The sheet did not boot at full travel");
        Confirm(HasRect("Sheet/Body") && HasRect("Item/0") && HasRect("Tree/Ws0"), "The open sheet lost rects");
        Click("Notch/Tab");
        Confirm(!State.SheetOpen, "The notch tap did not dock the sheet");
        for (int I = 0; I < 120; ++I) Frame();
        Confirm(SpringHeight() < 1.0f, "The docked sheet never settled");
        Confirm(!HasRect("Item/0"), "A docked sheet kept item rects");
        Confirm(HasRect("Notch/Tab") && HasRect("Stage/Browse"), "Docking lost the notch/stage rects");
        Click("Stage/Browse");
        Confirm(State.SheetOpen, "The stage button did not raise the sheet");
        for (int I = 0; I < 120; ++I) Frame();
        Confirm(SpringHeight() > State.SheetTravel - 1.0f, "The raised sheet never settled");
        Confirm(HasRect("Item/0"), "Raising the sheet lost item rects");

        // 4. Notch drag: upward travel opens, downward travel docks, with flick snap.
        Click("Notch/Tab");
        Confirm(!State.SheetOpen, "The second tap did not dock the sheet");
        for (int I = 0; I < 120; ++I) Frame();
        {
            const ImVec2 At = RectCentre("Notch/Tab");
            IO.AddMousePosEvent(At.x, At.y);
            Frame();
            IO.AddMouseButtonEvent(ImGuiMouseButton_Left, true);
            Frame();
            Confirm(State.NotchDragging, "The notch press did not grab");
            for (int Step = 1; Step <= 10; ++Step)
            {
                IO.AddMousePosEvent(At.x, At.y - Step * 30.0f);
                Frame();
            }
            Confirm(SpringHeight() > 200.0f, "The upward drag did not carry the sheet");
            IO.AddMouseButtonEvent(ImGuiMouseButton_Left, false);
            Frame();
            Frame();
            Confirm(State.SheetOpen, "The upward drag did not snap open");
        }
        for (int I = 0; I < 120; ++I) Frame();
        {
            const ImVec2 At = RectCentre("Notch/Tab");
            IO.AddMousePosEvent(At.x, At.y);
            Frame();
            IO.AddMouseButtonEvent(ImGuiMouseButton_Left, true);
            Frame();
            for (int Step = 1; Step <= 10; ++Step)
            {
                IO.AddMousePosEvent(At.x, At.y + Step * 40.0f);
                Frame();
            }
            IO.AddMouseButtonEvent(ImGuiMouseButton_Left, false);
            Frame();
            Frame();
            Confirm(!State.SheetOpen, "The downward drag did not snap shut");
        }
        for (int I = 0; I < 120; ++I) Frame(); // 📝 Let the flick settle so the tap hits a parked notch.
        Click("Notch/Tab");
        for (int I = 0; I < 120; ++I) Frame();
        Confirm(State.SheetOpen && HasRect("Item/0"), "The sheet did not recover after the drags");

        // 5. Items: cards select and push recents; the star favorites; the inspector hands off through the link.
        QueryAssetBrowserFiltered(State, Filtered);
        Click("Item/0");
        Confirm(State.Selected == Filtered[0], "Clicking the first card did not select it");
        Confirm(!State.Recents.empty() && State.Recents.front() == Filtered[0], "The selection missed recents");
        Confirm(HasRect("Inspector/Open") && HasRect("Inspector/Fav"), "Selecting lost the inspector actions");
        Click("Item/Fav0");
        Confirm(State.Favorites.size() == 1 && State.Favorites.front() == Filtered[0], "The star did not favorite");
        Click("Inspector/Fav");
        Confirm(State.Favorites.empty(), "The inspector button did not unfavorite");
        Click("Item/Fav0");
        State.Folder = "fav";
        Frame();
        QueryAssetBrowserFiltered(State, Filtered);
        Confirm(Filtered.size() == 1, "The favorites shelf lost its record");
        State.Folder = "all";
        Frame();
        Click("Inspector/Open");
        Confirm(Link.HasHandoff(), "Open in workspace missed the link");
        Confirm(std::strcmp(Link.OpenRecordId, QueryAssetBrowserRecord(State.Selected).Id.c_str()) == 0,
                "The handoff carried the wrong id");
        Confirm(Link.OpenRecordWorkspace == QueryAssetBrowserRecord(State.Selected).WorkspaceIndex,
                "The handoff carried the wrong workspace");
        Confirm(State.Log.front().Channel == "OPEN", "The handoff missed its OPEN line");
        Link.ClearHandoff();

        // 6. Tree + chips: folder rows and kind chips narrow; tags feed the search.
        // 📝 The tree holds 39 rows in a scrolling column: wheel the UV shelf into view first.
        {
            IO.AddMousePosEvent(160.0f, 600.0f);
            Frame();
            for (int I = 0; I < 24; ++I)
            {
                IO.AddMouseWheelEvent(0.0f, -1.0f);
                Frame();
            }
            SettleTree("Tree/Ws5");
            IO.AddMousePosEvent(-1.0f, -1.0f);
            Frame();
        }
        Click("Tree/Ws5");
        Confirm(State.Folder == "UV Studio", "The UV row did not filter");
        QueryAssetBrowserFiltered(State, Filtered);
        Confirm(Filtered.size() == 4, "The UV row showed the wrong count");
        {
            IO.AddMousePosEvent(160.0f, 600.0f);
            Frame();
            for (int I = 0; I < 30; ++I)
            {
                IO.AddMouseWheelEvent(0.0f, 1.0f);
                Frame();
            }
            SettleTree("Tree/All");
            IO.AddMousePosEvent(-1.0f, -1.0f);
            Frame();
        }
        Click("Tree/All");
        Click("Kind/7");
        Confirm(State.Kind == 7, "The Preset chip did not engage");
        QueryAssetBrowserFiltered(State, Filtered);
        Confirm(Filtered.size() == 78, "The Preset chip showed the wrong count");
        Click("Kind/All");
        Confirm(State.Kind == -1, "The All chip did not clear the kind");
        Click("Item/0");
        Click("Inspector/Tag0");
        Confirm(State.SearchText[0] != '\0', "The tag pill did not feed the search");
        State.SearchText[0] = '\0';
        Frame();

        // 7. Link inbound: a workspace request opens the browser pre-filtered to its shelf.
        Click("Notch/Tab");
        Confirm(!State.SheetOpen, "The sheet did not dock before the link check");
        Link.OpenRequested = true;
        Link.OpenWorkspace  = AssetBrowserWorkspaceForceField;
        Frame();
        Frame();
        Confirm(State.SheetOpen, "The link request did not raise the sheet");
        Confirm(State.Folder == "Force Fields", "The link request missed its pre-filter");
        Confirm(!Link.OpenRequested, "The browser did not consume the request");
        Confirm(State.Log.front().Channel == "LINK", "The link request missed its LINK line");

        // 8. Keyboard: B toggles, arrows move, F favorites, G/L switch views, Enter hands off, Esc docks.
        for (int I = 0; I < 120; ++I) Frame();
        IO.AddKeyEvent(ImGuiKey_B, true);
        Frame();
        IO.AddKeyEvent(ImGuiKey_B, false);
        Frame();
        Confirm(!State.SheetOpen, "B did not dock the sheet");
        IO.AddKeyEvent(ImGuiKey_B, true);
        Frame();
        IO.AddKeyEvent(ImGuiKey_B, false);
        Frame();
        Confirm(State.SheetOpen, "B did not raise the sheet");
        for (int I = 0; I < 120; ++I) Frame();
        State.Folder = "all";
        State.Kind   = -1;
        Frame();
        QueryAssetBrowserFiltered(State, Filtered);
        SelectAssetBrowserRecord(State, -1);
        IO.AddKeyEvent(ImGuiKey_DownArrow, true);
        Frame();
        IO.AddKeyEvent(ImGuiKey_DownArrow, false);
        Frame();
        Confirm(State.Selected == Filtered[0], "ArrowDown did not pick the first card");
        State.Favorites.clear();
        IO.AddKeyEvent(ImGuiKey_F, true);
        Frame();
        IO.AddKeyEvent(ImGuiKey_F, false);
        Frame();
        Confirm(State.Favorites.size() == 1 && State.Favorites.front() == State.Selected, "F did not favorite");
        IO.AddKeyEvent(ImGuiKey_L, true);
        Frame();
        IO.AddKeyEvent(ImGuiKey_L, false);
        Frame();
        Confirm(!State.GridView, "L did not switch to list view");
        IO.AddKeyEvent(ImGuiKey_G, true);
        Frame();
        IO.AddKeyEvent(ImGuiKey_G, false);
        Frame();
        Confirm(State.GridView, "G did not switch to grid view");
        IO.AddKeyEvent(ImGuiKey_Enter, true);
        Frame();
        IO.AddKeyEvent(ImGuiKey_Enter, false);
        Frame();
        Confirm(Link.HasHandoff(), "Enter did not hand off");
        Link.ClearHandoff();
        IO.AddKeyEvent(ImGuiKey_Escape, true);
        Frame();
        IO.AddKeyEvent(ImGuiKey_Escape, false);
        Frame();
        Confirm(!State.SheetOpen, "Esc did not dock the sheet");

        // 9. Evidence: one frame per showcase state.
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
            if (!Image) throw std::runtime_error("Could not write Asset Browser PPM evidence");
        };
        for (int I = 0; I < 360; ++I) Frame();
        if (ArgumentCount >= 2)
        {
            std::string Stem = Arguments[1];
            const size_t Dot = Stem.rfind(".ppm");
            if (Dot != std::string::npos && Dot + 4 == Stem.size()) Stem.erase(Dot);
            Link = AssetBrowserLink{};
            ConstructAssetBrowserWorkspaceState(State);
            Frame();
            Frame();
            RenderEvidence((Stem + "-overview.ppm").c_str());
            Click("Item/0");
            Click("Inspector/Open");
            RenderEvidence((Stem + "-handoff.ppm").c_str());
            Link.ClearHandoff();
            Click("Notch/Tab");
            for (int I = 0; I < 120; ++I) Frame();
            RenderEvidence((Stem + "-docked.ppm").c_str());
        }

        std::fprintf(stdout, "AssetBrowserWorkspaceValidation: census/filter/sheet/notch/items/link/keyboard checks passed\n");
        ImGui::DestroyContext();
        return 0;
    }
    catch (const std::exception& Failure)
    {
        ImGui::DestroyContext();
        std::fprintf(stderr, "AssetBrowserWorkspaceValidation: %s\n", Failure.what());
        return 1;
    }
}
