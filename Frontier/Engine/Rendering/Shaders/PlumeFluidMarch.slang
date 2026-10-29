//==========================================================================================================================================
//                                                          PLUMEFLUIDMARCH.SLANG
//==========================================================================================================================================
// 🧩 GPU Vulkan Slang full-resolution volume ray-march: aperiodic SO(3) flow-warped detail, crisp reaction-sheet fire, Beers-Powder smoke.

struct PlumeLatticeFootprint
{
    int4   VelocityOrigin;
    int4   PriorVelocityOrigin;
    uint4  VelocityExtent;
    uint4  ThermoExtent;
    float4 Lattice;
    float4 Forces;
    float4 Retention;
    float4 Wind;
    float4 SourceMinimum;
    float4 SourceMaximum;
    float4 Optical;
    float4 Sun;
    float4 Combustion;
    float4 Scattering;
    float4 Detail;
    float4 Flame;
};

struct PlumeFireLightRecord
{
    uint4  Count;
    float4 PositionRadius[4];
    float4 Radiance[4];
};

struct PlumeViewFootprint
{
    float4 CameraOriginFov;      // xyz camera eye [m], w tan(0.5 * vFov)
    float4 CameraForwardAspect;  // xyz forward, w aspect (W / H)
    float4 CameraRightOrdinal;   // xyz right, w frame ordinal
    float4 CameraUpMaxDist;      // xyz up, w default far clip [m]
    float4 SunIlluminance;       // rgb sun irradiance, w = 0
    float4 SkyRadiance;          // rgb sky ambient, w = 0
    uint4  Dimensions;           // x width, y height, zw = 0
};

[[vk::binding(0, 0)]] ConstantBuffer<PlumeLatticeFootprint> Plume;
[[vk::binding(1, 0)]] ConstantBuffer<PlumeFireLightRecord>  FireLights;
[[vk::binding(2, 0)]] ConstantBuffer<PlumeViewFootprint>    View;
[[vk::binding(3, 0)]] StructuredBuffer<float4>              ThermoBuffer;
[[vk::binding(4, 0)]] StructuredBuffer<float4>              VelocityBuffer;
[[vk::binding(5, 0)]] StructuredBuffer<float2>              LightBuffer;
[[vk::binding(6, 0)]] RWStructuredBuffer<float4>            OutputPremulRgba;

uint HashCell3D(int3 C)
{
    uint H = uint(C.x) * 374761393u + uint(C.y) * 668265263u + uint(C.z) * 2147483647u;
    H = (H ^ (H >> 13u)) * 1274126177u;
    return H ^ (H >> 16u);
}

float SmoothValueNoise3D(float3 P)
{
    float3 Fl = floor(P);
    int3   I0 = int3(Fl);
    float3 T  = P - Fl;
    float3 U  = T * T * (3.0 - 2.0 * T);

    float C000 = float(HashCell3D(I0 + int3(0, 0, 0)) & 0x00FFFFFFu) * (1.0 / 16777215.0);
    float C100 = float(HashCell3D(I0 + int3(1, 0, 0)) & 0x00FFFFFFu) * (1.0 / 16777215.0);
    float C010 = float(HashCell3D(I0 + int3(0, 1, 0)) & 0x00FFFFFFu) * (1.0 / 16777215.0);
    float C110 = float(HashCell3D(I0 + int3(1, 1, 0)) & 0x00FFFFFFu) * (1.0 / 16777215.0);
    float C001 = float(HashCell3D(I0 + int3(0, 0, 1)) & 0x00FFFFFFu) * (1.0 / 16777215.0);
    float C101 = float(HashCell3D(I0 + int3(1, 0, 1)) & 0x00FFFFFFu) * (1.0 / 16777215.0);
    float C011 = float(HashCell3D(I0 + int3(0, 1, 1)) & 0x00FFFFFFu) * (1.0 / 16777215.0);
    float C111 = float(HashCell3D(I0 + int3(1, 1, 1)) & 0x00FFFFFFu) * (1.0 / 16777215.0);

    float C00 = lerp(C000, C100, U.x);
    float C10 = lerp(C010, C110, U.x);
    float C01 = lerp(C001, C101, U.x);
    float C11 = lerp(C011, C111, U.x);
    return lerp(lerp(C00, C10, U.y), lerp(C01, C11, U.y), U.z);
}

