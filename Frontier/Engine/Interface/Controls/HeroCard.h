/*==========================================================================================================================================
                                                              HEROCARD.H
==========================================================================================================================================*/
// 🧩 Remastered hero-card: the gradient metric card (status chip, tag, 38 px metric, side note) with caller-drawn body
//    content (TimeSeries / profile plot) and an optional wrapped note. Begin reserves the chrome; End closes the card.

#pragma once

#include <imgui.h>

namespace Frontier
{

class ControlColumn;

struct HeroCardInner
{
    float X      = 0.0f;
    float Width  = 0.0f;
    float Y      = 0.0f;
    float Chrome = 0.0f; // 📝 CSS px of chrome above the body (Begin vs BeginTitled); 0 selects the default.
};

class HeroCard
{
  public:
    enum
    {
        MarkNone   = -1,
        MarkLive   = 0,
        MarkWarm   = 1,
        MarkDanger = 2
    };

    [[nodiscard]] static HeroCardInner Begin(ControlColumn& Column, const char* Id, const char* ChipText, const char* ChipGlyph, int MarkTone,
                                             const char* TagText, const char* MetricText, const char* MetricUnit, const char* SideText,
                                             bool Enabled = true);
    // 📝 Titled variant: BeginTop draws a small eyebrow + title block before the metric row.
    [[nodiscard]] static HeroCardInner BeginTitled(ControlColumn& Column, const char* Id, const char* Eyebrow, const char* Title, const char* ChipText,
                                                  const char* ChipGlyph, int MarkTone, const char* MetricText, const char* MetricUnit,
                                                  const char* SideText, bool Enabled = true);
    static void End(ControlColumn& Column, const HeroCardInner& Inner, const char* Note = nullptr, bool Enabled = true);
    // 📝 Reports the card top (Begin reserves 10 px margin before the card).
    [[nodiscard]] static float Top(const HeroCardInner& Inner, float UIScale);
};

} // namespace Frontier
