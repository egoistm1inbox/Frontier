/*==========================================================================================================================================
                                                           PARTICLELIGHTNING.H
==========================================================================================================================================*/
// 🧩 The Particle editor's lightning: midpoint-displacement bolts, automatic strikes, the web between effects and the segments
//    the lightning strips raster.

#pragma once

#include <array>
#include <cstdint>
#include <optional>
#include <span>
#include <vector>

namespace Frontier
{

// 📝 A port of eos lightning.js (Experimental/ParticleEditor/Engine) without its thunder: the bolts come from the same seeded
//    generator (mulberry32, seed 20261008), so a strike sequence repeats the prototype's exactly.

inline constexpr uint32_t ParticleLightningSegmentLimit = 1600;   // eos PE.MAX_SEGS

// 📝 eos mulberry32: a 32-bit generator returning [0, 1).
class ParticleLightningGenerator
{
public:
    explicit ParticleLightningGenerator(uint32_t Seed) noexcept : Counter(Seed) {}
    double Next() noexcept;

private:
    uint32_t Counter = 0;
};

struct ParticleLightningSegment
{
    std::array<double, 3> A{};
    std::array<double, 3> B{};
    double                Width = 0.0;   // [m]
};

struct ParticleLightningBolt
{
    std::vector<ParticleLightningSegment> Segments;
    double                                BeganSeconds = 0.0;
    double                                LifeSeconds  = 0.0;
    double                                Seed         = 0.0;
};

struct ParticleLightningStrike
{
    std::array<double, 3> At{};
    double                TimeSeconds = 0.0;
};

class ParticleLightning
{
public:
    // 📝 Starts a strike and returns the ground point (the strike sparks burst there).
    std::array<double, 3> Strike(double NowSeconds);

    // 📝 Fades the flash, retires spent bolts and makes the automatic strikes; returns this step's ground points.
    std::vector<std::array<double, 3>> Advance(double StepSeconds, double NowSeconds);

    // 📝 Links every point to its nearest neighbours, one branching bolt per link; returns the links made.
    uint32_t Web(double NowSeconds, std::span<const std::array<double, 3>> Points, uint32_t Neighbours, double LifeSeconds,
                 uint32_t LinkLimit = 16);

    // 📝 The live bolts as segment pairs (a, width), (b, intensity) into Segments (8 floats each); returns the count.
    uint32_t Pack(double NowSeconds, std::vector<float>& Segments) const;

    std::vector<ParticleLightningBolt>     Bolts;
    double                                 Flash             = 0.0;
    bool                                   Automatic         = true;
    double                                 IntervalMinimum   = 3.0;      // [s]
    double                                 IntervalMaximum   = 9.0;      // [s]
    double                                 NextStrikeSeconds = 1.5;
    double                                 DistanceMetres    = 1200.0;   // from the viewer; sets the thunder delay
    double                                 Amplitude         = 2.0;      // [m]
    int32_t                                Levels            = 6;
    double                                 BranchChance      = 0.35;
    uint32_t                               Strikes           = 0;
    std::optional<ParticleLightningStrike> LastStrike;

private:
    ParticleLightningGenerator Generator{ 20261008u };
};

} // namespace Frontier
