/*==========================================================================================================================================
                                                          UVWORKSPACE.CPP
==========================================================================================================================================*/
// 🧩 The UV Workspace root shell: asset tab bar, island outliner with importance buckets, UDIM chips, selection
//    mode / tool / pivot / snap / lens / shade HUD, split 2D atlas + 3D mesh stage, Blender operator dock, log
//    drawer, status bar, 4-tab inspector host, and the hotkey reference sheet. Value edits touch shell-local state
//    only; every solver/filesystem-bound command is an explicit NOOP with a toast and a warm log line. The help
//    sheet lives in its own overlay so its close key receives presses. The 2D atlas draws the pinned per-island
//    UV bounds; the 3D mesh panel is static decor, honestly labelled in the viewport corner.

#include "Engine/Interface/Workspaces/UvWorkspace.h"

#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/ControlTheme.h"
#include "Engine/Interface/Controls/GlyphRun.h"
#include "Engine/Interface/Controls/GlyphSymbol.h"
#include "Engine/Interface/Controls/Toast.h"
#include "Engine/Interface/InspectorControls.h"

#include <imgui_internal.h>

#include <cmath>
#include <cstdio>
#include <cstring>

namespace Frontier
{
namespace
{

void RecordRect(UvWorkspaceState& State, const char* Name, ImVec2 Min, ImVec2 Max)
{
    State.Rects[Name] = ImVec4(Min.x, Min.y, Max.x, Max.y);
}

struct PanelCursor
{
    ImDrawList*            DrawList = nullptr;
    const EditorTypefaces* Faces    = nullptr;
    float                  S        = 1.0f;
    float                  X        = 0.0f;
    float                  Width    = 0.0f;
    float                  Y        = 0.0f;

    ImVec2 Space(float CssHeight, float MarginTop = 0.0f, float MarginBottom = 0.0f)
    {
        Y += MarginTop * S;
        const ImVec2 Top(X, Y);
        Y += CssHeight * S + MarginBottom * S;
        return Top;
    }

    [[nodiscard]] float Measure(ImFont* Face, float Size, const char* Text, float Tracking = 0.0f) const
    {
        return GlyphRun::Rasterize(nullptr, Faces, Face, Size * S, ImVec2(0.0f, 0.0f), 0, Text, Tracking * S, true);
    }

