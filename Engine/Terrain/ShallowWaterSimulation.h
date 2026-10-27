/*==========================================================================================================================================
                                                          SHALLOWWATERSIMULATION.H
==========================================================================================================================================*/
// 🧩 2.5D shallow-water simulation over the density field's surface columns: one pipe-model solver yields
//    hydraulic erosion, thermal talus, rivers, lakes, and the ocean shore — all as named channels.

#pragma once

#include "DensityFieldEvaluation.h"
#include <cstdint>
#include <string>
#include <vector>

namespace Frontier
{

//----------------------------------------------------------------------------------------------------------------------
//                                               SIMULATION CONFIGURATIONS
//----------------------------------------------------------------------------------------------------------------------

// Every physical constant of the Mei–Decaudin–Hu pipe model, exposed. Defaults below are the
//    document preset's starting point, not engine truth: strata carry their own parameter copies.
struct ShallowWaterConfiguration
{
    double GravityMetersPerSecondSquared = 9.80665; // [m/s²] - Flux acceleration
    double ΔτSeconds                     = 0.02;    // [s] - Solver step (stability-checked per cell size)
    double RainRateMetersPerSecond       = 0.002;   // [m/s] - Uniform precipitation input
    double PipeCrossSectionSquareMeters  = 0.5;     // [m²] - Virtual pipe area between columns
    double SedimentCapacityCoefficient   = 1.0;     // [-] - K_c in C = K_c · sin(α) · |v|
    double SuspensionRate                = 0.3;     // [-] - K_s: bed → suspended transfer per step
    double DepositionRate                = 0.3;     // [-] - K_d: suspended → bed transfer per step
    double EvaporationRate               = 0.01;    // [-] - Fraction of column water lost per step
    double MaximumErosionDepthMeters     = 0.0;     // [m] - Per-step bed change ceiling; 0 = unlimited
    uint32_t Iterations                  = 1000;    // [steps] - Bake length for an erosion stratum
};

struct ThermalWeatheringConfiguration
{
    double θTalusDegrees = 35.0; // [deg] - Angle of repose; steeper beds slump, conserving mass
    double SlumpRate     = 0.5;  // [-] - Fraction of the unstable excess moved per step
    uint32_t Iterations  = 200;  // [steps] - Bake length for a weathering stratum
};

// Equilibrium products (rivers / lakes / ocean) derived from the same flux field.
struct WaterBodyConfiguration
{
    double SeaLevelMeters            = 128.0; // [m] - Ocean surface (mirrors the world configuration)
    double RiverDischargeThreshold   = 40.0;  // [m³/s] - Accumulated flux above which a cell is river
    double ShoreDepthBandMeters      = 2.5;   // [m] - Bed depth band classified as shore
    double MinimumLakeAreaCells      = 16.0;  // [cells] - Smaller depressions stay dry (puddle filter)
};

//----------------------------------------------------------------------------------------------------------------------
//                                                    SURFACE COLUMNS
//----------------------------------------------------------------------------------------------------------------------

// 💡 A (x, z) column may cross the surface several times (an arch over a gully). Each solid→air
//    crossing becomes one solver cell bound to the brick sample beneath it, so erosion writes Δρ
//    into the true 3D surface — cliff faces and cave mouths included — not into a 2D proxy.
//    Atmospheric water binds to the topmost crossing unless a stratum targets a lower one.
struct SurfaceColumnEntry
{
    BrickCoordinate Brick;      // [idx] - Brick owning the bound surface sample
    WorldPosition SurfacePoint; // [m] - ρ = 0 crossing position
    double BedElevationMeters = 0.0; // [m] - Solver bed height (the crossing's Y)
    uint32_t CrossingOrdinal  = 0;   // [idx] - 0 = topmost crossing of this column
};

class SurfaceColumnIndex
{
  public:
    // Marches every column of the tier grid through ρ and records its crossings. Rebuilt whenever
    //    the field revision changes inside the simulated region.
    void ConstructFromField(const DensityFieldEvaluation &Evaluation, uint32_t TierIndex,
                            const InvalidatedRegion &Region);
    [[nodiscard]] const std::vector<SurfaceColumnEntry> &QueryEntries() const noexcept { return Entries; }
    [[nodiscard]] uint32_t QueryColumnWidth() const noexcept { return ColumnWidth; }
    [[nodiscard]] uint32_t QueryColumnDepth() const noexcept { return ColumnDepth; }

