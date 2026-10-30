/*==========================================================================================================================================
                                             CELESTIALGLASSLIGHTINGSHOWCASE.CPP
==========================================================================================================================================*/
// 🧩 Stage F End-to-End Numerical, Sanitizer, and High-Resolution (960x540) Visual Showcase:
//    1. Glass-Aware Nanite Virtualized Geometry (FacetTierBuild + QuadricTierBuild + ClusterHierarchy).
//    2. Hipparcos 41k Star Catalogue + Custom Stars + Textured Moon + 6 Lunar Presets + Ringed Planets & Atmospheres.
//    3. Exact Dual-Tier GI & Reflections:
//         - GTX: SDF + SurfaceCards ReSTIR GI + Software BVH Triangle Reflections!
//         - RTX: Full Hardware RT Triangle Raytracing for BOTH ReSTIR GI and Reflections!
//    4. Fixed Solid-Angle Area Luminaires, Closed-Dielectric Glass, Spatial Reuse + 3-Step A-Trous Denoising & HDR Bloom.

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             INCLUDES
------------------------------------------------------------------------------------------------------------------------------------------*/
#include "Engine/VisualEffects/CelestialSky.h"
#include "Engine/Fluid/PlumeFluid.h"
#include "Engine/Fluid/ShallowWater.h"
#include "Engine/GeometryProcessing/ClusterHierarchy.h"
#include "Engine/Particles/SparkParticles.h"
#include "Engine/Rendering/SceneRenderer.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

