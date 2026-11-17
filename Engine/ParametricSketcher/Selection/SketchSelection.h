/*============================================================================================================================================
                                                            SKETCHSELECTION.H
============================================================================================================================================*/
// 🧩 Persistent Parametric Sketcher selection references plus translation from Frontier GPU viewport pick payloads

#pragma once

#include "Engine/GeometricRaster/Picking/ViewportPickQuery.h"
#include "Engine/ParametricSketcher/ParametricSketcherDocument.h"

#include <cstdint>
#include <span>

namespace Frontier::ParametricSketcher
{

enum class SketchSelectionCategory : uint8_t
{
    None         = 0u,
    SketchProfile = 1u,
    PrismaticBody = 2u,
    BodyFace      = 3u,
    BodyEdge      = 4u,
    GizmoHandle   = 5u,
};

struct PersistentSketchSelection
{
    SketchSelectionCategory Category              = SketchSelectionCategory::None;
    uint32_t                ProfileOrdinal        = InvalidSketchOrdinal;
    uint32_t                BodyOrdinal           = InvalidSketchOrdinal;
    uint32_t                DerivedFaceIndex      = GeometrySpace::InvalidNetworkIndex;
    uint32_t                DerivedDirectedEdgeIndex = GeometrySpace::InvalidNetworkIndex;
    uint32_t                GizmoHandleOrdinal    = 0u;
};

[[nodiscard]] bool TranslateViewportPickToSketchSelection(
    const ParametricSketcherDocument&             Document,
    std::span<const uint32_t>                     BodyOrdinalsByInstanceSlot,
    std::span<const GeometrySpace::PolygonNetwork> DerivedNetworks,
    const GeometricRaster::ViewportPickHit&       PickHit,
    PersistentSketchSelection&                    OutSelection) noexcept;

} // namespace Frontier::ParametricSketcher
