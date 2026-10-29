//==========================================================================================================================================
//                                                        PRECIPITATIONOPTICS.SLANG
//==========================================================================================================================================
// 🧩 GPU Vulkan Slang precipitation optics: rain streaks, helical snow flutter + surface snow cover, and ballistic rebounding hailstones.

struct PrecipitationFootprint
{
    float4 VolumeAndSpeed;     // x extent [m], y height [m], z fall speed [m/s], w intensity [0..1]
    float4 WindAndFlutter;     // xy wind [m/s], z flutter amp [m], w flutter freq [Hz]
    float4 HailAndSnow;        // x hail restitution, y ground Z [m], z snow depth [m], w time [s]
    float4 AnchorAndSpecies;   // xyz camera/vehicle anchor [m], w species (0=Clear,1=Rain,2=Snow,3=Hail)
    float4 SunDirection;       // xyz sun dir, w shutter seconds
    float4 SunAndSky;          // rgb sky+sun base tint, w particle count
};

struct PrecipitationRayInput
{
    float4 RayOriginMaxDist;   // xyz ray origin, w opaque hit distance [m]
    float4 RayDirection;       // xyz unit ray direction, w = 0
};

[[vk::binding(0, 0)]] ConstantBuffer<PrecipitationFootprint> Weather;
[[vk::binding(1, 0)]] StructuredBuffer<PrecipitationRayInput> Rays;
[[vk::binding(2, 0)]] RWStructuredBuffer<float4>              OutPrecipitationRgba;

uint HashWeather(uint Index, uint Salt)
{
    uint H = Index * 747796405u + Salt * 2891336453u + 0x9A17u;
    H = ((H >> ((H >> 28u) + 4u)) ^ H) * 277803737u;
    return H ^ (H >> 22u);
}

float WrapPositive(float Value, float Extent)
{
    float R = fmod(Value, Extent);
    return (R < 0.0) ? (R + Extent) : R;
}

float EvaluateSnowSurfaceBlanket(float3 WorldPos, float3 WorldNormal, float SnowDepthM)
{
    if (SnowDepthM <= 1.0e-5 || WorldNormal.z <= 0.18) return 0.0;
    float UpAlign = saturate((WorldNormal.z - 0.18) / 0.82);
    float Ripple  = 0.86 + 0.14 * sin(WorldPos.x * 0.37 + WorldPos.y * 0.23) * cos(WorldPos.x * 0.19 - WorldPos.y * 0.41);
    return saturate(UpAlign * UpAlign * (1.0 - exp(-SnowDepthM * 34.0 * Ripple)));
}

