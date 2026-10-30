/*==========================================================================================================================================
                                                SDFRESTIRPORTALEXTENSION.CPP
==========================================================================================================================================*/
// 🧩 Dual-tier GI & reflections: GTX SDF ReSTIR + SurfaceCards and RTX BVH ReSTIR, with Portals, Mirrors & full volumetrics.

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             INCLUDES
------------------------------------------------------------------------------------------------------------------------------------------*/
#include "Engine/Rendering/SdfRestirPortalExtension.h"

#include <algorithm>
#include <cmath>

namespace Frontier
{
namespace
{
constexpr float PiFloat = 3.1415926535f;

struct SplitMix64Restir
{
    uint64_t Seed = 1ull;

    [[nodiscard]] float NextZeroToOne() noexcept
    {
        Seed += 0x9E3779B97F4A7C15ull;
        uint64_t Z = Seed;
        Z          = (Z ^ (Z >> 30u)) * 0xBF58476D1CE4E5B9ull;
        Z          = (Z ^ (Z >> 27u)) * 0x94D049BB133111EBull;
        Z          = Z ^ (Z >> 31u);
        return static_cast<float>(static_cast<double>(Z >> 11u) * (1.0 / 9007199254740992.0));
    }
};

[[nodiscard]] std::array<float, 3> ToArr3(Vec3 V) noexcept
{
    return {V.X, V.Y, V.Z};
}

[[nodiscard]] SpatialVector ToSpatial(Vec3 V) noexcept
{
    return SpatialVector{static_cast<double>(V.X), static_cast<double>(V.Y), static_cast<double>(V.Z)};
}

[[nodiscard]] Vec3 FromSpectrum(const SpectrumRgb& S) noexcept
{
    return Vec3{static_cast<float>(S.R), static_cast<float>(S.G), static_cast<float>(S.B)};
}

[[nodiscard]] float LuminanceRec709(Vec3 Rgb) noexcept
{
    return std::max(0.0f, 0.2126f * Rgb.X + 0.7152f * Rgb.Y + 0.0722f * Rgb.Z);
}

[[nodiscard]] Vec3 SampleCosineHemisphere(Vec3 NormalUnit, float U1, float U2) noexcept
{
    const float R     = std::sqrt(std::clamp(U1, 0.0f, 1.0f));
    const float Phi   = 2.0f * PiFloat * U2;
    const float LocX  = R * std::cos(Phi);
    const float LocY  = R * std::sin(Phi);
    const float LocZ  = std::sqrt(std::max(0.0f, 1.0f - U1));

    const Vec3 TangentRef = (std::abs(NormalUnit.Z) < 0.92f) ? Vec3{0.0f, 0.0f, 1.0f} : Vec3{1.0f, 0.0f, 0.0f};
    const Vec3 TanU   = Normalise(Cross(TangentRef, NormalUnit));
    const Vec3 TanV   = Cross(NormalUnit, TanU);
    return Normalise(TanU * LocX + TanV * LocY + NormalUnit * LocZ);
}

[[nodiscard]] bool IntersectRayAabb(Vec3 Orig, Vec3 InvDir, Vec3 BMin, Vec3 BMax, float MaxT) noexcept
{
    float T1 = (BMin.X - Orig.X) * InvDir.X;
    float T2 = (BMax.X - Orig.X) * InvDir.X;
    float TMin = std::min(T1, T2);
    float TMax = std::max(T1, T2);

    T1   = (BMin.Y - Orig.Y) * InvDir.Y;
    T2   = (BMax.Y - Orig.Y) * InvDir.Y;
    TMin = std::max(TMin, std::min(T1, T2));
    TMax = std::min(TMax, std::max(T1, T2));

    T1   = (BMin.Z - Orig.Z) * InvDir.Z;
    T2   = (BMax.Z - Orig.Z) * InvDir.Z;
    TMin = std::max(TMin, std::min(T1, T2));
    TMax = std::min(TMax, std::max(T1, T2));

    return (TMax >= std::max(0.0f, TMin)) && (TMin < MaxT);
}

[[nodiscard]] bool IntersectRayTriangleMollerTrumbore(
    Vec3               Orig,
    Vec3               Dir,
    const RtxSceneTriangle& Tri,
    float              MaxT,
    float&             OutT) noexcept
{
    const Vec3  E1  = Tri.V1 - Tri.V0;
    const Vec3  E2  = Tri.V2 - Tri.V0;
    const Vec3  P   = Cross(Dir, E2);
    const float Det = Dot(E1, P);
    if (std::abs(Det) < 1.0e-7f)
    {
        return false;
    }
    const float InvDet = 1.0f / Det;
    const Vec3  T      = Orig - Tri.V0;
    const float U      = Dot(T, P) * InvDet;
    if (U < 0.0f || U > 1.0f)
    {
        return false;
    }
    const Vec3  Q = Cross(T, E1);
    const float V = Dot(Dir, Q) * InvDet;
    if (V < 0.0f || U + V > 1.0f)
    {
        return false;
    }
    const float HitT = Dot(E2, Q) * InvDet;
    if (HitT <= 1.0e-4f || HitT >= MaxT)
    {
        return false;
    }
    OutT = HitT;
    return true;
}

[[nodiscard]] bool IntersectBoundedRectangleAperture(
    Vec3   RayOrigin,
    Vec3   RayDirUnit,
    Vec3   Centre,
    Vec3   RightAxis,
    Vec3   UpAxis,
    Vec3   FrontNormal,
    float  HalfW,
    float  HalfH,
    float  MaxDistance,
    float& OutHitT,
    float& OutLocalU,
    float& OutLocalV) noexcept
{
    const float Denom = Dot(RayDirUnit, FrontNormal);
    if (Denom >= -1.0e-4f)
    {
        return false; // Must approach from the front hemisphere of the mirror or portal!
    }
    const float T = Dot(Centre - RayOrigin, FrontNormal) / Denom;
    if (T <= 1.0e-3f || T >= MaxDistance)
    {
        return false;
    }
    const Vec3  HitPt = RayOrigin + RayDirUnit * T;
    const Vec3  Rel   = HitPt - Centre;
    const float U     = Dot(Rel, RightAxis);
    const float V     = Dot(Rel, UpAxis);
    if (std::abs(U) > HalfW || std::abs(V) > HalfH)
    {
        return false;
    }
    OutHitT   = T;
    OutLocalU = U;
    OutLocalV = V;
    return true;
}

[[nodiscard]] uint32_t SelectPrincipalCardFace(Vec3 Normal) noexcept
{
    const float Ax = std::abs(Normal.X);
    const float Ay = std::abs(Normal.Y);
    const float Az = std::abs(Normal.Z);
    if (Ax >= Ay && Ax >= Az)
    {
        return (Normal.X >= 0.0f) ? 0u : 1u;
    }
    if (Ay >= Ax && Ay >= Az)
    {
        return (Normal.Y >= 0.0f) ? 2u : 3u;
    }
    return (Normal.Z >= 0.0f) ? 4u : 5u;
}

[[nodiscard]] Vec3 CardFaceDirection(uint32_t FaceIndex) noexcept
{
    switch (FaceIndex)
    {
    case 0u: return Vec3{+1.0f, 0.0f, 0.0f};
    case 1u: return Vec3{-1.0f, 0.0f, 0.0f};
    case 2u: return Vec3{0.0f, +1.0f, 0.0f};
    case 3u: return Vec3{0.0f, -1.0f, 0.0f};
    case 4u: return Vec3{0.0f, 0.0f, +1.0f};
    default: return Vec3{0.0f, 0.0f, -1.0f};
    }
}

[[nodiscard]] uint8_t AcesFilmicByte(float LinearX) noexcept
{
    const float X      = std::max(0.0f, LinearX * 0.72f);
    const float Mapped = std::clamp((X * (2.51f * X + 0.03f)) / (X * (2.43f * X + 0.59f) + 0.14f), 0.0f, 1.0f);
    const float Srgb   = std::pow(Mapped, 1.0f / 2.2f);
    return static_cast<uint8_t>(std::clamp(Srgb * 255.0f + 0.5f, 0.0f, 255.0f));
}
} // namespace

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                 SCENE REGISTRATION & BVH / CARDS
------------------------------------------------------------------------------------------------------------------------------------------*/
void SdfRestirPortalExtension::ClearScene() noexcept
{
    SdfScene_.Clear();
    SdfPrimitiveToCard_.clear();
    SurfaceCards_.clear();
    Triangles_.clear();
    BvhRecords_.clear();
    Mirrors_.clear();
    Portals_.clear();
}

uint32_t SdfRestirPortalExtension::RegisterDualTierSolidBox(
    Vec3  CentreWorld,
    Vec3  HalfExtents,
    Vec3  AlbedoRgb,
    float Roughness,
    Vec3  EmissiveRgb)
{
    const uint32_t CardIdx = static_cast<uint32_t>(SurfaceCards_.size());
    OrientedSurfaceCard Card{};
    Card.CentreWorld         = CentreWorld;
    Card.HalfExtents         = HalfExtents;
    Card.AlbedoRgb           = AlbedoRgb;
    Card.EmissiveRadianceRgb = EmissiveRgb;
    Card.Roughness           = Roughness;
    SurfaceCards_.push_back(Card);

    // 1. Register into GTX DistanceFieldScene!
    DistancePrimitive Prim{};
    Prim.Kind               = DistancePrimitiveKind::Box;
    Prim.Centre             = ToSpatial(CentreWorld);
    Prim.Extents            = ToSpatial(HalfExtents);
    Prim.EmissiveRadiance   = LuminanceRec709(EmissiveRgb);
    Prim.DiffuseReflectance = LuminanceRec709(AlbedoRgb);
    SdfScene_.AddPrimitive(Prim);
    SdfPrimitiveToCard_.push_back(CardIdx);

    // 2. Register 12 exact triangles into RTX BVH!
    const float X0 = CentreWorld.X - HalfExtents.X, X1 = CentreWorld.X + HalfExtents.X;
    const float Y0 = CentreWorld.Y - HalfExtents.Y, Y1 = CentreWorld.Y + HalfExtents.Y;
    const float Z0 = CentreWorld.Z - HalfExtents.Z, Z1 = CentreWorld.Z + HalfExtents.Z;

    const Vec3 P000{X0, Y0, Z0}, P100{X1, Y0, Z0}, P110{X1, Y1, Z0}, P010{X0, Y1, Z0};
    const Vec3 P001{X0, Y0, Z1}, P101{X1, Y0, Z1}, P111{X1, Y1, Z1}, P011{X0, Y1, Z1};

    auto PushBoxQuad = [&](Vec3 A, Vec3 B, Vec3 C, Vec3 D, Vec3 N)
    {
        Triangles_.push_back({A, B, C, N, AlbedoRgb, EmissiveRgb, Roughness, CardIdx});
        Triangles_.push_back({A, C, D, N, AlbedoRgb, EmissiveRgb, Roughness, CardIdx});
    };

    PushBoxQuad(P001, P101, P111, P011, Vec3{0.0f, 0.0f, +1.0f});
    PushBoxQuad(P000, P010, P110, P100, Vec3{0.0f, 0.0f, -1.0f});
    PushBoxQuad(P100, P110, P111, P101, Vec3{+1.0f, 0.0f, 0.0f});
    PushBoxQuad(P010, P000, P001, P011, Vec3{-1.0f, 0.0f, 0.0f});
    PushBoxQuad(P110, P010, P011, P111, Vec3{0.0f, +1.0f, 0.0f});
    PushBoxQuad(P000, P100, P101, P001, Vec3{0.0f, -1.0f, 0.0f});

    return CardIdx;
}

void SdfRestirPortalExtension::RegisterPolygonTriangle(const RtxSceneTriangle& Triangle)
{
    Triangles_.push_back(Triangle);
}

void SdfRestirPortalExtension::RegisterPlanarMirror(const PlanarMirrorAperture& Mirror)
{
    PlanarMirrorAperture Clean = Mirror;
    Clean.RightAxis            = Normalise(Mirror.RightAxis);
    Clean.UpAxis               = Normalise(Mirror.UpAxis);
    Clean.FrontNormal          = Normalise(Mirror.FrontNormal);
    Mirrors_.push_back(Clean);
}

void SdfRestirPortalExtension::RegisterSeamlessPortal(const SeamlessPortalAperture& Portal)
{
    SeamlessPortalAperture Clean = Portal;
    Clean.EntryRightAxis         = Normalise(Portal.EntryRightAxis);
    Clean.EntryUpAxis            = Normalise(Portal.EntryUpAxis);
    Clean.EntryFrontNormal       = Normalise(Portal.EntryFrontNormal);
    Clean.ExitRightAxis          = Normalise(Portal.ExitRightAxis);
    Clean.ExitUpAxis             = Normalise(Portal.ExitUpAxis);
    Clean.ExitFrontNormal        = Normalise(Portal.ExitFrontNormal);
    Portals_.push_back(Clean);
}

uint32_t SdfRestirPortalExtension::BuildBvhRecursive(uint32_t StartTri, uint32_t TriCount)
{
    const uint32_t MyIndex = static_cast<uint32_t>(BvhRecords_.size());
    BvhRecords_.push_back(BvhFlatBoundsRecord{});

    Vec3 BMin{1.0e9f, 1.0e9f, 1.0e9f};
    Vec3 BMax{-1.0e9f, -1.0e9f, -1.0e9f};
    for (uint32_t I = StartTri; I < StartTri + TriCount; ++I)
    {
        const auto& T = Triangles_[I];
        BMin.X = std::min({BMin.X, T.V0.X, T.V1.X, T.V2.X});
        BMin.Y = std::min({BMin.Y, T.V0.Y, T.V1.Y, T.V2.Y});
        BMin.Z = std::min({BMin.Z, T.V0.Z, T.V1.Z, T.V2.Z});
        BMax.X = std::max({BMax.X, T.V0.X, T.V1.X, T.V2.X});
        BMax.Y = std::max({BMax.Y, T.V0.Y, T.V1.Y, T.V2.Y});
        BMax.Z = std::max({BMax.Z, T.V0.Z, T.V1.Z, T.V2.Z});
    }

    BvhRecords_[MyIndex].BoundsMin = BMin;
    BvhRecords_[MyIndex].BoundsMax = BMax;

    if (TriCount <= 6u)
    {
        BvhRecords_[MyIndex].LeftOrFirstTriangle = StartTri;
        BvhRecords_[MyIndex].TriangleCount       = TriCount;
        return MyIndex;
    }

    const Vec3 Span = BMax - BMin;
    int        Axis = 0;
    if (Span.Y > Span.X && Span.Y >= Span.Z)
    {
        Axis = 1;
    }
    else if (Span.Z > Span.X && Span.Z > Span.Y)
    {
        Axis = 2;
    }

    const uint32_t Mid = StartTri + TriCount / 2u;
    std::nth_element(
        Triangles_.begin() + StartTri,
        Triangles_.begin() + Mid,
        Triangles_.begin() + StartTri + TriCount,
        [Axis](const RtxSceneTriangle& A, const RtxSceneTriangle& B)
        {
            const Vec3 Ca = (A.V0 + A.V1 + A.V2) * (1.0f / 3.0f);
            const Vec3 Cb = (B.V0 + B.V1 + B.V2) * (1.0f / 3.0f);
            return (Axis == 0) ? (Ca.X < Cb.X) : ((Axis == 1) ? (Ca.Y < Cb.Y) : (Ca.Z < Cb.Z));
        });

    const uint32_t LeftBranch  = BuildBvhRecursive(StartTri, Mid - StartTri);
    const uint32_t RightBranch = BuildBvhRecursive(Mid, StartTri + TriCount - Mid);

    BvhRecords_[MyIndex].LeftOrFirstTriangle = LeftBranch;
    BvhRecords_[MyIndex].RightBranchIndex     = RightBranch;
    BvhRecords_[MyIndex].TriangleCount       = 0u;

    return MyIndex;
}

void SdfRestirPortalExtension::FinalizeSceneAndBakeSurfaceCards(const CoupledWorldOpticalContext& Context)
{
    BvhRecords_.clear();
    if (!Triangles_.empty())
    {
        BvhRecords_.reserve(Triangles_.size() * 2u);
        BuildBvhRecursive(0u, static_cast<uint32_t>(Triangles_.size()));
    }

    // Bake 6-face exitant radiance into OrientedSurfaceCards for GTX SDF ReSTIR!
    for (auto& Card : SurfaceCards_)
    {
        for (uint32_t Face = 0u; Face < 6u; ++Face)
        {
            const Vec3 FaceN  = CardFaceDirection(Face);
            const Vec3 Offset = Vec3{
                FaceN.X * (Card.HalfExtents.X + 0.03f),
                FaceN.Y * (Card.HalfExtents.Y + 0.03f),
                FaceN.Z * (Card.HalfExtents.Z + 0.03f)};
            const Vec3 SamplePt = Card.CentreWorld + Offset;
            const Vec3 Direct   = EvaluateDirectSurfaceLighting(
                GpuTracingTier::SignedDistanceFieldGtx,
                SamplePt,
                FaceN,
                Card.AlbedoRgb,
                Context);
            Card.FaceIrradianceCache[Face] = Card.EmissiveRadianceRgb + Direct;
        }
    }
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                      PORTAL RAY TRANSFORMATION
------------------------------------------------------------------------------------------------------------------------------------------*/
void SdfRestirPortalExtension::TransformRayAcrossPortal(
    const SeamlessPortalAperture& Portal,
    Vec3                          HitPointOnEntry,
    Vec3                          IncomingDirectionUnit,
    Vec3&                         OutTeleportedOrigin,
    Vec3&                         OutTeleportedDirection) noexcept
{
    const Vec3  Rel = HitPointOnEntry - Portal.EntryCentreWorld;
    const float U   = Dot(Rel, Portal.EntryRightAxis);
    const float V   = Dot(Rel, Portal.EntryUpAxis);

    const float DirR = Dot(IncomingDirectionUnit, Portal.EntryRightAxis);
    const float DirU = Dot(IncomingDirectionUnit, Portal.EntryUpAxis);
    const float DirN = Dot(IncomingDirectionUnit, Portal.EntryFrontNormal); // < 0 entering front face!

    // Flip horizontal tangent so looking into EntryFrontNormal (+Z camera) emerges forward along +ExitFrontNormal!
    OutTeleportedOrigin = Portal.ExitCentreWorld -
                          Portal.ExitRightAxis * U +
                          Portal.ExitUpAxis * V +
                          Portal.ExitFrontNormal * 0.015f;

    OutTeleportedDirection = Normalise(
        Portal.ExitRightAxis * (-DirR) +
        Portal.ExitUpAxis * DirU +
        Portal.ExitFrontNormal * (-DirN));
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                            DUAL-TIER GEOMETRY & VISIBILITY QUERIES
------------------------------------------------------------------------------------------------------------------------------------------*/
SdfRestirPortalExtension::InternalSurfaceHit SdfRestirPortalExtension::TraceTierSolidGeometry(
    GpuTracingTier Tier,
    Vec3           Origin,
    Vec3           DirectionUnit,
    float          MaxDistanceM) const noexcept
{
    InternalSurfaceHit Result{};

    if (Tier == GpuTracingTier::SignedDistanceFieldGtx)
    {
        const DistanceTraceResult Trace = SdfScene_.Trace(
            ToSpatial(Origin),
            ToSpatial(DirectionUnit),
            static_cast<double>(MaxDistanceM),
            1.5e-3,
            192u);
        if (Trace.Hit && Trace.Primitive < SdfPrimitiveToCard_.size())
        {
            Result.Hit           = true;
            Result.DistanceM     = static_cast<float>(Trace.Distance);
            Result.Position      = Origin + DirectionUnit * Result.DistanceM;
            const SpatialVector N = SdfScene_.NormalAt(ToSpatial(Result.Position));
            Result.Normal        = Normalise(Vec3{static_cast<float>(N.X), static_cast<float>(N.Y), static_cast<float>(N.Z)});
            Result.CardIndex     = SdfPrimitiveToCard_[Trace.Primitive];
            if (Result.CardIndex < SurfaceCards_.size())
            {
                const auto& Card   = SurfaceCards_[Result.CardIndex];
                Result.AlbedoRgb   = Card.AlbedoRgb;
                Result.EmissiveRgb = Card.EmissiveRadianceRgb;
                Result.Roughness   = Card.Roughness;
            }
        }
        return Result;
    }

    // HardwareRayTracingRtx: exact BVH + Moller-Trumbore triangle ray query!
    if (BvhRecords_.empty())
    {
        return Result;
    }

    const Vec3 InvDir{
        1.0f / ((std::abs(DirectionUnit.X) > 1.0e-7f) ? DirectionUnit.X : 1.0e-7f),
        1.0f / ((std::abs(DirectionUnit.Y) > 1.0e-7f) ? DirectionUnit.Y : 1.0e-7f),
        1.0f / ((std::abs(DirectionUnit.Z) > 1.0e-7f) ? DirectionUnit.Z : 1.0e-7f)};

    uint32_t Stack[32];
    uint32_t StackPtr = 0u;
    Stack[StackPtr++] = 0u;

    float BestT   = MaxDistanceM;
    int   BestTri = -1;

    while (StackPtr > 0u)
    {
        const uint32_t RecordIdx = Stack[--StackPtr];
        const auto&    Record  = BvhRecords_[RecordIdx];
        if (!IntersectRayAabb(Origin, InvDir, Record.BoundsMin, Record.BoundsMax, BestT))
        {
            continue;
        }
        if (Record.TriangleCount > 0u)
        {
            for (uint32_t I = 0u; I < Record.TriangleCount; ++I)
            {
                const uint32_t TriIdx = Record.LeftOrFirstTriangle + I;
                float          HitT   = BestT;
                if (IntersectRayTriangleMollerTrumbore(Origin, DirectionUnit, Triangles_[TriIdx], BestT, HitT))
                {
                    BestT   = HitT;
                    BestTri = static_cast<int>(TriIdx);
                }
            }
        }
        else if (StackPtr + 2u <= 32u)
        {
            Stack[StackPtr++] = Record.LeftOrFirstTriangle;
            Stack[StackPtr++] = Record.RightBranchIndex;
        }
    }

    if (BestTri >= 0)
    {
        const auto& Tri    = Triangles_[static_cast<size_t>(BestTri)];
        Result.Hit         = true;
        Result.DistanceM   = BestT;
        Result.Position    = Origin + DirectionUnit * BestT;
        Result.Normal      = (Dot(Tri.Normal, DirectionUnit) < 0.0f) ? Tri.Normal : -Tri.Normal;
        Result.AlbedoRgb   = Tri.AlbedoRgb;
        Result.EmissiveRgb = Tri.EmissiveRgb;
        Result.Roughness   = Tri.Roughness;
        Result.CardIndex   = Tri.CardOrMaterialIndex;
    }
    return Result;
}

bool SdfRestirPortalExtension::TraceTierVisibilityShadow(
    GpuTracingTier Tier,
    Vec3           Origin,
    Vec3           DirectionUnit,
    float          MaxDistanceM) const noexcept
{
    const InternalSurfaceHit Hit = TraceTierSolidGeometry(Tier, Origin + DirectionUnit * 0.02f, DirectionUnit, MaxDistanceM);
    return !Hit.Hit;
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                    VOLUMETRIC CLOUDS + SKY + FOG + PLUME + DIRECT LIGHTING
------------------------------------------------------------------------------------------------------------------------------------------*/
Vec3 SdfRestirPortalExtension::EvaluateVolumetricSegmentAndSky(
    Vec3                              SegmentOrigin,
    Vec3                              SegmentDirectionUnit,
    float                             SegmentLengthM,
    bool                              ReachedInfinitySky,
    const CoupledWorldOpticalContext& Context,
    float&                            OutPlumeOpacity,
    float&                            OutCloudLuminance) const noexcept
{
    const Vec3 SunDir = Normalise(Context.SunDirectionUnit);
    Vec3       BackgroundRgb{0.0f, 0.0f, 0.0f};

    if (ReachedInfinitySky)
    {
        // 1. Rayleigh/Mie single + multiple scattering sky!
        const SpatialVector PlanetPosKm{
            0.0,
            0.0,
            Context.Atmosphere.GroundRadiusKm + std::max(0.001, static_cast<double>(SegmentOrigin.Z) * 0.001)};
        const SpectrumRgb SunSpec{
            static_cast<double>(Context.SunIrradianceRgb.X),
            static_cast<double>(Context.SunIrradianceRgb.Y),
            static_cast<double>(Context.SunIrradianceRgb.Z)};

        const SpatialVector SafeDir = ToSpatial(Normalise(Vec3{
            SegmentDirectionUnit.X,
            SegmentDirectionUnit.Y,
            std::max(-0.08f, SegmentDirectionUnit.Z)}));

        const SpectrumRgb SingleSky = SingleScattering(
            Context.Atmosphere,
            PlanetPosKm,
            SafeDir,
            ToSpatial(SunDir),
            SunSpec,
            Context.AtmosphereLut,
            16u);
        const SpectrumRgb MultiSky = MultipleScatteringApprox(
            Context.Atmosphere,
            PlanetPosKm,
            SafeDir,
            ToSpatial(SunDir),
            SingleSky,
            SunSpec);
        BackgroundRgb = FromSpectrum(SingleSky) + FromSpectrum(MultiSky);

        // Solar disc glow near SunDir!
        const float CosSun = Dot(SegmentDirectionUnit, SunDir);
        if (CosSun > 0.9992f)
        {
            BackgroundRgb = BackgroundRgb + Context.SunIrradianceRgb * 8.0f;
        }

        // 2. Volumetric CloudField raymarch + internal Lightning cloud scattering!
        if (SegmentDirectionUnit.Z > 0.015f)
        {
            const CloudMarchResult CloudRes = MarchClouds(
                Context.Clouds,
                ToSpatial(SegmentOrigin),
                ToSpatial(SegmentDirectionUnit),
                ToSpatial(SunDir),
                SunSpec,
                28000.0,
                28u,
                4u);

            Vec3 CloudRad = FromSpectrum(CloudRes.Radiance);

            // Internal lightning flash glow diffusing through storm clouds!
            if (Context.Lightning != nullptr && Context.Lightning->InstantaneousFlashEnvelope() > 1.0e-3f)
            {
                const float TCloud = static_cast<float>((Context.Clouds.BaseHeightM + 220.0 - SegmentOrigin.Z) /
                                                        std::max(0.05f, SegmentDirectionUnit.Z));
                if (TCloud > 0.0f && TCloud < 25000.0f)
                {
                    const Vec3   CloudHit = SegmentOrigin + SegmentDirectionUnit * TCloud;
                    const double Dens     = CloudDensity(Context.Clouds, ToSpatial(CloudHit));
                    CloudRad = CloudRad + Context.Lightning->EvaluateCloudInternalFlashRadiance(CloudHit, Dens);
                }
            }

            OutCloudLuminance = std::max(OutCloudLuminance, LuminanceRec709(CloudRad) * static_cast<float>(1.0 - CloudRes.Transmittance));
            BackgroundRgb     = BackgroundRgb * static_cast<float>(CloudRes.Transmittance) + CloudRad;
        }
    }

    // 3. Exponential Height Fog along segment (attenuating sky or surface + adding sun/lightning fog glow)!
    const double      FogDist = ReachedInfinitySky ? 320.0 : static_cast<double>(SegmentLengthM);
    const double      FogT    = FogTransmittance(Context.Fog, ToSpatial(SegmentOrigin), ToSpatial(SegmentDirectionUnit), FogDist);
    SpectrumRgb       FogTint = Context.Fog.Colour;
    if (Context.Lightning != nullptr && Context.Lightning->InstantaneousFlashEnvelope() > 1.0e-3f)
    {
        const double Boost = 0.65 * static_cast<double>(Context.Lightning->InstantaneousFlashEnvelope());
        FogTint.R += 0.55 * Boost;
        FogTint.G += 0.65 * Boost;
        FogTint.B += 0.90 * Boost;
    }
    FogParameters DynamicFog = Context.Fog;
    DynamicFog.Colour        = FogTint;

    Vec3 Composed = ReachedInfinitySky
                        ? FromSpectrum(ApplyFog(DynamicFog, SpectrumRgb{BackgroundRgb.X, BackgroundRgb.Y, BackgroundRgb.Z}, FogT))
                        : FromSpectrum(FogTint) * static_cast<float>(1.0 - FogT);

    // 4. 3D PlumeFluid Smoke & Blackbody Fire raymarch along this exact ray segment (works in primary, mirrors & portals)!
    if (Context.PlumeFluid != nullptr)
    {
        const float PlumeMaxDist = std::min(SegmentLengthM, 120.0f);
        const auto  PlumeRgba    = Context.PlumeFluid->EvaluatePlumeRay(
            ToArr3(SegmentOrigin),
            ToArr3(SegmentDirectionUnit),
            PlumeMaxDist,
            0.35f,
            ToArr3(SunDir),
            ToArr3(Context.SunIrradianceRgb * 0.35f),
            {0.18f, 0.24f, 0.34f});

        const float PlumeTrans = std::clamp(PlumeRgba[3], 0.0f, 1.0f);
        OutPlumeOpacity        = std::max(OutPlumeOpacity, 1.0f - PlumeTrans);
        Composed               = Composed * PlumeTrans + Vec3{PlumeRgba[0], PlumeRgba[1], PlumeRgba[2]};
    }

    return Composed;
}

Vec3 SdfRestirPortalExtension::EvaluateDirectSurfaceLighting(
    GpuTracingTier                    Tier,
    Vec3                              Point,
    Vec3                              Normal,
    Vec3                              Albedo,
    const CoupledWorldOpticalContext& Context) const noexcept
{
    const Vec3  SunDir = Normalise(Context.SunDirectionUnit);
    const float NdotL  = std::max(0.0f, Dot(Normal, SunDir));
    Vec3        Direct{0.0f, 0.0f, 0.0f};

    if (NdotL > 0.0f)
    {
        const bool Unoccluded = TraceTierVisibilityShadow(Tier, Point + Normal * 0.015f, SunDir, 160.0f);
        if (Unoccluded)
        {
            // Volumetric Cloud shadow + PlumeFluid smoke shadow!
            float VolumetricTrans = 1.0f;
            if (SunDir.Z > 0.05f)
            {
                const CloudMarchResult SunCloud = MarchClouds(
                    Context.Clouds,
                    ToSpatial(Point),
                    ToSpatial(SunDir),
                    ToSpatial(SunDir),
                    SpectrumRgb{1.0, 1.0, 1.0},
                    18000.0,
                    10u,
                    2u);
                VolumetricTrans *= static_cast<float>(SunCloud.Transmittance);
            }
            if (Context.PlumeFluid != nullptr)
            {
                VolumetricTrans *= Context.PlumeFluid->EvaluateShadowTransmittance(ToArr3(Point + Normal * 0.03f), ToArr3(SunDir), 64.0f);
            }
            Direct = Direct + Context.SunIrradianceRgb * (NdotL * VolumetricTrans);
        }
    }

    // Sky hemisphere ambient fill.
    const float SkyWrap = 0.5f + 0.5f * Normal.Z;
    Direct              = Direct + Vec3{0.26f, 0.34f, 0.48f} * SkyWrap;

    // Dynamic PlumeFluid Fire & Hot-Gas illumination!
    if (Context.PlumeFluid != nullptr)
    {
        const auto FireIrr = Context.PlumeFluid->EvaluateSceneIllumination(ToArr3(Point), ToArr3(Normal));
        Direct             = Direct + Vec3{FireIrr[0], FireIrr[1], FireIrr[2]};
    }

    // Dynamic Colliding Spark illumination!
    if (Context.Sparks != nullptr)
    {
        Direct = Direct + Context.Sparks->EvaluateShadowedSceneIrradiance(Point, Normal);
    }

    // Dynamic Storm Lightning illumination!
    if (Context.Lightning != nullptr)
    {
        Direct = Direct + Context.Lightning->EvaluateSceneFlashIrradiance(Point, Normal);
    }

    return Vec3{
        Albedo.X * Direct.X * (1.0f / PiFloat),
        Albedo.Y * Direct.Y * (1.0f / PiFloat),
        Albedo.Z * Direct.Z * (1.0f / PiFloat)};
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                        DUAL-TIER RESTIR INDIRECT GI RESERVOIR SAMPLING
------------------------------------------------------------------------------------------------------------------------------------------*/
DualTierGiReservoir SdfRestirPortalExtension::SampleRestirIndirectReservoir(
    GpuTracingTier                    Tier,
    Vec3                              ShadingPointWorld,
    Vec3                              ShadingNormalUnit,
    const CoupledWorldOpticalContext& Context,
    uint64_t                          RandomSeed) const noexcept
{
    DualTierGiReservoir Reservoir{};
    SplitMix64Restir    Rng{RandomSeed};
    const uint32_t      CandidateCount = std::max(1u, Context.RestirCandidateK);

    for (uint32_t C = 0u; C < CandidateCount; ++C)
    {
        Vec3 BounceOrigin = ShadingPointWorld + ShadingNormalUnit * 0.025f;
        Vec3 BounceDir    = SampleCosineHemisphere(ShadingNormalUnit, Rng.NextZeroToOne(), Rng.NextZeroToOne());

        // Check if indirect bounce ray traverses a SeamlessPortalAperture -> real cross-portal GI!
        for (const auto& Portal : Portals_)
        {
            float PortalT = 0.0f, U = 0.0f, V = 0.0f;
            if (IntersectBoundedRectangleAperture(
                    BounceOrigin,
                    BounceDir,
                    Portal.EntryCentreWorld,
                    Portal.EntryRightAxis,
                    Portal.EntryUpAxis,
                    Portal.EntryFrontNormal,
                    Portal.HalfWidthMetres,
                    Portal.HalfHeightMetres,
                    40.0f,
                    PortalT,
                    U,
                    V))
            {
                const InternalSurfaceHit PreHit = TraceTierSolidGeometry(Tier, BounceOrigin, BounceDir, PortalT);
                if (!PreHit.Hit)
                {
                    const Vec3 HitOnPortal = BounceOrigin + BounceDir * PortalT;
                    TransformRayAcrossPortal(Portal, HitOnPortal, BounceDir, BounceOrigin, BounceDir);
                    break;
                }
            }
        }

        const InternalSurfaceHit SecHit = TraceTierSolidGeometry(Tier, BounceOrigin, BounceDir, 55.0f);
        Vec3                     CandRadiance{0.0f, 0.0f, 0.0f};
        Vec3                     CandPos = BounceOrigin + BounceDir * 25.0f;
        Vec3                     CandNrm = -BounceDir;

        if (SecHit.Hit)
        {
            CandPos = SecHit.Position;
            CandNrm = SecHit.Normal;
            if (Tier == GpuTracingTier::SignedDistanceFieldGtx && SecHit.CardIndex < SurfaceCards_.size())
            {
                // O(1) SurfaceCard lookup on GTX tier — zero recursive secondary shadow tracing needed!
                const uint32_t Face = SelectPrincipalCardFace(SecHit.Normal);
                CandRadiance        = SurfaceCards_[SecHit.CardIndex].FaceIrradianceCache[Face];
            }
            else
            {
                // RTX tier evaluates exact outgoing triangle radiance + emissive!
                CandRadiance = SecHit.EmissiveRgb +
                               EvaluateDirectSurfaceLighting(Tier, SecHit.Position, SecHit.Normal, SecHit.AlbedoRgb, Context);
            }
        }
        else
        {
            CandRadiance = Vec3{0.18f, 0.25f, 0.36f};
        }

        // Cosine-weighted hemisphere source PDF p(omega) = cos(theta) / pi -> w_i = p_hat / p = L_hat * pi!
        const float TargetPdf  = std::max(1.0e-5f, LuminanceRec709(CandRadiance));
        const float SourcePdf  = std::max(1.0e-4f, Dot(ShadingNormalUnit, Normalise(CandPos - ShadingPointWorld)) / PiFloat);
        const float RisWeight  = TargetPdf / SourcePdf;

        Reservoir.WeightSum += RisWeight;
        ++Reservoir.SampleCountM;
        if (Rng.NextZeroToOne() * Reservoir.WeightSum <= RisWeight)
        {
            Reservoir.SamplePositionWorld = CandPos;
            Reservoir.SampleNormalWorld   = CandNrm;
            Reservoir.SampleRadianceRgb   = CandRadiance;
            Reservoir.TargetPdf           = TargetPdf;
        }
    }

    if (Reservoir.SampleCountM > 0u && Reservoir.TargetPdf > 1.0e-6f)
    {
        Reservoir.IntegrationWeightW = Reservoir.WeightSum /
                                       (static_cast<float>(Reservoir.SampleCountM) * Reservoir.TargetPdf);
    }
    return Reservoir;
}

DualTierGiReservoir SdfRestirPortalExtension::MergeSpatialReservoirs(
    const DualTierGiReservoir& Primary,
    const DualTierGiReservoir& Neighbor,
    Vec3                       PrimaryPoint,
    Vec3                       PrimaryNormal,
    uint64_t                   Seed) noexcept
{
    DualTierGiReservoir Combined = Primary;
    if (Neighbor.SampleCountM == 0u || Neighbor.TargetPdf <= 1.0e-6f)
    {
        return Combined;
    }

    const Vec3  ToSample = Neighbor.SamplePositionWorld - PrimaryPoint;
    const float Dist     = Length(ToSample);
    if (Dist <= 1.0e-3f)
    {
        return Combined;
    }
    const float CosPrimary = std::max(0.0f, Dot(PrimaryNormal, ToSample * (1.0f / Dist)));
    if (CosPrimary <= 0.02f)
    {
        return Combined;
    }

    const uint32_t ClampedM   = std::min(Neighbor.SampleCountM, 12u);
    const float    ShiftedPdf = LuminanceRec709(Neighbor.SampleRadianceRgb) * CosPrimary;
    const float    Weight     = ShiftedPdf * Neighbor.IntegrationWeightW * static_cast<float>(ClampedM);

    SplitMix64Restir Rng{Seed};
    Combined.WeightSum += Weight;
    Combined.SampleCountM += ClampedM;
    if (Rng.NextZeroToOne() * Combined.WeightSum <= Weight)
    {
        Combined.SamplePositionWorld = Neighbor.SamplePositionWorld;
        Combined.SampleNormalWorld   = Neighbor.SampleNormalWorld;
        Combined.SampleRadianceRgb   = Neighbor.SampleRadianceRgb;
        Combined.TargetPdf           = ShiftedPdf;
    }

    if (Combined.SampleCountM > 0u && Combined.TargetPdf > 1.0e-6f)
    {
        Combined.IntegrationWeightW = Combined.WeightSum /
                                      (static_cast<float>(Combined.SampleCountM) * Combined.TargetPdf);
    }
    return Combined;
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                   COUPLED RADIANCE RAY (MIRRORS, PORTALS, WATER & VOLUMETRICS)
------------------------------------------------------------------------------------------------------------------------------------------*/
TracedRayDiagnostics SdfRestirPortalExtension::TraceCoupledRadianceRay(
    GpuTracingTier                    Tier,
    Vec3                              RayOriginWorld,
    Vec3                              RayDirectionUnit,
    const CoupledWorldOpticalContext& Context,
    uint64_t                          PixelRandomSeed) const noexcept
{
    TracedRayDiagnostics Out{};
    Vec3                 CurrOrigin     = RayOriginWorld;
    Vec3                 CurrDir        = Normalise(RayDirectionUnit);
    Vec3                 Throughput{1.0f, 1.0f, 1.0f};
    Vec3                 AccumRadiance{0.0f, 0.0f, 0.0f};
    const uint32_t       MaxBounces     = std::min(6u, Context.MaxApertureBounces + 1u);

    for (uint32_t Bounce = 0u; Bounce < MaxBounces; ++Bounce)
    {
        float BestDistance = 1.0e6f;

        // 1. Solid scene hit in chosen GPU tier (GTX SDF or RTX BVH).
        const InternalSurfaceHit SolidHit = TraceTierSolidGeometry(Tier, CurrOrigin, CurrDir, BestDistance);
        if (SolidHit.Hit)
        {
            BestDistance = SolidHit.DistanceM;
        }

        // 2. Check Planar Mirrors in front of SolidHit!
        int   HitMirrorIdx = -1;
        float MirrorU = 0.0f, MirrorV = 0.0f;
        for (size_t M = 0u; M < Mirrors_.size(); ++M)
        {
            float T = 0.0f, U = 0.0f, V = 0.0f;
            if (IntersectBoundedRectangleAperture(
                    CurrOrigin,
                    CurrDir,
                    Mirrors_[M].CentreWorld,
                    Mirrors_[M].RightAxis,
                    Mirrors_[M].UpAxis,
                    Mirrors_[M].FrontNormal,
                    Mirrors_[M].HalfWidthMetres,
                    Mirrors_[M].HalfHeightMetres,
                    BestDistance,
                    T,
                    U,
                    V))
            {
                BestDistance = T;
                HitMirrorIdx = static_cast<int>(M);
                MirrorU      = U;
                MirrorV      = V;
            }
        }

        // 3. Check Seamless Portals in front of SolidHit / Mirror!
        int   HitPortalIdx = -1;
        float PortalU = 0.0f, PortalV = 0.0f;
        for (size_t P = 0u; P < Portals_.size(); ++P)
        {
            float T = 0.0f, U = 0.0f, V = 0.0f;
            if (IntersectBoundedRectangleAperture(
                    CurrOrigin,
                    CurrDir,
                    Portals_[P].EntryCentreWorld,
                    Portals_[P].EntryRightAxis,
                    Portals_[P].EntryUpAxis,
                    Portals_[P].EntryFrontNormal,
                    Portals_[P].HalfWidthMetres,
                    Portals_[P].HalfHeightMetres,
                    BestDistance,
                    T,
                    U,
                    V))
            {
                BestDistance = T;
                HitPortalIdx = static_cast<int>(P);
                HitMirrorIdx = -1;
                PortalU      = U;
                PortalV      = V;
            }
        }

        // 4. Check 2.5D Shallow-Water & Mud free-surface sheet (strictly zero foam & zero splash)!
        bool               HitWater     = false;
        SurfaceFluidSample WaterSample{};
        Vec3               WaterHitPt{};
        if (Context.ShallowWater != nullptr && CurrDir.Z < -1.0e-4f)
        {
            // Short heightfield secant march from z <= 1.5 m down to the water/mud surface!
            const auto& WCfg = Context.ShallowWater->Configuration();
            const float TTop = std::max(0.0f, (1.6f - CurrOrigin.Z) / CurrDir.Z);
            const float TBot = std::min(BestDistance, (-1.6f - CurrOrigin.Z) / CurrDir.Z);
            if (TBot > TTop)
            {
                const int   Steps = 20;
                const float Dt    = (TBot - TTop) / static_cast<float>(Steps);
                for (int S = 0; S <= Steps; ++S)
                {
                    const float T  = TTop + static_cast<float>(S) * Dt;
                    const Vec3  Pt = CurrOrigin + CurrDir * T;
                    if (Pt.X >= WCfg.WorldOriginXY[0] && Pt.Y >= WCfg.WorldOriginXY[1] &&
                        Pt.X <= WCfg.WorldOriginXY[0] + static_cast<float>(WCfg.CellsX) * WCfg.CellSizeMetres &&
                        Pt.Y <= WCfg.WorldOriginXY[1] + static_cast<float>(WCfg.CellsY) * WCfg.CellSizeMetres)
                    {
                        const SurfaceFluidSample Samp = Context.ShallowWater->SampleSurface({Pt.X, Pt.Y});
                        if (Samp.FluidDepthMetres > 0.0015f && Pt.Z <= Samp.FreeSurfaceElevationM)
                        {
                            BestDistance = T;
                            HitWater     = true;
                            HitMirrorIdx = -1;
                            HitPortalIdx = -1;
                            WaterSample  = Samp;
                            WaterHitPt   = Vec3{Pt.X, Pt.Y, Samp.FreeSurfaceElevationM};
                            break;
                        }
                    }
                }
            }
        }

        // Integrate PlumeFluid smoke/fire + Fog along the segment BEFORE the mirror, portal, water, solid, or sky!
        const bool EscapedToSky = (!SolidHit.Hit && HitMirrorIdx < 0 && HitPortalIdx < 0 && !HitWater);
        const Vec3 SegmentVol   = EvaluateVolumetricSegmentAndSky(
            CurrOrigin,
            CurrDir,
            BestDistance,
            EscapedToSky,
            Context,
            Out.PlumeOpticalOpacity,
            Out.CloudReflectionLuminance);

        if (EscapedToSky)
        {
            AccumRadiance = AccumRadiance + Vec3{
                Throughput.X * SegmentVol.X,
                Throughput.Y * SegmentVol.Y,
                Throughput.Z * SegmentVol.Z};
            break;
        }

        // Attenuate throughput by pre-surface fog + plume transmittance and add in-scattered plume/fog!
        const double SegFogT = FogTransmittance(Context.Fog, ToSpatial(CurrOrigin), ToSpatial(CurrDir), BestDistance);
        float        SegPlumeT = 1.0f;
        if (Context.PlumeFluid != nullptr)
        {
            SegPlumeT = Context.PlumeFluid->EvaluateShadowTransmittance(ToArr3(CurrOrigin), ToArr3(CurrDir), std::min(BestDistance, 120.0f));
        }

        AccumRadiance = AccumRadiance + Vec3{
            Throughput.X * SegmentVol.X,
            Throughput.Y * SegmentVol.Y,
            Throughput.Z * SegmentVol.Z};
        Throughput = Throughput * static_cast<float>(SegFogT) * SegPlumeT;

        // Case A: Seamless Portal transition!
        if (HitPortalIdx >= 0)
        {
            const auto& Portal  = Portals_[static_cast<size_t>(HitPortalIdx)];
            const float EdgeGap = std::min(Portal.HalfWidthMetres - std::abs(PortalU), Portal.HalfHeightMetres - std::abs(PortalV));
            if (EdgeGap < 0.045f)
            {
                AccumRadiance = AccumRadiance + Vec3{
                    Throughput.X * Portal.PortalRimGlowRgb.X,
                    Throughput.Y * Portal.PortalRimGlowRgb.Y,
                    Throughput.Z * Portal.PortalRimGlowRgb.Z};
                break;
            }
            const Vec3 HitPt = CurrOrigin + CurrDir * BestDistance;
            TransformRayAcrossPortal(Portal, HitPt, CurrDir, CurrOrigin, CurrDir);
            ++Out.PortalTransitions;
            continue;
        }

        // Case B: Planar Mirror reflection!
        if (HitMirrorIdx >= 0)
        {
            const auto& Mirror  = Mirrors_[static_cast<size_t>(HitMirrorIdx)];
            const float EdgeGap = std::min(Mirror.HalfWidthMetres - std::abs(MirrorU), Mirror.HalfHeightMetres - std::abs(MirrorV));
            if (EdgeGap < 0.05f)
            {
                AccumRadiance = AccumRadiance + Vec3{
                    Throughput.X * Mirror.FrameTintRgb.X,
                    Throughput.Y * Mirror.FrameTintRgb.Y,
                    Throughput.Z * Mirror.FrameTintRgb.Z};
                break;
            }
            const Vec3 HitPt = CurrOrigin + CurrDir * BestDistance;
            CurrDir          = Normalise(CurrDir - Mirror.FrontNormal * (2.0f * Dot(CurrDir, Mirror.FrontNormal)));
            CurrOrigin       = HitPt + Mirror.FrontNormal * 0.015f;
            Throughput       = Vec3{
                Throughput.X * Mirror.ReflectanceTint.X,
                Throughput.Y * Mirror.ReflectanceTint.Y,
                Throughput.Z * Mirror.ReflectanceTint.Z};
            ++Out.MirrorReflections;
            continue;
        }

        // Case C: 2.5D Puddle / Shallow-Water / Bingham-Mud surface (reflects Clouds, Fog, Plume, Portals — NO foam/splash)!
        if (HitWater)
        {
            Out.HitWaterSurface = true;
            const Vec3  WaterN  = Normalise(Vec3{
                WaterSample.SurfaceNormal[0],
                WaterSample.SurfaceNormal[1],
                WaterSample.SurfaceNormal[2]});
            const float CosV    = std::clamp(Dot(-CurrDir, WaterN), 0.0f, 1.0f);
            const float MudC    = std::clamp(WaterSample.MudConcentration, 0.0f, 1.0f);
            const float F0      = 0.02f + 0.015f * MudC;
            const float Fresnel = F0 + (1.0f - F0) * std::pow(1.0f - CosV, 5.0f);

            // Refracted / absorbed bed & mud body radiance (strictly NO foam whitecaps!).
            const Vec3 ClearBedTint{0.18f, 0.20f, 0.22f};
            const Vec3 RichMudTint{0.22f, 0.14f, 0.08f};
            const float DepthM = WaterSample.FluidDepthMetres;
            const Vec3  WaterAbsorb{
                std::exp(-DepthM * (0.45f + 6.0f * MudC)),
                std::exp(-DepthM * (0.18f + 7.5f * MudC)),
                std::exp(-DepthM * (0.12f + 9.5f * MudC))};
            const Vec3 BodyAlbedo{
                ClearBedTint.X * WaterAbsorb.X * (1.0f - MudC) + RichMudTint.X * MudC,
                ClearBedTint.Y * WaterAbsorb.Y * (1.0f - MudC) + RichMudTint.Y * MudC,
                ClearBedTint.Z * WaterAbsorb.Z * (1.0f - MudC) + RichMudTint.Z * MudC};
            const Vec3 BodyRadiance = EvaluateDirectSurfaceLighting(Tier, WaterHitPt, WaterN, BodyAlbedo, Context);

            AccumRadiance = AccumRadiance + Vec3{
                Throughput.X * BodyRadiance.X * (1.0f - Fresnel),
                Throughput.Y * BodyRadiance.Y * (1.0f - Fresnel),
                Throughput.Z * BodyRadiance.Z * (1.0f - Fresnel)};

            // Continue tracing the Fresnel reflection ray so puddles & shallow water reflect Clouds, Fog & PlumeFluid!
            CurrDir    = Normalise(CurrDir - WaterN * (2.0f * Dot(CurrDir, WaterN)));
            CurrOrigin = WaterHitPt + WaterN * 0.015f;
            Throughput = Throughput * (Fresnel * (1.0f - 0.55f * MudC));
            continue;
        }

        // Case D: Solid geometry hit — Direct (Sun + Cloud/Plume shadows + Fire + Sparks + Lightning) + ReSTIR Indirect GI!
        Out.HitSolidGeometry = true;
        const Vec3 DirectRad = EvaluateDirectSurfaceLighting(
            Tier,
            SolidHit.Position,
            SolidHit.Normal,
            SolidHit.AlbedoRgb,
            Context);

        const DualTierGiReservoir GiRes = SampleRestirIndirectReservoir(
            Tier,
            SolidHit.Position,
            SolidHit.Normal,
            Context,
            PixelRandomSeed ^ (Bounce * 0x9E3779B97F4A7C15ull));

        const Vec3 IndirectIrr = GiRes.SampleRadianceRgb * std::min(4.0f, GiRes.IntegrationWeightW);
        const Vec3 IndirectRad{
            SolidHit.AlbedoRgb.X * IndirectIrr.X * (1.0f / PiFloat),
            SolidHit.AlbedoRgb.Y * IndirectIrr.Y * (1.0f / PiFloat),
            SolidHit.AlbedoRgb.Z * IndirectIrr.Z * (1.0f / PiFloat)};

        const Vec3 TotalSurface = SolidHit.EmissiveRgb + DirectRad + IndirectRad;
        AccumRadiance           = AccumRadiance + Vec3{
            Throughput.X * TotalSurface.X,
            Throughput.Y * TotalSurface.Y,
            Throughput.Z * TotalSurface.Z};
        break;
    }

    Out.FinalRadianceRgb = AccumRadiance;
    return Out;
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                     VIEWPORT RGBA8 RENDERER
------------------------------------------------------------------------------------------------------------------------------------------*/
void SdfRestirPortalExtension::RenderViewportRgba8(
    GpuTracingTier                    Tier,
    uint32_t                          Width,
    uint32_t                          Height,
    Vec3                              CameraOriginWorld,
    Vec3                              CameraTargetWorld,
    float                             VerticalFovRadians,
    const CoupledWorldOpticalContext& Context,
    std::vector<uint8_t>&             OutRgba8Pixels) const
{
    OutRgba8Pixels.assign(static_cast<size_t>(Width) * Height * 4u, 255u);
    if (Width == 0u || Height == 0u)
    {
        return;
    }

    const Vec3  Forward = Normalise(CameraTargetWorld - CameraOriginWorld);
    const Vec3  Right   = Normalise(Cross(Forward, Vec3{0.0f, 0.0f, 1.0f}));
    const Vec3  Up      = Cross(Right, Forward);
    const float TanHalf = std::tan(0.5f * VerticalFovRadians);
    const float Aspect  = static_cast<float>(Width) / static_cast<float>(Height);

    for (uint32_t Py = 0u; Py < Height; ++Py)
    {
        const float NdcY = 1.0f - 2.0f * (static_cast<float>(Py) + 0.5f) / static_cast<float>(Height);
        for (uint32_t Px = 0u; Px < Width; ++Px)
        {
            const float NdcX = (2.0f * (static_cast<float>(Px) + 0.5f) / static_cast<float>(Width) - 1.0f) * Aspect;
            const Vec3  Dir  = Normalise(Forward + Right * (NdcX * TanHalf) + Up * (NdcY * TanHalf));
            const uint64_t Seed = (static_cast<uint64_t>(Py) * 1920ull + Px + 1ull) * 0x9E3779B97F4A7C15ull;

            const TracedRayDiagnostics Diag = TraceCoupledRadianceRay(Tier, CameraOriginWorld, Dir, Context, Seed);
            const size_t               Idx  = (static_cast<size_t>(Py) * Width + Px) * 4u;
            OutRgba8Pixels[Idx + 0u]        = AcesFilmicByte(Diag.FinalRadianceRgb.X);
            OutRgba8Pixels[Idx + 1u]        = AcesFilmicByte(Diag.FinalRadianceRgb.Y);
            OutRgba8Pixels[Idx + 2u]        = AcesFilmicByte(Diag.FinalRadianceRgb.Z);
            OutRgba8Pixels[Idx + 3u]        = 255u;
        }
    }
}

} // namespace Frontier
