/*==========================================================================================================================================
                                                        ASSETBROWSERWORKSPACE.CPP
==========================================================================================================================================*/
// 🧩 The Asset Browser shell: a dark stage, a trapezoidal expansion notch, and a bottom sheet with the folder tree,
//    the filterable item grid/list, and the inspector. The notch mirrors PanelExpansionTab (8% inset contour, caption
//    plus grip, tap toggles, vertical drags travel with flick snap, the MotionIntegrator spring settles the sheet).
//    Record actions hand off to the owning workspace shell through the shared AssetBrowserLink; without a link the
//    browser logs the handoff and stays put. Search, filters, selection, favorites, and keyboard shortcuts mirror the
//    HTML prototype one behaviour at a time.

#include "Frontier/Engine/Interface/Workspaces/AssetBrowserWorkspace.h"

#include "Engine/Interface/Controls/GlyphRun.h"
#include "Engine/Interface/Controls/GlyphSymbol.h"
#include "Engine/Interface/Controls/Toast.h"
#include "Frontier/Engine/Interface/Controls/ControlTheme.h"
#include "Frontier/Engine/Interface/InspectorControls.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace Frontier
{
namespace
{

constexpr float StageCaptionSize   = 13.0f;
constexpr float TreeWide           = 300.0f;
constexpr float InspectorWide      = 344.0f;
constexpr float HeaderTall         = 54.0f;
constexpr float ChipsTall          = 36.0f;
constexpr float FooterTall         = 30.0f;
constexpr float NotchTall          = 42.0f;
constexpr float NotchOverlap       = 12.0f;
constexpr float CardWide           = 232.0f;
constexpr float CardTall           = 148.0f;
constexpr float ListRowTall        = 46.0f;
constexpr float TreeRowTall        = 30.0f;

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
    if (Max.x <= Min.x || Max.y <= Min.y) return false;
    ImGui::SetCursorScreenPos(Min);
    return ImGui::InvisibleButton(Id, ImVec2(Max.x - Min.x, Max.y - Min.y));
}

int FolderCount(const char* Folder)
{
    int Count = 0;
    for (int I = 0; I < QueryAssetBrowserRecordCount(); ++I)
    {
        const AssetBrowserRecord& Record = QueryAssetBrowserRecord(I);
        if (Record.Folder == Folder || Record.Folder.compare(0, std::strlen(Folder) + 1, std::string(Folder) + "/") == 0)
            ++Count;
    }
    return Count;
}

void CollectSubfolders(int Workspace, std::vector<std::string>& Out)
{
    Out.clear();
    const char* Ws = QueryAssetBrowserWorkspaceName(Workspace);
    const size_t Prefix = std::strlen(Ws) + 1;
    for (int I = 0; I < QueryAssetBrowserRecordCount(); ++I)
    {
        const AssetBrowserRecord& Record = QueryAssetBrowserRecord(I);
        if (Record.WorkspaceIndex != Workspace) continue;
        if (Record.Folder.size() > Prefix &&
            std::find(Out.begin(), Out.end(), Record.Folder) == Out.end())
            Out.push_back(Record.Folder);
    }
    std::sort(Out.begin(), Out.end());
}

const char* SortLabel(int Sort) noexcept
{
    if (Sort == AssetBrowserWorkspaceState::SortWorkspace) return "Workspace";
    if (Sort == AssetBrowserWorkspaceState::SortKind) return "Kind";
    return "Name";
}

void MoveSelection(AssetBrowserWorkspaceState& State, const std::vector<int>& Filtered, int Delta)
{
    if (Filtered.empty()) return;
    int At = -1;
    for (size_t I = 0; I < Filtered.size(); ++I)
        if (Filtered[I] == State.Selected) At = static_cast<int>(I);
    if (At < 0) At = Delta > 0 ? 0 : static_cast<int>(Filtered.size()) - 1;
    else At = (At + Delta + static_cast<int>(Filtered.size())) % static_cast<int>(Filtered.size());
    SelectAssetBrowserRecord(State, Filtered[static_cast<size_t>(At)]);
}

void OpenSelectedInWorkspace(AssetBrowserWorkspaceState& State, AssetBrowserLink* Link)
{
    if (State.Selected < 0) return;
    const AssetBrowserRecord& Record = QueryAssetBrowserRecord(State.Selected);
    if (Link != nullptr)
    {
        std::snprintf(Link->OpenRecordId, sizeof(Link->OpenRecordId), "%s", Record.Id.c_str());
        Link->OpenRecordWorkspace = Record.WorkspaceIndex;
    }
    char Message[192]{};
    std::snprintf(Message, sizeof(Message), "Handed “%s” to %s", Record.Name.c_str(), Record.Workspace.c_str());
    AppendAssetBrowserWorkspaceLog(State, "OPEN", Message, Record.Id.c_str());
    Toast::Show(Message);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    SHEET HEADER
//------------------------------------------------------------------------------------------------------------------------

bool ConstructSheetHeader(AssetBrowserWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList,
                          ImVec2 Min, float Width)
{
    PanelCursor Head{ DrawList, &Faces, 1.0f, Min.x + 16.0f, Width - 32.0f, Min.y + 10.0f };
    Head.Text(Faces.Medium, StageCaptionSize, Head.X, Head.Y, 1.3f, ResolveCssColour(0xE8E8E8FF), "Asset Browser");
    char Counts[96]{};
    std::snprintf(Counts, sizeof(Counts), "%d assets · %d libraries · %d favorites", QueryAssetBrowserRecordCount(),
                  AssetBrowserWorkspaceCount, static_cast<int>(State.Favorites.size()));
    Head.Text(Faces.Regular, 11.0f, Head.X, Head.Y + 20.0f, 1.3f, ResolveCssColour(0x8A8A8AFF), Counts);

    const float SearchWide = std::min(360.0f, Width * 0.32f);
    ImGui::SetCursorScreenPos(ImVec2(Min.x + Width - SearchWide - 16.0f, Min.y + 8.0f));
    ImGui::PushItemWidth(SearchWide);
    if (State.FocusSearch)
    {
        ImGui::SetKeyboardFocusHere();
        State.FocusSearch = false;
    }
    ImGui::PushStyleColor(ImGuiCol_FrameBg, ImGui::ColorConvertU32ToFloat4(ResolveCssColour(0x1A1A1AFF)));
    ImGui::PushStyleColor(ImGuiCol_TextDisabled, ImGui::ColorConvertU32ToFloat4(ResolveCssColour(0x6E6E6EFF)));
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(28.0f, 5.0f));
    ImGui::InputTextWithHint("##AssetSearch", "Search assets\u2026", State.SearchText, sizeof(State.SearchText));
    const ImVec2 SearchMin = ImGui::GetItemRectMin();
    const ImVec2 SearchMax = ImGui::GetItemRectMax();
    ImGui::PopStyleVar(2);
    ImGui::PopStyleColor(2);
    DrawList->AddRect(SearchMin, SearchMax, ResolveCssColour(0xFFFFFF1A), 8.0f, ImDrawFlags_None, 1.0f);
    (void)GlyphSymbol::Construct(DrawList, "StudioSearch", ImVec2(SearchMin.x + 8.0f, SearchMin.y + 6.0f), 13.0f, 1.8f,
                                 ResolveCssColour(0x8A8A8AFF));
    RecordAssetBrowserWorkspaceRect(State, "Filter/Search", SearchMin, SearchMax);
    const bool Typing = ImGui::IsItemActive();
    ImGui::PopItemWidth();

    // 📝 View toggle + sort cycle sit left of the search field.
    float ButtonX = Min.x + Width - SearchWide - 16.0f;
    const auto Pill = [&](const char* Rect, const char* Label, float Wide, bool Active)
    {
        ButtonX -= Wide + 8.0f;
        const ImVec2 PMin(ButtonX, Min.y + 8.0f);
        const ImVec2 PMax(ButtonX + Wide, Min.y + 32.0f);
        DrawList->AddRectFilled(PMin, PMax,
                                Active ? ResolveCssColour(0xE8C27A33) : ResolveCssColour(0xFFFFFF0D), 8.0f);
        DrawList->AddRect(PMin, PMax, ResolveCssColour(Active ? 0xE8C27A88 : 0xFFFFFF1A), 8.0f, ImDrawFlags_None,
                          1.0f);
        PanelCursor Cursor{ DrawList, &Faces, 1.0f, PMin.x, Wide, PMin.y };
        const float TextWide = Cursor.Measure(Faces.Medium, 11.0f, Label);
        Cursor.Text(Faces.Medium, 11.0f, PMin.x + (Wide - TextWide) * 0.5f, PMin.y + 5.0f, 1.3f,
                    Active ? ResolveCssColour(0xE8C27AFF) : ResolveCssColour(0xB5B5B5FF), Label);
        RecordAssetBrowserWorkspaceRect(State, Rect, PMin, PMax);
        ImGui::PushID(Rect);
        const bool Pressed = InvisibleRect("##Pill", PMin, PMax);
        ImGui::PopID();
        return Pressed;
    };
    char SortText[32]{};
    std::snprintf(SortText, sizeof(SortText), "Sort: %s", SortLabel(State.Sort));
    if (Pill("Sort/Mode", SortText, 108.0f, false)) State.Sort = (State.Sort + 1) % 3;
    if (Pill("View/List", "List", 52.0f, !State.GridView)) State.GridView = false;
    if (Pill("View/Grid", "Grid", 52.0f, State.GridView)) State.GridView = true;
    return Typing;
}

void ConstructKindChips(AssetBrowserWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList,
                        ImVec2 Min, float Width, const std::vector<int>& FilteredForCounts)
{
    (void)FilteredForCounts;
    float X = Min.x + 16.0f;
    const float Y = Min.y + 4.0f;
    int         Ordinal = 0;
    const auto  Chip = [&](const char* Rect, const char* Label, int Count, bool Active)
    {
        char Text[64]{};
        std::snprintf(Text, sizeof(Text), "%s %d", Label, Count);
        PanelCursor Cursor{ DrawList, &Faces, 1.0f, X, Width, Y };
        const float Wide = Cursor.Measure(Faces.Medium, 11.0f, Text) + 22.0f;
        if (X + Wide > Min.x + Width - 16.0f) return;
        const ImVec2 CMin(X, Y);
        const ImVec2 CMax(X + Wide, Y + 26.0f);
        DrawList->AddRectFilled(CMin, CMax, Active ? ResolveCssColour(0xE8C27AFF) : ResolveCssColour(0xFFFFFF0D),
                                13.0f);
        Cursor.Text(Faces.Medium, 11.0f, X + 11.0f, Y + 5.0f, 1.3f,
                    Active ? ResolveCssColour(0x221A08FF) : ResolveCssColour(0xB5B5B5FF), Text);
        RecordAssetBrowserWorkspaceRect(State, Rect, CMin, CMax);
        ImGui::PushID(Ordinal++);
        const bool Pressed = InvisibleRect("##Kind", CMin, CMax);
        ImGui::PopID();
        if (Pressed)
        {
            if (std::strcmp(Rect, "Kind/All") == 0) State.Kind = -1;
            else State.Kind = std::atoi(Rect + 5);
        }
        X += Wide + 8.0f;
    };
    // 📝 Counts ignore the kind filter itself so every chip stays visible, like the prototype.
    AssetBrowserWorkspaceState Probe = State;
    Probe.Kind                        = -1;
    std::vector<int> Pool;
    QueryAssetBrowserFiltered(Probe, Pool);
    Chip("Kind/All", "All", static_cast<int>(Pool.size()), State.Kind < 0);
    for (int K = 0; K < QueryAssetBrowserKindCount(); ++K)
    {
        int Count = 0;
        for (int Index : Pool)
            if (QueryAssetBrowserRecord(Index).Kind == QueryAssetBrowserKindName(K)) ++Count;
        if (Count == 0) continue;
        char Rect[24]{};
        std::snprintf(Rect, sizeof(Rect), "Kind/%d", K);
        char Label[48]{};
        std::snprintf(Label, sizeof(Label), "%s", QueryAssetBrowserKindName(K));
        Chip(Rect, Label, Count, State.Kind == K);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    FOLDER TREE
//------------------------------------------------------------------------------------------------------------------------

void ConstructTree(AssetBrowserWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 Min,
                   ImVec2 Max)
{
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x101010FF), 14.0f);
    ImGui::SetCursorScreenPos(Min);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    ImGui::BeginChild("##AssetTree", ImVec2(Max.x - Min.x, Max.y - Min.y), false,
                      ImGuiWindowFlags_NoBackground | ImGuiWindowFlags_NoDecoration);
    const ImVec2        Origin = ImGui::GetCursorScreenPos();
    const float         ScrollPad = ImGui::GetStyle().ScrollbarSize;
    PanelCursor         Rows{ DrawList, &Faces, 1.0f, Origin.x + 8.0f, (Max.x - Min.x) - 16.0f - ScrollPad,
                              Origin.y + 8.0f };
    int                 Ordinal = 0;
    std::vector<std::string> Subs;
    const auto Row = [&](const char* Rect, const char* Label, int Count, bool Active, bool Nested)
    {
        const ImVec2 RMin = Rows.Space(TreeRowTall, 0.0f, 2.0f);
        const ImVec2 RMax(RMin.x + Rows.Width, RMin.y + TreeRowTall);
        if (Active)
        {
            DrawList->AddRectFilled(RMin, RMax, ResolveCssColour(0xE8C27A22), 8.0f);
            DrawList->AddRectFilled(ImVec2(RMin.x + 2.0f, RMin.y + 5.0f), ImVec2(RMin.x + 5.0f, RMax.y - 5.0f),
                                    ResolveCssColour(0xE8C27AFF), 1.5f);
        }
        char CountText[16]{};
        std::snprintf(CountText, sizeof(CountText), "%d", Count);
        Rows.Text(Faces.Regular, 12.0f, RMin.x + (Nested ? 26.0f : 10.0f), RMin.y + 6.0f, 1.3f,
                  Active ? ResolveCssColour(0xE8C27AFF) : ResolveCssColour(0xD8D8D8FF), Label);
        const float CountWide = Rows.Measure(Faces.Regular, 11.0f, CountText);
        Rows.Text(Faces.Regular, 11.0f, RMax.x - CountWide - 10.0f, RMin.y + 7.0f, 1.3f,
                  ResolveCssColour(0x8A8A8AFF), CountText);
        RecordAssetBrowserWorkspaceRect(State, Rect, RMin, RMax);
        ImGui::PushID(Ordinal++);
        const bool Pressed = InvisibleRect("##TreeRow", RMin, RMax);
        ImGui::PopID();
        return Pressed;
    };
    if (Row("Tree/All", "All Assets", QueryAssetBrowserRecordCount(), State.Folder == "all", false)) State.Folder = "all";
    if (Row("Tree/Fav", "Favorites", static_cast<int>(State.Favorites.size()), State.Folder == "fav", false))
        State.Folder = "fav";
    if (Row("Tree/Recent", "Recent", static_cast<int>(State.Recents.size()), State.Folder == "recent", false))
        State.Folder = "recent";
    for (int W = 0; W < AssetBrowserWorkspaceCount; ++W)
    {
        char Rect[48]{};
        std::snprintf(Rect, sizeof(Rect), "Tree/Ws%d", W);
        const char* Ws = QueryAssetBrowserWorkspaceName(W);
        if (Row(Rect, Ws, QueryAssetBrowserWorkspaceRecordCount(W), State.Folder == Ws, false)) State.Folder = Ws;
        CollectSubfolders(W, Subs);
        for (const std::string& Sub : Subs)
        {
            const char* Leaf = std::strchr(Sub.c_str(), '/');
            Leaf             = Leaf != nullptr ? Leaf + 1 : Sub.c_str();
            std::string SubRect = std::string("Tree/") + Sub;
            if (Row(SubRect.c_str(), Leaf, FolderCount(Sub.c_str()), State.Folder == Sub, true)) State.Folder = Sub;
        }
    }
    // 📝 Absolute-positioned rows below the fold are culled before they extend the content box, so the
    //    terminal dummy reserves the full scrolled height every frame; without it the scrollbar collapses.
    ImGui::SetCursorPos(ImVec2(0.0f, Rows.Y - Origin.y));
    ImGui::Dummy(ImVec2(1.0f, 1.0f));
    ImGui::EndChild();
    ImGui::PopStyleVar();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    ITEM GRID / LIST
//------------------------------------------------------------------------------------------------------------------------

void ConstructItems(AssetBrowserWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 Min,
                    ImVec2 Max, const std::vector<int>& Filtered)
{
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x0E0E0EFF), 14.0f);
    ImGui::SetCursorScreenPos(Min);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    ImGui::BeginChild("##AssetItems", ImVec2(Max.x - Min.x, Max.y - Min.y), false,
                      ImGuiWindowFlags_NoBackground | ImGuiWindowFlags_NoDecoration);
    const ImVec2 GridMin = ImGui::GetCursorScreenPos();
    const float  InnerW  = Max.x - Min.x - 24.0f - ImGui::GetStyle().ScrollbarSize;
    int          Ordinal = 0;
    if (State.GridView)
    {
        const int Columns = std::max(1, static_cast<int>(InnerW / (CardWide + 12.0f)));
        const float StepX = InnerW / static_cast<float>(Columns);
        int         Placed = 0;
        for (int Index : Filtered)
        {
            const AssetBrowserRecord& Record = QueryAssetBrowserRecord(Index);
            const int Col = Placed % Columns;
            const int Row = Placed / Columns;
            const ImVec2 CMin(GridMin.x + 12.0f + Col * StepX, GridMin.y + 12.0f + Row * (CardTall + 12.0f));
            const ImVec2 CMax(CMin.x + StepX - 12.0f, CMin.y + CardTall);
            const bool   Active = State.Selected == Index;
            DrawList->AddRectFilled(CMin, CMax, ResolveCssColour(0x1A1A1AFF), 12.0f);
            if (Active) DrawList->AddRectFilled(CMin, CMax, ResolveCssColour(0xE8C27A0D), 12.0f);
            DrawList->AddRect(CMin, CMax, ResolveCssColour(Active ? 0xE8C27AFF : 0xFFFFFF14), 12.0f, ImDrawFlags_None,
                              Active ? 1.5f : 1.0f);
            const ImU32 Accent = ResolveCssColour(Record.Colour);
            DrawList->AddRectFilled(ImVec2(CMin.x + 12.0f, CMin.y + 12.0f), ImVec2(CMin.x + 52.0f, CMin.y + 52.0f),
                                    ResolveAlpha(Accent, 0.16f), 10.0f);
            (void)GlyphSymbol::Construct(DrawList, Record.Glyph.c_str(), ImVec2(CMin.x + 21.0f, CMin.y + 21.0f), 22.0f,
                                         1.8f, Accent);
            PanelCursor Card{ DrawList, &Faces, 1.0f, CMin.x + 12.0f, (CMax.x - CMin.x) - 24.0f, CMin.y + 62.0f };
            Card.Text(Faces.Medium, 12.5f, Card.X, Card.Y, 1.3f, ResolveCssColour(0xF0F0F0FF), Record.Name.c_str());
            char Sub[128]{};
            std::snprintf(Sub, sizeof(Sub), "%s · %s", Record.Workspace.c_str(), Record.Kind.c_str());
            Card.Text(Faces.Regular, 10.5f, Card.X, Card.Y + 20.0f, 1.3f, Accent, Sub);
            char Blurb[96]{};
            std::snprintf(Blurb, sizeof(Blurb), "%s", Record.Blurb.c_str());
            if (std::strlen(Blurb) > 52)
            {
                Blurb[50] = Blurb[51] = Blurb[52] = '.';
                Blurb[53]             = '\0';
            }
            Card.Text(Faces.Regular, 10.5f, Card.X, Card.Y + 38.0f, 1.3f, ResolveCssColour(0x8A8A8AFF), Blurb);
            if (Placed < 8)
            {
                char Rect[24]{};
                std::snprintf(Rect, sizeof(Rect), "Item/%d", Placed);
                RecordAssetBrowserWorkspaceRect(State, Rect, CMin, CMax);
            }
            // 📝 Favorite star on the first card only: enough for scripted validation. The star submits
            //    before the card: ImGui awards a press to the first overlapping item.
            bool StarPressed = false;
            if (Placed == 0)
            {
                const bool   Fav = std::find(State.Favorites.begin(), State.Favorites.end(), Index) != State.Favorites.end();
                const ImVec2 SMin(CMax.x - 34.0f, CMin.y + 8.0f);
                const ImVec2 SMax(CMax.x - 8.0f, CMin.y + 34.0f);
                DrawList->AddCircleFilled(ImVec2(SMin.x + 13.0f, SMin.y + 13.0f), 11.0f,
                                          ResolveCssColour(Fav ? 0xE8C27A26 : 0xFFFFFF0D), 24);
                PanelCursor Star{ DrawList, &Faces, 1.0f, SMin.x, 26.0f, SMin.y };
                Star.Text(Faces.Medium, 15.0f, SMin.x + 5.0f, SMin.y + 3.0f, 1.2f,
                          Fav ? ResolveCssColour(0xE8C27AFF) : ResolveCssColour(0xB5B5B5FF), Fav ? "*" : "+");
                RecordAssetBrowserWorkspaceRect(State, "Item/Fav0", SMin, SMax);
                ImGui::PushID("Fav0");
                StarPressed = InvisibleRect("##ItemFav", SMin, SMax);
                ImGui::PopID();
            }
            ImGui::PushID(Ordinal++);
            const bool Pressed = InvisibleRect("##ItemCard", CMin, CMax);
            ImGui::PopID();
            if (StarPressed) ToggleAssetBrowserFavorite(State, Index);
            else if (Pressed) SelectAssetBrowserRecord(State, Index);
            ++Placed;
        }
        const int GridRows = (Placed + Columns - 1) / Columns;
        ImGui::SetCursorPos(ImVec2(0.0f, 12.0f + GridRows * (CardTall + 12.0f)));
        ImGui::Dummy(ImVec2(1.0f, 1.0f));
    }
    else
    {
        int Placed = 0;
        for (int Index : Filtered)
        {
            const AssetBrowserRecord& Record = QueryAssetBrowserRecord(Index);
            const ImVec2 RMin(GridMin.x + 12.0f, GridMin.y + 8.0f + Placed * (ListRowTall + 6.0f));
            const ImVec2 RMax(GridMin.x + 12.0f + InnerW, RMin.y + ListRowTall);
            const bool   Active = State.Selected == Index;
            DrawList->AddRectFilled(RMin, RMax, Active ? ResolveCssColour(0xE8C27A22) : ResolveCssColour(0x161616FF),
                                    10.0f);
            DrawList->AddRect(RMin, RMax, ResolveCssColour(Active ? 0xE8C27A66 : 0xFFFFFF0C), 10.0f, ImDrawFlags_None,
                              1.0f);
            const ImU32 Accent = ResolveCssColour(Record.Colour);
            (void)GlyphSymbol::Construct(DrawList, Record.Glyph.c_str(), ImVec2(RMin.x + 12.0f, RMin.y + 13.0f), 20.0f,
                                         1.8f, Accent);
            PanelCursor Row{ DrawList, &Faces, 1.0f, RMin.x + 44.0f, InnerW - 200.0f, RMin.y };
            Row.Text(Faces.Medium, 12.0f, Row.X, RMin.y + 5.0f, 1.3f, ResolveCssColour(0xEDEDEDFF),
                     Record.Name.c_str());
            Row.Text(Faces.Regular, 10.5f, Row.X, RMin.y + 23.0f, 1.3f, ResolveCssColour(0x8A8A8AFF),
                     Record.Folder.c_str());
            Row.Text(Faces.Medium, 11.0f, RMax.x - 150.0f, RMin.y + 14.0f, 1.3f, Accent, Record.Kind.c_str());
            if (Placed < 8)
            {
                char Rect[24]{};
                std::snprintf(Rect, sizeof(Rect), "Item/%d", Placed);
                RecordAssetBrowserWorkspaceRect(State, Rect, RMin, RMax);
            }
            ImGui::PushID(Ordinal++);
            const bool Pressed = InvisibleRect("##ItemRow", RMin, RMax);
            ImGui::PopID();
            if (Pressed) SelectAssetBrowserRecord(State, Index);
            ++Placed;
        }
        ImGui::SetCursorPos(ImVec2(0.0f, 8.0f + Placed * (ListRowTall + 6.0f)));
        ImGui::Dummy(ImVec2(1.0f, 1.0f));
    }
    if (Filtered.empty())
    {
        PanelCursor Empty{ DrawList, &Faces, 1.0f, GridMin.x + 24.0f, InnerW, GridMin.y + 40.0f };
        Empty.Text(Faces.Medium, 14.0f, Empty.X, Empty.Y, 1.3f, ResolveCssColour(0xB5B5B5FF), "No assets match");
        Empty.Text(Faces.Regular, 11.5f, Empty.X, Empty.Y + 26.0f, 1.3f, ResolveCssColour(0x8A8A8AFF),
                   "Try a different search, folder, or kind filter.");
    }
    ImGui::EndChild();
    ImGui::PopStyleVar();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    NOTCH
//------------------------------------------------------------------------------------------------------------------------

void ConstructNotch(AssetBrowserWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 Size,
                    float SheetH)
{
    const float Wide  = std::min(340.0f, Size.x * 0.6f); // 🧩 Slim enough to clear the view pills.
    const float X0    = (Size.x - Wide) * 0.5f;
    const float X1    = X0 + Wide;
    const float Y1    = Size.y - SheetH + NotchOverlap;
    const float Y0    = Y1 - NotchTall;
    const float Inset = Wide * 0.08f; // 🧩 PanelExpansionTab's 8% trapezoid inset, wide edge down.
    const ImVec2 Contour[4] = { ImVec2(X0 + Inset, Y0), ImVec2(X1 - Inset, Y0), ImVec2(X1, Y1), ImVec2(X0, Y1) };
    const ImVec2 Shadow[4] = { ImVec2(Contour[0].x, Contour[0].y + 3.0f), ImVec2(Contour[1].x, Contour[1].y + 3.0f),
                                       ImVec2(Contour[2].x, Contour[2].y + 3.0f), ImVec2(Contour[3].x, Contour[3].y + 3.0f) };
    DrawList->AddConvexPolyFilled(Shadow, 4, ResolveCssColour(0x00000066));
    DrawList->AddConvexPolyFilled(Contour, 4, ResolveCssColour(0x232323FF));
    DrawList->AddPolyline(Contour, 4, ResolveCssColour(0xE8C27A55), ImDrawFlags_Closed, 1.5f);
    PanelCursor Cap{ DrawList, &Faces, 1.0f, X0, Wide, Y0 };
    const float LabelWide = Cap.Measure(Faces.Medium, 12.0f, "ASSETS");
    Cap.Text(Faces.Medium, 12.0f, X0 + (Wide - LabelWide) * 0.5f - 8.0f, Y0 + 5.0f, 1.3f,
             ResolveCssColour(0xE8C27AFF), "ASSETS");
    (void)GlyphSymbol::Construct(DrawList, State.SheetOpen ? "ChevronDown" : "ChevronUp",
                                 ImVec2(X0 + (Wide + LabelWide) * 0.5f - 2.0f, Y0 + 6.0f), 13.0f, 2.0f,
                                 ResolveCssColour(0xE8C27AFF));
    DrawList->AddRectFilled(ImVec2(X0 + (Wide - 48.0f) * 0.5f, Y0 + 27.0f),
                            ImVec2(X0 + (Wide + 48.0f) * 0.5f, Y0 + 33.0f), ResolveCssColour(0x8A8A8AFF), 3.0f);
    RecordAssetBrowserWorkspaceRect(State, "Notch/Tab", ImVec2(X0, Y0), ImVec2(X1, Y1));

    ImGui::SetCursorScreenPos(ImVec2(X0, Y0));
    ImGui::InvisibleButton("##AssetNotch", ImVec2(Wide, NotchTall));
    ImGuiIO&      IO    = ImGui::GetIO();
    SpringChannel& Spring = State.Motion.Spring(State.SheetChannel);
    const float   Travel = State.SheetTravel;
    if (ImGui::IsItemActivated())
    {
        State.NotchDragging = true;
        State.NotchMoved     = false;
        State.NotchGrabY     = IO.MousePos.y;
        State.NotchLastY     = IO.MousePos.y;
        State.NotchLastT     = ImGui::GetTime();
        State.NotchGrabH     = static_cast<float>(Spring.Current);
        State.NotchRate      = 0.0f;
        Spring.ConfigurePosition(Spring.Current);
    }
    if (State.NotchDragging && ImGui::IsItemActive())
    {
        const float Up = State.NotchGrabY - IO.MousePos.y; // 🧩 Upward travel is positive, like the C++ tab.
        if (std::fabs(Up) > 4.0f) State.NotchMoved = true;
        const double Now = ImGui::GetTime();
        const double Dt  = std::max(1.0 / 240.0, Now - State.NotchLastT);
        State.NotchRate  = static_cast<float>(0.60 * State.NotchRate + 0.40 * (State.NotchLastY - IO.MousePos.y) / Dt);
        State.NotchLastY = IO.MousePos.y;
        State.NotchLastT = Now;
        double Carried   = State.NotchGrabH + Up; // 🧩 Elastic overshoot mirrors IntegratePointer's ×0.05.
        if (Carried < 0) Carried = Carried * 0.05;
        else if (Carried > Travel) Carried = Travel + (Carried - Travel) * 0.05;
        Spring.ConfigurePosition(Carried);
    }
    if (State.NotchDragging && ImGui::IsItemDeactivated())
    {
        State.NotchDragging = false;
        const float Height       = static_cast<float>(Spring.Current);
        const float Displacement = Height - State.NotchGrabH;
        bool        Destination  = State.SheetOpen;
        if (!State.NotchMoved) Destination = !State.SheetOpen; // 🧩 Tap toggles.
        else if (Height > Travel * 0.5f) Destination = !(State.NotchRate < -20.0f || Displacement < -50.0f);
        else Destination = State.NotchRate > 20.0f || Displacement > 50.0f;
        State.SheetOpen = Destination;
        Spring.Depart(Destination ? Travel : 0.0);
        Spring.Rate = State.NotchRate;
    }
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    SHELL
//------------------------------------------------------------------------------------------------------------------------

void ConstructAssetBrowserWorkspace(AssetBrowserWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Size,
                                    AssetBrowserLink* Link)
{
    State.Rects.clear();
    ApplyAssetBrowserLink(State, Link);
    ImGuiIO& IO      = ImGui::GetIO();
    State.SheetTravel = Size.y * 0.8f;
    if (!State.SheetChannelReady)
    {
        State.SheetChannel      = State.Motion.Register(0.0);
        State.SheetChannelReady = true;
        // 📝 Boot open: pin the sheet at full travel on first registration so evidence shows the browser.
        if (State.SheetOpen) State.Motion.Spring(State.SheetChannel).ConfigurePosition(State.SheetTravel);
    }
    SpringChannel& Spring = State.Motion.Spring(State.SheetChannel);
    if (!State.NotchDragging)
    {
        const double Want = State.SheetOpen ? State.SheetTravel : 0.0;
        if (Spring.Target != Want) Spring.Depart(Want);
        State.Motion.Integrate(std::min<double>(IO.DeltaTime > 0 ? IO.DeltaTime : 1.0 / 60.0, 0.1));
    }
    const float SheetH = std::clamp(static_cast<float>(Spring.Current), 0.0f, State.SheetTravel);

    ImGui::SetNextWindowPos(ImVec2(0.0f, 0.0f));
    ImGui::SetNextWindowSize(Size);
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImGui::ColorConvertU32ToFloat4(ResolveCssColour(0x0B0B0BFF)));
    ImGui::PushStyleColor(ImGuiCol_ScrollbarBg, ImVec4(0, 0, 0, 0));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
    ImGui::Begin("##AssetBrowserWorkspace", nullptr,
                 ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoScrollbar |
                     ImGuiWindowFlags_NoScrollWithMouse);
    ImGui::PopStyleVar(2);
    ImGui::PopStyleColor(2);
    ImDrawList* const DrawList = ImGui::GetWindowDrawList();

    // 📝 Stage: dark viewport under the sheet with the centered browse entry.
    PanelCursor Stage{ DrawList, &Faces, 1.0f, 0.0f, Size.x, 0.0f };
    const float StageMidY = (Size.y - SheetH) * 0.5f;
    const float TitleWide = Stage.Measure(Faces.Medium, 22.0f, "ASSET STAGE");
    Stage.Text(Faces.Medium, 22.0f, (Size.x - TitleWide) * 0.5f, StageMidY - 52.0f, 1.3f,
               ResolveCssColour(0x3A3A3AFF), "ASSET STAGE");
    char StageCounts[96]{};
    std::snprintf(StageCounts, sizeof(StageCounts), "%d assets · %d libraries", QueryAssetBrowserRecordCount(),
                  AssetBrowserWorkspaceCount);
    const float CountsWide = Stage.Measure(Faces.Regular, 12.0f, StageCounts);
    Stage.Text(Faces.Regular, 12.0f, (Size.x - CountsWide) * 0.5f, StageMidY - 18.0f, 1.3f,
               ResolveCssColour(0x6E6E6EFF), StageCounts);
    const ImVec2 BrowseMin((Size.x - 220.0f) * 0.5f, StageMidY + 12.0f);
    const ImVec2 BrowseMax(BrowseMin.x + 220.0f, BrowseMin.y + 44.0f);
    DrawList->AddRectFilled(BrowseMin, BrowseMax, ResolveCssColour(0xE8C27AFF), 12.0f);
    PanelCursor Browse{ DrawList, &Faces, 1.0f, BrowseMin.x, 220.0f, BrowseMin.y };
    const float BrowseWide = Browse.Measure(Faces.Medium, 13.0f, "Browse assets");
    Browse.Text(Faces.Medium, 13.0f, BrowseMin.x + (220.0f - BrowseWide) * 0.5f, BrowseMin.y + 12.0f, 1.3f,
                ResolveCssColour(0x221A08FF), "Browse assets");
    RecordAssetBrowserWorkspaceRect(State, "Stage/Browse", BrowseMin, BrowseMax);
    if (InvisibleRect("##StageBrowse", BrowseMin, BrowseMax))
    {
        State.SheetOpen = true;
        State.FocusSearch = true;
    }

    std::vector<int> Filtered;
    bool             Typing = false;
    if (SheetH > 1.0f)
    {
        const ImVec2 SheetMin(0.0f, Size.y - SheetH);
        const ImVec2 SheetMax(Size.x, Size.y);
        DrawList->AddRectFilled(SheetMin, SheetMax, ResolveCssColour(0x141414FF), 18.0f, ImDrawFlags_RoundCornersTop);
        DrawList->AddLine(ImVec2(18.0f, SheetMin.y + 1.0f), ImVec2(Size.x - 18.0f, SheetMin.y + 1.0f),
                          ResolveCssColour(0xE8C27A33), 1.5f);
        RecordAssetBrowserWorkspaceRect(State, "Sheet/Body", SheetMin, SheetMax);
        Typing = ConstructSheetHeader(State, Faces, DrawList, SheetMin, Size.x);
        QueryAssetBrowserFiltered(State, Filtered);
        ConstructKindChips(State, Faces, DrawList, ImVec2(SheetMin.x, SheetMin.y + HeaderTall), Size.x, Filtered);

        DrawList->AddLine(ImVec2(16.0f, SheetMin.y + HeaderTall + ChipsTall - 4.0f),
                          ImVec2(Size.x - 16.0f, SheetMin.y + HeaderTall + ChipsTall - 4.0f),
                          ResolveCssColour(0xFFFFFF12), 1.0f);
        const float ColumnsY = SheetMin.y + HeaderTall + ChipsTall;
        const float ColumnsH = SheetH - HeaderTall - ChipsTall - FooterTall;
        const ImVec2 TreeMin(12.0f, ColumnsY);
        const ImVec2 TreeMax(12.0f + TreeWide, ColumnsY + ColumnsH);
        const ImVec2 InspMax(Size.x - 12.0f, ColumnsY + ColumnsH);
        const ImVec2 InspMin(InspMax.x - InspectorWide, ColumnsY);
        const ImVec2 ItemsMin(TreeMax.x + 10.0f, ColumnsY);
        const ImVec2 ItemsMax(InspMin.x - 10.0f, ColumnsY + ColumnsH);
        ConstructTree(State, Faces, DrawList, TreeMin, TreeMax);
        ConstructItems(State, Faces, DrawList, ItemsMin, ItemsMax, Filtered);
        ConstructAssetBrowserInspector(State, Faces, DrawList, InspMin, InspMax, Link);

        DrawList->AddLine(ImVec2(16.0f, Size.y - FooterTall), ImVec2(Size.x - 16.0f, Size.y - FooterTall),
                          ResolveCssColour(0xFFFFFF12), 1.0f);
        PanelCursor Foot{ DrawList, &Faces, 1.0f, 16.0f, Size.x - 32.0f, Size.y - FooterTall + 8.0f };
        char Status[128]{};
        if (State.Selected >= 0)
        {
            const AssetBrowserRecord& Sel = QueryAssetBrowserRecord(State.Selected);
            std::snprintf(Status, sizeof(Status), "%d shown · %s — %s", static_cast<int>(Filtered.size()),
                          Sel.Name.c_str(), Sel.Workspace.c_str());
        }
        else std::snprintf(Status, sizeof(Status), "%d shown · No selection", static_cast<int>(Filtered.size()));
        Foot.Text(Faces.Regular, 11.0f, Foot.X, Foot.Y, 1.3f, ResolveCssColour(0x8A8A8AFF), Status);
    }

    ConstructNotch(State, Faces, DrawList, Size, SheetH);
    Toast::Construct();

    // 📝 Keyboard mirrors the prototype: B toggles, Esc docks then clears, / searches, arrows move, Enter opens.
    if (!Typing && SheetH > 1.0f)
    {
        if (ImGui::IsKeyPressed(ImGuiKey_B)) State.SheetOpen = !State.SheetOpen;
        else if (ImGui::IsKeyPressed(ImGuiKey_Escape))
        {
            if (State.SheetOpen) State.SheetOpen = false;
            else SelectAssetBrowserRecord(State, -1);
        }
        else if (ImGui::IsKeyPressed(ImGuiKey_Slash)) State.FocusSearch = true;
        else if (ImGui::IsKeyPressed(ImGuiKey_DownArrow) || ImGui::IsKeyPressed(ImGuiKey_RightArrow)) MoveSelection(State, Filtered, 1);
        else if (ImGui::IsKeyPressed(ImGuiKey_UpArrow) || ImGui::IsKeyPressed(ImGuiKey_LeftArrow)) MoveSelection(State, Filtered, -1);
        else if (ImGui::IsKeyPressed(ImGuiKey_Enter) || ImGui::IsKeyPressed(ImGuiKey_KeypadEnter))
            OpenSelectedInWorkspace(State, Link);
        else if (ImGui::IsKeyPressed(ImGuiKey_F) && State.Selected >= 0) ToggleAssetBrowserFavorite(State, State.Selected);
        else if (ImGui::IsKeyPressed(ImGuiKey_G)) State.GridView = true;
        else if (ImGui::IsKeyPressed(ImGuiKey_L)) State.GridView = false;
    }
    else if (!Typing && ImGui::IsKeyPressed(ImGuiKey_B))
    {
        State.SheetOpen = !State.SheetOpen;
    }

    ImGui::End();
}

} // namespace Frontier
