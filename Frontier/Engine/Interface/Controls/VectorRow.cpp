/*==========================================================================================================================================
                                                              VECTORROW.CPP
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js VectorRow: a label plus unit over three 30 px pill cells (.vector-cell) with coloured
//    axis tags. A cell's figure edits through a transparent scalar field.

#include "Engine/Interface/Controls/VectorRow.h"

#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/GlyphRun.h"
#include "Engine/Interface/InspectorControls.h"

#include <imgui_internal.h>

#include <algorithm>
#include <cmath>
#include <cstdio>

namespace Frontier
{

namespace
{

constexpr const char* AxisTags[3] = { "X", "Y", "Z" };
constexpr uint32_t    AxisTints[3] = { 0xEF5350FF, 0x69D06DFF, 0x5B8CFFFF };

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    VECTOR ROW
//------------------------------------------------------------------------------------------------------------------------

bool VectorRow::Construct(ControlColumn& Column, const char* Id, const char* Label, const char* Unit, double Values[3], int Digits,
                          bool Bounded, double Minimum, double Maximum, bool Enabled, const char* Tooltip)
{
    return Construct(Column, Id, Label, Unit, Values, Digits, Bounded, Minimum, Maximum, false, Enabled, Tooltip);
}

bool VectorRow::Construct(ControlColumn& Column, const char* Id, const char* Label, const char* Unit, double Values[3], int Digits,
                          bool Bounded, double Minimum, double Maximum, bool MonoAxes, bool Enabled, const char* Tooltip)
{
    const ControlTheme&    Theme    = Column.QueryTheme();
    const EditorTypefaces& Faces    = Column.QueryFaces();
    ImDrawList* const      DrawList = Column.QueryDrawList();
    const float            S        = Column.QueryScale();
    const float            Width    = Column.QueryWidth();
    if (Values == nullptr) return false;
    const float Fade   = Enabled ? 1.0f : 0.42f;
    const int   Places = std::clamp(Digits, 0, 6);
    bool        Moved  = false;

    const ImVec2 Head = Column.Space(17.0f, 0.0f, 7.0f);
    (void)GlyphRun::Construct(Column, Faces.Regular, 12.0f * S, ImVec2(Head.x, GlyphRun::ResolveBaseline(Head.y, 12.0f * S, 1.4f)),
                              FadeColour(Theme.ControlLabel, Fade), Label);
    if (Unit != nullptr && Unit[0] != '\0')
    {
        const float Advance = GlyphRun::Measure(Column, Faces.Regular, 10.0f * S, Unit);
        (void)GlyphRun::Construct(Column, Faces.Regular, 10.0f * S,
                                  ImVec2(Head.x + Width - Advance, GlyphRun::ResolveBaseline(Head.y + 1.0f * S, 10.0f * S, 1.4f)),
                                  FadeColour(Theme.Index, Fade), Unit);
    }

    const float CellTall = MonoAxes ? 26.0f : 30.0f;
    const float CellRadius = MonoAxes ? 10.0f : 0.5f * CellTall;
    constexpr float Gap  = 6.0f;
    const ImVec2    Top  = Column.Space(CellTall, 0.0f, 15.0f);
    const float     Wide = (Width - 2.0f * Gap * S) / 3.0f;
    ImGui::PushID(Id);
    if (!Enabled) ImGui::BeginDisabled();
    for (int Axis = 0; Axis < 3; ++Axis)
    {
        const ImVec2 Min(Top.x + static_cast<float>(Axis) * (Wide + Gap * S), Top.y);
        const ImVec2 Max(Min.x + Wide, Min.y + CellTall * S);
        DrawList->AddRectFilled(Min, Max, FadeColour(ResolveCssColour(0x0A0A0AFF), Fade), CellRadius * S);
        DrawList->AddRect(Min, Max, FadeColour(Theme.SelectBorder, Fade), CellRadius * S, ImDrawFlags_None, S);

        const ImU32 TagTint = MonoAxes ? ResolveCssColour(0x5E5E5EFF) : ResolveCssColour(AxisTints[Axis]);
        const float TagTop  = Min.y + 0.5f * (CellTall * S - 10.0f * 1.4f * S);
        (void)GlyphRun::Construct(Column, Faces.Medium, 10.0f * S, ImVec2(Min.x + 9.0f * S, GlyphRun::ResolveBaseline(TagTop, 10.0f * S, 1.4f)),
                                  FadeColour(TagTint, Fade), AxisTags[Axis]);
        const float TagWide   = GlyphRun::Measure(Column, Faces.Medium, 10.0f * S, AxisTags[Axis]);
        const ImVec2 FigureMin(Min.x + 9.0f * S + TagWide + 6.0f * S, Min.y);
        const ImVec2 FigureMax(Max.x - 9.0f * S, Max.y);

        ImGui::PushID(Axis);
        const ImGuiID FigureId = ImGui::GetID("##AxisFigure");
        bool          Typing   = ImGui::TempInputIsActive(FigureId);
        if (!Typing)
        {
            ImGui::SetCursorScreenPos(FigureMin);
            if (ImGui::InvisibleButton("##AxisFigure", ImVec2(FigureMax.x - FigureMin.x, FigureMax.y - FigureMin.y),
                                       ImGuiButtonFlags_EnableNav) &&
                Enabled)
            {
                Typing = true;
            }
            if (ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled)) ControlColumn::ConstructTooltip(Tooltip);
        }
        if (Typing && Enabled)
        {
            double Display = Values[Axis];
            char   Format[16]{};
            std::snprintf(Format, sizeof(Format), "%%.%df", Places);
            ImGui::PushStyleColor(ImGuiCol_FrameBg, ResolveCssColour(0x00000000));
            ImGui::PushStyleColor(ImGuiCol_Text, Theme.SliderNumber);
            ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 8.0f * S);
            if (ImGui::TempInputScalar(ImRect(FigureMin, FigureMax), FigureId, "##AxisEntry", ImGuiDataType_Double, &Display, Format,
                                       nullptr, nullptr) &&
                std::isfinite(Display))
            {
                const double Next = Bounded ? std::clamp(Display, Minimum, Maximum) : Display;
                Moved        = Next != Values[Axis];
                Values[Axis] = Next;
            }
            ImGui::PopStyleVar();
            ImGui::PopStyleColor(2);
        }
        else
        {
            char Figure[48]{};
            std::snprintf(Figure, sizeof(Figure), "%.*f", Places, Values[Axis]);
            const float FigureSize = MonoAxes ? 11.0f : 11.5f;
            ImFont* const FigureFace = (MonoAxes && Faces.Monospace != nullptr) ? Faces.Monospace : Faces.Regular;
            const float NumberTop = Min.y + 0.5f * (CellTall * S - FigureSize * 1.38f * S);
            (void)GlyphRun::Construct(Column, FigureFace, FigureSize * S,
                                      ImVec2(FigureMin.x, GlyphRun::ResolveBaseline(NumberTop, FigureSize * S, 1.38f)),
                                      FadeColour(Theme.SliderNumber, Fade), Figure);
        }
        ImGui::PopID();
    }
    if (!Enabled) ImGui::EndDisabled();
    ImGui::PopID();
    return Moved;
}

} // namespace Frontier
