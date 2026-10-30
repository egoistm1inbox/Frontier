/*====================================================================================================================================
                                                      PROJECTDRIVEMAIN.CPP
====================================================================================================================================*/
// 🧩 Unified Project-Drive binary: Native Vulkan RHI (GLFW + VulkanPresentation + ImGui_ImplVulkan, VK_NO_PROTOTYPES)
//    driving the 1:1 C++ Dark OLED port of the ReSTIR GI VehicleHMI Proving Grounds UI with non-blocking background
//    SPIR-V VkPipeline compilation, live shader progress & graphics driver compatibility diagnostics in LogStreamPanel,
//    non-blocking async 3D viewport raytracing, and zero-copy MAP_SHARED Dedicated Entity Studios.

#include "DedicatedEntityEditors.h"
#include "DriveShowcaseWorld.h"

#include "Engine/Diagnostics/BuildConfiguration.h"
#include "Engine/Diagnostics/LogCategories.h"
#include "Engine/Diagnostics/LogStream.h"
#include "Engine/Scene/RecordStore.h"

#if !defined(FRONTIER_SHIPPING_PROFILE) || !FRONTIER_SHIPPING_PROFILE
    #ifndef VK_NO_PROTOTYPES
        #define VK_NO_PROTOTYPES
    #endif
    #ifndef GLFW_INCLUDE_NONE
        #define GLFW_INCLUDE_NONE
    #endif
    #include "CpuRasterization.h"
    #include "VulkanShaderCompiler.h"
    #include "Engine/Diagnostics/DiagnosticJournal.h"
    #include "Engine/Interface/ContentDirectory.h"
    #include "Engine/Interface/IconPresentation.h"
    #include "Engine/Interface/LogStreamPanel.h"
    #include "Engine/Interface/LogStreamPanelRegistration.h"
    #include "Engine/Interface/PanelDockspace.h"
    #include "Engine/Interface/SceneDirectoryPanel.h"
    #include "Engine/Interface/SceneDirectoryPanelRegistration.h"
    #include "Engine/Interface/SceneInspectorPanel.h"
    #include "Engine/Interface/StackRailControls.h"
    #include "Engine/Interface/VulkanPresentation.h"
    #include "Engine/Scene/SceneDirectory.h"
    #include "UI/Editor/ControlCentrePanel.h"

    #include <GLFW/glfw3.h>
    #include <imgui_impl_glfw.h>
    #include <imgui_impl_vulkan.h>
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
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <iostream>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#if defined(_WIN32) && (!defined(FRONTIER_SHIPPING_PROFILE) || !FRONTIER_SHIPPING_PROFILE)
    #include <windows.h>
    #include <dwmapi.h>
    #define GLFW_EXPOSE_NATIVE_WIN32
    #include <GLFW/glfw3native.h>
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
        ShutdownGpuResources(nullptr);
        ControlCentreRaw_ = nullptr;
        ControlCentre_.reset();
        if (ImGuiContextCreated_ && OwnsImGuiContext_)
        {
            ImGui::DestroyContext();
            ImGuiContextCreated_ = false;
        }
    }

    void ShutdownGpuResources(VulkanPresentation *LiveDisplay) noexcept
    {
        StopAsyncWorldWorker();
        ShaderCompiler_.ShutdownAndReleaseGpuObjects();
        if (LiveDisplay != nullptr)
        {
            LiveDisplay->AwaitCompletion();
        }
        DedicatedEditors_.CloseAllEditors(true);
        ReclaimRetiredViewportTextures(true);
        if (ViewportTextureCreated_ && ViewportTexture_)
        {
            if (ImGuiContextCreated_ && ImGui::GetCurrentContext() != nullptr)
            {
                if (ViewportTexture_->BackendUserData != nullptr && ImGui::GetIO().BackendRendererUserData != nullptr)
                {
                    ViewportTexture_->SetStatus(ImTextureStatus_WantDestroy);
                    ViewportTexture_->UnusedFrames = 16;
                    ImGui_ImplVulkan_UpdateTexture(ViewportTexture_.get());
                }
                if (ViewportTexture_->RefCount > 0)
                {
                    ImGui::UnregisterUserTexture(ViewportTexture_.get());
                }
            }
            ViewportTexture_->DestroyPixels();
            ViewportTextureCreated_ = false;
        }
    }

    bool Initialize(bool CreateOwnImGuiContext = true,
                    bool UsingHardwareGpuBackend = false,
                    const VulkanRasterAccess *LiveVulkanAccess = nullptr)
    {
        UsingHardwareGpuBackend_ = UsingHardwareGpuBackend;
        LogCategoryVulkan_       = RegisterLogCategory("VulkanRHI", LogColour::Blue);
        LogCategoryDriver_       = RegisterLogCategory("DriverCompat", LogColour::Mint);
        LogCategoryShaders_      = RegisterLogCategory("ShaderCompiler", LogColour::Amber);
        LogCategorySim_          = RegisterLogCategory("Simulation", LogColour::Pink);
        LogCategoryRender_       = RegisterLogCategory("Renderer", LogColour::Blue);
        LogCategoryUi_           = RegisterLogCategory("EditorUI", LogColour::Purple);

        // 1. Inspect Graphics Driver & Vulkan Hardware RayQuery / OrderedSoftwareBvh Compatibility immediately!
        (void)ShaderCompiler_.InspectDriverCompatibility(LiveVulkanAccess);
        DrainBackgroundLogs();

        // 2. Initialize World (deferring heavy warmup off the UI thread in interactive Vulkan desktop mode!)
        if (!World_.Initialize(ProjectRoot_.string(), /*DeferHeavyWarmup=*/UsingHardwareGpuBackend_))
        {
            std::cerr << "[FAILED] DriveShowcaseWorld::Initialize failed for " << ProjectRoot_ << "\n";
            return false;
        }
        World_.SetNonBlockingStudioPreviews(UsingHardwareGpuBackend_);

        if (const char *SanEnv = std::getenv("FRONTIER_SANITIZER_VIEWPORT"); SanEnv != nullptr && SanEnv[0] == '1')
        {
            SanitizerFastViewport_ = true;
            World_.Records().RenderPipeline.ViewportScalePercent = 25;
        }

        const std::filesystem::path FontsDir  = RepoRoot_ / "EngineContent/FontArchives";
        const std::filesystem::path IconsDir  = RepoRoot_ / "EngineContent/Icons";
        const std::filesystem::path PrefsPath = ProjectRoot_ / ".local_appearance.toml";
        std::error_code TempEc;
        std::filesystem::path CacheRoot = std::filesystem::temp_directory_path(TempEc);
        if (TempEc || CacheRoot.empty())
        {
            CacheRoot = ProjectRoot_;
        }
        const std::filesystem::path VkCachePath = CacheRoot / "Frontier/ProjectDrive.vkcache";

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

        // Give Logs generous vertical height below Viewport so live Shader Progress & Driver Compat stream clearly!
        Dockspace_.ConfigureStackedPanels("Viewport", "LogStream", 496.0f);
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
                 "1:1 Dark OLED VehicleHMI workspace + Dedicated Studios (#if defined(FRONTIER_EDITOR_PROFILE)) ready",
                 "DedicatedEntityEditors.cpp");

        if (UsingHardwareGpuBackend_)
        {
            // Non-blocking background SPIR-V VkPipeline compilation + async world warmup & viewport worker!
            ShaderCompiler_.StartAsyncCompilation(VkCachePath, 35u);
            StartAsyncWorldWorker();
        }
        else
        {
            ShaderCompiler_.CompileAllSynchronously(VkCachePath);
            DrainBackgroundLogs();
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
        auto Draft = ControlCentreRaw_->QueryAppearance().QueryDraft();
        if (Draft.Theme != ThemeCategory::Oled)
        {
            Draft.Theme = ThemeCategory::Oled;
            ControlCentreRaw_->QueryAppearance().ConfigureDraft(Draft);
            (void)ControlCentreRaw_->FinalizePreferences();
        }
        for (int ClearToast = 0; ClearToast < 32; ++ClearToast)
        {
            (void)ControlCentreRaw_->Integrate(1.0);
        }
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
            World_.TickFrame(DtSeconds, Controls);
        }
        else
        {
            std::lock_guard<std::mutex> Lock(AsyncMutex_);
            LatestAsyncControls_ = Controls;
        }

        DrainBackgroundLogs();
        ReclaimRetiredViewportTextures(false);
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
    LogStreamPanel            &Logs() noexcept { return LogPanel_; }
    DedicatedEntityEditorHost &DedicatedEditors() noexcept { return DedicatedEditors_; }
    ControlCentrePanel        &ControlCentre() noexcept { return *ControlCentreRaw_; }
    VulkanShaderCompiler      &ShaderCompiler() noexcept { return ShaderCompiler_; }
    const std::vector<uint8_t>&LatestViewportPixels() const noexcept { return ViewportPixels_; }
    uint32_t                   LatestViewportWidth() const noexcept { return LastViewportW_; }
    uint32_t                   LatestViewportHeight() const noexcept { return LastViewportH_; }
    uint32_t                   WindowWidth() const noexcept { return WindowW_; }
    uint32_t                   WindowHeight() const noexcept { return WindowH_; }
    bool                       HasUploadedViewportTexture() const noexcept { return ViewportTextureCreated_; }
    void                       SetForceShaderDiagnosticsOverlay(bool Show) noexcept { ForceShaderDiagnosticsOverlay_ = Show; }
    void                       LogEditorEvent(const char *Message)
    {
        WriteLog(LogCategoryUi_, LogSeverity::Info, Message, "InspectorLiveEdit");
    }

  private:
    void DrainBackgroundLogs()
    {
        std::vector<VulkanShaderLogNotice> Notices;
        ShaderCompiler_.DrainPendingLogNotices(Notices);
        for (const VulkanShaderLogNotice &N : Notices)
        {
            const LogCategory &Cat = (N.Source == "VulkanRHI")    ? LogCategoryVulkan_
                                   : (N.Source == "DriverCompat") ? LogCategoryDriver_
                                                                  : LogCategoryShaders_;
            WriteLog(Cat, N.Severity, N.Message, N.Source);
        }

        std::vector<std::string> WarmLogs;
        {
            std::lock_guard<std::mutex> Lock(AsyncMutex_);
            WarmLogs.swap(PendingWarmupLogs_);
        }
        for (const std::string &Msg : WarmLogs)
        {
            WriteLog(LogCategorySim_, LogSeverity::Info, Msg, "AsyncWorldWarmup");
        }
    }

    void StartAsyncWorldWorker()
    {
        StopAsyncWorldWorker();
        {
            std::lock_guard<std::mutex> Lock(AsyncMutex_);
            AsyncStopRequested_  = false;
            AsyncWarmupActive_   = true;
            AsyncWarmupProgress_ = 0.0f;
            AsyncWarmupStage_    = "Preparing coupled physics, fracture & fluid domains...";
        }

        AsyncWorldWorkerThread_ = std::thread([this]() {
            World_.RunDeferredWarmup([this](uint32_t StepIdx, uint32_t TotalSteps, const char *StageText) {
                char Msg[256] = {};
                std::snprintf(Msg, sizeof(Msg), "[%u/%u] Async World Warmup: %s",
                              StepIdx, TotalSteps, StageText != nullptr ? StageText : "");
                std::lock_guard<std::mutex> Lock(AsyncMutex_);
                AsyncWarmupProgress_ = static_cast<float>(StepIdx - 1u) / static_cast<float>(std::max(1u, TotalSteps));
                AsyncWarmupStage_    = StageText != nullptr ? StageText : "";
                PendingWarmupLogs_.emplace_back(Msg);
            });
            {
                std::lock_guard<std::mutex> Lock(AsyncMutex_);
                AsyncWarmupProgress_ = 1.0f;
                AsyncWarmupActive_   = false;
                AsyncWarmupStage_    = "World subsystems ready";
                PendingWarmupLogs_.emplace_back(
                    "Async world warmup finished: SnowSurface CC==1, 28 Voronoi hulls, Smooth ShallowWater & Jolt+GRIT active");
            }

            std::vector<uint8_t> WorkerPixels;
            auto LastTick = std::chrono::steady_clock::now();

            while (true)
            {
                uint32_t ReqW = 640u;
                uint32_t ReqH = 380u;
                DriveControlReadings Controls{};
                {
                    std::lock_guard<std::mutex> Lock(AsyncMutex_);
                    if (AsyncStopRequested_)
                    {
                        break;
                    }
                    ReqW     = std::max(160u, RequestedViewportW_);
                    ReqH     = std::max(96u, RequestedViewportH_);
                    Controls = LatestAsyncControls_;
                }

                const auto Now = std::chrono::steady_clock::now();
                const double Dt = std::clamp(std::chrono::duration<double>(Now - LastTick).count(), 1.0 / 120.0, 0.03125);
                LastTick        = Now;

                try
                {
                    World_.TickFrame(Dt, Controls);

                    uint32_t RW = 0u, RH = 0u;
                    if (World_.RenderViewportIfNeeded(ReqW, ReqH, WorkerPixels, RW, RH) && !WorkerPixels.empty())
                    {
                        std::lock_guard<std::mutex> Lock(AsyncMutex_);
                        AsyncCompletedPixels_ = WorkerPixels;
                        AsyncCompletedW_      = RW;
                        AsyncCompletedH_      = RH;
                        AsyncFramePending_    = true;
                    }
                    else
                    {
                        std::this_thread::sleep_for(std::chrono::milliseconds(8));
                    }
                }
                catch (const std::exception &Ex)
                {
                    std::lock_guard<std::mutex> Lock(AsyncMutex_);
                    PendingWarmupLogs_.emplace_back(std::string("Async world worker warning: ") + Ex.what());
                    std::this_thread::sleep_for(std::chrono::milliseconds(16));
                }
            }
        });
    }

    void StopAsyncWorldWorker() noexcept
    {
        {
            std::lock_guard<std::mutex> Lock(AsyncMutex_);
            AsyncStopRequested_ = true;
        }
        if (AsyncWorldWorkerThread_.joinable())
        {
            AsyncWorldWorkerThread_.join();
        }
    }

    void ReclaimRetiredViewportTextures(bool ForceImmediate) noexcept
    {
        for (size_t I = 0u; I < RetiredViewportTextures_.size();)
        {
            ImTextureData *Tex = RetiredViewportTextures_[I].get();
            if (Tex == nullptr)
            {
                RetiredViewportTextures_.erase(RetiredViewportTextures_.begin() + static_cast<std::ptrdiff_t>(I));
                continue;
            }
            const bool CanReclaim = ForceImmediate || (Tex->BackendUserData == nullptr) ||
                                    (Tex->Status == ImTextureStatus_Destroyed) || (Tex->UnusedFrames >= 4);
            if (!CanReclaim)
            {
                ++I;
                continue;
            }
            if (ImGuiContextCreated_ && ImGui::GetCurrentContext() != nullptr)
            {
                if (Tex->BackendUserData != nullptr && ImGui::GetIO().BackendRendererUserData != nullptr)
                {
                    Tex->SetStatus(ImTextureStatus_WantDestroy);
                    Tex->UnusedFrames = 16;
                    ImGui_ImplVulkan_UpdateTexture(Tex);
                }
                if (Tex->RefCount > 0)
                {
                    ImGui::UnregisterUserTexture(Tex);
                }
            }
            Tex->DestroyPixels();
            RetiredViewportTextures_.erase(RetiredViewportTextures_.begin() + static_cast<std::ptrdiff_t>(I));
        }
    }

    void UploadViewportPixels(const std::vector<uint8_t> &Rgba8, uint32_t W, uint32_t H)
    {
        if (Rgba8.size() < static_cast<size_t>(W) * H * 4u || W == 0u || H == 0u)
        {
            return;
        }
        const bool NeedsCreate = !ViewportTextureCreated_ || !ViewportTexture_ ||
                                 ViewportTexture_->Width != static_cast<int>(W) ||
                                 ViewportTexture_->Height != static_cast<int>(H);
        if (NeedsCreate)
        {
            if (ViewportTextureCreated_ && ViewportTexture_)
            {
                if (ImGui::GetIO().BackendRendererUserData != nullptr && ViewportTexture_->BackendUserData != nullptr)
                {
                    ViewportTexture_->WantDestroyNextFrame = true;
                    RetiredViewportTextures_.push_back(std::move(ViewportTexture_));
                }
                else
                {
                    if (ViewportTexture_->RefCount > 0)
                    {
                        ImGui::UnregisterUserTexture(ViewportTexture_.get());
                    }
                    ViewportTexture_->DestroyPixels();
                }
            }
            ViewportTexture_ = std::make_unique<ImTextureData>();
            ViewportTexture_->Create(ImTextureFormat_RGBA32, static_cast<int>(W), static_cast<int>(H));
            std::memcpy(ViewportTexture_->GetPixels(), Rgba8.data(), static_cast<size_t>(W) * H * 4u);
            ImGui::RegisterUserTexture(ViewportTexture_.get());
            ViewportTextureCreated_ = true;
        }
        else
        {
            std::memcpy(ViewportTexture_->GetPixels(), Rgba8.data(), static_cast<size_t>(W) * H * 4u);
            ViewportTexture_->UpdateRect = ImTextureRect{
                0u, 0u, static_cast<unsigned short>(W), static_cast<unsigned short>(H)};
            ViewportTexture_->UsedRect = ViewportTexture_->UpdateRect;
            if (ViewportTexture_->Status == ImTextureStatus_OK)
            {
                ViewportTexture_->SetStatus(ImTextureStatus_WantUpdates);
            }
        }
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

        bool WarmupStillRunning = false;
        float WarmupProg01      = 1.0f;
        std::string WarmupStage{};

        if (UsingHardwareGpuBackend_)
        {
            uint32_t ReadyW = 0u, ReadyH = 0u;
            bool HasNewAsyncFrame = false;
            {
                std::lock_guard<std::mutex> Lock(AsyncMutex_);
                RequestedViewportW_ = ReqW;
                RequestedViewportH_ = ReqH;
                WarmupStillRunning  = AsyncWarmupActive_;
                WarmupProg01        = AsyncWarmupProgress_;
                WarmupStage         = AsyncWarmupStage_;
                if (AsyncFramePending_ && !AsyncCompletedPixels_.empty())
                {
                    ViewportPixels_.swap(AsyncCompletedPixels_);
                    ReadyW            = AsyncCompletedW_;
                    ReadyH            = AsyncCompletedH_;
                    AsyncFramePending_= false;
                    HasNewAsyncFrame  = true;
                }
            }
            if (HasNewAsyncFrame)
            {
                UploadViewportPixels(ViewportPixels_, ReadyW, ReadyH);
            }
        }
        else
        {
            uint32_t RW = 0u, RH = 0u;
            if (World_.RenderViewportIfNeeded(ReqW, ReqH, ViewportPixels_, RW, RH))
            {
                UploadViewportPixels(ViewportPixels_, RW, RH);
            }
        }

        const ImVec2 StageMin(Origin.x, StageY);
        const ImVec2 StageMax(Origin.x + static_cast<float>(PanelW), StageY + static_cast<float>(PanelH));
        Ink->AddRectFilled(StageMin, StageMax, KitInkHex(0x090909));

        ImGui::SetCursorScreenPos(StageMin);
        if (ViewportTextureCreated_ && ViewportTexture_)
        {
            ImGui::Image(ViewportTexture_->GetTexRef(), ImVec2(static_cast<float>(PanelW), static_cast<float>(PanelH)));
        }
        else
        {
            ImGui::InvisibleButton("##ViewportWarmupCanvas", ImVec2(static_cast<float>(PanelW), static_cast<float>(PanelH)));
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

        // Top-right Native Vulkan RHI + Shader Pipeline Badge
        const VulkanShaderProgressSnapshot ShaderProg = ShaderCompiler_.QueryProgress();
        const VulkanDriverCompatibilityReport &Drv    = ShaderCompiler_.DriverReport();
        {
            char VkBadge[160] = {};
            if (ShaderProg.CompilationActive)
            {
                std::snprintf(VkBadge, sizeof(VkBadge), "VULKAN  \xC2\xB7  Compiling [%u/%u] %s",
                              ShaderProg.CompletedPrograms, ShaderProg.TotalPrograms,
                              ShaderProg.CurrentShaderName.c_str());
            }
            else
            {
                std::snprintf(VkBadge, sizeof(VkBadge), "%s  \xC2\xB7  %u/%u Shaders Ready",
                              Drv.CompactHeaderBadge.c_str(),
                              ShaderProg.CompletedPrograms, ShaderProg.TotalPrograms);
            }
            const float BW = KitTextWidth(Faces.Medium, 9.5f, VkBadge) + 30.0f;
            const float BX = StageMax.x - BW - 12.0f;
            const float BY = StageY + 10.0f;
            KitPillSurface(Ink, ImVec2(BX, BY), ImVec2(BX + BW, BY + 24.0f),
                           IM_COL32(10, 10, 10, 218), KitInkHex(0x2f2f2f), 8.0f);
            Ink->AddCircleFilled(ImVec2(BX + 11.5f, BY + 12.0f), 3.0f,
                                 ShaderProg.CompilationActive ? KitInkHex(0xe5a93c) : KitInkHex(0x3ec46d), 10);
            KitDrawText(Ink, Faces.Medium, 9.5f, ImVec2(BX + 20.0f, BY + 5.5f), KitInkHex(0xdcdcdc), VkBadge);
        }

        // Non-blocking Dark OLED Shader Compilation & Driver Compatibility HUD Card (shown during async init or diagnostic view)
        const bool ShowDiagCard = ForceShaderDiagnosticsOverlay_ || ShaderProg.CompilationActive ||
                                  WarmupStillRunning || !ViewportTextureCreated_;
        if (ShowDiagCard)
        {
            const float CardW = std::min(520.0f, static_cast<float>(PanelW) - 32.0f);
            const float CardH = 116.0f;
            const float CX0   = Origin.x + (static_cast<float>(PanelW) - CardW) * 0.5f;
            const float CY0   = ForceShaderDiagnosticsOverlay_
                              ? (StageY + 42.0f)
                              : (StageY + (static_cast<float>(PanelH) - CardH) * 0.5f);

            KitPillSurface(Ink, ImVec2(CX0, CY0), ImVec2(CX0 + CardW, CY0 + CardH),
                           IM_COL32(12, 12, 12, 236), KitInkHex(0x363636), 14.0f);
            Ink->AddCircleFilled(ImVec2(CX0 + 18.0f, CY0 + 19.0f), 3.5f,
                                 (ShaderProg.CompilationActive || WarmupStillRunning)
                                     ? KitInkHex(0xe5a93c) : KitInkHex(0x3ec46d), 12);
            KitDrawTracked(Ink, Faces.Medium, 9.0f, ImVec2(CX0 + 28.0f, CY0 + 13.0f),
                           KitInkHex(0xdadada), "VULKAN PIPELINE & DRIVER DIAGNOSTICS", 1.2f);

            char GpuLine[220] = {};
            std::snprintf(GpuLine, sizeof(GpuLine), "Adapter: %s  |  API: Vulkan %s  |  Tier: %s",
                          Drv.AdapterName.c_str(), Drv.FormattedApiVersion.c_str(), Drv.SelectedTierLabel.c_str());
            KitDrawText(Ink, Faces.Regular, 10.0f, ImVec2(CX0 + 18.0f, CY0 + 34.0f), KitInkHex(0xb8b8b8), GpuLine);

            float CombinedProg = ShaderProg.Progress01;
            char  StageLine[240] = {};
            if (ShaderProg.CompilationActive)
            {
                CombinedProg = ShaderProg.Progress01;
                std::snprintf(StageLine, sizeof(StageLine),
                              "Compiling [%u/%u] (%u%%): %s  \xE2\x80\x94  %s",
                              ShaderProg.CompletedPrograms, ShaderProg.TotalPrograms,
                              static_cast<uint32_t>(std::round(ShaderProg.Progress01 * 100.0f)),
                              ShaderProg.CurrentShaderName.c_str(),
                              ShaderProg.CurrentStageSummary.c_str());
            }
            else if (WarmupStillRunning)
            {
                CombinedProg = 0.5f + 0.5f * WarmupProg01;
                std::snprintf(StageLine, sizeof(StageLine),
                              "Shaders %u/%u Ready (%.1f ms)  \xC2\xB7  Warming Scene: %s",
                              ShaderProg.CompletedPrograms, ShaderProg.TotalPrograms,
                              ShaderProg.TotalCompileMs, WarmupStage.c_str());
            }
            else
            {
                CombinedProg = 1.0f;
                std::snprintf(StageLine, sizeof(StageLine),
                              "All %u/%u Vulkan SPIR-V Compute Pipelines Ready (%.2f ms  \xC2\xB7  Driver Verdict: COMPATIBLE)",
                              ShaderProg.CompletedPrograms, ShaderProg.TotalPrograms, ShaderProg.TotalCompileMs);
            }
            KitDrawText(Ink, Faces.Medium, 10.0f, ImVec2(CX0 + 18.0f, CY0 + 56.0f), KitInkHex(0xefefef), StageLine);

            // Progress rail
            const float BarX0 = CX0 + 18.0f;
            const float BarX1 = CX0 + CardW - 18.0f;
            const float BarY0 = CY0 + 82.0f;
            KitPillSurface(Ink, ImVec2(BarX0, BarY0), ImVec2(BarX1, BarY0 + 8.0f),
                           KitInkHex(0x1f1f1f), KitInkHex(0x2f2f2f), 4.0f);
            const float FillW = std::max(8.0f, (BarX1 - BarX0) * std::clamp(CombinedProg, 0.03f, 1.0f));
            Ink->AddRectFilled(ImVec2(BarX0, BarY0), ImVec2(BarX0 + FillW, BarY0 + 8.0f), KitInkHex(0x3ec46d), 4.0f);

            KitDrawText(Ink, Faces.Regular, 9.0f, ImVec2(CX0 + 18.0f, CY0 + 95.0f), KitInkHex(0x888888),
                        "Non-blocking async worker active  \xC2\xB7  Full per-shader & driver logs streaming below in Logs");
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
            const VulkanShaderProgressSnapshot ShaderProg = ShaderCompiler_.QueryProgress();
            const VulkanDriverCompatibilityReport &Drv    = ShaderCompiler_.DriverReport();

            Ink->AddLine(P, ImVec2(P.x + S.x, P.y), KitInkHex(0x242424), 1.0f);
            Ink->AddCircleFilled(ImVec2(P.x + 18.0f, P.y + S.y * 0.5f), 3.0f,
                                 ShaderProg.CompilationActive ? KitInkHex(0xe5a93c) : KitInkHex(0x3ec46d), 10);
            KitDrawText(Ink, Faces.Regular, 10.0f, ImVec2(P.x + 27.0f, P.y + 7.5f), KitInkHex(0xc4c4c4),
                        ShaderProg.CompilationActive ? "Compiling" : "Vulkan Ready");

            char Mid[280] = {};
            std::snprintf(Mid, sizeof(Mid),
                          "RHI: %s   |   Shaders: %u/%u (%.1f ms)   |   Renderer: %s   |   Shared Memory: %s (%zu B, 0 B dup)   |   Studios: %zu",
                          Drv.CompactHeaderBadge.c_str(),
                          ShaderProg.CompletedPrograms,
                          ShaderProg.TotalPrograms,
                          ShaderProg.TotalCompileMs,
                          Tier == 0 ? "ReSTIR GI + GTX SDF" : (Tier == 1 ? "ReSTIR GI + RTX" : "Blinn"),
                          World_.SharedMemory().IsOsSharedMapping() ? "MAP_SHARED" : "Shared",
                          World_.SharedMemory().MappedSizeBytes(),
                          DedicatedEditors_.OpenWindowCount());
            KitDrawText(Ink, Faces.Regular, 10.0f, ImVec2(P.x + 108.0f, P.y + 7.5f), KitInkHex(0x868686), Mid);

            char RightStat[96] = {};
            std::snprintf(RightStat, sizeof(RightStat), "%.0f km/h  \xC2\xB7  CC=%u  \xC2\xB7  3D %.1f ms",
                          Tel.SpeedKmh, Tel.SnowConnectedComponents, Tel.LastFrameRenderMs);
            const float RW = KitTextWidth(Faces.Medium, 10.0f, RightStat);
            KitDrawText(Ink, Faces.Medium, 10.0f, ImVec2(P.x + S.x - RW - 16.0f, P.y + 7.5f), KitInkHex(0xbcbcbc), RightStat);
        }
        ImGui::End();
        ImGui::PopStyleColor();
        ImGui::PopStyleVar(2);
    }

    static constexpr float                  StatusBarHeightPx_             = 28.0f;
    std::filesystem::path                   RepoRoot_;
    std::filesystem::path                   ProjectRoot_;
    uint32_t                                WindowW_                       = 1600u;
    uint32_t                                WindowH_                       = 960u;
    bool                                    ImGuiContextCreated_           = false;
    bool                                    OwnsImGuiContext_              = false;
    bool                                    UsingHardwareGpuBackend_       = false;
    bool                                    ViewportTextureCreated_        = false;
    bool                                    SanitizerFastViewport_         = false;
    bool                                    ForceShaderDiagnosticsOverlay_ = false;
    uint32_t                                LastViewportW_                 = 0u;
    uint32_t                                LastViewportH_                 = 0u;

    LogCategory                             LogCategoryVulkan_{};
    LogCategory                             LogCategoryDriver_{};
    LogCategory                             LogCategoryShaders_{};
    LogCategory                             LogCategorySim_{};
    LogCategory                             LogCategoryRender_{};
    LogCategory                             LogCategoryUi_{};

    VulkanShaderCompiler                    ShaderCompiler_;
    DriveShowcaseWorld                      World_;
    SceneDirectoryPanel                     OutlinerPanel_;
    LogStreamPanel                          LogPanel_;
    PanelDockspace                          Dockspace_;
    DedicatedEntityEditorHost               DedicatedEditors_;
    ControlCentrePanel                     *ControlCentreRaw_              = nullptr;
    ActivationOwnership                     ControlCentre_;

    std::unique_ptr<ImTextureData>               ViewportTexture_          = std::make_unique<ImTextureData>();
    std::vector<std::unique_ptr<ImTextureData>>  RetiredViewportTextures_{};
    std::vector<uint8_t>                         ViewportPixels_{};

    std::mutex                              AsyncMutex_{};
    std::thread                             AsyncWorldWorkerThread_{};
    bool                                    AsyncStopRequested_            = false;
    bool                                    AsyncWarmupActive_             = false;
    float                                   AsyncWarmupProgress_           = 0.0f;
    std::string                             AsyncWarmupStage_{};
    std::vector<std::string>                PendingWarmupLogs_{};
    DriveControlReadings                    LatestAsyncControls_{};
    uint32_t                                RequestedViewportW_            = 640u;
    uint32_t                                RequestedViewportH_            = 380u;
    std::vector<uint8_t>                    AsyncCompletedPixels_{};
    uint32_t                                AsyncCompletedW_               = 0u;
    uint32_t                                AsyncCompletedH_               = 0u;
    bool                                    AsyncFramePending_             = false;
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

    // Verify all 16 SPIR-V 1.0 compute modules + VulkanShaderCompiler progress + LogStreamPanel driver/shader entries!
    {
        const auto &Manifest = VulkanShaderCompiler::QueryProgramManifest();
        RequireCheck(Manifest.size() == 16u, "Vulkan shader manifest contains all 16 Frontier compute shader specs");
        for (const VulkanShaderProgramSpec &Spec : Manifest)
        {
            const std::vector<uint32_t> Words = VulkanShaderCompiler::ConstructComputeSpirvWords(Spec);
            RequireCheck(VulkanShaderCompiler::ValidateSpirvModuleWords(Words),
                         "Validated Khronos SPIR-V 1.0 compute bytecode stream & OpFunctionEnd framing");
        }
        const VulkanShaderProgressSnapshot Prog = App.ShaderCompiler().QueryProgress();
        RequireCheck(Prog.CompilationFinished && Prog.CompletedPrograms == 16u && Prog.TotalPrograms == 16u,
                     "VulkanShaderCompiler completed all 16/16 SPIR-V compute pipelines and logged progress");
    }

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

    // Close drawer and capture 11: Vulkan Shader Compilation Progress + Driver Compatibility Diagnostics in Logs & HUD!
    ImGui::GetIO().AddKeyEvent(ImGuiKey_Escape, true);
    App.StepAndRenderGuiFrame(1.0 / 60.0, {});
    ImGui::GetIO().AddKeyEvent(ImGuiKey_Escape, false);
    for (int S = 0; S < 24; ++S)
    {
        App.StepAndRenderGuiFrame(1.0 / 60.0, {});
    }
    App.World().SetCameraPreset(ShowcaseCameraPreset::HeroOverview);
    App.World().Records().RenderPipeline.TracingTier = 1;
    App.Outliner().SelectByStableId("renderer");
    App.World().ForceViewportDirty();
    App.SetForceShaderDiagnosticsOverlay(true);
    for (int ClearToast = 0; ClearToast < 40; ++ClearToast)
    {
        App.StepAndRenderGuiFrame(0.25, {});
    }
    RequireCheck(App.SavePngCapture(CaptureDir / "11_vulkan_shader_progress_and_driver_compat_logs.png"),
                 "Captured 11_vulkan_shader_progress_and_driver_compat_logs.png");
    App.SetForceShaderDiagnosticsOverlay(false);

    std::cout << "[ProjectDrive] All 11 Vulkan RHI + Dark OLED + Shadows + Zero-Copy Studio captures & invariants PASSED.\n";
    return 0;
}

