/*==========================================================================================================================================
                                                        FLUIDWORKSPACECATALOGUE.CPP
==========================================================================================================================================*/
// 🧩 The Fluid Workspace preset library: the 18 pinned plume presets (names, filter tags, blurbs) from the prototype's
//    PresetPresentation map (Experimental/Fluid/src/SceneSpecification.js). The shell lists them read-only; staging a
//    preset onto the scene is an explicit NOOP.

#include "Engine/Interface/Workspaces/FluidWorkspace.h"

#include <cstdio>
#include <cstring>
#include <ctime>

namespace Frontier
{
namespace
{

constexpr uint32_t FireColour  = 0xE8823CFF;
constexpr uint32_t SmokeColour = 0x9AA3A8FF;
constexpr uint32_t BlastColour = 0xD84A4AFF;

const FluidWorkspacePreset Presets[18] = {
    { "ue5_pyro_default", "Pyro plume", "fire", "Rolling flame · dark soot", "StudioFlame", FireColour },
    { "oil_well_inferno", "Oil well inferno", "fire", "Pressurised fuel column", "StudioFlame", FireColour },
    { "shrapnel_airburst", "Shrapnel airburst", "blast", "Ballistic smoke streamers", "StudioBlast", BlastColour },
    { "megaton_open_bounds", "Wide-bounds blast", "blast", "Large expanding fireball", "StudioBlast", BlastColour },
    { "tactical_ordnance", "Tactical detonation", "blast", "Flash core · dust cloud", "StudioBlast", BlastColour },
    { "obstacle_deflection", "Smoke deflection", "smoke", "Flow around a collider", "StudioPuff", SmokeColour },
    { "wildfire_tornado", "Wildfire tornado", "fire", "Spiralling emerald fire", "StudioTornado", FireColour },
    { "ashfall_motes", "Ashfall", "smoke", "Drifting smoke & ash", "StudioPuff", SmokeColour },
    { "voxelized_stylized", "Voxel fire", "fire", "Discrete volume shading", "StudioBoxes", FireColour },
    { "dust_tornado", "Dust tornado", "smoke", "Cold debris vortex", "StudioTornado", SmokeColour },
    { "tyre_burnout", "Tyre burnout", "smoke", "Rubber smoke off a ring", "StudioPuff", SmokeColour },
    { "ledge_sandfall", "Ledge sandfall", "smoke", "Sand poured off a slab", "StudioLayers", SmokeColour },
    { "settling_dust", "Settling dust", "smoke", "Slow pale aftermath", "StudioPuff", SmokeColour },
    { "small_gust", "Small gust", "smoke", "Thin haze on a crosswind", "StudioWind", SmokeColour },
    { "brick_fracture_dust", "Brick fracture", "blast", "Cold masonry burst", "StudioFracture", BlastColour },
    { "lantern_flame", "Lantern flame", "fire", "One small steady wick", "StudioFlame", FireColour },
    { "camp_fire", "Camp fire", "fire", "Open wood fire with sparks", "StudioFlame", FireColour },
    { "low_gpu_performance", "Lightweight plume", "fire", "24³ grid · lower GPU cost", "StudioFlame", FireColour },
};

} // namespace

int QueryFluidPresetCount() noexcept
{
    return 18;
}

const FluidWorkspacePreset& QueryFluidPreset(int Index) noexcept
{
    if (Index < 0 || Index >= 18) return Presets[0];
    return Presets[Index];
}

int QueryFluidPresetById(const char* Id) noexcept
{
    if (Id == nullptr) return -1;
    for (int Index = 0; Index < 18; ++Index)
    {
        if (std::strcmp(Presets[Index].Id, Id) == 0) return Index;
    }
    return -1;
}

const char* QueryFluidGroupName(const char* Group) noexcept
{
    if (Group == nullptr) return "All";
    if (std::strcmp(Group, "fire") == 0) return "Fire";
    if (std::strcmp(Group, "smoke") == 0) return "Smoke";
    if (std::strcmp(Group, "blast") == 0) return "Blast";
    return "All";
}


//------------------------------------------------------------------------------------------------------------------------
//                                                    VIEW HELPERS
//------------------------------------------------------------------------------------------------------------------------

void FormatFluidTrimmed(double Value, int Digits, char* Text, size_t TextSize) noexcept
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

void FormatFluidVoxels(int Grid, char* Text, size_t TextSize) noexcept
{
    if (Text == nullptr || TextSize == 0) return;
    const long long Voxels = static_cast<long long>(Grid) * Grid * Grid;
    char Figure[32]{};
    std::snprintf(Figure, sizeof(Figure), "%lld", Voxels);
    char Grouped[40]{};
    const size_t Length = std::strlen(Figure);
    size_t Out = 0;
    for (size_t Index = 0; Index < Length && Out + 1 < sizeof(Grouped); ++Index)
    {
        if (Index > 0 && (Length - Index) % 3 == 0) Grouped[Out++] = ',';
        Grouped[Out++] = Figure[Index];
    }
    Grouped[Out] = '\0';
    std::snprintf(Text, TextSize, "%s voxels", Grouped);
}

void FormatFluidBounds(double Width, double Height, char* Text, size_t TextSize) noexcept
{
    if (Text == nullptr || TextSize == 0) return;
    char Wide[24]{};
    char Tall[24]{};
    FormatFluidTrimmed(Width, 1, Wide, sizeof(Wide));
    FormatFluidTrimmed(Height, 1, Tall, sizeof(Tall));
    std::snprintf(Text, TextSize, "%s × %s × %s m", Wide, Tall, Wide);
}

bool QueryFluidWorkspaceRect(const FluidWorkspaceState& State, const char* Name, ImVec2& Min, ImVec2& Max) noexcept
{
    if (Name == nullptr) return false;
    const auto Found = State.Rects.find(Name);
    if (Found == State.Rects.end()) return false;
    Min = ImVec2(Found->second.x, Found->second.y);
    Max = ImVec2(Found->second.z, Found->second.w);
    return true;
}

void AppendFluidWorkspaceLog(FluidWorkspaceState& State, const char* Channel, const char* Message, const char* Detail, const char* Key)
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
        for (FluidWorkspaceLogEntry& Entry : State.Log)
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
    FluidWorkspaceLogEntry Entry{};
    Entry.When    = When;
    Entry.Channel = Channel;
    Entry.Message = Message;
    Entry.Detail  = Detail != nullptr ? Detail : "";
    State.Log.push_front(std::move(Entry));
    while (State.Log.size() > 80) State.Log.pop_back();
}

