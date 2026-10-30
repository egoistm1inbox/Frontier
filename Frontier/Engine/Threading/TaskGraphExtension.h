/*==========================================================================================================================================
                                                      TASKGRAPHEXTENSION.H
==========================================================================================================================================*/
// 🧩 Directed acyclic task-graph scheduler & parallel-for dispatcher built atop Frontier::WorkerPool.

#pragma once

#include "Engine/Threading/WorkerPool.h"

#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace Frontier
{

using TaskHandle = std::uint32_t;
constexpr TaskHandle InvalidTaskHandle = 0xFFFFFFFFu;

enum class TaskDomainTag : std::uint8_t
{
    GeneralCompute  = 0,
    PhysicsStep     = 1,
    NetworkSnapshot = 2,
    WeatherAndFluid = 3,
    RenderRecord    = 4,
    AudioPrep       = 5
};

struct TaskExecutionMetrics
{
    std::uint32_t TotalTasksExecuted   = 0u;
    std::uint32_t CriticalPathDepth    = 0u;
    std::uint32_t MaxWavefrontWidth    = 0u;
    double        WallClockMillis      = 0.0;
};

class TaskGraphSchedule
{
public:
    TaskGraphSchedule() = default;

    void Clear() noexcept;

    TaskHandle DeclareTask(
        std::string               TaskName,
        TaskDomainTag             Domain,
        std::function<void()>     WorkCallback,
        std::vector<TaskHandle>   Predecessors = {});

    void AddPrecedenceEdge(TaskHandle Predecessor, TaskHandle Successor);

    // Validates acyclicity via Kahn's topological pass and computes critical-path depth & wavefront parallelism.
    [[nodiscard]] bool CompileSchedule(std::string& OutDiagnostic);

    // Dispatches all ready tasks immediately onto Pool; each completing task atomically decrements its successors'
    // RemainingPredecessors counter and immediately submits newly unblocked successors onto Pool!
    [[nodiscard]] bool ExecuteOnPool(WorkerPool& Pool, TaskExecutionMetrics& OutMetrics, std::string& OutDiagnostic);

    // Data-parallel chunked range helper over WorkerPool.
    static void ParallelForRange(
        WorkerPool&                                           Pool,
        std::uint32_t                                         ItemCount,
        std::uint32_t                                         MinGrainSize,
        const std::function<void(std::uint32_t, std::uint32_t)>& RangeBody);

    [[nodiscard]] std::size_t TaskCount() const noexcept { return Tasks_.size(); }
    [[nodiscard]] const std::vector<TaskHandle>& TopologicalOrder() const noexcept { return TopologicalOrder_; }

private:
    struct TaskRecord
    {
        std::string             Name;
        TaskDomainTag           Domain = TaskDomainTag::GeneralCompute;
        std::function<void()>   Callback;
        std::vector<TaskHandle> Predecessors;
        std::vector<TaskHandle> Successors;
        std::uint32_t           DepthLevel = 0u;
    };

    std::vector<TaskRecord> Tasks_;
    std::vector<TaskHandle> TopologicalOrder_;
    std::uint32_t           CriticalPathDepth_ = 0u;
    std::uint32_t           MaxWavefrontWidth_ = 0u;
    bool                    Compiled_          = false;
};

} // namespace Frontier
