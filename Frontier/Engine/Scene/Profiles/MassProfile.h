/*==========================================================================================================================================
                                                            MASSPROFILE.H
==========================================================================================================================================*/
// 🧩 Shared inertial, density, restitution, and surface friction profile across Physics, Particles, Fluid, and Fracture.

#pragma once

#include <algorithm>
#include <cstdint>

namespace Frontier
{

struct MassProfile
{
    double   MassKilograms          = 12.5;
    double   DensityKgPerCubicMetre = 2700.0;
    double   VolumeCubicMetres      = 0.00463;
    double   Restitution            = 0.42;
    double   StaticFriction         = 0.58;
    double   DynamicFriction        = 0.44;
    double   LinearDamping          = 0.04;
    double   AngularDamping         = 0.05;
    uint64_t Revision               = 0;

    void AdvanceRevision() noexcept { ++Revision; }

    void SyncMassFromDensityAndVolume() noexcept
    {
        MassKilograms = std::max(1.0e-6, DensityKgPerCubicMetre * VolumeCubicMetres);
        AdvanceRevision();
    }

    void SyncVolumeFromMassAndDensity() noexcept
    {
        VolumeCubicMetres = MassKilograms / std::max(1.0e-4, DensityKgPerCubicMetre);
        AdvanceRevision();
    }

    [[nodiscard]] double KineticEnergyJoules(double LinearSpeedMps) const noexcept
    {
        return 0.5 * MassKilograms * LinearSpeedMps * LinearSpeedMps;
    }

    [[nodiscard]] double LinearMomentumNs(double LinearSpeedMps) const noexcept
    {
        return MassKilograms * LinearSpeedMps;
    }

    [[nodiscard]] double SolidSphereInertia(double RadiusMetres) const noexcept
    {
        return 0.4 * MassKilograms * RadiusMetres * RadiusMetres;
    }
};

} // namespace Frontier
