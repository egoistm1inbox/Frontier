/*==========================================================================================================================================
                                                        FRACTURESTUDIORUNTIME.H
==========================================================================================================================================*/
// Native fracture-to-rigid-body bridge. The interface keeps the editor UI independent of Jolt; FrontierPhysicsExtension
// supplies the Jolt-backed implementation and the same solver result can also be tested with a headless substrate.

#pragma once

#include "Frontier/Engine/Fracture/FracturePartition.h"

#include <array>
#include <cstddef>
#include <string>

namespace Frontier::Fracture
{

struct BodyPose
{
    std::array<double, 3> PositionMetres{};
    std::array<double, 4> Orientation{ 0.0, 0.0, 0.0, 1.0 };
    std::array<double, 3> LinearVelocityMps{};
    std::array<double, 3> AngularVelocityRads{};
    bool Awake = false;
};

class IFractureStudioRuntime
{
  public:
    virtual ~IFractureStudioRuntime() = default;
    virtual bool Bake(const Polyhedron& BaseSolid, const Request& Specification, const Material& MaterialProperties,
                      std::string* OutDiagnostic = nullptr) = 0;
    virtual bool Strike(const Vec3& ImpactPoint, const Vec3& ImpactNormal, double EnergyJoules,
                        std::string* OutDiagnostic = nullptr) = 0;
    virtual bool Reassemble(std::string* OutDiagnostic = nullptr) = 0;
    virtual void Step(double DeltaSeconds, uint32_t CollisionSteps = 1) = 0;
    [[nodiscard]] virtual const Result& QueryResult() const noexcept = 0;
    [[nodiscard]] virtual size_t QueryFragmentBodyCount() const noexcept = 0;
    [[nodiscard]] virtual bool QueryFragmentBody(uint32_t Index, BodyPose& OutPose) const noexcept = 0;
    [[nodiscard]] virtual size_t QueryAwakeBodyCount() const noexcept = 0;
    [[nodiscard]] virtual double QuerySimulatedSeconds() const noexcept = 0;
    [[nodiscard]] virtual bool QueryPhysicsReady() const noexcept = 0;
};

} // namespace Frontier::Fracture
