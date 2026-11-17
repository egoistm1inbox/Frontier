/*============================================================================================================================================
                                                             SKETCHPROFILE.H
============================================================================================================================================*/
// 🧩 Planar closed-contour geometry plus orthonormal sketch-plane validation for Parametric Sketcher authoring

#pragma once

//------------------------------------------------------------------------------------------------------------------------
//                                                        INCLUDES
//------------------------------------------------------------------------------------------------------------------------

#include "Engine/Mathematics/AxisCoordinates.h"

#include <cstdint>
#include <string>
#include <vector>

namespace Frontier::ParametricSketcher
{

//------------------------------------------------------------------------------------------------------------------------
//                                                      ENUMERATIONS
//------------------------------------------------------------------------------------------------------------------------

enum class SketchContourValidity : uint8_t
{
    Valid              = 0u, // [-] - Closed contour is simple, finite, plus non-degenerate
    InsufficientCorners = 1u, // [-] - Fewer than three corners cannot enclose a planar area
    RepeatedCorner     = 2u, // [-] - Two contour corners occupy the same planar coordinate
    SelfIntersection   = 3u, // [-] - Non-neighbouring line segments cross or touch
    ZeroArea           = 4u, // [-] - Signed contour area falls beneath geometric tolerance
    NonFiniteCoordinate = 5u // [-] - One or more coordinates are NaN or infinity
};

//------------------------------------------------------------------------------------------------------------------------
//                                                       STRUCTURES
//------------------------------------------------------------------------------------------------------------------------

struct SketchPlane
{
    Mathematics::Axis3D Origin    {};                    // [m] - Plane-local zero coordinate in Frontier world space
    Mathematics::Axis3D RightAxis { 1.0f, 0.0f, 0.0f }; // [-] - Unit plane U direction
    Mathematics::Axis3D UpAxis    { 0.0f, 1.0f, 0.0f }; // [-] - Unit plane V direction
};

struct SketchProfile
{
    uint32_t                         ProfileOrdinal = 0u;              // [idx] - Persistent document-local sketch profile identity
    std::string                      ProfileTitle   { "SketchProfile" }; // [-] - Human-readable outliner caption
    std::vector<Mathematics::Axis2D> ClosedContour  {};                // [m] - Closed simple contour corners without a duplicated final corner
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  FUNCTION PROTOTYPES
//------------------------------------------------------------------------------------------------------------------------

[[nodiscard]] bool ValidateSketchPlane(const SketchPlane& Plane, std::string& OutDiagnostic) noexcept;
[[nodiscard]] Mathematics::Axis3D QuerySketchPlaneNormal(const SketchPlane& Plane) noexcept;
[[nodiscard]] Mathematics::Axis3D ProjectSketchCoordinate(
    const SketchPlane& Plane,
    Mathematics::Axis2D Coordinate) noexcept;

[[nodiscard]] SketchContourValidity ValidateSketchProfile(
    const SketchProfile& Profile,
    std::string&         OutDiagnostic) noexcept;

[[nodiscard]] double QuerySignedSketchAreaSquareMeters(const SketchProfile& Profile) noexcept;
[[nodiscard]] double QuerySketchAreaSquareMeters(const SketchProfile& Profile) noexcept;
[[nodiscard]] double QuerySketchPerimeterMeters(const SketchProfile& Profile) noexcept;

[[nodiscard]] SketchProfile ConstructRectangleProfile(
    uint32_t            ProfileOrdinal,
    std::string         ProfileTitle,
    Mathematics::Axis2D MinimumCorner,
    Mathematics::Axis2D MaximumCorner);

} // namespace Frontier::ParametricSketcher
