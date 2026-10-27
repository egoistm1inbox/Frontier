/*==========================================================================================================================================
                                                        TERRAINWORLDCONFIGURATION.H
==========================================================================================================================================*/
// 🧩 World extents, resolution tiers, and brick geometry for the terrain density field. Every quantity is a
//    user-edited document value (TOML); no geometric or physical constant is compiled into the engine.

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace Frontier
{

//----------------------------------------------------------------------------------------------------------------------
//                                                   WORLD COORDINATES
//----------------------------------------------------------------------------------------------------------------------

// One position in world space. Terrain quantities are authored in metres end to end; conversion to the
//    renderer's scene units happens once, at extraction.
struct WorldPosition
{
    double X = 0.0; // [m] - Easting
    double Y = 0.0; // [m] - Elevation (gravity opposes +Y)
    double Z = 0.0; // [m] - Northing
};

// One brick address in the density atlas of a single resolution tier.
struct BrickCoordinate
{
    int32_t X = 0; // [idx] - Brick index along world X
    int32_t Y = 0; // [idx] - Brick index along world Y
    int32_t Z = 0; // [idx] - Brick index along world Z

    [[nodiscard]] bool operator==(const BrickCoordinate &Other) const noexcept
    {
        return X == Other.X && Y == Other.Y && Z == Other.Z;
    }
};

struct BrickCoordinateHash
{
    [[nodiscard]] size_t operator()(const BrickCoordinate &Coordinate) const noexcept
    {
        // 📝 Splitmix-style avalanche over the packed triple; brick addresses are near-sequential in
        //    practice, and a plain multiplicative hash clusters them into the same buckets.
        uint64_t Seed = static_cast<uint64_t>(static_cast<uint32_t>(Coordinate.X)) * 0x9E3779B97F4A7C15ull;
        Seed ^= static_cast<uint64_t>(static_cast<uint32_t>(Coordinate.Y)) + 0x9E3779B97F4A7C15ull + (Seed << 6) + (Seed >> 2);
        Seed ^= static_cast<uint64_t>(static_cast<uint32_t>(Coordinate.Z)) + 0x9E3779B97F4A7C15ull + (Seed << 6) + (Seed >> 2);
        return static_cast<size_t>(Seed);
    }
};

//----------------------------------------------------------------------------------------------------------------------
//                                                    RESOLUTION TIERS
//----------------------------------------------------------------------------------------------------------------------

// One streaming resolution. Tier 0 spans the whole world; finer tiers exist only inside their ring
//    (or inside painted hero insets), which is what keeps a volumetric world at heightmap-class memory.
struct TerrainTierSpecification
{
    double CellSizeMeters  = 2.0;   // [m] - Edge length of one density cell at this tier
    double RingRadiusMeters = 0.0;  // [m] - Camera-centred resident radius; 0 means the whole world
    bool   PhysicsTier      = false; // [-] - This tier also feeds collision extraction
};

//----------------------------------------------------------------------------------------------------------------------
//                                                  WORLD CONFIGURATION
//----------------------------------------------------------------------------------------------------------------------

// The document-level geometry of one terrain. Serialised as the [world] table of the .terrain.toml
//    document; reconstructed verbatim by TerrainDocumentCodec.
struct TerrainWorldConfiguration
{
    std::array<double, 3> ExtentMeters{8192.0, 1024.0, 8192.0}; // [m] - World size along X, Y, Z
    double SeaLevelMeters                = 128.0;  // [m] - Global ocean equilibrium elevation
    uint32_t BrickExtentCells            = 32;     // [cells] - Edge length of one density brick
    uint32_t NarrowBandHalfWidthCells    = 3;      // [cells] - Stored samples each side of the ρ = 0 surface
    double GradientStepCells             = 1.0;    // [cells] - Central-difference step for baked-brick gradients
    std::vector<TerrainTierSpecification> Tiers;   // [-] - Coarsest first; Tiers[0] covers the world

    // 📝 A tier is usable only when its cells tile the world and its bricks tile its cells; the codec
    //    refuses documents that fail this instead of silently resampling the artist's world.
    [[nodiscard]] bool ValidateConfiguration() const noexcept;
    [[nodiscard]] uint32_t QueryTierCount() const noexcept
    {
        return static_cast<uint32_t>(Tiers.size());
    }
    [[nodiscard]] double QueryBrickSizeMeters(uint32_t TierIndex) const noexcept
    {
        return Tiers[TierIndex].CellSizeMeters * static_cast<double>(BrickExtentCells);
    }
};

} // namespace Frontier
