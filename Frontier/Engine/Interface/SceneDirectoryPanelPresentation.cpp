/*==========================================================================================================================================
                                                NATIVE PRESENTATION OF THE OUTLINER PANEL
==========================================================================================================================================*/

#include "SceneDirectoryPanel.h"

#if defined(FRONTIER_WITH_INTERFACE_SDK)

#include "Engine/Interface/DropdownControls.h"
#include "Engine/Interface/StackRailControls.h"
#include "Engine/Scene/SceneDirectory.h"
#include "SceneDirectoryPanelRegistration.h"

#include <imgui.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <string>

namespace Frontier
{

namespace
{

ImU32 ParseHexColourOrFallback(const std::string& Hex, RecordClassification Classification) noexcept
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
    switch (Classification)
    {
        case RecordClassification::Vehicle:      return KitInkHex(0xe1d34a);
        case RecordClassification::Tyre:         return KitInkHex(0x63a8ff);
        case RecordClassification::Environment:  return KitInkHex(0xfbbf24);
        case RecordClassification::Geometry:     return KitInkHex(0xa78bfa);
        case RecordClassification::Illumination: return KitInkHex(0xffb454);
        case RecordClassification::Camera:       return KitInkHex(0xf472b6);
        case RecordClassification::Physics:      return KitInkHex(0xf87171);
        case RecordClassification::Interface:    return KitInkHex(0x38bdf8);
        case RecordClassification::Content:      return KitInkHex(0x2dd4bf);
        case RecordClassification::Unclassified: return KitInkHex(0x64748b);
        case RecordClassification::Count:        break;
    }
    return KitInkHex(0x64748b);
}

std::string UpperAscii(std::string S)
{
    for (char& C : S)
    {
        C = static_cast<char>(std::toupper(static_cast<unsigned char>(C)));
    }
    return S;
}

void KitGlyphCheck(ImDrawList* Ink, ImVec2 C, float R, ImU32 Col, float Thick)
{
    const ImVec2 Pts[3] = {ImVec2(C.x - R * 0.72f, C.y + R * 0.05f),
                           ImVec2(C.x - R * 0.16f, C.y + R * 0.62f),
                           ImVec2(C.x + R * 0.78f, C.y - R * 0.56f)};
    Ink->AddPolyline(Pts, 3, Col, 0, Thick);
}

void KitGlyphTriangleAlert(ImDrawList* Ink, ImVec2 C, float R, ImU32 Col)
{
    Ink->AddTriangle(ImVec2(C.x, C.y - R * 0.82f),
                     ImVec2(C.x + R * 0.88f, C.y + R * 0.72f),
                     ImVec2(C.x - R * 0.88f, C.y + R * 0.72f), Col, 1.35f);
    Ink->AddLine(ImVec2(C.x, C.y - R * 0.22f), ImVec2(C.x, C.y + R * 0.25f), Col, 1.35f);
}

void KitGlyphMagnifier(ImDrawList* Ink, ImVec2 C, float R, ImU32 Col, float Thick)
{
    Ink->AddCircle(ImVec2(C.x - R * 0.18f, C.y - R * 0.18f), R * 0.68f, Col, 16, Thick);
    Ink->AddLine(ImVec2(C.x + R * 0.30f, C.y + R * 0.30f),
                 ImVec2(C.x + R * 0.86f, C.y + R * 0.86f), Col, Thick);
}

void KitGlyphChevron(ImDrawList* Ink, ImVec2 C, float R, ImU32 Col, bool Expanded)
{
    if (Expanded)
    {
        const ImVec2 Pts[3] = {ImVec2(C.x - R, C.y - R * 0.45f), ImVec2(C.x, C.y + R * 0.55f), ImVec2(C.x + R, C.y - R * 0.45f)};
        Ink->AddPolyline(Pts, 3, Col, 0, 1.4f);
    }
    else
    {
        const ImVec2 Pts[3] = {ImVec2(C.x - R * 0.45f, C.y - R), ImVec2(C.x + R * 0.55f, C.y), ImVec2(C.x - R * 0.45f, C.y + R)};
        Ink->AddPolyline(Pts, 3, Col, 0, 1.4f);
    }
}

void KitGlyphEye(ImDrawList* Ink, ImVec2 C, float R, ImU32 Col, bool Open)
{
    Ink->AddCircle(C, R * 0.78f, Col, 16, 1.25f);
    if (Open)
    {
        Ink->AddCircleFilled(C, R * 0.34f, Col, 12);
    }
    else
    {
        Ink->AddLine(ImVec2(C.x - R * 0.85f, C.y + R * 0.85f),
                     ImVec2(C.x + R * 0.85f, C.y - R * 0.85f), Col, 1.3f);
    }
}

} // namespace

