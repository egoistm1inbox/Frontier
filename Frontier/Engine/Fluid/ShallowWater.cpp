/*==========================================================================================================================================
                                                  SHALLOWWATERMUDEXTENSION.CPP
==========================================================================================================================================*/
// 🧩 2.5D Saint-Venant shallow-water & Bingham-plastic mud implementation (2nd-order hydrostatic Audusse-Minmod, zero foam/splash).

#include "Engine/Fluid/ShallowWater.h"

#include <algorithm>
#include <cmath>

namespace Frontier
{

namespace
{

constexpr float PiScalar = 3.14159265358979323846f;

[[nodiscard]] inline float ClampF(float X, float Lo, float Hi) noexcept
{
    return (X < Lo) ? Lo : ((X > Hi) ? Hi : X);
}

[[nodiscard]] inline float MinmodSlope(float A, float B) noexcept
{
    if (A * B <= 0.0f)
    {
        return 0.0f;
    }
    return (std::abs(A) < std::abs(B)) ? A : B;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                            INITIALIZATION & TERRAIN SCULPTING
//------------------------------------------------------------------------------------------------------------------------

ShallowWaterSimulation::ShallowWaterSimulation(const ShallowWaterConfiguration& Configuration)
{
    Reconfigure(Configuration);
}

void ShallowWaterSimulation::Reconfigure(const ShallowWaterConfiguration& Configuration)
{
    Config_               = Configuration;
    Config_.CellsX        = std::max(8u, Config_.CellsX);
    Config_.CellsY        = std::max(8u, Config_.CellsY);
    Config_.CellSizeMetres = std::max(0.05f, Config_.CellSizeMetres);

    const std::size_t Total = static_cast<std::size_t>(Config_.CellsX) * static_cast<std::size_t>(Config_.CellsY);
    Bed_.assign(Total, 0.0f);
    DepthMud_.assign(Total * 2u, 0.0f);
    DepthMudScratch_.assign(Total * 2u, 0.0f);
    VelocityUV_.assign(Total * 2u, 0.0f);
    VelocityScratch_.assign(Total * 2u, 0.0f);
    OutflowLimiter_.assign(Total, 1.0f);
    ObjectSpanStiff_.assign(Total * 4u, 0.0f);
    ObjectVelUV_.assign(Total * 2u, 0.0f);
    Sources_.clear();
    ElapsedSeconds_ = 0.0f;
    Diagnostics_    = {};
}

void ShallowWaterSimulation::ResetField() noexcept
{
    std::fill(DepthMud_.begin(), DepthMud_.end(), 0.0f);
    std::fill(DepthMudScratch_.begin(), DepthMudScratch_.end(), 0.0f);
    std::fill(VelocityUV_.begin(), VelocityUV_.end(), 0.0f);
    std::fill(VelocityScratch_.begin(), VelocityScratch_.end(), 0.0f);
    std::fill(OutflowLimiter_.begin(), OutflowLimiter_.end(), 1.0f);
    ClearSubmergedSolids();
    Sources_.clear();
    ElapsedSeconds_ = 0.0f;
    Diagnostics_    = {};
}

void ShallowWaterSimulation::AssignBedElevationGrid(const std::vector<float>& BedHeightsMetres)
{
    const std::size_t Total = Bed_.size();
    const std::size_t CopyN = std::min(Total, BedHeightsMetres.size());
    for (std::size_t I = 0u; I < CopyN; ++I)
    {
        Bed_[I] = BedHeightsMetres[I];
    }
}

void ShallowWaterSimulation::SculptBedDepressionOrMound(
    std::array<float, 2> WorldCenterXY,
    float                RadiusMetres,
    float                DeltaElevationMetres) noexcept
{
    if (RadiusMetres <= 1.0e-4f)
    {
        return;
    }
    const float InvR = 1.0f / RadiusMetres;
    for (std::uint32_t J = 0u; J < Config_.CellsY; ++J)
    {
        const float Wy = Config_.WorldOriginXY[1] + (static_cast<float>(J) + 0.5f) * Config_.CellSizeMetres;
        for (std::uint32_t I = 0u; I < Config_.CellsX; ++I)
        {
            const float Wx = Config_.WorldOriginXY[0] + (static_cast<float>(I) + 0.5f) * Config_.CellSizeMetres;
            const float Dx = (Wx - WorldCenterXY[0]) * InvR;
            const float Dy = (Wy - WorldCenterXY[1]) * InvR;
            const float R2 = Dx * Dx + Dy * Dy;
            if (R2 < 1.0f)
            {
                // Smooth C^2 cosine-bell profile so bed slopes remain well-behaved for hydrostatic reconstruction!
                const float Bell = 0.5f * (1.0f + std::cos(PiScalar * std::sqrt(R2)));
                Bed_[static_cast<std::size_t>(J) * Config_.CellsX + I] += DeltaElevationMetres * Bell;
            }
        }
    }
}

void ShallowWaterSimulation::FillBasinRegion(
    std::array<float, 2> WorldCenterXY,
    float                RadiusMetres,
    float                SurfaceElevationMetres,
    float                MudConcentrationZeroToOne) noexcept
{
    const float ClampedMud = ClampF(MudConcentrationZeroToOne, 0.0f, 1.0f);
    const float R2Max      = RadiusMetres * RadiusMetres;
    for (std::uint32_t J = 0u; J < Config_.CellsY; ++J)
    {
        const float Wy = Config_.WorldOriginXY[1] + (static_cast<float>(J) + 0.5f) * Config_.CellSizeMetres;
        for (std::uint32_t I = 0u; I < Config_.CellsX; ++I)
        {
            const float Wx = Config_.WorldOriginXY[0] + (static_cast<float>(I) + 0.5f) * Config_.CellSizeMetres;
            const float Dx = Wx - WorldCenterXY[0];
            const float Dy = Wy - WorldCenterXY[1];
            if (Dx * Dx + Dy * Dy <= R2Max)
            {
                const std::size_t K   = static_cast<std::size_t>(J) * Config_.CellsX + I;
                const float       NewH = std::max(0.0f, SurfaceElevationMetres - Bed_[K]);
                if (NewH > DepthMud_[K * 2u + 0u])
                {
                    DepthMud_[K * 2u + 0u] = NewH;
                    DepthMud_[K * 2u + 1u] = ClampedMud;
                }
            }
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                      CLOUD-GATED RAIN PUDDLES & MELT INJECTION
//------------------------------------------------------------------------------------------------------------------------

void ShallowWaterSimulation::DepositSpatiallyGatedRain(
    float                BaseRainRateMetresPerSec,
    const float*         CloudColumnOpticalDepths32x32,
    float                CloudOpticalGate,
    std::array<float, 2> CloudGridAnchorXY,
    float                CloudGridSpanMetres,
    float                StepSeconds) noexcept
{
    if (BaseRainRateMetresPerSec <= 0.0f || StepSeconds <= 0.0f)
    {
        return;
    }

    const float HalfSpan = 0.5f * std::max(CloudGridSpanMetres, 1.0f);
    for (std::uint32_t J = 0u; J < Config_.CellsY; ++J)
    {
        const float Wy = Config_.WorldOriginXY[1] + (static_cast<float>(J) + 0.5f) * Config_.CellSizeMetres;
        for (std::uint32_t I = 0u; I < Config_.CellsX; ++I)
        {
            const float Wx = Config_.WorldOriginXY[0] + (static_cast<float>(I) + 0.5f) * Config_.CellSizeMetres;
            float CloudFactor = 1.0f;
            if (CloudColumnOpticalDepths32x32 != nullptr)
            {
                const float U = (Wx - (CloudGridAnchorXY[0] - HalfSpan)) / (2.0f * HalfSpan);
                const float V = (Wy - (CloudGridAnchorXY[1] - HalfSpan)) / (2.0f * HalfSpan);
                if (U < 0.0f || U > 1.0f || V < 0.0f || V > 1.0f)
                {
                    CloudFactor = 0.0f;
                }
                else
                {
                    const std::uint32_t Cx = std::min(31u, static_cast<std::uint32_t>(U * 32.0f));
                    const std::uint32_t Cy = std::min(31u, static_cast<std::uint32_t>(V * 32.0f));
                    const float Tau        = CloudColumnOpticalDepths32x32[Cy * 32u + Cx];
                    CloudFactor            = (Tau >= CloudOpticalGate) ? ClampF((Tau - CloudOpticalGate) * 2.5f + 0.35f, 0.0f, 1.4f) : 0.0f;
                }
            }
            if (CloudFactor > 0.0f)
            {
                const std::size_t K    = static_cast<std::size_t>(J) * Config_.CellsX + I;
                const float       OldH = DepthMud_[K * 2u + 0u];
                const float       OldC = DepthMud_[K * 2u + 1u];
                const float       AddH = BaseRainRateMetresPerSec * CloudFactor * StepSeconds;
                const float       NewH = OldH + AddH;
                DepthMud_[K * 2u + 0u] = NewH;
                DepthMud_[K * 2u + 1u] = (NewH > 1.0e-7f) ? ClampF((OldH * OldC) / NewH, 0.0f, 1.0f) : OldC;
            }
        }
    }
}

void ShallowWaterSimulation::InjectLocalLiquidOrMeltVolume(
    std::array<float, 2> WorldPositionXY,
    float                RadiusMetres,
    float                AddedDepthMetres,
    float                MudConcentrationZeroToOne) noexcept
{
    if (AddedDepthMetres <= 0.0f || RadiusMetres <= 1.0e-4f)
    {
        return;
    }
    const float MudC  = ClampF(MudConcentrationZeroToOne, 0.0f, 1.0f);
    const float InvR  = 1.0f / RadiusMetres;
    for (std::uint32_t J = 0u; J < Config_.CellsY; ++J)
    {
        const float Wy = Config_.WorldOriginXY[1] + (static_cast<float>(J) + 0.5f) * Config_.CellSizeMetres;
        for (std::uint32_t I = 0u; I < Config_.CellsX; ++I)
        {
            const float Wx = Config_.WorldOriginXY[0] + (static_cast<float>(I) + 0.5f) * Config_.CellSizeMetres;
            const float Dx = (Wx - WorldPositionXY[0]) * InvR;
            const float Dy = (Wy - WorldPositionXY[1]) * InvR;
            const float R2 = Dx * Dx + Dy * Dy;
            if (R2 < 1.0f)
            {
                const float Weight = 1.0f - R2;
                const std::size_t K = static_cast<std::size_t>(J) * Config_.CellsX + I;
                const float OldH = DepthMud_[K * 2u + 0u];
                const float OldC = DepthMud_[K * 2u + 1u];
                const float Add  = AddedDepthMetres * Weight;
                const float NewH = OldH + Add;
                DepthMud_[K * 2u + 0u] = NewH;
                DepthMud_[K * 2u + 1u] = (NewH > 1.0e-7f) ? ClampF((OldH * OldC + Add * MudC) / NewH, 0.0f, 1.0f) : MudC;
            }
        }
    }
}

void ShallowWaterSimulation::ClearSubmergedSolids() noexcept
{
    std::fill(ObjectSpanStiff_.begin(), ObjectSpanStiff_.end(), 0.0f);
    std::fill(ObjectVelUV_.begin(), ObjectVelUV_.end(), 0.0f);
}

void ShallowWaterSimulation::RegisterSubmergedSolid(const SubmergedSolidStamp& Solid) noexcept
{
    const float CosYaw = std::cos(-Solid.YawRadians);
    const float SinYaw = std::sin(-Solid.YawRadians);
    const float MaxR   = std::hypot(Solid.HalfExtents[0], Solid.HalfExtents[1]) + Config_.CellSizeMetres;

    const std::int32_t MinI = std::max(0, static_cast<std::int32_t>(std::floor((Solid.Centre[0] - MaxR - Config_.WorldOriginXY[0]) / Config_.CellSizeMetres)));
    const std::int32_t MaxI = std::min(static_cast<std::int32_t>(Config_.CellsX) - 1,
                                       static_cast<std::int32_t>(std::ceil((Solid.Centre[0] + MaxR - Config_.WorldOriginXY[0]) / Config_.CellSizeMetres)));
    const std::int32_t MinJ = std::max(0, static_cast<std::int32_t>(std::floor((Solid.Centre[1] - MaxR - Config_.WorldOriginXY[1]) / Config_.CellSizeMetres)));
    const std::int32_t MaxJ = std::min(static_cast<std::int32_t>(Config_.CellsY) - 1,
                                       static_cast<std::int32_t>(std::ceil((Solid.Centre[1] + MaxR - Config_.WorldOriginXY[1]) / Config_.CellSizeMetres)));

    for (std::int32_t J = MinJ; J <= MaxJ; ++J)
    {
        const float Wy = Config_.WorldOriginXY[1] + (static_cast<float>(J) + 0.5f) * Config_.CellSizeMetres;
        for (std::int32_t I = MinI; I <= MaxI; ++I)
        {
            const float Wx = Config_.WorldOriginXY[0] + (static_cast<float>(I) + 0.5f) * Config_.CellSizeMetres;
            const float Dx = Wx - Solid.Centre[0];
            const float Dy = Wy - Solid.Centre[1];
            const float Lx = std::abs(Dx * CosYaw - Dy * SinYaw);
            const float Ly = std::abs(Dx * SinYaw + Dy * CosYaw);
            if (Lx <= Solid.HalfExtents[0] && Ly <= Solid.HalfExtents[1])
            {
                const std::size_t K   = static_cast<std::size_t>(J) * Config_.CellsX + static_cast<std::size_t>(I);
                const float       Bot = Solid.Centre[2] - Solid.HalfExtents[2];
                const float       Top = Solid.Centre[2] + Solid.HalfExtents[2];
                if (Top > Bot && (ObjectSpanStiff_[K * 4u + 1u] <= ObjectSpanStiff_[K * 4u + 0u] || Bot < ObjectSpanStiff_[K * 4u + 0u]))
                {
                    ObjectSpanStiff_[K * 4u + 0u] = Bot;
                    ObjectSpanStiff_[K * 4u + 1u] = Top;
                    ObjectSpanStiff_[K * 4u + 2u] = Solid.LidStiffness;
                    ObjectVelUV_[K * 2u + 0u]     = Solid.HorizontalVel[0];
                    ObjectVelUV_[K * 2u + 1u]     = Solid.HorizontalVel[1];
                }
            }
        }
    }
}

void ShallowWaterSimulation::ClearDischargeSources() noexcept
{
    Sources_.clear();
}

void ShallowWaterSimulation::AppendDischargeSource(const FluidDischargeSource& Source) noexcept
{
    if (Sources_.size() < MaxSources)
    {
        Sources_.push_back(Source);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                        SAINT-VENANT + BINGHAM MUD STAGGERED MAC SOLVER (WITH 2ND-ORDER UPGRADE)
//------------------------------------------------------------------------------------------------------------------------

void ShallowWaterSimulation::ExecuteSingleCflSubstep(float SubstepDt, std::array<float, 2> WindVelocityXY) noexcept
{
    const std::int32_t Nx  = static_cast<std::int32_t>(Config_.CellsX);
    const std::int32_t Ny  = static_cast<std::int32_t>(Config_.CellsY);
    const float        Dx  = Config_.CellSizeMetres;
    const float        Inv = 1.0f / Dx;
    const float        Dt  = SubstepDt;

    auto CellIdx = [Nx](std::int32_t I, std::int32_t J) noexcept -> std::size_t
    {
        return static_cast<std::size_t>(I) + static_cast<std::size_t>(J) * static_cast<std::size_t>(Nx);
    };
    auto ClampIdx = [Nx, Ny](std::int32_t I, std::int32_t J) noexcept -> std::size_t
    {
        return static_cast<std::size_t>(std::clamp(J, 0, Ny - 1)) * static_cast<std::size_t>(Nx) +
               static_cast<std::size_t>(std::clamp(I, 0, Nx - 1));
    };
    auto UAt = [&](std::int32_t I, std::int32_t J) noexcept -> float
    {
        if (I < 0 || I >= Nx - 1) return 0.0f;
        const std::int32_t Cj = std::clamp(J, 0, Ny - 1);
        return VelocityUV_[CellIdx(I, Cj) * 2u + 0u];
    };
    auto VAt = [&](std::int32_t I, std::int32_t J) noexcept -> float
    {
        if (J < 0 || J >= Ny - 1) return 0.0f;
        const std::int32_t Ci = std::clamp(I, 0, Nx - 1);
        return VelocityUV_[CellIdx(Ci, J) * 2u + 1u];
    };
    auto FaceHydroDepth = [&](std::size_t KL, std::size_t KR, float Vel) noexcept -> float
    {
        const std::size_t KD = (Vel >= 0.0f) ? KL : KR;
        const float       HD = DepthMud_[KD * 2u + 0u];
        return ClampF(Bed_[KD] + HD - std::max(Bed_[KL], Bed_[KR]), 0.0f, HD);
    };
    auto Qx = [&](std::int32_t I, std::int32_t J) noexcept -> float
    {
        if (I < 0 || I >= Nx - 1 || J < 0 || J >= Ny) return 0.0f;
        const std::size_t K = CellIdx(I, J);
        const float       U = VelocityUV_[K * 2u + 0u];
        return U * FaceHydroDepth(K, K + 1u, U);
    };
    auto Qy = [&](std::int32_t I, std::int32_t J) noexcept -> float
    {
        if (J < 0 || J >= Ny - 1 || I < 0 || I >= Nx) return 0.0f;
        const std::size_t K = CellIdx(I, J);
        const float       V = VelocityUV_[K * 2u + 1u];
        return V * FaceHydroDepth(K, K + static_cast<std::size_t>(Nx), V);
    };

    // 1. Stelling & Duinmeijer (2003) momentum-conservative upwind bore advection + eddy viscosity.
    const float NuDiff = std::min(Config_.KinematicViscosityM2ps * Dt / (Dx * Dx), 0.2f);
    for (std::int32_t J = 0; J < Ny; ++J)
    {
        for (std::int32_t I = 0; I < Nx; ++I)
        {
            const std::size_t K  = CellIdx(I, J);
            const float       HC = DepthMud_[K * 2u + 0u];
            float             Ox = 0.0f;
            float             Oy = 0.0f;

            if (I < Nx - 1)
            {
                const float U    = UAt(I, J);
                const float HBar = 0.5f * (HC + DepthMud_[(K + 1u) * 2u + 0u]);
                float       Un   = U;
                if (HBar > Config_.DryThresholdMetres)
                {
                    const float Q0  = 0.5f * (Qx(I - 1, J) + Qx(I, J));
                    const float Q1  = 0.5f * (Qx(I, J) + Qx(I + 1, J));
                    const float Us0 = (Q0 >= 0.0f) ? UAt(I - 1, J) : U;
                    const float Us1 = (Q1 >= 0.0f) ? U : UAt(I + 1, J);
                    const float Ax  = ((Q1 * Us1 - Q0 * Us0) - U * (Q1 - Q0)) * Inv;

                    const float QT  = 0.5f * (Qy(I, J) + Qy(I + 1, J));
                    const float QB  = 0.5f * (Qy(I, J - 1) + Qy(I + 1, J - 1));
                    const float UT  = (QT >= 0.0f) ? U : UAt(I, J + 1);
                    const float UB  = (QB >= 0.0f) ? UAt(I, J - 1) : U;
                    const float Ay  = ((QT * UT - QB * UB) - U * (QT - QB)) * Inv;
                    Un = U - Dt * (Ax + Ay) / HBar;
                }
                Ox = Un + NuDiff * (UAt(I - 1, J) + UAt(I + 1, J) + UAt(I, J - 1) + UAt(I, J + 1) - 4.0f * U);
            }

            if (J < Ny - 1)
            {
                const float V    = VAt(I, J);
                const float HBar = 0.5f * (HC + DepthMud_[(K + static_cast<std::size_t>(Nx)) * 2u + 0u]);
                float       Vn   = V;
                if (HBar > Config_.DryThresholdMetres)
                {
                    const float Q0  = 0.5f * (Qy(I, J - 1) + Qy(I, J));
                    const float Q1  = 0.5f * (Qy(I, J) + Qy(I, J + 1));
                    const float Vs0 = (Q0 >= 0.0f) ? VAt(I, J - 1) : V;
                    const float Vs1 = (Q1 >= 0.0f) ? V : VAt(I, J + 1);
                    const float Ay  = ((Q1 * Vs1 - Q0 * Vs0) - V * (Q1 - Q0)) * Inv;

                    const float QR  = 0.5f * (Qx(I, J) + Qx(I, J + 1));
                    const float QL  = 0.5f * (Qx(I - 1, J) + Qx(I - 1, J + 1));
                    const float VR  = (QR >= 0.0f) ? V : VAt(I + 1, J);
                    const float VL  = (QL >= 0.0f) ? VAt(I - 1, J) : V;
                    const float Ax  = ((QR * VR - QL * VL) - V * (QR - QL)) * Inv;
                    Vn = V - Dt * (Ax + Ay) / HBar;
                }
                Oy = Vn + NuDiff * (VAt(I - 1, J) + VAt(I + 1, J) + VAt(I, J - 1) + VAt(I, J + 1) - 4.0f * V);
            }

            VelocityScratch_[K * 2u + 0u] = Ox;
            VelocityScratch_[K * 2u + 1u] = Oy;
        }
    }
    VelocityUV_.swap(VelocityScratch_);

    // 2. Pressure gradient + submerged-object head + wind shear + Manning bed friction + O'Brien-Julien Bingham mud!
    auto EvalObjHead = [&](std::size_t K, float B, float H) noexcept -> std::array<float, 2>
    {
        const float Bot = ObjectSpanStiff_[K * 4u + 0u];
        const float Top = ObjectSpanStiff_[K * 4u + 1u];
        if (Top <= Bot) return { 0.0f, 0.0f };
        const float Surf = B + H;
        const float Sub  = std::max(0.0f, std::min(Top, Surf) - std::max(Bot, B));
        const float Stf  = (Top > Surf) ? ObjectSpanStiff_[K * 4u + 2u] : 1.0f;
        return { Sub, Stf };
    };

    const float WindSpeed = std::hypot(WindVelocityXY[0], WindVelocityXY[1]);
    const std::array<float, 2> WindShearPa = {
        1.2f * 1.3e-3f * WindSpeed * WindVelocityXY[0],
        1.2f * 1.3e-3f * WindSpeed * WindVelocityXY[1]
    };

    auto SolveFaceVelocity = [&](float U0, float Vt, float EL, float ER, float BL, float BR,
                                 float HL, float CL, float HR, float CR,
                                 float OvL, float OvR, float SL, float SR, float TauW) noexcept -> float
    {
        // Exact lake-at-rest guard: if neither cell can overtop the shared bed sill, zero hydrostatic acceleration!
        const float Sill   = std::max(BL, BR);
        const float HfTest = std::max(std::max(0.0f, BL + HL - Sill), std::max(0.0f, BR + HR - Sill));
        if (HfTest <= Config_.DryThresholdMetres)
        {
            return 0.0f;
        }

        float U   = U0 - (Config_.GravityMps2 * Dt * Inv) * (ER - EL);
        const bool Fwd = (U >= 0.0f);
        const float HD = Fwd ? HL : HR;
        const float BD = Fwd ? BL : BR;
        const float Hf = ClampF(BD + HD - Sill, 0.0f, HD);
        if (Hf <= Config_.DryThresholdMetres)
        {
            return 0.0f;
        }

        U += Dt * TauW / (1000.0f * std::max(Hf, 0.05f));

        // Submerged wheel/hull no-slip momentum drag.
        const float SMax = std::max(SL, SR);
        if (SMax > 0.0f)
        {
            float Vo = OvR;
            if (SL > 0.0f && SR > 0.0f) Vo = 0.5f * (OvL + OvR);
            else if (SL > 0.0f)         Vo = OvL;
            const float Frac = ClampF(SMax / (Hf + SMax), 0.0f, 1.0f);
            U += (Vo - U) * Frac * (1.0f - std::exp(-Config_.ObjectCouplingRatePerS * Dt));
        }

        const float Hm      = std::max(Hf, 0.004f);
        const float MudConc = ClampF(Fwd ? CL : CR, 0.0f, 1.0f);
        const float Speed   = std::sqrt(U * U + Vt * Vt) + 1.0e-5f;
        const float MannN   = Config_.ClearWaterManning + (Config_.MudManning - Config_.ClearWaterManning) * MudConc;
        U /= (1.0f + Dt * Config_.GravityMps2 * MannN * MannN * Speed / std::pow(Hm, 4.0f / 3.0f));

        // O'Brien & Julien Bingham-plastic mud rheology: exponential viscous + yield stress arrest!
        if (MudConc > 0.002f)
        {
            const float Cv   = MudConc * Config_.MaxVolumetricSediment;
            const float Rho  = 1000.0f + (Config_.SedimentDensityKgPerM3 - 1000.0f) * Cv;
            const float Mu   = Config_.MudViscosityCoeffPaSec * (std::exp(Config_.MudViscosityExponent * Cv) - 1.0f);
            const float TauY = Config_.MudYieldStressCoeffPa * (std::exp(Config_.MudYieldStressExponent * Cv) - 1.0f);
            U /= (1.0f + Dt * 3.0f * Mu / (Rho * Hm * Hm));
            const float SpPost = std::sqrt(U * U + Vt * Vt) + 1.0e-5f;
            U *= std::max(0.0f, 1.0f - Dt * TauY / (Rho * Hm * SpPost));
        }

        return ClampF(U, -Config_.MaximumVelocityMps, Config_.MaximumVelocityMps);
    };

    for (std::int32_t J = 0; J < Ny; ++J)
    {
        for (std::int32_t I = 0; I < Nx; ++I)
        {
            const std::size_t K   = CellIdx(I, J);
            const float       BC  = Bed_[K];
            const float       HC  = DepthMud_[K * 2u + 0u];
            const float       CC  = DepthMud_[K * 2u + 1u];
            const auto        OC  = EvalObjHead(K, BC, HC);
            const float       EC  = BC + HC + OC[0] * OC[1];
            const float       OvX = ObjectVelUV_[K * 2u + 0u];
            const float       OvY = ObjectVelUV_[K * 2u + 1u];
            float             Vx  = 0.0f;
            float             Vy  = 0.0f;

            if (I < Nx - 1)
            {
                const std::size_t KR = K + 1u;
                const float BR = Bed_[KR], HR = DepthMud_[KR * 2u + 0u], CR = DepthMud_[KR * 2u + 1u];
                const auto  OR = EvalObjHead(KR, BR, HR);
                const float ER = BR + HR + OR[0] * OR[1];
                const float Vt = 0.25f * (VAt(I, J) + VAt(I + 1, J) + VAt(I, J - 1) + VAt(I + 1, J - 1));
                Vx = SolveFaceVelocity(VelocityUV_[K * 2u + 0u], Vt, EC, ER, BC, BR, HC, CC, HR, CR,
                                       OvX, ObjectVelUV_[KR * 2u + 0u], OC[0], OR[0], WindShearPa[0]);
            }

            if (J < Ny - 1)
            {
                const std::size_t KN = K + static_cast<std::size_t>(Nx);
                const float BN = Bed_[KN], HN = DepthMud_[KN * 2u + 0u], CN = DepthMud_[KN * 2u + 1u];
                const auto  ON = EvalObjHead(KN, BN, HN);
                const float EN = BN + HN + ON[0] * ON[1];
                const float Ut = 0.25f * (UAt(I, J) + UAt(I - 1, J) + UAt(I, J + 1) + UAt(I - 1, J + 1));
                Vy = SolveFaceVelocity(VelocityUV_[K * 2u + 1u], Ut, EC, EN, BC, BN, HC, CC, HN, CN,
                                       OvY, ObjectVelUV_[KN * 2u + 1u], OC[0], ON[0], WindShearPa[1]);
            }

            VelocityScratch_[K * 2u + 0u] = Vx;
            VelocityScratch_[K * 2u + 1u] = Vy;
        }
    }
    VelocityUV_.swap(VelocityScratch_);

    // 3. Positivity-preserving outflow limiter (exact non-negativity + machine-precision volume conservation!).
    for (std::int32_t J = 0; J < Ny; ++J)
    {
        for (std::int32_t I = 0; I < Nx; ++I)
        {
            const float OutSum = std::max(UAt(I, J), 0.0f) + std::max(-UAt(I - 1, J), 0.0f) +
                                 std::max(VAt(I, J), 0.0f) + std::max(-VAt(I, J - 1), 0.0f);
            OutflowLimiter_[CellIdx(I, J)] = std::min(1.0f, Dx / (Dt * OutSum + 1.0e-9f));
        }
    }

    // 4. Finite-volume depth & sediment update (with optional 2nd-order Audusse-Minmod hydrostatic reconstruction!).
    auto EvalMassAndMudFluxX = [&](std::int32_t I, std::int32_t J) noexcept -> std::array<float, 2>
    {
        const std::size_t KL = CellIdx(I, J);
        const std::size_t KR = KL + 1u;
        const float       U  = VelocityUV_[KL * 2u + 0u];
        if (U == 0.0f) return { 0.0f, 0.0f };

        if (Config_.SecondOrderHydrostatic && I > 0 && I < Nx - 2)
        {
            const std::size_t KLL = ClampIdx(I - 1, J);
            const std::size_t KRR = ClampIdx(I + 2, J);
            const float EtaLL = Bed_[KLL] + DepthMud_[KLL * 2u], EtaL = Bed_[KL] + DepthMud_[KL * 2u];
            const float EtaR  = Bed_[KR]  + DepthMud_[KR * 2u],  EtaRR = Bed_[KRR] + DepthMud_[KRR * 2u];
            const float EtaFaceL = EtaL + 0.5f * MinmodSlope(EtaL - EtaLL, EtaR - EtaL);
            const float EtaFaceR = EtaR - 0.5f * MinmodSlope(EtaR - EtaL, EtaRR - EtaR);
            const float BFaceL   = EtaFaceL - DepthMud_[KL * 2u];
            const float BFaceR   = EtaFaceR - DepthMud_[KR * 2u];
            const float BSill    = std::max(BFaceL, BFaceR);
            if (U > 0.0f)
            {
                const float Hf = ClampF(EtaFaceL - BSill, 0.0f, DepthMud_[KL * 2u]);
                const float Q  = U * Hf * OutflowLimiter_[KL];
                return { Q, Q * DepthMud_[KL * 2u + 1u] };
            }
            const float Hf = ClampF(EtaFaceR - BSill, 0.0f, DepthMud_[KR * 2u]);
            const float Q  = U * Hf * OutflowLimiter_[KR];
            return { Q, Q * DepthMud_[KR * 2u + 1u] };
        }

        const std::size_t KD = (U > 0.0f) ? KL : KR;
        const float       HD = DepthMud_[KD * 2u + 0u];
        const float       Hf = ClampF(Bed_[KD] + HD - std::max(Bed_[KL], Bed_[KR]), 0.0f, HD);
        const float       Q  = U * Hf * OutflowLimiter_[KD];
        return { Q, Q * DepthMud_[KD * 2u + 1u] };
    };

    auto EvalMassAndMudFluxY = [&](std::int32_t I, std::int32_t J) noexcept -> std::array<float, 2>
    {
        const std::size_t KS = CellIdx(I, J);
        const std::size_t KN = KS + static_cast<std::size_t>(Nx);
        const float       V  = VelocityUV_[KS * 2u + 1u];
        if (V == 0.0f) return { 0.0f, 0.0f };

        if (Config_.SecondOrderHydrostatic && J > 0 && J < Ny - 2)
        {
            const std::size_t KSS = ClampIdx(I, J - 1);
            const std::size_t KNN = ClampIdx(I, J + 2);
            const float EtaSS = Bed_[KSS] + DepthMud_[KSS * 2u], EtaS = Bed_[KS] + DepthMud_[KS * 2u];
            const float EtaN  = Bed_[KN]  + DepthMud_[KN * 2u],  EtaNN = Bed_[KNN] + DepthMud_[KNN * 2u];
            const float EtaFaceS = EtaS + 0.5f * MinmodSlope(EtaS - EtaSS, EtaN - EtaS);
            const float EtaFaceN = EtaN - 0.5f * MinmodSlope(EtaN - EtaS, EtaNN - EtaN);
            const float BFaceS   = EtaFaceS - DepthMud_[KS * 2u];
            const float BFaceN   = EtaFaceN - DepthMud_[KN * 2u];
            const float BSill    = std::max(BFaceS, BFaceN);
            if (V > 0.0f)
            {
                const float Hf = ClampF(EtaFaceS - BSill, 0.0f, DepthMud_[KS * 2u]);
                const float Q  = V * Hf * OutflowLimiter_[KS];
                return { Q, Q * DepthMud_[KS * 2u + 1u] };
            }
            const float Hf = ClampF(EtaFaceN - BSill, 0.0f, DepthMud_[KN * 2u]);
            const float Q  = V * Hf * OutflowLimiter_[KN];
            return { Q, Q * DepthMud_[KN * 2u + 1u] };
        }

        const std::size_t KD = (V > 0.0f) ? KS : KN;
        const float       HD = DepthMud_[KD * 2u + 0u];
        const float       Hf = ClampF(Bed_[KD] + HD - std::max(Bed_[KS], Bed_[KN]), 0.0f, HD);
        const float       Q  = V * Hf * OutflowLimiter_[KD];
        return { Q, Q * DepthMud_[KD * 2u + 1u] };
    };

    const float Sc = Dt * Inv;
    for (std::int32_t J = 0; J < Ny; ++J)
    {
        const float Wy = Config_.WorldOriginXY[1] + (static_cast<float>(J) + 0.5f) * Dx;
        for (std::int32_t I = 0; I < Nx; ++I)
        {
            const float Wx = Config_.WorldOriginXY[0] + (static_cast<float>(I) + 0.5f) * Dx;
            const std::size_t K  = CellIdx(I, J);
            const float       H0 = DepthMud_[K * 2u + 0u];
            const float       C0 = DepthMud_[K * 2u + 1u];

            const auto FE = (I < Nx - 1) ? EvalMassAndMudFluxX(I, J)     : std::array<float, 2>{ 0.0f, 0.0f };
            const auto FW = (I > 0)      ? EvalMassAndMudFluxX(I - 1, J) : std::array<float, 2>{ 0.0f, 0.0f };
            const auto FN = (J < Ny - 1) ? EvalMassAndMudFluxY(I, J)     : std::array<float, 2>{ 0.0f, 0.0f };
            const auto FS = (J > 0)      ? EvalMassAndMudFluxY(I, J - 1) : std::array<float, 2>{ 0.0f, 0.0f };

            float H  = H0 - Sc * (FE[0] - FW[0] + FN[0] - FS[0]);
            float CH = H0 * C0 - Sc * (FE[1] - FW[1] + FN[1] - FS[1]);

            // Conservative wet-neighbour sediment diffusion.
            if (Config_.MudDiffusionM2ps > 0.0f && H0 > Config_.DryThresholdMetres)
            {
                auto MudDiff = [&](std::size_t KN) noexcept -> float
                {
                    return (DepthMud_[KN * 2u + 1u] - C0) * std::min(H0, DepthMud_[KN * 2u + 0u]);
                };
                float Acc = 0.0f;
                if (I < Nx - 1) Acc += MudDiff(K + 1u);
                if (I > 0)      Acc += MudDiff(K - 1u);
                if (J < Ny - 1) Acc += MudDiff(K + static_cast<std::size_t>(Nx));
                if (J > 0)      Acc += MudDiff(K - static_cast<std::size_t>(Nx));
                CH += std::min(Config_.MudDiffusionM2ps * Dt / (Dx * Dx), 0.2f) * Acc;
            }

            // Thin-film porous drainage (damp asphalt dries while deeper puddles remain!).
            if (H < Config_.ThinFilmDrainDepthM && H > 0.0f && Config_.InfiltrationRateMps > 0.0f)
            {
                const float Drain = std::min(H, Config_.InfiltrationRateMps * Dt);
                CH -= Drain * ClampF(CH / std::max(H, 1.0e-7f), 0.0f, 1.0f);
                H  -= Drain;
            }

            // Volumetric inflow / drain sources.
            for (const FluidDischargeSource& Src : Sources_)
            {
                const float DistSq = (Wx - Src.WorldCenterXY[0]) * (Wx - Src.WorldCenterXY[0]) +
                                     (Wy - Src.WorldCenterXY[1]) * (Wy - Src.WorldCenterXY[1]);
                const float Area   = std::max(PiScalar * Src.RadiusMetres * Src.RadiusMetres, Dx * Dx);
                if (DistSq < Src.RadiusMetres * Src.RadiusMetres)
                {
                    const float Dv = (Src.VolumetricFlowM3PerSec / Area) * Dt;
                    if (Dv >= 0.0f)
                    {
                        H  += Dv;
                        CH += Dv * ClampF(Src.SedimentConcentration, 0.0f, 1.0f);
                    }
                    else
                    {
                        const float Rm = std::min(H, -Dv);
                        CH -= Rm * ClampF(CH / std::max(H, 1.0e-6f), 0.0f, 1.0f);
                        H  -= Rm;
                    }
                }
            }

            H  = std::max(0.0f, H);
            CH = std::max(0.0f, CH);
            const float C = (H > 1.0e-5f) ? ClampF(CH / H, 0.0f, 1.0f) : C0;
            DepthMudScratch_[K * 2u + 0u] = H;
            DepthMudScratch_[K * 2u + 1u] = C;
        }
    }
    DepthMud_.swap(DepthMudScratch_);
}

ShallowWaterDiagnostics ShallowWaterSimulation::StepSimulation(
    float                StepSeconds,
    std::array<float, 2> WindVelocityTenMetresXY)
{
    if (StepSeconds <= 0.0f)
    {
        return Diagnostics_;
    }

    // Automatic wave-celerity + flow CFL substepping: dt_sub <= 0.42 * dx / max(sqrt(g*h_max) + |u_max|, 0.5)
    float MaxDepth = 0.01f;
    float MaxSpeed = 0.25f;
    const std::size_t Total = Bed_.size();
    for (std::size_t K = 0u; K < Total; ++K)
    {
        MaxDepth = std::max(MaxDepth, DepthMud_[K * 2u + 0u]);
        MaxSpeed = std::max(MaxSpeed, std::hypot(VelocityUV_[K * 2u + 0u], VelocityUV_[K * 2u + 1u]));
    }
    const float WaveSpeed  = std::sqrt(Config_.GravityMps2 * MaxDepth) + MaxSpeed;
    const float MaxSafeDt  = 0.42f * Config_.CellSizeMetres / std::max(WaveSpeed, 0.5f);
    const std::uint32_t Substeps = std::clamp(static_cast<std::uint32_t>(std::ceil(StepSeconds / MaxSafeDt)), 1u, 24u);
    const float SubDt      = StepSeconds / static_cast<float>(Substeps);

    for (std::uint32_t S = 0u; S < Substeps; ++S)
    {
        ExecuteSingleCflSubstep(SubDt, WindVelocityTenMetresXY);
        ElapsedSeconds_ += SubDt;
    }

    // Populate conservation & peak diagnostics.
    Diagnostics_                  = {};
    Diagnostics_.SubstepsExecuted = Substeps;
    const double CellArea         = static_cast<double>(Config_.CellSizeMetres) * static_cast<double>(Config_.CellSizeMetres);
    for (std::size_t K = 0u; K < Total; ++K)
    {
        const float H = DepthMud_[K * 2u + 0u];
        const float C = DepthMud_[K * 2u + 1u];
        Diagnostics_.TotalLiquidVolumeCubicM += static_cast<double>(H) * CellArea;
        Diagnostics_.TotalSedimentVolumeM3   += static_cast<double>(H * C) * CellArea;
        Diagnostics_.PeakFluidDepthMetres     = std::max(Diagnostics_.PeakFluidDepthMetres, H);
        Diagnostics_.PeakFlowSpeedMps         = std::max(Diagnostics_.PeakFlowSpeedMps,
                                                         std::hypot(VelocityUV_[K * 2u + 0u], VelocityUV_[K * 2u + 1u]));
        if (H > Config_.DryThresholdMetres)
        {
            ++Diagnostics_.WettedCellCount;
        }
    }

    return Diagnostics_;
}

//------------------------------------------------------------------------------------------------------------------------
//                              SURFACE OPTICS SAMPLING & TWO-WAY VEHICLE COUPLING
//------------------------------------------------------------------------------------------------------------------------

SurfaceFluidSample ShallowWaterSimulation::SampleSurface(std::array<float, 2> WorldXY) const noexcept
{
    SurfaceFluidSample Out{};
    const float Lx = WorldXY[0] - Config_.WorldOriginXY[0];
    const float Ly = WorldXY[1] - Config_.WorldOriginXY[1];
    const float SpanX = static_cast<float>(Config_.CellsX) * Config_.CellSizeMetres;
    const float SpanY = static_cast<float>(Config_.CellsY) * Config_.CellSizeMetres;

    if (Lx < 0.0f || Ly < 0.0f || Lx >= SpanX || Ly >= SpanY)
    {
        Out.NestedCrossFadeAlpha = 0.0f;
        return Out;
    }

    // 71ce888b smooth cross-fade weight across the outer HoleCrossFadeMetres rim!
    const float EdgeDist = std::min({ Lx, SpanX - Lx, Ly, SpanY - Ly });
    Out.NestedCrossFadeAlpha = (Config_.HoleCrossFadeMetres > 1.0e-3f)
        ? ClampF(EdgeDist / Config_.HoleCrossFadeMetres, 0.0f, 1.0f)
        : 1.0f;

    const float Gx = ClampF(Lx / Config_.CellSizeMetres - 0.5f, 0.0f, static_cast<float>(Config_.CellsX - 1u) - 1.0e-5f);
    const float Gy = ClampF(Ly / Config_.CellSizeMetres - 0.5f, 0.0f, static_cast<float>(Config_.CellsY - 1u) - 1.0e-5f);
    const std::uint32_t I0 = static_cast<std::uint32_t>(Gx);
    const std::uint32_t J0 = static_cast<std::uint32_t>(Gy);
    const std::uint32_t I1 = std::min(I0 + 1u, Config_.CellsX - 1u);
    const std::uint32_t J1 = std::min(J0 + 1u, Config_.CellsY - 1u);
    const float Fx = Gx - static_cast<float>(I0);
    const float Fy = Gy - static_cast<float>(J0);

    auto CellK = [&](std::uint32_t I, std::uint32_t J) noexcept -> std::size_t
    {
        return static_cast<std::size_t>(J) * Config_.CellsX + I;
    };
    const std::size_t K00 = CellK(I0, J0), K10 = CellK(I1, J0), K01 = CellK(I0, J1), K11 = CellK(I1, J1);
    auto Bilerp = [&](float A00, float A10, float A01, float A11) noexcept -> float
    {
        const float R0 = A00 + (A10 - A00) * Fx;
        const float R1 = A01 + (A11 - A01) * Fx;
        return R0 + (R1 - R0) * Fy;
    };

    Out.BedElevationMetres    = Bilerp(Bed_[K00], Bed_[K10], Bed_[K01], Bed_[K11]);
    Out.FluidDepthMetres      = Bilerp(DepthMud_[K00 * 2u], DepthMud_[K10 * 2u], DepthMud_[K01 * 2u], DepthMud_[K11 * 2u]);
    Out.FreeSurfaceElevationM = Out.BedElevationMetres + Out.FluidDepthMetres;
    Out.MudConcentration      = Bilerp(DepthMud_[K00 * 2u + 1u], DepthMud_[K10 * 2u + 1u], DepthMud_[K01 * 2u + 1u], DepthMud_[K11 * 2u + 1u]);
    Out.VelocityXY[0]         = Bilerp(VelocityUV_[K00 * 2u], VelocityUV_[K10 * 2u], VelocityUV_[K01 * 2u], VelocityUV_[K11 * 2u]);
    Out.VelocityXY[1]         = Bilerp(VelocityUV_[K00 * 2u + 1u], VelocityUV_[K10 * 2u + 1u], VelocityUV_[K01 * 2u + 1u], VelocityUV_[K11 * 2u + 1u]);

    // Bilinearly interpolated wet-domain free-surface gradient (zero dry-bank slope leakage, zero integer-cell normal squares)!
    const float Inv2Dx = 0.5f / Config_.CellSizeMetres;
    auto CornerSlope = [&](std::uint32_t Ci, std::uint32_t Cj, float& OutGx, float& OutGy) noexcept
    {
        const std::size_t Kc = CellK(Ci, Cj);
        const float       Hc = DepthMud_[Kc * 2u];
        if (Hc <= Config_.DryThresholdMetres)
        {
            OutGx = 0.0f;
            OutGy = 0.0f;
            return;
        }
        const float         EtaC = Bed_[Kc] + Hc;
        const std::uint32_t Im   = (Ci > 0u) ? (Ci - 1u) : 0u;
        const std::uint32_t Ip   = std::min(Ci + 1u, Config_.CellsX - 1u);
        const std::uint32_t Jm   = (Cj > 0u) ? (Cj - 1u) : 0u;
        const std::uint32_t Jp   = std::min(Cj + 1u, Config_.CellsY - 1u);

        auto WetEta = [&](std::uint32_t Ni, std::uint32_t Nj) noexcept -> float
        {
            const std::size_t Kn = CellK(Ni, Nj);
            return (DepthMud_[Kn * 2u] > Config_.DryThresholdMetres) ? (Bed_[Kn] + DepthMud_[Kn * 2u]) : EtaC;
        };
        OutGx = (WetEta(Ip, Cj) - WetEta(Im, Cj)) * Inv2Dx;
        OutGy = (WetEta(Ci, Jp) - WetEta(Ci, Jm)) * Inv2Dx;
    };

    float Gx00 = 0.0f, Gy00 = 0.0f, Gx10 = 0.0f, Gy10 = 0.0f;
    float Gx01 = 0.0f, Gy01 = 0.0f, Gx11 = 0.0f, Gy11 = 0.0f;
    CornerSlope(I0, J0, Gx00, Gy00);
    CornerSlope(I1, J0, Gx10, Gy10);
    CornerSlope(I0, J1, Gx01, Gy01);
    CornerSlope(I1, J1, Gx11, Gy11);

    const float WetFeather = ClampF((Out.FluidDepthMetres - Config_.DryThresholdMetres) / 0.008f, 0.0f, 1.0f);
    const float DetaDx     = Bilerp(Gx00, Gx10, Gx01, Gx11) * WetFeather;
    const float DetaDy     = Bilerp(Gy00, Gy10, Gy01, Gy11) * WetFeather;
    const float NLen       = std::sqrt(DetaDx * DetaDx + DetaDy * DetaDy + 1.0f);
    Out.SurfaceNormal      = { -DetaDx / NLen, -DetaDy / NLen, 1.0f / NLen };
    return Out;
}

WheelFluidInteraction ShallowWaterSimulation::CoupleWheelContact(
    std::array<float, 3> WheelContactWorld,
    std::array<float, 3> WheelVelocityWorld,
    float                WheelRadiusMetres,
    float                TyreWidthMetres,
    float                YawRadians)
{
    WheelFluidInteraction Out{};
    const SurfaceFluidSample Surf = SampleSurface({ WheelContactWorld[0], WheelContactWorld[1] });
    if (Surf.FluidDepthMetres <= Config_.DryThresholdMetres)
    {
        return Out;
    }

    const float SubmergenceM = ClampF(Surf.FreeSurfaceElevationM - WheelContactWorld[2], 0.0f, 2.0f * WheelRadiusMetres);
    Out.StandingWaterMillimetres = SubmergenceM * (1.0f - 0.65f * Surf.MudConcentration) * 1000.0f;
    Out.MudConcentration         = Surf.MudConcentration;

    // Stamp tyre contact displacement & velocity into the SWE/mud grid so wakes & mud ruts form naturally!
    if (SubmergenceM > 0.001f)
    {
        SubmergedSolidStamp WheelStamp{};
        WheelStamp.Centre        = { WheelContactWorld[0], WheelContactWorld[1], WheelContactWorld[2] + 0.5f * SubmergenceM };
        WheelStamp.HalfExtents   = { 0.45f * WheelRadiusMetres, 0.55f * TyreWidthMetres, 0.5f * SubmergenceM + 0.04f };
        WheelStamp.HorizontalVel = { WheelVelocityWorld[0], WheelVelocityWorld[1] };
        WheelStamp.YawRadians    = YawRadians;
        WheelStamp.LidStiffness  = 1.0f;
        RegisterSubmergedSolid(WheelStamp);

        const float Cv          = Surf.MudConcentration * Config_.MaxVolumetricSediment;
        const float FluidRho    = 1000.0f + (Config_.SedimentDensityKgPerM3 - 1000.0f) * Cv;
        const float FrontalArea = TyreWidthMetres * std::min(SubmergenceM, WheelRadiusMetres);
        const float RelVx       = WheelVelocityWorld[0] - Surf.VelocityXY[0];
        const float RelVy       = WheelVelocityWorld[1] - Surf.VelocityXY[1];
        const float RelSpeed    = std::hypot(RelVx, RelVy);

        // Hydrodynamic form drag (0.5 * rho * Cd * A * |v_rel| * v_rel) + Bingham mud viscous/yield ploughing resistance!
        const float MudYieldPa  = (Surf.MudConcentration > 0.005f)
            ? Config_.MudYieldStressCoeffPa * (std::exp(Config_.MudYieldStressExponent * Cv) - 1.0f)
            : 0.0f;
        const float MudViscPaS  = (Surf.MudConcentration > 0.005f)
            ? Config_.MudViscosityCoeffPaSec * (std::exp(Config_.MudViscosityExponent * Cv) - 1.0f)
            : 0.0f;
        const float DragMag     = 0.5f * FluidRho * 0.85f * FrontalArea * RelSpeed * RelSpeed +
                                  FrontalArea * (2.4f * MudYieldPa + 18.0f * MudViscPaS * RelSpeed);
        if (RelSpeed > 1.0e-4f)
        {
            Out.HydrodynamicDragNewtons[0] = -DragMag * (RelVx / RelSpeed);
            Out.HydrodynamicDragNewtons[1] = -DragMag * (RelVy / RelSpeed);
        }

        // Displaced wheel segment buoyancy.
        const float DisplacedVol = FrontalArea * (0.65f * WheelRadiusMetres);
        Out.BuoyancyLiftNewtons  = FluidRho * Config_.GravityMps2 * DisplacedVol;
    }

    // Wet & Bingham-mud traction scaling (mud lowers dry friction to ~0.36..0.52; clear water film lowers to ~0.82 + Horne).
    const float WetGrip = (Surf.FluidDepthMetres > 0.001f) ? 0.84f : 1.0f;
    const float MudGrip = 1.0f - 0.58f * Surf.MudConcentration;
    Out.TractionMultiplier = ClampF(WetGrip * MudGrip, 0.22f, 1.0f);
    return Out;
}

std::array<float, 3> ShallowWaterSimulation::EvaluateHullBuoyancyAndDragForce(
    std::array<float, 3> HullCenterWorld,
    std::array<float, 3> HullHalfExtents,
    std::array<float, 3> HullVelocityWorld,
    float                YawRadians)
{
    std::array<float, 3> TotalForce = { 0.0f, 0.0f, 0.0f };
    const float CosYaw  = std::cos(YawRadians);
    const float SinYaw  = std::sin(YawRadians);
    const float ColArea = (2.0f * HullHalfExtents[0] * 2.0f * HullHalfExtents[1]) / 9.0f;

    // 3x3 Gauss-like hull floor probe grid matching 71ce888b Buoyancy.js!
    for (int Py = -1; Py <= 1; ++Py)
    {
        for (int Px = -1; Px <= 1; ++Px)
        {
            const float Lx = static_cast<float>(Px) * 0.65f * HullHalfExtents[0];
            const float Ly = static_cast<float>(Py) * 0.65f * HullHalfExtents[1];
            const float Wx = HullCenterWorld[0] + Lx * CosYaw - Ly * SinYaw;
            const float Wy = HullCenterWorld[1] + Lx * SinYaw + Ly * CosYaw;
            const auto  S  = SampleSurface({ Wx, Wy });
            const float HullBot = HullCenterWorld[2] - HullHalfExtents[2];
            const float Sub     = ClampF(S.FreeSurfaceElevationM - HullBot, 0.0f, 2.0f * HullHalfExtents[2]);
            if (Sub > 0.002f)
            {
                const float Cv   = S.MudConcentration * Config_.MaxVolumetricSediment;
                const float Rho  = 1000.0f + (Config_.SedimentDensityKgPerM3 - 1000.0f) * Cv;
                const float Lift = Rho * Config_.GravityMps2 * (ColArea * Sub);
                TotalForce[2]   += Lift - 0.18f * Rho * ColArea * HullVelocityWorld[2] * std::abs(HullVelocityWorld[2]);

                const float RelX = HullVelocityWorld[0] - S.VelocityXY[0];
                const float RelY = HullVelocityWorld[1] - S.VelocityXY[1];
                const float Spd  = std::hypot(RelX, RelY);
                TotalForce[0]   -= 0.5f * Rho * 0.55f * (ColArea * 0.35f) * Spd * RelX;
                TotalForce[1]   -= 0.5f * Rho * 0.55f * (ColArea * 0.35f) * Spd * RelY;
            }
        }
    }
    return TotalForce;
}

void ShallowWaterSimulation::OverwriteCellDepthAndMud(
    std::uint32_t CellX,
    std::uint32_t CellY,
    float         DepthM,
    float         MudConc) noexcept
{
    if (CellX < Config_.CellsX && CellY < Config_.CellsY)
    {
        const std::size_t K = static_cast<std::size_t>(CellY) * Config_.CellsX + CellX;
        DepthMud_[K * 2u + 0u] = std::max(0.0f, DepthM);
        DepthMud_[K * 2u + 1u] = ClampF(MudConc, 0.0f, 1.0f);
    }
}

void ShallowWaterSimulation::OverwriteCellVelocity(
    std::uint32_t CellX,
    std::uint32_t CellY,
    float         VelU,
    float         VelV) noexcept
{
    if (CellX < Config_.CellsX && CellY < Config_.CellsY)
    {
        const std::size_t K = static_cast<std::size_t>(CellY) * Config_.CellsX + CellX;
        VelocityUV_[K * 2u + 0u] = VelU;
        VelocityUV_[K * 2u + 1u] = VelV;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                      TWO-WAY COARSE <-> FINE NESTED DOMAIN LINK (71ce888b + SEAM CROSS-FADE)
//------------------------------------------------------------------------------------------------------------------------

void NestedWaterDomainLink::SynchronizeCoarseToFineRim(
    const ShallowWaterSimulation& CoarseDomain,
    ShallowWaterSimulation&       FineDomain,
    std::uint32_t                   RimCells) noexcept
{
    const auto& FineCfg = FineDomain.Configuration();
    for (std::uint32_t J = 0u; J < FineCfg.CellsY; ++J)
    {
        for (std::uint32_t I = 0u; I < FineCfg.CellsX; ++I)
        {
            const bool OnRim = (I < RimCells) || (I + RimCells >= FineCfg.CellsX) ||
                               (J < RimCells) || (J + RimCells >= FineCfg.CellsY);
            if (!OnRim)
            {
                continue;
            }
            const float Wx = FineCfg.WorldOriginXY[0] + (static_cast<float>(I) + 0.5f) * FineCfg.CellSizeMetres;
            const float Wy = FineCfg.WorldOriginXY[1] + (static_cast<float>(J) + 0.5f) * FineCfg.CellSizeMetres;
            const SurfaceFluidSample CoarseS = CoarseDomain.SampleSurface({ Wx, Wy });
            const float FineBed = FineDomain.BedElevationData()[static_cast<std::size_t>(J) * FineCfg.CellsX + I];
            const float TargetH = (CoarseS.FluidDepthMetres > CoarseDomain.Configuration().DryThresholdMetres)
                ? std::max(0.0f, CoarseS.FreeSurfaceElevationM - FineBed)
                : 0.0f;
            FineDomain.OverwriteCellDepthAndMud(I, J, TargetH, CoarseS.MudConcentration);
            FineDomain.OverwriteCellVelocity(I, J, CoarseS.VelocityXY[0], CoarseS.VelocityXY[1]);
        }
    }
}

void NestedWaterDomainLink::RestrictFineInteriorToCoarse(
    const ShallowWaterSimulation& FineDomain,
    ShallowWaterSimulation&       CoarseDomain,
    std::uint32_t                   InteriorMarginCells) noexcept
{
    const auto& CoarseCfg = CoarseDomain.Configuration();
    const auto& FineCfg   = FineDomain.Configuration();
    const float FineMinX  = FineCfg.WorldOriginXY[0] + static_cast<float>(InteriorMarginCells) * FineCfg.CellSizeMetres;
    const float FineMaxX  = FineCfg.WorldOriginXY[0] + static_cast<float>(FineCfg.CellsX - InteriorMarginCells) * FineCfg.CellSizeMetres;
    const float FineMinY  = FineCfg.WorldOriginXY[1] + static_cast<float>(InteriorMarginCells) * FineCfg.CellSizeMetres;
    const float FineMaxY  = FineCfg.WorldOriginXY[1] + static_cast<float>(FineCfg.CellsY - InteriorMarginCells) * FineCfg.CellSizeMetres;

    for (std::uint32_t J = 0u; J < CoarseCfg.CellsY; ++J)
    {
        const float Wy = CoarseCfg.WorldOriginXY[1] + (static_cast<float>(J) + 0.5f) * CoarseCfg.CellSizeMetres;
        if (Wy < FineMinY || Wy > FineMaxY) continue;
        for (std::uint32_t I = 0u; I < CoarseCfg.CellsX; ++I)
        {
            const float Wx = CoarseCfg.WorldOriginXY[0] + (static_cast<float>(I) + 0.5f) * CoarseCfg.CellSizeMetres;
            if (Wx < FineMinX || Wx > FineMaxX) continue;
            const SurfaceFluidSample FineS = FineDomain.SampleSurface({ Wx, Wy });
            const float CoarseBed = CoarseDomain.BedElevationData()[static_cast<std::size_t>(J) * CoarseCfg.CellsX + I];
            const float TargetH   = (FineS.FluidDepthMetres > FineCfg.DryThresholdMetres)
                ? std::max(0.0f, FineS.FreeSurfaceElevationM - CoarseBed)
                : 0.0f;
            CoarseDomain.OverwriteCellDepthAndMud(I, J, TargetH, FineS.MudConcentration);
            CoarseDomain.OverwriteCellVelocity(I, J, FineS.VelocityXY[0], FineS.VelocityXY[1]);
        }
    }
}

SurfaceFluidSample NestedWaterDomainLink::SampleNestedCompositeSurface(
    const ShallowWaterSimulation& CoarseDomain,
    const ShallowWaterSimulation& FineDomain,
    std::array<float, 2>            WorldXY) noexcept
{
    const SurfaceFluidSample CoarseS = CoarseDomain.SampleSurface(WorldXY);
    const SurfaceFluidSample FineS   = FineDomain.SampleSurface(WorldXY);
    const float              Alpha   = FineS.NestedCrossFadeAlpha;
    if (Alpha <= 0.0f)
    {
        return CoarseS;
    }
    if (Alpha >= 1.0f)
    {
        return FineS;
    }

    // Smoothly cross-fade fine inner layer into coarse outer sea/field over HoleCrossFadeMetres (71ce888b!).
    SurfaceFluidSample Blended{};
    Blended.BedElevationMetres    = CoarseS.BedElevationMetres + (FineS.BedElevationMetres - CoarseS.BedElevationMetres) * Alpha;
    Blended.FluidDepthMetres      = CoarseS.FluidDepthMetres   + (FineS.FluidDepthMetres   - CoarseS.FluidDepthMetres)   * Alpha;
    Blended.FreeSurfaceElevationM = Blended.BedElevationMetres + Blended.FluidDepthMetres;
    Blended.MudConcentration      = CoarseS.MudConcentration   + (FineS.MudConcentration   - CoarseS.MudConcentration)   * Alpha;
    Blended.VelocityXY[0]         = CoarseS.VelocityXY[0]      + (FineS.VelocityXY[0]      - CoarseS.VelocityXY[0])      * Alpha;
    Blended.VelocityXY[1]         = CoarseS.VelocityXY[1]      + (FineS.VelocityXY[1]      - CoarseS.VelocityXY[1])      * Alpha;
    for (int C = 0; C < 3; ++C)
    {
        Blended.SurfaceNormal[C] = CoarseS.SurfaceNormal[C] + (FineS.SurfaceNormal[C] - CoarseS.SurfaceNormal[C]) * Alpha;
    }
    const float NLen = std::max(1.0e-5f, std::sqrt(Blended.SurfaceNormal[0] * Blended.SurfaceNormal[0] +
                                                   Blended.SurfaceNormal[1] * Blended.SurfaceNormal[1] +
                                                   Blended.SurfaceNormal[2] * Blended.SurfaceNormal[2]));
    Blended.SurfaceNormal[0] /= NLen;
    Blended.SurfaceNormal[1] /= NLen;
    Blended.SurfaceNormal[2] /= NLen;
    Blended.NestedCrossFadeAlpha = Alpha;
    return Blended;
}

} // namespace Frontier
