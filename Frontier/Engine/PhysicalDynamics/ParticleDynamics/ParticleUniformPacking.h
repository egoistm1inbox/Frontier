/*==========================================================================================================================================
                                                          PARTICLEUNIFORMPACKING.H
==========================================================================================================================================*/
// 🧩 The Particle editor's GPU payloads: an effect's 256-byte uniform, a light fibre's uniform and path samples, the refresh
//    constants, the wind components, the acceleration fields and the lensing block, packed exactly as the prototype packs them.

#pragma once

#include "Engine/PhysicalDynamics/IFieldSampler.h"
#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleEffectLibrary.h"

#include <array>
#include <cstdint>
#include <span>
#include <vector>

namespace Frontier
{

// 📝 Ports of eos PE.fillSys and PE.fillFibre / PE.samplePath (Engine/pe.js, Engine/fibres.js) and of the prototype's camera,
//    PackFields and PackLens (Experimental/ParticleEditor/ParticleEditor.js). Arithmetic runs in doubles and each value is
//    rounded to a float where the prototype stores it into a Float32Array, so the payloads match it bit for bit.

//------------------------------------------------------------------------------------------------------------------------
//                                                    DOMAIN
//------------------------------------------------------------------------------------------------------------------------

// 📝 The wind lattice (eos PE.WIND): 24 × 12 × 24 cells over a 12 × 8 × 12 m box whose floor centre is the origin.
inline constexpr std::array<double, 3>   ParticleDomainMinimum    = { -6.0, 0.0, -6.0 };   // [m]
inline constexpr std::array<double, 3>   ParticleDomainSize       = { 12.0, 8.0, 12.0 };   // [m]
inline constexpr std::array<uint32_t, 3> ParticleDomainDimensions = { 24u, 12u, 24u };
inline constexpr uint32_t                ParticleWindComponentLimit = 16;
inline constexpr uint32_t                ParticleAccelerationLimit  = 8;
inline constexpr uint32_t                ParticleMolecularSlots     = 24;     // eos PE.SLOTS: particles per lattice cell
inline constexpr uint32_t                ParticleMolecularGridLimit = 24;     // eos PE.MAX_GD

using ParticleEffectUniform     = std::array<float, 64>;    // 16 vec4, eos SYS_SLOT
using LightFibreUniform         = std::array<float, 128>;   // eos struct Fib
using ParticleRefreshConstants  = std::array<float, 52>;    // eos glob
using ParticleWindComponents    = std::array<float, ParticleWindComponentLimit * 8>;
using ParticleAccelerationBlock = std::array<float, 128>;
using ParticleLensingBlock      = std::array<float, 32>;

// 📝 Samples the native shared ForceField at particle-lattice texel centres. The origin is in ForceField axes and the
//    returned interleaved RGBA floats are (flow xyz, magnitude), x-fastest, matching the GPU wind texture layout.
[[nodiscard]] std::vector<float> SampleParticleWindLattice(const IFieldSampler& Field,
                                                           const std::array<double, 3>& FieldOriginMetres,
                                                           bool IncludeCurlSwirl = true);

//------------------------------------------------------------------------------------------------------------------------
//                                                    EFFECT UNIFORM
//------------------------------------------------------------------------------------------------------------------------

// 📝 The per-refresh readings an effect's uniform carries besides its parameters (eos fillSys `o`).
struct ParticleEffectRefresh
{
    std::array<double, 3> OriginMetres  = { 0.0, 0.0, 0.0 };   // the release point this refresh (a burst may move it)
    double                StepSeconds   = 0.0;                 // the simulation step (a molecular sub-step)
    double                TimeSeconds   = 0.0;
    uint32_t              Step          = 0;                   // refresh counter
    uint32_t              Capacity      = 0;
    uint32_t              ReleaseCount  = 0;
    uint32_t              Head          = 0;                   // ring position the release starts at
    uint32_t              Seed          = 0;
    bool                  Molecular     = false;
    uint32_t              GridDimension = 1;                   // molecular cells per axis
    double                CellMetres    = 1.0;
};

// 📝 The particle capacity an effect allocates (eos createSystem: at least 64).
[[nodiscard]] uint32_t ResolveParticleCapacity(const ParticleEffectParameters& Parameters) noexcept;

// 📝 The molecular lattice's cells per axis for an effect's box and σ (2.5 σ cut-off), 1 for every other behaviour.
[[nodiscard]] uint32_t ResolveParticleGridDimension(const ParticleEffectParameters& Parameters) noexcept;

void PackParticleEffectUniform(ParticleEffectUniform& Out, const ParticleEffectParameters& Parameters,
                               const ParticleEffectRefresh& Refresh) noexcept;

//------------------------------------------------------------------------------------------------------------------------
//                                                    LIGHT FIBRES
//------------------------------------------------------------------------------------------------------------------------

struct LightFibreRefresh
{
    double LoopFraction    = 0.0;   // (time / loop seconds) mod 1
    double ProjectionScale = 0.0;   // [px] 0.5 · view height / tan(fov / 2)
    double ViewWidth       = 1.0;   // [px]
    double ViewHeight      = 1.0;   // [px]
};

void PackLightFibreUniform(LightFibreUniform& Out, const ParticleEffectParameters& Parameters, const LightFibreRefresh& Refresh);

// 📝 A closed path scaled so its furthest point is SizeMetres from the origin, resampled at equal arc length: Count × vec4
//    (x, y, 0, 0) in the fibre's local plane.
[[nodiscard]] std::vector<float> SampleLightFibrePath(std::string_view Shape, double SizeMetres,
                                                      uint32_t Count = LightFibrePathSamples);

//------------------------------------------------------------------------------------------------------------------------
//                                                    CAMERA AND SCENE
//------------------------------------------------------------------------------------------------------------------------

// 📝 The editor's orbit camera: yaw and pitch about the target, 45° vertical field of view, 0.05 – 400 m depth range.
struct ParticleOrbitCamera
{
    double                Yaw      = 0.6;    // [rad]
    double                Pitch    = 0.3;    // [rad]
    double                Distance = 12.5;   // [m]
    std::array<double, 3> Target   = { 0.0, 1.6, 0.0 };
};

// 📝 A pinhole camera pose in the particle world (Y up). Convert the Everest scene camera from Z-up before resolving it.
struct ParticleCameraPose
{
    std::array<double, 3> Position{};
    std::array<double, 3> Target{1.0, 0.0, 0.0};
    std::array<double, 3> Up{0.0, 1.0, 0.0};
    double                VerticalFieldOfView = 0.7853981633974483;   // [rad]
};

struct ParticleCameraReading
{
    std::array<float, 16> ViewProjection{};   // column-major, depth 0..1
    std::array<double, 3> Eye{};
    std::array<double, 3> Right{};
    std::array<double, 3> Up{};
};

// 📝 The Everest scene is Z-up; the particle world is Y-up. This right-handed axis rotation maps scene (x, y, z) to particle
//    (x, z, −y), preserving world-space camera alignment without changing particle positions.
[[nodiscard]] ParticleCameraPose ConvertSceneCameraToParticleAxes(const ParticleCameraPose& SceneCamera) noexcept;
[[nodiscard]] ParticleCameraReading ResolveParticleCamera(const ParticleCameraPose& Camera, double Aspect) noexcept;
[[nodiscard]] ParticleCameraReading ResolveParticleCamera(const ParticleOrbitCamera& Camera, double Aspect) noexcept;

struct ParticleRefreshReadings
{
    double   TimeSeconds    = 0.0;
    double   DeltaSeconds   = 0.0;
    uint32_t Step           = 0;
    double   LightningFlash = 0.0;   // [0..1]
    uint32_t FlowCount      = 0;     // lattice components in use
};

void PackParticleRefreshConstants(ParticleRefreshConstants& Out, const ParticleCameraReading& Camera,
                                  const ParticleWindSettings& Wind, const ParticleRefreshReadings& Readings) noexcept;

void PackParticleWindComponents(ParticleWindComponents& Out, std::span<const ParticleLatticeComponent> Lattice) noexcept;

// 📝 What one effect contributes to the scene-wide blocks: its origin and its attractor, dipole, lensing and shimmer.
struct ParticleEffectPlacement
{
    const ParticleEffectParameters* Parameters = nullptr;
};

// 📝 Effects' attractors first, then their magnetic dipoles, then the authored acceleration fields; at most eight in all.
void PackParticleAccelerationFields(ParticleAccelerationBlock& Out, std::span<const ParticleEffectPlacement> Effects,
                                    std::span<const ParticleAccelerationEntry> Entries, double TimeSeconds) noexcept;

struct ParticleLensingReading
{
    uint32_t HoleCount    = 0;
    uint32_t ShimmerCount = 0;
};

// 📝 Black-hole lensing and heat shimmer in screen space: up to two of each, in effect order.
ParticleLensingReading PackParticleLensing(ParticleLensingBlock& Out, std::span<const ParticleEffectPlacement> Effects,
                                           const ParticleCameraReading& Camera, double Aspect, double TimeSeconds,
                                           double VerticalFieldOfView = 0.7853981633974483) noexcept;

} // namespace Frontier
