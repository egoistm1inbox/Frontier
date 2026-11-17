#include "Frontier/Engine/Foundation/Curves/CurveSpace.h"

#include <cmath>
#include <cstdio>
#include <filesystem>
#include <limits>
#include <string>
#include <utility>
#include <vector>

namespace
{
int Checks = 0;
int Failures = 0;

void Confirm(bool Condition, const char* Message)
{
    ++Checks;
    if (!Condition)
    {
        ++Failures;
        std::fprintf(stderr, "[FAIL] %s\n", Message);
    }
}

Frontier::CurveSpecification MakeCurve(std::string Name, Frontier::CurveInterpolation Interpolation,
                                       std::vector<Frontier::CurveKnot> Knots)
{
    return { std::move(Name), Interpolation, std::move(Knots) };
}

bool Near(double Actual, double Expected, double Tolerance = 1.0e-10)
{
    return std::abs(Actual - Expected) <= Tolerance;
}
} // namespace

int main()
{
    using namespace Frontier;
    const CurveSpecification LinearSpec = MakeCurve("falloff", CurveInterpolation::Linear,
        { { 0.0, 1.0 }, { 0.25, 0.5 }, { 1.0, 0.0 } });
    CurveProfile<double> Linear;
    Confirm(Linear.Assign(LinearSpec), "Linear curve assigns");
    Confirm(Near(Linear.Evaluate(-1.0), 1.0) && Near(Linear.Evaluate(2.0), 0.0), "Curve clamps outside its domain");
    Confirm(Near(Linear.Evaluate(0.625), 0.25), "Linear interpolation uses the containing interval");
    Confirm(Near(Linear.Evaluate(std::numeric_limits<double>::quiet_NaN()), 1.0), "NaN input has deterministic endpoint behavior");
    Confirm(Near(Linear.Evaluate(std::numeric_limits<double>::infinity()), 0.0), "Positive infinity clamps to the curve end");

    const auto LinearLut = Linear.Bake<33>();
    Confirm(LinearLut.Samples.size() == 33 && Near(LinearLut.Sample(0.625), Linear.Evaluate(0.625), 0.015625),
            "Uniform LUT bakes and interpolates its samples");
    Confirm(Near(LinearLut.Sample(-2.0), 1.0) && Near(LinearLut.Sample(2.0), 0.0), "LUT sampling clamps to its domain");
    Confirm(Near(LinearLut.Sample(std::numeric_limits<double>::quiet_NaN()), LinearLut.Samples.front()),
            "LUT sampling has deterministic behavior for non-finite input");

    CurveProfile<double> Hermite;
    Confirm(Hermite.Assign(MakeCurve("smooth", CurveInterpolation::CubicHermite,
        { { 0.0, 0.0 }, { 0.3, 0.7 }, { 1.0, 1.0 } })), "Clamped cubic Hermite curve assigns");
    bool HermiteBounded = true;
    for (int Index = 0; Index <= 1000; ++Index)
    {
        const double Value = Hermite.Evaluate(static_cast<double>(Index) / 1000.0);
        HermiteBounded = HermiteBounded && std::isfinite(Value) && Value >= 0.0 && Value <= 1.0;
    }
    Confirm(HermiteBounded, "Clamped Hermite interpolation remains finite and bounded by each segment");

    CurveProfile<double> Pchip;
    const CurveSpecification PchipSpec = MakeCurve("burn", CurveInterpolation::MonotonicPchip,
        { { 0.0, 0.0 }, { 0.1, 0.08 }, { 0.6, 0.93 }, { 1.0, 1.0 } });
    Confirm(Pchip.Assign(PchipSpec), "Monotonic PCHIP curve assigns");
    bool Monotonic = true;
    double Previous = Pchip.Evaluate(0.0);
    for (int Index = 1; Index <= 1000; ++Index)
    {
        const double Value = Pchip.Evaluate(static_cast<double>(Index) / 1000.0);
        Monotonic = Monotonic && std::isfinite(Value) && Value >= Previous;
        Previous = Value;
    }
    Confirm(Monotonic, "PCHIP preserves monotonicity between unevenly spaced knots");

    const CurveSpecification InvalidMixed = MakeCurve("bad", CurveInterpolation::MonotonicPchip,
        { { 0.0, 0.0 }, { 0.4, 0.8 }, { 1.0, 0.2 } });
    const double Preserved = Pchip.Evaluate(0.35);
    std::string Diagnostic;
    Confirm(!Pchip.Assign(InvalidMixed, &Diagnostic) && !Diagnostic.empty(), "PCHIP rejects non-monotone output transactionally");
    Confirm(Near(Pchip.Evaluate(0.35), Preserved), "Failed curve assignment retains the prior usable curve");
    Confirm(!Linear.Assign(MakeCurve("duplicate", CurveInterpolation::Linear,
        { { 0.0, 0.0 }, { 0.0, 1.0 } })), "Duplicate input coordinates are rejected");
    Confirm(!Linear.Assign(MakeCurve("nonfinite", CurveInterpolation::Linear,
        { { 0.0, 0.0 }, { 1.0, std::numeric_limits<double>::infinity() } })), "Non-finite knot values are rejected");

    CurveSpace Space;
    Space.Curves = { LinearSpec, PchipSpec };
    std::string Text;
    Confirm(EncodeCurveSpaceText(Space, Text, &Diagnostic), "Curve space encodes after semantic validation");
    CurveSpace Decoded;
    Confirm(DecodeCurveSpaceText(Text, Decoded, &Diagnostic), "Curve space decodes through the generic SpaceCodec");
    Confirm(Decoded.Curves.size() == 2 && Decoded.Curves[1].Interpolation == CurveInterpolation::MonotonicPchip &&
            Decoded.Curves[1].Knots.size() == PchipSpec.Knots.size(), "Curve codec preserves modes and knots");

    CurveSpace Preserve = Space;
    const std::string InvalidText =
        "format = \"frontier.curvespace\"\nversion = 1\n\n[[curves]]\nname = \"bad\"\ninterpolation = 2\n"
        "knots = [{ input = 0.0, output = 0.0 }, { input = 0.5, output = 1.0 }, { input = 1.0, output = 0.2 }]\n";
    Confirm(!DecodeCurveSpaceText(InvalidText, Preserve, &Diagnostic), "Curve codec rejects semantically invalid TOML");
    Confirm(Preserve.Curves.size() == Space.Curves.size(), "Failed decode leaves the destination space unchanged");
    const std::string InvalidModeText =
        "format = \"frontier.curvespace\"\nversion = 1\n\n[[curves]]\nname = \"bad-mode\"\ninterpolation = 9\n"
        "knots = [{ input = 0.0, output = 0.0 }, { input = 1.0, output = 1.0 }]\n";
    Confirm(!DecodeCurveSpaceText(InvalidModeText, Preserve, &Diagnostic), "Unknown curve interpolation mode is rejected");
    Confirm(Preserve.Curves.size() == Space.Curves.size(), "Unknown mode rejection preserves the prior destination");
    const std::filesystem::path Temp = std::filesystem::temp_directory_path() / "FrontierCurveSpaceValidation.curvespace";
    Confirm(EncodeCurveSpaceFile(Temp, Space, &Diagnostic), "Curve space writes only to the dedicated extension");
    CurveSpace FromFile;
    Confirm(DecodeCurveSpaceFile(Temp, FromFile, &Diagnostic) && FromFile.Curves.size() == 2, "Curve space file round-trips");
    std::filesystem::remove(Temp);
    Confirm(!EncodeCurveSpaceFile(Temp.string() + ".toml", Space, &Diagnostic), "Generic TOML extension is refused");

    std::fprintf(stdout, "CurveSpaceValidation: %d of %d checks passed\n", Checks - Failures, Checks);
    return Failures == 0 ? 0 : 1;
}
