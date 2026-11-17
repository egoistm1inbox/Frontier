/*============================================================================================================================================
                                                            PRISMATICBODY.H
============================================================================================================================================*/
// 🧩 Exact planar-profile prism measurements plus derived PolygonNetwork surface construction for Parametric Sketcher

#pragma once

//------------------------------------------------------------------------------------------------------------------------
//                                                        INCLUDES
//------------------------------------------------------------------------------------------------------------------------

#include "Engine/GeometrySpace/Network/PolygonNetwork.h"
#include "Engine/ParametricSketcher/Sketching/SketchProfile.h"

#include <cstdint>
#include <string>

namespace Frontier::ParametricSketcher
{

//------------------------------------------------------------------------------------------------------------------------
//                                                       STRUCTURES
//------------------------------------------------------------------------------------------------------------------------

struct PrismaticBody
{
    uint32_t                                   BodyOrdinal            = 0u;   // [idx] - Persistent document-local solid identity
    uint32_t                                   ProfileOrdinal         = 0u;   // [idx] - Source SketchProfile persistent identity
    float                                      ExtrusionLengthMeters  = 0.0f; // [m]   - Signed extrusion distance along SketchPlane normal
    GeometrySpace::FaceShadingAssignment       SurfaceShading         {};     // [-]   - Derived render-face MatCap plus PBR assignment
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  FUNCTION PROTOTYPES
//------------------------------------------------------------------------------------------------------------------------

[[nodiscard]] bool ValidatePrismaticBody(
    const PrismaticBody& Body,
    const SketchProfile& Profile,
    std::string&         OutDiagnostic) noexcept;

[[nodiscard]] double QueryPrismaticVolumeCubicMeters(
    const PrismaticBody& Body,
    const SketchProfile& Profile) noexcept;

[[nodiscard]] double QueryPrismaticSurfaceAreaSquareMeters(
    const PrismaticBody& Body,
    const SketchProfile& Profile) noexcept;

void ConstructPrismaticSurfaceNetwork(
    const SketchPlane&   Plane,
    const SketchProfile& Profile,
    const PrismaticBody& Body,
    GeometrySpace::PolygonNetwork& OutNetwork);

} // namespace Frontier::ParametricSketcher
