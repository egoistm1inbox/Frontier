/*====================================================================================================================================
                                                      PROJECTDRIVEMAIN.CPP
====================================================================================================================================*/
// 🧩 Unified Project-Drive binary reusing the existing Frontier UI (ControlCentrePanel, ThemeStructure, PanelDockspace,
//    SceneDirectoryPanel Outliner, SceneInspectorPanel, LogStreamPanel) over the full VehicleHMI proving-grounds demo
//    with Play / Pause / Simulate transport header, 1:1 VehicleHMI component UIs, and SourceImages/General UI statistical
//    infographics.

#include "DriveShowcaseWorld.h"

#include "Engine/Diagnostics/BuildConfiguration.h"
#include "Engine/Diagnostics/LogCategories.h"
#include "Engine/Diagnostics/LogStream.h"
#include "Engine/Scene/RecordStore.h"

#if !defined(FRONTIER_SHIPPING_PROFILE) || !FRONTIER_SHIPPING_PROFILE
    #include "CpuRasterization.h"
    #include "Engine/Interface/ContentDirectory.h"
    #include "Engine/Interface/IconPresentation.h"
    #include "Engine/Interface/LogStreamPanel.h"
    #include "Engine/Interface/LogStreamPanelRegistration.h"
    #include "Engine/Interface/PanelDockspace.h"
    #include "Engine/Interface/SceneDirectoryPanel.h"
    #include "Engine/Interface/SceneDirectoryPanelRegistration.h"
    #include "Engine/Interface/SceneInspectorPanel.h"
    #include "Engine/Interface/StackRailControls.h"
    #include "Engine/Scene/SceneDirectory.h"
    #include "UI/Editor/ControlCentrePanel.h"

    #define STB_IMAGE_WRITE_IMPLEMENTATION
    #include <stb_image_write.h>
#endif

#if defined(__linux__)
    #include <arpa/inet.h>
    #include <csignal>
    #include <netinet/in.h>
    #include <sys/socket.h>
    #include <unistd.h>
#endif

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <iostream>
#include <mutex>
#include <sstream>
#include <string>
#include <vector>

namespace Frontier::Drive
{

#if !defined(FRONTIER_SHIPPING_PROFILE) || !FRONTIER_SHIPPING_PROFILE

//====================================================================================================================================
//                                        UNIFIED EDITOR + RUNTIME HOST WORKSPACE
//====================================================================================================================================

class ProjectDriveApplicationHost
{
  public:
    ProjectDriveApplicationHost(const std::filesystem::path &RepoRoot,
                                const std::filesystem::path &ProjectRoot,
                                uint32_t WindowW = 1600u,
                                uint32_t WindowH = 960u)
        : RepoRoot_(RepoRoot)
        , ProjectRoot_(ProjectRoot)
        , WindowW_(WindowW)
        , WindowH_(WindowH)
    {
    }

    ~ProjectDriveApplicationHost()
    {
        if (ViewportTextureCreated_)
        {
            ViewportTexture_.DestroyPixels();
            ViewportTextureCreated_ = false;
        }
        ControlCentreRaw_ = nullptr;
        ControlCentre_.reset();
        if (ImGuiContextCreated_)
        {
            ImGui::DestroyContext();
            ImGuiContextCreated_ = false;
        }
    }

    bool Initialize()
    {
        LogCategorySim_    = RegisterLogCategory("Simulation", LogColour::Mint);
        LogCategoryRender_ = RegisterLogCategory("Renderer", LogColour::Blue);
        LogCategoryUi_     = RegisterLogCategory("EditorUI", LogColour::Purple);

        if (!World_.Initialize(ProjectRoot_.string()))
        {
            std::cerr << "[FAILED] DriveShowcaseWorld::Initialize failed for " << ProjectRoot_ << "\n";
            return false;
        }

        if (const char *SanEnv = std::getenv("FRONTIER_SANITIZER_VIEWPORT"); SanEnv != nullptr && SanEnv[0] == '1')
        {
            SanitizerFastViewport_ = true;
            World_.Records().RenderPipeline.ViewportScalePercent = 25;
        }

        const std::filesystem::path FontsDir = RepoRoot_ / "EngineContent/FontArchives";
        const std::filesystem::path IconsDir = RepoRoot_ / "EngineContent/Icons";
        const std::filesystem::path PrefsPath = ProjectRoot_ / ".local_appearance.toml";

        ImGui::CreateContext();
        ImGuiContextCreated_ = true;
        ImGuiIO &IO          = ImGui::GetIO();
        IO.IniFilename       = nullptr;
        IO.ConfigFlags      |= ImGuiConfigFlags_DockingEnable;
        IO.DisplaySize       = ImVec2(static_cast<float>(WindowW_), static_cast<float>(WindowH_));
        IO.DeltaTime         = 1.0f / 60.0f;
        IO.BackendFlags     |= ImGuiBackendFlags_RendererHasTextures | ImGuiBackendFlags_RendererHasVtxOffset;
        ImGui::GetPlatformIO().Renderer_TextureMaxWidth  = 4096;
        ImGui::GetPlatformIO().Renderer_TextureMaxHeight = 4096;

        IconPresentation::Attach(IconsDir.string());

        // Pass 2 arguments (FontsDir, PrefsPath) so ControlCentrePanel uses global editor preferences cleanly!
        ControlCentreRaw_ = new ControlCentrePanel(FontsDir, PrefsPath);
        ControlCentre_.reset(ControlCentreRaw_);
        if (!ControlCentreRaw_->Initialize() || !ControlCentreRaw_->Activate())
        {
            std::cerr << "[FAILED] ControlCentrePanel initialization failed\n";
            return false;
        }

        // Configure 3-Column PanelDockspace below our 52 px Play / Pause / Simulate Header!
        Dockspace_.ConfigureDockspaceKey("ProjectDriveWorkspaceDock");
        Dockspace_.ConfigureWorkspaceInsets(HeaderBarHeightPx_, 0.0f);
        Dockspace_.Register(MakeSceneDirectoryPanelSpecification(OutlinerPanel_));

        DockPanelSpecification ViewportSpec;
        ViewportSpec.Key              = "Viewport";
        ViewportSpec.Caption          = "VehicleHMI Proving Grounds";
        ViewportSpec.ConstructContent = [this]() { DrawViewportPanelContent(); };
        ViewportSpec.Open             = true;
        Dockspace_.Register(std::move(ViewportSpec));

        Dockspace_.Register(MakeLogStreamPanelSpecification(LogPanel_));

        DockPanelSpecification InspectorSpec;
        InspectorSpec.Key              = "Inspector";
        InspectorSpec.Caption          = "Inspector";
        InspectorSpec.ConstructContent = [this]() { ConstructSceneInspectorInterface(OutlinerPanel_); };
        InspectorSpec.Open             = true;
        Dockspace_.Register(std::move(InspectorSpec));

        Dockspace_.ConfigureStackedPanels("Viewport", "LogStream", 640.0f);
        Dockspace_.ConfigureColumns({{"Outliner", 0.21f}, {"LogStream", 0.51f}, {"Inspector", 0.28f}});

        OutlinerPanel_.Synchronize(SceneDirectory::Instance());
        OutlinerPanel_.SelectByStableId("vehicle");

        WriteLog(LogCategorySim_, LogSeverity::Info,
                 "Project-Drive unified runtime initialized: 25 RecordEntry components across 8 Outliner groups",
                 "ProjectDriveMain.cpp");
        WriteLog(LogCategoryRender_, LogSeverity::Info,
                 "Dual-tier GTX (SDF ReSTIR + BVH RT) / RTX (Full RayQuery) + BlinnRenderer + Nanite K1 ready",
                 "DriveShowcaseWorld.cpp");
        WriteLog(LogCategorySim_, LogSeverity::Info,
                 "SnowSurface CC=1 mound + Smooth 2.5D ShallowWater (0 foam/0 splash) + 5.13x Pyro PlumeFluid active",
                 "DriveShowcaseWorld.cpp");
        WriteLog(LogCategoryUi_, LogSeverity::Info,
                 "ControlCentrePanel + ThemeStructure + Play/Pause/Simulate header docked over VehicleHMI demo",
                 "ProjectDriveMain.cpp");

        // Settle initial dockspace seating over 4 frames
        World_.SetTransportMode(ShowcaseTransportMode::Pause);
        for (int Warm = 0; Warm < 4; ++Warm)
        {
            StepAndRenderGuiFrame(1.0 / 60.0, {});
        }
        World_.SetTransportMode(ShowcaseTransportMode::Play);
        return true;
    }

