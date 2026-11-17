/*==========================================================================================================================================
                                                         FRACTURESTUDIORUNTIME.H
==========================================================================================================================================*/
// Native Fracture Studio's transactional Jolt fragment world. Every convex shard gets its own dynamic convex-hull body;
// the workspace-local scene uses the reference editor's Y-up solid coordinates and therefore sets gravity along -Y.

#pragma once

#include "Frontier/Engine/Fracture/FractureStudioRuntime.h"
#include "Frontier/Extensions/Physics/PhysicsSpace.h"

#include <memory>
#include <string>

namespace Frontier
{

class FractureStudioRuntime final : public Fracture::IFractureStudioRuntime
{
  public:
    FractureStudioRuntime();
    ~FractureStudioRuntime() override;

    FractureStudioRuntime(const FractureStudioRuntime&) = delete;
    FractureStudioRuntime& operator=(const FractureStudioRuntime&) = delete;

    bool Bake(const Fracture::Polyhedron& BaseSolid, const Fracture::Request& Specification,
              const Fracture::Material& MaterialProperties, std::string* OutDiagnostic = nullptr) override;
    bool Strike(const Fracture::Vec3& ImpactPoint, const Fracture::Vec3& ImpactNormal, double EnergyJoules,
                std::string* OutDiagnostic = nullptr) override;
    bool Reassemble(std::string* OutDiagnostic = nullptr) override;
    void Step(double DeltaSeconds, uint32_t CollisionSteps = 1) override;

    [[nodiscard]] const Fracture::Result& QueryResult() const noexcept override { return Result_; }
    [[nodiscard]] size_t QueryFragmentBodyCount() const noexcept override { return FragmentBodyCount_; }
    [[nodiscard]] bool QueryFragmentBody(uint32_t Index, Fracture::BodyPose& OutPose) const noexcept override;
    [[nodiscard]] size_t QueryAwakeBodyCount() const noexcept override;
    [[nodiscard]] double QuerySimulatedSeconds() const noexcept override;
    [[nodiscard]] bool QueryPhysicsReady() const noexcept override { return Space != nullptr; }
    [[nodiscard]] const PhysicsSpace* QueryPhysicsSpace() const noexcept { return Space.get(); }

  private:
    bool BuildJoltWorld(const Fracture::Result& Partition, const Fracture::Material& MaterialProperties,
                        std::unique_ptr<PhysicsSpace>& OutSpace, std::string* OutDiagnostic) const;

    Fracture::Polyhedron BaseSolid_;
    Fracture::Request Specification_{};
    Fracture::Material Material_{};
    Fracture::Result Result_{};
    std::unique_ptr<PhysicsSpace> Space;
    size_t FragmentBodyCount_ = 0;
};

} // namespace Frontier
