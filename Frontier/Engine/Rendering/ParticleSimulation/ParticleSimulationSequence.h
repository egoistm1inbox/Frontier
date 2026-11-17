/*==========================================================================================================================================
                                                       PARTICLESIMULATIONSEQUENCE.H
==========================================================================================================================================*/
// 🧩 The Particle editor's GPU engine: the wind lattice, every effect's dispatches, the census and probe readbacks and the raster of
//    one refresh into an offscreen image, on the device exchange.

#pragma once

#include "Frontier/Engine/DeviceExchange/DeviceExchange.h"
#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleSpace.h"

#include <array>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace Frontier::ParticleSimulation
{

// 📝 A port of eos engine.js (Experimental/ParticleEditor/Engine) statement for statement: the exchange keeps WebGPU's order, so
//    the queue writes, dispatches, copies and raster scopes follow the prototype's render(). The shaders are the
//    ParticleSimulation archive set (Frontier/Engine/Shaders/ParticleSimulation).
// 📝 Beyond the prototype: the lensing program always runs, with no holes and no shimmer it copies the image exactly, so the
//    presented image stays one view whether or not an effect lenses.

struct ParticleCensus
{
    uint32_t Alive    = 0;
    uint32_t SpeciesA = 0;
    uint32_t SpeciesB = 0;
    uint32_t SpeciesC = 0;
    double   Energy   = 0.0;   // Σ |v|² over the living particles [m²/s²]
    bool     Valid    = false;
};

struct ParticleProbeReading
{
    std::array<uint32_t, 3> Cell{};
    std::array<float, 3>    Velocity{};   // [m/s]
    float                   Magnitude = 0.0f;
    bool                    Valid     = false;
};

class ParticleSimulationSequence
{
public:
    ParticleSimulationSequence();
    ~ParticleSimulationSequence();

    ParticleSimulationSequence(const ParticleSimulationSequence&)            = delete;
    ParticleSimulationSequence& operator=(const ParticleSimulationSequence&) = delete;

    // 📝 On the editor's device when HostDevice is given, otherwise on an own device (the Vulkan loader or FRONTIER_VULKAN_DRIVER).
    bool Construct(const VulkanDeviceAccess* HostDevice, const std::filesystem::path& ShaderFolder, std::string* Diagnostic);

    // 📝 One refresh: writes, dispatches, raster and lensing, submitted and awaited; then the census and probe readbacks.
    //    When Plan.SharedFieldActive, the same native IFieldSampler is sampled over the complete particle wind lattice.
    bool Refresh(const ParticleRefreshPlan& Plan, std::span<const ParticleEffectInstance> Effects, std::string* Diagnostic,
                 const IFieldSampler* SharedFieldSampler = nullptr);

    [[nodiscard]] VkImageView             QueryPresentedView() const noexcept;
    [[nodiscard]] std::array<uint32_t, 2> QueryExtent() const noexcept { return Extent_; }
    [[nodiscard]] const std::string&      QueryAdapter() const noexcept { return Adapter_; }
    [[nodiscard]] double                  QueryRefreshMilliseconds() const noexcept { return RefreshMilliseconds_; }
    [[nodiscard]] const ParticleProbeReading& QueryProbe() const noexcept { return Probe_; }
    [[nodiscard]] const ParticleCensus*   QueryCensus(std::string_view Token) const noexcept;
    [[nodiscard]] uint64_t                QueryStoreBytes() const noexcept;

    // 📝 The presented image as RGBA8 rows, top first (captures).
    bool ReadPresentedImage(std::vector<uint8_t>& Rgba, std::string* Diagnostic);
    // 📝 The wind lattice as four floats per cell (velocity, magnitude), x fastest (the field overlay's readback).
    bool ReadWindLattice(std::vector<float>& Cells, std::string* Diagnostic);

    [[nodiscard]] DeviceExchange* AccessExchange() noexcept { return Exchange_.get(); }

private:
    struct EffectStores;

    bool ConstructPrograms(const std::filesystem::path& ShaderFolder, std::string* Diagnostic);
    bool ConstructTargets(uint32_t Width, uint32_t Height);
    EffectStores& ResolveStores(const ParticleEffectInstance& Effect);

    std::unique_ptr<DeviceExchange> Exchange_;
    std::string                     Adapter_;
    std::array<uint32_t, 2>         Extent_ = { 0u, 0u };
    double                          RefreshMilliseconds_ = 0.0;
    ParticleProbeReading            Probe_;

    std::shared_ptr<DescriptorLayout> RefreshLayout_, SimulationLayout_, RasterLayout_, WindLayout_, LensingLayout_;
    std::shared_ptr<DeviceRegion>     RefreshConstants_, Components_, Segments_, Guides_, VacantEffect_, VacantParticles_, Fields_,
                                      VacantCellCount_, VacantCellSlots_, LensingConstants_;
    std::shared_ptr<DeviceTexture>     WindTexture_;
    std::shared_ptr<DeviceTextureView> WindView_;
    std::shared_ptr<DeviceSampler>     WindSampler_, LensingSampler_;
    std::shared_ptr<DescriptorGroup>   RefreshGroup_, WindGroup_, VacantGroup_, LensingGroup_;

    std::shared_ptr<DeviceProgram> WindProgram_, ReleaseProgram_, AdvanceProgram_, ClearCensusProgram_, GatherCensusProgram_,
                                   ClearCellsProgram_, InsertCellsProgram_, MoleculesProgram_, SwarmProgram_;
    std::shared_ptr<DeviceProgram> ParticleAdditive_, ParticleAlphaOver_, CubeProgram_, ShardProgram_, ButterflyProgram_,
                                   LightningProgram_, ArrowProgram_, FibreProgram_, FibreSparkProgram_, FloorProgram_, GuideProgram_,
                                   LensingProgram_;

    std::shared_ptr<DeviceTexture>     Colour_, Depth_, Lensed_;
    std::shared_ptr<DeviceTextureView> ColourView_, DepthView_, LensedView_;

    std::vector<std::unique_ptr<EffectStores>> Stores_;
};

} // namespace Frontier::ParticleSimulation
