/*==========================================================================================================================================
                                                  BALLISTICSPARKEXTENSION.CPP
==========================================================================================================================================*/
// 🧩 Swept-collision incandescent metallic sparks with Planckian radiative cooling and dynamic shadowed scene illumination.

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             INCLUDES
------------------------------------------------------------------------------------------------------------------------------------------*/
#include "Engine/Particles/SparkParticles.h"

#include <algorithm>
#include <cmath>

namespace Frontier
{
namespace
{
constexpr float GravityMps2             = 9.80665f;     // [m/s^2] - Standard gravitational acceleration
constexpr float StefanBoltzmannConst    = 5.6703744e-8f;// [W/(m^2*K^4)] - Stefan-Boltzmann constant
constexpr float SteelDensityKgM3        = 7850.0f;      // [kg/m^3] - Carbon-steel grit density
constexpr float SteelSpecificHeatJKgK   = 620.0f;       // [J/(kg*K)] - High-temperature steel specific heat
constexpr float SparkEmissivity         = 0.82f;        // [-] - Oxidizing molten steel emissivity

struct SplitMixSparkRng
{
    uint64_t Seed = 1ull;

    [[nodiscard]] float NextSigned() noexcept
    {
        Seed += 0x9E3779B97F4A7C15ull;
        uint64_t Z = Seed;
        Z          = (Z ^ (Z >> 30u)) * 0xBF58476D1CE4E5B9ull;
        Z          = (Z ^ (Z >> 27u)) * 0x94D049BB133111EBull;
        Z          = Z ^ (Z >> 31u);
        return static_cast<float>(static_cast<double>(Z >> 11u) * (2.0 / 9007199254740992.0) - 1.0);
    }

