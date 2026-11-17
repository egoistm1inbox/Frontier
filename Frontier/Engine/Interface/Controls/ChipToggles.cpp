/*==========================================================================================================================================
                                                           CHIPTOGGLES.CPP
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js ChipToggles: a label over wrapping multi-select chips (.chip-toggle: padding 4/10,
//    radius 999, 10.5 px) plus a 10 px detail line. ON chips glow highlight-lime.

#include "Engine/Interface/Controls/ChipToggles.h"

#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/GlyphRun.h"
#include "Engine/Interface/InspectorControls.h"

#include <vector>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    CHIP TOGGLES
//------------------------------------------------------------------------------------------------------------------------

bool ChipToggles::Construct(ControlColumn& Column, const char* Id, const char* Label, const char* const* Options, bool* Values, int Count,
                            const char* Detail, bool Enabled, const char* Tooltip)
{
    const ControlTheme&    Theme    = Column.QueryTheme();
    const EditorTypefaces& Faces    = Column.QueryFaces();
    ImDrawList* const      DrawList = Column.QueryDrawList();
    const float            S        = Column.QueryScale();
    const float            Width    = Column.QueryWidth();
    if (Count <= 0 || Options == nullptr || Values == nullptr) return false;
    const float Fade       = Enabled ? 1.0f : 0.42f;
    const bool  Elaborated = Detail != nullptr && Detail[0] != '\0';

    const ImVec2 Head = Column.Space(17.0f, 0.0f, 7.0f);
    (void)GlyphRun::Construct(Column, Faces.Regular, 12.0f * S, ImVec2(Head.x, GlyphRun::ResolveBaseline(Head.y, 12.0f * S, 1.4f)),
                              FadeColour(Theme.ControlLabel, Fade), Label);

    // 📝 Measure pass: flow the chips (gap 5) so the wrap reserves its rows up front.
    constexpr float ChipTall = 23.0f;
    constexpr float Gap      = 5.0f;
    std::vector<float> Advances(static_cast<size_t>(Count));
    for (int Index = 0; Index < Count; ++Index) Advances[static_cast<size_t>(Index)] = GlyphRun::Measure(Column, Faces.Regular, 10.5f * S, Options[Index]);
    int   Rows  = 1;
    float Run   = 0.0f;
    for (int Index = 0; Index < Count; ++Index)
    {
        const float ChipWide = Advances[static_cast<size_t>(Index)] + 20.0f * S;
        if (Run > 0.0f && Run + Gap * S + ChipWide > Width)
        {
            ++Rows;
            Run = 0.0f;
        }
        Run += (Run > 0.0f ? Gap * S : 0.0f) + ChipWide;
    }
    const float DetailTall = Elaborated ? 16.0f : 0.0f;
    const ImVec2 Top       = Column.Space(6.0f + Rows * ChipTall + (Rows - 1) * Gap + DetailTall, 0.0f, 14.0f);

    bool  Flipped = false;
    float X       = Top.x;
    float Y       = Top.y + 6.0f * S;
    ImGui::PushID(Id);
    if (!Enabled) ImGui::BeginDisabled();
    for (int Index = 0; Index < Count; ++Index)
    {
        const float ChipWide = Advances[static_cast<size_t>(Index)] + 20.0f * S;
        if (X > Top.x && X + ChipWide > Top.x + Width)
        {
            X = Top.x;
            Y += (ChipTall + Gap) * S;
        }
        const ImVec2 Min(X, Y);
        const ImVec2 Max(X + ChipWide, Y + ChipTall * S);
        ImGui::SetCursorScreenPos(Min);
        ImGui::PushID(Index);
        if (ImGui::InvisibleButton("##Chip", ImVec2(ChipWide, ChipTall * S), ImGuiButtonFlags_EnableNav) && Enabled)
        {
            Values[Index] = !Values[Index];
            Flipped       = true;
        }
        if (ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled)) ControlColumn::ConstructTooltip(Tooltip);
        ImGui::PopID();
        const bool On = Values[Index];
        DrawList->AddRectFilled(Min, Max, FadeColour(ResolveCssColour(On ? 0xEFF4CF21 : 0x141414FF), Fade), 0.5f * ChipTall * S);
        DrawList->AddRect(Min, Max, FadeColour(ResolveCssColour(On ? 0xEFF4CF73 : 0xFFFFFF12), Fade), 0.5f * ChipTall * S, ImDrawFlags_None,
                          S);
        const float LineTop = Min.y + 0.5f * (ChipTall * S - 10.5f * 1.38f * S);
        (void)GlyphRun::Construct(Column, Faces.Regular, 10.5f * S,
                                  ImVec2(Min.x + 10.0f * S, GlyphRun::ResolveBaseline(LineTop, 10.5f * S, 1.38f)),
                                  FadeColour(ResolveCssColour(On ? 0xEFF4CFFF : 0x848484FF), Fade), Options[Index]);
        X += ChipWide + Gap * S;
    }
    if (!Enabled) ImGui::EndDisabled();
    ImGui::PopID();
    if (Elaborated)
    {
        const float DetailTop = Top.y + (6.0f + Rows * ChipTall + (Rows - 1) * Gap) * S + 2.0f * S;
        (void)GlyphRun::Construct(Column, Faces.Regular, 10.0f * S, ImVec2(Top.x, GlyphRun::ResolveBaseline(DetailTop, 10.0f * S, 1.4f)),
                                  FadeColour(ResolveCssColour(0x6E6E6EFF), Fade), Detail);
    }
    return Flipped;
}

} // namespace Frontier
