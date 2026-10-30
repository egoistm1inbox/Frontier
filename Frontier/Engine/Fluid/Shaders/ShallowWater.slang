/*==========================================================================================================================================
                                                     SHALLOWWATERMUD.SLANG
==========================================================================================================================================*/
// 🧩 Vulkan Slang compute kernels for 2.5D Saint-Venant shallow-water & Bingham-plastic mud (puddles, fords, mud, zero foam/splash).

struct ShallowWaterUniformFootprint
{
    int4   Dimensions;          // x = Nx, y = Ny, z = SecondOrderHydrostatic (0/1), w = pad
    float4 DomainPhysics;       // x = dx, y = dt, z = g, w = epsDry
    float4 FrictionAndVisc;     // x = viscosity, y = manningWater, z = manningMud, w = velMax
    float4 BinghamMud;          // x = cvMax, y = sedRho, z = mudViscA, w = mudViscB
    float4 BinghamYieldAndRain; // x = mudYieldA, y = mudYieldB, z = rainRateMps, w = infiltrationMps
    float4 FilmAndWind;         // x = filmDepthM, y = windTauX, z = windTauY, w = mudDiffusion
};

[[vk::binding(0, 0)]] ConstantBuffer<ShallowWaterUniformFootprint> Uniforms;
[[vk::binding(1, 0)]] StructuredBuffer<float>                      BedElevation;
[[vk::binding(2, 0)]] StructuredBuffer<float2>                     DepthMudIn;
[[vk::binding(3, 0)]] RWStructuredBuffer<float2>                   DepthMudOut;
[[vk::binding(4, 0)]] StructuredBuffer<float2>                     VelocityIn;
[[vk::binding(5, 0)]] RWStructuredBuffer<float2>                   VelocityOut;
[[vk::binding(6, 0)]] RWStructuredBuffer<float>                    OutflowLimiter;

int ClampIndex(int I, int J, int Nx, int Ny)
{
    int Ci = clamp(I, 0, Nx - 1);
    int Cj = clamp(J, 0, Ny - 1);
    return Cj * Nx + Ci;
}

float MinmodPair(float A, float B)
{
    float Prod = A * B;
    return (Prod <= 0.0) ? 0.0 : ((abs(A) < abs(B)) ? A : B);
}

[shader("compute")]
[numthreads(8, 8, 1)]
void SolveShallowWaterVelocity(uint3 ThreadId : SV_DispatchThreadID)
{
    int Nx = Uniforms.Dimensions.x;
    int Ny = Uniforms.Dimensions.y;
    int I  = int(ThreadId.x);
    int J  = int(ThreadId.y);
    if (I >= Nx || J >= Ny)
    {
        return;
    }

    int   K    = J * Nx + I;
    float Dx   = Uniforms.DomainPhysics.x;
    float Dt   = Uniforms.DomainPhysics.y;
    float Grav = Uniforms.DomainPhysics.z;
    float Eps  = Uniforms.DomainPhysics.w;

    float  BC  = BedElevation[K];
    float2 HcC = DepthMudIn[K];
    float  EC  = BC + HcC.x;
    float2 OutV = float2(0.0, 0.0);

    if (I < Nx - 1)
    {
        int    KR   = K + 1;
        float  BR   = BedElevation[KR];
        float2 HcR  = DepthMudIn[KR];
        float  ER   = BR + HcR.x;
        float  Sill = max(BC, BR);
        float  HfTest = max(max(0.0, EC - Sill), max(0.0, ER - Sill));
        if (HfTest > Eps)
        {
            float U  = VelocityIn[K].x - (Grav * Dt / Dx) * (ER - EC);
            bool  Fw = (U >= 0.0);
            float HD = Fw ? HcC.x : HcR.x;
            float BD = Fw ? BC    : BR;
            float Hf = clamp(BD + HD - Sill, 0.0, HD);
            if (Hf > Eps)
            {
                U += Dt * Uniforms.FilmAndWind.y / (1000.0 * max(Hf, 0.05));
                float Hm   = max(Hf, 0.004);
                float Conc = clamp(Fw ? HcC.y : HcR.y, 0.0, 1.0);
                float Mann = lerp(Uniforms.FrictionAndVisc.y, Uniforms.FrictionAndVisc.z, Conc);
                float Spd  = abs(U) + 1.0e-5;
                U /= (1.0 + Dt * Grav * Mann * Mann * Spd / pow(Hm, 1.3333333));
                if (Conc > 0.002)
                {
                    float Cv   = Conc * Uniforms.BinghamMud.x;
                    float Rho  = 1000.0 + (Uniforms.BinghamMud.y - 1000.0) * Cv;
                    float Mu   = Uniforms.BinghamMud.z * (exp(Uniforms.BinghamMud.w * Cv) - 1.0);
                    float TauY = Uniforms.BinghamYieldAndRain.x * (exp(Uniforms.BinghamYieldAndRain.y * Cv) - 1.0);
                    U /= (1.0 + Dt * 3.0 * Mu / (Rho * Hm * Hm));
                    U *= max(0.0, 1.0 - Dt * TauY / (Rho * Hm * (abs(U) + 1.0e-5)));
                }
                OutV.x = clamp(U, -Uniforms.FrictionAndVisc.w, Uniforms.FrictionAndVisc.w);
            }
        }
    }

    if (J < Ny - 1)
    {
        int    KN   = K + Nx;
        float  BN   = BedElevation[KN];
        float2 HcN  = DepthMudIn[KN];
        float  EN   = BN + HcN.x;
        float  Sill = max(BC, BN);
        float  HfTest = max(max(0.0, EC - Sill), max(0.0, EN - Sill));
        if (HfTest > Eps)
        {
            float V  = VelocityIn[K].y - (Grav * Dt / Dx) * (EN - EC);
            bool  Fw = (V >= 0.0);
            float HD = Fw ? HcC.x : HcN.x;
            float BD = Fw ? BC    : BN;
            float Hf = clamp(BD + HD - Sill, 0.0, HD);
            if (Hf > Eps)
            {
                V += Dt * Uniforms.FilmAndWind.z / (1000.0 * max(Hf, 0.05));
                float Hm   = max(Hf, 0.004);
                float Conc = clamp(Fw ? HcC.y : HcN.y, 0.0, 1.0);
                float Mann = lerp(Uniforms.FrictionAndVisc.y, Uniforms.FrictionAndVisc.z, Conc);
                float Spd  = abs(V) + 1.0e-5;
                V /= (1.0 + Dt * Grav * Mann * Mann * Spd / pow(Hm, 1.3333333));
                if (Conc > 0.002)
                {
                    float Cv   = Conc * Uniforms.BinghamMud.x;
                    float Rho  = 1000.0 + (Uniforms.BinghamMud.y - 1000.0) * Cv;
                    float Mu   = Uniforms.BinghamMud.z * (exp(Uniforms.BinghamMud.w * Cv) - 1.0);
                    float TauY = Uniforms.BinghamYieldAndRain.x * (exp(Uniforms.BinghamYieldAndRain.y * Cv) - 1.0);
                    V /= (1.0 + Dt * 3.0 * Mu / (Rho * Hm * Hm));
                    V *= max(0.0, 1.0 - Dt * TauY / (Rho * Hm * (abs(V) + 1.0e-5)));
                }
                OutV.y = clamp(V, -Uniforms.FrictionAndVisc.w, Uniforms.FrictionAndVisc.w);
            }
        }
    }

    VelocityOut[K] = OutV;
}

