/*==========================================================================================================================================
                                                           WORLDSPACE.CPP
==========================================================================================================================================*/
// 🧩 Dynamic scene world implementation with two-sweep enclosure .levelspace loading and extensible type registry.

#include "Engine/Scene/WorldSpace.h"

#include "Engine/Foundation/Constants.h"
#include "Engine/PhysicalDynamics/ForceSourceCatalogue.h"
#include "Engine/Scene/SceneDirectory.h"
#include "Frontier/Engine/Scene/ComposedSceneEntry.h"

#include <toml++/toml.hpp>

#include <algorithm>
#include <cmath>
#include <fstream>
#include <unordered_map>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    SCENERECORDBASE
//------------------------------------------------------------------------------------------------------------------------

SceneRecordBase::SceneRecordBase(RecordClassification InClassification,
                                 std::string_view     InTypeIdentifier,
                                 std::string          InDisplayName)
    : RecordEntry(InClassification)
    , TypeIdentifier(InTypeIdentifier)
    , StoredName(std::move(InDisplayName))
{
#if FRONTIER_EDITOR
    if (!StoredName.empty())
    {
        SceneDirectory::Instance().ConfigureName(Token(), StoredName);
    }
#endif
}

void SceneRecordBase::AssignRecordName(std::string NewName)
{
    StoredName = std::move(NewName);
#if FRONTIER_EDITOR
    SceneDirectory::Instance().ConfigureName(Token(), StoredName);
#endif
}

void SceneRecordBase::AssignEnclosureToken(RecordToken EnclosureToken)
{
    if (EnclosureToken == Token())
    {
        return;
    }
    StoredEnclosure = EnclosureToken;
#if FRONTIER_EDITOR
    SceneDirectory::Instance().ConfigureParent(Token(), EnclosureToken);
#endif
}

void SceneRecordBase::ConfigureEditorPresentation(const char* GlyphIdentifier,
                                                  const char* GroupName,
                                                  const char* SubtitleCategory,
                                                  const char* AccentHex)
{
    (void)GlyphIdentifier;
    (void)GroupName;
    (void)SubtitleCategory;
    (void)AccentHex;
#if FRONTIER_EDITOR
    SceneDirectoryMetadata Meta = SceneDirectory::Instance().QueryMetadata(Token());
    if (GlyphIdentifier != nullptr && GlyphIdentifier[0] != '\0')
    {
        Meta.GlyphIdentifier = GlyphIdentifier;
    }
    if (GroupName != nullptr && GroupName[0] != '\0')
    {
        Meta.GroupName = GroupName;
    }
    if (SubtitleCategory != nullptr && SubtitleCategory[0] != '\0')
    {
        Meta.SubtitleCategory = SubtitleCategory;
    }
    if (AccentHex != nullptr && AccentHex[0] != '\0')
    {
        Meta.AccentHex = AccentHex;
    }
    SceneDirectory::Instance().ConfigureMetadata(Token(), std::move(Meta));
#endif
}

//------------------------------------------------------------------------------------------------------------------------
//                                      COMPOSABLE MULTI-CONFIGURATION STEPPING
//------------------------------------------------------------------------------------------------------------------------

SpatialNodeRecord::SpatialNodeRecord(std::string InDisplayName)
    : SceneRecordBase(RecordClassification::Geometry, "SpatialNode", std::move(InDisplayName))
{
    ConfigureEditorPresentation("Target", "Scene objects", "SpatialNode", "#a8bbeb");
#if FRONTIER_EDITOR
    InspectorRuntime::Instance().BindInspector(QueryToken(), std::make_unique<SpatialInspector>(Spatial));
#endif
}

RigidBodyRecord::RigidBodyRecord(std::string InDisplayName)
    : SceneRecordBase(RecordClassification::Geometry, "RigidBody", std::move(InDisplayName))
{
    ConfigureEditorPresentation("Box", "Scene objects", "RigidBody", "#a8bbeb");
#if FRONTIER_EDITOR
    InspectorRuntime::Instance().BindInspector(QueryToken(), std::make_unique<SpatialInspector>(Spatial));
    InspectorRuntime::Instance().AttachInspector(QueryToken(), std::make_unique<PhysicsInspector>(Physics));
    InspectorRuntime::Instance().AttachInspector(QueryToken(), std::make_unique<SurfaceOpticsInspector>(Optics));
#endif
}

