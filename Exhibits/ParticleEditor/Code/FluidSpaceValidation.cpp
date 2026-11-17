/*==========================================================================================================================================
                                                       FLUIDSPACEVALIDATION.CPP
==========================================================================================================================================*/
// 🧪 Validates Fluid .space schema, queued GPU source inputs, native-field sharing, and Fluid-to-Particle burst routing.

#include "Engine/PhysicalDynamics/AtmosphericFlow.h"
#include "Engine/PhysicalDynamics/ForceField.h"
#include "Engine/PhysicalDynamics/FluidDynamics/FluidSimulationSequence.h"
#include "Engine/PhysicalDynamics/ParticleDynamics/ParticleSpace.h"
#include "Engine/PhysicalDynamics/ParticleDynamics/ParticleTriggerRouter.h"

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <iostream>
#include <string>

namespace
{

bool Require(bool Condition, const char* Message)
{
    if (!Condition) std::cerr << "FluidSpaceValidation: " << Message << '\n';
    return Condition;
}

} // namespace

int main(int ArgumentCount, char** Arguments)
{
    using namespace Frontier;
    const std::filesystem::path Repository = ArgumentCount > 1 ? std::filesystem::path(Arguments[1]) : std::filesystem::current_path();
    FluidSpaceDescriptor Descriptor;
    Descriptor.Spatial.PositionMetres = { 10.0, -2.0, 3.0 };
    Descriptor.Configuration.CellCountX = 8;
    Descriptor.Configuration.CellCountY = 8;
    Descriptor.Configuration.CellCountZ = 8;
    Descriptor.Configuration.PressureIterationCount = 20;
    Descriptor.Configuration.CellSpanMetres = 0.5;
    Descriptor.Configuration.AmbientTemperatureKelvin = 290.0;
    Descriptor.Configuration.SmokeDiffusivitySquareMetresPerSecond = 0.015;
    Descriptor.Configuration.VaporDiffusivitySquareMetresPerSecond = 0.01;

    std::string Diagnostic;
    std::string Text;
    if (!Require(EncodeSpaceText("frontier.fluidspace", 1, Descriptor, Text), "schema encoding failed")) return 1;
    FluidSpaceDescriptor RoundTrip;
    if (!Require(DecodeSpaceText(Text, "frontier.fluidspace", 1, RoundTrip, &Diagnostic), "schema decoding failed")) return 1;

    const std::filesystem::path ScratchDirectory = std::filesystem::temp_directory_path() / "FrontierFluidSpaceValidation";
    const std::filesystem::path FluidPath = ScratchDirectory / "Validation.fluidspace";
    const std::filesystem::path ForbiddenPath = ScratchDirectory / "Validation.toml";
    if (!Require(EncodeSpaceFile(FluidPath, ".fluidspace", "frontier.fluidspace", 1, Descriptor, &Diagnostic),
                 "fluidspace file encoding failed")) return 1;
    FluidSpaceDescriptor FileRoundTrip;
    if (!Require(DecodeSpaceFile(FluidPath, ".fluidspace", "frontier.fluidspace", 1, FileRoundTrip, &Diagnostic),
                 "fluidspace file decoding failed")) return 1;
    if (!Require(!EncodeSpaceFile(ForbiddenPath, ".fluidspace", "frontier.fluidspace", 1, Descriptor, &Diagnostic),
                 "forbidden TOML extension was accepted")) return 1;
    std::filesystem::remove_all(ScratchDirectory);
    if (!Require(RoundTrip.Configuration.CellCountX == 8 && RoundTrip.Spatial.PositionMetres == Descriptor.Spatial.PositionMetres,
                 "descriptor round-trip lost fields")) return 1;

    FluidSpace Space;
    if (!Require(Space.Construct(RoundTrip, &Diagnostic), "FluidSpace construction failed")) return 1;
    const Vec3d CellOrigin = Space.CellWorldPosition(3, 3, 3);
    RadialFluidSource Source;
    Source.Spatial.PositionMetres = CellOrigin;
    Source.RadiusMetres = 1.1;
    Source.AirVelocityMetresPerSecond = { 0.5, 0.0, 0.0 };
    Source.SmokeDensityRateKilogramsPerCubicMetreSecond = 8.0;
    Source.VaporDensityRateKilogramsPerCubicMetreSecond = 8.0;
    Source.TemperatureRateKelvinPerSecond = 2400.0;
    if (!Require(Space.EnqueueRadialSource(Source, 0.05), "valid radial source was rejected")) return 1;
    if (!Require(Space.QueryPendingSources().size() == 1, "radial source was not queued for the GPU")) return 1;
    if (!Require(Space.QueryCell(3, 3, 3).SmokeDensityKilogramsPerCubicMetre == 0.0 &&
                 Space.QueryCell(3, 3, 3).AirVelocityMetresPerSecond == Vec3d{},
                 "source queue changed host snapshot before GPU execution")) return 1;
    if (!Require(!Space.EnqueueRadialSource(Source, 0.0), "invalid radial-source timestep was accepted")) return 1;

    // 📝 The level owns one native ForceField snapshot; Fluid samples it as a GPU input and Particle uses it over the wind lattice.
    ForceFieldSpace SharedField;
    PlanetaryWindProfile SharedWind;
    SharedWind.BearingRadians = 0.0;
    SharedWind.SpeedMetersPerSecond = 3.0;
    SharedWind.GustAmplitude = 0.0;
    SharedWind.ShearPerKilometer = 0.0;
    SharedWind.VeerRadiansPerKilometer = 0.0;
    SharedWind.SwirlStrength = 0.0;
    SharedWind.MesoscaleStrength = 0.0;
    SharedField.SetWindProfile(SharedWind);
    SharedField.SetElapsedSeconds(0.0);
    if (!Require(SharedField.QueryFieldEnabled() && Length(SharedField.SampleWorldFlow(CellOrigin)) > 0.1,
                 "native ForceField did not produce a world-space flow sample")) return 1;

    ParticleEffectLibrary Library;
    if (!Require(Library.Decode(Repository / "EngineContent" / "ParticleArchives" / "ParticleLibrary.particlespace", Diagnostic),
                 "Particle library could not be loaded for Fluid-to-Particle coupling")) return 1;
    ParticleSpace NativeParticles;
    NativeParticles.ConstructDefault(Library);
    NativeParticles.LevelWind.Follow = true;
    NativeParticles.LevelWind.AnchorMetres = { Descriptor.Spatial.PositionMetres.X, Descriptor.Spatial.PositionMetres.Y,
                                                Descriptor.Spatial.PositionMetres.Z };
    const ParticleRefreshPlan NativePlan = NativeParticles.Advance(0.05, 640, 360, nullptr, &SharedField);
    const std::vector<float> NativeLattice = SampleParticleWindLattice(SharedField, NativePlan.SharedFieldOriginMetres, false);
    if (!Require(NativePlan.SharedFieldActive &&
                 std::any_of(NativeLattice.begin(), NativeLattice.end(), [](float Value) { return std::fabs(Value) > 0.01f; }),
                 "native ForceField did not drive the Particle wind lattice")) return 1;

    FluidBurstTriggerEvent Burst;
    Burst.WorldPointMetres = CellOrigin;
    Burst.ImpulseDirection = { 0.0, 0.0, 1.0 };
    Burst.ThermalIntensity = 1.0;
    Burst.VaporIntensity = 0.8;
    Burst.SmokeIntensity = 0.7;
    Burst.EnergyScale = 1.0;
    Burst.TriggerSeed = 1234;
    const ParticleTriggerRouter Router = ParticleTriggerRouter::ConstructDefaultRouter();
    const std::vector<ParticleBurstReceipt> Receipts = Router.DispatchFluidBurst(Burst, NativeParticles, Library);
    if (!Require(!Receipts.empty() && !NativeParticles.Effects.empty() &&
                 std::any_of(NativeParticles.Effects.begin(), NativeParticles.Effects.end(), [](const ParticleEffectInstance& Effect) {
                     return Effect.PendingBurst > 0;
                 }), "Fluid burst did not route through ParticleTriggerRouter into ParticleSpace")) return 1;

    FluidSimulationSequence Sequence;
    if (!Require(!Sequence.Advance(Space, 0.05, &SharedField, &Diagnostic) && !Diagnostic.empty(),
                 "GPU Fluid simulation advanced before a Vulkan sequence was constructed")) return 1;
    std::cout << "FluidSpaceValidation: schema, queued GPU sources, shared native field input, burst routing, and construction guards passed\n";
    return 0;
}
