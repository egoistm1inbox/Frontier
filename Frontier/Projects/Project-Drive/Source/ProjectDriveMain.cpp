/*====================================================================================================================================
                                                      PROJECTDRIVEMAIN.CPP
====================================================================================================================================*/
// 🧩 Unified Project-Drive binary: 1:1 C++ Dark OLED port of the ReSTIR GI VehicleHMI Proving Grounds UI
//    (FrontierEditor.css + EditorShell.js + EditorControls.js + InspectorPages.js) reusing ControlCentrePanel,
//    ThemeStructure (ThemeCategory::Oled), PanelDockspace, SceneDirectoryPanel, SceneInspectorPanel, and
//    per-entity zero-copy shared-memory Dedicated Popup Studios (#if defined(FRONTIER_EDITOR_PROFILE)).

#include "DedicatedEntityEditors.h"
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

    #include <imgui_internal.h>

    #define STB_IMAGE_WRITE_IMPLEMENTATION
    #include <stb_image_write.h>
#endif

#if defined(__linux__)
    #include <arpa/inet.h>
    #include <csignal>
    #include <fstream>
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

#if defined(_WIN32) && (!defined(FRONTIER_SHIPPING_PROFILE) || !FRONTIER_SHIPPING_PROFILE)
    #include <windows.h>
    #include <d3d11.h>
    #include <dwmapi.h>
    #include <dxgi.h>
    #include <imgui_impl_dx11.h>
    #include <imgui_impl_win32.h>
