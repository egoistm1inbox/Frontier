/*==========================================================================================================================================
                                                         PARTICLEEXTENSION.H
==========================================================================================================================================*/
// 🧩 The bridge between a ParticleSpace and an application: the GPU particle engine run on the host's device for the plan the
//    space hands over, and the readings the editor shows (census per effect, probe, wind lattice).

#pragma once

#include "Frontier/Engine/Interface/ParticleEditor/ParticleViewportPresentation.h"
#include "Frontier/Engine/Rendering/ParticleSimulation/ParticleSimulationSequence.h"

#include <filesystem>
#include <memory>
#include <string>

namespace Frontier
{

// 📝 The image as the host sees it: the view to register with the interface renderer (GENERAL layout) and what the editor reads.
struct ParticleViewportOutcome
{
    VkImageView           View = VK_NULL_HANDLE;
    ParticleViewportImage Image{};
};

class ParticleExtension
{
  public:
    // 📝 HostDevice: the editor's Vulkan device, borrowed; null runs the engine on an own device (the loader or
    //    FRONTIER_VULKAN_DRIVER), as the captures do.
    ParticleExtension(std::filesystem::path ShaderRoot, const VulkanDeviceAccess* HostDevice);
    ~ParticleExtension();

    ParticleExtension(const ParticleExtension&)            = delete;
    ParticleExtension& operator=(const ParticleExtension&) = delete;

    ParticleViewportOutcome Render(const ParticleViewportRequest& Request);

    [[nodiscard]] ParticleSimulation::ParticleSimulationSequence* AccessSequence() noexcept { return Sequence_.get(); }

  private:
    std::filesystem::path                                           ShaderRoot_;
    bool                                                            HostDeviceAttached_ = false;
    VulkanDeviceAccess                                              Device_{};
    std::unique_ptr<ParticleSimulation::ParticleSimulationSequence> Sequence_{};
    bool                                                            Constructed_ = false;
    std::string                                                     Failure_{};
};

} // namespace Frontier
