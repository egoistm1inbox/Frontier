/*==========================================================================================================================================
                                                       EVERESTSCENEASSEMBLY.CPP
==========================================================================================================================================*/
// 🧩 Project Everest RAII scene records (EngineReusable, ProjectCustom, DedicatedStudio) and dedicated studio workspaces.

#include "EverestSceneAssembly.h"

#include "Engine/Scene/SceneDirectory.h"

#if defined(FRONTIER_WITH_INTERFACE_SDK)
#include "Engine/Interface/EverestInterfaceKit.h"
#endif

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>

namespace Frontier
{

namespace
{

constexpr uint32_t AccentRender      = 0x8bb6c8u;
constexpr uint32_t AccentEnvironment = 0x8fb3a4u;
constexpr uint32_t AccentForcefield  = 0x7fb4b8u;
constexpr uint32_t AccentObjects     = 0x9aa6b2u;
constexpr uint32_t AccentVehicle     = 0xc9c785u;
constexpr uint32_t AccentEffects     = 0xd49a6au;
constexpr uint32_t AccentDestruction = 0xc98276u;
constexpr uint32_t AccentLevel       = 0x8fa3bfu;

#if defined(FRONTIER_WITH_INTERFACE_SDK)

constexpr std::array<const char *, 8> VehicleDivisionCaptions = {
    "Overview", "Chassis", "Engine", "Tyres", "Suspension", "Lights", "HMI", "Mirrors",
};

constexpr std::array<const char *, 4> WheelCornerCaptions = {
    "Front left", "Front right", "Rear left", "Rear right",
};

constexpr std::array<const char *, 5> TyreComponentCaptions = {
    "Tyre & tread", "Tyre marks", "Smoke & fire", "Rim sparks", "Burnout",
};

constexpr std::array<EverestMaterialChip, 6> FractureMaterialLibrary = {{
    {"Concrete", 0x9aa3a8u},
    {"Brick", 0xc47b68u},
    {"Timber", 0xb89668u},
    {"Cast Iron", 0x7a848du},
    {"Tempered Glass", 0x7fc2ccu},
    {"Limestone", 0xbdb79fu},
}};

void ConstructVehicleCustomInspector(EverestVehicleParameters &Vehicle, DedicatedStudioDomain &StudioTrigger)
{
    ImDrawList                *Canvas     = ImGui::GetWindowDrawList();
    const KitFaces             Faces      = ResolveKitFaces();
    const EverestSurfaceTokens Tokens     = ResolveEverestTokens();
    const ImVec2               WinPos     = ImGui::GetWindowPos();
    const float                WinWidth   = ImGui::GetWindowSize().x;
    const float                CardLeft   = WinPos.x + 12.0f;
    const float                CardW      = std::max(120.0f, WinWidth - 24.0f);
    float                      CursorY    = ImGui::GetCursorScreenPos().y;

    // Assembly breadcrumb (.vs-path)
    char PathBuffer[128] = {};
    std::snprintf(PathBuffer, sizeof(PathBuffer), "ASSEMBLY / CONTROLVEHICLE / %s",
                  VehicleDivisionCaptions[std::min<size_t>(Vehicle.ActiveDivisionTab, 7)]);
    PaintTrackedLabel(Canvas, Faces.Medium, 10.0f, ImVec2(WinPos.x + 14.0f, CursorY + 2.0f), Tokens.TextMuted,
                      PathBuffer, 10.0f * 0.09f);
    CursorY += 18.0f;

    // 8-division navigation pills
    float StripH = 0.0f;
    ConstructCategoryTabStrip(Faces, Tokens, "##VehicleDivStrip", ImVec2(WinPos.x, CursorY), WinWidth,
                              VehicleDivisionCaptions.data(), VehicleDivisionCaptions.size(), Vehicle.ActiveDivisionTab,
                              StripH);
    CursorY += StripH;

    if (Vehicle.ActiveDivisionTab == 3) // Tyres: 4 wheels + 5 tyre components
    {
        float WheelH = 0.0f;
        ConstructCategoryTabStrip(Faces, Tokens, "##VehicleWheelStrip", ImVec2(WinPos.x, CursorY), WinWidth,
                                  WheelCornerCaptions.data(), WheelCornerCaptions.size(), Vehicle.SelectedWheelIndex,
                                  WheelH);
        CursorY += WheelH;

        float SubH = 0.0f;
        ConstructCategoryTabStrip(Faces, Tokens, "##VehicleTyreSubStrip", ImVec2(WinPos.x, CursorY), WinWidth,
                                  TyreComponentCaptions.data(), TyreComponentCaptions.size(), Vehicle.ActiveTyreSubTab,
                                  SubH);
        CursorY += SubH;
    }

    switch (Vehicle.ActiveDivisionTab)
    {
        case 0: // Overview
        {
            EverestCardRegion Assembly = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                          "Vehicle assembly", EverestGlyphCategory::Car, AccentVehicle,
                                                          0);
            ConstructMutedParagraph(
                Canvas, Faces, Tokens, Assembly,
                "One vehicle, four wheel assemblies. Wheel marks, pyro smoke and rim filings live under Tyres.");
            ConstructMonospaceReadout(Canvas, Faces, Tokens, Assembly,
                                      {"Chassis -> 64-pt convex hull & body shell",
                                       "Engine  -> twin-scroll turbo & 6-speed gearbox",
                                       "Tyres   -> 3D Hex8 Neo-Hookean FEM \xC3\x97 4",
                                       "HMI     -> centre touch tablet + hex cluster"});
            CursorY += EndEverestCard(Canvas, Tokens, Assembly);

            EverestCardRegion Telemetry = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                           "Telemetry", EverestGlyphCategory::Gauge, AccentVehicle, 1);
            char SpeedFig[32]  = {};
            char GearBadge[32] = {};
            char RpmText[32]   = {};
            char BoostText[32] = {};
            std::snprintf(SpeedFig, sizeof(SpeedFig), "%.0f", static_cast<double>(Vehicle.SpeedKilometresPerHour));
            std::snprintf(GearBadge, sizeof(GearBadge), "gear %d", Vehicle.EngagedGear);
            std::snprintf(RpmText, sizeof(RpmText), "%.0f rpm", static_cast<double>(Vehicle.EngineRpm));
            std::snprintf(BoostText, sizeof(BoostText), "%.2f bar", static_cast<double>(Vehicle.TurboBoostBar));
            ConstructHeroMetric(Canvas, Faces, Tokens, Telemetry, SpeedFig, "km/h", GearBadge, false);
            const EverestStatisticCell Cells[3] = {
                {"Engine", RpmText},
                {"Boost", BoostText},
                {"Contact", "4/4"},
            };
            ConstructStatisticRow(Canvas, Faces, Tokens, Telemetry, Cells, 3);
            ConstructToggleRow(Canvas, Faces, Tokens, Telemetry, "##AssistOn", "Countersteer assist",
                               Vehicle.CountersteerAssist, "Speed-aware slip correction; driver input takes priority");
            ConstructPrecisionSlider(Canvas, Faces, Tokens, Telemetry, "##AssistStr", "Assist strength",
                                     Vehicle.AssistStrength, 0.0f, 1.0f, "", 2, "Off", "Strong");
            CursorY += EndEverestCard(Canvas, Tokens, Telemetry);

            EverestCardRegion CamCard = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                         "Camera", EverestGlyphCategory::Camera, AccentVehicle, 2);
            const char *Rigs[5] = {"Chase", "Orbit", "Cockpit", "HMI Touch", "Tyre RL"};
            ConstructDropdownRow(Canvas, Faces, Tokens, CamCard, "##VehCamRig", "Active camera rig (C cycles)", Rigs, 5,
                                 Vehicle.CameraRigIndex);
            CursorY += EndEverestCard(Canvas, Tokens, CamCard);
            break;
        }

