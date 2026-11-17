//============================================================================================================================================
//                                                        PARTICLERASTERIZATION.SLANG
//============================================================================================================================================
// 🧩 The Particle editor's raster programs: particles in their seven appearances, cubes and their shards, butterflies, lightning,
//    the wind arrows, the floor grid and the guide lines.

#pragma once
#include "ParticleLayouts.slang"

// 📝 A port of the RENDER block of eos shaders.js. Group 0 is the refresh (constants, wind lattice); group 1 is one effect's
//    constants, its particles and the lightning segments.

  [[vk::binding(0, 0)]] ConstantBuffer<ParticleRefreshConstants> Refresh;
  [[vk::binding(1, 0)]] Texture3D<float4>                        WindLattice;
  [[vk::binding(2, 0)]] SamplerState                             WindSampler;
  [[vk::binding(0, 1)]] ConstantBuffer<ParticleEffectConstants>  Effect;
  [[vk::binding(1, 1)]] StructuredBuffer<Particle>               Particles;
  [[vk::binding(2, 1)]] StructuredBuffer<float4>                 Segments;   // two float4 per segment: (a, width), (b, intensity)

static const float2 QuadCorners[6] = { float2(-1.0, -1.0), float2(1.0, -1.0), float2(-1.0, 1.0),
                                       float2(1.0, -1.0), float2(1.0, 1.0), float2(-1.0, 1.0) };

// 📝 Off-screen: a vertex at depth 2 is clipped, the eos way of skipping a particle.
static const float4 ClippedPosition = float4(0.0, 0.0, 2.0, 1.0);

struct ParticleVarying
{
    float4 Position : SV_Position;
    [[vk::location(0)]] float2 Corner : LOCATION0;
    [[vk::location(1)]] float4 Colour : LOCATION1;
    [[vk::location(2)]] float4 Extra : LOCATION2;   // x progress, y seed, z [m] size
};

struct StripVarying
{
    float4 Position : SV_Position;
    [[vk::location(0)]] float Across : LOCATION0;      // −1 … 1 across the strip
    [[vk::location(1)]] float Intensity : LOCATION1;
};

struct GuideVarying
{
    float4 Position : SV_Position;
    [[vk::location(0)]] float4 Colour : LOCATION0;
};

ParticleVarying ConstructClippedParticle()
{
    ParticleVarying Out;
    Out.Position = ClippedPosition;
    Out.Corner = float2(0.0);
    Out.Colour = float4(0.0);
    Out.Extra = float4(0.0);
    return Out;
}

float HashPlane(float2 Point)
{
    return frac(sin(dot(Point, float2(127.1, 311.7))) * 43758.5453);
}

float ResolvePlaneNoise(float2 Point)
{
    let Cell = floor(Point);
    let Within = frac(Point);
    let U = Within * Within * (3.0 - 2.0 * Within);
    return lerp(lerp(HashPlane(Cell), HashPlane(Cell + float2(1.0, 0.0)), U.x),
                lerp(HashPlane(Cell + float2(0.0, 1.0)), HashPlane(Cell + float2(1.0, 1.0)), U.x), U.y);
}

