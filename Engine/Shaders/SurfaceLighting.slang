//============================================================================================================================================
//                                                   SURFACELIGHTING.SLANG
//============================================================================================================================================
// 🧩 GPU Blinn-Phong lighting, ordered facet matcap layers, and filtered directional-shadow visibility

struct SurfaceAppearanceGpu
{
    float4 DiffuseReflectanceLayerOpacity;
    float4 SpecularReflectanceMatcapOpacity;
    float  GlossExponent;
    float  ShadowInfluence;
    uint   MatcapImageIndex;
    uint   MatcapStackMethodIndex;
    uint   LayerStackMethodIndex;
    uint3  Padding;
};

struct SurfaceFacetAppearanceGpu
{
    uint FirstLayerIndex;
    uint LayerCount;
    uint2 Padding;
};

struct SurfaceLightingFragmentReading
{
    float4 ProjectedPosition   : SV_Position;
    float3 NormalInViewSpace   : TEXCOORD0;
    float3 ViewerVector        : TEXCOORD1;
    float3 LightVector         : TEXCOORD2;
    float4 ShadowCoordinate    : TEXCOORD3;
};

StructuredBuffer<SurfaceAppearanceGpu>      SurfaceAppearanceSequence;
StructuredBuffer<SurfaceFacetAppearanceGpu> SurfaceFacetAppearanceSequence;
StructuredBuffer<uint>                      LayerIdentifierSequence;
Texture2D<float4>                            MatcapImageSequence[];
Texture2D<float>                             DirectionalShadowDepth;
SamplerState                                 MatcapLinearSampler;
SamplerComparisonState                       DirectionalShadowComparison;

cbuffer SurfaceLightingRasterizationUniforms
{
    float3 AmbientIlluminance;
    float3 DirectionalIlluminance;
    float2 DirectionalShadowTexelSize;
    uint   MatcapImageCount;
    float  DirectionalShadowBias;
};

float3 NormalizeOrForward(float3 Vector)
{
    const float SquaredLength = dot(Vector, Vector);
    return SquaredLength > 0.000000000001f ? Vector * rsqrt(SquaredLength) : float3(0.0f, 0.0f, 1.0f);
}

float3 StackColour(float3 Accumulated, float3 Foreground, float Opacity, uint MethodIndex)
{
    const float ClampedOpacity = saturate(Opacity);
    if (MethodIndex == 1u)
    {
        return Accumulated + Foreground * ClampedOpacity;
    }
    if (MethodIndex == 2u)
    {
        return Accumulated * lerp(float3(1.0f, 1.0f, 1.0f), Foreground, ClampedOpacity);
    }
    return lerp(Accumulated, Foreground, ClampedOpacity);
}

float2 ConstructMatcapTextureCoordinate(float3 NormalInViewSpace)
{
    const float3 Normal = NormalizeOrForward(NormalInViewSpace);
    const float Denominator = 2.0f * sqrt(max(0.0001f, Normal.z + 1.0f));
    return saturate(Normal.xy / Denominator + 0.5f);
}

float QueryDirectionalShadowVisibility(float4 ShadowCoordinate)
{
    const float3 ShadowPosition = ShadowCoordinate.xyz / max(0.00001f, ShadowCoordinate.w);
    if (ShadowPosition.x <= 0.0f || ShadowPosition.x >= 1.0f || ShadowPosition.y <= 0.0f || ShadowPosition.y >= 1.0f ||
        ShadowPosition.z <= 0.0f || ShadowPosition.z >= 1.0f)
    {
        return 1.0f;
    }

    float FilteredVisibility = 0.0f;
    for (int OffsetY = -1; OffsetY <= 0; ++OffsetY)
    {
        for (int OffsetX = -1; OffsetX <= 0; ++OffsetX)
        {
            const float2 Offset = float2(float(OffsetX), float(OffsetY)) * DirectionalShadowTexelSize;
            FilteredVisibility += DirectionalShadowDepth.SampleCmpLevelZero(
                DirectionalShadowComparison,
                ShadowPosition.xy + Offset,
                ShadowPosition.z - DirectionalShadowBias);
        }
    }
    return FilteredVisibility * 0.25f;
}

