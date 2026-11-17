/*============================================================================================================================================
                                                           PRISMATICBODY.CPP
============================================================================================================================================*/
// 🧩 Exact prism metric evaluation plus derived Frontier PolygonNetwork surface construction for Parametric Sketcher

//------------------------------------------------------------------------------------------------------------------------
//                                                        INCLUDES
//------------------------------------------------------------------------------------------------------------------------

#include "Engine/ParametricSketcher/Solids/PrismaticBody.h"

#include "Engine/GeometrySpace/Primitives/RevolutionSweepPrimitives.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace Frontier::ParametricSketcher
{

namespace
{

[[nodiscard]] bool QueryUnitRangeFinite(float Reading) noexcept
{
    return std::isfinite(Reading) && Reading >= 0.0f && Reading <= 1.0f;
}

[[nodiscard]] bool ValidateSurfaceShading(
    const GeometrySpace::FaceShadingAssignment& SurfaceShading) noexcept
{
    return QueryUnitRangeFinite(SurfaceShading.AlbedoLinearRGB.X) &&
           QueryUnitRangeFinite(SurfaceShading.AlbedoLinearRGB.Y) &&
           QueryUnitRangeFinite(SurfaceShading.AlbedoLinearRGB.Z) &&
           QueryUnitRangeFinite(SurfaceShading.MatCapTintLinearRGB.X) &&
           QueryUnitRangeFinite(SurfaceShading.MatCapTintLinearRGB.Y) &&
           QueryUnitRangeFinite(SurfaceShading.MatCapTintLinearRGB.Z) &&
           QueryUnitRangeFinite(SurfaceShading.Metallic) &&
           QueryUnitRangeFinite(SurfaceShading.Roughness) &&
           QueryUnitRangeFinite(SurfaceShading.Specular) &&
           QueryUnitRangeFinite(SurfaceShading.MatCapBlend) &&
           SurfaceShading.MatCapSlot <= 15u;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                 PRISMATIC BODY VALIDATION
//------------------------------------------------------------------------------------------------------------------------

bool ValidatePrismaticBody(
    const PrismaticBody& Body,
    const SketchProfile& Profile,
    std::string&         OutDiagnostic) noexcept
{
    if (Body.BodyOrdinal == 0u)
    {
        OutDiagnostic = "PrismaticBody requires a non-zero BodyOrdinal.";
        return false;
    }
    if (Body.ProfileOrdinal == 0u || Body.ProfileOrdinal != Profile.ProfileOrdinal)
    {
        OutDiagnostic = "PrismaticBody ProfileOrdinal must reference the supplied SketchProfile.";
        return false;
    }
    if (!std::isfinite(Body.ExtrusionLengthMeters) || std::fabs(Body.ExtrusionLengthMeters) <= 1.0e-6f)
    {
        OutDiagnostic = "PrismaticBody requires a finite non-zero ExtrusionLengthMeters.";
        return false;
    }
    if (!ValidateSurfaceShading(Body.SurfaceShading))
    {
        OutDiagnostic = "PrismaticBody requires finite unit-range shading values plus MatCapSlot in [0, 15].";
        return false;
    }

    const SketchContourValidity ProfileValidity = ValidateSketchProfile(Profile, OutDiagnostic);
    if (ProfileValidity != SketchContourValidity::Valid)
    {
        return false;
    }

    OutDiagnostic.clear();
    return true;
}

double QueryPrismaticVolumeCubicMeters(
    const PrismaticBody& Body,
    const SketchProfile& Profile) noexcept
{
    return QuerySketchAreaSquareMeters(Profile) * std::fabs(static_cast<double>(Body.ExtrusionLengthMeters));
}

double QueryPrismaticSurfaceAreaSquareMeters(
    const PrismaticBody& Body,
    const SketchProfile& Profile) noexcept
{
    const double EndCapArea  = 2.0 * QuerySketchAreaSquareMeters(Profile);
    const double WallArea    = QuerySketchPerimeterMeters(Profile) * std::fabs(static_cast<double>(Body.ExtrusionLengthMeters));
    return EndCapArea + WallArea;
}

//------------------------------------------------------------------------------------------------------------------------
//                                             DERIVED POLYGONNETWORK SURFACE
//------------------------------------------------------------------------------------------------------------------------

void ConstructPrismaticSurfaceNetwork(
    const SketchPlane&   Plane,
    const SketchProfile& Profile,
    const PrismaticBody& Body,
    GeometrySpace::PolygonNetwork& OutNetwork)
{
    OutNetwork.Reset();
    OutNetwork.NetworkTitle = Profile.ProfileTitle + "_Prism";

    std::string Diagnostic;
    if (!ValidateSketchPlane(Plane, Diagnostic) || !ValidatePrismaticBody(Body, Profile, Diagnostic))
    {
        return;
    }

    const Mathematics::Axis3D ExtrusionOffset =
        QuerySketchPlaneNormal(Plane) * Body.ExtrusionLengthMeters;
    const GeometrySpace::UVPatchBounds UVRegion {
        { 0.05f, 0.05f },
        { 0.95f, 0.95f },
    };

    GeometrySpace::AppendLinearExtrusionPrimitive(
        OutNetwork,
        Plane.Origin,
        Plane.RightAxis,
        Plane.UpAxis,
        Profile.ClosedContour,
        ExtrusionOffset,
        1u,
        0.0f,
        1.0f,
        UVRegion,
        Body.SurfaceShading,
        0u,
        static_cast<uint16_t>(std::min<uint32_t>(Body.BodyOrdinal, std::numeric_limits<uint16_t>::max())));
    OutNetwork.LinkOppositeEdges();
    OutNetwork.RecomputeNormals();
}

} // namespace Frontier::ParametricSketcher
