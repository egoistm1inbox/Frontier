/*==========================================================================================================================================
                                                          DUALCONTOUREXTRACTION.H
==========================================================================================================================================*/
// 🧩 Polygon surface extraction from the density field by Dual Contouring of Hermite data: one QEF-placed
//    vertex per sign-changing cell, so cliff edges and rock corners survive at voxel resolution.

#pragma once

#include "DensityFieldEvaluation.h"
#include <array>
#include <cstdint>
#include <vector>

namespace Frontier
{

//----------------------------------------------------------------------------------------------------------------------
//                                                   EXTRACTED SURFACE
//----------------------------------------------------------------------------------------------------------------------

// Render-ready triangles for one brick (or one streamed chunk of bricks). Material weights ride per
//    vertex from the samples the vertex's cell touched; texturing is triplanar, so no UVs exist —
//    re-extraction at any tier can never tear a texture seam because there is no unwrap to tear.
struct PolygonSurface
{
    std::vector<std::array<float, 3>> VertexPositions; // [m] - World-space vertex positions
    std::vector<std::array<float, 3>> VertexNormals;   // [-] - Normalised ∇ρ at each vertex
    std::vector<MaterialWeightEntry> VertexMaterials;  // [-] - Per-vertex material payload
    std::vector<uint32_t> TriangleIndices;             // [idx] - Three indices per triangle

    [[nodiscard]] size_t QueryVertexCount() const noexcept { return VertexPositions.size(); }
    [[nodiscard]] size_t QueryTriangleCount() const noexcept { return TriangleIndices.size() / 3; }
    [[nodiscard]] bool Empty() const noexcept { return TriangleIndices.empty(); }
};

//----------------------------------------------------------------------------------------------------------------------
//                                                EXTRACTION CONFIGURATION
//----------------------------------------------------------------------------------------------------------------------

enum class ExtractionNormalCategory : uint32_t
{
    FieldGradient, // Normals from ∇ρ (smooth rock, exact on analytic strata)
    FaceGeometric  // Normals from triangle geometry (hard-faceted stylisation)
};

struct ExtractionConfiguration
{
    double QefClampToleranceMeters = 0.0;    // [m] - Vertex may leave its cell by at most this much
    double SingularTolerance       = 1e-9;   // [-] - Below this QEF determinant, use the mass point
    uint32_t SkirtDepthCells       = 1;      // [cells] - Boundary skirt ring sealing tier transitions
    ExtractionNormalCategory Normals = ExtractionNormalCategory::FieldGradient; // [-] - Normal source
    bool WeldBoundaryVertices      = true;   // [-] - Share vertices across brick faces within a chunk
};

//----------------------------------------------------------------------------------------------------------------------
//                                                 QUADRATIC ERROR SOLVER
//----------------------------------------------------------------------------------------------------------------------

// 📝 The QEF is the sum of squared distances to the tangent planes at a cell's edge crossings.
//    Minimising it (3×3 SVD, then clamping into the cell) is the entire sharp-feature mechanism:
//    two planes meeting at a cliff edge pull the vertex onto their intersection line, where
//    Marching Cubes would have rounded it away.
class QuadraticErrorSolver
{
  public:
    // Crossings and Normals are parallel arrays of the cell's sign-changing edges (at most 12).
    //    Returns false when the system is singular; the caller then uses the crossing mass point.
    [[nodiscard]] static bool EvaluateMinimizer(const std::array<std::array<double, 3>, 12> &Crossings,
                                                const std::array<std::array<double, 3>, 12> &Normals,
                                                uint32_t CrossingCount, double SingularTolerance,
                                                std::array<double, 3> &Minimizer) noexcept;
};

//----------------------------------------------------------------------------------------------------------------------
//                                                DUAL CONTOUR EXTRACTION
//----------------------------------------------------------------------------------------------------------------------

class DualContourExtraction
{
  public:
    void ConfigureExtraction(ExtractionConfiguration Configuration) noexcept { Configuration = Configuration; }
    [[nodiscard]] const ExtractionConfiguration &QueryConfiguration() const noexcept { return Configuration; }

    // Extracts one brick. Neighbouring bricks are sampled through the evaluation (one-cell halo),
    //    so chunk interiors are crack-free by construction; the skirt ring seals tier boundaries.
    [[nodiscard]] PolygonSurface ExtractBrick(const DensityFieldEvaluation &Evaluation, uint32_t TierIndex,
                                              const BrickCoordinate &Coordinate) const;

    // Extracts an inclusive brick range as one welded surface (the streamed chunk unit).
    [[nodiscard]] PolygonSurface ExtractRegion(const DensityFieldEvaluation &Evaluation, uint32_t TierIndex,
                                               const BrickCoordinate &Minimum,
                                               const BrickCoordinate &Maximum) const;

  private:
    ExtractionConfiguration Configuration;
};

} // namespace Frontier
