//============================================================================================================================================
// 📦 Engine/Shaders/ReSTIRViewport.slang — Progressive path tracer with RIS direct lighting (interim kernel)
//============================================================================================================================================
// 🚧 HONEST STATUS (plan v2.1 R0): this is NOT ReSTIR as published. Per pixel it does
//       • primary visibility from the R2 visibility raster (SurfaceImage / NormalImage, no primary rays),
//       • shadow / bounce rays traverse the R3 CWBVH (TraversalCWBVH.slang, bindings 8-9) — O(log N), not O(N),
//       • ReSTIR-DI *initial candidates only*: M light samples resampled with a weighted reservoir (correct RIS),
//         with SpatialPassCount extra candidates folded in — there is NO temporal and NO spatial neighbour reuse (R5),
//       • one BSDF-sampled bounce with next-event estimation — plain 1-bounce path tracing, no GI reservoir (R6),
//       • R4b: surfaces are shaded with the OpenPBR lobe set of MaterialEvaluation.slang (one resolved slab, interpolated
//         normals + normal maps from the VertexRecord buffer, ray-cone texture LOD, GGX energy / LTC sheen LUTs),
//       • a running-mean accumulation that restarts on camera motion; motion vectors exist (R2) but are not consumed yet (R5), no denoiser (R6).
//    It is kept as the reference image source until the staged frame graph replaces it.
// NOTE: GLSL source lowered to SPIR-V by the build scripts (glslc -fshader-stage=compute --target-env=vulkan1.2 -I Engine).
//       World space is right-handed Z-up (CLAUDE.md §7); the pixel→ray mapping (Shaders/RayGeneration.slang) is applied by
//       SurfaceResolve.slang — this kernel no longer generates camera rays.

#version 460
#extension GL_GOOGLE_include_directive : require
#extension GL_EXT_nonuniform_qualifier : require   // R4a: bindless Textures[nonuniformEXT(slot)]
layout(local_size_x = 16, local_size_y = 16, local_size_z = 1) in;

//------------------------------------------------------------------------------------------------------------------------
//                                                    STORAGE IMAGE OUTPUT
//------------------------------------------------------------------------------------------------------------------------

layout(rgba8,   binding = 0) uniform writeonly image2D OutputImage;    // tone-mapped 8-bit presentation image
layout(rgba32f, binding = 3) uniform          image2D HistoryImage;   // linear HDR running mean, .a = sample count
layout(rgba32f, binding = 4) uniform readonly image2D SurfaceImage;   // R2 SurfaceResolve: xyz = world position, w = visibility id bits
layout(rgba16f, binding = 5) uniform readonly image2D NormalImage;    // R2 SurfaceResolve: xyz = camera-facing geometric normal

//------------------------------------------------------------------------------------------------------------------------
//                                                    SCENE GEOMETRY BINDING
//------------------------------------------------------------------------------------------------------------------------

struct GpuTriangle          // TriangleIndex (SwapchainExchange.h), R4a layout
{
    vec4 v0;            // xyz = vertex α, w = materialIndex (floatBitsToUint)
    vec4 v1;            // xyz = vertex β, w = γ.u
    vec4 v2;            // xyz = vertex γ, w = γ.v
    vec4 uv;            // xy = α.uv, zw = β.uv
};

struct GpuMaterial          // MaterialRecord (ContentInterchange/MaterialIndex.h, 64 B) — R4a header; mirrors SceneRecords.slang
{
    vec4  Albedo;           // xyz = flattened base colour, w = specular roughness
    vec4  Emissive;         // xyz = emission radiance [nit], w = metalness
    uvec4 Slabs;            // x = SlabOffset, y = SlabCount, z = Flags, w = Complexity
    uvec2 Textures;         // x = base colour slot, y = normal slot (0xFFFFFFFF = none)
    float AlphaCutoff;
    float NormalScale;
};

struct GpuMaterialSlab      // MaterialSlabRecord (288 B) — 18 vec4; field map in SceneRecords.slang. Read by R4b shading.
{
    vec4  Payload[15];
    uvec4 TextureSlots0;
    uvec4 TextureSlots1;
    uvec4 Runtime;
};

struct GpuInstance          // InstanceRecord (SceneStructure.h / SceneRecords.slang) — only MaterialIndex is read here
{
    mat4 World;
    mat4 PreviousWorld;
    uint VertexOffset;
    uint FirstIndex;
    uint TriangleCount;
    uint MaterialIndex;
    uint ClusterOffset;
    uint ClusterCount;
    uint Flags;
    uint FlatTriangleOffset;
};

struct GpuLuminaire         // LuminaireRecord (SceneStructure.h): emissive triangle + alias entry
{
    uint  TriangleSlot;     // index into Triangles[]
    uint  InstanceIndex;
    uint  PrimitiveIndex;
    uint  AliasSlot;
    float Threshold;
    float Area;
    float Probability;
    float Pad;
};

layout(std430, binding = 1) readonly buffer TriangleExtent  { GpuTriangle  Triangles[];  };
layout(std430, binding = 2) readonly buffer MaterialExtent  { GpuMaterial  Materials[];  };
layout(std430, binding = 6) readonly buffer InstanceExtent  { GpuInstance  Instances[];  };
layout(std430, binding = 7) readonly buffer LuminaireExtent { GpuLuminaire Luminaires[]; };
layout(std430, binding = 8) readonly buffer TraversalNodeExtent { vec4 CwbvhNodes[]; };   // R3: TraversalIndex node blob
layout(std430, binding = 9) readonly buffer TraversalLeafExtent { vec4 CwbvhTris[];  };   // R3: TraversalIndex triangle blob
layout(std430, binding = 10) readonly buffer MaterialSlabExtent { GpuMaterialSlab MaterialSlabs[]; };

