/*==========================================================================================================================================
                                                            FLUIDSPACE.CPP
==========================================================================================================================================*/
// 🧩 Fluid descriptor validation, GPU input queuing, cell coordinates, and source staging.

#include "Engine/PhysicalDynamics/FluidDynamics/FluidSpace.h"

#include <algorithm>
#include <cmath>

namespace Frontier
{
namespace
{

bool Finite(const Vec3d& Value) noexcept
{
    return std::isfinite(Value.X) && std::isfinite(Value.Y) && std::isfinite(Value.Z);
}

} // namespace

bool FluidSpace::Construct(const FluidSpaceDescriptor& Descriptor, std::string* OutDiagnostic)
{
    const auto& Configuration = Descriptor.Configuration;
    const uint64_t CellCount = static_cast<uint64_t>(Configuration.CellCountX) * Configuration.CellCountY * Configuration.CellCountZ;
    const double CellSpanX = Configuration.CellSpanMetres * Descriptor.Spatial.Scale.X;
    const double CellSpanY = Configuration.CellSpanMetres * Descriptor.Spatial.Scale.Y;
    const double CellSpanZ = Configuration.CellSpanMetres * Descriptor.Spatial.Scale.Z;
    const bool Valid = Configuration.CellCountX >= 2 && Configuration.CellCountX <= 128 &&
                       Configuration.CellCountY >= 2 && Configuration.CellCountY <= 128 &&
                       Configuration.CellCountZ >= 2 && Configuration.CellCountZ <= 128 &&
                       CellCount <= 1048576 && Configuration.PressureIterationCount >= 1 &&
                       Configuration.PressureIterationCount <= 128 && std::isfinite(Configuration.CellSpanMetres) &&
                       Configuration.CellSpanMetres > 0.0 && std::isfinite(Configuration.AmbientTemperatureKelvin) &&
                       Configuration.AmbientTemperatureKelvin > 0.0 &&
                       std::isfinite(Configuration.BuoyancyAccelerationPerKelvin) &&
                       Configuration.BuoyancyAccelerationPerKelvin >= 0.0 &&
                       std::isfinite(Configuration.SmokeDiffusivitySquareMetresPerSecond) &&
                       Configuration.SmokeDiffusivitySquareMetresPerSecond >= 0.0 &&
                       std::isfinite(Configuration.VaporDiffusivitySquareMetresPerSecond) &&
                       Configuration.VaporDiffusivitySquareMetresPerSecond >= 0.0 &&
                       Finite(Descriptor.Spatial.PositionMetres) && Finite(Descriptor.Spatial.OrientationDegrees) &&
                       Finite(Descriptor.Spatial.Scale) && Descriptor.Spatial.Scale.X > 0.0 &&
                       Descriptor.Spatial.Scale.Y > 0.0 && Descriptor.Spatial.Scale.Z > 0.0 &&
                       std::isfinite(CellSpanX) && CellSpanX > 0.0 && std::isfinite(CellSpanY) && CellSpanY > 0.0 &&
                       std::isfinite(CellSpanZ) && CellSpanZ > 0.0 &&
                       std::isfinite(Descriptor.Thermal.TemperatureKelvin) && Descriptor.Thermal.TemperatureKelvin > 0.0;
    if (!Valid)
    {
        if (OutDiagnostic != nullptr) *OutDiagnostic = "FluidSpace configuration is outside its finite supported domain";
        return false;
    }

    Descriptor_ = Descriptor;
    Cells_.assign(static_cast<size_t>(CellCount), FluidCell{});
    PendingSources_.clear();
    const double InitialTemperatureKelvin = Descriptor.Thermal.Enabled ? Descriptor.Thermal.TemperatureKelvin
                                                                       : Configuration.AmbientTemperatureKelvin;
    for (FluidCell& Cell : Cells_) Cell.TemperatureKelvin = InitialTemperatureKelvin;
    ++Revision_;
    if (OutDiagnostic != nullptr) OutDiagnostic->clear();
    return true;
}

void FluidSpace::Reset() noexcept
{
    Cells_.clear();
    PendingSources_.clear();
    ++Revision_;
}

size_t FluidSpace::CellIndex(uint32_t X, uint32_t Y, uint32_t Z) const noexcept
{
    return (static_cast<size_t>(Z) * Descriptor_.Configuration.CellCountY + Y) * Descriptor_.Configuration.CellCountX + X;
}

Vec3d FluidSpace::CellWorldPosition(uint32_t X, uint32_t Y, uint32_t Z) const noexcept
{
    const double Span = Descriptor_.Configuration.CellSpanMetres;
    const Vec3d Local{ (static_cast<double>(X) + 0.5) * Span * Descriptor_.Spatial.Scale.X,
                       (static_cast<double>(Y) + 0.5) * Span * Descriptor_.Spatial.Scale.Y,
                       (static_cast<double>(Z) + 0.5) * Span * Descriptor_.Spatial.Scale.Z };
    return Descriptor_.Spatial.PositionMetres + Descriptor_.Spatial.RotationQuaternion().RotateVector(Local);
}

FluidCell& FluidSpace::AccessCell(uint32_t X, uint32_t Y, uint32_t Z) noexcept
{
    return Cells_[CellIndex(X, Y, Z)];
}

const FluidCell& FluidSpace::QueryCell(uint32_t X, uint32_t Y, uint32_t Z) const noexcept
{
    return Cells_[CellIndex(X, Y, Z)];
}

void FluidSpace::Inject(uint32_t X, uint32_t Y, uint32_t Z, const FluidSourceContribution& Contribution) noexcept
{
    if (Cells_.empty() || X >= QueryCellCountX() || Y >= QueryCellCountY() || Z >= QueryCellCountZ() ||
        PendingSources_.size() >= FluidSourceLimit || !Finite(Contribution.AirVelocityMetresPerSecond) ||
        !std::isfinite(Contribution.SmokeDensityKilogramsPerCubicMetre) ||
        !std::isfinite(Contribution.VaporDensityKilogramsPerCubicMetre) || !std::isfinite(Contribution.TemperatureKelvin))
        return;
    const FluidSpaceConfiguration& Configuration = Descriptor_.Configuration;
    const Vec3d& Scale = Descriptor_.Spatial.Scale;
    const double Radius = 0.49 * Configuration.CellSpanMetres * std::min({ Scale.X, Scale.Y, Scale.Z });
    PendingSources_.push_back({ CellWorldPosition(X, Y, Z), std::max(Radius, 1.0e-4), Contribution });
    ++Revision_;
}

bool FluidSpace::EnqueueRadialSource(const RadialFluidSource& Source, double DeltaSeconds) noexcept
{
    if (PendingSources_.size() >= FluidSourceLimit || !std::isfinite(DeltaSeconds) || DeltaSeconds <= 0.0 || DeltaSeconds > 0.1 ||
        !std::isfinite(Source.RadiusMetres) || Source.RadiusMetres <= 0.0 || !Finite(Source.Spatial.PositionMetres) ||
        !Finite(Source.AirVelocityMetresPerSecond) ||
        !std::isfinite(Source.SmokeDensityRateKilogramsPerCubicMetreSecond) ||
        !std::isfinite(Source.VaporDensityRateKilogramsPerCubicMetreSecond) ||
        !std::isfinite(Source.TemperatureRateKelvinPerSecond))
        return false;

    FluidSourceContribution Delta;
    Delta.AirVelocityMetresPerSecond = Source.AirVelocityMetresPerSecond * DeltaSeconds;
    Delta.SmokeDensityKilogramsPerCubicMetre = Source.SmokeDensityRateKilogramsPerCubicMetreSecond * DeltaSeconds;
    Delta.VaporDensityKilogramsPerCubicMetre = Source.VaporDensityRateKilogramsPerCubicMetreSecond * DeltaSeconds;
    Delta.TemperatureKelvin = Source.TemperatureRateKelvinPerSecond * DeltaSeconds;
    if (!Finite(Delta.AirVelocityMetresPerSecond) || !std::isfinite(Delta.SmokeDensityKilogramsPerCubicMetre) ||
        !std::isfinite(Delta.VaporDensityKilogramsPerCubicMetre) || !std::isfinite(Delta.TemperatureKelvin))
        return false;
    PendingSources_.push_back({ Source.Spatial.PositionMetres, Source.RadiusMetres, Delta });
    ++Revision_;
    return true;
}

} // namespace Frontier
