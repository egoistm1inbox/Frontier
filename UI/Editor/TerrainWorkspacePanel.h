/*==========================================================================================================================================
                                                          TERRAINWORKSPACEPANEL.H
==========================================================================================================================================*/
// 🧩 Terrain workspace for the editor: the density-field layer stack (left dock), extracted-surface
//    viewport (centre dock), and descriptor-generated inspector (right dock) — the same three-dock
//    composition TexturePaintWorkspacePanel established, over a volumetric document.
//
// 📝 Scope, stated plainly: this header is the panel specification against the inspected editor APIs
//    (PanelDockspace registration, ActivationSequence lifecycle, ControlKit widgets). The viewport
//    consumes PolygonSurface extractions from Engine/Terrain; it never evaluates the field itself.
//    Brush input produces Sculpt/Carve/Stamp strata in the document (replayable, undoable), exactly
//    as the Texture Paint workspace treats dabs as document truth over its preview canvas.

#pragma once

#include "Engine/Interface/PanelDockspace.h"
#include "Engine/Interface/PixelSpace.h"
#include "Engine/Lifecycle/ActivationSequence.h"
#include "Engine/Terrain/DensityFieldEvaluation.h"
#include "Engine/Terrain/DualContourExtraction.h"
#include "Engine/Terrain/ShallowWaterSimulation.h"
#include "Engine/Terrain/StratumOperationRegistry.h"
#include "Engine/Terrain/StratumSequence.h"
#include <filesystem>
#include <functional>
#include <string>
#include <vector>

namespace Frontier
{

//----------------------------------------------------------------------------------------------------------------------
//                                                TERRAIN WORKSPACE PANEL
//----------------------------------------------------------------------------------------------------------------------

class TerrainWorkspacePanel final : public ActivationSequence
{
  public:
    TerrainWorkspacePanel();
    void ConstructInterface();
    void ConfigureInterfaceScale(float Scale) noexcept { InterfaceScale = Scale > 0.1f ? Scale : 1.0f; }
    [[nodiscard]] float QueryInterfaceScale() const noexcept { return InterfaceScale; }
    void ConfigureTypeface(void *Regular, void *Light = nullptr) noexcept
    {
        RegularTypeface = Regular;
        LightTypeface   = Light ? Light : Regular;
    }

    // 📝 Document access. The panel edits evaluation truth through StratumSequence only; every
    //    mutation lands as a revisioned document change with an undo snapshot, mirroring the
    //    Texture Paint workspace's history discipline.
    void ConfigureDocument(std::filesystem::path DocumentPath);
    [[nodiscard]] const std::string &QueryDocumentName() const noexcept { return DocumentName; }
    [[nodiscard]] size_t QueryStratumCount() const noexcept { return Sequence.QueryStratumCount(); }
    [[nodiscard]] std::string QuerySelectedStratumName() const;
    [[nodiscard]] size_t QueryHistoryCount() const noexcept { return HistoryEntries.size(); }
    [[nodiscard]] size_t QueryExtractedTriangleCount() const noexcept { return ExtractedTriangles; }
    [[nodiscard]] PlaneExtent QueryControlExtent(const std::string &Caption) const;

    // 📝 Same host contract every workspace panel exposes: one shared dockspace owns layout.
    //    Registered keys: "terrain-layers" (stack), "terrain-viewport" (surface), "terrain-inspector".
    [[nodiscard]] PanelDockspace &QueryPanels() noexcept { return Panels; }
    void ConfigurePlatform() { (void)Panels.ConfigurePlatform(); }

  protected:
    bool InitializeContent() noexcept override;
    void IntegrateContent(double DeltaSeconds) noexcept override;
    void FinalizeContent() noexcept override;

  private:
    //--------------------------------------------------------------------------------------------------------------
    //                                                 BRUSH STATE
    //--------------------------------------------------------------------------------------------------------------
    // 💡 Brushes never touch bricks directly. A stroke accumulates hit points against the extracted
    //    surface; on release it finalizes into one Sculpt/Carve/Stamp stratum whose parameters are
    //    the stroke polyline + radius profile. Re-routing a cave is then a parameter edit, and
    //    undo is a document snapshot away — the PaintStampEngine discipline, in three dimensions.
    enum class TerrainBrushCategory : uint32_t
    {
        SculptRaise,
        SculptLower,
        SculptSmooth,
        SculptFlatten,
        CarveTunnel,
        StampFormation,
        MaterialPaint,
        MaskPaint
    };

    struct BrushConfiguration
    {
        TerrainBrushCategory Category = TerrainBrushCategory::SculptRaise; // [-] - Active instrument
        float RadiusMeters            = 12.0f; // [m] - Brush footprint radius at the hit point
        float Strength                = 0.6f;  // [0-1] - Per-dab field displacement scale
        float FalloffExponent         = 2.0f;  // [-] - Radial falloff shaping
        float SpacingFraction         = 0.25f; // [-] - Dab spacing as a fraction of radius
        std::string StampOperation;            // [-] - Primitive key for StampFormation
        std::string TargetMaskStratum;         // [-] - MaskPaint destination (stratum name)
    };

    struct HistoryEntry
    {
        std::string Caption;   // [utf8] - History row caption ("Carve tunnel", "Erosion bake", ...)
        uint64_t Revision = 0; // [-] - Document revision this snapshot restores
    };

    void ConstructLayerStack(float Scale);
    void ConstructViewport(float Scale);
    void ConstructInspector(float Scale);
    void ConstructStratumRow(int32_t StratumIndex, float Scale);
    void ConstructMaskStack(int32_t StratumIndex, float Scale);
    void ConstructOperationDropdown(int32_t StratumIndex, float Scale);
    void ConstructChannelDropdown(const std::string &ParameterKey, float Scale);
    void IntegrateBrushStroke(double DeltaSeconds);
    void FinalizeBrushStroke();
    void RefreshExtraction(); // re-extracts bricks inside the consumed invalidated region
    void RecordHistorySnapshot(std::string Caption);

    PanelDockspace Panels;
    StratumOperationRegistry Registry;
    TerrainWorldConfiguration World;
    StratumSequence Sequence;
    DensityFieldEvaluation Evaluation;
    DualContourExtraction Extraction;
    ShallowWaterSimulation Simulation;
    BrushConfiguration Brush;

    std::string DocumentName = "Untitled terrain";
    std::filesystem::path DocumentPath;
    std::vector<HistoryEntry> HistoryEntries;
    std::vector<WorldPosition> StrokePoints; // [m] - Live stroke polyline (world space)
    int32_t SelectedStratum  = -1;           // [idx] - Inspector target; −1 = world configuration
    size_t ExtractedTriangles = 0;           // [-] - Viewport readout after the last refresh
    float InterfaceScale     = 1.0f;         // [-] - Host interface scale
    bool StrokeActive        = false;        // [-] - Pointer is down in the viewport with a brush
    void *RegularTypeface    = nullptr;      // [-] - Shared "DM Sans" regular handle
    void *LightTypeface      = nullptr;      // [-] - Shared "DM Sans" light handle
};

} // namespace Frontier
