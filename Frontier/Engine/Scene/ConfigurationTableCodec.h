/*==========================================================================================================================================
                                                      CONFIGURATIONTABLECODEC.H
==========================================================================================================================================*/
// 🧩 Shared TOML scalar, array, replication, and composable-profile table codec utilities for WorldSpace serialization.

#pragma once

#include "Frontier/Engine/Scene/EngineConfigurations.h"
#include "Frontier/Engine/Scene/Profiles/ProfileSchemas.h"
#include "Frontier/Engine/Scene/SpaceCodec.h"

#include <toml++/toml.hpp>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <string_view>

namespace Frontier::Detail
{

[[nodiscard]] inline float ReadScalarFloat(const toml::table& Table, std::string_view Key, float Fallback) noexcept
{
    if (const auto Quantity = Table[Key].value<double>();
        Quantity && std::isfinite(*Quantity) && std::abs(*Quantity) <= std::numeric_limits<float>::max())
    {
        return static_cast<float>(*Quantity);
    }
    if (const auto Whole = Table[Key].value<int64_t>())
    {
        return static_cast<float>(*Whole);
    }
    return Fallback;
}

[[nodiscard]] inline double ReadScalarDouble(const toml::table& Table, std::string_view Key, double Fallback) noexcept
{
    if (const auto Quantity = Table[Key].value<double>(); Quantity && std::isfinite(*Quantity))
    {
        return *Quantity;
    }
    if (const auto Whole = Table[Key].value<int64_t>())
    {
        return static_cast<double>(*Whole);
    }
    return Fallback;
}

[[nodiscard]] inline uint32_t ReadScalarUint32(const toml::table& Table,
                                               std::string_view   Key,
                                               uint32_t           Fallback) noexcept
{
    if (const auto IntVal = Table[Key].value<int64_t>())
    {
        return static_cast<uint32_t>(std::clamp<int64_t>(*IntVal, 0, std::numeric_limits<uint32_t>::max()));
    }
    return Fallback;
}

[[nodiscard]] inline int ReadScalarInt(const toml::table& Table, std::string_view Key, int Fallback) noexcept
{
    if (const auto IntVal = Table[Key].value<int64_t>())
    {
        if (*IntVal >= std::numeric_limits<int>::min() && *IntVal <= std::numeric_limits<int>::max())
        {
            return static_cast<int>(*IntVal);
        }
    }
    return Fallback;
}

[[nodiscard]] inline bool ReadScalarBool(const toml::table& Table, std::string_view Key, bool Fallback) noexcept
{
    if (const auto BoolVal = Table[Key].value<bool>())
    {
        return *BoolVal;
    }
    return Fallback;
}

inline void WriteFloatTriple(toml::table& OutTable, std::string_view Key, const float Values[3])
{
    toml::array Array;
    Array.push_back(static_cast<double>(Values[0]));
    Array.push_back(static_cast<double>(Values[1]));
    Array.push_back(static_cast<double>(Values[2]));
    OutTable.insert_or_assign(Key, std::move(Array));
}

inline void WriteRoundedFloatTriple(toml::table& OutTable, std::string_view Key, const float Values[3])
{
    toml::array Array;
    for (int Axis = 0; Axis < 3; ++Axis)
    {
        Array.push_back(std::round(static_cast<double>(Values[Axis]) * 1.0e4) / 1.0e4);
    }
    OutTable.insert_or_assign(Key, std::move(Array));
}

inline void ReadFloatTriple(const toml::table& InTable, std::string_view Key, float OutValues[3])
{
    if (const toml::array* Array = InTable[Key].as_array())
    {
        for (size_t Index = 0; Index < 3 && Index < Array->size(); ++Index)
        {
            if (const auto Val = (*Array)[Index].value<double>();
                Val && std::isfinite(*Val) && std::abs(*Val) <= std::numeric_limits<float>::max())
            {
                OutValues[Index] = static_cast<float>(*Val);
            }
            else if (const auto IntVal = (*Array)[Index].value<int64_t>())
            {
                OutValues[Index] = static_cast<float>(*IntVal);
            }
        }
    }
}

inline void WriteDoubleSequence(toml::table& Table, std::string_view Key, const double* Values, size_t Count)
{
    toml::array Array;
    for (size_t Index = 0; Index < Count; ++Index)
    {
        Array.push_back(Values[Index]);
    }
    Table.insert_or_assign(Key, std::move(Array));
}

inline void ReadDoubleSequence(const toml::table& Table, std::string_view Key, double* OutValues, size_t Count)
{
    if (const toml::array* Array = Table[Key].as_array())
    {
        for (size_t Index = 0; Index < Count && Index < Array->size(); ++Index)
        {
            if (const auto Value = (*Array)[Index].value<double>(); Value && std::isfinite(*Value))
            {
                OutValues[Index] = *Value;
            }
            else if (const auto Whole = (*Array)[Index].value<int64_t>())
            {
                OutValues[Index] = static_cast<double>(*Whole);
            }
        }
    }
}

inline void WriteReplicationSubtable(toml::table& OutTable, const ReplicationProfile& Replication)
{
    if (!Replication.IsActive() && Replication.OwnerPeerIdentifier == 0)
    {
        return;
    }
    toml::table Sub;
    EncodeSpaceTable(Sub, Replication);
    OutTable.insert_or_assign("replication", std::move(Sub));
}

inline void ReadReplicationSubtable(const toml::table& InTable, ReplicationProfile& Replication)
{
    if (const toml::table* Sub = InTable["replication"].as_table())
    {
        DecodeSpaceTable(*Sub, Replication);
    }
}

inline void SerializeSpatialSubtable(toml::table& OutTable, const SpatialConfiguration& Spatial)
{
    WriteFloatTriple(OutTable, "position_m", Spatial.PositionMetres);
    WriteFloatTriple(OutTable, "orientation_deg", Spatial.OrientationDegrees);
    WriteFloatTriple(OutTable, "scale", Spatial.Scale);
    WriteReplicationSubtable(OutTable, Spatial.Replication);
}

inline void DeserializeSpatialSubtable(const toml::table& InTable, SpatialConfiguration& Spatial)
{
    ReadFloatTriple(InTable, "position_m", Spatial.PositionMetres);
    ReadFloatTriple(InTable, "orientation_deg", Spatial.OrientationDegrees);
    ReadFloatTriple(InTable, "scale", Spatial.Scale);
    ReadReplicationSubtable(InTable, Spatial.Replication);
    Spatial.AdvanceRevision();
}

inline void SerializePhysicsSubtable(toml::table& OutTable, const PhysicsConfiguration& Physics)
{
    OutTable.insert_or_assign("physics_enabled", Physics.Enabled);
    OutTable.insert_or_assign("mass_kg", static_cast<double>(Physics.Mass.MassKilograms));
    OutTable.insert_or_assign("density_kg_m3", static_cast<double>(Physics.Mass.DensityKgPerCubicMetre));
    OutTable.insert_or_assign("volume_m3", static_cast<double>(Physics.Mass.VolumeCubicMetres));
    WriteFloatTriple(OutTable, "linear_velocity_mps", Physics.LinearVelocityMps);
    OutTable.insert_or_assign("restitution", static_cast<double>(Physics.Restitution));
    OutTable.insert_or_assign("static_friction", static_cast<double>(Physics.StaticFriction));
    OutTable.insert_or_assign("dynamic_friction", static_cast<double>(Physics.DynamicFriction));
    OutTable.insert_or_assign("linear_damping", static_cast<double>(Physics.LinearDamping));
    OutTable.insert_or_assign("dynamic_body", Physics.DynamicBody);
    OutTable.insert_or_assign("gravity_coupled", Physics.GravityCoupled);
    if (!Physics.SpaceFile.empty())
    {
        OutTable.insert_or_assign("physics_space_file", Physics.SpaceFile);
    }
    WriteReplicationSubtable(OutTable, Physics.Replication);
}

inline void DeserializePhysicsSubtable(const toml::table& InTable, PhysicsConfiguration& Physics)
{
    Physics.Enabled                     = ReadScalarBool(InTable, "physics_enabled", Physics.Enabled);
    Physics.Mass.MassKilograms          = ReadScalarFloat(InTable, "mass_kg", Physics.Mass.MassKilograms);
    Physics.Mass.DensityKgPerCubicMetre = ReadScalarFloat(InTable, "density_kg_m3", Physics.Mass.DensityKgPerCubicMetre);
    Physics.Mass.VolumeCubicMetres      = ReadScalarFloat(InTable, "volume_m3", Physics.Mass.VolumeCubicMetres);
    ReadFloatTriple(InTable, "linear_velocity_mps", Physics.LinearVelocityMps);
    Physics.Restitution     = ReadScalarFloat(InTable, "restitution", Physics.Restitution);
    Physics.StaticFriction  = ReadScalarFloat(InTable, "static_friction", Physics.StaticFriction);
    Physics.DynamicFriction = ReadScalarFloat(InTable, "dynamic_friction", Physics.DynamicFriction);
    Physics.LinearDamping   = ReadScalarFloat(InTable, "linear_damping", Physics.LinearDamping);
    Physics.DynamicBody     = ReadScalarBool(InTable, "dynamic_body", Physics.DynamicBody);
    Physics.GravityCoupled  = ReadScalarBool(InTable, "gravity_coupled", Physics.GravityCoupled);
    if (const auto File = InTable["physics_space_file"].value<std::string>())
    {
        Physics.SpaceFile = *File;
    }
    ReadReplicationSubtable(InTable, Physics.Replication);
    Physics.AdvanceRevision();
}

inline void SerializeThermalSubtable(toml::table& OutTable, const ThermalConfiguration& Thermal)
{
    OutTable.insert_or_assign("thermal_enabled", Thermal.Enabled);
    OutTable.insert_or_assign("temperature_k", static_cast<double>(Thermal.TemperatureKelvin));
    OutTable.insert_or_assign("specific_heat_j_kg_k", static_cast<double>(Thermal.SpecificHeatJPerKgK));
    OutTable.insert_or_assign("conductivity_w_m_k", static_cast<double>(Thermal.ThermalConductivityWPerMK));
    OutTable.insert_or_assign("emissivity", static_cast<double>(Thermal.SurfaceEmissivity));
    OutTable.insert_or_assign("convection_w_m2_k", static_cast<double>(Thermal.ConvectionCoefficientWPerM2K));
    OutTable.insert_or_assign("conductive_exchange", Thermal.ConductiveExchange);
    OutTable.insert_or_assign("radiative_exchange", Thermal.RadiativeExchange);
}

inline void DeserializeThermalSubtable(const toml::table& InTable, ThermalConfiguration& Thermal)
{
    Thermal.Enabled                      = ReadScalarBool(InTable, "thermal_enabled", Thermal.Enabled);
    Thermal.TemperatureKelvin            = ReadScalarFloat(InTable, "temperature_k", Thermal.TemperatureKelvin);
    Thermal.SpecificHeatJPerKgK          = ReadScalarFloat(InTable, "specific_heat_j_kg_k", Thermal.SpecificHeatJPerKgK);
    Thermal.ThermalConductivityWPerMK =
        ReadScalarFloat(InTable, "conductivity_w_m_k", Thermal.ThermalConductivityWPerMK);
    Thermal.SurfaceEmissivity = ReadScalarFloat(InTable, "emissivity", Thermal.SurfaceEmissivity);
    Thermal.ConvectionCoefficientWPerM2K =
        ReadScalarFloat(InTable, "convection_w_m2_k", Thermal.ConvectionCoefficientWPerM2K);
    Thermal.ConductiveExchange           = ReadScalarBool(InTable, "conductive_exchange", Thermal.ConductiveExchange);
    Thermal.RadiativeExchange            = ReadScalarBool(InTable, "radiative_exchange", Thermal.RadiativeExchange);
    Thermal.AdvanceRevision();
}

inline void SerializeChemicalSubtable(toml::table& OutTable, const ChemicalConfiguration& Chemical)
{
    OutTable.insert_or_assign("chemical_enabled", Chemical.Enabled);
    OutTable.insert_or_assign("molar_mass_g_mol", static_cast<double>(Chemical.MolarMassGramsPerMole));
    OutTable.insert_or_assign("amount_mol", static_cast<double>(Chemical.AmountMoles));
    OutTable.insert_or_assign("concentration_mol_l", static_cast<double>(Chemical.ConcentrationMolPerLitre));
    OutTable.insert_or_assign("activation_energy_kj_mol", static_cast<double>(Chemical.ActivationEnergyKjPerMol));
    OutTable.insert_or_assign("enthalpy_delta_kj_mol", static_cast<double>(Chemical.EnthalpyDeltaKjPerMol));
    OutTable.insert_or_assign("matter_phase", static_cast<int64_t>(Chemical.MatterPhaseIndex));
    OutTable.insert_or_assign("reversible", Chemical.ReversibleEquilibrium);
    OutTable.insert_or_assign("catalyzed", Chemical.CatalyzedPathway);
}

inline void DeserializeChemicalSubtable(const toml::table& InTable, ChemicalConfiguration& Chemical)
{
    Chemical.Enabled                  = ReadScalarBool(InTable, "chemical_enabled", Chemical.Enabled);
    Chemical.MolarMassGramsPerMole    = ReadScalarFloat(InTable, "molar_mass_g_mol", Chemical.MolarMassGramsPerMole);
    Chemical.AmountMoles              = ReadScalarFloat(InTable, "amount_mol", Chemical.AmountMoles);
    Chemical.ConcentrationMolPerLitre = ReadScalarFloat(InTable, "concentration_mol_l", Chemical.ConcentrationMolPerLitre);
    Chemical.ActivationEnergyKjPerMol =
        ReadScalarFloat(InTable, "activation_energy_kj_mol", Chemical.ActivationEnergyKjPerMol);
    Chemical.EnthalpyDeltaKjPerMol =
        ReadScalarFloat(InTable, "enthalpy_delta_kj_mol", Chemical.EnthalpyDeltaKjPerMol);
    Chemical.MatterPhaseIndex         = std::clamp(ReadScalarInt(InTable, "matter_phase", Chemical.MatterPhaseIndex), 0, 3);
    Chemical.ReversibleEquilibrium    = ReadScalarBool(InTable, "reversible", Chemical.ReversibleEquilibrium);
    Chemical.CatalyzedPathway         = ReadScalarBool(InTable, "catalyzed", Chemical.CatalyzedPathway);
    Chemical.AdvanceRevision();
}

inline void SerializeOpticsSubtable(toml::table& OutTable, const SurfaceOpticsConfiguration& Optics)
{
    OutTable.insert_or_assign("optics_enabled", Optics.Enabled);
    WriteFloatTriple(OutTable, "albedo_rgb", Optics.AlbedoRgb);
    OutTable.insert_or_assign("roughness", static_cast<double>(Optics.Roughness));
    OutTable.insert_or_assign("metallic", static_cast<double>(Optics.Metallic));
    OutTable.insert_or_assign("ior", static_cast<double>(Optics.IndexOfRefraction));
    OutTable.insert_or_assign("cast_shadows", Optics.CastShadows);
    OutTable.insert_or_assign("receive_gi", Optics.ReceiveGlobalIllumination);
}

inline void DeserializeOpticsSubtable(const toml::table& InTable, SurfaceOpticsConfiguration& Optics)
{
    Optics.Enabled = ReadScalarBool(InTable, "optics_enabled", Optics.Enabled);
    ReadFloatTriple(InTable, "albedo_rgb", Optics.AlbedoRgb);
    Optics.Roughness                 = ReadScalarFloat(InTable, "roughness", Optics.Roughness);
    Optics.Metallic                  = ReadScalarFloat(InTable, "metallic", Optics.Metallic);
    Optics.IndexOfRefraction         = ReadScalarFloat(InTable, "ior", Optics.IndexOfRefraction);
    Optics.CastShadows               = ReadScalarBool(InTable, "cast_shadows", Optics.CastShadows);
    Optics.ReceiveGlobalIllumination = ReadScalarBool(InTable, "receive_gi", Optics.ReceiveGlobalIllumination);
    Optics.AdvanceRevision();
}

} // namespace Frontier::Detail