        case 1: // Chassis & collision
        {
            EverestCardRegion Chassis = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                         "Chassis & collision", EverestGlyphCategory::Shield,
                                                         AccentVehicle, 1);
            const EverestStatisticCell Cells[4] = {
                {"Mass", "1,460 kg"},
                {"CoM height", "0.46 m"},
                {"Hull pts", "64"},
                {"Jolt body", "active"},
            };
            ConstructStatisticRow(Canvas, Faces, Tokens, Chassis, Cells, 4);
            ConstructToggleRow(Canvas, Faces, Tokens, Chassis, "##HullXray", "Show vehicle collision overlay",
                               Vehicle.ShowCollisionOverlay, "Sampled hull points, wheel radii & contact normals");
            ConstructCollisionHullInstrument(Canvas, Faces, Tokens, Chassis, Vehicle.ShowCollisionOverlay);
            CursorY += EndEverestCard(Canvas, Tokens, Chassis);

            float TransformH = 0.0f;
            ConstructWorldTransformCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW, AccentVehicle,
                                        Vehicle.Spatial.CoordinatesMetres, Vehicle.Spatial.FocusRequested, TransformH);
            CursorY += TransformH;
            break;
        }

        case 2: // Engine
        {
            EverestCardRegion Power = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                       "Engine & turbocharger", EverestGlyphCategory::Gauge,
                                                       AccentVehicle, 1);
            char RpmText[32]   = {};
            char BoostText[32] = {};
            std::snprintf(RpmText, sizeof(RpmText), "%.0f rpm", static_cast<double>(Vehicle.EngineRpm));
            std::snprintf(BoostText, sizeof(BoostText), "%.2f bar", static_cast<double>(Vehicle.TurboBoostBar));
            const EverestStatisticCell LiveRow[3] = {{"Engine speed", RpmText}, {"Boost", BoostText}, {"Gear", "3rd"}};
            const EverestStatisticCell SpecRow[3] = {
                {"Idle", "850 rpm"}, {"Redline", "8,200 rpm"}, {"Final drive", "3.73"}};
            ConstructStatisticRow(Canvas, Faces, Tokens, Power, LiveRow, 3);
            ConstructStatisticRow(Canvas, Faces, Tokens, Power, SpecRow, 3);
            ConstructTorqueCurveInstrument(Canvas, Faces, Tokens, Power, Vehicle.EngineRpm);
            ConstructPrecisionSlider(Canvas, Faces, Tokens, Power, "##EngRpmProbe", "Live throttle / RPM probe",
                                     Vehicle.EngineRpm, 850.0f, 8200.0f, "rpm", 0);
            CursorY += EndEverestCard(Canvas, Tokens, Power);
            break;
        }

        case 3: // Tyres
        {
            const size_t Corner = std::min<size_t>(Vehicle.SelectedWheelIndex, 3);
            EverestCardRegion WheelCard = BeginEverestCard(
                Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW, WheelCornerCaptions[Corner],
                EverestGlyphCategory::CircleDot, AccentVehicle, 1,
                Corner < 2 ? "Steered front assembly" : "Driven rear assembly");
            char TempText[32]  = {};
            char TreadText[32] = {};
            std::snprintf(TempText, sizeof(TempText), "%.1f \xC2\xB0" "C",
                          static_cast<double>(Vehicle.WheelSurfaceCelsius[Corner]));
            std::snprintf(TreadText, sizeof(TreadText), "%.0f %%",
                          static_cast<double>(Vehicle.WheelTreadPercent[Corner]));
            const EverestStatisticCell CornerStats[3] = {
                {"Contact", "grounded"}, {"Surface", TempText}, {"Tread", TreadText}};
            ConstructStatisticRow(Canvas, Faces, Tokens, WheelCard, CornerStats, 3);
            CursorY += EndEverestCard(Canvas, Tokens, WheelCard);

            if (Vehicle.ActiveTyreSubTab == 0) // Tyre & 3D FEM Continuum
            {
                EverestCardRegion Fem = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                         "Tyres \xC2\xB7 3D FEM Continuum",
                                                         EverestGlyphCategory::CircleDot, AccentVehicle, 2,
                                                         "3D Hex8 Neo-Hookean FEM \xC2\xB7 2D Shell \xC2\xB7 XPBD");
                const char *Models[4] = {"3D FEM", "2D Shell", "XPBD", "Spring"};
                ConstructSegmentedRow(Canvas, Faces, Tokens, Fem, "##TyreModel", "Continuum tyre model", Models, 4,
                                      Vehicle.ContinuumModelIndex);
                ConstructPrecisionSlider(Canvas, Faces, Tokens, Fem, "##ColdF", "Front cold pressure",
                                         Vehicle.FrontColdPressureKpa, 0.0f, 400.0f, "kPa", 0, "Flat", "Over");
                ConstructPrecisionSlider(Canvas, Faces, Tokens, Fem, "##ColdR", "Rear cold pressure",
                                         Vehicle.RearColdPressureKpa, 0.0f, 400.0f, "kPa", 0, "Flat", "Over");
                ConstructToggleRow(Canvas, Faces, Tokens, Fem, "##WearOn", "Tread wear", Vehicle.TreadWearEnabled,
                                   "Sliding work abrades tread, hotter faster");
                ConstructPrecisionSlider(Canvas, Faces, Tokens, Fem, "##WearRate", "Wear rate", Vehicle.WearRateScale,
                                         0.5f, 40.0f, "\xC3\x97", 1, "Real", "Demo");
                const EverestActionButton DamageActions[3] = {
                    {"Puncture", EverestGlyphCategory::Droplets, EverestButtonStyle::Secondary},
                    {"Blowout", EverestGlyphCategory::Flame, EverestButtonStyle::Danger},
                    {"Fresh tyres", EverestGlyphCategory::RotateCcw, EverestButtonStyle::Primary},
                };
                const int Hit = ConstructActionButtons(Canvas, Faces, Tokens, Fem, "##TyreDamageRow", DamageActions, 3);
                if (Hit == 0)
                {
                    Vehicle.WheelTreadPercent[Corner] = 40.0f;
                }
                else if (Hit == 1)
                {
                    Vehicle.WheelTreadPercent[Corner] = 0.0f;
                }
                else if (Hit == 2)
                {
                    for (float &Pct : Vehicle.WheelTreadPercent)
                    {
                        Pct = 100.0f;
                    }
                }
                CursorY += EndEverestCard(Canvas, Tokens, Fem);
            }
            else if (Vehicle.ActiveTyreSubTab == 1) // Marks
            {
                EverestCardRegion Marks = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                           "Rubber deposit atlas", EverestGlyphCategory::CircleDot,
                                                           AccentVehicle, 2);
                char LaidText[32] = {};
                std::snprintf(LaidText, sizeof(LaidText), "%.0f", static_cast<double>(Vehicle.LaidRubberMetres));
                ConstructHeroMetric(Canvas, Faces, Tokens, Marks, LaidText, "m laid", "recording", false);
                ConstructToggleRow(Canvas, Faces, Tokens, Marks, "##LayRubber", "Lay rubber marks",
                                   Vehicle.LayRubberMarksEnabled);
                ConstructPrecisionSlider(Canvas, Faces, Tokens, Marks, "##MarkGain", "Deposit strength",
                                         Vehicle.MarkDepositStrength, 0.0f, 4.0f, "\xC3\x97", 2);
                CursorY += EndEverestCard(Canvas, Tokens, Marks);
            }
            else if (Vehicle.ActiveTyreSubTab == 2) // Smoke & fire
            {
                EverestCardRegion Plume = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                           "Toroidal smoke & combustion", EverestGlyphCategory::Flame,
                                                           AccentEffects, 2);
                ConstructHeroMetric(Canvas, Faces, Tokens, Plume, "160\xC3\x97" "160\xC3\x97" "96", "cells", "resident",
                                    false);
                ConstructSmokeDecayInstrument(Canvas, Faces, Tokens, Plume, Vehicle.SmokeDissipationRate,
                                              Vehicle.SmokeCoolingRate);
                ConstructBlackbodyRampInstrument(Canvas, Faces, Tokens, Plume, Vehicle.FlameTipKelvin,
                                                 Vehicle.FlameCoreKelvin);
                ConstructPrecisionSlider(Canvas, Faces, Tokens, Plume, "##PlumeEmit", "Emission rate",
                                         Vehicle.SmokeEmissionRate, 0.0f, 4.0f, "\xC3\x97", 2);
                const EverestActionButton OpenFluid{"Open Fluid & Plume Studio", EverestGlyphCategory::Flame,
                                                    EverestButtonStyle::Studio};
                if (ConstructActionButtons(Canvas, Faces, Tokens, Plume, "##OpenFluidBtn", &OpenFluid, 1) == 0)
                {
                    StudioTrigger = DedicatedStudioDomain::FluidPlumeStudio;
                }
                CursorY += EndEverestCard(Canvas, Tokens, Plume);
            }
            else if (Vehicle.ActiveTyreSubTab == 3) // Rim sparks
            {
                EverestCardRegion Sparks = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                            "Metal-contact filings", EverestGlyphCategory::Zap,
                                                            AccentVehicle, 2);
                ConstructToggleRow(Canvas, Faces, Tokens, Sparks, "##SparksOn", "Metal-contact sparks",
                                   Vehicle.MetalSparksEnabled);
                ConstructPrecisionSlider(Canvas, Faces, Tokens, Sparks, "##SparkVar", "Streak burst variation",
                                         Vehicle.SparkBurstVariation, 0.0f, 1.0f, "\xC3\x97", 2);
                CursorY += EndEverestCard(Canvas, Tokens, Sparks);
            }
            else // Burnout
            {
                EverestCardRegion Burn = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                          "Burnout \xC2\xB7 line lock", EverestGlyphCategory::Flame,
                                                          AccentEffects, 2);
                ConstructToggleRow(Canvas, Faces, Tokens, Burn, "##LineLock", "Line lock (W + S)",
                                   Vehicle.LineLockEnabled, "Clamps front calipers while rear tyres heat on limiter");
                CursorY += EndEverestCard(Canvas, Tokens, Burn);
            }
            break;
        }

        case 4: // Suspension
        {
            EverestCardRegion Struts = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                        "Four-corner calibrated struts",
                                                        EverestGlyphCategory::MoveVertical, AccentVehicle, 1);
            const EverestStatisticCell FrontRow[3] = {
                {"Spring", "38,400 N/m"}, {"Damping", "4,120 N\xC2\xB7s/m"}, {"Freq", "1.82 Hz"}};
            const EverestStatisticCell TravelRow[3] = {
                {"FL / FR", "42 / 44 mm"}, {"RL / RR", "51 / 53 mm"}, {"Contacts", "4/4"}};
            ConstructStatisticRow(Canvas, Faces, Tokens, Struts, FrontRow, 3);
            ConstructStatisticRow(Canvas, Faces, Tokens, Struts, TravelRow, 3);
            CursorY += EndEverestCard(Canvas, Tokens, Struts);
            break;
        }

        case 5: // Lights
        {
            EverestCardRegion Lights = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                        "Automotive photometric lighting", EverestGlyphCategory::Sun,
                                                        AccentVehicle, 1);
            const char *Beams[4]    = {"Off", "Low beam", "High beam", "Fog"};
            const char *Fixtures[2] = {"Slim LED lightbar", "Dual rally pods"};
            ConstructSegmentedRow(Canvas, Faces, Tokens, Lights, "##HeadBeams", "Headlights (I)", Beams, 4,
                                  Vehicle.HeadlightBeamIndex);
            ConstructToggleRow(Canvas, Faces, Tokens, Lights, "##RoofFlood", "Auxiliary roof flood (L)",
                               Vehicle.RoofAuxiliaryEnabled);
            ConstructSegmentedRow(Canvas, Faces, Tokens, Lights, "##RoofFix", "Rooftop fixture", Fixtures, 2,
                                  Vehicle.RoofFixtureIndex);
            CursorY += EndEverestCard(Canvas, Tokens, Lights);
            break;
        }

        case 6: // HMI & cabin
        {
            EverestCardRegion Hmi = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                     "Cabin HMI & hex cluster", EverestGlyphCategory::Monitor,
                                                     AccentVehicle, 1, "Live centre-stack touch tablet");
            ConstructToggleRow(Canvas, Faces, Tokens, Hmi, "##CabinScr", "Screens powered", Vehicle.CabinScreensEnabled);
            ConstructPrecisionSlider(Canvas, Faces, Tokens, Hmi, "##CabinBri", "Display luminance",
                                     Vehicle.CabinScreenBrightness, 0.0f, 1.0f, "\xC3\x97", 2);
            ConstructPrecisionSlider(Canvas, Faces, Tokens, Hmi, "##HmiScale", "Tablet housing scale",
                                     Vehicle.TabletHousingScale, 0.75f, 2.5f, "\xC3\x97", 2);
            ConstructPrecisionSlider(Canvas, Faces, Tokens, Hmi, "##CockpitFov", "Cockpit field of view",
                                     Vehicle.CockpitFovDegrees, 30.0f, 90.0f, "\xC2\xB0", 0);
            CursorY += EndEverestCard(Canvas, Tokens, Hmi);
            break;
        }

        case 7: // Mirrors
        default:
        {
            EverestCardRegion Glass = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                       "Glazing & planar off-axis mirrors", EverestGlyphCategory::Eye,
                                                       AccentVehicle, 1);
            ConstructToggleRow(Canvas, Faces, Tokens, Glass, "##SeeGlass", "See-through Fresnel glazing",
                               Vehicle.SeeThroughGlazing);
            ConstructPrecisionSlider(Canvas, Faces, Tokens, Glass, "##GlassTrans", "Optical transmission",
                                     Vehicle.GlazingTransmission, 0.20f, 0.95f, "", 2, "Limo tint", "Clear");
            const char *MirrorModes[3] = {"Off", "When visible", "Always"};
            ConstructSegmentedRow(Canvas, Faces, Tokens, Glass, "##MirrorMode", "Planar mirror views", MirrorModes, 3,
                                  Vehicle.MirrorRefreshIndex);
            ConstructMonospaceReadout(Canvas, Faces, Tokens, Glass,
                                      {"Left wing mirror   \xC2\xB7 182 \xC3\x97 108 mm",
                                       "Right wing mirror  \xC2\xB7 182 \xC3\x97 108 mm",
                                       "Cabin rear-view    \xC2\xB7 240 \xC3\x97 64 mm"});
            CursorY += EndEverestCard(Canvas, Tokens, Glass);
            break;
        }
    }

    ImGui::SetCursorScreenPos(ImVec2(WinPos.x, CursorY));
    ImGui::Dummy(ImVec2(1.0f, 8.0f));
}

