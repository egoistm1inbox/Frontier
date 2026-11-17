//============================================================================================================================================
//                                                       LIGHTFIBRERASTERIZATION.SLANG
//============================================================================================================================================
// 🧩 Light fibres (the Strand Editor's streaks, ribbons and trails): each curve evaluated per vertex from the loop phase and drawn
//    as a pixel-wide glowing strip, with optional head sparks.

#pragma once
#include "ParticleLayouts.slang"

// 📝 A port of the FIBRE block of eos shaders.js. The constants are packed by ParticleUniformPacking.cpp (eos fillFibre).

struct LightFibreConstants
{
    float4 Origin;              // xyz [m] origin, w scale
    float4 Direction;           // xyz streak direction in local axes
    float4 Streak;              // x [m] length, y [m] spread, z [m] amplitude, w frequency
    float4 Sheet;               // x [m] sheet width, y ripple, z waves, w phase spread
    float4 Trail;               // x trail length, y loop fraction, z [px] thickness, w taper
    float4 Light;               // x intensity, y halo, z baseline, w light window
    float4 Accent;              // x accent mix, y pulse depth, z [px/m] projection scale at w = 1, w pixel scale
    float4 Pulse;               // x harmonic, y light heads per loop, z pulse rate per loop, w pulse shape
    float4 Layout;              // x shape (0 streak, 1 ribbon, 2 trail), y strands, z segments, w seed
    float4 Spark;               // x path samples, y spark share, z [m] spark size, w spark brightness
    float4 View;                // x [px] width, y [px] height, z stop count, w colour mode (0 solid, 1 ramp, 2 palette)
    float4 AccentColour;
    float4 StopColours[8];      // rgb
    float4 StopPositions[2];    // eight positions 0..1
};

  [[vk::binding(0, 0)]] ConstantBuffer<ParticleRefreshConstants> Refresh;
  [[vk::binding(0, 1)]] ConstantBuffer<LightFibreConstants>      Fibre;
  [[vk::binding(1, 1)]] StructuredBuffer<float4>                 FibrePath;

static const float FibreTau = 6.283185307;
static const float FibrePi = 3.14159265;

float ResolveFibreUnit(float Strand, float Salt)
{
    let Key = ToUnsigned(Strand) * 747796405u + ToUnsigned(Salt) * 2891336453u + ToUnsigned(Fibre.Layout.w) * 196613u;
    return float(HashUnsigned(Key)) * (1.0 / 4294967296.0);
}

float3 ResolveFibreAxis()
{
    let Heading = Fibre.Direction.xyz;
    return SelectBranch(float3(1.0, 0.0, 0.0), normalize(Heading), length(Heading) > 1e-5);
}

// 📝 Streak: a cubic Bézier from a root cluster to a reach, wobbling with the loop phase.
float3 ResolveBezier(float S, float Strand)
{
    let Length = Fibre.Streak.x;
    let Spread = Fibre.Streak.y;
    let Amplitude = Fibre.Streak.z;
    let Harmonics = max(1.0, floor(Fibre.Streak.w + 0.5));
    let Axis = ResolveFibreAxis();
    let Up = SelectBranch(float3(0.0, 1.0, 0.0), float3(0.0, 0.0, 1.0), abs(Axis.y) > 0.9);
    let Lateral = normalize(cross(Up, Axis));
    let Normal = cross(Axis, Lateral);
    let Angle = FibreTau * ResolveFibreUnit(Strand, 1.0);
    let Radius = Spread * sqrt(ResolveFibreUnit(Strand, 2.0));
    let Root = (Lateral * cos(Angle) + Normal * sin(Angle)) * Radius;
    let TipAngle = FibreTau * ResolveFibreUnit(Strand, 3.0);
    let TipRadius = Spread * 1.6 * sqrt(ResolveFibreUnit(Strand, 4.0));
    let Reach = Axis * Length + (Lateral * cos(TipAngle) + Normal * sin(TipAngle)) * TipRadius;
    let ωt = FibreTau * Fibre.Trail.y * Fibre.Pulse.x;
    let Control1 = Root + Axis * (Length * 0.34)
                 + (Lateral * sin(Harmonics * ωt + FibreTau * ResolveFibreUnit(Strand, 5.0))
                    + Normal * cos(2.0 * Harmonics * ωt + FibreTau * ResolveFibreUnit(Strand, 6.0))) * Amplitude;
    let Control2 = Reach - Axis * (Length * 0.34)
                 + (Lateral * sin(Harmonics * ωt + FibreTau * ResolveFibreUnit(Strand, 7.0))
                    + Normal * sin(2.0 * Harmonics * ωt + FibreTau * ResolveFibreUnit(Strand, 8.0))) * Amplitude;
    let U = 1.0 - S;
    return U * U * U * Root + 3.0 * U * U * S * Control1 + 3.0 * U * S * S * Control2 + S * S * S * Reach;
}

