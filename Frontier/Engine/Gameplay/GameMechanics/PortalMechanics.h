/*==========================================================================================================================================
                                                      PORTALMECHANICS.H
==========================================================================================================================================*/
// 🧩 Rectangular & circular portal transit mechanics: automatic exit-side duplicate mesh generation and per-object portal blocking.

#pragma once

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             INCLUDES
------------------------------------------------------------------------------------------------------------------------------------------*/
#include "Engine/Foundation/Math.h"

#include <cstdint>
#include <unordered_set>
#include <vector>

namespace Frontier
{
class SceneRenderer;
struct RtxSceneTriangle;
struct SeamlessPortalAperture;

/*------------------------------------------------------------------------------------------------------------------------------------------
                                               PORTAL TRANSIT STATE & DIAGNOSTICS
------------------------------------------------------------------------------------------------------------------------------------------*/
struct PortalObjectBodyState
{
    uint32_t ObjectId            = 0u;    // [id] - Stable gameplay object identifier
    Vec3     CentreWorld         = {};    // [m] - Authoritative rigid-body centre in world space
    Vec3     VelocityMps         = {};    // [m/s] - Linear velocity in world space
    float    BoundingRadiusM     = 0.5f;  // [m] - Bounding sphere radius for portal overlap & barrier stop
};

struct PortalSubmissionSummary
{
    bool     BlockedByFilter             = false; // [boolean] - True when ObjectId is blocked from entering portals
    bool     StraddlingAperture          = false; // [boolean] - True when object intersects the entry portal aperture
    bool     TeleportedCentroidToExit    = false; // [boolean] - True when object centroid crossed entry plane to exit
    uint32_t EntrySideTrianglesEmitted   = 0u;    // [count] - Clipped triangles registered on entry side
    uint32_t ExitDuplicateTrianglesEmitted = 0u;  // [count] - Transformed duplicate triangles registered on exit side
};

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                       PORTAL MECHANICS
------------------------------------------------------------------------------------------------------------------------------------------*/
class PortalMechanics
{
public:
    PortalMechanics() = default;

    // Per-object portal transit permission filter.
    void BlockObjectFromPortals(uint32_t ObjectId);
    void AllowObjectThroughPortals(uint32_t ObjectId) noexcept;
    void ClearBlockedObjects() noexcept;
    [[nodiscard]] bool IsObjectBlocked(uint32_t ObjectId) const noexcept;
    [[nodiscard]] std::size_t BlockedObjectCount() const noexcept { return BlockedObjectIds_.size(); }

    // Steps rigid-body motion against a portal:
    //  - If ObjectId is BLOCKED: stops & clamps the object outside the entry portal plane (zero penetration, zero teleport).
    //  - If ObjectId is ALLOWED: seamlessly teleports centroid & velocity across the portal when centroid crosses d < 0.
    PortalSubmissionSummary StepObjectAgainstPortal(
        PortalObjectBodyState&        InOutBody,
        float                         DtSeconds,
        const SeamlessPortalAperture& Portal) const noexcept;

    // Submits any arbitrary triangle mesh (box, sphere, vehicle, prop) to SceneRenderer with automatic portal handling:
    //  - If ObjectId is ALLOWED and overlaps the portal: clips entry-side mesh AND automatically emits the exact
    //    transformed duplicate mesh emerging out of the exit portal (plus dual-tier SDF proxies on both sides!).
    //  - If ObjectId is BLOCKED: emits only entry-side geometry (clamped outside the portal plane) and ZERO exit duplicate.
    PortalSubmissionSummary SubmitPortalAwareMesh(
        uint32_t                            ObjectId,
        const std::vector<RtxSceneTriangle>& WorldTriangles,
        Vec3                                BoundingCentreWorld,
        Vec3                                BoundingHalfExtents,
        const SeamlessPortalAperture&       Portal,
        SceneRenderer&                      Renderer) const;

    // Generates a smooth 3D glowing torus/ring frame mesh around a circular portal aperture (entry + exit rings).
    static void RegisterCircularPortalFrameRings(
        const SeamlessPortalAperture& Portal,
        float                         TubeRadiusMetres,
        uint32_t                      RingSegments,
        SceneRenderer&                Renderer);

private:
    std::unordered_set<uint32_t> BlockedObjectIds_{};
};

} // namespace Frontier
