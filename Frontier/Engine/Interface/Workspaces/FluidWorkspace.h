/*==========================================================================================================================================
                                                             FLUIDWORKSPACE.H
==========================================================================================================================================*/
// 🧩 Fluid Workspace as a C++ UI shell: the Remastered 1:1 visuals (top bar, scene outliner, preset library, viewport
//    bar + plume stage + transport + timeline, Source / Simulation / Rendering inspector, flipbook bake dialog, status
//    bar) over local view state only. The staged FluidWorkspaceParameters copy mirrors the prototype's InitialParameters
//    (Experimental/Fluid/src/SceneSpecification.js); value controls (sliders, switches, selects, group cards, object
//    name) edit that copy and log keyed PARAM lines, and nothing else. Every command that would mutate the scene or
//    reach the engines (document tabs, add-node, step, reset, trigger burst, bake, downloads, diagnostics, focus,
//    maximize, preset staging, backend switch) is an explicit NOOP: it raises a toast, appends a warm log line, and
//    changes nothing. Play/pause, speed, turntable, tools, camera, and filters are silent local view state. Timecode,
//    frame, and FPS read honest frozen values; only the grid HUD, voxel count, bounds status, and source-track label
//    are live, because they derive from shell-local figures. The workspace makes no engine, shader, or renderer calls;
//    the stage grid, bounds box, and plume markers are static decor, honestly labelled in the viewport footer.

#pragma once

#include "Frontier/Engine/Interface/Workspaces/AssetBrowserWorkspace.h"

#include <imgui.h>

#include <deque>
#include <map>
#include <string>