  private:
    std::vector<SurfaceColumnEntry> Entries; // [-] - Row-major over (x, z); empty cells keep no entry
    std::vector<int32_t> EntryByColumn;      // [idx] - Column → first entry, −1 when the column is void
    uint32_t ColumnWidth = 0;                // [cells] - Grid extent along X
    uint32_t ColumnDepth = 0;                // [cells] - Grid extent along Z
};

//----------------------------------------------------------------------------------------------------------------------
//                                                    SEDIMENT BUDGET
//----------------------------------------------------------------------------------------------------------------------

// Mass accounting is the solver's honesty check: eroded mass must reappear as deposited or
//    suspended mass (within outflow at the region boundary). A bake that fails its budget is
//    refused and reported, never silently kept.
struct SedimentBudget
{
    double ErodedMass    = 0.0; // [m³] - Bed material removed
    double DepositedMass = 0.0; // [m³] - Bed material added
    double SuspendedMass = 0.0; // [m³] - Still in transport at bake end
    double OutflowMass   = 0.0; // [m³] - Left through the region boundary
    [[nodiscard]] double QueryImbalance() const noexcept
    {
        return ErodedMass - (DepositedMass + SuspendedMass + OutflowMass);
    }
};

//----------------------------------------------------------------------------------------------------------------------
//                                                SHALLOW WATER SIMULATION
//----------------------------------------------------------------------------------------------------------------------

// One solver instance serves every Simulate stratum: strata supply configurations, the solver owns
//    the column state (bed, water, sediment, flux, velocity). GPU form lives in
//    Shaders/ShallowWaterStep.slang with identical arithmetic; this CPU form is the reference.
class ShallowWaterSimulation
{
  public:
    void ConfigureShallowWater(ShallowWaterConfiguration Configuration) noexcept { Water = Configuration; }
    void ConfigureThermalWeathering(ThermalWeatheringConfiguration Configuration) noexcept { Thermal = Configuration; }
    void ConfigureWaterBodies(WaterBodyConfiguration Configuration) noexcept { Bodies = Configuration; }

    // Binds solver state to the field region. Returns false when Δτ violates the pipe-model
    //    stability bound for the tier's cell size (refusal, with the bound reported via QueryDiagnostic).
    bool InitializeRegion(DensityFieldEvaluation &Evaluation, uint32_t TierIndex,
                          const InvalidatedRegion &Region);

    // One integrate step, five phases: ① water increment ② pipe flux + velocity ③ erosion–deposition
    //    ④ sediment advection ⑤ evaporation. Thermal slumping interleaves per configuration.
    void IntegrateStep();
    void IntegrateSteps(uint32_t StepCount);

    // Writes accumulated bed change back into the bricks as Δρ along local ∇ρ, publishes the Wear /
    //    Deposition / Flow channels, and returns the closed sediment budget.
    SedimentBudget FinalizeErosion(DensityFieldEvaluation &Evaluation);

    // Equilibrium pass: priority-flood depression filling over surface columns → lake surfaces;
    //    discharge thresholding → river surfaces; sea-level intersection → ocean + shore band.
    //    Publishes WaterSurface / WaterDepth / FlowAccumulation channels for masks and materials.
    void SolveWaterBodies(DensityFieldEvaluation &Evaluation);

    [[nodiscard]] const std::string &QueryDiagnostic() const noexcept { return Diagnostic; }
    [[nodiscard]] const SurfaceColumnIndex &QueryColumns() const noexcept { return Columns; }

  private:
    ShallowWaterConfiguration Water;
    ThermalWeatheringConfiguration Thermal;
    WaterBodyConfiguration Bodies;
    SurfaceColumnIndex Columns;
    std::vector<double> BedMeters;      // [m] - Solver bed per column entry
    std::vector<double> WaterMeters;    // [m] - Water column height per entry
    std::vector<double> SedimentMeters; // [m] - Suspended sediment per entry (as bed-equivalent height)
    std::vector<std::array<double, 4>> Flux; // [m³/s] - Outflow to L/R/T/B neighbours per entry
    std::string Diagnostic;
};

} // namespace Frontier
