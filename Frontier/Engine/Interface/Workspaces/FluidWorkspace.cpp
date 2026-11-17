/*==========================================================================================================================================
                                                           FLUIDWORKSPACE.CPP
==========================================================================================================================================*/
// 🧩 The Fluid Workspace root shell: top bar (brand, document chip, suite keys), scene outliner, plume preset library,
//    viewport bar + plume stage + transport + timeline, inspector host, flipbook bake dialog, log drawer, and the status
//    bar. Value edits (selects, toggles, search, orbit) touch shell-local state only; every engine-bound command is an
//    explicit NOOP with a toast and a warm log line. The bake sheet lives in its own child window so its keys receive
//    presses over the inspector child; the veil dismisses on outside presses.

#include "Engine/Interface/Workspaces/FluidWorkspace.h"

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
#include <utility>

namespace Frontier
{
namespace
{

constexpr float PiSingle = 3.14159265358979f;

//------------------------------------------------------------------------------------------------------------------------
//                                                    SMALL HELPERS
//------------------------------------------------------------------------------------------------------------------------

void RecordRect(FluidWorkspaceState& State, const char* Name, ImVec2 Min, ImVec2 Max)
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

// 📝 Viewport-bar select: current value pill plus a popup list. Popup-only rects, like the U2 camera select.
void ConstructBarSelect(FluidWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, const char* Id,
                        const char* RectTag, const char* Label, const char* const* Options, int Count, int& InOutIndex, ImVec2 Min,
                        float Wide, const char* Channel = nullptr, const char* LogLabel = nullptr)
{
    PanelCursor Cursor{ DrawList, &Faces, 1.0f, Min.x, Wide, Min.y };
    const ImVec2 Max(Min.x + Wide, Min.y + 29.0f);
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x0E0F12D6), 10.0f);
    DrawList->AddRect(Min, Max, ResolveCssColour(0xFFFFFF12), 10.0f, ImDrawFlags_None, 1.0f);
    char Line[96]{};
    std::snprintf(Line, sizeof(Line), "%s: %s", Label, Options[InOutIndex]);
    Cursor.Text(Faces.Medium, 11.0f, Min.x + 10.0f, Min.y + 14.5f - 0.5f * 11.0f * 1.38f, 1.38f, ResolveCssColour(0xBCBCBCFF), Line);
    (void)GlyphSymbol::Construct(DrawList, "StudioChevron", ImVec2(Max.x - 20.0f, Min.y + 8.5f), 12.0f, 1.8f,
                                 ResolveCssColour(0x848484FF));
    ImGui::PushID(Id);
    RecordRect(State, RectTag, Min, Max);
    if (InvisibleRect("##BarSelect", Min, Max)) ImGui::OpenPopup("##BarOptions");

    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(4.0f, 4.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 10.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 1.0f);
    ImGui::PushStyleColor(ImGuiCol_PopupBg, ImGui::ColorConvertU32ToFloat4(ResolveCssColour(0x161616FF)));
    ImGui::PushStyleColor(ImGuiCol_Border, ImGui::ColorConvertU32ToFloat4(ResolveCssColour(0xFFFFFF24)));
    ImGui::SetNextWindowPos(ImVec2(Min.x, Max.y + 4.0f));
    ImGui::SetNextWindowSize(ImVec2(Wide, 0.0f));
    if (ImGui::BeginPopup("##BarOptions", ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoSavedSettings))
    {
        ImDrawList* const PopupList = ImGui::GetWindowDrawList();
        const ImVec2      ListMin   = ImGui::GetCursorScreenPos();
        constexpr float   RowTall   = 30.0f;
        const float       ListWide  = Wide - 8.0f;
        for (int Index = 0; Index < Count; ++Index)
        {
            const ImVec2 RowMin(ListMin.x, ListMin.y + Index * RowTall);
            const ImVec2 RowMax(RowMin.x + ListWide, RowMin.y + RowTall);
            const bool   CurrentRow = Index == InOutIndex;
            if (CurrentRow) PopupList->AddRectFilled(RowMin, RowMax, ResolveCssColour(0xE8C27A1F), 7.0f);
            (void)GlyphRun::Rasterize(PopupList, &Faces, Faces.Regular, 11.0f,
                                      ImVec2(RowMin.x + 10.0f,
                                             GlyphRun::ResolveBaseline(RowMin.y + 0.5f * (RowTall - 11.0f * 1.38f), 11.0f, 1.38f)),
                                      ResolveCssColour(CurrentRow ? 0xE8C27AFF : 0xD8D8D8FF), Options[Index], 0.0f, false);
            char OptionTag[64]{};
            std::snprintf(OptionTag, sizeof(OptionTag), "%s/Option%d", RectTag, Index);
            RecordRect(State, OptionTag, RowMin, RowMax);
            ImGui::SetCursorScreenPos(RowMin);
            ImGui::PushID(Index);
            if (ImGui::InvisibleButton("##BarOption", ImVec2(ListWide, RowTall), ImGuiButtonFlags_EnableNav))
            {
                InOutIndex = Index;
                if (Channel != nullptr && LogLabel != nullptr) LogFluidWorkspaceValue(State, Channel, LogLabel, Options[Index]);
                ImGui::CloseCurrentPopup();
            }
            ImGui::PopID();
        }
        ImGui::SetCursorScreenPos(ImVec2(ListMin.x, ListMin.y + Count * RowTall));
        ImGui::Dummy(ImVec2(1.0f, 1.0f));
        ImGui::EndPopup();
    }
    ImGui::PopStyleColor(2);
    ImGui::PopStyleVar(3);
    ImGui::PopID();
}

void ConstructSearchBox(FluidWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, const char* Id,
                        const char* RectTag, ImVec2 Min, ImVec2 Max, const char* Hint, std::string& Query)
{
    PanelCursor Cursor{ DrawList, &Faces, 1.0f, Min.x, Max.x - Min.x, Min.y };
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x0E0F12D6), 10.0f);
    DrawList->AddRect(Min, Max, ResolveCssColour(0xFFFFFF12), 10.0f, ImDrawFlags_None, 1.0f);
    (void)GlyphSymbol::Construct(DrawList, "StudioSearch", ImVec2(Min.x + 9.0f, Min.y + 0.5f * (Max.y - Min.y) - 6.0f), 12.0f,
                                 1.8f, ResolveCssColour(0x5E5E5EFF));
    if (Query.empty())
    {
        Cursor.Text(Faces.Regular, 11.0f, Min.x + 28.0f, Min.y + 0.5f * (Max.y - Min.y) - 0.5f * 11.0f * 1.4f, 1.4f,
                    ResolveCssColour(0x5E5E5EFF), Hint);
    }
    ImGui::PushID(Id);
    RecordRect(State, RectTag, Min, Max);
    char Buffer[128]{};
    std::snprintf(Buffer, sizeof(Buffer), "%s", Query.c_str());
    ImGui::SetCursorScreenPos(ImVec2(Min.x + 26.0f, Min.y + 2.0f));
    ImGui::SetNextItemWidth(Max.x - Min.x - 32.0f);
    ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0, 0, 0, 0));
    ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 0.0f);
    ImGui::PushStyleColor(ImGuiCol_Text, ImGui::ColorConvertU32ToFloat4(ResolveCssColour(0xD8D8D8FF)));
    if (ImGui::InputText("##Search", Buffer, sizeof(Buffer), ImGuiInputTextFlags_EscapeClearsAll)) Query = Buffer;
    ImGui::PopStyleColor(2);
    ImGui::PopStyleVar();
    ImGui::PopID();
}

const char* QueryNodeGlyph(const FluidWorkspaceState& State, int Node) noexcept
{
    if (Node == FluidWorkspaceState::SelectedEmitter) return State.Parameters.EmitterFuel == 0.0 ? "StudioPuff" : "StudioFlame";
    if (Node == FluidWorkspaceState::SelectedCollider) return "StudioGlobe";
    if (Node == FluidWorkspaceState::SelectedSun) return "StudioSun";
    return "StudioBoxes";
}

ImU32 QueryNodeAccent(int Node) noexcept
{
    if (Node == FluidWorkspaceState::SelectedEmitter) return ResolveCssColour(0xE8823CFF);
    if (Node == FluidWorkspaceState::SelectedCollider) return ResolveCssColour(0xB48FE8FF);
    if (Node == FluidWorkspaceState::SelectedSun) return ResolveCssColour(0xE8C27AFF);
    return ResolveCssColour(0x9AA3A8FF);
}

