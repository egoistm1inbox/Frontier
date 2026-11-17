/*==========================================================================================================================================
                                                           FRACTUREWORKSPACE.CPP
==========================================================================================================================================*/
// The Fracture Studio root workspace: catalogue, solver-backed shard stage, transport, inspector, and Jolt runtime
// integration. Recipe edits are deterministic and logged; native fracture commands update measured results and, when
// supplied, an isolated rigid-body world. The matrix sheet remains a child window so its keys receive presses over
// the inspector child; the veil dismisses on outside presses.

#include "Engine/Interface/Workspaces/FractureWorkspace.h"

#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/ControlTheme.h"
#include "Engine/Interface/Controls/GlyphRun.h"
#include "Engine/Interface/Controls/GlyphSymbol.h"
#include "Engine/Interface/Controls/Toast.h"
#include "Engine/Interface/InspectorControls.h"

#include <imgui_internal.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

namespace Frontier
{
namespace
{

constexpr float PiSingle = 3.14159265358979f;

//------------------------------------------------------------------------------------------------------------------------
//                                                    SMALL HELPERS
//------------------------------------------------------------------------------------------------------------------------

void RecordRect(FractureWorkspaceState& State, const char* Name, ImVec2 Min, ImVec2 Max)
{
    State.Rects[Name] = ImVec4(Min.x, Min.y, Max.x, Max.y);
}

struct PanelCursor
{
    ImDrawList*            DrawList = nullptr;
    const EditorTypefaces* Faces    = nullptr;
    float                  S        = 1.0f;
    float                  X        = 0.0f;
    float                  Width    = 0.0f;
    float                  Y        = 0.0f;

    ImVec2 Space(float CssHeight, float MarginTop = 0.0f, float MarginBottom = 0.0f)
    {
        Y += MarginTop * S;
        const ImVec2 Top(X, Y);
        Y += CssHeight * S + MarginBottom * S;
        return Top;
    }

    [[nodiscard]] float Measure(ImFont* Face, float Size, const char* Text, float Tracking = 0.0f) const
    {
        return GlyphRun::Rasterize(nullptr, Faces, Face, Size * S, ImVec2(0.0f, 0.0f), 0, Text, Tracking * S, true);
    }

    float Text(ImFont* Face, float Size, float AtX, float Top, float LineHeight, ImU32 Colour, const char* Content,
               float Tracking = 0.0f) const
    {
        return GlyphRun::Rasterize(DrawList, Faces, Face, Size * S, ImVec2(AtX, GlyphRun::ResolveBaseline(Top, Size * S, LineHeight)),
                                   Colour, Content, Tracking * S, false);
    }
};

bool InvisibleRect(const char* Id, ImVec2 Min, ImVec2 Max)
{
    ImGui::SetCursorScreenPos(Min);
    return ImGui::InvisibleButton(Id, ImVec2(Max.x - Min.x, Max.y - Min.y), ImGuiButtonFlags_EnableNav);
}

bool QueryMatches(const char* Haystack, const std::string& Needle)
{
    if (Needle.empty() || Haystack == nullptr) return true;
    const size_t HayLength    = std::strlen(Haystack);
    const size_t NeedleLength = Needle.size();
    if (NeedleLength > HayLength) return false;
    for (size_t Start = 0; Start + NeedleLength <= HayLength; ++Start)
    {
        bool Hit = true;
        for (size_t Index = 0; Index < NeedleLength; ++Index)
        {
            const char Hay = Haystack[Start + Index];
            const char Want = Needle[Index];
            const char HayLow  = Hay >= 'A' && Hay <= 'Z' ? static_cast<char>(Hay + 32) : Hay;
            const char WantLow = Want >= 'A' && Want <= 'Z' ? static_cast<char>(Want + 32) : Want;
            if (HayLow != WantLow) Hit = false;
        }
        if (Hit) return true;
    }
    return false;
}

uint32_t HashU32(uint32_t X) noexcept
{
    X ^= X >> 16;
    X *= 0x7FEB352Du;
    X ^= X >> 15;
    X *= 0x846CA68Bu;
    X ^= X >> 16;
    return X;
}

// 📝 Viewport-bar select: current value pill plus a popup list. Popup-only option rects.
bool ConstructBarSelect(FractureWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, const char* Id,
                        const char* RectTag, const char* Label, const char* const* Options, int Count, int& InOutIndex,
                        ImVec2 Min, float Wide, const char* Channel = nullptr, const char* LogLabel = nullptr)
{
    PanelCursor Cursor{ DrawList, &Faces, 1.0f, Min.x, Wide, Min.y };
    const ImVec2 Max(Min.x + Wide, Min.y + 29.0f);
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x0E0F12D6), 10.0f);
    DrawList->AddRect(Min, Max, ResolveCssColour(0xFFFFFF12), 10.0f, ImDrawFlags_None, 1.0f);
    char Line[96]{};
    std::snprintf(Line, sizeof(Line), "%s: %s", Label, Options[InOutIndex]);
    Cursor.Text(Faces.Medium, 11.0f, Min.x + 10.0f, Min.y + 14.5f - 0.5f * 11.0f * 1.38f, 1.38f,
                ResolveCssColour(0xBCBCBCFF), Line);
    (void)GlyphSymbol::Construct(DrawList, "StudioChevron", ImVec2(Max.x - 20.0f, Min.y + 8.5f), 12.0f, 1.8f,
                                 ResolveCssColour(0x848484FF));
    bool Changed = false;
    ImGui::PushID(Id);
    RecordRect(State, RectTag, Min, Max);
    if (InvisibleRect("##BarSelect", Min, Max)) ImGui::OpenPopup("##BarOptions");

    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(4.0f, 4.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 10.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 1.0f);
    ImGui::PushStyleColor(ImGuiCol_PopupBg, ImGui::ColorConvertU32ToFloat4(ResolveCssColour(0x161616FF)));
    ImGui::PushStyleColor(ImGuiCol_Border, ImGui::ColorConvertU32ToFloat4(ResolveCssColour(0xFFFFFF24)));
    ImGui::SetNextWindowPos(ImVec2(Min.x, Max.y + 4.0f));
    ImGui::SetNextWindowSize(ImVec2(Wide, 0.0f));
    if (ImGui::BeginPopup("##BarOptions", ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoSavedSettings))
    {
        ImDrawList* const PopupList = ImGui::GetWindowDrawList();
        const ImVec2      ListMin   = ImGui::GetCursorScreenPos();
        constexpr float   RowTall   = 30.0f;
        const float       ListWide  = Wide - 8.0f;
        for (int Index = 0; Index < Count; ++Index)
        {
            const ImVec2 RowMin(ListMin.x, ListMin.y + Index * RowTall);
            const ImVec2 RowMax(RowMin.x + ListWide, RowMin.y + RowTall);
            const bool   CurrentRow = Index == InOutIndex;
            if (CurrentRow) PopupList->AddRectFilled(RowMin, RowMax, ResolveCssColour(0xE8C27A1F), 7.0f);
            (void)GlyphRun::Rasterize(PopupList, &Faces, Faces.Regular, 11.0f,
                                      ImVec2(RowMin.x + 10.0f,
                                             GlyphRun::ResolveBaseline(RowMin.y + 0.5f * (RowTall - 11.0f * 1.38f), 11.0f, 1.38f)),
                                      ResolveCssColour(CurrentRow ? 0xE8C27AFF : 0xD8D8D8FF), Options[Index], 0.0f, false);
            char OptionTag[64]{};
            std::snprintf(OptionTag, sizeof(OptionTag), "%s/Option%d", RectTag, Index);
            RecordRect(State, OptionTag, RowMin, RowMax);
            ImGui::SetCursorScreenPos(RowMin);
            ImGui::PushID(Index);
            if (ImGui::InvisibleButton("##BarOption", ImVec2(ListWide, RowTall), ImGuiButtonFlags_EnableNav))
            {
                InOutIndex = Index;
                Changed    = true;
                if (Channel != nullptr && LogLabel != nullptr)
                    LogFractureWorkspaceValue(State, Channel, LogLabel, Options[Index]);
                ImGui::CloseCurrentPopup();
            }
            ImGui::PopID();
        }
        ImGui::SetCursorScreenPos(ImVec2(ListMin.x, ListMin.y + Count * RowTall));
        ImGui::Dummy(ImVec2(1.0f, 1.0f));
        ImGui::EndPopup();
    }
    ImGui::PopStyleColor(2);
    ImGui::PopStyleVar(3);
    ImGui::PopID();
    return Changed;
}

void ConstructSearchBox(FractureWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, const char* Id,
                        const char* RectTag, ImVec2 Min, ImVec2 Max, const char* Hint, std::string& Query)
{
    PanelCursor Cursor{ DrawList, &Faces, 1.0f, Min.x, Max.x - Min.x, Min.y };
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x0E0F12D6), 10.0f);
    DrawList->AddRect(Min, Max, ResolveCssColour(0xFFFFFF12), 10.0f, ImDrawFlags_None, 1.0f);
    (void)GlyphSymbol::Construct(DrawList, "StudioSearch", ImVec2(Min.x + 9.0f, Min.y + 0.5f * (Max.y - Min.y) - 6.0f), 12.0f,
                                 1.8f, ResolveCssColour(0x5E5E5EFF));
    if (Query.empty())
    {
        Cursor.Text(Faces.Regular, 11.0f, Min.x + 28.0f, Min.y + 0.5f * (Max.y - Min.y) - 0.5f * 11.0f * 1.4f, 1.4f,
                    ResolveCssColour(0x5E5E5EFF), Hint);
    }
    ImGui::PushID(Id);
    RecordRect(State, RectTag, Min, Max);
    char Buffer[128]{};
    std::snprintf(Buffer, sizeof(Buffer), "%s", Query.c_str());
    ImGui::SetCursorScreenPos(ImVec2(Min.x + 26.0f, Min.y + 2.0f));
    ImGui::SetNextItemWidth(Max.x - Min.x - 32.0f);
    ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0, 0, 0, 0));
    ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 0.0f);
    ImGui::PushStyleColor(ImGuiCol_Text, ImGui::ColorConvertU32ToFloat4(ResolveCssColour(0xD8D8D8FF)));
    if (ImGui::InputText("##Search", Buffer, sizeof(Buffer), ImGuiInputTextFlags_EscapeClearsAll)) Query = Buffer;
    ImGui::PopStyleColor(2);
    ImGui::PopStyleVar();
    ImGui::PopID();
}

ImU32 QueryNodeAccent(const FractureWorkspaceState& State, int Node) noexcept
{
    if (Node >= 0 && Node < 7) return ResolveCssColour(QueryFractureMaterial(State.Constructs[Node].Spec.Material).Exterior);
    if (Node == FractureWorkspaceState::SelectedSun) return ResolveCssColour(0xE8C27AFF);
    if (Node == FractureWorkspaceState::SelectedAtmosphere) return ResolveCssColour(0x9FC7E8FF);
    if (Node == FractureWorkspaceState::SelectedCloudsGlobal) return ResolveCssColour(0x8FD3C4FF);
    return ResolveCssColour(0x3EC46DFF);
}

const char* QueryNodeName(const FractureWorkspaceState& State, int Node) noexcept
{
    if (Node >= 0 && Node < 7) return State.Constructs[Node].Title.c_str();
    if (Node == FractureWorkspaceState::SelectedSun) return "Directional Sun";
    if (Node == FractureWorkspaceState::SelectedAtmosphere) return "Sky Atmosphere";
    if (Node == FractureWorkspaceState::SelectedCloudsGlobal) return "Global Cloud Slab";
    return "Local Cloud Volume";
}

bool QueryNodeShown(const FractureWorkspaceState& State, int Node)
{
    if (State.OutlinerFilter == FractureWorkspaceState::FilterSolids && (Node < 0 || Node >= 7)) return false;
    if (State.OutlinerFilter == FractureWorkspaceState::FilterSky && Node < 7) return false;
    if (State.OutlinerFilter == FractureWorkspaceState::FilterBaked)
    {
        if (Node < 0 || Node >= 7 || !State.Constructs[Node].BakedResident) return false;
    }
    return QueryMatches(QueryNodeName(State, Node), State.OutlinerQuery);
}


Fracture::SolidKind ResolveWorkspaceSolid(const FractureWorkspaceConstruct& Construct) noexcept
{
    if (Construct.SolidCategory == "curtain_pane") return Fracture::SolidKind::CurtainPane;
    if (Construct.SolidCategory == "timber_beam") return Fracture::SolidKind::TimberBeam;
    if (Construct.SolidCategory == "boulder") return Fracture::SolidKind::Boulder;
    if (Construct.SolidCategory == "hollow_core") return Fracture::SolidKind::HollowCore;
    if (Construct.SolidCategory == "cube") return Fracture::SolidKind::Cube;
    if (Construct.SolidCategory == "cylinder") return Fracture::SolidKind::Cylinder;
    if (Construct.SolidCategory == "cone") return Fracture::SolidKind::Cone;
    return Fracture::SolidKind::Monolith;
}

Fracture::Polyhedron ResolveWorkspaceBase(const FractureWorkspaceConstruct& Construct)
{
    return Fracture::ConstructSolid(ResolveWorkspaceSolid(Construct), { 1.0, 1.0, 1.0 },
                                    static_cast<uint32_t>(std::max(1, Construct.Spec.Seed)));
}

Fracture::Request ResolveWorkspaceRequest(const FractureWorkspaceConstruct& Construct) noexcept
{
    Fracture::Request Request;
    Request.Algorithm = static_cast<Fracture::Solver>(std::clamp(Construct.Spec.Solver, 0, 5));
    Request.EnergyJoules = Construct.Spec.Energy;
    Request.Seed = static_cast<uint32_t>(std::max(1, Construct.Spec.Seed));
    Request.FragmentCeiling = static_cast<uint32_t>(std::clamp(Construct.Spec.Ceiling, 2, 256));
    Request.MinimumPieceSizeMetres = Construct.Spec.MinimumSize;
    Request.GrainAngleDegrees = Construct.Spec.GrainAngleDeg;
    Request.BondStrengthScale = Construct.Spec.BondStrengthScale;
    Request.ImpactPointMetres = { Construct.Spec.ImpactPoint[0], Construct.Spec.ImpactPoint[1], Construct.Spec.ImpactPoint[2] };
    Request.ImpactNormal = { Construct.Spec.ImpactNormal[0], Construct.Spec.ImpactNormal[1], Construct.Spec.ImpactNormal[2] };
    return Request;
}

Fracture::Material ResolveWorkspaceMaterial(const FractureWorkspaceConstruct& Construct) noexcept
{
    return Fracture::ResolveMaterialById(QueryFractureMaterial(Construct.Spec.Material).Id);
}

uint64_t ResolveWorkspaceRecipeHash(const FractureWorkspaceConstruct& Construct) noexcept
{
    uint64_t Hash = 1469598103934665603ull;
    const auto Fold = [&Hash](const void* Bytes, size_t Count)
    {
        const auto* Data = static_cast<const unsigned char*>(Bytes);
        for (size_t Index = 0; Index < Count; ++Index)
        {
            Hash ^= Data[Index];
            Hash *= 1099511628211ull;
        }
    };
    const auto Add = [&Fold](const auto& Value) { Fold(&Value, sizeof(Value)); };
    const size_t CategorySize = Construct.SolidCategory.size();
    Add(CategorySize);
    Fold(Construct.SolidCategory.data(), CategorySize);
    Add(Construct.Spec.Solver);
    Add(Construct.Spec.Material);
    Add(Construct.Spec.Energy);
    Add(Construct.Spec.Seed);
    Add(Construct.Spec.Ceiling);
    Add(Construct.Spec.MinimumSize);
    Add(Construct.Spec.GrainAngleDeg);
    Add(Construct.Spec.BondStrengthScale);
    Fold(Construct.Spec.ImpactPoint, sizeof(Construct.Spec.ImpactPoint));
    Fold(Construct.Spec.ImpactNormal, sizeof(Construct.Spec.ImpactNormal));
    return Hash == 0 ? 1 : Hash;
}