float3 EvaluateAppearanceRadiance(
    SurfaceAppearanceGpu Appearance,
    float3               Normal,
    float3               Viewer,
    float3               Light,
    float                ShadowVisibility)
{
    const float LambertTerm = saturate(dot(Normal, Light));
    const float DirectVisibility = lerp(1.0f, ShadowVisibility, saturate(Appearance.ShadowInfluence));
    const float GlossExponent = clamp(Appearance.GlossExponent, 1.0f, 1024.0f);
    const float3 HalfVector = NormalizeOrForward(Light + Viewer);
    const float BlinnTerm = LambertTerm > 0.0f ? pow(saturate(dot(Normal, HalfVector)), GlossExponent) : 0.0f;
    const float BlinnNormalization = (GlossExponent + 8.0f) / (8.0f * 3.14159265359f);
    const float3 DiffuseRadiance = Appearance.DiffuseReflectanceLayerOpacity.rgb *
        (AmbientIlluminance + DirectionalIlluminance * LambertTerm * DirectVisibility);
    const float3 SpecularRadiance = Appearance.SpecularReflectanceMatcapOpacity.rgb *
        (DirectionalIlluminance * BlinnTerm * BlinnNormalization * DirectVisibility);
    float3 AppearanceRadiance = DiffuseRadiance + SpecularRadiance;

    if (Appearance.MatcapImageIndex < MatcapImageCount && Appearance.SpecularReflectanceMatcapOpacity.a > 0.0f)
    {
        const float2 MatcapCoordinate = ConstructMatcapTextureCoordinate(Normal);
        const float3 MatcapColour = MatcapImageSequence[Appearance.MatcapImageIndex].SampleLevel(
            MatcapLinearSampler,
            MatcapCoordinate,
            0.0f).rgb;
        AppearanceRadiance = StackColour(
            AppearanceRadiance,
            MatcapColour,
            Appearance.SpecularReflectanceMatcapOpacity.a,
            Appearance.MatcapStackMethodIndex);
    }

    return AppearanceRadiance;
}

[shader("fragment")]
float4 SurfaceLightingRasterization(
    SurfaceLightingFragmentReading Fragment,
    uint                           FacetIndex : SV_PrimitiveID) : SV_Target
{
    const SurfaceFacetAppearanceGpu FacetAppearance = SurfaceFacetAppearanceSequence[FacetIndex];
    const float3 Normal = NormalizeOrForward(Fragment.NormalInViewSpace);
    const float3 Viewer = NormalizeOrForward(Fragment.ViewerVector);
    const float3 Light = NormalizeOrForward(Fragment.LightVector);
    const float ShadowVisibility = QueryDirectionalShadowVisibility(Fragment.ShadowCoordinate);
    float3 SurfaceRadiance = float3(0.0f, 0.0f, 0.0f);

    for (uint LayerOffset = 0u; LayerOffset < FacetAppearance.LayerCount; ++LayerOffset)
    {
        const uint AppearanceIdentifier = LayerIdentifierSequence[FacetAppearance.FirstLayerIndex + LayerOffset];
        const SurfaceAppearanceGpu Appearance = SurfaceAppearanceSequence[AppearanceIdentifier];
        const float3 AppearanceRadiance = EvaluateAppearanceRadiance(
            Appearance,
            Normal,
            Viewer,
            Light,
            ShadowVisibility);
        const uint LayerMethod = LayerOffset == 0u ? 0u : Appearance.LayerStackMethodIndex;
        SurfaceRadiance = StackColour(
            SurfaceRadiance,
            AppearanceRadiance,
            Appearance.DiffuseReflectanceLayerOpacity.a,
            LayerMethod);
    }

    return float4(SurfaceRadiance, 1.0f);
}
