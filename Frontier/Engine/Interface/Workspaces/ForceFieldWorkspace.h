/*==========================================================================================================================================
                                                           FORCEFIELDWORKSPACE.H
==========================================================================================================================================*/
// 🧩 Native Force Field & Wind workspace: editable authored sources, four switchable presets, a live field sampler and
//    navigation, timeline triggers, and a TOML .levelspace export backed by Frontier's native ForceFieldSpace evaluator.

#pragma once

#include "Frontier/Engine/Interface/Workspaces/AssetBrowserWorkspace.h"

#include <imgui.h>

#include <cstdint>
#include <deque>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace Frontier
{

struct EditorTypefaces;
struct ForceFieldWorkspaceRuntime;

//------------------------------------------------------------------------------------------------------------------------
//                                                    CATALOGUE
//------------------------------------------------------------------------------------------------------------------------

enum
{
    ForceFieldContributionFlow = 0,
    ForceFieldContributionAccelerate,
    ForceFieldContributionDamp
};

enum
{
    ForceFieldReachSphere = 0,
    ForceFieldReachColumn,
    ForceFieldReachBox
};

enum
{
    ForceFieldFalloffSmooth = 0,
    ForceFieldFalloffLinear,
    ForceFieldFalloffInverseSquare,
    ForceFieldFalloffNone
};

enum
{
    ForceFieldActivationAlways = 0,
    ForceFieldActivationWindow,
    ForceFieldActivationTrigger
};

struct ForceFieldWorkspaceTypeParam
{
    const char* Key     = nullptr;
    const char* Label   = nullptr;
    double      Minimum = 0.0;
    double      Maximum = 1.0;
    double      Step    = 0.1;
    const char* Unit    = "";
    int         Digits  = 1;
    bool        Distance = false;
    double      Default = 0.0;
};

struct ForceFieldWorkspaceType
{
    const char* Id           = nullptr;
    const char* Name         = nullptr;
    int         Contribution = ForceFieldContributionFlow;
    const char* Glyph        = nullptr; // 🧩 StudioField* glyph name.
    uint32_t    Colour       = 0x8FD3C4FF;
    const char* Native       = nullptr;
    int         Reach        = ForceFieldReachSphere;
    const char* Blurb        = nullptr;
    const char* BearingKey   = nullptr; // "Bearing" / "TrackBearing" / nullptr.
    const char* BearingLabel = nullptr;
    bool        Spin         = false;
    double      DefaultBearing = 0.0;
    double      DefaultTrackBearing = 0.0;
    double      DefaultRadius  = 180.0;
    double      DefaultHeight  = 180.0;
    double      DefaultHalfX   = 120.0;
    double      DefaultHalfZ   = 120.0;
    double      DefaultCentreY = 0.0;
    int         DefaultFalloff = ForceFieldFalloffSmooth;
    int         DefaultActivation = ForceFieldActivationAlways;
    double      DefaultBegins = 0.0;
    double      DefaultLasts  = 0.0;
    double      DefaultRepeats = 0.0;
    ForceFieldWorkspaceTypeParam Params[7]{};
    int                       ParamCount = 0;
};

[[nodiscard]] int                        QueryForceFieldTypeCount() noexcept;
[[nodiscard]] const ForceFieldWorkspaceType& QueryForceFieldType(int Index) noexcept;
[[nodiscard]] int                        QueryForceFieldTypeById(const char* Id) noexcept;
[[nodiscard]] const char*                QueryForceFieldChannel(int Index) noexcept; // 🧩 "Particles".."Vehicles".
[[nodiscard]] const char*                QueryForceFieldChannelLabel(int Index) noexcept;
[[nodiscard]] const char*                QueryForceFieldContributionUnit(int Contribution) noexcept;
[[nodiscard]] const char*                QueryForceFieldReachName(int Reach) noexcept;
[[nodiscard]] const char*                QueryForceFieldFalloffLabel(int Falloff) noexcept;
[[nodiscard]] const char*                QueryForceFieldFalloffName(int Falloff) noexcept;
[[nodiscard]] const char*                QueryForceFieldActivationName(int Activation) noexcept;
[[nodiscard]] const char*                QueryForceFieldStatusName(int Status) noexcept; // Active/Waiting/Armed/Off/Spent.

//------------------------------------------------------------------------------------------------------------------------
//                                                    VIEW STATE
//------------------------------------------------------------------------------------------------------------------------

struct ForceFieldWorkspaceSource
{
    int         Type      = 0;
    std::string Name;
    bool        Enabled   = true;
    double      Centre[3] = { 0.0, 0.0, 0.0 }; // 🧩 Workspace axes: east, altitude, north; native field Z is -north.
    int         Reach     = ForceFieldReachSphere;
    double      Radius    = 180.0;
    double      Height    = 180.0;
    double      HalfX     = 120.0;
    double      HalfZ     = 120.0;
    int         Falloff   = ForceFieldFalloffSmooth;
    int         Activation = ForceFieldActivationAlways;
    double      Begins    = 0.0;
    double      Lasts     = 0.0;
    double      Repeats   = 0.0;
    double      RampIn    = 1.25;
    double      RampOut   = 2.0;
    double      TriggeredAt = -1.0; // 🧩 < 0: never triggered.
    bool        Acts[7]   = {};
    double      Bearing   = 0.0;
    double      TrackBearing = 0.0;
    int         Spin      = 1;
    double      Params[7] = {}; // 🧩 Aligned with the type's Params; Params[0] is always Strength.
};

struct ForceFieldWorkspaceLogEntry
{
    std::string When;
    std::string Channel;
    std::string Message;
    std::string Detail;
};

struct ForceFieldWorkspaceState
{
    enum
    {
        SelectedField = -2,
        SelectedWind  = -1
    };

    int  Selected = 0; // 🧩 SelectedField / SelectedWind / source index.
    bool FieldEnabled = true;
    bool FieldChannels[7] = { true, true, true, true, true, true, true };

    struct WindState
    {
        bool   Enabled      = false;
        bool   Bounded      = true;
        double RegionRadius = 1600.0;
        double Bearing      = 45.0;
        double Speed        = 4.5;
        double GustAmplitude = 3.4;
        double GustStrength = 0.25;
        double GustFrequency = 0.085;
        double Turbulence   = 0.38;
        double TurbulenceScale = 91.0;
        double Shear        = 0.15;
        double Veer         = 8.0;
        double MesoscaleStrength = 0.22;
        double MesoscaleScale = 18000.0;
        uint32_t Seed = 7331;
    } Wind;

    struct ViewState
    {
        int    Contribution  = ForceFieldContributionFlow;
        int    Quantity      = 0; // 🧩 Speed / Vertical / Vorticity / Divergence.
        double ArrowSpacing  = 54.0;
        double FlowLineSpacing = 46.0;
        double FlowLineLength = 22.0;
        double QuietCutoff   = 0.03;
        double SliceHeight   = 10.0;
        bool   FlowLinePulse = true;
        bool   Cascades      = false;
        bool   FlowLines     = true;
        bool   Arrows        = true;
        bool   ShowInfluence = true;
        bool   Heatmap       = false;
        bool   MinimalLabels = false;
        double Span          = 1400.0;
        double CentreX       = 0.0;
        double CentreZ       = 0.0; // 🧩 Native field-axis Z (south-positive), unlike source workspace north.
        double Yaw           = 0.7853981633974483;
        double Pitch         = 0.62;
        int    Solo          = -1; // 🧩 Source index or -1.
        int    Follow        = -1;
    } View;

    std::vector<ForceFieldWorkspaceSource> Sources;
    std::shared_ptr<ForceFieldWorkspaceRuntime> Runtime;
    int    Scenario      = 0; // 🧩 0 lab, 1 corridor, 2 storm, 3 genuinely empty build preset.
    int    ViewMode      = 0; // 🧩 0 Map 2D, 1 Oblique 3D slice.
    int    PlacementType = -1; // 🧩 Armed source type index or -1.
    bool   LibraryOpen   = false;
    bool   LogOpen       = false;
    double ClockTime     = 0.0;
    bool   ClockPlaying  = true;
    int    ClockRate     = 1; // 🧩 1 / 10.
    double TimelineDuration = 60.0;
    std::string OutlinerQuery;
    std::string ExportPath = "ForceFieldWorkspace.levelspace";
    std::string ExportStatus = "Export the native ForceField, Wind, and ForceSource records.";
    std::string ExportPreview;

    bool CardDeclutter = true;
    bool CardReceivers = true;
    bool CardLevel     = false;
    bool CardWindFlow  = true;
    bool CardWindGust  = true;
    bool CardPlace     = true;
    bool CardStrength  = true;
    bool CardTiming    = true;

    double PeakSamples[40] = {};
    int    PeakCount       = 0;
    double WindSamples[40] = {};
    int    WindCount       = 0;

    std::deque<ForceFieldWorkspaceLogEntry> Log;
    std::map<std::string, ImVec4>        Rects; // 🧩 Named hit rects refreshed every frame for scripted validation.
};

void        ConstructForceFieldWorkspaceState(ForceFieldWorkspaceState& State);
void        ApplyForceFieldWorkspacePreset(ForceFieldWorkspaceState& State, int Scenario);
[[nodiscard]] int AddForceFieldWorkspaceSource(ForceFieldWorkspaceState& State, int Type, double X, double Y, double Z);
[[nodiscard]] bool DuplicateForceFieldWorkspaceSource(ForceFieldWorkspaceState& State, int Index);
[[nodiscard]] bool RemoveForceFieldWorkspaceSource(ForceFieldWorkspaceState& State, int Index);
[[nodiscard]] bool FireForceFieldWorkspaceSource(ForceFieldWorkspaceState& State, int Index);
void        AppendForceFieldWorkspaceLog(ForceFieldWorkspaceState& State, const char* Channel, const char* Message, const char* Detail = nullptr,
                                      const char* Key = nullptr);
void        LogForceFieldWorkspaceValue(ForceFieldWorkspaceState& State, const char* Channel, const char* Owner, const char* Label,
                                     const char* Shown);
void        RecordForceFieldWorkspaceRect(ForceFieldWorkspaceState& State, const char* Name, ImVec2 Min, ImVec2 Max);
[[nodiscard]] int  ResolveForceFieldSourceStatus(const ForceFieldWorkspaceSource& Source, double Time) noexcept; // 0 Active 1 Waiting 2 Armed 3 Off 4 Spent.
void        FormatForceFieldDistance(double Metres, char* Text, size_t TextSize, const char*& Unit) noexcept;
void        FormatForceFieldSpan(double Metres, char* Text, size_t TextSize) noexcept; // 🧩 Visualizer span text: "245 m" / "1.40 km" / "100 km".
void        FormatForceFieldTrimmed(double Value, int Digits, char* Text, size_t TextSize) noexcept; // 🧩 Number(Value.toFixed(Digits)).
[[nodiscard]] bool QueryForceFieldWorkspaceRect(const ForceFieldWorkspaceState& State, const char* Name, ImVec2& Min, ImVec2& Max) noexcept;

void ApplyForceFieldWorkspaceLink(ForceFieldWorkspaceState& State, AssetBrowserLink* Link); // 🧩 forcefield/<id> → arm placement.
void ConstructForceFieldWorkspace(ForceFieldWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Size,
                                  AssetBrowserLink* Link = nullptr);

class ControlColumn;
void ConstructForceFieldWorkspaceInspector(ForceFieldWorkspaceState& State, const EditorTypefaces& Faces, ControlColumn& Column);

} // namespace Frontier
