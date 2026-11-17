/*==========================================================================================================================================
                                                         PARTICLEEFFECTLIBRARY.CPP
==========================================================================================================================================*/
// 🧩 ParticleLibrary.particlespace decoded: the presets with every parameter, their wind links, the default wind and force list.

#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleEffectLibrary.h"
#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleEffectCodec.h"

#include <toml++/toml.hpp>

#include <algorithm>

namespace Frontier
{

namespace
{

constexpr const char* LightFibrePathNames[LightFibrePathCount] = { "Ring",    "Figure eight", "Rose", "Weave",
                                                                   "Loop",    "Stadium",      "Dipole field line" };

//------------------------------------------------------------------------------------------------------------------------
//                                                    READINGS
//------------------------------------------------------------------------------------------------------------------------

// 📝 Each reader leaves the target unchanged when the key is absent, so the struct defaults stand in; a key present with
//    the wrong type is an error.
class KeyReading
{
public:
    KeyReading(const toml::table& Keys, std::string Where, std::string& Diagnostic) : Keys(Keys), Where(std::move(Where)),
        Diagnostic(Diagnostic)
    {
    }

    void Read(const char* Key, double& Target)
    {
        const toml::node* Found = Keys.get(Key);
        if (!Found)
        {
            return;
        }
        if (const auto Reading = Found->value<double>())
        {
            Target = *Reading;
            return;
        }
        Fail(Key, "a number");
    }

    void Read(const char* Key, std::optional<double>& Target)
    {
        if (Keys.get(Key))
        {
            double Reading = 0.0;
            Read(Key, Reading);
            Target = Reading;
        }
    }

    void Read(const char* Key, int32_t& Target)
    {
        const toml::node* Found = Keys.get(Key);
        if (!Found)
        {
            return;
        }
        if (const auto Reading = Found->value<int64_t>())
        {
            Target = static_cast<int32_t>(*Reading);
            return;
        }
        Fail(Key, "an integer");
    }

    // 📝 eos presets hold some enum-like counts (assemble: 0 burst, 1 rebuild, 2 stack) as JavaScript numbers, so the
    //    generated library spells them 0.0 / 1.0 / 2.0; an integral float reads as its integer.
    void ReadIntegral(const char* Key, int32_t& Target)
    {
        const toml::node* Found = Keys.get(Key);
        if (!Found)
        {
            return;
        }
        if (const auto Reading = Found->value<int64_t>())
        {
            Target = static_cast<int32_t>(*Reading);
            return;
        }
        if (const auto Reading = Found->value<double>())
        {
            const double Whole = std::floor(*Reading);
            if (*Reading == Whole && Whole >= -2147483648.0 && Whole <= 2147483647.0)
            {
                Target = static_cast<int32_t>(Whole);
                return;
            }
        }
        Fail(Key, "an integer");
    }

    void Read(const char* Key, bool& Target)
    {
        const toml::node* Found = Keys.get(Key);
        if (!Found)
        {
            return;
        }
        if (const auto Reading = Found->value<bool>())
        {
            Target = *Reading;
            return;
        }
        Fail(Key, "true or false");
    }

    void Read(const char* Key, std::string& Target)
    {
        const toml::node* Found = Keys.get(Key);
        if (!Found)
        {
            return;
        }
        if (const auto Reading = Found->value<std::string>())
        {
            Target = *Reading;
            return;
        }
        Fail(Key, "a string");
    }

    template <size_t Count>
    void Read(const char* Key, std::array<double, Count>& Target)
    {
        const toml::node* Found = Keys.get(Key);
        if (!Found)
        {
            return;
        }
        const toml::array* Values = Found->as_array();
        if (!Values || Values->size() != Count)
        {
            Fail(Key, Count == 3 ? "three numbers" : "four numbers");
            return;
        }
        for (size_t Index = 0; Index < Count; ++Index)
        {
            const auto Reading = (*Values)[Index].value<double>();
            if (!Reading)
            {
                Fail(Key, "numbers");
                return;
            }
            Target[Index] = *Reading;
        }
    }

    void Read(const char* Key, std::vector<std::string>& Target)
    {
        const toml::node* Found = Keys.get(Key);
        if (!Found)
        {
            return;
        }
        const toml::array* Values = Found->as_array();
        if (!Values)
        {
            Fail(Key, "a list of strings");
            return;
        }
        Target.clear();
        for (const toml::node& Value : *Values)
        {
            if (const auto Reading = Value.value<std::string>())
            {
                Target.push_back(*Reading);
            }
        }
    }

    // 📝 A spelled choice: the index of the matching name, or an error naming the key.
    template <typename Choice, size_t Count>
    void Read(const char* Key, Choice& Target, const std::array<std::pair<const char*, Choice>, Count>& Spellings)
    {
        std::string Spelled;
        Read(Key, Spelled);
        if (Spelled.empty())
        {
            return;
        }
        for (const auto& [Spelling, Value] : Spellings)
        {
            if (Spelled == Spelling)
            {
                Target = Value;
                return;
            }
        }
        Fail(Key, "a known choice, not \"" + Spelled + "\"");
    }

