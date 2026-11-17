/*==========================================================================================================================================
                                                            COLOURROW.CPP
==========================================================================================================================================*/
// 🧩 Remastered colour row: the particle A/B/C ramp swatches over a checkerboard with mono hex captions. Fills convert
//    the linear prototype colours to sRGB for display; clicking a swatch toggles its alpha 1 ↔ 0.

#include "Engine/Interface/Controls/ColourRow.h"

#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/GlyphRun.h"
#include "Engine/Interface/InspectorControls.h"

#include <cmath>
#include <cstdio>

namespace Frontier
{

namespace
{

[[nodiscard]] float LinearToSrgb(double Linear) noexcept
{
    const float Clamped = static_cast<float>(Linear < 0.0 ? 0.0 : (Linear > 1.0 ? 1.0 : Linear));
    return std::pow(Clamped, 1.0f / 2.2f);
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    COLOUR ROW
//------------------------------------------------------------------------------------------------------------------------

int ColourRow::Construct(ControlColumn& Column, const char* Id, const char* Label, ColourRowSwatch* Swatches, int Count, bool Enabled,
                         const char* Tooltip)
{
    const EditorTypefaces& Faces    = Column.QueryFaces();
    ImDrawList* const      DrawList = Column.QueryDrawList();
    const float            S        = Column.QueryScale();
    const float            Width    = Column.QueryWidth();
    if (Swatches == nullptr || Count <= 0) return -1;
    const float Fade = Enabled ? 1.0f : 0.42f;

    if (Label != nullptr && Label[0] != '\0')
    {
        const ImVec2 LabelTop = Column.Space(11.0f * 1.38f, 0.0f, 4.0f);
        (void)GlyphRun::Construct(Column, Faces.Medium, 11.0f * S,
                                  ImVec2(LabelTop.x, GlyphRun::ResolveBaseline(LabelTop.y, 11.0f * S, 1.38f)),
                                  FadeColour(ResolveCssColour(0xBCBCBCFF), Fade), Label);
    }

    constexpr float SwatchTall = 34.0f;
    constexpr float CaptionTall = 10.0f * 1.4f;
    constexpr float Gap         = 8.0f;
    const ImVec2    Top         = Column.Space(SwatchTall + 4.0f + CaptionTall, 0.0f, 10.0f);
    const float     Wide        = (Width - Gap * S * static_cast<float>(Count - 1)) / static_cast<float>(Count);
    int             Fired       = -1;

    ImGui::PushID(Id);
    if (!Enabled) ImGui::BeginDisabled();
    for (int Index = 0; Index < Count; ++Index)
    {
        ColourRowSwatch& Swatch = Swatches[Index];
        const ImVec2     Min(Top.x + Index * (Wide + Gap * S), Top.y);
        const ImVec2     Max(Min.x + Wide, Min.y + SwatchTall * S);
        ImGui::SetCursorScreenPos(Min);
        ImGui::PushID(Index);
        if (ImGui::InvisibleButton("##Swatch", ImVec2(Wide, SwatchTall * S), ImGuiButtonFlags_EnableNav) && Enabled)
        {
            Swatch.Colour[3] = Swatch.Colour[3] >= 0.5 ? 0.0 : 1.0;
            Fired            = Index;
        }
        if (ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled)) ControlColumn::ConstructTooltip(Tooltip);
        ImGui::PopID();

        // 📝 Checkerboard behind the fill so a zero alpha reads as transparent, not black.
        DrawList->AddRectFilled(Min, Max, FadeColour(ResolveCssColour(0x2A2A2AFF), Fade), 10.0f * S);
        DrawList->PushClipRect(Min, Max, true);
        const float Check = 8.0f * S;
        int         Row   = 0;
        for (float Y = Min.y; Y < Max.y; Y += Check, ++Row)
        {
            for (float X = Min.x + (Row % 2 != 0 ? Check : 0.0f); X < Max.x; X += 2.0f * Check)
                DrawList->AddRectFilled(ImVec2(X, Y), ImVec2(X + Check, Y + Check), FadeColour(ResolveCssColour(0x1E1E1EFF), Fade));
        }
        DrawList->PopClipRect();
        const ImU32 Fill = ImGui::ColorConvertFloat4ToU32(
            ImVec4(LinearToSrgb(Swatch.Colour[0]), LinearToSrgb(Swatch.Colour[1]), LinearToSrgb(Swatch.Colour[2]),
                   static_cast<float>(Swatch.Colour[3] < 0.0 ? 0.0 : (Swatch.Colour[3] > 1.0 ? 1.0 : Swatch.Colour[3]))));
        DrawList->AddRectFilled(Min, Max, FadeColour(Fill, Fade), 10.0f * S);
        DrawList->AddRect(Min, Max, FadeColour(ResolveCssColour(0xFFFFFF24), Fade), 10.0f * S, ImDrawFlags_None, S);

        char Hex[16]{};
        std::snprintf(Hex, sizeof(Hex), "#%02X%02X%02X%02X", static_cast<int>(LinearToSrgb(Swatch.Colour[0]) * 255.0f + 0.5f),
                      static_cast<int>(LinearToSrgb(Swatch.Colour[1]) * 255.0f + 0.5f),
                      static_cast<int>(LinearToSrgb(Swatch.Colour[2]) * 255.0f + 0.5f),
                      static_cast<int>((Swatch.Colour[3] < 0.0 ? 0.0 : (Swatch.Colour[3] > 1.0 ? 1.0 : Swatch.Colour[3])) * 255.0f + 0.5f));
        char Caption[48]{};
        if (Swatch.Label != nullptr && Swatch.Label[0] != '\0') std::snprintf(Caption, sizeof(Caption), "%s · %s", Swatch.Label, Hex);
        else std::snprintf(Caption, sizeof(Caption), "%s", Hex);
        const float CaptionWide = GlyphRun::Measure(Column, Faces.Monospace, 10.0f * S, Caption);
        (void)GlyphRun::Construct(Column, Faces.Monospace, 10.0f * S,
                                  ImVec2(Min.x + 0.5f * (Wide - CaptionWide),
                                         GlyphRun::ResolveBaseline(Min.y + SwatchTall * S + 4.0f * S, 10.0f * S, 1.4f)),
                                  FadeColour(ResolveCssColour(0x848484FF), Fade), Caption);
    }
    if (!Enabled) ImGui::EndDisabled();
    ImGui::PopID();
    return Fired;
}

} // namespace Frontier
