/*==========================================================================================================================================
                                            PHOTOMETRICCLUSTERGPUVALIDATION.H
==========================================================================================================================================*/
// 🧩 Vulkan GPU validation of tight polar-cone clustering, clustered volumetric fog, O(1) Vose-alias Emissive-IES, and Analytic-IES.

#pragma once

//------------------------------------------------------------------------------------------------------------------------
//                                        PHOTOMETRIC GPU VALIDATION SCENES
//------------------------------------------------------------------------------------------------------------------------

inline CandelaDistribution ConstructGpuAutomotiveBayIes()
{
    std::ostringstream Stream;
    Stream << "IESNA:LM-63-2002\n"
           << "[TEST]FrontierShowroomScallop\n"
           << "TILT=NONE\n"
           << "1 1600 1.0 7 3 1 2 0.12 0.12 0.0 1.0 1.0 28.0\n"
           << "0 12 24 36 48 90 180\n"
           << "0 45 90\n"
           << "1200 1050 640 160 0 0 0\n"
           << "1200 940 500 110 0 0 0\n"
           << "1200 820 360 55 0 0 0\n";
    std::istringstream Input(Stream.str());
    return CandelaDistribution::Read(Input);
}

inline void AppendOrientedQuad(std::vector<LightComputeFacet>& Surfaces,
                               std::array<float, 3>            P0,
                               std::array<float, 3>            P1,
                               std::array<float, 3>            P2,
                               std::array<float, 3>            P3,
                               std::array<float, 3>            Normal,
                               std::array<float, 3>            Albedo,
                               float                           Roughness,
                               float                           Metallic,
                               std::array<float, 3>            Emitted = {0.0f, 0.0f, 0.0f})
{
    LightComputeFacet First{};
    First.A               = {P0[0], P0[1], P0[2], 1.0f};
    First.B               = {P1[0], P1[1], P1[2], 1.0f};
    First.C               = {P2[0], P2[1], P2[2], 1.0f};
    First.NormalA         = {Normal[0], Normal[1], Normal[2], 0.0f};
    First.NormalB         = First.NormalA;
    First.NormalC         = First.NormalA;
    First.AlbedoRoughness = {Albedo[0], Albedo[1], Albedo[2], Roughness};
    First.Emissive        = {Emitted[0], Emitted[1], Emitted[2], 0.0f};
    First.OpticalToken    = {Metallic, 1.5f, 0.5f, 1.0f};

    LightComputeFacet Second = First;
    Second.A                 = {P0[0], P0[1], P0[2], 1.0f};
    Second.B                 = {P2[0], P2[1], P2[2], 1.0f};
    Second.C                 = {P3[0], P3[1], P3[2], 1.0f};
    Surfaces.push_back(First);
    Surfaces.push_back(Second);
}

inline void ConfigurePerspectiveCamera(LightComputeArchive& Scene,
                                       uint32_t             Width,
                                       uint32_t             Height,
                                       std::array<float, 3> Eye,
                                       std::array<float, 3> Target,
                                       float                FovVerticalDegrees)
{
    Scene.Width  = Width;
    Scene.Height = Height;

    auto Sub3 = [](std::array<float, 3> A, std::array<float, 3> B) -> std::array<float, 3>
    {
        return {A[0] - B[0], A[1] - B[1], A[2] - B[2]};
    };
    auto Cross3 = [](std::array<float, 3> A, std::array<float, 3> B) -> std::array<float, 3>
    {
        return {A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0]};
    };
    auto Norm3 = [](std::array<float, 3> V) -> std::array<float, 3>
    {
        const float L = std::sqrt(V[0] * V[0] + V[1] * V[1] + V[2] * V[2]);
        return {V[0] / L, V[1] / L, V[2] / L};
    };

    const auto Forward = Norm3(Sub3(Target, Eye));
    const auto Right   = Norm3(Cross3(Forward, {0.0f, 0.0f, 1.0f}));
    const auto Up      = Cross3(Right, Forward);
    const float TanHalf = std::tan(FovVerticalDegrees * 0.5f * 3.1415926535f / 180.0f);
    const float Aspect  = float(Width) / float(Height);

    Scene.Camera.fill({0.0f, 0.0f, 0.0f, 0.0f});
    Scene.Camera[0] = {Eye[0], Eye[1], Eye[2], 0.08f};
    Scene.Camera[1] = {Forward[0], Forward[1], Forward[2], 120.0f};
    Scene.Camera[2] = {Right[0], Right[1], Right[2], Aspect * TanHalf};
    Scene.Camera[3] = {Up[0], Up[1], Up[2], TanHalf};
    Scene.Camera[4] = Scene.Camera[0];
    Scene.Camera[5] = Scene.Camera[1];
    Scene.Camera[6] = Scene.Camera[2];
    Scene.Camera[7] = Scene.Camera[3];

    Scene.Receivers.assign(size_t(Width) * Height, LightComputeReceiver{});
    for (uint32_t Y = 0; Y < Height; ++Y)
    {
        for (uint32_t X = 0; X < Width; ++X)
        {
            auto& R               = Scene.Receivers[size_t(Y) * Width + X];
            R.PositionHit         = {0.0f, 0.0f, 0.0f, 1.0f};
            R.NormalRoughness     = {0.0f, 0.0f, 1.0f, 0.45f};
            R.ViewMetallic        = {0.0f, 0.0f, 1.0f, 0.0f};
            R.AlbedoIor           = {0.72f, 0.72f, 0.72f, 1.5f};
            R.MotionPositionToken = {0.0f, 0.0f, 0.0f, 1.0f};
            R.MotionNormal        = {0.0f, 0.0f, 1.0f, 0.0f};
            R.MotionPixel         = {float(X), float(Y), 1.0f, 1.0f};
        }
    }
}

