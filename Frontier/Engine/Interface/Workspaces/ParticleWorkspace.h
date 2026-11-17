/*==========================================================================================================================================
                                                           PARTICLEWORKSPACE.H
==========================================================================================================================================*/
// 🧩 Particle Workspace as a C++ UI shell: the Remastered 1:1 visuals (top bar, outliner, Stage / Plan viewport,
//    inspector, transport, log, 52-preset library, TOML export preview) over local view state only. Each lab effect
//    holds a shell-local ParticleEffectParameters copy (mirroring the prototype's Effect.P); value controls (sliders,
//    switches, segments, vectors, dials, tabs, colour swatches) edit those copies and the export preview, and nothing
//    else. Every command that would mutate the scene or reach the engines (scene tabs, transport, strike, burst, add,
//    remove, duplicate, copy, download, reset-all) is an explicit NOOP: it raises a toast, appends a warm log line,
//    and changes nothing. Playhead, timecode, frame, alive, rate, and CPU read honest frozen zeros; only the capacity
//    sum is live, because it sums shell-local figures. The workspace makes no engine, shader, or renderer calls; the
//    stage markers, probe, legend, and series are static decor, honestly labelled in the viewport footer.

#pragma once

#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleEffectLibrary.h"
#include "Frontier/Engine/Interface/Workspaces/AssetBrowserWorkspace.h"

#include <imgui.h>

#include <cstdint>
#include <deque>
#include <map>
#include <string>
#include <vector>

namespace Frontier
{

struct EditorTypefaces;

//------------------------------------------------------------------------------------------------------------------------
//                                                    CATALOGUE
//------------------------------------------------------------------------------------------------------------------------

// 📝 Behaviour codes mirror the prototype's kind (2 is unused); appearance codes mirror its shape.
enum
{
    ParticleWorkspaceLabSparks    = 0,
    ParticleWorkspaceLabLeaves    = 4,
    ParticleWorkspaceLabAtoms     = 6,
    ParticleWorkspaceLabChemicals = 7
};

enum
{
    ParticleWorkspaceForcePrevailing = 0,
    ParticleWorkspaceForceGust,
    ParticleWorkspaceForceTornado,
    ParticleWorkspaceForceOutflow
};

struct ParticleWorkspacePreset
{
    const char* Id         = nullptr;
    const char* Name       = nullptr;
    const char* Group      = nullptr;
    const char* Blurb      = nullptr;
    int         Behaviour  = 0;
    int         Appearance = 0;
    const char* Glyph      = nullptr; // 🧩 Studio glyph name.
    uint32_t    Colour     = 0xE8C27AFF;
};

[[nodiscard]] int                         QueryParticlePresetCount() noexcept; // 🧩 Always 52, the eos library.
[[nodiscard]] const ParticleWorkspacePreset& QueryParticlePreset(int Index) noexcept;
[[nodiscard]] int                         QueryParticlePresetById(const char* Id) noexcept;
[[nodiscard]] const char*                 QueryParticleBehaviourName(int Behaviour) noexcept;
[[nodiscard]] const char*                 QueryParticleAppearanceName(int Appearance) noexcept;
[[nodiscard]] const char*                 QueryParticleReleaseName(int Shape) noexcept;
[[nodiscard]] const char*                 QueryParticleForceName(int Category) noexcept;

//------------------------------------------------------------------------------------------------------------------------
//                                                    VIEW STATE
//------------------------------------------------------------------------------------------------------------------------

struct ParticleWorkspaceEffect
{
    int                      Preset = 0; // 🧩 Read-only catalogue link; the Parameters below are the shell-local copy.
    std::string              Name;
    bool                     Enabled = true;
    ParticleEffectParameters Parameters;
    int                      InspectorTab = 0; // 🧩 0 Overview, 1 Source, 2 Motion, 3 Modules.
    bool                     ModuleWind      = true;
    bool                     ModuleBurst     = false;
    bool                     ModuleMolecular = false;
    bool                     ModuleChemistry = false;
    bool                     ModuleFlock     = false;
    bool                     ModuleFibre     = false;
};

struct ParticleWorkspaceForce
{
    int         Category = ParticleWorkspaceForcePrevailing;
    std::string Name;
    bool        Enabled  = true;
    double      Centre[3] = { 0.0, 0.0, 0.0 };
    double      Strength  = 0.0;
    double      Radius    = 0.0;
    double      Bearing   = 0.0;
    double      Rate      = 0.0;
};

struct ParticleWorkspaceLogEntry
{
    std::string When;
    std::string Channel;
    std::string Message;
    std::string Detail;
};

struct ParticleWorkspaceState
{
    enum
    {
        SelectedScene    = -2,
        SelectedWind     = -1,
        SelectedForceBase = 100 // 🧩 Forces select as SelectedForceBase + index.
    };

