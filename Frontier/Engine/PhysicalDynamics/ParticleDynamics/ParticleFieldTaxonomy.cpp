/*==========================================================================================================================================
                                                         PARTICLEFIELDTAXONOMY.CPP
==========================================================================================================================================*/
// 🧩 The eos force-field taxonomy (forcefields.js) in C++: categories, sampling, the receiver step and the GPU payloads.

#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleFieldTaxonomy.h"
#include "Frontier/Engine/Foundation/Constants.h"

#include <algorithm>
#include <cmath>

namespace Frontier
{

namespace
{

constexpr ParticleFieldDescriptor ParticleFieldDescriptors[ParticleFieldCategoryCount] = {
    { ParticleFieldCategory::Prevailing, "prevailing", "Prevailing wind", ForceContribution::Flow, ForceReach::Everywhere, 0, -1,
      false, "m/s" },
    { ParticleFieldCategory::Gust, "gust", "Gust front", ForceContribution::Flow, ForceReach::Sphere, 1, -1, false, "m/s" },
    { ParticleFieldCategory::Tornado, "tornado", "Tornado", ForceContribution::Flow, ForceReach::Sphere, 2, -1, false, "m/s" },
    { ParticleFieldCategory::Outflow, "outflow", "Blast outflow", ForceContribution::Flow, ForceReach::Sphere, 3, -1, false, "m/s" },
    { ParticleFieldCategory::Attract, "attract", "Attractor", ForceContribution::Accelerate, ForceReach::Sphere, -1, 0, false,
      "m/s²" },
    { ParticleFieldCategory::Repel, "repel", "Repulsor", ForceContribution::Accelerate, ForceReach::Sphere, -1, 1, false, "m/s²" },
    { ParticleFieldCategory::Lift, "lift", "Lift", ForceContribution::Accelerate, ForceReach::Sphere, -1, 2, false, "m/s²" },
    { ParticleFieldCategory::Magnetic, "magnetic", "Magnetic dipole", ForceContribution::Accelerate, ForceReach::Sphere, -1, 3,
      false, "m/s²" },
    { ParticleFieldCategory::Gravity, "gravity", "Gravity", ForceContribution::Accelerate, ForceReach::Everywhere, -1, 2, true,
      "m/s²" },
    { ParticleFieldCategory::Orbit, "orbit", "Orbit", ForceContribution::Accelerate, ForceReach::Sphere, -1, 0, false, "m/s²" },
    { ParticleFieldCategory::Drag, "drag", "Drag volume", ForceContribution::Damp, ForceReach::Box, -1, 4, false, "1/s" },
    { ParticleFieldCategory::Current, "current", "Current", ForceContribution::Flow, ForceReach::Box, -1, 5, false, "m/s" },
};

struct ParticleSeparation
{
    std::array<double, 3> Offset{};
    double                Distance = 0.0;
};

// 📝 eos Away: the offset from the centre and its length, as Math.sqrt of the sum (not hypot).
ParticleSeparation ResolveSeparation(const ParticleField& Field, const std::array<double, 3>& At) noexcept
{
    const double Δx = At[0] - Field.Centre[0];
    const double Δy = At[1] - Field.Centre[1];
    const double Δz = At[2] - Field.Centre[2];
    return { { Δx, Δy, Δz }, std::sqrt(Δx * Δx + Δy * Δy + Δz * Δz) };
}

double Hypotenuse(double A, double B) noexcept
{
    const double Values[2] = { A, B };
    return ResolveCompensatedHypotenuse(Values);
}

double Hypotenuse(double A, double B, double C) noexcept
{
    const double Values[3] = { A, B, C };
    return ResolveCompensatedHypotenuse(Values);
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    DESCRIPTORS
//------------------------------------------------------------------------------------------------------------------------

std::span<const ParticleFieldDescriptor> EnumerateParticleFieldDescriptors() noexcept
{
    return ParticleFieldDescriptors;
}

const ParticleFieldDescriptor& ResolveParticleFieldDescriptor(ParticleFieldCategory Category) noexcept
{
    const auto Index = static_cast<uint32_t>(Category);
    return ParticleFieldDescriptors[Index < ParticleFieldCategoryCount ? Index : 0u];
}

const ParticleFieldDescriptor* ResolveParticleFieldDescriptor(std::string_view Identifier) noexcept
{
    for (const ParticleFieldDescriptor& Descriptor : ParticleFieldDescriptors)
    {
        if (Identifier == Descriptor.Identifier)
        {
            return &Descriptor;
        }
    }
    return nullptr;
}

const char* ResolveParticleFalloffIdentifier(ForceFalloff Falloff) noexcept
{
    switch (Falloff)
    {
    case ForceFalloff::None: return "none";
    case ForceFalloff::Linear: return "linear";
    case ForceFalloff::Smooth: return "smooth";
    case ForceFalloff::InverseSquare: return "inverse_square";
    }
    return "smooth";
}

const char* ResolveParticleReachIdentifier(ForceReach Reach) noexcept
{
    switch (Reach)
    {
    case ForceReach::Everywhere: return "everywhere";
    case ForceReach::Sphere: return "sphere";
    case ForceReach::Column: return "column";
    case ForceReach::Box: return "box";
    }
    return "sphere";
}

double ResolveCompensatedHypotenuse(std::span<const double> Values) noexcept
{
    double Largest = 0.0;
    bool   Missing = false;
    for (const double Value : Values)
    {
        if (std::isnan(Value))
        {
            Missing = true;
            continue;
        }
        Largest = std::max(Largest, std::fabs(Value));
    }
    if (std::isinf(Largest))
    {
        return Largest;
    }
    if (Missing)
    {
        return std::nan("");
    }
    if (Largest == 0.0)
    {
        return 0.0;
    }
    double Sum          = 0.0;
    double Compensation = 0.0;
    for (const double Value : Values)
    {
        const double Normalized  = std::fabs(Value) / Largest;
        const double Summand     = Normalized * Normalized - Compensation;
        const double Preliminary = Sum + Summand;
        Compensation             = (Preliminary - Sum) - Summand;
        Sum                      = Preliminary;
    }
    return std::sqrt(Sum) * Largest;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    FIELDS
//------------------------------------------------------------------------------------------------------------------------

ParticleField ConstructParticleField(ParticleFieldCategory Category)
{
    const ParticleFieldDescriptor& Descriptor = ResolveParticleFieldDescriptor(Category);
    ParticleField                  Field;
    Field.Category = Category;
    Field.Name     = Descriptor.Name;
    Field.Strength = Category == ParticleFieldCategory::Gravity ? 9.81 : 5.0;
    Field.Reach    = Descriptor.Reach;
    return Field;
}

std::vector<ParticleField> ConstructDefaultParticleFields()
{
    const auto Make = [](ParticleFieldCategory Category, const char* Name, bool Enabled, std::array<double, 3> Centre, double Radius,
                         double Strength, double BearingDegrees, double Rate)
    {
        ParticleField Field = ConstructParticleField(Category);
        Field.Name          = Name;
        Field.Enabled       = Enabled;
        Field.Centre        = Centre;
        Field.Radius        = Radius;
        Field.Strength      = Strength;
        Field.Rate          = Rate;
        Field.Direction     = ResolveParticleFieldAlong(BearingDegrees);
        return Field;
    };
    return {
        Make(ParticleFieldCategory::Prevailing, "Prevailing wind", true, { 0.0, 0.0, 0.0 }, 6.0, 3.0, 70.0, 0.3),
        Make(ParticleFieldCategory::Gust, "Passing gust", true, { -4.0, 0.0, 0.0 }, 4.0, 5.0, 70.0, 0.3),
        Make(ParticleFieldCategory::Tornado, "Tornado", false, { -2.0, 0.0, -4.0 }, 1.6, 6.0, 0.0, 0.0),
        Make(ParticleFieldCategory::Outflow, "Radial suction", false, { 0.0, 0.0, -2.0 }, 3.0, -2.0, 0.0, 0.0),
    };
}

double EvaluateParticleFalloff(ForceFalloff Falloff, double DistanceMetres, double RadiusMetres) noexcept
{
    if (Falloff == ForceFalloff::None)
    {
        return 1.0;
    }
    const double Span = std::max(RadiusMetres, 1e-3);
    const double q    = std::min(std::max(DistanceMetres / Span, 0.0), 1.0);
    if (Falloff == ForceFalloff::Linear)
    {
        return 1.0 - q;
    }
    if (Falloff == ForceFalloff::InverseSquare)
    {
        return 1.0 / (1.0 + 8.0 * q * q);
    }
    const double Soft = 1.0 - q * q;
    return Soft * Soft;
}

bool EvaluateParticleFieldAwake(const ParticleField& Field, double TimeSeconds) noexcept
{
    if (!Field.Enabled)
    {
        return false;
    }
    if (Field.Lasts <= 0.0)
    {
        return TimeSeconds >= Field.Begins;
    }
    const double Since = TimeSeconds - Field.Begins;
    if (Since < 0.0)
    {
        return false;
    }
    if (Field.Repeats > 0.0)
    {
        return std::fmod(Since, Field.Repeats) < Field.Lasts;
    }
    return Since < Field.Lasts;
}

bool EvaluateParticleFieldActsOn(const ParticleField& Field, std::span<const std::string> Channels) noexcept
{
    if (Field.ActsOn.empty())
    {
        return true;
    }
    if (Channels.empty())
    {
        return false;
    }
    for (const std::string& Channel : Field.ActsOn)
    {
        if (std::find(Channels.begin(), Channels.end(), Channel) != Channels.end())
        {
            return true;
        }
    }
    return false;
}

bool EvaluateParticleFieldReaching(const ParticleField& Field, const std::array<double, 3>& At) noexcept
{
    if (Field.Reach == ForceReach::Everywhere)
    {
        return true;
    }
    return ResolveSeparation(Field, At).Distance < Field.Radius;
}

std::array<double, 3> SampleParticleField(const ParticleField& Field, const std::array<double, 3>& At, double TimeSeconds) noexcept
{
    if (static_cast<uint32_t>(Field.Category) >= ParticleFieldCategoryCount || !EvaluateParticleFieldAwake(Field, TimeSeconds))
    {
        return { 0.0, 0.0, 0.0 };
    }
    double Share = 1.0;
    if (Field.Reach != ForceReach::Everywhere)
    {
        const double Distance = ResolveSeparation(Field, At).Distance;
        if (Distance >= Field.Radius)
        {
            return { 0.0, 0.0, 0.0 };
        }
        Share = EvaluateParticleFalloff(Field.Falloff, Distance, Field.Radius);
    }
    const double Scale = Field.Strength * Share;
    switch (Field.Category)
    {
    case ParticleFieldCategory::Gravity: return { 0.0, -Scale, 0.0 };
    case ParticleFieldCategory::Lift: return { 0.0, Scale, 0.0 };
    case ParticleFieldCategory::Drag: return { Scale, Scale, Scale };
    default: break;
    }
    const bool Attracting = Field.Category == ParticleFieldCategory::Attract;
    const bool Orbiting   = Field.Category == ParticleFieldCategory::Orbit;
    if (Attracting || Orbiting || Field.Category == ParticleFieldCategory::Repel)
    {
        const ParticleSeparation    Separation = ResolveSeparation(Field, At);
        const double                Span       = std::max(Separation.Distance, 1e-3);
        const std::array<double, 3> Out = { Separation.Offset[0] / Span, Separation.Offset[1] / Span, Separation.Offset[2] / Span };
        if (Field.Category == ParticleFieldCategory::Repel)
        {
            return { Out[0] * Scale, Out[1] * Scale, Out[2] * Scale };
        }
        const std::array<double, 3> In = { -Out[0] * Scale, -Out[1] * Scale, -Out[2] * Scale };
        if (Attracting && Field.Swirl == 0.0)
        {
            return In;
        }
        // 📝 Swirl is tangential around world up: an attractor with swirl is a drain; orbit is the turn without the pull.
        const double Tangent[3] = { -Out[2], 0.0, Out[0] };
        double       Length     = Hypotenuse(Tangent[0], Tangent[2]);
        if (Length == 0.0)
        {
            Length = 1.0;
        }
        const double                Turn  = Orbiting ? Scale : Field.Swirl * Share;
        const std::array<double, 3> Round = { Tangent[0] / Length * Turn, 0.0, Tangent[2] / Length * Turn };
        if (Orbiting)
        {
            return Round;
        }
        return { In[0] + Round[0], In[1] + Round[1], In[2] + Round[2] };
    }
    // 📝 The flow categories and the magnetic drive are directional about their own axis.
    const std::array<double, 3>& Axis   = Field.Direction;
    double                       Length = Hypotenuse(Axis[0], Axis[1], Axis[2]);
    if (Length == 0.0)
    {
        Length = 1.0;
    }
    return { Axis[0] / Length * Scale, Axis[1] / Length * Scale, Axis[2] / Length * Scale };
}

ParticleFieldResolution ResolveParticleFields(std::span<const ParticleField> Fields, const std::array<double, 3>& At, double TimeSeconds,
                                              std::span<const std::string> Channels)
{
    ParticleFieldResolution Out;
    for (const ParticleField& Field : Fields)
    {
        if (static_cast<uint32_t>(Field.Category) >= ParticleFieldCategoryCount || !EvaluateParticleFieldActsOn(Field, Channels))
        {
            continue;
        }
        if (!EvaluateParticleFieldAwake(Field, TimeSeconds))
        {
            continue;
        }
        const ForceContribution Contribution = ResolveParticleFieldDescriptor(Field.Category).Contribution;
        if (Contribution == ForceContribution::Damp)
        {
            Out.Damp += SampleParticleField(Field, At, TimeSeconds)[0];
            continue;
        }
        if (Contribution == ForceContribution::Flow)
        {
            // 📝 Reach decides, not the sampled magnitude: a gust blowing 0 m/s here still counts as air.
            if (!EvaluateParticleFieldReaching(Field, At))
            {
                continue;
            }
            const std::array<double, 3> Given = SampleParticleField(Field, At, TimeSeconds);
            Out.Flow[0] += Given[0];
            Out.Flow[1] += Given[1];
            Out.Flow[2] += Given[2];
            Out.Flowing = true;
            continue;
        }
        const std::array<double, 3> Given = SampleParticleField(Field, At, TimeSeconds);
        Out.Accelerate[0] += Given[0];
        Out.Accelerate[1] += Given[1];
        Out.Accelerate[2] += Given[2];
    }
    return Out;
}

std::array<double, 3> AdvanceParticleReceiver(const std::array<double, 3>& Velocity, const ParticleFieldResolution& Acting,
                                              double CouplingPerSecond, double StepSeconds) noexcept
{
    std::array<double, 3> Next = Velocity;
    if (Acting.Flowing)
    {
        const double Pull = std::min(std::max(CouplingPerSecond * StepSeconds, 0.0), 1.0);
        Next[0] += (Acting.Flow[0] - Velocity[0]) * Pull;
        Next[1] += (Acting.Flow[1] - Velocity[1]) * Pull;
        Next[2] += (Acting.Flow[2] - Velocity[2]) * Pull;
    }
    // 📝 Acceleration comes after the relaxation and ignores the coupling: the reason flow and acceleration are apart.
    Next[0] += Acting.Accelerate[0] * StepSeconds;
    Next[1] += Acting.Accelerate[1] * StepSeconds;
    Next[2] += Acting.Accelerate[2] * StepSeconds;
    if (Acting.Damp > 0.0)
    {
        const double Keep = std::exp(-Acting.Damp * StepSeconds);
        Next[0] *= Keep;
        Next[1] *= Keep;
        Next[2] *= Keep;
    }
    return Next;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    GPU PAYLOADS
//------------------------------------------------------------------------------------------------------------------------

double ResolveParticleFieldBearing(const ParticleField& Field) noexcept
{
    const double Degrees = RadiansToDegrees(std::atan2(Field.Direction[0], Field.Direction[2]));
    return Degrees < 0.0 ? Degrees + 360.0 : Degrees;
}

std::array<double, 3> ResolveParticleFieldAlong(double BearingDegrees) noexcept
{
    const double Turn = DegreesToRadians(BearingDegrees);
    return { std::sin(Turn), 0.0, std::cos(Turn) };
}

std::optional<ParticleLatticeComponent> ConstructParticleLatticeComponent(const ParticleField& Field) noexcept
{
    const ParticleFieldDescriptor& Descriptor = ResolveParticleFieldDescriptor(Field.Category);
    if (Descriptor.Contribution != ForceContribution::Flow || Descriptor.LatticeSlot < 0)
    {
        return std::nullopt;
    }
    ParticleLatticeComponent Component;
    Component.X              = Field.Centre[0];
    Component.Z              = Field.Centre[2];
    Component.Radius         = Field.Radius;
    Component.Slot           = Descriptor.LatticeSlot;
    Component.Strength       = Field.Strength;
    Component.BearingDegrees = ResolveParticleFieldBearing(Field);
    Component.Rate           = Field.Rate;
    Component.Enabled        = Field.Enabled;
    return Component;
}

std::optional<ParticleAccelerationEntry> ConstructParticleAccelerationEntry(const ParticleField& Field) noexcept
{
    const ParticleFieldDescriptor& Descriptor = ResolveParticleFieldDescriptor(Field.Category);
    if (Descriptor.ForceSlot < 0 || (Descriptor.Contribution == ForceContribution::Flow && Descriptor.LatticeSlot >= 0))
    {
        return std::nullopt;
    }
    ParticleAccelerationEntry Entry;
    Entry.Slot            = Descriptor.ForceSlot;
    Entry.Position        = Field.Centre;
    Entry.Radius          = Field.Reach == ForceReach::Everywhere ? 0.0 : Field.Radius;
    Entry.Strength        = Descriptor.Inverts ? -Field.Strength : Field.Strength;
    Entry.Swirl           = Field.Swirl;
    Entry.Swallow         = Field.Swallow;
    if (Field.Category == ParticleFieldCategory::Current)
    {
        // 📝 A current carries its flow velocity in the three strength slots (the shader relaxes particles toward it).
        const double Length = std::sqrt(Field.Direction[0] * Field.Direction[0] + Field.Direction[1] * Field.Direction[1] +
                                        Field.Direction[2] * Field.Direction[2]);
        const double Scale  = Length > 1.0e-9 ? Field.Strength / Length : 0.0;
        Entry.Strength      = Field.Direction[0] * Scale;
        Entry.Swirl         = Field.Direction[1] * Scale;
        Entry.Swallow       = Field.Direction[2] * Scale;
    }
    else if (Field.Category == ParticleFieldCategory::Drag)
    {
        Entry.Swirl   = 0.0;
        Entry.Swallow = 0.0;
    }
    Entry.Begins          = Field.Begins;
    Entry.DurationSeconds = Field.Lasts > 0.0 ? Field.Lasts : 1.0e9;
    Entry.PeriodSeconds   = Field.Repeats;
    return Entry;
}

bool EvaluateParticleFieldPackable(const ParticleField& Field) noexcept
{
    const ParticleFieldDescriptor& Descriptor = ResolveParticleFieldDescriptor(Field.Category);
    if (Descriptor.Contribution == ForceContribution::Flow)
    {
        return Descriptor.LatticeSlot >= 0 || Descriptor.ForceSlot >= 0;
    }
    return Descriptor.ForceSlot >= 0;   // 📝 Accelerations and the drag volume, in the field program's acceleration list
}

ParticleFieldPayloads ResolveParticleFieldPayloads(std::span<const ParticleField> Fields, std::optional<double> TimeSeconds)
{
    ParticleFieldPayloads Payloads;
    for (const ParticleField& Field : Fields)
    {
        if (static_cast<uint32_t>(Field.Category) >= ParticleFieldCategoryCount)
        {
            continue;
        }
        const ForceContribution Contribution = ResolveParticleFieldDescriptor(Field.Category).Contribution;
        const bool Lattice = Contribution == ForceContribution::Flow && ResolveParticleFieldDescriptor(Field.Category).LatticeSlot >= 0;
        if (Lattice)
        {
            if (const std::optional<ParticleLatticeComponent> Component = ConstructParticleLatticeComponent(Field))
            {
                Payloads.Lattice.push_back(*Component);
            }
        }
        else
        {
            if (!Field.Enabled || !EvaluateParticleFieldAwake(Field, TimeSeconds.value_or(Field.Begins)))
            {
                continue;
            }
            if (const std::optional<ParticleAccelerationEntry> Entry = ConstructParticleAccelerationEntry(Field))
            {
                Payloads.Accelerations.push_back(*Entry);
            }
        }
    }
    return Payloads;
}

void PartitionParticleFields(std::span<const ParticleField> Fields, std::vector<uint32_t>& Baked, std::vector<uint32_t>& Live)
{
    Baked.clear();
    Live.clear();
    for (uint32_t Index = 0; Index < Fields.size(); ++Index)
    {
        const ParticleField& Field = Fields[Index];
        if (static_cast<uint32_t>(Field.Category) >= ParticleFieldCategoryCount)
        {
            continue;
        }
        // 📝 An Acts on list makes a flow selective, and a selective flow cannot share one texture with what it excludes.
        const bool Flow = ResolveParticleFieldDescriptor(Field.Category).Contribution == ForceContribution::Flow;
        (Flow && Field.ActsOn.empty() ? Baked : Live).push_back(Index);
    }
}

} // namespace Frontier
