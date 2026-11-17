/*==========================================================================================================================================
                                                             STATGRID.CPP
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js StatGrid: the two-column .stat-cell grid (14 px figure, 10 px label, radius 13).

#include "Engine/Interface/Controls/StatGrid.h"

#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/GlyphRun.h"
#include "Engine/Interface/InspectorControls.h"

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    STAT GRID
//------------------------------------------------------------------------------------------------------------------------

void StatGrid::Construct(ControlColumn& Column, const StatGridCell* Cells, int Count, bool Enabled)
{
    const EditorTypefaces& Faces    = Column.QueryFaces();
    ImDrawList* const      DrawList = Column.QueryDrawList();
    const float            S        = Column.QueryScale();
    const float            Width    = Column.QueryWidth();
    if (Count <= 0 || Cells == nullptr) return;
    const float Fade = Enabled ? 1.0f : 0.42f;

    // 📝 Cell: padding 9/11 around a 14 px figure (~19 px) and a 10 px label (~14 px).
    constexpr float CellTall = 52.0f;
    constexpr float Gap      = 7.0f;
    const int       Rows     = (Count + 1) / 2;
    const ImVec2    Top      = Column.Space(Rows * CellTall + (Rows - 1) * Gap, 8.0f, 0.0f);
    const float     Wide     = (Width - Gap * S) / 2.0f;
    for (int Index = 0; Index < Count; ++Index)
    {
        const ImVec2 Min(Top.x + (Index % 2) * (Wide + Gap * S), Top.y + (Index / 2) * (CellTall * S + Gap * S));
        const ImVec2 Max(Min.x + Wide, Min.y + CellTall * S);
        DrawList->AddRectFilled(Min, Max, FadeColour(ResolveCssColour(0x151515FF), Fade), 13.0f * S);
        DrawList->AddRect(Min, Max, FadeColour(ResolveCssColour(0xFFFFFF12), Fade), 13.0f * S, ImDrawFlags_None, S);
        (void)GlyphRun::Construct(Column, Faces.Regular, 14.0f * S,
                                  ImVec2(Min.x + 11.0f * S, GlyphRun::ResolveBaseline(Min.y + 9.0f * S, 14.0f * S, 1.38f)),
                                  FadeColour(ResolveCssColour(0xF0F0F0FF), Fade), Cells[Index].Value);
        (void)GlyphRun::Construct(Column, Faces.Regular, 10.0f * S,
                                  ImVec2(Min.x + 11.0f * S, GlyphRun::ResolveBaseline(Min.y + (9.0f + 14.0f * 1.38f) * S, 10.0f * S, 1.4f)),
                                  FadeColour(ResolveCssColour(0x848484FF), Fade), Cells[Index].Label);
    }
}

} // namespace Frontier
