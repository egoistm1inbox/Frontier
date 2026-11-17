/*==========================================================================================================================================
                                                          TEXTUREWORKSPACEHOST.H
==========================================================================================================================================*/
// 🧩 In-process Texture workspace host: Frontier opens a material library folder inside its own window instead of spawning
//    TextureWorkspace.exe. The host owns the reused TextureStudio panels (CPU-only: activation, layout, frame ticks) while an
//    attached TextureWorkspaceBackend feeds them GPU thumbnails/previews through their existing std::function seams.
//
//    Contract:
//      - This header and TextureWorkspaceHost.cpp are PORTABLE (no Vulkan/Win32 types): they compile into FrontierEditorUI on
//        every platform and validate headless with no backend attached (every GPU seam call site in the panels is null-guarded).
//      - The Vulkan backend lives in TextureWorkspaceHostVulkan.{h,cpp}, compiled only into exe targets that link the ImGui
//        Vulkan backend. Frontier constructs it with its presentation-device access and attaches it after Open().
//      - The host never touches UI/TextureStudio/*, Engine/ContentInterchange/*, or Engine/Render/* sources: panels are reused
//        as-is behind their seams, mirroring Experimental/TextureStudio/Native/TextureStudioApplication.cpp.

#pragma once

#include "Engine/Interface/PixelSpace.h"

#include <cstdint>
#include <filesystem>
#include <functional>
#include <memory>
#include <string>

namespace Frontier
{

class ControlCentrePanel;
class MaterialLibraryPanel;
struct CompiledSurfaceMaterial;

// 📝 Personal-projectspace section key for the embedded texture layout. Deliberately distinct from the standalone
//    workspace's "texture_studio_layout": the embedded dock arrangement lives in a different window and must neither
//    inherit nor overwrite it.
inline constexpr const char *TextureWorkspaceLayoutKey = "frontier_texture_layout";

//------------------------------------------------------------------------------------------------------------------------
//                                                  WORKSPACE BACKEND SEAM
//------------------------------------------------------------------------------------------------------------------------
// 📝 Implemented once per renderer (Vulkan today). The host calls Bind() from AttachBackend() and Unbind() from
//    DetachBackend()/Close(); every other method is a frame-path forward. Bind() must leave the panel fully unbound when
//    it throws (AttachBackend reports false and keeps the previous state); Unbind() runs before GPU resources are retired
//    by the caller, waits for the device itself when mid-session teardown needs it, and tolerates repeat calls.

struct TextureWorkspaceBackend
{
    virtual ~TextureWorkspaceBackend() = default;
    virtual void Bind(MaterialLibraryPanel &Library) = 0;
    virtual void Unbind(MaterialLibraryPanel &Library) noexcept = 0;
    virtual void PublishSelection(const std::filesystem::path &Selection, const CompiledSurfaceMaterial &Material) = 0;
    // 📝 Commands carries the native command buffer as an opaque handle (VkCommandBuffer, a pointer type on every platform)
    //    so this header stays Vulkan-free; the backend casts it back.
    virtual void ConstructCommands(void *Commands, uint64_t Completed, uint64_t Serial) = 0;
    virtual void ConfirmSubmission() noexcept = 0;
};

//------------------------------------------------------------------------------------------------------------------------
//                                                     HOST PROBE SNAPSHOT
//------------------------------------------------------------------------------------------------------------------------

struct TextureWorkspaceState
{
    bool        Open          = false; // [-] a library folder is hosted
    bool        BackendBound  = false; // [-] GPU thumbnails/previews are attached
    size_t      EntryCount    = 0;     // [-] catalogue entries in the open folder
    uint64_t    Revision      = 0;     // [-] catalogue revision last observed
    std::string Selection;             // [utf8] selected material, relative to the library folder
    bool        CloseRequested = false;// [-] the workspace asked to return to the browser
};

//------------------------------------------------------------------------------------------------------------------------
//                                                   TEXTURE WORKSPACE HOST
//------------------------------------------------------------------------------------------------------------------------

class TextureWorkspaceHost
{
public:
    TextureWorkspaceHost();
    ~TextureWorkspaceHost();
    TextureWorkspaceHost(const TextureWorkspaceHost &) = delete;
    TextureWorkspaceHost &operator=(const TextureWorkspaceHost &) = delete;

