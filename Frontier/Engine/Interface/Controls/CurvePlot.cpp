/*======================================================================================================================
                                                               CURVEPLOT.CPP
======================================================================================================================*/
// 🧩 Shared curve editor: interpolation selection, bounded knot dragging, and a live evaluation preview.

#include "Frontier/Engine/Interface/Controls/CurvePlot.h"

#include "Frontier/Engine/Interface/Controls/CaptionText.h"
#include "Frontier/Engine/Interface/Controls/ControlColumn.h"
#include "Frontier/Engine/Interface/Controls/DiagramCanvas.h"
#include "Frontier/Engine/Interface/Controls/SelectRow.h"

#include <imgui_internal.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <string>
#include <utility>
#include <vector>

namespace Frontier
{

namespace
{

constexpr float PlotWidth  = 640.0f;
constexpr float PlotHeight = 260.0f;
constexpr float PlotLeft   = 50.0f;
constexpr float PlotRight  = 624.0f;
constexpr float PlotTop    = 16.0f;
constexpr float PlotBottom = 222.0f;
constexpr int   CurveSteps = 192;
constexpr int   GridSteps  = 4;

struct CurveRange
{
    double MinimumInput  = 0.0;
    double MaximumInput  = 1.0;
    double MinimumOutput = 0.0;
    double MaximumOutput = 1.0;
};

CurveRange ResolveRange(const CurveSpecification& Specification) noexcept
{
    CurveRange Range;
    if (Specification.Knots.size() < 2) return Range;
    Range.MinimumInput = Specification.Knots.front().Input;
    Range.MaximumInput = Specification.Knots.back().Input;
    Range.MinimumOutput = Specification.Knots.front().Output;
    Range.MaximumOutput = Specification.Knots.front().Output;
    for (const CurveKnot& Knot : Specification.Knots)
    {
        Range.MinimumOutput = std::min(Range.MinimumOutput, Knot.Output);
        Range.MaximumOutput = std::max(Range.MaximumOutput, Knot.Output);
    }
    double Extent = Range.MaximumOutput - Range.MinimumOutput;
    if (!(Extent > 0.0) || !std::isfinite(Extent)) Extent = std::max(1.0, std::abs(Range.MinimumOutput) * 0.2);
    const double Padding = Extent * 0.12;
    Range.MinimumOutput -= Padding;
    Range.MaximumOutput += Padding;
    return Range;
}

ImVec2 ResolvePlotPoint(double Input, double Output, const CurveRange& Range) noexcept
{
    const double U = (Input - Range.MinimumInput) / (Range.MaximumInput - Range.MinimumInput);
    const double V = (Output - Range.MinimumOutput) / (Range.MaximumOutput - Range.MinimumOutput);
    return ImVec2(PlotLeft + static_cast<float>(U) * (PlotRight - PlotLeft),
                  PlotBottom - static_cast<float>(V) * (PlotBottom - PlotTop));
}

double ResolveInput(float X, const CurveRange& Range) noexcept
{
    const double U = std::clamp((static_cast<double>(X) - PlotLeft) / (PlotRight - PlotLeft), 0.0, 1.0);
    return Range.MinimumInput + U * (Range.MaximumInput - Range.MinimumInput);
}

double ResolveOutput(float Y, const CurveRange& Range) noexcept
{
    const double V = std::clamp((PlotBottom - static_cast<double>(Y)) / (PlotBottom - PlotTop), 0.0, 1.0);
    return Range.MinimumOutput + V * (Range.MaximumOutput - Range.MinimumOutput);
}

void ConstructPlot(DiagramPen& Pen, const CurveSpecification& Specification, const CurveProfile<double>* Profile,
                   const CurveRange& Range, int ActiveKnot)
{
    const ImU32 Grid = ResolveCssColour(0x46515eff);
    const ImU32 Axis = ResolveCssColour(0x788492ff);
    const ImU32 Line = ResolveCssColour(0x65c8ffff);
    const ImU32 KnotColour = ResolveCssColour(0xe8edf4ff);
    const ImU32 ActiveColour = ResolveCssColour(0xffc86aff);

    Pen.Rect(ImVec2(PlotLeft, PlotTop), ImVec2(PlotRight - PlotLeft, PlotBottom - PlotTop),
             ResolveCssColour(0x151a20ff), 6.0f);
    for (int Step = 0; Step <= GridSteps; ++Step)
    {
        const float Fraction = static_cast<float>(Step) / static_cast<float>(GridSteps);
        const float X = PlotLeft + Fraction * (PlotRight - PlotLeft);
        const float Y = PlotTop + Fraction * (PlotBottom - PlotTop);
        Pen.Line(ImVec2(X, PlotTop), ImVec2(X, PlotBottom), Grid, Step == 0 || Step == GridSteps ? 1.2f : 0.7f);
        Pen.Line(ImVec2(PlotLeft, Y), ImVec2(PlotRight, Y), Grid, Step == 0 || Step == GridSteps ? 1.2f : 0.7f);
    }
    Pen.Line(ImVec2(PlotLeft, PlotBottom), ImVec2(PlotRight, PlotBottom), Axis, 1.2f);
    Pen.Line(ImVec2(PlotLeft, PlotTop), ImVec2(PlotLeft, PlotBottom), Axis, 1.2f);

    char Label[40];
    for (int Step = 0; Step <= GridSteps; ++Step)
    {
        const double Fraction = static_cast<double>(Step) / static_cast<double>(GridSteps);
        const double Input = Range.MinimumInput + Fraction * (Range.MaximumInput - Range.MinimumInput);
        const double Output = Range.MaximumOutput - Fraction * (Range.MaximumOutput - Range.MinimumOutput);
        std::snprintf(Label, sizeof(Label), "%.3g", Input);
        Pen.Text(ImVec2(PlotLeft + static_cast<float>(Fraction) * (PlotRight - PlotLeft), PlotBottom + 18.0f), Label,
                 ResolveCssColour(0x9ba6b3ff), 9.0f);
        std::snprintf(Label, sizeof(Label), "%.3g", Output);
        const float LabelY = PlotTop + static_cast<float>(Step) / GridSteps * (PlotBottom - PlotTop) + 3.0f;
        Pen.Text(ImVec2(PlotLeft - 10.0f, LabelY), Label, ResolveCssColour(0x9ba6b3ff), 9.0f, 1);
    }

    if (Profile != nullptr && Profile->IsValid())
    {
        std::vector<ImVec2> Points;
        Points.reserve(CurveSteps + 1);
        for (int Step = 0; Step <= CurveSteps; ++Step)
        {
            const double Fraction = static_cast<double>(Step) / CurveSteps;
            const double Input = Range.MinimumInput + Fraction * (Range.MaximumInput - Range.MinimumInput);
            Points.push_back(ResolvePlotPoint(Input, Profile->Evaluate(Input), Range));
        }
        Pen.Path(Points, Line, 2.2f);
    }

    for (size_t Index = 0; Index < Specification.Knots.size(); ++Index)
    {
        const CurveKnot& Knot = Specification.Knots[Index];
        const ImVec2 Point = ResolvePlotPoint(Knot.Input, Knot.Output, Range);
        const bool IsActive = static_cast<int>(Index) == ActiveKnot;
        Pen.Circle(Point, IsActive ? 7.0f : 5.5f, IsActive ? ActiveColour : KnotColour,
                   ResolveCssColour(IsActive ? 0x222831ff : 0x26303aff));
    }
    Pen.Text(ImVec2((PlotLeft + PlotRight) * 0.5f, PlotHeight - 2.0f), "Input", ResolveCssColour(0xb4becaff), 9.0f);
    Pen.Text(ImVec2(PlotRight, PlotTop - 4.0f), "Output", ResolveCssColour(0xb4becaff), 9.0f, 1);
}

} // namespace

bool CurvePlot::Construct(ControlColumn& Column, const char* Id, CurveSpecification& Specification, bool Enabled)
{
    if (Id == nullptr || Specification.Knots.size() < 2) return false;
    ImGui::PushID(Id);
    bool Changed = false;
    std::string Diagnostic;
    CurveProfile<double> Profile;
    const bool Valid = Profile.Assign(Specification, &Diagnostic);

    static constexpr const char* InterpolationNames[] = { "Linear", "Clamped Hermite", "Monotonic PCHIP" };
    int Interpolation = static_cast<int>(Specification.Interpolation);
    if (SelectRow::Construct(Column, "Interpolation", "Interpolation", InterpolationNames, 3, Interpolation, Enabled,
                             "Interpolation is applied to the curve evaluation preview.") &&
        Interpolation >= 0 && Interpolation <= 2)
    {
        CurveSpecification Candidate = Specification;
        Candidate.Interpolation = static_cast<CurveInterpolation>(Interpolation);
        CurveProfile<double> CandidateProfile;
        Diagnostic.clear();
        if (CandidateProfile.Assign(Candidate, &Diagnostic))
        {
            Specification = std::move(Candidate);
            Profile = std::move(CandidateProfile);
            Changed = true;
        }
    }

    if (!Profile.IsValid())
    {
        CaptionText::Construct(Column, Diagnostic.c_str(), 4.0f, 8.0f);
        ImGui::PopID();
        return Changed;
    }

    DiagramDrag Drag;
    DiagramPen Pen = DiagramCanvas::Begin(Column, "CurveCanvas", PlotWidth, PlotHeight, 8.0f, 8.0f,
                                         Enabled ? &Drag : nullptr,
                                         "Drag a knot to edit it. End knots keep their input coordinate.");
    ImGuiStorage* Storage = ImGui::GetStateStorage();
    const ImGuiID ActiveId = ImGui::GetID("CurvePlotActiveKnot");
    int ActiveKnot = Storage->GetInt(ActiveId, -1);
    const CurveRange Range = ResolveRange(Specification);

    if (Drag.Start)
    {
        ActiveKnot = -1;
        float Nearest = 14.0f;
        for (size_t Index = 0; Index < Specification.Knots.size(); ++Index)
        {
            const CurveKnot& Knot = Specification.Knots[Index];
            const ImVec2 Point = ResolvePlotPoint(Knot.Input, Knot.Output, Range);
            const float DX = Point.x - Drag.Point.x;
            const float DY = Point.y - Drag.Point.y;
            const float Distance = std::sqrt(DX * DX + DY * DY);
            if (Distance < Nearest)
            {
                Nearest = Distance;
                ActiveKnot = static_cast<int>(Index);
            }
        }
        Storage->SetInt(ActiveId, ActiveKnot);
    }

    if (Drag.Engaged && ActiveKnot >= 0 && static_cast<size_t>(ActiveKnot) < Specification.Knots.size())
    {
        CurveSpecification Candidate = Specification;
        CurveKnot& Knot = Candidate.Knots[static_cast<size_t>(ActiveKnot)];
        const CurveKnot Original = Knot;
        if (ActiveKnot > 0 && static_cast<size_t>(ActiveKnot + 1) < Candidate.Knots.size())
        {
            const double Span = Range.MaximumInput - Range.MinimumInput;
            const double LeftGap = Knot.Input - Candidate.Knots[static_cast<size_t>(ActiveKnot - 1)].Input;
            const double RightGap = Candidate.Knots[static_cast<size_t>(ActiveKnot + 1)].Input - Knot.Input;
            const double Margin = std::min(Span * 1.0e-6, std::min(LeftGap, RightGap) * 0.25);
            Knot.Input = std::clamp(ResolveInput(Drag.Point.x, Range),
                                    Candidate.Knots[static_cast<size_t>(ActiveKnot - 1)].Input + Margin,
                                    Candidate.Knots[static_cast<size_t>(ActiveKnot + 1)].Input - Margin);
        }
        Knot.Output = ResolveOutput(Drag.Point.y, Range);
        if (Knot.Input != Original.Input || Knot.Output != Original.Output)
        {
            CurveProfile<double> CandidateProfile;
            Diagnostic.clear();
            if (CandidateProfile.Assign(Candidate, &Diagnostic))
            {
                Specification = std::move(Candidate);
                Profile = std::move(CandidateProfile);
                Changed = true;
            }
        }
    }
    else if (!Drag.Engaged)
    {
        Storage->SetInt(ActiveId, -1);
        ActiveKnot = -1;
    }

    const CurveRange DrawRange = ResolveRange(Specification);
    ConstructPlot(Pen, Specification, Valid || Changed ? &Profile : nullptr, DrawRange, ActiveKnot);
    if (!Diagnostic.empty()) CaptionText::Construct(Column, Diagnostic.c_str(), 4.0f, 8.0f);
    ImGui::PopID();
    return Changed;
}

} // namespace Frontier