bool RuntimeMatchesActiveRecipe(const FractureWorkspaceState& State) noexcept
{
    return State.Runtime != nullptr && State.Runtime->QueryPhysicsReady() &&
           State.RuntimeConstructIndex == State.ActiveConstruct &&
           State.RuntimeRecipeHash == ResolveWorkspaceRecipeHash(State.Constructs[State.ActiveConstruct]);
}

void RememberActiveRuntimeRecipe(FractureWorkspaceState& State) noexcept
{
    State.RuntimeConstructIndex = State.ActiveConstruct;
    State.RuntimeRecipeHash = ResolveWorkspaceRecipeHash(State.Constructs[State.ActiveConstruct]);
}

bool BakeActiveFracture(FractureWorkspaceState& State, const char* Channel, bool ShowToast = true)
{
    FractureWorkspaceConstruct& Construct = State.Constructs[State.ActiveConstruct];
    const Fracture::Polyhedron Base = ResolveWorkspaceBase(Construct);
    const Fracture::Request Request = ResolveWorkspaceRequest(Construct);
    const Fracture::Material Material = ResolveWorkspaceMaterial(Construct);
    if (State.Runtime != nullptr)
    {
        if (!State.Runtime->Bake(Base, Request, Material, &State.RuntimeDiagnostic))
        {
            AppendFractureWorkspaceLog(State, Channel, "Native bake refused", State.RuntimeDiagnostic.c_str());
            if (ShowToast) Toast::Show(State.RuntimeDiagnostic.c_str());
            return false;
        }
        ApplyFractureSolverResult(Construct, State.Runtime->QueryResult());
    }
    else
    {
        RecomputeFractureReceipt(Construct);
        if (!Construct.NativeResultValid)
        {
            State.RuntimeDiagnostic = Construct.NativeResult.Diagnostic;
            AppendFractureWorkspaceLog(State, Channel, "Native partition refused", State.RuntimeDiagnostic.c_str());
            if (ShowToast) Toast::Show(State.RuntimeDiagnostic.c_str());
            return false;
        }
    }
    if (State.Runtime != nullptr) RememberActiveRuntimeRecipe(State);
    Construct.BakedResident = true;
    State.BakeExecuted = true;
    State.RuntimeDiagnostic.clear();
    char Detail[128]{};
    std::snprintf(Detail, sizeof(Detail), "%d convex pieces · %.2f ms%s", Construct.Receipt.FragmentCount,
                  Construct.Receipt.StepMilliseconds, State.Runtime != nullptr ? " · Jolt world ready" : "");
    AppendFractureWorkspaceLog(State, Channel, "Native fracture bake complete", Detail);
    if (ShowToast) Toast::Show(State.Runtime != nullptr ? "Fracture baked into Jolt" : "Native fracture partition baked");
    return true;
}

bool StrikeActiveFracture(FractureWorkspaceState& State, const Fracture::Vec3* OptionalPoint = nullptr)
{
    FractureWorkspaceConstruct& Construct = State.Constructs[State.ActiveConstruct];
    const bool RuntimeWasCurrent = RuntimeMatchesActiveRecipe(State);
    if (OptionalPoint != nullptr)
    {
        for (int Axis = 0; Axis < 3; ++Axis) Construct.Spec.ImpactPoint[Axis] = (*OptionalPoint)[Axis];
    }
    const Fracture::Request Request = ResolveWorkspaceRequest(Construct);
    const Fracture::Material Material = ResolveWorkspaceMaterial(Construct);
    const Fracture::Polyhedron Base = ResolveWorkspaceBase(Construct);
    bool Success = false;
    if (State.Runtime != nullptr && RuntimeWasCurrent)
        Success = State.Runtime->Strike(Request.ImpactPointMetres, Request.ImpactNormal, Request.EnergyJoules,
                                        &State.RuntimeDiagnostic);
    else if (State.Runtime != nullptr)
        Success = State.Runtime->Bake(Base, Request, Material, &State.RuntimeDiagnostic);
    else
    {
        RecomputeFractureReceipt(Construct);
        Success = Construct.NativeResultValid;
        State.RuntimeDiagnostic = Success ? std::string{} : Construct.NativeResult.Diagnostic;
    }
    if (!Success)
    {
        AppendFractureWorkspaceLog(State, "STRIKE", "Native strike refused", State.RuntimeDiagnostic.c_str());
        Toast::Show(State.RuntimeDiagnostic.empty() ? "Native strike failed" : State.RuntimeDiagnostic.c_str());
        return false;
    }
    if (State.Runtime != nullptr)
    {
        ApplyFractureSolverResult(Construct, State.Runtime->QueryResult());
        RememberActiveRuntimeRecipe(State);
    }
    Construct.BakedResident = true;
    State.StrikeExecuted = true;
    State.RuntimeDiagnostic.clear();
    AppendFractureWorkspaceLog(State, "STRIKE", "Impact solved and Jolt shards released",
                               State.Runtime != nullptr ? "partition · convex hulls · impact velocities · Jolt 5.6" : "native partition solved");
    Toast::Show(State.Runtime != nullptr ? "Impact solved · Jolt shards released" : "Native fracture solved");
    return true;
}

void StepActiveFracturePhysics(FractureWorkspaceState& State, double DeltaSeconds)
{
    if (State.Runtime == nullptr) return;
    if (!RuntimeMatchesActiveRecipe(State) && !BakeActiveFracture(State, "BAKE", false)) return;
    State.Runtime->Step(DeltaSeconds, 2);
    State.PhysicsStepExecuted = true;
    State.TimelineActive = std::clamp(State.TimelineActive + DeltaSeconds, 0.0, State.TimelineDuration);
    ApplyFractureSolverResult(State.Constructs[State.ActiveConstruct], State.Runtime->QueryResult());
}

