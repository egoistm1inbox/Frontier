/*==========================================================================================================================================
                                                    FORCEFIELDWORKSPACERUNTIME.CPP
==========================================================================================================================================*/
// 🧩 Adapt the editable workspace catalogue to the native ForceFieldSpace evaluator. Lattice sampling owns an immutable
//    snapshot, so UI edits never race the visualizer's sampling worker.

#include "Engine/Interface/Workspaces/ForceFieldWorkspaceRuntime.h"

#include "Engine/PhysicalDynamics/AtmosphericFlow.h"
#include "Engine/PhysicalDynamics/ForceSourceCatalogue.h"
#include "Frontier/Engine/Scene/EngineConfigurations.h"
#include "Frontier/Engine/Scene/WorldSpace.h"

#include <algorithm>
#include <bit>
#include <cmath>
#include <cstring>
#include <string>
#include <vector>

namespace Frontier
{

namespace
{

uint64_t HashMix(uint64_t Hash, uint64_t Value) noexcept
{
    Value ^= Value >> 30;
    Value *= 0xbf58476d1ce4e5b9ULL;
    Value ^= Value >> 27;
    Value *= 0x94d049bb133111ebULL;
    Value ^= Value >> 31;
    Hash ^= Value + 0x9e3779b97f4a7c15ULL + (Hash << 6) + (Hash >> 2);
    return Hash;
}

uint64_t HashDouble(uint64_t Hash, double Value) noexcept
{
    if (!std::isfinite(Value)) Value = 0.0;
    return HashMix(Hash, std::bit_cast<uint64_t>(Value));
}

uint64_t HashText(uint64_t Hash, const std::string& Text) noexcept
{
    for (unsigned char Byte : Text) Hash = HashMix(Hash, Byte);
    return HashMix(Hash, Text.size());
}

ForceContribution NativeContribution(int Contribution) noexcept
{
    if (Contribution == ForceFieldContributionAccelerate) return ForceContribution::Accelerate;
    if (Contribution == ForceFieldContributionDamp) return ForceContribution::Damp;
    return ForceContribution::Flow;
}

ForceFieldQuantity NativeQuantity(int Quantity) noexcept
{
    // The workspace's four choices are deliberately mapped instead of cast: the native enum has six values.
    switch (Quantity)
    {
    case 1: return ForceFieldQuantity::Vertical;
    case 2: return ForceFieldQuantity::Vorticity;
    case 3: return ForceFieldQuantity::Divergence;
    default: return ForceFieldQuantity::Speed;
    }
}

ForceSourceCategory NativeCategory(const char* Id) noexcept
{
    if (Id == nullptr) return ForceSourceCategory::Current;
    if (std::strcmp(Id, "Tornado") == 0) return ForceSourceCategory::TornadoColumn;
    if (std::strcmp(Id, "Jet") == 0) return ForceSourceCategory::JetCorridor;
    if (std::strcmp(Id, "GustFront") == 0) return ForceSourceCategory::GustFront;
    if (std::strcmp(Id, "Microburst") == 0) return ForceSourceCategory::Microburst;
    if (std::strcmp(Id, "Thermal") == 0) return ForceSourceCategory::ThermalUpdraft;
    if (std::strcmp(Id, "Puff") == 0) return ForceSourceCategory::GustPuff;
    if (std::strcmp(Id, "Blast") == 0) return ForceSourceCategory::BlastWave;
    if (std::strcmp(Id, "Wake") == 0) return ForceSourceCategory::VehicleWake;
    if (std::strcmp(Id, "Current") == 0) return ForceSourceCategory::Current;
    if (std::strcmp(Id, "Attractor") == 0) return ForceSourceCategory::Attractor;
    if (std::strcmp(Id, "Repulsor") == 0) return ForceSourceCategory::Repulsor;
    if (std::strcmp(Id, "Orbit") == 0) return ForceSourceCategory::Orbit;
    if (std::strcmp(Id, "Lift") == 0) return ForceSourceCategory::Lift;
    if (std::strcmp(Id, "Magnetic") == 0) return ForceSourceCategory::MagneticDipole;
    if (std::strcmp(Id, "Gravity") == 0) return ForceSourceCategory::Gravity;
    if (std::strcmp(Id, "Drag") == 0) return ForceSourceCategory::DragVolume;
    return ForceSourceCategory::Current;
}

ForceReach NativeReach(int Reach) noexcept
{
    if (Reach == ForceFieldReachColumn) return ForceReach::Column;
    if (Reach == ForceFieldReachBox) return ForceReach::Box;
    return ForceReach::Sphere;
}

ForceFalloff NativeFalloff(int Falloff) noexcept
{
    if (Falloff == ForceFieldFalloffLinear) return ForceFalloff::Linear;
    if (Falloff == ForceFieldFalloffInverseSquare) return ForceFalloff::InverseSquare;
    if (Falloff == ForceFieldFalloffNone) return ForceFalloff::None;
    return ForceFalloff::Smooth;
}

ForceActivation NativeActivation(int Activation) noexcept
{
    if (Activation == ForceFieldActivationWindow) return ForceActivation::Window;
    if (Activation == ForceFieldActivationTrigger) return ForceActivation::Trigger;
    return ForceActivation::Always;
}

bool IsWindGenerator(const ForceFieldWorkspaceSource& Source) noexcept
{
    const ForceFieldWorkspaceType& Type = QueryForceFieldType(Source.Type);
    return Type.Id != nullptr && std::strcmp(Type.Id, "WindGenerator") == 0;
}

ForceSourceConfiguration ConvertSource(const ForceFieldWorkspaceSource& Source)
{
    const ForceFieldWorkspaceType& Type = QueryForceFieldType(Source.Type);
    const ForceSourceCategory Category = NativeCategory(Type.Id);
    ForceSourceConfiguration Native = ConstructForceSource(Category);

    Native.Enabled = Source.Enabled;
    Native.CentreMetres[0] = Source.Centre[0];
    Native.CentreMetres[1] = Source.Centre[2];
    Native.CentreMetres[2] = Source.Centre[1];
    Native.Reach = NativeReach(Source.Reach);
    Native.ReachMetres = std::max(0.1, Source.Radius);
    Native.HeightMetres = std::max(0.1, Source.Height);
    Native.HalfExtentsMetres[0] = std::max(0.1, Source.HalfX);
    Native.HalfExtentsMetres[1] = std::max(0.1, Source.HalfZ);
    Native.Falloff = NativeFalloff(Source.Falloff);
    Native.Activation = NativeActivation(Source.Activation);
    Native.BeginsSeconds = std::max(0.0, Source.Begins);
    Native.LastsSeconds = std::max(0.0, Source.Lasts);
    Native.RepeatsSeconds = std::max(0.0, Source.Repeats);
    Native.RampInSeconds = std::max(0.0, Source.RampIn);
    Native.RampOutSeconds = std::max(0.0, Source.RampOut);
    Native.TriggeredAtSeconds = Source.TriggeredAt;
    Native.BearingDegrees = Source.Bearing;
    Native.TrackBearingDegrees = Source.TrackBearing;
    Native.Spin = Source.Spin < 0 ? -1.0 : 1.0;

    uint32_t ReceiverMask = 0;
    for (int Receiver = 0; Receiver < 7; ++Receiver)
    {
        if (Source.Acts[Receiver]) ReceiverMask |= (1u << static_cast<uint32_t>(Receiver));
    }
    Native.ActsOn = ReceiverMask;

    const ForceSourceDescriptor& Descriptor = ResolveForceSourceDescriptor(Category);
    const int ParameterCount = std::min<int>(Type.ParamCount, static_cast<int>(Descriptor.Parameters.size()));
    for (int Parameter = 0; Parameter < ParameterCount; ++Parameter)
    {
        const ForceParameterDescriptor& Spec = Descriptor.Parameters[static_cast<size_t>(Parameter)];
        if (Spec.Member != nullptr) Native.*(Spec.Member) = Source.Params[Parameter];
    }
    for (const ForceBearingDescriptor& Bearing : Descriptor.Bearings)
    {
        if (Bearing.Member == nullptr) continue;
        if (std::strcmp(Bearing.Identifier, "track_bearing_deg") == 0) Native.*(Bearing.Member) = Source.TrackBearing;
        else Native.*(Bearing.Member) = Source.Bearing;
    }
    if (IsWindGenerator(Source))
    {
        Native.LocalizedWindGenerator = true;
        Native.GeneratorGustStrength = std::clamp(Source.Params[1], 0.0, 1.5);
        Native.GeneratorGustFrequencyHz = std::clamp(Source.Params[2], 0.0, 2.0);
        Native.GeneratorTurbulence = std::clamp(Source.Params[3], 0.0, 1.5);
        Native.GeneratorTurbulenceScaleMetres = std::clamp(Source.Params[4], 1.0, 1000.0);
    }
    return Native;
}

ForceFieldConfiguration ConvertField(const ForceFieldWorkspaceState& State)
{
    ForceFieldConfiguration Native;
    Native.Enabled = State.FieldEnabled;
    Native.Visualize = true;
    Native.IncludeTurbulence = true;
    Native.CentreMetres[0] = 0.0f;
    Native.CentreMetres[1] = 0.0f;
    Native.CentreMetres[2] = 0.0f;
    Native.HalfExtentsMetres[0] = 1000.0f;
    Native.HalfExtentsMetres[1] = 1000.0f;
    Native.HalfExtentsMetres[2] = 1000.0f;
    Native.Cascades = 4;
    Native.FinestCellMetres = 2.0f;
    Native.CellsPerSide = 128;
    Native.VerticalCells = 32;
    Native.ExtentMetres = 100000.0f;
    Native.Receivers = 0;
    for (int Receiver = 0; Receiver < 7; ++Receiver)
        if (State.FieldChannels[Receiver]) Native.Receivers |= (1u << static_cast<uint32_t>(Receiver));
    Native.ViewContribution = NativeContribution(State.View.Contribution);
    Native.Quantity = NativeQuantity(State.View.Quantity);
    Native.Projection = State.ViewMode == 0 ? ForceFieldProjection::Map : ForceFieldProjection::Oblique;
    Native.AutomaticScale = true;
    Native.FixedScale = 20.0f;
    Native.Heatmap = State.View.Heatmap;
    Native.SmoothHeatmap = true;
    Native.Arrows = State.View.Arrows;
    Native.Tracers = false;
    Native.ShowCascades = State.View.Cascades;
    Native.Labels = !State.View.MinimalLabels;
    Native.SliceHeightMetres = static_cast<float>(State.View.SliceHeight);
    Native.HeatmapOpacity = 0.78f;
    Native.ArrowSpacingPixels = static_cast<float>(State.View.ArrowSpacing);
    Native.TracerCount = 0;
    Native.CellPixels = 8.0f;
    Native.TimelineDurationSeconds = static_cast<float>(std::clamp(State.TimelineDuration, 5.0, 3600.0));
    Native.TimelineRate = static_cast<float>(State.ClockRate);
    Native.TimelinePlaying = State.ClockPlaying;
    Native.TimelineSeconds = State.ClockTime;
    return Native;
}

WindConfiguration ConvertWind(const ForceFieldWorkspaceState::WindState& State)
{
    WindConfiguration Native;
    Native.Enabled = State.Enabled;
    Native.DirectionDegrees = static_cast<float>(State.Bearing);
    Native.SpeedMetresPerSecond = static_cast<float>(std::clamp(State.Speed, 0.0, 40.0));
    Native.GustAmplitude = static_cast<float>(std::max(0.0, State.GustAmplitude));
    Native.CurlNoiseTurbulence = static_cast<float>(std::clamp(State.Turbulence, 0.0, 1.0));
    Native.CurlFrequencyHz = static_cast<float>(std::clamp(State.GustFrequency, 0.01, 2.0));
    Native.GustFrequencyHz = static_cast<float>(std::clamp(State.GustFrequency, 0.01, 2.0));
    Native.TurbulenceScaleMetres = static_cast<float>(std::clamp(State.TurbulenceScale, 1.0, 1000.0));
    Native.GustStrength = static_cast<float>(std::clamp(State.GustStrength, 0.0, 1.0));
    Native.ShearPerKilometre = static_cast<float>(std::clamp(State.Shear, 0.0, 2.0));
    Native.VeerDegreesPerKilometre = static_cast<float>(State.Veer);
    Native.MesoscaleScaleMetres = static_cast<float>(std::clamp(State.MesoscaleScale, 0.0, 200000.0));
    Native.MesoscaleStrength = static_cast<float>(std::clamp(State.MesoscaleStrength, 0.0, 1.0));
    Native.Seed = State.Seed;
    Native.GroundHeightMetres = 0.0f;
    Native.Bounded = State.Bounded;
    Native.RegionRadiusMetres = static_cast<float>(std::clamp(State.RegionRadius, 100.0, 50000.0));
    return Native;
}

uint64_t StateSignature(const ForceFieldWorkspaceState& State) noexcept
{
    uint64_t Hash = 0xF08CE11DULL;
    auto Add = [&](double Value) { Hash = HashDouble(Hash, Value); };
    auto Flag = [&](bool Value) { Hash = HashMix(Hash, Value ? 1u : 0u); };
    Hash = HashMix(Hash, static_cast<uint64_t>(State.Scenario));
    Flag(State.FieldEnabled);
    Flag(State.Wind.Enabled);
    Flag(State.Wind.Bounded);
    Add(State.Wind.RegionRadius);
    Add(State.Wind.Bearing);
    Add(State.Wind.Speed);
    Add(State.Wind.GustAmplitude);
    Add(State.Wind.GustStrength);
    Add(State.Wind.GustFrequency);
    Add(State.Wind.Turbulence);
    Add(State.Wind.TurbulenceScale);
    Add(State.Wind.Shear);
    Add(State.Wind.Veer);
    Add(State.Wind.MesoscaleStrength);
    Add(State.Wind.MesoscaleScale);
    Hash = HashMix(Hash, State.Wind.Seed);
    // 📝 The visualizer refreshes at 0.12 s; avoid invalidating its snapshot on every UI frame.
    Add(std::round(State.ClockTime / 0.12) * 0.12);
    Add(State.TimelineDuration);
    Hash = HashMix(Hash, static_cast<uint64_t>(State.ClockRate));
    Flag(State.ClockPlaying);
    Hash = HashMix(Hash, static_cast<uint64_t>(State.View.Contribution));
    Hash = HashMix(Hash, static_cast<uint64_t>(State.View.Quantity));
    Hash = HashMix(Hash, static_cast<uint64_t>(State.View.Solo + 3));
    Add(State.View.SliceHeight);
    for (bool Channel : State.FieldChannels) Flag(Channel);
    for (const ForceFieldWorkspaceSource& Source : State.Sources)
    {
        Hash = HashMix(Hash, static_cast<uint64_t>(Source.Type));
        Hash = HashText(Hash, Source.Name);
        Flag(Source.Enabled);
        for (double Centre : Source.Centre) Add(Centre);
        Hash = HashMix(Hash, static_cast<uint64_t>(Source.Reach));
        Add(Source.Radius);
        Add(Source.Height);
        Add(Source.HalfX);
        Add(Source.HalfZ);
        Hash = HashMix(Hash, static_cast<uint64_t>(Source.Falloff));
        Hash = HashMix(Hash, static_cast<uint64_t>(Source.Activation));
        Add(Source.Begins);
        Add(Source.Lasts);
        Add(Source.Repeats);
        Add(Source.RampIn);
        Add(Source.RampOut);
        Add(Source.TriggeredAt);
        Add(Source.Bearing);
        Add(Source.TrackBearing);
        Hash = HashMix(Hash, static_cast<uint64_t>(Source.Spin + 2));
        for (bool Receiver : Source.Acts) Flag(Receiver);
        for (double Parameter : Source.Params) Add(Parameter);
    }
    return Hash;
}

} // namespace

struct ForceFieldWorkspaceRuntime::Snapshot
{
    ForceFieldSpace NativeField;
    bool FieldEnabled = true;
};

SpatialVector ForceFieldWorkspaceRuntime::SampleImmutable(const Snapshot& Snapshot, ForceContribution Contribution,
                                                           SpatialVector Point, int32_t Solo) noexcept
{
    if (!Snapshot.FieldEnabled || !Snapshot.NativeField.QueryEnabled()) return {};
    return Snapshot.NativeField.EvaluateContribution(Contribution, Point, 0.0, true, Solo);
}

void ForceFieldWorkspaceRuntime::Synchronize(const ForceFieldWorkspaceState& State)
{
    ForceFieldConfiguration Controls = ConvertField(State);
    WindConfiguration Wind = ConvertWind(State.Wind);
    std::vector<ForceSourceConfiguration> Sources;
    Sources.reserve(State.Sources.size());
    for (const ForceFieldWorkspaceSource& Source : State.Sources) Sources.push_back(ConvertSource(Source));

    const uint64_t Signature = StateSignature(State);
    if (!Snapshot_ || Signature != Signature_)
    {
        auto Mutable = std::make_shared<Snapshot>();
        Mutable->FieldEnabled = State.FieldEnabled;
        ConfigureAtmosphericFlow(Mutable->NativeField, Controls, Wind, State.ClockTime, Sources);
        Snapshot_ = Mutable;
        Signature_ = Signature;
        if (++Revision_ == 0) ++Revision_;
        const std::shared_ptr<const Snapshot> Immutable = Snapshot_;
        const int32_t Solo = State.View.Solo;
        Visualization.ConfigureSampler(
            [Immutable, Solo](ForceContribution Contribution, SpatialVector Point)
            { return SampleImmutable(*Immutable, Contribution, Point, Solo); },
            Revision_);
        SamplerConfigured = true;
    }

    FieldVisualizationOptions& Options = Visualization.Options;
    Options.Contribution = NativeContribution(State.View.Contribution);
    Options.Quantity = NativeQuantity(State.View.Quantity);
    Options.AutomaticScale = true;
    Options.FixedScale = 20.0f;
    Options.Heatmap = State.View.Heatmap;
    Options.SmoothHeatmap = true;
    Options.Opacity = 0.78f;
    Options.Arrows = State.View.Arrows;
    Options.ArrowSpacing = static_cast<float>(std::clamp(State.View.ArrowSpacing, 16.0, 160.0));
    Options.Tracers = false;
    Options.TracerCount = 0;
    Options.Streamlines = State.View.FlowLines;
    Options.StreamlineSpacing = static_cast<float>(std::clamp(State.View.FlowLineSpacing, 16.0, 160.0));
    Options.StreamlineSteps = static_cast<uint32_t>(std::clamp(State.View.FlowLineLength, 6.0, 80.0));
    Options.StreamlinePulse = State.View.FlowLinePulse;
    Options.SliceHeight = State.View.SliceHeight;
    Options.CellPixels = 8.0f;
    Options.CameraCells = 48;
    Options.ShowScaleBar = true;
    Options.ShowLegend = true;
    Options.ShowSources = State.View.ShowInfluence;
    Options.ShowLabels = !State.View.MinimalLabels;
    Options.ShowCascades = State.View.Cascades;
    Options.ShowGroundGrid = true;
    Options.Cascades.clear();
    double Cell = 2.0;
    for (int Level = 0; Level < 4; ++Level)
    {
        Options.Cascades.push_back({Cell, Cell * 128.0, static_cast<uint32_t>(1u << Level)});
        Cell *= 8.0;
    }
    Options.CascadeFocus = {State.View.CentreX, State.View.CentreZ};
    Options.HasExtent = true;
    Options.Extent = {-50000.0, -50000.0, 50000.0, 50000.0};
    Options.ClipToExtent = false;
    Options.HasProbe = false;
    Options.Background = IM_COL32(5, 11, 18, 255);
    Options.RefreshSeconds = 0.12;
    Options.Animated = true;
    Options.Solo = State.View.Solo;
    Options.LegendTitle.clear();
    Options.MinimumSpan = 100.0;
    Options.MaximumSpan = 100000.0;

    FieldViewPlacement& Placement = Visualization.View;
    Placement.Mode = State.ViewMode == 0 ? FieldViewMode::Map : FieldViewMode::Oblique;
    Placement.CentreX = State.View.CentreX;
    Placement.CentreZ = State.View.CentreZ;
    Placement.Span = std::clamp(State.View.Span, Options.MinimumSpan, Options.MaximumSpan);
    Placement.Yaw = State.View.Yaw;
    Placement.Pitch = State.View.Pitch;

    if (Snapshot_)
    {
        std::vector<std::string> Names;
        Names.reserve(State.Sources.size());
        for (const ForceFieldWorkspaceSource& Source : State.Sources) Names.push_back(Source.Name);
        Options.Sources = ForceFieldVisualization::DescribeSources(Snapshot_->NativeField, Names, State.Selected,
                                                                    Options.Contribution, State.TimelineDuration);
    }
}

SpatialVector ForceFieldWorkspaceRuntime::Sample(ForceContribution Contribution, SpatialVector Point, int32_t Solo) const noexcept
{
    if (!Snapshot_) return {};
    return SampleImmutable(*Snapshot_, Contribution, Point, Solo);
}

std::vector<ForceSourceConfiguration> BuildForceFieldWorkspaceNativeSources(const ForceFieldWorkspaceState& State)
{
    std::vector<ForceSourceConfiguration> Sources;
    Sources.reserve(State.Sources.size());
    for (const ForceFieldWorkspaceSource& Source : State.Sources) Sources.push_back(ConvertSource(Source));
    return Sources;
}

bool ExportForceFieldWorkspaceLevelSpace(const ForceFieldWorkspaceState& State,
                                        const std::filesystem::path& Path,
                                        std::string* Diagnostic)
{
    if (Path.empty() || Path.extension() != WorldSpace::LevelSpaceExtension)
    {
        if (Diagnostic != nullptr) *Diagnostic = "Choose a destination ending in .levelspace.";
        return false;
    }

    WorldSpace Level;
    static constexpr const char* ScenarioNames[] = {"Wind + Vortex Lab", "Dual Wind Corridor", "Storm System", "Blank · Build"};
    const int Scenario = std::clamp(State.Scenario, 0, 3);
    Level.ConfigureWorldName(ScenarioNames[Scenario]);

    const RecordToken FieldToken = Level.ConstructRecord("ForceField", "Force Field");
    auto* FieldRecord = dynamic_cast<ForceFieldRecord*>(Level.FindRecord(FieldToken));
    if (FieldRecord == nullptr)
    {
        if (Diagnostic != nullptr) *Diagnostic = "The native ForceField record could not be constructed.";
        return false;
    }
    FieldRecord->AccessConfiguration() = ConvertField(State);

    const RecordToken WindToken = Level.ConstructRecord("Wind", "Wind", FieldToken);
    auto* WindRecordEntry = dynamic_cast<WindRecord*>(Level.FindRecord(WindToken));
    if (WindRecordEntry == nullptr)
    {
        if (Diagnostic != nullptr) *Diagnostic = "The native Wind record could not be constructed.";
        return false;
    }
    WindRecordEntry->AccessConfiguration() = ConvertWind(State.Wind);

    const std::vector<ForceSourceConfiguration> Sources = BuildForceFieldWorkspaceNativeSources(State);
    for (size_t Index = 0; Index < Sources.size(); ++Index)
    {
        const std::string Name = State.Sources[Index].Name.empty()
                                     ? std::string(QueryForceFieldType(State.Sources[Index].Type).Name)
                                     : State.Sources[Index].Name;
        const RecordToken SourceToken = Level.ConstructRecord("ForceSource", Name, FieldToken);
        auto* SourceRecord = dynamic_cast<ForceSourceRecord*>(Level.FindRecord(SourceToken));
        if (SourceRecord == nullptr)
        {
            if (Diagnostic != nullptr) *Diagnostic = "A native ForceSource record could not be constructed: " + Name;
            return false;
        }
        SourceRecord->AccessConfiguration() = Sources[Index];
    }

    return Level.SaveLevelSpace(Path, Diagnostic);
}

ForceFieldWorkspaceRuntime& EnsureForceFieldWorkspaceRuntime(ForceFieldWorkspaceState& State)
{
    if (!State.Runtime) State.Runtime = std::make_shared<ForceFieldWorkspaceRuntime>();
    return *State.Runtime;
}

void SynchronizeForceFieldWorkspaceRuntime(ForceFieldWorkspaceState& State)
{
    EnsureForceFieldWorkspaceRuntime(State).Synchronize(State);
}

SpatialVector EvaluateForceFieldWorkspaceSample(const ForceFieldWorkspaceState& State,
                                                 ForceContribution Contribution,
                                                 SpatialVector Point,
                                                 int32_t Solo) noexcept
{
    if (!State.Runtime) return {};
    return State.Runtime->Sample(Contribution, Point, Solo);
}

} // namespace Frontier
