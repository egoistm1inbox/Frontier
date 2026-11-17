/*==========================================================================================================================================
                                                             VIEWPORTTEXTURE.H
==========================================================================================================================================*/
// 🧩 One engine image shown in the interface: the ImGui texture of a viewport's presented image, registered again only when the
//    image view changes and removed when the viewport retires. Every viewport a host shows (scene, particles) uses one.

#pragma once

#include <vulkan/vulkan.h>

#include <cstdint>

namespace Frontier
{

class ViewportTexture
{
  public:
    // 📝 Layout: how the image is sampled; the engine viewports present in GENERAL layout.
    explicit ViewportTexture(VkImageLayout Layout = VK_IMAGE_LAYOUT_GENERAL) noexcept : Layout_(Layout) {}

    ViewportTexture(const ViewportTexture&)            = delete;
    ViewportTexture& operator=(const ViewportTexture&) = delete;

    // 📝 The texture identifier (ImTextureID) for this refresh's view, 0 for none. A new view replaces the registration: the
    //    engine drained its queue before replacing its targets, so the previous registration is no longer sampled.
    uint64_t Resolve(VkImageView View);

    // 📝 True when View differs from the registered one (the host journals new targets).
    [[nodiscard]] bool QueryChanged(VkImageView View) const noexcept { return View != View_; }

    // ⚠️ Call before the interface renderer shuts down; there is no destructor clean-up, because a host destroys its locals after
    //    the backend is gone.
    void Retire();

  private:
    VkImageLayout   Layout_     = VK_IMAGE_LAYOUT_GENERAL;
    VkImageView     View_       = VK_NULL_HANDLE;
    VkDescriptorSet Descriptor_ = VK_NULL_HANDLE;
};

} // namespace Frontier