[shader("compute")]
[numthreads(64, 1, 1)]
void EvaluatePrecipitationRays(uint3 ThreadId : SV_DispatchThreadID)
{
    uint RayCount, RayStride;
    Rays.GetDimensions(RayCount, RayStride);
    if (ThreadId.x >= RayCount) return;

    uint Species = uint(round(Weather.AnchorAndSpecies.w));
    if (Species == 0u || Weather.VolumeAndSpeed.w <= 1.0e-4)
    {
        OutPrecipitationRgba[ThreadId.x] = float4(0.0, 0.0, 0.0, 0.0);
        return;
    }

    float3 Origin  = Rays[ThreadId.x].RayOriginMaxDist.xyz;
    float  MaxDist = Rays[ThreadId.x].RayOriginMaxDist.w;
    float3 Dir     = normalize(Rays[ThreadId.x].RayDirection.xyz);

    uint  Count = min(uint(Weather.SunAndSky.w), 512u);
    float E     = Weather.VolumeAndSpeed.x;
    float H     = Weather.VolumeAndSpeed.y;
    float TimeS = Weather.HailAndSnow.w;

    float3 AccumRadiance = float3(0.0, 0.0, 0.0);
    float  AccumAlpha    = 0.0;

    // Single-exit loop over analytical hydrometeors for clean Subzero SPIR-V compilation.
    [loop]
    for (uint I = 0u; I < Count; ++I)
    {
        float U0 = float(HashWeather(I, 0u) & 0x00FFFFFFu) * (1.0 / 16777215.0);
        float U1 = float(HashWeather(I, 1u) & 0x00FFFFFFu) * (1.0 / 16777215.0);
        float U2 = float(HashWeather(I, 2u) & 0x00FFFFFFu) * (1.0 / 16777215.0);
        float U3 = float(HashWeather(I, 3u) & 0x00FFFFFFu) * (1.0 / 16777215.0);

        float  Fall = Weather.VolumeAndSpeed.z * (0.8 + 0.4 * U3);
        float3 BaseV = float3(Weather.WindAndFlutter.xy, -Fall);

        float3 Pos = float3(
            Weather.AnchorAndSpecies.x - 0.5 * E + WrapPositive(U0 * E + BaseV.x * TimeS - Weather.AnchorAndSpecies.x + 0.5 * E, E),
            Weather.AnchorAndSpecies.y - 0.5 * E + WrapPositive(U1 * E + BaseV.y * TimeS - Weather.AnchorAndSpecies.y + 0.5 * E, E),
            Weather.HailAndSnow.y + WrapPositive(U2 * H + BaseV.z * TimeS, H));
        float3 Vel = BaseV;
        float  Radius = 0.002;

        if (Species == 2u)
        {
            float Omega = 6.2831853 * Weather.WindAndFlutter.w * (0.72 + 0.56 * U2);
            float Amp   = Weather.WindAndFlutter.z * (0.55 + 0.70 * U1);
            Pos.x += Amp * cos(Omega * TimeS + 6.2831853 * U0);
            Pos.y += Amp * sin(1.31 * Omega * TimeS + 10.6814 * U0);
            Radius = 0.016 + 0.010 * U3;
        }
        else if (Species == 3u)
        {
            float FallTime  = H / max(Fall, 0.5);
            float Restit    = Weather.HailAndSnow.x * (0.85 + 0.30 * U2);
            float ReboundVz = Fall * Restit;
            float BounceT   = (Restit > 0.02) ? (2.0 * ReboundVz / 9.81) : 0.0;
            float Cycle     = FallTime + BounceT;
            float Phase     = WrapPositive(U2 * Cycle + TimeS, Cycle);
            float Tb        = max(0.0, Phase - FallTime);
            bool  Bouncing  = (Phase > FallTime);
            Pos.z = Bouncing
                ? (Weather.HailAndSnow.y + max(0.0, ReboundVz * Tb - 0.5 * 9.81 * Tb * Tb))
                : (Weather.HailAndSnow.y + Fall * (FallTime - Phase));
            Radius = 0.014 + 0.008 * U3;
        }
        else
        {
            Radius = 0.009 + 0.005 * U3;
        }

        float3 ToP   = Pos - Origin;
        float  Along = dot(ToP, Dir);
        bool   Valid = (Along > 0.35 && Along < MaxDist);
        float3 Perp  = ToP - Dir * Along;
        float  Streak = max(length(Vel) * Weather.SunDirection.w, Radius);
        float3 VDir  = normalize(Vel);
        float  ParV  = dot(Perp, VDir);
        float3 LatV  = Perp - VDir * ParV;
        float  Dist2 = dot(LatV, LatV) / (Radius * Radius) + (ParV * ParV) / (Streak * Streak);
        float  Hit   = Valid ? exp(-0.5 * Dist2) : 0.0;

        float3 Tint = (Species == 2u) ? float3(0.92, 0.95, 1.00)
                    : (Species == 3u) ? float3(0.84, 0.92, 1.00)
                                      : float3(0.72, 0.82, 0.96);
        AccumRadiance += Weather.SunAndSky.xyz * Tint * (Hit * 0.22);
        AccumAlpha     = saturate(AccumAlpha + Hit * 0.16);
    }

    OutPrecipitationRgba[ThreadId.x] = float4(AccumRadiance, AccumAlpha);
}