inline void BuildOrderedVisibility(LightComputeArchive& Scene)
{
    std::vector<std::array<SpatialVector, 3>> Geometry;
    Geometry.reserve(Scene.Surfaces.size());
    for (const auto& F : Scene.Surfaces)
    {
        Geometry.push_back({
            SpatialVector{F.A[0], F.A[1], F.A[2]},
            SpatialVector{F.B[0], F.B[1], F.B[2]},
            SpatialVector{F.C[0], F.C[1], F.C[2]}
        });
    }
    TriangleVisibilitySpace Space;
    Space.BuildSurfaceAreaHierarchy(Geometry, 1u);
    Scene.Visibility = Space.PackFloat32();
    std::vector<LightComputeFacet> Reordered(Scene.Visibility.OriginalFacets.size());
    for (size_t Slot = 0; Slot < Scene.Visibility.OriginalFacets.size(); ++Slot)
    {
        Reordered[Slot] = Scene.Surfaces[Scene.Visibility.OriginalFacets[Slot]];
    }
    Scene.Surfaces.swap(Reordered);
}

//------------------------------------------------------------------------------------------------------------------------
//                      PHASE 1 & 2 GPU: TIGHT POLAR-CONE CLUSTERS & CLUSTERED VOLUMETRIC FOG
//------------------------------------------------------------------------------------------------------------------------

inline std::vector<LightComputeShape> ConvertAnalyticFootprintsToShapes(
    const std::vector<AnalyticLuminaireFootprint>& Footprints)
{
    std::vector<LightComputeShape> Shapes(Footprints.size());
    for (size_t Index = 0; Index < Footprints.size(); ++Index)
    {
        Shapes[Index].PositionReach    = Footprints[Index].PositionReach;
        Shapes[Index].RadianceCategory = Footprints[Index].RadianceCategory;
        Shapes[Index].DirectionInner   = Footprints[Index].DirectionInner;
        Shapes[Index].UpOuter          = Footprints[Index].UpOuter;
        Shapes[Index].Profile          = Footprints[Index].Profile;
        Shapes[Index].PeakActive       = Footprints[Index].PeakActive;
    }
    return Shapes;
}

