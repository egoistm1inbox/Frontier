/*==========================================================================================================================================
                                                          PROFILECONCEPTS.H
==========================================================================================================================================*/
// 🧩 C++20 concepts and generic accessors enabling one template function to operate across all profile-bearing domains.

#pragma once

#include "Frontier/Engine/Scene/Profiles/KinematicsProfile.h"
#include "Frontier/Engine/Scene/Profiles/MassProfile.h"
#include "Frontier/Engine/Scene/Profiles/ReplicationProfile.h"
#include "Frontier/Engine/Scene/Profiles/SpatialProfile.h"
#include "Frontier/Engine/Scene/Profiles/SurfaceOpticsProfile.h"
#include "Frontier/Engine/Scene/Profiles/ThermalChemicalProfiles.h"

#include <concepts>
#include <cstdint>
#include <type_traits>

namespace Frontier
{

template <typename T>
concept ProfileRevisionType = requires(T Instance) {
    { Instance.Revision } -> std::convertible_to<uint64_t>;
    { Instance.AdvanceRevision() };
};

template <typename T>
concept HasSpatialProfile = requires(T Instance, const T ConstInstance) {
    { Instance.Spatial } -> std::same_as<SpatialProfile&>;
    { ConstInstance.Spatial } -> std::same_as<const SpatialProfile&>;
};

// A viewport transform gizmo can edit any record that directly carries the shared SpatialProfile.
template <typename T>
concept SpatialEditable = HasSpatialProfile<T>;

template <typename T>
concept HasMassProfile = requires(T Instance, const T ConstInstance) {
    { Instance.Mass } -> std::same_as<MassProfile&>;
    { ConstInstance.Mass } -> std::same_as<const MassProfile&>;
};

template <typename T>
concept HasKinematicsProfile = requires(T Instance, const T ConstInstance) {
    { Instance.Kinematics } -> std::same_as<KinematicsProfile&>;
    { ConstInstance.Kinematics } -> std::same_as<const KinematicsProfile&>;
};

template <typename T>
concept HasReplicationProfile = requires(T Instance, const T ConstInstance) {
    { Instance.Replication } -> std::same_as<ReplicationProfile&>;
    { ConstInstance.Replication } -> std::same_as<const ReplicationProfile&>;
};

template <typename T>
concept HasThermalProfile = requires(T Instance, const T ConstInstance) {
    { Instance.Thermal } -> std::same_as<ThermalProfile&>;
    { ConstInstance.Thermal } -> std::same_as<const ThermalProfile&>;
};

template <typename T>
concept HasChemicalProfile = requires(T Instance, const T ConstInstance) {
    { Instance.Chemical } -> std::same_as<ChemicalProfile&>;
    { ConstInstance.Chemical } -> std::same_as<const ChemicalProfile&>;
};

template <typename T>
concept HasOpticsProfile = requires(T Instance, const T ConstInstance) {
    { Instance.Optics } -> std::same_as<SurfaceOpticsProfile&>;
    { ConstInstance.Optics } -> std::same_as<const SurfaceOpticsProfile&>;
};

// Generic helper operating across any profile-bearing record or domain entry.
template <typename EntryT>
[[nodiscard]] constexpr const SpatialProfile* TryQuerySpatialProfile(const EntryT& Entry) noexcept
{
    if constexpr (HasSpatialProfile<EntryT>)
    {
        return &Entry.Spatial;
    }
    else
    {
        return nullptr;
    }
}

template <typename EntryT>
[[nodiscard]] constexpr SpatialProfile* TryAccessSpatialProfile(EntryT& Entry) noexcept
{
    if constexpr (HasSpatialProfile<EntryT>)
    {
        return &Entry.Spatial;
    }
    else
    {
        return nullptr;
    }
}

template <typename EntryT>
[[nodiscard]] constexpr bool IsEntryReplicated(const EntryT& Entry) noexcept
{
    if constexpr (HasReplicationProfile<EntryT>)
    {
        return Entry.Replication.IsActive();
    }
    else
    {
        return false;
    }
}

template <typename EntryT>
[[nodiscard]] constexpr uint64_t ResolveEntryRevision(const EntryT& Entry) noexcept
{
    uint64_t Combined = 0;
    if constexpr (ProfileRevisionType<EntryT>)
    {
        Combined ^= Entry.Revision * 0x9e3779b97f4a7c15ull;
    }
    if constexpr (HasSpatialProfile<EntryT>)
    {
        Combined ^= (Entry.Spatial.Revision + 1u) * 0xbf58476d1ce4e5b9ull;
    }
    if constexpr (HasMassProfile<EntryT>)
    {
        Combined ^= (Entry.Mass.Revision + 1u) * 0x94d049bb133111ebull;
    }
    if constexpr (HasKinematicsProfile<EntryT>)
    {
        Combined ^= (Entry.Kinematics.Revision + 1u) * 0xd6e8feb86659fd93ull;
    }
    if constexpr (HasThermalProfile<EntryT>)
    {
        Combined ^= (Entry.Thermal.Revision + 1u) * 0xa24baed4963ee407ull;
    }
    if constexpr (HasChemicalProfile<EntryT>)
    {
        Combined ^= (Entry.Chemical.Revision + 1u) * 0x9fb21c651e98df25ull;
    }
    if constexpr (HasOpticsProfile<EntryT>)
    {
        Combined ^= (Entry.Optics.Revision + 1u) * 0xc2b2ae3d27d4eb4full;
    }
    return Combined;
}

} // namespace Frontier
