/*==========================================================================================================================================
                                                          UVWORKSPACE.H
==========================================================================================================================================*/
// 🧩 UV Workspace as a C++ UI shell: the Remastered 1:1 visuals (asset tab bar, island outliner with importance
//    buckets, UDIM chips, selection-mode/tool/pivot/snap/lens/shade HUD, split 2D atlas + 3D mesh stage, Blender
//    operator dock, log drawer, status bar, and the 4-tab Packing/Unwrap/UDIM/Diagnostics inspector) over local
//    view state plus node-pinned sample-asset data. The staged asset mirrors the prototype's catalogue
//    (Experimental Remastered/UVEditor/Engine/SampleAssets.js): island names, face counts, texel densities, UV
//    areas, bounds, UDIM tiles, importance groups, and diagnostics were measured with Node and baked in; group
//    shares, tile occupancy, and the census derive from those tables in closed form. Value controls edit shell
//    copies and log keyed PARAM lines, and nothing else. Every command that would mutate UVs or reach the solvers
//    or the filesystem (unwrap, pack, relax, average scale, pin, seam, stitch, weld, split, align, density match,
//    move islands, import/export OBJ, export SVG/JSON, load texture, add/remove UDIM tile, assign groups, undo/redo)
//    is an explicit NOOP: it raises a toast, appends a warm log line, and changes nothing. Asset tabs, selection,
//    filters, modes, tools, pivots, snaps, lenses, shading, toggles, cameras, and stage layout are silent local
//    view state. The workspace makes no solver, shader, or renderer calls; the 3D mesh panel is static decor,
//    honestly labelled in the viewport corner.

#pragma once

#include "Frontier/Engine/Interface/Workspaces/AssetBrowserWorkspace.h"

#include <imgui.h>

#include <deque>
#include <map>
#include <string>

namespace Frontier
{

struct EditorTypefaces;

//------------------------------------------------------------------------------------------------------------------------
//                                                    CATALOGUE
//------------------------------------------------------------------------------------------------------------------------

struct UvAssetSpec
{
    const char* Id       = nullptr; // 🧩 coupe / crate / bust / udim_kit.
    const char* Label    = nullptr;
    const char* Subtitle = nullptr;
    int         Verts    = 0; // 🧩 Node-measured TopologySurface positions.
    int         Faces    = 0;
    int         Seams    = 0; // 🧩 Node-measured seam edge count.
    double      AvgTexel = 0.0; // 🧩 px/cm mean over islands.
    double      MeanStretchPct = 0.0; // 🧩 Node-measured AnalyzeDiagnostics mean angle stretch.
};

struct UvGroupSpec
{
    const char* Id          = nullptr;
    const char* Name        = nullptr;
    double      TargetPct   = 0.0;
    uint32_t    Accent      = 0xEFF4CFFF;
    int         UdimTarget  = 1001;
};

struct UvTileSpec
{
    int         Id         = 1001;
    const char* Label      = nullptr;
    int         Resolution = 2048;
    const char* Backing    = nullptr; // 🧩 color / uv / checker / blank.
};

struct UvIslandSpec
{
    const char* Name    = nullptr;
    int         Faces   = 0;
    double      Texel   = 0.0; // 🧩 px/cm.
    double      AreaPct = 0.0; // 🧩 % of one UDIM tile.
    int         Udim    = 1001;
    int         Group   = -1; // 🧩 Index into the asset group table, or -1 for the remainder pool.
    float       MinU = 0.0f, MinV = 0.0f, MaxU = 1.0f, MaxV = 1.0f; // 🧩 Pinned UV bounds for the 2D stage.
};

[[nodiscard]] int                  QueryUvAssetCount() noexcept; // 🧩 Always 4.
[[nodiscard]] const UvAssetSpec&   QueryUvAsset(int Index) noexcept;
[[nodiscard]] int                  QueryUvGroupCount(int Asset) noexcept;
[[nodiscard]] const UvGroupSpec&   QueryUvGroup(int Asset, int Index) noexcept;
[[nodiscard]] int                  QueryUvTileCount(int Asset) noexcept;
[[nodiscard]] const UvTileSpec&    QueryUvTile(int Asset, int Index) noexcept;
[[nodiscard]] int                  QueryUvTileIndex(int Asset, int UdimId) noexcept;
[[nodiscard]] int                  QueryUvIslandCount(int Asset) noexcept;
[[nodiscard]] const UvIslandSpec&  QueryUvIsland(int Asset, int Index) noexcept;
[[nodiscard]] int                  QueryUvSelectionModeCount() noexcept; // 🧩 Always 4.
[[nodiscard]] const char*          QueryUvSelectionMode(int Index) noexcept;
[[nodiscard]] int                  QueryUvToolCount() noexcept; // 🧩 Always 8.
[[nodiscard]] const char*          QueryUvTool(int Index) noexcept;
[[nodiscard]] int                  QueryUvLensCount() noexcept; // 🧩 Always 6.
[[nodiscard]] const char*          QueryUvLens(int Index) noexcept;
[[nodiscard]] int                  QueryUvShadeCount() noexcept; // 🧩 Always 7.
[[nodiscard]] const char*          QueryUvShade(int Index) noexcept;

//------------------------------------------------------------------------------------------------------------------------
//                                                    DERIVED
//------------------------------------------------------------------------------------------------------------------------

// 📝 Closed-form derivations over the pinned island tables; deterministic, no solver calls.
[[nodiscard]] double QueryUvGroupActualShare(int Asset, int Group) noexcept; // 🧩 % of total island area.
[[nodiscard]] double QueryUvRemainderActualShare(int Asset) noexcept;
[[nodiscard]] int    QueryUvGroupIslandCount(int Asset, int Group) noexcept;
[[nodiscard]] int    QueryUvRemainderIslandCount(int Asset) noexcept;
[[nodiscard]] double QueryUvTileOccupancy(int Asset, int UdimId) noexcept; // 🧩 % of one tile.
[[nodiscard]] int    QueryUvTileIslandCount(int Asset, int UdimId) noexcept;
[[nodiscard]] int    QueryUvOverlapCount(int Asset) noexcept; // 🧩 Always 0: every pinned asset is clean.
[[nodiscard]] int    QueryUvFlippedCount(int Asset) noexcept; // 🧩 Always 0: every pinned asset is clean.

struct UvWorkspaceLogEntry
{
    std::string Channel;
    std::string Message;
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    STATE
//------------------------------------------------------------------------------------------------------------------------

struct UvWorkspaceState
{
    enum
    {
        ModeVertex = 0,
        ModeEdge,
        ModeFace,
        ModeIsland
    };

