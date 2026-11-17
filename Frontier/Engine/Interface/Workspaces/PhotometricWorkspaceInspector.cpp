/*==========================================================================================================================================
                                                       PHOTOMETRICWORKSPACEINSPECTOR.CPP
==========================================================================================================================================*/
// 🧩 The Photometric Workspace inspector: the staged-entity header (rename, subtitle, duplicate/delete keys) and the
//    Project Zero pages from the prototype's PhotometricEditor.js — light preview hero + readings rail, Scene
//    participation, per-type Source/Driver/Output, analytical response curve, per-type Optics, Transform, plus the 7
//    environment pages (IBL dome, sun, moon catalogue, stars, lens flare, atmosphere/fog, post). Value controls edit
//    the shell-local rig copies and log keyed PARAM lines. Duplicate, delete, and the IES/preset profile picks that
//    reach the filesystem stay explicit NOOPs; matrix profile assignment is a staged value.

#include "Engine/Interface/Workspaces/PhotometricWorkspace.h"

#include "Engine/Interface/Controls/ActionRow.h"
#include "Engine/Interface/Controls/AxisFields.h"
#include "Engine/Interface/Controls/CaptionText.h"
#include "Engine/Interface/Controls/ChoiceRow.h"
#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/DiagramCanvas.h"
#include "Engine/Interface/Controls/SectionCard.h"
#include "Engine/Interface/Controls/SelectPill.h"
#include "Engine/Interface/Controls/SliderPill.h"
#include "Engine/Interface/Controls/SwitchPill.h"
#include "Engine/Interface/Controls/TextRow.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

