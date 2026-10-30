/*==========================================================================================================================================
                                            PRODUCTIONRESTIRCONTRACTVALIDATION.CPP
==========================================================================================================================================*/
// 🧩 Verify host contracts for pairwise MIS, hybrid reconnection slabs, solar/sky payloads, and adaptive variance filtering.

#include "Engine/Rendering/PathReplayDomain.h"
#include "Engine/Rendering/PathReplaySubmissionSequence.h"
#include "Engine/Rendering/PathReplayVulkan.h"
#include "Engine/Rendering/SkyRadiance.h"

#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <stdexcept>
#include <vector>

namespace
{

void RequireCondition(bool Condition, const char* Message)
{
    if (!Condition)
    {
        throw std::runtime_error(Message);
    }
}

template <typename Callable>
bool RejectsInvalid(Callable&& Operation)
{
    try
    {
        Operation();
        return false;
    }
    catch (const std::exception&)
    {
        return true;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                      SOLAR/SKY PAYLOAD AND QUADRATURE CONSERVATION
//------------------------------------------------------------------------------------------------------------------------

void ValidateSolarSkyPayloadAndConservation()
{
    Frontier::SkyRadianceSpecification NoonSpecification{};
    NoonSpecification.SolarDirection     = {0.25, 0.92, 0.30248967};
    NoonSpecification.ZenithDirection    = {0.0, 1.0, 0.0};
    NoonSpecification.SolarIrradiance    = {19.0, 18.4, 17.6};
    NoonSpecification.SolarAngularRadius = 0.00465421;
    NoonSpecification.ObserverAltitudeKm = 0.08;
    NoonSpecification.LimbDarkeningU1    = 0.397;
    NoonSpecification.LimbDarkeningU2    = 0.196;

    const auto Payload = Frontier::CompileSkyRadiancePayload(NoonSpecification);
    Frontier::ValidateSkyRadiancePayload(Payload);

    auto Corrupted = Payload;
    Corrupted[3] = 0.85f;
    RequireCondition(RejectsInvalid([&] { Frontier::ValidateSkyRadiancePayload(Corrupted); }),
                     "Excessive solar angular radius must be rejected");
    Corrupted = Payload;
    Corrupted[12] = 0.65f;
    Corrupted[13] = 0.45f;
    RequireCondition(RejectsInvalid([&] { Frontier::ValidateSkyRadiancePayload(Corrupted); }),
                     "Negative-limb solar coefficients must be rejected");

    // 📝 Integrate finite limb-darkened solar cap and compare against analytic atmospheric transmittance * E_sun * cos(theta).
    const Frontier::SpatialVector OriginMeters{0.0, 0.0, 0.0};
    const Frontier::SpatialVector SurfaceNormal{0.0, 1.0, 0.0};
    const Frontier::SpectrumRgb Integrated = Frontier::IntegrateSolarDiscIrradiance(
        NoonSpecification, OriginMeters, SurfaceNormal, 48u, 96u);

    const double SunLength = std::sqrt(NoonSpecification.SolarDirection.X * NoonSpecification.SolarDirection.X +
                                       NoonSpecification.SolarDirection.Y * NoonSpecification.SolarDirection.Y +
                                       NoonSpecification.SolarDirection.Z * NoonSpecification.SolarDirection.Z);
    const double CosZenith = NoonSpecification.SolarDirection.Y / SunLength;
    const Frontier::SpectrumRgb Transmittance = Frontier::TransmittanceToTop(
        NoonSpecification.Atmosphere,
        NoonSpecification.Atmosphere.GroundRadiusKm + NoonSpecification.ObserverAltitudeKm,
        CosZenith,
        48u);
    const Frontier::SpectrumRgb Analytic{
        NoonSpecification.SolarIrradiance.R * Transmittance.R * CosZenith,
        NoonSpecification.SolarIrradiance.G * Transmittance.G * CosZenith,
        NoonSpecification.SolarIrradiance.B * Transmittance.B * CosZenith,
    };

    const double RelErrorR = std::abs(Integrated.R - Analytic.R) / std::max(Analytic.R, 1e-9);
    const double RelErrorG = std::abs(Integrated.G - Analytic.G) / std::max(Analytic.G, 1e-9);
    const double RelErrorB = std::abs(Integrated.B - Analytic.B) / std::max(Analytic.B, 1e-9);
    RequireCondition(RelErrorR < 1.5e-3 && RelErrorG < 1.5e-3 && RelErrorB < 1.5e-3,
                     "Limb-darkened solar cap quadrature failed irradiance conservation");

    // 📝 Verify physical Rayleigh zenith blueness at noon vs optical-depth reddening at golden-hour sunset.
    const Frontier::SpectrumRgb NoonZenith = Frontier::EvaluateSkyContinuumRadiance(
        NoonSpecification, OriginMeters, {0.0, 1.0, 0.0}, 32u);
    RequireCondition(NoonZenith.B > 2.2 * NoonZenith.R && NoonZenith.G > NoonZenith.R,
                     "Noon zenith sky failed Rayleigh blue dominance");

    Frontier::SkyRadianceSpecification SunsetSpecification = NoonSpecification;
    SunsetSpecification.SolarDirection = {0.9961947, 0.0871557, 0.0};
    const Frontier::SpectrumRgb SunsetDisc = Frontier::EvaluateSolarDiscLimbRadiance(
        SunsetSpecification, OriginMeters, SunsetSpecification.SolarDirection, 48u);
    RequireCondition(SunsetDisc.R > 2.5 * SunsetDisc.B,
                     "Golden-hour solar disc failed atmospheric Rayleigh/ozone reddening");

    // 📝 Verify monotone cloud-slab attenuation when cloud optical depth and coverage are enabled.
    Frontier::SkyRadianceSpecification CloudySpecification = NoonSpecification;
    CloudySpecification.CloudExtinctionKm = 4.5;
    CloudySpecification.CloudCoverage     = 0.85;
    const double ClearTransmittance  = Frontier::EvaluateCloudSlabTransmittance(
        NoonSpecification, OriginMeters, NoonSpecification.SolarDirection);
    const double CloudyTransmittance = Frontier::EvaluateCloudSlabTransmittance(
        CloudySpecification, {120.0, 0.0, 80.0}, NoonSpecification.SolarDirection);
    RequireCondition(ClearTransmittance == 1.0 && CloudyTransmittance > 0.0 && CloudyTransmittance < 0.75,
                     "Cloud-slab transmittance failed monotone attenuation");
}

//------------------------------------------------------------------------------------------------------------------------
//                                    COMPACT SLAB GEOMETRY AND VULKAN DISPATCH GUARDS
//------------------------------------------------------------------------------------------------------------------------

void ValidateCompactSlabAndVulkanContracts()
{
    constexpr std::uint32_t Receivers = 1024u;
    RequireCondition(Frontier::PathReplayCompactSlabCount(false, false, false) == 6u, "Unexpected base compact count");
    RequireCondition(Frontier::PathReplayCompactSlabCount(false, false, true) == 8u, "Unexpected base+hybrid count");
    RequireCondition(Frontier::PathReplayCompactSlabCount(true, false, true) == 12u, "Unexpected history+hybrid count");
    RequireCondition(Frontier::PathReplayCompactSlabCount(false, true, true) == 19u, "Unexpected svgf+hybrid count");

    RequireCondition(Frontier::PathReplayCompactSlot(21u, Receivers, 7u, false, true, false) == UINT64_MAX,
                     "Disabled hybrid slot must return UINT64_MAX");
    RequireCondition(Frontier::PathReplayCompactSlot(21u, Receivers, 7u, false, true, true) == 17ull * Receivers + 7u,
                     "SVGF hybrid slot 21 must land on compact slab 17");
    RequireCondition(Frontier::PathReplayCompactSlot(22u, Receivers, 7u, false, true, true) == 18ull * Receivers + 7u,
                     "SVGF hybrid slot 22 must land on compact slab 18");
    RequireCondition(Frontier::PathReplayCompactSlot(21u, Receivers, 7u, false, false, true) == 6ull * Receivers + 7u,
                     "Base hybrid slot 21 must land on compact slab 6");

    std::uint32_t DispatchedCalls = 0u;
    Frontier::PathReplayVulkanAccess Access{};
    Access.PipelineLayout          = reinterpret_cast<VkPipelineLayout>(1);
    Access.Descriptors             = reinterpret_cast<VkDescriptorSet>(1);
    Access.Primary                 = reinterpret_cast<VkPipeline>(1);
    Access.Generate                = reinterpret_cast<VkPipeline>(2);
    Access.Resolve                 = reinterpret_cast<VkPipeline>(3);
    Access.GatherVarianceHistory   = reinterpret_cast<VkPipeline>(4);
    Access.IntegrateVarianceMoments = reinterpret_cast<VkPipeline>(5);
    Access.FilterVarianceWavelet   = reinterpret_cast<VkPipeline>(6);
    Access.MaxGroupCountX          = 65535u;
    Access.MaxPushConstantBytes    = sizeof(Frontier::LightComputeFootprint);
    Access.BindPipeline = [](VkCommandBuffer, VkPipelineBindPoint, VkPipeline) {};
    Access.BindDescriptors = [](VkCommandBuffer, VkPipelineBindPoint, VkPipelineLayout, std::uint32_t, std::uint32_t,
                                const VkDescriptorSet*, std::uint32_t, const std::uint32_t*) {};
    Access.PushConstants = [](VkCommandBuffer, VkPipelineLayout, VkShaderStageFlags, std::uint32_t, std::uint32_t,
                              const void*) {};
    Access.PipelineBarrier = [](VkCommandBuffer, VkPipelineStageFlags, VkPipelineStageFlags, VkDependencyFlags,
                                std::uint32_t, const VkMemoryBarrier*, std::uint32_t, const VkBufferMemoryBarrier*,
                                std::uint32_t, const VkImageMemoryBarrier*) {};
    VkCommandBuffer FakeCommands = reinterpret_cast<VkCommandBuffer>(&DispatchedCalls);
    Access.Dispatch = [](VkCommandBuffer Cmd, std::uint32_t, std::uint32_t, std::uint32_t) {
        ++(*reinterpret_cast<std::uint32_t*>(Cmd));
    };

    Frontier::LightComputeFootprint Extent{};
    Extent.Dimensions     = {Receivers, 0u, 0u, 0u};
    Extent.Minimum        = {0.0f, 0.0f, 0.0f, 0.0f};
    Extent.Maximum        = {0.001f, 0.0f, 0.0f, 0.0f};
    Extent.Grid           = {1u, 1u, 1u, 0u};
    Extent.Sampling       = {42u, 2u, 0u, 32u};
    Extent.History        = {32u, 32u, 0u, 1u};
    Extent.Reconstruction = {1u, 1u, 0u, 16u};
    Extent.Primary        = {1u, 0u, 2u,
                             Frontier::PathReplayRoughOpaque | Frontier::PathReplayImportanceRough |
                                 Frontier::PathReplayBalanceSampling | Frontier::PathReplayPowerMis |
                                 Frontier::PathReplaySpatialDisk | Frontier::PathReplayVarianceFilter |
                                 Frontier::PathReplayCompactStorage | Frontier::PathReplayPairwiseMis |
                                 Frontier::PathReplayHybridReconnection | Frontier::PathReplaySkyRadiance |
                                 Frontier::PathReplayAdaptiveFilter};

    Frontier::PathReplayVulkanBuffers Buffers{};
    Buffers.ReceiverRecords     = Receivers;
    Buffers.AngleFloats         = Frontier::PathReplayCameraFloats + Frontier::PathReplaySolarSkyFloats;
    Buffers.OutputColourRecords = Frontier::PathReplayRequiredCompactOutputRecords(Receivers, false, true, true);
    Buffers.CounterWords        = Frontier::PathReplayReconstructionCounterWords;

    RequireCondition(RejectsInvalid([&] { Frontier::RecordPathReplay(FakeCommands, Access, Buffers, Extent); }),
                     "Missing ResolveHybrid pipeline must be rejected when hybrid reconnection is enabled");
    Access.ResolveHybrid = reinterpret_cast<VkPipeline>(7);
    Frontier::RecordPathReplay(FakeCommands, Access, Buffers, Extent);
    RequireCondition(DispatchedCalls == 9u,
                     "Production SVGF + primary + wavefront-hybrid replay must issue 9 dispatches");

    // 📝 Undersized post-camera solar/sky angle buffer and undersized hybrid compact slab buffer must fail closed.
    auto ShortAngles = Buffers;
    ShortAngles.AngleFloats = Frontier::PathReplayCameraFloats + Frontier::PathReplaySolarSkyFloats - 1u;
    RequireCondition(RejectsInvalid([&] { Frontier::RecordPathReplay(FakeCommands, Access, ShortAngles, Extent); }),
                     "Undersized solar/sky payload buffer must be rejected");

    auto ShortOutput = Buffers;
    ShortOutput.OutputColourRecords = Frontier::PathReplayRequiredCompactOutputRecords(Receivers, false, true, false);
    RequireCondition(RejectsInvalid([&] { Frontier::RecordPathReplay(FakeCommands, Access, ShortOutput, Extent); }),
                     "Undersized hybrid compact slab buffer must be rejected");

    auto OrphanAdaptive = Extent;
    OrphanAdaptive.Primary[3] &= ~Frontier::PathReplayVarianceFilter;
    RequireCondition(RejectsInvalid([&] { Frontier::RecordPathReplay(FakeCommands, Access, Buffers, OrphanAdaptive); }),
                     "Adaptive variance filter without variance filter must be rejected");
}

//------------------------------------------------------------------------------------------------------------------------
//                                      SOLAR/SKY SEQUENCE REVISION INVALIDATION
//------------------------------------------------------------------------------------------------------------------------

void ValidateSequenceSolarRevision()
{
    Frontier::SkyRadianceSpecification Spec{};
    auto SolarPayload = Frontier::CompileSkyRadiancePayload(Spec);

    std::array<std::array<float, 4>, 12> Camera{};
    Camera[0] = {0.0f, 1.5f, -4.0f, 0.1f};
    Camera[1] = {0.0f, 0.0f, 1.0f, 100.0f};
    Camera[2] = {1.0f, 0.0f, 0.0f, 0.8f};
    Camera[3] = {0.0f, 1.0f, 0.0f, 0.6f};
    Camera[4] = Camera[0];
    Camera[5] = Camera[1];
    Camera[6] = Camera[2];
    Camera[7] = Camera[3];
    Camera[11] = {1.0f, 0.0f, 1.0f, 0.0f};

    Frontier::PathReplaySceneView View{};
    View.Camera          = Camera;
    View.SolarSkyPayload = SolarPayload;

    Frontier::PathReplayHistorySpecification HistorySpec{};
    HistorySpec.BounceCount         = 2u;
    HistorySpec.PositiveFloor       = 0.001f;
    HistorySpec.PrimaryVisibility   = true;
    HistorySpec.RoughOpaque         = true;
    HistorySpec.ImportanceRough     = true;
    HistorySpec.BalanceSampling     = true;
    HistorySpec.PowerMis            = true;
    HistorySpec.CompactStorage      = true;
    HistorySpec.PairwiseMis         = true;
    HistorySpec.HybridReconnection  = true;
    HistorySpec.SkyRadiance = true;
    HistorySpec.AdaptiveFilter      = true;

    Frontier::PathReplayHistoryDomain HistoryDomain;
    const auto First = HistoryDomain.Resolve(View, HistorySpec);
    RequireCondition(First.Changed && First.MaximumHistory == 1u, "Initial solar/sky resolve must reset");

    const auto Second = HistoryDomain.Resolve(View, HistorySpec);
    RequireCondition(!Second.Changed && Second.MaximumHistory == 64u, "Identical solar/sky resolve must retain history");

    Spec.SolarDirection = {0.85, 0.42, 0.318};
    SolarPayload = Frontier::CompileSkyRadiancePayload(Spec);
    View.SolarSkyPayload = SolarPayload;
    const auto Third = HistoryDomain.Resolve(View, HistorySpec);
    RequireCondition(Third.Changed && Third.MaximumHistory == 1u, "Changed solar elevation must reset history");
}

} // namespace

int main()
{
    ValidateSolarSkyPayloadAndConservation();
    ValidateCompactSlabAndVulkanContracts();
    ValidateSequenceSolarRevision();
    std::printf("PRODUCTION_RESTIR_CONTRACT_PASS checks=3\n");
    return 0;
}