void ReassembleActiveFracture(FractureWorkspaceState& State)
{
    State.TimelinePlaying = false;
    State.TimelineActive = 0.0;
    State.ExplodeAmount = 0.0;
    if (State.Runtime != nullptr)
    {
        if (!RuntimeMatchesActiveRecipe(State) && !BakeActiveFracture(State, "BAKE", false)) return;
        if (!State.Runtime->Reassemble(&State.RuntimeDiagnostic))
        {
            AppendFractureWorkspaceLog(State, "SCENE", "Reassemble refused", State.RuntimeDiagnostic.c_str());
            Toast::Show(State.RuntimeDiagnostic.c_str());
            return;
        }
        ApplyFractureSolverResult(State.Constructs[State.ActiveConstruct], State.Runtime->QueryResult());
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    TOP BAR
//------------------------------------------------------------------------------------------------------------------------

void ConstructTopBar(FractureWorkspaceState& State, PanelCursor& Root)
{
    const EditorTypefaces& Faces    = *Root.Faces;
    ImDrawList* const      DrawList = Root.DrawList;
    const ImVec2           Bar      = Root.Space(46.0f, 0.0f, 8.0f);
    const float            Left     = Bar.x;
    const float            Right    = Bar.x + Root.Width;

    Root.Text(Faces.SemiBold, 15.0f, Left, Bar.y + 23.0f - 0.5f * 15.0f * 1.3f, 1.3f, ResolveCssColour(0xF1F1F1FF),
              "frontier.", -0.3f);
    const float ChipWide = Root.Measure(Faces.SemiBold, 9.0f, "FRACTURE", 0.9f) + 16.0f;
    const float ChipX    = Left + Root.Measure(Faces.SemiBold, 15.0f, "frontier.", -0.3f) + 8.0f;
    DrawList->AddRectFilled(ImVec2(ChipX, Bar.y + 13.0f), ImVec2(ChipX + ChipWide, Bar.y + 33.0f),
                            ResolveCssColour(0xE8C27A22), 10.0f);
    DrawList->AddRect(ImVec2(ChipX, Bar.y + 13.0f), ImVec2(ChipX + ChipWide, Bar.y + 33.0f),
                      ResolveCssColour(0xE8C27A55), 10.0f, ImDrawFlags_None, 1.0f);
    Root.Text(Faces.SemiBold, 9.0f, ChipX + 8.0f, Bar.y + 23.0f - 0.5f * 9.0f * 1.4f, 1.4f,
              ResolveCssColour(0xE8C27AFF), "FRACTURE", 0.9f);

    // 📝 Construct tabs: silent local selection, like the outliner rows.
    static const char* Shorts[7] = { "Pillar", "Glazing", "Pane", "Erratic", "Beam", "Vault", "Drum" };
    float              TabX      = ChipX + ChipWide + 18.0f;
    for (int Tab = 0; Tab < 7; ++Tab)
    {
        const float  TabWide = Root.Measure(Faces.Medium, 11.0f, Shorts[Tab]) + 26.0f;
        const ImVec2 TabMin(TabX, Bar.y + 8.0f);
        const ImVec2 TabMax(TabX + TabWide, Bar.y + 38.0f);
        const bool   Active = State.ActiveConstruct == Tab && State.Selected == Tab;
        DrawList->AddRectFilled(TabMin, TabMax, ResolveCssColour(Active ? 0xE8C27A26 : 0x1E1E1EFF), 15.0f);
        DrawList->AddRect(TabMin, TabMax, ResolveCssColour(Active ? 0xE8C27A66 : 0xFFFFFF14), 15.0f, ImDrawFlags_None,
                          1.0f);
        DrawList->AddCircleFilled(ImVec2(TabMin.x + 13.0f, Bar.y + 23.0f), 3.5f, QueryNodeAccent(State, Tab), 12);
        Root.Text(Faces.Medium, 11.0f, TabMin.x + 21.0f, Bar.y + 23.0f - 0.5f * 11.0f * 1.38f, 1.38f,
                  ResolveCssColour(Active ? 0xE8C27AFF : 0xBCBCBCFF), Shorts[Tab]);
        char TabTag[32]{};
        std::snprintf(TabTag, sizeof(TabTag), "TopBar/Tab%d", Tab);
        ImGui::PushID(100 + Tab);
        RecordRect(State, TabTag, TabMin, TabMax);
        if (InvisibleRect("##DocTab", TabMin, TabMax)) SelectFractureWorkspaceNode(State, Tab);
        ImGui::PopID();
        TabX = TabMax.x + 6.0f;
    }
    {
        const ImVec2 AddMin(TabX, Bar.y + 8.0f);
        const ImVec2 AddMax(TabX + 30.0f, Bar.y + 38.0f);
        DrawList->AddRectFilled(AddMin, AddMax, ResolveCssColour(0x1A1A1AFF), 15.0f);
        (void)GlyphSymbol::Construct(DrawList, "StudioPlus", ImVec2(AddMin.x + 9.0f, AddMin.y + 9.0f), 12.0f, 1.8f,
                                     ResolveCssColour(0xBCBCBCFF));
        RecordRect(State, "TopBar/Add", AddMin, AddMax);
        if (InvisibleRect("##TopBarAdd", AddMin, AddMax))
            NoopFractureWorkspaceCommand(State, "SCENE", "Spawn solid refused", "Spawning solids is a NOOP in this shell");
    }

    struct SuiteKey
    {
        const char* Tag;
        const char* Label;
        const char* Count;
        bool        Active;
    };
    char LogCount[16]{};
    std::snprintf(LogCount, sizeof(LogCount), "%d", static_cast<int>(State.Log.size()));
    const SuiteKey Keys[3] = {
        { "TopBar/Workspace", "Workspace", nullptr, !State.MatrixOpen && !State.LogOpen },
        { "TopBar/Solvers", "Solvers", "6", State.MatrixOpen },
        { "TopBar/Log", "Log Stream", LogCount, State.LogOpen },
    };
    float KeyX = TabX + 44.0f;
    for (int Index = 0; Index < 3; ++Index)
    {
        const float KeyWide = Root.Measure(Faces.Medium, 11.5f, Keys[Index].Label) + (Keys[Index].Count ? 34.0f : 24.0f);
        const ImVec2 KeyMin(KeyX, Bar.y + 8.0f);
        const ImVec2 KeyMax(KeyX + KeyWide, Bar.y + 38.0f);
        if (Keys[Index].Active) DrawList->AddRectFilled(KeyMin, KeyMax, ResolveCssColour(0xFFFFFF10), 15.0f);
        Root.Text(Faces.Medium, 11.5f, KeyMin.x + 12.0f, Bar.y + 23.0f - 0.5f * 11.5f * 1.38f, 1.38f,
                  ResolveCssColour(Keys[Index].Active ? 0xEFEFEFFF : 0x848484FF), Keys[Index].Label);
        if (Keys[Index].Count != nullptr)
            Root.Text(Faces.Regular, 10.0f, KeyMax.x - 22.0f, Bar.y + 23.0f - 0.5f * 10.0f * 1.4f, 1.4f,
                      ResolveCssColour(0x5E5E5EFF), Keys[Index].Count);
        ImGui::PushID(200 + Index);
        RecordRect(State, Keys[Index].Tag, KeyMin, KeyMax);
        if (InvisibleRect("##SuiteKey", KeyMin, KeyMax))
        {
            if (Index == 0)
            {
                State.MatrixOpen = false;
                State.LogOpen    = false;
                State.LeaveRequested = true;
            }
            else if (Index == 1) State.MatrixOpen = true;
            else State.LogOpen = !State.LogOpen;
        }
        ImGui::PopID();
        KeyX = KeyMax.x + 6.0f;
    }

    const float ExportWide = Root.Measure(Faces.Medium, 11.5f, "Export TOML") + 28.0f;
    const ImVec2 ExportMax(Right, Bar.y + 38.0f);
    const ImVec2 ExportMin(ExportMax.x - ExportWide, Bar.y + 8.0f);
    DrawList->AddRectFilled(ExportMin, ExportMax, ResolveCssColour(0xE8C27AFF), 15.0f);
    Root.Text(Faces.Medium, 11.5f, ExportMin.x + 14.0f, Bar.y + 23.0f - 0.5f * 11.5f * 1.38f, 1.38f,
              ResolveCssColour(0x1A1A1AFF), "Export TOML");
    RecordRect(State, "TopBar/Export", ExportMin, ExportMax);
    if (InvisibleRect("##TopBarExport", ExportMin, ExportMax))
        NoopFractureWorkspaceCommand(State, "EXPORT", "Export TOML refused", "Export is a NOOP in this shell");

    const ImVec2 HelpMax(ExportMin.x - 8.0f, Bar.y + 38.0f);
    const ImVec2 HelpMin(HelpMax.x - 30.0f, Bar.y + 8.0f);
    DrawList->AddRectFilled(HelpMin, HelpMax, ResolveCssColour(0x1A1A1AFF), 15.0f);
    (void)GlyphSymbol::Construct(DrawList, "StudioHelp", ImVec2(HelpMin.x + 9.0f, HelpMin.y + 9.0f), 12.0f, 1.8f,
                                 ResolveCssColour(0xBCBCBCFF));
    RecordRect(State, "TopBar/Help", HelpMin, HelpMax);
    if (InvisibleRect("##TopBarHelp", HelpMin, HelpMax))
        NoopFractureWorkspaceCommand(State, "SCENE", "Help refused", "Help is a NOOP in this shell");

    const char* EngineStatus = RuntimeMatchesActiveRecipe(State) ? "NATIVE · JOLT" : "NATIVE · CPU";
    const float EngineWide = Root.Measure(Faces.SemiBold, 9.5f, EngineStatus, 0.9f) + 30.0f;
    const ImVec2 EngineMax(HelpMin.x - 8.0f, Bar.y + 33.0f);
    const ImVec2 EngineMin(EngineMax.x - EngineWide, Bar.y + 13.0f);
    DrawList->AddRectFilled(EngineMin, EngineMax, ResolveCssColour(0x7FD08A1F), 10.0f);
    DrawList->AddCircleFilled(ImVec2(EngineMin.x + 12.0f, Bar.y + 23.0f), 3.5f, ResolveCssColour(0x7FD08AFF), 12);
    Root.Text(Faces.SemiBold, 9.5f, EngineMin.x + 20.0f, Bar.y + 23.0f - 0.5f * 9.5f * 1.4f, 1.4f,
              ResolveCssColour(0x7FD08AFF), EngineStatus, 0.9f);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    OUTLINER
//------------------------------------------------------------------------------------------------------------------------

void ConstructOutlinerPanel(FractureWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Min, ImVec2 Max)
{
    ImDrawList* const DrawList = ImGui::GetWindowDrawList();
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x121212FF), 22.0f);
    DrawList->AddRect(Min, Max, ResolveCssColour(0xFFFFFF0E), 22.0f, ImDrawFlags_None, 1.0f);
    PanelCursor Panel{ DrawList, &Faces, 1.0f, Min.x + 14.0f, Max.x - Min.x - 28.0f, Min.y + 12.0f };

    const ImVec2 Head = Panel.Space(34.0f);
    Panel.Text(Faces.Light, 15.0f, Head.x, Head.y, 1.3f, ResolveCssColour(0xEFEFEFFF), "Outliner");
    int Shown = 0;
    for (int Node = 0; Node <= 10; ++Node)
        if (QueryNodeShown(State, Node)) ++Shown;
    char Subtitle[64]{};
    std::snprintf(Subtitle, sizeof(Subtitle), "SceneDirectory · %d nodes", Shown);
    Panel.Text(Faces.Regular, 10.0f, Head.x, Head.y + 20.0f, 1.4f, ResolveCssColour(0x5E5E5EFF), Subtitle);

    int TotalShards = 0, Baked = 0;
    for (int I = 0; I < 7; ++I)
    {
        TotalShards += State.Constructs[I].Receipt.FragmentCount;
        if (State.Constructs[I].BakedResident) ++Baked;
    }
    const ImVec2 Census = Panel.Space(46.0f, 6.0f, 6.0f);
    const float  TileWide = (Panel.Width - 8.0f) * 0.5f;
    for (int Tile = 0; Tile < 2; ++Tile)
    {
        const ImVec2 TileMin(Census.x + Tile * (TileWide + 8.0f), Census.y);
        const ImVec2 TileMax(TileMin.x + TileWide, Census.y + 46.0f);
        DrawList->AddRectFilled(TileMin, TileMax, ResolveCssColour(0x1E1E1EFF), 12.0f);
        (void)GlyphSymbol::Construct(DrawList, Tile == 0 ? "StudioCheck" : "StudioArchive",
                                     ImVec2(TileMin.x + 10.0f, TileMin.y + 10.0f), 12.0f, 1.8f,
                                     ResolveCssColour(Tile == 0 ? 0x7FD08AFF : 0xE8C27AFF));
        Panel.Text(Faces.Regular, 10.0f, TileMin.x + 28.0f, TileMin.y + 6.0f, 1.4f, ResolveCssColour(0x848484FF),
                   Tile == 0 ? "Shards" : "Baked");
        char Figure[24]{};
        std::snprintf(Figure, sizeof(Figure), "%d", Tile == 0 ? TotalShards : Baked);
        Panel.Text(Faces.SemiBold, 14.0f, TileMin.x + 28.0f, TileMin.y + 20.0f, 1.3f,
                   ResolveCssColour(0xEFEFEFFF), Figure);
    }

    const ImVec2 Search = Panel.Space(32.0f, 0.0f, 6.0f);
    ConstructSearchBox(State, Faces, DrawList, "OutlinerSearch", "Outliner/Search", Search,
                       ImVec2(Search.x + Panel.Width, Search.y + 32.0f), "Search directory…", State.OutlinerQuery);

    static const char* Filters[4] = { "All", "Solids", "Sky", "Baked" };
    const ImVec2       FilterRow  = Panel.Space(26.0f, 0.0f, 6.0f);
    float              FilterX    = FilterRow.x;
    for (int Index = 0; Index < 4; ++Index)
    {
        const float  ChipWide = Panel.Measure(Faces.Medium, 10.5f, Filters[Index]) + 22.0f;
        const ImVec2 ChipMin(FilterX, FilterRow.y);
        const ImVec2 ChipMax(FilterX + ChipWide, FilterRow.y + 26.0f);
        const bool   Active = State.OutlinerFilter == Index;
        DrawList->AddRectFilled(ChipMin, ChipMax, ResolveCssColour(Active ? 0xE8C27A26 : 0x1A1A1AFF), 13.0f);
        Panel.Text(Faces.Medium, 10.5f, ChipMin.x + 11.0f, FilterRow.y + 13.0f - 0.5f * 10.5f * 1.38f, 1.38f,
                   ResolveCssColour(Active ? 0xE8C27AFF : 0x848484FF), Filters[Index]);
        char RectName[48]{};
        std::snprintf(RectName, sizeof(RectName), "Outliner/Filter%d", Index);
        ImGui::PushID(300 + Index);
        RecordRect(State, RectName, ChipMin, ChipMax);
        if (InvisibleRect("##OutlinerFilter", ChipMin, ChipMax)) State.OutlinerFilter = Index;
        ImGui::PopID();
        FilterX = ChipMax.x + 6.0f;
    }

    static const char* Morphs[6] = { "cumulus", "stratocumulus", "cirrus", "cumulonimbus", "stratus", "altocumulus" };
    int                Listed    = 0;
    for (int Node = 0; Node <= 10; ++Node)
    {
        if (!QueryNodeShown(State, Node)) continue;
        const ImVec2 RowMin(Panel.X, Panel.Y);
        const ImVec2 RowMax(Panel.X + Panel.Width, Panel.Y + 48.0f);
        Panel.Y += 50.0f;
        const bool     Current = State.Selected == Node;
        const ImU32    Accent  = QueryNodeAccent(State, Node);
        if (Current) DrawList->AddRectFilled(RowMin, RowMax, ResolveCssColour(0xE8C27A14), 12.0f);
        DrawList->AddCircleFilled(ImVec2(RowMin.x + 14.0f, RowMin.y + 24.0f), 5.0f, Accent, 16);
        Panel.Text(Faces.Medium, 11.5f, RowMin.x + 28.0f, RowMin.y + 6.0f, 1.38f, ResolveCssColour(0xEFEFEFFF),
                   QueryNodeName(State, Node));

        char Sub[96]{}, Pill[32]{};
        ImU32 PillColour = ResolveCssColour(0x848484FF);
        if (Node < 7)
        {
            const FractureWorkspaceConstruct& Cst = State.Constructs[Node];
            std::snprintf(Sub, sizeof(Sub), "%s · %s", QueryFractureMaterial(Cst.Spec.Material).Id,
                          QueryFractureSolver(Cst.Spec.Solver).Id);
            if (Cst.Pipeline == "baked")
            {
                std::snprintf(Pill, sizeof(Pill), "Baked");
                PillColour = ResolveCssColour(0xE8C27AFF);
            }
            else if (Cst.Pipeline == "hybrid")
            {
                std::snprintf(Pill, sizeof(Pill), "Bonds");
                PillColour = ResolveCssColour(0x9FC7E8FF);
            }
            else
            {
                std::snprintf(Pill, sizeof(Pill), "Live");
                PillColour = ResolveCssColour(0x7FD08AFF);
            }
        }
        else if (Node == FractureWorkspaceState::SelectedSun)
        {
            std::snprintf(Pill, sizeof(Pill), "%.1fh", State.Sun.LocalHours);
            std::snprintf(Sub, sizeof(Sub), "El %.1f° · AM %.2f", State.SunSolved.ElevationDeg, State.SunSolved.AirMass);
            PillColour = ResolveCssColour(0xE8C27AFF);
        }
        else if (Node == FractureWorkspaceState::SelectedAtmosphere)
        {
            std::snprintf(Pill, sizeof(Pill), "%s", State.Atmos.BakedFetchEnabled ? "LUT ON" : "Analytic");
            std::snprintf(Sub, sizeof(Sub), "REV #%d", State.Atmos.BakedRevision);
            PillColour = ResolveCssColour(0x9FC7E8FF);
        }
        else if (Node == FractureWorkspaceState::SelectedCloudsGlobal)
        {
            std::snprintf(Pill, sizeof(Pill), "%s", Morphs[State.Clouds.Global.Morphology]);
            std::snprintf(Sub, sizeof(Sub), "%d%% cov · %.0f m", static_cast<int>(std::round(State.Clouds.Global.Coverage * 100.0)),
                          State.Clouds.Global.BaseHeightM);
            PillColour = ResolveCssColour(0x8FD3C4FF);
        }
        else
        {
            std::snprintf(Pill, sizeof(Pill), "%s", State.Clouds.Local.Enabled ? "Active" : "Muted");
            std::snprintf(Sub, sizeof(Sub), "box %.1f × %.1f × %.1f m", State.Clouds.Local.HalfExtentX * 2.0,
                          State.Clouds.Local.HalfExtentY * 2.0, State.Clouds.Local.HalfExtentZ * 2.0);
            PillColour = ResolveCssColour(0x3EC46DFF);
        }
        Panel.Text(Faces.Regular, 10.0f, RowMin.x + 28.0f, RowMin.y + 24.0f, 1.4f, ResolveCssColour(0x848484FF), Sub);
        const float PillWide = Panel.Measure(Faces.SemiBold, 9.0f, Pill, 0.6f) + 16.0f;
        const ImVec2 PillMax(RowMax.x - (Node == FractureWorkspaceState::SelectedSun ? 10.0f : 40.0f), RowMin.y + 34.0f);
        const ImVec2 PillMin(PillMax.x - PillWide, RowMin.y + 14.0f);
        DrawList->AddRectFilled(PillMin, PillMax, ResolveCssColour(0xFFFFFF0C), 10.0f);
        Panel.Text(Faces.SemiBold, 9.0f, PillMin.x + 8.0f, RowMin.y + 24.0f - 0.5f * 9.0f * 1.4f, 1.4f, PillColour, Pill,
                   0.6f);

        ImGui::PushID(400 + Node);
        if (Node != FractureWorkspaceState::SelectedSun)
        {
            // 📝 The eye submits before the row so it wins its own presses within this window.
            bool NodeOn = true;
            if (Node < 7) NodeOn = State.Constructs[Node].BakedResident;
            else if (Node == FractureWorkspaceState::SelectedAtmosphere) NodeOn = State.Atmos.BakedFetchEnabled;
            else if (Node == FractureWorkspaceState::SelectedCloudsGlobal) NodeOn = State.Clouds.Global.Enabled;
            else NodeOn = State.Clouds.Local.Enabled;
            const ImVec2 EyeMax(RowMax.x - 8.0f, RowMin.y + 36.0f);
            const ImVec2 EyeMin(EyeMax.x - 26.0f, RowMin.y + 12.0f);
            (void)GlyphSymbol::Construct(DrawList, NodeOn ? "StudioEye" : "StudioEyeOff",
                                         ImVec2(EyeMin.x + 6.0f, EyeMin.y + 5.0f), 14.0f, 1.6f,
                                         ResolveCssColour(NodeOn ? 0xBCBCBCFF : 0x5E5E5EFF));
            char EyeTag[48]{};
            std::snprintf(EyeTag, sizeof(EyeTag), "Outliner/Eye%d", Node);
            RecordRect(State, EyeTag, EyeMin, EyeMax);
            if (InvisibleRect("##NodeEye", EyeMin, EyeMax))
            {
                if (Node < 7)
                {
                    State.Constructs[Node].BakedResident = !State.Constructs[Node].BakedResident;
                    LogFractureWorkspaceValue(State, "PARAM", "Baked resident",
                                               State.Constructs[Node].BakedResident ? "on" : "off");
                }
                else if (Node == FractureWorkspaceState::SelectedAtmosphere)
                {
                    State.Atmos.BakedFetchEnabled = !State.Atmos.BakedFetchEnabled;
                    LogFractureWorkspaceValue(State, "PARAM", "Baked fetch",
                                               State.Atmos.BakedFetchEnabled ? "on" : "off");
                }
                else if (Node == FractureWorkspaceState::SelectedCloudsGlobal)
                {
                    State.Clouds.Global.Enabled = !State.Clouds.Global.Enabled;
                    LogFractureWorkspaceValue(State, "PARAM", "Global enabled",
                                               State.Clouds.Global.Enabled ? "on" : "off");
                }
                else
                {
                    State.Clouds.Local.Enabled = !State.Clouds.Local.Enabled;
                    LogFractureWorkspaceValue(State, "PARAM", "Local enabled",
                                               State.Clouds.Local.Enabled ? "on" : "off");
                }
            }
        }
        char RowTag[48]{};
        std::snprintf(RowTag, sizeof(RowTag), "Outliner/Row%d", Node);
        RecordRect(State, RowTag, RowMin, RowMax);
        if (InvisibleRect("##NodeRow", RowMin, RowMax)) SelectFractureWorkspaceNode(State, Node);
        ImGui::PopID();
        ++Listed;
    }

    if (Listed == 0)
    {
        const ImVec2 Empty = Panel.Space(20.0f, 4.0f, 0.0f);
        Panel.Text(Faces.Regular, 11.0f, Empty.x, Empty.y, 1.4f, ResolveCssColour(0x5E5E5EFF), "No matching nodes.");
    }
    const ImVec2 Foot = Panel.Space(16.0f, 6.0f, 0.0f);
    Panel.Text(Faces.Regular, 10.0f, Foot.x, Foot.y, 1.4f, ResolveCssColour(0x5E5E5EFF),
               "Native partitions · isolated Jolt shard world");
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    PRESET LIBRARY
//------------------------------------------------------------------------------------------------------------------------

void ConstructLibraryPanel(FractureWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Min, ImVec2 Max,
                         AssetBrowserLink* Link)
{
    ImDrawList* const DrawList = ImGui::GetWindowDrawList();
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x121212FF), 22.0f);
    DrawList->AddRect(Min, Max, ResolveCssColour(0xFFFFFF0E), 22.0f, ImDrawFlags_None, 1.0f);
    PanelCursor Panel{ DrawList, &Faces, 1.0f, Min.x + 14.0f, Max.x - Min.x - 28.0f, Min.y + 12.0f };

    const ImVec2 Head = Panel.Space(24.0f);
    Panel.Text(Faces.Medium, 11.5f, Head.x, Head.y, 1.38f, ResolveCssColour(0xD8D8D8FF), "Solid & solver presets");
    char Count[16]{};
    std::snprintf(Count, sizeof(Count), "27");
    Panel.Text(Faces.Regular, 10.5f, Head.x + Panel.Measure(Faces.Medium, 11.5f, "Solid & solver presets") + 8.0f,
               Head.y + 1.0f, 1.4f, ResolveCssColour(0x5E5E5EFF), Count);
    const float MatrixWide = Panel.Measure(Faces.Medium, 10.5f, "Matrix ↗") + 18.0f;
    const ImVec2 MatrixMax(Head.x + Panel.Width, Head.y + 24.0f);
    const ImVec2 MatrixMin(MatrixMax.x - MatrixWide, Head.y);
    Panel.Text(Faces.Medium, 10.5f, MatrixMin.x + 9.0f, Head.y + 4.0f, 1.38f, ResolveCssColour(0xE8C27AFF),
               "Matrix ↗");
    RecordRect(State, "Library/Matrix", MatrixMin, MatrixMax);
    if (InvisibleRect("##LibraryMatrix", MatrixMin, MatrixMax)) State.MatrixOpen = true;

    // 📝 The spawn gallery moved out to the shared Asset Browser; the panel keeps its chrome and hands off.
    {
        const ImVec2 Browse = Panel.Space(64.0f, 6.0f, 0.0f);
        const ImVec2 BrowseMin(Browse.x, Browse.y);
        const ImVec2 BrowseMax(Browse.x + Panel.Width, Browse.y + 64.0f);
        DrawList->AddRectFilled(BrowseMin, BrowseMax, ResolveCssColour(0x1E1E1EFF), 12.0f);
        DrawList->AddRect(BrowseMin, BrowseMax, ResolveCssColour(0xE8C27A66), 12.0f, ImDrawFlags_None, 1.0f);
        Panel.Text(Faces.Medium, 12.5f, BrowseMin.x + 14.0f, BrowseMin.y + 9.0f, 1.35f, ResolveCssColour(0xE8C27AFF),
                   "Browse fracture assets\u2026");
        Panel.Text(Faces.Regular, 10.0f, BrowseMin.x + 14.0f, BrowseMin.y + 32.0f, 1.4f, ResolveCssColour(0x848484FF),
                   "Materials \u00B7 solvers \u00B7 presets \u00B7 constructs");
        Panel.Text(Faces.Medium, 13.0f, BrowseMax.x - 30.0f, BrowseMin.y + 19.0f, 1.35f, ResolveCssColour(0xE8C27AFF),
                   "\u2197");
        RecordRect(State, "Library/Browse", BrowseMin, BrowseMax);
        if (InvisibleRect("##LibraryBrowse", BrowseMin, BrowseMax))
        {
            if (Link != nullptr)
            {
                Link->OpenRequested = true;
                Link->OpenWorkspace = AssetBrowserWorkspaceFracture;
            }
            else Toast::Show("The Asset Browser is not attached in this shell.");
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    VIEWPORT BAR + STAGE
//------------------------------------------------------------------------------------------------------------------------
//                                                    VIEWPORT BAR + STAGE
//------------------------------------------------------------------------------------------------------------------------

void ConstructViewportBar(FractureWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 Min,
                          ImVec2 Max)
{
    PanelCursor            Bar{ DrawList, &Faces, 1.0f, Min.x, Max.x - Min.x, Min.y };
    FractureWorkspaceConstruct& Cst = State.Constructs[State.ActiveConstruct];
    const float            MidY = Min.y + 23.0f;

    DrawList->AddCircleFilled(ImVec2(Min.x + 20.0f, MidY), 4.0f, ResolveCssColour(0x7FD08AFF), 12);
    Bar.Text(Faces.SemiBold, 10.0f, Min.x + 30.0f, MidY - 14.0f, 1.4f, ResolveCssColour(0x7FD08AFF), "LIVE", 0.9f);
    const char* ViewTitle = State.CubeComparisonOpen ? "Cube Solver Comparison" : Cst.Title.c_str();
    Bar.Text(Faces.Medium, 12.5f, Min.x + 30.0f, MidY - 2.0f, 1.35f, ResolveCssColour(0xEFEFEFFF), ViewTitle);
    char Sub[128]{};
    if (State.CubeComparisonOpen)
        std::snprintf(Sub, sizeof(Sub), "same concrete cube · six native algorithms");
    else
        std::snprintf(Sub, sizeof(Sub), "%s · %s", QueryFractureMaterial(Cst.Spec.Material).Label,
                      QueryFractureSolver(Cst.Spec.Solver).Id);
    const float SubWide = Bar.Measure(Faces.Regular, 10.5f, Sub);

    static const char* Pipes[3] = { "Realtime", "Eng.Bake", "Hybrid Bonds" };
    int                Pipe     = Cst.Pipeline == "baked" ? 1 : (Cst.Pipeline == "hybrid" ? 2 : 0);
    static const char* Lenses[4]  = { "PBR", "Stress", "Bonds", "SDF" };
    static const char* Cameras[4] = { "Perspective", "Front", "Side", "Top" };
    float              KeyX       = Max.x - 14.0f;
    auto               IconKey = [&](const char* Id, const char* RectTag, const char* Glyph) {
        const ImVec2 KeyMax(KeyX, Min.y + 38.0f);
        const ImVec2 KeyMin(KeyX - 30.0f, Min.y + 8.0f);
        KeyX -= 38.0f;
        DrawList->AddRectFilled(KeyMin, KeyMax, ResolveCssColour(0x1A1A1AFF), 10.0f);
        (void)GlyphSymbol::Construct(DrawList, Glyph, ImVec2(KeyMin.x + 8.0f, KeyMin.y + 8.0f), 14.0f, 1.8f,
                                     ResolveCssColour(0xBCBCBCFF));
        RecordRect(State, RectTag, KeyMin, KeyMax);
        return InvisibleRect(Id, KeyMin, KeyMax);
    };
    // 📝 Right cluster submits right-to-left so the recorded rects never overlap the caption.
    if (IconKey("##ViewportMaximize", "Viewport/Maximize", "StudioMaximize"))
        NoopFractureWorkspaceCommand(State, "VIEW", "Maximize refused", "Maximize is a NOOP in this shell");
    if (IconKey("##ViewportFocus", "Viewport/Focus", "StudioFocus"))
        NoopFractureWorkspaceCommand(State, "VIEW", "Focus refused", "Focus is a NOOP in this shell");
    KeyX -= 138.0f;
    ConstructBarSelect(State, Faces, DrawList, "Camera", "Viewport/Camera", "Cam", Cameras, 4, State.Camera,
                       ImVec2(KeyX, Min.y + 8.5f), 130.0f);
    KeyX -= 128.0f;
    ConstructBarSelect(State, Faces, DrawList, "Lens", "Viewport/Lens", "Lens", Lenses, 4, State.Lens,
                       ImVec2(KeyX, Min.y + 8.5f), 120.0f);
    KeyX -= 158.0f;
    if (ConstructBarSelect(State, Faces, DrawList, "Pipeline", "Viewport/Pipeline", "Pipe", Pipes, 3, Pipe,
                           ImVec2(KeyX, Min.y + 8.5f), 150.0f, "PARAM", "Pipeline"))
    {
        Cst.Pipeline    = Pipe == 1 ? "baked" : (Pipe == 2 ? "hybrid" : "realtime");
        Cst.Spec.Solver = Pipe == 0 ? 0 : (Pipe == 1 ? 1 : Cst.Spec.Solver);
        RecomputeFractureReceipt(Cst);
    }
    if (!State.CubeComparisonOpen)
        Bar.Text(Faces.Regular, 10.5f, Min.x + 30.0f + Bar.Measure(Faces.Medium, 12.5f, ViewTitle) + 10.0f,
                 MidY - 2.0f, 1.4f, ResolveCssColour(0x848484FF), Sub);
    (void)SubWide;
}

void EnsureCubeComparison(FractureWorkspaceState& State)
{
    if (State.CubeComparisonReady) return;
    const Fracture::Polyhedron Cube = Fracture::ConstructSolid(Fracture::SolidKind::Cube, {1.0, 1.0, 1.0}, 42u);
    const Fracture::Material Concrete = Fracture::ResolveMaterial(Fracture::MaterialKind::Concrete);
    for (int Solver = 0; Solver < 6; ++Solver)
    {
        Fracture::Request Request;
        Request.Algorithm = static_cast<Fracture::Solver>(Solver);
        Request.EnergyJoules = 3900.0;
        Request.MinimumPieceSizeMetres = 0.045;
        Request.Seed = 42u;
        Request.FragmentCeiling = 24u;
        Request.ImpactPointMetres = {0.12, -0.18, 0.47};
        Request.ImpactNormal = {0.0, 0.0, -1.0};
        State.CubeComparisonResults[Solver] = Fracture::Execute(Cube, Request, Concrete);
    }
    State.CubeComparisonReady = true;
}

std::vector<ImVec2> ResolveProjectedHull(const std::vector<ImVec2>& Points)
{
    if (Points.size() < 3) return Points;
    std::vector<ImVec2> Sorted = Points;
    std::sort(Sorted.begin(), Sorted.end(), [](const ImVec2& A, const ImVec2& B) {
        return A.x == B.x ? A.y < B.y : A.x < B.x;
    });
    std::vector<ImVec2> Hull;
    Hull.reserve(Sorted.size() * 2);
    auto Cross = [](const ImVec2& O, const ImVec2& A, const ImVec2& B) {
        return (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);
    };
    for (const ImVec2& Point : Sorted)
    {
        while (Hull.size() >= 2 && Cross(Hull[Hull.size() - 2], Hull.back(), Point) <= 0.01f) Hull.pop_back();
        Hull.push_back(Point);
    }
    const size_t Lower = Hull.size();
    for (auto Point = Sorted.rbegin() + 1; Point != Sorted.rend(); ++Point)
    {
        while (Hull.size() > Lower && Cross(Hull[Hull.size() - 2], Hull.back(), *Point) <= 0.01f) Hull.pop_back();
        Hull.push_back(*Point);
    }
    if (!Hull.empty()) Hull.pop_back();
    return Hull;
}

void ConstructCubeComparisonStage(FractureWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList,
                                  ImVec2 Min, ImVec2 Max)
{
    EnsureCubeComparison(State);
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x0B0B0BFF));
    const float Gap = 8.0f;
    const float CellWidth = (Max.x - Min.x - Gap * 4.0f) / 3.0f;
    const float CellHeight = (Max.y - Min.y - Gap * 3.0f) / 2.0f;
    const ImU32 Palette[6] = {ResolveCssColour(0xE8C27AFF), ResolveCssColour(0x7FB6E8FF), ResolveCssColour(0xD78FE8FF),
                              ResolveCssColour(0x70D1A3FF), ResolveCssColour(0xE88666FF), ResolveCssColour(0x9BB0C7FF)};
    DrawList->PushClipRect(Min, Max, true);
    for (int Solver = 0; Solver < 6; ++Solver)
    {
        const int Column = Solver % 3;
        const int Row = Solver / 3;
        const ImVec2 CellMin(Min.x + Gap + Column * (CellWidth + Gap), Min.y + Gap + Row * (CellHeight + Gap));
        const ImVec2 CellMax(CellMin.x + CellWidth, CellMin.y + CellHeight);
        const Fracture::Result& Result = State.CubeComparisonResults[Solver];
        DrawList->AddRectFilled(CellMin, CellMax, ResolveCssColour(0x12161BFF), 8.0f);
        DrawList->AddRect(CellMin, CellMax, ResolveCssColour(0xFFFFFF1C), 8.0f);
        PanelCursor Text{DrawList, &Faces, 1.0f, CellMin.x, CellWidth, CellMin.y};
        const char* Name = QueryFractureSolver(Solver).Name;
        Text.Text(Faces.SemiBold, 11.0f, CellMin.x + 9.0f, CellMin.y + 8.0f, 1.3f, ResolveCssColour(0xEFEFEFFF), Name);
        char Count[64]{};
        std::snprintf(Count, sizeof(Count), "%d shards", Result.Success ? static_cast<int>(Result.Fragments.size()) : 0);
        Text.Text(Faces.Regular, 9.0f, CellMin.x + 9.0f, CellMin.y + 25.0f, 1.4f,
                  ResolveCssColour(Result.Success ? 0x9A9A9AFF : 0xE88666FF), Result.Success ? Count : "solver failed");
        if (Result.Success)
        {
            struct ProjectedShard { std::vector<ImVec2> Hull; double Depth = 0.0; uint32_t Index = 0; };
            std::vector<ProjectedShard> Shards;
            Shards.reserve(Result.Fragments.size());
            const double Scale = std::min(static_cast<double>(CellWidth * 0.23f), static_cast<double>(CellHeight * 0.34f));
            const double CentreX = 0.5 * (CellMin.x + CellMax.x);
            const double CentreY = CellMin.y + CellHeight * 0.61f;
            for (const Fracture::Fragment& Fragment : Result.Fragments)
            {
                Fracture::Vec3 Radial{Fragment.ShapeMetrics.Centroid[0], Fragment.ShapeMetrics.Centroid[1], Fragment.ShapeMetrics.Centroid[2]};
                const double Length = std::max(1.0e-8, std::sqrt(Radial[0] * Radial[0] + Radial[1] * Radial[1] + Radial[2] * Radial[2]));
                for (double& Component : Radial) Component /= Length;
                const double Scatter = 0.10 + 0.035 * static_cast<double>(Fragment.Index % 4u);
                std::vector<ImVec2> Points;
                Points.reserve(Fragment.Shape.Vertices.size());
                for (const Fracture::Vec3& Vertex : Fragment.Shape.Vertices)
                {
                    const double X = Vertex[0] + Radial[0] * Scatter;
                    const double Y = Vertex[1] + Radial[1] * Scatter;
                    const double Z = Vertex[2] + Radial[2] * Scatter;
                    Points.emplace_back(static_cast<float>(CentreX + (X - Y) * 0.70710678 * Scale),
                                        static_cast<float>(CentreY - (Z + (X + Y) * 0.28) * Scale));
                }
                ProjectedShard Shard;
                Shard.Hull = ResolveProjectedHull(Points);
                Shard.Depth = Fragment.ShapeMetrics.Centroid[0] + Fragment.ShapeMetrics.Centroid[1] + Fragment.ShapeMetrics.Centroid[2];
                Shard.Index = Fragment.Index;
                if (Shard.Hull.size() >= 3) Shards.push_back(std::move(Shard));
            }
            std::stable_sort(Shards.begin(), Shards.end(), [](const ProjectedShard& A, const ProjectedShard& B) { return A.Depth < B.Depth; });
            for (const ProjectedShard& Shard : Shards)
            {
                const ImU32 Fill = (Palette[Solver] & 0x00FFFFFFu) | ((0xA0u + (Shard.Index % 4u) * 12u) << 24u);
                DrawList->AddConvexPolyFilled(Shard.Hull.data(), static_cast<int>(Shard.Hull.size()), Fill);
                DrawList->AddPolyline(Shard.Hull.data(), static_cast<int>(Shard.Hull.size()), ResolveCssColour(0x101317FF),
                                      ImDrawFlags_Closed, 1.1f);
            }
        }
        ImGui::PushID(9200 + Solver);
        const char* Tag = Solver == 0 ? "CubeCompare/Runtime" : Solver == 1 ? "CubeCompare/Engineering" : Solver == 2 ? "CubeCompare/Griffith"
                            : Solver == 3 ? "CubeCompare/Wavefront" : Solver == 4 ? "CubeCompare/Voronoi" : "CubeCompare/Dendritic";
        RecordRect(State, Tag, CellMin, CellMax);
        if (InvisibleRect("##SelectSolver", CellMin, CellMax))
        {
            FractureWorkspaceConstruct& Cube = State.Constructs[5];
            Cube.Spec = QueryFractureConstructSeedSpec(5);
            Cube.Spec.Solver = Solver;
            State.Selected = State.ActiveConstruct = 5;
            State.CubeComparisonOpen = false;
            RecomputeFractureReceipt(Cube);
            char Message[128]{};
            std::snprintf(Message, sizeof(Message), "Selected %s on the comparison cube", Name);
            AppendFractureWorkspaceLog(State, "SOLVER", Message);
        }
        ImGui::PopID();
    }
    DrawList->PopClipRect();
    PanelCursor Footer{DrawList, &Faces, 1.0f, Min.x, Max.x - Min.x, Max.y};
    Footer.Text(Faces.Regular, 9.5f, Min.x + 10.0f, Max.y - 18.0f, 1.3f, ResolveCssColour(0xBCBCBCFF),
                "Cube fracture comparison · select a tile to continue with that native solver");
}

void ConstructShardStage(FractureWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 Min,
                         ImVec2 Max)
{
    if (State.CubeComparisonOpen)
    {
        ConstructCubeComparisonStage(State, Faces, DrawList, Min, Max);
        return;
    }
    PanelCursor Surface{ DrawList, &Faces, 1.0f, Min.x, Max.x - Min.x, Min.y };
    const float Wide    = Max.x - Min.x;
    const float Tall    = Max.y - Min.y;
    const float CentreX = Min.x + Wide * 0.5f;
    const float CentreY = Min.y + Tall * 0.5f;

    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x0B0B0BFF), 0.0f);
    for (float X = Min.x + 18.0f; X < Max.x - 8.0f; X += 26.0f)
        for (float Y = Min.y + 14.0f; Y < Max.y - 8.0f; Y += 26.0f)
            DrawList->AddCircleFilled(ImVec2(X, Y), 1.0f, ResolveCssColour(0xFFFFFF0D), 6);

    const FractureWorkspaceConstruct& Cst = State.Constructs[State.ActiveConstruct];
    const FractureReceipt&            Rec = Cst.Receipt;
    const ImU32                       Accent = QueryNodeAccent(State, State.ActiveConstruct);
    const Fracture::Result& Partition = Cst.NativeResult;
    if (Cst.NativeResultValid && !Partition.Fragments.empty())
    {
        const Fracture::Metrics& Base = Partition.BaseMetrics;
        const double FitX = (Wide * 0.34) / std::max(0.05, Base.Span[0]);
        const double FitY = (Tall * 0.50) / std::max(0.05, Base.Span[1]);
        const double PixelScale = std::min(FitX, FitY);
        struct ProjectedShard
        {
            std::vector<ImVec2> Hull;
            double Depth = 0.0;
            double Stress = 0.0;
            uint32_t Seed = 0;
        };
        std::vector<ProjectedShard> Shards;
        Shards.reserve(Partition.Fragments.size());
        const bool HasJolt = RuntimeMatchesActiveRecipe(State);
        for (const Fracture::Fragment& Fragment : Partition.Fragments)
        {
            Fracture::BodyPose Pose;
            const bool HasPose = HasJolt && State.Runtime->QueryFragmentBody(Fragment.Index, Pose);
            Fracture::Vec3 Position = HasPose ? Pose.PositionMetres : Fragment.ShapeMetrics.Centroid;
            if (!HasPose)
            {
                Fracture::Vec3 Radial{ Fragment.ShapeMetrics.Centroid[0] - Base.Centroid[0],
                                       Fragment.ShapeMetrics.Centroid[1] - Base.Centroid[1],
                                       Fragment.ShapeMetrics.Centroid[2] - Base.Centroid[2] };
                const double RadialLength = std::sqrt(Radial[0] * Radial[0] + Radial[1] * Radial[1] + Radial[2] * Radial[2]);
                if (RadialLength > 1.0e-8)
                    for (double& Component : Radial) Component /= RadialLength;
                else Radial = { 0.0, 0.0, 0.0 };
                const uint32_t Scatter = HashU32(static_cast<uint32_t>(Cst.Spec.Seed * 31 + Fragment.Index * 777));
                const double Jitter = (static_cast<double>((Scatter >> 7) % 1000) / 1000.0 - 0.5) * Base.Radius * 0.10;
                for (int Axis = 0; Axis < 3; ++Axis)
                    Position[Axis] += Radial[Axis] * (State.ExplodeAmount * Base.Radius * 1.7 + Jitter);
            }
            struct Point2 { double X, Y, Depth; };
            std::vector<Point2> Points;
            Points.reserve(Fragment.Shape.Vertices.size());
            for (const Fracture::Vec3& Vertex : Fragment.Shape.Vertices)
            {
                Fracture::Vec3 Relative{ Vertex[0] - Fragment.ShapeMetrics.Centroid[0],
                                         Vertex[1] - Fragment.ShapeMetrics.Centroid[1],
                                         Vertex[2] - Fragment.ShapeMetrics.Centroid[2] };
                if (HasPose)
                {
                    const double Qx = Pose.Orientation[0], Qy = Pose.Orientation[1], Qz = Pose.Orientation[2], Qw = Pose.Orientation[3];
                    const Fracture::Vec3 T{ 2.0 * (Qy * Relative[2] - Qz * Relative[1]),
                                            2.0 * (Qz * Relative[0] - Qx * Relative[2]),
                                            2.0 * (Qx * Relative[1] - Qy * Relative[0]) };
                    Relative = { Relative[0] + Qw * T[0] + (Qy * T[2] - Qz * T[1]),
                                 Relative[1] + Qw * T[1] + (Qz * T[0] - Qx * T[2]),
                                 Relative[2] + Qw * T[2] + (Qx * T[1] - Qy * T[0]) };
                }
                const double X = Position[0] + Relative[0];
                const double Y = Position[1] + Relative[1];
                const double Z = Position[2] + Relative[2];
                Points.push_back({ CentreX + (X - Base.Centroid[0]) * PixelScale,
                                   CentreY - (Y - Base.Centroid[1]) * PixelScale, Z });
            }
            std::sort(Points.begin(), Points.end(), [](const Point2& A, const Point2& B) {
                return A.X == B.X ? A.Y < B.Y : A.X < B.X;
            });
            Points.erase(std::unique(Points.begin(), Points.end(), [](const Point2& A, const Point2& B) {
                return std::fabs(A.X - B.X) < 0.01 && std::fabs(A.Y - B.Y) < 0.01;
            }), Points.end());
            if (Points.size() < 3) continue;
            const auto Cross2 = [](const Point2& A, const Point2& B, const Point2& C) {
                return (B.X - A.X) * (C.Y - A.Y) - (B.Y - A.Y) * (C.X - A.X);
            };
            std::vector<Point2> Hull;
            Hull.reserve(Points.size() * 2);
            for (const Point2& Point : Points)
            {
                while (Hull.size() >= 2 && Cross2(Hull[Hull.size() - 2], Hull.back(), Point) <= 0.0) Hull.pop_back();
                Hull.push_back(Point);
            }
            const size_t Lower = Hull.size();
            for (auto It = Points.rbegin() + 1; It != Points.rend(); ++It)
            {
                while (Hull.size() > Lower && Cross2(Hull[Hull.size() - 2], Hull.back(), *It) <= 0.0) Hull.pop_back();
                Hull.push_back(*It);
            }
            if (Hull.size() > 1) Hull.pop_back();
            if (Hull.size() < 3) continue;
            ProjectedShard DrawShard;
            DrawShard.Depth = Position[2];
            DrawShard.Stress = Fragment.StressRatio;
            DrawShard.Seed = HashU32(static_cast<uint32_t>(Cst.Spec.Seed * 31 + Fragment.Index * 777));
            DrawShard.Hull.reserve(Hull.size());
            for (const Point2& Point : Hull) DrawShard.Hull.emplace_back(static_cast<float>(Point.X), static_cast<float>(Point.Y));
            Shards.push_back(std::move(DrawShard));
        }
        std::sort(Shards.begin(), Shards.end(), [](const ProjectedShard& A, const ProjectedShard& B) {
            return A.Depth < B.Depth;
        });
        DrawList->PushClipRect(Min, Max, true);
        for (const ProjectedShard& Shard : Shards)
        {
            const float Alpha = 0x65 + static_cast<float>((Shard.Seed >> 16) % 0x35);
            const ImU32 Fill = Shard.Stress > 0.65f ? ResolveCssColour(0xE8C27AFF) : Accent;
            DrawList->AddConvexPolyFilled(Shard.Hull.data(), static_cast<int>(Shard.Hull.size()),
                                          (Fill & 0x00FFFFFF) | (static_cast<ImU32>(Alpha) << 24));
            DrawList->AddPolyline(Shard.Hull.data(), static_cast<int>(Shard.Hull.size()),
                                  Shard.Stress > 0.65f ? ResolveCssColour(0xE8C27ACC) : ResolveCssColour(0xFFFFFF6E),
                                  ImDrawFlags_Closed, 1.15f);
        }
        DrawList->PopClipRect();
    }

    // Impact reticle + callout over the projected native fragment hulls.
    DrawList->AddCircle(ImVec2(CentreX, CentreY), 26.0f, ResolveCssColour(0xE8C27ACC), 40, 1.5f);
    DrawList->AddLine(ImVec2(CentreX - 38.0f, CentreY), ImVec2(CentreX - 26.0f, CentreY),
                      ResolveCssColour(0xE8C27ACC), 1.5f);
    DrawList->AddLine(ImVec2(CentreX + 26.0f, CentreY), ImVec2(CentreX + 38.0f, CentreY),
                      ResolveCssColour(0xE8C27ACC), 1.5f);
    DrawList->AddLine(ImVec2(CentreX, CentreY - 38.0f), ImVec2(CentreX, CentreY - 26.0f),
                      ResolveCssColour(0xE8C27ACC), 1.5f);
    DrawList->AddLine(ImVec2(CentreX, CentreY + 26.0f), ImVec2(CentreX, CentreY + 38.0f),
                      ResolveCssColour(0xE8C27ACC), 1.5f);
    char Callout[128]{};
    std::snprintf(Callout, sizeof(Callout), "Gc %.0f J/m² · cR %.0f m/s",
                  QueryFractureMaterial(Cst.Spec.Material).Gc, Rec.RayleighSpeedMps);
    Surface.Text(Faces.Medium, 11.0f, CentreX + 46.0f, CentreY - 24.0f, 1.38f, ResolveCssColour(0xEFEFEFFF), Callout);
    char CalloutSub[128]{};
    std::snprintf(CalloutSub, sizeof(CalloutSub), "%d convex hulls · %.1f ms", Rec.FragmentCount,
                  Rec.StepMilliseconds);
    Surface.Text(Faces.Regular, 10.0f, CentreX + 46.0f, CentreY - 8.0f, 1.4f, ResolveCssColour(0x848484FF), CalloutSub);

    // 📝 Integrity cluster: manifold + budget rings, top right.
    auto Ring = [&](ImVec2 At, double Percent, ImU32 Colour, const char* Value, const char* Label) {
        DrawList->AddCircle(At, 13.0f, ResolveCssColour(0xFFFFFF1F), 32, 2.5f);
        DrawList->PathArcTo(At, 13.0f, -PiSingle * 0.5f,
                            -PiSingle * 0.5f + static_cast<float>(Percent / 100.0 * PiSingle * 2.0), 32);
        DrawList->PathStroke(Colour, false, 2.5f);
        Surface.Text(Faces.SemiBold, 12.0f, At.x + 20.0f, At.y - 16.0f, 1.3f, ResolveCssColour(0xEFEFEFFF), Value);
        Surface.Text(Faces.Regular, 9.5f, At.x + 20.0f, At.y + 0.0f, 1.4f, ResolveCssColour(0x848484FF), Label);
    };
    const double Manifold = Rec.WatertightManifold ? 100.0 : 92.0;
    char         ManifoldValue[16]{}, ManifoldLabel[48]{};
    std::snprintf(ManifoldValue, sizeof(ManifoldValue), "%.0f%%", Manifold);
    std::snprintf(ManifoldLabel, sizeof(ManifoldLabel), "Manifold ΔV %.3f%%", Rec.VolumeDriftRatio * 100.0);
    Ring(ImVec2(Max.x - 210.0f, Min.y + 30.0f), Manifold, ResolveCssColour(0x3EC46DFF), ManifoldValue, ManifoldLabel);
    char BudgetValue[16]{};
    std::snprintf(BudgetValue, sizeof(BudgetValue), "%.0f%%", Rec.BudgetPercent);
    Ring(ImVec2(Max.x - 210.0f, Min.y + 72.0f), Rec.BudgetPercent, ResolveCssColour(0xE8C27AFF), BudgetValue,
         "Griffith Budget");

    // 📝 HUD pills: shards / solve / bonds.
    const char* HudLabels[3] = { "SHARDS", "SOLVE", "BONDS" };
    char        HudValues[3][48]{};
    std::snprintf(HudValues[0], sizeof(HudValues[0]), "%d / %d", Rec.FragmentCount, Cst.Spec.Ceiling);
    std::snprintf(HudValues[1], sizeof(HudValues[1]), "%.2f ms", Rec.StepMilliseconds);
    std::snprintf(HudValues[2], sizeof(HudValues[2]), "%d / %d", Rec.IntactBondCount, Rec.BondCount);
    float HudX = Min.x + 14.0f;
    for (int Pill = 0; Pill < 3; ++Pill)
    {
        const float PillWide =
            Surface.Measure(Faces.SemiBold, 9.5f, HudLabels[Pill], 0.9f) + Surface.Measure(Faces.Medium, 11.0f, HudValues[Pill]) + 34.0f;
        const ImVec2 PillMin(HudX, Min.y + 12.0f);
        const ImVec2 PillMax(HudX + PillWide, Min.y + 36.0f);
        DrawList->AddRectFilled(PillMin, PillMax, ResolveCssColour(0x0E0F12D6), 12.0f);
        Surface.Text(Faces.SemiBold, 9.5f, PillMin.x + 10.0f, Min.y + 24.0f - 0.5f * 9.5f * 1.4f, 1.4f,
                     ResolveCssColour(0x848484FF), HudLabels[Pill], 0.9f);
        Surface.Text(Faces.Medium, 11.0f, PillMin.x + 10.0f + Surface.Measure(Faces.SemiBold, 9.5f, HudLabels[Pill], 0.9f) + 6.0f,
                     Min.y + 24.0f - 0.5f * 11.0f * 1.38f, 1.38f, ResolveCssColour(0xEFEFEFFF), HudValues[Pill]);
        HudX = PillMax.x + 8.0f;
    }

    // 📝 Hover badge + tools. Tools submit before the stage button so they win their presses.
    char Badge[160]{};
    std::snprintf(Badge, sizeof(Badge), "%s · Click mesh to strike", Cst.Title.c_str());
    const float BadgeWide = Surface.Measure(Faces.Regular, 10.5f, Badge) + 36.0f;
    const ImVec2 BadgeMin(CentreX - BadgeWide * 0.5f, Max.y - 40.0f);
    const ImVec2 BadgeMax(CentreX + BadgeWide * 0.5f, Max.y - 14.0f);
    DrawList->AddRectFilled(BadgeMin, BadgeMax, ResolveCssColour(0x0E0F12D6), 13.0f);
    DrawList->AddCircleFilled(ImVec2(BadgeMin.x + 14.0f, Max.y - 27.0f), 4.0f, ResolveCssColour(0xE8C27AFF), 12);
    Surface.Text(Faces.Regular, 10.5f, BadgeMin.x + 24.0f, Max.y - 27.0f - 0.5f * 10.5f * 1.4f, 1.4f,
                 ResolveCssColour(0xD8D8D8FF), Badge);

    static const char* ToolGlyphs[3] = { "StudioBlast", "StudioOrbit", "StudioFocus" };
    static const char* ToolTags[3]   = { "Surface/Tool0", "Surface/Tool1", "Surface/Tool2" };
    float              ToolX         = Min.x + 14.0f;
    const float        ToolY         = Max.y - 48.0f;
    for (int Tool = 0; Tool < 3; ++Tool)
    {
        const ImVec2 KeyMin(ToolX, ToolY);
        const ImVec2 KeyMax(ToolX + 34.0f, ToolY + 34.0f);
        const bool   Active = State.Tool == Tool;
        DrawList->AddRectFilled(KeyMin, KeyMax, ResolveCssColour(Active ? 0xE8C27AFF : 0x0E0F12D6), 10.0f);
        DrawList->AddRect(KeyMin, KeyMax, ResolveCssColour(Active ? 0xE8C27AFF : 0xFFFFFF12), 10.0f, ImDrawFlags_None,
                          1.0f);
        (void)GlyphSymbol::Construct(DrawList, ToolGlyphs[Tool], ImVec2(KeyMin.x + 10.0f, KeyMin.y + 10.0f), 14.0f,
                                     1.8f, ResolveCssColour(Active ? 0x1A1A1AFF : 0xBCBCBCFF));
        ImGui::PushID(700 + Tool);
        RecordRect(State, ToolTags[Tool], KeyMin, KeyMax);
        if (InvisibleRect("##StageTool", KeyMin, KeyMax)) State.Tool = Tool;
        ImGui::PopID();
        ToolX = KeyMax.x + 8.0f;
    }
    {
        const ImVec2 KeyMin(ToolX + 8.0f, ToolY);
        const ImVec2 KeyMax(ToolX + 42.0f, ToolY + 34.0f);
        DrawList->AddRectFilled(KeyMin, KeyMax, ResolveCssColour(0x0E0F12D6), 10.0f);
        DrawList->AddRect(KeyMin, KeyMax, ResolveCssColour(0xFFFFFF12), 10.0f, ImDrawFlags_None, 1.0f);
        (void)GlyphSymbol::Construct(DrawList, "StudioReset", ImVec2(KeyMin.x + 10.0f, KeyMin.y + 10.0f), 14.0f, 1.8f,
                                     ResolveCssColour(0xBCBCBCFF));
        RecordRect(State, "Surface/Reassemble", KeyMin, KeyMax);
        if (InvisibleRect("##Reassemble", KeyMin, KeyMax)) ReassembleActiveFracture(State);
    }

    ImGui::PushID("ShardStage");
    RecordRect(State, "Surface/Shards", Min, Max);
    if (InvisibleRect("##ShardStage", Min, Max))
    {
        const Fracture::Metrics& Base = State.Constructs[State.ActiveConstruct].NativeResult.BaseMetrics;
        const ImVec2 Mouse = ImGui::GetIO().MousePos;
        const double Fx = std::clamp((Mouse.x - Min.x) / std::max(1.0f, Wide), 0.0f, 1.0f);
        const double Fy = std::clamp((Mouse.y - Min.y) / std::max(1.0f, Tall), 0.0f, 1.0f);
        const Fracture::Vec3 Impact{ Base.BoundsMin[0] + Fx * Base.Span[0],
                                     Base.BoundsMax[1] - Fy * Base.Span[1],
                                     Base.BoundsMax[2] };
        (void)StrikeActiveFracture(State, &Impact);
    }
    ImGui::PopID();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    TRANSPORT + TIMELINE
