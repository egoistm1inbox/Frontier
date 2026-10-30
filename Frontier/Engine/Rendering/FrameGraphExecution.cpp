/*==========================================================================================================================================
                                                    FRAMEGRAPHEXECUTION.CPP
==========================================================================================================================================*/
// 🧩 Unified FrameGraph compiler, parallel multi-threaded unit recorder, and DedicatedRenderThreadExtension implementation.

#include "Engine/Rendering/FrameGraphExecution.h"

#include <chrono>
#include <utility>

namespace Frontier
{

void CompiledFrameGraphPlan::Clear() noexcept
{
    Targets_.clear();
    Units_.clear();
    Order_    = {};
    Barriers_ = {};
    Atlas_    = {};
    BarriersPerPosition_.clear();
    Compiled_ = false;
}

void CompiledFrameGraphPlan::DeclareTarget(const RenderTargetDeclaration& Target)
{
    Compiled_ = false;
    Targets_.push_back(Target);
}

void CompiledFrameGraphPlan::DeclareSubmissionUnit(
    const SubmissionUnitDeclaration& Unit,
    FrameGraphUnitRecordFn           RecordCallback)
{
    Compiled_ = false;
    Units_.push_back({ Unit, std::move(RecordCallback) });
}

bool CompiledFrameGraphPlan::CompilePlan(FrameGraphCompileMetrics& OutMetrics, std::string& OutDiagnostic)
{
    OutMetrics = {};
    OutDiagnostic.clear();
    Compiled_  = false;

    std::vector<SubmissionUnitDeclaration> Decls;
    Decls.reserve(Units_.size());
    for (const FrameGraphUnitEntry& E : Units_)
    {
        Decls.push_back(E.Declaration);
    }

    if (!ResolveSubmissionOrder(Decls, Order_, OutDiagnostic))
    {
        return false;
    }

    if (!DeriveBarriers(Decls, Order_, Targets_, Barriers_, OutDiagnostic))
    {
        return false;
    }

    if (!ResolveTransientTargetAtlas(Decls, Order_, Targets_, Atlas_, OutDiagnostic))
    {
        return false;
    }

    BarriersPerPosition_.assign(Order_.Order.size() + 1u, {});
    std::uint32_t LayoutTransitions = 0u;
    for (const DerivedBarrier& B : Barriers_.Barriers)
    {
        if (B.Kind == BarrierKind::LayoutTransition)
        {
            ++LayoutTransitions;
        }
        const std::size_t Slot = std::min<std::size_t>(B.BeforePosition, BarriersPerPosition_.size() - 1u);
        BarriersPerPosition_[Slot].push_back(B);
    }

    OutMetrics.ResolvedUnitCount     = static_cast<std::uint32_t>(Order_.Order.size());
    OutMetrics.TotalBarrierCount     = static_cast<std::uint32_t>(Barriers_.Barriers.size());
    OutMetrics.LayoutTransitionCount = LayoutTransitions;
    OutMetrics.AliasedBinCount       = static_cast<std::uint32_t>(Atlas_.BinBytes.size());
    OutMetrics.AliasedAtlasBytes     = Atlas_.TotalBytes;
    OutMetrics.UnaliasedTotalBytes   = Atlas_.UnaliasedBytes;
    OutMetrics.MemorySavingsFraction = (Atlas_.UnaliasedBytes > 0u && Atlas_.UnaliasedBytes >= Atlas_.TotalBytes)
        ? (static_cast<double>(Atlas_.UnaliasedBytes - Atlas_.TotalBytes) / static_cast<double>(Atlas_.UnaliasedBytes))
        : 0.0;

    Compiled_ = true;
    return true;
}

bool CompiledFrameGraphPlan::ExecuteParallelRecording(
    WorkerPool&                         Pool,
    std::vector<RecordedCommandPacket>& OutOrderedPackets,
    std::string&                        OutDiagnostic) const
{
    if (!Compiled_)
    {
        OutDiagnostic = "CompiledFrameGraphPlan::ExecuteParallelRecording invoked before CompilePlan.";
        return false;
    }

    const std::uint32_t Count = static_cast<std::uint32_t>(Order_.Order.size());
    OutOrderedPackets.resize(Count);

    // Secondary command buffers record independently in parallel across WorkerPool; barriers & primary submission order
    // remain strictly deterministic in Order_.Order[Pos]!
    TaskGraphSchedule::ParallelForRange(Pool, Count, 1u, [&](std::uint32_t Begin, std::uint32_t End)
    {
        for (std::uint32_t Pos = Begin; Pos < End; ++Pos)
        {
            const std::uint32_t DeclIdx        = Order_.Order[Pos];
            const FrameGraphUnitEntry& Entry   = Units_[DeclIdx];
            RecordedCommandPacket& Packet      = OutOrderedPackets[Pos];
            Packet.SubmissionPosition          = Pos;
            Packet.UnitName                    = Entry.Declaration.Name;
            Packet.PrecedingBarriers           = BarriersPerPosition_[Pos];
            Packet.PayloadTag                  = Entry.RecordCallback
                ? Entry.RecordCallback(Pos, Entry.Declaration)
                : static_cast<std::uint64_t>(Pos + 1u);
        }
    });

    return true;
}

//------------------------------------------------------------------------------------------------------------------------
//                                  DEDICATED RENDER THREAD DIVISION (TRIPLE-BUFFERED)
//------------------------------------------------------------------------------------------------------------------------

bool DedicatedRenderThreadExtension::Start(RenderFrameCallback Callback)
{
    Retire();
    if (!Callback)
    {
        return false;
    }
    Callback_ = std::move(Callback);
    Stopping_.store(false, std::memory_order_release);
    Running_.store(true, std::memory_order_release);
    Thread_ = std::thread(&DedicatedRenderThreadExtension::ThreadLoop, this);
    return true;
}

void DedicatedRenderThreadExtension::PublishSimulationFrame(const RenderFrameEnvelope& Envelope) noexcept
{
    Exchange_.Publish(Envelope);
    PublishedFrames_.fetch_add(1u, std::memory_order_acq_rel);
    std::lock_guard<std::mutex> Lock(WakeMutex_);
    WakeCv_.notify_one();
}

void DedicatedRenderThreadExtension::WaitUntilOrdinalRendered(std::uint64_t TargetOrdinal) noexcept
{
    if (!Running_.load(std::memory_order_acquire))
    {
        return;
    }
    std::unique_lock<std::mutex> Lock(WakeMutex_);
    DoneCv_.wait_for(Lock, std::chrono::seconds(5), [&]() {
        return LatestOrdinal_.load(std::memory_order_acquire) >= TargetOrdinal ||
               Stopping_.load(std::memory_order_acquire);
    });
}

void DedicatedRenderThreadExtension::Retire() noexcept
{
    if (!Running_.load(std::memory_order_acquire))
    {
        return;
    }
    {
        std::lock_guard<std::mutex> Lock(WakeMutex_);
        Stopping_.store(true, std::memory_order_release);
        WakeCv_.notify_all();
    }
    if (Thread_.joinable())
    {
        Thread_.join();
    }
    Running_.store(false, std::memory_order_release);
}

RenderThreadDiagnostics DedicatedRenderThreadExtension::QueryDiagnostics() const noexcept
{
    RenderThreadDiagnostics D{};
    D.PublishedFrames       = PublishedFrames_.load(std::memory_order_acquire);
    D.RenderedFrames        = RenderedFrames_.load(std::memory_order_acquire);
    D.LatestRenderedOrdinal = LatestOrdinal_.load(std::memory_order_acquire);
    D.LastFrameRecordMillis = LastMillis_.load(std::memory_order_acquire);
    return D;
}

void DedicatedRenderThreadExtension::ThreadLoop()
{
    for (;;)
    {
        RenderFrameEnvelope Incoming{};
        {
            std::unique_lock<std::mutex> Lock(WakeMutex_);
            WakeCv_.wait(Lock, [&]() {
                return Exchange_.QueryFresh() || Stopping_.load(std::memory_order_acquire);
            });
            if (!Exchange_.Take(Incoming))
            {
                if (Stopping_.load(std::memory_order_acquire))
                {
                    break;
                }
                continue;
            }
        }

        const auto T0 = std::chrono::steady_clock::now();
        if (Callback_)
        {
            Callback_(Incoming);
        }
        const auto T1 = std::chrono::steady_clock::now();
        LastMillis_.store(std::chrono::duration<double, std::milli>(T1 - T0).count(), std::memory_order_release);
        RenderedFrames_.fetch_add(1u, std::memory_order_acq_rel);

        {
            std::lock_guard<std::mutex> Lock(WakeMutex_);
            LatestOrdinal_.store(Incoming.FrameOrdinal, std::memory_order_release);
            DoneCv_.notify_all();
        }
    }
}

} // namespace Frontier
