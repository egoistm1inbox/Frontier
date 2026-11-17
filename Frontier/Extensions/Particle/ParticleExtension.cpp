/*==========================================================================================================================================
                                                        PARTICLEEXTENSION.CPP
==========================================================================================================================================*/
// 🧩 One refresh of the Particle editor's viewport: bring-up on first use, the queue drained (the interface may still sample the
//    last image), the engine's refresh, then the census, probe and (when asked) the wind lattice for the editor.

#include "Frontier/Extensions/Particle/ParticleExtension.h"

#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleSpace.h"

#include <chrono>

namespace Frontier
{

ParticleExtension::ParticleExtension(std::filesystem::path ShaderRoot, const VulkanDeviceAccess* HostDevice)
    : ShaderRoot_(std::move(ShaderRoot))
{
    if (HostDevice != nullptr && HostDevice->Device != VK_NULL_HANDLE)
    {
        Device_             = *HostDevice;
        HostDeviceAttached_ = true;
    }
}

ParticleExtension::~ParticleExtension() = default;

ParticleViewportOutcome ParticleExtension::Render(const ParticleViewportRequest& Request)
{
    ParticleViewportOutcome Outcome;
    if (!Constructed_ && Failure_.empty())
    {
        Sequence_ = std::make_unique<ParticleSimulation::ParticleSimulationSequence>();
        std::string Diagnostic;
        if (Sequence_->Construct(HostDeviceAttached_ ? &Device_ : nullptr, ShaderRoot_ / "ParticleSimulation", &Diagnostic))
        {
            Constructed_ = true;
        }
        else
        {
            Failure_ = "Particle engine bring-up failed: " + Diagnostic;
            Sequence_.reset();
        }
    }
    if (!Constructed_)
    {
        Outcome.Image.Failure = Failure_;
        return Outcome;
    }
    Outcome.Image.Adapter = Sequence_->QueryAdapter();
    if (Request.Plan == nullptr || Request.Effects == nullptr)
    {
        Outcome.Image.Failure = "No refresh plan";
        return Outcome;
    }

    // 📝 On the editor's queue the previous interface frame may still sample the presented image; this refresh writes it.
    if (HostDeviceAttached_) Sequence_->AccessExchange()->AwaitIdle();
    std::string Diagnostic;
    if (!Sequence_->Refresh(*Request.Plan, *Request.Effects, &Diagnostic, Request.FieldSampler.get()))
    {
        Outcome.Image.Failure = "Particle refresh failed: " + Diagnostic;
        return Outcome;
    }
    Outcome.View                      = Sequence_->QueryPresentedView();
    Outcome.Image.Extent              = Sequence_->QueryExtent();
    Outcome.Image.RefreshMilliseconds = Sequence_->QueryRefreshMilliseconds();
    Outcome.Image.StoreBytes          = Sequence_->QueryStoreBytes();
    for (const ParticleEffectInstance& Effect : *Request.Effects)
    {
        const ParticleSimulation::ParticleCensus* Census = Sequence_->QueryCensus(Effect.Token);
        if (Census == nullptr || !Census->Valid) continue;
        Outcome.Image.Census.push_back({ Effect.Token, Census->Alive, Census->SpeciesA, Census->SpeciesB, Census->SpeciesC, Census->Energy });
    }
    const ParticleSimulation::ParticleProbeReading& Probe = Sequence_->QueryProbe();
    Outcome.Image.ProbeValid = Probe.Valid;
    Outcome.Image.Probe      = { Probe.Velocity[0], Probe.Velocity[1], Probe.Velocity[2], Probe.Magnitude };
    if (Request.ReadLattice)
    {
        const auto Started = std::chrono::steady_clock::now();
        auto       Cells   = std::make_shared<std::vector<float>>();
        if (Sequence_->ReadWindLattice(*Cells, &Diagnostic))
        {
            Outcome.Image.Lattice             = std::move(Cells);
            Outcome.Image.LatticeMilliseconds = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - Started).count();
        }
    }
    return Outcome;
}

} // namespace Frontier
