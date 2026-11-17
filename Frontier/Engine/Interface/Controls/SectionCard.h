/*==========================================================================================================================================
                                                             SECTIONCARD.H
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js SectionCard: the Sun + Fluid <details class="property-group"> card (22 px radius,
//    gradient fill, warm glyph, 17 px title, right-aligned section badge, wrapped hint). Content between Begin and End
//    draws only while open; the card never nests inside another card.

#pragma once

namespace Frontier
{

class ControlColumn;

class SectionCard
{
  public:
    // 📝 Draws the header; toggles InOutOpen on click. Returns true when the toggle flipped. Call End in both cases.
    [[nodiscard]] static bool Begin(ControlColumn& Column, const char* Id, const char* Title, const char* Glyph, const char* Badge,
                                    const char* Hint, bool& InOutOpen, bool Enabled = true, const char* Tooltip = nullptr);
    static void End(ControlColumn& Column);
};

} // namespace Frontier
