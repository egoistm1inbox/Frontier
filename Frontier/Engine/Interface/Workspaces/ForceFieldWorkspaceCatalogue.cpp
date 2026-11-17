/*==========================================================================================================================================
                                                      FORCEFIELDWORKSPACECATALOGUE.CPP
==========================================================================================================================================*/
// 🧩 The ForceField workspace's static data: the 17 bounded force types (ForceFieldCatalogue.js Types), the channel /
//    reach / falloff / activation vocabularies, the lab scene's six sources, and the pure view helpers (distance
//    formatting, activation status). No engine state is touched; everything here is shell-local.

#include "Engine/Interface/Workspaces/ForceFieldWorkspace.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <ctime>

namespace Frontier
{

namespace
{

constexpr const char* ChannelNames[7]  = { "Particles", "Debris", "Precipitation", "Clouds", "Plumes", "Foliage", "Vehicles" };
constexpr const char* ChannelLabels[7] = { "Particles", "Debris", "Rain & hail", "Clouds", "Plumes", "Foliage", "Vehicles" };

// 📝 DistanceParam(Minimum, Maximum, Step): logarithmic m/km bindings; the step rides the 0..1000 slider.
#define DISTANCE_PARAM(Key_, Label_, Minimum_, Maximum_) \
    { Key_, Label_, Minimum_, Maximum_, 1.0, "m", 1, true, 0.0 }

const ForceFieldWorkspaceType WorkspaceTypes[] = {
    { "WindGenerator", "Wind generator", ForceFieldContributionFlow, "StudioFieldWind", 0x4AE4E8FF, "LocalizedWindGenerator",
      ForceFieldReachColumn, "Placeable bounded wind generator: produces directional air flow with coherent gusts and curl turbulence strictly inside its finite influence envelope.",
      "Bearing", "Blows toward", false, 60.0, 0.0, 240.0, 160.0, 220.0, 140.0, 0.0, ForceFieldFalloffSmooth,
      ForceFieldActivationAlways, 0.0, 0.0, 0.0,
      { { "Strength", "Wind speed", 0.5, 60.0, 0.5, "m/s", 1, false, 16.0 },
        { "GustStrength", "Gust amplitude", 0.0, 1.0, 0.01, "×", 2, false, 0.25 },
        { "GustFrequency", "Gust frequency", 0.02, 1.5, 0.01, "Hz", 2, false, 0.14 },
        { "Turbulence", "Curl turbulence", 0.0, 1.5, 0.01, "", 2, false, 0.35 },
        { "TurbulenceScale", "Eddy scale", 5.0, 800.0, 1.0, "m", 1, true, 42.0 } },
      5 },
    { "Tornado", "Tornado column", ForceFieldContributionFlow, "StudioFieldTornado", 0x32E6A4FF, "VortexColumn",
      ForceFieldReachColumn, "Burgers–Rott vortex column with tangential spin peaking at the inner radius, ground boundary inflow, helical core updraft, and finite outer influence.",
      "TrackBearing", "Track toward", true, 0.0, 90.0, 260.0, 480.0, 120.0, 120.0, 0.0, ForceFieldFalloffSmooth,
      ForceFieldActivationAlways, 0.0, 0.0, 0.0,
      { { "Strength", "Peak tangential speed", 1.0, 120.0, 0.5, "m/s", 1, false, 46.0 },
        { "InnerRadius", "Core radius", 2.0, 20000.0, 1.0, "m", 1, true, 22.0 },
        { "CollarRadius", "Collar radius", 2.0, 40000.0, 1.0, "m", 1, true, 72.0 },
        { "Inflow", "Radial inflow", 0.0, 60.0, 0.5, "m/s", 1, false, 14.0 },
        { "Updraft", "Axial updraft", 0.0, 80.0, 0.5, "m/s", 1, false, 26.0 },
        { "Height", "Column height", 20.0, 15000.0, 10.0, "m", 1, true, 480.0 },
        { "TrackSpeed", "Track speed", 0.0, 30.0, 0.1, "m/s", 1, false, 0.0 } },
      7 },
    { "Jet", "Jet corridor", ForceFieldContributionFlow, "StudioFieldJet", 0x38B6FFFF, "DirectionalJetCorridor",
      ForceFieldReachBox, "Bounded Venturi wind corridor along an axis, tapering smoothly at its sides and downstream limit.",
      "Bearing", "Axis toward", false, 95.0, 0.0, 180.0, 80.0, 90.0, 140.0, 8.0, ForceFieldFalloffSmooth,
      ForceFieldActivationAlways, 0.0, 0.0, 0.0,
      { { "Strength", "Axial speed", 0.5, 60.0, 0.5, "m/s", 1, false, 22.0 },
        { "Length", "Corridor length", 5.0, 30000.0, 1.0, "m", 1, true, 180.0 },
        { "InnerRadius", "Corridor radius", 1.0, 5000.0, 0.5, "m", 1, true, 24.0 } },
      3 },
    { "GustFront", "Gust front", ForceFieldContributionFlow, "StudioFieldFront", 0xFF8C32FF, "TravelingGustFront",
      ForceFieldReachBox, "Bounded travelling surge wave with lifting nose and decaying wake, confined inside its finite front corridor.",
      "Bearing", "Travels toward", false, 113.0, 0.0, 750.0, 140.0, 700.0, 320.0, 0.0, ForceFieldFalloffSmooth,
      ForceFieldActivationAlways, 0.0, 0.0, 0.0,
      { { "Strength", "Peak surge speed", 1.0, 60.0, 0.5, "m/s", 1, false, 26.0 },
        { "FrontSpeed", "Front speed", 0.0, 40.0, 0.5, "m/s", 1, false, 12.0 },
        { "CrestDepth", "Crest depth", 5.0, 10000.0, 1.0, "m", 1, true, 85.0 },
        { "HalfWidth", "Half width along front", 10.0, 60000.0, 10.0, "m", 1, true, 700.0 },
        { "Height", "Gust head height", 5.0, 5000.0, 5.0, "m", 1, true, 140.0 } },
      5 },
    { "Microburst", "Microburst", ForceFieldContributionFlow, "StudioFieldDownburst", 0x7E8CFFFF, "RadialMicroburst",
      ForceFieldReachColumn, "Convective downdraft shaft spreading into an outward radial ring at the ground within its bounded radius.",
      nullptr, nullptr, false, 0.0, 0.0, 360.0, 340.0, 120.0, 120.0, 220.0, ForceFieldFalloffSmooth,
      ForceFieldActivationAlways, 0.0, 0.0, 0.0,
      { { "Strength", "Peak outflow speed", 1.0, 60.0, 0.5, "m/s", 1, false, 28.0 },
        { "Downdraft", "Downdraft speed", 0.0, 60.0, 0.5, "m/s", 1, false, 22.0 },
        { "InnerRadius", "Column radius", 5.0, 10000.0, 1.0, "m", 1, true, 48.0 },
        { "RingRadius", "Outflow ring radius", 10.0, 20000.0, 1.0, "m", 1, true, 120.0 } },
      4 },
    { "Thermal", "Thermal updraft", ForceFieldContributionFlow, "StudioFieldThermal", 0xFFB838FF, "ThermalUpdraftPlume",
      ForceFieldReachColumn, "Buoyant rising chimney with ground-level radial entrainment and upper turret divergence inside a finite radius.",
      nullptr, nullptr, false, 0.0, 0.0, 180.0, 480.0, 120.0, 120.0, 0.0, ForceFieldFalloffSmooth,
      ForceFieldActivationAlways, 0.0, 0.0, 0.0,
      { { "Strength", "Peak updraft", 0.5, 40.0, 0.1, "m/s", 1, false, 14.5 },
        { "Inflow", "Entrainment inflow", 0.0, 20.0, 0.1, "m/s", 1, false, 4.8 },
        { "InnerRadius", "Warm core radius", 2.0, 5000.0, 1.0, "m", 1, true, 48.0 },
        { "Height", "Chimney height", 15.0, 12000.0, 5.0, "m", 1, true, 480.0 } },
      4 },
    { "Puff", "Gust puff", ForceFieldContributionFlow, "StudioFieldPuff", 0xFF9F43FF, "LocalizedGustPuff",
      ForceFieldReachSphere, "Bounded Gaussian air packet drifting downstream with ambient wind.",
      "Bearing", "Surge toward", false, 112.0, 0.0, 95.0, 180.0, 120.0, 120.0, 12.0, ForceFieldFalloffSmooth,
      ForceFieldActivationAlways, 0.0, 0.0, 0.0,
      { { "Strength", "Surge speed", 0.0, 40.0, 0.1, "m/s", 1, false, 14.0 },
        { "Lift", "Vertical surge", -10.0, 10.0, 0.1, "m/s", 1, false, 0.8 },
        { "RadiusY", "Vertical radius", 1.0, 2000.0, 0.5, "m", 1, true, 36.0 },
        { "Drift", "Drift factor", 0.0, 1.5, 0.01, "×", 2, false, 0.6 } },
      4 },
    { "Blast", "Blast wave", ForceFieldContributionFlow, "StudioFieldBlast", 0xFF5D38FF, "SphericalImpulseShell",
      ForceFieldReachSphere, "Expanding pressure shell r(t) = r₀ + c·t within a strict outer blast radius.",
      nullptr, nullptr, false, 0.0, 0.0, 420.0, 180.0, 120.0, 120.0, 2.0, ForceFieldFalloffSmooth,
      ForceFieldActivationWindow, 4.0, 12.0, 24.0,
      { { "Strength", "Peak radial speed", 1.0, 200.0, 1.0, "m/s", 0, false, 42.0 },
        { "Expansion", "Wavefront speed", 5.0, 400.0, 1.0, "m/s", 0, false, 110.0 },
        { "Thickness", "Shell thickness", 0.5, 2000.0, 0.5, "m", 1, true, 18.0 },
        { "InitialRadius", "Initial radius", 0.5, 1000.0, 0.5, "m", 1, true, 4.0 } },
      4 },
    { "Wake", "Vehicle wake", ForceFieldContributionFlow, "StudioFieldWake", 0x5CB3FFFF, "AerodynamicWake",
      ForceFieldReachBox, "Bounded slipstream wake behind a moving body: forward tow + counter-rotating upwash roll.",
      "Bearing", "Body travels toward", false, 0.0, 0.0, 90.0, 6.0, 120.0, 120.0, 1.2, ForceFieldFalloffSmooth,
      ForceFieldActivationAlways, 0.0, 0.0, 0.0,
      { { "Strength", "Slipstream tow", 0.0, 40.0, 0.1, "m/s", 1, false, 13.5 },
        { "Circulation", "Trailing circulation", 0.0, 30.0, 0.1, "m/s", 1, false, 7.5 },
        { "Speed", "Body speed", 0.0, 90.0, 0.5, "m/s", 1, false, 22.0 },
        { "HalfWidth", "Half track", 0.2, 40.0, 0.05, "m", 1, true, 2.2 },
        { "Length", "Wake length", 2.0, 600.0, 0.5, "m", 1, true, 48.0 },
        { "Height", "Wake height", 0.3, 60.0, 0.1, "m", 1, true, 6.0 } },
      6 },
    { "Current", "Current zone", ForceFieldContributionFlow, "StudioFieldCurrent", 0x2FD6C6FF, "current",
      ForceFieldReachBox, "Uniform steady stream strictly inside its oriented box bounds (air duct, river, ventilation stream).",
      "Bearing", "Flows toward", false, 90.0, 0.0, 140.0, 40.0, 80.0, 140.0, 0.0, ForceFieldFalloffSmooth,
      ForceFieldActivationAlways, 0.0, 0.0, 0.0,
      { { "Strength", "Flow speed", 0.0, 40.0, 0.1, "m/s", 1, false, 12.0 } },
      1 },
    { "Attractor", "Attractor", ForceFieldContributionAccelerate, "StudioFieldAttract", 0xFF4757FF, "attract",
      ForceFieldReachSphere, "Pulls toward centre with optional azimuthal swirl inside a finite spherical influence radius.",
      nullptr, nullptr, false, 0.0, 0.0, 200.0, 180.0, 120.0, 120.0, 10.0, ForceFieldFalloffSmooth,
      ForceFieldActivationAlways, 0.0, 0.0, 0.0,
      { { "Strength", "Radial pull", 0.0, 60.0, 0.1, "m/s²", 1, false, 10.0 },
        { "Swirl", "Swirl", 0.0, 30.0, 0.1, "m/s²", 1, false, 4.5 },
        { "Swallow", "Swallow radius", 0.0, 500.0, 0.5, "m", 1, false, 0.0 } },
      3 },
    { "Repulsor", "Repulsor", ForceFieldContributionAccelerate, "StudioFieldRepel", 0x3B8EFFFF, "repel",
      ForceFieldReachSphere, "Radial outward push confined strictly within its influence sphere — deflects approaching flow streams.",
      nullptr, nullptr, false, 0.0, 0.0, 170.0, 180.0, 120.0, 120.0, 10.0, ForceFieldFalloffSmooth,
      ForceFieldActivationAlways, 0.0, 0.0, 0.0,
      { { "Strength", "Outward push", 0.0, 60.0, 0.1, "m/s²", 1, false, 12.0 } },
      1 },
    { "Orbit", "Orbit ring", ForceFieldContributionAccelerate, "StudioFieldOrbit", 0xB374FFFF, "orbit",
      ForceFieldReachSphere, "Pure tangential acceleration around world up inside a bounded sphere.",
      nullptr, nullptr, false, 0.0, 0.0, 190.0, 180.0, 120.0, 120.0, 10.0, ForceFieldFalloffSmooth,
      ForceFieldActivationAlways, 0.0, 0.0, 0.0,
      { { "Strength", "Tangential pull", 0.0, 40.0, 0.1, "m/s²", 1, false, 7.0 } },
      1 },
    { "Lift", "Lift zone", ForceFieldContributionAccelerate, "StudioFieldLift", 0xD8F25AFF, "lift",
      ForceFieldReachColumn, "Bounded upward acceleration column fading smoothly to zero at its outer boundary.",
      nullptr, nullptr, false, 0.0, 0.0, 130.0, 240.0, 120.0, 120.0, 0.0, ForceFieldFalloffSmooth,
      ForceFieldActivationAlways, 0.0, 0.0, 0.0,
      { { "Strength", "Upward acceleration", 0.0, 40.0, 0.1, "m/s²", 1, false, 8.0 } },
      1 },
    { "Magnetic", "Magnetic dipole", ForceFieldContributionAccelerate, "StudioFieldMagnet", 0xEF63D8FF, "magnetic",
      ForceFieldReachSphere, "Dipole field lines along world Z, bounded inside a finite spherical region.",
      nullptr, nullptr, false, 0.0, 0.0, 160.0, 180.0, 120.0, 120.0, 10.0, ForceFieldFalloffSmooth,
      ForceFieldActivationAlways, 0.0, 0.0, 0.0,
      { { "Strength", "Dipole drive", 0.0, 30.0, 0.1, "m/s²", 1, false, 6.0 } },
      1 },
    { "Gravity", "Gravity zone", ForceFieldContributionAccelerate, "StudioFieldGravity", 0xF5B041FF, "gravity",
      ForceFieldReachSphere, "Localized gravity well or low-g pocket strictly bounded to its finite sphere/box influence.",
      nullptr, nullptr, false, 0.0, 0.0, 280.0, 180.0, 120.0, 120.0, 0.0, ForceFieldFalloffSmooth,
      ForceFieldActivationAlways, 0.0, 0.0, 0.0,
      { { "Strength", "Gravity", 0.0, 30.0, 0.01, "m/s²", 2, false, 9.81 } },
      1 },
    { "Drag", "Drag volume", ForceFieldContributionDamp, "StudioFieldDamp", 0xC084FCFF, "drag",
      ForceFieldReachBox, "Exponential damping zone — slows particles, gusts, and debris smoothly inside its oriented volume.",
      nullptr, nullptr, false, 0.0, 0.0, 120.0, 60.0, 120.0, 80.0, 0.0, ForceFieldFalloffSmooth,
      ForceFieldActivationAlways, 0.0, 0.0, 0.0,
      { { "Strength", "Damping rate", 0.0, 10.0, 0.01, "1/s", 2, false, 1.2 } },
      1 }
};

constexpr int WorkspaceTypeCount = static_cast<int>(sizeof(WorkspaceTypes) / sizeof(WorkspaceTypes[0]));

ForceFieldWorkspaceSource ConstructLabSource(int Type, const char* Name, double X, double Y, double Z)
{
    const ForceFieldWorkspaceType& T = WorkspaceTypes[Type];
    ForceFieldWorkspaceSource        Source{};
    Source.Type     = Type;
    Source.Name     = Name;
    Source.Centre[0] = X;
    Source.Centre[1] = Y;
    Source.Centre[2] = Z;
    Source.Reach    = T.Reach;
    Source.Radius   = T.DefaultRadius;
    Source.Height   = T.DefaultHeight;
    Source.HalfX    = T.DefaultHalfX;
    Source.HalfZ    = T.DefaultHalfZ;
    Source.Falloff  = T.DefaultFalloff;
    Source.Activation = T.DefaultActivation;
    Source.Begins   = T.DefaultBegins;
    Source.Lasts    = T.DefaultLasts;
    Source.Repeats  = T.DefaultRepeats;
    Source.Bearing  = T.DefaultBearing;
    Source.TrackBearing = T.DefaultTrackBearing;
    for (int Index = 0; Index < T.ParamCount && Index < 7; ++Index) Source.Params[Index] = T.Params[Index].Default;
    return Source;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    CATALOGUE
//------------------------------------------------------------------------------------------------------------------------

int QueryForceFieldTypeCount() noexcept
{
    return WorkspaceTypeCount;
}

const ForceFieldWorkspaceType& QueryForceFieldType(int Index) noexcept
{
    static const ForceFieldWorkspaceType Fallback{};
    if (Index < 0 || Index >= WorkspaceTypeCount) return Fallback;
    return WorkspaceTypes[Index];
}

int QueryForceFieldTypeById(const char* Id) noexcept
{
    if (Id == nullptr) return 0;
    for (int Index = 0; Index < WorkspaceTypeCount; ++Index)
    {
        if (std::strcmp(WorkspaceTypes[Index].Id, Id) == 0) return Index;
    }
    return 0;
}

const char* QueryForceFieldChannel(int Index) noexcept
{
    if (Index < 0 || Index >= 7) return ChannelNames[0];
    return ChannelNames[Index];
}

const char* QueryForceFieldChannelLabel(int Index) noexcept
{
    if (Index < 0 || Index >= 7) return ChannelLabels[0];
    return ChannelLabels[Index];
}

const char* QueryForceFieldContributionUnit(int Contribution) noexcept
{
    if (Contribution == ForceFieldContributionAccelerate) return "m/s²";
    if (Contribution == ForceFieldContributionDamp) return "1/s";
    return "m/s";
}

const char* QueryForceFieldReachName(int Reach) noexcept
{
    if (Reach == ForceFieldReachColumn) return "Column";
    if (Reach == ForceFieldReachBox) return "Box";
    return "Sphere";
}

const char* QueryForceFieldFalloffLabel(int Falloff) noexcept
{
    if (Falloff == ForceFieldFalloffLinear) return "Linear";
    if (Falloff == ForceFieldFalloffInverseSquare) return "Inverse²";
    if (Falloff == ForceFieldFalloffNone) return "Hard";
    return "Smooth";
}

const char* QueryForceFieldFalloffName(int Falloff) noexcept
{
    if (Falloff == ForceFieldFalloffLinear) return "Linear";
    if (Falloff == ForceFieldFalloffInverseSquare) return "InverseSquare";
    if (Falloff == ForceFieldFalloffNone) return "None";
    return "Smooth";
}

const char* QueryForceFieldActivationName(int Activation) noexcept
{
    if (Activation == ForceFieldActivationWindow) return "Window";
    if (Activation == ForceFieldActivationTrigger) return "Trigger";
    return "Always";
}

const char* QueryForceFieldStatusName(int Status) noexcept
{
    if (Status == 1) return "Waiting";
    if (Status == 2) return "Armed";
    if (Status == 3) return "Off";
    if (Status == 4) return "Spent";
    return "Active";
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    VIEW HELPERS
//------------------------------------------------------------------------------------------------------------------------

int ResolveForceFieldSourceStatus(const ForceFieldWorkspaceSource& Source, double Time) noexcept
{
    if (!Source.Enabled) return 3; // Off.
    if (Source.Activation == ForceFieldActivationAlways) return 0; // Active.
    double Start = Source.Begins;
    if (Source.Activation == ForceFieldActivationTrigger)
    {
        if (Source.TriggeredAt < 0.0) return 2; // Armed.
        Start = Source.TriggeredAt;
    }
    double Local = Time - Start;
    if (Local < 0.0) return 1; // Waiting.
    if (Source.Activation == ForceFieldActivationWindow && Source.Repeats > 0.0 && Source.Lasts > 0.0) Local = std::fmod(Local, Source.Repeats);
    if (Source.Lasts > 0.0 && Local > Source.Lasts)
    {
        return (Source.Activation == ForceFieldActivationWindow && Source.Repeats > 0.0) ? 1 : 4; // Waiting / Spent.
    }
    return 0; // Active (the shell never idles inside a live window).
}

void FormatForceFieldDistance(double Metres, char* Text, size_t TextSize, const char*& Unit) noexcept
{
    if (Text == nullptr || TextSize == 0) return;
    if (Metres >= 1000.0)
    {
        std::snprintf(Text, TextSize, Metres >= 10000.0 ? "%.1f" : "%.2f", Metres / 1000.0);
        Unit = "km";
    }
    else
    {
        std::snprintf(Text, TextSize, Metres < 10.0 ? "%.1f" : "%.0f", Metres);
        Unit = "m";
    }
}

void FormatForceFieldSpan(double Metres, char* Text, size_t TextSize) noexcept
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
            if (End == Dot + 1) --End; // 🧩 Strip a bare ".0" like the visualizer's replace.
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

void FormatForceFieldTrimmed(double Value, int Digits, char* Text, size_t TextSize) noexcept
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

bool QueryForceFieldWorkspaceRect(const ForceFieldWorkspaceState& State, const char* Name, ImVec2& Min, ImVec2& Max) noexcept
{
    if (Name == nullptr) return false;
    const auto Found = State.Rects.find(Name);
    if (Found == State.Rects.end()) return false;
    Min = ImVec2(Found->second.x, Found->second.y);
    Max = ImVec2(Found->second.z, Found->second.w);
    return true;
}

void AppendForceFieldWorkspaceLog(ForceFieldWorkspaceState& State, const char* Channel, const char* Message, const char* Detail, const char* Key)
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
    if (Key != nullptr && !State.Log.empty())
    {
        ForceFieldWorkspaceLogEntry& Last = State.Log.front();
        if (Last.Channel == Channel && Last.Message.rfind(Key, 0) == 0)
        {
            Last.Message = Message;
            Last.Detail  = Detail != nullptr ? Detail : "";
            Last.When    = When;
            return;
        }
    }
    ForceFieldWorkspaceLogEntry Entry{};
    Entry.When    = When;
    Entry.Channel = Channel;
    Entry.Message = Message;
    Entry.Detail  = Detail != nullptr ? Detail : "";
    State.Log.push_front(std::move(Entry));
    while (State.Log.size() > 80) State.Log.pop_back();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    DEFAULT STATE
//------------------------------------------------------------------------------------------------------------------------

namespace
{

void SetWorkspaceParameter(ForceFieldWorkspaceSource& Source, const char* Key, double Value)
{
    const ForceFieldWorkspaceType& Type = QueryForceFieldType(Source.Type);
    for (int Index = 0; Index < Type.ParamCount && Index < 7; ++Index)
    {
        if (Type.Params[Index].Key != nullptr && std::strcmp(Type.Params[Index].Key, Key) == 0)
        {
            Source.Params[Index] = Value;
            return;
        }
    }
}

ForceFieldWorkspaceSource MakeWorkspaceSource(const char* TypeId, const char* Name, double X, double Y, double Z)
{
    const int Type = QueryForceFieldTypeById(TypeId);
    return ConstructLabSource(Type, Name, X, Y, Z);
}

} // namespace

void ApplyForceFieldWorkspacePreset(ForceFieldWorkspaceState& State, int Scenario)
{
    const std::shared_ptr<ForceFieldWorkspaceRuntime> Runtime = State.Runtime;
    const std::string ExportPath = State.ExportPath;
    State = ForceFieldWorkspaceState{};
    State.Runtime = Runtime;
    if (!ExportPath.empty()) State.ExportPath = ExportPath;
    State.ExportPreview.clear();
    State.ExportStatus = "Preset reset; export the current workspace when ready.";
    State.Scenario = std::clamp(Scenario, 0, 3);
    State.ClockTime = 0.0;
    State.ClockPlaying = true;
    State.ClockRate = 1;
    State.TimelineDuration = 60.0;
    State.View.Span = 1400.0;
    State.View.CentreX = 0.0;
    State.View.CentreZ = 0.0;
    State.View.Yaw = 0.7853981633974483;
    State.View.Pitch = 0.62;

    if (State.Scenario == 0)
    {
        ForceFieldWorkspaceSource East = MakeWorkspaceSource("WindGenerator", "Wind Generator East", -330.0, 0.0, 50.0);
        East.Bearing = 66.0;
        East.Params[0] = 18.0;
        East.Radius = 245.0;
        East.Reach = ForceFieldReachColumn;

        ForceFieldWorkspaceSource Vortex = MakeWorkspaceSource("Tornado", "Vortex Column", 55.0, 0.0, -45.0);
        Vortex.Params[0] = 42.0;
        Vortex.Params[1] = 24.0;
        Vortex.Params[2] = 72.0;
        Vortex.Params[3] = 12.0;
        Vortex.Params[4] = 24.0;
        Vortex.Params[6] = 0.0;
        Vortex.Radius = 250.0;

        ForceFieldWorkspaceSource Corridor = MakeWorkspaceSource("Jet", "Jet Corridor", -120.0, 8.0, -280.0);
        Corridor.Bearing = 108.0;
        Corridor.Params[1] = 180.0;
        Corridor.Params[2] = 26.0;
        Corridor.Radius = 210.0;

        ForceFieldWorkspaceSource Attractor = MakeWorkspaceSource("Attractor", "Attractor", 340.0, 10.0, 130.0);
        Attractor.Params[0] = 11.0;
        Attractor.Params[1] = 4.8;
        Attractor.Radius = 210.0;

        ForceFieldWorkspaceSource Repulsor = MakeWorkspaceSource("Repulsor", "Repulsor", 230.0, 10.0, -230.0);
        Repulsor.Params[0] = 12.0;
        Repulsor.Radius = 175.0;

        ForceFieldWorkspaceSource Impulse = MakeWorkspaceSource("Blast", "Impulse Shell", -60.0, 2.0, 260.0);
        Impulse.Params[0] = 36.0;
        Impulse.Radius = 240.0;
        Impulse.Activation = ForceFieldActivationWindow;
        Impulse.Begins = 3.0;
        Impulse.Lasts = 10.0;
        Impulse.Repeats = 24.0;
        State.Sources = {East, Vortex, Corridor, Attractor, Repulsor, Impulse};
        State.Wind.Enabled = false;
    }
    else if (State.Scenario == 1)
    {
        ForceFieldWorkspaceSource West = MakeWorkspaceSource("WindGenerator", "Western Wind Generator", -430.0, 10.0, 0.0);
        West.Bearing = 90.0;
        West.Params[0] = 16.0;
        West.Radius = 320.0;
        West.Height = 220.0;
        ForceFieldWorkspaceSource East = MakeWorkspaceSource("WindGenerator", "Eastern Wind Generator", 430.0, 10.0, 0.0);
        East.Bearing = 270.0;
        East.Params[0] = 14.0;
        East.Radius = 320.0;
        East.Height = 220.0;
        ForceFieldWorkspaceSource Jet = MakeWorkspaceSource("Jet", "Venturi Corridor", 0.0, 10.0, 0.0);
        Jet.Bearing = 90.0;
        Jet.Radius = 520.0;
        Jet.Params[0] = 18.0;
        Jet.Params[1] = 900.0;
        Jet.Params[2] = 40.0;
        ForceFieldWorkspaceSource Current = MakeWorkspaceSource("Current", "Crosswind Channel", 0.0, 10.0, 360.0);
        Current.Bearing = 270.0;
        Current.Radius = 480.0;
        Current.HalfX = 90.0;
        Current.HalfZ = 420.0;
        Current.Params[0] = 7.0;
        State.Sources = {West, East, Jet, Current};
        State.Wind.Enabled = true;
        State.Wind.Bounded = true;
        State.Wind.RegionRadius = 2600.0;
        State.Wind.Bearing = 90.0;
        State.Wind.Speed = 3.5;
        State.View.Span = 2200.0;
    }
    else if (State.Scenario == 2)
    {
        static const char* StormTypes[14] = {"WindGenerator", "Tornado", "Jet", "GustFront", "Microburst", "Thermal", "Puff",
                                             "Blast", "Wake", "Current", "Attractor", "Repulsor", "Lift", "Gravity"};
        for (int Index = 0; Index < 14; ++Index)
        {
            const double Angle = (2.0 * 3.14159265358979323846 * Index) / 14.0;
            const double X = std::cos(Angle) * 1800.0;
            const double Z = std::sin(Angle) * 1800.0;
            const int Type = QueryForceFieldTypeById(StormTypes[Index]);
            char Name[96]{};
            std::snprintf(Name, sizeof(Name), "%s %02d", QueryForceFieldType(Type).Name, Index + 1);
            State.Sources.push_back(ConstructLabSource(Type, Name, X, (Index % 4) * 18.0, Z));
            ForceFieldWorkspaceSource& Source = State.Sources.back();
            Source.Bearing = std::fmod(25.0 + Index * 31.0, 360.0);
            if (std::strcmp(StormTypes[Index], "WindGenerator") == 0)
            {
                Source.Params[0] = 24.0;
                Source.Radius = 1250.0;
                Source.Height = 700.0;
                Source.Bearing = 135.0;
            }
            if (std::strcmp(StormTypes[Index], "Blast") == 0)
            {
                Source.Activation = ForceFieldActivationWindow;
                Source.Begins = 8.0;
                Source.Lasts = 16.0;
                Source.Repeats = 36.0;
            }
        }
        State.Wind.Enabled = true;
        State.Wind.Bounded = false;
        State.Wind.RegionRadius = 50000.0;
        State.Wind.Bearing = 133.0;
        State.Wind.Speed = 22.0;
        State.Wind.GustAmplitude = 8.5;
        State.Wind.GustStrength = 0.37;
        State.Wind.GustFrequency = 0.23;
        State.Wind.Turbulence = 0.62;
        State.Wind.TurbulenceScale = 91.0;
        State.Wind.Shear = 0.28;
        State.Wind.Veer = -12.0;
        State.Wind.MesoscaleStrength = 0.31;
        State.Wind.MesoscaleScale = 32000.0;
        State.Wind.Seed = 9191;
        State.TimelineDuration = 120.0;
        State.View.Span = 100000.0;
    }
    else
    {
        // The build preset is intentionally empty: the library remains available, but no hidden sources or ambient wind
        // are authored until the user adds them.
        State.Sources.clear();
        State.Wind.Enabled = false;
        State.Wind.Bounded = true;
        State.Selected = ForceFieldWorkspaceState::SelectedField;
    }

    State.Selected = State.Sources.empty() ? ForceFieldWorkspaceState::SelectedField : 0;
    State.PlacementType = -1;
    State.View.Solo = -1;
    State.View.Follow = -1;
    State.PeakCount = 0;
    State.WindCount = 0;
    char Detail[96]{};
    std::snprintf(Detail, sizeof(Detail), "%d authored sources · %s ambient wind",
                  static_cast<int>(State.Sources.size()), State.Wind.Enabled ? (State.Wind.Bounded ? "bounded" : "unbounded") : "disabled");
    AppendForceFieldWorkspaceLog(State, "SCENARIO", "Loaded workspace preset", Detail, "Preset");
}

void ConstructForceFieldWorkspaceState(ForceFieldWorkspaceState& State)
{
    ApplyForceFieldWorkspacePreset(State, 0);
    AppendForceFieldWorkspaceLog(State, "WORKSPACE", "Force Field + Wind Workspace ready", "Native field sampling enabled");
}

int AddForceFieldWorkspaceSource(ForceFieldWorkspaceState& State, int Type, double X, double Y, double Z)
{
    if (Type < 0 || Type >= QueryForceFieldTypeCount()) return -1;
    const ForceFieldWorkspaceType& Spec = QueryForceFieldType(Type);
    std::string Name = Spec.Name != nullptr ? Spec.Name : "Force source";
    int Suffix = 2;
    for (;;)
    {
        const bool Used = std::any_of(State.Sources.begin(), State.Sources.end(), [&](const ForceFieldWorkspaceSource& Source)
        { return Source.Name == Name; });
        if (!Used) break;
        Name = std::string(Spec.Name != nullptr ? Spec.Name : "Force source") + " " + std::to_string(Suffix++);
    }
    State.Sources.push_back(ConstructLabSource(Type, Name.c_str(), X, Y, Z));
    State.Selected = static_cast<int>(State.Sources.size()) - 1;
    char Message[128]{};
    std::snprintf(Message, sizeof(Message), "Placed %s", Name.c_str());
    AppendForceFieldWorkspaceLog(State, "PLACE", Message, "Native source added to the workspace", "Place");
    return State.Selected;
}

bool DuplicateForceFieldWorkspaceSource(ForceFieldWorkspaceState& State, int Index)
{
    if (Index < 0 || static_cast<size_t>(Index) >= State.Sources.size()) return false;
    ForceFieldWorkspaceSource Copy = State.Sources[static_cast<size_t>(Index)];
    Copy.Centre[0] += std::max(10.0, Copy.Radius * 0.22);
    Copy.Centre[2] += std::max(10.0, Copy.Radius * 0.22);
    const std::string BaseName = Copy.Name + " Copy";
    Copy.Name = BaseName;
    for (int Suffix = 2; std::any_of(State.Sources.begin(), State.Sources.end(), [&](const ForceFieldWorkspaceSource& Existing)
                                    { return Existing.Name == Copy.Name; }); ++Suffix)
        Copy.Name = BaseName + " " + std::to_string(Suffix);
    State.Sources.push_back(std::move(Copy));
    State.Selected = static_cast<int>(State.Sources.size()) - 1;
    AppendForceFieldWorkspaceLog(State, "FORCES", "Duplicated source", State.Sources.back().Name.c_str());
    return true;
}

bool RemoveForceFieldWorkspaceSource(ForceFieldWorkspaceState& State, int Index)
{
    if (Index < 0 || static_cast<size_t>(Index) >= State.Sources.size()) return false;
    const std::string Removed = State.Sources[static_cast<size_t>(Index)].Name;
    State.Sources.erase(State.Sources.begin() + Index);
    if (State.Sources.empty()) State.Selected = ForceFieldWorkspaceState::SelectedField;
    else if (State.Selected == Index) State.Selected = std::min(Index, static_cast<int>(State.Sources.size()) - 1);
    else if (State.Selected > Index) --State.Selected;
    if (State.View.Solo == Index) State.View.Solo = -1;
    else if (State.View.Solo > Index) --State.View.Solo;
    if (State.View.Follow == Index) State.View.Follow = -1;
    else if (State.View.Follow > Index) --State.View.Follow;
    AppendForceFieldWorkspaceLog(State, "FORCES", "Removed source", Removed.c_str());
    return true;
}

bool FireForceFieldWorkspaceSource(ForceFieldWorkspaceState& State, int Index)
{
    if (Index < 0 || static_cast<size_t>(Index) >= State.Sources.size()) return false;
    ForceFieldWorkspaceSource& Source = State.Sources[static_cast<size_t>(Index)];
    Source.Activation = ForceFieldActivationTrigger;
    Source.TriggeredAt = std::max(0.0, State.ClockTime);
    State.ClockPlaying = true;
    char Message[128]{};
    std::snprintf(Message, sizeof(Message), "Fired %s", Source.Name.c_str());
    AppendForceFieldWorkspaceLog(State, "TRIGGER", Message, "Timeline envelope started", "Fire");
    return true;
}

} // namespace Frontier
