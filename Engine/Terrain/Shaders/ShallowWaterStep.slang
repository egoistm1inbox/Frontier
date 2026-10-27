/*==========================================================================================================================================
                                                           SHALLOWWATERSTEP.SLANG
==========================================================================================================================================*/
// 🧩 One GPU step of the shallow-water pipe model over surface columns (flux + velocity phases).
//    Mirrors ShallowWaterSimulation::IntegrateStep term for term; erosion/deposition and sediment
//    advection run as companion dispatches to keep each kernel's data dependencies explicit.
//
// 🚧 Phase 4 skeleton: column state layout is final (it is the cooked channel layout too).


//----------------------------------------------------------------------------------------------------------------------
//                                                     PUSH CONSTANTS
//----------------------------------------------------------------------------------------------------------------------

struct ShallowWaterStepParameters
{
    float ΔτSeconds;               // [s] - Solver step
    float Gravity;                 // [m/s²] - Flux acceleration
    float PipeCrossSection;        // [m²] - Virtual pipe area between columns
    float CellSizeMeters;          // [m] - Column spacing at the simulated tier
    uint  ColumnWidth;             // [cells] - Grid extent along X
    uint  ColumnDepth;             // [cells] - Grid extent along Z
    float RainRateMetersPerSecond; // [m/s] - Uniform precipitation input
    float EvaporationFraction;     // [-] - Per-step water loss fraction
};

[[vk::push_constant]] ConstantBuffer<ShallowWaterStepParameters> Parameters;

//----------------------------------------------------------------------------------------------------------------------
//                                                      COLUMN STATE
//----------------------------------------------------------------------------------------------------------------------

// 📝 IndexByColumn maps each (x, z) column to its bound surface entry (−1 = void column). Deeper
//    crossings of the same column chain through NextCrossing for underground water strata.
[[vk::binding(0, 0)]] StructuredBuffer<int>    EntryByColumn;
[[vk::binding(1, 0)]] RWStructuredBuffer<float> BedMeters;       // [m]
[[vk::binding(2, 0)]] RWStructuredBuffer<float> WaterMeters;     // [m]
[[vk::binding(3, 0)]] RWStructuredBuffer<float> SedimentMeters;  // [m] bed-equivalent height
[[vk::binding(4, 0)]] RWStructuredBuffer<float4> OutflowFlux;    // [m³/s] L/R/T/B

//----------------------------------------------------------------------------------------------------------------------
//                                                          MAIN
//----------------------------------------------------------------------------------------------------------------------

// 🚧 Phase ② of IntegrateStep: pipe flux from total-head differences, outflow clamping so a step can
//    never export more water than the column holds, then water-height integration. Phases ③④⑤ are
//    companion kernels (ErosionDeposition / SedimentAdvection / Evaporation).
[numthreads(8, 8, 1)]
void ComputeMain(uint2 DispatchIndex : SV_DispatchThreadID)
{
    if (DispatchIndex.x >= Parameters.ColumnWidth || DispatchIndex.y >= Parameters.ColumnDepth) return;
    uint ColumnIndex = DispatchIndex.y * Parameters.ColumnWidth + DispatchIndex.x; // [idx]
    int  EntryIndex  = EntryByColumn[ColumnIndex];                                 // [idx]
    if (EntryIndex < 0) return;

    // ① precipitation
    float Water = WaterMeters[EntryIndex] + Parameters.ΔτSeconds * Parameters.RainRateMetersPerSecond; // [m]
    WaterMeters[EntryIndex] = Water;

    // 🚧 Phase 4: neighbour total-head differences → flux accumulation → volume integration.
    OutflowFlux[EntryIndex] = OutflowFlux[EntryIndex];
}
