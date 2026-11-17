//============================================================================================================================================
//                                                           FLUIDDIVERGENCE.SLANG
//============================================================================================================================================
// 🧩 Divergence of world-space velocity, expressed in the rotated Fluid lattice basis.

#pragma once
#include "FluidLayouts.slang"

[[vk::binding(0, 0)]] ConstantBuffer<FluidConstants> Fluid;
[[vk::binding(1, 0)]] Texture3D<float4> StateIn;
[[vk::binding(2, 0)]] [[vk::image_format("r32f")]] RWTexture3D<float> DivergenceOut;

[shader("compute")]
[numthreads(4, 4, 4)]
void ComputeFluidDivergence(uint3 Cell : SV_DispatchThreadID)
{
    let Dimensions = ResolveGridDimensions(Fluid);
    if (!IsInside(Cell, Dimensions)) { return; }
    let At = int3(Cell);
    let InverseRotation = float4(-Fluid.Rotation.xyz, Fluid.Rotation.w);
    let Right = RotateVector(StateIn.Load(int4(ClampCell(At + int3(1, 0, 0), Dimensions), 0)).xyz, InverseRotation);
    let Left = RotateVector(StateIn.Load(int4(ClampCell(At + int3(-1, 0, 0), Dimensions), 0)).xyz, InverseRotation);
    let Up = RotateVector(StateIn.Load(int4(ClampCell(At + int3(0, 1, 0), Dimensions), 0)).xyz, InverseRotation);
    let Down = RotateVector(StateIn.Load(int4(ClampCell(At + int3(0, -1, 0), Dimensions), 0)).xyz, InverseRotation);
    let Front = RotateVector(StateIn.Load(int4(ClampCell(At + int3(0, 0, 1), Dimensions), 0)).xyz, InverseRotation);
    let Back = RotateVector(StateIn.Load(int4(ClampCell(At + int3(0, 0, -1), Dimensions), 0)).xyz, InverseRotation);
    DivergenceOut[At] = 0.5 * ((Right.x - Left.x) / max(Fluid.Cell.x, 1e-6) +
                               (Up.y - Down.y) / max(Fluid.Cell.y, 1e-6) +
                               (Front.z - Back.z) / max(Fluid.Cell.z, 1e-6));
}
