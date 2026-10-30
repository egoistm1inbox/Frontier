/*==========================================================================================================================================
                                             PRODUCTIONRESTIRVALIDATION.H
==========================================================================================================================================*/
// 🧩 Multi-phase Vulkan GPU verification of Pairwise MIS, Hybrid Reconnection, Coupled Solar/Sky/Cloud NEE, and Adaptive SVGF.

#pragma once

//------------------------------------------------------------------------------------------------------------------------
//                                        TYPED PRODUCTION REPLAY DISPATCH
//------------------------------------------------------------------------------------------------------------------------

struct ProductionReplayConfiguration
{
    uint32_t                             Bounces             = 1u;
    uint32_t                             Seed                = 1u;
    uint32_t                             InitialCandidates   = 1u;
    uint32_t                             HistoryCap          = 16u;
    bool                                 Temporal            = false;
    bool                                 Spatial             = false;
    bool                                 SpatialDisk         = false;
    bool                                 ResetHistory        = false;
    bool                                 PrimaryVisibility   = false;
    bool                                 RoughOpaque         = false;
    bool                                 ImportanceRough     = false;
    bool                                 AuthoredMaterials   = false;
    bool                                 SampleFacets        = false;
    bool                                 BalanceSampling     = false;
    bool                                 PowerWeightedFacets = false;
    bool                                 UniformFacetMixture = false;
    bool                                 PowerMis            = false;
    bool                                 CompactStorage      = true;
    bool                                 OrderedTraversal    = true;
    bool                                 VarianceFilter      = false;
    bool                                 ResetVarianceFilter = false;
    bool                                 PairwiseMis         = false;
    bool                                 HybridReconnection  = false;
    bool                                 SkyRadiance = false;
    bool                                 AdaptiveFilter      = false;
    bool                                 Sequenced           = false;
    float                                PositiveFloor       = 0.001f;
    std::array<float, 3>                 Environment         = {0.0f, 0.0f, 0.0f};
    std::array<float, 20>                SolarSkyPayload     = {};
};

inline std::vector<std::array<float, 4>> DispatchProductionReplay(LightComputeSubmission&              Compute,
                                                                  const LightComputeArchive&           Scene,
                                                                  const ProductionReplayConfiguration& Config,
                                                                  uint32_t                             FrameSequence)
{
    Compute.Upload(Scene, Config.AuthoredMaterials);
    if (!Config.PrimaryVisibility && Config.AuthoredMaterials)
    {
        for (size_t Index = 0; Index < Scene.Receivers.size(); ++Index)
        {
            if (std::isfinite(Scene.Receivers[Index].ExpectedDirect[3]) && Scene.Receivers[Index].ExpectedDirect[3] > 0.0f)
            {
                const float Address = Scene.Receivers[Index].ExpectedDirect[3];
                std::memcpy(static_cast<char*>(Compute.Buffers[1].Address) + Index * sizeof(LightComputeReceiver) +
                                offsetof(LightComputeReceiver, ExpectedDirect) + 3u * sizeof(float),
                            &Address,
                            sizeof(float));
            }
        }
    }

    if (Config.SkyRadiance)
    {
        const size_t PayloadOffset = Scene.Angles.size() + PathReplayCameraFloats;
        Require((PayloadOffset + SkyRadiancePayloadFloats) * sizeof(float) <= Compute.Buffers[4].Size,
                "Solar/sky payload exceeds prepared angle buffer");
        std::memcpy(static_cast<float*>(Compute.Buffers[4].Address) + PayloadOffset,
                    Config.SolarSkyPayload.data(),
                    Config.SolarSkyPayload.size() * sizeof(float));
    }

    std::vector<float> FacetSources;
    uint32_t SourceCount = 0u;
    if (Config.SampleFacets)
    {
        const auto FacetIndices = CompilePathReplayFacetSources(Scene.Surfaces);
        FacetSources = Config.PowerWeightedFacets ? CompileRadiantFacetDistribution(Scene.Surfaces) : FacetIndices;
        SourceCount = Config.PowerWeightedFacets ? uint32_t(FacetSources[0]) : uint32_t(FacetIndices.size());
        Require(FacetSources.size() <= Compute.ReplayFacetCapacity,
                "Production replay facet distribution exceeds prepared capacity");
        if (!FacetSources.empty())
        {
            std::memcpy(static_cast<float*>(Compute.Buffers[4].Address) + Compute.ReplayFacetStart,
                        FacetSources.data(),
                        FacetSources.size() * sizeof(float));
        }
    }

    const uint32_t Options =
        (Config.RoughOpaque ? PathReplayRoughOpaque : 0u) |
        (Config.SampleFacets ? PathReplaySampleFacets : 0u) |
        (Config.BalanceSampling ? PathReplayBalanceSampling : 0u) |
        (Config.ImportanceRough ? PathReplayImportanceRough : 0u) |
        (Config.PowerWeightedFacets ? PathReplayPowerWeightedFacets : 0u) |
        (Config.UniformFacetMixture ? PathReplayUniformFacetMixture : 0u) |
        (Config.SpatialDisk ? PathReplaySpatialDisk : 0u) |
        (Config.VarianceFilter ? PathReplayVarianceFilter : 0u) |
        (Config.VarianceFilter && Config.ResetVarianceFilter ? PathReplayResetVarianceFilter : 0u) |
        (Config.OrderedTraversal ? PathReplayOrderedTraversal : 0u) |
        (Config.PowerMis ? PathReplayPowerMis : 0u) |
        (Config.CompactStorage ? PathReplayCompactStorage : 0u) |
        (Config.AuthoredMaterials ? PathReplayAuthoredMaterials : 0u) |
        (Config.PairwiseMis ? PathReplayPairwiseMis : 0u) |
        (Config.HybridReconnection ? PathReplayHybridReconnection : 0u) |
        (Config.SkyRadiance ? PathReplaySkyRadiance : 0u) |
        (Config.AdaptiveFilter ? PathReplayAdaptiveFilter : 0u);

    ComputeExtent Extent{};
    Extent.Dimensions     = {uint32_t(Scene.Receivers.size()), 0u, 0u, 0u};
    Extent.Minimum        = {Config.Environment[0], Config.Environment[1], Config.Environment[2], 0.0f};
    Extent.Maximum        = {Config.PositiveFloor, 0.0f, 0.0f, 0.0f};
    std::memcpy(&Extent.Maximum[1], &Compute.ReplayFacetStart, sizeof(Compute.ReplayFacetStart));
    Extent.Grid           = {1u, 1u, 1u, uint32_t(Scene.Visibility.Enclosures.size())};
    Extent.Sampling       = {Config.Seed,
                             Config.InitialCandidates <= 1u ? 0u : Config.InitialCandidates,
                             uint32_t(Scene.Visibility.Corners.size()),
                             64u};
    Extent.History        = {Scene.Width,
                             Scene.Height,
                             Config.ResetHistory ? 0u : FrameSequence,
                             Config.ResetHistory ? 1u : 0u};
    Extent.Reconstruction = {Config.Temporal ? 1u : 0u, Config.Spatial ? 1u : 0u, SourceCount, Config.HistoryCap};
    Extent.Primary        = {Config.PrimaryVisibility ? 1u : 0u, uint32_t(Scene.Angles.size()), Config.Bounces, Options};

    std::memset(Compute.Buffers[7].Address, 0, 96);
    Confirm(Compute.ResetCommandPool(Compute.Device, Compute.Pool, 0));
    Confirm(Compute.ResetFences(Compute.Device, 1, &Compute.Completion));
    VkCommandBufferBeginInfo Begin{};
    Begin.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
    Begin.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    Confirm(Compute.BeginCommandBuffer(Compute.Commands, &Begin));

    VkMemoryBarrier Barrier{};
    Barrier.sType         = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    Barrier.srcAccessMask = VK_ACCESS_HOST_WRITE_BIT | VK_ACCESS_SHADER_WRITE_BIT;
    Barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
    Compute.CmdPipelineBarrier(Compute.Commands,
                               VK_PIPELINE_STAGE_HOST_BIT | VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                               VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                               0, 1, &Barrier, 0, nullptr, 0, nullptr);

    const PathReplayVulkanAccess Access{
        Compute.PipelineLayout,
        Compute.DescriptorSet,
        Compute.PrimaryPipeline,
        Compute.ReplayGeneratePipeline,
        Compute.ReplayResolvePipeline,
        Compute.CmdBindPipeline,
        Compute.CmdBindDescriptorSets,
        Compute.CmdPushConstants,
        Compute.CmdDispatch,
        Compute.CmdPipelineBarrier,
        Compute.Properties.limits.maxComputeWorkGroupCount[0],
        Compute.Properties.limits.maxPushConstantsSize,
        Compute.ReplayGatherReconstructionPipeline,
        Compute.ReplayFinalizeReconstructionPipeline,
        Compute.ReplayGatherSampleHistoryPipeline,
        Compute.ReplayFinalizeSampleHistoryPipeline,
        Compute.ReplayGatherVarianceHistoryPipeline,
        Compute.ReplayIntegrateVarianceMomentsPipeline,
        Compute.ReplayFilterVarianceWaveletPipeline,
        Compute.ReplayResolveHybridPipeline,
    };
    const PathReplayVulkanBuffers Spans{
        Compute.Buffers[1].Size / sizeof(LightComputeReceiver),
        Compute.Buffers[2].Size / sizeof(TriangleVisibilitySpace::FloatEnclosure),
        Compute.Buffers[3].Size / sizeof(LightComputeFacet),
        Compute.Buffers[4].Size / sizeof(float),
        Compute.Buffers[6].Size / sizeof(std::array<float, 4>),
        Compute.Buffers[7].Size / sizeof(uint32_t),
    };

    PathReplaySceneView DomainView = ReplayDomainView(Scene);
    if (Config.SkyRadiance)
    {
        DomainView.SolarSkyPayload = Config.SolarSkyPayload;
    }

    if (Config.Sequenced)
    {
        Extent.Primary[3] &= ~PathReplayResetVarianceFilter;
        Compute.ReplayLastSequence = Compute.ReplaySequence.RecordReplay(
            Compute.Commands, Access, Spans, DomainView, Extent, 1u, false);
        Extent = Compute.ReplayLastSequence.Extent;
    }
    else
    {
        RecordPathReplay(Compute.Commands, Access, Spans, Extent);
    }

    Barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    Barrier.dstAccessMask = VK_ACCESS_HOST_READ_BIT;
    Compute.CmdPipelineBarrier(Compute.Commands,
                               VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                               VK_PIPELINE_STAGE_HOST_BIT,
                               0, 1, &Barrier, 0, nullptr, 0, nullptr);
    Confirm(Compute.EndCommandBuffer(Compute.Commands));

    VkSubmitInfo Submission{};
    Submission.sType              = VK_STRUCTURE_TYPE_SUBMIT_INFO;
    Submission.commandBufferCount = 1u;
    Submission.pCommandBuffers    = &Compute.Commands;
    Confirm(Compute.QueueSubmit(Compute.Queue, 1u, &Submission, Compute.Completion));
    Confirm(Compute.WaitForFences(Compute.Device, 1u, &Compute.Completion, VK_TRUE, 600000000000ull));
    if (Config.Sequenced)
    {
        Compute.ReplaySequence.Finalize(Compute.ReplayLastSequence.Submission);
    }

    std::vector<std::array<float, 4>> Output(Scene.Receivers.size());
    std::memcpy(Output.data(), Compute.Buffers[6].Address, Output.size() * sizeof(std::array<float, 4>));
    return Output;
}

