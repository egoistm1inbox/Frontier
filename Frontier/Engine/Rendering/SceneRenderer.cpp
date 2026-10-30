/*==========================================================================================================================================
                                                SDFRESTIRPORTALEXTENSION.CPP
==========================================================================================================================================*/
// 🧩 Dual-tier GI & reflections:
//    - GTX (SignedDistanceFieldGtx): SDF + OrientedSurfaceCard ReSTIR GI + Software BVH Triangle Reflections!
//    - RTX (HardwareRayTracingRtx):  Full Hardware RT RayQuery for BOTH ReSTIR GI and Reflections/Shadows/Glass!
//    Includes Solid-Angle Area Luminaires, Closed-Dielectric Glass, Screen-Space Spatial Reuse, 3-Step A-Trous
//    Denoising, Multi-Scale HDR Bloom, Chromatic AgX/ACES Tone Mapping, and Full Celestial/Volumetric Coupling.

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             INCLUDES
------------------------------------------------------------------------------------------------------------------------------------------*/
#include "Engine/Rendering/SceneRenderer.h"

#include <algorithm>
#include <cmath>
#include <thread>

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

[[nodiscard]] Vec3 ClampRadianceFirefly(Vec3 Rgb, float MaxLuminance) noexcept
{
    const float Lum = LuminanceRec709(Rgb);
    if (Lum <= MaxLuminance || Lum <= 1.0e-6f)
    {
        return Rgb;
    }
    // Soft rational shoulder instead of hard clamp so bright highlights retain smooth ordering.
    const float SoftLum = MaxLuminance * (1.0f + std::log(1.0f + (Lum - MaxLuminance) / MaxLuminance) * 0.35f);
    return Rgb * (SoftLum / Lum);
}

[[nodiscard]] Vec3 SampleCosineHemisphere(Vec3 NormalUnit, float U1, float U2) noexcept
{
    const float R     = std::sqrt(std::clamp(U1, 0.0f, 1.0f));
    const float Phi   = 2.0f * PiFloat * U2;
    const float LocX  = R * std::cos(Phi);
    const float LocY  = R * std::sin(Phi);
    const float LocZ  = std::sqrt(std::max(0.0f, 1.0f - U1));

    const Vec3 TangentRef = (std::abs(NormalUnit.Z) < 0.92f) ? Vec3{0.0f, 0.0f, 1.0f} : Vec3{1.0f, 0.0f, 0.0f};
    const Vec3 TanU       = Normalise(Cross(TangentRef, NormalUnit));
    const Vec3 TanV       = Cross(NormalUnit, TanU);
    return Normalise(TanU * LocX + TanV * LocY + NormalUnit * LocZ);
}

[[nodiscard]] Vec3 SampleGgxHalfVector(Vec3 NormalUnit, float Roughness, float U1, float U2) noexcept
{
    const float Alpha  = std::max(0.02f, Roughness * Roughness);
    const float Alpha2 = Alpha * Alpha;
    const float Phi    = 2.0f * PiFloat * U1;
    const float CosT2  = (1.0f - U2) / std::max(1.0e-6f, 1.0f + (Alpha2 - 1.0f) * U2);
    const float CosT   = std::sqrt(std::clamp(CosT2, 0.0f, 1.0f));
    const float SinT   = std::sqrt(std::max(0.0f, 1.0f - CosT2));

    const Vec3 TangentRef = (std::abs(NormalUnit.Z) < 0.92f) ? Vec3{0.0f, 0.0f, 1.0f} : Vec3{1.0f, 0.0f, 0.0f};
    const Vec3 TanU       = Normalise(Cross(TangentRef, NormalUnit));
    const Vec3 TanV       = Cross(NormalUnit, TanU);
    return Normalise(TanU * (SinT * std::cos(Phi)) + TanV * (SinT * std::sin(Phi)) + NormalUnit * CosT);
}

[[nodiscard]] Vec3 EnvBrdfSplitSumApprox(Vec3 F0, float Roughness, float NdotV) noexcept
{
    const float C0X = -1.0f, C0Y = -0.0275f, C0Z = -0.572f, C0W = 0.022f;
    const float C1X = 1.0f,  C1Y = 0.0425f,  C1Z = 1.04f,   C1W = -0.04f;
    const float RX  = Roughness * C0X + C1X;
    const float RY  = Roughness * C0Y + C1Y;
    const float RZ  = Roughness * C0Z + C1Z;
    const float RW  = Roughness * C0W + C1W;
    const float A004 = std::min(RX * RX, std::exp2(-9.28f * NdotV)) * RX + RY;
    const float Scale = -1.04f * A004 + RZ;
    const float Bias  = 1.04f * A004 + RW;
    return Vec3{
        std::clamp(F0.X * Scale + Bias, 0.0f, 1.0f),
        std::clamp(F0.Y * Scale + Bias, 0.0f, 1.0f),
        std::clamp(F0.Z * Scale + Bias, 0.0f, 1.0f)};
}

[[nodiscard]] float ExactDielectricFresnel(float CosThetaI, float EtaIncident, float EtaTransmitted) noexcept
{
    const float CosI  = std::clamp(CosThetaI, 0.0f, 1.0f);
    const float Eta   = EtaIncident / std::max(1.0e-4f, EtaTransmitted);
    const float SinT2 = Eta * Eta * std::max(0.0f, 1.0f - CosI * CosI);
    if (SinT2 >= 1.0f)
    {
        return 1.0f; // Total internal reflection!
    }
    const float CosT = std::sqrt(std::max(0.0f, 1.0f - SinT2));
    const float Rs   = (EtaIncident * CosI - EtaTransmitted * CosT) /
                       std::max(1.0e-5f, EtaIncident * CosI + EtaTransmitted * CosT);
    const float Rp   = (EtaTransmitted * CosI - EtaIncident * CosT) /
                       std::max(1.0e-5f, EtaTransmitted * CosI + EtaIncident * CosT);
    return std::clamp(0.5f * (Rs * Rs + Rp * Rp), 0.0f, 1.0f);
}

[[nodiscard]] bool RefractSnell(Vec3 IncidentUnit, Vec3 InterfaceNormal, float EtaRatio, Vec3& OutRefractedUnit) noexcept
{
    const float CosI  = std::clamp(-Dot(IncidentUnit, InterfaceNormal), 0.0f, 1.0f);
    const float SinT2 = EtaRatio * EtaRatio * std::max(0.0f, 1.0f - CosI * CosI);
    if (SinT2 >= 1.0f)
    {
        return false;
    }
    const float CosT = std::sqrt(std::max(0.0f, 1.0f - SinT2));
    OutRefractedUnit = Normalise(IncidentUnit * EtaRatio + InterfaceNormal * (EtaRatio * CosI - CosT));
    return true;
}

[[nodiscard]] bool IntersectRayAabbDist(Vec3 Orig, Vec3 InvDir, Vec3 BMin, Vec3 BMax, float MaxT, float& OutEntryT) noexcept
{
    float T1   = (BMin.X - Orig.X) * InvDir.X;
    float T2   = (BMax.X - Orig.X) * InvDir.X;
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

    OutEntryT = std::max(0.0f, TMin);
    return (TMax >= OutEntryT) && (OutEntryT < MaxT);
}

[[nodiscard]] bool IntersectRayTriangleMollerTrumbore(
    Vec3                    Orig,
    Vec3                    Dir,
    const RtxSceneTriangle& Tri,
    float                   MaxT,
    float&                  OutT,
    float&                  OutBaryU,
    float&                  OutBaryV) noexcept
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
    if (HitT <= 1.5e-4f || HitT >= MaxT)
    {
        return false;
    }
    OutT     = HitT;
    OutBaryU = U;
    OutBaryV = V;
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
        return false; // Approach from front hemisphere of mirror or portal!
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

[[nodiscard]] bool IntersectPortalAperture(
    Vec3                          RayOrigin,
    Vec3                          RayDirUnit,
    const SeamlessPortalAperture& Portal,
    float                         MaxDistance,
    float&                        OutHitT,
    float&                        OutLocalU,
    float&                        OutLocalV) noexcept
{
    const float Denom = Dot(RayDirUnit, Portal.EntryFrontNormal);
    if (Denom >= -1.0e-4f)
    {
        return false;
    }
    const float T = Dot(Portal.EntryCentreWorld - RayOrigin, Portal.EntryFrontNormal) / Denom;
    if (T <= 1.0e-3f || T >= MaxDistance)
    {
        return false;
    }
    const Vec3  HitPt = RayOrigin + RayDirUnit * T;
    const Vec3  Rel   = HitPt - Portal.EntryCentreWorld;
    const float U     = Dot(Rel, Portal.EntryRightAxis);
    const float V     = Dot(Rel, Portal.EntryUpAxis);

    if (Portal.Shape == PortalApertureShape::Circular)
    {
        const float Rad = (Portal.RadiusMetres > 0.05f)
            ? Portal.RadiusMetres
            : std::min(Portal.HalfWidthMetres, Portal.HalfHeightMetres);
        if ((U * U + V * V) > (Rad * Rad))
        {
            return false;
        }
    }
    else if (std::abs(U) > Portal.HalfWidthMetres || std::abs(V) > Portal.HalfHeightMetres)
    {
        return false;
    }

    OutHitT   = T;
    OutLocalU = U;
    OutLocalV = V;
    return true;
}

[[nodiscard]] float PortalApertureEdgeGap(const SeamlessPortalAperture& Portal, float LocalU, float LocalV) noexcept
{
    if (Portal.Shape == PortalApertureShape::Circular)
    {
        const float Rad = (Portal.RadiusMetres > 0.05f)
            ? Portal.RadiusMetres
            : std::min(Portal.HalfWidthMetres, Portal.HalfHeightMetres);
        return Rad - std::sqrt(LocalU * LocalU + LocalV * LocalV);
    }
    return std::min(Portal.HalfWidthMetres - std::abs(LocalU), Portal.HalfHeightMetres - std::abs(LocalV));
}

// Deterministic blue-noise / interleaved-gradient-like ray phase jitter in [0.02, 0.98] for zero-banding clouds & plumes!
[[nodiscard]] float ComputeRayPhaseJitter01(Vec3 Origin, Vec3 DirUnit) noexcept
{
    const double Sx = static_cast<double>(DirUnit.X) * 1879.137 + static_cast<double>(Origin.X) * 19.731;
    const double Sy = static_cast<double>(DirUnit.Y) * 2971.619 + static_cast<double>(Origin.Y) * 31.193;
    const double Sz = static_cast<double>(DirUnit.Z) * 4127.831 + static_cast<double>(Origin.Z) * 47.519;
    const double Inner = std::fmod(std::abs(Sx * 0.06711056 + Sy * 0.00583715 + Sz * 0.03197421), 1.0);
    const double Ign   = std::fmod(52.9829189 * Inner, 1.0);
    return static_cast<float>(0.02 + 0.96 * Ign);
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

[[nodiscard]] float HashGrid2D(int Ix, int Iy, uint32_t Seed) noexcept
{
    uint32_t H = static_cast<uint32_t>(Ix) * 374761393u + static_cast<uint32_t>(Iy) * 668265263u + Seed * 2246822519u;
    H          = (H ^ (H >> 13u)) * 1274126177u;
    H ^= (H >> 16u);
    return static_cast<float>(H & 0x00FFFFFFu) * (1.0f / 16777215.0f);
}

[[nodiscard]] float QuinticSmoothNoise2D(float X, float Y, uint32_t Seed) noexcept
{
    const float Fx = std::floor(X);
    const float Fy = std::floor(Y);
    const int   Ix = static_cast<int>(Fx);
    const int   Iy = static_cast<int>(Fy);
    const float Tx = X - Fx;
    const float Ty = Y - Fy;
    const float Ux = Tx * Tx * Tx * (Tx * (Tx * 6.0f - 15.0f) + 10.0f);
    const float Uy = Ty * Ty * Ty * (Ty * (Ty * 6.0f - 15.0f) + 10.0f);

    const float N00 = HashGrid2D(Ix, Iy, Seed);
    const float N10 = HashGrid2D(Ix + 1, Iy, Seed);
    const float N01 = HashGrid2D(Ix, Iy + 1, Seed);
    const float N11 = HashGrid2D(Ix + 1, Iy + 1, Seed);
    const float Nx0 = N00 + (N10 - N00) * Ux;
    const float Nx1 = N01 + (N11 - N01) * Ux;
    return Nx0 + (Nx1 - Nx0) * Uy;
}

// Band-limited multi-octave mineral stone/asphalt aggregate detail so dry floors and submerged puddle beds
// exhibit crisp architectural micro-texture with zero distant aliasing!
void EvaluateMineralGroundDetail(
    Vec3   WorldPoint,
    float  RayDistanceM,
    Vec3&  InOutAlbedo,
    float& InOutRoughness,
    Vec3&  InOutNormal) noexcept
{
    const float MipCoarse = 1.0f / (1.0f + 0.03f * RayDistanceM);
    const float MipFine   = 1.0f / (1.0f + 0.14f * RayDistanceM * RayDistanceM);

    const float MacroVar  = QuinticSmoothNoise2D(WorldPoint.X * 0.55f, WorldPoint.Y * 0.55f, 11u) - 0.5f;
    const float MesoVar   = QuinticSmoothNoise2D(WorldPoint.X * 2.40f, WorldPoint.Y * 2.40f, 37u) - 0.5f;
    const float FineGrain = QuinticSmoothNoise2D(WorldPoint.X * 11.5f, WorldPoint.Y * 11.5f, 73u) - 0.5f;
    const float Quartz    = QuinticSmoothNoise2D(WorldPoint.X * 29.0f, WorldPoint.Y * 29.0f, 131u) - 0.5f;

    // Subtle 3.5 m architectural expansion-joint grid lines (smoothly filtered out at grazing/far distances).
    const float TilePhaseX = std::abs(WorldPoint.X * (1.0f / 3.5f) - std::round(WorldPoint.X * (1.0f / 3.5f))) * 3.5f;
    const float TilePhaseY = std::abs(WorldPoint.Y * (1.0f / 3.5f) - std::round(WorldPoint.Y * (1.0f / 3.5f))) * 3.5f;
    const float SeamDist   = std::min(TilePhaseX, TilePhaseY);
    const float SeamFactor = (SeamDist < 0.022f) ? (1.0f - SeamDist / 0.022f) * MipFine : 0.0f;

    const float AlbedoMod = 1.0f +
                            0.13f * MacroVar * MipCoarse +
                            0.10f * MesoVar * MipCoarse +
                            0.12f * FineGrain * MipFine +
                            0.09f * Quartz * MipFine -
                            0.24f * SeamFactor;

    InOutAlbedo = Vec3{
        std::clamp(InOutAlbedo.X * AlbedoMod, 0.015f, 0.96f),
        std::clamp(InOutAlbedo.Y * (AlbedoMod + 0.012f * MesoVar * MipCoarse), 0.015f, 0.96f),
        std::clamp(InOutAlbedo.Z * (AlbedoMod - 0.015f * MacroVar * MipCoarse), 0.015f, 0.96f)};

    InOutRoughness = std::clamp(
        InOutRoughness - 0.09f * MacroVar * MipCoarse + 0.08f * FineGrain * MipFine + 0.12f * SeamFactor,
        0.08f,
        0.95f);

    if (std::abs(InOutNormal.Z) > 0.7f && MipFine > 0.05f)
    {
        const float Eps = 0.035f;
        const float Hx  = QuinticSmoothNoise2D((WorldPoint.X + Eps) * 9.5f, WorldPoint.Y * 9.5f, 73u) -
                         QuinticSmoothNoise2D((WorldPoint.X - Eps) * 9.5f, WorldPoint.Y * 9.5f, 73u);
        const float Hy = QuinticSmoothNoise2D(WorldPoint.X * 9.5f, (WorldPoint.Y + Eps) * 9.5f, 73u) -
                         QuinticSmoothNoise2D(WorldPoint.X * 9.5f, (WorldPoint.Y - Eps) * 9.5f, 73u);
        const float BumpScale = 0.028f * MipFine;
        InOutNormal           = Normalise(InOutNormal + Vec3{-Hx * BumpScale, -Hy * BumpScale, 0.0f});
    }
}

// Smooth, continuous multi-directional capillary wind micro-ripples on liquid water (strictly zero foam & zero splash!).
[[nodiscard]] Vec3 EvaluateCapillaryWaterNormal(
    Vec3  BaseHydroNormal,
    Vec3  WaterWorldPoint,
    float FluidDepthMetres,
    float MudFraction,
    float RayDistanceM,
    float RippleStrength,
    float RainRingIntensity = 0.0f) noexcept
{
    if (RippleStrength <= 1.0e-5f && RainRingIntensity <= 1.0e-5f)
    {
        return BaseHydroNormal;
    }
    const float ShoreDamp = std::clamp((FluidDepthMetres - 0.003f) / 0.018f, 0.0f, 1.0f);
    const float ViscDamp  = 1.0f - 0.78f * std::clamp(MudFraction, 0.0f, 1.0f);
    const float DistDamp  = 1.0f / (1.0f + 0.055f * RayDistanceM);
    const float Amp       = RippleStrength * ShoreDamp * ViscDamp * DistDamp;

    const float X = WaterWorldPoint.X;
    const float Y = WaterWorldPoint.Y;
    // Four incommensurate capillary wave vectors so zero grid periodicity appears.
    const float P0 = 7.4f * X + 3.1f * Y + 0.8f;
    const float P1 = -4.9f * X + 8.7f * Y + 2.1f;
    const float P2 = 13.6f * X - 6.3f * Y + 4.3f;
    const float P3 = 3.2f * X + 16.8f * Y + 1.4f;

    float SlopeX = Amp * (0.42f * std::cos(P0) - 0.31f * std::cos(P1) + 0.16f * std::cos(P2) + 0.11f * std::cos(P3));
    float SlopeY = Amp * (0.19f * std::cos(P0) + 0.52f * std::cos(P1) - 0.08f * std::cos(P2) + 0.24f * std::cos(P3));

    // Concentric expanding capillary raindrop impact rings on puddles (normal perturbation ONLY — ZERO foam, ZERO splash!):
    if (RainRingIntensity > 1.0e-4f && ShoreDamp > 0.02f)
    {
        const float RingAmp = 0.048f * RainRingIntensity * ShoreDamp * ViscDamp / (1.0f + 0.08f * RayDistanceM);
        constexpr float CellScale = 1.65f; // ~0.60 m stochastic raindrop ring cells
        const float Gx = X * CellScale;
        const float Gy = Y * CellScale;
        const float BaseIx = std::floor(Gx);
        const float BaseIy = std::floor(Gy);
        for (int Dj = -1; Dj <= 1; ++Dj)
        {
            for (int Di = -1; Di <= 1; ++Di)
            {
                const float Cx = BaseIx + static_cast<float>(Di);
                const float Cy = BaseIy + static_cast<float>(Dj);
                const float H1 = std::sin(Cx * 127.1f + Cy * 311.7f) * 43758.5453f;
                const float H2 = std::sin(Cx * 269.5f + Cy * 183.3f) * 24634.6345f;
                const float H3 = std::sin(Cx * 419.2f + Cy * 371.9f) * 19283.7465f;
                const float Ox = H1 - std::floor(H1);
                const float Oy = H2 - std::floor(H2);
                const float Age = H3 - std::floor(H3); // Ring expansion age [0..1]
                const float Rx  = (Gx - (Cx + 0.15f + 0.70f * Ox)) / CellScale;
                const float Ry  = (Gy - (Cy + 0.15f + 0.70f * Oy)) / CellScale;
                const float R   = std::sqrt(Rx * Rx + Ry * Ry);
                const float WaveFront = 0.04f + 0.34f * Age;
                const float Band      = R - WaveFront;
                if (R > 0.008f && std::abs(Band) < 0.11f)
                {
                    const float Envelope = std::exp(-210.0f * Band * Band) * (1.0f - Age) * std::exp(-3.2f * R);
                    const float dWave    = std::sin(Band * 88.0f) * Envelope * RingAmp / R;
                    SlopeX += Rx * dWave;
                    SlopeY += Ry * dWave;
                }
            }
        }
    }

    return Normalise(Vec3{BaseHydroNormal.X - SlopeX, BaseHydroNormal.Y - SlopeY, BaseHydroNormal.Z});
}

// Chromatic-preserving AgX/ACES filmic tone-mapping: bright emissive cores smoothly desaturate to warm
// incandescent white instead of clipping R/G/B channels independently into flat yellow/cyan blocks!
void ChromaticAgxAcesTonemapSrgb(
    Vec3     LinearHdr,
    float    ExposureScale,
    uint8_t& OutR,
    uint8_t& OutG,
    uint8_t& OutB) noexcept
{
    Vec3 Scaled{
        std::max(0.0f, LinearHdr.X * ExposureScale),
        std::max(0.0f, LinearHdr.Y * ExposureScale),
        std::max(0.0f, LinearHdr.Z * ExposureScale)};

    // Slight AgX-style crosstalk inset before filmic curve prevents saturated neon/fire clipping to ugly primary hues!
    const float Lum = LuminanceRec709(Scaled);
    const Vec3  Inset{
        0.86f * Scaled.X + 0.09f * Scaled.Y + 0.05f * Scaled.Z,
        0.06f * Scaled.X + 0.89f * Scaled.Y + 0.05f * Scaled.Z,
        0.05f * Scaled.X + 0.09f * Scaled.Y + 0.86f * Scaled.Z};

    auto AcesCurve = [](float X) noexcept -> float
    {
        return std::clamp((X * (2.51f * X + 0.03f)) / (X * (2.43f * X + 0.59f) + 0.14f), 0.0f, 1.0f);
    };

    Vec3 Mapped{AcesCurve(Inset.X), AcesCurve(Inset.Y), AcesCurve(Inset.Z)};

    // High-HDR highlight desaturation toward incandescent white core (physically matching sensor saturation).
    const float CoreWhiten = std::clamp((Lum - 2.2f) / (Lum + 6.5f), 0.0f, 0.72f);
    const float MappedLum  = AcesCurve(Lum);
    Mapped.X               = Mapped.X * (1.0f - CoreWhiten) + MappedLum * CoreWhiten;
    Mapped.Y               = Mapped.Y * (1.0f - CoreWhiten) + MappedLum * CoreWhiten;
    Mapped.Z               = Mapped.Z * (1.0f - CoreWhiten) + MappedLum * CoreWhiten;

    auto ToSrgbByte = [](float Linear) noexcept -> uint8_t
    {
        const float Clamped = std::clamp(Linear, 0.0f, 1.0f);
        const float Srgb    = (Clamped <= 0.0031308f) ? (12.92f * Clamped)
                                                      : (1.055f * std::pow(Clamped, 1.0f / 2.4f) - 0.055f);
        return static_cast<uint8_t>(std::clamp(Srgb * 255.0f + 0.5f, 0.0f, 255.0f));
    };

    OutR = ToSrgbByte(Mapped.X);
    OutG = ToSrgbByte(Mapped.Y);
    OutB = ToSrgbByte(Mapped.Z);
}
} // namespace

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                 SCENE REGISTRATION & BVH / CARDS
------------------------------------------------------------------------------------------------------------------------------------------*/
void SceneRenderer::ClearScene() noexcept
{
    SdfScene_.Clear();
    SdfPrimitiveToCard_.clear();
    SurfaceCards_.clear();
    Triangles_.clear();
    BvhRecords_.clear();
    Luminaires_.clear();
    Mirrors_.clear();
    Portals_.clear();
    EmissiveTextures_.clear();
}