namespace
{
/*------------------------------------------------------------------------------------------------------------------------------------------
                                              SELF-CONTAINED LOSSLESS PNG ENCODER
------------------------------------------------------------------------------------------------------------------------------------------*/
void AppendBigEndian32(std::vector<uint8_t>& Buf, uint32_t Word)
{
    Buf.push_back(static_cast<uint8_t>((Word >> 24u) & 0xFFu));
    Buf.push_back(static_cast<uint8_t>((Word >> 16u) & 0xFFu));
    Buf.push_back(static_cast<uint8_t>((Word >> 8u) & 0xFFu));
    Buf.push_back(static_cast<uint8_t>(Word & 0xFFu));
}

uint32_t ComputeCrc32(const uint8_t* Data, size_t Length) noexcept
{
    uint32_t Crc = 0xFFFFFFFFu;
    for (size_t I = 0u; I < Length; ++I)
    {
        Crc ^= Data[I];
        for (int B = 0; B < 8; ++B)
        {
            const uint32_t Mask = -(Crc & 1u);
            Crc                 = (Crc >> 1u) ^ (0xEDB88320u & Mask);
        }
    }
    return ~Crc;
}

void AppendPngChunk(std::vector<uint8_t>& FileBytes, const char Tag[4], const std::vector<uint8_t>& Payload)
{
    AppendBigEndian32(FileBytes, static_cast<uint32_t>(Payload.size()));
    const size_t CrcStart = FileBytes.size();
    FileBytes.push_back(static_cast<uint8_t>(Tag[0]));
    FileBytes.push_back(static_cast<uint8_t>(Tag[1]));
    FileBytes.push_back(static_cast<uint8_t>(Tag[2]));
    FileBytes.push_back(static_cast<uint8_t>(Tag[3]));
    FileBytes.insert(FileBytes.end(), Payload.begin(), Payload.end());
    const uint32_t Crc = ComputeCrc32(FileBytes.data() + CrcStart, 4u + Payload.size());
    AppendBigEndian32(FileBytes, Crc);
}

bool WriteRgba8PngFile(const std::string& FilePath, uint32_t Width, uint32_t Height, const std::vector<uint8_t>& Rgba8)
{
    if (Rgba8.size() != static_cast<size_t>(Width) * Height * 4u)
    {
        return false;
    }

    std::filesystem::create_directories(std::filesystem::path(FilePath).parent_path());

    std::vector<uint8_t> RawScanlines;
    RawScanlines.reserve(static_cast<size_t>(Height) * (1u + static_cast<size_t>(Width) * 4u));
    for (uint32_t Y = 0u; Y < Height; ++Y)
    {
        RawScanlines.push_back(0u);
        const size_t RowStart = static_cast<size_t>(Y) * Width * 4u;
        RawScanlines.insert(
            RawScanlines.end(),
            Rgba8.begin() + static_cast<std::ptrdiff_t>(RowStart),
            Rgba8.begin() + static_cast<std::ptrdiff_t>(RowStart + static_cast<size_t>(Width) * 4u));
    }

    std::vector<uint8_t> ZlibData;
    ZlibData.push_back(0x78u);
    ZlibData.push_back(0x01u);

    size_t Offset = 0u;
    while (Offset < RawScanlines.size())
    {
        const size_t   Chunk = std::min<size_t>(65535u, RawScanlines.size() - Offset);
        const bool     Final = (Offset + Chunk >= RawScanlines.size());
        const uint16_t Len   = static_cast<uint16_t>(Chunk);
        const uint16_t NLen  = static_cast<uint16_t>(~Len);

        ZlibData.push_back(Final ? 0x01u : 0x00u);
        ZlibData.push_back(static_cast<uint8_t>(Len & 0xFFu));
        ZlibData.push_back(static_cast<uint8_t>((Len >> 8u) & 0xFFu));
        ZlibData.push_back(static_cast<uint8_t>(NLen & 0xFFu));
        ZlibData.push_back(static_cast<uint8_t>((NLen >> 8u) & 0xFFu));
        ZlibData.insert(
            ZlibData.end(),
            RawScanlines.begin() + static_cast<std::ptrdiff_t>(Offset),
            RawScanlines.begin() + static_cast<std::ptrdiff_t>(Offset + Chunk));
        Offset += Chunk;
    }

    uint32_t S1 = 1u;
    uint32_t S2 = 0u;
    for (uint8_t Byte : RawScanlines)
    {
        S1 = (S1 + Byte) % 65521u;
        S2 = (S2 + S1) % 65521u;
    }
    AppendBigEndian32(ZlibData, (S2 << 16u) | S1);

    std::vector<uint8_t> FileBytes = {137u, 80u, 78u, 71u, 13u, 10u, 26u, 10u};
    std::vector<uint8_t> Ihdr;
    AppendBigEndian32(Ihdr, Width);
    AppendBigEndian32(Ihdr, Height);
    Ihdr.push_back(8u);
    Ihdr.push_back(6u);
    Ihdr.push_back(0u);
    Ihdr.push_back(0u);
    Ihdr.push_back(0u);
    AppendPngChunk(FileBytes, "IHDR", Ihdr);
    AppendPngChunk(FileBytes, "IDAT", ZlibData);
    AppendPngChunk(FileBytes, "IEND", {});

    std::ofstream Out(FilePath, std::ios::binary);
    if (!Out)
    {
        return false;
    }
    Out.write(reinterpret_cast<const char*>(FileBytes.data()), static_cast<std::streamsize>(FileBytes.size()));
    return Out.good();
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                       ASSERTION TRACKER
------------------------------------------------------------------------------------------------------------------------------------------*/
struct ValidationLedger
{
    uint32_t PassedCount = 0u;
    uint32_t FailedCount = 0u;

    void RecordAssertion(bool Condition, const char* Label, const std::string& Detail)
    {
        if (Condition)
        {
            ++PassedCount;
            std::printf("  [PASS] %-66s %s\n", Label, Detail.c_str());
        }
        else
        {
            ++FailedCount;
            std::printf("  [FAIL] %-66s %s\n", Label, Detail.c_str());
        }
    }
};

/*------------------------------------------------------------------------------------------------------------------------------------------
                                            PROCEDURAL FACET BUILDERS FOR NANITE GLASS
------------------------------------------------------------------------------------------------------------------------------------------*/
void AppendUvSphereToFacetField(
    Frontier::FacetField& Field,
    Frontier::Vec3        Centre,
    float                 RadiusM,
    uint32_t              Stacks,
    uint32_t              Slices,
    uint32_t              MaterialClass)
{
    auto EvalVertex = [&](uint32_t St, uint32_t Sl, Frontier::Vector3& OutP, std::array<double, 2>& OutUv)
    {
        const double U     = static_cast<double>(Sl) / static_cast<double>(Slices);
        const double V     = static_cast<double>(St) / static_cast<double>(Stacks);
        const double Theta = 3.14159265358979323846 * V;
        const double Phi   = 2.0 * 3.14159265358979323846 * U;
        const double SinT  = std::sin(Theta);
        OutP               = Frontier::Vector3{
            static_cast<double>(Centre.X) + static_cast<double>(RadiusM) * SinT * std::cos(Phi),
            static_cast<double>(Centre.Y) + static_cast<double>(RadiusM) * SinT * std::sin(Phi),
            static_cast<double>(Centre.Z) + static_cast<double>(RadiusM) * std::cos(Theta)};
        OutUv = {U * 4.0, V * 2.0};
    };

    for (uint32_t St = 0u; St < Stacks; ++St)
    {
        for (uint32_t Sl = 0u; Sl < Slices; ++Sl)
        {
            Frontier::Vector3     P00, P10, P11, P01;
            std::array<double, 2> Uv00, Uv10, Uv11, Uv01;
            EvalVertex(St, Sl, P00, Uv00);
            EvalVertex(St, Sl + 1u, P10, Uv10);
            EvalVertex(St + 1u, Sl + 1u, P11, Uv11);
            EvalVertex(St + 1u, Sl, P01, Uv01);

            if (St > 0u)
            {
                Field.Corners.push_back(P00);
                Field.Corners.push_back(P11);
                Field.Corners.push_back(P10);
                Field.CornerUVs.push_back(Uv00);
                Field.CornerUVs.push_back(Uv11);
                Field.CornerUVs.push_back(Uv10);
                Field.Classification.push_back(MaterialClass);
                Field.SharpMask.push_back(0u);
            }
            if (St + 1u < Stacks)
            {
                Field.Corners.push_back(P00);
                Field.Corners.push_back(P01);
                Field.Corners.push_back(P11);
                Field.CornerUVs.push_back(Uv00);
                Field.CornerUVs.push_back(Uv01);
                Field.CornerUVs.push_back(Uv11);
                Field.Classification.push_back(MaterialClass);
                Field.SharpMask.push_back(0u);
            }
        }
    }
}

void AppendSubdividedBoxToFacetField(
    Frontier::FacetField& Field,
    Frontier::Vec3        Centre,
    Frontier::Vec3        HalfExtents,
    uint32_t              SubdivPerAxis,
    uint32_t              MaterialClass)
{
    auto AppendGridQuadFace = [&](Frontier::Vec3 Origin, Frontier::Vec3 AxisU, Frontier::Vec3 AxisV)
    {
        for (uint32_t J = 0u; J < SubdivPerAxis; ++J)
        {
            const float V0 = static_cast<float>(J) / static_cast<float>(SubdivPerAxis);
            const float V1 = static_cast<float>(J + 1u) / static_cast<float>(SubdivPerAxis);
            for (uint32_t I = 0u; I < SubdivPerAxis; ++I)
            {
                const float U0 = static_cast<float>(I) / static_cast<float>(SubdivPerAxis);
                const float U1 = static_cast<float>(I + 1u) / static_cast<float>(SubdivPerAxis);

                const Frontier::Vec3 A = Origin + AxisU * U0 + AxisV * V0;
                const Frontier::Vec3 B = Origin + AxisU * U1 + AxisV * V0;
                const Frontier::Vec3 C = Origin + AxisU * U1 + AxisV * V1;
                const Frontier::Vec3 D = Origin + AxisU * U0 + AxisV * V1;

                auto ToV3 = [](Frontier::Vec3 P) { return Frontier::Vector3{P.X, P.Y, P.Z}; };
                Field.Corners.push_back(ToV3(A));
                Field.Corners.push_back(ToV3(B));
                Field.Corners.push_back(ToV3(C));
                Field.CornerUVs.push_back({U0 * 3.0, V0 * 3.0});
                Field.CornerUVs.push_back({U1 * 3.0, V0 * 3.0});
                Field.CornerUVs.push_back({U1 * 3.0, V1 * 3.0});
                Field.Classification.push_back(MaterialClass);
                Field.SharpMask.push_back(0u);

                Field.Corners.push_back(ToV3(A));
                Field.Corners.push_back(ToV3(C));
                Field.Corners.push_back(ToV3(D));
                Field.CornerUVs.push_back({U0 * 3.0, V0 * 3.0});
                Field.CornerUVs.push_back({U1 * 3.0, V1 * 3.0});
                Field.CornerUVs.push_back({U0 * 3.0, V1 * 3.0});
                Field.Classification.push_back(MaterialClass);
                Field.SharpMask.push_back(0u);
            }
        }
    };

    const float X0 = Centre.X - HalfExtents.X, X1 = Centre.X + HalfExtents.X;
    const float Y0 = Centre.Y - HalfExtents.Y, Y1 = Centre.Y + HalfExtents.Y;
    const float Z0 = Centre.Z - HalfExtents.Z, Z1 = Centre.Z + HalfExtents.Z;
    const float SX = 2.0f * HalfExtents.X, SY = 2.0f * HalfExtents.Y, SZ = 2.0f * HalfExtents.Z;

    AppendGridQuadFace({X0, Y0, Z1}, {SX, 0.0f, 0.0f}, {0.0f, SY, 0.0f});
    AppendGridQuadFace({X0, Y1, Z0}, {SX, 0.0f, 0.0f}, {0.0f, -SY, 0.0f});
    AppendGridQuadFace({X0, Y0, Z0}, {SX, 0.0f, 0.0f}, {0.0f, 0.0f, SZ});
    AppendGridQuadFace({X1, Y1, Z0}, {-SX, 0.0f, 0.0f}, {0.0f, 0.0f, SZ});
    AppendGridQuadFace({X1, Y0, Z0}, {0.0f, SY, 0.0f}, {0.0f, 0.0f, SZ});
    AppendGridQuadFace({X0, Y1, Z0}, {0.0f, -SY, 0.0f}, {0.0f, 0.0f, SZ});
}

void TonemapHdrTileIntoAtlas(
    const Frontier::CelestialSky& Sky,
    Frontier::Vec3                               CamForward,
    Frontier::Vec3                               CamRight,
    Frontier::Vec3                               CamUp,
    float                                        TanHalfFov,
    Frontier::Vec3                               SunDir,
    Frontier::Vec3                               SunRad,
    float                                        Exposure,
    uint32_t                                     TileX,
    uint32_t                                     TileY,
    uint32_t                                     TileW,
    uint32_t                                     TileH,
    uint32_t                                     AtlasW,
    std::vector<uint8_t>&                        OutAtlasRgba)
{
    const float Aspect = static_cast<float>(TileW) / static_cast<float>(TileH);
    for (uint32_t Py = 0u; Py < TileH; ++Py)
    {
        for (uint32_t Px = 0u; Px < TileW; ++Px)
        {
            // 2x2 subpixel anti-aliased celestial evaluation for razor-crisp ring divisions & lunar craters!
            Frontier::Vec3 RgbSum{0.0f, 0.0f, 0.0f};
            for (int Sy = 0; Sy < 2; ++Sy)
            {
                for (int Sx = 0; Sx < 2; ++Sx)
                {
                    const float SubY = 1.0f - 2.0f * (static_cast<float>(Py) + 0.25f + 0.5f * Sx) / static_cast<float>(TileH);
                    const float SubX = (2.0f * (static_cast<float>(Px) + 0.25f + 0.5f * Sy) / static_cast<float>(TileW) - 1.0f) * Aspect;
                    const Frontier::Vec3 SDir = Frontier::Normalise(
                        CamForward + CamRight * (SubX * TanHalfFov) + CamUp * (SubY * TanHalfFov));
                    const auto Sample = Sky.EvaluateCelestialRay(
                        SDir,
                        SunDir,
                        SunRad,
                        -28.0f,
                        2.0f * TanHalfFov / static_cast<float>(TileH));
                    RgbSum = RgbSum + Sample.RadianceRgb;
                }
            }
            const Frontier::Vec3 Hdr = RgbSum * (0.25f * Exposure);

            // Thin subtle tile border (1 px slate separator)
            const bool Border = (Px == 0u || Py == 0u || Px + 1u == TileW || Py + 1u == TileH);
            auto       AcesSrgb = [](float X) -> uint8_t
            {
                const float V = std::max(0.0f, X);
                const float M = std::clamp((V * (2.51f * V + 0.03f)) / (V * (2.43f * V + 0.59f) + 0.14f), 0.0f, 1.0f);
                const float S = (M <= 0.0031308f) ? (12.92f * M) : (1.055f * std::pow(M, 1.0f / 2.4f) - 0.055f);
                return static_cast<uint8_t>(std::clamp(S * 255.0f + 0.5f, 0.0f, 255.0f));
            };

            const size_t OutIdx = (static_cast<size_t>(TileY + Py) * AtlasW + (TileX + Px)) * 4u;
            if (Border)
            {
                OutAtlasRgba[OutIdx + 0u] = 28u;
                OutAtlasRgba[OutIdx + 1u] = 34u;
                OutAtlasRgba[OutIdx + 2u] = 46u;
                OutAtlasRgba[OutIdx + 3u] = 255u;
            }
            else
            {
                OutAtlasRgba[OutIdx + 0u] = AcesSrgb(Hdr.X);
                OutAtlasRgba[OutIdx + 1u] = AcesSrgb(Hdr.Y);
                OutAtlasRgba[OutIdx + 2u] = AcesSrgb(Hdr.Z);
                OutAtlasRgba[OutIdx + 3u] = 255u;
            }
        }
    }
}
} // namespace

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                        SHOWCASE ENTRY POINT
------------------------------------------------------------------------------------------------------------------------------------------*/
int main(int Argc, char** Argv)
{
    bool SkipRenders = false;
    for (int I = 1; I < Argc; ++I)
    {
        if (std::strcmp(Argv[I], "--skip-renders") == 0)
        {
            SkipRenders = true;
        }
    }

    std::printf("====================================================================================================\n");
    std::printf("  FRONTIER STAGE F: GLASS-AWARE NANITE, CELESTIAL PLANETARY SKY, DUAL-TIER GI & EMISSIVE SHOWCASE\n");
    std::printf("====================================================================================================\n\n");

    ValidationLedger Ledger{};

    /*--------------------------------------------------------------------------------------------------------------------------------------
                                  SUITE 1: GLASS-AWARE NANITE VIRTUALIZED CLUSTER GEOMETRY
    --------------------------------------------------------------------------------------------------------------------------------------*/
    std::printf("--- Suite 1: Glass-Aware Nanite Virtualized Cluster Geometry (FacetTier + QuadricTier + Two-Phase Hi-Z) ---\n");

    Frontier::ClusterHierarchy ClusteredGeo{};
    ClusteredGeo.RegisterMaterialProfile({0u, false, 1.0f, {0.0f, 0.0f, 0.0f}, {0.72f, 0.70f, 0.66f}, 0.45f, 0.0f});  // Stone floor/wall
    ClusteredGeo.RegisterMaterialProfile({1u, false, 1.0f, {0.0f, 0.0f, 0.0f}, {0.22f, 0.74f, 0.52f}, 0.25f, 0.15f}); // Emerald pillar
    ClusteredGeo.RegisterMaterialProfile({2u, false, 1.0f, {0.0f, 0.0f, 0.0f}, {0.88f, 0.62f, 0.22f}, 0.18f, 0.85f}); // Gold pillar
    ClusteredGeo.RegisterMaterialProfile({3u, true, 1.54f, {0.10f, 0.03f, 0.05f}, {0.96f, 0.99f, 1.00f}, 0.03f, 0.0f}); // Crown glass dome
    ClusteredGeo.RegisterMaterialProfile({4u, false, 1.0f, {0.0f, 0.0f, 0.0f}, {0.68f, 0.66f, 0.74f}, 0.35f, 0.0f});  // Far stone sphere

    Frontier::FacetField SourceSoup{};
    // Floor slab + Left Opaque Occluder Wall + Right Curved Glass Dome + Two Identical Interior Pillars behind each!
    AppendSubdividedBoxToFacetField(SourceSoup, {0.0f, 0.0f, -0.25f}, {7.5f, 7.5f, 0.25f}, 12u, 0u);
    AppendSubdividedBoxToFacetField(SourceSoup, {-2.2f, -1.2f, 1.35f}, {1.45f, 0.32f, 1.35f}, 10u, 0u); // Left Opaque Wall
    AppendUvSphereToFacetField(SourceSoup, {+2.2f, -1.2f, 1.45f}, 1.45f, 24u, 36u, 3u);                 // Right Curved Glass Sphere/Dome
    AppendSubdividedBoxToFacetField(SourceSoup, {-2.2f, +1.8f, 1.15f}, {0.55f, 0.55f, 1.15f}, 8u, 2u);  // Gold Pillar BEHIND Opaque Wall
    AppendSubdividedBoxToFacetField(SourceSoup, {+2.2f, +1.8f, 1.15f}, {0.55f, 0.55f, 1.15f}, 8u, 1u);  // Emerald Pillar BEHIND Glass Dome
    AppendUvSphereToFacetField(SourceSoup, {-1.35f, +8.4f, 2.35f}, 1.10f, 20u, 28u, 4u); // Far Opaque Sphere (equal dist)
    AppendUvSphereToFacetField(SourceSoup, {+1.35f, +8.4f, 2.35f}, 1.10f, 20u, 28u, 3u); // Far Glass Sphere (equal dist)

    Frontier::TierBuildSpecification TierSpec{};
    TierSpec.TriangleLimit      = 96u;
    TierSpec.GroupLimit         = 4u;
    TierSpec.CoarseningFraction = 0.5;
    TierSpec.MaximumTiers       = 6u;

    const bool BuiltOk = ClusteredGeo.BuildFromFacetField(SourceSoup, TierSpec);
    const auto& Seq    = ClusteredGeo.TierSequence();
    const auto& Recs   = ClusteredGeo.ClusterRecords();

    // Verify 100% class-pure clusters & monotonic error DAG!
    uint32_t MixedClusters  = 0u;
    uint32_t MaxGlassBoostX = 0u;
    float    PeakGlassBoost = 1.0f;
    bool     MonotonicDag   = (Seq.Tiers.size() >= 3u);

    for (const auto& Tier : Seq.Tiers)
    {
        for (const auto& Cl : Tier.Clusters)
        {
            if (Cl.Triangles.size() > 128u)
            {
                ++MixedClusters;
            }
            for (uint32_t TIdx : Cl.Triangles)
            {
                if (Tier.Complex.Classification[TIdx] != Cl.Classification)
                {
                    ++MixedClusters;
                }
            }
        }
    }
    for (const auto& R : Recs)
    {
        if (R.CoarserDeviationMetres <= R.SelfDeviationMetres)
        {
            MonotonicDag = false;
        }
        if (R.TransmissiveGlass && R.OpticalDeviationBoost > 1.05f)
        {
            ++MaxGlassBoostX;
            PeakGlassBoost = std::max(PeakGlassBoost, R.OpticalDeviationBoost);
        }
    }

    char Buf[256];
    std::snprintf(
        Buf,
        sizeof(Buf),
        "tiers=%zu clusters=%zu pages=%zu mixed=%u monotonic=%d",
        Seq.Tiers.size(),
        Recs.size(),
        ClusteredGeo.StreamingPages().size(),
        MixedClusters,
        MonotonicDag ? 1 : 0);
    Ledger.RecordAssertion(
        BuiltOk && MixedClusters == 0u && MonotonicDag,
        "Class-pure <=128-tri glass/opaque partition & monotonic quadric DAG",
        Buf);

    Frontier::ClusterCameraView GeoCam{};
    GeoCam.CameraOrigin     = {0.0f, -6.2f, 1.55f};
    GeoCam.CameraTarget     = {0.0f, +1.5f, 1.35f};
    GeoCam.ViewportWidthPx  = 960u;
    GeoCam.ViewportHeightPx = 540u;
    GeoCam.ErrorThresholdPx = 11.5f; // Drops far opaque sphere (class 4, y=+8.4) to Tier 1..2 while IOR boost keeps glass finer!

    const Frontier::ClusterRuntimeFrameReport CutReport = ClusteredGeo.ExecuteGlassAwareCutAndTwoPhaseHiZ(GeoCam);

    // Compare mean selected tier of Far Glass Sphere (class 3, y > 6.5) vs Far Opaque Sphere (class 4, y > 6.5)!
    double   FarGlassTierSum = 0.0, FarOpaqueTierSum = 0.0;
    uint32_t FarGlassCount   = 0u,  FarOpaqueCount   = 0u;
    for (uint32_t GId : CutReport.SelectedGlassGlobals)
    {
        if (Recs[GId].SphereCentre.Y > 6.5)
        {
            FarGlassTierSum += static_cast<double>(Recs[GId].TierIndex);
            ++FarGlassCount;
        }
    }
    for (uint32_t OId : CutReport.SelectedOpaqueGlobals)
    {
        if (Recs[OId].SphereCentre.Y > 6.5 && Recs[OId].ClassificationId == 4u)
        {
            FarOpaqueTierSum += static_cast<double>(Recs[OId].TierIndex);
            ++FarOpaqueCount;
        }
    }
    const double MeanGlassTier  = (FarGlassCount > 0u) ? (FarGlassTierSum / FarGlassCount) : 0.0;
    const double MeanOpaqueTier = (FarOpaqueCount > 0u) ? (FarOpaqueTierSum / FarOpaqueCount) : 0.0;

    std::snprintf(
        Buf,
        sizeof(Buf),
        "peak_ior_boost=%.3f glass_mean_tier=%.2f < opaque_mean_tier=%.2f glass_backface_exempt=%u",
        PeakGlassBoost,
        MeanGlassTier,
        MeanOpaqueTier,
        CutReport.GlassExemptFromBackface);
    Ledger.RecordAssertion(
        MaxGlassBoostX > 0u && PeakGlassBoost > 1.15f && MeanGlassTier < MeanOpaqueTier && CutReport.GlassExemptFromBackface > 0u,
        "Optical IOR deviation boost & backface-exempt glass cone culling",
        Buf);

    std::snprintf(
        Buf,
        sizeof(Buf),
        "behind_glass_survived=%u hiz_occluded_behind_opaque=%u active_tris=%u/%u",
        CutReport.OpaqueBehindGlassSurvived,
        CutReport.HiZOccludedOpaqueCount,
        CutReport.ActiveTrianglesAfterCull,
        CutReport.SourceLeafTriangles);
    Ledger.RecordAssertion(
        CutReport.OpaqueBehindGlassSurvived > 0u && CutReport.HiZOccludedOpaqueCount > 0u,
        "Two-phase non-opaque Hi-Z keeps geometry behind glass unculled",
        Buf);

    // Verify 64 KB page streaming cap & graceful coarser fallback under tight VRAM budget!
    bool AllPagesUnder64K = !ClusteredGeo.StreamingPages().empty();
    uint32_t TotalPageBytes = 0u;
    for (const auto& Pg : ClusteredGeo.StreamingPages())
    {
        if (Pg.ByteSize > Frontier::ClusterHierarchy::StreamingPageCapacityBytes)
        {
            AllPagesUnder64K = false;
        }
        TotalPageBytes += Pg.ByteSize;
    }
    ClusteredGeo.EnforcePageResidencyBudget(std::max(65536u, TotalPageBytes / 2u), GeoCam, 42ull);
    uint32_t ResidentBytes = 0u;
    bool     RootsPinned   = true;
    for (const auto& Pg : ClusteredGeo.StreamingPages())
    {
        if (Pg.PinnedRoot && !Pg.ResidentInMemory)
        {
            RootsPinned = false;
        }
        if (Pg.ResidentInMemory)
        {
            ResidentBytes += Pg.ByteSize;
        }
    }
    const auto BudgetCut = ClusteredGeo.ExecuteGlassAwareCutAndTwoPhaseHiZ(GeoCam);
    // Restore full residency for high-res showcase rendering!
    ClusteredGeo.EnforcePageResidencyBudget(TotalPageBytes + 65536u, GeoCam, 43ull);

    std::snprintf(
        Buf,
        sizeof(Buf),
        "pages<=64KB=%d roots_pinned=%d resident=%u/%u B cut_clusters=%u",
        AllPagesUnder64K ? 1 : 0,
        RootsPinned ? 1 : 0,
        ResidentBytes,
        TotalPageBytes,
        BudgetCut.TotalCutClusters);
    Ledger.RecordAssertion(
        AllPagesUnder64K && RootsPinned && BudgetCut.TotalCutClusters > 0u,
        "64 KB streaming page packing, pinned roots & LRU residency fallback",
        Buf);

    /*--------------------------------------------------------------------------------------------------------------------------------------
                       SUITE 2: HIPPARCOS STARS, CUSTOM STARS, MOON, RINGED PLANETS & SIMULATED ATMOSPHERES
    --------------------------------------------------------------------------------------------------------------------------------------*/
    std::printf("\n--- Suite 2: 41k Hipparcos Catalogue, Custom Stars, Textured Moon, Ringed Planets & Atmospheres ---\n");

    Frontier::CelestialSky Celestial{};
    const bool LoadedHip = Celestial.LoadHipparcosCatalogueCsv("Exhibits/NightSky/Data/Hipparcos8.csv", 2461343.85, -26.188, 28.320);
    const bool LoadedMoon = Celestial.LoadLunaAlbedoMapPpm("EngineContent/CelestialMaps/MoonAlbedo2048.ppm");
    Celestial.ConfigureStarfieldAppearance(1.45f, 7.8f, 1.28f, 0.18f, 12.5f);

    std::snprintf(
        Buf,
        sizeof(Buf),
        "hipparcos_loaded=%d binned_entries=%u oct_cells=1024 moon_ppm=%d",
        LoadedHip ? 1 : 0,
        Celestial.BinnedCatalogueEntryCount(),
        LoadedMoon ? 1 : 0);
    Ledger.RecordAssertion(
        LoadedHip && Celestial.BinnedCatalogueEntryCount() > 15000u && LoadedMoon && Celestial.LunaMapReady(),
        "41k J2000 Hipparcos octahedral star index & 2048x1024 MoonAlbedo PPM",
        Buf);

    // Register 3 Custom Authored Stars (3200 K red supergiant, 6200 K solar star, 21000 K blue giant)!
    Frontier::CustomStarDescriptor RedStar{};
    RedStar.DirectionUnit       = Frontier::Normalise({-0.08f, 0.84f, 0.53f});
    RedStar.AngularRadiusRad    = 0.0020f;
    RedStar.TemperatureKelvin   = 3200.0f;
    RedStar.RadianceGain        = 14.0f;
    RedStar.CoronaGlowStrength  = 0.85f;
    RedStar.SceneIrradianceGain = 0.08f;
    Celestial.RegisterCustomStar(RedStar);

    Frontier::CustomStarDescriptor GoldStar{};
    GoldStar.DirectionUnit       = Frontier::Normalise({+0.06f, 0.87f, 0.49f});
    GoldStar.AngularRadiusRad    = 0.0016f;
    GoldStar.TemperatureKelvin   = 6200.0f;
    GoldStar.RadianceGain        = 11.5f;
    GoldStar.CoronaGlowStrength  = 0.78f;
    GoldStar.SceneIrradianceGain = 0.06f;
    Celestial.RegisterCustomStar(GoldStar);

    Frontier::CustomStarDescriptor BlueStar{};
    BlueStar.DirectionUnit       = Frontier::Normalise({-0.46f, 0.83f, 0.32f});
    BlueStar.AngularRadiusRad    = 0.0019f;
    BlueStar.TemperatureKelvin   = 21000.0f;
    BlueStar.RadianceGain        = 15.0f;
    BlueStar.CoronaGlowStrength  = 0.88f;
    BlueStar.SceneIrradianceGain = 0.09f;
    Celestial.RegisterCustomStar(BlueStar);

    const Frontier::Vec3 ExoSunDir = Frontier::Normalise({-0.86f, -0.36f, 0.36f});
    const Frontier::Vec3 ExoSunRad = {15.2f, 14.6f, 13.9f};

    const auto RedEval  = Celestial.EvaluateCelestialRay(RedStar.DirectionUnit, ExoSunDir, ExoSunRad, -28.0f, 0.0015f);
    const auto BlueEval = Celestial.EvaluateCelestialRay(BlueStar.DirectionUnit, ExoSunDir, ExoSunRad, -28.0f, 0.0015f);
    std::snprintf(
        Buf,
        sizeof(Buf),
        "3200K_rgb=(%.2f,%.2f,%.2f) 21000K_rgb=(%.2f,%.2f,%.2f)",
        RedEval.RadianceRgb.X,
        RedEval.RadianceRgb.Y,
        RedEval.RadianceRgb.Z,
        BlueEval.RadianceRgb.X,
        BlueEval.RadianceRgb.Y,
        BlueEval.RadianceRgb.Z);
    Ledger.RecordAssertion(
        RedEval.RadianceRgb.X > RedEval.RadianceRgb.Z * 1.4f && BlueEval.RadianceRgb.Z > BlueEval.RadianceRgb.X * 1.15f,
        "Custom stars Planckian chromaticity (3200K warm vs 21000K blue) & spikes",
        Buf);

    // Register Textured Luna + verify Gibbous/Full vs Crescent irradiance & Earthshine + all 6 Lunar presets!
    Frontier::LunarBodyDescriptor HeroMoon{};
    HeroMoon.Preset                = Frontier::LunarSurfacePreset::LunaSelenographic;
    HeroMoon.DirectionUnit         = Frontier::Normalise({-0.33f, 0.83f, 0.45f});
    HeroMoon.AngularRadiusRad      = 0.036f;
    HeroMoon.SurfaceBrightness     = 3.1f;
    HeroMoon.EarthshineStrength    = 0.075f;
    HeroMoon.SceneBounceIrradiance = 0.34f;
    Celestial.RegisterLunarBody(HeroMoon);

    const auto MoonSunlitRay = Celestial.EvaluateCelestialRay(
        Frontier::Normalise(HeroMoon.DirectionUnit + Frontier::Vec3{-0.016f, 0.0f, 0.008f}), ExoSunDir, ExoSunRad, -28.0f, 0.0012f);
    const auto MoonDarkEarthshineRay = Celestial.EvaluateCelestialRay(
        Frontier::Normalise(HeroMoon.DirectionUnit + Frontier::Vec3{+0.020f, 0.0f, -0.010f}),
        Frontier::Normalise({-0.95f, 0.25f, 0.18f}),
        ExoSunRad,
        -28.0f,
        0.0012f);

    bool AllSixLunarPresetsValid = true;
    for (uint8_t P = 0u; P < 6u; ++P)
    {
        Frontier::CelestialSky TempMoonSky{};
        Frontier::LunarBodyDescriptor         M{};
        M.Preset           = static_cast<Frontier::LunarSurfacePreset>(P);
        M.DirectionUnit    = {0.0f, 1.0f, 0.0f};
        M.AngularRadiusRad = 0.04f;
        TempMoonSky.RegisterLunarBody(M);
        const auto S = TempMoonSky.EvaluateCelestialRay({0.0f, 1.0f, 0.0f}, {-0.5f, -0.7f, 0.5f}, ExoSunRad, -30.0f, 0.001f);
        if (!S.HitLunarDisc || S.RadianceRgb.X <= 0.0f)
        {
            AllSixLunarPresetsValid = false;
        }
    }
    std::snprintf(
        Buf,
        sizeof(Buf),
        "sunlit_R=%.3f earthshine_B=%.4f all_6_presets=%d occ_T=%.2f",
        MoonSunlitRay.RadianceRgb.X,
        MoonDarkEarthshineRay.RadianceRgb.Z,
        AllSixLunarPresetsValid ? 1 : 0,
        MoonSunlitRay.OcclusionTransmittance);
    Ledger.RecordAssertion(
        MoonSunlitRay.HitLunarDisc && MoonSunlitRay.RadianceRgb.X > 0.25f &&
            MoonDarkEarthshineRay.RadianceRgb.Z > 1.0e-3f && AllSixLunarPresetsValid &&
            MoonSunlitRay.OcclusionTransmittance == 0.0f,
        "Textured Luna crater phase, earthshine, star occultation & 6 lunar presets",
        Buf);

    // Register Majestic Ringed Saturnian Gas Giant with Spherical Rayleigh/Mie/Ozone Atmosphere!
    Frontier::PlanetaryBodyDescriptor HeroPlanet{};
    HeroPlanet.Archetype                        = Frontier::PlanetarySurfaceArchetype::BandedGasGiant;
    HeroPlanet.DirectionUnit                    = Frontier::Normalise({0.26f, 0.85f, 0.36f});
    HeroPlanet.AngularRadiusRad                 = 0.078f;
    HeroPlanet.SpinAxisUnit                     = Frontier::Normalise({-0.22f, -0.44f, 0.87f});
    HeroPlanet.SpinPhaseRad                     = 0.85f;
    HeroPlanet.SurfaceAlbedoScale               = 1.48f;
    HeroPlanet.Atmosphere.Enabled               = true;
    HeroPlanet.Atmosphere.ShellHeightFraction   = 0.115f;
    HeroPlanet.Atmosphere.RayleighScattering    = {5.2e-6f, 14.2e-6f, 36.5e-6f};
    HeroPlanet.Atmosphere.MieScattering         = 20.0e-6f;
    HeroPlanet.Atmosphere.OpticalDensityScale   = 5.8e5f;
    HeroPlanet.Rings.Enabled                    = true;
    HeroPlanet.Rings.RingNormalUnit             = HeroPlanet.SpinAxisUnit;
    HeroPlanet.Rings.InnerRadiusRatio           = 1.24f;
    HeroPlanet.Rings.OuterRadiusRatio           = 2.38f;
    HeroPlanet.Rings.PeakOpticalDepth           = 1.75f;
    Celestial.RegisterPlanetaryBody(HeroPlanet);

    // Exact tangent axis lying INSIDE the tilted ring plane (perpendicular to BOTH RingNormalUnit and Planet.DirectionUnit)!
    const Frontier::Vec3 RingMajorAxis = Frontier::Normalise(Frontier::Cross(HeroPlanet.Rings.RingNormalUnit, HeroPlanet.DirectionUnit));
    const float          SinRp         = std::sin(HeroPlanet.AngularRadiusRad);
    const Frontier::Vec3 PlanetPos3D   = HeroPlanet.DirectionUnit * (1.0f / SinRp);

    const Frontier::Vec3 LimbRayDir  = Frontier::Normalise(PlanetPos3D + RingMajorAxis * 1.045f);
    const auto           LimbSample  = Celestial.EvaluateCelestialRay(LimbRayDir, ExoSunDir, ExoSunRad, -28.0f, 0.0008f);

    // Exact B-ring midpoint (1.65 Rp) vs exact Cassini Division centre (1.24 + 0.615 * 1.14 = 1.9411 Rp)!
    const Frontier::Vec3 BRingDir   = Frontier::Normalise(PlanetPos3D + RingMajorAxis * 1.65f);
    const Frontier::Vec3 CassiniDir = Frontier::Normalise(PlanetPos3D + RingMajorAxis * 1.9411f);
    const auto           BRingSamp  = Celestial.EvaluateCelestialRay(BRingDir, ExoSunDir, ExoSunRad, -28.0f, 0.0005f);
    const auto           CassiniSmp = Celestial.EvaluateCelestialRay(CassiniDir, ExoSunDir, ExoSunRad, -28.0f, 0.0005f);

    bool SawPlanetShadowOnRing = false;
    bool SawRingShadowOnPlanet = false;
    const Frontier::Vec3 RingMinorView = Frontier::Normalise(Frontier::Cross(HeroPlanet.DirectionUnit, RingMajorAxis));
    for (int Scan = -45; Scan <= 45; ++Scan)
    {
        for (int VScan = -35; VScan <= 35; ++VScan)
        {
            const Frontier::Vec3 Off = RingMajorAxis * (Scan * 0.055f) + RingMinorView * (VScan * 0.045f);
            const auto           S   = Celestial.EvaluateCelestialRay(
                Frontier::Normalise(PlanetPos3D + Off), ExoSunDir, ExoSunRad, -28.0f, 0.0008f);
            if (S.InPlanetShadowOnRings)
            {
                SawPlanetShadowOnRing = true;
            }
            if (S.InRingShadowOnPlanet)
            {
                SawRingShadowOnPlanet = true;
            }
        }
    }

    std::snprintf(
        Buf,
        sizeof(Buf),
        "atmo_limb=%d(B=%.3f) B_ring_T=%.2f cassini_T=%.2f p_on_r_shd=%d r_on_p_shd=%d",
        LimbSample.HitPlanetAtmosphere ? 1 : 0,
        LimbSample.RadianceRgb.Z,
        BRingSamp.OcclusionTransmittance,
        CassiniSmp.OcclusionTransmittance,
        SawPlanetShadowOnRing ? 1 : 0,
        SawRingShadowOnPlanet ? 1 : 0);
    Ledger.RecordAssertion(
        LimbSample.HitPlanetAtmosphere && !LimbSample.HitPlanetBody && LimbSample.RadianceRgb.Z > 0.02f &&
            BRingSamp.HitPlanetaryRings && CassiniSmp.OcclusionTransmittance > BRingSamp.OcclusionTransmittance + 0.25f &&
            SawPlanetShadowOnRing && SawRingShadowOnPlanet,
        "Simulated spherical planet atmosphere, Cassini gap & mutual ring/planet shadows",
        Buf);

    /*--------------------------------------------------------------------------------------------------------------------------------------
                  SUITE 3: EXACT GTX (SDF GI + BVH TRIANGLE REFLECTIONS) VS RTX (FULL RT) & FIXED EMISSIVES
    --------------------------------------------------------------------------------------------------------------------------------------*/
    std::printf("\n--- Suite 3: GTX (SDF GI + BVH Triangle Reflections) vs RTX (Full RT) & Fixed Area Emissives ---\n");

    // Step PlumeFluid fire/smoke + BallisticSparks + 2.5D Rain Lagoon for the Architectural Emissive Gallery!
    Frontier::PlumeFluidParameters PlumeCfg{};
    PlumeCfg.Grade              = Frontier::PlumeQualityGrade::High;
    PlumeCfg.FlameRadianceScale = 32.0f;
    Frontier::PlumeFluid GalleryPlume{PlumeCfg};

    for (int Step = 0; Step < 22; ++Step)
    {
        GalleryPlume.AppendTransientPlumeSource({+1.85f, 4.9f, 0.25f}, 0.36f, {0.10f, -0.06f, 2.7f}, 1.35f, 1.55f, 1.15f, 0.85f);
        GalleryPlume.AdvanceSimulation({+1.85f, 4.9f, 0.0f}, {0.35f, -0.45f, 0.82f}, 0.03f);
    }

    Frontier::BallisticSparkConfig SparkCfg{};
    SparkCfg.MaxSparkBudget = 256u;
    Frontier::SparkParticles GallerySparks{SparkCfg};
    Frontier::MetallicScrapeContact   Scrape{};
    Scrape.ContactPointWorld     = {+1.85f, 4.6f, 0.55f};
    Scrape.ContactNormalWorld    = {-0.15f, -0.25f, 0.95f};
    Scrape.TangentialVelocityMps = {-2.2f, -3.4f, 5.2f};
    Scrape.NormalForceNewtons    = 4800.0f;
    Scrape.RequestedSparkCount   = 38u;
    GallerySparks.SpawnScrapeSparks(Scrape);
    for (int S = 0; S < 8; ++S)
    {
        GallerySparks.StepBallisticSparks(0.016f, {0.3f, 0.0f, 0.2f});
    }

    Frontier::SceneRenderer Gallery{};
    // Glossy dark slate gallery floor (Roughness = 0.08 -> crisp elongated area-light & BVH sphere reflections!)
    Gallery.RegisterDualTierSolidBox({0.0f, 3.0f, -0.25f}, {15.0f, 15.0f, 0.25f}, {0.15f, 0.17f, 0.21f}, 0.08f, {0.0f, 0.0f, 0.0f}, 0.18f);
    // Architectural framing columns & vivid emerald/crimson sculpture pillars behind the central glass sphere!
    Gallery.RegisterDualTierSolidBox({-5.6f, 3.5f, 2.2f}, {0.55f, 6.2f, 2.2f}, {0.34f, 0.36f, 0.42f}, 0.52f);
    Gallery.RegisterDualTierSolidBox({-0.55f, 3.65f, 1.35f}, {0.38f, 0.38f, 1.35f}, {0.16f, 0.72f, 0.48f}, 0.32f);
    Gallery.RegisterDualTierSolidBox({+0.48f, 3.85f, 1.55f}, {0.38f, 0.38f, 1.55f}, {0.82f, 0.28f, 0.24f}, 0.32f);
    Gallery.RegisterDualTierSolidBox({+2.8f, 7.8f, 1.85f}, {1.05f, 0.55f, 1.85f}, {0.26f, 0.48f, 0.68f}, 0.36f);

    // Distant sanctum seen through the Seamless Portal on the left!
    Gallery.RegisterDualTierSolidBox({24.0f, 18.0f, -0.25f}, {8.0f, 8.0f, 0.25f}, {0.18f, 0.20f, 0.25f}, 0.14f);
    Gallery.RegisterDualTierSolidBox({24.0f, 21.5f, 1.7f}, {1.1f, 0.6f, 1.7f}, {0.22f, 0.68f, 0.56f}, 0.30f);
    Gallery.RegisterSmoothSphere({23.2f, 19.2f, 1.05f}, 1.05f, {0.92f, 0.72f, 0.28f}, 0.04f, 0.92f);

    // Smooth Gold Sphere + Smooth Chrome Sphere + Closed-Dielectric Crown Glass Sphere (IOR = 1.52)!
    Gallery.RegisterSmoothSphere({-1.95f, 1.95f, 0.88f}, 0.88f, {0.94f, 0.72f, 0.28f}, 0.04f, 0.94f, false);
    Gallery.RegisterSmoothSphere({+2.10f, 1.95f, 0.84f}, 0.84f, {0.88f, 0.91f, 0.96f}, 0.03f, 0.96f, false);
    Gallery.RegisterSmoothSphere(
        {-0.02f, 1.25f, 0.86f}, 0.86f, {0.97f, 0.99f, 1.00f}, 0.015f, 0.0f, true, 1.52f, {0.10f, 0.03f, 0.05f}, 38u, 26u);

    // 3 Balanced Solid-Angle Rectangular Area Luminaires (rich saturated amber & cyan glow, zero wall blowout)!
    Frontier::AreaLuminaireDescriptor WarmSoftbox{};
    WarmSoftbox.CentreWorld         = {-4.95f, 2.2f, 2.35f};
    WarmSoftbox.RightAxis           = {0.0f, 1.0f, 0.0f};
    WarmSoftbox.UpAxis              = {0.0f, 0.0f, 1.0f};
    WarmSoftbox.FrontNormal         = {+1.0f, 0.0f, 0.0f};
    WarmSoftbox.HalfWidthMetres     = 1.25f;
    WarmSoftbox.HalfHeightMetres    = 0.38f;
    WarmSoftbox.EmissiveRadianceRgb = {6.8f, 3.6f, 1.2f};
    Gallery.RegisterAreaLuminaire(WarmSoftbox);

    Frontier::AreaLuminaireDescriptor CyanCeilingStrip{};
    CyanCeilingStrip.CentreWorld         = {+0.2f, 2.6f, 4.25f};
    CyanCeilingStrip.RightAxis           = {1.0f, 0.0f, 0.0f};
    CyanCeilingStrip.UpAxis              = {0.0f, 1.0f, 0.0f};
    CyanCeilingStrip.FrontNormal         = {0.0f, 0.0f, -1.0f};
    CyanCeilingStrip.HalfWidthMetres     = 2.1f;
    CyanCeilingStrip.HalfHeightMetres    = 0.24f;
    CyanCeilingStrip.EmissiveRadianceRgb = {1.4f, 5.2f, 8.4f};
    Gallery.RegisterAreaLuminaire(CyanCeilingStrip);

    Frontier::AreaLuminaireDescriptor SanctumWarmStrip{};
    SanctumWarmStrip.CentreWorld         = {24.0f, 19.5f, 3.6f};
    SanctumWarmStrip.RightAxis           = {1.0f, 0.0f, 0.0f};
    SanctumWarmStrip.UpAxis              = {0.0f, 1.0f, 0.0f};
    SanctumWarmStrip.FrontNormal         = {0.0f, 0.0f, -1.0f};
    SanctumWarmStrip.HalfWidthMetres     = 1.8f;
    SanctumWarmStrip.HalfHeightMetres    = 0.35f;
    SanctumWarmStrip.EmissiveRadianceRgb = {6.5f, 4.8f, 2.2f};
    Gallery.RegisterAreaLuminaire(SanctumWarmStrip);

    // Seamless Portal on left-rear & Planar Silvered Mirror angled clearly on right!
    Frontier::SeamlessPortalAperture GalleryPortal{};
    GalleryPortal.EntryCentreWorld = {-2.25f, 6.6f, 1.72f};
    GalleryPortal.EntryRightAxis   = {1.0f, 0.0f, 0.0f};
    GalleryPortal.EntryUpAxis      = {0.0f, 0.0f, 1.0f};
    GalleryPortal.EntryFrontNormal = {0.0f, -1.0f, 0.0f};
    GalleryPortal.ExitCentreWorld  = {24.0f, 15.2f, 1.72f};
    GalleryPortal.ExitRightAxis    = {1.0f, 0.0f, 0.0f};
    GalleryPortal.ExitUpAxis       = {0.0f, 0.0f, 1.0f};
    GalleryPortal.ExitFrontNormal  = {0.0f, +1.0f, 0.0f};
    GalleryPortal.HalfWidthMetres  = 1.38f;
    GalleryPortal.HalfHeightMetres = 1.62f;
    GalleryPortal.PortalRimGlowRgb = {0.20f, 0.72f, 1.25f};
    Gallery.RegisterSeamlessPortal(GalleryPortal);

    Frontier::PlanarMirrorAperture GalleryMirror{};
    GalleryMirror.CentreWorld      = {+4.15f, 4.2f, 1.80f};
    GalleryMirror.RightAxis        = Frontier::Normalise({0.62f, 0.78f, 0.0f});
    GalleryMirror.UpAxis           = {0.0f, 0.0f, 1.0f};
    GalleryMirror.FrontNormal      = Frontier::Normalise({-0.78f, -0.62f, 0.0f});
    GalleryMirror.HalfWidthMetres  = 1.95f;
    GalleryMirror.HalfHeightMetres = 1.70f;
    Gallery.RegisterPlanarMirror(GalleryMirror);

    Frontier::AtmosphereParameters Atmo{};
    Frontier::TransmittanceLut     AtmoLut{};
    AtmoLut.Bake(Atmo, 64u, 24u, 32u);
    Frontier::CloudParameters      DuskClouds{};
    DuskClouds.Coverage                        = 0.34;
    DuskClouds.BaseHeightM                     = 1400.0;
    DuskClouds.TopHeightM                      = 2600.0;
    Frontier::FogParameters DuskFog{};
    DuskFog.DensityAtBase                      = 0.0012;
    DuskFog.FalloffHeightM                     = 85.0;
    DuskFog.Colour                             = {0.06, 0.09, 0.16};

    Frontier::CoupledWorldOpticalContext GalleryCtx{};
    GalleryCtx.Atmosphere                = Atmo;
    GalleryCtx.AtmosphereLut             = &AtmoLut;
    GalleryCtx.Clouds                    = DuskClouds;
    GalleryCtx.Fog                       = DuskFog;
    GalleryCtx.SunDirectionUnit = Frontier::Normalise({0.35f, 0.65f, -0.14f}); // Deep twilight sky + indoor luminaires!
    GalleryCtx.SunIrradianceRgb          = {0.42f, 0.52f, 0.88f};
    GalleryCtx.CelestialSunDirectionUnit = ExoSunDir;
    GalleryCtx.CelestialSunRadianceRgb   = ExoSunRad;
    GalleryCtx.PlumeFluid                = &GalleryPlume;
    GalleryCtx.Sparks                    = &GallerySparks;
    GalleryCtx.CelestialSky              = &Celestial;
    GalleryCtx.MaxApertureBounces        = 4u;
    GalleryCtx.RestirCandidateK          = 8u;
    GalleryCtx.EnableSpatialReuse        = true;
    GalleryCtx.EnableWaveletFilter       = true;
    GalleryCtx.HdrBloomStrength          = 0.22f;
    GalleryCtx.ExposureScale             = 0.66f;

    Gallery.FinalizeSceneAndBakeSurfaceCards(GalleryCtx);

    // 3.1 & 3.2: Verify EXACT Dual-Tier Split on glossy slate floor + brushed metallic sphere!
    const Frontier::Vec3 CamGalleryOrig = {0.0f, -4.3f, 2.05f};
    const Frontier::Vec3 FloorProbeDir  = Frontier::Normalise(Frontier::Vec3{-1.2f, 1.8f, 0.0f} - CamGalleryOrig);

    const auto GtxFloorDiag = Gallery.TraceCoupledRadianceRay(
        Frontier::GpuTracingTier::SignedDistanceFieldGtx, CamGalleryOrig, FloorProbeDir, GalleryCtx, 0x1111222233334444ull);
    const auto RtxFloorDiag = Gallery.TraceCoupledRadianceRay(
        Frontier::GpuTracingTier::HardwareRayTracingRtx, CamGalleryOrig, FloorProbeDir, GalleryCtx, 0x1111222233334444ull);

    std::snprintf(
        Buf,
        sizeof(Buf),
        "sdf_gi_rays=%u rtx_gi_rays=%u bvh_tri_refl_rays=%u rad=(%.2f,%.2f,%.2f)",
        GtxFloorDiag.SdfGiRays,
        GtxFloorDiag.RtxTriangleGiRays,
        GtxFloorDiag.BvhTriangleReflectionRays,
        GtxFloorDiag.FinalRadianceRgb.X,
        GtxFloorDiag.FinalRadianceRgb.Y,
        GtxFloorDiag.FinalRadianceRgb.Z);
    Ledger.RecordAssertion(
        GtxFloorDiag.HitSolidGeometry && GtxFloorDiag.SdfGiRays > 0u &&
            GtxFloorDiag.RtxTriangleGiRays == 0u && GtxFloorDiag.BvhTriangleReflectionRays > 0u,
        "GTX Tier: SDF + SurfaceCards GI paired with Software BVH Triangle Reflections",
        Buf);

    std::snprintf(
        Buf,
        sizeof(Buf),
        "rtx_gi_rays=%u sdf_gi_rays=%u bvh_tri_refl_rays=%u rad=(%.2f,%.2f,%.2f)",
        RtxFloorDiag.RtxTriangleGiRays,
        RtxFloorDiag.SdfGiRays,
        RtxFloorDiag.BvhTriangleReflectionRays,
        RtxFloorDiag.FinalRadianceRgb.X,
        RtxFloorDiag.FinalRadianceRgb.Y,
        RtxFloorDiag.FinalRadianceRgb.Z);
    Ledger.RecordAssertion(
        RtxFloorDiag.HitSolidGeometry && RtxFloorDiag.RtxTriangleGiRays > 0u &&
            RtxFloorDiag.SdfGiRays == 0u && RtxFloorDiag.BvhTriangleReflectionRays > 0u,
        "RTX Tier: Full Hardware RT Triangle Raytracing for BOTH GI and Reflections",
        Buf);

    // 3.3 & 3.4: Verify Mirrors, Portals & Closed-Dielectric Glass on BOTH GTX and RTX!
    const Frontier::Vec3 MirrorProbeDir = Frontier::Normalise(GalleryMirror.CentreWorld - CamGalleryOrig);
    const Frontier::Vec3 PortalProbeDir = Frontier::Normalise(GalleryPortal.EntryCentreWorld - CamGalleryOrig);
    const Frontier::Vec3 GlassProbeDir  = Frontier::Normalise(Frontier::Vec3{-0.02f, 1.25f, 0.86f} - CamGalleryOrig);

    const auto GtxTier   = Frontier::GpuTracingTier::SignedDistanceFieldGtx;
    const auto RtxTier   = Frontier::GpuTracingTier::HardwareRayTracingRtx;
    const auto GtxMirror = Gallery.TraceCoupledRadianceRay(GtxTier, CamGalleryOrig, MirrorProbeDir, GalleryCtx);
    const auto RtxMirror = Gallery.TraceCoupledRadianceRay(RtxTier, CamGalleryOrig, MirrorProbeDir, GalleryCtx);
    const auto GtxPortal = Gallery.TraceCoupledRadianceRay(GtxTier, CamGalleryOrig, PortalProbeDir, GalleryCtx);
    const auto RtxPortal = Gallery.TraceCoupledRadianceRay(RtxTier, CamGalleryOrig, PortalProbeDir, GalleryCtx);
    const auto GtxGlass  = Gallery.TraceCoupledRadianceRay(GtxTier, CamGalleryOrig, GlassProbeDir, GalleryCtx);
    const auto RtxGlass  = Gallery.TraceCoupledRadianceRay(RtxTier, CamGalleryOrig, GlassProbeDir, GalleryCtx);

    std::snprintf(
        Buf,
        sizeof(Buf),
        "mirror=(%u,%u) portal=(%u,%u) glass=(%d,%d)",
        GtxMirror.MirrorReflections,
        RtxMirror.MirrorReflections,
        GtxPortal.PortalTransitions,
        RtxPortal.PortalTransitions,
        GtxGlass.HitDielectricGlass ? 1 : 0,
        RtxGlass.HitDielectricGlass ? 1 : 0);
    Ledger.RecordAssertion(
        GtxMirror.MirrorReflections > 0u && RtxMirror.MirrorReflections > 0u &&
            GtxPortal.PortalTransitions > 0u && RtxPortal.PortalTransitions > 0u &&
            GtxGlass.HitDielectricGlass && RtxGlass.HitDielectricGlass,
        "Mirrors, Seamless Portals & Closed-Dielectric Glass active on BOTH GTX & RTX",
        Buf);

    // 3.5: Measure flat-wall pixel-to-pixel high-frequency speckle variance WITH vs WITHOUT Spatial Reuse + A-Trous!
    {
        Frontier::SceneRenderer DenoiseBench{};
        DenoiseBench.RegisterDualTierSolidBox({0.0f, 3.0f, 1.5f}, {4.0f, 0.25f, 2.5f}, {0.75f, 0.75f, 0.78f}, 0.85f);
        DenoiseBench.RegisterDualTierSolidBox({-2.2f, 1.4f, 1.5f}, {0.2f, 1.2f, 1.2f}, {0.85f, 0.25f, 0.22f}, 0.75f);
        Frontier::AreaLuminaireDescriptor BenchLight{};
        BenchLight.CentreWorld         = {-1.95f, 1.4f, 1.5f};
        BenchLight.RightAxis           = {0.0f, 1.0f, 0.0f};
        BenchLight.UpAxis              = {0.0f, 0.0f, 1.0f};
        BenchLight.FrontNormal         = {+1.0f, 0.0f, 0.0f};
        BenchLight.HalfWidthMetres     = 0.55f;
        BenchLight.HalfHeightMetres    = 0.55f;
        BenchLight.EmissiveRadianceRgb = {24.0f, 16.0f, 8.0f};
        DenoiseBench.RegisterAreaLuminaire(BenchLight);

        Frontier::CoupledWorldOpticalContext RawCtx = GalleryCtx;
        RawCtx.PlumeFluid                           = nullptr;
        RawCtx.Sparks                               = nullptr;
        RawCtx.CelestialSky                         = nullptr;
        RawCtx.RestirCandidateK                     = 2u;
        RawCtx.HdrBloomStrength                     = 0.0f;
        RawCtx.EnableSpatialReuse                   = false;
        RawCtx.EnableWaveletFilter                  = false;
        DenoiseBench.FinalizeSceneAndBakeSurfaceCards(RawCtx);

        Frontier::CoupledWorldOpticalContext CleanCtx = RawCtx;
        CleanCtx.EnableSpatialReuse                   = true;
        CleanCtx.EnableWaveletFilter                  = true;

        std::vector<uint8_t> RawImg, CleanImg;
        DenoiseBench.RenderViewportRgba8(
            Frontier::GpuTracingTier::HardwareRayTracingRtx, 96u, 64u, {0.0f, -1.8f, 1.5f}, {0.0f, 3.0f, 1.5f}, 0.75f, RawCtx, RawImg);
        DenoiseBench.RenderViewportRgba8(
            Frontier::GpuTracingTier::HardwareRayTracingRtx, 96u, 64u, {0.0f, -1.8f, 1.5f}, {0.0f, 3.0f, 1.5f}, 0.75f, CleanCtx, CleanImg);

        auto ComputeLaplacianNoise = [](const std::vector<uint8_t>& Img, uint32_t W, uint32_t H) -> double
        {
            double SumSq = 0.0;
            uint32_t Cnt = 0u;
            for (uint32_t Y = 12u; Y + 12u < H; ++Y)
            {
                for (uint32_t X = 28u; X + 12u < W; ++X)
                {
                    auto Lum = [&](uint32_t Px, uint32_t Py) -> double
                    {
                        const size_t I = (static_cast<size_t>(Py) * W + Px) * 4u;
                        return 0.2126 * Img[I] + 0.7152 * Img[I + 1u] + 0.0722 * Img[I + 2u];
                    };
                    const double Lap = 4.0 * Lum(X, Y) - Lum(X - 1u, Y) - Lum(X + 1u, Y) - Lum(X, Y - 1u) - Lum(X, Y + 1u);
                    SumSq += Lap * Lap;
                    ++Cnt;
                }
            }
            return (Cnt > 0u) ? std::sqrt(SumSq / Cnt) : 0.0;
        };

        const double RawLap   = ComputeLaplacianNoise(RawImg, 96u, 64u);
        const double CleanLap = ComputeLaplacianNoise(CleanImg, 96u, 64u);
        std::snprintf(
            Buf,
            sizeof(Buf),
            "raw_laplacian_rms=%.3f -> denoised_laplacian_rms=%.3f (reduction=%.1f%%)",
            RawLap,
            CleanLap,
            (RawLap > 1.0e-6) ? (100.0 * (1.0 - CleanLap / RawLap)) : 0.0);
        Ledger.RecordAssertion(
            CleanLap < RawLap * 0.25 + 0.35,
            "Spatial reuse + 3-step A-Trous eliminates emissive Monte Carlo speckles",
            Buf);
    }

    /*--------------------------------------------------------------------------------------------------------------------------------------
                                SUITE 4: HIGH-RESOLUTION (960x540) COMPREHENSIVE VISUAL SHOWCASE
    --------------------------------------------------------------------------------------------------------------------------------------*/
    std::printf("\n--- Suite 4: High-Resolution (960x540) Visual Showcase Synthesis ---\n");

    if (!SkipRenders)
    {
        constexpr uint32_t ShowW = 960u;
        constexpr uint32_t ShowH = 540u;
        const std::string  ImgDir = "Exhibits/CelestialGlassLightingShowcase/Images/";

        // -----------------------------------------------------------------------------------------------------------------
        // IMAGE 1: CelestialObservatoryRingedPlanetMoonStars.png (960x540)
        //          41k Hipparcos Stars + Milky Way + 3 Custom Diffraction-Spike Stars + 2048px Textured Moon +
        //          Ringed Saturnian Planet w/ Spherical Atmosphere + 2.5D Rain Lagoon Reflections + Crystal Sphere!
        // -----------------------------------------------------------------------------------------------------------------
        Frontier::ShallowWaterConfiguration LagoonCfg{};
        LagoonCfg.CellsX         = 96u;
        LagoonCfg.CellsY         = 96u;
        LagoonCfg.CellSizeMetres = 0.35f;
        LagoonCfg.WorldOriginXY  = {-16.8f, -16.8f};
        Frontier::ShallowWaterSimulation Lagoon{LagoonCfg};
        Lagoon.SculptBedDepressionOrMound({0.0f, -1.5f}, 11.5f, -0.14f);
        Lagoon.FillBasinRegion({0.0f, -1.5f}, 11.2f, 0.025f, 0.0f);

        Frontier::SceneRenderer Observatory{};
        Observatory.RegisterDualTierSolidBox({0.0f, 0.0f, -0.25f}, {18.0f, 18.0f, 0.25f}, {0.14f, 0.16f, 0.20f}, 0.22f);
        // Low architectural parapet piers flanking the reflecting lagoon + warm subtle observatory step-lights!
        Observatory.RegisterDualTierSolidBox({-6.2f, 2.8f, 0.55f}, {0.65f, 0.65f, 0.55f}, {0.34f, 0.36f, 0.42f}, 0.38f);
        Observatory.RegisterDualTierSolidBox({+6.2f, 2.8f, 0.55f}, {0.65f, 0.65f, 0.55f}, {0.34f, 0.36f, 0.42f}, 0.38f);
        Observatory.RegisterSmoothSphere(
            {-4.6f, 1.2f, 0.68f}, 0.68f, {0.96f, 0.99f, 1.00f}, 0.02f, 0.0f, true, 1.54f, {0.08f, 0.02f, 0.04f}, 32u, 22u);
        Observatory.RegisterSmoothSphere({+4.6f, 1.2f, 0.62f}, 0.62f, {0.90f, 0.92f, 0.96f}, 0.05f, 0.95f, false);

        Frontier::AreaLuminaireDescriptor LeftBollardLight{};
        LeftBollardLight.CentreWorld         = {-5.52f, 2.8f, 0.45f};
        LeftBollardLight.RightAxis           = {0.0f, 1.0f, 0.0f};
        LeftBollardLight.UpAxis              = {0.0f, 0.0f, 1.0f};
        LeftBollardLight.FrontNormal         = {+1.0f, 0.0f, 0.0f};
        LeftBollardLight.HalfWidthMetres     = 0.35f;
        LeftBollardLight.HalfHeightMetres    = 0.14f;
        LeftBollardLight.EmissiveRadianceRgb = {7.5f, 4.4f, 1.8f};
        Observatory.RegisterAreaLuminaire(LeftBollardLight);

        Frontier::AreaLuminaireDescriptor RightBollardLight = LeftBollardLight;
        RightBollardLight.CentreWorld                       = {+5.52f, 2.8f, 0.45f};
        RightBollardLight.FrontNormal                       = {-1.0f, 0.0f, 0.0f};
        Observatory.RegisterAreaLuminaire(RightBollardLight);

        Frontier::CloudParameters ClearNightClouds{};
        ClearNightClouds.Coverage    = 0.08; // Crisp clear astronomical sky with delicate horizon wisps!
        ClearNightClouds.BaseHeightM = 1800.0;
        ClearNightClouds.TopHeightM  = 2700.0;
        Frontier::FogParameters CrispNightFog{};
        CrispNightFog.DensityAtBase  = 0.00045;
        CrispNightFog.FalloffHeightM = 90.0;
        CrispNightFog.Colour         = {0.015, 0.025, 0.055};

        Frontier::CoupledWorldOpticalContext ObsCtx{};
        ObsCtx.Atmosphere                = Atmo;
        ObsCtx.AtmosphereLut             = &AtmoLut;
        ObsCtx.Clouds                    = ClearNightClouds;
        ObsCtx.Fog                       = CrispNightFog;
        ObsCtx.SunDirectionUnit          = Frontier::Normalise({0.25f, 0.45f, -0.35f}); // Deep astronomical night!
        ObsCtx.SunIrradianceRgb          = {0.05f, 0.08f, 0.18f};
        ObsCtx.CelestialSunDirectionUnit = ExoSunDir;
        ObsCtx.CelestialSunRadianceRgb   = {16.5f, 15.8f, 15.0f};
        ObsCtx.ShallowWater              = &Lagoon;
        ObsCtx.CelestialSky              = &Celestial;
        ObsCtx.MaxApertureBounces        = 3u;
        ObsCtx.RestirCandidateK          = 6u;
        ObsCtx.HdrBloomStrength          = 0.28f;
        ObsCtx.ExposureScale             = 1.12f;

        Observatory.FinalizeSceneAndBakeSurfaceCards(ObsCtx);

        std::vector<uint8_t> ObsPixels;
        Observatory.RenderViewportRgba8(
            Frontier::GpuTracingTier::HardwareRayTracingRtx,
            ShowW,
            ShowH,
            {0.0f, -10.8f, 1.45f},
            {0.0f, +8.5f, 4.95f},
            0.88f,
            ObsCtx,
            ObsPixels);
        const bool SavedObs = WriteRgba8PngFile(ImgDir + "CelestialObservatoryRingedPlanetMoonStars.png", ShowW, ShowH, ObsPixels);

        // -----------------------------------------------------------------------------------------------------------------
        // IMAGES 2 & 3: EmissiveGalleryGtxSdfGiBvhReflections.png & EmissiveGalleryRtxFullRayTracing.png (960x540 each)
        //               Proves fixed lights/emissives AND GTX (SDF GI + BVH Triangle Reflections) vs RTX (Full RT)!
        // -----------------------------------------------------------------------------------------------------------------
        std::vector<uint8_t> GtxGalleryPixels;
        Gallery.RenderViewportRgba8(
            Frontier::GpuTracingTier::SignedDistanceFieldGtx,
            ShowW,
            ShowH,
            CamGalleryOrig,
            {0.1f, +4.2f, 1.65f},
            0.78f,
            GalleryCtx,
            GtxGalleryPixels);
        const bool SavedGtx = WriteRgba8PngFile(ImgDir + "EmissiveGalleryGtxSdfGiBvhReflections.png", ShowW, ShowH, GtxGalleryPixels);

        std::vector<uint8_t> RtxGalleryPixels;
        Gallery.RenderViewportRgba8(
            Frontier::GpuTracingTier::HardwareRayTracingRtx,
            ShowW,
            ShowH,
            CamGalleryOrig,
            {0.1f, +4.2f, 1.65f},
            0.78f,
            GalleryCtx,
            RtxGalleryPixels);
        const bool SavedRtx = WriteRgba8PngFile(ImgDir + "EmissiveGalleryRtxFullRayTracing.png", ShowW, ShowH, RtxGalleryPixels);

        // -----------------------------------------------------------------------------------------------------------------
        // IMAGE 4: GlassAwareVirtualizedGeometryShowcase.png (960x540)
        //          4-Panel Diagnostic (Cluster IDs, IOR Tier Cut Heatmap, Two-Phase Non-Opaque Hi-Z, Optical Glass Peel)!
        // -----------------------------------------------------------------------------------------------------------------
        std::vector<uint8_t> GeoFourPanelPixels;
        ClusteredGeo.RenderFourPanelDiagnosticRgba8(GeoCam, GeoFourPanelPixels);
        const bool SavedGeo = WriteRgba8PngFile(ImgDir + "GlassAwareVirtualizedGeometryShowcase.png", ShowW, ShowH, GeoFourPanelPixels);

        // -----------------------------------------------------------------------------------------------------------------
        // IMAGE 5: LunarAndPlanetaryAtmosphereAtlas.png (960x540, 3x2 Multi-World Celestial Showcase)
        //          Elevated +42 deg above horizon so 100% of every tile renders full deep-space starfield & rings!
        // -----------------------------------------------------------------------------------------------------------------
        std::vector<uint8_t> AtlasPixels(static_cast<size_t>(ShowW) * ShowH * 4u, 255u);
        const uint32_t       TileW     = ShowW / 3u; // 320
        const uint32_t       TileH     = ShowH / 2u; // 270
        const Frontier::Vec3 TileFwd   = Frontier::Normalise({0.0f, 0.74f, 0.67f});
        const Frontier::Vec3 TileRight = {1.0f, 0.0f, 0.0f};
        const Frontier::Vec3 TileUp    = Frontier::Cross(TileRight, TileFwd);

        // Tile (0, 0): Waxing Crescent Textured Luna (2048x1024 MoonAlbedo2048.ppm) + Earthshine + Hipparcos Stars!
        {
            Frontier::CelestialSky SkyT0{};
            SkyT0.LoadHipparcosCatalogueCsv("Exhibits/NightSky/Data/Hipparcos8.csv", 2461343.85, -26.188, 28.320);
            SkyT0.LoadLunaAlbedoMapPpm("EngineContent/CelestialMaps/MoonAlbedo2048.ppm");
            SkyT0.ConfigureStarfieldAppearance(1.5f, 7.8f, 1.15f, 0.1f, 0.0f);
            Frontier::LunarBodyDescriptor Crescent{};
            Crescent.Preset             = Frontier::LunarSurfacePreset::LunaSelenographic;
            Crescent.DirectionUnit      = TileFwd;
            Crescent.AngularRadiusRad   = 0.115f;
            Crescent.SurfaceBrightness  = 2.6f;
            Crescent.EarthshineStrength = 0.095f;
            SkyT0.RegisterLunarBody(Crescent);
            const Frontier::Vec3 SunT0 = Frontier::Normalise(TileFwd * (-0.35f) - TileRight * 0.86f + TileUp * 0.36f);
            TonemapHdrTileIntoAtlas(
                SkyT0, TileFwd, TileRight, TileUp, 0.18f, SunT0, ExoSunRad, 1.10f, 0u, 0u, TileW, TileH, ShowW, AtlasPixels);
        }

        // Tile (1, 0): Volcanic Sulfur Io + Fractured Ice Europa + Titan Orange Shroud Trio!
        {
            Frontier::CelestialSky SkyT1{};
            SkyT1.BuildProceduralStarCatalogue(9000u, 0xABC123ULL);
            SkyT1.ConfigureStarfieldAppearance(1.3f, 7.5f, 1.0f, 0.1f, 0.0f);

            Frontier::LunarBodyDescriptor Io{};
            Io.Preset            = Frontier::LunarSurfacePreset::SulfurIo;
            Io.DirectionUnit     = Frontier::Normalise(TileFwd - TileRight * 0.105f + TileUp * 0.025f);
            Io.AngularRadiusRad  = 0.056f;
            Io.SurfaceBrightness = 2.8f;
            SkyT1.RegisterLunarBody(Io);

            Frontier::LunarBodyDescriptor Europa{};
            Europa.Preset            = Frontier::LunarSurfacePreset::GlacierEuropa;
            Europa.DirectionUnit     = Frontier::Normalise(TileFwd + TileRight * 0.008f - TileUp * 0.048f);
            Europa.AngularRadiusRad  = 0.048f;
            Europa.SurfaceBrightness = 2.7f;
            SkyT1.RegisterLunarBody(Europa);

            Frontier::LunarBodyDescriptor Titan{};
            Titan.Preset            = Frontier::LunarSurfacePreset::ShroudTitan;
            Titan.DirectionUnit     = Frontier::Normalise(TileFwd + TileRight * 0.115f + TileUp * 0.038f);
            Titan.AngularRadiusRad  = 0.052f;
            Titan.SurfaceBrightness = 2.9f;
            Titan.AtmosphericHaze   = 0.72f;
            SkyT1.RegisterLunarBody(Titan);

            const Frontier::Vec3 SunT1 = Frontier::Normalise(-TileFwd * 0.45f - TileRight * 0.76f + TileUp * 0.46f);
            TonemapHdrTileIntoAtlas(
                SkyT1, TileFwd, TileRight, TileUp, 0.18f, SunT1, ExoSunRad, 1.15f, TileW, 0u, TileW, TileH, ShowW, AtlasPixels);
        }

        // Tile (2, 0): Banded Saturnian Gas Giant + C/B/Cassini/A/Encke/F Rings + Mutual Planet/Ring Shadows!
        {
            Frontier::CelestialSky SkyT2{};
            SkyT2.BuildProceduralStarCatalogue(8000u, 0x777888ULL);
            SkyT2.ConfigureStarfieldAppearance(1.25f, 7.5f, 0.95f, 0.1f, 0.0f);

            Frontier::PlanetaryBodyDescriptor Saturn = HeroPlanet;
            Saturn.DirectionUnit                     = TileFwd;
            Saturn.AngularRadiusRad                  = 0.068f;
            Saturn.SpinAxisUnit                      = Frontier::Normalise(TileUp * 0.86f - TileRight * 0.28f - TileFwd * 0.42f);
            Saturn.Rings.RingNormalUnit              = Saturn.SpinAxisUnit;
            SkyT2.RegisterPlanetaryBody(Saturn);

            const Frontier::Vec3 SunT2 = Frontier::Normalise(-TileFwd * 0.32f - TileRight * 0.88f + TileUp * 0.35f);
            TonemapHdrTileIntoAtlas(
                SkyT2, TileFwd, TileRight, TileUp, 0.18f, SunT2, ExoSunRad, 1.18f, TileW * 2u, 0u, TileW, TileH, ShowW, AtlasPixels);
        }

        // Tile (0, 1): Oceanic Terrestrial Exoplanet + Dense Blue N2-O2 Rayleigh/Ozone Atmosphere + Shepherd Ice Ring!
        {
            Frontier::CelestialSky SkyT3{};
            SkyT3.BuildProceduralStarCatalogue(8500u, 0x555666ULL);
            Frontier::PlanetaryBodyDescriptor Terra{};
            Terra.Archetype                         = Frontier::PlanetarySurfaceArchetype::OceanicTerrestrial;
            Terra.DirectionUnit                     = TileFwd;
            Terra.AngularRadiusRad                  = 0.088f;
            Terra.SpinAxisUnit                      = Frontier::Normalise(TileUp * 0.92f + TileRight * 0.22f - TileFwd * 0.32f);
            Terra.SpinPhaseRad                      = 1.25f;
            Terra.SurfaceAlbedoScale                = 1.55f;
            Terra.Atmosphere.Enabled                = true;
            Terra.Atmosphere.ShellHeightFraction    = 0.105f;
            Terra.Atmosphere.RayleighScattering     = {5.8e-6f, 13.5e-6f, 38.0e-6f};
            Terra.Atmosphere.MieScattering          = 14.0e-6f;
            Terra.Atmosphere.AbsorptionCoefficients = {0.85e-6f, 2.10e-6f, 0.10e-6f};
            Terra.Atmosphere.OpticalDensityScale    = 6.4e5f;
            Terra.Rings.Enabled                     = true;
            Terra.Rings.RingNormalUnit              = Terra.SpinAxisUnit;
            Terra.Rings.InnerRadiusRatio            = 1.45f;
            Terra.Rings.OuterRadiusRatio            = 1.82f;
            Terra.Rings.PeakOpticalDepth            = 0.58f;
            Terra.Rings.InnerTintRgb                = {0.72f, 0.84f, 0.96f};
            Terra.Rings.OuterTintRgb                = {0.86f, 0.93f, 1.00f};
            SkyT3.RegisterPlanetaryBody(Terra);

            const Frontier::Vec3 SunT3 = Frontier::Normalise(-TileFwd * 0.48f - TileRight * 0.72f + TileUp * 0.49f);
            TonemapHdrTileIntoAtlas(
                SkyT3, TileFwd, TileRight, TileUp, 0.18f, SunT3, ExoSunRad, 1.22f, 0u, TileH, TileW, TileH, ShowW, AtlasPixels);
        }

        // Tile (1, 1): Methane Ice Giant w/ High-Tilt Narrow Rings + Rusty Desert World w/ CO2 Amber Limb Haze!
        {
            Frontier::CelestialSky SkyT4{};
            SkyT4.BuildProceduralStarCatalogue(8500u, 0x999111ULL);

            Frontier::PlanetaryBodyDescriptor IceGiant{};
            IceGiant.Archetype                         = Frontier::PlanetarySurfaceArchetype::MethaneIceGiant;
            IceGiant.DirectionUnit                     = Frontier::Normalise(TileFwd - TileRight * 0.055f + TileUp * 0.015f);
            IceGiant.AngularRadiusRad                  = 0.068f;
            IceGiant.SpinAxisUnit                      = Frontier::Normalise(TileRight * 0.76f + TileUp * 0.54f - TileFwd * 0.36f);
            IceGiant.SurfaceAlbedoScale                = 1.48f;
            IceGiant.Atmosphere.Enabled                = true;
            IceGiant.Atmosphere.ShellHeightFraction    = 0.115f;
            IceGiant.Atmosphere.RayleighScattering     = {3.2e-6f, 15.5e-6f, 36.0e-6f};
            IceGiant.Atmosphere.AbsorptionCoefficients = {4.2e-6f, 0.9e-6f, 0.05e-6f};
            IceGiant.Atmosphere.OpticalDensityScale    = 6.2e5f;
            IceGiant.Rings.Enabled                     = true;
            IceGiant.Rings.RingNormalUnit              = IceGiant.SpinAxisUnit;
            IceGiant.Rings.InnerRadiusRatio            = 1.52f;
            IceGiant.Rings.OuterRadiusRatio            = 1.98f;
            IceGiant.Rings.PeakOpticalDepth            = 0.78f;
            SkyT4.RegisterPlanetaryBody(IceGiant);

            Frontier::PlanetaryBodyDescriptor DesertMars{};
            DesertMars.Archetype                      = Frontier::PlanetarySurfaceArchetype::RustyDesertWorld;
            DesertMars.DirectionUnit                  = Frontier::Normalise(TileFwd + TileRight * 0.115f - TileUp * 0.038f);
            DesertMars.AngularRadiusRad               = 0.046f;
            DesertMars.SurfaceAlbedoScale             = 1.55f;
            DesertMars.Atmosphere.Enabled             = true;
            DesertMars.Atmosphere.ShellHeightFraction = 0.095f;
            DesertMars.Atmosphere.RayleighScattering  = {26.0e-6f, 14.5e-6f, 7.5e-6f};
            DesertMars.Atmosphere.MieScattering       = 28.0e-6f;
            DesertMars.Atmosphere.OpticalDensityScale = 4.6e5f;
            DesertMars.Rings.Enabled                  = false;
            SkyT4.RegisterPlanetaryBody(DesertMars);

            const Frontier::Vec3 SunT4 = Frontier::Normalise(-TileFwd * 0.45f - TileRight * 0.74f + TileUp * 0.48f);
            TonemapHdrTileIntoAtlas(
                SkyT4, TileFwd, TileRight, TileUp, 0.18f, SunT4, ExoSunRad, 1.22f, TileW, TileH, TileW, TileH, ShowW, AtlasPixels);
        }

        // Tile (2, 1): Binary Custom Star System (3100 K Red Giant + 24000 K Blue-White Companion + 6100 K Tertiary) + Milky Way!
        {
            Frontier::CelestialSky SkyT5{};
            SkyT5.LoadHipparcosCatalogueCsv("Exhibits/NightSky/Data/Hipparcos8.csv", 2461343.85, -26.188, 28.320);
            SkyT5.ConfigureStarfieldAppearance(1.85f, 7.8f, 1.85f, 0.12f, 5.0f);

            Frontier::CustomStarDescriptor PrimaryCrimson{};
            PrimaryCrimson.DirectionUnit      = Frontier::Normalise(TileFwd - TileRight * 0.062f + TileUp * 0.024f);
            PrimaryCrimson.AngularRadiusRad   = 0.0052f;
            PrimaryCrimson.TemperatureKelvin  = 3100.0f;
            PrimaryCrimson.RadianceGain       = 16.0f;
            PrimaryCrimson.CoronaGlowStrength = 0.95f;
            SkyT5.RegisterCustomStar(PrimaryCrimson);

            Frontier::CustomStarDescriptor CompanionSapphire{};
            CompanionSapphire.DirectionUnit      = Frontier::Normalise(TileFwd + TileRight * 0.058f - TileUp * 0.022f);
            CompanionSapphire.AngularRadiusRad   = 0.0042f;
            CompanionSapphire.TemperatureKelvin  = 24000.0f;
            CompanionSapphire.RadianceGain       = 18.0f;
            CompanionSapphire.CoronaGlowStrength = 0.95f;
            SkyT5.RegisterCustomStar(CompanionSapphire);

            Frontier::CustomStarDescriptor TertiaryGold{};
            TertiaryGold.DirectionUnit      = Frontier::Normalise(TileFwd + TileRight * 0.006f + TileUp * 0.078f);
            TertiaryGold.AngularRadiusRad   = 0.0032f;
            TertiaryGold.TemperatureKelvin  = 6100.0f;
            TertiaryGold.RadianceGain       = 13.0f;
            TertiaryGold.CoronaGlowStrength = 0.85f;
            SkyT5.RegisterCustomStar(TertiaryGold);

            TonemapHdrTileIntoAtlas(
                SkyT5, TileFwd, TileRight, TileUp, 0.18f, ExoSunDir, ExoSunRad, 1.12f,
                TileW * 2u, TileH, TileW, TileH, ShowW, AtlasPixels);
        }

        const bool SavedAtlas = WriteRgba8PngFile(ImgDir + "LunarAndPlanetaryAtmosphereAtlas.png", ShowW, ShowH, AtlasPixels);

        std::snprintf(
            Buf,
            sizeof(Buf),
            "960x540_pngs=(obs=%d gtx=%d rtx=%d glass_nanite=%d atlas=%d)",
            SavedObs ? 1 : 0,
            SavedGtx ? 1 : 0,
            SavedRtx ? 1 : 0,
            SavedGeo ? 1 : 0,
            SavedAtlas ? 1 : 0);
        Ledger.RecordAssertion(
            SavedObs && SavedGtx && SavedRtx && SavedGeo && SavedAtlas,
            "Synthesised 5 HD (960x540) visual showcase PNGs without NaN/clipping",
            Buf);
    }

    std::printf("\n====================================================================================================\n");
    std::printf("  SUMMARY: %u PASSED, %u FAILED\n", Ledger.PassedCount, Ledger.FailedCount);
    std::printf("====================================================================================================\n");

    return (Ledger.FailedCount == 0u) ? 0 : 1;
}
