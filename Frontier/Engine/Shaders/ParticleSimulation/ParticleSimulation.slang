//============================================================================================================================================
//                                                         PARTICLESIMULATION.SLANG
//============================================================================================================================================
// 🧩 The particle dispatches: release, the ballistic and wind-driven step, the census, the molecular lattice and step, the swarm.

#pragma once
#include "ParticleLayouts.slang"

// 📝 A port of the SIM block of eos shaders.js. Group 0 is the refresh (constants, wind lattice); group 1 is one effect.

  [[vk::binding(0, 0)]] ConstantBuffer<ParticleRefreshConstants> Refresh;
  [[vk::binding(1, 0)]] Texture3D<float4>                        WindLattice;
  [[vk::binding(2, 0)]] SamplerState                             WindSampler;
  [[vk::binding(0, 1)]] ConstantBuffer<ParticleEffectConstants>  Effect;
  [[vk::binding(1, 1)]] RWStructuredBuffer<Particle>             Particles;
  [[vk::binding(2, 1)]] RWStructuredBuffer<uint>                 Census;      // alive, A, B, C, energy × 1000, three spare
  [[vk::binding(3, 1)]] RWStructuredBuffer<uint>                 CellCount;
  [[vk::binding(4, 1)]] RWStructuredBuffer<uint>                 CellSlots;
  [[vk::binding(5, 1)]] StructuredBuffer<Particle>               Snapshot;
  [[vk::binding(6, 1)]] StructuredBuffer<float4>                 Fields;

static const float ForceLimit = 180.0;   // [m/s²] the molecular force clamp (eos FMAX)

//------------------------------------------------------------------------------------------------------------------------
//                                                   ACCELERATION FIELDS
//------------------------------------------------------------------------------------------------------------------------

// 📝 Packed by the host each refresh. Fields[0] = (count, time, 0, 0); field k uses float4 slots 1 + 3k … 3 + 3k:
//    A = (centre, radius; 0 = everywhere), B = (type 0 attract, 1 repel, 2 lift, 3 dipole; strength, swirl, swallow radius),
//    C = (start, duration, period; 0 = once).
bool EvaluateFieldAwake(float4 Window, float Now)
{
    let Since = Now - Window.x;
    if (Since < 0.0) { return false; }
    if (Window.z > 0.0) { return (Since % Window.z) < Window.y; }
    return Since < Window.y;
}

float3 ResolveFieldAcceleration(float3 Point, float3 Velocity)
{
    let Count = ToUnsigned(Fields[0].x);
    let Now = Fields[0].y;
    var Acceleration = float3(0.0);
    for (var Index = 0u; Index < Count; Index++)
    {
        let A = Fields[1u + 3u * Index];
        let B = Fields[2u + 3u * Index];
        let C = Fields[3u + 3u * Index];
        if (!EvaluateFieldAwake(C, Now)) { continue; }
        let Category = ToUnsigned(B.x);
        if (Category >= 4u)
        {
            // 📝 Box volumes: a cube of half size A.w about A.xyz (0: everywhere), fading over its outer fifth. The drag volume
            //    bleeds B.y of the velocity per second; the current relaxes particles toward its flow B.yzw at 1.5 per second.
            let Reach = abs(Point - A.xyz);
            let Edge = max(Reach.x, max(Reach.y, Reach.z));
            if (A.w > 0.0 && Edge >= A.w) { continue; }
            let Inside = SelectBranch(1.0 - smoothstep(0.8 * A.w, A.w, Edge), 1.0, A.w <= 0.0);
            if (Category == 4u) { Acceleration -= Velocity * B.y * Inside; }
            else { Acceleration += (B.yzw - Velocity) * 1.5 * Inside; }
            continue;
        }
        let Offset = A.xyz - Point;
        let Distance = length(Offset);
        let Everywhere = A.w <= 0.0;
        if (!Everywhere && Distance >= A.w) { continue; }
        let Share = SelectBranch(pow(clamp(1.0 - Distance / max(A.w, 1e-3), 0.0, 1.0), 2.0), 1.0, Everywhere);
        let Toward = Offset / max(Distance, 1e-3);
        if (Category == 0u)
        {
            let Tangent = normalize(cross(float3(0.0, 1.0, 0.0), Toward) + float3(1e-5, 0.0, 0.0));
            Acceleration += (Toward * B.y + Tangent * B.z) * Share;
        }
        else if (Category == 1u)
        {
            Acceleration -= Toward * B.y * Share;
        }
        else if (Category == 2u)
        {
            Acceleration += float3(0.0, B.y, 0.0) * Share;
        }
        else
        {
            // 📝 Magnetic dipole (axis world Z, centred on the field). The drive pushes along the local field direction and damps
            //    motion across it, so particles ride the field lines: strength B.y = drive, B.z = guide rate.
            let Relative = Point - A.xyz;
            let Unit = Relative / max(length(Relative), 0.4);
            let Axis = float3(0.0, 0.0, 1.0);
            let Field = 3.0 * dot(Axis, Unit) * Unit - Axis;
            let FieldUnit = normalize(Field);
            let Across = Velocity - FieldUnit * dot(Velocity, FieldUnit);
            Acceleration += (FieldUnit * B.y - Across * B.z) * Share;
        }
    }
    return Acceleration;
}