void NoopFluidWorkspaceAction(FluidWorkspaceState& State, const char* Channel, const char* Message)
{
    AppendFluidWorkspaceLog(State, Channel, Message, "NOOP in this shell");
}

void SelectFluidWorkspaceNode(FluidWorkspaceState& State, int Selection) noexcept
{
    if (Selection < 0 || Selection > 3) return;
    State.Selected     = Selection;
    State.InspectorTab = Selection == FluidWorkspaceState::SelectedDomain ? FluidWorkspaceState::TabSimulation
                         : Selection == FluidWorkspaceState::SelectedSun ? FluidWorkspaceState::TabRendering
                                                                        : FluidWorkspaceState::TabSource;
    // 📝 Like the prototype's re-rendered <details>, group opens reset to the markup defaults on every select.
    if (State.InspectorTab == FluidWorkspaceState::TabSource)
    {
        State.OpenEmission = true;
        State.OpenFuel     = true;
        State.OpenVelocity = true;
        State.OpenBurst    = false;
        State.OpenCollider = Selection == FluidWorkspaceState::SelectedCollider;
    }
    else if (State.InspectorTab == FluidWorkspaceState::TabSimulation)
    {
        State.OpenDomain     = true;
        State.OpenGrid       = true;
        State.OpenForces     = false;
        State.OpenCombustion = false;
    }
    else
    {
        State.OpenVolume   = true;
        State.OpenLight    = Selection == FluidWorkspaceState::SelectedSun;
        State.OpenOptics   = false;
        State.OpenQuality  = false;
        State.OpenEmbers   = false;
        State.OpenOverlays = false;
    }
}

bool QueryFluidNodeEnabled(const FluidWorkspaceState& State, int Node) noexcept
{
    if (Node == FluidWorkspaceState::SelectedEmitter) return State.Parameters.EmitterEnabled;
    if (Node == FluidWorkspaceState::SelectedCollider) return State.Parameters.ObstacleType > 0;
    if (Node == FluidWorkspaceState::SelectedSun) return State.Parameters.SunIntensity > 0.0;
    return true;
}

