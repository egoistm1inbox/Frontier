/*==========================================================================================================================================
                                                    FLUIDSIMULATIONSEQUENCE.H
==========================================================================================================================================*/
// 🧩 Slang/Vulkan Eulerian fluid compute sequence, native level-field coupling, GPU volume preview, and explicit event readback.

#pragma once

#include "Engine/PhysicalDynamics/IFieldSampler.h"
#include "Engine/PhysicalDynamics/FluidDynamics/FluidSpace.h"
#include "Engine/PhysicalDynamics/ParticleDynamics/ParticleTriggerRouter.h"
#include "Frontier/Engine/DeviceExchange/DeviceExchange.h"

#include <array>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <string>
#include <vector>

namespace Frontier
{

class FluidSimulationSequence
{
  public:
    FluidSimulationSequence() = default;
    ~FluidSimulationSequence();

    FluidSimulationSequence(const FluidSimulationSequence&) = delete;
    FluidSimulationSequence& operator=(const FluidSimulationSequence&) = delete;

    // 📝 The simulation state and preview are allocated on the host device, or on an owned Vulkan device for captures/tests.
    [[nodiscard]] bool Construct(const FluidSpace& InitialState, const VulkanDeviceAccess* HostDevice,
                                 const std::filesystem::path& ShaderFolder, std::string* Diagnostic,
                                 uint32_t PreviewWidth = 320, uint32_t PreviewHeight = 320);

    // 📝 Re-seed a same-sized GPU space from its host-authored initial/readback values and clear the pressure solve buffers.
    [[nodiscard]] bool Reset(const FluidSpace& InitialState, std::string* Diagnostic = nullptr);

    // 📝 One Eulerian step: Slang compute applies the native ForceField, sources, buoyancy, advection, diffusion and pressure projection.
    [[nodiscard]] bool Advance(FluidSpace& Space, double DeltaSeconds, const IFieldSampler* SharedFieldSampler = nullptr,
                               std::string* Diagnostic = nullptr);

    // 📝 Explicit, blocking telemetry path; the GPU remains authoritative and is never advanced by this readback.
    [[nodiscard]] bool Readback(FluidSpace& Space, std::string* Diagnostic = nullptr);

    // 📝 Burst selection runs on the latest explicit readback, then routes through ParticleTriggerRouter as before.
    [[nodiscard]] std::vector<FluidBurstTriggerEvent> CollectBurstTriggers(const FluidSpace& Space,
                                                                           double MinimumThermalIntensity = 0.25,
                                                                           double MinimumVaporDensity = 0.02,
                                                                           double MinimumSmokeDensity = 0.02) const;

    // 📝 Ray-march the 3D GPU state to an RGBA preview with the FluidPreview Slang compute shader.
    [[nodiscard]] bool RenderPreview(std::string* Diagnostic = nullptr);
    [[nodiscard]] bool ReadPreviewImage(std::vector<uint8_t>& Rgba, std::string* Diagnostic = nullptr);
    [[nodiscard]] VkImageView QueryPreviewView() const noexcept;
    [[nodiscard]] std::array<uint32_t, 2> QueryPreviewExtent() const noexcept { return { PreviewWidth_, PreviewHeight_ }; }
    [[nodiscard]] const std::string& QueryAdapter() const noexcept { return Adapter_; }
    [[nodiscard]] bool Ready() const noexcept { return Ready_ && Exchange_ != nullptr && Exchange_->Ready(); }

  private:
    struct alignas(16) GpuConstants
    {
        std::array<float, 4> Grid{};
        std::array<float, 4> Timing{};
        std::array<float, 4> Cell{};
        std::array<float, 4> Position{};
        std::array<float, 4> Rotation{};
        std::array<float, 4> Solver{};
        std::array<float, 4> Preview{};
    };

    [[nodiscard]] bool ConstructTextures(uint32_t Width, uint32_t Height, uint32_t Depth, std::string* Diagnostic);
    [[nodiscard]] bool ConstructPrograms(const std::filesystem::path& Folder, std::string* Diagnostic);
    [[nodiscard]] bool ConstructGroups();
    [[nodiscard]] bool Compatible(const FluidSpace& Space) const noexcept;

    std::unique_ptr<DeviceExchange> Exchange_{};
    std::string Adapter_{};
    std::array<uint32_t, 3> Dimensions_{};
    uint32_t PreviewWidth_ = 0;
    uint32_t PreviewHeight_ = 0;
    uint32_t CurrentState_ = 0;
    bool Ready_ = false;
    GpuConstants ConstantsMirror_{};

    std::shared_ptr<DeviceRegion> Constants_{};
    std::shared_ptr<DeviceRegion> Sources_{};
    std::shared_ptr<DeviceSampler> LinearSampler_{};

    std::shared_ptr<DescriptorLayout> ForceLayout_{};
    std::shared_ptr<DescriptorLayout> AdvectLayout_{};
    std::shared_ptr<DescriptorLayout> DiffuseLayout_{};
    std::shared_ptr<DescriptorLayout> DivergenceLayout_{};
    std::shared_ptr<DescriptorLayout> PressureLayout_{};
    std::shared_ptr<DescriptorLayout> ProjectLayout_{};
    std::shared_ptr<DescriptorLayout> PreviewLayout_{};

    std::array<std::shared_ptr<DeviceTexture>, 2> StateTextures_{};
    std::array<std::shared_ptr<DeviceTextureView>, 2> StateViews_{};
    std::array<std::shared_ptr<DeviceTexture>, 2> ThermalTextures_{};
    std::array<std::shared_ptr<DeviceTextureView>, 2> ThermalViews_{};
    std::array<std::shared_ptr<DeviceTexture>, 2> PressureTextures_{};
    std::array<std::shared_ptr<DeviceTextureView>, 2> PressureViews_{};
    std::shared_ptr<DeviceTexture> DivergenceTexture_{};
    std::shared_ptr<DeviceTextureView> DivergenceView_{};
    std::shared_ptr<DeviceTexture> FieldTexture_{};
    std::shared_ptr<DeviceTextureView> FieldView_{};
    std::shared_ptr<DeviceTexture> PreviewTexture_{};
    std::shared_ptr<DeviceTextureView> PreviewView_{};

    std::shared_ptr<DeviceProgram> ApplyForcesProgram_{};
    std::shared_ptr<DeviceProgram> AdvectProgram_{};
    std::shared_ptr<DeviceProgram> DiffuseProgram_{};
    std::shared_ptr<DeviceProgram> DivergenceProgram_{};
    std::shared_ptr<DeviceProgram> PressureProgram_{};
    std::shared_ptr<DeviceProgram> ProjectProgram_{};
    std::shared_ptr<DeviceProgram> PreviewProgram_{};

    std::array<std::shared_ptr<DescriptorGroup>, 2> ForceGroups_{};
    std::array<std::shared_ptr<DescriptorGroup>, 2> AdvectGroups_{};
    std::array<std::shared_ptr<DescriptorGroup>, 2> DiffuseGroups_{};
    std::array<std::shared_ptr<DescriptorGroup>, 2> DivergenceGroups_{};
    std::array<std::shared_ptr<DescriptorGroup>, 2> PressureGroups_{};
    std::array<std::array<std::shared_ptr<DescriptorGroup>, 2>, 2> ProjectGroups_{};
    std::array<std::shared_ptr<DescriptorGroup>, 2> PreviewGroups_{};
};

} // namespace Frontier