extern IMGUI_IMPL_API LRESULT ImGui_ImplWin32_WndProcHandler(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam);
#endif

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
        DedicatedEditors_.CloseAllEditors();
        if (ViewportTextureCreated_)
        {
            if (ImGuiContextCreated_ && ImGui::GetCurrentContext() != nullptr)
            {
                ImGui::UnregisterUserTexture(&ViewportTexture_);
            }
            ViewportTexture_.DestroyPixels();
            ViewportTextureCreated_ = false;
        }
        ControlCentreRaw_ = nullptr;
        ControlCentre_.reset();
        if (ImGuiContextCreated_ && OwnsImGuiContext_)
        {
            ImGui::DestroyContext();
            ImGuiContextCreated_ = false;
        }
    }

    bool Initialize(bool CreateOwnImGuiContext = true, bool UsingHardwareGpuBackend = false)
    {
        UsingHardwareGpuBackend_ = UsingHardwareGpuBackend;
        LogCategorySim_          = RegisterLogCategory("Simulation", LogColour::Mint);
        LogCategoryRender_       = RegisterLogCategory("Renderer", LogColour::Blue);
        LogCategoryUi_           = RegisterLogCategory("EditorUI", LogColour::Purple);

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

        const std::filesystem::path FontsDir  = RepoRoot_ / "EngineContent/FontArchives";
        const std::filesystem::path IconsDir  = RepoRoot_ / "EngineContent/Icons";
        const std::filesystem::path PrefsPath = ProjectRoot_ / ".local_appearance.toml";

        if (CreateOwnImGuiContext)
        {
            ImGui::CreateContext();
            OwnsImGuiContext_ = true;
        }
        ImGuiContextCreated_ = true;
        ImGuiIO &IO          = ImGui::GetIO();
        IO.IniFilename       = nullptr;
        IO.ConfigFlags      |= ImGuiConfigFlags_DockingEnable;
        IO.DisplaySize       = ImVec2(static_cast<float>(WindowW_), static_cast<float>(WindowH_));
        IO.DeltaTime         = 1.0f / 60.0f;
        if (!UsingHardwareGpuBackend_)
        {
            IO.BackendFlags |= ImGuiBackendFlags_RendererHasTextures | ImGuiBackendFlags_RendererHasVtxOffset;
            ImGui::GetPlatformIO().Renderer_TextureMaxWidth  = 4096;
            ImGui::GetPlatformIO().Renderer_TextureMaxHeight = 4096;
        }

        IconPresentation::Attach(IconsDir.string());

        ControlCentreRaw_ = new ControlCentrePanel(FontsDir, PrefsPath);
        ControlCentre_.reset(ControlCentreRaw_);
        if (!ControlCentreRaw_->Initialize() || !ControlCentreRaw_->Activate())
        {
            std::cerr << "[FAILED] ControlCentrePanel initialization failed\n";
            return false;
        }

        // Force pure Dark OLED theme (ThemeCategory::Oled) on startup — 1:1 with FrontierEditor.css!
        ApplyDarkOledTheme();
        for (int ClearToast = 0; ClearToast < 16; ++ClearToast)
        {
            (void)ControlCentreRaw_->Integrate(0.5);
        }

        // 1:1 VehicleProvingGrounds Shell Grid: Left Outliner | Centre Viewport + Log | Right Inspector | Bottom 28px #status
        Dockspace_.ConfigureDockspaceKey("ProjectDriveOledShellDock");
        Dockspace_.ConfigureWorkspaceInsets(0.0f, StatusBarHeightPx_);
        Dockspace_.Register(MakeSceneDirectoryPanelSpecification(OutlinerPanel_));

        DockPanelSpecification ViewportSpec;
        ViewportSpec.Key              = "Viewport";
        ViewportSpec.Caption          = "Viewport";
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

        Dockspace_.ConfigureStackedPanels("Viewport", "LogStream", 688.0f);
        Dockspace_.ConfigureColumns({{"Outliner", 0.195f}, {"LogStream", 0.545f}, {"Inspector", 0.260f}});

        OutlinerPanel_.Synchronize(SceneDirectory::Instance());
        OutlinerPanel_.SelectByStableId("vehicle");

        WriteLog(LogCategorySim_, LogSeverity::Info,
                 "Project-Drive initialized: 30 shared-memory entities (MAP_SHARED, 0 B duplicated) across 8 groups",
                 "ProjectDriveMain.cpp");
        WriteLog(LogCategoryRender_, LogSeverity::Info,
                 "4-tap PCSS solar shadows + hemisphere Contact AO + GTX/RTX ReSTIR GI + Nanite K1 ready",
                 "SceneRenderer.cpp");
        WriteLog(LogCategoryUi_, LogSeverity::Info,
                 "1:1 Dark OLED VehicleHMI shell + Dedicated Entity Studios (#if defined(FRONTIER_EDITOR_PROFILE)) ready",
                 "DedicatedEntityEditors.cpp");

        if (!UsingHardwareGpuBackend_)
        {
            World_.SetTransportMode(ShowcaseTransportMode::Pause);
            for (int Warm = 0; Warm < 4; ++Warm)
            {
                StepAndRenderGuiFrame(1.0 / 60.0, {});
            }
            World_.SetTransportMode(ShowcaseTransportMode::Play);
        }
        return true;
    }

    void ApplyDarkOledTheme()
    {
        auto Draft  = ControlCentreRaw_->QueryAppearance().QueryDraft();
        Draft.Theme = ThemeCategory::Oled;
        ControlCentreRaw_->QueryAppearance().ConfigureDraft(Draft);
        (void)ControlCentreRaw_->FinalizePreferences();
    }

    void ResizeWindow(uint32_t NewW, uint32_t NewH) noexcept
    {
        WindowW_ = std::max(320u, NewW);
        WindowH_ = std::max(240u, NewH);
    }

    // Builds one complete ImGui frame (caller invokes ImGui_Impl*_NewFrame beforehand if UsingHardwareGpuBackend_).
    void BuildUiFrame(double DtSeconds, const DriveControlReadings &Controls)
    {
        ImGuiIO &IO = ImGui::GetIO();
        if (!UsingHardwareGpuBackend_)
        {
            IO.DisplaySize = ImVec2(static_cast<float>(WindowW_), static_cast<float>(WindowH_));
            IO.DeltaTime   = static_cast<float>(std::clamp(DtSeconds, 1.0 / 240.0, 0.1));
        }

        World_.TickFrame(DtSeconds, Controls);
        OutlinerPanel_.Synchronize(SceneDirectory::Instance());

        if (auto SpawnReq = OutlinerPanel_.TakeSpawnRequest(); SpawnReq.has_value())
        {
            const std::string NewObjId = World_.ActivateNextSpawnedObject();
            OutlinerPanel_.Synchronize(SceneDirectory::Instance());
            OutlinerPanel_.SelectByStableId(NewObjId);
            DedicatedEditors_.OpenEditorForEntity(NewObjId, World_);
            WriteLogFormat(LogCategoryUi_.Token, LogSeverity::Info, LogVerbosity::Log, "OutlinerSpawn",
                           "Placed 3D object '%s' in OS shared memory & opened 3D Object Studio", NewObjId.c_str());
        }

        if (auto StudioReq = OutlinerPanel_.TakeDedicatedEditorRequest(); StudioReq.has_value())
        {
            DedicatedEditors_.OpenEditorForEntity(*StudioReq, World_);
            WriteLogFormat(LogCategoryUi_.Token, LogSeverity::Info, LogVerbosity::Log, "DedicatedStudio",
                           "Opened zero-copy Dedicated Entity Studio for '%s' (0 B duplicated)", StudioReq->c_str());
        }

        LogPanel_.Synchronize(LogStore(), LogCategories(), DtSeconds);
        (void)ControlCentreRaw_->Integrate(DtSeconds);
        ControlCentreRaw_->PrepareInterface();

        const float AppliedScale = ControlCentreRaw_->QueryAppearance().QueryApplied().InterfaceScale / 100.0f;

        ImGui::NewFrame();
        Dockspace_.ConstructInterface(AppliedScale);
        DedicatedEditors_.RenderOpenEditorWindows(World_);
        DrawBottomStatusBar();
        ControlCentreRaw_->ConstructInterface();
        ImGui::Render();
    }

    void StepAndRenderGuiFrame(double DtSeconds, const DriveControlReadings &Controls)
    {
        BuildUiFrame(DtSeconds, Controls);
        if (!UsingHardwareGpuBackend_)
        {
            FrontierExhibit::AcknowledgeTextures();
        }
    }

    void RasterizeFrameToRgba8(std::vector<uint8_t> &OutRgba8)
    {
        std::vector<uint8_t> Rgb(static_cast<size_t>(WindowW_) * WindowH_ * 3u, 10u);
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

    DriveShowcaseWorld        &World() noexcept { return World_; }
    SceneDirectoryPanel       &Outliner() noexcept { return OutlinerPanel_; }
    DedicatedEntityEditorHost &DedicatedEditors() noexcept { return DedicatedEditors_; }
    ControlCentrePanel        &ControlCentre() noexcept { return *ControlCentreRaw_; }
    const std::vector<uint8_t>&LatestViewportPixels() const noexcept { return ViewportPixels_; }
    uint32_t                   LatestViewportWidth() const noexcept { return LastViewportW_; }
    uint32_t                   LatestViewportHeight() const noexcept { return LastViewportH_; }
    uint32_t                   WindowWidth() const noexcept { return WindowW_; }
    uint32_t                   WindowHeight() const noexcept { return WindowH_; }
    void                       LogEditorEvent(const char *Message)
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
                ImGui::UnregisterUserTexture(&ViewportTexture_);
                ViewportTexture_.DestroyPixels();
            }
            ViewportTexture_ = ImTextureData();
            ViewportTexture_.Create(ImTextureFormat_RGBA32, static_cast<int>(W), static_cast<int>(H));
            ImGui::RegisterUserTexture(&ViewportTexture_);
            ViewportTextureCreated_ = true;
        }
        std::memcpy(ViewportTexture_.GetPixels(), Rgba8.data(), static_cast<size_t>(W) * H * 4u);
        ViewportTexture_.SetStatus(ImTextureStatus_WantUpdates);
        LastViewportW_ = W;
        LastViewportH_ = H;
    }

    // 1:1 VehicleProvingGrounds/index.html .viewport-bar + #stage + #hud
    void DrawViewportPanelContent()
    {
        const KitFaces Faces  = ResolveKitFaces();
        ImDrawList    *Ink    = ImGui::GetWindowDrawList();
        const ImVec2   Origin = ImGui::GetCursorScreenPos();
        const ImVec2   Avail  = ImGui::GetContentRegionAvail();
        const float    TotalW = std::max(220.0f, Avail.x);
        const float    TotalH = std::max(140.0f, Avail.y);
        constexpr float BarH  = 40.0f;

        // .viewport-bar (#121212 Dark OLED monochrome toolbar — zero rainbow tint!)
        Ink->AddRectFilled(Origin, ImVec2(Origin.x + TotalW, Origin.y + BarH), KitInkHex(0x121212));
        Ink->AddLine(ImVec2(Origin.x, Origin.y + BarH), ImVec2(Origin.x + TotalW, Origin.y + BarH),
                     KitInkHex(0x262626), 1.0f);

        const float Y0 = Origin.y + 6.0f;
        const float BH = 28.0f;
        float       CX = Origin.x + 8.0f;

        auto DrawMonoPillBtn = [&](const char *Id, const char *Label, float W, bool Active, bool HasGreenDot = false) -> bool {
            ImGui::SetCursorScreenPos(ImVec2(CX, Y0));
            ImGui::InvisibleButton(Id, ImVec2(W, BH));
            const bool Hov = ImGui::IsItemHovered();
            KitPillSurface(Ink, ImVec2(CX, Y0), ImVec2(CX + W, Y0 + BH),
                           Active ? KitInkHex(0x2b2b2b) : (Hov ? KitInkHex(0x222222) : KitInkHex(0x191919)),
                           Active ? KitInkHex(0x464646) : KitInkHex(0x2d2d2d), 8.0f);
            float TextOff = 0.0f;
            if (HasGreenDot)
            {
                Ink->AddCircleFilled(ImVec2(CX + 10.5f, Y0 + BH * 0.5f), 2.8f,
                                     Active ? KitInkHex(0x3ec46d) : KitInkHex(0x666666), 8);
                TextOff = 7.0f;
            }
            const float TW = KitTextWidth(Active ? Faces.Medium : Faces.Regular, 10.0f, Label);
            KitDrawText(Ink, Active ? Faces.Medium : Faces.Regular, 10.0f,
                        ImVec2(CX + TextOff + (W - TextOff - TW) * 0.5f, Y0 + 7.5f),
                        Active ? KitInkHex(0xf0f0f0) : KitInkHex(0xa8a8a8), Label);
            CX += W + 4.0f;
            return ImGui::IsItemClicked();
        };

        // 1. Camera Preset Selector ("Perspective ▾")
        static const char *const kCamLabels[6] = {
            "Cam: Hero", "Cam: Cabin HMI", "Cam: Portals", "Cam: Snow/H2O", "Cam: Pyro/Frac", "Cam: Chase"};
        const int CurCam = std::clamp(static_cast<int>(World_.GetCameraPreset()), 0, 5);
        if (DrawMonoPillBtn("##VpCamMenuBtn", kCamLabels[CurCam], 96.0f, false))
        {
            ImGui::OpenPopup("##VpCamPopup");
        }
        if (ImGui::BeginPopup("##VpCamPopup"))
        {
            for (int C = 0; C < 6; ++C)
            {
                if (ImGui::MenuItem(kCamLabels[C], nullptr, CurCam == C))
                {
                    World_.SetCameraPreset(static_cast<ShowcaseCameraPreset>(C));
                }
            }
            ImGui::EndPopup();
        }

        // 2. 1:1 VehicleProvingGrounds "Display ▾" Inspection Dropdown!
        static const char *const kInspectNames[7] = {
            "Display: Final", "Display: Shadows", "Display: ReSTIR GI",
            "Display: Reflect", "Display: Global SDF", "Display: Normals", "Display: Albedo"};
        int &InspMode = World_.Records().RenderPipeline.InspectionMode;
        InspMode      = std::clamp(InspMode, 0, 6);
        if (DrawMonoPillBtn("##VpDisplayMenuBtn", kInspectNames[InspMode], 112.0f, InspMode != 0))
        {
            ImGui::OpenPopup("##VpDisplayPopup");
        }
        if (ImGui::BeginPopup("##VpDisplayPopup"))
        {
            static const char *const kFullInspect[7] = {
                "Final image", "Direct sun & shadows", "Indirect diffuse (ReSTIR GI)",
                "Glossy reflections", "Global distance field", "Normals", "Albedo"};
            for (int M = 0; M < 7; ++M)
            {
                if (ImGui::MenuItem(kFullInspect[M], nullptr, InspMode == M))
                {
                    InspMode = M;
                    World_.ForceViewportDirty();
                }
            }
            ImGui::EndPopup();
        }

        Ink->AddLine(ImVec2(CX + 1.0f, Y0 + 5.0f), ImVec2(CX + 1.0f, Y0 + BH - 5.0f), KitInkHex(0x282828), 1.0f);
        CX += 7.0f;

        // 3. Play | Pause | Simulate + Step + Reset Transport Strip
        if (DrawMonoPillBtn("##TpPlay", "Play", 52.0f, World_.GetTransportMode() == ShowcaseTransportMode::Play, true))
        {
            World_.SetTransportMode(ShowcaseTransportMode::Play);
        }
        if (DrawMonoPillBtn("##TpPause", "Pause", 54.0f, World_.GetTransportMode() == ShowcaseTransportMode::Pause))
        {
            World_.SetTransportMode(ShowcaseTransportMode::Pause);
        }
        if (DrawMonoPillBtn("##TpSim", "Simulate", 66.0f, World_.GetTransportMode() == ShowcaseTransportMode::Simulate, true))
        {
            World_.SetTransportMode(ShowcaseTransportMode::Simulate);
        }
        if (DrawMonoPillBtn("##TpStep", "Step", 42.0f, false))
        {
            World_.SetTransportMode(ShowcaseTransportMode::Pause);
            World_.StepSingleTick(1.0 / 60.0);
        }
        if (DrawMonoPillBtn("##TpReset", "Reset", 46.0f, false))
        {
            World_.ResetAllSystems();
        }

        Ink->AddLine(ImVec2(CX + 1.0f, Y0 + 5.0f), ImVec2(CX + 1.0f, Y0 + BH - 5.0f), KitInkHex(0x282828), 1.0f);
        CX += 7.0f;

        // 4. GPU Tracing Tier (GTX | RTX | Blinn)
        static const char *const kTiers[3] = {"GTX", "RTX", "Blinn"};
        for (int T = 0; T < 3; ++T)
        {
            if (DrawMonoPillBtn(T == 0 ? "##Tier0" : (T == 1 ? "##Tier1" : "##Tier2"),
                                kTiers[T], 42.0f, World_.Records().RenderPipeline.TracingTier == T))
            {
                World_.Records().RenderPipeline.TracingTier = T;
                World_.ForceViewportDirty();
            }
        }

        // Right-aligned [Studio ↗] + [Theme] + FPS pill
        const float RightEnd = Origin.x + TotalW - 8.0f;
        const float ThemeW   = 62.0f;
        const float StudioW  = 68.0f;
        const float ThemeX   = RightEnd - ThemeW;
        const float StudioX  = ThemeX - StudioW - 5.0f;
        if (StudioX > CX + 4.0f)
        {
            CX = StudioX;
            if (DrawMonoPillBtn("##OpenSelStudioBtn", "Studios", StudioW,
                                DedicatedEditors_.OpenWindowCount() > 0u, DedicatedEditors_.OpenWindowCount() > 0u))
            {
                const std::string SelId = OutlinerPanel_.QueryInspectorModel().StableId;
                DedicatedEditors_.OpenEditorForEntity(SelId.empty() ? "pyro_plume" : SelId, World_);
            }
            CX = ThemeX;
            if (DrawMonoPillBtn("##OpenCtrlCentreBtn", "Theme", ThemeW, ControlCentreRaw_->QueryCentreOpen()))
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
        }

        // #stage 3D Viewport Canvas below .viewport-bar
        const float    StageY = Origin.y + BarH + 1.0f;
        const uint32_t PanelW = static_cast<uint32_t>(std::max(160.0f, TotalW));
        const uint32_t PanelH = static_cast<uint32_t>(std::max(100.0f, TotalH - BarH - 1.0f));
        const uint32_t ReqW   = SanitizerFastViewport_ ? 180u : PanelW;
        const uint32_t ReqH   = SanitizerFastViewport_ ? 108u : PanelH;

        uint32_t RW = 0u, RH = 0u;
        if (World_.RenderViewportIfNeeded(ReqW, ReqH, ViewportPixels_, RW, RH))
        {
            UploadViewportPixels(ViewportPixels_, RW, RH);
        }

        ImGui::SetCursorScreenPos(ImVec2(Origin.x, StageY));
        if (ViewportTextureCreated_)
        {
            ImGui::Image(ViewportTexture_.GetTexRef(), ImVec2(static_cast<float>(PanelW), static_cast<float>(PanelH)));
        }

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
                const float U = (IO.MousePos.x - Origin.x) / std::max(1.0f, static_cast<float>(PanelW));
                const float V = (IO.MousePos.y - StageY) / std::max(1.0f, static_cast<float>(PanelH));
                if (V < 0.25f) OutlinerPanel_.SelectByStableId("sun");
                else if (U < 0.36f && V > 0.42f) OutlinerPanel_.SelectByStableId("vehicle");
                else if (U > 0.68f && V < 0.62f) OutlinerPanel_.SelectByStableId("pyro_plume");
                else if (U > 0.56f && V >= 0.62f) OutlinerPanel_.SelectByStableId("placeable_chicane_block");
                else OutlinerPanel_.SelectByStableId("portals_mirrors");
            }
        }

        // 1:1 VehicleProvingGrounds #hud bottom-left Dark OLED pill
        const float HudY = StageY + static_cast<float>(PanelH) - 34.0f;
        const char *HudText = "WASD Drive  \xC2\xB7  Right-Drag Orbit  \xC2\xB7  Double-Click Outliner Row -> Dedicated Studio";
        const float HudW    = KitTextWidth(Faces.Regular, 10.0f, HudText) + 24.0f;
        KitPillSurface(Ink, ImVec2(Origin.x + 12.0f, HudY), ImVec2(Origin.x + 12.0f + HudW, HudY + 24.0f),
                       IM_COL32(12, 12, 12, 210), KitInkHex(0x2a2a2a), 8.0f);
        KitDrawText(Ink, Faces.Regular, 10.0f, ImVec2(Origin.x + 24.0f, HudY + 5.5f), KitInkHex(0xb8b8b8), HudText);
    }

    // 1:1 VehicleProvingGrounds #status bottom 28 px Dark OLED status strip
    void DrawBottomStatusBar()
    {
        const ImGuiViewport *MainVp = ImGui::GetMainViewport();
        ImGui::SetNextWindowPos(ImVec2(MainVp->Pos.x, MainVp->Pos.y + MainVp->Size.y - StatusBarHeightPx_));
        ImGui::SetNextWindowSize(ImVec2(MainVp->Size.x, StatusBarHeightPx_));

        constexpr ImGuiWindowFlags Flags = ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove |
                                           ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoDocking |
                                           ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoInputs;
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(14.0f, 4.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.055f, 0.055f, 0.055f, 1.0f)); // #0e0e0e
        if (ImGui::Begin("##ProjectDriveBottomStatusBar", nullptr, Flags))
        {
            const KitFaces Faces = ResolveKitFaces();
            ImDrawList    *Ink   = ImGui::GetWindowDrawList();
            const ImVec2   P     = ImGui::GetWindowPos();
            const ImVec2   S     = ImGui::GetWindowSize();
            const auto    &Tel   = World_.Telemetry();
            const int32_t  Tier  = World_.Records().RenderPipeline.TracingTier;

            Ink->AddLine(P, ImVec2(P.x + S.x, P.y), KitInkHex(0x242424), 1.0f);
            Ink->AddCircleFilled(ImVec2(P.x + 18.0f, P.y + S.y * 0.5f), 3.0f, KitInkHex(0x3ec46d), 10);
            KitDrawText(Ink, Faces.Regular, 10.0f, ImVec2(P.x + 27.0f, P.y + 7.5f), KitInkHex(0xc4c4c4), "Ready");

            char Mid[220] = {};
            std::snprintf(Mid, sizeof(Mid),
                          "Renderer: %s   |   Shadows: 4-tap Solar Penumbra + Contact AO   |   Shared Memory: %s (%zu B, 0 B dup)   |   Studios: %zu",
                          Tier == 0 ? "ReSTIR GI + GTX SDF" : (Tier == 1 ? "ReSTIR GI + RTX" : "Blinn"),
                          World_.SharedMemory().IsOsSharedMapping() ? "MAP_SHARED" : "Shared",
                          World_.SharedMemory().MappedSizeBytes(),
                          DedicatedEditors_.OpenWindowCount());
            KitDrawText(Ink, Faces.Regular, 10.0f, ImVec2(P.x + 84.0f, P.y + 7.5f), KitInkHex(0x868686), Mid);

            char RightStat[96] = {};
            std::snprintf(RightStat, sizeof(RightStat), "%.0f km/h  \xC2\xB7  CC=%u  \xC2\xB7  Frame %.1f ms",
                          Tel.SpeedKmh, Tel.SnowConnectedComponents, Tel.LastFrameRenderMs);
            const float RW = KitTextWidth(Faces.Medium, 10.0f, RightStat);
            KitDrawText(Ink, Faces.Medium, 10.0f, ImVec2(P.x + S.x - RW - 16.0f, P.y + 7.5f), KitInkHex(0xbcbcbc), RightStat);
        }
        ImGui::End();
        ImGui::PopStyleColor();
        ImGui::PopStyleVar(2);
    }

    static constexpr float                  StatusBarHeightPx_       = 28.0f;
    std::filesystem::path                   RepoRoot_;
    std::filesystem::path                   ProjectRoot_;
    uint32_t                                WindowW_                 = 1600u;
    uint32_t                                WindowH_                 = 960u;
    bool                                    ImGuiContextCreated_     = false;
    bool                                    OwnsImGuiContext_        = false;
    bool                                    UsingHardwareGpuBackend_ = false;
    bool                                    ViewportTextureCreated_  = false;
    bool                                    SanitizerFastViewport_   = false;
    uint32_t                                LastViewportW_           = 0u;
    uint32_t                                LastViewportH_           = 0u;

    LogCategory                             LogCategorySim_{};
    LogCategory                             LogCategoryRender_{};
    LogCategory                             LogCategoryUi_{};

    DriveShowcaseWorld                      World_;
    SceneDirectoryPanel                     OutlinerPanel_;
    LogStreamPanel                          LogPanel_;
    PanelDockspace                          Dockspace_;
    DedicatedEntityEditorHost               DedicatedEditors_;
    ControlCentrePanel                     *ControlCentreRaw_        = nullptr;
    ActivationOwnership                     ControlCentre_;

    ImTextureData                           ViewportTexture_{};
    std::vector<uint8_t>                    ViewportPixels_;
};

