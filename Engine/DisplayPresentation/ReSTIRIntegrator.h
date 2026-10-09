//============================================================================================================================================
//                                                      RESTIRINTEGRATOR.H
//============================================================================================================================================
// 🧩 Drives the interim progressive path-tracing kernel (RIS direct lighting + one NEE bounce, running-mean accumulation).
//    🚧 Not yet ReSTIR proper — see the status block at the top of Engine/Shaders/ReSTIRViewport.slang and plan v2.1.

#pragma once

#if defined(_MSC_VER)
    #pragma warning(disable: 4324)
#endif

#include "../DeviceExchange/SwapchainExchange.h"
#include "../ContentInterchange/MaterialDescriptor.h"
#include "../../Projects/Project-Zero/Source/RayTracingSolver.h"
#include "../../Projects/Project-Zero/Source/FlyThroughSolver.h"
#include <cstdint>
#include <vector>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                           RESTIR INTEGRATOR CONFIGURATION
//------------------------------------------------------------------------------------------------------------------------

struct ReSTIRIntegratorConfiguration
{
    uint32_t    CandidatesPerPixel;         // [-]   primary DI candidates per pixel
    uint32_t    SpatialPassCount;           // [-]   ReSTIR spatial resampling passes
    float       Exposure;                   // [-]   ACES tone-map exposure scalar
    float       AmbientStrength;            // [-]   ambient fallback contribution
    bool        GlobalIllumination = true;  // [-]   secondary bounce on/off
    bool        AntiAliasing       = true;  // [-]   sub-pixel jitter on/off
    bool        AmbientFloor       = false; // [-]   debug fill light (albedo × AmbientStrength); off by default since R0
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  RESTIR INTEGRATOR
//------------------------------------------------------------------------------------------------------------------------

class ReSTIRIntegrator
{
public:
    explicit ReSTIRIntegrator(ReSTIRIntegratorConfiguration InitialConfiguration) noexcept;
    ~ReSTIRIntegrator() noexcept = default;

    ReSTIRIntegrator(const ReSTIRIntegrator&)            = delete;
    ReSTIRIntegrator& operator=(const ReSTIRIntegrator&) = delete;

    // Construct the DispatchConfiguration from live camera state and scene counts
    [[nodiscard]] DispatchConfiguration
    BuildDispatch(const ProjectZero::FlyThroughSolver& Camera,
                  uint32_t                             ViewportWidth,
                  uint32_t                             ViewportHeight,
                  uint32_t                             AlphaMaskedMaterialCount,   // R4b: materials flagged MaterialFlagAlphaMask
                  uint32_t                             LuminaireTriangleCount) const noexcept;

    // Count emissive triangles in the scene (used to set LuminaireTriangleCount each frame)
    [[nodiscard]] static uint32_t
    CountLuminaireTriangles(const ProjectZero::RayTracingSolver& Scene) noexcept;

    // Build GPU triangle and material records from the CPU scene
    [[nodiscard]] static std::vector<TriangleIndex>
    BuildTriangleIndex(const ProjectZero::RayTracingSolver& Scene) noexcept;

    [[nodiscard]] static std::vector<MaterialDescriptor>
    BuildMaterialDescriptors(const ProjectZero::RayTracingSolver& Scene) noexcept;

    // Mutable configuration — updated live by RenderScheduler
    // Any parameter change invalidates the temporal history; the accumulation restarts at index 0.
    void AssignCandidatesPerPixel(uint32_t Count) noexcept { if (ActiveConfiguration.CandidatesPerPixel != Count) { ActiveConfiguration.CandidatesPerPixel = Count; ResetAccumulation(); } }
    void AssignSpatialPassCount  (uint32_t Count) noexcept { if (ActiveConfiguration.SpatialPassCount   != Count) { ActiveConfiguration.SpatialPassCount   = Count; ResetAccumulation(); } }
    void AssignExposure          (float    Value) noexcept { if (ActiveConfiguration.Exposure            != Value) { ActiveConfiguration.Exposure            = Value; ResetAccumulation(); } }
    void AssignGlobalIllumination(bool     On)    noexcept { if (ActiveConfiguration.GlobalIllumination  != On)    { ActiveConfiguration.GlobalIllumination  = On;    ResetAccumulation(); } }
    void AssignAntiAliasing      (bool     On)    noexcept { if (ActiveConfiguration.AntiAliasing        != On)    { ActiveConfiguration.AntiAliasing        = On;    ResetAccumulation(); } }

    void ResetAccumulation() noexcept { AccumulationIndex = 0u; }

    // Compares the camera pose against the one used for the running history; a moved or turned camera
    //    (or a resized viewport) restarts accumulation so no stale radiance is blended in.
    void ObserveCamera(const ProjectZero::FlyThroughSolver& Camera, uint32_t ViewportWidth, uint32_t ViewportHeight) noexcept;

    [[nodiscard]] const ReSTIRIntegratorConfiguration& QueryConfiguration() const noexcept
    {
        return ActiveConfiguration;
    }

    void IncrementAccumulationIndex() noexcept { AccumulationIndex++; }
    [[nodiscard]] uint32_t QueryAccumulationIndex() const noexcept { return AccumulationIndex; }

    template<typename TargetType>
    [[nodiscard]] TargetType Convert() const noexcept;

private:
    ReSTIRIntegratorConfiguration ActiveConfiguration;  // [-]  live-tunable parameters
    uint32_t                      AccumulationIndex;    // [-]  temporal frame counter (incremented per frame)

    Vector3                       HistoryOrigin;        // [m]   camera position the history was accumulated from
    Vector3                       HistoryForward;       // [-]   camera forward the history was accumulated from
    uint32_t                      HistoryWidth;         // [px]  viewport width of the history
    uint32_t                      HistoryHeight;        // [px]  viewport height of the history
};

template<>
inline uint32_t ReSTIRIntegrator::Convert<uint32_t>() const noexcept
{
    return AccumulationIndex;
}

template<>
inline float ReSTIRIntegrator::Convert<float>() const noexcept
{
    return ActiveConfiguration.Exposure;
}

} // namespace Frontier
