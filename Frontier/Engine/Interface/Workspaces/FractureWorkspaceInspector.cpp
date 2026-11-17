/*==========================================================================================================================================
                                                        FRACTUREWORKSPACEINSPECTOR.CPP
==========================================================================================================================================*/
// 🧩 The Fracture Workspace inspector: the staged-object header (symbol chip, rename, type caption, enable switch)
//    and the Overview / Physics / Bonds / SDF tabs from the prototype's FractureEditor.js (partition receipt, metrics,
//    quick tiles, pipeline, constitutive material, energy budget, adjacency bonds, impact locus, piece-SDF atlas, bake
//    archive + TOML record), plus the celestial inspectors (Directional Sun Cycle/Optics/Coordinates/Notice, Sky
//    Atmosphere LUT bake/optical curves/twilight/specs, cloud slab/volume/world-wind pages). Value controls edit the
//    native Spec copy, recompute measured solver receipts, and log keyed PARAM lines. Bake and strike actions forward
//    into the workspace's native solver/Jolt runtime; asset export remains a separate editor integration.

#include "Engine/Interface/Workspaces/FractureWorkspace.h"

#include "Engine/Interface/Controls/ActionRow.h"
#include "Engine/Interface/Controls/AxisFields.h"
#include "Engine/Interface/Controls/CaptionText.h"
#include "Engine/Interface/Controls/ChoiceRow.h"
#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/DiagramCanvas.h"
#include "Engine/Interface/Controls/SectionCard.h"
#include "Engine/Interface/Controls/SelectPill.h"
#include "Engine/Interface/Controls/SliderPill.h"
#include "Engine/Interface/Controls/SwitchPill.h"
#include "Engine/Interface/Controls/TextRow.h"

#include <cmath>
#include <cstdio>