    [[nodiscard]] bool Succeeded() const noexcept { return Diagnostic.empty(); }

private:
    void Fail(const char* Key, const std::string& Expected)
    {
        if (Diagnostic.empty())
        {
            Diagnostic = Where + ": " + Key + " must be " + Expected;
        }
    }

    const toml::table& Keys;
    std::string        Where;
    std::string&       Diagnostic;
};

constexpr std::array<std::pair<const char*, ParticleBehaviour>, 7> BehaviourSpellings = { {
    { "ballistic", ParticleBehaviour::Ballistic },
    { "wind_driven", ParticleBehaviour::WindDriven },
    { "lennard_jones", ParticleBehaviour::LennardJones },
    { "reactive", ParticleBehaviour::Reactive },
    { "visual_effect", ParticleBehaviour::VisualEffect },
    { "flocking", ParticleBehaviour::Flocking },
    { "light_fibre", ParticleBehaviour::LightFibre },
} };

constexpr std::array<std::pair<const char*, ParticleAppearance>, 7> AppearanceSpellings = { {
    { "streak", ParticleAppearance::Streak },
    { "sphere", ParticleAppearance::Sphere },
    { "leaf", ParticleAppearance::Leaf },
    { "soft_glow", ParticleAppearance::SoftGlow },
    { "cube", ParticleAppearance::Cube },
    { "coin", ParticleAppearance::Coin },
    { "bubble", ParticleAppearance::Bubble },
} };

constexpr std::array<std::pair<const char*, ParticleReleaseShape>, 5> ReleaseShapeSpellings = { {
    { "point", ParticleReleaseShape::Point },
    { "sphere", ParticleReleaseShape::Sphere },
    { "disc", ParticleReleaseShape::Disc },
    { "box", ParticleReleaseShape::Box },
    { "cube_surface", ParticleReleaseShape::CubeSurface },
} };

constexpr std::array<std::pair<const char*, ParticleLeafSurface>, 2> LeafSurfaceSpellings = { {
    { "leaf", ParticleLeafSurface::Leaf },
    { "paper", ParticleLeafSurface::Paper },
} };

constexpr std::array<std::pair<const char*, ParticleBlend>, 2> BlendSpellings = { {
    { "additive", ParticleBlend::Additive },
    { "alpha_over", ParticleBlend::AlphaOver },
} };

constexpr std::array<std::pair<const char*, ParticleTransitionWave>, 3> WaveSpellings = { {
    { "corner", ParticleTransitionWave::Corner },
    { "melt", ParticleTransitionWave::Melt },
    { "glitch", ParticleTransitionWave::Glitch },
} };

constexpr std::array<std::pair<const char*, LightFibreShape>, 3> FibreShapeSpellings = { {
    { "streak", LightFibreShape::Streak },
    { "ribbon", LightFibreShape::Ribbon },
    { "trail", LightFibreShape::Trail },
} };

constexpr std::array<std::pair<const char*, LightFibreColouring>, 3> ColouringSpellings = { {
    { "solid", LightFibreColouring::Solid },
    { "ramp", LightFibreColouring::Ramp },
    { "palette", LightFibreColouring::Palette },
} };

constexpr std::array<std::pair<const char*, LightFibrePulse>, 4> PulseSpellings = { {
    { "Breathe", LightFibrePulse::Breathe },
    { "Heartbeat", LightFibrePulse::Heartbeat },
    { "Ripple", LightFibrePulse::Ripple },
    { "Sweep", LightFibrePulse::Sweep },
} };

constexpr std::array<std::pair<const char*, ForceReach>, 4> ReachSpellings = { {
    { "everywhere", ForceReach::Everywhere },
    { "sphere", ForceReach::Sphere },
    { "box", ForceReach::Box },
    { "cone", ForceReach::Sphere },   // 📝 eos declares a cone reach that no category uses; sampling treats it as a sphere
} };

constexpr std::array<std::pair<const char*, ForceFalloff>, 4> FalloffSpellings = { {
    { "none", ForceFalloff::None },
    { "linear", ForceFalloff::Linear },
    { "smooth", ForceFalloff::Smooth },
    { "inverse_square", ForceFalloff::InverseSquare },
} };

//------------------------------------------------------------------------------------------------------------------------
//                                                    SECTIONS
//------------------------------------------------------------------------------------------------------------------------

bool DecodeField(const toml::table& Keys, ParticleField& Field, const std::string& Where, std::string& Diagnostic)
{
    std::string Category;
    KeyReading Reading(Keys, Where, Diagnostic);
    Reading.Read("category", Category);
    const ParticleFieldDescriptor* Descriptor = ResolveParticleFieldDescriptor(Category);
    if (!Descriptor)
    {
        Diagnostic = Where + ": unknown force category \"" + Category + "\"";
        return false;
    }
    Field = ConstructParticleField(Descriptor->Category);
    Reading.Read("name", Field.Name);
    Reading.Read("enabled", Field.Enabled);
    Reading.Read("centre_metres", Field.Centre);
    Reading.Read("direction", Field.Direction);
    Reading.Read("strength", Field.Strength);
    Reading.Read("radius_metres", Field.Radius);
    Reading.Read("reach", Field.Reach, ReachSpellings);
    Reading.Read("falloff", Field.Falloff, FalloffSpellings);
    Reading.Read("swirl", Field.Swirl);
    Reading.Read("rate_hz", Field.Rate);
    Reading.Read("swallow_metres", Field.Swallow);
    Reading.Read("acts_on", Field.ActsOn);
    Reading.Read("begins_seconds", Field.Begins);
    Reading.Read("lasts_seconds", Field.Lasts);
    Reading.Read("repeats_seconds", Field.Repeats);
    return Reading.Succeeded();
}

void DecodeLightFibre(const toml::table& Keys, LightFibreParameters& Fibre, KeyReading& Reading)
{
    Reading.Read("shape", Fibre.Shape, FibreShapeSpellings);
    Reading.Read("strands", Fibre.Strands);
    Reading.Read("segments", Fibre.Segments);
    Reading.Read("seed", Fibre.Seed);
    Reading.Read("loop_seconds", Fibre.LoopSeconds);
    Reading.Read("scale", Fibre.Scale);
    Reading.Read("length_metres", Fibre.LengthMetres);
    Reading.Read("spread_metres", Fibre.SpreadMetres);
    Reading.Read("amplitude_metres", Fibre.AmplitudeMetres);
    Reading.Read("frequency", Fibre.Frequency);
    Reading.Read("sheet_width_metres", Fibre.SheetWidthMetres);
    Reading.Read("ripple", Fibre.Ripple);
    Reading.Read("waves", Fibre.Waves);
    Reading.Read("phase_spread", Fibre.PhaseSpread);
    Reading.Read("trail_length", Fibre.TrailLength);
    Reading.Read("path_shape", Fibre.PathShape);
    Reading.Read("path_size_metres", Fibre.PathSizeMetres);
    Reading.Read("harmonic", Fibre.Harmonic);
    Reading.Read("window_cycles", Fibre.WindowCycles);
    Reading.Read("window", Fibre.Window);
    Reading.Read("thickness", Fibre.Thickness);
    Reading.Read("taper", Fibre.Taper);
    Reading.Read("intensity", Fibre.Intensity);
    Reading.Read("halo", Fibre.Halo);
    Reading.Read("baseline", Fibre.Baseline);
    Reading.Read("colour_mode", Fibre.Colouring, ColouringSpellings);
    Reading.Read("accent_colour", Fibre.AccentColour);
    Reading.Read("accent_mix", Fibre.AccentMix);
    Reading.Read("sparks", Fibre.Sparks);
    Reading.Read("spark_size", Fibre.SparkSize);
    Reading.Read("spark_brightness", Fibre.SparkBrightness);
    Reading.Read("pulse_rate", Fibre.PulseRate);
    Reading.Read("pulse_depth", Fibre.PulseDepth);
    Reading.Read("pulse_shape", Fibre.Pulse, PulseSpellings);
    Fibre.Stops.clear();
    if (const toml::array* Stops = Keys["stop"].as_array())
    {
        for (const toml::node& Entry : *Stops)
        {
            if (const toml::table* Stop = Entry.as_table())
            {
                LightFibreStop Decoded;
                const auto     Position = (*Stop)["position"].value<double>();
                const toml::array* Colour = (*Stop)["colour"].as_array();
                if (Position)
                {
                    Decoded.Position = *Position;
                }
                if (Colour && Colour->size() == 4)
                {
                    for (size_t Channel = 0; Channel < 4; ++Channel)
                    {
                        Decoded.Colour[Channel] = (*Colour)[Channel].value<double>().value_or(1.0);
                    }
                }
                Fibre.Stops.push_back(Decoded);
            }
        }
    }
}

bool DecodeEffectParameters(const toml::table& Keys, ParticleEffectParameters& P, const std::string& Where, std::string& Diagnostic)
{
    KeyReading Reading(Keys, Where, Diagnostic);
    Reading.Read("behaviour", P.Behaviour, BehaviourSpellings);
    Reading.Read("appearance", P.Appearance, AppearanceSpellings);
    Reading.Read("leaf_surface", P.LeafSurface, LeafSurfaceSpellings);
    Reading.Read("blend", P.Blend, BlendSpellings);
    Reading.Read("release_shape", P.ReleaseShape, ReleaseShapeSpellings);
    Reading.Read("capacity", P.Capacity);
    Reading.Read("release_rate", P.ReleaseRate);
    Reading.Read("origin_metres", P.OriginMetres);
    Reading.Read("radius_metres", P.RadiusMetres);
    Reading.Read("box_half_metres", P.BoxHalfMetres);
    Reading.Read("direction", P.Direction);
    Reading.Read("spread_radians", P.SpreadRadians);
    Reading.Read("speed_minimum_mps", P.SpeedMinimum);
    Reading.Read("speed_maximum_mps", P.SpeedMaximum);
    Reading.Read("drag", P.Drag);
    Reading.Read("gravity", P.Gravity);
    Reading.Read("life_minimum_seconds", P.LifeMinimumSeconds);
    Reading.Read("life_maximum_seconds", P.LifeMaximumSeconds);
    Reading.Read("size_start_metres", P.SizeStartMetres);
    Reading.Read("size_end_metres", P.SizeEndMetres);
    Reading.Read("size_scale", P.SizeScale);
    Reading.Read("colour_a", P.ColourA);
    Reading.Read("colour_b", P.ColourB);
    Reading.Read("colour_c", P.ColourC);
    Reading.Read("wind_coupling", P.WindCoupling);
    Reading.Read("bounce", P.Bounce);
    Reading.Read("buoyancy", P.Buoyancy);
    Reading.Read("flutter", P.Flutter);
    Reading.Read("temperature", P.Temperature);
    Reading.Read("epsilon", P.Epsilon);
    Reading.Read("sigma", P.Sigma);
    Reading.Read("damping", P.Damping);
    Reading.Read("react_rate", P.ReactRate);
    Reading.Read("dissociation", P.Dissociation);
    Reading.Read("react_radius", P.ReactRadius);
    Reading.Read("fraction_a", P.FractionA);
    Reading.Read("integration_step_seconds", P.IntegrationStepSeconds);
    Reading.Read("pulse_hz", P.PulseHz);
    Reading.Read("pulse_depth", P.PulseDepth);
    Reading.Read("swarm_radius_metres", P.SwarmRadiusMetres);
    Reading.Read("burst_every_seconds", P.BurstEverySeconds);
    Reading.Read("burst_count", P.BurstCount);
    Reading.Read("burst_at_origin", P.BurstAtOrigin);
    Reading.Read("visible", P.Visible);

    if (const toml::table* Section = Keys["transition"].as_table())
    {
        KeyReading       SectionReading(*Section, Where + " transition", Diagnostic);
        ParticleTransition Decoded;
        std::string        After;
        SectionReading.Read("hold_minimum_seconds", Decoded.HoldMinimumSeconds);
        SectionReading.Read("hold_spread_seconds", Decoded.HoldSpreadSeconds);
        SectionReading.Read("burst_share", Decoded.BurstShare);
        SectionReading.Read("fragment", Decoded.Fragment);
        SectionReading.Read("fragment_life_seconds", Decoded.FragmentLifeSeconds);
        SectionReading.Read("wave", Decoded.Wave, WaveSpellings);
        SectionReading.ReadIntegral("assemble", Decoded.Assemble);
        SectionReading.Read("launch_distance_metres", Decoded.LaunchDistanceMetres);
        SectionReading.Read("after", After);
        Decoded.Butterflies = After == "butterfly";
        P.Transition        = Decoded;
    }
    if (const toml::table* Section = Keys["attractor"].as_table())
    {
        KeyReading      SectionReading(*Section, Where + " attractor", Diagnostic);
        ParticleAttractor Decoded;
        SectionReading.Read("enabled", Decoded.Enabled);
        SectionReading.Read("strength", Decoded.Strength);
        SectionReading.Read("radius_metres", Decoded.RadiusMetres);
        SectionReading.Read("swirl", Decoded.Swirl);
        SectionReading.Read("swallow_metres", Decoded.SwallowMetres);
        P.Attractor = Decoded;
    }
    if (const toml::table* Section = Keys["lensing"].as_table())
    {
        KeyReading    SectionReading(*Section, Where + " lensing", Diagnostic);
        ParticleLensing Decoded;
        SectionReading.Read("event_radius_metres", Decoded.EventRadiusMetres);
        SectionReading.Read("einstein_ratio", Decoded.EinsteinRatio);
        P.Lensing = Decoded;
    }
    if (const toml::table* Section = Keys["heat_shimmer"].as_table())
    {
        KeyReading        SectionReading(*Section, Where + " heat_shimmer", Diagnostic);
        ParticleHeatShimmer Decoded;
        SectionReading.Read("radius_metres", Decoded.RadiusMetres);
        SectionReading.Read("strength", Decoded.Strength);
        SectionReading.Read("frequency", Decoded.Frequency);
        SectionReading.Read("rate", Decoded.Rate);
        P.HeatShimmer = Decoded;
    }
    if (const toml::table* Section = Keys["magnetic_dipole"].as_table())
    {
        KeyReading           SectionReading(*Section, Where + " magnetic_dipole", Diagnostic);
        ParticleMagneticDipole Decoded;
        SectionReading.Read("strength", Decoded.Strength);
        SectionReading.Read("guide", Decoded.Guide);
        SectionReading.Read("radius_metres", Decoded.RadiusMetres);
        P.MagneticDipole = Decoded;
    }
    if (const toml::table* Section = Keys["light_fibre"].as_table())
    {
        KeyReading         SectionReading(*Section, Where + " light_fibre", Diagnostic);
        LightFibreParameters Decoded;
        DecodeLightFibre(*Section, Decoded, SectionReading);
        P.LightFibre = std::move(Decoded);
    }
    return Diagnostic.empty();
}

bool DecodePreset(const toml::table& Keys, ParticlePreset& Preset, size_t Index, std::string& Diagnostic)
{
    const std::string Where = "preset " + std::to_string(Index + 1);
    KeyReading        Reading(Keys, Where, Diagnostic);
    Reading.Read("identifier", Preset.Identifier);
    Reading.Read("name", Preset.Name);
    Reading.Read("group", Preset.Group);
    Reading.Read("blurb", Preset.Blurb);
    if (Preset.Identifier.empty() || Preset.Name.empty())
    {
        Diagnostic = Where + ": identifier and name are required";
        return false;
    }
    if (!DecodeEffectParameters(Keys, Preset.Parameters, Where, Diagnostic))
    {
        return false;
    }
    if (const toml::table* Link = Keys["wind_link"].as_table())
    {
        KeyReading     LinkReading(*Link, Where + " wind_link", Diagnostic);
        ParticleWindLink Decoded;
        std::string      Category;
        LinkReading.Read("category", Category);
        const ParticleFieldDescriptor* Descriptor = ResolveParticleFieldDescriptor(Category);
        if (!Descriptor || Descriptor->LatticeSlot < 0)
        {
            Diagnostic = Where + ": a wind link names a lattice flow, not \"" + Category + "\"";
            return false;
        }
        Decoded.Category = Descriptor->Category;
        LinkReading.Read("name", Decoded.Name);
        LinkReading.Read("local", Decoded.Local);
        LinkReading.Read("radius_metres", Decoded.RadiusMetres);
        LinkReading.Read("strength", Decoded.Strength);
        LinkReading.Read("bearing_degrees", Decoded.BearingDegrees);
        LinkReading.Read("rate_hz", Decoded.RateHz);
        Preset.WindLink = Decoded;
    }
    return Diagnostic.empty();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    SPELLING
//------------------------------------------------------------------------------------------------------------------------

// 📝 The spelling of a choice: the first name the decoder accepts for it.
template <typename Choice, size_t Count>
const char* Spell(Choice Value, const std::array<std::pair<const char*, Choice>, Count>& Spellings)
{
    for (const auto& [Spelling, Candidate] : Spellings)
    {
        if (Candidate == Value)
        {
            return Spelling;
        }
    }
    return Spellings.front().first;
}

template <size_t Count>
toml::array SpellNumbers(const std::array<double, Count>& Values)
{
    toml::array Array;
    for (const double Value : Values)
    {
        Array.push_back(Value);
    }
    return Array;
}

void EncodeLightFibre(const LightFibreParameters& Fibre, toml::table& Keys)
{
    Keys.insert_or_assign("shape", Spell(Fibre.Shape, FibreShapeSpellings));
    Keys.insert_or_assign("strands", static_cast<int64_t>(Fibre.Strands));
    Keys.insert_or_assign("segments", static_cast<int64_t>(Fibre.Segments));
    Keys.insert_or_assign("seed", static_cast<int64_t>(Fibre.Seed));
    Keys.insert_or_assign("loop_seconds", Fibre.LoopSeconds);
    Keys.insert_or_assign("scale", Fibre.Scale);
    Keys.insert_or_assign("length_metres", Fibre.LengthMetres);
    Keys.insert_or_assign("spread_metres", Fibre.SpreadMetres);
    Keys.insert_or_assign("amplitude_metres", Fibre.AmplitudeMetres);
    Keys.insert_or_assign("frequency", Fibre.Frequency);
    Keys.insert_or_assign("sheet_width_metres", Fibre.SheetWidthMetres);
    Keys.insert_or_assign("ripple", Fibre.Ripple);
    Keys.insert_or_assign("waves", Fibre.Waves);
    Keys.insert_or_assign("phase_spread", Fibre.PhaseSpread);
    Keys.insert_or_assign("trail_length", Fibre.TrailLength);
    Keys.insert_or_assign("path_shape", Fibre.PathShape);
    Keys.insert_or_assign("path_size_metres", Fibre.PathSizeMetres);
    Keys.insert_or_assign("harmonic", Fibre.Harmonic);
    Keys.insert_or_assign("window_cycles", Fibre.WindowCycles);
    Keys.insert_or_assign("window", Fibre.Window);
    Keys.insert_or_assign("thickness", Fibre.Thickness);
    Keys.insert_or_assign("taper", Fibre.Taper);
    Keys.insert_or_assign("intensity", Fibre.Intensity);
    Keys.insert_or_assign("halo", Fibre.Halo);
    Keys.insert_or_assign("baseline", Fibre.Baseline);
    Keys.insert_or_assign("colour_mode", Spell(Fibre.Colouring, ColouringSpellings));
    Keys.insert_or_assign("accent_colour", SpellNumbers(Fibre.AccentColour));
    Keys.insert_or_assign("accent_mix", Fibre.AccentMix);
    Keys.insert_or_assign("sparks", Fibre.Sparks);
    Keys.insert_or_assign("spark_size", Fibre.SparkSize);
    Keys.insert_or_assign("spark_brightness", Fibre.SparkBrightness);
    Keys.insert_or_assign("pulse_rate", Fibre.PulseRate);
    Keys.insert_or_assign("pulse_depth", Fibre.PulseDepth);
    Keys.insert_or_assign("pulse_shape", Spell(Fibre.Pulse, PulseSpellings));
    toml::array Stops;
    for (const LightFibreStop& Stop : Fibre.Stops)
    {
        Stops.push_back(toml::table{ { "position", Stop.Position }, { "colour", SpellNumbers(Stop.Colour) } });
    }
    Keys.insert_or_assign("stop", std::move(Stops));
}

bool ParseDocument(const std::filesystem::path& File, toml::table& Document, std::string& Diagnostic)
{
    std::filesystem::path Resolved = File;
    std::error_code       Ec;
    if (!std::filesystem::exists(Resolved, Ec))
    {
        if (Resolved.extension() == ".particlespace")
        {
            const std::filesystem::path Alt = Resolved.parent_path() / (Resolved.stem().string() + ".toml");
            if (std::filesystem::exists(Alt, Ec)) Resolved = Alt;
        }
        else if (Resolved.extension() == ".toml")
        {
            const std::filesystem::path Alt = Resolved.parent_path() / (Resolved.stem().string() + ".particlespace");
            if (std::filesystem::exists(Alt, Ec)) Resolved = Alt;
        }
    }
    try
    {
        Document = toml::parse_file(Resolved.string());
    }
    catch (const toml::parse_error& Error)
    {
        Diagnostic = Resolved.filename().string() + ": " + std::string(Error.description());
        return false;
    }
    if (const auto Format = Document["format"].value<std::string>())
    {
        if (*Format != "frontier.particlelibrary" && *Format != "frontier.particlespace")
        {
            Diagnostic = Resolved.filename().string() + ": unsupported format \"" + *Format + "\"";
            return false;
        }
        if (Document["version"].value<int64_t>().value_or(1) > 1)
        {
            Diagnostic = Resolved.filename().string() + ": unsupported format version";
            return false;
        }
    }
    return true;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    NAMES
//------------------------------------------------------------------------------------------------------------------------

const char* ResolveLightFibrePathName(uint32_t Index) noexcept
{
    return LightFibrePathNames[Index < LightFibrePathCount ? Index : 0u];
}

int32_t ResolveLightFibrePathIndex(std::string_view Name) noexcept
{
    for (uint32_t Index = 0; Index < LightFibrePathCount; ++Index)
    {
        if (Name == LightFibrePathNames[Index])
        {
            return static_cast<int32_t>(Index);
        }
    }
    return -1;
}

const char* ResolveParticleBehaviourLabel(ParticleBehaviour Behaviour) noexcept
{
    switch (Behaviour)
    {
    case ParticleBehaviour::Ballistic: return "Streak";
    case ParticleBehaviour::WindDriven: return "Wind-driven";
    case ParticleBehaviour::LennardJones: return "Molecular · LJ";
    case ParticleBehaviour::Reactive: return "Molecular · reactive";
    case ParticleBehaviour::VisualEffect: return "VFX";
    case ParticleBehaviour::Flocking: return "Swarm · flocking";
    case ParticleBehaviour::LightFibre: return "Light fibres";
    }
    return "Particles";
}

bool EvaluateParticleMolecular(const ParticleEffectParameters& Parameters) noexcept
{
    return Parameters.Behaviour == ParticleBehaviour::LennardJones || Parameters.Behaviour == ParticleBehaviour::Reactive;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    CODEC
//------------------------------------------------------------------------------------------------------------------------

bool DecodeParticleEffectParameters(const toml::table& Keys, ParticleEffectParameters& Parameters, const std::string& Where, std::string& Diagnostic)
{
    return DecodeEffectParameters(Keys, Parameters, Where, Diagnostic);
}

void EncodeParticleEffectParameters(const ParticleEffectParameters& P, toml::table& Keys)
{
    Keys.insert_or_assign("behaviour", Spell(P.Behaviour, BehaviourSpellings));
    Keys.insert_or_assign("appearance", Spell(P.Appearance, AppearanceSpellings));
    Keys.insert_or_assign("leaf_surface", Spell(P.LeafSurface, LeafSurfaceSpellings));
    Keys.insert_or_assign("blend", Spell(P.Blend, BlendSpellings));
    Keys.insert_or_assign("release_shape", Spell(P.ReleaseShape, ReleaseShapeSpellings));
    Keys.insert_or_assign("capacity", static_cast<int64_t>(P.Capacity));
    Keys.insert_or_assign("release_rate", P.ReleaseRate);
    Keys.insert_or_assign("origin_metres", SpellNumbers(P.OriginMetres));
    Keys.insert_or_assign("radius_metres", P.RadiusMetres);
    Keys.insert_or_assign("box_half_metres", SpellNumbers(P.BoxHalfMetres));
    Keys.insert_or_assign("direction", SpellNumbers(P.Direction));
    Keys.insert_or_assign("spread_radians", P.SpreadRadians);
    Keys.insert_or_assign("speed_minimum_mps", P.SpeedMinimum);
    Keys.insert_or_assign("speed_maximum_mps", P.SpeedMaximum);
    Keys.insert_or_assign("drag", P.Drag);
    Keys.insert_or_assign("gravity", P.Gravity);
    Keys.insert_or_assign("life_minimum_seconds", P.LifeMinimumSeconds);
    Keys.insert_or_assign("life_maximum_seconds", P.LifeMaximumSeconds);
    Keys.insert_or_assign("size_start_metres", P.SizeStartMetres);
    Keys.insert_or_assign("size_end_metres", P.SizeEndMetres);
    Keys.insert_or_assign("size_scale", P.SizeScale);
    Keys.insert_or_assign("colour_a", SpellNumbers(P.ColourA));
    Keys.insert_or_assign("colour_b", SpellNumbers(P.ColourB));
    Keys.insert_or_assign("colour_c", SpellNumbers(P.ColourC));
    Keys.insert_or_assign("wind_coupling", P.WindCoupling);
    Keys.insert_or_assign("bounce", P.Bounce);
    Keys.insert_or_assign("buoyancy", P.Buoyancy);
    Keys.insert_or_assign("flutter", P.Flutter);
    Keys.insert_or_assign("temperature", P.Temperature);
    Keys.insert_or_assign("epsilon", P.Epsilon);
    Keys.insert_or_assign("sigma", P.Sigma);
    Keys.insert_or_assign("damping", P.Damping);
    Keys.insert_or_assign("react_rate", P.ReactRate);
    Keys.insert_or_assign("dissociation", P.Dissociation);
    Keys.insert_or_assign("react_radius", P.ReactRadius);
    Keys.insert_or_assign("fraction_a", P.FractionA);
    Keys.insert_or_assign("integration_step_seconds", P.IntegrationStepSeconds);
    Keys.insert_or_assign("pulse_hz", P.PulseHz);
    Keys.insert_or_assign("pulse_depth", P.PulseDepth);
    Keys.insert_or_assign("swarm_radius_metres", P.SwarmRadiusMetres);
    Keys.insert_or_assign("burst_every_seconds", P.BurstEverySeconds);
    Keys.insert_or_assign("burst_count", static_cast<int64_t>(P.BurstCount));
    Keys.insert_or_assign("burst_at_origin", P.BurstAtOrigin);
    Keys.insert_or_assign("visible", P.Visible);
    if (P.Transition)
    {
        const ParticleTransition& T = *P.Transition;
        Keys.insert_or_assign("transition", toml::table{ { "hold_minimum_seconds", T.HoldMinimumSeconds },
                                                         { "hold_spread_seconds", T.HoldSpreadSeconds },
                                                         { "burst_share", T.BurstShare },
                                                         { "fragment", T.Fragment },
                                                         { "fragment_life_seconds", T.FragmentLifeSeconds },
                                                         { "wave", Spell(T.Wave, WaveSpellings) },
                                                         { "assemble", static_cast<int64_t>(T.Assemble) },
                                                         { "launch_distance_metres", T.LaunchDistanceMetres },
                                                         { "after", T.Butterflies ? "butterfly" : "none" } });
    }
    if (P.Attractor)
    {
        const ParticleAttractor& A = *P.Attractor;
        Keys.insert_or_assign("attractor", toml::table{ { "enabled", A.Enabled },
                                                        { "strength", A.Strength },
                                                        { "radius_metres", A.RadiusMetres },
                                                        { "swirl", A.Swirl },
                                                        { "swallow_metres", A.SwallowMetres } });
    }
    if (P.Lensing)
    {
        Keys.insert_or_assign("lensing", toml::table{ { "event_radius_metres", P.Lensing->EventRadiusMetres },
                                                      { "einstein_ratio", P.Lensing->EinsteinRatio } });
    }
    if (P.HeatShimmer)
    {
        const ParticleHeatShimmer& H = *P.HeatShimmer;
        Keys.insert_or_assign("heat_shimmer", toml::table{ { "radius_metres", H.RadiusMetres },
                                                           { "strength", H.Strength },
                                                           { "frequency", H.Frequency },
                                                           { "rate", H.Rate } });
    }
    if (P.MagneticDipole)
    {
        const ParticleMagneticDipole& M = *P.MagneticDipole;
        Keys.insert_or_assign("magnetic_dipole", toml::table{ { "strength", M.Strength },
                                                              { "guide", M.Guide },
                                                              { "radius_metres", M.RadiusMetres } });
    }
    if (P.LightFibre)
    {
        toml::table Fibre;
        EncodeLightFibre(*P.LightFibre, Fibre);
        Keys.insert_or_assign("light_fibre", std::move(Fibre));
    }
}

bool DecodeParticleField(const toml::table& Keys, ParticleField& Field, const std::string& Where, std::string& Diagnostic)
{
    return DecodeField(Keys, Field, Where, Diagnostic);
}

void EncodeParticleField(const ParticleField& Field, toml::table& Keys)
{
    Keys.insert_or_assign("category", ResolveParticleFieldDescriptor(Field.Category).Identifier);
    Keys.insert_or_assign("name", Field.Name);
    Keys.insert_or_assign("enabled", Field.Enabled);
    Keys.insert_or_assign("centre_metres", SpellNumbers(Field.Centre));
    Keys.insert_or_assign("direction", SpellNumbers(Field.Direction));
    Keys.insert_or_assign("strength", Field.Strength);
    Keys.insert_or_assign("radius_metres", Field.Radius);
    Keys.insert_or_assign("reach", Spell(Field.Reach, ReachSpellings));
    Keys.insert_or_assign("falloff", Spell(Field.Falloff, FalloffSpellings));
    Keys.insert_or_assign("swirl", Field.Swirl);
    Keys.insert_or_assign("rate_hz", Field.Rate);
    Keys.insert_or_assign("swallow_metres", Field.Swallow);
    toml::array ActsOn;
    for (const std::string& Channel : Field.ActsOn)
    {
        ActsOn.push_back(Channel);
    }
    Keys.insert_or_assign("acts_on", std::move(ActsOn));
    Keys.insert_or_assign("begins_seconds", Field.Begins);
    Keys.insert_or_assign("lasts_seconds", Field.Lasts);
    Keys.insert_or_assign("repeats_seconds", Field.Repeats);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    LIBRARY
//------------------------------------------------------------------------------------------------------------------------

bool DecodeParticleFields(const std::filesystem::path& File, std::vector<ParticleField>& Fields, std::string& Diagnostic)
{
    toml::table Document;
    if (!ParseDocument(File, Document, Diagnostic))
    {
        return false;
    }
    Fields.clear();
    if (const toml::array* Records = Document["force"].as_array())
    {
        for (size_t Index = 0; Index < Records->size(); ++Index)
        {
            const toml::table* Entry = (*Records)[Index].as_table();
            ParticleField      Field;
            if (!Entry || !DecodeField(*Entry, Field, "force " + std::to_string(Index + 1), Diagnostic))
            {
                return false;
            }
            Fields.push_back(std::move(Field));
        }
    }
    return true;
}

bool ParticleEffectLibrary::Decode(const std::filesystem::path& File, std::string& Diagnostic)
{
    *this = ParticleEffectLibrary{};
    toml::table Document;
    if (!ParseDocument(File, Document, Diagnostic))
    {
        return false;
    }
    if (const toml::table* Library = Document["library"].as_table())
    {
        KeyReading Reading(*Library, "library", Diagnostic);
        Reading.Read("source", Source);
        Reading.Read("presets_sha256", PresetsDigest);
        Reading.Read("groups", Groups);
        Reading.Read("default_scene", DefaultScene);
    }
    if (const toml::table* WindKeys = Document["wind"].as_table())
    {
        KeyReading Reading(*WindKeys, "wind", Diagnostic);
        Reading.Read("wind_scale", Wind.WindScale);
        Reading.Read("turbulence", Wind.Turbulence);
        Reading.Read("arrow_reference_mps", Wind.ArrowReferenceMps);
        Reading.Read("arrow_stride", Wind.ArrowStride);
        Reading.Read("show_arrows", Wind.ShowArrows);
        Reading.Read("show_floor", Wind.ShowFloor);
        Reading.Read("show_domain", Wind.ShowDomain);
        Reading.Read("swirl", Wind.Swirl);
    }
    if (!Diagnostic.empty())
    {
        return false;
    }
    if (!DecodeParticleFields(File, Fields, Diagnostic))
    {
        return false;
    }
    const toml::array* Records = Document["preset"].as_array();
    if (!Records || Records->empty())
    {
        Diagnostic = File.filename().string() + " holds no [[preset]] records";
        return false;
    }
    for (size_t Index = 0; Index < Records->size(); ++Index)
    {
        const toml::table* Entry = (*Records)[Index].as_table();
        ParticlePreset     Preset;
        if (!Entry || !DecodePreset(*Entry, Preset, Index, Diagnostic))
        {
            return false;
        }
        if (ResolvePreset(Preset.Identifier))
        {
            Diagnostic = "preset \"" + Preset.Identifier + "\" is listed twice";
            return false;
        }
        if (std::find(Groups.begin(), Groups.end(), Preset.Group) == Groups.end())
        {
            Groups.push_back(Preset.Group);
        }
        Presets.push_back(std::move(Preset));
    }
    for (const std::string& Identifier : DefaultScene)
    {
        if (!ResolvePreset(Identifier))
        {
            Diagnostic = "default_scene names an unknown preset \"" + Identifier + "\"";
            return false;
        }
    }
    return true;
}

const ParticlePreset* ParticleEffectLibrary::ResolvePreset(std::string_view Identifier) const noexcept
{
    for (const ParticlePreset& Preset : Presets)
    {
        if (Preset.Identifier == Identifier)
        {
            return &Preset;
        }
    }
    return nullptr;
}

} // namespace Frontier
