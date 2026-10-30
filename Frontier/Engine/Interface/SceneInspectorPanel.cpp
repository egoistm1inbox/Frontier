/*====================================================================================================================================
                                                    SCENEINSPECTORPANEL.CPP
====================================================================================================================================*/
// 🧩 Theme-aware Inspector host: renders 1:1 VehicleHMI controls, interactive General UI statistical infographics,
//    action buttons, segmented choice pills, boolean switches, and live-bound scalar sliders + numeric inputs.

#include "SceneInspectorPanel.h"

#include "Engine/Interface/SceneDirectoryPanel.h"

#if defined(FRONTIER_WITH_INTERFACE_SDK)

#include "Engine/Interface/StackRailControls.h"
#include "Engine/Scene/SceneDirectory.h"

#include <imgui.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>

namespace Frontier
{

namespace
{

ImU32 ParseInspectorAccent(const std::string& Hex) noexcept
{
    if (Hex.size() == 7 && Hex[0] == '#')
    {
        char* End = nullptr;
        const unsigned long V = std::strtoul(Hex.c_str() + 1, &End, 16);
        if (End == Hex.c_str() + 7)
        {
            return KitInkHex(static_cast<int>(V));
        }
    }
    return KitInkHex(0x38bdf8);
}

std::string UpperCaseString(std::string S)
{
    for (char& C : S)
    {
        C = static_cast<char>(std::toupper(static_cast<unsigned char>(C)));
    }
    return S;
}

void BumpModelRevision(const SceneInspectorModel& Model) noexcept
{
    if (Model.RevisionPtr != nullptr)
    {
        ++(*Model.RevisionPtr);
    }
}

#if defined(FRONTIER_EDITOR_PROFILE)
double ReadScalarField(const RecordEditorScalarField& Field) noexcept
{
    if (Field.Target != nullptr)
    {
        return *Field.Target;
    }
    if (Field.FloatTarget != nullptr)
    {
        return static_cast<double>(*Field.FloatTarget);
    }
    return 0.0;
}

bool WriteScalarField(const RecordEditorScalarField& Field, double Next) noexcept
{
    Next = std::clamp(Next, Field.Minimum, Field.Maximum);
    if (Field.Target != nullptr)
    {
        if (std::abs(*Field.Target - Next) > 1e-12)
        {
            *Field.Target = Next;
            return true;
        }
        return false;
    }
    if (Field.FloatTarget != nullptr)
    {
        const float NextF = static_cast<float>(Next);
        if (std::abs(*Field.FloatTarget - NextF) > 1e-7f)
        {
            *Field.FloatTarget = NextF;
            return true;
        }
    }
    return false;
}
#endif

} // namespace

void ConstructSceneInspectorInterface(SceneDirectoryPanel& Panel)
{
    const SceneInspectorModel& Model  = Panel.QueryInspectorModel();
    const KitFaces             Faces  = ResolveKitFaces();
    const ImGuiStyle&          Style  = ImGui::GetStyle();
    const ImVec2               WinPos = ImGui::GetWindowPos();
    const ImVec2               CurTop = ImGui::GetCursorScreenPos();
    const ImVec2               Origin(WinPos.x, CurTop.y);
    const ImVec2               Size(ImGui::GetWindowSize().x,
                                    std::max(64.0f, WinPos.y + ImGui::GetWindowSize().y - CurTop.y));
    ImDrawList*                Ink    = ImGui::GetWindowDrawList();

    const ImU32 CardBg   = ImGui::ColorConvertFloat4ToU32(Style.Colors[ImGuiCol_FrameBg]);
    const ImU32 HoverBg  = ImGui::ColorConvertFloat4ToU32(Style.Colors[ImGuiCol_FrameBgHovered]);
    const ImU32 EdgeCol  = ImGui::ColorConvertFloat4ToU32(Style.Colors[ImGuiCol_Border]);
    const ImU32 TextCol  = ImGui::ColorConvertFloat4ToU32(Style.Colors[ImGuiCol_Text]);
    const ImU32 MuteCol  = ImGui::ColorConvertFloat4ToU32(Style.Colors[ImGuiCol_TextDisabled]);
    const ImU32 CompCol  = ParseInspectorAccent(Model.Colour);
    const ImU32 MintCol  = KitInkHex(0x2fe6a7);
    const ImU32 CoralCol = KitInkHex(0xf87171);

    // 1. Top Crumb Bar (38 px) + Clickable Enabled Status Pill
    constexpr float HeadH = 38.0f;
    Ink->AddLine(ImVec2(Origin.x, Origin.y + HeadH), ImVec2(Origin.x + Size.x, Origin.y + HeadH), EdgeCol, 1.0f);

    if (!Model.HasSelection)
    {
        KitDrawText(Ink, Faces.Medium, 12.0f, ImVec2(Origin.x + 16.0f, Origin.y + 11.0f), MuteCol, "Inspector");
        KitDrawText(Ink, Faces.Regular, 12.5f, ImVec2(Origin.x + 16.0f, Origin.y + 62.0f), MuteCol,
                    "Select any component in the Outliner or 3D Viewport to inspect and edit live settings.");
        return;
    }

    Ink->AddCircleFilled(ImVec2(Origin.x + 18.0f, Origin.y + HeadH * 0.5f), 4.0f, CompCol);
    const std::string Crumb = UpperCaseString(Model.Group) + "  \xE2\x80\xBA  " + Model.Name;
    KitDrawText(Ink, Faces.Medium, 11.0f, ImVec2(Origin.x + 28.0f, Origin.y + 12.0f), MuteCol, Crumb.c_str());

    if (Model.HasEnabled && Model.EnabledPtr != nullptr)
    {
        const bool  IsOn  = *Model.EnabledPtr;
        const char* Cap   = IsOn ? "Enabled" : "Disabled";
        const float PillW = 74.0f;
        const float PillX = Origin.x + Size.x - PillW - 14.0f;
        const float PillY = Origin.y + 7.0f;
        ImGui::SetCursorScreenPos(ImVec2(PillX, PillY));
        ImGui::InvisibleButton("##InspectorEnableToggle", ImVec2(PillW, 24.0f));
        if (ImGui::IsItemClicked())
        {
            *Model.EnabledPtr = !IsOn;
            BumpModelRevision(Model);
        }
        const ImU32 PillTint = IsOn ? MintCol : CoralCol;
        const ImU32 PillBg   = IM_COL32(
            (PillTint >> IM_COL32_R_SHIFT) & 0xFF,
            (PillTint >> IM_COL32_G_SHIFT) & 0xFF,
            (PillTint >> IM_COL32_B_SHIFT) & 0xFF, 34);
        KitPillSurface(Ink, ImVec2(PillX, PillY), ImVec2(PillX + PillW, PillY + 24.0f), PillBg, PillTint, 12.0f);
        Ink->AddCircleFilled(ImVec2(PillX + 12.0f, PillY + 12.0f), 3.2f, PillTint);
        KitDrawText(Ink, Faces.SemiBold, 10.5f, ImVec2(PillX + 20.0f, PillY + 5.5f), TextCol, Cap);
    }

    // 2. Scrollable Inspector Body
    const float ScrollTop = Origin.y + HeadH + 2.0f;
    const float ScrollH   = std::max(48.0f, Size.y - HeadH - 4.0f);

    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0, 0, 0));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(16.0f, 14.0f));
    ImGui::SetCursorScreenPos(ImVec2(Origin.x, ScrollTop));
    if (ImGui::BeginChild("##InspectorScroll", ImVec2(Size.x, ScrollH), false))
    {
        ImDrawList* CInk  = ImGui::GetWindowDrawList();
        const float Left  = Origin.x + 16.0f;
        const float Right = ImGui::GetWindowPos().x + ImGui::GetWindowContentRegionMax().x - 16.0f;
        const float Width = std::max(120.0f, Right - Left);

        ImVec2 Cur = ImGui::GetCursorScreenPos();
        Cur.x      = Left;
        const std::string Eyebrow = UpperCaseString(Model.Category);
        CInk->AddRectFilled(ImVec2(Left, Cur.y + 2.0f), ImVec2(Left + 3.5f, Cur.y + 38.0f), CompCol, 2.0f);
        KitDrawTracked(CInk, Faces.SemiBold, 9.5f, ImVec2(Left + 11.0f, Cur.y), MuteCol, Eyebrow.c_str(), 1.15f);
        KitDrawText(CInk, Faces.SemiBold, 18.5f, ImVec2(Left + 11.0f, Cur.y + 14.0f), TextCol, Model.Name.c_str());
        ImGui::SetCursorScreenPos(ImVec2(Left, Cur.y + 42.0f));

        if (!Model.Description.empty())
        {
            const ImVec2 DPos = ImGui::GetCursorScreenPos();
            // Truncate cleanly to two lines or wrap inside Right
            ImGui::PushFont(Faces.Regular, 11.5f);
            ImGui::PushStyleColor(ImGuiCol_Text, Style.Colors[ImGuiCol_TextDisabled]);
            ImGui::PushTextWrapPos(Right);
            ImGui::SetCursorScreenPos(ImVec2(Left, DPos.y));
            ImGui::TextUnformatted(Model.Description.c_str());
            ImGui::PopTextWrapPos();
            ImGui::PopStyleColor();
            ImGui::PopFont();
            ImGui::Dummy(ImVec2(Width, 6.0f));
        }

#if defined(FRONTIER_EDITOR_PROFILE)
        // Custom 1:1 VehicleHMI Dashboard / SourceImages/General UI Interactive Statistical Infographic
        if (Model.ConstructInfographic)
        {
            ImGui::SetCursorScreenPos(ImVec2(Left, ImGui::GetCursorScreenPos().y));
            Model.ConstructInfographic();
            ImGui::Dummy(ImVec2(Width, 4.0f));
        }

        // Interactive Action Buttons
        if (!Model.Actions.empty())
        {
            Cur = ImGui::GetCursorScreenPos();
            float X = Left;
            float Y = Cur.y;
            for (size_t Idx = 0; Idx < Model.Actions.size(); ++Idx)
            {
                const RecordEditorAction& Act = Model.Actions[Idx];
                if (Act.Label == nullptr || !Act.Invoke)
                {
                    continue;
                }
                const float BW = KitTextWidth(Faces.SemiBold, 11.0f, Act.Label) + 22.0f;
                if (X > Left && X + BW > Right)
                {
                    X = Left;
                    Y += 32.0f;
                }
                ImGui::PushID(static_cast<int>(Idx + 1000));
                ImGui::SetCursorScreenPos(ImVec2(X, Y));
                ImGui::InvisibleButton("##ActBtn", ImVec2(BW, 27.0f));
                const bool Hov = ImGui::IsItemHovered();
                const ImU32 Fill = Act.Tone == 1 ? (Hov ? CompCol : IM_COL32(
                                       (CompCol >> IM_COL32_R_SHIFT) & 0xFF,
                                       (CompCol >> IM_COL32_G_SHIFT) & 0xFF,
                                       (CompCol >> IM_COL32_B_SHIFT) & 0xFF, 215))
                                 : (Act.Tone == 2 ? KitInkHex(0xef4444) : (Hov ? HoverBg : CardBg));
                const ImU32 Txt  = (Act.Tone == 1 || Act.Tone == 2) ? KitInkHex(0x0b0f17) : TextCol;
                KitPillSurface(CInk, ImVec2(X, Y), ImVec2(X + BW, Y + 27.0f), Fill, Act.Tone ? CompCol : EdgeCol, 8.0f);
                KitDrawText(CInk, Faces.SemiBold, 11.0f, ImVec2(X + 11.0f, Y + 6.5f), Txt, Act.Label);
                if (ImGui::IsItemClicked())
                {
                    Act.Invoke();
                    BumpModelRevision(Model);
                }
                ImGui::PopID();
                X += BW + 6.0f;
            }
            ImGui::SetCursorScreenPos(ImVec2(Left, Y + 35.0f));
        }

        // Segmented Choice Fields
        for (size_t CIdx = 0; CIdx < Model.ChoiceFields.size(); ++CIdx)
        {
            const RecordEditorChoiceField& CF = Model.ChoiceFields[CIdx];
            if (CF.Target == nullptr || CF.Options.empty())
            {
                continue;
            }
            Cur = ImGui::GetCursorScreenPos();
            const float CardH = 60.0f;
            KitPillSurface(CInk, ImVec2(Left, Cur.y), ImVec2(Right, Cur.y + CardH), CardBg, EdgeCol, 10.0f);
            const std::string CapUpper = UpperCaseString(CF.Label != nullptr ? CF.Label : "");
            KitDrawTracked(CInk, Faces.SemiBold, 9.5f, ImVec2(Left + 12.0f, Cur.y + 8.0f), MuteCol, CapUpper.c_str(), 0.9f);

            const float OptY   = Cur.y + 26.0f;
            const float OptGap = 4.0f;
            const float OptW   = (Width - 24.0f - OptGap * static_cast<float>(CF.Options.size() - 1)) /
                                 static_cast<float>(CF.Options.size());
            ImGui::PushID(static_cast<int>(CIdx + 2000));
            for (size_t OIdx = 0; OIdx < CF.Options.size(); ++OIdx)
            {
                const RecordEditorChoiceOption& Opt = CF.Options[OIdx];
                const float OX    = Left + 12.0f + static_cast<float>(OIdx) * (OptW + OptGap);
                const bool  IsAct = (*CF.Target == Opt.Value);
                ImGui::SetCursorScreenPos(ImVec2(OX, OptY));
                ImGui::InvisibleButton("##ChoiceOpt", ImVec2(OptW, 25.0f));
                if (ImGui::IsItemClicked() && *CF.Target != Opt.Value)
                {
                    *CF.Target = Opt.Value;
                    BumpModelRevision(Model);
                }
                const ImU32 OFill = IsAct ? IM_COL32(
                    (CompCol >> IM_COL32_R_SHIFT) & 0xFF,
                    (CompCol >> IM_COL32_G_SHIFT) & 0xFF,
                    (CompCol >> IM_COL32_B_SHIFT) & 0xFF, 48)
                    : (ImGui::IsItemHovered() ? HoverBg : IM_COL32(0, 0, 0, 45));
                KitPillSurface(CInk, ImVec2(OX, OptY), ImVec2(OX + OptW, OptY + 25.0f),
                               OFill, IsAct ? CompCol : EdgeCol, 7.0f);
                const float TW = KitTextWidth(IsAct ? Faces.SemiBold : Faces.Regular, 10.5f, Opt.Label);
                KitDrawText(CInk, IsAct ? Faces.SemiBold : Faces.Regular, 10.5f,
                            ImVec2(OX + (OptW - TW) * 0.5f, OptY + 5.5f), IsAct ? TextCol : MuteCol, Opt.Label);
            }
            ImGui::PopID();
            ImGui::SetCursorScreenPos(ImVec2(Left, Cur.y + CardH + 8.0f));
        }

        // Boolean Switch Card
        if (!Model.Switches.empty())
        {
            Cur = ImGui::GetCursorScreenPos();
            const float RowH  = 30.0f;
            const float CardH = 28.0f + static_cast<float>(Model.Switches.size()) * RowH;
            KitPillSurface(CInk, ImVec2(Left, Cur.y), ImVec2(Right, Cur.y + CardH), CardBg, EdgeCol, 10.0f);
            KitDrawTracked(CInk, Faces.SemiBold, 9.5f, ImVec2(Left + 12.0f, Cur.y + 8.0f), MuteCol, "SWITCHES & GATES", 0.9f);

            for (size_t SIdx = 0; SIdx < Model.Switches.size(); ++SIdx)
            {
                const RecordEditorSwitch& Sw = Model.Switches[SIdx];
                if (Sw.Target == nullptr)
                {
                    continue;
                }
                const float SY = Cur.y + 24.0f + static_cast<float>(SIdx) * RowH;
                ImGui::PushID(static_cast<int>(SIdx + 3000));
                ImGui::SetCursorScreenPos(ImVec2(Left + 10.0f, SY));
                ImGui::InvisibleButton("##SwRow", ImVec2(Width - 20.0f, RowH - 2.0f));
                if (ImGui::IsItemClicked())
                {
                    *Sw.Target = !(*Sw.Target);
                    BumpModelRevision(Model);
                }
                KitDrawText(CInk, Faces.Regular, 11.5f, ImVec2(Left + 12.0f, SY + 6.0f), TextCol, Sw.Label);

                const float TrackW = 36.0f;
                const float TrackH = 18.0f;
                const float TrackX = Right - TrackW - 12.0f;
                const float TrackY = SY + 5.0f;
                const bool  On     = *Sw.Target;
                KitPillSurface(CInk, ImVec2(TrackX, TrackY), ImVec2(TrackX + TrackW, TrackY + TrackH),
                               On ? CompCol : IM_COL32(80, 90, 108, 120), EdgeCol, 9.0f);
                const float KnobX = On ? (TrackX + TrackW - 9.0f) : (TrackX + 9.0f);
                CInk->AddCircleFilled(ImVec2(KnobX, TrackY + TrackH * 0.5f), 6.5f,
                                      On ? KitInkHex(0x0b0f17) : KitInkHex(0xe2e8f0));
                ImGui::PopID();
            }
            ImGui::SetCursorScreenPos(ImVec2(Left, Cur.y + CardH + 8.0f));
        }

        // Scalar Parameter Cards (grouped by Section)
        size_t FIdx = 0;
        while (FIdx < Model.ScalarFields.size())
        {
            const std::string SecName = Model.ScalarFields[FIdx].Section != nullptr && Model.ScalarFields[FIdx].Section[0] != '\0'
                                      ? Model.ScalarFields[FIdx].Section
                                      : "PARAMETERS";
            size_t EndIdx = FIdx + 1;
            while (EndIdx < Model.ScalarFields.size())
            {
                const std::string NextSec = Model.ScalarFields[EndIdx].Section != nullptr &&
                                            Model.ScalarFields[EndIdx].Section[0] != '\0'
                                          ? Model.ScalarFields[EndIdx].Section
                                          : "PARAMETERS";
                if (NextSec != SecName)
                {
                    break;
                }
                ++EndIdx;
            }

            Cur = ImGui::GetCursorScreenPos();
            const float RowH  = 38.0f;
            const float CardH = 30.0f + static_cast<float>(EndIdx - FIdx) * RowH;
            KitPillSurface(CInk, ImVec2(Left, Cur.y), ImVec2(Right, Cur.y + CardH), CardBg, EdgeCol, 10.0f);
            const std::string UpperSec = UpperCaseString(SecName);
            KitDrawTracked(CInk, Faces.SemiBold, 9.5f, ImVec2(Left + 12.0f, Cur.y + 8.5f), MuteCol, UpperSec.c_str(), 0.9f);

            for (size_t K = FIdx; K < EndIdx; ++K)
            {
                const RecordEditorScalarField& Field = Model.ScalarFields[K];
                if (Field.Target == nullptr && Field.FloatTarget == nullptr)
                {
                    continue;
                }
                const float RY  = Cur.y + 26.0f + static_cast<float>(K - FIdx) * RowH;
                double      Val = ReadScalarField(Field);

                std::string RowCap = Field.Label != nullptr ? Field.Label : "";
                if (Field.Unit != nullptr && Field.Unit[0] != '\0' && std::string(Field.Unit) != "-")
                {
                    RowCap += " (";
                    RowCap += Field.Unit;
                    RowCap += ")";
                }
                KitDrawText(CInk, Faces.Regular, 11.5f, ImVec2(Left + 12.0f, RY + 7.5f), TextCol, RowCap.c_str());

                const float NumW    = 66.0f;
                const float NumX    = Right - NumW - 12.0f;
                const float SliderW = std::clamp(Width * 0.34f, 76.0f, 148.0f);
                const float SliderX = NumX - SliderW - 10.0f;

                ImGui::PushID(static_cast<int>(K + 4000));

                // Custom themed horizontal rail + thumb
                ImGui::SetCursorScreenPos(ImVec2(SliderX, RY + 4.0f));
                ImGui::InvisibleButton("##ScalarRail", ImVec2(SliderW, 24.0f));
                if (ImGui::IsItemActive())
                {
                    const float T = std::clamp((ImGui::GetIO().MousePos.x - SliderX) / SliderW, 0.0f, 1.0f);
                    double Next   = Field.Minimum + static_cast<double>(T) * (Field.Maximum - Field.Minimum);
                    if (Field.Step > 0.0)
                    {
                        Next = std::round(Next / Field.Step) * Field.Step;
                    }
                    if (WriteScalarField(Field, Next))
                    {
                        Val = ReadScalarField(Field);
                        BumpModelRevision(Model);
                    }
                }
                const float Norm = (Field.Maximum > Field.Minimum)
                    ? static_cast<float>(std::clamp((Val - Field.Minimum) / (Field.Maximum - Field.Minimum), 0.0, 1.0))
                    : 0.0f;
                const float RailY = RY + 16.0f;
                CInk->AddRectFilled(ImVec2(SliderX, RailY - 2.0f), ImVec2(SliderX + SliderW, RailY + 2.0f),
                                    IM_COL32(90, 102, 120, 110), 2.0f);
                if (Norm > 0.005f)
                {
                    CInk->AddRectFilled(ImVec2(SliderX, RailY - 2.0f),
                                        ImVec2(SliderX + SliderW * Norm, RailY + 2.0f), CompCol, 2.0f);
                }
                CInk->AddCircleFilled(ImVec2(SliderX + SliderW * Norm, RailY), 5.5f, KitInkHex(0xf8fafc));
                CInk->AddCircle(ImVec2(SliderX + SliderW * Norm, RailY), 5.5f, CompCol, 0, 1.5f);

                // Editable numeric pill
                char Fmt[16] = {};
                std::snprintf(Fmt, sizeof(Fmt), "%%.%df", std::clamp(Field.Digits, 0, 5));
                ImGui::SetCursorScreenPos(ImVec2(NumX, RY + 4.0f));
                ImGui::SetNextItemWidth(NumW);
                ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 6.0f);
                ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(6.0f, 3.5f));
                double EditVal = Val;
                if (ImGui::InputDouble("##ScalarNum", &EditVal, 0.0, 0.0, Fmt, ImGuiInputTextFlags_EnterReturnsTrue))
                {
                    if (WriteScalarField(Field, EditVal))
                    {
                        BumpModelRevision(Model);
                    }
                }
                ImGui::PopStyleVar(2);

                ImGui::PopID();
            }
            ImGui::SetCursorScreenPos(ImVec2(Left, Cur.y + CardH + 8.0f));
            FIdx = EndIdx;
        }
#endif
        ImGui::Dummy(ImVec2(Width, 12.0f));
    }
    ImGui::EndChild();
    ImGui::PopStyleVar();
    ImGui::PopStyleColor();
}

} // namespace Frontier

#else

namespace Frontier
{
void ConstructSceneInspectorInterface(SceneDirectoryPanel&) {}
} // namespace Frontier

#endif
