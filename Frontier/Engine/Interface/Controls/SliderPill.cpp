/*==========================================================================================================================================
                                                             SLIDERPILL.CPP
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js SliderRow (Fluid ControlPanel::SliderPill): a 12 px label over a 28 px row holding a
//    92 px black value pill (58 px scrubbable figure, 34 px unit cell) beside a 26 px pill track with a 24 px spherical
//    thumb. The figure types, scrubs horizontally (Shift fine, Alt coarse), and the track drags. ForceField distance
//    bindings add a logarithmic track, m/km figures, and .slider-ends captions.

#include "Engine/Interface/Controls/SliderPill.h"

#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/GlyphRun.h"
#include "Engine/Interface/InspectorControls.h"

#include <imgui_internal.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <limits>

namespace Frontier
{

namespace
{

[[nodiscard]] int ResolvePillDigits(double Step) noexcept
{
    if (!(Step > 0.0)) return 2;
    if (Step >= 1.0) return 0;
    if (Step >= 0.1) return 1;
    if (Step >= 0.01) return 2;
    return 3;
}

[[nodiscard]] double SnapPill(double Raw, double Minimum, double Maximum, double Step, int Digits) noexcept
{
    const double Clamped = std::clamp(Raw, Minimum, Maximum);
    const double Stepped = Step > 0.0 ? std::round(Clamped / Step) * Step : Clamped;
    const double Precision = std::pow(10.0, Digits + 2);
    return std::round(std::clamp(Stepped, Minimum, Maximum) * Precision) / Precision;
}

// 📝 ForceField logarithmic distance tracks: the 0..1000 slider rides Min*(Max/Min)^share, written to 3 sig figs.
[[nodiscard]] double LogPillRange(double Minimum, double Maximum) noexcept
{
    return std::log(std::max(Maximum, 1e-9) / std::max(Minimum, 1e-9));
}

[[nodiscard]] double LogSliderOf(double Value, double Minimum, double Maximum) noexcept
{
    const double Span = LogPillRange(Minimum, Maximum);
    if (!(Span > 1e-9)) return 0.0;
    return std::round((std::log(std::clamp(Value, Minimum, Maximum) / std::max(Minimum, 1e-9)) / Span) * 1000.0);
}

[[nodiscard]] double LogValueOf(double Slider, double Minimum, double Maximum) noexcept
{
    const double Span = LogPillRange(Minimum, Maximum);
    if (!(Span > 1e-9)) return Minimum;
    return std::max(Minimum, 1e-9) * std::pow(std::max(Maximum, 1e-9) / std::max(Minimum, 1e-9), std::clamp(Slider, 0.0, 1000.0) / 1000.0);
}

[[nodiscard]] double Precision3(double Value) noexcept
{
    if (!(std::fabs(Value) > 0.0) || !std::isfinite(Value)) return 0.0;
    const double Magnitude = std::pow(10.0, 2.0 - std::floor(std::log10(std::fabs(Value))));
    return std::round(Value * Magnitude) / Magnitude;
}

[[nodiscard]] double SnapLogPill(double Raw, double Minimum, double Maximum) noexcept
{
    return std::clamp(Precision3(Raw), Minimum, Maximum);
}

// 📝 DistanceFormat: km at/above 1000 (1 decimal past 10 km, else 2), m below (1 decimal under 10, else 0).
void FormatDistanceFigure(double Quantity, char* Figure, size_t FigureSize, const char*& Unit) noexcept
{
    if (Quantity >= 1000.0)
    {
        std::snprintf(Figure, FigureSize, Quantity >= 10000.0 ? "%.1f" : "%.2f", Quantity / 1000.0);
        Unit = "km";
    }
    else
    {
        std::snprintf(Figure, FigureSize, Quantity < 10.0 ? "%.1f" : "%.0f", Quantity);
        Unit = "m";
    }
}

[[nodiscard]] double ParseDistanceFigure(const char* Text, const char* FallbackUnit) noexcept
{
    if (Text == nullptr) return std::numeric_limits<double>::quiet_NaN();
    char Scratch[64]{};
    std::snprintf(Scratch, sizeof(Scratch), "%s", Text);
    for (char& C : Scratch)
    {
        if (C == ',') C = '.';
    }
    char*        End     = nullptr;
    const double Number  = std::strtod(Scratch, &End);
    if (End == Scratch || !std::isfinite(Number)) return std::numeric_limits<double>::quiet_NaN();
    while (*End == ' ' || *End == '\t') ++End;
    char Suffix[3]{};
    std::snprintf(Suffix, sizeof(Suffix), "%s", End);
    for (char& C : Suffix) C = static_cast<char>(std::tolower(static_cast<unsigned char>(C)));
    const bool Kilometres = (Suffix[0] == 'k') || (Suffix[0] == '\0' && FallbackUnit != nullptr && FallbackUnit[0] == 'k');
    return Number * (Kilometres ? 1000.0 : 1.0);
}

struct DistanceEntryState
{
    char    Text[64]{};
    ImGuiID Seeded = 0;
};

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    SLIDER PILL
//------------------------------------------------------------------------------------------------------------------------

bool SliderPill::Construct(ControlColumn& Column, const char* Id, const char* Label, double& Quantity, double Minimum, double Maximum,
                           double Step, const char* Unit, bool Enabled, const char* Tooltip)
{
    return Construct(Column, Id, Label, Quantity, Minimum, Maximum, Step, Unit, SliderPillOptions{}, Enabled, Tooltip);
}

bool SliderPill::Construct(ControlColumn& Column, const char* Id, const char* Label, double& Quantity, double Minimum, double Maximum,
                           double Step, const char* Unit, const SliderPillOptions& Options, bool Enabled, const char* Tooltip)
{
    const ControlTheme&    Theme    = Column.QueryTheme();
    const EditorTypefaces& Faces    = Column.QueryFaces();
    ImDrawList* const      DrawList = Column.QueryDrawList();
    const float            S        = Column.QueryScale();
    const float            Width    = Column.QueryWidth();
    if (!(Maximum > Minimum)) return false;
    Quantity             = std::clamp(Quantity, Minimum, Maximum);
    const float Fade     = Enabled ? 1.0f : 0.42f;
    const int   Digits   = Options.Digits >= 0 ? Options.Digits : ResolvePillDigits(Step);
    const bool  Log      = Options.Logarithmic && Minimum > 0.0;
    const bool  HasEnds  = Options.LowerEnd != nullptr && Options.UpperEnd != nullptr;
    bool        Moved    = false;

    const auto Snap = [&](double Raw) { return Log ? SnapLogPill(Raw, Minimum, Maximum) : SnapPill(Raw, Minimum, Maximum, Step, Digits); };
    const auto FractionOf = [&]()
    {
        if (Log)
        {
            const double Span = LogPillRange(Minimum, Maximum);
            if (!(Span > 1e-9)) return 0.0f;
            return static_cast<float>(std::clamp(std::log(Quantity / std::max(Minimum, 1e-9)) / Span, 0.0, 1.0));
        }
        return static_cast<float>((Quantity - Minimum) / (Maximum - Minimum));
    };

    const ImVec2 Head = Column.Space(17.0f, 0.0f, 7.0f);
    (void)GlyphRun::Construct(Column, Faces.Regular, 12.0f * S, ImVec2(Head.x, GlyphRun::ResolveBaseline(Head.y, 12.0f * S, 1.4f)),
                              FadeColour(Theme.ControlLabel, Fade), Label);

    // 📝 .slider-control: 28 px row; .value-pill 92 px; gap 10 px; .pill-range fills the rest at 26 px.
    constexpr float RowTall   = 28.0f;
    constexpr float PillWide  = 92.0f;
    constexpr float Gap       = 10.0f;
    constexpr float TrackTall = 26.0f;
    constexpr float EndsTall  = 18.0f;
    const ImVec2    Top       = Column.Space(HasEnds ? RowTall + EndsTall : RowTall, 0.0f, 15.0f);
    const ImVec2    PillMax(Top.x + PillWide * S, Top.y + RowTall * S);
    DrawList->AddRectFilled(Top, PillMax, FadeColour(Theme.PillFill, Fade), 14.0f * S);
    DrawList->AddRect(Top, PillMax, FadeColour(Theme.PillBorder, Fade), 14.0f * S, ImDrawFlags_None, S);

    const ImVec2 NumberMin(Top.x, Top.y + 1.0f * S);
    const ImVec2 NumberMax(Top.x + 58.0f * S, Top.y + 27.0f * S);
    const ImVec2 CellMin(Top.x + 58.0f * S, Top.y);
    const ImVec2 CellMax(Top.x + PillWide * S, Top.y + RowTall * S);
    DrawList->PushClipRect(Top, PillMax, true);
    DrawList->AddRectFilled(CellMin, CellMax, FadeColour(ResolveCssColour(0x171717FF), Fade));
    DrawList->AddLine(ImVec2(CellMin.x, Top.y + 4.0f * S), ImVec2(CellMin.x, Top.y + 24.0f * S),
                      FadeColour(ResolveCssColour(0xFFFFFF14), Fade), S);
    DrawList->PopClipRect();

    char        Figure[48]{};
    const char* UnitText = (Unit != nullptr && Unit[0] != '\0') ? Unit : Options.EmptyUnit;
    if (Options.Distance) FormatDistanceFigure(Quantity, Figure, sizeof(Figure), UnitText);
    else std::snprintf(Figure, sizeof(Figure), "%.*f", Digits, Quantity);
    const float UnitWide = GlyphRun::Measure(Column, Faces.Regular, 9.5f * S, UnitText);
    const float UnitTop  = Top.y + 0.5f * (RowTall * S - 9.5f * 1.4f * S);
    (void)GlyphRun::Construct(Column, Faces.Regular, 9.5f * S,
                              ImVec2(CellMin.x + 0.5f * (34.0f * S - UnitWide), GlyphRun::ResolveBaseline(UnitTop, 9.5f * S, 1.4f)),
                              FadeColour(Theme.SliderUnit, Fade), UnitText);
    const float FigureWide = GlyphRun::Measure(Column, Faces.Regular, 11.5f * S, Figure);
    const float FigureTop  = Top.y + 0.5f * (RowTall * S - 11.5f * 1.38f * S);

    ImGui::PushID(Id);
    if (!Enabled) ImGui::BeginDisabled();
    // 📝 The figure: click to type, horizontal drag to scrub (Fluid drag-scrubbing: span per 180 px).
    const ImGuiID FigureId = ImGui::GetID("##PillFigure");
    bool          Typing   = ImGui::TempInputIsActive(FigureId);
    ImGui::SetCursorScreenPos(NumberMin);
    ImGui::InvisibleButton("##PillFigure", ImVec2(NumberMax.x - NumberMin.x, NumberMax.y - NumberMin.y), ImGuiButtonFlags_EnableNav);
    if (ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled)) ControlColumn::ConstructTooltip(Tooltip);
    const bool Scrubbing = Enabled && ImGui::IsItemActive() && ImGui::IsMouseDragging(ImGuiMouseButton_Left, 3.0f);
    if (Enabled && ImGui::IsItemActive() && ImGui::IsMouseReleased(ImGuiMouseButton_Left) && !Scrubbing &&
        ImGui::GetIO().MouseDragMaxDistanceSqr[ImGuiMouseButton_Left] < 9.0f)
    {
        Typing = true;
    }
    if (Scrubbing)
    {
        const float Factor = ImGui::GetIO().KeyShift ? 0.15f : (ImGui::GetIO().KeyAlt ? 4.0f : 1.0f);
        const float Share  = (ImGui::GetIO().MouseDelta.x / 180.0f) * Factor;
        const double Next  = Log ? Snap(LogValueOf(LogSliderOf(Quantity, Minimum, Maximum) + Share * 1000.0, Minimum, Maximum))
                                 : Snap(Quantity + Share * (Maximum - Minimum));
        if (Next != Quantity)
        {
            Quantity = Next;
            Moved    = true;
        }
    }
    if (Typing && Enabled && !Scrubbing)
    {
        ImGui::PushStyleColor(ImGuiCol_FrameBg, ResolveCssColour(0x00000000));
        ImGui::PushStyleColor(ImGuiCol_Text, Theme.SliderNumber);
        ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 7.0f * S);
        if (Options.Distance)
        {
            // 📝 Distance figures type "1.4 km" / "245 m" and commit on Enter (blur reverts).
            static DistanceEntryState Entry{};
            if (Entry.Seeded != FigureId || !ImGui::TempInputIsActive(FigureId))
            {
                std::snprintf(Entry.Text, sizeof(Entry.Text), "%s %s", Figure, UnitText);
                Entry.Seeded = FigureId;
            }
            if (ImGui::TempInputText(ImRect(NumberMin, NumberMax), FigureId, "##PillDistance", Entry.Text,
                                     static_cast<int>(sizeof(Entry.Text)), ImGuiInputTextFlags_EnterReturnsTrue))
            {
                const double Parsed = ParseDistanceFigure(Entry.Text, UnitText);
                if (std::isfinite(Parsed))
                {
                    const double Next = Snap(Parsed);
                    Moved    = Next != Quantity;
                    Quantity = Next;
                }
            }
        }
        else
        {
            double Display = Quantity;
            char   Format[16]{};
            std::snprintf(Format, sizeof(Format), "%%.%df", Digits);
            if (ImGui::TempInputScalar(ImRect(NumberMin, NumberMax), FigureId, "##PillEntry", ImGuiDataType_Double, &Display, Format,
                                       nullptr, nullptr) &&
                std::isfinite(Display))
            {
                const double Next = Snap(Display);
                Moved    = Next != Quantity;
                Quantity = Next;
            }
        }
        ImGui::PopStyleVar();
        ImGui::PopStyleColor(2);
    }
    else if (!Typing)
    {
        (void)GlyphRun::Construct(Column, Faces.Regular, 11.5f * S,
                                  ImVec2(NumberMin.x + 0.5f * (58.0f * S - FigureWide),
                                         GlyphRun::ResolveBaseline(FigureTop, 11.5f * S, 1.38f)),
                                  FadeColour(Theme.SliderNumber, Fade), Figure);
    }

    // 📝 The track: thumb-aware split at 12 px + (width - 24 px) x fraction, 24 px spherical thumb.
    const ImVec2 TrackMin(Top.x + (PillWide + Gap) * S, Top.y + 0.5f * (RowTall - TrackTall) * S);
    const ImVec2 TrackMax(Top.x + Width, TrackMin.y + TrackTall * S);
    const float  TrackWide = std::max(1.0f, TrackMax.x - TrackMin.x);
    const float  Fraction  = FractionOf();
    const float  Split     = TrackMin.x + 12.0f * S + (TrackWide - 24.0f * S) * Fraction;
    ImGui::SetCursorScreenPos(ImVec2(TrackMin.x, TrackMin.y - 1.0f * S));
    ImGui::InvisibleButton("##PillTrack", ImVec2(TrackWide, TrackTall * S + 2.0f * S), ImGuiButtonFlags_EnableNav);
    if (ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled)) ControlColumn::ConstructTooltip(Tooltip);
    if (Enabled && ImGui::IsItemActive() && ImGui::IsMouseDown(ImGuiMouseButton_Left))
    {
        const float Share = std::clamp((ImGui::GetIO().MousePos.x - (TrackMin.x + 12.0f * S)) / std::max(1.0f, TrackWide - 24.0f * S), 0.0f, 1.0f);
        const double Next = Log ? Snap(LogValueOf(Share * 1000.0, Minimum, Maximum)) : Snap(Minimum + Share * (Maximum - Minimum));
        if (Next != Quantity)
        {
            Quantity = Next;
            Moved    = true;
        }
    }
    if (!Enabled) ImGui::EndDisabled();
    ImGui::PopID();

    DrawList->AddRectFilled(TrackMin, TrackMax, FadeColour(Theme.TrackEmpty, Fade), 13.0f * S);
    if (Split > TrackMin.x + 12.0f * S + 0.5f)
    {
        DrawList->PushClipRect(TrackMin, ImVec2(Split, TrackMax.y), true);
        DrawList->AddRectFilled(TrackMin, TrackMax, FadeColour(Theme.TrackFull, Fade), 13.0f * S);
        DrawList->PopClipRect();
    }
    else if (Split > TrackMin.x + 0.5f)
    {
        DrawList->PushClipRect(TrackMin, ImVec2(TrackMin.x + 24.0f * S, TrackMax.y), true);
        DrawList->AddRectFilled(TrackMin, TrackMax, FadeColour(Theme.TrackFull, Fade), 13.0f * S);
        DrawList->PopClipRect();
    }
    DrawList->AddCircleFilled(ImVec2(Split, TrackMin.y + 0.5f * TrackTall * S), 12.0f * S, FadeColour(Theme.ThumbFill, Fade), 32);

    if (HasEnds)
    {
        // 📝 .slider-ends: 9.5 px captions under the track ends, clearing the 102 px pill column.
        const float EndsTop = Top.y + (RowTall + 4.0f) * S;
        (void)GlyphRun::Construct(Column, Faces.Regular, 9.5f * S,
                                  ImVec2(TrackMin.x, GlyphRun::ResolveBaseline(EndsTop, 9.5f * S, 1.4f)),
                                  FadeColour(ResolveCssColour(0x5E5E5EFF), Fade), Options.LowerEnd);
        const float UpperWide = GlyphRun::Measure(Column, Faces.Regular, 9.5f * S, Options.UpperEnd);
        (void)GlyphRun::Construct(Column, Faces.Regular, 9.5f * S,
                                  ImVec2(TrackMax.x - UpperWide, GlyphRun::ResolveBaseline(EndsTop, 9.5f * S, 1.4f)),
                                  FadeColour(ResolveCssColour(0x5E5E5EFF), Fade), Options.UpperEnd);
    }
    return Moved;
}

} // namespace Frontier