void ConstructFractureCustomInspector(bool IndividualProp, EverestFractureParameters &Fracture,
                                      DedicatedStudioDomain &StudioTrigger)
{
    ImDrawList                *Canvas   = ImGui::GetWindowDrawList();
    const KitFaces             Faces    = ResolveKitFaces();
    const EverestSurfaceTokens Tokens   = ResolveEverestTokens();
    const ImVec2               WinPos   = ImGui::GetWindowPos();
    const float                WinWidth = ImGui::GetWindowSize().x;
    const float                CardLeft = WinPos.x + 12.0f;
    const float                CardW    = std::max(120.0f, WinWidth - 24.0f);
    float                      CursorY  = ImGui::GetCursorScreenPos().y + 4.0f;

    if (!IndividualProp)
    {
        EverestCardRegion Props = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                   "Breakable course props", EverestGlyphCategory::Boxes,
                                                   AccentDestruction, 1);
        char IntactFig[32] = {};
        char SubUnit[32]   = {};
        std::snprintf(IntactFig, sizeof(IntactFig), "%u", Fracture.IntactPropCount);
        std::snprintf(SubUnit, sizeof(SubUnit), "/ %u intact", Fracture.TotalPropCount);
        ConstructHeroMetric(Canvas, Faces, Tokens, Props, IntactFig, SubUnit, "2 breaks", true);
        char FragText[32] = {};
        std::snprintf(FragText, sizeof(FragText), "%u", Fracture.ActiveFragmentCount);
        const EverestStatisticCell Cells[3] = {
            {"Fragments", FragText}, {"Asleep", "12"}, {"SDF pooled", "19"}};
        ConstructStatisticRow(Canvas, Faces, Tokens, Props, Cells, 3);
        const EverestActionButton Actions[3] = {
            {"Reassemble", EverestGlyphCategory::RotateCcw, EverestButtonStyle::Secondary},
            {"Break all", EverestGlyphCategory::Hammer, EverestButtonStyle::Danger},
            {"Fracture Studio", EverestGlyphCategory::Gem, EverestButtonStyle::Studio},
        };
        const int Hit = ConstructActionButtons(Canvas, Faces, Tokens, Props, "##FracGlobalBtns", Actions, 3);
        if (Hit == 0)
        {
            Fracture.IntactPropCount     = Fracture.TotalPropCount;
            Fracture.ActiveFragmentCount = 0u;
        }
        else if (Hit == 1)
        {
            Fracture.IntactPropCount     = 0u;
            Fracture.ActiveFragmentCount = 196u;
        }
        else if (Hit == 2)
        {
            StudioTrigger = DedicatedStudioDomain::FractureStudio;
        }
        CursorY += EndEverestCard(Canvas, Tokens, Props);
    }

    EverestCardRegion MatCard = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
                                                 "Material fracture recipe", EverestGlyphCategory::Layers,
                                                 AccentDestruction, 2, "Gc resistance & convex cut partitioning");
    ConstructMaterialChips(Canvas, Faces, Tokens, MatCard, "##FracMatGrid", FractureMaterialLibrary.data(),
                           FractureMaterialLibrary.size(), Fracture.MaterialIndex);
    ConstructImpactBreakInstrument(Canvas, Faces, Tokens, MatCard, 285.0f, Fracture.BreakThresholdJoules);
    ConstructPrecisionSlider(Canvas, Faces, Tokens, MatCard, "##BreakThresh", "Break threshold",
                             Fracture.BreakThresholdJoules, 500.0f, 120000.0f, "J", 0, "Brittle", "Stops car");
    ConstructPrecisionSlider(Canvas, Faces, Tokens, MatCard, "##FragCeil", "Fragment ceiling", Fracture.FragmentCeiling,
                             4.0f, 64.0f, "pcs", 0);
    const char *CutModes[2] = {"Dynamic impact cut", "Baked Voronoi pattern"};
    ConstructSegmentedRow(Canvas, Faces, Tokens, MatCard, "##CutMode", "Partition evaluation", CutModes, 2,
                          Fracture.PartitionModeIndex);
    CursorY += EndEverestCard(Canvas, Tokens, MatCard);

    ImGui::SetCursorScreenPos(ImVec2(WinPos.x, CursorY));
    ImGui::Dummy(ImVec2(1.0f, 8.0f));
}