    [[nodiscard]] float NextUnit() noexcept
    {
        return 0.5f * (NextSigned() + 1.0f);
    }
};

// Exact Kay-Kajiya swept segment [P0, P1] vs inflated OBB intersection.
[[nodiscard]] bool IntersectSegmentInflatedObb(
    Vec3                         P0,
    Vec3                         P1,
    const SparkSceneColliderBox& Box,
    float                        SkinMetres,
    float&                       OutT,
    Vec3&                        OutNormal) noexcept
{
    const Vec3 Ax = Normalise(Box.AxisX);
    const Vec3 Ay = Normalise(Box.AxisY);
    const Vec3 Az = Normalise(Box.AxisZ);

    const Vec3 Rel0 = P0 - Box.CentreWorld;
    const Vec3 Seg  = P1 - P0;

    const float Orig[3] = {Dot(Rel0, Ax), Dot(Rel0, Ay), Dot(Rel0, Az)};
    const float Dir[3]  = {Dot(Seg, Ax), Dot(Seg, Ay), Dot(Seg, Az)};
    const float Ext[3]  = {
        Box.HalfExtents.X + SkinMetres,
        Box.HalfExtents.Y + SkinMetres,
        Box.HalfExtents.Z + SkinMetres};
    const Vec3 Axes[3] = {Ax, Ay, Az};

    float TMin    = 0.0f;
    float TMax    = 1.0f;
    int   HitAxis = -1;
    float HitSign = 1.0f;

    for (int A = 0; A < 3; ++A)
    {
        if (std::abs(Dir[A]) < 1.0e-7f)
        {
            if (std::abs(Orig[A]) > Ext[A])
            {
                return false;
            }
        }
        else
        {
            const float InvD = 1.0f / Dir[A];
            float       T1   = (-Ext[A] - Orig[A]) * InvD;
            float       T2   = (+Ext[A] - Orig[A]) * InvD;
            float       Sgn  = -1.0f;
            if (T1 > T2)
            {
                std::swap(T1, T2);
                Sgn = +1.0f;
            }
            if (T1 > TMin)
            {
                TMin    = T1;
                HitAxis = A;
                HitSign = Sgn;
            }
            TMax = std::min(TMax, T2);
            if (TMin > TMax)
            {
                return false;
            }
        }
    }

    if (HitAxis < 0)
    {
        // Started slightly inside inflated skin: push out along shallowest penetration axis!
        int   BestA   = 0;
        float MinPen  = 1.0e9f;
        float BestSgn = 1.0f;
        for (int A = 0; A < 3; ++A)
        {
            const float PenPos = Ext[A] - Orig[A];
            const float PenNeg = Ext[A] + Orig[A];
            if (PenPos < MinPen)
            {
                MinPen  = PenPos;
                BestA   = A;
                BestSgn = +1.0f;
            }
            if (PenNeg < MinPen)
            {
                MinPen  = PenNeg;
                BestA   = A;
                BestSgn = -1.0f;
            }
        }
        OutT      = 0.0f;
        OutNormal = Axes[BestA] * BestSgn;
        return Dot(Seg, OutNormal) < 0.0f;
    }

    OutT      = std::clamp(TMin, 0.0f, 1.0f);
    OutNormal = Axes[HitAxis] * HitSign;
    return true;
}
} // namespace

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                   LIFECYCLE & SCENE COLLIDERS
------------------------------------------------------------------------------------------------------------------------------------------*/
SparkParticles::SparkParticles(const BallisticSparkConfig& Config)
{
    Reconfigure(Config);
}

void SparkParticles::Reconfigure(const BallisticSparkConfig& Config)
{
    Config_                = Config;
    Config_.MaxSparkBudget = std::max(16u, Config.MaxSparkBudget);
    Pool_.assign(Config_.MaxSparkBudget, BallisticSparkRecord{});
    RingCursor_ = 0u;
    Telemetry_  = {};
}

void SparkParticles::ClearSceneColliders() noexcept
{
    Colliders_.clear();
}

void SparkParticles::RegisterSceneCollider(const SparkSceneColliderBox& Box)
{
    Colliders_.push_back(Box);
}

void SparkParticles::AllocateSparkSlot(const BallisticSparkRecord& Candidate) noexcept
{
    if (Pool_.empty())
    {
        return;
    }
    Pool_[RingCursor_] = Candidate;
    Pool_[RingCursor_].Active = true;
    RingCursor_ = (RingCursor_ + 1u) % Pool_.size();
    ++Telemetry_.CumulativeSpawns;
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                  SCRAPE SPAWNING & SWEPT STEP
------------------------------------------------------------------------------------------------------------------------------------------*/
void SparkParticles::SpawnScrapeSparks(const MetallicScrapeContact& Contact) noexcept
{
    const float Speed = Length(Contact.TangentialVelocityMps);
    if (Speed < 1.2f || Contact.NormalForceNewtons <= 10.0f || Contact.RequestedSparkCount == 0u)
    {
        return;
    }

    const Vec3 Nrm     = (Length(Contact.ContactNormalWorld) > 1.0e-4f)
                             ? Normalise(Contact.ContactNormalWorld)
                             : Vec3{0.0f, 0.0f, 1.0f};
    const Vec3 Tangent = Normalise(Contact.TangentialVelocityMps);
    Vec3       Side    = Cross(Nrm, Tangent);
    Side               = (Length(Side) > 1.0e-4f) ? Normalise(Side) : Vec3{0.0f, 1.0f, 0.0f};

    SplitMixSparkRng Rng{Contact.DeterministicSeed ^ (Telemetry_.CumulativeSpawns * 0x9E3779B97F4A7C15ull + 17ull)};
    const float      LoadFactor = std::clamp(Contact.NormalForceNewtons / 5000.0f, 0.25f, 2.2f);
    const Vec3       SafeOrigin = Contact.ContactPointWorld + Nrm * std::max(0.012f, Config_.CollisionSkinMetres * 2.5f);

    for (uint32_t I = 0u; I < Contact.RequestedSparkCount; ++I)
    {
        const float ConeYaw   = Rng.NextSigned() * 0.34f;
        const float ConePitch = 0.08f + Rng.NextUnit() * 0.38f;
        const Vec3  LaunchDir = Normalise(Tangent + Side * ConeYaw + Nrm * ConePitch);
        const float LaunchSpd = Speed * (0.55f + 0.52f * Rng.NextUnit());

        BallisticSparkRecord Spark{};
        Spark.PositionWorld     = SafeOrigin;
        Spark.TailPositionWorld = SafeOrigin;
        Spark.VelocityMps       = LaunchDir * LaunchSpd;
        Spark.RadiusMetres      = 0.00038f + 0.00085f * Rng.NextUnit() * Rng.NextUnit();
        Spark.TemperatureK      = std::clamp(1920.0f + 520.0f * LoadFactor * Rng.NextUnit() + 14.0f * Speed, 1450.0f, 2850.0f);
        Spark.AgeSeconds        = 0.0f;
        Spark.BounceCount       = 0u;
        Spark.Active            = true;

        if (Spark.PositionWorld.Z < Config_.GroundElevationMetres + Config_.CollisionSkinMetres)
        {
            Spark.PositionWorld.Z     = Config_.GroundElevationMetres + Config_.CollisionSkinMetres * 2.0f;
            Spark.TailPositionWorld.Z = Spark.PositionWorld.Z;
        }
        AllocateSparkSlot(Spark);
    }
}

bool SparkParticles::SweepSegmentAgainstScene(
    Vec3   StartWorld,
    Vec3   EndWorld,
    float& OutHitFraction,
    Vec3&  OutHitPoint,
    Vec3&  OutHitNormal,
    float& OutRestitution,
    float& OutFriction) const noexcept
{
    bool  HitAny  = false;
    float BestT   = 1.0001f;
    Vec3  BestNrm = Vec3{0.0f, 0.0f, 1.0f};
    float BestRes = 0.42f;
    float BestFrc = 0.24f;

    // 1. Ground plane z = GroundElevationMetres + CollisionSkinMetres.
    const float FloorZ = Config_.GroundElevationMetres + Config_.CollisionSkinMetres;
    if (EndWorld.Z <= FloorZ && EndWorld.Z < StartWorld.Z)
    {
        const float Denom = StartWorld.Z - EndWorld.Z;
        const float T     = (Denom > 1.0e-7f) ? std::clamp((StartWorld.Z - FloorZ) / Denom, 0.0f, 1.0f) : 0.0f;
        BestT   = T;
        BestNrm = Vec3{0.0f, 0.0f, 1.0f};
        BestRes = 0.45f;
        BestFrc = 0.20f;
        HitAny  = true;
    }

    // 2. Registered oriented scene collider boxes (walls, barriers, pillars, vehicle chassis).
    for (const auto& Box : Colliders_)
    {
        float BoxT = 1.0f;
        Vec3  BoxN{};
        if (IntersectSegmentInflatedObb(StartWorld, EndWorld, Box, Config_.CollisionSkinMetres, BoxT, BoxN))
        {
            if (BoxT < BestT)
            {
                BestT   = BoxT;
                BestNrm = BoxN;
                BestRes = Box.Restitution;
                BestFrc = Box.Friction;
                HitAny  = true;
            }
        }
    }

    if (!HitAny)
    {
        return false;
    }

    OutHitFraction = BestT;
    OutHitNormal   = BestNrm;
    OutHitPoint    = StartWorld + (EndWorld - StartWorld) * BestT + BestNrm * 0.0005f;
    OutRestitution = BestRes;
    OutFriction    = BestFrc;
    return true;
}

void SparkParticles::StepBallisticSparks(float DtSeconds, Vec3 AmbientWindMps) noexcept
{
    if (DtSeconds <= 0.0f)
    {
        return;
    }

    uint32_t ActiveCount = 0u;
    float    PeakTempK   = 0.0f;

    // Queue secondary daughter sparks spawned during hard collisions so Pool_ iteration remains deterministic.
    std::vector<BallisticSparkRecord> DaughterQueue;
    SplitMixSparkRng                  SplitRng{Telemetry_.SweptSceneCollisions * 0x9E3779B97F4A7C15ull + 101ull};

    for (auto& Spark : Pool_)
    {
        if (!Spark.Active)
        {
            continue;
        }

        Spark.TailPositionWorld = Spark.PositionWorld;
        Spark.AgeSeconds += DtSeconds;

        // Quadratic + Stokes aerodynamic drag relative to 3D wind field!
        const Vec3  RelAir  = Spark.VelocityMps - AmbientWindMps;
        const float RelSpd  = Length(RelAir);
        const float DragInv = 1.0f / (1.0f + DtSeconds * (0.85f + 0.045f * RelSpd / std::max(0.0003f, Spark.RadiusMetres * 1000.0f)));
        Spark.VelocityMps   = AmbientWindMps + RelAir * DragInv;
        Spark.VelocityMps.Z -= GravityMps2 * DtSeconds;

        // Up to 2 swept sub-bounces per step so corner impacts never tunnel!
        float RemainingDt = DtSeconds;
        for (int BounceIter = 0; BounceIter < 2 && RemainingDt > 1.0e-6f; ++BounceIter)
        {
            const Vec3 CandidateEnd = Spark.PositionWorld + Spark.VelocityMps * RemainingDt;
            float      HitT         = 1.0f;
            Vec3       HitPt{}, HitNrm{};
            float      Restitution = 0.42f;
            float      Friction    = 0.22f;

            if (SweepSegmentAgainstScene(Spark.PositionWorld, CandidateEnd, HitT, HitPt, HitNrm, Restitution, Friction))
            {
                const float Vn      = Dot(Spark.VelocityMps, HitNrm);
                const Vec3  NormalV = HitNrm * Vn;
                const Vec3  TangV   = Spark.VelocityMps - NormalV;

                // Micro-roughness scatter cone on metallic grit bounce!
                const Vec3 Scatter{
                    SplitRng.NextSigned() * 0.14f * std::abs(Vn),
                    SplitRng.NextSigned() * 0.14f * std::abs(Vn),
                    std::abs(SplitRng.NextSigned()) * 0.08f * std::abs(Vn)};

                Spark.PositionWorld = HitPt;
                Spark.VelocityMps   = TangV * (1.0f - Friction) - NormalV * Restitution + Scatter;
                ++Spark.BounceCount;
                ++Telemetry_.SweptSceneCollisions;

                // High-speed hot spark impact can shatter an oxide droplet into 2 smaller bright daughter sparks!
                if (-Vn > 7.5f && Spark.RadiusMetres > 0.00065f && Spark.BounceCount <= 2u && DaughterQueue.size() < 24u)
                {
                    Spark.RadiusMetres *= 0.78f;
                    BallisticSparkRecord Daughter = Spark;
                    Daughter.VelocityMps = Spark.VelocityMps +
                                           Vec3{SplitRng.NextSigned() * 2.6f, SplitRng.NextSigned() * 2.6f, 1.4f * SplitRng.NextUnit()};
                    Daughter.TemperatureK = std::min(2900.0f, Spark.TemperatureK + 90.0f);
                    DaughterQueue.push_back(Daughter);
                    ++Telemetry_.ImpactSplitSparks;
                }

                RemainingDt *= (1.0f - HitT);
            }
            else
            {
                Spark.PositionWorld = CandidateEnd;
                RemainingDt         = 0.0f;
            }
        }

        // Exact floor clamp guard.
        const float MinZ = Config_.GroundElevationMetres + Config_.CollisionSkinMetres;
        if (Spark.PositionWorld.Z < MinZ)
        {
            Spark.PositionWorld.Z = MinZ;
            if (Spark.VelocityMps.Z < 0.0f)
            {
                Spark.VelocityMps.Z = -Spark.VelocityMps.Z * 0.35f;
            }
        }

        // Stefan-Boltzmann T^4 radiative + forced-convective cooling!
        const float T       = Spark.TemperatureK;
        const float TAmb    = Config_.AmbientTemperatureK;
        const float QRad    = SparkEmissivity * StefanBoltzmannConst * (T * T * T * T - TAmb * TAmb * TAmb * TAmb);
        const float HConv   = 45.0f + 12.5f * std::sqrt(std::max(0.0f, RelSpd));
        const float QConv   = HConv * (T - TAmb);
        const float ThermalCapPerArea = (SteelDensityKgM3 * SteelSpecificHeatJKgK * Spark.RadiusMetres) / 3.0f;
        Spark.TemperatureK -= std::min(650.0f, ((QRad + QConv) / std::max(1.0f, ThermalCapPerArea)) * DtSeconds);

        if (Spark.TemperatureK < Config_.MinimumVisibleTempK || Spark.AgeSeconds > 3.2f)
        {
            Spark.Active = false;
            continue;
        }

        ++ActiveCount;
        PeakTempK = std::max(PeakTempK, Spark.TemperatureK);
    }

    for (const auto& D : DaughterQueue)
    {
        AllocateSparkSlot(D);
        ++ActiveCount;
    }

    Telemetry_.ActiveSparkCount      = ActiveCount;
    Telemetry_.PeakTemperatureKelvin = PeakTempK;
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                        PLANCKIAN BLACKBODY & DYNAMIC SCENE ILLUMINATION
------------------------------------------------------------------------------------------------------------------------------------------*/
Vec3 SparkParticles::EvaluatePlanckianSparkChromaticity(float TemperatureKelvin) noexcept
{
    if (TemperatureKelvin < 800.0f)
    {
        return Vec3{0.0f, 0.0f, 0.0f};
    }
    // Analytic Wien/Charity blackbody chromaticity from cherry-red (900 K) -> bright orange (1700 K) -> white-gold (2800 K).
    const float U = std::clamp((TemperatureKelvin - 850.0f) / 2050.0f, 0.0f, 1.0f);
    const float R = 1.0f;
    const float G = std::clamp(0.10f + 0.78f * std::pow(U, 0.85f), 0.0f, 1.0f);
    const float B = std::clamp(0.58f * std::pow(std::max(0.0f, U - 0.18f) / 0.82f, 1.65f), 0.0f, 1.0f);
    return Vec3{R, G, B};
}

void SparkParticles::PopulateSceneSparkLuminaires(
    std::vector<SparkPointLuminaire>& OutLuminaires,
    uint32_t                          MaxLuminaires) const
{
    OutLuminaires.clear();
    if (MaxLuminaires == 0u)
    {
        return;
    }

    for (const auto& Spark : Pool_)
    {
        if (!Spark.Active || Spark.TemperatureK < Config_.MinimumVisibleTempK)
        {
            continue;
        }
        const float Area4Pi = 12.56637f * Spark.RadiusMetres * Spark.RadiusMetres;
        const float TNorm   = Spark.TemperatureK / 2000.0f;
        const float Power   = Config_.SceneLuminanceGain * Area4Pi * 38000.0f * (TNorm * TNorm * TNorm * TNorm);
        const Vec3  Chroma  = EvaluatePlanckianSparkChromaticity(Spark.TemperatureK);

        SparkPointLuminaire Lum{};
        Lum.PositionWorld       = Spark.PositionWorld;
        Lum.RadiantIntensityWsr = Chroma * Power;
        Lum.EffectiveRadiusM    = std::clamp(0.8f + 1.8f * std::sqrt(Power), 0.75f, 4.5f);
        OutLuminaires.push_back(Lum);

        if (OutLuminaires.size() >= MaxLuminaires)
        {
            break;
        }
    }
}

bool SparkParticles::SegmentOccludedByColliders(Vec3 Origin, Vec3 Target) const noexcept
{
    const Vec3  Delta = Target - Origin;
    const float Len   = Length(Delta);
    if (Len <= 1.0e-4f)
    {
        return false;
    }
    const Vec3 P0 = Origin + Delta * (0.008f / Len);
    const Vec3 P1 = Target - Delta * (0.008f / Len);

    for (const auto& Box : Colliders_)
    {
        float HitT = 1.0f;
        Vec3  HitN{};
        if (IntersectSegmentInflatedObb(P0, P1, Box, 0.0f, HitT, HitN) && HitT > 0.0f && HitT < 1.0f)
        {
            return true;
        }
    }
    return false;
}

Vec3 SparkParticles::EvaluateShadowedSceneIrradiance(Vec3 SurfacePoint, Vec3 SurfaceNormal) const noexcept
{
    Vec3 Accum{0.0f, 0.0f, 0.0f};
    for (const auto& Spark : Pool_)
    {
        if (!Spark.Active || Spark.TemperatureK < Config_.MinimumVisibleTempK)
        {
            continue;
        }
        const Vec3  ToSpark = Spark.PositionWorld - SurfacePoint;
        const float DistSq  = Dot(ToSpark, ToSpark);
        if (DistSq > 20.25f) // 4.5 m cutoff
        {
            continue;
        }
        const float Dist = std::sqrt(std::max(1.0e-4f, DistSq));
        const Vec3  Dir  = ToSpark * (1.0f / Dist);
        const float Ndl  = Dot(SurfaceNormal, Dir);
        if (Ndl <= 0.0f)
        {
            continue;
        }
        if (SegmentOccludedByColliders(SurfacePoint + SurfaceNormal * 0.004f, Spark.PositionWorld))
        {
            continue;
        }

        const float Area4Pi = 12.56637f * Spark.RadiusMetres * Spark.RadiusMetres;
        const float TNorm   = Spark.TemperatureK / 2000.0f;
        const float Intensity = Config_.SceneLuminanceGain * Area4Pi * 38000.0f * (TNorm * TNorm * TNorm * TNorm);
        const float Atten     = Ndl / (DistSq + 0.015f);
        Accum = Accum + EvaluatePlanckianSparkChromaticity(Spark.TemperatureK) * (Intensity * Atten);
    }
    return Accum;
}

Vec3 SparkParticles::EvaluateRaySparkStreaks(
    Vec3  RayOrigin,
    Vec3  RayDirectionUnit,
    float MaxDistanceM,
    float PixelAngularRadians,
    float ShutterSeconds) const noexcept
{
    Vec3 RadianceAccum{0.0f, 0.0f, 0.0f};
    const float SafeAngRad = std::clamp(PixelAngularRadians, 0.0004f, 0.0045f);
    const float SafeShutter = std::clamp(ShutterSeconds, 0.004f, 0.055f);
    const float MinFloorZ = Config_.GroundElevationMetres + Config_.CollisionSkinMetres;

    for (const auto& Spark : Pool_)
    {
        if (!Spark.Active || Spark.TemperatureK < Config_.MinimumVisibleTempK)
        {
            continue;
        }

        const Vec3 Head = Spark.PositionWorld;
        const Vec3 ToHead = Head - RayOrigin;
        const float HeadProj = Dot(ToHead, RayDirectionUnit);
        if (HeadProj <= 0.08f || HeadProj >= MaxDistanceM)
        {
            continue;
        }

        // Shutter-integrated tail (SparkRaster.wgsl): spans camera shutter motion, clamped at ground plane.
        Vec3 Tail = Head - Spark.VelocityMps * SafeShutter;
        if (Tail.Z < MinFloorZ)
        {
            Tail.Z = MinFloorZ;
        }
        Vec3 Seg = Head - Tail;
        const float SegLen = Length(Seg);

        // Closest approach between camera ray (RayOrigin + s * RayDirectionUnit) and spark streak [Tail + u * Seg, u in 0..1]
        float Along01 = 1.0f;
        float RayT    = HeadProj;
        if (SegLen > 1.0e-4f)
        {
            const Vec3  W0    = RayOrigin - Tail;
            const float B     = Dot(RayDirectionUnit, Seg);
            const float C     = Dot(Seg, Seg);
            const float D     = Dot(RayDirectionUnit, W0);
            const float E     = Dot(Seg, W0);
            const float Denom = C - B * B;
            if (Denom > 1.0e-7f)
            {
                Along01 = std::clamp((E - B * D) / Denom, 0.0f, 1.0f);
            }
            RayT = Dot((Tail + Seg * Along01) - RayOrigin, RayDirectionUnit);
        }
        if (RayT <= 0.08f || RayT >= MaxDistanceM)
        {
            continue;
        }

        // SparkRaster.wgsl screen-clamped footprint: crisp 1.05 px head tapering to 0.32 px tail, NEVER a fat world sphere!
        const float PixelWorldWidth = RayT * SafeAngRad;
        const float PhysicalWidth   = std::clamp(Spark.RadiusMetres * 2.2f, PixelWorldWidth * 0.78f, PixelWorldWidth * 1.38f);
        const float TaperedHalfW    = PhysicalWidth * (0.30f + 0.70f * Along01);

        const Vec3  StreakPt = Tail + Seg * Along01;
        const Vec3  RayPt    = RayOrigin + RayDirectionUnit * RayT;
        const Vec3  Diff     = RayPt - StreakPt;
        const float DistSq   = Dot(Diff, Diff);
        const float OuterR   = TaperedHalfW * 2.1f;
        if (DistSq >= OuterR * OuterR)
        {
            continue;
        }

        const float NormAcross = std::sqrt(DistSq) / std::max(TaperedHalfW, 1.0e-5f);
        const float CoreAcross = std::pow(std::max(0.0f, 1.0f - std::min(1.0f, NormAcross * NormAcross)), 2.4f);
        const float HaloAcross = 0.22f * std::exp(-2.6f * NormAcross * NormAcross);
        const float HeadRamp   = 0.14f + 0.86f * std::pow(Along01, 1.45f);

        // Energy conservation over shutter streak length (SparkRaster.wgsl: Width / (Length + Width))
        const float Spread = PhysicalWidth / std::max(PhysicalWidth, 0.30f * SegLen + PhysicalWidth);
        const float EnergyFactor = 0.42f + 0.58f * Spread;

        // Cooler orange-crimson tail -> white-gold incandescent head
        const float LocalKelvin = Spark.TemperatureK * (0.72f + 0.28f * Along01);
        const Vec3  Chroma      = EvaluatePlanckianSparkChromaticity(LocalKelvin);
        const Vec3  HotCoreTint = Chroma * (1.0f - 0.45f * CoreAcross * Along01)
                                + Vec3{1.0f, 0.96f, 0.86f} * (0.45f * CoreAcross * Along01);

        const float TNorm = Spark.TemperatureK / 2000.0f;
        const float Intensity = 16.5f * std::min(3.5f, TNorm * TNorm * TNorm) * EnergyFactor * HeadRamp;
        RadianceAccum = RadianceAccum + HotCoreTint * (Intensity * (CoreAcross + HaloAcross));
    }

    return RadianceAccum;
}

} // namespace Frontier
