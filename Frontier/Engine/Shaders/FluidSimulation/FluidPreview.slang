//============================================================================================================================================
//                                                            FLUIDPREVIEW.SLANG
//============================================================================================================================================
// 🧩 Front-to-back volume ray march of the GPU Fluid state into an RGBA8 preview image.

#pragma once
#include "FluidLayouts.slang"

[[vk::binding(0, 0)]] ConstantBuffer<FluidConstants> Fluid;
[[vk::binding(1, 0)]] Texture3D<float4> StateIn;
[[vk::binding(2, 0)]] Texture3D<float4> ThermalIn;
[[vk::binding(3, 0)]] SamplerState LinearSampler;
[[vk::binding(4, 0)]] [[vk::image_format("rgba8")]] RWTexture2D<float4> PreviewOut;

[shader("compute")]
[numthreads(8, 8, 1)]
void RenderFluidPreview(uint3 Thread : SV_DispatchThreadID)
{
    let Width = uint(Fluid.Preview.x + 0.5);
    let Height = uint(Fluid.Preview.y + 0.5);
    if (Thread.x >= Width || Thread.y >= Height) { return; }

    let Dimensions = ResolveGridDimensions(Fluid);
    let Uv = (float2(Thread.xy) + 0.5) / float2(Width, Height);
    let Steps = max(1u, Dimensions.z);
    var Accumulated = float3(0.0, 0.0, 0.0);
    var Alpha = 0.0;
    for (var Step = 0u; Step < Steps; Step++)
    {
        let W = (float(Step) + 0.5) / float(Steps);
        let Coordinates = float3(Uv.x, 1.0 - Uv.y, W);
        let State = StateIn.SampleLevel(LinearSampler, Coordinates, 0.0);
        let Thermal = ThermalIn.SampleLevel(LinearSampler, Coordinates, 0.0);
        let Heat = saturate((Thermal.y - Fluid.Timing.y) / 240.0);
        let Smoke = max(0.0, State.w);
        let Vapor = max(0.0, Thermal.x);
        let Density = Smoke + Vapor * 0.75;
        let CellDistance = min(Fluid.Cell.x, min(Fluid.Cell.y, Fluid.Cell.z));
        let SampleAlpha = saturate(1.0 - exp(-Density * max(CellDistance, 1e-4) * 2.0));
        let SmokeColour = lerp(float3(0.19, 0.23, 0.28), float3(0.68, 0.73, 0.78), saturate(Vapor));
        let HotColour = float3(1.0, 0.28 + 0.42 * (1.0 - Heat), 0.035);
        let Colour = lerp(SmokeColour, HotColour, Heat);
        Accumulated += (1.0 - Alpha) * Colour * SampleAlpha;
        Alpha += (1.0 - Alpha) * SampleAlpha;
    }
    let Speed = length(StateIn.SampleLevel(LinearSampler, float3(Uv.x, 1.0 - Uv.y, 0.5), 0.0).xyz);
    let Glow = saturate(Speed * 0.015) * 0.1;
    Accumulated = min(float3(1.0), Accumulated + Glow * float3(0.35, 0.63, 0.96));
    PreviewOut[int2(Thread.xy)] = float4(Accumulated, Alpha);
}
