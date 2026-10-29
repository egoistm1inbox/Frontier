//============================================================================================================================================
//                                                      VEHICLEPHYSICSTHREAD.CPP
//============================================================================================================================================
// 🧩 Fixed-rate asynchronous vehicle physics worker implementation.

#include "VehiclePhysicsThread.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <utility>

namespace Frontier
{

using SteadyClock = std::chrono::steady_clock;

bool VehiclePhysicsThread::Start(const VehiclePhysicsThreadConfiguration& RequestedConfiguration, StepCallback OnStep) noexcept
{
    if (WorkerRunning.load(std::memory_order_acquire))
    {
        return false;
    }
    if (!OnStep || !(RequestedConfiguration.StepHertz > 0.0))
    {
        return false;
    }

    Configuration                 = RequestedConfiguration;
    Configuration.MaxCatchUpSteps = std::max<uint32_t>(1u, Configuration.MaxCatchUpSteps);
    Callback                      = std::move(OnStep);

    StopRequested.store(false, std::memory_order_release);
    WorkerRunning.store(true, std::memory_order_release);

    {
        std::lock_guard<std::mutex> Guard(MetricsMutex);
        Metrics              = VehiclePhysicsThreadMetrics{};
        Metrics.WorkerActive = true;
    }

    Worker = std::thread([this] { RunLoop(); });
    return true;
}

void VehiclePhysicsThread::Stop() noexcept
{
    StopRequested.store(true, std::memory_order_release);
    if (Worker.joinable())
    {
        Worker.join();
    }
    WorkerRunning.store(false, std::memory_order_release);

    std::lock_guard<std::mutex> Guard(MetricsMutex);
    Metrics.WorkerActive = false;
}

VehiclePhysicsThreadMetrics VehiclePhysicsThread::QueryMetrics() const noexcept
{
    std::lock_guard<std::mutex> Guard(MetricsMutex);
    return Metrics;
}

void VehiclePhysicsThread::RunLoop() noexcept
{
    const double FixedSeconds = 1.0 / Configuration.StepHertz;
    const float  FixedDelta   = static_cast<float>(FixedSeconds);

    const auto StartTime = SteadyClock::now();
    auto       Previous  = StartTime;
    double     OwedTime  = 0.0;
    uint64_t   StepIndex = 0u;

    while (!StopRequested.load(std::memory_order_acquire))
    {
        const auto   Now     = SteadyClock::now();
        const double Elapsed = std::chrono::duration<double>(Now - Previous).count();
        Previous             = Now;
        OwedTime += Elapsed;

        uint32_t StepsThisWake    = 0u;
        float    StepMicroseconds = 0.0f;

        while (OwedTime >= FixedSeconds &&
               StepsThisWake < Configuration.MaxCatchUpSteps &&
               !StopRequested.load(std::memory_order_acquire))
        {
            const auto StepStart = SteadyClock::now();
            Callback(StepIndex, FixedDelta);
            StepMicroseconds = std::chrono::duration<float, std::micro>(SteadyClock::now() - StepStart).count();

            OwedTime -= FixedSeconds;
            ++StepIndex;
            ++StepsThisWake;
        }

        uint64_t Dropped = 0u;
        if (OwedTime >= FixedSeconds)
        {
            Dropped  = static_cast<uint64_t>(OwedTime / FixedSeconds);
            OwedTime = std::fmod(OwedTime, FixedSeconds);
        }

        if (StepsThisWake > 0u || Dropped > 0u)
        {
            const double RealElapsed = std::chrono::duration<double>(Now - StartTime).count();
            const double SimElapsed  = static_cast<double>(StepIndex) * FixedSeconds;

            std::lock_guard<std::mutex> Guard(MetricsMutex);
            Metrics.StepCount            = StepIndex;
            Metrics.StepsLastWake        = StepsThisWake;
            Metrics.DroppedSteps += Dropped;
            Metrics.LastStepMicroseconds = StepMicroseconds;
            Metrics.RealtimeRatio        = RealElapsed > 0.0 ? static_cast<float>(SimElapsed / RealElapsed) : 1.0f;
        }

        if (!Configuration.PinBusyWait)
        {
            const double Remaining = FixedSeconds - OwedTime;
            if (Remaining > 0.0)
            {
                const auto SleepDuration =
                    std::chrono::duration_cast<SteadyClock::duration>(std::chrono::duration<double>(Remaining * 0.9));
                std::this_thread::sleep_for(SleepDuration);
            }
        }
        else
        {
            std::this_thread::yield();
        }
    }
}

} // namespace Frontier