// 📝 Ribbon: a sheet of fibres across the sheet width, rippling in lift.
float3 ResolveWave(float S, float Strand)
{
    let Across = (Strand + 0.5) / Fibre.Layout.y - 0.5;
    let Along = (S - 0.5) * Fibre.Streak.x;
    let ωt = FibreTau * Fibre.Trail.y * Fibre.Pulse.x;
    let Lift = Fibre.Sheet.y * (sin(Along * Fibre.Sheet.z + ωt + Across * Fibre.Sheet.w * FibreTau) * 0.7
             + sin(Across * Fibre.Sheet.x * Fibre.Sheet.z * 0.5 - 2.0 * ωt + Along * 0.35) * 0.3);
    return float3(Along, Across * Fibre.Sheet.x, Lift);
}

float3 ResolvePathPoint(float Fraction)
{
    let Count = ToSigned(Fibre.Spark.x);
    let Position = frac(Fraction) * float(Count);
    let Index = clamp(ToSigned(floor(Position)), 0, Count - 1);
    let Next = SelectBranch(Index + 1, 0, Index + 1 >= Count);
    let Remainder = Position - float(Index);
    return lerp(FibrePath[Index].xyz, FibrePath[Next].xyz, Remainder);
}

float3 ResolvePathTangent(float Fraction)
{
    let Step = 1.0 / Fibre.Spark.x;
    let Span = ResolvePathPoint(Fraction + Step) - ResolvePathPoint(Fraction - Step);
    return SelectBranch(float3(1.0, 0.0, 0.0), normalize(Span), length(Span) > 1e-7);
}

// 📝 Trail: a bundle of fibres riding the path, each covering the trail length of the loop behind its head.
float3 ResolveTrail(float S, float Strand)
{
    let LoopFraction = Fibre.Trail.y;
    let Harmonic = Fibre.Pulse.x;
    let Head = frac(ResolveFibreUnit(Strand, 9.0) * Fibre.Sheet.w / FibreTau + LoopFraction * Harmonic);
    let Arc = frac(Head - Fibre.Trail.x * (1.0 - S));
    let Axis = ResolvePathTangent(Arc);
    let Side = normalize(cross(Axis, float3(0.0, 0.0, 1.0)));
    let Angle = FibreTau * ResolveFibreUnit(Strand, 3.0);
    let Radius = Fibre.Streak.y * sqrt(ResolveFibreUnit(Strand, 4.0));
    let Harmonics = max(1.0, floor(Fibre.Streak.w + 0.5));
    let Wobble = Fibre.Streak.z * S * sin(FibreTau * Harmonics * S + FibreTau * ResolveFibreUnit(Strand, 5.0) + FibreTau * LoopFraction * Harmonic);
    return ResolvePathPoint(Arc) + (Side * cos(Angle) + float3(0.0, 0.0, sin(Angle))) * Radius + Side * Wobble;
}

float3 ResolveFibreCurve(float S, float Strand)
{
    let Shape = ToSigned(Fibre.Layout.x);
    if (Shape == 2) { return ResolveTrail(S, Strand); }
    if (Shape == 1) { return ResolveWave(S, Strand); }
    return ResolveBezier(S, Strand);
}

