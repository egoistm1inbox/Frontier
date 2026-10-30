/*==========================================================================================================================================
                                                     PORTALMECHANICS.CPP
==========================================================================================================================================*/
// 🧩 Rectangular & circular portal transit mechanics: automatic exit-side duplicate mesh generation and per-object portal blocking.

#include "Engine/Gameplay/GameMechanics/PortalMechanics.h"
#include "Engine/Rendering/SceneRenderer.h"

#include <algorithm>
#include <cmath>

namespace Frontier
{
namespace
{
constexpr float TwoPiVal = 6.28318530717958647692f;

[[nodiscard]] bool PointWithinApertureSpan(
    Vec3                          PointWorld,
    Vec3                          CentreWorld,
    Vec3                          RightAxis,
    Vec3                          UpAxis,
    const SeamlessPortalAperture& Portal,
    float                         MarginMetres) noexcept
{
    const Vec3  Rel = PointWorld - CentreWorld;
    const float U   = Dot(Rel, RightAxis);
    const float V   = Dot(Rel, UpAxis);
    if (Portal.Shape == PortalApertureShape::Circular)
    {
        const float Rx = std::max(0.05f, Portal.RadiusMetres + MarginMetres);
        return (U * U + V * V) <= (Rx * Rx);
    }
    return std::abs(U) <= (Portal.HalfWidthMetres + MarginMetres) &&
           std::abs(V) <= (Portal.HalfHeightMetres + MarginMetres);
}

void EmitTorusRingOnAperture(
    Vec3           CentreWorld,
    Vec3           RightAxis,
    Vec3           UpAxis,
    Vec3           FrontNormal,
    float          MajorRadiusM,
    float          MinorRadiusM,
    uint32_t       MajorSegments,
    Vec3           RingAlbedo,
    Vec3           RingEmissive,
    SceneRenderer& Renderer)
{
    const uint32_t Segs = std::max(16u, MajorSegments);
    constexpr uint32_t TubeSegs = 10u;

    auto EvalRingPoint = [&](float Theta, float Phi, Vec3& OutNormal) noexcept -> Vec3
    {
        const Vec3 RadialDir = RightAxis * std::cos(Theta) + UpAxis * std::sin(Theta);
        OutNormal = Normalise(RadialDir * std::cos(Phi) + FrontNormal * std::sin(Phi));
        return CentreWorld + RadialDir * (MajorRadiusM + MinorRadiusM * std::cos(Phi)) + FrontNormal * (MinorRadiusM * std::sin(Phi));
    };

    for (uint32_t I = 0u; I < Segs; ++I)
    {
        const float T0 = TwoPiVal * static_cast<float>(I) / static_cast<float>(Segs);
        const float T1 = TwoPiVal * static_cast<float>(I + 1u) / static_cast<float>(Segs);
        for (uint32_t J = 0u; J < TubeSegs; ++J)
        {
            const float P0 = TwoPiVal * static_cast<float>(J) / static_cast<float>(TubeSegs);
            const float P1 = TwoPiVal * static_cast<float>(J + 1u) / static_cast<float>(TubeSegs);

            Vec3 N00{}, N10{}, N11{}, N01{};
            const Vec3 V00 = EvalRingPoint(T0, P0, N00);
            const Vec3 V10 = EvalRingPoint(T1, P0, N10);
            const Vec3 V11 = EvalRingPoint(T1, P1, N11);
            const Vec3 V01 = EvalRingPoint(T0, P1, N01);

            RtxSceneTriangle TriA{};
            TriA.V0                  = V00;
            TriA.V1                  = V10;
            TriA.V2                  = V11;
            TriA.Normal              = Normalise(Cross(V10 - V00, V11 - V00));
            TriA.V0Normal            = N00;
            TriA.V1Normal            = N10;
            TriA.V2Normal            = N11;
            TriA.SmoothVertexNormals = true;
            TriA.AlbedoRgb           = RingAlbedo;
            TriA.EmissiveRgb         = RingEmissive;
            TriA.Roughness           = 0.18f;
            TriA.Metallic            = 0.75f;
            Renderer.RegisterPolygonTriangle(TriA);

            RtxSceneTriangle TriB    = TriA;
            TriB.V0                  = V00;
            TriB.V1                  = V11;
            TriB.V2                  = V01;
            TriB.Normal              = Normalise(Cross(V11 - V00, V01 - V00));
            TriB.V0Normal            = N00;
            TriB.V1Normal            = N11;
            TriB.V2Normal            = N01;
            Renderer.RegisterPolygonTriangle(TriB);
        }
    }
}

} // namespace

void PortalMechanics::BlockObjectFromPortals(uint32_t ObjectId)
{
    BlockedObjectIds_.insert(ObjectId);
}

void PortalMechanics::AllowObjectThroughPortals(uint32_t ObjectId) noexcept
{
    BlockedObjectIds_.erase(ObjectId);
}

void PortalMechanics::ClearBlockedObjects() noexcept
{
    BlockedObjectIds_.clear();
}

bool PortalMechanics::IsObjectBlocked(uint32_t ObjectId) const noexcept
{
    return BlockedObjectIds_.find(ObjectId) != BlockedObjectIds_.end();
}

PortalSubmissionSummary PortalMechanics::StepObjectAgainstPortal(
    PortalObjectBodyState&        InOutBody,
    float                         DtSeconds,
    const SeamlessPortalAperture& Portal) const noexcept
{
    PortalSubmissionSummary Summary{};
    Summary.BlockedByFilter = IsObjectBlocked(InOutBody.ObjectId);

    const Vec3 PrevPos = InOutBody.CentreWorld;
    const Vec3 NextPos = PrevPos + InOutBody.VelocityMps * DtSeconds;

    const Vec3 EntryN = Normalise(Portal.EntryFrontNormal);
    const float PrevDist = Dot(PrevPos - Portal.EntryCentreWorld, EntryN);
    const float NextDist = Dot(NextPos - Portal.EntryCentreWorld, EntryN);
    const bool  OverlapsSpan = PointWithinApertureSpan(
        NextPos, Portal.EntryCentreWorld, Normalise(Portal.EntryRightAxis), Normalise(Portal.EntryUpAxis), Portal, InOutBody.BoundingRadiusM);

    if (!OverlapsSpan)
    {
        InOutBody.CentreWorld = NextPos;
        return Summary;
    }

    if (Summary.BlockedByFilter)
    {
        // Blocked object: clamp firmly outside portal barrier plane and cancel inward normal velocity!
        const float SafeStopDist = std::max(0.02f, InOutBody.BoundingRadiusM);
        if (PrevDist >= 0.0f && NextDist < SafeStopDist)
        {
            InOutBody.CentreWorld = NextPos + EntryN * (SafeStopDist - NextDist);
            const float InwardVn  = Dot(InOutBody.VelocityMps, EntryN);
            if (InwardVn < 0.0f)
            {
                InOutBody.VelocityMps = InOutBody.VelocityMps - EntryN * (1.25f * InwardVn);
            }
            return Summary;
        }
        InOutBody.CentreWorld = NextPos;
        return Summary;
    }

    // Permitted object: check whether centroid crossed from front (d >= 0) to behind (d < 0)
    if (PrevDist >= 0.0f && NextDist < 0.0f)
    {
        InOutBody.CentreWorld          = SceneRenderer::TransformPointAcrossPortal(Portal, NextPos);
        InOutBody.VelocityMps          = SceneRenderer::TransformVectorAcrossPortal(Portal, InOutBody.VelocityMps);
        Summary.TeleportedCentroidToExit = true;
        Summary.StraddlingAperture       = ( std::abs(NextDist) < InOutBody.BoundingRadiusM );
        return Summary;
    }

    InOutBody.CentreWorld      = NextPos;
    Summary.StraddlingAperture = (std::abs(NextDist) < InOutBody.BoundingRadiusM);
    return Summary;
}

PortalSubmissionSummary PortalMechanics::SubmitPortalAwareMesh(
    uint32_t                             ObjectId,
    const std::vector<RtxSceneTriangle>& WorldTriangles,
    Vec3                                 BoundingCentreWorld,
    Vec3                                 BoundingHalfExtents,
    const SeamlessPortalAperture&        Portal,
    SceneRenderer&                       Renderer) const
{
    PortalSubmissionSummary Summary{};
    Summary.BlockedByFilter = IsObjectBlocked(ObjectId);

    const Vec3  EntryN      = Normalise(Portal.EntryFrontNormal);
    const Vec3  EntryR      = Normalise(Portal.EntryRightAxis);
    const Vec3  EntryU      = Normalise(Portal.EntryUpAxis);
    const float BoundRadius = Length(BoundingHalfExtents);
    const float SignedDist  = Dot(BoundingCentreWorld - Portal.EntryCentreWorld, EntryN);
    const bool  NearSpan    = PointWithinApertureSpan(
        BoundingCentreWorld, Portal.EntryCentreWorld, EntryR, EntryU, Portal, BoundRadius);

    // If blocked: push mesh cleanly outside the entry portal plane if it tried to intrude, and NEVER emit an exit duplicate!
    if (Summary.BlockedByFilter)
    {
        Vec3 PushOffset{0.0f, 0.0f, 0.0f};
        float MinVertexSignedDist = 1.0e9f;
        if (NearSpan && SignedDist >= -BoundRadius)
        {
            for (const RtxSceneTriangle& Tri : WorldTriangles)
            {
                MinVertexSignedDist = std::min(MinVertexSignedDist, Dot(Tri.V0 - Portal.EntryCentreWorld, EntryN));
                MinVertexSignedDist = std::min(MinVertexSignedDist, Dot(Tri.V1 - Portal.EntryCentreWorld, EntryN));
                MinVertexSignedDist = std::min(MinVertexSignedDist, Dot(Tri.V2 - Portal.EntryCentreWorld, EntryN));
            }
            if (MinVertexSignedDist < 0.015f)
            {
                PushOffset = EntryN * (0.015f - MinVertexSignedDist);
            }
        }

        for (const RtxSceneTriangle& Src : WorldTriangles)
        {
            RtxSceneTriangle Adjusted = Src;
            Adjusted.V0               = Src.V0 + PushOffset;
            Adjusted.V1               = Src.V1 + PushOffset;
            Adjusted.V2               = Src.V2 + PushOffset;
            Renderer.RegisterPolygonTriangle(Adjusted);
            ++Summary.EntrySideTrianglesEmitted;
        }
        return Summary;
    }

    // If completely far from the portal aperture, submit directly on its native side.
    if (!NearSpan || SignedDist > BoundRadius + 0.05f || SignedDist < -(BoundRadius + 0.05f))
    {
        for (const RtxSceneTriangle& Src : WorldTriangles)
        {
            Renderer.RegisterPolygonTriangle(Src);
            ++Summary.EntrySideTrianglesEmitted;
        }
        return Summary;
    }

    // Permitted object straddling the portal aperture:
    //  1) Clip every triangle against Entry plane -> Entry-side visible half!
    //  2) Transform every triangle across Portal & clip against Exit plane -> Automatic emerging Exit-side duplicate!
    Summary.StraddlingAperture = true;
    const uint32_t BeforeCount = Renderer.TriangleCount();
    for (const RtxSceneTriangle& Src : WorldTriangles)
    {
        uint32_t EntryEmitted = 0u;
        uint32_t ExitEmitted  = 0u;
        Renderer.RegisterPortalTransitingTriangleCounted(Src, Portal, EntryEmitted, ExitEmitted);
        Summary.EntrySideTrianglesEmitted     += EntryEmitted;
        Summary.ExitDuplicateTrianglesEmitted += ExitEmitted;
    }
    (void)BeforeCount;

    // Also register clipped SDF + SurfaceCard proxy boxes on BOTH entry and exit sides so GTX SDF GI illuminates both halves!
    if (Summary.ExitDuplicateTrianglesEmitted > 0u && !WorldTriangles.empty())
    {
        const Vec3 Albedo = WorldTriangles.front().AlbedoRgb;
        const float Rough = WorldTriangles.front().Roughness;
        const Vec3 ExitCentre = SceneRenderer::TransformPointAcrossPortal(Portal, BoundingCentreWorld);
        const Vec3 ExitN      = Normalise(Portal.ExitFrontNormal);
        const float EntryFrontReach = std::max(0.08f, SignedDist + 0.5f * BoundRadius);
        const float ExitFrontReach  = std::max(0.08f, 0.5f * BoundRadius - SignedDist);

        Renderer.RegisterSdfOnlyCardProxyBox(
            Portal.EntryCentreWorld + EntryN * (0.5f * EntryFrontReach) +
                EntryR * Dot(BoundingCentreWorld - Portal.EntryCentreWorld, EntryR) +
                EntryU * Dot(BoundingCentreWorld - Portal.EntryCentreWorld, EntryU),
            Vec3{std::min(BoundingHalfExtents.X, 0.65f), std::min(BoundingHalfExtents.Y, 0.65f), std::min(BoundingHalfExtents.Z, 0.65f)},
            Albedo,
            Rough);

        const Vec3 ExitR = Normalise(Portal.ExitRightAxis);
        const Vec3 ExitU = Normalise(Portal.ExitUpAxis);
        Renderer.RegisterSdfOnlyCardProxyBox(
            Portal.ExitCentreWorld + ExitN * (0.5f * ExitFrontReach) +
                ExitR * Dot(ExitCentre - Portal.ExitCentreWorld, ExitR) +
                ExitU * Dot(ExitCentre - Portal.ExitCentreWorld, ExitU),
            Vec3{std::min(BoundingHalfExtents.X, 0.65f), std::min(BoundingHalfExtents.Y, 0.65f), std::min(BoundingHalfExtents.Z, 0.65f)},
            Albedo,
            Rough);
    }

    return Summary;
}

void PortalMechanics::RegisterCircularPortalFrameRings(
    const SeamlessPortalAperture& Portal,
    float                         TubeRadiusMetres,
    uint32_t                      RingSegments,
    SceneRenderer&                Renderer)
{
    const float Radius = (Portal.Shape == PortalApertureShape::Circular && Portal.RadiusMetres > 0.05f)
        ? Portal.RadiusMetres
        : std::min(Portal.HalfWidthMetres, Portal.HalfHeightMetres);
    const Vec3 BaseMetal{0.14f, 0.17f, 0.22f};
    const Vec3 EntryGlow = Portal.PortalRimGlowRgb * 1.65f;
    const Vec3 ExitGlow  = (Length(Portal.ExitRimGlowRgb) > 0.01f) ? (Portal.ExitRimGlowRgb * 1.65f) : EntryGlow;

    EmitTorusRingOnAperture(
        Portal.EntryCentreWorld,
        Normalise(Portal.EntryRightAxis),
        Normalise(Portal.EntryUpAxis),
        Normalise(Portal.EntryFrontNormal),
        Radius + TubeRadiusMetres * 0.72f,
        TubeRadiusMetres,
        RingSegments,
        BaseMetal,
        EntryGlow,
        Renderer);

    EmitTorusRingOnAperture(
        Portal.ExitCentreWorld,
        Normalise(Portal.ExitRightAxis),
        Normalise(Portal.ExitUpAxis),
        Normalise(Portal.ExitFrontNormal),
        Radius + TubeRadiusMetres * 0.72f,
        TubeRadiusMetres,
        RingSegments,
        BaseMetal,
        ExitGlow,
        Renderer);
}

} // namespace Frontier