    // 📝 CPU-only open: activates the Material Library panel on Folder. Reopening while open closes first. False carries
    //    the human-readable reason in Refusal (when given) and QueryDiagnostic().
    bool Open(const std::filesystem::path &Folder, std::string *Refusal = nullptr);
    // 📝 Detaches the backend first (Unbind clears the GPU seams and retires GPU resources), then finalizes the panels.
    //    The caller must have retired all GPU work referencing the workspace before this call, exactly like the standalone
    //    application's Finalize callback; Unbind additionally waits for the device so mid-session close is safe.
    void Close() noexcept;
    [[nodiscard]] bool IsOpen() const noexcept;

    // 📝 Idempotent for the same backend; false (previous binding kept) when closed, given null, or already bound to a
    //    different backend. A throwing Bind() also reports false and leaves the panel unbound.
    bool AttachBackend(TextureWorkspaceBackend *Backend) noexcept;
    void DetachBackend() noexcept;
    [[nodiscard]] TextureWorkspaceBackend *QueryBackend() const noexcept;

    // 📝 Per-frame UI tick: ticks the panel, draws it into the current ImGui window, and publishes catalogue selection
    //    revisions to the backend. Safe with no backend (GPU stays unbound, panels still draw).
    void Synchronize();
    // 📝 Record/confirm forwards into the backend's GPU work; no-ops with no backend. Called from the application's own
    //    rendering callbacks, mirroring the standalone frame block.
    void ConstructWorkspaceCommands(void *Commands, uint64_t Completed, uint64_t Serial);
    void ConfirmWorkspaceSubmission() noexcept;

    void ConfigureInterfaceScale(float Scale) noexcept;
    // 📝 Pointer-delta evaluator for preview navigation (frontier binds its ControlCentre input; identity when unset).
    void ConfigureNavigation(std::function<PlanePoint(PlanePoint)> Evaluator);
    // 📝 Control centre link (nullable): feeds per-frame detached-window propagation and layout-reset handling, and
    //    sources the personal projectspace for RestoreLayout()/PersistLayout(). Frontier binds its appearance at open.
    void ConfigureControlCentre(ControlCentrePanel *Centre) noexcept;
    bool SelectMaterial(const std::filesystem::path &RelativePath);
    // 📝 True latches the close immediately (clean library); false parks it behind the panel's Unsaved-material popup,
    //    whose Discard/Save decision arrives through ConsumeCloseRequest().
    bool RequestClose();
    bool ConsumeCloseRequest() noexcept;
    // 📝 Restore the saved embedded layout from the linked control centre's personal projectspace. Call right after
    //    Open(), before the first Synchronize() seats the dockspace. True when a layout was applied or nothing needed
    //    restoring (first run, session-only, no saved section); false (Diagnostic set) when closed, unlinked, already
    //    seated, or the saved data was refused (unreadable preferences block saving for the session; a bad table is
    //    replaced on the next persist).
    bool RestoreLayout(std::string &Diagnostic);
    // 📝 Persist the current dock arrangement under TextureWorkspaceLayoutKey. Best-effort and silent (true) when there
    //    is nothing to save yet; false (Message set) when closed, unlinked, blocked, or the write was refused.
    bool PersistLayout(std::string &Message);

    void ConfigurePlatform();
    void RecoverPlatformWindows();

    [[nodiscard]] TextureWorkspaceState QueryState() const;
    [[nodiscard]] std::string QueryDiagnostic() const;

private:
    struct Implementation;
    std::unique_ptr<Implementation> Impl;
};

} // namespace Frontier
