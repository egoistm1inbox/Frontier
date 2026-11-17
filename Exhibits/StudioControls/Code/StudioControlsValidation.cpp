// Remastered Studio kit validation: SectionCard, SegmentedRow, VectorRow, TextRow, SliderPill, SwitchPill, Toast,
// and the 118 Studio glyph outlines. Headless ImGui with scripted pointer interaction and PPM evidence.

#include "Frontier/Engine/Interface/Controls/ControlColumn.h"
#include "Frontier/Engine/Interface/Controls/ControlTheme.h"
#include "Frontier/Engine/Interface/Controls/GlyphSymbol.h"
#include "Frontier/Engine/Interface/Controls/SectionCard.h"
#include "Frontier/Engine/Interface/Controls/SegmentedRow.h"
#include "Frontier/Engine/Interface/Controls/SliderPill.h"
#include "Frontier/Engine/Interface/Controls/SwitchPill.h"
#include "Frontier/Engine/Interface/Controls/TextRow.h"
#include "Frontier/Engine/Interface/Controls/Toast.h"
#include "Frontier/Engine/Interface/Controls/VectorRow.h"
#include "Frontier/Engine/Interface/InspectorControls.h"
#include "Exhibits/ControlCentre/Code/CpuRasterization.h"

#include <imgui.h>

#include <cstdio>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

static const char* StudioGlyphNames[] = {
    "StudioActivity",
    "StudioAlert",
    "StudioAperture",
    "StudioArchive",
    "StudioAtom",
    "StudioAttract",
    "StudioBlast",
    "StudioBoxes",
    "StudioBug",
    "StudioCheck",
    "StudioChevron",
    "StudioClock",
    "StudioClose",
    "StudioCloud",
    "StudioCompact",
    "StudioCompass",
    "StudioCopy",
    "StudioCrosshair",
    "StudioCurrent",
    "StudioDamp",
    "StudioDot",
    "StudioDownburst",
    "StudioDownload",
    "StudioDrop",
    "StudioEye",
    "StudioEyeOff",
    "StudioField",
    "StudioFlame",
    "StudioFlowLine",
    "StudioFocus",
    "StudioFolder",
    "StudioFracture",
    "StudioFront",
    "StudioGauge",
    "StudioGlobe",
    "StudioGravity",
    "StudioGrid",
    "StudioHelp",
    "StudioJet",
    "StudioLattice",
    "StudioLayers",
    "StudioLeaf",
    "StudioLibrary",
    "StudioLift",
    "StudioMagnet",
    "StudioMap",
    "StudioMaximize",
    "StudioMonitor",
    "StudioMove",
    "StudioOrbit",
    "StudioPalette",
    "StudioPause",
    "StudioPlanet",
    "StudioPlay",
    "StudioPlus",
    "StudioPuff",
    "StudioRays",
    "StudioRepel",
    "StudioReset",
    "StudioRuler",
    "StudioScan",
    "StudioSearch",
    "StudioSliders",
    "StudioSparkles",
    "StudioStep",
    "StudioSun",
    "StudioSwirl",
    "StudioTarget",
    "StudioTerminal",
    "StudioThermal",
    "StudioTornado",
    "StudioTrash",
    "StudioWake",
    "StudioWind",
    "StudioZap",
    "StudioFieldActivity",
    "StudioFieldAttract",
    "StudioFieldBlast",
    "StudioFieldCheck",
    "StudioFieldClock",
    "StudioFieldClose",
    "StudioFieldCloud",
    "StudioFieldCompass",
    "StudioFieldCopy",
    "StudioFieldCurrent",
    "StudioFieldDamp",
    "StudioFieldDownburst",
    "StudioFieldEye",
    "StudioFieldEyeOff",
    "StudioFieldField",
    "StudioFieldFlowLine",
    "StudioFieldFront",
    "StudioFieldGauge",
    "StudioFieldGlobe",
    "StudioFieldGravity",
    "StudioFieldJet",
    "StudioFieldLattice",
    "StudioFieldLayers",
    "StudioFieldLift",
    "StudioFieldMagnet",
    "StudioFieldMove",
    "StudioFieldOrbit",
    "StudioFieldPause",
    "StudioFieldPlay",
    "StudioFieldPlus",
    "StudioFieldPuff",
    "StudioFieldRepel",
    "StudioFieldReset",
    "StudioFieldRuler",
    "StudioFieldSparkles",
    "StudioFieldSwirl",
    "StudioFieldTarget",
    "StudioFieldThermal",
    "StudioFieldTornado",
    "StudioFieldTrash",
    "StudioFieldWake",
    "StudioFieldWind",
    "StudioFieldZap",
};

