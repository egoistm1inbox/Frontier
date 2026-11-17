/*==========================================================================================================================================
                                                     FORCEFIELDWORKSPACERUNTIME.H
==========================================================================================================================================*/
// 🧩 Native ForceFieldSpace adapter and immutable sampler snapshots for the Force Field workspace.

#pragma once

#include "Engine/Interface/ForceFieldVisualization/ForceFieldVisualization.h"
#include "Engine/Interface/Workspaces/ForceFieldWorkspace.h"

#include <cstdint>
#include <filesystem>
#include <memory>
#include <string>
#include <vector>

namespace Frontier
{

class ForceFieldWorkspaceRuntime
{
  public:
    ForceFieldVisualization Visualization;
    bool                    SamplerConfigured = false;

    void Synchronize(const ForceFieldWorkspaceState& State);
    void SettleSampling() { Visualization.SettleSampling(); }

    [[nodiscard]] SpatialVector Sample(ForceContribution Contribution, SpatialVector Point,
                                       int32_t Solo = ForceFieldSpace::kSoloEvery) const noexcept;

  private:
    struct Snapshot;
    [[nodiscard]] static SpatialVector SampleImmutable(const Snapshot& Snapshot, ForceContribution Contribution,
                                                        SpatialVector Point, int32_t Solo) noexcept;
    std::shared_ptr<const Snapshot> Snapshot_;
    uint64_t                       Signature_ = 0;
    uint64_t                       Revision_ = 0;
};

[[nodiscard]] std::vector<ForceSourceConfiguration> BuildForceFieldWorkspaceNativeSources(const ForceFieldWorkspaceState& State);
[[nodiscard]] bool ExportForceFieldWorkspaceLevelSpace(const ForceFieldWorkspaceState& State,
                                                       const std::filesystem::path& Path,
                                                       std::string* Diagnostic = nullptr);
[[nodiscard]] ForceFieldWorkspaceRuntime& EnsureForceFieldWorkspaceRuntime(ForceFieldWorkspaceState& State);
void SynchronizeForceFieldWorkspaceRuntime(ForceFieldWorkspaceState& State);
[[nodiscard]] SpatialVector EvaluateForceFieldWorkspaceSample(const ForceFieldWorkspaceState& State,
                                                               ForceContribution Contribution,
                                                               SpatialVector Point,
                                                               int32_t Solo = ForceFieldSpace::kSoloEvery) noexcept;

} // namespace Frontier
