/*==========================================================================================================================================
                                                           PARTICLESPACECODEC.CPP
==========================================================================================================================================*/
// 🧩 The `.particlespace` document written and read with toml++, through the library's parameter and force spellings.

#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleSpaceCodec.h"

#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleEffectCodec.h"

#include <toml++/toml.hpp>

#include <algorithm>
#include <atomic>
#include <fstream>
#include <sstream>
#include <system_error>

namespace Frontier
{

namespace
{

toml::array SpellPoint(const std::array<double, 3>& Point)
{
    return toml::array{ Point[0], Point[1], Point[2] };
}

void ReadPoint(const toml::node_view<const toml::node>& Node, std::array<double, 3>& Point)
{
    if (const toml::array* Values = Node.as_array(); Values && Values->size() == 3)
    {
        for (size_t Axis = 0; Axis < 3; ++Axis) Point[Axis] = (*Values)[Axis].value<double>().value_or(Point[Axis]);
    }
}

template <typename Value> void ReadValue(const toml::table* Section, const char* Key, Value& Target)
{
    if (Section == nullptr) return;
    if constexpr (std::is_same_v<Value, uint32_t> || std::is_same_v<Value, int32_t>)
    {
        if (const auto Reading = (*Section)[Key].value<int64_t>()) Target = static_cast<Value>(*Reading);
    }
    else if (const auto Reading = (*Section)[Key].value<Value>())
    {
        Target = *Reading;
    }
}

// 📝 Every loaded effect asks the GPU for fresh stores: a token the previous space also used must not inherit its particles.
uint64_t ResolveLoadGeneration()
{
    static std::atomic<uint64_t> Loads{ 0 };
    return (++Loads) << 32u;
}

bool ParseText(std::string_view Text, toml::table& Document, std::string& Diagnostic)
{
    try
    {
        Document = toml::parse(Text);
    }
    catch (const toml::parse_error& Error)
    {
        Diagnostic = std::string(Error.description());
        return false;
    }
    if (Document["format"].value<std::string>().value_or("") != ParticleSpaceFormat)
    {
        Diagnostic = "not a particle space (format must be \"" + std::string(ParticleSpaceFormat) + "\")";
        return false;
    }
    if (Document["version"].value<int64_t>().value_or(0) > ParticleSpaceVersion)
    {
        Diagnostic = "written by a newer Frontier (version " + std::to_string(Document["version"].value<int64_t>().value_or(0)) + ")";
        return false;
    }
    return true;
}

bool ReadText(const std::filesystem::path& File, std::string& Text, std::string& Diagnostic)
{
    std::ifstream Stream(File, std::ios::binary);
    if (!Stream)
    {
        Diagnostic = "cannot open " + File.filename().string();
        return false;
    }
    std::ostringstream Gathered;
    Gathered << Stream.rdbuf();
    Text = Gathered.str();
    return true;
}

} // namespace

std::string EncodeParticleSpace(const ParticleSpace& Space)
{
    toml::table Document;
    Document.insert_or_assign("format", std::string(ParticleSpaceFormat));
    Document.insert_or_assign("version", ParticleSpaceVersion);
    Document.insert_or_assign("next_number", static_cast<int64_t>(Space.NextNumber));
    Document.insert_or_assign("clock", toml::table{ { "playing", Space.Playing }, { "time_scale", Space.TimeScale } });
    Document.insert_or_assign("camera", toml::table{ { "yaw_radians", Space.Camera.Yaw },
                                                     { "pitch_radians", Space.Camera.Pitch },
                                                     { "distance_metres", Space.Camera.Distance },
                                                     { "target_metres", SpellPoint(Space.Camera.Target) } });
    Document.insert_or_assign("wind", toml::table{ { "wind_scale", Space.Wind.WindScale },
                                                   { "turbulence", Space.Wind.Turbulence },
                                                   { "arrow_reference_mps", Space.Wind.ArrowReferenceMps },
                                                   { "arrow_stride", Space.Wind.ArrowStride },
                                                   { "show_arrows", Space.Wind.ShowArrows },
                                                   { "show_floor", Space.Wind.ShowFloor },
                                                   { "show_domain", Space.Wind.ShowDomain },
                                                   { "swirl", Space.Wind.Swirl } });
    Document.insert_or_assign("lightning", toml::table{ { "automatic", Space.Lightning.Automatic },
                                                        { "interval_minimum_seconds", Space.Lightning.IntervalMinimum },
                                                        { "interval_maximum_seconds", Space.Lightning.IntervalMaximum },
                                                        { "distance_metres", Space.Lightning.DistanceMetres },
                                                        { "amplitude_metres", Space.Lightning.Amplitude },
                                                        { "levels", static_cast<int64_t>(Space.Lightning.Levels) },
                                                        { "branch_chance", Space.Lightning.BranchChance } });
    Document.insert_or_assign("lightning_web", toml::table{ { "enabled", Space.LightningWeb.Enabled },
                                                            { "interval_seconds", Space.LightningWeb.IntervalSeconds },
                                                            { "links", static_cast<int64_t>(Space.LightningWeb.Links) } });
    Document.insert_or_assign("probe", toml::table{ { "enabled", Space.ProbeEnabled }, { "position_metres", SpellPoint(Space.Probe) } });
    Document.insert_or_assign("level_wind", toml::table{ { "follow", Space.LevelWind.Follow }, { "anchor_metres", SpellPoint(Space.LevelWind.AnchorMetres) } });
    toml::table SpatialKeys;
    EncodeSpaceTable(SpatialKeys, Space.Spatial);
    Document.insert_or_assign("spatial", std::move(SpatialKeys));
    toml::table MassKeys;
    EncodeSpaceTable(MassKeys, Space.Mass);
    Document.insert_or_assign("mass", std::move(MassKeys));
    toml::table ReplicationKeys;
    EncodeSpaceTable(ReplicationKeys, Space.Replication);
    Document.insert_or_assign("replication", std::move(ReplicationKeys));
    toml::array Forces;
    for (const ParticleField& Field : Space.Fields)
    {
        toml::table Keys;
        EncodeParticleField(Field, Keys);
        Forces.push_back(std::move(Keys));
    }
    Document.insert_or_assign("force", std::move(Forces));
    toml::array Effects;
    for (const ParticleEffectInstance& Effect : Space.Effects)
    {
        toml::table Keys;
        Keys.insert_or_assign("preset", Effect.PresetIdentifier);
        Keys.insert_or_assign("name", Effect.Name);
        Keys.insert_or_assign("number", static_cast<int64_t>(Effect.Number));
        if (Effect.OverrideOrigin) Keys.insert_or_assign("origin_override_metres", SpellPoint(*Effect.OverrideOrigin));
        EncodeParticleEffectParameters(Effect.Parameters, Keys);
        toml::table EffectSpatial;
        EncodeSpaceTable(EffectSpatial, Effect.Spatial);
        Keys.insert_or_assign("spatial", std::move(EffectSpatial));
        toml::table EffectMass;
        EncodeSpaceTable(EffectMass, Effect.Mass);
        Keys.insert_or_assign("mass", std::move(EffectMass));
        toml::table EffectReplication;
        EncodeSpaceTable(EffectReplication, Effect.Replication);
        Keys.insert_or_assign("replication", std::move(EffectReplication));
        Effects.push_back(std::move(Keys));
    }
    Document.insert_or_assign("effect", std::move(Effects));
    toml::array Rules;
    for (const ParticleTriggerRule& Rule : Space.TriggerRules)
    {
        toml::table Keys;
        EncodeSpaceTable(Keys, Rule);
        Rules.push_back(std::move(Keys));
    }
    Document.insert_or_assign("rule", std::move(Rules));
    std::ostringstream Out;
    Out << "# Frontier particle space: the effects, force fields, wind and lightning of one Particles record.\n" << Document << '\n';
    return Out.str();
}

bool DecodeParticleSpace(std::string_view Text, ParticleSpace& Space, std::string& Diagnostic)
{
    toml::table Document;
    if (!ParseText(Text, Document, Diagnostic)) return false;
    ParticleSpace Loaded;
    ReadValue(Document["clock"].as_table(), "playing", Loaded.Playing);
    ReadValue(Document["clock"].as_table(), "time_scale", Loaded.TimeScale);
    if (const toml::table* Camera = Document["camera"].as_table())
    {
        ReadValue(Camera, "yaw_radians", Loaded.Camera.Yaw);
        ReadValue(Camera, "pitch_radians", Loaded.Camera.Pitch);
        ReadValue(Camera, "distance_metres", Loaded.Camera.Distance);
        ReadPoint((*Camera)["target_metres"], Loaded.Camera.Target);
    }
    if (const toml::table* Wind = Document["wind"].as_table())
    {
        ReadValue(Wind, "wind_scale", Loaded.Wind.WindScale);
        ReadValue(Wind, "turbulence", Loaded.Wind.Turbulence);
        ReadValue(Wind, "arrow_reference_mps", Loaded.Wind.ArrowReferenceMps);
        ReadValue(Wind, "arrow_stride", Loaded.Wind.ArrowStride);
        ReadValue(Wind, "show_arrows", Loaded.Wind.ShowArrows);
        ReadValue(Wind, "show_floor", Loaded.Wind.ShowFloor);
        ReadValue(Wind, "show_domain", Loaded.Wind.ShowDomain);
        ReadValue(Wind, "swirl", Loaded.Wind.Swirl);
    }
    if (const toml::table* Lightning = Document["lightning"].as_table())
    {
        ReadValue(Lightning, "automatic", Loaded.Lightning.Automatic);
        ReadValue(Lightning, "interval_minimum_seconds", Loaded.Lightning.IntervalMinimum);
        ReadValue(Lightning, "interval_maximum_seconds", Loaded.Lightning.IntervalMaximum);
        ReadValue(Lightning, "distance_metres", Loaded.Lightning.DistanceMetres);
        ReadValue(Lightning, "amplitude_metres", Loaded.Lightning.Amplitude);
        ReadValue(Lightning, "levels", Loaded.Lightning.Levels);
        ReadValue(Lightning, "branch_chance", Loaded.Lightning.BranchChance);
    }
    if (const toml::table* Web = Document["lightning_web"].as_table())
    {
        ReadValue(Web, "enabled", Loaded.LightningWeb.Enabled);
        ReadValue(Web, "interval_seconds", Loaded.LightningWeb.IntervalSeconds);
        ReadValue(Web, "links", Loaded.LightningWeb.Links);
    }
    if (const toml::table* Probe = Document["probe"].as_table())
    {
        ReadValue(Probe, "enabled", Loaded.ProbeEnabled);
        ReadPoint((*Probe)["position_metres"], Loaded.Probe);
    }
    if (const toml::table* Level = Document["level_wind"].as_table())
    {
        ReadValue(Level, "follow", Loaded.LevelWind.Follow);
        ReadPoint((*Level)["anchor_metres"], Loaded.LevelWind.AnchorMetres);
    }
    if (const toml::table* Spatial = Document["spatial"].as_table()) DecodeSpaceTable(*Spatial, Loaded.Spatial);
    if (const toml::table* Mass = Document["mass"].as_table()) DecodeSpaceTable(*Mass, Loaded.Mass);
    if (const toml::table* Replication = Document["replication"].as_table()) DecodeSpaceTable(*Replication, Loaded.Replication);
    if (const toml::array* Forces = Document["force"].as_array())
    {
        for (size_t Index = 0; Index < Forces->size(); ++Index)
        {
            const toml::table* Keys = (*Forces)[Index].as_table();
            ParticleField      Field;
            if (Keys == nullptr || !DecodeParticleField(*Keys, Field, "force " + std::to_string(Index + 1), Diagnostic)) return false;
            Loaded.Fields.push_back(std::move(Field));
        }
    }
    uint32_t       Highest    = 0;
    const uint64_t Generation = ResolveLoadGeneration();
    if (const toml::array* Effects = Document["effect"].as_array())
    {
        for (size_t Index = 0; Index < Effects->size(); ++Index)
        {
            const toml::table* Keys  = (*Effects)[Index].as_table();
            const std::string  Where = "effect " + std::to_string(Index + 1);
            if (Keys == nullptr)
            {
                Diagnostic = Where + ": not a table";
                return false;
            }
            ParticleEffectInstance Effect;
            Effect.PresetIdentifier = (*Keys)["preset"].value<std::string>().value_or("");
            Effect.Name             = (*Keys)["name"].value<std::string>().value_or(Effect.PresetIdentifier);
            Effect.Number           = static_cast<uint32_t>((*Keys)["number"].value<int64_t>().value_or(static_cast<int64_t>(Index + 1)));
            Effect.Token            = "fx_" + std::to_string(Effect.Number);
            Effect.StoreGeneration  = Generation;
            if ((*Keys)["origin_override_metres"].as_array())
            {
                std::array<double, 3> Origin{};
                ReadPoint((*Keys)["origin_override_metres"], Origin);
                Effect.OverrideOrigin = Origin;
            }
            if (!DecodeParticleEffectParameters(*Keys, Effect.Parameters, Where, Diagnostic)) return false;
            if (const toml::table* EffectSpatial = (*Keys)["spatial"].as_table()) DecodeSpaceTable(*EffectSpatial, Effect.Spatial);
            if (const toml::table* EffectMass = (*Keys)["mass"].as_table()) DecodeSpaceTable(*EffectMass, Effect.Mass);
            if (const toml::table* EffectReplication = (*Keys)["replication"].as_table()) DecodeSpaceTable(*EffectReplication, Effect.Replication);
            if (std::any_of(Loaded.Effects.begin(), Loaded.Effects.end(), [&](const ParticleEffectInstance& Other) { return Other.Token == Effect.Token; }))
            {
                Diagnostic = Where + ": number " + std::to_string(Effect.Number) + " is used twice";
                return false;
            }
            Highest = std::max(Highest, Effect.Number);
            Loaded.Effects.push_back(std::move(Effect));
        }
    }
    Loaded.NextNumber = std::max<uint32_t>(Highest + 1, static_cast<uint32_t>(Document["next_number"].value<int64_t>().value_or(1)));
    if (const toml::array* Rules = Document["rule"].as_array())
    {
        for (size_t Index = 0; Index < Rules->size(); ++Index)
        {
            if (const toml::table* Keys = (*Rules)[Index].as_table())
            {
                ParticleTriggerRule Rule;
                DecodeSpaceTable(*Keys, Rule);
                Loaded.TriggerRules.push_back(std::move(Rule));
            }
        }
    }
    Space             = std::move(Loaded);
    return true;
}

bool WriteParticleSpace(const ParticleSpace& Space, const std::filesystem::path& File, std::string& Diagnostic)
{
    std::error_code Failure;
    if (File.has_parent_path()) std::filesystem::create_directories(File.parent_path(), Failure);
    const std::filesystem::path Staged = File.string() + ".writing";
    {
        std::ofstream Stream(Staged, std::ios::binary | std::ios::trunc);
        if (!Stream)
        {
            Diagnostic = "cannot write " + File.filename().string();
            return false;
        }
        Stream << EncodeParticleSpace(Space);
        if (!Stream)
        {
            Diagnostic = "writing " + File.filename().string() + " failed";
            return false;
        }
    }
    std::filesystem::rename(Staged, File, Failure);
    if (Failure)
    {
        Diagnostic = "cannot replace " + File.filename().string() + ": " + Failure.message();
        return false;
    }
    return true;
}

bool ReadParticleSpace(const std::filesystem::path& File, ParticleSpace& Space, std::string& Diagnostic)
{
    std::string Text;
    if (!ReadText(File, Text, Diagnostic)) return false;
    if (!DecodeParticleSpace(Text, Space, Diagnostic))
    {
        Diagnostic = File.filename().string() + ": " + Diagnostic;
        return false;
    }
    return true;
}

bool SummarizeParticleSpace(const std::filesystem::path& File, ParticleSpaceSummary& Summary, std::string& Diagnostic)
{
    ParticleSpace Space;
    if (!ReadParticleSpace(File, Space, Diagnostic)) return false;
    Summary                = {};
    Summary.Effects        = Space.Effects.size();
    Summary.VisibleEffects = static_cast<size_t>(std::count_if(Space.Effects.begin(), Space.Effects.end(),
                                                               [](const ParticleEffectInstance& Effect) { return Effect.Parameters.Visible; }));
    Summary.Forces         = Space.Fields.size();
    Summary.EnabledForces  = static_cast<size_t>(std::count_if(Space.Fields.begin(), Space.Fields.end(), [](const ParticleField& Field) { return Field.Enabled; }));
    Summary.WindScale      = Space.Wind.WindScale;
    Summary.Lightning      = Space.Lightning.Automatic || Space.LightningWeb.Enabled;
    return true;
}

} // namespace Frontier
