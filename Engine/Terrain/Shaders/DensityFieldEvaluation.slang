/*==========================================================================================================================================
                                                        DENSITYFIELDEVALUATION.SLANG
==========================================================================================================================================*/
// 🧩 GPU evaluation of one density brick: replays the analytic strata of the sequence into Hermite
//    samples (ρ + ∇ρ) for Dual Contouring. The CPU reference is DensityFieldEvaluation; arithmetic
//    must match it term for term so editor previews and cooked worlds agree.
//
// 🚧 Phase 2 skeleton: stratum dispatch table and channel sampling land with the Vulkan viewport.
//    Strata arrive as a flat parameter buffer baked from the document (operation tag + parameters),
//    so this shader never changes when artists reorder the stack.


//----------------------------------------------------------------------------------------------------------------------
//                                                     PUSH CONSTANTS
//----------------------------------------------------------------------------------------------------------------------

struct BrickEvaluationParameters
{
    float3 BrickOriginMeters;  // [m] - World position of brick sample (0, 0, 0)
    float  CellSizeMeters;     // [m] - Tier cell edge length
    uint   StratumCount;       // [-] - Analytic strata to replay (simulations are pre-baked)
    uint   TierIndex;          // [idx] - Tier being evaluated
    float  SeaLevelMeters;     // [m] - World sea level (water-derived masks read it)
    uint   BrickExtentCells;   // [cells] - Brick edge length in samples, halo excluded
};

[[vk::push_constant]] ConstantBuffer<BrickEvaluationParameters> Parameters;

//----------------------------------------------------------------------------------------------------------------------
//                                                    STORAGE BUFFERS
//----------------------------------------------------------------------------------------------------------------------

// One packed stratum: tag selects the analytic function, Parameters carries its descriptor values
//    in registry order. Baking this buffer is TerrainDocumentCodec's job; layout is versioned with it.
struct PackedStratum
{
    uint   OperationTag;    // [-] - Analytic operation selector (registry order)
    uint   BlendCategory;   // [-] - StratumBlendCategory of the document
    float  Opacity;         // [0-1] - Stratum strength before masks
    uint   Seed;            // [-] - Per-stratum stochastic seed
    float4 Parameters[8];   // [-] - Descriptor parameters, zero-padded
};

[[vk::binding(0, 0)]] StructuredBuffer<PackedStratum> Strata;
// 📝 Hermite output: xyz = ∇ρ (unnormalised), w = ρ. (BrickExtentCells + 2)³ samples (one-cell halo).
[[vk::binding(1, 0)]] RWStructuredBuffer<float4> HermiteSamples;
[[vk::binding(2, 0)]] RWStructuredBuffer<uint>  MaterialPayload; // packed MaterialWeightEntry

//----------------------------------------------------------------------------------------------------------------------
//                                                          MAIN
//----------------------------------------------------------------------------------------------------------------------

// 🚧 Each thread composes one sample position through the stratum sequence. Analytic gradients are
//    accumulated where an operation supplies them; otherwise the gradient falls back to central
//    differences of the composed ρ (second dispatch, Phase 2).
[numthreads(4, 4, 4)]
void ComputeMain(uint3 DispatchIndex : SV_DispatchThreadID)
{
    uint ExtentWithHalo = Parameters.BrickExtentCells + 2; // [cells]
    if (any(DispatchIndex >= ExtentWithHalo)) return;

    float3 PositionMeters = Parameters.BrickOriginMeters
        + (float3(DispatchIndex) - 1.0) * Parameters.CellSizeMeters; // [m]

    float ρ = -1.0; // [m] - Running density; strata combine per their blend category
    for (uint StratumIndex = 0; StratumIndex < Parameters.StratumCount; ++StratumIndex)
    {
        PackedStratum Stratum = Strata[StratumIndex];
        // 🚧 Phase 2: EvaluateAnalyticStratum(Stratum, PositionMeters) dispatch on OperationTag,
        //    then CombineByBlendCategory(ρ, candidate, Stratum) under the stratum mask product.
        ρ = ρ; // placeholder keeps the skeleton compilable in isolation
    }

    uint LinearIndex = (DispatchIndex.z * ExtentWithHalo + DispatchIndex.y) * ExtentWithHalo
        + DispatchIndex.x; // [idx]
    HermiteSamples[LinearIndex] = float4(0.0, 1.0, 0.0, ρ);
    MaterialPayload[LinearIndex] = 0;
}