[shader("compute")]
[numthreads(8, 8, 1)]
void EvaluatePositivityOutflowLimiter(uint3 ThreadId : SV_DispatchThreadID)
{
    int Nx = Uniforms.Dimensions.x;
    int Ny = Uniforms.Dimensions.y;
    int I  = int(ThreadId.x);
    int J  = int(ThreadId.y);
    if (I >= Nx || J >= Ny)
    {
        return;
    }

    int   K    = J * Nx + I;
    float UPos = (I < Nx - 1) ? max(VelocityOut[K].x, 0.0)      : 0.0;
    float UNeg = (I > 0)      ? max(-VelocityOut[K - 1].x, 0.0) : 0.0;
    float VPos = (J < Ny - 1) ? max(VelocityOut[K].y, 0.0)      : 0.0;
    float VNeg = (J > 0)      ? max(-VelocityOut[K - Nx].y, 0.0): 0.0;
    float OutSum = UPos + UNeg + VPos + VNeg;
    OutflowLimiter[K] = min(1.0, Uniforms.DomainPhysics.x / (Uniforms.DomainPhysics.y * OutSum + 1.0e-9));
}

float2 EvaluateFaceMassAndMudFlux(int KL, int KR, float Vel)
{
    if (Vel == 0.0)
    {
        return float2(0.0, 0.0);
    }
    int    KD = (Vel > 0.0) ? KL : KR;
    float2 D  = DepthMudIn[KD];
    float  Hf = clamp(BedElevation[KD] + D.x - max(BedElevation[KL], BedElevation[KR]), 0.0, D.x);
    float  Q  = Vel * Hf * OutflowLimiter[KD];
    return float2(Q, Q * D.y);
}

[shader("compute")]
[numthreads(8, 8, 1)]
void IntegrateShallowWaterDepthAndMud(uint3 ThreadId : SV_DispatchThreadID)
{
    int Nx = Uniforms.Dimensions.x;
    int Ny = Uniforms.Dimensions.y;
    int I  = int(ThreadId.x);
    int J  = int(ThreadId.y);
    if (I >= Nx || J >= Ny)
    {
        return;
    }

    int    K  = J * Nx + I;
    float2 D  = DepthMudIn[K];
    float2 FE = (I < Nx - 1) ? EvaluateFaceMassAndMudFlux(K, K + 1, VelocityOut[K].x)      : float2(0.0, 0.0);
    float2 FW = (I > 0)      ? EvaluateFaceMassAndMudFlux(K - 1, K, VelocityOut[K - 1].x)  : float2(0.0, 0.0);
    float2 FN = (J < Ny - 1) ? EvaluateFaceMassAndMudFlux(K, K + Nx, VelocityOut[K].y)     : float2(0.0, 0.0);
    float2 FS = (J > 0)      ? EvaluateFaceMassAndMudFlux(K - Nx, K, VelocityOut[K - Nx].y): float2(0.0, 0.0);

    float Sc = Uniforms.DomainPhysics.y / Uniforms.DomainPhysics.x;
    float H  = D.x - Sc * (FE.x - FW.x + FN.x - FS.x) + Uniforms.BinghamYieldAndRain.z * Uniforms.DomainPhysics.y;
    float CH = D.x * D.y - Sc * (FE.y - FW.y + FN.y - FS.y);

    if (H < Uniforms.FilmAndWind.x && H > 0.0)
    {
        float Drain = min(H, Uniforms.BinghamYieldAndRain.w * Uniforms.DomainPhysics.y);
        CH -= Drain * clamp(CH / max(H, 1.0e-7), 0.0, 1.0);
        H  -= Drain;
    }

    H  = max(0.0, H);
    CH = max(0.0, CH);
    float C = (H > 1.0e-5) ? clamp(CH / H, 0.0, 1.0) : D.y;
    DepthMudOut[K] = float2(H, C);
}
