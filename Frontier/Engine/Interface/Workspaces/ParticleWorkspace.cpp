/*==========================================================================================================================================
                                                          PARTICLEWORKSPACE.CPP
==========================================================================================================================================*/
// 🧩 The Particle Workspace shell: top bar, outliner, Stage / Plan viewport, transport, log drawer, the 52-preset
//    library, and the TOML export preview. Everything drawn here is local view state or static decor; commands that
//    would reach the engines raise an explicit NOOP toast and warm log line instead (see ParticleWorkspace.h). Camera
//    drags and the camera/overlay selects are local and silent; the clock, alive, rate, and CPU readings are frozen
//    honest zeros.

#include "Engine/Interface/Workspaces/ParticleWorkspace.h"

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

void RecordRect(ParticleWorkspaceState& State, const char* Name, ImVec2 Min, ImVec2 Max)
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

void ArrowHead(ImDrawList* DrawList, ImVec2 Tip, ImVec2 Direction, float Size, ImU32 Colour, float Width)
{
    const ImVec2 Left(Tip.x - Direction.x * Size - Direction.y * Size * 0.45f, Tip.y - Direction.y * Size + Direction.x * Size * 0.45f);
    const ImVec2 Right(Tip.x - Direction.x * Size + Direction.y * Size * 0.45f, Tip.y - Direction.y * Size - Direction.x * Size * 0.45f);
    DrawList->AddLine(Tip, Left, Colour, Width);
    DrawList->AddLine(Tip, Right, Colour, Width);
}

int QueryCapacitySum(const ParticleWorkspaceState& State) noexcept
{
    int Sum = 0;
    for (const ParticleWorkspaceEffect& Effect : State.Effects) Sum += Effect.Parameters.Capacity;
    return Sum;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    TOP BAR
//------------------------------------------------------------------------------------------------------------------------

constexpr const char* SceneNames[4] = { "Emission Lab", "Storm Wash", "Clean Bench", "Night Shift" };
constexpr const char* SuiteNames[4] = { "Particles", "Fracture", "Photometric", "Force Field" };

void ConstructTopBar(ParticleWorkspaceState& State, PanelCursor& Root)
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
    const float BadgeWide = Root.Measure(Root.Faces->Medium, 9.5f, "PARTICLES", 0.9f * S) + 18.0f * S;
    const ImVec2 BadgeMin(Cursor, MidY - 11.0f * S);
    const ImVec2 BadgeMax(Cursor + BadgeWide, MidY + 11.0f * S);
    DrawList->AddRectFilled(BadgeMin, BadgeMax, ResolveCssColour(0xE8C27A1C), 11.0f * S);
    DrawList->AddRect(BadgeMin, BadgeMax, ResolveCssColour(0xE8C27A38), 11.0f * S, ImDrawFlags_None, S);
    Root.Text(Root.Faces->Medium, 9.5f, Cursor + 9.0f * S, MidY - 0.5f * 9.5f * 1.4f * S, 1.4f, ResolveCssColour(0xE8C27AFF),
              "PARTICLES", 0.9f * S);

    // 📝 Scene tabs: centred strip; switching scenes is engine work, so every tab is an explicit NOOP.
    float TabsWide = 0.0f;
    float TabWidths[4]{};
    for (int Tab = 0; Tab < 4; ++Tab)
    {
        TabWidths[Tab] = Root.Measure(Root.Faces->Medium, 11.5f, SceneNames[Tab]) + 22.0f * S;
        TabsWide += TabWidths[Tab] + (Tab > 0 ? 4.0f * S : 0.0f);
    }
    float TabX = Bar.x + 0.5f * (Root.Width - TabsWide);
    ImGui::PushID("SceneTabs");
    for (int Tab = 0; Tab < 4; ++Tab)
    {
        const ImVec2 Min(TabX, MidY - 13.0f * S);
        const ImVec2 Max(TabX + TabWidths[Tab], MidY + 13.0f * S);
        const bool   Active = Tab == State.Scene;
        if (Active) DrawList->AddRectFilled(Min, Max, ResolveCssColour(0xE8C27AFF), 9.0f * S);
        Root.Text(Root.Faces->Medium, 11.5f, Min.x + 11.0f * S, MidY - 0.5f * 11.5f * 1.38f * S, 1.38f,
                  ResolveCssColour(Active ? 0x0B0B0BFF : 0x848484FF), SceneNames[Tab]);
        ImGui::PushID(Tab);
        char RectName[32]{};
        std::snprintf(RectName, sizeof(RectName), "Top/Scenario%d", Tab);
        RecordRect(State, RectName, Min, Max);
        if (InvisibleRect("##Scene", Min, Max) && Tab != State.Scene)
        {
            NoopParticleWorkspaceCommand(State, "SCENE", "Scene switch refused", "Scene tabs are NOOPs in this shell");
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
        const bool   Current = Link == 0;
        const ImVec2 Max(LinkX, MidY + 12.0f * S);
        const ImVec2 Min(LinkX - LinkWidths[Link], MidY - 12.0f * S);
        if (Current) DrawList->AddRectFilled(Min, Max, ResolveCssColour(0xE8C27A1F), 8.0f * S);
        Root.Text(Root.Faces->Regular, 11.0f, Min.x + 9.0f * S, MidY - 0.5f * 11.0f * 1.38f * S, 1.38f,
                  ResolveCssColour(Current ? 0xE8C27AFF : 0x848484FF), SuiteNames[Link]);
        ImGui::PushID(Link);
        char RectName[32]{};
        std::snprintf(RectName, sizeof(RectName), "Top/Suite%d", Link);
        RecordRect(State, RectName, Min, Max);
        if (InvisibleRect("##Suite", Min, Max) && !Current)
        {
            NoopParticleWorkspaceCommand(State, "WORKSPACE", "Suite jump refused", "Suite links are NOOPs in this shell");
        }
        ImGui::PopID();
        LinkX -= LinkWidths[Link] + 4.0f * S;
    }
    ImGui::PopID();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    OUTLINER
//------------------------------------------------------------------------------------------------------------------------

void ConstructOutlinerPanel(ParticleWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Min, ImVec2 Max)
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
    DrawList->AddRectFilled(AddMin, AddMax, ResolveCssColour(0xE8C27AFF), 9.0f);
    Panel.Text(Faces.SemiBold, 15.0f, AddMin.x + 8.0f, AddMin.y + 3.0f, 1.4f, ResolveCssColour(0x0B0B0BFF), "+");
    ImGui::PushID("OutlinerPanel");
    RecordRect(State, "Outliner/Add", AddMin, AddMax);
    // 📝 Adding effects would mutate the scene: the + key is an explicit NOOP (the library is read-only here).
    if (InvisibleRect("##Add", AddMin, AddMax))
    {
        NoopParticleWorkspaceCommand(State, "SCENE", "Add effect refused", "Adding effects is a NOOP in this shell");
    }

    const ImVec2 FootMin(Min.x, Max.y - 30.0f);
    DrawList->AddLine(ImVec2(Min.x, FootMin.y), ImVec2(Max.x, FootMin.y), ResolveCssColour(0xFFFFFF12));
    DrawList->AddRectFilled(ImVec2(Min.x, FootMin.y), Max, ResolveCssColour(0xFFFFFF04), 0.0f);
    char Foot[96]{};
    std::snprintf(Foot, sizeof(Foot), "%d staged effects · engine off", static_cast<int>(State.Effects.size()));
    Panel.Text(Faces.Regular, 10.0f, Min.x + 16.0f, FootMin.y + 15.0f - 0.5f * 10.0f * 1.4f, 1.4f, ResolveCssColour(0x6E6E6EFF), Foot);

    ImGui::SetCursorScreenPos(ImVec2(Min.x, Head.y + 44.0f));
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0, 0, 0));
    ImGui::BeginChild("##OutlinerScroll", ImVec2(Max.x - Min.x, FootMin.y - Head.y - 44.0f), false,
                      ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
    ImDrawList* const InnerList = ImGui::GetWindowDrawList();
    PanelCursor       Content{ InnerList, &Faces, 1.0f, Min.x + 12.0f, Max.x - Min.x - 24.0f, Head.y + 44.0f + 12.0f };

    int EffectsOn = 0;
    for (const ParticleWorkspaceEffect& Effect : State.Effects)
    {
        if (Effect.Enabled) ++EffectsOn;
    }
    int ForcesOn = 0;
    for (const ParticleWorkspaceForce& Force : State.Forces)
    {
        if (Force.Enabled) ++ForcesOn;
    }
    const ImVec2 Metrics = Content.Space(58.0f, 0.0f, 10.0f);
    const float  MiniWide = (Content.Width - 7.0f) / 2.0f;
    const char*  MiniLabels[2] = { "Effects on", "Forces on" };
    const int    MiniValues[2] = { EffectsOn, ForcesOn };
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
                     "Search effects & wind…");
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
                             bool Nested, bool Enabled, int Status, bool HasEye, auto Flip)
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
        float StatusRight = HasEye ? EyeMin.x - 4.0f : RowMax.x - 8.0f;
        if (Status >= 0)
        {
            const char* StatusText = Status == 0 ? "Staged" : "Off";
            const float StatusWide = Content.Measure(Faces.Medium, 9.0f, StatusText) + 12.0f;
            const ImVec2 PillMax(StatusRight, Row.y + 28.0f);
            const ImVec2 PillMin(StatusRight - StatusWide, Row.y + 12.0f);
            ImU32 PillFill = ResolveCssColour(0xFFFFFF0F);
            ImU32 PillInk  = ResolveCssColour(0x5E5E5EFF);
            if (Status == 0)
            {
                PillFill = ResolveCssColour(0xE8C27A29);
                PillInk  = ResolveCssColour(0xE8C27AFF);
            }
            InnerList->AddRectFilled(PillMin, PillMax, FadeColour(PillFill, Fade), 8.0f);
            Content.Text(Faces.Medium, 9.0f, PillMin.x + 6.0f, PillMin.y + 3.0f, 1.3f, FadeColour(PillInk, Fade), StatusText);
        }
        ImGui::PushID(RowOrdinal++);
        bool EyePressed = false;
        if (HasEye)
        {
            char EyeTag[48]{};
            std::snprintf(EyeTag, sizeof(EyeTag), "%s/Eye", RectTag);
            RecordRect(State, EyeTag, EyeMin, EyeMax);
            // 📝 The eye submits before the row: ImGui awards a press to the first overlapping item.
            EyePressed = InvisibleRect("##TreeEye", EyeMin, EyeMax);
        }
        RecordRect(State, RectTag, Row, RowMax);
        if (InvisibleRect("##TreeRow", Row, RowMax)) SelectParticleWorkspaceNode(State, RowId);
        if (EyePressed) Flip();
        ImGui::PopID();
        (void)StatusRight;
        if (HasEye)
        {
            (void)GlyphSymbol::Construct(InnerList, Enabled ? "StudioEye" : "StudioEyeOff",
                                         ImVec2(EyeMin.x + 5.5f, EyeMin.y + 5.5f), 13.0f, 1.8f,
                                         FadeColour(ResolveCssColour(0x848484FF), Fade));
        }
    };

    const ImVec2 GroupA = Content.Space(27.0f);
    Content.Text(Faces.Medium, 10.0f, GroupA.x + 6.0f, GroupA.y + 8.0f, 1.4f, ResolveCssColour(0x707070FF), "SCENE & WIND", 0.75f);
    char SceneMeta[96]{};
    std::snprintf(SceneMeta, sizeof(SceneMeta), "%d effects · %d forces", static_cast<int>(State.Effects.size()),
                  static_cast<int>(State.Forces.size()));
    TreeRow("Outliner/Scene", "Particle Scene", SceneMeta, "StudioLayers", ResolveCssColour(0xE8C27AFF),
            ParticleWorkspaceState::SelectedScene, false, true, -1, false, [&] {});
    char WindMeta[96]{};
    std::snprintf(WindMeta, sizeof(WindMeta), "%d of %d awake", ForcesOn, static_cast<int>(State.Forces.size()));
    if (!Filtering || Matches("Ambient Wind"))
    {
        TreeRow("Outliner/Wind", "Ambient Wind", WindMeta, "StudioWind", ResolveCssColour(0x8FD3C4FF),
                ParticleWorkspaceState::SelectedWind, true, ForcesOn > 0, -1, true,
                [&]
                {
                    const bool Wake = ForcesOn == 0;
                    for (ParticleWorkspaceForce& Force : State.Forces) Force.Enabled = Wake;
                    LogParticleWorkspaceValue(State, "WIND", "Lattice", "Awake", Wake ? "all on" : "all off");
                });
    }

    bool AnyEffect = false;
    for (const ParticleWorkspaceEffect& Effect : State.Effects)
    {
        if (Matches(Effect.Name.c_str())) AnyEffect = true;
    }
    if (AnyEffect)
    {
        const ImVec2 Group = Content.Space(27.0f);
        char Title[64]{};
        std::snprintf(Title, sizeof(Title), "EFFECTS (%d)", static_cast<int>(State.Effects.size()));
        Content.Text(Faces.Medium, 10.0f, Group.x + 6.0f, Group.y + 8.0f, 1.4f, ResolveCssColour(0x707070FF), Title, 0.75f);
        for (size_t Index = 0; Index < State.Effects.size(); ++Index)
        {
            ParticleWorkspaceEffect&     Effect = State.Effects[Index];
            const ParticleWorkspacePreset& Preset = QueryParticlePreset(Effect.Preset);
            if (!Matches(Effect.Name.c_str())) continue;
            char Rate[32]{};
            FormatParticleTrimmed(Effect.Parameters.ReleaseRate, 0, Rate, sizeof(Rate));
            char Meta[128]{};
            std::snprintf(Meta, sizeof(Meta), "%s · %s/s · cap %d",
                          QueryParticleBehaviourName(static_cast<int>(Effect.Parameters.Behaviour)), Rate, Effect.Parameters.Capacity);
            char RectTag[48]{};
            std::snprintf(RectTag, sizeof(RectTag), "Outliner/Effect%d", static_cast<int>(Index));
            TreeRow(RectTag, Effect.Name.c_str(), Meta, Preset.Glyph, ResolveCssColour(Preset.Colour), static_cast<int>(Index), true,
                    Effect.Enabled, Effect.Enabled ? 0 : 1, true, [&] { Effect.Enabled = !Effect.Enabled; });
        }
    }

    bool AnyForce = false;
    for (const ParticleWorkspaceForce& Force : State.Forces)
    {
        if (Matches(Force.Name.c_str())) AnyForce = true;
    }
    if (AnyForce)
    {
        const ImVec2 Group = Content.Space(27.0f);
        char Title[64]{};
        std::snprintf(Title, sizeof(Title), "FORCES (%d)", static_cast<int>(State.Forces.size()));
        Content.Text(Faces.Medium, 10.0f, Group.x + 6.0f, Group.y + 8.0f, 1.4f, ResolveCssColour(0x707070FF), Title, 0.75f);
        for (size_t Index = 0; Index < State.Forces.size(); ++Index)
        {
            ParticleWorkspaceForce& Force = State.Forces[Index];
            if (!Matches(Force.Name.c_str())) continue;
            char Strength[32]{};
            FormatParticleTrimmed(Force.Strength, 1, Strength, sizeof(Strength));
            char Span[32]{};
            FormatParticleSpan(Force.Radius, Span, sizeof(Span));
            char Meta[128]{};
            std::snprintf(Meta, sizeof(Meta), "%s m/s · R %s", Strength, Span);
            char RectTag[48]{};
            std::snprintf(RectTag, sizeof(RectTag), "Outliner/Force%d", static_cast<int>(Index));
            TreeRow(RectTag, Force.Name.c_str(), Meta, "StudioWind", ResolveCssColour(0x8FD3C4FF),
                    ParticleWorkspaceState::SelectedForceBase + static_cast<int>(Index), true, Force.Enabled, -1, true,
                    [&] { Force.Enabled = !Force.Enabled; });
        }
    }

    ImGui::SetCursorScreenPos(ImVec2(Content.X, Content.Y));
    ImGui::Dummy(ImVec2(1.0f, 1.0f));
    ImGui::EndChild();
    ImGui::PopStyleColor();
    ImGui::PopID();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    VIEWPORT TOOLBAR