// Aperiodic 3-octave SO(3) golden-rotation + dual-phase flow-warped detail (zero periodic tile).
float EvaluateAperiodicPlumeDetail(float3 WorldPos, float3 LocalVelocity)
{
    float Elapsed = Plume.Wind.w;
    float PhaseA  = frac(Elapsed);
    float PhaseB  = frac(PhaseA + 0.5);
    float WeightA = 0.5 - 0.5 * cos(6.2831853 * PhaseA);
    float Warp    = Plume.Detail.w;
    float Freq    = Plume.Detail.y * 3.1;

    float3 QA = (WorldPos - LocalVelocity * (Warp * PhaseA) - float3(0.28, 0.17, 0.52) * Elapsed) * Freq;
    float3 QB = (WorldPos - LocalVelocity * (Warp * PhaseB) - float3(0.28, 0.17, 0.52) * Elapsed) * Freq;

    float3 R1A = 1.61803399 * float3( 0.809017 * QA.x + 0.500000 * QA.y - 0.309017 * QA.z,
                                     -0.309017 * QA.x + 0.809017 * QA.y + 0.500000 * QA.z,
                                      0.500000 * QA.x - 0.309017 * QA.y + 0.809017 * QA.z) + float3(17.31, -29.73, 41.19);
    float3 R2A = 2.61803399 * float3( 0.309017 * QA.x - 0.809017 * QA.y + 0.500000 * QA.z,
                                      0.500000 * QA.x + 0.309017 * QA.y + 0.809017 * QA.z,
                                     -0.809017 * QA.x - 0.500000 * QA.y + 0.309017 * QA.z) + float3(-53.07, 11.89, -37.41);

    float3 R1B = 1.61803399 * float3( 0.809017 * QB.x + 0.500000 * QB.y - 0.309017 * QB.z,
                                     -0.309017 * QB.x + 0.809017 * QB.y + 0.500000 * QB.z,
                                      0.500000 * QB.x - 0.309017 * QB.y + 0.809017 * QB.z) + float3(17.31, -29.73, 41.19);
    float3 R2B = 2.61803399 * float3( 0.309017 * QB.x - 0.809017 * QB.y + 0.500000 * QB.z,
                                      0.500000 * QB.x + 0.309017 * QB.y + 0.809017 * QB.z,
                                     -0.809017 * QB.x - 0.500000 * QB.y + 0.309017 * QB.z) + float3(-53.07, 11.89, -37.41);

    float SA = 0.52 * SmoothValueNoise3D(QA) + 0.31 * SmoothValueNoise3D(R1A) + 0.17 * (1.0 - abs(2.0 * SmoothValueNoise3D(R2A) - 1.0));
    float SB = 0.52 * SmoothValueNoise3D(QB) + 0.31 * SmoothValueNoise3D(R1B) + 0.17 * (1.0 - abs(2.0 * SmoothValueNoise3D(R2B) - 1.0));
    return lerp(SB, SA, WeightA);
}

float3 EvaluatePlanckianBlackbody(float Kelvin)
{
    float T = clamp(Kelvin, 700.0, 5500.0);
    float H = T * 0.01;
    float G = saturate(0.39008158 * log(max(H, 1.0)) - 0.63184144);
    float B = (H <= 19.0) ? 0.0 : saturate(0.54320679 * log(max(H - 10.0, 1.0)) - 1.19625409);
    float3 Lin = pow(float3(1.0, G, B), float3(2.2, 2.2, 2.2));
    float Ratio = T / 1550.0;
    return Lin * (Ratio * Ratio * Ratio * sqrt(Ratio));
}

