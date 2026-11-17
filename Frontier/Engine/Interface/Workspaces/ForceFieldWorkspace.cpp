/*==========================================================================================================================================
                                                          FORCEFIELDWORKSPACE.CPP
==========================================================================================================================================*/
// 🧩 The native Force Field & Wind workspace: editable scenarios and sources, sampled Map / Oblique visualization, timeline,
//    log drawer, inline type library, and source navigation.

#include "Engine/Interface/Workspaces/ForceFieldWorkspace.h"
#include "Engine/Interface/Workspaces/ForceFieldWorkspaceRuntime.h"

#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/ControlTheme.h"
#include "Engine/Interface/Controls/GlyphRun.h"
#include "Engine/Interface/Controls/GlyphSymbol.h"
#include "Engine/Interface/Controls/Toast.h"
#include "Engine/Interface/InspectorControls.h"

#include <imgui_internal.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace Frontier
{

namespace
{

constexpr float PiSingle = 3.14159265358979f;

//------------------------------------------------------------------------------------------------------------------------
//                                                    SMALL HELPERS
//------------------------------------------------------------------------------------------------------------------------

void RecordRect(ForceFieldWorkspaceState& State, const char* Name, ImVec2 Min, ImVec2 Max)
{
    State.Rects[Name] = ImVec4(Min.x, Min.y, Max.x, Max.y);
}

[[nodiscard]] uint32_t Hash32(uint32_t Word) noexcept
{
    Word ^= Word >> 13;
    Word *= 1274126177u;
    Word ^= Word >> 16;
    return Word;
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

//------------------------------------------------------------------------------------------------------------------------
//                                                    MAP DECOR
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

void DashedLine(ImDrawList* DrawList, ImVec2 From, ImVec2 To, ImU32 Colour, float Width)
{
    const float Length = std::sqrt((To.x - From.x) * (To.x - From.x) + (To.y - From.y) * (To.y - From.y));
    const int   Dashes = std::max(1, static_cast<int>(Length / 9.0f));
    for (int Dash = 0; Dash < Dashes; ++Dash)
    {
        const float T0 = static_cast<float>(Dash) / static_cast<float>(Dashes);
        const float T1 = (static_cast<float>(Dash) + 0.62f) / static_cast<float>(Dashes);
        DrawList->AddLine(ImVec2(From.x + (To.x - From.x) * T0, From.y + (To.y - From.y) * T0),
                          ImVec2(From.x + (To.x - From.x) * T0 + (To.x - From.x) * (T1 - T0),
                                 From.y + (To.y - From.y) * T0 + (To.y - From.y) * (T1 - T0)),
                          Colour, Width);
    }
}

void ArrowHead(ImDrawList* DrawList, ImVec2 Tip, ImVec2 Direction, float Size, ImU32 Colour, float Width)
{
    const ImVec2 Left(Tip.x - Direction.x * Size - Direction.y * Size * 0.45f, Tip.y - Direction.y * Size + Direction.x * Size * 0.45f);
    const ImVec2 Right(Tip.x - Direction.x * Size + Direction.y * Size * 0.45f, Tip.y - Direction.y * Size - Direction.x * Size * 0.45f);
    DrawList->AddLine(Tip, Left, Colour, Width);
    DrawList->AddLine(Tip, Right, Colour, Width);
}

} // namespace

void RecordForceFieldWorkspaceRect(ForceFieldWorkspaceState& State, const char* Name, ImVec2 Min, ImVec2 Max)
{
    RecordRect(State, Name, Min, Max);
}

void LogForceFieldWorkspaceValue(ForceFieldWorkspaceState& State, const char* Channel, const char* Owner, const char* Label,
                              const char* Shown)
{
    char Message[256]{};
    char Key[160]{};
    std::snprintf(Message, sizeof(Message), "%s: %s → %s", Owner, Label, Shown);
    std::snprintf(Key, sizeof(Key), "%s: %s", Owner, Label);
    AppendForceFieldWorkspaceLog(State, Channel, Message, nullptr, Key);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    TOP BAR
//------------------------------------------------------------------------------------------------------------------------

namespace
{

constexpr const char* ScenarioNames[4] = { "Wind + Vortex Lab", "Dual Wind Corridor", "Storm System · 100 km", "Blank · Build" };
constexpr const char* SuiteNames[4]    = { "Particles", "Fracture", "Photometric", "Force Field" };

void ConstructTopBar(ForceFieldWorkspaceState& State, PanelCursor& Root)
{
    ImDrawList* const DrawList = Root.DrawList;
    const float       S        = Root.S;
    const ImVec2      Bar      = Root.Space(44.0f, 0.0f, 10.0f);
    const ImVec2      BarMax(Bar.x + Root.Width, Bar.y + 44.0f * S);
    DrawList->AddRectFilled(Bar, BarMax, ResolveCssColour(0x121212FF), 16.0f * S);
    DrawList->AddRect(Bar, BarMax, ResolveCssColour(0xFFFFFF0F), 16.0f * S, ImDrawFlags_None, S);

    float Cursor = Bar.x + 12.0f * S;
    const float MidY = Bar.y + 22.0f * S;
    Cursor += Root.Text(Root.Faces->Medium, 17.0f, Cursor, MidY - 0.5f * 17.0f * 1.3f * S, 1.3f, ResolveCssColour(0xF4F4F4FF), "frontier",
                        -0.45f * S);
    Cursor += Root.Text(Root.Faces->Medium, 17.0f, Cursor, MidY - 0.5f * 17.0f * 1.3f * S, 1.3f, ResolveCssColour(0xE8C27AFF), ".");
    Cursor += 10.0f * S;
    const float BadgeWide = Root.Measure(Root.Faces->Medium, 9.5f, "FORCE FIELD + WIND", 0.9f * S) + 18.0f * S;
    const ImVec2 BadgeMin(Cursor, MidY - 11.0f * S);
    const ImVec2 BadgeMax(Cursor + BadgeWide, MidY + 11.0f * S);
    DrawList->AddRectFilled(BadgeMin, BadgeMax, ResolveCssColour(0xEFF4CF1C), 11.0f * S);
    DrawList->AddRect(BadgeMin, BadgeMax, ResolveCssColour(0xEFF4CF38), 11.0f * S, ImDrawFlags_None, S);
    Root.Text(Root.Faces->Medium, 9.5f, Cursor + 9.0f * S, MidY - 0.5f * 9.5f * 1.4f * S, 1.4f, ResolveCssColour(0xEFF4CFFF),
              "FORCE FIELD + WIND", 0.9f * S);

    // 📝 Scenario tabs swap the workspace's authored preset, including a genuinely empty build scene.
    float TabsWide = 0.0f;
    float TabWidths[4]{};
    for (int Tab = 0; Tab < 4; ++Tab)
    {
        TabWidths[Tab] = Root.Measure(Root.Faces->Medium, 11.5f, ScenarioNames[Tab]) + 22.0f * S;
        TabsWide += TabWidths[Tab] + (Tab > 0 ? 4.0f * S : 0.0f);
    }
    float TabX = Bar.x + 0.5f * (Root.Width - TabsWide);
    ImGui::PushID("ScenarioTabs");
    for (int Tab = 0; Tab < 4; ++Tab)
    {
        const ImVec2 Min(TabX, MidY - 13.0f * S);
        const ImVec2 Max(TabX + TabWidths[Tab], MidY + 13.0f * S);
        const bool   Active = Tab == State.Scenario;
        if (Active) DrawList->AddRectFilled(Min, Max, ResolveCssColour(0xEFF4CFFF), 9.0f * S);
        Root.Text(Root.Faces->Medium, 11.5f, Min.x + 11.0f * S, MidY - 0.5f * 11.5f * 1.38f * S, 1.38f,
                  ResolveCssColour(Active ? 0x0B0B0BFF : 0x848484FF), ScenarioNames[Tab]);
        ImGui::PushID(Tab);
        char RectName[32]{};
        std::snprintf(RectName, sizeof(RectName), "Top/Scenario%d", Tab);
        RecordRect(State, RectName, Min, Max);
        if (InvisibleRect("##Scenario", Min, Max) && Tab != State.Scenario)
        {
            ApplyForceFieldWorkspacePreset(State, Tab);
        }
        ImGui::PopID();
        TabX += TabWidths[Tab] + 4.0f * S;
    }
    ImGui::PopID();

    float LinkX = BarMax.x - 12.0f * S;
    float LinkWidths[4]{};
    for (int Link = 0; Link < 4; ++Link) LinkWidths[Link] = Root.Measure(Root.Faces->Regular, 11.0f, SuiteNames[Link]) + 18.0f * S;
    ImGui::PushID("SuiteLinks");
    for (int Link = 3; Link >= 0; --Link)
    {
        const bool   Current = Link == 3;
        const ImVec2 Max(LinkX, MidY + 12.0f * S);
        const ImVec2 Min(LinkX - LinkWidths[Link], MidY - 12.0f * S);
        if (Current) DrawList->AddRectFilled(Min, Max, ResolveCssColour(0xEFF4CF1F), 8.0f * S);
        Root.Text(Root.Faces->Regular, 11.0f, Min.x + 9.0f * S, MidY - 0.5f * 11.0f * 1.38f * S, 1.38f,
                  ResolveCssColour(Current ? 0xEFF4CFFF : 0x848484FF), SuiteNames[Link]);
        LinkX -= LinkWidths[Link] + 4.0f * S;
    }
    ImGui::PopID();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    OUTLINER
//------------------------------------------------------------------------------------------------------------------------

void ConstructOutlinerPanel(ForceFieldWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Min, ImVec2 Max)
{
    ImDrawList* const DrawList = ImGui::GetWindowDrawList();
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x121212FF), 22.0f);
    DrawList->AddRect(Min, Max, ResolveCssColour(0xFFFFFF0E), 22.0f, ImDrawFlags_None, 1.0f);

    PanelCursor Panel{ DrawList, &Faces, 1.0f, Min.x, Max.x - Min.x, Min.y };
    const ImVec2 Head = Panel.Space(44.0f);
    DrawList->AddLine(ImVec2(Min.x, Head.y + 44.0f), ImVec2(Max.x, Head.y + 44.0f), ResolveCssColour(0xFFFFFF12));
    Panel.Text(Faces.Light, 13.5f, Min.x + 16.0f, Head.y + 22.0f - 0.5f * 13.5f * 1.4f, 1.4f, ResolveCssColour(0xDADADADA), "Outliner",
               -0.2f);
    const ImVec2 AddMin(Max.x - 16.0f - 26.0f, Head.y + 9.0f);
    const ImVec2 AddMax(AddMin.x + 26.0f, AddMin.y + 26.0f);
    DrawList->AddRectFilled(AddMin, AddMax, ResolveCssColour(0xEFF4CFFF), 9.0f);
    Panel.Text(Faces.SemiBold, 15.0f, AddMin.x + 8.0f, AddMin.y + 3.0f, 1.4f, ResolveCssColour(0x0B0B0BFF), "+");
    ImGui::PushID("OutlinerPanel");
    RecordRect(State, "Outliner/Add", AddMin, AddMax);
    if (InvisibleRect("##Add", AddMin, AddMax)) State.LibraryOpen = true;

    const ImVec2 FootMin(Min.x, Max.y - 30.0f);
    DrawList->AddLine(ImVec2(Min.x, FootMin.y), ImVec2(Max.x, FootMin.y), ResolveCssColour(0xFFFFFF12));
    DrawList->AddRectFilled(ImVec2(Min.x, FootMin.y), Max, ResolveCssColour(0xFFFFFF04), 0.0f);
    char Foot[96]{};
    std::snprintf(Foot, sizeof(Foot), "%d bounded fields · zero infinite leakage", static_cast<int>(State.Sources.size()));
    Panel.Text(Faces.Regular, 10.0f, Min.x + 16.0f, FootMin.y + 15.0f - 0.5f * 10.0f * 1.4f, 1.4f, ResolveCssColour(0x6E6E6EFF), Foot);

    ImGui::SetCursorScreenPos(ImVec2(Min.x, Head.y + 44.0f));
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0, 0, 0));
    ImGui::BeginChild("##OutlinerScroll", ImVec2(Max.x - Min.x, FootMin.y - Head.y - 44.0f), false,
                      ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
    ImDrawList* const InnerList = ImGui::GetWindowDrawList();
    PanelCursor       Content{ InnerList, &Faces, 1.0f, Min.x + 12.0f, Max.x - Min.x - 24.0f, Head.y + 44.0f + 12.0f };

    int Active = State.Wind.Enabled ? 1 : 0;
    int Waiting = State.Wind.Enabled ? 0 : 1;
    for (const ForceFieldWorkspaceSource& Source : State.Sources)
    {
        if (ResolveForceFieldSourceStatus(Source, State.ClockTime) == 0) ++Active;
        else ++Waiting;
    }
    const ImVec2 Metrics = Content.Space(58.0f, 0.0f, 10.0f);
    const float  MiniWide = (Content.Width - 7.0f) / 2.0f;
    const char*  MiniLabels[2] = { "Acting now", "Waiting or off" };
    const int    MiniValues[2] = { Active, Waiting };
    for (int Mini = 0; Mini < 2; ++Mini)
    {
        const ImVec2 MiniMin(Metrics.x + Mini * (MiniWide + 7.0f), Metrics.y);
        const ImVec2 MiniMax(MiniMin.x + MiniWide, Metrics.y + 58.0f);
        const int MiniVerts = InnerList->VtxBuffer.Size;
        InnerList->AddRectFilled(MiniMin, MiniMax, ResolveCssColour(0x212121FF), 16.0f);
        ImGui::ShadeVertsLinearColorGradientKeepAlpha(InnerList, MiniVerts, InnerList->VtxBuffer.Size, MiniMin, MiniMax,
                                                      ResolveCssColour(0x212121FF), ResolveCssColour(0x191919FF));
        InnerList->AddRect(MiniMin, MiniMax, ResolveCssColour(0xFFFFFF0F), 16.0f, ImDrawFlags_None, 1.0f);
        char Figure[16]{};
        std::snprintf(Figure, sizeof(Figure), "%d", MiniValues[Mini]);
        Content.Text(Faces.Light, 20.0f, MiniMin.x + 12.0f, MiniMin.y + 9.0f, 1.1f, ResolveCssColour(0xF1F1F1FF), Figure);
        Content.Text(Faces.Regular, 10.0f, MiniMin.x + 12.0f, MiniMin.y + 32.0f, 1.4f, ResolveCssColour(0x848484FF), MiniLabels[Mini]);
    }

    // 📝 Search box: a transparent input over the pill; typing filters depth-1 rows live.
    const ImVec2 Search = Content.Space(34.0f, 0.0f, 10.0f);
    const ImVec2 SearchMax(Search.x + Content.Width, Search.y + 34.0f);
    const bool   SearchHot = ImGui::IsMouseHoveringRect(Search, SearchMax);
    InnerList->AddRectFilled(Search, SearchMax, ResolveCssColour(SearchHot ? 0x1C1C1CFF : 0x171717FF), 17.0f);
    InnerList->AddRect(Search, SearchMax, ResolveCssColour(0xFFFFFF12), 17.0f, ImDrawFlags_None, 1.0f);
    if (State.OutlinerQuery.empty())
    {
        Content.Text(Faces.Regular, 11.5f, Search.x + 12.0f, Search.y + 17.0f - 0.5f * 11.5f * 1.4f, 1.4f, ResolveCssColour(0x6E6E6EFF),
                     "Search forcefields & wind…");
    }
    ImGui::SetCursorScreenPos(ImVec2(Search.x + 12.0f, Search.y + 5.0f));
    ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0, 0, 0, 0));
    ImGui::PushStyleColor(ImGuiCol_Text, ImGui::ColorConvertU32ToFloat4(ResolveCssColour(0xEFEFEFFF)));
    ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 0.0f);
    ImGui::PushItemWidth(Content.Width - 24.0f);
    char QueryScratch[128]{};
    std::snprintf(QueryScratch, sizeof(QueryScratch), "%s", State.OutlinerQuery.c_str());
    if (ImGui::InputText("##OutlinerSearch", QueryScratch, sizeof(QueryScratch))) State.OutlinerQuery = QueryScratch;
    ImGui::PopItemWidth();
    ImGui::PopStyleVar();
    ImGui::PopStyleColor(2);
    RecordRect(State, "Outliner/Search", Search, SearchMax);

    char QueryLower[128]{};
    std::snprintf(QueryLower, sizeof(QueryLower), "%s", State.OutlinerQuery.c_str());
    for (char& C : QueryLower) C = static_cast<char>(std::tolower(static_cast<unsigned char>(C)));
    const bool Filtering = QueryLower[0] != '\0';

    const auto Matches = [&](const char* Name)
    {
        if (!Filtering) return true;
        char Lower[128]{};
        std::snprintf(Lower, sizeof(Lower), "%s", Name);
        for (char& C : Lower) C = static_cast<char>(std::tolower(static_cast<unsigned char>(C)));
        return std::strstr(Lower, QueryLower) != nullptr;
    };

    int RowOrdinal = 0;
    const auto TreeRow = [&](const char* RectTag, const char* Name, const char* Meta, const char* Glyph, uint32_t Accent, int RowId,
                             bool Nested, bool Enabled, int Status, auto Flip)
    {
        const ImVec2 Row = Content.Space(46.0f, 0.0f, 3.0f);
        const ImVec2 RowMax(Row.x + Content.Width, Row.y + 46.0f);
        const bool   SelectedRow = State.Selected == RowId;
        const float  Fade = Enabled ? 1.0f : 0.45f;
        if (SelectedRow)
        {
            InnerList->AddRectFilled(Row, RowMax, ImGui::ColorConvertFloat4ToU32(ImVec4(1, 1, 1, 0.09f * Fade)), 12.0f);
            InnerList->AddRect(Row, RowMax, ImGui::ColorConvertFloat4ToU32(ImVec4(1, 1, 1, 0.14f * Fade)), 12.0f, ImDrawFlags_None, 1.0f);
            InnerList->AddRectFilled(ImVec2(Row.x + 2.0f, Row.y + 9.0f), ImVec2(Row.x + 5.0f, RowMax.y - 9.0f),
                                     FadeColour(Accent, Fade), 3.0f);
        }
        const ImVec2 ChipMin(Row.x + (Nested ? 14.0f : 11.0f), Row.y + 10.0f);
        InnerList->AddRectFilled(ChipMin, ImVec2(ChipMin.x + 26.0f, ChipMin.y + 26.0f),
                                 FadeColour(ResolveAlpha(Accent, 34.0f / 255.0f), Fade), 8.0f);
        (void)GlyphSymbol::Construct(InnerList, Glyph, ImVec2(ChipMin.x + 6.5f, ChipMin.y + 6.5f), 13.0f, 1.8f, FadeColour(Accent, Fade));
        char NameClip[64]{};
        std::snprintf(NameClip, sizeof(NameClip), "%s", Name);
        Content.Text(Faces.Regular, 12.0f, ChipMin.x + 35.0f, Row.y + 8.0f, 1.3f,
                     FadeColour(ResolveCssColour(SelectedRow ? 0xFFFFFFFF : 0xE6E6E6FF), Fade), NameClip);
        Content.Text(Faces.Regular, 10.0f, ChipMin.x + 35.0f, Row.y + 24.0f, 1.4f, FadeColour(ResolveCssColour(0x767676FF), Fade), Meta);
        const ImVec2 EyeMax(RowMax.x - 8.0f, Row.y + 35.0f);
        const ImVec2 EyeMin(EyeMax.x - 24.0f, Row.y + 11.0f);
        float StatusRight = EyeMin.x - 4.0f;
        if (Status >= 0)
        {
            const char* StatusText = QueryForceFieldStatusName(Status);
            const float StatusWide = Content.Measure(Faces.Medium, 9.0f, StatusText) + 12.0f;
            const ImVec2 PillMax(StatusRight, Row.y + 28.0f);
            const ImVec2 PillMin(StatusRight - StatusWide, Row.y + 12.0f);
            ImU32 PillFill = ResolveCssColour(0xFFFFFF0F);
            ImU32 PillInk  = ResolveCssColour(0x5E5E5EFF);
            if (Status == 0)
            {
                PillFill = ResolveCssColour(0x3EC46D29);
                PillInk  = ResolveCssColour(0x3EC46DFF);
            }
            else if (Status == 1 || Status == 2)
            {
                PillFill = ResolveCssColour(0xE8C27A29);
                PillInk  = ResolveCssColour(0xE8C27AFF);
            }
            InnerList->AddRectFilled(PillMin, PillMax, FadeColour(PillFill, Fade), 8.0f);
            Content.Text(Faces.Medium, 9.0f, PillMin.x + 6.0f, PillMin.y + 3.0f, 1.3f, FadeColour(PillInk, Fade), StatusText);
        }
        ImGui::PushID(RowOrdinal++);
        char EyeTag[48]{};
        std::snprintf(EyeTag, sizeof(EyeTag), "%s/Eye", RectTag);
        RecordRect(State, EyeTag, EyeMin, EyeMax);
        // 📝 The eye submits before the row: ImGui awards a press to the first overlapping item.
        const bool EyePressed = InvisibleRect("##TreeEye", EyeMin, EyeMax);
        RecordRect(State, RectTag, Row, RowMax);
        if (InvisibleRect("##TreeRow", Row, RowMax)) State.Selected = RowId;
        if (EyePressed) Flip();
        ImGui::PopID();
        (void)StatusRight;
        (void)GlyphSymbol::Construct(InnerList, Enabled ? "StudioFieldEye" : "StudioFieldEyeOff",
                                     ImVec2(EyeMin.x + 5.5f, EyeMin.y + 5.5f), 13.0f, 1.8f,
                                     FadeColour(ResolveCssColour(0x848484FF), Fade));
    };

    const ImVec2 GroupA = Content.Space(27.0f);
    Content.Text(Faces.Medium, 10.0f, GroupA.x + 6.0f, GroupA.y + 8.0f, 1.4f, ResolveCssColour(0x707070FF), "MASTER & AMBIENT WIND",
                 0.75f);
    char FieldMeta[96]{};
    std::snprintf(FieldMeta, sizeof(FieldMeta), "%d bounded fields · %s", static_cast<int>(State.Sources.size()),
                  State.View.FlowLines ? "Flow lines" : "Vectors");
    TreeRow("Outliner/Field", "Force Field Workspace", FieldMeta, "StudioFieldField", ResolveCssColour(0x8FD3C4FF),
            ForceFieldWorkspaceState::SelectedField, false, State.FieldEnabled, -1, [&] { State.FieldEnabled = !State.FieldEnabled; });
    char WindMeta[96]{};
    if (State.Wind.Enabled) std::snprintf(WindMeta, sizeof(WindMeta), "%.1f m/s @ %.0f°", State.Wind.Speed, State.Wind.Bearing);
    else std::snprintf(WindMeta, sizeof(WindMeta), "%s", "Off · Placed generators only");
    if (!Filtering || Matches("Ambient Wind"))
    {
        TreeRow("Outliner/Wind", "Ambient Wind", WindMeta, "StudioFieldWind", ResolveCssColour(0x8FD3C4FF),
                ForceFieldWorkspaceState::SelectedWind, true, State.Wind.Enabled, -1,
                [&] { State.Wind.Enabled = !State.Wind.Enabled; });
    }

    int FlowCount = 0;
    int OtherCount = 0;
    for (const ForceFieldWorkspaceSource& Source : State.Sources)
    {
        if (QueryForceFieldType(Source.Type).Contribution == ForceFieldContributionFlow) ++FlowCount;
        else ++OtherCount;
    }
    const auto SourceGroup = [&](const char* Title, bool Flow)
    {
        bool Any = false;
        for (const ForceFieldWorkspaceSource& Source : State.Sources)
        {
            const bool IsFlow = QueryForceFieldType(Source.Type).Contribution == ForceFieldContributionFlow;
            if (IsFlow == Flow && Matches(Source.Name.c_str())) Any = true;
        }
        if (!Any) return;
        const ImVec2 Group = Content.Space(27.0f);
        Content.Text(Faces.Medium, 10.0f, Group.x + 6.0f, Group.y + 8.0f, 1.4f, ResolveCssColour(0x707070FF), Title, 0.75f);
        for (size_t Index = 0; Index < State.Sources.size(); ++Index)
        {
            ForceFieldWorkspaceSource&       Source = State.Sources[Index];
            const ForceFieldWorkspaceType&   Type   = QueryForceFieldType(Source.Type);
            const bool                    IsFlow = Type.Contribution == ForceFieldContributionFlow;
            if (IsFlow != Flow || !Matches(Source.Name.c_str())) continue;
            char Dist[32]{};
            FormatForceFieldSpan(Source.Radius, Dist, sizeof(Dist));
            char Trimmed[32]{};
            FormatForceFieldTrimmed(Source.Params[0], 1, Trimmed, sizeof(Trimmed));
            char Meta[128]{};
            std::snprintf(Meta, sizeof(Meta), "%s · %s %s · R %s",
                          Type.Contribution == ForceFieldContributionFlow ? "Flow"
                              : (Type.Contribution == ForceFieldContributionAccelerate ? "Accelerate" : "Damp"),
                          Trimmed, QueryForceFieldContributionUnit(Type.Contribution), Dist);
            char RectTag[48]{};
            std::snprintf(RectTag, sizeof(RectTag), "Outliner/Source%d", static_cast<int>(Index));
            TreeRow(RectTag, Source.Name.c_str(), Meta, Type.Glyph, ResolveCssColour(Type.Colour), static_cast<int>(Index), true, Source.Enabled,
                    ResolveForceFieldSourceStatus(Source, State.ClockTime), [&] { Source.Enabled = !Source.Enabled; });
        }
    };
    char FlowTitle[64]{};
    char OtherTitle[64]{};
    std::snprintf(FlowTitle, sizeof(FlowTitle), "WIND & FLOW GENERATORS (%d)", FlowCount);
    std::snprintf(OtherTitle, sizeof(OtherTitle), "ACCELERATE & DAMP ZONES (%d)", OtherCount);
    SourceGroup(FlowTitle, true);
    SourceGroup(OtherTitle, false);

    ImGui::SetCursorScreenPos(ImVec2(Content.X, Content.Y));
    ImGui::Dummy(ImVec2(1.0f, 1.0f));
    ImGui::EndChild();
    ImGui::PopStyleColor();
    ImGui::PopID();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    VIEWPORT
