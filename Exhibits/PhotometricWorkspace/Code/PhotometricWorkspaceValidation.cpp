// Photometric workspace validation: the U5 UI shell (rig tab bar, luminaire + environment outliner, quick
// photometry chips, lens/camera HUD, luminaire stage, diurnal transport, console drawer, light + environment
// inspectors, IES goniometer matrix, add-light drawer) with scripted pointer interaction and PPM evidence per
// scenario. Value controls hold shell-local figures and log PARAM lines; engine-bound commands raise NOOP toasts
// and warm log lines and change nothing.

#include "Frontier/Engine/Interface/Workspaces/PhotometricWorkspace.h"
#include "Frontier/Engine/Rendering/GlobalIllumination/LuminaireRegister.h"
#include "Frontier/Engine/Interface/Workspaces/PhotometricIesFileDialog.h"
#include "Frontier/Engine/Interface/Controls/Toast.h"
#include "Frontier/Engine/Interface/InspectorControls.h"
#include "Engine/Interface/TypefaceRegistry.h"
#include "Exhibits/ControlCentre/Code/CpuRasterization.h"

#include <imgui.h>

#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace
{

void Confirm(bool Condition, const char* Description)
{
    if (!Condition) throw std::runtime_error(Description);
}

} // namespace

int main(int ArgumentCount, char** Arguments)
{
    using namespace Frontier;
    try
    {
        ImGui::CreateContext();
        ImGui::StyleColorsDark();
        ImGuiIO& IO = ImGui::GetIO();
        IO.DisplaySize = ImVec2(1560.0f, 1900.0f);
        IO.DeltaTime = 1.0f / 60.0f;
        // 📝 Production typefaces (DM Sans + the JetBrains Mono symbol fallback) so evidence matches the app;
        //    argv[2] is the font-archive root, defaulting to the in-tree EngineContent path.
        TypefaceRegistry   FontRegistry;
        static const char* WantedFonts[] = { "DM Sans", "JetBrains Mono" };
        const char*        ArchiveRoot   = ArgumentCount >= 3 ? Arguments[2] : "EngineContent/FontArchives";
        const uint32_t     FontFamilies  = FontRegistry.Load(ArchiveRoot, WantedFonts, 2);
        if (ArgumentCount >= 3) Confirm(FontFamilies == 2, "The font archive root did not yield DM Sans and JetBrains Mono");
        if (FontFamilies == 0) IO.Fonts->AddFontDefault();
        else TypefaceRegistry::Install(&FontRegistry);
        IO.Fonts->Build();

        const EditorTypefaces Faces = EditorTypefaces::Resolve();
        PhotometricWorkspaceState State{};
        ConstructPhotometricWorkspaceState(State);
        AssetBrowserLink Link{};
        bool PreviewCallbackCalled = false;
        const PhotometricViewportPresenter PreviewHook = [&](const SceneViewportRequest& Request)
        {
            PreviewCallbackCalled = true;
            Confirm(Request.ReplaceLuminaires && !Request.Luminaires.empty(), "Photometric stage did not forward its active rig to the host renderer callback");
            return SceneViewportImage{}; // no fake texture: this validation is UI proof, not a GPU render capture.
        };

        const auto Frame = [&]()
        {
            ImGui::NewFrame();
            ConstructPhotometricWorkspace(State, Faces, IO.DisplaySize, &Link, PreviewHook, IO.DeltaTime);
            ImGui::Render();
        };
        const auto RectCentre = [&](const char* Name)
        {
            ImVec2 Min{}, Max{};
            char   Missing[128]{};
            std::snprintf(Missing, sizeof(Missing), "Missing validation rect %s", Name);
            Confirm(QueryPhotometricWorkspaceRect(State, Name, Min, Max), Missing);
            Confirm(Max.x > Min.x && Max.y > Min.y, Missing);
            return ImVec2(0.5f * (Min.x + Max.x), 0.5f * (Min.y + Max.y));
        };
        const auto Click = [&](const char* Name)
        {
            const ImVec2 At = RectCentre(Name);
            IO.AddMousePosEvent(At.x, At.y);
            Frame();
            IO.AddMouseButtonEvent(ImGuiMouseButton_Left, true);
            Frame();
            IO.AddMouseButtonEvent(ImGuiMouseButton_Left, false);
            Frame();
            Frame();
        };

        // 1. Boot: the studio opens on the ECE low beam with the default rig (roadway tab highlighted but not
        //    applied); catalogues hold pinned order.
        Frame();
        Frame();
        Confirm(PreviewCallbackCalled, "The photometric workspace never called the host's native renderer bridge");
        Confirm(QueryPhotometricLightSpecCount() == 7, "The light-type catalogue lost entries");
        Confirm(QueryPhotometricMeasuredIesCount() == 7, "The measured IES catalogue lost entries");
        Confirm(std::strcmp(QueryPhotometricMeasuredIes(0), "LowBeam") == 0, "LowBeam is out of order");
        Confirm(std::strcmp(QueryPhotometricMeasuredIes(4), "Area") == 0, "Area is out of order");
        Confirm(QueryPhotometricPresetIesCount() == 8, "The Project Zero catalogue lost entries");
        Confirm(std::strcmp(QueryPhotometricPresetIes(2), "Batwing") == 0, "Batwing is out of order");
        Confirm(std::strcmp(QueryPhotometricPresetIes(3), "ECE Low Beam") == 0, "ECE Low Beam is out of order");
        Confirm(QueryPhotometricMoonCount() == 6, "The moon catalogue lost entries");
        Confirm(State.Selected == 0, "The workspace did not boot on the ECE low beam");
        Confirm(State.Scenario == PhotometricWorkspaceState::ScenarioRoadway, "The workspace did not boot the roadway tab");
        Confirm(State.Camera == PhotometricWorkspaceState::CameraOrbit, "The workspace did not boot the orbit camera");
        Confirm(std::fabs(State.Sun.LocalHours - 14.5) < 1.0e-9, "The workspace did not boot at 14:30 site time");
        Confirm(State.Log.size() == 1, "The boot produced the wrong number of log lines");
        Confirm(State.Log.front().Channel == "RIG", "The boot line missed its RIG channel");
        {
            const SceneViewportRequest Preview = BuildPhotometricPreviewRequest(State, 900.0f, 600.0f, 2.0f, 1.0 / 30.0);
            Confirm(Preview.ReplaceLuminaires, "The native preview did not replace proving-ground lights with the staged rig");
            Confirm(Preview.OverrideSolar && Preview.SolarEnabled && Preview.SolarIlluminanceKilolux > 0.0,
                    "The native preview did not carry Photometric Studio's staged sun settings");
            Confirm(Preview.PreviewSkyScale > 0.0 && Preview.PreviewReflectionScale > 0.0,
                    "The native preview did not carry the staged dome/skylight response");
            Confirm(Preview.PanelWidth == 900.0f && Preview.PanelHeight == 600.0f && Preview.PixelDensity == 2.0f,
                    "The native preview request lost the stage extent or pixel density");
            Confirm(Preview.Luminaires.size() == 6, "The staged photometric rig did not expose its six visible luminaires to the renderer");
            Confirm(Preview.Luminaires.front().Category == 2u,
                    "The measured ECE low beam did not map onto the native ReSTIR low-beam light model");
            Confirm(std::fabs(Preview.Luminaires.front().Position[0] + 41.15) < 1.0e-9,
                    "The staged light was not transformed from Photometric Studio coordinates into the renderer's world");
            Confirm(Preview.Luminaires.front().Intensity > 0.0 && Preview.Luminaires.front().Reach > 0.0,
                    "The staged light did not carry its native renderer intensity and reach");
            using namespace Frontier::GlobalIllumination;
            std::vector<LuminaireProfile> Profiles;
            for (const SceneViewportLuminaire& Source : Preview.Luminaires)
            {
                LuminaireProfile Light;
                Light.Category = static_cast<LuminaireCategory>(Source.Category);
                Light.Position = Source.Position;
                Light.Direction = Source.Direction;
                Light.Colour = Source.Colour;
                Light.Params = Source.Params;
                Light.Intensity = Source.Intensity;
                Light.Reach = Source.Reach;
                Profiles.push_back(Light);
            }
            LuminaireRegister Register;
            const std::vector<uint8_t> Packed = Register.Update(std::nullopt, {}, {}, std::nullopt, &Profiles);
            Confirm(Packed.size() == LuminaireRegisterBytes && Register.Luminaires.size() == 6,
                    "The C++ GI luminaire register did not accept the complete staged Photometric Studio rig");
            Confirm(std::fabs(Register.Luminaires.front().Position[0] + 41.15) < 1.0e-9,
                    "The C++ GI register lost the staged luminaire transform");
        }
        {
            const double Census = QueryPhotometricCensusLumens(State.Lights, 8);
            Confirm(std::fabs(Census - 11220.0) < 0.5, "The default census missed 11.22 klm");
            const double Lux = QueryPhotometricWallLux(State.Lights, 8);
            Confirm(Lux > 57.0 && Lux < 59.0, "The wall-screen estimate left its 57-59 lx band");
            Confirm(State.SunSolved.ElevationDeg > 41.0 && State.SunSolved.ElevationDeg < 42.0,
                    "The 14:30 sun left its 41-42° band");
        }
        // Native LM-63 Type-C import: multiplier, C-plane interpolation, workspace assignment, and wall-lux response.
        if (ArgumentCount >= 4)
        {
            PhotometricIesProfile Parsed{};
            std::string ParseError;
            Confirm(LoadPhotometricIesFile(Arguments[3], Parsed, ParseError), "The Type-C fixture did not parse");
            Confirm(Parsed.PhotometricType == 1 && Parsed.NumberOfLamps == 1 && Parsed.UnitsType == 2,
                    "The imported LM-63 header fields were not retained");
            Confirm(Parsed.VerticalAnglesDeg.size() == 5 && Parsed.HorizontalAnglesDeg.size() == 3,
                    "The imported LM-63 angle counts changed");
            Confirm(std::fabs(Parsed.Candela[0] - 2000.0f) < 1.0e-4f &&
                        std::fabs(Parsed.Candela[5] - 400.0f) < 1.0e-4f,
                    "The candela multiplier or C-plane-major grid order was lost");
            Confirm(Parsed.PeakCandela == 2000.0 && SamplePhotometricIes(Parsed, 0.0, 0.0) > 0.99f &&
                        SamplePhotometricIes(Parsed, 90.0, 0.0) > 0.15f &&
                        SamplePhotometricIes(Parsed, 90.0, 0.0) < 0.25f,
                    "The imported normalized C0/C90 sampling atlas is incorrect");
            Confirm(!Parsed.SourcePath.empty() && Parsed.Name == "TypeC_Imported",
                    "The loaded IES source identity was not retained");

            const PhotometricIesProfile BeforeRejectedImport = Parsed;
            const auto RejectWithoutReplacement = [&](const std::string& Text, const char* Description)
            {
                std::string Rejection;
                Confirm(!ParsePhotometricIes(Text, "RejectedInput", Parsed, Rejection) && !Rejection.empty() &&
                            Parsed.PeakCandela == BeforeRejectedImport.PeakCandela,
                        Description);
            };
            RejectWithoutReplacement("IESNA:LM-63-2002\nTILT=INCLUDE\n",
                                     "Unsupported tilt input was accepted or partially replaced a valid profile");
            RejectWithoutReplacement("IESNA:LM-63-2002\nTILT=NONE\n1 1000 1 2 1 2 2 0 0 0 1 1 70\n0 180\n0\n10 10\n",
                                     "Unsupported non-Type-C photometry was accepted or replaced the valid profile");
            RejectWithoutReplacement("IESNA:LM-63-2002\nTILT=NONE\n1 1000 1 182 1 1 2 0 0 0 1 1 70\n",
                                     "An excessive vertical-angle count was accepted or replaced the valid profile");
            RejectWithoutReplacement("IESNA:LM-63-2002\nTILT=NONE\n1 1000 1 2 1 1 2 0 0 0 1 1 70\n0 180\n0\n10\n",
                                     "A truncated candela grid was accepted or replaced the valid profile");
            const std::string OversizedInput(static_cast<size_t>(PhotometricIesMaximumFileBytes + 1), ' ');
            RejectWithoutReplacement(OversizedInput, "An IES file above the 4 MiB cap was accepted or replaced the valid profile");

            PhotometricWorkspaceState ImportedState{};
            ConstructPhotometricWorkspaceState(ImportedState);
            Confirm(LoadPhotometricWorkspaceIes(ImportedState, Arguments[3], ParseError),
                    "The workspace did not import and assign the Type-C fixture");
            Confirm(ImportedState.LoadedIesProfiles.size() == 1 &&
                        ImportedState.Lights[0].Props.CustomIesProfile == 0 &&
                        ImportedState.Lights[0].Props.UseMeasuredIes,
                    "The imported Type-C curve was not assigned to the selected IES luminaire");
            const double BaselineLux = QueryPhotometricWallLux(State.Lights, 8);
            const double ImportedLux = QueryPhotometricWallLux(ImportedState.Lights, 8,
                ImportedState.LoadedIesProfiles.data(), static_cast<int>(ImportedState.LoadedIesProfiles.size()));
            PhotometricIesProfile Dimmed = ImportedState.LoadedIesProfiles[0];
            Dimmed.PeakCandela *= 0.1;
            for (float& Candela : Dimmed.Candela) Candela *= 0.1f;
            const double DimmedLux = QueryPhotometricWallLux(ImportedState.Lights, 8, &Dimmed, 1);
            std::fprintf(stdout, "IES wall-lux probe: baseline=%.4f imported=%.4f dimmed=%.4f lx\n",
                         BaselineLux, ImportedLux, DimmedLux);
            Confirm(std::fabs(ImportedLux - BaselineLux) > 4.0,
                    "The imported candela distribution did not affect the photometric wall estimate");
            Confirm(ImportedLux > DimmedLux + 1.0,
                    "The wall-lux estimate ignored the imported candela amplitude");

            PhotometricLight Probe = ImportedState.Lights[0];
            Probe.Props.Lumens = 1000.0;
            Probe.Props.Multiplier = 1.0;
            Probe.Props.Position[0] = 0.0; Probe.Props.Position[1] = 1.4; Probe.Props.Position[2] = -4.25;
            Probe.Props.Target[0] = 0.0; Probe.Props.Target[1] = 1.4; Probe.Props.Target[2] = -5.25;
            const double C0WallLux = QueryPhotometricWallLux(&Probe, 1, ImportedState.LoadedIesProfiles.data(), 1);
            Probe.Props.Position[0] = -1.0; Probe.Props.Position[1] = 1.4; Probe.Props.Position[2] = -5.25;
            Probe.Props.Target[0] = -1.0; Probe.Props.Target[1] = 1.4; Probe.Props.Target[2] = -6.25;
            const double C90WallLux = QueryPhotometricWallLux(&Probe, 1, ImportedState.LoadedIesProfiles.data(), 1);
            Confirm(C0WallLux > C90WallLux * 1.8,
                    "The imported wall-lux probe did not distinguish its forward C0 curve from the side C90 curve");
        }

        // 2. Outliner: luminaire rows select silently; eye keys toggle visibility and the census follows.
        Click("Outliner/Light4");
        Confirm(State.Selected == 4, "Clicking the softbox did not select it");
        Click("Outliner/Light7");
        Confirm(State.Selected == 7, "Clicking the strip did not select it");
        Click("Outliner/Eye7");
        Confirm(!State.Lights[7].Visible, "The strip eye did not hide the strip");
        Confirm(std::fabs(QueryPhotometricCensusLumens(State.Lights, 8) - 7980.0) < 0.5,
                "The census did not drop the hidden strip");
        Click("Outliner/Eye7");
        Confirm(State.Lights[7].Visible, "The strip eye did not restore the strip");
        Click("Outliner/Light0");

        // 3. Outliner: environment rows select their celestial pages.
        for (int I = 0; I < 7; ++I)
        {
            char RowTag[32]{};
            std::snprintf(RowTag, sizeof(RowTag), "Outliner/Env%d", I);
            Click(RowTag);
            char Missing[64]{};
            std::snprintf(Missing, sizeof(Missing), "Environment row %d did not select", I);
            Confirm(State.Selected == PhotometricWorkspaceState::SelectedEnvDome + I, Missing);
            Frame();
        }
        Click("Outliner/Light0");

        // 4. Rigs: each tab resets the rig and the environment, then stages its preset.
        Click("TopBar/Rig1");
        Confirm(State.Scenario == PhotometricWorkspaceState::ScenarioGallery, "The gallery tab did not stage");
        Confirm(State.Selected == 2, "The gallery rig missed the downlight");
        Confirm(std::fabs(State.Dome.SkylightIntensity - 0.72) < 1.0e-9, "The gallery IBL missed 0.72x");
        Confirm(std::fabs(QueryPhotometricCensusLumens(State.Lights, 8) - 6030.0) < 0.5,
                "The gallery census missed 6.03 klm");
        Click("TopBar/Rig2");
        Confirm(State.Scenario == PhotometricWorkspaceState::ScenarioStudio, "The studio tab did not stage");
        Confirm(!State.Sun.Enabled, "The studio rig left the sun enabled");
        Confirm(State.SunSolved.ElevationDeg > 55.0, "The noon sun left its high band");
        Confirm(std::fabs(QueryPhotometricCensusLumens(State.Lights, 8) - 9690.0) < 0.5,
                "The studio census missed 9.69 klm");
        Click("TopBar/Rig3");
        Confirm(State.Scenario == PhotometricWorkspaceState::ScenarioLunar, "The lunar tab did not stage");
        Confirm(State.Selected == PhotometricWorkspaceState::SelectedMoon, "The lunar field missed the moon");
        Confirm(State.Moon.Visible && std::fabs(State.Moon.Brightness - 2.6) < 1.0e-9,
                "The lunar field missed its moonlight");
        Confirm(std::fabs(QueryPhotometricCensusLumens(State.Lights, 8) - 1400.0) < 0.5,
                "The lunar census missed 1.40 klm");
        Click("TopBar/Rig0");
        Confirm(State.Sun.Enabled, "The roadway rig did not restore the sun");
        Confirm(std::fabs(QueryPhotometricCensusLumens(State.Lights, 8) - 5190.0) < 0.5,
                "The restored roadway census missed 5.19 klm");

        // 5. Stage HUD: lens, camera, dark-room, and gizmo keys flip shell-local state silently.
        Click("Stage/Lens1");
        Confirm(State.Lens == PhotometricWorkspaceState::LensLux, "The lux lens did not engage");
        Click("Stage/Lens0");
        Confirm(State.Lens == PhotometricWorkspaceState::LensPbr, "The PBR lens did not restore");
        Click("Stage/Cam2");
        Confirm(State.Camera == PhotometricWorkspaceState::CameraWall, "The wall-screen camera did not engage");
        Click("Stage/Cam3");
        Confirm(State.Camera == PhotometricWorkspaceState::CameraRoadway, "The roadway camera did not restore");
        Click("Stage/DarkRoom");
        Confirm(!State.DarkRoom, "The dark-room key did not open the sky");
        Click("Stage/DarkRoom");
        Confirm(State.DarkRoom, "The dark-room key did not close the sky");
        Click("Stage/Gizmos");
        Confirm(!State.ShowGizmos, "The volumetrics key did not hide the cones");
        Click("Stage/Gizmos");
        Confirm(State.ShowGizmos, "The volumetrics key did not restore the cones");

        // 6. Inspector: all fifteen pages construct without tripping a NOOP.
        {
            const int NoopsBefore = State.NoopCount;
            for (int I = 0; I < 15; ++I)
            {
                if (I < 8)
                {
                    char RowTag[32]{};
                    std::snprintf(RowTag, sizeof(RowTag), "Outliner/Light%d", I);
                    Click(RowTag);
                }
                else
                {
                    char RowTag[32]{};
                    std::snprintf(RowTag, sizeof(RowTag), "Outliner/Env%d", I - 8);
                    Click(RowTag);
                }
                if (I < 8)
                {
                    (void)RectCentre("Inspector/Duplicate");
                    (void)RectCentre("Inspector/Delete");
                }
                Frame();
            }
            Confirm(State.NoopCount == NoopsBefore, "Rendering inspector pages tripped a NOOP");
        }
        Click("Outliner/Light0");

        // 7. Quick photometry: the browse chip requests the browser, the isolux chip toggles the lens.
        Click("Quick/Chip0");
        Confirm(Link.OpenRequested, "The browse chip did not request the browser");
        Confirm(Link.OpenWorkspace == AssetBrowserWorkspacePhotometric, "The browse chip requested the wrong workspace");
        Link.OpenRequested = false;
        Link.OpenWorkspace = -1;
        Click("Quick/Chip1");
        Confirm(State.Lens == PhotometricWorkspaceState::LensLux, "The isolux chip did not engage the lux lens");
        Click("Quick/Chip1");
        Confirm(State.Lens == PhotometricWorkspaceState::LensPbr, "The isolux chip did not restore the PBR lens");
        const auto HandOff = [&](const char* Id)
        {
            std::snprintf(Link.OpenRecordId, sizeof(Link.OpenRecordId), "%s", Id);
            Link.OpenRecordWorkspace = AssetBrowserWorkspacePhotometric;
            Frame();
            Frame();
            Confirm(!Link.HasHandoff(), "The shell did not consume the handoff");
        };

        // 8. Add drawer: browsing delegates to the browser; light handoffs refuse and leave eight luminaires.
        Click("Outliner/Add");
        Confirm(State.AddDrawerOpen, "The add key did not open the drawer");
        RectCentre("AddDrawer/Browse");
        Click("AddDrawer/Browse");
        Confirm(!State.AddDrawerOpen, "The browse row did not dismiss the drawer");
        Confirm(Link.OpenRequested, "The drawer browse row did not request the browser");
        Link.OpenRequested = false;
        Link.OpenWorkspace = -1;
        {
            const int NoopsBefore = State.NoopCount;
            HandOff("photo-light/ieslight");
            Confirm(State.NoopCount == NoopsBefore + 1, "Adding an IES light did not NOOP");
            HandOff("photo-light/ledlight");
            Confirm(State.NoopCount == NoopsBefore + 2, "Adding an LED did not NOOP");
            Confirm(State.Log.front().Channel == "ADD", "The add refusal missed its ADD channel");
        }

        // 9. Transport: play, step, and reset drive the diurnal clock and the ephemeris follows.
        Click("Transport/Play");
        Confirm(State.SweepPlaying, "The sweep did not start playing");
        Click("Transport/Play");
        Confirm(!State.SweepPlaying, "The sweep did not pause");
        Click("Transport/StepFwd");
        Confirm(std::fabs(State.Sun.LocalHours - 22.2) < 1.0e-9, "The step-forward key missed 22:12");
        Click("Transport/StepBack");
        Click("Transport/StepBack");
        Confirm(std::fabs(State.Sun.LocalHours - 20.2) < 1.0e-9, "The step-back key missed 20:12");
        Click("Transport/Reset");
        Confirm(std::fabs(State.Sun.LocalHours - 12.0) < 1.0e-9, "The reset key missed solar noon");
        Confirm(!State.SweepPlaying, "The reset key left the sweep playing");
        Click("Transport/Play");
        Click("Transport/Reset");

        // 10. Console: the drawer opens above the transport and Clear empties the log.
        Click("Transport/Console");
        Confirm(State.ConsoleOpen, "The console key did not open the drawer");
        Frame();
        Click("Console/Clear");
        Confirm(State.Log.empty(), "Clear did not empty the console log");
        Click("Transport/Console");
        Confirm(!State.ConsoleOpen, "The console key did not close the drawer");

        // 11. Entity keys: duplicate and delete refuse; the selection holds.
        Click("Outliner/Light2");
        {
            const int NoopsBefore = State.NoopCount;
            Click("Inspector/Duplicate");
            Confirm(State.NoopCount == NoopsBefore + 1, "Duplicating the downlight did not NOOP");
            Confirm(State.Selected == 2, "The refused duplicate moved the selection");
            Click("Inspector/Delete");
            Confirm(State.NoopCount == NoopsBefore + 2, "Deleting the downlight did not NOOP");
            Confirm(State.Selected == 2, "The refused delete moved the selection");
        }

        // 12. Top bar: .ies opens a native picker/path modal; export and suite actions remain explicit NOOPs.
        {
            const int NoopsBefore = State.NoopCount;
            if (!PhotometricIesFileDialogAvailable())
            {
                Click("TopBar/Load");
                Confirm(State.NoopCount == NoopsBefore && State.LoadedIesProfiles.empty(),
                        "Opening the Type-C import UI changed data or raised a NOOP");
                if (ArgumentCount >= 4)
                {
                    std::snprintf(State.LoadIesPath, sizeof(State.LoadIesPath), "%s", Arguments[3]);
                    Frame();
                    Click("LoadIes/Import");
                    Confirm(State.LoadedIesProfiles.size() == 1 && State.Lights[2].Props.CustomIesProfile == 0 &&
                                State.Lights[2].Props.UseMeasuredIes && State.LoadIesError.empty(),
                            "The native path modal did not import and assign the selected Type-C profile");
                    const double ModalLux = QueryPhotometricWallLux(State.Lights, 8, State.LoadedIesProfiles.data(),
                                                                    static_cast<int>(State.LoadedIesProfiles.size()));
                    Confirm(ModalLux > 0.0, "The path-modal imported profile produced no wall-lux estimate");
                }
                else Click("LoadIes/Cancel");
            }
            Click("TopBar/ExportIes");
            Confirm(State.NoopCount == NoopsBefore + 1, "Export .ies did not NOOP");
            Click("TopBar/ExportRig");
            Confirm(State.NoopCount == NoopsBefore + 2, "Export rig did not NOOP");
            Click("TopBar/Suite0");
            Confirm(State.NoopCount == NoopsBefore + 3, "The suite link did not NOOP");
            Confirm(State.Log.front().Channel == "SCENE", "The suite refusal missed its SCENE channel");
        }
        Click("TopBar/Goniometer");
        Confirm(State.MatrixOpen, "The goniometer key did not open the matrix");
        Click("Matrix/Close");
        Confirm(!State.MatrixOpen, "The matrix close key did not dismiss the sheet");

        // 13. IES matrix: browsing delegates to the browser; rig, moon, and IES handoffs apply.
        Click("TopBar/Goniometer");
        Confirm(State.MatrixOpen, "The goniometer key did not open the matrix");
        RectCentre("Matrix/Browse");
        Click("Matrix/Browse");
        Confirm(!State.MatrixOpen, "The browse row did not dismiss the sheet");
        Confirm(Link.OpenRequested, "The matrix browse row did not request the browser");
        Link.OpenRequested = false;
        Link.OpenWorkspace = -1;
        HandOff("photo-rig/lunar");
        Confirm(State.Scenario == PhotometricWorkspaceState::ScenarioLunar, "The rig handoff missed the lunar rig");
        HandOff("photo-moon/Ember");
        Confirm(State.Moon.Slot == 1, "The moon handoff did not stage Ember");
        Confirm(State.Log.front().Channel == "MOON", "The moon handoff logged no MOON line");
        Click("Outliner/Light0");
        HandOff("photo-ies-m/HighBeam");
        Confirm(State.Lights[0].Props.UseMeasuredIes, "The HighBeam handoff did not stage a measured curve");
        Confirm(State.Lights[0].Props.MeasuredProfile == 1, "The HighBeam handoff missed profile 1");
        Confirm(State.Log.front().Channel == "IES", "The curve assignment missed its IES channel");
        HandOff("photo-ies-p/Batwing");
        Confirm(!State.Lights[0].Props.UseMeasuredIes, "The Batwing handoff did not stage a synthetic curve");
        Confirm(State.Lights[0].Props.PresetProfile == 2, "The Batwing handoff missed preset 2");
        Click("TopBar/Rig0");

        // 14. Evidence: one frame per showcase state.
        const auto RenderEvidence = [&](const char* Path)
        {
            IO.AddMousePosEvent(-1.0f, -1.0f);
            Frame();
            FrontierExhibit::AcknowledgeTextures();
            const int Width  = static_cast<int>(IO.DisplaySize.x * IO.DisplayFramebufferScale.x);
            const int Height = static_cast<int>(IO.DisplaySize.y * IO.DisplayFramebufferScale.y);
            std::vector<unsigned char> Pixels(static_cast<size_t>(Width) * Height * 3, 0x18);
            const ImDrawData* DrawData = ImGui::GetDrawData();
            for (const ImDrawList* DrawList : DrawData->CmdLists)
                FrontierExhibit::RasterizeCommands(DrawList, Pixels.data(), Width, Height, DrawData->DisplayPos, DrawData->FramebufferScale);
            std::ofstream Image(Path, std::ios::binary);
            Image << "P6\n" << Width << ' ' << Height << "\n255\n";
            Image.write(reinterpret_cast<const char*>(Pixels.data()), static_cast<std::streamsize>(Pixels.size()));
            if (!Image) throw std::runtime_error("Could not write Photometric workspace PPM evidence");
        };
        // 📝 Settle: let the NOOP toasts expire so the evidence frames show the bare workspace.
        for (int I = 0; I < 360; ++I) Frame();
        if (ArgumentCount >= 2)
        {
            std::string Stem = Arguments[1];
            const size_t Dot = Stem.rfind(".ppm");
            if (Dot != std::string::npos && Dot + 4 == Stem.size()) Stem.erase(Dot);
            ConstructPhotometricWorkspaceState(State);
            Frame();
            RenderEvidence((Stem + "-overview.ppm").c_str());
            Click("Stage/Lens1");
            RenderEvidence((Stem + "-lux.ppm").c_str());
            Click("TopBar/Rig1");
            Click("Outliner/Light2");
            Click("Stage/Lens0");
            RenderEvidence((Stem + "-gallery.ppm").c_str());
            Click("TopBar/Rig3");
            Click("Outliner/Env2");
            RenderEvidence((Stem + "-lunar.ppm").c_str());
        }

        std::fprintf(stdout, "PhotometricWorkspaceValidation: boot/select/rigs/stage/inspector/quick/add/transport/console/entity/topbar/matrix checks passed\n");
        ImGui::DestroyContext();
        return 0;
    }
    catch (const std::exception& Failure)
    {
        ImGui::DestroyContext();
        std::fprintf(stderr, "PhotometricWorkspaceValidation: %s\n", Failure.what());
        return 1;
    }
}
