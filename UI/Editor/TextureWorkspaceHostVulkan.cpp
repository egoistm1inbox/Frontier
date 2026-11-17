/*==========================================================================================================================================
                                                         TEXTUREWORKSPACEHOSTVULKAN.CPP
==========================================================================================================================================*/
// 🧩 Vulkan backend for the in-process Texture workspace host. Mirrors the Material-subset GPU wiring of the standalone
//    Texture Workspace application (Experimental/TextureStudio/Native/TextureStudioApplication.cpp): the material
//    thumbnail/preview renderer, the environment preview atlas, the panel seam lambdas, the per-frame record/confirm
//    block, and the descriptor/rendering teardown. Pattern/Stamp/Paint/Baking GPU objects stay in the standalone until
//    their workspaces are hosted (Phase 2).

#include "UI/Editor/TextureWorkspaceHostVulkan.h"

#include "Engine/ContentInterchange/MaterialLibrary.h"
#include "Engine/Diagnostics/DiagnosticJournal.h"
#include "Engine/Render/MaterialLibraryRendering.h"
#include "Engine/Render/MaterialThumbnailAtlas.h"
#include "UI/TextureStudio/MaterialLibraryPanel.h"

#include <imgui.h>
#include <imgui_impl_vulkan.h>

#include <deque>
#include <utility>

namespace Frontier
{

namespace
{

// 📝 Matches the standalone gallery-atlas cache so the embedded workspace reuses (never reformats) the same disk cache.
constexpr uint64_t MaterialAtlasCacheFormat = 0x4D41544C41533200ull;

void JournalBackendFault(const char *Stage, const std::exception &Failure)
{
    DiagnosticJournal::Append(Stage, Failure.what());
}

class TextureWorkspaceVulkanBackend : public TextureWorkspaceBackend
{
public:
    TextureWorkspaceVulkanBackend(const VulkanRasterAccess &Access, TextureWorkspaceBackendPaths Paths)
        : Access(Access), Paths(std::move(Paths))
    {
    }

    ~TextureWorkspaceVulkanBackend() override
    {
        if (Bound) Unbind(*Bound);
    }