inline void ValidateGpuAnalyticClustersAndFog(const char* Driver, const std::string& Shaders)
{
    const CandelaDistribution NarrowIes = ConstructGpuAutomotiveBayIes();

    std::vector<AnalyticLuminaireSpecification> Specs;
    Specs.reserve(48u);
    for (uint32_t Index = 0; Index < 48u; ++Index)
    {
        const uint32_t Col = Index % 8u;
        const uint32_t Row = Index / 8u;
        AnalyticLuminaireSpecification Spec{};
        Spec.Position      = {-14.0 + 4.0 * double(Col), -12.5 + 5.0 * double(Row), 5.4};
        Spec.ReachRadiusM  = 10.5;
        Spec.IntensityRgb  = {34.0, 31.0, 28.0};
        Spec.ForwardAxis   = {0.06 * std::sin(double(Index)), -0.06 * std::cos(double(Index)), -1.0};
        Spec.UpAxis        = {0.0, 1.0, 0.0};
        Spec.ActiveEnabled = (Index % 6u) != 5u;
        if ((Index % 3u) == 0u)
        {
            Spec.Category        = AnalyticLuminaireCategory::Spot;
            Spec.InnerConeCosine = std::cos(16.0 * 3.14159265358979323846 / 180.0);
            Spec.OuterConeCosine = std::cos(24.0 * 3.14159265358979323846 / 180.0);
            Spec.Photometry      = NarrowIes;
        }
        else if ((Index % 3u) == 1u)
        {
            Spec.Category   = AnalyticLuminaireCategory::Point;
            Spec.Photometry = NarrowIes;
        }
        else
        {
            Spec.Category        = AnalyticLuminaireCategory::Spot;
            Spec.InnerConeCosine = std::cos(15.0 * 3.14159265358979323846 / 180.0);
            Spec.OuterConeCosine = std::cos(22.0 * 3.14159265358979323846 / 180.0);
        }
        Specs.push_back(Spec);
    }

    PhotometricClusterSpecification ClusterCfg{};
    ClusterCfg.MinimumBoundary      = {-16.0, -16.0, -0.5};
    ClusterCfg.MaximumBoundary      = {16.0, 16.0, 6.0};
    ClusterCfg.GridResolution       = {8u, 8u, 4u};
    ClusterCfg.AnalyticCellCapacity = 16u;
    ClusterCfg.RadiantSlotsPerCell  = 0u;

    LightComputeArchive Scene{};
    AppendOrientedQuad(Scene.Surfaces,
                       {-16.0f, -16.0f, 0.0f}, {16.0f, -16.0f, 0.0f},
                       {16.0f, 16.0f, 0.0f}, {-16.0f, 16.0f, 0.0f},
                       {0.0f, 0.0f, 1.0f}, {0.65f, 0.66f, 0.68f}, 0.35f, 0.0f);
    AppendOrientedQuad(Scene.Surfaces,
                       {-16.0f, 15.8f, 0.0f}, {16.0f, 15.8f, 0.0f},
                       {16.0f, 15.8f, 6.0f}, {-16.0f, 15.8f, 6.0f},
                       {0.0f, -1.0f, 0.0f}, {0.72f, 0.72f, 0.74f}, 0.55f, 0.0f);
    BuildOrderedVisibility(Scene);

    // Reserve camera + fog slots at start of Scene.Angles before appending photometric tables.
    Scene.Angles.assign(64u, 0.0f);
    CompiledPhotometricAtlas Compiled = CompilePhotometricClusterAtlas(
        Specs, Scene.Surfaces, {}, ClusterCfg, Scene.Angles);
    const uint32_t FogOffset = uint32_t(Scene.Angles.size());
    Scene.Angles.insert(Scene.Angles.end(), {
        0.022f, 1.8f, 8.0f, 0.85f,       // Medium: density, base height, falloff, albedo
        0.35f,  16.0f, 36.0f, 0.0f,      // March: anisotropy g, steps, maxDist, cloudSteps
        0.01f,  0.012f, 0.016f, 0.0f,    // Ambient + shadow flag
        0.0f,   1.0f, 16.0f, 0.0f        // Lighting: cloud=0, analyticLights=1, maxDist=16, facetSamples=0
    });

    Scene.Lights = ConvertAnalyticFootprintsToShapes(Compiled.AnalyticLuminaires);

    const uint32_t Width  = 64u;
    const uint32_t Height = 40u;
    ConfigurePerspectiveCamera(Scene, Width, Height, {0.0f, -15.2f, 2.2f}, {0.0f, 4.0f, 0.4f}, 54.0f);

    LightComputeSubmission Compute(Driver);
    Compute.Prepare(Scene, Shaders, false, false, false, false, false, true, false);

    auto RunDirectAndFogArm = [&](uint32_t Mode, bool TightPolarCone, bool UseFogClusters,
                                  std::array<uint32_t, 24>& OutStats) -> std::vector<std::array<float, 4>>
    {
        Compute.Upload(Scene);
        ComputeExtent Extent{};
        Extent.Dimensions = {uint32_t(Scene.Receivers.size()),
                             uint32_t(Scene.Lights.size()),
                             16u,
                             (Mode != 0u || UseFogClusters) ? 1u : 0u};
        Extent.Minimum    = {-16.0f, -16.0f, -0.5f, 0.0f};
        Extent.Maximum    = {16.0f, 16.0f, 6.0f, 0.0f};
        const uint32_t EncodedFog = FogOffset + 1u;
        std::memcpy(&Extent.Minimum[3], &EncodedFog, sizeof(uint32_t));
        Extent.Grid           = {8u, 8u, 4u, uint32_t(Scene.Visibility.Enclosures.size())};
        Extent.Sampling       = {19u, 0u, uint32_t(Scene.Visibility.Corners.size()), 64u};
        Extent.History        = {Width, Height, 0u, 1u};
        Extent.Reconstruction = {0u, 0u, 0u, 0u};
        Extent.Primary        = {1u,
                                 uint32_t(Scene.Angles.size()),
                                 0u,
                                 TightPolarCone ? PhotometricTightClusterMask : 0u};

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
                                   VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &Barrier, 0, nullptr, 0, nullptr);
        Compute.CmdBindDescriptorSets(Compute.Commands, VK_PIPELINE_BIND_POINT_COMPUTE,
                                      Compute.PipelineLayout, 0, 1, &Compute.DescriptorSet, 0, nullptr);
        Compute.CmdPushConstants(Compute.Commands, Compute.PipelineLayout, VK_SHADER_STAGE_COMPUTE_BIT,
                                 0, sizeof(Extent), &Extent);

        auto EmitBarrier = [&]()
        {
            Barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
            Barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
            Compute.CmdPipelineBarrier(Compute.Commands, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                       VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &Barrier, 0, nullptr, 0, nullptr);
        };

        Compute.CmdBindPipeline(Compute.Commands, VK_PIPELINE_BIND_POINT_COMPUTE, Compute.CellPipeline);
        Compute.CmdDispatch(Compute.Commands, 4u, 1u, 1u);
        EmitBarrier();

        Compute.CmdBindPipeline(Compute.Commands, VK_PIPELINE_BIND_POINT_COMPUTE, Compute.PrimaryPipeline);
        Compute.CmdDispatch(Compute.Commands, (Extent.Dimensions[0] + 63u) / 64u, 1u, 1u);
        EmitBarrier();

        // Direct receiver pass uses Mode flag (0 = exhaustive, 1 = clustered).
        Extent.Dimensions[3] = Mode;
        Compute.CmdPushConstants(Compute.Commands, Compute.PipelineLayout, VK_SHADER_STAGE_COMPUTE_BIT,
                                 0, sizeof(Extent), &Extent);
        Compute.CmdBindPipeline(Compute.Commands, VK_PIPELINE_BIND_POINT_COMPUTE, Compute.ReceiverPipeline);
        Compute.CmdDispatch(Compute.Commands, (Extent.Dimensions[0] + 63u) / 64u, 1u, 1u);
        EmitBarrier();

        // Volumetric fog scattering pass optionally consumes the 3D Cells[] cluster grid.
        Extent.Dimensions[3] = UseFogClusters ? 1u : 0u;
        Extent.Primary[3]    = PhotometricTightClusterMask;
        Compute.CmdPushConstants(Compute.Commands, Compute.PipelineLayout, VK_SHADER_STAGE_COMPUTE_BIT,
                                 0, sizeof(Extent), &Extent);
        Compute.CmdBindPipeline(Compute.Commands, VK_PIPELINE_BIND_POINT_COMPUTE, Compute.FogPipeline);
        Compute.CmdDispatch(Compute.Commands, (Extent.Dimensions[0] + 63u) / 64u, 1u, 1u);

        Barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        Barrier.dstAccessMask = VK_ACCESS_HOST_READ_BIT;
        Compute.CmdPipelineBarrier(Compute.Commands, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                   VK_PIPELINE_STAGE_HOST_BIT, 0, 1, &Barrier, 0, nullptr, 0, nullptr);
        Confirm(Compute.EndCommandBuffer(Compute.Commands));

        VkSubmitInfo Submit{};
        Submit.sType              = VK_STRUCTURE_TYPE_SUBMIT_INFO;
        Submit.commandBufferCount = 1u;
        Submit.pCommandBuffers    = &Compute.Commands;
        Confirm(Compute.QueueSubmit(Compute.Queue, 1u, &Submit, Compute.Completion));
        Confirm(Compute.WaitForFences(Compute.Device, 1u, &Compute.Completion, VK_TRUE, 600000000000ULL));

        std::vector<std::array<float, 4>> Output(Scene.Receivers.size());
        std::memcpy(Output.data(), Compute.Buffers[6].Address, Output.size() * sizeof(std::array<float, 4>));
        OutStats = Compute.ExtendedStatistics();
        return Output;
    };

    std::array<uint32_t, 24> ExhaustiveStats{};
    std::array<uint32_t, 24> SphereStats{};
    std::array<uint32_t, 24> TightStats{};
    const auto ExhaustiveImg = RunDirectAndFogArm(0u, false, false, ExhaustiveStats);
    const auto SphereImg     = RunDirectAndFogArm(1u, false, false, SphereStats);
    const auto TightImg      = RunDirectAndFogArm(1u, true, true, TightStats);

    // Count GPU cell assignments directly from Buffers[5].
    auto SumGpuCellAssignments = [&](bool TightMode, uint32_t& OutOverflows) -> uint64_t
    {
        std::array<uint32_t, 24> Unused{};
        (void)RunDirectAndFogArm(1u, TightMode, TightMode, Unused);
        const auto* CellWords = static_cast<const uint32_t*>(Compute.Buffers[5].Address);
        uint64_t    Total     = 0u;
        OutOverflows          = 0u;
        for (uint32_t Cell = 0; Cell < 256u; ++Cell)
        {
            const uint32_t Cnt = CellWords[Cell * 17u];
            if (Cnt > 16u)
            {
                ++OutOverflows;
                Total += 16u;
            }
            else
            {
                Total += Cnt;
            }
        }
        return Total;
    };
    uint32_t SphereOverflows = 0u;
    uint32_t TightOverflows  = 0u;
    const uint64_t SphereCellTotal = SumGpuCellAssignments(false, SphereOverflows);
    const uint64_t TightCellTotal  = SumGpuCellAssignments(true, TightOverflows);

    double MaxSphereDiff = 0.0;
    double MaxTightDiff  = 0.0;
    for (size_t Pixel = 0; Pixel < ExhaustiveImg.size(); ++Pixel)
    {
        for (uint32_t C = 0; C < 3u; ++C)
        {
            Require(std::isfinite(TightImg[Pixel][C]), "Non-finite GPU clustered direct+fog pixel");
            MaxSphereDiff = std::max(MaxSphereDiff, std::abs(double(SphereImg[Pixel][C]) - double(ExhaustiveImg[Pixel][C])));
            MaxTightDiff  = std::max(MaxTightDiff, std::abs(double(TightImg[Pixel][C]) - double(ExhaustiveImg[Pixel][C])));
        }
    }

    std::printf("GPU_ANALYTIC_CLUSTERS receivers=%zu lights=%zu exhaustive_visits=%u sphere_visits=%u tight_visits=%u sphere_cells=%llu sphere_overflows=%u tight_cells=%llu tight_overflows=%u max_abs_err=%.7f\n",
                ExhaustiveImg.size(), Specs.size(),
                ExhaustiveStats[0], SphereStats[0], TightStats[0],
                static_cast<unsigned long long>(SphereCellTotal), SphereOverflows,
                static_cast<unsigned long long>(TightCellTotal), TightOverflows,
                MaxTightDiff);
    std::printf("GPU_CLUSTERED_FOG steps=16 unclustered_fog_visits=%u clustered_fog_visits=%u speedup=%.2fx max_abs_err=%.7f\n",
                ExhaustiveStats[13], TightStats[13],
                double(ExhaustiveStats[13]) / std::max(1.0, double(TightStats[13])),
                MaxTightDiff);
    std::fflush(stdout);

    Require(TightOverflows == 0u && MaxSphereDiff < 1e-5 && MaxTightDiff < 1e-5,
            "GPU tight polar-cone clustering or clustered fog deviated from exhaustive ground truth");
    Require(TightStats[0] * 4u < ExhaustiveStats[0] && TightStats[0] * 2u < SphereStats[0],
            "GPU tight polar-cone direct light visits did not beat exhaustive (>4x) and sphere-reach (>2x)");
    Require(TightStats[13] * 4u < ExhaustiveStats[13],
            "GPU clustered IntegrateFogScattering did not reduce fog light evaluations by >4x");
}

