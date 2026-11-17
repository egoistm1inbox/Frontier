//============================================================================================================================================
//                                                          PARTICLELAYOUTS.SLANG
//============================================================================================================================================
// 🧩 The Particle editor's shared layouts and helpers: the refresh constants, an effect's constants, the 80-byte particle, the hash
//    and the sampling helpers every particle unit reads.

#pragma once
#include "IntrinsicParity.slang"

// 📝 A port of the COMMON block of eos shaders.js (Experimental/ParticleEditor/Engine, eos 549c477) with engine names. Every effect
//    constant is one float4; the host packs them in ParticleUniformPacking.cpp (eos fillSys). Units: metres and seconds.

// 📝 Written once per refresh (eos Glob, 208 bytes).
struct ParticleRefreshConstants
{
    float4x4 ViewProjection;   // [-] column-major from the host, read row-major: mul(Point, ViewProjection)
    float4   CameraRight;
    float4   CameraUp;
    float4   CameraPosition;   // xyz [m]
    float4   WindMinimum;      // xyz [m] the wind lattice's lower corner
    float4   WindSize;         // xyz [m]
    float4   WindDimensions;   // xyz [cell], w flow components in use
    float4   Timing;           // x [s] time, y [s] step, z refresh counter, w wind scale
    float4   Visualization;    // x [m/s] arrow reference speed, y [m] arrow width, z lightning flash, w turbulence
    float4   Swirl;            // x [m/s] swirl strength, y [1/m] spatial frequency, z animation rate, w arrow stride
};

// 📝 One effect's constants (eos Sys, 16 float4).
struct ParticleEffectConstants
{
    float4 Origin;             // xyz [m] origin, w [m] radius
    float4 Direction;          // xyz unit direction, w [rad] spread
    float4 Speed;              // x [m/s] minimum, y [m/s] maximum, z [1/s] drag, w [g] gravity
    float4 Life;               // x [s] minimum, y [s] maximum, z [m] size at release, w [m] size at the end
    float4 ColourA;
    float4 ColourB;
    float4 ColourC;
    float4 Physics;            // x [s] step, y [s] time, z refresh counter, w behaviour (0 ballistic, 1 wind-driven, 3 atoms, 4 reactive, 5 effect)
    float4 PhysicsWind;        // x [1/s] wind coupling, y bounce, z buoyancy, w flutter
    float4 PhysicsRelease;     // x capacity, y release shape, z fraction A (reactive), w released this refresh
    float4 PhysicsBox;         // xyz [m] box half extents, w head index
    float4 Molecular;          // x temperature, y ε, z [m] σ, w reaction rate
    float4 MolecularLattice;   // x [m] cell size, y cells per axis, z slots per cell, w dissociation rate
    float4 MolecularReach;     // x [m] reaction radius, y damping
    float4 Release;            // x head, y seed, z appearance (0 streak, 1 sphere, 2 leaf, 3 soft glow), w leaf surface
    float4 Miscellany;         // x size scale, y [Hz] pulse rate, z pulse depth, w [m] launch distance
};

// 📝 One particle (eos Part, 80 bytes).
struct Particle
{
    float4 PositionAge;        // xyz [m] position, w [s] age
    float4 VelocityLife;       // xyz [m/s] velocity, w [s] lifetime (gone when age ≥ lifetime)
    float4 Colour;             // rgba
    float4 Appearance;         // x [m] size, y [rad] angle, z [rad/s] spin, w seed (the species for molecules)
    float4 Transition;         // x [s] hold, y floor impact time + 1 (0 = none, derez), z slot, w stacked
};

//------------------------------------------------------------------------------------------------------------------------
//                                                   HASHES
//------------------------------------------------------------------------------------------------------------------------

uint HashUnsigned(uint Seed)
{
    var Mixed = Seed;
    Mixed ^= Mixed >> 16u;
    Mixed *= 0x7feb352du;
    Mixed ^= Mixed >> 15u;
    Mixed *= 0x846ca68bu;
    Mixed ^= Mixed >> 16u;
    return Mixed;
}

// 📝 eos rnd: advances the stream and returns a uniform in [0, 1) with 24 bits.
float ResolveUniform(inout uint Stream)
{
    Stream = HashUnsigned(Stream + 0x9e3779b9u);
    return float(Stream & 0xffffffu) / 16777216.0;
}

// 📝 eos hashF: a uniform in [0, 1) from a particle's seed and a salt.
float HashSeed(float Seed, uint Salt)
{
    let Mixed = HashUnsigned(ToUnsigned(Seed) * 31u + Salt * 977u + 17u);
    return float(Mixed & 0xffffffu) / 16777216.0;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   DIRECTIONS
//------------------------------------------------------------------------------------------------------------------------

float3 ResolveSphereDirection(float U, float V)
{
    let Z = 2.0 * U - 1.0;
    let α = 6.2831853 * V;
    let ρ = sqrt(max(0.0, 1.0 - Z * Z));
    return float3(ρ * cos(α), Z, ρ * sin(α));
}

// 📝 eos basisFrom: the columns (tangent, bitangent, direction); Apply multiplies like mat3x3f(t, b, d) * local.
struct DirectionBasis
{
    float3 Tangent;
    float3 Bitangent;
    float3 Direction;

    float3 Apply(float3 Local) { return Tangent * Local.x + Bitangent * Local.y + Direction * Local.z; }
};

DirectionBasis ResolveBasis(float3 Direction)
{
    let Up = SelectBranch(float3(0.0, 1.0, 0.0), float3(1.0, 0.0, 0.0), abs(Direction.y) > 0.95);
    let Tangent = normalize(cross(Up, Direction));
    var Basis : DirectionBasis;
    Basis.Tangent   = Tangent;
    Basis.Bitangent = cross(Direction, Tangent);
    Basis.Direction = Direction;
    return Basis;
}

float3 RotateAboutAxis(float3 Vector, float3 Axis, float θ)
{
    let Cosine = cos(θ);
    let Sine = sin(θ);
    return Vector * Cosine + cross(Axis, Vector) * Sine + Axis * dot(Axis, Vector) * (1.0 - Cosine);
}