//------------------------------------------------------------------------------------------------------------------------

constexpr const char* PlaceTypeIds[6] = { "WindGenerator", "Tornado", "Jet", "Attractor", "Repulsor", "Drag" };
constexpr const char* PlaceLabels[6]  = { "+ Wind Gen", "+ Vortex", "+ Jet", "+ Attractor", "+ Repulsor", "+ Drag" };

struct ToolbarGroup
{
    int Start = 0;
    int End   = 0;
};

void ConstructViewportToolbar(ForceFieldWorkspaceState& State, PanelCursor& Panel)
{
    ImDrawList* const DrawList = Panel.DrawList;
    const float       ContentW = Panel.Width - 24.0f;
    // 📝 Measure the three tool groups, then flow them with CSS space-between per line.
    float PlaceWide = 0.0f;
    float PlacePill[7]{};
    PlaceWide += Panel.Measure(Panel.Faces->SemiBold, 9.0f, "PLACE", 0.9f) + 12.0f + 3.0f;
    for (int Pill = 0; Pill < 6; ++Pill)
    {
        PlacePill[Pill] = Panel.Measure(Panel.Faces->Medium, 11.0f, PlaceLabels[Pill]) + 18.0f + 7.0f + 6.0f;
        PlaceWide += PlacePill[Pill] + 3.0f;
    }
    PlacePill[6] = Panel.Measure(Panel.Faces->Medium, 11.0f, "All 17…") + 18.0f;
    PlaceWide += PlacePill[6] + 3.0f;
    PlaceWide += 3.0f;

    const char*  ModeLabels[2] = { "Map 2D", "3D Stage" };
    float        ModeWide      = 6.0f;
    float        ModePill[2]{};
    for (int Pill = 0; Pill < 2; ++Pill)
    {
        ModePill[Pill] = Panel.Measure(Panel.Faces->Medium, 11.0f, ModeLabels[Pill]) + 18.0f;
        ModeWide += ModePill[Pill] + 3.0f;
    }
    ModeWide += 3.0f;

    const char*  SpanLabels[4] = { "250 m", "1.4 km", "6 km", "100 km" };
    const double SpanValues[4] = { 250.0, 1400.0, 6000.0, 100000.0 };
    float        SpanWide      = 6.0f;
    float        SpanPill[4]{};
    for (int Pill = 0; Pill < 4; ++Pill)
    {
        SpanPill[Pill] = Panel.Measure(Panel.Faces->Medium, 11.0f, SpanLabels[Pill]) + 18.0f;
        SpanWide += SpanPill[Pill] + 3.0f;
    }
    SpanWide += 3.0f;

    const float GroupWidths[3] = { PlaceWide, ModeWide, SpanWide };
    ToolbarGroup Lines[3]{};
    int          LineCount = 0;
    float        Run       = 0.0f;
    for (int Group = 0; Group < 3; ++Group)
    {
        if (Run > 0.0f && Run + 6.0f + GroupWidths[Group] > ContentW)
        {
            Lines[LineCount++].End = Group;
            Run                    = 0.0f;
        }
        if (Run == 0.0f) Lines[LineCount].Start = Group;
        Run += (Run > 0.0f ? 6.0f : 0.0f) + GroupWidths[Group];
    }
    Lines[LineCount++].End = 3;

    constexpr float GroupTall = 32.0f;
    const float     BarTall   = 14.0f + LineCount * GroupTall + (LineCount - 1) * 6.0f;
    const ImVec2    Bar       = Panel.Space(BarTall);
    DrawList->AddRectFilled(ImVec2(Panel.X, Bar.y), ImVec2(Panel.X + Panel.Width, Bar.y + BarTall), ResolveCssColour(0x161616FF));
    DrawList->AddLine(ImVec2(Panel.X, Bar.y + BarTall), ImVec2(Panel.X + Panel.Width, Bar.y + BarTall), ResolveCssColour(0xFFFFFF12));

    ImGui::PushID("ViewportToolbar");
    for (int Line = 0; Line < LineCount; ++Line)
    {
        const float LineY = Bar.y + 7.0f + Line * (GroupTall + 6.0f);
        float       LineW = 0.0f;
        for (int Group = Lines[Line].Start; Group < Lines[Line].End; ++Group) LineW += GroupWidths[Group];
        const int   Gaps   = Lines[Line].End - Lines[Line].Start - 1;
        const float Spread = Gaps > 0 ? (ContentW - LineW) / Gaps : 0.0f;
        float       GroupX = Panel.X + 12.0f;
        for (int Group = Lines[Line].Start; Group < Lines[Line].End; ++Group)
        {
            const ImVec2 GroupMin(GroupX, LineY);
            const ImVec2 GroupMax(GroupX + GroupWidths[Group], LineY + GroupTall);
            DrawList->AddRectFilled(GroupMin, GroupMax, ResolveCssColour(0x101010FF), 12.0f);
            DrawList->AddRect(GroupMin, GroupMax, ResolveCssColour(0xFFFFFF12), 12.0f, ImDrawFlags_None, 1.0f);
            float PillX = GroupMin.x + 3.0f;
            const float PillY = LineY + 3.0f;
            constexpr float PillTall = 26.0f;
            ImGui::PushID(Group);
            if (Group == 0)
            {
                Panel.Text(Panel.Faces->SemiBold, 9.0f, PillX + 6.0f, PillY + 13.0f - 0.5f * 9.0f * 1.4f, 1.4f,
                           ResolveCssColour(0xEFF4CFFF), "PLACE", 0.9f);
                PillX += Panel.Measure(Panel.Faces->SemiBold, 9.0f, "PLACE", 0.9f) + 12.0f + 3.0f;
                for (int Pill = 0; Pill < 7; ++Pill)
                {
                    const ImVec2 Min(PillX, PillY);
                    const ImVec2 Max(PillX + PlacePill[Pill], PillY + PillTall);
                    const bool   Armed = Pill < 6 && State.PlacementType == QueryForceFieldTypeById(PlaceTypeIds[Pill]);
                    const ImU32 Glow = Pill < 6 ? ResolveCssColour(QueryForceFieldType(QueryForceFieldTypeById(PlaceTypeIds[Pill])).Colour)
                                                   : ResolveCssColour(0x8FD3C4FF);
                    if (Armed) DrawList->AddRectFilled(Min, Max, Glow, 8.0f);
                    const float TextY = PillY + 13.0f - 0.5f * 11.0f * 1.38f;
                    float       TextX = Min.x + 9.0f;
                    if (Pill < 6)
                    {
                        DrawList->AddCircleFilled(ImVec2(TextX + 3.5f, PillY + 13.0f), 3.5f,
                                                  Armed ? ResolveCssColour(0x090B0FFF) : Glow, 16);
                        TextX += 7.0f + 6.0f;
                    }
                    Panel.Text(Panel.Faces->Medium, 11.0f, TextX, TextY, 1.38f,
                               Armed ? ResolveCssColour(0x090B0FFF) : ResolveCssColour(0xBCBCBCFF),
                               Pill < 6 ? PlaceLabels[Pill] : "All 17…");
                    ImGui::PushID(Pill);
                    char RectName[40]{};
                    std::snprintf(RectName, sizeof(RectName), Pill < 6 ? "Toolbar/Place%d" : "Toolbar/All17", Pill);
                    RecordRect(State, RectName, Min, Max);
                    if (InvisibleRect("##PlacePill", Min, Max))
                    {
                        if (Pill == 6) State.LibraryOpen = true;
                        else
                        {
                            const int Type = QueryForceFieldTypeById(PlaceTypeIds[Pill]);
                            if (State.PlacementType == Type) State.PlacementType = -1;
                            else
                            {
                                const ForceFieldWorkspaceType& ArmedType = QueryForceFieldType(Type);
                                char ArmedMessage[128]{};
                                std::snprintf(ArmedMessage, sizeof(ArmedMessage), "Placement armed: %s", ArmedType.Name);
                                State.PlacementType = Type;
                                AppendForceFieldWorkspaceLog(State, "PLACE", ArmedMessage, "click viewport to drop", "Place");
                            }
                        }
                    }
                    ImGui::PopID();
                    PillX += PlacePill[Pill] + 3.0f;
                }
            }
            else if (Group == 1)
            {
                for (int Pill = 0; Pill < 2; ++Pill)
                {
                    const ImVec2 Min(PillX, PillY);
                    const ImVec2 Max(PillX + ModePill[Pill], PillY + PillTall);
                    const bool   Active = State.ViewMode == Pill;
                    if (Active) DrawList->AddRectFilled(Min, Max, ResolveCssColour(0xEFF4CFFF), 8.0f);
                    Panel.Text(Panel.Faces->Medium, 11.0f, Min.x + 9.0f, PillY + 13.0f - 0.5f * 11.0f * 1.38f, 1.38f,
                               ResolveCssColour(Active ? 0x0B0B0BFF : 0x848484FF), ModeLabels[Pill]);
                    ImGui::PushID(Pill);
                    char RectName[40]{};
                    std::snprintf(RectName, sizeof(RectName), "Toolbar/Mode%d", Pill);
                    RecordRect(State, RectName, Min, Max);
                    if (InvisibleRect("##ModePill", Min, Max)) State.ViewMode = Pill;
                    ImGui::PopID();
                    PillX += ModePill[Pill] + 3.0f;
                }
            }
            else
            {
                for (int Pill = 0; Pill < 4; ++Pill)
                {
                    const ImVec2 Min(PillX, PillY);
                    const ImVec2 Max(PillX + SpanPill[Pill], PillY + PillTall);
                    const bool   Active =
                        std::fabs(SpanValues[Pill] - State.View.Span) < State.View.Span * 0.25 + 1.0;
                    if (Active) DrawList->AddRectFilled(Min, Max, ResolveCssColour(0xEFF4CFFF), 8.0f);
                    Panel.Text(Panel.Faces->Medium, 11.0f, Min.x + 9.0f, PillY + 13.0f - 0.5f * 11.0f * 1.38f, 1.38f,
                               ResolveCssColour(Active ? 0x0B0B0BFF : 0x848484FF), SpanLabels[Pill]);
                    ImGui::PushID(Pill);
                    char RectName[40]{};
                    std::snprintf(RectName, sizeof(RectName), "Toolbar/Span%d", Pill);
                    RecordRect(State, RectName, Min, Max);
                    if (InvisibleRect("##SpanPill", Min, Max)) State.View.Span = SpanValues[Pill];
                    ImGui::PopID();
                    PillX += SpanPill[Pill] + 3.0f;
                }
            }
            ImGui::PopID();
            GroupX += GroupWidths[Group] + (Gaps > 0 ? Spread : 6.0f);
        }
    }
    ImGui::PopID();
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    MAP SURFACE
//------------------------------------------------------------------------------------------------------------------------

namespace
{

ImVec2 MapProject(ImVec2 Min, ImVec2 Max, double Span, double X, double Z)
{
    const float PixelsPerMetre = (Max.x - Min.x) / static_cast<float>(Span);
    return ImVec2(0.5f * (Min.x + Max.x) + static_cast<float>(X) * PixelsPerMetre,
                  0.5f * (Min.y + Max.y) + static_cast<float>(Z) * PixelsPerMetre);
}

void ConstructMapDecor(ForceFieldWorkspaceState& State, ImDrawList* DrawList, ImVec2 Min, ImVec2 Max)
{
    DrawList->PushClipRect(Min, Max, true);
    for (float X = Min.x + 38.0f; X < Max.x; X += 76.0f) DrawList->AddLine(ImVec2(X, Min.y), ImVec2(X, Max.y), ResolveCssColour(0xFFFFFF0B));
    for (float Y = Min.y + 38.0f; Y < Max.y; Y += 76.0f) DrawList->AddLine(ImVec2(Min.x, Y), ImVec2(Max.x, Y), ResolveCssColour(0xFFFFFF0B));

    const float PixelsPerMetre = (Max.x - Min.x) / static_cast<float>(State.View.Span);
    const bool  Soloing        = State.View.Solo >= 0 && State.View.Solo < static_cast<int>(State.Sources.size());

    if (State.View.ShowInfluence)
    {
        for (size_t Index = 0; Index < State.Sources.size(); ++Index)
        {
            const ForceFieldWorkspaceSource& Source = State.Sources[Index];
            const ForceFieldWorkspaceType&   Type   = QueryForceFieldType(Source.Type);
            float Fade = Source.Enabled ? 1.0f : 0.25f;
            if (Soloing && static_cast<int>(Index) != State.View.Solo) Fade *= 0.25f;
            const ImVec2 Centre = MapProject(Min, Max, State.View.Span, Source.Centre[0], Source.Centre[2]);
            if (Source.Reach == ForceFieldReachBox && Source.Type != QueryForceFieldTypeById("Jet") &&
                Source.Type != QueryForceFieldTypeById("Wake"))
            {
                // 📝 Oriented box envelope: HalfX across, HalfZ along the bearing axis.
                const float Angle = static_cast<float>(Source.Bearing) * PiSingle / 180.0f;
                const ImVec2  Forward(std::sin(Angle), -std::cos(Angle));
                const ImVec2  Right(std::cos(Angle), std::sin(Angle));
                const float   Hx = static_cast<float>(Source.HalfX) * PixelsPerMetre;
                const float   Hz = static_cast<float>(Source.HalfZ) * PixelsPerMetre;
                const ImVec2  Corners[4] = {
                    ImVec2(Centre.x + (-Right.x * Hx - Forward.x * Hz), Centre.y + (-Right.y * Hx - Forward.y * Hz)),
                    ImVec2(Centre.x + (Right.x * Hx - Forward.x * Hz), Centre.y + (Right.y * Hx - Forward.y * Hz)),
                    ImVec2(Centre.x + (Right.x * Hx + Forward.x * Hz), Centre.y + (Right.y * Hx + Forward.y * Hz)),
                    ImVec2(Centre.x + (-Right.x * Hx + Forward.x * Hz), Centre.y + (-Right.y * Hx + Forward.y * Hz))
                };
                DrawList->AddQuad(Corners[0], Corners[1], Corners[2], Corners[3], FadeColour(ResolveCssColour(Type.Colour), 0.10f * Fade), 5.0f);
                for (int Edge = 0; Edge < 4; ++Edge)
                    DashedLine(DrawList, Corners[Edge], Corners[(Edge + 1) % 4], FadeColour(ResolveCssColour(Type.Colour), 0.60f * Fade), 1.5f);
            }
            else
            {
                const float Radius = static_cast<float>(Source.Radius) * PixelsPerMetre;
                DrawList->AddCircle(Centre, Radius, FadeColour(ResolveCssColour(Type.Colour), 0.10f * Fade), 72, 5.0f);
                DashedCircle(DrawList, Centre, Radius, FadeColour(ResolveCssColour(Type.Colour), 0.60f * Fade), 1.5f, 28,
                             static_cast<float>(Index) * 0.35f);
            }
        }
    }

    if (State.View.FlowLines)
    {
        for (size_t Index = 0; Index < State.Sources.size(); ++Index)
        {
            const ForceFieldWorkspaceSource& Source = State.Sources[Index];
            const ForceFieldWorkspaceType&   Type   = QueryForceFieldType(Source.Type);
            float Fade = Source.Enabled ? 1.0f : 0.2f;
            if (Soloing && static_cast<int>(Index) != State.View.Solo) Fade *= 0.25f;
            const ImVec2 Centre = MapProject(Min, Max, State.View.Span, Source.Centre[0], Source.Centre[2]);
            const float  Radius = static_cast<float>(Source.Radius) * PixelsPerMetre;
            if (Radius < 8.0f) continue;
            if (Type.Contribution == ForceFieldContributionFlow)
            {
                const float Rings[3] = { 0.35f, 0.55f, 0.75f };
                for (int Ring = 0; Ring < 3; ++Ring)
                {
                    const float Phase = (Hash32(static_cast<uint32_t>(Index * 7 + Ring * 13 + 1)) % 360) * PiSingle / 180.0f;
                    for (int Arc = 0; Arc < 2; ++Arc)
                    {
                        const float A0 = Phase + Arc * PiSingle;
                        DrawList->PathArcTo(Centre, Radius * Rings[Ring], A0, A0 + 1.75f, 16);
                        DrawList->PathStroke(FadeColour(ResolveCssColour(Type.Colour), 0.70f * Fade), 0, 2.0f);
                    }
                }
                if (Type.BearingKey != nullptr)
                {
                    const double KeyBearing = std::strcmp(Type.BearingKey, "TrackBearing") == 0 ? Source.TrackBearing : Source.Bearing;
                    const float  Angle      = static_cast<float>(KeyBearing) * PiSingle / 180.0f;
                    const ImVec2 Dir(std::sin(Angle), -std::cos(Angle));
                    const ImVec2 Side(-Dir.y, Dir.x);
                    for (int Streak = -1; Streak <= 1; ++Streak)
                    {
                        const ImVec2 Mid(Centre.x + Side.x * Streak * Radius * 0.3f, Centre.y + Side.y * Streak * Radius * 0.3f);
                        DashedLine(DrawList, ImVec2(Mid.x - Dir.x * Radius * 0.28f, Mid.y - Dir.y * Radius * 0.28f),
                                   ImVec2(Mid.x + Dir.x * Radius * 0.28f, Mid.y + Dir.y * Radius * 0.28f),
                                   FadeColour(ResolveCssColour(Type.Colour), 0.55f * Fade), 2.0f);
                    }
                }
            }
            else if (Type.Contribution == ForceFieldContributionAccelerate)
            {
                for (int Spoke = 0; Spoke < 8; ++Spoke)
                {
                    const float A = Spoke * PiSingle / 4.0f + static_cast<float>(Index) * 0.2f;
                    DashedLine(DrawList, ImVec2(Centre.x + std::cos(A) * Radius * 0.3f, Centre.y + std::sin(A) * Radius * 0.3f),
                               ImVec2(Centre.x + std::cos(A) * Radius * 0.9f, Centre.y + std::sin(A) * Radius * 0.9f),
                               FadeColour(ResolveCssColour(Type.Colour), 0.45f * Fade), 1.5f);
                }
            }
        }
    }

    if (State.View.Arrows)
    {
        const float Step = static_cast<float>(std::clamp(State.View.ArrowSpacing, 24.0, 160.0));
        const float WindAngle = static_cast<float>(State.Wind.Bearing) * PiSingle / 180.0f;
        const ImVec2 WindDir(std::sin(WindAngle), -std::cos(WindAngle));
        int Row = 0;
        for (float Y = Min.y + Step * 0.5f; Y < Max.y - 4.0f; Y += Step, ++Row)
        {
            int Column = 0;
            for (float X = Min.x + Step * 0.5f; X < Max.x - 4.0f; X += Step, ++Column)
            {
                if ((Hash32(static_cast<uint32_t>(Row * 73856093 ^ Column * 19349663 ^ 83492791)) % 1000) <
                    State.View.QuietCutoff * 4000.0)
                {
                    continue;
                }
                ImVec2 Dir = WindDir;
                for (const ForceFieldWorkspaceSource& Source : State.Sources)
                {
                    if (!Source.Enabled) continue;
                    const ForceFieldWorkspaceType& Type = QueryForceFieldType(Source.Type);
                    if (Type.Contribution == ForceFieldContributionDamp) continue;
                    const ImVec2 Centre = MapProject(Min, Max, State.View.Span, Source.Centre[0], Source.Centre[2]);
                    const float  Dx = X - Centre.x;
                    const float  Dy = Y - Centre.y;
                    const float  Radius = std::max(1.0f, static_cast<float>(Source.Radius) * PixelsPerMetre);
                    const float  Share  = std::sqrt(Dx * Dx + Dy * Dy) / Radius;
                    if (Share >= 1.0f || Share < 1e-3f) continue;
                    const float Fall = (1.0f - Share * Share);
                    const float Weight = Fall * Fall * 1.2f;
                    if (Type.Contribution == ForceFieldContributionFlow)
                    {
                        Dir.x += (-Dy / (Share * Radius)) * Weight;
                        Dir.y += (Dx / (Share * Radius)) * Weight;
                    }
                    else
                    {
                        const float Sign = std::strcmp(Type.Id, "Repulsor") == 0 ? 1.0f : -1.0f;
                        Dir.x += (Dx / (Share * Radius)) * Weight * Sign;
                        Dir.y += (Dy / (Share * Radius)) * Weight * Sign;
                    }
                }
                const float Length = std::max(1e-3f, std::sqrt(Dir.x * Dir.x + Dir.y * Dir.y));
                Dir.x /= Length;
                Dir.y /= Length;
                const ImVec2 Tip(X + Dir.x * 5.0f, Y + Dir.y * 5.0f);
                DrawList->AddLine(ImVec2(X - Dir.x * 5.0f, Y - Dir.y * 5.0f), Tip, ResolveCssColour(0xFFFFFF80), 1.5f);
                ArrowHead(DrawList, Tip, Dir, 4.0f, ResolveCssColour(0xFFFFFF80), 1.5f);
            }
        }
    }

    DrawList->PopClipRect();
}

void ConstructMapMarkers(ForceFieldWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 Min, ImVec2 Max)
{
    DrawList->PushClipRect(Min, Max, true);
    PanelCursor Cursor{ DrawList, &Faces, 1.0f, Min.x, Max.x - Min.x, Min.y };
    const bool  Soloing = State.View.Solo >= 0 && State.View.Solo < static_cast<int>(State.Sources.size());
    for (size_t Index = 0; Index < State.Sources.size(); ++Index)
    {
        const ForceFieldWorkspaceSource& Source = State.Sources[Index];
        const ForceFieldWorkspaceType&   Type   = QueryForceFieldType(Source.Type);
        float Fade = Source.Enabled ? 1.0f : 0.35f;
        if (Soloing && static_cast<int>(Index) != State.View.Solo) Fade *= 0.3f;
        const ImVec2 At = MapProject(Min, Max, State.View.Span, Source.Centre[0], Source.Centre[2]);
        DrawList->AddCircleFilled(At, 3.0f, FadeColour(ResolveCssColour(Type.Colour), Fade), 16);
        if (State.View.MinimalLabels) continue;
        const float LabelWide = Cursor.Measure(Faces.Regular, 10.5f, Source.Name.c_str()) + 14.0f;
        const ImVec2 LabelMin(At.x + 10.0f, At.y - 22.0f);
        const ImVec2 LabelMax(LabelMin.x + LabelWide, LabelMin.y + 21.0f);
        DrawList->AddRectFilled(LabelMin, LabelMax, FadeColour(ResolveCssColour(0x0A0A0CC7), Fade), 6.0f);
        Cursor.Text(Faces.Regular, 10.5f, LabelMin.x + 7.0f, LabelMin.y + 10.5f - 0.5f * 10.5f * 1.38f, 1.38f,
                    FadeColour(ResolveCssColour(0xEDEDEDFF), Fade), Source.Name.c_str());
    }
    DrawList->PopClipRect();
}

float ConstructHudGroup(ForceFieldWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 At)
{
    PanelCursor Cursor{ DrawList, &Faces, 1.0f, At.x, 2000.0f, At.y };
    const char* Pills[5] = { "Vectors", "Flow Lines", "Influence", "Heatmap", "Minimal" };
    bool* Flags[5]       = { &State.View.Arrows, &State.View.FlowLines, &State.View.ShowInfluence, &State.View.Heatmap,
                             &State.View.MinimalLabels };
    float Widths[5]{};
    float GroupWide = 6.0f;
    for (int Pill = 0; Pill < 5; ++Pill)
    {
        Widths[Pill] = Cursor.Measure(Faces.Medium, 11.0f, Pills[Pill]) + 18.0f;
        GroupWide += Widths[Pill] + 3.0f;
    }
    GroupWide += 3.0f;
    const ImVec2 GroupMax(At.x + GroupWide, At.y + 29.0f);
    DrawList->AddRectFilled(At, GroupMax, ResolveCssColour(0x0E0F12D6), 12.0f);
    DrawList->AddRect(At, GroupMax, ResolveCssColour(0xFFFFFF12), 12.0f, ImDrawFlags_None, 1.0f);
    float PillX = At.x + 3.0f;
    ImGui::PushID("HudGroup");
    for (int Pill = 0; Pill < 5; ++Pill)
    {
        const ImVec2 Min(PillX, At.y + 3.0f);
        const ImVec2 Max(PillX + Widths[Pill], At.y + 26.0f);
        bool Active = (Pill == 4) ? (State.View.MinimalLabels && State.View.ArrowSpacing >= 64.0) : *Flags[Pill];
        if (Active) DrawList->AddRectFilled(Min, Max, ResolveCssColour(0xEFF4CFFF), 8.0f);
        Cursor.Text(Faces.Medium, 11.0f, Min.x + 9.0f, At.y + 14.5f - 0.5f * 11.0f * 1.38f, 1.38f,
                    ResolveCssColour(Active ? 0x0B0B0BFF : 0x848484FF), Pills[Pill]);
        ImGui::PushID(Pill);
        char RectName[40]{};
        std::snprintf(RectName, sizeof(RectName), "Hud/Pill%d", Pill);
        RecordRect(State, RectName, Min, Max);
        if (InvisibleRect("##Hud", Min, Max))
        {
            if (Pill == 4)
            {
                const bool MinimalOn = !(State.View.MinimalLabels && State.View.ArrowSpacing >= 64.0);
                State.View.MinimalLabels  = MinimalOn;
                State.View.ArrowSpacing   = MinimalOn ? 70.0 : 54.0;
                State.View.FlowLineSpacing = MinimalOn ? 60.0 : 46.0;
                State.View.QuietCutoff    = MinimalOn ? 0.05 : 0.03;
                if (MinimalOn) State.View.Heatmap = false;
            }
            else
            {
                *Flags[Pill] = !*Flags[Pill];
                const char* Names[4] = { "Vector field", "RK2 Flow lines", "Influence bounds", "Heatmap" };
                char Message[96]{};
                std::snprintf(Message, sizeof(Message), "%s %s", Names[Pill], *Flags[Pill] ? "shown" : "hidden");
                const char* Keys[4] = { "Arrows", "FlowLines", "ShowInfluence", "Heatmap" };
                AppendForceFieldWorkspaceLog(State, "VIEW", Message, nullptr, Keys[Pill]);
            }
        }
        ImGui::PopID();
        PillX += Widths[Pill] + 3.0f;
    }
    ImGui::PopID();
    return GroupWide;
}

void ConstructPlaceBanner(ForceFieldWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 At, float MaxWidth)
{
    if (State.PlacementType < 0) return;
    PanelCursor Cursor{ DrawList, &Faces, 1.0f, At.x, MaxWidth, At.y };
    const ForceFieldWorkspaceType& Type = QueryForceFieldType(State.PlacementType);
    char BannerText[160]{};
    std::snprintf(BannerText, sizeof(BannerText), "Place %s · Click or drag in viewport to aim & size influence", Type.Name);
    const float TextWide   = Cursor.Measure(Faces.Medium, 11.0f, BannerText);
    const float CancelWide = Cursor.Measure(Faces.Regular, 10.5f, "Esc · Cancel") + 16.0f;
    const float BannerWide = 11.0f + TextWide + 8.0f + CancelWide + 11.0f;
    float BannerX = At.x;
    if (BannerX + BannerWide > At.x + MaxWidth) BannerX = At.x + MaxWidth - BannerWide;
    const ImVec2 BannerMin(BannerX, At.y);
    const ImVec2 BannerMax(BannerX + BannerWide, At.y + 30.0f);
    DrawList->AddRectFilled(BannerMin, BannerMax, ResolveCssColour(0xEFF4CF29), 11.0f);
    DrawList->AddRect(BannerMin, BannerMax, ResolveCssColour(0xEFF4CF73), 11.0f, ImDrawFlags_None, 1.0f);
    Cursor.Text(Faces.Medium, 11.0f, BannerMin.x + 11.0f, At.y + 15.0f - 0.5f * 11.0f * 1.4f, 1.4f, ResolveCssColour(0xEFF4CFFF),
                BannerText);
    const ImVec2 CancelMax(BannerMax.x - 11.0f, At.y + 24.0f);
    const ImVec2 CancelMin(CancelMax.x - CancelWide, At.y + 6.0f);
    DrawList->AddRectFilled(CancelMin, CancelMax, ResolveCssColour(0x00000066), 7.0f);
    Cursor.Text(Faces.Regular, 10.5f, CancelMin.x + 8.0f, At.y + 15.0f - 0.5f * 10.5f * 1.4f, 1.4f, ResolveCssColour(0xFFFFFFFF),
                "Esc · Cancel");
    ImGui::PushID("PlaceBanner");
    RecordRect(State, "Banner/Cancel", CancelMin, CancelMax);
    if (InvisibleRect("##BannerCancel", CancelMin, CancelMax)) State.PlacementType = -1;
    ImGui::PopID();
}

void ConstructMinimap(ForceFieldWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 MaxCorner)
{
    const ImVec2 Min(MaxCorner.x - 112.0f, MaxCorner.y - 100.0f);
    DrawList->AddRectFilled(Min, MaxCorner, ResolveCssColour(0x0E0E10E0), 14.0f);
    DrawList->AddRect(Min, MaxCorner, ResolveCssColour(0xFFFFFF12), 14.0f, ImDrawFlags_None, 1.0f);
    DrawList->PushClipRect(Min, MaxCorner, true);
    for (const ForceFieldWorkspaceSource& Source : State.Sources)
    {
        const ImVec2 Dot(Min.x + 56.0f + static_cast<float>(Source.Centre[0] / 100000.0) * 112.0f,
                         Min.y + 50.0f + static_cast<float>(Source.Centre[2] / 100000.0) * 100.0f);
        DrawList->AddCircleFilled(Dot, 2.0f, ResolveCssColour(QueryForceFieldType(Source.Type).Colour), 12);
    }
    DrawList->PopClipRect();
    PanelCursor Cursor{ DrawList, &Faces, 1.0f, Min.x, 112.0f, Min.y };
    char Label[48]{};
    FormatForceFieldSpan(100000.0, Label, sizeof(Label));
    Cursor.Text(Faces.Regular, 9.5f, Min.x + 7.0f, MaxCorner.y - 5.0f - 9.5f * 1.4f, 1.4f, ResolveCssColour(0xFFFFFFB8), Label);
    RecordRect(State, "Minimap", Min, MaxCorner);
}

void ConstructLegend(ForceFieldWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 Min, float SurfaceWide)
{
    PanelCursor Cursor{ DrawList, &Faces, 1.0f, Min.x, 214.0f, Min.y };
    const ImVec2 BoxMax(Min.x + 214.0f, Min.y + 118.0f);
    DrawList->AddRectFilled(Min, BoxMax, ResolveCssColour(0x090B0ED6), 10.0f);
    DrawList->AddRect(Min, BoxMax, ResolveCssColour(0xFFFFFF1F), 10.0f, ImDrawFlags_None, 1.0f);
    Cursor.Text(Faces.Regular, 10.5f, Min.x + 10.0f, Min.y + 8.0f, 1.4f, ResolveCssColour(0x9CA5A0FF), "Horizontal speed");
    char UnitLine[32]{};
    std::snprintf(UnitLine, sizeof(UnitLine), "%s · auto", QueryForceFieldContributionUnit(State.View.Contribution));
    const float UnitWide = Cursor.Measure(Faces.Regular, 10.5f, UnitLine);
    Cursor.Text(Faces.Regular, 10.5f, BoxMax.x - 10.0f - UnitWide, Min.y + 8.0f, 1.4f, ResolveCssColour(0x9CA5A0FF), UnitLine);
    const ImVec2 BarMin(Min.x + 10.0f, Min.y + 28.0f);
    const ImVec2 BarMax(BoxMax.x - 10.0f, BarMin.y + 5.0f);
    const ImU32 Stops[4] = { ResolveCssColour(0x1860BEFF), ResolveCssColour(0x2ADCAEFF), ResolveCssColour(0xFFB454FF),
                             ResolveCssColour(0xFF4C44FF) };
    const int Segments = 40;
    for (int Segment = 0; Segment < Segments; ++Segment)
    {
        const float T = static_cast<float>(Segment) / static_cast<float>(Segments - 1) * 3.0f;
        const int   Stop = std::min(2, static_cast<int>(T));
        const float Local = T - Stop;
        const ImVec4 A = ImGui::ColorConvertU32ToFloat4(Stops[Stop]);
        const ImVec4 B = ImGui::ColorConvertU32ToFloat4(Stops[Stop + 1]);
        const ImU32  Blend = ImGui::ColorConvertFloat4ToU32(
            ImVec4(A.x + (B.x - A.x) * Local, A.y + (B.y - A.y) * Local, A.z + (B.z - A.z) * Local, 1.0f));
        DrawList->AddRectFilled(ImVec2(BarMin.x + (BarMax.x - BarMin.x) * Segment / Segments, BarMin.y),
                                ImVec2(BarMin.x + (BarMax.x - BarMin.x) * (Segment + 1) / Segments + 1.0f, BarMax.y), Blend);
    }
    Cursor.Text(Faces.Monospace, 10.0f, Min.x + 10.0f, BarMax.y + 3.0f, 1.4f, ResolveCssColour(0x7D8681FF), "0");
    const float MidWide = Cursor.Measure(Faces.Monospace, 10.0f, "8.6");
    Cursor.Text(Faces.Monospace, 10.0f, Min.x + 107.0f - MidWide * 0.5f, BarMax.y + 3.0f, 1.4f, ResolveCssColour(0x7D8681FF), "8.6");
    const float PeakWide = Cursor.Measure(Faces.Monospace, 10.0f, "17.2");
    Cursor.Text(Faces.Monospace, 10.0f, BoxMax.x - 10.0f - PeakWide, BarMax.y + 3.0f, 1.4f, ResolveCssColour(0x7D8681FF), "17.2");
    DrawList->AddLine(ImVec2(Min.x + 10.0f, Min.y + 72.0f), ImVec2(BoxMax.x - 10.0f, Min.y + 72.0f), ResolveCssColour(0xFFFFFF12));
    Cursor.Text(Faces.Monospace, 10.0f, Min.x + 10.0f, Min.y + 78.0f, 1.4f, ResolveCssColour(0x9CA5A0FF), "200 m");
    char SpanText[32]{};
    const char* SpanUnit = "m";
    FormatForceFieldDistance(State.View.Span, SpanText, sizeof(SpanText), SpanUnit);
    char SpanLabel[48]{};
    std::snprintf(SpanLabel, sizeof(SpanLabel), "%s %s", SpanText, SpanUnit);
    const float SpanWide = Cursor.Measure(Faces.Monospace, 10.0f, SpanLabel);
    Cursor.Text(Faces.Monospace, 10.0f, BoxMax.x - 10.0f - SpanWide, Min.y + 78.0f, 1.4f, ResolveCssColour(0x9CA5A0FF), SpanLabel);
    const float BarWide = std::clamp(200.0f / static_cast<float>(State.View.Span) * SurfaceWide, 24.0f, 150.0f);
    const ImVec2 ScaleMin(Min.x + 10.0f, Min.y + 100.0f);
    DrawList->AddLine(ScaleMin, ImVec2(ScaleMin.x + BarWide, ScaleMin.y), ResolveCssColour(0xB8B8B8FF), 2.0f);
    DrawList->AddLine(ScaleMin, ImVec2(ScaleMin.x, ScaleMin.y - 3.0f), ResolveCssColour(0xB8B8B8FF), 2.0f);
    DrawList->AddLine(ImVec2(ScaleMin.x + BarWide, ScaleMin.y), ImVec2(ScaleMin.x + BarWide, ScaleMin.y - 3.0f),
                      ResolveCssColour(0xB8B8B8FF), 2.0f);
}

void CopyVisualizationPlacement(ForceFieldWorkspaceState& State, const ForceFieldVisualization& Visualization)
{
    State.View.Span = Visualization.View.Span;
    State.View.CentreX = Visualization.View.CentreX;
    State.View.CentreZ = Visualization.View.CentreZ;
    State.View.Yaw = Visualization.View.Yaw;
    State.View.Pitch = Visualization.View.Pitch;
}

void ConstructLiveSurface(ForceFieldWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList,
                          ImVec2 Min, ImVec2 Max, bool Oblique)
{
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x070A0FFF));
    ForceFieldWorkspaceRuntime& Runtime = EnsureForceFieldWorkspaceRuntime(State);
    ForceFieldVisualization& Visualization = Runtime.Visualization;
    Visualization.View.Mode = Oblique ? FieldViewMode::Oblique : FieldViewMode::Map;
    Visualization.Render(DrawList, Faces, Min, Max, State.ClockTime, 1.0f);

    const FieldInteraction Interaction = Visualization.ConstructNavigation(Oblique ? "##ObliqueNavigation" : "##MapNavigation", Min, Max);
    if (Interaction.PickedSource >= 0 && static_cast<size_t>(Interaction.PickedSource) < State.Sources.size())
    {
        State.Selected = Interaction.PickedSource;
        State.View.Follow = Interaction.PickedSource;
    }
    if (Interaction.MovedSource >= 0 && static_cast<size_t>(Interaction.MovedSource) < State.Sources.size())
    {
        ForceFieldWorkspaceSource& Source = State.Sources[static_cast<size_t>(Interaction.MovedSource)];
        Source.Centre[0] = Interaction.MovedTo[0];
        Source.Centre[2] = -Interaction.MovedTo[1];
    }
    if (Interaction.Clicked && State.PlacementType >= 0)
    {
        (void)AddForceFieldWorkspaceSource(State, State.PlacementType, Interaction.ClickPoint[0],
                                           Visualization.Options.SliceHeight, -Interaction.ClickPoint[1]);
        State.PlacementType = -1;
    }
    CopyVisualizationPlacement(State, Visualization);

    (void)ConstructHudGroup(State, Faces, DrawList, ImVec2(Min.x + 12.0f, Min.y + 12.0f));
    const ImVec2 MiniMin(Max.x - 124.0f, Min.y + 12.0f);
    const ImVec2 MiniMax(Max.x - 12.0f, Min.y + 112.0f);
    (void)Visualization.ConstructMinimap("##ForceFieldMinimap", DrawList, MiniMin, MiniMax, State.ClockTime, 1.0f);
    RecordRect(State, "Minimap", MiniMin, MiniMax);
    CopyVisualizationPlacement(State, Visualization);
    ConstructPlaceBanner(State, Faces, DrawList, ImVec2(Min.x + 12.0f, Min.y + 48.0f), Max.x - Min.x - 24.0f);
    if (Oblique)
    {
        PanelCursor Cursor{DrawList, &Faces, 1.0f, Min.x, Max.x - Min.x, Min.y};
        Cursor.Text(Faces.Medium, 10.0f, Max.x - 126.0f, Min.y + 122.0f, 1.4f,
                    ResolveCssColour(0xD2D8E2FF), "OBLIQUE SLICE · ALT/RIGHT DRAG TO ORBIT", 0.3f);
    }
    ImGui::PushID(Oblique ? "ObliqueSurface" : "MapSurface");
    RecordRect(State, Oblique ? "Surface/Stage3D" : "Surface/Map", Min, Max);
    ImGui::PopID();
}

