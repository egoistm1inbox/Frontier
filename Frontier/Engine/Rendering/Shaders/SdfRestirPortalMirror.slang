/*==========================================================================================================================================
                                                 SDFRESTIRPORTALMIRROR.SLANG
==========================================================================================================================================*/
// 🧩 Dual-tier GTX SDF + SurfaceCards and RTX BVH ReSTIR shader with Portals, Planar Mirrors, and volumetric cloud/fog/plume reflections.

struct PortalMirrorUniforms
{
    int4   Counts;          // x = BoxCount, y = MirrorCount, z = PortalCount, w = MaxBounces
    int4   ViewportAndTier; // x = Width, y = Height, z = Tier (0=GTX_SDF, 1=RTX_BVH), w = RestirK
    float4 CameraOrigin;    // xyz = Origin, w = TanHalfFov
    float4 CameraForward;   // xyz = Forward, w = Aspect
    float4 CameraRight;     // xyz = Right, w = FogDensity
    float4 CameraUp;        // xyz = Up, w = FogScaleHeight
    float4 SunDirAndPower;  // xyz = SunDir, w = SunIntensity
    float4 PlumeBoxMin;     // xyz = PlumeBoundsMin, w = PlumeDensityGain
    float4 PlumeBoxMax;     // xyz = PlumeBoundsMax, w = CloudCoverage
};

struct GpuSdfCardBox
{
    float4 CentreAndRough;  // xyz = Centre, w = Roughness
    float4 HalfExtents;     // xyz = HalfExtents, w = pad
    float4 AlbedoRgb;       // xyz = Albedo, w = pad
    float4 CardExitantPosZ; // xyz = +Z cached card exitant radiance
};

struct GpuMirrorRecord
{
    float4 CentreAndHalfW;  // xyz = Centre, w = HalfWidth
    float4 RightAndHalfH;   // xyz = Right, w = HalfHeight
    float4 UpAxis;          // xyz = Up
    float4 FrontAndRefl;    // xyz = FrontNormal, w = Reflectivity
};

struct GpuPortalRecord
{
    float4 EntryCentreW;    // xyz = EntryCentre, w = HalfWidth
    float4 EntryRightH;     // xyz = EntryRight, w = HalfHeight
    float4 EntryUp;         // xyz = EntryUp
    float4 EntryNormal;     // xyz = EntryNormal
    float4 ExitCentre;      // xyz = ExitCentre
    float4 ExitRight;       // xyz = ExitRight
    float4 ExitUp;          // xyz = ExitUp
    float4 ExitNormal;      // xyz = ExitNormal
};

[[vk::binding(0, 0)]] ConstantBuffer<PortalMirrorUniforms> Uniforms;
[[vk::binding(1, 0)]] StructuredBuffer<GpuSdfCardBox>      SdfBoxes;
[[vk::binding(2, 0)]] StructuredBuffer<GpuMirrorRecord>    Mirrors;
[[vk::binding(3, 0)]] StructuredBuffer<GpuPortalRecord>    Portals;
[[vk::binding(4, 0)]] RWStructuredBuffer<float4>           OutRadianceRgba;

float BoxSignedDistance(float3 P, float3 Centre, float3 HalfExt)
{
    float3 Q = abs(P - Centre) - HalfExt;
    return length(max(Q, float3(0.0, 0.0, 0.0))) + min(max(Q.x, max(Q.y, Q.z)), 0.0);
}

float2 EvaluateSceneSdf(float3 P, int BoxCount)
{
    float BestD   = P.z; // Ground plane z = 0
    float BestIdx = -1.0;
    for (int I = 0; I < BoxCount; ++I)
    {
        float D = BoxSignedDistance(P, SdfBoxes[I].CentreAndRough.xyz, SdfBoxes[I].HalfExtents.xyz);
        if (D < BestD)
        {
            BestD   = D;
            BestIdx = float(I);
        }
    }
    return float2(BestD, BestIdx);
}

