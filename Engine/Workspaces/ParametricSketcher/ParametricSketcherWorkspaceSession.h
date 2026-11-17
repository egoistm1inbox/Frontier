/*============================================================================================================================================
                                               PARAMETRICSKETCHERWORKSPACESESSION.H
============================================================================================================================================*/
// 🧩 Native Parametric Sketcher workspace session binding .Sketch authoring, derived Frontier display networks, selection, plus revisions

#pragma once

//------------------------------------------------------------------------------------------------------------------------
//                                                        INCLUDES
//------------------------------------------------------------------------------------------------------------------------

#include "Engine/Codecs/SketchCodec.h"
#include "Engine/ParametricSketcher/ParametricSketcherDocument.h"
#include "Engine/Workspaces/Revision/RevisionTracker.h"

#include <cstdint>
#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

namespace Frontier::Workspaces::ParametricSketcher
{

//------------------------------------------------------------------------------------------------------------------------
//                                                       STRUCTURES
//------------------------------------------------------------------------------------------------------------------------

class ParametricSketcherWorkspaceSession
{
public:
    ParametricSketcherWorkspaceSession();

    void ResetToStarterDocument();

    [[nodiscard]] uint32_t ConstructRectangleSketch(
        std::string                 ProfileTitle,
        Mathematics::Axis2D         MinimumCorner,
        Mathematics::Axis2D         MaximumCorner,
        std::string&                OutDiagnostic);

    [[nodiscard]] uint32_t ConstructPrismaticFeature(
        uint32_t                                 ProfileOrdinal,
        float                                    ExtrusionLengthMeters,
        GeometrySpace::FaceShadingAssignment     SurfaceShading,
        std::string&                             OutDiagnostic);

    [[nodiscard]] bool RebuildDerivedNetworks(std::string& OutDiagnostic);
    [[nodiscard]] bool SaveSketchDocument(const std::filesystem::path& TargetPath, std::string& OutDiagnostic);
    [[nodiscard]] bool LoadSketchDocument(const std::filesystem::path& SourcePath, std::string& OutDiagnostic);

    void SelectProfile(uint32_t ProfileOrdinal) noexcept;
    void SelectBody(uint32_t BodyOrdinal) noexcept;

    [[nodiscard]] const ::Frontier::ParametricSketcher::ParametricSketcherDocument& InspectDocument() const noexcept { return Document; }
    [[nodiscard]] ::Frontier::ParametricSketcher::ParametricSketcherDocument&       AccessDocument() noexcept { return Document; }
    [[nodiscard]] const RevisionTracker&                                              InspectRevisionHistory() const noexcept { return RevisionHistory; }
    [[nodiscard]] RevisionTracker&                                                    AccessRevisionHistory() noexcept { return RevisionHistory; }
    [[nodiscard]] const std::vector<GeometrySpace::PolygonNetwork>&                  InspectDerivedNetworks() const noexcept { return DerivedNetworks; }
    [[nodiscard]] uint32_t                                                            QuerySelectedProfileOrdinal() const noexcept { return SelectedProfileOrdinal; }
    [[nodiscard]] uint32_t                                                            QuerySelectedBodyOrdinal() const noexcept { return SelectedBodyOrdinal; }
    [[nodiscard]] const std::string&                                                  QueryStatusText() const noexcept { return StatusText; }

private:
    void RecordCompactOperation(
        std::string_view OperationTag,
        uint32_t         TargetOrdinal,
        double           FirstScalar,
        double           SecondScalar,
        double           ThirdScalar,
        double           FourthScalar);

    ::Frontier::ParametricSketcher::ParametricSketcherDocument Document        {};
    RevisionTracker                                              RevisionHistory {};
    std::vector<GeometrySpace::PolygonNetwork>                  DerivedNetworks {};
    uint32_t                                                     SelectedProfileOrdinal = ::Frontier::ParametricSketcher::InvalidSketchOrdinal;
    uint32_t                                                     SelectedBodyOrdinal    = ::Frontier::ParametricSketcher::InvalidSketchOrdinal;
    uint64_t                                                     NextRevisionStamp      = 1ull;
    std::string                                                  StatusText            { "Parametric Sketcher ready" };
};

} // namespace Frontier::Workspaces::ParametricSketcher
