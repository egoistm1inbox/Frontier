/*==========================================================================================================================================
                                                            VIEWPORTTEXTURE.CPP
==========================================================================================================================================*/
// 🧩 The ImGui Vulkan adapter's texture registrations for a viewport's presented image.

#include "Frontier/Extensions/Interface/ViewportTexture.h"

#include <imgui_impl_vulkan.h>

namespace Frontier
{

uint64_t ViewportTexture::Resolve(VkImageView View)
{
    if (View != View_)
    {
        if (Descriptor_ != VK_NULL_HANDLE) ImGui_ImplVulkan_RemoveTexture(Descriptor_);
        Descriptor_ = View != VK_NULL_HANDLE ? ImGui_ImplVulkan_AddTexture(View, Layout_) : VK_NULL_HANDLE;
        View_       = View;
    }
    return reinterpret_cast<uint64_t>(Descriptor_);
}

void ViewportTexture::Retire()
{
    if (Descriptor_ != VK_NULL_HANDLE) ImGui_ImplVulkan_RemoveTexture(Descriptor_);
    Descriptor_ = VK_NULL_HANDLE;
    View_       = VK_NULL_HANDLE;
}

} // namespace Frontier
