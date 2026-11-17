/*==========================================================================================================================================
                                                              PILLTABS.H
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js PillTabs: the 36 px joined pill bar (.pill-tabs); the active tab fills #282828.

#pragma once

namespace Frontier
{

class ControlColumn;

class PillTabs
{
  public:
    [[nodiscard]] static bool Construct(ControlColumn& Column, const char* Id, const char* const* Options, int Count, int& InOutIndex,
                                        bool Enabled = true, const char* Tooltip = nullptr);
};

} // namespace Frontier