//------------------------------------------------------------------------------------------------------------------------

void ConstructViewportToolbar(ParticleWorkspaceState& State, PanelCursor& Panel)
{
    ImDrawList* const DrawList = Panel.DrawList;
    const char* ModeLabels[2]  = { "Stage", "Plan" };
    float       ModeWide       = 6.0f;
    float       ModePill[2]{};
    for (int Pill = 0; Pill < 2; ++Pill)
    {
        ModePill[Pill] = Panel.Measure(Panel.Faces->Medium, 11.0f, ModeLabels[Pill]) + 18.0f;
        ModeWide += ModePill[Pill] + 3.0f;
    }
    ModeWide += 3.0f;

    const float EngineWide = Panel.Measure(Panel.Faces->SemiBold, 9.0f, "STATIC SHELL", 0.9f) + 20.0f + 6.0f;

    constexpr float GroupTall = 32.0f;
    constexpr float BarTall   = 14.0f + GroupTall;
    const ImVec2    Bar       = Panel.Space(BarTall);
    DrawList->AddRectFilled(ImVec2(Panel.X, Bar.y), ImVec2(Panel.X + Panel.Width, Bar.y + BarTall), ResolveCssColour(0x161616FF));
    DrawList->AddLine(ImVec2(Panel.X, Bar.y + BarTall), ImVec2(Panel.X + Panel.Width, Bar.y + BarTall), ResolveCssColour(0xFFFFFF12));

    ImGui::PushID("ViewportToolbar");
    const float LineY = Bar.y + 7.0f;
    const ImVec2 GroupMin(Panel.X + 12.0f, LineY);
    const ImVec2 GroupMax(GroupMin.x + ModeWide, LineY + GroupTall);
    DrawList->AddRectFilled(GroupMin, GroupMax, ResolveCssColour(0x101010FF), 12.0f);
    DrawList->AddRect(GroupMin, GroupMax, ResolveCssColour(0xFFFFFF12), 12.0f, ImDrawFlags_None, 1.0f);
    float PillX = GroupMin.x + 3.0f;
    constexpr float PillTall = 26.0f;
    for (int Pill = 0; Pill < 2; ++Pill)
    {
        const ImVec2 Min(PillX, LineY + 3.0f);
        const ImVec2 Max(PillX + ModePill[Pill], LineY + 3.0f + PillTall);
        const bool   Active = State.ViewMode == Pill;
        if (Active) DrawList->AddRectFilled(Min, Max, ResolveCssColour(0xE8C27AFF), 8.0f);
        Panel.Text(Panel.Faces->Medium, 11.0f, Min.x + 9.0f, LineY + 3.0f + 13.0f - 0.5f * 11.0f * 1.38f, 1.38f,
                   ResolveCssColour(Active ? 0x0B0B0BFF : 0x848484FF), ModeLabels[Pill]);
        ImGui::PushID(Pill);
        char RectName[40]{};
        std::snprintf(RectName, sizeof(RectName), "Toolbar/Mode%d", Pill);
        RecordRect(State, RectName, Min, Max);
        if (InvisibleRect("##ModePill", Min, Max)) State.ViewMode = Pill;
        ImGui::PopID();
        PillX += ModePill[Pill] + 3.0f;
    }

    // 📝 The engine pill is neutral decor: this shell stages values and simulates nothing.
    const ImVec2 EngineMax(Panel.X + Panel.Width - 12.0f, LineY + GroupTall);
    const ImVec2 EngineMin(EngineMax.x - EngineWide, LineY);
    DrawList->AddRectFilled(EngineMin, EngineMax, ResolveCssColour(0x1A1A1AFF), 12.0f);
    DrawList->AddRect(EngineMin, EngineMax, ResolveCssColour(0xFFFFFF1F), 12.0f, ImDrawFlags_None, 1.0f);
    DrawList->AddCircleFilled(ImVec2(EngineMin.x + 13.0f, LineY + 16.0f), 3.5f, ResolveCssColour(0x6E6E6EFF), 16);
    Panel.Text(Panel.Faces->SemiBold, 9.0f, EngineMin.x + 20.0f, LineY + 16.0f - 0.5f * 9.0f * 1.4f, 1.4f,
               ResolveCssColour(0x9A9A9AFF), "STATIC SHELL", 0.9f);
    RecordRect(State, "Toolbar/Engine", EngineMin, EngineMax);
    ImGui::PopID();
}

} // namespace

