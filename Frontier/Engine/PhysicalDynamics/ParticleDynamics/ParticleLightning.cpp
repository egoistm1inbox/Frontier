/*==========================================================================================================================================
                                                          PARTICLELIGHTNING.CPP
==========================================================================================================================================*/
// 🧩 eos lightning.js in C++: bolts, strikes, the web and the segment packing.

#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleLightning.h"
#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleFieldTaxonomy.h"

#include <algorithm>
#include <cmath>
#include <functional>
#include <string>
#include <utility>

namespace Frontier
{

namespace
{

using Point = std::array<double, 3>;

struct BoltShape
{
    double  Amplitude    = 0.0;
    int32_t Levels       = 0;
    double  Width        = 0.0;
    double  BranchChance = 0.0;
};

double Separation(const Point& A, const Point& B) noexcept
{
    const double Values[3] = { A[0] - B[0], A[1] - B[1], A[2] - B[2] };
    return ResolveCompensatedHypotenuse(Values);
}

// 📝 eos makeBolt: recursive midpoint displacement with occasional thinner, shorter branches. Every draw is sequenced in the
//    prototype's order, so the same generator state gives the same bolt.
std::vector<ParticleLightningSegment> ConstructBolt(ParticleLightningGenerator& Generator, const Point& Start, const Point& End,
                                                    const BoltShape& Shape)
{
    std::vector<ParticleLightningSegment> Segments;
    const size_t Limit = ParticleLightningSegmentLimit - 64;
    std::function<void(const Point&, const Point&, double, int32_t, double, bool)> Divide =
        [&](const Point& A, const Point& B, double Amplitude, int32_t Level, double Width, bool Branching)
    {
        if (Level <= 0 || Segments.size() > Limit)
        {
            Segments.push_back({ A, B, Width });
            return;
        }
        const double DriftX = (Generator.Next() - 0.5) * Amplitude;
        const double DriftY = (Generator.Next() - 0.5) * Amplitude * 0.4;
        const double DriftZ = (Generator.Next() - 0.5) * Amplitude;
        const Point  Middle = { (A[0] + B[0]) / 2.0 + DriftX, (A[1] + B[1]) / 2.0 + DriftY, (A[2] + B[2]) / 2.0 + DriftZ };
        Divide(A, Middle, Amplitude * 0.5, Level - 1, Width, Branching);
        Divide(Middle, B, Amplitude * 0.5, Level - 1, Width, Branching);
        if (Branching && Level >= 3 && Generator.Next() < Shape.BranchChance)
        {
            const double SpreadX = (Generator.Next() - 0.5) * Amplitude * 2.0 + (B[0] - A[0]) * 0.35;
            const double Drop    = Amplitude * (0.6 + Generator.Next());
            const double SpreadZ = (Generator.Next() - 0.5) * Amplitude * 2.0 + (B[2] - A[2]) * 0.35;
            const Point  Tip     = { Middle[0] + SpreadX, Middle[1] - Drop, Middle[2] + SpreadZ };
            Divide(Middle, Tip, Amplitude * 0.6, Level - 2, Width * 0.5, false);
        }
    };
    Divide(Start, End, Shape.Amplitude, Shape.Levels, Shape.Width, true);
    return Segments;
}

} // namespace

double ParticleLightningGenerator::Next() noexcept
{
    Counter         = Counter + 0x6d2b79f5u;
    uint32_t Mixed  = Counter;
    Mixed           = (Mixed ^ (Mixed >> 15u)) * (Mixed | 1u);
    Mixed          ^= Mixed + (Mixed ^ (Mixed >> 7u)) * (Mixed | 61u);
    return static_cast<double>(Mixed ^ (Mixed >> 14u)) / 4294967296.0;
}

std::array<double, 3> ParticleLightning::Strike(double NowSeconds)
{
    const double X      = (Generator.Next() - 0.5) * 9.0;
    const double Z      = (Generator.Next() - 0.5) * 9.0;
    const double StartX = X + (Generator.Next() - 0.5) * 2.0;
    const double StartZ = Z + (Generator.Next() - 0.5) * 2.0;
    const Point  Start  = { StartX, 15.0, StartZ };
    const Point  End    = { X, 0.0, Z };
    ParticleLightningBolt Bolt;
    Bolt.Segments     = ConstructBolt(Generator, Start, End, { Amplitude, Levels, 0.11, BranchChance });
    Bolt.BeganSeconds = NowSeconds;
    Bolt.LifeSeconds  = 0.36;
    Bolt.Seed         = Generator.Next() * 1000.0;
    Bolts.push_back(std::move(Bolt));
    Flash = std::min(1.4, Flash + 1.0);
    ++Strikes;
    LastStrike = ParticleLightningStrike{ End, NowSeconds };
    return End;
}

std::vector<std::array<double, 3>> ParticleLightning::Advance(double StepSeconds, double NowSeconds)
{
    Flash = std::max(0.0, Flash - StepSeconds * 3.2);
    std::erase_if(Bolts, [NowSeconds](const ParticleLightningBolt& Bolt) { return !(NowSeconds - Bolt.BeganSeconds < Bolt.LifeSeconds); });
    std::vector<std::array<double, 3>> Hits;
    if (Automatic && NowSeconds >= NextStrikeSeconds)
    {
        Hits.push_back(Strike(NowSeconds));
        NextStrikeSeconds = NowSeconds + IntervalMinimum + Generator.Next() * std::max(0.0, IntervalMaximum - IntervalMinimum);
    }
    return Hits;
}

uint32_t ParticleLightning::Web(double NowSeconds, std::span<const std::array<double, 3>> Points, uint32_t Neighbours, double LifeSeconds,
                                uint32_t LinkLimit)
{
    // 📝 A JavaScript Map keyed "low,high": the first insertion fixes the order, a later one replaces the pair's direction.
    std::vector<std::pair<std::pair<size_t, size_t>, std::pair<size_t, size_t>>> Pairs;
    for (size_t Index = 0; Index < Points.size(); ++Index)
    {
        std::vector<std::pair<size_t, double>> Near;
        for (size_t Other = 0; Other < Points.size(); ++Other)
        {
            if (Other != Index)
            {
                Near.emplace_back(Other, Separation(Points[Index], Points[Other]));
            }
        }
        std::stable_sort(Near.begin(), Near.end(), [](const auto& A, const auto& B) { return A.second < B.second; });
        Near.resize(std::min<size_t>(Near.size(), Neighbours));
        for (const auto& [Other, Distance] : Near)
        {
            (void)Distance;
            const std::pair<size_t, size_t> Key = { std::min(Index, Other), std::max(Index, Other) };
            const auto Found = std::find_if(Pairs.begin(), Pairs.end(), [&](const auto& Entry) { return Entry.first == Key; });
            if (Found != Pairs.end())
            {
                Found->second = { Index, Other };
            }
            else
            {
                Pairs.push_back({ Key, { Index, Other } });
            }
        }
    }
    uint32_t Made = 0;
    for (const auto& [Key, Pair] : Pairs)
    {
        (void)Key;
        if (Made >= LinkLimit)
        {
            break;
        }
        const Point& A        = Points[Pair.first];
        const Point& B        = Points[Pair.second];
        const double Distance = Separation(A, B);
        ParticleLightningBolt Bolt;
        Bolt.Segments     = ConstructBolt(Generator, A, B, { std::min(1.5, 0.05 * Distance + 0.2), 4, 0.07, 0.5 });
        Bolt.BeganSeconds = NowSeconds;
        Bolt.LifeSeconds  = LifeSeconds;
        Bolt.Seed         = Generator.Next() * 1000.0;
        Bolts.push_back(std::move(Bolt));
        ++Made;
    }
    return Made;
}

uint32_t ParticleLightning::Pack(double NowSeconds, std::vector<float>& Segments) const
{
    Segments.assign(static_cast<size_t>(ParticleLightningSegmentLimit) * 8u, 0.0f);
    uint32_t Count = 0;
    for (const ParticleLightningBolt& Bolt : Bolts)
    {
        const double Age  = NowSeconds - Bolt.BeganSeconds;
        const double Fade = std::pow(std::max(0.0, 1.0 - Age / Bolt.LifeSeconds), 1.5);
        // 📝 Flicker: a new brightness every 40 ms. As eos writes it, 0.45 * (h % 1 + 1) % 1 groups as (0.45 * (h % 1 + 1)) % 1, so
        //    the flicker spans 0.55 … 1.45; JavaScript's % keeps the dividend's sign, as fmod does.
        const double Cell      = std::floor(Age / 0.04);
        const double Hashed    = std::sin((Cell + Bolt.Seed) * 91.7) * 43758.5453;
        const double Flicker   = 0.55 + std::fmod(0.45 * (std::fmod(Hashed, 1.0) + 1.0), 1.0);
        const double Intensity = 2.6 * Fade * std::fabs(Flicker);
        for (const ParticleLightningSegment& Segment : Bolt.Segments)
        {
            if (Count >= ParticleLightningSegmentLimit)
            {
                break;
            }
            float* Out = Segments.data() + static_cast<size_t>(Count) * 8u;
            Out[0] = static_cast<float>(Segment.A[0]);
            Out[1] = static_cast<float>(Segment.A[1]);
            Out[2] = static_cast<float>(Segment.A[2]);
            Out[3] = static_cast<float>(Segment.Width);
            Out[4] = static_cast<float>(Segment.B[0]);
            Out[5] = static_cast<float>(Segment.B[1]);
            Out[6] = static_cast<float>(Segment.B[2]);
            Out[7] = static_cast<float>(Intensity);
            ++Count;
        }
    }
    return Count;
}

} // namespace Frontier