void ConstructParticleCustomInspector(bool IsDerezEffect, EverestParticleParameters &Particles,
                                      DedicatedStudioDomain &StudioTrigger)
{
    ImDrawList                *Canvas   = ImGui::GetWindowDrawList();
    const KitFaces             Faces    = ResolveKitFaces();
    const EverestSurfaceTokens Tokens   = ResolveEverestTokens();
    const ImVec2               WinPos   = ImGui::GetWindowPos();
    const float                WinWidth = ImGui::GetWindowSize().x;
    const float                CardLeft = WinPos.x + 12.0f;
    const float                CardW    = std::max(120.0f, WinWidth - 24.0f);
    float                      CursorY  = ImGui::GetCursorScreenPos().y + 4.0f;

    EverestCardRegion Card = BeginEverestCard(
        Canvas, Faces, Tokens, ImVec2(CardLeft, CursorY), CardW,
        IsDerezEffect ? "Derez dissolve VFX" : "GPU particle emitters", EverestGlyphCategory::Sparkles, AccentEffects,
        1, "Compute indirect dispatch + depth-softened billboards");
    char CountFig[32] = {};
    std::snprintf(CountFig, sizeof(CountFig), "%u", Particles.LiveParticleCount);
    ConstructHeroMetric(Canvas, Faces, Tokens, Card, CountFig, "particles", "GPU active", false);
    ConstructToggleRow(Canvas, Faces, Tokens, Card, "##GpuSimOn", "Async compute simulation", Particles.GpuSimEnabled);
    ConstructPrecisionSlider(Canvas, Faces, Tokens, Card, "##PartSpawn", "Spawn rate", Particles.EmissionRatePerSecond,
                             0.0f, 4000.0f, "/s", 0);
    ConstructPrecisionSlider(Canvas, Faces, Tokens, Card, "##PartLife", "Lifetime", Particles.LifetimeSeconds, 0.2f,
                             8.0f, "s", 2);
    ConstructPrecisionSlider(Canvas, Faces, Tokens, Card, "##PartDrag", "Aerodynamic drag", Particles.DragCoefficient,
                             0.0f, 2.0f, "1/s", 2);
    const EverestActionButton OpenBtn{"Open Particle Authoring Studio", EverestGlyphCategory::Sparkles,
                                      EverestButtonStyle::Studio};
    if (ConstructActionButtons(Canvas, Faces, Tokens, Card, "##OpenPartStudio", &OpenBtn, 1) == 0)
    {
        StudioTrigger = DedicatedStudioDomain::ParticleStudio;
    }
    CursorY += EndEverestCard(Canvas, Tokens, Card);

    ImGui::SetCursorScreenPos(ImVec2(WinPos.x, CursorY));
    ImGui::Dummy(ImVec2(1.0f, 8.0f));
}