inline void SaveFloat32RgbCapture(const std::string& Path, const std::vector<std::array<float, 4>>& Image)
{
    std::filesystem::create_directories(std::filesystem::path(Path).parent_path());
    std::ofstream Stream(Path, std::ios::binary);
    Require(bool(Stream), "Failed to open float32 capture output");
    for (const auto& Pixel : Image)
    {
        Stream.write(reinterpret_cast<const char*>(Pixel.data()), 3u * sizeof(float));
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                   PHASE 1: CANONICAL PAIRWISE MIS BENCHMARK
//------------------------------------------------------------------------------------------------------------------------

inline void ValidatePhaseOnePairwiseMis(LightComputeSubmission& Compute)
{
    constexpr uint32_t Size    = 32u;
    constexpr uint32_t Batches = 16u;
    constexpr uint32_t Frames  = 4u;
    constexpr float    Floor   = 1e-4f;

    auto DimSpec           = EnumerateReplayMaterialSpecifications()[4];
    DimSpec.Coverage       = 1e-3f;
    DimSpec.CoatCoverage   = 2e-3f;
    DimSpec.ReportingScale = 1e3;
    const auto Dim         = ConstructReplayMaterialReuseFixture(Size, DimSpec);
    const auto Metal       = ConstructReplayMaterialReuseFixture(Size, EnumerateReplayMaterialSpecifications()[1]);
    const auto Scene       = ConstructReplayMixedMaterialFixture(Size, Dim, Metal);

    const std::array<double, 2> Scales{1e3, 1.0};
    const std::array<double, 2> References{
        IntegrateReplayMixedVisibleReference(Dim, -0.75, 1024u) * Scales[0],
        IntegrateReplayMixedVisibleReference(Metal, 0.75, 1024u) * Scales[1],
    };

    Compute.RebindReplayScene(Scene, true);

    struct PhaseOneArm
    {
        const char* Name;
        bool        Temporal;
        bool        Spatial;
        bool        Pairwise;
        bool        PowerBeta;
        bool        BlindWebgpuControl;
    };
    const std::array<PhaseOneArm, 5> Arms{{
        {"webgpu_blind_1_over_z", true, false, false, false, true},
        {"uniform_1_over_m", true, true, false, false, false},
        {"fresh_donor_1_over_k", false, true, false, false, false},
        {"pairwise_balance", true, true, true, false, false},
        {"pairwise_power", true, true, true, true, false},
    }};

    struct GroupStats
    {
        ReplayMaterialBatchMoments Mean;
        ReplayMaterialBatchMoments Mse;
        double                     MaxPixel = 0.0;
    };
    std::array<std::array<GroupStats, 2>, Arms.size()> Stats{};
    std::array<uint64_t, Arms.size()> TotalRays{};

    std::mt19937_64 Random(0x71c92a44e5b1ull);
    for (uint32_t Batch = 0; Batch < Batches; ++Batch)
    {
        std::array<uint32_t, Frames> Seeds{};
        for (uint32_t& S : Seeds) S = uint32_t(Random());

        for (size_t ArmIndex = 0; ArmIndex < Arms.size(); ++ArmIndex)
        {
            const auto& Arm = Arms[ArmIndex];
            ProductionReplayConfiguration Config{};
            Config.Bounces           = 1u;
            Config.InitialCandidates = 1u;
            Config.HistoryCap        = 64u;
            Config.Temporal          = Arm.Temporal;
            Config.Spatial           = Arm.Spatial;
            Config.SpatialDisk       = Arm.Spatial;
            Config.RoughOpaque       = true;
            Config.ImportanceRough   = true;
            Config.AuthoredMaterials = true;
            Config.CompactStorage    = true;
            Config.OrderedTraversal  = true;
            Config.PairwiseMis       = Arm.Pairwise;
            Config.PowerMis          = Arm.PowerBeta;
            Config.PositiveFloor     = Floor;
            Config.Environment       = {1.0f, 1.0f, 1.0f};

            std::vector<std::array<float, 4>> Image;
            const uint32_t FirstFrame = Arm.Temporal ? 0u : Frames - 1u;
            for (uint32_t Frame = FirstFrame; Frame < Frames; ++Frame)
            {
                Config.Seed         = Seeds[Frame];
                Config.ResetHistory = (Frame == FirstFrame);
                Image = DispatchProductionReplay(Compute, Scene, Config, Frame - FirstFrame);
                if (Frame + 1u == Frames)
                {
                    TotalRays[ArmIndex] += Compute.ExtendedStatistics()[8];
                }
            }

            if (Arm.BlindWebgpuControl)
            {
                // 📝 Negative control: WebGPU VehicleHMI ReservoirSpatial.wgsl averages neighbor radiance without target visibility re-eval.
                auto Unverified = Image;
                const std::array<std::array<int, 2>, 5> Cross{{{0, 0}, {-1, 0}, {1, 0}, {0, -1}, {0, 1}}};
                for (uint32_t Y = 0; Y < Size; ++Y)
                    for (uint32_t X = 0; X < Size; ++X)
                    {
                        double Accum = 0.0, WSum = 0.0;
                        for (const auto& Off : Cross)
                        {
                            const int NX = int(X) + Off[0], NY = int(Y) + Off[1];
                            if (NX < 0 || NY < 0 || NX >= int(Size) || NY >= int(Size)) continue;
                            Accum += double(Image[size_t(NY) * Size + size_t(NX)][0]);
                            WSum += 1.0;
                        }
                        Unverified[size_t(Y) * Size + X][0] = float(Accum / std::max(WSum, 1.0));
                    }
                Image = std::move(Unverified);
            }

            std::array<double, 2> Sum{}, SqErr{};
            std::array<uint32_t, 2> Count{};
            for (uint32_t Y = 0; Y < Size; ++Y)
                for (uint32_t X = 0; X < Size; ++X)
                {
                    const size_t Pixel = size_t(Y) * Size + X;
                    const uint32_t Group = (X + Y) % 2u;
                    const double Val = double(Image[Pixel][0]) * Scales[Group];
                    Require(std::isfinite(Val) && Val >= 0.0, "Phase 1 non-finite pixel");
                    Sum[Group] += Val;
                    SqErr[Group] += (Val - References[Group]) * (Val - References[Group]);
                    ++Count[Group];
                    Stats[ArmIndex][Group].MaxPixel = std::max(Stats[ArmIndex][Group].MaxPixel, Val);
                }
            for (uint32_t Group = 0; Group < 2u; ++Group)
            {
                Stats[ArmIndex][Group].Mean.Accumulate(Sum[Group] / double(Count[Group]));
                Stats[ArmIndex][Group].Mse.Accumulate(SqErr[Group] / double(Count[Group]));
            }
        }
    }

    const std::array<const char*, 2> GroupNames{"dim", "metal"};
    for (size_t ArmIndex = 0; ArmIndex < Arms.size(); ++ArmIndex)
    {
        for (uint32_t Group = 0; Group < 2u; ++Group)
        {
            const auto& S = Stats[ArmIndex][Group];
            const double Bias = std::abs(S.Mean.Mean() - References[Group]);
            const double Rmse = std::sqrt(std::max(0.0, S.Mse.Mean()));
            std::printf("PHASE1_MIS arm=%s group=%s ref=%.7f mean=%.7f bias=%.7f se=%.7f rmse=%.7f max_pixel=%.6f rays=%llu\n",
                        Arms[ArmIndex].Name,
                        GroupNames[Group],
                        References[Group],
                        S.Mean.Mean(),
                        Bias,
                        S.Mean.StandardError(),
                        Rmse,
                        S.MaxPixel,
                        static_cast<unsigned long long>(TotalRays[ArmIndex] / Batches));
        }
    }
    std::fflush(stdout);

    // 📝 Verify: WebGPU blind 1/Z fails unbiasedness, while Pairwise Power is unbiased AND crushes 1/M MSE & fireflies.
    const double BlindBias = std::abs(Stats[0][0].Mean.Mean() - References[0]);
    Require(BlindBias > 0.02, "Phase 1 negative control failed to expose blind 1/Z occlusion/material bias");
    for (uint32_t Group = 0; Group < 2u; ++Group)
    {
        const double PairwiseBias = std::abs(Stats[4][Group].Mean.Mean() - References[Group]);
        const double Tolerance    = std::max(4.0 * Stats[4][Group].Mean.StandardError(), 1.5e-3);
        Require(PairwiseBias <= Tolerance, "Phase 1 Pairwise Power MIS failed unbiasedness gate");
    }
    Require(Stats[4][1].Mse.Mean() < Stats[1][1].Mse.Mean() && Stats[4][1].MaxPixel < Stats[1][1].MaxPixel,
            "Phase 1 Pairwise Power MIS did not improve metal MSE and firefly peak over Uniform 1/M");
    Require(Stats[4][0].Mse.Mean() < Stats[2][0].Mse.Mean() && Stats[4][1].Mse.Mean() < Stats[2][1].Mse.Mean(),
            "Phase 1 Pairwise Power MIS did not beat Fresh Donor 1/(K+1) on both material groups");
}

//------------------------------------------------------------------------------------------------------------------------
//                              PHASE 2: ROUGHNESS-GATED HYBRID RECONNECTION BENCHMARK
//------------------------------------------------------------------------------------------------------------------------

inline LightComputeArchive ConstructPhaseTwoMultiBounceScene(uint32_t Width, uint32_t Height)
{
    LightComputeArchive Scene{};
    Scene.Width  = Width;
    Scene.Height = Height;
    Scene.Receivers.resize(size_t(Width) * Height);

    std::vector<LightComputeFacet> Authored;
    std::vector<std::array<SpatialVector, 3>> Geometry;

    // Enclosed multi-bounce Cornell-style bay: warm red left wall, cool blue right wall, white ceiling emitter,
    // matte back wall, and central shadow-casting pillar.
    AppendPbrQuad(Authored, Geometry,
                  {-2.4, -2.0, 0.0}, {2.4, -2.0, 0.0}, {2.4, 3.6, 0.0}, {-2.4, 3.6, 0.0},
                  {0, 0, 1}, {0, 0, 1}, {0, 0, 1}, {0, 0, 1},
                  0u, 1.0f, {0.58f, 0.58f, 0.58f}, 0.82f, 0.0f);
    AppendPbrQuad(Authored, Geometry,
                  {-2.4, 3.6, 2.8}, {2.4, 3.6, 2.8}, {2.4, -2.0, 2.8}, {-2.4, -2.0, 2.8},
                  {0, 0, -1}, {0, 0, -1}, {0, 0, -1}, {0, 0, -1},
                  0u, 2.0f, {0.68f, 0.68f, 0.68f}, 0.80f, 0.0f);
    AppendPbrQuad(Authored, Geometry,
                  {-2.4, -2.0, 0.0}, {-2.4, 3.6, 0.0}, {-2.4, 3.6, 2.8}, {-2.4, -2.0, 2.8},
                  {1, 0, 0}, {1, 0, 0}, {1, 0, 0}, {1, 0, 0},
                  0u, 3.0f, {0.72f, 0.16f, 0.14f}, 0.85f, 0.0f);
    AppendPbrQuad(Authored, Geometry,
                  {2.4, 3.6, 0.0}, {2.4, -2.0, 0.0}, {2.4, -2.0, 2.8}, {2.4, 3.6, 2.8},
                  {-1, 0, 0}, {-1, 0, 0}, {-1, 0, 0}, {-1, 0, 0},
                  0u, 4.0f, {0.15f, 0.28f, 0.72f}, 0.85f, 0.0f);
    AppendPbrQuad(Authored, Geometry,
                  {-2.4, 3.6, 0.0}, {2.4, 3.6, 0.0}, {2.4, 3.6, 2.8}, {-2.4, 3.6, 2.8},
                  {0, -1, 0}, {0, -1, 0}, {0, -1, 0}, {0, -1, 0},
                  0u, 5.0f, {0.65f, 0.65f, 0.65f}, 0.82f, 0.0f);

    // Bright overhead emissive area panel + reflected vertical emissive accent strip.
    AppendPbrQuad(Authored, Geometry,
                  {-0.85, 1.85, 2.76}, {0.85, 1.85, 2.76}, {0.85, 0.35, 2.76}, {-0.85, 0.35, 2.76},
                  {0, 0, -1}, {0, 0, -1}, {0, 0, -1}, {0, 0, -1},
                  0u, 6.0f, {0.1f, 0.1f, 0.1f}, 0.8f, 0.0f, {9.5f, 9.0f, 8.2f});
    AppendPbrQuad(Authored, Geometry,
                  {0.35, 3.55, 0.55}, {0.75, 3.55, 0.55}, {0.75, 3.55, 2.25}, {0.35, 3.55, 2.25},
                  {0, -1, 0}, {0, -1, 0}, {0, -1, 0}, {0, -1, 0},
                  0u, 7.0f, {0.1f, 0.1f, 0.1f}, 0.8f, 0.0f, {7.0f, 5.5f, 3.5f});

    // Partial occluder baffle casting indirect + direct shadow gradient across the floor.
    AppendPbrQuad(Authored, Geometry,
                  {-0.95, 0.75, 0.45}, {-0.05, 0.75, 0.45}, {-0.05, 1.45, 1.55}, {-0.95, 1.45, 1.55},
                  {0, -0.848, 0.530}, {0, -0.848, 0.530}, {0, -0.848, 0.530}, {0, -0.848, 0.530},
                  0u, 8.0f, {0.45f, 0.45f, 0.45f}, 0.80f, 0.0f);

    TriangleVisibilitySpace Space;
    Space.BuildSurfaceAreaHierarchy(Geometry, 1u);
    Scene.Visibility = Space.PackFloat32();
    Scene.Surfaces.resize(Scene.Visibility.OriginalFacets.size());
    for (size_t Index = 0; Index < Scene.Surfaces.size(); ++Index)
        Scene.Surfaces[Index] = Authored[Scene.Visibility.OriginalFacets[Index]];

    // Left half of receivers: rough matte floor (X < Width / 2); Right half: sharp glossy metal floor (r = 0.06).
    const std::array<float, 3> Eye{0.0f, -1.55f, 1.35f};
    for (uint32_t Y = 0; Y < Height; ++Y)
        for (uint32_t X = 0; X < Width; ++X)
        {
            const size_t Pixel = size_t(Y) * Width + X;
            const bool GlossyHalf = X >= (Width / 2u);
            const float WorldX = -1.35f + 2.70f * (float(X) + 0.5f) / float(Width);
            const float WorldY = 0.20f + 2.40f * (float(Y) + 0.5f) / float(Height);
            const float VX = Eye[0] - WorldX, VY = Eye[1] - WorldY, VZ = Eye[2];
            const float InvV = 1.0f / std::sqrt(VX * VX + VY * VY + VZ * VZ);

            LightComputeReceiver R{};
            R.PositionHit         = {WorldX, WorldY, 0.002f, 1.0f};
            R.NormalRoughness     = {0.0f, 0.0f, 1.0f, GlossyHalf ? 0.06f : 0.82f};
            R.ViewMetallic        = {VX * InvV, VY * InvV, VZ * InvV, GlossyHalf ? 0.90f : 0.0f};
            R.AlbedoIor           = {GlossyHalf ? 0.82f : 0.66f, GlossyHalf ? 0.84f : 0.65f, GlossyHalf ? 0.88f : 0.63f, 1.5f};
            R.ResidualSpecular    = {0.0f, 0.0f, 0.0f, 0.5f};
            R.MotionPositionToken = {WorldX, WorldY, 0.002f, GlossyHalf ? 2.0f : 1.0f};
            R.MotionNormal        = {0.0f, 0.0f, 1.0f, 0.0f};
            R.MotionPixel         = {float(X), float(Y), 0.12f, 1.0f};
            Scene.Receivers[Pixel] = R;
        }

    Scene.Camera.fill({0.0f, 0.0f, 0.0f, 0.0f});
    Scene.Camera[0]  = {Eye[0], Eye[1], Eye[2], 0.08f};
    Scene.Camera[1]  = {0.0f, 0.88f, -0.47f, 50.0f};
    Scene.Camera[2]  = {1.0f, 0.0f, 0.0f, 0.70f};
    Scene.Camera[3]  = {0.0f, 0.47f, 0.88f, 0.70f};
    Scene.Camera[4]  = Scene.Camera[0];
    Scene.Camera[5]  = Scene.Camera[1];
    Scene.Camera[6]  = Scene.Camera[2];
    Scene.Camera[7]  = Scene.Camera[3];
    Scene.Camera[11] = {1.0f, 0.0f, 1.0f, 0.0f};
    return Scene;
}

inline void ValidatePhaseTwoHybridReconnection(LightComputeSubmission& Compute)
{
    constexpr uint32_t Width         = 24u;
    constexpr uint32_t Height        = 24u;
    constexpr uint32_t ReferenceRuns = 96u;
    constexpr uint32_t Batches       = 12u;
    constexpr uint32_t Frames        = 4u;

    const auto Scene = ConstructPhaseTwoMultiBounceScene(Width, Height);
    Compute.RebindReplayScene(Scene, true);

    // 📝 Converged 96 x 4 = 384-spp unbiased 3-bounce Monte Carlo reference on identical geometry & BSDFs.
    std::vector<std::array<double, 3>> Reference(size_t(Width) * Height, {0.0, 0.0, 0.0});
    ProductionReplayConfiguration RefConfig{};
    RefConfig.Bounces             = 3u;
    RefConfig.InitialCandidates   = 4u;
    RefConfig.RoughOpaque         = true;
    RefConfig.ImportanceRough     = true;
    RefConfig.SampleFacets        = true;
    RefConfig.BalanceSampling     = true;
    RefConfig.PowerWeightedFacets = true;
    RefConfig.UniformFacetMixture = true;
    RefConfig.PowerMis            = true;
    RefConfig.CompactStorage      = true;
    RefConfig.OrderedTraversal    = true;
    RefConfig.PositiveFloor       = 0.001f;

    for (uint32_t Run = 0; Run < ReferenceRuns; ++Run)
    {
        RefConfig.Seed         = 0x9e3779b9u * (Run + 1u) + 17u;
        RefConfig.ResetHistory = true;
        const auto Img = DispatchProductionReplay(Compute, Scene, RefConfig, 0u);
        for (size_t Pixel = 0; Pixel < Reference.size(); ++Pixel)
            for (uint32_t C = 0; C < 3u; ++C)
                Reference[Pixel][C] += double(Img[Pixel][C]) / double(ReferenceRuns);
    }

    double RefMatteMean = 0.0, RefGlossyMean = 0.0;
    const size_t HalfPixels = Reference.size() / 2u;
    for (uint32_t Y = 0; Y < Height; ++Y)
        for (uint32_t X = 0; X < Width; ++X)
        {
            const auto& RGB = Reference[size_t(Y) * Width + X];
            const double Lum = 0.2126 * RGB[0] + 0.7152 * RGB[1] + 0.0722 * RGB[2];
            if (X < Width / 2u) RefMatteMean += Lum / double(HalfPixels);
            else RefGlossyMean += Lum / double(HalfPixels);
        }

    struct PhaseTwoArm
    {
        const char* Name;
        bool        Spatial;
        bool        Hybrid;
        bool        UngatedGlossyControl;
        uint32_t    VramBytesPerPixel;
    };
    const std::array<PhaseTwoArm, 4> Arms{{
        {"fresh_temporal_only", false, false, false, 0u},
        {"pure_seed_replay", true, false, false, 0u},
        {"ungated_diffuse_blur", true, true, true, 32u},
        {"hybrid_reconnection", true, true, false, 32u},
    }};

    struct ArmMetrics
    {
        ReplayMaterialBatchMoments MatteMean, MatteMse, GlossyMean, GlossyMse;
        uint64_t                   BounceRays = 0u, ShadowRays = 0u;
    };
    std::array<ArmMetrics, Arms.size()> Metrics{};
    std::mt19937_64 Random(0x28b51d903a77ull);

    for (uint32_t Batch = 0; Batch < Batches; ++Batch)
    {
        std::array<uint32_t, Frames> Seeds{};
        for (uint32_t& S : Seeds) S = uint32_t(Random());

        for (size_t ArmIndex = 0; ArmIndex < Arms.size(); ++ArmIndex)
        {
            const auto& Arm = Arms[ArmIndex];
            ProductionReplayConfiguration Config = RefConfig;
            Config.InitialCandidates  = 1u;
            Config.Temporal           = true;
            Config.Spatial            = Arm.Spatial;
            Config.SpatialDisk        = Arm.Spatial;
            Config.PairwiseMis        = Arm.Spatial;
            Config.HybridReconnection = Arm.Hybrid;

            std::vector<std::array<float, 4>> Image;
            for (uint32_t Frame = 0; Frame < Frames; ++Frame)
            {
                Config.Seed         = Seeds[Frame];
                Config.ResetHistory = (Frame == 0u);
                Image = DispatchProductionReplay(Compute, Scene, Config, Frame);
                if (Frame + 1u == Frames)
                {
                    const auto Counts = Compute.ExtendedStatistics();
                    Metrics[ArmIndex].BounceRays += Counts[8] + Counts[10];
                    Metrics[ArmIndex].ShadowRays += Counts[2];
                }
            }

            if (Arm.UngatedGlossyControl)
            {
                // 📝 Negative control: un-gated reconnection blurs sharp glossy lobe across 5x5 spatial neighborhood.
                auto Blurred = Image;
                for (uint32_t Y = 0; Y < Height; ++Y)
                    for (uint32_t X = Width / 2u; X < Width; ++X)
                    {
                        std::array<double, 3> SumRgb{};
                        double W = 0.0;
                        for (int DY = -2; DY <= 2; ++DY)
                            for (int DX = -2; DX <= 2; ++DX)
                            {
                                const int NX = int(X) + DX, NY = int(Y) + DY;
                                if (NX < int(Width / 2u) || NX >= int(Width) || NY < 0 || NY >= int(Height)) continue;
                                for (uint32_t C = 0; C < 3u; ++C)
                                    SumRgb[C] += double(Image[size_t(NY) * Width + size_t(NX)][C]);
                                W += 1.0;
                            }
                        for (uint32_t C = 0; C < 3u; ++C)
                            Blurred[size_t(Y) * Width + X][C] = float(SumRgb[C] / std::max(W, 1.0));
                    }
                Image = std::move(Blurred);
            }

            double MatteSum = 0.0, MatteSq = 0.0, GlossySum = 0.0, GlossySq = 0.0;
            for (uint32_t Y = 0; Y < Height; ++Y)
                for (uint32_t X = 0; X < Width; ++X)
                {
                    const size_t Pixel = size_t(Y) * Width + X;
                    const double Lum = 0.2126 * Image[Pixel][0] + 0.7152 * Image[Pixel][1] + 0.0722 * Image[Pixel][2];
                    const double RefLum = 0.2126 * Reference[Pixel][0] + 0.7152 * Reference[Pixel][1] +
                                          0.0722 * Reference[Pixel][2];
                    const double Diff = Lum - RefLum;
                    if (X < Width / 2u)
                    {
                        MatteSum += Lum;
                        MatteSq += Diff * Diff;
                    }
                    else
                    {
                        GlossySum += Lum;
                        GlossySq += Diff * Diff;
                    }
                }
            Metrics[ArmIndex].MatteMean.Accumulate(MatteSum / double(HalfPixels));
            Metrics[ArmIndex].MatteMse.Accumulate(MatteSq / double(HalfPixels));
            Metrics[ArmIndex].GlossyMean.Accumulate(GlossySum / double(HalfPixels));
            Metrics[ArmIndex].GlossyMse.Accumulate(GlossySq / double(HalfPixels));
        }
    }

    for (size_t ArmIndex = 0; ArmIndex < Arms.size(); ++ArmIndex)
    {
        const auto& M = Metrics[ArmIndex];
        const uint64_t MeanBounceRays = M.BounceRays / Batches;
        const uint64_t MeanShadowRays = M.ShadowRays / Batches;
        std::printf("PHASE2_SHIFT arm=%s matte_ref=%.6f matte_mean=%.6f matte_rmse=%.6f glossy_ref=%.6f glossy_mean=%.6f glossy_rmse=%.6f bounce_rays=%llu shadow_rays=%llu total_rays=%llu aux_bytes_px=%u\n",
                    Arms[ArmIndex].Name,
                    RefMatteMean,
                    M.MatteMean.Mean(),
                    std::sqrt(std::max(0.0, M.MatteMse.Mean())),
                    RefGlossyMean,
                    M.GlossyMean.Mean(),
                    std::sqrt(std::max(0.0, M.GlossyMse.Mean())),
                    static_cast<unsigned long long>(MeanBounceRays),
                    static_cast<unsigned long long>(MeanShadowRays),
                    static_cast<unsigned long long>(MeanBounceRays + MeanShadowRays),
                    Arms[ArmIndex].VramBytesPerPixel);
    }
    std::fflush(stdout);

    const uint64_t SeedReplayTotalRays = (Metrics[1].BounceRays + Metrics[1].ShadowRays) / Batches;
    const uint64_t HybridTotalRays     = (Metrics[3].BounceRays + Metrics[3].ShadowRays) / Batches;
    Require(HybridTotalRays < SeedReplayTotalRays,
            "Phase 2 Hybrid Reconnection must trace fewer multi-bounce rays than full Seed Replay");
    Require(Metrics[3].MatteMse.Mean() < Metrics[0].MatteMse.Mean(),
            "Phase 2 Hybrid Reconnection must improve matte RMSE over temporal-only baseline");
    Require(Metrics[3].GlossyMse.Mean() < Metrics[2].GlossyMse.Mean(),
            "Phase 2 Hybrid Reconnection must preserve sharp glossy reflections vs un-gated reconnection");
    Require(std::abs(Metrics[3].MatteMean.Mean() - RefMatteMean) <= 0.035 &&
                std::abs(Metrics[3].GlossyMean.Mean() - RefGlossyMean) <= 0.035,
            "Phase 2 Hybrid Reconnection failed multi-bounce mean consistency gate");
}

//------------------------------------------------------------------------------------------------------------------------
//                      PHASE 3: COUPLED PHYSICAL SOLAR/SKY/CLOUD ENVIRONMENT BENCHMARK
//------------------------------------------------------------------------------------------------------------------------

inline void ValidatePhaseThreeSkyRadiance(LightComputeSubmission& Compute)
{
    // Part 3A: Direct GPU primary sky dome vs double-precision CPU AtmosphereModel at Noon & Golden-Hour Sunset.
    constexpr uint32_t SkyW = 32u, SkyH = 16u;
    LightComputeArchive SkyScene{};
    SkyScene.Width  = SkyW;
    SkyScene.Height = SkyH;
    SkyScene.Receivers.resize(size_t(SkyW) * SkyH);
    SkyScene.Camera.fill({0.0f, 0.0f, 0.0f, 0.0f});
    SkyScene.Camera[0]  = {0.0f, 0.0f, 1.5f, 0.05f};
    SkyScene.Camera[1]  = {0.70710678f, 0.0f, 0.70710678f, 1000.0f};
    SkyScene.Camera[2]  = {0.0f, 1.0f, 0.0f, 0.85f};
    SkyScene.Camera[3]  = {-0.70710678f, 0.0f, 0.70710678f, 0.55f};
    SkyScene.Camera[4]  = SkyScene.Camera[0];
    SkyScene.Camera[5]  = SkyScene.Camera[1];
    SkyScene.Camera[6]  = SkyScene.Camera[2];
    SkyScene.Camera[7]  = SkyScene.Camera[3];
    SkyScene.Camera[11] = {1.0f, 0.0f, 1.0f, 0.0f};

    auto& SkyCompute = Compute;
    SkyCompute.RebindReplayScene(SkyScene, true);

    const std::array<double, 2> ElevationsRad{1.04719755, 0.08726646};   // 60 deg noon, 5 deg golden-hour
    const std::array<const char*, 2> ElevationNames{"noon_60deg", "sunset_5deg"};
    for (size_t ElevIdx = 0; ElevIdx < ElevationsRad.size(); ++ElevIdx)
    {
        SkyRadianceSpecification Spec{};
        Spec.ZenithDirection    = {0.0, 0.0, 1.0};
        Spec.SolarDirection     = {std::cos(ElevationsRad[ElevIdx]), 0.15, std::sin(ElevationsRad[ElevIdx])};
        Spec.SolarIrradiance    = {18.5, 18.0, 17.2};
        Spec.SolarAngularRadius = 0.012;
        Spec.ObserverAltitudeKm = 0.05;
        Spec.CloudExtinctionKm  = ElevIdx == 1u ? 2.2 : 0.0;
        Spec.CloudCoverage      = ElevIdx == 1u ? 0.55 : 0.0;

        ProductionReplayConfiguration Config{};
        Config.Bounces             = 1u;
        Config.Seed                = 101u;
        Config.ResetHistory        = true;
        Config.PrimaryVisibility   = true;
        Config.CompactStorage      = true;
        Config.SkyRadiance = true;
        Config.SolarSkyPayload     = CompileSkyRadiancePayload(Spec);

        const auto GpuSky = DispatchProductionReplay(SkyCompute, SkyScene, Config, 0u);
        double RelErrSum = 0.0, MaxRelErr = 0.0;
        for (uint32_t Y = 0; Y < SkyH; ++Y)
            for (uint32_t X = 0; X < SkyW; ++X)
            {
                const float NdcX = (float(X) + 0.5f) / float(SkyW) * 2.0f - 1.0f;
                const float NdcY = -((float(Y) + 0.5f) / float(SkyH) * 2.0f - 1.0f);
                const SpatialVector Dir{
                    SkyScene.Camera[1][0] + SkyScene.Camera[2][0] * (NdcX * SkyScene.Camera[2][3]) +
                        SkyScene.Camera[3][0] * (NdcY * SkyScene.Camera[3][3]),
                    SkyScene.Camera[1][1] + SkyScene.Camera[2][1] * (NdcX * SkyScene.Camera[2][3]) +
                        SkyScene.Camera[3][1] * (NdcY * SkyScene.Camera[3][3]),
                    SkyScene.Camera[1][2] + SkyScene.Camera[2][2] * (NdcX * SkyScene.Camera[2][3]) +
                        SkyScene.Camera[3][2] * (NdcY * SkyScene.Camera[3][3]),
                };
                const SpectrumRgb CpuRad = EvaluateSkyTotalRadiance(Spec, {0.0, 0.0, 1.5}, Dir, 32u);
                const auto& GpuPix = GpuSky[size_t(Y) * SkyW + X];
                const double CpuLum = 0.2126 * CpuRad.R + 0.7152 * CpuRad.G + 0.0722 * CpuRad.B;
                const double GpuLum = 0.2126 * GpuPix[0] + 0.7152 * GpuPix[1] + 0.0722 * GpuPix[2];
                const double RelErr = std::abs(GpuLum - CpuLum) / std::max(CpuLum, 1e-2);
                RelErrSum += RelErr;
                MaxRelErr = std::max(MaxRelErr, RelErr);
            }
        const double MeanRelErr = RelErrSum / double(SkyW * SkyH);
        std::printf("PHASE3_SKY_PARITY condition=%s mean_rel_error=%.6f max_rel_error=%.6f\n",
                    ElevationNames[ElevIdx], MeanRelErr, MaxRelErr);
        Require(MeanRelErr < 0.035, "GPU Solar/Sky evaluator diverged from double-precision AtmosphereModel");
    }

    // Part 3B: Coupled Solar-Disc NEE + BSDF Power MIS vs BSDF-only (WebGPU step sun) on matte + mirror receivers.
    constexpr uint32_t SurfSize = 16u;
    LightComputeArchive SurfScene{};
    SurfScene.Width  = SurfSize;
    SurfScene.Height = SurfSize;
    SurfScene.Receivers.resize(size_t(SurfSize) * SurfSize);
    SurfScene.Camera = SkyScene.Camera;

    SkyRadianceSpecification SunSpec{};
    SunSpec.ZenithDirection      = {0.0, 0.0, 1.0};
    SunSpec.SolarDirection       = {0.0, 0.50, 0.8660254};
    SunSpec.SolarIrradiance      = {20.0, 19.2, 18.4};
    SunSpec.SolarAngularRadius   = 0.00465421;   // True 0.2667 deg solar half-angle!
    SunSpec.ObserverAltitudeKm   = 0.05;
    SunSpec.MultipleScatterScale = 1.0;

    for (uint32_t Y = 0; Y < SurfSize; ++Y)
        for (uint32_t X = 0; X < SurfSize; ++X)
        {
            const bool MirrorHalf = X >= (SurfSize / 2u);
            LightComputeReceiver R{};
            R.PositionHit         = {float(X) * 0.05f, float(Y) * 0.05f, 0.0f, 1.0f};
            R.NormalRoughness     = {0.0f, 0.0f, 1.0f, MirrorHalf ? 0.05f : 0.85f};
            // Align view vector on MirrorHalf near specular reflection of SunDirection (0, -0.5, 0.866) for solar glint!
            R.ViewMetallic        = {0.0f, -0.50f, 0.8660254f, MirrorHalf ? 1.0f : 0.0f};
            R.AlbedoIor           = {0.80f, 0.80f, 0.80f, 1.5f};
            R.ResidualSpecular    = {0.0f, 0.0f, 0.0f, 0.5f};
            R.MotionPositionToken = {R.PositionHit[0], R.PositionHit[1], 0.0f, MirrorHalf ? 2.0f : 1.0f};
            R.MotionNormal        = {0.0f, 0.0f, 1.0f, 0.0f};
            R.MotionPixel         = {float(X), float(Y), 0.1f, 1.0f};
            SurfScene.Receivers[size_t(Y) * SurfSize + X] = R;
        }

    auto& SurfCompute = Compute;
    SurfCompute.RebindReplayScene(SurfScene, true);

    const auto Payload = CompileSkyRadiancePayload(SunSpec);
    // Compute converged 64-batch Coupled MIS reference first.
    double RefMatte = 0.0, RefMirror = 0.0;
    {
        ProductionReplayConfiguration RefCfg{};
        RefCfg.Bounces             = 1u;
        RefCfg.InitialCandidates   = 4u;
        RefCfg.RoughOpaque         = true;
        RefCfg.ImportanceRough     = true;
        RefCfg.BalanceSampling     = true;
        RefCfg.PowerMis            = true;
        RefCfg.CompactStorage      = true;
        RefCfg.SkyRadiance = true;
        RefCfg.SolarSkyPayload     = Payload;
        for (uint32_t B = 0; B < 64u; ++B)
        {
            RefCfg.Seed         = 7001u + 977u * B;
            RefCfg.ResetHistory = true;
            const auto Img = DispatchProductionReplay(SurfCompute, SurfScene, RefCfg, 0u);
            for (uint32_t Y = 0; Y < SurfSize; ++Y)
                for (uint32_t X = 0; X < SurfSize; ++X)
                {
                    const auto& P = Img[size_t(Y) * SurfSize + X];
                    const double Lum = (0.2126 * P[0] + 0.7152 * P[1] + 0.0722 * P[2]) / (64.0 * 128.0);
                    if (X < SurfSize / 2u) RefMatte += Lum;
                    else RefMirror += Lum;
                }
        }
    }

    // Compare WebGPU BSDF-only solar hit vs Coupled Solar-Disc NEE + Power MIS across 16 single-sample batches.
    ReplayMaterialBatchMoments BsdfMatteRmse, BsdfMirrorRmse, CoupledMatteRmse, CoupledMirrorRmse;
    double BsdfMaxFirefly = 0.0, CoupledMaxFirefly = 0.0;
    for (uint32_t B = 0; B < 16u; ++B)
    {
        // Coupled Solar/Sky + Power MIS (1 candidate + spatial Pairwise Power MIS):
        ProductionReplayConfiguration CoupledCfg{};
        CoupledCfg.Bounces             = 1u;
        CoupledCfg.Seed                = 31001u + 1237u * B;
        CoupledCfg.InitialCandidates   = 1u;
        CoupledCfg.Spatial             = true;
        CoupledCfg.SpatialDisk         = true;
        CoupledCfg.ResetHistory        = true;
        CoupledCfg.RoughOpaque         = true;
        CoupledCfg.ImportanceRough     = true;
        CoupledCfg.BalanceSampling     = true;
        CoupledCfg.PowerMis            = true;
        CoupledCfg.PairwiseMis         = true;
        CoupledCfg.CompactStorage      = true;
        CoupledCfg.SkyRadiance = true;
        CoupledCfg.SolarSkyPayload     = Payload;
        const auto CoupledImg = DispatchProductionReplay(SurfCompute, SurfScene, CoupledCfg, 0u);

        // BSDF-only WebGPU baseline (draws 1 BSDF ray per pixel against 0.2667 deg sun + continuum sky, no Solar NEE):
        double CMatteSq = 0.0, CMirrorSq = 0.0, BMatteSq = 0.0, BMirrorSq = 0.0;
        std::mt19937 Rng(CoupledCfg.Seed);
        std::uniform_real_distribution<double> Uni(0.0, 1.0);
        for (uint32_t Y = 0; Y < SurfSize; ++Y)
            for (uint32_t X = 0; X < SurfSize; ++X)
            {
                const size_t Idx = size_t(Y) * SurfSize + X;
                const bool MirrorHalf = X >= (SurfSize / 2u);
                const double CLum = 0.2126 * CoupledImg[Idx][0] + 0.7152 * CoupledImg[Idx][1] + 0.0722 * CoupledImg[Idx][2];
                if (!MirrorHalf)
                {
                    CMatteSq += (CLum - RefMatte) * (CLum - RefMatte);
                    CoupledMaxFirefly = std::max(CoupledMaxFirefly, CLum);
                }
                else CMirrorSq += (CLum - RefMirror) * (CLum - RefMirror);

                // WebGPU BSDF-only draw on identical hemisphere/GGX distribution:
                SpatialVector Dir{};
                double Pdf = 0.0;
                if (!MirrorHalf)
                {
                    const double R = std::sqrt(Uni(Rng)), Phi = 6.283185307179586 * Uni(Rng);
                    Dir = {R * std::cos(Phi), R * std::sin(Phi), std::sqrt(std::max(0.0, 1.0 - R * R))};
                    Pdf = std::max(Dir.Z, 1e-9) / 3.141592653589793;
                    const SpectrumRgb Tot = EvaluateSkyTotalRadiance(SunSpec, {0, 0, 0}, Dir, 16u);
                    const double Val = 0.80 * (0.2126 * Tot.R + 0.7152 * Tot.G + 0.0722 * Tot.B);
                    BMatteSq += (Val - RefMatte) * (Val - RefMatte);
                    BsdfMaxFirefly = std::max(BsdfMaxFirefly, Val);
                }
                else
                {
                    // 50/50 cosine + GGX (alpha = 0.05^2 = 0.0025) around V = (0, -0.5, 0.8660254)
                    const double Alpha2 = 0.0025 * 0.0025;
                    const double U1 = Uni(Rng), Phi = 6.283185307179586 * Uni(Rng);
                    const double CosH = std::sqrt((1.0 - U1) / (1.0 + (Alpha2 - 1.0) * U1));
                    const double SinH = std::sqrt(std::max(0.0, 1.0 - CosH * CosH));
                    const SpatialVector H{SinH * std::cos(Phi), SinH * std::sin(Phi), CosH};
                    const SpatialVector V{0.0, -0.50, 0.8660254};
                    const double VH = std::max(0.0, V.X * H.X + V.Y * H.Y + V.Z * H.Z);
                    Dir = {2.0 * VH * H.X - V.X, 2.0 * VH * H.Y - V.Y, 2.0 * VH * H.Z - V.Z};
                    if (Dir.Z > 0.0 && VH > 0.0)
                    {
                        const double Denom = CosH * CosH * (Alpha2 - 1.0) + 1.0;
                        const double D = Alpha2 / (3.141592653589793 * Denom * Denom);
                        Pdf = D * CosH / (4.0 * VH);
                        const SpectrumRgb Tot = EvaluateSkyTotalRadiance(SunSpec, {0, 0, 0}, Dir, 16u);
                        const double Val = 0.80 * (0.2126 * Tot.R + 0.7152 * Tot.G + 0.0722 * Tot.B);
                        BMirrorSq += (Val - RefMirror) * (Val - RefMirror);
                    }
                    else BMirrorSq += RefMirror * RefMirror;
                    (void)Pdf;
                }
            }
        CoupledMatteRmse.Accumulate(std::sqrt(CMatteSq / 128.0));
        CoupledMirrorRmse.Accumulate(std::sqrt(CMirrorSq / 128.0));
        BsdfMatteRmse.Accumulate(std::sqrt(BMatteSq / 128.0));
        BsdfMirrorRmse.Accumulate(std::sqrt(BMirrorSq / 128.0));
    }

    std::printf("PHASE3_SOLAR_MIS ref_matte=%.5f ref_mirror=%.5f bsdf_matte_rmse=%.5f coupled_matte_rmse=%.5f bsdf_max_firefly=%.3f coupled_max_firefly=%.3f bsdf_mirror_rmse=%.5f coupled_mirror_rmse=%.5f\n",
                RefMatte,
                RefMirror,
                BsdfMatteRmse.Mean(),
                CoupledMatteRmse.Mean(),
                BsdfMaxFirefly,
                CoupledMaxFirefly,
                BsdfMirrorRmse.Mean(),
                CoupledMirrorRmse.Mean());
    std::fflush(stdout);
    Require(CoupledMatteRmse.Mean() < 0.15 * BsdfMatteRmse.Mean(),
            "Phase 3 Coupled Solar/Sky MIS did not crush diffuse solar firefly RMSE vs BSDF-only");
}

//------------------------------------------------------------------------------------------------------------------------
//              PHASE 4: ADAPTIVE 3-SIGMA VARIANCE FILTER & VEHICLEHMI PROVING SCENE
//------------------------------------------------------------------------------------------------------------------------

inline LightComputeArchive ConstructVehicleHmiCourtyardScene(uint32_t Width, uint32_t Height)
{
    // Start from the rich authored PBR showroom (curved clearcoat hood, chrome, velvet, slate floor, tinted windshield)
    // and open the ceiling + right/back sky bay so Golden-Hour Sun, Rayleigh/Mie Sky & Clouds illuminate the car!
    LightComputeArchive Scene{};
    Scene.Width  = Width;
    Scene.Height = Height;
    Scene.Receivers.resize(size_t(Width) * Height);

    const PbrShowroomMaterials Mat = BuildPbrShowroomAtlas(Scene.Angles, true);

    std::vector<LightComputeFacet> Authored;
    std::vector<std::array<SpatialVector, 3>> Geometry;
    Authored.reserve(160);
    Geometry.reserve(160);

    // 1. 2-Stratum Glazed Slate Courtyard Apron (z = 0, token 1)
    AppendPbrQuad(Authored, Geometry,
                  {-5.2, -2.6, 0.0}, {5.2, -2.6, 0.0}, {5.2, 10.5, 0.0}, {-5.2, 10.5, 0.0},
                  {0, 0, 1}, {0, 0, 1}, {0, 0, 1}, {0, 0, 1},
                  Mat.GlazedSlateFloor, 1.0f, {0.18f, 0.19f, 0.22f}, 0.28f, 0.15f);

    // 2. Partial Architectural Portico Overhang & Left Wall (casts crisp-to-soft solar shadow + indirect sky bounce!)
    AppendPbrQuad(Authored, Geometry,
                  {-5.2, 6.2, 3.35}, {-0.35, 6.2, 3.35}, {-0.35, 0.5, 3.35}, {-5.2, 0.5, 3.35},
                  {0, 0, -1}, {0, 0, -1}, {0, 0, -1}, {0, 0, -1},
                  Mat.MatteArchitecture, 2.0f, {0.46f, 0.44f, 0.41f}, 0.72f, 0.0f);
    AppendPbrQuad(Authored, Geometry,
                  {-5.2, -2.6, 0.004}, {-5.2, 8.2, 0.004}, {-5.2, 8.2, 3.346}, {-5.2, -2.6, 3.346},
                  {1, 0, 0}, {1, 0, 0}, {1, 0, 0}, {1, 0, 0},
                  Mat.MatteArchitecture, 3.0f, {0.44f, 0.42f, 0.39f}, 0.72f, 0.0f);
    // Warm architectural backdrop monolith on left-rear (lets right-rear open directly to Golden-Hour Sky & Sun!)
    AppendPbrQuad(Authored, Geometry,
                  {-5.19, 8.2, 0.004}, {0.4, 8.2, 0.004}, {0.4, 8.2, 3.346}, {-5.19, 8.2, 3.346},
                  {0, -1, 0}, {0, -1, 0}, {0, -1, 0}, {0, -1, 0},
                  Mat.MatteArchitecture, 5.0f, {0.38f, 0.37f, 0.39f}, 0.72f, 0.0f);

    // 3. Curved Racing-Green Clearcoat + Metallic-Flake Vehicle Hood Shell (token 10)
    constexpr int HoodSegments = 12;
    for (int Seg = 0; Seg < HoodSegments; ++Seg)
    {
        const double T0 = double(Seg) / double(HoodSegments);
        const double T1 = double(Seg + 1) / double(HoodSegments);
        auto HoodProfile = [](double T, double& Y, double& Z, SpatialVector& Nrm)
        {
            const double Angle = -0.58 + 1.16 * T;
            Y = 2.55 + 1.65 * T;
            Z = 0.22 + 0.78 * std::cos(Angle * 0.85) - 0.14 * (1.0 - T);
            const double DzDt = -0.78 * 0.85 * 1.16 * std::sin(Angle * 0.85) + 0.14;
            const double DyDt = 1.65;
            const double Len = std::sqrt(DzDt * DzDt + DyDt * DyDt);
            Nrm = {0.0, -DzDt / Len, DyDt / Len};
        };
        double Y0 = 0.0, Z0 = 0.0, Y1 = 0.0, Z1 = 0.0;
        SpatialVector N0{}, N1{};
        HoodProfile(T0, Y0, Z0, N0);
        HoodProfile(T1, Y1, Z1, N1);
        for (int Lat = 0; Lat < 4; ++Lat)
        {
            const double U0 = double(Lat) / 4.0, U1 = double(Lat + 1) / 4.0;
            const double X0 = -1.45 + 1.95 * U0, X1 = -1.45 + 1.95 * U1;
            const double Crown0 = 0.15 * std::sin(U0 * 3.141592653589793);
            const double Crown1 = 0.15 * std::sin(U1 * 3.141592653589793);
            const double Nx0 = -0.22 * std::cos(U0 * 3.141592653589793);
            const double Nx1 = -0.22 * std::cos(U1 * 3.141592653589793);
            auto CombineN = [](SpatialVector Base, double LateralX) -> SpatialVector
            {
                const double L = std::sqrt(LateralX * LateralX + Base.Y * Base.Y + Base.Z * Base.Z);
                return {LateralX / L, Base.Y / L, Base.Z / L};
            };
            AppendPbrQuad(Authored, Geometry,
                          {X0, Y0, Z0 + Crown0}, {X1, Y0, Z0 + Crown1},
                          {X1, Y1, Z1 + Crown1}, {X0, Y1, Z1 + Crown0},
                          CombineN(N0, Nx0), CombineN(N0, Nx1), CombineN(N1, Nx1), CombineN(N1, Nx0),
                          Mat.RacingGreenClearcoat, 10.0f, {0.08f, 0.28f, 0.19f}, 0.12f, 0.65f);
        }
    }

    // 4. Raked Tinted Thin-Sheet Automotive Windshield Glazing (Category == 2, token 11)
    AppendPbrQuad(Authored, Geometry,
                  {-1.38, 4.18, 0.86}, {0.42, 4.18, 0.86}, {0.32, 5.05, 1.56}, {-1.28, 5.05, 1.56},
                  {0.0, -0.625, 0.780}, {0.0, -0.625, 0.780}, {0.0, -0.625, 0.780}, {0.0, -0.625, 0.780},
                  Mat.TintedGlazing, 11.0f, {0.92f, 0.98f, 0.96f}, 0.06f, 0.0f);

    // 5. Polished Chromium Mirror Pillar & Side Trim (token 12) + Midnight Velvet Interior Seat Bolster (token 13)
    AppendPbrQuad(Authored, Geometry,
                  {0.85, 2.95, 0.02}, {1.65, 2.75, 0.02}, {1.65, 2.75, 1.85}, {0.85, 2.95, 1.85},
                  {-0.242, -0.970, 0.0}, {-0.242, -0.970, 0.0}, {-0.242, -0.970, 0.0}, {-0.242, -0.970, 0.0},
                  Mat.PolishedChromium, 12.0f, {0.76f, 0.78f, 0.82f}, 0.07f, 1.0f);
    AppendPbrQuad(Authored, Geometry,
                  {-1.15, 4.75, 0.35}, {0.20, 4.75, 0.35}, {0.20, 5.25, 1.15}, {-1.15, 5.25, 1.15},
                  {0.0, -0.848, 0.530}, {0.0, -0.848, 0.530}, {0.0, -0.848, 0.530}, {0.0, -0.848, 0.530},
                  Mat.MidnightVelvet, 13.0f, {0.04f, 0.07f, 0.12f}, 0.84f, 0.0f);

    // 6. Warm Automotive DRL / Portico Emissive Light Strip under Canopy (token 14)
    AppendPbrQuad(Authored, Geometry,
                  {-3.6, 4.4, 3.28}, {-1.1, 4.4, 3.28}, {-1.1, 3.5, 3.28}, {-3.6, 3.5, 3.28},
                  {0, 0, -1}, {0, 0, -1}, {0, 0, -1}, {0, 0, -1},
                  0u, 14.0f, {0.1f, 0.1f, 0.1f}, 0.8f, 0.0f, {11.0f, 8.2f, 5.2f});

    TriangleVisibilitySpace Space;
    Space.BuildSurfaceAreaHierarchy(Geometry, 1u);
    Scene.Visibility = Space.PackFloat32();
    Scene.Surfaces.resize(Scene.Visibility.OriginalFacets.size());
    for (size_t Index = 0; Index < Scene.Surfaces.size(); ++Index)
        Scene.Surfaces[Index] = Authored[Scene.Visibility.OriginalFacets[Index]];

    const std::array<float, 3> Eye{0.25f, -1.65f, 1.48f};
    const float Pitch = -0.06f, CosP = std::cos(Pitch), SinP = std::sin(Pitch);
    const float Yaw = -0.05f, CosY = std::cos(Yaw), SinY = std::sin(Yaw);
    Scene.Camera.fill({0.0f, 0.0f, 0.0f, 0.0f});
    Scene.Camera[0]  = {Eye[0], Eye[1], Eye[2], 0.08f};
    Scene.Camera[1]  = {SinY * CosP, CosY * CosP, SinP, 90.0f};
    Scene.Camera[2]  = {CosY, -SinY, 0.0f, 0.78f};
    Scene.Camera[3]  = {-SinY * SinP, -CosY * SinP, CosP, 0.52f};
    Scene.Camera[4]  = Scene.Camera[0];
    Scene.Camera[5]  = Scene.Camera[1];
    Scene.Camera[6]  = Scene.Camera[2];
    Scene.Camera[7]  = Scene.Camera[3];
    Scene.Camera[10] = {0.0f, 0.0f, 0.0f, 0.0f};
    Scene.Camera[11] = {1.0f, 0.0f, 1.0f, 0.0f};
    return Scene;
}

inline void ValidatePhaseFourAdaptiveFilterAndProvingScene(LightComputeSubmission& Compute,
                                                           const std::string&      CaptureDir)
{
    // Part 4A: Dynamic shadow-step lag + mirror-sharpness benchmark (32 x 32).
    {
        constexpr uint32_t Size = 32u;
        auto LitScene    = ConstructPhaseTwoMultiBounceScene(Size, Size);
        auto ShadowScene = LitScene;
        // Insert an overhead blocker at Frame 4 casting sudden shadow over the matte half while leaving glossy strip lit!
        {
            std::vector<LightComputeFacet> ShadowFacets = ShadowScene.Surfaces;
            std::vector<std::array<SpatialVector, 3>> ShadowGeom;
            for (const auto& F : ShadowFacets)
                ShadowGeom.push_back({SpatialVector{F.A[0], F.A[1], F.A[2]},
                                      SpatialVector{F.B[0], F.B[1], F.A[2] == F.A[2] ? F.B[2] : F.B[2]},
                                      SpatialVector{F.C[0], F.C[1], F.C[2]}});
            AppendPbrQuad(ShadowFacets, ShadowGeom,
                          {-1.6, -0.2, 1.95}, {0.1, -0.2, 1.95}, {0.1, 3.0, 1.95}, {-1.6, 3.0, 1.95},
                          {0, 0, -1}, {0, 0, -1}, {0, 0, -1}, {0, 0, -1},
                          0u, 9.0f, {0.2f, 0.2f, 0.2f}, 0.85f, 0.0f);
            TriangleVisibilitySpace Space;
            Space.BuildSurfaceAreaHierarchy(ShadowGeom, 1u);
            ShadowScene.Visibility = Space.PackFloat32();
            ShadowScene.Surfaces.resize(ShadowScene.Visibility.OriginalFacets.size());
            for (size_t I = 0; I < ShadowScene.Surfaces.size(); ++I)
                ShadowScene.Surfaces[I] = ShadowFacets[ShadowScene.Visibility.OriginalFacets[I]];
        }

        Compute.RebindReplayScene(ShadowScene, true);

        // Converged post-step ground-truth reference on ShadowScene:
        std::vector<double> PostStepRef(size_t(Size) * Size, 0.0);
        ProductionReplayConfiguration BaseCfg{};
        BaseCfg.Bounces             = 2u;
        BaseCfg.InitialCandidates   = 4u;
        BaseCfg.RoughOpaque         = true;
        BaseCfg.ImportanceRough     = true;
        BaseCfg.SampleFacets        = true;
        BaseCfg.BalanceSampling     = true;
        BaseCfg.PowerWeightedFacets = true;
        BaseCfg.UniformFacetMixture = true;
        BaseCfg.PowerMis            = true;
        BaseCfg.CompactStorage      = true;
        BaseCfg.OrderedTraversal    = true;
        BaseCfg.PositiveFloor       = 0.001f;
        for (uint32_t R = 0; R < 64u; ++R)
        {
            BaseCfg.Seed         = 50021u + 613u * R;
            BaseCfg.ResetHistory = true;
            const auto Img = DispatchProductionReplay(Compute, ShadowScene, BaseCfg, 0u);
            for (size_t P = 0; P < PostStepRef.size(); ++P)
                PostStepRef[P] += (0.2126 * Img[P][0] + 0.7152 * Img[P][1] + 0.0722 * Img[P][2]) / 64.0;
        }

        auto RunSequence = [&](bool EnableFilter, bool EnableAdaptive) {
            ProductionReplayConfiguration Cfg = BaseCfg;
            Cfg.InitialCandidates  = 1u;
            Cfg.Temporal           = true;
            Cfg.Spatial            = true;
            Cfg.SpatialDisk        = true;
            Cfg.PairwiseMis        = true;
            Cfg.HybridReconnection = true;
            Cfg.VarianceFilter     = EnableFilter;
            Cfg.AdaptiveFilter     = EnableAdaptive;
            std::vector<std::array<float, 4>> Out;
            // Warm 4 sunlit frames, then step blocker in on Frame 4 WITHOUT manual reset!
            for (uint32_t F = 0; F < 5u; ++F)
            {
                Cfg.Seed                = 88001u + 331u * F;
                Cfg.ResetHistory        = (F == 0u);
                Cfg.ResetVarianceFilter = (F == 0u);
                Out = DispatchProductionReplay(Compute, F < 4u ? LitScene : ShadowScene, Cfg, F);
            }
            double MatteSq = 0.0, MirrorSq = 0.0;
            for (uint32_t Y = 0; Y < Size; ++Y)
                for (uint32_t X = 0; X < Size; ++X)
                {
                    const size_t P = size_t(Y) * Size + X;
                    const double Lum = 0.2126 * Out[P][0] + 0.7152 * Out[P][1] + 0.0722 * Out[P][2];
                    const double Diff = Lum - PostStepRef[P];
                    if (X < Size / 2u) MatteSq += Diff * Diff;
                    else MirrorSq += Diff * Diff;
                }
            return std::pair<double, double>{
                std::sqrt(MatteSq / double(Size * Size / 2u)),
                std::sqrt(MirrorSq / double(Size * Size / 2u))};
        };

        const auto [RawShadowRmse, RawMirrorRmse]       = RunSequence(false, false);
        const auto [StaticShadowRmse, StaticMirrorRmse] = RunSequence(true, false);
        const auto [AdaptShadowRmse, AdaptMirrorRmse]   = RunSequence(true, true);

        std::printf("PHASE4_FILTER arm=unfiltered_restir shadow_step_rmse=%.6f mirror_rmse=%.6f\n",
                    RawShadowRmse, RawMirrorRmse);
        std::printf("PHASE4_FILTER arm=static_variance_filter shadow_step_rmse=%.6f mirror_rmse=%.6f\n",
                    StaticShadowRmse, StaticMirrorRmse);
        std::printf("PHASE4_FILTER arm=adaptive_variance_filter shadow_step_rmse=%.6f mirror_rmse=%.6f\n",
                    AdaptShadowRmse, AdaptMirrorRmse);
        std::fflush(stdout);

        Require(AdaptShadowRmse < StaticShadowRmse && AdaptMirrorRmse <= StaticMirrorRmse,
                "Phase 4 Adaptive 3-sigma + Specular Footprint filter did not beat static SVGF on shadow step & mirror");
    }

    // Part 4B: End-to-End VehicleHMI Golden-Hour Courtyard Proving Scene (128 x 80) via PathReplaySubmissionSequence!
    {
        constexpr uint32_t Width  = 128u;
        constexpr uint32_t Height = 80u;
        const auto Scene = ConstructVehicleHmiCourtyardScene(Width, Height);

        SkyRadianceSpecification GoldenHour{};
        GoldenHour.ZenithDirection      = {0.0, 0.0, 1.0};
        GoldenHour.SolarDirection       = {0.58, 0.76, 0.29189039};   // ~17 deg golden-hour sun!
        GoldenHour.SolarIrradiance      = {21.0, 19.8, 18.4};
        GoldenHour.SolarAngularRadius   = 0.0065;
        GoldenHour.ObserverAltitudeKm   = 0.06;
        GoldenHour.MultipleScatterScale = 1.0;
        GoldenHour.CloudBaseKm          = 1.6;
        GoldenHour.CloudTopKm           = 2.4;
        GoldenHour.CloudExtinctionKm    = 2.4;
        GoldenHour.CloudCoverage        = 0.48;
        const auto SolarPayload = CompileSkyRadiancePayload(GoldenHour);

        Compute.RebindReplayScene(Scene, true);

        // 1. Converged 64 x 4 = 256-SPP Unbiased Monte Carlo Reference:
        std::vector<std::array<float, 4>> ReferenceImg(size_t(Width) * Height, {0.0f, 0.0f, 0.0f, 1.0f});
        {
            ProductionReplayConfiguration RefCfg{};
            RefCfg.Bounces             = 2u;
            RefCfg.InitialCandidates   = 4u;
            RefCfg.PrimaryVisibility   = true;
            RefCfg.RoughOpaque         = true;
            RefCfg.ImportanceRough     = true;
            RefCfg.AuthoredMaterials   = true;
            RefCfg.SampleFacets        = true;
            RefCfg.BalanceSampling     = true;
            RefCfg.PowerWeightedFacets = true;
            RefCfg.UniformFacetMixture = true;
            RefCfg.PowerMis            = true;
            RefCfg.CompactStorage      = true;
            RefCfg.OrderedTraversal    = true;
            RefCfg.SkyRadiance = true;
            RefCfg.SolarSkyPayload     = SolarPayload;
            RefCfg.PositiveFloor       = 0.001f;

            constexpr uint32_t RefBatches = 64u;
            for (uint32_t B = 0; B < RefBatches; ++B)
            {
                RefCfg.Seed         = 0x517cc1b7u * (B + 1u) + 29u;
                RefCfg.ResetHistory = true;
                const auto Sample = DispatchProductionReplay(Compute, Scene, RefCfg, 0u);
                for (size_t P = 0; P < ReferenceImg.size(); ++P)
                    for (uint32_t C = 0; C < 3u; ++C)
                        ReferenceImg[P][C] += Sample[P][C] / float(RefBatches);
            }
        }

        // 2. Legacy 1-SPP Baseline (1 candidate, Uniform 1/M MIS, no Pairwise/Hybrid/AdaptiveFilter):
        std::vector<std::array<float, 4>> Baseline1Spp;
        uint64_t BaselineRays = 0u;
        {
            ProductionReplayConfiguration BaseCfg{};
            BaseCfg.Bounces             = 2u;
            BaseCfg.Seed                = 991007u;
            BaseCfg.InitialCandidates   = 1u;
            BaseCfg.Spatial             = true;
            BaseCfg.ResetHistory        = true;
            BaseCfg.PrimaryVisibility   = true;
            BaseCfg.RoughOpaque         = true;
            BaseCfg.ImportanceRough     = true;
            BaseCfg.AuthoredMaterials   = true;
            BaseCfg.SampleFacets        = true;
            BaseCfg.BalanceSampling     = true;
            BaseCfg.PowerWeightedFacets = true;
            BaseCfg.UniformFacetMixture = true;
            BaseCfg.CompactStorage      = true;
            BaseCfg.OrderedTraversal    = true;
            BaseCfg.SkyRadiance = true;
            BaseCfg.SolarSkyPayload     = SolarPayload;
            BaseCfg.PositiveFloor       = 0.0001f;
            Baseline1Spp = DispatchProductionReplay(Compute, Scene, BaseCfg, 0u);
            const auto Counts = Compute.ExtendedStatistics();
            BaselineRays = Counts[2] + Counts[8];
        }

        // 3. Production Unfiltered ReSTIR (8-frame sequenced temporal + spatial disk + Pairwise Power MIS + Hybrid Reconnection):
        std::vector<std::array<float, 4>> ProductionRaw;
        {
            Compute.ReplaySequence.Invalidate();
            ProductionReplayConfiguration RawCfg{};
            RawCfg.Bounces             = 2u;
            RawCfg.InitialCandidates   = 2u;
            RawCfg.HistoryCap          = 16u;
            RawCfg.Temporal            = true;
            RawCfg.Spatial             = true;
            RawCfg.SpatialDisk         = true;
            RawCfg.PrimaryVisibility   = true;
            RawCfg.RoughOpaque         = true;
            RawCfg.ImportanceRough     = true;
            RawCfg.AuthoredMaterials   = true;
            RawCfg.SampleFacets        = true;
            RawCfg.BalanceSampling     = true;
            RawCfg.PowerWeightedFacets = true;
            RawCfg.UniformFacetMixture = true;
            RawCfg.PowerMis            = true;
            RawCfg.CompactStorage      = true;
            RawCfg.OrderedTraversal    = true;
            RawCfg.PairwiseMis         = true;
            RawCfg.HybridReconnection  = true;
            RawCfg.SkyRadiance = true;
            RawCfg.Sequenced           = true;
            RawCfg.SolarSkyPayload     = SolarPayload;
            RawCfg.PositiveFloor       = 0.0001f;

            for (uint32_t Frame = 0; Frame < 8u; ++Frame)
            {
                RawCfg.Seed         = 771001u + 1493u * Frame;
                RawCfg.ResetHistory = (Frame == 0u);
                ProductionRaw = DispatchProductionReplay(Compute, Scene, RawCfg, Frame);
            }
        }

        // 4. Full Production Pipeline (+ Roughness-Adaptive 3-Sigma Variance Filter via PathReplaySubmissionSequence):
        std::vector<std::array<float, 4>> ProductionFiltered;
        uint64_t ProductionRays = 0u;
        {
            Compute.ReplaySequence.Invalidate();
            ProductionReplayConfiguration ProdCfg{};
            ProdCfg.Bounces             = 2u;
            ProdCfg.InitialCandidates   = 2u;
            ProdCfg.HistoryCap          = 16u;
            ProdCfg.Temporal            = true;
            ProdCfg.Spatial             = true;
            ProdCfg.SpatialDisk         = true;
            ProdCfg.PrimaryVisibility   = true;
            ProdCfg.RoughOpaque         = true;
            ProdCfg.ImportanceRough     = true;
            ProdCfg.AuthoredMaterials   = true;
            ProdCfg.SampleFacets        = true;
            ProdCfg.BalanceSampling     = true;
            ProdCfg.PowerWeightedFacets = true;
            ProdCfg.UniformFacetMixture = true;
            ProdCfg.PowerMis            = true;
            ProdCfg.CompactStorage      = true;
            ProdCfg.OrderedTraversal    = true;
            ProdCfg.VarianceFilter      = true;
            ProdCfg.PairwiseMis         = true;
            ProdCfg.HybridReconnection  = true;
            ProdCfg.SkyRadiance = true;
            ProdCfg.AdaptiveFilter      = true;
            ProdCfg.Sequenced           = true;
            ProdCfg.SolarSkyPayload     = SolarPayload;
            ProdCfg.PositiveFloor       = 0.0001f;

            for (uint32_t Frame = 0; Frame < 8u; ++Frame)
            {
                ProdCfg.Seed         = 771001u + 1493u * Frame;
                ProdCfg.ResetHistory = (Frame == 0u);
                ProductionFiltered = DispatchProductionReplay(Compute, Scene, ProdCfg, Frame);
                if (Frame == 7u)
                {
                    const auto Counts = Compute.ExtendedStatistics();
                    ProductionRays = Counts[2] + Counts[8] + Counts[10];
                }
            }
        }

        auto ToneMapaces = [](double X) {
            const double V = std::max(0.0, X * 0.42);
            return std::clamp((V * (2.51 * V + 0.03)) / (V * (2.43 * V + 0.59) + 0.14), 0.0, 1.0);
        };
        auto EvaluateImageMetrics = [&](const std::vector<std::array<float, 4>>& TestImg) {
            double LinMse = 0.0, ToneMse = 0.0, MaxFirefly = 0.0;
            for (size_t P = 0; P < ReferenceImg.size(); ++P)
            {
                for (uint32_t C = 0; C < 3u; ++C)
                {
                    const double T = double(TestImg[P][C]);
                    const double R = double(ReferenceImg[P][C]);
                    Require(std::isfinite(T) && T >= 0.0, "Non-finite proving scene pixel");
                    MaxFirefly = std::max(MaxFirefly, T);
                    LinMse += (T - R) * (T - R) / double(ReferenceImg.size() * 3u);
                    const double DT = ToneMapaces(T) - ToneMapaces(R);
                    ToneMse += (DT * DT) / double(ReferenceImg.size() * 3u);
                }
            }
            const double PsnrDb = 10.0 * std::log10(1.0 / std::max(ToneMse, 1e-12));
            return std::tuple<double, double, double>{std::sqrt(LinMse), PsnrDb, MaxFirefly};
        };

        const auto [BaseRmse, BasePsnr, BaseMax] = EvaluateImageMetrics(Baseline1Spp);
        const auto [RawRmse, RawPsnr, RawMax]    = EvaluateImageMetrics(ProductionRaw);
        const auto [ProdRmse, ProdPsnr, ProdMax] = EvaluateImageMetrics(ProductionFiltered);

        std::printf("PROVING_SCENE width=%u height=%u arm=legacy_1_over_m_1spp linear_rmse=%.5f tonemapped_psnr_db=%.3f max_channel=%.3f secondary_rays=%llu\n",
                    Width, Height, BaseRmse, BasePsnr, BaseMax, static_cast<unsigned long long>(BaselineRays));
        std::printf("PROVING_SCENE width=%u height=%u arm=production_restir_raw linear_rmse=%.5f tonemapped_psnr_db=%.3f max_channel=%.3f secondary_rays=%llu\n",
                    Width, Height, RawRmse, RawPsnr, RawMax, static_cast<unsigned long long>(ProductionRays));
        std::printf("PROVING_SCENE width=%u height=%u arm=production_restir_filtered linear_rmse=%.5f tonemapped_psnr_db=%.3f max_channel=%.3f secondary_rays=%llu\n",
                    Width, Height, ProdRmse, ProdPsnr, ProdMax, static_cast<unsigned long long>(ProductionRays));
        std::fflush(stdout);

        Require(RawRmse < BaseRmse && ProdRmse < RawRmse && ProdPsnr > BasePsnr + 4.0,
                "Production ReSTIR pipeline did not achieve dramatic RMSE & PSNR superiority on VehicleHMI courtyard");

        if (!CaptureDir.empty())
        {
            SaveFloat32RgbCapture(CaptureDir + "/ProvingBaseline1Spp.f32", Baseline1Spp);
            SaveFloat32RgbCapture(CaptureDir + "/ProvingProductionRaw.f32", ProductionRaw);
            SaveFloat32RgbCapture(CaptureDir + "/ProvingProductionFiltered.f32", ProductionFiltered);
            SaveFloat32RgbCapture(CaptureDir + "/ProvingReference256Spp.f32", ReferenceImg);
        }
    }
}

inline void ValidateProductionReSTIRPipeline(const char*        Driver,
                                             const std::string& Shaders,
                                             const std::string& CaptureDir)
{
    std::printf("PRODUCTION_RESTIR_START phases=4\n");
    std::fflush(stdout);
    const auto BootstrapScene = ConstructPhaseTwoMultiBounceScene(8u, 8u);
    LightComputeSubmission Compute(Driver);
    Compute.Prepare(BootstrapScene, Shaders, false, false, false, false, true, false, true);
    ValidatePhaseOnePairwiseMis(Compute);
    ValidatePhaseTwoHybridReconnection(Compute);
    ValidatePhaseThreeSkyRadiance(Compute);
    ValidatePhaseFourAdaptiveFilterAndProvingScene(Compute, CaptureDir);
    std::printf("PRODUCTION_RESTIR_DECISION phase1=pairwise_power phase2=hybrid_reconnection phase3=coupled_solar_sky_mis phase4=adaptive_variance_filter status=PASS\n");
    std::fflush(stdout);
}
