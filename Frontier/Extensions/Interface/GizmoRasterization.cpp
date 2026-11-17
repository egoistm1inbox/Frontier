/*==========================================================================================================================================
                                                           GIZMORASTERIZATION.CPP
==========================================================================================================================================*/
// 🧩 The gizmo's triangles on an ImGui draw list: projection, the program's headlight, painter's order and silhouette strokes.

#include "Frontier/Extensions/Interface/GizmoRasterization.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <map>
#include <tuple>
#include <vector>

namespace Frontier
{

namespace
{

struct ProjectedCorner
{
    ImVec2 Screen{};
    double Depth = 0.0;   // [-] clip depth after the divide, 0 near … 1 far
    bool   Valid = false;
};

struct ProjectedTriangle
{
    ProjectedCorner Corners[3];
    ImU32           Ink         = 0;
    double          Depth       = 0.0;      // [-] mean of the corners
    float           Winding     = 0.0f;     // [px²] signed screen area: the side of the triangle facing the eye
    bool            Translucent = false;
    uint32_t        First       = 0;        // [-] first vertex in the geometry
};

ProjectedCorner ProjectCorner(const OrbitCameraFrame& Camera, const GizmoVertex& Vertex, ImVec2 StageMin)
{
    ProjectedCorner Corner;
    double          Clip[4] = {};
    for (int Row = 0; Row < 4; ++Row)
        Clip[Row] = Camera.ClipFromWorld[0 * 4 + Row] * Vertex.Position[0] + Camera.ClipFromWorld[1 * 4 + Row] * Vertex.Position[1] +
                    Camera.ClipFromWorld[2 * 4 + Row] * Vertex.Position[2] + Camera.ClipFromWorld[3 * 4 + Row];
    if (Clip[3] <= 1.0e-9) return Corner;
    Corner.Screen = ImVec2(StageMin.x + static_cast<float>((Clip[0] / Clip[3] * 0.5 + 0.5) * Camera.Width),
                           StageMin.y + static_cast<float>((Clip[1] / Clip[3] * 0.5 + 0.5) * Camera.Height));
    Corner.Depth  = Clip[2] / Clip[3];
    Corner.Valid  = true;
    return Corner;
}

// 📝 SolidArcGizmo.slang's fragment program: Colour · (0.45 + 0.55 · |N · −Forward|) when lit, the flat colour otherwise.
ImU32 ShadeVertex(const OrbitCameraFrame& Camera, const GizmoVertex& Vertex)
{
    double     Channels[3] = { static_cast<double>(Vertex.Colour & 0xffu), static_cast<double>((Vertex.Colour >> 8) & 0xffu),
                               static_cast<double>((Vertex.Colour >> 16) & 0xffu) };
    const auto Alpha       = static_cast<uint32_t>((Vertex.Colour >> 24) & 0xffu);
    const double Size      = Vertex.Normal[0] * Vertex.Normal[0] + Vertex.Normal[1] * Vertex.Normal[1] + Vertex.Normal[2] * Vertex.Normal[2];
    if (Size > 1.0e-6)
    {
        const double Facing = std::abs(Vertex.Normal[0] * Camera.Forward[0] + Vertex.Normal[1] * Camera.Forward[1] + Vertex.Normal[2] * Camera.Forward[2]) /
                              std::sqrt(Size);
        for (double& Channel : Channels) Channel *= 0.45 + 0.55 * Facing;
    }
    const auto Byte = [](double Value) { return static_cast<uint32_t>(std::clamp(std::lround(Value), 0L, 255L)); };
    return IM_COL32(Byte(Channels[0]), Byte(Channels[1]), Byte(Channels[2]), Alpha);
}

// 📝 One corner's identity for edge matching: its world position bits and the owning handle (facets of different handles never
//    merge into one surface).
using CornerKey = std::tuple<uint32_t, uint32_t, uint32_t, uint32_t>;

CornerKey KeyCorner(const GizmoVertex& Vertex)
{
    uint32_t Bits[3] = {};
    std::memcpy(Bits, Vertex.Position, sizeof(Bits));
    return { Bits[0], Bits[1], Bits[2], Vertex.Handle };
}

} // namespace

void RasterizeGizmo(ImDrawList* DrawList, const GizmoGeometry& Geometry, const OrbitCameraFrame& Camera, ImVec2 StageMin)
{
    if (DrawList == nullptr || Geometry.Vertices.size() < 3) return;

    // ① project and shade every triangle (all three corners in front of the eye)
    std::vector<ProjectedTriangle> Triangles;
    Triangles.reserve(Geometry.Vertices.size() / 3);
    for (uint32_t First = 0; First + 2 < Geometry.Vertices.size(); First += 3)
    {
        ProjectedTriangle Triangle;
        bool              Valid = true;
        for (uint32_t Corner = 0; Corner < 3; ++Corner)
        {
            Triangle.Corners[Corner] = ProjectCorner(Camera, Geometry.Vertices[First + Corner], StageMin);
            Valid                    = Valid && Triangle.Corners[Corner].Valid;
        }
        if (!Valid) continue;
        const ImVec2 A = Triangle.Corners[0].Screen, B = Triangle.Corners[1].Screen, C = Triangle.Corners[2].Screen;
        Triangle.Winding     = (B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y);
        Triangle.Ink         = ShadeVertex(Camera, Geometry.Vertices[First]);
        Triangle.Depth       = (Triangle.Corners[0].Depth + Triangle.Corners[1].Depth + Triangle.Corners[2].Depth) / 3.0;
        Triangle.Translucent = First >= Geometry.OpaqueCount;
        Triangle.First       = First;
        Triangles.push_back(Triangle);
    }

    // ② silhouette edges: an edge one facet owns alone, or one between a facet facing the eye and one facing away
    struct EdgeUse
    {
        int   Count      = 0;
        float Winding[2] = {};
    };
    std::map<std::pair<CornerKey, CornerKey>, EdgeUse> Edges;
    const auto KeyEdge = [&](uint32_t From, uint32_t To)
    {
        CornerKey Start = KeyCorner(Geometry.Vertices[From]), End = KeyCorner(Geometry.Vertices[To]);
        if (End < Start) std::swap(Start, End);
        return std::make_pair(Start, End);
    };
    for (const ProjectedTriangle& Triangle : Triangles)
        for (uint32_t Side = 0; Side < 3; ++Side)
        {
            EdgeUse& Use = Edges[KeyEdge(Triangle.First + Side, Triangle.First + (Side + 1) % 3)];
            if (Use.Count < 2) Use.Winding[Use.Count] = Triangle.Winding;
            ++Use.Count;
        }

    // ③ painter's order: opaque far → near, then the translucent quads far → near
    std::stable_sort(Triangles.begin(), Triangles.end(), [](const ProjectedTriangle& Left, const ProjectedTriangle& Right)
                     {
                         if (Left.Translucent != Right.Translucent) return !Left.Translucent;
                         return Left.Depth > Right.Depth;
                     });
    const ImDrawListFlags Flags = DrawList->Flags;
    for (const ProjectedTriangle& Triangle : Triangles)
    {
        DrawList->Flags = Flags & ~ImDrawListFlags_AntiAliasedFill;
        DrawList->AddTriangleFilled(Triangle.Corners[0].Screen, Triangle.Corners[1].Screen, Triangle.Corners[2].Screen, Triangle.Ink);
        DrawList->Flags = Flags;
        if (Triangle.Translucent) continue;
        for (uint32_t Side = 0; Side < 3; ++Side)
        {
            const EdgeUse& Use = Edges[KeyEdge(Triangle.First + Side, Triangle.First + (Side + 1) % 3)];
            const bool Silhouette = Use.Count == 1 || (Use.Count == 2 && (Use.Winding[0] > 0.0f) != (Use.Winding[1] > 0.0f));
            if (Silhouette)
                DrawList->AddLine(Triangle.Corners[Side].Screen, Triangle.Corners[(Side + 1) % 3].Screen, Triangle.Ink, 1.0f);
        }
    }
}

} // namespace Frontier
