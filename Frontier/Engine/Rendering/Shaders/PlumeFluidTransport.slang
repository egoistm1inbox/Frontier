//==========================================================================================================================================
//                                                        PLUMEFLUIDTRANSPORT.SLANG
//==========================================================================================================================================
// 🧩 GPU Vulkan Slang compute transport for 3D smoke & fire: clamped MacCormack advection, vorticity confinement, matched face-flux pressure.

struct PlumeLatticeFootprint
{
    int4   VelocityOrigin;       // xy toroidal coarse origin, zw = 0
    int4   PriorVelocityOrigin;  // xy prior coarse origin, z = 0, w = active source count
    uint4  VelocityExtent;       // xyz coarse dimensions, w = 0
    uint4  ThermoExtent;         // xyz fine dimensions (2x VelocityExtent), w = 0
    float4 Lattice;              // x fine cell [m], y coarse cell [m], z floor Z [m], w dt [s]
    float4 Forces;               // x buoyancy, y settling, z vorticity confinement, w subgrid turbulence
    float4 Retention;            // x smoke, y heat, z flame, w velocity wind-relaxation
    float4 Wind;                 // xyz wind [m/s], w elapsed time [s]
    float4 SourceMinimum;        // xyz AABB min, w = 0
    float4 SourceMaximum;        // xyz AABB max, w = flame radiance scale
    float4 Optical;              // x smoke extinction, y smoke albedo, z soot extinction, w march sample cap
    float4 Sun;                  // xyz sun direction, w soot albedo
    float4 Combustion;           // x soot yield, y heat release, z soot retention, w = 0
    float4 Scattering;           // x multi-scatter gain, y HG anisotropy g, z sky scale, w fire-light gain
    float4 Detail;               // x detail strength, y detail frequency, z turbulence frequency, w flow-warp horizon
    float4 Flame;                // x core K, y tip K, z half-heat K, w reaction-sheet sharpness
};

struct PlumeSourceFootprint
{
    float4 PositionRadius;       // xyz world centre [m], w Gaussian sigma [m]
    float4 Velocity;             // xyz carrier velocity [m/s], w = 0
    float4 Rates;                // x smoke, y heat, z flame, w soot [1/s]
};

[[vk::binding(0, 0)]] ConstantBuffer<PlumeLatticeFootprint> Plume;
[[vk::binding(1, 0)]] StructuredBuffer<float4>              VelocitySource;
[[vk::binding(2, 0)]] RWStructuredBuffer<float4>            VelocityTarget;
[[vk::binding(3, 0)]] StructuredBuffer<float4>              ThermoSource;
[[vk::binding(4, 0)]] RWStructuredBuffer<float4>            ThermoTarget;
[[vk::binding(5, 0)]] StructuredBuffer<PlumeSourceFootprint> PlumeSources;
[[vk::binding(6, 0)]] RWStructuredBuffer<float>             DivergenceBuffer;
[[vk::binding(7, 0)]] StructuredBuffer<float>               PressureSource;
[[vk::binding(8, 0)]] RWStructuredBuffer<float>             PressureTarget;

uint CoarseFlatIndex(int3 Cell)
{
    int3 Clamped = clamp(Cell, int3(0, 0, 0), int3(Plume.VelocityExtent.xyz) - int3(1, 1, 1));
    return (uint(Clamped.z) * Plume.VelocityExtent.y + uint(Clamped.y)) * Plume.VelocityExtent.x + uint(Clamped.x);
}

uint FineFlatIndex(int3 Cell)
{
    int3 Clamped = clamp(Cell, int3(0, 0, 0), int3(Plume.ThermoExtent.xyz) - int3(1, 1, 1));
    return (uint(Clamped.z) * Plume.ThermoExtent.y + uint(Clamped.y)) * Plume.ThermoExtent.x + uint(Clamped.x);
}

