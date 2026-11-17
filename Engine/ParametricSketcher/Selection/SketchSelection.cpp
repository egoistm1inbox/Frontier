/*============================================================================================================================================
                                                           SKETCHSELECTION.CPP
============================================================================================================================================*/
// 🧩 GPU pick payload translation to native persistent Parametric Sketcher body, face, edge, and gizmo references

#include "Engine/ParametricSketcher/Selection/SketchSelection.h"

namespace Frontier::ParametricSketcher
{

bool TranslateViewportPickToSketchSelection(
    const ParametricSketcherDocument&              Document,
    std::span<const uint32_t>                      BodyOrdinalsByInstanceSlot,
    std::span<const GeometrySpace::PolygonNetwork> DerivedNetworks,
    const GeometricRaster::ViewportPickHit&        PickHit,
    PersistentSketchSelection&                     OutSelection) noexcept
{
    OutSelection = {};
    if (PickHit.HitGizmo())
    {
        OutSelection.Category           = SketchSelectionCategory::GizmoHandle;
        OutSelection.GizmoHandleOrdinal = PickHit.GizmoHandleOrdinal;
        return true;
    }
    if (PickHit.InstanceSlot == 0u || PickHit.InstanceSlot > BodyOrdinalsByInstanceSlot.size())
    {
        return false;
    }

    const uint32_t BodyOrdinal = BodyOrdinalsByInstanceSlot[PickHit.InstanceSlot - 1u];
    const PrismaticBody* Body = ResolvePrismaticBody(Document, BodyOrdinal);
    if (Body == nullptr)
    {
        return false;
    }
    OutSelection.BodyOrdinal    = BodyOrdinal;
    OutSelection.ProfileOrdinal = Body->ProfileOrdinal;

    const std::size_t BodyIndex = PickHit.InstanceSlot - 1u;
    if (PickHit.FaceIndex == GeometrySpace::InvalidNetworkIndex)
    {
        OutSelection.Category = SketchSelectionCategory::PrismaticBody;
        return true;
    }
    if (BodyIndex >= DerivedNetworks.size() || PickHit.FaceIndex >= DerivedNetworks[BodyIndex].Faces.size())
    {
        OutSelection = {};
        return false;
    }

    OutSelection.DerivedFaceIndex = PickHit.FaceIndex;
    if (PickHit.DirectedEdgeIndex != GeometrySpace::InvalidNetworkIndex)
    {
        if (PickHit.DirectedEdgeIndex >= DerivedNetworks[BodyIndex].Edges.size())
        {
            OutSelection = {};
            return false;
        }
        OutSelection.Category                 = SketchSelectionCategory::BodyEdge;
        OutSelection.DerivedDirectedEdgeIndex = PickHit.DirectedEdgeIndex;
        return true;
    }

    OutSelection.Category = SketchSelectionCategory::BodyFace;
    return true;
}

} // namespace Frontier::ParametricSketcher