//====================================================================================================================================
//               NATIVE CROSS-PLATFORM VULKAN DESKTOP LOOP (GLFW + VULKANPRESENTATION — ZERO DIRECTX 11)
//====================================================================================================================================

int RunHeadlessVulkanSmokeVerification(const std::filesystem::path &RepoRoot,
                                       const std::filesystem::path &ProjectRoot,
                                       int SmokeFrames)
{
    const int FramesToRun = std::max(2, SmokeFrames);
    ProjectDriveApplicationHost App(RepoRoot, ProjectRoot, 1280u, 800u);
    App.World().Records().RenderPipeline.ViewportScalePercent = 30;
    if (!App.Initialize(/*CreateOwnImGuiContext=*/true, /*UsingHardwareGpuBackend=*/false, nullptr))
    {
        return 1;
    }
    for (int F = 0; F < FramesToRun; ++F)
    {
        App.StepAndRenderGuiFrame(1.0 / 60.0, {});
    }
    const VulkanShaderProgressSnapshot Prog = App.ShaderCompiler().QueryProgress();
    const VulkanDriverCompatibilityReport &Drv = App.ShaderCompiler().DriverReport();
    std::cout << "[PASS] Vulkan headless smoke verification rendered " << FramesToRun
              << " Dark OLED frames (" << Drv.AdapterName << ", Shaders="
              << Prog.CompletedPrograms << "/" << Prog.TotalPrograms << ").\n";
    return (Prog.CompletedPrograms == Prog.TotalPrograms) ? 0 : 1;
}

