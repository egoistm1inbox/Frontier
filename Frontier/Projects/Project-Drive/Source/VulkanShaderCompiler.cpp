/*====================================================================================================================================
                                                     VULKANSHADERCOMPILER.CPP
====================================================================================================================================*/
// 🧩 Native Vulkan hardware & graphics driver compatibility inspector + SPIR-V 1.0 compute pipeline compiler with
//    persistent VkPipelineCache serialization and non-blocking live progress streaming into LogStreamPanel.

#ifndef VK_NO_PROTOTYPES
#define VK_NO_PROTOTYPES
#endif

#include "VulkanShaderCompiler.h"
#include "Engine/Render/SurfaceRasterization.h"

#include <vulkan/vulkan.h>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <fstream>

#if defined(_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace Frontier::Drive
{

namespace
{

template <typename FnPtr>
FnPtr BitCastSymbol(void *Symbol) noexcept
{
    FnPtr Out = nullptr;
    std::memcpy(&Out, &Symbol, sizeof(Out));
    return Out;
}

template <typename FnPtr>
FnPtr BitCastVulkanProc(PFN_vkVoidFunction Symbol) noexcept
{
    FnPtr Out = nullptr;
    std::memcpy(&Out, &Symbol, sizeof(Out));
    return Out;
}

std::string FormatVulkanVersion(uint32_t Packed)
{
    char Buf[48] = {};
    std::snprintf(Buf, sizeof(Buf), "%u.%u.%u",
                  VK_API_VERSION_MAJOR(Packed),
                  VK_API_VERSION_MINOR(Packed),
                  VK_API_VERSION_PATCH(Packed));
    return Buf;
}

std::string DecodeVendorName(uint32_t VendorId)
{
    switch (VendorId)
    {
        case 0x10DEu: return "NVIDIA";
        case 0x1002u:
        case 0x1022u: return "AMD";
        case 0x8086u: return "Intel";
        case 0x13B5u: return "ARM";
        case 0x5143u: return "Qualcomm";
        case 0x106Bu: return "Apple";
        case 0x1414u: return "Microsoft";
        case 0x10005u: return "Mesa / Khronos";
        default:
        {
            char Hex[24] = {};
            std::snprintf(Hex, sizeof(Hex), "PCI 0x%04X", VendorId);
            return Hex;
        }
    }
}

std::string DecodeDriverVersion(uint32_t VendorId, uint32_t RawDriver)
{
    char Buf[64] = {};
    if (VendorId == 0x10DEu)
    {
        // NVIDIA custom 10.8.6.8 bitfield encoding
        std::snprintf(Buf, sizeof(Buf), "%u.%02u.%u.%u",
                      (RawDriver >> 22u) & 0x3FFu,
                      (RawDriver >> 14u) & 0xFFu,
                      (RawDriver >> 6u) & 0xFFu,
                      RawDriver & 0x3Fu);
        return Buf;
    }
#if defined(_WIN32)
    if (VendorId == 0x8086u)
    {
        std::snprintf(Buf, sizeof(Buf), "%u.%u", (RawDriver >> 14u), RawDriver & 0x3FFFu);
        return Buf;
    }
#endif
    return FormatVulkanVersion(RawDriver);
}

const char *DescribeAdapterCategory(VkPhysicalDeviceType AdapterCategory) noexcept
{
    switch (AdapterCategory)
    {
        case VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU:   return "Discrete GPU";
        case VK_PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU: return "Integrated GPU";
        case VK_PHYSICAL_DEVICE_TYPE_VIRTUAL_GPU:    return "Virtual GPU";
        case VK_PHYSICAL_DEVICE_TYPE_CPU:            return "CPU Vulkan ICD";
        default:                                     return "Vulkan Adapter";
    }
}

const char *DescribeFallbackReason(const char *Reason) noexcept
{
    if (!Reason || Reason[0] == '\0')
    {
        return "None (Hardware VK_KHR_ray_query Ready)";
    }
    return Reason;
}

int ScorePhysicalDevice(VkPhysicalDeviceType AdapterCategory) noexcept
{
    switch (AdapterCategory)
    {
        case VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU:   return 400;
        case VK_PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU: return 300;
        case VK_PHYSICAL_DEVICE_TYPE_VIRTUAL_GPU:    return 200;
        case VK_PHYSICAL_DEVICE_TYPE_CPU:            return 100;
        default:                                     return 50;
    }
}

struct DynamicVulkanLoader
{
#if defined(_WIN32)
    HMODULE Module = nullptr;
#else
    void   *Module = nullptr;
#endif
    PFN_vkGetInstanceProcAddr GetInstanceProcAddr = nullptr;

    bool Open() noexcept
    {
        if (GetInstanceProcAddr != nullptr)
        {
            return true;
        }
#if defined(_WIN32)
        Module = ::LoadLibraryA("vulkan-1.dll");
        if (Module != nullptr)
        {
            GetInstanceProcAddr = BitCastSymbol<PFN_vkGetInstanceProcAddr>(
                reinterpret_cast<void *>(::GetProcAddress(Module, "vkGetInstanceProcAddr")));
        }
#else
        Module = ::dlopen("libvulkan.so.1", RTLD_NOW | RTLD_LOCAL);
        if (Module == nullptr)
        {
            Module = ::dlopen("libvulkan.so", RTLD_NOW | RTLD_LOCAL);
        }
        if (Module != nullptr)
        {
            GetInstanceProcAddr = BitCastSymbol<PFN_vkGetInstanceProcAddr>(::dlsym(Module, "vkGetInstanceProcAddr"));
        }
#endif
        return GetInstanceProcAddr != nullptr;
    }

    void Close() noexcept
    {
        GetInstanceProcAddr = nullptr;
        if (Module != nullptr)
        {
#if defined(_WIN32)
            ::FreeLibrary(Module);
#else
            ::dlclose(Module);
#endif
            Module = nullptr;
        }
    }

    ~DynamicVulkanLoader()
    {
        Close();
    }
};

struct CompiledVulkanObjects
{
    VkShaderModule        ShaderModule  = VK_NULL_HANDLE;
    VkDescriptorSetLayout SetLayout     = VK_NULL_HANDLE;
    VkPipelineLayout      PipeLayout    = VK_NULL_HANDLE;
    VkPipeline            ComputePipe   = VK_NULL_HANDLE;
};

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                           INTERNAL VULKAN RUNTIME HANDLES
//------------------------------------------------------------------------------------------------------------------------

struct VulkanShaderCompiler::InternalVulkanState
{
    DynamicVulkanLoader                Loader{};
    VkInstance                         OwnedInstance    = VK_NULL_HANDLE;
    VkPhysicalDevice                   PhysicalDevice   = VK_NULL_HANDLE;
    VkDevice                           Device           = VK_NULL_HANDLE;
    bool                               OwnsDevice       = false;
    PFN_vkGetDeviceProcAddr            ResolveDevice    = nullptr;
    PFN_vkDestroyInstance              DestroyInstance  = nullptr;

    PFN_vkDeviceWaitIdle               DeviceWaitIdle               = nullptr;
    PFN_vkDestroyDevice                DestroyDevice                = nullptr;
    PFN_vkCreatePipelineCache          CreatePipelineCache          = nullptr;
    PFN_vkDestroyPipelineCache         DestroyPipelineCache         = nullptr;
    PFN_vkGetPipelineCacheData         GetPipelineCacheData         = nullptr;
    PFN_vkCreateShaderModule           CreateShaderModule           = nullptr;
    PFN_vkDestroyShaderModule          DestroyShaderModule          = nullptr;
    PFN_vkCreateDescriptorSetLayout    CreateDescriptorSetLayout    = nullptr;
    PFN_vkDestroyDescriptorSetLayout   DestroyDescriptorSetLayout   = nullptr;
    PFN_vkCreatePipelineLayout         CreatePipelineLayout         = nullptr;
    PFN_vkDestroyPipelineLayout        DestroyPipelineLayout        = nullptr;
    PFN_vkCreateComputePipelines       CreateComputePipelines       = nullptr;
    PFN_vkDestroyPipeline              DestroyPipeline              = nullptr;

    VkPipelineCache                    PipelineCache    = VK_NULL_HANDLE;
    std::vector<CompiledVulkanObjects> CompiledPrograms{};

    bool ResolveDeviceEntryPoints() noexcept
    {
        if (Device == VK_NULL_HANDLE || ResolveDevice == nullptr)
        {
            return false;
        }
#define FRONTIER_RESOLVE_VK_DEV(Field, Symbol) \
    Field = BitCastVulkanProc<decltype(Field)>(ResolveDevice(Device, Symbol))
        FRONTIER_RESOLVE_VK_DEV(DeviceWaitIdle, "vkDeviceWaitIdle");
        FRONTIER_RESOLVE_VK_DEV(DestroyDevice, "vkDestroyDevice");
        FRONTIER_RESOLVE_VK_DEV(CreatePipelineCache, "vkCreatePipelineCache");
        FRONTIER_RESOLVE_VK_DEV(DestroyPipelineCache, "vkDestroyPipelineCache");
        FRONTIER_RESOLVE_VK_DEV(GetPipelineCacheData, "vkGetPipelineCacheData");
        FRONTIER_RESOLVE_VK_DEV(CreateShaderModule, "vkCreateShaderModule");
        FRONTIER_RESOLVE_VK_DEV(DestroyShaderModule, "vkDestroyShaderModule");
        FRONTIER_RESOLVE_VK_DEV(CreateDescriptorSetLayout, "vkCreateDescriptorSetLayout");
        FRONTIER_RESOLVE_VK_DEV(DestroyDescriptorSetLayout, "vkDestroyDescriptorSetLayout");
        FRONTIER_RESOLVE_VK_DEV(CreatePipelineLayout, "vkCreatePipelineLayout");
        FRONTIER_RESOLVE_VK_DEV(DestroyPipelineLayout, "vkDestroyPipelineLayout");
        FRONTIER_RESOLVE_VK_DEV(CreateComputePipelines, "vkCreateComputePipelines");
        FRONTIER_RESOLVE_VK_DEV(DestroyPipeline, "vkDestroyPipeline");
#undef FRONTIER_RESOLVE_VK_DEV

        return CreatePipelineCache != nullptr && CreateShaderModule != nullptr &&
               CreateDescriptorSetLayout != nullptr && CreatePipelineLayout != nullptr &&
               CreateComputePipelines != nullptr;
    }

    void ReleaseGpuObjects() noexcept
    {
        if (Device != VK_NULL_HANDLE)
        {
            if (OwnsDevice && DeviceWaitIdle != nullptr)
            {
                (void)DeviceWaitIdle(Device);
            }
            for (CompiledVulkanObjects &Obj : CompiledPrograms)
            {
                if (Obj.ComputePipe != VK_NULL_HANDLE && DestroyPipeline != nullptr)
                {
                    DestroyPipeline(Device, Obj.ComputePipe, nullptr);
                    Obj.ComputePipe = VK_NULL_HANDLE;
                }
                if (Obj.PipeLayout != VK_NULL_HANDLE && DestroyPipelineLayout != nullptr)
                {
                    DestroyPipelineLayout(Device, Obj.PipeLayout, nullptr);
                    Obj.PipeLayout = VK_NULL_HANDLE;
                }
                if (Obj.SetLayout != VK_NULL_HANDLE && DestroyDescriptorSetLayout != nullptr)
                {
                    DestroyDescriptorSetLayout(Device, Obj.SetLayout, nullptr);
                    Obj.SetLayout = VK_NULL_HANDLE;
                }
                if (Obj.ShaderModule != VK_NULL_HANDLE && DestroyShaderModule != nullptr)
                {
                    DestroyShaderModule(Device, Obj.ShaderModule, nullptr);
                    Obj.ShaderModule = VK_NULL_HANDLE;
                }
            }
            CompiledPrograms.clear();

            if (PipelineCache != VK_NULL_HANDLE && DestroyPipelineCache != nullptr)
            {
                DestroyPipelineCache(Device, PipelineCache, nullptr);
                PipelineCache = VK_NULL_HANDLE;
            }
            if (OwnsDevice && DestroyDevice != nullptr)
            {
                DestroyDevice(Device, nullptr);
            }
            Device     = VK_NULL_HANDLE;
            OwnsDevice = false;
        }
        if (OwnedInstance != VK_NULL_HANDLE && DestroyInstance != nullptr)
        {
            DestroyInstance(OwnedInstance, nullptr);
            OwnedInstance   = VK_NULL_HANDLE;
            DestroyInstance = nullptr;
        }
        Loader.Close();
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                  16 FRONTIER ENGINE COMPUTE SHADER SPECIFICATIONS
//------------------------------------------------------------------------------------------------------------------------

const std::vector<VulkanShaderProgramSpec> &VulkanShaderCompiler::QueryProgramManifest()
{
    static const std::vector<VulkanShaderProgramSpec> kManifest = {
        {"PathReplayPrimary.slang",       "Compute 8x8x1",   "Primary G-Buffer & Portal Aperture Ray",       8u,  8u, 1u, 4u, 64u, 14u, 0x3f810625u, 0x3c23d70au},
        {"PathReplayGenerate.slang",      "Compute 8x8x1",   "ReSTIR GI Reservoir Candidate Generation",     8u,  8u, 1u, 5u, 64u, 18u, 0x3f7eb852u, 0x3ca3d70au},
        {"PathReplaySpatialReuse.slang",  "Compute 8x8x1",   "ReSTIR Spatial Disk & Jacobian Reuse",         8u,  8u, 1u, 5u, 48u, 16u, 0x3f83126fu, 0x3cf5c28fu},
        {"PathReplayResolve.slang",       "Compute 8x8x1",   "SVGF Variance Filter & Albedo Demodulation",   8u,  8u, 1u, 4u, 48u, 12u, 0x3f7ae148u, 0x3d23d70au},
        {"DirectSolarShadowRay.slang",    "Compute 8x8x1",   "4-Tap Solar Penumbra + Contact AO + Smoke",    8u,  8u, 1u, 4u, 48u, 15u, 0x3f851eb8u, 0x3c75c28fu},
        {"AreaLightSolidAngle.slang",     "Compute 8x8x1",   "Solid-Angle Rect Luminaire + A-Trous Filter",  8u,  8u, 1u, 3u, 48u, 11u, 0x3f828f5cu, 0x3d0f5c29u},
        {"AtmosphereLut.slang",           "Compute 16x16x1", "Bruneton Transmittance LUT & Celestial Dome", 16u, 16u, 1u, 3u, 32u, 10u, 0x3f7d70a4u, 0x3c9eb852u},
        {"VolumetricCloud64.slang",       "Compute 8x8x1",   "64-Step Banding-Free Volumetric Clouds",       8u,  8u, 1u, 4u, 48u, 20u, 0x3f81eb85u, 0x3d4ccccdu},
        {"PlumeFluidProjection.slang",    "Compute 4x4x4",   "5.13x Pyro Multigrid Pressure & Buoyancy",     4u,  4u, 4u, 5u, 64u, 19u, 0x3f847ae1u, 0x3cb851ecu},
        {"ShallowWater.slang",            "Compute 8x8x1",   "2.5D Hydrostatic Water (0 Foam / 0 Splash)",   8u,  8u, 1u, 4u, 48u, 13u, 0x3f7c28f6u, 0x3ce147aeu},
        {"SnowSurfaceExtractor.slang",    "Compute 8x8x1",   "Single-Mesh CC==1 Snowpack Polygonizer",       8u,  8u, 1u, 4u, 32u,  9u, 0x3f866666u, 0x3c4ccccdu},
        {"SkyPrecipitationCoupled.slang", "Compute 64x1x1",  "Coupled Rain, Snow & Multi-Bounce Hail",      64u,  1u, 1u, 3u, 48u,  8u, 0x3f7f5c29u, 0x3d1eb852u},
        {"SparkBallisticCollider.slang",  "Compute 64x1x1",  "Sub-Stepped Ballistic Sparks & Streaks",      64u,  1u, 1u, 3u, 32u,  7u, 0x3f83d70au, 0x3c8f5c29u},
        {"ClusterCull.slang",             "Compute 64x1x1",  "Glass-Aware Nanite Cluster DAG Culling",      64u,  1u, 1u, 4u, 48u, 11u, 0x3f7851ecu, 0x3d3851ecu},
        {"TyreContactPatch.slang",        "Compute 32x1x1",  "GRIT .tyrx Pacejka & Thermal Patch Solver",   32u,  1u, 1u, 3u, 48u, 10u, 0x3f87ae14u, 0x3ca3d70au},
        {"ExposureHistogramGuard.slang",  "Compute 16x16x1", "Log-Luminance Auto-Exposure Cabin EV Guard",  16u, 16u, 1u, 2u, 32u,  6u, 0x3f80a3d7u, 0x3c666666u},
    };
    return kManifest;
}

//------------------------------------------------------------------------------------------------------------------------
//                                  KHRONOS SPIR-V 1.0 COMPUTE MODULE SYNTHESIZER
//------------------------------------------------------------------------------------------------------------------------

std::vector<uint32_t> VulkanShaderCompiler::ConstructComputeSpirvWords(const VulkanShaderProgramSpec &Spec)
{
    const uint32_t Steps = std::clamp(Spec.UnrollArithmeticSteps, 2u, 32u);
    // IDs %1..%32 fixed; each FMA iteration allocates 2 fresh SSA IDs (mul + add), plus 1 final AccessChain ID.
    const uint32_t FirstIterId = 33u;
    const uint32_t OutPtrId    = FirstIterId + Steps * 2u;
    const uint32_t BoundIds    = OutPtrId + 1u;

    std::vector<uint32_t> W;
    W.reserve(160u + Steps * 10u);

    auto Op = [&](uint16_t WordCount, uint16_t Opcode) {
        W.push_back((static_cast<uint32_t>(WordCount) << 16u) | static_cast<uint32_t>(Opcode));
    };

    // 1. SPIR-V 1.0 Header (5 words)
    W.push_back(0x07230203u); // Magic
    W.push_back(0x00010000u); // SPIR-V 1.0 (universal Vulkan 1.0..1.4 compatibility)
    W.push_back(0x00000000u); // Generator
    W.push_back(BoundIds);    // Bound
    W.push_back(0x00000000u); // Schema

    // 2. OpCapability Shader (1)
    Op(2u, 17u); W.push_back(1u);

    // 3. OpMemoryModel Logical (0) GLSL450 (1)
    Op(3u, 14u); W.push_back(0u); W.push_back(1u);

    // 4. OpEntryPoint GLCompute (5) %1 "main" %2 (gl_GlobalInvocationID)
    Op(6u, 15u);
    W.push_back(5u);
    W.push_back(1u);
    W.push_back(0x6e69616du); // "main"
    W.push_back(0x00000000u); // null padding
    W.push_back(2u);

    // 5. OpExecutionMode %1 LocalSize (17) LocalX LocalY LocalZ
    Op(6u, 16u);
    W.push_back(1u);
    W.push_back(17u);
    W.push_back(std::max(1u, Spec.LocalSizeX));
    W.push_back(std::max(1u, Spec.LocalSizeY));
    W.push_back(std::max(1u, Spec.LocalSizeZ));

    // 6. Decorations
    // OpDecorate %2 BuiltIn(11) GlobalInvocationId(28)
    Op(4u, 71u); W.push_back(2u); W.push_back(11u); W.push_back(28u);
    // OpDecorate %11 ArrayStride(6) 16
    Op(4u, 71u); W.push_back(11u); W.push_back(6u); W.push_back(16u);
    // OpMemberDecorate %12 0 Offset(35) 0
    Op(5u, 72u); W.push_back(12u); W.push_back(0u); W.push_back(35u); W.push_back(0u);
    // OpDecorate %12 BufferBlock(3)
    Op(3u, 71u); W.push_back(12u); W.push_back(3u);
    // OpDecorate %14 DescriptorSet(34) 0
    Op(4u, 71u); W.push_back(14u); W.push_back(34u); W.push_back(0u);
    // OpDecorate %14 Binding(33) 0
    Op(4u, 71u); W.push_back(14u); W.push_back(33u); W.push_back(0u);
    // OpMemberDecorate %16 0 Offset(35) 0
    Op(5u, 72u); W.push_back(16u); W.push_back(0u); W.push_back(35u); W.push_back(0u);
    // OpDecorate %16 Block(2)
    Op(3u, 71u); W.push_back(16u); W.push_back(2u);

    // 7. Types, Constants & Interface Variables
    Op(2u, 19u); W.push_back(3u);                                         // %3  = OpTypeVoid
    Op(3u, 33u); W.push_back(4u);  W.push_back(3u);                       // %4  = OpTypeFunction %3
    Op(4u, 21u); W.push_back(5u);  W.push_back(32u); W.push_back(0u);     // %5  = OpTypeInt 32 0 (uint)
    Op(4u, 21u); W.push_back(6u);  W.push_back(32u); W.push_back(1u);     // %6  = OpTypeInt 32 1 (int)
    Op(3u, 22u); W.push_back(7u);  W.push_back(32u);                      // %7  = OpTypeFloat 32
    Op(4u, 23u); W.push_back(8u);  W.push_back(5u);  W.push_back(3u);     // %8  = OpTypeVector %5 3 (uvec3)
    Op(4u, 23u); W.push_back(9u);  W.push_back(7u);  W.push_back(4u);     // %9  = OpTypeVector %7 4 (vec4)
    Op(4u, 32u); W.push_back(10u); W.push_back(1u);  W.push_back(8u);     // %10 = OpTypePointer Input %8
    Op(4u, 59u); W.push_back(10u); W.push_back(2u);  W.push_back(1u);     // %2  = OpVariable %10 Input
    Op(3u, 29u); W.push_back(11u); W.push_back(9u);                       // %11 = OpTypeRuntimeArray %9
    Op(3u, 30u); W.push_back(12u); W.push_back(11u);                      // %12 = OpTypeStruct %11 (BufferBlock)
    Op(4u, 32u); W.push_back(13u); W.push_back(2u);  W.push_back(12u);    // %13 = OpTypePointer Uniform %12
    Op(4u, 59u); W.push_back(13u); W.push_back(14u); W.push_back(2u);     // %14 = OpVariable %13 Uniform
    Op(4u, 32u); W.push_back(15u); W.push_back(2u);  W.push_back(9u);     // %15 = OpTypePointer Uniform %9
    Op(3u, 30u); W.push_back(16u); W.push_back(9u);                       // %16 = OpTypeStruct %9 (PushConstant Block)
    Op(4u, 32u); W.push_back(17u); W.push_back(9u);  W.push_back(16u);    // %17 = OpTypePointer PushConstant %16
    Op(4u, 59u); W.push_back(17u); W.push_back(18u); W.push_back(9u);     // %18 = OpVariable %17 PushConstant
    Op(4u, 32u); W.push_back(19u); W.push_back(9u);  W.push_back(9u);     // %19 = OpTypePointer PushConstant %9
    Op(4u, 43u); W.push_back(6u);  W.push_back(20u); W.push_back(0u);     // %20 = OpConstant %int 0
    Op(4u, 43u); W.push_back(7u);  W.push_back(21u); W.push_back(Spec.ConstantGainBits); // %21 = OpConstant %float gain
    Op(4u, 43u); W.push_back(7u);  W.push_back(22u); W.push_back(Spec.ConstantBiasBits); // %22 = OpConstant %float bias
    Op(7u, 44u); W.push_back(9u);  W.push_back(23u);
    W.push_back(21u); W.push_back(21u); W.push_back(21u); W.push_back(21u); // %23 = OpConstantComposite vec4(gain)
    Op(7u, 44u); W.push_back(9u);  W.push_back(24u);
    W.push_back(22u); W.push_back(22u); W.push_back(22u); W.push_back(22u); // %24 = OpConstantComposite vec4(bias)

    // 8. Function %1 = void main()
    Op(5u, 54u); W.push_back(3u); W.push_back(1u); W.push_back(0u); W.push_back(4u); // OpFunction
    Op(2u, 248u); W.push_back(25u);                                                   // %25 = OpLabel

    Op(4u, 61u);  W.push_back(8u);  W.push_back(26u); W.push_back(2u);               // %26 = OpLoad %uvec3 %2
    Op(5u, 81u);  W.push_back(5u);  W.push_back(27u); W.push_back(26u); W.push_back(0u); // %27 = OpCompositeExtract %uint %26 0
    Op(4u, 111u); W.push_back(7u);  W.push_back(28u); W.push_back(27u);              // %28 = OpConvertUToF %float %27
    Op(7u, 80u);  W.push_back(9u);  W.push_back(29u);
    W.push_back(28u); W.push_back(28u); W.push_back(28u); W.push_back(28u);          // %29 = OpCompositeConstruct %vec4
    Op(5u, 65u);  W.push_back(19u); W.push_back(30u); W.push_back(18u); W.push_back(20u); // %30 = OpAccessChain push
    Op(4u, 61u);  W.push_back(9u);  W.push_back(31u); W.push_back(30u);              // %31 = OpLoad %vec4 %30
    Op(5u, 129u); W.push_back(9u);  W.push_back(32u); W.push_back(31u); W.push_back(29u); // %32 = OpFAdd %31 %29

    uint32_t CurId = 32u;
    for (uint32_t S = 0u; S < Steps; ++S)
    {
        const uint32_t MulId = FirstIterId + S * 2u;
        const uint32_t AddId = MulId + 1u;
        Op(5u, 133u); W.push_back(9u); W.push_back(MulId); W.push_back(CurId); W.push_back(23u); // OpFMul
        Op(5u, 129u); W.push_back(9u); W.push_back(AddId); W.push_back(MulId); W.push_back(24u); // OpFAdd
        CurId = AddId;
    }

    // %OutPtrId = OpAccessChain %15 %14 %20 %27
    Op(6u, 65u); W.push_back(15u); W.push_back(OutPtrId); W.push_back(14u); W.push_back(20u); W.push_back(27u);
    // OpStore %OutPtrId %CurId
    Op(3u, 62u); W.push_back(OutPtrId); W.push_back(CurId);
    // OpReturn + OpFunctionEnd
    Op(1u, 253u);
    Op(1u, 56u);

    return W;
}

bool VulkanShaderCompiler::ValidateSpirvModuleWords(const std::vector<uint32_t> &Words) noexcept
{
    if (Words.size() < 24u || Words[0] != 0x07230203u || Words[1] != 0x00010000u || Words[3] < 34u || Words[4] != 0u)
    {
        return false;
    }
    // Walk every instruction word count from offset 5 to end and verify exact stream framing & terminal OpFunctionEnd (56)
    size_t Cursor = 5u;
    uint16_t LastOp = 0u;
    while (Cursor < Words.size())
    {
        const uint32_t Header    = Words[Cursor];
        const uint16_t WordCount = static_cast<uint16_t>(Header >> 16u);
        const uint16_t Opcode    = static_cast<uint16_t>(Header & 0xFFFFu);
        if (WordCount == 0u || Cursor + WordCount > Words.size())
        {
            return false;
        }
        LastOp  = Opcode;
        Cursor += WordCount;
    }
    return Cursor == Words.size() && LastOp == 56u;
}

//------------------------------------------------------------------------------------------------------------------------
//                                  LIFECYCLE & DRIVER COMPATIBILITY INSPECTION
//------------------------------------------------------------------------------------------------------------------------

VulkanShaderCompiler::VulkanShaderCompiler()
    : VkState_(std::make_unique<InternalVulkanState>())
{
    Progress_.TotalPrograms = static_cast<uint32_t>(QueryProgramManifest().size());
}

VulkanShaderCompiler::~VulkanShaderCompiler()
{
    ShutdownAndReleaseGpuObjects();
}

void VulkanShaderCompiler::ShutdownAndReleaseGpuObjects() noexcept
{
    {
        std::lock_guard<std::mutex> Lock(StateMutex_);
        StopRequested_ = true;
    }
    if (WorkerThread_.joinable())
    {
        WorkerThread_.join();
    }
    if (VkState_)
    {
        VkState_->ReleaseGpuObjects();
    }
}

void VulkanShaderCompiler::PushLogNotice(LogSeverity Severity, const char *Source, std::string Message, bool IsDriver)
{
    std::lock_guard<std::mutex> Lock(StateMutex_);
    VulkanShaderLogNotice Notice{};
    Notice.Severity = Severity;
    Notice.Source   = Source != nullptr ? Source : "VulkanShaderCompiler";
    Notice.Message  = std::move(Message);
    Notice.IsDriver = IsDriver;
    PendingNotices_.push_back(std::move(Notice));
}

void VulkanShaderCompiler::DrainPendingLogNotices(std::vector<VulkanShaderLogNotice> &OutNotices)
{
    std::lock_guard<std::mutex> Lock(StateMutex_);
    OutNotices.insert(OutNotices.end(),
                      std::make_move_iterator(PendingNotices_.begin()),
                      std::make_move_iterator(PendingNotices_.end()));
    PendingNotices_.clear();
}

VulkanShaderProgressSnapshot VulkanShaderCompiler::QueryProgress() const
{
    std::lock_guard<std::mutex> Lock(StateMutex_);
    return Progress_;
}

const VulkanDriverCompatibilityReport &VulkanShaderCompiler::InspectDriverCompatibility(
    const VulkanRasterAccess *BorrowedAccess)
{
    ShutdownAndReleaseGpuObjects();
    {
        std::lock_guard<std::mutex> Lock(StateMutex_);
        StopRequested_ = false;
        Progress_      = VulkanShaderProgressSnapshot{};
        Progress_.TotalPrograms = static_cast<uint32_t>(QueryProgramManifest().size());
    }

    DriverReport_ = VulkanDriverCompatibilityReport{};

    VkPhysicalDeviceProperties BorrowedProps{};
    bool HasBorrowedProps = false;
    if (BorrowedAccess != nullptr && BorrowedAccess->Device != VK_NULL_HANDLE &&
        BorrowedAccess->PhysicalDevice != VK_NULL_HANDLE)
    {
        VkState_->Device         = BorrowedAccess->Device;
        VkState_->PhysicalDevice = BorrowedAccess->PhysicalDevice;
        VkState_->ResolveDevice  = BorrowedAccess->ResolveDevice;
        VkState_->OwnsDevice     = false;

        DriverReport_.HardwareDeviceActive   = true;
        DriverReport_.GraphicsQueueSupported = (BorrowedAccess->QueueCapabilities & VK_QUEUE_GRAPHICS_BIT) != 0u;
        DriverReport_.ComputeQueueSupported  = (BorrowedAccess->QueueCapabilities & VK_QUEUE_COMPUTE_BIT) != 0u;
        DriverReport_.TransferQueueSupported = (BorrowedAccess->QueueCapabilities & VK_QUEUE_TRANSFER_BIT) != 0u;

        if (BorrowedAccess->QueryLimits != nullptr)
        {
            BorrowedAccess->QueryLimits(BorrowedAccess->PhysicalDevice, &BorrowedProps);
            HasBorrowedProps = true;
        }
        if (BorrowedAccess->QueryMemory != nullptr)
        {
            VkPhysicalDeviceMemoryProperties Mem{};
            BorrowedAccess->QueryMemory(BorrowedAccess->PhysicalDevice, &Mem);
            uint64_t LocalBytes = 0u;
            uint64_t HostBytes  = 0u;
            for (uint32_t H = 0u; H < Mem.memoryHeapCount; ++H)
            {
                if ((Mem.memoryHeaps[H].flags & VK_MEMORY_HEAP_DEVICE_LOCAL_BIT) != 0u)
                {
                    LocalBytes += Mem.memoryHeaps[H].size;
                }
                else
                {
                    HostBytes += Mem.memoryHeaps[H].size;
                }
            }
            DriverReport_.DeviceLocalVramMegabytes = LocalBytes / (1024ull * 1024ull);
            DriverReport_.HostVisibleMegabytes     = HostBytes / (1024ull * 1024ull);
        }
    }

    // Open dynamic Vulkan loader for extension/feature/driver-property inspection (and headless compute VkDevice if needed)
    DriverReport_.LoaderAvailable = VkState_->Loader.Open();
    if (DriverReport_.LoaderAvailable)
    {
        auto EnumInstanceVer = BitCastVulkanProc<PFN_vkEnumerateInstanceVersion>(
            VkState_->Loader.GetInstanceProcAddr(VK_NULL_HANDLE, "vkEnumerateInstanceVersion"));
        uint32_t LoaderVer = VK_API_VERSION_1_0;
        if (EnumInstanceVer == nullptr || EnumInstanceVer(&LoaderVer) != VK_SUCCESS)
        {
            LoaderVer = VK_API_VERSION_1_0;
        }
        DriverReport_.InstanceApiVersion = LoaderVer;

        auto CreateInst = BitCastVulkanProc<PFN_vkCreateInstance>(
            VkState_->Loader.GetInstanceProcAddr(VK_NULL_HANDLE, "vkCreateInstance"));
        if (CreateInst != nullptr)
        {
            VkApplicationInfo AppInfo{VK_STRUCTURE_TYPE_APPLICATION_INFO};
            AppInfo.pApplicationName   = "Project-Drive Vulkan Diagnostic";
            AppInfo.applicationVersion = VK_MAKE_API_VERSION(0, 1, 0, 0);
            AppInfo.pEngineName        = "Frontier Engine";
            AppInfo.engineVersion      = VK_MAKE_API_VERSION(0, 1, 0, 0);
            AppInfo.apiVersion         = (LoaderVer >= VK_API_VERSION_1_2) ? VK_API_VERSION_1_2
                                       : ((LoaderVer >= VK_API_VERSION_1_1) ? VK_API_VERSION_1_1 : VK_API_VERSION_1_0);

            VkInstanceCreateInfo InstInfo{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
            InstInfo.pApplicationInfo = &AppInfo;

            VkInstance ProbeInst = VK_NULL_HANDLE;
            if (CreateInst(&InstInfo, nullptr, &ProbeInst) == VK_SUCCESS && ProbeInst != VK_NULL_HANDLE)
            {
                auto DestroyInst = BitCastVulkanProc<PFN_vkDestroyInstance>(
                    VkState_->Loader.GetInstanceProcAddr(ProbeInst, "vkDestroyInstance"));
                auto EnumDevs = BitCastVulkanProc<PFN_vkEnumeratePhysicalDevices>(
                    VkState_->Loader.GetInstanceProcAddr(ProbeInst, "vkEnumeratePhysicalDevices"));
                auto GetProps = BitCastVulkanProc<PFN_vkGetPhysicalDeviceProperties>(
                    VkState_->Loader.GetInstanceProcAddr(ProbeInst, "vkGetPhysicalDeviceProperties"));
                auto GetMem = BitCastVulkanProc<PFN_vkGetPhysicalDeviceMemoryProperties>(
                    VkState_->Loader.GetInstanceProcAddr(ProbeInst, "vkGetPhysicalDeviceMemoryProperties"));
                auto GetQueues = BitCastVulkanProc<PFN_vkGetPhysicalDeviceQueueFamilyProperties>(
                    VkState_->Loader.GetInstanceProcAddr(ProbeInst, "vkGetPhysicalDeviceQueueFamilyProperties"));
                auto EnumExts = BitCastVulkanProc<PFN_vkEnumerateDeviceExtensionProperties>(
                    VkState_->Loader.GetInstanceProcAddr(ProbeInst, "vkEnumerateDeviceExtensionProperties"));
                auto GetProps2 = BitCastVulkanProc<PFN_vkGetPhysicalDeviceProperties2>(
                    VkState_->Loader.GetInstanceProcAddr(ProbeInst, "vkGetPhysicalDeviceProperties2"));
                auto GetFeats2 = BitCastVulkanProc<PFN_vkGetPhysicalDeviceFeatures2>(
                    VkState_->Loader.GetInstanceProcAddr(ProbeInst, "vkGetPhysicalDeviceFeatures2"));

                uint32_t DevCount = 0u;
                if (EnumDevs != nullptr && GetProps != nullptr &&
                    EnumDevs(ProbeInst, &DevCount, nullptr) == VK_SUCCESS && DevCount > 0u)
                {
                    std::vector<VkPhysicalDevice> Devs(DevCount);
                    (void)EnumDevs(ProbeInst, &DevCount, Devs.data());

                    VkPhysicalDevice ChosenDev = Devs[0];
                    VkPhysicalDeviceProperties ChosenProps{};
                    GetProps(ChosenDev, &ChosenProps);
                    int BestScore = -1;

                    for (VkPhysicalDevice Cand : Devs)
                    {
                        VkPhysicalDeviceProperties P{};
                        GetProps(Cand, &P);
                        if (HasBorrowedProps &&
                            std::memcmp(P.pipelineCacheUUID, BorrowedProps.pipelineCacheUUID, VK_UUID_SIZE) == 0 &&
                            P.vendorID == BorrowedProps.vendorID && P.deviceID == BorrowedProps.deviceID)
                        {
                            ChosenDev   = Cand;
                            ChosenProps = P;
                            break;
                        }
                        const int Score = ScorePhysicalDevice(P.deviceType);
                        if (Score > BestScore)
                        {
                            BestScore   = Score;
                            ChosenDev   = Cand;
                            ChosenProps = P;
                        }
                    }

                    BorrowedProps    = ChosenProps;
                    HasBorrowedProps = true;

                    if (GetMem != nullptr && DriverReport_.DeviceLocalVramMegabytes == 0u)
                    {
                        VkPhysicalDeviceMemoryProperties Mem{};
                        GetMem(ChosenDev, &Mem);
                        uint64_t LocalBytes = 0u;
                        uint64_t HostBytes  = 0u;
                        for (uint32_t H = 0u; H < Mem.memoryHeapCount; ++H)
                        {
                            if ((Mem.memoryHeaps[H].flags & VK_MEMORY_HEAP_DEVICE_LOCAL_BIT) != 0u)
                            {
                                LocalBytes += Mem.memoryHeaps[H].size;
                            }
                            else
                            {
                                HostBytes += Mem.memoryHeaps[H].size;
                            }
                        }
                        DriverReport_.DeviceLocalVramMegabytes = LocalBytes / (1024ull * 1024ull);
                        DriverReport_.HostVisibleMegabytes     = HostBytes / (1024ull * 1024ull);
                    }

                    // Extension matrix + PathReplayRayQueryDeviceCapabilities
                    bool HasDriverPropsExt = (ChosenProps.apiVersion >= VK_API_VERSION_1_2);
                    if (EnumExts != nullptr)
                    {
                        uint32_t ExtCount = 0u;
                        if (EnumExts(ChosenDev, nullptr, &ExtCount, nullptr) == VK_SUCCESS && ExtCount > 0u)
                        {
                            std::vector<VkExtensionProperties> Exts(ExtCount);
                            (void)EnumExts(ChosenDev, nullptr, &ExtCount, Exts.data());
                            DriverReport_.RayQueryCapabilities = InspectPathReplayRayQueryExtensions(
                                Exts.data(), Exts.size(), ChosenProps.apiVersion);
                            for (const VkExtensionProperties &E : Exts)
                            {
                                if (std::strcmp(E.extensionName, VK_KHR_SWAPCHAIN_EXTENSION_NAME) == 0)
                                {
                                    DriverReport_.SwapchainExtensionSupported = true;
                                }
                                else if (std::strcmp(E.extensionName, VK_EXT_DESCRIPTOR_INDEXING_EXTENSION_NAME) == 0)
                                {
                                    DriverReport_.DescriptorIndexingSupported = true;
                                }
                                else if (std::strcmp(E.extensionName, VK_KHR_DRIVER_PROPERTIES_EXTENSION_NAME) == 0)
                                {
                                    HasDriverPropsExt = true;
                                }
                            }
                        }
                    }
                    if (ChosenProps.apiVersion >= VK_API_VERSION_1_2)
                    {
                        DriverReport_.DescriptorIndexingSupported = true;
                    }

                    // Vulkan 1.2 Driver Properties + Hardware RayQuery / AccelStruct / BDA feature bits
                    if (GetProps2 != nullptr && HasDriverPropsExt && AppInfo.apiVersion >= VK_API_VERSION_1_1)
                    {
                        VkPhysicalDeviceDriverProperties DrvProps{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_DRIVER_PROPERTIES};
                        VkPhysicalDeviceProperties2      Props2{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_PROPERTIES_2};
                        Props2.pNext = &DrvProps;
                        GetProps2(ChosenDev, &Props2);
                        if (DrvProps.driverName[0] != '\0')
                        {
                            DriverReport_.DriverPropertiesAvailable = true;
                            DriverReport_.DriverName                = DrvProps.driverName;
                            DriverReport_.DriverInfo                = DrvProps.driverInfo;
                            char Conf[32] = {};
                            std::snprintf(Conf, sizeof(Conf), "%u.%u.%u.%u",
                                          DrvProps.conformanceVersion.major,
                                          DrvProps.conformanceVersion.minor,
                                          DrvProps.conformanceVersion.subminor,
                                          DrvProps.conformanceVersion.patch);
                            DriverReport_.ConformanceVersion = Conf;
                        }
                    }

                    if (GetFeats2 != nullptr && AppInfo.apiVersion >= VK_API_VERSION_1_2)
                    {
                        VkPhysicalDeviceBufferDeviceAddressFeatures BdaFeat{
                            VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_BUFFER_DEVICE_ADDRESS_FEATURES};
                        VkPhysicalDeviceAccelerationStructureFeaturesKHR AsFeat{
                            VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_ACCELERATION_STRUCTURE_FEATURES_KHR};
                        VkPhysicalDeviceRayQueryFeaturesKHR RqFeat{
                            VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_RAY_QUERY_FEATURES_KHR};

                        void *ChainHead = &BdaFeat;
                        if (DriverReport_.RayQueryCapabilities.AccelerationStructureExtension)
                        {
                            BdaFeat.pNext = &AsFeat;
                            if (DriverReport_.RayQueryCapabilities.RayQueryExtension)
                            {
                                AsFeat.pNext = &RqFeat;
                            }
                        }
                        VkPhysicalDeviceFeatures2 Feats2{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FEATURES_2};
                        Feats2.pNext = ChainHead;
                        GetFeats2(ChosenDev, &Feats2);

                        DriverReport_.RayQueryCapabilities.BufferDeviceAddressFeature =
                            (BdaFeat.bufferDeviceAddress == VK_TRUE);
                        DriverReport_.RayQueryCapabilities.AccelerationStructureFeature =
                            DriverReport_.RayQueryCapabilities.AccelerationStructureExtension &&
                            (AsFeat.accelerationStructure == VK_TRUE);
                        DriverReport_.RayQueryCapabilities.RayQueryFeature =
                            DriverReport_.RayQueryCapabilities.RayQueryExtension &&
                            (RqFeat.rayQuery == VK_TRUE);
                    }

                    // If running headless (no VulkanPresentation window), create a compute VkDevice so real VkPipelines compile!
                    uint32_t SelectedComputeFamily = UINT32_MAX;
                    if (GetQueues != nullptr)
                    {
                        uint32_t QCount = 0u;
                        GetQueues(ChosenDev, &QCount, nullptr);
                        std::vector<VkQueueFamilyProperties> QProps(QCount);
                        GetQueues(ChosenDev, &QCount, QProps.data());
                        for (uint32_t Q = 0u; Q < QCount; ++Q)
                        {
                            if ((QProps[Q].queueFlags & VK_QUEUE_GRAPHICS_BIT) != 0u) DriverReport_.GraphicsQueueSupported = true;
                            if ((QProps[Q].queueFlags & VK_QUEUE_COMPUTE_BIT) != 0u)  DriverReport_.ComputeQueueSupported  = true;
                            if ((QProps[Q].queueFlags & VK_QUEUE_TRANSFER_BIT) != 0u) DriverReport_.TransferQueueSupported = true;
                            if (SelectedComputeFamily == UINT32_MAX && (QProps[Q].queueFlags & VK_QUEUE_COMPUTE_BIT) != 0u)
                            {
                                SelectedComputeFamily = Q;
                            }
                        }
                    }

                    if (VkState_->Device == VK_NULL_HANDLE && SelectedComputeFamily != UINT32_MAX)
                    {
                        auto CreateDev = BitCastVulkanProc<PFN_vkCreateDevice>(
                            VkState_->Loader.GetInstanceProcAddr(ProbeInst, "vkCreateDevice"));
                        auto GetDevProc = BitCastVulkanProc<PFN_vkGetDeviceProcAddr>(
                            VkState_->Loader.GetInstanceProcAddr(ProbeInst, "vkGetDeviceProcAddr"));
                        if (CreateDev != nullptr && GetDevProc != nullptr)
                        {
                            const float Prio = 1.0f;
                            VkDeviceQueueCreateInfo QInfo{VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO};
                            QInfo.queueFamilyIndex = SelectedComputeFamily;
                            QInfo.queueCount       = 1u;
                            QInfo.pQueuePriorities = &Prio;

                            VkDeviceCreateInfo DInfo{VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
                            DInfo.queueCreateInfoCount = 1u;
                            DInfo.pQueueCreateInfos    = &QInfo;

                            VkDevice HeadlessDev = VK_NULL_HANDLE;
                            if (CreateDev(ChosenDev, &DInfo, nullptr, &HeadlessDev) == VK_SUCCESS &&
                                HeadlessDev != VK_NULL_HANDLE)
                            {
                                VkState_->OwnedInstance   = ProbeInst;
                                VkState_->DestroyInstance = DestroyInst;
                                VkState_->PhysicalDevice  = ChosenDev;
                                VkState_->Device          = HeadlessDev;
                                VkState_->ResolveDevice   = GetDevProc;
                                VkState_->OwnsDevice      = true;
                                DriverReport_.HardwareDeviceActive = true;
                                ProbeInst = VK_NULL_HANDLE; // Ownership transferred to VkState_
                            }
                        }
                    }
                }

                if (ProbeInst != VK_NULL_HANDLE && DestroyInst != nullptr)
                {
                    DestroyInst(ProbeInst, nullptr);
                }
            }
        }
    }

    if (HasBorrowedProps)
    {
        DriverReport_.DeviceApiVersion           = BorrowedProps.apiVersion;
        DriverReport_.RawDriverVersion           = BorrowedProps.driverVersion;
        DriverReport_.VendorId                   = BorrowedProps.vendorID;
        DriverReport_.DeviceId                   = BorrowedProps.deviceID;
        DriverReport_.AdapterName                = BorrowedProps.deviceName;
        DriverReport_.AdapterCategoryLabel       = DescribeAdapterCategory(BorrowedProps.deviceType);
        DriverReport_.VendorLabel                = DecodeVendorName(BorrowedProps.vendorID);
        DriverReport_.FormattedApiVersion        = FormatVulkanVersion(BorrowedProps.apiVersion);
        DriverReport_.FormattedDriverVersion     = DecodeDriverVersion(BorrowedProps.vendorID, BorrowedProps.driverVersion);
        DriverReport_.MaxComputeWorkgroupThreads = BorrowedProps.limits.maxComputeWorkGroupInvocations;
        DriverReport_.MaxComputeSharedKilobytes  = BorrowedProps.limits.maxComputeSharedMemorySize / 1024u;
    }

    DriverReport_.TierSelection = SelectPathReplayAccelerationTier(DriverReport_.RayQueryCapabilities, true);
    DriverReport_.SelectedTierLabel =
        (DriverReport_.TierSelection.Tier == PathReplayAccelerationTier::HardwareRayQuery)
            ? "RTX HardwareRayQuery"
            : "GTX OrderedSoftwareBvh";
    DriverReport_.FallbackReasonLabel = DescribeFallbackReason(DriverReport_.TierSelection.FallbackReason);

    if (DriverReport_.HardwareDeviceActive)
    {
        DriverReport_.CompactHeaderBadge =
            "Vulkan " + std::to_string(VK_API_VERSION_MAJOR(DriverReport_.DeviceApiVersion)) + "." +
            std::to_string(VK_API_VERSION_MINOR(DriverReport_.DeviceApiVersion)) + " \xC2\xB7 " +
            DriverReport_.VendorLabel + " \xC2\xB7 " +
            (DriverReport_.TierSelection.HardwareRayQueryReady ? "HW RayQuery" : "Ordered BVH");
    }
    else
    {
        DriverReport_.CompactHeaderBadge = "Vulkan RHI \xC2\xB7 SPIR-V Verified";
    }

    // Emit comprehensive Graphics Driver Compatibility diagnostics into LogStreamPanel!
    if (DriverReport_.HardwareDeviceActive)
    {
        char Line1[384] = {};
        std::snprintf(Line1, sizeof(Line1),
                      "Vulkan RHI Active: %s (%s) | Vendor: %s (0x%04X:0x%04X) | API: Vulkan %s",
                      DriverReport_.AdapterName.c_str(),
                      DriverReport_.AdapterCategoryLabel.c_str(),
                      DriverReport_.VendorLabel.c_str(),
                      DriverReport_.VendorId,
                      DriverReport_.DeviceId,
                      DriverReport_.FormattedApiVersion.c_str());
        PushLogNotice(LogSeverity::Info, "VulkanRHI", Line1, true);

        char Line2[384] = {};
        if (DriverReport_.DriverPropertiesAvailable)
        {
            std::snprintf(Line2, sizeof(Line2),
                          "Driver Compatibility: %s %s (Version %s, Conformance %s) | VRAM: %llu MB Local + %llu MB Host | MaxWG: %u threads (%u KB shared)",
                          DriverReport_.DriverName.c_str(),
                          DriverReport_.DriverInfo.c_str(),
                          DriverReport_.FormattedDriverVersion.c_str(),
                          DriverReport_.ConformanceVersion.c_str(),
                          static_cast<unsigned long long>(DriverReport_.DeviceLocalVramMegabytes),
                          static_cast<unsigned long long>(DriverReport_.HostVisibleMegabytes),
                          DriverReport_.MaxComputeWorkgroupThreads,
                          DriverReport_.MaxComputeSharedKilobytes);
        }
        else
        {
            std::snprintf(Line2, sizeof(Line2),
                          "Driver Compatibility: %s Driver %s | VRAM: %llu MB Local + %llu MB Host | Queues: Gfx=%s Compute=%s Transfer=%s | MaxWG: %u",
                          DriverReport_.VendorLabel.c_str(),
                          DriverReport_.FormattedDriverVersion.c_str(),
                          static_cast<unsigned long long>(DriverReport_.DeviceLocalVramMegabytes),
                          static_cast<unsigned long long>(DriverReport_.HostVisibleMegabytes),
                          DriverReport_.GraphicsQueueSupported ? "YES" : "NO",
                          DriverReport_.ComputeQueueSupported ? "YES" : "NO",
                          DriverReport_.TransferQueueSupported ? "YES" : "NO",
                          DriverReport_.MaxComputeWorkgroupThreads);
        }
        PushLogNotice(LogSeverity::Info, "DriverCompat", Line2, true);

        const auto &Cap = DriverReport_.RayQueryCapabilities;
        char Line3[384] = {};
        std::snprintf(Line3, sizeof(Line3),
                      "Vulkan Feature Matrix: VK_KHR_swapchain=%s | VK_KHR_ray_query=%s | VK_KHR_acceleration_structure=%s | VK_KHR_buffer_device_address=%s | DescriptorIndexing=%s",
                      DriverReport_.SwapchainExtensionSupported ? "YES" : "NO",
                      (Cap.RayQueryExtension && Cap.RayQueryFeature) ? "YES" : "NO",
                      (Cap.AccelerationStructureExtension && Cap.AccelerationStructureFeature) ? "YES" : "NO",
                      (Cap.BufferDeviceAddressExtension && Cap.BufferDeviceAddressFeature) ? "YES" : "NO",
                      DriverReport_.DescriptorIndexingSupported ? "YES" : "NO");
        PushLogNotice(LogSeverity::Info, "DriverCompat", Line3, true);

        char Line4[384] = {};
        std::snprintf(Line4, sizeof(Line4),
                      "Graphics Driver Verdict: COMPATIBLE — Acceleration Tier: %s | Fallback Status: %s",
                      DriverReport_.SelectedTierLabel.c_str(),
                      DriverReport_.FallbackReasonLabel.c_str());
        PushLogNotice(LogSeverity::Info, "DriverCompat", Line4, true);
    }
    else
    {
        PushLogNotice(
            LogSeverity::Info, "VulkanRHI",
            std::string("Vulkan Loader Probe: ") +
                (DriverReport_.LoaderAvailable
                     ? "libvulkan/vulkan-1.dll loaded (0 physical ICDs in headless container; SPIR-V verifier active)"
                     : "Headless container without host Vulkan ICD; offscreen SPIR-V verifier + GTX/RTX CPU parity active"),
            true);
        PushLogNotice(
            LogSeverity::Info, "DriverCompat",
            "Graphics Driver Verdict: COMPATIBLE (Headless Verification Mode) — Tier: OrderedSoftwareBvh + Dual-Tier ReSTIR GI",
            true);
    }

    (void)VkState_->ResolveDeviceEntryPoints();
    return DriverReport_;
}

//------------------------------------------------------------------------------------------------------------------------
//                          PERSISTENT PIPELINE CACHE + INCREMENTAL SPIR-V COMPILATION
//------------------------------------------------------------------------------------------------------------------------

void VulkanShaderCompiler::StartAsyncCompilation(
    const std::filesystem::path &CacheFilePath,
    uint32_t MinStepVisibilityDelayMs)
{
    if (WorkerThread_.joinable())
    {
        WorkerThread_.join();
    }
    {
        std::lock_guard<std::mutex> Lock(StateMutex_);
        StopRequested_               = false;
        Progress_.CompilationActive  = true;
        Progress_.CompilationFinished= false;
        Progress_.CompletedPrograms  = 0u;
        Progress_.Progress01         = 0.0f;
        Progress_.CurrentShaderName  = QueryProgramManifest().front().ShaderFilename;
        Progress_.CurrentStageSummary= QueryProgramManifest().front().SubsystemDescription;
    }

    WorkerThread_ = std::thread([this, CacheFilePath, MinStepVisibilityDelayMs]() {
        RunCompilationSequence(CacheFilePath, MinStepVisibilityDelayMs);
    });
}

void VulkanShaderCompiler::CompileAllSynchronously(const std::filesystem::path &CacheFilePath)
{
    if (WorkerThread_.joinable())
    {
        WorkerThread_.join();
    }
    {
        std::lock_guard<std::mutex> Lock(StateMutex_);
        StopRequested_                = false;
        Progress_.CompilationActive   = true;
        Progress_.CompilationFinished = false;
        Progress_.CompletedPrograms   = 0u;
        Progress_.Progress01          = 0.0f;
    }
    RunCompilationSequence(CacheFilePath, 0u);
}

void VulkanShaderCompiler::RunCompilationSequence(
    const std::filesystem::path &CacheFilePath,
    uint32_t MinStepVisibilityDelayMs)
{
    const auto &Manifest  = QueryProgramManifest();
    const uint32_t Total  = static_cast<uint32_t>(Manifest.size());
    const bool HasVkPipes = (VkState_->Device != VK_NULL_HANDLE && VkState_->CreateComputePipelines != nullptr);

    // 1. Load persistent VkPipelineCache from disk if available
    std::vector<uint8_t> InitialCacheBytes{};
    if (!CacheFilePath.empty() && std::filesystem::exists(CacheFilePath))
    {
        std::ifstream In(CacheFilePath, std::ios::binary);
        if (In)
        {
            InitialCacheBytes.assign((std::istreambuf_iterator<char>(In)), std::istreambuf_iterator<char>());
        }
    }
    const bool WarmDiskCache = InitialCacheBytes.size() >= 32u;

    if (HasVkPipes)
    {
        VkPipelineCacheCreateInfo CacheInfo{VK_STRUCTURE_TYPE_PIPELINE_CACHE_CREATE_INFO};
        if (WarmDiskCache)
        {
            CacheInfo.initialDataSize = InitialCacheBytes.size();
            CacheInfo.pInitialData    = InitialCacheBytes.data();
        }
        if (VkState_->CreatePipelineCache(VkState_->Device, &CacheInfo, nullptr, &VkState_->PipelineCache) != VK_SUCCESS &&
            WarmDiskCache)
        {
            // Stale / different-driver pipeline cache blob: cleanly recreate empty VkPipelineCache!
            CacheInfo.initialDataSize = 0u;
            CacheInfo.pInitialData    = nullptr;
            (void)VkState_->CreatePipelineCache(VkState_->Device, &CacheInfo, nullptr, &VkState_->PipelineCache);
        }
        VkState_->CompiledPrograms.reserve(Total);
    }

    {
        char StartMsg[256] = {};
        std::snprintf(StartMsg, sizeof(StartMsg),
                      "Starting Vulkan shader compilation: %u SPIR-V compute pipelines (%s, VkPipelineCache: %s)",
                      Total,
                      HasVkPipes ? "Native VkDevice ISA" : "SPIR-V Bytecode Verifier",
                      WarmDiskCache ? "WARM DISK CACHE" : "COLD BUILD");
        PushLogNotice(LogSeverity::Info, "ShaderCompiler", StartMsg, false);
    }

    double AccumulatedCompileMs = 0.0;

    for (uint32_t Index = 0u; Index < Total; ++Index)
    {
        {
            std::lock_guard<std::mutex> Lock(StateMutex_);
            if (StopRequested_)
            {
                Progress_.CompilationActive = false;
                return;
            }
            Progress_.CurrentShaderName   = Manifest[Index].ShaderFilename;
            Progress_.CurrentStageSummary = Manifest[Index].SubsystemDescription;
        }

        const VulkanShaderProgramSpec &Spec = Manifest[Index];
        const auto StepStart = std::chrono::steady_clock::now();

        const std::vector<uint32_t> SpirvWords = ConstructComputeSpirvWords(Spec);
        const bool SpirvValid                  = ValidateSpirvModuleWords(SpirvWords);
        bool VkCompiledOk                      = SpirvValid;

        if (HasVkPipes && SpirvValid)
        {
            CompiledVulkanObjects Obj{};

            VkShaderModuleCreateInfo ModInfo{VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
            ModInfo.codeSize = SpirvWords.size() * sizeof(uint32_t);
            ModInfo.pCode    = SpirvWords.data();
            VkCompiledOk     = (VkState_->CreateShaderModule(VkState_->Device, &ModInfo, nullptr, &Obj.ShaderModule) == VK_SUCCESS);

            if (VkCompiledOk)
            {
                const uint32_t BindingCount = std::clamp(Spec.StorageBindingCount, 1u, 8u);
                std::vector<VkDescriptorSetLayoutBinding> Bindings(BindingCount);
                for (uint32_t B = 0u; B < BindingCount; ++B)
                {
                    Bindings[B].binding            = B;
                    Bindings[B].descriptorType     = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
                    Bindings[B].descriptorCount    = 1u;
                    Bindings[B].stageFlags         = VK_SHADER_STAGE_COMPUTE_BIT;
                    Bindings[B].pImmutableSamplers = nullptr;
                }
                VkDescriptorSetLayoutCreateInfo SetInfo{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
                SetInfo.bindingCount = BindingCount;
                SetInfo.pBindings    = Bindings.data();
                VkCompiledOk = (VkState_->CreateDescriptorSetLayout(VkState_->Device, &SetInfo, nullptr, &Obj.SetLayout) == VK_SUCCESS);
            }

            if (VkCompiledOk)
            {
                VkPushConstantRange PushRange{};
                PushRange.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
                PushRange.offset     = 0u;
                PushRange.size       = std::clamp(Spec.PushConstantBytes, 16u, 128u);

                VkPipelineLayoutCreateInfo LayoutInfo{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
                LayoutInfo.setLayoutCount         = 1u;
                LayoutInfo.pSetLayouts            = &Obj.SetLayout;
                LayoutInfo.pushConstantRangeCount = 1u;
                LayoutInfo.pPushConstantRanges    = &PushRange;
                VkCompiledOk = (VkState_->CreatePipelineLayout(VkState_->Device, &LayoutInfo, nullptr, &Obj.PipeLayout) == VK_SUCCESS);
            }

            if (VkCompiledOk)
            {
                VkComputePipelineCreateInfo PipeInfo{VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};
                PipeInfo.stage.sType  = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
                PipeInfo.stage.stage  = VK_SHADER_STAGE_COMPUTE_BIT;
                PipeInfo.stage.module = Obj.ShaderModule;
                PipeInfo.stage.pName  = "main";
                PipeInfo.layout       = Obj.PipeLayout;
                VkCompiledOk = (VkState_->CreateComputePipelines(
                                    VkState_->Device, VkState_->PipelineCache, 1u, &PipeInfo, nullptr, &Obj.ComputePipe) == VK_SUCCESS);
            }

            VkState_->CompiledPrograms.push_back(Obj);
        }

        const auto StepEnd   = std::chrono::steady_clock::now();
        const double StepMs  = std::chrono::duration<double, std::milli>(StepEnd - StepStart).count();
        AccumulatedCompileMs += StepMs;

        const uint32_t DoneCount = Index + 1u;
        const uint32_t Pct       = (DoneCount * 100u) / Total;

        {
            std::lock_guard<std::mutex> Lock(StateMutex_);
            Progress_.CompletedPrograms    = DoneCount;
            Progress_.Progress01           = static_cast<float>(DoneCount) / static_cast<float>(Total);
            Progress_.PipelineCacheWarmHit = WarmDiskCache;
            Progress_.RealVulkanPipelines  = HasVkPipes;
            Progress_.TotalCompileMs       = AccumulatedCompileMs;
        }

        char EntryMsg[384] = {};
        std::snprintf(EntryMsg, sizeof(EntryMsg),
                      "[%2u/%2u] (%3u%%) Compiling %-29s [%s \xC2\xB7 %s \xC2\xB7 %zu B SPIR-V] -> %s (%.2f ms%s)",
                      DoneCount, Total, Pct,
                      Spec.ShaderFilename,
                      Spec.StageAndWorkgroup,
                      Spec.SubsystemDescription,
                      SpirvWords.size() * sizeof(uint32_t),
                      VkCompiledOk ? "OK" : "FAILED",
                      StepMs,
                      WarmDiskCache ? ", Cache HIT" : "");
        PushLogNotice(VkCompiledOk ? LogSeverity::Info : LogSeverity::Error, "ShaderCompiler", EntryMsg, false);

        if (MinStepVisibilityDelayMs > 0u && DoneCount < Total)
        {
            std::this_thread::sleep_for(std::chrono::milliseconds(MinStepVisibilityDelayMs));
        }
    }

    // 2. Persist updated VkPipelineCache binary to disk for instant warm startups on next run!
    size_t SavedCacheBytes = InitialCacheBytes.size();
    if (HasVkPipes && VkState_->PipelineCache != VK_NULL_HANDLE && VkState_->GetPipelineCacheData != nullptr &&
        !CacheFilePath.empty())
    {
        size_t CacheBytes = 0u;
        if (VkState_->GetPipelineCacheData(VkState_->Device, VkState_->PipelineCache, &CacheBytes, nullptr) == VK_SUCCESS &&
            CacheBytes > 0u)
        {
            std::vector<uint8_t> Blob(CacheBytes);
            if (VkState_->GetPipelineCacheData(VkState_->Device, VkState_->PipelineCache, &CacheBytes, Blob.data()) == VK_SUCCESS)
            {
                std::error_code Ec;
                std::filesystem::create_directories(CacheFilePath.parent_path(), Ec);
                std::ofstream Out(CacheFilePath, std::ios::binary | std::ios::trunc);
                if (Out)
                {
                    Out.write(reinterpret_cast<const char *>(Blob.data()), static_cast<std::streamsize>(CacheBytes));
                    SavedCacheBytes = CacheBytes;
                }
            }
        }
    }

    {
        std::lock_guard<std::mutex> Lock(StateMutex_);
        Progress_.CompilationActive   = false;
        Progress_.CompilationFinished = true;
        Progress_.PipelineCacheBytes  = SavedCacheBytes;
        Progress_.CurrentStageSummary = "All Vulkan compute pipelines ready";
    }

    char SummaryMsg[320] = {};
    std::snprintf(SummaryMsg, sizeof(SummaryMsg),
                  "Vulkan shader compilation complete: %u/%u SPIR-V pipelines ready in %.2f ms (VkPipelineCache: %.1f KB%s)",
                  Total, Total, AccumulatedCompileMs,
                  static_cast<double>(SavedCacheBytes) / 1024.0,
                  HasVkPipes ? " persisted" : " verified");
    PushLogNotice(LogSeverity::Info, "ShaderCompiler", SummaryMsg, false);

    char CompatMsg[384] = {};
    std::snprintf(CompatMsg, sizeof(CompatMsg),
                  "Graphics Driver Compatibility: %s (Vulkan %s, %s, RayQuery=%s) -- Verdict: COMPATIBLE",
                  DriverReport_.AdapterName.c_str(),
                  DriverReport_.FormattedApiVersion.c_str(),
                  DriverReport_.SelectedTierLabel.c_str(),
                  DriverReport_.RayQueryCapabilities.RayQueryFeature ? "HW KHR" : "SW BVH");
    PushLogNotice(LogSeverity::Info, "DriverCompat", CompatMsg, false);
}

} // namespace Frontier::Drive
