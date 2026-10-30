/*==========================================================================================================================================
                                                     FRAMEGRAPHEXECUTION.H
==========================================================================================================================================*/
// 🧩 Unified FrameGraph compiler, parallel multi-threaded unit recorder, and DedicatedRenderThreadExtension over SnapshotExchange.

#pragma once

#include "Engine/Rendering/BarrierDerivation.h"
#include "Engine/Rendering/SubmissionOrder.h"
#include "Engine/Rendering/TransientTargetAtlas.h"
#include "Engine/Threading/SnapshotExchange.h"
#include "Engine/Threading/TaskGraphExtension.h"

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                      COMPILED FRAME-GRAPH PLAN & PARALLEL RECORDER
//------------------------------------------------------------------------------------------------------------------------

struct RecordedCommandPacket
{
    std::uint32_t              SubmissionPosition = 0u;
    std::string                UnitName;
    std::vector<DerivedBarrier> PrecedingBarriers;
    std::uint64_t              PayloadTag         = 0u; // caller-populated command-buffer handle or verification digest
};

using FrameGraphUnitRecordFn = std::function<std::uint64_t(std::uint32_t SubmissionPosition, const SubmissionUnitDeclaration& Unit)>;

struct FrameGraphUnitEntry
{
    SubmissionUnitDeclaration Declaration;
    FrameGraphUnitRecordFn    RecordCallback;
};

struct FrameGraphCompileMetrics
{
    std::uint32_t ResolvedUnitCount     = 0u;
    std::uint32_t TotalBarrierCount     = 0u;
    std::uint32_t LayoutTransitionCount = 0u;
    std::uint32_t AliasedBinCount       = 0u;
    std::uint64_t AliasedAtlasBytes     = 0u;
    std::uint64_t UnaliasedTotalBytes   = 0u;
    double        MemorySavingsFraction = 0.0;
};

class CompiledFrameGraphPlan
{
public:
    CompiledFrameGraphPlan() = default;

    void Clear() noexcept;
    void DeclareTarget(const RenderTargetDeclaration& Target);
    void DeclareSubmissionUnit(const SubmissionUnitDeclaration& Unit, FrameGraphUnitRecordFn RecordCallback = {});

    [[nodiscard]] bool CompilePlan(FrameGraphCompileMetrics& OutMetrics, std::string& OutDiagnostic);

    // Records all submission units in parallel across WorkerPool (independent secondary command recording)
    // and assembles deterministic ordered RecordedCommandPackets with exact preceding DerivedBarriers!
    [[nodiscard]] bool ExecuteParallelRecording(
        WorkerPool&                         Pool,
        std::vector<RecordedCommandPacket>& OutOrderedPackets,
        std::string&                        OutDiagnostic) const;

    [[nodiscard]] const ResolvedSubmissionOrder& Order() const noexcept          { return Order_; }
    [[nodiscard]] const DerivedBarriers&         Barriers() const noexcept       { return Barriers_; }
    [[nodiscard]] const ResolvedTransientAtlas&  TransientAtlas() const noexcept { return Atlas_; }
    [[nodiscard]] bool                           Compiled() const noexcept       { return Compiled_; }

private:
    std::vector<RenderTargetDeclaration>        Targets_;
    std::vector<FrameGraphUnitEntry>            Units_;
    ResolvedSubmissionOrder                     Order_{};
    DerivedBarriers                             Barriers_{};
    ResolvedTransientAtlas                      Atlas_{};
    std::vector<std::vector<DerivedBarrier>>    BarriersPerPosition_;
    bool                                        Compiled_ = false;
};

//------------------------------------------------------------------------------------------------------------------------
//                                  DEDICATED RENDER THREAD DIVISION (TRIPLE-BUFFERED)
//------------------------------------------------------------------------------------------------------------------------

struct RenderFrameEnvelope
{
    std::uint64_t FrameOrdinal            = 0u;
    double        SimulationClockSeconds  = 0.0;
    double        InterpolationAlpha      = 1.0;
    std::uint32_t NetworkTick             = 0u;
    std::uint32_t ActiveWeatherParticles  = 0u;
    std::uint32_t ActiveAudioSources      = 0u;
};

struct RenderThreadDiagnostics
{
    std::uint64_t PublishedFrames         = 0u;
    std::uint64_t RenderedFrames          = 0u;
    std::uint64_t LatestRenderedOrdinal   = 0u;
    double        LastFrameRecordMillis   = 0.0;
};

class DedicatedRenderThreadExtension
{
public:
    using RenderFrameCallback = std::function<void(const RenderFrameEnvelope& Frame)>;

    DedicatedRenderThreadExtension() = default;
    ~DedicatedRenderThreadExtension() noexcept
    {
        Retire();
    }

    DedicatedRenderThreadExtension(const DedicatedRenderThreadExtension&)            = delete;
    DedicatedRenderThreadExtension& operator=(const DedicatedRenderThreadExtension&) = delete;

    [[nodiscard]] bool Start(RenderFrameCallback Callback);
    void               PublishSimulationFrame(const RenderFrameEnvelope& Envelope) noexcept;
    void               WaitUntilOrdinalRendered(std::uint64_t TargetOrdinal) noexcept;
    void               Retire() noexcept;

    [[nodiscard]] RenderThreadDiagnostics QueryDiagnostics() const noexcept;
    [[nodiscard]] bool                    Running() const noexcept { return Running_.load(std::memory_order_acquire); }

private:
    void ThreadLoop();

    SnapshotExchange<RenderFrameEnvelope> Exchange_;
    RenderFrameCallback                   Callback_;
    std::thread                           Thread_;
    mutable std::mutex                    WakeMutex_;
    std::condition_variable               WakeCv_;
    std::condition_variable               DoneCv_;
    std::atomic<bool>                     Running_{ false };
    std::atomic<bool>                     Stopping_{ false };
    std::atomic<std::uint64_t>            PublishedFrames_{ 0u };
    std::atomic<std::uint64_t>            RenderedFrames_{ 0u };
    std::atomic<std::uint64_t>            LatestOrdinal_{ 0u };
    std::atomic<double>                   LastMillis_{ 0.0 };
};

} // namespace Frontier