void ConstructMapSurface(ForceFieldWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 Min, ImVec2 Max)
{
    ConstructLiveSurface(State, Faces, DrawList, Min, Max, false);
}

void ConstructStage3DSurface(ForceFieldWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 Min, ImVec2 Max)
{
    ConstructLiveSurface(State, Faces, DrawList, Min, Max, true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    TIMELINE
//------------------------------------------------------------------------------------------------------------------------


void ConstructTimelineStrip(ForceFieldWorkspaceState& State, const EditorTypefaces& Faces, PanelCursor& Panel)
{
    ImDrawList* const DrawList = Panel.DrawList;
    PanelCursor Cursor{ DrawList, &Faces, 1.0f, Panel.X, Panel.Width, Panel.Y };

    int TimedCount = 0;
    for (const ForceFieldWorkspaceSource& Source : State.Sources)
    {
        if (Source.Activation != ForceFieldActivationAlways) ++TimedCount;
    }
    const float LanesTall  = TimedCount > 0 ? std::min(TimedCount * 20.0f, 58.0f) : 22.0f;
    const float TracksTall = 16.0f + LanesTall;
    const float StripTall  = 18.0f + std::max(30.0f, TracksTall);
    const ImVec2 Strip     = Panel.Space(StripTall);
    DrawList->AddLine(ImVec2(Panel.X, Strip.y), ImVec2(Panel.X + Panel.Width, Strip.y), ResolveCssColour(0xFFFFFF12));

    const float TransportW = 224.0f;
    const float TracksX    = Strip.x + 14.0f + TransportW + 12.0f;
    const float TracksW    = Strip.x + Panel.Width - 14.0f - TracksX;
    const float RowsY      = Strip.y + 9.0f;

    ImGui::PushID("TimelineStrip");
    const ImVec2 PlayMin(Strip.x + 14.0f, RowsY + 0.5f * (StripTall - 18.0f - 30.0f));
    const ImVec2 PlayMax(PlayMin.x + 30.0f, PlayMin.y + 30.0f);
    DrawList->AddCircleFilled(ImVec2(PlayMin.x + 15.0f, PlayMin.y + 15.0f), 15.0f, ResolveCssColour(0x1A1A1AFF), 32);
    DrawList->AddCircle(ImVec2(PlayMin.x + 15.0f, PlayMin.y + 15.0f), 15.0f,
                        State.ClockPlaying ? ResolveCssColour(0x3EC46D73) : ResolveCssColour(0xFFFFFF24), 32, 1.0f);
    (void)GlyphSymbol::Construct(DrawList, State.ClockPlaying ? "StudioFieldPause" : "StudioFieldPlay",
                                 ImVec2(PlayMin.x + 8.5f, PlayMin.y + 8.5f), 13.0f, 1.8f,
                                 State.ClockPlaying ? ResolveCssColour(0x3EC46DFF) : ResolveCssColour(0xEFEFEFFF));
    RecordRect(State, "Timeline/Play", PlayMin, PlayMax);
    if (InvisibleRect("##Play", PlayMin, PlayMax)) State.ClockPlaying = !State.ClockPlaying;

    char ClockText[32]{};
    char ClockSmall[32]{};
    std::snprintf(ClockText, sizeof(ClockText), "%.1f s", State.ClockTime);
    std::snprintf(ClockSmall, sizeof(ClockSmall), " / %.0fs", State.TimelineDuration);
    const float ClockX = PlayMin.x + 37.0f;
    const float ClockY = PlayMin.y + 15.0f - 0.5f * 11.5f * 1.4f;
    const float ClockWide = Cursor.Measure(Faces.Monospace, 11.5f, ClockText);
    Cursor.Text(Faces.Monospace, 11.5f, ClockX, ClockY, 1.4f, ResolveCssColour(0xEFEFEFFF), ClockText);
    Cursor.Text(Faces.Monospace, 10.0f, ClockX + ClockWide + 2.0f, ClockY + 1.0f, 1.4f, ResolveCssColour(0x5E5E5EFF), ClockSmall);

    const char* RateLabels[2] = { "×1", "×10" };
    const int   RateValues[2] = { 1, 10 };
    float RateX = ClockX + 74.0f + 7.0f;
    for (int Rate = 0; Rate < 2; ++Rate)
    {
        const float PillWide = Cursor.Measure(Faces.Medium, 11.0f, RateLabels[Rate]) + 18.0f;
        const ImVec2 Min(RateX, PlayMin.y + 2.0f);
        const ImVec2 Max(RateX + PillWide, PlayMin.y + 28.0f);
        const bool   Active = State.ClockRate == RateValues[Rate];
        if (Active) DrawList->AddRectFilled(Min, Max, ResolveCssColour(0xEFF4CFFF), 8.0f);
        Cursor.Text(Faces.Medium, 11.0f, Min.x + 9.0f, Min.y + 13.0f - 0.5f * 11.0f * 1.38f, 1.38f,
                    ResolveCssColour(Active ? 0x0B0B0BFF : 0xBCBCBCFF), RateLabels[Rate]);
        ImGui::PushID(Rate);
        char RectName[40]{};
        std::snprintf(RectName, sizeof(RectName), "Timeline/Rate%d", Rate);
        RecordRect(State, RectName, Min, Max);
        if (InvisibleRect("##Rate", Min, Max)) State.ClockRate = RateValues[Rate];
        ImGui::PopID();
        RateX += PillWide + 7.0f;
    }

    const ImVec2 RulerMin(TracksX, RowsY);
    const ImVec2 RulerMax(TracksX + TracksW, RowsY + 16.0f);
    DrawList->AddLine(ImVec2(RulerMin.x, RulerMax.y), RulerMax, ResolveCssColour(0xFFFFFF12));
    for (int Tick = 0; Tick <= 4; ++Tick)
    {
        const float X = RulerMin.x + (RulerMax.x - RulerMin.x) * Tick / 4.0f;
        DrawList->AddLine(ImVec2(X, RulerMin.y), ImVec2(X, RulerMax.y), ResolveCssColour(0xFFFFFF12));
        char TickText[16]{};
        std::snprintf(TickText, sizeof(TickText), "%.0fs", (Tick / 4.0) * State.TimelineDuration);
        Cursor.Text(Faces.Regular, 9.0f, X + 4.0f, RulerMin.y + 1.0f, 1.3f, ResolveCssColour(0x5E5E5EFF), TickText);
    }
    RecordRect(State, "Timeline/Ruler", RulerMin, RulerMax);
    ImGui::SetCursorScreenPos(RulerMin);
    ImGui::InvisibleButton("##RulerScrub", ImVec2(RulerMax.x - RulerMin.x, 16.0f), ImGuiButtonFlags_EnableNav);
    if (ImGui::IsItemActive() && ImGui::IsMouseDown(ImGuiMouseButton_Left))
    {
        const float Share = std::clamp((ImGui::GetIO().MousePos.x - RulerMin.x) / std::max(1.0f, RulerMax.x - RulerMin.x), 0.0f, 1.0f);
        State.ClockTime   = Share * State.TimelineDuration;
    }

    float LaneY = RulerMax.y;
    int   LaneOrdinal = 0;
    for (size_t Index = 0; Index < State.Sources.size(); ++Index)
    {
        const ForceFieldWorkspaceSource& Source = State.Sources[Index];
        if (Source.Activation == ForceFieldActivationAlways) continue;
        if (LaneY + 20.0f > RulerMax.y + LanesTall + 1.0f) break;
        const bool   SelectedLane = State.Selected == static_cast<int>(Index);
        const ImVec2 LaneMin(TracksX, LaneY);
        const ImVec2 LaneMax(TracksX + TracksW, LaneY + 20.0f);
        Cursor.Text(Faces.Regular, 10.5f, TracksX, LaneY + 10.0f - 0.5f * 10.5f * 1.4f, 1.4f,
                    ResolveCssColour(SelectedLane ? 0xEFEFEFFF : 0x848484FF), Source.Name.c_str());
        const ImVec2 TrackMin(TracksX + 120.0f, LaneY + 7.0f);
        const ImVec2 TrackMax(TracksX + TracksW - 56.0f, LaneY + 13.0f);
        DrawList->AddRectFilled(TrackMin, TrackMax, ResolveCssColour(0x1C1C1CFF), 3.0f);
        ImU32 WindowFill = ResolveCssColour(0x8FD3C4A6);
        const int Contribution = QueryForceFieldType(Source.Type).Contribution;
        if (Contribution == ForceFieldContributionAccelerate) WindowFill = ResolveCssColour(0xE8C27AA6);
        else if (Contribution == ForceFieldContributionDamp) WindowFill = ResolveCssColour(0xC084FCA6);
        DrawList->PushClipRect(TrackMin, TrackMax, true);
        if (Source.Activation == ForceFieldActivationWindow)
        {
            const double Length = Source.Lasts > 0.0 ? Source.Lasts : State.TimelineDuration;
            const double Repeat = Source.Repeats > 0.0 ? Source.Repeats : State.TimelineDuration * 2.0;
            for (double Start = Source.Begins; Start < State.TimelineDuration; Start += Repeat)
            {
                const double End = std::min(State.TimelineDuration, Start + Length);
                DrawList->AddRectFilled(ImVec2(TrackMin.x + (TrackMax.x - TrackMin.x) * Start / State.TimelineDuration, TrackMin.y),
                                        ImVec2(TrackMin.x + (TrackMax.x - TrackMin.x) * End / State.TimelineDuration, TrackMax.y),
                                        WindowFill, 3.0f);
            }
        }
        else if (Source.TriggeredAt >= 0.0)
        {
            const double End = Source.Lasts > 0.0 ? std::min(State.TimelineDuration, Source.TriggeredAt + Source.Lasts)
                                                  : State.TimelineDuration;
            DrawList->AddRectFilled(ImVec2(TrackMin.x + (TrackMax.x - TrackMin.x) * Source.TriggeredAt / State.TimelineDuration, TrackMin.y),
                                    ImVec2(TrackMin.x + (TrackMax.x - TrackMin.x) * End / State.TimelineDuration, TrackMax.y), WindowFill,
                                    3.0f);
        }
        DrawList->PopClipRect();
        ImGui::PushID(LaneOrdinal);
        // 📝 The FIRE key submits before the lane: ImGui awards a press to the first overlapping item.
        bool FirePressed = false;
        if (Source.Activation == ForceFieldActivationTrigger)
        {
            const ImVec2 FireMin(TracksX + TracksW - 48.0f, LaneY + 1.0f);
            const ImVec2 FireMax(TracksX + TracksW, LaneY + 19.0f);
            char FireName[48]{};
            std::snprintf(FireName, sizeof(FireName), "Timeline/Fire%d", LaneOrdinal);
            RecordRect(State, FireName, FireMin, FireMax);
            FirePressed = InvisibleRect("##LaneFire", FireMin, FireMax);
        }
        char LaneName[48]{};
        std::snprintf(LaneName, sizeof(LaneName), "Timeline/Lane%d", LaneOrdinal);
        RecordRect(State, LaneName, LaneMin, LaneMax);
        if (InvisibleRect("##Lane", LaneMin, LaneMax)) State.Selected = static_cast<int>(Index);
        if (Source.Activation == ForceFieldActivationTrigger)
        {
            const ImVec2 FireMin(TracksX + TracksW - 48.0f, LaneY + 1.0f);
            const ImVec2 FireMax(TracksX + TracksW, LaneY + 19.0f);
            DrawList->AddRectFilled(FireMin, FireMax, ResolveCssColour(0xE8C27A1F), 9.0f);
            DrawList->AddRect(FireMin, FireMax, ResolveCssColour(0xE8C27A73), 9.0f, ImDrawFlags_None, 1.0f);
            const float FireWide = Cursor.Measure(Faces.Medium, 9.0f, "FIRE");
            Cursor.Text(Faces.Medium, 9.0f, FireMin.x + 0.5f * (48.0f - FireWide), LaneY + 10.0f - 0.5f * 9.0f * 1.3f, 1.3f,
                        ResolveCssColour(0xE8C27AFF), "FIRE");
            if (FirePressed)
            {
                State.Selected = static_cast<int>(Index);
                (void)FireForceFieldWorkspaceSource(State, static_cast<int>(Index));
            }
        }
        ImGui::PopID();
        LaneY += 20.0f;
        ++LaneOrdinal;
    }
    if (TimedCount == 0)
    {
        Cursor.Text(Faces.Regular, 10.5f, TracksX, RulerMax.y + 6.0f, 1.4f, ResolveCssColour(0x5E5E5EFF),
                    "All active forcefields are steady · assign Window or Trigger timing in Inspector.");
    }

    const float PlayX = RulerMin.x + (RulerMax.x - RulerMin.x) * static_cast<float>(State.ClockTime / State.TimelineDuration);
    DrawList->AddLine(ImVec2(PlayX, RowsY), ImVec2(PlayX, RowsY + TracksTall), ResolveCssColour(0xFFFFFFFF), 2.0f);
    ImGui::PopID();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    LOG DRAWER & LIBRARY
//------------------------------------------------------------------------------------------------------------------------

void ConstructLogDrawer(ForceFieldWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Min, ImVec2 Max)
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
    const float LiveWide = Panel.Measure(Faces.Regular, 9.0f, "LIVE") + 14.0f;
    DrawList->AddRectFilled(ImVec2(TitleX, Head.y + 13.0f), ImVec2(TitleX + LiveWide, Head.y + 31.0f), ResolveCssColour(0x3EC46D24),
                            9.0f);
    Panel.Text(Faces.Regular, 9.0f, TitleX + 7.0f, Head.y + 22.0f - 0.5f * 9.0f * 1.4f, 1.4f, ResolveCssColour(0x3EC46DFF), "LIVE");
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
    for (const ForceFieldWorkspaceLogEntry& Entry : State.Log)
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
        Content.Text(Faces.Regular, 11.0f, Row.x + 4.0f + 142.0f, Row.y + 4.0f, 1.4f, ResolveCssColour(0x848484FF), Line);
    }
    ImGui::SetCursorScreenPos(ImVec2(Content.X, Content.Y));
    ImGui::Dummy(ImVec2(1.0f, 1.0f));
    ImGui::EndChild();
    ImGui::PopStyleColor();
    ImGui::PopID();
}

void ConstructLibrarySheet(ForceFieldWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 RootMin, ImVec2 RootMax,
                         AssetBrowserLink* Link)
{
    if (!State.LibraryOpen) return;
    ImDrawList* const DrawList = ImGui::GetWindowDrawList();
    DrawList->AddRectFilled(RootMin, RootMax, ResolveCssColour(0x050507C2));

    ImGui::PushID("LibraryVeil");

    const float SheetWide = std::min(900.0f, (RootMax.x - RootMin.x) - 48.0f);
    const float SheetTall = std::min(0.86f * (RootMax.y - RootMin.y), (RootMax.y - RootMin.y) - 48.0f);
    const ImVec2 SheetMin(0.5f * (RootMin.x + RootMax.x - SheetWide), 0.5f * (RootMin.y + RootMax.y - SheetTall));
    const ImVec2 SheetMax(SheetMin.x + SheetWide, SheetMin.y + SheetTall);
    DrawList->AddRectFilled(SheetMin, SheetMax, ResolveCssColour(0x121212FF), 22.0f);
    DrawList->AddRect(SheetMin, SheetMax, ResolveCssColour(0xFFFFFF24), 22.0f, ImDrawFlags_None, 1.0f);
    bool CloseClicked = false;

    PanelCursor Sheet{ DrawList, &Faces, 1.0f, SheetMin.x + 20.0f, SheetWide - 40.0f, SheetMin.y + 20.0f };
    const ImVec2 Head = Sheet.Space(30.0f, 0.0f, 12.0f);
    Sheet.Text(Faces.Light, 18.0f, Head.x, Head.y + 15.0f - 0.5f * 18.0f * 1.3f, 1.3f, ResolveCssColour(0xF4F4F4FF),
               "Place Forcefield or Wind Generator", -0.3f);
    const ImVec2 CloseMax(Head.x + Sheet.Width, Head.y + 30.0f);
    const ImVec2 CloseMin(CloseMax.x - 30.0f, Head.y);
    DrawList->AddCircleFilled(ImVec2(CloseMin.x + 15.0f, CloseMin.y + 15.0f), 15.0f, ResolveCssColour(0x1A1A1AFF), 32);
    DrawList->AddCircle(ImVec2(CloseMin.x + 15.0f, CloseMin.y + 15.0f), 15.0f, ResolveCssColour(0xFFFFFF24), 32, 1.0f);
    (void)GlyphSymbol::Construct(DrawList, "StudioFieldClose", ImVec2(CloseMin.x + 8.5f, CloseMin.y + 8.5f), 13.0f, 1.8f,
                                 ResolveCssColour(0xEFEFEFFF));
    RecordRect(State, "Library/Close", CloseMin, CloseMax);
    if (InvisibleRect("##LibraryClose", CloseMin, CloseMax)) CloseClicked = true;

    ImGui::SetCursorScreenPos(ImVec2(SheetMin.x + 20.0f, Sheet.Y));
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0, 0, 0));
    ImGui::BeginChild("##LibraryScroll", ImVec2(SheetWide - 40.0f, SheetMax.y - 20.0f - Sheet.Y), false,
                      ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
    ImDrawList* const InnerList = ImGui::GetWindowDrawList();
    PanelCursor       Content{ InnerList, &Faces, 1.0f, SheetMin.x + 20.0f, SheetWide - 40.0f, Sheet.Y };

    // 📝 The native library is inline so type choice arms an actual workspace placement, not a browser handoff.
    {
        constexpr int Columns = 3;
        constexpr float Gap = 8.0f;
        const float CardWide = (Content.Width - Gap * (Columns - 1)) / Columns;
        const int TypeCount = QueryForceFieldTypeCount();
        for (int Row = 0; Row < (TypeCount + Columns - 1) / Columns; ++Row)
        {
            const ImVec2 RowTop = Content.Space(66.0f, Row == 0 ? 8.0f : 0.0f, 7.0f);
            for (int Column = 0; Column < Columns; ++Column)
            {
                const int TypeIndex = Row * Columns + Column;
                if (TypeIndex >= TypeCount) break;
                const ForceFieldWorkspaceType& Type = QueryForceFieldType(TypeIndex);
                const ImVec2 CardMin(RowTop.x + Column * (CardWide + Gap), RowTop.y);
                const ImVec2 CardMax(CardMin.x + CardWide, CardMin.y + 66.0f);
                const ImU32 Accent = ResolveCssColour(Type.Colour);
                InnerList->AddRectFilled(CardMin, CardMax, ResolveCssColour(0x1A1A1AFF), 13.0f);
                InnerList->AddRect(CardMin, CardMax, ResolveAlpha(Accent, 0.32f), 13.0f, ImDrawFlags_None, 1.0f);
                const ImVec2 GlyphAt(CardMin.x + 12.0f, CardMin.y + 15.0f);
                (void)GlyphSymbol::Construct(InnerList, Type.Glyph, GlyphAt, 19.0f, 1.8f, Accent);
                Content.Text(Faces.Medium, 11.0f, CardMin.x + 40.0f, CardMin.y + 12.0f, 1.3f, ResolveCssColour(0xE8E8E8FF), Type.Name);
                Content.Text(Faces.Regular, 9.5f, CardMin.x + 40.0f, CardMin.y + 34.0f, 1.35f,
                             ResolveCssColour(0x868686FF), QueryForceFieldContributionUnit(Type.Contribution));
                char RectName[40]{};
                std::snprintf(RectName, sizeof(RectName), "Library/Type%d", TypeIndex);
                RecordRect(State, RectName, CardMin, CardMax);
                ImGui::PushID(TypeIndex);
                if (InvisibleRect("##LibraryType", CardMin, CardMax))
                {
                    State.PlacementType = TypeIndex;
                    State.LibraryOpen = false;
                    char Message[128]{};
                    std::snprintf(Message, sizeof(Message), "Placement armed: %s", Type.Name);
                    AppendForceFieldWorkspaceLog(State, "PLACE", Message, "click or drag the live slice to place", "Place");
                }
                ImGui::PopID();
            }
        }
        const ImVec2 Browse = Content.Space(56.0f, 8.0f, 0.0f);
        const ImVec2 BrowseMin(Browse.x, Browse.y);
        const ImVec2 BrowseMax(Browse.x + Content.Width, Browse.y + 56.0f);
        InnerList->AddRectFilled(BrowseMin, BrowseMax, ResolveCssColour(0x171717FF), 14.0f);
        InnerList->AddRect(BrowseMin, BrowseMax, ResolveCssColour(0xFFFFFF18), 14.0f, ImDrawFlags_None, 1.0f);
        Content.Text(Faces.Medium, 11.0f, BrowseMin.x + 14.0f, BrowseMin.y + 11.0f, 1.3f,
                     ResolveCssColour(0xBDBDBDFF), "Browse the shared Asset Browser");
        Content.Text(Faces.Regular, 9.5f, BrowseMin.x + 14.0f, BrowseMin.y + 31.0f, 1.35f,
                     ResolveCssColour(0x777777FF), "17 native source types are also available above");
        RecordRect(State, "Library/Browse", BrowseMin, BrowseMax);
        if (InvisibleRect("##LibraryBrowse", BrowseMin, BrowseMax))
        {
            if (Link != nullptr)
            {
                Link->OpenRequested = true;
                Link->OpenWorkspace = AssetBrowserWorkspaceForceField;
            }
            else Toast::Show("The Asset Browser is not attached in this shell.");
            State.LibraryOpen = false;
        }
    }

    ImGui::SetCursorScreenPos(ImVec2(Content.X, Content.Y));
    ImGui::Dummy(ImVec2(1.0f, 1.0f));
    ImGui::EndChild();
    ImGui::PopStyleColor();

    // 📝 The veil submits after every card so the sheet wins its own presses; a press anywhere else dismisses.
    RecordRect(State, "Library/Veil", RootMin, RootMax);
    if (InvisibleRect("##Veil", RootMin, RootMax))
    {
        const ImVec2 Mouse = ImGui::GetIO().MousePos;
        if (Mouse.x < SheetMin.x || Mouse.x > SheetMax.x || Mouse.y < SheetMin.y || Mouse.y > SheetMax.y) CloseClicked = true;
    }
    ImGui::PopID();
    if (CloseClicked) State.LibraryOpen = false;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    ROOT
//------------------------------------------------------------------------------------------------------------------------

void ApplyForceFieldWorkspaceLink(ForceFieldWorkspaceState& State, AssetBrowserLink* Link)
{
    if (Link == nullptr || !Link->HasHandoff() || Link->OpenRecordWorkspace != AssetBrowserWorkspaceForceField) return;
    static constexpr const char* Prefix = "forcefield/";
    const char*                  Raw    = Link->OpenRecordId;
    int                          Type   = -1;
    if (std::strncmp(Raw, Prefix, std::strlen(Prefix)) == 0)
        Type = QueryForceFieldTypeById(Raw + std::strlen(Prefix));
    if (Type < 0)
    {
        char Message[192]{};
        std::snprintf(Message, sizeof(Message), "Asset \u201C%s\u201D is not a forcefield type", Raw);
        AppendForceFieldWorkspaceLog(State, "PLACE", Message);
        Link->ClearHandoff();
        return;
    }
    // 📝 The handoff arms placement exactly like the old library card did.
    char ArmedMessage[128]{};
    std::snprintf(ArmedMessage, sizeof(ArmedMessage), "Placement armed: %s", QueryForceFieldType(Type).Name);
    State.PlacementType = Type;
    State.LibraryOpen   = false;
    AppendForceFieldWorkspaceLog(State, "PLACE", ArmedMessage, "click viewport to drop", "Place");
    Link->ClearHandoff();
}

void ConstructForceFieldWorkspace(ForceFieldWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Size,
                                  AssetBrowserLink* Link)
{
    ApplyForceFieldWorkspaceLink(State, Link);
    State.Rects.clear();
    if (State.TimelineDuration <= 0.0) State.TimelineDuration = 60.0;
    if (State.ClockPlaying)
    {
        State.ClockTime += static_cast<double>(ImGui::GetIO().DeltaTime) * State.ClockRate;
        if (State.ClockTime > State.TimelineDuration) State.ClockTime = std::fmod(State.ClockTime, State.TimelineDuration);
    }
    if (State.View.Follow >= 0 && static_cast<size_t>(State.View.Follow) < State.Sources.size())
    {
        State.View.CentreX = State.Sources[static_cast<size_t>(State.View.Follow)].Centre[0];
        State.View.CentreZ = -State.Sources[static_cast<size_t>(State.View.Follow)].Centre[2];
    }
    SynchronizeForceFieldWorkspaceRuntime(State);
    if (State.PlacementType >= 0 && ImGui::IsKeyPressed(ImGuiKey_Escape) && !ImGui::GetIO().WantTextInput)
        State.PlacementType = -1;

    ImGui::SetNextWindowPos(ImVec2(0.0f, 0.0f));
    ImGui::SetNextWindowSize(Size);
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImGui::ColorConvertU32ToFloat4(ResolveCssColour(0x0B0B0BFF)));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
    ImGui::Begin("##ForceFieldWorkspace", nullptr,
                 ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoScrollbar |
                     ImGuiWindowFlags_NoScrollWithMouse);
    ImGui::PopStyleVar(2);
    ImGui::PopStyleColor();
    ImDrawList* const DrawList = ImGui::GetWindowDrawList();

    PanelCursor Root{ DrawList, &Faces, 1.0f, 12.0f, Size.x - 24.0f, 10.0f };
    ConstructTopBar(State, Root);

    const float WorkspaceY = Root.Y;
    const float WorkspaceH = Size.y - WorkspaceY - 12.0f;
    const float OutlinerWide = Size.x >= 1280.0f ? 296.0f : 256.0f;
    const float InspectorWide = Size.x >= 1280.0f ? 392.0f : 348.0f;
    const ImVec2 OutlinerMin(12.0f, WorkspaceY);
    const ImVec2 OutlinerMax(12.0f + OutlinerWide, WorkspaceY + WorkspaceH);
    const ImVec2 InspectorMax(Size.x - 12.0f, WorkspaceY + WorkspaceH);
    const ImVec2 InspectorMin(InspectorMax.x - InspectorWide, WorkspaceY);
    const ImVec2 CentreMin(OutlinerMax.x + 10.0f, WorkspaceY);
    const ImVec2 CentreMax(InspectorMin.x - 10.0f, WorkspaceY + WorkspaceH);

    ConstructOutlinerPanel(State, Faces, OutlinerMin, OutlinerMax);

    // 📝 Centre column: viewport panel plus the optional 156 px log drawer.
    const float LogTall = State.LogOpen ? 156.0f : 0.0f;
    const float LogGap  = State.LogOpen ? 10.0f : 0.0f;
    const ImVec2 ViewportMax(CentreMax.x, CentreMax.y - LogTall - LogGap);
    DrawList->AddRectFilled(CentreMin, ViewportMax, ResolveCssColour(0x121212FF), 22.0f);
    PanelCursor Viewport{ DrawList, &Faces, 1.0f, CentreMin.x, ViewportMax.x - CentreMin.x, CentreMin.y };
    const float ViewportTop = Viewport.Y;
    ConstructViewportToolbar(State, Viewport);
    // 📝 Square toolbar/surface fills would poke past the rounded panel corners, so the toolbar rounds its top.
    DrawList->AddRectFilled(ImVec2(CentreMin.x, ViewportTop), ImVec2(ViewportMax.x, ViewportTop + 8.0f), ResolveCssColour(0x121212FF),
                            22.0f, ImDrawFlags_RoundCornersTop);

    const ImVec2 SurfaceMin(CentreMin.x, Viewport.Y);
    const float FooterTall = 30.0f;
    // 📝 The timeline height repeats the strip's own arithmetic so the surface fills exactly.
    int TimedCount = 0;
    for (const ForceFieldWorkspaceSource& Source : State.Sources)
    {
        if (Source.Activation != ForceFieldActivationAlways) ++TimedCount;
    }
    const float LanesTall  = TimedCount > 0 ? std::min(TimedCount * 20.0f, 58.0f) : 22.0f;
    const float StripTall  = 18.0f + std::max(30.0f, 16.0f + LanesTall);
    const ImVec2 SurfaceMax(ViewportMax.x, ViewportMax.y - StripTall - FooterTall);
    if (State.ViewMode == 0) ConstructMapSurface(State, Faces, DrawList, SurfaceMin, SurfaceMax);
    else ConstructStage3DSurface(State, Faces, DrawList, SurfaceMin, SurfaceMax);
    Viewport.Y = SurfaceMax.y;

    ConstructTimelineStrip(State, Faces, Viewport);

    const ImVec2 Foot = Viewport.Space(FooterTall);
    DrawList->AddLine(ImVec2(CentreMin.x, Foot.y), ImVec2(ViewportMax.x, Foot.y), ResolveCssColour(0xFFFFFF12));
    PanelCursor FootCursor{ DrawList, &Faces, 1.0f, CentreMin.x, ViewportMax.x - CentreMin.x, Foot.y };
    FootCursor.Text(Faces.Regular, 10.5f, CentreMin.x + 14.0f, Foot.y + 15.0f - 0.5f * 10.5f * 1.4f, 1.4f,
                    ResolveCssColour(0x848484FF), "Native ForceFieldSpace · live RK2 streamlines + vectors · editable bounded sources");
    const float LogPillWide = FootCursor.Measure(Faces.Medium, 11.0f, "Log Stream") + 18.0f;
    const ImVec2 LogPillMax(ViewportMax.x - 14.0f, Foot.y + 26.0f);
    const ImVec2 LogPillMin(LogPillMax.x - LogPillWide, Foot.y + 4.0f);
    FootCursor.Text(Faces.Medium, 11.0f, LogPillMin.x + 9.0f, Foot.y + 15.0f - 0.5f * 11.0f * 1.38f, 1.38f,
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
    const float TagWide = Inspector.Measure(Faces.Regular, 10.5f, "Bounded · Ready");
    Inspector.Text(Faces.Regular, 10.5f, InspectorMax.x - 16.0f - TagWide, InspectorHead.y + 22.0f - 0.5f * 10.5f * 1.4f, 1.4f,
                   ResolveCssColour(0x848484FF), "Bounded · Ready");
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
        ConstructForceFieldWorkspaceInspector(State, Faces, Column);
        Column.Finalize();
    }
    ImGui::EndChild();
    ImGui::PopStyleColor();

    ConstructLibrarySheet(State, Faces, ImVec2(0.0f, 0.0f), Size, Link);
    Toast::Construct();
    ImGui::End();
}

} // namespace Frontier