    float Text(ImFont* Face, float Size, float AtX, float Top, float LineHeight, ImU32 Colour, const char* Content,
               float Tracking = 0.0f) const
    {
        return GlyphRun::Rasterize(DrawList, Faces, Face, Size * S, ImVec2(AtX, GlyphRun::ResolveBaseline(Top, Size * S, LineHeight)),
                                   Colour, Content, Tracking * S, false);
    }
};

bool InvisibleRect(const char* Id, ImVec2 Min, ImVec2 Max)
{
    ImGui::SetCursorScreenPos(Min);
    return ImGui::InvisibleButton(Id, ImVec2(Max.x - Min.x, Max.y - Min.y), ImGuiButtonFlags_EnableNav);
}

bool QueryMatches(const char* Haystack, const std::string& Needle)
{
    if (Needle.empty() || Haystack == nullptr) return true;
    const size_t HayLength    = std::strlen(Haystack);
    const size_t NeedleLength = Needle.size();
    if (NeedleLength > HayLength) return false;
    for (size_t Start = 0; Start + NeedleLength <= HayLength; ++Start)
    {
        bool Hit = true;
        for (size_t Index = 0; Index < NeedleLength; ++Index)
        {
            const char Hay = Haystack[Start + Index];
            const char Want = Needle[Index];
            const char HayLow  = Hay >= 'A' && Hay <= 'Z' ? static_cast<char>(Hay + 32) : Hay;
            const char WantLow = Want >= 'A' && Want <= 'Z' ? static_cast<char>(Want + 32) : Want;
            if (HayLow != WantLow) Hit = false;
        }
        if (Hit) return true;
    }
    return false;
}

void FormatRes(int Resolution, char* Text, size_t Size) noexcept
{
    if (Resolution >= 1024) std::snprintf(Text, Size, "%dK", Resolution / 1024);
    else std::snprintf(Text, Size, "%d", Resolution);
}

uint32_t GroupAccent(int Asset, int Group) noexcept
{
    if (Group < 0) return 0x787F88FF; // 🧩 Remainder pool grey, like the prototype.
    return QueryUvGroup(Asset, Group).Accent;
}

int QueryPickedCount(const UvWorkspaceState& State) noexcept
{
    int N = 0;
    const int Count = QueryUvIslandCount(State.Asset);
    for (int I = 0; I < Count && I < 32; ++I)
        if (State.IslandPicked[I]) ++N;
    return N;
}

bool PillButton(UvWorkspaceState& State, PanelCursor& Panel, const char* Tag, const char* Id, float AtX, float AtY,
                const char* Label, bool Active, float Wide = 0.0f)
{
    const EditorTypefaces& Faces = *Panel.Faces;
    ImDrawList* const DrawList   = Panel.DrawList;
    const float LabelWide = Panel.Measure(Faces.Medium, 10.5f, Label);
    const float W         = Wide > 0.0f ? Wide : LabelWide + 22.0f;
    const ImVec2 Min(AtX, AtY);
    const ImVec2 Max(AtX + W, AtY + 26.0f);
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(Active ? 0xE8C27A22 : 0x1A1A1AFF), 13.0f);
    if (Active) DrawList->AddRect(Min, Max, ResolveCssColour(0xE8C27A88), 13.0f, ImDrawFlags_None, 1.0f);
    Panel.Text(Faces.Medium, 10.5f, AtX + (W - LabelWide) * 0.5f, AtY + 13.0f - 0.5f * 10.5f * 1.38f, 1.38f,
               ResolveCssColour(Active ? 0xF2E3C4FF : 0xBCBCBCFF), Label);
    RecordRect(State, Tag, Min, Max);
    ImGui::PushID(Id);
    const bool Fired = InvisibleRect("##Pill", Min, Max);
    ImGui::PopID();
    return Fired;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    TOP BAR
//------------------------------------------------------------------------------------------------------------------------

void ConstructTopBar(UvWorkspaceState& State, PanelCursor& Root, AssetBrowserLink* Link)
{
    const EditorTypefaces& Faces    = *Root.Faces;
    ImDrawList* const      DrawList = Root.DrawList;
    const ImVec2           Bar      = Root.Space(46.0f, 0.0f, 8.0f);
    const float            Left     = Bar.x;
    const float            Right    = Bar.x + Root.Width;

    Root.Text(Faces.SemiBold, 14.0f, Left, Bar.y + 23.0f - 0.5f * 14.0f * 1.3f, 1.3f,
              ResolveCssColour(0xF1F1F1FF), "Frontier", -0.3f);
    const float BrandW = Root.Measure(Faces.SemiBold, 14.0f, "Frontier", -0.3f);
    Root.Text(Faces.Regular, 13.0f, Left + BrandW + 5.0f, Bar.y + 23.0f - 0.5f * 13.0f * 1.4f, 1.4f,
              ResolveCssColour(0x5E5E5EFF), "/");
    Root.Text(Faces.Regular, 13.0f, Left + BrandW + 15.0f, Bar.y + 23.0f - 0.5f * 13.0f * 1.4f, 1.4f,
              ResolveCssColour(0xBCBCBCFF), "UV Studio");

    // 📝 Right action cluster first so the tabs can never overlap it.
    struct Action
    {
        const char* Tag;
        const char* Id;
        const char* Label;
    };
    static const Action Actions[5] = {
        { "TopBar/Undo", "UvUndo", "Undo" },
        { "TopBar/Redo", "UvRedo", "Redo" },
        { "TopBar/Import", "UvImport", "Import OBJ" },
        { "TopBar/Help", "UvHelp", "?" },
        { "TopBar/Export", "UvExport", "Export OBJ" },
    };
    float Cursor = Right;
    for (int I = 4; I >= 0; --I)
    {
        const float LabelWide = Root.Measure(Faces.Medium, 10.5f, Actions[I].Label);
        const float W         = LabelWide + 22.0f;
        Cursor -= W;
        const ImVec2 Min(Cursor, Bar.y + 10.0f);
        const ImVec2 Max(Cursor + W, Bar.y + 36.0f);
        const bool Accent = I == 4;
        DrawList->AddRectFilled(Min, Max, ResolveCssColour(Accent ? 0xE8C27A22 : 0x1A1A1AFF), 13.0f);
        Root.Text(Faces.Medium, 10.5f, Cursor + 11.0f, Bar.y + 23.0f - 0.5f * 10.5f * 1.38f, 1.38f,
                  ResolveCssColour(Accent ? 0xF2E3C4FF : 0xBCBCBCFF), Actions[I].Label);
        RecordRect(State, Actions[I].Tag, Min, Max);
        ImGui::PushID(Actions[I].Id);
        const bool Fired = InvisibleRect("##TopAction", Min, Max);
        ImGui::PopID();
        if (Fired)
        {
            if (I == 0) NoopUvWorkspaceCommand(State, "UNDO", "Undo refused", "Undo is a NOOP in this shell");
            else if (I == 1) NoopUvWorkspaceCommand(State, "UNDO", "Redo refused", "Redo is a NOOP in this shell");
            else if (I == 2)
                NoopUvWorkspaceCommand(State, "IMPORT", "Import .obj refused", "OBJ import is a NOOP in this shell");
            else if (I == 3) State.HelpOpen = !State.HelpOpen;
            else NoopUvWorkspaceCommand(State, "EXPORT", "Export .obj refused", "OBJ export is a NOOP in this shell");
        }
        Cursor -= 8.0f;
    }

    // 📝 Atlas health tag: live from the pinned diagnostics (always clean).
    char Health[48]{};
    std::snprintf(Health, sizeof(Health), "%d OVERLAPS", QueryUvOverlapCount(State.Asset));
    const float HealthWide = Root.Measure(Faces.SemiBold, 10.0f, Health, 0.6f) + 30.0f;
    Cursor -= HealthWide;
    const ImVec2 HealthMin(Cursor, Bar.y + 12.0f);
    const ImVec2 HealthMax(Cursor + HealthWide, Bar.y + 34.0f);
    DrawList->AddRectFilled(HealthMin, HealthMax, ResolveCssColour(0x9BDAC522), 11.0f);
    DrawList->AddCircleFilled(ImVec2(HealthMin.x + 12.0f, Bar.y + 23.0f), 3.5f, ResolveCssColour(0x9BDAC5FF), 12);
    Root.Text(Faces.SemiBold, 10.0f, HealthMin.x + 20.0f, Bar.y + 23.0f - 0.5f * 10.0f * 1.4f, 1.4f,
              ResolveCssColour(0x9BDAC5FF), Health, 0.6f);
    Cursor -= 12.0f;

    // 📝 Stage-mode nav + asset tabs share the remaining middle span.
    static const char* StageModes[3] = { "Split 2D + 3D", "2D UV Atlas", "3D Mesh" };
    float NavCursor = Cursor;
    for (int I = 2; I >= 0; --I)
    {
        const float LabelWide = Root.Measure(Faces.Medium, 10.5f, StageModes[I]);
        NavCursor -= LabelWide + 22.0f;
        char Tag[32]{};
        std::snprintf(Tag, sizeof(Tag), "TopBar/Stage%d", I);
        char Id[32]{};
        std::snprintf(Id, sizeof(Id), "UvStage%d", I);
        if (PillButton(State, Root, Tag, Id, NavCursor, Bar.y + 10.0f, StageModes[I], State.StageMode == I))
            State.StageMode = I; // 🧩 Silent: stage layout is local view state.
        NavCursor -= 8.0f;
    }

    float TabX = Left + BrandW + 118.0f;
    for (int I = 0; I < 4; ++I)
    {
        const char* Label = QueryUvAsset(I).Label;
        const float LabelWide = Root.Measure(Faces.Medium, 10.5f, Label);
        const float W = LabelWide + 22.0f;
        if (TabX + W > NavCursor - 8.0f) break;
        char Tag[32]{};
        std::snprintf(Tag, sizeof(Tag), "TopBar/Asset%d", I);
        char Id[32]{};
        std::snprintf(Id, sizeof(Id), "UvAsset%d", I);
        if (PillButton(State, Root, Tag, Id, TabX, Bar.y + 10.0f, Label, State.Asset == I))
            SelectUvWorkspaceAsset(State, I);
        TabX += W + 6.0f;
    }
    // 📝 Asset browsing moved out to the shared Asset Browser; the tabs keep their local restage.
    {
        const float BrowseWide = Root.Measure(Faces.Medium, 10.5f, "Browse \u2197") + 22.0f;
        if (TabX + BrowseWide <= NavCursor - 8.0f &&
            PillButton(State, Root, "TopBar/Browse", "UvBrowse", TabX, Bar.y + 10.0f, "Browse \u2197", false))
        {
            if (Link != nullptr)
            {
                Link->OpenRequested = true;
                Link->OpenWorkspace = AssetBrowserWorkspaceUv;
            }
            else Toast::Show("The Asset Browser is not attached in this shell.");
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    OUTLINER
//------------------------------------------------------------------------------------------------------------------------

void ConstructOutlinerPanel(UvWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Min, ImVec2 Max)
{
    ImDrawList* const DrawList = ImGui::GetWindowDrawList();
    const int         Asset    = State.Asset;
    const int         Islands  = QueryUvIslandCount(Asset);
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x121212FF), 22.0f);
    DrawList->AddRect(Min, Max, ResolveCssColour(0xFFFFFF0E), 22.0f, ImDrawFlags_None, 1.0f);
    PanelCursor Panel{ DrawList, &Faces, 1.0f, Min.x + 14.0f, Max.x - Min.x - 28.0f, Min.y + 12.0f };

    const ImVec2 Head = Panel.Space(50.0f, 0.0f, 6.0f);
    Panel.Text(Faces.SemiBold, 15.0f, Head.x, Head.y, 1.3f, ResolveCssColour(0xF1F1F1FF), "UV Outliner", -0.2f);
    Panel.Text(Faces.Regular, 10.0f, Head.x, Head.y + 22.0f, 1.4f, ResolveCssColour(0x848484FF),
               "Islands, UDIM tiles & priority groups");
    // 📝 Compact + add-tile keys: compact is silent local state (un Rudy), add-tile is a doc mutation NOOP.
    static const char* HeadKeys[2] = { "Outliner/Compact", "Outliner/AddTile" };
    static const char* HeadIds[2]  = { "UvCompact", "UvAddTile" };
    static const char* HeadGlyphs[2] = { "StudioCompact", "StudioPlus" };
    for (int I = 0; I < 2; ++I)
    {
        const ImVec2 KeyMax(Head.x + Panel.Width - I * 36.0f, Head.y + 30.0f);
        const ImVec2 KeyMin(KeyMax.x - 28.0f, Head.y + 2.0f);
        DrawList->AddRectFilled(KeyMin, KeyMax, ResolveCssColour(0x1A1A1AFF), 9.0f);
        (void)GlyphSymbol::Construct(DrawList, HeadGlyphs[I], ImVec2(KeyMin.x + 8.0f, KeyMin.y + 8.0f), 12.0f,
                                     1.8f, ResolveCssColour(0xBCBCBCFF));
        RecordRect(State, HeadKeys[I], KeyMin, KeyMax);
        ImGui::PushID(HeadIds[I]);
        const bool Fired = InvisibleRect("##HeadKey", KeyMin, KeyMax);
        ImGui::PopID();
        if (Fired && I == 1)
            NoopUvWorkspaceCommand(State, "UDIM", "Add UDIM tile refused", "Adding UDIM tiles is a NOOP in this shell");
    }

    // 📝 Census tiles: live island + UDIM counts from the pinned tables.
    const ImVec2 Census = Panel.Space(58.0f, 0.0f, 8.0f);
    const float  TileWide = (Panel.Width - 8.0f) * 0.5f;
    for (int Tile = 0; Tile < 2; ++Tile)
    {
        const ImVec2 TileMin(Census.x + Tile * (TileWide + 8.0f), Census.y);
        const ImVec2 TileMax(TileMin.x + TileWide, Census.y + 58.0f);
        DrawList->AddRectFilled(TileMin, TileMax, ResolveCssColour(0x1E1E1EFF), 12.0f);
        char Figure[16]{}, Sub[64]{};
        if (Tile == 0)
        {
            int Grouped = 0;
            for (int G = 0; G < QueryUvGroupCount(Asset); ++G) Grouped += QueryUvGroupIslandCount(Asset, G);
            std::snprintf(Figure, sizeof(Figure), "%d", Islands);
            std::snprintf(Sub, sizeof(Sub), "%d grouped · %d auto", Grouped, Islands - Grouped);
            Panel.Text(Faces.Regular, 9.0f, TileMin.x + 10.0f, TileMin.y + 6.0f, 1.4f, ResolveCssColour(0x848484FF),
                       "UV ISLANDS", 0.9f);
        }
        else
        {
            const int Tiles = QueryUvTileCount(Asset);
            std::snprintf(Figure, sizeof(Figure), "%d", Tiles);
            if (Tiles == 1) std::snprintf(Sub, sizeof(Sub), "UDIM %d", QueryUvTile(Asset, 0).Id);
            else if (Tiles == 2)
                std::snprintf(Sub, sizeof(Sub), "%d · %d", QueryUvTile(Asset, 0).Id, QueryUvTile(Asset, 1).Id);
            else std::snprintf(Sub, sizeof(Sub), "%d–%d", QueryUvTile(Asset, 0).Id, QueryUvTile(Asset, Tiles - 1).Id);
            Panel.Text(Faces.Regular, 9.0f, TileMin.x + 10.0f, TileMin.y + 6.0f, 1.4f, ResolveCssColour(0x848484FF),
                       "UDIM TILES", 0.9f);
        }
        Panel.Text(Faces.SemiBold, 15.0f, TileMin.x + 10.0f, TileMin.y + 18.0f, 1.3f,
                   ResolveCssColour(0xEFEFEFFF), Figure);
        Panel.Text(Faces.Regular, 9.5f, TileMin.x + 10.0f, TileMin.y + 39.0f, 1.4f, ResolveCssColour(0x5E5E5EFF),
                   Sub);
    }

    // 📝 Search field (shell-local filter text).
    const ImVec2 Search = Panel.Space(32.0f, 0.0f, 8.0f);
    {
        const ImVec2 BoxMax(Search.x + Panel.Width, Search.y + 32.0f);
        DrawList->AddRectFilled(Search, BoxMax, ResolveCssColour(0x0E0F12D6), 10.0f);
        DrawList->AddRect(Search, BoxMax, ResolveCssColour(0xFFFFFF12), 10.0f, ImDrawFlags_None, 1.0f);
        (void)GlyphSymbol::Construct(DrawList, "StudioSearch", ImVec2(Search.x + 9.0f, Search.y + 10.0f), 12.0f,
                                     1.8f, ResolveCssColour(0x5E5E5EFF));
        if (State.SearchQuery.empty())
            Panel.Text(Faces.Regular, 11.0f, Search.x + 28.0f, Search.y + 16.0f - 0.5f * 11.0f * 1.4f, 1.4f,
                       ResolveCssColour(0x5E5E5EFF), "Filter islands, materials, UDIMs…");
        ImGui::PushID("UvOutlinerSearch");
        RecordRect(State, "Outliner/Search", Search, BoxMax);
        char Buffer[128]{};
        std::snprintf(Buffer, sizeof(Buffer), "%s", State.SearchQuery.c_str());
        ImGui::SetCursorScreenPos(ImVec2(Search.x + 26.0f, Search.y + 2.0f));
        ImGui::SetNextItemWidth(BoxMax.x - Search.x - 32.0f);
        ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0, 0, 0, 0));
        ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 0.0f);
        ImGui::PushStyleColor(ImGuiCol_Text, ImGui::ColorConvertU32ToFloat4(ResolveCssColour(0xD8D8D8FF)));
        if (ImGui::InputText("##Search", Buffer, sizeof(Buffer), ImGuiInputTextFlags_EscapeClearsAll))
            State.SearchQuery = Buffer;
        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar();
        ImGui::PopID();
    }

    // 📝 Filter chips: silent local view state.
    static const char* Filters[4] = { "All", "Selected", "Prioritized", "Issues" };
    float FilterX                 = Panel.X;
    const ImVec2 FilterRow        = Panel.Space(26.0f, 0.0f, 8.0f);
    for (int I = 0; I < 4; ++I)
    {
        char Tag[32]{}, Id[32]{};
        std::snprintf(Tag, sizeof(Tag), "Outliner/Filter%d", I);
        std::snprintf(Id, sizeof(Id), "UvFilter%d", I);
        const float W = Panel.Measure(Faces.Medium, 10.5f, Filters[I]) + 22.0f;
        if (PillButton(State, Panel, Tag, Id, FilterX, FilterRow.y, Filters[I], State.OutlinerFilter == I, W))
            State.OutlinerFilter = I;
        FilterX += W + 6.0f;
    }

    // 📝 UDIM strip: chips switch the active tile silently.
    const ImVec2 StripHead = Panel.Space(20.0f, 0.0f, 4.0f);
    Panel.Text(Faces.SemiBold, 9.5f, StripHead.x, StripHead.y, 1.4f, ResolveCssColour(0x848484FF), "UDIM ATLAS TILES",
               0.9f);
    float ChipX           = Panel.X;
    const ImVec2 ChipRow  = Panel.Space(28.0f, 0.0f, 8.0f);
    const int TileCount   = QueryUvTileCount(Asset);
    for (int T = 0; T < TileCount; ++T)
    {
        const UvTileSpec& Tile = QueryUvTile(Asset, T);
        char Label[32]{}, Res[8]{};
        FormatRes(Tile.Resolution, Res, sizeof(Res));
        std::snprintf(Label, sizeof(Label), "%d · %s", Tile.Id, Res);
        char Tag[32]{}, Id[32]{};
        std::snprintf(Tag, sizeof(Tag), "Outliner/Udim%d", Tile.Id);
        std::snprintf(Id, sizeof(Id), "UvUdim%d", Tile.Id);
        const float W = Panel.Measure(Faces.Medium, 10.5f, Label) + 22.0f;
        if (ChipX + W > Panel.X + Panel.Width) break;
        if (PillButton(State, Panel, Tag, Id, ChipX, ChipRow.y, Label, State.ActiveUdim == Tile.Id, W))
            State.ActiveUdim = Tile.Id; // 🧩 Silent.
        ChipX += W + 6.0f;
    }

