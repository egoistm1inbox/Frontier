/*==========================================================================================================================================
                                                       PARTICLETRIGGERROUTER.CPP
==========================================================================================================================================*/
// 🧩 Routes PhysicsImpactEvent telemetry and FluidBurstTriggerEvent bursts into ParticleSpace instances using presets from
//    ParticleLibrary.particlespace (sparks, strikeSparks, debris, glass, watermist, splash, sand, embers, smoke, steam).

#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleTriggerRouter.h"
#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleSpace.h"

#include <algorithm>
#include <cmath>

namespace Frontier
{
namespace
{

ParticleEffectInstance* EnsureEffectForPreset(ParticleSpace&              Space,
                                             const ParticleEffectLibrary& Library,
                                             std::string_view             PresetIdentifier)
{
    for (ParticleEffectInstance& Effect : Space.Effects)
    {
        if (Effect.PresetIdentifier == PresetIdentifier)
        {
            return &Effect;
        }
    }
    return Space.AddEffect(Library, PresetIdentifier);
}

uint32_t ComputeScaledBurstCount(const ParticleTriggerRule& Rule, double Magnitude) noexcept
{
    const double  Denominator = std::max(1.0e-3, Rule.ReferenceImpulseNs);
    const double  Span        = std::clamp((Magnitude - Rule.MinImpulseNs) / Denominator, 0.0, 1.0);
    const uint32_t Lo         = std::min(Rule.MinBurstCount, Rule.MaxBurstCount);
    const uint32_t Hi         = std::max(Rule.MinBurstCount, Rule.MaxBurstCount);
    return Lo + static_cast<uint32_t>(std::llround(static_cast<double>(Hi - Lo) * Span));
}

} // namespace

ParticleTriggerRouter ParticleTriggerRouter::ConstructDefaultRouter()
{
    ParticleTriggerRouter Router;

    auto MakePhysicsRule = [](const char*          Name,
                              SurfaceMaterialClass Surface,
                              const char*          Preset,
                              double               MinImpulseNs,
                              double               RefImpulseNs,
                              double               MinSpeedMps,
                              uint32_t             MinBurst,
                              uint32_t             MaxBurst,
                              double               SpeedScale)
    {
        ParticleTriggerRule Rule;
        Rule.Name                = Name;
        Rule.SourceKind          = static_cast<uint8_t>(ParticleTriggerSourceKind::PhysicsImpact);
        Rule.SurfaceClass        = static_cast<uint8_t>(Surface);
        Rule.PresetIdentifier    = Preset;
        Rule.MinImpulseNs        = MinImpulseNs;
        Rule.ReferenceImpulseNs  = RefImpulseNs;
        Rule.MinRelativeSpeedMps = MinSpeedMps;
        Rule.MinBurstCount       = MinBurst;
        Rule.MaxBurstCount       = MaxBurst;
        Rule.SpeedScale          = SpeedScale;
        Rule.Replication.Enabled = true;
        return Rule;
    };

    // Metal impacts: electric-friction strike sparks first, trailing sparks on the lighter hits.
    Router.AddRule(MakePhysicsRule("metal_strike_sparks", SurfaceMaterialClass::Metal, "strikeSparks", 40.0, 450.0, 2.0, 16, 128, 1.15));
    Router.AddRule(MakePhysicsRule("metal_sparks", SurfaceMaterialClass::Metal, "sparks", 10.0, 250.0, 1.0, 10, 80, 1.0));

    // Glass impacts: shards.
    Router.AddRule(MakePhysicsRule("glass_shards", SurfaceMaterialClass::Glass, "glass", 8.0, 180.0, 0.8, 12, 96, 1.0));

    // Concrete and asphalt: debris chips and impact smoke on the heavier hits.
    Router.AddRule(MakePhysicsRule("concrete_debris", SurfaceMaterialClass::Concrete, "debris", 20.0, 350.0, 1.5, 10, 64, 1.0));
    Router.AddRule(MakePhysicsRule("concrete_smoke", SurfaceMaterialClass::Concrete, "smoke", 60.0, 500.0, 2.5, 6, 32, 0.85));
    Router.AddRule(MakePhysicsRule("asphalt_debris", SurfaceMaterialClass::Asphalt, "debris", 25.0, 380.0, 1.5, 10, 64, 1.0));

    // Wood and composite: lighter debris.
    Router.AddRule(MakePhysicsRule("wood_debris", SurfaceMaterialClass::Wood, "debris", 15.0, 300.0, 1.2, 8, 48, 0.95));
    Router.AddRule(MakePhysicsRule("composite_debris", SurfaceMaterialClass::Composite, "debris", 18.0, 320.0, 1.2, 8, 48, 0.95));

    // Water: splash crown and lingering mist.
    Router.AddRule(MakePhysicsRule("water_splash", SurfaceMaterialClass::Water, "splash", 8.0, 220.0, 1.0, 16, 120, 1.1));
    Router.AddRule(MakePhysicsRule("water_mist", SurfaceMaterialClass::Water, "watermist", 25.0, 350.0, 2.0, 12, 72, 1.0));

    // Soil and foliage: lofted sand and shaken leaves.
    Router.AddRule(MakePhysicsRule("soil_sand", SurfaceMaterialClass::Soil, "sand", 12.0, 280.0, 1.2, 14, 96, 1.0));
    Router.AddRule(MakePhysicsRule("foliage_leaves", SurfaceMaterialClass::Foliage, "leaves", 6.0, 160.0, 0.8, 10, 64, 1.0));

    // Fluid thermal / vapor / smoke channels (FluidSpace -> ParticleSpace bursts).
    auto MakeFluidRule = [](const char* Name, const char* Preset, double MinIntensity, double RefIntensity, uint32_t MinBurst, uint32_t MaxBurst)
    {
        ParticleTriggerRule Rule;
        Rule.Name                = Name;
        Rule.SourceKind          = static_cast<uint8_t>(ParticleTriggerSourceKind::FluidBurst);
        Rule.SurfaceClass        = ParticleTriggerAnySurface;
        Rule.PresetIdentifier    = Preset;
        Rule.MinImpulseNs        = MinIntensity;
        Rule.ReferenceImpulseNs  = RefIntensity;
        Rule.MinRelativeSpeedMps = 0.0;
        Rule.MinBurstCount       = MinBurst;
        Rule.MaxBurstCount       = MaxBurst;
        Rule.Replication.Enabled = true;
        return Rule;
    };

    Router.AddRule(MakeFluidRule("fluid_embers", "embers", 0.25, 1.5, 10, 72));
    Router.AddRule(MakeFluidRule("fluid_smoke", "smoke", 0.20, 1.2, 8, 48));
    Router.AddRule(MakeFluidRule("fluid_steam", "steam", 0.20, 1.2, 10, 56));
    Router.AddRule(MakeFluidRule("fluid_heat_shimmer", "heat-shimmer", 0.45, 2.0, 4, 24));

    return Router;
}

std::vector<ParticleBurstReceipt> ParticleTriggerRouter::DispatchPhysicsImpact(const PhysicsImpactEvent&   Impact,
                                                                               ParticleSpace&              Space,
                                                                               const ParticleEffectLibrary& Library) const
{
    std::vector<ParticleBurstReceipt> Receipts;
    const Vec3d                       FieldOrigin = WorldToFieldAxes(Impact.PointMetres);
    Vec3d                             FieldDirection;
    if (LengthSquared(Impact.Normal) > 1.0e-9)
    {
        FieldDirection = Normalise(WorldToFieldAxes(Impact.Normal));
    }
    else
    {
        FieldDirection = { 0.0, 1.0, 0.0 };
    }

    for (const ParticleTriggerRule& Rule : Rules_)
    {
        if (!Rule.Enabled) continue;
        if (Rule.SourceKind != static_cast<uint8_t>(ParticleTriggerSourceKind::PhysicsImpact)) continue;
        if (Rule.SurfaceClass != ParticleTriggerAnySurface && Rule.SurfaceClass != static_cast<uint8_t>(Impact.SurfaceClass)) continue;
        if (Impact.ImpulseMagnitudeNs < Rule.MinImpulseNs || Impact.ImpulseMagnitudeNs > Rule.MaxImpulseNs) continue;
        if (Impact.RelativeSpeedMps < Rule.MinRelativeSpeedMps) continue;

        ParticleEffectInstance* Effect = EnsureEffectForPreset(Space, Library, Rule.PresetIdentifier);
        if (Effect == nullptr) continue;

        const uint32_t Burst             = ComputeScaledBurstCount(Rule, Impact.ImpulseMagnitudeNs);
        Effect->OverrideOrigin           = std::array<double, 3>{ FieldOrigin.X, FieldOrigin.Y, FieldOrigin.Z };
        Effect->Parameters.Direction     = std::array<double, 3>{ FieldDirection.X, FieldDirection.Y, FieldDirection.Z };
        Effect->Parameters.SizeScale     = Rule.SizeScale;
        Effect->Parameters.Visible       = true;
        Effect->PendingBurst            += Burst;
        Effect->Spatial.PositionMetres   = Impact.PointMetres;
        Effect->Replication              = Rule.Replication;
        Effect->Spatial.AdvanceRevision();

        ParticleBurstReceipt Receipt;
        Receipt.RuleName          = Rule.Name;
        Receipt.PresetIdentifier  = Rule.PresetIdentifier;
        Receipt.EffectToken       = Effect->Token;
        Receipt.WorldPointMetres  = Impact.PointMetres;
        Receipt.FieldOriginMetres = FieldOrigin;
        Receipt.FieldDirection    = FieldDirection;
        Receipt.ReleasedCount     = Burst;
        Receipt.TriggerSeed       = static_cast<uint32_t>(Impact.BodyARecord ^ Impact.BodyBRecord) * 7919u ^ (Burst * 31u + 1u);
        Receipt.SpeedScale        = Rule.SpeedScale;
        Receipt.SizeScale         = Rule.SizeScale;
        Receipt.Replication       = Rule.Replication;
        Receipts.push_back(std::move(Receipt));
    }
    if (!Receipts.empty())
    {
        Space.AdvanceRevision();
    }
    return Receipts;
}

std::vector<ParticleBurstReceipt> ParticleTriggerRouter::DispatchPhysicsTelemetry(PhysicsImpactRing&           Telemetry,
                                                                                  ParticleSpace&               Space,
                                                                                  const ParticleEffectLibrary& Library) const
{
    const std::vector<PhysicsImpactEvent> Impacts = Telemetry.Drain();
    std::vector<ParticleBurstReceipt>     AllReceipts;
    for (const PhysicsImpactEvent& Impact : Impacts)
    {
        std::vector<ParticleBurstReceipt> Part = DispatchPhysicsImpact(Impact, Space, Library);
        AllReceipts.insert(AllReceipts.end(),
                           std::make_move_iterator(Part.begin()),
                           std::make_move_iterator(Part.end()));
    }
    return AllReceipts;
}

std::vector<ParticleBurstReceipt> ParticleTriggerRouter::DispatchFluidBurst(const FluidBurstTriggerEvent& Burst,
                                                                            ParticleSpace&                Space,
                                                                            const ParticleEffectLibrary&  Library) const
{
    std::vector<ParticleBurstReceipt> Receipts;
    const Vec3d                       FieldOrigin = WorldToFieldAxes(Burst.WorldPointMetres);
    Vec3d                             FieldDirection;
    if (LengthSquared(Burst.ImpulseDirection) > 1.0e-9)
    {
        FieldDirection = Normalise(WorldToFieldAxes(Burst.ImpulseDirection));
    }
    else
    {
        FieldDirection = { 0.0, 1.0, 0.0 };
    }

    for (const ParticleTriggerRule& Rule : Rules_)
    {
        if (!Rule.Enabled) continue;
        if (Rule.SourceKind != static_cast<uint8_t>(ParticleTriggerSourceKind::FluidBurst)) continue;
        if (Rule.SurfaceClass != ParticleTriggerAnySurface && Rule.SurfaceClass != static_cast<uint8_t>(Burst.SurfaceClass)) continue;

        double ChannelSignal = Burst.EnergyScale;
        if (Rule.PresetIdentifier == "embers" || Rule.PresetIdentifier == "heat-shimmer")
        {
            ChannelSignal = Burst.ThermalIntensity;
        }
        else if (Rule.PresetIdentifier == "steam" || Rule.PresetIdentifier == "watermist")
        {
            ChannelSignal = Burst.VaporIntensity;
        }
        else if (Rule.PresetIdentifier == "smoke")
        {
            ChannelSignal = Burst.SmokeIntensity;
        }
        if (ChannelSignal < Rule.MinImpulseNs || ChannelSignal > Rule.MaxImpulseNs) continue;

        ParticleEffectInstance* Effect = EnsureEffectForPreset(Space, Library, Rule.PresetIdentifier);
        if (Effect == nullptr) continue;

        const uint32_t Count           = ComputeScaledBurstCount(Rule, ChannelSignal);
        Effect->OverrideOrigin         = std::array<double, 3>{ FieldOrigin.X, FieldOrigin.Y, FieldOrigin.Z };
        Effect->Parameters.Direction   = std::array<double, 3>{ FieldDirection.X, FieldDirection.Y, FieldDirection.Z };
        Effect->Parameters.SizeScale   = Rule.SizeScale;
        Effect->Parameters.Visible     = true;
        Effect->PendingBurst          += Count;
        Effect->Spatial.PositionMetres = Burst.WorldPointMetres;
        Effect->Replication            = Rule.Replication;
        Effect->Spatial.AdvanceRevision();

        ParticleBurstReceipt Receipt;
        Receipt.RuleName          = Rule.Name;
        Receipt.PresetIdentifier  = Rule.PresetIdentifier;
        Receipt.EffectToken       = Effect->Token;
        Receipt.WorldPointMetres  = Burst.WorldPointMetres;
        Receipt.FieldOriginMetres = FieldOrigin;
        Receipt.FieldDirection    = FieldDirection;
        Receipt.ReleasedCount     = Count;
        Receipt.TriggerSeed       = Burst.TriggerSeed ^ (Count * 2654435761u);
        Receipt.SpeedScale        = Rule.SpeedScale;
        Receipt.SizeScale         = Rule.SizeScale;
        Receipt.Replication       = Rule.Replication;
        Receipts.push_back(std::move(Receipt));
    }
    if (!Receipts.empty())
    {
        Space.AdvanceRevision();
    }
    return Receipts;
}

} // namespace Frontier