#endif // FRONTIER_WITH_INTERFACE_SDK

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                             TYPED RAII SCENE RECORDS
//------------------------------------------------------------------------------------------------------------------------

EverestEngineRecord::EverestEngineRecord(RecordClassification Classification, const char *DisplayName,
                                         EngineInspectorDomain Domain, const char *GroupCaption,
                                         const char *EyebrowCaption, const char *MetaCaption, uint32_t AccentRgb,
                                         EngineSpatialParameters *OptionalSpatial, DedicatedStudioDomain LinkedStudio,
                                         RecordToken Enclosure)
    : RecordEntry(Classification)
{
    if (OptionalSpatial != nullptr)
    {
        LocalSpatial = *OptionalSpatial;
    }
#if defined(FRONTIER_EDITOR_PROFILE) || defined(FRONTIER_DEVELOPMENT_PROFILE)
    SceneDirectory::Instance().ConfigureName(Token(), DisplayName != nullptr ? DisplayName : "Engine Record");
    if (Enclosure.IsValid())
    {
        SceneDirectory::Instance().ConfigureParent(Token(), Enclosure);
    }
    InspectorCatalogue::Instance().BindEnginePreset(
        Token(), Domain, GroupCaption != nullptr ? GroupCaption : "Environment",
        EyebrowCaption != nullptr ? EyebrowCaption : "ENGINE COMPONENT", MetaCaption != nullptr ? MetaCaption : "",
        AccentRgb, &LocalSpatial, LinkedStudio);
#endif
}

ControlVehicleRecord::ControlVehicleRecord(EverestVehicleParameters &Parameters, DedicatedStudioDomain &StudioTrigger)
    : RecordEntry(RecordClassification::Vehicle)
{
#if defined(FRONTIER_EDITOR_PROFILE) || defined(FRONTIER_DEVELOPMENT_PROFILE)
    SceneDirectory::Instance().ConfigureName(Token(), "ControlVehicle");
    InspectorCatalogue::Instance().BindCustomInspector(
        Token(), "Vehicle", "USER CUSTOM ASSEMBLY \xC2\xB7 8 DIVISIONS", "84 km/h \xC2\xB7 G3", AccentVehicle,
        [&Parameters, &StudioTrigger]()
        {
#if defined(FRONTIER_WITH_INTERFACE_SDK)
            ConstructVehicleCustomInspector(Parameters, StudioTrigger);
#else
            (void)Parameters;
            (void)StudioTrigger;
#endif
        },
        &Parameters);
#else
    (void)Parameters;
    (void)StudioTrigger;
#endif
}

EverestFractureRecord::EverestFractureRecord(const char *DisplayName, bool IsIndividualProp,
                                             EverestFractureParameters &Parameters,
                                             DedicatedStudioDomain &StudioTrigger)
    : RecordEntry(RecordClassification::Physics)
{
#if defined(FRONTIER_EDITOR_PROFILE) || defined(FRONTIER_DEVELOPMENT_PROFILE)
    SceneDirectory::Instance().ConfigureName(Token(), DisplayName != nullptr ? DisplayName : "Fracture");
    InspectorCatalogue::Instance().BindStudioInspector(
        Token(), DedicatedStudioDomain::FractureStudio, "Destruction",
        IsIndividualProp ? "BREAKABLE CONVEX PROP" : "DEDICATED STUDIO \xC2\xB7 FRACTURE",
        IsIndividualProp ? "intact" : "16/18", AccentDestruction,
        [IsIndividualProp, &Parameters, &StudioTrigger]()
        {
#if defined(FRONTIER_WITH_INTERFACE_SDK)
            ConstructFractureCustomInspector(IsIndividualProp, Parameters, StudioTrigger);
#else
            (void)IsIndividualProp;
            (void)Parameters;
            (void)StudioTrigger;
#endif
        },
        &Parameters);
#else
    (void)DisplayName;
    (void)IsIndividualProp;
    (void)Parameters;
    (void)StudioTrigger;
#endif
}

EverestParticleRecord::EverestParticleRecord(const char *DisplayName, bool IsDerezEffect,
                                             EverestParticleParameters &Parameters,
                                             DedicatedStudioDomain &StudioTrigger)
    : RecordEntry(RecordClassification::Illumination)
{
#if defined(FRONTIER_EDITOR_PROFILE) || defined(FRONTIER_DEVELOPMENT_PROFILE)
    SceneDirectory::Instance().ConfigureName(Token(), DisplayName != nullptr ? DisplayName : "Particles");
    InspectorCatalogue::Instance().BindStudioInspector(
        Token(), DedicatedStudioDomain::ParticleStudio, "Effects",
        IsDerezEffect ? "DEDICATED STUDIO \xC2\xB7 DEREZ VFX" : "DEDICATED STUDIO \xC2\xB7 PARTICLES",
        IsDerezEffect ? "dissolve" : "14.8k", AccentEffects,
        [IsDerezEffect, &Parameters, &StudioTrigger]()
        {
#if defined(FRONTIER_WITH_INTERFACE_SDK)
            ConstructParticleCustomInspector(IsDerezEffect, Parameters, StudioTrigger);
#else
            (void)IsDerezEffect;
            (void)Parameters;
            (void)StudioTrigger;
#endif
        },
        &Parameters);
#else
    (void)DisplayName;
    (void)IsDerezEffect;
    (void)Parameters;
    (void)StudioTrigger;
#endif
}

