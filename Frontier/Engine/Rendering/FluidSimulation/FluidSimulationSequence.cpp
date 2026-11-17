/*==========================================================================================================================================
                                                    FLUIDSIMULATIONSEQUENCE.CPP
==========================================================================================================================================*/
// 🧩 Vulkan/Slang fluid simulation: all Eulerian state evolution, advection, diffusion and pressure work is dispatched on the GPU.

#include "Frontier/Engine/Rendering/FluidSimulation/FluidSimulationSequence.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace Frontier
{
namespace
{

struct alignas(16) GpuFluidSource
{
    std::array<float, 4> PositionRadius{};
    std::array<float, 4> VelocitySmokeDelta{};
    std::array<float, 4> VaporTemperatureDelta{};
};
static_assert(sizeof(GpuFluidSource) == 48);
struct alignas(16) GpuFloat4
{
    float X = 0.0f;
    float Y = 0.0f;
    float Z = 0.0f;
    float W = 0.0f;
};
static_assert(sizeof(GpuFloat4) == 16);

[[nodiscard]] bool Finite(const Vec3d& Value) noexcept
{
    return std::isfinite(Value.X) && std::isfinite(Value.Y) && std::isfinite(Value.Z);
}

[[nodiscard]] float ToGpuFloat(double Value) noexcept
{
    if (!std::isfinite(Value)) return 0.0f;
    constexpr double Limit = 1.0e30;
    return static_cast<float>(std::clamp(Value, -Limit, Limit));
}

[[nodiscard]] GpuFloat4 Pack(const Vec3d& Value, double W = 0.0) noexcept
{
    return { ToGpuFloat(Value.X), ToGpuFloat(Value.Y), ToGpuFloat(Value.Z), ToGpuFloat(W) };
}

[[nodiscard]] uint32_t DispatchGroups(uint32_t Count, uint32_t Width = 4u) noexcept
{
    return (Count + Width - 1u) / Width;
}

[[nodiscard]] uint64_t CellCount(const FluidSpace& Space) noexcept
{
    return static_cast<uint64_t>(Space.QueryCellCountX()) * Space.QueryCellCountY() * Space.QueryCellCountZ();
}

[[nodiscard]] std::vector<GpuFloat4> PackState(const FluidSpace& Space)
{
    std::vector<GpuFloat4> Data;
    Data.reserve(Space.QueryCells().size());
    for (const FluidCell& Cell : Space.QueryCells())
        Data.push_back(Pack(Cell.AirVelocityMetresPerSecond, Cell.SmokeDensityKilogramsPerCubicMetre));
    return Data;
}

[[nodiscard]] std::vector<GpuFloat4> PackThermal(const FluidSpace& Space)
{
    std::vector<GpuFloat4> Data;
    Data.reserve(Space.QueryCells().size());
    for (const FluidCell& Cell : Space.QueryCells())
        Data.push_back({ ToGpuFloat(Cell.VaporDensityKilogramsPerCubicMetre), ToGpuFloat(Cell.TemperatureKelvin),
                         ToGpuFloat(Cell.PressurePotentialSquareMetresPerSecondSquared), 0.0f });
    return Data;
}

[[nodiscard]] bool ValidDescriptor(const FluidSpaceDescriptor& Descriptor) noexcept
{
    const FluidSpaceConfiguration& Configuration = Descriptor.Configuration;
    const Vec3d& Scale = Descriptor.Spatial.Scale;
    if (Configuration.CellCountX < 2 || Configuration.CellCountX > 128 ||
        Configuration.CellCountY < 2 || Configuration.CellCountY > 128 ||
        Configuration.CellCountZ < 2 || Configuration.CellCountZ > 128)
        return false;
    const uint64_t Count = static_cast<uint64_t>(Configuration.CellCountX) * Configuration.CellCountY * Configuration.CellCountZ;
    if (Count > 1048576) return false;
    return Configuration.PressureIterationCount >= 1 && Configuration.PressureIterationCount <= 128 &&
           std::isfinite(Configuration.CellSpanMetres) && Configuration.CellSpanMetres > 0.0 &&
           std::isfinite(Configuration.AmbientTemperatureKelvin) && Configuration.AmbientTemperatureKelvin > 0.0 &&
           std::isfinite(Configuration.BuoyancyAccelerationPerKelvin) && Configuration.BuoyancyAccelerationPerKelvin >= 0.0 &&
           std::isfinite(Configuration.SmokeDiffusivitySquareMetresPerSecond) &&
           Configuration.SmokeDiffusivitySquareMetresPerSecond >= 0.0 &&
           std::isfinite(Configuration.VaporDiffusivitySquareMetresPerSecond) &&
           Configuration.VaporDiffusivitySquareMetresPerSecond >= 0.0 &&
           Finite(Descriptor.Spatial.PositionMetres) && Finite(Descriptor.Spatial.OrientationDegrees) && Finite(Scale) &&
           Scale.X > 0.0 && Scale.Y > 0.0 && Scale.Z > 0.0 &&
           std::isfinite(Configuration.CellSpanMetres * Scale.X) && std::isfinite(Configuration.CellSpanMetres * Scale.Y) &&
           std::isfinite(Configuration.CellSpanMetres * Scale.Z) &&
           std::isfinite(Descriptor.Thermal.TemperatureKelvin) && Descriptor.Thermal.TemperatureKelvin > 0.0;
}

[[nodiscard]] bool ValidGpuData(const FluidSpace& Space) noexcept
{
    if (!ValidDescriptor(Space.QueryDescriptor()) || Space.QueryCells().size() != CellCount(Space)) return false;
    for (const FluidCell& Cell : Space.QueryCells())
    {
        if (!Finite(Cell.AirVelocityMetresPerSecond) || !std::isfinite(Cell.SmokeDensityKilogramsPerCubicMetre) ||
            !std::isfinite(Cell.VaporDensityKilogramsPerCubicMetre) || !std::isfinite(Cell.TemperatureKelvin) ||
            !std::isfinite(Cell.PressurePotentialSquareMetresPerSecondSquared))
            return false;
    }
    return true;
}

void SetDiagnostic(std::string* Diagnostic, const std::string& Message)
{
    if (Diagnostic != nullptr) *Diagnostic = Message;
}

} // namespace

FluidSimulationSequence::~FluidSimulationSequence()
{
    if (Exchange_ != nullptr) Exchange_->AwaitIdle();
}

bool FluidSimulationSequence::Construct(const FluidSpace& InitialState, const VulkanDeviceAccess* HostDevice,
                                       const std::filesystem::path& ShaderFolder, std::string* Diagnostic,
                                       uint32_t PreviewWidth, uint32_t PreviewHeight)
{
    static_assert(sizeof(GpuConstants) == 112);
    if (Exchange_ != nullptr)
    {
        SetDiagnostic(Diagnostic, "a FluidSimulationSequence may only be constructed once");
        return false;
    }
    Ready_ = false;
    if (InitialState.QueryCells().empty() || !ValidGpuData(InitialState) || PreviewWidth == 0 || PreviewHeight == 0 ||
        PreviewWidth > 4096 || PreviewHeight > 4096)
    {
        SetDiagnostic(Diagnostic, "FluidSimulationSequence requires a constructed finite FluidSpace and a preview no larger than 4096 square");
        return false;
    }
    Exchange_ = std::make_unique<DeviceExchange>();
    if (HostDevice != nullptr ? !Exchange_->AttachDevice(*HostDevice, Diagnostic) : !Exchange_->Initialize("", Diagnostic))
    {
        Exchange_.reset();
        return false;
    }
    Adapter_ = Exchange_->AdapterDescription();
    Dimensions_ = { InitialState.QueryCellCountX(), InitialState.QueryCellCountY(), InitialState.QueryCellCountZ() };
    PreviewWidth_ = PreviewWidth;
    PreviewHeight_ = PreviewHeight;
    CurrentState_ = 0;

    if (!ConstructTextures(Dimensions_[0], Dimensions_[1], Dimensions_[2], Diagnostic) ||
        !ConstructGroups() || !ConstructPrograms(ShaderFolder, Diagnostic))
    {
        if (Diagnostic != nullptr && Diagnostic->empty()) *Diagnostic = "Fluid GPU resources or descriptor groups could not be allocated";
        return false;
    }
    Ready_ = true;
    if (!Reset(InitialState, Diagnostic))
    {
        Ready_ = false;
        return false;
    }
    if (Diagnostic != nullptr) Diagnostic->clear();
    return true;
}

bool FluidSimulationSequence::ConstructTextures(uint32_t Width, uint32_t Height, uint32_t Depth, std::string* Diagnostic)
{
    const uint32_t VolumeUsage = TextureUsage::Sampled | TextureUsage::Storage | TextureUsage::CopySource | TextureUsage::CopyTarget;
    const auto ConstructVolume = [&](const std::string& Label, TextureFormat Format, uint32_t Usage,
                                     std::shared_ptr<DeviceTexture>& Texture, std::shared_ptr<DeviceTextureView>& View)
    {
        TextureSpecification Specification;
        Specification.Label = Label;
        Specification.Width = Width;
        Specification.Height = Height;
        Specification.DepthOrLayers = Depth;
        Specification.Dimension = TextureDimension::Volumetric;
        Specification.Format = Format;
        Specification.Usage = Usage;
        Texture = Exchange_->ConstructTexture(Specification);
        if (Texture == nullptr) return false;
        TextureViewSpecification ViewSpecification;
        ViewSpecification.Dimension = ViewDimension::Volumetric;
        ViewSpecification.DimensionSet = true;
        View = Exchange_->ConstructView(Texture, ViewSpecification);
        return View != nullptr;
    };

    for (uint32_t Index = 0; Index < 2; ++Index)
    {
        const std::string Suffix = " " + std::to_string(Index);
        if (!ConstructVolume("Fluid state" + Suffix, TextureFormat::Rgba32Float, VolumeUsage, StateTextures_[Index], StateViews_[Index]) ||
            !ConstructVolume("Fluid thermal" + Suffix, TextureFormat::Rgba32Float, VolumeUsage, ThermalTextures_[Index], ThermalViews_[Index]) ||
            !ConstructVolume("Fluid pressure" + Suffix, TextureFormat::R32Float, VolumeUsage, PressureTextures_[Index], PressureViews_[Index]))
        {
            SetDiagnostic(Diagnostic, "a Fluid 3D state, thermal, or pressure texture could not be allocated");
            return false;
        }
    }
    if (!ConstructVolume("Fluid divergence", TextureFormat::R32Float, VolumeUsage, DivergenceTexture_, DivergenceView_) ||
        !ConstructVolume("Fluid shared ForceField input", TextureFormat::Rgba32Float,
                         TextureUsage::Sampled | TextureUsage::CopyTarget | TextureUsage::CopySource, FieldTexture_, FieldView_))
    {
        SetDiagnostic(Diagnostic, "the Fluid divergence or shared-field input texture could not be allocated");
        return false;
    }

    TextureSpecification Preview;
    Preview.Label = "Fluid volume preview";
    Preview.Width = PreviewWidth_;
    Preview.Height = PreviewHeight_;
    Preview.DepthOrLayers = 1;
    Preview.Dimension = TextureDimension::Planar;
    Preview.Format = TextureFormat::Rgba8Unorm;
    Preview.Usage = TextureUsage::Storage | TextureUsage::CopySource | TextureUsage::CopyTarget;
    PreviewTexture_ = Exchange_->ConstructTexture(Preview);
    if (PreviewTexture_ == nullptr)
    {
        SetDiagnostic(Diagnostic, "the Fluid preview texture could not be allocated");
        return false;
    }
    PreviewView_ = Exchange_->ConstructView(PreviewTexture_);
    if (PreviewView_ == nullptr)
    {
        SetDiagnostic(Diagnostic, "the Fluid preview texture view could not be allocated");
        return false;
    }

    SamplerSpecification Linear;
    Linear.MagFilter = FilterMode::Linear;
    Linear.MinFilter = FilterMode::Linear;
    Linear.AddressU = AddressMode::ClampToEdge;
    Linear.AddressV = AddressMode::ClampToEdge;
    Linear.AddressW = AddressMode::ClampToEdge;
    LinearSampler_ = Exchange_->ConstructSampler(Linear);
    if (LinearSampler_ == nullptr)
    {
        SetDiagnostic(Diagnostic, "the Fluid linear 3D sampler could not be allocated");
        return false;
    }
    return true;
}

bool FluidSimulationSequence::ConstructPrograms(const std::filesystem::path& Folder, std::string* Diagnostic)
{
    const auto Spirv = [&](const char* Unit, const char* Entry)
    {
        return (Folder / (std::string(Unit) + "." + Entry + ".spv")).string();
    };
    const auto Compute = [&](const char* Unit, const char* Entry, const std::shared_ptr<DescriptorLayout>& Layout)
    {
        return Exchange_->ConstructComputeProgram(Spirv(Unit, Entry), Entry, { Layout }, {}, Diagnostic);
    };
    ApplyForcesProgram_ = Compute("FluidForces", "ApplyFluidForces", ForceLayout_);
    AdvectProgram_ = Compute("FluidAdvection", "AdvectFluid", AdvectLayout_);
    DiffuseProgram_ = Compute("FluidDiffusion", "DiffuseFluidScalars", DiffuseLayout_);
    DivergenceProgram_ = Compute("FluidDivergence", "ComputeFluidDivergence", DivergenceLayout_);
    PressureProgram_ = Compute("FluidPressureSolve", "SolveFluidPressure", PressureLayout_);
    ProjectProgram_ = Compute("FluidProjection", "ProjectFluidPressure", ProjectLayout_);
    PreviewProgram_ = Compute("FluidPreview", "RenderFluidPreview", PreviewLayout_);
    return ApplyForcesProgram_ != nullptr && AdvectProgram_ != nullptr && DiffuseProgram_ != nullptr && DivergenceProgram_ != nullptr &&
           PressureProgram_ != nullptr && ProjectProgram_ != nullptr && PreviewProgram_ != nullptr;
}

bool FluidSimulationSequence::ConstructGroups()
{
    const std::array<DescriptorSlot, 7> ForceSlots = {{
        { DescriptorCode::Uniform }, { DescriptorCode::Texture3D }, { DescriptorCode::Texture3D }, { DescriptorCode::Texture3D },
        { DescriptorCode::Storage }, { DescriptorCode::StorageTexture3D, TextureFormat::Rgba32Float },
        { DescriptorCode::StorageTexture3D, TextureFormat::Rgba32Float }
    }};
    const std::array<DescriptorSlot, 6> AdvectSlots = {{
        { DescriptorCode::Uniform }, { DescriptorCode::Texture3D }, { DescriptorCode::Texture3D }, { DescriptorCode::Sampler },
        { DescriptorCode::StorageTexture3D, TextureFormat::Rgba32Float }, { DescriptorCode::StorageTexture3D, TextureFormat::Rgba32Float }
    }};
    const std::array<DescriptorSlot, 5> DiffuseSlots = {{
        { DescriptorCode::Uniform }, { DescriptorCode::Texture3D }, { DescriptorCode::Texture3D },
        { DescriptorCode::StorageTexture3D, TextureFormat::Rgba32Float }, { DescriptorCode::StorageTexture3D, TextureFormat::Rgba32Float }
    }};
    const std::array<DescriptorSlot, 3> DivergenceSlots = {{
        { DescriptorCode::Uniform }, { DescriptorCode::Texture3D }, { DescriptorCode::StorageTexture3D, TextureFormat::R32Float }
    }};
    const std::array<DescriptorSlot, 4> PressureSlots = {{
        { DescriptorCode::Uniform }, { DescriptorCode::Texture3D }, { DescriptorCode::Texture3D },
        { DescriptorCode::StorageTexture3D, TextureFormat::R32Float }
    }};
    const std::array<DescriptorSlot, 6> ProjectSlots = {{
        { DescriptorCode::Uniform }, { DescriptorCode::Texture3D }, { DescriptorCode::Texture3D }, { DescriptorCode::Texture3D },
        { DescriptorCode::StorageTexture3D, TextureFormat::Rgba32Float }, { DescriptorCode::StorageTexture3D, TextureFormat::Rgba32Float }
    }};
    const std::array<DescriptorSlot, 5> PreviewSlots = {{
        { DescriptorCode::Uniform }, { DescriptorCode::Texture3D }, { DescriptorCode::Texture3D }, { DescriptorCode::Sampler },
        { DescriptorCode::StorageTexture2D, TextureFormat::Rgba8Unorm }
    }};
    ForceLayout_ = Exchange_->ConstructDescriptorLayout(ForceSlots, "Fluid force and source");
    AdvectLayout_ = Exchange_->ConstructDescriptorLayout(AdvectSlots, "Fluid advection");
    DiffuseLayout_ = Exchange_->ConstructDescriptorLayout(DiffuseSlots, "Fluid scalar diffusion");
    DivergenceLayout_ = Exchange_->ConstructDescriptorLayout(DivergenceSlots, "Fluid divergence");
    PressureLayout_ = Exchange_->ConstructDescriptorLayout(PressureSlots, "Fluid pressure Jacobi");
    ProjectLayout_ = Exchange_->ConstructDescriptorLayout(ProjectSlots, "Fluid pressure projection");
    PreviewLayout_ = Exchange_->ConstructDescriptorLayout(PreviewSlots, "Fluid volume preview");
    if (!ForceLayout_ || !AdvectLayout_ || !DiffuseLayout_ || !DivergenceLayout_ || !PressureLayout_ || !ProjectLayout_ || !PreviewLayout_)
        return false;

    Constants_ = Exchange_->ConstructRegion(sizeof(GpuConstants), "Fluid compute constants");
    Sources_ = Exchange_->ConstructRegion(sizeof(GpuFluidSource) * FluidSourceLimit, "Fluid queued radial sources");
    if (!Constants_ || !Sources_) return false;

    for (uint32_t State = 0; State < 2; ++State)
    {
        const uint32_t Other = 1u - State;
        ForceGroups_[State] = Exchange_->ConstructDescriptorGroup(
            ForceLayout_, { Constants_, StateViews_[State], ThermalViews_[State], FieldView_, Sources_, StateViews_[Other], ThermalViews_[Other] },
            "Fluid apply forces " + std::to_string(State));
        AdvectGroups_[State] = Exchange_->ConstructDescriptorGroup(
            AdvectLayout_, { Constants_, StateViews_[State], ThermalViews_[State], LinearSampler_, StateViews_[Other], ThermalViews_[Other] },
            "Fluid advect " + std::to_string(State));
        DiffuseGroups_[State] = Exchange_->ConstructDescriptorGroup(
            DiffuseLayout_, { Constants_, StateViews_[State], ThermalViews_[State], StateViews_[Other], ThermalViews_[Other] },
            "Fluid diffuse " + std::to_string(State));
        DivergenceGroups_[State] = Exchange_->ConstructDescriptorGroup(
            DivergenceLayout_, { Constants_, StateViews_[State], DivergenceView_ }, "Fluid divergence " + std::to_string(State));
        PressureGroups_[State] = Exchange_->ConstructDescriptorGroup(
            PressureLayout_, { Constants_, PressureViews_[State], DivergenceView_, PressureViews_[Other] },
            "Fluid pressure iteration " + std::to_string(State));
        PreviewGroups_[State] = Exchange_->ConstructDescriptorGroup(
            PreviewLayout_, { Constants_, StateViews_[State], ThermalViews_[State], LinearSampler_, PreviewView_ },
            "Fluid preview " + std::to_string(State));
        for (uint32_t Pressure = 0; Pressure < 2; ++Pressure)
        {
            ProjectGroups_[State][Pressure] = Exchange_->ConstructDescriptorGroup(
                ProjectLayout_, { Constants_, StateViews_[State], ThermalViews_[State], PressureViews_[Pressure],
                                  StateViews_[Other], ThermalViews_[Other] },
                "Fluid project " + std::to_string(State) + ", pressure " + std::to_string(Pressure));
        }
        if (!ForceGroups_[State] || !AdvectGroups_[State] || !DiffuseGroups_[State] || !DivergenceGroups_[State] ||
            !PressureGroups_[State] || !PreviewGroups_[State] || !ProjectGroups_[State][0] || !ProjectGroups_[State][1])
            return false;
    }
    return true;
}

bool FluidSimulationSequence::Compatible(const FluidSpace& Space) const noexcept
{
    return Ready() && Dimensions_[0] == Space.QueryCellCountX() && Dimensions_[1] == Space.QueryCellCountY() &&
           Dimensions_[2] == Space.QueryCellCountZ() && Space.QueryCells().size() == CellCount(Space);
}

bool FluidSimulationSequence::Reset(const FluidSpace& InitialState, std::string* Diagnostic)
{
    if (!Ready() || Dimensions_[0] != InitialState.QueryCellCountX() || Dimensions_[1] != InitialState.QueryCellCountY() ||
        Dimensions_[2] != InitialState.QueryCellCountZ() || InitialState.QueryCells().size() != CellCount(InitialState) ||
        !ValidGpuData(InitialState))
    {
        SetDiagnostic(Diagnostic, "Reset requires a finite FluidSpace matching the allocated GPU lattice");
        return false;
    }

    ConstantsMirror_ = {};
    const FluidSpaceDescriptor& Descriptor = InitialState.QueryDescriptor();
    const FluidSpaceConfiguration& Configuration = Descriptor.Configuration;
    ConstantsMirror_.Grid = { static_cast<float>(Dimensions_[0]), static_cast<float>(Dimensions_[1]), static_cast<float>(Dimensions_[2]), 0.0f };
    ConstantsMirror_.Timing = { 0.0f, ToGpuFloat(Configuration.AmbientTemperatureKelvin),
                                ToGpuFloat(Configuration.BuoyancyAccelerationPerKelvin), 0.0f };
    const double Span = Configuration.CellSpanMetres;
    ConstantsMirror_.Cell = { ToGpuFloat(Span * Descriptor.Spatial.Scale.X), ToGpuFloat(Span * Descriptor.Spatial.Scale.Y),
                              ToGpuFloat(Span * Descriptor.Spatial.Scale.Z), 0.0f };
    ConstantsMirror_.Position = { ToGpuFloat(Descriptor.Spatial.PositionMetres.X), ToGpuFloat(Descriptor.Spatial.PositionMetres.Y),
                                  ToGpuFloat(Descriptor.Spatial.PositionMetres.Z), 0.0f };
    const Quatd Rotation = Descriptor.Spatial.RotationQuaternion();
    ConstantsMirror_.Rotation = { ToGpuFloat(Rotation.X), ToGpuFloat(Rotation.Y), ToGpuFloat(Rotation.Z), ToGpuFloat(Rotation.W) };
    ConstantsMirror_.Solver = { ToGpuFloat(Configuration.SmokeDiffusivitySquareMetresPerSecond),
                                ToGpuFloat(Configuration.VaporDiffusivitySquareMetresPerSecond),
                                static_cast<float>(Configuration.PressureIterationCount), 0.0f };
    ConstantsMirror_.Preview = { static_cast<float>(PreviewWidth_), static_cast<float>(PreviewHeight_),
                                 static_cast<float>(Dimensions_[2]), 0.0f };

    const std::vector<GpuFloat4> State = PackState(InitialState);
    const std::vector<GpuFloat4> Thermal = PackThermal(InitialState);
    Exchange_->WriteRegion(Constants_, 0, &ConstantsMirror_, sizeof(ConstantsMirror_));
    Exchange_->WriteTexture(StateTextures_[0], 0, State.data(), State.size() * sizeof(GpuFloat4), Dimensions_[0], Dimensions_[1], Dimensions_[2]);
    Exchange_->WriteTexture(ThermalTextures_[0], 0, Thermal.data(), Thermal.size() * sizeof(GpuFloat4), Dimensions_[0], Dimensions_[1], Dimensions_[2]);

    CommandSequence Clear = Exchange_->BeginSequence();
    Clear.ClearTexture(StateTextures_[1], { 0.0f, 0.0f, 0.0f, 0.0f });
    Clear.ClearTexture(ThermalTextures_[1], { 0.0f, 0.0f, 0.0f, 0.0f });
    Clear.ClearTexture(PressureTextures_[0], { 0.0f, 0.0f, 0.0f, 0.0f });
    Clear.ClearTexture(PressureTextures_[1], { 0.0f, 0.0f, 0.0f, 0.0f });
    Clear.ClearTexture(DivergenceTexture_, { 0.0f, 0.0f, 0.0f, 0.0f });
    Clear.ClearTexture(FieldTexture_, { 0.0f, 0.0f, 0.0f, 0.0f });
    Clear.ClearTexture(PreviewTexture_, { 0.0f, 0.0f, 0.0f, 0.0f });
    if (!Exchange_->Submit(Clear, Diagnostic)) return false;
    CurrentState_ = 0;
    if (Diagnostic != nullptr) Diagnostic->clear();
    return true;
}

bool FluidSimulationSequence::Advance(FluidSpace& Space, double DeltaSeconds, const IFieldSampler* SharedFieldSampler,
                                      std::string* Diagnostic)
{
    if (!Compatible(Space))
    {
        SetDiagnostic(Diagnostic, "Advance requires a ready GPU sequence and a FluidSpace with the allocated dimensions");
        return false;
    }
    if (!std::isfinite(DeltaSeconds) || DeltaSeconds <= 0.0 || DeltaSeconds > 0.1)
    {
        SetDiagnostic(Diagnostic, "Fluid GPU step must be finite and in (0, 0.1] seconds");
        return false;
    }
    if (!ValidGpuData(Space))
    {
        SetDiagnostic(Diagnostic, "the FluidSpace initial/readback snapshot contains non-finite values; call Reset with valid data");
        return false;
    }

    const FluidSpaceDescriptor& Descriptor = Space.QueryDescriptor();
    const FluidSpaceConfiguration& Configuration = Descriptor.Configuration;
    const bool UseSharedField = SharedFieldSampler != nullptr && SharedFieldSampler->QueryFieldEnabled();
    ConstantsMirror_.Grid[3] = UseSharedField ? 1.0f : 0.0f;
    ConstantsMirror_.Timing = { ToGpuFloat(DeltaSeconds), ToGpuFloat(Configuration.AmbientTemperatureKelvin),
                                ToGpuFloat(Configuration.BuoyancyAccelerationPerKelvin),
                                static_cast<float>(std::clamp(DeltaSeconds * 2.0, 0.0, 1.0)) };
    ConstantsMirror_.Cell = { ToGpuFloat(Configuration.CellSpanMetres * Descriptor.Spatial.Scale.X),
                              ToGpuFloat(Configuration.CellSpanMetres * Descriptor.Spatial.Scale.Y),
                              ToGpuFloat(Configuration.CellSpanMetres * Descriptor.Spatial.Scale.Z), 0.0f };
    ConstantsMirror_.Position = { ToGpuFloat(Descriptor.Spatial.PositionMetres.X), ToGpuFloat(Descriptor.Spatial.PositionMetres.Y),
                                  ToGpuFloat(Descriptor.Spatial.PositionMetres.Z), 0.0f };
    const Quatd Rotation = Descriptor.Spatial.RotationQuaternion();
    ConstantsMirror_.Rotation = { ToGpuFloat(Rotation.X), ToGpuFloat(Rotation.Y), ToGpuFloat(Rotation.Z), ToGpuFloat(Rotation.W) };
    ConstantsMirror_.Solver[0] = ToGpuFloat(Configuration.SmokeDiffusivitySquareMetresPerSecond);
    ConstantsMirror_.Solver[1] = ToGpuFloat(Configuration.VaporDiffusivitySquareMetresPerSecond);
    ConstantsMirror_.Solver[2] = static_cast<float>(Configuration.PressureIterationCount);
    ConstantsMirror_.Solver[3] = static_cast<float>(Space.QueryPendingSources().size());
    ConstantsMirror_.Preview[0] = static_cast<float>(PreviewWidth_);
    ConstantsMirror_.Preview[1] = static_cast<float>(PreviewHeight_);
    ConstantsMirror_.Preview[2] = static_cast<float>(Dimensions_[2]);

    Exchange_->WriteRegion(Constants_, 0, &ConstantsMirror_, sizeof(ConstantsMirror_));
    if (!Space.QueryPendingSources().empty())
    {
        std::array<GpuFluidSource, FluidSourceLimit> PackedSources{};
        size_t SourceIndex = 0;
        for (const FluidQueuedSource& Source : Space.QueryPendingSources())
        {
            GpuFluidSource& Target = PackedSources[SourceIndex++];
            const GpuFloat4 Centre = Pack(Source.CentreWorldMetres, Source.RadiusMetres);
            const GpuFloat4 VelocitySmoke = Pack(Source.Delta.AirVelocityMetresPerSecond,
                                                  Source.Delta.SmokeDensityKilogramsPerCubicMetre);
            const GpuFloat4 VaporTemperature{ ToGpuFloat(Source.Delta.VaporDensityKilogramsPerCubicMetre),
                                               ToGpuFloat(Source.Delta.TemperatureKelvin), 0.0f, 0.0f };
            std::memcpy(Target.PositionRadius.data(), &Centre, sizeof(Centre));
            std::memcpy(Target.VelocitySmokeDelta.data(), &VelocitySmoke, sizeof(VelocitySmoke));
            std::memcpy(Target.VaporTemperatureDelta.data(), &VaporTemperature, sizeof(VaporTemperature));
        }
        Exchange_->WriteRegion(Sources_, 0, PackedSources.data(), sizeof(PackedSources));
    }
    if (UseSharedField)
    {
        std::vector<GpuFloat4> FieldFlow;
        FieldFlow.reserve(static_cast<size_t>(CellCount(Space)));
        for (uint32_t Z = 0; Z < Dimensions_[2]; ++Z)
            for (uint32_t Y = 0; Y < Dimensions_[1]; ++Y)
                for (uint32_t X = 0; X < Dimensions_[0]; ++X)
                {
                    const Vec3d Flow = SharedFieldSampler->SampleWorldFlow(Space.CellWorldPosition(X, Y, Z), 0.0, true);
                    FieldFlow.push_back(Pack(Flow, Length(Flow)));
                }
        Exchange_->WriteTexture(FieldTexture_, 0, FieldFlow.data(), FieldFlow.size() * sizeof(GpuFloat4),
                                Dimensions_[0], Dimensions_[1], Dimensions_[2]);
    }

    const uint32_t OriginalState = CurrentState_;
    const uint32_t ForcedState = 1u - OriginalState;
    const uint32_t AdvectedState = OriginalState;
    const uint32_t DiffusedState = 1u - AdvectedState;
    CommandSequence Sequence = Exchange_->BeginSequence();

    Sequence.BindProgram(ApplyForcesProgram_);
    Sequence.BindGroup(0, ForceGroups_[OriginalState]);
    Sequence.Dispatch(DispatchGroups(Dimensions_[0]), DispatchGroups(Dimensions_[1]), DispatchGroups(Dimensions_[2]));

    Sequence.BindProgram(AdvectProgram_);
    Sequence.BindGroup(0, AdvectGroups_[ForcedState]);
    Sequence.Dispatch(DispatchGroups(Dimensions_[0]), DispatchGroups(Dimensions_[1]), DispatchGroups(Dimensions_[2]));

    Sequence.BindProgram(DiffuseProgram_);
    Sequence.BindGroup(0, DiffuseGroups_[AdvectedState]);
    Sequence.Dispatch(DispatchGroups(Dimensions_[0]), DispatchGroups(Dimensions_[1]), DispatchGroups(Dimensions_[2]));

    Sequence.BindProgram(DivergenceProgram_);
    Sequence.BindGroup(0, DivergenceGroups_[DiffusedState]);
    Sequence.Dispatch(DispatchGroups(Dimensions_[0]), DispatchGroups(Dimensions_[1]), DispatchGroups(Dimensions_[2]));

    Sequence.ClearTexture(PressureTextures_[0], { 0.0f, 0.0f, 0.0f, 0.0f });
    Sequence.ClearTexture(PressureTextures_[1], { 0.0f, 0.0f, 0.0f, 0.0f });
    uint32_t PressureIndex = 0;
    for (uint32_t Iteration = 0; Iteration < Configuration.PressureIterationCount; ++Iteration)
    {
        Sequence.BindProgram(PressureProgram_);
        Sequence.BindGroup(0, PressureGroups_[PressureIndex]);
        Sequence.Dispatch(DispatchGroups(Dimensions_[0]), DispatchGroups(Dimensions_[1]), DispatchGroups(Dimensions_[2]));
        PressureIndex = 1u - PressureIndex;
    }

    Sequence.BindProgram(ProjectProgram_);
    Sequence.BindGroup(0, ProjectGroups_[DiffusedState][PressureIndex]);
    Sequence.Dispatch(DispatchGroups(Dimensions_[0]), DispatchGroups(Dimensions_[1]), DispatchGroups(Dimensions_[2]));
    if (!Exchange_->Submit(Sequence, Diagnostic)) return false;

    CurrentState_ = OriginalState;
    Space.ClearPendingSources();
    Space.AdvanceRevision();
    if (Diagnostic != nullptr) Diagnostic->clear();
    return true;
}

bool FluidSimulationSequence::Readback(FluidSpace& Space, std::string* Diagnostic)
{
    if (!Compatible(Space))
    {
        SetDiagnostic(Diagnostic, "Readback requires a ready GPU sequence and a FluidSpace with the allocated dimensions");
        return false;
    }
    std::vector<uint8_t> StateBytes;
    std::vector<uint8_t> ThermalBytes;
    if (!Exchange_->ReadTexture(StateTextures_[CurrentState_], 0, 0, StateBytes) ||
        !Exchange_->ReadTexture(ThermalTextures_[CurrentState_], 0, 0, ThermalBytes))
    {
        SetDiagnostic(Diagnostic, "Fluid GPU state readback failed");
        return false;
    }
    const size_t Count = static_cast<size_t>(CellCount(Space));
    if (StateBytes.size() != Count * sizeof(GpuFloat4) || ThermalBytes.size() != Count * sizeof(GpuFloat4))
    {
        SetDiagnostic(Diagnostic, "Fluid GPU readback returned a texture size inconsistent with its lattice");
        return false;
    }
    std::vector<GpuFloat4> State(Count), Thermal(Count);
    std::memcpy(State.data(), StateBytes.data(), StateBytes.size());
    std::memcpy(Thermal.data(), ThermalBytes.data(), ThermalBytes.size());
    std::vector<FluidCell>& Cells = Space.AccessCells();
    for (size_t Index = 0; Index < Count; ++Index)
    {
        Cells[Index].AirVelocityMetresPerSecond = { State[Index].X, State[Index].Y, State[Index].Z };
        Cells[Index].SmokeDensityKilogramsPerCubicMetre = State[Index].W;
        Cells[Index].VaporDensityKilogramsPerCubicMetre = Thermal[Index].X;
        Cells[Index].TemperatureKelvin = Thermal[Index].Y;
        Cells[Index].PressurePotentialSquareMetresPerSecondSquared = Thermal[Index].Z;
    }
    if (Diagnostic != nullptr) Diagnostic->clear();
    return true;
}

std::vector<FluidBurstTriggerEvent> FluidSimulationSequence::CollectBurstTriggers(const FluidSpace& Space,
                                                                                  double MinimumThermalIntensity,
                                                                                  double MinimumVaporDensity,
                                                                                  double MinimumSmokeDensity) const
{
    std::vector<FluidBurstTriggerEvent> Events;
    const FluidSpaceDescriptor& Descriptor = Space.QueryDescriptor();
    const double Ambient = Descriptor.Configuration.AmbientTemperatureKelvin;
    for (uint32_t Z = 0; Z < Space.QueryCellCountZ(); ++Z)
        for (uint32_t Y = 0; Y < Space.QueryCellCountY(); ++Y)
            for (uint32_t X = 0; X < Space.QueryCellCountX(); ++X)
            {
                const FluidCell& Cell = Space.QueryCell(X, Y, Z);
                const double ThermalIntensity = std::clamp((Cell.TemperatureKelvin - Ambient) / 200.0, 0.0, 1.0);
                if (ThermalIntensity < MinimumThermalIntensity && Cell.VaporDensityKilogramsPerCubicMetre < MinimumVaporDensity &&
                    Cell.SmokeDensityKilogramsPerCubicMetre < MinimumSmokeDensity)
                    continue;
                FluidBurstTriggerEvent Event;
                Event.WorldPointMetres = Space.CellWorldPosition(X, Y, Z);
                Event.ImpulseDirection = Normalise(Cell.AirVelocityMetresPerSecond + Vec3d{ 0.0, 0.0, 1.0e-9 });
                Event.ThermalIntensity = ThermalIntensity;
                Event.VaporIntensity = Cell.VaporDensityKilogramsPerCubicMetre;
                Event.SmokeIntensity = Cell.SmokeDensityKilogramsPerCubicMetre;
                Event.EnergyScale = std::max({ ThermalIntensity, Event.VaporIntensity, Event.SmokeIntensity });
                Event.TriggerSeed = static_cast<uint32_t>(Space.CellIndex(X, Y, Z) ^ Space.QueryRevision());
                Events.push_back(Event);
            }
    std::sort(Events.begin(), Events.end(), [](const auto& Left, const auto& Right) { return Left.EnergyScale > Right.EnergyScale; });
    if (Events.size() > 32) Events.resize(32);
    return Events;
}

bool FluidSimulationSequence::RenderPreview(std::string* Diagnostic)
{
    if (!Ready())
    {
        SetDiagnostic(Diagnostic, "RenderPreview requires a constructed GPU sequence");
        return false;
    }
    ConstantsMirror_.Grid[3] = 0.0f;
    ConstantsMirror_.Timing[0] = 0.0f;
    ConstantsMirror_.Solver[3] = 0.0f;
    ConstantsMirror_.Preview = { static_cast<float>(PreviewWidth_), static_cast<float>(PreviewHeight_),
                                 static_cast<float>(Dimensions_[2]), 0.0f };
    Exchange_->WriteRegion(Constants_, 0, &ConstantsMirror_, sizeof(ConstantsMirror_));
    CommandSequence Sequence = Exchange_->BeginSequence();
    Sequence.BindProgram(PreviewProgram_);
    Sequence.BindGroup(0, PreviewGroups_[CurrentState_]);
    Sequence.Dispatch(DispatchGroups(PreviewWidth_, 8u), DispatchGroups(PreviewHeight_, 8u));
    if (!Exchange_->Submit(Sequence, Diagnostic)) return false;
    if (Diagnostic != nullptr) Diagnostic->clear();
    return true;
}

bool FluidSimulationSequence::ReadPreviewImage(std::vector<uint8_t>& Rgba, std::string* Diagnostic)
{
    if (!Ready() || !Exchange_->ReadTexture(PreviewTexture_, 0, 0, Rgba))
    {
        SetDiagnostic(Diagnostic, "Fluid GPU preview readback failed");
        return false;
    }
    if (Diagnostic != nullptr) Diagnostic->clear();
    return true;
}

VkImageView FluidSimulationSequence::QueryPreviewView() const noexcept
{
    return PreviewView_ ? PreviewView_->Handle : VK_NULL_HANDLE;
}

} // namespace Frontier