float3 ResolveSeedAxis(float Seed)
{
    return normalize(float3(HashSeed(Seed, 1u) - 0.5, HashSeed(Seed, 2u) - 0.5, HashSeed(Seed, 3u) - 0.5) + float3(0.0, 0.0001, 0.0));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   PARTICLES
//------------------------------------------------------------------------------------------------------------------------

[shader("vertex")]
ParticleVarying ParticleVertex(uint VertexIndex : SV_VulkanVertexID, uint InstanceIndex : SV_VulkanInstanceID)
{
    var Out = ConstructClippedParticle();
    let Current = Particles[InstanceIndex];
    if (!(Current.PositionAge.w < Current.VelocityLife.w && Current.Colour.a > 0.002 && Current.Appearance.x > 0.0)) { return Out; }
    let Corner = QuadCorners[VertexIndex];
    let Size = Current.Appearance.x;
    let Shape = ToUnsigned(Effect.Release.z);
    var World : float3;
    if (Shape == 0u)
    {
        let Axis = normalize(Current.VelocityLife.xyz + float3(0.0, 0.0001, 0.0));
        let ToCamera = normalize(Refresh.CameraPosition.xyz - Current.PositionAge.xyz);
        var Side = cross(Axis, ToCamera);
        Side = Side / max(length(Side), 1e-4);
        let Length = Size * (1.0 + length(Current.VelocityLife.xyz) * 0.15);
        World = Current.PositionAge.xyz + Axis * (Corner.y * Length * 0.5) + Side * (Corner.x * Size * 0.5);
    }
    else if (Shape == 2u)
    {
        let Axis = ResolveSeedAxis(Current.Appearance.w);
        let Local = float3(Corner.x * Size * 0.5, Corner.y * Size * 0.3, 0.0);
        World = Current.PositionAge.xyz + RotateAboutAxis(Local, Axis, Current.Appearance.y);
    }
    else if (Shape == 5u)
    {
        // 📝 Coin: a disc in the plane of (cos a, 0, sin a) and up, so it flips edge-on as its spin angle turns.
        let Half = Size * 0.5;
        let Angle = Current.Appearance.y;
        let Upright = float3(Corner.x * Half * cos(Angle), Corner.y * Half, Corner.x * Half * sin(Angle));
        let Axis = ResolveSeedAxis(Current.Appearance.w);
        if (Current.Transition.w > 0.5)
        {
            // 📝 Stacked coins lie flat: a disc in the horizontal plane.
            World = Current.PositionAge.xyz + float3(Corner.x * Half * cos(Angle) - Corner.y * Half * sin(Angle), 0.0,
                                                     Corner.x * Half * sin(Angle) + Corner.y * Half * cos(Angle));
        }
        else
        {
            World = Current.PositionAge.xyz + RotateAboutAxis(Upright, Axis, 0.6 + HashSeed(Current.Appearance.w, 4u) * 0.8);
        }
    }
    else
    {
        World = Current.PositionAge.xyz + Refresh.CameraRight.xyz * (Corner.x * Size * 0.5) + Refresh.CameraUp.xyz * (Corner.y * Size * 0.5);
    }
    Out.Position = mul(float4(World, 1.0), Refresh.ViewProjection);
    Out.Corner = Corner;
    Out.Colour = Current.Colour;
    Out.Extra = float4(Current.PositionAge.w / Current.VelocityLife.w, Current.Appearance.w, Size, 0.0);
    return Out;
}

[shader("fragment")]
float4 ParticleFragment(ParticleVarying In) : SV_Target0
{
    let Shape = ToUnsigned(Effect.Release.z);
    var Colour = In.Colour.rgb;
    var Alpha = 1.0;
    if (Shape == 0u)
    {
        let X = abs(In.Corner.x);
        Alpha = pow(max(0.0, 1.0 - X), 2.0) * (1.0 - pow(abs(In.Corner.y), 3.0) * 0.5);
        Colour = lerp(Colour, float3(1.0), pow(max(0.0, 1.0 - X), 6.0) * 0.8);
    }
    else if (Shape == 1u)
    {
        let RadiusSquared = dot(In.Corner, In.Corner);
        if (RadiusSquared > 1.0) { discard; }
        let Normal = float3(In.Corner, sqrt(1.0 - RadiusSquared));
        let Light = normalize(float3(0.35, 0.55, 0.75));
        let Facing = max(dot(Normal, Light), 0.0);
        Colour = Colour * (0.3 + 0.7 * Facing) + float3(0.6) * pow(Facing, 16.0) * 0.35;
        Alpha = smoothstep(1.0, 0.85, sqrt(RadiusSquared));
    }
    else if (Shape == 2u)
    {
        if (Effect.Release.w > 0.5)
        {
            if (abs(In.Corner.y) > 0.6) { discard; }
            Colour = Colour * (0.85 + 0.15 * sin(In.Extra.y + In.Corner.x * 6.0));
        }
        else
        {
            let Ellipse = In.Corner.x * In.Corner.x + In.Corner.y * In.Corner.y * 2.8;
            if (Ellipse > 1.0) { discard; }
            let Vein = exp(-In.Corner.y * In.Corner.y * 300.0) * step(abs(In.Corner.x), 0.9);
            Colour = lerp(Colour, Colour * 0.55, Vein);
            Colour = Colour * (0.7 + 0.3 * sqrt(1.0 - Ellipse));
        }
    }
    else if (Shape == 6u)
    {
        // 📝 Bubble: a thin transparent film. Fresnel brightens the rim, a small highlight sits upper left, the body is clear.
        let RadiusSquared = dot(In.Corner, In.Corner);
        if (RadiusSquared > 1.0) { discard; }
        let Z = sqrt(1.0 - RadiusSquared);
        let Fresnel = pow(1.0 - Z, 3.0);
        let Light = normalize(float3(-0.4, 0.5, 0.75));
        let Highlight = pow(max(dot(float3(In.Corner, Z), Light), 0.0), 40.0);
        Colour = Colour * 0.35 + float3(0.85, 0.95, 1.0) * Fresnel + float3(1.0) * Highlight;
        Alpha = clamp(0.06 + 0.85 * Fresnel + 0.9 * Highlight, 0.0, 1.0) * smoothstep(1.0, 0.92, sqrt(RadiusSquared));
    }
    else if (Shape == 5u)
    {
        let Radius = length(In.Corner);
        if (Radius > 1.0) { discard; }
        let Rim = smoothstep(0.72, 1.0, Radius);
        Colour = Colour * (0.8 + 0.2 * (1.0 - Radius)) + float3(0.35) * Rim;
        Alpha = 1.0;
    }
    else
    {
        let Radius = length(In.Corner);
        if (Radius > 1.0) { discard; }
        let Noise = ResolvePlaneNoise(In.Corner * 2.5 + float2(In.Extra.y * 0.001, In.Extra.x * 3.0));
        Alpha = exp(-Radius * Radius * 3.5) * (0.6 + 0.8 * Noise) * (1.0 - Radius * Radius * 0.3);
        Alpha = clamp(Alpha, 0.0, 1.0);
    }
    let Coverage = clamp(Alpha * In.Colour.a, 0.0, 1.0);
    return float4(Colour * Coverage, Coverage);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   CUBES AND SHARDS
//------------------------------------------------------------------------------------------------------------------------

// 📝 36 vertices per cube, six faces, shaded by face normal: the cube particles and the derez shards.
struct CubeVarying
{
    float4 Position : SV_Position;
    [[vk::location(0)]] float4 Colour : LOCATION0;
    [[vk::location(1)]] float Shade : LOCATION1;
};

struct CubeCorner
{
    float3 Point;
    float3 Normal;
};

CubeVarying ConstructClippedCube()
{
    CubeVarying Out;
    Out.Position = ClippedPosition;
    Out.Colour = float4(0.0);
    Out.Shade = 0.0;
    return Out;
}

CubeCorner ResolveCubeCorner(uint VertexIndex)
{
    let Face = VertexIndex / 6u;
    let Axis = Face / 2u;
    let Side = SelectBranch(-1.0, 1.0, (Face % 2u) == 0u);
    let Corner = QuadCorners[VertexIndex % 6u];
    var Point = float3(0.0);
    Point[Axis] = 0.5 * Side;
    Point[(Axis + 1u) % 3u] = Corner.x * 0.5;
    Point[(Axis + 2u) % 3u] = Corner.y * 0.5;
    var Normal = float3(0.0);
    Normal[Axis] = Side;
    CubeCorner Resolved;
    Resolved.Point = Point;
    Resolved.Normal = Normal;
    return Resolved;
}

float ResolveCubeShade(float3 Normal)
{
    return 0.45 + 0.55 * max(dot(Normal, normalize(float3(0.35, 0.8, 0.45))), 0.0);
}

[shader("vertex")]
CubeVarying CubeVertex(uint VertexIndex : SV_VulkanVertexID, uint InstanceIndex : SV_VulkanInstanceID)
{
    var Out = ConstructClippedCube();
    let Current = Particles[InstanceIndex];
    if (!(Current.PositionAge.w < Current.VelocityLife.w && Current.Colour.a > 0.002 && Current.Appearance.x > 0.0)) { return Out; }
    // 📝 Morphing transitions: a piece is a cube only until its release time, then it becomes a butterfly.
    if (Effect.MolecularLattice.y > 0.5 && Current.PositionAge.w >= Current.Transition.x) { return Out; }
    let Corner = ResolveCubeCorner(VertexIndex);
    let Axis = ResolveSeedAxis(Current.Appearance.w);
    // 📝 Glitch: after release, each cube jumps in blocky steps, twelve a second.
    var Jitter = float3(0.0);
    if (Effect.MolecularLattice.x > 1.5 && Current.PositionAge.w >= Current.Transition.x)
    {
        let StepIndex = floor(Current.PositionAge.w * 12.0);
        Jitter = (float3(HashSeed(Current.Appearance.w + StepIndex, 5u), HashSeed(Current.Appearance.w + StepIndex, 6u),
                         HashSeed(Current.Appearance.w + StepIndex, 7u)) - float3(0.5)) * 0.12;
    }
    let World = Current.PositionAge.xyz + Jitter + RotateAboutAxis(Corner.Point * Current.Appearance.x, Axis, Current.Appearance.y);
    Out.Position = mul(float4(World, 1.0), Refresh.ViewProjection);
    Out.Colour = Current.Colour;
    Out.Shade = ResolveCubeShade(RotateAboutAxis(Corner.Normal, Axis, Current.Appearance.y));
    return Out;
}

// 📝 Derez shards: each derez cube that hit the floor splits into 8 half-size cubes that burst off the impact point, fall under
//    gravity, rest on the floor and fade. Shards are not particles and do not collide.
[shader("vertex")]
CubeVarying ShardVertex(uint VertexIndex : SV_VulkanVertexID)
{
    var Out = ConstructClippedCube();
    let Owner = VertexIndex / 288u;
    let Remainder = VertexIndex % 288u;
    let Shard = Remainder / 36u;
    let Current = Particles[Owner];
    if (Current.Transition.y <= 0.0 || Current.Appearance.x <= 0.0) { return Out; }
    let Since = Effect.Physics.y - (Current.Transition.y - 1.0);
    let Life = Effect.MolecularReach.w;
    if (Since < 0.0 || Since >= Life) { return Out; }
    let Edge = Current.Appearance.x * 0.5;
    let Seed = Current.Appearance.w + float(Shard) * 13.0;
    let Octant = float3(float(Shard & 1u), float((Shard >> 1u) & 1u), float((Shard >> 2u) & 1u)) * 2.0 - 1.0;
    let Hashed = float3(HashSeed(Seed, 1u), HashSeed(Seed, 2u), HashSeed(Seed, 3u));
    let Heading = normalize(Octant * 0.5 + (Hashed - 0.5) * 0.8 + float3(0.0, 0.9, 0.0));
    let Speed = lerp(1.2, 2.8, HashSeed(Seed, 4u));
    let g = -Effect.Speed.w * 9.81;
    var Centre = Current.PositionAge.xyz + float3(Octant.x * Edge * 0.5, 0.0, Octant.z * Edge * 0.5) + Heading * Speed * Since
               + float3(0.0, 0.5 * g * Since * Since, 0.0);
    Centre.y = max(Centre.y, Edge * 0.5);
    let Fade = 1.0 - smoothstep(0.6 * Life, Life, Since);
    let Axis = normalize(Hashed - 0.5 + float3(0.0, 0.0001, 0.0));
    let Angle = (HashSeed(Seed, 5u) - 0.5) * 8.0 * Since;
    let Corner = ResolveCubeCorner(VertexIndex % 36u);
    let World = Centre + RotateAboutAxis(Corner.Point * Edge, Axis, Angle);
    Out.Position = mul(float4(World, 1.0), Refresh.ViewProjection);
    Out.Colour = float4(Current.Colour.rgb, Current.Colour.a * Fade);
    Out.Shade = ResolveCubeShade(RotateAboutAxis(Corner.Normal, Axis, Angle));
    return Out;
}

[shader("fragment")]
float4 CubeFragment(CubeVarying In) : SV_Target0
{
    let Alpha = clamp(In.Colour.a, 0.0, 1.0);
    return float4(In.Colour.rgb * In.Shade * Alpha, Alpha);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   BUTTERFLIES
//------------------------------------------------------------------------------------------------------------------------

// 📝 Dissolve into butterflies: a released piece becomes a flapping two-pair silhouette facing the camera. The wings open and
//    close with cos(flap), foreshortening their width; the colour blends the effect's two colours per piece.
[shader("vertex")]
ParticleVarying ButterflyVertex(uint VertexIndex : SV_VulkanVertexID, uint InstanceIndex : SV_VulkanInstanceID)
{
    var Out = ConstructClippedParticle();
    let Current = Particles[InstanceIndex];
    if (Effect.MolecularLattice.y < 0.5) { return Out; }
    if (!(Current.PositionAge.w < Current.VelocityLife.w && Current.Colour.a > 0.002 && Current.Appearance.x > 0.0
          && Current.PositionAge.w >= Current.Transition.x)) { return Out; }
    let Corner = QuadCorners[VertexIndex];
    let Seed = Current.Appearance.w;
    let Age = Current.PositionAge.w;
    let Rate = 9.0 + 5.0 * HashSeed(Seed, 6u);
    let Flap = cos(Age * Rate + 6.2831853 * HashSeed(Seed, 7u));
    let WingWidth = 0.2 + 0.8 * abs(Flap);
    let Size = Current.Appearance.x * 5.0;
    let World = Current.PositionAge.xyz + Refresh.CameraRight.xyz * (Corner.x * Size * 0.5) + Refresh.CameraUp.xyz * (Corner.y * Size * 0.5);
    Out.Position = mul(float4(World, 1.0), Refresh.ViewProjection);
    Out.Corner = Corner;
    Out.Extra = float4(WingWidth, Flap, 0.0, 0.0);
    Out.Colour = float4(lerp(Effect.ColourA.rgb, Effect.ColourB.rgb, HashSeed(Seed, 8u)), Current.Colour.a);
    return Out;
}

[shader("fragment")]
float4 ButterflyFragment(ParticleVarying In) : SV_Target0
{
    let WingWidth = max(In.Extra.x, 0.15);
    let X = abs(In.Corner.x);
    let Unfolded = X / WingWidth;   // the wing unfolded by its foreshortening
    let Y = In.Corner.y;
    // 📝 Forewing: a large ellipse above the centre line. Hindwing: a smaller ellipse below.
    let Fore = length(float2((Unfolded - 0.5) / 0.5, (Y - 0.3) / 0.35));
    let Hind = length(float2((Unfolded - 0.4) / 0.36, (Y + 0.3) / 0.26));
    let Nearest = min(Fore, Hind);
    let Wing = 1.0 - smoothstep(0.85, 1.0, Nearest);
    let Body = (1.0 - smoothstep(0.03, 0.05, X)) * step(abs(Y), 0.6);
    if (Wing < 0.01 && Body < 0.01) { discard; }
    let Edge = 0.75 + 0.5 * (1.0 - min(Nearest, 1.0));
    let Colour = lerp(In.Colour.rgb * Edge, float3(0.08), Body);
    let Alpha = max(Wing, Body) * In.Colour.a;
    return float4(Colour * Alpha, Alpha);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   LIGHTNING AND ARROWS
//------------------------------------------------------------------------------------------------------------------------

static const float2 StripCorners[6] = { float2(0.0, -1.0), float2(1.0, -1.0), float2(0.0, 1.0),
                                        float2(1.0, -1.0), float2(1.0, 1.0), float2(0.0, 1.0) };

// 📝 A camera-facing strip from A to B, widths WidthA → WidthB; w carries the side (−1 … 1).
float4 ResolveStripCorner(float3 A, float3 B, float WidthA, float WidthB, uint VertexIndex)
{
    let Corner = StripCorners[VertexIndex];
    let Heading = normalize(B - A + float3(1e-6));
    let Middle = (A + B) * 0.5;
    let ToCamera = normalize(Refresh.CameraPosition.xyz - Middle);
    var Side = cross(Heading, ToCamera);
    Side = Side / max(length(Side), 1e-5);
    let Width = lerp(WidthA, WidthB, Corner.x);
    let Point = lerp(A, B, Corner.x) + Side * (Corner.y * Width);
    return float4(Point, Corner.y);
}

StripVarying ConstructClippedStrip()
{
    StripVarying Out;
    Out.Position = ClippedPosition;
    Out.Across = 0.0;
    Out.Intensity = 0.0;
    return Out;
}

// 📝 Lightning: each segment is two float4 in the segment store: (a, width), (b, intensity).
[shader("vertex")]
StripVarying LightningVertex(uint VertexIndex : SV_VulkanVertexID, uint InstanceIndex : SV_VulkanInstanceID)
{
    var Out = ConstructClippedStrip();
    let A = Segments[2u * InstanceIndex];
    let B = Segments[2u * InstanceIndex + 1u];
    if (B.w <= 0.0001) { return Out; }
    let Corner = ResolveStripCorner(A.xyz, B.xyz, A.w, A.w * 0.8, VertexIndex);
    Out.Position = mul(float4(Corner.xyz, 1.0), Refresh.ViewProjection);
    Out.Across = Corner.w;
    Out.Intensity = B.w;
    return Out;
}

[shader("fragment")]
float4 LightningFragment(StripVarying In) : SV_Target0
{
    let Across = In.Across;
    let Glow = exp(-Across * Across * 4.0);
    let Filament = exp(-Across * Across * 60.0);
    let Colour = (float3(0.35, 0.6, 1.0) * Glow * 0.9 + float3(1.0) * Filament) * In.Intensity;
    return float4(Colour, clamp(max(Colour.r, max(Colour.g, Colour.b)), 0.0, 1.0));
}

float3 ResolveArrowColour(float Level)
{
    let A = float3(0.15, 0.35, 1.0);
    let B = float3(0.2, 0.9, 0.9);
    let C = float3(1.0, 0.85, 0.2);
    let D = float3(1.0, 0.25, 0.15);
    if (Level < 0.33) { return lerp(A, B, Level / 0.33); }
    if (Level < 0.66) { return lerp(B, C, (Level - 0.33) / 0.33); }
    return lerp(C, D, (Level - 0.66) / 0.34);
}

// 📝 The wind lattice: one arrow per cell, read straight from the lattice; only every stride-th cell on each axis draws one.
[shader("vertex")]
StripVarying WindArrowVertex(uint VertexIndex : SV_VulkanVertexID, uint InstanceIndex : SV_VulkanInstanceID)
{
    var Out = ConstructClippedStrip();
    let CellsX = ToUnsigned(Refresh.WindDimensions.x);
    let CellsY = ToUnsigned(Refresh.WindDimensions.y);
    let X = InstanceIndex % CellsX;
    let Y = (InstanceIndex / CellsX) % CellsY;
    let Z = InstanceIndex / (CellsX * CellsY);
    let Stride = max(1u, ToUnsigned(Refresh.Swirl.w));
    if (X % Stride != 0u || Y % Stride != 0u || Z % Stride != 0u) { return Out; }
    let Velocity = LoadTexel(WindLattice, int3(ToSigned(X), ToSigned(Y), ToSigned(Z)), 0).xyz;
    let Magnitude = length(Velocity);
    if (Magnitude < 0.03) { return Out; }
    let Cell = Refresh.WindSize.xyz / Refresh.WindDimensions.xyz;
    let Point = Refresh.WindMinimum.xyz + (float3(float(X), float(Y), float(Z)) + 0.5) * Cell;
    let Heading = Velocity / Magnitude;
    let Level = clamp(Magnitude / Refresh.Visualization.x, 0.0, 1.0);
    let Length = min(Cell.x, Cell.z) * (0.3 + 0.8 * Level);
    let A = Point - Heading * Length * 0.5;
    let B = Point + Heading * Length * 0.5;
    let Corner = ResolveStripCorner(A, B, Refresh.Visualization.y * (0.6 + 0.4 * Level), Refresh.Visualization.y * 0.25, VertexIndex);
    Out.Position = mul(float4(Corner.xyz, 1.0), Refresh.ViewProjection);
    Out.Across = Corner.w;
    Out.Intensity = Level;
    return Out;
}

[shader("fragment")]
float4 WindArrowFragment(StripVarying In) : SV_Target0
{
    let Colour = ResolveArrowColour(In.Intensity) * (0.55 + 0.45 * (1.0 - abs(In.Across)));
    return float4(Colour * 0.55, 1.0);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   FLOOR AND GUIDES
//------------------------------------------------------------------------------------------------------------------------

[shader("vertex")]
ParticleVarying FloorVertex(uint VertexIndex : SV_VulkanVertexID)
{
    let Corner = QuadCorners[VertexIndex] * 60.0;
    var Out = ConstructClippedParticle();
    Out.Corner = Corner;
    Out.Position = mul(float4(Corner.x, 0.0, Corner.y, 1.0), Refresh.ViewProjection);
    return Out;
}

[shader("fragment")]
float4 FloorFragment(ParticleVarying In) : SV_Target0
{
    let Gap = abs(frac(In.Corner - 0.5) - 0.5) / fwidth(In.Corner);
    let Line = 1.0 - clamp(min(Gap.x, Gap.y), 0.0, 1.0);
    let Distance = length(In.Corner - Refresh.CameraPosition.xz);
    let Fade = exp(-Distance * 0.06);
    let Ground = float3(0.055, 0.058, 0.068);
    return float4(Ground + float3(0.19, 0.21, 0.25) * Line * Fade, 1.0);
}

[shader("vertex")]
GuideVarying GuideVertex([[vk::location(0)]] float3 Point : LOCATION0, [[vk::location(1)]] float4 Colour : LOCATION1)
{
    GuideVarying Out;
    Out.Position = mul(float4(Point, 1.0), Refresh.ViewProjection);
    Out.Colour = Colour;
    return Out;
}

[shader("fragment")]
float4 GuideFragment(GuideVarying In) : SV_Target0
{
    return float4(In.Colour.rgb * In.Colour.a, In.Colour.a);
}
