/*==========================================================================================================================================
                                                          PHOTOMETRICWORKSPACE.H
==========================================================================================================================================*/
// 🧩 Photometric Workspace as a C++ UI shell: the Remastered 1:1 visuals (rig tab bar, luminaire + environment
//    outliner, quick photometry chips, lens/camera HUD, luminaire stage, diurnal transport, console drawer, light &
//    environment inspector, IES goniometer matrix) over local view state only. The staged light/env copies mirror
//    the prototype's rig fields (Experimental Remastered/PhotometricEditor); value controls edit those copies and
//    log keyed PARAM lines. Loading .ies parses a bounded LM-63 Type-C TILT=NONE profile into workspace-local
//    memory, assigns it to an IES light, draws measured C0/C90 curves, and updates the shell wall-lux estimate; it
//    does not mutate scene data or persist. The stage can submit the staged luminaire rig to the host Scene Viewport, which
//    renders it through the native ReSTIR GI renderer; local markers remain editor overlays, not rendered lighting evidence.
//    Duplicate/delete luminaire, export .ies, export rig, and cross-studio suite links remain explicit NOOPs.

#pragma once

#include "Frontier/Engine/Interface/Workspaces/AssetBrowserWorkspace.h"
#include "Frontier/Engine/Interface/SceneViewportPresentation.h"
#include "Frontier/Engine/Photometry/PhotometricIes.h"

#include <imgui.h>

#include <deque>
#include <functional>
#include <map>
#include <string>
#include <vector>