namespace Frontier
{
namespace
{

void LogSliderValue(PhotometricWorkspaceState& State, const char* Channel, const char* Label, double Value, int Digits,
                    const char* Unit)
{
    char Shown[64]{};
    if (Unit != nullptr && Unit[0] != '\0') std::snprintf(Shown, sizeof(Shown), "%.*f %s", Digits, Value, Unit);
    else std::snprintf(Shown, sizeof(Shown), "%.*f", Digits, Value);
    LogPhotometricWorkspaceValue(State, Channel, Label, Shown);
}

bool ConstructParamSlider(PhotometricWorkspaceState& State, ControlColumn& Column, const char* Channel, const char* Id,
                          const char* Label, double& Value, double Minimum, double Maximum, double Step,
                          const char* Unit, int Digits)
{
    if (!SliderPill::Construct(Column, Id, Label, Value, Minimum, Maximum, Step, Unit)) return false;
    LogSliderValue(State, Channel, Label, Value, Digits, Unit);
    return true;
}

bool ConstructParamStepped(PhotometricWorkspaceState& State, ControlColumn& Column, const char* Channel, const char* Id,
                           const char* Label, int& Value, double Minimum, double Maximum, double Step)
{
    double Shown = static_cast<double>(Value);
    if (!SliderPill::Construct(Column, Id, Label, Shown, Minimum, Maximum, Step, "")) return false;
    Value = static_cast<int>(std::round(Shown));
    LogSliderValue(State, Channel, Label, static_cast<double>(Value), 0, "");
    return true;
}

bool ConstructParamToggle(PhotometricWorkspaceState& State, ControlColumn& Column, const char* Channel, const char* Id,
                          const char* Label, const char* Detail, bool& Value)
{
    if (!SwitchPill::Construct(Column, Id, Label, Detail, Value)) return false;
    LogPhotometricWorkspaceValue(State, Channel, Label, Value ? "on" : "off");
    return true;
}

bool ConstructParamSelect(PhotometricWorkspaceState& State, ControlColumn& Column, const char* Channel, const char* Id,
                          const char* Label, int& Index, const char* const* Names, int Count)
{
    if (!SelectPill::Construct(Column, Id, Label, Names, Count, Index)) return false;
    LogPhotometricWorkspaceValue(State, Channel, Label, Names[Index]);
    return true;
}

void ConstructCaption(ControlColumn& Column, const char* Text)
{
    CaptionText::Construct(Column, Text);
}

void FormatGrouped(double Value, char* Text, size_t Size) noexcept
{
    const long long Whole = static_cast<long long>(Value);
    char            Raw[32]{};
    std::snprintf(Raw, sizeof(Raw), "%lld", Whole);
    const size_t Len = std::strlen(Raw);
    char         Out[40]{};
    size_t       O = 0;
    for (size_t I = 0; I < Len && O + 2 < sizeof(Out); ++I)
    {
        Out[O++] = Raw[I];
        const size_t Left = Len - I - 1;
        if (Left > 0 && Left % 3 == 0) Out[O++] = ',';
    }
    Out[O] = '\0';
    std::snprintf(Text, Size, "%s", Out);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 ENTITY HEADER
//------------------------------------------------------------------------------------------------------------------------

void ConstructEntityHeader(PhotometricWorkspaceState& State, ControlColumn& Column)
{
    if (State.Selected >= 0 && State.Selected < 8)
    {
        PhotometricLight& Light = State.Lights[State.Selected];
        if (TextRow::Construct(Column, "EntityName", "Name", Light.Name))
            LogPhotometricWorkspaceValue(State, "PARAM", "Rename", Light.Name.c_str());
        char Sub[96]{};
        std::snprintf(Sub, sizeof(Sub), "%s · PROJECT ZERO PHOTOMETRY", QueryPhotometricLightSpec(Light.Type).Label);
        for (char* C = Sub; *C != '\0'; ++C)
            if (*C >= 'a' && *C <= 'z') *C = static_cast<char>(*C - 'a' + 'A');
        ConstructCaption(Column, Sub);
        static const ActionItem Keys[2] = {
            { "Duplicate", "StudioPlus", ActionTone::Default },
            { "Delete", "StudioClose", ActionTone::Danger },
        };
        ImVec4 KeyRects[2]{};
        const int Fired = ActionRow::Construct(Column, "EntityKeys", Keys, 2, true, nullptr,
                                               ActionRowVoice::Charcoal, KeyRects);
        RecordPhotometricWorkspaceRect(State, "Inspector/Duplicate", ImVec2(KeyRects[0].x, KeyRects[0].y),
                                       ImVec2(KeyRects[0].z, KeyRects[0].w));
        RecordPhotometricWorkspaceRect(State, "Inspector/Delete", ImVec2(KeyRects[1].x, KeyRects[1].y),
                                       ImVec2(KeyRects[1].z, KeyRects[1].w));
        if (Fired == 0)
            NoopPhotometricWorkspaceCommand(State, "DUP", "Duplicate refused", "Duplicating lights is a NOOP in this shell");
        else if (Fired == 1)
            NoopPhotometricWorkspaceCommand(State, "DEL", "Delete refused", "Deleting lights is a NOOP in this shell");
    }
    else
    {
        static const char* Names[7] = { "HDRI / Sky Dome", "Directional Sun", "Lunar Bodies", "Star Field",
                                        "Lens Flare", "Atmosphere & Fog", "Post Exposure & Lux" };
        static const char* Metas[7] = { "IBL · Equirectangular", "NOAA Solar Ephemeris", "6 Worlds · Phase Dial",
                                        "300 Stars · Twinkle", "Anamorphic · Ghosts", "Rayleigh · Mie · Fog",
                                        "ACES · Isolux Scale" };
        const int Env = State.Selected - PhotometricWorkspaceState::SelectedEnvDome;
        ConstructCaption(Column, Names[Env]);
        char Sub[96]{};
        std::snprintf(Sub, sizeof(Sub), "%s · ENVIRONMENT LIGHT", Metas[Env]);
        for (char* C = Sub; *C != '\0'; ++C)
            if (*C >= 'a' && *C <= 'z') *C = static_cast<char>(*C - 'a' + 'A');
        ConstructCaption(Column, Sub);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 LIGHT PREVIEW HERO
//------------------------------------------------------------------------------------------------------------------------

void DrawLightHeroCanvas(ControlColumn& Column, const PhotometricLight& Light)
{
    const PhotometricLightProps& P    = Light.Props;
    const int                    Type = Light.Type;
    DiagramPen                   Pen  = DiagramCanvas::Begin(Column, "LightHero", 300.0f, 150.0f, 6.0f, 4.0f);

    char Int[40]{}, Dec[8]{};
    const double HeroValue = QueryPhotometricFlux(Type, P);
    FormatGrouped(HeroValue, Int, sizeof(Int));
    std::snprintf(Dec, sizeof(Dec), ".%d", static_cast<int>((HeroValue - std::floor(HeroValue)) * 10.0));
    char Hero[64]{};
    std::snprintf(Hero, sizeof(Hero), "%s%s %s", Int, Dec, QueryPhotometricLightSpec(Type).Unit);
    Pen.Text(ImVec2(150.0f, 30.0f), Hero, IM_COL32(239, 239, 239, 255), 22.0f, 0);

    const ImU32 Beam = IM_COL32(232, 194, 122, 255);
    const ImU32 Dim  = IM_COL32(90, 90, 96, 255);
    if (Type == 2)
    {
        // 📝 IES polar web: graticule rings + field wedge.
        for (int R = 1; R <= 3; ++R) Pen.Circle(ImVec2(150.0f, 100.0f), R * 16.0f, 0, Dim);
        Pen.Line(ImVec2(150.0f, 52.0f), ImVec2(150.0f, 148.0f), Dim, 1.0f);
        Pen.Line(ImVec2(102.0f, 100.0f), ImVec2(198.0f, 100.0f), Dim, 1.0f);
        const float Half = static_cast<float>(P.Cone * 0.5 * 3.14159265 / 180.0);
        const float Tilt = static_cast<float>(P.Cutoff * 3.14159265 / 180.0);
        std::vector<ImVec2> Wedge;
        Wedge.emplace_back(150.0f, 100.0f);
        for (int I = 0; I <= 24; ++I)
        {
            const float A = -Half + (2.0f * Half * I) / 24.0f + Tilt;
            Wedge.emplace_back(150.0f + 46.0f * std::sin(A), 100.0f + 46.0f * std::cos(A));
        }
        Pen.Path(Wedge, Beam, 1.5f);
        Pen.Text(ImVec2(150.0f, 60.0f), "0°", Dim, 8.0f, 0);
    }
    else if (Type == 1)
    {
        const float Half = static_cast<float>(P.Angle * 3.14159265 / 180.0);
        Pen.Line(ImVec2(150.0f, 52.0f), ImVec2(150.0f - 60.0f * std::sin(Half), 52.0f + 60.0f * std::cos(Half)), Beam, 2.0f);
        Pen.Line(ImVec2(150.0f, 52.0f), ImVec2(150.0f + 60.0f * std::sin(Half), 52.0f + 60.0f * std::cos(Half)), Beam, 2.0f);
        Pen.Line(ImVec2(150.0f - 60.0f * std::sin(Half), 52.0f + 60.0f * std::cos(Half)),
                 ImVec2(150.0f + 60.0f * std::sin(Half), 52.0f + 60.0f * std::cos(Half)), Dim, 1.0f);
        Pen.Circle(ImVec2(150.0f, 52.0f), 4.0f, Beam);
    }
    else if (Type == 0)
    {
        for (int R = 1; R <= 3; ++R) Pen.Circle(ImVec2(150.0f, 100.0f), R * 14.0f, 0, Dim);
        Pen.Circle(ImVec2(150.0f, 100.0f), 5.0f, Beam);
        Pen.Glow(ImVec2(150.0f, 100.0f), 30.0f, IM_COL32(232, 194, 122, 255), 0.35f);
    }
    else if (Type == 3)
    {
        if (P.Aperture == 1) Pen.Ellipse(ImVec2(150.0f, 100.0f), 44.0f, 30.0f, IM_COL32(255, 241, 214, 40), Beam);
        else Pen.Rect(ImVec2(106.0f, 70.0f), ImVec2(88.0f, 60.0f), IM_COL32(255, 241, 214, 40), 3.0f);
        Pen.Text(ImVec2(150.0f, 142.0f), P.Aperture == 1 ? "DISK" : "RECTANGLE", Dim, 8.0f, 0);
    }
    else if (Type == 4)
    {
        Pen.Rect(ImVec2(60.0f, 92.0f), ImVec2(180.0f, 16.0f), IM_COL32(191, 227, 255, 60), 8.0f);
        Pen.Glow(ImVec2(150.0f, 100.0f), 40.0f, IM_COL32(191, 227, 255, 255), 0.25f);
    }
    else if (Type == 5)
    {
        Pen.Circle(ImVec2(150.0f, 100.0f), 22.0f, IM_COL32(216, 239, 159, 60), Beam);
        Pen.Circle(ImVec2(150.0f, 100.0f), 8.0f, Beam);
    }
    else
    {
        Pen.Rect(ImVec2(50.0f, 92.0f), ImVec2(200.0f, 16.0f), IM_COL32(255, 207, 153, 40), 4.0f);
        for (int I = 0; I < 12; ++I) Pen.Circle(ImVec2(60.0f + I * 16.4f, 100.0f), 3.0f, Beam);
    }
}

void ConstructLightPreview(PhotometricWorkspaceState& State, ControlColumn& Column)
{
    const PhotometricLight&      Light = State.Lights[State.Selected];
    const PhotometricLightProps& P     = Light.Props;
    const int                    Type  = Light.Type;

    static const char* Titles[7] = { "Radial falloff", "Beam envelope", "Photometric distribution",
                                     "Luminous surface", "Linear radiance", "LED emitter", "Ribbon light" };
    (void)SectionCard::Begin(Column, "LightPreview", Titles[Type], "StudioSun", "LIGHT STUDY", nullptr,
                             State.OpenCards[PhotometricWorkspaceState::CardPreview]);
    if (State.OpenCards[PhotometricWorkspaceState::CardPreview])
    {
        DrawLightHeroCanvas(Column, Light);
        char Caption[128]{}, Descriptor[160]{};
        char TileAL[48]{}, TileAV[64]{}, TileBL[48]{}, TileBV[64]{};
        if (Type == 0)
        {
            std::snprintf(Caption, sizeof(Caption), "Authored luminous intensity");
            std::snprintf(Descriptor, sizeof(Descriptor), "Omnidirectional / decay %.1f", P.Decay);
            std::snprintf(TileAL, sizeof(TileAL), "At 5 m · estimate");
            std::snprintf(TileAV, sizeof(TileAV), "%.2f lx", P.Intensity / std::pow(5.0, P.Decay));
            std::snprintf(TileBL, sizeof(TileBL), "Reach");
            std::snprintf(TileBV, sizeof(TileBV), "%.0f m", P.Distance);
        }
        else if (Type == 1)
        {
            std::snprintf(Caption, sizeof(Caption), "Authored luminous intensity");
            std::snprintf(Descriptor, sizeof(Descriptor), "%.0f° cone / %d%% soft edge", P.Angle * 2.0,
                          static_cast<int>(std::round(P.Penumbra * 100.0)));
            std::snprintf(TileAL, sizeof(TileAL), "Full cone");
            std::snprintf(TileAV, sizeof(TileAV), "%.1f°", P.Angle * 2.0);
            std::snprintf(TileBL, sizeof(TileBL), "Soft edge");
            std::snprintf(TileBV, sizeof(TileBV), "%d %%", static_cast<int>(std::round(P.Penumbra * 100.0)));
        }
        else if (Type == 2)
        {
            std::snprintf(Caption, sizeof(Caption), "Profile source flux");
            if (P.UseMeasuredIes && P.CustomIesProfile >= 0 && P.CustomIesProfile < static_cast<int>(State.LoadedIesProfiles.size()))
                std::snprintf(Descriptor, sizeof(Descriptor), "%s.ies / imported LM-63 Type-C",
                              State.LoadedIesProfiles[P.CustomIesProfile].Name.c_str());
            else if (P.UseMeasuredIes)
                std::snprintf(Descriptor, sizeof(Descriptor), "%s.ies / bundled LM-63 Type-C",
                              QueryPhotometricMeasuredIes(P.MeasuredProfile));
            else
                std::snprintf(Descriptor, sizeof(Descriptor), "%s / synthetic polar study",
                              QueryPhotometricPresetIes(P.PresetProfile));
            char Scaled[40]{};
            FormatGrouped(P.Lumens * P.Multiplier, Scaled, sizeof(Scaled));
            std::snprintf(TileAL, sizeof(TileAL), "Scaled output");
            std::snprintf(TileAV, sizeof(TileAV), "%s lm", Scaled);
            std::snprintf(TileBL, sizeof(TileBL), "Field angle");
            std::snprintf(TileBV, sizeof(TileBV), "%.1f°", P.Cone);
        }
        else if (Type == 3)
        {
            std::snprintf(Caption, sizeof(Caption), "Authored luminous flux");
            std::snprintf(Descriptor, sizeof(Descriptor), "%s / %.1f × %.1f m aperture",
                          P.Aperture == 1 ? "Disk" : "Rectangle", P.Width, P.Height);
            const double Area = P.Aperture == 1 ? 3.14159265 * (P.Width * 0.5) * (P.Width * 0.5) : P.Width * P.Height;
            std::snprintf(TileAL, sizeof(TileAL), "Aperture");
            std::snprintf(TileAV, sizeof(TileAV), "%.2f m²", Area);
            std::snprintf(TileBL, sizeof(TileBL), "Emission");
            std::snprintf(TileBV, sizeof(TileBV), "%s", P.TwoSided ? "Two-sided" : "One-sided");
        }
        else if (Type == 4)
        {
            std::snprintf(Caption, sizeof(Caption), "Authored luminous flux");
            std::snprintf(Descriptor, sizeof(Descriptor), "%.1f m linear emitter", P.Length);
            char PerM[40]{};
            FormatGrouped(P.Lumens / (P.Length > 0.01 ? P.Length : 1.0), PerM, sizeof(PerM));
            std::snprintf(TileAL, sizeof(TileAL), "Linear output");
            std::snprintf(TileAV, sizeof(TileAV), "%s lm/m", PerM);
            std::snprintf(TileBL, sizeof(TileBL), "Tube radius");
            std::snprintf(TileBV, sizeof(TileBV), "%d mm", static_cast<int>(std::round(P.Radius * 1000.0)));
        }
        else if (Type == 5)
        {
            std::snprintf(Caption, sizeof(Caption), "Estimated luminous flux");
            std::snprintf(Descriptor, sizeof(Descriptor), "%.0f mm package / %.0f K", P.Diameter, P.Temperature);
            std::snprintf(TileAL, sizeof(TileAL), "Driver power");
            std::snprintf(TileAV, sizeof(TileAV), "%.1f W", P.Watts * P.Dimmer);
            std::snprintf(TileBL, sizeof(TileBL), "Efficacy target");
            std::snprintf(TileBV, sizeof(TileBV), "%.0f lm/W", P.Efficacy);
        }
        else
        {
            std::snprintf(Caption, sizeof(Caption), "Estimated luminous flux");
            std::snprintf(Descriptor, sizeof(Descriptor), "Horizontal / %.1f m run", P.Length);
            std::snprintf(TileAL, sizeof(TileAL), "Connected load");
            std::snprintf(TileAV, sizeof(TileAV), "%.1f W", P.WattsPerMetre * P.Length * P.Dimmer);
            std::snprintf(TileBL, sizeof(TileBL), "Emitter count");
            std::snprintf(TileBV, sizeof(TileBV), "%d LEDs",
                          static_cast<int>(std::round(P.LedsPerMetre * P.Length)));
        }
        ConstructCaption(Column, Caption);
        ConstructCaption(Column, Descriptor);
        DiagramPen Tiles = DiagramCanvas::Begin(Column, "LightReadTiles", 300.0f, 62.0f, 6.0f, 4.0f);
        Tiles.Rect(ImVec2(0.0f, 0.0f), ImVec2(146.0f, 62.0f), IM_COL32(30, 30, 32, 255), 10.0f);
        Tiles.Rect(ImVec2(154.0f, 0.0f), ImVec2(146.0f, 62.0f), IM_COL32(30, 30, 32, 255), 10.0f);
        Tiles.Text(ImVec2(14.0f, 22.0f), TileAL, IM_COL32(132, 132, 132, 255), 9.5f, -1);
        Tiles.Text(ImVec2(14.0f, 46.0f), TileAV, IM_COL32(239, 239, 239, 255), 13.0f, -1);
        Tiles.Text(ImVec2(168.0f, 22.0f), TileBL, IM_COL32(132, 132, 132, 255), 9.5f, -1);
        Tiles.Text(ImVec2(168.0f, 46.0f), TileBV, IM_COL32(239, 239, 239, 255), 13.0f, -1);
        if (Type == 2)
            ConstructCaption(Column, P.UseMeasuredIes ? "Measured LM-63 .ies candela grid active"
                                                      : "Illustrative preset · no measured IES data");
        else ConstructCaption(Column, "Source study · shell authoring");
    }
    SectionCard::End(Column);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 LIGHT SECTIONS
//------------------------------------------------------------------------------------------------------------------------

void ConstructLightFlags(PhotometricWorkspaceState& State, ControlColumn& Column)
{
    PhotometricLightProps& P    = State.Lights[State.Selected].Props;
    const int              Type = State.Lights[State.Selected].Type;
    (void)SectionCard::Begin(Column, "LightFlags", "Scene participation", "StudioCheck", "FLAGS", nullptr,
                             State.OpenCards[PhotometricWorkspaceState::CardFlags]);
    if (State.OpenCards[PhotometricWorkspaceState::CardFlags])
    {
        ConstructParamToggle(State, Column, "PARAM", "FlagShadows", "Cast shadows", "", P.Shadows);
        const char* Second = Type == 2 ? "Draw distribution"
                           : Type == 1 ? "Draw cone"
                           : Type == 0 ? "Show glow"
                                       : "Draw emitter";
        ConstructParamToggle(State, Column, "PARAM", "FlagGizmo", Second, "", P.ShowGizmo);
    }
    SectionCard::End(Column);
}

void ConstructResponseCurve(PhotometricWorkspaceState& State, ControlColumn& Column)
{
    const PhotometricLightProps& P    = State.Lights[State.Selected].Props;
    const int                    Type = State.Lights[State.Selected].Type;
    (void)State;
    DiagramPen Pen = DiagramCanvas::Begin(Column, "LightResponse", 300.0f, 96.0f, 6.0f, 4.0f);
    const double I0  = (Type == 0 || Type == 1) ? P.Intensity : QueryPhotometricFlux(Type, P) / (4.0 * 3.14159265);
    const double Dec = Type == 0 ? P.Decay : 2.0;
    std::vector<ImVec2> Curve;
    for (int I = 0; I <= 40; ++I)
    {
        const double D = 0.5 + (9.5 * I) / 40.0;
        const double E = I0 / std::pow(D, Dec);
        const double N = E / (I0 > 0.0 ? I0 / std::pow(0.5, Dec) : 1.0);
        Curve.emplace_back(8.0f + (284.0f * I) / 40.0f, 84.0f - static_cast<float>(N) * 68.0f);
    }
    Pen.Path(Curve, IM_COL32(232, 194, 122, 255), 1.5f);
    Pen.Text(ImVec2(8.0f, 14.0f), "DISTANCE RESPONSE", IM_COL32(160, 160, 160, 255), 8.0f, -1);
    static const double Taps[4] = { 1.0, 2.0, 4.0, 8.0 };
    for (int I = 0; I < 4; ++I)
    {
        char Row[96]{};
        const double E = I0 / std::pow(Taps[I], Dec);
        std::snprintf(Row, sizeof(Row), "%.0f m · %.2f lx · %.0f %%", Taps[I], E,
                      E / (I0 / std::pow(1.0, Dec) > 0.0 ? I0 / std::pow(1.0, Dec) : 1.0) * 100.0);
        ConstructCaption(Column, Row);
    }
}

void ConstructLightOutput(PhotometricWorkspaceState& State, ControlColumn& Column)
{
    PhotometricLightProps& P    = State.Lights[State.Selected].Props;
    const int              Type = State.Lights[State.Selected].Type;
    const char* Title = Type == 5 ? "Driver & colour" : (Type == 6 ? "Output per metre" : "Source & colour");
    (void)SectionCard::Begin(Column, "LightOutput", Title, "StudioSun", "OUTPUT", nullptr,
                             State.OpenCards[PhotometricWorkspaceState::CardOutput]);
    if (State.OpenCards[PhotometricWorkspaceState::CardOutput])
    {
        if (Type == 0 || Type == 1)
            ConstructParamSlider(State, Column, "PARAM", "OutIntensity", "Intensity", P.Intensity, 0.0,
                                 Type == 1 ? 200.0 : 60.0, 0.5, "cd", 1);
        else if (Type == 5)
        {
            ConstructParamSlider(State, Column, "PARAM", "OutWatts", "Driver power", P.Watts, 0.1, 100.0, 0.5, "W",
                                 1);
            ConstructParamSlider(State, Column, "PARAM", "OutEfficacy", "Efficacy target", P.Efficacy, 10.0, 250.0,
                                 1.0, "lm/W", 0);
            ConstructParamSlider(State, Column, "PARAM", "OutDimmer", "Dimmer", P.Dimmer, 0.0, 1.0, 0.01, "", 2);
        }
        else if (Type == 6)
        {
            ConstructParamSlider(State, Column, "PARAM", "OutFluxM", "Flux per metre", P.LumensPerMetre, 10.0, 4000.0,
                                 10.0, "lm/m", 0);
            ConstructParamSlider(State, Column, "PARAM", "OutLoadM", "Load per metre", P.WattsPerMetre, 1.0, 50.0,
                                 0.2, "W/m", 1);
            ConstructParamSlider(State, Column, "PARAM", "OutDimmer", "Dimmer", P.Dimmer, 0.0, 1.0, 0.01, "", 2);
        }
        else
        {
            const double MaxLm = Type == 3 ? 20000.0 : (Type == 4 ? 12000.0 : 8000.0);
            ConstructParamSlider(State, Column, "PARAM", "OutLumens", "Luminous flux", P.Lumens, 0.0, MaxLm, 25.0,
                                 "lm", 0);
        }
        if (Type == 2 || Type == 3 || Type == 4 || Type == 5 || Type == 6)
            ConstructParamSlider(State, Column, "PARAM", "OutTemp", "Colour temperature", P.Temperature, 1800.0,
                                 12000.0, 50.0, "K", 0);
        char Tint[48]{};
        std::snprintf(Tint, sizeof(Tint), "Emission tint %s", P.ColorHex);
        ConstructCaption(Column, Tint);
        ConstructResponseCurve(State, Column);
    }
    SectionCard::End(Column);
}

void ConstructLightOptics(PhotometricWorkspaceState& State, ControlColumn& Column)
{
    PhotometricLightProps& P    = State.Lights[State.Selected].Props;
    const int              Type = State.Lights[State.Selected].Type;
    const char* Title = Type == 2 ? "Distribution profile"
                      : Type == 1 ? "Beam envelope"
                      : Type == 0 ? "Radial falloff"
                                  : "Emitter geometry";
    (void)SectionCard::Begin(Column, "LightOptics", Title, "StudioFocus", "OPTICS", nullptr,
                             State.OpenCards[PhotometricWorkspaceState::CardOptics]);
    if (State.OpenCards[PhotometricWorkspaceState::CardOptics])
    {
        if (Type == 0)
        {
            ConstructParamSlider(State, Column, "PARAM", "OptReach", "Reach", P.Distance, 1.0, 120.0, 0.5, "m", 0);
            ConstructParamSlider(State, Column, "PARAM", "OptDecay", "Decay exponent", P.Decay, 0.0, 4.0, 0.1, "",
                                 2);
        }
        else if (Type == 1)
        {
            double Full = P.Angle * 2.0;
            if (ConstructParamSlider(State, Column, "PARAM", "OptCone", "Full cone angle", Full, 4.0, 160.0, 0.5,
                                     "°", 1))
                P.Angle = Full * 0.5;
            ConstructParamSlider(State, Column, "PARAM", "OptPenumbra", "Penumbra", P.Penumbra, 0.0, 1.0, 0.01, "",
                                 2);
        }
        else if (Type == 2)
        {
            static const char* Presets[8] = { "Downlight", "Wall wash", "Batwing", "ECE Low Beam",
                                              "SAE Low Beam", "High Beam", "Fog Lamp", "Parking Lamp" };
            if (SelectPill::Construct(Column, "OptPreset", "Analytical preset", Presets, 8, P.PresetProfile))
            {
                P.UseMeasuredIes = false;
                P.CustomIesProfile = -1;
                LogPhotometricWorkspaceValue(State, "PARAM", "Analytical preset", Presets[P.PresetProfile]);
            }

            static const char* BuiltInMeasured[8] = { "(Analytical preset active)", "LowBeam.ies (LM-63)",
                                                       "HighBeam.ies (LM-63)", "FogBeam.ies (LM-63)",
                                                       "Roadway.ies (LM-63)", "Area.ies (LM-63)",
                                                       "RoofFlood.ies (LM-63)", "RoofSpot.ies (LM-63)" };
            std::vector<std::string> ImportedLabels;
            ImportedLabels.reserve(State.LoadedIesProfiles.size());
            std::vector<const char*> MeasuredOptions;
            MeasuredOptions.reserve(8 + State.LoadedIesProfiles.size());
            for (const char* Label : BuiltInMeasured) MeasuredOptions.push_back(Label);
            for (const PhotometricIesProfile& Profile : State.LoadedIesProfiles)
            {
                ImportedLabels.push_back(Profile.Name + " (imported Type-C)");
                MeasuredOptions.push_back(ImportedLabels.back().c_str());
            }
            int Sel = 0;
            if (P.UseMeasuredIes)
            {
                if (P.CustomIesProfile >= 0 && P.CustomIesProfile < static_cast<int>(State.LoadedIesProfiles.size()))
                    Sel = 8 + P.CustomIesProfile;
                else Sel = P.MeasuredProfile + 1;
            }
            if (SelectPill::Construct(Column, "OptMeasured", "LM-63 .ies file", MeasuredOptions.data(),
                                      static_cast<int>(MeasuredOptions.size()), Sel))
            {
                P.UseMeasuredIes = Sel > 0;
                P.CustomIesProfile = Sel >= 8 ? Sel - 8 : -1;
                if (Sel > 0 && Sel < 8) P.MeasuredProfile = Sel - 1;
                LogPhotometricWorkspaceValue(State, "PARAM", "LM-63 file", MeasuredOptions[Sel]);
            }
            if (P.UseMeasuredIes && P.CustomIesProfile >= 0 && P.CustomIesProfile < static_cast<int>(State.LoadedIesProfiles.size()))
            {
                const PhotometricIesProfile& Profile = State.LoadedIesProfiles[P.CustomIesProfile];
                ConstructCaption(Column, "Imported Type-C profile · C0/C90 candela curves normalized to peak");
                DiagramPen Plot = DiagramCanvas::Begin(Column, "ImportedIesCurves", 300.0f, 92.0f, 4.0f, 4.0f);
                for (int Guide = 0; Guide <= 4; ++Guide)
                {
                    const float Y = 72.0f - Guide * 15.0f;
                    Plot.Line(ImVec2(28.0f, Y), ImVec2(286.0f, Y), IM_COL32(255, 255, 255, 18));
                }
                Plot.Line(ImVec2(28.0f, 12.0f), ImVec2(28.0f, 72.0f), IM_COL32(255, 255, 255, 44));
                Plot.Line(ImVec2(28.0f, 72.0f), ImVec2(286.0f, 72.0f), IM_COL32(255, 255, 255, 44));
                std::vector<ImVec2> C0, C90;
                C0.reserve(33); C90.reserve(33);
                for (int Point = 0; Point <= 32; ++Point)
                {
                    const double Polar = 180.0 * Point / 32.0;
                    const float X = 28.0f + 258.0f * Point / 32.0f;
                    C0.emplace_back(X, 72.0f - 60.0f * SamplePhotometricIes(Profile, 0.0, Polar));
                    C90.emplace_back(X, 72.0f - 60.0f * SamplePhotometricIes(Profile, 90.0, Polar));
                }
                Plot.Path(C0, IM_COL32(232, 194, 122, 255), 2.0f);
                Plot.Path(C90, IM_COL32(126, 194, 232, 255), 2.0f);
                Plot.Text(ImVec2(34.0f, 11.0f), "C0", IM_COL32(232, 194, 122, 255), 8.0f, -1);
                Plot.Text(ImVec2(68.0f, 11.0f), "C90", IM_COL32(126, 194, 232, 255), 8.0f, -1);
                Plot.Text(ImVec2(286.0f, 88.0f), "180° polar", IM_COL32(132, 132, 132, 255), 8.0f, 1);
            }
            ConstructParamSlider(State, Column, "PARAM", "OptMult", "Profile multiplier", P.Multiplier, 0.0, 4.0,
                                 0.05, "×", 2);
            ConstructParamSlider(State, Column, "PARAM", "OptField", "Field angle", P.Cone, 5.0, 100.0, 1.0, "°",
                                 1);
            ConstructParamSlider(State, Column, "PARAM", "OptCutoff", "Cut-off pitch", P.Cutoff, -5.0, 5.0, 0.1,
                                 "°", 1);
            ConstructParamSlider(State, Column, "PARAM", "OptRange", "Photometric range", P.Range, 1.0, 250.0, 1.0,
                                 "m", 0);
        }
        else if (Type == 3)
        {
            static const char* Apertures[2] = { "Rectangle", "Disk" };
            if (SelectPill::Construct(Column, "OptAperture", "Aperture", Apertures, 2, P.Aperture))
                LogPhotometricWorkspaceValue(State, "PARAM", "Aperture", Apertures[P.Aperture]);
            ConstructParamSlider(State, Column, "PARAM", "OptWidth", "Width", P.Width, 0.1, 20.0, 0.1, "m", 1);
            ConstructParamSlider(State, Column, "PARAM", "OptHeight", "Height", P.Height, 0.1, 20.0, 0.1, "m", 1);
            ConstructParamSlider(State, Column, "PARAM", "OptSpread", "Beam spread", P.Spread, 1.0, 180.0, 1.0,
                                 "°", 0);
            ConstructParamToggle(State, Column, "PARAM", "OptTwoSided", "Two-sided emission", "", P.TwoSided);
        }
        else if (Type == 4)
        {
            ConstructParamSlider(State, Column, "PARAM", "OptLength", "Length", P.Length, 0.1, 20.0, 0.1, "m", 1);
            ConstructParamSlider(State, Column, "PARAM", "OptRadius", "Tube radius", P.Radius, 0.01, 1.0, 0.005,
                                 "m", 3);
            ConstructParamSlider(State, Column, "PARAM", "OptReach", "Reach", P.Distance, 1.0, 120.0, 1.0, "m", 0);
        }
        else if (Type == 5)
        {
            ConstructParamSlider(State, Column, "PARAM", "OptDiameter", "Package diameter", P.Diameter, 5.0, 120.0,
                                 1.0, "mm", 0);
            ConstructParamSlider(State, Column, "PARAM", "OptAngle", "Emission angle", P.Angle, 10.0, 180.0, 1.0,
                                 "deg", 0);
        }
        else
        {
            ConstructParamSlider(State, Column, "PARAM", "OptLength", "Strip length", P.Length, 0.1, 20.0, 0.1,
                                 "m", 2);
            ConstructParamSlider(State, Column, "PARAM", "OptDensity", "Emitter density", P.LedsPerMetre, 10.0,
                                 240.0, 5.0, "/m", 0);
            ConstructParamSlider(State, Column, "PARAM", "OptVoltage", "Supply voltage", P.Voltage, 5.0, 48.0, 1.0,
                                 "V", 0);
            ConstructParamToggle(State, Column, "PARAM", "OptDiffuser", "Opal diffuser", "", P.Diffuser);
        }
    }
    SectionCard::End(Column);
}

void ConstructLightTransform(PhotometricWorkspaceState& State, ControlColumn& Column)
{
    PhotometricLightProps& P = State.Lights[State.Selected].Props;
    (void)SectionCard::Begin(Column, "LightTransform", "Transform", "StudioOrbit", "WORLD SPACE", nullptr,
                             State.OpenCards[PhotometricWorkspaceState::CardTransform]);
    if (State.OpenCards[PhotometricWorkspaceState::CardTransform])
    {
        float Pos[3] = { static_cast<float>(P.Position[0]), static_cast<float>(P.Position[1]),
                         static_cast<float>(P.Position[2]) };
        if (AxisFields::Construct(Column, "TfPos", "Position (m)", Pos, { -100.0f, -100.0f, -100.0f },
                                  { 100.0f, 100.0f, 100.0f }))
        {
            P.Position[0] = Pos[0];
            P.Position[1] = Pos[1];
            P.Position[2] = Pos[2];
            LogPhotometricWorkspaceValue(State, "PARAM", "Position", "edited");
        }
        if (P.HasTarget)
        {
            float Aim[3] = { static_cast<float>(P.Target[0]), static_cast<float>(P.Target[1]),
                             static_cast<float>(P.Target[2]) };
            if (AxisFields::Construct(Column, "TfAim", "Aim target (m)", Aim, { -100.0f, -100.0f, -100.0f },
                                      { 100.0f, 100.0f, 100.0f }))
            {
                P.Target[0] = Aim[0];
                P.Target[1] = Aim[1];
                P.Target[2] = Aim[2];
                LogPhotometricWorkspaceValue(State, "PARAM", "Aim target", "edited");
            }
        }
        float Rot[3] = { static_cast<float>(P.Rotation[0]), static_cast<float>(P.Rotation[1]),
                         static_cast<float>(P.Rotation[2]) };
        if (AxisFields::Construct(Column, "TfRot", "Rotation (deg)", Rot, { -360.0f, -360.0f, -360.0f },
                                  { 360.0f, 360.0f, 360.0f }))
        {
            P.Rotation[0] = Rot[0];
            P.Rotation[1] = Rot[1];
            P.Rotation[2] = Rot[2];
            LogPhotometricWorkspaceValue(State, "PARAM", "Rotation", "edited");
        }
        static const ActionItem Resets[2] = {
            { "Reset rotation", "StudioReset", ActionTone::Default },
            { "Centre X", "StudioFocus", ActionTone::Default },
        };
        const int Fired = ActionRow::Construct(Column, "TfResets", Resets, 2);
        if (Fired == 0)
        {
            P.Rotation[0] = P.Rotation[1] = P.Rotation[2] = 0.0;
            LogPhotometricWorkspaceValue(State, "PARAM", "Reset rotation", "0, 0, 0");
        }
        else if (Fired == 1)
        {
            P.Position[0] = 0.0;
            LogPhotometricWorkspaceValue(State, "PARAM", "Centre X", "x = 0");
        }
    }
    SectionCard::End(Column);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 ENVIRONMENT PAGES
//------------------------------------------------------------------------------------------------------------------------

void ConstructDomePage(PhotometricWorkspaceState& State, ControlColumn& Column)
{
    PhotometricEnvDome& E = State.Dome;
    DiagramPen Pen = DiagramCanvas::Begin(Column, "EnvDomeHero", 300.0f, 84.0f, 6.0f, 4.0f);
    {
        std::vector<ImU32> Sky = { IM_COL32(61, 99, 148, 255), IM_COL32(152, 173, 196, 255),
                                   IM_COL32(37, 38, 36, 255) };
        Pen.GradientBar(ImVec2(8.0f, 8.0f), ImVec2(284.0f, 40.0f), Sky);
        Pen.Text(ImVec2(8.0f, 64.0f), "ZENITH · HORIZON · GROUND", IM_COL32(160, 160, 160, 255), 8.0f, -1);
        char Mode[48]{};
        static const char* Modes[4] = { "Procedural Sky", "HDRI Meridian", "Overcast Softbox", "Night Starlight" };
        std::snprintf(Mode, sizeof(Mode), "%s", Modes[E.Mode]);
        Pen.Text(ImVec2(292.0f, 64.0f), Mode, IM_COL32(159, 199, 232, 255), 8.0f, 1);
    }
    (void)SectionCard::Begin(Column, "EnvDome", "HDRI & Skylight Probe", "StudioGlobe", "IBL DOME", nullptr,
                             State.OpenCards[PhotometricWorkspaceState::CardDome]);
    if (State.OpenCards[PhotometricWorkspaceState::CardDome])
    {
        ConstructParamToggle(State, Column, "PARAM", "DomeOn", "Environment enabled", "", E.Enabled);
        ConstructParamSlider(State, Column, "PARAM", "DomeSky", "Skylight intensity", E.SkylightIntensity, 0.0, 4.0,
                             0.05, "×", 2);
        ConstructParamSlider(State, Column, "PARAM", "DomeDiffuse", "Diffuse multiplier", E.DiffuseMultiplier, 0.0,
                             3.0, 0.05, "×", 2);
        ConstructParamSlider(State, Column, "PARAM", "DomeRot", "Dome rotation", E.RotationDeg, 0.0, 360.0, 1.0,
                             "deg", 0);
        static const char* Sizes[4] = { "128", "256", "512", "1024" };
        ConstructParamSelect(State, Column, "PARAM", "DomeCube", "IBL cubemap size", E.CubemapResolution, Sizes, 4);
    }
    SectionCard::End(Column);
}

void ConstructSunPage(PhotometricWorkspaceState& State, ControlColumn& Column)
{
    PhotometricSunProps& S = State.Sun;
    (void)SectionCard::Begin(Column, "EnvSunPrev", "Solar disc & diurnal arc", "StudioSun", "EPHEMERIS", nullptr,
                             State.OpenCards[PhotometricWorkspaceState::CardPreview]);
    if (State.OpenCards[PhotometricWorkspaceState::CardPreview])
    {
        DiagramPen Disc = DiagramCanvas::Begin(Column, "EnvSunDisc", 300.0f, 72.0f, 6.0f, 4.0f);
        Disc.Glow(ImVec2(60.0f, 36.0f), 28.0f, IM_COL32(232, 194, 122, 255), 0.5f);
        Disc.Circle(ImVec2(60.0f, 36.0f), 12.0f, IM_COL32(232, 194, 122, 255));
        char El[64]{};
        std::snprintf(El, sizeof(El), "El %.1f deg  Az %.1f deg", State.SunSolved.ElevationDeg,
                      State.SunSolved.AzimuthDeg);
        Disc.Text(ImVec2(100.0f, 32.0f), El, IM_COL32(232, 194, 122, 255), 10.0f, -1);
        char Noon[64]{};
        std::snprintf(Noon, sizeof(Noon), "%.1fh LOCAL · UTC%+.0f", S.LocalHours, S.UtcOffset);
        Disc.Text(ImVec2(100.0f, 54.0f), Noon, IM_COL32(160, 160, 160, 255), 9.0f, -1);

        DiagramPen Arc = DiagramCanvas::Begin(Column, "EnvSunArc", 300.0f, 84.0f, 6.0f, 4.0f);
        std::vector<ImVec2> Curve;
        for (int I = 0; I <= 48; ++I)
        {
            PhotometricSunProps Probe = S;
            Probe.LocalHours          = (I / 48.0) * 24.0;
            PhotometricSunSolved Solved{};
            EvaluatePhotometricSun(Probe, Solved);
            Curve.emplace_back(8.0f + (284.0f * I) / 48.0f, 70.0f - (Solved.ElevationDeg + 20.0f) * 0.6f);
        }
        Arc.Path(Curve, IM_COL32(232, 194, 122, 255), 1.5f);
        const float NowX = 8.0f + 284.0f * static_cast<float>(S.LocalHours / 24.0);
        Arc.Line(ImVec2(NowX, 6.0f), ImVec2(NowX, 74.0f), IM_COL32(232, 194, 122, 160), 1.0f);
    }
    SectionCard::End(Column);

    (void)SectionCard::Begin(Column, "EnvSun", "Solar Lighting & Observer", "StudioSun", "SUN", nullptr,
                             State.OpenCards[PhotometricWorkspaceState::CardSun]);
    if (State.OpenCards[PhotometricWorkspaceState::CardSun])
    {
        auto Resolve = [&]() { EvaluatePhotometricSun(State.Sun, State.SunSolved); };
        ConstructParamToggle(State, Column, "PARAM", "SunOn", "Sun active", "", S.Enabled);
        if (ConstructParamSlider(State, Column, "SUN", "SunHours", "Local hours", S.LocalHours, 0.0, 24.0, 0.05, "h",
                                 2))
            Resolve();
        ConstructParamSlider(State, Column, "SUN", "SunIntensity", "Direct intensity", S.Intensity, 0.0, 60.0, 0.5,
                             "×", 1);
        ConstructParamSlider(State, Column, "SUN", "SunTemp", "Colour temp", S.TemperatureK, 1800.0, 12000.0, 50.0,
                             "K", 0);
        ConstructParamSlider(State, Column, "SUN", "SunDiameter", "Disc diameter", S.DiameterDeg, 0.1, 5.0, 0.05,
                             "deg", 2);
        if (ConstructParamSlider(State, Column, "SUN", "SunLat", "Latitude", S.Latitude, -90.0, 90.0, 0.1, "°", 2))
            Resolve();
    }
    SectionCard::End(Column);
}

void ConstructMoonPage(PhotometricWorkspaceState& State, ControlColumn& Column)
{
    PhotometricMoon&        M = State.Moon;
    PhotometricMoonMetrics  Metrics{};
    SolvePhotometricMoon(M, Metrics);
    char Hero[48]{};
    std::snprintf(Hero, sizeof(Hero), "%.0f %% lit · %s", Metrics.IlluminationPct, Metrics.PhaseLabel);
    (void)SectionCard::Begin(Column, "EnvMoonPrev", "Lunar Phase Dial", "StudioGlobe", Hero, nullptr,
                             State.OpenCards[PhotometricWorkspaceState::CardPreview]);
    if (State.OpenCards[PhotometricWorkspaceState::CardPreview])
    {
        DiagramPen Dial = DiagramCanvas::Begin(Column, "EnvMoonDial", 300.0f, 110.0f, 6.0f, 4.0f);
        Dial.Circle(ImVec2(70.0f, 55.0f), 34.0f, 0, IM_COL32(120, 120, 120, 255));
        const float A = static_cast<float>(M.AzimuthDeg * 3.14159265 / 180.0);
        Dial.Circle(ImVec2(70.0f + 34.0f * std::sin(A), 55.0f - 34.0f * std::cos(A)), 9.0f, IM_COL32(220, 226, 236, 255));
        Dial.Text(ImVec2(130.0f, 40.0f), QueryPhotometricMoon(M.Slot).Name, IM_COL32(239, 239, 239, 255), 11.0f, -1);
        Dial.Text(ImVec2(130.0f, 60.0f), Metrics.PhaseLabel, IM_COL32(159, 199, 232, 255), 10.0f, -1);
        char El[48]{};
        std::snprintf(El, sizeof(El), "El %.0f deg", M.ElevationDeg);
        Dial.Text(ImVec2(130.0f, 80.0f), El, IM_COL32(160, 160, 160, 255), 9.0f, -1);
    }
    SectionCard::End(Column);

    (void)SectionCard::Begin(Column, "EnvMoon", "Moon Surface Catalogue", "StudioGlobe", "6 WORLDS", nullptr,
                             State.OpenCards[PhotometricWorkspaceState::CardMoon]);
    if (State.OpenCards[PhotometricWorkspaceState::CardMoon])
    {
        static const char* Worlds[6] = { "Luna", "Ember", "Glacier", "Sulfur", "Shroud", "Shard" };
        if (ChoiceRow::Construct(Column, "MoonSlot", "Moon", Worlds, 6, M.Slot))
            LogPhotometricWorkspaceValue(State, "PARAM", "Moon", Worlds[M.Slot]);
        ConstructCaption(Column, QueryPhotometricMoon(M.Slot).Subtitle);
        ConstructParamToggle(State, Column, "PARAM", "MoonCast", "Cast moonlight", "", M.CastMoonlight);
        ConstructParamSlider(State, Column, "PARAM", "MoonPhase", "Phase cycle", M.PhaseDays, 0.0, 29.53, 0.1, "d",
                             1);
        ConstructParamSlider(State, Column, "PARAM", "MoonBright", "Brightness", M.Brightness, 0.0, 12.0, 0.1, "×",
                             1);
        ConstructParamSlider(State, Column, "PARAM", "MoonAz", "Azimuth", M.AzimuthDeg, 0.0, 360.0, 1.0, "°", 0);
        ConstructParamSlider(State, Column, "PARAM", "MoonEl", "Elevation", M.ElevationDeg, -15.0, 90.0, 1.0, "°",
                             0);
        ConstructParamSlider(State, Column, "PARAM", "MoonDisc", "Disc size", M.AngularDiameterDeg, 0.1, 5.0, 0.05,
                             "°", 2);
    }
    SectionCard::End(Column);
}

void ConstructStarsPage(PhotometricWorkspaceState& State, ControlColumn& Column)
{
    PhotometricStars& St = State.Stars;
    (void)SectionCard::Begin(Column, "EnvStars", "Star Field & Twinkle", "StudioSparkles", "CELESTIAL", nullptr,
                             State.OpenCards[PhotometricWorkspaceState::CardStars]);
    if (State.OpenCards[PhotometricWorkspaceState::CardStars])
    {
        DiagramPen Sky = DiagramCanvas::Begin(Column, "EnvStarsHero", 300.0f, 84.0f, 6.0f, 4.0f);
        uint32_t        H = 0x2B4A3BC9u;
        for (int I = 0; I < 60; ++I)
        {
            H = H * 1664525u + 1013904223u;
            const float X = 8.0f + (H % 2840) / 10.0f;
            H = H * 1664525u + 1013904223u;
            const float Y = 6.0f + (H % 720) / 10.0f;
            const float R = 0.8f + (H % 100) / 100.0f * 1.4f;
            Sky.Circle(ImVec2(X, Y), R, IM_COL32(220, 230, 245, 220));
        }
        ConstructParamToggle(State, Column, "PARAM", "StarsOn", "Star field visible", "", St.Visible);
        ConstructParamSlider(State, Column, "PARAM", "StarsMag", "Limiting magnitude", St.LimitingMagnitude, 0.0,
                             8.0, 0.1, "mag", 1);
        ConstructParamSlider(State, Column, "PARAM", "StarsBright", "Star brightness", St.Brightness, 0.0, 4.0,
                             0.05, "×", 2);
        ConstructParamToggle(State, Column, "PARAM", "StarsTwinkle", "Twinkle modulation", "", St.TwinkleEnabled);
        ConstructParamSlider(State, Column, "PARAM", "StarsDepth", "Twinkle depth", St.TwinkleDepthPct, 0.0, 100.0,
                             1.0, "%", 0);
        ConstructParamSlider(State, Column, "PARAM", "StarsRot", "Pole rotation", St.CelestialRotationDeg, 0.0,
                             360.0, 1.0, "°", 0);
    }
    SectionCard::End(Column);
}

void ConstructFlarePage(PhotometricWorkspaceState& State, ControlColumn& Column)
{
    PhotometricLensFlare& F = State.Flare;
    (void)SectionCard::Begin(Column, "EnvFlare", "Optical Lens Flare Composite", "StudioSun", "INTERACTIVE", nullptr,
                             State.OpenCards[PhotometricWorkspaceState::CardFlare]);
    if (State.OpenCards[PhotometricWorkspaceState::CardFlare])
    {
        DiagramPen Flare = DiagramCanvas::Begin(Column, "EnvFlareHero", 300.0f, 84.0f, 6.0f, 4.0f);
        Flare.Glow(ImVec2(84.0f, 42.0f), 30.0f, IM_COL32(232, 194, 122, 255), F.Enabled ? 0.6f : 0.15f);
        if (F.Anamorphic) Flare.Line(ImVec2(20.0f, 42.0f), ImVec2(280.0f, 42.0f), IM_COL32(159, 199, 232, 160), 2.0f);
        for (int I = 0; I < F.GhostCount && I < 12; ++I)
        {
            const float X = 110.0f + I * 14.0f;
            Flare.Circle(ImVec2(X, 42.0f), 5.0f, IM_COL32(159, 199, 232, 90));
        }
        if (F.Starburst)
        {
            for (int I = 0; I < 8; ++I)
            {
                const float A = I * 3.14159265f / 4.0f;
                Flare.Line(ImVec2(84.0f, 42.0f), ImVec2(84.0f + 26.0f * std::cos(A), 42.0f + 26.0f * std::sin(A)),
                           IM_COL32(239, 239, 239, 120), 1.0f);
            }
        }
        ConstructParamToggle(State, Column, "PARAM", "FlareOn", "Flare enabled", "", F.Enabled);
        ConstructParamToggle(State, Column, "PARAM", "FlareAna", "Anamorphic streak", "", F.Anamorphic);
        ConstructParamToggle(State, Column, "PARAM", "FlareStar", "Starburst diffraction", "", F.Starburst);
        static const char* Shapes[3] = { "Hexagon", "Circle", "Blade" };
        ConstructParamSelect(State, Column, "PARAM", "FlareGhost", "Ghost shape", F.GhostShape, Shapes, 3);
        ConstructParamSlider(State, Column, "PARAM", "FlareGain", "Flare intensity", F.Intensity, 0.0, 4.0, 0.05,
                             "×", 2);
        ConstructParamSlider(State, Column, "PARAM", "FlareGhostGain", "Ghost brightness", F.GhostBrightness, 0.0,
                             2.0, 0.02, "×", 2);
        ConstructParamStepped(State, Column, "PARAM", "FlareGhosts", "Ghost count", F.GhostCount, 0.0, 12.0, 1.0);
        ConstructParamSlider(State, Column, "PARAM", "FlareHalo", "Halo radius", F.HaloRadius, 0.05, 0.8, 0.01, "",
                             2);
    }
    SectionCard::End(Column);
}

void ConstructAtmospherePage(PhotometricWorkspaceState& State, ControlColumn& Column)
{
    PhotometricFog& Fg = State.Fog;
    (void)SectionCard::Begin(Column, "EnvAtmo", "Rayleigh / Mie & Height Fog", "StudioCloud", "MEDIUM", nullptr,
                             State.OpenCards[PhotometricWorkspaceState::CardAtmosphere]);
    if (State.OpenCards[PhotometricWorkspaceState::CardAtmosphere])
    {
        DiagramPen FogPen = DiagramCanvas::Begin(Column, "EnvFogHero", 300.0f, 84.0f, 6.0f, 4.0f);
        std::vector<ImU32> Haze = { IM_COL32(20, 26, 36, 255), IM_COL32(154, 173, 193, Fg.Enabled ? 220 : 60) };
        FogPen.GradientBar(ImVec2(8.0f, 8.0f), ImVec2(284.0f, 40.0f), Haze);
        char Dense[64]{};
        std::snprintf(Dense, sizeof(Dense), "DENSITY %.4f /m · PROBE %.0f m", Fg.Density, Fg.ProbeDistanceM);
        FogPen.Text(ImVec2(8.0f, 64.0f), Dense, IM_COL32(160, 160, 160, 255), 8.0f, -1);
        ConstructParamSlider(State, Column, "PARAM", "AtmoRayleigh", "Rayleigh", State.Sun.Rayleigh, 0.0, 4.0, 0.05,
                             "×", 2);
        ConstructParamSlider(State, Column, "PARAM", "AtmoMie", "Mie aerosol", State.Sun.Mie, 0.0, 6.0, 0.05, "×",
                             2);
        ConstructParamToggle(State, Column, "PARAM", "AtmoFogOn", "Height fog enabled", "", Fg.Enabled);
        ConstructParamSlider(State, Column, "PARAM", "AtmoDensity", "Fog density", Fg.Density, 0.0005, 0.05, 0.0005,
                             "/m", 4);
        ConstructParamSlider(State, Column, "PARAM", "AtmoProbe", "Probe distance", Fg.ProbeDistanceM, 10.0, 1000.0,
                             10.0, "m", 0);
    }
    SectionCard::End(Column);
}

void ConstructPostPage(PhotometricWorkspaceState& State, ControlColumn& Column)
{
    PhotometricPost& Pt = State.Post;
    (void)SectionCard::Begin(Column, "EnvPost", "Exposure, Tonemap & Isolux", "StudioActivity", "POST", nullptr,
                             State.OpenCards[PhotometricWorkspaceState::CardPost]);
    if (State.OpenCards[PhotometricWorkspaceState::CardPost])
    {
        ConstructParamSlider(State, Column, "PARAM", "PostEv", "Exposure EV", Pt.ExposureEv, -4.0, 4.0, 0.05, "EV",
                             2);
        static const char* Curves[3] = { "ACES", "Neutral", "Reinhard" };
        ConstructParamSelect(State, Column, "PARAM", "PostCurve", "Tonemap curve", Pt.Tonemap, Curves, 3);
        bool Isolux = State.Lens == PhotometricWorkspaceState::LensLux;
        if (SwitchPill::Construct(Column, "PostIsolux", "Isolux overlay", "False-colour lux lens", Isolux))
        {
            State.Lens = Isolux ? PhotometricWorkspaceState::LensLux : PhotometricWorkspaceState::LensPbr;
            LogPhotometricWorkspaceValue(State, "PARAM", "Isolux overlay", Isolux ? "on" : "off");
        }
    }
    SectionCard::End(Column);
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    ENTRY
//------------------------------------------------------------------------------------------------------------------------

void ConstructPhotometricWorkspaceInspector(PhotometricWorkspaceState& State, const EditorTypefaces& Faces,
                                            ControlColumn& Column)
{
    (void)Faces;
    if (State.Selected < 0 || State.Selected > 14) State.Selected = PhotometricWorkspaceState::SelectedLight0;
    ConstructEntityHeader(State, Column);

    if (State.Selected >= 0 && State.Selected < 8)
    {
        ConstructLightPreview(State, Column);
        ConstructLightFlags(State, Column);
        ConstructLightOutput(State, Column);
        ConstructLightOptics(State, Column);
        ConstructLightTransform(State, Column);
    }
    else if (State.Selected == PhotometricWorkspaceState::SelectedEnvDome) ConstructDomePage(State, Column);
    else if (State.Selected == PhotometricWorkspaceState::SelectedSun) ConstructSunPage(State, Column);
    else if (State.Selected == PhotometricWorkspaceState::SelectedMoon) ConstructMoonPage(State, Column);
    else if (State.Selected == PhotometricWorkspaceState::SelectedStars) ConstructStarsPage(State, Column);
    else if (State.Selected == PhotometricWorkspaceState::SelectedLensFlare) ConstructFlarePage(State, Column);
    else if (State.Selected == PhotometricWorkspaceState::SelectedAtmosphere) ConstructAtmospherePage(State, Column);
    else ConstructPostPage(State, Column);
    CaptionText::Construct(Column, "Changes apply live ↗");
}

} // namespace Frontier