void RecordParticleWorkspaceRect(ParticleWorkspaceState& State, const char* Name, ImVec2 Min, ImVec2 Max)
{
    RecordRect(State, Name, Min, Max);
}

namespace
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    STAGE SURFACE
//------------------------------------------------------------------------------------------------------------------------

ImVec2 StageProject(const ParticleWorkspaceState& State, ImVec2 Min, ImVec2 Max, double X, double Y, double Z)
{
    const float Yaw   = static_cast<float>(State.OrbitYaw) * PiSingle / 180.0f;
    const float Pitch = static_cast<float>(State.OrbitPitch) * PiSingle / 180.0f;
    const float Rx    = static_cast<float>(X * std::cos(Yaw) - Z * std::sin(Yaw));
    const float Rz    = static_cast<float>(X * std::sin(Yaw) + Z * std::cos(Yaw));
    const float Scale = std::min(Max.x - Min.x, Max.y - Min.y) / static_cast<float>(std::clamp(State.OrbitDistance, 4.0, 60.0));
    const float Cx    = 0.5f * (Min.x + Max.x);
    const float Cy    = 0.5f * (Min.y + Max.y);
    return ImVec2(Cx + (Rx - static_cast<float>(State.PanX)) * Scale,
                  Cy + ((Rz * std::cos(Pitch) - static_cast<float>(Y) * std::sin(Pitch)) - static_cast<float>(State.PanY)) * Scale);
}

ImVec2 PlanProject(const ParticleWorkspaceState& State, ImVec2 Min, ImVec2 Max, double X, double Z)
{
    const float Scale = std::min(Max.x - Min.x, Max.y - Min.y) / 16.0f;
    const float Cx    = 0.5f * (Min.x + Max.x);
    const float Cy    = 0.5f * (Min.y + Max.y);
    return ImVec2(Cx + (static_cast<float>(X) - static_cast<float>(State.PanX)) * Scale,
                  Cy + (static_cast<float>(Z) - static_cast<float>(State.PanY)) * Scale);
}

float ProjectScale(const ParticleWorkspaceState& State, ImVec2 Min, ImVec2 Max)
{
    if (State.ViewMode == 1) return std::min(Max.x - Min.x, Max.y - Min.y) / 16.0f;
    return std::min(Max.x - Min.x, Max.y - Min.y) / static_cast<float>(std::clamp(State.OrbitDistance, 4.0, 60.0));
}

ImVec2 ProjectPoint(const ParticleWorkspaceState& State, ImVec2 Min, ImVec2 Max, double X, double Y, double Z)
{
    if (State.ViewMode == 1) return PlanProject(State, Min, Max, X, Z);
    return StageProject(State, Min, Max, X, Y, Z);
}

void ConstructStageDecor(ParticleWorkspaceState& State, ImDrawList* DrawList, ImVec2 Min, ImVec2 Max)
{
    DrawList->PushClipRect(Min, Max, true);
    if (State.ShowGrid)
    {
        for (float X = Min.x + 38.0f; X < Max.x; X += 76.0f) DrawList->AddLine(ImVec2(X, Min.y), ImVec2(X, Max.y), ResolveCssColour(0xFFFFFF0B));
        for (float Y = Min.y + 38.0f; Y < Max.y; Y += 76.0f) DrawList->AddLine(ImVec2(Min.x, Y), ImVec2(Max.x, Y), ResolveCssColour(0xFFFFFF0B));
    }
    const float PixelsPerMetre = ProjectScale(State, Min, Max);

    if (State.ShowBounds)
    {
        for (size_t Index = 0; Index < State.Effects.size(); ++Index)
        {
            const ParticleWorkspaceEffect& Effect = State.Effects[Index];
            const ParticleWorkspacePreset& Preset = QueryParticlePreset(Effect.Preset);
            const float Fade = Effect.Enabled ? 1.0f : 0.25f;
            const ImVec2 At = ProjectPoint(State, Min, Max, Effect.Parameters.OriginMetres[0], Effect.Parameters.OriginMetres[1],
                                           Effect.Parameters.OriginMetres[2]);
            double Extent = Effect.Parameters.RadiusMetres;
            Extent = std::max(Extent, Effect.Parameters.BoxHalfMetres[0]);
            Extent = std::max(Extent, Effect.Parameters.BoxHalfMetres[2]);
            const float Radius = std::max(10.0f, static_cast<float>(Extent) * PixelsPerMetre);
            DrawList->AddCircle(At, Radius, FadeColour(ResolveCssColour(Preset.Colour), 0.10f * Fade), 64, 5.0f);
            DashedCircle(DrawList, At, Radius, FadeColour(ResolveCssColour(Preset.Colour), 0.60f * Fade), 1.5f, 28,
                         static_cast<float>(Index) * 0.35f);
        }
    }

    for (size_t Index = 0; Index < State.Forces.size(); ++Index)
    {
        const ParticleWorkspaceForce& Force = State.Forces[Index];
        const float Fade = Force.Enabled ? 1.0f : 0.25f;
        const ImVec2 At = ProjectPoint(State, Min, Max, Force.Centre[0], Force.Centre[1], Force.Centre[2]);
        const float Angle = static_cast<float>(Force.Bearing) * PiSingle / 180.0f;
        ImVec2 Dir(std::sin(Angle), std::cos(Angle));
        if (State.ViewMode == 0)
        {
            const float Yaw = static_cast<float>(State.OrbitYaw) * PiSingle / 180.0f;
            const float Rx  = Dir.x * std::cos(Yaw) - Dir.y * std::sin(Yaw);
            const float Rz  = Dir.x * std::sin(Yaw) + Dir.y * std::cos(Yaw);
            Dir = ImVec2(Rx, Rz * std::cos(static_cast<float>(State.OrbitPitch) * PiSingle / 180.0f));
            const float Length = std::max(1e-3f, std::sqrt(Dir.x * Dir.x + Dir.y * Dir.y));
            Dir.x /= Length;
            Dir.y /= Length;
        }
        const float Reach = std::clamp(static_cast<float>(Force.Radius) * PixelsPerMetre, 14.0f, 120.0f);
        const ImVec2 Tip(At.x + Dir.x * Reach, At.y + Dir.y * Reach);
        DrawList->AddLine(At, Tip, FadeColour(ResolveCssColour(0x8FD3C4FF), 0.55f * Fade), 2.0f);
        ArrowHead(DrawList, Tip, Dir, 7.0f, FadeColour(ResolveCssColour(0x8FD3C4FF), 0.75f * Fade), 2.0f);
        DrawList->AddCircleFilled(At, 2.5f, FadeColour(ResolveCssColour(0x8FD3C4FF), Fade), 12);
    }

    if (State.ShowTrails)
    {
        for (const ParticleWorkspaceEffect& Effect : State.Effects)
        {
            if (!Effect.Enabled) continue;
            const ParticleWorkspacePreset& Preset = QueryParticlePreset(Effect.Preset);
            const ImVec2 At = ProjectPoint(State, Min, Max, Effect.Parameters.OriginMetres[0], Effect.Parameters.OriginMetres[1],
                                           Effect.Parameters.OriginMetres[2]);
            ImVec2 Dir(static_cast<float>(Effect.Parameters.Direction[0]), static_cast<float>(Effect.Parameters.Direction[2]));
            const float Length = std::max(1e-3f, std::sqrt(Dir.x * Dir.x + Dir.y * Dir.y));
            Dir.x /= Length;
            Dir.y /= Length;
            if (State.ViewMode == 0)
            {
                const float Yaw = static_cast<float>(State.OrbitYaw) * PiSingle / 180.0f;
                const float Rx  = Dir.x * std::cos(Yaw) - Dir.y * std::sin(Yaw);
                const float Rz  = Dir.x * std::sin(Yaw) + Dir.y * std::cos(Yaw);
                Dir = ImVec2(Rx, Rz * std::cos(static_cast<float>(State.OrbitPitch) * PiSingle / 180.0f));
                const float Flat = std::max(1e-3f, std::sqrt(Dir.x * Dir.x + Dir.y * Dir.y));
                Dir.x /= Flat;
                Dir.y /= Flat;
            }
            const ImVec2 Side(-Dir.y, Dir.x);
            for (int Streak = -1; Streak <= 1; ++Streak)
            {
                const ImVec2 From(At.x + Side.x * Streak * 7.0f - Dir.x * 6.0f, At.y + Side.y * Streak * 7.0f - Dir.y * 6.0f);
                const ImVec2 To(At.x + Side.x * Streak * 7.0f + Dir.x * 26.0f, At.y + Side.y * Streak * 7.0f + Dir.y * 26.0f);
                DrawList->AddLine(From, To, FadeColour(ResolveCssColour(Preset.Colour), 0.50f), 2.0f);
            }
        }
    }

    DrawList->PopClipRect();
}

