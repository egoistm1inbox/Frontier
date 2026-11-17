/*==========================================================================================================================================
                                                            SEGMENTEDROW.CPP
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js SegmentedRow: a 12 px label over the joined pill track (.segmented-track: padding 4,
//    gap 4, radius 999; active option #292929, idle text #828282).

#include "Engine/Interface/Controls/SegmentedRow.h"

#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/GlyphRun.h"
#include "Engine/Interface/InspectorControls.h"

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    SEGMENTED ROW
//------------------------------------------------------------------------------------------------------------------------

bool SegmentedRow::Construct(ControlColumn& Column, const char* Id, const char* Label, const char* const* Options, int Count,
                             int& InOutIndex, bool Enabled, const char* Tooltip)
{
    return Construct(Column, Id, Label, Options, Count, InOutIndex, false, Enabled, Tooltip);
}

bool SegmentedRow::Construct(ControlColumn& Column, const char* Id, const char* Label, const char* const* Options, int Count,
                             int& InOutIndex, bool Compact, bool Enabled, const char* Tooltip)
{
    const ControlTheme&    Theme    = Column.QueryTheme();
    const EditorTypefaces& Faces    = Column.QueryFaces();
    ImDrawList* const      DrawList = Column.QueryDrawList();
    const float            S        = Column.QueryScale();
    const float            Width    = Column.QueryWidth();
    if (Count <= 0 || Options == nullptr) return false;
    if (InOutIndex < 0 || InOutIndex >= Count) InOutIndex = 0;
    const float Fade = Enabled ? 1.0f : 0.42f;

    const ImVec2 Head = Column.Space(17.0f, 0.0f, 7.0f);
    (void)GlyphRun::Construct(Column, Faces.Regular, 12.0f * S, ImVec2(Head.x, GlyphRun::ResolveBaseline(Head.y, 12.0f * S, 1.4f)),
                              FadeColour(Theme.ControlLabel, Fade), Label);

    // 📝 Compact (.seg-bar): 30 px track, pad/gap 3, radii 12/9, 10.5 px options, active #262626.
    const float TrackTall = Compact ? 30.0f : 35.0f;
    const float Pad       = Compact ? 3.0f : 4.0f;
    const float Gap       = Compact ? 3.0f : 4.0f;
    float       TextSize  = Compact ? 10.5f : 11.0f;
    const ImU32 TrackFill = Compact ? ResolveCssColour(0x0C0C0CFF) : Theme.SelectFill;
    const ImU32 ChosenFill = Compact ? ResolveCssColour(0x262626FF) : Theme.SegmentFill;
    const ImU32 IdleText  = Compact ? ResolveCssColour(0x848484FF) : Theme.SegmentIdle;
    const ImU32 ChosenText = Compact ? ResolveCssColour(0xF3F3F3FF) : Theme.SegmentText;
    const ImVec2 Top      = Column.Space(TrackTall, 0.0f, 15.0f);
    const ImVec2 TrackMax(Top.x + Width, Top.y + TrackTall * S);
    DrawList->AddRectFilled(Top, TrackMax, FadeColour(TrackFill, Fade), Compact ? 12.0f * S : 0.5f * TrackTall * S);
    DrawList->AddRect(Top, TrackMax, FadeColour(Theme.SelectBorder, Fade), Compact ? 12.0f * S : 0.5f * TrackTall * S, ImDrawFlags_None, S);

    const float  Wide   = (Width - 2.0f * Pad * S - Gap * S * static_cast<float>(Count - 1)) / static_cast<float>(Count);
    const float  Tall   = (TrackTall - 2.0f * Pad) * S;
    // 📝 Flex-shrink like the browser: long option sets (Vorticity ω, Divergence ∇·v) drop size until every label fits
    //    its slot instead of bleeding into neighbours; sets that already fit keep their exact size.
    for (;;)
    {
        float Widest = 0.0f;
        for (int Index = 0; Index < Count; ++Index)
        {
            const float Advance = GlyphRun::Measure(Column, Faces.Regular, TextSize * S, Options[Index]);
            if (Advance > Widest) Widest = Advance;
        }
        if (Widest <= Wide - 8.0f * S || TextSize <= 8.0f) break;
        TextSize -= 0.5f;
    }
    const int    Before = InOutIndex;
    ImGui::PushID(Id);
    for (int Index = 0; Index < Count; ++Index)
    {
        const ImVec2 Min(Top.x + Pad * S + static_cast<float>(Index) * (Wide + Gap * S), Top.y + Pad * S);
        const ImVec2 Max(Min.x + Wide, Min.y + Tall);
        ImGui::SetCursorScreenPos(Min);
        ImGui::PushID(Index);
        if (!Enabled) ImGui::BeginDisabled();
        if (ImGui::InvisibleButton("##Segment", ImVec2(Wide, Tall), ImGuiButtonFlags_EnableNav) && Enabled) InOutIndex = Index;
        if (ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled)) ControlColumn::ConstructTooltip(Tooltip);
        if (!Enabled) ImGui::EndDisabled();
        ImGui::PopID();
        const bool Chosen = Index == InOutIndex;
        if (Chosen) DrawList->AddRectFilled(Min, Max, FadeColour(ChosenFill, Fade), Compact ? 9.0f * S : 0.5f * Tall);
        const float Advance = GlyphRun::Measure(Column, Faces.Regular, TextSize * S, Options[Index]);
        const float LineTop = Min.y + 0.5f * (Tall - TextSize * 1.38f * S);
        (void)GlyphRun::Construct(Column, Faces.Regular, TextSize * S,
                                  ImVec2(Min.x + 0.5f * (Wide - Advance), GlyphRun::ResolveBaseline(LineTop, TextSize * S, 1.38f)),
                                  FadeColour(Chosen ? ChosenText : IdleText, Fade), Options[Index]);
    }
    ImGui::PopID();
    return InOutIndex != Before;
}

} // namespace Frontier
