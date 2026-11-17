/*==========================================================================================================================================
                                                             PHYSICSEXTENSION.H
==========================================================================================================================================*/
// 🧩 The bridge between a level and its PhysicsSpace: concept-driven spatial/mass binding, incremental signature hashing,
//    async PhysicsExecutionThread snapshot stepping, and impact telemetry draining.

#pragma once

#include "Frontier/Extensions/Physics/PhysicsSpace.h"

#include "Frontier/Engine/Scene/EngineConfigurations.h"
#include "Frontier/Engine/Scene/Profiles/MassProfile.h"
#include "Frontier/Engine/Scene/Profiles/ReplicationProfile.h"
#include "Frontier/Engine/Scene/Profiles/SpatialProfile.h"
#include "Frontier/Engine/Scene/RecordToken.h"

#include <array>
#include <atomic>
#include <concepts>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>

namespace Frontier
{

class WorldSpace;

struct PhysicsExtensionTally
{
    size_t Moving           = 0;
    size_t Fixed            = 0;
    size_t Held             = 0;
    size_t Skipped          = 0;
    double StepMilliseconds = 0.0;
};

template <typename EntryT>
concept PhysicsSpatialEntryConcept = requires(const EntryT& Entry) {
    { Entry.QuerySpatial() } -> std::convertible_to<const SpatialConfiguration&>;
} || requires(const EntryT& Entry) {
    { Entry.QuerySpatialProfile() } -> std::convertible_to<const SpatialProfile&>;
};

struct PhysicsStepSnapshot
{
    uint64_t                                             SequenceNumber = 0;
    double                                               SimulatedSeconds = 0.0;
    std::vector<std::pair<RecordToken, PhysicsBodyReading>> Readings;
    std::vector<PhysicsImpactEvent>                      Impacts;
};

class PhysicsExtension
{
  public:
    PhysicsExtension();
    ~PhysicsExtension();

    // 📝 Builds the space from the level and remembers every moved record's transform. Returns the moving bodies.
    size_t Begin(WorldSpace& World, const PhysicsSpaceSettings& Settings = {});
    // 📝 Same as Begin, injecting a custom IPhysicsSubstrate (e.g. deterministic headless test substrate).
    size_t BeginWithSubstrate(WorldSpace& World, std::unique_ptr<IPhysicsSubstrate> Substrate,
                              const PhysicsSpaceSettings& Settings = {});

    // 📝 Steps the space (in sub-steps of at most 1/60 s) and writes the moving bodies back. Returns the records written.
    size_t Step(WorldSpace& World, double DeltaSeconds);
    // 📝 Puts every moved record back and clears the space.
    void End(WorldSpace& World);

    // 📝 Adds an optional TriangleSurface collider directly into the active physics space (from SceneSubjectPlacement).
    uint32_t AddTriangleSurfaceCollider(uint64_t                         RecordId,
                                        const PhysicsTriangleSurfaceShape& Mesh,
                                        SurfaceMaterialClass             Material = SurfaceMaterialClass::Concrete);

    // 📝 Drains accumulated impact events from the simulation (thread-safe telemetry queue for Particle/Fluid/Fracture).
    [[nodiscard]] std::vector<PhysicsImpactEvent> DrainImpactEvents();

    // 📝 Computes a deterministic signature of physics-relevant WorldSpace bindings for incremental cache checks.
    [[nodiscard]] static uint64_t ComputeWorldBindingSignature(const WorldSpace& World);

    // 📝 Asynchronous stepping loop publishing PhysicsStepSnapshot instances at StepIntervalSeconds.
    void StartExecutionThread(double StepIntervalSeconds = 1.0 / 60.0);
    void StopExecutionThread();
    bool TryConsumeExecutionSnapshot(PhysicsStepSnapshot& OutSnapshot);

    [[nodiscard]] bool                         QueryRunning() const noexcept { return Space != nullptr; }
    [[nodiscard]] const PhysicsSpace*          QuerySpace() const noexcept { return Space.get(); }
    [[nodiscard]] const PhysicsExtensionTally& QueryTally() const noexcept { return Tally; }
    [[nodiscard]] uint64_t                     QueryLastSignature() const noexcept { return LastSignature_; }

  private:
    size_t PopulateWorldBodies(WorldSpace& World);

    struct Link
    {
        uint32_t              Body = 0;
        RecordToken           Record{};
        bool                  Geometry = true;
        std::array<double, 3> CentreOffset{};
        SpatialConfiguration  Saved{};
        bool                  SavedDynamic = false;
    };

    std::unique_ptr<PhysicsSpace>   Space;
    std::vector<Link>               Links;
    PhysicsExtensionTally           Tally;
    double                          Remainder = 0.0;
    uint64_t                        LastSignature_ = 0;
    mutable std::mutex              SpaceMutex_;

    std::jthread                    WorkerThread_;
    std::atomic<bool>               WorkerRunning_{ false };
    mutable std::mutex              SnapshotMutex_;
    PhysicsStepSnapshot             LatestSnapshot_{};
    bool                            HasUnreadSnapshot_ = false;
};

} // namespace Frontier