float3 EvaluateVolumetricSkyCloudsAndPlume(float3 Orig, float3 Dir, float MaxDist, bool HitSky)
{
    float3 SunDir = normalize(Uniforms.SunDirAndPower.xyz);
    float3 Col    = float3(0.0, 0.0, 0.0);

    if (HitSky)
    {
        float  Horizon = saturate(1.0 - max(0.0, Dir.z));
        float3 Sky     = lerp(float3(0.16, 0.34, 0.68), float3(0.58, 0.68, 0.82), Horizon * Horizon);
        if (Dir.z > 0.03)
        {
            float TCloud = (950.0 - Orig.z) / max(0.04, Dir.z);
            float2 Uv    = (Orig.xy + Dir.xy * TCloud) * 0.0012;
            float  Noise = 0.5 + 0.5 * sin(Uv.x * 7.1 + cos(Uv.y * 5.3));
            float  Cloud = saturate((Noise - (1.0 - Uniforms.PlumeBoxMax.w)) * 2.2);
            Sky = lerp(Sky, float3(0.92, 0.94, 0.97) * (0.45 + 0.55 * max(0.1, SunDir.z)), Cloud * 0.85);
        }
        Col = Sky;
    }

    // Ray-box intersection with 3D PlumeFluid smoke & fire bounds so mirrors & portals reflect plume!
    float3 InvD = 1.0 / select(abs(Dir) > 1.0e-5, Dir, float3(1.0e-5, 1.0e-5, 1.0e-5));
    float3 T0   = (Uniforms.PlumeBoxMin.xyz - Orig) * InvD;
    float3 T1   = (Uniforms.PlumeBoxMax.xyz - Orig) * InvD;
    float3 TSm  = min(T0, T1);
    float3 TBg  = max(T0, T1);
    float  TEn  = max(0.0, max(TSm.x, max(TSm.y, TSm.z)));
    float  TEx  = min(MaxDist, min(TBg.x, min(TBg.y, TBg.z)));

    if (TEx > TEn && Uniforms.PlumeBoxMin.w > 0.001)
    {
        float  Dt    = (TEx - TEn) / 8.0;
        float  Trans = 1.0;
        float3 Plume = float3(0.0, 0.0, 0.0);
        for (int S = 0; S < 8; ++S)
        {
            float3 SampleP = Orig + Dir * (TEn + (float(S) + 0.5) * Dt);
            float3 BoxMid  = 0.5 * (Uniforms.PlumeBoxMin.xyz + Uniforms.PlumeBoxMax.xyz);
            float3 Span    = max(float3(0.5, 0.5, 0.5), 0.5 * (Uniforms.PlumeBoxMax.xyz - Uniforms.PlumeBoxMin.xyz));
            float3 Rel     = (SampleP - BoxMid) / Span;
            float  Dens    = Uniforms.PlumeBoxMin.w * exp(-2.4 * dot(Rel, Rel));
            float  StepT   = exp(-Dens * Dt);
            float  HotCore = exp(-5.5 * dot(Rel + float3(0.0, 0.0, 0.45), Rel + float3(0.0, 0.0, 0.45)));
            float3 Scatter = float3(0.42, 0.44, 0.48) + float3(4.5, 1.8, 0.35) * HotCore;
            Plume += Trans * (1.0 - StepT) * Scatter;
            Trans *= StepT;
        }
        Col = Col * Trans + Plume;
    }

    float FogT = exp(-Uniforms.CameraRight.w * min(MaxDist, 220.0));
    Col = lerp(float3(0.52, 0.58, 0.68), Col, FogT);
    return Col;
}

