/*==========================================================================================================================================
                                                        PARTICLEWORKSPACEINSPECTOR.CPP
==========================================================================================================================================*/
// 🧩 The Particle Workspace inspector pages: the scene summary, the wind lattice, the per-force summary, and the effect
//    page (effect header, Overview / Source / Motion / Modules tabs). Value controls edit the shell-local
//    ParticleEffectParameters copies and log keyed EFFECT lines; commands that would reach the engines (copy, reset-all,
//    open-in-Force-Field) are explicit NOOPs. Fibre selections render these same shared tabs — there are no
//    fibre-exclusive authoring forms.

#include "Engine/Interface/Workspaces/ParticleWorkspace.h"

#include "Engine/Interface/Controls/ActionRow.h"
#include "Engine/Interface/Controls/CaptionText.h"
#include "Engine/Interface/Controls/ColourRow.h"
#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/EmitterInstrument.h"
#include "Engine/Interface/Controls/GlyphRun.h"
#include "Engine/Interface/Controls/GlyphSymbol.h"
#include "Engine/Interface/Controls/HeroCard.h"
#include "Engine/Interface/Controls/MetricTrio.h"
#include "Engine/Interface/Controls/PolarDial.h"
#include "Engine/Interface/Controls/SegmentedRow.h"
#include "Engine/Interface/Controls/SelectPill.h"
#include "Engine/Interface/Controls/SliderPill.h"
#include "Engine/Interface/Controls/SliderRow.h"
#include "Engine/Interface/Controls/StatGrid.h"
#include "Engine/Interface/Controls/SwitchPill.h"
#include "Engine/Interface/Controls/TextRow.h"
#include "Engine/Interface/Controls/TimeSeries.h"
#include "Engine/Interface/Controls/Toast.h"
#include "Engine/Interface/Controls/ToggleTile.h"
#include "Engine/Interface/InspectorControls.h"

#include <cmath>
#include <cstdio>