void RigidBodyRecord::StepSimulation(float DeltaSeconds)
{
    if (!Physics.Enabled || !Physics.DynamicBody || DeltaSeconds <= 0.0f)
    {
        return;
    }
    const float Damping = std::max(0.0f, 1.0f - Physics.LinearDamping * DeltaSeconds);
    for (int Axis = 0; Axis < 3; ++Axis)
    {
        Physics.LinearVelocityMps[Axis] *= Damping;
        Spatial.PositionMetres[Axis] += Physics.LinearVelocityMps[Axis] * DeltaSeconds;
    }
    if (Physics.GravityCoupled && Spatial.PositionMetres[1] > 0.5f)
    {
        Physics.LinearVelocityMps[1] -= PhysicsConstantsF::StandardGravityMps2 * DeltaSeconds;
        Spatial.PositionMetres[1] += Physics.LinearVelocityMps[1] * DeltaSeconds;
        if (Spatial.PositionMetres[1] <= 0.5f)
        {
            Spatial.PositionMetres[1]    = 0.5f;
            Physics.LinearVelocityMps[1] = -Physics.LinearVelocityMps[1] * Physics.Restitution;
        }
    }
}

ThermalBodyRecord::ThermalBodyRecord(std::string InDisplayName)
    : SceneRecordBase(RecordClassification::Physics, "ThermalBody", std::move(InDisplayName))
{
    ConfigureEditorPresentation("Thermometer", "Simulation", "ThermalBody", "#e8833a");
#if FRONTIER_EDITOR
    InspectorRuntime::Instance().BindInspector(QueryToken(), std::make_unique<SpatialInspector>(Spatial));
    InspectorRuntime::Instance().AttachInspector(QueryToken(), std::make_unique<PhysicsInspector>(Physics));
    InspectorRuntime::Instance().AttachInspector(QueryToken(), std::make_unique<ThermalInspector>(Thermal, &Physics.Mass));
    InspectorRuntime::Instance().AttachInspector(QueryToken(), std::make_unique<SurfaceOpticsInspector>(Optics));
#endif
}

void ThermalBodyRecord::StepSimulation(float DeltaSeconds)
{
    if (!Thermal.Enabled || DeltaSeconds <= 0.0f)
    {
        return;
    }
    const float HeatCap     = std::max(1.0f, Physics.Mass.MassKilograms * Thermal.SpecificHeatJPerKgK);
    const float ConvectiveW = Thermal.ConvectionCoefficientWPerM2K *
                              (PhysicsConstantsF::StandardAmbientTemperatureK - Thermal.TemperatureKelvin);
    Thermal.TemperatureKelvin = std::max(1.0f, Thermal.TemperatureKelvin + (ConvectiveW / HeatCap) * DeltaSeconds);
}

ChemicalVesselRecord::ChemicalVesselRecord(std::string InDisplayName)
    : SceneRecordBase(RecordClassification::Physics, "ChemicalVessel", std::move(InDisplayName))
{
    ConfigureEditorPresentation("Droplets", "Simulation", "ChemicalVessel", "#e8833a");
#if FRONTIER_EDITOR
    InspectorRuntime::Instance().BindInspector(QueryToken(), std::make_unique<SpatialInspector>(Spatial));
    InspectorRuntime::Instance().AttachInspector(QueryToken(), std::make_unique<ThermalInspector>(Thermal));
    InspectorRuntime::Instance().AttachInspector(QueryToken(), std::make_unique<ChemicalInspector>(Chemical, &Thermal));
#endif
}

