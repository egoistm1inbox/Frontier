/*==========================================================================================================================================
                                                         STRATUMOPERATIONREGISTRY.H
==========================================================================================================================================*/
// 🧩 The dropdown catalogue: every operation a stratum or mask may perform, described declaratively so
//    the editor inspector is generated from descriptors and new operations need no UI code.

#pragma once

#include <cstdint>
#include <cstddef>
#include <string>
#include <vector>

namespace Frontier
{

//----------------------------------------------------------------------------------------------------------------------
//                                                  OPERATION CATEGORIES
//----------------------------------------------------------------------------------------------------------------------

// Dropdown groups, in presentation order. The category also constrains where an operation may sit:
//    Mask operations may appear in mask stacks; Material operations write weights, never density.
enum class StratumOperationCategory : uint32_t
{
    Primitive, // Field sources: fractals, distance primitives, spline tubes, imports
    Combine,   // Field arithmetic and smooth CSG against named channels
    Warp,      // Domain deformation: overhang lean, noise warp, strata folding
    Mask,      // Selectors producing [0-1] masks from the field, channels, or paint
    Simulate,  // Stateful solvers: shallow water, thermal weathering, snow, water bodies
    Sculpt,    // Recorded brush strata: sculpt, carve, stamp, material paint
    Derive,    // Read-only analysis publishing named channels (flow, cavity, exposure)
    Material,  // Material weight authors: assign, blend, strata rock, texture binding
    Output     // Extraction, baking, projection, export
};

//----------------------------------------------------------------------------------------------------------------------
//                                                 PARAMETER DESCRIPTORS
//----------------------------------------------------------------------------------------------------------------------

enum class StratumParameterCategory : uint32_t
{
    Scalar,          // double, range-checked, unit-tagged
    Integer,         // int64, range-checked
    Boolean,         // toggle
    Text,            // free text (names, captions)
    NumericSequence, // flat doubles: curves, splines, profiles (interpreted by the operation)
    ChannelReference,// name of a published channel (the stack's "wire")
    MaterialReference// path into the material catalogue
};

// One inspector row, fully described. Minimum/Maximum are validation bounds, not UI slider hints:
//    ConfigureParameter refuses out-of-range writes so a document can never hold a nonsensical world.
struct StratumParameterDescriptor
{
    std::string Key;     // [-] - Stable serialisation key (TOML), never localised
    std::string Caption; // [utf8] - Inspector row caption
    StratumParameterCategory Category = StratumParameterCategory::Scalar; // [-] - Editor widget choice
    double Minimum = 0.0;         // [-] - Inclusive lower bound (Scalar/Integer)
    double Maximum = 1.0;         // [-] - Inclusive upper bound (Scalar/Integer)
    double DefaultScalar = 0.0;   // [-] - Value a fresh stratum starts with
    std::string Unit;             // [utf8] - "[m]", "[1/m]", "[deg]", "[s]" ... shown beside the field
    std::string Guidance;         // [utf8] - One-line artist guidance under the row
    bool Logarithmic = false;     // [-] - Slider travels logarithmically across [Minimum, Maximum]
};

//----------------------------------------------------------------------------------------------------------------------
//                                                 OPERATION DESCRIPTORS
//----------------------------------------------------------------------------------------------------------------------

struct StratumOperationDescriptor
{
    std::string Key;     // [-] - Stable serialisation key, e.g. "ShallowWaterErosion"
    std::string Caption; // [utf8] - Dropdown caption, e.g. "Shallow-water erosion"
    StratumOperationCategory Category = StratumOperationCategory::Primitive; // [-] - Dropdown group
    std::vector<StratumParameterDescriptor> Parameters; // [-] - Inspector rows, in order
    std::vector<std::string> InputChannels;             // [-] - Channel parameter keys this operation reads
    bool StatefulSimulation = false; // [-] - Iterates over bricks and bakes (Simulate group)
    bool Volumetric         = false; // [-] - Breaks heightfield equivalence wherever it writes
    bool MaskEligible       = false; // [-] - May appear inside a mask stack
};

//----------------------------------------------------------------------------------------------------------------------
//                                                   OPERATION REGISTRY
//----------------------------------------------------------------------------------------------------------------------

// Constructed once at editor startup by RegisterTerrainOperations (Phase 1). The panel holds a
//    const reference; documents validate against it on load, so an unknown operation key in a file
//    is a load refusal with a named diagnostic, never a silently skipped layer.
class StratumOperationRegistry
{
  public:
    bool Register(StratumOperationDescriptor Descriptor);
    [[nodiscard]] const StratumOperationDescriptor *RetrieveDescriptor(const std::string &Key) const noexcept;
    [[nodiscard]] std::vector<const StratumOperationDescriptor *> EnumerateCategory(
        StratumOperationCategory Category) const;
    [[nodiscard]] size_t QueryOperationCount() const noexcept { return Descriptors.size(); }

  private:
    std::vector<StratumOperationDescriptor> Descriptors; // [-] - Registration order = dropdown order
};

// Phase 1 registers the full catalogue (research §5.2): Primitive (ElevationProfile, FractalField3D,
//    RidgedField, BillowField, CellularField, DistancePrimitive, SplineTube, PolygonSurfaceImport,
//    HeightTextureImport, ConstantField), Combine, Warp, Mask, Simulate, Sculpt, Derive, Material,
//    and Output groups.
void RegisterTerrainOperations(StratumOperationRegistry &Registry);

} // namespace Frontier
