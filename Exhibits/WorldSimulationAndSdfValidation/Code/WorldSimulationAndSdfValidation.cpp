/*==========================================================================================================================================
                                             WORLDSIMULATIONANDSDFVALIDATION.CPP
==========================================================================================================================================*/
// 🧩 End-to-end numerical, sanitizer, and visual validation of Plume collision/shadows/lighting, 2.5D Shallow-Water & Mud,
//    Single-PolygonSurface Snow/Hail + Snow Pit + Melt, Lightning & Thunder, Griffith Fracture + Jolt 5.6.0 Convex Hulls,
//    Swept Scene-Lighting Sparks, Dual-Tier GTX SDF & RTX BVH Portals/Mirrors, and Native Vehicle Cabin/HUD HMI.

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             INCLUDES
------------------------------------------------------------------------------------------------------------------------------------------*/
#include "Engine/Audio/AudioFoundation.h"
#include "Engine/Environment/LightningThunderExtension.h"
#include "Engine/Environment/SnowpackAccumulationExtension.h"
#include "Engine/Environment/WindForceFieldExtension.h"
#include "Engine/Fluid/PlumeFluidExtension.h"
#include "Engine/Fluid/ShallowWaterMudExtension.h"
#include "Engine/Interface/VehicleCabinHmiExtension.h"
#include "Engine/Physics/Fracture/SolidFractureExtension.h"
#include "Engine/Physics/RigidBodySolver.h"
#include "Engine/Physics/Sparks/BallisticSparkExtension.h"
#include "Engine/Rendering/SdfRestirPortalExtension.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
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
            Crc = (Crc >> 1u) ^ (0xEDB88320u & Mask);
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

    // Build raw scanlines with filter-byte 0 per row.
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

    // Wrap in RFC-1950 zlib stream using stored deflate blocks (65,535 B max per block) + Adler-32.
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

    uint32_t AdlerA = 1u;
    uint32_t AdlerB = 0u;
    for (uint8_t Byte : RawScanlines)
    {
        AdlerA = (AdlerA + Byte) % 65521u;
        AdlerB = (AdlerB + AdlerA) % 65521u;
    }
    AppendBigEndian32(ZlibData, (AdlerB << 16u) | AdlerA);

    std::vector<uint8_t> PngBytes = {137u, 80u, 78u, 71u, 13u, 10u, 26u, 10u};
    std::vector<uint8_t> Ihdr;
    AppendBigEndian32(Ihdr, Width);
    AppendBigEndian32(Ihdr, Height);
    Ihdr.push_back(8u); // Bit depth 8
    Ihdr.push_back(6u); // RGBA truecolour with alpha
    Ihdr.push_back(0u);
    Ihdr.push_back(0u);
    Ihdr.push_back(0u);
    AppendPngChunk(PngBytes, "IHDR", Ihdr);
    AppendPngChunk(PngBytes, "IDAT", ZlibData);
    AppendPngChunk(PngBytes, "IEND", {});

    std::ofstream Out(FilePath, std::ios::binary);
    if (!Out)
    {
        return false;
    }
    Out.write(reinterpret_cast<const char*>(PngBytes.data()), static_cast<std::streamsize>(PngBytes.size()));
    return Out.good();
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                         AUTHORED PROJECT-DRIVE FCT1 FACET LOADER & PORTAL TRANSIT ASSEMBLY
------------------------------------------------------------------------------------------------------------------------------------------*/
struct FacetSurfaceBuffer
{
    std::vector<Frontier::Vec3> Positions;
    std::vector<Frontier::Vec3> VertexNormals;
    std::vector<uint32_t>       Indices;
    std::vector<uint32_t>       MaterialFamilies;
    bool                        SmoothShaded = false;
};

bool LoadFacetSurfaceBuffer(const std::string& FilePath, FacetSurfaceBuffer& OutSurface)
{
    std::FILE* File = std::fopen(FilePath.c_str(), "rb");
    if (File == nullptr)
    {
        return false;
    }
    std::fseek(File, 0, SEEK_END);
    const long FileBytes = std::ftell(File);
    std::fseek(File, 0, SEEK_SET);
    if (FileBytes < 48)
    {
        std::fclose(File);
        return false;
    }

    std::vector<uint8_t> Raw(static_cast<size_t>(FileBytes));
    if (std::fread(Raw.data(), 1u, Raw.size(), File) != Raw.size())
    {
        std::fclose(File);
        return false;
    }
    std::fclose(File);

    if (std::memcmp(Raw.data(), "FCT1", 4u) != 0)
    {
        return false;
    }

    uint32_t VertexCount = 0u;
    uint32_t FacetCount  = 0u;
    uint32_t HeaderBits  = 0u;
    std::memcpy(&VertexCount, Raw.data() + 4u, 4u);
    std::memcpy(&FacetCount, Raw.data() + 8u, 4u);
    std::memcpy(&HeaderBits, Raw.data() + 12u, 4u);

    const float*    PosPtr = reinterpret_cast<const float*>(Raw.data() + 48u);
    const uint32_t* IdxPtr = reinterpret_cast<const uint32_t*>(Raw.data() + 48u + static_cast<size_t>(VertexCount) * 12u);
    const uint32_t* FamPtr = IdxPtr + static_cast<size_t>(FacetCount) * 3u;

    OutSurface.Positions.resize(VertexCount);
    for (uint32_t I = 0u; I < VertexCount; ++I)
    {
        OutSurface.Positions[I] = {PosPtr[I * 3u + 0u], PosPtr[I * 3u + 1u], PosPtr[I * 3u + 2u]};
    }
    OutSurface.Indices.assign(IdxPtr, IdxPtr + static_cast<size_t>(FacetCount) * 3u);
    OutSurface.MaterialFamilies.assign(FamPtr, FamPtr + FacetCount);
    OutSurface.VertexNormals.assign(VertexCount, Frontier::Vec3{0.0f, 0.0f, 0.0f});
    OutSurface.SmoothShaded = (HeaderBits & 1u) != 0u;

    if (OutSurface.SmoothShaded)
    {
        const float* CornerPtr = reinterpret_cast<const float*>(FamPtr + FacetCount);
        for (uint32_t F = 0u; F < FacetCount; ++F)
        {
            for (uint32_t C = 0u; C < 3u; ++C)
            {
                const uint32_t V  = OutSurface.Indices[F * 3u + C];
                const float*   Cn = CornerPtr + (F * 9u + C * 3u);
                OutSurface.VertexNormals[V] =
                    OutSurface.VertexNormals[V] + Frontier::Vec3{Cn[0], Cn[1], Cn[2]};
            }
        }
        for (Frontier::Vec3& Nrm : OutSurface.VertexNormals)
        {
            Nrm = Frontier::Normalise(Nrm);
        }
    }
    return true;
}

FacetSurfaceBuffer MirrorLateralSurface(const FacetSurfaceBuffer& Source, float UniformScale)
{
    FacetSurfaceBuffer Out = Source;
    for (size_t I = 0u; I < Out.Positions.size(); ++I)
    {
        Out.Positions[I] = {
            Source.Positions[I].X * UniformScale,
            -Source.Positions[I].Y * UniformScale,
            Source.Positions[I].Z * UniformScale};
        Out.VertexNormals[I] = {
            Source.VertexNormals[I].X,
            -Source.VertexNormals[I].Y,
            Source.VertexNormals[I].Z};
    }
    for (size_t F = 0u; F + 2u < Out.Indices.size(); F += 3u)
    {
        std::swap(Out.Indices[F + 1u], Out.Indices[F + 2u]);
    }
    return Out;
}

void RegisterOrientedBoxColumns(
    Frontier::SdfRestirPortalExtension& Scene,
    Frontier::Vec3                      CentreWorld,
    Frontier::Vec3                      RightAxis,
    Frontier::Vec3                      UpAxis,
    Frontier::Vec3                      FrontNormal,
    Frontier::Vec3                      HalfExtentsRuf,
    Frontier::Vec3                      AlbedoRgb,
    float                               Roughness,
    float                               Metallic,
    Frontier::Vec3                      EmissiveRgb = {0.0f, 0.0f, 0.0f})
{
    auto Pt = [&](float Sr, float Su, float Sf) -> Frontier::Vec3
    {
        return CentreWorld +
               RightAxis * (Sr * HalfExtentsRuf.X) +
               UpAxis * (Su * HalfExtentsRuf.Y) +
               FrontNormal * (Sf * HalfExtentsRuf.Z);
    };

    const Frontier::Vec3 P000 = Pt(-1.0f, -1.0f, -1.0f);
    const Frontier::Vec3 P100 = Pt(+1.0f, -1.0f, -1.0f);
    const Frontier::Vec3 P010 = Pt(-1.0f, +1.0f, -1.0f);
    const Frontier::Vec3 P110 = Pt(+1.0f, +1.0f, -1.0f);
    const Frontier::Vec3 P001 = Pt(-1.0f, -1.0f, +1.0f);
    const Frontier::Vec3 P101 = Pt(+1.0f, -1.0f, +1.0f);
    const Frontier::Vec3 P011 = Pt(-1.0f, +1.0f, +1.0f);
    const Frontier::Vec3 P111 = Pt(+1.0f, +1.0f, +1.0f);

    auto Quad = [&](Frontier::Vec3 A, Frontier::Vec3 B, Frontier::Vec3 C, Frontier::Vec3 D, Frontier::Vec3 Nrm)
    {
        Frontier::RtxSceneTriangle T0{};
        T0.V0          = A;
        T0.V1          = B;
        T0.V2          = C;
        T0.Normal      = Frontier::Normalise(Nrm);
        T0.AlbedoRgb   = AlbedoRgb;
        T0.EmissiveRgb = EmissiveRgb;
        T0.Roughness   = Roughness;
        T0.Metallic    = Metallic;
        Scene.RegisterPolygonTriangle(T0);

        Frontier::RtxSceneTriangle T1 = T0;
        T1.V0                         = A;
        T1.V1                         = C;
        T1.V2                         = D;
        Scene.RegisterPolygonTriangle(T1);
    };

    Quad(P001, P101, P111, P011, FrontNormal);
    Quad(P100, P000, P010, P110, -FrontNormal);
    Quad(P101, P100, P110, P111, RightAxis);
    Quad(P000, P001, P011, P010, -RightAxis);
    Quad(P011, P111, P110, P010, UpAxis);
    Quad(P000, P100, P101, P001, -UpAxis);
}

void RegisterPortalGatewayFrame(
    Frontier::SdfRestirPortalExtension& Scene,
    Frontier::Vec3                      CentreWorld,
    Frontier::Vec3                      RightAxis,
    Frontier::Vec3                      UpAxis,
    Frontier::Vec3                      FrontNormal,
    float                               HalfWidthM,
    float                               HalfHeightM,
    Frontier::Vec3                      GlowTrimRgb)
{
    const float PostHalfW = 0.085f;
    const float PostDepth = 0.075f;
    const Frontier::Vec3 FrameAlbedo{0.16f, 0.18f, 0.22f};

    // Left & right brushed titanium gateway pillars + top lintel (open behind the portal so empty plaza is clearly visible!).
    RegisterOrientedBoxColumns(
        Scene,
        CentreWorld - RightAxis * (HalfWidthM + PostHalfW),
        RightAxis,
        UpAxis,
        FrontNormal,
        {PostHalfW, HalfHeightM + PostHalfW * 2.0f, PostDepth},
        FrameAlbedo,
        0.24f,
        0.82f);
    RegisterOrientedBoxColumns(
        Scene,
        CentreWorld + RightAxis * (HalfWidthM + PostHalfW),
        RightAxis,
        UpAxis,
        FrontNormal,
        {PostHalfW, HalfHeightM + PostHalfW * 2.0f, PostDepth},
        FrameAlbedo,
        0.24f,
        0.82f);
    RegisterOrientedBoxColumns(
        Scene,
        CentreWorld + UpAxis * (HalfHeightM + PostHalfW),
        RightAxis,
        UpAxis,
        FrontNormal,
        {HalfWidthM + PostHalfW * 2.0f, PostHalfW, PostDepth},
        FrameAlbedo,
        0.24f,
        0.82f);

    // Thin inner energy trim strips framing the portal horizon!
    const float TrimW = 0.024f;
    RegisterOrientedBoxColumns(
        Scene,
        CentreWorld - RightAxis * (HalfWidthM + TrimW * 0.5f),
        RightAxis,
        UpAxis,
        FrontNormal,
        {TrimW, HalfHeightM, PostDepth * 1.08f},
        GlowTrimRgb,
        0.15f,
        0.0f,
        GlowTrimRgb * 2.8f);
    RegisterOrientedBoxColumns(
        Scene,
        CentreWorld + RightAxis * (HalfWidthM + TrimW * 0.5f),
        RightAxis,
        UpAxis,
        FrontNormal,
        {TrimW, HalfHeightM, PostDepth * 1.08f},
        GlowTrimRgb,
        0.15f,
        0.0f,
        GlowTrimRgb * 2.8f);
    RegisterOrientedBoxColumns(
        Scene,
        CentreWorld + UpAxis * (HalfHeightM + TrimW * 0.5f),
        RightAxis,
        UpAxis,
        FrontNormal,
        {HalfWidthM + TrimW * 2.0f, TrimW, PostDepth * 1.08f},
        GlowTrimRgb,
        0.15f,
        0.0f,
        GlowTrimRgb * 2.8f);
}

