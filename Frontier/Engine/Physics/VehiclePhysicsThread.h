//============================================================================================================================================
//                                                       VEHICLEPHYSICSTHREAD.H
//============================================================================================================================================
// 🧩 Fixed-rate asynchronous vehicle physics worker and latest-snapshot exchange channels between game and physics lanes.

#pragma once

#include <atomic>
#include <cstdint>
#include <functional>
#include <mutex>
#include <thread>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                 LATEST-SNAPSHOT CHANNEL
//------------------------------------------------------------------------------------------------------------------------

template <typename PayloadType>
class PhysicsChannel
{
  public:
    PhysicsChannel() noexcept = default;

    PhysicsChannel(const PhysicsChannel&)            = delete;
    PhysicsChannel& operator=(const PhysicsChannel&) = delete;

    void Publish(const PayloadType& Payload) noexcept
    {
        std::lock_guard<std::mutex> Guard(ChannelMutex);
        LatestPayload = Payload;
        ++SequenceNumber;
        Occupied = true;
    }

    [[nodiscard]] bool Consume(PayloadType& OutPayload) noexcept
    {
        std::lock_guard<std::mutex> Guard(ChannelMutex);
        if (!Occupied || SequenceNumber == ConsumedSequence)
        {
            return false;
        }
        OutPayload       = LatestPayload;
        ConsumedSequence = SequenceNumber;
        return true;
    }

    [[nodiscard]] bool Peek(PayloadType& OutPayload) const noexcept
    {
        std::lock_guard<std::mutex> Guard(ChannelMutex);
        if (!Occupied)
        {
            return false;
        }
        OutPayload = LatestPayload;
        return true;
    }

    void Clear() noexcept
    {
        std::lock_guard<std::mutex> Guard(ChannelMutex);
        LatestPayload    = PayloadType{};
        SequenceNumber   = 0u;
        ConsumedSequence = 0u;
        Occupied         = false;
    }

  private:
    mutable std::mutex ChannelMutex;
    PayloadType        LatestPayload    {};      // [-] - Most recently published snapshot
    uint64_t           SequenceNumber   = 0u;    // [-] - Monotonic publication counter
    uint64_t           ConsumedSequence = 0u;    // [-] - Sequence observed by last Consume()
    bool               Occupied         = false; // [-] - True once Publish() has completed at least once
};

//------------------------------------------------------------------------------------------------------------------------
//                                              PHYSICS THREAD CONFIGURATION
//------------------------------------------------------------------------------------------------------------------------

struct VehiclePhysicsThreadConfiguration
{
    double   StepHertz       = 240.0;   // [Hz] - Fixed simulation rate (240 Hz default; up to 1000 Hz)
    uint32_t MaxCatchUpSteps = 8u;      // [-]  - Spiral-of-death cap per wakeup
    bool     PinBusyWait     = false;   // [-]  - Yield-spin instead of sleeping between ticks
};

struct VehiclePhysicsThreadMetrics
{
    uint64_t StepCount            = 0u;      // [-]  - Total fixed steps executed since Start()
    uint32_t StepsLastWake        = 0u;      // [-]  - Steps executed during most recent wakeup
    uint64_t DroppedSteps         = 0u;      // [-]  - Steps discarded when backlog exceeded MaxCatchUpSteps
    float    LastStepMicroseconds = 0.0f;    // [us] - Wall duration of most recent callback execution
    float    RealtimeRatio        = 1.0f;    // [-]  - Simulated seconds divided by real elapsed seconds
    bool     WorkerActive         = false;   // [-]  - True while worker loop is running
};

//------------------------------------------------------------------------------------------------------------------------
//                                                 VEHICLE PHYSICS THREAD
//------------------------------------------------------------------------------------------------------------------------

class VehiclePhysicsThread
{
  public:
    using StepCallback = std::function<void(uint64_t StepIndex, float FixedDeltaSeconds)>;

    VehiclePhysicsThread() noexcept = default;
    ~VehiclePhysicsThread() noexcept
    {
        Stop();
    }

    VehiclePhysicsThread(const VehiclePhysicsThread&)            = delete;
    VehiclePhysicsThread& operator=(const VehiclePhysicsThread&) = delete;

    [[nodiscard]] bool Start(const VehiclePhysicsThreadConfiguration& RequestedConfiguration, StepCallback OnStep) noexcept;
    void               Stop() noexcept;

    [[nodiscard]] bool                        Active() const noexcept { return WorkerRunning.load(std::memory_order_acquire); }
    [[nodiscard]] VehiclePhysicsThreadMetrics QueryMetrics() const noexcept;

  private:
    void RunLoop() noexcept;

    VehiclePhysicsThreadConfiguration Configuration {};                  // [-] - Latched worker timing parameters
    StepCallback                      Callback;                          // [-] - Per-fixed-step simulation callback
    std::thread                       Worker;                            // [-] - Dedicated physics execution thread
    std::atomic<bool>                 StopRequested {false};             // [-] - Cooperative shutdown signal
    std::atomic<bool>                 WorkerRunning {false};             // [-] - Atomic liveness indicator
    mutable std::mutex                MetricsMutex;                      // [-] - Guards Metrics readback
    VehiclePhysicsThreadMetrics       Metrics       {};                  // [-] - Observed step timing counters
};

} // namespace Frontier