DockPanelSpecification MakeSceneDirectoryPanelSpecification(SceneDirectoryPanel& Panel)
{
    DockPanelSpecification Specification;
    Specification.Key              = "Outliner";
    Specification.Caption          = "Outliner";
    Specification.ConstructContent = [&Panel]() { Panel.ConstructInterface(); };
    Specification.Open             = true;
    return Specification;
}

void SceneDirectoryPanel::ConstructInterface()
{
    SceneDirectory&              Directory = SceneDirectory::Instance();
    const KitFaces               Faces     = ResolveKitFaces();
    const ImGuiStyle&            Style     = ImGui::GetStyle();
    static std::array<char, 128> FilterBuffer{};
    static std::string           FilterSynchronised;

    const ImVec2 WinPos  = ImGui::GetWindowPos();
    const ImVec2 WinSize = ImGui::GetWindowSize();
    const ImVec2 CurTop  = ImGui::GetCursorScreenPos();
    const float  PL      = WinPos.x + 12.0f;
    const float  PR      = WinPos.x + WinSize.x - 12.0f;
    const float  PT      = CurTop.y + 4.0f;
    const float  Width   = std::max(120.0f, PR - PL);
    ImDrawList*  Ink     = ImGui::GetWindowDrawList();

    const ImU32 CardBg   = ImGui::ColorConvertFloat4ToU32(Style.Colors[ImGuiCol_FrameBg]);
    const ImU32 HoverBg  = ImGui::ColorConvertFloat4ToU32(Style.Colors[ImGuiCol_FrameBgHovered]);
    const ImU32 EdgeCol  = ImGui::ColorConvertFloat4ToU32(Style.Colors[ImGuiCol_Border]);
    const ImU32 TextCol  = ImGui::ColorConvertFloat4ToU32(Style.Colors[ImGuiCol_Text]);
    const ImU32 MuteCol  = ImGui::ColorConvertFloat4ToU32(Style.Colors[ImGuiCol_TextDisabled]);
    const ImU32 MintCol  = KitInkHex(0x2fe6a7);
    const ImU32 CoralCol = KitInkHex(0xf87171);

    // 1. Outliner Header + Component Count Pill + Add ("+") Button
    KitDrawText(Ink, Faces.SemiBold, 14.0f, ImVec2(PL + 2.0f, PT + 3.0f), TextCol, "Outliner");
    char TotalLabel[48] = {};
    std::snprintf(TotalLabel, sizeof(TotalLabel), "%u components", Total);
    const float BadgeW = KitTextWidth(Faces.Medium, 10.5f, TotalLabel) + 16.0f;
    KitPillSurface(Ink, ImVec2(PL + 68.0f, PT + 1.0f), ImVec2(PL + 68.0f + BadgeW, PT + 21.0f), CardBg, EdgeCol, 10.0f);
    KitDrawText(Ink, Faces.Medium, 10.5f, ImVec2(PL + 76.0f, PT + 4.5f), MuteCol, TotalLabel);

    ImGui::SetCursorScreenPos(ImVec2(PR - 26.0f, PT - 1.0f));
    ImGui::InvisibleButton("##OutlinerSpawnAdd", ImVec2(26.0f, 24.0f));
    const bool AddHov = ImGui::IsItemHovered();
    KitPillSurface(Ink, ImVec2(PR - 26.0f, PT - 1.0f), ImVec2(PR, PT + 23.0f), AddHov ? HoverBg : CardBg, EdgeCol, 8.0f);
    KitDrawText(Ink, Faces.SemiBold, 14.0f, ImVec2(PR - 17.5f, PT + 2.0f), TextCol, "+");
    if (ImGui::IsItemClicked())
    {
        ImGui::OpenPopup("##OutlinerSpawnMenu");
    }
    if (ImGui::BeginPopup("##OutlinerSpawnMenu"))
    {
        for (uint32_t Idx = 0; Idx < static_cast<uint32_t>(RecordClassification::Count); ++Idx)
        {
            const auto ClassVal = static_cast<RecordClassification>(Idx);
            if (ImGui::MenuItem(RecordClassificationName(ClassVal)))
            {
                RequestSpawn(ClassVal);
            }
        }
        ImGui::EndPopup();
    }

    // 2. VehicleHMI Twin KPI Tiles: Enabled vs Disabled
    const float TileTop = PT + 29.0f;
    const float TileH   = 44.0f;
    const float TileGap = 8.0f;
    const float TileW   = (Width - TileGap) * 0.5f;

    auto DrawCountTile = [&](float X, const char* Caption, uint32_t CountVal, ImU32 Accent, bool IsCheck) {
        KitPillSurface(Ink, ImVec2(X, TileTop), ImVec2(X + TileW, TileTop + TileH), CardBg, EdgeCol, 10.0f);
        const ImVec2 DotC(X + 14.0f, TileTop + 15.0f);
        Ink->AddCircleFilled(DotC, 6.0f, IM_COL32(
            (Accent >> IM_COL32_R_SHIFT) & 0xFF,
            (Accent >> IM_COL32_G_SHIFT) & 0xFF,
            (Accent >> IM_COL32_B_SHIFT) & 0xFF, 42));
        if (IsCheck)
        {
            KitGlyphCheck(Ink, DotC, 4.5f, Accent, 1.5f);
        }
        else
        {
            KitGlyphTriangleAlert(Ink, DotC, 5.0f, Accent);
        }
        KitDrawText(Ink, Faces.Regular, 10.5f, ImVec2(X + 10.0f, TileTop + 26.0f), MuteCol, Caption);
        char NumBuf[24] = {};
        std::snprintf(NumBuf, sizeof(NumBuf), "%u", CountVal);
        const float NW = KitTextWidth(Faces.SemiBold, 16.5f, NumBuf);
        KitDrawText(Ink, Faces.SemiBold, 16.5f, ImVec2(X + TileW - NW - 12.0f, TileTop + 13.0f), TextCol, NumBuf);
    };
    DrawCountTile(PL, "Enabled", EnabledCounts.Enabled, MintCol, true);
    DrawCountTile(PL + TileW + TileGap, "Disabled", EnabledCounts.Disabled, CoralCol, false);

    // 3. Search Filter Box + Classification Filter Pill
    const float SearchTop = TileTop + TileH + 8.0f;
    const float SearchH   = 28.0f;
    const float FilterW   = 62.0f;
    const float SearchW   = Width - FilterW - 6.0f;

    if (FilterSynchronised != TextFilter)
    {
        std::snprintf(FilterBuffer.data(), FilterBuffer.size(), "%s", TextFilter.c_str());
        FilterSynchronised = TextFilter;
    }
    KitPillSurface(Ink, ImVec2(PL, SearchTop), ImVec2(PL + SearchW, SearchTop + SearchH), CardBg, EdgeCol, 9.0f);
    KitGlyphMagnifier(Ink, ImVec2(PL + 14.0f, SearchTop + SearchH * 0.5f), 5.0f, MuteCol, 1.4f);

    ImGui::SetCursorScreenPos(ImVec2(PL + 24.0f, SearchTop + 4.0f));
    ImGui::PushItemWidth(SearchW - 30.0f);
    ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0, 0, 0, 0));
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(2.0f, 3.0f));
    if (ImGui::InputTextWithHint("##OutlinerSearchInput", "Find component...", FilterBuffer.data(), FilterBuffer.size()))
    {
        ConfigureTextFilter(FilterBuffer.data());
        FilterSynchronised = TextFilter;
    }
    ImGui::PopStyleVar();
    ImGui::PopStyleColor();
    ImGui::PopItemWidth();

    const float FiltX = PL + SearchW + 6.0f;
    ImGui::SetCursorScreenPos(ImVec2(FiltX, SearchTop));
    ImGui::InvisibleButton("##OutlinerClassFilterBtn", ImVec2(FilterW, SearchH));
    KitPillSurface(Ink, ImVec2(FiltX, SearchTop), ImVec2(FiltX + FilterW, SearchTop + SearchH),
                   ImGui::IsItemHovered() ? HoverBg : CardBg, EdgeCol, 9.0f);
    const char* FiltCap = ClassificationFilter.has_value() ? RecordClassificationName(*ClassificationFilter) : "Groups";
    KitDrawText(Ink, Faces.Medium, 10.5f, ImVec2(FiltX + 10.0f, SearchTop + 7.5f),
                ClassificationFilter.has_value() ? MintCol : TextCol, FiltCap);
    if (ImGui::IsItemClicked())
    {
        ImGui::OpenPopup("##OutlinerClassFilterPopup");
    }
    if (ImGui::BeginPopup("##OutlinerClassFilterPopup"))
    {
        if (ImGui::MenuItem("All 8 Groups", nullptr, !ClassificationFilter.has_value()))
        {
            ConfigureClassificationFilter(std::nullopt);
        }
        ImGui::Separator();
        for (const SceneClassificationTab& Tab : Tabs)
        {
            if (Tab.Count == 0)
            {
                continue;
            }
            char Line[64] = {};
            std::snprintf(Line, sizeof(Line), "%s (%u)", RecordClassificationName(Tab.Classification), Tab.Count);
            if (ImGui::MenuItem(Line, nullptr, ClassificationFilter == Tab.Classification))
            {
                ConfigureClassificationFilter(Tab.Classification);
            }
        }
        ImGui::EndPopup();
    }

    // 4. Scrollable Grouped Component Tree (Render, Environment, Forcefield, Vehicle, Effects, Destruction, Level, Networking)
    const float TreeTop    = SearchTop + SearchH + 8.0f;
    const float FooterH    = 24.0f;
    const float TreeBottom = WinPos.y + WinSize.y - FooterH;
    const float TreeH      = std::max(48.0f, TreeBottom - TreeTop);

    ImGui::SetCursorScreenPos(ImVec2(WinPos.x, TreeTop));
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0, 0, 0));
    if (ImGui::BeginChild("##OutlinerGroupedList", ImVec2(WinSize.x, TreeH), false))
    {
        ImDrawList* TInk = ImGui::GetWindowDrawList();
        const float InnerRight = ImGui::GetWindowPos().x + ImGui::GetWindowContentRegionMax().x - 10.0f;

        for (size_t GIdx = 0; GIdx < Groups.size(); ++GIdx)
        {
            const SceneDirectoryGroupSection& Sec = Groups[GIdx];
            if (Sec.Rows.empty())
            {
                continue;
            }

            const bool GroupFolded = QueryGroupCollapsed(Sec.Group);
            const ImVec2 GStart    = ImGui::GetCursorScreenPos();
            const float  GH        = 24.0f;
            ImGui::PushID(static_cast<int>(GIdx));
            ImGui::SetCursorScreenPos(ImVec2(PL, GStart.y));
            ImGui::InvisibleButton("##GrpHdr", ImVec2(InnerRight - PL, GH));
            if (ImGui::IsItemClicked())
            {
                ConfigureGroupCollapsed(Sec.Group, !GroupFolded);
            }
            KitGlyphChevron(TInk, ImVec2(PL + 6.0f, GStart.y + GH * 0.5f), 3.5f, MuteCol, !GroupFolded);
            const std::string UpperGrp = UpperAscii(Sec.Group);
            KitDrawTracked(TInk, Faces.SemiBold, 9.5f, ImVec2(PL + 16.0f, GStart.y + 6.0f), MuteCol, UpperGrp.c_str(), 1.2f);
            ImGui::PopID();

            if (GroupFolded && TextFilter.empty())
            {
                continue;
            }

            for (const SceneDirectoryRow& Row : Sec.Rows)
            {
                if (Row.DepthTier > 0 && TextFilter.empty())
                {
                    // Check if ancestor is collapsed
                    bool Skip = false;
                    for (const SceneDirectoryRow& Cand : Sec.Rows)
                    {
                        if (Cand.DepthTier < Row.DepthTier && Cand.Collapsed && Cand.ChildCount > 0)
                        {
                            if (Directory.QueryParent(Row.Token) == Cand.Token)
                            {
                                Skip = true;
                                break;
                            }
                        }
                    }
                    if (Skip)
                    {
                        continue;
                    }
                }

                const ImVec2 RStart = ImGui::GetCursorScreenPos();
                const float  RH     = 28.0f;
                const float  Indent = PL + static_cast<float>(Row.DepthTier) * 14.0f;
                const bool   IsSel  = (Row.Token == Selected);
                const ImU32  AccCol = ParseHexColourOrFallback(Row.Colour, Row.Classification);

                ImGui::PushID(static_cast<int>(Row.Token.Value));

                // Eye / Enabled toggle button at right edge
                const float EyeX = InnerRight - 22.0f;
                ImGui::SetCursorScreenPos(ImVec2(EyeX, RStart.y + 2.0f));
                ImGui::InvisibleButton("##RowEye", ImVec2(22.0f, RH - 4.0f));
                const bool EyeClicked = ImGui::IsItemClicked();
                if (EyeClicked)
                {
#if defined(FRONTIER_EDITOR_PROFILE)
                    if (const RecordEditorDescription* Desc = Directory.QueryEditorDescription(Row.Token);
                        Desc != nullptr && Desc->Enabled != nullptr)
                    {
                        *Desc->Enabled = !(*Desc->Enabled);
                        if (Desc->Revision != nullptr)
                        {
                            ++(*Desc->Revision);
                        }
                    }
                    else
#endif
                    {
                        Directory.ConfigureVisible(Row.Token, !Row.Visible);
                    }
                }

                // Subtree chevron if parent row
                bool ChevClicked = false;
                if (Row.ChildCount > 0)
                {
                    ImGui::SetCursorScreenPos(ImVec2(Indent, RStart.y + 2.0f));
                    ImGui::InvisibleButton("##RowChev", ImVec2(14.0f, RH - 4.0f));
                    ChevClicked = ImGui::IsItemClicked();
                    if (ChevClicked)
                    {
                        ConfigureCollapsed(Row.Token, !Row.Collapsed);
                    }
                }

                // Main selectable row button
                const float MainX = Indent + (Row.ChildCount > 0 ? 14.0f : 0.0f);
                ImGui::SetCursorScreenPos(ImVec2(MainX, RStart.y));
                ImGui::InvisibleButton("##RowSelect", ImVec2(std::max(32.0f, EyeX - MainX - 2.0f), RH));
                const bool RowHov = ImGui::IsItemHovered();
                if (!EyeClicked && !ChevClicked && ImGui::IsItemClicked())
                {
                    Select(Row.Token);
                }

                if (IsSel)
                {
                    const ImU32 SelFill = IM_COL32(
                        (AccCol >> IM_COL32_R_SHIFT) & 0xFF,
                        (AccCol >> IM_COL32_G_SHIFT) & 0xFF,
                        (AccCol >> IM_COL32_B_SHIFT) & 0xFF, 38);
                    KitPillSurface(TInk, ImVec2(PL, RStart.y + 1.0f), ImVec2(InnerRight, RStart.y + RH - 1.0f),
                                   SelFill, AccCol, 7.0f);
                    TInk->AddRectFilled(ImVec2(PL, RStart.y + 5.0f), ImVec2(PL + 3.0f, RStart.y + RH - 5.0f), AccCol, 1.5f);
                }
                else if (RowHov)
                {
                    KitPillSurface(TInk, ImVec2(PL, RStart.y + 1.0f), ImVec2(InnerRight, RStart.y + RH - 1.0f),
                                   HoverBg, 0, 7.0f);
                }

                if (Row.ChildCount > 0)
                {
                    KitGlyphChevron(TInk, ImVec2(Indent + 7.0f, RStart.y + RH * 0.5f), 3.5f, MuteCol, !Row.Collapsed);
                }

                const float DotX = Indent + (Row.ChildCount > 0 ? 20.0f : 10.0f);
                TInk->AddCircleFilled(ImVec2(DotX, RStart.y + RH * 0.5f), 3.5f, Row.Enabled ? AccCol : MuteCol);

                const ImU32 LabelCol = Row.Enabled ? TextCol : MuteCol;
                KitDrawText(TInk, IsSel ? Faces.SemiBold : Faces.Regular, 12.0f,
                            ImVec2(DotX + 10.0f, RStart.y + 6.5f), LabelCol, Row.Name.c_str());

                if (!Row.Meta.empty())
                {
                    const float MW = KitTextWidth(Faces.Regular, 10.0f, Row.Meta.c_str());
                    if (EyeX - MW - 8.0f > DotX + 88.0f)
                    {
                        KitDrawText(TInk, Faces.Regular, 10.0f, ImVec2(EyeX - MW - 6.0f, RStart.y + 8.0f),
                                    MuteCol, Row.Meta.c_str());
                    }
                }

                KitGlyphEye(TInk, ImVec2(EyeX + 11.0f, RStart.y + RH * 0.5f), 5.0f,
                            Row.Enabled ? MuteCol : IM_COL32(120, 130, 145, 95), Row.Enabled);

                ImGui::SetCursorScreenPos(ImVec2(PL, RStart.y + RH));
                ImGui::Dummy(ImVec2(1.0f, 0.0f));
                ImGui::PopID();
            }
            ImGui::Dummy(ImVec2(1.0f, 4.0f));
        }
    }
    ImGui::EndChild();
    ImGui::PopStyleColor();

    // 5. Outliner Footer Summary
    Ink->AddLine(ImVec2(WinPos.x, TreeBottom), ImVec2(WinPos.x + WinSize.x, TreeBottom), EdgeCol, 1.0f);
    char FootLeft[64] = {};
    std::snprintf(FootLeft, sizeof(FootLeft), "%zu visible \xC2\xB7 %u registered", Visible.size(), Total);
    KitDrawText(Ink, Faces.Regular, 10.5f, ImVec2(PL + 2.0f, TreeBottom + 5.0f), MuteCol, FootLeft);
    if (Selected.IsValid())
    {
        char ActiveTok[32] = {};
        std::snprintf(ActiveTok, sizeof(ActiveTok), "Active #%llu", static_cast<unsigned long long>(Selected.Value));
        const float AW = KitTextWidth(Faces.Regular, 10.5f, ActiveTok);
        KitDrawText(Ink, Faces.Regular, 10.5f, ImVec2(PR - AW - 2.0f, TreeBottom + 5.0f), MuteCol, ActiveTok);
    }
}

} // namespace Frontier

#else

namespace Frontier
{
void SceneDirectoryPanel::ConstructInterface() {}
} // namespace Frontier

#endif
