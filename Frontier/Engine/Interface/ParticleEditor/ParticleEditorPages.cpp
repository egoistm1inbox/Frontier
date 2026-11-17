/*==========================================================================================================================================
                                                         PARTICLEEDITORPAGES.CPP
==========================================================================================================================================*/
// 🧩 The Particle editor's inspector pages over the shared controls: the Force Field and its Wind guest, one force, Lightning and
//    one effect with its sections.

#include "Engine/Interface/ParticleEditor/ParticleEditorPages.h"

#if FRONTIER_EDITOR && defined(FRONTIER_WITH_INTERFACE_SDK)

#include "Engine/Interface/Controls/PageControls.h"
#include "Engine/Interface/Controls/SectionRows.h"
#include "Engine/Interface/InspectorControls.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <span>
#include <string>

namespace Frontier
{

namespace
{

constexpr const char* ContributionLabels[3] = { "Flow \xC2\xB7 m/s", "Accelerate \xC2\xB7 m/s\xC2\xB2", "Damp \xC2\xB7 1/s" };
constexpr const char* ReachLabels[3]        = { "Everywhere", "Sphere", "Box" };
constexpr const char* FalloffLabels[4]      = { "None", "Linear", "Smooth", "Inverse square" };
constexpr const char* AppearanceLabels[7]   = { "Streak", "Sphere", "Leaf", "Soft glow", "Cube", "Coin", "Bubble" };
constexpr const char* ReleaseLabels[5]      = { "Point", "Sphere", "Disc", "Box", "Cube surface" };
constexpr const char* BlendLabels[2]        = { "Additive", "Alpha over" };
constexpr const char* WaveLabels[3]         = { "Corner", "Melt", "Glitch" };
constexpr const char* AssembleLabels[3]     = { "Burst or fall", "Rebuild", "Stack" };
constexpr const char* FibreShapeLabels[3]   = { "Streak", "Ribbon", "Trail" };
constexpr const char* ColouringLabels[3]    = { "Solid", "Ramp", "Palette" };
constexpr const char* PulseLabels[4]        = { "Breathe", "Heartbeat", "Ripple", "Sweep" };

int   ActiveEffectSection = 0;
int   ActiveFieldSection  = 0;
int   PendingCategory     = static_cast<int>(ParticleFieldCategory::Attract);

int ResolveReachIndex(ForceReach Reach) noexcept
{
    return Reach == ForceReach::Everywhere ? 0 : Reach == ForceReach::Box ? 2 : 1;
}

ForceReach ResolveReach(int Index) noexcept
{
    return Index == 0 ? ForceReach::Everywhere : Index == 2 ? ForceReach::Box : ForceReach::Sphere;
}

// 📝 A double triple through the float axis fields, written back only when it changed.
bool ConstructTriple(ControlColumn& Page, const char* Id, const char* Caption, std::array<double, 3>& Value, float Minimum, float Maximum)
{
    float Fields[3] = { static_cast<float>(Value[0]), static_cast<float>(Value[1]), static_cast<float>(Value[2]) };
    if (!AxisFields::Construct(Page, Id, Caption, Fields, { Minimum, Minimum, Minimum }, { Maximum, Maximum, Maximum })) return false;
    Value = { Fields[0], Fields[1], Fields[2] };
    return true;
}

bool ConstructColour(ControlColumn& Page, const char* Id, const char* Label, std::array<double, 4>& Colour)
{
    float Linear[3] = { static_cast<float>(Colour[0]), static_cast<float>(Colour[1]), static_cast<float>(Colour[2]) };
    if (!TintRow::Construct(Page, Id, Label, Linear)) return false;
    Colour[0] = Linear[0];
    Colour[1] = Linear[1];
    Colour[2] = Linear[2];
    return true;
}

bool ConstructInteger(ControlColumn& Page, const char* Id, const char* Label, int32_t& Value, int Minimum, int Maximum, const char* Unit)
{
    int Editable = Value;
    if (!SectionRows::Count(Page, Id, Label, Editable, Minimum, Maximum, Unit)) return false;
    Value = Editable;
    return true;
}

template <typename Choice>
bool ConstructChoice(ControlColumn& Page, const char* Id, const char* Label, const char* const* Options, int Count, Choice& Value)
{
    int Index = static_cast<int>(Value);
    if (!ChoiceRow::Construct(Page, Id, Label, Options, Count, Index)) return false;
    Value = static_cast<Choice>(Index);
    return true;
}

void FormatFigure(double Value, char* Text, size_t Capacity)
{
    if (std::fabs(Value) >= 100.0) std::snprintf(Text, Capacity, "%.0f", Value);
    else if (std::fabs(Value) >= 10.0) std::snprintf(Text, Capacity, "%.1f", Value);
    else std::snprintf(Text, Capacity, "%.2f", Value);
}

} // namespace

const ParticleEffectCensus* ParticleEditorPages::ResolveCensus(const ParticleViewportImage& Image, const std::string& Token) noexcept
{
    for (const ParticleEffectCensus& Census : Image.Census)
    {
        if (Census.Token == Token) return &Census;
    }
    return nullptr;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    FORCE FIELD
//------------------------------------------------------------------------------------------------------------------------

void ParticleEditorPages::ConstructFieldPage(ControlColumn& Page, ParticleEditorContext& Context)
{
    ParticleSpace&           Space   = Context.Space;
    ParticleOverlaySettings& Overlay = Context.Overlay;
    if (PageHeading::Construct(Page, "ParticleFieldOverlay", "ENVIRONMENT", "Force Field", Overlay.Enabled ? "\xE2\x97\x8F Overlay" : "\xE2\x97\x8B Overlay",
                               "The same master component as the Force Field editor: the wind lattice (its guest) and the space's localized "
                               "forces, drawn by the shared visualization.",
                               "Show the field overlay (V)"))
    {
        Overlay.Enabled = !Overlay.Enabled;
    }
    int Shown = static_cast<int>(Overlay.Contribution);
    if (TabStrip::Construct(Page, "ParticleFieldContribution", ContributionLabels, 3, Shown)) Overlay.Contribution = static_cast<ForceContribution>(Shown);

    // 📝 The probe reads the GPU lattice: one cell, the same 8 bytes the prototype maps back.
    char Speed[32], Vertical[32], Bearing[32];
    const float Horizontal = std::hypot(Context.Image.Probe[0], Context.Image.Probe[2]);
    FormatFigure(Context.Image.ProbeValid ? Context.Image.Probe[3] : 0.0, Speed, sizeof(Speed));
    std::snprintf(Vertical, sizeof(Vertical), "%.2f", Context.Image.ProbeValid ? Context.Image.Probe[1] : 0.0f);
    const double Compass = std::fmod(std::fmod(180.0 - std::atan2(Context.Image.Probe[0], Context.Image.Probe[2]) * 57.29577951308232, 360.0) + 360.0, 360.0);
    std::snprintf(Bearing, sizeof(Bearing), "%.0f\xC2\xB0 %s", Compass, SectionRows::ResolveCompassPoint(Compass));
    char HorizontalText[32];
    std::snprintf(HorizontalText, sizeof(HorizontalText), "%.2f", Horizontal);
    const MetricTile Probe[3] = { { "Wind at the probe", Speed, "m/s" }, { "Horizontal", HorizontalText, Bearing }, { "Vertical", Vertical, "m/s" } };
    MetricTiles::Construct(Page, Probe, 3, MetricTiles::NoLead);

    uint32_t Flow = 0, Accelerate = 0, Damp = 0, Lattice = 0, Packed = 0, Authored = 0;
    for (const ParticleField& Field : Space.Fields)
    {
        const ParticleFieldDescriptor& Descriptor = ResolveParticleFieldDescriptor(Field.Category);
        Flow += Descriptor.Contribution == ForceContribution::Flow ? 1u : 0u;
        Accelerate += Descriptor.Contribution == ForceContribution::Accelerate ? 1u : 0u;
        Damp += Descriptor.Contribution == ForceContribution::Damp ? 1u : 0u;
        Lattice += Descriptor.LatticeSlot >= 0 ? 1u : 0u;
        Authored += EvaluateParticleFieldPackable(Field) ? 0u : 1u;
    }
    if (Context.Plan) Packed = static_cast<uint32_t>(Context.Plan->Fields[0]);
    char FlowText[16], AccelerateText[16], DampText[16], LatticeText[32], PackedText[32], AuthoredText[16];
    std::snprintf(FlowText, sizeof(FlowText), "%u", Flow);
    std::snprintf(AccelerateText, sizeof(AccelerateText), "%u", Accelerate);
    std::snprintf(DampText, sizeof(DampText), "%u", Damp);
    std::snprintf(LatticeText, sizeof(LatticeText), "%u of 16", Lattice);
    std::snprintf(PackedText, sizeof(PackedText), "%u of 8", Packed);
    std::snprintf(AuthoredText, sizeof(AuthoredText), "%u", Authored);
    const MetricTile Counts[4] = { { "Flow", FlowText, "fields" }, { "Accelerate", AccelerateText, "fields" }, { "Damp", DampText, "fields" },
                                   { "Lattice", "6912", "24\xC3\x97" "12\xC3\x97" "24 cells" } };
    MetricTiles::Construct(Page, Counts, 4, MetricTiles::NoLead);
    const MetricTile Paths[3] = { { "Summed into the lattice", LatticeText, "flows" }, { "Packed for fieldAccel", PackedText, "this refresh" },
                                  { "Without a GPU path", AuthoredText, "fields" } };
    MetricTiles::Construct(Page, Paths, 3, MetricTiles::NoLead);

    SectionHeading::Construct(Page, "Quick controls", "Overlay and lattice");
    const QuickTile Tiles[6] = {
        { "Field overlay", "GridLattice", &Overlay.Enabled, "The shared visualization over the image (V)" },
        { "Heatmap", "Palette", &Overlay.Heatmap, "The slice coloured by the quantity" },
        { "Slice arrows", "Move", &Overlay.Arrows, "Arrows on the slice" },
        { "Tracers", "Activity", &Overlay.Tracers, "Particles advected on the slice" },
        { "Labels", "Flag", &Overlay.Labels, "Force names on their outlines" },
        { "Lattice arrows", "Wind", &Space.Wind.ShowArrows, "One arrow per lattice cell, rastered on the GPU" },
    };
    QuickTiles::Construct(Page, "ParticleFieldQuick", Tiles, 6, 3);

    constexpr const char* Sections[2] = { "Overlay", "Forces" };
    TabStrip::Construct(Page, "ParticleFieldSections", Sections, 2, ActiveFieldSection);
    if (ActiveFieldSection == 0)
    {
        SectionRows::BeginSection(Page, "Overlay", "GridLattice", Overlay.Enabled ? "on" : "off", "The horizontal slice the visualization samples.");
        SectionRows::Measure(Page, "ParticleSlice", "Slice height", Overlay.SliceHeight, 0.0, 8.0, 0.05, "m");
        float Opacity = Overlay.Opacity;
        if (SectionRows::Amount(Page, "ParticleOpacity", "Heatmap opacity", Opacity, 0.05f, 1.0f, 0.01f, "")) Overlay.Opacity = Opacity;
        float Spacing = Overlay.ArrowSpacing;
        if (SectionRows::Amount(Page, "ParticleSpacing", "Arrow spacing", Spacing, 16.0f, 80.0f, 1.0f, "px")) Overlay.ArrowSpacing = Spacing;
        int Quantity = static_cast<int>(Overlay.Quantity);
        constexpr const char* Quantities[6] = { "Speed", "Along X", "Along Z", "Vertical", "Vorticity", "Divergence" };
        if (ChoiceRow::Construct(Page, "ParticleQuantity", "Quantity", Quantities, 6, Quantity)) Overlay.Quantity = static_cast<ForceFieldQuantity>(Quantity);
        SectionRows::EndSection(Page);
    }
    else
    {
        SectionRows::BeginSection(Page, "Forces", "Magnet", nullptr, "Add a localized force; it lands at the domain centre.");
        constexpr const char* Categories[ParticleFieldCategoryCount] = { "Prevailing wind", "Gust front", "Tornado", "Blast outflow", "Attractor", "Repulsor",
                                                                         "Lift", "Magnetic dipole", "Gravity", "Orbit", "Drag volume", "Current" };
        ChoiceRow::Construct(Page, "ParticleForceCategory", "Category", Categories, static_cast<int>(ParticleFieldCategoryCount), PendingCategory);
        const ActionEntry Add[1] = { { "ParticleAddForce", "Add force" } };
        if (ActionRow::Construct(Page, std::span<const ActionEntry>(Add, 1)) == 0)
            Context.Requests.push_back("add-force:" + std::string(ResolveParticleFieldDescriptor(static_cast<ParticleFieldCategory>(PendingCategory)).Identifier));
        SectionRows::EndSection(Page);
    }
    if (NextButton::Construct(Page, "ParticleOpenWind", "Open the Wind guest \xE2\x86\x97")) Context.Requests.push_back("select:Wind");
    FooterRow::Construct(Page, "Force Field \xC2\xB7 Wind \xC2\xB7 forces", "Particle space");
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    WIND
//------------------------------------------------------------------------------------------------------------------------

void ParticleEditorPages::ConstructWindPage(ControlColumn& Page, ParticleEditorContext& Context)
{
    ParticleWindSettings& Wind = Context.Space.Wind;
    const bool SharedField = Context.Plan && Context.Plan->SharedFieldActive;
    const char* Description = SharedField
                                 ? "The native level ForceField is sampled over every cell of the 24 × 12 × 24 lattice; Particle-local flow sources are bypassed."
                                 : "Particle-local flow sources build the 24 × 12 × 24 lattice, sampled by every wind-driven particle.";
    if (PageHeading::Construct(Page, "ParticleWindArrows", "GUEST OF THE FORCE FIELD", "Wind", Wind.ShowArrows ? "\xE2\x97\x8F Arrows" : "\xE2\x97\x8B Arrows",
                               Description, "Raster one arrow per lattice cell"))
    {
        Wind.ShowArrows = !Wind.ShowArrows;
    }
    char Speed[32], Components[16];
    FormatFigure(Context.Image.ProbeValid ? Context.Image.Probe[3] : 0.0, Speed, sizeof(Speed));
    std::snprintf(Components, sizeof(Components), "%u", Context.Plan ? static_cast<uint32_t>(Context.Plan->Constants[39]) : 0u);
    const MetricTile Tiles[3] = { { "Probe", Speed, "m/s" },
                                  { SharedField ? "Shared field" : "Flow components", SharedField ? "ForceField" : Components,
                                    SharedField ? "native" : "of 16" },
                                  { "Cells", "6,912", "rgba16f" } };
    MetricTiles::Construct(Page, Tiles, 3, MetricTiles::NoLead);
    SectionRows::BeginSection(Page, "Lattice", "Wind", nullptr,
                              SharedField ? "The native field owns all 6,912 cells; local Particle flow sources are bypassed."
                                          : "Scale, turbulence and swirl of the Particle-local flow lattice.");
    SectionRows::Measure(Page, "ParticleWindScale", "Wind scale", Wind.WindScale, 0.0, 4.0, 0.05, "\xC3\x97");
    SectionRows::Measure(Page, "ParticleTurbulence", "Turbulence", Wind.Turbulence, 0.0, 3.0, 0.01, "m/s");
    SectionRows::Measure(Page, "ParticleSwirl", "Swirl", Wind.Swirl, 0.0, 5.0, 0.05, "m/s");
    SectionRows::EndSection(Page);
    SectionRows::BeginSection(Page, "Display", "Eye", nullptr, "What the viewport rasters besides the particles.");
    SectionRows::Switch(Page, "ParticleArrows", "Lattice arrows", Wind.ShowArrows);
    SectionRows::Measure(Page, "ParticleArrowReference", "Arrow full scale", Wind.ArrowReferenceMps, 1.0, 20.0, 0.5, "m/s");
    int Stride = static_cast<int>(Wind.ArrowStride);
    if (SectionRows::Count(Page, "ParticleArrowStride", "Arrow stride", Stride, 1, 6, "cells")) Wind.ArrowStride = Stride;
    SectionRows::Switch(Page, "ParticleFloor", "Floor grid", Wind.ShowFloor);
    SectionRows::Switch(Page, "ParticleDomain", "Domain box", Wind.ShowDomain);
    SectionRows::EndSection(Page);

    // 📝 The level's ForceField is sampled throughout the domain, translated from particle-local to level coordinates at this anchor.
    ParticleLevelWind& Level = Context.Space.LevelWind;
    char               Flow[64] = "off";
    if (Level.Follow && Level.FlowMps)
    {
        const double Speed   = std::hypot((*Level.FlowMps)[0], (*Level.FlowMps)[1], (*Level.FlowMps)[2]);
        const double Bearing = std::fmod(std::atan2((*Level.FlowMps)[0], -(*Level.FlowMps)[2]) * 57.29577951308232 + 360.0, 360.0);
        std::snprintf(Flow, sizeof(Flow), "%.1f m/s \xC2\xB7 %.0f\xC2\xB0", Speed, Bearing);
    }
    else if (Level.Follow)
    {
        std::snprintf(Flow, sizeof(Flow), "no Force Field");
    }
    SectionRows::BeginSection(Page, "Level", "Globe", Flow,
                              "The same native ForceField is sampled at every lattice cell. Its shared sources are not copied into ParticleSpace.");
    SectionRows::Switch(Page, "ParticleLevelFollow", "Follow the level's Force Field", Level.Follow,
                        Context.LevelFieldAvailable ? nullptr : "No level field is available");
    SectionRows::Distance(Page, "ParticleLevelAnchorX", "Anchor X", Level.AnchorMetres[0], -100000.0, 100000.0, 1.0);
    SectionRows::Distance(Page, "ParticleLevelAnchorY", "Anchor Y", Level.AnchorMetres[1], -100000.0, 100000.0, 1.0);
    SectionRows::Distance(Page, "ParticleLevelAnchorZ", "Anchor height", Level.AnchorMetres[2], 0.0, 100000.0, 1.0);
    SectionRows::EndSection(Page);
    FooterRow::Construct(Page, "Wind \xC2\xB7 guest of the Force Field", "Particle space");
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    FORCE
//------------------------------------------------------------------------------------------------------------------------

void ParticleEditorPages::ConstructForcePage(ControlColumn& Page, ParticleEditorContext& Context, size_t Index)
{
    if (Index >= Context.Space.Fields.size()) return;
    ParticleField&                 Field      = Context.Space.Fields[Index];
    const ParticleFieldDescriptor& Descriptor = ResolveParticleFieldDescriptor(Field.Category);
    char                           Eyebrow[64];
    std::snprintf(Eyebrow, sizeof(Eyebrow), "%s \xC2\xB7 %s", Descriptor.Contribution == ForceContribution::Flow ? "FLOW"
                                                          : Descriptor.Contribution == ForceContribution::Accelerate ? "ACCELERATE" : "DAMP", Descriptor.Unit);
    if (PageHeading::Construct(Page, "ParticleForceEnabled", Eyebrow, Field.Name.c_str(), Field.Enabled ? "\xE2\x97\x8F On" : "\xE2\x97\x8B Off", Descriptor.Name,
                               "Switch this force"))
    {
        Field.Enabled = !Field.Enabled;
    }
    char Path[128];
    if (Descriptor.Contribution == ForceContribution::Flow && Context.Plan && Context.Plan->SharedFieldActive)
        std::snprintf(Path, sizeof(Path), "Particle-local flow is bypassed while the shared level ForceField is active.");
    else if (Descriptor.LatticeSlot >= 0) std::snprintf(Path, sizeof(Path), "Summed into the standalone wind lattice (component type %d).", Descriptor.LatticeSlot);
    else if (Descriptor.ForceSlot >= 0) std::snprintf(Path, sizeof(Path), "Packed for fieldAccel (type %d), evaluated per particle.", Descriptor.ForceSlot);
    else std::snprintf(Path, sizeof(Path), "Authored only: no GPU path yet, so particles do not feel it.");
    CaptionText::Construct(Page, Path);

    SectionRows::BeginSection(Page, "Strength", "Activity", nullptr, nullptr);
    const double Limit = Descriptor.Contribution == ForceContribution::Damp ? 10.0 : 30.0;
    SectionRows::Measure(Page, "ParticleForceStrength", "Strength", Field.Strength, -Limit, Limit, 0.05, Descriptor.Unit);
    if (Field.Category == ParticleFieldCategory::Attract) SectionRows::Measure(Page, "ParticleForceSwirl", "Swirl", Field.Swirl, -10.0, 10.0, 0.05, "m/s\xC2\xB2");
    if (Field.Category == ParticleFieldCategory::Attract) SectionRows::Measure(Page, "ParticleForceSwallow", "Swallow radius", Field.Swallow, 0.0, 3.0, 0.01, "m");
    if (Field.Category == ParticleFieldCategory::Gust) SectionRows::Measure(Page, "ParticleForceRate", "Pulse rate", Field.Rate, 0.0, 3.0, 0.01, "Hz");
    const bool Directional = Descriptor.Contribution == ForceContribution::Flow && Field.Category != ParticleFieldCategory::Tornado
                          && Field.Category != ParticleFieldCategory::Outflow;
    if (Directional)
    {
        double Compass = std::fmod(std::fmod(180.0 - ResolveParticleFieldBearing(Field), 360.0) + 360.0, 360.0);
        if (SectionRows::Bearing(Page, "ParticleForceBearing", "Bearing", Compass)) Field.Direction = ResolveParticleFieldAlong(180.0 - Compass);
    }
    SectionRows::EndSection(Page);

    SectionRows::BeginSection(Page, "Reach", "Target", nullptr, nullptr);
    int Reach = ResolveReachIndex(Field.Reach);
    if (ChoiceRow::Construct(Page, "ParticleForceReach", "Reach", ReachLabels, 3, Reach)) Field.Reach = ResolveReach(Reach);
    SectionRows::Measure(Page, "ParticleForceRadius", "Radius", Field.Radius, 0.1, 20.0, 0.05, "m", Field.Reach == ForceReach::Everywhere ? "Everywhere" : nullptr);
    ConstructChoice(Page, "ParticleForceFalloff", "Falloff", FalloffLabels, 4, Field.Falloff);
    ConstructTriple(Page, "ParticleForceCentre", "Centre", Field.Centre, -6.0f, 8.0f);
    SectionRows::EndSection(Page);

    SectionRows::BeginSection(Page, "Timing", "Timeline", nullptr, "0 s lasting means forever; 0 s repeating means once.");
    SectionRows::Measure(Page, "ParticleForceBegins", "Begins", Field.Begins, 0.0, 60.0, 0.1, "s");
    SectionRows::Measure(Page, "ParticleForceLasts", "Lasts", Field.Lasts, 0.0, 60.0, 0.1, "s");
    SectionRows::Measure(Page, "ParticleForceRepeats", "Repeats every", Field.Repeats, 0.0, 60.0, 0.1, "s");
    SectionRows::EndSection(Page);
    const ActionEntry Remove[1] = { { "ParticleRemoveForce", "Remove force" } };
    if (ActionRow::Construct(Page, std::span<const ActionEntry>(Remove, 1)) == 0) Context.Requests.push_back("remove-force:" + std::to_string(Index));
    FooterRow::Construct(Page, "eos force taxonomy", Descriptor.Identifier);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    LIGHTNING
//------------------------------------------------------------------------------------------------------------------------

void ParticleEditorPages::ConstructLightningPage(ControlColumn& Page, ParticleEditorContext& Context)
{
    ParticleLightning& Lightning = Context.Space.Lightning;
    if (PageHeading::Construct(Page, "ParticleLightningAuto", "ENVIRONMENT", "Lightning", Lightning.Automatic ? "\xE2\x97\x8F Automatic" : "\xE2\x97\x8B Manual",
                               "Midpoint-displacement bolts with branches; a strike bursts any Strike sparks effect at its ground point.",
                               "Automatic strikes"))
    {
        Lightning.Automatic = !Lightning.Automatic;
    }
    char Strikes[16], Last[48], Bolts[16];
    std::snprintf(Strikes, sizeof(Strikes), "%u", Lightning.Strikes);
    if (Lightning.LastStrike) std::snprintf(Last, sizeof(Last), "%.1f, %.1f", Lightning.LastStrike->At[0], Lightning.LastStrike->At[2]);
    else std::snprintf(Last, sizeof(Last), "\xE2\x80\x94");
    std::snprintf(Bolts, sizeof(Bolts), "%zu", Lightning.Bolts.size());
    const MetricTile Tiles[3] = { { "Strikes", Strikes, "so far" }, { "Last strike", Last, "x, z m" }, { "Bolts", Bolts, "alive" } };
    MetricTiles::Construct(Page, Tiles, 3, MetricTiles::NoLead);
    SectionRows::BeginSection(Page, "Strikes", "Zap", Lightning.Automatic ? "automatic" : "manual", nullptr);
    SectionRows::Switch(Page, "ParticleLightningAutomatic", "Automatic strikes", Lightning.Automatic);
    SectionRows::Measure(Page, "ParticleLightningMinimum", "Interval from", Lightning.IntervalMinimum, 0.5, 30.0, 0.1, "s");
    SectionRows::Measure(Page, "ParticleLightningMaximum", "Interval to", Lightning.IntervalMaximum, 0.5, 60.0, 0.1, "s");
    SectionRows::Measure(Page, "ParticleLightningAmplitude", "Jaggedness", Lightning.Amplitude, 0.2, 6.0, 0.05, "m");
    int Levels = Lightning.Levels;
    if (SectionRows::Count(Page, "ParticleLightningLevels", "Subdivisions", Levels, 2, 8, "levels")) Lightning.Levels = Levels;
    SectionRows::Measure(Page, "ParticleLightningBranches", "Branch chance", Lightning.BranchChance, 0.0, 1.0, 0.01, "");
    SectionRows::EndSection(Page);
    SectionRows::BeginSection(Page, "Web", "Route", Context.Space.LightningWeb.Enabled ? "on" : "off", "Bolts between the visible effects' origins.");
    SectionRows::Switch(Page, "ParticleWebEnabled", "Lightning web", Context.Space.LightningWeb.Enabled);
    SectionRows::Measure(Page, "ParticleWebInterval", "Interval", Context.Space.LightningWeb.IntervalSeconds, 0.1, 5.0, 0.05, "s");
    int Links = static_cast<int>(Context.Space.LightningWeb.Links);
    if (SectionRows::Count(Page, "ParticleWebLinks", "Neighbours", Links, 1, 4, "links")) Context.Space.LightningWeb.Links = static_cast<uint32_t>(Links);
    SectionRows::EndSection(Page);
    const ActionEntry Strike[1] = { { "ParticleStrike", "Strike now (L)" } };
    if (ActionRow::Construct(Page, std::span<const ActionEntry>(Strike, 1)) == 0) Context.Requests.push_back("strike");
    FooterRow::Construct(Page, "eos lightning \xC2\xB7 seeded bolts", "Particle space");
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    EFFECT
//------------------------------------------------------------------------------------------------------------------------

void ParticleEditorPages::ConstructEffectPage(ControlColumn& Page, ParticleEditorContext& Context, ParticleEffectInstance& Effect)
{
    ParticleEffectParameters& P      = Effect.Parameters;
    const ParticlePreset*     Preset = Context.Library.ResolvePreset(Effect.PresetIdentifier);
    char                      Eyebrow[96];
    std::snprintf(Eyebrow, sizeof(Eyebrow), "%s \xC2\xB7 %s", Preset ? Preset->Group.c_str() : "Effect", ResolveParticleBehaviourLabel(P.Behaviour));
    if (PageHeading::Construct(Page, "ParticleEffectVisible", Eyebrow, Effect.Name.c_str(), P.Visible ? "\xE2\x97\x8F Visible" : "\xE2\x97\x8B Hidden",
                               Preset ? Preset->Blurb.c_str() : "", "Show or hide this effect"))
    {
        P.Visible = !P.Visible;
    }
    const ParticleEffectCensus* Census   = ResolveCensus(Context.Image, Effect.Token);
    const bool                  Fibre    = P.Behaviour == ParticleBehaviour::LightFibre;
    const uint32_t              Capacity = Fibre ? 0u : ResolveParticleCapacity(P);
    char Alive[32], CapacityText[32], Energy[32], Rate[32];
    std::snprintf(Alive, sizeof(Alive), "%u", Census ? Census->Alive : 0u);
    std::snprintf(CapacityText, sizeof(CapacityText), "of %u", Capacity);
    FormatFigure(Census ? Census->Energy : 0.0, Energy, sizeof(Energy));
    FormatFigure(P.ReleaseRate, Rate, sizeof(Rate));
    if (Fibre)
    {
        char Strands[32];
        std::snprintf(Strands, sizeof(Strands), "%d", P.LightFibre ? P.LightFibre->Strands : 0);
        const MetricTile Tiles[2] = { { "Strands", Strands, "analytic" }, { "Loop", P.LightFibre ? std::to_string(P.LightFibre->LoopSeconds) : "", "s" } };
        MetricTiles::Construct(Page, Tiles, 2, MetricTiles::NoLead);
    }
    else
    {
        const MetricTile Tiles[3] = { { "Alive", Alive, CapacityText }, { "Release", Rate, "per second" }, { "Energy", Energy, "\xCE\xA3|v|\xC2\xB2" } };
        MetricTiles::Construct(Page, Tiles, 3, MetricTiles::NoLead);
    }

    const bool  Molecular  = EvaluateParticleMolecular(P);
    const char* Special    = Molecular ? "Molecular" : P.Behaviour == ParticleBehaviour::Flocking ? "Swarm" : P.Transition ? "Transition" : Fibre ? "Fibre" : nullptr;
    const char* Labels[5]  = { "Release", "Motion", "Look", "Physics", Special ? Special : "" };
    const int   Count      = Special ? 5 : 4;
    ActiveEffectSection    = std::min(ActiveEffectSection, Count - 1);
    TabStrip::Construct(Page, "ParticleEffectSections", Labels, Count, ActiveEffectSection);
    const std::string Rebuild = "rebuild:" + Effect.Token;
    switch (ActiveEffectSection)
    {
    case 0:
    {
        SectionRows::BeginSection(Page, "Release", "Sparkles", nullptr, Fibre ? "Light fibres are analytic: nothing is released." : nullptr);
        SectionRows::Measure(Page, "ParticleRate", "Release rate", P.ReleaseRate, 0.0, 4000.0, 1.0, "/s");
        int Store = P.Capacity;
        if (SectionRows::Count(Page, "ParticleCapacity", "Capacity", Store, 64, 65536, "particles") && Store != P.Capacity)
        {
            P.Capacity = Store;
            Context.Requests.push_back(Rebuild);
        }
        ConstructChoice(Page, "ParticleReleaseShape", "Release shape", ReleaseLabels, 5, P.ReleaseShape);
        SectionRows::Measure(Page, "ParticleReleaseRadius", "Radius", P.RadiusMetres, 0.0, 6.0, 0.01, "m");
        ConstructTriple(Page, "ParticleOrigin", "Origin", P.OriginMetres, -6.0f, 8.0f);
        ConstructTriple(Page, "ParticleBox", "Box half extents", P.BoxHalfMetres, 0.0f, 6.0f);
        SectionRows::Measure(Page, "ParticleBurstEvery", "Burst every", P.BurstEverySeconds, 0.0, 10.0, 0.05, "s");
        ConstructInteger(Page, "ParticleBurstCount", "Burst size", P.BurstCount, 0, 4000, "particles");
        SectionRows::Switch(Page, "ParticleBurstOrigin", "Burst at the origin", P.BurstAtOrigin);
        SectionRows::EndSection(Page);
        break;
    }
    case 1:
    {
        SectionRows::BeginSection(Page, "Motion", "Move", nullptr, nullptr);
        ConstructTriple(Page, "ParticleDirection", "Direction", P.Direction, -1.0f, 1.0f);
        SectionRows::Measure(Page, "ParticleSpread", "Spread", P.SpreadRadians, 0.0, 3.1416, 0.01, "rad");
        SectionRows::Measure(Page, "ParticleSpeedMinimum", "Speed from", P.SpeedMinimum, 0.0, 40.0, 0.05, "m/s");
        SectionRows::Measure(Page, "ParticleSpeedMaximum", "Speed to", P.SpeedMaximum, 0.0, 40.0, 0.05, "m/s");
        SectionRows::Measure(Page, "ParticleDrag", "Drag", P.Drag, 0.0, 10.0, 0.01, "1/s");
        SectionRows::Measure(Page, "ParticleGravity", "Gravity", P.Gravity, -2.0, 4.0, 0.01, "g");
        SectionRows::Measure(Page, "ParticleLifeMinimum", "Life from", P.LifeMinimumSeconds, 0.05, 30.0, 0.05, "s");
        SectionRows::Measure(Page, "ParticleLifeMaximum", "Life to", P.LifeMaximumSeconds, 0.05, 30.0, 0.05, "s");
        SectionRows::EndSection(Page);
        break;
    }
    case 2:
    {
        SectionRows::BeginSection(Page, "Look", "Palette", nullptr, "Colours are linear; A at release, B at the end, C for products.");
        ConstructChoice(Page, "ParticleAppearance", "Appearance", AppearanceLabels, 7, P.Appearance);
        ConstructChoice(Page, "ParticleBlend", "Blend", BlendLabels, 2, P.Blend);
        SectionRows::Measure(Page, "ParticleSizeStart", "Size at release", P.SizeStartMetres, 0.0, 2.0, 0.005, "m");
        SectionRows::Measure(Page, "ParticleSizeEnd", "Size at the end", P.SizeEndMetres, 0.0, 2.0, 0.005, "m");
        SectionRows::Measure(Page, "ParticleSizeScale", "Size scale", P.SizeScale, 0.1, 4.0, 0.01, "\xC3\x97");
        ConstructColour(Page, "ParticleColourA", "Colour A", P.ColourA);
        ConstructColour(Page, "ParticleColourB", "Colour B", P.ColourB);
        ConstructColour(Page, "ParticleColourC", "Colour C", P.ColourC);
        SectionRows::EndSection(Page);
        break;
    }
    case 3:
    {
        SectionRows::BeginSection(Page, "Physics", "Atom", nullptr, "How the wind lattice and the fields move each particle.");
        SectionRows::Measure(Page, "ParticleCoupling", "Wind coupling", P.WindCoupling, 0.0, 10.0, 0.01, "1/s");
        SectionRows::Measure(Page, "ParticleBounce", "Bounce", P.Bounce, 0.0, 1.0, 0.01, "");
        SectionRows::Measure(Page, "ParticleBuoyancy", "Buoyancy", P.Buoyancy, -5.0, 10.0, 0.05, "m/s\xC2\xB2");
        SectionRows::Measure(Page, "ParticleFlutter", "Flutter", P.Flutter, 0.0, 5.0, 0.01, "m/s\xC2\xB2");
        SectionRows::Measure(Page, "ParticlePulseRate", "Pulse rate", P.PulseHz, 0.0, 5.0, 0.01, "Hz");
        SectionRows::Measure(Page, "ParticlePulseDepth", "Pulse depth", P.PulseDepth, 0.0, 1.0, 0.01, "");
        SectionRows::EndSection(Page);
        break;
    }
    default:
    {
        if (Molecular)
        {
            SectionRows::BeginSection(Page, "Molecular", "Atom", Census ? "live" : nullptr, "Lennard-Jones in a box with a Langevin thermostat.");
            SectionRows::Measure(Page, "ParticleTemperature", "Temperature", P.Temperature, 0.0, 3.0, 0.01, "");
            SectionRows::Measure(Page, "ParticleEpsilon", "Well depth \xCE\xB5", P.Epsilon, 0.0, 2.0, 0.01, "");
            SectionRows::Measure(Page, "ParticleSigma", "Size \xCF\x83", P.Sigma, 0.01, 0.4, 0.001, "m");
            SectionRows::Measure(Page, "ParticleDamping", "Damping \xCE\xB3", P.Damping, 0.0, 10.0, 0.05, "1/s");
            SectionRows::Measure(Page, "ParticleStep", "Integration step", P.IntegrationStepSeconds, 0.0005, 0.02, 0.0005, "s");
            if (P.Behaviour == ParticleBehaviour::Reactive)
            {
                SectionRows::Measure(Page, "ParticleReactRate", "Reaction rate", P.ReactRate, 0.0, 20.0, 0.1, "1/s");
                SectionRows::Measure(Page, "ParticleReactRadius", "Reaction radius", P.ReactRadius, 0.0, 0.5, 0.005, "m");
                SectionRows::Measure(Page, "ParticleDissociation", "Dissociation", P.Dissociation, 0.0, 5.0, 0.01, "1/s");
                SectionRows::Measure(Page, "ParticleFraction", "Share of A", P.FractionA, 0.0, 1.0, 0.01, "");
                if (Census)
                {
                    char A[16], B[16], C[16];
                    std::snprintf(A, sizeof(A), "%u", Census->SpeciesA);
                    std::snprintf(B, sizeof(B), "%u", Census->SpeciesB);
                    std::snprintf(C, sizeof(C), "%u", Census->SpeciesC);
                    const MetricTile Species[3] = { { "A", A, "species" }, { "B", B, "species" }, { "C = A + B", C, "products" } };
                    MetricTiles::Construct(Page, Species, 3, MetricTiles::NoLead);
                }
            }
            SectionRows::EndSection(Page);
        }
        else if (P.Behaviour == ParticleBehaviour::Flocking)
        {
            SectionRows::BeginSection(Page, "Swarm", "Swirl", nullptr, "Separation, alignment and cohesion within the swarm radius.");
            SectionRows::Measure(Page, "ParticleSwarmRadius", "Swarm radius", P.SwarmRadiusMetres, 0.1, 4.0, 0.01, "m");
            SectionRows::Measure(Page, "ParticleSwarmSpeed", "Speed limit", P.SpeedMaximum, 0.05, 10.0, 0.05, "m/s");
            SectionRows::EndSection(Page);
        }
        else if (P.Transition)
        {
            ParticleTransition& T = *P.Transition;
            SectionRows::BeginSection(Page, "Transition", "Boxes", nullptr, "Pieces hold on the object, then release in a wave.");
            SectionRows::Measure(Page, "ParticleHoldMinimum", "Hold at least", T.HoldMinimumSeconds, 0.0, 5.0, 0.01, "s");
            SectionRows::Measure(Page, "ParticleHoldSpread", "Hold spread", T.HoldSpreadSeconds, 0.0, 6.0, 0.01, "s");
            SectionRows::Measure(Page, "ParticleBurstShare", "Burst share", T.BurstShare, 0.0, 1.0, 0.01, "");
            ConstructChoice(Page, "ParticleWave", "Release wave", WaveLabels, 3, T.Wave);
            int Assemble = std::clamp(T.Assemble, 0, 2);
            if (ChoiceRow::Construct(Page, "ParticleAssemble", "Flight", AssembleLabels, 3, Assemble)) T.Assemble = Assemble;
            SectionRows::Measure(Page, "ParticleLaunch", "Launch distance", T.LaunchDistanceMetres, 0.0, 8.0, 0.05, "m");
            SectionRows::Switch(Page, "ParticleFragment", "Break into shards", T.Fragment);
            SectionRows::Switch(Page, "ParticleButterflies", "Fly off as butterflies", T.Butterflies);
            SectionRows::EndSection(Page);
        }
        else if (P.LightFibre)
        {
            LightFibreParameters& F = *P.LightFibre;
            SectionRows::BeginSection(Page, "Fibre", "Zap", nullptr, "Curves evaluated per vertex from the loop phase.");
            ConstructChoice(Page, "ParticleFibreShape", "Shape", FibreShapeLabels, 3, F.Shape);
            int Path = std::max(0, ResolveLightFibrePathIndex(F.PathShape));
            const char* Paths[LightFibrePathCount];
            for (uint32_t Index = 0; Index < LightFibrePathCount; ++Index) Paths[Index] = ResolveLightFibrePathName(Index);
            if (ChoiceRow::Construct(Page, "ParticleFibrePath", "Path", Paths, static_cast<int>(LightFibrePathCount), Path)) F.PathShape = ResolveLightFibrePathName(Path);
            ConstructInteger(Page, "ParticleFibreStrands", "Strands", F.Strands, 1, 2000, "");
            ConstructInteger(Page, "ParticleFibreSegments", "Segments", F.Segments, 4, 256, "");
            SectionRows::Measure(Page, "ParticleFibreLength", "Length", F.LengthMetres, 0.5, 30.0, 0.1, "m");
            SectionRows::Measure(Page, "ParticleFibreSpread", "Spread", F.SpreadMetres, 0.0, 6.0, 0.05, "m");
            SectionRows::Measure(Page, "ParticleFibreAmplitude", "Amplitude", F.AmplitudeMetres, 0.0, 8.0, 0.05, "m");
            SectionRows::Measure(Page, "ParticleFibreThickness", "Thickness", F.Thickness, 0.2, 8.0, 0.05, "px");
            SectionRows::Measure(Page, "ParticleFibreIntensity", "Intensity", F.Intensity, 0.0, 4.0, 0.01, "");
            SectionRows::Measure(Page, "ParticleFibreHalo", "Halo", F.Halo, 0.0, 1.0, 0.01, "");
            SectionRows::Measure(Page, "ParticleFibreLoop", "Loop", F.LoopSeconds, 1.0, 60.0, 0.5, "s");
            SectionRows::Measure(Page, "ParticleFibrePathSize", "Path size", F.PathSizeMetres, 0.5, 8.0, 0.05, "m");
            ConstructChoice(Page, "ParticleFibreColouring", "Colouring", ColouringLabels, 3, F.Colouring);
            ConstructChoice(Page, "ParticleFibrePulse", "Pulse", PulseLabels, 4, F.Pulse);
            SectionRows::Measure(Page, "ParticleFibrePulseDepth", "Pulse depth", F.PulseDepth, 0.0, 1.0, 0.01, "");
            SectionRows::Measure(Page, "ParticleFibreSparks", "Head sparks", F.Sparks, 0.0, 1.0, 0.01, "");
            SectionRows::EndSection(Page);
        }
        break;
    }
    }
    const ActionEntry Actions[3] = { { "ParticleDuplicate", "Duplicate" }, { "ParticleReset", "Clear particles" }, { "ParticleRemove", "Remove" } };
    switch (ActionRow::Construct(Page, std::span<const ActionEntry>(Actions, 3)))
    {
    case 0: Context.Requests.push_back("duplicate:" + Effect.Token); break;
    case 1: Context.Requests.push_back(Rebuild); break;
    case 2: Context.Requests.push_back("remove:" + Effect.Token); break;
    default: break;
    }
    FooterRow::Construct(Page, Preset ? Preset->Identifier.c_str() : "", "eos preset library");
}

} // namespace Frontier

#endif
