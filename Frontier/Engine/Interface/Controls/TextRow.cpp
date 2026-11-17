/*==========================================================================================================================================
                                                               TEXTROW.CPP
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js TextRow: a 12 px label over a 34 px pill field (.studio-input) with an always-on
//    transparent text entry.

#include "Engine/Interface/Controls/TextRow.h"

#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/GlyphRun.h"
#include "Engine/Interface/InspectorControls.h"

#include <algorithm>
#include <vector>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    TEXT ROW
//------------------------------------------------------------------------------------------------------------------------

bool TextRow::Construct(ControlColumn& Column, const char* Id, const char* Label, std::string& InOutText, bool Enabled, const char* Tooltip)
{
    const ControlTheme&    Theme    = Column.QueryTheme();
    const EditorTypefaces& Faces    = Column.QueryFaces();
    ImDrawList* const      DrawList = Column.QueryDrawList();
    const float            S        = Column.QueryScale();
    const float            Width    = Column.QueryWidth();
    const float            Fade     = Enabled ? 1.0f : 0.42f;

    const ImVec2 Head = Column.Space(17.0f, 0.0f, 7.0f);
    (void)GlyphRun::Construct(Column, Faces.Regular, 12.0f * S, ImVec2(Head.x, GlyphRun::ResolveBaseline(Head.y, 12.0f * S, 1.4f)),
                              FadeColour(Theme.ControlLabel, Fade), Label);

    constexpr float FieldTall = 34.0f;
    const ImVec2    Top       = Column.Space(FieldTall, 0.0f, 15.0f);
    const ImVec2    FieldMax(Top.x + Width, Top.y + FieldTall * S);
    DrawList->AddRectFilled(Top, FieldMax, FadeColour(Theme.SelectFill, Fade), 0.5f * FieldTall * S);
    DrawList->AddRect(Top, FieldMax, FadeColour(Theme.SelectBorder, Fade), 0.5f * FieldTall * S, ImDrawFlags_None, S);

    std::vector<char> Scratch(std::max<size_t>(InOutText.size() + 64, 64), '\0');
    std::copy(InOutText.begin(), InOutText.end(), Scratch.begin());
    ImGui::PushID(Id);
    ImGui::SetCursorScreenPos(ImVec2(Top.x + 12.0f * S, Top.y));
    ImGui::PushStyleColor(ImGuiCol_FrameBg, ResolveCssColour(0x00000000));
    ImGui::PushStyleColor(ImGuiCol_Text, FadeColour(Theme.SelectText, Fade));
    ImGui::PushStyleColor(ImGuiCol_TextDisabled, FadeColour(Theme.SelectText, 0.42f * Fade));
    ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 0.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(0.0f, 0.5f * (FieldTall * S - ImGui::GetFontSize())));
    ImGui::PushItemWidth(Width - 24.0f * S);
    if (!Enabled) ImGui::BeginDisabled();
    const bool Changed = Enabled && ImGui::InputText("##Text", Scratch.data(), Scratch.size(), ImGuiInputTextFlags_AutoSelectAll);
    if (ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled)) ControlColumn::ConstructTooltip(Tooltip);
    if (!Enabled) ImGui::EndDisabled();
    ImGui::PopItemWidth();
    ImGui::PopStyleVar(2);
    ImGui::PopStyleColor(3);
    ImGui::PopID();
    if (Changed) InOutText.assign(Scratch.data());
    return Changed;
}

} // namespace Frontier
