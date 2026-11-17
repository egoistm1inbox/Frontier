/*==========================================================================================================================================
                                                             PILLTABS.CPP
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js PillTabs: the 36 px joined pill bar (.pill-tabs: #080808, pad 4, gap 3, radius 999)
//    with 11 px tabs, the active tab filled #282828.

#include "Engine/Interface/Controls/PillTabs.h"

#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/GlyphRun.h"
#include "Engine/Interface/InspectorControls.h"

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    PILL TABS
//------------------------------------------------------------------------------------------------------------------------

bool PillTabs::Construct(ControlColumn& Column, const char* Id, const char* const* Options, int Count, int& InOutIndex, bool Enabled,
                         const char* Tooltip)
{
    const ControlTheme&    Theme    = Column.QueryTheme();
    const EditorTypefaces& Faces    = Column.QueryFaces();
    ImDrawList* const      DrawList = Column.QueryDrawList();
    const float            S        = Column.QueryScale();
    const float            Width    = Column.QueryWidth();
    if (Count <= 0 || Options == nullptr) return false;
    if (InOutIndex < 0 || InOutIndex >= Count) InOutIndex = 0;
    const float Fade = Enabled ? 1.0f : 0.42f;

    constexpr float BarTall = 36.0f;
    constexpr float Pad     = 4.0f;
    constexpr float Gap     = 3.0f;
    const ImVec2    Top     = Column.Space(BarTall, 0.0f, 12.0f);
    const ImVec2    BarMax(Top.x + Width, Top.y + BarTall * S);
    DrawList->AddRectFilled(Top, BarMax, FadeColour(ResolveCssColour(0x080808FF), Fade), 0.5f * BarTall * S);
    DrawList->AddRect(Top, BarMax, FadeColour(Theme.SelectBorder, Fade), 0.5f * BarTall * S, ImDrawFlags_None, S);

    const float Wide   = (Width - 2.0f * Pad * S - Gap * S * static_cast<float>(Count - 1)) / static_cast<float>(Count);
    const float Tall   = (BarTall - 2.0f * Pad) * S;
    const int   Before = InOutIndex;
    ImGui::PushID(Id);
    for (int Index = 0; Index < Count; ++Index)
    {
        const ImVec2 Min(Top.x + Pad * S + static_cast<float>(Index) * (Wide + Gap * S), Top.y + Pad * S);
        const ImVec2 Max(Min.x + Wide, Min.y + Tall);
        ImGui::SetCursorScreenPos(Min);
        ImGui::PushID(Index);
        if (!Enabled) ImGui::BeginDisabled();
        if (ImGui::InvisibleButton("##PillTab", ImVec2(Wide, Tall), ImGuiButtonFlags_EnableNav) && Enabled) InOutIndex = Index;
        if (ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled)) ControlColumn::ConstructTooltip(Tooltip);
        if (!Enabled) ImGui::EndDisabled();
        ImGui::PopID();
        const bool Chosen = Index == InOutIndex;
        if (Chosen)
        {
            DrawList->AddRectFilled(Min, Max, FadeColour(ResolveCssColour(0x282828FF), Fade), 0.5f * Tall);
            DrawList->AddRect(Min, Max, FadeColour(ResolveCssColour(0xFFFFFF14), Fade), 0.5f * Tall, ImDrawFlags_None, S);
        }
        const float Advance = GlyphRun::Measure(Column, Faces.Medium, 11.0f * S, Options[Index]);
        const float LineTop = Min.y + 0.5f * (Tall - 11.0f * 1.38f * S);
        (void)GlyphRun::Construct(Column, Faces.Medium, 11.0f * S,
                                  ImVec2(Min.x + 0.5f * (Wide - Advance), GlyphRun::ResolveBaseline(LineTop, 11.0f * S, 1.38f)),
                                  FadeColour(ResolveCssColour(Chosen ? 0xF3F3F3FF : 0x7D7D7DFF), Fade), Options[Index]);
    }
    ImGui::PopID();
    return InOutIndex != Before;
}

} // namespace Frontier
