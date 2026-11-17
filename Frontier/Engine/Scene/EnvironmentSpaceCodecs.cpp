/*==========================================================================================================================================
                                                     ENVIRONMENTSPACECODECS.CPP
==========================================================================================================================================*/
// 🧩 Declarative SpaceCodec serialization tables for render-pipeline, celestial, atmospheric, and flare scene records.

#include "Frontier/Engine/Scene/ConfigurationTableCodec.h"
#include "Frontier/Engine/Scene/WorldSpace.h"

#include <algorithm>

namespace Frontier
{

template <>
struct SpaceSchema<RenderPipelineConfiguration>
{
    static constexpr auto Bindings() noexcept
    {
        using Cfg = RenderPipelineConfiguration;
        return std::make_tuple(
            MakeFieldBinding("enabled", &Cfg::Enabled),
            MakeFieldBinding("hardware_ray_query", &Cfg::HardwareRayQueryTier),
            MakeFieldBinding("direct_shading", &Cfg::DirectShading),
            MakeFieldBinding("global_illumination", &Cfg::GlobalIllumination),
            MakeFieldBinding("multi_bounce_nee", &Cfg::MultiBounceNee),
            MakeFieldBinding("russian_roulette", &Cfg::RussianRoulette),
            MakeFieldBinding("temporal_reuse", &Cfg::TemporalReuse),
            MakeFieldBinding("spatial_reuse", &Cfg::SpatialReuse),
            MakeFieldBinding("visibility_reuse", &Cfg::VisibilityReuse),
            MakeFieldBinding("radiance_refresh", &Cfg::RadianceRefresh),
            MakeFieldBinding("card_radiosity", &Cfg::CardRadiosity),
            MakeFieldBinding("reflections", &Cfg::Reflection),
            MakeFieldBinding("ray_traced_reflections", &Cfg::RayTracedReflections),
            MakeFieldBinding("mirror_filter", &Cfg::MirrorFilter),
            MakeFieldBinding("mirror_trace", &Cfg::MirrorTrace),
            MakeFieldBinding("direct_shadow", &Cfg::DirectShadow),
            MakeFieldBinding("ray_traced_shadows", &Cfg::RayTracedShadows),
            MakeFieldBinding("firefly_filter", &Cfg::FireflyFilter),
            MakeFieldBinding("solar_disc", &Cfg::SolarDisc),
            MakeFieldBinding("stratified_sun", &Cfg::StratifiedSun),
            MakeFieldBinding("penumbra_filter", &Cfg::PenumbraFilter),
            MakeFieldBinding("variance_filter", &Cfg::VarianceFilter),
            MakeFieldBinding("temporal_aa", &Cfg::TemporalAntiAliasing),
            MakeFieldBinding("auto_exposure", &Cfg::AutoExposure),
            MakeFieldBinding("virtualized_geometry", &Cfg::VirtualizedGeometry),
            MakeFieldBinding("live_refresh", &Cfg::LiveRefresh),
            MakeClampedField("quality_tier", &Cfg::QualityTier, 0, 2),
            MakeClampedField("trace_scale", &Cfg::TraceScale, 1, 4),
            MakeClampedField("initial_candidates", &Cfg::InitialCandidates, 1, 4),
            MakeClampedField("max_bounces", &Cfg::MaxBounces, 1, 4),
            MakeClampedField("spatial_count", &Cfg::SpatialCount, 0, 8),
            MakeClampedField("card_tile_budget", &Cfg::CardTileBudget, 0, 8192),
            MakeClampedField("reflection_bounces", &Cfg::ReflectionBounces, 1, 4),
            MakeClampedField("diffuse_wavelet_levels", &Cfg::DiffuseWaveletLevels, 1, 4),
            MakeClampedField("diffuse_tally_limit", &Cfg::DiffuseTallyLimit, 1, 64),
            MakeClampedField("glossy_wavelet_levels", &Cfg::GlossyWaveletLevels, 1, 4),
            MakeClampedField("glossy_tally_limit", &Cfg::GlossyTallyLimit, 1, 64),
            MakeClampedField("virtualized_stream_slots", &Cfg::VirtualizedStreamSlots, 0, 64),
            MakeClampedField("inspection_mode", &Cfg::InspectionModeIndex, 0, 14),
            MakeClampedField("distance_inspection", &Cfg::DistanceInspection, 1, 3),
            MakeClampedField("target_rate", &Cfg::TargetRate, 30, 120),
            MakeClampedField("render_scale", &Cfg::RenderScale, 0.25, 2.0),
            MakeClampedField("spatial_radius", &Cfg::SpatialRadius, 2.0, 48.0),
            MakeClampedField("temporal_tally_limit", &Cfg::TemporalTallyLimit, 1.0, 40.0),
            MakeClampedField("indirect_scale", &Cfg::IndirectScale, 0.0, 3.0),
            MakeClampedField("sky_scale", &Cfg::SkyScale, 0.0, 3.0),
            MakeClampedField("incandescence_scale", &Cfg::IncandescenceScale, 0.0, 3.0),
            MakeClampedField("reflection_scale", &Cfg::ReflectionScale, 0.0, 3.0),
            MakeClampedField("reflection_roughness", &Cfg::ReflectionRoughness, 0.15, 1.0),
            MakeClampedField("diffuse_minimum_weight", &Cfg::DiffuseMinimumWeight, 0.01, 0.5),
            MakeClampedField("diffuse_colour_sigma", &Cfg::DiffuseColourSigma, 0.5, 16.0),
            MakeClampedField("glossy_minimum_weight", &Cfg::GlossyMinimumWeight, 0.01, 0.5),
            MakeClampedField("glossy_colour_sigma", &Cfg::GlossyColourSigma, 0.5, 16.0),
            MakeClampedField("exposure_ev", &Cfg::ExposureCompensationEv, -4.0, 4.0));
    }
};

template <>
struct SpaceSchema<SolarConfiguration>
{
    static constexpr auto Bindings() noexcept
    {
        using Cfg = SolarConfiguration;
        return std::make_tuple(
            MakeFieldBinding("enabled", &Cfg::Enabled),
            MakeFieldBinding("elevation_deg", &Cfg::ElevationDegrees),
            MakeFieldBinding("azimuth_deg", &Cfg::AzimuthDegrees),
            MakeFieldBinding("illuminance_klx", &Cfg::IlluminanceKilolux),
            MakeFieldBinding("angular_diameter_deg", &Cfg::AngularDiameterDeg),
            MakeFieldBinding("kelvin", &Cfg::KelvinTemperature),
            MakeFieldBinding("ray_shadow", &Cfg::CastRaytracedShadow),
            MakeFieldBinding("light_shafts", &Cfg::VolumetricLightShaft),
            MakeFieldBinding("disc_visible", &Cfg::DiscVisible),
            MakeFieldBinding("aureole_gain", &Cfg::AureoleGain),
            MakeClampedField("colour_source", &Cfg::ColourSource, 0, 1),
            MakeFieldBinding("tint_linear", &Cfg::TintLinear),
            MakeFieldBinding("time_linked", &Cfg::TimeLinked),
            MakeFieldBinding("day_cycle", &Cfg::DayCycle),
            MakeFieldBinding("local_solar_h", &Cfg::LocalSolarHours),
            MakeFieldBinding("day_duration_h", &Cfg::DayDurationHours),
            MakeFieldBinding("calendar_date", &Cfg::CalendarDate),
            MakeFieldBinding("latitude_deg", &Cfg::LatitudeDegrees),
            MakeFieldBinding("longitude_deg", &Cfg::LongitudeDegrees),
            MakeFieldBinding("utc_offset_h", &Cfg::UtcOffsetHours));
    }
};

template <>
struct SpaceSchema<OpticalFlareConfiguration>
{
    static constexpr auto Bindings() noexcept
    {
        using Cfg = OpticalFlareConfiguration;
        return std::make_tuple(
            MakeFieldBinding("enabled", &Cfg::Enabled),
            MakeFieldBinding("intensity", &Cfg::Intensity),
            MakeFieldBinding("aperture_blades", &Cfg::ApertureBladeCount),
            MakeFieldBinding("luminance_threshold", &Cfg::LuminanceThreshold),
            MakeFieldBinding("halo_radius", &Cfg::HaloRadius),
            MakeFieldBinding("chromatic_dispersion", &Cfg::ChromaticDispersion),
            MakeFieldBinding("anamorphic_streak", &Cfg::AnamorphicStreak),
            MakeFieldBinding("diffraction_starburst", &Cfg::DiffractionStarburst),
            MakeFieldBinding("preset", &Cfg::Preset),
            MakeFieldBinding("spread", &Cfg::Spread),
            MakeFieldBinding("ghost_count", &Cfg::GhostCount),
            MakeFieldBinding("ghost_brightness", &Cfg::GhostBrightness),
            MakeFieldBinding("ghost_shape", &Cfg::GhostShape),
            MakeFieldBinding("ghost_spacing", &Cfg::GhostSpacing),
            MakeFieldBinding("halo_width", &Cfg::HaloWidth),
            MakeFieldBinding("halo_brightness", &Cfg::HaloBrightness),
            MakeFieldBinding("streak_strength", &Cfg::StreakStrength),
            MakeFieldBinding("rotation_degrees", &Cfg::RotationDegrees),
            MakeFieldBinding("ray_count", &Cfg::RayCount),
            MakeFieldBinding("warm_streak", &Cfg::WarmStreak));
    }
};

template <>
struct SpaceSchema<AtmosphereOpticalConfiguration>
{
    static constexpr auto Bindings() noexcept
    {
        using Cfg = AtmosphereOpticalConfiguration;
        return std::make_tuple(
            MakeFieldBinding("rayleigh", &Cfg::RayleighScattering),
            MakeFieldBinding("mie_turbidity", &Cfg::MieTurbidity),
            MakeFieldBinding("mie_g", &Cfg::MieAnisotropyG),
            MakeFieldBinding("ozone", &Cfg::OzoneAbsorptionScale),
            MakeFieldBinding("planet_radius_km", &Cfg::PlanetRadiusKm),
            MakeFieldBinding("atmosphere_thickness_km", &Cfg::AtmosphereThicknessKm),
            MakeFieldBinding("rayleigh_height_m", &Cfg::RayleighHeightMetres),
            MakeFieldBinding("mie_height_m", &Cfg::MieHeightMetres),
            MakeFieldBinding("ground_albedo", &Cfg::GroundAlbedo),
            MakeFieldBinding("horizon_glow", &Cfg::HorizonGlow),
            MakeFieldBinding("multiple_scattering", &Cfg::MultiScatteringLut),
            MakeFieldBinding("tier_samples", &Cfg::TierSamples));
    }
};

template <>
struct SpaceSchema<AtmosphereConfiguration>
{
    static constexpr auto Bindings() noexcept
    {
        using Cfg = AtmosphereConfiguration;
        return std::make_tuple(
            MakeFieldBinding("enabled", &Cfg::Enabled),
            MakeFieldBinding("aerial_perspective", &Cfg::AerialPerspective),
            MakeFieldBinding("use_baked", &Cfg::UseBaked),
            MakeFieldBinding("sky_tint", &Cfg::SkyTint),
            MakeFieldBinding("sky_scale", &Cfg::SkyScale),
            MakeFieldBinding("white_line", &Cfg::WhiteLine),
            MakeFieldBinding("line_at_civil_only", &Cfg::LineAtCivilOnly),
            MakeFieldBinding("air_mass", &Cfg::AirMass));
    }
};

template <>
struct SpaceSchema<CloudConfiguration>
{
    static constexpr auto Bindings() noexcept
    {
        using Cfg = CloudConfiguration;
        return std::make_tuple(
            MakeFieldBinding("enabled", &Cfg::Enabled),
            MakeFieldBinding("local_volume", &Cfg::LocalVolume),
            MakeFieldBinding("coverage", &Cfg::Coverage),
            MakeFieldBinding("base_altitude_m", &Cfg::BaseAltitudeMetres),
            MakeFieldBinding("thickness_m", &Cfg::LayerThicknessMetres),
            MakeFieldBinding("density", &Cfg::ExtinctionDensity),
            MakeFieldBinding("drift_mps", &Cfg::WindDriftSpeed),
            MakeFieldBinding("silver_lining", &Cfg::SilverLiningPower),
            MakeFieldBinding("temporal_reprojection", &Cfg::TemporalReprojection),
            MakeFieldBinding("cast_shadows", &Cfg::CastGroundShadows),
            MakeFieldBinding("formation", &Cfg::Formation),
            MakeFieldBinding("ceiling_metres", &Cfg::CeilingMetres),
            MakeFieldBinding("feature_scale", &Cfg::FeatureScale),
            MakeFieldBinding("anvil_shaping", &Cfg::AnvilShaping),
            MakeFieldBinding("edge_erosion", &Cfg::EdgeErosion),
            MakeFieldBinding("phase_anisotropy", &Cfg::PhaseAnisotropy),
            MakeFieldBinding("light_absorption", &Cfg::LightAbsorption),
            MakeFieldBinding("powder_response", &Cfg::PowderResponse),
            MakeFieldBinding("light_samples", &Cfg::LightSamples),
            MakeFieldBinding("resolution_percent", &Cfg::ResolutionPercent),
            MakeFieldBinding("sky_samples", &Cfg::SkySamples),
            MakeFieldBinding("local_samples", &Cfg::LocalSamples),
            MakeFieldBinding("shadow_strength", &Cfg::ShadowStrength),
            MakeFieldBinding("shadow_softness_metres", &Cfg::ShadowSoftnessMetres),
            MakeFieldBinding("shadow_span_metres", &Cfg::ShadowSpanMetres),
            MakeFieldBinding("shadow_samples", &Cfg::ShadowSamples),
            MakeFieldBinding("follow_wind", &Cfg::FollowWind),
            MakeFieldBinding("bounds_shape", &Cfg::BoundsShape),
            MakeFieldBinding("local_formation", &Cfg::LocalFormation),
            MakeFieldBinding("edge_softness", &Cfg::EdgeSoftness),
            MakeFieldBinding("local_feature_metres", &Cfg::LocalFeatureMetres),
            MakeFieldBinding("centre_metres", &Cfg::CentreMetres),
            MakeFieldBinding("half_extents_metres", &Cfg::HalfExtentsMetres));
    }
};

template <>
struct SpaceSchema<StarConfiguration>
{
    static constexpr auto Bindings() noexcept
    {
        using Cfg = StarConfiguration;
        return std::make_tuple(
            MakeFieldBinding("enabled", &Cfg::Enabled),
            MakeFieldBinding("hipparcos_count", &Cfg::HipparcosCount),
            MakeFieldBinding("magnitude_gain", &Cfg::MagnitudeGain),
            MakeFieldBinding("milky_way", &Cfg::MilkyWayLuminance),
            MakeFieldBinding("sidereal_speed", &Cfg::SiderealSpeed),
            MakeFieldBinding("twinkle_depth", &Cfg::AtmosphericScintillate),
            MakeFieldBinding("limiting_magnitude", &Cfg::LimitingMagnitude),
            MakeFieldBinding("point_size", &Cfg::PointSize),
            MakeFieldBinding("halo_gain", &Cfg::HaloGain),
            MakeFieldBinding("rotation_degrees", &Cfg::RotationDegrees),
            MakeFieldBinding("scintillation_enabled", &Cfg::ScintillationEnabled),
            MakeFieldBinding("scintillation_rate_hz", &Cfg::ScintillationRateHz));
    }
};

template <>
struct SpaceSchema<MoonInstanceConfiguration>
{
    static constexpr auto Bindings() noexcept
    {
        using Inst = MoonInstanceConfiguration;
        return std::make_tuple(
            MakeFieldBinding("visible", &Inst::Visible),
            MakeFieldBinding("follow_sky", &Inst::FollowSky),
            MakeClampedField("body", &Inst::Body, 0, 5),
            MakeClampedField("phase_days", &Inst::PhaseDays, 0.0, 29.53),
            MakeClampedField("azimuth_degrees", &Inst::AzimuthDegrees, -180.0, 180.0),
            MakeClampedField("elevation_degrees", &Inst::ElevationDegrees, -90.0, 90.0),
            MakeClampedField("roll_degrees", &Inst::RollDegrees, -180.0, 180.0),
            MakeClampedField("pitch_degrees", &Inst::PitchDegrees, -180.0, 180.0),
            MakeClampedField("spin_degrees", &Inst::SpinDegrees, -180.0, 180.0),
            MakeClampedField("angular_diameter_degrees", &Inst::AngularDiameterDegrees, 0.1, 180.0),
            MakeClampedField("brightness", &Inst::Brightness, 0.0, 5.0),
            MakeClampedField("glow", &Inst::Glow, 0.0, 3.0));
    }
};

template <>
struct SpaceSchema<MoonConfiguration>
{
    static constexpr auto Bindings() noexcept
    {
        using Cfg = MoonConfiguration;
        return std::make_tuple(
            MakeFieldBinding("enabled", &Cfg::Enabled),
            MakeFieldBinding("primary_phase", &Cfg::PrimaryPhase),
            MakeFieldBinding("primary_orbit_degrees", &Cfg::PrimaryOrbitDegrees),
            MakeFieldBinding("primary_albedo", &Cfg::PrimaryAlbedo),
            MakeFieldBinding("secondary_enabled", &Cfg::SecondaryMoonEnabled),
            MakeFieldBinding("secondary_orbit_degrees", &Cfg::SecondaryOrbitDegrees),
            MakeFieldBinding("earthshine", &Cfg::EarthshineLuminance),
            MakeFieldBinding("illuminate_scene", &Cfg::IlluminateScene),
            MakeClampedField("light_power", &Cfg::LightPower, 0.0, 5.0));
    }
};

template <>
struct SpaceSchema<PlanetConfiguration>
{
    static constexpr auto Bindings() noexcept
    {
        using Cfg = PlanetConfiguration;
        return std::make_tuple(
            MakeFieldBinding("enabled", &Cfg::Enabled),
            MakeFieldBinding("follow_sky", &Cfg::FollowSky),
            MakeFieldBinding("surface_tint", &Cfg::SurfaceTint),
            MakeFieldBinding("azimuth_degrees", &Cfg::AzimuthDegrees),
            MakeFieldBinding("elevation_degrees", &Cfg::ElevationDegrees),
            MakeFieldBinding("spin_degrees", &Cfg::SpinDegrees),
            MakeFieldBinding("tilt_degrees", &Cfg::TiltDegrees),
            MakeFieldBinding("roll_degrees", &Cfg::RollDegrees),
            MakeFieldBinding("band_contrast", &Cfg::BandContrast),
            MakeFieldBinding("surface_detail", &Cfg::SurfaceDetail),
            MakeFieldBinding("cloud_veil", &Cfg::CloudVeil),
            MakeFieldBinding("atmosphere_height", &Cfg::AtmosphereHeight),
            MakeFieldBinding("limb_glow", &Cfg::LimbGlow),
            MakeFieldBinding("ring_inner_radius", &Cfg::RingInnerRadius),
            MakeFieldBinding("ring_outer_radius", &Cfg::RingOuterRadius),
            MakeFieldBinding("ring_optical_depth", &Cfg::RingOpticalDepth),
            MakeClampedField("body", &Cfg::Body, 0, 3),
            MakeFieldBinding("apparent_diameter_deg", &Cfg::ApparentDiameterDegrees),
            MakeFieldBinding("brightness", &Cfg::Brightness),
            MakeFieldBinding("ring_system", &Cfg::RingSystem),
            MakeFieldBinding("atmosphere_shell", &Cfg::AtmosphereShell));
    }
};

template <>
struct SpaceSchema<FogConfiguration>
{
    static constexpr auto Bindings() noexcept
    {
        using Cfg = FogConfiguration;
        return std::make_tuple(
            MakeFieldBinding("aerial_only", &Cfg::AerialOnly),
            MakeFieldBinding("enabled", &Cfg::Enabled),
            MakeFieldBinding("local_volume", &Cfg::LocalVolume),
            MakeFieldBinding("base_density", &Cfg::BaseDensity),
            MakeFieldBinding("height_falloff", &Cfg::HeightFalloff),
            MakeFieldBinding("base_altitude_m", &Cfg::BaseAltitudeMetres),
            MakeFieldBinding("anisotropy", &Cfg::PhaseAnisotropy),
            MakeFieldBinding("start_distance_m", &Cfg::StartDistanceMetres),
            MakeFieldBinding("froxel_grid", &Cfg::VolumetricFroxelGrid),
            MakeFieldBinding("ray_shadows", &Cfg::ReceiveRayShadow),
            MakeFieldBinding("tint_linear", &Cfg::TintLinear),
            MakeFieldBinding("sun_scatter", &Cfg::SunScatter),
            MakeFieldBinding("aerial_enabled", &Cfg::AerialEnabled),
            MakeFieldBinding("aerial_density", &Cfg::AerialDensity),
            MakeFieldBinding("aerial_start_metres", &Cfg::AerialStartMetres),
            MakeFieldBinding("aerial_mie_blend", &Cfg::AerialMieBlend),
            MakeFieldBinding("bounds_shape", &Cfg::BoundsShape),
            MakeFieldBinding("centre_metres", &Cfg::CentreMetres),
            MakeFieldBinding("half_extents_metres", &Cfg::HalfExtentsMetres),
            MakeFieldBinding("density_falloff", &Cfg::DensityFalloff),
            MakeFieldBinding("edge_softness", &Cfg::EdgeSoftness),
            MakeFieldBinding("local_density", &Cfg::LocalDensity),
            MakeFieldBinding("heterogeneity", &Cfg::Heterogeneity),
            MakeFieldBinding("noise_scale_metres", &Cfg::NoiseScaleMetres),
            MakeFieldBinding("independent_wind_mps", &Cfg::IndependentWindMps),
            MakeFieldBinding("follow_wind", &Cfg::FollowWind),
            MakeFieldBinding("albedo", &Cfg::Albedo),
            MakeFieldBinding("absorption", &Cfg::Absorption),
            MakeFieldBinding("self_shadow", &Cfg::SelfShadow),
            MakeFieldBinding("local_samples", &Cfg::LocalSamples));
    }
};

template <>
struct SpaceSchema<LightningConfiguration>
{
    static constexpr auto Bindings() noexcept
    {
        using Cfg = LightningConfiguration;
        return std::make_tuple(
            MakeFieldBinding("enabled", &Cfg::Enabled),
            MakeFieldBinding("strikes_per_minute", &Cfg::StrikesPerMinute),
            MakeFieldBinding("auto_discharge", &Cfg::AutoStormDischarge),
            MakeFieldBinding("branching_factor", &Cfg::BranchingFactor),
            MakeFieldBinding("peak_current_ka", &Cfg::PeakCurrentKiloamps),
            MakeFieldBinding("cloud_sheet_luminance", &Cfg::CloudSheetLuminance),
            MakeFieldBinding("acoustic_shockwave", &Cfg::AcousticShockwave),
            MakeFieldBinding("triggered_strike_count", &Cfg::TriggeredStrikeCount),
            MakeFieldBinding("discharge", &Cfg::Discharge),
            MakeFieldBinding("cloud_source", &Cfg::CloudSource),
            MakeFieldBinding("distance_metres", &Cfg::DistanceMetres),
            MakeFieldBinding("minimum_interval_seconds", &Cfg::MinimumIntervalSeconds),
            MakeFieldBinding("maximum_interval_seconds", &Cfg::MaximumIntervalSeconds),
            MakeFieldBinding("channel_span_metres", &Cfg::ChannelSpanMetres),
            MakeFieldBinding("bolt_brightness", &Cfg::BoltBrightness),
            MakeFieldBinding("cloud_flash_strength", &Cfg::CloudFlashStrength),
            MakeFieldBinding("flash_radius_metres", &Cfg::FlashRadiusMetres));
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                        RECORD SERIALIZATION SPECIALIZATIONS
//------------------------------------------------------------------------------------------------------------------------

template <>
void RenderPipelineRecord::SerializeConfiguration(toml::table& OutTable) const
{
    EncodeSpaceTable(OutTable, Parameters);
}

template <>
void RenderPipelineRecord::DeserializeConfiguration(const toml::table& InTable)
{
    DecodeSpaceTable(InTable, Parameters);
    if (!InTable.contains("direct_shading"))
    {
        if (const auto Legacy = InTable["analytic_illumination"].value<bool>())
        {
            Parameters.DirectShading = *Legacy;
        }
    }
    if (Parameters.TraceScale == 3)
    {
        Parameters.TraceScale = 2;
    }
    Parameters.AdvanceRevision();
}

template <>
void SolarRecord::SerializeConfiguration(toml::table& OutTable) const
{
    EncodeSpaceTable(OutTable, Parameters);
}

template <>
void SolarRecord::DeserializeConfiguration(const toml::table& InTable)
{
    DecodeSpaceTable(InTable, Parameters);
    Parameters.AdvanceRevision();
}

template <>
void OpticalFlareRecord::SerializeConfiguration(toml::table& OutTable) const
{
    EncodeSpaceTable(OutTable, Parameters);
    OutTable.insert_or_assign("preview_position_x", static_cast<double>(Parameters.PreviewPosition[0]));
    OutTable.insert_or_assign("preview_position_y", static_cast<double>(Parameters.PreviewPosition[1]));
    if (!Parameters.SpaceFile.empty())
    {
        OutTable.insert_or_assign("space_file", Parameters.SpaceFile);
    }
    Detail::WriteReplicationSubtable(OutTable, Parameters.Replication);
}

template <>
void OpticalFlareRecord::DeserializeConfiguration(const toml::table& InTable)
{
    DecodeSpaceTable(InTable, Parameters);
    Parameters.PreviewPosition[0] =
        Detail::ReadScalarFloat(InTable, "preview_position_x", Parameters.PreviewPosition[0]);
    Parameters.PreviewPosition[1] =
        Detail::ReadScalarFloat(InTable, "preview_position_y", Parameters.PreviewPosition[1]);
    if (const auto File = InTable["space_file"].value<std::string>())
    {
        Parameters.SpaceFile = *File;
    }
    Detail::ReadReplicationSubtable(InTable, Parameters.Replication);
    Parameters.AdvanceRevision();
}

template <>
void AtmosphereRecord::SerializeConfiguration(toml::table& OutTable) const
{
    EncodeSpaceTable<AtmosphereOpticalConfiguration>(OutTable, Parameters);
    EncodeSpaceTable<AtmosphereConfiguration>(OutTable, Parameters);
    if (Parameters.BakedAvailable)
    {
        toml::table Baked;
        EncodeSpaceTable<AtmosphereOpticalConfiguration>(Baked, Parameters.Baked);
        OutTable.insert_or_assign("baked", std::move(Baked));
    }
}

template <>
void AtmosphereRecord::DeserializeConfiguration(const toml::table& InTable)
{
    DecodeSpaceTable<AtmosphereOpticalConfiguration>(InTable, Parameters);
    DecodeSpaceTable<AtmosphereConfiguration>(InTable, Parameters);
    if (const auto* Baked = InTable["baked"].as_table())
    {
        DecodeSpaceTable<AtmosphereOpticalConfiguration>(*Baked, Parameters.Baked);
        Parameters.BakedAvailable = true;
    }
    Parameters.AdvanceRevision();
}

template <>
void CloudRecord::SerializeConfiguration(toml::table& OutTable) const
{
    EncodeSpaceTable(OutTable, Parameters);
}

template <>
void CloudRecord::DeserializeConfiguration(const toml::table& InTable)
{
    DecodeSpaceTable(InTable, Parameters);
    Parameters.AdvanceRevision();
}

template <>
void StarRecord::SerializeConfiguration(toml::table& OutTable) const
{
    EncodeSpaceTable(OutTable, Parameters);
}

template <>
void StarRecord::DeserializeConfiguration(const toml::table& InTable)
{
    DecodeSpaceTable(InTable, Parameters);
    Parameters.AdvanceRevision();
}

template <>
void MoonRecord::SerializeConfiguration(toml::table& OutTable) const
{
    EncodeSpaceTable(OutTable, Parameters);
    toml::array Instances;
    for (const auto& Moon : Parameters.Instances)
    {
        toml::table Entry;
        EncodeSpaceTable(Entry, Moon);
        Instances.push_back(std::move(Entry));
    }
    OutTable.insert_or_assign("instances", std::move(Instances));
}

template <>
void MoonRecord::DeserializeConfiguration(const toml::table& InTable)
{
    DecodeSpaceTable(InTable, Parameters);
    Parameters.Instances[0].Visible   = Parameters.Enabled;
    Parameters.Instances[0].PhaseDays = std::clamp(Parameters.PrimaryPhase, 0.0f, 1.0f) * 29.53f;
    Parameters.Instances[1].Visible   = Parameters.SecondaryMoonEnabled;
    if (const auto* Instances = InTable["instances"].as_array())
    {
        for (size_t Index = 0; Index < std::min(Instances->size(), Parameters.Instances.size()); ++Index)
        {
            if (const auto* Entry = (*Instances)[Index].as_table())
            {
                DecodeSpaceTable(*Entry, Parameters.Instances[Index]);
            }
        }
    }
    Parameters.AdvanceRevision();
}

template <>
void PlanetRecord::SerializeConfiguration(toml::table& OutTable) const
{
    EncodeSpaceTable(OutTable, Parameters);
}

template <>
void PlanetRecord::DeserializeConfiguration(const toml::table& InTable)
{
    DecodeSpaceTable(InTable, Parameters);
    Parameters.AdvanceRevision();
}

template <>
void FogRecord::SerializeConfiguration(toml::table& OutTable) const
{
    EncodeSpaceTable(OutTable, Parameters);
}

template <>
void FogRecord::DeserializeConfiguration(const toml::table& InTable)
{
    DecodeSpaceTable(InTable, Parameters);
    Parameters.AdvanceRevision();
}

template <>
void LightningRecord::SerializeConfiguration(toml::table& OutTable) const
{
    EncodeSpaceTable(OutTable, Parameters);
}

template <>
void LightningRecord::DeserializeConfiguration(const toml::table& InTable)
{
    DecodeSpaceTable(InTable, Parameters);
    Parameters.AdvanceRevision();
}

} // namespace Frontier
