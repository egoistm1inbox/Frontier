/*==========================================================================================================================================
                                                              JOLTEXTENSION.H
==========================================================================================================================================*/
// 🧩 The Jolt backend of the Physics extension: Jolt's program-wide registration (allocator, factory, types) held by count, the
//    two object layers (fixed, moving) with their broad-phase mapping and filters, and the temporary allocator and job threads a
//    PhysicsSpace steps with. Only the Physics extension includes Jolt; everything above it sees PhysicsSpace.

#pragma once

#include <Jolt/Jolt.h>

#include <Jolt/Core/JobSystemThreadPool.h>
#include <Jolt/Core/TempAllocator.h>
#include <Jolt/Physics/Collision/BroadPhase/BroadPhaseLayer.h>
#include <Jolt/Physics/Collision/ObjectLayer.h>

#include <cstdint>
#include <memory>

namespace Frontier
{

// 📝 Fixed bodies (the ground, the scene's colliders) and moving bodies; fixed ones only meet moving ones.
namespace JoltLayers
{
inline constexpr JPH::ObjectLayer Fixed  = 0;
inline constexpr JPH::ObjectLayer Moving = 1;
inline constexpr JPH::ObjectLayer Count  = 2;
} // namespace JoltLayers

class JoltLayerInterface final : public JPH::BroadPhaseLayerInterface
{
  public:
    [[nodiscard]] JPH::uint            GetNumBroadPhaseLayers() const override { return 2; }
    [[nodiscard]] JPH::BroadPhaseLayer GetBroadPhaseLayer(JPH::ObjectLayer Layer) const override { return JPH::BroadPhaseLayer(static_cast<JPH::uint8>(Layer)); }
#if defined(JPH_EXTERNAL_PROFILE) || defined(JPH_PROFILE_ENABLED)
    [[nodiscard]] const char* GetBroadPhaseLayerName(JPH::BroadPhaseLayer Layer) const override
    {
        return static_cast<JPH::BroadPhaseLayer::Type>(Layer) == 0 ? "Fixed" : "Moving";
    }
#endif
};

class JoltLayerFilter final : public JPH::ObjectVsBroadPhaseLayerFilter
{
  public:
    [[nodiscard]] bool ShouldCollide(JPH::ObjectLayer Layer, JPH::BroadPhaseLayer Phase) const override
    {
        return Layer == JoltLayers::Moving || static_cast<JPH::BroadPhaseLayer::Type>(Phase) == JoltLayers::Moving;
    }
};

class JoltPairFilter final : public JPH::ObjectLayerPairFilter
{
  public:
    [[nodiscard]] bool ShouldCollide(JPH::ObjectLayer First, JPH::ObjectLayer Second) const override
    {
        return First == JoltLayers::Moving || Second == JoltLayers::Moving;
    }
};

class JoltExtension
{
  public:
    // 📝 Workers: job threads besides the caller's (0: up to 4, one less than the machine's hardware threads).
    explicit JoltExtension(uint32_t Workers = 0);
    ~JoltExtension();

    JoltExtension(const JoltExtension&)            = delete;
    JoltExtension& operator=(const JoltExtension&) = delete;

    [[nodiscard]] JPH::TempAllocator&       AccessTemporary() noexcept { return *Temporary; }
    [[nodiscard]] JPH::JobSystem&           AccessJobs() noexcept { return *Jobs; }
    [[nodiscard]] const JoltLayerInterface& QueryLayers() const noexcept { return Layers; }
    [[nodiscard]] const JoltLayerFilter&    QueryLayerFilter() const noexcept { return LayerFilter; }
    [[nodiscard]] const JoltPairFilter&     QueryPairFilter() const noexcept { return PairFilter; }
    [[nodiscard]] uint32_t                  QueryWorkers() const noexcept { return Workers_; }

  private:
    JoltLayerInterface                        Layers;
    JoltLayerFilter                           LayerFilter;
    JoltPairFilter                            PairFilter;
    std::unique_ptr<JPH::TempAllocatorImpl>   Temporary;
    std::unique_ptr<JPH::JobSystemThreadPool> Jobs;
    uint32_t                                  Workers_ = 0;
};

} // namespace Frontier
