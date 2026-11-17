/*==========================================================================================================================================
                                                        COMPOSEDSCENEENTRY.H
==========================================================================================================================================*/
// 🧩 Variadic profile-composed scene entry storing any tuple of shared C++20 property profiles with SpaceCodec serialization.

#pragma once

#include "Frontier/Engine/Scene/Profiles/ProfileConcepts.h"
#include "Frontier/Engine/Scene/Profiles/ProfileSchemas.h"
#include "Frontier/Engine/Scene/SpaceCodec.h"
#include "Frontier/Engine/Scene/WorldSpace.h"

#include <toml++/toml.hpp>

#include <tuple>
#include <type_traits>
#include <utility>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    PROFILE SERIALIZATION TAGS
//------------------------------------------------------------------------------------------------------------------------

namespace Detail
{

template <typename ProfileT>
struct ProfileKeyTrait
{
    static constexpr const char* Key = "profile";
};

template <>
struct ProfileKeyTrait<SpatialProfile>
{
    static constexpr const char* Key = "spatial";
};

template <>
struct ProfileKeyTrait<MassProfile>
{
    static constexpr const char* Key = "mass";
};

template <>
struct ProfileKeyTrait<KinematicsProfile>
{
    static constexpr const char* Key = "kinematics";
};

template <>
struct ProfileKeyTrait<ThermalProfile>
{
    static constexpr const char* Key = "thermal";
};

template <>
struct ProfileKeyTrait<ChemicalProfile>
{
    static constexpr const char* Key = "chemical";
};

template <>
struct ProfileKeyTrait<SurfaceOpticsProfile>
{
    static constexpr const char* Key = "surface_optics";
};

template <>
struct ProfileKeyTrait<ReplicationProfile>
{
    static constexpr const char* Key = "replication";
};

template <typename ProfileT>
void EncodeProfileEntry(toml::table& OutTable, const ProfileT& Profile)
{
    if constexpr (std::is_same_v<ProfileT, ReplicationProfile>)
    {
        if (!Profile.Enabled && !OutTable.contains(ProfileKeyTrait<ProfileT>::Key))
        {
            return;
        }
    }
    toml::table Subtable;
    EncodeSpaceTable(Subtable, Profile);
    OutTable.insert_or_assign(ProfileKeyTrait<ProfileT>::Key, std::move(Subtable));
}

template <typename ProfileT>
void DecodeProfileEntry(const toml::table& InTable, ProfileT& OutProfile)
{
    if (const toml::table* Subtable = InTable[ProfileKeyTrait<ProfileT>::Key].as_table())
    {
        DecodeSpaceTable(*Subtable, OutProfile);
        if constexpr (requires { OutProfile.AdvanceRevision(); })
        {
            OutProfile.AdvanceRevision();
        }
    }
}

} // namespace Detail

//------------------------------------------------------------------------------------------------------------------------
//                                               VARIADIC COMPOSED SCENE ENTRY
//------------------------------------------------------------------------------------------------------------------------

template <typename... ProfileTs>
class ComposedSceneEntry final : public SceneRecordBase
{
    static_assert((HasSpaceSchema<ProfileTs> && ...), "Every profile in ComposedSceneEntry must specialize SpaceSchema");

  public:
    ComposedSceneEntry(RecordClassification InClassification,
                       std::string_view     InTypeIdentifier,
                       std::string          InDisplayName,
                       const char*          InGlyphIdentifier = "Box",
                       const char*          InGroupName       = "Simulation",
                       const char*          InAccentHex       = "#a8bbeb")
        : SceneRecordBase(InClassification, InTypeIdentifier, std::move(InDisplayName))
    {
        ConfigureEditorPresentation(InGlyphIdentifier, InGroupName, QueryTypeIdentifier().c_str(), InAccentHex);
    }

    template <typename ProfileT>
    [[nodiscard]] static constexpr bool Contains() noexcept
    {
        return (std::is_same_v<ProfileT, ProfileTs> || ...);
    }

    template <typename ProfileT>
    [[nodiscard]] ProfileT& Access() noexcept
    {
        static_assert(Contains<ProfileT>(), "Requested profile is not present on ComposedSceneEntry");
        return std::get<ProfileT>(Profiles);
    }