void ConstructStageMarkers(ParticleWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 Min, ImVec2 Max)
{
    DrawList->PushClipRect(Min, Max, true);
    PanelCursor Cursor{ DrawList, &Faces, 1.0f, Min.x, Max.x - Min.x, Min.y };
    for (size_t Index = 0; Index < State.Effects.size(); ++Index)
    {
        const ParticleWorkspaceEffect& Effect = State.Effects[Index];
        const ParticleWorkspacePreset& Preset = QueryParticlePreset(Effect.Preset);
        const float Fade = Effect.Enabled ? 1.0f : 0.35f;
        const ImVec2 At = ProjectPoint(State, Min, Max, Effect.Parameters.OriginMetres[0], Effect.Parameters.OriginMetres[1],
                                       Effect.Parameters.OriginMetres[2]);
        if (static_cast<int>(Index) == State.FollowTarget)
        {
            DashedCircle(DrawList, At, 16.0f, FadeColour(ResolveCssColour(0xE8C27AFF), 0.9f * Fade), 1.5f, 12, 0.0f);
        }
        DrawList->AddCircleFilled(At, 4.0f, FadeColour(ResolveCssColour(Preset.Colour), Fade), 16);
        const float LabelWide = Cursor.Measure(Faces.Regular, 10.5f, Effect.Name.c_str()) + 14.0f;
        const ImVec2 LabelMin(At.x + 10.0f, At.y - 22.0f);
        const ImVec2 LabelMax(LabelMin.x + LabelWide, LabelMin.y + 21.0f);
        DrawList->AddRectFilled(LabelMin, LabelMax, FadeColour(ResolveCssColour(0x0A0A0CC7), Fade), 6.0f);
        Cursor.Text(Faces.Regular, 10.5f, LabelMin.x + 7.0f, LabelMin.y + 10.5f - 0.5f * 10.5f * 1.38f, 1.38f,
                    FadeColour(ResolveCssColour(0xEDEDEDFF), Fade), Effect.Name.c_str());
    }
    DrawList->PopClipRect();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    HUD / SELECTS / SLOTS
//------------------------------------------------------------------------------------------------------------------------

void ConstructHudReadouts(ParticleWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 At)
{
    PanelCursor Cursor{ DrawList, &Faces, 1.0f, At.x, 2000.0f, At.y };
    char Line[128]{};
    std::snprintf(Line, sizeof(Line), "ALIVE 0 · RATE 0/s · CPU 0.0 ms · CAP %d", QueryCapacitySum(State));
    const float Wide = Cursor.Measure(Faces.Monospace, 10.5f, Line) + 20.0f;
    const ImVec2 BoxMax(At.x + Wide, At.y + 26.0f);
    DrawList->AddRectFilled(At, BoxMax, ResolveCssColour(0x0E0F12D6), 9.0f);
    DrawList->AddRect(At, BoxMax, ResolveCssColour(0xFFFFFF12), 9.0f, ImDrawFlags_None, 1.0f);
    // 📝 Alive/rate/CPU are honest zeros; only the capacity sum is live because it sums shell-local figures.
    Cursor.Text(Faces.Monospace, 10.5f, At.x + 10.0f, At.y + 13.0f - 0.5f * 10.5f * 1.4f, 1.4f, ResolveCssColour(0x9AA0A6FF), Line);
    RecordRect(State, "Hud/Readouts", At, BoxMax);
}

void ConstructHudGroup(ParticleWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 At)
{
    PanelCursor Cursor{ DrawList, &Faces, 1.0f, At.x, 2000.0f, At.y };
    const char* Pills[3] = { "Trails", "Bounds", "Grid" };
    bool* Flags[3]       = { &State.ShowTrails, &State.ShowBounds, &State.ShowGrid };
    const char* Keys[3]  = { "Trails", "Bounds", "Grid" };
    float Widths[3]{};
    float GroupWide = 6.0f;
    for (int Pill = 0; Pill < 3; ++Pill)
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
    for (int Pill = 0; Pill < 3; ++Pill)
    {
        const ImVec2 Min(PillX, At.y + 3.0f);
        const ImVec2 Max(PillX + Widths[Pill], At.y + 26.0f);
        if (*Flags[Pill]) DrawList->AddRectFilled(Min, Max, ResolveCssColour(0xE8C27AFF), 8.0f);
        Cursor.Text(Faces.Medium, 11.0f, Min.x + 9.0f, At.y + 14.5f - 0.5f * 11.0f * 1.38f, 1.38f,
                    ResolveCssColour(*Flags[Pill] ? 0x0B0B0BFF : 0x848484FF), Pills[Pill]);
        ImGui::PushID(Pill);
        char RectName[40]{};
        std::snprintf(RectName, sizeof(RectName), "Hud/Pill%d", Pill);
        RecordRect(State, RectName, Min, Max);
        if (InvisibleRect("##Hud", Min, Max))
        {
            *Flags[Pill] = !*Flags[Pill];
            char Message[64]{};
            std::snprintf(Message, sizeof(Message), "%s %s", Pills[Pill], *Flags[Pill] ? "shown" : "hidden");
            AppendParticleWorkspaceLog(State, "VIEW", Message, nullptr, Keys[Pill]);
        }
        ImGui::PopID();
        PillX += Widths[Pill] + 3.0f;
    }
    ImGui::PopID();
}

void ConstructViewportSelect(ParticleWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, const char* Id,
                             const char* RectTag, const char* Label, const char* const* Options, int Count, int& InOutIndex, ImVec2 Min,
                             float Wide)
{
    PanelCursor Cursor{ DrawList, &Faces, 1.0f, Min.x, Wide, Min.y };
    const ImVec2 Max(Min.x + Wide, Min.y + 29.0f);
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x0E0F12D6), 10.0f);
    DrawList->AddRect(Min, Max, ResolveCssColour(0xFFFFFF12), 10.0f, ImDrawFlags_None, 1.0f);
    char Line[64]{};
    std::snprintf(Line, sizeof(Line), "%s: %s", Label, Options[InOutIndex]);
    Cursor.Text(Faces.Medium, 11.0f, Min.x + 10.0f, Min.y + 14.5f - 0.5f * 11.0f * 1.38f, 1.38f, ResolveCssColour(0xBCBCBCFF), Line);
    (void)GlyphSymbol::Construct(DrawList, "StudioChevron", ImVec2(Max.x - 20.0f, Min.y + 8.5f), 12.0f, 1.8f,
                                 ResolveCssColour(0x848484FF));
    ImGui::PushID(Id);
    RecordRect(State, RectTag, Min, Max);
    if (InvisibleRect("##ViewportSelect", Min, Max)) ImGui::OpenPopup("##ViewportOptions");

    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(4.0f, 4.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 10.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 1.0f);
    ImGui::PushStyleColor(ImGuiCol_PopupBg, ImGui::ColorConvertU32ToFloat4(ResolveCssColour(0x161616FF)));
    ImGui::PushStyleColor(ImGuiCol_Border, ImGui::ColorConvertU32ToFloat4(ResolveCssColour(0xFFFFFF24)));
    ImGui::SetNextWindowPos(ImVec2(Min.x, Max.y + 4.0f));
    ImGui::SetNextWindowSize(ImVec2(Wide, 0.0f));
    if (ImGui::BeginPopup("##ViewportOptions", ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoSavedSettings))
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
            if (ImGui::InvisibleButton("##ViewportOption", ImVec2(ListWide, RowTall), ImGuiButtonFlags_EnableNav))
            {
                // 📝 Local and silent: the camera/overlay selects restage the decor without logging.
                InOutIndex = Index;
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

void ConstructLegend(ParticleWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 Min)
{
    PanelCursor Cursor{ DrawList, &Faces, 1.0f, Min.x, 214.0f, Min.y };
    const float BoxTall = 30.0f + 4.0f * 20.0f + 26.0f;
    const ImVec2 BoxMax(Min.x + 214.0f, Min.y + BoxTall);
    DrawList->AddRectFilled(Min, BoxMax, ResolveCssColour(0x090B0ED6), 10.0f);
    DrawList->AddRect(Min, BoxMax, ResolveCssColour(0xFFFFFF1F), 10.0f, ImDrawFlags_None, 1.0f);
    Cursor.Text(Faces.Regular, 10.5f, Min.x + 10.0f, Min.y + 8.0f, 1.4f, ResolveCssColour(0x9CA5A0FF), "Behaviour key");
    for (size_t Index = 0; Index < State.Effects.size() && Index < 4; ++Index)
    {
        const ParticleWorkspaceEffect& Effect = State.Effects[Index];
        const ParticleWorkspacePreset& Preset = QueryParticlePreset(Effect.Preset);
        const float RowY = Min.y + 30.0f + Index * 20.0f;
        DrawList->AddCircleFilled(ImVec2(Min.x + 16.0f, RowY + 7.0f), 3.5f, ResolveCssColour(Preset.Colour), 16);
        char Line[96]{};
        std::snprintf(Line, sizeof(Line), "%s · %s", Effect.Name.c_str(),
                      QueryParticleBehaviourName(static_cast<int>(Effect.Parameters.Behaviour)));
        Cursor.Text(Faces.Regular, 10.5f, Min.x + 26.0f, RowY, 1.4f, ResolveCssColour(0xBCBCBCFF), Line);
    }
    DrawList->AddLine(ImVec2(Min.x + 10.0f, BoxMax.y - 24.0f), ImVec2(BoxMax.x - 10.0f, BoxMax.y - 24.0f),
                      ResolveCssColour(0xFFFFFF12));
    Cursor.Text(Faces.Regular, 10.0f, Min.x + 10.0f, BoxMax.y - 19.0f, 1.4f, ResolveCssColour(0x5E5E5EFF), "Static decor");
    RecordRect(State, "Legend", Min, BoxMax);
}

void ConstructProbe(ParticleWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 Min)
{
    PanelCursor Cursor{ DrawList, &Faces, 1.0f, Min.x, 214.0f, Min.y };
    const ImVec2 BoxMax(Min.x + 214.0f, Min.y + 96.0f);
    DrawList->AddRectFilled(Min, BoxMax, ResolveCssColour(0x090B0ED6), 10.0f);
    DrawList->AddRect(Min, BoxMax, ResolveCssColour(0xFFFFFF1F), 10.0f, ImDrawFlags_None, 1.0f);
    Cursor.Text(Faces.Regular, 10.5f, Min.x + 10.0f, Min.y + 8.0f, 1.4f, ResolveCssColour(0x9CA5A0FF), "Probe");
    if (State.FollowTarget >= 0 && State.FollowTarget < static_cast<int>(State.Effects.size()))
    {
        const ParticleWorkspaceEffect& Effect = State.Effects[static_cast<size_t>(State.FollowTarget)];
        Cursor.Text(Faces.Medium, 11.5f, Min.x + 10.0f, Min.y + 27.0f, 1.3f, ResolveCssColour(0xEDEDEDFF), Effect.Name.c_str());
        char Origin[96]{};
        std::snprintf(Origin, sizeof(Origin), "origin (%.1f, %.1f, %.1f)", Effect.Parameters.OriginMetres[0],
                      Effect.Parameters.OriginMetres[1], Effect.Parameters.OriginMetres[2]);
        Cursor.Text(Faces.Monospace, 10.0f, Min.x + 10.0f, Min.y + 47.0f, 1.4f, ResolveCssColour(0x848484FF), Origin);
        char Rate[96]{};
        char Trimmed[32]{};
        FormatParticleTrimmed(Effect.Parameters.ReleaseRate, 0, Trimmed, sizeof(Trimmed));
        std::snprintf(Rate, sizeof(Rate), "rate %s/s · cap %d", Trimmed, Effect.Parameters.Capacity);
        Cursor.Text(Faces.Monospace, 10.0f, Min.x + 10.0f, Min.y + 64.0f, 1.4f, ResolveCssColour(0x848484FF), Rate);
    }
    else
    {
        Cursor.Text(Faces.Regular, 10.5f, Min.x + 10.0f, Min.y + 30.0f, 1.4f, ResolveCssColour(0x6E6E6EFF), "No target —");
        Cursor.Text(Faces.Regular, 10.5f, Min.x + 10.0f, Min.y + 47.0f, 1.4f, ResolveCssColour(0x6E6E6EFF), "click the minimap.");
    }
    RecordRect(State, "Probe", Min, BoxMax);
}

void ConstructMinimap(ParticleWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 Min)
{
    const ImVec2 Max(Min.x + 112.0f, Min.y + 100.0f);
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x0E0E10E0), 14.0f);
    DrawList->AddRect(Min, Max, ResolveCssColour(0xFFFFFF12), 14.0f, ImDrawFlags_None, 1.0f);
    DrawList->PushClipRect(Min, Max, true);
    for (size_t Index = 0; Index < State.Effects.size(); ++Index)
    {
        const ParticleWorkspaceEffect& Effect = State.Effects[Index];
        const ImVec2 Dot(Min.x + 56.0f + static_cast<float>(Effect.Parameters.OriginMetres[0] / 8.0) * 56.0f,
                         Min.y + 42.0f + static_cast<float>(Effect.Parameters.OriginMetres[2] / 8.0) * 42.0f);
        if (static_cast<int>(Index) == State.FollowTarget)
        {
            DrawList->AddCircle(Dot, 5.0f, ResolveCssColour(0xE8C27AFF), 16, 1.5f);
        }
        DrawList->AddCircleFilled(Dot, 2.5f, ResolveCssColour(QueryParticlePreset(Effect.Preset).Colour), 12);
    }
    DrawList->PopClipRect();
    PanelCursor Cursor{ DrawList, &Faces, 1.0f, Min.x, 112.0f, Min.y };
    Cursor.Text(Faces.Regular, 9.5f, Min.x + 7.0f, Max.y - 5.0f - 9.5f * 1.4f, 1.4f, ResolveCssColour(0xFFFFFFB8), "8 m");
    ImGui::PushID("MinimapPick");
    RecordRect(State, "Minimap", Min, Max);
    if (InvisibleRect("##MinimapPick", Min, Max))
    {
        // 📝 The pick retargets the probe; the follow ring and probe update, and the pick logs VIEW.
        const ImVec2 Mouse = ImGui::GetIO().MousePos;
        int   Best      = 0;
        float BestDist  = 1e30f;
        for (size_t Index = 0; Index < State.Effects.size(); ++Index)
        {
            const ParticleWorkspaceEffect& Effect = State.Effects[Index];
            const ImVec2 Dot(Min.x + 56.0f + static_cast<float>(Effect.Parameters.OriginMetres[0] / 8.0) * 56.0f,
                             Min.y + 42.0f + static_cast<float>(Effect.Parameters.OriginMetres[2] / 8.0) * 42.0f);
            const float Dx = Mouse.x - Dot.x;
            const float Dy = Mouse.y - Dot.y;
            if (Dx * Dx + Dy * Dy < BestDist)
            {
                BestDist = Dx * Dx + Dy * Dy;
                Best     = static_cast<int>(Index);
            }
        }
        State.FollowTarget = Best;
        char Message[96]{};
        std::snprintf(Message, sizeof(Message), "Minimap → %s", State.Effects[static_cast<size_t>(Best)].Name.c_str());
        AppendParticleWorkspaceLog(State, "VIEW", Message, nullptr, "Minimap");
    }
    ImGui::PopID();
}