//------------------------------------------------------------------------------------------------------------------------

void ConstructTransportStrip(FractureWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList,
                             ImVec2 Min, ImVec2 Max)
{
    PanelCursor Strip{ DrawList, &Faces, 1.0f, Min.x, Max.x - Min.x, Min.y };
    DrawList->AddLine(ImVec2(Min.x, Min.y), ImVec2(Max.x, Min.y), ResolveCssColour(0xFFFFFF12));

    auto RoundKey = [&](const char* Id, const char* RectTag, const char* Glyph, ImVec2 KeyMin, ImU32 Ring) {
        const ImVec2 KeyMax(KeyMin.x + 34.0f, KeyMin.y + 34.0f);
        const ImVec2 Centre(KeyMin.x + 17.0f, KeyMin.y + 17.0f);
        DrawList->AddCircleFilled(Centre, 17.0f, ResolveCssColour(0x1A1A1AFF), 32);
        DrawList->AddCircle(Centre, 17.0f, Ring, 32, 1.0f);
        (void)GlyphSymbol::Construct(DrawList, Glyph, ImVec2(KeyMin.x + 10.5f, KeyMin.y + 10.5f), 13.0f, 1.8f,
                                     ResolveCssColour(0xD8D8D8FF));
        RecordRect(State, RectTag, KeyMin, KeyMax);
        return InvisibleRect(Id, KeyMin, KeyMax);
    };

    float KeyX = Min.x + 14.0f;
    const float KeyY = Min.y + 15.0f;
    if (RoundKey("##TransportReset", "Transport/Reset", "StudioReset", ImVec2(KeyX, KeyY),
                 ResolveCssColour(0xFFFFFF24))) ReassembleActiveFracture(State);
    KeyX += 42.0f;
    if (RoundKey("##TransportPlay", "Transport/Play", State.TimelinePlaying ? "StudioPause" : "StudioPlay",
                 ImVec2(KeyX, KeyY), ResolveCssColour(0xE8C27A66)))
    {
        if (State.TimelinePlaying) State.TimelinePlaying = false;
        else if (State.Runtime == nullptr || RuntimeMatchesActiveRecipe(State) || BakeActiveFracture(State, "BAKE"))
            State.TimelinePlaying = true;
    }
    KeyX += 42.0f;
    if (RoundKey("##TransportStep", "Transport/Step", "StudioStep", ImVec2(KeyX, KeyY),
                 ResolveCssColour(0xFFFFFF24)))
    {
        const double Step = (1.0 / 60.0) * State.PlaybackRate;
        if (State.Runtime != nullptr) StepActiveFracturePhysics(State, Step);
        else State.TimelineActive = std::min(State.TimelineDuration, State.TimelineActive + Step);
        AppendFractureWorkspaceLog(State, "TRANSPORT", "Stepped native fracture scene", State.Runtime != nullptr ? "Jolt · 16 ms" : "solver-only timeline");
    }
    KeyX += 52.0f;

    char Timecode[24]{};
    std::snprintf(Timecode, sizeof(Timecode), "00:%04.1f", State.TimelineActive);
    // 📝 Reference format 00:SS.mmm.
    std::snprintf(Timecode, sizeof(Timecode), "00:%02d.%03d", static_cast<int>(State.TimelineActive),
                  static_cast<int>(State.TimelineActive * 1000.0) % 1000);
    Strip.Text(Faces.Monospace, 13.0f, KeyX, Min.y + 32.0f - 0.5f * 13.0f * 1.4f, 1.4f,
               ResolveCssColour(0xD8D8D8FF), Timecode);
    KeyX += Strip.Measure(Faces.Monospace, 13.0f, "00:00.000") + 16.0f;
    static const char* Speeds[4]    = { "0.10×", "0.25×", "0.50×", "1.0×" };
    static const double SpeedValue[4] = { 0.10, 0.25, 0.50, 1.0 };
    int                SpeedIndex     = State.PlaybackRate <= 0.10 ? 0 : (State.PlaybackRate <= 0.25 ? 1
                                                      : (State.PlaybackRate <= 0.50 ? 2 : 3));
    if (ConstructBarSelect(State, Faces, DrawList, "Speed", "Transport/Speed", "", Speeds, 4, SpeedIndex,
                           ImVec2(KeyX, Min.y + 17.0f), 92.0f))
        State.PlaybackRate = SpeedValue[SpeedIndex];
    KeyX += 92.0f + 16.0f;

    Strip.Text(Faces.Regular, 11.0f, KeyX, Min.y + 32.0f - 0.5f * 11.0f * 1.4f, 1.4f, ResolveCssColour(0x848484FF),
               "Explode");
    KeyX += Strip.Measure(Faces.Regular, 11.0f, "Explode") + 8.0f;
    const ImVec2 ExplodeMin(KeyX, Min.y + 24.0f);
    const ImVec2 ExplodeMax(KeyX + 110.0f, Min.y + 40.0f);
    DrawList->AddRectFilled(ImVec2(ExplodeMin.x, ExplodeMin.y + 6.0f), ImVec2(ExplodeMax.x, ExplodeMax.y - 6.0f),
                            ResolveCssColour(0x1E1E1EFF), 2.0f);
    DrawList->AddCircleFilled(ImVec2(ExplodeMin.x + 110.0f * static_cast<float>(State.ExplodeAmount), Min.y + 32.0f),
                              6.0f, ResolveCssColour(0xE8C27AFF), 16);
    RecordRect(State, "Transport/Explode", ExplodeMin, ExplodeMax);
    ImGui::PushID("ExplodeTrack");
    ImGui::SetCursorScreenPos(ExplodeMin);
    if (ImGui::InvisibleButton("##Explode", ImVec2(110.0f, 16.0f), ImGuiButtonFlags_EnableNav) ||
        (ImGui::IsItemActive() && ImGui::IsMouseDragging(ImGuiMouseButton_Left)))
    {
        const ImVec2 Mouse = ImGui::GetIO().MousePos;
        double           V     = (Mouse.x - ExplodeMin.x) / 110.0;
        State.ExplodeAmount    = V < 0.0 ? 0.0 : (V > 1.0 ? 1.0 : V);
    }
    ImGui::PopID();
    char ExplodeValue[16]{};
    std::snprintf(ExplodeValue, sizeof(ExplodeValue), "%.2f", State.ExplodeAmount);
    Strip.Text(Faces.Monospace, 11.0f, ExplodeMax.x + 8.0f, Min.y + 32.0f - 0.5f * 11.0f * 1.4f, 1.4f,
               ResolveCssColour(0xBCBCBCFF), ExplodeValue);

    const float BakeWide = Strip.Measure(Faces.Medium, 11.5f, "Bake  B") + 30.0f;
    const ImVec2 BakeMax(Max.x - 14.0f, Min.y + 49.0f);
    const ImVec2 BakeMin(BakeMax.x - BakeWide, Min.y + 15.0f);
    DrawList->AddRectFilled(BakeMin, BakeMax, ResolveCssColour(0x1A1A1AFF), 17.0f);
    DrawList->AddRect(BakeMin, BakeMax, ResolveCssColour(0xFFFFFF24), 17.0f, ImDrawFlags_None, 1.0f);
    Strip.Text(Faces.Medium, 11.5f, BakeMin.x + 15.0f, Min.y + 32.0f - 0.5f * 11.5f * 1.38f, 1.38f,
               ResolveCssColour(0xD8D8D8FF), "Bake  B");
    RecordRect(State, "Transport/Bake", BakeMin, BakeMax);
    if (InvisibleRect("##Bake", BakeMin, BakeMax)) (void)BakeActiveFracture(State, "BAKE");

    const float StrikeWide = Strip.Measure(Faces.Medium, 11.5f, "Strike  L") + 30.0f;
    const ImVec2 StrikeMax(BakeMin.x - 8.0f, Min.y + 49.0f);
    const ImVec2 StrikeMin(StrikeMax.x - StrikeWide, Min.y + 15.0f);
    DrawList->AddRectFilled(StrikeMin, StrikeMax, ResolveCssColour(0xE8C27AFF), 17.0f);
    (void)GlyphSymbol::Construct(DrawList, "StudioBlast", ImVec2(StrikeMin.x + 12.0f, StrikeMin.y + 10.0f), 14.0f,
                                 1.8f, ResolveCssColour(0x1A1A1AFF));
    Strip.Text(Faces.Medium, 11.5f, StrikeMin.x + 32.0f, Min.y + 32.0f - 0.5f * 11.5f * 1.38f, 1.38f,
               ResolveCssColour(0x1A1A1AFF), "Strike  L");
    RecordRect(State, "Transport/Strike", StrikeMin, StrikeMax);
    if (InvisibleRect("##Strike", StrikeMin, StrikeMax)) (void)StrikeActiveFracture(State);
}

