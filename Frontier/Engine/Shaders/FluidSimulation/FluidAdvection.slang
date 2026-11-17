//============================================================================================================================================
//                                                          FLUIDADVECTION.SLANG
//============================================================================================================================================
// 🧩 Semi-Lagrangian backtracing of velocity, smoke, vapor, and temperature.

#pragma once
#include "FluidLayouts.slang"

[[vk::binding(0, 0)]] ConstantBuffer<FluidConstants> Fluid;
[[vk::binding(1, 0)]] Texture3D<float4> StateIn;
[[vk::binding(2, 0)]] Texture3D<float4> ThermalIn;
[[vk::binding(3, 0)]] SamplerState LinearSampler;
[[vk::binding(4, 0)]] [[vk::image_format("rgba32f")]] RWTexture3D<float4> StateOut;
[[vk::binding(5, 0)]] [[vk::image_format("rgba32f")]] RWTexture3D<float4> ThermalOut;

[shader("compute")]
[numthreads(4, 4, 4)]
void AdvectFluid(uint3 Cell : SV_DispatchThreadID)
{
    let Dimensions = ResolveGridDimensions(Fluid);
    if (!IsInside(Cell, Dimensions)) { return; }
    let Velocity = StateIn.Load(int4(Cell, 0)).xyz;
    let InverseRotation = float4(-Fluid.Rotation.xyz, Fluid.Rotation.w);
    let LocalDisplacement = RotateVector(Velocity * Fluid.Timing.x, InverseRotation);
    let Backtraced = float3(Cell) + 0.5 - LocalDisplacement / max(Fluid.Cell.xyz, float3(1e-6));
    let Coordinates = clamp(Backtraced / float3(Dimensions), 0.5 / float3(Dimensions),
                            (float3(Dimensions) - 0.5) / float3(Dimensions));
    var State = StateIn.SampleLevel(LinearSampler, Coordinates, 0.0);
    var Thermal = ThermalIn.SampleLevel(LinearSampler, Coordinates, 0.0);
    State.w = max(0.0, State.w);
    Thermal.x = max(0.0, Thermal.x);
    Thermal.y = max(0.01, Thermal.y);
    StateOut[int3(Cell)] = State;
    ThermalOut[int3(Cell)] = Thermal;
}
