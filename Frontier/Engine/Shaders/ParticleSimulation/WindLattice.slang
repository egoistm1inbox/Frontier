//============================================================================================================================================
//                                                            WINDLATTICE.SLANG
//============================================================================================================================================
// 🧩 The Particle editor's wind lattice: every enabled flow component summed on the 24 × 12 × 24 cells, with animated turbulence
//    and divergence-free swirl, rebuilt each refresh into an rgba16f volume (rgb velocity, a magnitude).

#pragma once
#include "ParticleLayouts.slang"

// 📝 A port of the WIND block of eos shaders.js.

// 📝 One flow component (eos CompW, 32 bytes).
struct WindComponent
{
    float4 Placement;   // x [m], z [m], radius [m], type (0 directional, 1 gust bands, 2 tornado, 3 radial)
    float4 Drive;       // strength [m/s], bearing [rad], frequency [Hz], enabled
};

  [[vk::binding(0, 0)]] ConstantBuffer<ParticleRefreshConstants>               Refresh;
  [[vk::binding(1, 0)]] StructuredBuffer<WindComponent>                        Components;
  [[vk::binding(2, 0)]] [[vk::image_format("rgba16f")]] RWTexture3D<float4>    WindOutput;

float HashLattice(float3 Point)
{
    return frac(sin(dot(Point, float3(127.1, 311.7, 74.7))) * 43758.5453);
}

float ResolveValueNoise(float3 Point)
{
    let Cell = floor(Point);
    let Within = frac(Point);
    let U = Within * Within * (3.0 - 2.0 * Within);
    let A = lerp(lerp(HashLattice(Cell), HashLattice(Cell + float3(1.0, 0.0, 0.0)), U.x),
                 lerp(HashLattice(Cell + float3(0.0, 1.0, 0.0)), HashLattice(Cell + float3(1.0, 1.0, 0.0)), U.x), U.y);
    let B = lerp(lerp(HashLattice(Cell + float3(0.0, 0.0, 1.0)), HashLattice(Cell + float3(1.0, 0.0, 1.0)), U.x),
                 lerp(HashLattice(Cell + float3(0.0, 1.0, 1.0)), HashLattice(Cell + float3(1.0, 1.0, 1.0)), U.x), U.y);
    return lerp(A, B, U.z);
}

// 📝 The curl of a vector potential built from three value-noise fields. A curl has no divergence, so the swirl never makes
//    sources or sinks: the lattice turns over on itself, like a real eddy field.
float3 ResolveNoisePotential(float3 Point)
{
    return float3(ResolveValueNoise(Point), ResolveValueNoise(Point + float3(17.3, 3.1, 9.7)), ResolveValueNoise(Point + float3(5.2, 31.7, 1.9))) * 2.0
         - 1.0;
}

float3 ResolveCurlNoise(float3 Point)
{
    let ε = 0.05;
    let Inverse = 0.5 / ε;
    let AlongX = (ResolveNoisePotential(Point + float3(ε, 0.0, 0.0)) - ResolveNoisePotential(Point - float3(ε, 0.0, 0.0))) * Inverse;
    let AlongY = (ResolveNoisePotential(Point + float3(0.0, ε, 0.0)) - ResolveNoisePotential(Point - float3(0.0, ε, 0.0))) * Inverse;
    let AlongZ = (ResolveNoisePotential(Point + float3(0.0, 0.0, ε)) - ResolveNoisePotential(Point - float3(0.0, 0.0, ε))) * Inverse;
    return float3(AlongY.z - AlongZ.y, AlongZ.x - AlongX.z, AlongX.y - AlongY.x);
}