void ConstructTimeline(FractureWorkspaceState& State, const EditorTypefaces& Faces, ImDrawList* DrawList, ImVec2 Min,
                       ImVec2 Max)
{
    PanelCursor Line{ DrawList, &Faces, 1.0f, Min.x, Max.x - Min.x, Min.y };
    DrawList->AddLine(ImVec2(Min.x, Min.y), ImVec2(Max.x, Min.y), ResolveCssColour(0xFFFFFF12));
    Line.Text(Faces.SemiBold, 10.0f, Min.x + 14.0f, Min.y + 10.0f, 1.4f, ResolveCssColour(0x848484FF), "FRACTURE",
              0.9f);
    char Frame[32]{};
    std::snprintf(Frame, sizeof(Frame), "%.2fs / %.2fs", State.TimelineActive, State.TimelineDuration);
    Line.Text(Faces.Monospace, 10.5f, Min.x + 118.0f, Min.y + 10.0f, 1.4f, ResolveCssColour(0x5E5E5EFF), Frame);

    const float RulerLeft  = Min.x + 14.0f;
    const float RulerRight = Max.x - 14.0f;
    const float RulerY     = Min.y + 34.0f;
    DrawList->AddLine(ImVec2(RulerLeft, RulerY), ImVec2(RulerRight, RulerY), ResolveCssColour(0xFFFFFF18));
    for (int Tick = 0; Tick <= 10; ++Tick)
    {
        const float X     = RulerLeft + (RulerRight - RulerLeft) * Tick / 10.0f;
        const bool  Major = Tick % 2 == 0;
        DrawList->AddLine(ImVec2(X, RulerY), ImVec2(X, RulerY + (Major ? 7.0f : 4.0f)),
                          ResolveCssColour(Major ? 0xFFFFFF2E : 0xFFFFFF14));
        if (Major)
        {
            char Label[8]{};
            std::snprintf(Label, sizeof(Label), "%.1fs", Tick * 0.4);
            Line.Text(Faces.Regular, 9.0f, X - Line.Measure(Faces.Regular, 9.0f, Label) * 0.5f, RulerY + 8.0f, 1.4f,
                      ResolveCssColour(0x5E5E5EFF), Label);
        }
    }
    static const char* Phases[4] = { "① Nucleate", "② Crack Wavefront", "③ Ballistic Eject", "④ Contact Settle" };
    static const float Flex[4]   = { 0.8f, 1.1f, 1.6f, 2.2f };
    float              PhaseX    = RulerLeft;
    for (int Phase = 0; Phase < 4; ++Phase)
    {
        const float ChipWide = (RulerRight - RulerLeft) * Flex[Phase] / 5.7f;
        const ImVec2 ChipMin(PhaseX, RulerY + 26.0f);
        const ImVec2 ChipMax(PhaseX + ChipWide - 4.0f, RulerY + 48.0f);
        DrawList->AddRectFilled(ChipMin, ChipMax, ResolveCssColour(0x1E1E1EFF), 11.0f);
        Line.Text(Faces.Regular, 10.0f, ChipMin.x + 10.0f, RulerY + 37.0f - 0.5f * 10.0f * 1.4f, 1.4f,
                  ResolveCssColour(0xBCBCBCFF), Phases[Phase]);
        PhaseX += ChipWide;
    }
    const float HeadX = RulerLeft + (RulerRight - RulerLeft) *
                                      static_cast<float>(State.TimelineActive / State.TimelineDuration);
    DrawList->AddLine(ImVec2(HeadX, RulerY - 4.0f), ImVec2(HeadX, RulerY + 48.0f), ResolveCssColour(0xE8C27AFF), 2.0f);
    DrawList->AddCircleFilled(ImVec2(HeadX, RulerY - 4.0f), 4.0f, ResolveCssColour(0xE8C27AFF), 12);

    RecordRect(State, "Timeline/Ruler", ImVec2(RulerLeft, RulerY - 6.0f), ImVec2(RulerRight, RulerY + 48.0f));
    ImGui::PushID("FractureRuler");
    ImGui::SetCursorScreenPos(ImVec2(RulerLeft, RulerY - 6.0f));
    if (ImGui::InvisibleButton("##FractureRuler", ImVec2(RulerRight - RulerLeft, 54.0f),
                               ImGuiButtonFlags_EnableNav) ||
        (ImGui::IsItemActive() && ImGui::IsMouseDragging(ImGuiMouseButton_Left)))
    {
        const ImVec2 Mouse = ImGui::GetIO().MousePos;
        double           F     = (Mouse.x - RulerLeft) / (RulerRight - RulerLeft);
        if (F < 0.0) F = 0.0;
        if (F > 1.0) F = 1.0;
        State.TimelinePlaying = false;
        State.TimelineActive  = F * State.TimelineDuration;
    }
    ImGui::PopID();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    LOG DRAWER
//------------------------------------------------------------------------------------------------------------------------

void ConstructLogDrawer(FractureWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Min, ImVec2 Max)
{
    ImDrawList* const DrawList = ImGui::GetWindowDrawList();
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x121212FF), 22.0f);
    DrawList->AddRect(Min, Max, ResolveCssColour(0xFFFFFF0E), 22.0f, ImDrawFlags_None, 1.0f);

    PanelCursor Panel{ DrawList, &Faces, 1.0f, Min.x, Max.x - Min.x, Min.y };
    const ImVec2 Head = Panel.Space(44.0f);
    DrawList->AddLine(ImVec2(Min.x, Head.y + 44.0f), ImVec2(Max.x, Head.y + 44.0f), ResolveCssColour(0xFFFFFF12));
    float TitleX = Panel.Text(Faces.Light, 13.5f, Min.x + 16.0f, Head.y + 22.0f - 0.5f * 13.5f * 1.4f, 1.4f,
                              ResolveCssColour(0xDADADADA), "Log Stream", -0.2f);
    TitleX += Min.x + 16.0f + 7.0f;
    const float ShellWide = Panel.Measure(Faces.Regular, 9.0f, "SHELL") + 14.0f;
    DrawList->AddRectFilled(ImVec2(TitleX, Head.y + 13.0f), ImVec2(TitleX + ShellWide, Head.y + 31.0f),
                            ResolveCssColour(0xE8C27A24), 9.0f);
    Panel.Text(Faces.Regular, 9.0f, TitleX + 7.0f, Head.y + 22.0f - 0.5f * 9.0f * 1.4f, 1.4f,
               ResolveCssColour(0xE8C27AFF), "SHELL");
    const float ClearWide = Panel.Measure(Faces.Medium, 11.0f, "Clear") + 18.0f;
    const ImVec2 ClearMax(Max.x - 16.0f, Head.y + 35.0f);
    const ImVec2 ClearMin(ClearMax.x - ClearWide, Head.y + 9.0f);
    Panel.Text(Faces.Medium, 11.0f, ClearMin.x + 9.0f, Head.y + 22.0f - 0.5f * 11.0f * 1.38f, 1.38f,
               ResolveCssColour(0xBCBCBCFF), "Clear");
    ImGui::PushID("LogDrawer");
    RecordRect(State, "Log/Clear", ClearMin, ClearMax);
    if (InvisibleRect("##LogClear", ClearMin, ClearMax)) State.Log.clear();

    ImGui::SetCursorScreenPos(ImVec2(Min.x, Head.y + 44.0f));
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0, 0, 0));
    ImGui::BeginChild("##LogScroll", ImVec2(Max.x - Min.x, Max.y - Head.y - 44.0f), false,
                      ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
    ImDrawList* const InnerList = ImGui::GetWindowDrawList();
    PanelCursor       Content{ InnerList, &Faces, 1.0f, Min.x + 12.0f, Max.x - Min.x - 24.0f, Head.y + 44.0f + 12.0f };
    for (const FractureWorkspaceLogEntry& Entry : State.Log)
    {
        const ImVec2 Row = Content.Space(23.0f);
        InnerList->AddLine(ImVec2(Row.x, Row.y + 23.0f), ImVec2(Row.x + Content.Width, Row.y + 23.0f),
                           ResolveCssColour(0xFFFFFF0A));
        Content.Text(Faces.SemiBold, 10.0f, Row.x + 4.0f, Row.y + 5.0f, 1.4f, ResolveCssColour(0xE8C27AFF),
                     Entry.Channel.c_str());
        char Line[320]{};
        if (Entry.Detail.empty()) std::snprintf(Line, sizeof(Line), "%s", Entry.Message.c_str());
        else std::snprintf(Line, sizeof(Line), "%s · %s", Entry.Message.c_str(), Entry.Detail.c_str());
        // 📝 NOOP lines read warm so refused commands stand out from staged values.
        const bool Noop = Entry.Detail == "explicit NOOP";
        Content.Text(Faces.Regular, 11.0f, Row.x + 4.0f + 96.0f, Row.y + 4.0f, 1.4f,
                     ResolveCssColour(Noop ? 0xE8C27AFF : 0x848484FF), Line);
    }
    ImGui::SetCursorScreenPos(ImVec2(Content.X, Content.Y));
    ImGui::Dummy(ImVec2(1.0f, 1.0f));
    ImGui::EndChild();
    ImGui::PopStyleColor();
    ImGui::PopID();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    SOLVER MATRIX
//------------------------------------------------------------------------------------------------------------------------

void ConstructSolverMatrix(FractureWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 RootMin, ImVec2 RootMax)
{
    if (!State.MatrixOpen) return;
    ImDrawList* const DrawList = ImGui::GetWindowDrawList();

    const float SheetWide = 700.0f;
    const float SheetTall = 600.0f;
    const ImVec2 SheetMin(0.5f * (RootMin.x + RootMax.x - SheetWide), 0.5f * (RootMin.y + RootMax.y - SheetTall));
    const ImVec2 SheetMax(SheetMin.x + SheetWide, SheetMin.y + SheetTall);
    DrawList->AddRectFilled(RootMin, RootMax, ResolveCssColour(0x050507C2));
    DrawList->AddRectFilled(SheetMin, SheetMax, ResolveCssColour(0x121212FF), 24.0f);
    DrawList->AddRect(SheetMin, SheetMax, ResolveCssColour(0xFFFFFF24), 24.0f, ImDrawFlags_None, 1.0f);

    // 📝 Like the U2/U3 sheets, the dialog content lives in its own child window so its keys receive presses.
    ImGui::PushID("SolverVeil");
    ImGui::SetCursorScreenPos(ImVec2(SheetMin.x + 24.0f, SheetMin.y + 20.0f));
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0, 0, 0));
    ImGui::BeginChild("##SolverScroll", ImVec2(SheetWide - 48.0f, SheetTall - 40.0f), false,
                      ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
    ImDrawList* const DialogList = ImGui::GetWindowDrawList();
    PanelCursor Dialog{ DialogList, &Faces, 1.0f, SheetMin.x + 24.0f, SheetWide - 48.0f, SheetMin.y + 20.0f };

    const ImVec2 Head = Dialog.Space(32.0f, 0.0f, 8.0f);
    (void)GlyphSymbol::Construct(DialogList, "StudioGrid", ImVec2(Head.x, Head.y + 5.0f), 20.0f, 1.8f,
                                 ResolveCssColour(0xE8C27AFF));
    Dialog.Text(Faces.Light, 18.0f, Head.x + 30.0f, Head.y + 16.0f - 0.5f * 18.0f * 1.3f, 1.3f,
                ResolveCssColour(0xEFEFEFFF), "Solver Matrix (6)");
    const ImVec2 CloseMax(SheetMin.x + SheetWide - 24.0f, Head.y + 30.0f);
    const ImVec2 CloseMin(CloseMax.x - 30.0f, Head.y);
    DrawList->AddRectFilled(CloseMin, CloseMax, ResolveCssColour(0x1A1A1AFF), 15.0f);
    (void)GlyphSymbol::Construct(DialogList, "StudioClose", ImVec2(CloseMin.x + 9.0f, CloseMin.y + 9.0f), 12.0f, 1.8f,
                                 ResolveCssColour(0xBCBCBCFF));
    RecordRect(State, "Matrix/Close", CloseMin, CloseMax);
    if (InvisibleRect("##MatrixClose", CloseMin, CloseMax)) State.MatrixOpen = false;

    for (int Index = 0; Index < QueryFractureSolverCount(); ++Index)
    {
        const FractureWorkspaceSolver& Solver = QueryFractureSolver(Index);
        const ImVec2 RowMin(Dialog.X, Dialog.Y);
        const ImVec2 RowMax(Dialog.X + Dialog.Width, Dialog.Y + 74.0f);
        Dialog.Y += 80.0f;
        const bool Current = State.Constructs[State.ActiveConstruct].Spec.Solver == Index;
        DrawList->AddRectFilled(RowMin, RowMax, ResolveCssColour(Current ? 0xE8C27A14 : 0x1E1E1EFF), 12.0f);
        Dialog.Text(Faces.Medium, 12.0f, RowMin.x + 12.0f, RowMin.y + 8.0f, 1.35f, ResolveCssColour(0xEFEFEFFF),
                    Solver.Name);
        char Meta[160]{};
        std::snprintf(Meta, sizeof(Meta), "%s · %s · %s", Solver.Cpu, Solver.Realtime, Solver.Baked);
        Dialog.Text(Faces.Regular, 10.0f, RowMin.x + 12.0f, RowMin.y + 28.0f, 1.4f, ResolveCssColour(0xE8C27AFF),
                    Meta);
        Dialog.Text(Faces.Regular, 10.0f, RowMin.x + 12.0f, RowMin.y + 46.0f, 1.4f, ResolveCssColour(0x848484FF),
                    Solver.Mechanism);
        char RowTag[40]{};
        std::snprintf(RowTag, sizeof(RowTag), "Matrix/Row%d", Index);
        ImGui::PushID(800 + Index);
        RecordRect(State, RowTag, RowMin, RowMax);
        if (InvisibleRect("##SolverRow", RowMin, RowMax))
        {
            FractureWorkspaceConstruct& Cst = State.Constructs[State.ActiveConstruct];
            Cst.Spec.Solver                 = Index;
            RecomputeFractureReceipt(Cst);
            LogFractureWorkspaceValue(State, "PARAM", "Matrix solver", Solver.Id);
            State.MatrixOpen = false;
        }
        ImGui::PopID();
    }
    ImGui::SetCursorScreenPos(ImVec2(Dialog.X, Dialog.Y));
    ImGui::Dummy(ImVec2(1.0f, 1.0f));
    ImGui::EndChild();
    ImGui::PopStyleColor();

    // 📝 The veil submits last so the sheet keys win their presses; outside presses dismiss.
    ImGui::SetCursorScreenPos(RootMin);
    if (ImGui::InvisibleButton("##SolverVeil", ImVec2(RootMax.x - RootMin.x, RootMax.y - RootMin.y))) State.MatrixOpen = false;
    ImGui::PopID();
}

} // namespace

