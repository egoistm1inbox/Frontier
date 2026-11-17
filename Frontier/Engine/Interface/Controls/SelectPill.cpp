/*==========================================================================================================================================
                                                            SELECTPILL.CPP
==========================================================================================================================================*/
// 🧩 Remastered select pill: the 38 px particle dropdown and tab strip. The dropdown popup is a NoDecoration window
//    pinned under the pill; option rows are 32 px with a warm wash behind the current choice.

#include "Engine/Interface/Controls/SelectPill.h"

#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/GlyphRun.h"
#include "Engine/Interface/Controls/GlyphSymbol.h"
#include "Engine/Interface/InspectorControls.h"

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    SELECT PILL
//------------------------------------------------------------------------------------------------------------------------

bool SelectPill::Construct(ControlColumn& Column, const char* Id, const char* Label, const char* const* Options, int Count,
                           int& InOutIndex, bool Enabled, const char* Tooltip, ImVec4* OutRects)
{
    const EditorTypefaces& Faces    = Column.QueryFaces();
    ImDrawList* const      DrawList = Column.QueryDrawList();
    const float            S        = Column.QueryScale();
    const float            Width    = Column.QueryWidth();
    if (Options == nullptr || Count <= 0) return false;
    if (InOutIndex < 0 || InOutIndex >= Count) InOutIndex = 0;
    const float Fade = Enabled ? 1.0f : 0.42f;

    constexpr float PillTall = 38.0f;
    const ImVec2    Top      = Column.Space(PillTall, 0.0f, 10.0f);
    const ImVec2    Min(Top.x, Top.y);
    const ImVec2    Max(Top.x + Width, Top.y + PillTall * S);
    bool            Changed  = false;

    DrawList->AddRectFilled(Min, Max, FadeColour(ResolveCssColour(0x1B1B1BFF), Fade), 12.0f * S);
    DrawList->AddRect(Min, Max, FadeColour(ResolveCssColour(0xFFFFFF24), Fade), 12.0f * S, ImDrawFlags_None, S);
    const float MidY = Min.y + 0.5f * PillTall * S;
    if (Label != nullptr && Label[0] != '\0')
    {
        (void)GlyphRun::Construct(Column, Faces.Medium, 11.0f * S,
                                  ImVec2(Min.x + 12.0f * S, GlyphRun::ResolveBaseline(MidY - 0.5f * 11.0f * 1.38f * S, 11.0f * S, 1.38f)),
                                  FadeColour(ResolveCssColour(0xBCBCBCFF), Fade), Label);
    }
    const char* Current   = Options[InOutIndex] != nullptr ? Options[InOutIndex] : "";
    const float ValueWide = GlyphRun::Measure(Column, Faces.Medium, 11.0f * S, Current);
    (void)GlyphRun::Construct(Column, Faces.Medium, 11.0f * S,
                              ImVec2(Max.x - 12.0f * S - 12.0f * S - 6.0f * S - ValueWide,
                                     GlyphRun::ResolveBaseline(MidY - 0.5f * 11.0f * 1.38f * S, 11.0f * S, 1.38f)),
                              FadeColour(ResolveCssColour(0xE8C27AFF), Fade), Current);
    (void)GlyphSymbol::Construct(DrawList, "StudioChevron", ImVec2(Max.x - 12.0f * S - 12.0f * S, MidY - 6.0f * S), 12.0f * S, 1.8f * S,
                                 FadeColour(ResolveCssColour(0x848484FF), Fade));

    ImGui::PushID(Id);
    ImGui::SetCursorScreenPos(Min);
    if (!Enabled) ImGui::BeginDisabled();
    if (ImGui::InvisibleButton("##Select", ImVec2(Width, PillTall * S), ImGuiButtonFlags_EnableNav) && Enabled) ImGui::OpenPopup("##Options");
    if (ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled)) ControlColumn::ConstructTooltip(Tooltip);
    if (!Enabled) ImGui::EndDisabled();

    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(4.0f * S, 4.0f * S));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 12.0f * S);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, S);
    ImGui::PushStyleColor(ImGuiCol_PopupBg, ImGui::ColorConvertU32ToFloat4(ResolveCssColour(0x161616FF)));
    ImGui::PushStyleColor(ImGuiCol_Border, ImGui::ColorConvertU32ToFloat4(ResolveCssColour(0xFFFFFF24)));
    ImGui::SetNextWindowPos(ImVec2(Min.x, Max.y + 4.0f * S));
    ImGui::SetNextWindowSize(ImVec2(Width, 0.0f));
    if (ImGui::BeginPopup("##Options", ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoSavedSettings))
    {
        ImDrawList* const      PopupList  = ImGui::GetWindowDrawList();
        const ImVec2           ListMin    = ImGui::GetCursorScreenPos();
        constexpr float        RowTall    = 32.0f;
        const float            ListWide   = Width - 8.0f * S;
        for (int Index = 0; Index < Count; ++Index)
        {
            const ImVec2 RowMin(ListMin.x, ListMin.y + Index * RowTall * S);
            const ImVec2 RowMax(RowMin.x + ListWide, RowMin.y + RowTall * S);
            const bool   CurrentRow = Index == InOutIndex;
            if (CurrentRow) PopupList->AddRectFilled(RowMin, RowMax, ResolveCssColour(0xE8C27A1F), 8.0f * S);
            const char* Text = Options[Index] != nullptr ? Options[Index] : "";
            (void)GlyphRun::Rasterize(PopupList, &Faces, Faces.Regular, 11.0f * S,
                                      ImVec2(RowMin.x + 10.0f * S,
                                             GlyphRun::ResolveBaseline(RowMin.y + 0.5f * (RowTall * S - 11.0f * 1.38f * S), 11.0f * S,
                                                                       1.38f)),
                                      ResolveCssColour(CurrentRow ? 0xE8C27AFF : 0xD8D8D8FF), Text, 0.0f, false);
            if (OutRects != nullptr) OutRects[Index] = ImVec4(RowMin.x, RowMin.y, RowMax.x, RowMax.y);
            ImGui::SetCursorScreenPos(RowMin);
            ImGui::PushID(Index);
            if (ImGui::InvisibleButton("##Option", ImVec2(ListWide, RowTall * S), ImGuiButtonFlags_EnableNav))
            {
                if (InOutIndex != Index)
                {
                    InOutIndex = Index;
                    Changed    = true;
                }
                ImGui::CloseCurrentPopup();
            }
            ImGui::PopID();
        }
        ImGui::SetCursorScreenPos(ImVec2(ListMin.x, ListMin.y + Count * RowTall * S));
        ImGui::Dummy(ImVec2(1.0f, 1.0f));
        ImGui::EndPopup();
    }
    ImGui::PopStyleColor(2);
    ImGui::PopStyleVar(3);
    ImGui::PopID();
    return Changed;
}