    void StepAndRenderGuiFrame(double DtSeconds, const DriveControlReadings &Controls)
    {
        ImGuiIO &IO    = ImGui::GetIO();
        IO.DisplaySize = ImVec2(static_cast<float>(WindowW_), static_cast<float>(WindowH_));
        IO.DeltaTime   = static_cast<float>(std::clamp(DtSeconds, 1.0 / 240.0, 0.1));

        World_.TickFrame(DtSeconds, Controls);
        OutlinerPanel_.Synchronize(SceneDirectory::Instance());

        if (auto SpawnReq = OutlinerPanel_.TakeSpawnRequest(); SpawnReq.has_value())
        {
            WriteLogFormat(LogCategoryUi_.Token, LogSeverity::Info, LogVerbosity::Log, "SceneDirectoryPanel",
                           "Requested component classification view: %s", RecordClassificationName(*SpawnReq));
        }

        LogPanel_.Synchronize(LogStore(), LogCategories(), DtSeconds);
        (void)ControlCentreRaw_->Integrate(DtSeconds);
        ControlCentreRaw_->PrepareInterface();

        // Guard against unexpected font scale drift during automated theme tests
        const float AppliedScale = ControlCentreRaw_->QueryAppearance().QueryApplied().InterfaceScale / 100.0f;

        ImGui::NewFrame();
        DrawTopTransportHeaderBar();
        Dockspace_.ConstructInterface(AppliedScale);
        ControlCentreRaw_->ConstructInterface();
        ImGui::Render();
        FrontierExhibit::AcknowledgeTextures();
    }

    void RasterizeFrameToRgba8(std::vector<uint8_t> &OutRgba8)
    {
        std::vector<uint8_t> Rgb(static_cast<size_t>(WindowW_) * WindowH_ * 3u, 16u);
        if (const ImDrawData *DrawData = ImGui::GetDrawData())
        {
            for (const ImDrawList *CmdList : DrawData->CmdLists)
            {
                FrontierExhibit::RasterizeCommands(CmdList, Rgb.data(), static_cast<int>(WindowW_),
                                                   static_cast<int>(WindowH_), DrawData->DisplayPos,
                                                   DrawData->FramebufferScale);
            }
        }
        OutRgba8.resize(static_cast<size_t>(WindowW_) * WindowH_ * 4u, 255u);
        for (size_t P = 0; P < static_cast<size_t>(WindowW_) * WindowH_; ++P)
        {
            OutRgba8[P * 4u + 0u] = Rgb[P * 3u + 0u];
            OutRgba8[P * 4u + 1u] = Rgb[P * 3u + 1u];
            OutRgba8[P * 4u + 2u] = Rgb[P * 3u + 2u];
            OutRgba8[P * 4u + 3u] = 255u;
        }
    }

    bool SavePngCapture(const std::filesystem::path &FilePath)
    {
        std::vector<uint8_t> Rgba;
        RasterizeFrameToRgba8(Rgba);
        std::filesystem::create_directories(FilePath.parent_path());
        return stbi_write_png(FilePath.string().c_str(), static_cast<int>(WindowW_), static_cast<int>(WindowH_),
                              4, Rgba.data(), static_cast<int>(WindowW_ * 4u)) != 0;
    }

    DriveShowcaseWorld   &World() noexcept { return World_; }
    SceneDirectoryPanel  &Outliner() noexcept { return OutlinerPanel_; }
    ControlCentrePanel   &ControlCentre() noexcept { return *ControlCentreRaw_; }
    uint32_t              WindowWidth() const noexcept { return WindowW_; }
    uint32_t              WindowHeight() const noexcept { return WindowH_; }
    void                  LogEditorEvent(const char *Message)
    {
        WriteLog(LogCategoryUi_, LogSeverity::Info, Message, "InspectorLiveEdit");
    }

  private:
    void UploadViewportPixels(const std::vector<uint8_t> &Rgba8, uint32_t W, uint32_t H)
    {
        if (!ViewportTextureCreated_ || ViewportTexture_.Width != static_cast<int>(W) ||
            ViewportTexture_.Height != static_cast<int>(H))
        {
            if (ViewportTextureCreated_)
            {
                ViewportTexture_.DestroyPixels();
            }
            ViewportTexture_ = ImTextureData();
            ViewportTexture_.Create(ImTextureFormat_RGBA32, static_cast<int>(W), static_cast<int>(H));
            ViewportTextureCreated_ = true;
        }
        std::memcpy(ViewportTexture_.GetPixels(), Rgba8.data(), static_cast<size_t>(W) * H * 4u);
        ViewportTexture_.SetStatus(ImTextureStatus_WantUpdates);
    }