namespace
{

void Confirm(bool Condition, const char* Description)
{
    if (!Condition) throw std::runtime_error(Description);
}

struct StudioViewState
{
    bool        CardOpen   = true;
    bool        SecondOpen = false;
    int         Segment    = 0;
    double      Flow       = 18.0;
    bool        Enabled    = true;
    std::string Name       = "Wind Generator East";
    double      Centre[3]  = { -330.0, 0.0, 50.0 };
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
        IO.DisplaySize = ImVec2(1100.0f, 1250.0f);
        IO.DeltaTime = 1.0f / 60.0f;
        IO.Fonts->AddFontDefault();
        IO.Fonts->Build();

        const ControlTheme   Theme = ControlTheme::ResolveRemastered();
        const EditorTypefaces Faces{};
        StudioViewState      State{};
        ImVec2               LastMin{};
        ImVec2               LastMax{};
        int                  GlyphDrawn = 0;

        const auto BeginValidationFrame = [&]()
        {
            ImGui::NewFrame();
            ImGui::SetNextWindowPos(ImVec2(0.0f, 0.0f));
            ImGui::SetNextWindowSize(IO.DisplaySize);
            ImGui::Begin("StudioControlsValidation", nullptr, ImGuiWindowFlags_NoDecoration);
        };
        const auto EndValidationFrame = [&]()
        {
            LastMin = ImGui::GetItemRectMin();
            LastMax = ImGui::GetItemRectMax();
            ImGui::End();
            ImGui::Render();
        };
        const auto Click = [&](ImVec2 At)
        {
            IO.AddMousePosEvent(At.x, At.y);
            BeginValidationFrame();
            return At;
        };
        (void)Click;

        // 1. SectionCard toggles on header click and balances End in both conditions.
        const auto CardFrame = [&]()
        {
            BeginValidationFrame();
            ControlColumn Column(Theme, Faces, 1.0f);
            (void)SectionCard::Begin(Column, "Card", "Placement & Finite Influence", "StudioMove", "column", nullptr, State.CardOpen);
            SectionCard::End(Column);
            EndValidationFrame(); // 📝 No Finalize: its trailing Dummy would steal the last-item rect.
        };
        CardFrame();
        Confirm(State.CardOpen, "The card did not start open");
        const ImVec2 CardCentre(0.5f * (LastMin.x + LastMax.x), 0.5f * (LastMin.y + LastMax.y));
        IO.AddMousePosEvent(CardCentre.x, CardCentre.y);
        CardFrame();
        IO.AddMouseButtonEvent(ImGuiMouseButton_Left, true);
        CardFrame();
        IO.AddMouseButtonEvent(ImGuiMouseButton_Left, false);
        CardFrame();
        Confirm(!State.CardOpen, "Clicking the card header did not close the card");
        IO.AddMouseButtonEvent(ImGuiMouseButton_Left, true);
        CardFrame();
        IO.AddMouseButtonEvent(ImGuiMouseButton_Left, false);
        CardFrame();
        Confirm(State.CardOpen, "Clicking the card header did not reopen the card");