struct GpuVertex            // VertexRecord (SceneRecords.slang, 64 B) — R4b: interpolated normals / tangents / UVs
{
    vec4 Position;
    vec4 Normal;            // xyz object space
    vec4 Tangent;           // xyz object space, w = bitangent sign
    vec4 Texcoord;          // xy
};
layout(std430, binding = 11) readonly buffer VertexExtent { GpuVertex Vertices[]; };   // R4b: shared with the R2 raster set
layout(std430, binding = 12) readonly buffer IndexExtent  { uint      Indices[];  };   // R4b
// 13 = EnergyLut, 14 = SheenLut (declared in MaterialEvaluation.slang)
layout(binding = 15) uniform sampler2D Textures[];   // R4a bindless table — ⚠️ moved 11 → 15 in R4b: a variable-count binding must be the last one in the set

const uint kMaterialTextureNone = 0xFFFFFFFFu;

#include "MaterialEvaluation.slang"

//------------------------------------------------------------------------------------------------------------------------
//                                          R4b: MATERIAL RESOLVE (slab + textures → ShadingRecord)
//------------------------------------------------------------------------------------------------------------------------
// Barycentrics are rebuilt from the hit position against the flat triangle (one convention for the raster-fed primary
//    hit and the CWBVH bounce hit). Vertex normals / tangents / UVs come from the shared VertexRecord buffer (binding 11/12)
//    through the instance's index range — the same data the R2 raster consumes, so nothing is uploaded twice.
// Texture LOD: ray cones (Akenine-Möller et al. 2019/2021). Cone width w = t · pixelSpread (primary) + t₂ · pixelSpread
//    (bounce, ⚠️ no curvature term yet — flat-surface spread only); λ = ½ log2(texW·texH · uvArea / worldArea) + log2(w / |n·d|).
// ⚠️ Texture channel selection is not part of MaterialSlabRecord; the shader assumes the glTF packing the codec emits:
//    metalness = B and roughness = G of the metallicRoughness image, occlusion = R, opacity = A of base colour, others RGB.

vec3 Barycentric(vec3 p, vec3 a, vec3 b, vec3 c)
{
    vec3 e0 = b - a, e1 = c - a, e2 = p - a;
    float d00 = dot(e0, e0), d01 = dot(e0, e1), d11 = dot(e1, e1), d20 = dot(e2, e0), d21 = dot(e2, e1);
    float den = d00 * d11 - d01 * d01;
    if (abs(den) < 1e-20) return vec3(1.0, 0.0, 0.0);
    float v = (d11 * d20 - d01 * d21) / den;
    float w = (d00 * d21 - d01 * d20) / den;
    return vec3(1.0 - v - w, v, w);
}

// Texture slot of channel C (0-15) of a slab, 0xFFFF = none — mirrors MaterialSlabTexture in SceneRecords.slang.
uint SlabTexture(GpuMaterialSlab S, uint C)
{
    uint Word = C < 8u ? S.TextureSlots0[C / 2u] : S.TextureSlots1[(C - 8u) / 2u];
    return (Word >> ((C & 1u) * 16u)) & 0xFFFFu;
}
const uint kChannelBaseColor = 0u, kChannelMetalness = 1u, kChannelRoughness = 2u, kChannelSpecularColor = 3u, kChannelNormal = 4u,
           kChannelCoatNormal = 5u, kChannelEmission = 6u, kChannelOpacity = 7u, kChannelCoat = 10u, kChannelFuzz = 11u,
           kChannelThinFilm = 12u, kChannelOcclusion = 14u;

struct SurfaceFrame         // everything the kernel needs at a hit besides the ShadingRecord
{
    vec3  Normal;           // shading normal (interpolated + normal map), facing the viewer side
    vec3  Tangent;          // orthonormal frame axes for the local BSDF space
    vec3  Bitangent;
    vec3  Geometric;        // face normal facing the viewer side (ray offsets, shadow rays)
    vec3  Emission;         // slab emission × texture [nit]
    float Opacity;          // geometry_opacity × texture alpha
    float Occlusion;        // baked AO — multiplies the debug ambient floor only
    float LodBias;          // ½ log2(uvArea / worldArea) + log2(coneWidth / |n·d|): add ½ log2(texW·texH) per texture
};

vec3 ToLocal(SurfaceFrame F, vec3 w)   { return vec3(dot(w, F.Tangent), dot(w, F.Bitangent), dot(w, F.Normal)); }
vec3 FromLocal(SurfaceFrame F, vec3 w) { return F.Tangent * w.x + F.Bitangent * w.y + F.Normal * w.z; }

vec4 SampleChannel(GpuMaterialSlab S, uint channel, vec2 uv, float lodBias, vec4 fallback)
{
    uint slot = SlabTexture(S, channel);
    if (slot == 0xFFFFu) return fallback;
    ivec2 size = textureSize(Textures[nonuniformEXT(slot)], 0);
    float lod = lodBias + 0.5 * log2(float(size.x * size.y));
    return textureLod(Textures[nonuniformEXT(slot)], uv, lod);
}

