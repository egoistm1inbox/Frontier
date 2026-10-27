/*==========================================================================================================================================
                                                            DENSITYBRICKATLAS.H
==========================================================================================================================================*/
// 🧩 Sparse narrow-band storage for the terrain density field ρ(x, y, z): 32³ bricks addressed by a hash
//    directory, so memory scales with surface area (like a heightfield), never with world volume.

#pragma once

#include "TerrainWorldConfiguration.h"
#include <cstdint>
#include <unordered_map>
#include <vector>

namespace Frontier
{

//----------------------------------------------------------------------------------------------------------------------
//                                                     SAMPLE PAYLOAD
//----------------------------------------------------------------------------------------------------------------------

// Material identity carried by the field itself, so cave walls and cliff faces own their rock instead
//    of inheriting a top-down projection. Two materials + blend per sample; chunk-level weight sets
//    (up to eight materials) are resolved at extraction from the samples a vertex touches.
struct MaterialWeightEntry
{
    uint16_t LeadingMaterial  = 0; // [idx] - Index into the document material set
    uint16_t TrailingMaterial = 0; // [idx] - Second material, blended by Blend
    uint8_t  Blend            = 0; // [0-255] - Trailing material weight (0 = pure leading)
    uint8_t  Reserved         = 0; // [-] - Alignment; zero in schema 1
};

// One stored field sample inside a narrow-band brick.
struct DensitySample
{
    float ρ = -1.0f; // [m] - Signed density: ρ > 0 solid, ρ < 0 air, ρ = 0 on the surface
    MaterialWeightEntry Material; // [-] - Surface material payload (meaningful near ρ = 0)
};

//----------------------------------------------------------------------------------------------------------------------
//                                                    BRICK CATEGORIES
//----------------------------------------------------------------------------------------------------------------------

// 💡 The category is the compression. Open sky and deep rock are single tile values; only bricks the
//    surface actually passes through pay for dense samples, and untouched analytic regions re-evaluate
//    the stratum sequence on demand instead of storing anything at all.
enum class DensityBrickCategory : uint32_t
{
    ConstantAir,   // ρ < 0 everywhere in the brick (open sky, cave interior far from walls)
    ConstantSolid, // ρ > 0 everywhere in the brick (deep rock)
    NarrowBand,    // Surface crosses the brick; dense samples are stored
    Analytic       // No baked samples; evaluate the stratum sequence on demand
};

struct DensityBrick
{
    DensityBrickCategory Category = DensityBrickCategory::Analytic; // [-] - Storage form of this brick
    float Constantρ               = -1.0f; // [m] - Tile value for the constant categories
    bool HeightfieldEquivalent    = false; // [-] - ρ(x,y,z) = H(x,z) − y exactly; fast 2.5D path is legal
    uint64_t Revision             = 0;     // [-] - Bumped on every write; extraction invalidates on change
    std::vector<DensitySample> Samples;    // [-] - BrickExtentCells³ entries when Category = NarrowBand
    std::vector<float> HeightProfile;      // [m] - BrickExtentCells² entries when HeightfieldEquivalent
};

//----------------------------------------------------------------------------------------------------------------------
//                                                      BRICK ATLAS
//----------------------------------------------------------------------------------------------------------------------

// The field store for one resolution tier. One atlas instance exists per tier of the world
//    configuration; the whole-world tier is always resident, finer tiers stream inside their rings.
class DensityBrickAtlas
{
  public:
    // 📝 Configuration is taken by value: an atlas never observes a world edit half-applied.
    void ConfigureWorld(TerrainWorldConfiguration Configuration, uint32_t TierIndex) noexcept;
    [[nodiscard]] const TerrainWorldConfiguration &QueryWorldConfiguration() const noexcept { return World; }
    [[nodiscard]] uint32_t QueryTierIndex() const noexcept { return Tier; }

    [[nodiscard]] BrickCoordinate ResolveBrickCoordinate(const WorldPosition &Position) const noexcept;
    [[nodiscard]] const DensityBrick *QueryBrick(const BrickCoordinate &Coordinate) const noexcept;
    [[nodiscard]] DensityBrick &RetrieveOrConstructBrick(const BrickCoordinate &Coordinate);

    // 📝 Trilinear density at an arbitrary position. Constant and analytic bricks short-circuit;
    //    analytic bricks recurse into DensityFieldEvaluation, which is why evaluation owns the atlas
    //    (never the reverse) — the dependency arrow points one way only.
    [[nodiscard]] float RetrieveDensityTrilinear(const WorldPosition &Position) const noexcept;
    [[nodiscard]] std::array<float, 3> RetrieveGradient(const WorldPosition &Position) const noexcept;

    // Writes one sample, promoting the brick to NarrowBand when required. Returns false when the
    //    position falls outside the world extent (refusal, never clamping into a neighbour's land).
    bool IntegrateSample(const WorldPosition &CellCentre, const DensitySample &Sample) noexcept;

    // Rebuilds brick categories after a bulk write (erosion bake, stroke finalize): bricks that no
    //    longer straddle the surface collapse back to tile values and release their samples.
    void RecategorizeRegion(const BrickCoordinate &Minimum, const BrickCoordinate &Maximum) noexcept;

    [[nodiscard]] size_t QueryBrickCount() const noexcept { return Bricks.size(); }
    [[nodiscard]] size_t QueryResidentBytes() const noexcept; // [B] - Measured, for the memory budget exhibit
    [[nodiscard]] uint64_t QueryRevision() const noexcept { return Revision; }

  private:
    TerrainWorldConfiguration World;
    uint32_t Tier                                           = 0; // [idx] - Tier this atlas serves
    uint64_t Revision                                       = 0; // [-] - Monotonic write counter
    std::unordered_map<BrickCoordinate, DensityBrick, BrickCoordinateHash> Bricks;
};

} // namespace Frontier