        // 2. SegmentedRow selects the clicked segment.
        const char* Shapes[3] = { "Sphere", "Column", "Box" };
        const auto SegmentFrame = [&]()
        {
            BeginValidationFrame();
            ControlColumn Column(Theme, Faces, 1.0f);
            (void)SegmentedRow::Construct(Column, "Shape", "Influence shape", Shapes, 3, State.Segment);
            EndValidationFrame(); // 📝 No Finalize: keep the target button as the last item.
        };
        SegmentFrame();
        const ImVec2 SegmentCentre(0.5f * (LastMin.x + LastMax.x), 0.5f * (LastMin.y + LastMax.y));
        IO.AddMousePosEvent(SegmentCentre.x, SegmentCentre.y);
        SegmentFrame();
        IO.AddMouseButtonEvent(ImGuiMouseButton_Left, true);
        SegmentFrame();
        IO.AddMouseButtonEvent(ImGuiMouseButton_Left, false);
        SegmentFrame();
        Confirm(State.Segment == 2, "Clicking the last segment did not select Box");

        // 3. SliderPill drags on the track and scrubs on the figure.
        const auto PillFrame = [&]()
        {
            BeginValidationFrame();
            ControlColumn Column(Theme, Faces, 1.0f);
            (void)SliderPill::Construct(Column, "Flow", "Peak flow", State.Flow, 0.0, 40.0, 0.5, "m/s");
            EndValidationFrame(); // 📝 No Finalize: keep the target button as the last item.
        };
        PillFrame();
        const ImVec2 TrackCentre(0.5f * (LastMin.x + LastMax.x), 0.5f * (LastMin.y + LastMax.y));
        IO.AddMousePosEvent(TrackCentre.x, TrackCentre.y);
        PillFrame();
        IO.AddMouseButtonEvent(ImGuiMouseButton_Left, true);
        PillFrame();
        IO.AddMousePosEvent(TrackCentre.x + 120.0f, TrackCentre.y);
        PillFrame();
        IO.AddMouseButtonEvent(ImGuiMouseButton_Left, false);
        PillFrame();
        Confirm(State.Flow > 18.0, "Dragging the pill track did not raise the figure");
        const double AfterTrack = State.Flow;
        const ImVec2 FigureCentre(LastMin.x - 10.0f - 92.0f + 29.0f, TrackCentre.y);
        IO.AddMousePosEvent(FigureCentre.x, FigureCentre.y);
        PillFrame();
        IO.AddMouseButtonEvent(ImGuiMouseButton_Left, true);
        PillFrame();
        IO.AddMousePosEvent(FigureCentre.x + 36.0f, FigureCentre.y);
        PillFrame();
        IO.AddMouseButtonEvent(ImGuiMouseButton_Left, false);
        PillFrame();
        Confirm(State.Flow > AfterTrack + 4.0, "Scrubbing the pill figure did not raise the figure by span/5");

        // 4. SwitchPill flips on click.
        const auto SwitchFrame = [&]()
        {
            BeginValidationFrame();
            ControlColumn Column(Theme, Faces, 1.0f);
            (void)SwitchPill::Construct(Column, "Enabled", "Enabled", "Acts in the field lattice", State.Enabled);
            EndValidationFrame(); // 📝 No Finalize: keep the target button as the last item.
        };
        SwitchFrame();
        const ImVec2 SwitchCentre(0.5f * (LastMin.x + LastMax.x), 0.5f * (LastMin.y + LastMax.y));
        IO.AddMousePosEvent(SwitchCentre.x, SwitchCentre.y);
        SwitchFrame();
        IO.AddMouseButtonEvent(ImGuiMouseButton_Left, true);
        SwitchFrame();
        IO.AddMouseButtonEvent(ImGuiMouseButton_Left, false);
        SwitchFrame();
        Confirm(!State.Enabled, "Clicking the switch did not turn it off");

