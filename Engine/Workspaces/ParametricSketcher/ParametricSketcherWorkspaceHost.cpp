/*============================================================================================================================================
                                               PARAMETRICSKETCHERWORKSPACEHOST.CPP
============================================================================================================================================*/
// 🧩 Native Parametric Sketcher CAD shell: target dock proportions, profile/body outliner, inspector, and GPU-reserved viewport host

#include "Engine/Workspaces/ParametricSketcher/ParametricSketcherWorkspaceHost.h"

#include "Engine/Components/Controls/ControlAppearance.h"

#include <algorithm>
#include <cstdio>

namespace Frontier::Workspaces::ParametricSketcher
{

namespace
{

[[nodiscard]] ControlPointer ConstructPointer(const ContentBrowserPointerInput& Input) noexcept
{
    ControlPointer Pointer{};
    Pointer.X       = Input.CursorX;
    Pointer.Y       = Input.CursorY;
    Pointer.Down    = Input.HeldDown;
    Pointer.Pressed = Input.Pressed;
    Pointer.Released = Input.Released;
    Pointer.Enabled = true;
    return Pointer;
}

void DrawPanelTitle(PixelSpace& Surface, Rectangle2D Bounds, const char* Title, const char* Caption) noexcept
{
    Surface.Text({ Bounds.X + 16.0f, Bounds.Y + 14.0f }, 15.0f, { 232u, 239u, 246u, 255u }, Title);
    Surface.Text({ Bounds.X + 16.0f, Bounds.Y + 34.0f }, 8.8f, { 132u, 150u, 171u, 255u }, Caption);
    Surface.StrokeLine({ Bounds.X + 12.0f, Bounds.Y + 52.0f }, { Bounds.Right() - 12.0f, Bounds.Y + 52.0f }, { 255u, 255u, 255u, 18u }, 1.0f);
}

} // namespace

void ParametricSketcherWorkspaceHost::RenderStudio(
    PixelSpace&                       Surface,
    Rectangle2D                       WindowBounds,
    const ContentBrowserPointerInput& PointerInput) noexcept
{
    const ControlPointer Pointer = ConstructPointer(PointerInput);
    Surface.FillRectangle(WindowBounds, { 12u, 16u, 22u, 255u }, 0.0f);

    constexpr float ApplicationBarHeight = 52.0f;
    constexpr float StatusRailHeight     = 28.0f;
    constexpr float ViewportStripHeight  = 45.0f;
    constexpr float LeftDockWidth        = 244.0f;
    constexpr float RightDockWidth       = 278.0f;
    constexpr float Gap                  = 2.0f;

    const Rectangle2D ApplicationBar { WindowBounds.X, WindowBounds.Y, WindowBounds.Width, ApplicationBarHeight };
    const Rectangle2D StatusRail { WindowBounds.X, WindowBounds.Bottom() - StatusRailHeight, WindowBounds.Width, StatusRailHeight };
    const Rectangle2D WorkspaceArea {
        WindowBounds.X,
        ApplicationBar.Bottom() + Gap,
        WindowBounds.Width,
        std::max(120.0f, WindowBounds.Height - ApplicationBarHeight - StatusRailHeight - Gap * 2.0f)
    };
    const Rectangle2D Outliner { WorkspaceArea.X, WorkspaceArea.Y, LeftDockWidth, WorkspaceArea.Height };
    const Rectangle2D Inspector { WorkspaceArea.Right() - RightDockWidth, WorkspaceArea.Y, RightDockWidth, WorkspaceArea.Height };
    const Rectangle2D Viewport {
        Outliner.Right() + Gap,
        WorkspaceArea.Y,
        std::max(240.0f, Inspector.X - Outliner.Right() - Gap * 2.0f),
        WorkspaceArea.Height
    };

    Surface.FillRectangle(ApplicationBar, { 20u, 26u, 35u, 255u }, 0.0f);
    Surface.Text({ ApplicationBar.X + 18.0f, ApplicationBar.Y + 16.0f }, 14.0f, { 138u, 226u, 185u, 255u }, "PARAMETRIC SKETCHER");
    Surface.Text({ ApplicationBar.X + 206.0f, ApplicationBar.Y + 18.0f }, 10.0f, { 150u, 171u, 195u, 255u }, "SKETCH  /  SOLID  /  INSPECT");
    Surface.TextRightAligned({ ApplicationBar.X, ApplicationBar.Y + 18.0f, ApplicationBar.Width - 18.0f, 16.0f }, 9.4f, { 241u, 202u, 103u, 255u }, "NATIVE .SKETCH");

    Surface.FillRectangle(Outliner, { 22u, 28u, 37u, 255u }, 0.0f);
    DrawPanelTitle(Surface, Outliner, "Outliner", "PARAMETRIC DOCUMENT");
    float RowY = Outliner.Y + 65.0f;
    for (const ::Frontier::ParametricSketcher::SketchProfile& Profile : Session.InspectDocument().Profiles)
    {
        const Rectangle2D Row { Outliner.X + 8.0f, RowY, Outliner.Width - 16.0f, 34.0f };
        const bool Selected = Session.QuerySelectedProfileOrdinal() == Profile.ProfileOrdinal &&
                              Session.QuerySelectedBodyOrdinal() == ::Frontier::ParametricSketcher::InvalidSketchOrdinal;
        const bool Hovered = ControlAppearance::QueryPointerOver(Row, Pointer);
        Surface.FillRectangle(Row, Selected ? ColorRgba { 51u, 99u, 145u, 96u } : (Hovered ? ColorRgba { 255u, 255u, 255u, 12u } : ColorRgba { 0u, 0u, 0u, 0u }), 6.0f);
        Surface.Text({ Row.X + 10.0f, Row.Y + 7.0f }, 10.5f, { 103u, 178u, 255u, 255u }, "◇");
        Surface.Text({ Row.X + 28.0f, Row.Y + 7.0f }, 10.5f, { 224u, 232u, 241u, 255u }, Profile.ProfileTitle.c_str());
        if (Hovered && Pointer.Pressed) Session.SelectProfile(Profile.ProfileOrdinal);
        RowY += 36.0f;
    }
    for (const ::Frontier::ParametricSketcher::PrismaticBody& Body : Session.InspectDocument().Bodies)
    {
        const Rectangle2D Row { Outliner.X + 8.0f, RowY, Outliner.Width - 16.0f, 34.0f };
        const bool Selected = Session.QuerySelectedBodyOrdinal() == Body.BodyOrdinal;
        const bool Hovered = ControlAppearance::QueryPointerOver(Row, Pointer);
        Surface.FillRectangle(Row, Selected ? ColorRgba { 80u, 156u, 214u, 96u } : (Hovered ? ColorRgba { 255u, 255u, 255u, 12u } : ColorRgba { 0u, 0u, 0u, 0u }), 6.0f);
        char Caption[96] {};
        std::snprintf(Caption, sizeof(Caption), "Prismatic Body %u", Body.BodyOrdinal);
        Surface.Text({ Row.X + 10.0f, Row.Y + 7.0f }, 10.5f, { 128u, 226u, 181u, 255u }, "◆");
        Surface.Text({ Row.X + 28.0f, Row.Y + 7.0f }, 10.5f, { 224u, 232u, 241u, 255u }, Caption);
        if (Hovered && Pointer.Pressed) Session.SelectBody(Body.BodyOrdinal);
        RowY += 36.0f;
    }

    Surface.FillRectangle(Inspector, { 22u, 28u, 37u, 255u }, 0.0f);
    DrawPanelTitle(Surface, Inspector, "Inspector", "EXACT PARAMETRIC STATE");
    const auto& Document = Session.InspectDocument();
    char ProfileCount[64] {}, BodyCount[64] {}, RevisionCount[64] {};
    std::snprintf(ProfileCount, sizeof(ProfileCount), "Profiles       %zu", Document.Profiles.size());
    std::snprintf(BodyCount, sizeof(BodyCount), "Prismatic bodies  %zu", Document.Bodies.size());
    std::snprintf(RevisionCount, sizeof(RevisionCount), "Revision entries  %u", Session.InspectRevisionHistory().QueryLiveStepCount());
    Surface.Text({ Inspector.X + 16.0f, Inspector.Y + 74.0f }, 10.8f, { 232u, 239u, 246u, 255u }, ProfileCount);
    Surface.Text({ Inspector.X + 16.0f, Inspector.Y + 102.0f }, 10.8f, { 232u, 239u, 246u, 255u }, BodyCount);
    Surface.Text({ Inspector.X + 16.0f, Inspector.Y + 130.0f }, 10.8f, { 157u, 171u, 188u, 255u }, RevisionCount);
    Surface.Text({ Inspector.X + 16.0f, Inspector.Y + 180.0f }, 9.6f, { 128u, 226u, 181u, 255u }, "MatCap assignments retained");
    Surface.Text({ Inspector.X + 16.0f, Inspector.Y + 202.0f }, 9.6f, { 157u, 171u, 188u, 255u }, "Face edits resolve through GPU picks");

    Surface.FillRectangle(Viewport, { 15u, 20u, 28u, 255u }, 0.0f);
    const Rectangle2D Strip { Viewport.X, Viewport.Y, Viewport.Width, ViewportStripHeight };
    Surface.FillRectangle(Strip, { 25u, 32u, 43u, 255u }, 0.0f);
    Surface.Text({ Strip.X + 14.0f, Strip.Y + 14.0f }, 10.5f, { 180u, 203u, 229u, 255u }, "CAD VIEWPORT");
    Surface.Text({ Strip.X + 124.0f, Strip.Y + 14.0f }, 9.0f, { 128u, 226u, 181u, 255u }, "MATCAP  ·  PICK  ·  GIZMO");
    Surface.StrokeRectangle({ Viewport.X + 18.0f, Viewport.Y + 66.0f, Viewport.Width - 36.0f, Viewport.Height - 90.0f }, { 103u, 178u, 255u, 68u }, 8.0f, 1.0f);
    Surface.TextCentered({ Viewport.X, Viewport.Y + Viewport.Height * 0.46f, Viewport.Width, 20.0f }, 13.0f, { 157u, 171u, 188u, 255u }, "GPU CAD surface viewport");
    Surface.TextCentered({ Viewport.X, Viewport.Y + Viewport.Height * 0.46f + 22.0f, Viewport.Width, 16.0f }, 9.6f, { 112u, 132u, 156u, 255u }, "Derived PolygonNetwork upload and R32G32B32A32_UINT pick target reserved");

    Surface.FillRectangle(StatusRail, { 20u, 26u, 35u, 255u }, 0.0f);
    Surface.Text({ StatusRail.X + 14.0f, StatusRail.Y + 8.0f }, 9.2f, { 128u, 226u, 181u, 255u }, Session.QueryStatusText().c_str());
    Surface.TextRightAligned({ StatusRail.X, StatusRail.Y + 8.0f, StatusRail.Width - 14.0f, 12.0f }, 9.0f, { 157u, 171u, 188u, 255u }, "Right-handed Z-up  |  metres");
}

} // namespace Frontier::Workspaces::ParametricSketcher