uint32_t SceneRenderer::RegisterDualTierSolidBox(
    Vec3  CentreWorld,
    Vec3  HalfExtents,
    Vec3  AlbedoRgb,
    float Roughness,
    Vec3  EmissiveRgb,
    float Metallic)
{
    const uint32_t      CardIdx = static_cast<uint32_t>(SurfaceCards_.size());
    OrientedSurfaceCard Card{};
    Card.CentreWorld         = CentreWorld;
    Card.HalfExtents         = HalfExtents;
    Card.AlbedoRgb           = AlbedoRgb;
    Card.EmissiveRadianceRgb = EmissiveRgb;
    Card.Roughness           = Roughness;
    Card.Metallic            = Metallic;
    SurfaceCards_.push_back(Card);

    // 1. Register into GTX DistanceFieldScene (used strictly for GTX SDF + SurfaceCard ReSTIR GI)!
    DistancePrimitive Prim{};
    Prim.Kind               = DistancePrimitiveKind::Box;
    Prim.Centre             = ToSpatial(CentreWorld);
    Prim.Extents            = ToSpatial(HalfExtents);
    Prim.EmissiveRadiance   = LuminanceRec709(EmissiveRgb);
    Prim.DiffuseReflectance = LuminanceRec709(AlbedoRgb);
    SdfScene_.AddPrimitive(Prim);
    SdfPrimitiveToCard_.push_back(CardIdx);

    // 2. Register 12 exact triangles into Triangle BVH (used by GTX BVH Reflections AND full RTX)!
    const float X0 = CentreWorld.X - HalfExtents.X, X1 = CentreWorld.X + HalfExtents.X;
    const float Y0 = CentreWorld.Y - HalfExtents.Y, Y1 = CentreWorld.Y + HalfExtents.Y;
    const float Z0 = CentreWorld.Z - HalfExtents.Z, Z1 = CentreWorld.Z + HalfExtents.Z;

    const Vec3 P000{X0, Y0, Z0}, P100{X1, Y0, Z0}, P110{X1, Y1, Z0}, P010{X0, Y1, Z0};
    const Vec3 P001{X0, Y0, Z1}, P101{X1, Y0, Z1}, P111{X1, Y1, Z1}, P011{X0, Y1, Z1};

    auto PushBoxQuad = [&](Vec3 A, Vec3 B, Vec3 C, Vec3 D, Vec3 N)
    {
        RtxSceneTriangle T0{A, B, C, N, AlbedoRgb, EmissiveRgb, Roughness, CardIdx, Metallic};
        RtxSceneTriangle T1{A, C, D, N, AlbedoRgb, EmissiveRgb, Roughness, CardIdx, Metallic};
        Triangles_.push_back(T0);
        Triangles_.push_back(T1);
    };

    PushBoxQuad(P001, P101, P111, P011, Vec3{0.0f, 0.0f, +1.0f});
    PushBoxQuad(P000, P010, P110, P100, Vec3{0.0f, 0.0f, -1.0f});
    PushBoxQuad(P100, P110, P111, P101, Vec3{+1.0f, 0.0f, 0.0f});
    PushBoxQuad(P010, P000, P001, P011, Vec3{-1.0f, 0.0f, 0.0f});
    PushBoxQuad(P110, P010, P011, P111, Vec3{0.0f, +1.0f, 0.0f});
    PushBoxQuad(P000, P100, P101, P001, Vec3{0.0f, -1.0f, 0.0f});

    // 3. Automatically promote bright emissive boxes into solid-angle area luminaires so they cast noiseless NEE + specular!
    if (LuminanceRec709(EmissiveRgb) > 0.35f)
    {
        // Pick the two largest principal face orientations of the box for clean area-light transport.
        AreaLuminaireDescriptor FrontLum{};
        FrontLum.CentreWorld         = CentreWorld + Vec3{0.0f, -HalfExtents.Y, 0.0f};
        FrontLum.RightAxis           = Vec3{1.0f, 0.0f, 0.0f};
        FrontLum.UpAxis              = Vec3{0.0f, 0.0f, 1.0f};
        FrontLum.FrontNormal         = Vec3{0.0f, -1.0f, 0.0f};
        FrontLum.HalfWidthMetres     = HalfExtents.X;
        FrontLum.HalfHeightMetres    = HalfExtents.Z;
        FrontLum.EmissiveRadianceRgb = EmissiveRgb;
        FrontLum.TwoSided            = true;
        FrontLum.RegisterGeometry    = false;
        Luminaires_.push_back(FrontLum);

        if (HalfExtents.X * HalfExtents.Y > 0.08f)
        {
            AreaLuminaireDescriptor BottomLum{};
            BottomLum.CentreWorld         = CentreWorld + Vec3{0.0f, 0.0f, -HalfExtents.Z};
            BottomLum.RightAxis           = Vec3{1.0f, 0.0f, 0.0f};
            BottomLum.UpAxis              = Vec3{0.0f, 1.0f, 0.0f};
            BottomLum.FrontNormal         = Vec3{0.0f, 0.0f, -1.0f};
            BottomLum.HalfWidthMetres     = HalfExtents.X;
            BottomLum.HalfHeightMetres    = HalfExtents.Y;
            BottomLum.EmissiveRadianceRgb = EmissiveRgb;
            BottomLum.TwoSided            = true;
            BottomLum.RegisterGeometry    = false;
            Luminaires_.push_back(BottomLum);
        }
    }

    return CardIdx;
}

uint32_t SceneRenderer::RegisterTexturedGroundSlab(
    Vec3  CentreWorld,
    Vec3  HalfExtents,
    Vec3  BaseAlbedoRgb,
    float BaseRoughness,
    float Metallic)
{
    const size_t FirstTri = Triangles_.size();
    const uint32_t CardIdx = RegisterDualTierSolidBox(
        CentreWorld,
        HalfExtents,
        BaseAlbedoRgb,
        BaseRoughness,
        Vec3{0.0f, 0.0f, 0.0f},
        Metallic);
    for (size_t I = FirstTri; I < Triangles_.size(); ++I)
    {
        Triangles_[I].ProceduralMineralDetail = true;
    }
    return CardIdx;
}

void SceneRenderer::RegisterSmoothSnowSurface(const SnowpackPolygonSurface& Surface)
{
    if (Surface.Vertices.empty() || Surface.Indices.size() < 3u)
    {
        return;
    }

    // Register a low-profile diffuse snow bounce card for GTX SDF GI while keeping exact smooth triangles in BVH!
    Vec3 BMin{1.0e9f, 1.0e9f, 1.0e9f};
    Vec3 BMax{-1.0e9f, -1.0e9f, -1.0e9f};
    for (const auto& V : Surface.Vertices)
    {
        BMin.X = std::min(BMin.X, V.Position.X);
        BMin.Y = std::min(BMin.Y, V.Position.Y);
        BMin.Z = std::min(BMin.Z, V.Position.Z);
        BMax.X = std::max(BMax.X, V.Position.X);
        BMax.Y = std::max(BMax.Y, V.Position.Y);
        BMax.Z = std::max(BMax.Z, V.Position.Z);
    }
    const uint32_t CardIdx = static_cast<uint32_t>(SurfaceCards_.size());
    OrientedSurfaceCard SnowCard{};
    SnowCard.CentreWorld = (BMin + BMax) * 0.5f;
    SnowCard.HalfExtents = Vec3{
        std::max(0.05f, (BMax.X - BMin.X) * 0.5f),
        std::max(0.05f, (BMax.Y - BMin.Y) * 0.5f),
        std::max(0.02f, (BMax.Z - BMin.Z) * 0.5f)};
    SnowCard.AlbedoRgb = Vec3{0.88f, 0.92f, 0.97f};
    SnowCard.Roughness = 0.62f;
    SnowCard.Metallic  = 0.0f;
    SurfaceCards_.push_back(SnowCard);

    for (size_t I = 0u; I + 2u < Surface.Indices.size(); I += 3u)
    {
        const auto& SV0 = Surface.Vertices[Surface.Indices[I + 0u]];
        const auto& SV1 = Surface.Vertices[Surface.Indices[I + 1u]];
        const auto& SV2 = Surface.Vertices[Surface.Indices[I + 2u]];

        RtxSceneTriangle Tri{};
        Tri.V0 = SV0.Position;
        Tri.V1 = SV1.Position;
        Tri.V2 = SV2.Position;

        const Vec3 EdgeCross = Cross(Tri.V1 - Tri.V0, Tri.V2 - Tri.V0);
        if (Length(EdgeCross) <= 1.0e-7f)
        {
            continue;
        }
        Tri.Normal              = Normalise(EdgeCross);
        Tri.SmoothVertexNormals = true;
        Tri.V0Normal            = Normalise(SV0.Normal);
        Tri.V1Normal            = Normalise(SV1.Normal);
        Tri.V2Normal            = Normalise(SV2.Normal);

        const float AvgPack  = std::clamp((SV0.CompactionRatio + SV1.CompactionRatio + SV2.CompactionRatio) / 3.0f, 0.0f, 1.0f);
        const float AvgHail  = std::clamp((SV0.HailIceFraction + SV1.HailIceFraction + SV2.HailIceFraction) / 3.0f, 0.0f, 1.0f);
        const float AvgThick = (SV0.SnowThicknessM + SV1.SnowThicknessM + SV2.SnowThicknessM) / 3.0f;
        // Natural powder apron edge feathering: thin outer snow (< 4.8 cm) lets dark frost-dusted rock grain peek through
        // so the single-mesh snow mound transitions organically into the terrain with ZERO sticker-cutout silhouette!
        const float CoverT   = std::clamp((AvgThick - 0.003f) / 0.048f, 0.0f, 1.0f);
        const float Cover01  = CoverT * CoverT * (3.0f - 2.0f * CoverT);
        const Vec3  FullSnowAlbedo{
            0.91f - 0.14f * AvgPack - 0.05f * AvgHail,
            0.94f - 0.10f * AvgPack - 0.03f * AvgHail,
            0.98f - 0.04f * AvgPack};
        const Vec3  FrostApronBed{0.18f, 0.20f, 0.24f};
        Tri.AlbedoRgb             = FrostApronBed * (1.0f - Cover01) + FullSnowAlbedo * Cover01;
        Tri.Roughness             = std::clamp((0.56f * (1.0f - Cover01)) + Cover01 * (0.68f - 0.42f * AvgPack - 0.18f * AvgHail), 0.18f, 0.78f);
        Tri.Metallic              = 0.0f;
        Tri.SnowSubsurfaceScatter = (Cover01 > 0.25f);
        Tri.CardOrMaterialIndex   = CardIdx;
        Triangles_.push_back(Tri);
    }
}

Vec3 SceneRenderer::TransformPointAcrossPortal(
    const SeamlessPortalAperture& Portal,
    Vec3                          WorldPoint) noexcept
{
    const Vec3  Rel = WorldPoint - Portal.EntryCentreWorld;
    const float U   = Dot(Rel, Portal.EntryRightAxis);
    const float V   = Dot(Rel, Portal.EntryUpAxis);
    const float W   = Dot(Rel, Portal.EntryFrontNormal);
    return Portal.ExitCentreWorld -
           Portal.ExitRightAxis * U +
           Portal.ExitUpAxis * V -
           Portal.ExitFrontNormal * W;
}

Vec3 SceneRenderer::TransformVectorAcrossPortal(
    const SeamlessPortalAperture& Portal,
    Vec3                          WorldVector) noexcept
{
    const float U = Dot(WorldVector, Portal.EntryRightAxis);
    const float V = Dot(WorldVector, Portal.EntryUpAxis);
    const float W = Dot(WorldVector, Portal.EntryFrontNormal);
    return Portal.ExitRightAxis * (-U) +
           Portal.ExitUpAxis * V -
           Portal.ExitFrontNormal * W;
}

void SceneRenderer::RegisterHalfSpaceClippedTriangle(
    const RtxSceneTriangle& Triangle,
    Vec3                    PlanePoint,
    Vec3                    PlaneKeepNormal)
{
    struct ClipVertex
    {
        Vec3 Pos{};
        Vec3 Nrm{};
        float Dist = 0.0f;
    };

    const Vec3 UnitPlaneN = Normalise(PlaneKeepNormal);
    const ClipVertex Input[3] = {
        {Triangle.V0, Triangle.SmoothVertexNormals ? Triangle.V0Normal : Triangle.Normal, Dot(Triangle.V0 - PlanePoint, UnitPlaneN)},
        {Triangle.V1, Triangle.SmoothVertexNormals ? Triangle.V1Normal : Triangle.Normal, Dot(Triangle.V1 - PlanePoint, UnitPlaneN)},
        {Triangle.V2, Triangle.SmoothVertexNormals ? Triangle.V2Normal : Triangle.Normal, Dot(Triangle.V2 - PlanePoint, UnitPlaneN)}};

    constexpr float ClipEps = -1.0e-5f;
    if (Input[0].Dist < ClipEps && Input[1].Dist < ClipEps && Input[2].Dist < ClipEps)
    {
        return;
    }
    if (Input[0].Dist >= -ClipEps && Input[1].Dist >= -ClipEps && Input[2].Dist >= -ClipEps)
    {
        RegisterPolygonTriangle(Triangle);
        return;
    }

    ClipVertex Poly[4]{};
    uint32_t   PolyCount = 0u;
    for (uint32_t I = 0u; I < 3u; ++I)
    {
        const ClipVertex& Curr   = Input[I];
        const ClipVertex& Next   = Input[(I + 1u) % 3u];
        const bool        CurrIn = (Curr.Dist >= 0.0f);
        const bool        NextIn = (Next.Dist >= 0.0f);

        if (CurrIn)
        {
            Poly[PolyCount++] = Curr;
        }
        if (CurrIn != NextIn)
        {
            const float Denom = Curr.Dist - Next.Dist;
            const float Alpha = (std::abs(Denom) > 1.0e-8f) ? std::clamp(Curr.Dist / Denom, 0.0f, 1.0f) : 0.5f;
            ClipVertex  Cut{};
            Cut.Pos           = Curr.Pos + (Next.Pos - Curr.Pos) * Alpha;
            Cut.Nrm           = Normalise(Curr.Nrm + (Next.Nrm - Curr.Nrm) * Alpha);
            Cut.Dist          = 0.0f;
            Poly[PolyCount++] = Cut;
        }
    }

    for (uint32_t T = 1u; T + 1u < PolyCount; ++T)
    {
        RtxSceneTriangle Sub = Triangle;
        Sub.V0               = Poly[0].Pos;
        Sub.V1               = Poly[T].Pos;
        Sub.V2               = Poly[T + 1u].Pos;
        const Vec3 CrossN    = Cross(Sub.V1 - Sub.V0, Sub.V2 - Sub.V0);
        if (Length(CrossN) <= 1.0e-7f)
        {
            continue;
        }
        Sub.Normal = Normalise(CrossN);
        if (Sub.SmoothVertexNormals)
        {
            Sub.V0Normal = Poly[0].Nrm;
            Sub.V1Normal = Poly[T].Nrm;
            Sub.V2Normal = Poly[T + 1u].Nrm;
        }
        RegisterPolygonTriangle(Sub);
    }
}

uint32_t SceneRenderer::RegisterSdfOnlyCardProxyBox(
    Vec3  CentreWorld,
    Vec3  HalfExtents,
    Vec3  AlbedoRgb,
    float Roughness,
    Vec3  EmissiveRgb)
{
    const uint32_t      CardIdx = static_cast<uint32_t>(SurfaceCards_.size());
    OrientedSurfaceCard Card{};
    Card.CentreWorld         = CentreWorld;
    Card.HalfExtents         = HalfExtents;
    Card.AlbedoRgb           = AlbedoRgb;
    Card.EmissiveRadianceRgb = EmissiveRgb;
    Card.Roughness           = Roughness;
    SurfaceCards_.push_back(Card);

    DistancePrimitive Prim{};
    Prim.Kind               = DistancePrimitiveKind::Box;
    Prim.Centre             = ToSpatial(CentreWorld);
    Prim.Extents            = ToSpatial(HalfExtents);
    Prim.DiffuseReflectance = LuminanceRec709(AlbedoRgb);
    Prim.EmissiveRadiance   = LuminanceRec709(EmissiveRgb);
    SdfScene_.AddPrimitive(Prim);
    SdfPrimitiveToCard_.push_back(CardIdx);
    return CardIdx;
}

void SceneRenderer::RegisterPortalTransitingTriangle(
    const RtxSceneTriangle&       EntryWorldTriangle,
    const SeamlessPortalAperture& Portal)
{
    uint32_t UnusedEntry = 0u;
    uint32_t UnusedExit  = 0u;
    RegisterPortalTransitingTriangleCounted(EntryWorldTriangle, Portal, UnusedEntry, UnusedExit);
}

void SceneRenderer::RegisterPortalTransitingTriangleCounted(
    const RtxSceneTriangle&       EntryWorldTriangle,
    const SeamlessPortalAperture& Portal,
    uint32_t&                     OutEntryTrianglesEmitted,
    uint32_t&                     OutExitDuplicateTrianglesEmitted)
{
    // 1. Entry side (Portal A): keep ONLY the portion in front of Entry (dot >= 0); strictly hide everything behind Entry!
    const uint32_t BeforeEntry = static_cast<uint32_t>(Triangles_.size());
    RegisterHalfSpaceClippedTriangle(EntryWorldTriangle, Portal.EntryCentreWorld, Portal.EntryFrontNormal);
    const uint32_t AfterEntry  = static_cast<uint32_t>(Triangles_.size());
    OutEntryTrianglesEmitted   = AfterEntry - BeforeEntry;

    // 2. Exit side (Portal B): isometrically map across the portal and keep ONLY the portion emerging in front of Exit!
    RtxSceneTriangle Emerged = EntryWorldTriangle;
    Emerged.V0               = TransformPointAcrossPortal(Portal, EntryWorldTriangle.V0);
    Emerged.V1               = TransformPointAcrossPortal(Portal, EntryWorldTriangle.V1);
    Emerged.V2               = TransformPointAcrossPortal(Portal, EntryWorldTriangle.V2);
    Emerged.Normal           = Normalise(TransformVectorAcrossPortal(Portal, EntryWorldTriangle.Normal));
    if (Emerged.SmoothVertexNormals)
    {
        Emerged.V0Normal = Normalise(TransformVectorAcrossPortal(Portal, EntryWorldTriangle.V0Normal));
        Emerged.V1Normal = Normalise(TransformVectorAcrossPortal(Portal, EntryWorldTriangle.V1Normal));
        Emerged.V2Normal = Normalise(TransformVectorAcrossPortal(Portal, EntryWorldTriangle.V2Normal));
    }
    RegisterHalfSpaceClippedTriangle(Emerged, Portal.ExitCentreWorld, Portal.ExitFrontNormal);
    OutExitDuplicateTrianglesEmitted = static_cast<uint32_t>(Triangles_.size()) - AfterEntry;
}