int QueryNodeCategory(int Node) noexcept
{
    if (Node == FluidWorkspaceState::SelectedCollider) return FluidWorkspaceState::SceneFilterGeometry;
    if (Node == FluidWorkspaceState::SelectedSun) return FluidWorkspaceState::SceneFilterLights;
    return FluidWorkspaceState::SceneFilterGas;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    TOP BAR
//------------------------------------------------------------------------------------------------------------------------

void ConstructTopBar(FluidWorkspaceState& State, PanelCursor& Root)
{
    const EditorTypefaces& Faces    = *Root.Faces;
    ImDrawList* const      DrawList = Root.DrawList;
    const ImVec2           Bar      = Root.Space(46.0f, 0.0f, 8.0f);
    const float            Left     = Bar.x;
    const float            Right    = Bar.x + Root.Width;

    Root.Text(Faces.SemiBold, 15.0f, Left, Bar.y + 23.0f - 0.5f * 15.0f * 1.3f, 1.3f, ResolveCssColour(0xF1F1F1FF), "frontier.",
              -0.3f);
    const float ChipWide = Root.Measure(Faces.SemiBold, 9.0f, "FLUID", 0.9f) + 16.0f;
    const float ChipX    = Left + Root.Measure(Faces.SemiBold, 15.0f, "frontier.", -0.3f) + 8.0f;
    DrawList->AddRectFilled(ImVec2(ChipX, Bar.y + 13.0f), ImVec2(ChipX + ChipWide, Bar.y + 33.0f), ResolveCssColour(0xE8823C22),
                            10.0f);
    DrawList->AddRect(ImVec2(ChipX, Bar.y + 13.0f), ImVec2(ChipX + ChipWide, Bar.y + 33.0f), ResolveCssColour(0xE8823C55), 10.0f,
                      ImDrawFlags_None, 1.0f);
    Root.Text(Faces.SemiBold, 9.0f, ChipX + 8.0f, Bar.y + 23.0f - 0.5f * 9.0f * 1.4f, 1.4f, ResolveCssColour(0xE8823CFF), "FLUID",
              0.9f);

    const char* DocName    = "Pyro plume";
    const float DocWide    = Root.Measure(Faces.Medium, 12.0f, DocName) + 52.0f;
    const float Centre     = Left + Root.Width * 0.5f;
    const ImVec2 DocMin(Centre - DocWide * 0.5f, Bar.y + 8.0f);
    const ImVec2 DocMax(DocMin.x + DocWide, Bar.y + 38.0f);
    DrawList->AddRectFilled(DocMin, DocMax, ResolveCssColour(0x1E1E1EFF), 15.0f);
    DrawList->AddRect(DocMin, DocMax, ResolveCssColour(0xFFFFFF14), 15.0f, ImDrawFlags_None, 1.0f);
    DrawList->AddCircleFilled(ImVec2(DocMin.x + 15.0f, Bar.y + 23.0f), 4.0f, ResolveCssColour(0xE8823CFF), 16);
    Root.Text(Faces.Medium, 12.0f, DocMin.x + 25.0f, Bar.y + 23.0f - 0.5f * 12.0f * 1.38f, 1.38f, ResolveCssColour(0xEFEFEFFF),
              DocName);
    RecordRect(State, "TopBar/Doc", DocMin, DocMax);

    const ImVec2 AddMax(DocMax.x + 38.0f, Bar.y + 38.0f);
    const ImVec2 AddMin(AddMax.x - 30.0f, Bar.y + 8.0f);
    DrawList->AddRectFilled(AddMin, AddMax, ResolveCssColour(0x1A1A1AFF), 15.0f);
    (void)GlyphSymbol::Construct(DrawList, "StudioPlus", ImVec2(AddMin.x + 9.0f, AddMin.y + 9.0f), 12.0f, 1.8f,
                                 ResolveCssColour(0xBCBCBCFF));
    RecordRect(State, "TopBar/Add", AddMin, AddMax);
    if (InvisibleRect("##TopBarAdd", AddMin, AddMax))
    {
        NoopFluidWorkspaceCommand(State, "SCENE", "New document refused", "Opening documents is a NOOP in this shell");
    }

    struct SuiteKey
    {
        const char* Tag;
        const char* Glyph;
        const char* Label;
        const char* Toast;
    };
    static const SuiteKey Keys[4] = { { "TopBar/Samples", "StudioFolder", "Samples", "Sample scenes are NOOPs in this shell" },
                                      { "TopBar/Import", "StudioArchive", "Import", "Import is a NOOP in this shell" },
                                      { "TopBar/Export", "StudioDownload", "Export", "Export is a NOOP in this shell" },
                                      { "TopBar/Help", "StudioHelp", "Help", "Help is a NOOP in this shell" } };
    float KeyRight = Right;
    for (int Index = 3; Index >= 0; --Index)
    {
        const float KeyWide = Root.Measure(Faces.Medium, 11.0f, Keys[Index].Label) + 44.0f;
        const ImVec2 KeyMax(KeyRight, Bar.y + 38.0f);
        const ImVec2 KeyMin(KeyMax.x - KeyWide, Bar.y + 8.0f);
        DrawList->AddRectFilled(KeyMin, KeyMax, ResolveCssColour(0x161616FF), 15.0f);
        DrawList->AddRect(KeyMin, KeyMax, ResolveCssColour(0xFFFFFF10), 15.0f, ImDrawFlags_None, 1.0f);
        (void)GlyphSymbol::Construct(DrawList, Keys[Index].Glyph, ImVec2(KeyMin.x + 10.0f, KeyMin.y + 9.0f), 12.0f, 1.8f,
                                     ResolveCssColour(0xBCBCBCFF));
        Root.Text(Faces.Medium, 11.0f, KeyMin.x + 28.0f, Bar.y + 23.0f - 0.5f * 11.0f * 1.38f, 1.38f,
                  ResolveCssColour(0xBCBCBCFF), Keys[Index].Label);
        ImGui::PushID(Index);
        RecordRect(State, Keys[Index].Tag, KeyMin, KeyMax);
        if (InvisibleRect("##SuiteKey", KeyMin, KeyMax))
        {
            char Message[96]{};
            std::snprintf(Message, sizeof(Message), "%s refused", Keys[Index].Label);
            NoopFluidWorkspaceCommand(State, "SCENE", Message, Keys[Index].Toast);
        }
        ImGui::PopID();
        KeyRight = KeyMin.x - 8.0f;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    OUTLINER
//------------------------------------------------------------------------------------------------------------------------

void ConstructOutlinerPanel(FluidWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Min, ImVec2 Max)
{
    ImDrawList* const DrawList = ImGui::GetWindowDrawList();
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x121212FF), 22.0f);
    DrawList->AddRect(Min, Max, ResolveCssColour(0xFFFFFF0E), 22.0f, ImDrawFlags_None, 1.0f);
    PanelCursor Panel{ DrawList, &Faces, 1.0f, Min.x + 14.0f, Max.x - Min.x - 28.0f, Min.y + 12.0f };

    int Shown   = 0;
    int Enabled = 0;
    for (int Node = 0; Node < 4; ++Node)
    {
        // 📝 The collider row always shows: preset staging is a NOOP, so the reference's reveal rule would strand it.
        if (State.SceneFilter != FluidWorkspaceState::SceneFilterAll && QueryNodeCategory(Node) != State.SceneFilter) continue;
        if (!QueryMatches(State.NodeNames[Node].c_str(), State.OutlinerQuery)) continue;
        ++Shown;
        if (QueryFluidNodeEnabled(State, Node)) ++Enabled;
    }
    char Heading[48]{};
    std::snprintf(Heading, sizeof(Heading), "Scene · %d nodes", Shown);
    const ImVec2 Head = Panel.Space(22.0f);
    Panel.Text(Faces.Light, 13.5f, Head.x, Head.y, 1.4f, ResolveCssColour(0xDADADADA), Heading, -0.2f);

    const ImVec2 AddMax(Min.x + Panel.Width + 14.0f, Head.y + 26.0f);
    const ImVec2 AddMin(AddMax.x - 26.0f, Head.y);
    DrawList->AddRectFilled(AddMin, AddMax, ResolveCssColour(0xE8C27AFF), 13.0f);
    (void)GlyphSymbol::Construct(DrawList, "StudioPlus", ImVec2(AddMin.x + 7.0f, AddMin.y + 7.0f), 12.0f, 2.0f,
                                 ResolveCssColour(0x1A1A1AFF));
    RecordRect(State, "Outliner/Add", AddMin, AddMax);
    if (InvisibleRect("##OutlinerAdd", AddMin, AddMax))
    {
        NoopFluidWorkspaceCommand(State, "SCENE", "Add node refused", "Adding nodes is a NOOP in this shell");
    }

    const ImVec2 Stats = Panel.Space(46.0f, 8.0f, 8.0f);
    const float StatWide = (Panel.Width - 8.0f) * 0.5f;
    for (int Tile = 0; Tile < 2; ++Tile)
    {
        const ImVec2 TileMin(Stats.x + Tile * (StatWide + 8.0f), Stats.y);
        const ImVec2 TileMax(TileMin.x + StatWide, Stats.y + 46.0f);
        DrawList->AddRectFilled(TileMin, TileMax, ResolveCssColour(0x1A1A1AFF), 12.0f);
        char Figure[16]{};
        std::snprintf(Figure, sizeof(Figure), "%d", Tile == 0 ? Enabled : Shown - Enabled);
        Panel.Text(Faces.Light, 17.0f, TileMin.x + 12.0f, TileMin.y + 5.0f, 1.2f, ResolveCssColour(0xF1F1F1FF), Figure);
        Panel.Text(Faces.Regular, 9.5f, TileMin.x + 12.0f, TileMin.y + 27.0f, 1.4f, ResolveCssColour(0x707070FF),
                   Tile == 0 ? "Enabled" : "Muted");
    }

    const ImVec2 Search = Panel.Space(30.0f, 0.0f, 8.0f);
    ConstructSearchBox(State, Faces, DrawList, "OutlinerSearch", "Outliner/Search", ImVec2(Search.x, Search.y),
                       ImVec2(Search.x + Panel.Width, Search.y + 30.0f), "Search nodes…", State.OutlinerQuery);

    static const char* Filters[4] = { "All", "Gas", "Geometry", "Lights" };
    const ImVec2 FilterRow        = Panel.Space(26.0f, 0.0f, 8.0f);
    float FilterX                 = FilterRow.x;
    for (int Index = 0; Index < 4; ++Index)
    {
        const float ChipWide = Panel.Measure(Faces.Medium, 10.5f, Filters[Index]) + 20.0f;
        const ImVec2 ChipMin(FilterX, FilterRow.y);
        const ImVec2 ChipMax(ChipMin.x + ChipWide, FilterRow.y + 26.0f);
        const bool Active = State.SceneFilter == Index;
        DrawList->AddRectFilled(ChipMin, ChipMax, ResolveCssColour(Active ? 0xE8C27AFF : 0x1A1A1AFF), 13.0f);
        Panel.Text(Faces.Medium, 10.5f, ChipMin.x + 10.0f, FilterRow.y + 13.0f - 0.5f * 10.5f * 1.38f, 1.38f,
                   ResolveCssColour(Active ? 0x1A1A1AFF : 0xBCBCBCFF), Filters[Index]);
        ImGui::PushID(100 + Index);
        char RectName[48]{};
        std::snprintf(RectName, sizeof(RectName), "Outliner/Filter%d", Index);
        RecordRect(State, RectName, ChipMin, ChipMax);
        if (InvisibleRect("##SceneFilter", ChipMin, ChipMax)) State.SceneFilter = Index;
        ImGui::PopID();
        FilterX = ChipMax.x + 6.0f;
    }

    for (int Node = 0; Node < 4; ++Node)
    {
        if (State.SceneFilter != FluidWorkspaceState::SceneFilterAll && QueryNodeCategory(Node) != State.SceneFilter) continue;
        if (!QueryMatches(State.NodeNames[Node].c_str(), State.OutlinerQuery)) continue;
        const ImVec2 Row      = Panel.Space(48.0f, 0.0f, 6.0f);
        const ImVec2 RowMin(Row.x, Row.y);
        const ImVec2 RowMax(Row.x + Panel.Width, Row.y + 48.0f);
        const bool Selected = State.Selected == Node;
        const bool NodeOn   = QueryFluidNodeEnabled(State, Node);
        DrawList->AddRectFilled(RowMin, RowMax, ResolveCssColour(Selected ? 0x232323FF : 0x161616FF), 12.0f);
        DrawList->AddRect(RowMin, RowMax, ResolveCssColour(Selected ? 0xE8C27A44 : 0xFFFFFF0C), 12.0f, ImDrawFlags_None, 1.0f);
        const ImU32 Accent = QueryNodeAccent(Node);
        const float Fade   = NodeOn ? 1.0f : 0.45f;
        DrawList->AddRectFilled(ImVec2(RowMin.x + 8.0f, RowMin.y + 11.0f), ImVec2(RowMin.x + 32.0f, RowMin.y + 37.0f),
                                FadeColour(ResolveAlpha(Accent, 0.16f), Fade), 7.0f);
        (void)GlyphSymbol::Construct(DrawList, QueryNodeGlyph(State, Node), ImVec2(RowMin.x + 13.0f, RowMin.y + 16.5f), 11.0f,
                                     1.8f, FadeColour(Accent, Fade));
        Panel.Text(Faces.Medium, 12.0f, RowMin.x + 40.0f, RowMin.y + 6.0f, 1.3f,
                   FadeColour(ResolveCssColour(0xEFEFEFFF), Fade), State.NodeNames[Node].c_str());
        char Sub[64]{};
        if (Node == FluidWorkspaceState::SelectedDomain)
        {
            std::snprintf(Sub, sizeof(Sub), "%d³ grid · staged volume", State.Parameters.GridResolution);
        }
        else if (Node == FluidWorkspaceState::SelectedEmitter)
        {
            std::snprintf(Sub, sizeof(Sub), "%s", NodeOn ? "Continuous emission" : "Emission off");
        }
        else if (Node == FluidWorkspaceState::SelectedCollider)
        {
            static const char* Shorts[6] = { "No collider", "Sphere", "Pier", "Cylinder", "Slab", "Ring" };
            const int Type               = State.Parameters.ObstacleType >= 0 && State.Parameters.ObstacleType <= 5
                                               ? State.Parameters.ObstacleType
                                               : 0;
            std::snprintf(Sub, sizeof(Sub), "%s", Shorts[Type]);
        }
        else
        {
            char Figure[24]{};
            FormatFluidTrimmed(State.Parameters.SunIntensity, 1, Figure, sizeof(Figure));
            if (NodeOn) std::snprintf(Sub, sizeof(Sub), "%s intensity", Figure);
            else std::snprintf(Sub, sizeof(Sub), "Light off");
        }
        Panel.Text(Faces.Regular, 10.0f, RowMin.x + 40.0f, RowMin.y + 25.0f, 1.4f,
                   FadeColour(ResolveCssColour(0x848484FF), Fade), Sub);

        ImGui::PushID(Node);
        if (Node == FluidWorkspaceState::SelectedDomain)
        {
            const float BadgeWide = Panel.Measure(Faces.SemiBold, 9.0f, "VOLUME", 0.9f) + 14.0f;
            const ImVec2 BadgeMax(RowMax.x - 10.0f, RowMin.y + 35.0f);
            const ImVec2 BadgeMin(BadgeMax.x - BadgeWide, RowMin.y + 13.0f);
            DrawList->AddRectFilled(BadgeMin, BadgeMax, ResolveCssColour(0x9AA3A822), 11.0f);
            Panel.Text(Faces.SemiBold, 9.0f, BadgeMin.x + 7.0f, RowMin.y + 24.0f - 0.5f * 9.0f * 1.4f, 1.4f,
                       ResolveCssColour(0x9AA3A8FF), "VOLUME", 0.9f);
        }
        else
        {
            // 📝 The eye submits before the row so it wins its own presses within this window.
            const ImVec2 EyeMax(RowMax.x - 10.0f, RowMin.y + 36.0f);
            const ImVec2 EyeMin(EyeMax.x - 26.0f, RowMin.y + 12.0f);
            (void)GlyphSymbol::Construct(DrawList, NodeOn ? "StudioEye" : "StudioEyeOff", ImVec2(EyeMin.x + 6.0f, EyeMin.y + 5.0f),
                                         14.0f, 1.6f, ResolveCssColour(NodeOn ? 0xBCBCBCFF : 0x5E5E5EFF));
            char EyeTag[48]{};
            std::snprintf(EyeTag, sizeof(EyeTag), "Outliner/Eye%d", Node);
            RecordRect(State, EyeTag, EyeMin, EyeMax);
            if (InvisibleRect("##NodeEye", EyeMin, EyeMax)) ToggleFluidWorkspaceNode(State, Node);
        }
        char RowTag[48]{};
        std::snprintf(RowTag, sizeof(RowTag), "Outliner/Row%d", Node);
        RecordRect(State, RowTag, RowMin, RowMax);
        if (InvisibleRect("##NodeRow", RowMin, RowMax)) SelectFluidWorkspaceNode(State, Node);
        ImGui::PopID();
    }

    if (Shown == 0)
    {
        const ImVec2 Empty = Panel.Space(20.0f, 4.0f, 0.0f);
        Panel.Text(Faces.Regular, 11.0f, Empty.x, Empty.y, 1.4f, ResolveCssColour(0x5E5E5EFF), "No matching nodes.");
    }
    const ImVec2 Foot = Panel.Space(16.0f, 6.0f, 0.0f);
    Panel.Text(Faces.Regular, 10.0f, Foot.x, Foot.y, 1.4f, ResolveCssColour(0x5E5E5EFF), "Static shell · nodes stage locally");
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    PRESET LIBRARY
//------------------------------------------------------------------------------------------------------------------------

void ConstructLibraryPanel(FluidWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Min, ImVec2 Max,
                         AssetBrowserLink* Link)
{
    ImDrawList* const DrawList = ImGui::GetWindowDrawList();
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x121212FF), 22.0f);
    DrawList->AddRect(Min, Max, ResolveCssColour(0xFFFFFF0E), 22.0f, ImDrawFlags_None, 1.0f);
    PanelCursor Panel{ DrawList, &Faces, 1.0f, Min.x + 14.0f, Max.x - Min.x - 28.0f, Min.y + 12.0f };

    // 📝 The 18-row plume gallery moved out to the shared Asset Browser; the panel keeps its chrome and hands off.
    char Heading[48]{};
    std::snprintf(Heading, sizeof(Heading), "Plume Library \u00B7 %d presets", QueryFluidPresetCount());
    const ImVec2 Head = Panel.Space(22.0f);
    Panel.Text(Faces.Light, 13.5f, Head.x, Head.y, 1.4f, ResolveCssColour(0xDADADADA), Heading, -0.2f);
    {
        const ImVec2 Browse = Panel.Space(64.0f, 8.0f, 0.0f);
        const ImVec2 BrowseMin(Browse.x, Browse.y);
        const ImVec2 BrowseMax(Browse.x + Panel.Width, Browse.y + 64.0f);
        DrawList->AddRectFilled(BrowseMin, BrowseMax, ResolveCssColour(0x1A1A1AFF), 14.0f);
        DrawList->AddRect(BrowseMin, BrowseMax, ResolveCssColour(0xE8C27A66), 14.0f, ImDrawFlags_None, 1.0f);
        Panel.Text(Faces.Medium, 12.5f, BrowseMin.x + 14.0f, BrowseMin.y + 9.0f, 1.3f, ResolveCssColour(0xE8C27AFF),
                   "Browse plume presets\u2026");
        Panel.Text(Faces.Regular, 10.0f, BrowseMin.x + 14.0f, BrowseMin.y + 33.0f, 1.4f, ResolveCssColour(0x848484FF),
                   "18 presets \u00B7 opens the shared Asset Browser");
        Panel.Text(Faces.Medium, 13.0f, BrowseMax.x - 30.0f, BrowseMin.y + 19.0f, 1.3f, ResolveCssColour(0xE8C27AFF),
                   "\u2197");
        RecordRect(State, "Library/Browse", BrowseMin, BrowseMax);
        if (InvisibleRect("##LibraryBrowse", BrowseMin, BrowseMax))
        {
            if (Link != nullptr)
            {
                Link->OpenRequested = true;
                Link->OpenWorkspace = AssetBrowserWorkspaceFluid;
            }
            else Toast::Show("The Asset Browser is not attached in this shell.");
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    VIEWPORT BAR
//------------------------------------------------------------------------------------------------------------------------

void ConstructViewportBar(FluidWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 Min, ImVec2 Max)
{
    // 📝 Icon-only keys, like the prototype's icon-button bar; the two selects split whatever width remains.
    constexpr float KeyBox  = 40.0f;
    constexpr float Gap     = 8.0f;
    constexpr float Pad     = 12.0f;
    const float     Fixed   = Pad + Gap + KeyBox + Gap + KeyBox + Gap + Gap + KeyBox + Gap + KeyBox + Gap + KeyBox + Pad;
    const float     Avail   = Max.x - Min.x;
    float           CamWide = 180.0f;
    float           ChanWide = 210.0f;
    if (Fixed + CamWide + Gap + ChanWide > Avail)
    {
        const float Selects = Avail - Fixed - Gap;
        CamWide             = Selects * 180.0f / 390.0f;
        ChanWide            = Selects - CamWide;
        if (CamWide < 110.0f) CamWide = 110.0f;
        if (ChanWide < 130.0f) ChanWide = 130.0f;
    }
    static const char* Cameras[4] = { "Perspective", "Front", "Side", "Top" };
    ConstructBarSelect(State, Faces, DrawList, "CameraView", "Viewport/Camera", "Camera", Cameras, 4, State.Camera,
                       ImVec2(Min.x + Pad, Min.y + 8.0f), CamWide);

    auto BarKey = [&](const char* Id, const char* RectTag, const char* Glyph, ImVec2 KeyMin, bool Active) -> std::pair<bool, float> {
        const ImVec2 KeyMax(KeyMin.x + KeyBox, KeyMin.y + 29.0f);
        DrawList->AddRectFilled(KeyMin, KeyMax, ResolveCssColour(Active ? 0xE8C27AFF : 0x0E0F12D6), 10.0f);
        DrawList->AddRect(KeyMin, KeyMax, ResolveCssColour(Active ? 0xE8C27AFF : 0xFFFFFF12), 10.0f, ImDrawFlags_None, 1.0f);
        (void)GlyphSymbol::Construct(DrawList, Glyph, ImVec2(KeyMin.x + 14.0f, KeyMin.y + 8.5f), 12.0f, 1.8f,
                                     ResolveCssColour(Active ? 0x1A1A1AFF : 0xBCBCBCFF));
        RecordRect(State, RectTag, KeyMin, KeyMax);
        return { InvisibleRect(Id, KeyMin, KeyMax), KeyMax.x };
    };

    float KeyX = Min.x + Pad + CamWide + Gap;
    {
        const auto [Pressed, Next] = BarKey("##Flipbook", "Viewport/Flipbook", "StudioArchive", ImVec2(KeyX, Min.y + 8.0f), false);
        if (Pressed)
        {
            State.BakeOpen  = true;
            State.BakeBurst = !State.Parameters.EmitterEnabled;
        }
        KeyX = Next + Gap;
    }
    {
        const auto [Pressed, Next] =
            BarKey("##Diagnostics", "Viewport/Diagnostics", "StudioActivity", ImVec2(KeyX, Min.y + 8.0f), false);
        if (Pressed) NoopFluidWorkspaceCommand(State, "VIEW", "Diagnostics refused", "Diagnostics are a NOOP in this shell");
    }

    float RightX = Max.x - Pad;
    {
        const ImVec2 KeyMin(RightX - KeyBox, Min.y + 8.0f);
        const auto [Pressed, _] = BarKey("##Maximize", "Viewport/Maximize", "StudioMaximize", KeyMin, false);
        if (Pressed) NoopFluidWorkspaceCommand(State, "VIEW", "Maximize refused", "Viewport maximize is a NOOP in this shell");
        RightX = KeyMin.x - Gap;
    }
    {
        const ImVec2 KeyMin(RightX - KeyBox, Min.y + 8.0f);
        const auto [Pressed, _] = BarKey("##Focus", "Viewport/Focus", "StudioFocus", KeyMin, false);
        if (Pressed) NoopFluidWorkspaceCommand(State, "VIEW", "Focus refused", "Viewport focus is a NOOP in this shell");
        RightX = KeyMin.x - Gap;
    }
    {
        const ImVec2 KeyMin(RightX - KeyBox, Min.y + 8.0f);
        const auto [Pressed, _] = BarKey("##Overlays", "Viewport/Overlays", "StudioBoxes", KeyMin, State.Parameters.ShowBoundingBox);
        if (Pressed)
        {
            State.Parameters.ShowBoundingBox = !State.Parameters.ShowBoundingBox;
            LogFluidWorkspaceValue(State, "RENDER", "Domain bounds", State.Parameters.ShowBoundingBox ? "on" : "off");
        }
        RightX = KeyMin.x - Gap;
    }
    static const char* Channels[9] = { "Lit", "DDD Cubes", "Density", "Temperature", "Fuel", "Velocity",
                                       "Vorticity", "Pressure", "Slice" };
    ConstructBarSelect(State, Faces, DrawList, "RenderChannel", "Viewport/Channel", "Channel", Channels, 9,
                       State.Parameters.RenderChannel, ImVec2(RightX - ChanWide, Min.y + 8.0f), ChanWide, "RENDER",
                       "Render channel");
}

//------------------------------------------------------------------------------------------------------------------------

void DashedCircle(ImDrawList* DrawList, ImVec2 Centre, float Radius, ImU32 Colour, float Width, int Dashes, float Phase)
{
    if (Radius < 2.0f || Dashes <= 0) return;
    const float Step = 2.0f * PiSingle / static_cast<float>(Dashes);
    for (int Dash = 0; Dash < Dashes; ++Dash)
    {
        const float A0 = Phase + Dash * Step;
        DrawList->PathArcTo(Centre, Radius, A0, A0 + Step * 0.62f, 8);
        DrawList->PathStroke(Colour, 0, Width);
    }
}

void ConstructPlumeSurface(FluidWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 Min, ImVec2 Max)
{
    PanelCursor Surface{ DrawList, &Faces, 1.0f, Min.x, Max.x - Min.x, Min.y };
    const float Wide   = Max.x - Min.x;
    const float Tall   = Max.y - Min.y;
    const float CentreX = Min.x + Wide * 0.5f;
    const float CentreY = Min.y + Tall * 0.46f;

    if (State.Parameters.ShowFloorGrid)
    {
        constexpr float Step = 46.0f;
        for (float X = Min.x + 20.0f; X < Max.x - 8.0f; X += Step)
            DrawList->AddLine(ImVec2(X, Min.y + 8.0f), ImVec2(X, Max.y - 8.0f), ResolveCssColour(0xFFFFFF08));
        for (float Y = Min.y + 20.0f; Y < Max.y - 8.0f; Y += Step)
            DrawList->AddLine(ImVec2(Min.x + 8.0f, Y), ImVec2(Max.x - 8.0f, Y), ResolveCssColour(0xFFFFFF08));
        DrawList->AddLine(ImVec2(CentreX, Min.y + 8.0f), ImVec2(CentreX, Max.y - 8.0f), ResolveCssColour(0xFFFFFF10));
        DrawList->AddLine(ImVec2(Min.x + 8.0f, CentreY), ImVec2(Max.x - 8.0f, CentreY), ResolveCssColour(0xFFFFFF10));
    }
    if (State.Parameters.ShowVoxelGridLines)
    {
        constexpr float Step = 23.0f;
        for (float X = Min.x + 20.0f; X < Max.x - 8.0f; X += Step)
            DrawList->AddLine(ImVec2(X, Min.y + 8.0f), ImVec2(X, Max.y - 8.0f), ResolveCssColour(0x8FD3C40C));
        for (float Y = Min.y + 20.0f; Y < Max.y - 8.0f; Y += Step)
            DrawList->AddLine(ImVec2(Min.x + 8.0f, Y), ImVec2(Max.x - 8.0f, Y), ResolveCssColour(0x8FD3C40C));
        char VoxelTag[32]{};
        std::snprintf(VoxelTag, sizeof(VoxelTag), "%d³ VOXEL GRID", State.Parameters.GridResolution);
        Surface.Text(Faces.SemiBold, 9.0f, Min.x + 14.0f, Max.y - 30.0f, 1.4f, ResolveCssColour(0x8FD3C466), VoxelTag, 0.9f);
    }
    if (State.Parameters.ShowBoundingBox)
    {
        const ImVec2 BoxMin(CentreX - Wide * 0.31f, CentreY - Tall * 0.30f);
        const ImVec2 BoxMax(CentreX + Wide * 0.31f, CentreY + Tall * 0.30f);
        DrawList->AddRect(BoxMin, BoxMax, ResolveCssColour(0xE8C27A33), 6.0f, ImDrawFlags_None, 1.0f);
        constexpr float Tick = 10.0f;
        DrawList->AddLine(BoxMin, ImVec2(BoxMin.x + Tick, BoxMin.y), ResolveCssColour(0xE8C27A99), 2.0f);
        DrawList->AddLine(BoxMin, ImVec2(BoxMin.x, BoxMin.y + Tick), ResolveCssColour(0xE8C27A99), 2.0f);
        DrawList->AddLine(ImVec2(BoxMax.x, BoxMin.y), ImVec2(BoxMax.x - Tick, BoxMin.y), ResolveCssColour(0xE8C27A99), 2.0f);
        DrawList->AddLine(ImVec2(BoxMax.x, BoxMin.y), ImVec2(BoxMax.x, BoxMin.y + Tick), ResolveCssColour(0xE8C27A99), 2.0f);
        DrawList->AddLine(ImVec2(BoxMin.x, BoxMax.y), ImVec2(BoxMin.x + Tick, BoxMax.y), ResolveCssColour(0xE8C27A99), 2.0f);
        DrawList->AddLine(ImVec2(BoxMin.x, BoxMax.y), ImVec2(BoxMin.x, BoxMax.y - Tick), ResolveCssColour(0xE8C27A99), 2.0f);
        DrawList->AddLine(BoxMax, ImVec2(BoxMax.x - Tick, BoxMax.y), ResolveCssColour(0xE8C27A99), 2.0f);
        DrawList->AddLine(BoxMax, ImVec2(BoxMax.x, BoxMax.y - Tick), ResolveCssColour(0xE8C27A99), 2.0f);
        char Bounds[48]{};
        FormatFluidBounds(State.Parameters.BoundsWidth, State.Parameters.BoundsHeight, Bounds, sizeof(Bounds));
        char BoxTag[72]{};
        std::snprintf(BoxTag, sizeof(BoxTag), "DOMAIN %s", Bounds);
        Surface.Text(Faces.SemiBold, 9.0f, BoxMin.x, BoxMax.y + 5.0f, 1.4f, ResolveCssColour(0xE8C27A66), BoxTag, 0.9f);
    }

    // 📝 Plume markers: emitter flame, collider ring, sun glyph. Static decor at staged positions.
    const ImVec2 EmitterAt(CentreX - 120.0f, CentreY + 78.0f);
    const float EmitterFade = State.Parameters.EmitterEnabled ? 1.0f : 0.35f;
    DashedCircle(DrawList, EmitterAt, static_cast<float>(30.0 + State.Parameters.EmitterRadius * 400.0),
                 FadeColour(ResolveCssColour(0xE8823C55), EmitterFade), 1.0f, 26, 0.0f);
    (void)GlyphSymbol::Construct(DrawList, State.Parameters.EmitterFuel == 0.0 ? "StudioPuff" : "StudioFlame",
                                 ImVec2(EmitterAt.x - 8.0f, EmitterAt.y - 8.0f), 16.0f, 1.8f,
                                 FadeColour(ResolveCssColour(0xE8823CFF), EmitterFade));
    Surface.Text(Faces.Medium, 11.0f, EmitterAt.x + 14.0f, EmitterAt.y - 8.0f, 1.38f,
                 FadeColour(ResolveCssColour(0xD8D8D8FF), EmitterFade), State.NodeNames[1].c_str());
    if (State.Parameters.ObstacleType > 0)
    {
        const ImVec2 ColliderAt(CentreX + (State.Parameters.ObstacleX - 0.5) * Wide * 0.5f,
                                CentreY + (0.5 - State.Parameters.ObstacleY) * Tall * 0.5f);
        DashedCircle(DrawList, ColliderAt, static_cast<float>(20.0 + State.Parameters.ObstacleRadius * 300.0),
                     ResolveCssColour(0xB48FE855), 1.0f, 30, 0.4f);
        DrawList->AddCircleFilled(ColliderAt, 3.0f, ResolveCssColour(0xB48FE8FF), 16);
        Surface.Text(Faces.Medium, 11.0f, ColliderAt.x + 12.0f, ColliderAt.y - 8.0f, 1.38f, ResolveCssColour(0xD8D8D8FF),
                     State.NodeNames[2].c_str());
    }
    const float SunFade = State.Parameters.SunIntensity > 0.0 ? 1.0f : 0.35f;
    const ImVec2 SunAt(Max.x - 150.0f, Min.y + 110.0f);
    (void)GlyphSymbol::Construct(DrawList, "StudioSun", ImVec2(SunAt.x - 8.0f, SunAt.y - 8.0f), 16.0f, 1.8f,
                                 FadeColour(ResolveCssColour(0xE8C27AFF), SunFade));
    Surface.Text(Faces.Medium, 11.0f, SunAt.x + 14.0f, SunAt.y - 8.0f, 1.38f,
                 FadeColour(ResolveCssColour(0xD8D8D8FF), SunFade), State.NodeNames[3].c_str());

    // 📝 Caption: live pill + staged object + subtitle.
    const bool Live = !State.Parameters.Paused;
    const ImVec2 PillMin(Min.x + 14.0f, Min.y + 12.0f);
    const float PillWide = Surface.Measure(Faces.SemiBold, 10.0f, Live ? "LIVE" : "PAUSED", 0.9f) + 30.0f;
    DrawList->AddRectFilled(PillMin, ImVec2(PillMin.x + PillWide, PillMin.y + 24.0f),
                            ResolveCssColour(Live ? 0x2E7D3222 : 0xE8C27A22), 12.0f);
    DrawList->AddCircleFilled(ImVec2(PillMin.x + 12.0f, PillMin.y + 12.0f), 4.0f,
                              ResolveCssColour(Live ? 0x7FD08AFF : 0xE8C27AFF), 16);
    Surface.Text(Faces.SemiBold, 10.0f, PillMin.x + 21.0f, PillMin.y + 12.0f - 0.5f * 10.0f * 1.4f, 1.4f,
                 ResolveCssColour(Live ? 0x7FD08AFF : 0xE8C27AFF), Live ? "LIVE" : "PAUSED", 0.9f);
    Surface.Text(Faces.Medium, 12.5f, Min.x + 14.0f, PillMin.y + 28.0f, 1.35f, ResolveCssColour(0xEFEFEFFF),
                 State.NodeNames[State.Selected].c_str());
    Surface.Text(Faces.Regular, 10.5f, Min.x + 14.0f, PillMin.y + 48.0f, 1.4f, ResolveCssColour(0x848484FF),
                 "Eulerian volume · physically shaded");

    char GridTag[32]{};
    std::snprintf(GridTag, sizeof(GridTag), "%d³ GRID", State.Parameters.GridResolution);
    const float GridWide = Surface.Measure(Faces.SemiBold, 10.0f, GridTag, 0.9f) + 20.0f;
    const ImVec2 GridMax(Max.x - 14.0f, Min.y + 36.0f);
    const ImVec2 GridMin(GridMax.x - GridWide, Min.y + 12.0f);
    DrawList->AddRectFilled(GridMin, GridMax, ResolveCssColour(0x0E0F12D6), 12.0f);
    Surface.Text(Faces.SemiBold, 10.0f, GridMin.x + 10.0f, Min.y + 24.0f - 0.5f * 10.0f * 1.4f, 1.4f,
                 ResolveCssColour(0xBCBCBCFF), GridTag, 0.9f);
    Surface.Text(Faces.Regular, 10.5f, GridMin.x - 62.0f, Min.y + 24.0f - 0.5f * 10.5f * 1.4f, 1.4f,
                 ResolveCssColour(0x5E5E5EFF), "— FPS");

    // 📝 Viewport tools: orbit / source brush / place burst + turntable. Tools are silent; turntable logs.
    static const char* ToolGlyphs[3] = { "StudioOrbit", "StudioJet", "StudioBlast" };
    static const char* ToolTags[3]   = { "Surface/Tool0", "Surface/Tool1", "Surface/Tool2" };
    float ToolX                      = Min.x + 14.0f;
    const float ToolY                = Max.y - 48.0f;
    for (int Tool = 0; Tool < 3; ++Tool)
    {
        const ImVec2 KeyMin(ToolX, ToolY);
        const ImVec2 KeyMax(ToolX + 34.0f, ToolY + 34.0f);
        const bool Active = State.Tool == Tool;
        DrawList->AddRectFilled(KeyMin, KeyMax, ResolveCssColour(Active ? 0xE8C27AFF : 0x0E0F12D6), 10.0f);
        DrawList->AddRect(KeyMin, KeyMax, ResolveCssColour(Active ? 0xE8C27AFF : 0xFFFFFF12), 10.0f, ImDrawFlags_None, 1.0f);
        (void)GlyphSymbol::Construct(DrawList, ToolGlyphs[Tool], ImVec2(KeyMin.x + 10.0f, KeyMin.y + 10.0f), 14.0f, 1.8f,
                                     ResolveCssColour(Active ? 0x1A1A1AFF : 0xBCBCBCFF));
        ImGui::PushID(300 + Tool);
        RecordRect(State, ToolTags[Tool], KeyMin, KeyMax);
        if (InvisibleRect("##Tool", KeyMin, KeyMax)) State.Tool = Tool;
        ImGui::PopID();
        ToolX = KeyMax.x + 8.0f;
    }
    {
        const ImVec2 KeyMin(ToolX + 8.0f, ToolY);
        const ImVec2 KeyMax(ToolX + 42.0f, ToolY + 34.0f);
        const bool Active = State.Parameters.AutoTurntable;
        DrawList->AddRectFilled(KeyMin, KeyMax, ResolveCssColour(Active ? 0xE8C27AFF : 0x0E0F12D6), 10.0f);
        DrawList->AddRect(KeyMin, KeyMax, ResolveCssColour(Active ? 0xE8C27AFF : 0xFFFFFF12), 10.0f, ImDrawFlags_None, 1.0f);
        (void)GlyphSymbol::Construct(DrawList, "StudioSwirl", ImVec2(KeyMin.x + 10.0f, KeyMin.y + 10.0f), 14.0f, 1.8f,
                                     ResolveCssColour(Active ? 0x1A1A1AFF : 0xBCBCBCFF));
        RecordRect(State, "Surface/Turntable", KeyMin, KeyMax);
        if (InvisibleRect("##Turntable", KeyMin, KeyMax))
        {
            State.Parameters.AutoTurntable = !State.Parameters.AutoTurntable;
            LogFluidWorkspaceValue(State, "VIEW", "Turntable", State.Parameters.AutoTurntable ? "on" : "off");
        }
    }
    Surface.Text(Faces.Regular, 10.5f, Max.x - 14.0f - Surface.Measure(Faces.Regular, 10.5f, "Drag to orbit (local)"),
                 Max.y - 40.0f, 1.4f, ResolveCssColour(0x5E5E5EFF), "Drag to orbit (local)");

    // 📝 Orbit drag is local and silent; the stage never simulates.
    ImGui::PushID("PlumeOrbit");
    RecordRect(State, "Surface/Plume", Min, Max);
    ImGui::SetCursorScreenPos(Min);
    ImGui::InvisibleButton("##PlumeOrbit", ImVec2(Wide, Tall), ImGuiButtonFlags_EnableNav);
    if (ImGui::IsItemActive() && ImGui::IsMouseDragging(ImGuiMouseButton_Left))
    {
        const ImVec2 Delta = ImGui::GetIO().MouseDelta;
        State.OrbitYaw -= Delta.x * 0.25;
        State.OrbitPitch += Delta.y * 0.2;
        if (State.OrbitPitch < 2.0) State.OrbitPitch = 2.0;
        if (State.OrbitPitch > 86.0) State.OrbitPitch = 86.0;
    }
    ImGui::PopID();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    TRANSPORT + TIMELINE
//------------------------------------------------------------------------------------------------------------------------

void ConstructTransportStrip(FluidWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 Min, ImVec2 Max)
{
    PanelCursor Strip{ DrawList, &Faces, 1.0f, Min.x, Max.x - Min.x, Min.y };
    DrawList->AddLine(ImVec2(Min.x, Min.y), ImVec2(Max.x, Min.y), ResolveCssColour(0xFFFFFF12));

    auto RoundKey = [&](const char* Id, const char* RectTag, const char* Glyph, ImVec2 KeyMin, ImU32 Ring) {
        const ImVec2 KeyMax(KeyMin.x + 34.0f, KeyMin.y + 34.0f);
        const ImVec2 Centre(KeyMin.x + 17.0f, KeyMin.y + 17.0f);
        DrawList->AddCircleFilled(Centre, 17.0f, ResolveCssColour(0x1A1A1AFF), 32);
        DrawList->AddCircle(Centre, 17.0f, Ring, 32, 1.0f);
        (void)GlyphSymbol::Construct(DrawList, Glyph, ImVec2(KeyMin.x + 10.5f, KeyMin.y + 10.5f), 13.0f, 1.8f,
                                     ResolveCssColour(0xD8D8D8FF));
        RecordRect(State, RectTag, KeyMin, KeyMax);
        return InvisibleRect(Id, KeyMin, KeyMax);
    };

    float KeyX = Min.x + 14.0f;
    const float KeyY = Min.y + 15.0f;
    if (RoundKey("##TransportReset", "Transport/Reset", "StudioReset", ImVec2(KeyX, KeyY), ResolveCssColour(0xFFFFFF24)))
        NoopFluidWorkspaceCommand(State, "TRANSPORT", "Reset simulation refused", "Reset is a NOOP in this shell");
    KeyX += 42.0f;
    if (RoundKey("##TransportPlay", "Transport/Play", State.Parameters.Paused ? "StudioPlay" : "StudioPause",
                 ImVec2(KeyX, KeyY), ResolveCssColour(0xE8C27A66)))
        State.Parameters.Paused = !State.Parameters.Paused;
    KeyX += 42.0f;
    if (RoundKey("##TransportStep", "Transport/Step", "StudioStep", ImVec2(KeyX, KeyY), ResolveCssColour(0xFFFFFF24)))
        NoopFluidWorkspaceCommand(State, "TRANSPORT", "Single step refused", "Stepping is a NOOP in this shell");
    KeyX += 52.0f;

    Strip.Text(Faces.Monospace, 13.0f, KeyX, Min.y + 32.0f - 0.5f * 13.0f * 1.4f, 1.4f, ResolveCssColour(0xD8D8D8FF),
               "00:00.000");
    KeyX += Strip.Measure(Faces.Monospace, 13.0f, "00:00.000") + 16.0f;
    static const char* Speeds[4]   = { "0.25×", "0.5×", "1.0×", "2.0×" };
    static const double SpeedValue[4] = { 0.25, 0.5, 1.0, 2.0 };
    ConstructBarSelect(State, Faces, DrawList, "Speed", "Transport/Speed", "Speed", Speeds, 4, State.SpeedIndex,
                       ImVec2(KeyX, Min.y + 17.0f), 112.0f);
    State.Parameters.TimeScale = SpeedValue[State.SpeedIndex];
    KeyX += 112.0f + 16.0f;
    DrawList->AddCircleFilled(ImVec2(KeyX + 5.0f, Min.y + 32.0f), 4.0f, ResolveCssColour(0x7FD08AFF), 16);
    Strip.Text(Faces.Regular, 11.0f, KeyX + 14.0f, Min.y + 32.0f - 0.5f * 11.0f * 1.4f, 1.4f, ResolveCssColour(0x848484FF),
               "Live / uncached");

    const float TriggerWide = Strip.Measure(Faces.Medium, 11.5f, "Trigger") + 52.0f;
    const ImVec2 TriggerMax(Max.x - 14.0f, Min.y + 49.0f);
    const ImVec2 TriggerMin(TriggerMax.x - TriggerWide, Min.y + 15.0f);
    DrawList->AddRectFilled(TriggerMin, TriggerMax, ResolveCssColour(0xE8823CFF), 17.0f);
    (void)GlyphSymbol::Construct(DrawList, "StudioBlast", ImVec2(TriggerMin.x + 12.0f, TriggerMin.y + 10.0f), 14.0f, 1.8f,
                                 ResolveCssColour(0x1A1A1AFF));
    Strip.Text(Faces.Medium, 11.5f, TriggerMin.x + 32.0f, Min.y + 32.0f - 0.5f * 11.5f * 1.38f, 1.38f,
               ResolveCssColour(0x1A1A1AFF), "Trigger");
    RecordRect(State, "Transport/Trigger", TriggerMin, TriggerMax);
    if (InvisibleRect("##Trigger", TriggerMin, TriggerMax))
        NoopFluidWorkspaceCommand(State, "TRANSPORT", "Trigger burst refused", "Trigger is a NOOP in this shell");

    static const char* Bursts[5] = { "Single burst", "Shrapnel", "Cluster salvo", "Colliding waves", "Mushroom cloud" };
    ConstructBarSelect(State, Faces, DrawList, "BurstKind", "Transport/BurstKind", "Burst", Bursts, 5, State.BurstKind,
                       ImVec2(TriggerMin.x - 8.0f - 196.0f, Min.y + 17.0f), 196.0f);
}

void ConstructTimeline(FluidWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 Min, ImVec2 Max)
{
    PanelCursor Line{ DrawList, &Faces, 1.0f, Min.x, Max.x - Min.x, Min.y };
    DrawList->AddLine(ImVec2(Min.x, Min.y), ImVec2(Max.x, Min.y), ResolveCssColour(0xFFFFFF12));
    Line.Text(Faces.SemiBold, 10.0f, Min.x + 14.0f, Min.y + 10.0f, 1.4f, ResolveCssColour(0x848484FF), "SIMULATION", 0.9f);
    Line.Text(Faces.Monospace, 10.5f, Min.x + 118.0f, Min.y + 10.0f, 1.4f, ResolveCssColour(0x5E5E5EFF), "FRAME 0000");

    const float RulerLeft  = Min.x + 14.0f;
    const float RulerRight = Max.x - 14.0f;
    const float RulerY     = Min.y + 34.0f;
    DrawList->AddLine(ImVec2(RulerLeft, RulerY), ImVec2(RulerRight, RulerY), ResolveCssColour(0xFFFFFF18));
    for (int Second = 0; Second <= 30; ++Second)
    {
        const float X     = RulerLeft + (RulerRight - RulerLeft) * Second / 30.0f;
        const bool  Major = Second % 5 == 0;
        DrawList->AddLine(ImVec2(X, RulerY), ImVec2(X, RulerY + (Major ? 7.0f : 4.0f)),
                          ResolveCssColour(Major ? 0xFFFFFF2E : 0xFFFFFF14));
        if (Major)
        {
            char Tick[8]{};
            std::snprintf(Tick, sizeof(Tick), "%ds", Second);
            Line.Text(Faces.Regular, 9.0f, X - Line.Measure(Faces.Regular, 9.0f, Tick) * 0.5f, RulerY + 8.0f, 1.4f,
                      ResolveCssColour(0x5E5E5EFF), Tick);
        }
    }
    const ImVec2 TrackMin(RulerLeft, RulerY + 26.0f);
    const ImVec2 TrackMax(RulerRight, RulerY + 48.0f);
    DrawList->AddRectFilled(TrackMin, TrackMax, ResolveCssColour(0x1E1E1EFF), 11.0f);
    DrawList->AddCircleFilled(ImVec2(TrackMin.x + 14.0f, RulerY + 37.0f), 3.0f,
                              ResolveCssColour(State.Parameters.EmitterEnabled ? 0xE8823CFF : 0x5E5E5EFF), 12);
    Line.Text(Faces.Regular, 10.5f, TrackMin.x + 24.0f, RulerY + 37.0f - 0.5f * 10.5f * 1.4f, 1.4f,
              ResolveCssColour(0xBCBCBCFF),
              State.Parameters.EmitterEnabled ? "Continuous emission" : "Burst-only simulation");
    DrawList->AddLine(ImVec2(RulerLeft, RulerY - 4.0f), ImVec2(RulerLeft, TrackMax.y), ResolveCssColour(0xE8C27AFF), 2.0f);
    DrawList->AddCircleFilled(ImVec2(RulerLeft, RulerY - 4.0f), 4.0f, ResolveCssColour(0xE8C27AFF), 12);

    RecordRect(State, "Timeline/Ruler", ImVec2(RulerLeft, RulerY - 6.0f), ImVec2(RulerRight, TrackMax.y));
    if (InvisibleRect("##TimelineRuler", ImVec2(RulerLeft, RulerY - 6.0f), ImVec2(RulerRight, TrackMax.y)))
        NoopFluidWorkspaceCommand(State, "TRANSPORT", "Scrub refused", "The timeline is live, not seekable");
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    LOG DRAWER
//------------------------------------------------------------------------------------------------------------------------

void ConstructLogDrawer(FluidWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Min, ImVec2 Max)
{
    ImDrawList* const DrawList = ImGui::GetWindowDrawList();
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x121212FF), 22.0f);
    DrawList->AddRect(Min, Max, ResolveCssColour(0xFFFFFF0E), 22.0f, ImDrawFlags_None, 1.0f);

    PanelCursor Panel{ DrawList, &Faces, 1.0f, Min.x, Max.x - Min.x, Min.y };
    const ImVec2 Head = Panel.Space(44.0f);
    DrawList->AddLine(ImVec2(Min.x, Head.y + 44.0f), ImVec2(Max.x, Head.y + 44.0f), ResolveCssColour(0xFFFFFF12));
    float TitleX = Panel.Text(Faces.Light, 13.5f, Min.x + 16.0f, Head.y + 22.0f - 0.5f * 13.5f * 1.4f, 1.4f,
                              ResolveCssColour(0xDADADADA), "Log Stream", -0.2f);
    TitleX += Min.x + 16.0f + 7.0f;
    const float ShellWide = Panel.Measure(Faces.Regular, 9.0f, "SHELL") + 14.0f;
    DrawList->AddRectFilled(ImVec2(TitleX, Head.y + 13.0f), ImVec2(TitleX + ShellWide, Head.y + 31.0f), ResolveCssColour(0xE8C27A24),
                            9.0f);
    Panel.Text(Faces.Regular, 9.0f, TitleX + 7.0f, Head.y + 22.0f - 0.5f * 9.0f * 1.4f, 1.4f, ResolveCssColour(0xE8C27AFF), "SHELL");
    const float ClearWide = Panel.Measure(Faces.Medium, 11.0f, "Clear") + 18.0f;
    const ImVec2 ClearMax(Max.x - 16.0f, Head.y + 35.0f);
    const ImVec2 ClearMin(ClearMax.x - ClearWide, Head.y + 9.0f);
    Panel.Text(Faces.Medium, 11.0f, ClearMin.x + 9.0f, Head.y + 22.0f - 0.5f * 11.0f * 1.38f, 1.38f, ResolveCssColour(0xBCBCBCFF),
               "Clear");
    ImGui::PushID("LogDrawer");
    RecordRect(State, "Log/Clear", ClearMin, ClearMax);
    if (InvisibleRect("##LogClear", ClearMin, ClearMax)) State.Log.clear();

    ImGui::SetCursorScreenPos(ImVec2(Min.x, Head.y + 44.0f));
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0, 0, 0));
    ImGui::BeginChild("##LogScroll", ImVec2(Max.x - Min.x, Max.y - Head.y - 44.0f), false,
                      ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
    ImDrawList* const InnerList = ImGui::GetWindowDrawList();
    PanelCursor       Content{ InnerList, &Faces, 1.0f, Min.x + 12.0f, Max.x - Min.x - 24.0f, Head.y + 44.0f + 12.0f };
    for (const FluidWorkspaceLogEntry& Entry : State.Log)
    {
        const ImVec2 Row = Content.Space(23.0f);
        InnerList->AddLine(ImVec2(Row.x, Row.y + 23.0f), ImVec2(Row.x + Content.Width, Row.y + 23.0f),
                           ResolveCssColour(0xFFFFFF0A));
        Content.Text(Faces.Monospace, 11.0f, Row.x + 4.0f, Row.y + 4.0f, 1.4f, ResolveCssColour(0x5E5E5EFF), Entry.When.c_str());
        Content.Text(Faces.SemiBold, 10.0f, Row.x + 4.0f + 66.0f, Row.y + 5.0f, 1.4f, ResolveCssColour(0xE8C27AFF),
                     Entry.Channel.c_str());
        char Line[320]{};
        if (Entry.Detail.empty()) std::snprintf(Line, sizeof(Line), "%s", Entry.Message.c_str());
        else std::snprintf(Line, sizeof(Line), "%s · %s", Entry.Message.c_str(), Entry.Detail.c_str());
        // 📝 NOOP lines read warm so refused commands stand out from staged values.
        const bool Noop = Entry.Detail == "NOOP in this shell";
        Content.Text(Faces.Regular, 11.0f, Row.x + 4.0f + 142.0f, Row.y + 4.0f, 1.4f,
                     ResolveCssColour(Noop ? 0xE8C27AFF : 0x848484FF), Line);
    }
    ImGui::SetCursorScreenPos(ImVec2(Content.X, Content.Y));
    ImGui::Dummy(ImVec2(1.0f, 1.0f));
    ImGui::EndChild();
    ImGui::PopStyleColor();
    ImGui::PopID();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    BAKE DIALOG
//------------------------------------------------------------------------------------------------------------------------

void ConstructBakeDialog(FluidWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 RootMin, ImVec2 RootMax)
{
    if (!State.BakeOpen) return;
    ImDrawList* const DrawList = ImGui::GetWindowDrawList();
    DrawList->AddRectFilled(RootMin, RootMax, ResolveCssColour(0x050507C2));
    ImGui::PushID("BakeVeil");

    const float SheetWide = 620.0f;
    const float SheetTall = 560.0f;
    const ImVec2 SheetMin(0.5f * (RootMin.x + RootMax.x - SheetWide), 0.5f * (RootMin.y + RootMax.y - SheetTall));
    const ImVec2 SheetMax(SheetMin.x + SheetWide, SheetMin.y + SheetTall);
    DrawList->AddRectFilled(SheetMin, SheetMax, ResolveCssColour(0x121212FF), 24.0f);
    DrawList->AddRect(SheetMin, SheetMax, ResolveCssColour(0xFFFFFF24), 24.0f, ImDrawFlags_None, 1.0f);
    bool CloseClicked = false;
    bool BakeClicked  = false;

    // 📝 Like the U2 sheets, the dialog content lives in its own child window so its keys receive presses.
    ImGui::SetCursorScreenPos(ImVec2(SheetMin.x + 24.0f, SheetMin.y + 20.0f));
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0, 0, 0));
    ImGui::BeginChild("##BakeScroll", ImVec2(SheetWide - 48.0f, SheetTall - 40.0f), false,
                      ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
    ImDrawList* const DialogList = ImGui::GetWindowDrawList();
    PanelCursor Dialog{ DialogList, &Faces, 1.0f, SheetMin.x + 24.0f, SheetWide - 48.0f, SheetMin.y + 20.0f };

    const ImVec2 Head = Dialog.Space(30.0f, 0.0f, 2.0f);
    (void)GlyphSymbol::Construct(DialogList, "StudioGrid", ImVec2(Head.x, Head.y + 4.0f), 20.0f, 1.8f,
                                 ResolveCssColour(0xE8823CFF));
    Dialog.Text(Faces.Light, 18.0f, Head.x + 30.0f, Head.y + 15.0f - 0.5f * 18.0f * 1.3f, 1.3f,
                ResolveCssColour(0xF4F4F4FF), "Bake flipbook", -0.3f);
    const ImVec2 CloseMax(Head.x + Dialog.Width, Head.y + 30.0f);
    const ImVec2 CloseMin(CloseMax.x - 30.0f, Head.y);
    DialogList->AddCircleFilled(ImVec2(CloseMin.x + 15.0f, CloseMin.y + 15.0f), 15.0f, ResolveCssColour(0x1A1A1AFF), 32);
    DialogList->AddCircle(ImVec2(CloseMin.x + 15.0f, CloseMin.y + 15.0f), 15.0f, ResolveCssColour(0xFFFFFF24), 32, 1.0f);
    (void)GlyphSymbol::Construct(DialogList, "StudioClose", ImVec2(CloseMin.x + 8.5f, CloseMin.y + 8.5f), 13.0f, 1.8f,
                                 ResolveCssColour(0xEFEFEFFF));
    RecordRect(State, "Bake/Close", CloseMin, CloseMax);
    if (InvisibleRect("##BakeClose", CloseMin, CloseMax)) CloseClicked = true;

    Dialog.Text(Faces.Medium, 12.0f, Head.x, Dialog.Y, 1.4f, ResolveCssColour(0xE8C27AFF), "Pyro plume");
    Dialog.Y += 20.0f;
    Dialog.Text(Faces.Regular, 11.0f, Head.x, Dialog.Y, 1.5f, ResolveCssColour(0x848484FF),
                "Bake a fresh simulation from this scene's settings, with the current");
    Dialog.Y += 17.0f;
    Dialog.Text(Faces.Regular, 11.0f, Head.x, Dialog.Y, 1.5f, ResolveCssColour(0x848484FF),
                "camera locked to square framing. The live scene is held, not cleared.");
    Dialog.Y += 26.0f;

    static const char* Counts[4] = { "4", "16", "32", "64" };
    static const int   CountValue[4] = { 4, 16, 32, 64 };
    static const char* Sizes[4]  = { "64 × 64", "128 × 128", "256 × 256", "512 × 512" };
    static const int   SizeValue[4]  = { 64, 128, 256, 512 };
    static const char* Rates[4]  = { "12", "24", "30", "60" };
    static const int   RateValue[4]  = { 12, 24, 30, 60 };
    int CountIndex = 1;
    int SizeIndex  = 2;
    int RateIndex  = 1;
    for (int Index = 0; Index < 4; ++Index)
    {
        if (CountValue[Index] == State.BakeCount) CountIndex = Index;
        if (SizeValue[Index] == State.BakeSize) SizeIndex = Index;
        if (RateValue[Index] == State.BakeRate) RateIndex = Index;
    }
    const float SelectWide = (Dialog.Width - 8.0f) * 0.5f;
    ConstructBarSelect(State, Faces, DialogList, "BakeCount", "Bake/Frames", "Frames", Counts, 4, CountIndex,
                       ImVec2(Head.x, Dialog.Y), SelectWide);
    State.BakeCount = CountValue[CountIndex];
    ConstructBarSelect(State, Faces, DialogList, "BakeSize", "Bake/Size", "Tile", Sizes, 4, SizeIndex,
                       ImVec2(Head.x + SelectWide + 8.0f, Dialog.Y), SelectWide);
    State.BakeSize = SizeValue[SizeIndex];
    Dialog.Y += 37.0f;
    ConstructBarSelect(State, Faces, DialogList, "BakeRate", "Bake/Rate", "FPS", Rates, 4, RateIndex,
                       ImVec2(Head.x, Dialog.Y), SelectWide);
    State.BakeRate = RateValue[RateIndex];

    const ImVec2 WarmMin(Head.x + SelectWide + 8.0f, Dialog.Y);
    const ImVec2 WarmMax(WarmMin.x + SelectWide, Dialog.Y + 29.0f);
    DialogList->AddRectFilled(WarmMin, WarmMax, ResolveCssColour(0x0E0F12D6), 10.0f);
    DialogList->AddRect(WarmMin, WarmMax, ResolveCssColour(0xFFFFFF12), 10.0f, ImDrawFlags_None, 1.0f);
    const ImVec2 WarmDownMax(WarmMin.x + 34.0f, WarmMax.y);
    const ImVec2 WarmUpMin(WarmMax.x - 34.0f, WarmMin.y);
    Dialog.Text(Faces.Medium, 13.0f, WarmMin.x + 13.0f, Dialog.Y + 14.5f - 0.5f * 13.0f * 1.38f, 1.38f,
                ResolveCssColour(0xBCBCBCFF), "−");
    Dialog.Text(Faces.Medium, 13.0f, WarmMax.x - 21.0f, Dialog.Y + 14.5f - 0.5f * 13.0f * 1.38f, 1.38f,
                ResolveCssColour(0xBCBCBCFF), "+");
    char Warm[32]{};
    std::snprintf(Warm, sizeof(Warm), "%.2f s", State.BakeWarmup);
    const float WarmWide = Dialog.Measure(Faces.Medium, 11.0f, Warm);
    Dialog.Text(Faces.Medium, 11.0f, 0.5f * (WarmMin.x + WarmMax.x) - WarmWide * 0.5f,
                Dialog.Y + 14.5f - 0.5f * 11.0f * 1.38f, 1.38f, ResolveCssColour(0xD8D8D8FF), Warm);
    Dialog.Text(Faces.Regular, 9.5f, WarmMin.x, Dialog.Y - 14.0f, 1.4f, ResolveCssColour(0x707070FF), "Warm-up");
    RecordRect(State, "Bake/WarmDown", WarmMin, WarmDownMax);
    if (InvisibleRect("##WarmDown", WarmMin, WarmDownMax))
    {
        State.BakeWarmup -= 0.05;
        if (State.BakeWarmup < 0.0) State.BakeWarmup = 0.0;
    }
    RecordRect(State, "Bake/WarmUp", ImVec2(WarmUpMin.x, WarmMin.y), WarmMax);
    if (InvisibleRect("##WarmUp", ImVec2(WarmUpMin.x, WarmMin.y), WarmMax))
    {
        State.BakeWarmup += 0.05;
        if (State.BakeWarmup > 3.0) State.BakeWarmup = 3.0;
    }
    Dialog.Y += 45.0f;

    auto CheckPill = [&](const char* Id, const char* RectTag, const char* Label, bool& Value, ImVec2 PillMin) {
        PanelCursor Cursor{ DialogList, &Faces, 1.0f, PillMin.x, 0.0f, PillMin.y };
        const float PillWide = Cursor.Measure(Faces.Medium, 11.0f, Label) + 58.0f;
        const ImVec2 PillMax(PillMin.x + PillWide, PillMin.y + 29.0f);
        DialogList->AddRectFilled(PillMin, PillMax, ResolveCssColour(Value ? 0xE8C27A2E : 0x0E0F12D6), 10.0f);
        DialogList->AddRect(PillMin, PillMax, ResolveCssColour(Value ? 0xE8C27A66 : 0xFFFFFF12), 10.0f, ImDrawFlags_None, 1.0f);
        if (Value)
        {
            (void)GlyphSymbol::Construct(DialogList, "StudioCheck", ImVec2(PillMin.x + 10.0f, PillMin.y + 8.5f), 12.0f, 1.8f,
                                         ResolveCssColour(0xE8C27AFF));
        }
        Cursor.Text(Faces.Medium, 11.0f, PillMin.x + (Value ? 28.0f : 12.0f), PillMin.y + 14.5f - 0.5f * 11.0f * 1.38f, 1.38f,
                    ResolveCssColour(Value ? 0xE8C27AFF : 0xBCBCBCFF), Label);
        RecordRect(State, RectTag, PillMin, PillMax);
        if (InvisibleRect(Id, PillMin, PillMax)) Value = !Value;
        return PillMax.x;
    };
    float PillX = CheckPill("##BakeTransparent", "Bake/Transparent", "Transparent background", State.BakeTransparent,
                            ImVec2(Head.x, Dialog.Y));
    CheckPill("##BakeBurst", "Bake/Burst", "Start with a burst", State.BakeBurst, ImVec2(PillX + 8.0f, Dialog.Y));
    Dialog.Y += 45.0f;
    Dialog.Text(Faces.Regular, 10.5f, Head.x, Dialog.Y, 1.5f, ResolveCssColour(0x5E5E5EFF),
                "PNG spritesheet + JSON frame rectangles, UVs and timing. No HDR");
    Dialog.Y += 17.0f;
    Dialog.Text(Faces.Regular, 10.5f, Head.x, Dialog.Y, 1.5f, ResolveCssColour(0x5E5E5EFF), "or engine-specific asset is staged.");
    Dialog.Y += 30.0f;

    const float BakeWide = Dialog.Measure(Faces.Medium, 12.0f, "Bake frames") + 44.0f;
    const ImVec2 BakeMax(Head.x + Dialog.Width, Dialog.Y + 36.0f);
    const ImVec2 BakeMin(BakeMax.x - BakeWide, Dialog.Y);
    DialogList->AddRectFilled(BakeMin, BakeMax, ResolveCssColour(0xE8C27A2E), 18.0f);
    DialogList->AddRect(BakeMin, BakeMax, ResolveCssColour(0xE8C27A66), 18.0f, ImDrawFlags_None, 1.0f);
    Dialog.Text(Faces.Medium, 12.0f, BakeMin.x + 22.0f, Dialog.Y + 18.0f - 0.5f * 12.0f * 1.38f, 1.38f,
                ResolveCssColour(0xE8C27AFF), "Bake frames");
    RecordRect(State, "Bake/Start", BakeMin, BakeMax);
    if (InvisibleRect("##BakeStart", BakeMin, BakeMax)) BakeClicked = true;

    const float CancelWide = Dialog.Measure(Faces.Medium, 12.0f, "Cancel") + 44.0f;
    const ImVec2 CancelMax(BakeMin.x - 10.0f, Dialog.Y + 36.0f);
    const ImVec2 CancelMin(CancelMax.x - CancelWide, Dialog.Y);
    DialogList->AddRectFilled(CancelMin, CancelMax, ResolveCssColour(0x1B1B1BFF), 18.0f);
    DialogList->AddRect(CancelMin, CancelMax, ResolveCssColour(0xFFFFFF24), 18.0f, ImDrawFlags_None, 1.0f);
    Dialog.Text(Faces.Medium, 12.0f, CancelMin.x + 22.0f, Dialog.Y + 18.0f - 0.5f * 12.0f * 1.38f, 1.38f,
                ResolveCssColour(0xBCBCBCFF), "Cancel");
    RecordRect(State, "Bake/Cancel", CancelMin, CancelMax);
    if (InvisibleRect("##BakeCancel", CancelMin, CancelMax)) CloseClicked = true;

    ImGui::SetCursorScreenPos(ImVec2(Dialog.X, Dialog.Y + 44.0f));
    ImGui::Dummy(ImVec2(1.0f, 1.0f));
    ImGui::EndChild();
    ImGui::PopStyleColor();

    // 📝 The veil submits after every key so the dialog wins its own presses; a press anywhere else dismisses.
    RecordRect(State, "Bake/Veil", RootMin, RootMax);
    if (InvisibleRect("##BakeVeil", RootMin, RootMax))
    {
        const ImVec2 Mouse = ImGui::GetIO().MousePos;
        if (Mouse.x < SheetMin.x || Mouse.x > SheetMax.x || Mouse.y < SheetMin.y || Mouse.y > SheetMax.y) CloseClicked = true;
    }
    ImGui::PopID();
    if (BakeClicked)
    {
        NoopFluidWorkspaceCommand(State, "BAKE", "Bake frames refused", "Baking is a NOOP in this shell");
        State.BakeOpen = false;
    }
    if (CloseClicked) State.BakeOpen = false;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    ROOT
//------------------------------------------------------------------------------------------------------------------------

} // namespace

void RecordFluidWorkspaceRect(FluidWorkspaceState& State, const char* Name, ImVec2 Min, ImVec2 Max)
{
    RecordRect(State, Name, Min, Max);
}

void ApplyFluidWorkspaceLink(FluidWorkspaceState& State, AssetBrowserLink* Link)
{
    if (Link == nullptr || !Link->HasHandoff() || Link->OpenRecordWorkspace != AssetBrowserWorkspaceFluid) return;
    static constexpr const char* Prefix  = "fluid/";
    const char*                  Raw     = Link->OpenRecordId;
    const char*                  Display = Raw;
    if (std::strncmp(Raw, Prefix, std::strlen(Prefix)) == 0)
    {
        const int Preset = QueryFluidPresetById(Raw + std::strlen(Prefix));
        if (Preset >= 0) Display = QueryFluidPreset(Preset).Name;
    }
    // 📝 Read-only names: the handoff refuses exactly like the old library card did.
    char Message[192]{};
    std::snprintf(Message, sizeof(Message), "Stage %s refused", Display);
    NoopFluidWorkspaceCommand(State, "LIBRARY", Message, "The library is read-only in this shell");
    Link->ClearHandoff();
}

void ConstructFluidWorkspace(FluidWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Size,
                             AssetBrowserLink* Link)
{
    ApplyFluidWorkspaceLink(State, Link);
    State.Rects.clear();

    // 📝 The speed select mirrors the staged time scale; the Simulation slider wins ties by nearest standard speed.
    {
        static const double SpeedValue[4] = { 0.25, 0.5, 1.0, 2.0 };
        int    Nearest     = 0;
        double NearestGap  = 1e9;
        for (int Index = 0; Index < 4; ++Index)
        {
            const double Gap = std::fabs(State.Parameters.TimeScale - SpeedValue[Index]);
            if (Gap < NearestGap)
            {
                NearestGap = Gap;
                Nearest    = Index;
            }
        }
        State.SpeedIndex             = Nearest;
        State.Parameters.TimeScale = SpeedValue[Nearest];
    }

    ImGui::SetNextWindowPos(ImVec2(0.0f, 0.0f));
    ImGui::SetNextWindowSize(Size);
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImGui::ColorConvertU32ToFloat4(ResolveCssColour(0x0B0B0BFF)));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
    ImGui::Begin("##FluidWorkspace", nullptr,
                 ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoScrollbar |
                     ImGuiWindowFlags_NoScrollWithMouse);
    ImGui::PopStyleVar(2);
    ImGui::PopStyleColor();
    ImDrawList* const DrawList = ImGui::GetWindowDrawList();

    PanelCursor Root{ DrawList, &Faces, 1.0f, 12.0f, Size.x - 24.0f, 10.0f };
    ConstructTopBar(State, Root);

    constexpr float StatusTall = 30.0f;
    const ImVec2 StatusMax(Size.x - 12.0f, Size.y - 10.0f);
    const ImVec2 StatusMin(12.0f, StatusMax.y - StatusTall);
    const float WorkspaceY = Root.Y;
    const float WorkspaceH = StatusMin.y - 8.0f - WorkspaceY;
    const float RailWide   = Size.x >= 1280.0f ? 296.0f : 256.0f;
    const float InspectorWide = Size.x >= 1280.0f ? 392.0f : 348.0f;
    const ImVec2 RailMin(12.0f, WorkspaceY);
    const ImVec2 RailMax(12.0f + RailWide, WorkspaceY + WorkspaceH);
    const ImVec2 InspectorMax(Size.x - 12.0f, WorkspaceY + WorkspaceH);
    const ImVec2 InspectorMin(InspectorMax.x - InspectorWide, WorkspaceY);
    const ImVec2 CentreMin(RailMax.x + 10.0f, WorkspaceY);
    const ImVec2 CentreMax(InspectorMin.x - 10.0f, WorkspaceY + WorkspaceH);

    // 📝 Left rail: outliner above, preset library below.
    const float OutlinerTall = 446.0f;
    ConstructOutlinerPanel(State, Faces, RailMin, ImVec2(RailMax.x, RailMin.y + OutlinerTall));
    ConstructLibraryPanel(State, Faces, ImVec2(RailMin.x, RailMin.y + OutlinerTall + 10.0f), RailMax, Link);

    // 📝 Centre column: viewport panel plus the optional 156 px log drawer.
    const float LogTall = State.LogOpen ? 156.0f : 0.0f;
    const float LogGap  = State.LogOpen ? 10.0f : 0.0f;
    const ImVec2 ViewportMax(CentreMax.x, CentreMax.y - LogTall - LogGap);
    DrawList->AddRectFilled(CentreMin, ViewportMax, ResolveCssColour(0x121212FF), 22.0f);
    ConstructViewportBar(State, Faces, DrawList, CentreMin, ImVec2(ViewportMax.x, CentreMin.y + 46.0f));
    DrawList->AddLine(ImVec2(CentreMin.x, CentreMin.y + 46.0f), ImVec2(ViewportMax.x, CentreMin.y + 46.0f),
                      ResolveCssColour(0xFFFFFF12));

    constexpr float StripTall    = 64.0f;
    constexpr float TimelineTall = 92.0f;
    constexpr float FooterTall   = 30.0f;
    const ImVec2 SurfaceMin(CentreMin.x, CentreMin.y + 46.0f);
    const ImVec2 SurfaceMax(ViewportMax.x, ViewportMax.y - StripTall - TimelineTall - FooterTall);
    ConstructPlumeSurface(State, Faces, DrawList, SurfaceMin, SurfaceMax);
    ConstructTransportStrip(State, Faces, DrawList, ImVec2(CentreMin.x, SurfaceMax.y),
                            ImVec2(ViewportMax.x, SurfaceMax.y + StripTall));
    ConstructTimeline(State, Faces, DrawList, ImVec2(CentreMin.x, SurfaceMax.y + StripTall),
                      ImVec2(ViewportMax.x, SurfaceMax.y + StripTall + TimelineTall));

    const float FootY = SurfaceMax.y + StripTall + TimelineTall;
    DrawList->AddLine(ImVec2(CentreMin.x, FootY), ImVec2(ViewportMax.x, FootY), ResolveCssColour(0xFFFFFF12));
    PanelCursor FootCursor{ DrawList, &Faces, 1.0f, CentreMin.x, ViewportMax.x - CentreMin.x, FootY };
    FootCursor.Text(Faces.Regular, 10.5f, CentreMin.x + 14.0f, FootY + 15.0f - 0.5f * 10.5f * 1.4f, 1.4f,
                    ResolveCssColour(0x848484FF), "Staged values only · grid, bounds & markers are static shell decor");
    const float LogPillWide = FootCursor.Measure(Faces.Medium, 11.0f, "Log Stream") + 18.0f;
    const ImVec2 LogPillMax(ViewportMax.x - 14.0f, FootY + 26.0f);
    const ImVec2 LogPillMin(LogPillMax.x - LogPillWide, FootY + 4.0f);
    FootCursor.Text(Faces.Medium, 11.0f, LogPillMin.x + 9.0f, FootY + 15.0f - 0.5f * 11.0f * 1.38f, 1.38f,
                    ResolveCssColour(0x848484FF), "Log Stream");
    ImGui::PushID("ViewportFooter");
    RecordRect(State, "Footer/Log", LogPillMin, LogPillMax);
    if (InvisibleRect("##LogToggle", LogPillMin, LogPillMax)) State.LogOpen = !State.LogOpen;
    ImGui::PopID();
    DrawList->AddRect(CentreMin, ViewportMax, ResolveCssColour(0xFFFFFF0E), 22.0f, ImDrawFlags_None, 1.0f);

    if (State.LogOpen) ConstructLogDrawer(State, Faces, ImVec2(CentreMin.x, ViewportMax.y + 10.0f), CentreMax);

    // 📝 Inspector panel: fixed header/footer with the scrolling page between them.
    DrawList->AddRectFilled(InspectorMin, InspectorMax, ResolveCssColour(0x121212FF), 22.0f);
    DrawList->AddRect(InspectorMin, InspectorMax, ResolveCssColour(0xFFFFFF0E), 22.0f, ImDrawFlags_None, 1.0f);
    PanelCursor Inspector{ DrawList, &Faces, 1.0f, InspectorMin.x, InspectorMax.x - InspectorMin.x, InspectorMin.y };
    const ImVec2 InspectorHead = Inspector.Space(44.0f);
    DrawList->AddLine(ImVec2(InspectorMin.x, InspectorHead.y + 44.0f), ImVec2(InspectorMax.x, InspectorHead.y + 44.0f),
                      ResolveCssColour(0xFFFFFF12));
    Inspector.Text(Faces.Light, 13.5f, InspectorMin.x + 16.0f, InspectorHead.y + 22.0f - 0.5f * 13.5f * 1.4f, 1.4f,
                   ResolveCssColour(0xDADADADA), "Inspector", -0.2f);
    const float TagWide = Inspector.Measure(Faces.Regular, 10.5f, "Staged · Ready");
    Inspector.Text(Faces.Regular, 10.5f, InspectorMax.x - 16.0f - TagWide, InspectorHead.y + 22.0f - 0.5f * 10.5f * 1.4f, 1.4f,
                   ResolveCssColour(0x848484FF), "Staged · Ready");
    const ImVec2 ResetMax(InspectorMax.x - 16.0f - TagWide - 10.0f, InspectorHead.y + 35.0f);
    const ImVec2 ResetMin(ResetMax.x - 26.0f, InspectorHead.y + 9.0f);
    DrawList->AddCircleFilled(ImVec2(ResetMin.x + 13.0f, ResetMin.y + 13.0f), 13.0f, ResolveCssColour(0x1A1A1AFF), 24);
    DrawList->AddCircle(ImVec2(ResetMin.x + 13.0f, ResetMin.y + 13.0f), 13.0f, ResolveCssColour(0xFFFFFF24), 24, 1.0f);
    (void)GlyphSymbol::Construct(DrawList, "StudioReset", ImVec2(ResetMin.x + 7.0f, ResetMin.y + 7.0f), 12.0f, 1.8f,
                                 ResolveCssColour(0xBCBCBCFF));
    RecordRect(State, "Inspector/Reset", ResetMin, ResetMax);
    if (InvisibleRect("##InspectorReset", ResetMin, ResetMax))
    {
        ResetFluidWorkspaceTab(State.Parameters, State.InspectorTab);
        if (State.InspectorTab == FluidWorkspaceState::TabSimulation) State.SpeedIndex = 2;
        AppendFluidWorkspaceLog(State, "SCENE", "Inspector tab restored to editor defaults", "local");
        Toast::Show("Visible inspector properties restored to editor defaults.");
    }
    const ImVec2 InspectorFootMin(InspectorMin.x, InspectorMax.y - 30.0f);
    DrawList->AddLine(ImVec2(InspectorMin.x, InspectorFootMin.y), ImVec2(InspectorMax.x, InspectorFootMin.y),
                      ResolveCssColour(0xFFFFFF12));
    DrawList->AddRectFilled(ImVec2(InspectorMin.x, InspectorFootMin.y), InspectorMax, ResolveCssColour(0xFFFFFF04), 0.0f);

    ImGui::SetCursorScreenPos(ImVec2(InspectorMin.x, InspectorHead.y + 44.0f));
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0, 0, 0));
    ImGui::BeginChild("##InspectorScroll", ImVec2(InspectorMax.x - InspectorMin.x, InspectorFootMin.y - InspectorHead.y - 44.0f),
                      false, ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
    {
        const ControlTheme Theme = ControlTheme::ResolveRemastered();
        ControlColumn Column(Theme, Faces, 1.0f, ImVec2(InspectorMin.x + 12.0f, InspectorHead.y + 44.0f + 12.0f),
                             InspectorMax.x - InspectorMin.x - 24.0f);
        ConstructFluidWorkspaceInspector(State, Faces, Column);
        Column.Finalize();
    }
    ImGui::EndChild();
    ImGui::PopStyleColor();

    DrawList->AddRectFilled(StatusMin, StatusMax, ResolveCssColour(0x101010FF), 15.0f);
    DrawList->AddRect(StatusMin, StatusMax, ResolveCssColour(0xFFFFFF0E), 15.0f, ImDrawFlags_None, 1.0f);
    {
        // 📝 Live status figures derive from the staged parameters (grid, bounds), never the engines.
        PanelCursor Status{ DrawList, &Faces, 1.0f, StatusMin.x, StatusMax.x - StatusMin.x, StatusMin.y };
        const float MidY = StatusMin.y + StatusTall * 0.5f;
        DrawList->AddCircleFilled(ImVec2(StatusMin.x + 18.0f, MidY), 4.0f, ResolveCssColour(0x7FD08AFF), 16);
        Status.Text(Faces.Medium, 11.0f, StatusMin.x + 28.0f, MidY - 0.5f * 11.0f * 1.38f, 1.38f,
                    ResolveCssColour(0xBCBCBCFF), "Static shell");
        float StatX = StatusMin.x + 28.0f + Status.Measure(Faces.Medium, 11.0f, "Static shell") + 18.0f;
        DrawList->AddLine(ImVec2(StatX, StatusMin.y + 8.0f), ImVec2(StatX, StatusMax.y - 8.0f), ResolveCssColour(0xFFFFFF14));
        StatX += 18.0f;
        char Voxels[40]{};
        FormatFluidVoxels(State.Parameters.GridResolution, Voxels, sizeof(Voxels));
        Status.Text(Faces.Regular, 11.0f, StatX, MidY - 0.5f * 11.0f * 1.4f, 1.4f, ResolveCssColour(0x848484FF), Voxels);
        StatX += Status.Measure(Faces.Regular, 11.0f, Voxels) + 18.0f;
        DrawList->AddLine(ImVec2(StatX, StatusMin.y + 8.0f), ImVec2(StatX, StatusMax.y - 8.0f), ResolveCssColour(0xFFFFFF14));
        StatX += 18.0f;
        char Bounds[48]{};
        FormatFluidBounds(State.Parameters.BoundsWidth, State.Parameters.BoundsHeight, Bounds, sizeof(Bounds));
        Status.Text(Faces.Regular, 11.0f, StatX, MidY - 0.5f * 11.0f * 1.4f, 1.4f, ResolveCssColour(0x848484FF), Bounds);
        const float RightTag = Status.Measure(Faces.SemiBold, 10.0f, "FRONTIER / FLUID", 0.9f);
        Status.Text(Faces.SemiBold, 10.0f, StatusMax.x - 14.0f - RightTag - 34.0f, MidY - 0.5f * 10.0f * 1.4f, 1.4f,
                    ResolveCssColour(0x707070FF), "FRONTIER / FLUID", 0.9f);
        Status.Text(Faces.SemiBold, 10.0f, StatusMax.x - 14.0f - 22.0f, MidY - 0.5f * 10.0f * 1.4f, 1.4f,
                    ResolveCssColour(0xE8C27AFF), "0.1");
        const float CpuTag = Status.Measure(Faces.Regular, 10.5f, "CPU shell · no GPU");
        Status.Text(Faces.Regular, 10.5f, StatusMax.x - 14.0f - RightTag - 34.0f - 18.0f - CpuTag,
                    MidY - 0.5f * 10.5f * 1.4f, 1.4f, ResolveCssColour(0x5E5E5EFF), "CPU shell · no GPU");
    }

    ConstructBakeDialog(State, Faces, ImVec2(0.0f, 0.0f), Size);
    Toast::Construct();
    ImGui::End();
}

} // namespace Frontier