namespace Frontier
{

struct EditorTypefaces;

//------------------------------------------------------------------------------------------------------------------------
//                                                    CATALOGUE
//------------------------------------------------------------------------------------------------------------------------

struct FluidWorkspacePreset
{
    const char* Id    = nullptr;
    const char* Name  = nullptr;
    const char* Group = nullptr; // 🧩 fire / smoke / blast, the library filter tag.
    const char* Blurb = nullptr;
    const char* Glyph = nullptr; // 🧩 Studio glyph name.
    uint32_t    Colour = 0xE8823CFF;
};

[[nodiscard]] int                       QueryFluidPresetCount() noexcept; // 🧩 Always 18, the pinned plume library.
[[nodiscard]] const FluidWorkspacePreset& QueryFluidPreset(int Index) noexcept;
[[nodiscard]] int                       QueryFluidPresetById(const char* Id) noexcept;
[[nodiscard]] const char*               QueryFluidGroupName(const char* Group) noexcept;

//------------------------------------------------------------------------------------------------------------------------
//                                                    PARAMETERS
//------------------------------------------------------------------------------------------------------------------------

// 📝 Shell-local mirror of the prototype's InitialParameters (units in comments match RenderControl's unit map).
struct FluidWorkspaceParameters
{
    // 🧩 Source: emission.
    bool   EmitterEnabled       = true;
    double EmitterRate          = 1.0;   // ×
    double EmitterRadius        = 0.10;  // m
    double EmitterHeight        = 0.07;  // m
    double EmitterTemperature   = 3.5;
    double EmitterFuel          = 2.8;
    double EmitterSmoke         = 1.4;
    double EmitterUpwardVelocity = 3.2;
    double EmitterSwirl         = 1.2;
    // 🧩 Source: burst generator.
    bool   ShrapnelEnabled  = true;
    double BlastStrength    = 9.8;
    double BlastRadius      = 0.18;
    double BlastTemperature = 5.4;
    double BlastFuel        = 4.6;
    double BlastSmoke       = 2.6;
    double BlastLobes       = 6.0;
    // 🧩 Source: collider.
    int    ObstacleType   = 0; // 🧩 0 none, 1 sphere, 2 vertical pier, 3 horizontal cylinder, 4 slab, 5 tyre ring.
    double ObstacleX      = 0.5;
    double ObstacleY      = 0.26;
    double ObstacleZ      = 0.5;
    double ObstacleRadius = 0.16; // m
    bool   ColliderAutoMove = false;
    double ColliderSpeed   = 1.25;
    // 🧩 Simulation: domain + solver.
    double BoundsWidth    = 1.85; // m
    double BoundsHeight   = 2.1;  // m
    bool   DynamicBounds  = true;
    double DynamicBoundsMax = 1.55; // ×
    int    GridResolution   = 48;   // 🧩 16/24/32/48/64/96/128.
    int    PressureIterations = 22;
    bool   MacCormackAdvection = true;
    bool   EnclosedBox         = false;
    double TimeScale           = 1.0; // ×
    bool   Paused              = false;
    bool   AutoTurntable       = false;
    // 🧩 Simulation: forces + combustion.
    double VorticityConfinement = 7.8;
    double Buoyancy             = 5.8;
    double SmokeWeight          = 1.15;
    double TurbulenceStrength   = 3.5;
    double TurbulenceScale      = 3.8;
    double WindX                = 0.22;
    double WindZ                = 0.0;
    double VelocityDamping      = 0.07;
    double BurnRate             = 1.85;
    double BurnHeat             = 2.6;
    double SootGeneration       = 1.55;
    double CombustionExpansion  = 4.4;
    double CoolingRate          = 1.35;
    double SmokeDissipation     = 0.18;
    // 🧩 Rendering: light + volume.
    double SunIntensity     = 2.2;
    double SunAzimuth       = 42.0; // °
    double SunElevation     = 52.0; // °
    double AmbientIntensity = 0.35;
    int    ColorPalette     = 0; // 🧩 0 Planckian … 5 void magenta.
    double FireIntensity    = 5.6;
    double DensityExtinction = 18.5;
    double SmokeAlbedo      = 0.22;
    double Exposure         = 1.25;
    // 🧩 Rendering: optics + quality + embers + overlays.
    double BloomIntensity     = 0.55;
    double GodRaysIntensity   = 0.45;
    double ShockwaveStrength  = 1.0;
    double TemperatureScale   = 1.15; // ×
    double InternalScattering = 2.5;
    double ShadowDensity      = 11.5;
    double PhaseAnisotropy    = 0.38;
    int    RaymarchSteps     = 72;
    int    ShadowSteps       = 6;
    double RenderScale       = 0.8; // ×
    bool   AutoGpuGovernor   = false;
    double VoxelQuantization = 0.0;
    bool   ShowEmbers       = true;
    int    EmberCount       = 550;
    double EmberSize        = 1.0;
    double EmberIntensity   = 1.4;
    double EmberLifetime    = 1.0; // ×
    double EmberAshiness    = 0.0;
    bool   ShowBoundingBox    = false;
    bool   ShowVoxelGridLines = false;
    bool   ShowFloorGrid      = true;
    bool   ShowActiveVoxelCells = false;
    bool   ShowAtlasMinimap     = false;
    int    AtlasMinimapField = 0; // 🧩 0 state, 1 velocity, 2 vorticity, 3 pressure.
    int    RenderChannel     = 0; // 🧩 0 lit … 8 cross-section.
    int    SliceAxis         = 2; // 🧩 0 X, 1 Y, 2 Z.
    double SlicePosition     = 0.5;
};

void ResetFluidWorkspaceParameters(FluidWorkspaceParameters& Parameters) noexcept;
void ResetFluidWorkspaceTab(FluidWorkspaceParameters& Parameters, int Tab) noexcept; // 🧩 0 source, 1 simulation, 2 rendering.

//------------------------------------------------------------------------------------------------------------------------
//                                                    VIEW STATE
//------------------------------------------------------------------------------------------------------------------------

struct FluidWorkspaceLogEntry
{
    std::string When;
    std::string Channel;
    std::string Message;
    std::string Detail;
};

struct FluidWorkspaceState
{
    enum
    {
        SelectedDomain   = 0,
        SelectedEmitter  = 1,
        SelectedCollider = 2,
        SelectedSun      = 3
    };

    enum
    {
        TabSource = 0,
        TabSimulation,
        TabRendering
    };

    enum
    {
        SceneFilterAll = 0,
        SceneFilterGas,
        SceneFilterGeometry,
        SceneFilterLights
    };

    int Selected     = SelectedEmitter;
    int InspectorTab = TabSource;