float EvaluateHG(float Cosine, float G)
{
    float G2 = G * G;
    float D  = max(1.0 + G2 - 2.0 * G * Cosine, 1.0e-4);
    return (1.0 - G2) / (12.5663706 * D * sqrt(D));
}

float EvaluateSmokePhase(float Cosine, float Anisotropy)
{
    return lerp(EvaluateHG(Cosine, -0.65 * Anisotropy), EvaluateHG(Cosine, Anisotropy), 0.72);
}

uint FineIndex(int3 C)
{
    int3 Clamped = clamp(C, int3(0, 0, 0), int3(Plume.ThermoExtent.xyz) - int3(1, 1, 1));
    return (uint(Clamped.z) * Plume.ThermoExtent.y + uint(Clamped.y)) * Plume.ThermoExtent.x + uint(Clamped.x);
}

uint CoarseIndex(int3 C)
{
    int3 Clamped = clamp(C, int3(0, 0, 0), int3(Plume.VelocityExtent.xyz) - int3(1, 1, 1));
    return (uint(Clamped.z) * Plume.VelocityExtent.y + uint(Clamped.y)) * Plume.VelocityExtent.x + uint(Clamped.x);
}

float4 SampleThermoVolume(float3 Pos, float2 WorldMinXY)
{
    float3 G = float3((Pos.xy - WorldMinXY) / Plume.Lattice.x - 0.5,
                      (Pos.z  - Plume.Lattice.z) / Plume.Lattice.x - 0.5);
    bool Inside = all(G >= float3(0.0, 0.0, 0.0)) && all(G < float3(Plume.ThermoExtent.xyz) - 1.0);
    float3 Cl = clamp(G, float3(0.0, 0.0, 0.0), float3(Plume.ThermoExtent.xyz) - 1.0001);
    int3   I0 = int3(floor(Cl));
    int3   I1 = I0 + int3(1, 1, 1);
    float3 F  = Cl - float3(I0);

    float4 C00 = lerp(ThermoBuffer[FineIndex(int3(I0.x, I0.y, I0.z))], ThermoBuffer[FineIndex(int3(I1.x, I0.y, I0.z))], F.x);
    float4 C10 = lerp(ThermoBuffer[FineIndex(int3(I0.x, I1.y, I0.z))], ThermoBuffer[FineIndex(int3(I1.x, I1.y, I0.z))], F.x);
    float4 C01 = lerp(ThermoBuffer[FineIndex(int3(I0.x, I0.y, I1.z))], ThermoBuffer[FineIndex(int3(I1.x, I0.y, I1.z))], F.x);
    float4 C11 = lerp(ThermoBuffer[FineIndex(int3(I0.x, I1.y, I1.z))], ThermoBuffer[FineIndex(int3(I1.x, I1.y, I1.z))], F.x);
    float4 Val = max(float4(0.0, 0.0, 0.0, 0.0), lerp(lerp(C00, C10, F.y), lerp(C01, C11, F.y), F.z));
    return Inside ? Val : float4(0.0, 0.0, 0.0, 0.0);
}