    enum
    {
        TabOverview = 0,
        TabSource,
        TabMotion,
        TabModules
    };

    int  Selected = 0; // 🧩 SelectedScene / SelectedWind / effect index / SelectedForceBase + force index.

    std::vector<ParticleWorkspaceEffect> Effects; // 🧩 The lab scene: sparks, leaves, atoms, chemicals.
    std::vector<ParticleWorkspaceForce>  Forces;  // 🧩 DefaultForces: prevailing, gust, tornado, outflow.

    int    Scene    = 0; // 🧩 0 lab (scene tabs are NOOPs; the lab scene always shows).
    int    ViewMode = 0; // 🧩 0 Stage, 1 Plan.
    int    Camera   = 0; // 🧩 0 Orbit, 1 Top, 2 Side (local, silent).
    int    Overlay  = 0; // 🧩 0 Off, 1 Velocity, 2 Life (local, silent).
    double OrbitYaw      = 35.0;
    double OrbitPitch    = 22.0;
    double OrbitDistance = 14.0;
    double PanX = 0.0;
    double PanY = 0.0;
    bool   ShowTrails = true;
    bool   ShowBounds = true;
    bool   ShowGrid   = true;
    int    FollowTarget = -1; // 🧩 Minimap pick: effect index or -1 (logs VIEW).

    bool   LibraryOpen = false;
    bool   ExportOpen  = false;
    bool   LogOpen     = false;
    double ClockTime   = 0.0; // 🧩 Frozen: transport is a literal NOOP.
    bool   ClockPlaying = false;
    int    ClockRate    = 1; // 🧩 1 / 10.
    double TimelineDuration = 60.0;
    std::string OutlinerQuery;
    std::string ExportText; // 🧩 The generated TOML preview, rebuilt from shell state.

    double AliveSamples[40] = {};
    int    AliveCount       = 0;

    std::deque<ParticleWorkspaceLogEntry> Log;
    std::map<std::string, ImVec4>         Rects; // 🧩 Named hit rects refreshed every frame for scripted validation.
};

void        ConstructParticleWorkspaceState(ParticleWorkspaceState& State);
void        AppendParticleWorkspaceLog(ParticleWorkspaceState& State, const char* Channel, const char* Message, const char* Detail = nullptr,
                                       const char* Key = nullptr);
void        NoopParticleWorkspaceAction(ParticleWorkspaceState& State, const char* Channel, const char* Message);
void        NoopParticleWorkspaceCommand(ParticleWorkspaceState& State, const char* Channel, const char* Message, const char* ToastText);
void        LogParticleWorkspaceValue(ParticleWorkspaceState& State, const char* Channel, const char* Owner, const char* Label,
                                      const char* Shown);
void        SelectParticleWorkspaceNode(ParticleWorkspaceState& State, int Selection) noexcept; // 🧩 Silent: no log, no toast.
void        ResetParticleWorkspaceEffect(ParticleWorkspaceEffect& Effect); // 🧩 Restores the preset Parameters locally.
void        RecordParticleWorkspaceRect(ParticleWorkspaceState& State, const char* Name, ImVec2 Min, ImVec2 Max);
void        RebuildParticleWorkspaceExport(ParticleWorkspaceState& State); // 🧩 TOML preview from shell state only.
void        FormatParticleTrimmed(double Value, int Digits, char* Text, size_t TextSize) noexcept; // 🧩 Number(Value.toFixed(Digits)).
void        FormatParticleSpan(double Metres, char* Text, size_t TextSize) noexcept; // 🧩 \"245 m\" / \"1.40 km\".
[[nodiscard]] bool QueryParticleWorkspaceRect(const ParticleWorkspaceState& State, const char* Name, ImVec2& Min, ImVec2& Max) noexcept;

void        ApplyParticleWorkspaceLink(ParticleWorkspaceState& State, AssetBrowserLink* Link); // 🧩 particle/<id> → old card refusal.
void ConstructParticleWorkspace(ParticleWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Size,
                                AssetBrowserLink* Link = nullptr);

class ControlColumn;
void ConstructParticleWorkspaceInspector(ParticleWorkspaceState& State, const EditorTypefaces& Faces, ControlColumn& Column);

} // namespace Frontier