// Resolve the material at a hit. `viewDir` points from the hit towards the viewer / previous vertex; `coneWidth` is the
//    ray-cone footprint at the hit [m]. Fills the ShadingRecord from the first slab (Tier A: one resolved slab) or, when
//    the material has no slab, from the 64 B header (constant base colour / roughness / metalness).
ShadingRecord ResolveMaterial(GpuMaterial mat, GpuInstance instance, uint primitive, vec3 hitPos, vec3 viewDir, float coneWidth, out SurfaceFrame F)
{
    GpuTriangle tri = Triangles[instance.FlatTriangleOffset + primitive];
    vec3 bc = Barycentric(hitPos, tri.v0.xyz, tri.v1.xyz, tri.v2.xyz);
    vec3 e1 = tri.v1.xyz - tri.v0.xyz, e2 = tri.v2.xyz - tri.v0.xyz;
    vec3 faceCross = cross(e1, e2);
    float worldArea = 0.5 * length(faceCross);
    vec3 ng = worldArea > 0.0 ? faceCross / (2.0 * worldArea) : vec3(0.0, 0.0, 1.0);
    if (dot(ng, viewDir) < 0.0) ng = -ng;

    // Vertex attributes through the instance's index range (object space → world with the instance matrix).
    uint base = instance.FirstIndex + primitive * 3u;
    GpuVertex va = Vertices[Indices[base + 0u] + instance.VertexOffset];
    GpuVertex vb = Vertices[Indices[base + 1u] + instance.VertexOffset];
    GpuVertex vc = Vertices[Indices[base + 2u] + instance.VertexOffset];
    mat3 world = mat3(instance.World);   // ⚠️ normals use the linear part directly (rigid / uniform scale); non-uniform scale is not corrected
    vec2 uv  = bc.x * va.Texcoord.xy + bc.y * vb.Texcoord.xy + bc.z * vc.Texcoord.xy;
    vec3 nI  = world * (bc.x * va.Normal.xyz + bc.y * vb.Normal.xyz + bc.z * vc.Normal.xyz);
    vec4 tI  = bc.x * va.Tangent + bc.y * vb.Tangent + bc.z * vc.Tangent;
    vec3 n   = dot(nI, nI) > 1e-12 ? normalize(nI) : ng;
    if (dot(n, ng) < 0.0) n = -n;                                   // interpolated normal follows the viewer-facing side
    vec3 t;
    if (dot(tI.xyz, tI.xyz) > 1e-12) t = world * tI.xyz;
    else                                                            // no authored tangents: derive from the UV parametrisation of the face
    {
        vec2 duv1 = vb.Texcoord.xy - va.Texcoord.xy, duv2 = vc.Texcoord.xy - va.Texcoord.xy;
        float det = duv1.x * duv2.y - duv2.x * duv1.y;
        t = abs(det) > 1e-12 ? (e1 * duv2.y - e2 * duv1.y) / det : (abs(n.z) < 0.999 ? cross(vec3(0.0, 0.0, 1.0), n) : vec3(1.0, 0.0, 0.0));
        tI.w = 1.0;
    }
    t = t - n * dot(n, t);
    t = dot(t, t) > 1e-12 ? normalize(t) : normalize(abs(n.z) < 0.999 ? cross(vec3(0.0, 0.0, 1.0), n) : vec3(1.0, 0.0, 0.0));
    float handed = tI.w < 0.0 ? -1.0 : 1.0;
    vec3 b = cross(n, t) * handed;

    // Ray-cone LOD bias (texture-size term added per fetch).
    vec2 duvA = vb.Texcoord.xy - va.Texcoord.xy, duvB = vc.Texcoord.xy - va.Texcoord.xy;
    float uvArea = 0.5 * abs(duvA.x * duvB.y - duvB.x * duvA.y);
    F.LodBias = (uvArea > 0.0 && worldArea > 0.0) ? 0.5 * log2(uvArea / worldArea) + log2(max(coneWidth, 1e-6) / max(abs(dot(ng, viewDir)), 1e-3)) : 0.0;

    ShadingRecord m;
    m.BaseColor = mat.Albedo.xyz; m.Metalness = mat.Emissive.w; m.DiffuseRoughness = 0.0;
    m.SpecularWeight = 1.0; m.SpecularColor = vec3(1.0); m.SpecularRoughness = mat.Albedo.w; m.SpecularAnisotropy = 0.0; m.SpecularIor = 1.5;
    m.ThinFilmWeight = 0.0; m.ThinFilmThickness = 0.5; m.ThinFilmIor = 1.4;
    m.HazinessWeight = 0.0; m.HazinessRoughness = 0.5;
    m.CoatWeight = 0.0; m.CoatColor = vec3(1.0); m.CoatRoughness = 0.0; m.CoatIor = 1.6; m.CoatDarkening = 1.0;
    m.FuzzWeight = 0.0; m.FuzzColor = vec3(1.0); m.FuzzRoughness = 0.5;
    m.Emission = mat.Emissive.xyz;
    F.Emission = mat.Emissive.xyz; F.Opacity = 1.0; F.Occlusion = 1.0;

    if (mat.Slabs.y > 0u)
    {
        GpuMaterialSlab S = MaterialSlabs[mat.Slabs.x];   // Tier A: the bottom slab only (multi-slab stacks arrive with R5)
        vec4 P0 = S.Payload[0], P1 = S.Payload[1], P2 = S.Payload[2], P3 = S.Payload[3];
        vec4 P8 = S.Payload[8], P9 = S.Payload[9], P10 = S.Payload[10], P11 = S.Payload[11], P12 = S.Payload[12], P13 = S.Payload[13];
        float normalScale = uintBitsToFloat(S.Runtime.y), occlusionStrength = uintBitsToFloat(S.Runtime.z);

        vec4 baseTex = SampleChannel(S, kChannelBaseColor, uv, F.LodBias, vec4(1.0));
        m.BaseColor          = P0.x * P0.yzw * baseTex.xyz;
        m.Metalness          = P1.x * SampleChannel(S, kChannelMetalness, uv, F.LodBias, vec4(1.0)).z;   // glTF: B
        m.DiffuseRoughness   = P1.y;
        m.SpecularWeight     = P1.z;
        m.SpecularColor      = vec3(P1.w, P2.xy) * SampleChannel(S, kChannelSpecularColor, uv, F.LodBias, vec4(1.0)).xyz;
        m.SpecularRoughness  = P2.z * SampleChannel(S, kChannelRoughness, uv, F.LodBias, vec4(1.0)).y;   // glTF: G
        m.SpecularAnisotropy = P2.w;
        m.SpecularIor        = P3.x;
        m.CoatWeight         = P8.y * SampleChannel(S, kChannelCoat, uv, F.LodBias, vec4(1.0)).x;
        m.CoatColor          = vec3(P8.zw, P9.x);
        m.CoatRoughness      = P9.y;
        m.CoatIor            = P9.w;
        m.CoatDarkening      = P10.x;
        m.FuzzWeight         = P10.y;
        m.FuzzColor          = vec3(P10.zw, P11.x) * SampleChannel(S, kChannelFuzz, uv, F.LodBias, vec4(1.0)).xyz;
        m.FuzzRoughness      = P11.y;
        m.Emission           = P11.z * vec3(P11.w, P12.xy) * SampleChannel(S, kChannelEmission, uv, F.LodBias, vec4(1.0)).xyz;
        m.ThinFilmWeight     = P12.z * SampleChannel(S, kChannelThinFilm, uv, F.LodBias, vec4(1.0)).x;
        m.ThinFilmThickness  = P12.w;
        m.ThinFilmIor        = P13.x;
        m.HazinessWeight     = P13.z;
        m.HazinessRoughness  = P13.w;
        F.Emission  = m.Emission;
        F.Opacity   = P13.y * SampleChannel(S, kChannelOpacity, uv, F.LodBias, vec4(1.0)).w;   // glTF: A of base colour
        F.Occlusion = mix(1.0, SampleChannel(S, kChannelOcclusion, uv, F.LodBias, vec4(1.0)).x, occlusionStrength);

        uint normalSlot = SlabTexture(S, kChannelNormal);
        if (normalSlot != 0xFFFFu)
        {
            vec3 tn = SampleChannel(S, kChannelNormal, uv, F.LodBias, vec4(0.5, 0.5, 1.0, 1.0)).xyz * 2.0 - 1.0;
            tn.x *= normalScale; tn.y *= normalScale;
            vec3 nm = normalize(t * tn.x + b * tn.y + n * tn.z);
            if (dot(nm, ng) > 0.0) n = nm;                         // reject maps that push the normal below the surface
            t = normalize(t - n * dot(n, t)); b = cross(n, t) * handed;
        }
    }

    F.Normal = n; F.Tangent = t; F.Bitangent = b; F.Geometric = ng;
    return m;
}

