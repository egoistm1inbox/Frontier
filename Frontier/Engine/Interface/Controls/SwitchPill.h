/*==========================================================================================================================================
                                                             SWITCHPILL.H
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js SwitchRow: a label plus detail beside the 44x25 high-contrast pill toggle (.switch).

#pragma once

namespace Frontier
{

class ControlColumn;

enum class SwitchTone
{
    Mono,   // 🧩 Particle/Fracture .switch: 44x25, white on / #232323 off.
    Verdant // 🧩 ForceField .switch-pill: 40x22, live-green on / #171717 off.
};

class SwitchPill
{
  public:
    [[nodiscard]] static bool Construct(ControlColumn& Column, const char* Id, const char* Label, const char* Detail, bool& InOut,
                                        bool Enabled = true, const char* Tooltip = nullptr);
    [[nodiscard]] static bool Construct(ControlColumn& Column, const char* Id, const char* Label, const char* Detail, bool& InOut,
                                        SwitchTone Tone, bool Enabled = true, const char* Tooltip = nullptr);
};

} // namespace Frontier
