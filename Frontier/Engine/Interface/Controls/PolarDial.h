/*==========================================================================================================================================
                                                              POLARDIAL.H
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js PolarDial: the 160 px bearing compass (rings, cardinal ticks, needle, dot) with a
//    "deg° COMPASS" meta line. Dragging the dial writes the bearing in whole degrees.

#pragma once

namespace Frontier
{

class ControlColumn;

class PolarDial
{
  public:
    [[nodiscard]] static const char* ResolveCompassPoint(double Degrees) noexcept;
    [[nodiscard]] static bool        Construct(ControlColumn& Column, const char* Id, double& InOutDegrees, const char* Caption = nullptr,
                                               bool Enabled = true, const char* Tooltip = nullptr);
    // 📝 Titled panel variant: 12 px title, the dial, and a single-line muted note. Returns true when dragged.
    [[nodiscard]] static bool        ConstructPanel(ControlColumn& Column, const char* Id, const char* Title, const char* Note,
                                                   double& InOutDegrees, const char* Caption = nullptr, bool Enabled = true,
                                                   const char* Tooltip = nullptr);
};

} // namespace Frontier