void ConstructStageSurface(ParticleWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 Min, ImVec2 Max,
                           const char* SurfaceTag)
{
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(State.ViewMode == 1 ? 0x070A0FFF : 0x0A0C10FF));
    ConstructStageDecor(State, DrawList, Min, Max);
    ConstructStageMarkers(State, Faces, DrawList, Min, Max);

    ConstructHudReadouts(State, Faces, DrawList, ImVec2(Min.x + 12.0f, Min.y + 12.0f));
    ConstructHudGroup(State, Faces, DrawList, ImVec2(Min.x + 12.0f, Min.y + 46.0f));

    static const char* CameraOptions[3]  = { "Orbit", "Top", "Side" };
    static const char* OverlayOptions[3] = { "Off", "Velocity", "Life" };
    const float SelectWide = 150.0f;
    ConstructViewportSelect(State, Faces, DrawList, "OverlaySelect", "Viewport/Overlay", "Overlay", OverlayOptions, 3, State.Overlay,
                            ImVec2(Max.x - 12.0f - SelectWide, Min.y + 12.0f), SelectWide);
    ConstructViewportSelect(State, Faces, DrawList, "CameraSelect", "Viewport/Camera", "Camera", CameraOptions, 3, State.Camera,
                            ImVec2(Max.x - 12.0f - 2.0f * SelectWide - 8.0f, Min.y + 12.0f), SelectWide);

    ConstructLegend(State, Faces, DrawList, ImVec2(Min.x + 14.0f, Max.y - 14.0f - 136.0f));
    ConstructMinimap(State, Faces, DrawList, ImVec2(Max.x - 12.0f - 112.0f, Max.y - 14.0f - 100.0f));
    ConstructProbe(State, Faces, DrawList, ImVec2(Max.x - 12.0f - 214.0f, Max.y - 14.0f - 100.0f - 8.0f - 96.0f));

    // 📝 The surface submits last so HUD pills, selects, and the minimap win their own presses. Drags orbit (left)
    //    or pan (right) silently; the wheel zooms silently.
    ImGui::PushID(SurfaceTag);
    RecordRect(State, SurfaceTag, Min, Max);
    ImGui::SetCursorScreenPos(Min);
    ImGui::InvisibleButton("##SurfaceDrag", ImVec2(Max.x - Min.x, Max.y - Min.y), ImGuiButtonFlags_EnableNav);
    const bool Hovered = ImGui::IsItemHovered();
    if (ImGui::IsItemActive() && ImGui::IsMouseDragging(ImGuiMouseButton_Left))
    {
        const ImVec2 Delta = ImGui::GetIO().MouseDelta;
        State.OrbitYaw += Delta.x * 0.4;
        State.OrbitPitch = std::clamp(State.OrbitPitch - Delta.y * 0.3, 5.0, 80.0);
    }
    if (Hovered && ImGui::IsMouseDragging(ImGuiMouseButton_Right))
    {
        const ImVec2 Delta = ImGui::GetIO().MouseDelta;
        const float  Scale = ProjectScale(State, Min, Max);
        State.PanX -= Delta.x / std::max(Scale, 1e-3f);
        State.PanY -= Delta.y / std::max(Scale, 1e-3f);
    }
    if (Hovered)
    {
        const float Wheel = ImGui::GetIO().MouseWheel;
        if (Wheel != 0.0f) State.OrbitDistance = std::clamp(State.OrbitDistance * (1.0 - Wheel * 0.1), 4.0, 60.0);
    }
    ImGui::PopID();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    TRANSPORT