bool SelectPill::ConstructTabs(ControlColumn& Column, const char* Id, const char* const* Options, int Count, int& InOutIndex, bool Enabled,
                               const char* Tooltip, ImVec4* OutRects)
{
    const EditorTypefaces& Faces    = Column.QueryFaces();
    ImDrawList* const      DrawList = Column.QueryDrawList();
    const float            S        = Column.QueryScale();
    const float            Width    = Column.QueryWidth();
    if (Options == nullptr || Count <= 0) return false;
    if (InOutIndex < 0 || InOutIndex >= Count) InOutIndex = 0;
    const float Fade = Enabled ? 1.0f : 0.42f;

    constexpr float TrackTall = 38.0f;
    constexpr float Pad       = 3.0f;
    const ImVec2    Top       = Column.Space(TrackTall, 0.0f, 10.0f);
    const ImVec2    Min(Top.x, Top.y);
    const ImVec2    Max(Top.x + Width, Top.y + TrackTall * S);
    const float     Wide      = (Width - 2.0f * Pad * S - static_cast<float>(Count - 1) * Pad * S) / static_cast<float>(Count);
    bool            Changed   = false;

    DrawList->AddRectFilled(Min, Max, FadeColour(ResolveCssColour(0x101010FF), Fade), 12.0f * S);
    DrawList->AddRect(Min, Max, FadeColour(ResolveCssColour(0xFFFFFF12), Fade), 12.0f * S, ImDrawFlags_None, S);

    ImGui::PushID(Id);
    if (!Enabled) ImGui::BeginDisabled();
    for (int Index = 0; Index < Count; ++Index)
    {
        const ImVec2 TabMin(Min.x + Pad * S + Index * (Wide + Pad * S), Min.y + Pad * S);
        const ImVec2 TabMax(TabMin.x + Wide, Max.y - Pad * S);
        const bool   Active = Index == InOutIndex;
        if (Active)
        {
            DrawList->AddRectFilled(TabMin, TabMax, FadeColour(ResolveCssColour(0xE8C27A2E), Fade), 9.0f * S);
            DrawList->AddRect(TabMin, TabMax, FadeColour(ResolveCssColour(0xE8C27A66), Fade), 9.0f * S, ImDrawFlags_None, S);
        }
        const char* Text      = Options[Index] != nullptr ? Options[Index] : "";
        const float TextWide  = GlyphRun::Measure(Column, Faces.Medium, 11.0f * S, Text);
        const float TextTop   = TabMin.y + 0.5f * ((TabMax.y - TabMin.y) - 11.0f * 1.38f * S);
        (void)GlyphRun::Construct(Column, Faces.Medium, 11.0f * S,
                                  ImVec2(TabMin.x + 0.5f * (Wide - TextWide), GlyphRun::ResolveBaseline(TextTop, 11.0f * S, 1.38f)),
                                  FadeColour(ResolveCssColour(Active ? 0xE8C27AFF : 0x848484FF), Fade), Text);
        if (OutRects != nullptr) OutRects[Index] = ImVec4(TabMin.x, TabMin.y, TabMax.x, TabMax.y);
        ImGui::SetCursorScreenPos(TabMin);
        ImGui::PushID(Index);
        if (ImGui::InvisibleButton("##Tab", ImVec2(Wide, TabMax.y - TabMin.y), ImGuiButtonFlags_EnableNav) && Enabled)
        {
            if (InOutIndex != Index)
            {
                InOutIndex = Index;
                Changed    = true;
            }
        }
        if (ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled)) ControlColumn::ConstructTooltip(Tooltip);
        ImGui::PopID();
    }
    if (!Enabled) ImGui::EndDisabled();
    ImGui::PopID();
    return Changed;
}

} // namespace Frontier
