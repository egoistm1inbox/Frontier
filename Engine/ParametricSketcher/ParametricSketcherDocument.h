/*============================================================================================================================================
                                                     PARAMETRICSKETCHERDOCUMENT.H
============================================================================================================================================*/
// 🧩 Native Parametric Sketcher authoring document retaining persistent sketch profiles plus prismatic feature definitions

#pragma once

//------------------------------------------------------------------------------------------------------------------------
//                                                        INCLUDES
//------------------------------------------------------------------------------------------------------------------------

#include "Engine/ParametricSketcher/Solids/PrismaticBody.h"

#include <cstdint>
#include <string>
#include <vector>

namespace Frontier::ParametricSketcher
{

//------------------------------------------------------------------------------------------------------------------------
//                                                       CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

inline constexpr uint32_t InvalidSketchOrdinal = 0u; // [idx] - Unresolved persistent sketch or body identity

//------------------------------------------------------------------------------------------------------------------------
//                                                       STRUCTURES
//------------------------------------------------------------------------------------------------------------------------

struct ParametricSketcherDocument
{
    std::string                  DocumentTitle      { "UntitledSketch" }; // [-]   - Native .Sketch authoring title
    SketchPlane                  ActivePlane        {};                    // [-]   - Current 2D sketch placement plane
    std::vector<SketchProfile>   Profiles           {};                    // [-]   - Persistent planar contour profiles
    std::vector<PrismaticBody>   Bodies             {};                    // [-]   - Persistent prismatic features derived from profiles
    uint32_t                     NextProfileOrdinal = 1u;                  // [idx] - Monotonic profile identity issuer
    uint32_t                     NextBodyOrdinal    = 1u;                  // [idx] - Monotonic body identity issuer
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  FUNCTION PROTOTYPES
//------------------------------------------------------------------------------------------------------------------------

[[nodiscard]] SketchProfile* ResolveSketchProfile(
    ParametricSketcherDocument& Document,
    uint32_t                    ProfileOrdinal) noexcept;

[[nodiscard]] const SketchProfile* ResolveSketchProfile(
    const ParametricSketcherDocument& Document,
    uint32_t                          ProfileOrdinal) noexcept;

[[nodiscard]] PrismaticBody* ResolvePrismaticBody(
    ParametricSketcherDocument& Document,
    uint32_t                    BodyOrdinal) noexcept;

[[nodiscard]] const PrismaticBody* ResolvePrismaticBody(
    const ParametricSketcherDocument& Document,
    uint32_t                          BodyOrdinal) noexcept;

[[nodiscard]] uint32_t AppendSketchProfile(
    ParametricSketcherDocument& Document,
    SketchProfile                Profile,
    std::string&                 OutDiagnostic);

[[nodiscard]] uint32_t ConstructPrismaticBody(
    ParametricSketcherDocument&              Document,
    uint32_t                                 ProfileOrdinal,
    float                                    ExtrusionLengthMeters,
    GeometrySpace::FaceShadingAssignment     SurfaceShading,
    std::string&                             OutDiagnostic);

[[nodiscard]] bool ValidateParametricSketcherDocument(
    const ParametricSketcherDocument& Document,
    std::string&                      OutDiagnostic) noexcept;

[[nodiscard]] bool ConstructBodySurfaceNetwork(
    const ParametricSketcherDocument& Document,
    uint32_t                          BodyOrdinal,
    GeometrySpace::PolygonNetwork&    OutNetwork,
    std::string&                      OutDiagnostic);

} // namespace Frontier::ParametricSketcher