#include "TraversalCWBVH.slang"

const uint kVisibilityInvalid = 0xFFFFFFFFu;
uint VisibilityInstance(uint Packed)  { return (Packed >> 14) & 0x3FFFFu; }
uint VisibilityPrimitive(uint Packed) { return Packed & 0x3FFFu; }

//------------------------------------------------------------------------------------------------------------------------
//                                                    PUSH CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

layout(push_constant) uniform ReSTIRConstants
{
    vec3    CameraOrigin;           // [m]   camera world position
    float   FieldOfViewTanHalf;     // [-]   tan(FoV/2)
    vec3    CameraForward;          // [-]   forward unit vector
    float   AspectRatio;            // [-]   width / height
    vec3    CameraRight;            // [-]   right unit vector
    float   Exposure;               // [-]   ACES exposure
    vec3    CameraUp;               // [-]   up unit vector
    float   AmbientStrength;        // [-]   ambient fallback
    uint    ViewportWidth;          // [px]  render width
    uint    ViewportHeight;         // [px]  render height
    uint    FrameIndex;             // [cnt] temporal accumulation index
    uint    SpatialPassCount;       // [cnt] ReSTIR spatial resampling passes
    uint    SamplesPerPixel;        // [cnt] primary DI candidates per pixel
    uint    AlphaMaskedMaterialCount; // [cnt] R4b: materials flagged kMaterialFlagAlphaMask (0 ⇒ any-hit shadow rays) — was TriangleCount (unused here)
    uint    LightTriangleCount;     // [cnt] emissive triangles for DI sampling
    uint    FeatureFlags;           // [bit] kFeatureGlobalIllumination | kFeatureAntiAliasing
};

const uint kFeatureGlobalIllumination = 1u;   // bit 0: trace the secondary bounce (section 4)
const uint kFeatureAntiAliasing       = 2u;   // bit 1: sub-pixel jitter — applied by the R2 raster/resolve, not here
const uint kFeatureAmbientFloor       = 4u;   // bit 2: add albedo × AmbientStrength (debug fill light; default OFF)

float PixelSpreadAngle() { return 2.0 * FieldOfViewTanHalf / float(ViewportHeight); }   // [rad] R4b ray-cone spread per pixel

//------------------------------------------------------------------------------------------------------------------------
//                                                    PCG RANDOM
//------------------------------------------------------------------------------------------------------------------------

