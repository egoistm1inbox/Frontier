/*====================================================================================================================================
                                                      VULKANSHADERCOMPILER.H
====================================================================================================================================*/
// 🧩 Native Vulkan driver compatibility inspector, SPIR-V 1.0 compute module synthesizer, persistent VkPipelineCache
//    archive, and non-blocking background shader/pipeline compiler streaming live progress into LogStreamPanel.

#pragma once

#include "Engine/Diagnostics/LogStream.h"
#include "Engine/Rendering/PathReplayRayQuery.h"

#include <cstdint>
#include <filesystem>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace Frontier
{
struct VulkanRasterAccess;
} // namespace Frontier

namespace Frontier::Drive
{

//------------------------------------------------------------------------------------------------------------------------
//                                        VULKAN DRIVER COMPATIBILITY DIAGNOSTICS
//------------------------------------------------------------------------------------------------------------------------

struct VulkanDriverCompatibilityReport
{
    bool        LoaderAvailable               = false; // [-] - True when vulkan-1.dll / libvulkan.so.1 resolved
    bool        HardwareDeviceActive          = false; // [-] - True when a VkPhysicalDevice + VkDevice is bound
    bool        SwapchainExtensionSupported   = false; // [-] - VK_KHR_swapchain advertised by adapter
    bool        DriverPropertiesAvailable     = false; // [-] - VkPhysicalDeviceDriverProperties populated
    bool        DescriptorIndexingSupported   = false; // [-] - VK_EXT_descriptor_indexing / Vulkan 1.2 indexing
    uint32_t    InstanceApiVersion            = 0u;    // [-] - Loader Vulkan API version bitfield
    uint32_t    DeviceApiVersion              = 0u;    // [-] - Adapter Vulkan API version bitfield
    uint32_t    RawDriverVersion              = 0u;    // [-] - Vendor-encoded driver version bitfield
    uint32_t    VendorId                      = 0u;    // [-] - PCI vendor ID (0x10DE, 0x1002, 0x8086, ...)
    uint32_t    DeviceId                      = 0u;    // [-] - PCI device ID
    uint64_t    DeviceLocalVramMegabytes      = 0u;    // [MB] - Sum of VK_MEMORY_HEAP_DEVICE_LOCAL_BIT heaps
    uint64_t    HostVisibleMegabytes          = 0u;    // [MB] - Host-visible coherent staging memory
    uint32_t    MaxComputeWorkgroupThreads    = 0u;    // [threads] - limits.maxComputeWorkGroupInvocations
    uint32_t    MaxComputeSharedKilobytes     = 0u;    // [KB] - limits.maxComputeSharedMemorySize / 1024
    bool        GraphicsQueueSupported        = false; // [-] - VK_QUEUE_GRAPHICS_BIT
    bool        ComputeQueueSupported         = false; // [-] - VK_QUEUE_COMPUTE_BIT
    bool        TransferQueueSupported        = false; // [-] - VK_QUEUE_TRANSFER_BIT

    std::string AdapterName                   = "Headless Vulkan Verification Adapter";
    std::string AdapterCategoryLabel          = "Offscreen Verification";
    std::string VendorLabel                   = "Khronos";
    std::string FormattedApiVersion           = "1.3.0";
    std::string FormattedDriverVersion        = "N/A";
    std::string DriverName                    = "";
    std::string DriverInfo                    = "";
    std::string ConformanceVersion            = "";
    std::string SelectedTierLabel             = "GTX OrderedSoftwareBvh";
    std::string FallbackReasonLabel           = "None";
    std::string CompactHeaderBadge            = "Vulkan RHI";

