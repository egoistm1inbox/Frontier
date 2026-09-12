//============================================================================================================================================
//                                               SCENERECORDPACKING.CPP
//============================================================================================================================================

#include "SceneRecordPacking.h"
#include "../../Projects/Project-Zero/Source/RayTracingSolver.h"
#include <algorithm>
#include <cstring>
#include <string>
#include <utility>

namespace Frontier {

std::vector<TriangleIndex> BuildProjectZeroTriangleRecords(
    const ProjectZero::RayTracingSolver& Scene) noexcept
{
    const auto& Triangles = Scene.QueryTriangles();
    std::vector<TriangleIndex> Records;
    Records.reserve(Triangles.size());
    for (const auto& Triangle : Triangles)
    {
        TriangleIndex Record{};
        Record.VertexAlphaX = Triangle.VertexAlpha.x;
        Record.VertexAlphaY = Triangle.VertexAlpha.y;
        Record.VertexAlphaZ = Triangle.VertexAlpha.z;
        std::memcpy(&Record.MaterialSlot, &Triangle.MaterialIndex, sizeof(Record.MaterialSlot));
        Record.VertexBetaX = Triangle.VertexBeta.x;
        Record.VertexBetaY = Triangle.VertexBeta.y;
        Record.VertexBetaZ = Triangle.VertexBeta.z;
        Record.VertexGammaX = Triangle.VertexGamma.x;
        Record.VertexGammaY = Triangle.VertexGamma.y;
        Record.VertexGammaZ = Triangle.VertexGamma.z;
        Records.push_back(Record);
    }
    return Records;
}

std::vector<MaterialDescriptor> BuildProjectZeroMaterialRecords(
    const ProjectZero::RayTracingSolver& Scene) noexcept
{
    const auto& Materials = Scene.QueryMaterials();
    std::vector<MaterialDescriptor> Records;
    Records.reserve(Materials.size());
    for (const auto& Material : Materials)
    {
        MaterialDescriptor Descriptor;
        Descriptor.Name = "material_" + std::to_string(Material.MaterialIdentifier);
        Descriptor.Slabs.emplace_back();
        MaterialSlabDescriptor& Slab = Descriptor.Slabs.back();
        Slab.BaseColor[0] = Material.AlbedoColor.x;
        Slab.BaseColor[1] = Material.AlbedoColor.y;
        Slab.BaseColor[2] = Material.AlbedoColor.z;
        Slab.SpecularRoughness = Material.RoughnessValue;
        Slab.BaseMetalness = Material.MetallicValue;
        Slab.SpecularWeight = 0.0f;
        const float E[3] = { Material.EmissiveRadiance.x, Material.EmissiveRadiance.y, Material.EmissiveRadiance.z };
        const float Peak = std::max({ E[0], E[1], E[2], 0.0f });
        if (Peak > 0.0f)
        {
            Slab.EmissionLuminance = Peak;
            Slab.EmissionColor[0] = E[0] / Peak;
            Slab.EmissionColor[1] = E[1] / Peak;
            Slab.EmissionColor[2] = E[2] / Peak;
        }
        Records.push_back(std::move(Descriptor));
    }
    return Records;
}

} // namespace Frontier