// 📝 Local axes (path plane XY, lift Z) to the editor's Y-up world, then scaled and placed.
float3 ResolveFibreWorld(float3 Local)
{
    return Fibre.Origin.xyz + float3(Local.x, Local.z, Local.y) * Fibre.Origin.w;
}

float3 ResolveFibreWorldDirection(float3 Local)
{
    return float3(Local.x, Local.z, Local.y);
}

float ResolvePeriodicGap(float A, float B)
{
    let Gap = abs(frac(A) - frac(B));
    return min(Gap, 1.0 - Gap);
}

float ResolvePulseLevel(float Cycle)
{
    if (ToSigned(Fibre.Pulse.w) == 1)
    {
        let First = exp(-pow(ResolvePeriodicGap(Cycle, 0.10) / 0.045, 2.0));
        let Second = 0.55 * exp(-pow(ResolvePeriodicGap(Cycle, 0.27) / 0.055, 2.0));
        return clamp(First + Second, 0.0, 1.0);
    }
    return 0.5 - 0.5 * cos(FibreTau * Cycle);
}

// 📝 One front runs along the fibre once per cycle, then holds and fades. Edges ascend in every smoothstep.
float ResolveSweep(float Position, float Cycle)
{
    let Front = -0.03 + 1.06 * min(Cycle / 0.45, 1.0);
    let Done = smoothstep(1.0, 1.01, Front - 0.02);
    let Start = lerp(smoothstep(0.0, 0.04, Position), 1.0, Done);
    let Lit = Start * (1.0 - smoothstep(Front - 0.02, Front + 0.005, Position));
    let Offset = (Position - (Front - 0.012)) / 0.012;
    let Ridge = Start * exp(-0.5 * Offset * Offset) * smoothstep(0.0, 0.04, Cycle) * (1.0 - smoothstep(0.85, 1.0, Front - 0.012));
    let Hold = 1.0 - smoothstep(0.75, 1.0, Cycle);
    return clamp(Hold * clamp(0.65 * Lit + 0.35 * Ridge, 0.0, 1.0), 0.0, 1.0);
}

float ResolveFibrePulse(float Along)
{
    let Rate = Fibre.Pulse.z;
    let Depth = Fibre.Accent.y;
    let Shape = ToSigned(Fibre.Pulse.w);
    if (Rate == 0.0 || Depth <= 0.0) { return 1.0; }
    if (Shape == 3)
    {
        return 1.0 - Depth + Depth * ResolveSweep(Along, frac(Rate * Fibre.Trail.y));
    }
    let Phase = Rate * Fibre.Trail.y - SelectBranch(0.0, Along, Shape == 2);
    return 1.0 - Depth + Depth * ResolvePulseLevel(frac(Phase));
}

// 📝 Colour: solid uses stop 0; ramp blends the stops by position along the fibre; palette picks a stop per strand.
float ResolveStopPosition(uint Index)
{
    return Fibre.StopPositions[Index / 4u][Index % 4u];
}

float3 ResolveRamp(float Along)
{
    let Count = ToUnsigned(Fibre.View.z);
    if (Count <= 1u || Along <= ResolveStopPosition(0u)) { return Fibre.StopColours[0].xyz; }
    let Last = Fibre.StopColours[Count - 1u].xyz;
    for (var Index = 0u; Index + 1u < Count; Index++)
    {
        let Lower = ResolveStopPosition(Index);
        let Upper = ResolveStopPosition(Index + 1u);
        if (Along < Upper)
        {
            return lerp(Fibre.StopColours[Index].xyz, Fibre.StopColours[Index + 1u].xyz, clamp((Along - Lower) / max(Upper - Lower, 1e-5), 0.0, 1.0));
        }
    }
    return Last;
}

