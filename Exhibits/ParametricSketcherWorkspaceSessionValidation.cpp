/*============================================================================================================================================
                                         PARAMETRICSKETCHERWORKSPACESESSIONVALIDATION.CPP
============================================================================================================================================*/
// 🧩 Native Parametric Sketcher workspace-session routing, authored feature, revision, .Sketch persistence, and display-network proof

#include "Engine/Workspaces/ParametricSketcher/ParametricSketcherWorkspaceSession.h"
#include "Engine/Workspaces/WorkspaceCapabilityRegister.h"

#include <cstdio>
#include <filesystem>
#include <string>

namespace
{

[[nodiscard]] bool VerifyCondition(bool ConditionMet, const char* Description) noexcept
{
    if (!ConditionMet)
    {
        std::fprintf(stderr, "[ParametricSketcherWorkspaceSessionValidation] FAILED: %s\n", Description);
        return false;
    }
    return true;
}

} // namespace

int main()
{
    using namespace Frontier;

    Workspaces::WorkspaceCapabilityRegister Capabilities{};
    const Workspaces::WorkspaceCapabilityEntry* ParametricSketcher =
        Capabilities.FindByTarget(Workspaces::HostWorkspaceTarget::ParametricSketcher);
    const auto SketchTargets = Capabilities.QueryPermittedForPath("PhaseTwo.Sketch");
    if (!VerifyCondition(ParametricSketcher != nullptr, "Registered ParametricSketcher workspace capability") ||
        !VerifyCondition(ParametricSketcher->Identifier == "ParametricSketcher", "Uses stable ParametricSketcher capability identifier") ||
        !VerifyCondition(ParametricSketcher->ActionTitle == "Open with Parametric Sketcher", "Uses Parametric Sketcher user-facing workspace title") ||
        !VerifyCondition(!SketchTargets.empty() && SketchTargets.front().Target == Workspaces::HostWorkspaceTarget::ParametricSketcher,
                         ".Sketch routes first to Parametric Sketcher"))
    {
        return 1;
    }

    Workspaces::ParametricSketcher::ParametricSketcherWorkspaceSession Session{};
    if (!VerifyCondition(Session.InspectDocument().Profiles.size() == 1u, "Session creates a native starter SketchProfile") ||
        !VerifyCondition(Session.InspectDocument().Bodies.size() == 1u, "Session creates a native starter PrismaticBody") ||
        !VerifyCondition(Session.InspectDerivedNetworks().size() == 1u, "Session derives one target PolygonNetwork") ||
        !VerifyCondition(Session.InspectDerivedNetworks().front().VerifyNetworkIntegrity(), "Derived session network keeps Frontier half-edge integrity") ||
        !VerifyCondition(!Session.InspectRevisionHistory().QueryModifiedSinceSave(), "Starter document starts at a saved revision cursor"))
    {
        return 1;
    }

    std::string Diagnostic;
    const uint32_t SecondProfile = Session.ConstructRectangleSketch("SecondaryProfile", { 2.0f, -0.5f }, { 3.0f, 0.5f }, Diagnostic);
    if (!VerifyCondition(SecondProfile != ParametricSketcher::InvalidSketchOrdinal, "Session constructs an additional rectangular sketch") ||
        !VerifyCondition(Session.InspectRevisionHistory().QueryModifiedSinceSave(), "Compact revision records a new authored profile"))
    {
        return 1;
    }

    const std::filesystem::path ScratchPath = std::filesystem::temp_directory_path() / "FrontierParametricSketcherWorkspaceValidation.Sketch";
    std::error_code IoFailure;
    std::filesystem::remove(ScratchPath, IoFailure);
    if (!VerifyCondition(Session.SaveSketchDocument(ScratchPath, Diagnostic), "Session saves native .Sketch with revision sections"))
    {
        std::fprintf(stderr, "  Diagnostic: %s\n", Diagnostic.c_str());
        return 1;
    }

    Workspaces::ParametricSketcher::ParametricSketcherWorkspaceSession RestoredSession{};
    if (!VerifyCondition(RestoredSession.LoadSketchDocument(ScratchPath, Diagnostic), "Session loads native .Sketch plus revision history") ||
        !VerifyCondition(RestoredSession.InspectDocument().Profiles.size() == 2u, "Session restores authored profile count") ||
        !VerifyCondition(RestoredSession.InspectDocument().Bodies.size() == 1u, "Session restores authored prismatic body count") ||
        !VerifyCondition(RestoredSession.InspectDerivedNetworks().size() == 1u, "Session rebuilds derived target display network") ||
        !VerifyCondition(RestoredSession.InspectRevisionHistory().QueryLiveStepCount() >= 2u, "Session restores compact Parametric Sketcher revisions"))
    {
        std::fprintf(stderr, "  Diagnostic: %s\n", Diagnostic.c_str());
        return 1;
    }

    std::filesystem::remove(ScratchPath, IoFailure);
    std::printf("[ParametricSketcherWorkspaceSessionValidation] PASS: profiles=%zu, bodies=%zu, revisions=%u\n",
                RestoredSession.InspectDocument().Profiles.size(),
                RestoredSession.InspectDocument().Bodies.size(),
                RestoredSession.InspectRevisionHistory().QueryLiveStepCount());
    return 0;
}