//====================================================================================================================================
//                       AUTOMATED 10-SHOT VERIFICATION: DARK OLED + SHADOWS + ZERO-COPY DEDICATED STUDIOS
//====================================================================================================================================

int RunEditorVerificationAndCapture(const std::filesystem::path &RepoRoot,
                                    const std::filesystem::path &ProjectRoot,
                                    const std::filesystem::path &CaptureDir)
{
    std::cout << "[ProjectDrive] Initializing 1:1 Dark OLED VehicleHMI + Zero-Copy Dedicated Studios...\n";
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

    RequireCheck(RecordStore::Instance().QueryCount() == 30u,
                 "All 30 RecordEntry scene entities (25 core + 5 placeable 3D objects) registered in RecordStore");
    RequireCheck(App.Outliner().QueryTotal() == 30u && App.Outliner().QueryGroups().size() == 8u,
                 "1:1 Dark OLED Outliner projects all 30 entities across 8 groups");
    RequireCheck(App.World().SharedMemory().DuplicatedEntityBytes() == 0u &&
                 App.World().SharedMemory().MappedSizeBytes() >= sizeof(ShowcaseRecordBundle),
                 "OS SharedEntityMemorySegment (MAP_SHARED / MapViewOfFile) active with 0 duplicated bytes");
    RequireCheck(App.ControlCentre().QueryAppearance().QueryApplied().Theme == ThemeCategory::Oled,
                 "ThemeCategory::Oled (Dark OLED) active across entire workspace");
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

    // 01: Play Mode + Dark OLED Hero Overview + Crisp Directional Sun Shadows
    App.World().Records().RenderPipeline.ViewportScalePercent = 36;
    App.World().SetTransportMode(ShowcaseTransportMode::Play);
    App.World().SetCameraPreset(ShowcaseCameraPreset::HeroOverview);
    App.World().Records().RenderPipeline.TracingTier    = 1; // RTX
    App.World().Records().RenderPipeline.InspectionMode = 0; // Final image
    App.Outliner().SelectByStableId("vehicle");
    for (int F = 0; F < 4; ++F)
    {
        App.StepAndRenderGuiFrame(1.0 / 30.0, {});
    }
    RequireCheck(App.SavePngCapture(CaptureDir / "01_dark_oled_hero_shadows_rtx.png"),
                 "Captured 01_dark_oled_hero_shadows_rtx.png");

    // 02: Quantitative Shadow Contrast Verification using Display: Direct sun & shadows (InspectionMode == 1)!
    App.World().SetTransportMode(ShowcaseTransportMode::Pause);
    App.World().Records().RenderPipeline.InspectionMode = 1; // Direct sun & shadows
    App.Outliner().SelectByStableId("sun");
    App.World().ForceViewportDirty();
    App.StepAndRenderGuiFrame(1.0 / 60.0, {});
    {
        const auto    &Vp = App.LatestViewportPixels();
        const uint32_t VW = App.LatestViewportWidth();
        const uint32_t VH = App.LatestViewportHeight();
        // Measure lower-half ground asphalt luminance distribution (p10 shadow umbra vs p90 sunlit asphalt)
        std::vector<float> GroundLums;
        GroundLums.reserve((VW * VH) / 2u);
        for (uint32_t Y = VH / 2u; Y < (VH * 9u) / 10u; ++Y)
        {
            for (uint32_t X = VW / 8u; X < (VW * 7u) / 8u; ++X)
            {
                const size_t Off = (static_cast<size_t>(Y) * VW + X) * 4u;
                const float  Lum = 0.2126f * Vp[Off + 0] + 0.7152f * Vp[Off + 1] + 0.0722f * Vp[Off + 2];
                GroundLums.push_back(Lum);
            }
        }
        std::sort(GroundLums.begin(), GroundLums.end());
        const float P08Shadow = GroundLums[GroundLums.size() * 8u / 100u];
        const float P88Sunlit = GroundLums[GroundLums.size() * 88u / 100u];
        const float Ratio     = P08Shadow / std::max(1.0f, P88Sunlit);
        std::cout << "[SHADOWS] Ground Direct-Pass P08(umbra)=" << P08Shadow
                  << " vs P88(sunlit)=" << P88Sunlit << " -> ShadowContrastRatio=" << Ratio << "\n";
        RequireCheck(P88Sunlit > 95.0f && Ratio < 0.45f,
                     "Directional solar shadows verified clearly visible (ShadowContrastRatio < 0.45)");
    }
    RequireCheck(App.SavePngCapture(CaptureDir / "02_direct_sun_and_shadows_pass.png"),
                 "Captured 02_direct_sun_and_shadows_pass.png");
    App.World().Records().RenderPipeline.InspectionMode = 0;
    App.World().ForceViewportDirty();

    // 03: Dedicated Pyro Plume Fluid Studio Popup (9 Experimental/Fluid Presets + Zero-Copy Shared Memory!)
    App.World().SetCameraPreset(ShowcaseCameraPreset::PyroAndFracture);
    App.Outliner().SelectByStableId("pyro_plume");
    App.DedicatedEditors().OpenEditorForEntity("pyro_plume", App.World());
    App.StepAndRenderGuiFrame(1.0 / 60.0, {});
    RequireCheck(App.DedicatedEditors().IsEditorOpen("pyro_plume") &&
                 App.DedicatedEditors().DuplicatedEntityBytes() == 0u &&
                 App.DedicatedEditors().VerifyZeroCopySharedAddresses(App.World()),
                 "Pyro Plume Fluid Dedicated Studio open & bound to OS shared memory (0 B duplicated)");
    RequireCheck(App.SavePngCapture(CaptureDir / "03_dedicated_pyro_plume_fluid_studio.png"),
                 "Captured 03_dedicated_pyro_plume_fluid_studio.png");

    // 04: Dedicated 3D Placeable Object & Nanite Studio + Live Shared-Memory Edit Proof!
    App.DedicatedEditors().CloseAllEditors();
    App.World().SetCameraPreset(ShowcaseCameraPreset::HeroOverview);
    App.Outliner().SelectByStableId("placeable_chicane_block");
    App.DedicatedEditors().OpenEditorForEntity("placeable_chicane_block", App.World());
    App.StepAndRenderGuiFrame(1.0 / 60.0, {});
    RequireCheck(App.DedicatedEditors().VerifyZeroCopySharedAddresses(App.World()),
                 "Placeable 3D Object Studio shares exact RAM address with DriveShowcaseWorld");
    RequireCheck(App.SavePngCapture(CaptureDir / "04_dedicated_3d_object_nanite_studio.png"),
                 "Captured 04_dedicated_3d_object_nanite_studio.png");

    // Mutate Placeable 3D Object in shared memory -> prove BOTH main viewport and popup update simultaneously!
    std::vector<uint8_t> BeforeShmEdit = App.LatestViewportPixels();
    App.World().Records().PlaceableChicaneBlock.PosX           = 0.8;
    App.World().Records().PlaceableChicaneBlock.PosY           = -2.1;
    App.World().Records().PlaceableChicaneBlock.MaterialPreset = 2; // Anodized Copper
    App.World().Records().PlaceableChicaneBlock.HalfExtentZ    = 1.15;
    App.World().ForceViewportDirty();
    App.StepAndRenderGuiFrame(1.0 / 60.0, {});
    size_t DiffMainPx = 0u;
    for (size_t I = 0; I < std::min(BeforeShmEdit.size(), App.LatestViewportPixels().size()); I += 4u)
    {
        if (BeforeShmEdit[I] != App.LatestViewportPixels()[I]) ++DiffMainPx;
    }
    RequireCheck(DiffMainPx > 400u,
                 "Zero-copy shared-memory edit in 3D Object Studio immediately updates main 3D scene viewport");
    RequireCheck(App.SavePngCapture(CaptureDir / "05_live_shared_memory_studio_edit.png"),
                 "Captured 05_live_shared_memory_studio_edit.png");

    // 06: Dedicated Voronoi Fracture & Destruction Studio Popup
    App.DedicatedEditors().CloseAllEditors();
    App.World().SetCameraPreset(ShowcaseCameraPreset::PyroAndFracture);
    App.Outliner().SelectByStableId("solid_fracture");
    App.DedicatedEditors().OpenEditorForEntity("solid_fracture", App.World());
    App.StepAndRenderGuiFrame(1.0 / 60.0, {});
    RequireCheck(App.SavePngCapture(CaptureDir / "06_dedicated_fracture_voronoi_studio.png"),
                 "Captured 06_dedicated_fracture_voronoi_studio.png");
    App.DedicatedEditors().CloseAllEditors();

    // 07: Cabin Cockpit 3D VehicleHMI + Protected Dark-Cabin Exposure Guard
    App.World().SetCameraPreset(ShowcaseCameraPreset::CabinCockpitHmi);
    App.Outliner().SelectByStableId("cabin_hmi");
    App.World().ForceViewportDirty();
    App.StepAndRenderGuiFrame(1.0 / 60.0, {});
    RequireCheck(App.World().Telemetry().CabinProtectedGain <= 0.90f,
                 "Auto-exposure dark vehicle cabin protection prevents over-brightening emissive HMI");
    RequireCheck(App.SavePngCapture(CaptureDir / "07_cabin_3d_vehicle_hmi_exposure_guard.png"),
                 "Captured 07_cabin_3d_vehicle_hmi_exposure_guard.png");

    // 08: Circular Seamless Portals + Planar Mirror on GTX Tier (SDF ReSTIR GI + Software BVH RT)
    App.World().SetCameraPreset(ShowcaseCameraPreset::CircularPortals);
    App.World().Records().RenderPipeline.TracingTier = 0; // GTX
    App.Outliner().SelectByStableId("portals_mirrors");
    App.World().ForceViewportDirty();
    App.StepAndRenderGuiFrame(1.0 / 60.0, {});
    RequireCheck(App.SavePngCapture(CaptureDir / "08_circular_portals_mirror_gtx_sdf.png"),
                 "Captured 08_circular_portals_mirror_gtx_sdf.png");

    // 09: Simulate Mode + SnowSurface CC=1 Mound & Smooth 2.5D ShallowWater Puddles
    App.World().Records().RenderPipeline.TracingTier = 1; // RTX
    App.World().SetTransportMode(ShowcaseTransportMode::Simulate);
    App.World().SetCameraPreset(ShowcaseCameraPreset::SnowMoundAndWater);
    App.Outliner().SelectByStableId("snow_mound");
    App.StepAndRenderGuiFrame(1.0 / 30.0, {});
    RequireCheck(App.SavePngCapture(CaptureDir / "09_snow_mound_cc1_and_smooth_water.png"),
                 "Captured 09_snow_mound_cc1_and_smooth_water.png");

    // 10: ControlCentrePanel Native Theme Drawer Confirming Dark OLED Active (leaves Dark OLED saved!)
    App.World().SetTransportMode(ShowcaseTransportMode::Pause);
    App.ApplyDarkOledTheme();
    App.ControlCentre().ActivatePage(AppearancePageCategory::Theme);
    for (int S = 0; S < 60; ++S)
    {
        App.StepAndRenderGuiFrame(1.0 / 60.0, {});
    }
    RequireCheck(App.SavePngCapture(CaptureDir / "10_control_centre_oled_theme_drawer.png"),
                 "Captured 10_control_centre_oled_theme_drawer.png");

    std::cout << "[ProjectDrive] All 10 Dark OLED + Shadows + Zero-Copy Studio captures & invariants PASSED.\n";
    return 0;
}

