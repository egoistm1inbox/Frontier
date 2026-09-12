//============================================================================================================================================
// 📦 Project-Zero/Source/RayTracingSolver.cpp — Triangle Ray Intersection and Celestial Material Test Scene
//============================================================================================================================================

#include "RayTracingSolver.h"
#include <cmath>
#include <limits>
#include <algorithm>

namespace Frontier::ProjectZero {

//------------------------------------------------------------------------------------------------------------------------
//                                                LIFECYCLE IMPLEMENTATION
//------------------------------------------------------------------------------------------------------------------------

RayTracingSolver::RayTracingSolver() noexcept
{
    ConstructCelestialTestScene();
}

RayTracingSolver::SpanScope::~SpanScope() noexcept
{
    if (Spans == nullptr || Triangles == nullptr || Span >= Spans->size()) return;
    TriangleSpanRecord& S = (*Spans)[Span];
    const uint32_t Now = static_cast<uint32_t>(Triangles->size());
    S.TriangleCount = Now >= S.FirstTriangle ? Now - S.FirstTriangle : 0u;
}

RayTracingSolver::SpanScope RayTracingSolver::OpenSpan(const char* Name, bool Dynamic) noexcept
{
    TriangleSpanRecord S;
    S.FirstTriangle = static_cast<uint32_t>(Triangles.size());
    if (Name != nullptr) S.Name = Name;
    S.Dynamic = Dynamic;
    Spans.push_back(std::move(S));
    SpanScope Scope;
    Scope.Spans     = &Spans;
    Scope.Triangles = &Triangles;
    Scope.Span      = static_cast<uint32_t>(Spans.size()) - 1u;
    return Scope;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                SCENE GEOMETRY SETUP
//------------------------------------------------------------------------------------------------------------------------

//------------------------------------------------------------------------------------------------------------------------
//                                                  CELESTIAL MATERIAL TEST SCENE
//------------------------------------------------------------------------------------------------------------------------
// Project Zero is one open celestial material test scene: the camera sees the real atmosphere behind a small set of
//    deliberately placed primitives, material colours, an emissive response panel and their shadows. No room, selector
//    or featureless showcase plane stands in for the scene.
//
//    🔴 No ceiling and no walls. That is the entire point: every ray that misses geometry resolves to sky, so a
//    sunset fills the frame instead of a porthole and the moon has somewhere to rise.

void RayTracingSolver::ConstructCelestialTestScene() noexcept
{
    Triangles.clear();
    Materials.clear();
    Spans.clear();

    // Ground is deliberately mid-grey and slightly rough. A bright ground would bounce enough light to mask the
    //    sky's own contribution, which is the thing being judged; a dark one would hide the sun's shadows.
    Materials.push_back(AnalyticalMaterial{ Vector3{ 0.32f, 0.32f, 0.30f }, Vector3{ 0.0f, 0.0f, 0.0f }, 0.6f, 0.0f, 0  });
    // A neutral white for the shadow casters, so their shading is the sky's colour and not their own.
    Materials.push_back(AnalyticalMaterial{ Vector3{ 0.80f, 0.80f, 0.80f }, Vector3{ 0.0f, 0.0f, 0.0f }, 0.4f, 0.0f, 1  });
    // Smoother, to catch a specular glint of the sun and the sky.
    Materials.push_back(AnalyticalMaterial{ Vector3{ 0.72f, 0.74f, 0.78f }, Vector3{ 0.0f, 0.0f, 0.0f }, 0.15f, 0.0f, 2  });
    // Warm, so the sunset's colour shift is legible against something that is not neutral.
    Materials.push_back(AnalyticalMaterial{ Vector3{ 0.70f, 0.45f, 0.28f }, Vector3{ 0.0f, 0.0f, 0.0f }, 0.5f, 0.0f, 3  });
    // Emissive response target. It is deliberately part of the same scene/material export, not a UI light or proof
    //    overlay, so both the software raster and ReSTIR exercise emissive transport and shadows.
    Materials.push_back(AnalyticalMaterial{ Vector3{ 1.0f, 0.92f, 0.75f }, Vector3{ 6.0f, 2.8f, 0.8f }, 0.15f, 0.0f, 4  });

    // ⚠️ The ground is 400 m across, not a few metres. Two reasons, both load-bearing:
    //      · the horizon has to be far enough away that the eye reads it as a horizon rather than as the edge of
    //        a plate, which is what makes the sky feel like a sky;
    //      · aerial perspective (A6) is invisible over six metres — 0.016 % colour shift, 24× below one 8-bit
    //        step — and only becomes measurable over hundreds. This scene is what makes that phase testable.
    constexpr float GroundExtent = 200.0f;   // [m] half-width
    {
        const auto GroundSpan = OpenSpan("Ground");
        AppendQuad(Vector3{ -GroundExtent, -GroundExtent, 0.0f }, Vector3{  GroundExtent, -GroundExtent, 0.0f },
                   Vector3{  GroundExtent,  GroundExtent, 0.0f }, Vector3{ -GroundExtent,  GroundExtent, 0.0f }, 0);
    }

    // Casters at a spread of heights, so shadow length changes visibly as the sun moves and the penumbra widens
    //    with distance from the ground — which is the A4 result made observable.
    {
        const auto WhiteSphereSpan = OpenSpan("White Sphere");
        AppendSphere(Vector3{ -3.20f, 6.00f, 1.20f }, 1.20f, 40u, 20u, 1u);
    }
    {
        const auto SteelSphereSpan = OpenSpan("Steel Sphere");
        AppendSphere(Vector3{  4.60f, 11.00f, 0.70f }, 0.70f, 32u, 16u, 2u);
    }
    {
        const auto ClayConeSpan = OpenSpan("Clay Cone");
        AppendCone  (Vector3{  1.80f, 5.20f, 0.00f }, 0.90f, 2.60f, 40u, 3u);
    }
    {
        const auto SteelTorusSpan = OpenSpan("Steel Torus");
        AppendTorus (Vector3{ -1.40f, 9.50f, 1.60f }, 1.10f, 0.30f, 44u, 22u, 2u);
    }

    // A tall thin slab. A long shadow is the clearest possible read on the sun's elevation, and its edge is
    //    where a penumbra is easiest to measure against the numbers A4 recorded.
    {
        const auto WhiteSlabSpan = OpenSpan("White Slab");
        AppendBox(Vector3{  6.50f, 4.00f, 2.00f }, Vector3{ 0.25f, 1.60f, 2.00f }, 18.0f, 1u);
    }
    {
        const auto ClayCrateSpan = OpenSpan("Clay Crate");
        AppendBox(Vector3{ -6.00f, 3.20f, 0.60f }, Vector3{ 1.00f, 1.00f, 0.60f }, -12.0f, 3u);
    }

    // Emissive response target, last by convention so the luminaire build sees it without a second scene description.
    //    It catches the moon/sun colour and supplies a real area source for GI and the deterministic shadow stage.
    {
        const auto EmissiveSpan = OpenSpan("Emissive Response Panel");
        AppendQuad(Vector3{ -2.80f, 15.0f, 2.20f }, Vector3{ 2.80f, 15.0f, 2.20f },
                   Vector3{ 2.80f, 15.0f, 3.35f }, Vector3{ -2.80f, 15.0f, 3.35f }, 4u);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                             PARAMETRIC PRIMITIVES
//------------------------------------------------------------------------------------------------------------------------
// Winding is counter-clockwise seen from OUTSIDE the solid, matching AppendBox: AppendTriangle derives the
//    geometric normal from the edge cross product, so a reversed winding produces a surface lit from inside and
//    shadowed from outside. That failure looks like a shading bug rather than a geometry one, which is why the
//    orientation of every ring below is stated explicitly.

void RayTracingSolver::AppendSphere(const Vector3& Center, float Radius, uint32_t Segments, uint32_t Rings, uint32_t MaterialIdx) noexcept
{
    if (Segments < 3u || Rings < 2u || Radius <= 0.0f) return;

    constexpr float Pi = 3.14159265359f;
    const auto Point = [&](uint32_t Ring, uint32_t Segment) -> Vector3
    {
        const float Polar     = Pi * static_cast<float>(Ring) / static_cast<float>(Rings);          // 0 at +Z pole
        const float Azimuth   = 2.0f * Pi * static_cast<float>(Segment % Segments) / static_cast<float>(Segments);
        const float SinPolar  = std::sin(Polar);
        return Center + Vector3{ Radius * SinPolar * std::cos(Azimuth),
                                 Radius * SinPolar * std::sin(Azimuth),
                                 Radius * std::cos(Polar) };
    };

    for (uint32_t Ring = 0u; Ring < Rings; ++Ring)
    {
        for (uint32_t Segment = 0u; Segment < Segments; ++Segment)
        {
            const Vector3 A = Point(Ring,      Segment);
            const Vector3 B = Point(Ring,      Segment + 1u);
            const Vector3 C = Point(Ring + 1u, Segment + 1u);
            const Vector3 D = Point(Ring + 1u, Segment);

            // The two polar rings collapse to a point on one side, so they are emitted as single triangles.
            //    A quad there would carry a zero-area half that the BVH must still store and test.
            // ⚠️ Ring advances from the +Z pole DOWNWARD while Segment advances anticlockwise about +Z, so the
            //    natural (A,B,C,D) order traverses clockwise seen from outside and yields inward normals — the
            //    surface then lights from within and shadows from without, which reads as a shading bug. The
            //    order below is reversed for that reason.
            if (Ring == 0u)                 AppendTriangle(A, D, C, MaterialIdx);
            else if (Ring + 1u == Rings)    AppendTriangle(A, C, B, MaterialIdx);
            else                            AppendQuad(A, D, C, B, MaterialIdx);
        }
    }
}

void RayTracingSolver::AppendCone(const Vector3& BaseCentre, float Radius, float Height, uint32_t Segments, uint32_t MaterialIdx) noexcept
{
    if (Segments < 3u || Radius <= 0.0f || Height <= 0.0f) return;

    constexpr float Pi = 3.14159265359f;
    const Vector3 Apex = BaseCentre + Vector3{ 0.0f, 0.0f, Height };
    const auto Rim = [&](uint32_t Segment) -> Vector3
    {
        const float Azimuth = 2.0f * Pi * static_cast<float>(Segment % Segments) / static_cast<float>(Segments);
        return BaseCentre + Vector3{ Radius * std::cos(Azimuth), Radius * std::sin(Azimuth), 0.0f };
    };

    for (uint32_t Segment = 0u; Segment < Segments; ++Segment)
    {
        const Vector3 A = Rim(Segment);
        const Vector3 B = Rim(Segment + 1u);
        AppendTriangle(A, B, Apex, MaterialIdx);        // side, outward
        AppendTriangle(B, A, BaseCentre, MaterialIdx);  // base, downward (−Z)
    }
}

void RayTracingSolver::AppendTorus(const Vector3& Center, float MajorRadius, float MinorRadius,
                                   uint32_t MajorSegments, uint32_t MinorSegments, uint32_t MaterialIdx) noexcept
{
    if (MajorSegments < 3u || MinorSegments < 3u || MinorRadius <= 0.0f) return;
    // A minor radius at or past the major one self-intersects through the hole; the surface is no longer a
    //    torus and the normals invert where it passes through itself.
    if (MinorRadius >= MajorRadius) return;

    constexpr float Pi = 3.14159265359f;
    const auto Point = [&](uint32_t Major, uint32_t Minor) -> Vector3
    {
        const float U = 2.0f * Pi * static_cast<float>(Major % MajorSegments) / static_cast<float>(MajorSegments);
        const float V = 2.0f * Pi * static_cast<float>(Minor % MinorSegments) / static_cast<float>(MinorSegments);
        const float RingRadius = MajorRadius + MinorRadius * std::cos(V);
        return Center + Vector3{ RingRadius * std::cos(U), RingRadius * std::sin(U), MinorRadius * std::sin(V) };
    };

    for (uint32_t Major = 0u; Major < MajorSegments; ++Major)
        for (uint32_t Minor = 0u; Minor < MinorSegments; ++Minor)
            // U (around the ring) and V (around the tube) are both anticlockwise, and their cross product
            //    already points away from the tube axis — so unlike the sphere this order is correct as written.
            //    Reversing it inverts every face uniformly, which the audit reports against the nearest point on
            //    the tube's centre circle rather than the torus centre: a torus is not star-shaped about its
            //    centre, so its inner wall legitimately faces inward and a centre-based test is meaningless.
            AppendQuad(Point(Major,      Minor),
                       Point(Major + 1u, Minor),
                       Point(Major + 1u, Minor + 1u),
                       Point(Major,      Minor + 1u), MaterialIdx);
}

void RayTracingSolver::AppendPlateWithCircularHole(float MinimumX, float MinimumY, float MaximumX, float MaximumY,
                                                   float Z, const Vector3& HoleCentre, float HoleRadius,
                                                   uint32_t Segments, bool FaceDown, uint32_t MaterialIdx) noexcept
{
    if (Segments < 3u || HoleRadius <= 0.0f) return;

    constexpr float Pi = 3.14159265359f;
    const auto Rim = [&](uint32_t Segment) -> Vector3
    {
        const float Azimuth = 2.0f * Pi * static_cast<float>(Segment % Segments) / static_cast<float>(Segments);
        return Vector3{ HoleCentre.x + HoleRadius * std::cos(Azimuth),
                        HoleCentre.y + HoleRadius * std::sin(Azimuth), Z };
    };

    // Each rim vertex is joined to the point where a ray from the hole centre through it leaves the rectangle.
    //    That keeps the ring a fan of quads with no T-junctions against the border, which a naive
    //    rectangle-minus-circle would produce and which show as hairline cracks under a moving camera.
    const auto Border = [&](uint32_t Segment) -> Vector3
    {
        const float Azimuth = 2.0f * Pi * static_cast<float>(Segment % Segments) / static_cast<float>(Segments);
        const float Dx = std::cos(Azimuth), Dy = std::sin(Azimuth);
        // Distance along the ray to each of the four edges; the nearest positive one is the exit.
        float Travel = 1e30f;
        if (Dx > 1e-6f)  Travel = std::min(Travel, (MaximumX - HoleCentre.x) / Dx);
        if (Dx < -1e-6f) Travel = std::min(Travel, (MinimumX - HoleCentre.x) / Dx);
        if (Dy > 1e-6f)  Travel = std::min(Travel, (MaximumY - HoleCentre.y) / Dy);
        if (Dy < -1e-6f) Travel = std::min(Travel, (MinimumY - HoleCentre.y) / Dy);
        return Vector3{ HoleCentre.x + Dx * Travel, HoleCentre.y + Dy * Travel, Z };
    };

    for (uint32_t Segment = 0u; Segment < Segments; ++Segment)
    {
        const Vector3 InnerA = Rim(Segment),      InnerB = Rim(Segment + 1u);
        const Vector3 OuterA = Border(Segment),   OuterB = Border(Segment + 1u);
        // ⚠️ The rim advances anticlockwise seen from +Z, so (Inner, Outer, Outer, Inner) in that order gives a
        //    +Z normal. A ceiling is seen from BELOW and must face −Z, hence the swap: FaceDown takes the
        //    reversed winding. Getting this backwards leaves the ceiling lit from above and black from the room,
        //    which reads as the light being wrong rather than the geometry.
        if (FaceDown) AppendQuad(InnerA, InnerB, OuterB, OuterA, MaterialIdx);
        else          AppendQuad(InnerA, OuterA, OuterB, InnerB, MaterialIdx);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                           RAY-TRIANGLE INTERSECTION
//------------------------------------------------------------------------------------------------------------------------

HitIntersection RayTracingSolver::EvaluateIntersection(const RayStructure& Ray) const noexcept
{
    HitIntersection ClosestHit{};
    ClosestHit.RayDistance    = Ray.MaximumDistance;
    ClosestHit.ValidCondition = false;

    constexpr float Epsilon = 1e-7f;

    for (const auto& Tri : Triangles)
    {
        Vector3 Edge1 = Tri.VertexBeta - Tri.VertexAlpha;
        Vector3 Edge2 = Tri.VertexGamma - Tri.VertexAlpha;

        Vector3 PVec = OrientationClassifier::CrossProduct(Ray.RayDirection, Edge2);
        float Det = OrientationClassifier::DotProduct(Edge1, PVec);

        if (std::abs(Det) < Epsilon)
        {
            continue;
        }

        float InvDet = 1.0f / Det;
        Vector3 TVec = Ray.SpatialOrigin - Tri.VertexAlpha;
        float u = OrientationClassifier::DotProduct(TVec, PVec) * InvDet;

        if (u < 0.0f || u > 1.0f)
        {
            continue;
        }

        Vector3 QVec = OrientationClassifier::CrossProduct(TVec, Edge1);
        float v = OrientationClassifier::DotProduct(Ray.RayDirection, QVec) * InvDet;

        if (v < 0.0f || (u + v) > 1.0f)
        {
            continue;
        }

        float t = OrientationClassifier::DotProduct(Edge2, QVec) * InvDet;

        if (t >= Ray.MinimumDistance && t < ClosestHit.RayDistance)
        {
            ClosestHit.RayDistance    = t;
            ClosestHit.HitLocation    = Ray.SpatialOrigin + Ray.RayDirection * t;
            ClosestHit.SurfaceNormal  = Tri.SurfaceNormal;
            ClosestHit.MaterialIndex  = Tri.MaterialIndex;
            ClosestHit.TriangleIndex  = Tri.TriangleIndex;
            ClosestHit.ValidCondition = true;
        }
    }

    return ClosestHit;
}

bool RayTracingSolver::EvaluateOcclusion(const Vector3& PointA, const Vector3& PointB) const noexcept
{
    Vector3 Dir = PointB - PointA;
    float Distance = Dir.Length();
    if (Distance <= 1e-4f)
    {
        return false;
    }

    Vector3 UnitDir = Dir / Distance;
    RayStructure ShadowRay{ PointA + UnitDir * 1e-4f, UnitDir, 1e-4f, Distance - 1e-4f };

    constexpr float Epsilon = 1e-7f;

    for (const auto& Tri : Triangles)
    {
        // Don't let light quad occlude itself
        if (Tri.MaterialIndex == 3)
        {
            continue;
        }

        Vector3 Edge1 = Tri.VertexBeta - Tri.VertexAlpha;
        Vector3 Edge2 = Tri.VertexGamma - Tri.VertexAlpha;

        Vector3 PVec = OrientationClassifier::CrossProduct(ShadowRay.RayDirection, Edge2);
        float Det = OrientationClassifier::DotProduct(Edge1, PVec);

        if (std::abs(Det) < Epsilon)
        {
            continue;
        }

        float InvDet = 1.0f / Det;
        Vector3 TVec = ShadowRay.SpatialOrigin - Tri.VertexAlpha;
        float u = OrientationClassifier::DotProduct(TVec, PVec) * InvDet;

        if (u < 0.0f || u > 1.0f)
        {
            continue;
        }

        Vector3 QVec = OrientationClassifier::CrossProduct(TVec, Edge1);
        float v = OrientationClassifier::DotProduct(ShadowRay.RayDirection, QVec) * InvDet;

        if (v < 0.0f || (u + v) > 1.0f)
        {
            continue;
        }

        float t = OrientationClassifier::DotProduct(Edge2, QVec) * InvDet;

        if (t >= ShadowRay.MinimumDistance && t <= ShadowRay.MaximumDistance)
        {
            return true; // Occluded
        }
    }

    return false;
}

} // namespace Frontier::ProjectZero
