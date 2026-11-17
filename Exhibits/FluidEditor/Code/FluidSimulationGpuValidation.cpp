/*==========================================================================================================================================
                                                  FLUIDSIMULATIONGPUVALIDATION.CPP
==========================================================================================================================================*/
// 🧪 Executes the native Fluid solver on Vulkan/Slang and validates source, ForceField, projection, readback and burst behavior.
//
//     FluidSimulationGpuValidation <repository root> <FluidSimulation shader archive directory>

#include "Engine/PhysicalDynamics/AtmosphericFlow.h"
#include "Engine/PhysicalDynamics/ForceField.h"
#include "Engine/PhysicalDynamics/FluidDynamics/FluidSimulationSequence.h"
#include "Engine/PhysicalDynamics/ParticleDynamics/ParticleEffectLibrary.h"
#include "Engine/PhysicalDynamics/ParticleDynamics/ParticleSpace.h"
#include "Engine/PhysicalDynamics/ParticleDynamics/ParticleTriggerRouter.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <iostream>
#include <string>
#include <vector>

namespace
{

bool Require(bool Condition, const std::string& Message)
{
    if (!Condition) std::cerr << "FluidSimulationGpuValidation: " << Message << '\n';
    return Condition;
}

double DivergenceRms(const Frontier::FluidSpace& Space)
{
    const uint32_t Width = Space.QueryCellCountX();
    const uint32_t Height = Space.QueryCellCountY();
    const uint32_t Depth = Space.QueryCellCountZ();
    const Frontier::FluidSpaceDescriptor& Descriptor = Space.QueryDescriptor();
    const double CellSpan = Descriptor.Configuration.CellSpanMetres;
    double Sum = 0.0;
    for (uint32_t Z = 0; Z < Depth; ++Z)
        for (uint32_t Y = 0; Y < Height; ++Y)
            for (uint32_t X = 0; X < Width; ++X)
            {
                const Frontier::Vec3d Right = Space.QueryCell(std::min(X + 1u, Width - 1u), Y, Z).AirVelocityMetresPerSecond;
                const Frontier::Vec3d Left = Space.QueryCell(X == 0u ? 0u : X - 1u, Y, Z).AirVelocityMetresPerSecond;
                const Frontier::Vec3d Up = Space.QueryCell(X, std::min(Y + 1u, Height - 1u), Z).AirVelocityMetresPerSecond;
                const Frontier::Vec3d Down = Space.QueryCell(X, Y == 0u ? 0u : Y - 1u, Z).AirVelocityMetresPerSecond;
                const Frontier::Vec3d Front = Space.QueryCell(X, Y, std::min(Z + 1u, Depth - 1u)).AirVelocityMetresPerSecond;
                const Frontier::Vec3d Back = Space.QueryCell(X, Y, Z == 0u ? 0u : Z - 1u).AirVelocityMetresPerSecond;
                const double D = 0.5 / CellSpan * ((Right.X - Left.X) + (Up.Y - Down.Y) + (Front.Z - Back.Z));
                Sum += D * D;
            }
    return std::sqrt(Sum / static_cast<double>(static_cast<uint64_t>(Width) * Height * Depth));
}

bool AllFinite(const Frontier::FluidSpace& Space)
{
    for (const Frontier::FluidCell& Cell : Space.QueryCells())
    {
        if (!std::isfinite(Cell.AirVelocityMetresPerSecond.X) || !std::isfinite(Cell.AirVelocityMetresPerSecond.Y) ||
            !std::isfinite(Cell.AirVelocityMetresPerSecond.Z) || !std::isfinite(Cell.SmokeDensityKilogramsPerCubicMetre) ||
            !std::isfinite(Cell.VaporDensityKilogramsPerCubicMetre) || !std::isfinite(Cell.TemperatureKelvin) ||
            !std::isfinite(Cell.PressurePotentialSquareMetresPerSecondSquared))
            return false;
    }
    return true;
}

} // namespace

