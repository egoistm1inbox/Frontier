/*==========================================================================================================================================
                                                             PARTICLESPACE.H
==========================================================================================================================================*/
// 🧩 The particle space, the world the effects live in: its effects, force fields, wind, camera, lightning and clock, advanced one refresh at a time into
//    the plan the GPU sequence carries out.

#pragma once

#include "Engine/PhysicalDynamics/IFieldSampler.h"
#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleLightning.h"
#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleTriggerRouter.h"
#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleUniformPacking.h"
#include "Frontier/Engine/Scene/Profiles/MassProfile.h"
#include "Frontier/Engine/Scene/Profiles/ReplicationProfile.h"
#include "Frontier/Engine/Scene/Profiles/SpatialProfile.h"

#include <array>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace toml
{
inline namespace v3
{
class table;
}
} // namespace toml

namespace Frontier
{

// 📝 A port of the prototype's scene and refresh (Experimental/ParticleEditor/ParticleEditor.js: Scene, ConstructEffect,
//    ApplyWindLink, Advance, ConstructLines). Math.random becomes one seeded generator, so a space replays identically.

//------------------------------------------------------------------------------------------------------------------------
//                                                    EFFECTS
//------------------------------------------------------------------------------------------------------------------------

struct ParticleEffectInstance
{
    std::string                          Token;              // "fx_<number>"
    uint32_t                             Number = 0;
    std::string                          PresetIdentifier;
    std::string                          Name;
    ParticleEffectParameters             Parameters;
    double                               Accumulated  = 0.0;   // fractional releases carried to the next refresh
    uint32_t                             PendingBurst = 0;
    std::optional<std::array<double, 3>> OverrideOrigin;
    bool                                 NeedFill     = true;  // molecular effects fill their capacity once
    uint32_t                             Head         = 0;     // ring position of the next release
    std::optional<double>                BurstTimerSeconds;
    uint64_t                             StoreGeneration = 0;  // a new generation asks the GPU for fresh stores

    // 📝 Composable profiles: world placement (z up), a representative medium mass for coupled physics exchange, and the
    //    per-effect network replication gate. Live revisions are not stored by the codec.
    SpatialProfile     Spatial;
    MassProfile        Mass;
    ReplicationProfile Replication;
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    REFRESH PLAN
//------------------------------------------------------------------------------------------------------------------------

// 📝 One effect's work this refresh (eos job).
struct ParticleRefreshJob
{
    uint32_t              EffectIndex   = 0;
    bool                  LightFibre    = false;
    bool                  Simulate      = false;
    bool                  Molecular     = false;
    bool                  Swarm         = false;
    uint32_t              Release       = 0;
    uint32_t              Steps         = 0;       // molecular sub-steps
    uint32_t              GridDimension = 1;
    bool                  ReadCensus    = false;
    bool                  Rasterize     = false;
    bool                  AlphaOver     = false;
    bool                  Cube          = false;
    bool                  Shards        = false;
    bool                  Butterflies   = false;
    ParticleEffectUniform Uniform{};
    LightFibreUniform     FibreUniform{};
    std::vector<float>    FibrePath;               // filled when the path changed this refresh
    uint32_t              Strands  = 0;
    uint32_t              Segments = 0;
    bool                  Sparks   = false;
};

struct ParticleRefreshPlan
{
    ParticleCameraReading                  Camera;
    bool                                   SharedFieldActive = false;
    std::array<double, 3>                  SharedFieldOriginMetres{}; // native ForceField axes; particle domain origin in level space
    ParticleRefreshConstants               Constants{};
    ParticleWindComponents                 Components{};
    ParticleAccelerationBlock              Fields{};
    ParticleLensingBlock                   Lensing{};
    ParticleLensingReading                 LensingCounts;
    std::array<float, 3>                   Clear = { 0.035f, 0.037f, 0.045f };
    bool                                   TransparentBackground = false;   // clear to zero alpha for scene compositing; off in the Particle editor
    bool                                   Floor  = true;
    bool                                   Arrows = false;
    std::vector<float>                     Guides;          // 7 floats per vertex: position, rgba
    std::vector<float>                     Segments;        // lightning, 8 floats per segment
    uint32_t                               SegmentCount = 0;
    std::vector<ParticleRefreshJob>        Jobs;
    std::optional<std::array<uint32_t, 3>> ProbeCell;
    uint32_t                               ViewWidth  = 1;
    uint32_t                               ViewHeight = 1;
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    SPACE
//------------------------------------------------------------------------------------------------------------------------

// 📝 The level's Force Field at the place the particle domain stands in the level. When followed, the native sampler drives
//    the full 3D wind lattice; the legacy local flow list is bypassed (particle-specific acceleration/damping fields remain).
struct ParticleLevelWind
{
    bool                                 Follow       = true;
    std::array<double, 3>                AnchorMetres = { 0.0, 0.0, 2.0 };   // level axes (z up)
    std::optional<std::array<double, 3>> FlowMps;                            // domain axes (y up); not stored
};

struct ParticleLightningWeb
{
    bool     Enabled         = false;
    double   IntervalSeconds = 0.6;
    double   NextSeconds     = 0.0;
    uint32_t Links           = 2;
};

class ParticleSpace
{
public:
    explicit ParticleSpace(uint32_t Seed = 20261104u) noexcept : RandomCounter(Seed) {}

