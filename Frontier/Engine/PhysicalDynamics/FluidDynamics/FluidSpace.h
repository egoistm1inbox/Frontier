/*==========================================================================================================================================
                                                            FLUIDSPACE.H
==========================================================================================================================================*/
// 🧩 Fluid simulation descriptor, host-authored source queue, and readback snapshot for the GPU Eulerian solver.

#pragma once

#include "Frontier/Engine/Foundation/Math.h"
#include "Frontier/Engine/Scene/Profiles/ProfileSchemas.h"
#include "Frontier/Engine/Scene/SpaceCodec.h"

#include <cstdint>
#include <string>
#include <vector>

namespace Frontier
{

inline constexpr uint32_t FluidSourceLimit = 64;

struct FluidSpaceConfiguration
{
    uint32_t CellCountX = 16;
    uint32_t CellCountY = 16;
    uint32_t CellCountZ = 16;
    uint32_t PressureIterationCount = 24;
    double CellSpanMetres = 0.25;
    double AmbientTemperatureKelvin = 293.15;
    double BuoyancyAccelerationPerKelvin = 0.02;
    double SmokeDiffusivitySquareMetresPerSecond = 0.0;
    double VaporDiffusivitySquareMetresPerSecond = 0.0;
};

template <>
struct SpaceSchema<FluidSpaceConfiguration>
{
    static constexpr auto Bindings() noexcept
    {
        using F = FluidSpaceConfiguration;
        return std::make_tuple(
            MakeClampedField("cell_count_x", &F::CellCountX, 2.0, 128.0),
            MakeClampedField("cell_count_y", &F::CellCountY, 2.0, 128.0),
            MakeClampedField("cell_count_z", &F::CellCountZ, 2.0, 128.0),
            MakeClampedField("pressure_iteration_count", &F::PressureIterationCount, 1.0, 128.0),
            MakeClampedField("cell_span_metres", &F::CellSpanMetres, 1.0e-3, 1000.0),
            MakeClampedField("ambient_temperature_kelvin", &F::AmbientTemperatureKelvin, 0.01, 100000.0),
            MakeClampedField("buoyancy_acceleration_per_kelvin", &F::BuoyancyAccelerationPerKelvin, 0.0, 100.0),
            MakeClampedField("smoke_diffusivity_square_metres_per_second", &F::SmokeDiffusivitySquareMetresPerSecond, 0.0, 100.0),
            MakeClampedField("vapor_diffusivity_square_metres_per_second", &F::VaporDiffusivitySquareMetresPerSecond, 0.0, 100.0));
    }
};

struct FluidSpaceDescriptor
{
    SpatialProfile Spatial{};
    ThermalProfile Thermal{};
    FluidSpaceConfiguration Configuration{};
};

template <>
struct SpaceSchema<FluidSpaceDescriptor>
{
    static constexpr auto Bindings() noexcept
    {
        using F = FluidSpaceDescriptor;
        return std::make_tuple(
            MakeFieldBinding("spatial", &F::Spatial),
            MakeFieldBinding("thermal", &F::Thermal),
            MakeFieldBinding("fluid", &F::Configuration));
    }
};

// 📝 A CPU-side image of a GPU cell, used only for initial-state upload and explicit telemetry/readback.
struct FluidCell
{
    Vec3d  AirVelocityMetresPerSecond{};
    double SmokeDensityKilogramsPerCubicMetre = 0.0;
    double VaporDensityKilogramsPerCubicMetre = 0.0;
    double TemperatureKelvin = 293.15;
    double PressurePotentialSquareMetresPerSecondSquared = 0.0;
};

struct FluidSourceContribution
{
    Vec3d  AirVelocityMetresPerSecond{};
    double SmokeDensityKilogramsPerCubicMetre = 0.0;
    double VaporDensityKilogramsPerCubicMetre = 0.0;
    double TemperatureKelvin = 0.0;
};

// 📝 Authored radial source in world axes. Its rate fields are converted to per-step deltas before GPU upload.
struct RadialFluidSource
{
    SpatialProfile Spatial{};
    double RadiusMetres = 1.0;
    Vec3d  AirVelocityMetresPerSecond{};
    double SmokeDensityRateKilogramsPerCubicMetreSecond = 0.0;
    double VaporDensityRateKilogramsPerCubicMetreSecond = 0.0;
    double TemperatureRateKelvinPerSecond = 0.0;
};

// 📝 Compact source record consumed by the Fluid compute shader: world centre, radius, and one-step deltas.
struct FluidQueuedSource
{
    Vec3d  CentreWorldMetres{};
    double RadiusMetres = 1.0;
    FluidSourceContribution Delta{};
};

class FluidSpace
{
  public:
    [[nodiscard]] bool Construct(const FluidSpaceDescriptor& Descriptor, std::string* OutDiagnostic = nullptr);
    void               Reset() noexcept;

    [[nodiscard]] const FluidSpaceDescriptor& QueryDescriptor() const noexcept { return Descriptor_; }
    [[nodiscard]] FluidSpaceDescriptor&       AccessDescriptor() noexcept { return Descriptor_; }
    // 📝 QueryCells is the latest explicit readback, not the live solver state. Construct seeds the GPU from this array.
    [[nodiscard]] const std::vector<FluidCell>& QueryCells() const noexcept { return Cells_; }
    [[nodiscard]] std::vector<FluidCell>&       AccessCells() noexcept { return Cells_; }
    [[nodiscard]] uint32_t QueryCellCountX() const noexcept { return Descriptor_.Configuration.CellCountX; }
    [[nodiscard]] uint32_t QueryCellCountY() const noexcept { return Descriptor_.Configuration.CellCountY; }
    [[nodiscard]] uint32_t QueryCellCountZ() const noexcept { return Descriptor_.Configuration.CellCountZ; }
    [[nodiscard]] uint64_t QueryRevision() const noexcept { return Revision_; }

    [[nodiscard]] size_t CellIndex(uint32_t X, uint32_t Y, uint32_t Z) const noexcept;
    [[nodiscard]] Vec3d  CellWorldPosition(uint32_t X, uint32_t Y, uint32_t Z) const noexcept;
    [[nodiscard]] FluidCell&       AccessCell(uint32_t X, uint32_t Y, uint32_t Z) noexcept;
    [[nodiscard]] const FluidCell& QueryCell(uint32_t X, uint32_t Y, uint32_t Z) const noexcept;

    // 📝 Inject and radial-source calls enqueue inputs; the GPU applies them during its next simulation step.
    void Inject(uint32_t X, uint32_t Y, uint32_t Z, const FluidSourceContribution& Contribution) noexcept;
    [[nodiscard]] bool EnqueueRadialSource(const RadialFluidSource& Source, double DeltaSeconds) noexcept;
    [[nodiscard]] const std::vector<FluidQueuedSource>& QueryPendingSources() const noexcept { return PendingSources_; }
    void ClearPendingSources() noexcept { PendingSources_.clear(); }
    void AdvanceRevision() noexcept { ++Revision_; }

  private:
    FluidSpaceDescriptor Descriptor_{};
    std::vector<FluidCell> Cells_{};    // GPU initial values / last explicit readback
    std::vector<FluidQueuedSource> PendingSources_{};
    uint64_t Revision_ = 0;
};

} // namespace Frontier
