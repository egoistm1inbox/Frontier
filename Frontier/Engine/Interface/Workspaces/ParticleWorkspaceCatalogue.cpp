/*==========================================================================================================================================
                                                        PARTICLEWORKSPACECATALOGUE.CPP
==========================================================================================================================================*/
// 🧩 The Particle Workspace catalogue: the 52 eos presets (read-only names, groups, blurbs, behaviour/appearance codes)
//    mirrored from Experimental/ParticleEditor/Engine/presets.js, the lab scene (PE.defaultScene + DefaultForces), the
//    shell-local log with keyed newest-line updates, formatting helpers, and the TOML export preview builder. Nothing
//    here reads the engines; the export preview renders shell state only.

#include "Engine/Interface/Workspaces/ParticleWorkspace.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <ctime>

namespace Frontier
{

namespace
{

// 📝 PE.Presets order: the main list, then FIBRE_PRESETS, then TRANSITION_PRESETS.
constexpr ParticleWorkspacePreset Presets[] = {
    { "sparks", "Sparks", "Effects", "Hot metal sparks: gravity, drag, ground bounce and wind coupling.", 0, 0, "StudioZap", 0xE8C27AFF }, // 0
    { "strikeSparks", "Strike sparks", "Effects", "Burst of sparks at each lightning strike point (fires on every strike).", 0, 0, "StudioZap", 0xE8C27AFF }, // 1
    { "rain", "Rain streaks", "Weather", "Rain falling through the wind field. Drops bounce off the floor with a small splash rebound, then fade.", 0, 0, "StudioCloud", 0x7DD3FCFF }, // 2
    { "hail", "Hail", "Weather", "Hard ice pellets that drop fast and bounce high off the floor before settling.", 0, 1, "StudioCloud", 0x7DD3FCFF }, // 3
    { "leaves", "Leaves", "Wind-blown", "Leaves released from a canopy; they flutter, tumble and follow the wind field.", 1, 2, "StudioLeaf", 0x8FD3C4FF }, // 4
    { "paper", "Paper & debris", "Wind-blown", "Light paper sheets: high wind coupling and strong sway.", 1, 2, "StudioLeaf", 0x8FD3C4FF }, // 5
    { "atoms", "Atoms (LJ gas)", "Physics", "Lennard-Jones gas on a spatial hash grid with a Langevin thermostat. Colour = speed.", 3, 1, "StudioAtom", 0xC084FCFF }, // 6
    { "chemicals", "Chemicals A+B→C", "Physics", "Reactive particles: A + B react on contact into C, which dissociates back. Read counts back to the CPU.", 4, 1, "StudioAtom", 0xC084FCFF }, // 7
    { "fire", "Fire", "VFX", "Buoyant additive flame with wind-bent tongues.", 5, 3, "StudioSparkles", 0xE8C27AFF }, // 8
    { "smoke", "Smoke", "VFX", "Alpha-blended soft smoke that expands and drifts with the wind.", 5, 3, "StudioSparkles", 0xE8C27AFF }, // 9
    { "explosion", "Explosion", "VFX", "Spherical additive burst. Use the Burst button to fire it.", 5, 3, "StudioSparkles", 0xE8C27AFF }, // 10
    { "tornado", "Tornado debris", "Storms", "Debris lifted by a tornado. Adding it enables the Tornado wind vortex at this spot; the swirl is the grid itself.", 1, 2, "StudioTornado", 0xFB923CFF }, // 11
    { "sandstorm", "Sandstorm", "Storms", "Dust driven across the scene. Adding it sets Prevailing wind to 8 m/s at bearing 70°.", 1, 3, "StudioTornado", 0xFB923CFF }, // 12
    { "snow", "Snow", "Weather", "Slow snowfall that drifts and flutters through the wind field, with a soft rebound at the floor.", 0, 3, "StudioCloud", 0x7DD3FCFF }, // 13
    { "embers", "Embers", "VFX", "Glowing embers lifted on hot air; additive, short-lived, bent by the wind.", 5, 3, "StudioSparkles", 0xE8C27AFF }, // 14
    { "petals", "Cherry petals", "Wind-blown", "Petals drifting off a canopy; they tumble and follow the wind closely.", 1, 2, "StudioLeaf", 0x8FD3C4FF }, // 15
    { "sand", "Sand grains", "Ground", "Sand kicked up from the ground in short hops (saltation) and carried by the wind.", 0, 1, "StudioGrid", 0xA16207FF }, // 16
    { "ash", "Ash flakes", "VFX", "Grey ash lifted by a fire's heat, drifting and settling onto the ground.", 1, 3, "StudioSparkles", 0xE8C27AFF }, // 17
    { "debris", "Small debris", "Ground", "Twigs, bark and wood chips thrown up and clattering off the ground. Small pieces only, no stones.", 0, 0, "StudioGrid", 0xA16207FF }, // 18
    { "flares", "Countermeasure flares", "Aircraft", "IR decoy flares dispensed by a jet to break missile lock: a white-hot burst that falls behind the aircraft and burns out.", 5, 3, "StudioJet", 0xF87171FF }, // 19
    { "pollen", "Pollen & dust motes", "Ambient", "Slow glowing motes that drift on the wind through the air. Light shafts are not modelled.", 1, 3, "StudioSun", 0x3EC46DFF }, // 20
    { "fireflies", "Fireflies", "Ambient", "Glowing points that wander through the air and pulse. Swarm behaviour (kind 6), best at night.", 6, 3, "StudioSun", 0x3EC46DFF }, // 21
    { "insects", "Insect swarm", "Ambient", "Gnat-like swarm that flocks: separation, alignment and cohesion, computed on the GPU.", 6, 1, "StudioSun", 0x3EC46DFF }, // 22
    { "watermist", "Water mist", "Water", "Fine droplets blown off a waterfall or spray: short life and high drag.", 5, 3, "StudioDrop", 0x60A5FAFF }, // 23
    { "splash", "Splash rings", "Water", "Expanding ripple rings on the floor. Placed at random ground points, not at each impact.", 5, 3, "StudioDrop", 0x60A5FAFF }, // 24
    { "glass", "Glass shards", "Effects", "Sharp bright fragments blown from a broken window. They bounce and glint, unlike debris.", 0, 0, "StudioZap", 0xE8C27AFF }, // 25
    { "lapilli", "Volcanic ash & lapilli", "VFX", "Hot, heavy ejecta thrown high by a vent: faster and bigger than ash flakes.", 0, 1, "StudioSparkles", 0xE8C27AFF }, // 26
    { "seeds", "Dandelion seeds", "Wind-blown", "Very light seeds that float and flutter; the wind carries them.", 1, 3, "StudioLeaf", 0x8FD3C4FF }, // 27
    { "feathers", "Feathers", "Wind-blown", "Light feathers that drift, spin and sway in the wind.", 1, 2, "StudioLeaf", 0x8FD3C4FF }, // 28
    { "confetti", "Confetti & streamers", "Wind-blown", "Paper pieces that tumble and flutter; strong wind coupling.", 1, 2, "StudioLeaf", 0x8FD3C4FF }, // 29
    { "steam", "Steam vent", "VFX", "Hot steam rising from a vent and expanding as it cools.", 5, 3, "StudioSparkles", 0xE8C27AFF }, // 30
    { "fireworks", "Fireworks", "VFX", "Timed shells: each burst fires from a random point in the sky, with streaked trails.", 5, 0, "StudioSparkles", 0xE8C27AFF }, // 31
    { "light-streaks", "Light streaks", "Light fibres", "Bezier light streaks: a head runs along each fibre and leaves a fading tail, with head sparks.", 7, 0, "StudioRays", 0xEFF4CFFF }, // 32
    { "ember-ribbons", "Ember ribbons", "Light fibres", "Rippling sheets of ember light; the pulse runs outward across the sheet.", 7, 0, "StudioRays", 0xEFF4CFFF }, // 33
    { "weave-trails", "Weave trails", "Light fibres", "Light trails comet along a weaving path, each leaving a tail that pulses outward along it.", 7, 0, "StudioRays", 0xEFF4CFFF }, // 34
    { "trim-trail", "Trim trail (stadium)", "Light fibres", "Light trails running round a flat stadium loop, the way a light guide follows dashboard trim.", 7, 0, "StudioRays", 0xEFF4CFFF }, // 35
    { "derez-cube", "Derez cube", "Transitions", "A cube derezzes: its surface cubes release in a wave from one corner, bursting or falling. Each cube that hits the floor breaks once into eight smaller cubes.", 5, 4, "StudioBoxes", 0xC084FCFF }, // 36
    { "cube-coins", "Cube to coins", "Transitions", "A gold cube of coins: the surface coins release once, bursting or falling, and bounce on the floor. Coins never split.", 5, 5, "StudioBoxes", 0xC084FCFF }, // 37
    { "melt-away", "Melt away", "Transitions", "The object melts: surface cubes release in patches across the surface rather than a corner wave, and the pieces drift off on the wind.", 5, 4, "StudioBoxes", 0xC084FCFF }, // 38
    { "reverse-derez", "Reverse derez", "Transitions", "The object rebuilds: cubes fly in from a shell around it, snap onto the surface in a wave from one corner, then hold.", 5, 4, "StudioBoxes", 0xC084FCFF }, // 39
    { "voxel-explosion", "Voxel explosion", "Transitions", "A solid sphere made of cubes: it holds for a moment, then every cube bursts radially and tumbles on its own axis. No floor breaking.", 5, 4, "StudioBoxes", 0xC084FCFF }, // 40
    { "coin-stack", "Coin stack", "Transitions", "Gold coins drop one by one into a column on the floor, settle with a small bounce and stay stacked. Scripted drops, not physics: coins do not collide.", 5, 5, "StudioBoxes", 0xC084FCFF }, // 41
    { "coin-fountain", "Coin fountain", "VFX", "Gold coins fired upward from one point, arcing over and bouncing onto the floor. They scatter into a loose heap; particles do not collide, so there is no true pile.", 0, 5, "StudioSparkles", 0xE8C27AFF }, // 42
    { "dissolve-nothing", "Dissolve to nothing", "Transitions", "The object dissolves to nothing: surface pieces release in patches, drift on the wind, shrink and fade out.", 5, 4, "StudioBoxes", 0xC084FCFF }, // 43
    { "dissolve-butterflies", "Dissolve into butterflies", "Transitions", "The object melts in patches, and each released piece becomes a flapping butterfly that rises, drifts on the wind and fades. The butterflies are simple two-pair silhouettes.", 5, 4, "StudioBoxes", 0xC084FCFF }, // 44
    { "black-hole", "Black hole", "Space", "A black hole: a glowing accretion disc spirals inward and is swallowed, while the background bends around the horizon (screen-space lensing, approximate).", 5, 3, "StudioPlanet", 0x818CF8FF }, // 45
    { "heat-shimmer", "Heat shimmer", "VFX", "Hot-air shimmer: a rising, almost invisible plume that bends the scene behind it. Place it over a fire or an exhaust. The bending is a screen-space approximation.", 0, 3, "StudioSparkles", 0xE8C27AFF }, // 46
    { "magnetic-lines", "Magnetic field lines", "Fields", "Light fibres drawn along the field lines of a magnetic dipole (axis in the plane of the lines). Sparks ride the lines. Pair it with Magnetic particles at the same origin.", 7, 0, "StudioMagnet", 0x2ADCAEFF }, // 47
    { "magnetic-particles", "Magnetic particles", "Fields", "Glowing particles steered by a magnetic dipole: they follow the local field direction, so they circulate along the field lines. Pair it with Magnetic field lines at the same origin.", 0, 3, "StudioMagnet", 0x2ADCAEFF }, // 48
    { "bubbles", "Bubbles", "Water", "Soap bubbles: transparent spheres with a fresnel rim and a small highlight. They rise on buoyancy, sway, grow slightly and drift on the wind.", 0, 6, "StudioDrop", 0x60A5FAFF }, // 49
    { "foam", "Foam", "Water", "Dense, small bubbles that bunch up and bob near the floor, pushed by the wind. Good for surf or soapy water.", 0, 6, "StudioDrop", 0x60A5FAFF }, // 50
    { "glitch-dissolve", "Glitch dissolve", "Transitions", "Digital dissolve: the object breaks into cubes in blocky, noise-driven steps, and each released cube jumps in short stutters as it drifts away.", 5, 4, "StudioBoxes", 0xC084FCFF }, // 51
};

constexpr int PresetCount = static_cast<int>(sizeof(Presets) / sizeof(Presets[0]));

// 📝 PE.baseParams() with engine names: every lab effect starts here, then applies its preset overrides.
ParticleEffectParameters ConstructBaseParameters()
{
    ParticleEffectParameters P;
    P.Behaviour              = ParticleBehaviour::Ballistic;
    P.Appearance             = ParticleAppearance::Streak;
    P.LeafSurface            = ParticleLeafSurface::Leaf;
    P.Blend                  = ParticleBlend::Additive;
    P.Capacity               = 2048;
    P.ReleaseRate            = 0.0;
    P.ReleaseShape           = ParticleReleaseShape::Point;
    P.OriginMetres           = { 0.0, 0.5, 0.0 };
    P.RadiusMetres           = 0.1;
    P.BoxHalfMetres          = { 0.0, 0.0, 0.0 };
    P.Direction              = { 0.0, 1.0, 0.0 };
    P.SpreadRadians          = 0.5;
    P.SpeedMinimum           = 1.0;
    P.SpeedMaximum           = 3.0;
    P.Drag                   = 0.2;
    P.Gravity                = 1.0;
    P.LifeMinimumSeconds     = 1.0;
    P.LifeMaximumSeconds     = 2.0;
    P.SizeStartMetres        = 0.05;
    P.SizeEndMetres          = 0.05;
    P.SizeScale              = 1.0;
    P.ColourA                = { 1.0, 1.0, 1.0, 1.0 };
    P.ColourB                = { 1.0, 1.0, 1.0, 0.0 };
    P.ColourC                = { 1.0, 1.0, 0.3, 1.0 };
    P.WindCoupling           = 0.0;
    P.Bounce                 = 0.0;
    P.Buoyancy               = 0.0;
    P.Flutter                = 0.0;
    P.Temperature            = 0.6;
    P.Epsilon                = 0.15;
    P.Sigma                  = 0.08;
    P.Damping                = 2.0;
    P.ReactRate              = 4.0;
    P.Dissociation           = 0.3;
    P.ReactRadius            = 0.12;
    P.FractionA              = 0.5;
    P.IntegrationStepSeconds = 0.004;
    P.PulseHz                = 0.0;
    P.PulseDepth             = 0.0;
    P.SwarmRadiusMetres      = 1.2;
    P.BurstEverySeconds      = 0.0;
    P.BurstCount             = 120;
    P.BurstAtOrigin          = false;
    P.Visible                = true;
    return P;
}

ParticleWorkspaceEffect ConstructLabEffect(int PresetIndex, const char* Name)
{
    ParticleWorkspaceEffect Effect;
    Effect.Preset = PresetIndex;
    Effect.Name   = Name;
    Effect.Parameters = ConstructBaseParameters();
    ParticleEffectParameters& P = Effect.Parameters;
    if (PresetIndex == ParticleWorkspaceLabSparks)
    {
        P.Capacity = 3000; P.ReleaseRate = 160.0;
        P.OriginMetres = { -3.0, 0.4, 0.0 }; P.Direction = { 0.0, 1.0, 0.0 }; P.SpreadRadians = 0.6;
        P.SpeedMinimum = 2.0; P.SpeedMaximum = 6.0; P.Drag = 0.5; P.Gravity = 1.0;
        P.LifeMinimumSeconds = 0.6; P.LifeMaximumSeconds = 1.6;
        P.SizeStartMetres = 0.035; P.SizeEndMetres = 0.01;
        P.ColourA = { 1.0, 0.92, 0.55, 1.0 }; P.ColourB = { 1.0, 0.35, 0.05, 0.0 };
        P.WindCoupling = 0.25; P.Bounce = 0.35;
    }
    else if (PresetIndex == ParticleWorkspaceLabLeaves)
    {
        P.Behaviour = ParticleBehaviour::WindDriven; P.Appearance = ParticleAppearance::Leaf;
        P.Blend = ParticleBlend::AlphaOver;
        P.Capacity = 1200; P.ReleaseRate = 20.0;
        P.ReleaseShape = ParticleReleaseShape::Disc;
        P.OriginMetres = { 0.0, 4.6, 0.0 }; P.RadiusMetres = 4.5; P.Direction = { 0.0, -1.0, 0.0 }; P.SpreadRadians = 0.5;
        P.SpeedMinimum = 0.2; P.SpeedMaximum = 0.9; P.Drag = 1.4; P.Gravity = 0.35;
        P.LifeMinimumSeconds = 7.0; P.LifeMaximumSeconds = 12.0;
        P.SizeStartMetres = 0.14; P.SizeEndMetres = 0.12;
        P.ColourA = { 0.42, 0.72, 0.22, 1.0 }; P.ColourB = { 0.8, 0.52, 0.16, 1.0 };
        P.WindCoupling = 2.2; P.Flutter = 1.2; P.Bounce = 0.0;
    }
    else if (PresetIndex == ParticleWorkspaceLabAtoms)
    {
        P.Behaviour = ParticleBehaviour::LennardJones; P.Appearance = ParticleAppearance::Sphere;
        P.Blend = ParticleBlend::AlphaOver;
        P.Capacity = 1024;
        P.ReleaseShape = ParticleReleaseShape::Box;
        P.OriginMetres = { 3.2, 1.0, -2.6 }; P.BoxHalfMetres = { 0.9, 0.9, 0.9 };
        P.Sigma = 0.08; P.Epsilon = 0.15; P.Temperature = 0.6; P.Damping = 2.0; P.IntegrationStepSeconds = 0.004;
        P.ColourA = { 0.35, 0.65, 1.0, 1.0 }; P.ColourB = { 1.0, 0.35, 0.25, 1.0 };
    }
    else if (PresetIndex == ParticleWorkspaceLabChemicals)
    {
        P.Behaviour = ParticleBehaviour::Reactive; P.Appearance = ParticleAppearance::Sphere;
        P.Blend = ParticleBlend::AlphaOver;
        P.Capacity = 1024;
        P.ReleaseShape = ParticleReleaseShape::Box;
        P.OriginMetres = { 3.2, 1.0, 2.6 }; P.BoxHalfMetres = { 0.9, 0.9, 0.9 };
        P.Sigma = 0.08; P.Temperature = 0.6; P.Damping = 2.0; P.IntegrationStepSeconds = 0.004;
        P.ReactRate = 6.0; P.Dissociation = 0.3; P.ReactRadius = 0.12; P.FractionA = 0.5;
        P.ColourA = { 1.0, 0.38, 0.3, 1.0 }; P.ColourB = { 0.3, 0.62, 1.0, 1.0 }; P.ColourC = { 1.0, 0.86, 0.3, 1.0 };
    }
    return Effect;
}

ParticleWorkspaceForce ConstructLabForce(int Category, const char* Name, bool Enabled, double X, double Y, double Z, double Radius,
                                         double Strength, double Bearing, double Rate)
{
    ParticleWorkspaceForce Force;
    Force.Category = Category;
    Force.Name     = Name;
    Force.Enabled  = Enabled;
    Force.Centre[0] = X; Force.Centre[1] = Y; Force.Centre[2] = Z;
    Force.Radius   = Radius;
    Force.Strength = Strength;
    Force.Bearing  = Bearing;
    Force.Rate     = Rate;
    return Force;
}

void AppendExportDouble(std::string& Text, const char* Key, double Value)
{
    char Line[96]{};
    std::snprintf(Line, sizeof(Line), "%s = %.6g\n", Key, Value);
    Text += Line;
}

void AppendExportVector(std::string& Text, const char* Key, const double* Values, int Count)
{
    char Line[192]{};
    int  Used = std::snprintf(Line, sizeof(Line), "%s = [", Key);
    for (int Index = 0; Index < Count && Used > 0 && Used < static_cast<int>(sizeof(Line)) - 24; ++Index)
        Used += std::snprintf(Line + Used, sizeof(Line) - Used, "%s%.6g", Index > 0 ? ", " : "", Values[Index]);
    if (Used > 0 && Used < static_cast<int>(sizeof(Line)) - 2) std::snprintf(Line + Used, sizeof(Line) - Used, "]\n");
    Text += Line;
}

const char* ResolveExportBehaviour(ParticleBehaviour Behaviour) noexcept
{
    switch (Behaviour)
    {
    case ParticleBehaviour::Ballistic:    return "ballistic";
    case ParticleBehaviour::WindDriven:   return "wind_driven";
    case ParticleBehaviour::LennardJones: return "lennard_jones";
    case ParticleBehaviour::Reactive:     return "reactive";
    case ParticleBehaviour::VisualEffect: return "visual_effect";
    case ParticleBehaviour::Flocking:     return "flocking";
    case ParticleBehaviour::LightFibre:   return "light_fibre";
    }
    return "ballistic";
}

const char* ResolveExportAppearance(ParticleAppearance Appearance) noexcept
{
    switch (Appearance)
    {
    case ParticleAppearance::Streak:   return "streak";
    case ParticleAppearance::Sphere:   return "sphere";
    case ParticleAppearance::Leaf:     return "leaf";
    case ParticleAppearance::SoftGlow: return "soft_glow";
    case ParticleAppearance::Cube:     return "cube";
    case ParticleAppearance::Coin:     return "coin";
    case ParticleAppearance::Bubble:   return "bubble";
    }
    return "streak";
}

const char* ResolveExportRelease(ParticleReleaseShape Shape) noexcept
{
    switch (Shape)
    {
    case ParticleReleaseShape::Point:       return "point";
    case ParticleReleaseShape::Sphere:      return "sphere";
    case ParticleReleaseShape::Disc:        return "disc";
    case ParticleReleaseShape::Box:         return "box";
    case ParticleReleaseShape::CubeSurface: return "cube_surface";
    }
    return "point";
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    CATALOGUE QUERIES
//------------------------------------------------------------------------------------------------------------------------

int QueryParticlePresetCount() noexcept
{
    return PresetCount;
}

const ParticleWorkspacePreset& QueryParticlePreset(int Index) noexcept
{
    static constexpr ParticleWorkspacePreset Fallback{ "sparks", "Sparks", "Effects", "", 0, 0, "StudioZap", 0xE8C27AFF };
    if (Index < 0 || Index >= PresetCount) return Fallback;
    return Presets[Index];
}

int QueryParticlePresetById(const char* Id) noexcept
{
    if (Id == nullptr) return -1;
    for (int Index = 0; Index < PresetCount; ++Index)
    {
        if (std::strcmp(Presets[Index].Id, Id) == 0) return Index;
    }
    return -1;
}

const char* QueryParticleBehaviourName(int Behaviour) noexcept
{
    switch (Behaviour)
    {
    case 0: return "Ballistic";
    case 1: return "Wind-driven";
    case 3: return "Lennard-Jones";
    case 4: return "Reactive";
    case 5: return "Visual effect";
    case 6: return "Flocking";
    case 7: return "Light fibre";
    }
    return "Ballistic";
}

const char* QueryParticleAppearanceName(int Appearance) noexcept
{
    switch (Appearance)
    {
    case 0: return "Streak";
    case 1: return "Sphere";
    case 2: return "Leaf";
    case 3: return "Soft glow";
    case 4: return "Cube";
    case 5: return "Coin";
    case 6: return "Bubble";
    }
    return "Streak";
}

const char* QueryParticleReleaseName(int Shape) noexcept
{
    switch (Shape)
    {
    case 0: return "Point";
    case 1: return "Sphere";
    case 2: return "Disc";
    case 3: return "Box";
    case 4: return "Cube Surface";
    }
    return "Point";
}

const char* QueryParticleForceName(int Category) noexcept
{
    switch (Category)
    {
    case ParticleWorkspaceForcePrevailing: return "Prevailing";
    case ParticleWorkspaceForceGust:       return "Gust";
    case ParticleWorkspaceForceTornado:    return "Tornado";
    case ParticleWorkspaceForceOutflow:    return "Outflow";
    }
    return "Prevailing";
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    VIEW HELPERS
//------------------------------------------------------------------------------------------------------------------------

void FormatParticleTrimmed(double Value, int Digits, char* Text, size_t TextSize) noexcept
{
    if (Text == nullptr || TextSize == 0) return;
    if (Digits < 0) Digits = 0;
    if (Digits > 6) Digits = 6;
    char Figure[64]{};
    std::snprintf(Figure, sizeof(Figure), "%.*f", Digits, Value);
    char* Dot = std::strchr(Figure, '.');
    if (Dot != nullptr)
    {
        char* End = Figure + std::strlen(Figure);
        while (End > Dot + 1 && End[-1] == '0') --End;
        if (End == Dot + 1) --End;
        *End = '\0';
    }
    std::snprintf(Text, TextSize, "%s", Figure);
}

void FormatParticleSpan(double Metres, char* Text, size_t TextSize) noexcept
{
    if (Text == nullptr || TextSize == 0) return;
    const double Magnitude = std::fabs(Metres);
    if (Magnitude < 1e-6)
    {
        std::snprintf(Text, TextSize, "0 m");
        return;
    }
    if (Magnitude >= 1000.0)
    {
        const int Decimals = Magnitude >= 10000.0 ? 0 : (Magnitude >= 2000.0 ? 1 : 2);
        char      Figure[32]{};
        std::snprintf(Figure, sizeof(Figure), "%.*f", Decimals, Metres / 1000.0);
        char* Dot = std::strchr(Figure, '.');
        if (Dot != nullptr)
        {
            char* End = Figure + std::strlen(Figure);
            while (End > Dot + 1 && End[-1] == '0') --End;
            if (End == Dot + 1) --End;
            *End = '\0';
        }
        std::snprintf(Text, TextSize, "%s km", Figure);
        return;
    }
    if (Magnitude >= 10.0)
    {
        std::snprintf(Text, TextSize, "%.0f m", Metres);
        return;
    }
    if (Magnitude >= 1.0)
    {
        char Figure[32]{};
        std::snprintf(Figure, sizeof(Figure), "%.1f", Metres);
        const size_t Length = std::strlen(Figure);
        if (Length >= 2 && Figure[Length - 2] == '.' && Figure[Length - 1] == '0') Figure[Length - 2] = '\0';
        std::snprintf(Text, TextSize, "%s m", Figure);
        return;
    }
    std::snprintf(Text, TextSize, "%.0f cm", Metres * 100.0);
}

bool QueryParticleWorkspaceRect(const ParticleWorkspaceState& State, const char* Name, ImVec2& Min, ImVec2& Max) noexcept
{
    if (Name == nullptr) return false;
    const auto Found = State.Rects.find(Name);
    if (Found == State.Rects.end()) return false;
    Min = ImVec2(Found->second.x, Found->second.y);
    Max = ImVec2(Found->second.z, Found->second.w);
    return true;
}

void AppendParticleWorkspaceLog(ParticleWorkspaceState& State, const char* Channel, const char* Message, const char* Detail, const char* Key)
{
    if (Channel == nullptr || Message == nullptr) return;
    char When[16]{};
    {
        const std::time_t Now = std::time(nullptr);
        std::tm             Parts{};
#if defined(_WIN32)
        localtime_s(&Parts, &Now);
#else
        localtime_r(&Now, &Parts);
#endif
        std::snprintf(When, sizeof(When), "%02d:%02d:%02d", Parts.tm_hour, Parts.tm_min, Parts.tm_sec);
    }
    if (Key != nullptr)
    {
        // 📝 A keyed append refreshes the newest matching line instead of spamming the stream.
        for (ParticleWorkspaceLogEntry& Entry : State.Log)
        {
            if (Entry.Channel == Channel && Entry.Message.rfind(Key, 0) == 0)
            {
                Entry.Message = Message;
                Entry.Detail  = Detail != nullptr ? Detail : "";
                Entry.When    = When;
                return;
            }
        }
    }
    ParticleWorkspaceLogEntry Entry{};
    Entry.When    = When;
    Entry.Channel = Channel;
    Entry.Message = Message;
    Entry.Detail  = Detail != nullptr ? Detail : "";
    State.Log.push_front(std::move(Entry));
    while (State.Log.size() > 80) State.Log.pop_back();
}

void NoopParticleWorkspaceAction(ParticleWorkspaceState& State, const char* Channel, const char* Message)
{
    AppendParticleWorkspaceLog(State, Channel, Message, "NOOP in this shell");
}

void SelectParticleWorkspaceNode(ParticleWorkspaceState& State, int Selection) noexcept
{
    State.Selected = Selection;
}

void ResetParticleWorkspaceEffect(ParticleWorkspaceEffect& Effect)
{
    // 📝 Local-only: the preset P from the catalogue defaults; the display name and tab survive.
    ParticleWorkspaceEffect Fresh = ConstructLabEffect(Effect.Preset, Effect.Name.c_str());
    Effect.Parameters     = Fresh.Parameters;
    Effect.ModuleWind      = true;
    Effect.ModuleBurst     = false;
    Effect.ModuleMolecular = Effect.Preset == ParticleWorkspaceLabAtoms || Effect.Preset == ParticleWorkspaceLabChemicals;
    Effect.ModuleChemistry = Effect.Preset == ParticleWorkspaceLabChemicals;
    Effect.ModuleFlock     = false;
    Effect.ModuleFibre     = false;
}

void RebuildParticleWorkspaceExport(ParticleWorkspaceState& State)
{
    // 📝 Shell state only: each effect renders its local Parameters copy; the catalogue presets are read-only names.
    std::string Text = "# Particle Workspace export preview — shell state only, nothing simulated.\nscene = \"lab\"\n";
    for (const ParticleWorkspaceEffect& Effect : State.Effects)
    {
        const ParticleWorkspacePreset& Preset = QueryParticlePreset(Effect.Preset);
        const ParticleEffectParameters& P     = Effect.Parameters;
        char Head[256]{};
        std::snprintf(Head, sizeof(Head), "\n[[effect]]\nidentifier = \"%s\"\nname = \"%s\"\ngroup = \"%s\"\nvisible = %s\n",
                      Preset.Id, Effect.Name.c_str(), Preset.Group, Effect.Enabled ? "true" : "false");
        Text += Head;
        char Enums[256]{};
        std::snprintf(Enums, sizeof(Enums), "behaviour = \"%s\"\nappearance = \"%s\"\nrelease = \"%s\"\nblend = \"%s\"\n",
                      ResolveExportBehaviour(P.Behaviour), ResolveExportAppearance(P.Appearance), ResolveExportRelease(P.ReleaseShape),
                      P.Blend == ParticleBlend::Additive ? "additive" : "alpha_over");
        Text += Enums;
        char Capacity[64]{};
        std::snprintf(Capacity, sizeof(Capacity), "capacity = %d\n", P.Capacity);
        Text += Capacity;
        AppendExportDouble(Text, "release_rate", P.ReleaseRate);
        AppendExportVector(Text, "origin_metres", P.OriginMetres.data(), 3);
        AppendExportDouble(Text, "radius_metres", P.RadiusMetres);
        AppendExportVector(Text, "box_half_metres", P.BoxHalfMetres.data(), 3);
        AppendExportVector(Text, "direction", P.Direction.data(), 3);
        AppendExportDouble(Text, "spread_radians", P.SpreadRadians);
        AppendExportDouble(Text, "speed_minimum_mps", P.SpeedMinimum);
        AppendExportDouble(Text, "speed_maximum_mps", P.SpeedMaximum);
        AppendExportDouble(Text, "drag", P.Drag);
        AppendExportDouble(Text, "gravity", P.Gravity);
        AppendExportDouble(Text, "life_minimum_seconds", P.LifeMinimumSeconds);
        AppendExportDouble(Text, "life_maximum_seconds", P.LifeMaximumSeconds);
        AppendExportDouble(Text, "size_start_metres", P.SizeStartMetres);
        AppendExportDouble(Text, "size_end_metres", P.SizeEndMetres);
        AppendExportVector(Text, "colour_a", P.ColourA.data(), 4);
        AppendExportVector(Text, "colour_b", P.ColourB.data(), 4);
        AppendExportVector(Text, "colour_c", P.ColourC.data(), 4);
        AppendExportDouble(Text, "wind_coupling", P.WindCoupling);
        AppendExportDouble(Text, "bounce", P.Bounce);
        AppendExportDouble(Text, "buoyancy", P.Buoyancy);
        AppendExportDouble(Text, "flutter", P.Flutter);
    }
    State.ExportText = std::move(Text);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    DEFAULT STATE
//------------------------------------------------------------------------------------------------------------------------

void ConstructParticleWorkspaceState(ParticleWorkspaceState& State)
{
    State = ParticleWorkspaceState{};
    // 📝 The lab scene: PE.defaultScene (sparks, leaves, atoms, chemicals) plus DefaultForces.
    State.Effects = {
        ConstructLabEffect(ParticleWorkspaceLabSparks, "Sparks"),
        ConstructLabEffect(ParticleWorkspaceLabLeaves, "Leaves"),
        ConstructLabEffect(ParticleWorkspaceLabAtoms, "Atoms (LJ gas)"),
        ConstructLabEffect(ParticleWorkspaceLabChemicals, "Chemicals A+B→C"),
    };
    State.Effects[2].ModuleMolecular = true;
    State.Effects[3].ModuleMolecular = true;
    State.Effects[3].ModuleChemistry = true;
    State.Forces = {
        ConstructLabForce(ParticleWorkspaceForcePrevailing, "Prevailing wind", true, 0.0, 0.0, 0.0, 6.0, 3.0, 70.0, 0.3),
        ConstructLabForce(ParticleWorkspaceForceGust, "Passing gust", true, -4.0, 0.0, 0.0, 4.0, 5.0, 70.0, 0.3),
        ConstructLabForce(ParticleWorkspaceForceTornado, "Tornado", false, -2.0, 0.0, -4.0, 1.6, 6.0, 0.0, 0.0),
        ConstructLabForce(ParticleWorkspaceForceOutflow, "Radial suction", false, 0.0, 0.0, -2.0, 3.0, -2.0, 0.0, 0.0),
    };
    for (int Index = 0; Index < 40; ++Index) State.AliveSamples[Index] = 0.0;
    State.AliveCount = 40;
    RebuildParticleWorkspaceExport(State);
    AppendParticleWorkspaceLog(State, "WORKSPACE", "Particle Workspace ready (shell)", "4 lab effects · engine calls disabled");
}

} // namespace Frontier
