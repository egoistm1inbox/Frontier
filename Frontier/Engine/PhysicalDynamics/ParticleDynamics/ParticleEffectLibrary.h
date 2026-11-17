/*==========================================================================================================================================
                                                          PARTICLEEFFECTLIBRARY.H
==========================================================================================================================================*/
// 🧩 The Particle editor's effects: every parameter an effect carries, the preset library and its TOML decoder.

#pragma once

#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleFieldTaxonomy.h"

#include <array>
#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace Frontier
{

// 📝 The parameters are eos PE.baseParams() (Experimental/ParticleEditor/Engine/presets.js) with engine names; the library
//    is EngineContent/ParticleArchives/ParticleLibrary.particlespace, written by Automation/ExportParticleLibrary.mjs. Readings stay
//    doubles, as the prototype holds them, and become floats only when packed.

//------------------------------------------------------------------------------------------------------------------------
//                                                    ENUMERATIONS
//------------------------------------------------------------------------------------------------------------------------

// 📝 The simulation path. The numbers are the codes the shaders read (2 is unused).
enum class ParticleBehaviour : uint8_t
{
    Ballistic    = 0,   // streaks, rain, hail, debris: drag, gravity, bounce
    WindDriven   = 1,   // leaves, paper, ash: flutter in the wind lattice
    LennardJones = 3,   // molecular, the 12-6 potential in a box
    Reactive     = 4,   // molecular with A + B ⇌ C chemistry
    VisualEffect = 5,   // fire, smoke and the transitions
    Flocking     = 6,   // fireflies, insects
    LightFibre   = 7,   // analytic curves, not simulated
};

enum class ParticleAppearance : uint8_t
{
    Streak   = 0,
    Sphere   = 1,
    Leaf     = 2,
    SoftGlow = 3,
    Cube     = 4,
    Coin     = 5,
    Bubble   = 6,
};

enum class ParticleReleaseShape : uint8_t
{
    Point       = 0,
    Sphere      = 1,
    Disc        = 2,
    Box         = 3,
    CubeSurface = 4,
};

enum class ParticleLeafSurface : uint8_t
{
    Leaf  = 0,
    Paper = 1,
};

enum class ParticleBlend : uint8_t
{
    Additive  = 0,
    AlphaOver = 1,
};

enum class ParticleTransitionWave : uint8_t
{
    Corner = 0,
    Melt   = 1,
    Glitch = 2,
};

enum class LightFibreShape : uint8_t
{
    Streak = 0,   // Bezier streak
    Ribbon = 1,   // wave sheet
    Trail  = 2,   // path trail
};

enum class LightFibreColouring : uint8_t
{
    Solid   = 0,
    Ramp    = 1,
    Palette = 2,
};

enum class LightFibrePulse : uint8_t
{
    Breathe   = 0,
    Heartbeat = 1,
    Ripple    = 2,
    Sweep     = 3,
};

inline constexpr uint32_t LightFibrePathCount   = 7;
inline constexpr uint32_t LightFibrePathSamples = 512;
inline constexpr uint32_t LightFibreStopLimit   = 8;

// 📝 The closed paths a trail follows, in the prototype's order (PE.FIBRE_PATHS).
[[nodiscard]] const char* ResolveLightFibrePathName(uint32_t Index) noexcept;
[[nodiscard]] int32_t     ResolveLightFibrePathIndex(std::string_view Name) noexcept;

[[nodiscard]] const char* ResolveParticleBehaviourLabel(ParticleBehaviour Behaviour) noexcept;

//------------------------------------------------------------------------------------------------------------------------
//                                                    PARAMETERS
//------------------------------------------------------------------------------------------------------------------------

struct ParticleTransition
{
    double                 HoldMinimumSeconds  = 0.0;
    double                 HoldSpreadSeconds   = 0.0;
    double                 BurstShare          = 0.0;    // [0..1]
    bool                   Fragment            = false;
    double                 FragmentLifeSeconds = 0.0;
    ParticleTransitionWave Wave                = ParticleTransitionWave::Corner;
    int32_t                Assemble            = 0;      // 0 burst, 1 rebuild, 2 stack
    double                 LaunchDistanceMetres = 0.0;   // a rebuild's start distance, a stack's drop height
    bool                   Butterflies         = false;  // the pieces fly off as butterflies
};

struct ParticleAttractor
{
    bool   Enabled       = true;
    double Strength      = 0.0;   // [m/s²]
    double RadiusMetres  = 0.0;
    double Swirl         = 0.0;
    double SwallowMetres = 0.0;
};

// 📝 A black hole's screen-space lensing: the event radius and the Einstein ring as a multiple of it.
struct ParticleLensing
{
    double EventRadiusMetres = 0.0;
    double EinsteinRatio = 0.0;
};

struct ParticleHeatShimmer
{
    double RadiusMetres = 0.0;
    double Strength     = 0.0;
    double Frequency    = 0.0;
    double Rate         = 0.0;
};

struct ParticleMagneticDipole
{
    double Strength     = 0.0;
    double Guide        = 0.0;
    double RadiusMetres = 0.0;
};

struct LightFibreStop
{
    double                Position = 0.0;                     // [0..1] along the fibre
    std::array<double, 4> Colour   = { 1.0, 1.0, 1.0, 1.0 };  // linear RGBA
};

struct LightFibreParameters
{
    LightFibreShape             Shape                 = LightFibreShape::Streak;
    int32_t                     Strands               = 200;
    int32_t                     Segments              = 72;
    int32_t                     Seed                  = 11;
    double                      LoopSeconds           = 12.0;
    double                      Scale                 = 1.0;
    double                      LengthMetres          = 12.0;
    double                      SpreadMetres          = 1.2;
    double                      AmplitudeMetres       = 2.4;
    double                      Frequency             = 1.0;
    double                      SheetWidthMetres      = 6.0;
    double                      Ripple                = 1.0;
    double                      Waves                 = 0.8;
    double                      PhaseSpread           = 1.2;
    double                      TrailLength           = 0.3;
    std::string                 PathShape             = "Ring";
    double                      PathSizeMetres        = 5.0;
    double                      Harmonic              = 1.0;
    double                      WindowCycles          = 1.0;
    double                      Window                = 0.55;
    double                      Thickness             = 1.5;
    double                      Taper                 = 0.6;
    double                      Intensity             = 1.15;
    double                      Halo                  = 0.12;
    double                      Baseline              = 0.1;
    LightFibreColouring         Colouring             = LightFibreColouring::Ramp;
    std::vector<LightFibreStop> Stops;
    std::array<double, 4>       AccentColour          = { 0.92, 1.0, 1.0, 1.0 };
    double                      AccentMix             = 0.25;
    double                      Sparks                = 0.8;
    double                      SparkSize             = 0.02;
    double                      SparkBrightness       = 3.0;
    double                      PulseRate             = 1.0;
    double                      PulseDepth            = 0.25;
    LightFibrePulse             Pulse                 = LightFibrePulse::Breathe;
};

struct ParticleEffectParameters
{
    ParticleBehaviour     Behaviour              = ParticleBehaviour::Ballistic;
    ParticleAppearance    Appearance             = ParticleAppearance::Streak;
    ParticleLeafSurface   LeafSurface            = ParticleLeafSurface::Leaf;
    ParticleBlend         Blend                  = ParticleBlend::Additive;
    int32_t               Capacity               = 2048;
    double                ReleaseRate            = 0.0;                     // [1/s]
    ParticleReleaseShape  ReleaseShape           = ParticleReleaseShape::Point;
    std::array<double, 3> OriginMetres           = { 0.0, 0.0, 0.0 };
    double                RadiusMetres           = 0.0;
    std::array<double, 3> BoxHalfMetres          = { 0.0, 0.0, 0.0 };
    std::array<double, 3> Direction              = { 0.0, 1.0, 0.0 };
    double                SpreadRadians          = 0.0;
    double                SpeedMinimum           = 0.0;                     // [m/s]
    double                SpeedMaximum           = 0.0;                     // [m/s]
    double                Drag                   = 0.0;                     // [1/s]
    double                Gravity                = 0.0;                     // multiple of g
    double                LifeMinimumSeconds     = 1.0;
    double                LifeMaximumSeconds     = 1.0;
    double                SizeStartMetres        = 0.0;
    double                SizeEndMetres          = 0.0;
    double                SizeScale              = 1.0;
    std::array<double, 4> ColourA                = { 1.0, 1.0, 1.0, 1.0 };  // linear RGBA
    std::array<double, 4> ColourB                = { 1.0, 1.0, 1.0, 1.0 };
    std::array<double, 4> ColourC                = { 1.0, 1.0, 1.0, 1.0 };
    double                WindCoupling           = 0.0;                     // [1/s]
    double                Bounce                 = 0.0;
    double                Buoyancy               = 0.0;
    double                Flutter                = 0.0;
    double                Temperature            = 0.0;
    double                Epsilon                = 0.0;                     // Lennard-Jones well depth
    double                Sigma                  = 0.0;                     // [m] Lennard-Jones size
    double                Damping                = 0.0;
    double                ReactRate              = 0.0;
    double                Dissociation           = 0.0;
    double                ReactRadius            = 0.0;                     // [m]
    double                FractionA              = 0.5;
    double                IntegrationStepSeconds = 0.004;
    double                PulseHz                = 0.0;
    double                PulseDepth             = 0.0;
    double                SwarmRadiusMetres      = 0.0;
    double                BurstEverySeconds      = 0.0;
    int32_t               BurstCount             = 0;
    bool                  BurstAtOrigin          = false;
    bool                  Visible                = true;

    std::optional<ParticleTransition>     Transition;
    std::optional<ParticleAttractor>      Attractor;
    std::optional<ParticleLensing>        Lensing;
    std::optional<ParticleHeatShimmer>    HeatShimmer;
    std::optional<ParticleMagneticDipole> MagneticDipole;
    std::optional<LightFibreParameters>   LightFibre;
};

[[nodiscard]] bool EvaluateParticleMolecular(const ParticleEffectParameters& Parameters) noexcept;

//------------------------------------------------------------------------------------------------------------------------
//                                                    PRESETS
//------------------------------------------------------------------------------------------------------------------------

// 📝 A preset that needs its wind switches it on when added: a tornado its column, a sandstorm its prevailing wind.
struct ParticleWindLink
{
    ParticleFieldCategory Category = ParticleFieldCategory::Prevailing;
    std::string           Name;
    bool                  Local    = false;   // move the field under the effect's origin
    std::optional<double> RadiusMetres;
    std::optional<double> Strength;
    std::optional<double> BearingDegrees;
    std::optional<double> RateHz;
};

struct ParticlePreset
{
    std::string                     Identifier;
    std::string                     Name;
    std::string                     Group;
    std::string                     Blurb;
    ParticleEffectParameters        Parameters;
    std::optional<ParticleWindLink> WindLink;
};

// 📝 The wind lattice's display and scale settings (eos PE.defaultWind without its legacy component list).
struct ParticleWindSettings
{
    double WindScale         = 1.0;
    double Turbulence        = 0.35;
    double ArrowReferenceMps = 6.0;
    double ArrowStride       = 3.0;
    bool   ShowArrows        = false;
    bool   ShowFloor         = true;
    bool   ShowDomain        = true;
    double Swirl             = 1.2;
};

class ParticleEffectLibrary
{
public:
    // 📝 Reads ParticleLibrary.particlespace (with .toml fallback); on failure returns false and leaves the reason in Diagnostic.
    bool Decode(const std::filesystem::path& File, std::string& Diagnostic);

    [[nodiscard]] const ParticlePreset* ResolvePreset(std::string_view Identifier) const noexcept;

    std::vector<ParticlePreset> Presets;
    std::vector<std::string>    Groups;
    std::vector<std::string>    DefaultScene;
    ParticleWindSettings        Wind;
    std::vector<ParticleField>  Fields;
    std::string                 Source;
    std::string                 PresetsDigest;
};

// 📝 Reads the [[force]] records of a TOML file: the library's own, or a validation reference's. False on an unknown category.
bool DecodeParticleFields(const std::filesystem::path& File, std::vector<ParticleField>& Fields, std::string& Diagnostic);

} // namespace Frontier
