/*==========================================================================================================================================
                                                         FLUIDWORKSPACEINSPECTOR.CPP
==========================================================================================================================================*/
// 🧩 The Fluid Workspace inspector: the staged-object header (symbol chip, rename, type caption, enable switch) and the
//    Source / Simulation / Rendering tabs from the prototype's FluidPanel.js (Emission, Fuel & temperature, Velocity,
//    Burst generator, Collider, Domain, Voxel grid, Forces & turbulence, Combustion, Volume shading, Directional light,
//    Scattering & glow, Render quality, Embers & ash, Overlays & diagnostics). Value controls edit the shell-local
//    FluidWorkspaceParameters copy and log keyed PARAM lines; group cards open exactly as the prototype's <details>
//    markup. Resetting a tab lives with the panel heading in the shell TU.

#include "Engine/Interface/Workspaces/FluidWorkspace.h"

#include "Engine/Interface/Controls/CaptionText.h"
#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/GlyphRun.h"
#include "Engine/Interface/Controls/GlyphSymbol.h"
#include "Engine/Interface/Controls/SectionCard.h"
#include "Engine/Interface/Controls/SelectPill.h"
#include "Engine/Interface/Controls/SliderPill.h"
#include "Engine/Interface/Controls/SwitchPill.h"
#include "Engine/Interface/Controls/TextRow.h"
#include "Engine/Interface/Controls/Toast.h"
#include "Engine/Interface/InspectorControls.h"

#include <cmath>
#include <cstdio>

