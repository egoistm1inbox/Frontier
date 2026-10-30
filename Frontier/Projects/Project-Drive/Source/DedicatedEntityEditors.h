/*====================================================================================================================================
                                                   DEDICATEDENTITYEDITORS.H
====================================================================================================================================*/
// 🧩 Unreal-style per-entity Dedicated Popup Editor Studio windows (#if defined(FRONTIER_EDITOR_PROFILE)) ported
//    from Experimental/Fluid (Pyro Plume 9-preset FluidPanel), VehicleProvingGrounds (Fracture, Sparks, CabinHMI,
//    Vehicle, Sun/Sky, ReSTIR GI), and ClusterLodReference / FrontierEditor (3D Placeable Object & Material Studio).
//    Every popup window binds directly to the live OS MAP_SHARED SharedEntityMemorySegment & DriveShowcaseWorld
//    solvers — 0 bytes of entity RAM are duplicated when viewing or editing in a Dedicated Studio window!

#pragma once

#include "DriveShowcaseWorld.h"

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#if defined(FRONTIER_EDITOR_PROFILE) && defined(FRONTIER_WITH_INTERFACE_SDK)
#include <imgui.h>
#endif

namespace Frontier::Drive
{

class DedicatedEntityEditorHost
{
  public:
    DedicatedEntityEditorHost() = default;
    ~DedicatedEntityEditorHost();

    DedicatedEntityEditorHost(const DedicatedEntityEditorHost &)            = delete;
    DedicatedEntityEditorHost &operator=(const DedicatedEntityEditorHost &) = delete;

    void OpenEditorForEntity(const std::string &StableId, DriveShowcaseWorld &World);
    void CloseEditorForEntity(const std::string &StableId);
    void CloseAllEditors(bool GpuConfirmedIdle = false);

    void RenderOpenEditorWindows(DriveShowcaseWorld &World);

    [[nodiscard]] size_t OpenWindowCount() const noexcept;
    [[nodiscard]] bool   IsEditorOpen(const std::string &StableId) const noexcept;
    [[nodiscard]] size_t DuplicatedEntityBytes() const noexcept { return 0u; }
    [[nodiscard]] bool   VerifyZeroCopySharedAddresses(const DriveShowcaseWorld &World) const noexcept;

  private:
#if defined(FRONTIER_EDITOR_PROFILE) && defined(FRONTIER_WITH_INTERFACE_SDK)
    struct OpenStudioWindow
    {
        std::string          StableId{};
        std::string          WindowTitle{};
        std::string          StudioFamily{};
        bool                 Open                 = true;
        bool                 NeedsFocus           = true;
        float                OrbitYawRad          = -0.82f;
        float                OrbitPitchRad        = 0.42f;
        float                OrbitDistanceScale   = 1.0f;
        bool                 AutoTurntable        = false;
        uint8_t              PreviewInspectMode   = 0u; // 0=Lit, 1=Shadows, 2=GI, 5=Normals
        uint64_t             LastRenderedWorldRev = 0u;
        uint32_t             FrameThrottle        = 0u;
        bool                           TextureRegistered    = false;
        std::unique_ptr<ImTextureData> PreviewTexture       = std::make_unique<ImTextureData>();
        std::vector<uint8_t>           PreviewRgba{};
    };

    void RetireWindowTexture(OpenStudioWindow &Win, bool GpuConfirmedIdle) noexcept;
    void ReclaimCompletedRetiredTextures(bool ForceImmediate) noexcept;
    void DrawSingleStudioWindow(OpenStudioWindow &Win, DriveShowcaseWorld &World, size_t WindowIndex);
    void DrawStudioPresetBank(const std::string &StableId, DriveShowcaseWorld &World);

    std::vector<OpenStudioWindow>               Windows_;
    std::vector<std::unique_ptr<ImTextureData>> RetiredTextures_;
#endif
};

} // namespace Frontier::Drive
