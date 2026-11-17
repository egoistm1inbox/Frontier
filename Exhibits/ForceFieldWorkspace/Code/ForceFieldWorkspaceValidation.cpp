// Force Field + Wind workspace validation: scripted UI interaction, native force evaluation, .levelspace round-trip,
// and production-style PPM evidence for the source, wind, and field Inspector pages.

#include "Frontier/Engine/Interface/Workspaces/ForceFieldWorkspace.h"
#include "Frontier/Engine/Interface/Workspaces/ForceFieldWorkspaceRuntime.h"
#include "Frontier/Engine/Scene/WorldSpace.h"
#include "Frontier/Engine/PhysicalDynamics/ForceSourceCatalogue.h"
#include "Frontier/Engine/Interface/Controls/Toast.h"
#include "Frontier/Engine/Interface/InspectorControls.h"
#include "Engine/Interface/TypefaceRegistry.h"
#include "Exhibits/ControlCentre/Code/CpuRasterization.h"

#include <imgui.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace
{

void Confirm(bool Condition, const char* Description)
{
    if (!Condition) throw std::runtime_error(Description);
}

void ConfirmNear(double Actual, double Expected, const char* Description, double Tolerance = 1.0e-4)
{
    if (!std::isfinite(Actual) || std::abs(Actual - Expected) > Tolerance) throw std::runtime_error(Description);
}

void ValidateNativeEvaluator()
{
    using namespace Frontier;

    ForceFieldWorkspaceState Ambient{};
    ApplyForceFieldWorkspacePreset(Ambient, 3);
    Ambient.Wind.Enabled = true;
    Ambient.Wind.Bounded = true;
    Ambient.Wind.RegionRadius = 500.0;
    Ambient.Wind.Bearing = 90.0;
    Ambient.Wind.Speed = 8.0;
    Ambient.Wind.GustStrength = 0.0;
    Ambient.Wind.Turbulence = 0.0;
    Ambient.Wind.Shear = 0.0;
    Ambient.Wind.Veer = 0.0;
    Ambient.Wind.MesoscaleStrength = 0.0;

    ForceFieldWorkspaceRuntime AmbientRuntime;
    AmbientRuntime.Synchronize(Ambient);
    const SpatialVector Centre = AmbientRuntime.Sample(ForceContribution::Flow, {0.0, 10.0, 0.0});
    const SpatialVector Halfway = AmbientRuntime.Sample(ForceContribution::Flow, {250.0, 10.0, 0.0});
    const SpatialVector Outside = AmbientRuntime.Sample(ForceContribution::Flow, {500.0, 10.0, 0.0});
    ConfirmNear(Centre.X, 8.0, "Native bounded ambient wind did not evaluate at full strength in-region");
    ConfirmNear(Halfway.X, 4.0, "Native bounded ambient wind did not smoothly fade at half-radius");
    ConfirmNear(Outside.X, 0.0, "Native bounded ambient wind leaked beyond its regional radius");

    ForceFieldWorkspaceState LocalGenerator{};
    ApplyForceFieldWorkspacePreset(LocalGenerator, 3);
    LocalGenerator.Wind.Enabled = false;
    LocalGenerator.ClockPlaying = false;
    const int WindGenerator = QueryForceFieldTypeById("WindGenerator");
    const int GeneratorIndex = AddForceFieldWorkspaceSource(LocalGenerator, WindGenerator, 0.0, 0.0, 0.0);
    Confirm(GeneratorIndex == 0, "Could not create an isolated localized Wind Generator");
    ForceFieldWorkspaceSource& Generator = LocalGenerator.Sources.front();
    Generator.Reach = ForceFieldReachColumn;
    Generator.Radius = 1000.0;
    Generator.Height = 100.0;
    Generator.Bearing = 90.0;
    Generator.Params[0] = 10.0;
    Generator.Params[1] = 1.0;
    Generator.Params[2] = 0.5;
    Generator.Params[3] = 0.0;
    Generator.Params[4] = 40.0;

    ForceFieldWorkspaceRuntime GeneratorRuntime;
    LocalGenerator.ClockTime = 0.0;
    GeneratorRuntime.Synchronize(LocalGenerator);
    const SpatialVector GustPeak = GeneratorRuntime.Sample(ForceContribution::Flow, {0.0, 0.0, 0.0});
    LocalGenerator.ClockTime = 1.5;
    GeneratorRuntime.Synchronize(LocalGenerator);
    const SpatialVector GustTrough = GeneratorRuntime.Sample(ForceContribution::Flow, {0.0, 0.0, 0.0});
    ConfirmNear(GustPeak.X, 10.0, "Localized Wind Generator did not use the native Current evaluator");
    ConfirmNear(GustTrough.X, 0.0, "Localized Wind Generator gust did not respond to timeline time");

    ForceFieldWorkspaceState Gravity{};
    ApplyForceFieldWorkspacePreset(Gravity, 3);
    const int GravityIndex = AddForceFieldWorkspaceSource(Gravity, QueryForceFieldTypeById("Gravity"), 0.0, 0.0, 0.0);
    Confirm(GravityIndex == 0, "Could not create an isolated native Gravity source");
    Gravity.Sources.front().Reach = ForceFieldReachSphere;
    Gravity.Sources.front().Radius = 300.0;
    Gravity.Sources.front().Params[0] = 9.81;
    ForceFieldWorkspaceRuntime GravityRuntime;
    GravityRuntime.Synchronize(Gravity);
    const SpatialVector Acceleration = GravityRuntime.Sample(ForceContribution::Accelerate, {0.0, 20.0, 0.0});
    Confirm(Acceleration.Y < -9.0, "The workspace did not evaluate its source through the native acceleration solver");
}

void ValidateNativeLevelspaceRoundTrip(const std::filesystem::path& Destination)
{
    using namespace Frontier;

    static constexpr std::array<ForceSourceCategory, 17> ExpectedCategories = {
        ForceSourceCategory::Current, ForceSourceCategory::TornadoColumn, ForceSourceCategory::JetCorridor,
        ForceSourceCategory::GustFront, ForceSourceCategory::Microburst, ForceSourceCategory::ThermalUpdraft,
        ForceSourceCategory::GustPuff, ForceSourceCategory::BlastWave, ForceSourceCategory::VehicleWake,
        ForceSourceCategory::Current, ForceSourceCategory::Attractor, ForceSourceCategory::Repulsor,
        ForceSourceCategory::Orbit, ForceSourceCategory::Lift, ForceSourceCategory::MagneticDipole,
        ForceSourceCategory::Gravity, ForceSourceCategory::DragVolume,
    };

    Confirm(QueryForceFieldTypeCount() == static_cast<int>(ExpectedCategories.size()), "The workspace catalogue must contain all 17 source types");

    ForceFieldWorkspaceState State{};
    ApplyForceFieldWorkspacePreset(State, 3);
    Confirm(State.Scenario == 3 && State.Sources.empty() && !State.Wind.Enabled,
            "Blank · Build must reset to a genuinely empty, wind-disabled workspace");

    State.FieldEnabled = true;
    State.FieldChannels[2] = false;
    State.ViewMode = 1;
    State.ClockTime = 17.25;
    State.ClockPlaying = false;
    State.ClockRate = 10;
    State.TimelineDuration = 75.0;

    State.Wind.Enabled = true;
    State.Wind.Bounded = true;
    State.Wind.RegionRadius = 2345.5;
    State.Wind.Bearing = 211.25;
    State.Wind.Speed = 9.5;
    State.Wind.GustAmplitude = 3.4;
    State.Wind.GustStrength = 0.37;
    State.Wind.GustFrequency = 0.27;
    State.Wind.Turbulence = 0.62;
    State.Wind.TurbulenceScale = 67.5;
    State.Wind.Shear = 0.28;
    State.Wind.Veer = -14.5;
    State.Wind.MesoscaleStrength = 0.31;
    State.Wind.MesoscaleScale = 12345.0;
    State.Wind.Seed = 9191;

    for (int TypeIndex = 0; TypeIndex < QueryForceFieldTypeCount(); ++TypeIndex)
    {
        const ForceFieldWorkspaceType& Type = QueryForceFieldType(TypeIndex);
        char                         Name[96]{};
        std::snprintf(Name, sizeof(Name), "Roundtrip %s", Type.Id);
        const int Inserted = AddForceFieldWorkspaceSource(State, TypeIndex, 30.0 + TypeIndex * 11.0,
                                                          18.0 + TypeIndex * 2.0, -45.0 - TypeIndex * 13.0);
        Confirm(Inserted == TypeIndex, "A catalogue type could not be added to the blank workspace");

        ForceFieldWorkspaceSource& Source = State.Sources.back();
        Source.Name = Name;
        Source.Enabled = (TypeIndex % 2) == 0;
        Source.Centre[0] = 30.0 + TypeIndex * 11.0;
        Source.Centre[1] = 18.0 + TypeIndex * 2.0;
        Source.Centre[2] = -45.0 - TypeIndex * 13.0;
        Source.Reach = TypeIndex % 3;
        Source.Radius = 125.0 + TypeIndex * 7.0;
        Source.Height = 320.0 + TypeIndex * 5.0;
        Source.HalfX = 61.0 + TypeIndex;
        Source.HalfZ = 93.0 + TypeIndex;
        Source.Falloff = TypeIndex % 4;
        Source.Activation = TypeIndex == 7 ? ForceFieldActivationWindow
                                            : (TypeIndex == 10 ? ForceFieldActivationTrigger : ForceFieldActivationAlways);
        Source.Begins = 4.25;
        Source.Lasts = 7.5;
        Source.Repeats = 13.0;
        Source.RampIn = 0.25;
        Source.RampOut = 0.75;
        Source.TriggeredAt = TypeIndex == 10 ? 8.0 : -1.0;
        Source.Bearing = std::fmod(25.0 + TypeIndex * 11.0, 360.0);
        Source.TrackBearing = std::fmod(190.0 + TypeIndex * 7.0, 360.0);
        Source.Spin = (TypeIndex % 2) == 0 ? 1 : -1;
        Source.Acts[0] = true;
        Source.Acts[6] = (TypeIndex % 3) == 0;
        for (int Parameter = 0; Parameter < Type.ParamCount; ++Parameter)
        {
            const ForceFieldWorkspaceTypeParam& Param = Type.Params[Parameter];
            Source.Params[Parameter] = std::clamp(Param.Default + 0.125, Param.Minimum, Param.Maximum);
            if (Param.Key != nullptr && std::string(Param.Key) == "Height") Source.Height = Source.Params[Parameter];
        }
        if (std::string(Type.Id) == "WindGenerator")
        {
            Source.Params[0] = 13.25;
            Source.Params[1] = 0.73;
            Source.Params[2] = 0.44;
            Source.Params[3] = 0.81;
            Source.Params[4] = 123.5;
        }
    }

    std::string Diagnostic;
    Confirm(ExportForceFieldWorkspaceLevelSpace(State, Destination, &Diagnostic),
            Diagnostic.empty() ? "Native .levelspace export failed" : Diagnostic.c_str());

    WorldSpace Loaded;
    Diagnostic.clear();
    Confirm(Loaded.LoadLevelSpace(Destination, &Diagnostic), Diagnostic.empty() ? "WorldSpace::LoadLevelSpace failed" : Diagnostic.c_str());
    Confirm(Loaded.QueryWorldName() == "Blank · Build", "The native Levelspace lost its preset/world name");
    Confirm(Loaded.QueryRecordCount() == 19, "Native Levelspace must contain a ForceField, Wind, and all 17 ForceSource records");

    ForceFieldRecord* FieldRecord = Loaded.FindFirst<ForceFieldRecord>();
    WindRecord* WindRecordEntry = Loaded.FindFirst<WindRecord>();
    Confirm(FieldRecord != nullptr && WindRecordEntry != nullptr, "Native Levelspace did not reconstruct ForceField and Wind records");
    Confirm(FieldRecord->QueryConfiguration().Enabled, "Native ForceField enabled state did not round-trip");
    Confirm(FieldRecord->QueryConfiguration().Projection == ForceFieldProjection::Oblique,
            "Native ForceField projection did not round-trip");
    Confirm(FieldRecord->QueryConfiguration().TimelineRate == 10.0f &&
                FieldRecord->QueryConfiguration().TimelineDurationSeconds == 75.0f &&
                !FieldRecord->QueryConfiguration().TimelinePlaying,
            "Native ForceField timeline configuration did not round-trip");
    uint32_t ExpectedReceivers = 0;
    for (int Channel = 0; Channel < 7; ++Channel)
        if (State.FieldChannels[Channel]) ExpectedReceivers |= (1u << static_cast<uint32_t>(Channel));
    Confirm(FieldRecord->QueryConfiguration().Receivers == ExpectedReceivers,
            "Native ForceField receiver mask did not round-trip");
    Confirm(WindRecordEntry->QueryEnclosureToken() == FieldRecord->QueryToken(), "The Wind record is not parented under the native ForceField");

    const WindConfiguration& LoadedWind = WindRecordEntry->QueryConfiguration();
    Confirm(LoadedWind.Enabled && LoadedWind.Bounded, "Bounded ambient Wind enabled state did not round-trip");
    ConfirmNear(LoadedWind.RegionRadiusMetres, State.Wind.RegionRadius, "Bounded ambient Wind radius did not round-trip");
    ConfirmNear(LoadedWind.SpeedMetresPerSecond, State.Wind.Speed, "Ambient Wind speed did not round-trip");
    ConfirmNear(LoadedWind.DirectionDegrees, State.Wind.Bearing, "Ambient Wind direction did not round-trip");
    ConfirmNear(LoadedWind.GustStrength, State.Wind.GustStrength, "Ambient Wind gust strength did not round-trip");
    ConfirmNear(LoadedWind.GustFrequencyHz, State.Wind.GustFrequency, "Ambient Wind gust frequency did not round-trip");
    ConfirmNear(LoadedWind.TurbulenceScaleMetres, State.Wind.TurbulenceScale, "Ambient Wind turbulence scale did not round-trip");

    const std::vector<ForceSourceRecord*> LoadedSources = Loaded.FindAll<ForceSourceRecord>();
    Confirm(LoadedSources.size() == ExpectedCategories.size(), "Not all 17 native ForceSource records were reconstructed");
    for (size_t Index = 0; Index < LoadedSources.size(); ++Index)
    {
        const ForceFieldWorkspaceSource& WorkspaceSource = State.Sources[Index];
        const ForceSourceRecord* Record = LoadedSources[Index];
        const ForceSourceConfiguration& Native = Record->QueryConfiguration();
        Confirm(Native.Category == ExpectedCategories[Index], "A workspace source mapped to the wrong native ForceSource category");
        Confirm(Native.Enabled == WorkspaceSource.Enabled, "A native ForceSource enabled switch did not round-trip");
        Confirm(Native.Reach == static_cast<ForceReach>(WorkspaceSource.Reach + 1), "A native ForceSource reach did not round-trip");
        static constexpr ForceFalloff NativeFalloffs[] = {
            ForceFalloff::Smooth, ForceFalloff::Linear, ForceFalloff::InverseSquare, ForceFalloff::None,
        };
        Confirm(Native.Falloff == NativeFalloffs[WorkspaceSource.Falloff], "A native ForceSource falloff did not round-trip");
        Confirm(Record->QueryEnclosureToken() == FieldRecord->QueryToken(), "A ForceSource is not parented under the native ForceField");
        Confirm(Record->QueryRecordName() == WorkspaceSource.Name, "A native ForceSource display name did not round-trip");
        ConfirmNear(Native.CentreMetres[0], WorkspaceSource.Centre[0], "A ForceSource east coordinate did not round-trip");
        ConfirmNear(Native.CentreMetres[1], WorkspaceSource.Centre[2], "A ForceSource north coordinate did not round-trip");
        ConfirmNear(Native.CentreMetres[2], WorkspaceSource.Centre[1], "A ForceSource altitude coordinate did not round-trip");
        const SpatialVector FieldCentre = ConvertSceneToFieldAxes(Native.CentreMetres);
        ConfirmNear(FieldCentre.X, WorkspaceSource.Centre[0], "Native field X did not preserve workspace east");
        ConfirmNear(FieldCentre.Y, WorkspaceSource.Centre[1], "Native field Y did not preserve workspace altitude");
        ConfirmNear(FieldCentre.Z, -WorkspaceSource.Centre[2], "Native field Z must be south-positive (the inverse of workspace north)");
        ConfirmNear(Native.ReachMetres, WorkspaceSource.Radius, "A native ForceSource influence radius did not round-trip");
        Confirm(Native.Activation == (WorkspaceSource.Activation == ForceFieldActivationWindow ? ForceActivation::Window
                                  : WorkspaceSource.Activation == ForceFieldActivationTrigger ? ForceActivation::Trigger
                                                                                            : ForceActivation::Always),
                "A native ForceSource activation mode did not round-trip");
        ConfirmNear(Native.BeginsSeconds, WorkspaceSource.Begins, "A native ForceSource window start did not round-trip");
        ConfirmNear(Native.LastsSeconds, WorkspaceSource.Lasts, "A native ForceSource duration did not round-trip");
        ConfirmNear(Native.RepeatsSeconds, WorkspaceSource.Repeats, "A native ForceSource repeat interval did not round-trip");
        ConfirmNear(Native.RampInSeconds, WorkspaceSource.RampIn, "A native ForceSource ramp-in did not round-trip");
        ConfirmNear(Native.RampOutSeconds, WorkspaceSource.RampOut, "A native ForceSource ramp-out did not round-trip");
        uint32_t ExpectedActsOn = 0;
        for (int Receiver = 0; Receiver < 7; ++Receiver)
            if (WorkspaceSource.Acts[Receiver]) ExpectedActsOn |= (1u << static_cast<uint32_t>(Receiver));
        Confirm(Native.ActsOn == ExpectedActsOn, "A native ForceSource receiver mask did not round-trip");

        const ForceSourceDescriptor& Descriptor = ResolveForceSourceDescriptor(ExpectedCategories[Index]);
        const int ParametersToCheck = std::min<int>(WorkspaceSource.Type >= 0 ? QueryForceFieldType(WorkspaceSource.Type).ParamCount : 0,
                                                    static_cast<int>(Descriptor.Parameters.size()));
        for (int Parameter = 0; Parameter < ParametersToCheck; ++Parameter)
        {
            const ForceParameterDescriptor& NativeParameter = Descriptor.Parameters[static_cast<size_t>(Parameter)];
            ConfirmNear(Native.*(NativeParameter.Member), WorkspaceSource.Params[Parameter],
                        "A workspace parameter did not map to its native ForceSource field");
        }
        if (ExpectedCategories[Index] == ForceSourceCategory::Current && Index == 0)
        {
            Confirm(Native.LocalizedWindGenerator, "Wind Generator did not remain a localized native Current source");
            ConfirmNear(Native.GeneratorGustStrength, WorkspaceSource.Params[1], "Localized generator gust strength did not round-trip");
            ConfirmNear(Native.GeneratorGustFrequencyHz, WorkspaceSource.Params[2], "Localized generator gust frequency did not round-trip");
            ConfirmNear(Native.GeneratorTurbulence, WorkspaceSource.Params[3], "Localized generator turbulence did not round-trip");
            ConfirmNear(Native.GeneratorTurbulenceScaleMetres, WorkspaceSource.Params[4], "Localized generator turbulence scale did not round-trip");
        }
        if (WorkspaceSource.Reach != ForceFieldReachSphere)
            ConfirmNear(Native.HeightMetres, WorkspaceSource.Height, "A native column/box source height did not round-trip");
        if (WorkspaceSource.Reach == ForceFieldReachBox && Native.Category != ForceSourceCategory::JetCorridor &&
            Native.Category != ForceSourceCategory::VehicleWake)
        {
            ConfirmNear(Native.HalfExtentsMetres[0], WorkspaceSource.HalfX, "Native box half-width did not round-trip");
            ConfirmNear(Native.HalfExtentsMetres[1], WorkspaceSource.HalfZ, "Native box half-length did not round-trip");
        }
        if (Descriptor.Spin) ConfirmNear(Native.Spin, WorkspaceSource.Spin, "Native source spin direction did not round-trip");
        for (const ForceBearingDescriptor& Bearing : Descriptor.Bearings)
        {
            const double ExpectedBearing = std::string(Bearing.Identifier) == "track_bearing_deg"
                                               ? WorkspaceSource.TrackBearing
                                               : WorkspaceSource.Bearing;
            ConfirmNear(Native.*(Bearing.Member), ExpectedBearing, "A native source bearing did not round-trip");
        }
    }

    const auto InvalidExtension = Destination.parent_path() / "ForceFieldWorkspaceValidation.invalid";
    Confirm(!ExportForceFieldWorkspaceLevelSpace(State, InvalidExtension, &Diagnostic),
            "Native Levelspace export accepted a non-.levelspace destination");
}

} // namespace

