//============================================================================================================================================
//                                                            FLUIDFORCES.SLANG
//============================================================================================================================================
// 🧩 Per-cell native ForceField coupling, buoyancy, and radial source injection.

#pragma once
#include "FluidLayouts.slang"

[[vk::binding(0, 0)]] ConstantBuffer<FluidConstants> Fluid;
[[vk::binding(1, 0)]] Texture3D<float4> StateIn;
[[vk::binding(2, 0)]] Texture3D<float4> ThermalIn;
[[vk::binding(3, 0)]] Texture3D<float4> SharedFieldFlow;
[[vk::binding(4, 0)]] StructuredBuffer<FluidRadialSource> Sources;
[[vk::binding(5, 0)]] [[vk::image_format("rgba32f")]] RWTexture3D<float4> StateOut;
[[vk::binding(6, 0)]] [[vk::image_format("rgba32f")]] RWTexture3D<float4> ThermalOut;

[shader("compute")]
[numthreads(4, 4, 4)]
void ApplyFluidForces(uint3 Cell : SV_DispatchThreadID)
{
    let Dimensions = ResolveGridDimensions(Fluid);
    if (!IsInside(Cell, Dimensions)) { return; }

    var State = StateIn.Load(int4(Cell, 0));
    var Thermal = ThermalIn.Load(int4(Cell, 0));
    let WorldPoint = ResolveCellWorldPosition(Fluid, Cell);
    let SourceCount = uint(Fluid.Solver.w + 0.5);
    for (var Index = 0u; Index < SourceCount; Index++)
    {
        let Source = Sources[Index];
        let Distance = length(WorldPoint - Source.PositionRadius.xyz);
        let Weight = saturate(1.0 - Distance / max(Source.PositionRadius.w, 1e-4));
        State.xyz += Source.VelocitySmokeDelta.xyz * Weight;
        State.w += Source.VelocitySmokeDelta.w * Weight;
        Thermal.x += Source.VaporTemperatureDelta.x * Weight;
        Thermal.y += Source.VaporTemperatureDelta.y * Weight;
    }

    if (Fluid.Grid.w > 0.5)
    {
        let Wind = SharedFieldFlow.Load(int4(Cell, 0)).xyz;
        State.xyz = lerp(State.xyz, Wind, Fluid.Timing.w);
    }
    State.z += Fluid.Timing.z * (Thermal.y - Fluid.Timing.y) * Fluid.Timing.x;
    State.w = max(0.0, State.w);
    Thermal.x = max(0.0, Thermal.x);
    Thermal.y = max(0.01, Thermal.y);
    StateOut[int3(Cell)] = State;
    ThermalOut[int3(Cell)] = Thermal;
}