bool RegisterTransitingControlVehicle(
    Frontier::SdfRestirPortalExtension&   Scene,
    const std::string&                    GeometryDir,
    Frontier::Vec3                        VehicleOriginWorld,
    Frontier::Vec3                        VehicleForwardUnit,
    const Frontier::SeamlessPortalAperture& Portal,
    uint32_t&                             OutTotalSourceFacets)
{
    FacetSurfaceBuffer Body{};
    FacetSurfaceBuffer TyreL{};
    FacetSurfaceBuffer RimRaw{};
    if (!LoadFacetSurfaceBuffer(GeometryDir + "/ControlVehicleBody.facet", Body) ||
        !LoadFacetSurfaceBuffer(GeometryDir + "/ControlVehicleTyre.facet", TyreL) ||
        !LoadFacetSurfaceBuffer(GeometryDir + "/ControlVehicleRim.facet", RimRaw))
    {
        return false;
    }

    const float              RimScale = 0.34460f / 0.344818f;
    const FacetSurfaceBuffer TyreR    = MirrorLateralSurface(TyreL, 1.0f);
    FacetSurfaceBuffer       RimL     = RimRaw;
    for (Frontier::Vec3& P : RimL.Positions)
    {
        P = P * RimScale;
    }
    RimL.SmoothShaded           = false;
    FacetSurfaceBuffer RimR     = MirrorLateralSurface(RimRaw, RimScale);
    RimR.SmoothShaded           = false;

    const Frontier::Vec3 Fwd  = Frontier::Normalise(VehicleForwardUnit);
    const Frontier::Vec3 Up   = {0.0f, 0.0f, 1.0f};
    const Frontier::Vec3 Left = Frontier::Normalise(Frontier::Cross(Up, Fwd));

    auto RegisterVehiclePart = [&](const FacetSurfaceBuffer& Part, Frontier::Vec3 LocalOffset, bool ForceHardRim)
    {
        OutTotalSourceFacets += static_cast<uint32_t>(Part.Indices.size() / 3u);
        for (size_t F = 0u; F + 2u < Part.Indices.size(); F += 3u)
        {
            const uint32_t I0  = Part.Indices[F + 0u];
            const uint32_t I1  = Part.Indices[F + 1u];
            const uint32_t I2  = Part.Indices[F + 2u];
            const uint32_t Fam = Part.MaterialFamilies[F / 3u];

            auto ToWorld = [&](Frontier::Vec3 Lp) -> Frontier::Vec3
            {
                const Frontier::Vec3 Shifted = Lp + LocalOffset;
                return VehicleOriginWorld + Fwd * Shifted.X + Left * Shifted.Y + Up * Shifted.Z;
            };
            auto DirToWorld = [&](Frontier::Vec3 Ln) -> Frontier::Vec3
            {
                return Frontier::Normalise(Fwd * Ln.X + Left * Ln.Y + Up * Ln.Z);
            };

            Frontier::RtxSceneTriangle Tri{};
            Tri.V0 = ToWorld(Part.Positions[I0]);
            Tri.V1 = ToWorld(Part.Positions[I1]);
            Tri.V2 = ToWorld(Part.Positions[I2]);

            const Frontier::Vec3 EdgeN = Frontier::Cross(Tri.V1 - Tri.V0, Tri.V2 - Tri.V0);
            if (Frontier::Length(EdgeN) <= 1.0e-7f)
            {
                continue;
            }
            Tri.Normal              = Frontier::Normalise(EdgeN);
            Tri.SmoothVertexNormals = Part.SmoothShaded && !ForceHardRim;
            if (Tri.SmoothVertexNormals)
            {
                Tri.V0Normal = DirToWorld(Part.VertexNormals[I0]);
                Tri.V1Normal = DirToWorld(Part.VertexNormals[I1]);
                Tri.V2Normal = DirToWorld(Part.VertexNormals[I2]);
            }

            // Authoritative Project-Drive material mapping with metallic crimson GT coat & smoked glass!
            switch (Fam)
            {
            case 6u: // BodyCoat (vivid metallic racing crimson so both halves stand out unmistakably!)
                Tri.AlbedoRgb = {0.84f, 0.09f, 0.07f};
                Tri.Roughness = 0.13f;
                Tri.Metallic  = 0.38f;
                break;
            case 7u: // VehicleGlass (tinted glossy automotive canopy)
                Tri.AlbedoRgb = {0.06f, 0.09f, 0.13f};
                Tri.Roughness = 0.05f;
                Tri.Metallic  = 0.15f;
                break;
            case 8u: // VehiclePlastic / splitter / diffuser
                Tri.AlbedoRgb = {0.05f, 0.055f, 0.065f};
                Tri.Roughness = 0.42f;
                Tri.Metallic  = 0.05f;
                break;
            case 9u: // Tyre rubber or machined alloy rim spokes
                if (ForceHardRim)
                {
                    Tri.AlbedoRgb = {0.78f, 0.81f, 0.86f};
                    Tri.Roughness = 0.18f;
                    Tri.Metallic  = 0.90f;
                }
                else
                {
                    Tri.AlbedoRgb = {0.055f, 0.058f, 0.064f};
                    Tri.Roughness = 0.72f;
                    Tri.Metallic  = 0.0f;
                }
                break;
            case 10u: // Anodized cobalt centre-lock hub
                Tri.AlbedoRgb = {0.10f, 0.34f, 0.85f};
                Tri.Roughness = 0.20f;
                Tri.Metallic  = 0.92f;
                break;
            case 13u: // Xenon/LED Headlight
                Tri.AlbedoRgb   = {0.82f, 0.88f, 0.96f};
                Tri.EmissiveRgb = {1.65f, 1.80f, 2.15f};
                Tri.Roughness   = 0.08f;
                break;
            case 14u: // Ruby LED Taillight bar
                Tri.AlbedoRgb   = {0.92f, 0.08f, 0.08f};
                Tri.EmissiveRgb = {4.8f, 0.22f, 0.16f};
                Tri.Roughness   = 0.10f;
                break;
            default:
                Tri.AlbedoRgb = {0.62f, 0.65f, 0.70f};
                Tri.Roughness = 0.35f;
                Tri.Metallic  = 0.55f;
                break;
            }

            Scene.RegisterPortalTransitingTriangle(Tri, Portal);
        }
    };

    // Place model origin at Z = 0.2532 m so all four tyres (HubZ 0.0914 m, Radius 0.3446 m) rest tangent on Z = 0!
    RegisterVehiclePart(Body, {0.0f, 0.0f, 0.2532f}, false);

    // Four authored ControlVehicle.blend wheel sockets: FL, FR, RL, RR!
    const Frontier::Vec3 WheelSockets[4] = {
        {+1.7274f, +1.0475f, 0.3446f},
        {+1.7274f, -1.0475f, 0.3446f},
        {-1.6686f, +1.0475f, 0.3446f},
        {-1.6686f, -1.0475f, 0.3446f}};
    for (int W = 0; W < 4; ++W)
    {
        const bool RightSide = (W & 1) != 0;
        RegisterVehiclePart(RightSide ? TyreR : TyreL, WheelSockets[W], false);
        RegisterVehiclePart(RightSide ? RimR : RimL, WheelSockets[W], true);
    }
    return true;
}

struct ValidationLedger
{
    uint32_t Passed = 0u;
    uint32_t Failed = 0u;

