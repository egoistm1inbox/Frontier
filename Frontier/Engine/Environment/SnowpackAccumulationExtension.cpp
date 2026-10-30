/*==========================================================================================================================================
                                                SNOWPACKACCUMULATIONEXTENSION.CPP
==========================================================================================================================================*/
// 🧩 Single-PolygonSurface snowpack & hail accumulation, vehicle adhesion, Snow Pit rut carving, and thermodynamic melt into puddles.

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             INCLUDES
------------------------------------------------------------------------------------------------------------------------------------------*/
#include "Engine/Environment/SnowpackAccumulationExtension.h"

#include <algorithm>
#include <cmath>

namespace Frontier
{
namespace
{
constexpr float IceLatentHeatFusionJPerKg = 334000.0f; // [J/kg] - Enthalpy of fusion of water ice
constexpr float LiquidWaterDensityKgM3    = 1000.0f;   // [kg/m^3] - Liquid water density for puddle volume conversion
constexpr float FreezingPointKelvin       = 273.15f;   // [K] - Water ice melting temperature
constexpr float PiConstantFloat           = 3.14159265f;

[[nodiscard]] Vec3 ToFloatVec3(SpatialVector V) noexcept
{
    return Vec3{static_cast<float>(V.X), static_cast<float>(V.Y), static_cast<float>(V.Z)};
}
} // namespace

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                    LIFECYCLE & TERRAIN SYNC
------------------------------------------------------------------------------------------------------------------------------------------*/
SnowpackAccumulationExtension::SnowpackAccumulationExtension(const SnowpackDomainSpec& Spec)
{
    Reconfigure(Spec);
}

void SnowpackAccumulationExtension::Reconfigure(const SnowpackDomainSpec& Spec)
{
    Spec_                = Spec;
    Spec_.CellsX         = std::max(4u, Spec.CellsX);
    Spec_.CellsY         = std::max(4u, Spec.CellsY);
    Spec_.CellSizeMetres = std::max(0.05f, Spec.CellSizeMetres);

    const std::size_t Count = static_cast<std::size_t>(Spec_.CellsX) * Spec_.CellsY;
    TerrainElevation_.assign(Count, 0.0f);
    SnowDepthMetres_.assign(Count, 0.0f);
    SnowDensityKgM3_.assign(Count, Spec_.FreshSnowDensityKgM3);
    HailDepthMetres_.assign(Count, 0.0f);
    VehicleSnowMassKg_.assign(static_cast<std::size_t>(VehicleGridLength) * VehicleGridWidth, 0.0f);
    GroundSurface_  = {};
    VehicleSurface_ = {};
    Telemetry_      = {};
    RecentHailPings_.clear();
}

void SnowpackAccumulationExtension::SynchronizeTerrainElevationFromWater(const ShallowWaterMudExtension& WaterDomain)
{
    for (uint32_t J = 0u; J < Spec_.CellsY; ++J)
    {
        const float Wy = Spec_.OriginY + (static_cast<float>(J) + 0.5f) * Spec_.CellSizeMetres;
        for (uint32_t I = 0u; I < Spec_.CellsX; ++I)
        {
            const float Wx = Spec_.OriginX + (static_cast<float>(I) + 0.5f) * Spec_.CellSizeMetres;
            TerrainElevation_[CellIndex(I, J)] = WaterDomain.SampleSurface({Wx, Wy}).BedElevationMetres;
        }
    }
}

void SnowpackAccumulationExtension::SculptSnowPitOrDrift(
    float CentreX,
    float CentreY,
    float RadiusMetres,
    float PeakSnowDepthMetres,
    float InitialDensityKgM3) noexcept
{
    const float InvR = 1.0f / std::max(RadiusMetres, 0.2f);
    const float Rho  = std::clamp(InitialDensityKgM3, Spec_.FreshSnowDensityKgM3, Spec_.PackedSnowDensityKgM3);

    for (uint32_t J = 0u; J < Spec_.CellsY; ++J)
    {
        const float Wy = Spec_.OriginY + (static_cast<float>(J) + 0.5f) * Spec_.CellSizeMetres;
        for (uint32_t I = 0u; I < Spec_.CellsX; ++I)
        {
            const float Wx   = Spec_.OriginX + (static_cast<float>(I) + 0.5f) * Spec_.CellSizeMetres;
            const float Dist = std::sqrt((Wx - CentreX) * (Wx - CentreX) + (Wy - CentreY) * (Wy - CentreY));
            if (Dist < RadiusMetres)
            {
                const float T     = 1.0f - Dist * InvR;
                const float Shape = T * T * (3.0f - 2.0f * T);
                const float AddH  = std::max(0.0f, PeakSnowDepthMetres * Shape);
                const auto  Idx   = CellIndex(I, J);
                const float OldM  = SnowDepthMetres_[Idx] * SnowDensityKgM3_[Idx];
                const float NewM  = OldM + AddH * Rho;
                const float NewH  = SnowDepthMetres_[Idx] + AddH;
                if (NewH > 1.0e-6f)
                {
                    SnowDepthMetres_[Idx] = NewH;
                    SnowDensityKgM3_[Idx] = std::clamp(NewM / NewH, Spec_.FreshSnowDensityKgM3, Spec_.PackedSnowDensityKgM3);
                }
            }
        }
    }
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                        PARTICLE RETIREMENT, ADHESION & STEFAN PHASE CHANGE
------------------------------------------------------------------------------------------------------------------------------------------*/
void SnowpackAccumulationExtension::DepositGroundSnowMass(float WorldX, float WorldY, float MassKg, bool GranularHail) noexcept
{
    if (MassKg <= 0.0f)
    {
        return;
    }
    const float Fx = (WorldX - Spec_.OriginX) / Spec_.CellSizeMetres - 0.5f;
    const float Fy = (WorldY - Spec_.OriginY) / Spec_.CellSizeMetres - 0.5f;
    const int   Ix = static_cast<int>(std::floor(Fx));
    const int   Iy = static_cast<int>(std::floor(Fy));
    if (Ix < 0 || Iy < 0 || Ix >= static_cast<int>(Spec_.CellsX) - 1 || Iy >= static_cast<int>(Spec_.CellsY) - 1)
    {
        return;
    }

    const float Tx   = Fx - static_cast<float>(Ix);
    const float Ty   = Fy - static_cast<float>(Iy);
    const float Area = Spec_.CellSizeMetres * Spec_.CellSizeMetres;

    const float Weights[4] = {(1.0f - Tx) * (1.0f - Ty), Tx * (1.0f - Ty), (1.0f - Tx) * Ty, Tx * Ty};
    const int   OffX[4]    = {0, 1, 0, 1};
    const int   OffY[4]    = {0, 0, 1, 1};

    for (int C = 0; C < 4; ++C)
    {
        const float SubMass = MassKg * Weights[C];
        const auto  Idx     = CellIndex(static_cast<uint32_t>(Ix + OffX[C]), static_cast<uint32_t>(Iy + OffY[C]));
        if (GranularHail)
        {
            HailDepthMetres_[Idx] += SubMass / (Spec_.HailBulkDensityKgM3 * Area);
        }
        else
        {
            const float AddH = SubMass / (Spec_.FreshSnowDensityKgM3 * Area);
            const float OldH = SnowDepthMetres_[Idx];
            const float NewH = OldH + AddH;
            if (NewH > 1.0e-7f)
            {
                const float OldMassPerArea = OldH * SnowDensityKgM3_[Idx];
                SnowDensityKgM3_[Idx] = std::clamp(
                    (OldMassPerArea + SubMass / Area) / NewH,
                    Spec_.FreshSnowDensityKgM3,
                    Spec_.PackedSnowDensityKgM3);
                SnowDepthMetres_[Idx] = NewH;
            }
        }
    }
}

void SnowpackAccumulationExtension::FuseWeatherAndAdvancePhaseChange(
    CloudGatedWeatherSpawner&  WeatherSpawner,
    const VehicleSnowEnvelope& VehicleEnvelope,
    ShallowWaterMudExtension*  OptionalPuddleReceiver,
    float                      DtSeconds,
    float                      AmbientTemperatureKelvin)
{
    Spec_.AmbientTemperatureKelvin = AmbientTemperatureKelvin;
    RecentHailPings_.clear();

    const Vec3                    Fwd      = Normalise(VehicleEnvelope.ForwardAxis);
    const Vec3                    Rgt      = Normalise(VehicleEnvelope.RightAxis);
    const Vec3                    Up       = Normalise(VehicleEnvelope.UpAxis);
    const FallingParticleCategory Category = WeatherSpawner.Configuration().Category;
    const auto&                   Particles = WeatherSpawner.Particles();

    // 1. Scan active snowflakes & hail pellets: retire settled particles immediately into contiguous surfaces!
    if (Category == FallingParticleCategory::SnowFlake || Category == FallingParticleCategory::HailPellet)
    {
        for (std::size_t Slot = 0u; Slot < Particles.size(); ++Slot)
        {
            const WeatherParticleRecord& P = Particles[Slot];
            if (!P.Alive)
            {
                continue;
            }

            const Vec3  WorldP = ToFloatVec3(P.Position);
            const Vec3  Rel    = WorldP - VehicleEnvelope.WorldCentre;
            const float LocX   = Dot(Rel, Fwd);
            const float LocY   = Dot(Rel, Rgt);
            const float LocZ   = Dot(Rel, Up);

            const float HalfL = VehicleEnvelope.HalfExtents.X;
            const float HalfW = VehicleEnvelope.HalfExtents.Y;
            const float HalfH = VehicleEnvelope.HalfExtents.Z;

            const float NormX     = LocX / std::max(HalfL, 0.1f);
            const float NormY     = LocY / std::max(HalfW, 0.1f);
            const float CabinDome = (std::abs(NormX) < 0.48f) ? 1.0f : 0.42f;
            const float ShellTopZ = HalfH * CabinDome * std::max(0.0f, 1.0f - 0.12f * NormY * NormY);

            const bool WithinPlanform    = (std::abs(LocX) <= HalfL && std::abs(LocY) <= HalfW);
            const bool TouchedVehicleTop = WithinPlanform && (LocZ <= ShellTopZ + 0.10f) && (LocZ >= -HalfH * 0.25f);

            if (Category == FallingParticleCategory::SnowFlake)
            {
                if (TouchedVehicleTop)
                {
                    const uint32_t U = std::min(
                        VehicleGridLength - 1u,
                        static_cast<uint32_t>(std::clamp((NormX * 0.5f + 0.5f) * static_cast<float>(VehicleGridLength), 0.0f, 23.99f)));
                    const uint32_t V = std::min(
                        VehicleGridWidth - 1u,
                        static_cast<uint32_t>(std::clamp((NormY * 0.5f + 0.5f) * static_cast<float>(VehicleGridWidth), 0.0f, 11.99f)));
                    VehicleSnowMassKg_[static_cast<std::size_t>(V) * VehicleGridLength + U] += Spec_.FlakeEquivalentMassKg;
                    WeatherSpawner.RetireParticleSlot(Slot);
                    ++Telemetry_.RetiredSnowflakesFused;
                    continue;
                }

                const float GroundElev = SampleGroundSnowThickness(WorldP.X, WorldP.Y);
                const float Fx         = (WorldP.X - Spec_.OriginX) / Spec_.CellSizeMetres;
                const float Fy         = (WorldP.Y - Spec_.OriginY) / Spec_.CellSizeMetres;
                float       BedZ       = 0.0f;
                if (Fx >= 0.0f && Fy >= 0.0f && Fx < static_cast<float>(Spec_.CellsX) && Fy < static_cast<float>(Spec_.CellsY))
                {
                    BedZ = TerrainElevation_[CellIndex(static_cast<uint32_t>(Fx), static_cast<uint32_t>(Fy))];
                }

                // Retire immediately upon ground contact — strictly NO lingering snowflake particles on the ground!
                if (WorldP.Z <= BedZ + GroundElev + 0.09f || P.BounceCounter > 0u)
                {
                    DepositGroundSnowMass(WorldP.X, WorldP.Y, Spec_.FlakeEquivalentMassKg, false);
                    WeatherSpawner.RetireParticleSlot(Slot);
                    ++Telemetry_.RetiredSnowflakesFused;
                }
            }
            else
            {
                if (TouchedVehicleTop && P.Velocity.Z < -1.0)
                {
                    if (RecentHailPings_.size() < 64u)
                    {
                        RecentHailPings_.push_back({WorldP, static_cast<float>(std::abs(P.Velocity.Z)), true});
                    }
                    ++Telemetry_.HailBounceContacts;
                }
                else if (P.BounceCounter > 0u)
                {
                    if (P.BounceCounter == 1u && RecentHailPings_.size() < 64u)
                    {
                        const Vec3 VelF = ToFloatVec3(P.Velocity);
                        RecentHailPings_.push_back({WorldP, Length(VelF), false});
                        ++Telemetry_.HailBounceContacts;
                    }
                    // After 2+ bounces, hail settles into the granular hail-ice PolygonSurface!
                    if (P.BounceCounter >= 2u && std::abs(P.Velocity.Z) < 2.6)
                    {
                        DepositGroundSnowMass(WorldP.X, WorldP.Y, Spec_.HailPelletMassKg, true);
                        WeatherSpawner.RetireParticleSlot(Slot);
                        ++Telemetry_.RetiredHailPelletsFused;
                    }
                }
            }
        }
    }

    // 2. Aerodynamic wind-shear & G-force sloughing of snow off the moving vehicle onto the ground behind it!
    const float WindShearExcess = std::max(0.0f, VehicleEnvelope.ForwardSpeedMps - 18.0f);
    const float AccelExcess     = std::max(0.0f, VehicleEnvelope.ChassisAccelMps2 - 6.5f);
    const float ShedRatePerSec  = 0.045f * WindShearExcess + 0.030f * AccelExcess;
    if (ShedRatePerSec > 0.0f && DtSeconds > 0.0f)
    {
        const float RetainFactor = std::exp(-ShedRatePerSec * DtSeconds);
        const Vec3  WakeDropPos  = VehicleEnvelope.WorldCentre - Fwd * (VehicleEnvelope.HalfExtents.X + 0.6f);
        float       ShedMassSum  = 0.0f;
        for (float& PatchMass : VehicleSnowMassKg_)
        {
            const float Shed = PatchMass * (1.0f - RetainFactor);
            PatchMass -= Shed;
            ShedMassSum += Shed;
        }
        if (ShedMassSum > 1.0e-6f)
        {
            DepositGroundSnowMass(WakeDropPos.X, WakeDropPos.Y, ShedMassSum, false);
        }
    }

    // 3. Stefan convective phase-change melt when AmbientTemperatureKelvin > 273.15 K -> feeds 2.5D puddles!
    const float DeltaTKelvin = AmbientTemperatureKelvin - FreezingPointKelvin;
    if (DeltaTKelvin > 0.0f && DtSeconds > 0.0f)
    {
        const float MeltMassPerAreaKgM2 = (Spec_.ConvectiveHeatCoeffWm2K * DeltaTKelvin * DtSeconds) / IceLatentHeatFusionJPerKg;
        const float CellAreaM2          = Spec_.CellSizeMetres * Spec_.CellSizeMetres;

        for (float& PatchMass : VehicleSnowMassKg_)
        {
            const float PatchArea = (4.0f * VehicleEnvelope.HalfExtents.X * VehicleEnvelope.HalfExtents.Y) /
                                    static_cast<float>(VehicleGridLength * VehicleGridWidth);
            const float Melted = std::min(PatchMass, 1.6f * MeltMassPerAreaKgM2 * PatchArea);
            PatchMass -= Melted;
            Telemetry_.CumulativeMeltedWaterKg += Melted;
            if (OptionalPuddleReceiver != nullptr && Melted > 1.0e-7f)
            {
                const float DropRadius = 0.85f;
                const float DiscArea   = 0.5f * PiConstantFloat * DropRadius * DropRadius;
                OptionalPuddleReceiver->InjectLocalLiquidOrMeltVolume(
                    {VehicleEnvelope.WorldCentre.X, VehicleEnvelope.WorldCentre.Y},
                    DropRadius,
                    (Melted / LiquidWaterDensityKgM3) / DiscArea);
            }
        }

        const float CellDropRadius = Spec_.CellSizeMetres * 0.90f;
        const float CellDiscArea   = 0.5f * PiConstantFloat * CellDropRadius * CellDropRadius;

        for (uint32_t J = 0u; J < Spec_.CellsY; ++J)
        {
            const float Wy = Spec_.OriginY + (static_cast<float>(J) + 0.5f) * Spec_.CellSizeMetres;
            for (uint32_t I = 0u; I < Spec_.CellsX; ++I)
            {
                const auto Idx        = CellIndex(I, J);
                float      BudgetKgM2 = MeltMassPerAreaKgM2;
                float      MeltedM2   = 0.0f;

                if (HailDepthMetres_[Idx] > 0.0f)
                {
                    const float HailMassM2 = HailDepthMetres_[Idx] * Spec_.HailBulkDensityKgM3;
                    const float TakeM2     = std::min(HailMassM2, BudgetKgM2);
                    HailDepthMetres_[Idx]  = std::max(0.0f, (HailMassM2 - TakeM2) / Spec_.HailBulkDensityKgM3);
                    BudgetKgM2 -= TakeM2;
                    MeltedM2   += TakeM2;
                }
                if (BudgetKgM2 > 0.0f && SnowDepthMetres_[Idx] > 0.0f)
                {
                    const float SnowMassM2 = SnowDepthMetres_[Idx] * SnowDensityKgM3_[Idx];
                    const float TakeM2     = std::min(SnowMassM2, BudgetKgM2);
                    SnowDepthMetres_[Idx]  = std::max(0.0f, (SnowMassM2 - TakeM2) / SnowDensityKgM3_[Idx]);
                    MeltedM2 += TakeM2;
                }

                if (MeltedM2 > 1.0e-7f)
                {
                    const float MeltedKg = MeltedM2 * CellAreaM2;
                    Telemetry_.CumulativeMeltedWaterKg += MeltedKg;
                    if (OptionalPuddleReceiver != nullptr)
                    {
                        const float Wx = Spec_.OriginX + (static_cast<float>(I) + 0.5f) * Spec_.CellSizeMetres;
                        OptionalPuddleReceiver->InjectLocalLiquidOrMeltVolume(
                            {Wx, Wy},
                            CellDropRadius,
                            (MeltedKg / LiquidWaterDensityKgM3) / CellDiscArea);
                    }
                }
            }
        }
    }

    double       GroundMass = 0.0;
    const double Area       = static_cast<double>(Spec_.CellSizeMetres) * Spec_.CellSizeMetres;
    for (std::size_t K = 0u; K < SnowDepthMetres_.size(); ++K)
    {
        GroundMass += (static_cast<double>(SnowDepthMetres_[K]) * SnowDensityKgM3_[K] +
                       static_cast<double>(HailDepthMetres_[K]) * Spec_.HailBulkDensityKgM3) *
                      Area;
    }
    double VehMass = 0.0;
    for (float M : VehicleSnowMassKg_)
    {
        VehMass += M;
    }
    Telemetry_.GroundSolidMassKg    = GroundMass;
    Telemetry_.VehicleAdheredMassKg = VehMass;
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                        WONG-BEKKER SNOW COMPACTION, RUT CARVING & BERMS
------------------------------------------------------------------------------------------------------------------------------------------*/
SnowWheelRutResponse SnowpackAccumulationExtension::CarveWheelRutAndEvaluateResistance(const SnowWheelRutInput& Wheel) noexcept
{
    SnowWheelRutResponse Out{};
    const float Wx     = Wheel.WheelContactWorld.X;
    const float Wy     = Wheel.WheelContactWorld.Y;
    const float SnowH  = SampleGroundSnowThickness(Wx, Wy);
    const float HailH  = SampleGroundHailThickness(Wx, Wy);
    const float TotalH = SnowH + HailH;
    Out.UncompactedDepthMetres = TotalH;

    if (TotalH <= 1.0e-4f)
    {
        return Out;
    }

    const float ContactLen  = std::max(0.14f, 0.52f * Wheel.TyreRadiusMetres);
    const float ContactArea = std::max(0.02f, Wheel.TyreWidthMetres * ContactLen);
    const float PressurePa  = std::max(0.0f, Wheel.NormalLoadNewtons) / ContactArea;

    const float RhoBefore = SampleGroundSnowDensity(Wx, Wy);
    const float TargetRho = std::clamp(
        RhoBefore + (Spec_.PackedSnowDensityKgM3 - RhoBefore) * (1.0f - std::exp(-PressurePa / 95000.0f)),
        RhoBefore,
        Spec_.PackedSnowDensityKgM3);

    Vec3 Fwd = Wheel.WheelForwardWorld;
    Fwd.Z    = 0.0f;
    Fwd      = (Length(Fwd) > 1.0e-5f) ? Normalise(Fwd) : Vec3{1.0f, 0.0f, 0.0f};
    const Vec3 Lat{-Fwd.Y, Fwd.X, 0.0f};

    const float HalfRutWidth = std::max(0.55f * Wheel.TyreWidthMetres, 0.55f * Spec_.CellSizeMetres);
    const int   Span         = std::max(2, static_cast<int>(std::ceil((HalfRutWidth * 2.4f) / Spec_.CellSizeMetres)));
    const int   Ci           = static_cast<int>(std::floor((Wx - Spec_.OriginX) / Spec_.CellSizeMetres));
    const int   Cj           = static_cast<int>(std::floor((Wy - Spec_.OriginY) / Spec_.CellSizeMetres));

    float       MaxSinkage             = 0.0f;
    float       DisplacedLateralMassKg = 0.0f;
    const float CellArea               = Spec_.CellSizeMetres * Spec_.CellSizeMetres;

    for (int Dj = -Span; Dj <= Span; ++Dj)
    {
        for (int Di = -Span; Di <= Span; ++Di)
        {
            const int I = Ci + Di;
            const int J = Cj + Dj;
            if (I < 0 || J < 0 || I >= static_cast<int>(Spec_.CellsX) || J >= static_cast<int>(Spec_.CellsY))
            {
                continue;
            }
            const float Cx        = Spec_.OriginX + (static_cast<float>(I) + 0.5f) * Spec_.CellSizeMetres;
            const float Cy        = Spec_.OriginY + (static_cast<float>(J) + 0.5f) * Spec_.CellSizeMetres;
            const Vec3  Delta{Cx - Wx, Cy - Wy, 0.0f};
            const float AlongDist = std::abs(Dot(Delta, Fwd));
            const float CrossDist = std::abs(Dot(Delta, Lat));

            if (AlongDist <= ContactLen * 1.15f + 0.5f * Spec_.CellSizeMetres && CrossDist <= HalfRutWidth)
            {
                const auto  Idx  = CellIndex(static_cast<uint32_t>(I), static_cast<uint32_t>(J));
                const float OldH = SnowDepthMetres_[Idx];
                if (OldH > 1.0e-4f)
                {
                    const float OldMassPerArea  = OldH * SnowDensityKgM3_[Idx];
                    const float LateralFraction = std::clamp(0.32f * (OldH / (OldH + 0.12f)), 0.05f, 0.35f);
                    const float RetainedMassM2  = OldMassPerArea * (1.0f - LateralFraction);
                    const float NewRho          = std::max(SnowDensityKgM3_[Idx], TargetRho);
                    const float NewH            = RetainedMassM2 / NewRho;

                    MaxSinkage = std::max(MaxSinkage, OldH - NewH);
                    DisplacedLateralMassKg += (OldMassPerArea * LateralFraction) * CellArea;
                    SnowDepthMetres_[Idx] = NewH;
                    SnowDensityKgM3_[Idx] = NewRho;
                }
            }
        }
    }

    if (DisplacedLateralMassKg > 1.0e-6f)
    {
        const float BermOffset = HalfRutWidth + 0.65f * Spec_.CellSizeMetres;
        DepositGroundSnowMass(Wx + Lat.X * BermOffset, Wy + Lat.Y * BermOffset, 0.5f * DisplacedLateralMassKg, false);
        DepositGroundSnowMass(Wx - Lat.X * BermOffset, Wy - Lat.Y * BermOffset, 0.5f * DisplacedLateralMassKg, false);
        Out.DisplacedBermHeightMetres = (0.5f * DisplacedLateralMassKg) / (Spec_.FreshSnowDensityKgM3 * 1.35f * CellArea);
    }

    const float Sinkage         = std::max(MaxSinkage, 0.25f * SnowH);
    const float BekkerModulus   = 42000.0f + 160.0f * RhoBefore;
    const float CompactionDrag  = Wheel.TyreWidthMetres * BekkerModulus * std::pow(Sinkage, 1.85f) / 1.85f;
    const float InertiaPlowDrag = 0.5f * RhoBefore * Wheel.TyreWidthMetres * Sinkage *
                                  Wheel.WheelForwardSpeed * Wheel.WheelForwardSpeed;

    Out.CarvedSinkageMetres   = Sinkage;
    Out.CompactionResistanceN = CompactionDrag + InertiaPlowDrag;

    const float HailFrac  = HailH / std::max(TotalH, 1.0e-5f);
    const float PackRatio = std::clamp(
        (TargetRho - Spec_.FreshSnowDensityKgM3) / std::max(1.0f, Spec_.PackedSnowDensityKgM3 - Spec_.FreshSnowDensityKgM3),
        0.0f,
        1.0f);
    const float SnowMuScale    = 0.44f - 0.08f * PackRatio;
    Out.EffectiveSnowGripScale = (1.0f - HailFrac) * SnowMuScale + HailFrac * 0.28f;
    return Out;
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                        SINGLE CONTIGUOUS POLYGON SURFACE SYNTHESIS
------------------------------------------------------------------------------------------------------------------------------------------*/
void SnowpackAccumulationExtension::RebuildContiguousPolygonSurfaces(const VehicleSnowEnvelope& VehicleEnvelope)
{
    GroundSurface_.Vertices.clear();
    GroundSurface_.Indices.clear();
    GroundSurface_.ActiveQuadCount  = 0u;
    GroundSurface_.PeakThicknessM   = 0.0f;
    GroundSurface_.TotalSolidMassKg = Telemetry_.GroundSolidMassKg;

    const uint32_t       VxCount = Spec_.CellsX;
    const uint32_t       VyCount = Spec_.CellsY;
    std::vector<int32_t> VertexRemap(static_cast<std::size_t>(VxCount) * VyCount, -1);

    auto TotalCellThickness = [&](uint32_t I, uint32_t J) noexcept -> float
    {
        const auto Idx = CellIndex(I, J);
        return SnowDepthMetres_[Idx] + HailDepthMetres_[Idx];
    };

    auto EnsureGroundVertex = [&](uint32_t I, uint32_t J) -> uint32_t
    {
        const std::size_t Key = static_cast<std::size_t>(J) * VxCount + I;
        if (VertexRemap[Key] >= 0)
        {
            return static_cast<uint32_t>(VertexRemap[Key]);
        }

        const auto  Idx   = CellIndex(I, J);
        const float SnowH = SnowDepthMetres_[Idx];
        const float HailH = HailDepthMetres_[Idx];
        const float Thick = SnowH + HailH;
        const float Wx    = Spec_.OriginX + (static_cast<float>(I) + 0.5f) * Spec_.CellSizeMetres;
        const float Wy    = Spec_.OriginY + (static_cast<float>(J) + 0.5f) * Spec_.CellSizeMetres;
        const float TopZ  = TerrainElevation_[Idx] + Thick;

        const uint32_t Il = (I > 0u) ? (I - 1u) : I;
        const uint32_t Ir = (I + 1u < VxCount) ? (I + 1u) : I;
        const uint32_t Jd = (J > 0u) ? (J - 1u) : J;
        const uint32_t Ju = (J + 1u < VyCount) ? (J + 1u) : J;

        const float Zl    = TerrainElevation_[CellIndex(Il, J)] + TotalCellThickness(Il, J);
        const float Zr    = TerrainElevation_[CellIndex(Ir, J)] + TotalCellThickness(Ir, J);
        const float Zd    = TerrainElevation_[CellIndex(I, Jd)] + TotalCellThickness(I, Jd);
        const float Zu    = TerrainElevation_[CellIndex(I, Ju)] + TotalCellThickness(I, Ju);
        const float SpanX = static_cast<float>(std::max(1u, Ir - Il)) * Spec_.CellSizeMetres;
        const float SpanY = static_cast<float>(std::max(1u, Ju - Jd)) * Spec_.CellSizeMetres;

        SnowpackPolygonVertex V{};
        V.Position        = Vec3{Wx, Wy, TopZ};
        V.Normal          = Normalise(Vec3{-(Zr - Zl) / SpanX, -(Zu - Zd) / SpanY, 1.0f});
        V.SnowThicknessM  = Thick;
        V.HailIceFraction = (Thick > 1.0e-5f) ? std::clamp(HailH / Thick, 0.0f, 1.0f) : 0.0f;
        V.CompactionRatio = std::clamp(
            (SnowDensityKgM3_[Idx] - Spec_.FreshSnowDensityKgM3) /
                std::max(1.0f, Spec_.PackedSnowDensityKgM3 - Spec_.FreshSnowDensityKgM3),
            0.0f,
            1.0f);

        GroundSurface_.PeakThicknessM = std::max(GroundSurface_.PeakThicknessM, Thick);
        const uint32_t OutIdx         = static_cast<uint32_t>(GroundSurface_.Vertices.size());
        GroundSurface_.Vertices.push_back(V);
        VertexRemap[Key] = static_cast<int32_t>(OutIdx);
        return OutIdx;
    };

    for (uint32_t J = 0u; J + 1u < VyCount; ++J)
    {
        for (uint32_t I = 0u; I + 1u < VxCount; ++I)
        {
            const float MaxQuadThick = std::max(
                {TotalCellThickness(I, J),
                 TotalCellThickness(I + 1u, J),
                 TotalCellThickness(I, J + 1u),
                 TotalCellThickness(I + 1u, J + 1u)});
            if (MaxQuadThick >= Spec_.SurfaceInclusionThreshold)
            {
                const uint32_t V00 = EnsureGroundVertex(I, J);
                const uint32_t V10 = EnsureGroundVertex(I + 1u, J);
                const uint32_t V01 = EnsureGroundVertex(I, J + 1u);
                const uint32_t V11 = EnsureGroundVertex(I + 1u, J + 1u);

                GroundSurface_.Indices.push_back(V00);
                GroundSurface_.Indices.push_back(V10);
                GroundSurface_.Indices.push_back(V11);
                GroundSurface_.Indices.push_back(V00);
                GroundSurface_.Indices.push_back(V11);
                GroundSurface_.Indices.push_back(V01);
                ++GroundSurface_.ActiveQuadCount;
            }
        }
    }

    VehicleSurface_.Vertices.clear();
    VehicleSurface_.Indices.clear();
    VehicleSurface_.ActiveQuadCount  = 0u;
    VehicleSurface_.PeakThicknessM   = 0.0f;
    VehicleSurface_.TotalSolidMassKg = Telemetry_.VehicleAdheredMassKg;

    const Vec3  Fwd       = Normalise(VehicleEnvelope.ForwardAxis);
    const Vec3  Rgt       = Normalise(VehicleEnvelope.RightAxis);
    const Vec3  Up        = Normalise(VehicleEnvelope.UpAxis);
    const float PatchArea = std::max(
        1.0e-3f,
        (4.0f * VehicleEnvelope.HalfExtents.X * VehicleEnvelope.HalfExtents.Y) /
            static_cast<float>(VehicleGridLength * VehicleGridWidth));

    std::vector<int32_t> VehRemap(static_cast<std::size_t>(VehicleGridLength) * VehicleGridWidth, -1);
    auto PatchThick = [&](uint32_t U, uint32_t V) noexcept -> float
    {
        return VehicleSnowMassKg_[static_cast<std::size_t>(V) * VehicleGridLength + U] /
               (Spec_.FreshSnowDensityKgM3 * PatchArea);
    };

    auto EnsureVehicleVertex = [&](uint32_t U, uint32_t V) -> uint32_t
    {
        const std::size_t Key = static_cast<std::size_t>(V) * VehicleGridLength + U;
        if (VehRemap[Key] >= 0)
        {
            return static_cast<uint32_t>(VehRemap[Key]);
        }

        const float NormX = (static_cast<float>(U) + 0.5f) / static_cast<float>(VehicleGridLength) * 2.0f - 1.0f;
        const float NormY = (static_cast<float>(V) + 0.5f) / static_cast<float>(VehicleGridWidth) * 2.0f - 1.0f;
        const float Cabin = (std::abs(NormX) < 0.48f) ? 1.0f : 0.42f;
        const float BaseZ = VehicleEnvelope.HalfExtents.Z * Cabin * std::max(0.0f, 1.0f - 0.12f * NormY * NormY);
        const float Thick = PatchThick(U, V);

        const Vec3 WorldPos = VehicleEnvelope.WorldCentre +
                              Fwd * (NormX * VehicleEnvelope.HalfExtents.X) +
                              Rgt * (NormY * VehicleEnvelope.HalfExtents.Y) +
                              Up * (BaseZ + Thick);

        SnowpackPolygonVertex Vert{};
        Vert.Position                 = WorldPos;
        Vert.Normal                   = Up;
        Vert.SnowThicknessM           = Thick;
        VehicleSurface_.PeakThicknessM = std::max(VehicleSurface_.PeakThicknessM, Thick);

        const uint32_t OutIdx = static_cast<uint32_t>(VehicleSurface_.Vertices.size());
        VehicleSurface_.Vertices.push_back(Vert);
        VehRemap[Key] = static_cast<int32_t>(OutIdx);
        return OutIdx;
    };

    for (uint32_t V = 0u; V + 1u < VehicleGridWidth; ++V)
    {
        for (uint32_t U = 0u; U + 1u < VehicleGridLength; ++U)
        {
            const float MaxT = std::max(
                {PatchThick(U, V), PatchThick(U + 1u, V), PatchThick(U, V + 1u), PatchThick(U + 1u, V + 1u)});
            if (MaxT >= Spec_.SurfaceInclusionThreshold)
            {
                const uint32_t A = EnsureVehicleVertex(U, V);
                const uint32_t B = EnsureVehicleVertex(U + 1u, V);
                const uint32_t C = EnsureVehicleVertex(U, V + 1u);
                const uint32_t D = EnsureVehicleVertex(U + 1u, V + 1u);

                VehicleSurface_.Indices.push_back(A);
                VehicleSurface_.Indices.push_back(B);
                VehicleSurface_.Indices.push_back(D);
                VehicleSurface_.Indices.push_back(A);
                VehicleSurface_.Indices.push_back(D);
                VehicleSurface_.Indices.push_back(C);
                ++VehicleSurface_.ActiveQuadCount;
            }
        }
    }
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             SAMPLERS
------------------------------------------------------------------------------------------------------------------------------------------*/
float SnowpackAccumulationExtension::SampleGroundSnowThickness(float WorldX, float WorldY) const noexcept
{
    const float Fx = (WorldX - Spec_.OriginX) / Spec_.CellSizeMetres - 0.5f;
    const float Fy = (WorldY - Spec_.OriginY) / Spec_.CellSizeMetres - 0.5f;
    if (Fx < 0.0f || Fy < 0.0f || Fx >= static_cast<float>(Spec_.CellsX - 1u) || Fy >= static_cast<float>(Spec_.CellsY - 1u))
    {
        return 0.0f;
    }
    const uint32_t I0 = static_cast<uint32_t>(Fx);
    const uint32_t J0 = static_cast<uint32_t>(Fy);
    const float    Tx = Fx - static_cast<float>(I0);
    const float    Ty = Fy - static_cast<float>(J0);
    const float    A  = SnowDepthMetres_[CellIndex(I0, J0)] * (1.0f - Tx) + SnowDepthMetres_[CellIndex(I0 + 1u, J0)] * Tx;
    const float    B  = SnowDepthMetres_[CellIndex(I0, J0 + 1u)] * (1.0f - Tx) + SnowDepthMetres_[CellIndex(I0 + 1u, J0 + 1u)] * Tx;
    return A * (1.0f - Ty) + B * Ty;
}

float SnowpackAccumulationExtension::SampleGroundHailThickness(float WorldX, float WorldY) const noexcept
{
    const float Fx = (WorldX - Spec_.OriginX) / Spec_.CellSizeMetres - 0.5f;
    const float Fy = (WorldY - Spec_.OriginY) / Spec_.CellSizeMetres - 0.5f;
    if (Fx < 0.0f || Fy < 0.0f || Fx >= static_cast<float>(Spec_.CellsX - 1u) || Fy >= static_cast<float>(Spec_.CellsY - 1u))
    {
        return 0.0f;
    }
    const uint32_t I0 = static_cast<uint32_t>(Fx);
    const uint32_t J0 = static_cast<uint32_t>(Fy);
    const float    Tx = Fx - static_cast<float>(I0);
    const float    Ty = Fy - static_cast<float>(J0);
    const float    A  = HailDepthMetres_[CellIndex(I0, J0)] * (1.0f - Tx) + HailDepthMetres_[CellIndex(I0 + 1u, J0)] * Tx;
    const float    B  = HailDepthMetres_[CellIndex(I0, J0 + 1u)] * (1.0f - Tx) + HailDepthMetres_[CellIndex(I0 + 1u, J0 + 1u)] * Tx;
    return A * (1.0f - Ty) + B * Ty;
}

float SnowpackAccumulationExtension::SampleGroundSnowDensity(float WorldX, float WorldY) const noexcept
{
    const float Fx = std::clamp((WorldX - Spec_.OriginX) / Spec_.CellSizeMetres, 0.0f, static_cast<float>(Spec_.CellsX - 1u));
    const float Fy = std::clamp((WorldY - Spec_.OriginY) / Spec_.CellSizeMetres, 0.0f, static_cast<float>(Spec_.CellsY - 1u));
    return SnowDensityKgM3_[CellIndex(static_cast<uint32_t>(Fx), static_cast<uint32_t>(Fy))];
}

} // namespace Frontier
