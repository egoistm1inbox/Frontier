/*==========================================================================================================================================
                                                       BLINNRENDERER.CPP
==========================================================================================================================================*/
// 🧩 Low-resolution / low-quality z-buffered Lambert + hemisphere + Blinn-Phong + planar shadow software/fallback renderer.

#include "Engine/Rendering/BlinnRenderer.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <limits>

namespace Frontier
{
namespace
{
constexpr float PiConst = 3.14159265358979323846f;

[[nodiscard]] Vec3 SafeNormalize(Vec3 V) noexcept
{
    const float L2 = Dot(V, V);
    if (L2 <= 1.0e-18f)
    {
        return {0.0f, 0.0f, 1.0f};
    }
    const float Inv = 1.0f / std::sqrt(L2);
    return {V.X * Inv, V.Y * Inv, V.Z * Inv};
}

[[nodiscard]] uint8_t LinearToSrgbByte(float LinearValue) noexcept
{
    const float Clamped = std::clamp(LinearValue, 0.0f, 1.0f);
    const float Encoded = (Clamped <= 0.0031308f)
        ? (12.92f * Clamped)
        : (1.055f * std::pow(Clamped, 1.0f / 2.4f) - 0.055f);
    return static_cast<uint8_t>(std::clamp(std::lround(Encoded * 255.0f), 0L, 255L));
}

[[nodiscard]] Vec3 AcesFilmicQuick(Vec3 X) noexcept
{
    auto Map1 = [](float V) noexcept
    {
        const float P = std::max(0.0f, V);
        return std::clamp((P * (2.51f * P + 0.03f)) / (P * (2.43f * P + 0.59f) + 0.14f), 0.0f, 1.0f);
    };
    return {Map1(X.X), Map1(X.Y), Map1(X.Z)};
}

} // namespace

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                   FACET STREAM & MATERIAL HELPERS
------------------------------------------------------------------------------------------------------------------------------------------*/
bool BlinnRenderer::LoadFacetStream(const std::string& FilePath, BlinnFacetMesh& OutMesh)
{
    OutMesh = {};
    std::FILE* FileHandle = std::fopen(FilePath.c_str(), "rb");
    if (FileHandle == nullptr)
    {
        return false;
    }
    std::fseek(FileHandle, 0, SEEK_END);
    const long ByteLength = std::ftell(FileHandle);
    std::fseek(FileHandle, 0, SEEK_SET);
    if (ByteLength < 48L)
    {
        std::fclose(FileHandle);
        return false;
    }

    std::vector<uint8_t> Bytes(static_cast<std::size_t>(ByteLength));
    if (std::fread(Bytes.data(), 1u, Bytes.size(), FileHandle) != Bytes.size())
    {
        std::fclose(FileHandle);
        return false;
    }
    std::fclose(FileHandle);

    if (std::memcmp(Bytes.data(), "FCT1", 4u) != 0)
    {
        return false;
    }

    uint32_t VertexCount = 0u;
    uint32_t FacetCount  = 0u;
    uint32_t StreamFlags = 0u;
    std::memcpy(&VertexCount, Bytes.data() + 4u, 4u);
    std::memcpy(&FacetCount, Bytes.data() + 8u, 4u);
    std::memcpy(&StreamFlags, Bytes.data() + 12u, 4u);

    const std::size_t ExpectedMin = 48u + static_cast<std::size_t>(VertexCount) * 12u
        + static_cast<std::size_t>(FacetCount) * 16u;
    if (Bytes.size() < ExpectedMin)
    {
        return false;
    }

    const float*    RawPositions = reinterpret_cast<const float*>(Bytes.data() + 48u);
    const uint32_t* RawFacets    = reinterpret_cast<const uint32_t*>(Bytes.data() + 48u + static_cast<std::size_t>(VertexCount) * 12u);
    const uint32_t* RawMaterials = RawFacets + static_cast<std::size_t>(FacetCount) * 3u;

    OutMesh.Positions.resize(VertexCount);
    for (uint32_t Index = 0u; Index < VertexCount; ++Index)
    {
        OutMesh.Positions[Index] = {
            RawPositions[Index * 3u + 0u],
            RawPositions[Index * 3u + 1u],
            RawPositions[Index * 3u + 2u]};
    }
    OutMesh.Indices.assign(RawFacets, RawFacets + static_cast<std::size_t>(FacetCount) * 3u);
    OutMesh.MaterialIds.assign(RawMaterials, RawMaterials + FacetCount);
    OutMesh.VertexNormals.assign(VertexCount, Vec3{0.0f, 0.0f, 0.0f});
    OutMesh.SmoothNormals = (StreamFlags & 1u) != 0u;

    if (OutMesh.SmoothNormals)
    {
        const std::size_t SmoothBytes = ExpectedMin + static_cast<std::size_t>(FacetCount) * 36u;
        if (Bytes.size() >= SmoothBytes)
        {
            const float* CornerNormals = reinterpret_cast<const float*>(RawMaterials + FacetCount);
            for (uint32_t Facet = 0u; Facet < FacetCount; ++Facet)
            {
                for (uint32_t Corner = 0u; Corner < 3u; ++Corner)
                {
                    const uint32_t Vtx = OutMesh.Indices[Facet * 3u + Corner];
                    const float*   Cn  = CornerNormals + (Facet * 9u + Corner * 3u);
                    if (Vtx < VertexCount)
                    {
                        OutMesh.VertexNormals[Vtx] = OutMesh.VertexNormals[Vtx] + Vec3{Cn[0], Cn[1], Cn[2]};
                    }
                }
            }
            for (Vec3& Normal : OutMesh.VertexNormals)
            {
                Normal = SafeNormalize(Normal);
            }
        }
    }
    return true;
}

BlinnFacetMesh BlinnRenderer::MirrorFacetMeshAcrossY(const BlinnFacetMesh& Source, float UniformScale)
{
    BlinnFacetMesh Mirrored = Source;
    for (std::size_t Index = 0u; Index < Mirrored.Positions.size(); ++Index)
    {
        Mirrored.Positions[Index] = {
            Mirrored.Positions[Index].X * UniformScale,
            -Mirrored.Positions[Index].Y * UniformScale,
            Mirrored.Positions[Index].Z * UniformScale};
        if (Index < Mirrored.VertexNormals.size())
        {
            Mirrored.VertexNormals[Index] = {
                Mirrored.VertexNormals[Index].X,
                -Mirrored.VertexNormals[Index].Y,
                Mirrored.VertexNormals[Index].Z};
        }
    }
    for (std::size_t Base = 0u; Base + 2u < Mirrored.Indices.size(); Base += 3u)
    {
        std::swap(Mirrored.Indices[Base + 1u], Mirrored.Indices[Base + 2u]);
    }
    return Mirrored;
}

BlinnFacetMesh BlinnRenderer::ScaleFacetMesh(const BlinnFacetMesh& Source, float UniformScale)
{
    BlinnFacetMesh Scaled = Source;
    for (Vec3& Position : Scaled.Positions)
    {
        Position = Position * UniformScale;
    }
    return Scaled;
}

BlinnMaterialProperties BlinnRenderer::ResolveVehicleMaterial(uint32_t MaterialId) noexcept
{
    switch (MaterialId)
    {
    case 6u:  return {{0.45f, 0.72f, 0.56f}, 0.14f, 0.18f, {0.0f, 0.0f, 0.0f}, 1.0f};      // BodyCoat
    case 7u:  return {{0.05f, 0.08f, 0.11f}, 0.05f, 0.0f,  {0.0f, 0.0f, 0.0f}, 0.48f};     // VehicleGlass
    case 8u:  return {{0.024f, 0.028f, 0.032f}, 0.52f, 0.0f, {0.0f, 0.0f, 0.0f}, 1.0f};    // VehiclePlastic
    case 9u:  return {{0.042f, 0.044f, 0.048f}, 0.76f, 0.0f, {0.0f, 0.0f, 0.0f}, 1.0f};    // TyreRubber
    case 10u: return {{0.62f, 0.66f, 0.71f}, 0.22f, 0.88f, {0.0f, 0.0f, 0.0f}, 1.0f};      // AlloyRim / Hub
    case 12u: return {{0.74f, 0.76f, 0.78f}, 0.32f, 0.65f, {0.0f, 0.0f, 0.0f}, 1.0f};      // VehicleTrim
    case 13u: return {{0.70f, 0.74f, 0.80f}, 0.10f, 0.0f,  {1.25f, 1.22f, 1.12f}, 1.0f};   // Headlight
    case 14u: return {{0.65f, 0.06f, 0.06f}, 0.12f, 0.0f,  {1.15f, 0.05f, 0.04f}, 1.0f};   // Taillight
    case 15u: return {{0.68f, 0.70f, 0.72f}, 0.45f, 0.25f, {0.0f, 0.0f, 0.0f}, 1.0f};      // VehicleDefault
    default:  return {{0.42f, 0.44f, 0.46f}, 0.58f, 0.0f,  {0.0f, 0.0f, 0.0f}, 1.0f};
    }
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                       SCENE SUBMISSION
------------------------------------------------------------------------------------------------------------------------------------------*/
void BlinnRenderer::ClearScene() noexcept
{
    Triangles_.clear();
}

void BlinnRenderer::SubmitTriangle(
    Vec3                           P0,
    Vec3                           P1,
    Vec3                           P2,
    Vec3                           N0,
    Vec3                           N1,
    Vec3                           N2,
    const BlinnMaterialProperties& Material,
    bool                           CastsPlanarShadow)
{
    Triangles_.push_back({P0, P1, P2, SafeNormalize(N0), SafeNormalize(N1), SafeNormalize(N2), Material, CastsPlanarShadow});
}

void BlinnRenderer::SubmitFacetMesh(
    const BlinnFacetMesh&          Mesh,
    Vec3                           TranslationWorld,
    Vec3                           AxisX,
    Vec3                           AxisY,
    Vec3                           AxisZ,
    const BlinnMaterialProperties* OverrideBodyCoat,
    const BlinnMaterialProperties* OverrideRimCoat,
    bool                           CastsPlanarShadow)
{
    auto TransformPt = [&](Vec3 Local) noexcept -> Vec3
    {
        return TranslationWorld + AxisX * Local.X + AxisY * Local.Y + AxisZ * Local.Z;
    };
    auto TransformDir = [&](Vec3 LocalDir) noexcept -> Vec3
    {
        return SafeNormalize(AxisX * LocalDir.X + AxisY * LocalDir.Y + AxisZ * LocalDir.Z);
    };

    const std::size_t TriCount = Mesh.Indices.size() / 3u;
    Triangles_.reserve(Triangles_.size() + TriCount);
    for (std::size_t Tri = 0u; Tri < TriCount; ++Tri)
    {
        const uint32_t I0 = Mesh.Indices[Tri * 3u + 0u];
        const uint32_t I1 = Mesh.Indices[Tri * 3u + 1u];
        const uint32_t I2 = Mesh.Indices[Tri * 3u + 2u];
        if (I0 >= Mesh.Positions.size() || I1 >= Mesh.Positions.size() || I2 >= Mesh.Positions.size())
        {
            continue;
        }
        const Vec3 W0 = TransformPt(Mesh.Positions[I0]);
        const Vec3 W1 = TransformPt(Mesh.Positions[I1]);
        const Vec3 W2 = TransformPt(Mesh.Positions[I2]);
        const Vec3 FaceNormal = SafeNormalize(Cross(W1 - W0, W2 - W0));

        Vec3 N0 = FaceNormal;
        Vec3 N1 = FaceNormal;
        Vec3 N2 = FaceNormal;
        if (Mesh.SmoothNormals && Mesh.VertexNormals.size() == Mesh.Positions.size())
        {
            N0 = TransformDir(Mesh.VertexNormals[I0]);
            N1 = TransformDir(Mesh.VertexNormals[I1]);
            N2 = TransformDir(Mesh.VertexNormals[I2]);
        }

        const uint32_t MatId = (Tri < Mesh.MaterialIds.size()) ? Mesh.MaterialIds[Tri] : 0u;
        BlinnMaterialProperties Mat = ResolveVehicleMaterial(MatId);
        if (MatId == 6u && OverrideBodyCoat != nullptr)
        {
            Mat = *OverrideBodyCoat;
        }
        else if ((MatId == 10u || MatId == 12u || MatId == 15u) && OverrideRimCoat != nullptr)
        {
            Mat = *OverrideRimCoat;
        }
        Triangles_.push_back({W0, W1, W2, N0, N1, N2, Mat, CastsPlanarShadow});
    }
}

void BlinnRenderer::SubmitAxisBox(
    Vec3                           CentreWorld,
    Vec3                           HalfExtents,
    const BlinnMaterialProperties& Material,
    bool                           CastsPlanarShadow)
{
    const Vec3 Lo = CentreWorld - HalfExtents;
    const Vec3 Hi = CentreWorld + HalfExtents;
    const Vec3 C[8] = {
        {Lo.X, Lo.Y, Lo.Z}, {Hi.X, Lo.Y, Lo.Z}, {Hi.X, Hi.Y, Lo.Z}, {Lo.X, Hi.Y, Lo.Z},
        {Lo.X, Lo.Y, Hi.Z}, {Hi.X, Lo.Y, Hi.Z}, {Hi.X, Hi.Y, Hi.Z}, {Lo.X, Hi.Y, Hi.Z}};
    struct FaceQuad { int A, B, CIdx, D; Vec3 Normal; };
    const FaceQuad Faces[6] = {
        {0, 1, 5, 4, {0.0f, -1.0f, 0.0f}},
        {1, 2, 6, 5, {1.0f,  0.0f, 0.0f}},
        {2, 3, 7, 6, {0.0f,  1.0f, 0.0f}},
        {3, 0, 4, 7, {-1.0f, 0.0f, 0.0f}},
        {4, 5, 6, 7, {0.0f,  0.0f, 1.0f}},
        {3, 2, 1, 0, {0.0f,  0.0f, -1.0f}}};
    for (const FaceQuad& F : Faces)
    {
        SubmitTriangle(C[F.A], C[F.B], C[F.CIdx], F.Normal, F.Normal, F.Normal, Material, CastsPlanarShadow);
        SubmitTriangle(C[F.A], C[F.CIdx], C[F.D], F.Normal, F.Normal, F.Normal, Material, CastsPlanarShadow);
    }
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                   LOW-RES Z-BUFFERED BLINN RASTERIZER
------------------------------------------------------------------------------------------------------------------------------------------*/
void BlinnRenderer::RenderSceneToSrgb8(
    uint32_t                     OutputWidth,
    uint32_t                     OutputHeight,
    const BlinnCameraDescriptor& Camera,
    const BlinnRenderSettings&   Settings,
    std::vector<uint8_t>&        OutRgb8,
    BlinnRenderDiagnostics*      OutDiagnostics) const
{
    if (OutputWidth == 0u || OutputHeight == 0u)
    {
        OutRgb8.clear();
        return;
    }

    const float Scale = std::clamp(Settings.ResolutionScale, 0.20f, 1.0f);
    const uint32_t InternalW = std::max(16u, static_cast<uint32_t>(std::lround(static_cast<float>(OutputWidth) * Scale)));
    const uint32_t InternalH = std::max(16u, static_cast<uint32_t>(std::lround(static_cast<float>(OutputHeight) * Scale)));

    const Vec3  Forward  = SafeNormalize(Camera.TargetWorld - Camera.EyeWorld);
    const Vec3  Right    = SafeNormalize(Cross(Forward, Camera.UpWorld));
    const Vec3  Up       = SafeNormalize(Cross(Right, Forward));
    const float TanHalfY = std::tan(0.5f * Camera.VerticalFovDeg * (PiConst / 180.0f));
    const float Aspect   = static_cast<float>(InternalW) / static_cast<float>(InternalH);
    const float TanHalfX = TanHalfY * Aspect;
    const Vec3  SunDir   = SafeNormalize(Settings.SunDirectionUnit);

    std::vector<Vec3>    ColorBuf(static_cast<std::size_t>(InternalW) * InternalH);
    std::vector<float>   DepthBuf(static_cast<std::size_t>(InternalW) * InternalH, std::numeric_limits<float>::infinity());
    std::vector<uint8_t> ShadowStencil(static_cast<std::size_t>(InternalW) * InternalH, 0u);

    // 1. Background sky + analytic ground plane with planar shadow receiver
    for (uint32_t Py = 0u; Py < InternalH; ++Py)
    {
        const float NdcY = 1.0f - 2.0f * (static_cast<float>(Py) + 0.5f) / static_cast<float>(InternalH);
        for (uint32_t Px = 0u; Px < InternalW; ++Px)
        {
            const float NdcX = 2.0f * (static_cast<float>(Px) + 0.5f) / static_cast<float>(InternalW) - 1.0f;
            const Vec3  RayDir = SafeNormalize(Forward + Right * (NdcX * TanHalfX) + Up * (NdcY * TanHalfY));
            const std::size_t Idx = static_cast<std::size_t>(Py) * InternalW + Px;

            if (Settings.StudioBackdrop)
            {
                const float Radial = std::sqrt(NdcX * NdcX * 0.65f + NdcY * NdcY);
                const float Vignette = std::clamp(1.0f - 0.55f * Radial, 0.15f, 1.0f);
                ColorBuf[Idx] = Vec3{0.022f, 0.036f, 0.040f} * Vignette;
                if (Settings.DrawGroundChecker && RayDir.Z < -1.0e-4f)
                {
                    const float Tg = (Settings.ShadowPlaneZ - Camera.EyeWorld.Z) / RayDir.Z;
                    if (Tg > Camera.NearClipMetres && Tg < 30.0f)
                    {
                        const Vec3 Hit = Camera.EyeWorld + RayDir * Tg;
                        const float Disc = std::sqrt(Hit.X * Hit.X + Hit.Y * Hit.Y);
                        if (Disc < 4.4f)
                        {
                            const float Fade = 1.0f - std::clamp((Disc - 2.1f) / 2.3f, 0.0f, 1.0f);
                            const Vec3 StudioFloor = {0.048f, 0.068f, 0.072f};
                            ColorBuf[Idx] = ColorBuf[Idx] * (1.0f - Fade) + StudioFloor * Fade;
                            DepthBuf[Idx] = Dot(Hit - Camera.EyeWorld, Forward);
                        }
                    }
                }
            }
            else
            {
                const float SkyT = std::pow(std::clamp(RayDir.Z, 0.0f, 1.0f), 0.55f);
                Vec3 PixelLin = Settings.ClearSkyHorizon * (1.0f - SkyT) + Settings.ClearSkyZenith * SkyT;
                const float SunCos = std::max(0.0f, Dot(RayDir, SunDir));
                PixelLin = PixelLin + Settings.SunIrradiance * (0.18f * std::pow(SunCos, 96.0f));

                if (Settings.DrawGroundChecker && RayDir.Z < -1.0e-4f)
                {
                    const float Tg = (Settings.ShadowPlaneZ - Camera.EyeWorld.Z) / RayDir.Z;
                    if (Tg > Camera.NearClipMetres && Tg < 180.0f)
                    {
                        const Vec3 Hit = Camera.EyeWorld + RayDir * Tg;
                        const int32_t CellX = static_cast<int32_t>(std::floor(Hit.X * 0.5f));
                        const int32_t CellY = static_cast<int32_t>(std::floor(Hit.Y * 0.5f));
                        const bool Even = ((CellX + CellY) & 1) == 0;
                        const Vec3 Albedo = Even ? Vec3{0.20f, 0.21f, 0.23f} : Vec3{0.14f, 0.15f, 0.17f};
                        const float NoL = std::max(0.0f, SunDir.Z);
                        const Vec3 Irr = Settings.SkyHemisphereTop + Settings.SunIrradiance * (NoL / PiConst);
                        const Vec3 GroundLit{Albedo.X * Irr.X, Albedo.Y * Irr.Y, Albedo.Z * Irr.Z};
                        const float Fog = std::exp(-0.012f * Tg);
                        PixelLin = Settings.ClearSkyHorizon * (1.0f - Fog) + GroundLit * Fog;
                        DepthBuf[Idx] = Dot(Hit - Camera.EyeWorld, Forward);
                    }
                }
                ColorBuf[Idx] = PixelLin;
            }
        }
    }

    auto ProjectPoint = [&](Vec3 WorldP, float& OutSx, float& OutSy, float& OutViewZ) noexcept -> bool
    {
        const Vec3 Rel = WorldP - Camera.EyeWorld;
        OutViewZ = Dot(Rel, Forward);
        if (OutViewZ <= Camera.NearClipMetres)
        {
            return false;
        }
        const float InvZ = 1.0f / OutViewZ;
        const float NdcX = Dot(Rel, Right) * InvZ / TanHalfX;
        const float NdcY = Dot(Rel, Up) * InvZ / TanHalfY;
        OutSx = (0.5f * NdcX + 0.5f) * static_cast<float>(InternalW);
        OutSy = (0.5f - 0.5f * NdcY) * static_cast<float>(InternalH);
        return true;
    };

    uint32_t ShadowTriCount = 0u;
    if (Settings.CastPlanarShadows && SunDir.Z > 0.08f)
    {
        for (const SubmittedTriangleRecord& Tri : Triangles_)
        {
            if (!Tri.CastsShadow || Tri.Material.Opacity < 0.65f)
            {
                continue;
            }
            auto ProjectToGround = [&](Vec3 P) noexcept -> Vec3
            {
                const float Dz = std::max(0.0f, P.Z - Settings.ShadowPlaneZ);
                const float T  = Dz / SunDir.Z;
                return {P.X - SunDir.X * T, P.Y - SunDir.Y * T, Settings.ShadowPlaneZ + 0.002f};
            };
            float Sx0 = 0.0f, Sy0 = 0.0f, Sz0 = 0.0f;
            float Sx1 = 0.0f, Sy1 = 0.0f, Sz1 = 0.0f;
            float Sx2 = 0.0f, Sy2 = 0.0f, Sz2 = 0.0f;
            if (!ProjectPoint(ProjectToGround(Tri.P0), Sx0, Sy0, Sz0) ||
                !ProjectPoint(ProjectToGround(Tri.P1), Sx1, Sy1, Sz1) ||
                !ProjectPoint(ProjectToGround(Tri.P2), Sx2, Sy2, Sz2))
            {
                continue;
            }
            const float Area = (Sx1 - Sx0) * (Sy2 - Sy0) - (Sy1 - Sy0) * (Sx2 - Sx0);
            if (std::abs(Area) < 1.0e-3f)
            {
                continue;
            }
            const int32_t MinX = std::max(0, static_cast<int32_t>(std::floor(std::min({Sx0, Sx1, Sx2}))));
            const int32_t MaxX = std::min(static_cast<int32_t>(InternalW) - 1, static_cast<int32_t>(std::ceil(std::max({Sx0, Sx1, Sx2}))));
            const int32_t MinY = std::max(0, static_cast<int32_t>(std::floor(std::min({Sy0, Sy1, Sy2}))));
            const int32_t MaxY = std::min(static_cast<int32_t>(InternalH) - 1, static_cast<int32_t>(std::ceil(std::max({Sy0, Sy1, Sy2}))));
            if (MinX > MaxX || MinY > MaxY)
            {
                continue;
            }
            ++ShadowTriCount;
            const float InvArea = 1.0f / Area;
            for (int32_t Py = MinY; Py <= MaxY; ++Py)
            {
                const float SampleY = static_cast<float>(Py) + 0.5f;
                for (int32_t Px = MinX; Px <= MaxX; ++Px)
                {
                    const float SampleX = static_cast<float>(Px) + 0.5f;
                    const float W0 = ((Sx1 - SampleX) * (Sy2 - SampleY) - (Sy1 - SampleY) * (Sx2 - SampleX)) * InvArea;
                    const float W1 = ((Sx2 - SampleX) * (Sy0 - SampleY) - (Sy2 - SampleY) * (Sx0 - SampleX)) * InvArea;
                    const float W2 = 1.0f - W0 - W1;
                    if (W0 >= 0.0f && W1 >= 0.0f && W2 >= 0.0f)
                    {
                        const std::size_t Idx = static_cast<std::size_t>(Py) * InternalW + static_cast<std::size_t>(Px);
                        const float ZInterp = 1.0f / (W0 / Sz0 + W1 / Sz1 + W2 / Sz2);
                        if (ShadowStencil[Idx] == 0u && std::abs(ZInterp - DepthBuf[Idx]) < 0.25f)
                        {
                            ShadowStencil[Idx] = 1u;
                            ColorBuf[Idx] = ColorBuf[Idx] * 0.42f;
                        }
                    }
                }
            }
        }
    }

    // 2. Opaque pass first, translucent glazing pass second
    uint32_t RasterizedCount = 0u;
    for (int Pass = 0; Pass < 2; ++Pass)
    {
        for (const SubmittedTriangleRecord& Tri : Triangles_)
        {
            const bool IsTranslucent = Tri.Material.Opacity < 0.99f;
            if ((Pass == 0 && IsTranslucent) || (Pass == 1 && !IsTranslucent))
            {
                continue;
            }
            float Sx0 = 0.0f, Sy0 = 0.0f, Sz0 = 0.0f;
            float Sx1 = 0.0f, Sy1 = 0.0f, Sz1 = 0.0f;
            float Sx2 = 0.0f, Sy2 = 0.0f, Sz2 = 0.0f;
            if (!ProjectPoint(Tri.P0, Sx0, Sy0, Sz0) ||
                !ProjectPoint(Tri.P1, Sx1, Sy1, Sz1) ||
                !ProjectPoint(Tri.P2, Sx2, Sy2, Sz2))
            {
                continue;
            }
            const float Area = (Sx1 - Sx0) * (Sy2 - Sy0) - (Sy1 - Sy0) * (Sx2 - Sx0);
            if (std::abs(Area) < 1.0e-4f)
            {
                continue;
            }
            const int32_t MinX = std::max(0, static_cast<int32_t>(std::floor(std::min({Sx0, Sx1, Sx2}))));
            const int32_t MaxX = std::min(static_cast<int32_t>(InternalW) - 1, static_cast<int32_t>(std::ceil(std::max({Sx0, Sx1, Sx2}))));
            const int32_t MinY = std::max(0, static_cast<int32_t>(std::floor(std::min({Sy0, Sy1, Sy2}))));
            const int32_t MaxY = std::min(static_cast<int32_t>(InternalH) - 1, static_cast<int32_t>(std::ceil(std::max({Sy0, Sy1, Sy2}))));
            if (MinX > MaxX || MinY > MaxY)
            {
                continue;
            }

            ++RasterizedCount;
            const float InvArea = 1.0f / Area;
            const float InvZ0   = 1.0f / Sz0;
            const float InvZ1   = 1.0f / Sz1;
            const float InvZ2   = 1.0f / Sz2;

            const float RoughClamped = std::clamp(Tri.Material.Roughness, 0.04f, 1.0f);
            const float Shininess    = std::clamp(2.0f / (RoughClamped * RoughClamped * RoughClamped * RoughClamped) - 2.0f, 4.0f, 512.0f);
            const Vec3  DiffuseTint  = Tri.Material.LinearAlbedo * (1.0f - 0.85f * Tri.Material.Metallic);
            const Vec3  SpecF0       = Vec3{0.04f, 0.04f, 0.04f} * (1.0f - Tri.Material.Metallic)
                                     + Tri.Material.LinearAlbedo * Tri.Material.Metallic;

            for (int32_t Py = MinY; Py <= MaxY; ++Py)
            {
                const float SampleY = static_cast<float>(Py) + 0.5f;
                for (int32_t Px = MinX; Px <= MaxX; ++Px)
                {
                    const float SampleX = static_cast<float>(Px) + 0.5f;
                    const float B0 = ((Sx1 - SampleX) * (Sy2 - SampleY) - (Sy1 - SampleY) * (Sx2 - SampleX)) * InvArea;
                    const float B1 = ((Sx2 - SampleX) * (Sy0 - SampleY) - (Sy2 - SampleY) * (Sx0 - SampleX)) * InvArea;
                    const float B2 = 1.0f - B0 - B1;
                    if (B0 < 0.0f || B1 < 0.0f || B2 < 0.0f)
                    {
                        continue;
                    }

                    const float InvZ = B0 * InvZ0 + B1 * InvZ1 + B2 * InvZ2;
                    const float ViewZ = 1.0f / std::max(InvZ, 1.0e-6f);
                    const std::size_t Idx = static_cast<std::size_t>(Py) * InternalW + static_cast<std::size_t>(Px);
                    if (ViewZ >= DepthBuf[Idx])
                    {
                        continue;
                    }

                    const float PerspW0 = B0 * InvZ0 * ViewZ;
                    const float PerspW1 = B1 * InvZ1 * ViewZ;
                    const float PerspW2 = B2 * InvZ2 * ViewZ;

                    const Vec3 WorldPos = Tri.P0 * PerspW0 + Tri.P1 * PerspW1 + Tri.P2 * PerspW2;
                    Vec3 Normal = SafeNormalize(Tri.N0 * PerspW0 + Tri.N1 * PerspW1 + Tri.N2 * PerspW2);
                    const Vec3 ViewDir = SafeNormalize(Camera.EyeWorld - WorldPos);
                    if (Dot(Normal, ViewDir) < 0.0f)
                    {
                        Normal = Normal * -1.0f;
                    }

                    // Lambert + hemispherical sky/ground fill + Blinn-Phong half-vector specular
                    const float NoL  = std::max(0.0f, Dot(Normal, SunDir));
                    const Vec3  Half = SafeNormalize(SunDir + ViewDir);
                    const float NoH  = std::max(0.0f, Dot(Normal, Half));
                    const float NoV  = std::clamp(Dot(Normal, ViewDir), 0.0f, 1.0f);
                    const float FresnelSchlick = std::pow(1.0f - NoV, 5.0f);
                    const Vec3  F    = SpecF0 + (Vec3{1.0f, 1.0f, 1.0f} - SpecF0) * FresnelSchlick;
                    const float SpecNorm = (Shininess + 8.0f) / (8.0f * PiConst);
                    const Vec3  SpecTerm = F * (SpecNorm * std::pow(NoH, Shininess) * NoL);

                    const float HemiBlend = 0.5f * Normal.Z + 0.5f;
                    const Vec3  HemiIrr   = Settings.GroundHemisphereBot * (1.0f - HemiBlend) + Settings.SkyHemisphereTop * HemiBlend;
                    const Vec3  SkySheen  = Settings.SkyHemisphereTop * (0.35f + 0.65f * HemiBlend);
                    const Vec3  EnvSheen{F.X * SkySheen.X, F.Y * SkySheen.Y, F.Z * SkySheen.Z};
                    const Vec3  TotalIrr  = HemiIrr + Settings.SunIrradiance * (NoL / PiConst);

                    Vec3 Shaded = Vec3{
                                      DiffuseTint.X * TotalIrr.X + Settings.SunIrradiance.X * SpecTerm.X,
                                      DiffuseTint.Y * TotalIrr.Y + Settings.SunIrradiance.Y * SpecTerm.Y,
                                      DiffuseTint.Z * TotalIrr.Z + Settings.SunIrradiance.Z * SpecTerm.Z}
                                + EnvSheen * (1.0f - 0.65f * RoughClamped)
                                + Tri.Material.LinearEmission;

                    if (Settings.WireframeOverlay)
                    {
                        const float MinBary = std::min({B0, B1, B2});
                        if (MinBary < 0.045f)
                        {
                            Shaded = Shaded * 0.30f + Vec3{0.04f, 0.08f, 0.10f};
                        }
                    }

                    if (!IsTranslucent)
                    {
                        DepthBuf[Idx] = ViewZ;
                        ColorBuf[Idx] = Shaded;
                    }
                    else
                    {
                        const float Alpha = std::clamp(Tri.Material.Opacity + 0.55f * FresnelSchlick, 0.08f, 0.95f);
                        ColorBuf[Idx] = ColorBuf[Idx] * (1.0f - Alpha) + Shaded * Alpha;
                    }
                }
            }
        }
    }

    // 3. Upscale low-resolution internal framebuffer to OutputWidth x OutputHeight and encode sRGB8
    OutRgb8.resize(static_cast<std::size_t>(OutputWidth) * OutputHeight * 3u);
    for (uint32_t Oy = 0u; Oy < OutputHeight; ++Oy)
    {
        const float SrcYf = ((static_cast<float>(Oy) + 0.5f) / static_cast<float>(OutputHeight)) * static_cast<float>(InternalH) - 0.5f;
        for (uint32_t Ox = 0u; Ox < OutputWidth; ++Ox)
        {
            const float SrcXf = ((static_cast<float>(Ox) + 0.5f) / static_cast<float>(OutputWidth)) * static_cast<float>(InternalW) - 0.5f;
            Vec3 SampleLin{};
            if (!Settings.BilinearUpscale || (InternalW == OutputWidth && InternalH == OutputHeight))
            {
                const uint32_t Ix = std::clamp(static_cast<int32_t>(std::lround(SrcXf)), 0, static_cast<int32_t>(InternalW) - 1);
                const uint32_t Iy = std::clamp(static_cast<int32_t>(std::lround(SrcYf)), 0, static_cast<int32_t>(InternalH) - 1);
                SampleLin = ColorBuf[static_cast<std::size_t>(Iy) * InternalW + Ix];
            }
            else
            {
                const int32_t X0 = std::clamp(static_cast<int32_t>(std::floor(SrcXf)), 0, static_cast<int32_t>(InternalW) - 1);
                const int32_t Y0 = std::clamp(static_cast<int32_t>(std::floor(SrcYf)), 0, static_cast<int32_t>(InternalH) - 1);
                const int32_t X1 = std::min(X0 + 1, static_cast<int32_t>(InternalW) - 1);
                const int32_t Y1 = std::min(Y0 + 1, static_cast<int32_t>(InternalH) - 1);
                const float   Fx = std::clamp(SrcXf - static_cast<float>(X0), 0.0f, 1.0f);
                const float   Fy = std::clamp(SrcYf - static_cast<float>(Y0), 0.0f, 1.0f);
                const Vec3 C00 = ColorBuf[static_cast<std::size_t>(Y0) * InternalW + X0];
                const Vec3 C10 = ColorBuf[static_cast<std::size_t>(Y0) * InternalW + X1];
                const Vec3 C01 = ColorBuf[static_cast<std::size_t>(Y1) * InternalW + X0];
                const Vec3 C11 = ColorBuf[static_cast<std::size_t>(Y1) * InternalW + X1];
                const Vec3 Top = C00 * (1.0f - Fx) + C10 * Fx;
                const Vec3 Bot = C01 * (1.0f - Fx) + C11 * Fx;
                SampleLin = Top * (1.0f - Fy) + Bot * Fy;
            }
            const Vec3 Mapped = AcesFilmicQuick(SampleLin);
            const std::size_t OutBase = (static_cast<std::size_t>(Oy) * OutputWidth + Ox) * 3u;
            OutRgb8[OutBase + 0u] = LinearToSrgbByte(Mapped.X);
            OutRgb8[OutBase + 1u] = LinearToSrgbByte(Mapped.Y);
            OutRgb8[OutBase + 2u] = LinearToSrgbByte(Mapped.Z);
        }
    }

    if (OutDiagnostics != nullptr)
    {
        OutDiagnostics->OutputWidth         = OutputWidth;
        OutDiagnostics->OutputHeight        = OutputHeight;
        OutDiagnostics->InternalWidth       = InternalW;
        OutDiagnostics->InternalHeight      = InternalH;
        OutDiagnostics->SubmittedTriangles  = static_cast<uint32_t>(Triangles_.size());
        OutDiagnostics->RasterizedTriangles = RasterizedCount;
        OutDiagnostics->ShadowTriangles     = ShadowTriCount;
    }
}

} // namespace Frontier