bool BakeFractureWorkspaceActive(FractureWorkspaceState& State, const char* Channel)
{
    return BakeActiveFracture(State, Channel != nullptr ? Channel : "BAKE");
}

bool StrikeFractureWorkspaceActive(FractureWorkspaceState& State)
{
    return StrikeActiveFracture(State);
}

void ReassembleFractureWorkspaceActive(FractureWorkspaceState& State)
{
    ReassembleActiveFracture(State);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    ROOT
//------------------------------------------------------------------------------------------------------------------------

void ApplyFractureWorkspaceLink(FractureWorkspaceState& State, AssetBrowserLink* Link)
{
    if (Link == nullptr || !Link->HasHandoff() || Link->OpenRecordWorkspace != AssetBrowserWorkspaceFracture) return;
    static constexpr const char* MatPrefix    = "fracture-mat/";
    static constexpr const char* SolverPrefix = "fracture-solver/";
    static constexpr const char* SeedPrefix   = "fracture/construct-";
    static constexpr const char* PresetPrefix = "fracture/";
    const char*                  Raw          = Link->OpenRecordId;
    FractureWorkspaceConstruct&  Cst          = State.Constructs[State.ActiveConstruct];
    if (std::strncmp(Raw, MatPrefix, std::strlen(MatPrefix)) == 0)
    {
        const int Mat = QueryFractureMaterialById(Raw + std::strlen(MatPrefix));
        if (Mat >= 0)
        {
            Cst.Spec.Material = Mat;
            RecomputeFractureReceipt(Cst);
            char Message[160]{};
            std::snprintf(Message, sizeof(Message), "Material \u201C%s\u201D applied from the Asset Browser",
                          QueryFractureMaterial(Mat).Label);
            AppendFractureWorkspaceLog(State, "FRACTURE", Message, Cst.Title.c_str());
        }
        else
        {
            char Message[192]{};
            std::snprintf(Message, sizeof(Message), "Asset \u201C%s\u201D is not a fracture material", Raw);
            AppendFractureWorkspaceLog(State, "FRACTURE", Message);
        }
    }
    else if (std::strncmp(Raw, SolverPrefix, std::strlen(SolverPrefix)) == 0)
    {
        const int Solver = QueryFractureSolverById(Raw + std::strlen(SolverPrefix));
        if (Solver >= 0)
        {
            // 📝 The handoff applies exactly like the solver-matrix row did.
            Cst.Spec.Solver = Solver;
            RecomputeFractureReceipt(Cst);
            LogFractureWorkspaceValue(State, "PARAM", "Matrix solver", QueryFractureSolver(Solver).Id);
            State.MatrixOpen = false;
        }
        else
        {
            char Message[192]{};
            std::snprintf(Message, sizeof(Message), "Asset \u201C%s\u201D is not a fracture solver", Raw);
            AppendFractureWorkspaceLog(State, "FRACTURE", Message);
        }
    }
    else if (std::strncmp(Raw, SeedPrefix, std::strlen(SeedPrefix)) == 0)
    {
        int Seed = -1;
        for (int I = 0; I < QueryFractureConstructSeedCount(); ++I)
            if (std::strcmp(QueryFractureConstructSeed(I).Id, Raw + std::strlen(PresetPrefix)) == 0) Seed = I;
        if (Seed >= 0)
        {
            SelectFractureWorkspaceNode(State, Seed);
            char Message[160]{};
            std::snprintf(Message, sizeof(Message), "Construct \u201C%s\u201D opened from the Asset Browser",
                          State.Constructs[Seed].Title.c_str());
            AppendFractureWorkspaceLog(State, "FRACTURE", Message);
        }
        else
        {
            char Message[192]{};
            std::snprintf(Message, sizeof(Message), "Asset \u201C%s\u201D is not a fracture construct", Raw);
            AppendFractureWorkspaceLog(State, "FRACTURE", Message);
        }
    }
    else if (std::strncmp(Raw, PresetPrefix, std::strlen(PresetPrefix)) == 0)
    {
        int Found = -1;
        for (int I = 0; I < QueryFracturePresetCount(); ++I)
        {
            const FractureWorkspacePreset& P = QueryFracturePreset(I);
            char Composite[96]{};
            std::snprintf(Composite, sizeof(Composite), "%s-%s", P.Category, P.Material);
            if (std::strcmp(Composite, Raw + std::strlen(PresetPrefix)) == 0) Found = I;
        }
        if (Found >= 0)
        {
            // 📝 The handoff refuses exactly like the old spawn card did.
            char Message[160]{};
            std::snprintf(Message, sizeof(Message), "Spawn %s refused", QueryFracturePreset(Found).Title);
            NoopFractureWorkspaceCommand(State, "SPAWN", Message, "Spawning solids is a NOOP in this shell");
        }
        else
        {
            char Message[192]{};
            std::snprintf(Message, sizeof(Message), "Asset \u201C%s\u201D not found in the spawn catalogue", Raw);
            AppendFractureWorkspaceLog(State, "FRACTURE", Message);
        }
    }
    else
    {
        char Message[192]{};
        std::snprintf(Message, sizeof(Message), "Asset \u201C%s\u201D is not a fracture asset", Raw);
        AppendFractureWorkspaceLog(State, "FRACTURE", Message);
    }
    Link->ClearHandoff();
}

void ConstructFractureWorkspace(FractureWorkspaceState& State, const EditorTypefaces& Faces, ImVec2 Size,
                                AssetBrowserLink* Link, Fracture::IFractureStudioRuntime* Runtime,
                                double DeltaSeconds)
{
    State.Runtime = Runtime;
    State.FrameDeltaSeconds = std::clamp(DeltaSeconds, 0.0, 0.25);
    if (!State.Constructs[State.ActiveConstruct].NativeResultValid)
        RecomputeFractureReceipt(State.Constructs[State.ActiveConstruct]);
    if (State.TimelinePlaying)
    {
        const double Step = State.FrameDeltaSeconds * State.PlaybackRate;
        if (State.Runtime != nullptr)
        {
            if (!RuntimeMatchesActiveRecipe(State) && !BakeActiveFracture(State, "BAKE", false))
                State.TimelinePlaying = false;
            else
                StepActiveFracturePhysics(State, Step);
        }
        else State.TimelineActive = std::clamp(State.TimelineActive + Step, 0.0, State.TimelineDuration);
        if (State.TimelineActive >= State.TimelineDuration) State.TimelinePlaying = false;
    }
    ApplyFractureWorkspaceLink(State, Link);
    State.Rects.clear();
    ImGui::SetNextWindowPos(ImVec2(0.0f, 0.0f));
    ImGui::SetNextWindowSize(Size);
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImGui::ColorConvertU32ToFloat4(ResolveCssColour(0x0B0B0BFF)));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
    ImGui::Begin("##FractureWorkspace", nullptr,
                 ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoScrollbar |
                     ImGuiWindowFlags_NoScrollWithMouse);
    ImGui::PopStyleVar(2);
    ImGui::PopStyleColor();
    ImDrawList* const DrawList = ImGui::GetWindowDrawList();

    PanelCursor Root{ DrawList, &Faces, 1.0f, 12.0f, Size.x - 24.0f, 10.0f };
    ConstructTopBar(State, Root);

    constexpr float StatusTall = 30.0f;
    const ImVec2 StatusMax(Size.x - 12.0f, Size.y - 10.0f);
    const ImVec2 StatusMin(12.0f, StatusMax.y - StatusTall);
    const float WorkspaceY = Root.Y;
    const float WorkspaceH = StatusMin.y - 8.0f - WorkspaceY;
    const float RailWide   = Size.x >= 1280.0f ? 296.0f : 256.0f;
    const float InspectorWide = Size.x >= 1280.0f ? 392.0f : 348.0f;
    const ImVec2 RailMin(12.0f, WorkspaceY);
    const ImVec2 RailMax(12.0f + RailWide, WorkspaceY + WorkspaceH);
    const ImVec2 InspectorMax(Size.x - 12.0f, WorkspaceY + WorkspaceH);
    const ImVec2 InspectorMin(InspectorMax.x - InspectorWide, WorkspaceY);
    const ImVec2 CentreMin(RailMax.x + 10.0f, WorkspaceY);
    const ImVec2 CentreMax(InspectorMin.x - 10.0f, WorkspaceY + WorkspaceH);

    // 📝 Left rail: outliner above, preset library below.
    float OutlinerTall = (RailMax.y - RailMin.y) - 560.0f;
    if (OutlinerTall < 420.0f) OutlinerTall = 420.0f;
    if (OutlinerTall > 780.0f) OutlinerTall = 780.0f;
    ConstructOutlinerPanel(State, Faces, RailMin, ImVec2(RailMax.x, RailMin.y + OutlinerTall));
    ConstructLibraryPanel(State, Faces, ImVec2(RailMin.x, RailMin.y + OutlinerTall + 10.0f), RailMax, Link);

    // 📝 Centre column: viewport panel plus the optional 156 px log drawer.
    const float LogTall = State.LogOpen ? 156.0f : 0.0f;
    const float LogGap  = State.LogOpen ? 10.0f : 0.0f;
    const ImVec2 ViewportMax(CentreMax.x, CentreMax.y - LogTall - LogGap);
    DrawList->AddRectFilled(CentreMin, ViewportMax, ResolveCssColour(0x121212FF), 22.0f);
    ConstructViewportBar(State, Faces, DrawList, CentreMin, ImVec2(ViewportMax.x, CentreMin.y + 46.0f));
    DrawList->AddLine(ImVec2(CentreMin.x, CentreMin.y + 46.0f), ImVec2(ViewportMax.x, CentreMin.y + 46.0f),
                      ResolveCssColour(0xFFFFFF12));

    constexpr float StripTall    = 64.0f;
    constexpr float TimelineTall = 92.0f;
    constexpr float FooterTall   = 30.0f;
    const ImVec2 SurfaceMin(CentreMin.x, CentreMin.y + 46.0f);
    const ImVec2 SurfaceMax(ViewportMax.x, ViewportMax.y - StripTall - TimelineTall - FooterTall);
    ConstructShardStage(State, Faces, DrawList, SurfaceMin, SurfaceMax);
    ConstructTransportStrip(State, Faces, DrawList, ImVec2(CentreMin.x, SurfaceMax.y),
                            ImVec2(ViewportMax.x, SurfaceMax.y + StripTall));
    ConstructTimeline(State, Faces, DrawList, ImVec2(CentreMin.x, SurfaceMax.y + StripTall),
                      ImVec2(ViewportMax.x, SurfaceMax.y + StripTall + TimelineTall));

    const float FootY = SurfaceMax.y + StripTall + TimelineTall;
    DrawList->AddLine(ImVec2(CentreMin.x, FootY), ImVec2(ViewportMax.x, FootY), ResolveCssColour(0xFFFFFF12));
    PanelCursor FootCursor{ DrawList, &Faces, 1.0f, CentreMin.x, ViewportMax.x - CentreMin.x, FootY };
    FootCursor.Text(Faces.Regular, 10.5f, CentreMin.x + 14.0f, FootY + 15.0f - 0.5f * 10.5f * 1.4f, 1.4f,
                    ResolveCssColour(0x848484FF), State.CubeComparisonOpen ? "Select a solver tile to load it on the cube construct"
                                                                              : "Native solver output · convex shards and live Jolt poses");
    const char* CompareLabel = State.CubeComparisonOpen ? "Close cube comparison" : "Compare 6 cube solvers";
    PanelCursor CompareText{DrawList, &Faces, 1.0f, CentreMin.x, ViewportMax.x - CentreMin.x, FootY};
    const float CompareWide = CompareText.Measure(Faces.Medium, 10.0f, CompareLabel) + 20.0f;
    const ImVec2 CompareMax(ViewportMax.x - 14.0f, FootY + 26.0f);
    const ImVec2 CompareMin(CompareMax.x - CompareWide, FootY + 4.0f);
    DrawList->AddRectFilled(CompareMin, CompareMax, ResolveCssColour(State.CubeComparisonOpen ? 0xE8C27A30 : 0x1A1A1AFF), 9.0f);
    DrawList->AddRect(CompareMin, CompareMax, ResolveCssColour(0xFFFFFF20), 9.0f);
    CompareText.Text(Faces.Medium, 10.0f, CompareMin.x + 10.0f, FootY + 15.0f - 7.0f, 1.35f,
                     ResolveCssColour(State.CubeComparisonOpen ? 0xE8C27AFF : 0xBCBCBCFF), CompareLabel);
    RecordFractureWorkspaceRect(State, "Footer/CubeCompare", CompareMin, CompareMax);
    if (InvisibleRect("##CubeCompare", CompareMin, CompareMax)) State.CubeComparisonOpen = !State.CubeComparisonOpen;
    const float LogPillWide = FootCursor.Measure(Faces.Medium, 11.0f, "Log Stream") + 18.0f;
    const ImVec2 LogPillMax(ViewportMax.x - 14.0f, FootY + 26.0f);
    const ImVec2 LogPillMin(LogPillMax.x - LogPillWide, FootY + 4.0f);
    FootCursor.Text(Faces.Medium, 11.0f, LogPillMin.x + 9.0f, FootY + 15.0f - 0.5f * 11.0f * 1.38f, 1.38f,
                    ResolveCssColour(0x848484FF), "Log Stream");
    ImGui::PushID("ViewportFooter");
    RecordRect(State, "Footer/Log", LogPillMin, LogPillMax);
    if (InvisibleRect("##LogToggle", LogPillMin, LogPillMax)) State.LogOpen = !State.LogOpen;
    ImGui::PopID();
    DrawList->AddRect(CentreMin, ViewportMax, ResolveCssColour(0xFFFFFF0E), 22.0f, ImDrawFlags_None, 1.0f);

    if (State.LogOpen) ConstructLogDrawer(State, Faces, ImVec2(CentreMin.x, ViewportMax.y + 10.0f), CentreMax);

    // 📝 Inspector panel: fixed header/footer with the page between them.
    DrawList->AddRectFilled(InspectorMin, InspectorMax, ResolveCssColour(0x121212FF), 22.0f);
    DrawList->AddRect(InspectorMin, InspectorMax, ResolveCssColour(0xFFFFFF0E), 22.0f, ImDrawFlags_None, 1.0f);
    PanelCursor Inspector{ DrawList, &Faces, 1.0f, InspectorMin.x, InspectorMax.x - InspectorMin.x, InspectorMin.y };
    const ImVec2 InspectorHead = Inspector.Space(44.0f);
    DrawList->AddLine(ImVec2(InspectorMin.x, InspectorHead.y + 44.0f), ImVec2(InspectorMax.x, InspectorHead.y + 44.0f),
                      ResolveCssColour(0xFFFFFF12));
    char Crumb[128]{};
    if (State.Selected >= 0 && State.Selected < 7)
        std::snprintf(Crumb, sizeof(Crumb), "Inspector / Fracture / %s",
                      State.Constructs[State.Selected].SolidCategory.c_str());
    else if (State.Selected == FractureWorkspaceState::SelectedSun) std::snprintf(Crumb, sizeof(Crumb), "Inspector / Environment / Sun");
    else if (State.Selected == FractureWorkspaceState::SelectedAtmosphere)
        std::snprintf(Crumb, sizeof(Crumb), "Inspector / Environment / Atmosphere");
    else std::snprintf(Crumb, sizeof(Crumb), "Inspector / Environment / Clouds");
    Inspector.Text(Faces.Light, 12.0f, InspectorMin.x + 16.0f, InspectorHead.y + 22.0f - 0.5f * 12.0f * 1.4f, 1.4f,
                   ResolveCssColour(0xDADADADA), Crumb, -0.2f);
    const float ResetWide = Inspector.Measure(Faces.Medium, 11.0f, "Reset ↗") + 18.0f;
    const ImVec2 ResetMax(InspectorMax.x - 16.0f, InspectorHead.y + 35.0f);
    const ImVec2 ResetMin(ResetMax.x - ResetWide, InspectorHead.y + 9.0f);
    Inspector.Text(Faces.Medium, 11.0f, ResetMin.x + 9.0f, InspectorHead.y + 22.0f - 0.5f * 11.0f * 1.38f, 1.38f,
                   ResolveCssColour(0xE8C27AFF), "Reset ↗");
    RecordRect(State, "Inspector/Reset", ResetMin, ResetMax);
    if (InvisibleRect("##InspectorReset", ResetMin, ResetMax))
    {
        if (State.Selected >= 0 && State.Selected < 7)
        {
            const FractureConstructSeed& Seed = QueryFractureConstructSeed(State.Selected);
            FractureWorkspaceConstruct&  Cst  = State.Constructs[State.Selected];
            Cst.Title               = Seed.Title;
            Cst.SolidCategory       = Seed.SolidCategory;
            Cst.Pipeline            = Seed.Pipeline;
            Cst.BakedResident       = Seed.BakedResident;
            Cst.PrimaryNucleusCells = Seed.PrimaryNucleusCells;
            Cst.Spec                = QueryFractureConstructSeedSpec(State.Selected);
            RecomputeFractureReceipt(Cst);
        }
        else if (State.Selected == FractureWorkspaceState::SelectedSun)
        {
            State.Sun = FractureSunParams{};
            EvaluateFractureSun(State.Sun, State.SunSolved);
        }
        else if (State.Selected == FractureWorkspaceState::SelectedAtmosphere) State.Atmos = FractureAtmosParams{};
        else State.Clouds = FractureCloudsParams{};
        AppendFractureWorkspaceLog(State, "SCENE", "Inspector restored to editor defaults", "local");
        Toast::Show("Visible inspector properties restored to editor defaults.");
    }
    const ImVec2 InspectorFootMin(InspectorMin.x, InspectorMax.y - 30.0f);
    DrawList->AddLine(ImVec2(InspectorMin.x, InspectorFootMin.y), ImVec2(InspectorMax.x, InspectorFootMin.y),
                      ResolveCssColour(0xFFFFFF12));
    DrawList->AddRectFilled(ImVec2(InspectorMin.x, InspectorFootMin.y), InspectorMax, ResolveCssColour(0xFFFFFF04), 0.0f);

    ImGui::SetCursorScreenPos(ImVec2(InspectorMin.x, InspectorHead.y + 44.0f));
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0, 0, 0));
    ImGui::BeginChild("##InspectorScroll", ImVec2(InspectorMax.x - InspectorMin.x, InspectorFootMin.y - InspectorHead.y - 44.0f),
                      false, ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
    {
        const ControlTheme Theme = ControlTheme::ResolveRemastered();
        ControlColumn Column(Theme, Faces, 1.0f, ImVec2(InspectorMin.x + 12.0f, InspectorHead.y + 44.0f + 12.0f),
                             InspectorMax.x - InspectorMin.x - 24.0f);
        ConstructFractureWorkspaceInspector(State, Faces, Column);
        Column.Finalize();
    }
    ImGui::EndChild();
    ImGui::PopStyleColor();

    DrawList->AddRectFilled(StatusMin, StatusMax, ResolveCssColour(0x101010FF), 15.0f);
    DrawList->AddRect(StatusMin, StatusMax, ResolveCssColour(0xFFFFFF0E), 15.0f, ImDrawFlags_None, 1.0f);
    {
        // 📝 Live status figures derive from the active receipt, never the engines.
        const FractureWorkspaceConstruct& Cst = State.Constructs[State.ActiveConstruct];
        const FractureReceipt&            Rec = Cst.Receipt;
        PanelCursor Status{ DrawList, &Faces, 1.0f, StatusMin.x, StatusMax.x - StatusMin.x, StatusMin.y };
        const float MidY = StatusMin.y + StatusTall * 0.5f;
        DrawList->AddCircleFilled(ImVec2(StatusMin.x + 18.0f, MidY), 4.0f,
                                  ResolveCssColour(Rec.WatertightManifold ? 0x7FD08AFF : 0xE8C27AFF), 16);
        const char* Ready = Rec.WatertightManifold ? "Manifold ready" : "Open manifold";
        Status.Text(Faces.Medium, 11.0f, StatusMin.x + 28.0f, MidY - 0.5f * 11.0f * 1.38f, 1.38f,
                    ResolveCssColour(0xBCBCBCFF), Ready);
        float StatX = StatusMin.x + 28.0f + Status.Measure(Faces.Medium, 11.0f, Ready) + 18.0f;
        DrawList->AddLine(ImVec2(StatX, StatusMin.y + 8.0f), ImVec2(StatX, StatusMax.y - 8.0f),
                          ResolveCssColour(0xFFFFFF14));
        StatX += 18.0f;
        char Shards[64]{};
        std::snprintf(Shards, sizeof(Shards), "%d shards · %d/%d bonds", Rec.FragmentCount, Rec.IntactBondCount,
                      Rec.BondCount);
        Status.Text(Faces.Regular, 11.0f, StatX, MidY - 0.5f * 11.0f * 1.4f, 1.4f, ResolveCssColour(0x848484FF),
                    Shards);
        StatX += Status.Measure(Faces.Regular, 11.0f, Shards) + 18.0f;
        DrawList->AddLine(ImVec2(StatX, StatusMin.y + 8.0f), ImVec2(StatX, StatusMax.y - 8.0f),
                          ResolveCssColour(0xFFFFFF14));
        StatX += 18.0f;
        char Drift[96]{};
        std::snprintf(Drift, sizeof(Drift), "ΣV drift %.2e · crack area %.2f m²", Rec.VolumeDriftRatio,
                      Rec.TotalCrackArea);
        Status.Text(Faces.Regular, 11.0f, StatX, MidY - 0.5f * 11.0f * 1.4f, 1.4f, ResolveCssColour(0x848484FF), Drift);
        const float RightTag = Status.Measure(Faces.SemiBold, 10.0f, "FRONTIER / FRACTURE", 0.9f);
        Status.Text(Faces.SemiBold, 10.0f, StatusMax.x - 14.0f - RightTag - 34.0f, MidY - 0.5f * 10.0f * 1.4f, 1.4f,
                    ResolveCssColour(0x707070FF), "FRONTIER / FRACTURE", 0.9f);
        Status.Text(Faces.SemiBold, 10.0f, StatusMax.x - 14.0f - 22.0f, MidY - 0.5f * 10.0f * 1.4f, 1.4f,
                    ResolveCssColour(0xE8C27AFF), "2.0");
        const float CpuTag = Status.Measure(Faces.Regular, 10.5f, "CPU solver · Jolt physics");
        Status.Text(Faces.Regular, 10.5f, StatusMax.x - 14.0f - RightTag - 34.0f - 18.0f - CpuTag,
                    MidY - 0.5f * 10.5f * 1.4f, 1.4f, ResolveCssColour(0x5E5E5EFF), "CPU solver · Jolt physics");
    }

    ConstructSolverMatrix(State, Faces, ImVec2(0.0f, 0.0f), Size);
    Toast::Construct();
    ImGui::End();
}

} // namespace Frontier
