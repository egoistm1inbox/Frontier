//============================================================================================================================================
//                                                        VEHICLESPAWNSOLVER.H
//============================================================================================================================================
// 🧩 Fits the calibrated suspension struts and four-tyre envelope onto supporting terrain prior to physics integration.

#pragma once

#include "VehicleSolver.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace Frontier::Vehicle
{

struct VehicleSpawnReading
{
    ChassisState Pose           {};      // [-] - Resolved equilibrium chassis pose
    uint32_t     GroundContacts = 0u;    // [-] - Number of corner support queries that succeeded
    bool         Supported      = false; // [-] - True when all four tyres clear a non-degenerate support plane
};

[[nodiscard]] inline VehicleSpawnReading ResolveVehicleSpawn(
    const VehicleSolverConfiguration& Configuration,
    const ChassisState&               Requested,
    const GroundQuery&                Ground,
    float                             Clearance = 0.02f) noexcept
{
    VehicleSpawnReading Result;
    Result.Pose = Requested;

    if (!Ground || Configuration.Wheels.size() != 4u)
    {
        return Result;
    }

    std::array<Vec3, 4> Contacts{};
    std::array<Vec3, 4> Hubs{};

    for (uint32_t Wheel = 0u; Wheel < 4u; ++Wheel)
    {
        const WheelMount&              Mount  = Configuration.Wheels[Wheel];
        const SuspensionSpecification& Strut  = Wheel < 2u ? Configuration.FrontStrut : Configuration.RearStrut;
        const float                    Mirror = Mount.LocalOffset.y < 0.0f ? -1.0f : 1.0f;

        Hubs[Wheel] = Configuration.SuspensionEnabled
                        ? Mount.SuspensionMount +
                              Vec3{Strut.AxisX, Strut.AxisY * Mirror, Strut.AxisZ} *
                                  (Strut.FreeLength - Strut.StaticCompression)
                        : Mount.LocalOffset;

        Vec3 Normal{};
        if (Ground(Requested.Position + Requested.Orientation.Rotate(Mount.SuspensionMount), Contacts[Wheel], Normal))
        {
            ++Result.GroundContacts;
        }
    }

    if (Result.GroundContacts != 4u)
    {
        return Result;
    }

    Vec3 Normal = Cross(Contacts[1] - Contacts[0], Contacts[2] - Contacts[0]);
    Normal += Cross(Contacts[2] - Contacts[3], Contacts[1] - Contacts[3]);
    if (Normal.LengthSq() < 1.0e-10f)
    {
        return Result;
    }
    Normal = Normal.Normalized();
    if (Normal.z < 0.0f)
    {
        Normal = Normal * -1.0f;
    }
    if (Normal.z < 0.1f)
    {
        return Result;
    }

    Vec3 Forward = Requested.Orientation.Rotate({1.0f, 0.0f, 0.0f});
    Forward      = (Forward - Normal * Dot(Forward, Normal)).Normalized();
    if (Forward.LengthSq() < 0.5f)
    {
        return Result;
    }
    const Vec3 Left = Cross(Normal, Forward).Normalized();

    const float Basis[3][3] = {
        {Forward.x, Left.x, Normal.x},
        {Forward.y, Left.y, Normal.y},
        {Forward.z, Left.z, Normal.z},
    };

    Quat        Rotation{};
    const float Trace = Basis[0][0] + Basis[1][1] + Basis[2][2];
    if (Trace > 0.0f)
    {
        const float Scale = 2.0f * std::sqrt(Trace + 1.0f);
        Rotation          = {
            (Basis[2][1] - Basis[1][2]) / Scale,
            (Basis[0][2] - Basis[2][0]) / Scale,
            (Basis[1][0] - Basis[0][1]) / Scale,
            0.25f * Scale,
        };
    }
    else
    {
        uint32_t Axis = Basis[1][1] > Basis[0][0] ? 1u : 0u;
        if (Basis[2][2] > Basis[Axis][Axis])
        {
            Axis = 2u;
        }
        const uint32_t Next  = (Axis + 1u) % 3u;
        const uint32_t Last  = (Axis + 2u) % 3u;
        const float    Scale = 2.0f * std::sqrt(1.0f + Basis[Axis][Axis] - Basis[Next][Next] - Basis[Last][Last]);
        float          Parts[4]{};
        Parts[Axis] = 0.25f * Scale;
        Parts[Next] = (Basis[Next][Axis] + Basis[Axis][Next]) / Scale;
        Parts[Last] = (Basis[Last][Axis] + Basis[Axis][Last]) / Scale;
        Parts[3]    = (Basis[Last][Next] - Basis[Next][Last]) / Scale;
        Rotation    = {Parts[0], Parts[1], Parts[2], Parts[3]};
    }
    Result.Pose.Orientation = Rotation.Normalized();

    Vec3 Centre{};
    Vec3 HubCentre{};
    for (uint32_t Wheel = 0u; Wheel < 4u; ++Wheel)
    {
        Centre += Contacts[Wheel] * 0.25f;
        HubCentre += Hubs[Wheel] * 0.25f;
    }
    Result.Pose.Position = Centre + Normal * (Configuration.Tyre.Radius + Clearance) - Result.Pose.Orientation.Rotate(HubCentre);

    for (uint32_t SweepIteration = 0u; SweepIteration < 8u; ++SweepIteration)
    {
        float Lift = 0.0f;
        for (uint32_t Wheel = 0u; Wheel < 4u; ++Wheel)
        {
            const Vec3 Hub = Result.Pose.Position + Result.Pose.Orientation.Rotate(Hubs[Wheel]);
            Vec3       Surface{};
            Vec3       Up{};
            if (!Ground(Hub, Surface, Up))
            {
                Result.Pose = Requested;
                return Result;
            }
            Up                   = Up.Normalized();
            const float Vertical = Dot(Up, Normal);
            if (Vertical <= 0.1f)
            {
                Result.Pose = Requested;
                return Result;
            }
            const float AxleDot = std::clamp(std::abs(Dot(Result.Pose.Orientation.Rotate({0.0f, 1.0f, 0.0f}), Up)), 0.0f, 1.0f);
            const float Support = Configuration.Tyre.Radius * std::sqrt(1.0f - AxleDot * AxleDot) +
                                  Configuration.Tyre.Width * 0.5f * AxleDot;
            Lift = std::max(Lift, (Support + Clearance - Dot(Hub - Surface, Up)) / Vertical);
        }

        if (Lift <= 1.0e-5f)
        {
            Result.Pose.LinearVelocity  = {};
            Result.Pose.AngularVelocity = {};
            Result.Supported            = true;
            return Result;
        }
        Result.Pose.Position += Normal * Lift;
    }

    Result.Pose = Requested;
    return Result;
}

} // namespace Frontier::Vehicle
