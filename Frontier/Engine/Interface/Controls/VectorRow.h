/*==========================================================================================================================================
                                                              VECTORROW.H
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js VectorRow: a label plus unit over three pill cells (.vector-cell) with coloured axis
//    tags (X red, Y green, Z blue) and editable figures.

#pragma once

namespace Frontier
{

class ControlColumn;

class VectorRow
{
  public:
    [[nodiscard]] static bool Construct(ControlColumn& Column, const char* Id, const char* Label, const char* Unit, double Values[3],
                                        int Digits = 2, bool Bounded = false, double Minimum = 0.0, double Maximum = 0.0,
                                        bool Enabled = true, const char* Tooltip = nullptr);
    // 📝 MonoAxes selects the ForceField .vec-cell density: 26 px cells, radius 10, monochrome axis tags.
    [[nodiscard]] static bool Construct(ControlColumn& Column, const char* Id, const char* Label, const char* Unit, double Values[3],
                                        int Digits, bool Bounded, double Minimum, double Maximum, bool MonoAxes, bool Enabled = true,
                                        const char* Tooltip = nullptr);
};

} // namespace Frontier