namespace Frontier
{

void LogFluidWorkspaceValue(FluidWorkspaceState& State, const char* Channel, const char* Label, const char* Shown)
{
    char Message[256]{};
    std::snprintf(Message, sizeof(Message), "%s → %s", Label, Shown);
    AppendFluidWorkspaceLog(State, Channel, Message, nullptr, Label);
}

void NoopFluidWorkspaceCommand(FluidWorkspaceState& State, const char* Channel, const char* Message, const char* ToastText)
{
    Toast::Show(ToastText);
    NoopFluidWorkspaceAction(State, Channel, Message);
}

namespace
{

void LogSliderValue(FluidWorkspaceState& State, const char* Channel, const char* Label, double Value, int Digits, const char* Unit)
{
    char Figure[48]{};
    FormatFluidTrimmed(Value, Digits, Figure, sizeof(Figure));
    char Shown[64]{};
    if (Unit != nullptr && Unit[0] != '\0') std::snprintf(Shown, sizeof(Shown), "%s %s", Figure, Unit);
    else std::snprintf(Shown, sizeof(Shown), "%s", Figure);
    LogFluidWorkspaceValue(State, Channel, Label, Shown);
}

bool ConstructParamSlider(FluidWorkspaceState& State, ControlColumn& Column, const char* Channel, const char* Id, const char* Label,
                          double& Value, double Minimum, double Maximum, double Step, const char* Unit, int Digits)
{
    if (!SliderPill::Construct(Column, Id, Label, Value, Minimum, Maximum, Step, Unit)) return false;
    LogSliderValue(State, Channel, Label, Value, Digits, Unit);
    return true;
}

bool ConstructParamStepped(FluidWorkspaceState& State, ControlColumn& Column, const char* Channel, const char* Id, const char* Label,
                           int& Value, double Minimum, double Maximum, double Step)
{
    double Shown = static_cast<double>(Value);
    if (!SliderPill::Construct(Column, Id, Label, Shown, Minimum, Maximum, Step, "")) return false;
    Value = static_cast<int>(std::round(Shown));
    LogSliderValue(State, Channel, Label, static_cast<double>(Value), 0, "");
    return true;
}

bool ConstructParamToggle(FluidWorkspaceState& State, ControlColumn& Column, const char* Channel, const char* Id, const char* Label,
                          const char* Detail, bool& Value)
{
    if (!SwitchPill::Construct(Column, Id, Label, Detail, Value)) return false;
    LogFluidWorkspaceValue(State, Channel, Label, Value ? "on" : "off");
    return true;
}

bool ConstructParamSelect(FluidWorkspaceState& State, ControlColumn& Column, const char* Channel, const char* Id, const char* Label,
                          int& Index, const char* const* Names, int Count)
{
    if (!SelectPill::Construct(Column, Id, Label, Names, Count, Index)) return false;
    LogFluidWorkspaceValue(State, Channel, Label, Names[Index]);
    return true;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    OBJECT HEADER
//------------------------------------------------------------------------------------------------------------------------

void ConstructObjectHeader(FluidWorkspaceState& State, ControlColumn& Column)
{
    const EditorTypefaces& Faces    = Column.QueryFaces();
    ImDrawList* const      DrawList = Column.QueryDrawList();
    const float            S        = Column.QueryScale();
    const float            Width    = Column.QueryWidth();
    const bool             Enabled  = QueryFluidNodeEnabled(State, State.Selected);
    const float            Fade     = Enabled ? 1.0f : 0.42f;

    const char* Glyph = "StudioBoxes";
    const char* Type  = "EULERIAN VOLUME";
    ImU32       Accent = ResolveCssColour(0x9AA3A8FF);
    if (State.Selected == FluidWorkspaceState::SelectedEmitter)
    {
        Glyph  = State.Parameters.EmitterFuel == 0.0 ? "StudioPuff" : "StudioFlame";
        Type   = "CONTINUOUS SOURCE";
        Accent = ResolveCssColour(0xE8823CFF);
    }
    else if (State.Selected == FluidWorkspaceState::SelectedCollider)
    {
        Glyph  = "StudioGlobe";
        Type   = "SIGNED DISTANCE COLLIDER";
        Accent = ResolveCssColour(0xB48FE8FF);
    }
    else if (State.Selected == FluidWorkspaceState::SelectedSun)
    {
        Glyph  = "StudioSun";
        Type   = "DIRECTIONAL LIGHT";
        Accent = ResolveCssColour(0xE8C27AFF);
    }

    const ImVec2 Top = Column.Space(46.0f, 0.0f, 4.0f);
    DrawList->AddRectFilled(Top, ImVec2(Top.x + Width, Top.y + 46.0f * S), FadeColour(ResolveCssColour(0x1A1A1AFF), Fade), 14.0f * S);
    DrawList->AddRect(Top, ImVec2(Top.x + Width, Top.y + 46.0f * S), FadeColour(ResolveCssColour(0xFFFFFF14), Fade), 14.0f * S,
                      ImDrawFlags_None, S);
    const ImVec2 ChipMin(Top.x + 10.0f * S, Top.y + 10.0f * S);
    DrawList->AddRectFilled(ChipMin, ImVec2(ChipMin.x + 26.0f * S, ChipMin.y + 26.0f * S), FadeColour(ResolveAlpha(Accent, 0.16f), Fade),
                            8.0f * S);
    (void)GlyphSymbol::Construct(DrawList, Glyph, ImVec2(ChipMin.x + 6.5f * S, ChipMin.y + 6.5f * S), 13.0f * S, 1.8f * S,
                                 FadeColour(Accent, Fade));
    (void)GlyphRun::Construct(Column, Faces.Light, 15.0f * S,
                              ImVec2(ChipMin.x + 35.0f * S, GlyphRun::ResolveBaseline(Top.y + 7.0f * S, 15.0f * S, 1.2f)),
                              FadeColour(ResolveCssColour(0xF1F1F1FF), Fade), State.NodeNames[State.Selected].c_str(), -0.25f * S);
    (void)GlyphRun::Construct(Column, Faces.Regular, 10.5f * S,
                              ImVec2(ChipMin.x + 35.0f * S, GlyphRun::ResolveBaseline(Top.y + 26.0f * S, 10.5f * S, 1.4f)),
                              FadeColour(ResolveCssColour(0x848484FF), Fade), Type);

    char NameBefore[72]{};
    std::snprintf(NameBefore, sizeof(NameBefore), "%s", State.NodeNames[State.Selected].c_str());
    if (TextRow::Construct(Column, "ObjectName", "Object name", State.NodeNames[State.Selected]))
    {
        char Message[160]{};
        std::snprintf(Message, sizeof(Message), "Rename: %s → %s", NameBefore, State.NodeNames[State.Selected].c_str());
        AppendFluidWorkspaceLog(State, "SCENE", Message, nullptr, "Object name");
    }
    bool NodeOn = Enabled;
    const bool SwitchLive = State.Selected != FluidWorkspaceState::SelectedDomain;
    if (SwitchPill::Construct(Column, "ObjectEnabled", "Enabled", "Staged in the scene", NodeOn, SwitchTone::Mono, SwitchLive))
    {
        ToggleFluidWorkspaceNode(State, State.Selected);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    SHARED GROUPS
//------------------------------------------------------------------------------------------------------------------------

void ConstructColliderRows(FluidWorkspaceState& State, ControlColumn& Column)
{
    FluidWorkspaceParameters& P = State.Parameters;
    static const char* Shapes[6] = { "None", "Moving / Interactive Sphere", "Vertical Bridge Pier / Pillar", "Horizontal cylinder",
                                     "Deflector slab", "Tyre ring" };
    if (P.ObstacleType < 0 || P.ObstacleType > 5) P.ObstacleType = 0;
    ConstructParamSelect(State, Column, "SOURCE", "ObstacleType", "Collider shape", P.ObstacleType, Shapes, 6);
    ConstructParamSlider(State, Column, "SOURCE", "ObstacleX", "Position X", P.ObstacleX, 0.2, 0.8, 0.01, "—", 2);
    ConstructParamSlider(State, Column, "SOURCE", "ObstacleY", "Position Y", P.ObstacleY, 0.2, 0.78, 0.01, "—", 2);
    ConstructParamSlider(State, Column, "SOURCE", "ObstacleZ", "Position Z", P.ObstacleZ, 0.2, 0.8, 0.01, "—", 2);
    ConstructParamSlider(State, Column, "SOURCE", "ObstacleRadius", "Collider radius", P.ObstacleRadius, 0.08, 0.28, 0.005, "m", 3);
    ConstructParamToggle(State, Column, "SOURCE", "ColliderAutoMove", "Animate collider", "Drifts the collider while rendering",
                         P.ColliderAutoMove);
    ConstructParamSlider(State, Column, "SOURCE", "ColliderSpeed", "Animation speed", P.ColliderSpeed, 0.1, 3.0, 0.05, "—", 2);
}

void ConstructLightRows(FluidWorkspaceState& State, ControlColumn& Column)
{
    FluidWorkspaceParameters& P = State.Parameters;
    ConstructParamSlider(State, Column, "RENDER", "SunIntensity", "Sun intensity", P.SunIntensity, 0.0, 8.0, 0.1, "—", 2);
    ConstructParamSlider(State, Column, "RENDER", "SunAzimuth", "Sun azimuth", P.SunAzimuth, 0.0, 360.0, 2.0, "°", 0);
    ConstructParamSlider(State, Column, "RENDER", "SunElevation", "Sun elevation", P.SunElevation, 10.0, 88.0, 1.0, "°", 0);
    ConstructParamSlider(State, Column, "RENDER", "AmbientIntensity", "Ambient light", P.AmbientIntensity, 0.0, 3.0, 0.05, "—", 2);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    SOURCE TAB
//------------------------------------------------------------------------------------------------------------------------

void ConstructSourceTab(FluidWorkspaceState& State, ControlColumn& Column)
{
    FluidWorkspaceParameters& P = State.Parameters;
    if (State.Selected == FluidWorkspaceState::SelectedCollider)
    {
        (void)SectionCard::Begin(Column, "SrcCollider", "Collider", "StudioGlobe", "SDF",
                                 "Position is normalized within the domain. The collider changes the simulated flow without restarting it.",
                                 State.OpenCollider);
        if (State.OpenCollider) ConstructColliderRows(State, Column);
        SectionCard::End(Column);
    }
    else
    {
        (void)SectionCard::Begin(Column, "SrcEmission", "Emission", "StudioFlame", "SOURCE",
                                 "A continuous source at the domain's X/Z centre. Height and radius are live simulation parameters.",
                                 State.OpenEmission);
        if (State.OpenEmission)
        {
            ConstructParamToggle(State, Column, "SOURCE", "EmitterEnabled", "Continuous emission", "A live source at the domain centre",
                                 P.EmitterEnabled);
            ConstructParamSlider(State, Column, "SOURCE", "EmitterRate", "Emission rate", P.EmitterRate, 0.1, 2.5, 0.05, "×", 2);
            ConstructParamSlider(State, Column, "SOURCE", "EmitterRadius", "Source radius", P.EmitterRadius, 0.05, 0.25, 0.005, "m", 3);
            ConstructParamSlider(State, Column, "SOURCE", "EmitterHeight", "Source height", P.EmitterHeight, 0.01, 1.5, 0.01, "m", 2);
        }
        SectionCard::End(Column);

        (void)SectionCard::Begin(Column, "SrcFuel", "Fuel & temperature", "StudioThermal", "INJECTION", nullptr, State.OpenFuel);
        if (State.OpenFuel)
        {
            ConstructParamSlider(State, Column, "SOURCE", "EmitterTemperature", "Temperature injection", P.EmitterTemperature, 0.0, 9.0,
                                 0.1, "—", 2);
            ConstructParamSlider(State, Column, "SOURCE", "EmitterFuel", "Fuel injection", P.EmitterFuel, 0.0, 9.0, 0.1, "—", 2);
            ConstructParamSlider(State, Column, "SOURCE", "EmitterSmoke", "Smoke injection", P.EmitterSmoke, 0.0, 9.0, 0.1, "—", 2);
        }
        SectionCard::End(Column);

        (void)SectionCard::Begin(Column, "SrcVelocity", "Velocity", "StudioWind", "FLOW", nullptr, State.OpenVelocity);
        if (State.OpenVelocity)
        {
            ConstructParamSlider(State, Column, "SOURCE", "EmitterUpwardVelocity", "Upward velocity", P.EmitterUpwardVelocity, 0.5, 8.0,
                                 0.1, "—", 2);
            ConstructParamSlider(State, Column, "SOURCE", "EmitterSwirl", "Swirl", P.EmitterSwirl, 0.0, 8.0, 0.1, "—", 2);
        }
        SectionCard::End(Column);
    }

    (void)SectionCard::Begin(Column, "SrcBurst", "Burst generator", "StudioBlast", "IMPULSE", nullptr, State.OpenBurst);
    if (State.OpenBurst)
    {
        ConstructParamToggle(State, Column, "SOURCE", "ShrapnelEnabled", "Shrapnel streamers", "Ballistic smoke on bursts",
                             P.ShrapnelEnabled);
        ConstructParamSlider(State, Column, "SOURCE", "BlastStrength", "Shockwave velocity", P.BlastStrength, 2.0, 18.0, 0.25, "—", 2);
        ConstructParamSlider(State, Column, "SOURCE", "BlastRadius", "Burst radius", P.BlastRadius, 0.1, 0.35, 0.01, "—", 2);
        ConstructParamSlider(State, Column, "SOURCE", "BlastTemperature", "Burst temperature", P.BlastTemperature, 2.0, 9.0, 0.1, "—", 2);
        ConstructParamSlider(State, Column, "SOURCE", "BlastFuel", "Burst fuel", P.BlastFuel, 0.0, 9.0, 0.1, "—", 2);
        ConstructParamSlider(State, Column, "SOURCE", "BlastSmoke", "Burst smoke", P.BlastSmoke, 0.0, 9.0, 0.1, "—", 2);
        ConstructParamSlider(State, Column, "SOURCE", "BlastLobes", "Lobe frequency", P.BlastLobes, 2.0, 12.0, 0.5, "—", 2);
    }
    SectionCard::End(Column);

    if (State.Selected != FluidWorkspaceState::SelectedCollider)
    {
        (void)SectionCard::Begin(Column, "SrcCollider", "Collider", "StudioGlobe", "SDF", nullptr, State.OpenCollider);
        if (State.OpenCollider) ConstructColliderRows(State, Column);
        SectionCard::End(Column);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    SIMULATION TAB
//------------------------------------------------------------------------------------------------------------------------

void ConstructSimulationTab(FluidWorkspaceState& State, ControlColumn& Column)
{
    FluidWorkspaceParameters& P = State.Parameters;
    (void)SectionCard::Begin(Column, "SimDomain", "Domain", "StudioBoxes", "3D", nullptr, State.OpenDomain);
    if (State.OpenDomain)
    {
        ConstructParamSlider(State, Column, "SIM", "BoundsWidth", "Width / depth", P.BoundsWidth, 1.0, 4.0, 0.05, "m", 2);
        ConstructParamSlider(State, Column, "SIM", "BoundsHeight", "Height", P.BoundsHeight, 1.2, 4.0, 0.05, "m", 2);
        ConstructParamToggle(State, Column, "SIM", "DynamicBounds", "Expand around bursts", "Bounds grow with the blast",
                             P.DynamicBounds);
        ConstructParamSlider(State, Column, "SIM", "DynamicBoundsMax", "Expansion limit", P.DynamicBoundsMax, 1.1, 2.2, 0.05, "×", 2);
    }
    SectionCard::End(Column);

    (void)SectionCard::Begin(Column, "SimGrid", "Voxel grid", "StudioGrid", "SOLVER",
                             "Changing voxel resolution rebuilds the grid and restarts the simulation. Other properties update live.",
                             State.OpenGrid);
    if (State.OpenGrid)
    {
        static const int   GridValues[7] = { 16, 24, 32, 48, 64, 96, 128 };
        static const char* GridNames[7]  = { "16³", "24³", "32³", "48³", "64³", "96³", "128³" };
        int GridIndex = 3;
        for (int Index = 0; Index < 7; ++Index)
        {
            if (GridValues[Index] == P.GridResolution) GridIndex = Index;
        }
        if (SelectPill::Construct(Column, "GridResolution", "Voxel resolution", GridNames, 7, GridIndex))
        {
            P.GridResolution = GridValues[GridIndex];
            LogFluidWorkspaceValue(State, "SIM", "Voxel resolution", GridNames[GridIndex]);
        }
        ConstructParamStepped(State, Column, "SIM", "PressureIterations", "Pressure iterations", P.PressureIterations, 6.0, 48.0, 2.0);
        ConstructParamToggle(State, Column, "SIM", "MacCormackAdvection", "MacCormack advection", "Sharper advection pass",
                             P.MacCormackAdvection);
        ConstructParamToggle(State, Column, "SIM", "EnclosedBox", "Closed domain walls", "Seals the top and sides", P.EnclosedBox);
        ConstructParamSlider(State, Column, "SIM", "TimeScale", "Time scale", P.TimeScale, 0.1, 2.0, 0.05, "×", 2);
    }
    SectionCard::End(Column);

    (void)SectionCard::Begin(Column, "SimForces", "Forces & turbulence", "StudioTornado", "FLOW", nullptr, State.OpenForces);
    if (State.OpenForces)
    {
        ConstructParamSlider(State, Column, "SIM", "VorticityConfinement", "Vorticity", P.VorticityConfinement, 0.0, 14.0, 0.1, "—", 2);
        ConstructParamSlider(State, Column, "SIM", "Buoyancy", "Buoyancy", P.Buoyancy, 0.0, 12.0, 0.1, "—", 2);
        ConstructParamSlider(State, Column, "SIM", "SmokeWeight", "Smoke weight", P.SmokeWeight, 0.0, 3.5, 0.05, "—", 2);
        ConstructParamSlider(State, Column, "SIM", "TurbulenceStrength", "Turbulence strength", P.TurbulenceStrength, 0.0, 8.0, 0.1,
                             "—", 2);
        ConstructParamSlider(State, Column, "SIM", "TurbulenceScale", "Turbulence scale", P.TurbulenceScale, 1.0, 10.0, 0.1, "—", 2);
        ConstructParamSlider(State, Column, "SIM", "WindX", "Crosswind X", P.WindX, -2.5, 2.5, 0.05, "—", 2);
        ConstructParamSlider(State, Column, "SIM", "WindZ", "Crosswind Z", P.WindZ, -2.5, 2.5, 0.05, "—", 2);
        ConstructParamSlider(State, Column, "SIM", "VelocityDamping", "Velocity damping", P.VelocityDamping, 0.0, 2.0, 0.01, "—", 2);
    }
    SectionCard::End(Column);

    (void)SectionCard::Begin(Column, "SimCombustion", "Combustion", "StudioFlame", "THERMAL", nullptr, State.OpenCombustion);
    if (State.OpenCombustion)
    {
        ConstructParamSlider(State, Column, "SIM", "BurnRate", "Burn rate", P.BurnRate, 0.2, 4.5, 0.05, "—", 2);
        ConstructParamSlider(State, Column, "SIM", "BurnHeat", "Heat release", P.BurnHeat, 0.5, 5.0, 0.05, "—", 2);
        ConstructParamSlider(State, Column, "SIM", "SootGeneration", "Soot generation", P.SootGeneration, 0.2, 4.0, 0.05, "—", 2);
        ConstructParamSlider(State, Column, "SIM", "CombustionExpansion", "Combustion expansion", P.CombustionExpansion, 0.0, 10.0, 0.1,
                             "—", 2);
        ConstructParamSlider(State, Column, "SIM", "CoolingRate", "Cooling", P.CoolingRate, 0.2, 3.5, 0.05, "—", 2);
        ConstructParamSlider(State, Column, "SIM", "SmokeDissipation", "Smoke dissipation", P.SmokeDissipation, 0.02, 1.2, 0.02, "—", 2);
    }
    SectionCard::End(Column);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    RENDERING TAB
//------------------------------------------------------------------------------------------------------------------------

void ConstructRenderingTab(FluidWorkspaceState& State, ControlColumn& Column)
{
    FluidWorkspaceParameters& P = State.Parameters;
    if (State.Selected == FluidWorkspaceState::SelectedSun)
    {
        (void)SectionCard::Begin(Column, "RenLight", "Directional light", "StudioSun", "LIGHT", nullptr, State.OpenLight);
        if (State.OpenLight) ConstructLightRows(State, Column);
        SectionCard::End(Column);
    }

    (void)SectionCard::Begin(Column, "RenVolume", "Volume shading", "StudioCloud", "VOLUME", nullptr, State.OpenVolume);
    if (State.OpenVolume)
    {
        static const char* Palettes[6] = { "Physical Planckian Blackbody", "Cinema Napalm / Rich Hydrocarbon",
                                           "Thermobaric White-Hot Ordnance", "Wildfire / Copper Emerald Flame",
                                           "Cherenkov Blue Plasma Core", "Arcane Void Magenta / Corrupt Pyro" };
        if (P.ColorPalette < 0 || P.ColorPalette > 5) P.ColorPalette = 0;
        ConstructParamSelect(State, Column, "RENDER", "ColorPalette", "Colour palette", P.ColorPalette, Palettes, 6);
        ConstructParamSlider(State, Column, "RENDER", "FireIntensity", "Fire intensity", P.FireIntensity, 0.5, 12.0, 0.1, "—", 2);
        ConstructParamSlider(State, Column, "RENDER", "DensityExtinction", "Smoke extinction", P.DensityExtinction, 4.0, 40.0, 0.5,
                             "—", 2);
        ConstructParamSlider(State, Column, "RENDER", "SmokeAlbedo", "Smoke albedo", P.SmokeAlbedo, 0.04, 0.9, 0.01, "—", 2);
        ConstructParamSlider(State, Column, "RENDER", "Exposure", "Exposure", P.Exposure, 0.5, 2.5, 0.05, "—", 2);
    }
    SectionCard::End(Column);

    if (State.Selected != FluidWorkspaceState::SelectedSun)
    {
        (void)SectionCard::Begin(Column, "RenLight", "Directional light", "StudioSun", "LIGHT", nullptr, State.OpenLight);
        if (State.OpenLight) ConstructLightRows(State, Column);
        SectionCard::End(Column);
    }

    (void)SectionCard::Begin(Column, "RenOptics", "Scattering & glow", "StudioRays", "OPTICS", nullptr, State.OpenOptics);
    if (State.OpenOptics)
    {
        ConstructParamSlider(State, Column, "RENDER", "BloomIntensity", "Bloom", P.BloomIntensity, 0.0, 2.0, 0.05, "—", 2);
        ConstructParamSlider(State, Column, "RENDER", "GodRaysIntensity", "Light shafts", P.GodRaysIntensity, 0.0, 1.5, 0.05, "—", 2);
        ConstructParamSlider(State, Column, "RENDER", "ShockwaveStrength", "Shockwave refraction", P.ShockwaveStrength, 0.0, 2.0, 0.05,
                             "—", 2);
        ConstructParamSlider(State, Column, "RENDER", "TemperatureScale", "Temperature scale", P.TemperatureScale, 0.4, 2.2, 0.05, "×",
                             2);
        ConstructParamSlider(State, Column, "RENDER", "InternalScattering", "Internal scattering", P.InternalScattering, 0.0, 6.0,
                             0.1, "—", 2);
        ConstructParamSlider(State, Column, "RENDER", "ShadowDensity", "Shadow density", P.ShadowDensity, 2.0, 25.0, 0.5, "—", 2);
        ConstructParamSlider(State, Column, "RENDER", "PhaseAnisotropy", "Phase anisotropy", P.PhaseAnisotropy, -0.5, 0.85, 0.02, "—",
                             2);
    }
    SectionCard::End(Column);

    (void)SectionCard::Begin(Column, "RenQuality", "Render quality", "StudioGauge", "GPU", nullptr, State.OpenQuality);
    if (State.OpenQuality)
    {
        ConstructParamStepped(State, Column, "RENDER", "RaymarchSteps", "Raymarch steps", P.RaymarchSteps, 32.0, 160.0, 4.0);
        ConstructParamStepped(State, Column, "RENDER", "ShadowSteps", "Shadow steps", P.ShadowSteps, 3.0, 12.0, 1.0);
        ConstructParamSlider(State, Column, "RENDER", "RenderScale", "Viewport resolution scale", P.RenderScale, 0.5, 1.25, 0.05, "×",
                             2);
        ConstructParamToggle(State, Column, "RENDER", "AutoGpuGovernor", "Adaptive raymarch quality",
                             "Drops steps to hold frame rate", P.AutoGpuGovernor);
        ConstructParamSlider(State, Column, "RENDER", "VoxelQuantization", "Voxel quantization", P.VoxelQuantization, 0.0, 1.0, 0.01,
                             "—", 2);
    }
    SectionCard::End(Column);

    (void)SectionCard::Begin(Column, "RenEmbers", "Embers & ash", "StudioSparkles", "PARTICLES", nullptr, State.OpenEmbers);
    if (State.OpenEmbers)
    {
        ConstructParamToggle(State, Column, "RENDER", "ShowEmbers", "Embers / ash", "Particle pass over the volume", P.ShowEmbers);
        ConstructParamStepped(State, Column, "RENDER", "EmberCount", "Particle count", P.EmberCount, 0.0, 1000.0, 10.0);
        ConstructParamSlider(State, Column, "RENDER", "EmberSize", "Particle size", P.EmberSize, 0.35, 2.5, 0.05, "—", 2);
        ConstructParamSlider(State, Column, "RENDER", "EmberIntensity", "Particle brightness", P.EmberIntensity, 0.1, 3.0, 0.05, "—",
                             2);
        ConstructParamSlider(State, Column, "RENDER", "EmberLifetime", "Particle lifetime", P.EmberLifetime, 0.25, 3.0, 0.05, "×", 2);
        ConstructParamSlider(State, Column, "RENDER", "EmberAshiness", "Ash blend", P.EmberAshiness, 0.0, 1.0, 0.01, "—", 2);
    }
    SectionCard::End(Column);

    (void)SectionCard::Begin(Column, "RenOverlays", "Overlays & diagnostics", "StudioLayers", "DEBUG", nullptr, State.OpenOverlays);
    if (State.OpenOverlays)
    {
        ConstructParamToggle(State, Column, "RENDER", "ShowBoundingBox", "Domain bounds", "Bounds box on the stage",
                             P.ShowBoundingBox);
        ConstructParamToggle(State, Column, "RENDER", "ShowVoxelGridLines", "Voxel grid lines", "Grid overlay on the stage",
                             P.ShowVoxelGridLines);
        ConstructParamToggle(State, Column, "RENDER", "ShowFloorGrid", "Studio floor", "Floor grid under the stage", P.ShowFloorGrid);
        ConstructParamToggle(State, Column, "RENDER", "ShowActiveVoxelCells", "Active voxel cells", "Highlights live cells",
                             P.ShowActiveVoxelCells);
        ConstructParamToggle(State, Column, "RENDER", "ShowAtlasMinimap", "Atlas minimap", "Tiled-atlas picture-in-picture",
                             P.ShowAtlasMinimap);
        static const char* AtlasFields[4] = { "State Atlas", "Velocity Atlas", "Vorticity Curl Atlas",
                                              "Pressure & 3D Irradiance Atlas" };
        if (P.AtlasMinimapField < 0 || P.AtlasMinimapField > 3) P.AtlasMinimapField = 0;
        ConstructParamSelect(State, Column, "RENDER", "AtlasMinimapField", "Atlas field", P.AtlasMinimapField, AtlasFields, 4);
        static const char* Channels[9] = { "Combined Lit", "Voxelized DDA Cubes", "Primary Density ρ", "Temperature T", "Fuel Core f",
                                           "3D Velocity Vectors u", "Vorticity / Curl Magnitude |∇×u|", "Poisson Pressure & Irradiance p",
                                           "3D Grid Cross-Section Slice Inspector" };
        if (P.RenderChannel < 0 || P.RenderChannel > 8) P.RenderChannel = 0;
        ConstructParamSelect(State, Column, "RENDER", "RenderChannel", "Render channel", P.RenderChannel, Channels, 9);
        static const char* Axes[3] = { "X-Axis Slice", "Y-Axis Slice", "Z-Axis Slice" };
        if (P.SliceAxis < 0 || P.SliceAxis > 2) P.SliceAxis = 2;
        ConstructParamSelect(State, Column, "RENDER", "SliceAxis", "Slice axis", P.SliceAxis, Axes, 3);
        ConstructParamSlider(State, Column, "RENDER", "SlicePosition", "Slice depth", P.SlicePosition, 0.05, 0.95, 0.01, "—", 2);
    }
    SectionCard::End(Column);
}

} // namespace

void ConstructFluidWorkspaceInspector(FluidWorkspaceState& State, const EditorTypefaces& Faces, ControlColumn& Column)
{
    (void)Faces;
    if (State.Selected < 0 || State.Selected > 3) State.Selected = FluidWorkspaceState::SelectedEmitter;
    ConstructObjectHeader(State, Column);
    static const char* Tabs[3] = { "Source", "Simulation", "Rendering" };
    ImVec4             TabRects[3]{};
    (void)SelectPill::ConstructTabs(Column, "FluidTabs", Tabs, 3, State.InspectorTab, true, nullptr, TabRects);
    for (int Index = 0; Index < 3; ++Index)
    {
        char RectName[48]{};
        std::snprintf(RectName, sizeof(RectName), "Inspector/Tab%d", Index);
        RecordFluidWorkspaceRect(State, RectName, ImVec2(TabRects[Index].x, TabRects[Index].y),
                                 ImVec2(TabRects[Index].z, TabRects[Index].w));
    }
    if (State.InspectorTab == FluidWorkspaceState::TabSimulation) ConstructSimulationTab(State, Column);
    else if (State.InspectorTab == FluidWorkspaceState::TabRendering) ConstructRenderingTab(State, Column);
    else ConstructSourceTab(State, Column);
    CaptionText::Construct(Column, "Changes apply while rendering");
}

} // namespace Frontier