namespace Frontier
{

void LogParticleWorkspaceValue(ParticleWorkspaceState& State, const char* Channel, const char* Owner, const char* Label,
                               const char* Shown)
{
    char Message[256]{};
    char Key[160]{};
    std::snprintf(Message, sizeof(Message), "%s: %s → %s", Owner, Label, Shown);
    std::snprintf(Key, sizeof(Key), "%s: %s", Owner, Label);
    AppendParticleWorkspaceLog(State, Channel, Message, nullptr, Key);
}

void NoopParticleWorkspaceCommand(ParticleWorkspaceState& State, const char* Channel, const char* Message, const char* ToastText)
{
    Toast::Show(ToastText);
    NoopParticleWorkspaceAction(State, Channel, Message);
}

namespace
{

int ResolveBehaviourCode(ParticleBehaviour Behaviour) noexcept
{
    return static_cast<int>(Behaviour);
}

void LogSliderValue(ParticleWorkspaceState& State, const char* Owner, const char* Label, double Value, int Digits, const char* Unit)
{
    char Figure[48]{};
    FormatParticleTrimmed(Value, Digits, Figure, sizeof(Figure));
    char Shown[64]{};
    if (Unit != nullptr && Unit[0] != '\0') std::snprintf(Shown, sizeof(Shown), "%s %s", Figure, Unit);
    else std::snprintf(Shown, sizeof(Shown), "%s", Figure);
    LogParticleWorkspaceValue(State, "EFFECT", Owner, Label, Shown);
}

bool ConstructEffectSlider(ParticleWorkspaceState& State, ControlColumn& Column, const ParticleWorkspaceEffect& Effect, const char* Id,
                           const char* Label, double& Value, double Minimum, double Maximum, double Step, const char* Unit, int Digits,
                           bool Enabled = true, const char* Tooltip = nullptr)
{
    if (!SliderPill::Construct(Column, Id, Label, Value, Minimum, Maximum, Step, Unit, Enabled, Tooltip)) return false;
    LogSliderValue(State, Effect.Name.c_str(), Label, Value, Digits, Unit);
    return true;
}

bool ConstructForceSlider(ParticleWorkspaceState& State, ControlColumn& Column, const ParticleWorkspaceForce& Force, const char* Id,
                          const char* Label, double& Value, double Minimum, double Maximum, double Step, const char* Unit, int Digits)
{
    if (!SliderPill::Construct(Column, Id, Label, Value, Minimum, Maximum, Step, Unit, Force.Enabled)) return false;
    char Figure[48]{};
    FormatParticleTrimmed(Value, Digits, Figure, sizeof(Figure));
    char Shown[64]{};
    std::snprintf(Shown, sizeof(Shown), "%s %s", Figure, Unit);
    LogParticleWorkspaceValue(State, "WIND", Force.Name.c_str(), Label, Shown);
    return true;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    EFFECT HEADER
//------------------------------------------------------------------------------------------------------------------------

void ConstructEffectHeader(ParticleWorkspaceState& State, ControlColumn& Column, ParticleWorkspaceEffect& Effect)
{
    const ParticleWorkspacePreset& Preset    = QueryParticlePreset(Effect.Preset);
    const EditorTypefaces&         Faces     = Column.QueryFaces();
    ImDrawList* const              DrawList  = Column.QueryDrawList();
    const float                    S         = Column.QueryScale();
    const float                    Width     = Column.QueryWidth();
    const float                    Fade      = Effect.Enabled ? 1.0f : 0.42f;
    const ImU32                    Accent    = ResolveCssColour(Preset.Colour);

    const ImVec2 Top = Column.Space(46.0f, 0.0f, 4.0f);
    DrawList->AddRectFilled(Top, ImVec2(Top.x + Width, Top.y + 46.0f * S), FadeColour(ResolveCssColour(0x1A1A1AFF), Fade), 14.0f * S);
    DrawList->AddRect(Top, ImVec2(Top.x + Width, Top.y + 46.0f * S), FadeColour(ResolveCssColour(0xFFFFFF14), Fade), 14.0f * S,
                      ImDrawFlags_None, S);
    const ImVec2 ChipMin(Top.x + 10.0f * S, Top.y + 10.0f * S);
    DrawList->AddRectFilled(ChipMin, ImVec2(ChipMin.x + 26.0f * S, ChipMin.y + 26.0f * S), FadeColour(ResolveAlpha(Accent, 0.16f), Fade),
                            8.0f * S);
    if (Preset.Glyph != nullptr)
    {
        (void)GlyphSymbol::Construct(DrawList, Preset.Glyph, ImVec2(ChipMin.x + 6.5f * S, ChipMin.y + 6.5f * S), 13.0f * S, 1.8f * S,
                                     FadeColour(Accent, Fade));
    }
    (void)GlyphRun::Construct(Column, Faces.Light, 15.0f * S,
                              ImVec2(ChipMin.x + 35.0f * S, GlyphRun::ResolveBaseline(Top.y + 7.0f * S, 15.0f * S, 1.2f)),
                              FadeColour(ResolveCssColour(0xF1F1F1FF), Fade), Effect.Name.c_str(), -0.25f * S);
    char Meta[128]{};
    std::snprintf(Meta, sizeof(Meta), "%s · %s · %s", QueryParticleBehaviourName(ResolveBehaviourCode(Effect.Parameters.Behaviour)),
                  QueryParticleAppearanceName(static_cast<int>(Effect.Parameters.Appearance)), Preset.Name);
    (void)GlyphRun::Construct(Column, Faces.Regular, 10.5f * S,
                              ImVec2(ChipMin.x + 35.0f * S, GlyphRun::ResolveBaseline(Top.y + 26.0f * S, 10.5f * S, 1.4f)),
                              FadeColour(ResolveCssColour(0x848484FF), Fade), Meta);

    char NameBefore[128]{};
    std::snprintf(NameBefore, sizeof(NameBefore), "%s", Effect.Name.c_str());
    if (TextRow::Construct(Column, "EffectName", "Display name", Effect.Name, Effect.Enabled))
    {
        LogParticleWorkspaceValue(State, "EFFECT", NameBefore, "Display name", Effect.Name.c_str());
    }
    if (SwitchPill::Construct(Column, "EffectVisible", "Visible", "Enabled in the lab scene", Effect.Enabled, SwitchTone::Mono))
    {
        LogParticleWorkspaceValue(State, "EFFECT", Effect.Name.c_str(), "Visible", Effect.Enabled ? "on" : "off");
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    OVERVIEW TAB
//------------------------------------------------------------------------------------------------------------------------

void ConstructOverviewTab(ParticleWorkspaceState& State, ControlColumn& Column, ParticleWorkspaceEffect& Effect)
{
    const ParticleWorkspacePreset& Preset = QueryParticlePreset(Effect.Preset);
    char Capacity[32]{};
    std::snprintf(Capacity, sizeof(Capacity), "%d", Effect.Parameters.Capacity);
    char Side[48]{};
    std::snprintf(Side, sizeof(Side), "of %d capacity", Effect.Parameters.Capacity);
    const TimeSeriesOptions Series = TimeSeriesOptions::Particle();

    HeroCardInner Inner = HeroCard::BeginTitled(Column, "Alive", Preset.Group, Effect.Name.c_str(),
                                                QueryParticleBehaviourName(ResolveBehaviourCode(Effect.Parameters.Behaviour)),
                                                Preset.Glyph, Effect.Enabled ? HeroCard::MarkLive : HeroCard::MarkNone, "0", "alive", Side,
                                                Effect.Enabled);
    TimeSeries::Construct(Column, State.AliveSamples, State.AliveCount, 40, 0.0, 96.0f, Series, Effect.Enabled);
    HeroCard::End(Column, Inner, "The engine is off in this shell: alive, rate, and CPU stay at honest zeros.", Effect.Enabled);
    (void)Capacity;

    const MetricTrioItem Trio[3] = { { "Alive", "0", 1 }, { "Rate", "0 /s", 0 }, { "CPU", "0.0 ms", 0 } };
    MetricTrio::Construct(Column, Trio, Effect.Enabled);

    char BehaviourValue[32]{};
    std::snprintf(BehaviourValue, sizeof(BehaviourValue), "%s", QueryParticleBehaviourName(ResolveBehaviourCode(Effect.Parameters.Behaviour)));
    char AppearanceValue[32]{};
    std::snprintf(AppearanceValue, sizeof(AppearanceValue), "%s",
                  QueryParticleAppearanceName(static_cast<int>(Effect.Parameters.Appearance)));
    char ReleaseValue[32]{};
    std::snprintf(ReleaseValue, sizeof(ReleaseValue), "%s", QueryParticleReleaseName(static_cast<int>(Effect.Parameters.ReleaseShape)));
    const StatGridCell Facts[4] = { { "Behaviour", BehaviourValue },
                                    { "Appearance", AppearanceValue },
                                    { "Release", ReleaseValue },
                                    { "Blend", Effect.Parameters.Blend == ParticleBlend::Additive ? "Additive" : "Alpha over" } };
    StatGrid::Construct(Column, Facts, 4, Effect.Enabled);

    const ActionItem Actions[3] = { { "Reset effect", "StudioReset", ActionTone::Accent },
                                    { "Copy settings", "StudioCopy", ActionTone::Default },
                                    { "Remove", "StudioTrash", ActionTone::Danger } };
    ImVec4 ActionRects[3]{};
    const int Fired = ActionRow::Construct(Column, "EffectActions", Actions, 3, Effect.Enabled, nullptr, ActionRowVoice::Warm, ActionRects);
    for (int Index = 0; Index < 3; ++Index)
    {
        char RectName[48]{};
        std::snprintf(RectName, sizeof(RectName), "Inspector/Effect/Action%d", Index);
        RecordParticleWorkspaceRect(State, RectName, ImVec2(ActionRects[Index].x, ActionRects[Index].y),
                                    ImVec2(ActionRects[Index].z, ActionRects[Index].w));
    }
    if (Fired == 0)
    {
        ResetParticleWorkspaceEffect(Effect);
        RebuildParticleWorkspaceExport(State);
        char Message[160]{};
        std::snprintf(Message, sizeof(Message), "%s reset to its preset", Effect.Name.c_str());
        AppendParticleWorkspaceLog(State, "EFFECT", Message, "local");
        Toast::Show("Effect reset to its preset (local)");
    }
    else if (Fired == 1)
    {
        NoopParticleWorkspaceCommand(State, "EFFECT", "Copy settings refused", "Copy is a NOOP in this shell");
    }
    else if (Fired == 2)
    {
        NoopParticleWorkspaceCommand(State, "EFFECT", "Remove effect refused", "Removing effects is a NOOP in this shell");
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    SOURCE TAB
//------------------------------------------------------------------------------------------------------------------------

void ConstructSourceTab(ParticleWorkspaceState& State, ControlColumn& Column, ParticleWorkspaceEffect& Effect)
{
    ParticleEffectParameters& P       = Effect.Parameters;
    const bool                Enabled = Effect.Enabled;
    static const int          KindCodes[7] = { 0, 1, 3, 4, 5, 6, 7 };
    static const char*        KindNames[7] = { "Ballistic", "Wind-driven", "Lennard-Jones", "Reactive", "Visual effect", "Flocking",
                                               "Light fibre" };
    int KindIndex = 0;
    for (int Index = 0; Index < 7; ++Index)
    {
        if (KindCodes[Index] == ResolveBehaviourCode(P.Behaviour)) KindIndex = Index;
    }
    if (SelectPill::Construct(Column, "Kind", "Behaviour", KindNames, 7, KindIndex, Enabled))
    {
        P.Behaviour = static_cast<ParticleBehaviour>(KindCodes[KindIndex]);
        LogParticleWorkspaceValue(State, "EFFECT", Effect.Name.c_str(), "Behaviour", KindNames[KindIndex]);
    }
    static const char* ShapeNames[7] = { "Streak", "Sphere", "Leaf", "Soft glow", "Cube", "Coin", "Bubble" };
    int                ShapeIndex    = static_cast<int>(P.Appearance);
    if (SelectPill::Construct(Column, "Appearance", "Appearance", ShapeNames, 7, ShapeIndex, Enabled))
    {
        P.Appearance = static_cast<ParticleAppearance>(ShapeIndex);
        LogParticleWorkspaceValue(State, "EFFECT", Effect.Name.c_str(), "Appearance", ShapeNames[ShapeIndex]);
    }

    int Shape = static_cast<int>(P.ReleaseShape);
    if (EmitterInstrument::Construct(Column, "Emitter", Shape, P.OriginMetres.data(), P.RadiusMetres, P.BoxHalfMetres.data(), Enabled))
    {
        P.ReleaseShape = static_cast<ParticleReleaseShape>(Shape);
        LogParticleWorkspaceValue(State, "EFFECT", Effect.Name.c_str(), "Emitter", "staged");
    }

    uint32_t Capacity = P.Capacity > 0 ? static_cast<uint32_t>(P.Capacity) : 0u;
    if (SliderRow::ConstructInteger(Column, "Capacity", "Capacity", Capacity, 0u, 16000u, "", Enabled))
    {
        P.Capacity = static_cast<int32_t>(Capacity);
        char Figure[32]{};
        std::snprintf(Figure, sizeof(Figure), "%d", P.Capacity);
        LogParticleWorkspaceValue(State, "EFFECT", Effect.Name.c_str(), "Capacity", Figure);
    }

    ConstructEffectSlider(State, Column, Effect, "Rate", "Release rate", P.ReleaseRate, 0.0, 2000.0, 5.0, "/s", 0, Enabled);
    ConstructEffectSlider(State, Column, Effect, "LifeMin", "Life min", P.LifeMinimumSeconds, 0.1, 30.0, 0.1, "s", 1, Enabled);
    ConstructEffectSlider(State, Column, Effect, "LifeMax", "Life max", P.LifeMaximumSeconds, 0.1, 30.0, 0.1, "s", 1, Enabled);
    ConstructEffectSlider(State, Column, Effect, "SizeStart", "Size start", P.SizeStartMetres, 0.0, 1.0, 0.005, "m", 3, Enabled);
    ConstructEffectSlider(State, Column, Effect, "SizeEnd", "Size end", P.SizeEndMetres, 0.0, 1.0, 0.005, "m", 3, Enabled);
    ConstructEffectSlider(State, Column, Effect, "SizeScale", "Size scale", P.SizeScale, 0.0, 4.0, 0.05, "×", 2, Enabled);

    static const char* Blends[2] = { "Additive", "Alpha over" };
    int                BlendIndex = P.Blend == ParticleBlend::Additive ? 0 : 1;
    if (SegmentedRow::Construct(Column, "Blend", "Blend", Blends, 2, BlendIndex, Enabled))
    {
        P.Blend = BlendIndex == 0 ? ParticleBlend::Additive : ParticleBlend::AlphaOver;
        LogParticleWorkspaceValue(State, "EFFECT", Effect.Name.c_str(), "Blend", Blends[BlendIndex]);
    }
    static const char* Surfaces[2] = { "Leaf", "Paper" };
    int                SurfaceIndex = P.LeafSurface == ParticleLeafSurface::Leaf ? 0 : 1;
    const bool         SurfaceLive  = static_cast<int>(P.Appearance) == 2;
    if (SegmentedRow::Construct(Column, "LeafSurface", "Leaf surface", Surfaces, 2, SurfaceIndex, Enabled && SurfaceLive,
                                SurfaceLive ? nullptr : "Leaf appearance only"))
    {
        P.LeafSurface = SurfaceIndex == 0 ? ParticleLeafSurface::Leaf : ParticleLeafSurface::Paper;
        LogParticleWorkspaceValue(State, "EFFECT", Effect.Name.c_str(), "Leaf surface", Surfaces[SurfaceIndex]);
    }

    ColourRowSwatch Swatches[3] = { { "A", { P.ColourA[0], P.ColourA[1], P.ColourA[2], P.ColourA[3] } },
                                    { "B", { P.ColourB[0], P.ColourB[1], P.ColourB[2], P.ColourB[3] } },
                                    { "C", { P.ColourC[0], P.ColourC[1], P.ColourC[2], P.ColourC[3] } } };
    const int Swatch = ColourRow::Construct(Column, "Ramp", "Colour ramp", Swatches, 3, Enabled, "Click a swatch to toggle its alpha");
    if (Swatch >= 0 && Swatch < 3)
    {
        if (Swatch == 0) P.ColourA[3] = Swatches[0].Colour[3];
        else if (Swatch == 1) P.ColourB[3] = Swatches[1].Colour[3];
        else P.ColourC[3] = Swatches[2].Colour[3];
        const char* Names[3] = { "Colour A", "Colour B", "Colour C" };
        char Label[32]{};
        std::snprintf(Label, sizeof(Label), "%s alpha", Names[Swatch]);
        LogParticleWorkspaceValue(State, "EFFECT", Effect.Name.c_str(), Label, Swatches[Swatch].Colour[3] >= 0.5 ? "1" : "0");
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    MOTION TAB
//------------------------------------------------------------------------------------------------------------------------

void ConstructMotionTab(ParticleWorkspaceState& State, ControlColumn& Column, ParticleWorkspaceEffect& Effect)
{
    ParticleEffectParameters& P       = Effect.Parameters;
    const bool                Enabled = Effect.Enabled;

    double Bearing = std::atan2(P.Direction[0], P.Direction[2]) * 180.0 / 3.14159265358979;
    if (Bearing < 0.0) Bearing += 360.0;
    if (PolarDial::ConstructPanel(Column, "BirthDirection", "Birth direction", "0° = north (+Z); writes XZ, keeps height.", Bearing,
                                  "COMPASS", Enabled))
    {
        const double Angle = Bearing * 3.14159265358979 / 180.0;
        const double Up    = P.Direction[1] < -1.0 ? -1.0 : (P.Direction[1] > 1.0 ? 1.0 : P.Direction[1]);
        const double Flat  = std::sqrt(std::max(0.0, 1.0 - Up * Up));
        P.Direction[0]     = std::sin(Angle) * Flat;
        P.Direction[2]     = std::cos(Angle) * Flat;
        char Shown[32]{};
        std::snprintf(Shown, sizeof(Shown), "%.0f°", Bearing);
        LogParticleWorkspaceValue(State, "EFFECT", Effect.Name.c_str(), "Birth direction", Shown);
    }

    ConstructEffectSlider(State, Column, Effect, "Spread", "Spread", P.SpreadRadians, 0.0, 3.14, 0.05, "rad", 2, Enabled);
    ConstructEffectSlider(State, Column, Effect, "SpeedMin", "Speed min", P.SpeedMinimum, 0.0, 30.0, 0.1, "m/s", 1, Enabled);
    ConstructEffectSlider(State, Column, Effect, "SpeedMax", "Speed max", P.SpeedMaximum, 0.0, 30.0, 0.1, "m/s", 1, Enabled);
    ConstructEffectSlider(State, Column, Effect, "Drag", "Drag", P.Drag, 0.0, 8.0, 0.05, "/s", 2, Enabled);
    ConstructEffectSlider(State, Column, Effect, "Gravity", "Gravity", P.Gravity, 0.0, 4.0, 0.05, "×g", 2, Enabled);
    ConstructEffectSlider(State, Column, Effect, "Buoyancy", "Buoyancy", P.Buoyancy, 0.0, 8.0, 0.1, "m/s²", 1, Enabled);
    ConstructEffectSlider(State, Column, Effect, "Bounce", "Bounce", P.Bounce, 0.0, 1.0, 0.05, "", 2, Enabled);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    MODULES TAB
//------------------------------------------------------------------------------------------------------------------------

void ConstructModulesTab(ParticleWorkspaceState& State, ControlColumn& Column, ParticleWorkspaceEffect& Effect)
{
    ParticleEffectParameters& P         = Effect.Parameters;
    const bool                Enabled   = Effect.Enabled;
    const int                 Behaviour = ResolveBehaviourCode(P.Behaviour);
    const bool                IsFibre   = Behaviour == 7;
    const bool                IsMolecular = Behaviour == 3 || Behaviour == 4;
    const bool                IsReactive  = Behaviour == 4;
    const bool                IsFlocking  = Behaviour == 6;

    const bool Before[6] = { Effect.ModuleWind, Effect.ModuleBurst, Effect.ModuleMolecular,
                             Effect.ModuleChemistry, Effect.ModuleFlock, Effect.ModuleFibre };
    ToggleTileItem Tiles[6] = {
        { "Wind", "StudioWind", &Effect.ModuleWind, !IsFibre, "Fibres ignore wind" },
        { "Bursts", "StudioBlast", &Effect.ModuleBurst, !IsFibre, "Fibres carry no bursts" },
        { "Molecular", "StudioAtom", &Effect.ModuleMolecular, IsMolecular, "Lennard-Jones and Reactive only" },
        { "Chemistry", "StudioThermal", &Effect.ModuleChemistry, IsReactive, "Reactive behaviour only" },
        { "Flock", "StudioSwirl", &Effect.ModuleFlock, IsFlocking, "Flocking behaviour only" },
        { "Fibre", "StudioRays", &Effect.ModuleFibre, IsFibre, "Light-fibre behaviour only" },
    };
    (void)ToggleTile::ConstructGrid(Column, "Modules", Tiles, 6, 3, Enabled);
    static const char* TileNames[6] = { "Module Wind", "Module Bursts", "Module Molecular", "Module Chemistry", "Module Flock",
                                        "Module Fibre" };
    const bool* After[6] = { &Effect.ModuleWind, &Effect.ModuleBurst, &Effect.ModuleMolecular,
                             &Effect.ModuleChemistry, &Effect.ModuleFlock, &Effect.ModuleFibre };
    for (int Index = 0; Index < 6; ++Index)
    {
        if (Before[Index] != *After[Index])
        {
            LogParticleWorkspaceValue(State, "EFFECT", Effect.Name.c_str(), TileNames[Index], *After[Index] ? "on" : "off");
        }
    }

    const bool WindLive = Enabled && Effect.ModuleWind && !IsFibre;
    ConstructEffectSlider(State, Column, Effect, "WindCoupling", "Wind coupling", P.WindCoupling, 0.0, 8.0, 0.1, "/s", 1, WindLive,
                          WindLive ? nullptr : "Enable the Wind module");
    ConstructEffectSlider(State, Column, Effect, "Flutter", "Flutter", P.Flutter, 0.0, 4.0, 0.1, "", 1, WindLive,
                          WindLive ? nullptr : "Enable the Wind module");

    const bool BurstLive = Enabled && Effect.ModuleBurst && !IsFibre;
    ConstructEffectSlider(State, Column, Effect, "BurstEvery", "Burst every", P.BurstEverySeconds, 0.0, 30.0, 0.5, "s", 1, BurstLive,
                          BurstLive ? nullptr : "Enable the Bursts module");
    {
        uint32_t Count = P.BurstCount > 0 ? static_cast<uint32_t>(P.BurstCount) : 0u;
        if (SliderRow::ConstructInteger(Column, "BurstCount", "Burst count", Count, 0u, 4000u, "", BurstLive))
        {
            P.BurstCount = static_cast<int32_t>(Count);
            char Figure[32]{};
            std::snprintf(Figure, sizeof(Figure), "%d", P.BurstCount);
            LogParticleWorkspaceValue(State, "EFFECT", Effect.Name.c_str(), "Burst count", Figure);
        }
    }
    if (SwitchPill::Construct(Column, "BurstAtOrigin", "Bursts at origin", "Fire from the emitter origin", P.BurstAtOrigin,
                              SwitchTone::Mono, BurstLive))
    {
        LogParticleWorkspaceValue(State, "EFFECT", Effect.Name.c_str(), "Bursts at origin", P.BurstAtOrigin ? "on" : "off");
    }

    const bool MolecularLive = Enabled && Effect.ModuleMolecular && IsMolecular;
    ConstructEffectSlider(State, Column, Effect, "Temperature", "Temperature", P.Temperature, 0.0, 3.0, 0.05, "kT", 2, MolecularLive,
                          MolecularLive ? nullptr : "Lennard-Jones and Reactive only");
    ConstructEffectSlider(State, Column, Effect, "Epsilon", "Epsilon", P.Epsilon, 0.0, 1.0, 0.01, "", 2, MolecularLive,
                          MolecularLive ? nullptr : "Lennard-Jones and Reactive only");
    ConstructEffectSlider(State, Column, Effect, "Sigma", "Sigma", P.Sigma, 0.0, 0.5, 0.005, "m", 3, MolecularLive,
                          MolecularLive ? nullptr : "Lennard-Jones and Reactive only");
    ConstructEffectSlider(State, Column, Effect, "Damping", "Damping", P.Damping, 0.0, 8.0, 0.1, "/s", 1, MolecularLive,
                          MolecularLive ? nullptr : "Lennard-Jones and Reactive only");
    ConstructEffectSlider(State, Column, Effect, "SimDt", "Integration step", P.IntegrationStepSeconds, 0.001, 0.02, 0.001, "s", 3,
                          MolecularLive, MolecularLive ? nullptr : "Lennard-Jones and Reactive only");

    const bool ChemistryLive = Enabled && Effect.ModuleChemistry && IsReactive;
    ConstructEffectSlider(State, Column, Effect, "ReactRate", "Reaction rate", P.ReactRate, 0.0, 20.0, 0.5, "/s", 1, ChemistryLive,
                          ChemistryLive ? nullptr : "Reactive behaviour only");
    ConstructEffectSlider(State, Column, Effect, "Dissociation", "Dissociation", P.Dissociation, 0.0, 5.0, 0.1, "/s", 1, ChemistryLive,
                          ChemistryLive ? nullptr : "Reactive behaviour only");
    ConstructEffectSlider(State, Column, Effect, "ReactRadius", "Reaction radius", P.ReactRadius, 0.0, 0.5, 0.01, "m", 2, ChemistryLive,
                          ChemistryLive ? nullptr : "Reactive behaviour only");
    ConstructEffectSlider(State, Column, Effect, "FractionA", "Fraction A", P.FractionA, 0.0, 1.0, 0.05, "", 2, ChemistryLive,
                          ChemistryLive ? nullptr : "Reactive behaviour only");

    const bool FlockLive = Enabled && Effect.ModuleFlock && IsFlocking;
    ConstructEffectSlider(State, Column, Effect, "PulseHz", "Pulse rate", P.PulseHz, 0.0, 8.0, 0.1, "Hz", 1, FlockLive,
                          FlockLive ? nullptr : "Flocking behaviour only");
    ConstructEffectSlider(State, Column, Effect, "PulseDepth", "Pulse depth", P.PulseDepth, 0.0, 1.0, 0.05, "", 2, FlockLive,
                          FlockLive ? nullptr : "Flocking behaviour only");
    ConstructEffectSlider(State, Column, Effect, "SwarmRadius", "Swarm radius", P.SwarmRadiusMetres, 0.0, 5.0, 0.1, "m", 1, FlockLive,
                          FlockLive ? nullptr : "Flocking behaviour only");

    if (IsFibre)
    {
        CaptionText::Construct(Column, "Fibre curve settings stay with the preset in this shell — there are no fibre-exclusive forms.");
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    EFFECT / SCENE / WIND / FORCE PAGES
//------------------------------------------------------------------------------------------------------------------------

void ConstructEffectPage(ParticleWorkspaceState& State, ControlColumn& Column, ParticleWorkspaceEffect& Effect)
{
    ConstructEffectHeader(State, Column, Effect);
    static const char* Tabs[4] = { "Overview", "Source", "Motion", "Modules" };
    ImVec4             TabRects[4]{};
    (void)SelectPill::ConstructTabs(Column, "EffectTabs", Tabs, 4, Effect.InspectorTab, true, nullptr, TabRects);
    for (int Index = 0; Index < 4; ++Index)
    {
        char RectName[48]{};
        std::snprintf(RectName, sizeof(RectName), "Inspector/Tab%d", Index);
        RecordParticleWorkspaceRect(State, RectName, ImVec2(TabRects[Index].x, TabRects[Index].y),
                                    ImVec2(TabRects[Index].z, TabRects[Index].w));
    }
    if (Effect.InspectorTab == ParticleWorkspaceState::TabSource) ConstructSourceTab(State, Column, Effect);
    else if (Effect.InspectorTab == ParticleWorkspaceState::TabMotion) ConstructMotionTab(State, Column, Effect);
    else if (Effect.InspectorTab == ParticleWorkspaceState::TabModules) ConstructModulesTab(State, Column, Effect);
    else ConstructOverviewTab(State, Column, Effect);
}

void ConstructScenePage(ParticleWorkspaceState& State, ControlColumn& Column)
{
    int CapacitySum = 0;
    for (const ParticleWorkspaceEffect& Effect : State.Effects) CapacitySum += Effect.Parameters.Capacity;
    char Metric[32]{};
    std::snprintf(Metric, sizeof(Metric), "%d", CapacitySum);
    char Chip[48]{};
    std::snprintf(Chip, sizeof(Chip), "%d effects · %d forces", static_cast<int>(State.Effects.size()),
                  static_cast<int>(State.Forces.size()));

    HeroCardInner Inner =
        HeroCard::BeginTitled(Column, "Scene", "LAB SCENE", "Particle Scene", Chip, "StudioLayers", HeroCard::MarkLive, Metric,
                              "capacity", "static shell");
    HeroCard::End(Column, Inner, "Scene tabs, transport, strike, and burst are NOOPs in this shell.");

    char EffectCount[16]{};
    std::snprintf(EffectCount, sizeof(EffectCount), "%d", static_cast<int>(State.Effects.size()));
    char ForceCount[16]{};
    std::snprintf(ForceCount, sizeof(ForceCount), "%d", static_cast<int>(State.Forces.size()));
    char PresetCount[16]{};
    std::snprintf(PresetCount, sizeof(PresetCount), "%d", QueryParticlePresetCount());
    const MetricTrioItem Trio[3] = { { "Effects", EffectCount, 2 }, { "Forces", ForceCount, 0 }, { "Presets", PresetCount, 0 } };
    MetricTrio::Construct(Column, Trio);

    const ActionItem Actions[3] = { { "Open library", "StudioLibrary", ActionTone::Default },
                                    { "Export TOML", "StudioDownload", ActionTone::Accent },
                                    { "Reset all", "StudioReset", ActionTone::Default } };
    ImVec4    ActionRects[3]{};
    const int Fired = ActionRow::Construct(Column, "SceneActions", Actions, 3, true, nullptr, ActionRowVoice::Warm, ActionRects);
    for (int Index = 0; Index < 3; ++Index)
    {
        char RectName[48]{};
        std::snprintf(RectName, sizeof(RectName), "Inspector/Scene/Action%d", Index);
        RecordParticleWorkspaceRect(State, RectName, ImVec2(ActionRects[Index].x, ActionRects[Index].y),
                                    ImVec2(ActionRects[Index].z, ActionRects[Index].w));
    }
    if (Fired == 0) State.LibraryOpen = true;
    else if (Fired == 1)
    {
        RebuildParticleWorkspaceExport(State);
        State.ExportOpen = true;
    }
    else if (Fired == 2)
    {
        NoopParticleWorkspaceCommand(State, "SCENE", "Reset all refused", "Reset-all is a NOOP in this shell");
    }
}

void ConstructWindPage(ParticleWorkspaceState& State, ControlColumn& Column)
{
    int Awake = 0;
    for (const ParticleWorkspaceForce& Force : State.Forces)
    {
        if (Force.Enabled) ++Awake;
    }
    char Chip[32]{};
    std::snprintf(Chip, sizeof(Chip), "%d of %d awake", Awake, static_cast<int>(State.Forces.size()));
    char Metric[32]{};
    FormatParticleTrimmed(!State.Forces.empty() ? State.Forces[0].Strength : 0.0, 1, Metric, sizeof(Metric));

    HeroCardInner Inner = HeroCard::BeginTitled(Column, "Wind", "WIND LATTICE", "Ambient Wind", Chip, "StudioWind",
                                                Awake > 0 ? HeroCard::MarkLive : HeroCard::MarkNone, Metric, "m/s", "prevailing");
    HeroCard::End(Column, Inner, "Force fields author in the Force Field workspace; this shell stages strength locally.");

    for (size_t Index = 0; Index < State.Forces.size(); ++Index)
    {
        ParticleWorkspaceForce& Force = State.Forces[Index];
        ImGui::PushID(static_cast<int>(Index));
        char Detail[96]{};
        char Span[32]{};
        FormatParticleSpan(Force.Radius, Span, sizeof(Span));
        std::snprintf(Detail, sizeof(Detail), "%s · R %s", QueryParticleForceName(Force.Category), Span);
        if (SwitchPill::Construct(Column, "ForceAwake", Force.Name.c_str(), Detail, Force.Enabled, SwitchTone::Verdant))
        {
            LogParticleWorkspaceValue(State, "WIND", Force.Name.c_str(), "Awake", Force.Enabled ? "on" : "off");
        }
        ConstructForceSlider(State, Column, Force, "ForceStrength", "Strength", Force.Strength, -10.0, 12.0, 0.1, "m/s", 1);
        ImGui::PopID();
    }

    const ActionItem Actions[1] = { { "Open in Force Field", "StudioFront", ActionTone::Default } };
    ImVec4 ActionRects[1]{};
    if (ActionRow::Construct(Column, "WindActions", Actions, 1, true, nullptr, ActionRowVoice::Warm, ActionRects) == 0)
    {
        NoopParticleWorkspaceCommand(State, "WIND", "Open in Force Field refused", "Suite jumps are NOOPs in this shell");
    }
    RecordParticleWorkspaceRect(State, "Inspector/Wind/Action0", ImVec2(ActionRects[0].x, ActionRects[0].y),
                                ImVec2(ActionRects[0].z, ActionRects[0].w));
}

void ConstructForcePage(ParticleWorkspaceState& State, ControlColumn& Column, ParticleWorkspaceForce& Force)
{
    const EditorTypefaces& Faces    = Column.QueryFaces();
    ImDrawList* const      DrawList = Column.QueryDrawList();
    const float            S        = Column.QueryScale();
    const float            Width    = Column.QueryWidth();
    const float            Fade     = Force.Enabled ? 1.0f : 0.42f;

    const ImVec2 Top = Column.Space(46.0f, 0.0f, 4.0f);
    DrawList->AddRectFilled(Top, ImVec2(Top.x + Width, Top.y + 46.0f * S), FadeColour(ResolveCssColour(0x1A1A1AFF), Fade), 14.0f * S);
    DrawList->AddRect(Top, ImVec2(Top.x + Width, Top.y + 46.0f * S), FadeColour(ResolveCssColour(0xFFFFFF14), Fade), 14.0f * S,
                      ImDrawFlags_None, S);
    const ImVec2 ChipMin(Top.x + 10.0f * S, Top.y + 10.0f * S);
    DrawList->AddRectFilled(ChipMin, ImVec2(ChipMin.x + 26.0f * S, ChipMin.y + 26.0f * S),
                            FadeColour(ResolveCssColour(0x8FD3C429), Fade), 8.0f * S);
    (void)GlyphSymbol::Construct(DrawList, "StudioWind", ImVec2(ChipMin.x + 6.5f * S, ChipMin.y + 6.5f * S), 13.0f * S, 1.8f * S,
                                 FadeColour(ResolveCssColour(0x8FD3C4FF), Fade));
    (void)GlyphRun::Construct(Column, Faces.Light, 15.0f * S,
                              ImVec2(ChipMin.x + 35.0f * S, GlyphRun::ResolveBaseline(Top.y + 7.0f * S, 15.0f * S, 1.2f)),
                              FadeColour(ResolveCssColour(0xF1F1F1FF), Fade), Force.Name.c_str(), -0.25f * S);
    char Meta[96]{};
    std::snprintf(Meta, sizeof(Meta), "%s wind · DefaultForces", QueryParticleForceName(Force.Category));
    (void)GlyphRun::Construct(Column, Faces.Regular, 10.5f * S,
                              ImVec2(ChipMin.x + 35.0f * S, GlyphRun::ResolveBaseline(Top.y + 26.0f * S, 10.5f * S, 1.4f)),
                              FadeColour(ResolveCssColour(0x848484FF), Fade), Meta);

    if (SwitchPill::Construct(Column, "ForceEnabled", "Awake", "Blowing in the lab scene", Force.Enabled, SwitchTone::Verdant))
    {
        LogParticleWorkspaceValue(State, "WIND", Force.Name.c_str(), "Awake", Force.Enabled ? "on" : "off");
    }
    ConstructForceSlider(State, Column, Force, "Strength", "Strength", Force.Strength, -10.0, 12.0, 0.1, "m/s", 1);
    ConstructForceSlider(State, Column, Force, "Radius", "Radius", Force.Radius, 0.0, 12.0, 0.1, "m", 1);
    ConstructForceSlider(State, Column, Force, "Bearing", "Bearing", Force.Bearing, 0.0, 360.0, 1.0, "°", 0);
    ConstructForceSlider(State, Column, Force, "Rate", "Pulse rate", Force.Rate, 0.0, 4.0, 0.05, "Hz", 2);

    const ActionItem Actions[2] = { { "Open in Force Field", "StudioFront", ActionTone::Default },
                                    { "Reset force", "StudioReset", ActionTone::Default } };
    ImVec4    ActionRects[2]{};
    const int Fired =
        ActionRow::Construct(Column, "ForceActions", Actions, 2, Force.Enabled, nullptr, ActionRowVoice::Warm, ActionRects);
    for (int Index = 0; Index < 2; ++Index)
    {
        char RectName[48]{};
        std::snprintf(RectName, sizeof(RectName), "Inspector/Force/Action%d", Index);
        RecordParticleWorkspaceRect(State, RectName, ImVec2(ActionRects[Index].x, ActionRects[Index].y),
                                    ImVec2(ActionRects[Index].z, ActionRects[Index].w));
    }
    if (Fired == 0) NoopParticleWorkspaceCommand(State, "WIND", "Open in Force Field refused", "Suite jumps are NOOPs in this shell");
    else if (Fired == 1) NoopParticleWorkspaceCommand(State, "WIND", "Reset force refused", "Force reset is a NOOP in this shell");
}

} // namespace

void ConstructParticleWorkspaceInspector(ParticleWorkspaceState& State, const EditorTypefaces& Faces, ControlColumn& Column)
{
    (void)Faces;
    if (State.Selected == ParticleWorkspaceState::SelectedScene) ConstructScenePage(State, Column);
    else if (State.Selected == ParticleWorkspaceState::SelectedWind) ConstructWindPage(State, Column);
    else if (State.Selected >= 0 && State.Selected < static_cast<int>(State.Effects.size()))
        ConstructEffectPage(State, Column, State.Effects[static_cast<size_t>(State.Selected)]);
    else if (State.Selected >= ParticleWorkspaceState::SelectedForceBase &&
             State.Selected < ParticleWorkspaceState::SelectedForceBase + static_cast<int>(State.Forces.size()))
    {
        ConstructForcePage(State, Column, State.Forces[static_cast<size_t>(State.Selected - ParticleWorkspaceState::SelectedForceBase)]);
    }
    else ConstructScenePage(State, Column);
}

} // namespace Frontier
