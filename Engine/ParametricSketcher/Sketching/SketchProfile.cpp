/*============================================================================================================================================
                                                            SKETCHPROFILE.CPP
============================================================================================================================================*/
// 🧩 Planar contour integrity, metric queries, plus rectangle construction for Parametric Sketcher profiles

//------------------------------------------------------------------------------------------------------------------------
//                                                        INCLUDES
//------------------------------------------------------------------------------------------------------------------------

#include "Engine/ParametricSketcher/Sketching/SketchProfile.h"

#include "Engine/Constants/MathConstants.h"

#include <cmath>
#include <utility>

namespace Frontier::ParametricSketcher
{

namespace
{

[[nodiscard]] constexpr double EvaluateOrientedArea(
    Mathematics::Axis2D First,
    Mathematics::Axis2D Second,
    Mathematics::Axis2D Third) noexcept
{
    const double FirstX  = static_cast<double>(First.X);
    const double FirstY  = static_cast<double>(First.Y);
    const double SecondX = static_cast<double>(Second.X);
    const double SecondY = static_cast<double>(Second.Y);
    const double ThirdX  = static_cast<double>(Third.X);
    const double ThirdY  = static_cast<double>(Third.Y);
    return (SecondX - FirstX) * (ThirdY - FirstY) - (SecondY - FirstY) * (ThirdX - FirstX);
}

[[nodiscard]] bool QueryCoordinateFinite(Mathematics::Axis2D Coordinate) noexcept
{
    return std::isfinite(Coordinate.X) && std::isfinite(Coordinate.Y);
}

[[nodiscard]] bool QueryAxisFinite(Mathematics::Axis3D Axis) noexcept
{
    return std::isfinite(Axis.X) && std::isfinite(Axis.Y) && std::isfinite(Axis.Z);
}

[[nodiscard]] bool QueryLineSegmentsIntersect(
    Mathematics::Axis2D FirstStart,
    Mathematics::Axis2D FirstFinish,
    Mathematics::Axis2D SecondStart,
    Mathematics::Axis2D SecondFinish) noexcept
{
    constexpr double Tolerance = 1.0e-8;
    const double AreaOne = EvaluateOrientedArea(FirstStart, FirstFinish, SecondStart);
    const double AreaTwo = EvaluateOrientedArea(FirstStart, FirstFinish, SecondFinish);
    const double AreaThree = EvaluateOrientedArea(SecondStart, SecondFinish, FirstStart);
    const double AreaFour = EvaluateOrientedArea(SecondStart, SecondFinish, FirstFinish);

    const bool FirstSpansSecond =
        (AreaOne > Tolerance && AreaTwo < -Tolerance) || (AreaOne < -Tolerance && AreaTwo > Tolerance);
    const bool SecondSpansFirst =
        (AreaThree > Tolerance && AreaFour < -Tolerance) || (AreaThree < -Tolerance && AreaFour > Tolerance);
    if (FirstSpansSecond && SecondSpansFirst)
    {
        return true;
    }

    const auto QueryWithinClosedExtent = [Tolerance](double Reading, double ExtentA, double ExtentB) noexcept
    {
        const double Lower = std::fmin(ExtentA, ExtentB) - Tolerance;
        const double Upper = std::fmax(ExtentA, ExtentB) + Tolerance;
        return Reading >= Lower && Reading <= Upper;
    };

    const auto QueryOnSegment = [&QueryWithinClosedExtent, Tolerance](
        Mathematics::Axis2D SegmentStart,
        Mathematics::Axis2D SegmentFinish,
        Mathematics::Axis2D Candidate) noexcept
    {
        return std::fabs(EvaluateOrientedArea(SegmentStart, SegmentFinish, Candidate)) <= Tolerance &&
               QueryWithinClosedExtent(Candidate.X, SegmentStart.X, SegmentFinish.X) &&
               QueryWithinClosedExtent(Candidate.Y, SegmentStart.Y, SegmentFinish.Y);
    };

    return QueryOnSegment(FirstStart, FirstFinish, SecondStart) ||
           QueryOnSegment(FirstStart, FirstFinish, SecondFinish) ||
           QueryOnSegment(SecondStart, SecondFinish, FirstStart) ||
           QueryOnSegment(SecondStart, SecondFinish, FirstFinish);
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                   SKETCH PLANE QUERIES
//------------------------------------------------------------------------------------------------------------------------

bool ValidateSketchPlane(const SketchPlane& Plane, std::string& OutDiagnostic) noexcept
{
    if (!QueryAxisFinite(Plane.Origin) || !QueryAxisFinite(Plane.RightAxis) || !QueryAxisFinite(Plane.UpAxis))
    {
        OutDiagnostic = "SketchPlane requires finite origin plus basis coordinates.";
        return false;
    }

    const float RightLength = Mathematics::EvaluateLength(Plane.RightAxis);
    const float UpLength    = Mathematics::EvaluateLength(Plane.UpAxis);
    const float AxisDot     = Mathematics::EvaluateDot(Plane.RightAxis, Plane.UpAxis);
    if (std::fabs(RightLength - 1.0f) > 1.0e-4f || std::fabs(UpLength - 1.0f) > 1.0e-4f)
    {
        OutDiagnostic = "SketchPlane requires unit-length RightAxis plus UpAxis vectors.";
        return false;
    }
    if (std::fabs(AxisDot) > 1.0e-4f)
    {
        OutDiagnostic = "SketchPlane RightAxis plus UpAxis vectors must remain orthogonal.";
        return false;
    }
    OutDiagnostic.clear();
    return true;
}

Mathematics::Axis3D QuerySketchPlaneNormal(const SketchPlane& Plane) noexcept
{
    return Mathematics::NormalizeAxis(
        Mathematics::EvaluateCross(Plane.RightAxis, Plane.UpAxis),
        { 0.0f, 0.0f, 1.0f });
}

Mathematics::Axis3D ProjectSketchCoordinate(
    const SketchPlane& Plane,
    Mathematics::Axis2D Coordinate) noexcept
{
    return Plane.Origin + Plane.RightAxis * Coordinate.X + Plane.UpAxis * Coordinate.Y;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                SKETCH PROFILE VALIDATION
//------------------------------------------------------------------------------------------------------------------------

SketchContourValidity ValidateSketchProfile(
    const SketchProfile& Profile,
    std::string&         OutDiagnostic) noexcept
{
    constexpr float DuplicateToleranceSquared = 1.0e-10f;
    if (Profile.ClosedContour.size() < 3u)
    {
        OutDiagnostic = "SketchProfile requires at least three closed contour corners.";
        return SketchContourValidity::InsufficientCorners;
    }

    for (std::size_t FirstIndex = 0u; FirstIndex < Profile.ClosedContour.size(); ++FirstIndex)
    {
        const Mathematics::Axis2D FirstCorner = Profile.ClosedContour[FirstIndex];
        if (!QueryCoordinateFinite(FirstCorner))
        {
            OutDiagnostic = "SketchProfile contains a non-finite planar coordinate.";
            return SketchContourValidity::NonFiniteCoordinate;
        }

        for (std::size_t SecondIndex = FirstIndex + 1u; SecondIndex < Profile.ClosedContour.size(); ++SecondIndex)
        {
            const Mathematics::Axis2D Delta = Profile.ClosedContour[SecondIndex] - FirstCorner;
            if (Mathematics::EvaluateDot(Delta, Delta) <= DuplicateToleranceSquared)
            {
                OutDiagnostic = "SketchProfile contains repeated contour corners.";
                return SketchContourValidity::RepeatedCorner;
            }
        }
    }

    const std::size_t CornerCount = Profile.ClosedContour.size();
    for (std::size_t FirstSegment = 0u; FirstSegment < CornerCount; ++FirstSegment)
    {
        const std::size_t FirstFinish = (FirstSegment + 1u) % CornerCount;
        for (std::size_t SecondSegment = FirstSegment + 1u; SecondSegment < CornerCount; ++SecondSegment)
        {
            const std::size_t SecondFinish = (SecondSegment + 1u) % CornerCount;
            if (FirstSegment == SecondSegment || FirstFinish == SecondSegment ||
                SecondFinish == FirstSegment || (FirstSegment == 0u && SecondFinish == 0u))
            {
                continue;
            }
            if (QueryLineSegmentsIntersect(
                    Profile.ClosedContour[FirstSegment],
                    Profile.ClosedContour[FirstFinish],
                    Profile.ClosedContour[SecondSegment],
                    Profile.ClosedContour[SecondFinish]))
            {
                OutDiagnostic = "SketchProfile contains a self-intersecting contour.";
                return SketchContourValidity::SelfIntersection;
            }
        }
    }

    if (std::fabs(QuerySignedSketchAreaSquareMeters(Profile)) <= Constants::Epsilon)
    {
        OutDiagnostic = "SketchProfile encloses zero planar area.";
        return SketchContourValidity::ZeroArea;
    }

    OutDiagnostic.clear();
    return SketchContourValidity::Valid;
}

double QuerySignedSketchAreaSquareMeters(const SketchProfile& Profile) noexcept
{
    if (Profile.ClosedContour.size() < 3u)
    {
        return 0.0;
    }

    double TwiceArea = 0.0;
    for (std::size_t CornerIndex = 0u; CornerIndex < Profile.ClosedContour.size(); ++CornerIndex)
    {
        const Mathematics::Axis2D FirstCorner = Profile.ClosedContour[CornerIndex];
        const Mathematics::Axis2D SecondCorner = Profile.ClosedContour[(CornerIndex + 1u) % Profile.ClosedContour.size()];
        TwiceArea += static_cast<double>(FirstCorner.X) * static_cast<double>(SecondCorner.Y) -
                     static_cast<double>(SecondCorner.X) * static_cast<double>(FirstCorner.Y);
    }
    return 0.5 * TwiceArea;
}

double QuerySketchAreaSquareMeters(const SketchProfile& Profile) noexcept
{
    return std::fabs(QuerySignedSketchAreaSquareMeters(Profile));
}

double QuerySketchPerimeterMeters(const SketchProfile& Profile) noexcept
{
    if (Profile.ClosedContour.size() < 2u)
    {
        return 0.0;
    }

    double Perimeter = 0.0;
    for (std::size_t CornerIndex = 0u; CornerIndex < Profile.ClosedContour.size(); ++CornerIndex)
    {
        const Mathematics::Axis2D Delta =
            Profile.ClosedContour[(CornerIndex + 1u) % Profile.ClosedContour.size()] - Profile.ClosedContour[CornerIndex];
        Perimeter += std::sqrt(static_cast<double>(Mathematics::EvaluateDot(Delta, Delta)));
    }
    return Perimeter;
}

SketchProfile ConstructRectangleProfile(
    uint32_t            ProfileOrdinal,
    std::string         ProfileTitle,
    Mathematics::Axis2D MinimumCorner,
    Mathematics::Axis2D MaximumCorner)
{
    SketchProfile Rectangle{};
    Rectangle.ProfileOrdinal = ProfileOrdinal;
    Rectangle.ProfileTitle   = std::move(ProfileTitle);
    Rectangle.ClosedContour  = {
        { MinimumCorner.X, MinimumCorner.Y },
        { MaximumCorner.X, MinimumCorner.Y },
        { MaximumCorner.X, MaximumCorner.Y },
        { MinimumCorner.X, MaximumCorner.Y },
    };
    return Rectangle;
}

} // namespace Frontier::ParametricSketcher
