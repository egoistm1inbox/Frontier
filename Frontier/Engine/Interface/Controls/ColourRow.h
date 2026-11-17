/*==========================================================================================================================================
                                                             COLOURROW.H
==========================================================================================================================================*/
// 🧩 Remastered colour row: the particle A/B/C ramp swatches over a checkerboard (alpha reads honestly) with mono hex
//    captions. Clicking a swatch toggles its alpha between 1 and 0 — the only colour edit this shell stages locally —
//    and Construct returns the clicked swatch index, or -1 when nothing fired this frame.

#pragma once

namespace Frontier
{

class ControlColumn;

struct ColourRowSwatch
{
    const char* Label;
    double      Colour[4]; // linear RGBA 0..1, like the prototype's colA/colB/colC.
};

class ColourRow
{
  public:
    [[nodiscard]] static int Construct(ControlColumn& Column, const char* Id, const char* Label, ColourRowSwatch* Swatches, int Count,
                                       bool Enabled = true, const char* Tooltip = nullptr);
};

} // namespace Frontier
