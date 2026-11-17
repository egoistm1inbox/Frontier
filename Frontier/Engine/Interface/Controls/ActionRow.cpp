/*==========================================================================================================================================
                                                             ACTIONROW.CPP
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js ActionRow: the 32 px pill command buttons (12 px glyph + 11 px label), default,
//    accent-lime, and danger tones.

#include "Engine/Interface/Controls/ActionRow.h"

#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/GlyphRun.h"
#include "Engine/Interface/Controls/GlyphSymbol.h"
#include "Engine/Interface/InspectorControls.h"

#include <imgui_internal.h>

#include <algorithm>
#include <vector>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    ACTION ROW
//------------------------------------------------------------------------------------------------------------------------

int ActionRow::Construct(ControlColumn& Column, const char* Id, const ActionItem* Actions, int Count, bool Enabled, const char* Tooltip,
                        ActionRowVoice Voice, ImVec4* OutRects)
{
    const EditorTypefaces& Faces    = Column.QueryFaces();
    ImDrawList* const      DrawList = Column.QueryDrawList();
    const float            S        = Column.QueryScale();
    const float            Width    = Column.QueryWidth();
    if (Count <= 0 || Actions == nullptr) return -1;
    const float Fade = Enabled ? 1.0f : 0.42f;
    const bool  Warm = Voice == ActionRowVoice::Warm;

    const float ButtonTall = Warm ? 34.0f : 32.0f;
    constexpr float Gap    = 6.0f;
    const ImVec2    Top    = Column.Space(ButtonTall, 0.0f, 10.0f);
    const float     Wide   = (Width - Gap * S * static_cast<float>(Count - 1)) / static_cast<float>(Count);
    int             Fired  = -1;

    ImGui::PushID(Id);
    if (!Enabled) ImGui::BeginDisabled();
    for (int Index = 0; Index < Count; ++Index)
    {
        const ActionItem& Action   = Actions[Index];
        const float       ItemFade = Fade * (Action.Enabled ? 1.0f : 0.42f);
        const ImVec2      Min(Top.x + Index * (Wide + Gap * S), Top.y);
        const ImVec2      Max(Min.x + Wide, Min.y + ButtonTall * S);
        if (OutRects != nullptr) OutRects[Index] = ImVec4(Min.x, Min.y, Max.x, Max.y);
        ImGui::SetCursorScreenPos(Min);
        ImGui::PushID(Index);
        if (ImGui::InvisibleButton("##Action", ImVec2(Wide, ButtonTall * S), ImGuiButtonFlags_EnableNav) && Enabled && Action.Enabled)
            Fired = Index;
        if (ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled))
            ControlColumn::ConstructTooltip(!Action.Enabled && Action.Reason != nullptr ? Action.Reason : Tooltip);
        ImGui::PopID();

        ImU32 Fill = Warm ? ResolveCssColour(0x1B1B1BFF) : ResolveCssColour(0x1F1F1FFF);
        ImU32 Edge = ResolveCssColour(0xFFFFFF24);
        ImU32 Ink  = ResolveCssColour(0xE4E4E4FF);
        if (Action.Tone == ActionTone::Accent)
        {
            // 📝 Charcoal: cream pill; Warm: warm translucent fill with warm ink.
            Fill = Warm ? ResolveCssColour(0xE8C27A2E) : ResolveCssColour(0xEFF4CFFF);
            Edge = Warm ? ResolveCssColour(0xE8C27A66) : ResolveCssColour(0x00000000);
            Ink  = Warm ? ResolveCssColour(0xE8C27AFF) : ResolveCssColour(0x0B0B0BFF);
        }
        else if (Action.Tone == ActionTone::Danger)
        {
            Fill = ResolveCssColour(0xFF5C5C14);
            Edge = ResolveCssColour(0xFF5C5C59);
            Ink  = ResolveCssColour(0xFF5C5CFF);
        }
        DrawList->AddRectFilled(Min, Max, FadeColour(Fill, ItemFade), 0.5f * ButtonTall * S);
        if (!Warm && Action.Tone == ActionTone::Accent)
        {
            // 📝 Charcoal accent pills are borderless.
        }
        else DrawList->AddRect(Min, Max, FadeColour(Edge, ItemFade), 0.5f * ButtonTall * S, ImDrawFlags_None, S);

        const bool  Glyphed   = Action.Glyph != nullptr && Action.Glyph[0] != '\0';
        const float LabelWide = GlyphRun::Measure(Column, Faces.Medium, 11.0f * S, Action.Label);
        const float Span      = LabelWide + (Glyphed ? 12.0f * S + 6.0f * S : 0.0f);
        float       Cursor    = Min.x + 0.5f * (Wide - Span);
        const float MidY      = Min.y + 0.5f * ButtonTall * S;
        if (Glyphed)
        {
            (void)GlyphSymbol::Construct(DrawList, Action.Glyph, ImVec2(Cursor, MidY - 6.0f * S), 12.0f * S, 1.8f * S, FadeColour(Ink, ItemFade));
            Cursor += 12.0f * S + 6.0f * S;
        }
        const float LineTop = MidY - 0.5f * 11.0f * 1.38f * S;
        (void)GlyphRun::Construct(Column, Action.Tone == ActionTone::Accent ? Faces.Medium : Faces.Regular, 11.0f * S,
                                  ImVec2(Cursor, GlyphRun::ResolveBaseline(LineTop, 11.0f * S, 1.38f)), FadeColour(Ink, ItemFade), Action.Label);
    }
    if (!Enabled) ImGui::EndDisabled();
    ImGui::PopID();
    return Fired;
}

//------------------------------------------------------------------------------------------------------------------------
//                                              LEGACY ACTION ROW
//------------------------------------------------------------------------------------------------------------------------

int ActionRow::Construct(ControlColumn& Column, std::span<const ActionEntry> Entries, const ActionRowLook& Look)
{
    const float    Scale  = Column.QueryScale();
    const float    Width  = Column.QueryWidth();
    const auto&    Faces  = Column.QueryFaces();
    const auto&    Theme  = Column.QueryTheme();
    const float    Height = (Look.FontSize * 1.4f + Look.PaddingTop * 2 + 2) * Scale;
    std::vector<ImVec2> Positions;
    std::vector<float>  Widths;
    const float Leading = Look.Leading ? GlyphRun::Measure(Column, Faces.Regular, 9 * Scale, Look.Leading, 0.9f * Scale) + 8 * Scale : 0;
    float       Along = Leading, Across = 0;
    for (size_t Index = 0; Index < Entries.size(); ++Index)
    {
        const float Extent = std::min(Width, GlyphRun::Measure(Column, Faces.Regular, Look.FontSize * Scale, Entries[Index].Caption) +
                                                 (Look.PaddingSide * 2 + 2) * Scale);
        if (Along > 0 && Along + Extent > Width)
        {
            Along = 0;
            Across += Height + 8 * Scale;
        }
        if (Look.Trailing && Index + 1 == Entries.size()) Along = std::max(Along, Width - Extent);
        Positions.emplace_back(Along, Across);
        Widths.push_back(Extent);
        Along += Extent + 8 * Scale;
    }
    const ImVec2 Origin = Column.Space((Across + Height) / Scale, Look.MarginTop, Look.MarginBottom);
    if (Look.Leading)
        GlyphRun::Construct(Column, Faces.Regular, 9 * Scale,
                            {Origin.x, GlyphRun::ResolveBaseline(Origin.y + (Height - 12.6f * Scale) * 0.5f, 9 * Scale, 1.4f)}, Theme.Muted,
                            Look.Leading, 0.9f * Scale);
    int Pressed = -1;
    for (size_t Index = 0; Index < Entries.size(); ++Index)
    {
        const auto&  Entry = Entries[Index];
        const ImVec2 Min(Origin.x + Positions[Index].x, Origin.y + Positions[Index].y);
        const ImVec2 Max(Min.x + Widths[Index], Min.y + Height);
        ImGui::SetCursorScreenPos(Min);
        if (!Entry.Enabled) ImGui::BeginDisabled();
        if (ImGui::InvisibleButton(Entry.Id, {Widths[Index], Height}, ImGuiButtonFlags_EnableNav) && Entry.Enabled)
            Pressed = static_cast<int>(Index);
        if (!Entry.Enabled) ImGui::EndDisabled();
        ControlColumn::ConstructTooltip(Entry.Tooltip);
        auto*       Ink  = Column.QueryDrawList();
        const float Fade = Entry.Enabled ? 1 : 0.45f;
        Ink->AddRectFilled(Min, Max, FadeColour(ImGui::IsItemHovered() ? ResolveCssColour(0x34343AFF) : ResolveCssColour(0x1B1B20FF), Fade),
                           22 * Scale);
        Ink->AddRect(Min, Max, FadeColour(ResolveCssColour(0x444444FF), Fade), 22 * Scale);
        const float TextWidth = GlyphRun::Measure(Column, Faces.Regular, Look.FontSize * Scale, Entry.Caption);
        GlyphRun::Construct(Column, Faces.Regular, Look.FontSize * Scale,
                            {Min.x + (Widths[Index] - TextWidth) * 0.5f,
                             GlyphRun::ResolveBaseline(Min.y + (Look.PaddingTop + 1) * Scale, Look.FontSize * Scale, 1.4f)},
                            FadeColour(Theme.Ink, Fade), Entry.Caption);
        ImGui::RenderNavCursor(ImRect(Min, Max), ImGui::GetItemID());
    }
    return Pressed;
}

} // namespace Frontier