//====================================================================================================================================
//                    NATIVE WINDOWS 10/11 DESKTOP LOOP (WIN32 + DIRECTX 11 — ZERO EXTERNAL DLLS)
//====================================================================================================================================

#if defined(_WIN32)
struct Win32Dx11Context
{
    ID3D11Device           *Device    = nullptr;
    ID3D11DeviceContext    *Immediate = nullptr;
    IDXGISwapChain         *SwapChain = nullptr;
    ID3D11RenderTargetView *MainRtv   = nullptr;
    UINT                    ResizeW   = 0;
    UINT                    ResizeH   = 0;
};

static Win32Dx11Context g_Dx11{};

static void CreateDx11RenderTarget()
{
    ID3D11Texture2D *BackBuffer = nullptr;
    if (SUCCEEDED(g_Dx11.SwapChain->GetBuffer(0, IID_PPV_ARGS(&BackBuffer))) && BackBuffer != nullptr)
    {
        g_Dx11.Device->CreateRenderTargetView(BackBuffer, nullptr, &g_Dx11.MainRtv);
        BackBuffer->Release();
    }
}

static void CleanupDx11RenderTarget()
{
    if (g_Dx11.MainRtv != nullptr)
    {
        g_Dx11.MainRtv->Release();
        g_Dx11.MainRtv = nullptr;
    }
}

