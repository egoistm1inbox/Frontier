/*============================================================================================================================================
                                             PARAMETRICSKETCHERWORKSPACEVALIDATION.CPP
============================================================================================================================================*/
// 🧩 Deterministic visual proof for the native Parametric Sketcher host: target CAD chrome, persistent outliner selection, inspector, and GPU-reserved viewport

#include "Engine/Components/PixelSpace.h"
#include "Engine/Workspaces/ParametricSketcher/ParametricSketcherWorkspaceHost.h"
#include "Exhibits/SoftwareCanvasRasterizer.h"

#include <imgui.h>

#include <cstdio>
#include <filesystem>

namespace
{

[[nodiscard]] bool VerifyCondition(bool Condition, const char* Description) noexcept
{
    if (!Condition)
    {
        std::fprintf(stderr, "[ParametricSketcherWorkspaceValidation] FAILED: %s\n", Description);
        return false;
    }
    return true;
}

} // namespace

int main()
{
    constexpr uint32_t CanvasWidthPx  = 1600u;
    constexpr uint32_t CanvasHeightPx = 980u;

    ImGuiContext* GuiContext = ImGui::CreateContext();
    ImGui::SetCurrentContext(GuiContext);
    ImGuiIO& Io = ImGui::GetIO();
    Io.DisplaySize = { static_cast<float>(CanvasWidthPx), static_cast<float>(CanvasHeightPx) };
    Io.DeltaTime = 1.0f / 60.0f;
    unsigned char* FontPixels = nullptr;
    int FontWidth = 0;
    int FontHeight = 0;
    Io.Fonts->GetTexDataAsRGBA32(&FontPixels, &FontWidth, &FontHeight);

    Frontier::Workspaces::ParametricSketcher::ParametricSketcherWorkspaceHost Workspace{};
    const Frontier::Rectangle2D WindowBounds { 0.0f, 0.0f, static_cast<float>(CanvasWidthPx), static_cast<float>(CanvasHeightPx) };
    Frontier::ContentBrowserPointerInput SelectBody{};
    SelectBody.CursorX = 120.0f;
    SelectBody.CursorY = 170.0f;
    SelectBody.Pressed = true;

    ImGui::NewFrame();
    Frontier::PixelSpace Surface(ImGui::GetForegroundDrawList(), { 0.0f, 0.0f }, 1.0f);
    Workspace.RenderStudio(Surface, WindowBounds, SelectBody);
    ImGui::Render();

    const auto& Session = Workspace.InspectSession();
    const std::filesystem::path OutputPath =
        std::filesystem::path(FRONTIER_REPO_ROOT_DIR) / "Exhibits/Images/ParametricSketcher/WorkspaceHost.png";
    std::error_code IoFailure;
    std::filesystem::create_directories(OutputPath.parent_path(), IoFailure);
    Frontier::Exhibits::SoftwareRasterCanvas Canvas(
        CanvasWidthPx,
        CanvasHeightPx,
        { 12u, 16u, 22u, 255u });
    Canvas.RasterizeImGuiBatches(ImGui::GetDrawData());
    const bool WroteImage = !IoFailure && Canvas.EncodePngToFile(OutputPath);

    const bool Passed =
        VerifyCondition(Session.InspectDocument().Profiles.size() == 1u, "Host presents starter SketchProfile") &&
        VerifyCondition(Session.InspectDocument().Bodies.size() == 1u, "Host presents starter PrismaticBody") &&
        VerifyCondition(Session.QuerySelectedBodyOrdinal() == Session.InspectDocument().Bodies.front().BodyOrdinal,
                        "Host outliner click selects persistent PrismaticBody") &&
        VerifyCondition(WroteImage, "Encoded Parametric Sketcher workspace visual proof");

    ImGui::DestroyContext(GuiContext);
    if (!Passed)
    {
        return 1;
    }

    std::printf("[ParametricSketcherWorkspaceValidation] PASS: selectedBody=%u, exhibit=%s\n",
                Session.QuerySelectedBodyOrdinal(), OutputPath.string().c_str());
    return 0;
}
