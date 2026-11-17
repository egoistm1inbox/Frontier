/*==========================================================================================================================================
                                                      PHOTOMETRICWORKSPACECATALOGUE.CPP
==========================================================================================================================================*/
// 🧩 Pinned photometric catalogues (7 light specs, 6 moons, 7 measured LM-63 profiles, 8 analytical presets, the
//    8-luminaire rig seeds) plus the shell-local closed-form estimators: luminous flux, active-lumen census, wall
//    illuminance, lunar phase metrics, and the Spencer solar ephemeris. Deterministic in the staged rig; no engine
//    calls.

#include "Frontier/Engine/Interface/Workspaces/PhotometricWorkspace.h"
#include "Frontier/Engine/Interface/Controls/Toast.h"
#include "Frontier/Engine/Interface/Workspaces/PhotometricIesFileDialog.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace Frontier
{
namespace
{

const PhotometricLightSpec LightSpecs[] = {
    { "pointlight", "Point Light", "Point", "cd", 0xFFD9A0FF },
    { "spotlight", "Spot Light", "Spot", "cd", 0xE8F0FFFF },
    { "ieslight", "IES Photometric", "IES", "lm", 0xE8C27AFF },
    { "arealight", "Area / Softbox", "Area", "lm", 0xFFF1D6FF },
    { "tubelight", "Tube Light", "Tube", "lm", 0xBFE3FFFF },
    { "ledlight", "LED Emitter", "LED", "lm", 0xD8EF9FFF },
    { "ledstrip", "LED Strip", "Strip", "lm", 0xFFCF99FF },
};

const PhotometricMoonSpec Moons[] = {
    { "Luna", "Luna", "Silicate highlands & maria albedo 0.12", 0xDCE2ECFF },
    { "Ember", "Ember", "Basalt magma crust · warm volcanic scatter", 0xF0B08AFF },
    { "Glacier", "Glacier", "Europa lineated water-ice albedo 0.67", 0xDCEBF7FF },
    { "Sulfur", "Sulfur", "Io sulfuric caldera plumes · high frost reflectance", 0xECE188FF },
    { "Shroud", "Shroud", "Titan nitrogen-methane dense haze limb", 0xE5BC82FF },
    { "Shard", "Shard", "Fractured carbonaceous chondrite moonlet", 0xA7AAB0FF },
};

const char* MeasuredIes[] = { "LowBeam", "HighBeam", "FogBeam", "Roadway", "Area", "RoofFlood", "RoofSpot" };
const char* PresetIes[]   = { "Downlight", "Wall wash", "Batwing", "ECE Low Beam",
                              "SAE Low Beam", "High Beam", "Fog Lamp", "Parking Lamp" };

const PhotometricLightSeed Seeds[] = {
    { "light-ece-low-beam", "ECE Low Beam", 2, true },
    { "light-key-spot", "Key Spot", 1, true },
    { "light-ies-downlight", "IES Architectural Downlight", 2, true },
    { "light-rim-point", "Rim Point", 0, true },
    { "light-softbox", "Studio Softbox", 3, true },
    { "light-studio-tube", "Studio Tube", 4, false },
    { "light-led-cob", "LED COB Module", 5, false },
    { "light-led-strip", "Baseboard LED Strip", 6, true },
};

void SetVec3(double V[3], double X, double Y, double Z) noexcept
{
    V[0] = X;
    V[1] = Y;
    V[2] = Z;
}

void SetHex(PhotometricLightProps& P, const char* Hex) noexcept
{
    std::snprintf(P.ColorHex, sizeof(P.ColorHex), "%s", Hex);
}

} // namespace

int QueryPhotometricLightSpecCount() noexcept
{
    return 7;
}

const PhotometricLightSpec& QueryPhotometricLightSpec(int Index) noexcept
{
    return LightSpecs[Index < 0 || Index >= 7 ? 0 : Index];
}

int QueryPhotometricLightSpecById(const char* Id) noexcept
{
    if (Id == nullptr) return -1;
    for (int I = 0; I < 7; ++I)
        if (std::strcmp(LightSpecs[I].Id, Id) == 0) return I;
    return -1;
}

int QueryPhotometricMoonCount() noexcept
{
    return 6;
}

const PhotometricMoonSpec& QueryPhotometricMoon(int Index) noexcept
{
    return Moons[Index < 0 || Index >= 6 ? 0 : Index];
}

int QueryPhotometricMeasuredIesCount() noexcept
{
    return 7;
}

const char* QueryPhotometricMeasuredIes(int Index) noexcept
{
    return MeasuredIes[Index < 0 || Index >= 7 ? 0 : Index];
}

int QueryPhotometricPresetIesCount() noexcept
{
    return 8;
}

const char* QueryPhotometricPresetIes(int Index) noexcept
{
    return PresetIes[Index < 0 || Index >= 8 ? 0 : Index];
}

int QueryPhotometricLightSeedCount() noexcept
{
    return 8;
}

const PhotometricLightSeed& QueryPhotometricLightSeed(int Index) noexcept
{
    return Seeds[Index < 0 || Index >= 8 ? 0 : Index];
}

PhotometricLightProps QueryPhotometricLightSeedProps(int Index) noexcept
{
    PhotometricLightProps P;
    switch (Index < 0 || Index >= 8 ? 0 : Index)
    {
    case 0:
        SetVec3(P.Position, -1.15, 0.88, 3.6);
        SetVec3(P.Target, -0.35, 0.25, -4.5);
        P.HasTarget = true;
        SetVec3(P.Rotation, -6.0, -8.0, 0.0);
        P.PresetProfile = 3;
        P.MeasuredProfile = 0;
        P.UseMeasuredIes = true;
        P.Lumens = 1650.0;
        P.Multiplier = 1.0;
        P.Range = 120.0;
        P.Cone = 58.0;
        P.Cutoff = -1.0;
        SetHex(P, "#FFF2CF");
        P.Temperature = 4300.0;
        P.Shadows = true;
        break;
    case 1:
        SetVec3(P.Position, -3.2, 4.6, 3.4);
        SetVec3(P.Target, 0.0, 0.7, -0.5);
        P.HasTarget = true;
        SetVec3(P.Rotation, -42.0, 40.0, 0.0);
        P.Intensity = 88.0;
        P.Angle = 30.0;
        P.Penumbra = 0.42;
        P.Distance = 32.0;
        SetHex(P, "#E8F0FF");
        P.Shadows = true;
        break;
    case 2:
        SetVec3(P.Position, 1.6, 4.1, -1.8);
        SetVec3(P.Target, 1.6, 0.0, -1.8);
        P.HasTarget = true;
        SetVec3(P.Rotation, -90.0, 0.0, 0.0);
        P.PresetProfile = 2;
        P.MeasuredProfile = 4;
        P.UseMeasuredIes = false;
        P.Lumens = 2200.0;
        P.Multiplier = 1.15;
        P.Range = 36.0;
        P.Cone = 68.0;
        P.Cutoff = 0.0;
        SetHex(P, "#FFF4DF");
        P.Temperature = 3500.0;
        P.Shadows = true;
        break;
    case 3:
        SetVec3(P.Position, 3.4, 2.2, -2.6);
        P.Intensity = 24.0;
        P.Distance = 26.0;
        P.Decay = 2.0;
        SetHex(P, "#FFD9A0");
        P.Shadows = false;
        break;
    case 4:
        SetVec3(P.Position, 2.8, 3.1, 2.2);
        SetVec3(P.Target, 0.0, 0.8, 0.0);
        P.HasTarget = true;
        SetVec3(P.Rotation, -32.0, -38.0, 0.0);
        P.Aperture = 0;
        P.Width = 2.0;
        P.Height = 1.0;
        P.Lumens = 2400.0;
        P.Spread = 120.0;
        SetHex(P, "#FFF1D6");
        P.TwoSided = false;
        P.Shadows = false;
        break;
    case 5:
        SetVec3(P.Position, -2.4, 2.5, -1.2);
        SetVec3(P.Rotation, 0.0, 18.0, 0.0);
        P.Length = 1.8;
        P.Radius = 0.04;
        P.Lumens = 1800.0;
        P.Distance = 24.0;
        SetHex(P, "#E8F2FF");
        P.Temperature = 5600.0;
        P.Shadows = false;
        break;
    case 6:
        SetVec3(P.Position, 0.0, 3.3, 1.4);
        SetVec3(P.Rotation, -75.0, 0.0, 0.0);
        P.Watts = 18.0;
        P.Efficacy = 125.0;
        P.Dimmer = 1.0;
        P.Diameter = 40.0;
        P.Angle = 110.0;
        SetHex(P, "#FFFFFF");
        P.Temperature = 4000.0;
        P.Shadows = true;
        break;
    default:
        SetVec3(P.Position, 0.0, 0.14, -4.8);
        P.Length = 3.6;
        P.LumensPerMetre = 1000.0;
        P.WattsPerMetre = 14.4;
        P.LedsPerMetre = 60.0;
        P.Voltage = 24.0;
        P.Dimmer = 0.9;
        P.Diffuser = true;
        SetHex(P, "#FFDCB4");
        P.Temperature = 3000.0;
        P.Shadows = false;
        break;
    }
    return P;
}

double QueryPhotometricFlux(int Type, const PhotometricLightProps& Props) noexcept
{
    if (Type == 5) return Props.Watts * Props.Efficacy * Props.Dimmer > 0.0 ? Props.Watts * Props.Efficacy * Props.Dimmer : 0.0;
    if (Type == 6)
    {
        const double Flux = Props.LumensPerMetre * Props.Length * Props.Dimmer;
        return Flux > 0.0 ? Flux : 0.0;
    }
    if (Type == 0 || Type == 1) return Props.Intensity > 0.0 ? Props.Intensity : 0.0;
    return Props.Lumens > 0.0 ? Props.Lumens : 0.0;
}

double QueryPhotometricCensusLumens(const PhotometricLight* Lights, int Count) noexcept
{
    if (Lights == nullptr) return 0.0;
    double Total = 0.0;
    for (int I = 0; I < Count; ++I)
    {
        if (!Lights[I].Visible) continue;
        if (Lights[I].Type == 0 || Lights[I].Type == 1)
            Total += QueryPhotometricFlux(Lights[I].Type, Lights[I].Props) * 12.5;
        else Total += QueryPhotometricFlux(Lights[I].Type, Lights[I].Props) * Lights[I].Props.Multiplier;
    }
    return Total;
}

double QueryPhotometricWallLux(const PhotometricLight* Lights, int Count, const PhotometricIesProfile* ImportedProfiles,
                              int ImportedProfileCount) noexcept
{
    // 🧩 Reference probe: (0, 1.4, -5.25). Bundled profile names retain their authored screen-gain estimates;
    // imported Type-C files instead sample the measured candela atlas in the emitter's local photometric frame.
    if (Lights == nullptr) return 0.0;
    static const double MeasuredGain[7] = { 0.30, 0.42, 0.65, 0.38, 0.85, 1.00, 1.45 };
    static const double PresetGain[8]   = { 1.10, 0.55, 0.75, 0.30, 0.95, 1.25, 0.60, 0.90 };
    constexpr double Pi = 3.14159265358979323846;
    double Lux = 0.0;
    for (int I = 0; I < Count; ++I)
    {
        if (!Lights[I].Visible) continue;
        const PhotometricLightProps& Props = Lights[I].Props;
        const double Dx = 0.0 - Props.Position[0];
        const double Dy = 1.4 - Props.Position[1];
        const double Dz = -5.25 - Props.Position[2];
        double R2 = Dx * Dx + Dy * Dy + Dz * Dz;
        if (R2 < 0.25) R2 = 0.25;
        double Intensity = 0.0;
        if (Lights[I].Type == 2)
        {
            const int ImportedIndex = Props.UseMeasuredIes ? Props.CustomIesProfile : -1;
            if (ImportedProfiles != nullptr && ImportedIndex >= 0 && ImportedIndex < ImportedProfileCount)
            {
                const PhotometricIesProfile& Profile = ImportedProfiles[ImportedIndex];
                double Forward[3] = { 0.0, 0.0, -1.0 };
                if (Props.HasTarget)
                {
                    Forward[0] = Props.Target[0] - Props.Position[0];
                    Forward[1] = Props.Target[1] - Props.Position[1];
                    Forward[2] = Props.Target[2] - Props.Position[2];
                }
                const auto Normalize = [](double V[3])
                {
                    const double Length = std::sqrt(V[0] * V[0] + V[1] * V[1] + V[2] * V[2]);
                    if (!(Length > 1.0e-12)) return false;
                    V[0] /= Length; V[1] /= Length; V[2] /= Length;
                    return true;
                };
                if (!Normalize(Forward)) { Forward[0] = 0.0; Forward[1] = 0.0; Forward[2] = -1.0; }
                double Direction[3] = { Dx, Dy, Dz };
                if (!Normalize(Direction))
                {
                    Direction[0] = Forward[0];
                    Direction[1] = Forward[1];
                    Direction[2] = Forward[2];
                }
                // World-up is +Y, so forward × world-up is (-Fz, 0, Fx); this is orthogonal to the beam.
                double Right[3] = { -Forward[2], 0.0, Forward[0] };
                if (!Normalize(Right)) { Right[0] = 1.0; Right[1] = 0.0; Right[2] = 0.0; }
                double LocalUp[3] = { Right[1] * Forward[2] - Right[2] * Forward[1],
                                      Right[2] * Forward[0] - Right[0] * Forward[2],
                                      Right[0] * Forward[1] - Right[1] * Forward[0] };
                if (!Normalize(LocalUp)) { LocalUp[0] = 0.0; LocalUp[1] = 1.0; LocalUp[2] = 0.0; }
                const double CosPolar = std::clamp(Direction[0] * Forward[0] + Direction[1] * Forward[1] +
                                                   Direction[2] * Forward[2], -1.0, 1.0);
                const double PolarDeg = std::acos(CosPolar) * 180.0 / Pi;
                const double AzimuthDeg = std::atan2(Direction[0] * Right[0] + Direction[1] * Right[1] +
                                                     Direction[2] * Right[2],
                                                     Direction[0] * LocalUp[0] + Direction[1] * LocalUp[1] +
                                                     Direction[2] * LocalUp[2]) * 180.0 / Pi;
                double FluxScale = 1.0;
                if (Profile.LumensPerLamp > 0.0 && Profile.NumberOfLamps > 0)
                {
                    const double RatedLumens = Profile.LumensPerLamp * Profile.NumberOfLamps;
                    if (RatedLumens > 1.0e-9) FluxScale = Props.Lumens / RatedLumens;
                }
                Intensity = Profile.PeakCandela * SamplePhotometricIes(Profile, AzimuthDeg, PolarDeg) *
                            FluxScale * Props.Multiplier;
            }
            else
            {
                const int Profile = Props.UseMeasuredIes ? Props.MeasuredProfile : Props.PresetProfile;
                const double Gain = Props.UseMeasuredIes
                                        ? MeasuredGain[Profile < 0 || Profile >= 7 ? 0 : Profile]
                                        : PresetGain[Profile < 0 || Profile >= 8 ? 0 : Profile];
                Intensity = Props.Lumens * Props.Multiplier * 0.25 * (Gain + 0.05);
            }
        }
        else if (Lights[I].Type == 1) Intensity = Props.Intensity * 1.4;
        else if (Lights[I].Type == 0) Intensity = Props.Intensity * 0.1;
        else if (Lights[I].Type == 3 || Lights[I].Type == 4) Intensity = Props.Lumens * 0.1;
        else Intensity = 500.0 * 0.1;
        Lux += Intensity / R2;
    }
    return Lux;
}

namespace
{

constexpr double Pi = 3.14159265358979323846;
constexpr int    DaysBeforeMonth[13] = { 0, 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334 };

} // namespace

void EvaluatePhotometricSun(const PhotometricSunProps& Props, PhotometricSunSolved& Solved) noexcept
{
    const int    Month     = Props.Month < 1 ? 1 : (Props.Month > 12 ? 12 : Props.Month);
    const int    Day       = Props.Day < 1 ? 1 : (Props.Day > 31 ? 31 : Props.Day);
    const int    DayOfYear = DaysBeforeMonth[Month] + Day;
    const double Gamma     = (2.0 * Pi / 365.0) * (DayOfYear - 1 + (Props.LocalHours - 12.0) / 24.0);
    const double EoT = 229.18 * (0.000075 + 0.001868 * std::cos(Gamma) - 0.032077 * std::sin(Gamma) -
                                 0.014615 * std::cos(2 * Gamma) - 0.040849 * std::sin(2 * Gamma));
    const double Dec = 0.006918 - 0.399912 * std::cos(Gamma) + 0.070257 * std::sin(Gamma) - 0.006758 * std::cos(2 * Gamma) +
                       0.000907 * std::sin(2 * Gamma) - 0.002697 * std::cos(3 * Gamma) + 0.00148 * std::sin(3 * Gamma);
    const double LatRad  = Props.Latitude * Pi / 180.0;
    const double HourRad = ((Props.LocalHours + EoT / 60.0 - 12.0) * 15.0 * Pi) / 180.0;
    double       SinEl   = std::sin(LatRad) * std::sin(Dec) + std::cos(LatRad) * std::cos(Dec) * std::cos(HourRad);
    SinEl                = SinEl < -1.0 ? -1.0 : (SinEl > 1.0 ? 1.0 : SinEl);
    const double ElRad   = std::asin(SinEl);
    Solved.ElevationDeg  = ElRad * 180.0 / Pi;
    const double CosEl  = std::cos(ElRad) < 1e-5 ? 1e-5 : std::cos(ElRad);
    const double CosLat = std::cos(LatRad) < 1e-5 ? 1e-5 : std::cos(LatRad);
    const double SinAz  = (-std::cos(Dec) * std::sin(HourRad)) / CosEl;
    const double CosAz  = (std::sin(Dec) - std::sin(LatRad) * SinEl) / (CosLat * CosEl);
    double       AzRad  = std::atan2(SinAz, CosAz);
    if (AzRad < 0) AzRad += 2.0 * Pi;
    Solved.AzimuthDeg = AzRad * 180.0 / Pi;
}

void SolvePhotometricMoon(const PhotometricMoon& Moon, PhotometricMoonMetrics& Metrics) noexcept
{
    double Frac = Moon.PhaseDays / 29.53;
    if (Frac < 0.0) Frac = 0.0;
    if (Frac > 1.0) Frac = 1.0;
    Metrics.PhaseFraction  = Frac;
    Metrics.IlluminationPct = 50.0 * (1.0 - std::cos(2.0 * Pi * Frac));
    const char* Label = "Full moon";
    if (Frac < 0.04 || Frac > 0.96) Label = "New moon";
    else if (Frac < 0.21) Label = "Waxing crescent";
    else if (Frac < 0.29) Label = "First quarter";
    else if (Frac < 0.46) Label = "Waxing gibbous";
    else if (Frac < 0.54) Label = "Full moon";
    else if (Frac < 0.71) Label = "Waning gibbous";
    else if (Frac < 0.79) Label = "Last quarter";
    else Label = "Waning crescent";
    std::snprintf(Metrics.PhaseLabel, sizeof(Metrics.PhaseLabel), "%s", Label);
}

void ConstructPhotometricWorkspaceState(PhotometricWorkspaceState& State)
{
    for (int I = 0; I < PhotometricWorkspaceState::CardCount; ++I) State.OpenCards[I] = true;
    for (int I = 0; I < 8; ++I)
    {
        const PhotometricLightSeed& Seed = QueryPhotometricLightSeed(I);
        PhotometricLight&           Dst  = State.Lights[I];
        Dst.Name    = Seed.Name;
        Dst.Type    = Seed.Type;
        Dst.Visible = Seed.Visible;
        Dst.Locked  = false;
        Dst.Props   = QueryPhotometricLightSeedProps(I);
    }
    // 📝 The reference boots the default rig (6/8 visible, 14:30 site time) with the roadway tab merely
    //    highlighted; scenarios apply only when their tabs are clicked.
    State.Sun   = PhotometricSunProps{};
    State.Dome  = PhotometricEnvDome{};
    State.Moon  = PhotometricMoon{};
    State.Stars = PhotometricStars{};
    State.Flare = PhotometricLensFlare{};
    State.Fog   = PhotometricFog{};
    State.Post  = PhotometricPost{};
    State.Scenario     = PhotometricWorkspaceState::ScenarioRoadway;
    State.Selected     = PhotometricWorkspaceState::SelectedLight0;
    State.Lens         = PhotometricWorkspaceState::LensPbr;
    State.Camera       = PhotometricWorkspaceState::CameraOrbit;
    State.DarkRoom     = true;
    State.ShowGizmos   = true;
    State.SweepPlaying = false;
    State.ConsoleOpen  = false;
    State.MatrixOpen   = false;
    State.AddDrawerOpen = false;
    State.SearchQuery.clear();
    State.LoadedIesProfiles.clear();
    State.LoadIesPopupRequested = false;
    State.LoadIesPath[0] = '\0';
    State.LoadIesError.clear();
    State.NoopCount           = 0;
    State.ExportIesNoopRaised = false;
    State.ExportRigNoopRaised = false;
    EvaluatePhotometricSun(State.Sun, State.SunSolved);
    State.Log.clear();
    AppendPhotometricWorkspaceLog(State, "RIG", "Photometric studio ready · 8 luminaires · 7 environment lights");
}

bool LoadPhotometricWorkspaceIes(PhotometricWorkspaceState& State, const std::string& Utf8Path, std::string& Error)
{
    Error.clear();
    if (Utf8Path.empty())
    {
        Error = "Choose an .ies file to import.";
        return false;
    }
    int Target = State.Selected >= 0 && State.Selected < 8 && State.Lights[State.Selected].Type == 2
                    ? State.Selected
                    : -1;
    if (Target < 0)
        for (int Index = 0; Index < 8; ++Index)
            if (State.Lights[Index].Type == 2) { Target = Index; break; }
    if (Target < 0)
    {
        Error = "This workspace has no IES luminaire to receive the imported profile.";
        State.LoadIesError = Error;
        Toast::Show(Error.c_str());
        return false;
    }

    PhotometricIesProfile Imported;
    const std::filesystem::path Path = std::filesystem::u8path(Utf8Path);
    if (!LoadPhotometricIesFile(Path, Imported, Error))
    {
        State.LoadIesError = Error;
        Toast::Show(Error.c_str());
        char Message[256]{};
        std::snprintf(Message, sizeof(Message), "Import rejected · %s", Error.c_str());
        AppendPhotometricWorkspaceLog(State, "IES", Message);
        return false;
    }

    State.LoadedIesProfiles.push_back(std::move(Imported));
    PhotometricLightProps& Props = State.Lights[Target].Props;
    Props.UseMeasuredIes = true;
    Props.CustomIesProfile = static_cast<int>(State.LoadedIesProfiles.size()) - 1;
    State.LoadIesError.clear();
    char Message[192]{};
    std::snprintf(Message, sizeof(Message), "Imported Type-C LM-63 profile · %s → %s",
                  State.LoadedIesProfiles.back().Name.c_str(), State.Lights[Target].Name.c_str());
    AppendPhotometricWorkspaceLog(State, "IES", Message);
    SelectPhotometricWorkspaceNode(State, Target);
    Toast::Show("LM-63 Type-C profile imported");
    return true;
}

void AppendPhotometricWorkspaceLog(PhotometricWorkspaceState& State, const char* Channel, const char* Message)
{
    PhotometricWorkspaceLogEntry Entry;
    Entry.Channel = Channel ? Channel : "";
    Entry.Message = Message ? Message : "";
    State.Log.push_front(std::move(Entry));
    while (State.Log.size() > 64) State.Log.pop_back();
}

void NoopPhotometricWorkspaceCommand(PhotometricWorkspaceState& State, const char* Channel, const char* Message,
                                     const char* ToastText)
{
    Toast::Show(ToastText);
    ++State.NoopCount;
    char Line[256]{};
    std::snprintf(Line, sizeof(Line), "%s · explicit NOOP", Message);
    AppendPhotometricWorkspaceLog(State, Channel, Line);
    if (std::strcmp(Channel, "EXPORT") == 0)
    {
        if (std::strstr(Message, ".ies") != nullptr) State.ExportIesNoopRaised = true;
        else State.ExportRigNoopRaised = true;
    }
}

void LogPhotometricWorkspaceValue(PhotometricWorkspaceState& State, const char* Channel, const char* Label,
                                  const char* Shown)
{
    char Message[192]{};
    std::snprintf(Message, sizeof(Message), "%s → %s", Label, Shown);
    AppendPhotometricWorkspaceLog(State, Channel, Message);
}

void SelectPhotometricWorkspaceNode(PhotometricWorkspaceState& State, int Selection) noexcept
{
    State.Selected = Selection; // 🧩 Silent: selection is local view state.
}

void ApplyPhotometricScenario(PhotometricWorkspaceState& State, int Scenario)
{
    State.Scenario = Scenario;
    for (int I = 0; I < 8; ++I)
    {
        const PhotometricLightSeed& Seed = QueryPhotometricLightSeed(I);
        State.Lights[I].Name    = Seed.Name;
        State.Lights[I].Type    = Seed.Type;
        State.Lights[I].Visible = Seed.Visible;
        State.Lights[I].Locked  = false;
        State.Lights[I].Props   = QueryPhotometricLightSeedProps(I);
    }
    State.Sun   = PhotometricSunProps{};
    State.Dome  = PhotometricEnvDome{};
    State.Moon  = PhotometricMoon{};
    State.Stars = PhotometricStars{};
    State.Flare = PhotometricLensFlare{};
    State.Fog   = PhotometricFog{};
    State.Post  = PhotometricPost{};
    static const char* Names[4] = { "roadway", "gallery", "studio", "lunar" };
    if (Scenario == PhotometricWorkspaceState::ScenarioRoadway)
    {
        State.Sun.LocalHours = 21.2;
        State.Dome.SkylightIntensity = 0.25;
        const bool Keep[8] = { true, false, false, true, false, false, false, true };
        for (int I = 0; I < 8; ++I) State.Lights[I].Visible = Keep[I];
        State.Selected = 0;
        State.Camera   = PhotometricWorkspaceState::CameraRoadway;
    }
    else if (Scenario == PhotometricWorkspaceState::ScenarioGallery)
    {
        State.Sun.LocalHours = 15.0;
        State.Dome.SkylightIntensity = 0.72;
        const bool Keep[8] = { false, true, true, false, true, false, false, false };
        for (int I = 0; I < 8; ++I) State.Lights[I].Visible = Keep[I];
        State.Selected = 2;
        State.Camera   = PhotometricWorkspaceState::CameraOrbit;
    }
    else if (Scenario == PhotometricWorkspaceState::ScenarioStudio)
    {
        State.Sun.LocalHours = 12.0;
        State.Sun.Enabled    = false;
        State.Dome.SkylightIntensity = 0.45;
        const bool Keep[8] = { false, false, false, false, true, true, true, true };
        for (int I = 0; I < 8; ++I) State.Lights[I].Visible = Keep[I];
        State.Selected = 4;
        State.Camera   = PhotometricWorkspaceState::CameraOrbit;
    }
    else
    {
        State.Sun.LocalHours = 23.0;
        State.Dome.SkylightIntensity = 0.18;
        State.Moon.Visible    = true;
        State.Moon.Brightness = 2.6;
        State.Stars.Visible   = true;
        State.Fog.Enabled     = true;
        State.Fog.Density     = 0.012;
        const bool Keep[8] = { false, true, false, true, false, false, false, false };
        for (int I = 0; I < 8; ++I) State.Lights[I].Visible = Keep[I];
        State.Selected = PhotometricWorkspaceState::SelectedMoon;
        State.Camera   = PhotometricWorkspaceState::CameraOrbit;
    }
    EvaluatePhotometricSun(State.Sun, State.SunSolved);
    char Message[96]{};
    std::snprintf(Message, sizeof(Message), "Activated lighting scenario \"%s\"",
                  Names[Scenario < 0 || Scenario > 3 ? 0 : Scenario]);
    AppendPhotometricWorkspaceLog(State, "RIG", Message);
}

void RecordPhotometricWorkspaceRect(PhotometricWorkspaceState& State, const char* Name, ImVec2 Min, ImVec2 Max)
{
    State.Rects[Name] = ImVec4(Min.x, Min.y, Max.x, Max.y);
}

bool QueryPhotometricWorkspaceRect(const PhotometricWorkspaceState& State, const char* Name, ImVec2& Min,
                                   ImVec2& Max) noexcept
{
    const auto It = State.Rects.find(Name ? Name : "");
    if (It == State.Rects.end()) return false;
    Min = ImVec2(It->second.x, It->second.y);
    Max = ImVec2(It->second.z, It->second.w);
    return true;
}

} // namespace Frontier