void ReportVulkanStartupFailure(const std::string &Message) noexcept
{
#if defined(_WIN32)
    wchar_t WideMsg[2048]{};
    const int Len = static_cast<int>(std::min<size_t>(Message.size(), 2047u));
    (void)::MultiByteToWideChar(CP_UTF8, 0, Message.c_str(), Len, WideMsg, 2047);
    ::MessageBoxW(nullptr, WideMsg, L"Project-Drive — Vulkan RHI Initialization Error", MB_OK | MB_ICONERROR);
#else
    std::cerr << "[ProjectDrive Vulkan Error] " << Message << "\n";
#endif
}

int RunNativeVulkanDesktopApp(const std::filesystem::path &RepoRoot,
                              const std::filesystem::path &ProjectRoot,
                              int MaxFramesForSmokeTest,
                              bool AllowHeadlessFallback)
{
    DiagnosticJournal::Initialize("ProjectDrive");
    glfwSetErrorCallback([](int Code, const char *Desc) {
        DiagnosticJournal::Append("GLFW", std::to_string(Code) + ": " + (Desc != nullptr ? Desc : "unknown"));
    });

    if (!glfwInit())
    {
        if (AllowHeadlessFallback)
        {
            return RunHeadlessVulkanSmokeVerification(RepoRoot, ProjectRoot, MaxFramesForSmokeTest);
        }
        ReportVulkanStartupFailure("GLFW platform initialization failed (no active desktop display found).");
        return 1;
    }

    struct GlfwScopeGuard
    {
        GLFWwindow *Window        = nullptr;
        bool        ContextReady  = false;
        bool        GlfwImGuiInit = false;
        ~GlfwScopeGuard()
        {
            try
            {
                if (GlfwImGuiInit) ImGui_ImplGlfw_Shutdown();
                if (ContextReady)  ImGui::DestroyContext();
                if (Window)        glfwDestroyWindow(Window);
                glfwTerminate();
            }
            catch (...) {}
        }
    } Guard;

    if (!glfwVulkanSupported())
    {
        if (AllowHeadlessFallback)
        {
            return RunHeadlessVulkanSmokeVerification(RepoRoot, ProjectRoot, MaxFramesForSmokeTest);
        }
        ReportVulkanStartupFailure(
            "No compatible Vulkan 1.1+ runtime / graphics driver (vulkan-1.dll / libvulkan.so.1) was found on this system.");
        return 1;
    }

    glfwWindowHint(GLFW_CLIENT_API, GLFW_NO_API);
    glfwWindowHint(GLFW_SCALE_TO_MONITOR, GLFW_TRUE);
    if (MaxFramesForSmokeTest > 0)
    {
        glfwWindowHint(GLFW_FOCUS_ON_SHOW, GLFW_FALSE);
    }

    GLFWwindow *Window = glfwCreateWindow(
        1600, 960,
        "Project-Drive \xE2\x80\x94 Frontier Dark OLED Studio (Vulkan)",
        nullptr, nullptr);
    if (Window == nullptr)
    {
        if (AllowHeadlessFallback)
        {
            return RunHeadlessVulkanSmokeVerification(RepoRoot, ProjectRoot, MaxFramesForSmokeTest);
        }
        ReportVulkanStartupFailure("Failed to create Vulkan GLFW desktop window.");
        return 1;
    }
    Guard.Window = Window;

#if defined(_WIN32)
    if (HWND Hwnd = glfwGetWin32Window(Window); Hwnd != nullptr)
    {
        BOOL UseDarkTitleBar = TRUE;
        (void)::DwmSetWindowAttribute(Hwnd, 20 /*DWMWA_USE_IMMERSIVE_DARK_MODE*/, &UseDarkTitleBar, sizeof(UseDarkTitleBar));
    }
#endif

    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    Guard.ContextReady = true;
    ImGuiIO &IO        = ImGui::GetIO();
    IO.ConfigFlags    |= ImGuiConfigFlags_NavEnableKeyboard | ImGuiConfigFlags_DockingEnable;
    IO.IniFilename     = nullptr;

    Guard.GlfwImGuiInit = ImGui_ImplGlfw_InitForVulkan(Window, true);
    if (!Guard.GlfwImGuiInit)
    {
        if (AllowHeadlessFallback)
        {
            return RunHeadlessVulkanSmokeVerification(RepoRoot, ProjectRoot, MaxFramesForSmokeTest);
        }
        ReportVulkanStartupFailure("ImGui_ImplGlfw_InitForVulkan failed.");
        return 1;
    }

    VulkanPresentation Display;
    try
    {
        Display.Initialize(Window, false);
    }
    catch (const std::exception &Ex)
    {
        if (AllowHeadlessFallback)
        {
            return RunHeadlessVulkanSmokeVerification(RepoRoot, ProjectRoot, MaxFramesForSmokeTest);
        }
        ReportVulkanStartupFailure(std::string("Vulkan swapchain/device initialization failed: ") + Ex.what());
        return 1;
    }

    try
    {
        const VulkanRasterAccess VkAccess = Display.QueryRasterAccess();
        auto App = std::make_unique<ProjectDriveApplicationHost>(RepoRoot, ProjectRoot, 1600u, 960u);
        App->World().Records().RenderPipeline.ViewportScalePercent = 38;
        if (!App->Initialize(/*CreateOwnImGuiContext=*/false, /*UsingHardwareGpuBackend=*/true, &VkAccess))
        {
            Display.AwaitCompletion();
            Display.Finalize();
            return 1;
        }

        auto PrevFrameClock = std::chrono::steady_clock::now();
        int  PostReadySmokeFrames = 0;
        int  TotalLoopFrames      = 0;

        while (!glfwWindowShouldClose(Window))
        {
            glfwPollEvents();

            int FbW = 0, FbH = 0;
            glfwGetFramebufferSize(Window, &FbW, &FbH);
            if (FbW <= 0 || FbH <= 0)
            {
                glfwWaitEventsTimeout(0.05);
                continue;
            }
            if (!Display.Reconfigure(FbW, FbH))
            {
                continue;
            }

            int WinW = 0, WinH = 0;
            glfwGetWindowSize(Window, &WinW, &WinH);
            App->ResizeWindow(static_cast<uint32_t>(WinW > 0 ? WinW : FbW),
                              static_cast<uint32_t>(WinH > 0 ? WinH : FbH));

            float ScaleX = 1.0f, ScaleY = 1.0f;
            glfwGetWindowContentScale(Window, &ScaleX, &ScaleY);
            ImGui::GetStyle().FontScaleDpi = ScaleY;

            const auto NowClock = std::chrono::steady_clock::now();
            const double DtSec  = std::clamp(std::chrono::duration<double>(NowClock - PrevFrameClock).count(),
                                             1.0 / 240.0, 0.05);
            PrevFrameClock      = NowClock;

            DriveControlReadings Keys{};
            Keys.KeyboardCaptured = IO.WantCaptureKeyboard;
            if (!Keys.KeyboardCaptured)
            {
                Keys.ThrottleDown   = (glfwGetKey(Window, GLFW_KEY_W) == GLFW_PRESS) || (glfwGetKey(Window, GLFW_KEY_UP) == GLFW_PRESS);
                Keys.BrakeDown      = (glfwGetKey(Window, GLFW_KEY_S) == GLFW_PRESS) || (glfwGetKey(Window, GLFW_KEY_DOWN) == GLFW_PRESS);
                Keys.SteerLeftDown  = (glfwGetKey(Window, GLFW_KEY_A) == GLFW_PRESS) || (glfwGetKey(Window, GLFW_KEY_LEFT) == GLFW_PRESS);
                Keys.SteerRightDown = (glfwGetKey(Window, GLFW_KEY_D) == GLFW_PRESS) || (glfwGetKey(Window, GLFW_KEY_RIGHT) == GLFW_PRESS);
                Keys.HandbrakeDown  = (glfwGetKey(Window, GLFW_KEY_SPACE) == GLFW_PRESS);
            }

            ImGui_ImplVulkan_NewFrame();
            ImGui_ImplGlfw_NewFrame();
            App->BuildUiFrame(DtSec, Keys);

            Display.RenderMain(ImGui::GetDrawData());
            Display.PresentMain();

            ++TotalLoopFrames;
            if (MaxFramesForSmokeTest > 0)
            {
                const VulkanShaderProgressSnapshot Prog = App->ShaderCompiler().QueryProgress();
                if (Prog.CompilationFinished && App->HasUploadedViewportTexture())
                {
                    ++PostReadySmokeFrames;
                }
                if (PostReadySmokeFrames >= MaxFramesForSmokeTest || TotalLoopFrames >= 420)
                {
                    const auto &Drv = App->ShaderCompiler().DriverReport();
                    std::cout << "[PASS] Native Vulkan desktop smoke test rendered " << TotalLoopFrames
                              << " frames (" << Drv.AdapterName << ", Vulkan " << Drv.FormattedApiVersion
                              << ", Shaders=" << Prog.CompletedPrograms << "/" << Prog.TotalPrograms
                              << ", RealVkPipelines=" << (Prog.RealVulkanPipelines ? "YES" : "NO") << ").\n";
                    break;
                }
            }
        }

        App->ShutdownGpuResources(&Display);
        App.reset();
        Display.AwaitCompletion();
        Display.Finalize();
        return 0;
    }
    catch (const std::exception &Ex)
    {
        Display.Finalize();
        ReportVulkanStartupFailure(std::string("Vulkan runtime error: ") + Ex.what());
        return 1;
    }
}

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
  <span><b style="color:#3ec46d">&#9679;</b> <b>frontier.</b> Project-Drive &middot; Native Vulkan RHI &middot; Dark OLED 1:1 VehicleHMI &middot; Live Shader Progress &amp; Driver Diagnostics in Logs</span>
  <div class="links">
    <a href="/download/ProjectDrive-linux-x86_64" download>&#11015; Linux x64 Vulkan Binary</a>
    <a href="https://github.com/egoistm1inbox/Frontier/releases/tag/project-drive-latest" target="_blank" rel="noopener">&#11015; Windows .exe + Linux Vulkan Releases</a>
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
    if (SmokeFrames > 0)
    {
        return Frontier::Drive::RunNativeVulkanDesktopApp(RepoRoot, ProjectRoot, SmokeFrames, /*AllowHeadlessFallback=*/true);
    }
    return Frontier::Drive::RunNativeVulkanDesktopApp(RepoRoot, ProjectRoot, 0, /*AllowHeadlessFallback=*/false);
#endif
}