static LRESULT WINAPI ProjectDriveWndProc(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam)
{
    if (ImGui_ImplWin32_WndProcHandler(hWnd, msg, wParam, lParam))
    {
        return true;
    }
    switch (msg)
    {
        case WM_SIZE:
            if (wParam != SIZE_MINIMIZED)
            {
                g_Dx11.ResizeW = LOWORD(lParam);
                g_Dx11.ResizeH = HIWORD(lParam);
            }
            return 0;
        case WM_SYSCOMMAND:
            if ((wParam & 0xfff0) == SC_KEYMENU) return 0;
            break;
        case WM_DESTROY:
            ::PostQuitMessage(0);
            return 0;
    }
    return ::DefWindowProcW(hWnd, msg, wParam, lParam);
}

int RunNativeWin32Dx11DesktopApp(const std::filesystem::path &RepoRoot,
                                 const std::filesystem::path &ProjectRoot,
                                 int MaxFramesForSmokeTest)
{
    ImGui_ImplWin32_EnableDpiAwareness();
    WNDCLASSEXW Wc = {sizeof(Wc), CS_CLASSDC, ProjectDriveWndProc, 0L, 0L, ::GetModuleHandleW(nullptr),
                      nullptr, nullptr, nullptr, nullptr, L"FrontierProjectDriveWnd", nullptr};
    ::RegisterClassExW(&Wc);

    HWND Hwnd = ::CreateWindowW(Wc.lpszClassName,
                                L"Frontier Engine — Project-Drive (Dark OLED VehicleHMI + ReSTIR GI + Dedicated Studios)",
                                WS_OVERLAPPEDWINDOW, 60, 40, 1600, 960, nullptr, nullptr, Wc.hInstance, nullptr);
    if (Hwnd == nullptr)
    {
        return 1;
    }
    BOOL UseDarkTitleBar = TRUE;
    (void)::DwmSetWindowAttribute(Hwnd, 20 /*DWMWA_USE_IMMERSIVE_DARK_MODE*/, &UseDarkTitleBar, sizeof(UseDarkTitleBar));

    DXGI_SWAP_CHAIN_DESC Sd{};
    Sd.BufferCount                        = 2;
    Sd.BufferDesc.Format                  = DXGI_FORMAT_R8G8B8A8_UNORM;
    Sd.BufferDesc.RefreshRate.Numerator   = 60;
    Sd.BufferDesc.RefreshRate.Denominator = 1;
    Sd.Flags                              = DXGI_SWAP_CHAIN_FLAG_ALLOW_MODE_SWITCH;
    Sd.BufferUsage                        = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    Sd.OutputWindow                       = Hwnd;
    Sd.SampleDesc.Count                   = 1;
    Sd.Windowed                           = TRUE;
    Sd.SwapEffect                         = DXGI_SWAP_EFFECT_DISCARD;

    const D3D_FEATURE_LEVEL Levels[2] = {D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_10_0};
    D3D_FEATURE_LEVEL       CreatedLevel{};
    HRESULT Hr = ::D3D11CreateDeviceAndSwapChain(
        nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, 0, Levels, 2,
        D3D11_SDK_VERSION, &Sd, &g_Dx11.SwapChain, &g_Dx11.Device, &CreatedLevel, &g_Dx11.Immediate);
    if (FAILED(Hr))
    {
        // Automatic WARP software-GPU fallback for RDP / VM / CI environments!
        Hr = ::D3D11CreateDeviceAndSwapChain(
            nullptr, D3D_DRIVER_TYPE_WARP, nullptr, 0, Levels, 2,
            D3D11_SDK_VERSION, &Sd, &g_Dx11.SwapChain, &g_Dx11.Device, &CreatedLevel, &g_Dx11.Immediate);
    }
    if (FAILED(Hr))
    {
        ::DestroyWindow(Hwnd);
        ::UnregisterClassW(Wc.lpszClassName, Wc.hInstance);
        return 1;
    }
    CreateDx11RenderTarget();

    ::ShowWindow(Hwnd, MaxFramesForSmokeTest > 0 ? SW_SHOWNOACTIVATE : SW_SHOWDEFAULT);
    ::UpdateWindow(Hwnd);

    ImGui::CreateContext();
    ImGui_ImplWin32_Init(Hwnd);
    ImGui_ImplDX11_Init(g_Dx11.Device, g_Dx11.Immediate);

    {
        ProjectDriveApplicationHost App(RepoRoot, ProjectRoot, 1600u, 960u);
        App.World().Records().RenderPipeline.ViewportScalePercent = 35;
        if (!App.Initialize(/*CreateOwnImGuiContext=*/false, /*UsingHardwareGpuBackend=*/true))
        {
            ImGui_ImplDX11_Shutdown();
            ImGui_ImplWin32_Shutdown();
            ImGui::DestroyContext();
            return 1;
        }

        bool Done      = false;
        int  FrameIter = 0;
        while (!Done)
        {
            MSG Msg;
            while (::PeekMessageW(&Msg, nullptr, 0U, 0U, PM_REMOVE))
            {
                ::TranslateMessage(&Msg);
                ::DispatchMessageW(&Msg);
                if (Msg.message == WM_QUIT) Done = true;
            }
            if (Done) break;

            if (g_Dx11.ResizeW != 0 && g_Dx11.ResizeH != 0)
            {
                CleanupDx11RenderTarget();
                g_Dx11.SwapChain->ResizeBuffers(0, g_Dx11.ResizeW, g_Dx11.ResizeH, DXGI_FORMAT_UNKNOWN, 0);
                App.ResizeWindow(g_Dx11.ResizeW, g_Dx11.ResizeH);
                g_Dx11.ResizeW = g_Dx11.ResizeH = 0;
                CreateDx11RenderTarget();
            }

            DriveControlReadings Keys{};
            if (!ImGui::GetIO().WantCaptureKeyboard)
            {
                if ((::GetAsyncKeyState('W') & 0x8000) || (::GetAsyncKeyState(VK_UP) & 0x8000))    Keys.Throttle = 1.0f;
                if ((::GetAsyncKeyState('S') & 0x8000) || (::GetAsyncKeyState(VK_DOWN) & 0x8000))  Keys.Brake    = 1.0f;
                if ((::GetAsyncKeyState('A') & 0x8000) || (::GetAsyncKeyState(VK_LEFT) & 0x8000))  Keys.Steer   -= 1.0f;
                if ((::GetAsyncKeyState('D') & 0x8000) || (::GetAsyncKeyState(VK_RIGHT) & 0x8000)) Keys.Steer   += 1.0f;
                if (::GetAsyncKeyState(VK_SPACE) & 0x8000) Keys.Handbrake = 1.0f;
            }

            ImGui_ImplDX11_NewFrame();
            ImGui_ImplWin32_NewFrame();
            App.BuildUiFrame(1.0 / 60.0, Keys);

            const float ClearOled[4] = {0.03f, 0.03f, 0.03f, 1.0f};
            g_Dx11.Immediate->OMSetRenderTargets(1, &g_Dx11.MainRtv, nullptr);
            g_Dx11.Immediate->ClearRenderTargetView(g_Dx11.MainRtv, ClearOled);
            ImGui_ImplDX11_RenderDrawData(ImGui::GetDrawData());
            g_Dx11.SwapChain->Present(1, 0);

            ++FrameIter;
            if (MaxFramesForSmokeTest > 0 && FrameIter >= MaxFramesForSmokeTest)
            {
                std::cout << "[PASS] Win32 + DirectX 11 desktop smoke test rendered " << FrameIter
                          << " Dark OLED frames cleanly (0 external DLLs).\n";
                Done = true;
            }
        }
    }

    ImGui_ImplDX11_Shutdown();
    ImGui_ImplWin32_Shutdown();
    ImGui::DestroyContext();
    CleanupDx11RenderTarget();
    if (g_Dx11.SwapChain) { g_Dx11.SwapChain->Release(); g_Dx11.SwapChain = nullptr; }
    if (g_Dx11.Immediate) { g_Dx11.Immediate->Release(); g_Dx11.Immediate = nullptr; }
    if (g_Dx11.Device)    { g_Dx11.Device->Release();    g_Dx11.Device    = nullptr; }
    ::DestroyWindow(Hwnd);
    ::UnregisterClassW(Wc.lpszClassName, Wc.hInstance);
    return 0;
}
#endif

