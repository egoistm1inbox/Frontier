/*==========================================================================================================================================
                                                             METRICTRIO.H
==========================================================================================================================================*/
// 🧩 Remastered metric trio: three gradient mini tiles in a row (20 px light figure, 10 px label), the particle
//    Overview header voice. Tones tint the figure: neutral ink, live green, or warm amber.

#pragma once

namespace Frontier
{

class ControlColumn;

struct MetricTrioItem
{
    const char* Label;
    const char* Value;
    int         Tone = 0; // 0 neutral, 1 live, 2 warm.
};

class MetricTrio
{
  public:
    static void Construct(ControlColumn& Column, const MetricTrioItem* Items, bool Enabled = true);
};

} // namespace Frontier
