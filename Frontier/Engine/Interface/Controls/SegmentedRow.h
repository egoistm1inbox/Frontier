/*==========================================================================================================================================
                                                            SEGMENTEDROW.H
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js SegmentedRow: a label over a joined pill track (.segmented-track), one option active.

#pragma once

namespace Frontier
{

class ControlColumn;

class SegmentedRow
{
  public:
    [[nodiscard]] static bool Construct(ControlColumn& Column, const char* Id, const char* Label, const char* const* Options, int Count,
                                        int& InOutIndex, bool Enabled = true, const char* Tooltip = nullptr);
    // 📝 Compact selects the ForceField .seg-bar density: 30 px track, 12/9 px radii, 10.5 px options.
    [[nodiscard]] static bool Construct(ControlColumn& Column, const char* Id, const char* Label, const char* const* Options, int Count,
                                        int& InOutIndex, bool Compact, bool Enabled, const char* Tooltip = nullptr);
};

} // namespace Frontier
