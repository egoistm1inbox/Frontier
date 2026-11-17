/*==========================================================================================================================================
                                                               TEXTROW.H
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js TextRow: a label over a single-line pill field (.studio-input).

#pragma once

#include <string>

namespace Frontier
{

class ControlColumn;

class TextRow
{
  public:
    [[nodiscard]] static bool Construct(ControlColumn& Column, const char* Id, const char* Label, std::string& InOutText,
                                        bool Enabled = true, const char* Tooltip = nullptr);
};

} // namespace Frontier
