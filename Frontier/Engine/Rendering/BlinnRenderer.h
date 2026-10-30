/*==========================================================================================================================================
                                                        BLINNRENDERER.H
==========================================================================================================================================*/
// 🧩 Low-resolution / low-quality z-buffered Lambert + hemisphere + Blinn-Phong + planar shadow software/fallback renderer.

#pragma once

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             INCLUDES
------------------------------------------------------------------------------------------------------------------------------------------*/
#include "Engine/Foundation/Math.h"

#include <cstdint>
#include <string>
#include <vector>

namespace Frontier
{
/*------------------------------------------------------------------------------------------------------------------------------------------
                                                   FACET STREAM & MATERIAL RECORDS
------------------------------------------------------------------------------------------------------------------------------------------*/
struct BlinnMaterialProperties
{
    Vec3  LinearAlbedo      = {0.42f, 0.42f, 0.44f}; // [linear RGB] - Diffuse surface reflectance
    float Roughness         = 0.55f;                 // [0..1] - Controls Blinn-Phong specular exponent & sheen
    float Metallic          = 0.0f;                  // [0..1] - Specular tint toward albedo
    Vec3  LinearEmission    = {0.0f, 0.0f, 0.0f};    // [linear RGB] - Self-emissive radiance
    float Opacity           = 1.0f;                  // [0..1] - Alpha coverage for ghost/glazing passes
};

struct BlinnFacetMesh
{
    std::vector<Vec3>     Positions{};       // [m] - Vertex positions in authored local space
    std::vector<Vec3>     VertexNormals{};   // [unit] - Smooth corner-averaged vertex normals
    std::vector<uint32_t> Indices{};         // [index] - 3 indices per triangle
    std::vector<uint32_t> MaterialIds{};     // [id] - 1 material family identifier per triangle
    bool                  SmoothNormals = false; // [boolean] - True when smooth vertex normals are active
};

struct BlinnCameraDescriptor
{
    Vec3  EyeWorld          = {-6.0f, -5.0f, 2.2f}; // [m] - Camera position in world space
    Vec3  TargetWorld       = {0.0f, 0.0f, 0.65f};  // [m] - Camera look-at target in world space
    Vec3  UpWorld           = {0.0f, 0.0f, 1.0f};   // [unit] - World up vector
    float VerticalFovDeg    = 42.0f;                // [deg] - Vertical field of view
    float NearClipMetres    = 0.12f;                // [m] - Near clipping plane distance
};

struct BlinnRenderSettings
{
    float    ResolutionScale       = 0.50f;                 // [0.20..1.0] - Internal low-res raster scale (<1 = low-res tier)
    bool     BilinearUpscale       = false;                 // [boolean] - False = crisp low-res nearest upscale, True = bilinear
    bool     CastPlanarShadows     = true;                  // [boolean] - Project planar ground shadows onto ShadowPlaneZ
    bool     DrawGroundChecker     = true;                  // [boolean] - Rasterize reference ground plane
    bool     WireframeOverlay      = false;                 // [boolean] - Draw triangle edges over shaded facets
    float    ShadowPlaneZ          = 0.0f;                  // [m] - Elevation of planar shadow receiver
    Vec3     SunDirectionUnit      = {0.42f, -0.48f, 0.77f};// [unit] - Directional sunlight vector
    Vec3     SunIrradiance         = {2.35f, 2.24f, 2.05f}; // [linear RGB] - Direct sunlight strength
    Vec3     SkyHemisphereTop      = {0.26f, 0.36f, 0.54f}; // [linear RGB] - Upper sky hemisphere fill
    Vec3     GroundHemisphereBot   = {0.08f, 0.07f, 0.06f}; // [linear RGB] - Lower ground bounce fill
    Vec3     ClearSkyHorizon       = {0.52f, 0.63f, 0.78f}; // [linear RGB] - Background horizon colour
    Vec3     ClearSkyZenith        = {0.16f, 0.28f, 0.52f}; // [linear RGB] - Background zenith colour
    bool     StudioBackdrop        = false;                 // [boolean] - Dark studio radial backdrop (for HMI Garage preview)
};

struct BlinnRenderDiagnostics
{
    uint32_t OutputWidth           = 0u; // [px] - Presented output width
    uint32_t OutputHeight          = 0u; // [px] - Presented output height
    uint32_t InternalWidth         = 0u; // [px] - Low-res internal raster width
    uint32_t InternalHeight        = 0u; // [px] - Low-res internal raster height
    uint32_t SubmittedTriangles    = 0u; // [count] - Total world triangles submitted
    uint32_t RasterizedTriangles   = 0u; // [count] - Front/visible triangles rasterized
    uint32_t ShadowTriangles       = 0u; // [count] - Planar shadow triangles projected
};

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                        BLINN RENDERER
------------------------------------------------------------------------------------------------------------------------------------------*/
class BlinnRenderer
{
public:
    BlinnRenderer() = default;

    // Loads binary FCT1 facet stream (ControlVehicleBody.facet, ControlVehicleRim.facet, ControlVehicleTyre.facet).
    [[nodiscard]] static bool LoadFacetStream(const std::string& FilePath, BlinnFacetMesh& OutMesh);
    [[nodiscard]] static BlinnFacetMesh MirrorFacetMeshAcrossY(const BlinnFacetMesh& Source, float UniformScale = 1.0f);
    [[nodiscard]] static BlinnFacetMesh ScaleFacetMesh(const BlinnFacetMesh& Source, float UniformScale);
    [[nodiscard]] static BlinnMaterialProperties ResolveVehicleMaterial(uint32_t MaterialId) noexcept;

    void ClearScene() noexcept;

    void SubmitTriangle(
        Vec3                           P0,
        Vec3                           P1,
        Vec3                           P2,
        Vec3                           N0,
        Vec3                           N1,
        Vec3                           N2,
        const BlinnMaterialProperties& Material,
        bool                           CastsPlanarShadow = true);

    void SubmitFacetMesh(
        const BlinnFacetMesh& Mesh,
        Vec3                  TranslationWorld,
        Vec3                  AxisX,
        Vec3                  AxisY,
        Vec3                  AxisZ,
        const BlinnMaterialProperties* OverrideBodyCoat = nullptr,
        const BlinnMaterialProperties* OverrideRimCoat  = nullptr,
        bool                  CastsPlanarShadow         = true);

    void SubmitAxisBox(
        Vec3                           CentreWorld,
        Vec3                           HalfExtents,
        const BlinnMaterialProperties& Material,
        bool                           CastsPlanarShadow = true);

    void RenderSceneToSrgb8(
        uint32_t                    OutputWidth,
        uint32_t                    OutputHeight,
        const BlinnCameraDescriptor& Camera,
        const BlinnRenderSettings&  Settings,
        std::vector<uint8_t>&       OutRgb8,
        BlinnRenderDiagnostics*     OutDiagnostics = nullptr) const;

private:
    struct SubmittedTriangleRecord
    {
        Vec3                    P0{}, P1{}, P2{};
        Vec3                    N0{}, N1{}, N2{};
        BlinnMaterialProperties Material{};
        bool                    CastsShadow = true;
    };

    std::vector<SubmittedTriangleRecord> Triangles_{};
};

} // namespace Frontier
