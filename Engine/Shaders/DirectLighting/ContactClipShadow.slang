/*============================================================================================================================================
                                                           CONTACTCLIPSHADOW.SLANG
============================================================================================================================================*/
// 🧩 GTX Tier 1 Calibrated 2-Cascade Orthographic Contact Clip + Vogel PCSS Blocker Search (Zero SDF Shadows!)

module ContactClipShadow;

struct ContactClipUniforms
{
    float3 CascadeCenter;
    float  HalfSpanMeters;
    float3 LightRight;
    float  DepthExtentMeters;
    float3 LightUp;
    float  TanSunAngularRadius;
    float3 LightForward;
    uint   CascadeResolution;
    float3 SdfBoundsMin;
    float  SdfVoxelSpacing;
    float3 SdfBoundsMax;
    uint   ViewportWidth;
    uint   ViewportHeight;
    uint3  ReservedPad;
};

[[vk::binding(0, 0)]] ConstantBuffer<ContactClipUniforms> ClipUniforms;
[[vk::binding(1, 0)]] Texture2D<float>                    FineCascadeDepth;
[[vk::binding(2, 0)]] Texture3D<float>                    GlobalSignedDistanceTex; // Reserved for Diffuse GI
[[vk::binding(3, 0)]] SamplerState                        LinearClampSampler;
[[vk::binding(4, 0)]] Texture2D<float4>                   WorldPositionTex;
[[vk::binding(5, 0)]] Texture2D<float4>                   WorldNormalTex;
[[vk::binding(6, 0)]] RWTexture2D<float2>                 OutShadowBlocker;

[shader("compute")]
[numthreads(8, 8, 1)]
void ContactClipComputeEntry(uint3 DispatchThreadID : SV_DispatchThreadID)
{
    if (DispatchThreadID.x >= ClipUniforms.ViewportWidth || DispatchThreadID.y >= ClipUniforms.ViewportHeight)
    {
        return;
    }

    float4 PosSample = WorldPositionTex.Load(int3(DispatchThreadID.xy, 0));
    float3 Nrm       = normalize(WorldNormalTex.Load(int3(DispatchThreadID.xy, 0)).xyz);
    if (PosSample.w <= 0.0)
    {
        OutShadowBlocker[DispatchThreadID.xy] = float2(1.0, 0.0);
        return;
    }

    float3 SunDir = -ClipUniforms.LightForward;
    float  NdotL  = dot(Nrm, SunDir);
    if (NdotL <= 1.0e-5)
    {
        OutShadowBlocker[DispatchThreadID.xy] = float2(0.0, 0.0);
        return;
    }

    float3 BiasedPos = PosSample.xyz + Nrm * 3.5e-3;
    float3 Rel       = BiasedPos - ClipUniforms.CascadeCenter;
    float  LocalU    = dot(Rel, ClipUniforms.LightRight);
    float  LocalV    = dot(Rel, ClipUniforms.LightUp);
    float  LocalZ    = dot(Rel, ClipUniforms.LightForward);

    if (abs(LocalU) > ClipUniforms.HalfSpanMeters * 0.98 || abs(LocalV) > ClipUniforms.HalfSpanMeters * 0.98)
    {
        OutShadowBlocker[DispatchThreadID.xy] = float2(1.0, 0.0);
        return;
    }

    float ResF     = float(ClipUniforms.CascadeResolution);
    float InvSpan2 = 1.0 / (2.0 * ClipUniforms.HalfSpanMeters);
    float2 TexC    = float2((LocalU + ClipUniforms.HalfSpanMeters) * InvSpan2 * ResF,
                            (ClipUniforms.HalfSpanMeters - LocalV) * InvSpan2 * ResF);
    float RecvD    = LocalZ + ClipUniforms.DepthExtentMeters;
    float BiasM    = (2.0 * ClipUniforms.HalfSpanMeters / ResF) * 1.8;

    // ContactClip Vogel PCSS Blocker Search & Continuous Penumbra Filtering (Zero SDF Shadows!)
    float LitSum  = 0.0;
    float BlkSum  = 0.0;
    uint  BlkCnt  = 0u;
    [unroll]
    for (uint Tap = 0u; Tap < 12u; ++Tap)
    {
        float R   = sqrt((float(Tap) + 0.5) / 12.0) * 1.85;
        float Ang = float(Tap) * 2.39996323;
        int2  TC  = clamp(int2(TexC + float2(cos(Ang), sin(Ang)) * R), int2(0), int2(int(ClipUniforms.CascadeResolution) - 1));
        float CD  = FineCascadeDepth.Load(int3(TC, 0));
        float Df  = RecvD - CD;
        if (Df > BiasM) { BlkSum += Df; ++BlkCnt; }
        else { LitSum += 1.0; }
    }

    float ClipVis  = LitSum / 12.0;
    float BlockerD = (BlkCnt > 0u) ? (BlkSum / float(BlkCnt)) : 0.0;
    OutShadowBlocker[DispatchThreadID.xy] = float2(ClipVis, BlockerD);
}
