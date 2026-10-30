/*==========================================================================================================================================
                                                    SOLIDFRACTUREEXTENSION.H
==========================================================================================================================================*/
// 🧩 Griffith surface-energy budgeted 3D convex polyhedron fracture (6 material presets, volume conservation, adjacency bonds).

#pragma once

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             INCLUDES
------------------------------------------------------------------------------------------------------------------------------------------*/
#include "Engine/Foundation/Math.h"

#include <cstdint>
#include <vector>

namespace Frontier
{
/*------------------------------------------------------------------------------------------------------------------------------------------
                                                 MATERIAL PRESETS & FRACTURE RECORDS
------------------------------------------------------------------------------------------------------------------------------------------*/
enum class FractureMaterialPreset : uint8_t
{
    ReinforcedConcrete   = 0u,
    NaturalGraniteStone  = 1u,
    AnisotropicWoodGrain = 2u,
    AnnealedWindowGlass  = 3u,
    TemperedSafetyGlass  = 4u,
    AutomotivePolymerAbs = 5u
};

struct FractureMaterialProperties
{
    FractureMaterialPreset Preset                 = FractureMaterialPreset::ReinforcedConcrete;
    float                  DensityKgM3            = 2350.0f; // [kg/m^3] - Bulk solid material density
    float                  ElasticThresholdJoules = 85.0f;   // [J] - Impact energy absorbed elastically with zero cracks
    float                  FractureToughnessJm2   = 140.0f;  // [J/m^2] - Griffith specific fracture energy per unit cut area
    float                  Restitution            = 0.22f;   // [0..1] - Post-fracture rigid-body bounce restitution
    float                  Friction               = 0.68f;   // [0..1] - Coulomb sliding friction of fragments
    uint32_t               MaxFragmentBudget      = 32u;     // [count] - Hard per-impact convex fragment cap
    Vec3                   WoodGrainDirection{1.0f, 0.0f, 0.0f}; // [unit] - Fibre direction for AnisotropicWoodGrain
};

[[nodiscard]] FractureMaterialProperties LookupFractureMaterialProperties(FractureMaterialPreset Preset) noexcept;

struct ConvexFragmentPolygonSurface
{
    std::vector<Vec3>     Vertices;  // [m] - Local or world vertices of closed 3D convex polyhedron
    std::vector<Vec3>     Normals;   // [unit] - Per-triangle outward facet normals
    std::vector<uint32_t> Indices;   // [indices] - Outward-wound triangle indices (3 per triangle)
};

struct ConvexSolidFragment
{
    uint32_t                     FragmentIdentifier = 0u;
    std::vector<Vec3>            HullVertices;       // [m] - Unique convex-hull corner points (for Jolt ConvexHullShape)
    ConvexFragmentPolygonSurface PolygonSurface{};   // Closed watertight triangle surface including fresh cut caps
    Vec3                         CentroidWorld{};    // [m] - Exact divergence-theorem centre of mass
    Vec3                         LinearVelocityMps{};// [m/s] - Initial post-impact impulse velocity
    Vec3                         AngularVelocityRad{};// [rad/s] - Initial post-impact spin velocity
    Vec3                         DiagonalInertiaKgM2{};// [kg*m^2] - Principal box-equivalent inertia tensor diagonal
    float                        VolumeCubicMetres = 0.0f; // [m^3] - Exact polyhedral volume
    float                        MassKilograms     = 0.0f; // [kg] - Conserved fragment mass
    bool                         AnchoredIntact    = false;// [boolean] - True when structural bond remained unbroken
};

struct FragmentAdjacencyBond
{
    uint32_t FragmentA          = 0u;    // [index] - First fragment index
    uint32_t FragmentB          = 0u;    // [index] - Second adjacent fragment index
    float    ContactAreaM2      = 0.0f;  // [m^2] - Shared internal interface area
    float    TensileStrengthPa  = 0.0f;  // [Pa] - Remaining tensile bond capacity
    bool     SeveredByImpact    = false; // [boolean] - True once shock stress exceeds TensileStrengthPa
};

struct FractureImpactDescriptor
{
    Vec3     ImpactPointWorld{};              // [m] - Contact point in world coordinates
    Vec3     ImpactDirection{1.0f, 0.0f, 0.0f}; // [unit] - Unit direction of striking body
    float    ImpactKineticEnergyJ = 2500.0f;  // [J] - Kinetic energy delivered to the target solid
    float    ImpulseNewtonSeconds = 600.0f;   // [N*s] - Momentum impulse transferred to detached fragments
    uint64_t DeterministicSeed    = 0xF4AC702EULL;
    bool     AnchoredBaseAtMinZ   = false;    // [boolean] - Keeps bottom foundation bonded unless sheared
};

struct FractureExecutionSummary
{
    bool     FractureOccurred        = false; // [boolean] - False if ImpactKineticEnergyJ <= ElasticThresholdJoules
    double   IntactVolumeM3          = 0.0;   // [m^3] - Pre-fracture solid volume
    double   SumFragmentVolumeM3     = 0.0;   // [m^3] - Sum of all output fragment volumes
    double   VolumeConservationRatio = 1.0;   // [-] - SumFragmentVolumeM3 / IntactVolumeM3 (target = 1.000000)
    double   CreatedCutSurfaceAreaM2 = 0.0;   // [m^2] - Total newly cleaved fracture surface area
    double   ConsumedFractureEnergyJ = 0.0;   // [J] - Energy spent creating new fracture faces (<= available energy)
    uint32_t DetachedFragmentCount   = 0u;    // [count] - Free ballistic fragments
    uint32_t AnchoredFragmentCount   = 0u;    // [count] - Structurally retained fragments
};

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                     SOLID FRACTURE EXTENSION
------------------------------------------------------------------------------------------------------------------------------------------*/
class SolidFracture
{
public:
    SolidFracture() = default;

    // Builds an initial intact axis-aligned box convex polyhedron centred at BoxCentreWorld with HalfExtents.
    [[nodiscard]] static ConvexSolidFragment CreateIntactBoxSolid(
        Vec3  BoxCentreWorld,
        Vec3  HalfExtentsMetres,
        float DensityKgM3 = 2350.0f);

    // Cleaves IntactSolid using Griffith energy-budgeted plane bisection tailored to Material (Voronoi, wood-grain,
    // annealed radial/concentric spiderweb, or tempered dicing) while strictly conserving 100% of 3D volume!
    FractureExecutionSummary CleaveConvexSolid(
        const ConvexSolidFragment&        IntactSolid,
        const FractureMaterialProperties& Material,
        const FractureImpactDescriptor&   Impact,
        std::vector<ConvexSolidFragment>& OutFragments,
        std::vector<FragmentAdjacencyBond>& OutAdjacencyBonds) const;
};

} // namespace Frontier
