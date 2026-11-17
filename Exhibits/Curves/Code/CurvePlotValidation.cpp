#include "Frontier/Engine/Interface/Controls/ControlColumn.h"
#include "Frontier/Engine/Interface/Controls/CurvePlot.h"
#include "Frontier/Engine/Interface/Controls/ControlTheme.h"
#include "Frontier/Engine/Interface/InspectorControls.h"
#include "Exhibits/ControlCentre/Code/CpuRasterization.h"

#include <imgui.h>

#include <cmath>
#include <cstdio>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace
{

void Confirm(bool Condition, const char* Description)
{
    if (!Condition) throw std::runtime_error(Description);
}

struct CurvePlotExtent
{
    ImVec2 Minimum{};
    ImVec2 Maximum{};
};

} // namespace

int main(int ArgumentCount, char** Arguments)
{
    using namespace Frontier;
    try
    {
        ImGui::CreateContext();
        ImGui::StyleColorsDark();
        ImGuiIO& IO = ImGui::GetIO();
        IO.DisplaySize = ImVec2(900.0f, 700.0f);
        IO.DeltaTime = 1.0f / 60.0f;
        IO.Fonts->AddFontDefault();
        IO.Fonts->Build();

        CurveSpecification Specification{
            "UI foundation curve", CurveInterpolation::Linear,
            { { 0.0, 0.0 }, { 0.5, 0.5 }, { 1.0, 1.0 } }
        };
        const ControlTheme Theme = ControlTheme::ResolveCloud();
        const EditorTypefaces Faces{};
        bool Changed = false;
        CurvePlotExtent Extent;
        const auto Frame = [&]()
        {
            ImGui::NewFrame();
            ImGui::SetNextWindowPos(ImVec2(0.0f, 0.0f));
            ImGui::SetNextWindowSize(IO.DisplaySize);
            ImGui::Begin("CurvePlotValidation", nullptr, ImGuiWindowFlags_NoDecoration);
            ControlColumn Column(Theme, Faces, 1.0f);
            Changed = CurvePlot::Construct(Column, "FalloffCurve", Specification);
            Extent = { ImGui::GetItemRectMin(), ImGui::GetItemRectMax() };
            Column.Finalize();
            ImGui::End();
            ImGui::Render();
        };
        const auto Capture = [&]()
        {
            if (ArgumentCount < 2) return;
            FrontierExhibit::AcknowledgeTextures();
            const int Width = static_cast<int>(IO.DisplaySize.x * IO.DisplayFramebufferScale.x);
            const int Height = static_cast<int>(IO.DisplaySize.y * IO.DisplayFramebufferScale.y);
            std::vector<unsigned char> Pixels(static_cast<size_t>(Width) * Height * 3, 0x18);
            const ImDrawData* DrawData = ImGui::GetDrawData();
            for (const ImDrawList* DrawList : DrawData->CmdLists)
                FrontierExhibit::RasterizeCommands(DrawList, Pixels.data(), Width, Height, DrawData->DisplayPos,
                                                   DrawData->FramebufferScale);
            std::ofstream Image(Arguments[1], std::ios::binary);
            Image << "P6\n" << Width << ' ' << Height << "\n255\n";
            Image.write(reinterpret_cast<const char*>(Pixels.data()), static_cast<std::streamsize>(Pixels.size()));
            if (!Image) throw std::runtime_error("Could not write CurvePlot PPM evidence");
        };

        Frame();
        Confirm(!Changed && Specification.Knots[1].Output == 0.5, "Initial display mutated the curve");
        const float Scale = (Extent.Maximum.x - Extent.Minimum.x) / 640.0f;
        const ImVec2 Middle(Extent.Minimum.x + 337.0f * Scale, Extent.Minimum.y + 119.0f * Scale);
        IO.AddMousePosEvent(Middle.x, Middle.y);
        Frame();
        IO.AddMouseButtonEvent(ImGuiMouseButton_Left, true);
        Frame();
        IO.AddMousePosEvent(Middle.x, Middle.y - 30.0f * Scale);
        Frame();
        const bool DragChanged = Changed;
        IO.AddMouseButtonEvent(ImGuiMouseButton_Left, false);
        Frame();
        Capture();
        Confirm(DragChanged && Specification.Knots[1].Output > 0.5,
                "Dragging a knot did not update the authored curve and its preview source");
        Confirm(Specification.Knots.front().Input == 0.0 && Specification.Knots.back().Input == 1.0,
                "Dragging an interior knot changed the endpoint domain");

        const double PriorOutput = Specification.Knots[1].Output;
        Specification.Interpolation = CurveInterpolation::MonotonicPchip;
        Frame();
        const float CanvasScale = (Extent.Maximum.x - Extent.Minimum.x) / 640.0f;
        const double VisibleMinimum = -0.12;
        const double VisibleMaximum = 1.12;
        const float KnotY = 222.0f - static_cast<float>((PriorOutput - VisibleMinimum) /
            (VisibleMaximum - VisibleMinimum)) * 206.0f;
        const ImVec2 KnotAt(Extent.Minimum.x + 337.0f * CanvasScale, Extent.Minimum.y + KnotY * CanvasScale);
        IO.AddMousePosEvent(KnotAt.x, KnotAt.y);
        Frame();
        IO.AddMouseButtonEvent(ImGuiMouseButton_Left, true);
        Frame();
        IO.AddMousePosEvent(KnotAt.x, Extent.Minimum.y + 17.0f * CanvasScale);
        Frame();
        IO.AddMouseButtonEvent(ImGuiMouseButton_Left, false);
        Frame();
        Confirm(std::abs(Specification.Knots[1].Output - PriorOutput) < 1.0e-12,
                "A non-monotone PCHIP edit was not rejected transactionally");

        std::fprintf(stdout, "CurvePlotValidation: interactive knot drag and transactional PCHIP rejection passed\n");
        ImGui::DestroyContext();
        return 0;
    }
    catch (const std::exception& Failure)
    {
        ImGui::DestroyContext();
        std::fprintf(stderr, "CurvePlotValidation: %s\n", Failure.what());
        return 1;
    }
}