void ToggleFluidWorkspaceNode(FluidWorkspaceState& State, int Node)
{
    if (Node == FluidWorkspaceState::SelectedEmitter)
    {
        State.Parameters.EmitterEnabled = !State.Parameters.EmitterEnabled;
        LogFluidWorkspaceValue(State, "SCENE", State.NodeNames[Node].c_str(), State.Parameters.EmitterEnabled ? "on" : "off");
    }
    else if (Node == FluidWorkspaceState::SelectedCollider)
    {
        if (State.Parameters.ObstacleType > 0)
        {
            State.SavedColliderType          = State.Parameters.ObstacleType;
            State.Parameters.ObstacleType = 0;
        }
        else State.Parameters.ObstacleType = State.SavedColliderType > 0 ? State.SavedColliderType : 1;
        LogFluidWorkspaceValue(State, "SCENE", State.NodeNames[Node].c_str(), State.Parameters.ObstacleType > 0 ? "on" : "off");
    }
    else if (Node == FluidWorkspaceState::SelectedSun)
    {
        if (State.Parameters.SunIntensity > 0.0)
        {
            State.SavedSunIntensity          = State.Parameters.SunIntensity;
            State.Parameters.SunIntensity = 0.0;
        }
        else State.Parameters.SunIntensity = State.SavedSunIntensity > 0.0 ? State.SavedSunIntensity : 2.2;
        LogFluidWorkspaceValue(State, "SCENE", State.NodeNames[Node].c_str(), State.Parameters.SunIntensity > 0.0 ? "on" : "off");
    }
}

void ResetFluidWorkspaceParameters(FluidWorkspaceParameters& Parameters) noexcept
{
    Parameters = FluidWorkspaceParameters{};
}