uint PcgHash(uint v)
{
    uint state = v * 747796405u + 2891336453u;
    uint word  = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

float RandFloat(inout uint seed)
{
    seed = PcgHash(seed);
    return float(seed) * (1.0 / 4294967296.0);
}

uint MakeSeed(uvec2 pixel, uint frame)
{
    return PcgHash(pixel.x + pixel.y * 7919u + frame * 1000003u);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    RAY / HIT STRUCTURES
//------------------------------------------------------------------------------------------------------------------------

const uint kMaterialFlagAlphaMask = 2u;      // MaterialRecord.Flags bit (SceneRecords.slang)
const uint kAlphaMaskRetraceLimit = 4u;      // cut-out layers a shadow / bounce ray may pass through before giving up
struct Ray    { vec3 origin; vec3 dir; };
struct Hit    { bool valid; float t; vec3 pos; vec3 normal; uint matIdx; uint primitive; };

const float kEps = 1e-4;
const float kInf = 1e30;

//------------------------------------------------------------------------------------------------------------------------
//                                                    SCENE TRAVERSAL
//------------------------------------------------------------------------------------------------------------------------

// R4b alpha mask: true when the hit on `primitive` is a cut-out texel (kMaterialFlagAlphaMask materials only). Opacity =
//    geometry_opacity × base-colour alpha at LOD 0 through the flat triangle's own UVs — no vertex fetch on this path.
bool AlphaMaskCutOut(uint primitive, vec3 hitPos)
{
    GpuTriangle tri = Triangles[primitive];
    GpuMaterial mat = Materials[floatBitsToUint(tri.v0.w)];
    if ((mat.Slabs.z & kMaterialFlagAlphaMask) == 0u) return false;
    float opacity = 1.0;
    if (mat.Slabs.y > 0u) opacity = MaterialSlabs[mat.Slabs.x].Payload[13].y;   // geometry_opacity
    if (mat.Textures.x != kMaterialTextureNone)
    {
        vec3 bc = Barycentric(hitPos, tri.v0.xyz, tri.v1.xyz, tri.v2.xyz);
        vec2 uv = bc.x * tri.uv.xy + bc.y * tri.uv.zw + bc.z * vec2(tri.v1.w, tri.v2.w);
        opacity *= textureLod(Textures[nonuniformEXT(mat.Textures.x)], uv, 0.0).a;
    }
    return opacity < mat.AlphaCutoff;
}

Hit TraceScene(Ray ray)
{
    // R3: closest hit through the CWBVH; the primitive index addresses the flat Triangles[] for material and normal.
    // R4b: a hit on a cut-out texel of an alpha-masked material is skipped and the ray re-traced from just past it.
    Hit closest;
    closest.valid = false;
    closest.t     = kInf;

    vec3 rD = vec3(1.0) / ray.dir;   // IEEE ±inf on axis-aligned rays is handled by the slab test exactly as in tinybvh
    vec3  origin = ray.origin;
    float tBase  = 0.0;
    uint  passes = AlphaMaskedMaterialCount == 0u ? 0u : kAlphaMaskRetraceLimit;
    for (uint pass = 0u; pass <= passes; ++pass)
    {
        TraversalHit h = TraverseClosest(origin, ray.dir, rD, kInf);
        if (h.primitive == 0xFFFFFFFFu || h.t <= kEps) return closest;
        vec3 pos = origin + h.t * ray.dir;
        if (passes != 0u && AlphaMaskCutOut(h.primitive, pos)) { origin = pos + ray.dir * kEps; tBase += h.t + kEps; continue; }

        GpuTriangle tri = Triangles[h.primitive];
        closest.valid  = true;
        closest.t      = tBase + h.t;
        closest.pos    = pos;
        closest.normal = normalize(cross(tri.v1.xyz - tri.v0.xyz, tri.v2.xyz - tri.v0.xyz));   // R4a: face normal from the edges (slot now carries UVs)
        closest.matIdx = floatBitsToUint(tri.v0.w);
        closest.primitive = h.primitive;
        return closest;
    }
    return closest;
}

bool TraceShadow(vec3 origin, vec3 target)
{
    vec3 dir = target - origin;
    float tMax = length(dir) - 2.0 * kEps;
    dir = normalize(dir);
    vec3 rD = vec3(1.0) / dir;
    if (AlphaMaskedMaterialCount == 0u)
        return TraverseOccluded(origin + dir * kEps, dir, rD, tMax);   // R3 fast path: any-hit, no material fetch (Cornell unchanged)

    // R4b: closest-hit walk that steps through cut-out texels (foliage cards); an opaque hit before the light occludes.
    vec3 o = origin + dir * kEps;
    for (uint pass = 0u; pass <= kAlphaMaskRetraceLimit; ++pass)
    {
        TraversalHit h = TraverseClosest(o, dir, rD, tMax);
        if (h.primitive == 0xFFFFFFFFu) return false;
        vec3 pos = o + h.t * dir;
        if (!AlphaMaskCutOut(h.primitive, pos)) return true;
        o = pos + dir * kEps; tMax -= h.t + kEps;
        if (tMax <= 0.0) return false;
    }
    return true;   // more cut-out layers than the limit: treat as occluded (conservative, never leaks light)
}

//------------------------------------------------------------------------------------------------------------------------
//                                          COSINE-WEIGHTED HEMISPHERE SAMPLING
//------------------------------------------------------------------------------------------------------------------------

vec3 SampleCosineHemisphere(vec3 normal, float u1, float u2)
{
    float r     = sqrt(u1);
    float theta = 6.28318530718 * u2;
    float x     = r * cos(theta);
    float y     = r * sin(theta);
    float z     = sqrt(max(0.0, 1.0 - u1));

    vec3 up      = abs(normal.y) < 0.999 ? vec3(0,1,0) : vec3(1,0,0);
    vec3 tangent = normalize(cross(up, normal));
    vec3 bitan   = cross(normal, tangent);

    return normalize(tangent * x + bitan * y + normal * z);
}

//------------------------------------------------------------------------------------------------------------------------
//                             LIGHT TRIANGLE AREA SAMPLING (uniform area pick)
//------------------------------------------------------------------------------------------------------------------------

// Light triangles come from the luminaire table (R2); the pick stays UNIFORM over luminaires so the Cornell image is
//    bit-for-bit the R0 estimator. The table also carries a Walker alias entry + area-power pdf — R5 switches to it.
uint LightTriangle(uint lightIdx) { return Luminaires[lightIdx].TriangleSlot; }

vec3 SampleLightPoint(uint lightTriIdx, float u1, float u2)
{
    uint idx = LightTriangle(lightTriIdx);
    vec3 v0 = Triangles[idx].v0.xyz;
    vec3 v1 = Triangles[idx].v1.xyz;
    vec3 v2 = Triangles[idx].v2.xyz;
    float r1 = sqrt(u1);
    return (1.0 - r1) * v0 + r1 * (1.0 - u2) * v1 + r1 * u2 * v2;
}

//------------------------------------------------------------------------------------------------------------------------
//                                  RIS DIRECT LIGHTING — WEIGHTED RESERVOIR SAMPLING (initial candidates)
//------------------------------------------------------------------------------------------------------------------------

struct Reservoir
{
    vec3  SelectedPoint;    // chosen light sample position
    float WeightSum;        // running sum of candidate weights
    uint  SampleCount;      // M: number of considered candidates
    float UnbiasedWeight;   // W: final unbiased contribution weight
};

void ResampleCandidate(inout Reservoir res, vec3 point, float weight, inout uint seed)
{
    res.WeightSum    += weight;
    res.SampleCount  += 1u;
    if (RandFloat(seed) * res.WeightSum <= weight)
        res.SelectedPoint = point;
}

//------------------------------------------------------------------------------------------------------------------------
//                                              ACES FILMIC TONE MAPPING
//------------------------------------------------------------------------------------------------------------------------

float AcesFilm(float x)
{
    float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 ToneMap(vec3 hdr)
{
    hdr *= Exposure;
    float r = AcesFilm(hdr.r);
    float g = AcesFilm(hdr.g);
    float b = AcesFilm(hdr.b);
    // gamma 2.2
    return pow(vec3(r, g, b), vec3(1.0 / 2.2));
}

//------------------------------------------------------------------------------------------------------------------------
//                                              TEMPORAL ACCUMULATION RESOLVE
//------------------------------------------------------------------------------------------------------------------------
// Running mean in linear radiance. AccumulationIndex == 0 restarts the history (camera moved / parameter changed);
//    every later frame folds the new estimate in with weight 1/(n+1). Tone mapping is applied to the mean only.

void Resolve(uvec2 pixel, vec3 radiance)
{
    vec4 history = (FrameIndex == 0u) ? vec4(0.0) : imageLoad(HistoryImage, ivec2(pixel));
    float count  = history.a + 1.0;
    vec3  mean   = history.rgb + (radiance - history.rgb) / count;

    imageStore(HistoryImage, ivec2(pixel), vec4(mean, count));
    imageStore(OutputImage,  ivec2(pixel), vec4(ToneMap(mean), 1.0));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    MAIN COMPUTE KERNEL
//------------------------------------------------------------------------------------------------------------------------

void main()
{
    uvec2 pixel = gl_GlobalInvocationID.xy;
    if (pixel.x >= ViewportWidth || pixel.y >= ViewportHeight) return;

    uint seed = MakeSeed(pixel, FrameIndex);

    //------------------------------------------------------------------------------------------------------------------
    // 1 + 2. Primary visibility — read from the R2 visibility raster instead of tracing. SurfaceResolve intersected the
    //    pixel's camera ray (with the frame's raster jitter) with the rasterised triangle, so hitPos / hitNormal are
    //    what TraceScene used to return, already flipped to face the camera. ⚠️ Deviation from R0: anti-aliasing jitter
    //    is now one Halton offset per FRAME (shared by raster and resolve) instead of one PCG offset per pixel; the
    //    accumulated result converges to the same box-filtered image, only the per-frame noise pattern differs.
    //------------------------------------------------------------------------------------------------------------------
    vec4 surface    = imageLoad(SurfaceImage, ivec2(pixel));
    uint visibility = floatBitsToUint(surface.w);

    if (visibility == kVisibilityInvalid)
    {
        // Background: pure black. There is no sky and no environment light; anything the raster did not cover must
        // read as a miss, never as a colour.
        Resolve(pixel, vec3(0.0));
        return;
    }

    GpuInstance primaryInstance = Instances[VisibilityInstance(visibility)];
    GpuMaterial mat = Materials[primaryInstance.MaterialIndex];

    vec3  hitPos     = surface.xyz;
    vec3  toCamera   = CameraOrigin - hitPos;
    float primaryT   = length(toCamera);
    vec3  viewDir    = toCamera / max(primaryT, 1e-6);
    float coneWidth  = primaryT * PixelSpreadAngle();             // ray-cone footprint at the primary hit [m]

    SurfaceFrame  frame;
    ShadingRecord shading = ResolveMaterial(mat, primaryInstance, VisibilityPrimitive(visibility), hitPos, viewDir, coneWidth, frame);

    // If we directly hit an emitter — return its radiance (slab emission × texture; the header's radiance drives the luminaire table)
    if (dot(frame.Emission, frame.Emission) > 0.0)
    {
        Resolve(pixel, frame.Emission);
        return;
    }

    vec3 hitNormal = frame.Geometric;                             // shadow-ray offsets and the DI target function stay geometric
    vec3 woLocal   = ToLocal(frame, viewDir);
    if (woLocal.z <= 0.0) woLocal = vec3(woLocal.xy, 1e-3);      // grazing normal-mapped case: keep the BSDF defined
    ResolvedLayers layers = ResolveLayers(shading, woLocal);
    vec3 albedo    = shading.BaseColor;                           // debug ambient floor only

    vec3 accumulatedRadiance = vec3(0.0);

    //------------------------------------------------------------------------------------------------------------------
    // 3. RIS direct lighting — per-pixel initial candidates (+ extra candidates); no temporal/spatial reuse yet
    //------------------------------------------------------------------------------------------------------------------

    if (LightTriangleCount > 0u)
    {
        // Initial reservoir from M = SamplesPerPixel candidates
        Reservoir res;
        res.SelectedPoint  = vec3(0.0);
        res.WeightSum      = 0.0;
        res.SampleCount    = 0u;
        res.UnbiasedWeight = 0.0;

        for (uint s = 0u; s < SamplesPerPixel; ++s)
        {
            uint   li          = uint(RandFloat(seed) * float(LightTriangleCount));
            vec3   lp          = SampleLightPoint(li, RandFloat(seed), RandFloat(seed));
            vec3   toLight     = lp - hitPos;
            float  dist        = length(toLight);
            vec3   lDir        = toLight / dist;
            float  cosTheta    = max(0.0, dot(hitNormal, lDir));

            // Get light material
            uint lMatIdx = floatBitsToUint(
                Triangles[LightTriangle(li)].v0.w);
            vec3 lEmissive = Materials[lMatIdx].Emissive.xyz;

            // Target function: unshadowed direct contribution
            float pHat = cosTheta * length(lEmissive) / (dist * dist + 0.001);
            float w    = pHat / (1.0 / float(LightTriangleCount));

            ResampleCandidate(res, lp, w, seed);
        }

        // Compute unbiased weight W
        if (res.WeightSum > 0.0 && res.SampleCount > 0u)
        {
            vec3  toSel    = res.SelectedPoint - hitPos;
            float selDist  = length(toSel);
            vec3  selDir   = toSel / selDist;
            float cosTheta = max(0.0, dot(hitNormal, selDir));

            // Find emissive of selected light triangle (nearest emissive)
            // We stored selected point — lookup which light triangle it came from via brute-force closest match
            vec3 selEmissive = vec3(0.0);
            float bestD = kInf;
            for (uint li = 0u; li < LightTriangleCount; ++li)
            {
                uint idx = LightTriangle(li);
                vec3 triCenter = (Triangles[idx].v0.xyz + Triangles[idx].v1.xyz + Triangles[idx].v2.xyz) / 3.0;
                float d = distance(triCenter, res.SelectedPoint);
                if (d < bestD) { bestD = d; selEmissive = Materials[floatBitsToUint(Triangles[idx].v0.w)].Emissive.xyz; }
            }

            float pHatSel = cosTheta * length(selEmissive) / (selDist * selDist + 0.001);
            if (pHatSel > 0.0)
                res.UnbiasedWeight = res.WeightSum / (float(res.SampleCount) * pHatSel);

            // Extra candidates (formerly mislabelled "spatial resampling"): SpatialPassCount further light samples
            //    from THIS pixel, resampled with the same target function so the reservoir stays a valid RIS estimate.
            //    True spatial reuse (neighbour reservoirs + validation) arrives with R5.
            for (uint sp = 0u; sp < SpatialPassCount; ++sp)
            {
                uint   nli    = uint(RandFloat(seed) * float(LightTriangleCount));
                vec3   nlp    = SampleLightPoint(nli, RandFloat(seed), RandFloat(seed));
                vec3   nToL   = nlp - hitPos;
                float  nDist  = length(nToL);
                float  nCos   = max(0.0, dot(hitNormal, nToL / nDist));
                uint   nMIdx  = floatBitsToUint(Triangles[LightTriangle(nli)].v0.w);
                vec3   nEmit  = Materials[nMIdx].Emissive.xyz;
                float  nPHat  = nCos * length(nEmit) / (nDist * nDist + 0.001);
                float  nW     = nPHat / (1.0 / float(LightTriangleCount));   // p̂ / p_source, same as the initial loop
                ResampleCandidate(res, nlp, nW, seed);
            }
            // Recompute W for the final selection (the selected point may have changed).
            {
                vec3  toSel2   = res.SelectedPoint - hitPos;
                float selDist2 = length(toSel2);
                float cos2     = max(0.0, dot(hitNormal, toSel2 / selDist2));
                vec3  emit2    = vec3(0.0);
                float bd       = kInf;
                for (uint li = 0u; li < LightTriangleCount; ++li)
                {
                    uint idx = LightTriangle(li);
                    vec3 c = (Triangles[idx].v0.xyz + Triangles[idx].v1.xyz + Triangles[idx].v2.xyz) / 3.0;
                    float d = distance(c, res.SelectedPoint);
                    if (d < bd) { bd = d; emit2 = Materials[floatBitsToUint(Triangles[idx].v0.w)].Emissive.xyz; }
                }
                float pHat2 = cos2 * length(emit2) / (selDist2 * selDist2 + 0.001);
                res.UnbiasedWeight = pHat2 > 0.0 ? res.WeightSum / (float(res.SampleCount) * pHat2) : 0.0;
            }

            // Evaluate visibility and shade
            if (!TraceShadow(hitPos + hitNormal * kEps, res.SelectedPoint))
            {
                vec3 shadeDir = normalize(res.SelectedPoint - hitPos);
                float shadeCos = max(0.0, dot(hitNormal, shadeDir));

                // Re-fetch emissive of chosen point
                vec3 chosenEmit = vec3(0.0);
                float bd2 = kInf;
                for (uint li = 0u; li < LightTriangleCount; ++li)
                {
                    uint idx = LightTriangle(li);
                    vec3 c = (Triangles[idx].v0.xyz + Triangles[idx].v1.xyz + Triangles[idx].v2.xyz) / 3.0;
                    float d = distance(c, res.SelectedPoint);
                    if (d < bd2) { bd2 = d; chosenEmit = Materials[floatBitsToUint(Triangles[idx].v0.w)].Emissive.xyz; }
                }

                float dist2 = dot(res.SelectedPoint - hitPos, res.SelectedPoint - hitPos);
                vec3  wiLocal = ToLocal(frame, shadeDir);
                vec3  f = wiLocal.z > 0.0 ? EvaluateBsdf(shading, layers, woLocal, wiLocal) : vec3(0.0);   // R4b: full lobe stack
                accumulatedRadiance += f * chosenEmit * shadeCos * res.UnbiasedWeight / (dist2 + 0.01);
            }
        }
    }

    //------------------------------------------------------------------------------------------------------------------
    // 4. One-bounce indirect (plain path tracing with NEE, no GI reservoir); skipped when the GI feature is off
    //------------------------------------------------------------------------------------------------------------------
    if ((FeatureFlags & kFeatureGlobalIllumination) != 0u)
    {
        // R4b: BSDF-sampled bounce (EON CLTC / VNDF / LTC per lobe). ⚠️ For Cornell (specular_weight 0, r_d 0) the CLTC
        //    sample IS a cosine sample, but one extra random number is drawn for the lobe pick — the converged image is
        //    unchanged, the per-frame noise pattern is not.
        vec4 bounce = SampleBsdf(shading, layers, woLocal, vec3(RandFloat(seed), RandFloat(seed), RandFloat(seed)));
        if (bounce.w > 0.0)
        {
            vec3 bounceDir = FromLocal(frame, bounce.xyz);
            vec3 throughput = EvaluateBsdf(shading, layers, woLocal, bounce.xyz) * bounce.z / bounce.w;   // f · cosθ / pdf
            Ray  bounceRay;
            bounceRay.origin = hitPos + hitNormal * kEps;
            bounceRay.dir    = bounceDir;

            Hit bounceHit = TraceScene(bounceRay);
            if (bounceHit.valid && dot(bounceDir, hitNormal) > 0.0)
            {
                GpuMaterial   bMat  = Materials[bounceHit.matIdx];
                uint          bInst = 0u;   // the flat primitive index already addresses Triangles[]; find its instance for the vertex range
                // Triangles[] is laid out per instance in FlatTriangleOffset order; binary search would need a count — linear over
                //    instances is bounded (Sponza: 105) and only runs once per bounce.
                for (uint i = 0u; i + 1u < uint(Instances.length()); ++i) if (Instances[i + 1u].FlatTriangleOffset <= bounceHit.primitive) bInst = i + 1u; else break;
                GpuInstance   bInstance = Instances[bInst];
                SurfaceFrame  bFrame;
                float         bCone = coneWidth + bounceHit.t * PixelSpreadAngle();
                ShadingRecord bShading = ResolveMaterial(bMat, bInstance, bounceHit.primitive - bInstance.FlatTriangleOffset, bounceHit.pos, -bounceDir, bCone, bFrame);

                if (dot(bFrame.Emission, bFrame.Emission) > 0.0)
                {
                    accumulatedRadiance += throughput * bFrame.Emission;
                }
                else if (LightTriangleCount > 0u)
                {
                    vec3  bHitPos    = bounceHit.pos;
                    vec3  bHitNormal = bFrame.Geometric;
                    vec3  bWo        = ToLocal(bFrame, -bounceDir);
                    if (bWo.z <= 0.0) bWo = vec3(bWo.xy, 1e-3);
                    ResolvedLayers bLayers = ResolveLayers(bShading, bWo);

                    uint  bLi  = uint(RandFloat(seed) * float(LightTriangleCount));
                    vec3  bLp  = SampleLightPoint(bLi, RandFloat(seed), RandFloat(seed));
                    vec3  bToL = bLp - bHitPos;
                    float bDist = length(bToL);
                    vec3  bLDir = bToL / bDist;
                    float bCos  = max(0.0, dot(bHitNormal, bLDir));
                    vec3  bWi   = ToLocal(bFrame, bLDir);

                    uint  bLMatIdx = floatBitsToUint(Triangles[LightTriangle(bLi)].v0.w);
                    vec3 bLEmit = Materials[bLMatIdx].Emissive.xyz;

                    if (bCos > 0.0 && bWi.z > 0.0 && !TraceShadow(bHitPos + bHitNormal * kEps, bLp))
                    {
                        float bDist2 = bDist * bDist;
                        vec3  bF = EvaluateBsdf(bShading, bLayers, bWo, bWi);
                        accumulatedRadiance += throughput * bF * bLEmit * bCos / ((bDist2 + 0.01) * float(LightTriangleCount));
                    }
                }
            }
        }
    }

    //------------------------------------------------------------------------------------------------------------------
    // 5. Ambient floor (debug only — flag kFeatureAmbientFloor; a real GI pass makes it unnecessary) + tone map + write
    //------------------------------------------------------------------------------------------------------------------
    if ((FeatureFlags & kFeatureAmbientFloor) != 0u)
        accumulatedRadiance += albedo * frame.Occlusion * AmbientStrength;

    Resolve(pixel, accumulatedRadiance);
}
