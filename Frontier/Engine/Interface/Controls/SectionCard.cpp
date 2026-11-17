/*==========================================================================================================================================
                                                             SECTIONCARD.CPP
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js SectionCard: the <details class="property-group"> card (22 px radius, 180° gradient,
//    54 px summary, group-content padding 0 18px 18px). The open card splits the draw list like ControlColumn cards,
//    so it never nests inside another card.

#include "Engine/Interface/Controls/SectionCard.h"

#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/GlyphRun.h"
#include "Engine/Interface/Controls/GlyphSymbol.h"
#include "Engine/Interface/InspectorControls.h"

#include <imgui_internal.h>

#include <cctype>
#include <vector>

namespace Frontier
{

namespace
{

struct SectionScope
{
    bool  Open       = true;
    float CardLeft   = 0.0f;
    float CardWidth  = 0.0f;
    float CardTop    = 0.0f;
    float HeadBottom = 0.0f;
};

std::vector<SectionScope>& QueryScopes()
{
    static std::vector<SectionScope> Scopes{};
    return Scopes;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    SECTION CARD
//------------------------------------------------------------------------------------------------------------------------

bool SectionCard::Begin(ControlColumn& Column, const char* Id, const char* Title, const char* Glyph, const char* Badge, const char* Hint,
                        bool& InOutOpen, bool Enabled, const char* Tooltip)
{
    const ControlTheme&    Theme    = Column.QueryTheme();
    const EditorTypefaces& Faces    = Column.QueryFaces();
    ImDrawList* const      DrawList = Column.QueryDrawList();
    const float            S        = Column.QueryScale();
    const float            Width    = Column.QueryWidth();
    // 📝 summary: padding 16px 18px; title 17 px; header 54 px tall.
    constexpr float HeaderTall = 54.0f;
    constexpr float PadSide    = 18.0f;
    constexpr float Radius     = 22.0f;
    const ImVec2    Top        = Column.Space(HeaderTall, 0.0f, 0.0f);
    const float     Fade       = Enabled ? 1.0f : 0.42f;

    ImGui::PushID(Id);
    ImGui::SetCursorScreenPos(Top);
    const bool Toggled = Enabled && ImGui::InvisibleButton("##Summary", ImVec2(Width, HeaderTall * S), ImGuiButtonFlags_EnableNav);
    if (ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled)) ControlColumn::ConstructTooltip(Tooltip);
    ImGui::PopID();
    if (Toggled) InOutOpen = !InOutOpen;

    SectionScope Scope;
    Scope.Open       = InOutOpen;
    Scope.CardLeft   = Top.x;
    Scope.CardWidth  = Width;
    Scope.CardTop    = Top.y;
    Scope.HeadBottom = Top.y + HeaderTall * S;
    QueryScopes().push_back(Scope);

    // 📝 The header background: full rounding while closed, top rounding while open (the body completes it in End).
    const ImVec2 HeadMax(Top.x + Width, Top.y + HeaderTall * S);
    const int    VertexStart = DrawList->VtxBuffer.Size;
    DrawList->AddRectFilled(Top, HeadMax, FadeColour(Theme.CardTop, Fade), Radius * S,
                            InOutOpen ? ImDrawFlags_RoundCornersTop : ImDrawFlags_RoundCornersAll);
    ImGui::ShadeVertsLinearColorGradientKeepAlpha(DrawList, VertexStart, DrawList->VtxBuffer.Size, ImVec2(Top.x, Top.y),
                                                  ImVec2(Top.x, HeadMax.y + (InOutOpen ? 200.0f * S : 0.0f)),
                                                  FadeColour(Theme.CardTop, Fade), FadeColour(Theme.CardBottom, Fade));
    if (!InOutOpen) DrawList->AddRect(Top, HeadMax, FadeColour(Theme.CardBorder, Fade), Radius * S, ImDrawFlags_None, S);

    // 📝 summary row: warm 15 px glyph, 17 px light title (tracking -0.35), right-aligned 9 px badge (tracking 0.9).
    const float Centre = Top.y + 0.5f * HeaderTall * S;
    float       TextAt = Top.x + PadSide * S;
    if (Glyph != nullptr && Glyph[0] != '\0')
    {
        (void)GlyphSymbol::Construct(DrawList, Glyph, ImVec2(TextAt, Centre - 7.5f * S), 15.0f * S, 1.65f,
                                     FadeColour(Theme.Accent, 0.85f * Fade));
        TextAt += (15.0f + 9.0f) * S;
    }
    const float TitleTop = Centre - 0.5f * 17.0f * 1.3f * S;
    (void)GlyphRun::Construct(Column, Faces.Light, 17.0f * S, ImVec2(TextAt, GlyphRun::ResolveBaseline(TitleTop, 17.0f * S, 1.3f)),
                              FadeColour(Theme.CardHeading, Fade), Title, -0.35f * S);
    if (Badge != nullptr && Badge[0] != '\0')
    {
        char Upper[64]{};
        for (int Index = 0; Index < 63 && Badge[Index] != '\0'; ++Index)
            Upper[Index] = static_cast<char>(std::toupper(static_cast<unsigned char>(Badge[Index])));
        const float Advance  = GlyphRun::Measure(Column, Faces.Regular, 9.0f * S, Upper, 0.9f * S);
        const float BadgeTop = Centre - 0.5f * 9.0f * 1.4f * S;
        (void)GlyphRun::Construct(Column, Faces.Regular, 9.0f * S,
                                  ImVec2(Top.x + Width - PadSide * S - Advance, GlyphRun::ResolveBaseline(BadgeTop, 9.0f * S, 1.4f)),
                                  FadeColour(Theme.Index, Fade), Upper, 0.9f * S);
    }

    if (!InOutOpen) return Toggled;
    // 📝 group-content: padding 0 18px 18px; the hint wraps at the narrowed width.
    DrawList->ChannelsSplit(2);
    DrawList->ChannelsSetCurrent(1);
    Column.PushIndent(PadSide, PadSide);
    if (Hint != nullptr && Hint[0] != '\0')
    {
        const float Wrap = Column.QueryWidth();
        const float Tall = ParagraphBlock::Construct(Column, Faces.Regular, 10.5f * S, 1.55f, Column.QueryCursor(), Wrap,
                                                     FadeColour(Theme.Caption, Fade), Hint, true);
        const ImVec2 HintTop = Column.Space(Tall / S, 0.0f, 14.0f);
        (void)ParagraphBlock::Construct(Column, Faces.Regular, 10.5f * S, 1.55f, HintTop, Wrap, FadeColour(Theme.Caption, Fade), Hint);
    }
    return Toggled;
}

void SectionCard::End(ControlColumn& Column)
{
    std::vector<SectionScope>& Scopes = QueryScopes();
    if (Scopes.empty()) return;
    const SectionScope Scope = Scopes.back();
    Scopes.pop_back();
    if (!Scope.Open)
    {
        (void)Column.Space(0.0f, 0.0f, 10.0f);
        return;
    }
    Column.PopIndent();

    const ControlTheme& Theme    = Column.QueryTheme();
    ImDrawList* const   DrawList = Column.QueryDrawList();
    const float         S        = Column.QueryScale();
    constexpr float PadBottom = 18.0f;
    constexpr float Radius    = 22.0f;
    // 📝 Consume the last row's margin, reserve the bottom padding, then paint the body behind the content.
    (void)Column.Space(PadBottom, 0.0f, 10.0f);
    const ImVec2 Cursor  = Column.QueryCursor();
    const ImVec2 BodyMin(Scope.CardLeft, Scope.HeadBottom);
    const ImVec2 BodyMax(Scope.CardLeft + Scope.CardWidth, Cursor.y);
    DrawList->ChannelsSetCurrent(0);
    const int VertexStart = DrawList->VtxBuffer.Size;
    DrawList->AddRectFilled(BodyMin, BodyMax, Theme.CardTop, Radius * S, ImDrawFlags_RoundCornersBottom);
    ImGui::ShadeVertsLinearColorGradientKeepAlpha(DrawList, VertexStart, DrawList->VtxBuffer.Size, ImVec2(BodyMin.x, Scope.CardTop),
                                                  ImVec2(BodyMin.x, BodyMax.y + 200.0f * S), Theme.CardTop, Theme.CardBottom);
    DrawList->AddRect(ImVec2(Scope.CardLeft, Scope.CardTop), BodyMax, Theme.CardBorder, Radius * S, ImDrawFlags_None, S);
    DrawList->ChannelsMerge();
}

} // namespace Frontier