void ResetFluidWorkspaceTab(FluidWorkspaceParameters& Parameters, int Tab) noexcept
{
    const FluidWorkspaceParameters Fresh{};
    if (Tab == 0)
    {
        Parameters.EmitterEnabled        = Fresh.EmitterEnabled;
        Parameters.EmitterRate           = Fresh.EmitterRate;
        Parameters.EmitterRadius         = Fresh.EmitterRadius;
        Parameters.EmitterHeight         = Fresh.EmitterHeight;
        Parameters.EmitterTemperature    = Fresh.EmitterTemperature;
        Parameters.EmitterFuel           = Fresh.EmitterFuel;
        Parameters.EmitterSmoke          = Fresh.EmitterSmoke;
        Parameters.EmitterUpwardVelocity = Fresh.EmitterUpwardVelocity;
        Parameters.EmitterSwirl          = Fresh.EmitterSwirl;
        Parameters.ShrapnelEnabled       = Fresh.ShrapnelEnabled;
        Parameters.BlastStrength         = Fresh.BlastStrength;
        Parameters.BlastRadius           = Fresh.BlastRadius;
        Parameters.BlastTemperature      = Fresh.BlastTemperature;
        Parameters.BlastFuel             = Fresh.BlastFuel;
        Parameters.BlastSmoke            = Fresh.BlastSmoke;
        Parameters.BlastLobes            = Fresh.BlastLobes;
        Parameters.ObstacleType          = Fresh.ObstacleType;
        Parameters.ObstacleX             = Fresh.ObstacleX;
        Parameters.ObstacleY             = Fresh.ObstacleY;
        Parameters.ObstacleZ             = Fresh.ObstacleZ;
        Parameters.ObstacleRadius        = Fresh.ObstacleRadius;
        Parameters.ColliderAutoMove      = Fresh.ColliderAutoMove;
        Parameters.ColliderSpeed         = Fresh.ColliderSpeed;
    }
    else if (Tab == 1)
    {
        Parameters.BoundsWidth           = Fresh.BoundsWidth;
        Parameters.BoundsHeight          = Fresh.BoundsHeight;
        Parameters.DynamicBounds         = Fresh.DynamicBounds;
        Parameters.DynamicBoundsMax      = Fresh.DynamicBoundsMax;
        Parameters.GridResolution        = Fresh.GridResolution;
        Parameters.PressureIterations    = Fresh.PressureIterations;
        Parameters.MacCormackAdvection   = Fresh.MacCormackAdvection;
        Parameters.EnclosedBox           = Fresh.EnclosedBox;
        Parameters.TimeScale             = Fresh.TimeScale;
        Parameters.VorticityConfinement  = Fresh.VorticityConfinement;
        Parameters.Buoyancy              = Fresh.Buoyancy;
        Parameters.SmokeWeight           = Fresh.SmokeWeight;
        Parameters.TurbulenceStrength    = Fresh.TurbulenceStrength;
        Parameters.TurbulenceScale       = Fresh.TurbulenceScale;
        Parameters.WindX                 = Fresh.WindX;
        Parameters.WindZ                 = Fresh.WindZ;
        Parameters.VelocityDamping       = Fresh.VelocityDamping;
        Parameters.BurnRate              = Fresh.BurnRate;
        Parameters.BurnHeat              = Fresh.BurnHeat;
        Parameters.SootGeneration        = Fresh.SootGeneration;
        Parameters.CombustionExpansion   = Fresh.CombustionExpansion;
        Parameters.CoolingRate           = Fresh.CoolingRate;
        Parameters.SmokeDissipation      = Fresh.SmokeDissipation;
    }
    else if (Tab == 2)
    {
        Parameters.SunIntensity       = Fresh.SunIntensity;
        Parameters.SunAzimuth         = Fresh.SunAzimuth;
        Parameters.SunElevation       = Fresh.SunElevation;
        Parameters.AmbientIntensity   = Fresh.AmbientIntensity;
        Parameters.ColorPalette       = Fresh.ColorPalette;
        Parameters.FireIntensity      = Fresh.FireIntensity;
        Parameters.DensityExtinction  = Fresh.DensityExtinction;
        Parameters.SmokeAlbedo        = Fresh.SmokeAlbedo;
        Parameters.Exposure           = Fresh.Exposure;
        Parameters.BloomIntensity     = Fresh.BloomIntensity;
        Parameters.GodRaysIntensity   = Fresh.GodRaysIntensity;
        Parameters.ShockwaveStrength  = Fresh.ShockwaveStrength;
        Parameters.TemperatureScale   = Fresh.TemperatureScale;
        Parameters.InternalScattering = Fresh.InternalScattering;
        Parameters.ShadowDensity      = Fresh.ShadowDensity;
        Parameters.PhaseAnisotropy    = Fresh.PhaseAnisotropy;
        Parameters.RaymarchSteps      = Fresh.RaymarchSteps;
        Parameters.ShadowSteps        = Fresh.ShadowSteps;
        Parameters.RenderScale        = Fresh.RenderScale;
        Parameters.AutoGpuGovernor    = Fresh.AutoGpuGovernor;
        Parameters.VoxelQuantization  = Fresh.VoxelQuantization;
        Parameters.ShowEmbers         = Fresh.ShowEmbers;
        Parameters.EmberCount         = Fresh.EmberCount;
        Parameters.EmberSize          = Fresh.EmberSize;
        Parameters.EmberIntensity     = Fresh.EmberIntensity;
        Parameters.EmberLifetime      = Fresh.EmberLifetime;
        Parameters.EmberAshiness      = Fresh.EmberAshiness;
        Parameters.ShowBoundingBox    = Fresh.ShowBoundingBox;
        Parameters.ShowVoxelGridLines = Fresh.ShowVoxelGridLines;
        Parameters.ShowFloorGrid      = Fresh.ShowFloorGrid;
        Parameters.ShowActiveVoxelCells = Fresh.ShowActiveVoxelCells;
        Parameters.ShowAtlasMinimap     = Fresh.ShowAtlasMinimap;
        Parameters.AtlasMinimapField    = Fresh.AtlasMinimapField;
        Parameters.RenderChannel        = Fresh.RenderChannel;
        Parameters.SliceAxis            = Fresh.SliceAxis;
        Parameters.SlicePosition        = Fresh.SlicePosition;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    DEFAULT STATE
//------------------------------------------------------------------------------------------------------------------------

void ConstructFluidWorkspaceState(FluidWorkspaceState& State)
{
    State = FluidWorkspaceState{};
    State.NodeNames[0] = "Gas domain";
    State.NodeNames[1] = "Fire emitter";
    State.NodeNames[2] = "Sphere collider";
    State.NodeNames[3] = "Directional light";
    AppendFluidWorkspaceLog(State, "WORKSPACE", "Fluid Workspace ready (shell)", "4 staged nodes · engine calls disabled");
}

} // namespace Frontier