EverestCourseRecord::EverestCourseRecord(const char *DisplayName, const char *MetaCaption, const char *DescriptionText)
    : RecordEntry(RecordClassification::Content)
    , StoredDescription(DescriptionText != nullptr ? DescriptionText : "")
{
#if defined(FRONTIER_EDITOR_PROFILE) || defined(FRONTIER_DEVELOPMENT_PROFILE)
    SceneDirectory::Instance().ConfigureName(Token(), DisplayName != nullptr ? DisplayName : "Course");
    InspectorCatalogue::Instance().BindCustomInspector(
        Token(), "Level", "PROVING GROUNDS COURSE SECTOR", MetaCaption != nullptr ? MetaCaption : "sector", AccentLevel,
        [this]()
        {
#if defined(FRONTIER_WITH_INTERFACE_SDK)
            ImDrawList                *Canvas   = ImGui::GetWindowDrawList();
            const KitFaces             Faces    = ResolveKitFaces();
            const EverestSurfaceTokens Tokens   = ResolveEverestTokens();
            const ImVec2               WinPos   = ImGui::GetWindowPos();
            const float                WinWidth = ImGui::GetWindowSize().x;
            float                      CursorY  = ImGui::GetCursorScreenPos().y + 4.0f;

            EverestCardRegion Card = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(WinPos.x + 12.0f, CursorY),
                                                      std::max(120.0f, WinWidth - 24.0f), "Course sector configuration",
                                                      EverestGlyphCategory::Layers, AccentLevel, 1);
            ConstructMutedParagraph(Canvas, Faces, Tokens, Card, StoredDescription.c_str());
            ConstructToggleRow(Canvas, Faces, Tokens, Card, "##SectorActive", "Sector active in proving grounds",
                               ActiveSegment);
            ConstructPrecisionSlider(Canvas, Faces, Tokens, Card, "##PropDens", "Obstacle layout density",
                                     DensityMultiplier, 0.25f, 2.0f, "\xC3\x97", 2);
            CursorY += EndEverestCard(Canvas, Tokens, Card);
            ImGui::SetCursorScreenPos(ImVec2(WinPos.x, CursorY));
            ImGui::Dummy(ImVec2(1.0f, 8.0f));
#endif
        },
        this);
#else
    (void)DisplayName;
    (void)MetaCaption;
#endif
}

//------------------------------------------------------------------------------------------------------------------------
//                                           PROVING GROUNDS SCENE ASSEMBLY
//------------------------------------------------------------------------------------------------------------------------

EverestSceneAssembly::EverestSceneAssembly()
{
    const auto Track = [this](std::unique_ptr<RecordEntry> Created) -> RecordToken
    {
        const RecordToken Issued = Created->Token();
        OrderedTokens.push_back(Issued);
        OwnedRecords.push_back(std::move(Created));
        return Issued;
    };

    // 1. Render group (5 reusable engine records)
    Track(std::make_unique<EverestEngineRecord>(RecordClassification::Illumination, "Diagnostics",
                                                EngineInspectorDomain::Diagnostics, "Render",
                                                "ENGINE REUSABLE \xC2\xB7 DIAGNOSTICS", "6.9 ms", AccentRender));
    Track(std::make_unique<EverestEngineRecord>(RecordClassification::Geometry, "Geometry clusters",
                                                EngineInspectorDomain::GeometryClusters, "Render",
                                                "ENGINE REUSABLE \xC2\xB7 CLUSTERS", "1,482", AccentRender, nullptr,
                                                DedicatedStudioDomain::ClusterStudio));
    RenderSettingsToken = Track(std::make_unique<EverestEngineRecord>(
        RecordClassification::Illumination, "Render settings", EngineInspectorDomain::RenderSettings, "Render",
        "ENGINE REUSABLE \xC2\xB7 RENDERER", "RTX/GTX", AccentRender));
    Track(std::make_unique<EverestEngineRecord>(RecordClassification::Illumination, "BVH & distance field",
                                                EngineInspectorDomain::AccelerationAndDistance, "Render",
                                                "ENGINE REUSABLE \xC2\xB7 ACCELERATION", "12.2k", AccentRender));
    Track(std::make_unique<EverestEngineRecord>(RecordClassification::Illumination, "Surface cache",
                                                EngineInspectorDomain::SurfaceCache, "Render",
                                                "ENGINE REUSABLE \xC2\xB7 SURFACE CARDS", "1,536", AccentRender));

    // 2. Environment group (11 reusable engine records, with Lens Flare nested under Sun!)
    SunToken = Track(std::make_unique<EverestEngineRecord>(
        RecordClassification::Environment, "Sun", EngineInspectorDomain::Sun, "Environment",
        "ENGINE REUSABLE \xC2\xB7 SOLAR", "26.5\xC2\xB0", AccentEnvironment));
    Track(std::make_unique<EverestEngineRecord>(RecordClassification::Environment, "Lens Flare",
                                                EngineInspectorDomain::LensFlare, "Environment",
                                                "ENGINE REUSABLE \xC2\xB7 OPTICS", "child", AccentEnvironment, nullptr,
                                                DedicatedStudioDomain::None, SunToken));
    Track(std::make_unique<EverestEngineRecord>(RecordClassification::Environment, "Clouds",
                                                EngineInspectorDomain::Clouds, "Environment",
                                                "ENGINE REUSABLE \xC2\xB7 CLOUDSCAPE", "42%", AccentEnvironment));
    EngineSpatialParameters LocalCloudCoords{{24.0f, 38.0f, -16.0f}, false};
    Track(std::make_unique<EverestEngineRecord>(RecordClassification::Environment, "Local Cloud",
                                                EngineInspectorDomain::LocalCloud, "Environment",
                                                "ENGINE REUSABLE \xC2\xB7 VOLUME", "local", AccentEnvironment,
                                                &LocalCloudCoords));
    Track(std::make_unique<EverestEngineRecord>(RecordClassification::Environment, "Local Volumetric Fog",
                                                EngineInspectorDomain::LocalVolumetricFog, "Environment",
                                                "ENGINE REUSABLE \xC2\xB7 FROXEL FOG", "froxel", AccentEnvironment));
    Track(std::make_unique<EverestEngineRecord>(RecordClassification::Environment, "Atmosphere",
                                                EngineInspectorDomain::Atmosphere, "Environment",
                                                "ENGINE REUSABLE \xC2\xB7 SKY LUT", "Hillaire", AccentEnvironment));
    Track(std::make_unique<EverestEngineRecord>(RecordClassification::Environment, "Stars",
                                                EngineInspectorDomain::Stars, "Environment",
                                                "ENGINE REUSABLE \xC2\xB7 CELESTIAL", "mag 5.8", AccentEnvironment));
    Track(std::make_unique<EverestEngineRecord>(RecordClassification::Environment, "Moons",
                                                EngineInspectorDomain::Moons, "Environment",
                                                "ENGINE REUSABLE \xC2\xB7 CELESTIAL", "0.68", AccentEnvironment));
    Track(std::make_unique<EverestEngineRecord>(RecordClassification::Environment, "Height Fog",
                                                EngineInspectorDomain::HeightFog, "Environment",
                                                "ENGINE REUSABLE \xC2\xB7 FOG", "0.018", AccentEnvironment));
    Track(std::make_unique<EverestEngineRecord>(RecordClassification::Environment, "Atmospheric Fog",
                                                EngineInspectorDomain::AtmosphericFog, "Environment",
                                                "ENGINE REUSABLE \xC2\xB7 HAZE", "aerial", AccentEnvironment));
    Track(std::make_unique<EverestEngineRecord>(RecordClassification::Environment, "Lightning & thunder",
                                                EngineInspectorDomain::Lightning, "Environment",
                                                "ENGINE REUSABLE \xC2\xB7 STORM", "standby", AccentEnvironment));

    // 3. Forcefield group (1 reusable engine record)
    Track(std::make_unique<EverestEngineRecord>(RecordClassification::Environment, "Wind", EngineInspectorDomain::Wind,
                                                "Forcefield", "ENGINE REUSABLE \xC2\xB7 FORCEFIELD", "4.8 m/s",
                                                AccentForcefield));

    // 4. Objects group (2 spatial records)
    EngineSpatialParameters PylonNorth{{-12.5f, 0.0f, 28.0f}, false};
    EngineSpatialParameters PylonSouth{{14.0f, 0.0f, -19.5f}, false};
    Track(std::make_unique<EverestEngineRecord>(RecordClassification::Geometry, "Timing gantry",
                                                EngineInspectorDomain::TransformOnly, "Objects",
                                                "SPATIAL SCENE RECORD", "static", AccentObjects, &PylonNorth));
    Track(std::make_unique<EverestEngineRecord>(RecordClassification::Geometry, "Calibration rig",
                                                EngineInspectorDomain::TransformOnly, "Objects",
                                                "SPATIAL SCENE RECORD", "static", AccentObjects, &PylonSouth));

    // 5. Vehicle group (User-authored custom inspector!)
    VehicleToken = Track(std::make_unique<ControlVehicleRecord>(Vehicle, PendingStudioRequest));

    // 6. Effects group (Dedicated Particle Studio records!)
    ParticlesToken = Track(std::make_unique<EverestParticleRecord>("Particles", false, Particles, PendingStudioRequest));
    Track(std::make_unique<EverestParticleRecord>("Derez \xC2\xB7 VFX", true, Particles, PendingStudioRequest));

    // 7. Destruction group (Dedicated Fracture Studio + breakable convex props!)
    FractureToken =
        Track(std::make_unique<EverestFractureRecord>("Fracture", false, Fracture, PendingStudioRequest));
    Track(std::make_unique<EverestFractureRecord>("Barrier A \xC2\xB7 concrete", true, Fracture, PendingStudioRequest));
    Track(std::make_unique<EverestFractureRecord>("Crate B \xC2\xB7 timber", true, Fracture, PendingStudioRequest));
    Track(std::make_unique<EverestFractureRecord>("Bollard C \xC2\xB7 glass", true, Fracture, PendingStudioRequest));

    // 8. Level group (4 custom course sectors)
    Track(std::make_unique<EverestCourseRecord>("Training arena", "sector 01",
                                                "Open skidpad with wet/dry asphalt calibration strips and hangar bays."));
    Track(std::make_unique<EverestCourseRecord>("Cones", "48 cones",
                                                "Slalom & chicane flexible Jolt cones with two-way tyre impulse."));
    Track(std::make_unique<EverestCourseRecord>("Proving grounds", "main loop",
                                                "Full perimeter circuit, illuminated tunnel, ramps and street lamps."));
    Track(std::make_unique<EverestCourseRecord>("Stress test", "benchmark",
                                                "High-density convex debris, IES light cluster & smoke stress sector."));
}

