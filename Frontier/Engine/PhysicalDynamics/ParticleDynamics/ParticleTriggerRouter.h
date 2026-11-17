/*==========================================================================================================================================
                                                        PARTICLETRIGGERRROUTER.H
==========================================================================================================================================*/
// 🧩 Data-driven trigger router mapping PhysicsImpactEvent telemetry and FluidBurstTriggerEvent bursts onto verified
//    ParticleLibrary.particlespace presets (sparks, strikeSparks, glass, debris, smoke, embers, heat-shimmer, watermist,
//    splash, sand, steam), so collisions and fluid events raise effects without any editor authored scene work.

#pragma once

#include "Engine/PhysicalDynamics/IFieldSampler.h"
#include "Engine/PhysicalDynamics/ParticleDynamics/ParticleEffectLibrary.h"
#include "Frontier/Engine/Foundation/Math.h"
#include "Frontier/Engine/Scene/Profiles/ProfileSchemas.h"
#include "Frontier/Engine/Scene/Profiles/ReplicationProfile.h"
#include "Frontier/Engine/Scene/SpaceCodec.h"
#include "Frontier/Extensions/Physics/PhysicsSubstrate.h"

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace Frontier
{

class ParticleSpace;
class ParticleEffectLibrary;

//------------------------------------------------------------------------------------------------------------------------
//                                                    TRIGGER EVENTS
//------------------------------------------------------------------------------------------------------------------------

enum class ParticleTriggerSourceKind : uint8_t
{
    PhysicsImpact = 0,
    FluidBurst    = 1,
};

// 📝 A FluidSpace burst raised at a world point: thermal (fire), vapor (boiling/steam) and smoke channels drive the
//    matching presets; EnergyScale is the fallback signal for rules without a dedicated channel.
struct FluidBurstTriggerEvent
{
    Vec3d                WorldPointMetres{};
    Vec3d                ImpulseDirection{ 0.0, 0.0, 1.0 };
    double               ThermalIntensity = 0.0;
    double               VaporIntensity   = 0.0;
    double               SmokeIntensity   = 0.0;
    double               EnergyScale      = 1.0;
    SurfaceMaterialClass SurfaceClass     = SurfaceMaterialClass::Concrete;
    uint32_t             TriggerSeed      = 1u;
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    TRIGGER RULES
//------------------------------------------------------------------------------------------------------------------------

// 📝 SurfaceClass 255 matches every SurfaceMaterialClass, so a rule can be a per-material preset or a domain fallback.
inline constexpr uint8_t ParticleTriggerAnySurface = 255u;

struct ParticleTriggerRule
{
    std::string        Name;
    bool               Enabled             = true;
    uint8_t            SourceKind          = 0;   // ParticleTriggerSourceKind
    uint8_t            SurfaceClass        = ParticleTriggerAnySurface;
    std::string        PresetIdentifier;
    double             MinImpulseNs        = 5.0;      // physics: impulse [N·s]; fluid: channel intensity
    double             MaxImpulseNs        = 1.0e9;
    double             ReferenceImpulseNs  = 200.0;    // the impulse that reaches MaxBurstCount
    double             MinRelativeSpeedMps = 0.5;
    uint32_t           MinBurstCount       = 8;
    uint32_t           MaxBurstCount       = 96;
    double             SpeedScale          = 1.0;
    double             SizeScale           = 1.0;
    ReplicationProfile Replication{};
};

template <>
struct SpaceSchema<ParticleTriggerRule>
{
    static constexpr auto Bindings() noexcept
    {
        using R = ParticleTriggerRule;
        return std::make_tuple(
            MakeFieldBinding("name", &R::Name),
            MakeFieldBinding("enabled", &R::Enabled),
            MakeFieldBinding("source_kind", &R::SourceKind),
            MakeFieldBinding("surface_class", &R::SurfaceClass),
            MakeFieldBinding("preset", &R::PresetIdentifier),
            MakeClampedField("min_impulse_ns", &R::MinImpulseNs, 0.0, 1.0e12),
            MakeClampedField("max_impulse_ns", &R::MaxImpulseNs, 0.0, 1.0e12),
            MakeClampedField("reference_impulse_ns", &R::ReferenceImpulseNs, 1.0e-3, 1.0e12),
            MakeFieldBinding("min_relative_speed_mps", &R::MinRelativeSpeedMps),
            MakeFieldBinding("min_burst_count", &R::MinBurstCount),
            MakeFieldBinding("max_burst_count", &R::MaxBurstCount),
            MakeClampedField("speed_scale", &R::SpeedScale, 0.01, 100.0),
            MakeClampedField("size_scale", &R::SizeScale, 0.01, 100.0),
            MakeFieldBinding("replication", &R::Replication));
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    BURST RECEIPTS
//------------------------------------------------------------------------------------------------------------------------

struct ParticleBurstReceipt
{
    std::string        RuleName;
    std::string        PresetIdentifier;
    std::string        EffectToken;
    Vec3d              WorldPointMetres{};
    Vec3d              FieldOriginMetres{};
    Vec3d              FieldDirection{};
    uint32_t           ReleasedCount = 0;
    uint32_t           TriggerSeed   = 0;
    double             SpeedScale    = 1.0;
    double             SizeScale     = 1.0;
    ReplicationProfile Replication{};
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    ROUTER
//------------------------------------------------------------------------------------------------------------------------

class ParticleTriggerRouter
{
  public:
    // 📝 The tuned default rule set: per-surface-class impact presets and the four fluid channels.
    [[nodiscard]] static ParticleTriggerRouter ConstructDefaultRouter();

    ParticleTriggerRouter() = default;
    explicit ParticleTriggerRouter(std::vector<ParticleTriggerRule> Rules) : Rules_(std::move(Rules)) {}

    void                                   AddRule(ParticleTriggerRule Rule) { Rules_.push_back(std::move(Rule)); }
    void                                   ClearRules() noexcept { Rules_.clear(); }
    [[nodiscard]] const std::vector<ParticleTriggerRule>& QueryRules() const noexcept { return Rules_; }
    [[nodiscard]] std::vector<ParticleTriggerRule>&       AccessRules() noexcept { return Rules_; }
    [[nodiscard]] size_t                                  QueryRuleCount() const noexcept { return Rules_.size(); }

    // 📝 One PhysicsImpactEvent: every matching rule adds its preset (creating the effect on first use) and queues a
    //    scaled burst; returns one receipt per fired rule.
    [[nodiscard]] std::vector<ParticleBurstReceipt> DispatchPhysicsImpact(const PhysicsImpactEvent&    Impact,
                                                                          ParticleSpace&                Space,
                                                                          const ParticleEffectLibrary&  Library) const;

    // 📝 Drains a PhysicsImpactRing (the physics execution thread's telemetry) and dispatches each event.
    [[nodiscard]] std::vector<ParticleBurstReceipt> DispatchPhysicsTelemetry(PhysicsImpactRing&          Telemetry,
                                                                             ParticleSpace&              Space,
                                                                             const ParticleEffectLibrary& Library) const;

    // 📝 One FluidBurstTriggerEvent: the thermal/vapor/smoke channels select their presets, EnergyScale the rest.
    [[nodiscard]] std::vector<ParticleBurstReceipt> DispatchFluidBurst(const FluidBurstTriggerEvent& Burst,
                                                                       ParticleSpace&                Space,
                                                                       const ParticleEffectLibrary&  Library) const;

  private:
    std::vector<ParticleTriggerRule> Rules_;
};

} // namespace Frontier
