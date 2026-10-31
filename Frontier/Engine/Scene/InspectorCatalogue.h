/*==========================================================================================================================================
                                                          INSPECTORCATALOGUE.H
==========================================================================================================================================*/
// 🧩 Modular inspector binding catalogue driven automatically by RecordEntry construction and destruction.

#pragma once

#include "Engine/Diagnostics/BuildConfiguration.h"
#include "Engine/Scene/RecordClassification.h"
#include "Engine/Scene/RecordEntry.h"
#include "Engine/Scene/RecordToken.h"

#include <cstdint>
#include <functional>
#include <string>
#include <unordered_map>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                  INSPECTOR TAXONOMY
//------------------------------------------------------------------------------------------------------------------------

enum class InspectorAuthoringCategory : uint8_t
{
    EngineReusable  = 0, // [-] - Built-in reusable engine inspector (Sun, Sky, Clouds, Fog, Render, Wind)
    ProjectCustom   = 1, // [-] - User-authored custom inspector layout (ControlVehicle, course items)
    DedicatedStudio = 2, // [-] - Specialized studio-backed domain (Particles, Fracture, Fluid, Clusters)
};

enum class EngineInspectorDomain : uint8_t
{
    TransformOnly           = 0,  // [-] - Spatial transform & visibility card only
    Diagnostics             = 1,  // [-] - Pass breakdown & adapter health
    GeometryClusters        = 2,  // [-] - 128-triangle spatial clusters
    RenderSettings          = 3,  // [-] - RTX ReSTIR Path Tracer vs GTX Distance-Field GI + SVGF
    AccelerationAndDistance = 4,  // [-] - Two-Level BVH + Toroidal SDF cascade bricks
    SurfaceCache            = 5,  // [-] - Multi-bounce surface card radiosity depot
    Sun                     = 6,  // [-] - Presets, horizon trajectory arc, blackbody & 3D clustered lighting
    LensFlare               = 7,  // [-] - Aperture ghosts, halo & chromatic dispersion
    Clouds                  = 8,  // [-] - Volumetric cloudscape layer, silver lining & shadow march
    LocalCloud              = 9,  // [-] - Localized cloud volume bounds & density
    LocalVolumetricFog      = 10, // [-] - Localized froxel fog volume
    Atmosphere              = 11, // [-] - Rayleigh, Mie, ozone & multi-scattering aerial perspective
    Stars                   = 12, // [-] - Sidereal starfield catalogue & magnitude threshold
    Moons                   = 13, // [-] - Lunar phase, albedo & earthshine
    HeightFog               = 14, // [-] - Exponential height falloff & directional inscattering
    AtmosphericFog          = 15, // [-] - Horizon optical depth & sky-coupled haze
    Lightning               = 16, // [-] - Discharge channels, cloud illumination & acoustic delay
    Wind                    = 17, // [-] - Forcefield heading, gust envelope & curl turbulence
};

