/*==========================================================================================================================================
                                                            METRICTRIO.CPP
==========================================================================================================================================*/
// 🧩 Remastered metric trio: three gradient mini tiles in a row (20 px light figure, 10 px label). Display-only; the
//    caller owns every figure, so the shell stays honest about what it simulates (nothing) and what it holds (local state).

#include "Engine/Interface/Controls/MetricTrio.h"

#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/GlyphRun.h"
#include "Engine/Interface/InspectorControls.h"

#include <imgui_internal.h>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    METRIC TRIO
//------------------------------------------------------------------------------------------------------------------------

void MetricTrio::Construct(ControlColumn& Column, const MetricTrioItem* Items, bool Enabled)
{
    if (Items == nullptr) return;
    const EditorTypefaces& Faces    = Column.QueryFaces();
    ImDrawList* const      DrawList = Column.QueryDrawList();
    const float            S        = Column.QueryScale();
    const float            Width    = Column.QueryWidth();
    const float            Fade     = Enabled ? 1.0f : 0.42f;

    constexpr float TileTall = 58.0f;
    constexpr float Gap      = 7.0f;
    const ImVec2    Top      = Column.Space(TileTall, 0.0f, 10.0f);
    const float     Wide     = (Width - 2.0f * Gap * S) / 3.0f;

    for (int Index = 0; Index < 3; ++Index)
    {
        const MetricTrioItem& Item = Items[Index];
        const ImVec2          Min(Top.x + Index * (Wide + Gap * S), Top.y);
        const ImVec2          Max(Min.x + Wide, Top.y + TileTall * S);
        const int             Verts = DrawList->VtxBuffer.Size;
        DrawList->AddRectFilled(Min, Max, FadeColour(ResolveCssColour(0x212121FF), Fade), 16.0f * S);
        ImGui::ShadeVertsLinearColorGradientKeepAlpha(DrawList, Verts, DrawList->VtxBuffer.Size, Min, Max,
                                                      FadeColour(ResolveCssColour(0x212121FF), Fade),
                                                      FadeColour(ResolveCssColour(0x191919FF), Fade));
        DrawList->AddRect(Min, Max, FadeColour(ResolveCssColour(0xFFFFFF0F), Fade), 16.0f * S, ImDrawFlags_None, S);
        ImU32 Figure = ResolveCssColour(0xF1F1F1FF);
        if (Item.Tone == 1) Figure = ResolveCssColour(0x3EC46DFF);
        else if (Item.Tone == 2) Figure = ResolveCssColour(0xE8C27AFF);
        if (Item.Value != nullptr)
        {
            (void)GlyphRun::Construct(Column, Faces.Light, 20.0f * S,
                                      ImVec2(Min.x + 12.0f * S, GlyphRun::ResolveBaseline(Min.y + 9.0f * S, 20.0f * S, 1.1f)),
                                      FadeColour(Figure, Fade), Item.Value);
        }
        if (Item.Label != nullptr)
        {
            (void)GlyphRun::Construct(Column, Faces.Regular, 10.0f * S,
                                      ImVec2(Min.x + 12.0f * S, GlyphRun::ResolveBaseline(Min.y + 32.0f * S, 10.0f * S, 1.4f)),
                                      FadeColour(ResolveCssColour(0x848484FF), Fade), Item.Label);
        }
    }
}

} // namespace Frontier