    void Bind(MaterialLibraryPanel &Library) override
    {
        if (Bound) throw std::logic_error("TextureWorkspaceBackend::Bind: a library is already bound.");
        try
        {
            Rendering = std::make_unique<MaterialLibraryRendering>();
            Rendering->Initialize(Access, Paths.ShaderDirectory,
                MaterialLibraryRendering::ShippedAtlasTile,
                MaterialLibraryRendering::ShippedAtlasColumns);
            // 📝 Disk-persist the baked gallery atlas so reopening does not re-render every visible
            // material through the PBR pipeline again; best-effort and silently inert on any failure.
            Rendering->ConfigureAtlasCache(Paths.AtlasCacheFile, MaterialAtlasCacheFormat);
            Rendering->ConfigureEnvironments(Paths.EnvironmentDirectory);
            EnvironmentAtlas = std::make_unique<MaterialThumbnailAtlas>();
            EnvironmentAtlas->Initialize(Access,
                MaterialLibraryRendering::EnvironmentPreviewTile,
                MaterialLibraryRendering::EnvironmentPreviewColumns);
            EnvironmentAtlasDescriptor = ImGui_ImplVulkan_AddTexture(EnvironmentAtlas->QueryImageView(),
                VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL);
            AtlasDescriptor = ImGui_ImplVulkan_AddTexture(Rendering->QueryAtlasView(), VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL);
            PreviewDescriptor = ImGui_ImplVulkan_AddTexture(Rendering->QueryPreviewView(), VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL);
            LastPreviewView = Rendering->QueryPreviewView();
            Bound = &Library;
            Library.RequestThumbnails = [this](const std::vector<std::filesystem::path> &Visible)
            {
                if (!Bound || !Rendering) return;
                try { Rendering->RequestLibrary(Bound->QueryLibrary().QueryDirectory(), Visible); }
                catch (const std::exception &Failure) { JournalBackendFault("TextureWorkspaceThumbnails", Failure); }
            };
            Library.QueryThumbnail = [this](const std::filesystem::path &Path)
            {
                if (!Bound || !Rendering) return MaterialPreviewImage{};
                const auto Thumbnail = Rendering->QueryThumbnail(Path);
                const auto &Uv = Thumbnail.Uv;
                return MaterialPreviewImage{Thumbnail.Ready ? (uint64_t)AtlasDescriptor : 0,
                    Uv.MinimumU, Uv.MinimumV, Uv.MaximumU, Uv.MaximumV};
            };
            Library.InvalidateThumbnails = [this]() { if (Rendering) Rendering->InvalidateThumbnails(); };
            Library.InvalidateThumbnail = [this](const std::filesystem::path &Path)
            {
                if (Rendering) Rendering->InvalidateThumbnail(Path);
            };
            Library.QueryThumbnailDiagnostic = [this](const std::filesystem::path &Path)
            {
                return Rendering ? Rendering->QueryThumbnailDiagnostic(Path) : std::string{};
            };
            Library.ConfigurePreview = [this](const MaterialPreviewConfiguration &Configuration)
            {
                if (!Rendering) return;
                try { Rendering->ConfigurePreview(Configuration); }
                catch (const std::exception &Failure) { JournalBackendFault("TextureWorkspacePreview", Failure); }
            };
            Library.ConfigurePreviewExtent = [this](uint32_t Extent)
            {
                if (Rendering) Rendering->ConfigurePreviewExtent(Extent);
            };
            Library.QueryEnvironmentNames = [this]()
            {
                return Rendering ? Rendering->QueryEnvironmentNames() : std::vector<std::string>{};
            };
            Library.QueryEnvironmentPreview = [this](size_t Index)
            {
                if (!Bound || !Rendering || !EnvironmentAtlas || !EnvironmentAtlasDescriptor ||
                    Index >= Rendering->QueryEnvironmentPreviews().Count) return MaterialPreviewImage{};
                const auto Uv = EnvironmentAtlas->QueryUv(uint32_t(Index));
                return MaterialPreviewImage{uint64_t(EnvironmentAtlasDescriptor),
                    Uv.MinimumU, Uv.MinimumV, Uv.MaximumU, Uv.MaximumV};
            };
            Library.RescanEnvironments = [this]()
            {
                if (!Bound || !Rendering) return;
                try
                {
                    Rendering->ConfigureEnvironments(Paths.EnvironmentDirectory);
                    // 📝 Re-upload the selected residence so its own environment image matches the
                    // rescanned catalogue (layer clamp covers the frames in between).
                    const auto &Catalogue = Bound->QueryLibrary();
                    if (Catalogue.QueryApplied())
                        Rendering->ConfigureSelection(Catalogue.QuerySelection(), *Catalogue.QueryApplied());
                }
                catch (const std::exception &Failure) { JournalBackendFault("TextureWorkspaceEnvironments", Failure); }
            };
            Library.QueryPreview = [this]()
            {
                if (!Bound || !Rendering) return MaterialPreviewImage{};
                // 📝 A retired descriptor was last sampled at most its retirement frame; the submission
                // owner fences every frame before recording the next, so four frames later it is free.
                while (!RetiredPreviewDescriptors.empty() && RetiredPreviewDescriptors.front().second + 4 <= InterfaceFrame)
                {
                    if (RetiredPreviewDescriptors.front().first)
                        ImGui_ImplVulkan_RemoveTexture(RetiredPreviewDescriptors.front().first);
                    RetiredPreviewDescriptors.pop_front();
                }
                const VkImageView CurrentView = Rendering->QueryPreviewView();
                try
                {
                    if (CurrentView && CurrentView != LastPreviewView)
                    {
                        LastPreviewView = CurrentView;
                        if (PreviewDescriptor) RetiredPreviewDescriptors.emplace_back(PreviewDescriptor, InterfaceFrame);
                        PreviewDescriptor = ImGui_ImplVulkan_AddTexture(CurrentView, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL);
                    }
                }
                catch (const std::exception &Failure) { JournalBackendFault("TextureWorkspacePreview", Failure); }
                return MaterialPreviewImage{Rendering->QueryPreviewReady() ? (uint64_t)PreviewDescriptor : 0};
            };
        }
        catch (...)
        {
            Unbind(Library);
            throw;
        }
    }

    void Unbind(MaterialLibraryPanel &Library) noexcept override
    {
        // 📝 Clear the GPU seams first so no UI tick can re-enter GPU objects during teardown. Host-owned seams
        //    (PresentIcon, EvaluateNavigationDelta, Activate*) are untouched.
        Library.RequestThumbnails = {};
        Library.QueryThumbnail = {};
        Library.QueryPreview = {};
        Library.ConfigurePreview = {};
        Library.ConfigurePreviewExtent = {};
        Library.QueryEnvironmentNames = {};
        Library.QueryEnvironmentPreview = {};
        Library.RescanEnvironments = {};
        Library.InvalidateThumbnails = {};
        Library.InvalidateThumbnail = {};
        Library.QueryThumbnailDiagnostic = {};
        Bound = nullptr;
        try
        {
            // 📝 Mid-session close lands on a frame boundary where the previous submission may still be in flight;
            //    wait for the device before freeing descriptor sets and GPU resources (the RetireSceneView precedent).
            WaitForDevice();
            if (AtlasDescriptor) ImGui_ImplVulkan_RemoveTexture(AtlasDescriptor);
            AtlasDescriptor = VK_NULL_HANDLE;
            if (PreviewDescriptor) ImGui_ImplVulkan_RemoveTexture(PreviewDescriptor);
            PreviewDescriptor = VK_NULL_HANDLE;
            if (EnvironmentAtlasDescriptor) ImGui_ImplVulkan_RemoveTexture(EnvironmentAtlasDescriptor);
            EnvironmentAtlasDescriptor = VK_NULL_HANDLE;
            for (const auto &Retired : RetiredPreviewDescriptors)
                if (Retired.first) ImGui_ImplVulkan_RemoveTexture(Retired.first);
            RetiredPreviewDescriptors.clear();
            if (EnvironmentAtlas) EnvironmentAtlas->Finalize();
            EnvironmentAtlas.reset();
            Rendering.reset();
        }
        catch (...) {}
        EnvironmentAtlasPublished = 0;
        EnvironmentAtlasFaulted = false;
        MaterialRenderingFaultKey.clear();
        LastPreviewView = VK_NULL_HANDLE;
    }

