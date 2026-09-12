//============================================================================================================================================
//                                               SCENERECORDPACKING.H
//============================================================================================================================================
// Production scene-to-GPU record conversion shared by ReSTIR and the headless CPU proof. This header deliberately
// has no Vulkan dependency: a proof can build the same packed triangle/material records without a device or driver.

#pragma once

#include "TriangleIndex.h"
#include "../ContentInterchange/MaterialIndex.h"
#include <vector>

namespace Frontier::ProjectZero { class RayTracingSolver; }

namespace Frontier {

[[nodiscard]] std::vector<TriangleIndex> BuildProjectZeroTriangleRecords(
    const ProjectZero::RayTracingSolver& Scene) noexcept;
[[nodiscard]] std::vector<MaterialDescriptor> BuildProjectZeroMaterialRecords(
    const ProjectZero::RayTracingSolver& Scene) noexcept;

} // namespace Frontier