float3 ResolveFibreColour(float Along, float Strand)
{
    let Mode = ToUnsigned(Fibre.View.w);
    let Count = max(ToUnsigned(Fibre.View.z), 1u);
    if (Mode == 0u) { return Fibre.StopColours[0].xyz; }
    if (Mode == 2u)
    {
        let Index = min(ToUnsigned(ResolveFibreUnit(Strand, 14.0) * float(Count)), Count - 1u);
        return Fibre.StopColours[Index].xyz;
    }
    return ResolveRamp(Along);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   STRIPS
//------------------------------------------------------------------------------------------------------------------------

struct FibreVarying
{
    float4 Position : SV_Position;
    [[vk::location(0)]] float Along : LOCATION0;
    [[vk::location(1)]] float Across : LOCATION1;
    [[vk::location(2)]] float Strand : LOCATION2;
    [[vk::location(3)]] float σ : LOCATION3;
    [[vk::location(4)]] float Halo : LOCATION4;
    [[vk::location(5)]] float Fade : LOCATION5;
};

[shader("vertex")]
FibreVarying FibreVertex(uint VertexIndex : SV_VulkanVertexID)
{
    var Out : FibreVarying;
    let SegmentCount = ToUnsigned(Fibre.Layout.z);
    let Quad = VertexIndex / 6u;
    let Corner = VertexIndex - Quad * 6u;
    let StrandIndex = Quad / SegmentCount;
    let Segment = Quad - StrandIndex * SegmentCount;
    let AlongStep = SelectBranch(0.0, 1.0, Corner == 2u || Corner == 3u || Corner == 5u);
    let SideStep = SelectBranch(0.0, 1.0, Corner == 1u || Corner == 4u || Corner == 5u);
    let Strand = float(StrandIndex);
    let S = (float(Segment) + AlongStep) / float(SegmentCount);
    let Side = SideStep * 2.0 - 1.0;

    let Centre = ResolveFibreWorld(ResolveFibreCurve(S, Strand));
    let Ahead = ResolveFibreWorldDirection(ResolveFibreCurve(min(S + 0.002, 1.0), Strand));
    let Behind = ResolveFibreWorldDirection(ResolveFibreCurve(max(S - 0.002, 0.0), Strand));
    let Tangent = Ahead - Behind;
    var Lateral = cross(Tangent, Refresh.CameraPosition.xyz - Centre);
    let LateralLength = length(Lateral);
    Lateral = SelectBranch(float3(0.0, 1.0, 0.0), Lateral / LateralLength, LateralLength > 1e-7);

    // 📝 Filament and halo widths are in pixels, so a fibre keeps its width at any distance.
    let Clip = mul(float4(Centre, 1.0), Refresh.ViewProjection);
    let PixelsPerMetre = Fibre.Accent.z / max(Clip.w, 1e-3);
    let PixelScale = Fibre.Accent.w;
    let σPixels = max(0.8, Fibre.Trail.z * PixelScale) * 0.42466;
    let HaloPixels = max(2.4 * PixelScale, 2.0 * σPixels);
    let EnvelopePixels = 3.6 * HaloPixels;
    let Fade = lerp(1.0, pow(max(sin(FibrePi * S), 0.0), 0.5), Fibre.Trail.w);
    let World = Centre + Lateral * (Side * EnvelopePixels / max(PixelsPerMetre, 1e-6));
    Out.Position = mul(float4(World, 1.0), Refresh.ViewProjection);
    Out.Along = S;
    Out.Across = Side * EnvelopePixels;
    Out.Strand = Strand;
    Out.σ = σPixels;
    Out.Halo = HaloPixels;
    Out.Fade = Fade;
    return Out;
}

[shader("fragment")]
float4 FibreFragment(FibreVarying In) : SV_Target0
{
    let Filament = exp(-0.5 * In.Across * In.Across / (In.σ * In.σ));
    let Glow = Fibre.Light.y * exp(-0.5 * In.Across * In.Across / (In.Halo * In.Halo));
    let Head = frac(ResolveFibreUnit(In.Strand, 9.0) + Fibre.Pulse.y * Fibre.Trail.y);
    let Behind = frac(Head - In.Along);
    let Window = max(Fibre.Light.w, 1e-3);
    let Front = smoothstep(0.0, 0.05, Behind);
    let Streak = SelectBranch(0.0, pow(1.0 - Behind / Window, 2.0) * Front, Behind < Window);
    let Lit = Fibre.Light.z + (1.0 - Fibre.Light.z) * Streak;
    let Ends = smoothstep(0.0, 0.04, In.Along) * (1.0 - smoothstep(0.96, 1.0, In.Along));
    let Hue = ResolveFibreColour(In.Along, In.Strand);
    let Tint = lerp(Hue, Fibre.AccentColour.xyz, Fibre.Accent.x * ResolveFibreUnit(In.Strand, 12.0));
    let Vary = 0.4 + 0.9 * ResolveFibreUnit(In.Strand, 13.0);
    let Level = Fibre.Light.x * Vary * (Filament + Glow) * Lit * Ends * In.Fade * ResolveFibrePulse(In.Along);
    let Colour = Tint * Level;
    return float4(Colour, clamp(max(Colour.r, max(Colour.g, Colour.b)), 0.0, 1.0));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   HEAD SPARKS
//------------------------------------------------------------------------------------------------------------------------

// 📝 One small quad per fibre at its light head, sized in pixels like the Strand Editor's points.
struct SparkVarying
{
    float4 Position : SV_Position;
    [[vk::location(0)]] float2 Corner : LOCATION0;
    [[vk::location(1)]] float3 Colour : LOCATION1;
};

static const float2 SparkCorners[6] = { float2(-1.0, -1.0), float2(1.0, -1.0), float2(-1.0, 1.0),
                                        float2(1.0, -1.0), float2(1.0, 1.0), float2(-1.0, 1.0) };

[shader("vertex")]
SparkVarying FibreSparkVertex(uint VertexIndex : SV_VulkanVertexID)
{
    SparkVarying Out;
    Out.Position = float4(0.0, 0.0, 2.0, 1.0);
    Out.Corner = float2(0.0);
    Out.Colour = float3(0.0);
    let StrandIndex = VertexIndex / 6u;
    let Corner = VertexIndex - StrandIndex * 6u;
    if (StrandIndex >= ToUnsigned(Fibre.Layout.y)) { return Out; }
    let Strand = float(StrandIndex);
    if (ResolveFibreUnit(Strand, 11.0) > Fibre.Spark.y) { return Out; }
    let S = frac(ResolveFibreUnit(Strand, 9.0) + Fibre.Pulse.y * Fibre.Trail.y);
    let Centre = ResolveFibreWorld(ResolveFibreCurve(S, Strand));
    let Clip = mul(float4(Centre, 1.0), Refresh.ViewProjection);
    let Depth = max(Clip.w, 0.001);
    let SizePixels = clamp(Fibre.Spark.z * Fibre.Origin.w * Fibre.Accent.z / Depth, 1.0, 48.0);
    let Offset = SparkCorners[Corner];
    let Half = SizePixels * 0.5;
    let Ndc = float2(Offset.x * Half * 2.0 / Fibre.View.x, Offset.y * Half * 2.0 / Fibre.View.y);
    Out.Position = float4(Clip.xy + Ndc * Clip.w, Clip.z, Clip.w);
    Out.Corner = Offset;
    Out.Colour = ResolveFibreColour(S, Strand) * Fibre.Spark.w * (0.6 + 0.8 * ResolveFibreUnit(Strand, 10.0)) * ResolveFibrePulse(S);
    return Out;
}

[shader("fragment")]
float4 FibreSparkFragment(SparkVarying In) : SV_Target0
{
    let RadiusSquared = dot(In.Corner, In.Corner);
    let Disc = exp(-RadiusSquared * 7.0) * (1.0 - smoothstep(0.7, 1.0, RadiusSquared));
    let Colour = In.Colour * Disc;
    return float4(Colour, clamp(max(Colour.r, max(Colour.g, Colour.b)), 0.0, 1.0));
}