enum class DedicatedStudioDomain : uint8_t
{
    None             = 0, // [-] - No external studio tab
    ParticleStudio   = 1, // [-] - GPU emitter stack, curve editor & budget monitor
    FractureStudio   = 2, // [-] - Voronoi/convex partitioning, Gc material library & impact curves
    FluidPlumeStudio = 3, // [-] - Toroidal pyro/smoke lattice, decay & Helland blackbody ramp
    ClusterStudio    = 4, // [-] - Spatial 128-triangle cluster bounds & indirect draw inspector
    MaterialStudio   = 5, // [-] - Procedural Float32 pattern & PBR surface studio
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  INSPECTOR PROFILE
//------------------------------------------------------------------------------------------------------------------------

struct InspectorProfileEntry
{
    RecordToken                OwnerToken{};                                                    // [-] - Owning RecordEntry token
    RecordClassification       Classification    = RecordClassification::Unclassified;          // [-] - Outliner classification
    InspectorAuthoringCategory AuthoringCategory = InspectorAuthoringCategory::EngineReusable;  // [-] - Modular authoring tier
    EngineInspectorDomain      EngineDomain      = EngineInspectorDomain::TransformOnly;        // [-] - Built-in engine page selector
    DedicatedStudioDomain      StudioDomain      = DedicatedStudioDomain::None;                 // [-] - Linked dedicated studio
    std::string                GroupCaption      = "Objects";                                   // [-] - Outliner collapsible group
    std::string                EyebrowCaption    = "SCENE RECORD";                              // [-] - Uppercase header eyebrow
    std::string                MetaCaption       = "";                                          // [-] - Trailing Outliner row meta
    uint32_t                   AccentColourRgb   = 0x9aa6b2u;                                   // [rgb] - 2x16 px Outliner & card bar
    void                      *PayloadAddress    = nullptr;                                     // [-] - Typed domain record pointer
    std::function<void()>      ConstructCustomContent;                                          // [-] - Custom/studio body callback
};

//------------------------------------------------------------------------------------------------------------------------
//                                                 INSPECTOR CATALOGUE
//------------------------------------------------------------------------------------------------------------------------

class InspectorCatalogue
{
  public:
    [[nodiscard]] static InspectorCatalogue &Instance() noexcept
    {
        static InspectorCatalogue Singleton;
        return Singleton;
    }

    [[nodiscard]] static EngineInspectorDomain ResolveDefaultDomain(RecordClassification Classification) noexcept
    {
        switch (Classification)
        {
            case RecordClassification::Environment:  return EngineInspectorDomain::Sun;
            case RecordClassification::Illumination: return EngineInspectorDomain::RenderSettings;
            case RecordClassification::Camera:       return EngineInspectorDomain::RenderSettings;
            default:                                 return EngineInspectorDomain::TransformOnly;
        }
    }

    [[nodiscard]] static uint32_t ResolveDefaultAccent(RecordClassification Classification) noexcept
    {
        switch (Classification)
        {
            case RecordClassification::Environment:  return 0x8fb3a4u;
            case RecordClassification::Illumination: return 0x8bb6c8u;
            case RecordClassification::Vehicle:      return 0xc9c785u;
            case RecordClassification::Tyre:         return 0xc9c785u;
            case RecordClassification::Physics:      return 0xd69a6cu;
            case RecordClassification::Interface:    return 0xb08ec4u;
            default:                                 return 0x9aa6b2u;
        }
    }

#if defined(FRONTIER_EDITOR_PROFILE) || defined(FRONTIER_DEVELOPMENT_PROFILE)
    // Called automatically by RecordEntry::RecordEntry so every item obtains a baseline reusable inspector.
    void RegisterDefault(const RecordEntry &Entry)
    {
        const RecordToken Issued = Entry.Token();
        if (!Issued.IsValid())
        {
            return;
        }
        InspectorProfileEntry Profile;
        Profile.OwnerToken        = Issued;
        Profile.Classification    = Entry.Classification();
        Profile.AuthoringCategory = InspectorAuthoringCategory::EngineReusable;
        Profile.EngineDomain      = ResolveDefaultDomain(Profile.Classification);
        Profile.GroupCaption      = RecordClassificationName(Profile.Classification);
        Profile.EyebrowCaption    = RecordClassificationName(Profile.Classification);
        Profile.AccentColourRgb   = ResolveDefaultAccent(Profile.Classification);
        Profiles[Issued.Value]    = std::move(Profile);
    }

    // Specializes a RecordEntry onto one of the built-in reusable engine inspectors (no user UI code required).
    void BindEnginePreset(RecordToken Token, EngineInspectorDomain Domain, std::string GroupCaption,
                          std::string EyebrowCaption, std::string MetaCaption, uint32_t AccentColourRgb,
                          void *PayloadAddress = nullptr,
                          DedicatedStudioDomain LinkedStudio = DedicatedStudioDomain::None)
    {
        auto Iterator = Profiles.find(Token.Value);
        if (Iterator == Profiles.end())
        {
            return;
        }
        Iterator->second.AuthoringCategory = InspectorAuthoringCategory::EngineReusable;
        Iterator->second.EngineDomain      = Domain;
        Iterator->second.StudioDomain      = LinkedStudio;
        Iterator->second.GroupCaption      = std::move(GroupCaption);
        Iterator->second.EyebrowCaption    = std::move(EyebrowCaption);
        Iterator->second.MetaCaption       = std::move(MetaCaption);
        Iterator->second.AccentColourRgb   = AccentColourRgb;
        Iterator->second.PayloadAddress    = PayloadAddress;
    }

