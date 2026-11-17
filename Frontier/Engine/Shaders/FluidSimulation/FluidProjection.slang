//============================================================================================================================================
//                                                          FLUIDPROJECTION.SLANG
//============================================================================================================================================
// 🧩 Pressure-gradient subtraction and final thermal pressure snapshot.

#pragma once
#include "FluidLayouts.slang"

[[vk::binding(0, 0)]] ConstantBuffer<FluidConstants> Fluid;
[[vk::binding(1, 0)]] Texture3D<float4> StateIn;
[[vk::binding(2, 0)]] Texture3D<float4> ThermalIn;
[[vk::binding(3, 0)]] Texture3D<float> PressureIn;
[[vk::binding(4, 0)]] [[vk::image_format("rgba32f")]] RWTexture3D<float4> StateOut;
[[vk::binding(5, 0)]] [[vk::image_format("rgba32f")]] RWTexture3D<float4> ThermalOut;

[shader("compute")]
[numthreads(4, 4, 4)]
void ProjectFluidPressure(uint3 Cell : SV_DispatchThreadID)
{
    let Dimensions = ResolveGridDimensions(Fluid);
    if (!IsInside(Cell, Dimensions)) { return; }
    let At = int3(Cell);
    let Left = PressureIn.Load(int4(ClampCell(At + int3(-1, 0, 0), Dimensions), 0));
    let Right = PressureIn.Load(int4(ClampCell(At + int3(1, 0, 0), Dimensions), 0));
    let Down = PressureIn.Load(int4(ClampCell(At + int3(0, -1, 0), Dimensions), 0));
    let Up = PressureIn.Load(int4(ClampCell(At + int3(0, 1, 0), Dimensions), 0));
    let Back = PressureIn.Load(int4(ClampCell(At + int3(0, 0, -1), Dimensions), 0));
    let Front = PressureIn.Load(int4(ClampCell(At + int3(0, 0, 1), Dimensions), 0));
    let PressureGradientLocal = float3(0.5 * (Right - Left) / max(Fluid.Cell.x, 1e-6),
                                       0.5 * (Up - Down) / max(Fluid.Cell.y, 1e-6),
                                       0.5 * (Front - Back) / max(Fluid.Cell.z, 1e-6));
    var State = StateIn.Load(int4(At, 0));
    var Thermal = ThermalIn.Load(int4(At, 0));
    State.xyz -= RotateVector(PressureGradientLocal, Fluid.Rotation) * Fluid.Timing.x;
    Thermal.z = PressureIn.Load(int4(At, 0));
    StateOut[At] = State;
    ThermalOut[At] = Thermal;
}
