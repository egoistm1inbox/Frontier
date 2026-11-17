/*==========================================================================================================================================
                                                          PARTICLEFIELDTAXONOMY.H
==========================================================================================================================================*/
// 🧩 The Particle editor's force fields: the eos taxonomy (flow, acceleration, damping), its sampling and its two GPU payloads.

#pragma once

#include "Engine/Scene/EngineConfigurations.h"

#include <array>
#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace Frontier
{

// 📝 A line-for-line port of Experimental/ParticleEditor/Engine/forcefields.js (eos 549c477, kept unchanged in the prototype).
//    Positions are the particle domain's axes (X, Y up, Z), in metres; the domain is a 12 × 8 × 12 m box.
// 📝 Compass bearings follow eos: atan2(x, z), so 0° points along +Z and 90° along +X.

//------------------------------------------------------------------------------------------------------------------------
//                                                    CATEGORIES
//------------------------------------------------------------------------------------------------------------------------

enum class ParticleFieldCategory : uint8_t
{
    Prevailing = 0,    // flow, wind lattice component 0: directional
    Gust       = 1,    // flow, component 1: gust bands
    Tornado    = 2,    // flow, component 2: spinning column
    Outflow    = 3,    // flow, component 3: radial (negative strength = suction)
    Attract    = 4,    // acceleration, force type 0
    Repel      = 5,    // acceleration, force type 1
    Lift       = 6,    // acceleration, force type 2
    Magnetic   = 7,    // acceleration, force type 3
    Gravity    = 8,    // acceleration, packed as an inverted lift
    Orbit      = 9,    // acceleration, packed as an attractor
    Drag       = 10,   // damping inside a box (field program type 4)
    Current    = 11,   // flow inside a box (field program type 5)
};

inline constexpr uint32_t ParticleFieldCategoryCount = 12;

struct ParticleFieldDescriptor
{
    ParticleFieldCategory Category     = ParticleFieldCategory::Prevailing;
    const char*           Identifier   = "";   // eos id and library spelling
    const char*           Name         = "";
    ForceContribution     Contribution = ForceContribution::Flow;
    ForceReach            Reach        = ForceReach::Sphere;
    int32_t               LatticeSlot  = -1;   // wind lattice component type, −1 = none
    int32_t               ForceSlot    = -1;   // acceleration field type, −1 = none
    bool                  Inverts      = false;
    const char*           Unit         = "";
};

[[nodiscard]] std::span<const ParticleFieldDescriptor> EnumerateParticleFieldDescriptors() noexcept;
[[nodiscard]] const ParticleFieldDescriptor& ResolveParticleFieldDescriptor(ParticleFieldCategory Category) noexcept;
[[nodiscard]] const ParticleFieldDescriptor* ResolveParticleFieldDescriptor(std::string_view Identifier) noexcept;

//------------------------------------------------------------------------------------------------------------------------
//                                                    FIELD
//------------------------------------------------------------------------------------------------------------------------

struct ParticleField
{
    ParticleFieldCategory    Category  = ParticleFieldCategory::Prevailing;
    std::string              Name;
    bool                     Enabled   = true;
    std::array<double, 3>    Centre    = { 0.0, 0.0, 0.0 };    // [m]
    std::array<double, 3>    Direction = { 0.0, -1.0, 0.0 };
    double                   Strength  = 5.0;                  // m/s, m/s² or 1/s by contribution
    double                   Radius    = 8.0;                  // [m]
    ForceReach               Reach     = ForceReach::Sphere;
    ForceFalloff             Falloff   = ForceFalloff::Smooth;
    double                   Swirl     = 0.0;
    double                   Rate      = 0.0;                  // [Hz] gust pulse rate
    double                   Swallow   = 0.0;                  // [m] an attractor this close removes the receiver
    std::vector<std::string> ActsOn;                           // receiver channels; empty = every receiver
    double                   Begins    = 0.0;                  // [s]
    double                   Lasts     = 0.0;                  // [s] 0 = forever
    double                   Repeats   = 0.0;                  // [s] 0 = once
};

// 📝 Everything acting at a point, kept apart because the three are in different units. Flowing tells a zero flow from no
//    flow at all: relaxing toward a zero flow would brake a receiver no wind reaches.
struct ParticleFieldResolution
{
    std::array<double, 3> Flow       = { 0.0, 0.0, 0.0 };   // [m/s]
    bool                  Flowing    = false;
    std::array<double, 3> Accelerate = { 0.0, 0.0, 0.0 };   // [m/s²]
    double                Damp       = 0.0;                 // [1/s]
};

[[nodiscard]] ParticleField ConstructParticleField(ParticleFieldCategory Category);

// 📝 The four eos defaults (the wind panel the editor shipped with), in order: prevailing, gust, tornado, radial suction.
[[nodiscard]] std::vector<ParticleField> ConstructDefaultParticleFields();

[[nodiscard]] double EvaluateParticleFalloff(ForceFalloff Falloff, double DistanceMetres, double RadiusMetres) noexcept;
[[nodiscard]] bool   EvaluateParticleFieldAwake(const ParticleField& Field, double TimeSeconds) noexcept;
[[nodiscard]] bool   EvaluateParticleFieldActsOn(const ParticleField& Field, std::span<const std::string> Channels) noexcept;
[[nodiscard]] bool   EvaluateParticleFieldReaching(const ParticleField& Field, const std::array<double, 3>& At) noexcept;

// 📝 What one field contributes at a point, in its contribution's unit (damping repeats the rate on all three axes).
[[nodiscard]] std::array<double, 3> SampleParticleField(const ParticleField& Field, const std::array<double, 3>& At,
                                                        double TimeSeconds) noexcept;

[[nodiscard]] ParticleFieldResolution ResolveParticleFields(std::span<const ParticleField> Fields,
                                                            const std::array<double, 3>&   At,
                                                            double                         TimeSeconds,
                                                            std::span<const std::string>   Channels);

// 📝 One receiver step: relax toward the flow at the receiver's coupling [1/s], add the acceleration whatever the coupling,
//    then damp. The order is the taxonomy.
[[nodiscard]] std::array<double, 3> AdvanceParticleReceiver(const std::array<double, 3>&   Velocity,
                                                            const ParticleFieldResolution& Acting,
                                                            double                         CouplingPerSecond,
                                                            double                         StepSeconds) noexcept;

//------------------------------------------------------------------------------------------------------------------------
//                                                    GPU PAYLOADS
//------------------------------------------------------------------------------------------------------------------------

// 📝 One flow field as the wind lattice builder's component (the eight floats buildWind reads).
struct ParticleLatticeComponent
{
    double  X              = 0.0;   // [m]
    double  Z              = 0.0;   // [m]
    double  Radius         = 0.0;   // [m]
    int32_t Slot           = 0;     // component type 0 – 3
    double  Strength       = 0.0;   // [m/s]
    double  BearingDegrees = 0.0;
    double  Rate           = 0.0;   // [Hz]
    bool    Enabled        = true;
};

// 📝 One acceleration field as fieldAccel's three vec4s. A radius of 0 means everywhere to the shader.
struct ParticleAccelerationEntry
{
    int32_t               Slot            = 0;
    std::array<double, 3> Position        = { 0.0, 0.0, 0.0 };   // [m]
    double                Radius          = 0.0;                 // [m]
    double                Strength        = 0.0;
    double                Swirl           = 0.0;
    double                Swallow         = 0.0;                 // [m]
    double                Begins          = 0.0;                 // [s]
    double                DurationSeconds = 1.0e9;
    double                PeriodSeconds   = 0.0;
};

struct ParticleFieldPayloads
{
    std::vector<ParticleLatticeComponent>  Lattice;
    std::vector<ParticleAccelerationEntry> Accelerations;
};

[[nodiscard]] double                ResolveParticleFieldBearing(const ParticleField& Field) noexcept;
[[nodiscard]] std::array<double, 3> ResolveParticleFieldAlong(double BearingDegrees) noexcept;

[[nodiscard]] std::optional<ParticleLatticeComponent>  ConstructParticleLatticeComponent(const ParticleField& Field) noexcept;
[[nodiscard]] std::optional<ParticleAccelerationEntry> ConstructParticleAccelerationEntry(const ParticleField& Field) noexcept;
[[nodiscard]] bool                                     EvaluateParticleFieldPackable(const ParticleField& Field) noexcept;

// 📝 Flow fields keep their lattice slot enabled or not (the kernel tests the flag); acceleration fields are packed only
//    while enabled and awake. Without a time, each acceleration field is judged at its own start.
[[nodiscard]] ParticleFieldPayloads ResolveParticleFieldPayloads(std::span<const ParticleField> Fields,
                                                                 std::optional<double>          TimeSeconds = std::nullopt);

// 📝 Which fields share the lattice (unselective flows) and which are evaluated per receiver; indices into Fields.
void PartitionParticleFields(std::span<const ParticleField> Fields, std::vector<uint32_t>& Baked, std::vector<uint32_t>& Live);

[[nodiscard]] const char* ResolveParticleFalloffIdentifier(ForceFalloff Falloff) noexcept;
[[nodiscard]] const char* ResolveParticleReachIdentifier(ForceReach Reach) noexcept;

// 📝 Math.hypot as V8 computes it (scaled, Kahan-compensated), so packed values match the prototype to the last bit.
[[nodiscard]] double ResolveCompensatedHypotenuse(std::span<const double> Values) noexcept;

} // namespace Frontier