    void PublishSelection(const std::filesystem::path &Selection, const CompiledSurfaceMaterial &Material) override
    {
        if (Rendering) Rendering->ConfigureSelection(Selection, Material);
    }

    void ConstructCommands(void *Commands, uint64_t Completed, uint64_t Serial) override
    {
        ++InterfaceFrame;
        if (!Bound || !Rendering) return;
        VkCommandBuffer Buffer = static_cast<VkCommandBuffer>(Commands);
        const auto EnvironmentPreviews = Rendering->QueryEnvironmentPreviews();
        if (!EnvironmentAtlasFaulted && EnvironmentAtlas && EnvironmentPreviews.Generation &&
            EnvironmentPreviews.Generation != EnvironmentAtlasPublished)
            try
            {
                EnvironmentAtlas->StagePixels(EnvironmentPreviews.Pixels);
                EnvironmentAtlas->ConstructUpload(Buffer);
                EnvironmentAtlasPublished = EnvironmentPreviews.Generation;
            }
            catch (const std::exception &Failure)
            {
                EnvironmentAtlasFaulted = true;
                JournalBackendFault("TextureWorkspaceEnvironments", Failure);
            }
        {
            // 📝 Material rendering faults latch against the current catalogue revision + preview
            // configuration; any new edit re-arms evaluation. A partially recorded tile/preview
            // renderpass belongs to this discarded key and is never resubmitted unchanged.
            const auto PreviewState = Rendering->QueryPreviewConfiguration();
            const std::string RenderingKey = std::to_string(Bound->QueryLibrary().QueryRevision()) + "|" +
                std::to_string(uint32_t(PreviewState.Shape)) + "|" +
                std::to_string(uint32_t(PreviewState.Environment)) + "|" +
                std::to_string(PreviewState.Zoom) + "|" + std::to_string(PreviewState.Yaw) + "|" +
                std::to_string(PreviewState.Pitch) + "|" + std::to_string(Rendering->QueryPreviewExtent());
            if (RenderingKey != MaterialRenderingFaultKey)
                try { Rendering->ConstructCommands(Buffer, Completed, Serial); }
                catch (const std::exception &Failure)
                {
                    MaterialRenderingFaultKey = RenderingKey;
                    JournalBackendFault("TextureWorkspaceRendering", Failure);
                }
        }
    }

    void ConfirmSubmission() noexcept override
    {
        try
        {
            if (EnvironmentAtlas) EnvironmentAtlas->ConfirmSubmission();
            if (Rendering) Rendering->ConfirmSubmission();
        }
        catch (const std::exception &Failure) { JournalBackendFault("TextureWorkspaceConfirm", Failure); }
        catch (...) { DiagnosticJournal::Append("TextureWorkspaceConfirm", "unknown submission-confirm fault isolated"); }
    }

private:
    void WaitForDevice() noexcept
    {
        if (!Access.Device || !Access.ResolveDevice) return;
        const auto WaitIdle = reinterpret_cast<PFN_vkDeviceWaitIdle>(Access.ResolveDevice(Access.Device, "vkDeviceWaitIdle"));
        if (WaitIdle) (void)WaitIdle(Access.Device);
    }

    VulkanRasterAccess Access;
    TextureWorkspaceBackendPaths Paths;
    MaterialLibraryPanel *Bound = nullptr;
    std::unique_ptr<MaterialLibraryRendering> Rendering;
    std::unique_ptr<MaterialThumbnailAtlas> EnvironmentAtlas;
    VkDescriptorSet AtlasDescriptor = VK_NULL_HANDLE;
    VkDescriptorSet PreviewDescriptor = VK_NULL_HANDLE;
    VkDescriptorSet EnvironmentAtlasDescriptor = VK_NULL_HANDLE;
    VkImageView LastPreviewView = VK_NULL_HANDLE;
    std::deque<std::pair<VkDescriptorSet, uint64_t>> RetiredPreviewDescriptors;
    uint64_t InterfaceFrame = 0;
    uint64_t EnvironmentAtlasPublished = 0;
    bool EnvironmentAtlasFaulted = false;
    std::string MaterialRenderingFaultKey;
};

} // namespace

std::unique_ptr<TextureWorkspaceBackend> ConstructTextureWorkspaceBackend(const VulkanRasterAccess &Access,
    TextureWorkspaceBackendPaths Paths)
{
    return std::make_unique<TextureWorkspaceVulkanBackend>(Access, std::move(Paths));
}

} // namespace Frontier