[shader("compute")]
[numthreads(8, 8, 1)]
void MarchPlumeFluidVolume(uint3 ThreadId : SV_DispatchThreadID)
{
    if (ThreadId.x >= View.Dimensions.x || ThreadId.y >= View.Dimensions.y) return;
    uint OutIndex = ThreadId.y * View.Dimensions.x + ThreadId.x;

    float2 Uv      = (float2(ThreadId.xy) + 0.5) / float2(View.Dimensions.xy);
    float  ScreenU = 2.0 * Uv.x - 1.0;
    float  ScreenV = 1.0 - 2.0 * Uv.y;
    float  TanY    = View.CameraOriginFov.w;
    float  TanX    = TanY * View.CameraForwardAspect.w;
    float3 RayDir  = normalize(View.CameraForwardAspect.xyz +
                               ScreenU * TanX * View.CameraRightOrdinal.xyz +
                               ScreenV * TanY * View.CameraUpMaxDist.xyz);

    float2 WorldMinXY = float2(Plume.VelocityOrigin.xy) * Plume.Lattice.y;
    float3 BoxMin     = float3(WorldMinXY, Plume.Lattice.z);
    float3 BoxMax     = BoxMin + float3(Plume.ThermoExtent.xyz) * Plume.Lattice.x;

    float3 SafeDir = select(abs(RayDir) < float3(1.0e-8, 1.0e-8, 1.0e-8), float3(1.0e-8, 1.0e-8, 1.0e-8), RayDir);
    float3 T0      = (BoxMin - View.CameraOriginFov.xyz) / SafeDir;
    float3 T1      = (BoxMax - View.CameraOriginFov.xyz) / SafeDir;
    float3 TMin3   = min(T0, T1);
    float3 TMax3   = max(T0, T1);
    float  Enter   = max(max(TMin3.x, TMin3.y), max(TMin3.z, 0.0));
    float  Exit    = min(min(TMax3.x, TMax3.y), min(TMax3.z, View.CameraUpMaxDist.w));

    if (Exit <= Enter)
    {
        OutputPremulRgba[OutIndex] = float4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    uint  StepCount = uint(clamp(ceil((Exit - Enter) / (0.58 * Plume.Lattice.x)), 6.0, max(Plume.Optical.w, 8.0)));
    float Step      = (Exit - Enter) / float(StepCount);
    float Jitter    = frac(52.9829189 * frac(0.06711056 * float(ThreadId.x) + 0.00583715 * float(ThreadId.y)) +
                           0.61803398875 * View.CameraRightOrdinal.w);

    float Cosine  = dot(RayDir, Plume.Sun.xyz);
    float Phase0  = EvaluateSmokePhase(Cosine, Plume.Scattering.y);
    float Phase1  = EvaluateSmokePhase(Cosine, 0.50 * Plume.Scattering.y);
    float Phase2  = EvaluateSmokePhase(Cosine, 0.25 * Plume.Scattering.y);
    float Flicker = 0.5 + 0.5 * sin(Plume.Wind.w * 23.0);

    float3 Radiance      = float3(0.0, 0.0, 0.0);
    float  Transmittance = 1.0;

    // Single-exit loop (no continue/break) for fast Subzero compilation.
    [loop]
    for (uint S = 0u; S < StepCount; ++S)
    {
        bool ActiveRay = (Transmittance > 0.008);
        float3 Pos     = View.CameraOriginFov.xyz + RayDir * (Enter + (float(S) + Jitter) * Step);
        float4 Thermo  = ActiveRay ? SampleThermoVolume(Pos, WorldMinXY) : float4(0.0, 0.0, 0.0, 0.0);
        bool HasMedia  = ActiveRay && (Thermo.x > 1.0e-3 || Thermo.w > 1.0e-3 || Thermo.z > 1.0e-3);

        int3 CoarseCell = int3(floor(float3((Pos.xy - WorldMinXY) / Plume.Lattice.y, (Pos.z - Plume.Lattice.z) / Plume.Lattice.y)));
        uint CIdx       = CoarseIndex(CoarseCell);
        float3 LocalVel = HasMedia ? VelocityBuffer[CIdx].xyz : float3(0.0, 0.0, 0.0);
        float2 Shadow   = HasMedia ? LightBuffer[CIdx] : float2(1.0, 1.0);
        float  Noise    = HasMedia ? EvaluateAperiodicPlumeDetail(Pos, LocalVel) : 0.5;

        float ThinS     = 1.0 - saturate(Thermo.x * 0.65);
        float ThinA     = 1.0 - saturate(Thermo.w * 0.65);
        float SmokeDen  = max(0.0, Thermo.x * (1.0 + Plume.Detail.x * (Noise - 0.5) * 1.55) - Plume.Detail.x * ThinS * (1.0 - Noise) * 0.42 * min(Thermo.x, 1.2));
        float SootDen   = max(0.0, Thermo.w * (1.0 + Plume.Detail.x * (Noise - 0.5) * 1.55) - Plume.Detail.x * ThinA * (1.0 - Noise) * 0.42 * min(Thermo.w, 1.2));

        float Wrinkle    = (Noise - 0.46) * 0.52 + (Flicker - 0.5) * 0.12;
        float ErodedFuel = max(0.0, Thermo.z + Wrinkle * min(Thermo.z * 1.6, 0.85));
        float SheetMask  = smoothstep(0.16, 0.88, ErodedFuel);
        float CrispFlame = (Thermo.z > 0.015) ? pow(SheetMask, Plume.Flame.w) : 0.0;
        float CoreFactor = smoothstep(0.42, 1.25, ErodedFuel * (0.65 + 0.35 * Thermo.y / (Thermo.y + Plume.Flame.z)));
        float Kelvin     = lerp(Plume.Flame.y, Plume.Flame.x, CoreFactor);
        float FlameScale = Plume.SourceMaximum.w * CrispFlame;

        float SmokeExt    = SmokeDen * Plume.Optical.x;
        float SootExt     = SootDen  * Plume.Optical.z;
        float Particulate = SmokeExt + SootExt;
        float Extinction  = HasMedia ? (Particulate + CrispFlame * 0.55) : 0.0;
        float Absorbed    = HasMedia ? (1.0 - exp(-Extinction * Step)) : 0.0;
        float Albedo      = (Particulate > 1.0e-5) ? ((SmokeExt * Plume.Optical.y + SootExt * Plume.Sun.w) / Particulate) : 0.0;
        float Share       = (Extinction > 1.0e-5)  ? (Particulate / Extinction) : 0.0;
        float Powder      = 1.0 - 0.52 * exp(-2.4 * Extinction * Step);

        float MultiOctave = Phase0 * Shadow.x +
                            Plume.Scattering.x * Albedo * (0.60 * Phase1 * pow(Shadow.x, 0.25) + 0.36 * Phase2 * pow(Shadow.x, 0.0625));
        float SkyOcc      = 0.18 + 0.82 * pow(Shadow.y, 0.6);

        float3 FireIrr = float3(0.0, 0.0, 0.0);
        uint FireCount = min(FireLights.Count.x, 4u);
        for (uint L = 0u; L < 4u; ++L)
        {
            float ActiveL = (HasMedia && L < FireCount) ? 1.0 : 0.0;
            float3 D      = FireLights.PositionRadius[L].xyz - Pos;
            float  R      = FireLights.PositionRadius[L].w;
            FireIrr += ActiveL * FireLights.Radiance[L].xyz * (0.07957747 / (dot(D, D) + R * R));
        }

        float3 InScatter = (View.SunIlluminance.xyz * (MultiOctave * Powder + max(Plume.Sun.z, 0.0) * 0.038197) +
                            View.SkyRadiance.xyz * SkyOcc + FireIrr) * (Albedo * Share * Absorbed);
        float3 FlameRad  = (FlameScale > 0.0) ? (EvaluatePlanckianBlackbody(Kelvin) * (FlameScale * Step)) : float3(0.0, 0.0, 0.0);

        Radiance      += HasMedia ? (Transmittance * (InScatter + FlameRad)) : float3(0.0, 0.0, 0.0);
        Transmittance *= HasMedia ? (1.0 - Absorbed) : 1.0;
    }

    OutputPremulRgba[OutIndex] = float4(Radiance, Transmittance);
}
