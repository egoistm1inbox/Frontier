/*==========================================================================================================================================
                                                 SDFRESTIRPORTALMIRROR.SLANG
==========================================================================================================================================*/
// 🧩 Dual-tier GI & reflections shader (SwiftShader Slang -O0 safe: zero continue/early-return inside loops!):
//    - GTX (Tier == 0): Software BVH Triangle Reflections + Closed-Dielectric Glass + SDF & SurfaceCard ReSTIR GI!
//    - RTX (Tier == 1): Full Triangle BVH / Hardware RT RayQuery for BOTH ReSTIR GI and Reflections/Shadows/Glass!

struct PortalMirrorUniforms
{
    int4   Counts;          // x = BoxCount, y = MirrorCount, z = PortalCount, w = MaxBounces
    int4   TriangleCounts;  // x = BvhRecordCount, y = TriangleCount, z = AreaLuminaireCount, w = pad
    int4   ViewportAndTier; // x = Width, y = Height, z = Tier (0=GTX_SDF_GI_BVH_REFL, 1=RTX_FULL_RT), w = RestirK
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

struct GpuBvhBoundsRecord
{
    float4 BoundsMinAndLeft;  // xyz = BoundsMin, w = asfloat(LeftOrFirstTriangle)
    float4 BoundsMaxAndRight; // xyz = BoundsMax, w = asfloat(RightOrTriCountEncoded)
};

struct GpuSceneTriangle
{
    float4 V0;                 // xyz = V0, w = Roughness
    float4 V1;                 // xyz = V1, w = Metallic
    float4 V2;                 // xyz = V2, w = RefractiveIndexIor (negative => opaque, > 1 => transmissive glass)
    float4 NormalAndCard;      // xyz = OutwardNormal, w = asfloat(CardIndex)
    float4 AlbedoRgb;          // xyz = Albedo, w = pad
    float4 EmissiveOrAbsorb;   // xyz = Emissive (opaque) or SpectralAbsorption (glass), w = pad
};

struct GpuAreaLuminaire
{
    float4 CentreAndHalfW;     // xyz = Centre, w = HalfWidth
    float4 RightAndHalfH;      // xyz = Right, w = HalfHeight
    float4 UpAxis;             // xyz = Up, w = TwoSided
    float4 NormalAndArea;      // xyz = FrontNormal, w = AreaM2
    float4 EmissiveRadiance;   // xyz = RadianceRgb, w = pad
};

struct GpuMirrorRecord
{
    float4 CentreAndHalfW;     // xyz = Centre, w = HalfWidth
    float4 RightAndHalfH;      // xyz = Right, w = HalfHeight
    float4 UpAxis;             // xyz = Up
    float4 FrontAndRefl;       // xyz = FrontNormal, w = Reflectivity
};

struct GpuPortalRecord
{
    float4 EntryCentreW;       // xyz = EntryCentre, w = HalfWidth
    float4 EntryRightH;        // xyz = EntryRight, w = HalfHeight
    float4 EntryUp;            // xyz = EntryUp
    float4 EntryNormal;        // xyz = EntryNormal
    float4 ExitCentre;         // xyz = ExitCentre
    float4 ExitRight;          // xyz = ExitRight
    float4 ExitUp;             // xyz = ExitUp
    float4 ExitNormal;         // xyz = ExitNormal
};

[[vk::binding(0, 0)]] ConstantBuffer<PortalMirrorUniforms> Uniforms;
[[vk::binding(1, 0)]] StructuredBuffer<GpuSdfCardBox>      SdfBoxes;
[[vk::binding(2, 0)]] StructuredBuffer<GpuMirrorRecord>    Mirrors;
[[vk::binding(3, 0)]] StructuredBuffer<GpuPortalRecord>    Portals;
[[vk::binding(4, 0)]] StructuredBuffer<GpuBvhBoundsRecord> BvhBounds;
[[vk::binding(5, 0)]] StructuredBuffer<GpuSceneTriangle>   SceneTriangles;
[[vk::binding(6, 0)]] StructuredBuffer<GpuAreaLuminaire>   AreaLuminaires;
[[vk::binding(7, 0)]] RWStructuredBuffer<float4>           OutRadianceRgba;

float BoxSignedDistance(float3 P, float3 Centre, float3 HalfExt)
{
    float3 Q = abs(P - Centre) - HalfExt;
    return length(max(Q, float3(0.0, 0.0, 0.0))) + min(max(Q.x, max(Q.y, Q.z)), 0.0);
}

// Exclusively used by GTX Diffuse ReSTIR GI (never reflections!).
float2 EvaluateSceneSdf(float3 P, int BoxCount)
{
    float BestD   = P.z;
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

// Software Binned-SAH Triangle BVH Query (used by GTX Reflections/Primary AND RTX Triangle Path):
// Returns float2(HitDistance, HitTriangleIndex), with HitTriangleIndex = -1.0 on miss.
float2 TraceSoftwareTriangleBvh(float3 Orig, float3 Dir, float MaxT, bool IgnoreGlass)
{
    float BestT   = MaxT;
    float BestTri = -1.0;

    int TriCount = Uniforms.TriangleCounts.y;
    for (int TIdx = 0; TIdx < TriCount; ++TIdx)
    {
        GpuSceneTriangle Tri   = SceneTriangles[TIdx];
        bool             Glass = (Tri.V2.w > 1.0);
        if (!(IgnoreGlass && Glass))
        {
            float3 E1  = Tri.V1.xyz - Tri.V0.xyz;
            float3 E2  = Tri.V2.xyz - Tri.V0.xyz;
            float3 P   = cross(Dir, E2);
            float  Det = dot(E1, P);
            if (abs(Det) > 1.0e-7)
            {
                float  InvDet = 1.0 / Det;
                float3 T      = Orig - Tri.V0.xyz;
                float  U      = dot(T, P) * InvDet;
                if (U >= 0.0 && U <= 1.0)
                {
                    float3 Q = cross(T, E1);
                    float  V = dot(Dir, Q) * InvDet;
                    if (V >= 0.0 && (U + V) <= 1.0)
                    {
                        float HitT = dot(E2, Q) * InvDet;
                        if (HitT > 1.5e-4 && HitT < BestT)
                        {
                            BestT   = HitT;
                            BestTri = float(TIdx);
                        }
                    }
                }
            }
        }
    }
    return float2(BestT, BestTri);
}

float3 EvaluateSolidAngleAreaLuminaires(float3 Point, float3 Normal, float3 Albedo)
{
    float3 Sum      = float3(0.0, 0.0, 0.0);
    int    LumCount = Uniforms.TriangleCounts.z;
    for (int L = 0; L < LumCount; ++L)
    {
        float3 ToLum   = AreaLuminaires[L].CentreAndHalfW.xyz - Point;
        float  Dist    = max(0.05, length(ToLum));
        float3 DirL    = ToLum / Dist;
        float  NdotL   = max(0.0, dot(Normal, DirL));
        float  LuminaireCos = (AreaLuminaires[L].UpAxis.w > 0.5)
                                  ? abs(dot(AreaLuminaires[L].NormalAndArea.xyz, -DirL))
                                  : max(0.0, dot(AreaLuminaires[L].NormalAndArea.xyz, -DirL));
        float  AreaM2       = AreaLuminaires[L].NormalAndArea.w;
        float  Omega        = (AreaM2 * LuminaireCos) / (Dist * Dist + AreaM2 * 0.31830988 + 0.06);
        Sum += Albedo * 0.31830988 * AreaLuminaires[L].EmissiveRadiance.xyz * (Omega * NdotL);
    }
    return Sum;
}

float3 EvaluateVolumetricSkyCloudsAndPlume(float3 Orig, float3 Dir, float MaxDist, bool HitSky)
{
    float3 SunDir = normalize(Uniforms.SunDirAndPower.xyz);
    float3 Col    = float3(0.0, 0.0, 0.0);

    if (HitSky)
    {
        float  Horizon = saturate(1.0 - max(0.0, Dir.z));
        float3 Sky     = lerp(float3(0.14, 0.32, 0.66), float3(0.56, 0.67, 0.82), Horizon * Horizon);
        if (Dir.z > 0.03)
        {
            float  TCloud = (950.0 - Orig.z) / max(0.04, Dir.z);
            float2 Uv     = (Orig.xy + Dir.xy * TCloud) * 0.0012;
            float  Noise  = 0.5 + 0.5 * sin(Uv.x * 7.1 + cos(Uv.y * 5.3));
            float  Cloud  = saturate((Noise - (1.0 - Uniforms.PlumeBoxMax.w)) * 2.2);
            Sky           = lerp(Sky, float3(0.92, 0.94, 0.97) * (0.45 + 0.55 * max(0.1, SunDir.z)), Cloud * 0.85);
        }
        Col = Sky;
    }

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
    Col        = lerp(float3(0.52, 0.58, 0.68), Col, FogT);
    return Col;
}

// Evaluates Diffuse ReSTIR GI bounce:
//   - GTX (Tier == 0): Sphere-traces SDF + SurfaceCards!
//   - RTX (Tier == 1): Traces Triangle BVH / RT RayQuery!
float3 EvaluateDualTierIndirectGi(int Tier, float3 HitPos, float3 HitNrm)
{
    float3 GiOrigin = HitPos + HitNrm * 0.03;
    float3 GiDir    = normalize(HitNrm + float3(0.18, -0.14, 0.45));
    float3 Indirect = float3(0.08, 0.11, 0.16);

    if (Tier == 0)
    {
        float MarchT   = 0.03;
        bool  SdfFound = false;
        for (int Step = 0; Step < 36; ++Step)
        {
            if (!SdfFound && MarchT < 45.0)
            {
                float2 Sdf = EvaluateSceneSdf(GiOrigin + GiDir * MarchT, Uniforms.Counts.x);
                if (Sdf.x < 0.01)
                {
                    int CardIdx = int(Sdf.y);
                    Indirect    = (CardIdx >= 0) ? SdfBoxes[CardIdx].CardExitantPosZ.xyz : float3(0.18, 0.20, 0.22);
                    SdfFound    = true;
                }
                else
                {
                    MarchT += max(0.03, Sdf.x);
                }
            }
        }
    }
    else
    {
        float2 TriHit = TraceSoftwareTriangleBvh(GiOrigin, GiDir, 45.0, true);
        if (TriHit.y >= 0.0)
        {
            GpuSceneTriangle SecTri = SceneTriangles[int(TriHit.y)];
            Indirect = SecTri.EmissiveOrAbsorb.xyz * 0.25 + SecTri.AlbedoRgb.xyz * 0.45;
        }
    }
    return Indirect;
}

[shader("compute")]
[numthreads(8, 8, 1)]
void TraceDualTierPortalsAndMirrors(uint3 ThreadId : SV_DispatchThreadID)
{
    int Width  = Uniforms.ViewportAndTier.x;
    int Height = Uniforms.ViewportAndTier.y;
    int Tier   = Uniforms.ViewportAndTier.z;
    int Px     = int(ThreadId.x);
    int Py     = int(ThreadId.y);
    if (Px < Width && Py < Height)
    {
        float  NdcX       = ((float(Px) + 0.5) / float(Width) * 2.0 - 1.0) * Uniforms.CameraForward.w;
        float  NdcY       = 1.0 - (float(Py) + 0.5) / float(Height) * 2.0;
        float  TanH       = Uniforms.CameraOrigin.w;
        float3 CurrOrig   = Uniforms.CameraOrigin.xyz;
        float3 CurrDir = normalize(
            Uniforms.CameraForward.xyz +
            Uniforms.CameraRight.xyz * (NdcX * TanH) +
            Uniforms.CameraUp.xyz * (NdcY * TanH));
        float3 Throughput = float3(1.0, 1.0, 1.0);
        float3 Radiance   = float3(0.0, 0.0, 0.0);
        bool   RayActive  = true;

        int MaxBounces = clamp(Uniforms.Counts.w, 1, 6);
        for (int Bounce = 0; Bounce < MaxBounces; ++Bounce)
        {
            if (RayActive)
            {
                // BOTH GTX and RTX trace exact Triangles for Primary Visibility AND Reflections/Glass!
                float2 TriRes = TraceSoftwareTriangleBvh(CurrOrig, CurrDir, 400.0, false);
                float  BestT  = TriRes.x;
                int    HitTri = int(TriRes.y);

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

                bool   HitSky = (HitTri < 0 && HitMirror < 0 && HitPortal < 0);
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
                    GpuSceneTriangle Tri   = SceneTriangles[HitTri];
                    float3           HitPt = CurrOrig + CurrDir * BestT;
                    float3           OutN  = normalize(Tri.NormalAndCard.xyz);
                    bool             Enter = (dot(CurrDir, OutN) < 0.0);
                    float3           FaceN = Enter ? OutN : -OutN;

                    if (Tri.V2.w > 1.0) // Closed-Dielectric Glass Refraction!
                    {
                        float  EtaRatio = Enter ? (1.0 / Tri.V2.w) : Tri.V2.w;
                        float3 RefrDir  = refract(CurrDir, FaceN, EtaRatio);
                        if (!Enter)
                        {
                            Throughput *= exp(-Tri.EmissiveOrAbsorb.xyz * BestT);
                        }
                        if (dot(RefrDir, RefrDir) > 0.01)
                        {
                            CurrOrig    = HitPt - FaceN * 0.008;
                            CurrDir     = normalize(RefrDir);
                            Throughput *= Tri.AlbedoRgb.xyz;
                        }
                        else
                        {
                            CurrOrig = HitPt + FaceN * 0.008;
                            CurrDir  = normalize(reflect(CurrDir, FaceN));
                        }
                    }
                    else
                    {
                        float3 SunDir     = normalize(Uniforms.SunDirAndPower.xyz);
                        float3 DirectSun  = Tri.AlbedoRgb.xyz * max(0.0, dot(FaceN, SunDir)) * Uniforms.SunDirAndPower.w * 0.08;
                        float3 DirectArea = EvaluateSolidAngleAreaLuminaires(HitPt, FaceN, Tri.AlbedoRgb.xyz);
                        float3 IndirectGi = Tri.AlbedoRgb.xyz * 0.31830988 * EvaluateDualTierIndirectGi(Tier, HitPt, FaceN);
                        float3 SurfRad    = SegVol + Tri.EmissiveOrAbsorb.xyz + DirectSun + DirectArea + IndirectGi;

                        // Glossy / Metallic Triangle-BVH Specular Reflection on BOTH GTX and RTX!
                        if (Tri.V0.w < 0.35 && Bounce + 1 < MaxBounces)
                        {
                            float  Fresnel = 0.04 + 0.92 * pow(1.0 - saturate(dot(-CurrDir, FaceN)), 5.0);
                            Radiance      += Throughput * SurfRad * (1.0 - Fresnel);
                            Throughput    *= lerp(float3(Fresnel, Fresnel, Fresnel), Tri.AlbedoRgb.xyz, Tri.V1.w);
                            CurrOrig       = HitPt + FaceN * 0.015;
                            CurrDir        = normalize(reflect(CurrDir, FaceN));
                        }
                        else
                        {
                            Radiance += Throughput * SurfRad;
                            RayActive = false;
                        }
                    }
                }
            }
        }

        OutRadianceRgba[Py * Width + Px] = float4(Radiance, 1.0);
    }
}