    void Verify(bool Condition, const char* Label, const char* Detail = "")
    {
        if (Condition)
        {
            ++Passed;
            std::printf("  [PASS] %-64s %s\n", Label, Detail);
        }
        else
        {
            ++Failed;
            std::printf("  [FAIL] %-64s %s\n", Label, Detail);
        }
    }
};
} // namespace

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                      MAIN VALIDATION ENTRY
------------------------------------------------------------------------------------------------------------------------------------------*/
int main()
{
    using namespace Frontier;
    ValidationLedger Ledger{};
    char             Note[256];

    std::printf("====================================================================================================\n");
    std::printf("  FRONTIER WORLD SIMULATION, FLUID, SNOW/HAIL, FRACTURE, SPARKS, DUAL-TIER GI & HMI VALIDATION\n");
    std::printf("====================================================================================================\n");

    // -----------------------------------------------------------------------------------------------------------------
    // SUITE 1 & 2: PlumeFluidExtension Solid Obstacle Collision, Moving Wake, Volumetric Shadows & Fire Illumination
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 1 & 2: PlumeFluid Solid Collision, Wake, Volumetric Shadows & Fire Lighting ---\n");
    PlumeFluidParameters PlumeCfg{};
    PlumeCfg.Grade = PlumeQualityGrade::Medium;
    PlumeFluidExtension Plume{PlumeCfg};

    PlumeSolidObstacleBox SolidWall{};
    SolidWall.Centre         = {0.0f, 0.0f, 1.8f};
    SolidWall.HalfExtents    = {1.4f, 1.4f, 1.4f};
    SolidWall.LinearVelocity = {8.5f, 0.0f, 0.0f};
    Plume.RegisterSolidObstacle(SolidWall);

    Plume.AppendTransientPlumeSource({0.0f, 0.0f, 0.30f}, 0.85f, {0.0f, 0.0f, 3.2f}, 8.5f, 12.0f, 10.5f, 6.0f);
    for (int Step = 0; Step < 14; ++Step)
    {
        Plume.AdvanceSimulation({0.0f, 0.0f, 0.0f}, {0.35f, -0.40f, 0.85f}, 1.0f / 30.0f);
    }

    // Check solid interior velocity enforcement (v = 0 inside solid cells, w = 1 solid marker).
    const auto VelExt  = Plume.VelocityExtent();
    const auto& VelBuf = Plume.VelocityData();
    uint32_t SolidMarkedCount = 0u;
    float    MaxInteriorSpeed = 0.0f;
    for (size_t K = 0u; K + 3u < VelBuf.size(); K += 4u)
    {
        if (VelBuf[K + 3u] > 0.5f)
        {
            ++SolidMarkedCount;
            const float Spd = std::sqrt(VelBuf[K] * VelBuf[K] + VelBuf[K + 1u] * VelBuf[K + 1u] + VelBuf[K + 2u] * VelBuf[K + 2u]);
            MaxInteriorSpeed = std::max(MaxInteriorSpeed, Spd);
        }
    }
    std::snprintf(Note, sizeof(Note), "solid_cells=%u/%u max_interior_spd=%.6f m/s", SolidMarkedCount, VelExt[0] * VelExt[1] * VelExt[2], MaxInteriorSpeed);
    Ledger.Verify(SolidMarkedCount > 20u && MaxInteriorSpeed < 1.0e-5f, "PlumeFluid solid OBB interior Neumann zero-velocity", Note);

    const float ShadowThroughPlume = Plume.EvaluateShadowTransmittance({-4.0f, 0.0f, 0.45f}, {1.0f, 0.0f, 0.0f}, 10.0f);
    const float ShadowClearSky     = Plume.EvaluateShadowTransmittance({-4.0f, 12.0f, 6.0f}, {0.0f, 0.0f, 1.0f}, 10.0f);
    std::snprintf(Note, sizeof(Note), "T_plume=%.4f T_clear=%.4f", ShadowThroughPlume, ShadowClearSky);
    Ledger.Verify(ShadowThroughPlume < 0.88f && ShadowClearSky > 0.999f, "PlumeFluid Beer-Lambert volumetric shadow casting", Note);

    const auto FireNear = Plume.EvaluateSceneIllumination({1.2f, 0.0f, 0.15f}, {-1.0f, 0.0f, 0.4f});
    const auto FireFar  = Plume.EvaluateSceneIllumination({9.5f, 0.0f, 0.15f}, {-1.0f, 0.0f, 0.4f});
    const float NearSum = FireNear[0] + FireNear[1] + FireNear[2];
    const float FarSum  = FireFar[0] + FireFar[1] + FireFar[2];
    std::snprintf(Note, sizeof(Note), "near_rgb_sum=%.4f far_rgb_sum=%.5f", NearSum, FarSum);
    Ledger.Verify(NearSum > 0.05f && NearSum > FarSum * 4.0f, "PlumeFluid blackbody fire & hot-gas scene illumination", Note);

    // -----------------------------------------------------------------------------------------------------------------
    // SUITE 3, 4, 5 & 6: 2.5D ShallowWaterMudExtension (Lake-at-Rest, Cloud Rain Puddles, Bingham Mud, Nested Link)
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 3..6: 2.5D Saint-Venant Shallow-Water, Rain Puddles, Bingham Mud & Nested Link ---\n");
    ShallowWaterConfiguration LakeCfg{};
    LakeCfg.CellsX              = 48u;
    LakeCfg.CellsY              = 48u;
    LakeCfg.CellSizeMetres      = 0.50f;
    LakeCfg.WorldOriginXY       = {-12.0f, -12.0f};
    LakeCfg.InfiltrationRateMps = 0.0f;
    ShallowWaterMudExtension LakeSolver{LakeCfg};
    LakeSolver.SculptBedDepressionOrMound({0.0f, 0.0f}, 6.0f, -0.45f);
    LakeSolver.SculptBedDepressionOrMound({1.5f, -1.0f}, 2.0f, +0.25f); // Submerged bump!
    LakeSolver.FillBasinRegion({0.0f, 0.0f}, 5.8f, -0.05f, 0.0f);

    ShallowWaterDiagnostics LakeDiag{};
    for (int S = 0; S < 20; ++S)
    {
        LakeDiag = LakeSolver.StepSimulation(1.0f / 60.0f);
    }
    std::snprintf(Note, sizeof(Note), "peak_speed_at_rest=%.7f m/s vol=%.4f m^3", LakeDiag.PeakFlowSpeedMps, LakeDiag.TotalLiquidVolumeCubicM);
    Ledger.Verify(LakeDiag.PeakFlowSpeedMps < 1.0e-4f && LakeDiag.TotalLiquidVolumeCubicM > 1.0, "2.5D Audusse-Minmod hydrostatic lake-at-rest", Note);

    // Cloud-gated rain puddle formation: left side cloudy (tau = 0.85), right side clear sky (tau = 0.0)!
    ShallowWaterMudExtension PuddleRoad{LakeCfg};
    PuddleRoad.SculptBedDepressionOrMound({-5.0f, 0.0f}, 3.2f, -0.06f);
    PuddleRoad.SculptBedDepressionOrMound({+5.0f, 0.0f}, 3.2f, -0.06f);
    std::array<float, 1024u> HalfCloudColumns{};
    for (uint32_t Cy = 0u; Cy < 32u; ++Cy)
    {
        for (uint32_t Cx = 0u; Cx < 32u; ++Cx)
        {
            HalfCloudColumns[Cy * 32u + Cx] = (Cx < 16u) ? 0.85f : 0.0f;
        }
    }
    for (int R = 0; R < 40; ++R)
    {
        PuddleRoad.DepositSpatiallyGatedRain(0.018f, HalfCloudColumns.data(), 0.08f, {0.0f, 0.0f}, 24.0f, 0.1f);
        PuddleRoad.StepSimulation(0.05f);
    }
    const float CloudyPuddleDepth = PuddleRoad.SampleSurface({-5.0f, 0.0f}).FluidDepthMetres;
    const float ClearRoadDepth    = PuddleRoad.SampleSurface({+5.0f, 0.0f}).FluidDepthMetres;
    std::snprintf(Note, sizeof(Note), "cloudy_puddle=%.4f m clear_depression=%.6f m", CloudyPuddleDepth, ClearRoadDepth);
    Ledger.Verify(CloudyPuddleDepth > 0.03f && ClearRoadDepth < 1.0e-5f, "Cloud-gated rain forms puddles only beneath clouds", Note);

    // Bingham-plastic mud rheology vs pure water + wheel & hull coupling!
    ShallowWaterMudExtension WaterSlope{LakeCfg};
    ShallowWaterMudExtension MudSlope{LakeCfg};
    std::vector<float> TiltedBed(48u * 48u, 0.0f);
    for (uint32_t J = 0u; J < 48u; ++J)
    {
        for (uint32_t I = 0u; I < 48u; ++I)
        {
            TiltedBed[J * 48u + I] = 0.04f * static_cast<float>(48u - I);
        }
    }
    WaterSlope.AssignBedElevationGrid(TiltedBed);
    MudSlope.AssignBedElevationGrid(TiltedBed);
    WaterSlope.InjectLocalLiquidOrMeltVolume({-4.0f, 0.0f}, 2.5f, 0.16f, 0.0f);
    MudSlope.InjectLocalLiquidOrMeltVolume({-4.0f, 0.0f}, 2.5f, 0.16f, 0.88f); // Rich Bingham mud!

    ShallowWaterDiagnostics WSlopeD{}, MSlopeD{};
    for (int S = 0; S < 25; ++S)
    {
        WSlopeD = WaterSlope.StepSimulation(1.0f / 60.0f);
        MSlopeD = MudSlope.StepSimulation(1.0f / 60.0f);
    }
    std::snprintf(Note, sizeof(Note), "water_peak_v=%.3f m/s bingham_mud_peak_v=%.3f m/s", WSlopeD.PeakFlowSpeedMps, MSlopeD.PeakFlowSpeedMps);
    Ledger.Verify(MSlopeD.PeakFlowSpeedMps < WSlopeD.PeakFlowSpeedMps * 0.65f, "O'Brien-Julien Bingham-plastic mud yield-stress arrest", Note);

    const WheelFluidInteraction MudWheel = MudSlope.CoupleWheelContact({-4.0f, 0.0f, 1.35f}, {12.0f, 0.0f, 0.0f}, 0.34f, 0.26f, 0.0f);
    const auto HullBuoyancy = LakeSolver.EvaluateHullBuoyancyAndDragForce({0.0f, 0.0f, -0.18f}, {2.1f, 0.9f, 0.5f}, {4.0f, 0.0f, 0.0f}, 0.0f);
    std::snprintf(
        Note,
        sizeof(Note),
        "mud_grip=%.3f drag_x=%.1f N hull_buoy_z=%.1f N",
        MudWheel.TractionMultiplier,
        MudWheel.HydrodynamicDragNewtons[0],
        HullBuoyancy[2]);
    Ledger.Verify(
        MudWheel.TractionMultiplier < 0.72f && MudWheel.HydrodynamicDragNewtons[0] < -15.0f && HullBuoyancy[2] > 500.0f,
        "Two-way wheel mud traction/drag & multi-probe hull buoyancy",
        Note);

    // Two-way NestedWaterDomainLink (Coarse 96 m <-> Fine 24 m + 6 m cross-fade).
    ShallowWaterConfiguration CoarseCfg = LakeCfg;
    CoarseCfg.CellSizeMetres            = 2.0f;
    CoarseCfg.WorldOriginXY             = {-48.0f, -48.0f};
    ShallowWaterMudExtension CoarseWater{CoarseCfg};
    CoarseWater.SculptBedDepressionOrMound({0.0f, 0.0f}, 22.0f, -0.60f);
    CoarseWater.FillBasinRegion({0.0f, 0.0f}, 20.0f, -0.10f, 0.15f);

    LakeCfg.HoleCrossFadeMetres = 4.0f;
    ShallowWaterMudExtension FineWater{LakeCfg};
    FineWater.SculptBedDepressionOrMound({0.0f, 0.0f}, 11.0f, -0.60f);
    NestedWaterDomainLink::SynchronizeCoarseToFineRim(CoarseWater, FineWater, 3u);
    FineWater.InjectLocalLiquidOrMeltVolume({0.0f, 0.0f}, 2.5f, 0.22f, 0.35f);
    FineWater.StepSimulation(1.0f / 60.0f);
    NestedWaterDomainLink::RestrictFineInteriorToCoarse(FineWater, CoarseWater, 4u);

    const SurfaceFluidSample SeamCenter = NestedWaterDomainLink::SampleNestedCompositeSurface(CoarseWater, FineWater, {0.0f, 0.0f});
    const SurfaceFluidSample SeamEdge   = NestedWaterDomainLink::SampleNestedCompositeSurface(CoarseWater, FineWater, {10.5f, 0.0f});
    std::snprintf(Note, sizeof(Note), "center_alpha=%.3f border_alpha=%.3f", SeamCenter.NestedCrossFadeAlpha, SeamEdge.NestedCrossFadeAlpha);
    Ledger.Verify(SeamCenter.NestedCrossFadeAlpha > 0.98f && SeamEdge.NestedCrossFadeAlpha > 0.05f && SeamEdge.NestedCrossFadeAlpha < 0.95f, "NestedWaterDomainLink two-way coarse<->fine & border cross-fade", Note);

    // -----------------------------------------------------------------------------------------------------------------
    // SUITE 7, 8 & 9: Snowpack Single PolygonSurface, Vehicle Adhesion, Snow Pit Rut Carving & Hail Melt into Puddles
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 7..9: Single-PolygonSurface Snow/Hail, Snow Pit Ruts & Melt into Puddles ---\n");
    CloudParameters StormClouds{};
    StormClouds.Coverage               = 0.92;
    StormClouds.UniformDensityOverride = 0.85;

    WindForceFieldExtension WindField{};
    WeatherParticleBudgetConfig SnowBudget{};
    SnowBudget.Category                  = FallingParticleCategory::SnowFlake;
    SnowBudget.StrictParticleBudget      = 1536u;
    SnowBudget.SpawnVolumeHorizontalM    = 28.0;
    SnowBudget.SpawnCeilingHeightM       = 6.0;
    SnowBudget.WeatherIntensityZeroToOne = 1.0;
    CloudGatedWeatherSpawner SnowSpawner{SnowBudget};

    SnowpackDomainSpec SnowSpec{};
    SnowSpec.CellsX         = 64u;
    SnowSpec.CellsY         = 64u;
    SnowSpec.CellSizeMetres = 0.50f;
    SnowSpec.OriginX        = -16.0f;
    SnowSpec.OriginY        = -16.0f;
    SnowSpec.FlakeEquivalentMassKg = 0.085f;
    SnowpackAccumulationExtension Snowpack{SnowSpec};

    VehicleSnowEnvelope ParkedCar{};
    ParkedCar.WorldCentre = {0.0f, 0.0f, 0.65f};

    for (int Frame = 0; Frame < 45; ++Frame)
    {
        SnowSpawner.StepParticles(StormClouds, WindField, {0.0, 0.0, 0.0}, 0.08);
        Snowpack.FuseWeatherAndAdvancePhaseChange(SnowSpawner, ParkedCar, nullptr, 0.08f, 268.15f);
    }
    Snowpack.RebuildContiguousPolygonSurfaces(ParkedCar);

    // Verify zero lingering ground snowflakes + single contiguous Ground & Vehicle PolygonSurfaces!
    uint32_t LingeringGroundFlakes = 0u;
    for (const auto& P : SnowSpawner.Particles())
    {
        if (P.Alive && P.Position.Z <= 0.01)
        {
            ++LingeringGroundFlakes;
        }
    }
    std::snprintf(
        Note,
        sizeof(Note),
        "retired=%llu ground_tris=%zu veh_tris=%zu lingering_ground=%u",
        static_cast<unsigned long long>(Snowpack.Telemetry().RetiredSnowflakesFused),
        Snowpack.GroundPolygonSurface().Indices.size() / 3u,
        Snowpack.VehiclePolygonSurface().Indices.size() / 3u,
        LingeringGroundFlakes);
    Ledger.Verify(
        Snowpack.Telemetry().RetiredSnowflakesFused > 80u &&
            Snowpack.GroundPolygonSurface().ActiveQuadCount > 10u &&
            Snowpack.VehiclePolygonSurface().ActiveQuadCount > 2u &&
            LingeringGroundFlakes == 0u,
        "Snowflakes retire immediately into 1 Ground + 1 Vehicle PolygonSurface",
        Note);

    // Aerodynamic wind-shear shedding when vehicle accelerates to 34 m/s!
    const double PreDriveVehSnowKg = Snowpack.Telemetry().VehicleAdheredMassKg;
    VehicleSnowEnvelope FastCar    = ParkedCar;
    FastCar.ForwardSpeedMps        = 34.0f;
    FastCar.ChassisAccelMps2       = 9.5f;
    Snowpack.FuseWeatherAndAdvancePhaseChange(SnowSpawner, FastCar, nullptr, 1.5f, 268.15f);
    std::snprintf(Note, sizeof(Note), "parked_car_snow=%.3f kg -> 34mps_car_snow=%.3f kg", PreDriveVehSnowKg, Snowpack.Telemetry().VehicleAdheredMassKg);
    Ledger.Verify(Snowpack.Telemetry().VehicleAdheredMassKg < PreDriveVehSnowKg * 0.55, "Vehicle-adhered snow sheds onto wake under aerodynamic shear", Note);

    // Author a deep 0.46 m Snow Pit and drive a loaded wheel across it to carve physical tyre ruts + lateral berms!
    Snowpack.SculptSnowPitOrDrift(5.0f, 0.0f, 4.2f, 0.46f, 155.0f);
    const float PitBefore = Snowpack.SampleGroundSnowThickness(5.0f, 0.0f);
    SnowWheelRutResponse RutResp{};
    for (float X = 2.5f; X <= 7.5f; X += 0.35f)
    {
        SnowWheelRutInput WheelIn{};
        WheelIn.WheelContactWorld = {X, 0.0f, 0.0f};
        WheelIn.WheelForwardWorld = {1.0f, 0.0f, 0.0f};
        WheelIn.TyreWidthMetres   = 0.285f;
        WheelIn.NormalLoadNewtons = 4400.0f;
        WheelIn.WheelForwardSpeed = 11.0f;
        const auto StepRut = Snowpack.CarveWheelRutAndEvaluateResistance(WheelIn);
        if (std::abs(X - 5.0f) < 0.25f)
        {
            RutResp = StepRut;
        }
    }
    Snowpack.RebuildContiguousPolygonSurfaces(ParkedCar);
    const float PitRutCenter = Snowpack.SampleGroundSnowThickness(5.0f, 0.0f);
    const float PitBermSide  = Snowpack.SampleGroundSnowThickness(5.0f, 0.52f);
    const float PackedRho    = Snowpack.SampleGroundSnowDensity(5.0f, 0.0f);
    std::snprintf(
        Note,
        sizeof(Note),
        "pit_before=%.3fm rut_after=%.3fm berm=%.3fm rho=%.0f drag=%.1fN",
        PitBefore,
        PitRutCenter,
        PitBermSide,
        PackedRho,
        RutResp.CompactionResistanceN);
    Ledger.Verify(
        PitRutCenter < PitBefore - 0.10f && PitBermSide > PitRutCenter + 0.06f &&
            PackedRho > 280.0f && RutResp.CompactionResistanceN > 250.0f,
        "Drivable Snow Pit Wong-Bekker rut carving, berms & compaction drag",
        Note);

    // Hail bounce -> granular hail-ice PolygonSurface -> Stefan thermodynamic melt into 2.5D shallow-water puddles!
    WeatherParticleBudgetConfig HailBudget = SnowBudget;
    HailBudget.Category                    = FallingParticleCategory::HailPellet;
    HailBudget.SpawnCeilingHeightM         = 10.0;
    CloudGatedWeatherSpawner HailSpawner{HailBudget};
    SnowSpec.HailPelletMassKg = 0.14f;
    SnowpackAccumulationExtension HailPack{SnowSpec};
    ShallowWaterMudExtension      MeltPuddle{LakeCfg};

    for (int Frame = 0; Frame < 55; ++Frame)
    {
        HailSpawner.StepParticles(StormClouds, WindField, {0.0, 0.0, 0.0}, 0.05);
        HailPack.FuseWeatherAndAdvancePhaseChange(HailSpawner, ParkedCar, nullptr, 0.05f, 270.15f);
    }
    const uint64_t HailBounces    = HailPack.Telemetry().HailBounceContacts;
    const uint64_t HailFused      = HailPack.Telemetry().RetiredHailPelletsFused;
    const double   PreMeltWaterM3 = MeltPuddle.StepSimulation(0.01f).TotalLiquidVolumeCubicM;

    // Warm air to +14 C (287.15 K) so settled hail melts into MeltPuddle!
    for (int MeltStep = 0; MeltStep < 25; ++MeltStep)
    {
        HailPack.FuseWeatherAndAdvancePhaseChange(HailSpawner, ParkedCar, &MeltPuddle, 2.0f, 287.15f);
    }
    const double PostMeltWaterM3 = MeltPuddle.StepSimulation(0.02f).TotalLiquidVolumeCubicM;
    std::snprintf(
        Note,
        sizeof(Note),
        "bounces=%llu fused=%llu melted=%.3f kg puddle_vol=%.5f m^3",
        static_cast<unsigned long long>(HailBounces),
        static_cast<unsigned long long>(HailFused),
        HailPack.Telemetry().CumulativeMeltedWaterKg,
        PostMeltWaterM3);
    Ledger.Verify(
        HailBounces > 10u && HailFused > 10u && PostMeltWaterM3 > PreMeltWaterM3 + 1.0e-4,
        "Hail bounces, settles into granular ice & melts into 2.5D puddles",
        Note);

    // -----------------------------------------------------------------------------------------------------------------
    // SUITE 10: Lightning & Speed-of-Sound Multi-Segment Thunder
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 10: Branched Lightning, Internal Cloud Glow, Scene Flash & Delayed Thunder ---\n");
    LightningThunderExtension StormLightning{};
    Audio::AcousticListenerPose DriverEars{};
    DriverEars.Position = {0.0f, 0.0f, 1.4f};

    CloudParameters ClearSkyClouds{};
    ClearSkyClouds.Coverage               = 0.0;
    ClearSkyClouds.UniformDensityOverride = 0.0;
    const bool ClearStrike = StormLightning.TriggerCloudToGroundStrike(ClearSkyClouds, {450.0f, 0.0f, 0.0f}, {450.0f, 0.0f, 0.0f}, DriverEars);
    const bool StormStrike = StormLightning.TriggerCloudToGroundStrike(StormClouds, {450.0f, 0.0f, 0.0f}, {450.0f, 0.0f, 0.0f}, DriverEars);

    const size_t ActiveFlashRibbonIndices = StormLightning.BoltPolygonSurface().Indices.size();
    const Vec3   CloudFlashGlow           = StormLightning.EvaluateCloudInternalFlashRadiance({450.0f, 0.0f, 960.0f}, 0.85);
    const Vec3   RoadFlashIrr             = StormLightning.EvaluateSceneFlashIrradiance({0.0f, 0.0f, 0.0f}, {0.0f, 0.0f, 1.0f});
    const double SpeedSound               = StormLightning.SpeedOfSoundMetresPerSecond();

    // Advance 0.5 s: optical flash finishes, NO thunder has arrived yet (450 m / 340.3 m/s = 1.32 s)!
    StormLightning.AdvanceStormTimeline(0.50, DriverEars, DriverEars.Position);
    const bool ZeroEarlyThunder = StormLightning.NewlyArrivedThunderWaves().empty();

    // Advance to t = 2.0 s: near ground-strike crack arrives first; high-altitude anvil rumble arrives later!
    uint32_t ArrivedByTwoSec = 0u;
    for (int Step = 0; Step < 15; ++Step)
    {
        StormLightning.AdvanceStormTimeline(0.10, DriverEars, DriverEars.Position);
        ArrivedByTwoSec += static_cast<uint32_t>(StormLightning.NewlyArrivedThunderWaves().size());
    }
    std::snprintf(
        Note,
        sizeof(Note),
        "clear_strike=%d storm_segs=%zu ribbon_idx=%zu cloud_glow=%.2f c_sound=%.1fm/s arrived@2s=%u",
        ClearStrike ? 1 : 0,
        StormLightning.ActiveBoltSegments().size(),
        ActiveFlashRibbonIndices,
        CloudFlashGlow.Z,
        SpeedSound,
        ArrivedByTwoSec);
    Ledger.Verify(
        !ClearStrike && StormStrike && ActiveFlashRibbonIndices > 60u &&
            CloudFlashGlow.Z > 1.0f && RoadFlashIrr.Z > 0.01f && ZeroEarlyThunder && ArrivedByTwoSec >= 1u,
        "Lightning cloud/scene flash & speed-of-sound delayed thunder",
        Note);

    // -----------------------------------------------------------------------------------------------------------------
    // SUITE 11 & 12: 6-Material Griffith Convex Fracture + Volume Conservation + Jolt 5.6.0 Rigid-Body Spawning
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 11 & 12: 6-Material Griffith Fracture, Volume Conservation & Jolt Convex Hulls ---\n");
    SolidFractureExtension FractureEngine{};
    const ConvexSolidFragment IntactPillar = SolidFractureExtension::CreateIntactBoxSolid({0.0f, 0.0f, 1.2f}, {0.45f, 0.45f, 1.2f}, 2380.0f);

    // Sub-threshold elastic hit -> 0 fractures!
    FractureImpactDescriptor GentleTap{};
    GentleTap.ImpactPointWorld     = {0.45f, 0.0f, 1.4f};
    GentleTap.ImpactKineticEnergyJ = 25.0f; // < 120 J concrete threshold
    std::vector<ConvexSolidFragment>   TapFrags;
    std::vector<FragmentAdjacencyBond> TapBonds;
    const auto TapSum = FractureEngine.CleaveConvexSolid(
        IntactPillar,
        LookupFractureMaterialProperties(FractureMaterialPreset::ReinforcedConcrete),
        GentleTap,
        TapFrags,
        TapBonds);
    Ledger.Verify(!TapSum.FractureOccurred && TapFrags.size() == 1u, "Sub-threshold impact absorbed elastically without fracture");

    // Cleave all 6 material presets under crash impact and verify exact 100.00% 3D volume conservation!
    const FractureMaterialPreset AllPresets[6] = {
        FractureMaterialPreset::ReinforcedConcrete,
        FractureMaterialPreset::NaturalGraniteStone,
        FractureMaterialPreset::AnisotropicWoodGrain,
        FractureMaterialPreset::AnnealedWindowGlass,
        FractureMaterialPreset::TemperedSafetyGlass,
        FractureMaterialPreset::AutomotivePolymerAbs};

    bool   AllMaterialsConserved = true;
    double WorstVolError         = 0.0;
    std::vector<ConvexSolidFragment> ConcreteFrags;

    for (int M = 0; M < 6; ++M)
    {
        FractureImpactDescriptor Crash{};
        Crash.ImpactPointWorld     = {0.45f, 0.05f, 1.5f};
        Crash.ImpactDirection      = {-1.0f, 0.1f, 0.0f};
        Crash.ImpactKineticEnergyJ = 9500.0f;
        Crash.ImpulseNewtonSeconds = 1800.0f;
        Crash.AnchoredBaseAtMinZ   = (M == 0);
        Crash.DeterministicSeed    = 0xABC000ull + static_cast<uint64_t>(M);

        std::vector<ConvexSolidFragment>   Frags;
        std::vector<FragmentAdjacencyBond> Bonds;
        const auto Sum = FractureEngine.CleaveConvexSolid(
            IntactPillar,
            LookupFractureMaterialProperties(AllPresets[M]),
            Crash,
            Frags,
            Bonds);
        const double Err = std::abs(Sum.VolumeConservationRatio - 1.0);
        WorstVolError    = std::max(WorstVolError, Err);
        if (!Sum.FractureOccurred || Frags.size() < 4u || Err > 1.0e-3)
        {
            AllMaterialsConserved = false;
        }
        if (M == 0)
        {
            ConcreteFrags = Frags;
        }
    }
    std::snprintf(Note, sizeof(Note), "6/6 presets cleaved; max_vol_error=%.6f concrete_frags=%zu", WorstVolError, ConcreteFrags.size());
    Ledger.Verify(AllMaterialsConserved, "6-material Griffith fracture 100.0% 3D volume conservation", Note);

    // Spawn cleaved ConvexSolidFragments into Jolt v5.6.0 RigidBodySolver as ConvexHull dynamic bodies!
    RigidBodySolver JoltWorld{};
    bool JoltOk = JoltWorld.Bring();
    RigidBodyDescription GroundDesc{};
    GroundDesc.Name              = "ProvingGroundFloor";
    GroundDesc.Motion            = RigidBodyMotionCategory::Static;
    GroundDesc.Shape.Category    = CollisionShapeCategory::Plane;
    GroundDesc.Shape.PlaneNormal = {0.0f, 0.0f, 1.0f};
    (void)JoltWorld.CreateBody(GroundDesc);

    std::vector<RigidBodyIdentity> SpawnedHullIds;
    for (const auto& Frag : ConcreteFrags)
    {
        if (Frag.AnchoredIntact || Frag.HullVertices.size() < 4u)
        {
            continue;
        }
        RigidBodyDescription HullDesc{};
        HullDesc.Name           = "CleavedConcreteHull";
        HullDesc.Motion         = RigidBodyMotionCategory::Dynamic;
        HullDesc.Position       = PhysicsVector3{Frag.CentroidWorld};
        HullDesc.LinearVelocity = PhysicsVector3{Frag.LinearVelocityMps};
        HullDesc.MassKilograms  = Frag.MassKilograms;
        HullDesc.Shape.Category = CollisionShapeCategory::ConvexHull;
        for (const Vec3& V : Frag.HullVertices)
        {
            HullDesc.Shape.HullPoints.emplace_back(V - Frag.CentroidWorld);
        }
        const RigidBodyIdentity Id = JoltWorld.CreateBody(HullDesc);
        if (Id != InvalidRigidBody)
        {
            SpawnedHullIds.push_back(Id);
        }
    }
    JoltWorld.OptimizeBroadPhase();
    for (int Step = 0; Step < 30; ++Step)
    {
        JoltWorld.Advance(1.0f / 60.0f);
    }
    RigidBodyPose SamplePose{};
    const bool PoseValid = !SpawnedHullIds.empty() && JoltWorld.QueryPose(SpawnedHullIds[0], SamplePose);
    std::snprintf(Note, sizeof(Note), "jolt=%s spawned_hulls=%zu sample_z=%.3f m", RigidBodySolver::QueryJoltVersion(), SpawnedHullIds.size(), SamplePose.Position.Z);
    Ledger.Verify(JoltOk && SpawnedHullIds.size() >= 3u && PoseValid && SamplePose.Position.Z > -0.05f, "Cleaved convex hulls simulate & collide in Jolt v5.6.0", Note);
    JoltWorld.Retire();

    // -----------------------------------------------------------------------------------------------------------------
    // SUITE 13: BallisticSparkExtension Swept 3 mm Scene Collisions & Shadowed Scene Illumination
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 13: Swept Colliding Metallic Sparks & Shadowed Blackbody Scene Lighting ---\n");
    BallisticSparkExtension Sparks{};
    SparkSceneColliderBox   Guardrail{};
    Guardrail.CentreWorld = {2.2f, 0.0f, 0.6f};
    Guardrail.HalfExtents = {0.20f, 2.5f, 0.6f};
    Sparks.RegisterSceneCollider(Guardrail);

    MetallicScrapeContact Scrape{};
    Scrape.ContactPointWorld     = {0.4f, 0.0f, 0.35f};
    Scrape.ContactNormalWorld    = {0.0f, 0.0f, 1.0f};
    Scrape.TangentialVelocityMps = {19.0f, 0.5f, -1.5f}; // Aimed directly at Guardrail & floor!
    Scrape.NormalForceNewtons    = 6200.0f;
    Scrape.RequestedSparkCount   = 96u;
    Sparks.SpawnScrapeSparks(Scrape);

    for (int S = 0; S < 12; ++S)
    {
        Sparks.StepBallisticSparks(1.0f / 60.0f, {1.5f, 0.0f, 0.0f});
    }

    uint32_t BelowFloorCount = 0u;
    for (const auto& Sp : Sparks.Sparks())
    {
        if (Sp.Active && Sp.PositionWorld.Z < 0.0025f)
        {
            ++BelowFloorCount;
        }
    }
    const Vec3 LitInFrontOfWall  = Sparks.EvaluateShadowedSceneIrradiance({1.6f, 0.0f, 0.0f}, {0.0f, 0.0f, 1.0f});
    const Vec3 OccludedBehindWall = Sparks.EvaluateShadowedSceneIrradiance({3.1f, 0.0f, 0.05f}, {1.0f, 0.0f, 0.0f});
    std::snprintf(
        Note,
        sizeof(Note),
        "bounces=%llu splits=%llu floor_pen=%u front_irr=%.3f occluded_irr=%.5f",
        static_cast<unsigned long long>(Sparks.Telemetry().SweptSceneCollisions),
        static_cast<unsigned long long>(Sparks.Telemetry().ImpactSplitSparks),
        BelowFloorCount,
        LitInFrontOfWall.X,
        OccludedBehindWall.X);
    Ledger.Verify(
        Sparks.Telemetry().SweptSceneCollisions > 25u && BelowFloorCount == 0u &&
            LitInFrontOfWall.X > 0.05f && OccludedBehindWall.X < LitInFrontOfWall.X * 0.05f,
        "Sparks collide without tunneling & cast shadowed scene light",
        Note);

    // -----------------------------------------------------------------------------------------------------------------
    // SUITE 14 & 15: Dual-Tier GTX SDF + RTX BVH ReSTIR + Mirrors & Portals Reflecting Clouds, Fog & Plume Smoke/Fire
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 14 & 15: Dual-Tier GTX SDF & RTX BVH ReSTIR, Mirrors & Portals + Volumetrics ---\n");
    SdfRestirPortalExtension DualRenderer{};
    // Textured mineral-aggregate ground slab + colored architectural walls + remote sanctuary pillar seen through Portal!
    DualRenderer.RegisterTexturedGroundSlab({0.0f, 0.0f, -0.25f}, {45.0f, 45.0f, 0.25f}, {0.23f, 0.25f, 0.29f}, 0.50f, 0.04f);
    DualRenderer.RegisterDualTierSolidBox({-3.5f, 3.2f, 1.1f}, {0.8f, 1.8f, 1.1f}, {0.82f, 0.24f, 0.18f}, 0.55f);
    DualRenderer.RegisterDualTierSolidBox({28.0f, 0.0f, 1.6f}, {1.1f, 1.1f, 1.6f}, {0.20f, 0.78f, 0.45f}, 0.45f, {0.15f, 0.45f, 0.25f});

    // Planar Mirror on the right reflecting the rising Smoke/Fire Plume + Volumetric Clouds + Sky + Fog!
    PlanarMirrorAperture SceneMirror{};
    SceneMirror.CentreWorld      = {3.2f, -2.6f, 1.65f};
    SceneMirror.RightAxis        = {0.866f, 0.500f, 0.0f};
    SceneMirror.UpAxis           = {0.0f, 0.0f, 1.0f};
    SceneMirror.FrontNormal      = Normalise(Vec3{-0.500f, 0.866f, 0.06f});
    SceneMirror.HalfWidthMetres  = 2.1f;
    SceneMirror.HalfHeightMetres = 1.55f;
    DualRenderer.RegisterPlanarMirror(SceneMirror);

    // Seamless Portal on the left looking straight into the remote +28 m emerald sanctuary & storm plume!
    SeamlessPortalAperture ScenePortal{};
    ScenePortal.EntryCentreWorld = {3.4f, +2.6f, 1.65f};
    ScenePortal.EntryRightAxis   = {-0.25f, 0.968f, 0.0f};
    ScenePortal.EntryUpAxis      = {0.0f, 0.0f, 1.0f};
    ScenePortal.EntryFrontNormal = Normalise(Vec3{-0.968f, -0.25f, 0.0f});
    ScenePortal.ExitCentreWorld  = {23.0f, 0.0f, 1.65f};
    ScenePortal.ExitRightAxis    = {0.0f, -1.0f, 0.0f};
    ScenePortal.ExitUpAxis       = {0.0f, 0.0f, 1.0f};
    ScenePortal.ExitFrontNormal  = {1.0f, 0.0f, 0.0f};
    ScenePortal.HalfWidthMetres  = 1.85f;
    ScenePortal.HalfHeightMetres = 1.55f;
    DualRenderer.RegisterSeamlessPortal(ScenePortal);

    // Fine 160x160 (0.085 m cell) multi-lobe organic puddle basin so shorelines & liquid normals are silky smooth!
    ShallowWaterConfiguration SceneWaterCfg = LakeCfg;
    SceneWaterCfg.CellsX                    = 160u;
    SceneWaterCfg.CellsY                    = 160u;
    SceneWaterCfg.CellSizeMetres            = 0.085f;
    SceneWaterCfg.WorldOriginXY             = {-5.6f, -6.8f};
    ShallowWaterMudExtension ScenePuddle{SceneWaterCfg};
    ScenePuddle.SculptBedDepressionOrMound({1.0f, 0.0f}, 4.3f, -0.075f);
    ScenePuddle.SculptBedDepressionOrMound({-0.6f, -1.35f}, 2.5f, -0.055f);
    ScenePuddle.SculptBedDepressionOrMound({2.1f, +1.25f}, 2.4f, -0.050f);
    ScenePuddle.FillBasinRegion({1.0f, 0.0f}, 4.1f, 0.014f, 0.0f);
    ScenePuddle.FillBasinRegion({-0.6f, -1.35f}, 2.3f, 0.014f, 0.0f);
    ScenePuddle.FillBasinRegion({2.1f, +1.25f}, 2.2f, 0.014f, 0.28f); // Smooth transition to Bingham mud lobe on the left!
    for (int Relax = 0; Relax < 18; ++Relax)
    {
        (void)ScenePuddle.StepSimulation(1.0f / 120.0f);
    }

    TransmittanceLut SkyLut{};
    AtmosphereParameters Atmos{};
    SkyLut.Bake(Atmos, 64u, 16u, 24u);

    CoupledWorldOpticalContext OptCtx{};
    OptCtx.Atmosphere        = Atmos;
    OptCtx.AtmosphereLut     = &SkyLut;
    OptCtx.Clouds.Coverage   = 0.68;
    OptCtx.Fog.DensityAtBase = 0.008;
    OptCtx.SunDirectionUnit  = Normalise(Vec3{0.42f, -0.38f, 0.82f});
    OptCtx.PlumeFluid        = &Plume;
    OptCtx.ShallowWater      = &ScenePuddle;
    OptCtx.Lightning         = &StormLightning;
    OptCtx.Sparks            = &Sparks;

    DualRenderer.FinalizeSceneAndBakeSurfaceCards(OptCtx);

    // 14a: Verify GTX SDF ReSTIR vs RTX BVH ReSTIR GI + Spatial Reservoir Merge!
    const auto GtxResA = DualRenderer.SampleRestirIndirectReservoir(GpuTracingTier::SignedDistanceFieldGtx, {-2.2f, 2.5f, 0.05f}, {0.0f, 0.0f, 1.0f}, OptCtx, 11ull);
    const auto GtxResB = DualRenderer.SampleRestirIndirectReservoir(GpuTracingTier::SignedDistanceFieldGtx, {-2.0f, 2.5f, 0.05f}, {0.0f, 0.0f, 1.0f}, OptCtx, 29ull);
    const auto Merged  = SdfRestirPortalExtension::MergeSpatialReservoirs(GtxResA, GtxResB, {-2.2f, 2.5f, 0.05f}, {0.0f, 0.0f, 1.0f}, 99ull);
    const auto RtxRes  = DualRenderer.SampleRestirIndirectReservoir(GpuTracingTier::HardwareRayTracingRtx, {-2.2f, 2.5f, 0.05f}, {0.0f, 0.0f, 1.0f}, OptCtx, 11ull);
    std::snprintf(
        Note,
        sizeof(Note),
        "gtx_W=%.3f merged_M=%u rtx_W=%.3f cards=%zu",
        GtxResA.IntegrationWeightW,
        Merged.SampleCountM,
        RtxRes.IntegrationWeightW,
        DualRenderer.SurfaceCards().size());
    Ledger.Verify(
        GtxResA.IntegrationWeightW > 0.05f && Merged.SampleCountM > GtxResA.SampleCountM && RtxRes.IntegrationWeightW > 0.05f,
        "Dual-tier GTX SDF SurfaceCards ReSTIR & RTX BVH ReSTIR parity",
        Note);

    // 15a: Trace Mirror ray aimed so reflected ray passes through PlumeFluid smoke/fire & into Volumetric Clouds in BOTH GTX & RTX!
    const Vec3 CamPos{-6.2f, 0.0f, 1.65f};
    const Vec3 MirrorAim = Normalise(SceneMirror.CentreWorld + Vec3{0.0f, 0.0f, 0.25f} - CamPos);
    const auto GtxMirrorDiag = DualRenderer.TraceCoupledRadianceRay(GpuTracingTier::SignedDistanceFieldGtx, CamPos, MirrorAim, OptCtx, 7ull);
    const auto RtxMirrorDiag = DualRenderer.TraceCoupledRadianceRay(GpuTracingTier::HardwareRayTracingRtx, CamPos, MirrorAim, OptCtx, 7ull);
    std::snprintf(
        Note,
        sizeof(Note),
        "gtx(refl=%u plume=%.3f cloud=%.3f) rtx(refl=%u plume=%.3f cloud=%.3f)",
        GtxMirrorDiag.MirrorReflections,
        GtxMirrorDiag.PlumeOpticalOpacity,
        GtxMirrorDiag.CloudReflectionLuminance,
        RtxMirrorDiag.MirrorReflections,
        RtxMirrorDiag.PlumeOpticalOpacity,
        RtxMirrorDiag.CloudReflectionLuminance);
    Ledger.Verify(
        GtxMirrorDiag.MirrorReflections == 1u && RtxMirrorDiag.MirrorReflections == 1u &&
            GtxMirrorDiag.PlumeOpticalOpacity > 0.05f && RtxMirrorDiag.PlumeOpticalOpacity > 0.05f &&
            GtxMirrorDiag.CloudReflectionLuminance > 0.001f && RtxMirrorDiag.CloudReflectionLuminance > 0.001f,
        "Planar Mirrors in BOTH GTX SDF & RTX reflect Clouds + Fog + Plume",
        Note);

    // 15b: Trace Seamless Portal ray into remote +28 m emerald sanctuary in BOTH GTX SDF & RTX!
    const Vec3 PortalAim = Normalise(ScenePortal.EntryCentreWorld - CamPos);
    const auto GtxPortalDiag = DualRenderer.TraceCoupledRadianceRay(GpuTracingTier::SignedDistanceFieldGtx, CamPos, PortalAim, OptCtx, 13ull);
    const auto RtxPortalDiag = DualRenderer.TraceCoupledRadianceRay(GpuTracingTier::HardwareRayTracingRtx, CamPos, PortalAim, OptCtx, 13ull);
    std::snprintf(
        Note,
        sizeof(Note),
        "gtx(portal=%u hit=%d G=%.3f) rtx(portal=%u hit=%d G=%.3f)",
        GtxPortalDiag.PortalTransitions,
        GtxPortalDiag.HitSolidGeometry ? 1 : 0,
        GtxPortalDiag.FinalRadianceRgb.Y,
        RtxPortalDiag.PortalTransitions,
        RtxPortalDiag.HitSolidGeometry ? 1 : 0,
        RtxPortalDiag.FinalRadianceRgb.Y);
    Ledger.Verify(
        GtxPortalDiag.PortalTransitions == 1u && RtxPortalDiag.PortalTransitions == 1u &&
            GtxPortalDiag.HitSolidGeometry && RtxPortalDiag.HitSolidGeometry &&
            GtxPortalDiag.FinalRadianceRgb.Y > GtxPortalDiag.FinalRadianceRgb.X,
        "Seamless Portals in BOTH GTX SDF & RTX teleport rays accurately",
        Note);

    // 15c: Trace Puddle Water reflection ray reflecting PlumeFluid + Volumetric Clouds!
    const Vec3 PuddleAim = Normalise(Vec3{0.8f, 0.0f, 0.01f} - CamPos);
    const auto GtxWaterDiag = DualRenderer.TraceCoupledRadianceRay(GpuTracingTier::SignedDistanceFieldGtx, CamPos, PuddleAim, OptCtx, 19ull);
    const auto RtxWaterDiag = DualRenderer.TraceCoupledRadianceRay(GpuTracingTier::HardwareRayTracingRtx, CamPos, PuddleAim, OptCtx, 19ull);
    std::snprintf(
        Note,
        sizeof(Note),
        "gtx_water=%d(plume=%.3f) rtx_water=%d(plume=%.3f)",
        GtxWaterDiag.HitWaterSurface ? 1 : 0,
        GtxWaterDiag.PlumeOpticalOpacity,
        RtxWaterDiag.HitWaterSurface ? 1 : 0,
        RtxWaterDiag.PlumeOpticalOpacity);
    Ledger.Verify(
        GtxWaterDiag.HitWaterSurface && RtxWaterDiag.HitWaterSurface &&
            GtxWaterDiag.PlumeOpticalOpacity > 0.05f && RtxWaterDiag.PlumeOpticalOpacity > 0.05f,
        "2.5D Puddle Water Fresnel reflects Plume Smoke/Fire & Clouds (0 foam/splash)",
        Note);

    // -----------------------------------------------------------------------------------------------------------------
    // SUITE 16 & 17: VehicleCabinHmiExtension + Rendered PNG Visual Evidence Generation
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 16 & 17: Vehicle Cabin/HUD HMI & Visual Proof PNG Synthesis ---\n");
    VehicleCabinHmiExtension CabinHmi{};
    VehicleCabinTelemetryFrame HmiTel{};
    HmiTel.VehicleSpeedMps        = 48.5f; // 175 km/h
    HmiTel.EngineOrMotorRpm       = 7180.0f;
    HmiTel.RedlineRpm             = 7500.0f;
    HmiTel.EngagedGear            = 5;
    HmiTel.ThrottlePedal01        = 0.92f;
    HmiTel.BrakePedal01           = 0.08f;
    HmiTel.LateralG               = 0.84f;
    HmiTel.LongitudinalG          = 0.42f;
    HmiTel.ManifoldBoostBar       = 1.45f;
    HmiTel.NitrousPurgingOrActive = true;
    HmiTel.RainIntensity01        = 0.72f;
    HmiTel.GroundSnowPeakCm       = 34.0f;
    HmiTel.AquaplaningWarning     = true;
    HmiTel.LightningProximityWarn = true;
    HmiTel.Wheels[0]              = {362.0f, 232.0f, 0.74f, 4.2f, 0.15f, 0.04f, false};
    HmiTel.Wheels[1]              = {368.0f, 234.0f, 0.71f, 4.6f, 0.15f, 0.04f, false};
    HmiTel.Wheels[2]              = {412.0f, 244.0f, 0.48f, 2.8f, 0.35f, 0.14f, true};
    HmiTel.Wheels[3]              = {418.0f, 246.0f, 0.46f, 2.9f, 0.35f, 0.14f, true};

    const CabinHmiAlertDigest HmiAlerts = VehicleCabinHmiExtension::EvaluateAlerts(HmiTel);
    std::vector<uint8_t>      ClusterImg, ScreenImg, HudImg;
    CabinHmi.SynthesizeInstrumentClusterRgba8(640u, 140u, HmiTel, ClusterImg);
    CabinHmi.SynthesizeCentralScreenRgba8(640u, 220u, HmiTel, ScreenImg);
    CabinHmi.SynthesizeWindshieldHudRgba8(384u, 240u, HmiTel, HudImg);

    std::snprintf(
        Note,
        sizeof(Note),
        "apps=%zu shift_leds=%u redline=%d traction_warn=%d thermal_warn=%d weather_warn=%d",
        VehicleCabinHmiExtension::Catalogue().size(),
        HmiAlerts.ActiveShiftLedCount,
        HmiAlerts.RedlineShiftFlash ? 1 : 0,
        HmiAlerts.TractionHazardLamp ? 1 : 0,
        HmiAlerts.ThermalWarningLamp ? 1 : 0,
        HmiAlerts.SevereWeatherBanner ? 1 : 0);
    Ledger.Verify(
        VehicleCabinHmiExtension::Catalogue().size() == 12u && HmiAlerts.ActiveShiftLedCount >= 9u &&
            HmiAlerts.RedlineShiftFlash && HmiAlerts.TractionHazardLamp &&
            HmiAlerts.ThermalWarningLamp && HmiAlerts.SevereWeatherBanner,
        "VehicleCabinHmi 12-app catalogue, shift LEDs & hazard telltales",
        Note);

    // Render HD visual proof images into Exhibits/WorldSimulationAndSdfValidation/Images/!
    const bool        SanitizerFast = (std::getenv("FRONTIER_SANITIZER_VIEWPORT") != nullptr);
    const uint32_t    HdWidth       = SanitizerFast ? 240u : 960u;
    const uint32_t    HdHeight      = SanitizerFast ? 135u : 540u;
    const uint32_t    GtxWidth      = SanitizerFast ? 192u : 640u;
    const uint32_t    GtxHeight     = SanitizerFast ? 108u : 360u;
    const std::string ImgDir        = SanitizerFast ? "/tmp/frontier-san-images/" : "Exhibits/WorldSimulationAndSdfValidation/Images/";

    std::vector<uint8_t> GtxFrameRgba, RtxFrameRgba;
    DualRenderer.RenderViewportRgba8(
        GpuTracingTier::SignedDistanceFieldGtx,
        GtxWidth,
        GtxHeight,
        CamPos,
        {2.0f, 0.0f, 1.45f},
        0.92f,
        OptCtx,
        GtxFrameRgba);
    DualRenderer.RenderViewportRgba8(
        GpuTracingTier::HardwareRayTracingRtx,
        HdWidth,
        HdHeight,
        CamPos,
        {2.0f, 0.0f, 1.45f},
        0.92f,
        OptCtx,
        RtxFrameRgba);

    // Scene 3: Smooth High-Resolution Snowpack (160x160 @ 7.5 cm + Marching-Squares Contour + Smooth Normals + Subsurface)
    //          with Curved Dual-Wheel Wong-Bekker Tyre Ruts, Cleaved Fracture Hulls & Swept Motion-Stretched Sparks!
    SnowpackDomainSpec HdSnowSpec{};
    HdSnowSpec.CellsX                    = 160u;
    HdSnowSpec.CellsY                    = 160u;
    HdSnowSpec.CellSizeMetres            = 0.075f;
    HdSnowSpec.OriginX                   = -2.2f;
    HdSnowSpec.OriginY                   = -6.2f;
    HdSnowSpec.AmbientTemperatureKelvin  = 268.15f;
    HdSnowSpec.SurfaceInclusionThreshold = 0.004f;
    SnowpackAccumulationExtension HdSnowpack{HdSnowSpec};

    // Sculpt organic wind-drifted snowpack + deep snow pit (leaving foreground-right dark mineral asphalt exposed so the
    // smooth Marching-Squares 3D snow perimeter is unmistakably a growing 3D PolygonSurface, NEVER floor whitening!).
    HdSnowpack.SculptSnowPitOrDrift(4.5f, +0.65f, 3.85f, 0.42f, 155.0f);
    HdSnowpack.SculptSnowPitOrDrift(2.2f, +1.55f, 2.55f, 0.26f, 145.0f);
    HdSnowpack.SculptSnowPitOrDrift(6.4f, -0.55f, 2.85f, 0.31f, 150.0f);

    // Carve smooth curved dual-track left & right tyre ruts through the deep snowdrift!
    for (int Step = 0; Step < 64; ++Step)
    {
        const float T       = static_cast<float>(Step) / 63.0f;
        const float PathX   = 0.95f + T * 6.60f;
        const float Curve   = 0.58f * std::sin(T * 2.45f);
        const float Slope   = 0.58f * 2.45f * std::cos(T * 2.45f) / 6.60f;
        const Vec3  Tangent = Normalise(Vec3{1.0f, Slope, 0.0f});
        const Vec3  Lat     = Normalise(Vec3{-Tangent.Y, Tangent.X, 0.0f});

        for (float Side : {-0.76f, +0.76f})
        {
            SnowWheelRutInput RutIn{};
            RutIn.WheelContactWorld = Vec3{PathX, 0.55f + Curve, 0.0f} + Lat * Side;
            RutIn.WheelForwardWorld = Tangent;
            RutIn.TyreWidthMetres   = 0.310f;
            RutIn.TyreRadiusMetres  = 0.345f;
            RutIn.NormalLoadNewtons = 4650.0f;
            RutIn.WheelForwardSpeed = 11.5f;
            (void)HdSnowpack.CarveWheelRutAndEvaluateResistance(RutIn);
        }
    }
    HdSnowpack.RebuildContiguousPolygonSurfaces(ParkedCar);

    // Verify smooth vertex-normal continuity across adjacent snow triangles (eliminating flat grid faceting!).
    const auto& HdSnowSurf         = HdSnowpack.GroundPolygonSurface();
    uint32_t    SmoothNormalCount  = 0u;
    for (const auto& V : HdSnowSurf.Vertices)
    {
        if (V.Normal.Z > 0.25f && (std::abs(V.Normal.X) > 1.0e-3f || std::abs(V.Normal.Y) > 1.0e-3f))
        {
            ++SmoothNormalCount;
        }
    }
    std::snprintf(
        Note,
        sizeof(Note),
        "snow_verts=%zu snow_tris=%zu sloped_smooth_verts=%u peak=%.3f m",
        HdSnowSurf.Vertices.size(),
        HdSnowSurf.Indices.size() / 3u,
        SmoothNormalCount,
        HdSnowSurf.PeakThicknessM);
    Ledger.Verify(
        HdSnowSurf.Vertices.size() > 1500u && SmoothNormalCount > 400u && HdSnowSurf.PeakThicknessM > 0.25f,
        "Smooth Marching-Squares 3D snow PolygonSurface & smooth rut normals",
        Note);

    SdfRestirPortalExtension SnowSparkScene{};
    SnowSparkScene.RegisterTexturedGroundSlab({0.0f, 0.0f, -0.25f}, {36.0f, 36.0f, 0.25f}, {0.13f, 0.15f, 0.19f}, 0.44f, 0.05f);
    SnowSparkScene.RegisterSmoothSnowSurface(HdSnowSurf);

    // Cleave a low-profile roadside jersey barrier on the exposed dark mineral asphalt beside the snowbank!
    const ConvexSolidFragment JerseyBlock = SolidFractureExtension::CreateIntactBoxSolid(
        {3.35f, -1.95f, 0.44f},
        {0.58f, 0.26f, 0.44f},
        2380.0f);
    FractureImpactDescriptor BarrierHit{};
    BarrierHit.ImpactPointWorld     = {3.05f, -1.95f, 0.52f};
    BarrierHit.ImpactDirection      = {0.85f, 0.35f, 0.25f};
    BarrierHit.ImpactKineticEnergyJ = 7200.0f;
    BarrierHit.ImpulseNewtonSeconds = 1350.0f;
    BarrierHit.AnchoredBaseAtMinZ   = true;
    BarrierHit.DeterministicSeed    = 0x777BEEFull;
    std::vector<ConvexSolidFragment>   BarrierFrags;
    std::vector<FragmentAdjacencyBond> BarrierBonds;
    (void)FractureEngine.CleaveConvexSolid(
        JerseyBlock,
        LookupFractureMaterialProperties(FractureMaterialPreset::ReinforcedConcrete),
        BarrierHit,
        BarrierFrags,
        BarrierBonds);

    for (size_t F = 0u; F < BarrierFrags.size(); ++F)
    {
        const Vec3  Disp = BarrierFrags[F].AnchoredIntact ? Vec3{0.0f, 0.0f, 0.0f} : (BarrierFrags[F].LinearVelocityMps * 0.09f);
        const auto& Ps   = BarrierFrags[F].PolygonSurface;
        for (size_t T = 0u; T + 2u < Ps.Indices.size(); T += 3u)
        {
            RtxSceneTriangle FragTri{};
            FragTri.V0        = Ps.Vertices[Ps.Indices[T + 0u]] + Disp;
            FragTri.V1        = Ps.Vertices[Ps.Indices[T + 1u]] + Disp;
            FragTri.V2        = Ps.Vertices[Ps.Indices[T + 2u]] + Disp;
            FragTri.Normal    = Ps.Normals[T / 3u];
            FragTri.AlbedoRgb = {0.46f, 0.44f, 0.42f};
            FragTri.Roughness = 0.66f;
            SnowSparkScene.RegisterPolygonTriangle(FragTri);
        }
    }

    // True swept ballistic spark shower (rendered natively as anti-aliased motion-stretched capsules, ZERO solid cubes!)
    BallisticSparkConfig VisSparkCfg{};
    VisSparkCfg.SceneLuminanceGain  = 2.6f;
    BallisticSparkExtension VisSparks{VisSparkCfg};
    MetallicScrapeContact   VisScrape{};
    VisScrape.ContactPointWorld     = {2.85f, -1.78f, 0.46f};
    VisScrape.TangentialVelocityMps = {9.5f, 2.4f, 3.1f};
    VisScrape.NormalForceNewtons    = 6200.0f;
    VisScrape.RequestedSparkCount   = 68u;
    VisSparks.SpawnScrapeSparks(VisScrape);
    for (int S = 0; S < 7; ++S)
    {
        VisSparks.StepBallisticSparks(1.0f / 60.0f);
    }

    CoupledWorldOpticalContext DuskSparkCtx = OptCtx;
    // Low grazing golden-winter sun reveals every smooth 3D snowdrift contour & rounded dual tyre rut without whiteout!
    DuskSparkCtx.SunDirectionUnit           = Normalise(Vec3{-0.56f, -0.78f, 0.27f});
    DuskSparkCtx.SunIrradianceRgb           = {5.2f, 4.5f, 3.9f};
    DuskSparkCtx.Clouds.Coverage            = 0.38;
    DuskSparkCtx.Fog.DensityAtBase          = 0.0025;
    DuskSparkCtx.HdrBloomStrength           = 0.26f;
    DuskSparkCtx.ExposureScale              = 0.72f;
    DuskSparkCtx.PlumeFluid                 = nullptr;
    DuskSparkCtx.ShallowWater               = nullptr;
    DuskSparkCtx.Lightning                  = nullptr;
    DuskSparkCtx.Sparks                     = &VisSparks;
    SnowSparkScene.FinalizeSceneAndBakeSurfaceCards(DuskSparkCtx);

    std::vector<uint8_t> SnowSparkRgba;
    SnowSparkScene.RenderViewportRgba8(
        GpuTracingTier::HardwareRayTracingRtx,
        HdWidth,
        HdHeight,
        {-0.45f, -3.65f, 1.88f},
        {4.25f, +0.20f, 0.18f},
        0.84f,
        DuskSparkCtx,
        SnowSparkRgba);

    // -----------------------------------------------------------------------------------------------------------------
    // SUITE 18: Split-Vehicle Two-Portal Transit (Entering Portal 1, Hidden Behind Portal 1, Emerging From Portal 2!)
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 18: Split-Vehicle Two-Portal Transit (Hidden Behind Portal 1, Emerging Out of Portal 2) ---\n");
    SdfRestirPortalExtension PortalVehicleScene{};
    PortalVehicleScene.RegisterTexturedGroundSlab({0.0f, 0.0f, -0.25f}, {48.0f, 48.0f, 0.25f}, {0.21f, 0.23f, 0.27f}, 0.42f, 0.06f);

    // Architectural backdrop colonnade far behind both free-standing portals so empty space behind Portal 1 is unmistakable!
    for (int Col = -3; Col <= 3; ++Col)
    {
        PortalVehicleScene.RegisterDualTierSolidBox(
            {static_cast<float>(Col) * 3.4f, 8.8f, 1.85f},
            {0.34f, 0.34f, 1.85f},
            {0.46f, 0.48f, 0.53f},
            0.52f,
            {0.0f, 0.0f, 0.0f},
            0.08f);
    }

    // Portal 1 (Left, Cyan Energy Gateway) -> Portal 2 (Right, Amber-Gold Energy Gateway)!
    // Vehicle drives along CarTransitForward INTO Portal 1, so EntryFrontNormal = -CarTransitForward.
    const Vec3 CarTransitForward = Normalise(Vec3{+0.78f, +0.625f, 0.0f});
    const Vec3 EntryFrontN       = -CarTransitForward;
    const Vec3 EntryUpN          = {0.0f, 0.0f, 1.0f};
    const Vec3 EntryRightN       = Normalise(Cross(EntryUpN, EntryFrontN));

    const Vec3 ExitFrontN        = Normalise(Vec3{+0.46f, -0.888f, 0.0f});
    const Vec3 ExitUpN           = {0.0f, 0.0f, 1.0f};
    const Vec3 ExitRightN        = Normalise(Cross(ExitUpN, ExitFrontN));

    SeamlessPortalAperture TransitPortalFwd{};
    TransitPortalFwd.EntryCentreWorld = {-2.45f, +0.25f, 1.25f};
    TransitPortalFwd.EntryRightAxis   = EntryRightN;
    TransitPortalFwd.EntryUpAxis      = EntryUpN;
    TransitPortalFwd.EntryFrontNormal = EntryFrontN;
    TransitPortalFwd.ExitCentreWorld  = {+2.35f, +0.75f, 1.25f};
    TransitPortalFwd.ExitRightAxis    = ExitRightN;
    TransitPortalFwd.ExitUpAxis       = ExitUpN;
    TransitPortalFwd.ExitFrontNormal  = ExitFrontN;
    TransitPortalFwd.HalfWidthMetres  = 1.58f;
    TransitPortalFwd.HalfHeightMetres = 1.25f;
    TransitPortalFwd.PortalRimGlowRgb = {0.12f, 0.86f, 1.45f}; // Vivid Cyan Portal 1!

    // Paired reverse aperture so rays entering Portal 2's front face also teleport seamlessly back to Portal 1!
    SeamlessPortalAperture TransitPortalRev{};
    TransitPortalRev.EntryCentreWorld = TransitPortalFwd.ExitCentreWorld;
    TransitPortalRev.EntryRightAxis   = TransitPortalFwd.ExitRightAxis;
    TransitPortalRev.EntryUpAxis      = TransitPortalFwd.ExitUpAxis;
    TransitPortalRev.EntryFrontNormal = TransitPortalFwd.ExitFrontNormal;
    TransitPortalRev.ExitCentreWorld  = TransitPortalFwd.EntryCentreWorld;
    TransitPortalRev.ExitRightAxis    = TransitPortalFwd.EntryRightAxis;
    TransitPortalRev.ExitUpAxis       = TransitPortalFwd.EntryUpAxis;
    TransitPortalRev.ExitFrontNormal  = TransitPortalFwd.EntryFrontNormal;
    TransitPortalRev.HalfWidthMetres  = TransitPortalFwd.HalfWidthMetres;
    TransitPortalRev.HalfHeightMetres = TransitPortalFwd.HalfHeightMetres;
    TransitPortalRev.PortalRimGlowRgb = {1.45f, 0.62f, 0.12f}; // Vivid Amber Portal 2!

    PortalVehicleScene.RegisterSeamlessPortal(TransitPortalFwd);
    PortalVehicleScene.RegisterSeamlessPortal(TransitPortalRev);
    RegisterPortalGatewayFrame(
        PortalVehicleScene,
        TransitPortalFwd.EntryCentreWorld,
        EntryRightN,
        EntryUpN,
        EntryFrontN,
        TransitPortalFwd.HalfWidthMetres,
        TransitPortalFwd.HalfHeightMetres,
        {0.10f, 0.78f, 1.35f});
    RegisterPortalGatewayFrame(
        PortalVehicleScene,
        TransitPortalFwd.ExitCentreWorld,
        ExitRightN,
        ExitUpN,
        ExitFrontN,
        TransitPortalFwd.HalfWidthMetres,
        TransitPortalFwd.HalfHeightMetres,
        {1.35f, 0.56f, 0.10f});

    // Position the authored 8,460-facet PROTO-X sports car straddling Portal 1 (rear half in front of Portal 1,
    // front half inside Portal 1 -> clipped/hidden behind Portal 1 and emerging out of Portal 2!).
    // Z = +0.055 m places the outer tyre tread rubber cleanly tangent to the Z = 0 plaza slab!
    uint32_t   SourceVehicleFacets = 0u;
    const Vec3 CarPortalMidpoint   = {-2.45f, +0.25f, 0.095f};
    const bool LoadedTransitCar    = RegisterTransitingControlVehicle(
        PortalVehicleScene,
        "Frontier/Projects/Project-Drive/Content/Geometry",
        CarPortalMidpoint,
        CarTransitForward,
        TransitPortalFwd,
        SourceVehicleFacets);

    CoupledWorldOpticalContext PortalCarCtx{};
    PortalCarCtx.Atmosphere       = Atmos;
    PortalCarCtx.AtmosphereLut    = &SkyLut;
    PortalCarCtx.Clouds.Coverage  = 0.34;
    PortalCarCtx.Fog.DensityAtBase = 0.0025;
    PortalCarCtx.SunDirectionUnit = Normalise(Vec3{-0.45f, -0.68f, 0.58f});
    PortalCarCtx.SunIrradianceRgb = {11.8f, 11.2f, 10.5f};
    PortalCarCtx.ExposureScale    = 0.84f;
    PortalVehicleScene.FinalizeSceneAndBakeSurfaceCards(PortalCarCtx);

    // Numeric Ray-Probe Proof of Split-Vehicle Portal Clipping & Emergence:
    // 1. Vertical downward probe onto the REAR half 1.15 m in front of Portal 1 hits the rear deck/roof!
    const Vec3 RearDeckInFrontOfP1 = Vec3{-2.45f, +0.25f, 0.0f} - CarTransitForward * 1.15f + Vec3{0.0f, 0.0f, 2.20f};
    const auto ProbeRearDiag       = PortalVehicleScene.TraceCoupledRadianceRay(
        GpuTracingTier::HardwareRayTracingRtx,
        RearDeckInFrontOfP1,
        {0.0f, 0.0f, -1.0f},
        PortalCarCtx,
        101ull);

    // 2. Vertical upward probe 1.15 m BEHIND Portal 1 (from Z = 0.10 m straight up through Z = 0.25..1.15 m where the
    //    unclipped front hood/chassis would sit!) reaches pure sky without hitting ANY solid geometry!
    const Vec3 GhostHoodBehindP1       = Vec3{-2.45f, +0.25f, 0.10f} + CarTransitForward * 1.15f;
    const auto ProbeHiddenBehindP1Diag = PortalVehicleScene.TraceCoupledRadianceRay(
        GpuTracingTier::HardwareRayTracingRtx,
        GhostHoodBehindP1,
        {0.0f, 0.0f, +1.0f},
        PortalCarCtx,
        103ull);

    // 3. Vertical downward probe onto the EMERGED front half 1.15 m in front of Portal 2 hits the emerged hood!
    const Vec3 EmergedHoodInFrontOfP2 = Vec3{+2.35f, +0.75f, 0.0f} + ExitFrontN * 1.15f + Vec3{0.0f, 0.0f, 2.20f};
    const auto ProbeEmergedFrontDiag  = PortalVehicleScene.TraceCoupledRadianceRay(
        GpuTracingTier::HardwareRayTracingRtx,
        EmergedHoodInFrontOfP2,
        {0.0f, 0.0f, -1.0f},
        PortalCarCtx,
        107ull);

    // 4. Vertical upward probe 1.15 m BEHIND Portal 2 (from Z = 0.10 m straight up where the unclipped rear body
    //    would sit!) reaches pure sky without hitting ANY solid geometry!
    const Vec3 GhostRearBehindP2       = Vec3{+2.35f, +0.75f, 0.10f} - ExitFrontN * 1.15f;
    const auto ProbeHiddenBehindP2Diag = PortalVehicleScene.TraceCoupledRadianceRay(
        GpuTracingTier::HardwareRayTracingRtx,
        GhostRearBehindP2,
        {0.0f, 0.0f, +1.0f},
        PortalCarCtx,
        109ull);

    std::snprintf(
        Note,
        sizeof(Note),
        "src_facets=%u rear_P1=%d(R=%.2f) behind_P1_hit=%d emerged_P2=%d(R=%.2f) behind_P2_hit=%d",
        SourceVehicleFacets,
        ProbeRearDiag.HitSolidGeometry ? 1 : 0,
        ProbeRearDiag.FinalRadianceRgb.X,
        ProbeHiddenBehindP1Diag.HitSolidGeometry ? 1 : 0,
        ProbeEmergedFrontDiag.HitSolidGeometry ? 1 : 0,
        ProbeEmergedFrontDiag.FinalRadianceRgb.X,
        ProbeHiddenBehindP2Diag.HitSolidGeometry ? 1 : 0);
    Ledger.Verify(
        LoadedTransitCar && SourceVehicleFacets > 8000u &&
            ProbeRearDiag.HitSolidGeometry && !ProbeHiddenBehindP1Diag.HitSolidGeometry &&
            ProbeEmergedFrontDiag.HitSolidGeometry && !ProbeHiddenBehindP2Diag.HitSolidGeometry,
        "Split-vehicle portal transit: hidden behind Portal 1 & emerging from Portal 2",
        Note);

    std::vector<uint8_t> PortalVehicleRgba;
    PortalVehicleScene.RenderViewportRgba8(
        GpuTracingTier::HardwareRayTracingRtx,
        HdWidth,
        HdHeight,
        {-0.15f, -6.95f, 2.38f},
        {+0.15f, +0.55f, 0.88f},
        0.82f,
        PortalCarCtx,
        PortalVehicleRgba);

    // -----------------------------------------------------------------------------------------------------------------
    // SUITE 19: Limb-Darkened Solar Disc & Multi-Element Optical Camera Lens Flare (LensFlareModel.h Integration!)
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 19: Limb-Darkened Solar Disc & Multi-Element Camera Lens Flare ---\n");
    SdfRestirPortalExtension SunFlareScene{};
    SunFlareScene.RegisterTexturedGroundSlab({0.0f, 0.0f, -0.25f}, {60.0f, 60.0f, 0.25f}, {0.19f, 0.21f, 0.25f}, 0.36f, 0.08f);

    // Architectural stone pillars framing the sunlit reflecting basin without blocking the solar disc!
    SunFlareScene.RegisterDualTierSolidBox({-4.4f, 9.5f, 2.4f}, {0.55f, 0.55f, 2.4f}, {0.36f, 0.38f, 0.42f}, 0.45f, {0.0f, 0.0f, 0.0f}, 0.10f);
    SunFlareScene.RegisterDualTierSolidBox({+4.8f, 9.5f, 2.4f}, {0.55f, 0.55f, 2.4f}, {0.36f, 0.38f, 0.42f}, 0.45f, {0.0f, 0.0f, 0.0f}, 0.10f);
    SunFlareScene.RegisterDualTierSolidBox({+2.6f, 5.2f, 0.95f}, {0.42f, 0.42f, 0.95f}, {0.42f, 0.40f, 0.38f}, 0.40f, {0.0f, 0.0f, 0.0f}, 0.12f);

    ShallowWaterConfiguration FlareBasinCfg = LakeCfg;
    FlareBasinCfg.CellsX                    = 144u;
    FlareBasinCfg.CellsY                    = 144u;
    FlareBasinCfg.CellSizeMetres            = 0.095f;
    FlareBasinCfg.WorldOriginXY             = {-6.8f, -1.2f};
    ShallowWaterMudExtension FlareBasin{FlareBasinCfg};
    FlareBasin.SculptBedDepressionOrMound({0.0f, 5.5f}, 5.4f, -0.08f);
    FlareBasin.FillBasinRegion({0.0f, 5.5f}, 5.1f, 0.02f, 0.0f);
    for (int Relax = 0; Relax < 14; ++Relax)
    {
        (void)FlareBasin.StepSimulation(1.0f / 120.0f);
    }

    CoupledWorldOpticalContext SunFlareCtx{};
    SunFlareCtx.Atmosphere                   = Atmos;
    SunFlareCtx.AtmosphereLut                = &SkyLut;
    SunFlareCtx.Clouds.Coverage              = 0.22;
    SunFlareCtx.Fog.DensityAtBase            = 0.002;
    // Place Sun in upper-left quadrant of camera view so diagonal coated aperture ghosts march cleanly to lower-right!
    SunFlareCtx.SunDirectionUnit             = Normalise(Vec3{-0.33f, +0.885f, 0.328f});
    SunFlareCtx.SunIrradianceRgb             = {14.5f, 13.4f, 11.8f};
    SunFlareCtx.ShallowWater                 = &FlareBasin;
    SunFlareCtx.WaterCapillaryRippleStrength = 0.010f;
    SunFlareCtx.EnableSolarLensFlare         = true;
    SunFlareCtx.SolarDisc.AngularRadiusRad   = 0.0165; // Crisp visible solar disc with limb darkening!
    SunFlareCtx.LensFlareOptics.ApertureBlades        = 6u;
    SunFlareCtx.LensFlareOptics.ApertureRotationRad   = 0.22;
    SunFlareCtx.LensFlareOptics.GhostStrength         = 2.6;
    SunFlareCtx.LensFlareOptics.StarburstStrength     = 2.2;
    SunFlareCtx.LensFlareOptics.StarburstLengthNdc    = 0.65;
    SunFlareCtx.LensFlareOptics.AnamorphicStrength    = 1.4;
    SunFlareCtx.LensFlareOptics.StreakStrength        = 1.6;
    SunFlareCtx.LensFlareOptics.StreakAngleRad        = -0.45;
    SunFlareCtx.LensFlareOptics.GlowStrength          = 1.8;
    SunFlareCtx.LensFlareOptics.HaloStrength          = 2.1;
    SunFlareCtx.LensFlareOptics.VeilingStrength       = 0.45;
    SunFlareCtx.HdrBloomStrength             = 0.30f;
    SunFlareCtx.ExposureScale                = 0.74f;
    SunFlareScene.FinalizeSceneAndBakeSurfaceCards(SunFlareCtx);

    const Vec3 FlareCamPos{0.0f, -4.8f, 1.55f};
    const Vec3 FlareCamTarget{0.0f, +6.0f, 1.95f};

    // Verify direct solar disc radiance vs off-disc sky AND verify flare difference (FlareEnabled vs FlareDisabled)!
    const auto DirectSunRay = SunFlareScene.TraceCoupledRadianceRay(
        GpuTracingTier::HardwareRayTracingRtx,
        FlareCamPos,
        SunFlareCtx.SunDirectionUnit,
        SunFlareCtx,
        211ull);
    const auto OffSunSkyRay = SunFlareScene.TraceCoupledRadianceRay(
        GpuTracingTier::HardwareRayTracingRtx,
        FlareCamPos,
        Normalise(Vec3{+0.35f, +0.88f, 0.32f}),
        SunFlareCtx,
        213ull);

    std::vector<uint8_t> SunFlareRgba, FlareDisabledRgba;
    SunFlareScene.RenderViewportRgba8(
        GpuTracingTier::HardwareRayTracingRtx,
        HdWidth,
        HdHeight,
        FlareCamPos,
        FlareCamTarget,
        0.84f,
        SunFlareCtx,
        SunFlareRgba);

    CoupledWorldOpticalContext NoFlareCtx = SunFlareCtx;
    NoFlareCtx.EnableSolarLensFlare       = false;
    SunFlareScene.RenderViewportRgba8(
        GpuTracingTier::HardwareRayTracingRtx,
        160u,
        90u,
        FlareCamPos,
        FlareCamTarget,
        0.84f,
        NoFlareCtx,
        FlareDisabledRgba);
    std::vector<uint8_t> FlareEnabledRgba;
    SunFlareScene.RenderViewportRgba8(
        GpuTracingTier::HardwareRayTracingRtx,
        160u,
        90u,
        FlareCamPos,
        FlareCamTarget,
        0.84f,
        SunFlareCtx,
        FlareEnabledRgba);

    // Measure off-axis antipode ghost & streak luminance boost in lower-right quadrant (away from the Sun in upper-left)!
    double OffAxisDiffSum = 0.0;
    for (uint32_t Y = 48u; Y < 86u; ++Y)
    {
        for (uint32_t X = 84u; X < 154u; ++X)
        {
            const size_t Idx = (static_cast<size_t>(Y) * 160u + X) * 4u;
            const double LumWith = 0.2126 * FlareEnabledRgba[Idx + 0u] + 0.7152 * FlareEnabledRgba[Idx + 1u] + 0.0722 * FlareEnabledRgba[Idx + 2u];
            const double LumNo   = 0.2126 * FlareDisabledRgba[Idx + 0u] + 0.7152 * FlareDisabledRgba[Idx + 1u] + 0.0722 * FlareDisabledRgba[Idx + 2u];
            OffAxisDiffSum += std::max(0.0, LumWith - LumNo);
        }
    }
    const double MeanGhostBoost = OffAxisDiffSum / static_cast<double>((86u - 48u) * (154u - 84u));
    std::snprintf(
        Note,
        sizeof(Note),
        "sun_disc_R=%.1f sky_R=%.2f lower_right_ghost_boost=+%.2f_srgb8",
        DirectSunRay.FinalRadianceRgb.X,
        OffSunSkyRay.FinalRadianceRgb.X,
        MeanGhostBoost);
    Ledger.Verify(
        DirectSunRay.FinalRadianceRgb.X > OffSunSkyRay.FinalRadianceRgb.X * 12.0f && MeanGhostBoost > 2.5,
        "Limb-darkened Sun disc & multi-element coated aperture lens flare",
        Note);

    // Composite Cluster (640x140) + Central Screen (640x220) into 640x360 VehicleCabinHmiComposite.png!
    std::vector<uint8_t> HmiComposite;
    HmiComposite.reserve(ClusterImg.size() + ScreenImg.size());
    HmiComposite.insert(HmiComposite.end(), ClusterImg.begin(), ClusterImg.end());
    HmiComposite.insert(HmiComposite.end(), ScreenImg.begin(), ScreenImg.end());

    const bool Png1 = WriteRgba8PngFile(ImgDir + "GtxSdfPortalMirrorPlumeWater.png", GtxWidth, GtxHeight, GtxFrameRgba);
    const bool Png2 = WriteRgba8PngFile(ImgDir + "RtxBvhPortalMirrorPlumeWater.png", HdWidth, HdHeight, RtxFrameRgba);
    const bool Png3 = WriteRgba8PngFile(ImgDir + "SnowPitRutAndFractureSparks.png", HdWidth, HdHeight, SnowSparkRgba);
    const bool Png4 = WriteRgba8PngFile(ImgDir + "VehicleCabinHmiComposite.png", 640u, 360u, HmiComposite);
    const bool Png5 = WriteRgba8PngFile(ImgDir + "PortalSplitVehicleTransit960x540.png", HdWidth, HdHeight, PortalVehicleRgba);
    const bool Png6 = WriteRgba8PngFile(ImgDir + "SolarDiscAndOpticalLensFlare960x540.png", HdWidth, HdHeight, SunFlareRgba);

    std::snprintf(
        Note,
        sizeof(Note),
        "png_ok=(%d,%d,%d,%d,%d,%d)",
        Png1 ? 1 : 0,
        Png2 ? 1 : 0,
        Png3 ? 1 : 0,
        Png4 ? 1 : 0,
        Png5 ? 1 : 0,
        Png6 ? 1 : 0);
    Ledger.Verify(
        Png1 && Png2 && Png3 && Png4 && Png5 && Png6,
        "Rendered 6 HD visual proof PNGs (Water, Snow, Split-Portal Vehicle, Sun Flare, HMI)",
        Note);

    std::printf("\n====================================================================================================\n");
    std::printf("  SUMMARY: %u PASSED, %u FAILED\n", Ledger.Passed, Ledger.Failed);
    std::printf("====================================================================================================\n");

    return (Ledger.Failed == 0u) ? 0 : 1;
}