    // 📝 The prototype's opening space: the default force list and wind, then the named presets (the library's default
    //    scene when Presets is empty).
    void ConstructDefault(const ParticleEffectLibrary& Library, const std::vector<std::string>* Presets = nullptr);

    // 📝 Samples the native level field at the anchor for the Wind-page readout. The GPU sequence samples the same sampler
    //    throughout the particle domain, rather than copying ForceSource records into this space.
    void SampleLevelForceField(const IFieldSampler& Field);

    ParticleEffectInstance* AddEffect(const ParticleEffectLibrary& Library, std::string_view PresetIdentifier);
    ParticleEffectInstance* DuplicateEffect(const ParticleEffectLibrary& Library, std::string_view Token);
    bool                    RemoveEffect(std::string_view Token);
    ParticleEffectInstance* ResolveEffect(std::string_view Token) noexcept;

    // 📝 Clears every effect (fresh stores) and the lightning.
    void ResetEffects();
    // 📝 A strike now; its ground point bursts any Strike sparks effect.
    std::array<double, 3> StrikeNow();

    // 📝 Advances the clock by one interface tick (clamped to 50 ms as the prototype does) and packs the refresh. A host scene
    //    may override the editor's orbit camera and supply the level's shared ForceField sampler.
    ParticleRefreshPlan Advance(double RealDeltaSeconds, uint32_t ViewWidth, uint32_t ViewHeight,
                                 const ParticleCameraPose* CameraOverride = nullptr,
                                 const IFieldSampler* SharedFieldSampler = nullptr);

    // 📝 The domain box, each visible effect's origin cross (amber when selected), molecular boxes and the probe.
    [[nodiscard]] std::vector<float> ConstructGuides() const;
    [[nodiscard]] std::array<uint32_t, 3> ResolveProbeCell() const noexcept;
    [[nodiscard]] uint32_t CountFlowFields() const noexcept;

    std::vector<ParticleEffectInstance> Effects;
    std::vector<ParticleField>          Fields;
    ParticleWindSettings                Wind;
    ParticleOrbitCamera                 Camera;
    ParticleLightning                   Lightning;
    ParticleLightningWeb                LightningWeb;
    ParticleLevelWind                   LevelWind;
    bool                                Playing      = true;
    double                              TimeScale    = 1.0;
    double                              TimeSeconds  = 0.0;
    uint32_t                            Step         = 0;
    double                              RefreshRate  = 0.0;   // [Hz] smoothed
    bool                                ProbeEnabled = true;
    std::array<double, 3>               Probe        = { 0.0, 1.0, 0.0 };
    std::string                         Selected     = "Field";
    uint32_t                            NextNumber   = 1;

    // 📝 Domain profiles (world axes, z up) and the authored trigger rules persisted with the space.
    SpatialProfile                   Spatial;
    MassProfile                      Mass;
    ReplicationProfile               Replication;
    std::vector<ParticleTriggerRule> TriggerRules;

    // 📝 ReplicableDomainConcept contract for DomainReplicator<ParticleSpace>.
    [[nodiscard]] std::string_view QueryDomainIdentifier() const noexcept { return DomainId; }
    void                           ConfigureDomainIdentifier(std::string Id) { DomainId = std::move(Id); }
    [[nodiscard]] uint64_t         QueryDomainRevision() const noexcept { return Revision; }
    void                           AdvanceRevision() noexcept { ++Revision; }
    [[nodiscard]] SpatialProfile&           AccessSpatialProfile() noexcept { return Spatial; }
    [[nodiscard]] const SpatialProfile&     QuerySpatialProfile() const noexcept { return Spatial; }
    [[nodiscard]] MassProfile&              AccessMassProfile() noexcept { return Mass; }
    [[nodiscard]] const MassProfile&        QueryMassProfile() const noexcept { return Mass; }
    [[nodiscard]] ReplicationProfile&       AccessReplicationProfile() noexcept { return Replication; }
    [[nodiscard]] const ReplicationProfile& QueryReplicationProfile() const noexcept { return Replication; }
    void                                   SerializeDomainState(toml::table& Out) const;
    void                                   DeserializeDomainState(const toml::table& In);

private:
    void   ApplyWindLink(const ParticlePreset& Preset);
    void   ReceiveStrike(const std::array<double, 3>& Point);
    double Random() noexcept;

    struct FibrePathKey
    {
        std::string Token;
        uint64_t    Generation = 0;
        std::string Key;
    };
    std::vector<FibrePathKey> FibrePaths;
    uint32_t                  RandomCounter = 0;
    uint64_t                  Revision      = 0;   // 📝 bumped by trigger dispatches and field sampling
    std::string               DomainId      = "particles";
};

} // namespace Frontier
