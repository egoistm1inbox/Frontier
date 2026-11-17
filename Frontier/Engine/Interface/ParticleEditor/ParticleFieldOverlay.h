/*==========================================================================================================================================
                                                         PARTICLEFIELDOVERLAY.H
==========================================================================================================================================*/
// 🧩 The Particle editor's field overlay: the Force Field editor's visualization in Camera mode over the particle image, sampling
//    the wind lattice read back from the GPU (flow), the packed acceleration fields (accelerate) and the damping volumes (damp).

#pragma once

#include "Engine/Diagnostics/BuildConfiguration.h"

#if FRONTIER_EDITOR && defined(FRONTIER_WITH_INTERFACE_SDK)

#include "Engine/Interface/ForceFieldVisualization/ForceFieldVisualization.h"
#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleSpace.h"

#include <imgui.h>

#include <array>
#include <memory>
#include <vector>

namespace Frontier
{

struct EditorTypefaces;

// 📝 A port of the prototype's overlay (ParticleEditor.js RenderOverlay, ParticleFieldReadback.js): the lattice is read back
//    every 150 ms, sampled trilinearly as the GPU samples it, and the acceleration is fieldAccel evaluated on the CPU.
struct ParticleOverlaySettings
{
    bool               Enabled      = true;
    ForceContribution  Contribution = ForceContribution::Flow;
    ForceFieldQuantity Quantity     = ForceFieldQuantity::Speed;
    bool               Heatmap      = true;
    bool               Arrows       = true;
    bool               Tracers      = false;
    bool               Labels       = true;
    double             SliceHeight  = 1.2;     // [m]
    float              Opacity      = 0.38f;
    float              ArrowSpacing = 34.0f;   // [px]
};

class ParticleFieldOverlay
{
public:
    ParticleFieldOverlay();

    // 📝 A new lattice (four floats per cell, x fastest) and this refresh's fields; each call re-samples the slice.
    void ConfigureLattice(std::shared_ptr<const std::vector<float>> Cells, const ParticleSpace& Space, const ParticleRefreshPlan& Plan);

    void Render(ImDrawList* Ink, const EditorTypefaces& Faces, ImVec2 Minimum, ImVec2 Maximum, const ParticleSpace& Space, float Scale);

    // 📝 The contribution at a domain point: m/s, m/s² or the damping rate in X.
    [[nodiscard]] SpatialVector Sample(ForceContribution Contribution, SpatialVector Point) const;

    ParticleOverlaySettings Settings;
    ForceFieldVisualization Slice;

private:
    std::shared_ptr<const std::vector<float>> Cells_;
    std::shared_ptr<ParticleAccelerationBlock> Accelerations_;
    std::shared_ptr<std::vector<ParticleField>> Fields_;
    double   TimeSeconds_ = 0.0;
    uint64_t Revision_    = 0;
};

// 📝 eos fieldAccel on the CPU (the prototype's EvaluateFieldAcceleration): the acceleration the packed fields give at a point.
[[nodiscard]] std::array<double, 3> EvaluateParticleFieldAcceleration(const ParticleAccelerationBlock& Fields, const std::array<double, 3>& Point);

// 📝 The lattice sampled as the GPU's linear sampler reads it (clamped at the edge, zero outside the domain).
[[nodiscard]] std::array<double, 3> SampleParticleWindLattice(const std::vector<float>& Cells, const std::array<double, 3>& Point);

} // namespace Frontier

#endif