int main(int ArgumentCount, char** Arguments)
{
    using namespace Frontier;
    try
    {
        ImGui::CreateContext();
        ImGui::StyleColorsDark();
        ImGuiIO& IO = ImGui::GetIO();
        IO.DisplaySize = ImVec2(1560.0f, 1900.0f);
        IO.DeltaTime = 1.0f / 60.0f;

        // Production typefaces (DM Sans + the JetBrains Mono symbol fallback) so evidence matches the app and the
        // ω/∇ labels rasterize; argv[2] is the font-archive root, defaulting to the in-tree EngineContent path.
        TypefaceRegistry   FontRegistry;
        static const char* WantedFonts[] = { "DM Sans", "JetBrains Mono" };
        const char*        ArchiveRoot   = ArgumentCount >= 3 ? Arguments[2] : "EngineContent/FontArchives";
        const uint32_t     FontFamilies  = FontRegistry.Load(ArchiveRoot, WantedFonts, 2);
        if (ArgumentCount >= 3) Confirm(FontFamilies == 2, "The font archive root did not yield DM Sans and JetBrains Mono");
        if (FontFamilies == 0) IO.Fonts->AddFontDefault();
        else TypefaceRegistry::Install(&FontRegistry);
        IO.Fonts->Build();

        std::filesystem::path EvidenceStem = ArgumentCount >= 2
                                                 ? std::filesystem::path(Arguments[1])
                                                 : std::filesystem::path("ForceFieldWorkspaceValidation");
        EvidenceStem.replace_extension();
        const std::filesystem::path RoundTripPath = EvidenceStem.string() + "-roundtrip.levelspace";
        const std::filesystem::path UiExportPath = EvidenceStem.string() + "-ui.levelspace";
        ValidateNativeEvaluator();
        ValidateNativeLevelspaceRoundTrip(RoundTripPath);

        const EditorTypefaces Faces = EditorTypefaces::Resolve();
        ForceFieldWorkspaceState State{};
        ConstructForceFieldWorkspaceState(State);
        AssetBrowserLink Link{};

        const auto Frame = [&]()
        {
            ImGui::NewFrame();
            ConstructForceFieldWorkspace(State, Faces, IO.DisplaySize, &Link);
            ImGui::Render();
        };
        const auto Rect = [&](const char* Name, ImVec2& Min, ImVec2& Max)
        {
            char Missing[128]{};
            std::snprintf(Missing, sizeof(Missing), "Missing validation rect %s", Name);
            Confirm(QueryForceFieldWorkspaceRect(State, Name, Min, Max), Missing);
            Confirm(Max.x > Min.x && Max.y > Min.y, Missing);
        };
        const auto RectCentre = [&](const char* Name)
        {
            ImVec2 Min{}, Max{};
            Rect(Name, Min, Max);
            return ImVec2(0.5f * (Min.x + Max.x), 0.5f * (Min.y + Max.y));
        };
        const auto ClickAt = [&](const char* Name, float XShare, float YShare)
        {
            ImVec2 Min{}, Max{};
            Rect(Name, Min, Max);
            const ImVec2 At(Min.x + (Max.x - Min.x) * XShare, Min.y + (Max.y - Min.y) * YShare);
            IO.AddMousePosEvent(At.x, At.y);
            Frame();
            IO.AddMouseButtonEvent(ImGuiMouseButton_Left, true);
            Frame();
            IO.AddMouseButtonEvent(ImGuiMouseButton_Left, false);
            Frame();
            Frame();
        };
        const auto Click = [&](const char* Name) { ClickAt(Name, 0.5f, 0.5f); };
        const auto Drag = [&](const char* Name, float DeltaX, float DeltaY)
        {
            const ImVec2 At = RectCentre(Name);
            IO.AddMousePosEvent(At.x, At.y);
            Frame();
            IO.AddMouseButtonEvent(ImGuiMouseButton_Left, true);
            Frame();
            IO.AddMousePosEvent(At.x + DeltaX, At.y + DeltaY);
            Frame();
            IO.AddMouseButtonEvent(ImGuiMouseButton_Left, false);
            Frame();
            Frame();
        };

        // 1. Boot: the lab scene selects its first source and the native evaluator is ready.
        Frame();
        Frame();
        Confirm(State.Selected == 0, "The workspace did not boot on the first lab source");
        Confirm(!State.Log.empty(), "The boot produced no log lines");
        Confirm(State.Log.front().Channel == "WORKSPACE", "The boot line missed its WORKSPACE channel");
        Confirm(static_cast<int>(State.Sources.size()) == 6, "The lab scene lost sources");
        RectCentre("Outliner/Field");
        RectCentre("Outliner/Wind");
        RectCentre("Outliner/Source0");
        RectCentre("Outliner/Source5");
        RectCentre("Inspector/Section/place");
        RectCentre("Inspector/Section/strength");
        RectCentre("Inspector/Section/timing");
        RectCentre("Inspector/Name");
        RectCentre("Inspector/Param0");
        RectCentre("Inspector/SourceAction0");
        RectCentre("Inspector/SourceAction1");
        RectCentre("Inspector/SourceAction2");
        RectCentre("Footer/Log");
        RectCentre("Surface/Map");
        RectCentre("Timeline/Play");
        RectCentre("Minimap");

        // 2. Source Inspector editing, framing, duplication, and removal are real state changes.
        Click("Inspector/Name");
        Click("Inspector/Name"); // Focus the inline input after its first-frame construction.
        IO.AddInputCharactersUTF8("Edited Wind Generator");
        Frame();
        IO.AddKeyEvent(ImGuiKey_Enter, true);
        Frame();
        IO.AddKeyEvent(ImGuiKey_Enter, false);
        Frame();
        Confirm(State.Sources[0].Name != "Wind Generator East" &&
                    State.Sources[0].Name.find("Edited Wind Generator") != std::string::npos,
                "The source name field did not commit edited text");
        const double OriginalStrength = State.Sources[0].Params[0];
        Click("Inspector/Param0");
        Confirm(State.Sources[0].Params[0] > OriginalStrength, "The source strength slider did not edit the native-backed value");
        State.View.Follow = 0;
        Click("Inspector/SourceAction0");
        Confirm(State.View.Follow == -1, "Frame did not stop source follow");
        ConfirmNear(State.View.CentreX, State.Sources[0].Centre[0], "Frame did not centre the view on the source");
        ConfirmNear(State.View.CentreZ, -State.Sources[0].Centre[2], "Frame did not convert workspace north into native field Z");
        Click("Inspector/SourceAction1");
        Confirm(State.Sources.size() == 7 && State.Selected == 6, "The Inspector Duplicate action did not add/select a source");
        Confirm(State.Sources[6].Name != State.Sources[0].Name && State.Sources[6].Name.find("Copy") != std::string::npos,
                "The Inspector Duplicate action did not make its name unique");
        Click("Inspector/SourceAction2");
        Confirm(State.Sources.size() == 6, "The Inspector Remove action did not restore the source count");
        Click("Outliner/Source0");
        Confirm(State.Selected == 0, "The outliner did not reselect the edited source");

        // 3. Outliner selection swaps Inspector pages (wind, then master workspace).
        Click("Outliner/Wind");
        Confirm(State.Selected == ForceFieldWorkspaceState::SelectedWind, "Clicking Ambient Wind did not select it");
        RectCentre("Inspector/Section/wflow");
        RectCentre("Inspector/Section/wgst");
        {
            ImVec2 Min{}, Max{};
            Confirm(!QueryForceFieldWorkspaceRect(State, "Inspector/Name", Min, Max), "The wind page kept the source name field");
        }
        Click("Outliner/Field");
        Confirm(State.Selected == ForceFieldWorkspaceState::SelectedField, "Clicking the master workspace did not select it");
        RectCentre("Inspector/Section/declutter");
        RectCentre("Inspector/Section/receivers");
        RectCentre("Inspector/Section/lvl");

        // 4. Section heads fold and unfold their cards.
        Confirm(State.CardDeclutter, "The declutter card did not start open");
        Click("Inspector/Section/declutter");
        Confirm(!State.CardDeclutter, "Clicking the section head did not fold the card");
        Click("Inspector/Section/declutter");
        Confirm(State.CardDeclutter, "Clicking the section head did not unfold the card");

        // 5. Placement is armed in the toolbar and a map click creates a native-backed Wind Generator.
        const size_t SourcesBeforePlacement = State.Sources.size();
        Click("Toolbar/Place0");
        Confirm(State.PlacementType == 0, "The Wind Generator pill did not arm placement");
        Confirm(!State.Log.empty() && State.Log.front().Channel == "PLACE", "Arming placement logged no PLACE line");
        ClickAt("Surface/Map", 0.08f, 0.85f);
        Confirm(State.PlacementType == -1, "Dropping a source did not disarm placement");
        Confirm(State.Sources.size() == SourcesBeforePlacement + 1, "Dropping on the map did not add a source");
        Confirm(State.Sources.back().Type == 0 && State.Selected == static_cast<int>(State.Sources.size()) - 1,
                "Map placement did not create and select the armed source type");
        Confirm(State.Log.front().Channel == "PLACE", "Map placement did not log its native source creation");

        // 6. The log drawer opens, clears locally, and closes.
        Click("Footer/Log");
        Confirm(State.LogOpen, "The log pill did not open the drawer");
        RectCentre("Log/Clear");
        Confirm(!State.Log.empty(), "The log lost its lines before Clear");
        Click("Log/Clear");
        Confirm(State.Log.empty(), "Clear did not empty the workspace log");
        Click("Footer/Log");
        Confirm(!State.LogOpen, "The log pill did not close the drawer");

        // 7. View modes swap the centre surface; the stage records its own surface.
        Click("Toolbar/Mode1");
        Confirm(State.ViewMode == 1, "The 3D Stage pill did not switch view modes");
        RectCentre("Surface/Stage3D");
        Click("Toolbar/Mode0");
        Confirm(State.ViewMode == 0, "The Map pill did not switch back to Map 2D");

        // 8. The play switch, source eye, and HUD vectors toggle retain editable state.
        const bool WasPlaying = State.ClockPlaying;
        Click("Timeline/Play");
        Confirm(State.ClockPlaying != WasPlaying, "The play switch did not flip");
        const bool ImpulseWas = State.Sources[5].Enabled;
        Click("Outliner/Source5/Eye");
        Confirm(State.Sources[5].Enabled != ImpulseWas, "The outliner eye did not flip the source");
        const bool ArrowsWere = State.View.Arrows;
        Click("Hud/Pill0");
        Confirm(State.View.Arrows != ArrowsWere, "The HUD Vectors pill did not flip");

        // 9. Timeline FIRE starts a real trigger envelope on the selected source.
        State.Sources[5].Activation = ForceFieldActivationTrigger;
        State.Sources[5].TriggeredAt = -1.0;
        Frame();
        RectCentre("Timeline/Fire0");
        Click("Timeline/Fire0");
        Confirm(State.Sources[5].Activation == ForceFieldActivationTrigger && State.Sources[5].TriggeredAt >= 0.0,
                "Timeline FIRE did not fire the source trigger");
        Confirm(State.ClockPlaying, "Firing a timeline source did not start the clock");
        Confirm(!State.Log.empty() && State.Log.front().Channel == "TRIGGER", "Timeline FIRE did not create a trigger log entry");
        State.Sources[5].Activation = ForceFieldActivationWindow;
        Frame();

        // 10. The library handoff arms a real type; banner cancel disarms it.
        Click("Toolbar/All17");
        Confirm(State.LibraryOpen, "The All 17 pill did not open the library");
        RectCentre("Library/Browse");
        RectCentre("Library/Close");
        Click("Library/Browse");
        Confirm(!State.LibraryOpen, "The browse row did not close the library");
        Confirm(Link.OpenRequested, "The browse row did not request the browser");
        Confirm(Link.OpenWorkspace == AssetBrowserWorkspaceForceField, "The browse row requested the wrong workspace");
        Link.OpenRequested = false;
        Link.OpenWorkspace = -1;
        std::snprintf(Link.OpenRecordId, sizeof(Link.OpenRecordId), "forcefield/Attractor");
        Link.OpenRecordWorkspace = AssetBrowserWorkspaceForceField;
        Frame();
        Frame();
        Confirm(!Link.HasHandoff(), "The shell did not consume the handoff");
        Confirm(State.PlacementType == QueryForceFieldTypeById("Attractor"), "The handoff did not arm placement");
        RectCentre("Banner/Cancel");
        Click("Banner/Cancel");
        Confirm(State.PlacementType == -1, "The banner cancel did not disarm placement");

        // 11. All presets work, including the genuinely empty blank/build state.
        Click("Top/Scenario1");
        Confirm(State.Scenario == 1 && State.Sources.size() == 4 && State.Wind.Enabled,
                "The dual wind corridor preset did not load its sources and ambient wind");
        Click("Top/Scenario2");
        Confirm(State.Scenario == 2 && State.Sources.size() == 14 && State.Wind.Enabled,
                "The storm preset did not load its source ring and ambient wind");
        Click("Top/Scenario3");
        Confirm(State.Scenario == 3 && State.Sources.empty() && !State.Wind.Enabled &&
                    State.Selected == ForceFieldWorkspaceState::SelectedField,
                "Blank · Build did not clear all sources and ambient wind");
        const double PanXBefore = State.View.CentreX;
        const double PanZBefore = State.View.CentreZ;
        Drag("Surface/Map", 54.0f, 24.0f);
        Confirm(std::abs(State.View.CentreX - PanXBefore) + std::abs(State.View.CentreZ - PanZBefore) > 0.1,
                "Dragging an empty map did not pan the field view");
        Click("Top/Scenario0");
        Confirm(State.Scenario == 0 && State.Sources.size() == 6, "Returning to the lab preset did not restore its six sources");

        // 12. Native export is available from the Inspector; the exported file is parsed by WorldSpace::LoadLevelSpace.
        Click("Outliner/Field");
        State.CardDeclutter = false;
        State.CardReceivers = false;
        State.CardLevel = false;
        State.ExportPath = UiExportPath.string();
        Frame();
        Click("Inspector/Section/lvl");
        Confirm(State.CardLevel, "The native Levelspace section did not open");
        RectCentre("Inspector/LevelAction0");
        Click("Inspector/LevelAction0");
        Confirm(!State.ExportPreview.empty() && State.ExportPreview.find("localized_wind_generator") != std::string::npos,
                "The Inspector did not preview its exported native Levelspace");
        Confirm(State.ExportStatus.find("Exported native ForceField") != std::string::npos,
                "The Inspector did not report a successful native export");
        WorldSpace UiLoaded;
        std::string UiDiagnostic;
        Confirm(UiLoaded.LoadLevelSpace(UiExportPath, &UiDiagnostic),
                UiDiagnostic.empty() ? "Inspector-exported Levelspace did not load natively" : UiDiagnostic.c_str());
        Confirm(UiLoaded.FindAll<ForceSourceRecord>().size() == State.Sources.size(),
                "Inspector export omitted authored ForceSource records");
        ForceSourceRecord* ExportedGenerator = nullptr;
        for (ForceSourceRecord* Record : UiLoaded.FindAll<ForceSourceRecord>())
            if (Record->QueryConfiguration().LocalizedWindGenerator) ExportedGenerator = Record;
        Confirm(ExportedGenerator != nullptr, "Inspector export/load lost localized Wind Generator configuration");
        Click("Inspector/LevelAction1");
        Confirm(State.ExportPath == UiExportPath.string(), "Preset reset did not retain the export destination");
        Confirm(State.ExportPreview.empty(), "Preset reset retained stale Levelspace preview text");
        Confirm(State.Sources.size() == 6, "Inspector preset reset did not restore the selected preset");

        // 13. Evidence: one live frame per Inspector page (source, wind, master workspace).
        const auto RenderEvidence = [&](const char* Path)
        {
            IO.AddMousePosEvent(-1.0f, -1.0f);
            Frame();
            FrontierExhibit::AcknowledgeTextures();
            const int Width  = static_cast<int>(IO.DisplaySize.x * IO.DisplayFramebufferScale.x);
            const int Height = static_cast<int>(IO.DisplaySize.y * IO.DisplayFramebufferScale.y);
            std::vector<unsigned char> Pixels(static_cast<size_t>(Width) * Height * 3, 0x18);
            const ImDrawData* DrawData = ImGui::GetDrawData();
            for (const ImDrawList* DrawList : DrawData->CmdLists)
                FrontierExhibit::RasterizeCommands(DrawList, Pixels.data(), Width, Height, DrawData->DisplayPos,
                                                   DrawData->FramebufferScale);
            std::ofstream Image(Path, std::ios::binary);
            Image << "P6\n" << Width << ' ' << Height << "\n255\n";
            Image.write(reinterpret_cast<const char*>(Pixels.data()), static_cast<std::streamsize>(Pixels.size()));
            if (!Image) throw std::runtime_error("Could not write ForceField workspace PPM evidence");
        };
        if (ArgumentCount >= 2)
        {
            Click("Outliner/Source0");
            Confirm(State.Selected == 0, "Reselecting the first source failed");
            RenderEvidence((EvidenceStem.string() + "-source.ppm").c_str());
            Click("Outliner/Wind");
            RenderEvidence((EvidenceStem.string() + "-wind.ppm").c_str());
            Click("Outliner/Field");
            RenderEvidence((EvidenceStem.string() + "-field.ppm").c_str());
        }

        std::fprintf(stdout, "ForceFieldWorkspaceValidation: native evaluator, 17-source Levelspace round-trip, editing, placement, navigation, presets, timeline, export, and evidence checks passed\n");
        ImGui::DestroyContext();
        return 0;
    }
    catch (const std::exception& Failure)
    {
        ImGui::DestroyContext();
        std::fprintf(stderr, "ForceFieldWorkspaceValidation: %s\n", Failure.what());
        return 1;
    }
}