namespace Frontier
{

struct EditorTypefaces;

//------------------------------------------------------------------------------------------------------------------------
//                                                    CATALOGUE
//------------------------------------------------------------------------------------------------------------------------

struct PhotometricLightSpec
{
    const char* Id         = nullptr; // 🧩 pointlight / spotlight / ieslight / arealight / tubelight / ledlight / ledstrip.
    const char* Label      = nullptr;
    const char* ShortLabel = nullptr;
    const char* Unit       = nullptr; // 🧩 cd for point/spot, lm otherwise.
    uint32_t    Accent     = 0xE8C27AFF;
};

struct PhotometricMoonSpec
{
    const char* Id       = nullptr;
    const char* Name     = nullptr;
    const char* Subtitle = nullptr;
    uint32_t    Tint     = 0xDCE2ECFF;
};

[[nodiscard]] int                           QueryPhotometricLightSpecCount() noexcept; // 🧩 Always 7.
[[nodiscard]] const PhotometricLightSpec&   QueryPhotometricLightSpec(int Index) noexcept;
[[nodiscard]] int                           QueryPhotometricLightSpecById(const char* Id) noexcept;
[[nodiscard]] int                           QueryPhotometricMoonCount() noexcept; // 🧩 Always 6.
[[nodiscard]] const PhotometricMoonSpec&    QueryPhotometricMoon(int Index) noexcept;
[[nodiscard]] int                           QueryPhotometricMeasuredIesCount() noexcept; // 🧩 Always 7.
[[nodiscard]] const char*                   QueryPhotometricMeasuredIes(int Index) noexcept;
[[nodiscard]] int                           QueryPhotometricPresetIesCount() noexcept; // 🧩 Always 8.
[[nodiscard]] const char*                   QueryPhotometricPresetIes(int Index) noexcept;

//------------------------------------------------------------------------------------------------------------------------
//                                                    RIG & ENVIRONMENT
//------------------------------------------------------------------------------------------------------------------------

// 📝 Shell-local mirror of one rig luminaire's Props (superset across the 7 types; each type reads its own subset).
struct PhotometricLightProps
{
    double Position[3] = { 0.0, 2.0, 0.0 }; // m
    double Target[3]   = { 0.0, 0.5, -2.0 }; // m
    bool   HasTarget   = false;
    double Rotation[3] = { 0.0, 0.0, 0.0 }; // deg
    double Intensity   = 22.0;   // cd (point/spot)
    double Angle       = 28.0;   // deg half-angle (spot) / emission angle (led)
    double Penumbra    = 0.40;
    double Distance    = 26.0;   // m reach
    double Decay       = 2.0;
    double Lumens      = 1650.0; // lm
    double Multiplier  = 1.0;    // ×
    double Range       = 120.0;  // m
    double Cone        = 58.0;   // deg field angle
    double Cutoff      = 0.0;    // deg pitch
    int    PresetProfile   = 3;  // 🧩 Index into the 8 analytical presets.
    int    MeasuredProfile = 0;  // 🧩 Index into the 7 bundled LM-63 profiles.
    int    CustomIesProfile = -1; // 🧩 Index into PhotometricWorkspaceState::LoadedIesProfiles, or -1.
    bool   UseMeasuredIes  = true;
    int    Aperture = 0; // 🧩 0 rectangle, 1 disk.
    double Width  = 2.0; // m
    double Height = 1.0; // m
    double Spread = 120.0; // deg
    bool   TwoSided = false;
    double Length = 1.8;  // m
    double Radius = 0.04; // m
    double Watts   = 18.0;  // W
    double Efficacy = 125.0; // lm/W
    double Dimmer  = 1.0;
    double Diameter = 40.0; // mm
    double LumensPerMetre = 1000.0;
    double WattsPerMetre  = 14.4;
    double LedsPerMetre   = 60.0;
    double Voltage = 24.0; // V
    bool   Diffuser = true;
    double Temperature = 4300.0; // K
    char   ColorHex[8]  = "#FFF2CF";
    bool   Shadows = true;
    bool   ShowGizmo = true; // 🧩 showDistribution / showCone / gizmoGlow / showShape per type.
};

struct PhotometricLightSeed
{
    const char* Id      = nullptr;
    const char* Name    = nullptr;
    int         Type    = 0; // 🧩 0 point, 1 spot, 2 ies, 3 area, 4 tube, 5 led, 6 strip.
    bool        Visible = true;
};

[[nodiscard]] int                        QueryPhotometricLightSeedCount() noexcept; // 🧩 Always 8.
[[nodiscard]] const PhotometricLightSeed& QueryPhotometricLightSeed(int Index) noexcept;
[[nodiscard]] PhotometricLightProps      QueryPhotometricLightSeedProps(int Index) noexcept;

struct PhotometricLight
{
    std::string          Name;
    int                  Type = 0;
    bool                 Visible = true;
    bool                 Locked  = false;
    PhotometricLightProps Props;
};

struct PhotometricEnvDome
{
    bool   Enabled = true;
    int    Mode = 0; // 🧩 0 Procedural Sky, 1 HDRI Meridian, 2 Overcast Softbox, 3 Night Starlight.
    double SkylightIntensity = 1.15; // ×
    double DiffuseMultiplier = 1.0;  // ×
    double ReflectionGain = 1.1;     // ×
    double RotationDeg  = 35.0;
    double TemperatureKelvin = 6500.0;
    int    CubemapResolution = 1; // 🧩 0 128, 1 256, 2 512, 3 1024.
};

struct PhotometricSunProps
{
    bool   Enabled = true;
    int    Year = 2026, Month = 9, Day = 10;
    double LocalHours = 14.5; // h
    double UtcOffset  = 2.0;  // h
    double Latitude   = -26.19; // deg
    double Longitude  = 28.32;  // deg
    double DiameterDeg = 0.53;
    double TemperatureK = 5600.0;
    double Intensity  = 18.0; // ×
    double DirectGain = 1.0;  // ×
    double Rayleigh = 1.0;    // ×
    double Mie      = 1.0;    // ×
};

struct PhotometricSunSolved
{
    double ElevationDeg = 41.5;
    double AzimuthDeg   = 0.0;
};

struct PhotometricMoon
{
    int    Slot = 0; // 🧩 0..5 into the moon catalogue.
    bool   Visible  = true;
    double PhaseDays = 8.9; // d
    double AzimuthDeg   = 78.0;
    double ElevationDeg = 28.0;
    double AngularDiameterDeg = 0.52;
    double Brightness  = 1.5; // ×
    bool   CastMoonlight = true;
};

struct PhotometricMoonMetrics
{
    double PhaseFraction = 0.0;
    double IlluminationPct = 0.0;
    char   PhaseLabel[24] = "Full moon";
};

struct PhotometricStars
{
    bool   Visible = true;
    double LimitingMagnitude = 5.5; // mag
    double Brightness  = 1.15; // ×
    bool   TwinkleEnabled = true;
    double TwinkleDepthPct = 30.0; // %
    double CelestialRotationDeg = 45.0;
};

struct PhotometricLensFlare
{
    bool   Enabled = true;
    bool   Anamorphic = true;
    bool   Starburst  = true;
    int    GhostShape = 0; // 🧩 0 hexagon, 1 circle, 2 blade.
    double Intensity  = 1.0; // ×
    double GhostBrightness = 0.35; // ×
    int    GhostCount = 6;
    double HaloRadius = 0.28;
};

struct PhotometricFog
{
    bool   Enabled = true;
    double Density = 0.024; // /m
    double ProbeDistanceM = 120.0;
};

struct PhotometricPost
{
    bool   Enabled = true;
    double ExposureEv = 0.25; // EV
    int    Tonemap = 0; // 🧩 0 ACES, 1 Neutral, 2 Reinhard.
};

void EvaluatePhotometricSun(const PhotometricSunProps& Props, PhotometricSunSolved& Solved) noexcept;
void SolvePhotometricMoon(const PhotometricMoon& Moon, PhotometricMoonMetrics& Metrics) noexcept;
[[nodiscard]] double QueryPhotometricFlux(int Type, const PhotometricLightProps& Props) noexcept;
[[nodiscard]] double QueryPhotometricCensusLumens(const PhotometricLight* Lights, int Count) noexcept;
[[nodiscard]] double QueryPhotometricWallLux(const PhotometricLight* Lights, int Count,
                                              const PhotometricIesProfile* ImportedProfiles = nullptr,
                                              int ImportedProfileCount = 0) noexcept;

struct PhotometricWorkspaceLogEntry
{
    std::string Channel;
    std::string Message;
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    STATE
//------------------------------------------------------------------------------------------------------------------------

struct PhotometricWorkspaceState
{
    enum
    {
        SelectedLight0 = 0,
        SelectedLight1,
        SelectedLight2,
        SelectedLight3,
        SelectedLight4,
        SelectedLight5,
        SelectedLight6,
        SelectedLight7,
        SelectedEnvDome,
        SelectedSun,
        SelectedMoon,
        SelectedStars,
        SelectedLensFlare,
        SelectedAtmosphere,
        SelectedPost
    };