    enum
    {
        ToolSelect = 0,
        ToolMove,
        ToolRotate,
        ToolScale,
        ToolBox,
        ToolCircle,
        ToolSeam,
        ToolCursor
    };

    enum
    {
        StageSplit = 0,
        StageUv,
        StageMesh
    };

    enum
    {
        PivotMedian = 0,
        PivotBounds,
        PivotCursor,
        PivotIndividual
    };

    enum
    {
        SnapOff = 0,
        SnapGrid,
        SnapPixel,
        SnapVertex
    };

    enum
    {
        LensImportance = 0,
        LensClean,
        LensTexel,
        LensStretchAngle,
        LensStretchArea,
        LensOverlap
    };

    enum
    {
        ShadeChecker = 0,
        ShadeFlat,
        ShadeMatcap,
        ShadeMatcapSatin,
        ShadeImportance,
        ShadeTexel,
        ShadeStretch
    };

    enum
    {
        TabPacking = 0,
        TabUnwrap,
        TabUdim,
        TabCheck
    };

    enum
    {
        FilterAll = 0,
        FilterSelected,
        FilterGrouped,
        FilterIssues
    };

    enum
    {
        BudgetStrict = 0,
        BudgetFill
    };

    enum
    {
        ScopeActiveUdim = 0,
        ScopePerUdim,
        ScopeAutoSpill,
        ScopeSelectedOnly
    };

    enum
    {
        RotationsLocked = 0,
        RotationsOrtho,
        RotationsOct,
        RotationsFine
    };

    enum
    {
        CameraPersp = 0,
        CameraFront,
        CameraSide,
        CameraTop
    };

    int Asset    = 0; // 🧩 0 coupe boots, like the prototype.
    int Selected = -1; // 🧩 Selected island, or -1.
    int InspectorTab = TabPacking;