    // 📝 Island buckets: one tree group per importance group plus the remainder pool.
    const int Groups = QueryUvGroupCount(Asset);
    for (int Bucket = 0; Bucket <= Groups; ++Bucket)
    {
        const int GroupIdx = Bucket < Groups ? Bucket : -1;
        int       Shown    = 0;
        for (int I = 0; I < Islands; ++I)
        {
            const UvIslandSpec& Isl = QueryUvIsland(Asset, I);
            if (Isl.Group != GroupIdx) continue;
            if (State.OutlinerFilter == UvWorkspaceState::FilterSelected && !State.IslandPicked[I]) continue;
            if (State.OutlinerFilter == UvWorkspaceState::FilterGrouped && GroupIdx < 0) continue;
            if (State.OutlinerFilter == UvWorkspaceState::FilterIssues) continue; // 🧩 Pinned assets are clean.
            char Hay[160]{};
            std::snprintf(Hay, sizeof(Hay), "%s %d", Isl.Name, Isl.Udim);
            if (!QueryMatches(Hay, State.SearchQuery)) continue;
            ++Shown;
        }
        if (Shown == 0) continue;
        char Title[96]{};
        if (GroupIdx >= 0)
            std::snprintf(Title, sizeof(Title), "%s (%.0f%%)", QueryUvGroup(Asset, GroupIdx).Name,
                          State.GroupTarget[GroupIdx]);
        else std::snprintf(Title, sizeof(Title), "Remaining Islands (Auto-Fill)");
        const ImVec2 BucketHead = Panel.Space(22.0f, Bucket == 0 ? 0.0f : 6.0f, 2.0f);
        DrawList->AddCircleFilled(ImVec2(BucketHead.x + 6.0f, BucketHead.y + 11.0f), 4.0f,
                                  ResolveCssColour(GroupAccent(Asset, GroupIdx)), 12);
        Panel.Text(Faces.Medium, 10.5f, BucketHead.x + 16.0f, BucketHead.y + 11.0f - 0.5f * 10.5f * 1.38f, 1.38f,
                   ResolveCssColour(0xD8D8D8FF), Title);
        char CountText[16]{};
        std::snprintf(CountText, sizeof(CountText), "%d", Shown);
        const float CountW = Panel.Measure(Faces.Regular, 10.0f, CountText);
        Panel.Text(Faces.Regular, 10.0f, BucketHead.x + Panel.Width - CountW, BucketHead.y, 1.4f,
                   ResolveCssColour(0x5E5E5EFF), CountText);

        for (int I = 0; I < Islands; ++I)
        {
            const UvIslandSpec& Isl = QueryUvIsland(Asset, I);
            if (Isl.Group != GroupIdx) continue;
            if (State.OutlinerFilter == UvWorkspaceState::FilterSelected && !State.IslandPicked[I]) continue;
            if (State.OutlinerFilter == UvWorkspaceState::FilterGrouped && GroupIdx < 0) continue;
            if (State.OutlinerFilter == UvWorkspaceState::FilterIssues) continue;
            char Hay[160]{};
            std::snprintf(Hay, sizeof(Hay), "%s %d", Isl.Name, Isl.Udim);
            if (!QueryMatches(Hay, State.SearchQuery)) continue;
            const ImVec2 RowMin(Panel.X, Panel.Y);
            const ImVec2 RowMax(Panel.X + Panel.Width, Panel.Y + 42.0f);
            Panel.Y += 44.0f;
            const bool Current = State.Selected == I;
            if (Current) DrawList->AddRectFilled(RowMin, RowMax, ResolveCssColour(0xE8C27A14), 10.0f);
            const ImU32 Accent = ResolveCssColour(GroupAccent(Asset, GroupIdx));
            DrawList->AddRectFilled(ImVec2(RowMin.x + 4.0f, RowMin.y + 8.0f), ImVec2(RowMin.x + 8.0f, RowMax.y - 8.0f),
                                    Accent, 2.0f);
            const ImU32 NameColour =
                ResolveCssColour(State.IslandHidden[I] ? 0x5E5E5EFF : 0xEFEFEFFF);
            Panel.Text(Faces.Medium, 11.0f, RowMin.x + 16.0f, RowMin.y + 4.0f, 1.38f, NameColour, Isl.Name);
            char Meta[96]{};
            std::snprintf(Meta, sizeof(Meta), "%df · %.1f px/cm · %.1f%%", Isl.Faces, Isl.Texel, Isl.AreaPct);
            Panel.Text(Faces.Regular, 9.5f, RowMin.x + 16.0f, RowMin.y + 21.0f, 1.4f,
                       ResolveCssColour(0x848484FF), Meta);
            char UdimText[16]{};
            std::snprintf(UdimText, sizeof(UdimText), "%d", Isl.Udim);
            const float UdimW = Panel.Measure(Faces.Medium, 9.0f, UdimText);
            Panel.Text(Faces.Medium, 9.0f, RowMax.x - 62.0f - UdimW, RowMin.y + 21.0f, 1.4f,
                       ResolveCssColour(0x9ECFFFFF), UdimText);

            ImGui::PushID(1000 + I);
            // 📝 Eye key: shell-local hide flag (PARAM line, census of visible rows follows).
            const ImVec2 EyeMax(RowMax.x - 6.0f, RowMin.y + 34.0f);
            const ImVec2 EyeMin(EyeMax.x - 24.0f, RowMin.y + 10.0f);
            (void)GlyphSymbol::Construct(DrawList, State.IslandHidden[I] ? "StudioEyeOff" : "StudioEye",
                                         ImVec2(EyeMin.x + 5.0f, EyeMin.y + 5.0f), 14.0f, 1.6f,
                                         ResolveCssColour(State.IslandHidden[I] ? 0x5E5E5EFF : 0xBCBCBCFF));
            char EyeTag[48]{};
            std::snprintf(EyeTag, sizeof(EyeTag), "Outliner/Eye%d", I);
            RecordRect(State, EyeTag, EyeMin, EyeMax);
            if (InvisibleRect("##IslandEye", EyeMin, EyeMax))
            {
                State.IslandHidden[I] = !State.IslandHidden[I];
                LogUvWorkspaceValue(State, "PARAM", Isl.Name, State.IslandHidden[I] ? "hidden" : "shown");
            }
            // 📝 Lock key: shell-local pack-lock flag.
            const ImVec2 LockMax(EyeMin.x - 2.0f, RowMin.y + 34.0f);
            const ImVec2 LockMin(LockMax.x - 24.0f, RowMin.y + 10.0f);
            const ImU32 LockColour = ResolveCssColour(State.IslandLocked[I] ? 0xE8C27AFF : 0x5E5E5EFF);
            DrawList->AddRect(ImVec2(LockMin.x + 7.0f, LockMin.y + 11.0f), ImVec2(LockMin.x + 17.0f, LockMin.y + 19.0f),
                              LockColour, 1.5f, ImDrawFlags_None, 1.6f);
            DrawList->AddLine(ImVec2(LockMin.x + 9.0f, LockMin.y + 11.0f), ImVec2(LockMin.x + 9.0f, LockMin.y + 8.0f),
                              LockColour, 1.6f);
            DrawList->AddLine(ImVec2(LockMin.x + 15.0f, LockMin.y + 11.0f), ImVec2(LockMin.x + 15.0f, LockMin.y + 8.0f),
                              LockColour, 1.6f);
            DrawList->AddLine(ImVec2(LockMin.x + 9.0f, LockMin.y + 8.0f), ImVec2(LockMin.x + 15.0f, LockMin.y + 8.0f),
                              LockColour, 1.6f);
            char LockTag[48]{};
            std::snprintf(LockTag, sizeof(LockTag), "Outliner/Lock%d", I);
            RecordRect(State, LockTag, LockMin, LockMax);
            if (InvisibleRect("##IslandLock", LockMin, LockMax))
            {
                State.IslandLocked[I] = !State.IslandLocked[I];
                LogUvWorkspaceValue(State, "PARAM", Isl.Name, State.IslandLocked[I] ? "locked" : "unlocked");
            }
            char RowTag[48]{};
            std::snprintf(RowTag, sizeof(RowTag), "Outliner/Row%d", I);
            RecordRect(State, RowTag, RowMin, ImVec2(LockMin.x, RowMax.y));
            if (InvisibleRect("##IslandRow", RowMin, ImVec2(LockMin.x, RowMax.y)))
                SelectUvWorkspaceIsland(State, I, (ImGui::GetIO().KeyShift || ImGui::GetIO().KeyCtrl));
            ImGui::PopID();
        }
    }

    // 📝 Quick unwrap drawer: Smart UV + analytic presets, all solver-bound NOOPs.
    const ImVec2 QuickHead = Panel.Space(22.0f, 8.0f, 4.0f);
    Panel.Text(Faces.SemiBold, 9.5f, QuickHead.x, QuickHead.y, 1.4f, ResolveCssColour(0x848484FF),
               "QUICK UNWRAP & PROJECTIONS", 0.9f);
    static const char* QuickLabels[5] = { "Smart UV", "Cube", "Cylinder", "Sphere", "View" };
    float QuickX                      = Panel.X;
    float QuickY                      = Panel.Y;
    for (int I = 0; I < 5; ++I)
    {
        const float W = Panel.Measure(Faces.Medium, 10.0f, QuickLabels[I]) + 20.0f;
        if (QuickX + W > Panel.X + Panel.Width)
        {
            QuickX = Panel.X;
            QuickY += 30.0f;
        }
        char Tag[40]{}, Id[40]{};
        std::snprintf(Tag, sizeof(Tag), "Outliner/Quick%d", I);
        std::snprintf(Id, sizeof(Id), "UvQuick%d", I);
        const ImVec2 ChipMin(QuickX, QuickY);
        const ImVec2 ChipMax(QuickX + W, QuickY + 24.0f);
        DrawList->AddRectFilled(ChipMin, ChipMax, ResolveCssColour(0x1A1A1AFF), 12.0f);
        Panel.Text(Faces.Medium, 10.0f, ChipMin.x + 10.0f, QuickY + 12.0f - 0.5f * 10.0f * 1.38f, 1.38f,
                   ResolveCssColour(0xBCBCBCFF), QuickLabels[I]);
        RecordRect(State, Tag, ChipMin, ChipMax);
        ImGui::PushID(Id);
        const bool Fired = InvisibleRect("##QuickChip", ChipMin, ChipMax);
        ImGui::PopID();
        if (Fired)
        {
            char Message[96]{};
            std::snprintf(Message, sizeof(Message), "%s refused", QuickLabels[I]);
            NoopUvWorkspaceCommand(State, "UNWRAP", Message, "Unwrap solvers are NOOPs in this shell");
        }
        QuickX = ChipMax.x + 6.0f;
    }
    Panel.Y = QuickY + 30.0f;