bool EvaluateFieldSwallowed(float3 Point)
{
    let Count = ToUnsigned(Fields[0].x);
    let Now = Fields[0].y;
    for (var Index = 0u; Index < Count; Index++)
    {
        let A = Fields[1u + 3u * Index];
        let B = Fields[2u + 3u * Index];
        let C = Fields[3u + 3u * Index];
        if (ToUnsigned(B.x) == 0u && B.w > 0.0 && EvaluateFieldAwake(C, Now) && length(A.xyz - Point) < B.w) { return true; }
    }
    return false;
}

float3 SampleWind(float3 Point)
{
    let Coordinates = (Point - Refresh.WindMinimum.xyz) / Refresh.WindSize.xyz;
    if (any(Coordinates < float3(0.0)) || any(Coordinates > float3(1.0))) { return float3(0.0); }
    return WindLattice.SampleLevel(WindSampler, Coordinates, 0.0).xyz;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   TRANSITIONS
//------------------------------------------------------------------------------------------------------------------------

// 📝 Surface grid: the local position in [-1, 1]³ of cell Index on a box surface (capacity = 6 · g² cells).
float3 ResolveSurfaceLocal(uint Index, float Capacity)
{
    let Grid = max(1u, ToUnsigned(floor(sqrt(Capacity / 6.0))));
    let Cells = Grid * Grid;
    let Face = Index % 6u;
    let Cell = (Index / 6u) % Cells;
    let U = (float(Cell % Grid) + 0.5) / float(Grid) * 2.0 - 1.0;
    let V = (float(Cell / Grid) + 0.5) / float(Grid) * 2.0 - 1.0;
    let Axis = Face / 2u;
    let Side = SelectBranch(-1.0, 1.0, (Face % 2u) == 0u);
    var Local = float3(0.0);
    Local[Axis] = Side;
    Local[(Axis + 1u) % 3u] = U;
    Local[(Axis + 2u) % 3u] = V;
    return Local;
}

// 📝 A particle's slot in an assembly: 1 = its surface cell, 2 = its place in a column on the floor.
float3 ResolveAssemblyTarget(uint Index, uint Mode)
{
    if (Mode == 2u)
    {
        let Size = Effect.Life.z * Effect.Miscellany.x;
        return float3(Effect.Origin.x, Effect.Origin.y + (float(Index) + 0.5) * 0.2 * Size, Effect.Origin.z);
    }
    return Effect.Origin.xyz + ResolveSurfaceLocal(Index, Effect.PhysicsRelease.x) * Effect.PhysicsBox.xyz;
}

// 📝 Release time (0..1) across the object. Corner: a wave from the lower corner. Melt: patchy clumps melting across the surface.
//    Glitch: blocky cells on a 7 × 5 × 7 grid, each with a hashed release time, plus a rising sweep.
float ResolveWaveTime(float3 U)
{
    if (Effect.MolecularLattice.x > 1.5)
    {
        let Cell = floor(U * float3(7.0, 5.0, 7.0));
        let Hashed = frac(sin(dot(Cell, float3(12.9898, 78.233, 37.719))) * 43758.5453);
        return clamp(0.6 * Hashed + 0.4 * U.y, 0.0, 1.0);
    }
    if (Effect.MolecularLattice.x > 0.5)
    {
        return clamp(0.5 + 0.3 * sin(U.x * 5.0 + U.y * 3.0 + 0.7) + 0.2 * sin(U.y * 7.0 - U.z * 4.0 + 2.1), 0.0, 1.0);
    }
    return (U.x + U.y + U.z) / 3.0;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   RELEASE
//------------------------------------------------------------------------------------------------------------------------

[shader("compute")]
[numthreads(64, 1, 1)]
void ReleaseParticles(uint3 Invocation : SV_DispatchThreadID)
{
    let Lane = Invocation.x;
    let Released = ToUnsigned(Effect.PhysicsRelease.w);
    if (Lane >= Released) { return; }
    let Capacity = ToUnsigned(Effect.PhysicsRelease.x);
    let Slot = (ToUnsigned(Effect.Release.x) + Lane) % Capacity;
    var Stream = HashUnsigned(Slot * 2654435761u + ToUnsigned(Effect.Release.y) * 40503u + 12345u);
    let R0 = ResolveUniform(Stream); let R1 = ResolveUniform(Stream); let R2 = ResolveUniform(Stream); let R3 = ResolveUniform(Stream);
    let R4 = ResolveUniform(Stream); let R5 = ResolveUniform(Stream); let R6 = ResolveUniform(Stream);
    let Behaviour = ToUnsigned(Effect.Physics.w);
    let Shape = ToUnsigned(Effect.PhysicsRelease.y);
    let Radius = Effect.Origin.w;
    var Position = Effect.Origin.xyz;
    if (Shape == 1u)
    {
        Position += ResolveSphereDirection(R0, R1) * Radius * pow(R2, 0.333);
    }
    else if (Shape == 2u)
    {
        let α = 6.2831853 * R0;
        let Reach = Radius * sqrt(R1);
        Position += float3(cos(α) * Reach, 0.0, sin(α) * Reach);
    }
    else if (Shape == 3u)
    {
        Position += (float3(R0, R1, R2) * 2.0 - 1.0) * Effect.PhysicsBox.xyz;
    }
    else if (Shape == 4u)
    {
        // 📝 Box surface grid: the cells tile every face, so one full batch covers the whole surface.
        Position += ResolveSurfaceLocal(Lane, Effect.PhysicsRelease.x) * Effect.PhysicsBox.xyz;
    }
    var Velocity = float3(0.0);
    var Life = lerp(Effect.Life.x, Effect.Life.y, R3);
    var Species = 0.0;
    let Molecular = Behaviour == 3u || Behaviour == 4u;
    if (Molecular)
    {
        Life = 1.0e9;
        Position = Effect.Origin.xyz + (float3(R0, R1, R2) * 2.0 - 1.0) * Effect.PhysicsBox.xyz;
        Velocity = (float3(R4, R5, R6) - 0.5) * sqrt(12.0 * Effect.Molecular.x);
        if (Behaviour == 4u) { Species = SelectBranch(1.0, 0.0, R3 < Effect.PhysicsRelease.z); }
    }
    else
    {
        let Basis = ResolveBasis(Effect.Direction.xyz);
        let CosineTilt = 1.0 - R4 * (1.0 - cos(Effect.Direction.w));
        let SineTilt = sqrt(max(0.0, 1.0 - CosineTilt * CosineTilt));
        let φ = 6.2831853 * R5;
        let Local = float3(SineTilt * cos(φ), SineTilt * sin(φ), CosineTilt);
        Velocity = Basis.Apply(Local) * lerp(Effect.Speed.x, Effect.Speed.y, R6);
    }
    // 📝 Transitions (behaviour 5). Modes: 0 = hold, then burst or fall; 1 = rebuild from a launch sphere; 2 = stack in a column.
    let Mode = ToUnsigned(Effect.MolecularLattice.z);
    let Transitioning = Behaviour == 5u && (Effect.MolecularReach.x + Effect.MolecularReach.y) > 0.0;
    var Hold = 0.0;
    var SlotIndex = 0.0;
    var Stacked = 0.0;
    if (Transitioning)
    {
        var Unit = float3(0.5);
        if (Mode == 1u)
        {
            Unit = ResolveSurfaceLocal(Lane, Effect.PhysicsRelease.x) * 0.5 + 0.5;
        }
        else if (Shape == 4u)
        {
            Unit = clamp((Position - Effect.Origin.xyz) / max(Effect.PhysicsBox.xyz, float3(1e-4)) * 0.5 + 0.5, float3(0.0), float3(1.0));
        }
        var Moment = SelectBranch(R2, ResolveWaveTime(Unit), Shape == 4u || Mode == 1u);
        if (Mode == 2u) { Moment = float(Lane) / max(Effect.PhysicsRelease.x, 1.0); }
        let Jitter = SelectBranch(0.15 * R2, 0.0, Mode == 2u);
        Hold = Effect.MolecularReach.x + Effect.MolecularReach.y * (Moment + Jitter);
        if (Mode == 0u)
        {
            Life = Hold + Life;
            let Outward = normalize(Position - Effect.Origin.xyz + float3(0.0, 0.35, 0.0));
            Velocity = SelectBranch(float3(0.0), Outward * lerp(Effect.Speed.x, Effect.Speed.y, R6), R4 < Effect.MolecularReach.z);
        }
        else
        {
            // 📝 Assembly: start on a sphere around the object (rebuild) or above the column (stack); the velocity holds the start.
            Life = 10000.0;
            if (Mode == 1u)
            {
                let Outward = normalize(float3(R0, R1, R2) * 2.0 - 1.0 + float3(0.0, 0.001, 0.0));
                Position = Effect.Origin.xyz + Outward * Effect.Miscellany.w * (0.8 + 0.4 * R4);
            }
            else
            {
                Position = float3(Effect.Origin.x + (R4 - 0.5) * 0.12, Effect.Origin.y + Effect.Miscellany.w, Effect.Origin.z + (R5 - 0.5) * 0.12);
            }
            Velocity = Position;
            SlotIndex = float(Lane);
            Stacked = SelectBranch(0.0, 1.0, Mode == 2u);
        }
    }
    var Fresh : Particle;
    Fresh.PositionAge  = float4(Position, 0.0);
    Fresh.VelocityLife = float4(Velocity, Life);
    Fresh.Colour       = Effect.ColourA;
    Fresh.Appearance   = float4(Effect.Life.z * Effect.Miscellany.x, SelectBranch(R0 * 6.2831853, 0.0, Transitioning), (R1 - 0.5) * 4.0,
                                    SelectBranch(float(Stream & 0xffffffu), Species, Molecular));
    Fresh.Transition   = float4(Hold, 0.0, SlotIndex, Stacked);
    Particles[Slot] = Fresh;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   BALLISTIC AND WIND-DRIVEN STEP
//------------------------------------------------------------------------------------------------------------------------

Particle ConstructVacantParticle()
{
    Particle Vacant;
    Vacant.PositionAge  = float4(0.0);
    Vacant.VelocityLife = float4(0.0);
    Vacant.Colour       = float4(0.0);
    Vacant.Appearance   = float4(0.0);
    Vacant.Transition   = float4(0.0);
    return Vacant;
}

Particle ConstructParticle(float4 PositionAge, float4 VelocityLife, float4 Colour, float4 Appearance, float4 Transition)
{
    Particle Assembled;
    Assembled.PositionAge  = PositionAge;
    Assembled.VelocityLife = VelocityLife;
    Assembled.Colour       = Colour;
    Assembled.Appearance   = Appearance;
    Assembled.Transition   = Transition;
    return Assembled;
}

// 📝 Sparks, leaves, rain, smoke, fire, explosions and the transitions.
[shader("compute")]
[numthreads(64, 1, 1)]
void AdvanceParticles(uint3 Invocation : SV_DispatchThreadID)
{
    let Lane = Invocation.x;
    let Capacity = ToUnsigned(Effect.PhysicsRelease.x);
    if (Lane >= Capacity) { return; }
    let Current = Particles[Lane];
    let Life = Current.VelocityLife.w;
    if (Current.PositionAge.w >= Life) { return; }
    let Step = Effect.Physics.x;
    let Behaviour = ToUnsigned(Effect.Physics.w);
    let Age = Current.PositionAge.w + Step;
    if (Age >= Life) { Particles[Lane] = ConstructVacantParticle(); return; }
    let Progress = Age / Life;
    let Seed = Current.Appearance.w;
    // 📝 Assembly (behaviour 5, modes 1 and 2): an analytic flight to a fixed slot, then hold. No physics after release.
    let Mode = ToUnsigned(Effect.MolecularLattice.z);
    if (Behaviour == 5u && Mode > 0u)
    {
        let Start = Current.VelocityLife.xyz;
        var Target = ResolveAssemblyTarget(ToUnsigned(Current.Transition.z), Mode);
        if (Mode == 1u)
        {
            let U = clamp(Age / max(Current.Transition.x, 1e-4), 0.0, 1.0);
            let Eased = U * U * (3.0 - 2.0 * U);
            Target = lerp(Start, Target, Eased) + float3(0.0, 0.5 * sin(3.14159265 * U) * (1.0 - Eased), 0.0);
        }
        else
        {
            let g = 9.81;
            let FallTime = sqrt(2.0 * max(Start.y - Target.y, 0.0) / g);
            let τ = max(Age - (Current.Transition.x - FallTime), 0.0);
            if (τ < FallTime)
            {
                let Along = clamp(τ / max(FallTime, 1e-4), 0.0, 1.0);
                Target = float3(lerp(Start.x, Target.x, Along), Start.y - 0.5 * g * τ * τ, lerp(Start.z, Target.z, Along));
            }
            else
            {
                let Bounce = max(Age - Current.Transition.x, 0.0);
                Target.y += 0.02 * exp(-8.0 * Bounce) * abs(sin(25.0 * Bounce));
            }
        }
        Particles[Lane] = ConstructParticle(float4(Target, Age), Current.VelocityLife, Current.Colour, Current.Appearance, Current.Transition);
        return;
    }
    // 📝 Transition pieces wait on the object's surface until their hold time, still and unturned, so the object reads as solid.
    if (Age < Current.Transition.x)
    {
        Particles[Lane] = ConstructParticle(float4(Current.PositionAge.xyz, Age), Current.VelocityLife, Current.Colour,
                                            float4(Current.Appearance.x, 0.0, Current.Appearance.z, Seed), Current.Transition);
        return;
    }
    var Position = Current.PositionAge.xyz;
    var Velocity = Current.VelocityLife.xyz;

    // 📝 The wind lattice: the velocity relaxes toward the local wind.
    let Wind = SampleWind(Position);
    let Coupling = min(Effect.PhysicsWind.x * Step, 1.0);
    Velocity += (Wind - Velocity) * Coupling;
    Velocity *= exp(-Effect.Speed.z * Step);
    Velocity.y += (-Effect.Speed.w * 9.81 + Effect.PhysicsWind.z) * Step;
    // 📝 Acceleration fields: pull, push or lift; a particle inside an attractor's swallow radius is removed.
    if (Fields[0].x > 0.0)
    {
        if (EvaluateFieldSwallowed(Position)) { Particles[Lane] = ConstructVacantParticle(); return; }
        Velocity += ResolveFieldAcceleration(Position, Velocity) * Step;
    }
    if (Effect.PhysicsWind.w > 0.0)
    {
        let Phase = Age * 2.7 + Seed * 0.013;
        Velocity += float3(sin(Phase), 0.25 * cos(Phase * 1.3), cos(Phase * 0.8 + 1.0)) * Effect.PhysicsWind.w * Step;
    }
    Position += Velocity * Step;
    if (Position.y < 0.0)
    {
        // 📝 A derez cube breaks on its first floor impact: it stops here and its pieces are rastered procedurally.
        if (Behaviour == 5u && Effect.MolecularLattice.w > 0.5 && Current.Transition.y <= 0.0)
        {
            Particles[Lane] = ConstructParticle(float4(Position.x, 0.5 * Current.Appearance.x, Position.z, Age), float4(Velocity, Age), Current.Colour,
                                                Current.Appearance, float4(Current.Transition.x, Effect.Physics.y + 1.0, 0.0, 0.0));
            return;
        }
        Position.y = 0.0;
        if (Behaviour == 1u)
        {
            Velocity = float3(Velocity.x * 0.55, 0.0, Velocity.z * 0.55);
        }
        else
        {
            Velocity.y = -Velocity.y * Effect.PhysicsWind.y;
            Velocity.x *= 0.7;
            Velocity.z *= 0.7;
        }
    }
    if (length(Position - Effect.Origin.xyz) > 60.0) { Particles[Lane] = ConstructVacantParticle(); return; }

    let Spin = Current.Appearance.z;
    let Angle = Current.Appearance.y + Spin * Step;
    let Size = lerp(Effect.Life.z, Effect.Life.w, Progress) * Effect.Miscellany.x * (0.7 + 0.6 * frac(Seed * 0.618034));
    var Colour = lerp(Effect.ColourA, Effect.ColourB, Progress);
    Colour.a = Colour.a * smoothstep(0.0, 0.08, Progress) * (1.0 - smoothstep(0.7, 1.0, Progress));
    Particles[Lane] = ConstructParticle(float4(Position, Age), float4(Velocity, Life), Colour, float4(Size, Angle, Spin, Seed), Current.Transition);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   CENSUS
//------------------------------------------------------------------------------------------------------------------------

int3 ResolveCellOf(float3 Point)
{
    let Grid = ToSigned(Effect.MolecularLattice.y);
    let U = (Point - Effect.Origin.xyz + Effect.PhysicsBox.xyz) / Effect.MolecularLattice.x;
    return clamp(int3(ToSigned(floor(U.x)), ToSigned(floor(U.y)), ToSigned(floor(U.z))), int3(0), int3(Grid - 1));
}

float2 ResolveWallReflection(float Coordinate, float Speed, float Half)
{
    if (Coordinate > Half) { return float2(2.0 * Half - Coordinate, -abs(Speed)); }
    if (Coordinate < -Half) { return float2(-2.0 * Half - Coordinate, abs(Speed)); }
    return float2(Coordinate, Speed);
}

[shader("compute")]
[numthreads(1, 1, 1)]
void ClearCensus()
{
    for (var Index = 0u; Index < 8u; Index++) { InterlockedExchange(Census[Index], 0u, AtomicDiscard); }
}

[shader("compute")]
[numthreads(64, 1, 1)]
void GatherCensus(uint3 Invocation : SV_DispatchThreadID)
{
    let Lane = Invocation.x;
    let Capacity = ToUnsigned(Effect.PhysicsRelease.x);
    if (Lane >= Capacity) { return; }
    let Current = Particles[Lane];
    if (Current.PositionAge.w >= Current.VelocityLife.w) { return; }
    InterlockedAdd(Census[0], 1u);
    InterlockedAdd(Census[4], ToUnsigned(dot(Current.VelocityLife.xyz, Current.VelocityLife.xyz) * 1000.0));
    if (ToUnsigned(Effect.Physics.w) == 4u)
    {
        let Species = ToUnsigned(clamp(Current.Appearance.w, 0.0, 2.0));
        InterlockedAdd(Census[1u + Species], 1u);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   MOLECULAR LATTICE
//------------------------------------------------------------------------------------------------------------------------

[shader("compute")]
[numthreads(64, 1, 1)]
void ClearMolecularCells(uint3 Invocation : SV_DispatchThreadID)
{
    let Grid = ToUnsigned(Effect.MolecularLattice.y);
    let Lane = Invocation.x;
    if (Lane >= Grid * Grid * Grid) { return; }
    InterlockedExchange(CellCount[Lane], 0u, AtomicDiscard);
}

[shader("compute")]
[numthreads(64, 1, 1)]
void InsertMolecularCells(uint3 Invocation : SV_DispatchThreadID)
{
    let Lane = Invocation.x;
    let Capacity = ToUnsigned(Effect.PhysicsRelease.x);
    if (Lane >= Capacity) { return; }
    let Current = Particles[Lane];
    if (Current.PositionAge.w >= Current.VelocityLife.w) { return; }
    let Slots = ToUnsigned(Effect.MolecularLattice.z);
    let Grid = ToSigned(Effect.MolecularLattice.y);
    let Cell = ResolveCellOf(Current.PositionAge.xyz);
    let CellIndex = ToUnsigned(Cell.x + Cell.y * Grid + Cell.z * Grid * Grid);
    uint Slot;
    InterlockedAdd(CellCount[CellIndex], 1u, Slot);
    if (Slot < Slots) { CellSlots[CellIndex * Slots + Slot] = Lane; }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   SWARM
//------------------------------------------------------------------------------------------------------------------------

// 📝 Behaviour 6: brute-force boids over the snapshot, plus wander, a weak leash to the release point, wind coupling and an
//    optional pulse (fireflies). Reads the snapshot, writes only its own particle.
[shader("compute")]
[numthreads(64, 1, 1)]
void AdvanceSwarm(uint3 Invocation : SV_DispatchThreadID)
{
    let Lane = Invocation.x;
    let Capacity = ToUnsigned(Effect.PhysicsRelease.x);
    if (Lane >= Capacity) { return; }
    let Mine = Snapshot[Lane];
    if (Mine.PositionAge.w >= Mine.VelocityLife.w) { return; }
    let Step = Effect.Physics.x;
    let Reach = max(Effect.MolecularReach.x, 0.1);
    let SpeedLimit = max(Effect.MolecularReach.y, 0.05);
    var Separation = float3(0.0);
    var Alignment = float3(0.0);
    var Cohesion = float3(0.0);
    var Neighbours = 0.0;
    for (var Other = 0u; Other < Capacity; Other++)
    {
        if (Other == Lane) { continue; }
        let Peer = Snapshot[Other];
        if (Peer.PositionAge.w >= Peer.VelocityLife.w) { continue; }
        let Relative = Mine.PositionAge.xyz - Peer.PositionAge.xyz;
        let DistanceSquared = dot(Relative, Relative);
        if (DistanceSquared > Reach * Reach) { continue; }
        let Distance = sqrt(max(DistanceSquared, 1e-6));
        Separation += Relative / Distance * (1.0 - Distance / Reach);
        Alignment += Peer.VelocityLife.xyz;
        Cohesion += Peer.PositionAge.xyz;
        Neighbours += 1.0;
    }
    var Acceleration = float3(0.0);
    if (Neighbours > 0.0)
    {
        Acceleration += Separation * 3.0;
        Acceleration += (Alignment / Neighbours - Mine.VelocityLife.xyz) * 1.5;
        Acceleration += (Cohesion / Neighbours - Mine.PositionAge.xyz) * 0.8;
    }
    let Seed = Mine.Appearance.w;
    let Wander = Effect.Physics.y * 0.9 + Seed * 0.37;
    Acceleration += float3(sin(Wander * 1.3 + Seed), 0.5 * sin(Wander * 0.7 + Seed * 2.1), cos(Wander * 1.1 + Seed * 0.7)) * Effect.PhysicsWind.w;
    Acceleration += -(Mine.PositionAge.xyz - Effect.Origin.xyz) * 0.12;
    var Velocity = Mine.VelocityLife.xyz + Acceleration * Step;
    let Speed = length(Velocity);
    if (Speed > SpeedLimit) { Velocity *= SpeedLimit / Speed; }
    let Wind = SampleWind(Mine.PositionAge.xyz);
    Velocity += (Wind - Velocity) * min(Effect.PhysicsWind.x * Step, 1.0);
    Velocity.y += (-Effect.Speed.w * 9.81 + Effect.PhysicsWind.z) * Step;
    var Position = Mine.PositionAge.xyz + Velocity * Step;
    if (Position.y < 0.02) { Position.y = 0.02; Velocity.y = abs(Velocity.y) * 0.5; }
    let Life = Mine.VelocityLife.w;
    let Age = Mine.PositionAge.w + Step;
    if (Age >= Life) { Particles[Lane] = ConstructVacantParticle(); return; }
    let Progress = Age / Life;
    let Size = lerp(Effect.Life.z, Effect.Life.w, Progress) * Effect.Miscellany.x * (0.7 + 0.6 * frac(Seed * 0.618034));
    let Pulse = 1.0 - Effect.Miscellany.z + Effect.Miscellany.z * (0.5 + 0.5 * sin(Effect.Physics.y * Effect.Miscellany.y * 6.2831853 + Seed * 6.2831853));
    var Colour = lerp(Effect.ColourA, Effect.ColourB, Progress);
    Colour.a = Colour.a * Pulse * smoothstep(0.0, 0.08, Progress) * (1.0 - smoothstep(0.7, 1.0, Progress));
    Particles[Lane] = ConstructParticle(float4(Position, Age), float4(Velocity, Life), Colour, float4(Size, Mine.Appearance.y, Mine.Appearance.z, Seed),
                                        float4(0.0));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   MOLECULAR STEP
//------------------------------------------------------------------------------------------------------------------------

// 📝 Reads the snapshot (race-free) and writes only its own particle. Behaviour 3: a Lennard-Jones gas with a Langevin
//    thermostat. Behaviour 4: soft repulsion with the stochastic reaction A + B → C and the dissociation C → A or B.
[shader("compute")]
[numthreads(64, 1, 1)]
void AdvanceMolecules(uint3 Invocation : SV_DispatchThreadID)
{
    let Lane = Invocation.x;
    let Capacity = ToUnsigned(Effect.PhysicsRelease.x);
    if (Lane >= Capacity) { return; }
    let Mine = Snapshot[Lane];
    if (Mine.PositionAge.w >= Mine.VelocityLife.w) { return; }
    let Behaviour = ToUnsigned(Effect.Physics.w);
    let Step = Effect.Physics.x;
    let σ = Effect.Molecular.z;
    let ε = Effect.Molecular.y;
    let Cutoff = 2.5 * σ;
    let CutoffSquared = Cutoff * Cutoff;
    let ReactionReach = Effect.MolecularReach.x;
    let ReactionReachSquared = ReactionReach * ReactionReach;
    let Grid = ToSigned(Effect.MolecularLattice.y);
    let Slots = ToUnsigned(Effect.MolecularLattice.z);
    let Home = ResolveCellOf(Mine.PositionAge.xyz);
    var Force = float3(0.0);
    var Species = Mine.Appearance.w;
    // 📝 Seeded from the position too: the release seed is constant within a refresh, so without it every sub-step would reuse
    //    the same thermostat noise and the noise would add coherently.
    var Stream = HashUnsigned(Lane * 747796405u + ToUnsigned(Effect.Release.y) * 2891336453u + asuint(Mine.PositionAge.x) * 2654435761u
                              + asuint(Mine.PositionAge.y) * 2246822519u + 1u);
    for (var Δz = -1; Δz <= 1; Δz++)
    {
        for (var Δy = -1; Δy <= 1; Δy++)
        {
            for (var Δx = -1; Δx <= 1; Δx++)
            {
                let Neighbour = Home + int3(Δx, Δy, Δz);
                if (any(Neighbour < int3(0)) || any(Neighbour >= int3(Grid))) { continue; }
                let CellIndex = ToUnsigned(Neighbour.x + Neighbour.y * Grid + Neighbour.z * Grid * Grid);
                let Count = min(CellCount[CellIndex], Slots);
                for (var Entry = 0u; Entry < Count; Entry++)
                {
                    let Other = CellSlots[CellIndex * Slots + Entry];
                    if (Other == Lane || Other >= Capacity) { continue; }
                    let Peer = Snapshot[Other];
                    if (Peer.PositionAge.w >= Peer.VelocityLife.w) { continue; }
                    let Relative = Mine.PositionAge.xyz - Peer.PositionAge.xyz;
                    let DistanceSquared = dot(Relative, Relative);
                    if (DistanceSquared < 1e-10 || DistanceSquared > CutoffSquared) { continue; }
                    if (Behaviour == 3u)
                    {
                        let Clamped = max(DistanceSquared, 0.04 * σ * σ);
                        let Ratio2 = σ * σ / Clamped;
                        let Ratio6 = Ratio2 * Ratio2 * Ratio2;
                        let Magnitude = clamp(24.0 * ε * (2.0 * Ratio6 * Ratio6 - Ratio6) / Clamped, -ForceLimit, ForceLimit);
                        Force += Relative * Magnitude;
                    }
                    else
                    {
                        let Distance = sqrt(DistanceSquared);
                        if (Distance < σ) { Force += Relative / Distance * (σ - Distance) * 120.0; }
                        if (DistanceSquared < ReactionReachSquared)
                        {
                            let PeerSpecies = Peer.Appearance.w;
                            let Pairing = (Species < 0.5 && PeerSpecies > 0.5 && PeerSpecies < 1.5) || (Species > 0.5 && Species < 1.5 && PeerSpecies < 0.5);
                            if (Pairing && ResolveUniform(Stream) < Effect.Molecular.w * Step) { Species = 2.0; }
                        }
                    }
                }
            }
        }
    }
    if (Behaviour == 4u && Species > 1.5 && ResolveUniform(Stream) < Effect.MolecularLattice.w * Step)
    {
        Species = SelectBranch(0.0, 1.0, ResolveUniform(Stream) < 0.5);
    }
    var Velocity = Mine.VelocityLife.xyz;
    let ForceLength = length(Force);
    if (ForceLength > ForceLimit) { Force = Force * (ForceLimit / ForceLength); }
    Velocity += Force * Step;
    let γ = Effect.MolecularReach.y;
    Velocity *= max(0.0, 1.0 - γ * Step);
    let Temperature = Effect.Molecular.x;
    let Noise = float3(ResolveUniform(Stream), ResolveUniform(Stream), ResolveUniform(Stream)) - float3(0.5);
    Velocity += Noise * sqrt(24.0 * γ * Temperature * Step);
    let Speed = length(Velocity);
    if (Speed > 6.0) { Velocity *= 6.0 / Speed; }
    let Half = Effect.PhysicsBox.x;
    let Position = Mine.PositionAge.xyz + Velocity * Step;
    var Local = Position - Effect.Origin.xyz;
    let WallX = ResolveWallReflection(Local.x, Velocity.x, Half);
    let WallY = ResolveWallReflection(Local.y, Velocity.y, Half);
    let WallZ = ResolveWallReflection(Local.z, Velocity.z, Half);
    Local = float3(WallX.x, WallY.x, WallZ.x);
    Velocity = float3(WallX.y, WallY.y, WallZ.y);
    var Colour : float4;
    if (Behaviour == 3u)
    {
        Colour = lerp(Effect.ColourA, Effect.ColourB, clamp(length(Velocity) / 1.2, 0.0, 1.0));
    }
    else
    {
        Colour = SelectBranch(SelectBranch(Effect.ColourA, Effect.ColourB, Species > 0.5), Effect.ColourC, Species > 1.5);
    }
    let Size = σ * Effect.Miscellany.x;
    Particles[Lane] = ConstructParticle(float4(Effect.Origin.xyz + Local, Mine.PositionAge.w + Step), float4(Velocity, Mine.VelocityLife.w), Colour,
                                        float4(Size, Mine.Appearance.y, Mine.Appearance.z, Species), float4(0.0));
}
