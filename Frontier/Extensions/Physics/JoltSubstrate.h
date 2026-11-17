/*==========================================================================================================================================
                                                             JOLTSUBSTRATE.H
==========================================================================================================================================*/
// 🧩 JoltPhysics v5.6.0 implementation of IPhysicsSubstrate: isolates all Jolt types behind PhysicsSubstrate.h.

#pragma once

#include "Frontier/Extensions/Physics/PhysicsSubstrate.h"

#include <memory>

namespace Frontier
{

class JoltSubstrate final : public IPhysicsSubstrate
{
  public:
    explicit JoltSubstrate(const PhysicsSpaceSettings& Settings = {});
    ~JoltSubstrate() override;

    JoltSubstrate(const JoltSubstrate&)            = delete;
    JoltSubstrate& operator=(const JoltSubstrate&) = delete;

    uint32_t                         AddBody(const PhysicsBodyDescriptor& Descriptor) override;
    void                             Prepare() override;
    void                             Step(double DeltaSeconds, uint32_t CollisionSteps) override;
    [[nodiscard]] PhysicsBodyReading ReadBody(uint32_t Index) const override;
    [[nodiscard]] size_t             QueryAwakeCount() const override;
    [[nodiscard]] uint64_t           QueryContactsAdded() const noexcept override;
    [[nodiscard]] uint32_t           QueryWorkers() const noexcept override;
    [[nodiscard]] std::vector<PhysicsImpactEvent> DrainImpactEvents() override;
    [[nodiscard]] uint64_t           QueryImpactCount() const override;
    void                             SetGravity(const std::array<double, 3>& GravityMps2) override;

  private:
    struct Implementation;
    std::unique_ptr<Implementation> Detail;
};

} // namespace Frontier