    const ImVec2 Foot = Panel.Space(20.0f, 6.0f, 0.0f);
    DrawList->AddCircleFilled(ImVec2(Foot.x + 5.0f, Foot.y + 10.0f), 3.0f, ResolveCssColour(0x9BDAC5FF), 10);
    Panel.Text(Faces.Regular, 9.5f, Foot.x + 14.0f, Foot.y, 1.4f, ResolveCssColour(0x5E5E5EFF),
               "Drag-select islands · Shift+Click multi-select");
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    VIEWPORT BAR
//------------------------------------------------------------------------------------------------------------------------

void ConstructViewportBar(UvWorkspaceState& State, PanelCursor& Panel)
{
    const EditorTypefaces& Faces    = *Panel.Faces;
    ImDrawList* const      DrawList = Panel.DrawList;
    const float            RowH     = 30.0f;

    // 📝 Row 1: selection modes, sync, pivot, snap, proportional.
    const ImVec2 Row1 = Panel.Space(RowH, 0.0f, 4.0f);
    float        X    = Row1.x;
    for (int I = 0; I < 4; ++I)
    {
        char Tag[32]{}, Id[32]{};
        std::snprintf(Tag, sizeof(Tag), "Stage/Mode%d", I);
        std::snprintf(Id, sizeof(Id), "UvMode%d", I);
        const char* Label = QueryUvSelectionMode(I);
        const float W     = Panel.Measure(Faces.Medium, 10.5f, Label) + 22.0f;
        if (PillButton(State, Panel, Tag, Id, X, Row1.y, Label, State.SelectionMode == I, W))
            State.SelectionMode = I; // 🧩 Silent.
        X += W + 6.0f;
    }
    X += 6.0f;
    DrawList->AddLine(ImVec2(X, Row1.y + 4.0f), ImVec2(X, Row1.y + RowH - 4.0f), ResolveCssColour(0xFFFFFF14));
    X += 12.0f;
    if (PillButton(State, Panel, "Stage/Sync", "UvSync", X, Row1.y, "Sync 2D<->3D", State.SyncSelection))
        State.SyncSelection = !State.SyncSelection;
    X += Panel.Measure(Faces.Medium, 10.5f, "Sync 2D<->3D") + 22.0f + 6.0f;
    static const char* Pivots[4] = { "Pivot: Median", "Pivot: Bounds", "Pivot: 2D Cursor", "Pivot: Individual" };
    static const char* Snaps[4]  = { "Snap: Off", "Snap: Grid", "Snap: Pixel", "Snap: Vertex" };
    const float        PivotW    = Panel.Measure(Faces.Medium, 10.5f, "Pivot: Individual") + 22.0f;
    if (PillButton(State, Panel, "Stage/Pivot", "UvPivot", X, Row1.y, Pivots[State.Pivot], false, PivotW))
        State.Pivot = (State.Pivot + 1) % 4; // 🧩 Cycle pill: silent local state.
    X += PivotW + 6.0f;
    const float SnapW = Panel.Measure(Faces.Medium, 10.5f, "Snap: Vertex") + 22.0f;
    if (PillButton(State, Panel, "Stage/Snap", "UvSnap", X, Row1.y, Snaps[State.Snap], false, SnapW))
        State.Snap = (State.Snap + 1) % 4;
    X += SnapW + 6.0f;
    if (PillButton(State, Panel, "Stage/Prop", "UvProp", X, Row1.y, "Prop (O)", State.ProportionalEnabled))
        State.ProportionalEnabled = !State.ProportionalEnabled;

    // 📝 Row 2: overlay lens, 3D shading, checker/seams/bounds toggles.
    const ImVec2 Row2 = Panel.Space(RowH, 0.0f, 6.0f);
    X                 = Row2.x;
    char LensLabel[64]{};
    std::snprintf(LensLabel, sizeof(LensLabel), "Lens: %s", QueryUvLens(State.Lens));
    const float LensW = Panel.Measure(Faces.Medium, 10.5f, "Lens: Overlaps & Flipped") + 22.0f;
    if (PillButton(State, Panel, "Stage/Lens", "UvLens", X, Row2.y, LensLabel, false, LensW))
        State.Lens = (State.Lens + 1) % 6;
    X += LensW + 6.0f;
    char ShadeLabel[64]{};
    std::snprintf(ShadeLabel, sizeof(ShadeLabel), "3D: %s", QueryUvShade(State.Shade));
    const float ShadeW = Panel.Measure(Faces.Medium, 10.5f, "3D: Texel Density") + 22.0f;
    if (PillButton(State, Panel, "Stage/Shade", "UvShade", X, Row2.y, ShadeLabel, false, ShadeW))
        State.Shade = (State.Shade + 1) % 7;
    X += ShadeW + 6.0f;
    DrawList->AddLine(ImVec2(X, Row2.y + 4.0f), ImVec2(X, Row2.y + RowH - 4.0f), ResolveCssColour(0xFFFFFF14));
    X += 12.0f;
    if (PillButton(State, Panel, "Stage/Checker", "UvChecker", X, Row2.y, "Checker", State.ShowChecker))
        State.ShowChecker = !State.ShowChecker;
    X += Panel.Measure(Faces.Medium, 10.5f, "Checker") + 22.0f + 6.0f;
    if (PillButton(State, Panel, "Stage/Seams", "UvSeams", X, Row2.y, "Seams", State.ShowSeams))
        State.ShowSeams = !State.ShowSeams;
    X += Panel.Measure(Faces.Medium, 10.5f, "Seams") + 22.0f + 6.0f;
    if (PillButton(State, Panel, "Stage/Bounds", "UvBounds", X, Row2.y, "Bounds", State.ShowBounds))
        State.ShowBounds = !State.ShowBounds;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    2D UV STAGE
//------------------------------------------------------------------------------------------------------------------------

ImU32 IslandLensColour(const UvWorkspaceState& State, int Asset, int Island)
{
    const UvIslandSpec& Isl = QueryUvIsland(Asset, Island);
    const ImU32 Group       = ResolveCssColour(GroupAccent(Asset, Isl.Group));
    if (State.Lens == UvWorkspaceState::LensClean) return ResolveCssColour(0x8A8F96FF);
    if (State.Lens == UvWorkspaceState::LensTexel)
    {
        const float K = static_cast<float>(Isl.Texel / 16.0);
        const float C = K < 0.0f ? 0.0f : (K > 1.0f ? 1.0f : K);
        return IM_COL32(static_cast<int>(60 + 120 * (1.0f - C)), static_cast<int>(140 + 80 * C),
                        static_cast<int>(110 + 60 * C), 255);
    }
    if (State.Lens == UvWorkspaceState::LensStretchAngle || State.Lens == UvWorkspaceState::LensStretchArea)
        return ResolveCssColour(0xE8C27AFF);
    if (State.Lens == UvWorkspaceState::LensOverlap) return ResolveCssColour(0x9BDAC5FF); // 🧩 Clean: 0 overlaps.
    return Group;
}

void ConstructUvStage(UvWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 Min,
                      ImVec2 Max)
{
    const int   Asset   = State.Asset;
    const int   Islands = QueryUvIslandCount(Asset);
    PanelCursor Panel{ DrawList, &Faces, 1.0f, Min.x + 12.0f, Max.x - Min.x - 24.0f, Min.y + 10.0f };

    // 📝 Caption: live pill + active UDIM ticket.
    DrawList->AddCircleFilled(ImVec2(Panel.X + 6.0f, Panel.Y + 9.0f), 3.5f, ResolveCssColour(0x9BDAC5FF), 12);
    Panel.Text(Faces.SemiBold, 10.0f, Panel.X + 14.0f, Panel.Y, 1.4f, ResolveCssColour(0xD8D8D8FF), "2D UV ATLAS",
               0.6f);
    const int TileSlot = QueryUvTileIndex(Asset, State.ActiveUdim);
    char      Ticket[40]{}, Res[8]{};
    FormatRes(TileSlot >= 0 ? QueryUvTile(Asset, TileSlot).Resolution : 2048, Res, sizeof(Res));
    std::snprintf(Ticket, sizeof(Ticket), "UDIM %d · %s", State.ActiveUdim, Res);
    Panel.Text(Faces.Medium, 10.0f, Panel.X + 118.0f, Panel.Y, 1.4f, ResolveCssColour(0x9ECFFFFF), Ticket);

    // 📝 Tool rail down the left edge.
    static const char* ToolShort[8] = { "Sel", "Move", "Rot", "Scale", "Box", "Circ", "Seam", "Cur" };
    float ToolY = Panel.Y + 30.0f;
    for (int I = 0; I < 8; ++I)
    {
        const ImVec2 KeyMin(Panel.X, ToolY);
        const ImVec2 KeyMax(Panel.X + 52.0f, ToolY + 26.0f);
        const bool   Active = State.Tool == I;
        DrawList->AddRectFilled(KeyMin, KeyMax, ResolveCssColour(Active ? 0xE8C27A22 : 0x1A1A1AFF), 8.0f);
        Panel.Text(Faces.Medium, 9.5f, KeyMin.x + 8.0f, ToolY + 13.0f - 0.5f * 9.5f * 1.38f, 1.38f,
                   ResolveCssColour(Active ? 0xF2E3C4FF : 0xBCBCBCFF), ToolShort[I]);
        char Tag[32]{}, Id[32]{};
        std::snprintf(Tag, sizeof(Tag), "Stage/Tool%d", I);
        std::snprintf(Id, sizeof(Id), "UvTool%d", I);
        RecordRect(State, Tag, KeyMin, KeyMax);
        ImGui::PushID(Id);
        const bool Fired = InvisibleRect("##Tool", KeyMin, KeyMax);
        ImGui::PopID();
        if (Fired) State.Tool = I; // 🧩 Silent.
        ToolY += 30.0f;
    }

    // 📝 Atlas canvas: full-area viewport with the active UDIM tile drawn as a true square (uniform UV
    //    scale), centred in the available space.
    const ImVec2 CanvasMin(Panel.X + 64.0f, Panel.Y + 30.0f);
    const ImVec2 CanvasMax(Panel.X + Panel.Width, Max.y - 64.0f);
    DrawList->AddRectFilled(CanvasMin, CanvasMax, ResolveCssColour(0x0A0A0CFF), 12.0f);
    const float  CanvasW  = CanvasMax.x - CanvasMin.x;
    const float  CanvasH  = CanvasMax.y - CanvasMin.y;
    const float  TileSide = CanvasW < CanvasH ? CanvasW : CanvasH;
    const ImVec2 PlateMin(CanvasMin.x, CanvasMin.y);
    const ImVec2 PlateMax(PlateMin.x + TileSide, PlateMin.y + TileSide);
    DrawList->AddRectFilled(PlateMin, PlateMax, ResolveCssColour(0x0E0E10FF), 6.0f);
    if (State.ShowChecker)
    {
        const int   Cells  = 8;
        const float CellW  = (PlateMax.x - PlateMin.x) / Cells;
        const float CellH  = (PlateMax.y - PlateMin.y) / Cells;
        for (int Cy = 0; Cy < Cells; ++Cy)
            for (int Cx = 0; Cx < Cells; ++Cx)
                if ((Cx + Cy) % 2 == 0)
                    DrawList->AddRectFilled(ImVec2(PlateMin.x + Cx * CellW, PlateMin.y + Cy * CellH),
                                            ImVec2(PlateMin.x + (Cx + 1) * CellW, PlateMin.y + (Cy + 1) * CellH),
                                            ResolveCssColour(0xFFFFFF08));
    }
    DrawList->AddRect(PlateMin, PlateMax, ResolveCssColour(0x9ECFFF44), 12.0f, ImDrawFlags_None, 1.5f);
    for (int I = 0; I < Islands; ++I)
    {
        const UvIslandSpec& Isl = QueryUvIsland(Asset, I);
        if (Isl.Udim != State.ActiveUdim || State.IslandHidden[I]) continue;
        const ImVec2 RMin(PlateMin.x + Isl.MinU * (PlateMax.x - PlateMin.x),
                          PlateMax.y - Isl.MaxV * (PlateMax.y - PlateMin.y));
        const ImVec2 RMax(PlateMin.x + Isl.MaxU * (PlateMax.x - PlateMin.x),
                          PlateMax.y - Isl.MinV * (PlateMax.y - PlateMin.y));
        const ImU32  Fill = IslandLensColour(State, Asset, I);
        const bool   Sel  = State.Selected == I || State.IslandPicked[I];
        DrawList->AddRectFilled(RMin, RMax, (Fill & 0x00FFFFFF) | (0x4D << 24), 2.0f);
        DrawList->AddRect(RMin, RMax, Sel ? ResolveCssColour(0xE8C27AFF) : Fill, 2.0f, ImDrawFlags_None,
                          Sel ? 2.0f : 1.0f);
        if (State.ShowBounds)
            DrawList->AddRect(ImVec2(RMin.x - 1.5f, RMin.y - 1.5f), ImVec2(RMax.x + 1.5f, RMax.y + 1.5f),
                              ResolveCssColour(0xFFFFFF22), 3.0f, ImDrawFlags_None, 1.0f);
    }
    // 📝 2D cursor crosshair (shell-local cursor state).
    const ImVec2 CursorAt(PlateMin.x + static_cast<float>(State.CursorU) * (PlateMax.x - PlateMin.x),
                          PlateMax.y - static_cast<float>(State.CursorV) * (PlateMax.y - PlateMin.y));
    DrawList->AddLine(ImVec2(CursorAt.x - 7.0f, CursorAt.y), ImVec2(CursorAt.x + 7.0f, CursorAt.y),
                      ResolveCssColour(0xFFFFFFFF), 1.5f);
    DrawList->AddLine(ImVec2(CursorAt.x, CursorAt.y - 7.0f), ImVec2(CursorAt.x, CursorAt.y + 7.0f),
                      ResolveCssColour(0xFFFFFFFF), 1.5f);

    // 📝 HUD pills top-right: cursor, selection, stretch — all live.
    char HudCursor[48]{}, HudSel[32]{}, HudStretch[32]{};
    std::snprintf(HudCursor, sizeof(HudCursor), "Cursor %.2f, %.2f", State.CursorU, State.CursorV);
    std::snprintf(HudSel, sizeof(HudSel), "Sel %d", QueryPickedCount(State));
    std::snprintf(HudStretch, sizeof(HudStretch), "Stretch %.1f%%", QueryUvAsset(Asset).MeanStretchPct);
    const char* Huds[3] = { HudCursor, HudSel, HudStretch };
    float HudX          = Panel.X + Panel.Width;
    for (int I = 2; I >= 0; --I)
    {
        const float W = Panel.Measure(Faces.Medium, 9.5f, Huds[I]) + 18.0f;
        HudX -= W;
        DrawList->AddRectFilled(ImVec2(HudX, Panel.Y), ImVec2(HudX + W, Panel.Y + 22.0f),
                                ResolveCssColour(0x1A1A1ACC), 11.0f);
        Panel.Text(Faces.Medium, 9.5f, HudX + 9.0f, Panel.Y + 11.0f - 0.5f * 9.5f * 1.38f, 1.38f,
                   ResolveCssColour(0xD8D8D8FF), Huds[I]);
        HudX -= 6.0f;
    }

    // 📝 Sibling tiles: the asset's other UDIMs as mini plates with their own islands, so multi-tile
    //    atlases read at a glance; empty tiles are labelled empty.
    {
        float MiniX = CanvasMin.x;
        float MiniY = PlateMax.y + 30.0f;
        const float MiniSide = 132.0f;
        const int   TileCount = QueryUvTileCount(Asset);
        for (int T = 0; T < TileCount; ++T)
        {
            const UvTileSpec& Tile = QueryUvTile(Asset, T);
            if (Tile.Id == State.ActiveUdim) continue;
            if (MiniX + MiniSide > CanvasMax.x + 1.0f && MiniX > CanvasMin.x + 1.0f)
            {
                MiniX = CanvasMin.x;
                MiniY += MiniSide + 30.0f;
            }
            if (MiniY + MiniSide + 30.0f > Max.y - 56.0f) break;
            char MiniLabel[48]{}, MiniRes[8]{};
            FormatRes(Tile.Resolution, MiniRes, sizeof(MiniRes));
            std::snprintf(MiniLabel, sizeof(MiniLabel), "UDIM %d · %s", Tile.Id, MiniRes);
            Panel.Text(Faces.Medium, 9.0f, MiniX, MiniY, 1.4f, ResolveCssColour(0x848484FF), MiniLabel);
            const ImVec2 MiniMin(MiniX, MiniY + 16.0f);
            const ImVec2 MiniMax(MiniX + MiniSide, MiniY + 16.0f + MiniSide);
            DrawList->AddRectFilled(MiniMin, MiniMax, ResolveCssColour(0x0E0E10FF), 4.0f);
            int MiniIslands = 0;
            for (int I = 0; I < Islands; ++I)
            {
                const UvIslandSpec& Isl = QueryUvIsland(Asset, I);
                if (Isl.Udim != Tile.Id || State.IslandHidden[I]) continue;
                ++MiniIslands;
                DrawList->AddRectFilled(ImVec2(MiniMin.x + Isl.MinU * MiniSide, MiniMax.y - Isl.MaxV * MiniSide),
                                        ImVec2(MiniMin.x + Isl.MaxU * MiniSide, MiniMax.y - Isl.MinV * MiniSide),
                                        (IslandLensColour(State, Asset, I) & 0x00FFFFFF) | (0x4D << 24), 1.0f);
            }
            DrawList->AddRect(MiniMin, MiniMax,
                              ResolveCssColour(MiniIslands > 0 ? 0x9ECFFF44 : 0x5E5E5E66), 4.0f, ImDrawFlags_None,
                              1.0f);
            if (MiniIslands == 0)
                Panel.Text(Faces.Regular, 9.0f, MiniX + 8.0f, MiniY + 16.0f + MiniSide * 0.5f - 7.0f, 1.4f,
                           ResolveCssColour(0x5E5E5EFF), "empty · spillover");
            else
            {
                char MiniCount[24]{};
                std::snprintf(MiniCount, sizeof(MiniCount), "%d islands", MiniIslands);
                Panel.Text(Faces.Regular, 9.0f, MiniX + 8.0f, MiniMax.y - 20.0f, 1.4f,
                           ResolveCssColour(0x848484FF), MiniCount);
            }
            MiniX += MiniSide + 12.0f;
        }
    }

    // 📝 Legend strip bottom-left: live actual vs staged target shares.
    float LegendY = Max.y - 52.0f;
    Panel.Text(Faces.SemiBold, 9.0f, PlateMin.x, LegendY - 14.0f, 1.4f, ResolveCssColour(0x848484FF),
               "IMPORTANCE ZONES", 0.9f);
    float LegendX       = CanvasMin.x;
    const int GroupLen  = QueryUvGroupCount(Asset);
    for (int G = 0; G <= GroupLen; ++G)
    {
        char Entry[96]{};
        if (G < GroupLen)
            std::snprintf(Entry, sizeof(Entry), "%s %.1f/%.0f%%", QueryUvGroup(Asset, G).Name,
                          QueryUvGroupActualShare(Asset, G), State.GroupTarget[G]);
        else
        {
            double Explicit = 0.0;
            for (int K = 0; K < GroupLen; ++K) Explicit += State.GroupTarget[K];
            if (QueryUvRemainderIslandCount(Asset) == 0) continue;
            std::snprintf(Entry, sizeof(Entry), "Remaining %.1f/%.0f%%", QueryUvRemainderActualShare(Asset),
                          100.0 - Explicit > 0.0 ? 100.0 - Explicit : 0.0);
        }
        const float W = Panel.Measure(Faces.Regular, 9.0f, Entry) + 30.0f;
        if (LegendX + W > CanvasMax.x && LegendX > CanvasMin.x + 1.0f)
        {
            LegendX = CanvasMin.x;
            LegendY += 15.0f;
        }
        DrawList->AddCircleFilled(ImVec2(LegendX + 8.0f, LegendY + 8.0f), 4.0f,
                                  ResolveCssColour(GroupAccent(Asset, G < GroupLen ? G : -1)), 12);
        Panel.Text(Faces.Regular, 9.0f, LegendX + 17.0f, LegendY, 1.4f, ResolveCssColour(0xBCBCBCFF), Entry);
        LegendX += W + 4.0f;
    }

    Panel.Text(Faces.Regular, 9.0f, CanvasMin.x, Max.y - 20.0f, 1.4f, ResolveCssColour(0x5E5E5EFF),
               "Alt Loop · K Seam Brush · G / R / S · U Unwrap · Shift+P Pack");
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    3D MESH STAGE
//------------------------------------------------------------------------------------------------------------------------

void ConstructMeshStage(UvWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 Min,
                        ImVec2 Max)
{
    PanelCursor Panel{ DrawList, &Faces, 1.0f, Min.x + 12.0f, Max.x - Min.x - 24.0f, Min.y + 10.0f };
    DrawList->AddCircleFilled(ImVec2(Panel.X + 6.0f, Panel.Y + 9.0f), 3.5f, ResolveCssColour(0x9ECFFFFF), 12);
    Panel.Text(Faces.SemiBold, 10.0f, Panel.X + 14.0f, Panel.Y, 1.4f, ResolveCssColour(0xD8D8D8FF), "3D MESH", 0.6f);
    Panel.Text(Faces.Medium, 10.0f, Panel.X + 84.0f, Panel.Y, 1.4f, ResolveCssColour(0x9ECFFFFF),
               QueryUvAsset(State.Asset).Label);

    // 📝 Static decor: honestly labelled — no mesh renderer runs in this shell.
    const ImVec2 PlateMin(Panel.X, Panel.Y + 30.0f);
    const ImVec2 PlateMax(Panel.X + Panel.Width, Max.y - 96.0f);
    DrawList->AddRectFilled(PlateMin, PlateMax, ResolveCssColour(0x101014FF), 12.0f);
    const ImVec2 Centre((PlateMin.x + PlateMax.x) * 0.5f, (PlateMin.y + PlateMax.y) * 0.5f);
    const float  Radius = (PlateMax.x - PlateMin.x) * 0.42f;
    DrawList->AddLine(ImVec2(PlateMin.x + 8.0f, Centre.y), ImVec2(PlateMax.x - 8.0f, Centre.y),
                      ResolveCssColour(0xFFFFFF10), 1.0f);
    DrawList->AddLine(ImVec2(Centre.x, PlateMin.y + 8.0f), ImVec2(Centre.x, PlateMax.y - 8.0f),
                      ResolveCssColour(0xFFFFFF10), 1.0f);
    for (int R = 1; R <= 4; ++R)
        DrawList->AddCircle(Centre, Radius * R / 4.0f, ResolveCssColour(0x9ECFFF30), 64, R == 4 ? 1.5f : 1.0f);
    for (int S = 0; S < 16; ++S)
    {
        const float A = S * 3.14159265f / 8.0f;
        DrawList->AddLine(ImVec2(Centre.x + std::cos(A) * Radius * 0.25f, Centre.y + std::sin(A) * Radius * 0.25f),
                          ImVec2(Centre.x + std::cos(A) * Radius, Centre.y + std::sin(A) * Radius),
                          ResolveCssColour(0x9ECFFF26), 1.0f);
    }
    for (int D = 0; D < 4; ++D)
    {
        const float A = D * 3.14159265f / 2.0f + 0.4f;
        DrawList->AddCircleFilled(ImVec2(Centre.x + std::cos(A) * Radius, Centre.y + std::sin(A) * Radius), 3.5f,
                                  ResolveCssColour(0xE8C27ACC), 12);
    }
    DrawList->AddCircleFilled(Centre, 4.0f, ResolveCssColour(0xE8C27AFF), 16);
    char Shade[64]{};
    std::snprintf(Shade, sizeof(Shade), "%s · static preview", QueryUvShade(State.Shade));
    const float ShadeW = Panel.Measure(Faces.Regular, 9.5f, Shade);
    Panel.Text(Faces.Regular, 9.5f, Centre.x - ShadeW * 0.5f, PlateMax.y - 24.0f, 1.4f,
               ResolveCssColour(0x848484FF), Shade);

    // 📝 Camera bar.
    static const char* Cams[4] = { "Persp", "Front", "Side", "Top" };
    float CamX                 = Panel.X;
    const float CamY           = PlateMax.y + 10.0f;
    for (int I = 0; I < 4; ++I)
    {
        char Tag[32]{}, Id[32]{};
        std::snprintf(Tag, sizeof(Tag), "Stage/Cam%d", I);
        std::snprintf(Id, sizeof(Id), "UvCam%d", I);
        const float W = Panel.Measure(Faces.Medium, 10.0f, Cams[I]) + 20.0f;
        if (PillButton(State, Panel, Tag, Id, CamX, CamY, Cams[I], State.Camera == I, W))
            State.Camera = I; // 🧩 Silent.
        CamX += W + 6.0f;
    }
    if (PillButton(State, Panel, "Stage/Wire", "UvWire", CamX, CamY, "Wire", State.ShowWire3D))
        State.ShowWire3D = !State.ShowWire3D;

    const char* Hint = "Island Mode: Click Island · Shift Multi · Double-Click Frame";
    if (State.SelectionMode == UvWorkspaceState::ModeEdge)
        Hint = "Edge Mode: Click Edge · Alt Loop · Ctrl+Alt Ring · Ctrl Path · K Seam Brush";
    else if (State.SelectionMode == UvWorkspaceState::ModeVertex) Hint = "Vertex Mode: Click UV · G / R / S · P Pin";
    else if (State.SelectionMode == UvWorkspaceState::ModeFace) Hint = "Face Mode: Click Face · L Linked · Y Split";
    Panel.Text(Faces.Regular, 9.0f, Panel.X, Max.y - 20.0f, 1.4f, ResolveCssColour(0x5E5E5EFF), Hint);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    OPERATOR DOCK
//------------------------------------------------------------------------------------------------------------------------

void ConstructOperatorDock(UvWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 Min,
                           ImVec2 Max)
{
    PanelCursor Panel{ DrawList, &Faces, 1.0f, Min.x + 12.0f, Max.x - Min.x - 24.0f, Min.y + 8.0f };
    struct Op
    {
        const char* Tag;
        const char* Id;
        const char* Label;
        const char* Channel;
        const char* Message;
        const char* Toast;
        bool        Accent;
    };
    static const Op Ops[12] = {
        { "Dock/Unwrap", "UvOpUnwrap", "Unwrap (U)", "UNWRAP", "LSCM unwrap refused",
          "LSCM unwrap is a NOOP in this shell", true },
        { "Dock/Pack", "UvOpPack", "Pack Budgets (Shift+P)", "PACK", "Importance pack refused",
          "Importance packing is a NOOP in this shell", true },
        { "Dock/Relax", "UvOpRelax", "Relax (Ctrl+V)", "RELAX", "Minimize stretch refused",
          "Stretch relax is a NOOP in this shell", false },
        { "Dock/Avg", "UvOpAvg", "Avg Scale (Ctrl+A)", "SCALE", "Average scale refused",
          "Average scale is a NOOP in this shell", false },
        { "Dock/Pin", "UvOpPin", "Pin (P)", "PIN", "Pin refused", "Pinning is a NOOP in this shell", false },
        { "Dock/Unpin", "UvOpUnpin", "Unpin", "PIN", "Unpin refused", "Unpinning is a NOOP in this shell", false },
        { "Dock/Seam", "UvOpSeam", "Mark Seam", "SEAM", "Mark seam refused",
          "Seam marking is a NOOP in this shell", false },
        { "Dock/ClearSeam", "UvOpClearSeam", "Clear Seam", "SEAM", "Clear seam refused",
          "Seam clearing is a NOOP in this shell", false },
        { "Dock/EdgeMenu", "UvOpEdgeMenu", "Edges & Seams (Ctrl+E)", "SEAM", "Edge menu refused",
          "Edge ops are NOOPs in this shell", false },
        { "Dock/Stitch", "UvOpStitch", "Stitch (V)", "STITCH", "Stitch refused",
          "Stitching is a NOOP in this shell", false },
        { "Dock/Weld", "UvOpWeld", "Weld (M)", "WELD", "Weld refused", "Welding is a NOOP in this shell", false },
        { "Dock/Split", "UvOpSplit", "Split (Y)", "SPLIT", "Split refused",
          "Splitting is a NOOP in this shell", false },
    };
    // 📝 Two flow rows of burst buttons; the log toggle anchors the right end.
    float BX = Panel.X, BY = Panel.Y;
    for (int I = 0; I < 12; ++I)
    {
        const float W = Panel.Measure(Faces.Medium, 10.5f, Ops[I].Label) + 24.0f;
        if (BX + W > Panel.X + Panel.Width - 120.0f && BX > Panel.X + 200.0f)
        {
            BX = Panel.X;
            BY += 36.0f;
        }
        const ImVec2 BMin(BX, BY);
        const ImVec2 BMax(BX + W, BY + 28.0f);
        DrawList->AddRectFilled(BMin, BMax, ResolveCssColour(Ops[I].Accent ? 0xE8C27A22 : 0x1A1A1AFF), 14.0f);
        Panel.Text(Faces.Medium, 10.5f, BX + 12.0f, BY + 14.0f - 0.5f * 10.5f * 1.38f, 1.38f,
                   ResolveCssColour(Ops[I].Accent ? 0xF2E3C4FF : 0xD8D8D8FF), Ops[I].Label);
        RecordRect(State, Ops[I].Tag, BMin, BMax);
        ImGui::PushID(Ops[I].Id);
        const bool Fired = InvisibleRect("##Op", BMin, BMax);
        ImGui::PopID();
        if (Fired) NoopUvWorkspaceCommand(State, Ops[I].Channel, Ops[I].Message, Ops[I].Toast);
        BX = BMax.x + 6.0f;
    }
    const ImVec2 LogMax(Panel.X + Panel.Width, Panel.Y + 64.0f);
    const ImVec2 LogMin(LogMax.x - 108.0f, Panel.Y);
    DrawList->AddRectFilled(LogMin, LogMax, ResolveCssColour(State.LogOpen ? 0xE8C27A22 : 0x1A1A1AFF), 14.0f);
    Panel.Text(Faces.Medium, 10.5f, LogMin.x + 12.0f, Panel.Y + 32.0f - 0.5f * 10.5f * 1.38f, 1.38f,
               ResolveCssColour(0xD8D8D8FF), State.LogOpen ? "Hide Log" : "Show Log");
    RecordRect(State, "Dock/Log", LogMin, LogMax);
    ImGui::PushID("UvOpLog");
    if (InvisibleRect("##OpLog", LogMin, LogMax)) State.LogOpen = !State.LogOpen;
    ImGui::PopID();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    LOG DRAWER
//------------------------------------------------------------------------------------------------------------------------

void ConstructLogDrawer(UvWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Min, ImVec2 Max)
{
    ImDrawList* const DrawList = ImGui::GetWindowDrawList();
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x0E0E10FF), 14.0f);
    DrawList->AddRect(Min, Max, ResolveCssColour(0xFFFFFF0E), 14.0f, ImDrawFlags_None, 1.0f);
    PanelCursor Panel{ DrawList, &Faces, 1.0f, Min.x + 14.0f, Max.x - Min.x - 28.0f, Min.y + 8.0f };
    Panel.Text(Faces.SemiBold, 10.5f, Panel.X, Panel.Y, 1.4f, ResolveCssColour(0xD8D8D8FF), "UV Studio Operator Log");
    const ImVec2 ClearMax(Panel.X + Panel.Width, Panel.Y + 24.0f);
    const ImVec2 ClearMin(ClearMax.x - 72.0f, Panel.Y);
    DrawList->AddRectFilled(ClearMin, ClearMax, ResolveCssColour(0x1A1A1AFF), 12.0f);
    Panel.Text(Faces.Medium, 10.0f, ClearMin.x + 14.0f, Panel.Y + 12.0f - 0.5f * 10.0f * 1.38f, 1.38f,
               ResolveCssColour(0xBCBCBCFF), "Clear");
    RecordRect(State, "Console/Clear", ClearMin, ClearMax);
    ImGui::PushID("UvLogClear");
    if (InvisibleRect("##LogClear", ClearMin, ClearMax)) State.Log.clear();
    ImGui::PopID();
    float LY = Panel.Y + 30.0f;
    for (const UvWorkspaceLogEntry& Entry : State.Log)
    {
        if (LY + 16.0f > Max.y - 8.0f) break;
        char Line[320]{};
        std::snprintf(Line, sizeof(Line), "[%s] %s", Entry.Channel.c_str(), Entry.Message.c_str());
        const bool Warm = std::strstr(Entry.Message.c_str(), "NOOP") != nullptr;
        Panel.Text(Faces.Regular, 9.5f, Panel.X, LY, 1.4f,
                   ResolveCssColour(Warm ? 0xE8A05CFF : 0x9A9A9AFF), Line);
        LY += 16.0f;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    STATUS BAR
//------------------------------------------------------------------------------------------------------------------------

void ConstructStatusBar(UvWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 Min,
                        ImVec2 Max)
{
    PanelCursor Panel{ DrawList, &Faces, 1.0f, Min.x + 14.0f, Max.x - Min.x - 28.0f, Min.y };
    DrawList->AddCircleFilled(ImVec2(Panel.X + 4.0f, (Min.y + Max.y) * 0.5f), 3.5f, ResolveCssColour(0x9BDAC5FF),
                              12);
    const float MidY = (Min.y + Max.y) * 0.5f;
    Panel.Text(Faces.Medium, 10.0f, Panel.X + 13.0f, MidY - 0.5f * 10.0f * 1.4f, 1.4f,
               ResolveCssColour(0xD8D8D8FF), "Ready");
    const UvAssetSpec& Spec = QueryUvAsset(State.Asset);
    char Counts[96]{}, Density[48]{};
    std::snprintf(Counts, sizeof(Counts), "%d verts · %d faces · %d islands", Spec.Verts, Spec.Faces,
                  QueryUvIslandCount(State.Asset));
    std::snprintf(Density, sizeof(Density), "Avg Texel: %.2f px/cm", Spec.AvgTexel);
    float SX = Panel.X + 90.0f;
    DrawList->AddLine(ImVec2(SX, Min.y + 8.0f), ImVec2(SX, Max.y - 8.0f), ResolveCssColour(0xFFFFFF14));
    Panel.Text(Faces.Regular, 10.0f, SX + 12.0f, MidY - 0.5f * 10.0f * 1.4f, 1.4f,
               ResolveCssColour(0x848484FF), Counts);
    SX += Panel.Measure(Faces.Regular, 10.0f, Counts) + 24.0f;
    DrawList->AddLine(ImVec2(SX, Min.y + 8.0f), ImVec2(SX, Max.y - 8.0f), ResolveCssColour(0xFFFFFF14));
    Panel.Text(Faces.Regular, 10.0f, SX + 12.0f, MidY - 0.5f * 10.0f * 1.4f, 1.4f,
               ResolveCssColour(0x848484FF), Density);
    const char* Version = "Frontier UV Studio · Experimental Remastered";
    const float VW      = Panel.Measure(Faces.Regular, 10.0f, Version);
    Panel.Text(Faces.Regular, 10.0f, Panel.X + Panel.Width - VW, MidY - 0.5f * 10.0f * 1.4f, 1.4f,
               ResolveCssColour(0x5E5E5EFF), Version);
    const char* Pack = "Pack: Ready";
    const float PW   = Panel.Measure(Faces.Regular, 10.0f, Pack);
    Panel.Text(Faces.Regular, 10.0f, Panel.X + Panel.Width - VW - PW - 28.0f, MidY - 0.5f * 10.0f * 1.4f, 1.4f,
               ResolveCssColour(0x848484FF), Pack);
    DrawList->AddCircleFilled(ImVec2(Panel.X + Panel.Width - VW - PW - 36.0f, MidY), 3.0f,
                              ResolveCssColour(0x9BDAC5FF), 10);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    INSPECTOR HOST
//------------------------------------------------------------------------------------------------------------------------

void ConstructInspectorPanel(UvWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Min, ImVec2 Max)
{
    ImDrawList* const DrawList = ImGui::GetWindowDrawList();
    const int         Asset    = State.Asset;
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x121212FF), 22.0f);
    DrawList->AddRect(Min, Max, ResolveCssColour(0xFFFFFF0E), 22.0f, ImDrawFlags_None, 1.0f);
    PanelCursor Panel{ DrawList, &Faces, 1.0f, Min.x + 14.0f, Max.x - Min.x - 28.0f, Min.y + 10.0f };

    // 📝 Crumb + reset pill.
    const ImVec2 Crumb = Panel.Space(26.0f, 0.0f, 4.0f);
    Panel.Text(Faces.Regular, 10.0f, Crumb.x, Crumb.y + 13.0f - 0.5f * 10.0f * 1.4f, 1.4f,
               ResolveCssColour(0x848484FF), "UV Studio / Importance Pack");
    const float ResetW = Panel.Measure(Faces.Medium, 10.0f, "Reset Asset") + 22.0f;
    if (PillButton(State, Panel, "Inspector/Reset", "UvReset", Crumb.x + Panel.Width - ResetW, Crumb.y,
                   "Reset Asset", false, ResetW))
        SelectUvWorkspaceAsset(State, State.Asset); // 🧩 Restage + DOC line.

    // 📝 Object heading: rename field + live subtitle.
    const ImVec2 Heading = Panel.Space(56.0f, 0.0f, 6.0f);
    DrawList->AddCircleFilled(ImVec2(Heading.x + 18.0f, Heading.y + 28.0f), 16.0f,
                              ResolveCssColour(0xE8C27A22), 24);
    (void)GlyphSymbol::Construct(DrawList, "StudioGrid", ImVec2(Heading.x + 10.0f, Heading.y + 20.0f), 16.0f,
                                 1.8f, ResolveCssColour(0xE8C27AFF));
    ImGui::PushID("UvAssetName");
    RecordRect(State, "Inspector/Rename", ImVec2(Heading.x + 44.0f, Heading.y + 2.0f),
               ImVec2(Heading.x + Panel.Width, Heading.y + 26.0f));
    char Buffer[128]{};
    std::snprintf(Buffer, sizeof(Buffer), "%s", State.AssetName.c_str());
    ImGui::SetCursorScreenPos(ImVec2(Heading.x + 44.0f, Heading.y + 2.0f));
    ImGui::SetNextItemWidth(Panel.Width - 44.0f);
    ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0, 0, 0, 0));
    ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 0.0f);
    ImGui::PushStyleColor(ImGuiCol_Text, ImGui::ColorConvertU32ToFloat4(ResolveCssColour(0xF1F1F1FF)));
    ImGui::PushFont(Faces.SemiBold);
    ImGui::SetWindowFontScale(15.0f / 13.0f);
    if (ImGui::InputText("##AssetName", Buffer, sizeof(Buffer), ImGuiInputTextFlags_EscapeClearsAll))
    {
        State.AssetName = Buffer;
        LogUvWorkspaceValue(State, "PARAM", "Rename", State.AssetName.c_str());
    }
    ImGui::SetWindowFontScale(1.0f);
    ImGui::PopFont();
    ImGui::PopStyleColor(2);
    ImGui::PopStyleVar();
    ImGui::PopID();
    char Sub[128]{};
    const int GroupCount = QueryUvGroupCount(Asset);
    if (GroupCount == 2)
        std::snprintf(Sub, sizeof(Sub), "%d ISLANDS · %d UDIM TILES · HERO %.0f%% / TRIM %.0f%% / REST %.0f%%",
                      QueryUvIslandCount(Asset), QueryUvTileCount(Asset), State.GroupTarget[0],
                      State.GroupTarget[1],
                      100.0 - State.GroupTarget[0] - State.GroupTarget[1] > 0.0
                          ? 100.0 - State.GroupTarget[0] - State.GroupTarget[1]
                          : 0.0);
    else
        std::snprintf(Sub, sizeof(Sub), "%d ISLANDS · %d UDIM TILES · PER-UDIM 100%% BUDGETS",
                      QueryUvIslandCount(Asset), QueryUvTileCount(Asset));
    Panel.Text(Faces.Regular, 9.0f, Heading.x + 44.0f, Heading.y + 30.0f, 1.4f, ResolveCssColour(0x848484FF),
               Sub, 0.4f);

    // 📝 Tab pills: silent local view state.
    static const char* Tabs[4] = { "Packing", "Unwrap & Edit", "UDIMs", "Diagnostics" };
    float TabX                 = Panel.X;
    const ImVec2 TabRow        = Panel.Space(28.0f, 0.0f, 6.0f);
    for (int I = 0; I < 4; ++I)
    {
        char Tag[32]{}, Id[32]{};
        std::snprintf(Tag, sizeof(Tag), "Inspector/Tab%d", I);
        std::snprintf(Id, sizeof(Id), "UvTab%d", I);
        const float W = Panel.Measure(Faces.Medium, 10.5f, Tabs[I]) + 22.0f;
        if (PillButton(State, Panel, Tag, Id, TabX, TabRow.y, Tabs[I], State.InspectorTab == I, W))
            State.InspectorTab = I;
        TabX += W + 6.0f;
    }

    // 📝 Tab body in a scroll-free child; footer pins to the panel bottom.
    const ImVec2 FootMin(Min.x, Max.y - 30.0f);
    DrawList->AddLine(ImVec2(Min.x, FootMin.y), ImVec2(Max.x, FootMin.y), ResolveCssColour(0xFFFFFF12));
    ImGui::SetCursorScreenPos(ImVec2(Min.x, Panel.Y));
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0, 0, 0));
    ImGui::BeginChild("##UvInspectorScroll", ImVec2(Max.x - Min.x, FootMin.y - Panel.Y), false,
                      ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
    {
        const ControlTheme Theme = ControlTheme::ResolveRemastered();
        ControlColumn Column(Theme, Faces, 1.0f, ImVec2(Min.x + 12.0f, Panel.Y + 4.0f), Max.x - Min.x - 24.0f);
        ConstructUvWorkspaceInspector(State, Faces, Column);
        Column.Finalize();
    }
    ImGui::EndChild();
    ImGui::PopStyleColor();

    PanelCursor Foot{ DrawList, &Faces, 1.0f, Min.x + 14.0f, Max.x - Min.x - 28.0f, FootMin.y + 8.0f };
    Foot.Text(Faces.Regular, 9.0f, Foot.X, Foot.Y, 1.4f, ResolveCssColour(0x5E5E5EFF),
              "Conformal LSCM + Exact Concave Packer");
    const int FootSlot = QueryUvTileIndex(Asset, State.ActiveUdim);
    char      FootRight[48]{}, FootRes[8]{};
    FormatRes(FootSlot >= 0 ? (State.TileRes[FootSlot] > 0 ? State.TileRes[FootSlot]
                                                           : QueryUvTile(Asset, FootSlot).Resolution)
                            : 2048,
              FootRes, sizeof(FootRes));
    std::snprintf(FootRight, sizeof(FootRight), "UDIM %d · %s px", State.ActiveUdim, FootRes);
    const float FootW = Foot.Measure(Faces.Regular, 9.0f, FootRight);
    Foot.Text(Faces.Regular, 9.0f, Foot.X + Foot.Width - FootW, Foot.Y, 1.4f, ResolveCssColour(0x848484FF),
              FootRight);
}
//------------------------------------------------------------------------------------------------------------------------
//                                                    HELP SHEET
//------------------------------------------------------------------------------------------------------------------------
void ConstructHelpSheet(UvWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 RootMin, ImVec2 RootMax)
{
    if (!State.HelpOpen) return;
    ImDrawList* const DrawList = ImGui::GetWindowDrawList();
    DrawList->AddRectFilled(RootMin, RootMax, ResolveCssColour(0x000000AA));
    const ImVec2 Centre((RootMin.x + RootMax.x) * 0.5f, (RootMin.y + RootMax.y) * 0.5f);
    const ImVec2 Min(Centre.x - 330.0f, Centre.y - 300.0f);
    const ImVec2 Max(Centre.x + 330.0f, Centre.y + 300.0f);
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x161616FF), 18.0f);
    DrawList->AddRect(Min, Max, ResolveCssColour(0xFFFFFF1A), 18.0f, ImDrawFlags_None, 1.0f);
    PanelCursor Panel{ DrawList, &Faces, 1.0f, Min.x + 22.0f, Max.x - Min.x - 44.0f, Min.y + 18.0f };
    Panel.Text(Faces.SemiBold, 14.0f, Panel.X, Panel.Y, 1.3f, ResolveCssColour(0xF1F1F1FF),
               "UV Studio Hotkeys (Blender Compatible)");
    Panel.Text(Faces.Regular, 10.0f, Panel.X, Panel.Y + 24.0f, 1.4f, ResolveCssColour(0x848484FF),
               "Hover the 2D UV Canvas or 3D Mesh Viewport and use standard Blender shortcuts.");
    static const char* Rows[14][2] = {
        { "Selection Mode (Vert / Edge / Face / Island)", "1 / 2 / 3 / 4" },
        { "Edge Loop / Ring / Shortest Path", "Alt / Ctrl+Alt / Ctrl+Click" },
        { "Seam Brush Tool", "K" },
        { "Edges, Boundaries & Seams Menu", "Ctrl+E" },
        { "Select All / Deselect / Invert", "A / Alt+A / Ctrl+I" },
        { "Move / Rotate / Scale (Modal)", "G / R / S" },
        { "Axis Lock during G/R/S", "X or U / Y or V" },
        { "Proportional Editing + Radius", "O / Wheel" },
        { "LSCM Unwrap / Pack Importance", "U / Shift+P" },
        { "Minimize Stretch / Average Scale", "Ctrl+V / Ctrl+A" },
        { "Pin / Unpin Vertices", "P / Alt+P" },
        { "Stitch / Merge / Split", "V / M / Y" },
        { "Snap Mode / Frame Selected", "Shift+Tab / Home" },
        { "Undo / Redo", "Ctrl+Z / Ctrl+Shift+Z" },
    };
    float RY = Panel.Y + 52.0f;
    for (int I = 0; I < 14; ++I)
    {
        Panel.Text(Faces.Regular, 10.0f, Panel.X, RY, 1.4f, ResolveCssColour(0xBCBCBCFF), Rows[I][0]);
        const float KW = Panel.Measure(Faces.Medium, 10.0f, Rows[I][1]);
        Panel.Text(Faces.Medium, 10.0f, Panel.X + Panel.Width - KW, RY, 1.4f,
                   ResolveCssColour(0xE8C27AFF), Rows[I][1]);
        RY += 22.0f;
    }
    const ImVec2 CloseMax(Panel.X + Panel.Width, RY + 30.0f);
    const ImVec2 CloseMin(CloseMax.x - 120.0f, RY);
    DrawList->AddRectFilled(CloseMin, CloseMax, ResolveCssColour(0xE8C27A22), 15.0f);
    Panel.Text(Faces.Medium, 11.0f, CloseMin.x + 38.0f, RY + 15.0f - 0.5f * 11.0f * 1.38f, 1.38f,
               ResolveCssColour(0xF2E3C4FF), "Close");
    RecordRect(State, "Help/Close", CloseMin, CloseMax);
    ImGui::PushID("UvHelpClose");
    if (InvisibleRect("##HelpClose", CloseMin, CloseMax)) State.HelpOpen = false;
    ImGui::PopID();
}
} // namespace
//------------------------------------------------------------------------------------------------------------------------
//                                                    ROOT
//------------------------------------------------------------------------------------------------------------------------
void ApplyUvWorkspaceLink(UvWorkspaceState& State, AssetBrowserLink* Link)
{
    if (Link == nullptr || !Link->HasHandoff() || Link->OpenRecordWorkspace != AssetBrowserWorkspaceUv) return;
    static constexpr const char* Prefix = "uv/";
    const char*                  Raw    = Link->OpenRecordId;
    int                          Found  = -1;
    if (std::strncmp(Raw, Prefix, std::strlen(Prefix)) == 0)
        for (int I = 0; I < QueryUvAssetCount(); ++I)
            if (std::strcmp(QueryUvAsset(I).Id, Raw + std::strlen(Prefix)) == 0) Found = I;
    if (Found >= 0) SelectUvWorkspaceAsset(State, Found);
    else
    {
        char Message[192]{};
        std::snprintf(Message, sizeof(Message), "Asset \u201C%s\u201D is not a UV asset", Raw);
        AppendUvWorkspaceLog(State, "DOC", Message);
    }
    Link->ClearHandoff();
}

