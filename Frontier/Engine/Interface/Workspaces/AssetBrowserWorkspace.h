/*==========================================================================================================================================
                                                         ASSETBROWSERWORKSPACE.H
==========================================================================================================================================*/
// 🧩 Asset Browser as a C++ UI shell: the one generic browser over the six workspace catalogues (Particle Lab 52,
//    Fluid Studio 18, Fracture Lab 27, Force Fields 17, Photometric 32, UV Studio 4 — 150 records pinned 1:1 from the
//    workspace query APIs, never copied). Workspace shells browse here through the shared AssetBrowserLink: a shell
//    raises OpenRequested (optionally pre-filtered to its workspace) and the browser hands a record back through
//    OpenRecordId, which the owning shell applies and clears. The browser opens/closes through a trapezoidal
//    expansion notch that mirrors PanelExpansionTab (8% inset contour, caption + grip, tap toggle, drag travel with
//    flick snap, MotionIntegrator spring settle). Like the other shells this one is honest: record actions log and
//    hand off through the link; nothing reaches the engines.

#pragma once

#include "Engine/Interface/MotionIntegrator.h"

#include <imgui.h>

#include <cstdint>
#include <deque>
#include <map>
#include <string>
#include <vector>

namespace Frontier
{

struct EditorTypefaces;

//------------------------------------------------------------------------------------------------------------------------
//                                                    CATALOGUE
//------------------------------------------------------------------------------------------------------------------------

enum
{
    AssetBrowserWorkspaceParticle = 0,
    AssetBrowserWorkspaceFluid,
    AssetBrowserWorkspaceFracture,
    AssetBrowserWorkspaceForceField,
    AssetBrowserWorkspacePhotometric,
    AssetBrowserWorkspaceUv,
    AssetBrowserWorkspaceCount
};

struct AssetBrowserMeta
{
    std::string Key;
    std::string Value;
};

struct AssetBrowserRecord
{
    std::string Id;        // 🧩 particle/sparks · fluid/ue5_pyro_default · fracture-mat/concrete · …
    std::string Name;
    std::string Workspace; // 🧩 Particle Lab · Fluid Studio · Fracture Lab · Force Fields · Photometric · UV Studio.
    std::string Folder;    // 🧩 Workspace/Group, the tree path.
    std::string Kind;      // 🧩 Preset · Material · Solver · Construct · Field Type · Light · Moon · IES Profile · Rig · Asset.
    std::string Blurb;
    std::string Glyph; // 🧩 GlyphSymbol name.
    uint32_t    Colour = 0xE8C27AFF;
    int         WorkspaceIndex = 0;
    std::vector<AssetBrowserMeta> Meta;
    std::vector<std::string>      Tags;
};

[[nodiscard]] int                          QueryAssetBrowserRecordCount() noexcept; // 🧩 Always 150, the six catalogues.
[[nodiscard]] const AssetBrowserRecord&    QueryAssetBrowserRecord(int Index) noexcept;
[[nodiscard]] int                          QueryAssetBrowserRecordById(const char* Id) noexcept; // 🧩 -1 when unknown.
[[nodiscard]] int                          QueryAssetBrowserWorkspaceRecordCount(int Workspace) noexcept;
[[nodiscard]] const char*                  QueryAssetBrowserWorkspaceName(int Workspace) noexcept;
[[nodiscard]] int                          QueryAssetBrowserKindCount() noexcept; // 🧩 Kinds sans All, sorted.
[[nodiscard]] const char*                  QueryAssetBrowserKindName(int Kind) noexcept;

//------------------------------------------------------------------------------------------------------------------------
//                                                    WORKSPACE LINK
//------------------------------------------------------------------------------------------------------------------------

// 📝 One link is shared between the browser and every workspace shell. Workspaces raise OpenRequested to send the
//    user here; the browser writes OpenRecordId (+ OpenRecordWorkspace) when the user picks Open in <workspace>,
//    and the owning shell applies the record (spawn / select / apply, exactly its old local action) then clears.
struct AssetBrowserLink
{
    bool OpenRequested = false;
    int  OpenWorkspace = -1; // 🧩 Preselect this workspace folder, -1 keeps the current folder.
    char OpenRecordId[128] = {};
    int  OpenRecordWorkspace = -1;
    [[nodiscard]] bool HasHandoff() const noexcept
    {
        return OpenRecordId[0] != '\0';
    }
    void ClearHandoff() noexcept
    {
        OpenRecordId[0]      = '\0';
        OpenRecordWorkspace = -1;
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    VIEW STATE
//------------------------------------------------------------------------------------------------------------------------

struct AssetBrowserLogEntry
{
    std::string When;
    std::string Channel;
    std::string Message;
    std::string Detail;
};

struct AssetBrowserWorkspaceState
{
    enum
    {
        SortName = 0,
        SortWorkspace,
        SortKind
    };

    std::string Folder = "all"; // 🧩 all · fav · recent · folder path.
    char        SearchText[128] = {};
    bool        FocusSearch     = false;
    int         Kind     = -1; // 🧩 -1 All, else QueryAssetBrowserKindName index.
    int         Sort     = SortName;
    bool        GridView = true;
    int         Selected = -1; // 🧩 Record index, -1 none.

    std::vector<int> Favorites; // 🧩 Record indices; the catalogue order is pinned so indices are stable.
    std::vector<int> Recents;

    bool             SheetOpen   = true;
    float            SheetTravel = 0.0f; // 🧩 Pixels, refreshed every frame from the window size.
    MotionIntegrator Motion;
    uint32_t         SheetChannel      = 0;
    bool             SheetChannelReady = false;
    bool             NotchDragging     = false;
    float            NotchGrabY        = 0.0f;
    float            NotchGrabH        = 0.0f;
    float            NotchRate         = 0.0f;
    float            NotchLastY        = 0.0f;
    double           NotchLastT        = 0.0;
    bool             NotchMoved        = false;

    std::deque<AssetBrowserLogEntry> Log;
    std::map<std::string, ImVec4>   Rects; // 🧩 Named hit rects refreshed every frame for scripted validation.
};

void ConstructAssetBrowserWorkspaceState(AssetBrowserWorkspaceState& State);
void AppendAssetBrowserWorkspaceLog(AssetBrowserWorkspaceState& State, const char* Channel, const char* Message,
                                    const char* Detail = nullptr);
void SelectAssetBrowserRecord(AssetBrowserWorkspaceState& State, int Index) noexcept; // 🧩 Selects + pushes recent.
void ToggleAssetBrowserFavorite(AssetBrowserWorkspaceState& State, int Index) noexcept;
void ApplyAssetBrowserLink(AssetBrowserWorkspaceState& State, AssetBrowserLink* Link) noexcept; // 🧩 Open requests.
void QueryAssetBrowserFiltered(const AssetBrowserWorkspaceState& State, std::vector<int>& Out); // 🧩 Folder/kind/query/sort.
void RecordAssetBrowserWorkspaceRect(AssetBrowserWorkspaceState& State, const char* Name, ImVec2 Min, ImVec2 Max);
bool QueryAssetBrowserWorkspaceRect(const AssetBrowserWorkspaceState& State, const char* Name, ImVec2& Min,
                                    ImVec2& Max) noexcept;

void ConstructAssetBrowserWorkspace(AssetBrowserWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Size,
                                    AssetBrowserLink* Link = nullptr);
void ConstructAssetBrowserInspector(AssetBrowserWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList,
                                    ImVec2 Min, ImVec2 Max, AssetBrowserLink* Link);

} // namespace Frontier