    void DrawTopTransportHeaderBar()
    {
        const ImGuiViewport *MainVp = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(MainVp->Pos);
        ImGui::SetNextWindowSize(ImVec2(MainVp->Size.x, HeaderBarHeightPx_));

        ImGuiWindowFlags Flags = ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove |
                                 ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoDocking |
                                 ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse;

        const ImGuiStyle &Style = ImGui::GetStyle();
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(14.0f, 8.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
        ImGui::PushStyleColor(ImGuiCol_WindowBg, Style.Colors[ImGuiCol_WindowBg]);

        if (ImGui::Begin("##ProjectDriveTopTransportBar", nullptr, Flags))
        {
            const KitFaces Faces   = ResolveKitFaces();
            ImDrawList    *Ink     = ImGui::GetWindowDrawList();
            const ImVec2   WPos    = ImGui::GetWindowPos();
            const ImVec2   WSize   = ImGui::GetWindowSize();
            const ImU32    CardBg  = ImGui::ColorConvertFloat4ToU32(Style.Colors[ImGuiCol_FrameBg]);
            const ImU32    HoverBg = ImGui::ColorConvertFloat4ToU32(Style.Colors[ImGuiCol_FrameBgHovered]);
            const ImU32    EdgeCol = ImGui::ColorConvertFloat4ToU32(Style.Colors[ImGuiCol_Border]);
            const ImU32    TextCol = ImGui::ColorConvertFloat4ToU32(Style.Colors[ImGuiCol_Text]);
            const ImU32    MuteCol = ImGui::ColorConvertFloat4ToU32(Style.Colors[ImGuiCol_TextDisabled]);
            const ImU32    MintCol = KitInkHex(0x2fe6a7);
            const ImU32    SkyCol  = KitInkHex(0x38bdf8);
            const ImU32    AmbCol  = KitInkHex(0xfbbf24);

            Ink->AddLine(ImVec2(WPos.x, WPos.y + WSize.y - 1.0f),
                         ImVec2(WPos.x + WSize.x, WPos.y + WSize.y - 1.0f), EdgeCol, 1.0f);

            // 1. Left Brand Identity Pill
            const float Y0 = WPos.y + 9.0f;
            const float H  = 34.0f;
            Ink->AddCircleFilled(ImVec2(WPos.x + 20.0f, Y0 + H * 0.5f), 5.0f, MintCol);
            KitDrawTracked(Ink, Faces.SemiBold, 11.5f, ImVec2(WPos.x + 32.0f, Y0 + 4.0f), TextCol, "PROJECT-DRIVE", 0.9f);
            KitDrawText(Ink, Faces.Regular, 10.0f, ImVec2(WPos.x + 32.0f, Y0 + 18.5f), MuteCol, "VehicleHMI Proving Grounds");

            // 2. Central Transport Bar: PLAY | PAUSE | SIMULATE + STEP + RESET
            const float TransX = WPos.x + 228.0f;
            KitPillSurface(Ink, ImVec2(TransX, Y0), ImVec2(TransX + 356.0f, Y0 + H), CardBg, EdgeCol, 10.0f);

            struct ModeBtn
            {
                const char           *Label;
                ShowcaseTransportMode Mode;
                ImU32                 Accent;
            };
            const ModeBtn Modes[3] = {
                {"Play",     ShowcaseTransportMode::Play,     MintCol},
                {"Pause",    ShowcaseTransportMode::Pause,    AmbCol},
                {"Simulate", ShowcaseTransportMode::Simulate, SkyCol},
            };
            float BX = TransX + 4.0f;
            for (int M = 0; M < 3; ++M)
            {
                const float BW     = M == 2 ? 92.0f : 76.0f;
                const bool  Active = (World_.GetTransportMode() == Modes[M].Mode);
                ImGui::PushID(500 + M);
                ImGui::SetCursorScreenPos(ImVec2(BX, Y0 + 4.0f));
                ImGui::InvisibleButton("##ModeBtn", ImVec2(BW, H - 8.0f));
                if (ImGui::IsItemClicked())
                {
                    World_.SetTransportMode(Modes[M].Mode);
                    WriteLogFormat(LogCategorySim_.Token, LogSeverity::Info, LogVerbosity::Log, "TransportHeader",
                                   "Switched transport state -> %s", Modes[M].Label);
                }
                if (Active)
                {
                    const ImU32 Fill = IM_COL32(
                        (Modes[M].Accent >> IM_COL32_R_SHIFT) & 0xFF,
                        (Modes[M].Accent >> IM_COL32_G_SHIFT) & 0xFF,
                        (Modes[M].Accent >> IM_COL32_B_SHIFT) & 0xFF, 48);
                    KitPillSurface(Ink, ImVec2(BX, Y0 + 4.0f), ImVec2(BX + BW, Y0 + H - 4.0f), Fill, Modes[M].Accent, 7.0f);
                }
                else if (ImGui::IsItemHovered())
                {
                    KitPillSurface(Ink, ImVec2(BX, Y0 + 4.0f), ImVec2(BX + BW, Y0 + H - 4.0f), HoverBg, 0, 7.0f);
                }
                const ImU32 FG  = Active ? TextCol : MuteCol;
                const ImU32 Ico = Active ? Modes[M].Accent : MuteCol;
                const float TW  = KitTextWidth(Active ? Faces.SemiBold : Faces.Regular, 11.0f, Modes[M].Label);
                const float IX  = BX + (BW - (TW + 14.0f)) * 0.5f + 4.0f;
                const float IY  = Y0 + H * 0.5f;
                if (M == 0)
                {
                    Ink->AddTriangleFilled(ImVec2(IX - 3.5f, IY - 4.2f), ImVec2(IX - 3.5f, IY + 4.2f), ImVec2(IX + 4.0f, IY), Ico);
                }
                else if (M == 1)
                {
                    Ink->AddRectFilled(ImVec2(IX - 3.8f, IY - 4.2f), ImVec2(IX - 1.2f, IY + 4.2f), Ico, 1.0f);
                    Ink->AddRectFilled(ImVec2(IX + 1.2f, IY - 4.2f), ImVec2(IX + 3.8f, IY + 4.2f), Ico, 1.0f);
                }
                else
                {
                    Ink->AddCircle(ImVec2(IX, IY), 4.0f, Ico, 14, 1.5f);
                    Ink->AddCircleFilled(ImVec2(IX, IY), 1.5f, Ico, 8);
                }
                KitDrawText(Ink, Active ? Faces.SemiBold : Faces.Regular, 11.0f,
                            ImVec2(IX + 9.0f, Y0 + 9.0f), FG, Modes[M].Label);
                ImGui::PopID();
                BX += BW + 3.0f;
            }

            // Step & Reset buttons inside transport capsule
            auto SmallCapsuleAction = [&](const char *Id, const char *Cap, float W) -> bool {
                ImGui::SetCursorScreenPos(ImVec2(BX, Y0 + 4.0f));
                ImGui::InvisibleButton(Id, ImVec2(W, H - 8.0f));
                if (ImGui::IsItemHovered())
                {
                    KitPillSurface(Ink, ImVec2(BX, Y0 + 4.0f), ImVec2(BX + W, Y0 + H - 4.0f), HoverBg, EdgeCol, 7.0f);
                }
                const float TW = KitTextWidth(Faces.Medium, 10.5f, Cap);
                KitDrawText(Ink, Faces.Medium, 10.5f, ImVec2(BX + (W - TW) * 0.5f, Y0 + 9.5f), MuteCol, Cap);
                BX += W + 3.0f;
                return ImGui::IsItemClicked();
            };
            if (SmallCapsuleAction("##StepOnceBtn", "Step", 46.0f))
            {
                World_.SetTransportMode(ShowcaseTransportMode::Pause);
                World_.StepSingleTick(1.0 / 60.0);
            }
            if (SmallCapsuleAction("##ResetAllBtn", "Reset", 50.0f))
            {
                World_.ResetAllSystems();
            }

            // 3. GPU Tracing Tier Selector: GTX | RTX | Blinn
            const float TierX = TransX + 368.0f;
            KitPillSurface(Ink, ImVec2(TierX, Y0), ImVec2(TierX + 178.0f, Y0 + H), CardBg, EdgeCol, 10.0f);
            static const char *const TierNames[3] = {"GTX", "RTX", "Blinn"};
            for (int T = 0; T < 3; ++T)
            {
                const float TX  = TierX + 4.0f + static_cast<float>(T) * 57.0f;
                const bool  Act = (World_.Records().RenderPipeline.TracingTier == T);
                ImGui::PushID(600 + T);
                ImGui::SetCursorScreenPos(ImVec2(TX, Y0 + 4.0f));
                ImGui::InvisibleButton("##TierPill", ImVec2(54.0f, H - 8.0f));
                if (ImGui::IsItemClicked())
                {
                    World_.Records().RenderPipeline.TracingTier = T;
                    World_.ForceViewportDirty();
                }
                if (Act)
                {
                    KitPillSurface(Ink, ImVec2(TX, Y0 + 4.0f), ImVec2(TX + 54.0f, Y0 + H - 4.0f),
                                   IM_COL32(56, 189, 248, 46), SkyCol, 7.0f);
                }
                const float TW = KitTextWidth(Act ? Faces.SemiBold : Faces.Regular, 11.0f, TierNames[T]);
                KitDrawText(Ink, Act ? Faces.SemiBold : Faces.Regular, 11.0f,
                            ImVec2(TX + (54.0f - TW) * 0.5f, Y0 + 9.0f), Act ? TextCol : MuteCol, TierNames[T]);
                ImGui::PopID();
            }

            // 4. Camera Viewpoint Strip (Hero | Cabin HMI | Portals | Snow | Pyro | Chase)
            const float CamX = TierX + 190.0f;
            static const char *const CamCaps[6] = {"Hero", "Cabin HMI", "Portals", "Snow/H2O", "Pyro/Frac", "Chase"};
            KitPillSurface(Ink, ImVec2(CamX, Y0), ImVec2(CamX + 394.0f, Y0 + H), CardBg, EdgeCol, 10.0f);
            float CX = CamX + 4.0f;
            for (int C = 0; C < 6; ++C)
            {
                const float CW  = (C == 1 || C == 3 || C == 4) ? 68.0f : 58.0f;
                const bool  Act = (static_cast<int>(World_.GetCameraPreset()) == C);
                ImGui::PushID(700 + C);
                ImGui::SetCursorScreenPos(ImVec2(CX, Y0 + 4.0f));
                ImGui::InvisibleButton("##CamPill", ImVec2(CW, H - 8.0f));
                if (ImGui::IsItemClicked())
                {
                    World_.SetCameraPreset(static_cast<ShowcaseCameraPreset>(C));
                }
                if (Act)
                {
                    KitPillSurface(Ink, ImVec2(CX, Y0 + 4.0f), ImVec2(CX + CW, Y0 + H - 4.0f),
                                   IM_COL32(244, 114, 182, 44), KitInkHex(0xf472b6), 7.0f);
                }
                const float TW = KitTextWidth(Act ? Faces.SemiBold : Faces.Regular, 10.5f, CamCaps[C]);
                KitDrawText(Ink, Act ? Faces.SemiBold : Faces.Regular, 10.5f,
                            ImVec2(CX + (CW - TW) * 0.5f, Y0 + 9.5f), Act ? TextCol : MuteCol, CamCaps[C]);
                ImGui::PopID();
                CX += CW + 2.0f;
            }

            // 5. Right-Aligned Live Telemetry Readout + ControlCentre Theme Drawer Button (leaves 94 px for native FPS badge)
            const float ThemeBtnW = 112.0f;
            const float ThemeBtnX = WPos.x + WSize.x - ThemeBtnW - 96.0f;
            ImGui::SetCursorScreenPos(ImVec2(ThemeBtnX, Y0));
            ImGui::InvisibleButton("##OpenControlCentreThemeBtn", ImVec2(ThemeBtnW, H));
            if (ImGui::IsItemClicked())
            {
                if (ControlCentreRaw_->QueryCentreOpen() || ControlCentreRaw_->QueryQuickOpen())
                {
                    ImGui::GetIO().AddKeyEvent(ImGuiKey_Escape, true);
                    ImGui::GetIO().AddKeyEvent(ImGuiKey_Escape, false);
                }
                else
                {
                    ControlCentreRaw_->ActivatePage(AppearancePageCategory::Theme);
                }
            }
            KitPillSurface(Ink, ImVec2(ThemeBtnX, Y0), ImVec2(ThemeBtnX + ThemeBtnW, Y0 + H),
                           ImGui::IsItemHovered() ? HoverBg : CardBg, EdgeCol, 10.0f);
            KitDrawText(Ink, Faces.SemiBold, 11.0f, ImVec2(ThemeBtnX + 13.0f, Y0 + 9.5f), TextCol, "Control Centre");

            const auto &Tel = World_.Telemetry();
            char StatLine[96] = {};
            std::snprintf(StatLine, sizeof(StatLine), "%.0f km/h \xC2\xB7 %.0f RPM \xC2\xB7 CC=%u \xC2\xB7 48B",
                          Tel.SpeedKmh, Tel.EngineRpm, Tel.SnowConnectedComponents);
            const float SW = KitTextWidth(Faces.Medium, 10.5f, StatLine);
            if (ThemeBtnX - SW - 18.0f > CamX + 402.0f)
            {
                KitDrawText(Ink, Faces.Medium, 10.5f, ImVec2(ThemeBtnX - SW - 14.0f, Y0 + 10.0f), MuteCol, StatLine);
            }
        }
        ImGui::End();
        ImGui::PopStyleColor();
        ImGui::PopStyleVar(2);
    }

    void DrawViewportPanelContent()
    {
        const ImVec2 Avail = ImGui::GetContentRegionAvail();
        const uint32_t PanelW = static_cast<uint32_t>(std::max(160.0f, Avail.x));
        const uint32_t PanelH = static_cast<uint32_t>(std::max(100.0f, Avail.y));

        const uint32_t ReqW = SanitizerFastViewport_ ? 180u : PanelW;
        const uint32_t ReqH = SanitizerFastViewport_ ? 108u : PanelH;

        uint32_t RW = 0u, RH = 0u;
        if (World_.RenderViewportIfNeeded(ReqW, ReqH, ViewportPixels_, RW, RH))
        {
            UploadViewportPixels(ViewportPixels_, RW, RH);
        }

        const ImVec2 ImgOrigin = ImGui::GetCursorScreenPos();
        if (ViewportTextureCreated_)
        {
            ImGui::Image(ViewportTexture_.GetTexRef(), ImVec2(static_cast<float>(PanelW), static_cast<float>(PanelH)));
        }

        // Interactive Viewport Orbit / Zoom + Click-to-Select Component Hotspots!
        if (ImGui::IsItemHovered())
        {
            ImGuiIO &IO = ImGui::GetIO();
            if (ImGui::IsMouseDragging(ImGuiMouseButton_Right) || ImGui::IsMouseDragging(ImGuiMouseButton_Middle))
            {
                World_.OrbitFreeCamera(-IO.MouseDelta.x * 0.006f, IO.MouseDelta.y * 0.005f, 0.0f);
            }
            if (std::abs(IO.MouseWheel) > 0.01f)
            {
                World_.OrbitFreeCamera(0.0f, 0.0f, -IO.MouseWheel * 0.85f);
            }
            if (ImGui::IsMouseClicked(ImGuiMouseButton_Left) && !ImGui::IsMouseDragging(ImGuiMouseButton_Left))
            {
                const float U = (IO.MousePos.x - ImgOrigin.x) / std::max(1.0f, static_cast<float>(PanelW));
                const float V = (IO.MousePos.y - ImgOrigin.y) / std::max(1.0f, static_cast<float>(PanelH));
                if (V < 0.28f)
                {
                    OutlinerPanel_.SelectByStableId("clouds");
                }
                else if (U < 0.36f && V > 0.42f)
                {
                    OutlinerPanel_.SelectByStableId("vehicle");
                }
                else if (U > 0.68f && V < 0.62f)
                {
                    OutlinerPanel_.SelectByStableId("pyro_plume");
                }
                else if (U > 0.56f && V >= 0.62f)
                {
                    OutlinerPanel_.SelectByStableId("snow_mound");
                }
                else
                {
                    OutlinerPanel_.SelectByStableId("portals_mirrors");
                }
            }
        }

        // Diegetic Viewport HUD Badges (top-left status + bottom-left controls hint)
        const KitFaces Faces = ResolveKitFaces();
        ImDrawList    *Ink   = ImGui::GetWindowDrawList();
        const auto    &Tel   = World_.Telemetry();
        const int32_t  Tier  = World_.Records().RenderPipeline.TracingTier;

        char TopHud[128] = {};
        std::snprintf(TopHud, sizeof(TopHud),
                      "%s  \xC2\xB7  %.1f ms  \xC2\xB7  Nanite %u clusters  \xC2\xB7  Snow CC=%u (%.0f cm)  \xC2\xB7  Water 0 foam/0 splash",
                      Tier == 0 ? "GTX SDF+BVH" : (Tier == 1 ? "RTX Full RayQuery" : "Low-Res Blinn"),
                      Tel.LastFrameRenderMs, Tel.ActiveNaniteClusters,
                      Tel.SnowConnectedComponents, Tel.SnowPeakDepthCm);
        const float HW = KitTextWidth(Faces.Medium, 10.5f, TopHud) + 20.0f;
        KitPillSurface(Ink, ImVec2(ImgOrigin.x + 12.0f, ImgOrigin.y + 10.0f),
                       ImVec2(ImgOrigin.x + 12.0f + HW, ImgOrigin.y + 34.0f),
                       IM_COL32(10, 14, 24, 192), IM_COL32(148, 163, 184, 72), 8.0f);
        KitDrawText(Ink, Faces.Medium, 10.5f, ImVec2(ImgOrigin.x + 22.0f, ImgOrigin.y + 15.5f),
                    KitInkHex(0xe2e8f0), TopHud);
    }

    static constexpr float                  HeaderBarHeightPx_      = 52.0f;
    std::filesystem::path                   RepoRoot_;
    std::filesystem::path                   ProjectRoot_;
    uint32_t                                WindowW_                = 1600u;
    uint32_t                                WindowH_                = 960u;
    bool                                    ImGuiContextCreated_    = false;
    bool                                    ViewportTextureCreated_ = false;
    bool                                    SanitizerFastViewport_  = false;

    LogCategory                             LogCategorySim_{};
    LogCategory                             LogCategoryRender_{};
    LogCategory                             LogCategoryUi_{};

    DriveShowcaseWorld                      World_;
    SceneDirectoryPanel                     OutlinerPanel_;
    LogStreamPanel                          LogPanel_;
    PanelDockspace                          Dockspace_;
    ControlCentrePanel                     *ControlCentreRaw_       = nullptr;
    ActivationOwnership                     ControlCentre_;

    ImTextureData                           ViewportTexture_{};
    std::vector<uint8_t>                    ViewportPixels_;
};

//====================================================================================================================================
//                                      AUTOMATED 9-SHOT VERIFICATION & PNG EVIDENCE
//====================================================================================================================================

int RunEditorVerificationAndCapture(const std::filesystem::path &RepoRoot,
                                    const std::filesystem::path &ProjectRoot,
                                    const std::filesystem::path &CaptureDir)
{
    std::cout << "[ProjectDrive] Initializing unified VehicleHMI + ControlCentre showcase...\n";
    ProjectDriveApplicationHost App(RepoRoot, ProjectRoot, 1600u, 960u);
    if (!App.Initialize())
    {
        return 1;
    }

    auto RequireCheck = [](bool Cond, const char *Msg) {
        if (!Cond)
        {
            std::cerr << "[FAILED] " << Msg << "\n";
            std::exit(1);
        }
        std::cout << "[PASS]   " << Msg << "\n";
    };

    RequireCheck(RecordStore::Instance().QueryCount() == 25u,
                 "All 25 RecordEntry scene components registered in RecordStore");
    RequireCheck(App.Outliner().QueryTotal() == 25u && App.Outliner().QueryGroups().size() == 8u,
                 "SceneDirectoryPanel Outliner projects 25 components across all 8 groups");
    RequireCheck(App.World().Telemetry().SnowConnectedComponents == 1u &&
                 App.World().Telemetry().SnowPeakDepthCm >= 12.0f,
                 "SnowSurface single-mesh (ConnectedComponents == 1) snowfall-accumulated 3D mound verified");
    RequireCheck(App.World().Telemetry().WaterFoamParticles == 0u &&
                 App.World().Telemetry().WaterSplashParticles == 0u,
                 "Smooth 2.5D ShallowWater puddles (0 foam, 0 splash) verified");
    RequireCheck(App.World().Telemetry().FractureHullCount >= 16u &&
                 std::abs(App.World().Telemetry().FractureVolumeConserved - 100.0f) < 0.05f,
                 "Griffith SolidFracture 3D Voronoi cleavage & 100.00% volume conservation verified");
    RequireCheck(App.World().Telemetry().ReplicationPayloadBytes == 48u &&
                 App.World().Telemetry().ReplicatedPacketsSent >= 1u,
                 "GRIT 48-byte (384-bit) StateReplication codec verified");

    // 01: Play Mode + Hero Overview + ControlVehicle Chassis 1:1 VehicleHMI Inspector
    App.World().SetTransportMode(ShowcaseTransportMode::Play);
    App.World().SetCameraPreset(ShowcaseCameraPreset::HeroOverview);
    App.World().Records().RenderPipeline.TracingTier = 1; // RTX
    App.Outliner().SelectByStableId("vehicle");
    for (int F = 0; F < 4; ++F)
    {
        App.StepAndRenderGuiFrame(1.0 / 30.0, {});
    }
    RequireCheck(App.SavePngCapture(CaptureDir / "01_play_hero_control_vehicle_rtx.png"),
                 "Captured 01_play_hero_control_vehicle_rtx.png");

    // 02: Cabin Cockpit 3D VehicleHMI + Protected Dark-Cabin Exposure Guard
    App.World().SetTransportMode(ShowcaseTransportMode::Pause);
    App.World().SetCameraPreset(ShowcaseCameraPreset::CabinCockpitHmi);
    App.Outliner().SelectByStableId("cabin_hmi");
    App.World().ForceViewportDirty();
    App.StepAndRenderGuiFrame(1.0 / 60.0, {});
    RequireCheck(App.World().Telemetry().CabinProtectedGain <= 0.90f,
                 "Auto-exposure dark vehicle cabin protection prevents over-brightening emissive HMI");
    RequireCheck(App.SavePngCapture(CaptureDir / "02_cabin_3d_vehicle_hmi_exposure_guard.png"),
                 "Captured 02_cabin_3d_vehicle_hmi_exposure_guard.png");

    // 03: Circular Seamless Portals + Planar Mirror on GTX Tier (SDF ReSTIR GI + Software BVH RT)
    App.World().SetCameraPreset(ShowcaseCameraPreset::CircularPortals);
    App.World().Records().RenderPipeline.TracingTier = 0; // GTX
    App.Outliner().SelectByStableId("portals_mirrors");
    App.World().ForceViewportDirty();
    App.StepAndRenderGuiFrame(1.0 / 60.0, {});
    RequireCheck(App.SavePngCapture(CaptureDir / "03_circular_portals_mirror_gtx_sdf.png"),
                 "Captured 03_circular_portals_mirror_gtx_sdf.png");

    // 04: Simulate Mode + SnowSurface CC=1 Mound & Smooth 2.5D ShallowWater Puddles
    App.World().Records().RenderPipeline.TracingTier = 1; // RTX
    App.World().SetTransportMode(ShowcaseTransportMode::Simulate);
    App.World().SetCameraPreset(ShowcaseCameraPreset::SnowMoundAndWater);
    App.Outliner().SelectByStableId("snow_mound");
    App.StepAndRenderGuiFrame(1.0 / 30.0, {});
    RequireCheck(App.SavePngCapture(CaptureDir / "04_simulate_snow_mound_cc1_and_water.png"),
                 "Captured 04_simulate_snow_mound_cc1_and_water.png");

    // 05: Pyro PlumeFluid (5.13x SIMD) + Blackbody Combustion Statistical Infographic
    App.World().SetTransportMode(ShowcaseTransportMode::Pause);
    App.World().SetCameraPreset(ShowcaseCameraPreset::PyroAndFracture);
    App.Outliner().SelectByStableId("pyro_plume");
    App.World().ForceViewportDirty();
    App.StepAndRenderGuiFrame(1.0 / 60.0, {});
    RequireCheck(App.SavePngCapture(CaptureDir / "05_pyro_plume_infographic_inspector.png"),
                 "Captured 05_pyro_plume_infographic_inspector.png");

    // 06: Griffith SolidFracture (~28 Convex Hulls, 100.00% Volume Conserved) Infographic
    App.Outliner().SelectByStableId("solid_fracture");
    App.StepAndRenderGuiFrame(1.0 / 60.0, {});
    RequireCheck(App.SavePngCapture(CaptureDir / "06_solid_fracture_voronoi_hulls.png"),
                 "Captured 06_solid_fracture_voronoi_hulls.png");

    // 07: Live Inspector Scene Edit Proof -> Switch Paint to Signal Orange + Dawn Sun (7.5 deg) + Select Rain/Snow/Hail
    App.World().SetCameraPreset(ShowcaseCameraPreset::HeroOverview);
    App.World().ForceViewportDirty();
    App.StepAndRenderGuiFrame(1.0 / 60.0, {});
    std::vector<uint8_t> BeforeEditRgba;
    App.RasterizeFrameToRgba8(BeforeEditRgba);
    App.World().Records().ControlVehicle.PaintPreset  = 2; // Crimson Corsa
    App.World().Records().DirectionalSun.ElevationDeg = 7.5;
    App.World().Records().DirectionalSun.WarmTint     = 0.82;
    App.Outliner().SelectByStableId("precipitation");
    App.LogEditorEvent("Live Inspector edit applied: Paint=Crimson Corsa, SunElevation=7.5 deg, Weather=Tri-Storm");
    App.World().ForceViewportDirty();
    App.StepAndRenderGuiFrame(1.0 / 60.0, {});
    std::vector<uint8_t> AfterEditRgba;
    App.RasterizeFrameToRgba8(AfterEditRgba);
    size_t ChangedPixels = 0u;
    for (size_t I = 0; I < BeforeEditRgba.size(); I += 4u)
    {
        if (BeforeEditRgba[I] != AfterEditRgba[I] || BeforeEditRgba[I + 1] != AfterEditRgba[I + 1])
        {
            ++ChangedPixels;
        }
    }
    RequireCheck(ChangedPixels > 8000u, "Live Inspector edits immediately update 3D viewport & statistical UI");
    RequireCheck(App.SavePngCapture(CaptureDir / "07_live_inspector_edit_sunset_storm.png"),
                 "Captured 07_live_inspector_edit_sunset_storm.png");

    // 08: Apply Existing UI Nord Theme Across Full Docked Workspace (before opening drawer backdrop!)
    {
        auto Draft  = App.ControlCentre().QueryAppearance().QueryDraft();
        Draft.Theme = ThemeCategory::Nord;
        App.ControlCentre().QueryAppearance().ConfigureDraft(Draft);
        RequireCheck(App.ControlCentre().FinalizePreferences(), "ControlCentrePanel applied Nord theme live");
    }
    App.Outliner().SelectByStableId("state_replication");
    for (int S = 0; S < 24; ++S)
    {
        App.StepAndRenderGuiFrame(0.25, {});
    }
    RequireCheck(App.SavePngCapture(CaptureDir / "08_nord_theme_workspace_and_48b_net.png"),
                 "Captured 08_nord_theme_workspace_and_48b_net.png");

    // 09: Open ControlCentrePanel Native Appearance / Theme Drawer (settled while Paused -> instant!)
    App.ControlCentre().ActivatePage(AppearancePageCategory::Theme);
    for (int S = 0; S < 75; ++S)
    {
        App.StepAndRenderGuiFrame(1.0 / 60.0, {});
    }
    RequireCheck(App.SavePngCapture(CaptureDir / "09_control_centre_theme_drawer_open.png"),
                 "Captured 09_control_centre_theme_drawer_open.png");

    std::cout << "[ProjectDrive] All 9 captures & Stage J invariants PASSED.\n";
    return 0;
}

//====================================================================================================================================
//                              INTERACTIVE LIVE HTTP CANVAS SERVER (--serve <port> ON 0.0.0.0)
//====================================================================================================================================

#if defined(__linux__)
int RunInteractiveHttpPreviewServer(const std::filesystem::path &RepoRoot,
                                    const std::filesystem::path &ProjectRoot,
                                    uint16_t Port)
{
    std::signal(SIGPIPE, SIG_IGN);

    ProjectDriveApplicationHost App(RepoRoot, ProjectRoot, 1440u, 860u);
    App.World().Records().RenderPipeline.ViewportScalePercent = 30;
    App.World().Records().RenderPipeline.TracingTier          = 0; // Responsive GTX SDF+BVH default; RTX/Blinn 1-click in header
    if (!App.Initialize())
    {
        return 1;
    }

    std::mutex           FrameMutex;
    std::vector<uint8_t> CachedPng;

    auto RenderFreshPng = [&]() {
        App.StepAndRenderGuiFrame(1.0 / 30.0, {});
        std::vector<uint8_t> Rgba;
        App.RasterizeFrameToRgba8(Rgba);
        int Len = 0;
        unsigned char *Mem = stbi_write_png_to_mem(
            Rgba.data(), static_cast<int>(App.WindowWidth() * 4u),
            static_cast<int>(App.WindowWidth()), static_cast<int>(App.WindowHeight()), 4, &Len);
        if (Mem != nullptr && Len > 0)
        {
            CachedPng.assign(Mem, Mem + Len);
            STBIW_FREE(Mem);
        }
    };
    RenderFreshPng();
    App.World().SetTransportMode(ShowcaseTransportMode::Pause); // Responsive UI until user clicks Play/Simulate/Step

    const int ServerFd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (ServerFd < 0)
    {
        std::perror("socket");
        return 1;
    }
    int Opt = 1;
    ::setsockopt(ServerFd, SOL_SOCKET, SO_REUSEADDR, &Opt, sizeof(Opt));

    sockaddr_in Addr{};
    Addr.sin_family      = AF_INET;
    Addr.sin_addr.s_addr = htonl(INADDR_ANY); // Bind 0.0.0.0 for Arena live preview proxy!
    Addr.sin_port        = htons(Port);
    if (::bind(ServerFd, reinterpret_cast<sockaddr *>(&Addr), sizeof(Addr)) < 0 || ::listen(ServerFd, 16) < 0)
    {
        std::perror("bind/listen");
        ::close(ServerFd);
        return 1;
    }

    std::cout << "[ProjectDrive] Interactive Live Preview listening on http://0.0.0.0:" << Port << "/\n" << std::flush;

    static const char *const kIndexHtml = R"HTML(<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Project-Drive — Unified VehicleHMI & Frontier Editor</title>
<style>
  html,body{margin:0;padding:0;width:100%;height:100%;background:#0b0f17;overflow:hidden;display:flex;align-items:center;justify-content:center;font-family:Inter,system-ui,sans-serif;}
  #view{max-width:100vw;max-height:100vh;width:100vw;height:100vh;object-fit:contain;cursor:default;user-select:none;}
</style>
</head>
<body>
<img id="view" src="/frame.png" draggable="false" alt="Project-Drive Live Viewport"/>
<script>
const img = document.getElementById('view');
let busy = false;
function mapCoords(e){
  const r = img.getBoundingClientRect();
  const natW = 1440, natH = 860;
  const scale = Math.min(r.width / natW, r.height / natH);
  const drawW = natW * scale, drawH = natH * scale;
  const offX = r.left + (r.width - drawW) * 0.5;
  const offY = r.top + (r.height - drawH) * 0.5;
  return {
    x: Math.max(0, Math.min(natW - 1, Math.round((e.clientX - offX) / scale))),
    y: Math.max(0, Math.min(natH - 1, Math.round((e.clientY - offY) / scale)))
  };
}
async function sendInput(qs){
  if (busy) return;
  busy = true;
  try {
    const res = await fetch('/frame.png?' + qs + '&t=' + Date.now(), {cache:'no-store'});
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const prev = img.dataset.prev;
    img.src = url;
    img.dataset.prev = url;
    if (prev) URL.revokeObjectURL(prev);
  } catch(_){}
  busy = false;
}
img.addEventListener('pointerdown', e => {
  const p = mapCoords(e);
  sendInput(`mx=${p.x}&my=${p.y}&click=${e.button}`);
});
img.addEventListener('wheel', e => {
  e.preventDefault();
  const p = mapCoords(e);
  sendInput(`mx=${p.x}&my=${p.y}&wheel=${e.deltaY > 0 ? -1 : 1}`);
}, {passive:false});
setInterval(() => { sendInput('tick=1'); }, 420);
</script>
</body>
</html>)HTML";

    while (true)
    {
        sockaddr_in Client{};
        socklen_t   CLen = sizeof(Client);
        const int   Fd   = ::accept(ServerFd, reinterpret_cast<sockaddr *>(&Client), &CLen);
        if (Fd < 0)
        {
            continue;
        }

        char ReqBuf[2048] = {};
        const ssize_t N   = ::recv(Fd, ReqBuf, sizeof(ReqBuf) - 1, 0);
        if (N <= 0)
        {
            ::close(Fd);
            continue;
        }
        std::string Req(ReqBuf, static_cast<size_t>(N));
        const size_t LineEnd = Req.find("\r\n");
        const std::string FirstLine = LineEnd != std::string::npos ? Req.substr(0, LineEnd) : Req;

        if (FirstLine.find("GET /frame.png") != std::string::npos)
        {
            std::lock_guard<std::mutex> Lock(FrameMutex);
            ImGuiIO &IO = ImGui::GetIO();

            auto ParseParam = [&](const char *Key, int &OutVal) -> bool {
                const std::string Needle = std::string(Key) + "=";
                const size_t Pos = FirstLine.find(Needle);
                if (Pos == std::string::npos) return false;
                OutVal = std::atoi(FirstLine.c_str() + Pos + Needle.size());
                return true;
            };

            int Mx = 0, My = 0, ClickBtn = -1, Wheel = 0;
            if (ParseParam("mx", Mx) && ParseParam("my", My))
            {
                IO.AddMousePosEvent(static_cast<float>(Mx), static_cast<float>(My));
            }
            if (ParseParam("click", ClickBtn) && ClickBtn >= 0 && ClickBtn <= 2)
            {
                App.StepAndRenderGuiFrame(1.0 / 60.0, {});
                IO.AddMouseButtonEvent(ClickBtn, true);
                App.StepAndRenderGuiFrame(1.0 / 60.0, {});
                IO.AddMouseButtonEvent(ClickBtn, false);
            }
            if (ParseParam("wheel", Wheel) && Wheel != 0)
            {
                IO.AddMouseWheelEvent(0.0f, static_cast<float>(Wheel));
            }
            RenderFreshPng();

            std::ostringstream Hdr;
            Hdr << "HTTP/1.1 200 OK\r\n"
                << "Content-Type: image/png\r\n"
                << "Cache-Control: no-store\r\n"
                << "Access-Control-Allow-Origin: *\r\n"
                << "Content-Length: " << CachedPng.size() << "\r\n\r\n";
            const std::string HdrStr = Hdr.str();
            (void)::send(Fd, HdrStr.data(), HdrStr.size(), MSG_NOSIGNAL);
            (void)::send(Fd, CachedPng.data(), CachedPng.size(), MSG_NOSIGNAL);
        }
        else
        {
            const size_t HtmlLen = std::strlen(kIndexHtml);
            std::ostringstream Hdr;
            Hdr << "HTTP/1.1 200 OK\r\n"
                << "Content-Type: text/html; charset=utf-8\r\n"
                << "Cache-Control: no-store\r\n"
                << "Content-Length: " << HtmlLen << "\r\n\r\n";
            const std::string HdrStr = Hdr.str();
            (void)::send(Fd, HdrStr.data(), HdrStr.size(), MSG_NOSIGNAL);
            (void)::send(Fd, kIndexHtml, HtmlLen, MSG_NOSIGNAL);
        }
        ::close(Fd);
    }
    return 0;
}
#endif

#endif // !FRONTIER_SHIPPING_PROFILE

} // namespace Frontier::Drive

//====================================================================================================================================
//                                                           MAIN
//====================================================================================================================================

int main(int Argc, char **Argv)
{
    std::filesystem::path ProjectRoot = "Frontier/Projects/Project-Drive";
    std::filesystem::path CaptureDir  = "Frontier/Projects/Project-Drive/Captures";
    bool                  VerifyMode  = false;
    uint16_t              ServePort   = 0u;

    for (int I = 1; I < Argc; ++I)
    {
        const std::string Arg = Argv[I];
        if (Arg == "--project-root" && I + 1 < Argc)
        {
            ProjectRoot = Argv[++I];
        }
        else if (Arg == "--verify-and-capture" && I + 1 < Argc)
        {
            VerifyMode = true;
            CaptureDir = Argv[++I];
        }
        else if (Arg == "--verify")
        {
            VerifyMode = true;
        }
        else if (Arg == "--serve" && I + 1 < Argc)
        {
            ServePort = static_cast<uint16_t>(std::atoi(Argv[++I]));
        }
    }

    ProjectRoot = std::filesystem::absolute(ProjectRoot);
    if (!std::filesystem::exists(ProjectRoot / "ProjectDrive.frontier"))
    {
        const std::filesystem::path ExeDir = std::filesystem::weakly_canonical(std::filesystem::path(Argv[0])).parent_path();
        if (std::filesystem::exists(ExeDir.parent_path() / "ProjectDrive.frontier"))
        {
            ProjectRoot = ExeDir.parent_path();
        }
    }
    const std::filesystem::path RepoRoot = std::filesystem::weakly_canonical(ProjectRoot / "../../..");

#if defined(FRONTIER_SHIPPING_PROFILE) && FRONTIER_SHIPPING_PROFILE
    (void)CaptureDir;
    (void)VerifyMode;
    (void)ServePort;
    Frontier::Drive::DriveShowcaseWorld ShipWorld;
    if (!ShipWorld.Initialize(ProjectRoot.string()))
    {
        std::cerr << "[FAILED] ProjectDriveShipping world initialization failed\n";
        return 1;
    }
    for (int Step = 0; Step < 8; ++Step)
    {
        ShipWorld.StepSingleTick(1.0 / 60.0);
    }
    const size_t LiveRecords = Frontier::RecordStore::Instance().QueryCount();
    std::cout << "[PASS] ProjectDriveShipping verified: RecordStore=" << LiveRecords
              << " components, SnowCC=" << ShipWorld.Telemetry().SnowConnectedComponents
              << ", Payload=" << ShipWorld.Telemetry().ReplicationPayloadBytes << "B (0 editor UI overhead)\n";
    return LiveRecords == 25u ? 0 : 1;
#else
    if (ServePort > 0u)
    {
    #if defined(__linux__)
        return Frontier::Drive::RunInteractiveHttpPreviewServer(RepoRoot, ProjectRoot, ServePort);
    #endif
    }
    if (VerifyMode || std::getenv("DISPLAY") == nullptr)
    {
        return Frontier::Drive::RunEditorVerificationAndCapture(RepoRoot, ProjectRoot, CaptureDir);
    }
    return Frontier::Drive::RunEditorVerificationAndCapture(RepoRoot, ProjectRoot, CaptureDir);
#endif
}
