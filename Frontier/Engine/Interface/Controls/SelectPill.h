/*==========================================================================================================================================
                                                             SELECTPILL.H
==========================================================================================================================================*/
// 🧩 Remastered select pill: the 38 px particle dropdown (label + value + chevron, popup option list) and the 38 px tab
//    strip the particle Inspector tabs ride on. Both return true when the selection changed. OutRects, when given,
//    receives one screen rect per option every frame the list draws (tabs) or while the popup stands open (dropdown).

#pragma once

#include <imgui.h>

namespace Frontier
{

class ControlColumn;

class SelectPill
{
  public:
    [[nodiscard]] static bool Construct(ControlColumn& Column, const char* Id, const char* Label, const char* const* Options, int Count,
                                        int& InOutIndex, bool Enabled = true, const char* Tooltip = nullptr, ImVec4* OutRects = nullptr);
    [[nodiscard]] static bool ConstructTabs(ControlColumn& Column, const char* Id, const char* const* Options, int Count,
                                            int& InOutIndex, bool Enabled = true, const char* Tooltip = nullptr,
                                            ImVec4* OutRects = nullptr);
};

} // namespace Frontier