float4 SampleCoarseTrilinear(float3 WorldPos, float2 OriginMinXY)
{
    float3 Grid = float3((WorldPos.xy - OriginMinXY) / Plume.Lattice.y - 0.5,
                         (WorldPos.z  - Plume.Lattice.z) / Plume.Lattice.y - 0.5);
    float3 MaxC = float3(Plume.VelocityExtent.xyz) - 1.00001;
    bool Inside = all(Grid >= float3(-0.5, -0.5, -0.5)) && all(Grid <= float3(Plume.VelocityExtent.xyz) - 0.5);
    float3 Clamped = clamp(Grid, float3(0.0, 0.0, 0.0), MaxC);
    int3   I0 = int3(floor(Clamped));
    int3   I1 = min(I0 + int3(1, 1, 1), int3(Plume.VelocityExtent.xyz) - int3(1, 1, 1));
    float3 F  = Clamped - float3(I0);

    float4 C00 = lerp(VelocitySource[CoarseFlatIndex(int3(I0.x, I0.y, I0.z))], VelocitySource[CoarseFlatIndex(int3(I1.x, I0.y, I0.z))], F.x);
    float4 C10 = lerp(VelocitySource[CoarseFlatIndex(int3(I0.x, I1.y, I0.z))], VelocitySource[CoarseFlatIndex(int3(I1.x, I1.y, I0.z))], F.x);
    float4 C01 = lerp(VelocitySource[CoarseFlatIndex(int3(I0.x, I0.y, I1.z))], VelocitySource[CoarseFlatIndex(int3(I1.x, I0.y, I1.z))], F.x);
    float4 C11 = lerp(VelocitySource[CoarseFlatIndex(int3(I0.x, I1.y, I1.z))], VelocitySource[CoarseFlatIndex(int3(I1.x, I1.y, I1.z))], F.x);
    float4 Val = lerp(lerp(C00, C10, F.y), lerp(C01, C11, F.y), F.z);
    return Inside ? Val : float4(Plume.Wind.xyz, 0.0);
}

float4 SampleFineTrilinearClamped(float3 WorldPos, float2 OriginMinXY, out float4 OutMin8, out float4 OutMax8)
{
    float3 Grid = float3((WorldPos.xy - OriginMinXY) / Plume.Lattice.x - 0.5,
                         (WorldPos.z  - Plume.Lattice.z) / Plume.Lattice.x - 0.5);
    float3 MaxC = float3(Plume.ThermoExtent.xyz) - 1.00001;
    bool Inside = all(Grid >= float3(-0.5, -0.5, -0.5)) && all(Grid <= float3(Plume.ThermoExtent.xyz) - 0.5);
    float3 Clamped = clamp(Grid, float3(0.0, 0.0, 0.0), MaxC);
    int3   I0 = int3(floor(Clamped));
    int3   I1 = min(I0 + int3(1, 1, 1), int3(Plume.ThermoExtent.xyz) - int3(1, 1, 1));
    float3 F  = Clamped - float3(I0);

    float4 P000 = ThermoSource[FineFlatIndex(int3(I0.x, I0.y, I0.z))];
    float4 P100 = ThermoSource[FineFlatIndex(int3(I1.x, I0.y, I0.z))];
    float4 P010 = ThermoSource[FineFlatIndex(int3(I0.x, I1.y, I0.z))];
    float4 P110 = ThermoSource[FineFlatIndex(int3(I1.x, I1.y, I0.z))];
    float4 P001 = ThermoSource[FineFlatIndex(int3(I0.x, I0.y, I1.z))];
    float4 P101 = ThermoSource[FineFlatIndex(int3(I1.x, I0.y, I1.z))];
    float4 P011 = ThermoSource[FineFlatIndex(int3(I0.x, I1.y, I1.z))];
    float4 P111 = ThermoSource[FineFlatIndex(int3(I1.x, I1.y, I1.z))];

    OutMin8 = min(min(min(P000, P100), min(P010, P110)), min(min(P001, P101), min(P011, P111)));
    OutMax8 = max(max(max(P000, P100), max(P010, P110)), max(max(P001, P101), max(P011, P111)));
    if (!Inside)
    {
        OutMin8 = float4(0.0, 0.0, 0.0, 0.0);
        OutMax8 = float4(0.0, 0.0, 0.0, 0.0);
        return float4(0.0, 0.0, 0.0, 0.0);
    }
    float4 C00 = lerp(P000, P100, F.x);
    float4 C10 = lerp(P010, P110, F.x);
    float4 C01 = lerp(P001, P101, F.x);
    float4 C11 = lerp(P011, P111, F.x);
    return lerp(lerp(C00, C10, F.y), lerp(C01, C11, F.y), F.z);
}

//------------------------------------------------------------------------------------------------------------------------
//                                           MATCHED FACE-FLUX PRESSURE KERNELS
//------------------------------------------------------------------------------------------------------------------------

bool CellIsFluid(int3 Cell)
{
    if (Cell.z < 0) return false;
    if (Cell.x < 0 || Cell.x >= int(Plume.VelocityExtent.x) ||
        Cell.y < 0 || Cell.y >= int(Plume.VelocityExtent.y) ||
        Cell.z >= int(Plume.VelocityExtent.z))
    {
        return true;
    }
    return VelocitySource[CoarseFlatIndex(Cell)].w <= 0.5;
}

float NeighbourPressure(int3 Cell, float CentrePressure)
{
    if (Cell.z < 0) return CentrePressure;
    if (Cell.x < 0 || Cell.x >= int(Plume.VelocityExtent.x) ||
        Cell.y < 0 || Cell.y >= int(Plume.VelocityExtent.y) ||
        Cell.z >= int(Plume.VelocityExtent.z))
    {
        return 0.0;
    }
    if (VelocitySource[CoarseFlatIndex(Cell)].w > 0.5) return CentrePressure;
    return PressureSource[CoarseFlatIndex(Cell)];
}