//------------------------------------------------------------------------------------------------------------------------
//               PHASE 3 & 4 GPU: O(1) VOSE-ALIAS EMISSIVE-IES VS ANALYTIC-IES VS DIFFUSE EMISSIVE
//------------------------------------------------------------------------------------------------------------------------

inline std::vector<std::array<float, 4>> ExecutePhotometricPathReplay(
    LightComputeSubmission&                     Compute,
    LightComputeArchive&                        Scene,
    const std::vector<AnalyticLuminaireSpecification>& AnalyticLuminaires,
    const std::vector<RadiantFacetPhotometry>&  FacetPhotometry,
    const PhotometricClusterSpecification&      ClusterSpec,
    bool                                        EnablePhotometricClusters,
    bool                                        SampleFacets,
    uint32_t                                    Bounces,
    uint32_t                                    InitialCandidates,
    uint32_t                                    Seed,
    uint64_t*                                   OutTotalRays = nullptr)
{
    LightComputeArchive Working = Scene;
    Working.Angles.assign(64u, 0.0f);
    const CompiledPhotometricAtlas Atlas = CompilePhotometricClusterAtlas(
        AnalyticLuminaires, Working.Surfaces, FacetPhotometry, ClusterSpec, Working.Angles);
    ValidatePhotometricClusterAtlas(
        Working.Angles, Atlas.PhotometricHeaderOffset, Working.Surfaces.size(), AnalyticLuminaires.size());

    if (!Atlas.AnalyticLuminaires.empty())
    {
        Working.Lights = ConvertAnalyticFootprintsToShapes(Atlas.AnalyticLuminaires);
    }
    else
    {
        Working.Lights.assign(1u, LightComputeShape{});
    }

    Compute.RebindReplayScene(Working, true);
    if (!Atlas.AnalyticClusterCells.empty())
    {
        Require(Atlas.AnalyticClusterCells.size() * sizeof(uint32_t) <= Compute.Buffers[5].Size,
                "Analytic cluster cell table exceeds prepared Cells[] capacity");
        std::memcpy(Compute.Buffers[5].Address,
                    Atlas.AnalyticClusterCells.data(),
                    Atlas.AnalyticClusterCells.size() * sizeof(uint32_t));
    }
    Compute.Upload(Working, false);

    uint32_t SourceCount = 0u;
    if (SampleFacets)
    {
        const auto GlobalDist = CompileRadiantFacetDistribution(Working.Surfaces);
        SourceCount           = uint32_t(GlobalDist[0]);
        std::memcpy(static_cast<float*>(Compute.Buffers[4].Address) + Compute.ReplayFacetStart,
                    GlobalDist.data(),
                    GlobalDist.size() * sizeof(float));
    }

    uint32_t Options = PathReplayRoughOpaque | PathReplayImportanceRough |
                       PathReplayBalanceSampling | PathReplayPowerMis |
                       PathReplayOrderedTraversal | PathReplayCompactStorage;
    if (SampleFacets && SourceCount > 0u)
    {
        Options |= PathReplaySampleFacets | PathReplayPowerWeightedFacets;
    }
    if (EnablePhotometricClusters)
    {
        Options |= PathReplayPhotometricClusters;
    }

    ComputeExtent Extent{};
    Extent.Dimensions = {uint32_t(Working.Receivers.size()), 0u, 0u, 0u};
    Extent.Minimum    = {0.0f, 0.0f, 0.0f, 0.0f};
    Extent.Maximum    = {0.0005f, 0.0f, 0.0f, 0.0f};
    std::memcpy(&Extent.Maximum[1], &Compute.ReplayFacetStart, sizeof(uint32_t));
    if (EnablePhotometricClusters)
    {
        const uint32_t EncodedHeader = Atlas.PhotometricHeaderOffset + 1u;
        std::memcpy(&Extent.Maximum[2], &EncodedHeader, sizeof(uint32_t));
    }
    Extent.Grid           = {1u, 1u, 1u, uint32_t(Working.Visibility.Enclosures.size())};
    Extent.Sampling       = {Seed,
                             InitialCandidates <= 1u ? 0u : InitialCandidates,
                             uint32_t(Working.Visibility.Corners.size()),
                             64u};
    Extent.History        = {Working.Width, Working.Height, 0u, 1u};
    Extent.Reconstruction = {0u, 0u, SourceCount, 16u};
    Extent.Primary        = {1u, uint32_t(Working.Angles.size()), Bounces, Options};

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
                               VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &Barrier, 0, nullptr, 0, nullptr);

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
    };
    const PathReplayVulkanBuffers Spans{
        Compute.Buffers[1].Size / sizeof(LightComputeReceiver),
        Compute.Buffers[2].Size / sizeof(TriangleVisibilitySpace::FloatEnclosure),
        Compute.Buffers[3].Size / sizeof(LightComputeFacet),
        Compute.Buffers[4].Size / sizeof(float),
        Compute.Buffers[6].Size / sizeof(std::array<float, 4>),
        Compute.Buffers[7].Size / sizeof(uint32_t),
    };
    RecordPathReplay(Compute.Commands, Access, Spans, Extent);

    Barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    Barrier.dstAccessMask = VK_ACCESS_HOST_READ_BIT;
    Compute.CmdPipelineBarrier(Compute.Commands, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                               VK_PIPELINE_STAGE_HOST_BIT, 0, 1, &Barrier, 0, nullptr, 0, nullptr);
    Confirm(Compute.EndCommandBuffer(Compute.Commands));

    VkSubmitInfo Submit{};
    Submit.sType              = VK_STRUCTURE_TYPE_SUBMIT_INFO;
    Submit.commandBufferCount = 1u;
    Submit.pCommandBuffers    = &Compute.Commands;
    Confirm(Compute.QueueSubmit(Compute.Queue, 1u, &Submit, Compute.Completion));
    Confirm(Compute.WaitForFences(Compute.Device, 1u, &Compute.Completion, VK_TRUE, 600000000000ULL));

    if (OutTotalRays != nullptr)
    {
        const auto Stats = Compute.ExtendedStatistics();
        *OutTotalRays    = uint64_t(Stats[2]) + uint64_t(Stats[8]);
    }
    std::vector<std::array<float, 4>> Output(Working.Receivers.size());
    std::memcpy(Output.data(), Compute.Buffers[6].Address, Output.size() * sizeof(std::array<float, 4>));
    return Output;
}

