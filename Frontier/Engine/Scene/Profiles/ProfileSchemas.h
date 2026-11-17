/*==========================================================================================================================================
                                                          PROFILESCHEMAS.H
==========================================================================================================================================*/
// 🧩 Declarative SpaceSchema bindings for all shared profiles and `.profilespace` packs.

#pragma once

#include "Frontier/Engine/Scene/Profiles/ProfilePack.h"
#include "Frontier/Engine/Scene/SpaceCodec.h"

namespace Frontier
{

template <>
struct SpaceSchema<SpatialProfile>
{
    static constexpr auto Bindings() noexcept
    {
        return std::make_tuple(
            MakeFieldBinding("position_m", &SpatialProfile::PositionMetres),
            MakeFieldBinding("orientation_deg", &SpatialProfile::OrientationDegrees),
            MakeFieldBinding("scale", &SpatialProfile::Scale));
    }
};

template <>
struct SpaceSchema<MassProfile>
{
    static constexpr auto Bindings() noexcept
    {
        return std::make_tuple(
            MakeClampedField("mass_kg", &MassProfile::MassKilograms, 1.0e-6, 1.0e12),
            MakeClampedField("density_kg_m3", &MassProfile::DensityKgPerCubicMetre, 1.0e-4, 1.0e6),
            MakeClampedField("volume_m3", &MassProfile::VolumeCubicMetres, 1.0e-9, 1.0e12),
            MakeClampedField("restitution", &MassProfile::Restitution, 0.0, 1.0),
            MakeClampedField("static_friction", &MassProfile::StaticFriction, 0.0, 10.0),
            MakeClampedField("dynamic_friction", &MassProfile::DynamicFriction, 0.0, 10.0),
            MakeClampedField("linear_damping", &MassProfile::LinearDamping, 0.0, 100.0),
            MakeClampedField("angular_damping", &MassProfile::AngularDamping, 0.0, 100.0));
    }
};

template <>
struct SpaceSchema<KinematicsProfile>
{
    static constexpr auto Bindings() noexcept
    {
        return std::make_tuple(
            MakeClampedField("motion_regime", &KinematicsProfile::Motion, 0.0, 2.0),
            MakeFieldBinding("linear_velocity_mps", &KinematicsProfile::LinearVelocityMps),
            MakeFieldBinding("angular_velocity_rad_s", &KinematicsProfile::AngularVelocityRadSec),
            MakeFieldBinding("gravity_coupled", &KinematicsProfile::GravityCoupled),
            MakeFieldBinding("allow_sleep", &KinematicsProfile::AllowSleep));
    }
};

template <>
struct SpaceSchema<ThermalProfile>
{
    static constexpr auto Bindings() noexcept
    {
        return std::make_tuple(
            MakeFieldBinding("enabled", &ThermalProfile::Enabled),
            MakeClampedField("temperature_k", &ThermalProfile::TemperatureKelvin, 0.01, 1.0e6),
            MakeClampedField("specific_heat_j_kg_k", &ThermalProfile::SpecificHeatJPerKgK, 1.0, 1.0e5),
            MakeClampedField("conductivity_w_m_k", &ThermalProfile::ThermalConductivityWPerMK, 0.0, 1.0e5),
            MakeClampedField("emissivity", &ThermalProfile::SurfaceEmissivity, 0.0, 1.0),
            MakeFieldBinding("radiative_cooling", &ThermalProfile::RadiativeCooling));
    }
};

template <>
struct SpaceSchema<ChemicalProfile>
{
    static constexpr auto Bindings() noexcept
    {
        return std::make_tuple(
            MakeFieldBinding("enabled", &ChemicalProfile::Enabled),
            MakeClampedField("molar_mass_g_mol", &ChemicalProfile::MolarMassGramsPerMole, 0.1, 1.0e6),
            MakeClampedField("moles", &ChemicalProfile::AmountMoles, 0.0, 1.0e9),
            MakeClampedField("concentration_mol_l", &ChemicalProfile::ConcentrationMolPerLitre, 0.0, 1.0e6),
            MakeClampedField("activation_energy_kj_mol", &ChemicalProfile::ActivationEnergyKjPerMol, 0.0, 1.0e5),
            MakeClampedField("pre_exponential_per_s", &ChemicalProfile::PreExponentialFactorPerSec, 0.0, 1.0e18),
            MakeFieldBinding("enthalpy_delta_kj_mol", &ChemicalProfile::EnthalpyDeltaKjPerMol),
            MakeClampedField("matter_phase", &ChemicalProfile::Phase, 0.0, 3.0),
            MakeFieldBinding("reversible", &ChemicalProfile::ReversibleEquilibrium),
            MakeFieldBinding("catalyzed", &ChemicalProfile::CatalyzedPathway));
    }
};

template <>
struct SpaceSchema<SurfaceOpticsProfile>
{
    static constexpr auto Bindings() noexcept
    {
        return std::make_tuple(
            MakeFieldBinding("enabled", &SurfaceOpticsProfile::Enabled),
            MakeFieldBinding("albedo_rgb", &SurfaceOpticsProfile::AlbedoRgb),
            MakeClampedField("roughness", &SurfaceOpticsProfile::Roughness, 0.0, 1.0),
            MakeClampedField("metallic", &SurfaceOpticsProfile::Metallic, 0.0, 1.0),
            MakeClampedField("ior", &SurfaceOpticsProfile::IndexOfRefraction, 1.0, 4.0),
            MakeClampedField("emissive_strength", &SurfaceOpticsProfile::EmissiveStrength, 0.0, 1.0e5),
            MakeFieldBinding("cast_shadows", &SurfaceOpticsProfile::CastShadows),
            MakeFieldBinding("receive_gi", &SurfaceOpticsProfile::ReceiveGlobalIllumination));
    }
};

template <>
struct SpaceSchema<ReplicationProfile>
{
    static constexpr auto Bindings() noexcept
    {
        return std::make_tuple(
            MakeFieldBinding("enabled", &ReplicationProfile::Enabled),
            MakeClampedField("authority", &ReplicationProfile::Authority, 0.0, 3.0),
            MakeClampedField("channel", &ReplicationProfile::Channel, 0.0, 3.0),
            MakeClampedField("update_frequency_hz", &ReplicationProfile::UpdateFrequencyHz, 1.0, 240.0),
            MakeFieldBinding("owner_peer_id", &ReplicationProfile::OwnerPeerIdentifier),
            MakeFieldBinding("replicate_spatial", &ReplicationProfile::ReplicateSpatial),
            MakeFieldBinding("replicate_kinematics", &ReplicationProfile::ReplicateKinematics),
            MakeFieldBinding("replicate_parameters", &ReplicationProfile::ReplicateParameters),
            MakeFieldBinding("interpolate_proxy", &ReplicationProfile::InterpolateProxy));
    }
};

template <>
struct SpaceSchema<ProfileBundle>
{
    static constexpr auto Bindings() noexcept
    {
        return std::make_tuple(
            MakeFieldBinding("identifier", &ProfileBundle::Identifier),
            MakeFieldBinding("spatial", &ProfileBundle::Spatial),
            MakeFieldBinding("mass", &ProfileBundle::Mass),
            MakeFieldBinding("kinematics", &ProfileBundle::Kinematics),
            MakeFieldBinding("thermal", &ProfileBundle::Thermal),
            MakeFieldBinding("chemical", &ProfileBundle::Chemical),
            MakeFieldBinding("optics", &ProfileBundle::Optics),
            MakeFieldBinding("replication", &ProfileBundle::Replication));
    }
};

template <>
struct SpaceSchema<ProfilePack>
{
    static constexpr auto Bindings() noexcept
    {
        return std::make_tuple(
            MakeFieldBinding("pack_name", &ProfilePack::PackName),
            MakeFieldBinding("bundles", &ProfilePack::Bundles));
    }
};

} // namespace Frontier
