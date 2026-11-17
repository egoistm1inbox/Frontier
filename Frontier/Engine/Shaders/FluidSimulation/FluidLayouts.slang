//============================================================================================================================================
//                                                          FLUIDLAYOUTS.SLANG
//============================================================================================================================================
// 🧩 Shared GPU Fluid constants and spatial helpers.

struct FluidConstants
{
    float4 Grid;       // cell counts xyz, shared ForceField enabled
    float4 Timing;     // dt, ambient kelvin, buoyancy [m/s²/K], ForceField blend
    float4 Cell;       // local cell dimensions in world metres, after spatial scale
    float4 Position;   // world-space grid origin
    float4 Rotation;   // world-from-local quaternion xyzw
    float4 Solver;     // smoke diffusion, vapor diffusion, pressure iteration count, source count
    float4 Preview;    // preview width, height, ray steps, reserved
};

struct FluidRadialSource
{
    float4 PositionRadius;       // world centre xyz, radius
    float4 VelocitySmokeDelta;   // one-step velocity xyz, smoke density delta
    float4 VaporTemperatureDelta;// one-step vapor density and temperature deltas
};

uint3 ResolveGridDimensions(FluidConstants Fluid)
{
    return uint3(Fluid.Grid.xyz + 0.5);
}

bool IsInside(uint3 Cell, uint3 Dimensions)
{
    return Cell.x < Dimensions.x && Cell.y < Dimensions.y && Cell.z < Dimensions.z;
}

int3 ClampCell(int3 Cell, uint3 Dimensions)
{
    return clamp(Cell, int3(0), int3(Dimensions) - 1);
}

float3 RotateVector(float3 Value, float4 Quaternion)
{
    return Value + 2.0 * Quaternion.w * cross(Quaternion.xyz, Value)
                 + 2.0 * cross(Quaternion.xyz, cross(Quaternion.xyz, Value));
}

float3 ResolveCellWorldPosition(FluidConstants Fluid, uint3 Cell)
{
    let Local = (float3(Cell) + 0.5) * Fluid.Cell.xyz;
    return Fluid.Position.xyz + RotateVector(Local, Fluid.Rotation);
}