EverestSceneAssembly::~EverestSceneAssembly() = default;

RecordToken EverestSceneAssembly::ConstructDynamicTestProp(const char *DisplayName)
{
    auto Created     = std::make_unique<EverestFractureRecord>(DisplayName, true, Fracture, PendingStudioRequest);
    RecordToken Tok  = Created->Token();
    OrderedTokens.push_back(Tok);
    OwnedRecords.push_back(std::move(Created));
    return Tok;
}

bool EverestSceneAssembly::DestroyDynamicRecord(RecordToken Token)
{
    const auto OrderIt = std::find(OrderedTokens.begin(), OrderedTokens.end(), Token);
    if (OrderIt != OrderedTokens.end())
    {
        OrderedTokens.erase(OrderIt);
    }
    for (auto Iterator = OwnedRecords.begin(); Iterator != OwnedRecords.end(); ++Iterator)
    {
        if ((*Iterator)->Token() == Token)
        {
            OwnedRecords.erase(Iterator); // Triggers ~RecordEntry() -> Unregister from InspectorCatalogue & SceneDirectory!
            return true;
        }
    }
    return false;
}

#if defined(FRONTIER_WITH_INTERFACE_SDK)

void EverestSceneAssembly::ConstructParticleStudioInterface()
{
    ImDrawList                *Canvas     = ImGui::GetWindowDrawList();
    const KitFaces             Faces      = ResolveKitFaces();
    const EverestSurfaceTokens Tokens     = ResolveEverestTokens();
    const ImVec2               WinPos     = ImGui::GetWindowPos();
    const ImVec2               WinSize    = ImGui::GetWindowSize();
    const ImVec2               Origin(WinPos.x, ImGui::GetCursorScreenPos().y);
    const ImVec2               Extent(WinSize.x, std::max(60.0f, (WinPos.y + WinSize.y) - Origin.y));
    Canvas->AddRectFilled(Origin, ImVec2(Origin.x + Extent.x, Origin.y + Extent.y), Tokens.Column);

    ConstructInspectorTopBar(Faces, Tokens, Origin, Extent.x, "Particle Studio \xC2\xB7 GPU Authoring");
    float CursorY = Origin.y + 52.0f;
    const char *Emitters[4] = {"Tyre Plume Ribbon", "Rim Contact Filings", "Derez Dissolve", "Wake Dust"};
    float TabH = 0.0f;
    ConstructCategoryTabStrip(Faces, Tokens, "##PartStudioTabs", ImVec2(Origin.x, CursorY), Extent.x, Emitters, 4,
                              Particles.ActiveEmitterIndex, TabH);
    CursorY += TabH;

    const float HalfW = std::max(160.0f, (Extent.x - 36.0f) * 0.5f);
    EverestCardRegion LeftCard = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(Origin.x + 12.0f, CursorY), HalfW,
                                                  "Emitter stack & GPU budget", EverestGlyphCategory::Sparkles,
                                                  AccentEffects, 1);
    char LiveFig[32] = {};
    std::snprintf(LiveFig, sizeof(LiveFig), "%u", Particles.LiveParticleCount);
    ConstructHeroMetric(Canvas, Faces, Tokens, LeftCard, LiveFig, "resident", "0.31 ms compute", false);
    ConstructPrecisionSlider(Canvas, Faces, Tokens, LeftCard, "##StudioRate", "Spawn rate",
                             Particles.EmissionRatePerSecond, 0.0f, 4000.0f, "/s", 0);
    ConstructPrecisionSlider(Canvas, Faces, Tokens, LeftCard, "##StudioLife", "Lifetime", Particles.LifetimeSeconds,
                             0.2f, 8.0f, "s", 2);
    ConstructPrecisionSlider(Canvas, Faces, Tokens, LeftCard, "##StudioSpd", "Launch speed",
                             Particles.InitialSpeedMetresPerSec, 0.5f, 30.0f, "m/s", 1);
    EndEverestCard(Canvas, Tokens, LeftCard);

    EverestCardRegion RightCard = BeginEverestCard(
        Canvas, Faces, Tokens, ImVec2(Origin.x + 24.0f + HalfW, CursorY), HalfW,
        "Opacity & thermal curve over normalized age", EverestGlyphCategory::Activity, AccentEffects, 2);
    ConstructSmokeDecayInstrument(Canvas, Faces, Tokens, RightCard, Particles.DragCoefficient * 0.6f, 0.28f);
    ConstructToggleRow(Canvas, Faces, Tokens, RightCard, "##StudioSoftZ", "Depth-buffer soft intersection",
                       Particles.DepthSoftFadeEnabled);
    ConstructMonospaceReadout(Canvas, Faces, Tokens, RightCard,
                              {"IndirectDrawBuffer  : 65,536 capacity",
                               "SortKey             : 16-bit view-space Z radix"});
    EndEverestCard(Canvas, Tokens, RightCard);
}

