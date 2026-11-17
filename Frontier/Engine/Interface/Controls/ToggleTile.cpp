/*==========================================================================================================================================
                                                            TOGGLETILE.CPP
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js ToggleTile: the .toggle-grid feature tiles (28 px glyph chip, 10.5 px label, ON/OFF
//    state). Idle tiles are charcoal; the ON tile glows live-green.

#include "Engine/Interface/Controls/ToggleTile.h"

#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/GlyphRun.h"
#include "Engine/Interface/Controls/GlyphSymbol.h"
#include "Engine/Interface/InspectorControls.h"

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    TOGGLE TILE
//------------------------------------------------------------------------------------------------------------------------

bool ToggleTile::ConstructGrid(ControlColumn& Column, const char* Id, ToggleTileItem* Items, int Count, int Columns, bool Enabled,
                               const char* Tooltip)
{
    const ControlTheme&    Theme    = Column.QueryTheme();
    const EditorTypefaces& Faces    = Column.QueryFaces();
    ImDrawList* const      DrawList = Column.QueryDrawList();
    const float            S        = Column.QueryScale();
    const float            Width    = Column.QueryWidth();
    if (Count <= 0 || Items == nullptr) return false;
    if (Columns <= 0) Columns = 3;
    const float Fade = Enabled ? 1.0f : 0.42f;

    // 📝 Tile: padding 11/6/9, 28 px chip, gaps 5, label ~15 px, state ~11 px.
    constexpr float TileTall = 86.0f;
    constexpr float Gap      = 7.0f;
    const int       Rows     = (Count + Columns - 1) / Columns;
    const ImVec2    Top      = Column.Space(Rows * TileTall + (Rows - 1) * Gap, 0.0f, 10.0f);
    const float     Wide     = (Width - Gap * S * static_cast<float>(Columns - 1)) / static_cast<float>(Columns);
    bool            Flipped  = false;

    ImGui::PushID(Id);
    if (!Enabled) ImGui::BeginDisabled();
    for (int Index = 0; Index < Count; ++Index)
    {
        ToggleTileItem& Item = Items[Index];
        if (Item.Value == nullptr) continue;
        const int    CellX = Index % Columns;
        const int    CellY = Index / Columns;
        const ImVec2 Min(Top.x + CellX * (Wide + Gap * S), Top.y + CellY * (TileTall * S + Gap * S));
        const ImVec2 Max(Min.x + Wide, Min.y + TileTall * S);

        const float ItemFade = Fade * (Item.Enabled ? 1.0f : 0.42f);
        ImGui::SetCursorScreenPos(Min);
        ImGui::PushID(Index);
        if (ImGui::InvisibleButton("##Tile", ImVec2(Wide, TileTall * S), ImGuiButtonFlags_EnableNav) && Enabled && Item.Enabled)
        {
            *Item.Value = !*Item.Value;
            Flipped     = true;
        }
        if (ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled))
            ControlColumn::ConstructTooltip(!Item.Enabled && Item.Reason != nullptr ? Item.Reason : Tooltip);
        ImGui::PopID();

        const bool  On   = *Item.Value;
        const ImU32 Edge = On ? ResolveCssColour(0x3EC46D40) : ResolveCssColour(0xFFFFFF0F);
        DrawList->AddRectFilled(Min, Max, FadeColour(ResolveCssColour(0x1A1A1AFF), ItemFade), 16.0f * S);
        DrawList->AddRect(Min, Max, FadeColour(Edge, ItemFade), 16.0f * S, ImDrawFlags_None, S);

        const ImVec2 ChipMin(Min.x + 0.5f * (Wide - 28.0f * S), Min.y + 11.0f * S);
        DrawList->AddRectFilled(ChipMin, ImVec2(ChipMin.x + 28.0f * S, ChipMin.y + 28.0f * S),
                                FadeColour(ResolveCssColour(On ? 0x285F3CFF : 0x272222FF), ItemFade), 10.0f * S);
        if (Item.Glyph != nullptr)
        {
            (void)GlyphSymbol::Construct(DrawList, Item.Glyph, ImVec2(ChipMin.x + 7.5f * S, ChipMin.y + 7.5f * S), 13.0f * S, 1.8f * S,
                                         FadeColour(ResolveCssColour(On ? 0xD7F5E2FF : 0x9C8686FF), ItemFade));
        }
        if (Item.Label != nullptr)
        {
            const float LabelWide = GlyphRun::Measure(Column, Faces.Regular, 10.5f * S, Item.Label);
            const float LabelTop  = ChipMin.y + 28.0f * S + 5.0f * S;
            (void)GlyphRun::Construct(Column, Faces.Regular, 10.5f * S,
                                      ImVec2(Min.x + 0.5f * (Wide - LabelWide), GlyphRun::ResolveBaseline(LabelTop, 10.5f * S, 1.4f)),
                                      FadeColour(ResolveCssColour(0xCFCFCFFF), ItemFade), Item.Label);
        }
        const char* StateText = On ? "ON" : "OFF";
        const float StateWide = GlyphRun::Measure(Column, Faces.Regular, 8.5f * S, StateText);
        const float StateTop  = ChipMin.y + 28.0f * S + 5.0f * S + 10.5f * 1.4f * S + 5.0f * S;
        (void)GlyphRun::Construct(Column, Faces.Regular, 8.5f * S,
                                  ImVec2(Min.x + 0.5f * (Wide - StateWide), GlyphRun::ResolveBaseline(StateTop, 8.5f * S, 1.4f)),
                                  FadeColour(ResolveCssColour(On ? 0x83D6A1FF : 0x7A6F6FFF), ItemFade), StateText);
    }
    if (!Enabled) ImGui::EndDisabled();
    ImGui::PopID();
    return Flipped;
}

} // namespace Frontier
