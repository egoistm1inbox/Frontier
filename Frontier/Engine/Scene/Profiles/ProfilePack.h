/*==========================================================================================================================================
                                                            PROFILEPACK.H
==========================================================================================================================================*/
// 🧩 Standalone `.profilespace` container holding named reusable Spatial, Mass, Kinematics, Thermal, Optics, and
//    Replication profiles shared across Particle, ForceField, Fluid, Physics, Effects, and Geometry records.

#pragma once

#include "Frontier/Engine/Scene/Profiles/KinematicsProfile.h"
#include "Frontier/Engine/Scene/Profiles/MassProfile.h"
#include "Frontier/Engine/Scene/Profiles/ReplicationProfile.h"
#include "Frontier/Engine/Scene/Profiles/SpatialProfile.h"
#include "Frontier/Engine/Scene/Profiles/SurfaceOpticsProfile.h"
#include "Frontier/Engine/Scene/Profiles/ThermalChemicalProfiles.h"

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace Frontier
{

inline constexpr std::string_view ProfileSpaceExtension = ".profilespace";
inline constexpr std::string_view ProfileSpaceFormat    = "frontier.profilespace";
inline constexpr int64_t          ProfileSpaceVersion   = 1;

struct ProfileBundle
{
    std::string                      Identifier = "default";
    SpatialProfile                   Spatial{};
    MassProfile                      Mass{};
    KinematicsProfile                Kinematics{};
    ThermalProfile                   Thermal{};
    ChemicalProfile                  Chemical{};
    SurfaceOpticsProfile             Optics{};
    ReplicationProfile               Replication{};
};

struct ProfilePack
{
    std::string                PackName = "SharedProfiles";
    std::vector<ProfileBundle> Bundles{};

    [[nodiscard]] const ProfileBundle* FindBundle(std::string_view Identifier) const noexcept
    {
        for (const ProfileBundle& Entry : Bundles)
        {
            if (Entry.Identifier == Identifier)
            {
                return &Entry;
            }
        }
        return nullptr;
    }

    [[nodiscard]] ProfileBundle* FindBundle(std::string_view Identifier) noexcept
    {
        for (ProfileBundle& Entry : Bundles)
        {
            if (Entry.Identifier == Identifier)
            {
                return &Entry;
            }
        }
        return nullptr;
    }
};

} // namespace Frontier