    enum
    {
        ScenarioRoadway = 0,
        ScenarioGallery,
        ScenarioStudio,
        ScenarioLunar
    };

    enum
    {
        LensPbr = 0,
        LensLux,
        LensGoniometer,
        LensHomologation
    };

    enum
    {
        CameraOrbit = 0,
        CameraTop,
        CameraWall,
        CameraRoadway
    };

    int Selected = SelectedLight0;

    PhotometricLight Lights[8];

    PhotometricEnvDome   Dome;
    PhotometricSunProps  Sun;
    PhotometricSunSolved SunSolved;
    PhotometricMoon      Moon;
    PhotometricStars     Stars;
    PhotometricLensFlare Flare;
    PhotometricFog       Fog;
    PhotometricPost      Post;

    int  Scenario = ScenarioRoadway;
    int  Lens     = LensPbr;    // 🧩 Local, silent.
    int  Camera   = CameraOrbit; // 🧩 Local, silent.
    bool DarkRoom = true;       // 🧩 Local, silent.
    bool ShowGizmos = true;     // 🧩 Local, silent.

    bool SweepPlaying = false;
    bool ConsoleOpen  = false;
    bool MatrixOpen   = false;
    bool AddDrawerOpen = false;

    std::string SearchQuery;

    int  NoopCount = 0; // 🧩 Incremented by every refused engine/filesystem command.
    bool ExportIesNoopRaised = false; // 🧩 Latched by validation: exports stay explicit NOOPs.
    bool ExportRigNoopRaised = false;

    std::vector<PhotometricIesProfile> LoadedIesProfiles;
    bool LoadIesPopupRequested = false;
    char LoadIesPath[768] = {};
    std::string LoadIesError;

    enum
    {
        CardPreview = 0,
        CardFlags,
        CardOutput,
        CardOptics,
        CardTransform,
        CardDome,
        CardSun,
        CardMoon,
        CardStars,
        CardFlare,
        CardAtmosphere,
        CardPost,
        CardCount
    };
    bool OpenCards[CardCount] = {};

    std::deque<PhotometricWorkspaceLogEntry> Log;
    std::map<std::string, ImVec4>            Rects; // 🧩 Named hit rects refreshed every frame for scripted validation.
};

void        ConstructPhotometricWorkspaceState(PhotometricWorkspaceState& State);
[[nodiscard]] bool LoadPhotometricWorkspaceIes(PhotometricWorkspaceState& State, const std::string& Utf8Path,
                                               std::string& Error);
void        AppendPhotometricWorkspaceLog(PhotometricWorkspaceState& State, const char* Channel, const char* Message);
void        NoopPhotometricWorkspaceCommand(PhotometricWorkspaceState& State, const char* Channel, const char* Message,
                                            const char* ToastText);
void        LogPhotometricWorkspaceValue(PhotometricWorkspaceState& State, const char* Channel, const char* Label,
                                         const char* Shown);
void        SelectPhotometricWorkspaceNode(PhotometricWorkspaceState& State, int Selection) noexcept; // 🧩 Silent.
void        ApplyPhotometricScenario(PhotometricWorkspaceState& State, int Scenario); // 🧩 Visibility preset + RIG line.
void        RecordPhotometricWorkspaceRect(PhotometricWorkspaceState& State, const char* Name, ImVec2 Min, ImVec2 Max);
[[nodiscard]] bool QueryPhotometricWorkspaceRect(const PhotometricWorkspaceState& State, const char* Name, ImVec2& Min,
                                                ImVec2& Max) noexcept;

void ApplyPhotometricWorkspaceLink(PhotometricWorkspaceState& State, AssetBrowserLink* Link); // 🧩 photo-<group>/<id>.
using PhotometricViewportPresenter = std::function<SceneViewportImage(const SceneViewportRequest&)>;
[[nodiscard]] SceneViewportRequest BuildPhotometricPreviewRequest(const PhotometricWorkspaceState& State, float Width, float Height,
                                                                 float PixelDensity = 1.0f, double DeltaSeconds = 1.0 / 60.0);

void ConstructPhotometricWorkspace(PhotometricWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Size,
                                   AssetBrowserLink* Link = nullptr, const PhotometricViewportPresenter& Present = {},
                                   double DeltaSeconds = 1.0 / 60.0);

class ControlColumn;
void ConstructPhotometricWorkspaceInspector(PhotometricWorkspaceState& State, const EditorTypefaces& Faces,
                                            ControlColumn& Column);

} // namespace Frontier