[shader("compute")]
[numthreads(8, 8, 1)]
void TraceDualTierPortalsAndMirrors(uint3 ThreadId : SV_DispatchThreadID)
{
    int Width  = Uniforms.ViewportAndTier.x;
    int Height = Uniforms.ViewportAndTier.y;
    int Px     = int(ThreadId.x);
    int Py     = int(ThreadId.y);
    if (Px >= Width || Py >= Height)
    {
        return;
    }

    float NdcX = ((float(Px) + 0.5) / float(Width) * 2.0 - 1.0) * Uniforms.CameraForward.w;
    float NdcY = 1.0 - (float(Py) + 0.5) / float(Height) * 2.0;
    float TanH = Uniforms.CameraOrigin.w;

    float3 CurrOrig   = Uniforms.CameraOrigin.xyz;
    float3 CurrDir    = normalize(Uniforms.CameraForward.xyz + Uniforms.CameraRight.xyz * (NdcX * TanH) + Uniforms.CameraUp.xyz * (NdcY * TanH));
    float3 Throughput = float3(1.0, 1.0, 1.0);
    float3 Radiance   = float3(0.0, 0.0, 0.0);
    bool   RayActive  = true;

    int MaxBounces = clamp(Uniforms.Counts.w, 1, 5);
    for (int Bounce = 0; Bounce < MaxBounces; ++Bounce)
    {
        if (RayActive)
        {
            float BestT   = 400.0;
            int   HitCard = -2; // -2 = sky, -1 = ground, >=0 = SdfBox

            // Sphere-trace SDF scene (no break/continue inside loop for SwiftShader Slang -O0 safety!).
            float MarchT   = 0.02;
            bool  SdfFound = false;
            for (int Step = 0; Step < 48; ++Step)
            {
                if (!SdfFound && MarchT < BestT)
                {
                    float2 Sdf = EvaluateSceneSdf(CurrOrig + CurrDir * MarchT, Uniforms.Counts.x);
                    if (Sdf.x < 0.004)
                    {
                        BestT    = MarchT;
                        HitCard  = int(Sdf.y);
                        SdfFound = true;
                    }
                    else
                    {
                        MarchT += max(0.02, Sdf.x);
                    }
                }
            }

            // Check Mirrors!
            int HitMirror = -1;
            for (int M = 0; M < Uniforms.Counts.y; ++M)
            {
                float3 MNrm  = Mirrors[M].FrontAndRefl.xyz;
                float  Denom = dot(CurrDir, MNrm);
                if (Denom < -1.0e-4)
                {
                    float T = dot(Mirrors[M].CentreAndHalfW.xyz - CurrOrig, MNrm) / Denom;
                    if (T > 0.002 && T < BestT)
                    {
                        float3 Rel = (CurrOrig + CurrDir * T) - Mirrors[M].CentreAndHalfW.xyz;
                        float  U   = dot(Rel, Mirrors[M].RightAndHalfH.xyz);
                        float  V   = dot(Rel, Mirrors[M].UpAxis.xyz);
                        if (abs(U) <= Mirrors[M].CentreAndHalfW.w && abs(V) <= Mirrors[M].RightAndHalfH.w)
                        {
                            BestT     = T;
                            HitMirror = M;
                        }
                    }
                }
            }

            // Check Portals!
            int HitPortal = -1;
            for (int P = 0; P < Uniforms.Counts.z; ++P)
            {
                float3 PNrm  = Portals[P].EntryNormal.xyz;
                float  Denom = dot(CurrDir, PNrm);
                if (Denom < -1.0e-4)
                {
                    float T = dot(Portals[P].EntryCentreW.xyz - CurrOrig, PNrm) / Denom;
                    if (T > 0.002 && T < BestT)
                    {
                        float3 Rel = (CurrOrig + CurrDir * T) - Portals[P].EntryCentreW.xyz;
                        float  U   = dot(Rel, Portals[P].EntryRightH.xyz);
                        float  V   = dot(Rel, Portals[P].EntryUp.xyz);
                        if (abs(U) <= Portals[P].EntryCentreW.w && abs(V) <= Portals[P].EntryRightH.w)
                        {
                            BestT     = T;
                            HitPortal = P;
                            HitMirror = -1;
                        }
                    }
                }
            }

            bool HitSky = (HitCard == -2 && HitMirror < 0 && HitPortal < 0);
            float3 SegVol = EvaluateVolumetricSkyCloudsAndPlume(CurrOrig, CurrDir, BestT, HitSky);

            if (HitSky)
            {
                Radiance += Throughput * SegVol;
                RayActive = false;
            }
            else if (HitPortal >= 0)
            {
                float3 HitPt = CurrOrig + CurrDir * BestT;
                float3 Rel   = HitPt - Portals[HitPortal].EntryCentreW.xyz;
                float  U     = dot(Rel, Portals[HitPortal].EntryRightH.xyz);
                float  V     = dot(Rel, Portals[HitPortal].EntryUp.xyz);
                float  Dr    = dot(CurrDir, Portals[HitPortal].EntryRightH.xyz);
                float  Du    = dot(CurrDir, Portals[HitPortal].EntryUp.xyz);
                float  Dn    = dot(CurrDir, Portals[HitPortal].EntryNormal.xyz);

                CurrOrig = Portals[HitPortal].ExitCentre.xyz - Portals[HitPortal].ExitRight.xyz * U +
                           Portals[HitPortal].ExitUp.xyz * V + Portals[HitPortal].ExitNormal.xyz * 0.02;
                CurrDir  = normalize(-Portals[HitPortal].ExitRight.xyz * Dr +
                                     Portals[HitPortal].ExitUp.xyz * Du -
                                     Portals[HitPortal].ExitNormal.xyz * Dn);
            }
            else if (HitMirror >= 0)
            {
                float3 HitPt = CurrOrig + CurrDir * BestT;
                float3 MNrm  = Mirrors[HitMirror].FrontAndRefl.xyz;
                CurrDir      = normalize(reflect(CurrDir, MNrm));
                CurrOrig     = HitPt + MNrm * 0.02;
                Throughput  *= Mirrors[HitMirror].FrontAndRefl.w;
            }
            else
            {
                float3 Albedo = (HitCard >= 0) ? SdfBoxes[HitCard].AlbedoRgb.xyz : float3(0.24, 0.25, 0.27);
                float3 SunDir = normalize(Uniforms.SunDirAndPower.xyz);
                float3 SurfRad = Albedo * (0.25 + 0.75 * max(0.0, SunDir.z));
                Radiance += Throughput * SurfRad;
                RayActive = false;
            }
        }
    }

    OutRadianceRgba[Py * Width + Px] = float4(Radiance, 1.0);
}