void ChemicalVesselRecord::StepSimulation(float DeltaSeconds)
{
    if (!Chemical.Enabled || DeltaSeconds <= 0.0f || Chemical.AmountMoles <= 1.0e-5f)
    {
        return;
    }
    const float RateConstant = Chemical.ComputeArrheniusRateConstant(Thermal.TemperatureKelvin);
    const float ReactedFrac  = 1.0f - std::exp(-std::min(RateConstant, 10.0f) * DeltaSeconds);
    const float DeltaMoles   = Chemical.AmountMoles * ReactedFrac;
    Chemical.AmountMoles     = std::max(0.0f, Chemical.AmountMoles - DeltaMoles);
    if (Thermal.Enabled)
    {
        const float ReleasedJoules = -DeltaMoles * Chemical.EnthalpyDeltaKjPerMol * 1000.0f;
        const float HeatCapacity =
            std::max(10.0f, Chemical.ComputeSubstanceMassKilograms() * Thermal.SpecificHeatJPerKgK);
        Thermal.TemperatureKelvin = std::clamp(Thermal.TemperatureKelvin + ReleasedJoules / HeatCapacity, 50.0f, 3500.0f);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    WORLDSPACE
//------------------------------------------------------------------------------------------------------------------------

WorldSpace::WorldSpace()
{
    RegisterNativeEngineTypes();
}

WorldSpace::~WorldSpace()
{
    Clear();
}

void WorldSpace::RegisterType(SceneTypeRegistration Registration)
{
    for (SceneTypeRegistration& Existing : TypeRegistry)
    {
        if (Existing.TypeIdentifier == Registration.TypeIdentifier)
        {
            Existing = std::move(Registration);
            return;
        }
    }
    TypeRegistry.push_back(std::move(Registration));
}

std::vector<std::pair<std::string, std::string>> WorldSpace::EnumerateRegisteredTypes() const
{
    std::vector<std::pair<std::string, std::string>> Result;
    Result.reserve(TypeRegistry.size());
    for (const SceneTypeRegistration& Entry : TypeRegistry)
    {
        Result.emplace_back(Entry.TypeIdentifier, Entry.DisplayCategoryName);
    }
    return Result;
}

void WorldSpace::RegisterNativeEngineTypes()
{
    auto RegisterSimple = [this]<typename RecordType>(const char*          TypeId,
                                                      const char*          CategoryLabel,
                                                      RecordClassification Classification,
                                                      const char*          IconName,
                                                      const char*          GroupName,
                                                      const char*          AccentHex) {
        RegisterType({
            TypeId,
            CategoryLabel,
            Classification,
            [Classification, TypeId, IconName, GroupName, AccentHex](std::string DisplayName)
                -> std::unique_ptr<SceneRecordBase> {
                return std::make_unique<RecordType>(Classification, TypeId, std::move(DisplayName), IconName, GroupName,
                                                    AccentHex);
            },
        });
    };

    RegisterType({"SpatialNode", "Spatial · Coordinate Space", RecordClassification::Geometry,
                  [](std::string Name) { return std::make_unique<SpatialNodeRecord>(std::move(Name)); }});
    RegisterType({"RigidBody", "Mechanics · Rigid Body", RecordClassification::Geometry,
                  [](std::string Name) { return std::make_unique<RigidBodyRecord>(std::move(Name)); }});
    RegisterType({"ThermalBody", "Thermodynamics · Thermal Body", RecordClassification::Physics,
                  [](std::string Name) { return std::make_unique<ThermalBodyRecord>(std::move(Name)); }});
    RegisterType({"ChemicalVessel", "Chemistry · Reaction Vessel", RecordClassification::Physics,
                  [](std::string Name) { return std::make_unique<ChemicalVesselRecord>(std::move(Name)); }});
    RegisterType({"ComposedDynamicBody", "Simulation · Composed Dynamic Body", RecordClassification::Geometry,
                  [](std::string Name) {
                      return std::make_unique<ComposedDynamicBodyEntry>(RecordClassification::Geometry,
                                                                        "ComposedDynamicBody", std::move(Name),
                                                                        "Box", "Simulation", "#a8bbeb");
                  }});

    RegisterSimple.operator()<SolarRecord>("Solar", "Environment · Solar", RecordClassification::Illumination,
                                           "NativeSun", "Environment", "#e8c27a");
    RegisterSimple.operator()<OpticalFlareRecord>("OpticalFlare", "Environment · Optical Flare",
                                                  RecordClassification::Illumination, "NativeFlare", "Environment",
                                                  "#99aafa");
    RegisterSimple.operator()<AtmosphereRecord>("Atmosphere", "Environment · Atmosphere",
                                                RecordClassification::Environment, "NativeAtmosphere", "Environment",
                                                "#99aafa");
    RegisterSimple.operator()<CloudRecord>("Clouds", "Environment · Clouds", RecordClassification::Environment,
                                           "NativeClouds", "Environment", "#99aafa");
    RegisterType({"LocalCloud", "Environment · Local Cloud", RecordClassification::Environment,
                  [](std::string Name) -> std::unique_ptr<SceneRecordBase> {
                      auto Entry = std::make_unique<CloudRecord>(RecordClassification::Environment, "Clouds",
                                                                 std::move(Name), "NativeLocalCloud", "Environment",
                                                                 "#99aafa");
                      Entry->AccessConfiguration().LocalVolume = true;
                      return Entry;
                  }});
    RegisterType({"LocalFog", "Environment · Local Fog", RecordClassification::Environment,
                  [](std::string Name) -> std::unique_ptr<SceneRecordBase> {
                      auto Entry = std::make_unique<FogRecord>(RecordClassification::Environment, "Fog",
                                                               std::move(Name), "NativeLocalFog", "Environment",
                                                               "#99aafa");
                      Entry->AccessConfiguration().LocalVolume = true;
                      return Entry;
                  }});
    RegisterSimple.operator()<StarRecord>("Stars", "Environment · Stars", RecordClassification::Environment,
                                          "NativeStars", "Environment", "#99aafa");
    RegisterSimple.operator()<MoonRecord>("Moons", "Environment · Moons", RecordClassification::Environment,
                                          "NativeMoon", "Environment", "#99aafa");
    RegisterSimple.operator()<PlanetRecord>("Planet", "Environment · Planet", RecordClassification::Environment, "Orbit",
                                            "Environment", "#99aafa");
    RegisterSimple.operator()<FogRecord>("Fog", "Environment · Fog", RecordClassification::Environment, "NativeFog",
                                         "Environment", "#99aafa");
    RegisterType({"AerialFog", "Environment · Atmospheric Fog", RecordClassification::Environment,
                  [](std::string Name) -> std::unique_ptr<SceneRecordBase> {
                      auto Entry = std::make_unique<FogRecord>(RecordClassification::Environment, "AerialFog",
                                                               std::move(Name), "NativeFog", "Environment", "#99aafa");
                      Entry->AccessConfiguration().AerialOnly = true;
                      return Entry;
                  }});
    RegisterSimple.operator()<LightningRecord>("Lightning", "Environment · Lightning",
                                               RecordClassification::Illumination, "Sparkles", "Environment", "#a6c7ff");
    RegisterSimple.operator()<ForceFieldRecord>("ForceField", "Forcefield · Atmospheric Field",
                                                RecordClassification::Environment, "Wind", "Forcefield", "#a7f3d0");
    RegisterSimple.operator()<WindRecord>("Wind", "Environment · Wind Field", RecordClassification::Environment,
                                          "Wind", "Forcefield", "#a7f3d0");
    RegisterType({"ForceSource", "Forcefield · Force Source", RecordClassification::Environment,
                  [](std::string Name) -> std::unique_ptr<SceneRecordBase> {
                      auto Entry = std::make_unique<ForceSourceRecord>(RecordClassification::Environment, "ForceSource",
                                                                       std::move(Name), "Wind", "Forcefield", "#a7f3d0");
                      Entry->AccessConfiguration() = ConstructForceSource(ForceSourceCategory::GustPuff);
                      return Entry;
                  }});
    RegisterType({"Geometry", "Scene · Geometry", RecordClassification::Geometry,
                  [](std::string Name) -> std::unique_ptr<SceneRecordBase> {
                      return std::make_unique<GeometryRecord>(RecordClassification::Geometry, "Geometry",
                                                              std::move(Name), "Box", "Geometry", "#a8bbeb");
                  }});
    RegisterType({"RenderPipeline", "Render settings", RecordClassification::Illumination,
                  [](std::string Name) -> std::unique_ptr<SceneRecordBase> {
                      auto Entry = std::make_unique<RenderPipelineRecord>(
                          RecordClassification::Illumination, "RenderPipeline", std::move(Name), "Monitor", "Rendering",
                          "#9fb4d6");
#if FRONTIER_EDITOR
                      SceneDirectoryMetadata Meta = SceneDirectory::Instance().QueryMetadata(Entry->QueryToken());
                      Meta.RemovableInEditor      = false;
                      (void)SceneDirectory::Instance().ConfigureMetadata(Entry->QueryToken(), std::move(Meta));
#endif
                      return Entry;
                  }});
    RegisterSimple.operator()<FluidPlumeRecord>("FluidPlume", "Solver · Fluid Plume", RecordClassification::Physics,
                                                "Flame", "Solvers", "#e8833a");
    RegisterSimple.operator()<FractureRecord>("Fracture", "Solver · Voronoi Fracture", RecordClassification::Physics,
                                              "Hammer", "Solvers", "#8fb3a4");
    RegisterSimple.operator()<ParticleRecord>("Particles", "Solver · GPU Particles", RecordClassification::Physics,
                                              "Sparkles", "Solvers", "#b494f4");
}

RecordToken WorldSpace::ConstructRecord(std::string_view TypeIdentifier,
                                        std::string      DisplayName,
                                        RecordToken      EnclosureToken)
{
    for (const SceneTypeRegistration& Registration : TypeRegistry)
    {
        if (Registration.TypeIdentifier == TypeIdentifier)
        {
            if (DisplayName.empty())
            {
                DisplayName = std::string(TypeIdentifier) + " " + std::to_string(OwnedRecords.size() + 1);
            }
            std::unique_ptr<SceneRecordBase> Created = Registration.ConstructCallback(std::move(DisplayName));
            if (!Created)
            {
                return {};
            }
            if (EnclosureToken.IsValid())
            {
                Created->AssignEnclosureToken(EnclosureToken);
            }
            const RecordToken Issued = Created->QueryToken();
            OwnedRecords.push_back(std::move(Created));
            return Issued;
        }
    }
    return {};
}

RecordToken WorldSpace::CloneRecord(RecordToken SourceToken, std::string NewDisplayName)
{
    const SceneRecordBase* Source = FindRecord(SourceToken);
    if (!Source)
    {
        return {};
    }
    std::string CloneName = NewDisplayName.empty() ? (Source->QueryRecordName() + " Copy") : std::move(NewDisplayName);
    const RecordToken ClonedToken =
        ConstructRecord(Source->QueryTypeIdentifier(), std::move(CloneName), Source->QueryEnclosureToken());
    if (!ClonedToken.IsValid())
    {
        return {};
    }
    if (SceneRecordBase* Cloned = FindRecord(ClonedToken))
    {
        toml::table Snapshot;
        Source->SerializeConfiguration(Snapshot);
        Cloned->DeserializeConfiguration(Snapshot);
    }
    return ClonedToken;
}

bool WorldSpace::DestroyRecord(RecordToken Token)
{
    if (!Token.IsValid())
    {
        return false;
    }

    for (std::unique_ptr<SceneRecordBase>& Candidate : OwnedRecords)
    {
        if (Candidate && Candidate->QueryEnclosureToken() == Token)
        {
            Candidate->AssignEnclosureToken(RecordToken{});
        }
    }

    const auto It = std::find_if(OwnedRecords.begin(), OwnedRecords.end(),
                                 [Token](const std::unique_ptr<SceneRecordBase>& Entry) {
                                     return Entry && Entry->QueryToken() == Token;
                                 });
    if (It == OwnedRecords.end())
    {
        return false;
    }
    OwnedRecords.erase(It);
    return true;
}

void WorldSpace::Clear()
{
    while (!OwnedRecords.empty())
    {
        OwnedRecords.pop_back();
    }
}

void WorldSpace::AdvanceSimulation(float DeltaSeconds)
{
    for (std::unique_ptr<SceneRecordBase>& Record : OwnedRecords)
    {
        if (Record)
        {
            Record->StepSimulation(DeltaSeconds);
        }
    }
}

SceneRecordBase* WorldSpace::FindRecord(RecordToken Token) noexcept
{
    for (std::unique_ptr<SceneRecordBase>& Entry : OwnedRecords)
    {
        if (Entry && Entry->QueryToken() == Token)
        {
            return Entry.get();
        }
    }
    return nullptr;
}

const SceneRecordBase* WorldSpace::FindRecord(RecordToken Token) const noexcept
{
    for (const std::unique_ptr<SceneRecordBase>& Entry : OwnedRecords)
    {
        if (Entry && Entry->QueryToken() == Token)
        {
            return Entry.get();
        }
    }
    return nullptr;
}

SceneRecordBase* WorldSpace::FindFirstByType(std::string_view TypeIdentifier) noexcept
{
    for (std::unique_ptr<SceneRecordBase>& Entry : OwnedRecords)
    {
        if (Entry && Entry->QueryTypeIdentifier() == TypeIdentifier)
        {
            return Entry.get();
        }
    }
    return nullptr;
}

std::vector<const SceneRecordBase*> WorldSpace::FindAllByType(std::string_view TypeIdentifier) const
{
    std::vector<const SceneRecordBase*> Found;
    for (const std::unique_ptr<SceneRecordBase>& Entry : OwnedRecords)
    {
        if (Entry && Entry->QueryTypeIdentifier() == TypeIdentifier)
        {
            Found.push_back(Entry.get());
        }
    }
    return Found;
}

bool WorldSpace::LoadLevelSpace(const std::filesystem::path& LevelSpacePath, std::string* OutError)
{
    if (LevelSpacePath.extension() != LevelSpaceExtension)
    {
        if (OutError)
        {
            *OutError = "Level container must carry the .levelspace extension: " + LevelSpacePath.string();
        }
        return false;
    }

    toml::table Document;
    try
    {
        Document = toml::parse_file(LevelSpacePath.string());
    }
    catch (const toml::parse_error& Error)
    {
        if (OutError)
        {
            *OutError = std::string("Failed to parse .levelspace: ") + std::string(Error.description());
        }
        return false;
    }

    Clear();
    LoadedLevelPath = LevelSpacePath;

    if (const toml::table* LevelHeader = Document["level"].as_table())
    {
        if (const auto Name = (*LevelHeader)["name"].value<std::string>())
        {
            WorldName = *Name;
        }
    }

    // Two-sweep load: construct every record and record its identity first, then bind all enclosure links.
    std::unordered_map<std::string, RecordToken>     IdentityMap;
    std::vector<std::pair<RecordToken, std::string>> PendingEnclosures;

    if (const toml::array* RecordsArray = Document["records"].as_array())
    {
        for (size_t Index = 0; Index < RecordsArray->size(); ++Index)
        {
            const toml::table* EntryTable = (*RecordsArray)[Index].as_table();
            if (!EntryTable)
            {
                continue;
            }
            const std::string TypeId   = (*EntryTable)["type"].value_or(std::string{});
            const std::string Name     = (*EntryTable)["name"].value_or(TypeId);
            const std::string Identity = (*EntryTable)["identity"].value_or(std::string{});
            std::string       EnclosureId = (*EntryTable)["enclosure"].value_or(std::string{});
            if (EnclosureId.empty())
            {
                EnclosureId = (*EntryTable)["parent"].value_or(std::string{});
            }
            if (TypeId.empty())
            {
                continue;
            }

            const RecordToken Created = ConstructRecord(TypeId, Name, RecordToken{});
            if (!Created.IsValid())
            {
                continue;
            }
            if (!Identity.empty())
            {
                IdentityMap.emplace(Identity, Created);
            }
            if (!EnclosureId.empty())
            {
                PendingEnclosures.emplace_back(Created, std::move(EnclosureId));
            }
            if (SceneRecordBase* Record = FindRecord(Created))
            {
                if (const toml::table* ConfigTable = (*EntryTable)["configuration"].as_table())
                {
                    Record->DeserializeConfiguration(*ConfigTable);
                }
            }
        }
    }

    for (const auto& [ChildToken, EnclosureId] : PendingEnclosures)
    {
        const auto Found = IdentityMap.find(EnclosureId);
        if (Found == IdentityMap.end() || Found->second == ChildToken)
        {
            continue;
        }
        if (SceneRecordBase* Record = FindRecord(ChildToken))
        {
            Record->AssignEnclosureToken(Found->second);
        }
    }

    return true;
}

bool WorldSpace::SaveLevelSpace(const std::filesystem::path& LevelSpacePath, std::string* OutError) const
{
    if (LevelSpacePath.extension() != LevelSpaceExtension)
    {
        if (OutError)
        {
            *OutError = "Level container must carry the .levelspace extension: " + LevelSpacePath.string();
        }
        return false;
    }

    std::error_code FsErr;
    if (LevelSpacePath.has_parent_path())
    {
        std::filesystem::create_directories(LevelSpacePath.parent_path(), FsErr);
    }

    toml::table Root;
    toml::table Header;
    Header.insert_or_assign("format_version", int64_t{1});
    Header.insert_or_assign("name", WorldName);
    Root.insert_or_assign("level", std::move(Header));

    std::unordered_map<uint64_t, std::string> TokenIdentities;
    for (size_t Index = 0; Index < OwnedRecords.size(); ++Index)
    {
        if (OwnedRecords[Index])
        {
            TokenIdentities.emplace(OwnedRecords[Index]->QueryToken().Value, "rec_" + std::to_string(Index + 1));
        }
    }

    toml::array RecordsArray;
    for (const std::unique_ptr<SceneRecordBase>& Record : OwnedRecords)
    {
        if (!Record)
        {
            continue;
        }
        toml::table Entry;
        Entry.insert_or_assign("identity", TokenIdentities[Record->QueryToken().Value]);
        Entry.insert_or_assign("type", Record->QueryTypeIdentifier());
        Entry.insert_or_assign("name", Record->QueryRecordName());
        const RecordToken Enclosure = Record->QueryEnclosureToken();
        if (Enclosure.IsValid())
        {
            if (const auto Found = TokenIdentities.find(Enclosure.Value); Found != TokenIdentities.end())
            {
                Entry.insert_or_assign("enclosure", Found->second);
            }
        }
        toml::table Config;
        Record->SerializeConfiguration(Config);
        Entry.insert_or_assign("configuration", std::move(Config));
        RecordsArray.push_back(std::move(Entry));
    }
    Root.insert_or_assign("records", std::move(RecordsArray));

    std::ofstream Output(LevelSpacePath, std::ios::binary | std::ios::trunc);
    if (!Output)
    {
        if (OutError)
        {
            *OutError = "Unable to open .levelspace for writing: " + LevelSpacePath.string();
        }
        return false;
    }
    Output << Root << "\n";
    return Output.good();
}

bool WorldSpace::LoadStartupLevelFromProject(const std::filesystem::path& ProjectSpacePath, std::string* OutError)
{
    if (ProjectSpacePath.extension() != ".projectspace")
    {
        if (OutError)
        {
            *OutError = "Project descriptor must carry .projectspace extension: " + ProjectSpacePath.string();
        }
        return false;
    }

    toml::table ProjectDoc;
    try
    {
        ProjectDoc = toml::parse_file(ProjectSpacePath.string());
    }
    catch (const toml::parse_error& Error)
    {
        if (OutError)
        {
            *OutError = std::string("Failed to parse .projectspace: ") + std::string(Error.description());
        }
        return false;
    }

    const std::filesystem::path ProjectRoot = ProjectSpacePath.parent_path();
    std::string                 StartupId;
    if (const toml::table* EngineTable = ProjectDoc["engine"].as_table())
    {
        StartupId = (*EngineTable)["startup_level"].value_or(std::string{});
    }

    if (!StartupId.empty())
    {
        if (const toml::array* Levels = ProjectDoc["levels"].as_array())
        {
            for (size_t Index = 0; Index < Levels->size(); ++Index)
            {
                const toml::table* LevelEntry = (*Levels)[Index].as_table();
                if (!LevelEntry)
                {
                    continue;
                }
                if ((*LevelEntry)["identity"].value_or(std::string{}) == StartupId)
                {
                    const std::string RelPath = (*LevelEntry)["path"].value_or(std::string{});
                    if (!RelPath.empty())
                    {
                        return LoadLevelSpace(ProjectRoot / RelPath, OutError);
                    }
                }
            }
        }
    }

    const std::filesystem::path DefaultLevel = ProjectRoot / "Content" / "Levels" / "Default.levelspace";
    if (std::filesystem::exists(DefaultLevel))
    {
        return LoadLevelSpace(DefaultLevel, OutError);
    }

    if (OutError)
    {
        *OutError = "No startup .levelspace found for project: " + ProjectSpacePath.string();
    }
    return false;
}

} // namespace Frontier
