/*==========================================================================================================================================
                                                             STRATUMSEQUENCE.H
==========================================================================================================================================*/
// 🧩 The terrain layer stack as a document: ordered strata with blend modes and mask sub-stacks — the
//    patch-cord wiring, linearised. Named channels published by earlier strata are its only cross-references.

#pragma once

#include "TerrainWorldConfiguration.h"
#include <cstdint>
#include <map>
#include <string>
#include <variant>
#include <vector>

namespace Frontier
{

//----------------------------------------------------------------------------------------------------------------------
//                                                    PARAMETER VALUES
//----------------------------------------------------------------------------------------------------------------------

// One authored parameter. Curves and polylines travel as flat numeric sequences (control points in
//    document order); channel and material references travel as names resolved against the document.
using StratumParameterValue = std::variant<double, int64_t, bool, std::string, std::vector<double>>;

//----------------------------------------------------------------------------------------------------------------------
//                                                    BLEND CATEGORIES
//----------------------------------------------------------------------------------------------------------------------

// How a stratum's candidate field combines into the running density ρ. Smooth categories take their
//    blend radius from the stratum parameters (metres), never from a compiled constant.
enum class StratumBlendCategory : uint32_t
{
    Replace,            // ρ = candidate
    Add,                // ρ = ρ + candidate
    Subtract,           // ρ = ρ − candidate
    Minimum,            // ρ = min(ρ, candidate)        (hard carve)
    Maximum,            // ρ = max(ρ, candidate)        (hard union)
    SmoothUnion,        // polynomial smooth-max          (rock welds, arch feet)
    SmoothIntersection, // polynomial smooth-min of the complements
    SmoothCarve,        // polynomial smooth-min          (cave mouths, tunnel walls)
    MaskedBlend         // ρ = lerp(ρ, candidate, mask) (warps, regional replacement)
};

//----------------------------------------------------------------------------------------------------------------------
//                                                      MASK STRATA
//----------------------------------------------------------------------------------------------------------------------

// One entry of a stratum's mask stack. Mask strata evaluate in order, each multiplying the running
//    mask; a mask stratum is itself an operation chosen from the same registry dropdown.
struct MaskStratum
{
    std::string Operation; // [-] - Registry key, e.g. "SlopeSelect"
    bool Enabled           = true;  // [-] - Bypassed masks contribute a factor of 1
    bool Inverted          = false; // [-] - Contributes (1 − mask) instead of mask
    float Strength         = 1.0f;  // [0-1] - Scales this mask's contribution
    std::map<std::string, StratumParameterValue> Parameters; // [-] - Keyed by parameter descriptor
};

//----------------------------------------------------------------------------------------------------------------------
//                                                     TERRAIN STRATA
//----------------------------------------------------------------------------------------------------------------------

// One layer of the stack. Folders are strata whose operation is "Folder": they contribute no field,
//    but their opacity and enable state govern everything enclosed beneath them.
struct TerrainStratum
{
    std::string Name;      // [utf8] - Artist-facing row caption
    std::string Operation; // [-] - Registry key, e.g. "SplineTube", "ShallowWaterErosion", "Folder"
    StratumBlendCategory Blend = StratumBlendCategory::MaskedBlend; // [-] - Field combination rule
    float Opacity              = 1.0f;  // [0-1] - Stratum strength, multiplied by the mask stack
    bool Enabled               = true;  // [-] - Bypass without deleting (the eye toggle)
    bool Locked                = false; // [-] - Refuses edits and relocation
    bool Expanded              = true;  // [-] - Inspector/row expansion memory
    int32_t EnclosureIndex     = -1;    // [idx] - Enclosing folder stratum; −1 is the stack root
    uint64_t Seed              = 0;     // [-] - Per-stratum stochastic seed (documents reproduce exactly)
    std::string PublishChannel;         // [-] - Named channel this stratum writes; empty = field only
    std::map<std::string, StratumParameterValue> Parameters; // [-] - Keyed by parameter descriptor
    std::vector<MaskStratum> Masks;     // [-] - Mask stack, evaluated in order
};

//----------------------------------------------------------------------------------------------------------------------
//                                                  INVALIDATED REGIONS
//----------------------------------------------------------------------------------------------------------------------

// The world-space footprint one edit dirties. Invalidation flows downward through the stack: a
//    stratum re-evaluates inside the union of everything above it that changed, nothing more.
struct InvalidatedRegion
{
    WorldPosition MinimumCorner; // [m] - Inclusive minimum corner
    WorldPosition MaximumCorner; // [m] - Inclusive maximum corner
    bool Empty = true;           // [-] - True until the first edit lands

    void Enclose(const WorldPosition &Position, double RadiusMeters) noexcept;
    void Enclose(const InvalidatedRegion &Other) noexcept;
    [[nodiscard]] bool IntersectsBrick(const TerrainWorldConfiguration &World, uint32_t TierIndex,
                                       const BrickCoordinate &Coordinate) const noexcept;
};

//----------------------------------------------------------------------------------------------------------------------
//                                                    STRATUM SEQUENCE
//----------------------------------------------------------------------------------------------------------------------

// The ordered document. Evaluation walks Strata front to back (top of the UI stack first); the
//    panel may present the stack in either visual order, but this sequence order is the semantics.
class StratumSequence
{
  public:
    [[nodiscard]] const std::vector<TerrainStratum> &QueryStrata() const noexcept { return Strata; }
    [[nodiscard]] size_t QueryStratumCount() const noexcept { return Strata.size(); }
    [[nodiscard]] uint64_t QueryRevision() const noexcept { return Revision; }
    [[nodiscard]] const InvalidatedRegion &QueryInvalidatedRegion() const noexcept { return Invalidated; }

    // Returns the inserted stratum index, or −1 when the operation key is unknown to the registry
    //    or the insertion point is inside a locked folder.
    int32_t InsertStratum(TerrainStratum Stratum, int32_t InsertBeforeIndex);
    bool RemoveStratum(int32_t StratumIndex);
    bool RelocateStratum(int32_t StratumIndex, int32_t InsertBeforeIndex, int32_t EnclosureIndex);

    // Parameter edits are the only supported mutation path: they validate against the operation
    //    descriptor (range, category), record the dirtied footprint, and bump the revision.
    bool ConfigureParameter(int32_t StratumIndex, const std::string &Key, StratumParameterValue Value,
                            const InvalidatedRegion &Footprint);
    void ConfigureEnabled(int32_t StratumIndex, bool Enabled, const InvalidatedRegion &Footprint);
    void ConsumeInvalidatedRegion() noexcept { Invalidated = InvalidatedRegion{}; }

  private:
    std::vector<TerrainStratum> Strata;
    InvalidatedRegion Invalidated;
    uint64_t Revision = 0; // [-] - Monotonic document revision (undo snapshots key on this)
};

} // namespace Frontier
