/*==========================================================================================================================================
                                                     TASKGRAPHEXTENSION.CPP
==========================================================================================================================================*/
// 🧩 Directed acyclic task-graph scheduler & parallel-for dispatcher built atop Frontier::WorkerPool.

#include "Engine/Threading/TaskGraphExtension.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <queue>

namespace Frontier
{

void TaskGraphSchedule::Clear() noexcept
{
    Tasks_.clear();
    TopologicalOrder_.clear();
    CriticalPathDepth_ = 0u;
    MaxWavefrontWidth_ = 0u;
    Compiled_          = false;
}

TaskHandle TaskGraphSchedule::DeclareTask(
    std::string             TaskName,
    TaskDomainTag           Domain,
    std::function<void()>   WorkCallback,
    std::vector<TaskHandle> Predecessors)
{
    Compiled_ = false;
    const TaskHandle Handle = static_cast<TaskHandle>(Tasks_.size());
    TaskRecord Rec{};
    Rec.Name         = std::move(TaskName);
    Rec.Domain       = Domain;
    Rec.Callback     = std::move(WorkCallback);
    Rec.Predecessors = std::move(Predecessors);
    Tasks_.push_back(std::move(Rec));
    return Handle;
}

void TaskGraphSchedule::AddPrecedenceEdge(TaskHandle Predecessor, TaskHandle Successor)
{
    if (Predecessor < Tasks_.size() && Successor < Tasks_.size() && Predecessor != Successor)
    {
        Compiled_ = false;
        Tasks_[Successor].Predecessors.push_back(Predecessor);
    }
}

bool TaskGraphSchedule::CompileSchedule(std::string& OutDiagnostic)
{
    OutDiagnostic.clear();
    TopologicalOrder_.clear();
    CriticalPathDepth_ = 0u;
    MaxWavefrontWidth_ = 0u;
    Compiled_          = false;

    const std::size_t Count = Tasks_.size();
    if (Count == 0u)
    {
        Compiled_ = true;
        return true;
    }

    for (TaskRecord& T : Tasks_)
    {
        T.Successors.clear();
        T.DepthLevel = 0u;
        // Deduplicate & validate predecessor handles.
        std::sort(T.Predecessors.begin(), T.Predecessors.end());
        T.Predecessors.erase(std::unique(T.Predecessors.begin(), T.Predecessors.end()), T.Predecessors.end());
        for (TaskHandle Pred : T.Predecessors)
        {
            if (Pred >= Count)
            {
                OutDiagnostic = "Task '" + T.Name + "' references out-of-range predecessor handle.";
                return false;
            }
        }
    }

    std::vector<std::uint32_t> InDegree(Count, 0u);
    for (std::size_t Idx = 0u; Idx < Count; ++Idx)
    {
        for (TaskHandle Pred : Tasks_[Idx].Predecessors)
        {
            if (Pred == Idx)
            {
                OutDiagnostic = "Task '" + Tasks_[Idx].Name + "' depends on itself.";
                return false;
            }
            Tasks_[Pred].Successors.push_back(static_cast<TaskHandle>(Idx));
            ++InDegree[Idx];
        }
    }

    std::queue<TaskHandle> ReadyQueue;
    for (std::size_t Idx = 0u; Idx < Count; ++Idx)
    {
        if (InDegree[Idx] == 0u)
        {
            Tasks_[Idx].DepthLevel = 1u;
            ReadyQueue.push(static_cast<TaskHandle>(Idx));
        }
    }

    std::vector<std::uint32_t> LevelCounts(Count + 2u, 0u);
    TopologicalOrder_.reserve(Count);

    while (!ReadyQueue.empty())
    {
        const TaskHandle Curr = ReadyQueue.front();
        ReadyQueue.pop();
        TopologicalOrder_.push_back(Curr);

        const std::uint32_t Lvl = Tasks_[Curr].DepthLevel;
        CriticalPathDepth_ = std::max(CriticalPathDepth_, Lvl);
        ++LevelCounts[Lvl];
        MaxWavefrontWidth_ = std::max(MaxWavefrontWidth_, LevelCounts[Lvl]);

        for (TaskHandle Succ : Tasks_[Curr].Successors)
        {
            Tasks_[Succ].DepthLevel = std::max(Tasks_[Succ].DepthLevel, Lvl + 1u);
            if (--InDegree[Succ] == 0u)
            {
                ReadyQueue.push(Succ);
            }
        }
    }

    if (TopologicalOrder_.size() != Count)
    {
        OutDiagnostic = "Cycle detected in TaskGraphSchedule; unresolved tasks remain.";
        return false;
    }

    Compiled_ = true;
    return true;
}

bool TaskGraphSchedule::ExecuteOnPool(
    WorkerPool&           Pool,
    TaskExecutionMetrics& OutMetrics,
    std::string&          OutDiagnostic)
{
    OutMetrics = {};
    if (!Compiled_ && !CompileSchedule(OutDiagnostic))
    {
        return false;
    }

    const std::size_t Count = Tasks_.size();
    if (Count == 0u)
    {
        return true;
    }

    const auto StartClock = std::chrono::steady_clock::now();

    struct SharedDispatchContext
    {
        const std::vector<TaskRecord>*                TasksPtr = nullptr;
        WorkerPool*                                   PoolPtr  = nullptr;
        std::unique_ptr<std::atomic<std::uint32_t>[]> RemainingDeps;
        std::atomic<std::size_t>                      RemainingTasks{ 0u };
        std::mutex                                    DoneMutex;
        std::condition_variable                       DoneCv;

        static void Launch(const std::shared_ptr<SharedDispatchContext>& Self, TaskHandle Handle)
        {
            Self->PoolPtr->Submit([Self, Handle]()
            {
                const TaskRecord& Entry = (*Self->TasksPtr)[Handle];
                if (Entry.Callback)
                {
                    Entry.Callback();
                }

                for (TaskHandle Succ : Entry.Successors)
                {
                    if (Self->RemainingDeps[Succ].fetch_sub(1u, std::memory_order_acq_rel) == 1u)
                    {
                        SharedDispatchContext::Launch(Self, Succ);
                    }
                }

                if (Self->RemainingTasks.fetch_sub(1u, std::memory_order_acq_rel) == 1u)
                {
                    std::lock_guard<std::mutex> Lock(Self->DoneMutex);
                    Self->DoneCv.notify_all();
                }
            });
        }
    };

    auto Ctx           = std::make_shared<SharedDispatchContext>();
    Ctx->TasksPtr      = &Tasks_;
    Ctx->PoolPtr       = &Pool;
    Ctx->RemainingDeps = std::make_unique<std::atomic<std::uint32_t>[]>(Count);
    Ctx->RemainingTasks.store(Count, std::memory_order_relaxed);

    std::vector<TaskHandle> InitialRoots;
    for (std::size_t Idx = 0u; Idx < Count; ++Idx)
    {
        const auto DepCount = static_cast<std::uint32_t>(Tasks_[Idx].Predecessors.size());
        Ctx->RemainingDeps[Idx].store(DepCount, std::memory_order_relaxed);
        if (DepCount == 0u)
        {
            InitialRoots.push_back(static_cast<TaskHandle>(Idx));
        }
    }

    // Dynamic wavefront submission: unlocks downstream tasks immediately upon last predecessor completion!
    for (TaskHandle Root : InitialRoots)
    {
        SharedDispatchContext::Launch(Ctx, Root);
    }

    {
        std::unique_lock<std::mutex> Lock(Ctx->DoneMutex);
        Ctx->DoneCv.wait(Lock, [&]() { return Ctx->RemainingTasks.load(std::memory_order_acquire) == 0u; });
    }

    const auto EndClock = std::chrono::steady_clock::now();
    OutMetrics.TotalTasksExecuted = static_cast<std::uint32_t>(Count);
    OutMetrics.CriticalPathDepth  = CriticalPathDepth_;
    OutMetrics.MaxWavefrontWidth  = MaxWavefrontWidth_;
    OutMetrics.WallClockMillis    = std::chrono::duration<double, std::milli>(EndClock - StartClock).count();
    return true;
}

void TaskGraphSchedule::ParallelForRange(
    WorkerPool&                                              Pool,
    std::uint32_t                                            ItemCount,
    std::uint32_t                                            MinGrainSize,
    const std::function<void(std::uint32_t, std::uint32_t)>& RangeBody)
{
    if (ItemCount == 0u || !RangeBody)
    {
        return;
    }

    const std::uint32_t Grain  = std::max(1u, MinGrainSize);
    const std::uint32_t Chunks = (ItemCount + Grain - 1u) / Grain;
    if (Chunks <= 1u || Pool.QueryThreadCount() == 0u)
    {
        RangeBody(0u, ItemCount);
        return;
    }

    std::atomic<std::uint32_t> Remaining{ Chunks };
    std::mutex                 DoneMutex;
    std::condition_variable    DoneCv;

    for (std::uint32_t C = 0u; C < Chunks; ++C)
    {
        const std::uint32_t Begin = C * Grain;
        const std::uint32_t End   = std::min(ItemCount, Begin + Grain);
        Pool.Submit([Begin, End, &RangeBody, &Remaining, &DoneMutex, &DoneCv]()
        {
            RangeBody(Begin, End);
            if (Remaining.fetch_sub(1u, std::memory_order_acq_rel) == 1u)
            {
                std::lock_guard<std::mutex> Lock(DoneMutex);
                DoneCv.notify_all();
            }
        });
    }

    std::unique_lock<std::mutex> Lock(DoneMutex);
    DoneCv.wait(Lock, [&]() { return Remaining.load(std::memory_order_acquire) == 0u; });
}

} // namespace Frontier
