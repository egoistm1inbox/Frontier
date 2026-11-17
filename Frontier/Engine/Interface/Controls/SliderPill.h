/*==========================================================================================================================================
                                                             SLIDERPILL.H
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js SliderRow (Fluid ControlPanel::SliderPill): a label over a 92 px black value pill
//    (scrubbable figure plus unit cell) beside a 26 px pill track with a spherical thumb.

#pragma once

namespace Frontier
{

class ControlColumn;

struct SliderPillOptions
{
    bool        Logarithmic = false;   // 🧩 ForceField distance bindings: 0..1000 slider mapped over Min*(Max/Min)^share.
    const char* LowerEnd    = nullptr; // 🧩 .slider-ends captions under the track's lower/upper ends (nullptr hides).
    const char* UpperEnd    = nullptr;
    bool        Distance    = false;   // 🧩 m/km figure formatting with "1.4 km" parsing.
    int         Digits      = -1;      // 🧩 Figure decimals (< 0 derives from the step, like the kit default).
    const char* EmptyUnit   = "--";    // 🧩 Unit-cell text when Unit is empty (ForceField shows nothing: pass "").
};

class SliderPill
{
  public:
    [[nodiscard]] static bool Construct(ControlColumn& Column, const char* Id, const char* Label, double& Quantity, double Minimum,
                                        double Maximum, double Step, const char* Unit, bool Enabled = true, const char* Tooltip = nullptr);
    [[nodiscard]] static bool Construct(ControlColumn& Column, const char* Id, const char* Label, double& Quantity, double Minimum,
                                        double Maximum, double Step, const char* Unit, const SliderPillOptions& Options, bool Enabled = true,
                                        const char* Tooltip = nullptr);
};

} // namespace Frontier
