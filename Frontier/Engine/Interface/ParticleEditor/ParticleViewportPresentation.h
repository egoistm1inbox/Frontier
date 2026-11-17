/*==========================================================================================================================================
                                                     PARTICLEVIEWPORTPRESENTATION.H
==========================================================================================================================================*/
// 🧩 What the Particle editor asks of the host that owns the GPU, and what it gets back: one refresh plan in, the presented image,
//    the census of every effect, the probe and (when asked) the wind lattice out.

#pragma once

#include <array>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace Frontier
{

class IFieldSampler;
struct ParticleRefreshPlan;
struct ParticleEffectInstance;

// 📝 The editor advances its space on the interface thread and hands the plan over; the host (the editor application, a capture)
//    runs ParticleSimulationSequence on its device and registers the image with the interface renderer.
struct ParticleViewportRequest
{
    const ParticleRefreshPlan*                 Plan    = nullptr;
    const std::vector<ParticleEffectInstance>* Effects = nullptr;
    std::shared_ptr<const IFieldSampler>       FieldSampler; // level ForceField snapshot shared by Particle and Fluid
    bool                                       ReadLattice = false;   // the field overlay wants the wind lattice this refresh
};

struct ParticleEffectCensus
{
    std::string Token;
    uint32_t    Alive    = 0;
    uint32_t    SpeciesA = 0;
    uint32_t    SpeciesB = 0;
    uint32_t    SpeciesC = 0;
    double      Energy   = 0.0;
};

struct ParticleViewportImage
{
    uint64_t                                  Texture = 0;   // ImTextureID; 0 = no image
    std::array<uint32_t, 2>                   Extent{};
    std::string                               Adapter;
    std::string                               Failure;
    double                                    RefreshMilliseconds = 0.0;
    uint64_t                                  StoreBytes          = 0;
    std::vector<ParticleEffectCensus>         Census;
    bool                                      ProbeValid = false;
    std::array<float, 4>                      Probe{};       // velocity [m/s], magnitude
    std::shared_ptr<const std::vector<float>> Lattice;       // four floats per cell when ReadLattice was asked
    double                                    LatticeMilliseconds = 0.0;
};

using ParticleViewportPresenter = std::function<ParticleViewportImage(const ParticleViewportRequest&)>;

} // namespace Frontier