void SceneRenderer::RegisterSmoothSphere(
    Vec3     CentreWorld,
    float    RadiusMetres,
    Vec3     AlbedoRgb,
    float    Roughness,
    float    Metallic,
    bool     TransmissiveGlass,
    float    RefractiveIndexIor,
    Vec3     SpectralAbsorption,
    uint32_t LongitudeSlices,
    uint32_t LatitudeStacks)
{
    const uint32_t Slices  = std::max(8u, LongitudeSlices);
    const uint32_t Stacks  = std::max(6u, LatitudeStacks);
    uint32_t       CardIdx = UINT32_MAX;

    // Only opaque/metallic spheres enter the GTX SDF + SurfaceCard GI scene; transmissive glass is exempt from SDF occlusion!
    if (!TransmissiveGlass)
    {
        CardIdx = static_cast<uint32_t>(SurfaceCards_.size());
        OrientedSurfaceCard Card{};
        Card.CentreWorld = CentreWorld;
        Card.HalfExtents = Vec3{RadiusMetres, RadiusMetres, RadiusMetres};
        Card.AlbedoRgb   = AlbedoRgb;
        Card.Roughness   = Roughness;
        Card.Metallic    = Metallic;
        SurfaceCards_.push_back(Card);

        DistancePrimitive Prim{};
        Prim.Kind               = DistancePrimitiveKind::Sphere;
        Prim.Centre             = ToSpatial(CentreWorld);
        Prim.Extents            = SpatialVector{
            static_cast<double>(RadiusMetres),
            static_cast<double>(RadiusMetres),
            static_cast<double>(RadiusMetres)};
        Prim.DiffuseReflectance = LuminanceRec709(AlbedoRgb);
        SdfScene_.AddPrimitive(Prim);
        SdfPrimitiveToCard_.push_back(CardIdx);
    }

    auto SphereVertex = [&](uint32_t Stack, uint32_t Slice, Vec3& OutPos, Vec3& OutNrm)
    {
        const float Theta = PiFloat * static_cast<float>(Stack) / static_cast<float>(Stacks);
        const float Phi   = 2.0f * PiFloat * static_cast<float>(Slice) / static_cast<float>(Slices);
        const float SinT  = std::sin(Theta);
        OutNrm            = Vec3{SinT * std::cos(Phi), SinT * std::sin(Phi), std::cos(Theta)};
        OutPos            = CentreWorld + OutNrm * RadiusMetres;
    };

    for (uint32_t St = 0u; St < Stacks; ++St)
    {
        for (uint32_t Sl = 0u; Sl < Slices; ++Sl)
        {
            Vec3 P00, N00, P10, N10, P11, N11, P01, N01;
            SphereVertex(St, Sl, P00, N00);
            SphereVertex(St, Sl + 1u, P10, N10);
            SphereVertex(St + 1u, Sl + 1u, P11, N11);
            SphereVertex(St + 1u, Sl, P01, N01);

            if (St > 0u)
            {
                RtxSceneTriangle T0{};
                T0.V0                  = P00;
                T0.V1                  = P11;
                T0.V2                  = P10;
                T0.Normal              = Normalise(Cross(T0.V1 - T0.V0, T0.V2 - T0.V0));
                T0.AlbedoRgb           = AlbedoRgb;
                T0.Roughness           = Roughness;
                T0.CardOrMaterialIndex = CardIdx;
                T0.Metallic            = Metallic;
                T0.TransmissiveGlass   = TransmissiveGlass;
                T0.RefractiveIndexIor  = RefractiveIndexIor;
                T0.SpectralAbsorption  = SpectralAbsorption;
                T0.SmoothVertexNormals = true;
                T0.V0Normal            = N00;
                T0.V1Normal            = N11;
                T0.V2Normal            = N10;
                Triangles_.push_back(T0);
            }
            if (St + 1u < Stacks)
            {
                RtxSceneTriangle T1{};
                T1.V0                  = P00;
                T1.V1                  = P01;
                T1.V2                  = P11;
                T1.Normal              = Normalise(Cross(T1.V1 - T1.V0, T1.V2 - T1.V0));
                T1.AlbedoRgb           = AlbedoRgb;
                T1.Roughness           = Roughness;
                T1.CardOrMaterialIndex = CardIdx;
                T1.Metallic            = Metallic;
                T1.TransmissiveGlass   = TransmissiveGlass;
                T1.RefractiveIndexIor  = RefractiveIndexIor;
                T1.SpectralAbsorption  = SpectralAbsorption;
                T1.SmoothVertexNormals = true;
                T1.V0Normal            = N00;
                T1.V1Normal            = N01;
                T1.V2Normal            = N11;
                Triangles_.push_back(T1);
            }
        }
    }
}

void SceneRenderer::RegisterAreaLuminaire(const AreaLuminaireDescriptor& Luminaire)
{
    AreaLuminaireDescriptor Clean = Luminaire;
    Clean.RightAxis               = Normalise(Luminaire.RightAxis);
    Clean.UpAxis                  = Normalise(Luminaire.UpAxis);
    Clean.FrontNormal             = Normalise(Luminaire.FrontNormal);
    Luminaires_.push_back(Clean);

    if (Clean.RegisterGeometry)
    {
        const Vec3 R = Clean.RightAxis * Clean.HalfWidthMetres;
        const Vec3 U = Clean.UpAxis * Clean.HalfHeightMetres;
        const Vec3 A = Clean.CentreWorld - R - U;
        const Vec3 B = Clean.CentreWorld + R - U;
        const Vec3 C = Clean.CentreWorld + R + U;
        const Vec3 D = Clean.CentreWorld - R + U;

        const uint32_t      CardIdx = static_cast<uint32_t>(SurfaceCards_.size());
        OrientedSurfaceCard Card{};
        Card.CentreWorld         = Clean.CentreWorld;
        Card.HalfExtents         = Vec3{
            std::max(0.06f, std::abs(R.X) + std::abs(U.X)),
            std::max(0.06f, std::abs(R.Y) + std::abs(U.Y)),
            std::max(0.06f, std::abs(R.Z) + std::abs(U.Z))};
        Card.AlbedoRgb           = Vec3{0.08f, 0.08f, 0.08f};
        Card.EmissiveRadianceRgb = Clean.EmissiveRadianceRgb;
        Card.Roughness           = 0.35f;
        SurfaceCards_.push_back(Card);

        DistancePrimitive Prim{};
        Prim.Kind             = DistancePrimitiveKind::Box;
        Prim.Centre           = ToSpatial(Clean.CentreWorld);
        Prim.Extents          = ToSpatial(Card.HalfExtents);
        Prim.EmissiveRadiance = LuminanceRec709(Clean.EmissiveRadianceRgb);
        SdfScene_.AddPrimitive(Prim);
        SdfPrimitiveToCard_.push_back(CardIdx);

        Triangles_.push_back(RtxSceneTriangle{A, B, C, Clean.FrontNormal, Card.AlbedoRgb, Clean.EmissiveRadianceRgb, 0.25f, CardIdx});
        Triangles_.push_back(RtxSceneTriangle{A, C, D, Clean.FrontNormal, Card.AlbedoRgb, Clean.EmissiveRadianceRgb, 0.25f, CardIdx});
    }
}

int32_t SceneRenderer::RegisterEmissiveDisplayTexture(
    uint32_t                    Width,
    uint32_t                    Height,
    const std::vector<uint8_t>& Rgba8Pixels)
{
    if (Width == 0u || Height == 0u || Rgba8Pixels.size() < static_cast<size_t>(Width) * Height * 4u)
    {
        return -1;
    }
    const int32_t Id = static_cast<int32_t>(EmissiveTextures_.size());
    EmissiveDisplayTexture Tex{};
    Tex.Width  = Width;
    Tex.Height = Height;
    Tex.Rgba8  = Rgba8Pixels;
    EmissiveTextures_.push_back(std::move(Tex));
    return Id;
}

void SceneRenderer::RegisterPolygonTriangle(const RtxSceneTriangle& Triangle)
{
    Triangles_.push_back(Triangle);
}

void SceneRenderer::RegisterPlanarMirror(const PlanarMirrorAperture& Mirror)
{
    PlanarMirrorAperture Clean = Mirror;
    Clean.RightAxis            = Normalise(Mirror.RightAxis);
    Clean.UpAxis               = Normalise(Mirror.UpAxis);
    Clean.FrontNormal          = Normalise(Mirror.FrontNormal);
    Mirrors_.push_back(Clean);
}

void SceneRenderer::RegisterSeamlessPortal(const SeamlessPortalAperture& Portal)
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

uint32_t SceneRenderer::BuildBvhRecursive(uint32_t StartTri, uint32_t TriCount)
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
    BvhRecords_[MyIndex].RightBranchIndex    = RightBranch;
    BvhRecords_[MyIndex].TriangleCount       = 0u;

    return MyIndex;
}

