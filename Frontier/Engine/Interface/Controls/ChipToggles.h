/*==========================================================================================================================================
                                                            CHIPTOGGLES.H
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js ChipToggles: a label over wrapping multi-select chips (.chip-toggle) plus a detail line.

#pragma once

namespace Frontier
{

class ControlColumn;

class ChipToggles
{
  public:
    [[nodiscard]] static bool Construct(ControlColumn& Column, const char* Id, const char* Label, const char* const* Options, bool* Values,
                                        int Count, const char* Detail, bool Enabled = true, const char* Tooltip = nullptr);
};

} // namespace Frontier
