//============================================================================================================================================
//                                                         FLUIDDIFFUSION.SLANG
//============================================================================================================================================
// 🧩 Stable explicit Laplacian diffusion for smoke and vapor density.

#pragma once
#include "FluidLayouts.slang"

[[vk::binding(0, 0)]] ConstantBuffer<FluidConstants> Fluid;
[[vk::binding(1, 0)]] Texture3D<float4> StateIn;
[[vk::binding(2, 0)]] Texture3D<float4> ThermalIn;
[[vk::binding(3, 0)]] [[vk::image_format("rgba32f")]] RWTexture3D<float4> StateOut;
[[vk::binding(4, 0)]] [[vk::image_format("rgba32f")]] RWTexture3D<float4> ThermalOut;

[shader("compute")]
[numthreads(4, 4, 4)]
void DiffuseFluidScalars(uint3 Cell : SV_DispatchThreadID)
{
    let Dimensions = ResolveGridDimensions(Fluid);
    if (!IsInside(Cell, Dimensions)) { return; }
    let At = int3(Cell);
    let State = StateIn.Load(int4(At, 0));
    let Thermal = ThermalIn.Load(int4(At, 0));
    let SmokeCentre = State.w;
    let VaporCentre = Thermal.x;
    let SmokeLeft = StateIn.Load(int4(ClampCell(At + int3(-1, 0, 0), Dimensions), 0)).w;
    let SmokeRight = StateIn.Load(int4(ClampCell(At + int3(1, 0, 0), Dimensions), 0)).w;
    let SmokeDown = StateIn.Load(int4(ClampCell(At + int3(0, -1, 0), Dimensions), 0)).w;
    let SmokeUp = StateIn.Load(int4(ClampCell(At + int3(0, 1, 0), Dimensions), 0)).w;
    let SmokeBack = StateIn.Load(int4(ClampCell(At + int3(0, 0, -1), Dimensions), 0)).w;
    let SmokeFront = StateIn.Load(int4(ClampCell(At + int3(0, 0, 1), Dimensions), 0)).w;
    let VaporLeft = ThermalIn.Load(int4(ClampCell(At + int3(-1, 0, 0), Dimensions), 0)).x;
    let VaporRight = ThermalIn.Load(int4(ClampCell(At + int3(1, 0, 0), Dimensions), 0)).x;
    let VaporDown = ThermalIn.Load(int4(ClampCell(At + int3(0, -1, 0), Dimensions), 0)).x;
    let VaporUp = ThermalIn.Load(int4(ClampCell(At + int3(0, 1, 0), Dimensions), 0)).x;
    let VaporBack = ThermalIn.Load(int4(ClampCell(At + int3(0, 0, -1), Dimensions), 0)).x;
    let VaporFront = ThermalIn.Load(int4(ClampCell(At + int3(0, 0, 1), Dimensions), 0)).x;

    let InverseCell = 1.0 / max(Fluid.Cell.xyz, float3(1e-6));
    let LambdaX = Fluid.Solver.x * Fluid.Timing.x * InverseCell.x * InverseCell.x;
    let LambdaY = Fluid.Solver.x * Fluid.Timing.x * InverseCell.y * InverseCell.y;
    let LambdaZ = Fluid.Solver.x * Fluid.Timing.x * InverseCell.z * InverseCell.z;
    let SmokeSum = LambdaX + LambdaY + LambdaZ;
    let SmokeScale = min(1.0, 0.49 / max(SmokeSum, 1e-8));
    let VaporX = Fluid.Solver.y * Fluid.Timing.x * InverseCell.x * InverseCell.x;
    let VaporY = Fluid.Solver.y * Fluid.Timing.x * InverseCell.y * InverseCell.y;
    let VaporZ = Fluid.Solver.y * Fluid.Timing.x * InverseCell.z * InverseCell.z;
    let VaporSum = VaporX + VaporY + VaporZ;
    let VaporScale = min(1.0, 0.49 / max(VaporSum, 1e-8));

    var DiffusedState = State;
    var DiffusedThermal = Thermal;
    DiffusedState.w = max(0.0, SmokeCentre + SmokeScale * (
        LambdaX * (SmokeLeft + SmokeRight - 2.0 * SmokeCentre) +
        LambdaY * (SmokeDown + SmokeUp - 2.0 * SmokeCentre) +
        LambdaZ * (SmokeBack + SmokeFront - 2.0 * SmokeCentre)));
    DiffusedThermal.x = max(0.0, VaporCentre + VaporScale * (
        VaporX * (VaporLeft + VaporRight - 2.0 * VaporCentre) +
        VaporY * (VaporDown + VaporUp - 2.0 * VaporCentre) +
        VaporZ * (VaporBack + VaporFront - 2.0 * VaporCentre)));
    StateOut[At] = DiffusedState;
    ThermalOut[At] = DiffusedThermal;
}