void SceneRenderer::FinalizeSceneAndBakeSurfaceCards(const CoupledWorldOpticalContext& Context)
{
    BvhRecords_.clear();
    if (!Triangles_.empty())
    {
        BvhRecords_.reserve(Triangles_.size() * 2u);
        BuildBvhRecursive(0u, static_cast<uint32_t>(Triangles_.size()));
    }

    // Bake 6-face exitant radiance into OrientedSurfaceCards for GTX SDF ReSTIR GI using a 3x3 face-area quadrature
    // so localized firepits/sparks on large floor slabs do not over-brighten the entire card!
    for (auto& Card : SurfaceCards_)
    {
        for (uint32_t Face = 0u; Face < 6u; ++Face)
        {
            const Vec3 FaceN      = CardFaceDirection(Face);
            const Vec3 TangentRef = (std::abs(FaceN.Z) < 0.9f) ? Vec3{0.0f, 0.0f, 1.0f} : Vec3{1.0f, 0.0f, 0.0f};
            const Vec3 TanU       = Normalise(Cross(TangentRef, FaceN));
            const Vec3 TanV       = Cross(FaceN, TanU);
            const float SpanU     = std::abs(Dot(TanU, Card.HalfExtents)) * 0.65f;
            const float SpanV     = std::abs(Dot(TanV, Card.HalfExtents)) * 0.65f;
            const Vec3 FaceCentre = Card.CentreWorld + Vec3{
                FaceN.X * (Card.HalfExtents.X + 0.04f),
                FaceN.Y * (Card.HalfExtents.Y + 0.04f),
                FaceN.Z * (Card.HalfExtents.Z + 0.04f)};

            Vec3 TapSum{0.0f, 0.0f, 0.0f};
            for (int Tv = -1; Tv <= 1; ++Tv)
            {
                for (int Tu = -1; Tu <= 1; ++Tu)
                {
                    const Vec3 SamplePt = FaceCentre + TanU * (static_cast<float>(Tu) * SpanU) +
                                          TanV * (static_cast<float>(Tv) * SpanV);
                    const Vec3 Direct = EvaluateDirectSurfaceLighting(
                        GpuTracingTier::SignedDistanceFieldGtx,
                        SamplePt,
                        FaceN,
                        FaceN,
                        Card.AlbedoRgb,
                        Card.Roughness,
                        Card.Metallic,
                        Context);
                    TapSum = TapSum + ClampRadianceFirefly(Card.EmissiveRadianceRgb * 0.35f + Direct, 6.5f);
                }
            }
            Card.FaceIrradianceCache[Face] = TapSum * (1.0f / 9.0f);
        }
    }
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                      PORTAL RAY TRANSFORMATION
------------------------------------------------------------------------------------------------------------------------------------------*/
void SceneRenderer::TransformRayAcrossPortal(
    const SeamlessPortalAperture& Portal,
    Vec3                          HitPointOnEntry,
    Vec3                          IncomingDirectionUnit,
    Vec3&                         OutTeleportedOrigin,
    Vec3&                         OutTeleportedDirection) noexcept
{
    const Vec3  Rel  = HitPointOnEntry - Portal.EntryCentreWorld;
    const float U    = Dot(Rel, Portal.EntryRightAxis);
    const float V    = Dot(Rel, Portal.EntryUpAxis);
    const float DirR = Dot(IncomingDirectionUnit, Portal.EntryRightAxis);
    const float DirU = Dot(IncomingDirectionUnit, Portal.EntryUpAxis);
    const float DirN = Dot(IncomingDirectionUnit, Portal.EntryFrontNormal); // < 0 entering front face!

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
                                       DUAL-TIER GEOMETRY: SDF CARDS (GTX GI) & TRIANGLE BVH
------------------------------------------------------------------------------------------------------------------------------------------*/
SceneRenderer::InternalSurfaceHit SceneRenderer::TraceSdfSurfaceCards(
    Vec3  Origin,
    Vec3  DirectionUnit,
    float MaxDistanceM) const noexcept
{
    InternalSurfaceHit        Result{};
    const DistanceTraceResult Trace = SdfScene_.Trace(
        ToSpatial(Origin),
        ToSpatial(DirectionUnit),
        static_cast<double>(MaxDistanceM),
        1.5e-3,
        192u);
    if (Trace.Hit && Trace.Primitive < SdfPrimitiveToCard_.size())
    {
        Result.Hit              = true;
        Result.DistanceM        = static_cast<float>(Trace.Distance);
        Result.Position         = Origin + DirectionUnit * Result.DistanceM;
        const SpatialVector N   = SdfScene_.NormalAt(ToSpatial(Result.Position));
        Result.GeometricOutward = Normalise(Vec3{static_cast<float>(N.X), static_cast<float>(N.Y), static_cast<float>(N.Z)});
        Result.Normal           = Result.GeometricOutward;
        Result.CardIndex        = SdfPrimitiveToCard_[Trace.Primitive];
        if (Result.CardIndex < SurfaceCards_.size())
        {
            const auto& Card   = SurfaceCards_[Result.CardIndex];
            Result.AlbedoRgb   = Card.AlbedoRgb;
            Result.EmissiveRgb = Card.EmissiveRadianceRgb;
            Result.Roughness   = Card.Roughness;
            Result.Metallic    = Card.Metallic;
        }
    }
    return Result;
}

SceneRenderer::InternalSurfaceHit SceneRenderer::TraceTriangleBvh(
    Vec3  Origin,
    Vec3  DirectionUnit,
    float MaxDistanceM,
    bool  IgnoreTransmissiveGlass) const noexcept
{
    InternalSurfaceHit Result{};
    if (BvhRecords_.empty())
    {
        return Result;
    }

    const Vec3 InvDir{
        1.0f / ((std::abs(DirectionUnit.X) > 1.0e-7f) ? DirectionUnit.X : ((DirectionUnit.X >= 0.0f) ? 1.0e-7f : -1.0e-7f)),
        1.0f / ((std::abs(DirectionUnit.Y) > 1.0e-7f) ? DirectionUnit.Y : ((DirectionUnit.Y >= 0.0f) ? 1.0e-7f : -1.0e-7f)),
        1.0f / ((std::abs(DirectionUnit.Z) > 1.0e-7f) ? DirectionUnit.Z : ((DirectionUnit.Z >= 0.0f) ? 1.0e-7f : -1.0e-7f))};

    uint32_t Stack[40];
    uint32_t StackPtr = 0u;
    float    RootT    = 0.0f;
    if (!IntersectRayAabbDist(Origin, InvDir, BvhRecords_[0].BoundsMin, BvhRecords_[0].BoundsMax, MaxDistanceM, RootT))
    {
        return Result;
    }
    Stack[StackPtr++] = 0u;

    float BestT = MaxDistanceM;
    float BestU = 0.0f;
    float BestV = 0.0f;
    int   BestTri = -1;

    while (StackPtr > 0u)
    {
        const uint32_t RecordIdx = Stack[--StackPtr];
        const auto&    Record    = BvhRecords_[RecordIdx];
        if (Record.TriangleCount > 0u)
        {
            for (uint32_t I = 0u; I < Record.TriangleCount; ++I)
            {
                const uint32_t          TriIdx = Record.LeftOrFirstTriangle + I;
                const RtxSceneTriangle& Tri    = Triangles_[TriIdx];
                if (IgnoreTransmissiveGlass && Tri.TransmissiveGlass)
                {
                    continue;
                }
                float HitT = BestT, U = 0.0f, V = 0.0f;
                if (IntersectRayTriangleMollerTrumbore(Origin, DirectionUnit, Tri, BestT, HitT, U, V))
                {
                    BestT   = HitT;
                    BestU   = U;
                    BestV   = V;
                    BestTri = static_cast<int>(TriIdx);
                }
            }
        }
        else if (StackPtr + 2u <= 40u)
        {
            const uint32_t LIdx = Record.LeftOrFirstTriangle;
            const uint32_t RIdx = Record.RightBranchIndex;
            float          LT   = 0.0f;
            float          RT   = 0.0f;
            const bool     HitL = IntersectRayAabbDist(Origin, InvDir, BvhRecords_[LIdx].BoundsMin, BvhRecords_[LIdx].BoundsMax, BestT, LT);
            const bool     HitR = IntersectRayAabbDist(Origin, InvDir, BvhRecords_[RIdx].BoundsMin, BvhRecords_[RIdx].BoundsMax, BestT, RT);
            // Push farther child first so closer child is popped first (VehicleHMI RayTraversal.wgsl parity!).
            if (HitL && HitR)
            {
                if (LT < RT)
                {
                    Stack[StackPtr++] = RIdx;
                    Stack[StackPtr++] = LIdx;
                }
                else
                {
                    Stack[StackPtr++] = LIdx;
                    Stack[StackPtr++] = RIdx;
                }
            }
            else if (HitL)
            {
                Stack[StackPtr++] = LIdx;
            }
            else if (HitR)
            {
                Stack[StackPtr++] = RIdx;
            }
        }
    }

    if (BestTri >= 0)
    {
        const auto& Tri           = Triangles_[static_cast<size_t>(BestTri)];
        Result.Hit                = true;
        Result.DistanceM          = BestT;
        Result.Position           = Origin + DirectionUnit * BestT;
        const Vec3 InterpOutward  = Tri.SmoothVertexNormals
                                        ? Normalise(Tri.V0Normal * (1.0f - BestU - BestV) + Tri.V1Normal * BestU + Tri.V2Normal * BestV)
                                        : Tri.Normal;
        Result.GeometricOutward   = InterpOutward;
        Result.Normal             = (Dot(InterpOutward, DirectionUnit) < 0.0f) ? InterpOutward : -InterpOutward;
        Result.AlbedoRgb          = Tri.AlbedoRgb;
        Result.EmissiveRgb        = Tri.EmissiveRgb;
        if (Tri.EmissiveTextureId >= 0 && static_cast<size_t>(Tri.EmissiveTextureId) < EmissiveTextures_.size())
        {
            const EmissiveDisplayTexture& Tex = EmissiveTextures_[static_cast<size_t>(Tri.EmissiveTextureId)];
            const float W0 = 1.0f - BestU - BestV;
            const float UvX = std::clamp(Tri.UV0[0] * W0 + Tri.UV1[0] * BestU + Tri.UV2[0] * BestV, 0.0f, 1.0f);
            const float UvY = std::clamp(Tri.UV0[1] * W0 + Tri.UV1[1] * BestU + Tri.UV2[1] * BestV, 0.0f, 1.0f);
            const float Fx  = UvX * static_cast<float>(Tex.Width - 1u);
            const float Fy  = UvY * static_cast<float>(Tex.Height - 1u);
            const uint32_t X0 = static_cast<uint32_t>(Fx);
            const uint32_t Y0 = static_cast<uint32_t>(Fy);
            const uint32_t X1 = std::min(X0 + 1u, Tex.Width - 1u);
            const uint32_t Y1 = std::min(Y0 + 1u, Tex.Height - 1u);
            const float    Tx = Fx - static_cast<float>(X0);
            const float    Ty = Fy - static_cast<float>(Y0);

            auto FetchLinearSrgb = [&](uint32_t X, uint32_t Y) noexcept -> Vec3
            {
                const size_t Off = (static_cast<size_t>(Y) * Tex.Width + X) * 4u;
                auto ToLin = [](uint8_t Byte) noexcept -> float
                {
                    const float S = static_cast<float>(Byte) * (1.0f / 255.0f);
                    return (S <= 0.04045f) ? (S / 12.92f) : std::pow((S + 0.055f) / 1.055f, 2.4f);
                };
                return Vec3{ToLin(Tex.Rgba8[Off + 0u]), ToLin(Tex.Rgba8[Off + 1u]), ToLin(Tex.Rgba8[Off + 2u])};
            };

            const Vec3 C00 = FetchLinearSrgb(X0, Y0);
            const Vec3 C10 = FetchLinearSrgb(X1, Y0);
            const Vec3 C01 = FetchLinearSrgb(X0, Y1);
            const Vec3 C11 = FetchLinearSrgb(X1, Y1);
            const Vec3 Top = C00 * (1.0f - Tx) + C10 * Tx;
            const Vec3 Bot = C01 * (1.0f - Tx) + C11 * Tx;
            const Vec3 LinDisplay = Top * (1.0f - Ty) + Bot * Ty;
            Result.EmissiveRgb = ExposureAdaptation::EncodeDisplayReferredScreenRadiance(LinDisplay, 1.0f) * Tri.DisplayLuminanceGain;
            Result.AlbedoRgb   = Vec3{0.015f, 0.017f, 0.022f};
        }
        Result.Roughness          = Tri.Roughness;
        Result.Metallic           = Tri.Metallic;
        Result.TransmissiveGlass     = Tri.TransmissiveGlass;
        Result.SnowSubsurfaceScatter = Tri.SnowSubsurfaceScatter;
        Result.RefractiveIndexIor    = Tri.RefractiveIndexIor;
        Result.SpectralAbsorption    = Tri.SpectralAbsorption;
        Result.CardIndex             = Tri.CardOrMaterialIndex;
        if (Tri.ProceduralMineralDetail)
        {
            EvaluateMineralGroundDetail(Result.Position, Result.DistanceM, Result.AlbedoRgb, Result.Roughness, Result.Normal);
        }
    }
    return Result;
}

bool SceneRenderer::IntersectShallowWaterSurface(
    Vec3                              Origin,
    Vec3                              DirectionUnit,
    float                             MaxDistanceM,
    const CoupledWorldOpticalContext& Context,
    float&                            OutHitDistanceM,
    Vec3&                             OutWaterHitWorld,
    SurfaceFluidSample&               OutSample) const noexcept
{
    if (Context.ShallowWater == nullptr || DirectionUnit.Z >= -1.0e-5f)
    {
        return false;
    }

    const auto& WCfg = Context.ShallowWater->Configuration();
    const float MinX = WCfg.WorldOriginXY[0];
    const float MinY = WCfg.WorldOriginXY[1];
    const float MaxX = MinX + static_cast<float>(WCfg.CellsX) * WCfg.CellSizeMetres;
    const float MaxY = MinY + static_cast<float>(WCfg.CellsY) * WCfg.CellSizeMetres;

    // Intersect ray with horizontal XY bounding box of the shallow-water grid first so step budget concentrates tightly!
    float TxMin = 0.0f;
    float TxMax = MaxDistanceM;
    if (std::abs(DirectionUnit.X) > 1.0e-6f)
    {
        const float T0 = (MinX - Origin.X) / DirectionUnit.X;
        const float T1 = (MaxX - Origin.X) / DirectionUnit.X;
        TxMin          = std::max(TxMin, std::min(T0, T1));
        TxMax          = std::min(TxMax, std::max(T0, T1));
    }
    else if (Origin.X < MinX || Origin.X > MaxX)
    {
        return false;
    }

    if (std::abs(DirectionUnit.Y) > 1.0e-6f)
    {
        const float T0 = (MinY - Origin.Y) / DirectionUnit.Y;
        const float T1 = (MaxY - Origin.Y) / DirectionUnit.Y;
        TxMin          = std::max(TxMin, std::min(T0, T1));
        TxMax          = std::min(TxMax, std::max(T0, T1));
    }
    else if (Origin.Y < MinY || Origin.Y > MaxY)
    {
        return false;
    }

    const float TzTop = std::max(0.0f, (1.20f - Origin.Z) / DirectionUnit.Z);
    const float TzBot = std::min(MaxDistanceM, (-1.20f - Origin.Z) / DirectionUnit.Z);
    const float TTop  = std::max(TxMin, TzTop);
    const float TBot  = std::min(TxMax, TzBot);
    if (TBot <= TTop + 1.0e-5f)
    {
        return false;
    }

    constexpr uint32_t Steps    = 56u;
    constexpr float    DryCutM  = 1.2e-3f;
    const float        Dt       = (TBot - TTop) / static_cast<float>(Steps);
    float              PrevT    = TTop;
    for (uint32_t S = 0u; S <= Steps; ++S)
    {
        const float TTest = TTop + static_cast<float>(S) * Dt;
        if (TTest > MaxDistanceM + 1.0e-4f)
        {
            break;
        }
        const Vec3 P = Origin + DirectionUnit * TTest;
        if (P.X >= MinX && P.X <= MaxX && P.Y >= MinY && P.Y <= MaxY)
        {
            const SurfaceFluidSample Samp = Context.ShallowWater->SampleSurface({P.X, P.Y});
            if (Samp.FluidDepthMetres > DryCutM && P.Z <= Samp.FreeSurfaceElevationM + 1.0e-5f)
            {
                // Refine exact sub-millimetre shoreline / free-surface intersection via 10 binary bisection iterations!
                float LoT           = PrevT;
                float HiT           = TTest;
                SurfaceFluidSample BestSamp = Samp;
                for (uint32_t Iter = 0u; Iter < 10u; ++Iter)
                {
                    const float MidT = 0.5f * (LoT + HiT);
                    const Vec3  MidP = Origin + DirectionUnit * MidT;
                    if (MidP.X >= MinX && MidP.X <= MaxX && MidP.Y >= MinY && MidP.Y <= MaxY)
                    {
                        const SurfaceFluidSample MidS = Context.ShallowWater->SampleSurface({MidP.X, MidP.Y});
                        if (MidS.FluidDepthMetres > DryCutM && MidP.Z <= MidS.FreeSurfaceElevationM)
                        {
                            HiT      = MidT;
                            BestSamp = MidS;
                        }
                        else
                        {
                            LoT = MidT;
                        }
                    }
                    else
                    {
                        LoT = MidT;
                    }
                }
                if (HiT <= MaxDistanceM + 1.0e-4f)
                {
                    const Vec3 HitP  = Origin + DirectionUnit * HiT;
                    OutHitDistanceM  = HiT;
                    OutWaterHitWorld = Vec3{HitP.X, HitP.Y, BestSamp.FreeSurfaceElevationM};
                    OutSample        = BestSamp;
                    return true;
                }
            }
        }
        PrevT = TTest;
    }
    return false;
}

double SceneRenderer::EvaluateSolarFlareVisibility(
    Vec3                              CameraOriginWorld,
    Vec3                              SunDirectionUnit,
    const CoupledWorldOpticalContext& Context) const noexcept
{
    if (SunDirectionUnit.Z <= -0.02f)
    {
        return 0.0;
    }

    const Vec3 UpRef      = (std::abs(SunDirectionUnit.Z) < 0.92f) ? Vec3{0.0f, 0.0f, 1.0f} : Vec3{1.0f, 0.0f, 0.0f};
    const Vec3 BasisRight = Normalise(Cross(SunDirectionUnit, UpRef));
    const Vec3 BasisUp    = Cross(BasisRight, SunDirectionUnit);

    const float     DiscRadiusRad = static_cast<float>(std::max(1.0e-3, Context.SolarDisc.AngularRadiusRad));
    constexpr int   TapCount      = 21;
    constexpr float GoldenAngle   = 2.39996323f;
    double          VisSum        = 0.0;

    for (int I = 0; I < TapCount; ++I)
    {
        const float Rad   = DiscRadiusRad * std::sqrt((static_cast<float>(I) + 0.5f) / static_cast<float>(TapCount));
        const float Theta = GoldenAngle * static_cast<float>(I);
        const Vec3  RayD  = Normalise(
            SunDirectionUnit + BasisRight * (Rad * std::cos(Theta)) + BasisUp * (Rad * std::sin(Theta)));

        if (!TraceShadowUnoccluded(GpuTracingTier::HardwareRayTracingRtx, CameraOriginWorld, RayD, 220.0f))
        {
            continue;
        }

        double Trans = 1.0;
        if (RayD.Z > 0.02f)
        {
            const CloudMarchResult CloudRes = MarchClouds(
                Context.Clouds,
                ToSpatial(CameraOriginWorld),
                ToSpatial(RayD),
                ToSpatial(SunDirectionUnit),
                SpectrumRgb{1.0, 1.0, 1.0},
                18000.0,
                10u,
                2u);
            Trans *= CloudRes.Transmittance;
        }
        if (Context.PlumeFluid != nullptr)
        {
            Trans *= static_cast<double>(
                Context.PlumeFluid->EvaluateShadowTransmittance(ToArr3(CameraOriginWorld), ToArr3(RayD), 90.0f));
        }
        VisSum += Trans;
    }
    return std::clamp(VisSum / static_cast<double>(TapCount), 0.0, 1.0);
}

bool SceneRenderer::TraceShadowUnoccluded(
    GpuTracingTier /*Tier*/,
    Vec3  Origin,
    Vec3  DirectionUnit,
    float MaxDistanceM) const noexcept
{
    // Transmissive glass never casts opaque black brick shadows (Glass-Aware Nanite visibility rule)!
    const InternalSurfaceHit Hit = TraceTriangleBvh(Origin + DirectionUnit * 0.02f, DirectionUnit, MaxDistanceM, true);
    return !Hit.Hit;
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                         VOLUMETRIC CLOUDS + CELESTIAL SKY + FOG + PLUME + SWEPT SPARK CAPSULES
------------------------------------------------------------------------------------------------------------------------------------------*/
Vec3 SceneRenderer::EvaluateVolumetricSegmentAndSky(
    Vec3                              SegmentOrigin,
    Vec3                              SegmentDirectionUnit,
    float                             SegmentLengthM,
    bool                              ReachedInfinitySky,
    const CoupledWorldOpticalContext& Context,
    float&                            OutPlumeOpacity,
    float&                            OutCloudLuminance,
    float&                            OutCelestialLuminance) const noexcept
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

        // Limb-darkened physical solar disc (LensFlareModel.h) + smooth atmospheric Mie aureole!
        const float SunStrength = LuminanceRec709(Context.SunIrradianceRgb);
        if (SunStrength > 0.25f)
        {
            const float  CosSun   = std::clamp(Dot(SegmentDirectionUnit, SunDir), -1.0f, 1.0f);
            const double AngleRad = std::acos(static_cast<double>(CosSun));
            const SpectrumRgb DiscRad = EvaluateSunDiscRadiance(
                AngleRad,
                Context.SolarDisc,
                SpectrumRgb{
                    static_cast<double>(Context.SunIrradianceRgb.X * 16.0f),
                    static_cast<double>(Context.SunIrradianceRgb.Y * 16.0f),
                    static_cast<double>(Context.SunIrradianceRgb.Z * 16.0f)});
            BackgroundRgb = BackgroundRgb + FromSpectrum(DiscRad);

            if (CosSun > 0.965f)
            {
                const float AureoleInner = std::pow(std::clamp((CosSun - 0.992f) / 0.008f, 0.0f, 1.0f), 2.5f);
                const float AureoleWide  = std::pow(std::clamp((CosSun - 0.965f) / 0.035f, 0.0f, 1.0f), 4.0f);
                BackgroundRgb            = BackgroundRgb + Context.SunIrradianceRgb * (0.62f * AureoleInner + 0.14f * AureoleWide);
            }
        }

        // 2. Full Celestial Sky: 41k Hipparcos Stars, Milky Way, Custom Stars, Textured Moon & Ringed Planet w/ Atmosphere!
        if (Context.CelestialSky != nullptr && SegmentDirectionUnit.Z > -0.02f)
        {
            const Vec3 ExoSunDir = (Length(Context.CelestialSunDirectionUnit) > 0.1f)
                                       ? Normalise(Context.CelestialSunDirectionUnit)
                                       : SunDir;
            const Vec3 ExoSunRad = (Length(Context.CelestialSunDirectionUnit) > 0.1f)
                                       ? Context.CelestialSunRadianceRgb
                                       : Context.SunIrradianceRgb;
            const float              SolarElevDeg = std::asin(std::clamp(SunDir.Z, -1.0f, 1.0f)) * (180.0f / PiFloat);
            const CelestialRaySample Cel          = Context.CelestialSky->EvaluateCelestialRay(
                SegmentDirectionUnit,
                ExoSunDir,
                ExoSunRad,
                SolarElevDeg);
            const float SkyLum         = LuminanceRec709(BackgroundRgb);
            const float DaylightVeil   = 1.0f / (1.0f + 2.8f * SkyLum);
            const bool  HitSolidBody   = (Cel.HitLunarDisc || Cel.HitPlanetBody || Cel.HitPlanetaryRings || Cel.HitPlanetAtmosphere);
            const Vec3  CelestialAdded = HitSolidBody
                                             ? (BackgroundRgb * Cel.OcclusionTransmittance + Cel.RadianceRgb)
                                             : (BackgroundRgb + Cel.RadianceRgb * DaylightVeil);
            OutCelestialLuminance      = std::max(OutCelestialLuminance, LuminanceRec709(Cel.RadianceRgb));
            BackgroundRgb              = CelestialAdded;
        }

        // 3. Zero-banding 64-step volumetric CloudField raymarch (with IGN phase jitter) + internal Lightning cloud scattering!
        if (SegmentDirectionUnit.Z > 0.015f)
        {
            const double RayPhaseJitter01 = static_cast<double>(ComputeRayPhaseJitter01(SegmentOrigin, SegmentDirectionUnit));
            const CloudMarchResult CloudRes = MarchClouds(
                Context.Clouds,
                ToSpatial(SegmentOrigin),
                ToSpatial(SegmentDirectionUnit),
                ToSpatial(SunDir),
                SunSpec,
                40000.0,
                64u,
                6u,
                RayPhaseJitter01);

            Vec3 CloudRad = FromSpectrum(CloudRes.Radiance);

            // Nocturnal lunar + custom-star silver lining on clouds when CelestialSky is active!
            if (Context.CelestialSky != nullptr)
            {
                const Vec3 ExoSunDir = (Length(Context.CelestialSunDirectionUnit) > 0.1f)
                                           ? Normalise(Context.CelestialSunDirectionUnit)
                                           : SunDir;
                const Vec3 ExoSunRad = (Length(Context.CelestialSunDirectionUnit) > 0.1f)
                                           ? Context.CelestialSunRadianceRgb
                                           : Context.SunIrradianceRgb;
                const Vec3 NocturnalIrr = Context.CelestialSky->EvaluateNocturnalDirectIrradiance(
                    Vec3{0.0f, 0.0f, 1.0f},
                    ExoSunDir,
                    ExoSunRad);
                CloudRad = CloudRad + NocturnalIrr * static_cast<float>(0.38 * (1.0 - CloudRes.Transmittance));
            }

            if (Context.Lightning != nullptr && Context.Lightning->InstantaneousFlashEnvelope() > 1.0e-3f)
            {
                const float TCloud = static_cast<float>((Context.Clouds.BaseHeightM + 220.0 - SegmentOrigin.Z) /
                                                        std::max(0.05f, SegmentDirectionUnit.Z));
                if (TCloud > 0.0f && TCloud < 25000.0f)
                {
                    const Vec3   CloudHit = SegmentOrigin + SegmentDirectionUnit * TCloud;
                    const double Dens     = CloudDensity(Context.Clouds, ToSpatial(CloudHit));
                    CloudRad              = CloudRad + Context.Lightning->EvaluateCloudInternalFlashRadiance(CloudHit, Dens);
                }
            }

            OutCloudLuminance = std::max(OutCloudLuminance, LuminanceRec709(CloudRad) * static_cast<float>(1.0 - CloudRes.Transmittance));
            BackgroundRgb     = BackgroundRgb * static_cast<float>(CloudRes.Transmittance) + CloudRad;
        }
    }

    // 4. Exponential Height Fog along segment!
    const double FogDist = ReachedInfinitySky ? 320.0 : static_cast<double>(SegmentLengthM);
    const double FogT    = FogTransmittance(Context.Fog, ToSpatial(SegmentOrigin), ToSpatial(SegmentDirectionUnit), FogDist);
    SpectrumRgb  FogTint = Context.Fog.Colour;
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

    const float RayJitter01 = ComputeRayPhaseJitter01(SegmentOrigin, SegmentDirectionUnit);

    // 5. 3D PlumeFluid Explosions, Internal-Lit Soot & Blackbody Fire raymarch with per-ray IGN jitter (zero slab banding)!
    if (Context.PlumeFluid != nullptr)
    {
        const float PlumeMaxDist = std::min(SegmentLengthM, 160.0f);
        const auto  PlumeRgba    = Context.PlumeFluid->EvaluatePlumeRay(
            ToArr3(SegmentOrigin),
            ToArr3(SegmentDirectionUnit),
            PlumeMaxDist,
            RayJitter01,
            ToArr3(SunDir),
            ToArr3(Context.SunIrradianceRgb * 0.88f),
            {0.18f, 0.24f, 0.35f});

        const float PlumeTrans = std::clamp(PlumeRgba[3], 0.0f, 1.0f);
        OutPlumeOpacity        = std::max(OutPlumeOpacity, 1.0f - PlumeTrans);
        Composed               = Composed * PlumeTrans + Vec3{PlumeRgba[0], PlumeRgba[1], PlumeRgba[2]};
    }

    // 6. Volumetric Falling Sky Precipitation (3D Snow Crystals, Sleet/Graupel & Rain Streaks)!
    if (Context.Precipitation != nullptr && Context.Precipitation->Configuration().Intensity01 > 1.0e-3f)
    {
        float      PrecipTrans = 1.0f;
        const Vec3 SkyAmb      = Vec3{0.22f, 0.28f, 0.38f} + Context.SunIrradianceRgb * 0.035f;
        const Vec3 PrecipRad   = Context.Precipitation->EvaluateRayPrecipitation(
            SegmentOrigin,
            SegmentDirectionUnit,
            std::min(SegmentLengthM, 52.0f),
            SunDir,
            Context.SunIrradianceRgb,
            SkyAmb,
            0.00145f,
            &PrecipTrans);
        Composed = Composed * PrecipTrans + PrecipRad;
    }

    // 7. Crisp Shutter-Integrated Incandescent Ballistic Spark Motion Streaks (SparkRaster.wgsl parity)!
    if (Context.Sparks != nullptr && !Context.Sparks->Sparks().empty())
    {
        const Vec3 SparkGlow = Context.Sparks->EvaluateRaySparkStreaks(
            SegmentOrigin,
            SegmentDirectionUnit,
            std::min(SegmentLengthM, 48.0f),
            0.00145f,
            0.024f);
        Composed = Composed + ClampRadianceFirefly(SparkGlow, 34.0f);
    }

    return Composed;
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                     DIRECT ILLUMINATION: SUN + CELESTIAL + SOLID-ANGLE AREA LUMINAIRES + FIRE + SPARKS
------------------------------------------------------------------------------------------------------------------------------------------*/
Vec3 SceneRenderer::EvaluateDirectSurfaceLighting(
    GpuTracingTier                    Tier,
    Vec3                              Point,
    Vec3                              Normal,
    Vec3                              ViewDirUnit,
    Vec3                              Albedo,
    float                             Roughness,
    float                             Metallic,
    const CoupledWorldOpticalContext& Context,
    bool                              SnowSubsurface) const noexcept
{
    const float Alpha       = std::max(0.03f, Roughness * Roughness);
    const float NdotV       = std::max(1.0e-3f, Dot(Normal, ViewDirUnit));
    const Vec3  DiffuseBase = Albedo * (1.0f - std::clamp(Metallic, 0.0f, 1.0f)) * (1.0f / PiFloat);
    const Vec3  F0{
        0.04f * (1.0f - Metallic) + Albedo.X * Metallic,
        0.04f * (1.0f - Metallic) + Albedo.Y * Metallic,
        0.04f * (1.0f - Metallic) + Albedo.Z * Metallic};

    auto AddCookTorranceContribution = [&](Vec3 LDir, Vec3 IrradianceRgb, float EffectiveAlpha) -> Vec3
    {
        const float NdotL = std::max(0.0f, Dot(Normal, LDir));
        if (NdotL <= 1.0e-5f)
        {
            return Vec3{0.0f, 0.0f, 0.0f};
        }
        const Vec3  H      = Normalise(LDir + ViewDirUnit);
        const float NdotH  = std::max(0.0f, Dot(Normal, H));
        const float VdotH  = std::max(0.0f, Dot(ViewDirUnit, H));
        const float A2     = EffectiveAlpha * EffectiveAlpha;
        const float DenomD = NdotH * NdotH * (A2 - 1.0f) + 1.0f;
        const float D      = A2 / std::max(1.0e-5f, PiFloat * DenomD * DenomD);
        const float K      = 0.5f * EffectiveAlpha;
        const float G1V    = NdotV / (NdotV * (1.0f - K) + K);
        const float G1L    = NdotL / (NdotL * (1.0f - K) + K);
        const float Vis    = (G1V * G1L) / std::max(1.0e-4f, 4.0f * NdotV * NdotL);
        const float Schlick = std::pow(1.0f - VdotH, 5.0f);
        const Vec3  F{
            F0.X + (1.0f - F0.X) * Schlick,
            F0.Y + (1.0f - F0.Y) * Schlick,
            F0.Z + (1.0f - F0.Z) * Schlick};
        const float SpecScalar = std::min(14.0f, D * Vis); // Bound singular mirror delta spike on direct glints
        const Vec3  Brdf{
            DiffuseBase.X * (1.0f - F.X) + F.X * SpecScalar,
            DiffuseBase.Y * (1.0f - F.Y) + F.Y * SpecScalar,
            DiffuseBase.Z * (1.0f - F.Z) + F.Z * SpecScalar};
        return Vec3{
            Brdf.X * IrradianceRgb.X,
            Brdf.Y * IrradianceRgb.Y,
            Brdf.Z * IrradianceRgb.Z};
    };

    Vec3 Outgoing{0.0f, 0.0f, 0.0f};

    // 1. Directional Solar Light + Volumetric Cloud & Plume Beer-Lambert Shadows!
    const Vec3  SunDir      = Normalise(Context.SunDirectionUnit);
    const float RawDotSun   = Dot(Normal, SunDir);
    const float NdotSun     = std::max(0.0f, RawDotSun);
    const float SnowWrapSun = SnowSubsurface ? std::clamp((RawDotSun + 0.36f) / 1.36f, 0.0f, 1.0f) : NdotSun;
    if ((NdotSun > 0.0f || SnowWrapSun > 0.0f) && LuminanceRec709(Context.SunIrradianceRgb) > 1.0e-4f)
    {
        // 2-tap IGN-rotated solar-disc soft shadow (~0.62 deg solar penumbra cone) -> denoised to 16-tap quality by A-Trous!
        const Vec3  RefUp      = (std::abs(SunDir.Z) < 0.92f) ? Vec3{0.0f, 0.0f, 1.0f} : Vec3{1.0f, 0.0f, 0.0f};
        const Vec3  SunTanU    = Normalise(Cross(RefUp, SunDir));
        const Vec3  SunTanV    = Cross(SunDir, SunTanU);
        const float JitterAng  = ComputeRayPhaseJitter01(Point, SunDir) * 6.2831853f;
        const float CosJ       = std::cos(JitterAng) * 0.0108f;
        const float SinJ       = std::sin(JitterAng) * 0.0108f;
        const Vec3  ShadowOrigin = Point + Normal * 0.015f;
        float       SolarVis     = 0.0f;
        if (TraceShadowUnoccluded(Tier, ShadowOrigin, Normalise(SunDir + SunTanU * CosJ + SunTanV * SinJ), 160.0f))
        {
            SolarVis += 0.5f;
        }
        if (TraceShadowUnoccluded(Tier, ShadowOrigin, Normalise(SunDir - SunTanU * CosJ - SunTanV * SinJ), 160.0f))
        {
            SolarVis += 0.5f;
        }

        if (SolarVis > 0.0f)
        {
            float VolumetricTrans = SolarVis;
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
            if (NdotSun > 0.0f)
            {
                Outgoing = Outgoing + AddCookTorranceContribution(SunDir, Context.SunIrradianceRgb * (NdotSun * VolumetricTrans), Alpha);
                if (SnowSubsurface)
                {
                    // Oren-Nayar rough alpine powder retro-reflection + discrete hexagonal ice-crystal sun sparkles!
                    const float NdotV       = std::max(0.05f, Dot(Normal, ViewDirUnit));
                    const float PowderBoost = 0.22f * Roughness * (1.0f - NdotSun * NdotV) * NdotSun * VolumetricTrans;
                    Outgoing = Outgoing + Vec3{
                        DiffuseBase.X * Context.SunIrradianceRgb.X * PowderBoost,
                        DiffuseBase.Y * Context.SunIrradianceRgb.Y * PowderBoost,
                        DiffuseBase.Z * Context.SunIrradianceRgb.Z * PowderBoost};

                    // Sub-centimetre deterministic crystal facet hash -> tiny sunlit diamond sparkles on fresh snow!
                    const float CellX = std::floor(Point.X * 145.0f);
                    const float CellY = std::floor(Point.Y * 145.0f);
                    const float CellZ = std::floor(Point.Z * 145.0f);
                    const float H0    = std::sin(CellX * 127.1f + CellY * 311.7f + CellZ * 74.7f) * 43758.5453f;
                    const float H1    = std::sin(CellX * 269.5f + CellY * 183.3f + CellZ * 246.1f) * 28461.9173f;
                    const float F0    = H0 - std::floor(H0);
                    const float F1    = H1 - std::floor(H1);
                    if (F0 > 0.935f && Roughness > 0.38f)
                    {
                        const Vec3  HalfVec   = Normalise(SunDir + ViewDirUnit);
                        const float Align     = std::max(0.0f, Dot(Normal, HalfVec));
                        const float Sparkle   = std::pow(Align, 18.0f) * (0.45f + 0.55f * F1) * VolumetricTrans;
                        Outgoing              = Outgoing + Context.SunIrradianceRgb * (0.42f * Sparkle);
                    }
                }
            }
            if (SnowSubsurface && SnowWrapSun > NdotSun)
            {
                // Deep glacier-cyan / ice-blue multiple-scattering subsurface wrap across snow mound crests & shadow terminators!
                const float SubDiff = (SnowWrapSun - NdotSun) * 0.86f * VolumetricTrans;
                Outgoing            = Outgoing + Vec3{
                    DiffuseBase.X * Context.SunIrradianceRgb.X * SubDiff * 0.76f,
                    DiffuseBase.Y * Context.SunIrradianceRgb.Y * SubDiff * 0.95f,
                    DiffuseBase.Z * Context.SunIrradianceRgb.Z * SubDiff * 1.18f};
            }
        }
    }

    // 2. Nocturnal Moon + Custom-Star Direct Scene Lighting (when CelestialSky is active)!
    if (Context.CelestialSky != nullptr)
    {
        bool ShadowedMoon = false;
        for (const auto& Moon : Context.CelestialSky->LunarBodies())
        {
            const Vec3 MoonDir = Normalise(Moon.DirectionUnit);
            if (MoonDir.Z > 0.02f && Dot(Normal, MoonDir) > 0.0f &&
                !TraceShadowUnoccluded(Tier, Point + Normal * 0.015f, MoonDir, 160.0f))
            {
                ShadowedMoon = true;
            }
        }
        const Vec3 ExoSunDir = (Length(Context.CelestialSunDirectionUnit) > 0.1f)
                                   ? Normalise(Context.CelestialSunDirectionUnit)
                                   : SunDir;
        const Vec3 ExoSunRad = (Length(Context.CelestialSunDirectionUnit) > 0.1f)
                                   ? Context.CelestialSunRadianceRgb
                                   : Context.SunIrradianceRgb;
        const Vec3 NocturnalIrr = Context.CelestialSky->EvaluateNocturnalDirectIrradiance(
            Normal,
            ExoSunDir,
            ExoSunRad) * (ShadowedMoon ? 0.22f : 1.0f);
        if (LuminanceRec709(NocturnalIrr) > 1.0e-5f)
        {
            Vec3 DomDir = Normal;
            if (!Context.CelestialSky->LunarBodies().empty())
            {
                DomDir = Normalise(Context.CelestialSky->LunarBodies()[0].DirectionUnit);
            }
            else if (!Context.CelestialSky->CustomStars().empty())
            {
                DomDir = Normalise(Context.CelestialSky->CustomStars()[0].DirectionUnit);
            }
            Outgoing = Outgoing + AddCookTorranceContribution(DomDir, NocturnalIrr, Alpha);
        }
    }

    // 3. Solid-Angle Rectangular Area Luminaires (Nonsingular NEE + Karis Representative-Point GGX Specular)!
    const Vec3 ReflectDir = Normalise(ViewDirUnit * (-1.0f) + Normal * (2.0f * Dot(ViewDirUnit, Normal)));
    for (const auto& Lum : Luminaires_)
    {
        const Vec3  ToCentre = Lum.CentreWorld - Point;
        const float DistC    = Length(ToCentre);
        if (DistC <= 1.0e-3f || DistC > 55.0f)
        {
            continue;
        }
        const Vec3  DirC         = ToCentre * (1.0f / DistC);
        const float LuminaireCos = Lum.TwoSided ? std::abs(Dot(Lum.FrontNormal, -DirC))
                                                : std::max(0.0f, Dot(Lum.FrontNormal, -DirC));
        if (LuminaireCos <= 1.0e-4f)
        {
            continue;
        }

        // 3-tap soft area-light visibility across the luminaire span -> smooth penumbrae instead of jagged shadow edges!
        const Vec3 Offs[3] = {
            Vec3{0.0f, 0.0f, 0.0f},
            Lum.RightAxis * (0.65f * Lum.HalfWidthMetres) + Lum.UpAxis * (0.45f * Lum.HalfHeightMetres),
            Lum.RightAxis * (-0.65f * Lum.HalfWidthMetres) - Lum.UpAxis * (0.45f * Lum.HalfHeightMetres)};
        float VisSum = 0.0f;
        for (int Tap = 0; Tap < 3; ++Tap)
        {
            const Vec3  SampleTarget = Lum.CentreWorld + Offs[Tap];
            const Vec3  Delta        = SampleTarget - Point;
            const float TapDist      = Length(Delta);
            if (TapDist > 0.08f)
            {
                const Vec3 TapDir = Delta * (1.0f / TapDist);
                if (Dot(Normal, TapDir) > 0.0f &&
                    TraceShadowUnoccluded(Tier, Point + Normal * 0.02f, TapDir, std::max(0.05f, TapDist - 0.14f)))
                {
                    VisSum += 1.0f;
                }
            }
        }
        const float SoftVis = VisSum * (1.0f / 3.0f);
        if (SoftVis <= 1.0e-4f)
        {
            continue;
        }

        // Nonsingular solid angle of rectangular luminaire (bounded at d -> 0 by 2*pi, zero 1/r^2 blowouts!).
        const float AreaM2     = 4.0f * Lum.HalfWidthMetres * Lum.HalfHeightMetres;
        const float SolidAngle = (AreaM2 * LuminaireCos) / (DistC * DistC + AreaM2 * (1.0f / PiFloat) + 0.06f);
        const float NdotLC     = std::max(0.0f, Dot(Normal, DirC));
        const Vec3  DiffIrr    = Lum.EmissiveRadianceRgb * (SolidAngle * NdotLC * SoftVis);

        Outgoing = Outgoing + Vec3{
            DiffuseBase.X * DiffIrr.X,
            DiffuseBase.Y * DiffIrr.Y,
            DiffuseBase.Z * DiffIrr.Z};

        // Karis Representative-Point Specular on Rectangular Area Luminaire!
        Vec3 RepPoint = Lum.CentreWorld;
        const float PlaneDenom = Dot(ReflectDir, Lum.FrontNormal);
        if (std::abs(PlaneDenom) > 1.0e-4f)
        {
            const float TPlane = Dot(Lum.CentreWorld - Point, Lum.FrontNormal) / PlaneDenom;
            if (TPlane > 0.0f)
            {
                const Vec3  OnPlane = Point + ReflectDir * TPlane - Lum.CentreWorld;
                const float ClampedU = std::clamp(Dot(OnPlane, Lum.RightAxis), -Lum.HalfWidthMetres, Lum.HalfWidthMetres);
                const float ClampedV = std::clamp(Dot(OnPlane, Lum.UpAxis), -Lum.HalfHeightMetres, Lum.HalfHeightMetres);
                RepPoint             = Lum.CentreWorld + Lum.RightAxis * ClampedU + Lum.UpAxis * ClampedV;
            }
            else
            {
                const Vec3  ClosestRay = Point + ReflectDir * std::max(0.0f, Dot(ToCentre, ReflectDir)) - Lum.CentreWorld;
                const float ClampedU   = std::clamp(Dot(ClosestRay, Lum.RightAxis), -Lum.HalfWidthMetres, Lum.HalfWidthMetres);
                const float ClampedV   = std::clamp(Dot(ClosestRay, Lum.UpAxis), -Lum.HalfHeightMetres, Lum.HalfHeightMetres);
                RepPoint               = Lum.CentreWorld + Lum.RightAxis * ClampedU + Lum.UpAxis * ClampedV;
            }
        }
        const Vec3  ToRep    = RepPoint - Point;
        const float RepDist  = std::max(0.08f, Length(ToRep));
        const Vec3  RepDir   = ToRep * (1.0f / RepDist);
        const float NdotRep  = std::max(0.0f, Dot(Normal, RepDir));
        if (NdotRep > 0.0f)
        {
            const float CharRadius  = std::sqrt(Lum.HalfWidthMetres * Lum.HalfHeightMetres);
            const float WidenedAlpha = std::clamp(Alpha + CharRadius / (2.0f * RepDist + 0.35f), Alpha, 1.0f);
            const float EnergyNorm   = std::pow(Alpha / WidenedAlpha, 2.0f);
            const Vec3  SpecOnly     = AddCookTorranceContribution(
                RepDir,
                Lum.EmissiveRadianceRgb * (SolidAngle * NdotRep * SoftVis * EnergyNorm),
                WidenedAlpha);
            // Subtract diffuse part already added above so only area-specular lobe is added here.
            Outgoing = Outgoing + Vec3{
                std::max(0.0f, SpecOnly.X - DiffuseBase.X * Lum.EmissiveRadianceRgb.X * SolidAngle * NdotRep * SoftVis * EnergyNorm),
                std::max(0.0f, SpecOnly.Y - DiffuseBase.Y * Lum.EmissiveRadianceRgb.Y * SolidAngle * NdotRep * SoftVis * EnergyNorm),
                std::max(0.0f, SpecOnly.Z - DiffuseBase.Z * Lum.EmissiveRadianceRgb.Z * SolidAngle * NdotRep * SoftVis * EnergyNorm)};
        }
    }

    // 4. Sky hemisphere ambient fill (scaled automatically by solar vs nocturnal twilight regime)!
    const float SolarScale = std::clamp(LuminanceRec709(Context.SunIrradianceRgb) * 0.075f, 0.06f, 1.0f);
    const float SkyWrap    = 0.5f + 0.5f * Normal.Z;
    const Vec3  SkyAmb     = Vec3{0.24f, 0.33f, 0.48f} * (SkyWrap * SolarScale);
    Outgoing = Outgoing + Vec3{
        DiffuseBase.X * SkyAmb.X * PiFloat,
        DiffuseBase.Y * SkyAmb.Y * PiFloat,
        DiffuseBase.Z * SkyAmb.Z * PiFloat};

    // 5. Dynamic PlumeFluid Fire & Hot-Gas illumination (soft-compressed so near-field floor stays rich amber, not clipped white)!
    if (Context.PlumeFluid != nullptr)
    {
        const auto FireIrr  = Context.PlumeFluid->EvaluateSceneIllumination(ToArr3(Point), ToArr3(Normal));
        const Vec3 SoftFire = ClampRadianceFirefly(Vec3{FireIrr[0], FireIrr[1], FireIrr[2]} * 0.32f, 5.5f);
        Outgoing            = Outgoing + Vec3{DiffuseBase.X * SoftFire.X, DiffuseBase.Y * SoftFire.Y, DiffuseBase.Z * SoftFire.Z};
    }

    // 6. Dynamic Colliding Spark illumination (soft-radius compressed to prevent 1/r^2 floor whiteouts)!
    if (Context.Sparks != nullptr)
    {
        const Vec3 SparkIrr = ClampRadianceFirefly(Context.Sparks->EvaluateShadowedSceneIrradiance(Point, Normal) * 0.28f, 5.2f);
        Outgoing            = Outgoing + Vec3{DiffuseBase.X * SparkIrr.X, DiffuseBase.Y * SparkIrr.Y, DiffuseBase.Z * SparkIrr.Z};
    }

    // 7. Dynamic Storm Lightning illumination!
    if (Context.Lightning != nullptr)
    {
        const Vec3 FlashIrr = Context.Lightning->EvaluateSceneFlashIrradiance(Point, Normal);
        Outgoing            = Outgoing + Vec3{DiffuseBase.X * FlashIrr.X, DiffuseBase.Y * FlashIrr.Y, DiffuseBase.Z * FlashIrr.Z};
    }

    return Outgoing;
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                         DUAL-TIER RESTIR INDIRECT GI RESERVOIR SAMPLING (GTX SDF vs RTX RAYQUERY)
------------------------------------------------------------------------------------------------------------------------------------------*/
DualTierGiReservoir SceneRenderer::SampleRestirIndirectReservoir(
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

        // Cross-portal indirect GI bounce support on BOTH GTX and RTX tiers (rectangular & circular portals)!
        for (const auto& Portal : Portals_)
        {
            float PortalT = 0.0f, U = 0.0f, V = 0.0f;
            if (IntersectPortalAperture(
                    BounceOrigin,
                    BounceDir,
                    Portal,
                    40.0f,
                    PortalT,
                    U,
                    V))
            {
                const InternalSurfaceHit PreHit = (Tier == GpuTracingTier::SignedDistanceFieldGtx)
                                                      ? TraceSdfSurfaceCards(BounceOrigin, BounceDir, PortalT)
                                                      : TraceTriangleBvh(BounceOrigin, BounceDir, PortalT, true);
                if (!PreHit.Hit)
                {
                    const Vec3 HitOnPortal = BounceOrigin + BounceDir * PortalT;
                    TransformRayAcrossPortal(Portal, HitOnPortal, BounceDir, BounceOrigin, BounceDir);
                    break;
                }
            }
        }

        InternalSurfaceHit SecHit{};
        if (Tier == GpuTracingTier::SignedDistanceFieldGtx)
        {
            // GTX TIER: Diffuse ReSTIR GI sphere-traces SDF + SurfaceCards!
            SecHit = TraceSdfSurfaceCards(BounceOrigin, BounceDir, 55.0f);
            ++Reservoir.SdfGiQueries;
        }
        else
        {
            // RTX TIER: Diffuse ReSTIR GI traces full Hardware RT / Triangle BVH!
            SecHit = TraceTriangleBvh(BounceOrigin, BounceDir, 55.0f, true);
            ++Reservoir.RtxGiQueries;
        }

        Vec3 CandRadiance{0.0f, 0.0f, 0.0f};
        Vec3 CandPos = BounceOrigin + BounceDir * 25.0f;
        Vec3 CandNrm = -BounceDir;

        if (SecHit.Hit)
        {
            CandPos = SecHit.Position;
            CandNrm = SecHit.Normal;
            if (Tier == GpuTracingTier::SignedDistanceFieldGtx && SecHit.CardIndex < SurfaceCards_.size())
            {
                const uint32_t Face = SelectPrincipalCardFace(SecHit.Normal);
                CandRadiance        = SurfaceCards_[SecHit.CardIndex].FaceIrradianceCache[Face];
            }
            else
            {
                // Since AreaLuminaires are evaluated noiselessly via solid-angle NEE in Direct Lighting, bound raw
                // secondary emissive hits here (MIS firefly suppression) so indirect GI never creates 1-pixel speckles!
                const Vec3 BoundedEmissive = ClampRadianceFirefly(SecHit.EmissiveRgb * 0.25f, 4.5f);
                const Vec3 SecDirect       = EvaluateDirectSurfaceLighting(
                    Tier,
                    SecHit.Position,
                    SecHit.Normal,
                    -BounceDir,
                    SecHit.AlbedoRgb,
                    SecHit.Roughness,
                    SecHit.Metallic,
                    Context);
                CandRadiance = ClampRadianceFirefly(BoundedEmissive + SecDirect, 12.0f);
            }
        }
        else
        {
            const float SkyScale = std::clamp(LuminanceRec709(Context.SunIrradianceRgb) * 0.075f, 0.08f, 1.0f);
            CandRadiance         = Vec3{0.18f, 0.25f, 0.36f} * SkyScale;
            if (Context.CelestialSky != nullptr)
            {
                const Vec3 ExoSunDir = (Length(Context.CelestialSunDirectionUnit) > 0.1f)
                                           ? Normalise(Context.CelestialSunDirectionUnit)
                                           : Normalise(Context.SunDirectionUnit);
                const Vec3 ExoSunRad = (Length(Context.CelestialSunDirectionUnit) > 0.1f)
                                           ? Context.CelestialSunRadianceRgb
                                           : Context.SunIrradianceRgb;
                CandRadiance = CandRadiance + Context.CelestialSky->EvaluateNocturnalDirectIrradiance(
                    Vec3{0.0f, 0.0f, 1.0f},
                    ExoSunDir,
                    ExoSunRad) * 0.65f;
            }
        }

        const float TargetPdf = std::max(1.0e-5f, LuminanceRec709(CandRadiance));
        const float SourcePdf = std::max(1.0e-3f, Dot(ShadingNormalUnit, Normalise(CandPos - ShadingPointWorld)) / PiFloat);
        const float RisWeight = TargetPdf / SourcePdf;

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
        Reservoir.IntegrationWeightW = std::min(
            6.0f,
            Reservoir.WeightSum / (static_cast<float>(Reservoir.SampleCountM) * Reservoir.TargetPdf));
    }
    return Reservoir;
}

DualTierGiReservoir SceneRenderer::MergeSpatialReservoirs(
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
    const Vec3  DirToSample = ToSample * (1.0f / Dist);
    const float CosPrimary  = std::max(0.0f, Dot(PrimaryNormal, DirToSample));
    if (CosPrimary <= 0.02f)
    {
        return Combined;
    }

    // Solid-angle reconnection Jacobian clamp prevents extreme singularity spikes near corners!
    const float CosSample = std::max(0.08f, std::abs(Dot(Neighbor.SampleNormalWorld, -DirToSample)));
    const float Jacobian  = std::clamp(CosSample / std::max(0.15f, Dist * 0.12f), 0.2f, 3.0f);

    const uint32_t ClampedM   = std::min(Neighbor.SampleCountM, 12u);
    const float    ShiftedPdf = LuminanceRec709(Neighbor.SampleRadianceRgb) * CosPrimary * Jacobian;
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
        Combined.IntegrationWeightW = std::min(
            6.0f,
            Combined.WeightSum / (static_cast<float>(Combined.SampleCountM) * Combined.TargetPdf));
    }
    return Combined;
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                     COUPLED RADIANCE RAY (MIRRORS, PORTALS, DIELECTRIC GLASS, WATER & VOLUMETRICS)
------------------------------------------------------------------------------------------------------------------------------------------*/
TracedRayDiagnostics SceneRenderer::TraceCoupledRadianceRay(
    GpuTracingTier                    Tier,
    Vec3                              RayOriginWorld,
    Vec3                              RayDirectionUnit,
    const CoupledWorldOpticalContext& Context,
    uint64_t                          PixelRandomSeed) const noexcept
{
    TracedRayDiagnostics Out{};
    Vec3                 CurrOrigin   = RayOriginWorld;
    Vec3                 CurrDir      = Normalise(RayDirectionUnit);
    Vec3                 Throughput{1.0f, 1.0f, 1.0f};
    Vec3                 AccumRadiance{0.0f, 0.0f, 0.0f};
    const uint32_t       MaxBounces   = std::min(7u, Context.MaxApertureBounces + 2u);

    for (uint32_t Bounce = 0u; Bounce < MaxBounces; ++Bounce)
    {
        float BestDistance = 1.0e6f;

        // CRITICAL ARCHITECTURE INVARIANT:
        // Both GTX (software triangle BVH) and RTX (hardware RayQuery triangle BVH) trace exact triangles for
        // Primary Visibility AND Reflections/Mirrors/Portals/Glass/Water — NEVER coarse SDF boxes!
        const InternalSurfaceHit SolidHit = TraceTriangleBvh(CurrOrigin, CurrDir, BestDistance, false);
        if (Bounce > 0u)
        {
            ++Out.BvhTriangleReflectionRays;
        }
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

        // 3. Check Seamless Portals in front of SolidHit / Mirror (rectangular & circular portals)!
        int   HitPortalIdx = -1;
        float PortalU = 0.0f, PortalV = 0.0f;
        for (size_t P = 0u; P < Portals_.size(); ++P)
        {
            float T = 0.0f, U = 0.0f, V = 0.0f;
            if (IntersectPortalAperture(
                    CurrOrigin,
                    CurrDir,
                    Portals_[P],
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

        // 4. Check 2.5D Shallow-Water & Mud free-surface sheet via tight-slab + 10-step bisection root-finder!
        bool               HitWater = false;
        SurfaceFluidSample WaterSample{};
        Vec3               WaterHitPt{};
        float              WaterHitDist = BestDistance;
        if (IntersectShallowWaterSurface(CurrOrigin, CurrDir, BestDistance, Context, WaterHitDist, WaterHitPt, WaterSample))
        {
            BestDistance = WaterHitDist;
            HitWater     = true;
            HitPortalIdx = -1;
            HitMirrorIdx = -1;
        }

        const bool ReachedSky = (BestDistance >= 9.9e5f);

        // Evaluate volumetric media (Clouds, Celestial Sky, Fog, PlumeFluid Smoke/Fire, Swept Sparks) along segment!
        const Vec3 SegmentMedia = EvaluateVolumetricSegmentAndSky(
            CurrOrigin,
            CurrDir,
            ReachedSky ? 120.0f : BestDistance,
            ReachedSky,
            Context,
            Out.PlumeOpticalOpacity,
            Out.CloudReflectionLuminance,
            Out.CelestialLuminance);

        if (ReachedSky)
        {
            AccumRadiance = AccumRadiance + Vec3{
                Throughput.X * SegmentMedia.X,
                Throughput.Y * SegmentMedia.Y,
                Throughput.Z * SegmentMedia.Z};
            break;
        }

        AccumRadiance = AccumRadiance + Vec3{
            Throughput.X * SegmentMedia.X,
            Throughput.Y * SegmentMedia.Y,
            Throughput.Z * SegmentMedia.Z};

        const float SegFogT = static_cast<float>(
            FogTransmittance(Context.Fog, ToSpatial(CurrOrigin), ToSpatial(CurrDir), static_cast<double>(BestDistance)));
        float SegPlumeT = 1.0f;
        if (Context.PlumeFluid != nullptr)
        {
            SegPlumeT = Context.PlumeFluid->EvaluateShadowTransmittance(ToArr3(CurrOrigin), ToArr3(CurrDir), std::min(BestDistance, 80.0f));
        }
        Throughput = Throughput * (SegFogT * SegPlumeT);

        // Case A: Seamless Portal transition (smooth anti-aliased glowing rectangular or circular portal rim)!
        if (HitPortalIdx >= 0)
        {
            const auto& Portal  = Portals_[static_cast<size_t>(HitPortalIdx)];
            const float EdgeGap = PortalApertureEdgeGap(Portal, PortalU, PortalV);
            if (EdgeGap < 0.055f)
            {
                const float Bevel = 0.65f + 0.35f * std::cos(PiFloat * std::clamp(EdgeGap / 0.055f, 0.0f, 1.0f));
                AccumRadiance     = AccumRadiance + Vec3{
                    Throughput.X * Portal.PortalRimGlowRgb.X * 2.4f * Bevel,
                    Throughput.Y * Portal.PortalRimGlowRgb.Y * 2.4f * Bevel,
                    Throughput.Z * Portal.PortalRimGlowRgb.Z * 2.4f * Bevel};
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

        // Case C: 2.5D Puddle / Shallow-Water / Bingham-Mud surface (smooth shoreline feather + Fresnel reflections)!
        if (HitWater)
        {
            Out.HitWaterSurface = true;
            const Vec3 HydroN   = Normalise(Vec3{
                WaterSample.SurfaceNormal[0],
                WaterSample.SurfaceNormal[1],
                WaterSample.SurfaceNormal[2]});
            const float DepthM   = WaterSample.FluidDepthMetres;
            const float WetT     = std::clamp((DepthM - 0.0012f) / 0.018f, 0.0f, 1.0f);
            const float WetAlpha = WetT * WetT * (3.0f - 2.0f * WetT);
            const float MudC     = std::clamp(WaterSample.MudConcentration, 0.0f, 1.0f) * WetAlpha;
            const float RainRings = (Context.Precipitation != nullptr &&
                                     Context.Precipitation->Configuration().Phase == SkyPrecipitationPhase::Rainfall)
                                        ? Context.Precipitation->Configuration().Intensity01
                                        : 0.0f;
            const Vec3  WaterN   = EvaluateCapillaryWaterNormal(
                HydroN,
                WaterHitPt,
                DepthM,
                MudC,
                BestDistance,
                Context.WaterCapillaryRippleStrength,
                RainRings);
            const float CosV     = std::clamp(Dot(-CurrDir, WaterN), 0.0f, 1.0f);
            const float F0       = 0.02f + 0.015f * MudC;
            const float Fresnel  = (F0 + (1.0f - F0) * std::pow(1.0f - CosV, 5.0f)) * (0.18f + 0.82f * WetAlpha);

            // Snell refraction offset onto the submerged mineral bed beneath the puddle for crisp liquid depth parallax!
            Vec3 RefractedWaterDir{};
            Vec3 BedSampleAlbedo = SolidHit.Hit ? SolidHit.AlbedoRgb : Vec3{0.20f, 0.22f, 0.25f};
            if (RefractSnell(CurrDir, HydroN, 1.0f / 1.333f, RefractedWaterDir) && RefractedWaterDir.Z < -1.0e-3f)
            {
                const Vec3  SubBedPt = WaterHitPt + RefractedWaterDir * (DepthM / std::max(0.15f, -RefractedWaterDir.Z));
                float       DummyR   = 0.45f;
                Vec3        DummyN{0.0f, 0.0f, 1.0f};
                Vec3        BaseBed = SolidHit.Hit ? Triangles_[0].AlbedoRgb : Vec3{0.18f, 0.20f, 0.23f};
                if (SolidHit.Hit)
                {
                    BaseBed = SolidHit.AlbedoRgb;
                }
                else
                {
                    EvaluateMineralGroundDetail(SubBedPt, BestDistance + DepthM, BaseBed, DummyR, DummyN);
                }
                BedSampleAlbedo = BaseBed;
            }

            const Vec3 ClearBedTint = BedSampleAlbedo;
            const Vec3 RichMudTint{0.22f, 0.14f, 0.08f};
            const Vec3 WaterAbsorb{
                std::exp(-DepthM * (0.45f + 6.0f * MudC)),
                std::exp(-DepthM * (0.18f + 7.5f * MudC)),
                std::exp(-DepthM * (0.12f + 9.5f * MudC))};
            // Wet-surface darkening (porous asphalt darkening by ~22% under thin water film, smoothly feathered at dry edge).
            const float WetDarken = 1.0f - 0.22f * WetAlpha;
            const Vec3  BodyAlbedo{
                ClearBedTint.X * WetDarken * WaterAbsorb.X * (1.0f - MudC) + RichMudTint.X * MudC,
                ClearBedTint.Y * WetDarken * WaterAbsorb.Y * (1.0f - MudC) + RichMudTint.Y * MudC,
                ClearBedTint.Z * WetDarken * WaterAbsorb.Z * (1.0f - MudC) + RichMudTint.Z * MudC};
            const Vec3 BodyRadiance = EvaluateDirectSurfaceLighting(
                Tier,
                WaterHitPt,
                WaterN,
                -CurrDir,
                BodyAlbedo,
                0.35f - 0.31f * WetAlpha + 0.45f * MudC,
                0.0f,
                Context);

            const float SolarSkyScale = std::clamp(LuminanceRec709(Context.SunIrradianceRgb) * 0.075f, 0.08f, 1.0f);
            Vec3        BedAmbient    = Vec3{0.18f, 0.24f, 0.34f} * SolarSkyScale;
            if (Context.CelestialSky != nullptr)
            {
                BedAmbient = BedAmbient + Context.CelestialSky->EvaluateNocturnalDirectIrradiance(
                    WaterN, Normalise(Context.SunDirectionUnit), Context.SunIrradianceRgb) * 0.55f;
            }
            const Vec3 FullBedRad = BodyRadiance + Vec3{
                BodyAlbedo.X * BedAmbient.X,
                BodyAlbedo.Y * BedAmbient.Y,
                BodyAlbedo.Z * BedAmbient.Z};

            AccumRadiance = AccumRadiance + Vec3{
                Throughput.X * FullBedRad.X * (1.0f - Fresnel),
                Throughput.Y * FullBedRad.Y * (1.0f - Fresnel),
                Throughput.Z * FullBedRad.Z * (1.0f - Fresnel)};

            CurrDir    = Normalise(CurrDir - WaterN * (2.0f * Dot(CurrDir, WaterN)));
            CurrOrigin = WaterHitPt + WaterN * 0.015f;
            Throughput = Throughput * (Fresnel * (1.0f - 0.55f * MudC));
            continue;
        }

        // Case D: Closed-Dielectric Glass Refraction + Exact Fresnel Split (SolidDielectricTransport.slang parity)!
        if (SolidHit.TransmissiveGlass)
        {
            Out.HitDielectricGlass = true;
            const bool  Entering   = (Dot(CurrDir, SolidHit.GeometricOutward) < 0.0f);
            const Vec3  FaceN      = Entering ? SolidHit.GeometricOutward : -SolidHit.GeometricOutward;
            const float EtaI       = Entering ? 1.0f : SolidHit.RefractiveIndexIor;
            const float EtaT       = Entering ? SolidHit.RefractiveIndexIor : 1.0f;
            const float CosI       = std::clamp(-Dot(CurrDir, FaceN), 0.0f, 1.0f);
            const float FresnelR   = ExactDielectricFresnel(CosI, EtaI, EtaT);

            // Evaluate clean BVH reflection lobe at entry interface so glass catches crisp sky/star/luminaire glints!
            if (Entering && FresnelR > 0.01f)
            {
                const Vec3 ReflDir = Normalise(CurrDir - FaceN * (2.0f * Dot(CurrDir, FaceN)));
                const Vec3 ReflOrg = SolidHit.Position + FaceN * 0.008f;
                const InternalSurfaceHit ReflHit = TraceTriangleBvh(ReflOrg, ReflDir, 120.0f, true);
                ++Out.BvhTriangleReflectionRays;
                Vec3 ReflRad{};
                if (ReflHit.Hit)
                {
                    ReflRad = ReflHit.EmissiveRgb +
                              EvaluateDirectSurfaceLighting(
                                  Tier,
                                  ReflHit.Position,
                                  ReflHit.Normal,
                                  -ReflDir,
                                  ReflHit.AlbedoRgb,
                                  ReflHit.Roughness,
                                  ReflHit.Metallic,
                                  Context);
                }
                else
                {
                    ReflRad = EvaluateVolumetricSegmentAndSky(
                        ReflOrg,
                        ReflDir,
                        120.0f,
                        true,
                        Context,
                        Out.PlumeOpticalOpacity,
                        Out.CloudReflectionLuminance,
                        Out.CelestialLuminance);
                }
                AccumRadiance = AccumRadiance + Vec3{
                    Throughput.X * FresnelR * ReflRad.X,
                    Throughput.Y * FresnelR * ReflRad.Y,
                    Throughput.Z * FresnelR * ReflRad.Z};
            }

            // Beer-Lambert internal absorption when exiting the interior of closed dielectric glass!
            if (!Entering)
            {
                Throughput = Vec3{
                    Throughput.X * std::exp(-SolidHit.SpectralAbsorption.X * BestDistance),
                    Throughput.Y * std::exp(-SolidHit.SpectralAbsorption.Y * BestDistance),
                    Throughput.Z * std::exp(-SolidHit.SpectralAbsorption.Z * BestDistance)};
            }

            Vec3 RefractedDir{};
            if (RefractSnell(CurrDir, FaceN, EtaI / EtaT, RefractedDir))
            {
                CurrOrigin = SolidHit.Position - FaceN * 0.006f;
                CurrDir    = RefractedDir;
                Throughput = Vec3{
                    Throughput.X * (1.0f - (Entering ? FresnelR : 0.0f)) * SolidHit.AlbedoRgb.X,
                    Throughput.Y * (1.0f - (Entering ? FresnelR : 0.0f)) * SolidHit.AlbedoRgb.Y,
                    Throughput.Z * (1.0f - (Entering ? FresnelR : 0.0f)) * SolidHit.AlbedoRgb.Z};
                continue;
            }
            // Total internal reflection fallback!
            CurrOrigin = SolidHit.Position + FaceN * 0.006f;
            CurrDir    = Normalise(CurrDir - FaceN * (2.0f * Dot(CurrDir, FaceN)));
            continue;
        }

        // Case E: Opaque / Glossy / Metallic Solid Triangle Hit!
        Out.HitSolidGeometry = true;
        const Vec3 DirectRad = EvaluateDirectSurfaceLighting(
            Tier,
            SolidHit.Position,
            SolidHit.Normal,
            -CurrDir,
            SolidHit.AlbedoRgb,
            SolidHit.Roughness,
            SolidHit.Metallic,
            Context,
            SolidHit.SnowSubsurfaceScatter);

        const DualTierGiReservoir GiRes = SampleRestirIndirectReservoir(
            Tier,
            SolidHit.Position,
            SolidHit.Normal,
            Context,
            PixelRandomSeed ^ (Bounce * 0x9E3779B97F4A7C15ull));
        Out.SdfGiRays += GiRes.SdfGiQueries;
        Out.RtxTriangleGiRays += GiRes.RtxGiQueries;

        const Vec3 IndirectIrr = GiRes.SampleRadianceRgb * std::min(4.0f, GiRes.IntegrationWeightW);
        const Vec3 DiffScale   = SolidHit.AlbedoRgb * (1.0f - std::clamp(SolidHit.Metallic, 0.0f, 1.0f)) * (1.0f / PiFloat);
        const Vec3 IndirectRad{
            DiffScale.X * IndirectIrr.X,
            DiffScale.Y * IndirectIrr.Y,
            DiffScale.Z * IndirectIrr.Z};

        // Glossy / Metallic Specular Reflection via Triangle BVH on BOTH GTX and RTX!
        Vec3 GlossyRefl{0.0f, 0.0f, 0.0f};
        if ((SolidHit.Roughness < 0.48f || SolidHit.Metallic > 0.05f) && Bounce + 1u < MaxBounces)
        {
            SplitMix64Restir SpecRng{PixelRandomSeed ^ 0x517CC1B727220A95ull};
            const Vec3       HalfVec = (SolidHit.Roughness < 0.06f)
                                           ? SolidHit.Normal
                                           : SampleGgxHalfVector(
                                                 SolidHit.Normal,
                                                 SolidHit.Roughness,
                                                 SpecRng.NextZeroToOne(),
                                                 SpecRng.NextZeroToOne());
            Vec3 ReflDir = Normalise(CurrDir - HalfVec * (2.0f * Dot(CurrDir, HalfVec)));
            if (Dot(ReflDir, SolidHit.Normal) > 0.02f)
            {
                const Vec3 F0{
                    0.04f * (1.0f - SolidHit.Metallic) + SolidHit.AlbedoRgb.X * SolidHit.Metallic,
                    0.04f * (1.0f - SolidHit.Metallic) + SolidHit.AlbedoRgb.Y * SolidHit.Metallic,
                    0.04f * (1.0f - SolidHit.Metallic) + SolidHit.AlbedoRgb.Z * SolidHit.Metallic};
                const Vec3 SpecEnvWeight = EnvBrdfSplitSumApprox(
                    F0,
                    SolidHit.Roughness,
                    std::clamp(Dot(-CurrDir, SolidHit.Normal), 0.0f, 1.0f));
                const Vec3 ReflOrg = SolidHit.Position + SolidHit.Normal * 0.015f;
                const InternalSurfaceHit RHit = TraceTriangleBvh(ReflOrg, ReflDir, 120.0f, false);
                ++Out.BvhTriangleReflectionRays;
                Vec3 IncomingSpec{};
                if (RHit.Hit)
                {
                    const float RPlumeT = (Context.PlumeFluid != nullptr)
                                              ? Context.PlumeFluid->EvaluateShadowTransmittance(
                                                    ToArr3(ReflOrg),
                                                    ToArr3(ReflDir),
                                                    std::min(RHit.DistanceM, 60.0f))
                                              : 1.0f;
                    const Vec3 RMedia = EvaluateVolumetricSegmentAndSky(
                        ReflOrg,
                        ReflDir,
                        RHit.DistanceM,
                        false,
                        Context,
                        Out.PlumeOpticalOpacity,
                        Out.CloudReflectionLuminance,
                        Out.CelestialLuminance);
                    const Vec3 RSurf = RHit.EmissiveRgb +
                                       EvaluateDirectSurfaceLighting(
                                           Tier,
                                           RHit.Position,
                                           RHit.Normal,
                                           -ReflDir,
                                           RHit.AlbedoRgb,
                                           RHit.Roughness,
                                           RHit.Metallic,
                                           Context);
                    IncomingSpec = RMedia + RSurf * RPlumeT;
                }
                else
                {
                    IncomingSpec = EvaluateVolumetricSegmentAndSky(
                        ReflOrg,
                        ReflDir,
                        120.0f,
                        true,
                        Context,
                        Out.PlumeOpticalOpacity,
                        Out.CloudReflectionLuminance,
                        Out.CelestialLuminance);
                }
                GlossyRefl = Vec3{
                    SpecEnvWeight.X * IncomingSpec.X,
                    SpecEnvWeight.Y * IncomingSpec.Y,
                    SpecEnvWeight.Z * IncomingSpec.Z};
            }
        }

        const Vec3 TotalSurface = SolidHit.EmissiveRgb + DirectRad + IndirectRad + GlossyRefl;
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
         PRODUCTION VIEWPORT RENDERER: SPATIAL REUSE + 3-STEP A-TROUS DENOISER + HDR BLOOM + AGX/ACES TONEMAP
------------------------------------------------------------------------------------------------------------------------------------------*/
void SceneRenderer::RenderViewportRgba8(
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

    const size_t PixelCount = static_cast<size_t>(Width) * Height;
    const Vec3   Forward    = Normalise(CameraTargetWorld - CameraOriginWorld);
    const Vec3   Right      = Normalise(Cross(Forward, Vec3{0.0f, 0.0f, 1.0f}));
    const Vec3   Up         = Cross(Right, Forward);
    const float  TanHalf    = std::tan(0.5f * VerticalFovRadians);
    const float  Aspect     = static_cast<float>(Width) / static_cast<float>(Height);

    struct PixelFrameSample
    {
        bool                ValidSurface  = false;
        bool                FilterGlossy  = false;
        uint32_t            ApertureTag   = 0u; // 0 = primary, 100+P = portal, 200+M = mirror, 300 = glass
        Vec3                Position{};
        Vec3                Normal{};
        Vec3                AlbedoRgb{};
        Vec3                DirectHdr{};
        float               ContactAo     = 1.0f;
        float               LinearDepth   = 1.0e6f;
        Vec3                DiffuseScale{};  // Throughput * Albedo * (1 - Metallic) / pi * ContactAo
        Vec3                GlossyScale{};   // Throughput * SpecWeight (when Roughness >= 0.045)
        Vec3                RawGlossyRad{};  // Unfiltered stochastic GGX reflection radiance
        Vec3                BaseHdr{};       // Throughput * (Media + Emissive + Direct + SharpMirrorSpec)
        DualTierGiReservoir Reservoir{};
    };

    std::vector<PixelFrameSample> Samples(PixelCount);

    // 1. Primary + Portal/Mirror/Glass Hop Unrolling + Reservoir Generation (denoises primary, portal, mirror & glass views)!
    auto RenderRow = [&](uint32_t Py)
    {
        const float NdcY = 1.0f - 2.0f * (static_cast<float>(Py) + 0.5f) / static_cast<float>(Height);
        for (uint32_t Px = 0u; Px < Width; ++Px)
        {
            const size_t   PIdx = static_cast<size_t>(Py) * Width + Px;
            const float    NdcX = (2.0f * (static_cast<float>(Px) + 0.5f) / static_cast<float>(Width) - 1.0f) * Aspect;
            const Vec3     Dir  = Normalise(Forward + Right * (NdcX * TanHalf) + Up * (NdcY * TanHalf));
            const uint64_t Seed = (static_cast<uint64_t>(Py) * 4099ull + Px + 17ull) * 0x9E3779B97F4A7C15ull;

            // Unroll up to 4 planar-mirror / seamless-portal / closed-glass hops so surfaces seen inside portals,
            // mirrors, AND refractive glass receive full Screen-Space ReSTIR Spatial Reuse + 3-Step A-Trous Denoising!
            Vec3               HopOrigin      = CameraOriginWorld;
            Vec3               HopDir         = Dir;
            Vec3               HopThroughput{1.0f, 1.0f, 1.0f};
            Vec3               HopAccumMedia{0.0f, 0.0f, 0.0f};
            float              CumulativeDist = 0.0f;
            uint32_t           ApertureTag    = 0u;
            bool               HandledSpecial = false;
            bool               InsideGlass    = false;
            InternalSurfaceHit TerminalHit{};

            for (uint32_t Hop = 0u; Hop < 4u; ++Hop)
            {
                float BestDist = 1.0e6f;
                TerminalHit    = TraceTriangleBvh(HopOrigin, HopDir, BestDist, false);
                if (TerminalHit.Hit)
                {
                    BestDist = TerminalHit.DistanceM;
                }

                int   HitMirror = -1;
                float MU = 0.0f, MV = 0.0f;
                for (size_t M = 0u; M < Mirrors_.size(); ++M)
                {
                    float T = 0.0f, U = 0.0f, V = 0.0f;
                    if (IntersectBoundedRectangleAperture(
                            HopOrigin,
                            HopDir,
                            Mirrors_[M].CentreWorld,
                            Mirrors_[M].RightAxis,
                            Mirrors_[M].UpAxis,
                            Mirrors_[M].FrontNormal,
                            Mirrors_[M].HalfWidthMetres,
                            Mirrors_[M].HalfHeightMetres,
                            BestDist,
                            T,
                            U,
                            V))
                    {
                        BestDist  = T;
                        HitMirror = static_cast<int>(M);
                        MU        = U;
                        MV        = V;
                    }
                }

                int   HitPortal = -1;
                float PU = 0.0f, PV = 0.0f;
                for (size_t P = 0u; P < Portals_.size(); ++P)
                {
                    float T = 0.0f, U = 0.0f, V = 0.0f;
                    if (IntersectPortalAperture(
                            HopOrigin,
                            HopDir,
                            Portals_[P],
                            BestDist,
                            T,
                            U,
                            V))
                    {
                        BestDist  = T;
                        HitPortal = static_cast<int>(P);
                        HitMirror = -1;
                        PU        = U;
                        PV        = V;
                    }
                }

                bool               HitWaterFirst = false;
                float              WaterDist     = BestDist;
                Vec3               UnusedWaterPt{};
                SurfaceFluidSample UnusedWaterSamp{};
                if (IntersectShallowWaterSurface(HopOrigin, HopDir, BestDist, Context, WaterDist, UnusedWaterPt, UnusedWaterSamp))
                {
                    HitWaterFirst = true;
                }

                if (HitWaterFirst || (BestDist >= 9.9e5f))
                {
                    HandledSpecial = true;
                    break;
                }

                // Unroll Closed-Dielectric Glass Refraction (Entry & Exit) so refracted interior objects get full GI denoising!
                if (TerminalHit.Hit && TerminalHit.TransmissiveGlass && HitPortal < 0 && HitMirror < 0)
                {
                    if (!InsideGlass)
                    {
                        float UnusedP = 0.0f, UnusedC = 0.0f, UnusedCel = 0.0f;
                        const Vec3 SegMedia = EvaluateVolumetricSegmentAndSky(
                            HopOrigin, HopDir, BestDist, false, Context, UnusedP, UnusedC, UnusedCel);
                        HopAccumMedia = HopAccumMedia + Vec3{
                            HopThroughput.X * SegMedia.X,
                            HopThroughput.Y * SegMedia.Y,
                            HopThroughput.Z * SegMedia.Z};
                        const float SegFogT = static_cast<float>(
                            FogTransmittance(Context.Fog, ToSpatial(HopOrigin), ToSpatial(HopDir), static_cast<double>(BestDist)));
                        const float SegPlumeT = (Context.PlumeFluid != nullptr)
                                                    ? Context.PlumeFluid->EvaluateShadowTransmittance(
                                                          ToArr3(HopOrigin), ToArr3(HopDir), std::min(BestDist, 80.0f))
                                                    : 1.0f;
                        HopThroughput = HopThroughput * (SegFogT * SegPlumeT);
                    }
                    else
                    {
                        HopThroughput = Vec3{
                            HopThroughput.X * std::exp(-TerminalHit.SpectralAbsorption.X * BestDist),
                            HopThroughput.Y * std::exp(-TerminalHit.SpectralAbsorption.Y * BestDist),
                            HopThroughput.Z * std::exp(-TerminalHit.SpectralAbsorption.Z * BestDist)};
                    }
                    CumulativeDist += BestDist;

                    const bool  Entering = (Dot(HopDir, TerminalHit.GeometricOutward) < 0.0f);
                    const Vec3  FaceN    = Entering ? TerminalHit.GeometricOutward : -TerminalHit.GeometricOutward;
                    const float EtaI     = Entering ? 1.0f : TerminalHit.RefractiveIndexIor;
                    const float EtaT     = Entering ? TerminalHit.RefractiveIndexIor : 1.0f;
                    const float CosI     = std::clamp(-Dot(HopDir, FaceN), 0.0f, 1.0f);
                    const float FresnelR = ExactDielectricFresnel(CosI, EtaI, EtaT);

                    if (Entering && FresnelR > 0.01f)
                    {
                        const Vec3 ReflDir = Normalise(HopDir - FaceN * (2.0f * Dot(HopDir, FaceN)));
                        const Vec3 ReflOrg = TerminalHit.Position + FaceN * 0.008f;
                        const InternalSurfaceHit ReflHit = TraceTriangleBvh(ReflOrg, ReflDir, 120.0f, true);
                        Vec3 ReflRad{};
                        if (ReflHit.Hit)
                        {
                            ReflRad = ReflHit.EmissiveRgb +
                                      EvaluateDirectSurfaceLighting(
                                          Tier,
                                          ReflHit.Position,
                                          ReflHit.Normal,
                                          -ReflDir,
                                          ReflHit.AlbedoRgb,
                                          ReflHit.Roughness,
                                          ReflHit.Metallic,
                                          Context);
                        }
                        else
                        {
                            float UnusedP = 0.0f, UnusedC = 0.0f, UnusedCel = 0.0f;
                            ReflRad = EvaluateVolumetricSegmentAndSky(
                                ReflOrg, ReflDir, 120.0f, true, Context, UnusedP, UnusedC, UnusedCel);
                        }
                        HopAccumMedia = HopAccumMedia + Vec3{
                            HopThroughput.X * FresnelR * ReflRad.X,
                            HopThroughput.Y * FresnelR * ReflRad.Y,
                            HopThroughput.Z * FresnelR * ReflRad.Z};
                    }

                    Vec3 RefractedDir{};
                    if (RefractSnell(HopDir, FaceN, EtaI / EtaT, RefractedDir))
                    {
                        HopOrigin     = TerminalHit.Position - FaceN * 0.006f;
                        HopDir        = RefractedDir;
                        InsideGlass   = Entering;
                        HopThroughput = Vec3{
                            HopThroughput.X * (1.0f - (Entering ? FresnelR : 0.0f)) * TerminalHit.AlbedoRgb.X,
                            HopThroughput.Y * (1.0f - (Entering ? FresnelR : 0.0f)) * TerminalHit.AlbedoRgb.Y,
                            HopThroughput.Z * (1.0f - (Entering ? FresnelR : 0.0f)) * TerminalHit.AlbedoRgb.Z};
                        ApertureTag = ApertureTag * 31u + (Entering ? 301u : 302u);
                        continue;
                    }
                    HandledSpecial = true;
                    break;
                }

                if (HitPortal >= 0 || HitMirror >= 0)
                {
                    float UnusedP = 0.0f, UnusedC = 0.0f, UnusedCel = 0.0f;
                    const Vec3 SegMedia = EvaluateVolumetricSegmentAndSky(
                        HopOrigin, HopDir, BestDist, false, Context, UnusedP, UnusedC, UnusedCel);
                    HopAccumMedia = HopAccumMedia + Vec3{
                        HopThroughput.X * SegMedia.X,
                        HopThroughput.Y * SegMedia.Y,
                        HopThroughput.Z * SegMedia.Z};

                    const float SegFogT = static_cast<float>(
                        FogTransmittance(Context.Fog, ToSpatial(HopOrigin), ToSpatial(HopDir), static_cast<double>(BestDist)));
                    const float SegPlumeT = (Context.PlumeFluid != nullptr)
                                                ? Context.PlumeFluid->EvaluateShadowTransmittance(
                                                      ToArr3(HopOrigin), ToArr3(HopDir), std::min(BestDist, 80.0f))
                                                : 1.0f;
                    HopThroughput = HopThroughput * (SegFogT * SegPlumeT);
                    CumulativeDist += BestDist;

                    if (HitPortal >= 0)
                    {
                        const auto& Portal  = Portals_[static_cast<size_t>(HitPortal)];
                        const float EdgeGap = PortalApertureEdgeGap(Portal, PU, PV);
                        if (EdgeGap < 0.055f)
                        {
                            HandledSpecial = true;
                            break;
                        }
                        const Vec3 HitPt = HopOrigin + HopDir * BestDist;
                        TransformRayAcrossPortal(Portal, HitPt, HopDir, HopOrigin, HopDir);
                        ApertureTag = ApertureTag * 31u + 100u + static_cast<uint32_t>(HitPortal);
                        continue;
                    }

                    const auto& Mirror  = Mirrors_[static_cast<size_t>(HitMirror)];
                    const float EdgeGap = std::min(Mirror.HalfWidthMetres - std::abs(MU), Mirror.HalfHeightMetres - std::abs(MV));
                    if (EdgeGap < 0.05f)
                    {
                        HandledSpecial = true;
                        break;
                    }
                    const Vec3 HitPt = HopOrigin + HopDir * BestDist;
                    HopDir           = Normalise(HopDir - Mirror.FrontNormal * (2.0f * Dot(HopDir, Mirror.FrontNormal)));
                    HopOrigin        = HitPt + Mirror.FrontNormal * 0.015f;
                    HopThroughput    = Vec3{
                        HopThroughput.X * Mirror.ReflectanceTint.X,
                        HopThroughput.Y * Mirror.ReflectanceTint.Y,
                        HopThroughput.Z * Mirror.ReflectanceTint.Z};
                    ApertureTag = ApertureTag * 31u + 200u + static_cast<uint32_t>(HitMirror);
                    continue;
                }

                // Landed on an opaque/glossy triangle (either directly, through a Portal, or inside a Mirror)!
                break;
            }

            if (!HandledSpecial && TerminalHit.Hit && !TerminalHit.TransmissiveGlass)
            {
                float SegPlumeOp = 0.0f, UnusedC = 0.0f, UnusedCel = 0.0f;
                const Vec3 SegMedia = EvaluateVolumetricSegmentAndSky(
                    HopOrigin, HopDir, TerminalHit.DistanceM, false, Context, SegPlumeOp, UnusedC, UnusedCel);
                const float SegFogT = static_cast<float>(
                    FogTransmittance(Context.Fog, ToSpatial(HopOrigin), ToSpatial(HopDir), static_cast<double>(TerminalHit.DistanceM)));
                const float SegPlumeT = (Context.PlumeFluid != nullptr)
                                            ? std::clamp(1.0f - SegPlumeOp, 0.0f, 1.0f)
                                            : 1.0f;
                const Vec3 TotalTrans = HopThroughput * (SegFogT * SegPlumeT);

                const Vec3 DirectRad = EvaluateDirectSurfaceLighting(
                    Tier,
                    TerminalHit.Position,
                    TerminalHit.Normal,
                    -HopDir,
                    TerminalHit.AlbedoRgb,
                    TerminalHit.Roughness,
                    TerminalHit.Metallic,
                    Context,
                    TerminalHit.SnowSubsurfaceScatter);

                Vec3 GlossyRefl{0.0f, 0.0f, 0.0f};
                if (TerminalHit.Roughness < 0.50f || TerminalHit.Metallic > 0.05f)
                {
                    const Vec3 F0{
                        0.04f * (1.0f - TerminalHit.Metallic) + TerminalHit.AlbedoRgb.X * TerminalHit.Metallic,
                        0.04f * (1.0f - TerminalHit.Metallic) + TerminalHit.AlbedoRgb.Y * TerminalHit.Metallic,
                        0.04f * (1.0f - TerminalHit.Metallic) + TerminalHit.AlbedoRgb.Z * TerminalHit.Metallic};
                    const Vec3 SpecWeight = EnvBrdfSplitSumApprox(
                        F0, TerminalHit.Roughness, std::clamp(Dot(-HopDir, TerminalHit.Normal), 0.0f, 1.0f));

                    const uint32_t   SpecRays = (TerminalHit.Roughness > 0.04f) ? 4u : 1u;
                    SplitMix64Restir SpecRng{Seed ^ 0xA5A5F0F012345678ull};
                    Vec3             ReflSum{0.0f, 0.0f, 0.0f};
                    for (uint32_t Sr = 0u; Sr < SpecRays; ++Sr)
                    {
                        const float U1 = (static_cast<float>(Sr & 1u) + SpecRng.NextZeroToOne()) * 0.5f;
                        const float U2 = (static_cast<float>((Sr >> 1u) & 1u) + SpecRng.NextZeroToOne()) * 0.5f;
                        const Vec3  HVec = (TerminalHit.Roughness < 0.045f)
                                               ? TerminalHit.Normal
                                               : SampleGgxHalfVector(TerminalHit.Normal, TerminalHit.Roughness, U1, U2);
                        const Vec3 RDir = Normalise(HopDir - HVec * (2.0f * Dot(HopDir, HVec)));
                        if (Dot(RDir, TerminalHit.Normal) > 0.02f)
                        {
                            CoupledWorldOpticalContext ReflCtx = Context;
                            ReflCtx.RestirCandidateK           = 2u;
                            ReflCtx.MaxApertureBounces         = 2u;
                            if (TerminalHit.Roughness > 0.08f)
                            {
                                // Rough surfaces already integrate spark irradiance analytically in EvaluateDirectSurfaceLighting;
                                // skipping sub-millimetre spark/precipitation capsules on stochastic rough rays prevents 1-px fireflies!
                                ReflCtx.Sparks = nullptr;
                            }
                            if (TerminalHit.Roughness > 0.14f)
                            {
                                ReflCtx.Precipitation = nullptr;
                            }
                            const TracedRayDiagnostics RDiag = TraceCoupledRadianceRay(
                                Tier,
                                TerminalHit.Position + TerminalHit.Normal * 0.015f,
                                RDir,
                                ReflCtx,
                                Seed ^ (Sr * 0x9E3779B9ull));
                            ReflSum = ReflSum + ClampRadianceFirefly(RDiag.FinalRadianceRgb, 24.0f);
                        }
                    }
                    ReflSum = ReflSum * (1.0f / static_cast<float>(SpecRays));
                    if (TerminalHit.Roughness >= 0.045f)
                    {
                        Samples[PIdx].FilterGlossy = true;
                        Samples[PIdx].GlossyScale  = Vec3{
                            TotalTrans.X * SpecWeight.X,
                            TotalTrans.Y * SpecWeight.Y,
                            TotalTrans.Z * SpecWeight.Z};
                        Samples[PIdx].RawGlossyRad = ReflSum;
                    }
                    else
                    {
                        GlossyRefl = Vec3{SpecWeight.X * ReflSum.X, SpecWeight.Y * ReflSum.Y, SpecWeight.Z * ReflSum.Z};
                    }
                }

                // Short-range 2-tap IGN-rotated hemisphere Contact Ambient Occlusion (anchors tyres, chassis & block creases!)
                const Vec3  AoRefUp = (std::abs(TerminalHit.Normal.Z) < 0.92f) ? Vec3{0.0f, 0.0f, 1.0f} : Vec3{1.0f, 0.0f, 0.0f};
                const Vec3  AoTanU  = Normalise(Cross(AoRefUp, TerminalHit.Normal));
                const Vec3  AoTanV  = Cross(TerminalHit.Normal, AoTanU);
                const Vec3  AoOrg   = TerminalHit.Position + TerminalHit.Normal * 0.02f;
                const float AoAng   = static_cast<float>((Seed >> 17u) & 0xFFFFu) * (6.2831853f / 65536.0f);
                const Vec3  AoPlanar = AoTanU * (std::cos(AoAng) * 0.69f) + AoTanV * (std::sin(AoAng) * 0.69f);
                const InternalSurfaceHit AoH0 = TraceTriangleBvh(AoOrg, Normalise(TerminalHit.Normal * 0.72f + AoPlanar), 1.45f, true);
                const InternalSurfaceHit AoH1 = TraceTriangleBvh(AoOrg, Normalise(TerminalHit.Normal * 0.72f - AoPlanar), 1.45f, true);
                const float Ao0 = AoH0.Hit ? std::clamp(AoH0.DistanceM / 1.45f, 0.12f, 1.0f) : 1.0f;
                const float Ao1 = AoH1.Hit ? std::clamp(AoH1.DistanceM / 1.45f, 0.12f, 1.0f) : 1.0f;
                const float ContactAo = std::clamp(0.22f + 0.78f * (0.5f * (Ao0 + Ao1)), 0.28f, 1.0f);

                const Vec3 SurfHdr        = TerminalHit.EmissiveRgb + DirectRad + GlossyRefl;
                Samples[PIdx].ValidSurface = true;
                Samples[PIdx].ApertureTag  = ApertureTag;
                Samples[PIdx].Position     = TerminalHit.Position;
                Samples[PIdx].Normal       = TerminalHit.Normal;
                Samples[PIdx].AlbedoRgb    = TerminalHit.AlbedoRgb;
                Samples[PIdx].DirectHdr    = Vec3{TotalTrans.X * DirectRad.X, TotalTrans.Y * DirectRad.Y, TotalTrans.Z * DirectRad.Z};
                Samples[PIdx].ContactAo    = ContactAo;
                Samples[PIdx].LinearDepth  = CumulativeDist + TerminalHit.DistanceM;
                Samples[PIdx].DiffuseScale = Vec3{
                    TotalTrans.X * TerminalHit.AlbedoRgb.X,
                    TotalTrans.Y * TerminalHit.AlbedoRgb.Y,
                    TotalTrans.Z * TerminalHit.AlbedoRgb.Z} *
                    ((1.0f - std::clamp(TerminalHit.Metallic, 0.0f, 1.0f)) * ContactAo * (1.0f / PiFloat));
                Samples[PIdx].BaseHdr = HopAccumMedia +
                                        Vec3{HopThroughput.X * SegMedia.X, HopThroughput.Y * SegMedia.Y, HopThroughput.Z * SegMedia.Z} +
                                        Vec3{TotalTrans.X * SurfHdr.X, TotalTrans.Y * SurfHdr.Y, TotalTrans.Z * SurfHdr.Z};
                Samples[PIdx].Reservoir = SampleRestirIndirectReservoir(Tier, TerminalHit.Position, TerminalHit.Normal, Context, Seed);
            }
            else if (ApertureTag != 0u && !TerminalHit.Hit)
            {
                // Refracted / Reflected / Portal ray escaped into sky/stars after unrolled aperture hops!
                float UnusedP = 0.0f, UnusedC = 0.0f, UnusedCel = 0.0f;
                const Vec3 SkySeg = EvaluateVolumetricSegmentAndSky(
                    HopOrigin, HopDir, 120.0f, true, Context, UnusedP, UnusedC, UnusedCel);
                Samples[PIdx].ValidSurface = false;
                Samples[PIdx].BaseHdr      = HopAccumMedia + Vec3{
                    HopThroughput.X * SkySeg.X,
                    HopThroughput.Y * SkySeg.Y,
                    HopThroughput.Z * SkySeg.Z};
            }
            else
            {
                // Sky, Portal/Mirror Bezel, Closed-Dielectric Glass, or 2.5D Puddle Water: 4x RGSS subpixel AA trace!
                constexpr float JitterX[4] = {-0.375f, +0.125f, -0.125f, +0.375f};
                constexpr float JitterY[4] = {-0.125f, -0.375f, +0.375f, +0.125f};
                Vec3            AaSum{0.0f, 0.0f, 0.0f};
                for (uint32_t Sub = 0u; Sub < 4u; ++Sub)
                {
                    const float SubY = 1.0f - 2.0f * (static_cast<float>(Py) + 0.5f + JitterY[Sub]) / static_cast<float>(Height);
                    const float SubX = (2.0f * (static_cast<float>(Px) + 0.5f + JitterX[Sub]) / static_cast<float>(Width) - 1.0f) * Aspect;
                    const Vec3  SDir = Normalise(Forward + Right * (SubX * TanHalf) + Up * (SubY * TanHalf));
                    const TracedRayDiagnostics Diag = TraceCoupledRadianceRay(
                        Tier, CameraOriginWorld, SDir, Context, Seed ^ (Sub * 0xD1B54A32D192ED03ull));
                    AaSum = AaSum + Diag.FinalRadianceRgb;
                }
                Samples[PIdx].ValidSurface = false;
                Samples[PIdx].BaseHdr      = AaSum * 0.25f;
            }
        }
    };

    const uint32_t WorkerCount = (Height >= 32u)
        ? std::clamp(std::thread::hardware_concurrency(), 1u, 12u)
        : 1u;
    if (WorkerCount <= 1u)
    {
        for (uint32_t Py = 0u; Py < Height; ++Py)
        {
            RenderRow(Py);
        }
    }
    else
    {
        std::vector<std::thread> Workers;
        Workers.reserve(WorkerCount);
        for (uint32_t W = 0u; W < WorkerCount; ++W)
        {
            Workers.emplace_back([&, W, WorkerCount]() {
                for (uint32_t Py = W; Py < Height; Py += WorkerCount)
                {
                    RenderRow(Py);
                }
            });
        }
        for (std::thread& Th : Workers)
        {
            Th.join();
        }
    }

    // 2. Screen-Space ReSTIR Spatial Reservoir Reuse (respecting ApertureTag so portals/mirrors stay crisp)!
    std::vector<Vec3> DemodulatedGi(PixelCount, Vec3{0.0f, 0.0f, 0.0f});
    constexpr int     ReuseOffsets[6][2] = {{-5, -3}, {5, -4}, {-7, 4}, {6, 5}, {-2, -8}, {3, 8}};

    for (uint32_t Py = 0u; Py < Height; ++Py)
    {
        for (uint32_t Px = 0u; Px < Width; ++Px)
        {
            const size_t PIdx = static_cast<size_t>(Py) * Width + Px;
            if (!Samples[PIdx].ValidSurface)
            {
                continue;
            }
            DualTierGiReservoir Combined = Samples[PIdx].Reservoir;
            if (Context.EnableSpatialReuse)
            {
                const int Rot = static_cast<int>((Px * 7u + Py * 13u) & 3u);
                for (int K = 0; K < 6; ++K)
                {
                    const int Ox = (Rot & 1) ? -ReuseOffsets[K][1] : ReuseOffsets[K][0];
                    const int Oy = (Rot & 2) ? -ReuseOffsets[K][0] : ReuseOffsets[K][1];
                    const int Nx = static_cast<int>(Px) + Ox;
                    const int Ny = static_cast<int>(Py) + Oy;
                    if (Nx >= 0 && Nx < static_cast<int>(Width) && Ny >= 0 && Ny < static_cast<int>(Height))
                    {
                        const size_t NIdx = static_cast<size_t>(Ny) * Width + static_cast<size_t>(Nx);
                        if (Samples[NIdx].ValidSurface &&
                            Samples[NIdx].ApertureTag == Samples[PIdx].ApertureTag &&
                            Dot(Samples[PIdx].Normal, Samples[NIdx].Normal) >= 0.88f &&
                            std::abs(Samples[PIdx].LinearDepth - Samples[NIdx].LinearDepth) <= 0.12f * Samples[PIdx].LinearDepth)
                        {
                            Combined = MergeSpatialReservoirs(
                                Combined,
                                Samples[NIdx].Reservoir,
                                Samples[PIdx].Position,
                                Samples[PIdx].Normal,
                                (static_cast<uint64_t>(PIdx) * 31ull + static_cast<uint64_t>(K) + 1ull) * 0x9E3779B97F4A7C15ull);
                        }
                    }
                }
            }
            DemodulatedGi[PIdx] = Combined.SampleRadianceRgb * std::min(4.5f, Combined.IntegrationWeightW);
        }
    }

    // 3. 3-Step Edge-Stopping A-Trous B3-Spline Wavelet Denoiser (Step = 1, 2, 4) on Demodulated Indirect Irradiance!
    if (Context.EnableWaveletFilter)
    {
        constexpr float   Kernel1D[5] = {1.0f / 16.0f, 4.0f / 16.0f, 6.0f / 16.0f, 4.0f / 16.0f, 1.0f / 16.0f};
        std::vector<Vec3> Ping        = DemodulatedGi;
        std::vector<Vec3> Pong(PixelCount, Vec3{0.0f, 0.0f, 0.0f});

        for (int WaveletStride : {1, 2, 4})
        {
            for (uint32_t Py = 0u; Py < Height; ++Py)
            {
                for (uint32_t Px = 0u; Px < Width; ++Px)
                {
                    const size_t PIdx = static_cast<size_t>(Py) * Width + Px;
                    if (!Samples[PIdx].ValidSurface)
                    {
                        Pong[PIdx] = Ping[PIdx];
                        continue;
                    }
                    const Vec3     CenterGi    = Ping[PIdx];
                    const float    CenterLum   = LuminanceRec709(CenterGi);
                    const Vec3     CenterNrm   = Samples[PIdx].Normal;
                    const float    CenterDepth = Samples[PIdx].LinearDepth;
                    const uint32_t CenterTag   = Samples[PIdx].ApertureTag;

                    Vec3  Accum{0.0f, 0.0f, 0.0f};
                    float WeightSum = 0.0f;

                    for (int Ky = -2; Ky <= 2; ++Ky)
                    {
                        const int Ny = static_cast<int>(Py) + Ky * WaveletStride;
                        if (Ny < 0 || Ny >= static_cast<int>(Height))
                        {
                            continue;
                        }
                        for (int Kx = -2; Kx <= 2; ++Kx)
                        {
                            const int Nx = static_cast<int>(Px) + Kx * WaveletStride;
                            if (Nx < 0 || Nx >= static_cast<int>(Width))
                            {
                                continue;
                            }
                            const size_t NIdx = static_cast<size_t>(Ny) * Width + static_cast<size_t>(Nx);
                            if (!Samples[NIdx].ValidSurface || Samples[NIdx].ApertureTag != CenterTag)
                            {
                                continue;
                            }
                            const float KW      = Kernel1D[Kx + 2] * Kernel1D[Ky + 2];
                            const float NrmDot  = std::max(0.0f, Dot(CenterNrm, Samples[NIdx].Normal));
                            const float WNormal = std::pow(NrmDot, 32.0f);
                            const float WDepth  = std::exp(
                                -std::abs(CenterDepth - Samples[NIdx].LinearDepth) / std::max(0.05f, 0.08f * CenterDepth));
                            const float WLum = std::exp(
                                -std::abs(CenterLum - LuminanceRec709(Ping[NIdx])) / (1.8f + 0.65f * CenterLum));
                            const float W = KW * WNormal * WDepth * WLum;

                            Accum     = Accum + Ping[NIdx] * W;
                            WeightSum += W;
                        }
                    }
                    Pong[PIdx] = (WeightSum > 1.0e-5f) ? (Accum * (1.0f / WeightSum)) : CenterGi;
                }
            }
            Ping.swap(Pong);
        }
        DemodulatedGi.swap(Ping);
    }

    // 3b. 3-Step Edge-Stopping A-Trous Filter on Stochastic Glossy Reflections (eliminates floor/glossy reflection grain)!
    std::vector<Vec3> FilteredGlossy(PixelCount, Vec3{0.0f, 0.0f, 0.0f});
    for (size_t I = 0u; I < PixelCount; ++I)
    {
        if (Samples[I].FilterGlossy)
        {
            FilteredGlossy[I] = Samples[I].RawGlossyRad;
        }
    }
    if (Context.EnableWaveletFilter)
    {
        constexpr float   Kernel1D[5] = {1.0f / 16.0f, 4.0f / 16.0f, 6.0f / 16.0f, 4.0f / 16.0f, 1.0f / 16.0f};
        std::vector<Vec3> Ping        = FilteredGlossy;
        std::vector<Vec3> Pong(PixelCount, Vec3{0.0f, 0.0f, 0.0f});

        for (int WaveletStride : {1, 2, 4})
        {
            for (uint32_t Py = 0u; Py < Height; ++Py)
            {
                for (uint32_t Px = 0u; Px < Width; ++Px)
                {
                    const size_t PIdx = static_cast<size_t>(Py) * Width + Px;
                    if (!Samples[PIdx].FilterGlossy)
                    {
                        Pong[PIdx] = Ping[PIdx];
                        continue;
                    }
                    const Vec3     CenterSpec  = Ping[PIdx];
                    const float    CenterLum   = LuminanceRec709(CenterSpec);
                    const Vec3     CenterNrm   = Samples[PIdx].Normal;
                    const float    CenterDepth = Samples[PIdx].LinearDepth;
                    const uint32_t CenterTag   = Samples[PIdx].ApertureTag;

                    Vec3  Accum{0.0f, 0.0f, 0.0f};
                    float WeightSum = 0.0f;

                    for (int Ky = -2; Ky <= 2; ++Ky)
                    {
                        const int Ny = static_cast<int>(Py) + Ky * WaveletStride;
                        if (Ny < 0 || Ny >= static_cast<int>(Height))
                        {
                            continue;
                        }
                        for (int Kx = -2; Kx <= 2; ++Kx)
                        {
                            const int Nx = static_cast<int>(Px) + Kx * WaveletStride;
                            if (Nx < 0 || Nx >= static_cast<int>(Width))
                            {
                                continue;
                            }
                            const size_t NIdx = static_cast<size_t>(Ny) * Width + static_cast<size_t>(Nx);
                            if (!Samples[NIdx].FilterGlossy || Samples[NIdx].ApertureTag != CenterTag)
                            {
                                continue;
                            }
                            const float KW      = Kernel1D[Kx + 2] * Kernel1D[Ky + 2];
                            const float NrmDot  = std::max(0.0f, Dot(CenterNrm, Samples[NIdx].Normal));
                            const float WNormal = std::pow(NrmDot, 48.0f);
                            const float WDepth  = std::exp(
                                -std::abs(CenterDepth - Samples[NIdx].LinearDepth) / std::max(0.04f, 0.06f * CenterDepth));
                            const float WLum = std::exp(
                                -std::abs(CenterLum - LuminanceRec709(Ping[NIdx])) / (2.2f + 0.85f * CenterLum));
                            const float W = KW * WNormal * WDepth * WLum;

                            Accum     = Accum + Ping[NIdx] * W;
                            WeightSum += W;
                        }
                    }
                    Pong[PIdx] = (WeightSum > 1.0e-5f) ? (Accum * (1.0f / WeightSum)) : CenterSpec;
                }
            }
            Ping.swap(Pong);
        }
        FilteredGlossy.swap(Ping);
    }

    // 4. Recombine Albedo-Modulated Denoised GI + Filtered Glossy + Direct + Glass + Portals + Volumetrics into Linear HDR!
    if (Context.InspectionMode >= 4u && Context.InspectionMode <= 6u)
    {
        // Diagnostic non-tonemapped inspection modes: 4 = Global SDF, 5 = Normals, 6 = Albedo
        for (uint32_t Py = 0u; Py < Height; ++Py)
        {
            const float NdcY = 1.0f - 2.0f * (static_cast<float>(Py) + 0.5f) / static_cast<float>(Height);
            for (uint32_t Px = 0u; Px < Width; ++Px)
            {
                const size_t PIdx = static_cast<size_t>(Py) * Width + Px;
                Vec3         Vis{0.05f, 0.05f, 0.06f};
                if (Context.InspectionMode == 4u)
                {
                    const float NdcX = (2.0f * (static_cast<float>(Px) + 0.5f) / static_cast<float>(Width) - 1.0f) * Aspect;
                    const Vec3  Dir  = Normalise(Forward + Right * (NdcX * TanHalf) + Up * (NdcY * TanHalf));
                    const InternalSurfaceHit SdfHit = TraceSdfSurfaceCards(CameraOriginWorld, Dir, 140.0f);
                    if (SdfHit.Hit)
                    {
                        const float Band = 0.5f + 0.5f * std::sin(SdfHit.DistanceM * 3.14159265f * 1.5f);
                        const float Prox = std::exp(-SdfHit.DistanceM * 0.028f);
                        Vis = Vec3{
                            (0.25f + 0.55f * (0.5f + 0.5f * SdfHit.Normal.X)) * Prox + 0.14f * Band,
                            (0.32f + 0.52f * (0.5f + 0.5f * SdfHit.Normal.Y)) * Prox + 0.18f * Band,
                            (0.42f + 0.52f * (0.5f + 0.5f * SdfHit.Normal.Z)) * Prox + 0.22f * Band};
                    }
                }
                else if (Samples[PIdx].ValidSurface)
                {
                    if (Context.InspectionMode == 5u)
                    {
                        Vis = Vec3{
                            0.5f + 0.5f * Samples[PIdx].Normal.X,
                            0.5f + 0.5f * Samples[PIdx].Normal.Y,
                            0.5f + 0.5f * Samples[PIdx].Normal.Z};
                    }
                    else
                    {
                        Vis = Samples[PIdx].AlbedoRgb * Samples[PIdx].ContactAo;
                    }
                }
                auto ToByte = [](float C) -> uint8_t {
                    const float Clamped = std::clamp(C, 0.0f, 1.0f);
                    const float S = (Clamped <= 0.0031308f) ? (12.92f * Clamped) : (1.055f * std::pow(Clamped, 1.0f / 2.4f) - 0.055f);
                    return static_cast<uint8_t>(std::clamp(std::lround(S * 255.0f), 0L, 255L));
                };
                OutRgba8Pixels[PIdx * 4u + 0u] = ToByte(Vis.X);
                OutRgba8Pixels[PIdx * 4u + 1u] = ToByte(Vis.Y);
                OutRgba8Pixels[PIdx * 4u + 2u] = ToByte(Vis.Z);
                OutRgba8Pixels[PIdx * 4u + 3u] = 255u;
            }
        }
        return;
    }

    std::vector<Vec3> LinearHdr(PixelCount, Vec3{0.0f, 0.0f, 0.0f});
    for (size_t I = 0u; I < PixelCount; ++I)
    {
        if (Samples[I].ValidSurface)
        {
            const Vec3 GiTerm{
                Samples[I].DiffuseScale.X * DemodulatedGi[I].X,
                Samples[I].DiffuseScale.Y * DemodulatedGi[I].Y,
                Samples[I].DiffuseScale.Z * DemodulatedGi[I].Z};
            const Vec3 SpecTerm{
                Samples[I].GlossyScale.X * FilteredGlossy[I].X,
                Samples[I].GlossyScale.Y * FilteredGlossy[I].Y,
                Samples[I].GlossyScale.Z * FilteredGlossy[I].Z};
            if (Context.InspectionMode == 1u)
            {
                LinearHdr[I] = Samples[I].DirectHdr + Samples[I].AlbedoRgb * (0.04f * Samples[I].ContactAo);
            }
            else if (Context.InspectionMode == 2u)
            {
                LinearHdr[I] = GiTerm * 2.2f;
            }
            else if (Context.InspectionMode == 3u)
            {
                LinearHdr[I] = SpecTerm * 2.0f;
            }
            else
            {
                LinearHdr[I] = Samples[I].BaseHdr + GiTerm + SpecTerm;
            }
        }
        else
        {
            LinearHdr[I] = (Context.InspectionMode == 0u) ? Samples[I].BaseHdr : (Samples[I].BaseHdr * 0.25f);
        }
    }

    // 4b. Multi-Element Optical Camera Lens Flare (LensFlareModel.h: coated ghosts, starburst, streaks, glow & halo)!
    if (Context.EnableSolarLensFlare && LuminanceRec709(Context.SunIrradianceRgb) > 0.05f)
    {
        const Vec3   SunDir   = Normalise(Context.SunDirectionUnit);
        const double SunDepth = static_cast<double>(Dot(SunDir, Forward));
        const double TanY     = static_cast<double>(TanHalf);
        if (SunDepth > 1.0e-4 && TanY > 1.0e-5)
        {
            const double SunVis = EvaluateSolarFlareVisibility(CameraOriginWorld, SunDir, Context);
            if (SunVis > 1.0e-4)
            {
                const double      SunScreenX = static_cast<double>(Dot(SunDir, Right)) / (SunDepth * TanY);
                const double      SunScreenY = static_cast<double>(Dot(SunDir, Up)) / (SunDepth * TanY);
                const double      AltKm      = std::max(0.0, static_cast<double>(CameraOriginWorld.Z) * 1.0e-3);
                const SpectrumRgb TransAtm   = (Context.AtmosphereLut != nullptr)
                                                   ? Context.AtmosphereLut->Sample(
                                                         Context.Atmosphere,
                                                         Context.Atmosphere.GroundRadiusKm + AltKm,
                                                         std::clamp(static_cast<double>(SunDir.Z), -1.0, 1.0))
                                                   : SpectrumRgb{1.0, 1.0, 1.0};
                const SpectrumRgb SunAtCamera{
                    static_cast<double>(Context.SunIrradianceRgb.X) * TransAtm.R,
                    static_cast<double>(Context.SunIrradianceRgb.Y) * TransAtm.G,
                    static_cast<double>(Context.SunIrradianceRgb.Z) * TransAtm.B};

                const double HalfW = 0.5 * static_cast<double>(Width);
                const double HalfH = 0.5 * static_cast<double>(Height);
                for (uint32_t Py = 0u; Py < Height; ++Py)
                {
                    const double ScreenY = (HalfH - static_cast<double>(Py) - 0.5) / HalfH;
                    for (uint32_t Px = 0u; Px < Width; ++Px)
                    {
                        const double      ScreenX = (static_cast<double>(Px) + 0.5 - HalfW) / HalfH;
                        const SpectrumRgb Flare   = EvaluateLensFlareRadiance(
                            ScreenX,
                            ScreenY,
                            SunScreenX,
                            SunScreenY,
                            SunAtCamera,
                            SunVis,
                            Context.LensFlareOptics);
                        const size_t PIdx = static_cast<size_t>(Py) * Width + Px;
                        LinearHdr[PIdx]   = LinearHdr[PIdx] + FromSpectrum(Flare);
                    }
                }
            }
        }
    }

    // 5. Multi-Scale Separable HDR Mie/Airy Bloom (Radii = 3, 9, 21 px) for natural optical glare on lights/stars/fire!
    if (Context.HdrBloomStrength > 1.0e-4f)
    {
        std::vector<Vec3> BrightExtract(PixelCount, Vec3{0.0f, 0.0f, 0.0f});
        for (size_t I = 0u; I < PixelCount; ++I)
        {
            const float Lum = LuminanceRec709(LinearHdr[I]);
            if (Lum > 1.15f)
            {
                const float Excess = (Lum - 1.15f) / (Lum + 0.85f);
                BrightExtract[I]   = ClampRadianceFirefly(LinearHdr[I] * Excess, 16.0f);
            }
        }

        auto SeparableGaussianAdd = [&](int Radius, float ScaleWeight, std::vector<Vec3>& InOutHdr)
        {
            std::vector<Vec3> TempH(PixelCount, Vec3{0.0f, 0.0f, 0.0f});
            const float       Sigma    = std::max(1.0f, static_cast<float>(Radius) * 0.52f);
            const float       Inv2Sig2 = 1.0f / (2.0f * Sigma * Sigma);

            for (uint32_t Py = 0u; Py < Height; ++Py)
            {
                for (uint32_t Px = 0u; Px < Width; ++Px)
                {
                    Vec3  Sum{0.0f, 0.0f, 0.0f};
                    float WSum = 0.0f;
                    for (int Dx = -Radius; Dx <= Radius; ++Dx)
                    {
                        const int Nx = std::clamp(static_cast<int>(Px) + Dx, 0, static_cast<int>(Width) - 1);
                        const float W = std::exp(-static_cast<float>(Dx * Dx) * Inv2Sig2);
                        Sum           = Sum + BrightExtract[static_cast<size_t>(Py) * Width + static_cast<size_t>(Nx)] * W;
                        WSum += W;
                    }
                    TempH[static_cast<size_t>(Py) * Width + Px] = Sum * (1.0f / WSum);
                }
            }
            for (uint32_t Py = 0u; Py < Height; ++Py)
            {
                for (uint32_t Px = 0u; Px < Width; ++Px)
                {
                    Vec3  Sum{0.0f, 0.0f, 0.0f};
                    float WSum = 0.0f;
                    for (int Dy = -Radius; Dy <= Radius; ++Dy)
                    {
                        const int Ny = std::clamp(static_cast<int>(Py) + Dy, 0, static_cast<int>(Height) - 1);
                        const float W = std::exp(-static_cast<float>(Dy * Dy) * Inv2Sig2);
                        Sum           = Sum + TempH[static_cast<size_t>(Ny) * Width + Px] * W;
                        WSum += W;
                    }
                    const size_t Idx = static_cast<size_t>(Py) * Width + Px;
                    InOutHdr[Idx]    = InOutHdr[Idx] + Sum * (ScaleWeight / WSum);
                }
            }
        };

        SeparableGaussianAdd(3, Context.HdrBloomStrength * 0.50f, LinearHdr);
        SeparableGaussianAdd(9, Context.HdrBloomStrength * 0.32f, LinearHdr);
        SeparableGaussianAdd(20, Context.HdrBloomStrength * 0.18f, LinearHdr);
    }

    // 6. Optional 64x64 Auto-Exposure Adaptation with Dark-Room Emissive & ControlVehicle Cabin Gain Protection!
    float EffectiveExposure = Context.ExposureScale;
    if (Context.AutoExposure != nullptr)
    {
        ExposureSettings RunSettings = Context.AutoExposureParameters;
        if (Context.HasVehicleCabinExposurePose)
        {
            const Vec3 Rel = CameraOriginWorld - Context.VehicleCabinOriginWorld;
            // CabinVolume.wgsl uses +X forward, +Y left (-Right), +Z up in vehicle body frame!
            const Vec3 BodyLocal{
                Dot(Rel, Context.VehicleCabinForwardWorld),
                -Dot(Rel, Context.VehicleCabinRightWorld),
                Dot(Rel, Context.VehicleCabinUpWorld)};
            RunSettings.VehicleCabinShare01 = std::max(
                RunSettings.VehicleCabinShare01,
                ExposureAdaptation::EvaluateVehicleCabinShare(BodyLocal));
        }
        for (const ProtectedDarkInteriorVolume& Vol : Context.DarkEmissiveInteriors)
        {
            const float F = std::max(0.02f, Vol.FeatherMetres);
            if (CameraOriginWorld.X >= Vol.BoundsMinWorld.X - F && CameraOriginWorld.X <= Vol.BoundsMaxWorld.X + F &&
                CameraOriginWorld.Y >= Vol.BoundsMinWorld.Y - F && CameraOriginWorld.Y <= Vol.BoundsMaxWorld.Y + F &&
                CameraOriginWorld.Z >= Vol.BoundsMinWorld.Z - F && CameraOriginWorld.Z <= Vol.BoundsMaxWorld.Z + F)
            {
                RunSettings.CameraInDarkEmissiveInterior = true;
            }
        }

        ExposureAdaptation::IntegrateExposure(
            LinearHdr,
            Width,
            Height,
            RunSettings,
            *Context.AutoExposure,
            Context.AutoExposureInstantConverge);
        EffectiveExposure = Context.AutoExposure->CurrentExposureGain;
    }

    // 7. Final Chromatic-Preserving AgX/ACES Filmic Tone Mapping to sRGB8!
    for (size_t I = 0u; I < PixelCount; ++I)
    {
        ChromaticAgxAcesTonemapSrgb(
            LinearHdr[I],
            EffectiveExposure,
            OutRgba8Pixels[I * 4u + 0u],
            OutRgba8Pixels[I * 4u + 1u],
            OutRgba8Pixels[I * 4u + 2u]);
        OutRgba8Pixels[I * 4u + 3u] = 255u;
    }
}

} // namespace Frontier