    int  SelectionMode = ModeIsland; // 🧩 Local, silent.
    int  Tool          = ToolSelect; // 🧩 Local, silent.
    int  StageMode     = StageSplit; // 🧩 Local, silent.
    int  Pivot         = PivotMedian;
    int  Snap          = SnapOff;
    int  Lens          = LensImportance; // 🧩 Local, silent.
    int  Shade         = ShadeChecker;   // 🧩 Local, silent.
    int  Camera        = CameraPersp;    // 🧩 Local, silent.
    bool SyncSelection = true;
    bool ShowChecker   = true;
    bool ShowSeams     = true;
    bool ShowBounds    = true;
    bool ShowWire3D    = true;
    bool ProportionalEnabled = false;
    double ProportionalRadius = 0.22;
    double CursorU = 0.5, CursorV = 0.5;

    bool   LiveUnwrap = false;
    double SmartAngleDeg = 55.0;
    double SharpAngleDeg = 35.0;
    double RelaxIterations = 18.0;
    double TargetTexelDensity = 8.5; // 🧩 px/cm.
    int    BudgetMode = BudgetStrict;
    int    PackScope  = ScopeActiveUdim;
    double MarginPx   = 12.0;
    int    Rotations  = RotationsOrtho;
    bool   EqualizeWithinGroup = true;
    double PendingGroupPct = 30.0;

    int ActiveUdim = 1001; // 🧩 Local, silent.
    int OutlinerFilter = FilterAll;

    bool IslandLocked[32] = {}; // 🧩 Shell-local per-island flags (max 30 islands on coupe).
    bool IslandHidden[32] = {};
    bool IslandPicked[32] = {}; // 🧩 Multi-select mirror; Selected tracks the lead pick.

    bool LogOpen     = false;
    bool HelpOpen    = false;
    bool ExportOpen  = false;

    std::string AssetName; // 🧩 Shell-local rename copy.
    std::string SearchQuery;

    double GroupTarget[4] = {}; // 🧩 Shell-local target-% overrides, staged from the catalogue.
    int    TileRes[4]     = {}; // 🧩 Shell-local resolution overrides (px).
    int    TileBacking[4] = {}; // 🧩 Shell-local backing overrides (0 color, 1 uv, 2 checker, 3 blank).

    int  NoopCount = 0; // 🧩 Incremented by every refused solver/filesystem command.
    bool ExportObjNoopRaised = false; // 🧩 Latched by validation: exports stay explicit NOOPs.
    bool PackNoopRaised      = false;
    bool UnwrapNoopRaised    = false;

    enum
    {
        CardPackHero = 0,
        CardPackAllocator,
        CardPackEngine,
        CardUnwrapOps,
        CardRelax,
        CardTopo,
        CardPinWeld,
        CardAlign,
        CardUdimMatrix,
        CardUdimTile,
        CardDiagRepair,
        CardCount
    };
    bool OpenCards[CardCount] = {};

    std::deque<UvWorkspaceLogEntry> Log;
    std::map<std::string, ImVec4>   Rects; // 🧩 Named hit rects refreshed every frame for scripted validation.
};

void        ConstructUvWorkspaceState(UvWorkspaceState& State);
void        AppendUvWorkspaceLog(UvWorkspaceState& State, const char* Channel, const char* Message);
void        NoopUvWorkspaceCommand(UvWorkspaceState& State, const char* Channel, const char* Message,
                                   const char* ToastText);
void        LogUvWorkspaceValue(UvWorkspaceState& State, const char* Channel, const char* Label, const char* Shown);
void        SelectUvWorkspaceAsset(UvWorkspaceState& State, int Asset); // 🧩 Silent restage + RIG line.
void        SelectUvWorkspaceIsland(UvWorkspaceState& State, int Island, bool Additive) noexcept; // 🧩 Silent.
void        RecordUvWorkspaceRect(UvWorkspaceState& State, const char* Name, ImVec2 Min, ImVec2 Max);
[[nodiscard]] bool QueryUvWorkspaceRect(const UvWorkspaceState& State, const char* Name, ImVec2& Min,
                                        ImVec2& Max) noexcept;

void ApplyUvWorkspaceLink(UvWorkspaceState& State, AssetBrowserLink* Link); // 🧩 uv/<id> → old tab restage.
void ConstructUvWorkspace(UvWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Size,
                          AssetBrowserLink* Link = nullptr);

class ControlColumn;
void ConstructUvWorkspaceInspector(UvWorkspaceState& State, const EditorTypefaces& Faces, ControlColumn& Column);

} // namespace Frontier