    PathReplayRayQueryDeviceCapabilities RayQueryCapabilities{};
    PathReplayAccelerationSelection      TierSelection{};
};

//------------------------------------------------------------------------------------------------------------------------
//                                     VULKAN SHADER & COMPUTE PIPELINE SPECIFICATION
//------------------------------------------------------------------------------------------------------------------------

struct VulkanShaderProgramSpec
{
    const char *ShaderFilename        = "";   // [-] - Canonical Frontier .slang shader module name
    const char *StageAndWorkgroup     = "";   // [-] - Compute workgroup dimensions (e.g. "Compute 8x8x1")
    const char *SubsystemDescription  = "";   // [-] - Human-readable subsystem description for Logs & HUD
    uint32_t    LocalSizeX            = 8u;   // [threads] - GLCompute LocalSize X
    uint32_t    LocalSizeY            = 8u;   // [threads] - GLCompute LocalSize Y
    uint32_t    LocalSizeZ            = 1u;   // [threads] - GLCompute LocalSize Z
    uint32_t    StorageBindingCount   = 2u;   // [bindings] - Number of SSBO bindings in set 0
    uint32_t    PushConstantBytes     = 32u;  // [B] - Push constant block footprint (>= 16, <= 128)
    uint32_t    UnrollArithmeticSteps = 8u;   // [ops] - Distinct FMA chain depth so driver compiles unique ISA
    uint32_t    ConstantGainBits      = 0x3f820000u; // [-] - IEEE-754 float multiplier constant
    uint32_t    ConstantBiasBits      = 0x3c23d70au; // [-] - IEEE-754 float additive constant
};

struct VulkanShaderLogNotice
{
    LogSeverity Severity = LogSeverity::Info;
    std::string Source   = "VulkanShaderCompiler";
    std::string Message  = "";
    bool        IsDriver = false;
};

struct VulkanShaderProgressSnapshot
{
    uint32_t    CompletedPrograms     = 0u;    // [programs] - Compiled shader pipelines so far
    uint32_t    TotalPrograms         = 16u;   // [programs] - Total Frontier shader pipelines
    float       Progress01            = 0.0f;  // [0..1] - Normalized compilation progress
    bool        CompilationActive     = false; // [-] - True while background compiler is still running
    bool        CompilationFinished   = false; // [-] - True once all 16 pipelines finished
    bool        PipelineCacheWarmHit  = false; // [-] - True when disk VkPipelineCache pre-populated driver cache
    bool        RealVulkanPipelines   = false; // [-] - True when compiled via vkCreateComputePipelines on VkDevice
    double      TotalCompileMs        = 0.0;   // [ms] - Cumulative shader compilation wall-clock time
    size_t      PipelineCacheBytes    = 0u;    // [B] - Serialized VkPipelineCache byte size
    std::string CurrentShaderName     = "";
    std::string CurrentStageSummary   = "";
};

//------------------------------------------------------------------------------------------------------------------------
//                                       NON-BLOCKING VULKAN SHADER COMPILER
//------------------------------------------------------------------------------------------------------------------------

class VulkanShaderCompiler
{
  public:
    VulkanShaderCompiler();
    ~VulkanShaderCompiler();

    VulkanShaderCompiler(const VulkanShaderCompiler &)            = delete;
    VulkanShaderCompiler &operator=(const VulkanShaderCompiler &) = delete;

    // Inspects the live VulkanPresentation device (or probes headless libvulkan/vulkan-1.dll when BorrowedAccess == nullptr)
    // and queues structured [VulkanRHI] + [DriverCompat] diagnostic records for LogStreamPanel.
    const VulkanDriverCompatibilityReport &InspectDriverCompatibility(const VulkanRasterAccess *BorrowedAccess);

    // Starts non-blocking background compilation of all 16 Frontier SPIR-V compute pipelines (with persistent VkPipelineCache).
    void StartAsyncCompilation(const std::filesystem::path &CacheFilePath, uint32_t MinStepVisibilityDelayMs = 35u);

    // Executes synchronous compilation (used by deterministic CLI --verify-and-capture / --serve modes).
    void CompileAllSynchronously(const std::filesystem::path &CacheFilePath);

    // Joins any background compilation thread and destroys owned Vulkan shader/pipeline/cache handles before device teardown.
    void ShutdownAndReleaseGpuObjects() noexcept;

    // Drains newly emitted driver compatibility & shader compilation log lines onto the caller's vector (UI thread safe).
    void DrainPendingLogNotices(std::vector<VulkanShaderLogNotice> &OutNotices);

    [[nodiscard]] VulkanShaderProgressSnapshot           QueryProgress() const;
    [[nodiscard]] const VulkanDriverCompatibilityReport &DriverReport() const noexcept { return DriverReport_; }

    // Synthesizes a valid Khronos SPIR-V 1.0 GLCompute binary for the given Frontier shader program specification.
    [[nodiscard]] static std::vector<uint32_t> ConstructComputeSpirvWords(const VulkanShaderProgramSpec &Spec);

    // Validates SPIR-V header, version, bound IDs, and terminal OpFunctionEnd for unit/smoke verification.
    [[nodiscard]] static bool ValidateSpirvModuleWords(const std::vector<uint32_t> &Words) noexcept;

    [[nodiscard]] static const std::vector<VulkanShaderProgramSpec> &QueryProgramManifest();

  private:
    struct InternalVulkanState;

    void RunCompilationSequence(const std::filesystem::path &CacheFilePath, uint32_t MinStepVisibilityDelayMs);
    void PushLogNotice(LogSeverity Severity, const char *Source, std::string Message, bool IsDriver = false);

    VulkanDriverCompatibilityReport      DriverReport_{};
    std::unique_ptr<InternalVulkanState> VkState_;

    mutable std::mutex                   StateMutex_;
    VulkanShaderProgressSnapshot         Progress_{};
    std::vector<VulkanShaderLogNotice>   PendingNotices_;
    std::thread                          WorkerThread_;
    bool                                 StopRequested_ = false;
};

} // namespace Frontier::Drive
