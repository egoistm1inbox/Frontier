/*==========================================================================================================================================
                                                SNOWPACKACCUMULATIONEXTENSION.CPP
==========================================================================================================================================*/
// 🧩 Single-PolygonSurface snowpack & hail accumulation, vehicle adhesion, Snow Pit rut carving, and thermodynamic melt into puddles.

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             INCLUDES
------------------------------------------------------------------------------------------------------------------------------------------*/
#include "Engine/VisualEffects/SnowSurface.h"

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
SnowSurface::SnowSurface(const SnowpackDomainSpec& Spec)
{
    Reconfigure(Spec);
}

void SnowSurface::Reconfigure(const SnowpackDomainSpec& Spec)
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

void SnowSurface::SynchronizeTerrainElevationFromWater(const ShallowWaterSimulation& WaterDomain)
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

void SnowSurface::SculptSnowPitOrDrift(
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
void SnowSurface::DepositGroundSnowMass(float WorldX, float WorldY, float MassKg, bool GranularHail) noexcept
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

void SnowSurface::FuseWeatherAndAdvancePhaseChange(
    CloudGatedWeatherSpawner&  WeatherSpawner,
    const VehicleSnowEnvelope& VehicleEnvelope,
    ShallowWaterSimulation*  OptionalPuddleReceiver,
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
SnowWheelRutResponse SnowSurface::CarveWheelRutAndEvaluateResistance(const SnowWheelRutInput& Wheel) noexcept
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
    const int   Span         = std::max(3, static_cast<int>(std::ceil((HalfRutWidth * 3.0f) / Spec_.CellSizeMetres)));
    const int   Ci           = static_cast<int>(std::floor((Wx - Spec_.OriginX) / Spec_.CellSizeMetres));
    const int   Cj           = static_cast<int>(std::floor((Wy - Spec_.OriginY) / Spec_.CellSizeMetres));

    float       MaxSinkage             = 0.0f;
    float       DisplacedLateralMassKg = 0.0f;
    const float CellArea               = Spec_.CellSizeMetres * Spec_.CellSizeMetres;

    struct BermCandidate
    {
        size_t Idx    = 0u;
        float  Weight = 0.0f;
    };
    std::vector<BermCandidate> BermCells;
    float                      BermWeightSum = 0.0f;

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
            const float HalfAlong = ContactLen * 1.15f + 0.55f * Spec_.CellSizeMetres;

            if (AlongDist <= HalfAlong && CrossDist <= HalfRutWidth * 1.40f)
            {
                const auto  Idx  = CellIndex(static_cast<uint32_t>(I), static_cast<uint32_t>(J));
                const float OldH = SnowDepthMetres_[Idx];
                // Full flat tyre tread inside 0.95 * HalfRutWidth + smooth raised-cosine sidewall shoulder taper!
                const float ShoulderT  = std::clamp((CrossDist - 0.95f * HalfRutWidth) / (0.45f * HalfRutWidth), 0.0f, 1.0f);
                const float ShoulderW  = 0.5f * (1.0f + std::cos(3.14159265f * ShoulderT));
                const float DesiredRho = Spec_.FreshSnowDensityKgM3 + (TargetRho - Spec_.FreshSnowDensityKgM3) * ShoulderW;

                if (OldH > 1.0e-4f && DesiredRho > SnowDensityKgM3_[Idx] + 1.0f)
                {
                    const float FreshnessFrac   = std::clamp((DesiredRho - SnowDensityKgM3_[Idx]) / std::max(10.0f, TargetRho - Spec_.FreshSnowDensityKgM3), 0.0f, 1.0f);
                    const float OldMassPerArea  = OldH * SnowDensityKgM3_[Idx];
                    const float LateralFraction = std::clamp(0.32f * (OldH / (OldH + 0.12f)), 0.05f, 0.35f) * ShoulderW * FreshnessFrac;
                    const float RetainedMassM2  = OldMassPerArea * (1.0f - LateralFraction);
                    const float NewRho          = std::max(SnowDensityKgM3_[Idx], DesiredRho);
                    const float NewH            = RetainedMassM2 / NewRho;

                    MaxSinkage = std::max(MaxSinkage, OldH - NewH);
                    DisplacedLateralMassKg += (OldMassPerArea * LateralFraction) * CellArea;
                    SnowDepthMetres_[Idx] = NewH;
                    SnowDensityKgM3_[Idx] = NewRho;
                }
            }
            else if (AlongDist <= HalfAlong && CrossDist > HalfRutWidth * 1.05f && CrossDist <= HalfRutWidth * 2.65f)
            {
                const float BermCenter = HalfRutWidth * 1.75f;
                const float BermSigma  = HalfRutWidth * 0.48f;
                const float ZDiff      = (CrossDist - BermCenter) / std::max(0.02f, BermSigma);
                const float W          = std::exp(-0.5f * ZDiff * ZDiff);
                if (W > 0.04f)
                {
                    BermCells.push_back({CellIndex(static_cast<uint32_t>(I), static_cast<uint32_t>(J)), W});
                    BermWeightSum += W;
                }
            }
        }
    }

    if (DisplacedLateralMassKg > 1.0e-6f)
    {
        if (!BermCells.empty() && BermWeightSum > 1.0e-5f)
        {
            const float BermRho = Spec_.FreshSnowDensityKgM3 * 1.30f;
            float       PeakAdd = 0.0f;
            for (const auto& Bc : BermCells)
            {
                const float CellMassAdd = DisplacedLateralMassKg * (Bc.Weight / BermWeightSum);
                const float OldM        = SnowDepthMetres_[Bc.Idx] * SnowDensityKgM3_[Bc.Idx] * CellArea;
                const float NewM        = OldM + CellMassAdd;
                const float NewRho      = (SnowDepthMetres_[Bc.Idx] > 1.0e-4f)
                                              ? ((OldM * SnowDensityKgM3_[Bc.Idx] + CellMassAdd * BermRho) / NewM)
                                              : BermRho;
                const float AddedH      = (NewM / (NewRho * CellArea)) - SnowDepthMetres_[Bc.Idx];
                SnowDepthMetres_[Bc.Idx] += AddedH;
                SnowDensityKgM3_[Bc.Idx] = NewRho;
                PeakAdd                  = std::max(PeakAdd, AddedH);
            }
            Out.DisplacedBermHeightMetres = PeakAdd;
        }
        else
        {
            const float BermOffset = HalfRutWidth + 0.65f * Spec_.CellSizeMetres;
            DepositGroundSnowMass(Wx + Lat.X * BermOffset, Wy + Lat.Y * BermOffset, 0.5f * DisplacedLateralMassKg, false);
            DepositGroundSnowMass(Wx - Lat.X * BermOffset, Wy - Lat.Y * BermOffset, 0.5f * DisplacedLateralMassKg, false);
            Out.DisplacedBermHeightMetres = (0.5f * DisplacedLateralMassKg) / (Spec_.FreshSnowDensityKgM3 * 1.35f * CellArea);
        }
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
                         COUPLED FALLING-SNOW TOUCHDOWN, ANGLE-OF-REPOSE SLUMPING & SINGLE-MESH TOPOLOGY
------------------------------------------------------------------------------------------------------------------------------------------*/
void SnowSurface::DepositSnowflakeTouchdown(
    Vec3  HitWorld,
    Vec3  ImpactVelocityMps,
    float SnowPacketMassKg,
    float DriftSpreadRadiusMetres) noexcept
{
    if (SnowPacketMassKg <= 0.0f)
    {
        return;
    }

    // Wind saltation bounce-drift on touchdown: horizontal wind carries fresh dendritic crystals slightly downwind!
    const float DriftX = ImpactVelocityMps.X * 0.045f;
    const float DriftY = ImpactVelocityMps.Y * 0.045f;
    const float Cx     = HitWorld.X + DriftX;
    const float Cy     = HitWorld.Y + DriftY;
    const float Sigma  = std::max(1.35f * Spec_.CellSizeMetres, DriftSpreadRadiusMetres);
    const float RMax   = 2.65f * Sigma;

    const int MinI = std::max(0, static_cast<int>(std::floor((Cx - RMax - Spec_.OriginX) / Spec_.CellSizeMetres)));
    const int MaxI = std::min(static_cast<int>(Spec_.CellsX) - 1, static_cast<int>(std::ceil((Cx + RMax - Spec_.OriginX) / Spec_.CellSizeMetres)));
    const int MinJ = std::max(0, static_cast<int>(std::floor((Cy - RMax - Spec_.OriginY) / Spec_.CellSizeMetres)));
    const int MaxJ = std::min(static_cast<int>(Spec_.CellsY) - 1, static_cast<int>(std::ceil((Cy + RMax - Spec_.OriginY) / Spec_.CellSizeMetres)));
    if (MinI > MaxI || MinJ > MaxJ)
    {
        return;
    }

    const float CellArea = Spec_.CellSizeMetres * Spec_.CellSizeMetres;
    const float Inv2Sig2 = 0.5f / (Sigma * Sigma);

    struct KernelTap
    {
        std::size_t Idx;
        float       Weight;
    };
    std::vector<KernelTap> Taps;
    Taps.reserve(static_cast<std::size_t>((MaxI - MinI + 1) * (MaxJ - MinJ + 1)));
    float WeightSum = 0.0f;

    for (int J = MinJ; J <= MaxJ; ++J)
    {
        const float Wy = Spec_.OriginY + (static_cast<float>(J) + 0.5f) * Spec_.CellSizeMetres;
        const float Dy = Wy - Cy;
        for (int I = MinI; I <= MaxI; ++I)
        {
            const float Wx = Spec_.OriginX + (static_cast<float>(I) + 0.5f) * Spec_.CellSizeMetres;
            const float Dx = Wx - Cx;
            const float D2 = Dx * Dx + Dy * Dy;
            if (D2 <= RMax * RMax)
            {
                const float W = std::exp(-D2 * Inv2Sig2);
                Taps.push_back({CellIndex(static_cast<uint32_t>(I), static_cast<uint32_t>(J)), W});
                WeightSum += W;
            }
        }
    }

    if (WeightSum <= 1.0e-7f)
    {
        return;
    }

    const float FreshRho = Spec_.FreshSnowDensityKgM3;
    for (const KernelTap& Tap : Taps)
    {
        const float AddMass = SnowPacketMassKg * (Tap.Weight / WeightSum);
        const float OldMass = SnowDepthMetres_[Tap.Idx] * SnowDensityKgM3_[Tap.Idx] * CellArea;
        const float NewMass = OldMass + AddMass;
        const float NewRho  = (OldMass > 1.0e-6f)
                                  ? ((OldMass * SnowDensityKgM3_[Tap.Idx] + AddMass * FreshRho) / NewMass)
                                  : FreshRho;
        SnowDepthMetres_[Tap.Idx]   = NewMass / (NewRho * CellArea);
        SnowDensityKgM3_[Tap.Idx]   = NewRho;
    }

    Telemetry_.GroundSolidMassKg += static_cast<double>(SnowPacketMassKg);
    ++Telemetry_.RetiredSnowflakesFused;
}

void SnowSurface::DepositHailstoneTouchdown(
    Vec3  HitWorld,
    float HailPacketMassKg,
    float SpreadRadiusMetres) noexcept
{
    if (HailPacketMassKg <= 0.0f)
    {
        return;
    }

    const float Sigma = std::max(1.15f * Spec_.CellSizeMetres, SpreadRadiusMetres);
    const float RMax  = 2.4f * Sigma;
    const int   MinI  = std::max(0, static_cast<int>(std::floor((HitWorld.X - RMax - Spec_.OriginX) / Spec_.CellSizeMetres)));
    const int   MaxI  = std::min(static_cast<int>(Spec_.CellsX) - 1, static_cast<int>(std::ceil((HitWorld.X + RMax - Spec_.OriginX) / Spec_.CellSizeMetres)));
    const int   MinJ  = std::max(0, static_cast<int>(std::floor((HitWorld.Y - RMax - Spec_.OriginY) / Spec_.CellSizeMetres)));
    const int   MaxJ  = std::min(static_cast<int>(Spec_.CellsY) - 1, static_cast<int>(std::ceil((HitWorld.Y + RMax - Spec_.OriginY) / Spec_.CellSizeMetres)));
    if (MinI > MaxI || MinJ > MaxJ)
    {
        return;
    }

    const float CellArea = Spec_.CellSizeMetres * Spec_.CellSizeMetres;
    const float Inv2Sig2 = 0.5f / (Sigma * Sigma);
    float       WSum     = 0.0f;
    for (int J = MinJ; J <= MaxJ; ++J)
    {
        const float Dy = (Spec_.OriginY + (static_cast<float>(J) + 0.5f) * Spec_.CellSizeMetres) - HitWorld.Y;
        for (int I = MinI; I <= MaxI; ++I)
        {
            const float Dx = (Spec_.OriginX + (static_cast<float>(I) + 0.5f) * Spec_.CellSizeMetres) - HitWorld.X;
            const float D2 = Dx * Dx + Dy * Dy;
            if (D2 <= RMax * RMax)
            {
                WSum += std::exp(-D2 * Inv2Sig2);
            }
        }
    }
    if (WSum <= 1.0e-7f)
    {
        return;
    }

    for (int J = MinJ; J <= MaxJ; ++J)
    {
        const float Dy = (Spec_.OriginY + (static_cast<float>(J) + 0.5f) * Spec_.CellSizeMetres) - HitWorld.Y;
        for (int I = MinI; I <= MaxI; ++I)
        {
            const float Dx = (Spec_.OriginX + (static_cast<float>(I) + 0.5f) * Spec_.CellSizeMetres) - HitWorld.X;
            const float D2 = Dx * Dx + Dy * Dy;
            if (D2 <= RMax * RMax)
            {
                const float W   = std::exp(-D2 * Inv2Sig2) / WSum;
                const auto  Idx = CellIndex(static_cast<uint32_t>(I), static_cast<uint32_t>(J));
                HailDepthMetres_[Idx] += (HailPacketMassKg * W) / (Spec_.HailBulkDensityKgM3 * CellArea);
            }
        }
    }

    Telemetry_.GroundSolidMassKg += static_cast<double>(HailPacketMassKg);
    ++Telemetry_.RetiredHailPelletsFused;
}

void SnowSurface::RelaxAngleOfReposeAndWindDrift(
    Vec3     PrevailingWindMps,
    float    DtSeconds,
    uint32_t SubIterations) noexcept
{
    if (DtSeconds <= 0.0f || Spec_.CellsX < 3u || Spec_.CellsY < 3u)
    {
        return;
    }

    const uint32_t Nx       = Spec_.CellsX;
    const uint32_t Ny       = Spec_.CellsY;
    const float    Dx       = Spec_.CellSizeMetres;
    const float    CritTan  = std::tan(std::clamp(Spec_.AngleOfReposeDegrees, 20.0f, 52.0f) * (3.1415926535f / 180.0f));
    const float    SubDt    = DtSeconds / static_cast<float>(std::max(1u, SubIterations));
    const float    WindMag  = std::sqrt(PrevailingWindMps.X * PrevailingWindMps.X + PrevailingWindMps.Y * PrevailingWindMps.Y);
    const Vec3     WindUnit = (WindMag > 1.0e-3f)
                                  ? Vec3{PrevailingWindMps.X / WindMag, PrevailingWindMps.Y / WindMag, 0.0f}
                                  : Vec3{1.0f, 0.0f, 0.0f};

    std::vector<float> DeltaSnow(static_cast<std::size_t>(Nx) * Ny, 0.0f);

    constexpr int   OffI[8]  = {1, -1, 0, 0, 1, 1, -1, -1};
    constexpr int   OffJ[8]  = {0, 0, 1, -1, 1, -1, 1, -1};
    constexpr float DistS[8] = {1.0f, 1.0f, 1.0f, 1.0f, 1.41421356f, 1.41421356f, 1.41421356f, 1.41421356f};

    for (uint32_t Iter = 0u; Iter < std::max(1u, SubIterations); ++Iter)
    {
        std::fill(DeltaSnow.begin(), DeltaSnow.end(), 0.0f);

        for (uint32_t J = 1u; J + 1u < Ny; ++J)
        {
            for (uint32_t I = 1u; I + 1u < Nx; ++I)
            {
                const std::size_t CIdx = CellIndex(I, J);
                const float       SnowHere = SnowDepthMetres_[CIdx];
                if (SnowHere <= 1.0e-4f)
                {
                    continue;
                }
                const float TopHere = TerrainElevation_[CIdx] + SnowHere + HailDepthMetres_[CIdx];

                // 1) Dry-powder angle-of-repose avalanche slumping across all 8 cardinal + diagonal neighbours!
                float ExcessSum = 0.0f;
                float ExcessArr[8]{};
                for (int K = 0; K < 8; ++K)
                {
                    const std::size_t NIdx    = CellIndex(static_cast<uint32_t>(static_cast<int>(I) + OffI[K]),
                                                          static_cast<uint32_t>(static_cast<int>(J) + OffJ[K]));
                    const float       TopNbr  = TerrainElevation_[NIdx] + SnowDepthMetres_[NIdx] + HailDepthMetres_[NIdx];
                    const float       MaxDrop = CritTan * Dx * DistS[K];
                    const float       Excess  = (TopHere - TopNbr) - MaxDrop;
                    if (Excess > 0.0f)
                    {
                        ExcessArr[K] = Excess / DistS[K];
                        ExcessSum += ExcessArr[K];
                    }
                }
                if (ExcessSum > 1.0e-5f)
                {
                    const float MaxTransfer = std::min(SnowHere * 0.38f, ExcessSum * 0.24f);
                    for (int K = 0; K < 8; ++K)
                    {
                        if (ExcessArr[K] > 0.0f)
                        {
                            const std::size_t NIdx = CellIndex(static_cast<uint32_t>(static_cast<int>(I) + OffI[K]),
                                                               static_cast<uint32_t>(static_cast<int>(J) + OffJ[K]));
                            const float Move = MaxTransfer * (ExcessArr[K] / ExcessSum);
                            DeltaSnow[CIdx] -= Move;
                            DeltaSnow[NIdx] += Move;
                        }
                    }
                }

                // 2) Windward-to-leeward saltation transport: erodes wind-facing ramp & deposits onto leeward slip-face!
                if (WindMag > 0.6f && SnowHere > 0.008f)
                {
                    const float GradX = ((TerrainElevation_[CellIndex(I + 1u, J)] + SnowDepthMetres_[CellIndex(I + 1u, J)]) -
                                         (TerrainElevation_[CellIndex(I - 1u, J)] + SnowDepthMetres_[CellIndex(I - 1u, J)])) / (2.0f * Dx);
                    const float GradY = ((TerrainElevation_[CellIndex(I, J + 1u)] + SnowDepthMetres_[CellIndex(I, J + 1u)]) -
                                         (TerrainElevation_[CellIndex(I, J - 1u)] + SnowDepthMetres_[CellIndex(I, J - 1u)])) / (2.0f * Dx);
                    // Positive WindFacing when wind climbs up the windward flank (Grad dot Wind > 0)!
                    const float WindFacing = GradX * WindUnit.X + GradY * WindUnit.Y;
                    if (WindFacing > -0.05f)
                    {
                        const int   StepI = (WindUnit.X >= 0.25f) ? 1 : ((WindUnit.X <= -0.25f) ? -1 : 0);
                        const int   StepJ = (WindUnit.Y >= 0.25f) ? 1 : ((WindUnit.Y <= -0.25f) ? -1 : 0);
                        if (StepI != 0 || StepJ != 0)
                        {
                            const std::size_t LeeIdx = CellIndex(static_cast<uint32_t>(static_cast<int>(I) + StepI),
                                                                 static_cast<uint32_t>(static_cast<int>(J) + StepJ));
                            const float Saltate = std::min(SnowHere * 0.04f,
                                                           0.0018f * WindMag * (0.25f + std::max(0.0f, WindFacing)) * SubDt);
                            DeltaSnow[CIdx]   -= Saltate;
                            DeltaSnow[LeeIdx] += Saltate;
                        }
                    }
                }
            }
        }

        for (std::size_t Idx = 0u; Idx < DeltaSnow.size(); ++Idx)
        {
            SnowDepthMetres_[Idx] = std::max(0.0f, SnowDepthMetres_[Idx] + DeltaSnow[Idx]);
        }
    }
}

uint32_t SnowSurface::CountConnectedMeshComponents(const SnowpackPolygonSurface& Surface)
{
    const size_t TriCount = Surface.Indices.size() / 3u;
    if (TriCount == 0u || Surface.Vertices.empty())
    {
        return 0u;
    }

    std::vector<std::vector<uint32_t>> VertToTris(Surface.Vertices.size());
    for (size_t T = 0u; T < TriCount; ++T)
    {
        for (size_t C = 0u; C < 3u; ++C)
        {
            const uint32_t V = Surface.Indices[T * 3u + C];
            if (V < VertToTris.size())
            {
                VertToTris[V].push_back(static_cast<uint32_t>(T));
            }
        }
    }

    std::vector<uint8_t>  Visited(TriCount, 0u);
    std::vector<uint32_t> Queue;
    Queue.reserve(TriCount);
    uint32_t Components = 0u;

    for (size_t StartT = 0u; StartT < TriCount; ++StartT)
    {
        if (Visited[StartT] != 0u)
        {
            continue;
        }
        ++Components;
        Visited[StartT] = 1u;
        Queue.clear();
        Queue.push_back(static_cast<uint32_t>(StartT));

        size_t Head = 0u;
        while (Head < Queue.size())
        {
            const uint32_t CurT = Queue[Head++];
            for (size_t C = 0u; C < 3u; ++C)
            {
                const uint32_t V = Surface.Indices[static_cast<size_t>(CurT) * 3u + C];
                for (uint32_t NbrT : VertToTris[V])
                {
                    if (Visited[NbrT] == 0u)
                    {
                        Visited[NbrT] = 1u;
                        Queue.push_back(NbrT);
                    }
                }
            }
        }
    }
    return Components;
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                        SINGLE CONTIGUOUS POLYGON SURFACE SYNTHESIS
------------------------------------------------------------------------------------------------------------------------------------------*/
void SnowSurface::RebuildContiguousPolygonSurfaces(const VehicleSnowEnvelope& VehicleEnvelope)
{
    GroundSurface_.Vertices.clear();
    GroundSurface_.Indices.clear();
    GroundSurface_.ActiveQuadCount         = 0u;
    GroundSurface_.ConnectedComponentCount = 0u;
    GroundSurface_.PeakThicknessM          = 0.0f;
    GroundSurface_.TotalSolidMassKg        = Telemetry_.GroundSolidMassKg;

    const uint32_t VxCount = Spec_.CellsX;
    const uint32_t VyCount = Spec_.CellsY;
    const size_t   NCells  = static_cast<size_t>(VxCount) * VyCount;

    // 1. Volume-preserving Taubin (lambda / mu) smoothing on snow/hail/compaction fields:
    //    Eliminates grid faceting & isolated noisy spikes WITHOUT shrinking peak snow-mound elevation!
    std::vector<float> SmoothSnow = SnowDepthMetres_;
    std::vector<float> SmoothHail = HailDepthMetres_;
    std::vector<float> SmoothPack(NCells, 0.0f);

    for (size_t CIdx = 0u; CIdx < NCells; ++CIdx)
    {
        SmoothPack[CIdx] = std::clamp(
            (SnowDensityKgM3_[CIdx] - Spec_.FreshSnowDensityKgM3) /
                std::max(1.0f, Spec_.PackedSnowDensityKgM3 - Spec_.FreshSnowDensityKgM3),
            0.0f,
            1.0f);
    }

    std::vector<float> TmpSnow(NCells, 0.0f);
    std::vector<float> TmpHail(NCells, 0.0f);
    std::vector<float> TmpPack(NCells, 0.0f);

    auto ApplyTaubinStep = [&](float StepWeight)
    {
        for (uint32_t J = 0u; J < VyCount; ++J)
        {
            for (uint32_t I = 0u; I < VxCount; ++I)
            {
                const auto CIdx = CellIndex(I, J);
                float SumS = 0.0f, SumH = 0.0f, SumP = 0.0f, WSum = 0.0f;
                for (int Dj = -1; Dj <= 1; ++Dj)
                {
                    const int   Nj  = std::clamp(static_cast<int>(J) + Dj, 0, static_cast<int>(VyCount) - 1);
                    const float WyK = (Dj == 0) ? 2.0f : 1.0f;
                    for (int Di = -1; Di <= 1; ++Di)
                    {
                        if (Di == 0 && Dj == 0)
                        {
                            continue;
                        }
                        const int   Ni   = std::clamp(static_cast<int>(I) + Di, 0, static_cast<int>(VxCount) - 1);
                        const float W    = WyK * ((Di == 0) ? 2.0f : 1.0f);
                        const auto  NIdx = CellIndex(static_cast<uint32_t>(Ni), static_cast<uint32_t>(Nj));
                        SumS += SmoothSnow[NIdx] * W;
                        SumH += SmoothHail[NIdx] * W;
                        SumP += SmoothPack[NIdx] * W;
                        WSum += W;
                    }
                }
                const float AvgS = SumS / WSum;
                const float AvgH = SumH / WSum;
                const float AvgP = SumP / WSum;
                TmpSnow[CIdx] = std::max(0.0f, SmoothSnow[CIdx] + StepWeight * (AvgS - SmoothSnow[CIdx]));
                TmpHail[CIdx] = std::max(0.0f, SmoothHail[CIdx] + StepWeight * (AvgH - SmoothHail[CIdx]));
                TmpPack[CIdx] = std::clamp(SmoothPack[CIdx] + 0.5f * std::abs(StepWeight) * (AvgP - SmoothPack[CIdx]), 0.0f, 1.0f);
            }
        }
        SmoothSnow.swap(TmpSnow);
        SmoothHail.swap(TmpHail);
        SmoothPack.swap(TmpPack);
    };

    for (int Iter = 0; Iter < 2; ++Iter)
    {
        ApplyTaubinStep(+0.46f); // Low-pass smoothing pass
        ApplyTaubinStep(-0.48f); // Volume-restoring un-shrinking pass!
    }
    ApplyTaubinStep(+0.28f);

    // Subtle wind-carved sastrugi & natural powder undulation (zero at thin skirt perimeter, rich on deep snow flanks!)
    const Vec3 WindDir = Normalise(Vec3{Spec_.PrevailingWindDirection.X, Spec_.PrevailingWindDirection.Y, 0.0f});
    const Vec3 WindLat{-WindDir.Y, WindDir.X, 0.0f};
    auto EvaluateSastrugiRelief = [&](float Wx, float Wy, float SnowThick, float Pack) noexcept -> float
    {
        if (Spec_.SastrugiAmplitudeMetres <= 1.0e-5f || SnowThick <= 0.015f)
        {
            return 0.0f;
        }
        const float DepthMask = std::clamp((SnowThick - 0.015f) / 0.14f, 0.0f, 1.0f) * (1.0f - 0.65f * Pack);
        const float AlongW    = Wx * WindDir.X + Wy * WindDir.Y;
        const float CrossW    = Wx * WindLat.X + Wy * WindLat.Y;
        // Elongated wind-aligned sastrugi ripples + secondary multi-scale snow grain!
        const float R0 = std::sin(AlongW * 2.15f + 0.65f * std::sin(CrossW * 1.85f));
        const float R1 = std::sin(CrossW * 5.40f + 1.15f * std::cos(AlongW * 1.35f));
        const float R2 = 1.0f - std::abs(std::sin(CrossW * 2.95f - AlongW * 0.85f));
        return Spec_.SastrugiAmplitudeMetres * DepthMask * (0.48f * R0 + 0.24f * R1 + 0.28f * (R2 - 0.5f));
    };

    auto TotalSmoothThickness = [&](uint32_t I, uint32_t J) noexcept -> float
    {
        const auto Idx = CellIndex(I, J);
        return SmoothSnow[Idx] + SmoothHail[Idx];
    };

    const float     IsoThreshold = std::max(0.0015f, Spec_.SurfaceInclusionThreshold);
    constexpr float SkirtLiftM   = 0.0028f; // [m] - Feathered powder contact lip on terrain

    std::vector<int32_t> GridVertRemap(NCells, -1);
    std::vector<int32_t> HorizEdgeRemap(NCells, -1);
    std::vector<int32_t> VertEdgeRemap(NCells, -1);

    auto EnsureGridVertex = [&](uint32_t I, uint32_t J) -> uint32_t
    {
        const size_t Key = static_cast<size_t>(J) * VxCount + I;
        if (GridVertRemap[Key] >= 0)
        {
            return static_cast<uint32_t>(GridVertRemap[Key]);
        }

        const auto  Idx    = CellIndex(I, J);
        const float SnowH  = SmoothSnow[Idx];
        const float HailH  = SmoothHail[Idx];
        const float Thick  = SnowH + HailH;
        const float Wx     = Spec_.OriginX + (static_cast<float>(I) + 0.5f) * Spec_.CellSizeMetres;
        const float Wy     = Spec_.OriginY + (static_cast<float>(J) + 0.5f) * Spec_.CellSizeMetres;
        const float Relief = EvaluateSastrugiRelief(Wx, Wy, SnowH, SmoothPack[Idx]);
        const float FinalH = std::max(Thick + Relief, SkirtLiftM);

        SnowpackPolygonVertex V{};
        V.Position        = Vec3{Wx, Wy, TerrainElevation_[Idx] + FinalH};
        V.Normal          = Vec3{0.0f, 0.0f, 1.0f};
        V.SnowThicknessM  = FinalH;
        V.HailIceFraction = (Thick > 1.0e-5f) ? std::clamp(HailH / Thick, 0.0f, 1.0f) : 0.0f;
        V.CompactionRatio = SmoothPack[Idx];

        GroundSurface_.PeakThicknessM = std::max(GroundSurface_.PeakThicknessM, std::max(FinalH, SnowDepthMetres_[Idx] + HailDepthMetres_[Idx]));
        const uint32_t OutIdx         = static_cast<uint32_t>(GroundSurface_.Vertices.size());
        GroundSurface_.Vertices.push_back(V);
        GridVertRemap[Key] = static_cast<int32_t>(OutIdx);
        return OutIdx;
    };

    // Watertight Marching-Squares sub-cell edge root interpolation (eliminates 90-degree pixelated perimeter squares)!
    auto EnsureEdgeIsoVertex = [&](uint32_t Ia, uint32_t Ja, uint32_t Ib, uint32_t Jb, bool Horizontal) -> uint32_t
    {
        const uint32_t       KeyI  = std::min(Ia, Ib);
        const uint32_t       KeyJ  = std::min(Ja, Jb);
        const size_t         Key   = static_cast<size_t>(KeyJ) * VxCount + KeyI;
        std::vector<int32_t>& Cache = Horizontal ? HorizEdgeRemap : VertEdgeRemap;
        if (Cache[Key] >= 0)
        {
            return static_cast<uint32_t>(Cache[Key]);
        }

        const auto  IdxA = CellIndex(Ia, Ja);
        const auto  IdxB = CellIndex(Ib, Jb);
        const float Ha   = TotalSmoothThickness(Ia, Ja);
        const float Hb   = TotalSmoothThickness(Ib, Jb);
        const float T    = (std::abs(Hb - Ha) > 1.0e-6f) ? std::clamp((IsoThreshold - Ha) / (Hb - Ha), 0.05f, 0.95f) : 0.5f;

        const float WxA  = Spec_.OriginX + (static_cast<float>(Ia) + 0.5f) * Spec_.CellSizeMetres;
        const float WyA  = Spec_.OriginY + (static_cast<float>(Ja) + 0.5f) * Spec_.CellSizeMetres;
        const float WxB  = Spec_.OriginX + (static_cast<float>(Ib) + 0.5f) * Spec_.CellSizeMetres;
        const float WyB  = Spec_.OriginY + (static_cast<float>(Jb) + 0.5f) * Spec_.CellSizeMetres;
        const float BedZ = TerrainElevation_[IdxA] + (TerrainElevation_[IdxB] - TerrainElevation_[IdxA]) * T;

        SnowpackPolygonVertex V{};
        V.Position        = Vec3{WxA + (WxB - WxA) * T, WyA + (WyB - WyA) * T, BedZ + SkirtLiftM};
        V.Normal          = Vec3{0.0f, 0.0f, 1.0f};
        V.SnowThicknessM  = IsoThreshold;
        V.HailIceFraction = 0.5f * ((Ha > 1.0e-5f ? SmoothHail[IdxA] / Ha : 0.0f) + (Hb > 1.0e-5f ? SmoothHail[IdxB] / Hb : 0.0f));
        V.CompactionRatio = SmoothPack[IdxA] + (SmoothPack[IdxB] - SmoothPack[IdxA]) * T;

        const uint32_t OutIdx = static_cast<uint32_t>(GroundSurface_.Vertices.size());
        GroundSurface_.Vertices.push_back(V);
        Cache[Key] = static_cast<int32_t>(OutIdx);
        return OutIdx;
    };

    auto PushSnowTri = [&](uint32_t A, uint32_t B, uint32_t C)
    {
        GroundSurface_.Indices.push_back(A);
        GroundSurface_.Indices.push_back(B);
        GroundSurface_.Indices.push_back(C);
    };
    auto PushConvexPolygon = [&](const uint32_t* Poly, uint32_t Count)
    {
        for (uint32_t K = 1u; K + 1u < Count; ++K)
        {
            PushSnowTri(Poly[0], Poly[K], Poly[K + 1u]);
        }
        ++GroundSurface_.ActiveQuadCount;
    };

    // Exact 16-case Marching Squares over cell centres (I,J)-(I+1,J)-(I+1,J+1)-(I,J+1)
    for (uint32_t J = 0u; J + 1u < VyCount; ++J)
    {
        for (uint32_t I = 0u; I + 1u < VxCount; ++I)
        {
            const float H00 = TotalSmoothThickness(I, J);
            const float H10 = TotalSmoothThickness(I + 1u, J);
            const float H11 = TotalSmoothThickness(I + 1u, J + 1u);
            const float H01 = TotalSmoothThickness(I, J + 1u);

            const uint32_t B0 = (H00 >= IsoThreshold) ? 1u : 0u;
            const uint32_t B1 = (H10 >= IsoThreshold) ? 2u : 0u;
            const uint32_t B2 = (H11 >= IsoThreshold) ? 4u : 0u;
            const uint32_t B3 = (H01 >= IsoThreshold) ? 8u : 0u;
            const uint32_t CaseMask = B0 | B1 | B2 | B3;
            if (CaseMask == 0u)
            {
                continue;
            }

            if (CaseMask == 15u)
            {
                const uint32_t V00 = EnsureGridVertex(I, J);
                const uint32_t V10 = EnsureGridVertex(I + 1u, J);
                const uint32_t V11 = EnsureGridVertex(I + 1u, J + 1u);
                const uint32_t V01 = EnsureGridVertex(I, J + 1u);
                // Split quad along smoother curvature diagonal!
                if (std::abs(H00 - H11) <= std::abs(H10 - H01))
                {
                    PushSnowTri(V00, V10, V11);
                    PushSnowTri(V00, V11, V01);
                }
                else
                {
                    PushSnowTri(V10, V11, V01);
                    PushSnowTri(V10, V01, V00);
                }
                ++GroundSurface_.ActiveQuadCount;
                continue;
            }

            // Clip CCW quad [C0=(I,J), C1=(I+1,J), C2=(I+1,J+1), C3=(I,J+1)] against H >= IsoThreshold!
            const uint32_t CI[4]   = {I, I + 1u, I + 1u, I};
            const uint32_t CJ[4]   = {J, J, J + 1u, J + 1u};
            const bool     In[4]   = {B0 != 0u, B1 != 0u, B2 != 0u, B3 != 0u};
            const bool     EdgeH[4] = {true, false, true, false};

            uint32_t Clipped[8]{};
            uint32_t ClippedCount = 0u;
            for (uint32_t Edge = 0u; Edge < 4u; ++Edge)
            {
                const uint32_t Next = (Edge + 1u) & 3u;
                if (In[Edge])
                {
                    Clipped[ClippedCount++] = EnsureGridVertex(CI[Edge], CJ[Edge]);
                }
                if (In[Edge] != In[Next])
                {
                    Clipped[ClippedCount++] = EnsureEdgeIsoVertex(CI[Edge], CJ[Edge], CI[Next], CJ[Next], EdgeH[Edge]);
                }
            }
            if (ClippedCount >= 3u)
            {
                PushConvexPolygon(Clipped, ClippedCount);
            }
        }
    }

    // Enforce strictly ONE single connected 3D snow-mound mesh when requested, and record exact topological component count!
    if (Spec_.EnforceSingleConnectedMesh && GroundSurface_.Indices.size() >= 6u)
    {
        const size_t TriCount = GroundSurface_.Indices.size() / 3u;
        std::vector<std::vector<uint32_t>> VertToTris(GroundSurface_.Vertices.size());
        for (size_t T = 0u; T < TriCount; ++T)
        {
            for (size_t C = 0u; C < 3u; ++C)
            {
                VertToTris[GroundSurface_.Indices[T * 3u + C]].push_back(static_cast<uint32_t>(T));
            }
        }
        std::vector<int32_t> CompId(TriCount, -1);
        std::vector<size_t>  CompSizes;
        std::vector<uint32_t> Queue;
        for (size_t StartT = 0u; StartT < TriCount; ++StartT)
        {
            if (CompId[StartT] >= 0) continue;
            const int32_t Cid = static_cast<int32_t>(CompSizes.size());
            CompId[StartT]    = Cid;
            Queue.clear();
            Queue.push_back(static_cast<uint32_t>(StartT));
            size_t Head = 0u;
            while (Head < Queue.size())
            {
                const uint32_t CurT = Queue[Head++];
                for (size_t C = 0u; C < 3u; ++C)
                {
                    for (uint32_t NbrT : VertToTris[GroundSurface_.Indices[static_cast<size_t>(CurT) * 3u + C]])
                    {
                        if (CompId[NbrT] < 0)
                        {
                            CompId[NbrT] = Cid;
                            Queue.push_back(NbrT);
                        }
                    }
                }
            }
            CompSizes.push_back(Queue.size());
        }

        if (CompSizes.size() > 1u)
        {
            int32_t LargestCid = 0;
            for (size_t K = 1u; K < CompSizes.size(); ++K)
            {
                if (CompSizes[K] > CompSizes[static_cast<size_t>(LargestCid)])
                {
                    LargestCid = static_cast<int32_t>(K);
                }
            }
            std::vector<int32_t>              VertCompact(GroundSurface_.Vertices.size(), -1);
            std::vector<SnowpackPolygonVertex> CompactVerts;
            std::vector<uint32_t>              CompactIndices;
            CompactVerts.reserve(GroundSurface_.Vertices.size());
            CompactIndices.reserve(GroundSurface_.Indices.size());

            for (size_t T = 0u; T < TriCount; ++T)
            {
                if (CompId[T] != LargestCid) continue;
                for (size_t C = 0u; C < 3u; ++C)
                {
                    const uint32_t OldV = GroundSurface_.Indices[T * 3u + C];
                    if (VertCompact[OldV] < 0)
                    {
                        VertCompact[OldV] = static_cast<int32_t>(CompactVerts.size());
                        CompactVerts.push_back(GroundSurface_.Vertices[OldV]);
                    }
                    CompactIndices.push_back(static_cast<uint32_t>(VertCompact[OldV]));
                }
            }
            GroundSurface_.Vertices.swap(CompactVerts);
            GroundSurface_.Indices.swap(CompactIndices);
        }
    }

    // Compute smooth area-weighted per-vertex normals across the contiguous snow PolygonSurface!
    std::vector<Vec3> AccumNormals(GroundSurface_.Vertices.size(), Vec3{0.0f, 0.0f, 0.0f});
    for (size_t T = 0u; T + 2u < GroundSurface_.Indices.size(); T += 3u)
    {
        const uint32_t I0 = GroundSurface_.Indices[T + 0u];
        const uint32_t I1 = GroundSurface_.Indices[T + 1u];
        const uint32_t I2 = GroundSurface_.Indices[T + 2u];
        const Vec3     E1 = GroundSurface_.Vertices[I1].Position - GroundSurface_.Vertices[I0].Position;
        const Vec3     E2 = GroundSurface_.Vertices[I2].Position - GroundSurface_.Vertices[I0].Position;
        Vec3           Fn = Cross(E1, E2);
        if (Fn.Z < 0.0f)
        {
            Fn = Fn * -1.0f;
        }
        AccumNormals[I0] = AccumNormals[I0] + Fn;
        AccumNormals[I1] = AccumNormals[I1] + Fn;
        AccumNormals[I2] = AccumNormals[I2] + Fn;
    }
    for (size_t VIdx = 0u; VIdx < GroundSurface_.Vertices.size(); ++VIdx)
    {
        const float Len = Length(AccumNormals[VIdx]);
        GroundSurface_.Vertices[VIdx].Normal = (Len > 1.0e-7f) ? (AccumNormals[VIdx] * (1.0f / Len)) : Vec3{0.0f, 0.0f, 1.0f};
    }

    GroundSurface_.ConnectedComponentCount = CountConnectedMeshComponents(GroundSurface_);

    for (size_t CIdx = 0u; CIdx < NCells; ++CIdx)
    {
        GroundSurface_.PeakThicknessM = std::max(GroundSurface_.PeakThicknessM, SnowDepthMetres_[CIdx] + HailDepthMetres_[CIdx]);
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
float SnowSurface::SampleGroundSurfaceElevation(float WorldX, float WorldY) const noexcept
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
    auto TopAt = [&](uint32_t I, uint32_t J) noexcept -> float
    {
        const auto Idx = CellIndex(I, J);
        return TerrainElevation_[Idx] + SnowDepthMetres_[Idx] + HailDepthMetres_[Idx];
    };
    const float A = TopAt(I0, J0) * (1.0f - Tx) + TopAt(I0 + 1u, J0) * Tx;
    const float B = TopAt(I0, J0 + 1u) * (1.0f - Tx) + TopAt(I0 + 1u, J0 + 1u) * Tx;
    return A * (1.0f - Ty) + B * Ty;
}

float SnowSurface::SampleGroundSnowThickness(float WorldX, float WorldY) const noexcept
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

float SnowSurface::SampleGroundHailThickness(float WorldX, float WorldY) const noexcept
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

float SnowSurface::SampleGroundSnowDensity(float WorldX, float WorldY) const noexcept
{
    const float Fx = std::clamp((WorldX - Spec_.OriginX) / Spec_.CellSizeMetres, 0.0f, static_cast<float>(Spec_.CellsX - 1u));
    const float Fy = std::clamp((WorldY - Spec_.OriginY) / Spec_.CellSizeMetres, 0.0f, static_cast<float>(Spec_.CellsY - 1u));
    return SnowDensityKgM3_[CellIndex(static_cast<uint32_t>(Fx), static_cast<uint32_t>(Fy))];
}

} // namespace Frontier