    template <typename ProfileT>
    [[nodiscard]] const ProfileT& Query() const noexcept
    {
        static_assert(Contains<ProfileT>(), "Requested profile is not present on ComposedSceneEntry");
        return std::get<ProfileT>(Profiles);
    }

    void SerializeConfiguration(toml::table& OutTable) const override
    {
        std::apply([&](const auto&... Profile) { (Detail::EncodeProfileEntry(OutTable, Profile), ...); }, Profiles);
    }

    void DeserializeConfiguration(const toml::table& InTable) override
    {
        std::apply([&](auto&... Profile) { (Detail::DecodeProfileEntry(InTable, Profile), ...); }, Profiles);
    }

    void StepSimulation(float DeltaSeconds) override
    {
        if (DeltaSeconds <= 0.0f)
        {
            return;
        }
        if constexpr (Contains<SpatialProfile>() && Contains<KinematicsProfile>())
        {
            SpatialProfile&    Spatial    = Access<SpatialProfile>();
            KinematicsProfile& Kinematics = Access<KinematicsProfile>();
            if (Kinematics.Motion == MotionRegime::Dynamic)
            {
                const double Dt = static_cast<double>(DeltaSeconds);
                if constexpr (Contains<MassProfile>())
                {
                    const MassProfile& Mass = Query<MassProfile>();
                    const double       Damp =
                        std::max(0.0, 1.0 - Mass.LinearDamping * Dt);
                    Kinematics.LinearVelocityMps = Kinematics.LinearVelocityMps * Damp;
                }
                if (Kinematics.GravityCoupled && Spatial.PositionMetres.Y > 0.5)
                {
                    Kinematics.LinearVelocityMps.Y -= PhysicsConstantsD::StandardGravityMps2 * Dt;
                }
                Spatial.PositionMetres = Spatial.PositionMetres + Kinematics.LinearVelocityMps * Dt;
                if (Kinematics.GravityCoupled && Spatial.PositionMetres.Y <= 0.5)
                {
                    Spatial.PositionMetres.Y = 0.5;
                    if constexpr (Contains<MassProfile>())
                    {
                        Kinematics.LinearVelocityMps.Y =
                            -Kinematics.LinearVelocityMps.Y * Query<MassProfile>().Restitution;
                    }
                    else
                    {
                        Kinematics.LinearVelocityMps.Y = 0.0;
                    }
                }
                Spatial.AdvanceRevision();
                Kinematics.AdvanceRevision();
            }
        }
        if constexpr (Contains<ThermalProfile>() && Contains<MassProfile>())
        {
            ThermalProfile&    Thermal = Access<ThermalProfile>();
            const MassProfile& Mass    = Query<MassProfile>();
            if (Thermal.Enabled)
            {
                const double HeatCap = std::max(1.0, Mass.MassKilograms * Thermal.SpecificHeatJPerKgK);
                const double RadiatedW =
                    Thermal.RadiativeCooling ? Thermal.RadiativeFluxWPerM2() : 0.0;
                const double AmbientW =
                    Thermal.RadiativeCooling
                        ? Thermal.SurfaceEmissivity * PhysicsConstantsD::StefanBoltzmannWPerM2K4 *
                              std::pow(PhysicsConstantsD::StandardAmbientTemperatureK, 4.0)
                        : 0.0;
                Thermal.TemperatureKelvin = std::max(
                    1.0, Thermal.TemperatureKelvin + ((AmbientW - RadiatedW) / HeatCap) * static_cast<double>(DeltaSeconds));
                Thermal.AdvanceRevision();
            }
        }
    }

  private:
    std::tuple<ProfileTs...> Profiles{};
};

using ComposedSpatialEntry = ComposedSceneEntry<SpatialProfile, ReplicationProfile>;
using ComposedDynamicBodyEntry =
    ComposedSceneEntry<SpatialProfile, MassProfile, KinematicsProfile, SurfaceOpticsProfile, ReplicationProfile>;
using ComposedThermalVesselEntry =
    ComposedSceneEntry<SpatialProfile, MassProfile, ThermalProfile, ChemicalProfile, ReplicationProfile>;

} // namespace Frontier