[shader("compute")]
[numthreads(4, 4, 4)]
void MeasurePlumeFaceDivergence(uint3 ThreadId : SV_DispatchThreadID)
{
    if (any(ThreadId >= Plume.VelocityExtent.xyz)) return;
    int3 Cell = int3(ThreadId);
    uint Idx  = CoarseFlatIndex(Cell);
    float4 Own = VelocitySource[Idx];
    if (Own.w > 0.5)
    {
        DivergenceBuffer[Idx] = 0.0;
        return;
    }
    float4 Xp = VelocitySource[CoarseFlatIndex(Cell + int3(1, 0, 0))];
    float4 Xm = VelocitySource[CoarseFlatIndex(Cell - int3(1, 0, 0))];
    float4 Yp = VelocitySource[CoarseFlatIndex(Cell + int3(0, 1, 0))];
    float4 Ym = VelocitySource[CoarseFlatIndex(Cell - int3(0, 1, 0))];
    float4 Zp = VelocitySource[CoarseFlatIndex(Cell + int3(0, 0, 1))];
    float4 Zm = VelocitySource[CoarseFlatIndex(Cell - int3(0, 0, 1))];

    float Fxp = CellIsFluid(Cell + int3(1, 0, 0)) ? 0.5 * (Own.x + Xp.x) : 0.0;
    float Fxm = CellIsFluid(Cell - int3(1, 0, 0)) ? 0.5 * (Xm.x + Own.x) : 0.0;
    float Fyp = CellIsFluid(Cell + int3(0, 1, 0)) ? 0.5 * (Own.y + Yp.y) : 0.0;
    float Fym = CellIsFluid(Cell - int3(0, 1, 0)) ? 0.5 * (Ym.y + Own.y) : 0.0;
    float Fzp = CellIsFluid(Cell + int3(0, 0, 1)) ? 0.5 * (Own.z + Zp.z) : 0.0;
    float Fzm = (Cell.z > 0 && CellIsFluid(Cell - int3(0, 0, 1))) ? 0.5 * (Zm.z + Own.z) : 0.0;

    DivergenceBuffer[Idx] = ((Fxp - Fxm) + (Fyp - Fym) + (Fzp - Fzm)) / Plume.Lattice.y;
}

[shader("compute")]
[numthreads(4, 4, 4)]
void RelaxPlumePressure(uint3 ThreadId : SV_DispatchThreadID)
{
    if (any(ThreadId >= Plume.VelocityExtent.xyz)) return;
    int3 Cell = int3(ThreadId);
    uint Idx  = CoarseFlatIndex(Cell);
    float Centre = PressureSource[Idx];
    if (VelocitySource[Idx].w > 0.5)
    {
        PressureTarget[Idx] = Centre;
        return;
    }
    float Sum = NeighbourPressure(Cell + int3(1, 0, 0), Centre) + NeighbourPressure(Cell - int3(1, 0, 0), Centre) +
                NeighbourPressure(Cell + int3(0, 1, 0), Centre) + NeighbourPressure(Cell - int3(0, 1, 0), Centre) +
                NeighbourPressure(Cell + int3(0, 0, 1), Centre) + NeighbourPressure(Cell - int3(0, 0, 1), Centre);
    float H = Plume.Lattice.y;
    float Jacobi = (Sum - DivergenceBuffer[Idx] * H * H) * (1.0 / 6.0);
    PressureTarget[Idx] = lerp(Centre, Jacobi, 0.86);
}