void EverestSceneAssembly::ConstructFractureStudioInterface()
{
    ImDrawList                *Canvas  = ImGui::GetWindowDrawList();
    const KitFaces             Faces   = ResolveKitFaces();
    const EverestSurfaceTokens Tokens  = ResolveEverestTokens();
    const ImVec2               WinPos  = ImGui::GetWindowPos();
    const ImVec2               WinSize = ImGui::GetWindowSize();
    const ImVec2               Origin(WinPos.x, ImGui::GetCursorScreenPos().y);
    const ImVec2               Extent(WinSize.x, std::max(60.0f, (WinPos.y + WinSize.y) - Origin.y));
    Canvas->AddRectFilled(Origin, ImVec2(Origin.x + Extent.x, Origin.y + Extent.y), Tokens.Column);

    ConstructInspectorTopBar(Faces, Tokens, Origin, Extent.x, "Fracture Studio \xC2\xB7 Convex Partitioning");
    const float CursorY = Origin.y + 54.0f;
    const float HalfW   = std::max(160.0f, (Extent.x - 36.0f) * 0.5f);

    EverestCardRegion LeftCard = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(Origin.x + 12.0f, CursorY), HalfW,
                                                  "Material Gc & impact threshold", EverestGlyphCategory::Gem,
                                                  AccentDestruction, 1);
    ConstructMaterialChips(Canvas, Faces, Tokens, LeftCard, "##StudioFracMats", FractureMaterialLibrary.data(),
                           FractureMaterialLibrary.size(), Fracture.MaterialIndex);
    ConstructImpactBreakInstrument(Canvas, Faces, Tokens, LeftCard, 285.0f, Fracture.BreakThresholdJoules);
    ConstructPrecisionSlider(Canvas, Faces, Tokens, LeftCard, "##StudioThresh", "Threshold energy",
                             Fracture.BreakThresholdJoules, 500.0f, 120000.0f, "J", 0);
    EndEverestCard(Canvas, Tokens, LeftCard);

    EverestCardRegion RightCard = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(Origin.x + 24.0f + HalfW, CursorY),
                                                   HalfW, "Exploded convex geometry receipt",
                                                   EverestGlyphCategory::Layers, AccentDestruction, 2);
    ConstructPrecisionSlider(Canvas, Faces, Tokens, RightCard, "##StudioExplode", "Exploded preview separation",
                             Fracture.PreviewSeparation, 0.0f, 1.0f, "", 2);
    const EverestStatisticCell Receipt[3] = {
        {"Fragments", "28"}, {"Volume err", "1.2e-6"}, {"Topology", "Closed"}};
    ConstructStatisticRow(Canvas, Faces, Tokens, RightCard, Receipt, 3);
    ConstructMonospaceReadout(Canvas, Faces, Tokens, RightCard,
                              {"Needle rejection          : passed (0 slivers)",
                               "Interior planar cap UVs   : watertight",
                               "Dynamic SDF pool bricks   : 19 allocated"});
    EndEverestCard(Canvas, Tokens, RightCard);
}

void EverestSceneAssembly::ConstructFluidPlumeStudioInterface()
{
    ImDrawList                *Canvas  = ImGui::GetWindowDrawList();
    const KitFaces             Faces   = ResolveKitFaces();
    const EverestSurfaceTokens Tokens  = ResolveEverestTokens();
    const ImVec2               WinPos  = ImGui::GetWindowPos();
    const ImVec2               WinSize = ImGui::GetWindowSize();
    const ImVec2               Origin(WinPos.x, ImGui::GetCursorScreenPos().y);
    const ImVec2               Extent(WinSize.x, std::max(60.0f, (WinPos.y + WinSize.y) - Origin.y));
    Canvas->AddRectFilled(Origin, ImVec2(Origin.x + Extent.x, Origin.y + Extent.y), Tokens.Column);

    ConstructInspectorTopBar(Faces, Tokens, Origin, Extent.x, "Fluid & Plume Studio \xC2\xB7 Slate Pyro Lattice");
    const float CursorY = Origin.y + 54.0f;
    const float HalfW   = std::max(160.0f, (Extent.x - 36.0f) * 0.5f);

    EverestCardRegion LeftCard = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(Origin.x + 12.0f, CursorY), HalfW,
                                                  "Toroidal transport & decay", EverestGlyphCategory::Wind,
                                                  AccentEffects, 1);
    ConstructHeroMetric(Canvas, Faces, Tokens, LeftCard, "160\xC3\x97" "160\xC3\x97" "96", "voxels", "60 Hz warm-start",
                        false);
    ConstructSmokeDecayInstrument(Canvas, Faces, Tokens, LeftCard, Vehicle.SmokeDissipationRate,
                                  Vehicle.SmokeCoolingRate);
    ConstructPrecisionSlider(Canvas, Faces, Tokens, LeftCard, "##FluidDiss", "Density dissipation",
                             Vehicle.SmokeDissipationRate, 0.02f, 0.80f, "1/s", 2);
    ConstructPrecisionSlider(Canvas, Faces, Tokens, LeftCard, "##FluidCool", "Thermal cooling",
                             Vehicle.SmokeCoolingRate, 0.02f, 0.80f, "1/s", 2);
    EndEverestCard(Canvas, Tokens, LeftCard);

    EverestCardRegion RightCard = BeginEverestCard(Canvas, Faces, Tokens, ImVec2(Origin.x + 24.0f + HalfW, CursorY),
                                                   HalfW, "Combustion & Helland blackbody ramp",
                                                   EverestGlyphCategory::Flame, AccentEffects, 2);
    ConstructBlackbodyRampInstrument(Canvas, Faces, Tokens, RightCard, Vehicle.FlameTipKelvin, Vehicle.FlameCoreKelvin);
    ConstructPrecisionSlider(Canvas, Faces, Tokens, RightCard, "##FluidTipK", "Flame tip temperature",
                             Vehicle.FlameTipKelvin, 800.0f, 2200.0f, "K", 0);
    ConstructPrecisionSlider(Canvas, Faces, Tokens, RightCard, "##FluidCoreK", "Flame core temperature",
                             Vehicle.FlameCoreKelvin, 1600.0f, 4000.0f, "K", 0);
    EndEverestCard(Canvas, Tokens, RightCard);
}

#endif // FRONTIER_WITH_INTERFACE_SDK

} // namespace Frontier
