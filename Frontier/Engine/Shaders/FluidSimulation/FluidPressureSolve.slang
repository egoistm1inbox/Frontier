//============================================================================================================================================
//                                                        FLUIDPRESSURESOLVE.SLANG
//============================================================================================================================================
// 🧩 One Jacobi iteration for the GPU pressure Poisson solve.

#pragma once
#include "FluidLayouts.slang"

[[vk::binding(0, 0)]] ConstantBuffer<FluidConstants> Fluid;
[[vk::binding(1, 0)]] Texture3D<float> PressureIn;
[[vk::binding(2, 0)]] Texture3D<float> PressureDivergence;
[[vk::binding(3, 0)]] [[vk::image_format("r32f")]] RWTexture3D<float> PressureOut;

[shader("compute")]
[numthreads(4, 4, 4)]
void SolveFluidPressure(uint3 Cell : SV_DispatchThreadID)
{
    let Dimensions = ResolveGridDimensions(Fluid);
    if (!IsInside(Cell, Dimensions)) { return; }
    let At = int3(Cell);
    let InverseCell = 1.0 / max(Fluid.Cell.xyz, float3(1e-6));
    let Coefficients = InverseCell * InverseCell;
    let Left = PressureIn.Load(int4(ClampCell(At + int3(-1, 0, 0), Dimensions), 0));
    let Right = PressureIn.Load(int4(ClampCell(At + int3(1, 0, 0), Dimensions), 0));
    let Down = PressureIn.Load(int4(ClampCell(At + int3(0, -1, 0), Dimensions), 0));
    let Up = PressureIn.Load(int4(ClampCell(At + int3(0, 1, 0), Dimensions), 0));
    let Back = PressureIn.Load(int4(ClampCell(At + int3(0, 0, -1), Dimensions), 0));
    let Front = PressureIn.Load(int4(ClampCell(At + int3(0, 0, 1), Dimensions), 0));
    let WeightedNeighbours = (Left + Right) * Coefficients.x + (Down + Up) * Coefficients.y + (Back + Front) * Coefficients.z;
    let Denominator = 2.0 * (Coefficients.x + Coefficients.y + Coefficients.z);
    let Divergence = PressureDivergence.Load(int4(At, 0));
    PressureOut[At] = (WeightedNeighbours - Divergence / max(Fluid.Timing.x, 1e-6)) / max(Denominator, 1e-6);
}
