/*============================================================================================================================================
                                                PARAMETRICSKETCHERWORKSPACEHOST.H
============================================================================================================================================*/
// 🧩 Native Parametric Sketcher three-dock workspace chrome; CAD surface geometry remains exclusively owned by the forthcoming GPU viewport pass

#pragma once

#include "Engine/Components/ContentBrowser/ContentBrowserPanel.h"
#include "Engine/Components/PixelSpace.h"
#include "Engine/Workspaces/ParametricSketcher/ParametricSketcherWorkspaceSession.h"

namespace Frontier::Workspaces::ParametricSketcher
{

class ParametricSketcherWorkspaceHost
{
public:
    ParametricSketcherWorkspaceHost() = default;

    void RenderStudio(
        PixelSpace&                       Surface,
        Rectangle2D                       WindowBounds,
        const ContentBrowserPointerInput& PointerInput) noexcept;

    [[nodiscard]] ParametricSketcherWorkspaceSession&       AccessSession() noexcept { return Session; }
    [[nodiscard]] const ParametricSketcherWorkspaceSession& InspectSession() const noexcept { return Session; }

private:
    ParametricSketcherWorkspaceSession Session {};
};

} // namespace Frontier::Workspaces::ParametricSketcher