inline void ValidateGpuClusteredEmissiveAndAnalyticIes(const char*        Driver,
                                                       const std::string& Shaders,
                                                       const std::string& CaptureDir)
{
    const CandelaDistribution ShowroomIes = ConstructGpuAutomotiveBayIes();

    // Prepare minimal 3-pipeline Replay submission (Primary + ReplayGenerate + ReplayResolve).
    LightComputeArchive Bootstrap{};
    AppendOrientedQuad(Bootstrap.Surfaces,
                       {-2.0f, -2.0f, 0.0f}, {2.0f, -2.0f, 0.0f},
                       {2.0f, 2.0f, 0.0f}, {-2.0f, 2.0f, 0.0f},
                       {0.0f, 0.0f, 1.0f}, {0.7f, 0.7f, 0.7f}, 0.4f, 0.0f);
    BuildOrderedVisibility(Bootstrap);
    ConfigurePerspectiveCamera(Bootstrap, 16u, 16u, {0.0f, -4.0f, 1.5f}, {0.0f, 0.0f, 0.0f}, 50.0f);
    LightComputeSubmission Compute(Driver);
    Compute.Prepare(Bootstrap, Shaders, false, false, false, false, true, false, true);

    // Phase 3 GPU: 24-bay Emissive-IES hall (48 luminous triangles across X in [-22, 22], Y in [-10, 10]).
    // Camera inspects Bay 0 near (-19.8, -6.5, 0) so Global Power CDF wastes 95% of draws on distant bays!
    {
        LightComputeArchive Hall{};
        AppendOrientedQuad(Hall.Surfaces,
                           {-24.0f, -12.0f, 0.0f}, {24.0f, -12.0f, 0.0f},
                           {24.0f, 12.0f, 0.0f}, {-24.0f, 12.0f, 0.0f},
                           {0.0f, 0.0f, 1.0f}, {0.76f, 0.76f, 0.78f}, 0.55f, 0.0f);
        for (uint32_t Bay = 0; Bay < 24u; ++Bay)
        {
            const float BayX = -20.0f + 5.7f * float(Bay % 8u);
            const float BayY = -7.0f + 7.0f * float(Bay / 8u);
            AppendOrientedQuad(Hall.Surfaces,
                               {BayX - 0.22f, BayY - 0.22f, 4.2f},
                               {BayX + 0.22f, BayY - 0.22f, 4.2f},
                               {BayX + 0.22f, BayY + 0.22f, 4.2f},
                               {BayX - 0.22f, BayY + 0.22f, 4.2f},
                               {0.0f, 0.0f, -1.0f}, {0.1f, 0.1f, 0.1f}, 0.8f, 0.0f,
                               {48.0f, 44.0f, 38.0f});
        }
        BuildOrderedVisibility(Hall);
        ConfigurePerspectiveCamera(Hall, 32u, 24u, {-19.8f, -10.6f, 1.6f}, {-19.8f, -6.6f, 0.0f}, 46.0f);

        std::vector<RadiantFacetPhotometry> HallPhotometry;
        for (uint32_t Idx = 0; Idx < Hall.Surfaces.size(); ++Idx)
        {
            if (Hall.Surfaces[Idx].Emissive[0] > 0.0f)
            {
                RadiantFacetPhotometry Entry{};
                Entry.FacetIndex      = Idx;
                Entry.ForwardAxis     = {0.0, 0.0, -1.0};
                Entry.UpAxis          = {0.0, 1.0, 0.0};
                Entry.Photometry      = ShowroomIes;
                Entry.TwoSidedEnabled = false;
                HallPhotometry.push_back(Entry);
            }
        }

        PhotometricClusterSpecification GlobalPhotometricSpec{};
        GlobalPhotometricSpec.MinimumBoundary        = {-24.0, -12.0, -0.5};
        GlobalPhotometricSpec.MaximumBoundary        = {24.0, 12.0, 5.0};
        GlobalPhotometricSpec.GridResolution         = {8u, 4u, 2u};
        GlobalPhotometricSpec.RadiantSlotsPerCell    = 0u;
        GlobalPhotometricSpec.GlobalMixtureFraction  = 1.0;
        GlobalPhotometricSpec.AnalyticChannelEnabled = false;

        PhotometricClusterSpecification ClusteredSpec = GlobalPhotometricSpec;
        ClusteredSpec.RadiantSlotsPerCell             = 6u;
        ClusteredSpec.GlobalMixtureFraction           = 0.12;

        // 96-frame converged GPU reference + 16-frame unbiasedness comparison.
        const size_t PixelCount = Hall.Receivers.size();
        std::vector<std::array<double, 3>> RefAccum(PixelCount, {0.0, 0.0, 0.0});
        constexpr uint32_t RefFrames = 64u;
        for (uint32_t F = 0; F < RefFrames; ++F)
        {
            const auto Img = ExecutePhotometricPathReplay(
                Compute, Hall, {}, HallPhotometry, ClusteredSpec, true, true, 1u, 4u, 9001u + 977u * F);
            for (size_t P = 0; P < PixelCount; ++P)
            {
                for (uint32_t C = 0; C < 3u; ++C) RefAccum[P][C] += double(Img[P][C]) / double(RefFrames);
            }
        }

        const auto Global1Spp  = ExecutePhotometricPathReplay(
            Compute, Hall, {}, HallPhotometry, GlobalPhotometricSpec, true, true, 1u, 1u, 44101u);
        const auto Cluster1Spp = ExecutePhotometricPathReplay(
            Compute, Hall, {}, HallPhotometry, ClusteredSpec, true, true, 1u, 1u, 44101u);

        double RefLumMean     = 0.0;
        double GlobalLumMean  = 0.0;
        double ClusterLumMean = 0.0;
        double GlobalSqErr    = 0.0;
        double ClusterSqErr   = 0.0;
        for (size_t P = 0; P < PixelCount; ++P)
        {
            const double RefL  = 0.2126 * RefAccum[P][0] + 0.7152 * RefAccum[P][1] + 0.0722 * RefAccum[P][2];
            const double GlobL = 0.2126 * Global1Spp[P][0] + 0.7152 * Global1Spp[P][1] + 0.0722 * Global1Spp[P][2];
            const double ClusL = 0.2126 * Cluster1Spp[P][0] + 0.7152 * Cluster1Spp[P][1] + 0.0722 * Cluster1Spp[P][2];
            RefLumMean += RefL / double(PixelCount);
            GlobalLumMean += GlobL / double(PixelCount);
            ClusterLumMean += ClusL / double(PixelCount);
            GlobalSqErr += (GlobL - RefL) * (GlobL - RefL) / double(PixelCount);
            ClusterSqErr += (ClusL - RefL) * (ClusL - RefL) / double(PixelCount);
        }
        const double GlobalRmse  = std::sqrt(GlobalSqErr);
        const double ClusterRmse = std::sqrt(ClusterSqErr);

        std::printf("GPU_EMISSIVE_IES_CLUSTERS bays=24 facets=48 ref_mean=%.5f global_mean=%.5f cluster_mean=%.5f global_1spp_rmse=%.5f cluster_1spp_rmse=%.5f rmse_reduction=%.2fx\n",
                    RefLumMean, GlobalLumMean, ClusterLumMean, GlobalRmse, ClusterRmse,
                    GlobalRmse / std::max(ClusterRmse, 1e-9));
        std::fflush(stdout);

        Require(ClusterRmse * 2.2 < GlobalRmse,
                "GPU O(1) Vose-alias clustered Emissive-IES did not achieve >2.2x 1-spp RMSE reduction");
        Require(std::abs(ClusterLumMean - RefLumMean) < 0.025,
                "GPU O(1) Vose-alias clustered Emissive-IES mean drifted from converged reference");
    }

    // Phase 4 GPU: Head-to-Head Showroom Comparison (Diffuse Emissive vs Analytic IES vs Emissive-IES vs Hybrid).
    {
        const uint32_t Width  = 80u;
        const uint32_t Height = 56u;

        auto BuildShowroomBase = [&](bool WithEmissivePanel, std::array<float, 3> PanelRadiance) -> LightComputeArchive
        {
            LightComputeArchive Room{};
            // Glossy showroom floor (r = 0.08) + matte back wall (Y = 2.8) + occluding inspection plinth.
            AppendOrientedQuad(Room.Surfaces,
                               {-4.0f, -4.0f, 0.0f}, {4.0f, -4.0f, 0.0f},
                               {4.0f, 3.0f, 0.0f}, {-4.0f, 3.0f, 0.0f},
                               {0.0f, 0.0f, 1.0f}, {0.32f, 0.34f, 0.38f}, 0.08f, 0.15f);
            AppendOrientedQuad(Room.Surfaces,
                               {-4.0f, 2.8f, 0.0f}, {4.0f, 2.8f, 0.0f},
                               {4.0f, 2.8f, 3.4f}, {-4.0f, 2.8f, 3.4f},
                               {0.0f, -1.0f, 0.0f}, {0.78f, 0.78f, 0.80f}, 0.65f, 0.0f);
            // Low sculptural block casting penumbra vs crisp punctual shadow on floor.
            AppendOrientedQuad(Room.Surfaces,
                               {-0.55f, 0.35f, 0.55f}, {0.55f, 0.35f, 0.55f},
                               {0.55f, 1.15f, 0.55f}, {-0.55f, 1.15f, 0.55f},
                               {0.0f, 0.0f, 1.0f}, {0.68f, 0.24f, 0.20f}, 0.25f, 0.0f);
            AppendOrientedQuad(Room.Surfaces,
                               {-0.55f, 0.35f, 0.0f}, {0.55f, 0.35f, 0.0f},
                               {0.55f, 0.35f, 0.55f}, {-0.55f, 0.35f, 0.55f},
                               {0.0f, -1.0f, 0.0f}, {0.68f, 0.24f, 0.20f}, 0.25f, 0.0f);
            if (WithEmissivePanel)
            {
                // Finite 0.70m x 0.70m ceiling luminaire at (0, 1.85, 2.95).
                AppendOrientedQuad(Room.Surfaces,
                                   {-0.35f, 1.50f, 2.95f}, {0.35f, 1.50f, 2.95f},
                                   {0.35f, 2.20f, 2.95f}, {-0.35f, 2.20f, 2.95f},
                                   {0.0f, 0.0f, -1.0f}, {0.1f, 0.1f, 0.1f}, 0.8f, 0.0f,
                                   PanelRadiance);
            }
            BuildOrderedVisibility(Room);
            ConfigurePerspectiveCamera(Room, Width, Height, {0.0f, -3.45f, 1.55f}, {0.0f, 1.65f, 0.95f}, 48.0f);
            return Room;
        };

        PhotometricClusterSpecification RoomCluster{};
        RoomCluster.MinimumBoundary        = {-4.5, -4.5, -0.2};
        RoomCluster.MaximumBoundary        = {4.5, 3.5, 3.6};
        RoomCluster.GridResolution         = {4u, 4u, 2u};
        RoomCluster.AnalyticCellCapacity   = 8u;
        RoomCluster.RadiantSlotsPerCell    = 4u;
        RoomCluster.GlobalMixtureFraction  = 0.15;
        RoomCluster.AnalyticChannelEnabled = true;

        LightComputeArchive DiffuseRoom     = BuildShowroomBase(true, {18.0f, 16.8f, 15.0f});
        LightComputeArchive AnalyticIesRoom = BuildShowroomBase(false, {0.0f, 0.0f, 0.0f});
        LightComputeArchive EmissiveIesRoom = BuildShowroomBase(true, {30.0f, 28.0f, 25.0f});

        AnalyticLuminaireSpecification KeyAnalyticIes{};
        KeyAnalyticIes.Position      = {0.0, 1.85, 2.95};
        KeyAnalyticIes.ReachRadiusM  = 7.0;
        KeyAnalyticIes.IntensityRgb  = {14.7, 13.72, 12.25};
        KeyAnalyticIes.Category      = AnalyticLuminaireCategory::Point;
        KeyAnalyticIes.ForwardAxis   = {0.0, 0.0, -1.0};
        KeyAnalyticIes.UpAxis        = {0.0, 1.0, 0.0};
        KeyAnalyticIes.Photometry    = ShowroomIes;
        KeyAnalyticIes.ActiveEnabled = true;

        AnalyticLuminaireSpecification WarmAccentIes = KeyAnalyticIes;
        WarmAccentIes.Position                       = {-1.65, 2.15, 2.85};
        WarmAccentIes.IntensityRgb                   = {11.0, 7.2, 3.6};

        std::vector<RadiantFacetPhotometry> EmissiveIesTable;
        for (uint32_t Idx = 0; Idx < EmissiveIesRoom.Surfaces.size(); ++Idx)
        {
            if (EmissiveIesRoom.Surfaces[Idx].Emissive[0] > 0.0f)
            {
                RadiantFacetPhotometry Entry{};
                Entry.FacetIndex      = Idx;
                Entry.ForwardAxis     = {0.0, 0.0, -1.0};
                Entry.UpAxis          = {0.0, 1.0, 0.0};
                Entry.Photometry      = ShowroomIes;
                Entry.TwoSidedEnabled = false;
                EmissiveIesTable.push_back(Entry);
            }
        }

        auto AccumulateShowroomArm = [&](LightComputeArchive&                               Room,
                                         const std::vector<AnalyticLuminaireSpecification>& Analytics,
                                         const std::vector<RadiantFacetPhotometry>&         Photometry,
                                         bool                                               SampleFacets,
                                         uint32_t                                           Frames,
                                         uint64_t&                                          OutRaysPerFrame)
        {
            const size_t Count = Room.Receivers.size();
            std::vector<std::array<float, 4>> Avg(Count, {0.0f, 0.0f, 0.0f, 1.0f});
            uint64_t RaySum = 0u;
            for (uint32_t F = 0; F < Frames; ++F)
            {
                uint64_t FrameRays = 0u;
                PhotometricClusterSpecification Spec = RoomCluster;
                Spec.AnalyticChannelEnabled          = !Analytics.empty();
                Spec.RadiantSlotsPerCell             = SampleFacets ? 4u : 0u;
                const auto Img = ExecutePhotometricPathReplay(
                    Compute, Room, Analytics, Photometry, Spec, true, SampleFacets, 2u, 2u, 61001u + 613u * F, &FrameRays);
                RaySum += FrameRays;
                for (size_t P = 0; P < Count; ++P)
                {
                    for (uint32_t C = 0; C < 3u; ++C) Avg[P][C] += Img[P][C] / float(Frames);
                }
            }
            OutRaysPerFrame = RaySum / Frames;
            return Avg;
        };

        uint64_t DiffuseRays     = 0u;
        uint64_t AnalyticIesRays = 0u;
        uint64_t EmissiveIesRays = 0u;
        uint64_t HybridIesRays   = 0u;
        constexpr uint32_t ShowroomFrames = 24u;

        const auto DiffuseImg     = AccumulateShowroomArm(DiffuseRoom, {}, {}, true, ShowroomFrames, DiffuseRays);
        const auto AnalyticIesImg = AccumulateShowroomArm(AnalyticIesRoom, {KeyAnalyticIes}, {}, false, ShowroomFrames, AnalyticIesRays);
        const auto EmissiveIesImg = AccumulateShowroomArm(EmissiveIesRoom, {}, EmissiveIesTable, true, ShowroomFrames, EmissiveIesRays);
        const auto AccentOnlyImg  = AccumulateShowroomArm(AnalyticIesRoom, {WarmAccentIes}, {}, false, ShowroomFrames, AnalyticIesRays);
        const auto HybridBothImg  = AccumulateShowroomArm(EmissiveIesRoom, {WarmAccentIes}, EmissiveIesTable, true, ShowroomFrames, HybridIesRays);

        // Measure physical differentiators:
        // 1. Upper back-wall cutoff (top rows Y < 10 see near-ceiling wall >60 deg off nadir where IES is 0 cd!).
        // 2. Glossy floor area-specular reflection (bottom rows Y in [38, 52] reflect the finite ceiling aperture
        //    under Diffuse & Emissive-IES, whereas punctual Analytic-IES has zero solid angle!).
        // 3. Superposition check: Hybrid(EmissiveIES + WarmAccentAnalyticIES) == EmissiveIES + AccentOnly!
        auto RegionLuminance = [&](const std::vector<std::array<float, 4>>& Img,
                                   uint32_t X0, uint32_t X1, uint32_t Y0, uint32_t Y1) -> double
        {
            double Sum = 0.0;
            uint32_t N = 0u;
            for (uint32_t Y = Y0; Y < Y1; ++Y)
            {
                for (uint32_t X = X0; X < X1; ++X)
                {
                    const auto& P = Img[size_t(Y) * Width + X];
                    Sum += 0.2126 * double(P[0]) + 0.7152 * double(P[1]) + 0.0722 * double(P[2]);
                    ++N;
                }
            }
            return Sum / std::max(1u, N);
        };

        const double UpperWallDiffuse     = RegionLuminance(DiffuseImg, 24u, 56u, 5u, 11u);
        const double UpperWallAnalyticIes = RegionLuminance(AnalyticIesImg, 24u, 56u, 5u, 11u);
        const double UpperWallEmissiveIes = RegionLuminance(EmissiveIesImg, 24u, 56u, 5u, 11u);

        const double GlossFloorAnalyticIes = RegionLuminance(AnalyticIesImg, 34u, 46u, 40u, 50u);
        const double GlossFloorEmissiveIes = RegionLuminance(EmissiveIesImg, 34u, 46u, 40u, 50u);

        double HybridMean     = 0.0;
        double SuperposedMean = 0.0;
        for (size_t P = 0; P < HybridBothImg.size(); ++P)
        {
            const double H = 0.2126 * HybridBothImg[P][0] + 0.7152 * HybridBothImg[P][1] + 0.0722 * HybridBothImg[P][2];
            const double S = 0.2126 * (EmissiveIesImg[P][0] + AccentOnlyImg[P][0]) +
                             0.7152 * (EmissiveIesImg[P][1] + AccentOnlyImg[P][1]) +
                             0.0722 * (EmissiveIesImg[P][2] + AccentOnlyImg[P][2]);
            HybridMean += H / double(HybridBothImg.size());
            SuperposedMean += S / double(HybridBothImg.size());
        }

        std::printf("GPU_SHOWROOM_COMPARISON width=%u height=%u upper_wall_diffuse=%.5f upper_wall_analytic_ies=%.5f upper_wall_emissive_ies=%.5f gloss_floor_analytic_ies=%.5f gloss_floor_emissive_ies=%.5f hybrid_mean=%.5f superposed_ref=%.5f hybrid_rel_err=%.5f rays_analytic=%llu rays_emissive_ies=%llu rays_hybrid=%llu\n",
                    Width, Height,
                    UpperWallDiffuse, UpperWallAnalyticIes, UpperWallEmissiveIes,
                    GlossFloorAnalyticIes, GlossFloorEmissiveIes,
                    HybridMean, SuperposedMean,
                    std::abs(HybridMean - SuperposedMean) / std::max(SuperposedMean, 1e-6),
                    static_cast<unsigned long long>(AnalyticIesRays),
                    static_cast<unsigned long long>(EmissiveIesRays),
                    static_cast<unsigned long long>(HybridIesRays));
        std::fflush(stdout);

        Require(UpperWallAnalyticIes < 0.25 * UpperWallDiffuse && UpperWallEmissiveIes < 0.35 * UpperWallDiffuse,
                "Analytic-IES and Emissive-IES must enforce LM-63 upper-wall cutoff relative to isotropic diffuse panel");
        Require(GlossFloorEmissiveIes > 1.25 * GlossFloorAnalyticIes,
                "Emissive-IES finite aperture must produce stronger physical glossy reflection than punctual Analytic-IES");
        Require(std::abs(HybridMean - SuperposedMean) / std::max(SuperposedMean, 1e-6) < 0.06,
                "Simultaneous multiplexed Analytic-IES + Emissive-IES violated linear radiative superposition");

        if (!CaptureDir.empty())
        {
            std::filesystem::create_directories(CaptureDir);
            SaveFloat32RgbCapture(CaptureDir + "/ShowroomDiffuseEmissive.f32", DiffuseImg);
            SaveFloat32RgbCapture(CaptureDir + "/ShowroomAnalyticIes.f32", AnalyticIesImg);
            SaveFloat32RgbCapture(CaptureDir + "/ShowroomEmissiveIes.f32", EmissiveIesImg);
            SaveFloat32RgbCapture(CaptureDir + "/ShowroomHybridBothIes.f32", HybridBothImg);
        }
    }
}

inline void ValidatePhotometricClusterGpuSuite(const char*        Driver,
                                               const std::string& MediumShaderDir,
                                               const std::string& ReplayShaderDir,
                                               const std::string& CaptureDir)
{
    std::printf("PHOTOMETRIC_CLUSTER_GPU_START phases=4\n");
    std::fflush(stdout);
    ValidateGpuAnalyticClustersAndFog(Driver, MediumShaderDir);
    ValidateGpuClusteredEmissiveAndAnalyticIes(Driver, ReplayShaderDir, CaptureDir);
    std::printf("PHOTOMETRIC_CLUSTER_GPU_DECISION analytic_cone=PASS clustered_fog=PASS emissive_ies_vose_alias=PASS hybrid_superposition=PASS status=PASS\n");
    std::fflush(stdout);
}
