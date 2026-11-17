/*==========================================================================================================================================
                                                       PARTICLEEDITORWORKSPACE.H
==========================================================================================================================================*/
// 🧩 The Particle editor as the approved prototype lays it out: the Outliner (environment and effects), the viewport (the GPU image,
//    its HUD, probe, minimap and field overlay), the Log Stream, the Inspector and the preset library.

#pragma once

#include "Engine/Diagnostics/BuildConfiguration.h"

#if FRONTIER_EDITOR && defined(FRONTIER_WITH_INTERFACE_SDK)

#include "Engine/Interface/ParticleEditor/ParticleEditorPages.h"

#include <imgui.h>

#include <array>
#include <chrono>
#include <filesystem>
#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace Frontier
{

struct ParticleLogLine
{
    std::string Time;
    std::string Category;
    std::string Text;
    std::string Detail;
    bool        Warm = false;
};

class ParticleEditorWorkspace
{
public:
    explicit ParticleEditorWorkspace(const std::filesystem::path& LibraryFile);
    ~ParticleEditorWorkspace();

    // 📝 The .particlespace file the space lives in (a Particles record's). The space is read from it, or written there from the
    //    library's opening space when the file does not exist yet; attaching another file first writes the current one back.
    bool AttachSpaceFile(const std::filesystem::path& File);
    // 📝 Writes the space to its file when it changed since it was read or written; true when the file holds the space.
    bool SaveSpaceFile();
    [[nodiscard]] const std::filesystem::path& QuerySpaceFile() const noexcept { return SpaceFile; }
    // 📝 True when the space differs from its file (checked at most twice a second).
    [[nodiscard]] bool QuerySpaceChanged();

    // 📝 One interface tick: advances the space by DeltaSeconds, asks the presenter for the image and lays the editor out in the
    //    rectangle (the editor window's body).
    void Construct(ImVec2 Minimum, ImVec2 Maximum, float Scale, double DeltaSeconds);

    // 📝 The verbs the pages and the captures use: "select:<token>", "add:<preset>", "duplicate:<token>", "remove:<token>",
    //    "rebuild:<token>", "add-force:<category>", "remove-force:<index>", "reset", "strike", "pause", "play", "time-scale:<x>",
    //    "library:on|off", "overlay:on|off", "contribution:flow|accelerate|damp", "camera:<yaw>,<pitch>,<distance>", "top-view",
    //    "save", "save:<file>", "load:<file>".
    bool Perform(std::string_view Action);

    [[nodiscard]] ParticleSpace&               AccessSpace() noexcept { return Space; }
    [[nodiscard]] const ParticleEffectLibrary& QueryLibrary() const noexcept { return Library; }
    [[nodiscard]] const ParticleViewportImage& QueryImage() const noexcept { return Image; }
    [[nodiscard]] const std::string&           QueryDiagnostic() const noexcept { return Diagnostic; }
    [[nodiscard]] bool                         QueryLibraryShown() const noexcept { return LibraryShown; }
    [[nodiscard]] const std::vector<ParticleLogLine>& QueryLog() const noexcept { return Log; }

    ParticleViewportPresenter Presenter;
    ParticleFieldOverlay      Overlay;
    // 📝 The active level's native ForceFieldSpace snapshot, shared with this Particle refresh when LevelWind.Follow is on.
    //    The callback queries InspectorRuntime at use time, so it never retains a destroyed level workspace.
    std::function<std::shared_ptr<const IFieldSampler>()> LevelFieldSampler;
    bool LevelFieldAvailable = false;

private:
    void ConstructOutliner(ImDrawList* Ink, ImVec2 Minimum, ImVec2 Maximum, float Scale);
    void ConstructViewport(ImDrawList* Ink, ImVec2 Minimum, ImVec2 Maximum, float Scale);
    void ConstructLogStream(ImDrawList* Ink, ImVec2 Minimum, ImVec2 Maximum, float Scale);
    void ConstructInspector(ImVec2 Minimum, ImVec2 Maximum, float Scale);
    void ConstructLibrarySheet(ImDrawList* Ink, ImVec2 Minimum, ImVec2 Maximum, float Scale);
    void Present(uint32_t Width, uint32_t Height, double DeltaSeconds);
    void AppendLog(std::string Category, std::string Text, std::string Detail = {}, bool Warm = false);

    ParticleEffectLibrary        Library;
    ParticleSpace                Space;
    ParticleRefreshPlan          Plan;
    ParticleViewportImage        Image;
    std::vector<std::string>     Requests;
    std::vector<ParticleLogLine> Log;
    std::string                  Diagnostic;
    std::string                  LibraryGroup = "All";
    char                         LibraryQuery[64] = {};
    bool                         LibraryShown = false;
    bool                         Planned      = false;
    double                       LatticeClock = 1.0;   // [s] since the last lattice readback
    std::array<uint32_t, 2>      ViewExtent{ 960u, 540u };
    std::chrono::steady_clock::time_point Opened = std::chrono::steady_clock::now();
    std::filesystem::path                 SpaceFile;
    std::string                           SavedText;            // the encoded space as its file holds it
    bool                                  Changed      = false;
    double                                ChangeClock  = 1.0;   // [s] since the last comparison
};

} // namespace Frontier

#endif