namespace Frontier
{
namespace
{

void LogSliderValue(FractureWorkspaceState& State, const char* Channel, const char* Label, double Value, int Digits,
                    const char* Unit)
{
    char Shown[64]{};
    if (Unit != nullptr && Unit[0] != '\0') std::snprintf(Shown, sizeof(Shown), "%.*f %s", Digits, Value, Unit);
    else std::snprintf(Shown, sizeof(Shown), "%.*f", Digits, Value);
    LogFractureWorkspaceValue(State, Channel, Label, Shown);
}

bool ConstructParamSlider(FractureWorkspaceState& State, ControlColumn& Column, const char* Channel, const char* Id,
                          const char* Label, double& Value, double Minimum, double Maximum, double Step, const char* Unit,
                          int Digits)
{
    if (!SliderPill::Construct(Column, Id, Label, Value, Minimum, Maximum, Step, Unit)) return false;
    LogSliderValue(State, Channel, Label, Value, Digits, Unit);
    return true;
}

bool ConstructParamStepped(FractureWorkspaceState& State, ControlColumn& Column, const char* Channel, const char* Id,
                           const char* Label, int& Value, double Minimum, double Maximum, double Step, const char* Unit)
{
    double Shown = static_cast<double>(Value);
    if (!SliderPill::Construct(Column, Id, Label, Shown, Minimum, Maximum, Step, Unit)) return false;
    Value = static_cast<int>(std::round(Shown));
    LogSliderValue(State, Channel, Label, static_cast<double>(Value), 0, Unit);
    return true;
}

bool ConstructParamToggle(FractureWorkspaceState& State, ControlColumn& Column, const char* Channel, const char* Id,
                          const char* Label, const char* Detail, bool& Value)
{
    if (!SwitchPill::Construct(Column, Id, Label, Detail, Value)) return false;
    LogFractureWorkspaceValue(State, Channel, Label, Value ? "on" : "off");
    return true;
}

bool ConstructParamSelect(FractureWorkspaceState& State, ControlColumn& Column, const char* Channel, const char* Id,
                          const char* Label, int& Index, const char* const* Names, int Count)
{
    if (!SelectPill::Construct(Column, Id, Label, Names, Count, Index)) return false;
    LogFractureWorkspaceValue(State, Channel, Label, Names[Index]);
    return true;
}

bool ConstructParamChoice(FractureWorkspaceState& State, ControlColumn& Column, const char* Channel, const char* Id,
                          const char* Label, int& Index, const char* const* Names, int Count)
{
    if (!ChoiceRow::Construct(Column, Id, Label, Names, Count, Index)) return false;
    LogFractureWorkspaceValue(State, Channel, Label, Names[Index]);
    return true;
}

void RecomputeActive(FractureWorkspaceState& State)
{
    RecomputeFractureReceipt(State.Constructs[State.ActiveConstruct]);
}

void ConstructCaptionf(ControlColumn& Column, const char* Format, double A, double B)
{
    char Text[160]{};
    std::snprintf(Text, sizeof(Text), Format, A, B);
    CaptionText::Construct(Column, Text);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    OBJECT HEADER
//------------------------------------------------------------------------------------------------------------------------

void ConstructObjectHeader(FractureWorkspaceState& State, ControlColumn& Column)
{
    char   Type[128]{};
    bool   Rename = false;
    bool   Enabled = true;
    bool   EnabledLive = true;
    const char* Glyph = "StudioBoxes";
    if (State.Selected >= 0 && State.Selected < 7)
    {
        const FractureWorkspaceConstruct& Cst = State.Constructs[State.Selected];
        const FractureWorkspaceMaterial&  Mat = QueryFractureMaterial(Cst.Spec.Material);
        std::snprintf(Type, sizeof(Type), "%s · %s", Mat.ShortLabel,
                      QueryFractureSolver(Cst.Spec.Solver).Id);
        for (char* C = Type; *C != '\0'; ++C)
            if (*C >= 'a' && *C <= 'z') *C = static_cast<char>(*C - 'a' + 'A');
        Rename = true;
        Enabled = Cst.BakedResident;
        Glyph  = "StudioBoxes";
    }
    else if (State.Selected == FractureWorkspaceState::SelectedSun)
    {
        std::snprintf(Type, sizeof(Type), "15 NATIVE PROPERTIES · %s", State.SunSolved.PhaseLabel);
        for (char* C = Type; *C != '\0'; ++C)
            if (*C >= 'a' && *C <= 'z') *C = static_cast<char>(*C - 'a' + 'A');
        EnabledLive = false;
        Glyph       = "StudioSun";
    }
    else if (State.Selected == FractureWorkspaceState::SelectedAtmosphere)
    {
        std::snprintf(Type, sizeof(Type), "18 NATIVE FIELDS · BRUNETON & HILLAIRE");
        Enabled = State.Atmos.BakedFetchEnabled;
        Glyph   = "StudioGlobe";
    }
    else
    {
        const bool IsLocal = State.Clouds.ActiveScope == 1;
        std::snprintf(Type, sizeof(Type), IsLocal ? "LOCAL VOLUMETRIC BOX · EMERALD CAGE" : "GLOBAL VOLUMETRIC SLAB · WORLD Z");
        Enabled = IsLocal ? State.Clouds.Local.Enabled : State.Clouds.Global.Enabled;
        Glyph   = "StudioCloud";
    }
    (void)Glyph;

    if (Rename)
    {
        if (TextRow::Construct(Column, "ObjectName", "Name", State.Constructs[State.Selected].Title))
            LogFractureWorkspaceValue(State, "PARAM", "Rename", State.Constructs[State.Selected].Title.c_str());
    }
    else
    {
        const char* Name = "Directional Sun";
        if (State.Selected == FractureWorkspaceState::SelectedAtmosphere) Name = "Sky Atmosphere";
        else if (State.Selected == FractureWorkspaceState::SelectedCloudsGlobal) Name = "Global Cloud Slab";
        else if (State.Selected == FractureWorkspaceState::SelectedCloudsLocal) Name = "Local Cloud Volume";
        CaptionText::Construct(Column, Name);
    }
    CaptionText::Construct(Column, Type);

    bool Switch = Enabled;
    if (SwitchPill::Construct(Column, "ObjectEnabled", "Baked / active", "", Switch) && EnabledLive)
    {
        if (State.Selected >= 0 && State.Selected < 7)
        {
            State.Constructs[State.Selected].BakedResident = Switch;
            LogFractureWorkspaceValue(State, "PARAM", "Baked resident", Switch ? "on" : "off");
        }
        else if (State.Selected == FractureWorkspaceState::SelectedAtmosphere)
        {
            State.Atmos.BakedFetchEnabled = Switch;
            LogFractureWorkspaceValue(State, "PARAM", "Baked fetch", Switch ? "on" : "off");
        }
        else if (State.Selected == FractureWorkspaceState::SelectedCloudsLocal)
        {
            State.Clouds.Local.Enabled = Switch;
            LogFractureWorkspaceValue(State, "PARAM", "Local enabled", Switch ? "on" : "off");
        }
        else if (State.Selected == FractureWorkspaceState::SelectedCloudsGlobal)
        {
            State.Clouds.Global.Enabled = Switch;
            LogFractureWorkspaceValue(State, "PARAM", "Global enabled", Switch ? "on" : "off");
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    OVERVIEW TAB
//------------------------------------------------------------------------------------------------------------------------

void ConstructOverviewTab(FractureWorkspaceState& State, ControlColumn& Column)
{
    FractureWorkspaceConstruct& Cst  = State.Constructs[State.ActiveConstruct];
    const FractureReceipt&      Rec  = Cst.Receipt;
    const FractureWorkspaceMaterial& Mat = QueryFractureMaterial(Cst.Spec.Material);

    char Budget[32]{};
    std::snprintf(Budget, sizeof(Budget), "%.0f%% SPENT", Rec.BudgetPercent);
    (void)SectionCard::Begin(Column, "OvReceipt", "Partition receipt", "StudioCheck", Budget,
                             "01/PARTITION RECEIPT · native solver + Jolt", State.OpenCards[FractureWorkspaceState::CardOvReceipt]);
    {
        char Line[128]{};
        std::snprintf(Line, sizeof(Line), "%d shards · %d/%d bonds intact", Rec.FragmentCount, Rec.IntactBondCount,
                      Rec.BondCount);
        CaptionText::Construct(Column, Line);
        std::snprintf(Line, sizeof(Line), "Solve %.2f ms · drift %.2e · %s", Rec.StepMilliseconds, Rec.VolumeDriftRatio,
                      Rec.WatertightManifold ? "watertight" : "open manifold");
        CaptionText::Construct(Column, Line);
        DiagramPen Slice = DiagramCanvas::Begin(Column, "OvStressSlice", 300.0f, 64.0f, 6.0f, 4.0f);
        {
            std::vector<ImU32> Stops = { IM_COL32(62, 196, 109, 255), IM_COL32(232, 194, 122, 255), IM_COL32(224, 122, 95, 255) };
            Slice.GradientBar(ImVec2(8.0f, 10.0f), ImVec2(284.0f, 14.0f), Stops);
            Slice.Text(ImVec2(8.0f, 40.0f), "STRESS SLICE", IM_COL32(160, 160, 160, 255), 9.0f, -1);
            char Crack[48]{};
            std::snprintf(Crack, sizeof(Crack), "%.2f m2 CRACK", Rec.TotalCrackArea);
            Slice.Text(ImVec2(292.0f, 40.0f), Crack, IM_COL32(232, 194, 122, 255), 9.0f, 1);
            std::vector<ImVec2> Wave;
            for (int I = 0; I <= 48; ++I)
            {
                const float X = 8.0f + (284.0f * I) / 48.0f;
                Wave.emplace_back(X, 52.0f - 8.0f * std::sin(I * 0.55f) * std::exp(-I / 40.0f));
            }
            Slice.Path(Wave, IM_COL32(96, 165, 250, 255), 1.5f);
        }
    }
    SectionCard::End(Column);

    (void)SectionCard::Begin(Column, "OvMetrics", "Fracture metrics", "StudioGauge", "TRIO", nullptr, State.OpenCards[FractureWorkspaceState::CardOvMetrics]);
    ConstructCaptionf(Column, "Crack area %.2f m² · Energy %.0f J", Rec.TotalCrackArea,
                      Cst.Spec.Energy);
    ConstructCaptionf(Column, "Fractography H %.2f · Wave cR %.0f m/s", 0.78, Rec.RayleighSpeedMps);
    SectionCard::End(Column);

    {
        static const ActionItem Tiles[4] = {
            { "Piece SDF", "StudioBoxes", ActionTone::Default },
            { "Eng.Bake", "StudioArchive", ActionTone::Default },
            { "Hybrid Bonds", "StudioGrid", ActionTone::Default },
            { "Bake Cache", "StudioFolder", ActionTone::Default },
        };
        const int Fired = ActionRow::Construct(Column, "OvTiles", Tiles, 4);
        if (Fired == 0 || Fired == 3) State.InspectorTab = FractureWorkspaceState::TabSdf;
        else if (Fired == 1) (void)BakeFractureWorkspaceActive(State, "BAKE");
        else if (Fired == 2) State.InspectorTab = FractureWorkspaceState::TabBonds;
    }

    (void)SectionCard::Begin(Column, "OvPipeline", "Fracture pipeline", "StudioLayers", Cst.Pipeline.c_str(), nullptr, State.OpenCards[FractureWorkspaceState::CardOvPipeline]);
    {
        static const char* Pipes[3] = { "Realtime", "Eng.Bake", "Hybrid Bonds" };
        int                Pipe     = Cst.Pipeline == "baked" ? 1 : (Cst.Pipeline == "hybrid" ? 2 : 0);
        if (ChoiceRow::Construct(Column, "OvPipe", "Pipeline", Pipes, 3, Pipe))
        {
            Cst.Pipeline = Pipe == 1 ? "baked" : (Pipe == 2 ? "hybrid" : "realtime");
            Cst.Spec.Solver = Pipe == 0 ? 0 : (Pipe == 1 ? 1 : Cst.Spec.Solver);
            RecomputeFractureReceipt(Cst);
            LogFractureWorkspaceValue(State, "PARAM", "Pipeline", Pipes[Pipe]);
        }
        static const char* Solvers[6] = { "runtime_boussinesq", "engineering_fem", "griffith",
                                          "wavefront",          "voronoi",         "dendritic" };
        if (ConstructParamSelect(State, Column, "PARAM", "OvSolver", "Active fracture algorithm", Cst.Spec.Solver,
                                 Solvers, 6))
            RecomputeFractureReceipt(Cst);
    }
    SectionCard::End(Column);

    {
        static const ActionItem Actions[3] = {
            { "Strike Mesh", "StudioBlast", ActionTone::Accent },
            { "Re-seed #", "StudioReset", ActionTone::Default },
            { "Matrix (6)", "StudioGrid", ActionTone::Default },
        };
        const int Fired = ActionRow::Construct(Column, "OvActions", Actions, 3);
        if (Fired == 0) (void)StrikeFractureWorkspaceActive(State);
        else if (Fired == 1)
        {
            Cst.Spec.Seed = 1 + (Cst.Spec.Seed * 9301 + 49297) % 9999;
            RecomputeFractureReceipt(Cst);
            char Shown[32]{};
            std::snprintf(Shown, sizeof(Shown), "#%d", Cst.Spec.Seed);
            LogFractureWorkspaceValue(State, "PARAM", "Re-seed", Shown);
        }
        else if (Fired == 2) State.MatrixOpen = true;
    }
    (void)Mat;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    PHYSICS TAB
//------------------------------------------------------------------------------------------------------------------------

void ConstructPhysicsTab(FractureWorkspaceState& State, ControlColumn& Column)
{
    FractureWorkspaceConstruct& Cst = State.Constructs[State.ActiveConstruct];
    const FractureReceipt&      Rec = Cst.Receipt;

    char Badge[48]{};
    std::snprintf(Badge, sizeof(Badge), "%s", QueryFractureMaterial(Cst.Spec.Material).FractureCategory);
    for (char* C = Badge; *C != '\0'; ++C)
        if (*C >= 'a' && *C <= 'z') *C = static_cast<char>(*C - 'a' + 'A');
    (void)SectionCard::Begin(Column, "PhMaterial", "Constitutive material & grain", "StudioThermal", Badge, nullptr, State.OpenCards[FractureWorkspaceState::CardPhMaterial]);
    {
        static const char* Mats[6] = { "Concrete", "Granite", "Spruce Wood", "Float Glass", "Tempered", "ABS" };
        if (ConstructParamChoice(State, Column, "PARAM", "PhMat", "Material", Cst.Spec.Material, Mats, 6))
            RecomputeFractureReceipt(Cst);
        const FractureWorkspaceMaterial& Mat = QueryFractureMaterial(Cst.Spec.Material);
        DiagramPen Rose = DiagramCanvas::Begin(Column, "PhRose", 300.0f, 96.0f, 6.0f, 4.0f);
        {
            const float Cx = 70.0f, Cy = 48.0f, R = 34.0f;
            Rose.Circle(ImVec2(Cx, Cy), R, IM_COL32(24, 24, 26, 255), IM_COL32(120, 120, 120, 255));
            Rose.Circle(ImVec2(Cx, Cy), R * 0.55f, 0, IM_COL32(70, 70, 70, 255));
            const float A = static_cast<float>(Cst.Spec.GrainAngleDeg * 3.14159265 / 180.0);
            Rose.Line(ImVec2(Cx - R * std::cos(A), Cy - R * std::sin(A)), ImVec2(Cx + R * std::cos(A), Cy + R * std::sin(A)),
                      IM_COL32(232, 194, 122, 255), 2.0f);
            Rose.Text(ImVec2(120.0f, 24.0f), "GRAIN ROSE", IM_COL32(160, 160, 160, 255), 9.0f, -1);
            char Gc[64]{};
            std::snprintf(Gc, sizeof(Gc), "Gc %.0f J/m2", Mat.Gc);
            Rose.Text(ImVec2(120.0f, 44.0f), Gc, IM_COL32(232, 194, 122, 255), 10.0f, -1);
            char An[64]{};
            std::snprintf(An, sizeof(An), "Aniso %.1fx", Mat.AnisotropyRatio);
            Rose.Text(ImVec2(120.0f, 62.0f), An, IM_COL32(62, 196, 109, 255), 10.0f, -1);
            char Cr[64]{};
            std::snprintf(Cr, sizeof(Cr), "cR %.0f m/s", Rec.RayleighSpeedMps);
            Rose.Text(ImVec2(120.0f, 80.0f), Cr, IM_COL32(96, 165, 250, 255), 10.0f, -1);
        }
    }
    SectionCard::End(Column);

    (void)SectionCard::Begin(Column, "PhBudget", "Energy budget & crack limits", "StudioGauge", "WEIBULL", nullptr, State.OpenCards[FractureWorkspaceState::CardPhBudget]);
    if (ConstructParamSlider(State, Column, "PARAM", "PhEnergy", "Impact kinetic energy", Cst.Spec.Energy, 100.0,
                             15000.0, 50.0, "J", 0))
        RecomputeFractureReceipt(Cst);
    if (ConstructParamStepped(State, Column, "PARAM", "PhCeiling", "Shard ceiling", Cst.Spec.Ceiling, 4.0, 140.0, 1.0,
                              "pcs"))
        RecomputeFractureReceipt(Cst);
    if (ConstructParamSlider(State, Column, "PARAM", "PhMinSize", "Minimum shard span", Cst.Spec.MinimumSize, 0.015,
                             0.22, 0.005, "m", 3))
        RecomputeFractureReceipt(Cst);
    if (ConstructParamSlider(State, Column, "PARAM", "PhGrain", "Orthotropic grain axis θ", Cst.Spec.GrainAngleDeg, 0.0,
                             180.0, 1.0, "°", 0))
        RecomputeFractureReceipt(Cst);
    SectionCard::End(Column);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    BONDS TAB
//------------------------------------------------------------------------------------------------------------------------

void ConstructBondsTab(FractureWorkspaceState& State, ControlColumn& Column)
{
    FractureWorkspaceConstruct& Cst = State.Constructs[State.ActiveConstruct];
    const FractureReceipt&      Rec = Cst.Receipt;

    char Badge[32]{};
    std::snprintf(Badge, sizeof(Badge), "%d/%d", Rec.IntactBondCount, Rec.BondCount);
    (void)SectionCard::Begin(Column, "BoBonds", "Adjacency strain bonds", "StudioGrid", Badge, nullptr, State.OpenCards[FractureWorkspaceState::CardBoBonds]);
    {
        char Line[96]{};
        std::snprintf(Line, sizeof(Line), "Intact %d · Ruptured %d", Rec.IntactBondCount,
                      Rec.BondCount - Rec.IntactBondCount);
        CaptionText::Construct(Column, Line);
        if (ConstructParamSlider(State, Column, "PARAM", "BoScale", "Bond tensile capacity scale",
                                 Cst.Spec.BondStrengthScale, 0.15, 2.5, 0.05, "×", 2))
            RecomputeFractureReceipt(Cst);
    }
    SectionCard::End(Column);

    (void)SectionCard::Begin(Column, "BoLocus", "Impact locus & strike vector", "StudioFocus", "3D RAYCAST", nullptr, State.OpenCards[FractureWorkspaceState::CardBoLocus]);
    {
        float Point[3] = { static_cast<float>(Cst.Spec.ImpactPoint[0]), static_cast<float>(Cst.Spec.ImpactPoint[1]),
                           static_cast<float>(Cst.Spec.ImpactPoint[2]) };
        if (AxisFields::Construct(Column, "BoPoint", "Impact point (local solid space)", Point, { -1.0f, -1.0f, -1.0f },
                                  { 1.0f, 1.0f, 1.0f }))
        {
            Cst.Spec.ImpactPoint[0] = Point[0];
            Cst.Spec.ImpactPoint[1] = Point[1];
            Cst.Spec.ImpactPoint[2] = Point[2];
            RecomputeFractureReceipt(Cst);
            LogFractureWorkspaceValue(State, "PARAM", "Impact point", "edited");
        }
        float Normal[3] = { static_cast<float>(Cst.Spec.ImpactNormal[0]), static_cast<float>(Cst.Spec.ImpactNormal[1]),
                            static_cast<float>(Cst.Spec.ImpactNormal[2]) };
        if (AxisFields::Construct(Column, "BoNormal", "Strike surface normal", Normal, { -1.0f, -1.0f, -1.0f },
                                  { 1.0f, 1.0f, 1.0f }))
        {
            Cst.Spec.ImpactNormal[0] = Normal[0];
            Cst.Spec.ImpactNormal[1] = Normal[1];
            Cst.Spec.ImpactNormal[2] = Normal[2];
            RecomputeFractureReceipt(Cst);
            LogFractureWorkspaceValue(State, "PARAM", "Impact normal", "edited");
        }
    }
    SectionCard::End(Column);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    SDF TAB
//------------------------------------------------------------------------------------------------------------------------

void ConstructSdfTab(FractureWorkspaceState& State, ControlColumn& Column)
{
    FractureWorkspaceConstruct& Cst = State.Constructs[State.ActiveConstruct];
    const FractureReceipt&      Rec = Cst.Receipt;
    const double                Mb  = QueryFractureSdfMegabytes(Rec.FragmentCount, Cst.Spec.SdfResolution, Cst.Spec.PieceSdf);

    char Badge[32]{};
    if (Cst.Spec.PieceSdf) std::snprintf(Badge, sizeof(Badge), "%.2f MB", Mb);
    else std::snprintf(Badge, sizeof(Badge), "OFF");
    (void)SectionCard::Begin(Column, "SdfAtlas", "Piece SDF voxel atlas", "StudioBoxes", Badge, nullptr, State.OpenCards[FractureWorkspaceState::CardSdfAtlas]);
    ConstructParamToggle(State, Column, "PARAM", "SdfEnabled", "Bake per-piece signed distance bricks",
                         "R16F half-float distance bricks", Cst.Spec.PieceSdf);
    {
        static const char* Res[3] = { "32³", "64³", "128³" };
        int                Sel    = Cst.Spec.SdfResolution == 32 ? 0 : (Cst.Spec.SdfResolution == 128 ? 2 : 1);
        if (ChoiceRow::Construct(Column, "SdfRes", "SDF grid resolution", Res, 3, Sel))
        {
            Cst.Spec.SdfResolution = Sel == 0 ? 32 : (Sel == 2 ? 128 : 64);
            Cst.Spec.PieceSdf      = true;
            LogFractureWorkspaceValue(State, "PARAM", "SDF resolution", Res[Sel]);
        }
        DiagramPen Atlas = DiagramCanvas::Begin(Column, "SdfSlice", 300.0f, 84.0f, 6.0f, 4.0f);
        {
            const int Lit = Cst.Spec.PieceSdf ? (Rec.FragmentCount * 32 / 140 > 32 ? 32 : Rec.FragmentCount * 32 / 140) : 0;
            for (int I = 0; I < 32; ++I)
            {
                const float X = 8.0f + (I % 16) * 18.0f;
                const float Y = 8.0f + (I / 16) * 18.0f;
                Atlas.Circle(ImVec2(X + 6.0f, Y + 6.0f), 5.0f,
                             I < Lit ? IM_COL32(62, 196, 109, 255) : IM_COL32(52, 52, 56, 255));
            }
            char Cap[64]{};
            std::snprintf(Cap, sizeof(Cap), "%d BRICKS LIT", Lit);
            Atlas.Text(ImVec2(292.0f, 78.0f), Cap, IM_COL32(160, 160, 160, 255), 9.0f, 1);
        }
    }
    SectionCard::End(Column);

    (void)SectionCard::Begin(Column, "SdfArchive", "Baked archive & TOML record", "StudioArchive", "PERSISTENCE", nullptr, State.OpenCards[FractureWorkspaceState::CardSdfArchive]);
    {
        static const ActionItem Actions[2] = {
            { "Finalize Bake Archive", "StudioArchive", ActionTone::Accent },
            { "Download .fracture.toml", "StudioDownload", ActionTone::Default },
        };
        const int Fired = ActionRow::Construct(Column, "SdfActions", Actions, 2);
        if (Fired == 0) (void)BakeFractureWorkspaceActive(State, "BAKE");
        else if (Fired == 1)
            NoopFractureWorkspaceCommand(State, "EXPORT", "Download .fracture.toml", "Export is a NOOP in the UI shell");
        char Toml[2048]{};
        EncodeFractureToml(State, State.ActiveConstruct, Toml, sizeof(Toml));
        CaptionText::Construct(Column, Toml);
    }
    SectionCard::End(Column);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    CELESTIAL INSPECTORS
//------------------------------------------------------------------------------------------------------------------------

void ConstructSunInspector(FractureWorkspaceState& State, ControlColumn& Column)
{
    FractureSunParams& P = State.Sun;
    auto               Resolve = [&]() { EvaluateFractureSun(State.Sun, State.SunSolved); };

    if (State.InspectorTab == FractureWorkspaceState::TabOverview)
    {
        (void)SectionCard::Begin(Column, "SunArc", "24-Hour Diurnal Solar Path", "StudioSun", "CYCLE", nullptr, State.OpenCards[FractureWorkspaceState::CardSunArc]);
        {
            char Line[96]{};
            std::snprintf(Line, sizeof(Line), "Elevation %.1f° · Azimuth %.1f°", State.SunSolved.ElevationDeg,
                          State.SunSolved.AzimuthDeg);
            CaptionText::Construct(Column, Line);
            DiagramPen Arc = DiagramCanvas::Begin(Column, "SunDiurnal", 300.0f, 96.0f, 6.0f, 4.0f);
            {
                std::vector<ImVec2> Curve;
                for (int I = 0; I <= 48; ++I)
                {
                    const float H  = (I / 48.0f) * 24.0f;
                    FractureSunParams Probe = P;
                    Probe.LocalHours        = H;
                    FractureSunSolved SolvedProbe{};
                    EvaluateFractureSun(Probe, SolvedProbe);
                    Curve.emplace_back(8.0f + (284.0f * I) / 48.0f,
                                       80.0f - (SolvedProbe.ElevationDeg + 20.0f) * 0.7f);
                }
                Arc.Path(Curve, IM_COL32(232, 194, 122, 255), 1.5f);
                const float NowX = 8.0f + 284.0f * static_cast<float>(P.LocalHours / 24.0);
                Arc.Line(ImVec2(NowX, 8.0f), ImVec2(NowX, 84.0f), IM_COL32(232, 194, 122, 160), 1.0f);
                char Rise[64]{};
                std::snprintf(Rise, sizeof(Rise), "RISE %.1fh NOON %.1fh SET %.1fh", State.SunSolved.SunriseHour,
                              State.SunSolved.SolarNoonHour, State.SunSolved.SunsetHour);
                Arc.Text(ImVec2(150.0f, 94.0f), Rise, IM_COL32(160, 160, 160, 255), 8.0f, 0);
            }
            if (ConstructParamSlider(State, Column, "SUN", "SunHours", "Local solar hours", P.LocalHours, 0.0, 24.0,
                                     0.05, "h", 2))
                Resolve();
            ConstructParamToggle(State, Column, "SUN", "SunAnimate", "Animate diurnal orbit", "", P.AnimateCycle);
            {
                static const char* Speeds[4] = { "0.5×", "1×", "6×", "24×" };
                static const double Values[4] = { 0.5, 1.0, 6.0, 24.0 };
                int Sel = P.CycleSpeed == 0.5 ? 0 : (P.CycleSpeed == 6.0 ? 2 : (P.CycleSpeed == 24.0 ? 3 : 1));
                if (ChoiceRow::Construct(Column, "SunSpeed", "Orbit speed multiplier", Speeds, 4, Sel))
                {
                    P.CycleSpeed = Values[Sel];
                    LogFractureWorkspaceValue(State, "SUN", "Orbit speed", Speeds[Sel]);
                }
            }
        }
        SectionCard::End(Column);
    }
    else if (State.InspectorTab == FractureWorkspaceState::TabPhysics)
    {
        char Badge[32]{};
        std::snprintf(Badge, sizeof(Badge), "AM %.2f", State.SunSolved.AirMass);
        (void)SectionCard::Begin(Column, "SunDisc", "Solar disc & spectral tint", "StudioGlobe", Badge, nullptr, State.OpenCards[FractureWorkspaceState::CardSunDisc]);
        ConstructParamSlider(State, Column, "SUN", "SunDiameter", "Angular diameter", P.AngularDiameterDeg, 0.1, 4.0,
                             0.01, "°", 3);
        ConstructParamSlider(State, Column, "SUN", "SunTintR", "Tint red", P.TintRgb[0], 0.2, 1.4, 0.01, "", 2);
        ConstructParamSlider(State, Column, "SUN", "SunTintG", "Tint green", P.TintRgb[1], 0.2, 1.4, 0.01, "", 2);
        ConstructParamSlider(State, Column, "SUN", "SunTintB", "Tint blue", P.TintRgb[2], 0.2, 1.4, 0.01, "", 2);
        SectionCard::End(Column);

        (void)SectionCard::Begin(Column, "SunGain", "Sunlight gain multipliers", "StudioRays", "GAINS", nullptr, State.OpenCards[FractureWorkspaceState::CardSunGain]);
        ConstructParamSlider(State, Column, "SUN", "SunSkyGain", "Sky scatter multiplier", P.SkyGainMultiplier, 0.0, 3.0,
                             0.05, "×", 2);
        ConstructParamSlider(State, Column, "SUN", "SunBeamGain", "Direct beam multiplier", P.DirectBeamMultiplier, 0.0,
                             4.0, 0.05, "×", 2);
        SectionCard::End(Column);
    }
    else if (State.InspectorTab == FractureWorkspaceState::TabBonds)
    {
        char Badge[32]{};
        std::snprintf(Badge, sizeof(Badge), "Month %d/%d", P.Month, P.Day);
        (void)SectionCard::Begin(Column, "SunMap", "Observer geodetic graticule", "StudioFocus", Badge, nullptr, State.OpenCards[FractureWorkspaceState::CardSunMap]);
        if (ConstructParamSlider(State, Column, "SUN", "SunLat", "Latitude", P.LatitudeDeg, -85.0, 85.0, 0.5, "°", 1))
            Resolve();
        if (ConstructParamSlider(State, Column, "SUN", "SunLon", "Longitude", P.LongitudeDeg, -180.0, 180.0, 0.5, "°",
                                 1))
            Resolve();
        if (ConstructParamStepped(State, Column, "SUN", "SunMonth", "Calendar month", P.Month, 1.0, 12.0, 1.0, ""))
            Resolve();
        if (ConstructParamStepped(State, Column, "SUN", "SunDay", "Calendar day", P.Day, 1.0, 31.0, 1.0, "")) Resolve();
        SectionCard::End(Column);
    }
    else
    {
        CaptionText::Construct(Column, "Directional Sun is solved analytically per frame (Declination δ, Equation of "
                                       "Time, Kasten–Young Air Mass, solar disc chromaticity). Octahedral 256×512 "
                                       "RGBA16F HDR sky baking lives in Sky Atmosphere.");
    }
}

void ConstructAtmosphereInspector(FractureWorkspaceState& State, ControlColumn& Column)
{
    FractureAtmosParams& P = State.Atmos;

    if (State.InspectorTab == FractureWorkspaceState::TabOverview)
    {
        char Badge[32]{};
        std::snprintf(Badge, sizeof(Badge), "REV #%d", P.BakedRevision);
        (void)SectionCard::Begin(Column, "AtLut", "256 × 512 RGBA16F Sky Bake Atlas", "StudioGlobe", Badge, nullptr, State.OpenCards[FractureWorkspaceState::CardAtLut]);
        {
            static const char* Modes[4] = { "Altitude", "Panorama 4:1", "Transmit", "Sphere 2:1" };
            ConstructParamChoice(State, Column, "ATMOS", "AtMode", "Atlas preview mode", P.PreviewMode, Modes, 4);
            ConstructParamToggle(State, Column, "ATMOS", "AtFetch", "Sample baked octahedral LUT", "", P.BakedFetchEnabled);
            ConstructParamToggle(State, Column, "ATMOS", "AtCivil", "Analytic civil horizon band", "",
                                 P.CivilTwilightEnabled);
            static const ActionItem Rebake[1] = { { "Re-bake 256×512 Sky Atlas", "StudioSparkles", ActionTone::Accent } };
            if (ActionRow::Construct(Column, "AtRebake", Rebake, 1) == 0)
            {
                P.BakedRevision++;
                LogFractureWorkspaceValue(State, "ATMOS", "Sky atlas re-bake", "explicit NOOP");
            }
        }
        SectionCard::End(Column);
    }
    else if (State.InspectorTab == FractureWorkspaceState::TabPhysics)
    {
        (void)SectionCard::Begin(Column, "AtProfiles", "Rayleigh, Mie & Ozone Optical Profiles", "StudioActivity",
                                 "0–100 KM", nullptr, State.OpenCards[FractureWorkspaceState::CardAtProfiles]);
        ConstructParamSlider(State, Column, "ATMOS", "AtRayleigh", "Rayleigh scatter ×", P.RayleighMultiplier, 0.1, 3.0,
                             0.05, "×", 2);
        ConstructParamSlider(State, Column, "ATMOS", "AtRayleighH", "Rayleigh scale H_R", P.RayleighScaleHeightKm, 2.0,
                             16.0, 0.2, "km", 1);
        ConstructParamSlider(State, Column, "ATMOS", "AtMie", "Mie haze ×", P.MieMultiplier, 0.05, 4.0, 0.05, "×", 2);
        ConstructParamSlider(State, Column, "ATMOS", "AtMieG", "Mie phase g", P.MiePhaseG, -0.5, 0.95, 0.01, "", 2);
        ConstructParamSlider(State, Column, "ATMOS", "AtMieH", "Mie scale H_M", P.MieScaleHeightKm, 0.3, 5.0, 0.1, "km",
                             2);
        ConstructParamSlider(State, Column, "ATMOS", "AtOzone", "Ozone tent ×", P.OzoneMultiplier, 0.0, 3.0, 0.05, "×",
                             2);
        SectionCard::End(Column);
    }
    else if (State.InspectorTab == FractureWorkspaceState::TabBonds)
    {
        char Badge[32]{};
        std::snprintf(Badge, sizeof(Badge), "TOP %.0f KM", P.GroundRadiusKm + P.AtmosphereHeightKm);
        (void)SectionCard::Begin(Column, "AtExtent", "Planet extent, twilight & albedo", "StudioGlobe", Badge, nullptr, State.OpenCards[FractureWorkspaceState::CardAtExtent]);
        ConstructParamSlider(State, Column, "ATMOS", "AtShell", "Atmosphere shell thickness", P.AtmosphereHeightKm, 50.0,
                             140.0, 2.0, "km", 0);
        ConstructParamSlider(State, Column, "ATMOS", "AtBright", "Sky brightness multiplier", P.SkyBrightness, 0.2, 2.5,
                             0.05, "×", 2);
        ConstructParamSlider(State, Column, "ATMOS", "AtGlow", "Twilight scattering glow", P.TwilightGlow, 0.0, 1.5,
                             0.05, "", 2);
        ConstructParamSlider(State, Column, "ATMOS", "AtAlbedo", "Ground Lambert albedo", P.GroundAlbedo, 0.0, 0.9,
                             0.02, "", 2);
        ConstructParamSlider(State, Column, "ATMOS", "AtMieAbs", "Mie absorption ×", P.MieAbsorptionMultiplier, 0.0, 3.0,
                             0.05, "×", 2);
        ConstructParamSlider(State, Column, "ATMOS", "AtHorizon", "Horizon white band", P.HorizonWhiteLine, 0.0, 1.0,
                             0.02, "", 2);
        SectionCard::End(Column);
    }
    else
    {
        (void)SectionCard::Begin(Column, "AtSpecs", "Atmosphere specifications", "StudioCheck", "BRUNETON", nullptr, State.OpenCards[FractureWorkspaceState::CardAtSpecs]);
        ConstructCaptionf(Column, "Ground radius %.0f km · shell %.0f km", P.GroundRadiusKm, P.AtmosphereHeightKm);
        ConstructCaptionf(Column, "Bake revision %d · preview mode %d", static_cast<double>(P.BakedRevision),
                          static_cast<double>(P.PreviewMode));
        SectionCard::End(Column);
    }
}

void ConstructCloudsInspector(FractureWorkspaceState& State, ControlColumn& Column)
{
    FractureCloudsParams& P       = State.Clouds;
    const bool            IsLocal = P.ActiveScope == 1;

    (void)SectionCard::Begin(Column, "ClScope", "Volumetric scope & switches", "StudioCloud",
                             IsLocal ? "LOCAL" : "GLOBAL", nullptr, State.OpenCards[FractureWorkspaceState::CardClScope]);
    {
        static const char* Scopes[2] = { "Global Cloud Slab", "Local Volume Box" };
        ConstructParamChoice(State, Column, "CLOUDS", "ClScopeRow", "Active cloud volume", P.ActiveScope, Scopes, 2);
        if (IsLocal)
        {
            ConstructParamToggle(State, Column, "CLOUDS", "ClLocalOn", "Medium enabled", "", P.Local.Enabled);
            ConstructParamToggle(State, Column, "CLOUDS", "ClLocalWind", "Follow wind advection", "",
                                 P.Local.FollowWind);
        }
        else
        {
            ConstructParamToggle(State, Column, "CLOUDS", "ClGlobalOn", "Medium enabled", "", P.Global.Enabled);
            ConstructParamToggle(State, Column, "CLOUDS", "ClGlobalWind", "Follow wind advection", "",
                                 P.Global.FollowWind);
        }
    }
    SectionCard::End(Column);

    char Badge[32]{};
    std::snprintf(Badge, sizeof(Badge), "%d%% COV",
                  static_cast<int>(std::round((IsLocal ? P.Local.Coverage : P.Global.Coverage) * 100.0)));
    (void)SectionCard::Begin(Column, "ClMask", "Top-down density field 1 − exp(−3ρ)", "StudioLayers", Badge, nullptr, State.OpenCards[FractureWorkspaceState::CardClMask]);
    if (IsLocal)
    {
        double Coverage = P.Local.Coverage * 100.0;
        if (ConstructParamSlider(State, Column, "CLOUDS", "ClCoverage", "Noise coverage", Coverage, 0.0, 100.0, 1.0,
                                 "%", 0))
            P.Local.Coverage = Coverage / 100.0;
        ConstructParamSlider(State, Column, "CLOUDS", "ClDensity", "Extinction density scale", P.Local.DensityScale,
                             0.1, 3.0, 0.05, "", 2);
        ConstructParamSlider(State, Column, "CLOUDS", "ClFeature", "Feature scale", P.Local.FeatureScale, 0.3, 3.0,
                             0.05, "×", 2);
        ConstructParamSlider(State, Column, "CLOUDS", "ClPhase", "Henyey-Greenstein g", P.Local.PhaseG, -0.4, 0.85,
                             0.02, "", 2);
    }
    else
    {
        double Coverage = P.Global.Coverage * 100.0;
        if (ConstructParamSlider(State, Column, "CLOUDS", "ClCoverage", "Noise coverage", Coverage, 0.0, 100.0, 1.0,
                                 "%", 0))
            P.Global.Coverage = Coverage / 100.0;
        ConstructParamSlider(State, Column, "CLOUDS", "ClDensity", "Extinction density scale", P.Global.DensityScale,
                             0.1, 3.0, 0.05, "", 2);
        ConstructParamSlider(State, Column, "CLOUDS", "ClFeature", "Feature scale", P.Global.FeatureScale, 0.3, 3.0,
                             0.05, "×", 2);
        ConstructParamSlider(State, Column, "CLOUDS", "ClPhase", "Henyey-Greenstein g", P.Global.PhaseG, -0.4, 0.85,
                             0.02, "", 2);
    }
    SectionCard::End(Column);

    if (IsLocal)
    {
        (void)SectionCard::Begin(Column, "ClLocal", "Local volume world bounds", "StudioBoxes", "CAGE LIVE", nullptr, State.OpenCards[FractureWorkspaceState::CardClLocal]);
        ConstructParamSlider(State, Column, "CLOUDS", "ClCx", "Centre X", P.Local.CentreX, -4.0, 4.0, 0.1, "m", 2);
        ConstructParamSlider(State, Column, "CLOUDS", "ClCy", "Centre Y (Z-Up)", P.Local.CentreY, 0.4, 5.0, 0.1, "m", 2);
        ConstructParamSlider(State, Column, "CLOUDS", "ClCz", "Centre Z", P.Local.CentreZ, -4.0, 4.0, 0.1, "m", 2);
        ConstructParamSlider(State, Column, "CLOUDS", "ClHx", "Half-extent X", P.Local.HalfExtentX, 0.2, 4.0, 0.1, "m",
                             2);
        ConstructParamSlider(State, Column, "CLOUDS", "ClHy", "Half-extent Y", P.Local.HalfExtentY, 0.2, 2.5, 0.05, "m",
                             2);
        ConstructParamSlider(State, Column, "CLOUDS", "ClHz", "Half-extent Z", P.Local.HalfExtentZ, 0.2, 4.0, 0.1, "m",
                             2);
        SectionCard::End(Column);
    }
    else
    {
        static const char* Morphs[6] = { "cumulus", "stratocumulus", "cirrus", "cumulonimbus", "stratus", "altocumulus" };
        char               MorphBadge[32]{};
        std::snprintf(MorphBadge, sizeof(MorphBadge), "%s", Morphs[P.Global.Morphology]);
        for (char* C = MorphBadge; *C != '\0'; ++C)
            if (*C >= 'a' && *C <= 'z') *C = static_cast<char>(*C - 'a' + 'A');
        (void)SectionCard::Begin(Column, "ClSlab", "World-Z slab & morphology", "StudioCloud", MorphBadge, nullptr, State.OpenCards[FractureWorkspaceState::CardClSlab]);
        ConstructParamSelect(State, Column, "CLOUDS", "ClMorph", "Cloud morphology", P.Global.Morphology, Morphs, 6);
        ConstructParamSlider(State, Column, "CLOUDS", "ClBase", "Base world Z", P.Global.BaseHeightM, 200.0, 5000.0,
                             100.0, "m", 0);
        ConstructParamSlider(State, Column, "CLOUDS", "ClThick", "Slab thickness", P.Global.ThicknessM, 200.0, 3500.0,
                             50.0, "m", 0);
        ConstructParamSlider(State, Column, "CLOUDS", "ClCeil", "Ceiling limit", P.Global.CeilingHeightM, 800.0, 6000.0,
                             100.0, "m", 0);
        ConstructParamSlider(State, Column, "CLOUDS", "ClAnvil", "Cb anvil overhang", P.Global.AnvilAmount, 0.0, 1.0,
                             0.02, "", 2);
        SectionCard::End(Column);
    }

    (void)SectionCard::Begin(Column, "ClWind", "Wind vector & GPU cloud shadows", "StudioWind", "WEATHER", nullptr, State.OpenCards[FractureWorkspaceState::CardClWind]);
    if (IsLocal)
    {
        ConstructParamSlider(State, Column, "CLOUDS", "ClWindX", "Wind X", P.Local.WindXMps, -20.0, 20.0, 0.5, "m/s",
                             1);
        ConstructParamSlider(State, Column, "CLOUDS", "ClWindY", "Wind Y", P.Local.WindYMps, -20.0, 20.0, 0.5, "m/s",
                             1);
    }
    else
    {
        ConstructParamSlider(State, Column, "CLOUDS", "ClWindX", "Wind X", P.Global.WindXMps, -20.0, 20.0, 0.5, "m/s",
                             1);
        ConstructParamSlider(State, Column, "CLOUDS", "ClWindY", "Wind Y", P.Global.WindYMps, -20.0, 20.0, 0.5, "m/s",
                             1);
        ConstructParamSlider(State, Column, "CLOUDS", "ClShadow", "Ground shadow opacity", P.Global.ShadowStrength, 0.0,
                             1.0, 0.02, "", 2);
    }
    SectionCard::End(Column);
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    ENTRY
//------------------------------------------------------------------------------------------------------------------------

void ConstructFractureWorkspaceInspector(FractureWorkspaceState& State, const EditorTypefaces& Faces, ControlColumn& Column)
{
    (void)Faces;
    if (State.Selected < 0 || State.Selected > 10) State.Selected = FractureWorkspaceState::SelectedConstruct0;
    ConstructObjectHeader(State, Column);

    const bool IsClouds = State.Selected == FractureWorkspaceState::SelectedCloudsGlobal ||
                          State.Selected == FractureWorkspaceState::SelectedCloudsLocal;
    if (!IsClouds)
    {
        static const char* FractureTabs[4]  = { "Overview", "Physics", "Bonds", "SDF" };
        static const char* SunTabs[4]       = { "Cycle & Arc", "Disc & Tint", "Coordinates", "Notice" };
        static const char* AtmosphereTabs[4] = { "LUT Bake", "Optical Curves", "Twilight & Extent", "Specs" };
        const char* const* Tabs = FractureTabs;
        if (State.Selected == FractureWorkspaceState::SelectedSun) Tabs = SunTabs;
        else if (State.Selected == FractureWorkspaceState::SelectedAtmosphere) Tabs = AtmosphereTabs;
        ImVec4 TabRects[4]{};
        (void)SelectPill::ConstructTabs(Column, "FractureTabs", Tabs, 4, State.InspectorTab, true, nullptr, TabRects);
        for (int Index = 0; Index < 4; ++Index)
        {
            char RectName[48]{};
            std::snprintf(RectName, sizeof(RectName), "Inspector/Tab%d", Index);
            RecordFractureWorkspaceRect(State, RectName, ImVec2(TabRects[Index].x, TabRects[Index].y),
                                        ImVec2(TabRects[Index].z, TabRects[Index].w));
        }
    }

    if (State.Selected >= 0 && State.Selected < 7)
    {
        if (State.InspectorTab == FractureWorkspaceState::TabPhysics) ConstructPhysicsTab(State, Column);
        else if (State.InspectorTab == FractureWorkspaceState::TabBonds) ConstructBondsTab(State, Column);
        else if (State.InspectorTab == FractureWorkspaceState::TabSdf) ConstructSdfTab(State, Column);
        else ConstructOverviewTab(State, Column);
        if (State.InspectorTab == FractureWorkspaceState::TabOverview) RecomputeActive(State);
    }
    else if (State.Selected == FractureWorkspaceState::SelectedSun) ConstructSunInspector(State, Column);
    else if (State.Selected == FractureWorkspaceState::SelectedAtmosphere) ConstructAtmosphereInspector(State, Column);
    else ConstructCloudsInspector(State, Column);
    CaptionText::Construct(Column, "Changes apply live ↗");
}

} // namespace Frontier