        // 5. The full kit renders with text, vectors, glyphs, and a toast; idle rows stay quiet.
        State.CardOpen = true;
        State.Segment  = 1;
        State.Flow     = 18.0;
        State.Enabled  = true;
        Toast::Show("Placed Wind Generator East");
        Confirm(Toast::QueryVisible(), "The toast was not visible after Show");
        BeginValidationFrame();
        {
            ControlColumn Column(Theme, Faces, 1.0f);
            (void)SectionCard::Begin(Column, "Influence", "Placement & Finite Influence", "StudioMove", "column",
                                     "A continuous source at the domain centre. Height and radius stay live while rendering.",
                                     State.CardOpen);
            bool RowChanged = false;
            RowChanged |= SegmentedRow::Construct(Column, "Shape", "Influence shape", Shapes, 3, State.Segment);
            RowChanged |= SliderPill::Construct(Column, "Flow", "Peak flow", State.Flow, 0.0, 40.0, 0.5, "m/s");
            RowChanged |= SwitchPill::Construct(Column, "Enabled", "Enabled", "Acts in the field lattice", State.Enabled);
            RowChanged |= TextRow::Construct(Column, "Name", "Display name", State.Name);
            RowChanged |= VectorRow::Construct(Column, "Centre", "Centre position", "m", State.Centre, 2);
            SectionCard::End(Column);
            Confirm(!RowChanged, "Rendering the kit mutated its view state");
            (void)SectionCard::Begin(Column, "Closed", "Boundary falloff", "StudioGauge", "smooth", nullptr, State.SecondOpen);
            SectionCard::End(Column);

            constexpr int GlyphColumns = 14;
            const int     GlyphRows    = (118 + GlyphColumns - 1) / GlyphColumns;
            const ImVec2  GridTop      = Column.Space(56.0f * GlyphRows, 0.0f, 10.0f);
            ImDrawList* const DrawList = Column.QueryDrawList();
            const float       GridWide = Column.QueryWidth() / GlyphColumns;
            for (int Index = 0; Index < 118; ++Index)
            {
                const float CellX = GridTop.x + (Index % GlyphColumns) * GridWide;
                const float CellY = GridTop.y + (Index / GlyphColumns) * 56.0f;
                if (GlyphSymbol::Construct(DrawList, StudioGlyphNames[Index], ImVec2(CellX + 0.5f * (GridWide - 24.0f), CellY + 4.0f),
                                           24.0f, 1.65f, ResolveCssColour(0xD6D6D6FF)))
                {
                    ++GlyphDrawn;
                }
            }
            Column.Finalize();
        }
        Toast::Construct();
        EndValidationFrame();
        Confirm(GlyphDrawn == 118, "Not every Studio glyph outline parsed and drew");

        if (ArgumentCount >= 2)
        {
            FrontierExhibit::AcknowledgeTextures();
            const int Width  = static_cast<int>(IO.DisplaySize.x * IO.DisplayFramebufferScale.x);
            const int Height = static_cast<int>(IO.DisplaySize.y * IO.DisplayFramebufferScale.y);
            std::vector<unsigned char> Pixels(static_cast<size_t>(Width) * Height * 3, 0x18);
            const ImDrawData* DrawData = ImGui::GetDrawData();
            for (const ImDrawList* DrawList : DrawData->CmdLists)
                FrontierExhibit::RasterizeCommands(DrawList, Pixels.data(), Width, Height, DrawData->DisplayPos, DrawData->FramebufferScale);
            std::ofstream Image(Arguments[1], std::ios::binary);
            Image << "P6\n" << Width << ' ' << Height << "\n255\n";
            Image.write(reinterpret_cast<const char*>(Pixels.data()), static_cast<std::streamsize>(Pixels.size()));
            if (!Image) throw std::runtime_error("Could not write StudioControls PPM evidence");
        }

        std::fprintf(stdout, "StudioControlsValidation: 118 glyphs, card/segment/pill/switch interaction, and idle rendering passed\n");
        ImGui::DestroyContext();
        return 0;
    }
    catch (const std::exception& Failure)
    {
        ImGui::DestroyContext();
        std::fprintf(stderr, "StudioControlsValidation: %s\n", Failure.what());
        return 1;
    }
}
