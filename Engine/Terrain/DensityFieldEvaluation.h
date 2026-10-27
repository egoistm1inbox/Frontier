/*==========================================================================================================================================
                                                          DENSITYFIELDEVALUATION.H
==========================================================================================================================================*/
// 🧩 Evaluation of the composed density field: walks the stratum sequence analytically or through baked
//    bricks, resolves named channels, and supplies the gradients extraction and erosion consume.

#pragma once

#include "DensityBrickAtlas.h"
#include "StratumSequence.h"
#include <array>
#include <cstdint>
#include <map>
#include <string>
#include <vector>

namespace Frontier
{

//----------------------------------------------------------------------------------------------------------------------
//                                                     FIELD CHANNELS
//----------------------------------------------------------------------------------------------------------------------

// 💡 Named channels are the stack's wires. A stratum publishes under a name; later strata pick that
//    name from a dropdown wherever a field or mask input is expected. Channels are typed so a water
//    surface can never be wired into a density input by accident.
enum class FieldChannelCategory : uint32_t
{
    ScalarField2D,   // One value per (x, z): height profiles, flow accumulation, wear
    ScalarField3D,   // One value per (x, y, z): published densities, occlusion, strata coordinate
    VectorField3D,   // Flow velocity, warp offsets
    MaterialWeights, // Per-sample material payload (see MaterialWeightEntry)
    WaterSurface     // Equilibrium water: surface elevation + depth + discharge per column
};

struct FieldChannelIndex
{
    int32_t Index = -1; // [idx] - Slot in the channel atlas; −1 is unresolved
    [[nodiscard]] bool Resolved() const noexcept { return Index >= 0; }
};

struct FieldChannelEntry
{
    std::string Name; // [utf8] - Artist-chosen publish name ("Flow", "MineField", ...)
    FieldChannelCategory Category = FieldChannelCategory::ScalarField3D; // [-] - Wire type
    uint64_t Revision             = 0;  // [-] - Bumped whenever the publishing stratum re-evaluates
    int32_t PublishingStratum     = -1; // [idx] - Stratum that owns this channel's storage
};

class FieldChannelAtlas
{
  public:
    [[nodiscard]] FieldChannelIndex ResolveChannel(const std::string &Name) const noexcept;
    [[nodiscard]] const FieldChannelEntry *QueryChannel(FieldChannelIndex Index) const noexcept;
    FieldChannelIndex PublishChannel(FieldChannelEntry Entry);
    void InvalidateFromStratum(int32_t StratumIndex) noexcept; // downstream channels go stale together
    [[nodiscard]] const std::vector<FieldChannelEntry> &QueryChannels() const noexcept { return Entries; }

  private:
    std::vector<FieldChannelEntry> Entries;
    std::map<std::string, int32_t> IndexByName;
};

//----------------------------------------------------------------------------------------------------------------------
//                                                   DENSITY EVALUATION
//----------------------------------------------------------------------------------------------------------------------

// The composed sample: density plus its gradient. The gradient is the surface normal estimate Dual
//    Contouring minimises against, and the direction erosion writes Δρ along.
struct DensityEvaluationResult
{
    double ρ = -1.0;                        // [m] - Signed density at the sample position
    std::array<double, 3> Gradient{0, 1, 0}; // [-] - ∇ρ, not normalised (magnitude carries slope)
    MaterialWeightEntry Material;            // [-] - Composed material payload at the sample
};

// Owns the atlases (one per tier) and evaluates the document against them. Analytic strata are pure
//    functions of (position, channels, configuration); simulation strata read and write bricks.
class DensityFieldEvaluation
{
  public:
    void ConfigureDocument(const TerrainWorldConfiguration &World, const StratumSequence &Sequence);
    [[nodiscard]] FieldChannelAtlas &QueryChannels() noexcept { return Channels; }
    [[nodiscard]] DensityBrickAtlas &QueryAtlas(uint32_t TierIndex) noexcept { return Atlases[TierIndex]; }

    // Full analytic composition of every stratum at one position. Used for hero insets, picking,
    //    and validation; bulk extraction goes through EvaluateBrick to share stratum temporaries.
    [[nodiscard]] DensityEvaluationResult EvaluateDensity(const WorldPosition &Position,
                                                          uint32_t TierIndex) const;

    // Evaluates one brick's samples into the atlas, honouring brick categories: constant and
    //    heightfield-equivalent results collapse instead of allocating dense storage.
    void EvaluateBrick(uint32_t TierIndex, const BrickCoordinate &Coordinate);

    // Evaluates only bricks intersecting the sequence's invalidated region, then consumes it.
    //    Returns the number of bricks touched (the editor's "rebuild cost" readout).
    uint32_t EvaluateInvalidated(StratumSequence &Sequence);

    [[nodiscard]] float EvaluateChannelScalar(FieldChannelIndex Channel,
                                              const WorldPosition &Position) const noexcept;
    [[nodiscard]] uint64_t QueryRevision() const noexcept { return Revision; }

  private:
    TerrainWorldConfiguration World;
    std::vector<DensityBrickAtlas> Atlases; // [-] - One per tier, coarsest first
    FieldChannelAtlas Channels;
    uint64_t Revision = 0; // [-] - Bumped by every Evaluate* that changed a sample
};

} // namespace Frontier
