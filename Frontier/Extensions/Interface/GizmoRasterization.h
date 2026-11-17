/*==========================================================================================================================================
                                                            GIZMORASTERIZATION.H
==========================================================================================================================================*/
// 🧩 GizmoSpace drawn by the interface renderer: the gizmo's handle triangles projected with the view and lit as SolidArc's gizmo
//    program lights them, so a workspace without SolidArc's device (the Frontier editor) shows the same gizmo.

#pragma once

#include "Frontier/Extensions/Interface/GizmoSpace.h"

#include <imgui.h>

namespace Frontier
{

// 📝 Rasterizes Geometry over the viewport rectangle whose top-left corner is StageMin (Camera.Width × Camera.Height pixels). Lit handles take the
//    program's headlight (ambient 0.45 + diffuse 0.55 toward the eye); the opaque handles go far to near, the translucent
//    plane quads over them. Fills carry no anti-aliased fringe, so neighbouring facets meet without seams; the silhouette
//    edges get an anti-aliased stroke instead.
void RasterizeGizmo(ImDrawList* DrawList, const GizmoGeometry& Geometry, const OrbitCameraFrame& Camera, ImVec2 StageMin);

} // namespace Frontier
