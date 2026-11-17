/*==========================================================================================================================================
                                                             TIMESERIES.H
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js TimeSeries: the hero sparkline (dashed target, filled series, −10 s / −5 s / now).

#pragma once

#include <imgui.h>

namespace Frontier
{

class ControlColumn;
struct EditorTypefaces;

// 📝 Voice options: CSS-hex stroke/wash/guide colours plus the three time captions. The default matches the
//    charcoal flow voice; Particle() selects the warm particle voice over a 60 s window.
struct TimeSeriesOptions
{
    double      Headroom = 1.2;
    ImU32       Stroke   = 0x8FD3C4FF;
    ImU32       Wash     = 0x8FD3C41F;
    ImU32       Guide    = 0xFFFFFF38;
    const char* Captions[3] = { "−10 s", "−5 s", "now" };

    [[nodiscard]] static TimeSeriesOptions Particle();
};

class TimeSeries
{
  public:
    static void Construct(ControlColumn& Column, const double* Samples, int Count, int Capacity, double Target, float Height,
                          bool Enabled = true, double Headroom = 1.2);
    static void Construct(ControlColumn& Column, const double* Samples, int Count, int Capacity, double Target, float Height,
                          const TimeSeriesOptions& Options, bool Enabled = true);
    static void ConstructAt(ImDrawList* DrawList, const EditorTypefaces& Faces, float Scale, ImVec2 Min, float Width, float Height,
                            const double* Samples, int Count, int Capacity, double Target, bool Enabled = true, double Headroom = 1.2);
    static void ConstructAt(ImDrawList* DrawList, const EditorTypefaces& Faces, float Scale, ImVec2 Min, float Width, float Height,
                            const double* Samples, int Count, int Capacity, double Target, const TimeSeriesOptions& Options,
                            bool Enabled = true);
};

} // namespace Frontier