void ConstructUvWorkspace(UvWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Size,
                          AssetBrowserLink* Link)
{
    ApplyUvWorkspaceLink(State, Link);
    State.Rects.clear();
    ImGui::SetNextWindowPos(ImVec2(0.0f, 0.0f));
    ImGui::SetNextWindowSize(Size);
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImGui::ColorConvertU32ToFloat4(ResolveCssColour(0x0B0B0BFF)));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
    ImGui::Begin("##UvWorkspace", nullptr,
                 ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoScrollbar |
                     ImGuiWindowFlags_NoScrollWithMouse);
    ImGui::PopStyleVar(2);
    ImGui::PopStyleColor();
    ImDrawList* const DrawList = ImGui::GetWindowDrawList();
    PanelCursor Root{ DrawList, &Faces, 1.0f, 12.0f, Size.x - 24.0f, 10.0f };
    ConstructTopBar(State, Root, Link);
    const float WorkspaceY = Root.Y;
    constexpr float StatusTall = 36.0f;
    const float WorkspaceH = Size.y - 10.0f - StatusTall - 8.0f - WorkspaceY;
    const float RailWide = Size.x >= 1280.0f ? 296.0f : 256.0f;
    const float InspectorWide = Size.x >= 1280.0f ? 392.0f : 348.0f;
    const ImVec2 RailMin(12.0f, WorkspaceY);
    const ImVec2 RailMax(12.0f + RailWide, WorkspaceY + WorkspaceH);
    const ImVec2 StatusMax(Size.x - 12.0f, Size.y - 10.0f);
    const ImVec2 StatusMin(12.0f, StatusMax.y - StatusTall);
    const ImVec2 InspectorMax(Size.x - 12.0f, WorkspaceY + WorkspaceH);
    const ImVec2 InspectorMin(InspectorMax.x - InspectorWide, WorkspaceY);
    const ImVec2 CentreMin(RailMax.x + 10.0f, WorkspaceY);
    const ImVec2 CentreMax(InspectorMin.x - 10.0f, WorkspaceY + WorkspaceH);
    ConstructOutlinerPanel(State, Faces, RailMin, RailMax);
    // Centre column: viewport bar, split stage, operator dock, log drawer when open.
    constexpr float DockTall = 92.0f;
    const float LogTall = State.LogOpen ? 220.0f : 0.0f;
    const float LogGap = State.LogOpen ? 10.0f : 0.0f;
    const ImVec2 BarMax(CentreMax.x, CentreMin.y + 76.0f);
    DrawList->AddRectFilled(CentreMin, BarMax, ResolveCssColour(0x121212FF), 16.0f);
    PanelCursor BarCursor{ DrawList, &Faces, 1.0f, CentreMin.x + 10.0f, CentreMax.x - CentreMin.x - 20.0f,
                           CentreMin.y + 6.0f };
    ConstructViewportBar(State, BarCursor);
    const ImVec2 DockMax(CentreMax.x, CentreMax.y - LogTall - LogGap);
    const ImVec2 DockMin(CentreMin.x, DockMax.y - DockTall);
    const ImVec2 StageMax(CentreMax.x, DockMin.y - 10.0f);
    const ImVec2 StageMin(CentreMin.x, BarMax.y + 10.0f);
    bool ShowUv = State.StageMode != UvWorkspaceState::StageMesh;
    bool ShowMesh = State.StageMode != UvWorkspaceState::StageUv;
    if (ShowUv && ShowMesh)
    {
        const float MidX = StageMin.x + (StageMax.x - StageMin.x) * 0.56f;
        const ImVec2 UvMax(MidX - 5.0f, StageMax.y);
        const ImVec2 MeshMin(MidX + 5.0f, StageMin.y);
        DrawList->AddRectFilled(StageMin, UvMax, ResolveCssColour(0x121212FF), 22.0f);
        DrawList->AddRect(StageMin, UvMax, ResolveCssColour(0xFFFFFF0E), 22.0f, ImDrawFlags_None, 1.0f);
        ConstructUvStage(State, Faces, DrawList, StageMin, UvMax);
        DrawList->AddRectFilled(MeshMin, StageMax, ResolveCssColour(0x121212FF), 22.0f);
        DrawList->AddRect(MeshMin, StageMax, ResolveCssColour(0xFFFFFF0E), 22.0f, ImDrawFlags_None, 1.0f);
        ConstructMeshStage(State, Faces, DrawList, MeshMin, StageMax);
    }
    else if (ShowUv)
    {
        DrawList->AddRectFilled(StageMin, StageMax, ResolveCssColour(0x121212FF), 22.0f);
        DrawList->AddRect(StageMin, StageMax, ResolveCssColour(0xFFFFFF0E), 22.0f, ImDrawFlags_None, 1.0f);
        ConstructUvStage(State, Faces, DrawList, StageMin, StageMax);
    }
    else
    {
        DrawList->AddRectFilled(StageMin, StageMax, ResolveCssColour(0x121212FF), 22.0f);
        DrawList->AddRect(StageMin, StageMax, ResolveCssColour(0xFFFFFF0E), 22.0f, ImDrawFlags_None, 1.0f);
        ConstructMeshStage(State, Faces, DrawList, StageMin, StageMax);
    }
    DrawList->AddRectFilled(DockMin, DockMax, ResolveCssColour(0x121212FF), 16.0f);
    DrawList->AddRect(DockMin, DockMax, ResolveCssColour(0xFFFFFF0E), 16.0f, ImDrawFlags_None, 1.0f);
    ConstructOperatorDock(State, Faces, DrawList, DockMin, DockMax);
    if (State.LogOpen)
        ConstructLogDrawer(State, Faces, ImVec2(CentreMin.x, DockMax.y + 10.0f), CentreMax);
    ConstructInspectorPanel(State, Faces, InspectorMin, InspectorMax);
    DrawList->AddRectFilled(StatusMin, StatusMax, ResolveCssColour(0x121212FF), 12.0f);
    ConstructStatusBar(State, Faces, DrawList, StatusMin, StatusMax);
    ConstructHelpSheet(State, Faces, ImVec2(0.0f, 0.0f), Size);
    Toast::Construct();
    ImGui::End();
}
} // namespace Frontier