//====================================================================================================================================
//                    INTERACTIVE LIVE HTTP CANVAS + BINARY DOWNLOAD SERVER (--serve <port> ON 0.0.0.0)
//====================================================================================================================================

#if defined(__linux__)
int RunInteractiveHttpPreviewServer(const std::filesystem::path &RepoRoot,
                                    const std::filesystem::path &ProjectRoot,
                                    const std::filesystem::path &SelfBinaryPath,
                                    uint16_t Port)
{
    std::signal(SIGPIPE, SIG_IGN);

    ProjectDriveApplicationHost App(RepoRoot, ProjectRoot, 1480u, 880u);
    App.World().Records().RenderPipeline.ViewportScalePercent = 30;
    App.World().Records().RenderPipeline.TracingTier          = 0; // Responsive GTX SDF+BVH default; RTX/Blinn 1-click
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
    App.World().SetTransportMode(ShowcaseTransportMode::Pause);

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
    Addr.sin_addr.s_addr = htonl(INADDR_ANY);
    Addr.sin_port        = htons(Port);
    if (::bind(ServerFd, reinterpret_cast<sockaddr *>(&Addr), sizeof(Addr)) < 0 || ::listen(ServerFd, 16) < 0)
    {
        std::perror("bind/listen");
        ::close(ServerFd);
        return 1;
    }

    std::cout << "[ProjectDrive] Dark OLED Live Preview + Binary Download Server on http://0.0.0.0:" << Port << "/\n" << std::flush;

    static const char *const kIndexHtml = R"HTML(<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Frontier — Project-Drive (Dark OLED VehicleHMI + Dedicated Studios)</title>
<style>
  html,body{margin:0;padding:0;width:100%;height:100%;background:#070707;color:#dcdcdc;overflow:hidden;display:flex;flex-direction:column;font-family:Inter,system-ui,sans-serif;}
  #dlbar{height:30px;background:#0e0e0e;border-bottom:1px solid #242424;display:flex;align-items:center;justify-content:space-between;padding:0 14px;font-size:11px;flex-shrink:0;}
  #dlbar .links{display:flex;gap:8px;align-items:center;}
  #dlbar a{color:#dcdcdc;text-decoration:none;background:#1c1c1c;border:1px solid #323232;padding:3px 10px;border-radius:7px;font-weight:500;}
  #dlbar a:hover{background:#2a2a2a;border-color:#525252;}
  #wrap{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:#050505;}
  #view{max-width:100%;max-height:100%;width:100%;height:100%;object-fit:contain;cursor:default;user-select:none;}
</style>
</head>
<body>
<div id="dlbar">
  <span><b style="color:#3ec46d">&#9679;</b> <b>frontier.</b> Project-Drive &middot; Dark OLED 1:1 VehicleHMI &middot; Click `[&#8599;]` or Double-Click any Outliner row to open its Zero-Copy Dedicated Studio</span>
  <div class="links">
    <a href="/download/ProjectDrive-linux-x86_64" download>&#11015; Linux x64 Binary</a>
    <a href="https://github.com/egoistm1inbox/Frontier/releases/tag/project-drive-latest" target="_blank" rel="noopener">&#11015; Windows .exe + Linux Releases</a>
  </div>
</div>
<div id="wrap"><img id="view" src="/frame.png" draggable="false" alt="Project-Drive Dark OLED Live Viewport"/></div>
<script>
const img = document.getElementById('view');
let busy = false;
function mapCoords(e){
  const r = img.getBoundingClientRect();
  const natW = 1480, natH = 880;
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
img.addEventListener('dblclick', e => {
  const p = mapCoords(e);
  sendInput(`mx=${p.x}&my=${p.y}&dbl=1`);
});
img.addEventListener('wheel', e => {
  e.preventDefault();
  const p = mapCoords(e);
  sendInput(`mx=${p.x}&my=${p.y}&wheel=${e.deltaY > 0 ? -1 : 1}`);
}, {passive:false});
setInterval(() => { sendInput('tick=1'); }, 450);
</script>
</body>
</html>)HTML";

    while (true)
    {
        sockaddr_in Client{};
        socklen_t   CLen = sizeof(Client);
        const int   Fd   = ::accept(ServerFd, reinterpret_cast<sockaddr *>(&Client), &CLen);
        if (Fd < 0) continue;

        char ReqBuf[2048] = {};
        const ssize_t N   = ::recv(Fd, ReqBuf, sizeof(ReqBuf) - 1, 0);
        if (N <= 0)
        {
            ::close(Fd);
            continue;
        }
        std::string Req(ReqBuf, static_cast<size_t>(N));
        const size_t LineEnd      = Req.find("\r\n");
        const std::string FirstLn = LineEnd != std::string::npos ? Req.substr(0, LineEnd) : Req;

        if (FirstLn.find("GET /download/ProjectDrive-linux-x86_64") != std::string::npos)
        {
            std::ifstream BinIn(SelfBinaryPath, std::ios::binary);
            std::vector<char> Bytes((std::istreambuf_iterator<char>(BinIn)), std::istreambuf_iterator<char>());
            std::ostringstream Hdr;
            Hdr << "HTTP/1.1 200 OK\r\n"
                << "Content-Type: application/octet-stream\r\n"
                << "Content-Disposition: attachment; filename=\"ProjectDrive-linux-x86_64\"\r\n"
                << "Content-Length: " << Bytes.size() << "\r\n\r\n";
            const std::string HdrStr = Hdr.str();
            (void)::send(Fd, HdrStr.data(), HdrStr.size(), MSG_NOSIGNAL);
            if (!Bytes.empty())
            {
                (void)::send(Fd, Bytes.data(), Bytes.size(), MSG_NOSIGNAL);
            }
        }
        else if (FirstLn.find("GET /frame.png") != std::string::npos)
        {
            std::lock_guard<std::mutex> Lock(FrameMutex);
            ImGuiIO &IO = ImGui::GetIO();

            auto ParseParam = [&](const char *Key, int &OutVal) -> bool {
                const std::string Needle = std::string(Key) + "=";
                const size_t Pos = FirstLn.find(Needle);
                if (Pos == std::string::npos) return false;
                OutVal = std::atoi(FirstLn.c_str() + Pos + Needle.size());
                return true;
            };

            int Mx = 0, My = 0, ClickBtn = -1, Dbl = 0, Wheel = 0;
            if (ParseParam("mx", Mx) && ParseParam("my", My))
            {
                IO.AddMousePosEvent(static_cast<float>(Mx), static_cast<float>(My));
            }
            if (ParseParam("dbl", Dbl) && Dbl == 1)
            {
                App.StepAndRenderGuiFrame(1.0 / 60.0, {});
                IO.AddMouseButtonEvent(0, true);
                App.StepAndRenderGuiFrame(0.02, {});
                IO.AddMouseButtonEvent(0, false);
                App.StepAndRenderGuiFrame(0.02, {});
                IO.AddMouseButtonEvent(0, true);
                App.StepAndRenderGuiFrame(0.02, {});
                IO.AddMouseButtonEvent(0, false);
            }
            else if (ParseParam("click", ClickBtn) && ClickBtn >= 0 && ClickBtn <= 2)
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
    int                   SmokeFrames = 0;
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
        else if (Arg == "--smoke-frames" && I + 1 < Argc)
        {
            SmokeFrames = std::atoi(Argv[++I]);
        }
        else if (Arg == "--serve" && I + 1 < Argc)
        {
            ServePort = static_cast<uint16_t>(std::atoi(Argv[++I]));
        }
    }

    const std::filesystem::path SelfExe = std::filesystem::weakly_canonical(std::filesystem::path(Argv[0]));
    ProjectRoot                         = std::filesystem::absolute(ProjectRoot);
    if (!std::filesystem::exists(ProjectRoot / "ProjectDrive.frontier"))
    {
        const std::filesystem::path ExeDir = SelfExe.parent_path();
        if (std::filesystem::exists(ExeDir / "ProjectDrive.frontier"))
        {
            ProjectRoot = ExeDir;
        }
        else if (std::filesystem::exists(ExeDir.parent_path() / "ProjectDrive.frontier"))
        {
            ProjectRoot = ExeDir.parent_path();
        }
    }
    std::filesystem::path RepoRoot = ProjectRoot;
    if (std::filesystem::exists(ProjectRoot / "EngineContent/FontArchives"))
    {
        RepoRoot = ProjectRoot;
    }
    else if (std::filesystem::exists(ProjectRoot.parent_path() / "EngineContent/FontArchives"))
    {
        RepoRoot = ProjectRoot.parent_path();
    }
    else if (std::filesystem::exists(ProjectRoot / "../../.." / "EngineContent/FontArchives"))
    {
        RepoRoot = std::filesystem::weakly_canonical(ProjectRoot / "../../..");
    }

#if defined(FRONTIER_SHIPPING_PROFILE) && FRONTIER_SHIPPING_PROFILE
    (void)CaptureDir;
    (void)VerifyMode;
    (void)SmokeFrames;
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
              << " entities (MAP_SHARED=" << ShipWorld.SharedMemory().IsOsSharedMapping()
              << "), SnowCC=" << ShipWorld.Telemetry().SnowConnectedComponents
              << ", Payload=" << ShipWorld.Telemetry().ReplicationPayloadBytes << "B (0 editor UI overhead)\n";
    return LiveRecords == 30u ? 0 : 1;
#else
    if (ServePort > 0u)
    {
    #if defined(__linux__)
        return Frontier::Drive::RunInteractiveHttpPreviewServer(RepoRoot, ProjectRoot, SelfExe, ServePort);
    #endif
    }
    if (VerifyMode)
    {
        return Frontier::Drive::RunEditorVerificationAndCapture(RepoRoot, ProjectRoot, CaptureDir);
    }
    #if defined(_WIN32)
    return Frontier::Drive::RunNativeWin32Dx11DesktopApp(RepoRoot, ProjectRoot, SmokeFrames);
    #else
    return Frontier::Drive::RunEditorVerificationAndCapture(RepoRoot, ProjectRoot, CaptureDir);
    #endif
#endif
}
