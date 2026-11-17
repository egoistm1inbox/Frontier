/*==========================================================================================================================================
                                                          UVWORKSPACEINSPECTOR.CPP
==========================================================================================================================================*/
// 🧩 The UV Workspace inspector: the 4 prototype tabs (Packing with the space-budget hero + allocator + concave
//    engine, Unwrap & Edit with projections/relax/edges/pins/align, UDIMs with the tile matrix + tile properties,
//    Diagnostics with overlap/flip/stretch KPIs + repair) from Experimental Remastered/UVEditor/UVEditor.js. Value
//    controls edit the shell-local staged copies and log keyed PARAM lines. Every solver/filesystem-bound action
//    stays an explicit NOOP; UDIM matrix picks of live tiles switch the active tile silently.

#include "Engine/Interface/Workspaces/UvWorkspace.h"

#include "Engine/Interface/Controls/ActionRow.h"
#include "Engine/Interface/Controls/CaptionText.h"
#include "Engine/Interface/Controls/ChoiceRow.h"
#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/SectionCard.h"
#include "Engine/Interface/Controls/SelectPill.h"
#include "Engine/Interface/Controls/SliderPill.h"
#include "Engine/Interface/Controls/SwitchPill.h"

#include <cstdio>

namespace Frontier
{
namespace
{

void LogSliderValue(UvWorkspaceState& State, const char* Channel, const char* Label, double Value, int Digits,
                    const char* Unit)
{
    char Shown[64]{};
    if (Unit != nullptr && Unit[0] != '\0') std::snprintf(Shown, sizeof(Shown), "%.*f %s", Digits, Value, Unit);
    else std::snprintf(Shown, sizeof(Shown), "%.*f", Digits, Value);
    LogUvWorkspaceValue(State, Channel, Label, Shown);
}

bool ConstructParamSlider(UvWorkspaceState& State, ControlColumn& Column, const char* Channel, const char* Id,
                          const char* Label, double& Value, double Minimum, double Maximum, double Step,
                          const char* Unit, int Digits)
{
    if (!SliderPill::Construct(Column, Id, Label, Value, Minimum, Maximum, Step, Unit)) return false;
    LogSliderValue(State, Channel, Label, Value, Digits, Unit);
    return true;
}

bool ConstructParamToggle(UvWorkspaceState& State, ControlColumn& Column, const char* Channel, const char* Id,
                          const char* Label, const char* Detail, bool& Value)
{
    if (!SwitchPill::Construct(Column, Id, Label, Detail, Value)) return false;
    LogUvWorkspaceValue(State, Channel, Label, Value ? "on" : "off");
    return true;
}

bool ConstructParamSelect(UvWorkspaceState& State, ControlColumn& Column, const char* Channel, const char* Id,
                          const char* Label, int& Index, const char* const* Names, int Count)
{
    if (!SelectPill::Construct(Column, Id, Label, Names, Count, Index)) return false;
    LogUvWorkspaceValue(State, Channel, Label, Names[Index]);
    return true;
}

void ConstructCaption(ControlColumn& Column, const char* Text)
{
    CaptionText::Construct(Column, Text);
}

int QueryPickedCount(const UvWorkspaceState& State) noexcept
{
    int N = 0;
    const int Count = QueryUvIslandCount(State.Asset);
    for (int I = 0; I < Count && I < 32; ++I)
        if (State.IslandPicked[I]) ++N;
    return N;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    PACKING TAB
//------------------------------------------------------------------------------------------------------------------------

void ConstructPackingTab(UvWorkspaceState& State, ControlColumn& Column)
{
    const int Asset = State.Asset;
    char HeroTitle[48]{};
    std::snprintf(HeroTitle, sizeof(HeroTitle), "UDIM %d Space Budget", State.ActiveUdim);
    (void)SectionCard::Begin(Column, "UvPackHero", HeroTitle, "StudioLayers",
                             State.BudgetMode == UvWorkspaceState::BudgetStrict ? "STRICT RATIO" : "FILL POCKETS",
                             nullptr, State.OpenCards[UvWorkspaceState::CardPackHero]);
    if (State.OpenCards[UvWorkspaceState::CardPackHero])
    {
        char Line[160]{};
        std::snprintf(Line, sizeof(Line), "%.1f%% filled · %d islands on UDIM %d",
                      QueryUvTileOccupancy(Asset, State.ActiveUdim), QueryUvTileIslandCount(Asset, State.ActiveUdim),
                      State.ActiveUdim);
        ConstructCaption(Column, Line);
        const int Groups = QueryUvGroupCount(Asset);
        for (int G = 0; G < Groups; ++G)
        {
            std::snprintf(Line, sizeof(Line), "%s: %.1f%% actual / %.0f%% target · %d islands",
                          QueryUvGroup(Asset, G).Name, QueryUvGroupActualShare(Asset, G), State.GroupTarget[G],
                          QueryUvGroupIslandCount(Asset, G));
            ConstructCaption(Column, Line);
        }
        if (QueryUvRemainderIslandCount(Asset) > 0)
        {
            double Explicit = 0.0;
            for (int G = 0; G < Groups; ++G) Explicit += State.GroupTarget[G];
            std::snprintf(Line, sizeof(Line), "Remaining: %.1f%% actual / %.0f%% target · %d islands auto-fill",
                          QueryUvRemainderActualShare(Asset), 100.0 - Explicit > 0.0 ? 100.0 - Explicit : 0.0,
                          QueryUvRemainderIslandCount(Asset));
            ConstructCaption(Column, Line);
        }
        const int Picked = QueryPickedCount(State);
        std::snprintf(Line, sizeof(Line), "Selected islands: %d%s", Picked,
                      Picked > 0 ? " · ready to assign %" : " · click islands to group");
        ConstructCaption(Column, Line);
    }
    SectionCard::End(Column);

    (void)SectionCard::Begin(Column, "UvPackAllocator", "Importance Space Allocation", "StudioLayers", "TARGET %",
                             "Select islands (in 2D, 3D, or Outliner), assign a target UV space %, and remaining "
                             "islands automatically fill leftover space.",
                             State.OpenCards[UvWorkspaceState::CardPackAllocator]);
    if (State.OpenCards[UvWorkspaceState::CardPackAllocator])
    {
        static const char* Pcts[6]   = { "70%", "50%", "30%", "20%", "10%", "5%" };
        static const double Values[6] = { 70.0, 50.0, 30.0, 20.0, 10.0, 5.0 };
        int Quick = 2;
        for (int I = 0; I < 6; ++I)
            if (State.PendingGroupPct == Values[I]) Quick = I;
        if (ChoiceRow::Construct(Column, "UvQuickPct", "Quick target", Pcts, 6, Quick))
        {
            State.PendingGroupPct = Values[Quick];
            LogSliderValue(State, "GROUP", "Quick target", State.PendingGroupPct, 0, "%");
        }
        ConstructParamSlider(State, Column, "GROUP", "UvPendingPct", "Custom Target Space",
                             State.PendingGroupPct, 1.0, 95.0, 1.0, "%", 0);
        static const ActionItem AssignKeys[2] = {
            { "Assign to New Group", "StudioPlus", ActionTone::Accent },
            { "Unassign -> Remainder", nullptr, ActionTone::Default },
        };
        const int AssignFired = ActionRow::Construct(Column, "UvAssign", AssignKeys, 2);
        if (AssignFired == 0)
            NoopUvWorkspaceCommand(State, "GROUP", "Assign group refused",
                                   "Group assignment is a NOOP in this shell");
        else if (AssignFired == 1)
            NoopUvWorkspaceCommand(State, "GROUP", "Unassign refused", "Group assignment is a NOOP in this shell");
        const int Groups = QueryUvGroupCount(Asset);
        for (int G = 0; G < Groups; ++G)
        {
            char Label[96]{};
            std::snprintf(Label, sizeof(Label), "%s share", QueryUvGroup(Asset, G).Name);
            char Id[32]{};
            std::snprintf(Id, sizeof(Id), "UvGroupShare%d", G);
            ConstructParamSlider(State, Column, "GROUP", Id, Label, State.GroupTarget[G], 1.0, 100.0, 1.0, "%",
                                 0);
        }
    }
    SectionCard::End(Column);

    (void)SectionCard::Begin(Column, "UvPackEngine", "Concave Packing Engine", "StudioBoxes", "EXACT SHAPE",
                             nullptr, State.OpenCards[UvWorkspaceState::CardPackEngine]);
    if (State.OpenCards[UvWorkspaceState::CardPackEngine])
    {
        static const char* Budgets[2] = { "Strict Ratio", "Fill Pockets" };
        ConstructParamSelect(State, Column, "PACK", "UvBudgetMode", "Budget Enforcement", State.BudgetMode,
                             Budgets, 2);
        static const char* Scopes[4] = { "Active UDIM", "Per UDIM", "Auto-UDIM Spill", "Selected Only" };
        ConstructParamSelect(State, Column, "PACK", "UvPackScope", "UDIM Packing Scope", State.PackScope, Scopes,
                             4);
        ConstructParamSlider(State, Column, "PACK", "UvMargin", "Island Margin Padding", State.MarginPx, 0.0,
                             64.0, 1.0, "px", 0);
        static const char* Rots[4] = { "0° Locked", "90° Ortho", "45° Oct", "15° Fine" };
        ConstructParamSelect(State, Column, "PACK", "UvRotations", "Rotation Steps", State.Rotations, Rots, 4);
        ConstructParamToggle(State, Column, "PACK", "UvEqualize", "Equalize Intra-Group Scale",
                             "Match texel density inside each group", State.EqualizeWithinGroup);
        static const ActionItem PackKeys[1] = {
            { "Pack with Importance Budgets (Shift+P)", "StudioBoxes", ActionTone::Accent },
        };
        ImVec4 PackRects[1]{};
        const int PackFired =
            ActionRow::Construct(Column, "UvPack", PackKeys, 1, true, nullptr, ActionRowVoice::Charcoal, PackRects);
        RecordUvWorkspaceRect(State, "Inspector/Pack", ImVec2(PackRects[0].x, PackRects[0].y),
                              ImVec2(PackRects[0].z, PackRects[0].w));
        if (PackFired == 0)
            NoopUvWorkspaceCommand(State, "PACK", "Importance pack refused",
                                   "Importance packing is a NOOP in this shell");
    }
    SectionCard::End(Column);
}
//------------------------------------------------------------------------------------------------------------------------
//                                                    UNWRAP TAB
//------------------------------------------------------------------------------------------------------------------------
void FireUnwrapNoop(UvWorkspaceState& State, const char* Label)
{
    char Message[128]{};
    std::snprintf(Message, sizeof(Message), "%s refused", Label);
    NoopUvWorkspaceCommand(State, "UNWRAP", Message, "Unwrap solvers are NOOPs in this shell");
}
void ConstructUnwrapTab(UvWorkspaceState& State, ControlColumn& Column)
{
    (void)SectionCard::Begin(Column, "UvUnwrapOps", "Unwrap & Analytic Projections", "StudioCompass",
                             "BLENDER TOOLSET", nullptr, State.OpenCards[UvWorkspaceState::CardUnwrapOps]);
    if (State.OpenCards[UvWorkspaceState::CardUnwrapOps])
    {
        static const ActionItem RowA[2] = {
            { "LSCM Unwrap (U)", "StudioCompass", ActionTone::Accent },
            { "Smart UV Project", nullptr, ActionTone::Default },
        };
        const int FiredA = ActionRow::Construct(Column, "UvUnwrapA", RowA, 2);
        if (FiredA >= 0) FireUnwrapNoop(State, RowA[FiredA].Label);
        static const ActionItem RowB[4] = {
            { "Cube", nullptr, ActionTone::Default },
            { "Cylinder", nullptr, ActionTone::Default },
            { "Sphere", nullptr, ActionTone::Default },
            { "Follow Quads", nullptr, ActionTone::Default },
        };
        const int FiredB = ActionRow::Construct(Column, "UvUnwrapB", RowB, 4);
        if (FiredB >= 0) FireUnwrapNoop(State, RowB[FiredB].Label);
        static const ActionItem RowC[2] = {
            { "View Project", nullptr, ActionTone::Default },
            { "Reset UVs", nullptr, ActionTone::Default },
        };
        const int FiredC = ActionRow::Construct(Column, "UvUnwrapC", RowC, 2);
        if (FiredC >= 0) FireUnwrapNoop(State, RowC[FiredC].Label);
        ConstructParamSlider(State, Column, "UNWRAP", "UvSmartAngle", "Smart Project Angle Limit",
                             State.SmartAngleDeg, 10.0, 89.0, 1.0, "deg", 0);
        ConstructParamToggle(State, Column, "UNWRAP", "UvLiveUnwrap", "Live Unwrap",
                             "Re-solve LSCM continuously when pinning or moving pins", State.LiveUnwrap);
    }
    SectionCard::End(Column);
    (void)SectionCard::Begin(Column, "UvRelax", "Minimize Stretch & Texel Density", "StudioGauge", "PX/CM",
                             nullptr, State.OpenCards[UvWorkspaceState::CardRelax]);
    if (State.OpenCards[UvWorkspaceState::CardRelax])
    {
        ConstructParamSlider(State, Column, "RELAX", "UvRelaxIter", "Relax Iterations", State.RelaxIterations,
                             4.0, 60.0, 2.0, "it", 0);
        ConstructParamSlider(State, Column, "RELAX", "UvTargetTexel", "Target Texel Density",
                             State.TargetTexelDensity, 1.0, 64.0, 0.5, "px/cm", 1);
        static const ActionItem RowD[2] = {
            { "Minimize Stretch (Ctrl+V)", "StudioGauge", ActionTone::Default },
            { "Average Scale (Ctrl+A)", nullptr, ActionTone::Default },
        };
        const int FiredD = ActionRow::Construct(Column, "UvRelaxRow", RowD, 2);
        if (FiredD == 0)
            NoopUvWorkspaceCommand(State, "RELAX", "Minimize stretch refused",
                                   "Stretch relax is a NOOP in this shell");
        else if (FiredD == 1)
            NoopUvWorkspaceCommand(State, "SCALE", "Average scale refused",
                                   "Average scale is a NOOP in this shell");
        static const ActionItem RowE[1] = {
            { "Apply Target Texel Density", "StudioGauge", ActionTone::Default },
        };
        if (ActionRow::Construct(Column, "UvTexelRow", RowE, 1) == 0)
            NoopUvWorkspaceCommand(State, "TEXEL", "Apply texel density refused",
                                   "Texel scaling is a NOOP in this shell");
    }
    SectionCard::End(Column);
    char SeamBadge[32]{};
    std::snprintf(SeamBadge, sizeof(SeamBadge), "%d SEAMS", QueryUvAsset(State.Asset).Seams);
    (void)SectionCard::Begin(Column, "UvTopo", "Edges, Boundaries & Seams", "StudioActivity", SeamBadge,
                             "Select 2 Edge mode to click edges (Alt Loop, Ctrl+Alt Ring, Ctrl Shortest Path) or use "
                             "Seam Brush [K].",
                             State.OpenCards[UvWorkspaceState::CardTopo]);
    if (State.OpenCards[UvWorkspaceState::CardTopo])
    {
        ConstructParamSlider(State, Column, "SEAM", "UvSharpAngle", "Sharp Edge Angle Threshold",
                             State.SharpAngleDeg, 5.0, 120.0, 1.0, "deg", 0);
        static const ActionItem SelA[4] = {
            { "Edge Loop", nullptr, ActionTone::Default },
            { "Edge Ring", nullptr, ActionTone::Default },
            { "Boundary Loop", nullptr, ActionTone::Default },
            { "Sharp Edges", nullptr, ActionTone::Default },
        };
        const int FiredSelA = ActionRow::Construct(Column, "UvEdgeSelA", SelA, 4);
        if (FiredSelA >= 0)
        {
            char Message[128]{};
            std::snprintf(Message, sizeof(Message), "%s refused", SelA[FiredSelA].Label);
            NoopUvWorkspaceCommand(State, "SEAM", Message, "Edge ops are NOOPs in this shell");
        }
        static const ActionItem SelB[4] = {
            { "Select Seams", nullptr, ActionTone::Default },
            { "Open Mesh Bounds", nullptr, ActionTone::Default },
            { "Grow (+)", nullptr, ActionTone::Default },
            { "Shrink (-)", nullptr, ActionTone::Default },
        };
        const int FiredSelB = ActionRow::Construct(Column, "UvEdgeSelB", SelB, 4);
        if (FiredSelB >= 0)
        {
            char Message[128]{};
            std::snprintf(Message, sizeof(Message), "%s refused", SelB[FiredSelB].Label);
            NoopUvWorkspaceCommand(State, "SEAM", Message, "Edge ops are NOOPs in this shell");
        }
        static const ActionItem MarkA[3] = {
            { "Mark Seam", "StudioActivity", ActionTone::Accent },
            { "Clear Seam", nullptr, ActionTone::Default },
            { "Clear & Weld", nullptr, ActionTone::Default },
        };
        const int FiredMarkA = ActionRow::Construct(Column, "UvSeamMarkA", MarkA, 3);
        if (FiredMarkA >= 0)
        {
            char Message[128]{};
            std::snprintf(Message, sizeof(Message), "%s refused", MarkA[FiredMarkA].Label);
            NoopUvWorkspaceCommand(State, "SEAM", Message, "Seam edits are NOOPs in this shell");
        }
        static const ActionItem MarkB[3] = {
            { "Mark Bounds -> Seams", nullptr, ActionTone::Default },
            { "Mark Sharp -> Seams", nullptr, ActionTone::Default },
            { "Seams from Islands", nullptr, ActionTone::Default },
        };
        const int FiredMarkB = ActionRow::Construct(Column, "UvSeamMarkB", MarkB, 3);
        if (FiredMarkB >= 0)
        {
            char Message[128]{};
            std::snprintf(Message, sizeof(Message), "%s refused", MarkB[FiredMarkB].Label);
            NoopUvWorkspaceCommand(State, "SEAM", Message, "Seam edits are NOOPs in this shell");
        }
    }
    SectionCard::End(Column);
    (void)SectionCard::Begin(Column, "UvPinWeld", "Pins, Split, Stitch & Weld", "StudioCheck", "WELD / SPLIT",
                             nullptr, State.OpenCards[UvWorkspaceState::CardPinWeld]);
    if (State.OpenCards[UvWorkspaceState::CardPinWeld])
    {
        static const ActionItem PinRow[3] = {
            { "Pin (P)", nullptr, ActionTone::Default },
            { "Unpin (Alt+P)", nullptr, ActionTone::Default },
            { "Pin Boundary", nullptr, ActionTone::Default },
        };
        const int FiredPin = ActionRow::Construct(Column, "UvPinRow", PinRow, 3);
        if (FiredPin >= 0)
        {
            char Message[128]{};
            std::snprintf(Message, sizeof(Message), "%s refused", PinRow[FiredPin].Label);
            NoopUvWorkspaceCommand(State, "PIN", Message, "Pinning is a NOOP in this shell");
        }
        static const ActionItem WeldRow[3] = {
            { "Split Island (Y)", nullptr, ActionTone::Default },
            { "Stitch (V)", nullptr, ActionTone::Default },
            { "Merge / Weld (M)", nullptr, ActionTone::Default },
        };
        const int FiredWeld = ActionRow::Construct(Column, "UvWeldRow", WeldRow, 3);
        if (FiredWeld == 0)
            NoopUvWorkspaceCommand(State, "SPLIT", "Split refused", "Splitting is a NOOP in this shell");
        else if (FiredWeld == 1)
            NoopUvWorkspaceCommand(State, "STITCH", "Stitch refused", "Stitching is a NOOP in this shell");
        else if (FiredWeld == 2)
            NoopUvWorkspaceCommand(State, "WELD", "Weld refused", "Welding is a NOOP in this shell");
    }
    SectionCard::End(Column);
    (void)SectionCard::Begin(Column, "UvAlign", "Align, Straighten, Mirror & Rectify", "StudioGrid",
                             "UV PRECISION", nullptr, State.OpenCards[UvWorkspaceState::CardAlign]);
    if (State.OpenCards[UvWorkspaceState::CardAlign])
    {
        static const ActionItem AlignA[3] = {
            { "Align U Ctr", nullptr, ActionTone::Default },
            { "Align V Ctr", nullptr, ActionTone::Default },
            { "Straighten", nullptr, ActionTone::Default },
        };
        static const ActionItem AlignB[3] = {
            { "Align Min U", nullptr, ActionTone::Default },
            { "Align Max U", nullptr, ActionTone::Default },
            { "Rectify Quads", nullptr, ActionTone::Default },
        };
        static const ActionItem AlignC[3] = {
            { "Align Top V", nullptr, ActionTone::Default },
            { "Align Bot V", nullptr, ActionTone::Default },
            { "Mirror U", nullptr, ActionTone::Default },
        };
        const int FiredAlA = ActionRow::Construct(Column, "UvAlignA", AlignA, 3);
        const int FiredAlB = ActionRow::Construct(Column, "UvAlignB", AlignB, 3);
        const int FiredAlC = ActionRow::Construct(Column, "UvAlignC", AlignC, 3);
        const char* AlignLabel = nullptr;
        if (FiredAlA >= 0) AlignLabel = AlignA[FiredAlA].Label;
        else if (FiredAlB >= 0) AlignLabel = AlignB[FiredAlB].Label;
        else if (FiredAlC >= 0) AlignLabel = AlignC[FiredAlC].Label;
        if (AlignLabel != nullptr)
        {
            char Message[128]{};
            std::snprintf(Message, sizeof(Message), "%s refused", AlignLabel);
            NoopUvWorkspaceCommand(State, "ALIGN", Message, "Align ops are NOOPs in this shell");
        }
    }
    SectionCard::End(Column);
}
//------------------------------------------------------------------------------------------------------------------------
//                                                    UDIM TAB
//------------------------------------------------------------------------------------------------------------------------
void FormatResShort(int Resolution, char* Text, size_t Size) noexcept
{
    if (Resolution >= 1024) std::snprintf(Text, Size, "%dK", Resolution / 1024);
    else std::snprintf(Text, Size, "%d", Resolution);
}
void ConstructUdimTab(UvWorkspaceState& State, ControlColumn& Column)
{
    const int Asset = State.Asset;
    char MatrixBadge[32]{};
    std::snprintf(MatrixBadge, sizeof(MatrixBadge), "%d ACTIVE", QueryUvTileCount(Asset));
    (void)SectionCard::Begin(Column, "UvUdimMatrix", "UDIM Tile Matrix (1001+)", "StudioGrid", MatrixBadge,
                             "Mari / Blender UDIM addressing: 1001 + u + v*10. Click any live slot to focus it.",
                             State.OpenCards[UvWorkspaceState::CardUdimMatrix]);
    if (State.OpenCards[UvWorkspaceState::CardUdimMatrix])
    {
        for (int Row = 2; Row >= 0; --Row)
        {
            ActionItem Cells[4];
            char Labels[4][24]{};
            char Ids[4][24]{};
            int LiveIds[4] = { 0, 0, 0, 0 };
            for (int Col = 0; Col < 4; ++Col)
            {
                const int Id = 1001 + Col + Row * 10;
                const int Slot = QueryUvTileIndex(Asset, Id);
                LiveIds[Col] = Slot >= 0 ? Id : 0;
                if (Slot >= 0)
                {
                    char Res[8]{};
                    FormatResShort(QueryUvTile(Asset, Slot).Resolution, Res, sizeof(Res));
                    std::snprintf(Labels[Col], sizeof(Labels[Col]), "%d %s", Id, Res);
                }
                else std::snprintf(Labels[Col], sizeof(Labels[Col]), "%d +", Id);
                std::snprintf(Ids[Col], sizeof(Ids[Col]), "UvCell%d", Id);
                Cells[Col] = { Labels[Col], nullptr,
                               Id == State.ActiveUdim ? ActionTone::Accent : ActionTone::Default };
            }
            char RowId[24]{};
            std::snprintf(RowId, sizeof(RowId), "UvMatrixRow%d", Row);
            ImVec4 CellRects[4]{};
            const int Fired =
                ActionRow::Construct(Column, RowId, Cells, 4, true, nullptr, ActionRowVoice::Charcoal, CellRects);
            for (int Col = 0; Col < 4; ++Col)
            {
                const int Id = 1001 + Col + Row * 10;
                char Tag[40]{};
                std::snprintf(Tag, sizeof(Tag), "Inspector/Cell%d", Id);
                RecordUvWorkspaceRect(State, Tag, ImVec2(CellRects[Col].x, CellRects[Col].y),
                                      ImVec2(CellRects[Col].z, CellRects[Col].w));
            }
            if (Fired >= 0)
            {
                if (LiveIds[Fired] != 0) State.ActiveUdim = LiveIds[Fired]; // Silent focus.
                else
                {
                    char Message[64]{};
                    std::snprintf(Message, sizeof(Message), "Add UDIM %d refused", 1001 + Fired + Row * 10);
                    NoopUvWorkspaceCommand(State, "UDIM", Message, "Adding UDIM tiles is a NOOP in this shell");
                }
            }
        }
        static const ActionItem MoveRow[2] = {
            { "Move to Active UDIM", "StudioMove", ActionTone::Accent },
            { "Equalize Cross-UDIM Density", "StudioGauge", ActionTone::Default },
        };
        const int FiredMove = ActionRow::Construct(Column, "UvUdimMove", MoveRow, 2);
        if (FiredMove == 0)
            NoopUvWorkspaceCommand(State, "UDIM", "Move islands refused",
                                   "Moving islands is a NOOP in this shell");
        else if (FiredMove == 1)
            NoopUvWorkspaceCommand(State, "TEXEL", "Equalize density refused",
                                   "Density matching is a NOOP in this shell");
    }
    SectionCard::End(Column);
    const int ActiveSlot = QueryUvTileIndex(Asset, State.ActiveUdim);
    const int Slot = ActiveSlot >= 0 ? ActiveSlot : 0;
    const UvTileSpec& Tile = QueryUvTile(Asset, Slot);
    char TileTitle[48]{};
    std::snprintf(TileTitle, sizeof(TileTitle), "UDIM %d Properties", Tile.Id);
    (void)SectionCard::Begin(Column, "UvUdimTile", TileTitle, "StudioSliders", Tile.Label, nullptr,
                             State.OpenCards[UvWorkspaceState::CardUdimTile]);
    if (State.OpenCards[UvWorkspaceState::CardUdimTile])
    {
        static const char* ResNames[5] = { "512 px", "1024 px (1K)", "2048 px (2K)", "4096 px (4K)",
                                           "8192 px (8K)" };
        static const int ResValues[5] = { 512, 1024, 2048, 4096, 8192 };
        int ResIndex = 2;
        for (int I = 0; I < 5; ++I)
            if (State.TileRes[Slot] == ResValues[I]) ResIndex = I;
        if (SelectPill::Construct(Column, "UvTileRes", "Tile Texture Resolution", ResNames, 5, ResIndex))
        {
            State.TileRes[Slot] = ResValues[ResIndex];
            LogUvWorkspaceValue(State, "UDIM", "Tile Texture Resolution", ResNames[ResIndex]);
        }
        static const char* BackNames[4] = { "Color Calibration Grid", "UV Letter Grid", "Classic Checkerboard",
                                            "Solid Slate" };
        ConstructParamSelect(State, Column, "UDIM", "UvTileBacking", "Tile Backing Pattern",
                             State.TileBacking[Slot], BackNames, 4);
        char RemoveLabel[32]{};
        std::snprintf(RemoveLabel, sizeof(RemoveLabel), "Remove Tile");
        ActionItem TileKeys[2] = {
            { "Load Texture...", "StudioPlus", ActionTone::Default },
            { RemoveLabel, "StudioTrash", ActionTone::Danger, QueryUvTileCount(Asset) > 1,
              "At least 1 UDIM tile is required" },
        };
        const int FiredTile = ActionRow::Construct(Column, "UvTileKeys", TileKeys, 2);
        if (FiredTile == 0)
            NoopUvWorkspaceCommand(State, "UDIM", "Load texture refused",
                                   "Texture loading is a NOOP in this shell");
        else if (FiredTile == 1)
            NoopUvWorkspaceCommand(State, "UDIM", "Remove tile refused",
                                   "Removing UDIM tiles is a NOOP in this shell");
    }
    SectionCard::End(Column);
}
//------------------------------------------------------------------------------------------------------------------------
//                                                    DIAGNOSTICS TAB
//------------------------------------------------------------------------------------------------------------------------
void ConstructDiagnosticsTab(UvWorkspaceState& State, ControlColumn& Column)
{
    const int Asset = State.Asset;
    char Overlaps[96]{}, Flipped[96]{}, Stretch[96]{};
    std::snprintf(Overlaps, sizeof(Overlaps), "Overlapping faces: %d · Clean non-overlapping",
                  QueryUvOverlapCount(Asset));
    std::snprintf(Flipped, sizeof(Flipped), "Flipped winding: %d · All positive facing",
                  QueryUvFlippedCount(Asset));
    std::snprintf(Stretch, sizeof(Stretch), "Mean angle stretch: %.1f%% · %d islands audited",
                  QueryUvAsset(Asset).MeanStretchPct, QueryUvIslandCount(Asset));
    ConstructCaption(Column, Overlaps);
    ConstructCaption(Column, Flipped);
    ConstructCaption(Column, Stretch);
    (void)SectionCard::Begin(Column, "UvDiagRepair", "UV Integrity & Repair", "StudioCheck",
                             QueryUvOverlapCount(Asset) ? "ATTENTION" : "CLEAN", nullptr,
                             State.OpenCards[UvWorkspaceState::CardDiagRepair]);
    if (State.OpenCards[UvWorkspaceState::CardDiagRepair])
    {
        static const ActionItem SelRow[2] = {
            { "Select Overlaps", "StudioCheck", ActionTone::Default },
            { "Select Flipped", nullptr, ActionTone::Default },
        };
        ImVec4 SelRects[2]{};
        const int FiredSel =
            ActionRow::Construct(Column, "UvDiagSel", SelRow, 2, true, nullptr, ActionRowVoice::Charcoal, SelRects);
        RecordUvWorkspaceRect(State, "Inspector/SelectOverlaps", ImVec2(SelRects[0].x, SelRects[0].y),
                              ImVec2(SelRects[0].z, SelRects[0].w));
        RecordUvWorkspaceRect(State, "Inspector/SelectFlipped", ImVec2(SelRects[1].x, SelRects[1].y),
                              ImVec2(SelRects[1].z, SelRects[1].w));
        if (FiredSel == 0)
        {
            State.Lens = UvWorkspaceState::LensOverlap; // Silent lens focus; the set is empty (0 overlaps).
            AppendUvWorkspaceLog(State, "SELECT", "Selected 0 overlapping faces");
        }
        else if (FiredSel == 1)
        {
            State.Lens = UvWorkspaceState::LensOverlap;
            AppendUvWorkspaceLog(State, "SELECT", "Selected 0 flipped faces");
        }
        static const ActionItem FixRow[2] = {
            { "Flip UV Winding", nullptr, ActionTone::Default },
            { "Auto-Relax & Repack", nullptr, ActionTone::Accent },
        };
        ImVec4 FixRects[2]{};
        const int FiredFix =
            ActionRow::Construct(Column, "UvDiagFix", FixRow, 2, true, nullptr, ActionRowVoice::Charcoal, FixRects);
        RecordUvWorkspaceRect(State, "Inspector/FlipWinding", ImVec2(FixRects[0].x, FixRects[0].y),
                              ImVec2(FixRects[0].z, FixRects[0].w));
        RecordUvWorkspaceRect(State, "Inspector/AutoRepair", ImVec2(FixRects[1].x, FixRects[1].y),
                              ImVec2(FixRects[1].z, FixRects[1].w));
        if (FiredFix == 0)
            NoopUvWorkspaceCommand(State, "TOPO", "Flip winding refused",
                                   "Winding flips are NOOPs in this shell");
        else if (FiredFix == 1)
            NoopUvWorkspaceCommand(State, "PACK", "Auto-relax & repack refused",
                                   "Auto repair is a NOOP in this shell");
    }
    SectionCard::End(Column);
}
} // namespace
//------------------------------------------------------------------------------------------------------------------------
//                                                    ENTRY
//------------------------------------------------------------------------------------------------------------------------
void ConstructUvWorkspaceInspector(UvWorkspaceState& State, const EditorTypefaces& Faces, ControlColumn& Column)
{
    (void)Faces;
    if (State.InspectorTab == UvWorkspaceState::TabPacking) ConstructPackingTab(State, Column);
    else if (State.InspectorTab == UvWorkspaceState::TabUnwrap) ConstructUnwrapTab(State, Column);
    else if (State.InspectorTab == UvWorkspaceState::TabUdim) ConstructUdimTab(State, Column);
    else ConstructDiagnosticsTab(State, Column);
}
} // namespace Frontier
