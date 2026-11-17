/*==========================================================================================================================================
                                                        TEXTUREWORKSPACEHOSTVULKAN.H
==========================================================================================================================================*/
// 🧩 Vulkan backend for the in-process Texture workspace host: constructs the material thumbnail/preview renderer and the
//    environment atlas on Frontier's presentation device and binds the panels' GPU seams. EXE-SOURCES ONLY: this header
//    needs the Vulkan headers and the ImGui Vulkan backend, so only targets that already link them (Frontier.exe today)
//    may include it; TextureWorkspaceHost.{h,cpp} stay portable and backend-agnostic.

#pragma once

#include "UI/Editor/TextureWorkspaceHost.h"
#include "Engine/Render/SurfaceRasterization.h"

#include <vulkan/vulkan.h>

#include <filesystem>
#include <memory>

namespace Frontier
{

struct TextureWorkspaceBackendPaths
{
    std::filesystem::path ShaderDirectory;      // [-] EngineContent/ShaderArchives/Surface (PBR + atlas pipelines)
    std::filesystem::path EnvironmentDirectory; // [-] EngineContent/EnvironmentArchives (preview lighting catalogue)
    std::filesystem::path AtlasCacheFile;       // [-] Frontier cache file for the persisted gallery atlas
};

// 📝 The backend object holds no GPU resources until Bind() runs (via TextureWorkspaceHost::AttachBackend); Unbind()
//    retires them. Access is Frontier's presentation-device access (VulkanPresentation::QueryRasterAccess).
std::unique_ptr<TextureWorkspaceBackend> ConstructTextureWorkspaceBackend(const VulkanRasterAccess &Access,
    TextureWorkspaceBackendPaths Paths);

} // namespace Frontier
