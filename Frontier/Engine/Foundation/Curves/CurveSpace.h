/*==========================================================================================================================================
                                                            CURVESPACE.H
==========================================================================================================================================*/
// 🧩 Validated scalar curves, monotone interpolation, fixed-size lookup tables, and the `.curvespace` schema.

#pragma once

#include "Frontier/Engine/Scene/SpaceCodec.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <concepts>
#include <cstddef>
#include <limits>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace Frontier
{

enum class CurveInterpolation : uint32_t
{
    Linear = 0,
    CubicHermite = 1,
    MonotonicPchip = 2,
};

struct CurveKnot
{
    double Input = 0.0;
    double Output = 0.0;
};

struct CurveSpecification
{
    std::string Name{};
    CurveInterpolation Interpolation = CurveInterpolation::Linear;
    std::vector<CurveKnot> Knots{};
};

struct CurveSpace
{
    std::vector<CurveSpecification> Curves{};
};

template <>
struct SpaceSchema<CurveKnot>
{
    static constexpr auto Bindings() noexcept
    {
        return std::make_tuple(MakeFieldBinding("input", &CurveKnot::Input),
                               MakeFieldBinding("output", &CurveKnot::Output));
    }
};

template <>
struct SpaceSchema<CurveSpecification>
{
    static constexpr auto Bindings() noexcept
    {
        return std::make_tuple(MakeFieldBinding("name", &CurveSpecification::Name),
                               MakeFieldBinding("interpolation", &CurveSpecification::Interpolation),
                               MakeFieldBinding("knots", &CurveSpecification::Knots));
    }
};

template <>
struct SpaceSchema<CurveSpace>
{
    static constexpr auto Bindings() noexcept
    {
        return std::make_tuple(MakeFieldBinding("curves", &CurveSpace::Curves));
    }
};

template <typename ScalarT>
concept CurveValue = std::floating_point<ScalarT> && requires(ScalarT Value)
{
    { std::isfinite(Value) } -> std::convertible_to<bool>;
    { Value + Value } -> std::same_as<ScalarT>;
    { Value - Value } -> std::same_as<ScalarT>;
    { Value * Value } -> std::same_as<ScalarT>;
    { Value / Value } -> std::same_as<ScalarT>;
};

template <size_t SampleCount>
struct CurveLookupTable
{
    static_assert(SampleCount >= 2, "A curve lookup table needs at least two samples");

    double MinimumInput = 0.0;
    double MaximumInput = 1.0;
    std::array<double, SampleCount> Samples{};

    [[nodiscard]] double Sample(double Input) const noexcept
    {
        if (std::isnan(Input) || !(MaximumInput > MinimumInput)) return Samples.front();
        const double Clamped = std::clamp(Input, MinimumInput, MaximumInput);
        const double Scaled = (Clamped - MinimumInput) * static_cast<double>(SampleCount - 1) /
                              (MaximumInput - MinimumInput);
        const size_t Lower = std::min(static_cast<size_t>(Scaled), SampleCount - 2);
        const double Fraction = std::clamp(Scaled - static_cast<double>(Lower), 0.0, 1.0);
        return Samples[Lower] + (Samples[Lower + 1] - Samples[Lower]) * Fraction;
    }
};

template <CurveValue ValueT = double>
class CurveProfile
{
  public:
    static constexpr size_t MaximumKnotCount = 4096;

    [[nodiscard]] bool Assign(const CurveSpecification& Specification, std::string* OutDiagnostic = nullptr)
    {
        if (Specification.Name.empty()) return Fail("Curve name must not be empty", OutDiagnostic);
        if (Specification.Knots.size() < 2 || Specification.Knots.size() > MaximumKnotCount)
            return Fail("Curve knot count must be between 2 and 4096", OutDiagnostic);
        if (Specification.Interpolation != CurveInterpolation::Linear &&
            Specification.Interpolation != CurveInterpolation::CubicHermite &&
            Specification.Interpolation != CurveInterpolation::MonotonicPchip)
            return Fail("Curve interpolation mode is invalid", OutDiagnostic);

        for (size_t Index = 0; Index < Specification.Knots.size(); ++Index)
        {
            const CurveKnot& Knot = Specification.Knots[Index];
            if (!std::isfinite(Knot.Input) || !std::isfinite(Knot.Output))
                return Fail("Curve knots must contain only finite values", OutDiagnostic);
            if (Index > 0)
            {
                const CurveKnot& Previous = Specification.Knots[Index - 1];
                const double Width = Knot.Input - Previous.Input;
                if (!(Width > 0.0) || !std::isfinite(Width))
                    return Fail("Curve intervals must have a finite, positive domain", OutDiagnostic);
                const double Secant = (Knot.Output - Previous.Output) / Width;
                if (!std::isfinite(Secant)) return Fail("Curve slopes must remain finite", OutDiagnostic);
            }
        }
        if (!std::isfinite(Specification.Knots.back().Input - Specification.Knots.front().Input))
            return Fail("Curve input domain must have finite extent", OutDiagnostic);

        std::vector<double> Slopes(Specification.Knots.size(), 0.0);
        if (Specification.Interpolation == CurveInterpolation::CubicHermite)
            ResolveHermiteSlopes(Specification.Knots, Slopes);
        else if (Specification.Interpolation == CurveInterpolation::MonotonicPchip &&
                 !ResolveMonotonicSlopes(Specification.Knots, Slopes))
            return Fail("Monotonic PCHIP requires monotone output coordinates", OutDiagnostic);
        if (std::any_of(Slopes.begin(), Slopes.end(), [](double Slope) { return !std::isfinite(Slope); }))
            return Fail("Curve tangents must remain finite", OutDiagnostic);

        Specification_ = Specification;
        Slopes_ = std::move(Slopes);
        Valid_ = true;
        return true;
    }

    [[nodiscard]] bool IsValid() const noexcept { return Valid_; }
    [[nodiscard]] double MinimumInput() const noexcept { return Valid_ ? Specification_.Knots.front().Input : 0.0; }
    [[nodiscard]] double MaximumInput() const noexcept { return Valid_ ? Specification_.Knots.back().Input : 0.0; }
    [[nodiscard]] const CurveSpecification& QuerySpecification() const noexcept { return Specification_; }

    [[nodiscard]] ValueT Evaluate(ValueT Input) const noexcept
    {
        if (!Valid_) return ValueT{};
        const double X = static_cast<double>(Input);
        if (std::isnan(X)) return static_cast<ValueT>(Specification_.Knots.front().Output);
        const auto& Knots = Specification_.Knots;
        if (X <= Knots.front().Input) return static_cast<ValueT>(Knots.front().Output);
        if (X >= Knots.back().Input) return static_cast<ValueT>(Knots.back().Output);

        const auto Upper = std::upper_bound(Knots.begin(), Knots.end(), X,
            [](double Coordinate, const CurveKnot& Knot) { return Coordinate < Knot.Input; });
        const size_t Right = static_cast<size_t>(Upper - Knots.begin());
        const size_t Left = Right - 1;
        const CurveKnot& A = Knots[Left];
        const CurveKnot& B = Knots[Right];
        const double Width = B.Input - A.Input;
        const double T = (X - A.Input) / Width;
        if (Specification_.Interpolation == CurveInterpolation::Linear)
            return static_cast<ValueT>(A.Output + (B.Output - A.Output) * T);

        const double T2 = T * T;
        const double T3 = T2 * T;
        const double H00 = 2.0 * T3 - 3.0 * T2 + 1.0;
        const double H10 = T3 - 2.0 * T2 + T;
        const double H01 = -2.0 * T3 + 3.0 * T2;
        const double H11 = T3 - T2;
        const double Raw = H00 * A.Output + H10 * Width * Slopes_[Left] + H01 * B.Output + H11 * Width * Slopes_[Right];
        const double Clamped = std::clamp(Raw, std::min(A.Output, B.Output), std::max(A.Output, B.Output));
        return static_cast<ValueT>(Clamped);
    }

    template <size_t SampleCount>
    [[nodiscard]] CurveLookupTable<SampleCount> Bake() const noexcept
    {
        static_assert(SampleCount >= 2, "A curve lookup table needs at least two samples");
        CurveLookupTable<SampleCount> Lookup;
        if (!Valid_) return Lookup;
        Lookup.MinimumInput = MinimumInput();
        Lookup.MaximumInput = MaximumInput();
        for (size_t Index = 0; Index < SampleCount; ++Index)
        {
            const double T = static_cast<double>(Index) / static_cast<double>(SampleCount - 1);
            Lookup.Samples[Index] = static_cast<double>(Evaluate(static_cast<ValueT>(
                Lookup.MinimumInput + (Lookup.MaximumInput - Lookup.MinimumInput) * T)));
        }
        return Lookup;
    }

  private:
    [[nodiscard]] static bool Fail(std::string_view Message, std::string* OutDiagnostic)
    {
        if (OutDiagnostic != nullptr) *OutDiagnostic = Message;
        return false;
    }

    static void ResolveHermiteSlopes(const std::vector<CurveKnot>& Knots, std::vector<double>& OutSlopes) noexcept
    {
        const size_t Count = Knots.size();
        OutSlopes.front() = (Knots[1].Output - Knots[0].Output) / (Knots[1].Input - Knots[0].Input);
        OutSlopes.back() = (Knots.back().Output - Knots[Count - 2].Output) /
                           (Knots.back().Input - Knots[Count - 2].Input);
        for (size_t Index = 1; Index + 1 < Count; ++Index)
        {
            const double LeftWidth = Knots[Index].Input - Knots[Index - 1].Input;
            const double RightWidth = Knots[Index + 1].Input - Knots[Index].Input;
            const double LeftSecant = (Knots[Index].Output - Knots[Index - 1].Output) / LeftWidth;
            const double RightSecant = (Knots[Index + 1].Output - Knots[Index].Output) / RightWidth;
            if (LeftWidth <= RightWidth)
            {
                const double Ratio = LeftWidth / RightWidth;
                OutSlopes[Index] = (Ratio * LeftSecant + RightSecant) / (Ratio + 1.0);
            }
            else
            {
                const double Ratio = RightWidth / LeftWidth;
                OutSlopes[Index] = (LeftSecant + Ratio * RightSecant) / (Ratio + 1.0);
            }
        }
    }

    [[nodiscard]] static bool ResolveMonotonicSlopes(const std::vector<CurveKnot>& Knots,
                                                      std::vector<double>& OutSlopes) noexcept
    {
        const size_t Count = Knots.size();
        std::vector<double> Widths(Count - 1);
        std::vector<double> Secants(Count - 1);
        bool Increasing = true;
        bool Decreasing = true;
        for (size_t Index = 0; Index + 1 < Count; ++Index)
        {
            Widths[Index] = Knots[Index + 1].Input - Knots[Index].Input;
            Secants[Index] = (Knots[Index + 1].Output - Knots[Index].Output) / Widths[Index];
            Increasing = Increasing && Secants[Index] >= 0.0;
            Decreasing = Decreasing && Secants[Index] <= 0.0;
        }
        if (!Increasing && !Decreasing) return false;
        if (Count == 2)
        {
            OutSlopes[0] = OutSlopes[1] = Secants[0];
            return true;
        }

        for (size_t Index = 1; Index + 1 < Count; ++Index)
        {
            const double Before = Secants[Index - 1];
            const double After = Secants[Index];
            if (Before == 0.0 || After == 0.0)
            {
                OutSlopes[Index] = 0.0;
                continue;
            }
            const double W1 = 2.0 * Widths[Index] + Widths[Index - 1];
            const double W2 = Widths[Index] + 2.0 * Widths[Index - 1];
            OutSlopes[Index] = (W1 + W2) / (W1 / Before + W2 / After);
        }

        OutSlopes.front() = EndpointSlope(Widths[0], Widths[1], Secants[0], Secants[1]);
        OutSlopes.back() = EndpointSlope(Widths[Count - 2], Widths[Count - 3], Secants[Count - 2], Secants[Count - 3]);
        return true;
    }

    [[nodiscard]] static double EndpointSlope(double FirstWidth, double SecondWidth,
                                              double FirstSecant, double SecondSecant) noexcept
    {
        double Slope = ((2.0 * FirstWidth + SecondWidth) * FirstSecant - FirstWidth * SecondSecant) /
                       (FirstWidth + SecondWidth);
        if ((Slope > 0.0) != (FirstSecant > 0.0)) return 0.0;
        if ((FirstSecant > 0.0) != (SecondSecant > 0.0) && std::abs(Slope) > 3.0 * std::abs(FirstSecant))
            Slope = 3.0 * FirstSecant;
        return Slope;
    }

    CurveSpecification Specification_{};
    std::vector<double> Slopes_{};
    bool Valid_ = false;
};

[[nodiscard]] inline bool ValidateCurveSpace(const CurveSpace& Space, std::string* OutDiagnostic = nullptr)
{
    if (Space.Curves.size() > 1024)
    {
        if (OutDiagnostic != nullptr) *OutDiagnostic = "Curve space may contain at most 1024 curves";
        return false;
    }
    std::vector<std::string_view> Names;
    Names.reserve(Space.Curves.size());
    for (const CurveSpecification& Specification : Space.Curves)
    {
        if (std::find(Names.begin(), Names.end(), Specification.Name) != Names.end())
        {
            if (OutDiagnostic != nullptr) *OutDiagnostic = "Curve names must be unique";
            return false;
        }
        CurveProfile<double> Curve;
        if (!Curve.Assign(Specification, OutDiagnostic)) return false;
        Names.push_back(Specification.Name);
    }
    return true;
}

[[nodiscard]] inline bool EncodeCurveSpaceText(const CurveSpace& Space, std::string& OutText,
                                                std::string* OutDiagnostic = nullptr)
{
    if (!ValidateCurveSpace(Space, OutDiagnostic)) return false;
    return EncodeSpaceText("frontier.curvespace", 1, Space, OutText);
}

[[nodiscard]] inline bool DecodeCurveSpaceText(std::string_view Text, CurveSpace& OutSpace,
                                                std::string* OutDiagnostic = nullptr)
{
    CurveSpace Decoded;
    if (!DecodeSpaceText(Text, "frontier.curvespace", 1, Decoded, OutDiagnostic)) return false;
    if (!ValidateCurveSpace(Decoded, OutDiagnostic)) return false;
    OutSpace = std::move(Decoded);
    return true;
}

[[nodiscard]] inline bool EncodeCurveSpaceFile(const std::filesystem::path& Path, const CurveSpace& Space,
                                                std::string* OutDiagnostic = nullptr)
{
    if (!ValidateCurveSpace(Space, OutDiagnostic)) return false;
    return EncodeSpaceFile(Path, ".curvespace", "frontier.curvespace", 1, Space, OutDiagnostic);
}

[[nodiscard]] inline bool DecodeCurveSpaceFile(const std::filesystem::path& Path, CurveSpace& OutSpace,
                                                std::string* OutDiagnostic = nullptr)
{
    CurveSpace Decoded;
    if (!DecodeSpaceFile(Path, ".curvespace", "frontier.curvespace", 1, Decoded, OutDiagnostic)) return false;
    if (!ValidateCurveSpace(Decoded, OutDiagnostic)) return false;
    OutSpace = std::move(Decoded);
    return true;
}

} // namespace Frontier