int main(int ArgumentCount, char** Arguments)
{
    using namespace Frontier;
    if (ArgumentCount < 3)
    {
        std::cerr << "usage: FluidSimulationGpuValidation <repository root> <shader archive directory>\n";
        return 2;
    }
    const std::filesystem::path Repository = Arguments[1];
    const std::filesystem::path ShaderFolder = Arguments[2];
    for (const char* Entry : { "FluidForces.ApplyFluidForces.spv", "FluidAdvection.AdvectFluid.spv",
                               "FluidDiffusion.DiffuseFluidScalars.spv", "FluidDivergence.ComputeFluidDivergence.spv",
                               "FluidPressureSolve.SolveFluidPressure.spv", "FluidProjection.ProjectFluidPressure.spv",
                               "FluidPreview.RenderFluidPreview.spv" })
    {
        if (!Require(std::filesystem::is_regular_file(ShaderFolder / Entry), std::string("missing compiled Slang entry: ") + Entry)) return 1;
    }

    FluidSpaceDescriptor Descriptor;
    Descriptor.Spatial.PositionMetres = { 10.0, -2.0, 3.0 };
    Descriptor.Configuration.CellCountX = 8;
    Descriptor.Configuration.CellCountY = 8;
    Descriptor.Configuration.CellCountZ = 8;
    Descriptor.Configuration.PressureIterationCount = 48;
    Descriptor.Configuration.CellSpanMetres = 0.5;
    Descriptor.Configuration.AmbientTemperatureKelvin = 290.0;
    Descriptor.Configuration.BuoyancyAccelerationPerKelvin = 0.0;
    Descriptor.Configuration.SmokeDiffusivitySquareMetresPerSecond = 0.0;
    Descriptor.Configuration.VaporDiffusivitySquareMetresPerSecond = 0.0;

    FluidSpace Space;
    std::string Diagnostic;
    if (!Require(Space.Construct(Descriptor, &Diagnostic), "FluidSpace construction failed: " + Diagnostic)) return 1;
    for (uint32_t Z = 0; Z < Space.QueryCellCountZ(); ++Z)
        for (uint32_t Y = 0; Y < Space.QueryCellCountY(); ++Y)
            for (uint32_t X = 0; X < Space.QueryCellCountX(); ++X)
                Space.AccessCell(X, Y, Z).AirVelocityMetresPerSecond = {
                    (static_cast<double>(X) - 3.5) * 0.10,
                    (static_cast<double>(Y) - 3.5) * 0.08,
                    (static_cast<double>(Z) - 3.5) * 0.06 };
    const double InitialDivergence = DivergenceRms(Space);

    RadialFluidSource Source;
    Source.Spatial.PositionMetres = Space.CellWorldPosition(3, 3, 3);
    Source.RadiusMetres = 1.1;
    Source.AirVelocityMetresPerSecond = { 0.5, 0.0, 0.0 };
    Source.SmokeDensityRateKilogramsPerCubicMetreSecond = 8.0;
    Source.VaporDensityRateKilogramsPerCubicMetreSecond = 8.0;
    Source.TemperatureRateKelvinPerSecond = 2400.0;
    if (!Require(Space.EnqueueRadialSource(Source, 0.05), "valid GPU radial source was not queued")) return 1;

    ForceFieldSpace SharedField;
    PlanetaryWindProfile Wind;
    Wind.BearingRadians = 0.0;
    Wind.SpeedMetersPerSecond = 3.0;
    Wind.GustAmplitude = 0.0;
    Wind.ShearPerKilometer = 0.0;
    Wind.VeerRadiansPerKilometer = 0.0;
    Wind.SwirlStrength = 0.0;
    Wind.MesoscaleStrength = 0.0;
    SharedField.SetWindProfile(Wind);
    SharedField.SetElapsedSeconds(0.0);

    FluidSimulationSequence Sequence;
    if (!Sequence.Construct(Space, nullptr, ShaderFolder, &Diagnostic, 96, 64))
    {
        std::cerr << "FluidSimulationGpuValidation: Vulkan/Slang initialization failed: " << Diagnostic << '\n';
        // 📝 An absent host Vulkan loader/device is an environment skip; shader or GPU execution errors remain test failures.
        if (Diagnostic.find("Vulkan loader not found") != std::string::npos || Diagnostic.find("no Vulkan physical device") != std::string::npos ||
            Diagnostic.find("lacks Vulkan 1.3") != std::string::npos)
            return 77;
        return 1;
    }
    std::cout << "FluidSimulationGpuValidation: executing Slang compute on " << Sequence.QueryAdapter() << '\n';

    const uint64_t BeforeRevision = Space.QueryRevision();
    if (!Require(Sequence.Advance(Space, 0.05, &SharedField, &Diagnostic), "GPU step failed: " + Diagnostic)) return 1;
    if (!Require(Space.QueryRevision() == BeforeRevision + 1 && Space.QueryPendingSources().empty(),
                 "successful GPU step did not consume queued sources and advance the space revision")) return 1;
    // 📝 Advance leaves the host image untouched until an explicit readback; this guards against a CPU simulation fallback.
    if (!Require(Space.QueryCell(3, 3, 3).SmokeDensityKilogramsPerCubicMetre == 0.0,
                 "Advance modified host cells before GPU readback")) return 1;
    if (!Require(Sequence.Readback(Space, &Diagnostic), "GPU state readback failed: " + Diagnostic)) return 1;
    if (!Require(AllFinite(Space), "GPU solver produced a non-finite cell")) return 1;

    double SmokeMassSignal = 0.0;
    double VaporSignal = 0.0;
    double MaximumTemperature = 0.0;
    double MeanWindX = 0.0;
    for (const FluidCell& Cell : Space.QueryCells())
    {
        SmokeMassSignal += Cell.SmokeDensityKilogramsPerCubicMetre;
        VaporSignal += Cell.VaporDensityKilogramsPerCubicMetre;
        MaximumTemperature = std::max(MaximumTemperature, Cell.TemperatureKelvin);
        MeanWindX += Cell.AirVelocityMetresPerSecond.X;
    }
    MeanWindX /= static_cast<double>(Space.QueryCells().size());
    const double ProjectedDivergence = DivergenceRms(Space);
    if (!Require(SmokeMassSignal > 0.01 && VaporSignal > 0.01 && MaximumTemperature > Descriptor.Configuration.AmbientTemperatureKelvin + 20.0,
                 "GPU source injection did not persist smoke, vapor, and thermal channels")) return 1;
    if (!Require(MeanWindX > 0.1, "native ForceField flow did not reach GPU Fluid cells")) return 1;
    if (!Require(ProjectedDivergence < InitialDivergence, "GPU Jacobi pressure projection did not reduce the divergent velocity field"))
    {
        std::cerr << "  initial divergence RMS=" << InitialDivergence << ", projected=" << ProjectedDivergence << '\n';
        return 1;
    }

    const std::vector<FluidBurstTriggerEvent> Events = Sequence.CollectBurstTriggers(Space, 0.05, 0.01, 0.01);
    if (!Require(!Events.empty() && Events.front().EnergyScale > 0.0, "GPU Fluid readback did not create burst events")) return 1;
    ParticleEffectLibrary Library;
    if (!Require(Library.Decode(Repository / "EngineContent/ParticleArchives/ParticleLibrary.particlespace", Diagnostic),
                 "Particle library decode failed: " + Diagnostic)) return 1;
    ParticleSpace Particles;
    const ParticleTriggerRouter Router = ParticleTriggerRouter::ConstructDefaultRouter();
    const std::vector<ParticleBurstReceipt> Receipts = Router.DispatchFluidBurst(Events.front(), Particles, Library);
    if (!Require(!Receipts.empty() && std::any_of(Particles.Effects.begin(), Particles.Effects.end(), [](const ParticleEffectInstance& Effect) {
                     return Effect.PendingBurst > 0;
                 }), "GPU Fluid burst did not route through ParticleTriggerRouter")) return 1;

    if (!Require(Sequence.RenderPreview(&Diagnostic), "GPU preview dispatch failed: " + Diagnostic)) return 1;
    std::vector<uint8_t> Preview;
    if (!Require(Sequence.ReadPreviewImage(Preview, &Diagnostic), "GPU preview readback failed: " + Diagnostic)) return 1;
    if (!Require(Preview.size() == 96u * 64u * 4u &&
                 std::any_of(Preview.begin(), Preview.end(), [](uint8_t Value) { return Value != 0; }),
                 "GPU volume preview returned an empty or incorrectly sized image")) return 1;

    // 📝 Descriptor mutation after construction is revalidated before any GPU submission.
    FluidSpace MutatedDescriptor;
    if (!Require(MutatedDescriptor.Construct(Descriptor, &Diagnostic), "mutation-check FluidSpace construction failed")) return 1;
    MutatedDescriptor.AccessDescriptor().Spatial.Scale.X = 0.0;
    if (!Require(!Sequence.Advance(MutatedDescriptor, 0.05, nullptr, &Diagnostic) && !Diagnostic.empty(),
                 "GPU sequence accepted a descriptor made invalid after allocation")) return 1;

    // 📝 A constructed sequence owns its device resources and cannot be rebound by a second Construct call.
    if (!Require(!Sequence.Construct(Space, nullptr, ShaderFolder, &Diagnostic) && !Diagnostic.empty(),
                 "GPU sequence accepted a duplicate Construct call")) return 1;

    // 📝 A disabled sampler is not a zero-strength override: it must not inject the native field wind.
    ForceFieldSpace DisabledField;
    DisabledField.ConfigureEnabled(false);
    FluidSpace FallbackSpace;
    if (!Require(FallbackSpace.Construct(Descriptor, &Diagnostic), "disabled-field FluidSpace construction failed")) return 1;
    if (!Require(Sequence.Reset(FallbackSpace, &Diagnostic), "GPU reset failed: " + Diagnostic)) return 1;
    if (!Require(Sequence.Advance(FallbackSpace, 0.05, &DisabledField, &Diagnostic), "disabled-field GPU step failed: " + Diagnostic)) return 1;
    if (!Require(Sequence.Readback(FallbackSpace, &Diagnostic), "disabled-field readback failed: " + Diagnostic)) return 1;
    const bool NoFieldVelocity = std::all_of(FallbackSpace.QueryCells().begin(), FallbackSpace.QueryCells().end(), [](const FluidCell& Cell) {
        return LengthSquared(Cell.AirVelocityMetresPerSecond) < 1.0e-8;
    });
    if (!Require(NoFieldVelocity, "disabled sampler overrode the Fluid standalone zero-flow state")) return 1;

    if (!Require(!Sequence.Advance(FallbackSpace, 0.0, nullptr, &Diagnostic) && !Diagnostic.empty(),
                 "GPU solver accepted an invalid zero timestep")) return 1;
    std::cout << "FluidSimulationGpuValidation: source transport, shared ForceField input, pressure projection, readback, preview and burst routing passed"
              << " (divergence " << InitialDivergence << " -> " << ProjectedDivergence << ")\n";
    return 0;
}