// 📝 Linear superposition of the components, as the reference wind model, plus the animated turbulence and swirl, scaled by the
//    wind scale. Output rgb = velocity [m/s], a = its magnitude.
[shader("compute")]
[numthreads(4, 4, 4)]
void ConstructWindLattice(uint3 Cell : SV_DispatchThreadID)
{
    let Dimensions = uint3(ToUnsigned(Refresh.WindDimensions.x), ToUnsigned(Refresh.WindDimensions.y), ToUnsigned(Refresh.WindDimensions.z));
    if (Cell.x >= Dimensions.x || Cell.y >= Dimensions.y || Cell.z >= Dimensions.z) { return; }
    let CellFloat = float3(Cell);
    let Point = Refresh.WindMinimum.xyz + (CellFloat + 0.5) / Refresh.WindDimensions.xyz * Refresh.WindSize.xyz;
    let Time = Refresh.Timing.x;
    var Velocity = float3(0.0);
    let Count = ToUnsigned(Refresh.WindDimensions.w);
    for (var Index = 0u; Index < Count; Index++)
    {
        let Component = Components[Index];
        if (Component.Drive.w < 0.5 || Component.Drive.x == 0.0) { continue; }
        let Category = ToUnsigned(Component.Placement.w + 0.5);
        let Strength = Component.Drive.x;
        let Radius = max(Component.Placement.z, 0.5);
        let Relative = float2(Point.x - Component.Placement.x, Point.z - Component.Placement.y);
        let Distance = length(Relative);
        let Heading = float2(sin(Component.Drive.y), cos(Component.Drive.y));
        let Fall = max(0.0, 1.0 - (Distance / Radius) * (Distance / Radius));
        if (Category == 0u)
        {
            Velocity += float3(Heading.x, 0.0, Heading.y) * Strength;
        }
        else if (Category == 1u)
        {
            let Front = dot(Relative, Heading) * 0.08 - Time * Component.Drive.z * 0.6;
            let Phase = frac(Front);
            let Envelope = exp(-pow((Phase - 0.5) * 3.5, 2.0));
            Velocity += float3(Heading.x, 0.0, Heading.y) * Strength * Envelope * Fall * Fall;
        }
        else if (Category == 2u)
        {
            let q = Distance / Radius;
            let Profile = q * exp(1.0 - q);
            let Inverse = 1.0 / max(Distance, 1e-3);
            let Tangent = float2(-Relative.y, Relative.x) * Inverse;
            let Wobble = 1.0 + 0.2 * sin(Time * 2.0 + Point.y * 1.5);
            Velocity += float3(Tangent.x, 0.0, Tangent.y) * Strength * Profile * Wobble;
            Velocity += float3(-Relative.x, 0.0, -Relative.y) * Inverse * (0.25 * Strength * Profile);
            Velocity.y += Strength * 0.5 * Profile * clamp(1.0 - Point.y / Refresh.WindSize.y, 0.0, 1.0);
        }
        else
        {
            let Outward = Relative / max(Distance, 1e-3);
            Velocity += float3(Outward.x, 0.0, Outward.y) * Strength * Fall * Fall;
        }
    }
    let Turbulence = Refresh.Visualization.w;
    if (Turbulence > 0.0)
    {
        let Sample = Point * 0.45 + float3(Time * 0.25, Time * 0.13, Time * 0.18);
        let NoiseX = ResolveValueNoise(Sample);
        let NoiseY = ResolveValueNoise(Sample + float3(17.3, 3.1, 9.7));
        let NoiseZ = ResolveValueNoise(Sample + float3(5.2, 31.7, 1.9));
        Velocity += (float3(NoiseX, NoiseY, NoiseZ) * 2.0 - 1.0) * Turbulence * (1.0 + length(Velocity) * 0.2);
    }
    // 📝 Swirl: divergence-free curl noise drifting in time, so the arrows visibly turn over.
    let Swirl = Refresh.Swirl.x;
    if (Swirl > 0.0)
    {
        let Drift = Time * Refresh.Swirl.z;
        let Sample = Point * Refresh.Swirl.y + float3(Drift, Drift * 0.6, -Drift * 0.8);
        Velocity += ResolveCurlNoise(Sample) * Swirl;
    }
    Velocity *= Refresh.Timing.w;
    WindOutput[int3(Cell)] = float4(Velocity, length(Velocity));
}