    FluidWorkspaceParameters Parameters;
    std::string              NodeNames[4];
    int                      SavedColliderType  = 1;
    double                   SavedSunIntensity = 2.2;

    // 🧩 Property-group cards, defaulted per the prototype's <details open> markup.
    bool OpenEmission = true;
    bool OpenFuel     = true;
    bool OpenVelocity = true;
    bool OpenBurst    = false;
    bool OpenCollider = false;
    bool OpenDomain   = true;
    bool OpenGrid     = true;
    bool OpenForces   = false;
    bool OpenCombustion = false;
    bool OpenVolume     = true;
    bool OpenLight      = false;
    bool OpenOptics     = false;
    bool OpenQuality    = false;
    bool OpenEmbers     = false;
    bool OpenOverlays   = false;

    int    Camera = 0; // 🧩 0 Perspective, 1 Front, 2 Side, 3 Top (local, silent).
    int    Tool   = 0; // 🧩 0 Orbit, 1 Source brush, 2 Place burst (local, silent).
    double OrbitYaw      = 35.0;
    double OrbitPitch    = 22.0;
    double OrbitDistance = 4.1;

    int SpeedIndex = 2; // 🧩 0.25 / 0.5 / 1 / 2 (local, silent; mirrors TimeScale).
    int BurstKind  = 0; // 🧩 Single / Shrapnel / Salvo / Colliding / Mushroom (local, silent).

    bool   BakeOpen         = false;
    int    BakeCount        = 16;
    int    BakeSize         = 256;
    int    BakeRate         = 24;
    double BakeWarmup       = 0.25;
    bool   BakeTransparent  = true;
    bool   BakeBurst        = false;

    std::string OutlinerQuery;
    int         SceneFilter = SceneFilterAll;
    bool        LogOpen       = false;

    std::deque<FluidWorkspaceLogEntry> Log;
    std::map<std::string, ImVec4>      Rects; // 🧩 Named hit rects refreshed every frame for scripted validation.
};

void        ConstructFluidWorkspaceState(FluidWorkspaceState& State);
void        AppendFluidWorkspaceLog(FluidWorkspaceState& State, const char* Channel, const char* Message, const char* Detail = nullptr,
                                    const char* Key = nullptr);
void        NoopFluidWorkspaceAction(FluidWorkspaceState& State, const char* Channel, const char* Message);
void        NoopFluidWorkspaceCommand(FluidWorkspaceState& State, const char* Channel, const char* Message, const char* ToastText);
void        LogFluidWorkspaceValue(FluidWorkspaceState& State, const char* Channel, const char* Label, const char* Shown);
void        SelectFluidWorkspaceNode(FluidWorkspaceState& State, int Selection) noexcept; // 🧩 Silent: maps node → tab, resets group opens.
[[nodiscard]] bool QueryFluidNodeEnabled(const FluidWorkspaceState& State, int Node) noexcept;
void        ToggleFluidWorkspaceNode(FluidWorkspaceState& State, int Node); // 🧩 Eye: flips the backing parameter + logs.
void        RecordFluidWorkspaceRect(FluidWorkspaceState& State, const char* Name, ImVec2 Min, ImVec2 Max);
void        FormatFluidTrimmed(double Value, int Digits, char* Text, size_t TextSize) noexcept; // 🧩 Number(Value.toFixed(Digits)).
void        FormatFluidVoxels(int Grid, char* Text, size_t TextSize) noexcept;                   // 🧩 "110,592 voxels".
void        FormatFluidBounds(double Width, double Height, char* Text, size_t TextSize) noexcept; // 🧩 "1.9 × 2.1 × 1.9 m".
[[nodiscard]] bool QueryFluidWorkspaceRect(const FluidWorkspaceState& State, const char* Name, ImVec2& Min, ImVec2& Max) noexcept;

void ApplyFluidWorkspaceLink(FluidWorkspaceState& State, AssetBrowserLink* Link); // 🧩 fluid/<id> → old card refusal.
void ConstructFluidWorkspace(FluidWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Size,
                             AssetBrowserLink* Link = nullptr);

class ControlColumn;
void ConstructFluidWorkspaceInspector(FluidWorkspaceState& State, const EditorTypefaces& Faces, ControlColumn& Column);

} // namespace Frontier
