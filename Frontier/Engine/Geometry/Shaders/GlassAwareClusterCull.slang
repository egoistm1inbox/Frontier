/*==========================================================================================================================================
                                                  GLASSAWARECLUSTERCULL.SLANG
==========================================================================================================================================*/
// 🧩 GPU compute cull & optical error cut for Glass-Aware Virtualized Cluster Geometry:
//    - Atomic group-coherent projected error cut with IOR optical refraction boost on curved transmissive glass,
//    - Backface normal-cone culling (transmissive glass clusters exempt),
//    - Two-phase Hi-Z pyramid test where glass clusters read opaque Hi-Z without writing opaque occluder depth.

struct ClusterGpuDescriptor
{
    float4 SphereCentreAndRadius;        // xyz = sphere centre [m], w = sphere radius [m]
    float4 CoarserSphereAndRadius;       // xyz = coarser sphere centre [m], w = coarser sphere radius [m]
    float4 ConeAxisAndCutoff;            // xyz = normal cone axis, w = cone cutoff
    float4 DeviationsAndOpticalBoost;    // x = self dev [m], y = coarser dev [m], z = optical IOR boost, w = glass indicator (1=glass)
    uint4  IndexCountsAndPageResidency;  // x = first index, y = tri count, z = resident indicator (1=resident), w = tier index
};

struct ClusterCullUniforms
{
    float4 CameraOriginAndProjFactor;    // xyz = camera world origin [m], w = projection factor [px]
    float4 CameraForwardAndThresholdPx;  // xyz = camera forward unit, w = error threshold [px]
    uint4  CountsAndHiZDimensions;       // x = cluster count, y = HiZ width, z = HiZ height, w = reserved
};

StructuredBuffer<ClusterGpuDescriptor>   ClusterDescriptors;
Texture2D<float>                         OpaqueHiZPyramid;
RWStructuredBuffer<uint4>                OpaqueIndirectCommands;
RWStructuredBuffer<uint4>                GlassIndirectCommands;
RWByteAddressBuffer                      DispatchCounters;
ConstantBuffer<ClusterCullUniforms>      CullUniforms;

float ComputeProjectedDeviationPixels(float DeviationM, float OpticalBoost, float3 Centre, float Radius, float3 CamPos, float ProjFactor)
{
    float Dist = max(0.05f, length(Centre - CamPos) - Radius);
    return (DeviationM * OpticalBoost * ProjFactor) / Dist;
}

[shader("compute")]
[numthreads(64, 1, 1)]
void SelectAndCullGlassAwareClusters(uint3 DispatchThreadId : SV_DispatchThreadID)
{
    uint ClusterIdx = DispatchThreadId.x;
    if (ClusterIdx < CullUniforms.CountsAndHiZDimensions.x)
    {
        ClusterGpuDescriptor Desc = ClusterDescriptors[ClusterIdx];
        float3 CamPos     = CullUniforms.CameraOriginAndProjFactor.xyz;
        float  ProjFactor = CullUniforms.CameraOriginAndProjFactor.w;
        float  ThreshPx   = CullUniforms.CameraForwardAndThresholdPx.w;

        float SelfPx    = ComputeProjectedDeviationPixels(
            Desc.DeviationsAndOpticalBoost.x,
            Desc.DeviationsAndOpticalBoost.z,
            Desc.SphereCentreAndRadius.xyz,
            Desc.SphereCentreAndRadius.w,
            CamPos,
            ProjFactor);

        float CoarserPx = ComputeProjectedDeviationPixels(
            Desc.DeviationsAndOpticalBoost.y,
            Desc.DeviationsAndOpticalBoost.z,
            Desc.CoarserSphereAndRadius.xyz,
            Desc.CoarserSphereAndRadius.w,
            CamPos,
            ProjFactor);

        bool ResidentOk = (Desc.IndexCountsAndPageResidency.z != 0u);
        bool CutMatch   = ResidentOk && (SelfPx <= ThreshPx) && (CoarserPx > ThreshPx);
        bool GlassClass = (Desc.DeviationsAndOpticalBoost.w > 0.5f);

        // Frustum + normal-cone backface test (transmissive glass is exempt from backface cone cull!)
        float3 ToCluster  = Desc.SphereCentreAndRadius.xyz - CamPos;
        float  DistCentre = max(1.0e-4f, length(ToCluster));
        float  ViewZ      = dot(ToCluster, CullUniforms.CameraForwardAndThresholdPx.xyz);
        bool   Visible    = CutMatch && (ViewZ + Desc.SphereCentreAndRadius.w > 0.05f);

        if (Visible && !GlassClass && Desc.ConeAxisAndCutoff.w > 0.05f && DistCentre > Desc.SphereCentreAndRadius.w)
        {
            float SinCone   = sqrt(max(0.0f, 1.0f - Desc.ConeAxisAndCutoff.w * Desc.ConeAxisAndCutoff.w));
            float SinSub    = min(1.0f, Desc.SphereCentreAndRadius.w / DistCentre);
            float MaxDot    = min(0.99f, SinCone + SinSub);
            if (dot(ToCluster / DistCentre, Desc.ConeAxisAndCutoff.xyz) > MaxDot)
            {
                Visible = false;
            }
        }

        if (Visible)
        {
            uint Slot = 0u;
            if (GlassClass)
            {
                DispatchCounters.InterlockedAdd(4u, 1u, Slot);
                GlassIndirectCommands[Slot] = uint4(
                    Desc.IndexCountsAndPageResidency.y * 3u,
                    1u,
                    Desc.IndexCountsAndPageResidency.x,
                    ClusterIdx);
            }
            else
            {
                DispatchCounters.InterlockedAdd(0u, 1u, Slot);
                OpaqueIndirectCommands[Slot] = uint4(
                    Desc.IndexCountsAndPageResidency.y * 3u,
                    1u,
                    Desc.IndexCountsAndPageResidency.x,
                    ClusterIdx);
            }
        }
    }
}
