/*==========================================================================================================================================
                                                          EVERESTWORKSPACE.H
==========================================================================================================================================*/
// 🧩 1:1 VehicleHMI Proving Grounds workspace hosted on PanelDockspace, ControlCentrePanel, LogStreamPanel, and InspectorCatalogue.

#pragma once

#include "Engine/Interface/LogStreamPanel.h"
#include "Engine/Interface/PanelDockspace.h"
#include "EverestSceneAssembly.h"
#include "UI/Editor/ControlCentrePanel.h"

#include <imgui.h>

#include <array>
#include <cstdint>
#include <functional>
#include <string>
#include <unordered_set>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                   EVEREST WORKSPACE
//------------------------------------------------------------------------------------------------------------------------

class EverestWorkspace
{
  public:
    explicit EverestWorkspace(ControlCentrePanel &ControlCentreHost);
    ~EverestWorkspace();

    EverestWorkspace(const EverestWorkspace &)            = delete;
    EverestWorkspace &operator=(const EverestWorkspace &) = delete;

    bool ConfigurePlatform() noexcept;
    void SynchronizeSimulation(double DeltaSeconds);
    void ConstructInterface();

    void SelectRecord(RecordToken Token) noexcept;
    [[nodiscard]] RecordToken QuerySelectedRecord() const noexcept { return SelectedRecordToken; }

    void OpenDedicatedStudio(DedicatedStudioDomain Studio);
    void CloseDedicatedStudio() noexcept { ActiveStudioWorkbench = DedicatedStudioDomain::None; }
    [[nodiscard]] DedicatedStudioDomain QueryActiveStudio() const noexcept { return ActiveStudioWorkbench; }

    [[nodiscard]] PanelDockspace       &QueryPanels() noexcept { return Panels; }
    [[nodiscard]] LogStreamPanel       &QueryLogStream() noexcept { return StreamPanel; }
    [[nodiscard]] EverestSceneAssembly &QueryScene() noexcept { return Scene; }

    std::function<void()> EvaluateReturnToBrowser;

  private:
    void SeedInitialLogTraffic();
    void ConstructOutlinerPanel();
    void ConstructSceneViewportPanel();
    void ConstructInspectorPanel();
    void ConstructBottomStatusStrip(float Scale);
    void PaintSynthesizedProvingGroundsViewport(ImDrawList *Canvas, ImVec2 CanvasMin, ImVec2 CanvasMax);

    ControlCentrePanel              &Centre;
    PanelDockspace                   Panels;
    LogStreamPanel                   StreamPanel;
    EverestSceneAssembly             Scene;
    RecordToken                      SelectedRecordToken{};
    std::array<char, 128>            OutlinerSearchBuffer{};
    std::unordered_set<std::string>  CollapsedOutlinerGroups;
    DedicatedStudioDomain            ActiveStudioWorkbench = DedicatedStudioDomain::None;
    bool                             CleanViewportActive   = false;
    double                           ElapsedSeconds      = 0.0;
    uint64_t                         SimulatedTickIndex  = 1420u;
    uint32_t                         IlluminationLogToken = 0u;
    uint32_t                         DrivetrainLogToken   = 0u;
    uint32_t                         TyreLogToken         = 0u;
    uint32_t                         AtmosphereLogToken   = 0u;
    uint32_t                         DestructionLogToken  = 0u;
};

} // namespace Frontier
