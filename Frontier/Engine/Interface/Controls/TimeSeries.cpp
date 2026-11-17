/*==========================================================================================================================================
                                                            TIMESERIES.CPP
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js TimeSeries: the hero sparkline (dashed white target, flow stroke + wash, −10 s /
//    −5 s / now captions).

#include "Engine/Interface/Controls/TimeSeries.h"

#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/GlyphRun.h"
#include "Engine/Interface/InspectorControls.h"

#include <algorithm>
#include <cmath>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    TIME SERIES
//------------------------------------------------------------------------------------------------------------------------

TimeSeriesOptions TimeSeriesOptions::Particle()
{
    TimeSeriesOptions Options;
    Options.Stroke      = 0xE8C27AFF;
    Options.Wash        = 0xE8C27A1F;
    Options.Captions[0] = "−60 s";
    Options.Captions[1] = "−30 s";
    return Options;
}

void TimeSeries::Construct(ControlColumn& Column, const double* Samples, int Count, int Capacity, double Target, float Height, bool Enabled,
                               double Headroom)
{
    TimeSeriesOptions Options;
    Options.Headroom = Headroom;
    Construct(Column, Samples, Count, Capacity, Target, Height, Options, Enabled);
}

void TimeSeries::Construct(ControlColumn& Column, const double* Samples, int Count, int Capacity, double Target, float Height,
                           const TimeSeriesOptions& Options, bool Enabled)
{
    const EditorTypefaces& Faces = Column.QueryFaces();
    const float            S     = Column.QueryScale();
    const float            Width = Column.QueryWidth();
    const ImVec2           Top   = Column.Space(Height, 0.0f, 0.0f);
    ConstructAt(Column.QueryDrawList(), Faces, S, Top, Width, Height, Samples, Count, Capacity, Target, Options, Enabled);
}

void TimeSeries::ConstructAt(ImDrawList* DrawList, const EditorTypefaces& Faces, float Scale, ImVec2 Min, float Width, float Height,
                             const double* Samples, int Count, int Capacity, double Target, bool Enabled, double Headroom)
{
    TimeSeriesOptions Options;
    Options.Headroom = Headroom;
    ConstructAt(DrawList, Faces, Scale, Min, Width, Height, Samples, Count, Capacity, Target, Options, Enabled);
}

void TimeSeries::ConstructAt(ImDrawList* DrawList, const EditorTypefaces& Faces, float Scale, ImVec2 Min, float Width, float Height,
                             const double* Samples, int Count, int Capacity, double Target, const TimeSeriesOptions& Options, bool Enabled)
{
    if (DrawList == nullptr || Width <= 0.0f || Height <= 0.0f) return;
    const float S    = Scale;
    const float Fade = Enabled ? 1.0f : 0.42f;

    double Peak = std::max(Target * Options.Headroom, 1.0);
    for (int Index = 0; Index < Count; ++Index) Peak = std::max(Peak, Samples[Index]);
    constexpr float PadL = 6.0f;
    constexpr float PadR = 6.0f;
    constexpr float PadT = 10.0f;
    constexpr float PadB = 18.0f;
    const float     PlotW = Width - (PadL + PadR) * S;
    const float     PlotH = Height * S - (PadT + PadB) * S;
    if (PlotW <= 1.0f || PlotH <= 1.0f) return;

    // 📝 Dashed target guide across the plot.
    const float GuideY = Min.y + PadT * S + PlotH * (1.0f - static_cast<float>(Target / Peak));
    for (float X = Min.x + PadL * S; X < Min.x + PadL * S + PlotW; X += 8.0f * S)
    {
        DrawList->AddLine(ImVec2(X, GuideY), ImVec2(std::min(X + 4.0f * S, Min.x + PadL * S + PlotW), GuideY),
                          FadeColour(ResolveCssColour(Options.Guide), Fade), S);
    }

    if (Samples != nullptr && Count > 1 && Capacity > 1)
    {
        // 📝 Wash under the stroke (translucent columns to the plot floor), then the stroke itself.
        const float StepX  = PlotW / static_cast<float>(Capacity - 1);
        const float FloorY = Min.y + PadT * S + PlotH;
        for (int Index = 0; Index < Count; ++Index)
        {
            const float X = Min.x + PadL * S + Index * StepX;
            const float Y = Min.y + PadT * S + PlotH * (1.0f - static_cast<float>(std::clamp(Samples[Index] / Peak, 0.0, 1.0)));
            DrawList->AddLine(ImVec2(X, Y), ImVec2(X, FloorY), FadeColour(ResolveCssColour(Options.Wash), Fade), StepX + S);
        }
        ImVec2 Previous(Min.x + PadL * S, Min.y + PadT * S + PlotH * (1.0f - static_cast<float>(std::clamp(Samples[0] / Peak, 0.0, 1.0))));
        for (int Index = 1; Index < Count; ++Index)
        {
            const ImVec2 Point(Min.x + PadL * S + Index * StepX,
                               Min.y + PadT * S + PlotH * (1.0f - static_cast<float>(std::clamp(Samples[Index] / Peak, 0.0, 1.0))));
            DrawList->AddLine(Previous, Point, FadeColour(ResolveCssColour(Options.Stroke), Fade), 1.8f * S);
            Previous = Point;
        }
    }

    const float BaseY  = GlyphRun::ResolveBaseline(Min.y + Height * S - 3.0f * S - 10.0f * 1.4f * S, 10.0f * S, 1.4f);
    const float MidW   = GlyphRun::Rasterize(nullptr, &Faces, Faces.Regular, 10.0f * S, ImVec2(0.0f, 0.0f), 0, Options.Captions[1], 0.0f, true);
    const float RightW = GlyphRun::Rasterize(nullptr, &Faces, Faces.Regular, 10.0f * S, ImVec2(0.0f, 0.0f), 0, Options.Captions[2], 0.0f, true);
    (void)GlyphRun::Rasterize(DrawList, &Faces, Faces.Regular, 10.0f * S, ImVec2(Min.x + PadL * S, BaseY),
                              FadeColour(ResolveCssColour(0x717886FF), Fade), Options.Captions[0], 0.0f, false);
    (void)GlyphRun::Rasterize(DrawList, &Faces, Faces.Regular, 10.0f * S, ImVec2(Min.x + 0.5f * Width - 0.5f * MidW, BaseY),
                              FadeColour(ResolveCssColour(0x717886FF), Fade), Options.Captions[1], 0.0f, false);
    (void)GlyphRun::Rasterize(DrawList, &Faces, Faces.Regular, 10.0f * S, ImVec2(Min.x + Width - PadR * S - RightW, BaseY),
                              FadeColour(ResolveCssColour(0x717886FF), Fade), Options.Captions[2], 0.0f, false);
}

} // namespace Frontier
