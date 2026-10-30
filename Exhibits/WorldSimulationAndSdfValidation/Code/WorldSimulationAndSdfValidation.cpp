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
#include "Engine/Fluid/PlumeFluid.h"
#include "Engine/Fluid/ShallowWater.h"
#include "Engine/Gameplay/GameMechanics/PortalMechanics.h"
#include "Engine/Gameplay/GameMechanics/VehicleCabinHmi.h"
#include "Engine/GeometryProcessing/ClusterHierarchy.h"
#include "Engine/Particles/SkyPrecipitation.h"
#include "Engine/Particles/SparkParticles.h"
#include "Engine/Physics/Fracture/SolidFracture.h"
#include "Engine/Physics/RigidBodySolver.h"
#include "Engine/Rendering/BlinnRenderer.h"
#include "Engine/Rendering/ExposureAdaptation.h"
#include "Engine/Rendering/SceneRenderer.h"
#include "Engine/VisualEffects/LightningStorm.h"
#include "Engine/VisualEffects/SnowSurface.h"
#include "Engine/VisualEffects/WindField.h"

#include <algorithm>
#include <chrono>
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
    Frontier::SceneRenderer& Scene,
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
    Frontier::SceneRenderer& Scene,
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
    Frontier::SceneRenderer&   Scene,
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
    // SUITE 1 & 2: PlumeFluid Solid Obstacle Collision, Moving Wake, Volumetric Shadows & Fire Illumination
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 1 & 2: PlumeFluid Solid Collision, Wake, Volumetric Shadows & Fire Lighting ---\n");
    PlumeFluidParameters PlumeCfg{};
    PlumeCfg.Grade = PlumeQualityGrade::Medium;
    PlumeFluid Plume{PlumeCfg};

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
    // SUITE 3, 4, 5 & 6: 2.5D ShallowWaterSimulation (Lake-at-Rest, Cloud Rain Puddles, Bingham Mud, Nested Link)
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 3..6: 2.5D Saint-Venant Shallow-Water, Rain Puddles, Bingham Mud & Nested Link ---\n");
    ShallowWaterConfiguration LakeCfg{};
    LakeCfg.CellsX              = 48u;
    LakeCfg.CellsY              = 48u;
    LakeCfg.CellSizeMetres      = 0.50f;
    LakeCfg.WorldOriginXY       = {-12.0f, -12.0f};
    LakeCfg.InfiltrationRateMps = 0.0f;
    ShallowWaterSimulation LakeSolver{LakeCfg};
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
    ShallowWaterSimulation PuddleRoad{LakeCfg};
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
    ShallowWaterSimulation WaterSlope{LakeCfg};
    ShallowWaterSimulation MudSlope{LakeCfg};
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
    ShallowWaterSimulation CoarseWater{CoarseCfg};
    CoarseWater.SculptBedDepressionOrMound({0.0f, 0.0f}, 22.0f, -0.60f);
    CoarseWater.FillBasinRegion({0.0f, 0.0f}, 20.0f, -0.10f, 0.15f);

    LakeCfg.HoleCrossFadeMetres = 4.0f;
    ShallowWaterSimulation FineWater{LakeCfg};
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

    WindField WindField{};
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
    SnowSurface Snowpack{SnowSpec};

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
    SnowSurface HailPack{SnowSpec};
    ShallowWaterSimulation      MeltPuddle{LakeCfg};

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
    LightningStorm StormLightning{};
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
    SolidFracture FractureEngine{};
    const ConvexSolidFragment IntactPillar = SolidFracture::CreateIntactBoxSolid({0.0f, 0.0f, 1.2f}, {0.45f, 0.45f, 1.2f}, 2380.0f);

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
    // SUITE 13: SparkParticles Swept 3 mm Scene Collisions & Shadowed Scene Illumination
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 13: Swept Colliding Metallic Sparks & Shadowed Blackbody Scene Lighting ---\n");
    SparkParticles Sparks{};
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
    SceneRenderer DualRenderer{};
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
    ShallowWaterSimulation ScenePuddle{SceneWaterCfg};
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
    const auto Merged  = SceneRenderer::MergeSpatialReservoirs(GtxResA, GtxResB, {-2.2f, 2.5f, 0.05f}, {0.0f, 0.0f, 1.0f}, 99ull);
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
    // SUITE 16 & 17: VehicleCabinHmi + Rendered PNG Visual Evidence Generation
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 16 & 17: Vehicle Cabin/HUD HMI & Visual Proof PNG Synthesis ---\n");
    VehicleCabinHmi CabinHmi{};
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

    const CabinHmiAlertDigest HmiAlerts = VehicleCabinHmi::EvaluateAlerts(HmiTel);
    const bool LoadedHmiCarMeshes = CabinHmi.LoadControlVehicleMeshesForHmi("Frontier/Projects/Project-Drive/Content/Geometry");
    CabinHmi.SelectClusterOutline(ClusterOutlineShape::Hexagon);
    CabinHmi.SelectLauncherDesign(CabinLauncherDesign::SplitDashboard);
    CabinHmi.SelectActiveApplication(CabinApplicationSlot::GarageBay);
    CabinHmi.SelectGaragePaintSwatch(1u); // Crimson Corsa
    CabinHmi.SetGarageTurntableYawRadians(0.58f);

    std::vector<uint8_t> ClusterImg, ScreenImg, HudImg;
    CabinHmi.SynthesizeInstrumentClusterRgba8(960u, 240u, HmiTel, ClusterImg);
    CabinHmi.SynthesizeCentralScreenRgba8(960u, 540u, HmiTel, ScreenImg);
    CabinHmi.SynthesizeWindshieldHudRgba8(384u, 240u, HmiTel, HudImg);

    std::snprintf(
        Note,
        sizeof(Note),
        "apps=%zu car_3d=%d shift_leds=%u redline=%d traction_warn=%d thermal_warn=%d weather_warn=%d",
        VehicleCabinHmi::Catalogue().size(),
        LoadedHmiCarMeshes ? 1 : 0,
        HmiAlerts.ActiveShiftLedCount,
        HmiAlerts.RedlineShiftFlash ? 1 : 0,
        HmiAlerts.TractionHazardLamp ? 1 : 0,
        HmiAlerts.ThermalWarningLamp ? 1 : 0,
        HmiAlerts.SevereWeatherBanner ? 1 : 0);
    Ledger.Verify(
        LoadedHmiCarMeshes && VehicleCabinHmi::Catalogue().size() == 12u && HmiAlerts.ActiveShiftLedCount >= 9u &&
            HmiAlerts.RedlineShiftFlash && HmiAlerts.TractionHazardLamp &&
            HmiAlerts.ThermalWarningLamp && HmiAlerts.SevereWeatherBanner,
        "VehicleCabinHmi 12-SVG-icon catalogue, 3D ControlVehicle Garage & hexagonal cluster",
        Note);

    // Render HD visual proof images into Exhibits/WorldSimulationAndSdfValidation/Images/!
    const bool        SanitizerFast = (std::getenv("FRONTIER_SANITIZER_VIEWPORT") != nullptr);
    const uint32_t    HdWidth       = SanitizerFast ? 240u : 960u;
    const uint32_t    HdHeight      = SanitizerFast ? 135u : 540u;
    const uint32_t    GtxWidth      = SanitizerFast ? 192u : 640u;
    const uint32_t    GtxHeight     = SanitizerFast ? 108u : 360u;
    const std::string ImgDir        = SanitizerFast ? "/tmp/frontier-san-images/" : "Exhibits/WorldSimulationAndSdfValidation/Images/";

    // Upgrade PlumeFluid into a dramatic Experimental/Fluid hero_detonation fireball + billowing dark soot plume for the HD render!
    PlumeFluidParameters PyroParams{};
    PyroParams.Grade              = PlumeQualityGrade::High;
    PyroParams.Variant            = PlumeSolverVariant::ProductionUpgraded;
    PyroParams.MarchSampleLimit   = 112u;
    PyroParams.DetailStrength     = 1.18f;
    PyroParams.DetailFrequency    = 2.85f;
    PyroParams.SmokeExtinction    = 0.65f;
    PyroParams.SootExtinction     = 3.85f;
    PyroParams.SootAlbedo         = 0.032f;
    PyroParams.FlameRadianceScale = 36.0f;
    PlumeFluid HeroPyroPlume{PyroParams};
    // Lower fireball seat (roaring orange/gold flames) + upper dark billowing carbonaceous soot cloud!
    HeroPyroPlume.InjectDetonationBlast({2.2f, 0.15f, 1.05f}, 1.42f, 11.5f, 520.0f, 2.35f, 1.35f);
    HeroPyroPlume.InjectDetonationBlast({2.45f, -0.20f, 2.75f}, 1.65f, 8.5f, 95.0f, 0.0f, 3.40f);
    const std::array<float, 3> PyroSunArr = {OptCtx.SunDirectionUnit.X, OptCtx.SunDirectionUnit.Y, OptCtx.SunDirectionUnit.Z};
    double LastPyroStepMs = 0.0;
    for (int Step = 0; Step < 5; ++Step)
    {
        HeroPyroPlume.AppendTransientPlumeSource({2.15f, 0.10f, 0.48f}, 0.85f, {0.25f, 0.08f, 6.4f}, 0.03f, 540.0f, 4.6f, 2.8f);
        const auto T0 = std::chrono::steady_clock::now();
        (void)HeroPyroPlume.AdvanceSimulation({2.2f, 0.0f, 0.0f}, PyroSunArr, 1.0f / 30.0f);
        const auto T1 = std::chrono::steady_clock::now();
        LastPyroStepMs = std::chrono::duration<double, std::milli>(T1 - T0).count();
    }
    if (!SanitizerFast)
    {
        constexpr double BaselineDe61677StepMs = 281.827; // Measured de61677 High 192x192x96 baseline
        const double     SpeedRatio            = LastPyroStepMs / BaselineDe61677StepMs;
        std::snprintf(
            Note,
            sizeof(Note),
            "step_ms=%.2f baseline_de61677_ms=%.2f ratio=%.3fx (cap<=1.050x) baroclinic=%.2f expansion=%.2f",
            LastPyroStepMs,
            BaselineDe61677StepMs,
            SpeedRatio,
            PyroParams.BaroclinicStrength,
            PyroParams.CombustionExpansion);
        Ledger.Verify(
            SpeedRatio <= 1.050 && PyroParams.BaroclinicStrength > 0.0f && PyroParams.CombustionExpansion > 0.0f,
            "Upgraded PlumeFluid speed & quality within <= +5% runtime cap vs de61677",
            Note);
    }

    CoupledWorldOpticalContext PyroViewCtx = OptCtx;
    PyroViewCtx.PlumeFluid                 = &HeroPyroPlume;
    PyroViewCtx.HdrBloomStrength           = 0.26f;
    PyroViewCtx.ExposureScale              = 0.80f;

    std::vector<uint8_t> GtxFrameRgba, RtxFrameRgba;
    DualRenderer.RenderViewportRgba8(
        GpuTracingTier::SignedDistanceFieldGtx,
        GtxWidth,
        GtxHeight,
        CamPos,
        {2.0f, 0.0f, 1.55f},
        0.92f,
        PyroViewCtx,
        GtxFrameRgba);
    DualRenderer.RenderViewportRgba8(
        GpuTracingTier::HardwareRayTracingRtx,
        HdWidth,
        HdHeight,
        CamPos,
        {2.0f, 0.0f, 1.55f},
        0.92f,
        PyroViewCtx,
        RtxFrameRgba);

    // Scene 3: Physically Simulated Falling Sky Snow Accumulating Together Into ONE Single-Mesh 3D Snow Mound!
    //          ZERO SculptSnowPitOrDrift calls — starts at 0.000 m bare ground, grows 100% from landing SkyPrecipitation
    //          snowflakes with lee-eddy wind convergence, 36.5-deg angle-of-repose slumping & wind-carved sastrugi!
    SnowpackDomainSpec HdSnowSpec{};
    HdSnowSpec.CellsX                     = 160u;
    HdSnowSpec.CellsY                     = 160u;
    HdSnowSpec.CellSizeMetres             = 0.080f;
    HdSnowSpec.OriginX                    = -2.4f;
    HdSnowSpec.OriginY                    = -6.2f;
    HdSnowSpec.AmbientTemperatureKelvin   = 267.15f;
    HdSnowSpec.SurfaceInclusionThreshold  = 0.005f;
    HdSnowSpec.AngleOfReposeDegrees       = 36.5f;
    HdSnowSpec.SastrugiAmplitudeMetres    = 0.0095f;
    HdSnowSpec.PrevailingWindDirection    = {0.86f, -0.51f, 0.0f};
    HdSnowSpec.EnforceSingleConnectedMesh = true;
    SnowSurface HdSnowpack{HdSnowSpec};

    // Verify bare ground start (0.000 kg snow before snowfall begins — strictly NO pre-sculpted oval mound!).
    const double InitialSnowMassKg = HdSnowpack.Telemetry().GroundSolidMassKg;

    // Wind-advected 3D Falling Sky Snow Precipitation coupled directly to WindField + HdSnowpack touchdown sink!
    SkyPrecipitationConfig SnowfallCfg{};
    SnowfallCfg.Phase                   = SkyPrecipitationPhase::DendriticSnow;
    SnowfallCfg.DomainCentreXY          = {2.6f, -0.4f, 0.0f};
    SnowfallCfg.DomainHalfExtent        = {8.2f, 8.2f, 4.6f};
    SnowfallCfg.ParticleCount           = 9600u;
    SnowfallCfg.Intensity01             = 1.0f;
    SnowfallCfg.FlakeRadiusScale        = 1.65f;
    SnowfallCfg.EnableMoundConvergence  = true;
    SnowfallCfg.ConvergenceCentreWorld  = {3.85f, +0.45f, 0.0f};
    SnowfallCfg.ConvergenceRadiusMetres = 2.15f;
    SnowfallCfg.ConvergenceStrength     = 1.28f;
    SkyPrecipitation WinterSnowfall{SnowfallCfg};

    auto SampleSceneWind = [](Vec3 WorldPt, const void* Ctx) noexcept -> Vec3
    {
        const auto* Wf = static_cast<const Frontier::WindField*>(Ctx);
        const auto  W  = Wf->SampleWindVelocity({static_cast<double>(WorldPt.X), static_cast<double>(WorldPt.Y), static_cast<double>(WorldPt.Z)});
        return Vec3{static_cast<float>(W.X), static_cast<float>(W.Y), static_cast<float>(W.Z)};
    };

    struct SnowCouplingCtx
    {
        SnowSurface* SnowField;
    } SnowBind{&HdSnowpack};

    auto QuerySnowMoundTop = [](Vec3 Pt, float& OutZ, Vec3& OutN, float& OutRest, const void* Ctx) noexcept -> bool
    {
        const auto* B = static_cast<const SnowCouplingCtx*>(Ctx);
        OutZ          = B->SnowField->SampleGroundSurfaceElevation(Pt.X, Pt.Y);
        OutN          = {0.0f, 0.0f, 1.0f};
        OutRest       = 0.08f;
        return true;
    };

    auto OnSnowflakeTouchdown = [](const PrecipitationTouchdownEvent& Ev, void* Ctx) noexcept
    {
        auto* B = static_cast<SnowCouplingCtx*>(Ctx);
        // Natural multi-eddy aerodynamic snowdrift capture downwind of the jagged basalt rock outcrop:
        // Primary leeward drift peak + curved downwind cornice ridge + secondary eddy lobe -> coalescing into ONE 3D mound!
        const float X      = Ev.HitPositionWorld.X;
        const float Y      = Ev.HitPositionWorld.Y;
        const float Dx1    = X - 3.35f, Dy1 = Y - 0.72f;
        const float Skew1  = Dx1 * 0.85f - Dy1 * 0.52f;
        const float Cross1 = Dx1 * 0.52f + Dy1 * 0.85f;
        const float Lobe1  = std::exp(-0.5f * ((Skew1 * Skew1) / (1.85f * 1.85f) + (Cross1 * Cross1) / (1.28f * 1.28f)));

        const float Dx2    = X - 4.95f, Dy2 = Y - 0.05f;
        const float Skew2  = Dx2 * 0.90f - Dy2 * 0.44f;
        const float Cross2 = Dx2 * 0.44f + Dy2 * 0.90f + 0.25f * std::sin(Skew2 * 1.3f);
        const float Lobe2  = 0.76f * std::exp(-0.5f * ((Skew2 * Skew2) / (1.75f * 1.75f) + (Cross2 * Cross2) / (1.15f * 1.15f)));

        const float Dx3    = X - 2.45f, Dy3 = Y - 1.35f;
        const float Lobe3  = 0.58f * std::exp(-0.5f * ((Dx3 * Dx3) / (1.15f * 1.15f) + (Dy3 * Dy3) / (1.05f * 1.05f)));

        const float ShelterCapture = std::min(1.35f, Lobe1 + Lobe2 + Lobe3);
        if (ShelterCapture > 0.09f)
        {
            const float PacketMassKg = 0.145f * ShelterCapture;
            B->SnowField->DepositSnowflakeTouchdown(Ev.HitPositionWorld, Ev.ImpactVelocityMps, PacketMassKg, 0.30f);
        }
    };

    // Cleave natural-looking jagged basalt rock boulders using SolidFracture (instead of axis-aligned boxes)!
    std::vector<ConvexSolidFragment>   OutcropFragsA, OutcropFragsB;
    std::vector<FragmentAdjacencyBond> OutcropBondsA, OutcropBondsB;
    {
        FractureImpactDescriptor RockCleave{};
        RockCleave.ImpactPointWorld     = {1.45f, +2.05f, 0.72f};
        RockCleave.ImpactDirection      = Normalise(Vec3{-0.6f, -0.5f, -0.6f});
        RockCleave.ImpactKineticEnergyJ = 6500.0f;
        RockCleave.ImpulseNewtonSeconds = 1100.0f;
        RockCleave.AnchoredBaseAtMinZ   = true;
        RockCleave.DeterministicSeed    = 0xBA5A1701ull;
        (void)FractureEngine.CleaveConvexSolid(
            SolidFracture::CreateIntactBoxSolid({1.55f, +2.05f, 0.56f}, {0.82f, 0.64f, 0.56f}, 2750.0f),
            LookupFractureMaterialProperties(FractureMaterialPreset::NaturalGraniteStone),
            RockCleave,
            OutcropFragsA,
            OutcropBondsA);
        RockCleave.ImpactPointWorld  = {0.75f, +1.35f, 0.42f};
        RockCleave.DeterministicSeed = 0xBA5A1702ull;
        (void)FractureEngine.CleaveConvexSolid(
            SolidFracture::CreateIntactBoxSolid({0.85f, +1.38f, 0.36f}, {0.56f, 0.48f, 0.36f}, 2750.0f),
            LookupFractureMaterialProperties(FractureMaterialPreset::NaturalGraniteStone),
            RockCleave,
            OutcropFragsB,
            OutcropBondsB);
    }

    auto RegisterWindbreakBoulders = [&](SceneRenderer& TargetScene)
    {
        auto EmitRock = [&](const std::vector<ConvexSolidFragment>& Frags, size_t SkipEvery)
        {
            for (size_t F = 0u; F < Frags.size(); ++F)
            {
                if (!Frags[F].AnchoredIntact && (F % SkipEvery == 0u)) continue; // Leave natural craggy cleaved rock faces!
                const auto& Ps = Frags[F].PolygonSurface;
                const float Shade = 0.14f + 0.04f * static_cast<float>(F % 3u);
                for (size_t T = 0u; T + 2u < Ps.Indices.size(); T += 3u)
                {
                    RtxSceneTriangle RockTri{};
                    RockTri.V0        = Ps.Vertices[Ps.Indices[T + 0u]];
                    RockTri.V1        = Ps.Vertices[Ps.Indices[T + 1u]];
                    RockTri.V2        = Ps.Vertices[Ps.Indices[T + 2u]];
                    RockTri.Normal    = Ps.Normals[T / 3u];
                    RockTri.AlbedoRgb = {Shade, Shade * 1.05f, Shade * 1.18f};
                    RockTri.Roughness = 0.72f;
                    TargetScene.RegisterPolygonTriangle(RockTri);
                }
            }
        };
        EmitRock(OutcropFragsA, 3u);
        EmitRock(OutcropFragsB, 4u);
    };

    CoupledWorldOpticalContext AlpineSnowCtx = OptCtx;
    // Grazing 14-degree raking winter sunlight across deep slate-blue storm clouds:
    // Sculpturally shadows every ridge, cornice & wind-carved sastrugi ripple on the 3D mound while making white falling snow pop!
    AlpineSnowCtx.SunDirectionUnit  = Normalise(Vec3{-0.82f, -0.52f, 0.24f});
    AlpineSnowCtx.SunIrradianceRgb  = {9.4f, 8.8f, 8.4f};
    AlpineSnowCtx.Clouds.Coverage   = 0.84;
    AlpineSnowCtx.Fog.DensityAtBase = 0.0032;
    AlpineSnowCtx.HdrBloomStrength  = 0.15f;
    AlpineSnowCtx.ExposureScale     = 0.74f;
    AlpineSnowCtx.PlumeFluid        = nullptr;
    AlpineSnowCtx.ShallowWater      = nullptr;
    AlpineSnowCtx.Lightning         = nullptr;
    AlpineSnowCtx.Sparks            = nullptr;
    AlpineSnowCtx.Precipitation     = &WinterSnowfall;

    const uint32_t             PanelW = std::max(1u, HdWidth / 2u);
    const uint32_t             PanelH = std::max(1u, HdHeight / 2u);
    std::vector<uint8_t>       SnowTimelapseRgba(static_cast<size_t>(HdWidth) * HdHeight * 4u, 255u);
    std::array<float, 4u>      StagePeaksM{};
    std::array<uint32_t, 4u>   StageCompCounts{};
    constexpr std::array<int, 4u> StageSteps = {32, 38, 52, 76};

    for (size_t Stage = 0u; Stage < 4u; ++Stage)
    {
        for (int PStep = 0; PStep < StageSteps[Stage]; ++PStep)
        {
            WinterSnowfall.StepCoupledPrecipitation(
                1.0f / 20.0f,
                {2.3f, -1.35f, 0.0f},
                SampleSceneWind,
                &WindField,
                QuerySnowMoundTop,
                &SnowBind,
                OnSnowflakeTouchdown,
                &SnowBind);
            HdSnowpack.RelaxAngleOfReposeAndWindDrift({2.6f, -1.5f, 0.0f}, 1.0f / 20.0f, 2u);
        }
        HdSnowpack.RebuildContiguousPolygonSurfaces(ParkedCar);
        const auto& StageSurf  = HdSnowpack.GroundPolygonSurface();
        StagePeaksM[Stage]     = StageSurf.PeakThicknessM;
        StageCompCounts[Stage] = StageSurf.ConnectedComponentCount;

        SceneRenderer StageScene{};
        StageScene.RegisterTexturedGroundSlab({0.0f, 0.0f, -0.25f}, {36.0f, 36.0f, 0.25f}, {0.10f, 0.115f, 0.14f}, 0.48f, 0.04f);
        RegisterWindbreakBoulders(StageScene);
        StageScene.RegisterSmoothSnowSurface(StageSurf);
        StageScene.FinalizeSceneAndBakeSurfaceCards(AlpineSnowCtx);

        std::vector<uint8_t> PanelImg;
        StageScene.RenderViewportRgba8(
            GpuTracingTier::HardwareRayTracingRtx,
            PanelW,
            PanelH,
            {-0.55f, -3.55f, 1.82f},
            {3.85f, +0.55f, 0.26f},
            0.84f,
            AlpineSnowCtx,
            PanelImg);

        const uint32_t Ox = (Stage % 2u == 0u) ? 0u : PanelW;
        const uint32_t Oy = (Stage < 2u) ? 0u : PanelH;
        for (uint32_t Py = 0u; Py < PanelH && (Oy + Py) < HdHeight; ++Py)
        {
            std::memcpy(
                SnowTimelapseRgba.data() + (static_cast<size_t>(Oy + Py) * HdWidth + Ox) * 4u,
                PanelImg.data() + (static_cast<size_t>(Py) * PanelW) * 4u,
                static_cast<size_t>(PanelW) * 4u);
        }
    }

    // Render full-HD 960x540 hero render of falling snow accumulating into the pristine SINGLE-MESH 3D snow mound!
    std::vector<uint8_t> SnowMoundHeroRgba;
    {
        SceneRenderer PristineSnowMoundScene{};
        PristineSnowMoundScene.RegisterTexturedGroundSlab({0.0f, 0.0f, -0.25f}, {36.0f, 36.0f, 0.25f}, {0.10f, 0.115f, 0.14f}, 0.48f, 0.04f);
        RegisterWindbreakBoulders(PristineSnowMoundScene);
        PristineSnowMoundScene.RegisterSmoothSnowSurface(HdSnowpack.GroundPolygonSurface());
        PristineSnowMoundScene.FinalizeSceneAndBakeSurfaceCards(AlpineSnowCtx);
        PristineSnowMoundScene.RenderViewportRgba8(
            GpuTracingTier::HardwareRayTracingRtx,
            HdWidth,
            HdHeight,
            {-0.55f, -3.55f, 1.82f},
            {3.85f, +0.55f, 0.26f},
            0.84f,
            AlpineSnowCtx,
            SnowMoundHeroRgba);
    }

    const auto PristineMoundSurf = HdSnowpack.GroundPolygonSurface();
    std::snprintf(
        Note,
        sizeof(Note),
        "init_kg=%.2f fused_flakes=%llu stages=(%.3f->%.3f->%.3f->%.3fm) components=%u tris=%zu",
        InitialSnowMassKg,
        static_cast<unsigned long long>(HdSnowpack.Telemetry().RetiredSnowflakesFused),
        StagePeaksM[0], StagePeaksM[1], StagePeaksM[2], StagePeaksM[3],
        PristineMoundSurf.ConnectedComponentCount,
        PristineMoundSurf.Indices.size() / 3u);
    Ledger.Verify(
        InitialSnowMassKg == 0.0 &&
            HdSnowpack.Telemetry().RetiredSnowflakesFused > 1500u &&
            StagePeaksM[0] > 0.02f && StagePeaksM[1] > StagePeaksM[0] &&
            StagePeaksM[2] > StagePeaksM[1] && StagePeaksM[3] > StagePeaksM[2] &&
            StagePeaksM[3] > 0.45f &&
            PristineMoundSurf.ConnectedComponentCount == 1u &&
            SnowSurface::CountConnectedMeshComponents(PristineMoundSurf) == 1u,
        "Falling SkyPrecipitation snowflakes physically accumulate into ONE single-mesh 3D snow mound",
        Note);

    // Now carve curved dual-track Wong-Bekker tyre ruts across the accumulated single-mesh snow mound for the Snow+Sparks scene!
    for (int Step = 0; Step < 64; ++Step)
    {
        const float T       = static_cast<float>(Step) / 63.0f;
        const float PathX   = 1.15f + T * 5.80f;
        const float Curve   = 0.46f * std::sin(T * 2.45f);
        const float Slope   = 0.46f * 2.45f * std::cos(T * 2.45f) / 5.80f;
        const Vec3  Tangent = Normalise(Vec3{1.0f, Slope, 0.0f});
        const Vec3  Lat     = Normalise(Vec3{-Tangent.Y, Tangent.X, 0.0f});

        for (float Side : {-0.68f, +0.68f})
        {
            SnowWheelRutInput RutIn{};
            RutIn.WheelContactWorld = Vec3{PathX, 0.48f + Curve, 0.0f} + Lat * Side;
            RutIn.WheelForwardWorld = Tangent;
            RutIn.TyreWidthMetres   = 0.300f;
            RutIn.TyreRadiusMetres  = 0.345f;
            RutIn.NormalLoadNewtons = 4650.0f;
            RutIn.WheelForwardSpeed = 11.5f;
            (void)HdSnowpack.CarveWheelRutAndEvaluateResistance(RutIn);
        }
    }
    HdSnowpack.RebuildContiguousPolygonSurfaces(ParkedCar);

    // Verify smooth vertex-normal continuity + single-mesh topology even after Wong-Bekker rut carving!
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
        "snow_verts=%zu snow_tris=%zu components=%u sloped_smooth_verts=%u peak=%.3f m",
        HdSnowSurf.Vertices.size(),
        HdSnowSurf.Indices.size() / 3u,
        HdSnowSurf.ConnectedComponentCount,
        SmoothNormalCount,
        HdSnowSurf.PeakThicknessM);
    Ledger.Verify(
        HdSnowSurf.Vertices.size() > 1200u && SmoothNormalCount > 350u &&
            HdSnowSurf.ConnectedComponentCount == 1u && HdSnowSurf.PeakThicknessM > 0.28f,
        "Smooth Marching-Squares single-mesh 3D snow PolygonSurface & smooth rut normals",
        Note);

    SceneRenderer SnowSparkScene{};
    SnowSparkScene.RegisterTexturedGroundSlab({0.0f, 0.0f, -0.25f}, {36.0f, 36.0f, 0.25f}, {0.11f, 0.13f, 0.17f}, 0.44f, 0.05f);
    RegisterWindbreakBoulders(SnowSparkScene);
    SnowSparkScene.RegisterSmoothSnowSurface(HdSnowSurf);

    // Cleave a low-profile roadside jersey barrier on the exposed dark mineral asphalt beside the snowbank!
    const ConvexSolidFragment JerseyBlock = SolidFracture::CreateIntactBoxSolid(
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

    // True swept ballistic spark shower (rendered natively via SparkRaster.wgsl shutter-integrated razor-sharp streaks!)
    BallisticSparkConfig VisSparkCfg{};
    VisSparkCfg.SceneLuminanceGain = 2.6f;
    SparkParticles VisSparks{VisSparkCfg};
    MetallicScrapeContact VisScrape{};
    VisScrape.ContactPointWorld     = {3.85f, -0.95f, 0.52f};
    VisScrape.TangentialVelocityMps = {-9.5f, -2.5f, 5.4f};
    VisScrape.NormalForceNewtons    = 8200.0f;
    VisScrape.RequestedSparkCount   = 130u;
    VisSparks.SpawnScrapeSparks(VisScrape);
    for (int S = 0; S < 5; ++S)
    {
        VisSparks.StepBallisticSparks(1.0f / 60.0f);
    }

    CoupledWorldOpticalContext DuskSparkCtx = OptCtx;
    // Low grazing golden-winter sun reveals every smooth 3D snowdrift contour, falling sky snow crystals & crisp sparks!
    DuskSparkCtx.SunDirectionUnit  = Normalise(Vec3{-0.56f, -0.78f, 0.34f});
    DuskSparkCtx.SunIrradianceRgb  = {6.2f, 5.6f, 5.0f};
    DuskSparkCtx.Clouds.Coverage   = 0.54;
    DuskSparkCtx.Fog.DensityAtBase = 0.0028;
    DuskSparkCtx.HdrBloomStrength  = 0.22f;
    DuskSparkCtx.ExposureScale     = 0.74f;
    DuskSparkCtx.PlumeFluid        = nullptr;
    DuskSparkCtx.ShallowWater      = nullptr;
    DuskSparkCtx.Lightning         = nullptr;
    DuskSparkCtx.Sparks            = &VisSparks;
    DuskSparkCtx.Precipitation     = &WinterSnowfall;
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
    SceneRenderer PortalVehicleScene{};
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
    SceneRenderer SunFlareScene{};
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
    ShallowWaterSimulation FlareBasin{FlareBasinCfg};
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

    // -----------------------------------------------------------------------------------------------------------------
    // SUITE 20: Low-Resolution Blinn-Phong Renderer (BlinnRenderer.h: 0.42x Low-Res Raster + Planar Shadows)
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 20: Low-Resolution Blinn-Phong Renderer (Engine/Rendering/BlinnRenderer) ---\n");
    BlinnRenderer LowResBlinn{};
    BlinnFacetMesh BlinnBody{}, BlinnRimL{}, BlinnRimR{}, BlinnTyre{};
    const bool BlinnLoaded = BlinnRenderer::LoadFacetStream("Frontier/Projects/Project-Drive/Content/Geometry/ControlVehicleBody.facet", BlinnBody) &&
                             BlinnRenderer::LoadFacetStream("Frontier/Projects/Project-Drive/Content/Geometry/ControlVehicleRim.facet", BlinnRimL) &&
                             BlinnRenderer::LoadFacetStream("Frontier/Projects/Project-Drive/Content/Geometry/ControlVehicleTyre.facet", BlinnTyre);
    if (BlinnLoaded)
    {
        for (Vec3& P : BlinnBody.Positions)
        {
            P.Z -= 0.625f;
        }
        BlinnRimR = BlinnRenderer::MirrorFacetMeshAcrossY(BlinnRimL);
        BlinnMaterialProperties CobaltCoat{};
        CobaltCoat.LinearAlbedo = {0.10f, 0.42f, 0.92f};
        CobaltCoat.Roughness    = 0.18f;
        CobaltCoat.Metallic     = 0.35f;
        LowResBlinn.SubmitFacetMesh(BlinnBody, {0.0f, 0.0f, 0.79f}, {1.0f, 0.0f, 0.0f}, {0.0f, 1.0f, 0.0f}, {0.0f, 0.0f, 1.0f}, &CobaltCoat);
        const std::array<Vec3, 4u> WheelPos = {{{1.7274f, 1.0475f, 0.42f}, {1.7274f, -1.0475f, 0.42f}, {-1.6686f, 1.0475f, 0.42f}, {-1.6686f, -1.0475f, 0.42f}}};
        for (size_t K = 0u; K < 4u; ++K)
        {
            LowResBlinn.SubmitFacetMesh(BlinnTyre, WheelPos[K], {1.0f, 0.0f, 0.0f}, {0.0f, 1.0f, 0.0f}, {0.0f, 0.0f, 1.0f});
            LowResBlinn.SubmitFacetMesh((K % 2u == 0u) ? BlinnRimL : BlinnRimR, WheelPos[K], {1.0f, 0.0f, 0.0f}, {0.0f, 1.0f, 0.0f}, {0.0f, 0.0f, 1.0f});
        }
    }
    BlinnMaterialProperties PillarMat{};
    PillarMat.LinearAlbedo = {0.76f, 0.32f, 0.22f};
    LowResBlinn.SubmitAxisBox({-2.8f, 2.8f, 1.05f}, {0.45f, 0.45f, 1.05f}, PillarMat, true);
    PillarMat.LinearAlbedo = {0.82f, 0.68f, 0.24f};
    LowResBlinn.SubmitAxisBox({+2.6f, 3.1f, 0.85f}, {0.55f, 0.55f, 0.85f}, PillarMat, true);

    BlinnCameraDescriptor BlinnCam{};
    BlinnCam.EyeWorld       = {4.85f, -4.15f, 2.05f};
    BlinnCam.TargetWorld    = {0.10f, +0.20f, 0.68f};
    BlinnCam.VerticalFovDeg = 40.0f;

    BlinnRenderSettings BlinnSet{};
    BlinnSet.ResolutionScale   = 0.42f; // Explicit low-resolution internal rasterization!
    BlinnSet.BilinearUpscale   = false; // Crisp low-res pixel upscale!
    BlinnSet.CastPlanarShadows = true;
    BlinnSet.DrawGroundChecker = true;

    std::vector<uint8_t> BlinnRgb8;
    BlinnRenderDiagnostics BlinnDiag{};
    LowResBlinn.RenderSceneToSrgb8(HdWidth, HdHeight, BlinnCam, BlinnSet, BlinnRgb8, &BlinnDiag);
    std::vector<uint8_t> BlinnRgba8(static_cast<size_t>(HdWidth) * HdHeight * 4u, 255u);
    for (size_t I = 0u; I < static_cast<size_t>(HdWidth) * HdHeight; ++I)
    {
        BlinnRgba8[I * 4u + 0u] = BlinnRgb8[I * 3u + 0u];
        BlinnRgba8[I * 4u + 1u] = BlinnRgb8[I * 3u + 1u];
        BlinnRgba8[I * 4u + 2u] = BlinnRgb8[I * 3u + 2u];
    }
    std::snprintf(
        Note,
        sizeof(Note),
        "internal=%ux%u->%ux%u tris=%u shadow_tris=%u",
        BlinnDiag.InternalWidth,
        BlinnDiag.InternalHeight,
        BlinnDiag.OutputWidth,
        BlinnDiag.OutputHeight,
        BlinnDiag.RasterizedTriangles,
        BlinnDiag.ShadowTriangles);
    Ledger.Verify(
        BlinnLoaded && BlinnDiag.InternalWidth < BlinnDiag.OutputWidth &&
            BlinnDiag.RasterizedTriangles > 2000u && BlinnDiag.ShadowTriangles > 2000u,
        "Low-resolution Blinn-Phong renderer (0.42x internal raster + planar shadows)",
        Note);

    // -----------------------------------------------------------------------------------------------------------------
    // SUITE 21: Auto-Exposure Dark-Room / Cabin Protection & 3D ControlVehicle Cabin HMI
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 21: Protected Auto-Exposure & Real 3D ControlVehicle Cockpit HMI ---\n");
    // Construct a synthetic dark room (92% dark walls @ 0.008 radiance, 8% glowing emissive neon/HMI @ 4.2 radiance):
    std::vector<Vec3> DarkEmissiveRoomHdr(128u * 128u, Vec3{0.008f, 0.009f, 0.012f});
    for (uint32_t Y = 44u; Y < 84u; ++Y)
    {
        for (uint32_t X = 44u; X < 84u; ++X)
        {
            DarkEmissiveRoomHdr[Y * 128u + X] = Vec3{3.8f, 4.2f, 4.6f};
        }
    }
    ExposureSettings UnprotectedExp{};
    UnprotectedExp.ProtectDarkEmissiveInteriors = false;
    UnprotectedExp.ProtectVehicleCabins         = false;
    ExposureAdaptationState UnprotectedState{};
    ExposureAdaptation::IntegrateExposure(DarkEmissiveRoomHdr, 128u, 128u, UnprotectedExp, UnprotectedState, true);

    ExposureSettings ProtectedExp{};
    ProtectedExp.ProtectDarkEmissiveInteriors = true;
    ProtectedExp.ProtectVehicleCabins         = true;
    ExposureAdaptationState ProtectedRoomState{};
    ExposureAdaptation::IntegrateExposure(DarkEmissiveRoomHdr, 128u, 128u, ProtectedExp, ProtectedRoomState, true);

    const float DriverSeatCabinShare = ExposureAdaptation::EvaluateVehicleCabinShare({-0.20f, 0.42f, 1.12f - 0.625f});
    const float OutsideRoadCabinShare = ExposureAdaptation::EvaluateVehicleCabinShare({6.0f, 4.0f, 1.5f});
    ProtectedExp.VehicleCabinShare01 = DriverSeatCabinShare;
    ExposureAdaptationState ProtectedCabinState{};
    ExposureAdaptation::IntegrateExposure(DarkEmissiveRoomHdr, 128u, 128u, ProtectedExp, ProtectedCabinState, true);

    std::snprintf(
        Note,
        sizeof(Note),
        "unprotected_gain=%.2fx protected_room_gain=%.2fx(clamped=%d) cabin_share=%.2f(out=%.2f) cabin_gain=%.2fx",
        UnprotectedState.CurrentExposureGain,
        ProtectedRoomState.CurrentExposureGain,
        ProtectedRoomState.ProtectionClamped ? 1 : 0,
        DriverSeatCabinShare,
        OutsideRoadCabinShare,
        ProtectedCabinState.CurrentExposureGain);
    Ledger.Verify(
        UnprotectedState.CurrentExposureGain > 2.2f &&
            ProtectedRoomState.ProtectionClamped && ProtectedRoomState.CurrentExposureGain <= 0.86f &&
            DriverSeatCabinShare > 0.95f && OutsideRoadCabinShare < 0.01f &&
            ProtectedCabinState.ProtectionClamped && ProtectedCabinState.CurrentExposureGain <= 0.86f,
        "Auto-exposure protects dark emissive rooms & ControlVehicle cabins from washout",
        Note);

    // Build and render the real 3D ControlVehicle Cockpit scene (3D steering wheel, 3D hexagonal KINETIK cluster,
    // 3D tilted centre tablet with 12 multicolour SVG icons & live 3D ControlVehicle turntable, and dielectric windshield)!
    SceneRenderer CockpitScene{};
    CockpitScene.RegisterTexturedGroundSlab({0.0f, 0.0f, -0.25f}, {60.0f, 60.0f, 0.25f}, {0.18f, 0.20f, 0.24f}, 0.44f, 0.05f);
    CockpitScene.RegisterDualTierSolidBox({14.0f, -2.6f, 1.4f}, {0.65f, 0.65f, 1.4f}, {0.82f, 0.28f, 0.20f}, 0.48f);
    CockpitScene.RegisterDualTierSolidBox({18.5f, +2.8f, 1.8f}, {0.75f, 0.75f, 1.8f}, {0.22f, 0.64f, 0.88f}, 0.45f);

    ExposureAdaptationState CockpitExposureState{};
    CoupledWorldOpticalContext CockpitCtx{};
    CockpitCtx.Atmosphere       = Atmos;
    CockpitCtx.AtmosphereLut    = &SkyLut;
    CockpitCtx.Clouds.Coverage  = 0.42;
    CockpitCtx.Fog.DensityAtBase = 0.002;
    CockpitCtx.SunDirectionUnit = Normalise(Vec3{0.52f, -0.58f, 0.62f});
    CockpitCtx.SunIrradianceRgb = {11.5f, 10.9f, 10.1f};
    CockpitCtx.HdrBloomStrength = 0.16f;
    CockpitCtx.ExposureScale    = 0.85f;
    CockpitCtx.AutoExposure     = &CockpitExposureState;

    const MountedControlVehicleCockpitRig CockpitRig = CabinHmi.MountControlVehicle3DCockpit(
        {0.0f, 0.0f, 0.0f},
        0.0f,
        HmiTel,
        CockpitScene,
        CockpitCtx);
    CockpitScene.FinalizeSceneAndBakeSurfaceCards(CockpitCtx);

    std::vector<uint8_t> Cockpit3DRgba;
    CockpitScene.RenderViewportRgba8(
        GpuTracingTier::HardwareRayTracingRtx,
        HdWidth,
        HdHeight,
        CockpitRig.HmiFocusEyeWorld,
        CockpitRig.HmiFocusTargetWorld,
        0.92f,
        CockpitCtx,
        Cockpit3DRgba);
    Ledger.Verify(
        CockpitRig.ClusterDisplayTextureId >= 0 && CockpitRig.TabletDisplayTextureId >= 0 &&
            CockpitRig.CockpitTrianglesAdded > 8000u && CockpitExposureState.CurrentExposureGain <= 0.86f,
        "3D ControlVehicle Cockpit HMI (3D hexagonal cluster + 3D SVG/Garage tablet + cabin lock)",
        "mounted inside ControlVehicle");

    // -----------------------------------------------------------------------------------------------------------------
    // SUITE 22: Circular Portals + Automatic Duplicate Emerging Geometry + Per-Object Portal Blocking
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 22: Circular Portals, Automatic Duplicate Exit Mesh & Object Blocking ---\n");
    SceneRenderer CircularPortalScene{};
    CircularPortalScene.RegisterTexturedGroundSlab({0.0f, 0.0f, -0.25f}, {48.0f, 48.0f, 0.25f}, {0.19f, 0.21f, 0.26f}, 0.42f, 0.06f);
    for (int Col = -3; Col <= 3; ++Col)
    {
        CircularPortalScene.RegisterDualTierSolidBox(
            {static_cast<float>(Col) * 3.2f, 8.6f, 1.8f},
            {0.32f, 0.32f, 1.8f},
            {0.44f, 0.47f, 0.52f},
            0.50f);
    }

    SeamlessPortalAperture CircPortalFwd{};
    CircPortalFwd.Shape            = PortalApertureShape::Circular;
    CircPortalFwd.RadiusMetres     = 1.52f;
    CircPortalFwd.EntryCentreWorld = {-2.35f, +0.45f, 1.56f};
    CircPortalFwd.EntryRightAxis   = EntryRightN;
    CircPortalFwd.EntryUpAxis      = EntryUpN;
    CircPortalFwd.EntryFrontNormal = EntryFrontN;
    CircPortalFwd.ExitCentreWorld  = {+2.35f, +0.75f, 1.56f};
    CircPortalFwd.ExitRightAxis    = ExitRightN;
    CircPortalFwd.ExitUpAxis       = ExitUpN;
    CircPortalFwd.ExitFrontNormal  = ExitFrontN;
    CircPortalFwd.PortalRimGlowRgb = {0.12f, 0.88f, 1.50f};
    CircPortalFwd.ExitRimGlowRgb   = {1.50f, 0.62f, 0.14f};

    SeamlessPortalAperture CircPortalRev = CircPortalFwd;
    CircPortalRev.EntryCentreWorld       = CircPortalFwd.ExitCentreWorld;
    CircPortalRev.EntryRightAxis         = CircPortalFwd.ExitRightAxis;
    CircPortalRev.EntryUpAxis            = CircPortalFwd.ExitUpAxis;
    CircPortalRev.EntryFrontNormal       = CircPortalFwd.ExitFrontNormal;
    CircPortalRev.ExitCentreWorld        = CircPortalFwd.EntryCentreWorld;
    CircPortalRev.ExitRightAxis          = CircPortalFwd.EntryRightAxis;
    CircPortalRev.ExitUpAxis             = CircPortalFwd.EntryUpAxis;
    CircPortalRev.ExitFrontNormal        = CircPortalFwd.EntryFrontNormal;
    CircPortalRev.PortalRimGlowRgb       = CircPortalFwd.ExitRimGlowRgb;
    CircPortalRev.ExitRimGlowRgb         = CircPortalFwd.PortalRimGlowRgb;

    CircularPortalScene.RegisterSeamlessPortal(CircPortalFwd);
    CircularPortalScene.RegisterSeamlessPortal(CircPortalRev);
    PortalMechanics::RegisterCircularPortalFrameRings(CircPortalFwd, 0.085f, 44u, CircularPortalScene);

    PortalMechanics PortalFilter{};
    constexpr uint32_t AllowedCarObjectId    = 101u;
    constexpr uint32_t BlockedSphereObjectId = 202u;
    PortalFilter.AllowObjectThroughPortals(AllowedCarObjectId);
    PortalFilter.BlockObjectFromPortals(BlockedSphereObjectId);

    // Verify dynamic motion blocking vs allowed teleportation:
    PortalObjectBodyState BlockedBody{BlockedSphereObjectId, CircPortalFwd.EntryCentreWorld + EntryFrontN * 0.45f, -EntryFrontN * 12.0f, 0.42f};
    const auto BlockedStep = PortalFilter.StepObjectAgainstPortal(BlockedBody, 0.08f, CircPortalFwd);

    PortalObjectBodyState AllowedBody{AllowedCarObjectId, CircPortalFwd.EntryCentreWorld + EntryFrontN * 0.25f, -EntryFrontN * 12.0f, 0.50f};
    const auto AllowedStep = PortalFilter.StepObjectAgainstPortal(AllowedBody, 0.08f, CircPortalFwd);

    // Build world-space triangles for ControlVehicle (ObjectId 101, ALLOWED -> automatic clipped entry + emerging exit duplicate!)
    std::vector<RtxSceneTriangle> CarWorldTris;
    if (BlinnLoaded)
    {
        const Vec3 CarCentre = {-2.35f, +0.45f, 0.815f};
        const Vec3 CarLeft   = Cross(Vec3{0.0f, 0.0f, 1.0f}, CarTransitForward);
        auto AppendPartTris = [&](const BlinnFacetMesh& Mesh, Vec3 LocalOff, Vec3 Tint, bool OverrideTint)
        {
            for (size_t T = 0u; T + 2u < Mesh.Indices.size(); T += 3u)
            {
                const uint32_t I0 = Mesh.Indices[T + 0u], I1 = Mesh.Indices[T + 1u], I2 = Mesh.Indices[T + 2u];
                auto ToW = [&](Vec3 P) { return CarCentre + CarTransitForward * (P.X + LocalOff.X) + CarLeft * (P.Y + LocalOff.Y) + Vec3{0.0f, 0.0f, P.Z + LocalOff.Z}; };
                const Vec3 V0 = ToW(Mesh.Positions[I0]), V1 = ToW(Mesh.Positions[I1]), V2 = ToW(Mesh.Positions[I2]);
                const Vec3 Cr = Cross(V1 - V0, V2 - V0);
                if (Length(Cr) <= 1.0e-7f) continue;
                const uint32_t MatId = (T / 3u < Mesh.MaterialIds.size()) ? Mesh.MaterialIds[T / 3u] : 0u;
                BlinnMaterialProperties St = BlinnRenderer::ResolveVehicleMaterial(MatId);
                RtxSceneTriangle Tri{};
                Tri.V0 = V0; Tri.V1 = V1; Tri.V2 = V2; Tri.Normal = Normalise(Cr);
                Tri.AlbedoRgb = (OverrideTint && MatId == 0u) ? Tint : St.LinearAlbedo;
                Tri.Roughness = St.Roughness;
                Tri.Metallic  = St.Metallic;
                CarWorldTris.push_back(Tri);
            }
        };
        AppendPartTris(BlinnBody, {0.0f, 0.0f, 0.0f}, {0.88f, 0.16f, 0.14f}, true);
        const std::array<Vec3, 4u> WOff = {{{1.7274f, 1.0475f, -0.375f}, {1.7274f, -1.0475f, -0.375f}, {-1.6686f, 1.0475f, -0.375f}, {-1.6686f, -1.0475f, -0.375f}}};
        for (size_t K = 0u; K < 4u; ++K)
        {
            AppendPartTris(BlinnTyre, WOff[K], {}, false);
            AppendPartTris((K % 2u == 0u) ? BlinnRimL : BlinnRimR, WOff[K], {}, false);
        }
    }
    const PortalSubmissionSummary AllowedCarSubmit = PortalFilter.SubmitPortalAwareMesh(
        AllowedCarObjectId, CarWorldTris, {-2.35f, +0.45f, 0.85f}, {2.2f, 1.1f, 0.75f}, CircPortalFwd, CircularPortalScene);

    // Build a golden-amber hazard cube pushed halfway into the circular portal with ObjectId 202 (BLOCKED -> clamped outside, 0 duplicate!)
    SceneRenderer TempBoxBuilder{};
    // Place the blocked crimson hazard cube in clear foreground view right at the circular portal mouth so it is visibly halted outside!
    const Vec3 IntrudingBlockedPos = CircPortalFwd.EntryCentreWorld + EntryRightN * 1.15f - Vec3{0.0f, 0.0f, 1.10f} - EntryFrontN * 0.25f;
    TempBoxBuilder.RegisterDualTierSolidBox(IntrudingBlockedPos, {0.38f, 0.38f, 0.38f}, {0.92f, 0.14f, 0.10f}, 0.24f, {0.22f, 0.03f, 0.02f}, 0.30f);
    const PortalSubmissionSummary BlockedCubeSubmit = PortalFilter.SubmitPortalAwareMesh(
        BlockedSphereObjectId, TempBoxBuilder.RtxTriangles(), IntrudingBlockedPos, {0.38f, 0.38f, 0.38f}, CircPortalFwd, CircularPortalScene);

    CircularPortalScene.FinalizeSceneAndBakeSurfaceCards(PortalCarCtx);
    std::vector<uint8_t> CircularPortalRgba;
    CircularPortalScene.RenderViewportRgba8(
        GpuTracingTier::HardwareRayTracingRtx,
        HdWidth,
        HdHeight,
        {-0.15f, -6.95f, 2.38f},
        {+0.15f, +0.55f, 0.98f},
        0.82f,
        PortalCarCtx,
        CircularPortalRgba);

    std::snprintf(
        Note,
        sizeof(Note),
        "allowed_entry=%u allowed_dup_exit=%u teleport=%d | blocked_filter=%d blocked_dup_exit=%u stop_dist=%.3fm",
        AllowedCarSubmit.EntrySideTrianglesEmitted,
        AllowedCarSubmit.ExitDuplicateTrianglesEmitted,
        AllowedStep.TeleportedCentroidToExit ? 1 : 0,
        BlockedCubeSubmit.BlockedByFilter ? 1 : 0,
        BlockedCubeSubmit.ExitDuplicateTrianglesEmitted,
        Dot(BlockedBody.CentreWorld - CircPortalFwd.EntryCentreWorld, EntryFrontN));
    Ledger.Verify(
        AllowedCarSubmit.EntrySideTrianglesEmitted > 2000u &&
            AllowedCarSubmit.ExitDuplicateTrianglesEmitted > 2000u &&
            AllowedStep.TeleportedCentroidToExit &&
            BlockedCubeSubmit.BlockedByFilter &&
            BlockedCubeSubmit.ExitDuplicateTrianglesEmitted == 0u &&
            !BlockedStep.TeleportedCentroidToExit &&
            Dot(BlockedBody.CentreWorld - CircPortalFwd.EntryCentreWorld, EntryFrontN) >= 0.40f,
        "Circular portals: automatic exit-side duplicate mesh & per-object portal blocking",
        Note);

    // -----------------------------------------------------------------------------------------------------------------
    // SUITE 23: Glass-Aware Nanite Cluster-Hierarchy DAG Visual & Quantitative Demonstration
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 23: Nanite Cluster-Hierarchy DAG (4-Panel Diagnostic + Near/Mid/Far Reduction) ---\n");
    FacetField NaniteField{};
    auto AppendCorrugatedUvSphere = [&](Vec3 Centre, float Radius, float Amp, uint32_t Slices, uint32_t Stacks, uint32_t ClassId)
    {
        auto EvalPt = [&](float U, float V) -> Vector3
        {
            const double Phi = static_cast<double>(U) * 6.283185307179586;
            const double Th  = static_cast<double>(V) * 3.141592653589793;
            const double SinT = std::sin(Th);
            const double R = static_cast<double>(Radius) *
                             (1.0 + static_cast<double>(Amp) * SinT * SinT * (0.55 * std::sin(Phi * 8.0) * std::sin(Th * 6.0)));
            return {
                static_cast<double>(Centre.X) + R * SinT * std::cos(Phi),
                static_cast<double>(Centre.Y) + R * SinT * std::sin(Phi),
                static_cast<double>(Centre.Z) + R * std::cos(Th)};
        };
        auto EmitFacet = [&](float U0, float V0, float U1, float V1, float U2, float V2)
        {
            NaniteField.Corners.push_back(EvalPt(U0, V0));
            NaniteField.Corners.push_back(EvalPt(U1, V1));
            NaniteField.Corners.push_back(EvalPt(U2, V2));
            NaniteField.CornerUVs.push_back({static_cast<double>(U0), static_cast<double>(V0)});
            NaniteField.CornerUVs.push_back({static_cast<double>(U1), static_cast<double>(V1)});
            NaniteField.CornerUVs.push_back({static_cast<double>(U2), static_cast<double>(V2)});
            NaniteField.Classification.push_back(ClassId);
            NaniteField.SharpMask.push_back(0u);
        };
        for (uint32_t J = 0u; J < Stacks; ++J)
        {
            const float V0 = static_cast<float>(J) / static_cast<float>(Stacks);
            const float V1 = static_cast<float>(J + 1u) / static_cast<float>(Stacks);
            for (uint32_t I = 0u; I < Slices; ++I)
            {
                const float U0 = static_cast<float>(I) / static_cast<float>(Slices);
                const float U1 = static_cast<float>(I + 1u) / static_cast<float>(Slices);
                if (J > 0u)
                {
                    EmitFacet(U0, V0, U0, V1, U1, V0);
                }
                if (J + 1u < Stacks)
                {
                    EmitFacet(U1, V0, U0, V1, U1, V1);
                }
            }
        }
    };

    // Populate Nanite showcase with Near (3.2m -> Tier 0 Red), Mid (12m -> Tier 2 Emerald), Far (28m -> Tier 4 Blue) corrugated statues + foreground glass sphere!
    AppendCorrugatedUvSphere({-1.65f, -2.3f, 1.15f}, 1.05f, 0.14f, 56u, 36u, 1u); // Foreground detailed statue (Tier 0!)
    AppendCorrugatedUvSphere({-0.25f, +6.2f, 1.55f}, 1.55f, 0.14f, 56u, 36u, 2u); // Midground statue (Tier 2!)
    AppendCorrugatedUvSphere({+4.40f, +22.5f, 2.75f}, 2.75f, 0.14f, 56u, 36u, 3u); // Background statue (Tier 4!)
    AppendCorrugatedUvSphere({+1.30f, -1.8f, 1.10f}, 0.86f, 0.00f, 44u, 28u, 10u); // Foreground refractive dielectric glass sphere!

    ClusterHierarchy NaniteDag{};
    NaniteDag.RegisterMaterialProfile({1u, false, 1.5f, {}, {0.82f, 0.42f, 0.24f}, 0.32f, 0.10f});
    NaniteDag.RegisterMaterialProfile({2u, false, 1.5f, {}, {0.24f, 0.68f, 0.86f}, 0.32f, 0.10f});
    NaniteDag.RegisterMaterialProfile({3u, false, 1.5f, {}, {0.84f, 0.72f, 0.26f}, 0.35f, 0.10f});
    NaniteDag.RegisterMaterialProfile({10u, true, 1.54f, {0.10f, 0.03f, 0.04f}, {0.92f, 0.96f, 0.99f}, 0.04f, 0.0f});

    TierBuildSpecification TierSpec{};
    TierSpec.TriangleLimit = 96u;
    TierSpec.MaximumTiers  = 6u;
    const bool BuiltNanite = NaniteDag.BuildFromFacetField(NaniteField, TierSpec);

    ClusterCameraView ShowcaseCam{};
    ShowcaseCam.CameraOrigin     = {0.0f, -5.6f, 1.55f};
    ShowcaseCam.CameraTarget     = {0.35f, +4.0f, 1.45f};
    ShowcaseCam.ViewportWidthPx  = HdWidth;
    ShowcaseCam.ViewportHeightPx = HdHeight;
    ShowcaseCam.ErrorThresholdPx = 9.50f;

    // Also measure pure Near (full scene visible at 8.5m) vs Far (full scene at 85m) monotonic triangle reduction!
    ClusterCameraView NearCam = ShowcaseCam;
    NearCam.CameraOrigin      = {0.6f, -8.5f, 1.85f};
    NearCam.ErrorThresholdPx  = 0.65f;

    ClusterCameraView FarCam = ShowcaseCam;
    FarCam.CameraOrigin      = {0.6f, -85.0f, 7.50f};
    FarCam.ErrorThresholdPx  = 9.50f;

    const ClusterRuntimeFrameReport ShowcaseCut = NaniteDag.ExecuteGlassAwareCutAndTwoPhaseHiZ(ShowcaseCam);
    const ClusterRuntimeFrameReport NearCut     = NaniteDag.ExecuteGlassAwareCutAndTwoPhaseHiZ(NearCam);
    const ClusterRuntimeFrameReport FarCut      = NaniteDag.ExecuteGlassAwareCutAndTwoPhaseHiZ(FarCam);

    std::vector<uint8_t> NaniteShowcaseRgba;
    NaniteDag.RenderFourPanelDiagnosticRgba8(ShowcaseCam, NaniteShowcaseRgba);

    std::snprintf(
        Note,
        sizeof(Note),
        "tiers=%zu clusters=%zu pages=%zu leaf_tris=%u near_cut=%u showcase_cut=%u far_cut=%u glass_clusters=%zu",
        NaniteDag.TierSequence().Tiers.size(),
        NaniteDag.ClusterRecords().size(),
        NaniteDag.StreamingPages().size(),
        NearCut.SourceLeafTriangles,
        NearCut.ActiveTrianglesAfterCull,
        ShowcaseCut.ActiveTrianglesAfterCull,
        FarCut.ActiveTrianglesAfterCull,
        ShowcaseCut.SelectedGlassGlobals.size());
    Ledger.Verify(
        BuiltNanite && NaniteDag.TierSequence().Tiers.size() >= 3u &&
            ShowcaseCut.ActiveTrianglesAfterCull < ShowcaseCut.SourceLeafTriangles &&
            FarCut.TotalCutClusters < NearCut.TotalCutClusters &&
            FarCut.ActiveTrianglesAfterCull < NearCut.ActiveTrianglesAfterCull &&
            !ShowcaseCut.SelectedGlassGlobals.empty(),
        "Glass-aware Nanite ClusterHierarchy DAG cut, reduction & 4-panel showcase",
        Note);

    // -----------------------------------------------------------------------------------------------------------------
    // SUITE 24: Simulated Torrential Rainfall, Storm Rain Shafts & 2.5D Puddle Hydrology (ZERO Foam, ZERO Splash)
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 24: Simulated Torrential Rainfall, Storm Shafts & Smooth 2.5D Puddles ---\n");
    ShallowWaterConfiguration RainWaterCfg{};
    RainWaterCfg.CellsX         = 96u;
    RainWaterCfg.CellsY         = 96u;
    RainWaterCfg.CellSizeMetres = 0.25f;
    RainWaterCfg.WorldOriginXY  = {-12.0f, -12.0f};
    ShallowWaterSimulation RainPuddles{RainWaterCfg};
    // Subtle natural asphalt depressions where falling raindrops collect into smooth reflective puddles!
    RainPuddles.SculptBedDepressionOrMound({1.15f, -1.35f}, 3.85f, -0.068f);
    RainPuddles.SculptBedDepressionOrMound({4.10f, +0.90f}, 3.10f, -0.055f);
    const double RainInitVolM3 = RainPuddles.Diagnostics().TotalLiquidVolumeCubicM;

    SkyPrecipitationConfig RainCfg{};
    RainCfg.Phase            = SkyPrecipitationPhase::Rainfall;
    RainCfg.DomainCentreXY   = {2.0f, -0.5f, 0.0f};
    RainCfg.DomainHalfExtent = {9.5f, 9.5f, 5.2f};
    RainCfg.ParticleCount    = 9800u;
    RainCfg.Intensity01      = 1.0f;
    RainCfg.FlakeRadiusScale = 1.40f;
    SkyPrecipitation StormRainfall{RainCfg};

    auto OnRaindropTouchdown = [](const PrecipitationTouchdownEvent& Ev, void* Ctx) noexcept
    {
        auto* W = static_cast<ShallowWaterSimulation*>(Ctx);
        W->InjectLocalLiquidOrMeltVolume({Ev.HitPositionWorld.X, Ev.HitPositionWorld.Y}, 0.55f, 0.00145f, 0.0f);
    };
    auto QueryRainFloor = [](Vec3 Pt, float& OutZ, Vec3& OutN, float& OutRest, const void* Ctx) noexcept -> bool
    {
        const auto* W = static_cast<const ShallowWaterSimulation*>(Ctx);
        OutZ          = W->SampleSurface({Pt.X, Pt.Y}).FreeSurfaceElevationM;
        OutN          = {0.0f, 0.0f, 1.0f};
        OutRest       = 0.0f;
        return true;
    };

    for (int RStep = 0; RStep < 34; ++RStep)
    {
        StormRainfall.StepCoupledPrecipitation(
            1.0f / 30.0f,
            {3.2f, -1.1f, 0.0f},
            SampleSceneWind,
            &WindField,
            QueryRainFloor,
            &RainPuddles,
            OnRaindropTouchdown,
            &RainPuddles);
        (void)RainPuddles.StepSimulation(1.0f / 30.0f, {3.2f, -1.1f});
    }
    const auto RainDiag = RainPuddles.Diagnostics();
    std::snprintf(
        Note,
        sizeof(Note),
        "rain_touchdowns=%llu init_vol=%.3f final_vol=%.3f m^3 peak_depth=%.3f m mean_fall=%.2f m/s",
        static_cast<unsigned long long>(StormRainfall.Telemetry().RecycledTouchdowns),
        RainInitVolM3,
        RainDiag.TotalLiquidVolumeCubicM,
        RainDiag.PeakFluidDepthMetres,
        StormRainfall.Telemetry().MeanFallSpeedMps);
    Ledger.Verify(
        StormRainfall.Telemetry().RecycledTouchdowns > 900u &&
            RainDiag.TotalLiquidVolumeCubicM > RainInitVolM3 + 0.15 &&
            RainDiag.PeakFluidDepthMetres > 0.015f &&
            StormRainfall.Telemetry().MeanFallSpeedMps > 6.5f,
        "Simulated falling Rainfall physically fills 2.5D puddles (0 foam, 0 splash)",
        Note);

    SceneRenderer RainStormScene{};
    RainStormScene.RegisterTexturedGroundSlab({0.0f, 0.0f, -0.25f}, {36.0f, 36.0f, 0.25f}, {0.10f, 0.11f, 0.13f}, 0.34f, 0.06f);
    // Warm roadside storm floodlights & architectural shelter pylons backlighting the slanted silver-blue rain streaks!
    RainStormScene.RegisterDualTierSolidBox({-1.8f, +3.6f, 1.65f}, {0.22f, 0.22f, 1.65f}, {0.22f, 0.24f, 0.28f}, 0.45f);
    RainStormScene.RegisterDualTierSolidBox({+5.6f, +3.8f, 1.65f}, {0.22f, 0.22f, 1.65f}, {0.22f, 0.24f, 0.28f}, 0.45f);
    AreaLuminaireDescriptor StormLampL{};
    StormLampL.CentreWorld         = {-1.8f, +3.25f, 2.85f};
    StormLampL.RightAxis           = {1.0f, 0.0f, 0.0f};
    StormLampL.UpAxis              = {0.0f, 0.0f, 1.0f};
    StormLampL.FrontNormal         = Normalise(Vec3{0.35f, -0.90f, -0.25f});
    StormLampL.HalfWidthMetres     = 0.52f;
    StormLampL.HalfHeightMetres    = 0.22f;
    StormLampL.EmissiveRadianceRgb = {18.0f, 14.5f, 10.5f};
    RainStormScene.RegisterAreaLuminaire(StormLampL);

    AreaLuminaireDescriptor StormLampR = StormLampL;
    StormLampR.CentreWorld             = {+5.6f, +3.45f, 2.85f};
    StormLampR.FrontNormal             = Normalise(Vec3{-0.35f, -0.90f, -0.25f});
    StormLampR.EmissiveRadianceRgb     = {14.0f, 16.5f, 20.0f};
    RainStormScene.RegisterAreaLuminaire(StormLampR);

    auto AppendParkedControlVehicle = [&](SceneRenderer& TargetScene, Vec3 CarPos, Vec3 CarFwdUnit, Vec3 BodyTint)
    {
        if (!BlinnLoaded) return;
        const Vec3 CarLeft = Cross(Vec3{0.0f, 0.0f, 1.0f}, CarFwdUnit);
        auto AddPart = [&](const BlinnFacetMesh& Mesh, Vec3 Off, bool UseCoat)
        {
            for (size_t T = 0u; T + 2u < Mesh.Indices.size(); T += 3u)
            {
                const uint32_t I0 = Mesh.Indices[T + 0u], I1 = Mesh.Indices[T + 1u], I2 = Mesh.Indices[T + 2u];
                auto ToW = [&](Vec3 P) { return CarPos + CarFwdUnit * (P.X + Off.X) + CarLeft * (P.Y + Off.Y) + Vec3{0.0f, 0.0f, P.Z + Off.Z}; };
                const Vec3 V0 = ToW(Mesh.Positions[I0]), V1 = ToW(Mesh.Positions[I1]), V2 = ToW(Mesh.Positions[I2]);
                const Vec3 Cr = Cross(V1 - V0, V2 - V0);
                if (Length(Cr) <= 1.0e-7f) continue;
                const uint32_t MatId = (T / 3u < Mesh.MaterialIds.size()) ? Mesh.MaterialIds[T / 3u] : 0u;
                BlinnMaterialProperties St = BlinnRenderer::ResolveVehicleMaterial(MatId);
                RtxSceneTriangle Tri{};
                Tri.V0          = V0;
                Tri.V1          = V1;
                Tri.V2          = V2;
                Tri.Normal      = Normalise(Cr);
                Tri.AlbedoRgb   = (UseCoat && MatId == 6u) ? BodyTint : St.LinearAlbedo;
                Tri.EmissiveRgb = St.LinearEmission * 2.8f;
                Tri.Roughness   = (UseCoat && MatId == 6u) ? 0.14f : St.Roughness;
                Tri.Metallic    = (UseCoat && MatId == 6u) ? 0.28f : St.Metallic;
                TargetScene.RegisterPolygonTriangle(Tri);
            }
        };
        AddPart(BlinnBody, {0.0f, 0.0f, 0.0f}, true);
        const std::array<Vec3, 4u> WOff = {{{1.7274f, 1.0475f, -0.375f}, {1.7274f, -1.0475f, -0.375f}, {-1.6686f, 1.0475f, -0.375f}, {-1.6686f, -1.0475f, -0.375f}}};
        for (size_t K = 0u; K < 4u; ++K)
        {
            AddPart(BlinnTyre, WOff[K], false);
            AddPart((K % 2u == 0u) ? BlinnRimL : BlinnRimR, WOff[K], false);
        }
    };
    AppendParkedControlVehicle(RainStormScene, {3.15f, +1.55f, 0.795f}, Normalise(Vec3{-0.82f, -0.57f, 0.0f}), {0.82f, 0.22f, 0.12f});

    CoupledWorldOpticalContext RainViewCtx = OptCtx;
    RainViewCtx.SunDirectionUnit             = Normalise(Vec3{-0.45f, -0.62f, 0.64f});
    RainViewCtx.SunIrradianceRgb             = {3.8f, 4.3f, 5.4f};
    RainViewCtx.Clouds.Coverage              = 0.86;
    RainViewCtx.Fog.DensityAtBase            = 0.0052;
    RainViewCtx.HdrBloomStrength             = 0.22f;
    RainViewCtx.ExposureScale                = 0.86f;
    RainViewCtx.WaterCapillaryRippleStrength = 0.015f;
    RainViewCtx.PlumeFluid                   = nullptr;
    RainViewCtx.ShallowWater                 = &RainPuddles;
    RainViewCtx.Lightning                    = nullptr;
    RainViewCtx.Sparks                       = nullptr;
    RainViewCtx.Precipitation                = &StormRainfall;
    RainStormScene.FinalizeSceneAndBakeSurfaceCards(RainViewCtx);

    std::vector<uint8_t> RainStormRgba;
    RainStormScene.RenderViewportRgba8(
        GpuTracingTier::HardwareRayTracingRtx,
        HdWidth,
        HdHeight,
        {-1.35f, -4.45f, 1.48f},
        {2.25f, +0.45f, 0.65f},
        0.86f,
        RainViewCtx,
        RainStormRgba);

    // -----------------------------------------------------------------------------------------------------------------
    // SUITE 25: Simulated Ballistic Hailstorm, Multi-Bounce Rebounds & Granular Ice Accumulation
    // -----------------------------------------------------------------------------------------------------------------
    std::printf("\n--- Suite 25: Simulated Ballistic Hailstorm, Parabolic Rebounds & Granular Ice ---\n");
    SnowpackDomainSpec HailDomainSpec{};
    HailDomainSpec.CellsX                   = 128u;
    HailDomainSpec.CellsY                   = 128u;
    HailDomainSpec.CellSizeMetres           = 0.10f;
    HailDomainSpec.OriginX                  = -3.5f;
    HailDomainSpec.OriginY                  = -6.0f;
    HailDomainSpec.AmbientTemperatureKelvin = 270.15f;
    HailDomainSpec.SastrugiAmplitudeMetres  = 0.004f;
    SnowSurface HailField{HailDomainSpec};

    SkyPrecipitationConfig HailCfg{};
    HailCfg.Phase            = SkyPrecipitationPhase::Hailstorm;
    HailCfg.DomainCentreXY   = {2.1f, -0.2f, 0.0f};
    HailCfg.DomainHalfExtent = {8.5f, 8.5f, 5.0f};
    HailCfg.ParticleCount    = 8600u;
    HailCfg.Intensity01      = 1.0f;
    HailCfg.FlakeRadiusScale = 1.45f;
    HailCfg.HailRestitution  = 0.54f;
    HailCfg.MaxHailBounces   = 3u;
    SkyPrecipitation SevereHailstorm{HailCfg};

    const Vec3 HailCarPos = {2.75f, +0.85f, 0.795f};
    const Vec3 HailCarFwd = Normalise(Vec3{-0.84f, -0.54f, 0.0f});

    struct HailSurfaceCtx
    {
        SnowSurface* HailSnow;
        Vec3         CarCentre;
        Vec3         CarFwd;
    } HailBind{&HailField, HailCarPos, HailCarFwd};

    auto QueryHailCollider = [](Vec3 Pt, float& OutZ, Vec3& OutN, float& OutRest, const void* Ctx) noexcept -> bool
    {
        const auto* H    = static_cast<const HailSurfaceCtx*>(Ctx);
        const Vec3  Left = Cross(Vec3{0.0f, 0.0f, 1.0f}, H->CarFwd);
        const Vec3  Rel  = Pt - H->CarCentre;
        const float Lx   = Dot(Rel, H->CarFwd);
        const float Ly   = Dot(Rel, Left);
        // Elastic sheet-metal / windshield rebound off parked ControlVehicle hood & roof!
        if (std::abs(Lx) < 2.15f && std::abs(Ly) < 0.96f)
        {
            const float RoofProfile = (std::abs(Lx) < 0.85f) ? 0.62f : 0.28f;
            OutZ                    = H->CarCentre.Z + RoofProfile;
            OutN                    = Normalise(Vec3{0.12f * (Lx > 0.85f ? 1.0f : 0.0f), 0.14f * Ly, 1.0f});
            OutRest                 = 1.22f;
            return true;
        }
        // Basalt boulder rebound on foreground-left (clear of the vehicle front bumper)!
        if (std::abs(Pt.X + 1.05f) < 0.62f && std::abs(Pt.Y + 0.35f) < 0.52f)
        {
            OutZ    = 0.52f;
            OutN    = Normalise(Vec3{(Pt.X + 1.05f) * 0.35f, (Pt.Y + 0.35f) * 0.35f, 1.0f});
            OutRest = 1.15f;
            return true;
        }
        OutZ    = H->HailSnow->SampleGroundSurfaceElevation(Pt.X, Pt.Y);
        OutN    = {0.0f, 0.0f, 1.0f};
        OutRest = 1.0f;
        return true;
    };

    auto OnHailSettled = [](const PrecipitationTouchdownEvent& Ev, void* Ctx) noexcept
    {
        auto* H = static_cast<HailSurfaceCtx*>(Ctx);
        if (Ev.HitPositionWorld.Z < 0.35f)
        {
            H->HailSnow->DepositHailstoneTouchdown(Ev.HitPositionWorld, 0.036f, 0.24f);
        }
    };

    for (int HStep = 0; HStep < 88; ++HStep)
    {
        SevereHailstorm.StepCoupledPrecipitation(
            1.0f / 40.0f,
            {2.1f, -0.8f, 0.0f},
            SampleSceneWind,
            &WindField,
            QueryHailCollider,
            &HailBind,
            OnHailSettled,
            &HailBind);
    }
    HailField.RebuildContiguousPolygonSurfaces(ParkedCar);

    std::snprintf(
        Note,
        sizeof(Note),
        "hail_bounces=%llu rebounding_airborne=%u settled_hail=%llu ice_mass=%.2f kg mean_fall=%.2f m/s",
        static_cast<unsigned long long>(SevereHailstorm.Telemetry().HailBounceContacts),
        SevereHailstorm.Telemetry().AirborneRebounding,
        static_cast<unsigned long long>(HailField.Telemetry().RetiredHailPelletsFused),
        HailField.Telemetry().GroundSolidMassKg,
        SevereHailstorm.Telemetry().MeanFallSpeedMps);
    Ledger.Verify(
        SevereHailstorm.Telemetry().HailBounceContacts > 1200u &&
            SevereHailstorm.Telemetry().AirborneRebounding > 150u &&
            HailField.Telemetry().RetiredHailPelletsFused > 250u &&
            SevereHailstorm.Telemetry().MeanFallSpeedMps > 4.5f,
        "Simulated Hailstorm executes elastic multi-bounce rebounds & settles granular hail ice",
        Note);

    SceneRenderer HailStormScene{};
    HailStormScene.RegisterTexturedGroundSlab({0.0f, 0.0f, -0.25f}, {36.0f, 36.0f, 0.25f}, {0.11f, 0.12f, 0.15f}, 0.40f, 0.05f);
    HailStormScene.RegisterDualTierSolidBox({-1.05f, -0.35f, 0.26f}, {0.58f, 0.48f, 0.26f}, {0.18f, 0.20f, 0.24f}, 0.65f);
    HailStormScene.RegisterSmoothSnowSurface(HailField.GroundPolygonSurface());
    AppendParkedControlVehicle(HailStormScene, HailCarPos, HailCarFwd, {0.14f, 0.36f, 0.78f});

    CoupledWorldOpticalContext HailViewCtx = OptCtx;
    HailViewCtx.SunDirectionUnit = Normalise(Vec3{-0.52f, -0.66f, 0.54f});
    HailViewCtx.SunIrradianceRgb = {7.2f, 7.6f, 8.6f};
    HailViewCtx.Clouds.Coverage  = 0.78;
    HailViewCtx.Fog.DensityAtBase = 0.0036;
    HailViewCtx.HdrBloomStrength = 0.18f;
    HailViewCtx.ExposureScale    = 0.80f;
    HailViewCtx.PlumeFluid       = nullptr;
    HailViewCtx.ShallowWater     = nullptr;
    HailViewCtx.Lightning        = nullptr;
    HailViewCtx.Sparks           = nullptr;
    HailViewCtx.Precipitation    = &SevereHailstorm;
    HailStormScene.FinalizeSceneAndBakeSurfaceCards(HailViewCtx);

    std::vector<uint8_t> HailStormRgba;
    HailStormScene.RenderViewportRgba8(
        GpuTracingTier::HardwareRayTracingRtx,
        HdWidth,
        HdHeight,
        {-1.10f, -3.85f, 1.56f},
        {2.25f, +0.35f, 0.58f},
        0.85f,
        HailViewCtx,
        HailStormRgba);

    // Composite Cluster (960x240) + Central Screen (960x540) into 960x780 VehicleCabinHmiComposite.png!
    std::vector<uint8_t> HmiComposite;
    HmiComposite.reserve(ClusterImg.size() + ScreenImg.size());
    HmiComposite.insert(HmiComposite.end(), ClusterImg.begin(), ClusterImg.end());
    HmiComposite.insert(HmiComposite.end(), ScreenImg.begin(), ScreenImg.end());

    const bool Png1  = WriteRgba8PngFile(ImgDir + "GtxSdfPortalMirrorPlumeWater.png", GtxWidth, GtxHeight, GtxFrameRgba);
    const bool Png2  = WriteRgba8PngFile(ImgDir + "RtxPortalMirrorPlumeWater.png", HdWidth, HdHeight, RtxFrameRgba);
    const bool Png3  = WriteRgba8PngFile(ImgDir + "SnowPitFallingSnowAndSparks960x540.png", HdWidth, HdHeight, SnowSparkRgba);
    const bool Png4  = WriteRgba8PngFile(ImgDir + "VehicleCabinHmiComposite.png", 960u, 780u, HmiComposite);
    const bool Png5  = WriteRgba8PngFile(ImgDir + "PortalSplitVehicleTransit960x540.png", HdWidth, HdHeight, PortalVehicleRgba);
    const bool Png6  = WriteRgba8PngFile(ImgDir + "SolarDiscAndOpticalLensFlare960x540.png", HdWidth, HdHeight, SunFlareRgba);
    const bool Png7  = WriteRgba8PngFile(ImgDir + "BlinnLowResProvingGround960x540.png", HdWidth, HdHeight, BlinnRgba8);
    const bool Png8  = WriteRgba8PngFile(ImgDir + "ControlVehicle3DCockpitHmi960x540.png", HdWidth, HdHeight, Cockpit3DRgba);
    const bool Png9  = WriteRgba8PngFile(ImgDir + "CircularPortalDuplicateAndBlocking960x540.png", HdWidth, HdHeight, CircularPortalRgba);
    const bool Png10 = WriteRgba8PngFile(ImgDir + "NaniteClusterLodShowcase960x540.png", HdWidth, HdHeight, NaniteShowcaseRgba);
    const bool Png11 = WriteRgba8PngFile(ImgDir + "SnowfallMoundAccumulation960x540.png", HdWidth, HdHeight, SnowMoundHeroRgba);
    const bool Png12 = WriteRgba8PngFile(ImgDir + "SnowfallProgressiveAccumulation960x540.png", HdWidth, HdHeight, SnowTimelapseRgba);
    const bool Png13 = WriteRgba8PngFile(ImgDir + "TorrentialRainfallAndPuddles960x540.png", HdWidth, HdHeight, RainStormRgba);
    const bool Png14 = WriteRgba8PngFile(ImgDir + "HailstormBounceAndIce960x540.png", HdWidth, HdHeight, HailStormRgba);

    std::snprintf(
        Note,
        sizeof(Note),
        "png_ok=(%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d)",
        Png1 ? 1 : 0, Png2 ? 1 : 0, Png3 ? 1 : 0, Png4 ? 1 : 0, Png5 ? 1 : 0,
        Png6 ? 1 : 0, Png7 ? 1 : 0, Png8 ? 1 : 0, Png9 ? 1 : 0, Png10 ? 1 : 0,
        Png11 ? 1 : 0, Png12 ? 1 : 0, Png13 ? 1 : 0, Png14 ? 1 : 0);
    Ledger.Verify(
        Png1 && Png2 && Png3 && Png4 && Png5 && Png6 && Png7 && Png8 && Png9 && Png10 && Png11 && Png12 && Png13 && Png14,
        "Rendered 14 HD Stage I visual proof PNGs",
        Note);

    std::printf("\n====================================================================================================\n");
    std::printf("  SUMMARY: %u PASSED, %u FAILED\n", Ledger.Passed, Ledger.Failed);
    std::printf("====================================================================================================\n");

    return (Ledger.Failed == 0u) ? 0 : 1;
}
