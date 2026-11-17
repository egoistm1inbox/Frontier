/*==========================================================================================================================================
                                                        FORCEFIELDSPACECODEC.H
==========================================================================================================================================*/
// 🧩 Declarative SpaceCodec schemas and `.forcespace` serialization for ForceFieldSpace and PlanetaryWindProfile.

#pragma once

#include "Engine/PhysicalDynamics/ForceField.h"
#include "Frontier/Engine/Scene/Profiles/ProfileSchemas.h"
#include "Frontier/Engine/Scene/Profiles/ReplicationProfile.h"
#include "Frontier/Engine/Scene/Profiles/SpatialProfile.h"
#include "Frontier/Engine/Scene/SpaceCodec.h"

#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

namespace Frontier
{

inline constexpr std::string_view ForceSpaceExtension = ".forcespace";
inline constexpr std::string_view ForceSpaceFormat    = "frontier.forcespace";
inline constexpr int64_t          ForceSpaceVersion   = 1;

template <>
struct SpaceSchema<PlanetaryWindProfile>
{
    static constexpr auto Bindings() noexcept
    {
        using W = PlanetaryWindProfile;
        return std::make_tuple(
            MakeFieldBinding("bearing_radians", &W::BearingRadians),
            MakeClampedField("speed_mps", &W::SpeedMetersPerSecond, 0.0, 200.0),
            MakeClampedField("gust_amplitude", &W::GustAmplitude, 0.0, 5.0),
            MakeClampedField("gust_frequency_hz", &W::GustFrequencyHz, 0.0, 10.0),
            MakeClampedField("shear_per_km", &W::ShearPerKilometer, -10.0, 10.0),
            MakeClampedField("veer_rad_per_km", &W::VeerRadiansPerKilometer, -10.0, 10.0),
            MakeClampedField("swirl_scale_m", &W::SwirlScaleMeters, 1.0, 50000.0),
            MakeClampedField("swirl_strength", &W::SwirlStrength, 0.0, 5.0),
            MakeFieldBinding("seed", &W::Seed),
            MakeClampedField("mesoscale_scale_m", &W::MesoscaleScaleMeters, 0.0, 500000.0),
            MakeClampedField("mesoscale_strength", &W::MesoscaleStrength, 0.0, 1.0),
            MakeFieldBinding("bounded", &W::Bounded),
            MakeClampedField("region_radius_m", &W::RegionRadiusMeters, 100.0, 50000.0));
    }
};

struct ForceSpaceDocument
{
    bool                 Enabled            = true;
    double               GroundPlaneYMeters = 0.0;
    double               ElapsedSeconds     = 0.0;
    double               AuthoredSeconds    = 0.0;
    PlanetaryWindProfile Wind{};
    SpatialProfile       Spatial{};
    ReplicationProfile   Replication{};
};

template <>
struct SpaceSchema<ForceSpaceDocument>
{
    static constexpr auto Bindings() noexcept
    {
        using Doc = ForceSpaceDocument;
        return std::make_tuple(
            MakeFieldBinding("enabled", &Doc::Enabled),
            MakeFieldBinding("ground_plane_y_m", &Doc::GroundPlaneYMeters),
            MakeFieldBinding("elapsed_seconds", &Doc::ElapsedSeconds),
            MakeFieldBinding("authored_seconds", &Doc::AuthoredSeconds),
            MakeFieldBinding("wind", &Doc::Wind),
            MakeFieldBinding("spatial", &Doc::Spatial),
            MakeFieldBinding("replication", &Doc::Replication));
    }
};

[[nodiscard]] inline bool WriteForceSpace(const ForceFieldSpace&     Space,
                                          const std::filesystem::path& FilePath,
                                          std::string*                 OutDiagnostic = nullptr)
{
    ForceSpaceDocument Doc;
    Doc.Enabled            = Space.QueryEnabled();
    Doc.GroundPlaneYMeters = Space.GroundPlaneYMeters();
    Doc.ElapsedSeconds     = Space.ElapsedSeconds();
    Doc.AuthoredSeconds    = Space.AuthoredSeconds();
    Doc.Wind               = Space.WindProfile();
    Doc.Spatial            = Space.QuerySpatialProfile();
    Doc.Replication        = Space.QueryReplicationProfile();
    return EncodeSpaceFile(FilePath, ForceSpaceExtension, ForceSpaceFormat, ForceSpaceVersion, Doc, OutDiagnostic);
}

[[nodiscard]] inline bool ReadForceSpace(const std::filesystem::path& FilePath,
                                         ForceFieldSpace&             OutSpace,
                                         std::string*                 OutDiagnostic = nullptr)
{
    ForceSpaceDocument Doc;
    if (!DecodeSpaceFile(FilePath, ForceSpaceExtension, ForceSpaceFormat, ForceSpaceVersion, Doc, OutDiagnostic))
    {
        return false;
    }
    OutSpace.ConfigureEnabled(Doc.Enabled);
    OutSpace.SetGroundPlaneYMeters(Doc.GroundPlaneYMeters);
    OutSpace.SetElapsedSeconds(Doc.ElapsedSeconds);
    OutSpace.SetWindProfile(Doc.Wind);
    OutSpace.AccessSpatialProfile()     = Doc.Spatial;
    OutSpace.AccessReplicationProfile() = Doc.Replication;
    return true;
}

} // namespace Frontier