//------------------------------------------------------------------------------------------------------------------------

void ConstructTransportStrip(ParticleWorkspaceState& State, const EditorTypefaces& Faces, PanelCursor& Panel)
{
    ImDrawList* const DrawList = Panel.DrawList;
    PanelCursor Cursor{ DrawList, &Faces, 1.0f, Panel.X, Panel.Width, Panel.Y };

    constexpr float StripTall = 64.0f;
    const ImVec2    Strip     = Panel.Space(StripTall);
    DrawList->AddLine(ImVec2(Panel.X, Strip.y), ImVec2(Panel.X + Panel.Width, Strip.y), ResolveCssColour(0xFFFFFF12));
    const float MidY = Strip.y + 32.0f;

    ImGui::PushID("TransportStrip");
    // 📝 Every transport key is a literal NOOP: toast + log, no state change. The clock stays frozen at zero.
    const ImVec2 PlayMin(Strip.x + 14.0f, MidY - 15.0f);
    const ImVec2 PlayMax(PlayMin.x + 30.0f, PlayMin.y + 30.0f);
    DrawList->AddCircleFilled(ImVec2(PlayMin.x + 15.0f, MidY), 15.0f, ResolveCssColour(0x1A1A1AFF), 32);
    DrawList->AddCircle(ImVec2(PlayMin.x + 15.0f, MidY), 15.0f, ResolveCssColour(0xFFFFFF24), 32, 1.0f);
    (void)GlyphSymbol::Construct(DrawList, "StudioPlay", ImVec2(PlayMin.x + 8.5f, MidY - 6.5f), 13.0f, 1.8f,
                                 ResolveCssColour(0xEFEFEFFF));
    RecordRect(State, "Transport/Play", PlayMin, PlayMax);
    if (InvisibleRect("##TransportPlay", PlayMin, PlayMax))
    {
        NoopParticleWorkspaceCommand(State, "TRANSPORT", "Play refused", "Transport is a NOOP in this shell");
    }

    const ImVec2 StepMin(PlayMax.x + 8.0f, MidY - 15.0f);
    const ImVec2 StepMax(StepMin.x + 30.0f, StepMin.y + 30.0f);
    DrawList->AddCircleFilled(ImVec2(StepMin.x + 15.0f, MidY), 15.0f, ResolveCssColour(0x1A1A1AFF), 32);
    DrawList->AddCircle(ImVec2(StepMin.x + 15.0f, MidY), 15.0f, ResolveCssColour(0xFFFFFF24), 32, 1.0f);
    (void)GlyphSymbol::Construct(DrawList, "StudioStep", ImVec2(StepMin.x + 8.5f, MidY - 6.5f), 13.0f, 1.8f,
                                 ResolveCssColour(0xEFEFEFFF));
    RecordRect(State, "Transport/Step", StepMin, StepMax);
    if (InvisibleRect("##TransportStep", StepMin, StepMax))
    {
        NoopParticleWorkspaceCommand(State, "TRANSPORT", "Step refused", "Transport is a NOOP in this shell");
    }

    const ImVec2 ResetMin(StepMax.x + 8.0f, MidY - 15.0f);
    const ImVec2 ResetMax(ResetMin.x + 30.0f, ResetMin.y + 30.0f);
    DrawList->AddCircleFilled(ImVec2(ResetMin.x + 15.0f, MidY), 15.0f, ResolveCssColour(0x1A1A1AFF), 32);
    DrawList->AddCircle(ImVec2(ResetMin.x + 15.0f, MidY), 15.0f, ResolveCssColour(0xFFFFFF24), 32, 1.0f);
    (void)GlyphSymbol::Construct(DrawList, "StudioReset", ImVec2(ResetMin.x + 8.5f, MidY - 6.5f), 13.0f, 1.8f,
                                 ResolveCssColour(0xEFEFEFFF));
    RecordRect(State, "Transport/Reset", ResetMin, ResetMax);
    if (InvisibleRect("##TransportReset", ResetMin, ResetMax))
    {
        NoopParticleWorkspaceCommand(State, "TRANSPORT", "Clock reset refused", "Transport is a NOOP in this shell");
    }

    const char* RateLabels[2] = { "×1", "×10" };
    float RateX = ResetMax.x + 10.0f;
    for (int Rate = 0; Rate < 2; ++Rate)
    {
        const float PillWide = Cursor.Measure(Faces.Medium, 11.0f, RateLabels[Rate]) + 18.0f;
        const ImVec2 Min(RateX, MidY - 13.0f);
        const ImVec2 Max(RateX + PillWide, MidY + 13.0f);
        const bool   Active = (State.ClockRate == 10) == (Rate == 1);
        if (Active) DrawList->AddRectFilled(Min, Max, ResolveCssColour(0xE8C27AFF), 8.0f);
        Cursor.Text(Faces.Medium, 11.0f, Min.x + 9.0f, MidY - 0.5f * 11.0f * 1.38f, 1.38f,
                    ResolveCssColour(Active ? 0x0B0B0BFF : 0xBCBCBCFF), RateLabels[Rate]);
        ImGui::PushID(Rate);
        char RectName[40]{};
        std::snprintf(RectName, sizeof(RectName), "Transport/Speed%d", Rate);
        RecordRect(State, RectName, Min, Max);
        if (InvisibleRect("##TransportSpeed", Min, Max))
        {
            NoopParticleWorkspaceCommand(State, "TRANSPORT", "Speed change refused", "Transport is a NOOP in this shell");
        }
        ImGui::PopID();
        RateX += PillWide + 7.0f;
    }

    const float ClockX = RateX + 6.0f;
    Cursor.Text(Faces.Monospace, 12.5f, ClockX, MidY - 0.5f * 12.5f * 1.4f, 1.4f, ResolveCssColour(0xEFEFEFFF), "00:00.000");
    const float FrameX = ClockX + Cursor.Measure(Faces.Monospace, 12.5f, "00:00.000") + 10.0f;
    Cursor.Text(Faces.Monospace, 12.5f, FrameX, MidY - 0.5f * 12.5f * 1.4f, 1.4f, ResolveCssColour(0x5E5E5EFF), "FRAME 0000");

    const char* BurstLabels[2] = { "Strike", "Burst" };
    const char* BurstTags[2]   = { "Transport/Strike", "Transport/Burst" };
    float BurstX = Strip.x + Panel.Width - 14.0f;
    float BurstWidths[2]{};
    for (int Burst = 0; Burst < 2; ++Burst) BurstWidths[Burst] = Cursor.Measure(Faces.Medium, 11.0f, BurstLabels[Burst]) + 18.0f;
    for (int Burst = 1; Burst >= 0; --Burst)
    {
        const ImVec2 Max(BurstX, MidY + 13.0f);
        const ImVec2 Min(BurstX - BurstWidths[Burst], MidY - 13.0f);
        DrawList->AddRectFilled(Min, Max, ResolveCssColour(0xE8C27A1F), 9.0f);
        DrawList->AddRect(Min, Max, ResolveCssColour(0xE8C27A73), 9.0f, ImDrawFlags_None, 1.0f);
        Cursor.Text(Faces.Medium, 11.0f, Min.x + 9.0f, MidY - 0.5f * 11.0f * 1.38f, 1.38f, ResolveCssColour(0xE8C27AFF),
                    BurstLabels[Burst]);
        ImGui::PushID(10 + Burst);
        RecordRect(State, BurstTags[Burst], Min, Max);
        if (InvisibleRect("##TransportBurst", Min, Max))
        {
            if (Burst == 0) NoopParticleWorkspaceCommand(State, "STRIKE", "Strike refused", "Strike is a NOOP in this shell");
            else NoopParticleWorkspaceCommand(State, "BURST", "Burst refused", "Burst is a NOOP in this shell");
        }
        ImGui::PopID();
        BurstX -= BurstWidths[Burst] + 7.0f;
    }

    const ImVec2 RulerMin(FrameX + Cursor.Measure(Faces.Monospace, 12.5f, "FRAME 0000") + 14.0f, Strip.y + 12.0f);
    const ImVec2 RulerMax(BurstX - 7.0f, Strip.y + StripTall - 12.0f);
    if (RulerMax.x > RulerMin.x + 40.0f)
    {
        DrawList->AddRectFilled(RulerMin, RulerMax, ResolveCssColour(0x1C1C1CFF), 3.0f);
        for (int Tick = 0; Tick <= 4; ++Tick)
        {
            const float X = RulerMin.x + (RulerMax.x - RulerMin.x) * Tick / 4.0f;
            DrawList->AddLine(ImVec2(X, RulerMin.y), ImVec2(X, RulerMax.y), ResolveCssColour(0xFFFFFF12));
        }
        DrawList->AddLine(ImVec2(RulerMin.x, Strip.y + 6.0f), ImVec2(RulerMin.x, Strip.y + StripTall - 6.0f),
                          ResolveCssColour(0xFFFFFFFF), 2.0f);
        RecordRect(State, "Transport/Ruler", RulerMin, RulerMax);
        ImGui::SetCursorScreenPos(RulerMin);
        ImGui::InvisibleButton("##RulerScrub", ImVec2(RulerMax.x - RulerMin.x, RulerMax.y - RulerMin.y), ImGuiButtonFlags_EnableNav);
        if (ImGui::IsItemActive() && ImGui::IsMouseDown(ImGuiMouseButton_Left))
        {
            NoopParticleWorkspaceCommand(State, "TRANSPORT", "Scrub refused", "Scrubbing is a NOOP in this shell");
        }
    }
    ImGui::PopID();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    LOG DRAWER
//------------------------------------------------------------------------------------------------------------------------

void ConstructLogDrawer(ParticleWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Min, ImVec2 Max)
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
    for (const ParticleWorkspaceLogEntry& Entry : State.Log)
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
//                                                    LIBRARY SHEET
//------------------------------------------------------------------------------------------------------------------------

void ConstructLibrarySheet(ParticleWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 RootMin, ImVec2 RootMax,
                         AssetBrowserLink* Link)
{
    if (!State.LibraryOpen) return;
    ImDrawList* const DrawList = ImGui::GetWindowDrawList();
    DrawList->AddRectFilled(RootMin, RootMax, ResolveCssColour(0x050507C2));

    ImGui::PushID("LibraryVeil");

    const float SheetWide = std::min(1140.0f, (RootMax.x - RootMin.x) - 48.0f);
    const float SheetTall = std::min(0.88f * (RootMax.y - RootMin.y), (RootMax.y - RootMin.y) - 48.0f);
    const ImVec2 SheetMin(0.5f * (RootMin.x + RootMax.x - SheetWide), 0.5f * (RootMin.y + RootMax.y - SheetTall));
    const ImVec2 SheetMax(SheetMin.x + SheetWide, SheetMin.y + SheetTall);
    DrawList->AddRectFilled(SheetMin, SheetMax, ResolveCssColour(0x121212FF), 24.0f);
    DrawList->AddRect(SheetMin, SheetMax, ResolveCssColour(0xFFFFFF24), 24.0f, ImDrawFlags_None, 1.0f);
    bool CloseClicked = false;

    // 📝 The whole sheet lives in its own child window: main-window buttons are dead wherever another child
    //    (the inspector scroll region) overlaps them, so the Close key must be a child item to receive presses.
    ImGui::SetCursorScreenPos(ImVec2(SheetMin.x + 20.0f, SheetMin.y + 20.0f));
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0, 0, 0));
    ImGui::BeginChild("##LibraryScroll", ImVec2(SheetWide - 40.0f, SheetTall - 40.0f), false,
                      ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
    ImDrawList* const SheetList = ImGui::GetWindowDrawList();
    PanelCursor Sheet{ SheetList, &Faces, 1.0f, SheetMin.x + 20.0f, SheetWide - 40.0f, SheetMin.y + 20.0f };
    const ImVec2 Head = Sheet.Space(30.0f, 0.0f, 4.0f);
    Sheet.Text(Faces.Light, 18.0f, Head.x, Head.y + 15.0f - 0.5f * 18.0f * 1.3f, 1.3f, ResolveCssColour(0xF4F4F4FF),
               "Preset Library", -0.3f);
    const ImVec2 CloseMax(Head.x + Sheet.Width, Head.y + 30.0f);
    const ImVec2 CloseMin(CloseMax.x - 30.0f, Head.y);
    DrawList->AddCircleFilled(ImVec2(CloseMin.x + 15.0f, CloseMin.y + 15.0f), 15.0f, ResolveCssColour(0x1A1A1AFF), 32);
    DrawList->AddCircle(ImVec2(CloseMin.x + 15.0f, CloseMin.y + 15.0f), 15.0f, ResolveCssColour(0xFFFFFF24), 32, 1.0f);
    (void)GlyphSymbol::Construct(DrawList, "StudioClose", ImVec2(CloseMin.x + 8.5f, CloseMin.y + 8.5f), 13.0f, 1.8f,
                                 ResolveCssColour(0xEFEFEFFF));
    RecordRect(State, "Library/Close", CloseMin, CloseMax);
    if (InvisibleRect("##LibraryClose", CloseMin, CloseMax)) CloseClicked = true;
    const ImVec2 Sub = Sheet.Space(16.0f, 0.0f, 10.0f);
    Sheet.Text(Faces.Regular, 11.0f, Sub.x, Sub.y, 1.4f, ResolveCssColour(0x848484FF), "Preset browsing moved to the shared Asset Browser");

    ImDrawList* const InnerList = SheetList;
    PanelCursor       Content{ InnerList, &Faces, 1.0f, SheetMin.x + 20.0f, SheetWide - 40.0f, Sheet.Y };

    // 📝 The 52-card gallery moved out to the shared Asset Browser; the sheet keeps its chrome and hands off.
    {
        const ImVec2 Browse = Content.Space(64.0f, 8.0f, 0.0f);
        const ImVec2 BrowseMin(Browse.x, Browse.y);
        const ImVec2 BrowseMax(Browse.x + Content.Width, Browse.y + 64.0f);
        InnerList->AddRectFilled(BrowseMin, BrowseMax, ResolveCssColour(0x1A1A1AFF), 16.0f);
        InnerList->AddRect(BrowseMin, BrowseMax, ResolveCssColour(0xE8C27A66), 16.0f, ImDrawFlags_None, 1.0f);
        Content.Text(Faces.Medium, 13.0f, BrowseMin.x + 16.0f, BrowseMin.y + 10.0f, 1.3f,
                     ResolveCssColour(0xE8C27AFF), "Browse particle presets\u2026");
        Content.Text(Faces.Regular, 10.5f, BrowseMin.x + 16.0f, BrowseMin.y + 34.0f, 1.4f,
                     ResolveCssColour(0x848484FF), "52 presets \u00B7 opens the shared Asset Browser");
        Content.Text(Faces.Medium, 14.0f, BrowseMax.x - 34.0f, BrowseMin.y + 20.0f, 1.3f,
                     ResolveCssColour(0xE8C27AFF), "\u2197");
        RecordRect(State, "Library/Browse", BrowseMin, BrowseMax);
        if (InvisibleRect("##LibraryBrowse", BrowseMin, BrowseMax))
        {
            if (Link != nullptr)
            {
                Link->OpenRequested = true;
                Link->OpenWorkspace = AssetBrowserWorkspaceParticle;
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

//------------------------------------------------------------------------------------------------------------------------
//                                                    EXPORT DIALOG
//------------------------------------------------------------------------------------------------------------------------

void ConstructExportDialog(ParticleWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 RootMin, ImVec2 RootMax)
{
    if (!State.ExportOpen) return;
    ImDrawList* const DrawList = ImGui::GetWindowDrawList();
    DrawList->AddRectFilled(RootMin, RootMax, ResolveCssColour(0x050507C2));

    ImGui::PushID("ExportVeil");

    const float DialogWide = std::min(540.0f, 0.92f * (RootMax.x - RootMin.x));
    constexpr float DialogTall = 480.0f;
    const ImVec2 DialogMin(0.5f * (RootMin.x + RootMax.x - DialogWide), 0.5f * (RootMin.y + RootMax.y - DialogTall));
    const ImVec2 DialogMax(DialogMin.x + DialogWide, DialogMin.y + DialogTall);
    DrawList->AddRectFilled(DialogMin, DialogMax, ResolveCssColour(0x121212FF), 22.0f);
    DrawList->AddRect(DialogMin, DialogMax, ResolveCssColour(0xFFFFFF24), 22.0f, ImDrawFlags_None, 1.0f);
    bool CloseClicked = false;

    // 📝 Like the library sheet, the dialog content lives in its own child window so its keys receive presses.
    ImGui::SetCursorScreenPos(ImVec2(DialogMin.x + 20.0f, DialogMin.y + 20.0f));
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0, 0, 0));
    ImGui::BeginChild("##ExportScroll", ImVec2(DialogWide - 40.0f, DialogTall - 40.0f), false,
                      ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
    ImDrawList* const DialogList = ImGui::GetWindowDrawList();
    PanelCursor Dialog{ DialogList, &Faces, 1.0f, DialogMin.x + 20.0f, DialogWide - 40.0f, DialogMin.y + 20.0f };
    const ImVec2 Head = Dialog.Space(30.0f, 0.0f, 4.0f);
    Dialog.Text(Faces.Light, 18.0f, Head.x, Head.y + 15.0f - 0.5f * 18.0f * 1.3f, 1.3f, ResolveCssColour(0xF4F4F4FF),
                "Export TOML", -0.3f);
    const ImVec2 Sub = Dialog.Space(16.0f, 0.0f, 10.0f);
    Dialog.Text(Faces.Regular, 11.0f, Sub.x, Sub.y, 1.4f, ResolveCssColour(0x848484FF), "Shell state only — nothing simulated");

    const ImVec2 TextBox = Dialog.Space(300.0f, 0.0f, 12.0f);
    const ImVec2 TextMax(TextBox.x + Dialog.Width, TextBox.y + 300.0f);
    DialogList->AddRectFilled(TextBox, TextMax, ResolveCssColour(0x0B0B0BFF), 12.0f);
    DialogList->AddRect(TextBox, TextMax, ResolveCssColour(0xFFFFFF14), 12.0f, ImDrawFlags_None, 1.0f);
    DialogList->PushClipRect(ImVec2(TextBox.x + 10.0f, TextBox.y + 8.0f), ImVec2(TextMax.x - 10.0f, TextMax.y - 8.0f), true);
    float LineY = TextBox.y + 8.0f;
    int   Drawn = 0;
    int   Total = 0;
    const char* Cursor0 = State.ExportText.c_str();
    for (const char* P = Cursor0; *P != '\0'; ++P)
    {
        if (*P == '\n') ++Total;
    }
    while (Cursor0 != nullptr && *Cursor0 != '\0' && LineY + 10.0f * 1.5f <= TextMax.y - 8.0f)
    {
        const char* End = std::strchr(Cursor0, '\n');
        char Line[160]{};
        if (End != nullptr) std::snprintf(Line, sizeof(Line), "%.*s", static_cast<int>(End - Cursor0), Cursor0);
        else std::snprintf(Line, sizeof(Line), "%s", Cursor0);
        Dialog.Text(Faces.Monospace, 10.0f, TextBox.x + 10.0f, LineY, 1.5f, ResolveCssColour(0x9AA0A6FF), Line);
        LineY += 10.0f * 1.5f;
        ++Drawn;
        Cursor0 = End != nullptr ? End + 1 : nullptr;
    }
    if (Total + 1 > Drawn)
    {
        char More[64]{};
        std::snprintf(More, sizeof(More), "… (%d more lines)", Total + 1 - Drawn);
        Dialog.Text(Faces.Monospace, 10.0f, TextBox.x + 10.0f, TextMax.y - 8.0f - 10.0f * 1.5f, 1.5f,
                    ResolveCssColour(0x5E5E5EFF), More);
    }
    DialogList->PopClipRect();

    const ImVec2 Buttons = Dialog.Space(34.0f, 0.0f, 0.0f);
    const float DownloadWide = Dialog.Measure(Faces.Medium, 11.0f, "Download .toml") + 18.0f;
    const float CloseWide    = Dialog.Measure(Faces.Medium, 11.0f, "Close") + 18.0f;
    const ImVec2 CloseMax(Buttons.x + Dialog.Width, Buttons.y + 34.0f);
    const ImVec2 CloseMin(CloseMax.x - CloseWide, Buttons.y);
    const ImVec2 DownloadMax(CloseMin.x - 8.0f, Buttons.y + 34.0f);
    const ImVec2 DownloadMin(DownloadMax.x - DownloadWide, Buttons.y);
    DialogList->AddRectFilled(DownloadMin, DownloadMax, ResolveCssColour(0xE8C27A2E), 17.0f);
    DialogList->AddRect(DownloadMin, DownloadMax, ResolveCssColour(0xE8C27A66), 17.0f, ImDrawFlags_None, 1.0f);
    Dialog.Text(Faces.Medium, 11.0f, DownloadMin.x + 9.0f, Buttons.y + 17.0f - 0.5f * 11.0f * 1.38f, 1.38f,
                ResolveCssColour(0xE8C27AFF), "Download .toml");
    DialogList->AddRectFilled(CloseMin, CloseMax, ResolveCssColour(0x1B1B1BFF), 17.0f);
    DialogList->AddRect(CloseMin, CloseMax, ResolveCssColour(0xFFFFFF24), 17.0f, ImDrawFlags_None, 1.0f);
    Dialog.Text(Faces.Medium, 11.0f, CloseMin.x + 9.0f, Buttons.y + 17.0f - 0.5f * 11.0f * 1.38f, 1.38f,
                ResolveCssColour(0xE4E4E4FF), "Close");
    RecordRect(State, "Export/Download", DownloadMin, DownloadMax);
    if (InvisibleRect("##ExportDownload", DownloadMin, DownloadMax))
    {
        NoopParticleWorkspaceCommand(State, "EXPORT", "Download refused", "Download is a NOOP in this shell");
    }
    RecordRect(State, "Export/Close", CloseMin, CloseMax);
    if (InvisibleRect("##ExportClose", CloseMin, CloseMax)) CloseClicked = true;

    ImGui::EndChild();
    ImGui::PopStyleColor();

    // 📝 The veil submits after the dialog so the dialog wins its own presses; a press anywhere else dismisses.
    RecordRect(State, "Export/Veil", RootMin, RootMax);
    if (InvisibleRect("##ExportVeil", RootMin, RootMax))
    {
        const ImVec2 Mouse = ImGui::GetIO().MousePos;
        if (Mouse.x < DialogMin.x || Mouse.x > DialogMax.x || Mouse.y < DialogMin.y || Mouse.y > DialogMax.y) CloseClicked = true;
    }
    ImGui::PopID();
    if (CloseClicked) State.ExportOpen = false;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    ROOT
//------------------------------------------------------------------------------------------------------------------------

void ApplyParticleWorkspaceLink(ParticleWorkspaceState& State, AssetBrowserLink* Link)
{
    if (Link == nullptr || !Link->HasHandoff() || Link->OpenRecordWorkspace != AssetBrowserWorkspaceParticle) return;
    static constexpr const char* Prefix  = "particle/";
    const char*                  Raw     = Link->OpenRecordId;
    const char*                  Display = Raw;
    if (std::strncmp(Raw, Prefix, std::strlen(Prefix)) == 0)
    {
        const int Preset = QueryParticlePresetById(Raw + std::strlen(Prefix));
        if (Preset >= 0) Display = QueryParticlePreset(Preset).Name;
    }
    // 📝 Read-only names: the handoff refuses exactly like the old library card did.
    char Message[192]{};
    std::snprintf(Message, sizeof(Message), "Add %s refused", Display);
    NoopParticleWorkspaceCommand(State, "LIBRARY", Message, "The library is read-only in this shell");
    Link->ClearHandoff();
}

void ConstructParticleWorkspace(ParticleWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Size,
                                AssetBrowserLink* Link)
{
    ApplyParticleWorkspaceLink(State, Link);
    State.Rects.clear();
    // 📝 The clock never advances: transport is a literal NOOP and the playhead stays frozen at zero.

    ImGui::SetNextWindowPos(ImVec2(0.0f, 0.0f));
    ImGui::SetNextWindowSize(Size);
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImGui::ColorConvertU32ToFloat4(ResolveCssColour(0x0B0B0BFF)));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
    ImGui::Begin("##ParticleWorkspace", nullptr,
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
    constexpr float FooterTall = 30.0f;
    constexpr float StripTall  = 64.0f;
    const ImVec2 SurfaceMax(ViewportMax.x, ViewportMax.y - StripTall - FooterTall);
    if (State.ViewMode == 0) ConstructStageSurface(State, Faces, DrawList, SurfaceMin, SurfaceMax, "Surface/Stage");
    else ConstructStageSurface(State, Faces, DrawList, SurfaceMin, SurfaceMax, "Surface/Plan");
    Viewport.Y = SurfaceMax.y;

    ConstructTransportStrip(State, Faces, Viewport);

    const ImVec2 Foot = Viewport.Space(FooterTall);
    DrawList->AddLine(ImVec2(CentreMin.x, Foot.y), ImVec2(ViewportMax.x, Foot.y), ResolveCssColour(0xFFFFFF12));
    PanelCursor FootCursor{ DrawList, &Faces, 1.0f, CentreMin.x, ViewportMax.x - CentreMin.x, Foot.y };
    FootCursor.Text(Faces.Regular, 10.5f, CentreMin.x + 14.0f, Foot.y + 15.0f - 0.5f * 10.5f * 1.4f, 1.4f,
                    ResolveCssColour(0x848484FF), "Staged values only · markers, probe & series are static shell decor");
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
    const float TagWide = Inspector.Measure(Faces.Regular, 10.5f, "Staged · Ready");
    Inspector.Text(Faces.Regular, 10.5f, InspectorMax.x - 16.0f - TagWide, InspectorHead.y + 22.0f - 0.5f * 10.5f * 1.4f, 1.4f,
                   ResolveCssColour(0x848484FF), "Staged · Ready");
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
        ConstructParticleWorkspaceInspector(State, Faces, Column);
        Column.Finalize();
    }
    ImGui::EndChild();
    ImGui::PopStyleColor();

    ConstructLibrarySheet(State, Faces, ImVec2(0.0f, 0.0f), Size, Link);
    ConstructExportDialog(State, Faces, ImVec2(0.0f, 0.0f), Size);
    Toast::Construct();
    ImGui::End();
}

} // namespace Frontier