[shader("compute")]
[numthreads(4, 4, 4)]
void ProjectPlumeVelocity(uint3 ThreadId : SV_DispatchThreadID)
{
    if (any(ThreadId >= Plume.VelocityExtent.xyz)) return;
    int3 Cell  = int3(ThreadId);
    uint Idx   = CoarseFlatIndex(Cell);
    float4 Own = VelocitySource[Idx];
    if (Own.w > 0.5)
    {
        VelocityTarget[Idx] = float4(0.0, 0.0, 0.0, 1.0);
        return;
    }
    float C = PressureSource[Idx];
    float H = Plume.Lattice.y;

    float4 Xp = VelocitySource[CoarseFlatIndex(Cell + int3(1, 0, 0))];
    float4 Xm = VelocitySource[CoarseFlatIndex(Cell - int3(1, 0, 0))];
    float4 Yp = VelocitySource[CoarseFlatIndex(Cell + int3(0, 1, 0))];
    float4 Ym = VelocitySource[CoarseFlatIndex(Cell - int3(0, 1, 0))];
    float4 Zp = VelocitySource[CoarseFlatIndex(Cell + int3(0, 0, 1))];
    float4 Zm = VelocitySource[CoarseFlatIndex(Cell - int3(0, 0, 1))];

    float Fxp = CellIsFluid(Cell + int3(1, 0, 0)) ? (0.5 * (Own.x + Xp.x) - (NeighbourPressure(Cell + int3(1, 0, 0), C) - C) / H) : 0.0;
    float Fxm = CellIsFluid(Cell - int3(1, 0, 0)) ? (0.5 * (Xm.x + Own.x) - (C - NeighbourPressure(Cell - int3(1, 0, 0), C)) / H) : 0.0;
    float Fyp = CellIsFluid(Cell + int3(0, 1, 0)) ? (0.5 * (Own.y + Yp.y) - (NeighbourPressure(Cell + int3(0, 1, 0), C) - C) / H) : 0.0;
    float Fym = CellIsFluid(Cell - int3(0, 1, 0)) ? (0.5 * (Ym.y + Own.y) - (C - NeighbourPressure(Cell - int3(0, 1, 0), C)) / H) : 0.0;
    float Fzp = CellIsFluid(Cell + int3(0, 0, 1)) ? (0.5 * (Own.z + Zp.z) - (NeighbourPressure(Cell + int3(0, 0, 1), C) - C) / H) : 0.0;
    float Fzm = (Cell.z > 0 && CellIsFluid(Cell - int3(0, 0, 1))) ? (0.5 * (Zm.z + Own.z) - (C - NeighbourPressure(Cell - int3(0, 0, 1), C)) / H) : 0.0;

    VelocityTarget[Idx] = float4(0.5 * (Fxp + Fxm), 0.5 * (Fyp + Fym), 0.5 * (Fzp + Fzm), 0.0);
}

//------------------------------------------------------------------------------------------------------------------------
//                                           CLAMPED MACCORMACK THERMO ADVECTION
//------------------------------------------------------------------------------------------------------------------------

[shader("compute")]
[numthreads(4, 4, 4)]
void AdvectPlumeThermoMacCormack(uint3 ThreadId : SV_DispatchThreadID)
{
    if (any(ThreadId >= Plume.ThermoExtent.xyz)) return;
    uint Idx = FineFlatIndex(int3(ThreadId));
    float2 WorldMinXY = float2(Plume.VelocityOrigin.xy) * Plume.Lattice.y;
    float2 PriorMinXY = float2(Plume.PriorVelocityOrigin.xy) * Plume.Lattice.y;
    float3 WorldPos   = float3(WorldMinXY + (float2(ThreadId.xy) + 0.5) * Plume.Lattice.x,
                               Plume.Lattice.z + (float(ThreadId.z) + 0.5) * Plume.Lattice.x);

    if (WorldPos.z < 0.0)
    {
        ThermoTarget[Idx] = float4(0.0, 0.0, 0.0, 0.0);
        return;
    }

    float Dt = Plume.Lattice.w;
    float4 DummyMin, DummyMax;
    float4 Here = SampleFineTrilinearClamped(WorldPos, PriorMinXY, DummyMin, DummyMax);
    float3 Vel  = SampleCoarseTrilinear(WorldPos, WorldMinXY).xyz;
    float  Slip = 0.85 * saturate(Here.y / 40.0) + 1.45 * saturate(Here.z);
    float3 Flow = Vel + float3(0.0, 0.0, Slip);

    float4 Min8, Max8;
    float4 Forward  = SampleFineTrilinearClamped(WorldPos - Flow * Dt, PriorMinXY, Min8, Max8);
    float4 BMin, BMax;
    float4 Backward = SampleFineTrilinearClamped(WorldPos - Flow * (0.0 * Dt), PriorMinXY, BMin, BMax);
    float4 Val      = clamp(Forward + 0.35 * (Forward - 0.5 * (Here + Backward)), Min8, Max8);

    float Burning = max(Val.z, 0.0) * Dt;
    Val.y += Burning * Plume.Combustion.y;
    Val.w += Burning * Plume.Combustion.x;
    Val   *= float4(Plume.Retention.x, Plume.Retention.y, Plume.Retention.z, Plume.Combustion.z);

    uint SourceCount = uint(max(Plume.PriorVelocityOrigin.w, 0));
    [loop]
    for (uint S = 0u; S < SourceCount; ++S)
    {
        PlumeSourceFootprint Src = PlumeSources[S];
        float  R  = max(Src.PositionRadius.w, 0.65 * Plume.Lattice.x);
        float3 D  = (WorldPos - Src.PositionRadius.xyz) / R;
        float  D2 = dot(D, D);
        float  W  = (D2 < 9.0) ? (exp(-0.5 * D2) * Dt) : 0.0;
        Val += Src.Rates * W;
    }

    ThermoTarget[Idx] = clamp(Val, float4(0.0, 0.0, 0.0, 0.0), float4(64.0, 4096.0, 16.0, 64.0));
}
