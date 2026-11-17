//============================================================================================================================================
//                                                         LENSINGRASTERIZATION.SLANG
//============================================================================================================================================
// 🧩 Screen-space gravitational lensing and heat shimmer: one triangle over the target that resamples the rastered image.

#pragma once
#include "IntrinsicParity.slang"

// 📝 A port of the LENS block of eos shaders.js. Inside the event radius the image is black; outside it the background is bent
//    outward by a weak-field mapping (source radius r − E²/r, fading with distance) and a bright photon ring sits near 1.3 event
//    radii. An approximation, not a ray-traced metric. Packed by ParticleUniformPacking.cpp (PackParticleLensing).

struct LensingConstants
{
    float4 Hole0;        // xy centre [uv], z Einstein radius, w event radius (screen-height units)
    float4 Hole1;
    float4 Miscellany;   // x black holes, y aspect, z ring brightness, w shimmers
    float4 Shimmer0;     // xy centre [uv], z radius (screen-height units), w strength [uv]
    float4 Shimmer1;     // x time · rate, y noise frequency
    float4 Shimmer2;
    float4 Shimmer3;
    float4 Padding;
};

  [[vk::binding(0, 0)]] ConstantBuffer<LensingConstants> Lensing;
  [[vk::binding(1, 0)]] Texture2D<float4>                Captured;
  [[vk::binding(2, 0)]] SamplerState                     CapturedSampler;

float HashScreen(float2 Point)
{
    return frac(sin(dot(Point, float2(127.1, 311.7))) * 43758.5453);
}

float ResolveScreenNoise(float2 Point)
{
    let Cell = floor(Point);
    let Within = frac(Point);
    let U = Within * Within * (3.0 - 2.0 * Within);
    return lerp(lerp(HashScreen(Cell), HashScreen(Cell + float2(1.0, 0.0)), U.x), lerp(HashScreen(Cell + float2(0.0, 1.0)),
                HashScreen(Cell + float2(1.0, 1.0)), U.x), U.y);
}

// 📝 Heat shimmer: a noise offset of the sampled coordinate that rises with time and fades toward the edge of its radius.
float2 ResolveShimmerOffset(float2 Coordinate, float4 Placement, float4 Motion)
{
    let Offset = (Coordinate - Placement.xy) * float2(Lensing.Miscellany.y, 1.0);
    let Reach = length(Offset) / max(Placement.z, 1e-5);
    let Fall = 1.0 - smoothstep(0.6, 1.0, Reach);
    let Point = float2(Coordinate.x * Motion.y, Coordinate.y * Motion.y - Motion.x * 1.5);
    let Noise = float2(ResolveScreenNoise(Point), ResolveScreenNoise(Point + float2(5.2, 1.3))) - float2(0.5);
    return Noise * Placement.w * Fall;
}

static const float2 LensingCorners[3] = { float2(-1.0, -1.0), float2(3.0, -1.0), float2(-1.0, 3.0) };

[shader("vertex")]
float4 LensingVertex(uint VertexIndex : SV_VulkanVertexID) : SV_Position
{
    return float4(LensingCorners[VertexIndex], 0.0, 1.0);
}

[shader("fragment")]
float4 LensingFragment(float4 FragmentCoordinate : SV_Position) : SV_Target0
{
    let Extent = float2(TextureExtent(Captured));
    let Coordinate = FragmentCoordinate.xy / Extent;
    let Aspect = Lensing.Miscellany.y;
    let Holes = ToUnsigned(Lensing.Miscellany.x);
    var Source = Coordinate;
    var Nearest = 1e9;
    var Inside = 0.0;
    var Ring = 0.0;
    for (var Index = 0u; Index < 2u; Index++)
    {
        if (Index >= Holes) { break; }
        let Hole = SelectBranch(Lensing.Hole1, Lensing.Hole0, Index == 0u);
        let Centre = Hole.xy;
        let Einstein = Hole.z;
        let Event = Hole.w;
        let Offset = (Coordinate - Centre) * float2(Aspect, 1.0);
        let Radius = length(Offset);
        if (Radius < Nearest)
        {
            Nearest = Radius;
            let Heading = Offset / max(Radius, 1e-5);
            // 📝 Inside the Einstein radius the signed source radius turns negative: the image comes from the far side.
            let SourceRadius = Radius - Einstein * Einstein / max(Radius, 1e-5);
            let Taper = 1.0 - smoothstep(0.35, 0.6, Radius);
            let Bent = lerp(Radius, SourceRadius, Taper);
            Source = Centre + Heading * Bent / float2(Aspect, 1.0);
        }
        Inside = max(Inside, 1.0 - smoothstep(Event * 0.9, Event, Radius));
        let q = (Radius - 1.3 * Event) / (0.12 * Event);
        Ring += exp(-q * q);
    }
    var Shimmer = float2(0.0);
    if (Lensing.Miscellany.w > 0.5) { Shimmer += ResolveShimmerOffset(Coordinate, Lensing.Shimmer0, Lensing.Shimmer1); }
    if (Lensing.Miscellany.w > 1.5) { Shimmer += ResolveShimmerOffset(Coordinate, Lensing.Shimmer2, Lensing.Shimmer3); }
    Source += Shimmer;
    let Pixel = Captured.SampleLevel(CapturedSampler, Source, 0.0);
    let Glow = float3(1.0, 0.72, 0.4) * Ring * Lensing.Miscellany.z;
    if (Lensing.Padding.w > 0.5)
    {
        // 📝 The raster target is premultiplied; the interface image path consumes straight-alpha texels.
        let Visibility = 1.0 - Inside;
        let Premultiplied = (Pixel.rgb + Glow) * Visibility;
        let Radiance = max(Pixel.a, max(max(Pixel.rgb.r, Pixel.rgb.g), Pixel.rgb.b));
        let GlowAlpha = max(Glow.r, max(Glow.g, Glow.b));
        let Alpha = clamp(max(Radiance, GlowAlpha) * Visibility, 0.0, 1.0);
        return float4(Premultiplied / max(Alpha, 1e-5), Alpha);
    }
    return float4(Pixel.rgb * (1.0 - Inside) + Glow * (1.0 - Inside), 1.0);
}
