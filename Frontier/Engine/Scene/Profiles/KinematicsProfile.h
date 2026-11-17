/*==========================================================================================================================================
                                                         KINEMATICSPROFILE.H
==========================================================================================================================================*/
// 🧩 Shared velocity, motion regime, and gravity-coupling profile.

#pragma once

#include "Frontier/Engine/Foundation/Math.h"

#include <cstdint>

namespace Frontier
{

enum class MotionRegime : uint8_t
{
    Fixed     = 0,
    Kinematic = 1,
    Dynamic   = 2,
};

struct KinematicsProfile
{
    MotionRegime Motion = MotionRegime::Dynamic;
    Vec3d        LinearVelocityMps{ 0.0, 0.0, 0.0 };
    Vec3d        AngularVelocityRadSec{ 0.0, 0.0, 0.0 };
    bool         GravityCoupled = true;
    bool         AllowSleep     = true;
    uint64_t     Revision       = 0;

    void AdvanceRevision() noexcept { ++Revision; }

    [[nodiscard]] double LinearSpeedMps() const noexcept { return Length(LinearVelocityMps); }

    [[nodiscard]] double AngularSpeedRadSec() const noexcept { return Length(AngularVelocityRadSec); }
};

} // namespace Frontier