    // Binds a user-authored custom inspector layout (e.g., ControlVehicle with 8 system tabs).
    void BindCustomInspector(RecordToken Token, std::string GroupCaption, std::string EyebrowCaption,
                             std::string MetaCaption, uint32_t AccentColourRgb,
                             std::function<void()> ConstructCallback, void *PayloadAddress = nullptr)
    {
        auto Iterator = Profiles.find(Token.Value);
        if (Iterator == Profiles.end())
        {
            return;
        }
        Iterator->second.AuthoringCategory      = InspectorAuthoringCategory::ProjectCustom;
        Iterator->second.GroupCaption           = std::move(GroupCaption);
        Iterator->second.EyebrowCaption         = std::move(EyebrowCaption);
        Iterator->second.MetaCaption            = std::move(MetaCaption);
        Iterator->second.AccentColourRgb        = AccentColourRgb;
        Iterator->second.PayloadAddress         = PayloadAddress;
        Iterator->second.ConstructCustomContent = std::move(ConstructCallback);
    }

    // Binds a dedicated studio-backed inspector (Fracture, Particle, Fluid/Plume, Cluster).
    void BindStudioInspector(RecordToken Token, DedicatedStudioDomain Studio, std::string GroupCaption,
                             std::string EyebrowCaption, std::string MetaCaption, uint32_t AccentColourRgb,
                             std::function<void()> ConstructCallback, void *PayloadAddress = nullptr)
    {
        auto Iterator = Profiles.find(Token.Value);
        if (Iterator == Profiles.end())
        {
            return;
        }
        Iterator->second.AuthoringCategory      = InspectorAuthoringCategory::DedicatedStudio;
        Iterator->second.StudioDomain           = Studio;
        Iterator->second.GroupCaption           = std::move(GroupCaption);
        Iterator->second.EyebrowCaption         = std::move(EyebrowCaption);
        Iterator->second.MetaCaption            = std::move(MetaCaption);
        Iterator->second.AccentColourRgb        = AccentColourRgb;
        Iterator->second.PayloadAddress         = PayloadAddress;
        Iterator->second.ConstructCustomContent = std::move(ConstructCallback);
    }

    void SynchronizeMetaCaption(RecordToken Token, std::string MetaCaption)
    {
        auto Iterator = Profiles.find(Token.Value);
        if (Iterator != Profiles.end())
        {
            Iterator->second.MetaCaption = std::move(MetaCaption);
        }
    }

    // Called automatically by RecordEntry::~RecordEntry.
    void Unregister(RecordToken Token) noexcept
    {
        Profiles.erase(Token.Value);
    }

    [[nodiscard]] const InspectorProfileEntry *QueryProfile(RecordToken Token) const noexcept
    {
        const auto Iterator = Profiles.find(Token.Value);
        return Iterator != Profiles.end() ? &Iterator->second : nullptr;
    }

    [[nodiscard]] size_t QueryRegisteredCount() const noexcept
    {
        return Profiles.size();
    }

    void ResetForTesting() noexcept
    {
        Profiles.clear();
    }

  private:
    std::unordered_map<uint64_t, InspectorProfileEntry> Profiles; // [-] - Token value -> modular inspector profile
#else
    void RegisterDefault(const RecordEntry &) noexcept {}
    void Unregister(RecordToken) noexcept {}
    [[nodiscard]] const InspectorProfileEntry *QueryProfile(RecordToken) const noexcept { return nullptr; }
    [[nodiscard]] size_t QueryRegisteredCount() const noexcept { return 0; }
    void ResetForTesting() noexcept {}
#endif
};

} // namespace Frontier
