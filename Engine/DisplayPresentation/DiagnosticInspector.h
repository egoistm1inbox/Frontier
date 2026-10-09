//============================================================================================================================================
//                                                     DIAGNOSTICINSPECTOR.H
//============================================================================================================================================
// 🧩 Small popup overlay for the R2 renderer diagnostics — NOT a settings page. F3 opens it / cycles the debug view,
//    Shift+F3 cycles backwards, F4 toggles HiZ occlusion culling, Escape closes it. It hangs from the notch line at the
//    top-right (the FPS readout owns the top-left) and shows the active view, the cull funnel and the GPU pass timings.
//
//    Layout (Notch card language, ControlKit palette): 13 px title "Debug View · <name>", 11 px rows
//        clusters   2 097 → frustum 1 240 → cone 1 240 → visible 312     (phase 1 298 + phase 2 14)
//        triangles  38 912 drawn  |  indirect: 1 draw call per phase
//        cull 0.12 ms · raster 0.41 ms · HiZ 0.08 ms · resolve 0.19 ms · kernel 9.8 ms
//        key hints  F3 next · ⇧F3 previous · F4 HiZ on/off · Esc close
//    Values come from VisibilityTelemetry (two frames old, no stall).

#pragma once

#include "PixelSpace.h"
#include "../DeviceExchange/InputExchange.h"
#include "../DeviceExchange/VisibilityExchange.h"
#include <cstdint>

namespace Frontier {

class DiagnosticInspector
{
public:
    DiagnosticInspector() noexcept = default;

    // Seeds from the persisted configuration; the popup starts closed even if a debug view is persisted.
    void Seed(DebugViewCategory View, bool OcclusionCulling) noexcept { View_ = View; Occlusion_ = OcclusionCulling; }

    // Edge-detects F3 / Shift+F3 / F4 / Escape. Returns true when something changed (caller persists + restarts accumulation).
    bool AdvanceInteraction(const InputExchange& Input) noexcept;

    void ConstructInspectorLayout(PixelSpace& Surface, float TopInset, float DisplayWidth, const VisibilityTelemetry& Telemetry,
                                  uint32_t ClusterTotal, bool DrawIndirectCount) const noexcept;

    [[nodiscard]] DebugViewCategory QueryView()      const noexcept { return View_; }
    [[nodiscard]] bool              QueryOcclusion() const noexcept { return Occlusion_; }
    [[nodiscard]] bool              IsOpen()         const noexcept { return Open_; }

private:
    DebugViewCategory View_       = DebugViewCategory::Off;
    bool              Occlusion_  = true;
    bool              Open_       = false;
    bool              F3Held_     = false;
    bool              F4Held_     = false;
    bool              EscapeHeld_ = false;
};

} // namespace Frontier
