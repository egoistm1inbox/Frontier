/*==========================================================================================================================================
                                                      DYNAMICSSPACECODECS.CPP
==========================================================================================================================================*/
// 🧩 Declarative SpaceCodec serialization tables for dynamics, force-field, particle, fluid, fracture, and geometry records.

#include "Engine/PhysicalDynamics/ForceSourceCatalogue.h"
#include "Frontier/Engine/Scene/ConfigurationTableCodec.h"
#include "Frontier/Engine/Scene/WorldSpace.h"

#include <algorithm>
#include <cmath>

namespace Frontier
{

namespace
{

constexpr const char* ContributionNames[] = {"flow", "accelerate", "damp"};
constexpr const char* QuantityNames[]     = {"speed", "along_x", "along_z", "vertical", "vorticity", "divergence"};
constexpr const char* ProjectionNames[]   = {"map", "oblique"};

template <typename Choice, size_t Count>
[[nodiscard]] const char* NameChoice(Choice Value, const char* const (&Names)[Count]) noexcept
{
    return Names[std::min<size_t>(static_cast<size_t>(Value), Count - 1)];
}

template <typename Choice, size_t Count>
[[nodiscard]] Choice ReadChoice(const toml::table&  Table,
                                std::string_view    Key,
                                Choice              Fallback,
                                const char* const (&Names)[Count])
{
    if (const auto Name = Table[Key].value<std::string>())
    {
        for (size_t Index = 0; Index < Count; ++Index)
        {
            if (*Name == Names[Index])
            {
                return static_cast<Choice>(Index);
            }
        }
    }
    return Fallback;
}

[[nodiscard]] toml::array WriteReceivers(uint32_t Receivers)
{
    toml::array Array;
    for (const ForceReceiverDescriptor& Receiver : EnumerateForceReceivers())
    {
        if (Receivers & Receiver.Receiver)
        {
            Array.push_back(std::string(Receiver.Identifier));
        }
    }
    return Array;
}

[[nodiscard]] uint32_t ReadReceivers(const toml::table& Table, std::string_view Key, uint32_t Fallback)
{
    const toml::array* Array = Table[Key].as_array();
    if (!Array)
    {
        return Fallback;
    }
    uint32_t Receivers = 0;
    for (size_t Index = 0; Index < Array->size(); ++Index)
    {
        if (const auto Name = (*Array)[Index].value<std::string>())
        {
            for (const ForceReceiverDescriptor& Receiver : EnumerateForceReceivers())
            {
                if (*Name == Receiver.Identifier)
                {
                    Receivers |= Receiver.Receiver;
                }
            }
        }
    }
    return Receivers;
}

} // namespace

template <>
struct SpaceSchema<WindConfiguration>
{
    static constexpr auto Bindings() noexcept
    {
        using Cfg = WindConfiguration;
        return std::make_tuple(
            MakeFieldBinding("enabled", &Cfg::Enabled),
            MakeFieldBinding("direction_deg", &Cfg::DirectionDegrees),
            MakeFieldBinding("speed_mps", &Cfg::SpeedMetresPerSecond),
            MakeFieldBinding("turbulence", &Cfg::CurlNoiseTurbulence),
            MakeFieldBinding("gust_amplitude", &Cfg::GustAmplitude),
            MakeFieldBinding("curl_frequency_hz", &Cfg::CurlFrequencyHz),
            MakeFieldBinding("advect_clouds", &Cfg::AdvectClouds),
            MakeFieldBinding("advect_plumes", &Cfg::AdvectPlumes),
            MakeFieldBinding("advect_particles", &Cfg::AdvectParticles),
            MakeFieldBinding("gust_frequency_hz", &Cfg::GustFrequencyHz),
            MakeFieldBinding("turbulence_scale_metres", &Cfg::TurbulenceScaleMetres),
            MakeFieldBinding("gust_strength", &Cfg::GustStrength),
            MakeFieldBinding("bounded_region", &Cfg::Bounded),
            MakeClampedField("region_radius_metres", &Cfg::RegionRadiusMetres, 100.0, 50000.0),
            MakeFieldBinding("shear_per_kilometre", &Cfg::ShearPerKilometre),
            MakeFieldBinding("veer_degrees_per_kilometre", &Cfg::VeerDegreesPerKilometre),
            MakeFieldBinding("ground_height_metres", &Cfg::GroundHeightMetres),
            MakeFieldBinding("seed", &Cfg::Seed),
            MakeClampedField("mesoscale_scale_metres", &Cfg::MesoscaleScaleMetres, 0.0, 200000.0),
            MakeClampedField("mesoscale_strength", &Cfg::MesoscaleStrength, 0.0, 1.0));
    }
};

template <>
struct SpaceSchema<ForceFieldConfiguration>
{
    static constexpr auto Bindings() noexcept
    {
        using Cfg = ForceFieldConfiguration;
        return std::make_tuple(
            MakeFieldBinding("enabled", &Cfg::Enabled),
            MakeFieldBinding("visualize", &Cfg::Visualize),
            MakeFieldBinding("include_turbulence", &Cfg::IncludeTurbulence),
            MakeClampedField("grid_resolution", &Cfg::GridResolution, 3, 8),
            MakeClampedField("arrow_seconds", &Cfg::ArrowSeconds, 0.05, 2.0),
            MakeFieldBinding("centre_metres", &Cfg::CentreMetres),
            MakeFieldBinding("half_extents_metres", &Cfg::HalfExtentsMetres),
            MakeClampedField("cascades", &Cfg::Cascades, 1, kMaximumForceCascades),
            MakeClampedField("finest_cell_metres", &Cfg::FinestCellMetres, 0.25, 1000.0),
            MakeClampedField("cells_per_side", &Cfg::CellsPerSide, 16, 512),
            MakeClampedField("vertical_cells", &Cfg::VerticalCells, 4, 128),
            MakeClampedField("extent_metres", &Cfg::ExtentMetres, 100.0, 400000.0),
            MakeFieldBinding("automatic_scale", &Cfg::AutomaticScale),
            MakeClampedField("fixed_scale", &Cfg::FixedScale, 0.01, 1000.0),
            MakeFieldBinding("heatmap", &Cfg::Heatmap),
            MakeFieldBinding("smooth_heatmap", &Cfg::SmoothHeatmap),
            MakeFieldBinding("arrows", &Cfg::Arrows),
            MakeFieldBinding("tracers", &Cfg::Tracers),
            MakeFieldBinding("show_cascades", &Cfg::ShowCascades),
            MakeFieldBinding("labels", &Cfg::Labels),
            MakeFieldBinding("scene_overlay", &Cfg::SceneOverlay),
            MakeClampedField("slice_height_metres", &Cfg::SliceHeightMetres, 0.0, 12000.0),
            MakeClampedField("heatmap_opacity", &Cfg::HeatmapOpacity, 0.0, 1.0e6),
            MakeClampedField("arrow_spacing_pixels", &Cfg::ArrowSpacingPixels, 16.0, 120.0),
            MakeClampedField("tracer_count", &Cfg::TracerCount, 0, 2000),
            MakeClampedField("cell_pixels", &Cfg::CellPixels, 2.0, 24.0),
            MakeClampedField("timeline_duration_seconds", &Cfg::TimelineDurationSeconds, 5.0, 3600.0),
            MakeClampedField("timeline_rate", &Cfg::TimelineRate, 0.0, 16.0),
            MakeFieldBinding("timeline_playing", &Cfg::TimelinePlaying));
    }
};

template <>
struct SpaceSchema<FluidPlumeConfiguration>
{
    static constexpr auto Bindings() noexcept
    {
        using Cfg = FluidPlumeConfiguration;
        return std::make_tuple(
            MakeFieldBinding("enabled", &Cfg::Enabled),
            MakeFieldBinding("buoyancy_lift", &Cfg::BuoyancyLift),
            MakeFieldBinding("vorticity", &Cfg::VorticityConfinement),
            MakeFieldBinding("blackbody_k", &Cfg::BlackbodyCoreKelvin),
            MakeFieldBinding("dissipation", &Cfg::DissipationRate),
            MakeFieldBinding("fuel_injection", &Cfg::FuelInjectionRate),
            MakeFieldBinding("flame_intensity", &Cfg::FlameIntensity),
            MakeFieldBinding("soot_extinction", &Cfg::SootExtinction),
            MakeFieldBinding("combustion_enabled", &Cfg::CombustionEnabled),
            MakeFieldBinding("self_shadowing", &Cfg::SelfShadowing),
            MakeFieldBinding("space_file", &Cfg::SpaceFile));
    }
};

template <>
struct SpaceSchema<FractureConfiguration>
{
    static constexpr auto Bindings() noexcept
    {
        using Cfg = FractureConfiguration;
        return std::make_tuple(
            MakeFieldBinding("enabled", &Cfg::Enabled),
            MakeFieldBinding("voronoi_cells", &Cfg::VoronoiCellCount),
            MakeFieldBinding("impulse_threshold_ns", &Cfg::ImpulseThresholdNs),
            MakeFieldBinding("impact_radial_bias", &Cfg::ImpactRadialBias),
            MakeFieldBinding("debris_lifetime_seconds", &Cfg::DebrisLifetimeSeconds),
            MakeFieldBinding("sleep_linear_velocity", &Cfg::SleepLinearVelocity),
            MakeFieldBinding("fracture_armed", &Cfg::FractureArmed),
            MakeFieldBinding("impact_dust_burst", &Cfg::ImpactDustBurst),
            MakeFieldBinding("space_file", &Cfg::SpaceFile));
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                            DYNAMICS & SOLVER RECORD CODECS
//------------------------------------------------------------------------------------------------------------------------

template <>
void ForceFieldRecord::SerializeConfiguration(toml::table& OutTable) const
{
    EncodeSpaceTable(OutTable, Parameters);
    OutTable.insert_or_assign("receivers", WriteReceivers(Parameters.Receivers));
    OutTable.insert_or_assign("view_contribution", NameChoice(Parameters.ViewContribution, ContributionNames));
    OutTable.insert_or_assign("view_quantity", NameChoice(Parameters.Quantity, QuantityNames));
    OutTable.insert_or_assign("view_projection", NameChoice(Parameters.Projection, ProjectionNames));
    if (!Parameters.SpaceFile.empty())
    {
        OutTable.insert_or_assign("space_file", Parameters.SpaceFile);
    }
    Detail::WriteReplicationSubtable(OutTable, Parameters.Replication);
}

template <>
void ForceFieldRecord::DeserializeConfiguration(const toml::table& InTable)
{
    DecodeSpaceTable(InTable, Parameters);
    for (float& Half : Parameters.HalfExtentsMetres)
    {
        Half = std::clamp(Half, 1.0f, 1000.0f);
    }
    Parameters.Receivers        = ReadReceivers(InTable, "receivers", Parameters.Receivers);
    Parameters.ViewContribution = ReadChoice(InTable, "view_contribution", Parameters.ViewContribution, ContributionNames);
    Parameters.Quantity         = ReadChoice(InTable, "view_quantity", Parameters.Quantity, QuantityNames);
    Parameters.Projection       = ReadChoice(InTable, "view_projection", Parameters.Projection, ProjectionNames);
    if (const auto File = InTable["space_file"].value<std::string>())
    {
        Parameters.SpaceFile = *File;
    }
    Detail::ReadReplicationSubtable(InTable, Parameters.Replication);
    Parameters.AdvanceRevision();
}

template <>
void WindRecord::SerializeConfiguration(toml::table& OutTable) const
{
    EncodeSpaceTable(OutTable, Parameters);
    Detail::WriteReplicationSubtable(OutTable, Parameters.Replication);
}

template <>
void WindRecord::DeserializeConfiguration(const toml::table& InTable)
{
    DecodeSpaceTable(InTable, Parameters);
    Detail::ReadReplicationSubtable(InTable, Parameters.Replication);
    Parameters.AdvanceRevision();
}

template <>
void ForceSourceRecord::SerializeConfiguration(toml::table& OutTable) const
{
    const ForceSourceDescriptor& Descriptor = ResolveForceSourceDescriptor(Parameters.Category);
    OutTable.insert_or_assign("enabled", Parameters.Enabled);
    OutTable.insert_or_assign("category", std::string(Descriptor.Identifier));
    OutTable.insert_or_assign("contribution",
                              std::string(ResolveForceContributionDescriptor(Descriptor.Contribution).Identifier));
    Detail::WriteDoubleSequence(OutTable, "centre_metres", Parameters.CentreMetres, 3);
    OutTable.insert_or_assign("reach", std::string(ResolveForceReachIdentifier(Parameters.Reach)));
    OutTable.insert_or_assign("reach_metres", Parameters.ReachMetres);
    OutTable.insert_or_assign("falloff", std::string(ResolveForceFalloffIdentifier(Parameters.Falloff)));
    for (const ForceParameterDescriptor& Parameter : Descriptor.Parameters)
    {
        OutTable.insert_or_assign(Parameter.Identifier, Parameters.*(Parameter.Member));
    }
    for (const ForceBearingDescriptor& Bearing : Descriptor.Bearings)
    {
        OutTable.insert_or_assign(Bearing.Identifier, Parameters.*(Bearing.Member));
    }
    if (Parameters.LocalizedWindGenerator)
    {
        OutTable.insert_or_assign("localized_wind_generator", true);
        OutTable.insert_or_assign("generator_gust_strength", Parameters.GeneratorGustStrength);
        OutTable.insert_or_assign("generator_gust_frequency_hz", Parameters.GeneratorGustFrequencyHz);
        OutTable.insert_or_assign("generator_turbulence", Parameters.GeneratorTurbulence);
        OutTable.insert_or_assign("generator_turbulence_scale_metres", Parameters.GeneratorTurbulenceScaleMetres);
    }
    if (Descriptor.Spin)
    {
        OutTable.insert_or_assign("spin", std::string(Parameters.Spin < 0 ? "anticyclonic" : "cyclonic"));
    }
    if (Parameters.Reach == ForceReach::Column || Parameters.Reach == ForceReach::Box)
    {
        OutTable.insert_or_assign("height_metres", Parameters.HeightMetres);
    }
    if (Parameters.Reach == ForceReach::Box && Parameters.Category != ForceSourceCategory::JetCorridor &&
        Parameters.Category != ForceSourceCategory::VehicleWake)
    {
        Detail::WriteDoubleSequence(OutTable, "half_extents_metres", Parameters.HalfExtentsMetres, 2);
        OutTable.insert_or_assign("bearing_deg", Parameters.BearingDegrees);
    }
    OutTable.insert_or_assign("activation", std::string(ResolveForceActivationIdentifier(Parameters.Activation)));
    OutTable.insert_or_assign("begins_seconds", Parameters.BeginsSeconds);
    OutTable.insert_or_assign("lasts_seconds", Parameters.LastsSeconds);
    OutTable.insert_or_assign("repeats_seconds", Parameters.RepeatsSeconds);
    OutTable.insert_or_assign("ramp_in_seconds", Parameters.RampInSeconds);
    OutTable.insert_or_assign("ramp_out_seconds", Parameters.RampOutSeconds);
    OutTable.insert_or_assign("acts_on", WriteReceivers(Parameters.ActsOn));
    Detail::WriteReplicationSubtable(OutTable, Parameters.Replication);
}

template <>
void ForceSourceRecord::DeserializeConfiguration(const toml::table& InTable)
{
    const auto                   CategoryName = InTable["category"].value<std::string>();
    const ForceSourceDescriptor* Descriptor   = CategoryName ? ResolveForceSourceDescriptor(*CategoryName) : nullptr;
    if (Descriptor)
    {
        const uint64_t Revision = Parameters.Revision;
        Parameters              = ConstructForceSource(Descriptor->Category);
        Parameters.Revision     = Revision;
    }
    const ForceSourceDescriptor& Active = ResolveForceSourceDescriptor(Parameters.Category);
    Parameters.Enabled                  = Detail::ReadScalarBool(InTable, "enabled", Parameters.Enabled);
    Detail::ReadDoubleSequence(InTable, "centre_metres", Parameters.CentreMetres, 3);
    if (const auto Name = InTable["reach"].value<std::string>())
    {
        Parameters.Reach = ParseForceReach(*Name, Parameters.Reach);
    }
    Parameters.ReachMetres = std::clamp(Detail::ReadScalarDouble(InTable, "reach_metres", Parameters.ReachMetres),
                                        0.1, 400000.0);
    if (const auto Name = InTable["falloff"].value<std::string>())
    {
        Parameters.Falloff = ParseForceFalloff(*Name, Parameters.Falloff);
    }
    for (const ForceParameterDescriptor& Parameter : Active.Parameters)
    {
        Parameters.*(Parameter.Member) = std::clamp(
            Detail::ReadScalarDouble(InTable, Parameter.Identifier, Parameters.*(Parameter.Member)),
            std::min(Parameter.Minimum, 0.0), Parameter.Maximum * 4.0);
    }
    for (const ForceBearingDescriptor& Bearing : Active.Bearings)
    {
        Parameters.*(Bearing.Member) = Detail::ReadScalarDouble(InTable, Bearing.Identifier, Parameters.*(Bearing.Member));
    }
    if (const auto Spin = InTable["spin"].value<std::string>())
    {
        Parameters.Spin = *Spin == "anticyclonic" ? -1.0 : 1.0;
    }
    Parameters.HeightMetres =
        std::clamp(Detail::ReadScalarDouble(InTable, "height_metres", Parameters.HeightMetres), 0.1, 40000.0);
    Detail::ReadDoubleSequence(InTable, "half_extents_metres", Parameters.HalfExtentsMetres, 2);
    Parameters.BearingDegrees = Detail::ReadScalarDouble(InTable, "bearing_deg", Parameters.BearingDegrees);
    Parameters.LocalizedWindGenerator = Detail::ReadScalarBool(InTable, "localized_wind_generator", Parameters.LocalizedWindGenerator);
    Parameters.GeneratorGustStrength = std::clamp(
        Detail::ReadScalarDouble(InTable, "generator_gust_strength", Parameters.GeneratorGustStrength), 0.0, 1.5);
    Parameters.GeneratorGustFrequencyHz = std::clamp(
        Detail::ReadScalarDouble(InTable, "generator_gust_frequency_hz", Parameters.GeneratorGustFrequencyHz), 0.0, 2.0);
    Parameters.GeneratorTurbulence = std::clamp(
        Detail::ReadScalarDouble(InTable, "generator_turbulence", Parameters.GeneratorTurbulence), 0.0, 1.5);
    Parameters.GeneratorTurbulenceScaleMetres = std::clamp(
        Detail::ReadScalarDouble(InTable, "generator_turbulence_scale_metres", Parameters.GeneratorTurbulenceScaleMetres), 1.0, 1000.0);
    if (const auto Name = InTable["activation"].value<std::string>())
    {
        Parameters.Activation = ParseForceActivation(*Name, Parameters.Activation);
    }
    Parameters.BeginsSeconds  = std::max(0.0, Detail::ReadScalarDouble(InTable, "begins_seconds", Parameters.BeginsSeconds));
    Parameters.LastsSeconds   = std::max(0.0, Detail::ReadScalarDouble(InTable, "lasts_seconds", Parameters.LastsSeconds));
    Parameters.RepeatsSeconds = std::max(0.0, Detail::ReadScalarDouble(InTable, "repeats_seconds", Parameters.RepeatsSeconds));
    Parameters.RampInSeconds  = std::max(0.0, Detail::ReadScalarDouble(InTable, "ramp_in_seconds", Parameters.RampInSeconds));
    Parameters.RampOutSeconds = std::max(0.0, Detail::ReadScalarDouble(InTable, "ramp_out_seconds", Parameters.RampOutSeconds));
    Parameters.ActsOn         = ReadReceivers(InTable, "acts_on", Parameters.ActsOn);
    Detail::ReadReplicationSubtable(InTable, Parameters.Replication);
    Parameters.AdvanceRevision();
}

template <>
void FluidPlumeRecord::SerializeConfiguration(toml::table& OutTable) const
{
    EncodeSpaceTable(OutTable, Parameters);
    if (Parameters.SpaceFile.empty())
    {
        OutTable.erase("space_file");
    }
    Detail::WriteReplicationSubtable(OutTable, Parameters.Replication);
}

template <>
void FluidPlumeRecord::DeserializeConfiguration(const toml::table& InTable)
{
    DecodeSpaceTable(InTable, Parameters);
    Detail::ReadReplicationSubtable(InTable, Parameters.Replication);
    Parameters.AdvanceRevision();
}

template <>
void FractureRecord::SerializeConfiguration(toml::table& OutTable) const
{
    EncodeSpaceTable(OutTable, Parameters);
    if (Parameters.SpaceFile.empty())
    {
        OutTable.erase("space_file");
    }
    Detail::WriteReplicationSubtable(OutTable, Parameters.Replication);
}

template <>
void FractureRecord::DeserializeConfiguration(const toml::table& InTable)
{
    DecodeSpaceTable(InTable, Parameters);
    Detail::ReadReplicationSubtable(InTable, Parameters.Replication);
    Parameters.AdvanceRevision();
}

template <>
void ParticleRecord::SerializeConfiguration(toml::table& OutTable) const
{
    OutTable.insert_or_assign("enabled", Parameters.Enabled);
    if (!Parameters.SpaceFile.empty())
    {
        OutTable.insert_or_assign("space_file", Parameters.SpaceFile);
    }
    Detail::WriteReplicationSubtable(OutTable, Parameters.Replication);
}

template <>
void ParticleRecord::DeserializeConfiguration(const toml::table& InTable)
{
    Parameters.Enabled = Detail::ReadScalarBool(InTable, "enabled", Parameters.Enabled);
    if (const auto File = InTable["space_file"].value<std::string>())
    {
        Parameters.SpaceFile = *File;
    }
    Detail::ReadReplicationSubtable(InTable, Parameters.Replication);
    Parameters.AdvanceRevision();
}

//------------------------------------------------------------------------------------------------------------------------
//                                              SCENE GEOMETRY RECORD CODEC
//------------------------------------------------------------------------------------------------------------------------

template <>
void GeometryRecord::SerializeConfiguration(toml::table& OutTable) const
{
    toml::array Stems;
    for (const std::string& Stem : Parameters.OccupantStems)
    {
        Stems.push_back(Stem);
    }
    OutTable.insert_or_assign("subjects", std::move(Stems));
    if (Parameters.OccupantFirst != 0)
    {
        OutTable.insert_or_assign("subject_first", static_cast<int64_t>(Parameters.OccupantFirst));
    }
    if (Parameters.OccupantCount != 0)
    {
        OutTable.insert_or_assign("subject_count", static_cast<int64_t>(Parameters.OccupantCount));
    }
    if (Parameters.BaseCopies != 0)
    {
        OutTable.insert_or_assign("base_copies", static_cast<int64_t>(Parameters.BaseCopies));
    }
    if (!Parameters.ClaimsArchive)
    {
        OutTable.insert_or_assign("claims_archive", false);
    }
    if (!Parameters.ShapeName.empty())
    {
        OutTable.insert_or_assign("shape", Parameters.ShapeName);
    }
    if (Parameters.ArchiveOriginAuthored)
    {
        Detail::WriteRoundedFloatTriple(OutTable, "archive_origin_m", Parameters.ArchiveOriginMetres);
        OutTable.insert_or_assign("archive_yaw_deg",
                                  std::round(static_cast<double>(Parameters.ArchiveYawDegrees) * 1.0e4) / 1.0e4);
    }
    OutTable.insert_or_assign("group", Parameters.GroupName);
    OutTable.insert_or_assign("glyph", Parameters.GlyphName);
    if (!Parameters.Notes.empty())
    {
        OutTable.insert_or_assign("notes", Parameters.Notes);
    }
    OutTable.insert_or_assign("visible", Parameters.Visible);
    OutTable.insert_or_assign("dynamic", Parameters.Dynamic);
    OutTable.insert_or_assign("cast_shadows", Parameters.CastShadows);
    OutTable.insert_or_assign("global_illumination", Parameters.GlobalIllumination);
    OutTable.insert_or_assign("physics", Parameters.Physics);
    OutTable.insert_or_assign("locked", Parameters.Locked);
    Detail::WriteRoundedFloatTriple(OutTable, "position_m", Parameters.Spatial.PositionMetres);
    Detail::WriteRoundedFloatTriple(OutTable, "orientation_deg", Parameters.Spatial.OrientationDegrees);
    Detail::WriteRoundedFloatTriple(OutTable, "scale", Parameters.Spatial.Scale);
    OutTable.insert_or_assign("fracture", Parameters.Fracture.Enabled);
    if (Parameters.Fracture.Enabled)
    {
        OutTable.insert_or_assign("voronoi_cells", static_cast<int64_t>(Parameters.Fracture.VoronoiCellCount));
        OutTable.insert_or_assign("impulse_threshold_ns", static_cast<double>(Parameters.Fracture.ImpulseThresholdNs));
    }
    toml::array Stack;
    for (const ArrayModifierConfiguration& Modifier : Parameters.Modifiers)
    {
        toml::table Entry;
        Entry.insert_or_assign("type", "Array");
        Entry.insert_or_assign("label", Modifier.Label);
        Entry.insert_or_assign("enabled", Modifier.Enabled);
        Entry.insert_or_assign("expanded", Modifier.Expanded);
        Entry.insert_or_assign("count", static_cast<int64_t>(Modifier.Count));
        Entry.insert_or_assign("relative_offset", Modifier.RelativeOffset);
        Detail::WriteRoundedFloatTriple(Entry, "relative_factor", Modifier.RelativeFactor);
        Entry.insert_or_assign("constant_offset", Modifier.ConstantOffset);
        Detail::WriteRoundedFloatTriple(Entry, "constant_m", Modifier.ConstantMetres);
        Entry.insert_or_assign("rotation_step_deg",
                               std::round(static_cast<double>(Modifier.RotationStepDegrees) * 1.0e4) / 1.0e4);
        Entry.insert_or_assign("radial_pivot", Modifier.RadialPivot);
        Stack.push_back(std::move(Entry));
    }
    if (!Stack.empty())
    {
        OutTable.insert_or_assign("modifiers", std::move(Stack));
    }
    toml::array Surfaces;
    for (const SurfaceSlotConfiguration& Slot : Parameters.SurfaceSlots)
    {
        toml::table Entry;
        const auto& Channel = Slot.Channels;
        auto        Rounded = [](float Scalar) { return std::round(static_cast<double>(Scalar) * 1.0e5) / 1.0e5; };
        Entry.insert_or_assign("family", static_cast<int64_t>(Slot.Family));
        Entry.insert_or_assign("albedo", toml::array{Rounded(Channel[0]), Rounded(Channel[1]), Rounded(Channel[2])});
        Entry.insert_or_assign("roughness", Rounded(Channel[3]));
        Entry.insert_or_assign("incandescence", toml::array{Rounded(Channel[4]), Rounded(Channel[5]), Rounded(Channel[6])});
        Entry.insert_or_assign("metalness", Rounded(Channel[7]));
        Entry.insert_or_assign("coat", Rounded(Channel[8]));
        Entry.insert_or_assign("coat_roughness", Rounded(Channel[9]));
        Entry.insert_or_assign("specular", Rounded(Channel[10]));
        Entry.insert_or_assign("transmission", Rounded(Channel[11]));
        Surfaces.push_back(std::move(Entry));
    }
    if (!Surfaces.empty())
    {
        OutTable.insert_or_assign("surfaces", std::move(Surfaces));
    }
    Detail::WriteReplicationSubtable(OutTable, Parameters.Replication);
}

template <>
void GeometryRecord::DeserializeConfiguration(const toml::table& InTable)
{
    Parameters.OccupantStems.clear();
    const toml::array* Stems = InTable["subjects"].as_array();
    if (!Stems)
    {
        Stems = InTable["occupants"].as_array();
    }
    if (Stems)
    {
        for (size_t Index = 0; Index < Stems->size(); ++Index)
        {
            if (const auto Text = (*Stems)[Index].value<std::string>())
            {
                Parameters.OccupantStems.push_back(*Text);
            }
        }
    }
    Parameters.OccupantFirst = InTable.contains("subject_first")
                                   ? Detail::ReadScalarUint32(InTable, "subject_first", 0u)
                                   : Detail::ReadScalarUint32(InTable, "occupant_first", 0u);
    Parameters.OccupantCount = InTable.contains("subject_count")
                                   ? Detail::ReadScalarUint32(InTable, "subject_count", 0u)
                                   : Detail::ReadScalarUint32(InTable, "occupant_count", 0u);
    Parameters.BaseCopies            = Detail::ReadScalarUint32(InTable, "base_copies", 0u);
    Parameters.ClaimsArchive         = Detail::ReadScalarBool(InTable, "claims_archive", true);
    Parameters.ShapeName             = InTable["shape"].value_or(std::string());
    Parameters.ArchiveOriginAuthored = InTable.contains("archive_origin_m");
    if (Parameters.ArchiveOriginAuthored)
    {
        Detail::ReadFloatTriple(InTable, "archive_origin_m", Parameters.ArchiveOriginMetres);
    }
    Parameters.ArchiveYawDegrees  = Detail::ReadScalarFloat(InTable, "archive_yaw_deg", 0.0f);
    Parameters.GroupName          = InTable["group"].value_or(std::string("Geometry"));
    Parameters.GlyphName          = InTable["glyph"].value_or(std::string("Box"));
    Parameters.Notes              = InTable["notes"].value_or(std::string());
    Parameters.Visible            = Detail::ReadScalarBool(InTable, "visible", Parameters.Visible);
    Parameters.Dynamic            = Detail::ReadScalarBool(InTable, "dynamic", Parameters.Dynamic);
    Parameters.CastShadows        = Detail::ReadScalarBool(InTable, "cast_shadows", Parameters.CastShadows);
    Parameters.GlobalIllumination = Detail::ReadScalarBool(InTable, "global_illumination", Parameters.GlobalIllumination);
    Parameters.Physics            = Detail::ReadScalarBool(InTable, "physics", Parameters.Physics);
    Parameters.Locked             = Detail::ReadScalarBool(InTable, "locked", Parameters.Locked);
    Detail::DeserializeSpatialSubtable(InTable, Parameters.Spatial);
    Parameters.Fracture.Enabled            = Detail::ReadScalarBool(InTable, "fracture", false);
    Parameters.Fracture.VoronoiCellCount   = Detail::ReadScalarUint32(InTable, "voronoi_cells", Parameters.Fracture.VoronoiCellCount);
    Parameters.Fracture.ImpulseThresholdNs = Detail::ReadScalarFloat(InTable, "impulse_threshold_ns", Parameters.Fracture.ImpulseThresholdNs);
    Parameters.Modifiers.clear();
    if (const toml::array* Stack = InTable["modifiers"].as_array())
    {
        for (size_t Index = 0; Index < Stack->size(); ++Index)
        {
            const toml::table* Entry = (*Stack)[Index].as_table();
            if (Entry == nullptr || (*Entry)["type"].value_or(std::string("Array")) != "Array")
            {
                continue;
            }
            ArrayModifierConfiguration Modifier;
            Modifier.Label               = (*Entry)["label"].value_or(std::string("Array"));
            Modifier.Enabled             = Detail::ReadScalarBool(*Entry, "enabled", Modifier.Enabled);
            Modifier.Expanded            = Detail::ReadScalarBool(*Entry, "expanded", Modifier.Expanded);
            Modifier.Count               = std::max(1u, Detail::ReadScalarUint32(*Entry, "count", Modifier.Count));
            Modifier.RelativeOffset      = Detail::ReadScalarBool(*Entry, "relative_offset", Modifier.RelativeOffset);
            Detail::ReadFloatTriple(*Entry, "relative_factor", Modifier.RelativeFactor);
            Modifier.ConstantOffset      = Detail::ReadScalarBool(*Entry, "constant_offset", Modifier.ConstantOffset);
            Detail::ReadFloatTriple(*Entry, "constant_m", Modifier.ConstantMetres);
            Modifier.RotationStepDegrees = Detail::ReadScalarFloat(*Entry, "rotation_step_deg", Modifier.RotationStepDegrees);
            Modifier.RadialPivot         = Detail::ReadScalarBool(*Entry, "radial_pivot", Modifier.RadialPivot);
            Parameters.Modifiers.push_back(std::move(Modifier));
        }
    }
    Parameters.SurfaceSlots.clear();
    if (const toml::array* Surfaces = InTable["surfaces"].as_array())
    {
        for (size_t Row = 0; Row < Surfaces->size(); ++Row)
        {
            const toml::table* Entry = (*Surfaces)[Row].as_table();
            if (Entry == nullptr)
            {
                continue;
            }
            SurfaceSlotConfiguration Slot;
            Slot.Family = Detail::ReadScalarUint32(*Entry, "family", 0u);
            auto Read3  = [&](const char* Key, size_t First) {
                if (const toml::array* Values = (*Entry)[Key].as_array())
                {
                    for (size_t Axis = 0; Axis < 3 && Axis < Values->size(); ++Axis)
                    {
                        Slot.Channels[First + Axis] = static_cast<float>((*Values)[Axis].value_or(0.0));
                    }
                }
            };
            Read3("albedo", 0);
            Read3("incandescence", 4);
            Slot.Channels[3]  = Detail::ReadScalarFloat(*Entry, "roughness", 0.5f);
            Slot.Channels[7]  = Detail::ReadScalarFloat(*Entry, "metalness", 0.0f);
            Slot.Channels[8]  = Detail::ReadScalarFloat(*Entry, "coat", 0.0f);
            Slot.Channels[9]  = Detail::ReadScalarFloat(*Entry, "coat_roughness", 0.0f);
            Slot.Channels[10] = Detail::ReadScalarFloat(*Entry, "specular", 0.04f);
            Slot.Channels[11] = Detail::ReadScalarFloat(*Entry, "transmission", 0.0f);
            Parameters.SurfaceSlots.push_back(Slot);
        }
    }
    Detail::ReadReplicationSubtable(InTable, Parameters.Replication);
    ConfigureEditorPresentation(Parameters.GlyphName.c_str(), Parameters.GroupName.c_str(), "Geometry", "");
    Parameters.AdvanceRevision();
}

//------------------------------------------------------------------------------------------------------------------------
//                                      COMPOSABLE MULTI-CONFIGURATION CODECS
//------------------------------------------------------------------------------------------------------------------------

void SpatialNodeRecord::SerializeConfiguration(toml::table& OutTable) const
{
    Detail::SerializeSpatialSubtable(OutTable, Spatial);
}

void SpatialNodeRecord::DeserializeConfiguration(const toml::table& InTable)
{
    Detail::DeserializeSpatialSubtable(InTable, Spatial);
}

void RigidBodyRecord::SerializeConfiguration(toml::table& OutTable) const
{
    Detail::SerializeSpatialSubtable(OutTable, Spatial);
    Detail::SerializePhysicsSubtable(OutTable, Physics);
    Detail::SerializeOpticsSubtable(OutTable, Optics);
}

void RigidBodyRecord::DeserializeConfiguration(const toml::table& InTable)
{
    Detail::DeserializeSpatialSubtable(InTable, Spatial);
    Detail::DeserializePhysicsSubtable(InTable, Physics);
    Detail::DeserializeOpticsSubtable(InTable, Optics);
}

void ThermalBodyRecord::SerializeConfiguration(toml::table& OutTable) const
{
    Detail::SerializeSpatialSubtable(OutTable, Spatial);
    Detail::SerializePhysicsSubtable(OutTable, Physics);
    Detail::SerializeThermalSubtable(OutTable, Thermal);
    Detail::SerializeOpticsSubtable(OutTable, Optics);
}

void ThermalBodyRecord::DeserializeConfiguration(const toml::table& InTable)
{
    Detail::DeserializeSpatialSubtable(InTable, Spatial);
    Detail::DeserializePhysicsSubtable(InTable, Physics);
    Detail::DeserializeThermalSubtable(InTable, Thermal);
    Detail::DeserializeOpticsSubtable(InTable, Optics);
}

void ChemicalVesselRecord::SerializeConfiguration(toml::table& OutTable) const
{
    Detail::SerializeSpatialSubtable(OutTable, Spatial);
    Detail::SerializeThermalSubtable(OutTable, Thermal);
    Detail::SerializeChemicalSubtable(OutTable, Chemical);
}

void ChemicalVesselRecord::DeserializeConfiguration(const toml::table& InTable)
{
    Detail::DeserializeSpatialSubtable(InTable, Spatial);
    Detail::DeserializeThermalSubtable(InTable, Thermal);
    Detail::DeserializeChemicalSubtable(InTable, Chemical);
}

} // namespace Frontier
