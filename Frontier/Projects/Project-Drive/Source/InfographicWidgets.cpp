/*====================================================================================================================================
                                                     INFOGRAPHICWIDGETS.CPP
====================================================================================================================================*/
// 🧩 Theme-adaptive ImDrawList statistical infographic widgets modelled on SourceImages/General UI & VehicleHMI.

#include "InfographicWidgets.h"

#if defined(FRONTIER_WITH_INTERFACE_SDK)

#include "Engine/Interface/StackRailControls.h"

#include <imgui.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>

namespace Frontier::Drive::Infographics
{

namespace
{

float InspectorCardWidth() noexcept
{
    // Respect both docked InspectorScroll (right margin 16px) and Dedicated Popup Editor panels.
    const float Avail = ImGui::GetContentRegionAvail().x;
    return std::max(140.0f, ImGui::GetStyle().WindowPadding.x > 12.0f ? (Avail - 16.0f) : (Avail - 4.0f));
}

ImU32 HexAlpha(uint32_t Hex, uint8_t Alpha) noexcept
{
    return IM_COL32((Hex >> 16) & 0xFFu, (Hex >> 8) & 0xFFu, Hex & 0xFFu, Alpha);
}

bool IsDarkSurface(const ImGuiStyle &Style) noexcept
{
    const ImVec4 Bg = Style.Colors[ImGuiCol_WindowBg];
    return (0.2126f * Bg.x + 0.7152f * Bg.y + 0.0722f * Bg.z) < 0.35f;
}

void ResolveOledCardPalette(const ImGuiStyle &Style, ImU32 &Bg, ImU32 &Edge, ImU32 &Text, ImU32 &Mute) noexcept
{
    if (IsDarkSurface(Style))
    {
        Bg   = KitInkHex(0x1c1c1c);
        Edge = KitInkHex(0x2e2e2e);
        Text = KitInkHex(0xdfdfdf);
        Mute = KitInkHex(0x7d7d7d);
    }
    else
    {
        Bg   = ImGui::ColorConvertFloat4ToU32(Style.Colors[ImGuiCol_FrameBg]);
        Edge = ImGui::ColorConvertFloat4ToU32(Style.Colors[ImGuiCol_Border]);
        Text = ImGui::ColorConvertFloat4ToU32(Style.Colors[ImGuiCol_Text]);
        Mute = ImGui::ColorConvertFloat4ToU32(Style.Colors[ImGuiCol_TextDisabled]);
    }
}

} // namespace

void DrawKpiRow(const KpiBadgeItem *Items, size_t Count)
{
    if (Items == nullptr || Count == 0)
    {
        return;
    }
    const KitFaces    Faces = ResolveKitFaces();
    const ImGuiStyle &Style = ImGui::GetStyle();
    ImDrawList       *Ink   = ImGui::GetWindowDrawList();

    const float TotalW = InspectorCardWidth();
    const float Gap    = 6.0f;
    const float CardW  = (TotalW - Gap * static_cast<float>(Count - 1)) / static_cast<float>(Count);
    const float CardH  = 58.0f;
    const ImVec2 Start = ImGui::GetCursorScreenPos();

    ImU32 BgCol = 0, EdgeCol = 0, TextCol = 0, MuteCol = 0;
    ResolveOledCardPalette(Style, BgCol, EdgeCol, TextCol, MuteCol);

    for (size_t I = 0; I < Count; ++I)
    {
        const float X      = Start.x + static_cast<float>(I) * (CardW + Gap);
        const ImU32 Accent = KitInkHex(static_cast<int>(Items[I].AccentHex));
        KitPillSurface(Ink, ImVec2(X, Start.y), ImVec2(X + CardW, Start.y + CardH), BgCol, EdgeCol, 10.0f);
        Ink->AddRectFilled(ImVec2(X + 10.0f, Start.y + 9.0f), ImVec2(X + 16.0f, Start.y + 15.0f), Accent, 3.0f);
        KitDrawTracked(Ink, Faces.SemiBold, 9.0f, ImVec2(X + 21.0f, Start.y + 7.5f), MuteCol, Items[I].Label, 0.7f);
        KitDrawText(Ink, Faces.SemiBold, 15.5f, ImVec2(X + 10.0f, Start.y + 22.0f), TextCol, Items[I].Value);
        if (Items[I].SubLabel != nullptr && Items[I].SubLabel[0] != '\0')
        {
            KitDrawText(Ink, Faces.Regular, 9.5f, ImVec2(X + 10.0f, Start.y + 41.0f), MuteCol, Items[I].SubLabel);
        }
    }
    ImGui::Dummy(ImVec2(TotalW, CardH + 4.0f));
}

void DrawSegmentedDistributionCard(const char *Title, const char *RightSummary,
                                   const SegmentSlice *Slices, size_t SliceCount)
{
    if (Slices == nullptr || SliceCount == 0)
    {
        return;
    }
    const KitFaces    Faces  = ResolveKitFaces();
    const ImGuiStyle &Style  = ImGui::GetStyle();
    ImDrawList       *Ink    = ImGui::GetWindowDrawList();
    const float       TotalW = InspectorCardWidth();
    const float       CardH  = 78.0f;
    const ImVec2      P      = ImGui::GetCursorScreenPos();

    ImU32 BgCol = 0, EdgeCol = 0, TextCol = 0, MuteCol = 0;
    ResolveOledCardPalette(Style, BgCol, EdgeCol, TextCol, MuteCol);

    KitPillSurface(Ink, P, ImVec2(P.x + TotalW, P.y + CardH), BgCol, EdgeCol, 10.0f);
    KitDrawTracked(Ink, Faces.SemiBold, 9.5f, ImVec2(P.x + 12.0f, P.y + 8.5f), MuteCol, Title, 0.85f);
    if (RightSummary != nullptr && RightSummary[0] != '\0')
    {
        const float RW = KitTextWidth(Faces.SemiBold, 10.5f, RightSummary);
        KitDrawText(Ink, Faces.SemiBold, 10.5f, ImVec2(P.x + TotalW - RW - 12.0f, P.y + 8.0f), TextCol, RightSummary);
    }

    const float BarX  = P.x + 12.0f;
    const float BarY  = P.y + 28.0f;
    const float BarW  = TotalW - 24.0f;
    const float BarH  = 14.0f;
    float       Sum   = 0.0f;
    for (size_t I = 0; I < SliceCount; ++I)
    {
        Sum += std::max(0.0f, Slices[I].Fraction);
    }
    Sum = std::max(Sum, 1e-5f);

    Ink->AddRectFilled(ImVec2(BarX, BarY), ImVec2(BarX + BarW, BarY + BarH), IM_COL32(14, 14, 14, 210), 6.0f);
    float CursorX = BarX;
    for (size_t I = 0; I < SliceCount; ++I)
    {
        const float W = BarW * (std::max(0.0f, Slices[I].Fraction) / Sum);
        if (W <= 1.0f)
        {
            continue;
        }
        Ink->AddRectFilled(ImVec2(CursorX, BarY), ImVec2(CursorX + std::max(2.0f, W - 1.5f), BarY + BarH),
                           KitInkHex(static_cast<int>(Slices[I].ColourHex)), 4.0f);
        CursorX += W;
    }

    // Legend pills below bar
    float LegX = BarX;
    const float LegY = P.y + 51.0f;
    for (size_t I = 0; I < SliceCount; ++I)
    {
        char Cap[64] = {};
        std::snprintf(Cap, sizeof(Cap), "%s %.0f%%", Slices[I].Label, (Slices[I].Fraction / Sum) * 100.0f);
        const float CW = KitTextWidth(Faces.Regular, 9.8f, Cap) + 14.0f;
        if (LegX + CW > P.x + TotalW - 8.0f)
        {
            break;
        }
        Ink->AddCircleFilled(ImVec2(LegX + 4.0f, LegY + 7.0f), 3.2f, KitInkHex(static_cast<int>(Slices[I].ColourHex)));
        KitDrawText(Ink, Faces.Regular, 9.8f, ImVec2(LegX + 10.0f, LegY + 1.0f), MuteCol, Cap);
        LegX += CW + 6.0f;
    }
    ImGui::Dummy(ImVec2(TotalW, CardH + 4.0f));
}

void DrawSparklineCard(const char *Title, const char *LiveReadout,
                       const float *Samples, size_t SampleCount,
                       float MinValue, float MaxValue, uint32_t AccentHex)
{
    if (Samples == nullptr || SampleCount < 2)
    {
        return;
    }
    const KitFaces    Faces  = ResolveKitFaces();
    const ImGuiStyle &Style  = ImGui::GetStyle();
    ImDrawList       *Ink    = ImGui::GetWindowDrawList();
    const float       TotalW = InspectorCardWidth();
    const float       CardH  = 86.0f;
    const ImVec2      P      = ImGui::GetCursorScreenPos();

    ImU32 BgCol = 0, EdgeCol = 0, TextCol = 0, MuteCol = 0;
    ResolveOledCardPalette(Style, BgCol, EdgeCol, TextCol, MuteCol);
    const ImU32 Accent  = KitInkHex(static_cast<int>(AccentHex));

    ImGui::InvisibleButton(Title, ImVec2(TotalW, CardH));
    const bool Hovered = ImGui::IsItemHovered();

    KitPillSurface(Ink, P, ImVec2(P.x + TotalW, P.y + CardH), BgCol, EdgeCol, 10.0f);
    KitDrawTracked(Ink, Faces.SemiBold, 9.5f, ImVec2(P.x + 12.0f, P.y + 8.0f), MuteCol, Title, 0.85f);

    const float GX   = P.x + 12.0f;
    const float GY   = P.y + 28.0f;
    const float GW   = TotalW - 24.0f;
    const float GH   = 46.0f;
    const float Span = std::max(1e-4f, MaxValue - MinValue);

    // Subtle horizontal gridlines
    for (int G = 0; G <= 2; ++G)
    {
        const float LY = GY + GH * (static_cast<float>(G) * 0.5f);
        Ink->AddLine(ImVec2(GX, LY), ImVec2(GX + GW, LY), IM_COL32(58, 58, 58, 120), 1.0f);
    }

    ImVec2 PrevPt{};
    for (size_t I = 0; I < SampleCount; ++I)
    {
        const float T  = static_cast<float>(I) / static_cast<float>(SampleCount - 1);
        const float N  = std::clamp((Samples[I] - MinValue) / Span, 0.0f, 1.0f);
        const ImVec2 Pt(GX + T * GW, GY + GH * (1.0f - N));
        if (I > 0)
        {
            const ImVec2 Quad[4] = {PrevPt, Pt, ImVec2(Pt.x, GY + GH), ImVec2(PrevPt.x, GY + GH)};
            Ink->AddConvexPolyFilled(Quad, 4, HexAlpha(AccentHex, 38));
            Ink->AddLine(PrevPt, Pt, Accent, 1.8f);
        }
        PrevPt = Pt;
    }

    char ScrubBuf[64] = {};
    const char *HeaderVal = LiveReadout;
    if (Hovered)
    {
        const float Rel = std::clamp((ImGui::GetIO().MousePos.x - GX) / GW, 0.0f, 1.0f);
        const size_t Idx = std::min(SampleCount - 1, static_cast<size_t>(std::round(Rel * static_cast<float>(SampleCount - 1))));
        const float  SX  = GX + (static_cast<float>(Idx) / static_cast<float>(SampleCount - 1)) * GW;
        const float  SN  = std::clamp((Samples[Idx] - MinValue) / Span, 0.0f, 1.0f);
        const float  SY  = GY + GH * (1.0f - SN);
        Ink->AddLine(ImVec2(SX, GY), ImVec2(SX, GY + GH), HexAlpha(AccentHex, 150), 1.0f);
        Ink->AddCircleFilled(ImVec2(SX, SY), 4.0f, Accent);
        std::snprintf(ScrubBuf, sizeof(ScrubBuf), "Sample #%zu: %.2f", Idx, Samples[Idx]);
        HeaderVal = ScrubBuf;
    }
    if (HeaderVal != nullptr && HeaderVal[0] != '\0')
    {
        const float RW = KitTextWidth(Faces.SemiBold, 11.0f, HeaderVal);
        KitDrawText(Ink, Faces.SemiBold, 11.0f, ImVec2(P.x + TotalW - RW - 12.0f, P.y + 7.5f), TextCol, HeaderVal);
    }
    ImGui::Dummy(ImVec2(TotalW, 4.0f));
}

void DrawTwinRadialGauges(const char *LeftTitle, float LeftVal, float LeftMin, float LeftMax, const char *LeftUnit, uint32_t LeftHex,
                          const char *RightTitle, float RightVal, float RightMin, float RightMax, const char *RightUnit, uint32_t RightHex)
{
    const KitFaces    Faces  = ResolveKitFaces();
    const ImGuiStyle &Style  = ImGui::GetStyle();
    ImDrawList       *Ink    = ImGui::GetWindowDrawList();
    const float       TotalW = InspectorCardWidth();
    const float       CardH  = 104.0f;
    const ImVec2      P      = ImGui::GetCursorScreenPos();

    ImU32 BgCol = 0, EdgeCol = 0, TextCol = 0, MuteCol = 0;
    ResolveOledCardPalette(Style, BgCol, EdgeCol, TextCol, MuteCol);

    KitPillSurface(Ink, P, ImVec2(P.x + TotalW, P.y + CardH), BgCol, EdgeCol, 10.0f);

    auto DrawOneArc = [&](float CenterX, const char *Cap, float Val, float Mn, float Mx, const char *Unit, uint32_t Hex) {
        const ImVec2 C(CenterX, P.y + 56.0f);
        const float  R    = 31.0f;
        const float  A0   = 0.75f * 3.14159265f;
        const float  A1   = 2.25f * 3.14159265f;
        const float  Norm = std::clamp((Val - Mn) / std::max(1e-4f, Mx - Mn), 0.0f, 1.0f);

        Ink->PathArcTo(C, R, A0, A1, 28);
        Ink->PathStroke(IM_COL32(62, 62, 62, 180), 0, 5.5f);
        if (Norm > 0.005f)
        {
            Ink->PathArcTo(C, R, A0, A0 + (A1 - A0) * Norm, 28);
            Ink->PathStroke(KitInkHex(static_cast<int>(Hex)), 0, 5.5f);
        }

        const float CW = KitTextWidth(Faces.SemiBold, 9.0f, Cap);
        KitDrawTracked(Ink, Faces.SemiBold, 9.0f, ImVec2(CenterX - CW * 0.5f, P.y + 7.5f), MuteCol, Cap, 0.7f);

        char VBuf[32] = {};
        if (std::abs(Mx) >= 100.0f)
        {
            std::snprintf(VBuf, sizeof(VBuf), "%.0f", Val);
        }
        else
        {
            std::snprintf(VBuf, sizeof(VBuf), "%.1f", Val);
        }
        const float VW = KitTextWidth(Faces.SemiBold, 14.5f, VBuf);
        KitDrawText(Ink, Faces.SemiBold, 14.5f, ImVec2(CenterX - VW * 0.5f, C.y - 9.0f), TextCol, VBuf);
        const float UW = KitTextWidth(Faces.Regular, 9.5f, Unit);
        KitDrawText(Ink, Faces.Regular, 9.5f, ImVec2(CenterX - UW * 0.5f, C.y + 8.0f), MuteCol, Unit);
    };

    DrawOneArc(P.x + TotalW * 0.26f, LeftTitle, LeftVal, LeftMin, LeftMax, LeftUnit, LeftHex);
    Ink->AddLine(ImVec2(P.x + TotalW * 0.5f, P.y + 14.0f), ImVec2(P.x + TotalW * 0.5f, P.y + CardH - 14.0f), EdgeCol, 1.0f);
    DrawOneArc(P.x + TotalW * 0.74f, RightTitle, RightVal, RightMin, RightMax, RightUnit, RightHex);

    ImGui::Dummy(ImVec2(TotalW, CardH + 4.0f));
}

void DrawPolarVectorCompass(const char *Title, float AzimuthDeg, float SpeedMps, float GustMps,
                            const char *RightBadge, uint32_t AccentHex)
{
    const KitFaces    Faces  = ResolveKitFaces();
    const ImGuiStyle &Style  = ImGui::GetStyle();
    ImDrawList       *Ink    = ImGui::GetWindowDrawList();
    const float       TotalW = InspectorCardWidth();
    const float       CardH  = 96.0f;
    const ImVec2      P      = ImGui::GetCursorScreenPos();

    ImU32 BgCol = 0, EdgeCol = 0, TextCol = 0, MuteCol = 0;
    ResolveOledCardPalette(Style, BgCol, EdgeCol, TextCol, MuteCol);
    const ImU32 Accent  = KitInkHex(static_cast<int>(AccentHex));

    KitPillSurface(Ink, P, ImVec2(P.x + TotalW, P.y + CardH), BgCol, EdgeCol, 10.0f);
    KitDrawTracked(Ink, Faces.SemiBold, 9.5f, ImVec2(P.x + 12.0f, P.y + 8.0f), MuteCol, Title, 0.85f);
    if (RightBadge != nullptr)
    {
        const float RW = KitTextWidth(Faces.SemiBold, 10.5f, RightBadge);
        KitDrawText(Ink, Faces.SemiBold, 10.5f, ImVec2(P.x + TotalW - RW - 12.0f, P.y + 8.0f), TextCol, RightBadge);
    }

    const ImVec2 C(P.x + 54.0f, P.y + 57.0f);
    const float  R = 29.0f;
    Ink->AddCircle(C, R, EdgeCol, 32, 1.2f);
    Ink->AddCircle(C, R * 0.55f, IM_COL32(62, 62, 62, 130), 24, 1.0f);
    Ink->AddLine(ImVec2(C.x - R, C.y), ImVec2(C.x + R, C.y), IM_COL32(62, 62, 62, 130), 1.0f);
    Ink->AddLine(ImVec2(C.x, C.y - R), ImVec2(C.x, C.y + R), IM_COL32(62, 62, 62, 130), 1.0f);

    const float Rad  = (AzimuthDeg - 90.0f) * (3.14159265f / 180.0f);
    const float Len  = R * std::clamp(SpeedMps / 28.0f, 0.18f, 0.96f);
    const ImVec2 Tip(C.x + std::cos(Rad) * Len, C.y + std::sin(Rad) * Len);
    Ink->AddLine(C, Tip, Accent, 2.4f);
    Ink->AddCircleFilled(Tip, 3.8f, Accent);

    char Line1[64] = {};
    char Line2[64] = {};
    char Line3[64] = {};
    std::snprintf(Line1, sizeof(Line1), "Heading: %.0f deg", AzimuthDeg);
    std::snprintf(Line2, sizeof(Line2), "Mean Speed: %.1f m/s", SpeedMps);
    std::snprintf(Line3, sizeof(Line3), "Peak Gusts: %.1f m/s", SpeedMps + GustMps);
    KitDrawText(Ink, Faces.SemiBold, 11.5f, ImVec2(P.x + 102.0f, P.y + 31.0f), TextCol, Line1);
    KitDrawText(Ink, Faces.Regular, 11.0f, ImVec2(P.x + 102.0f, P.y + 49.0f), MuteCol, Line2);
    KitDrawText(Ink, Faces.Regular, 11.0f, ImVec2(P.x + 102.0f, P.y + 66.0f), Accent, Line3);

    ImGui::Dummy(ImVec2(TotalW, CardH + 4.0f));
}

void DrawBlackbodyRampCard(const char *Title, float PeakKelvin, float ActiveVoxelsPct)
{
    const KitFaces    Faces  = ResolveKitFaces();
    const ImGuiStyle &Style  = ImGui::GetStyle();
    ImDrawList       *Ink    = ImGui::GetWindowDrawList();
    const float       TotalW = InspectorCardWidth();
    const float       CardH  = 74.0f;
    const ImVec2      P      = ImGui::GetCursorScreenPos();

    ImU32 BgCol = 0, EdgeCol = 0, TextCol = 0, MuteCol = 0;
    ResolveOledCardPalette(Style, BgCol, EdgeCol, TextCol, MuteCol);

    KitPillSurface(Ink, P, ImVec2(P.x + TotalW, P.y + CardH), BgCol, EdgeCol, 10.0f);
    KitDrawTracked(Ink, Faces.SemiBold, 9.5f, ImVec2(P.x + 12.0f, P.y + 8.0f), MuteCol, Title, 0.85f);

    char RightCap[64] = {};
    std::snprintf(RightCap, sizeof(RightCap), "Peak %.0f K \xC2\xB7 %.1f%% active", PeakKelvin, ActiveVoxelsPct);
    const float RW = KitTextWidth(Faces.SemiBold, 10.5f, RightCap);
    KitDrawText(Ink, Faces.SemiBold, 10.5f, ImVec2(P.x + TotalW - RW - 12.0f, P.y + 8.0f), TextCol, RightCap);

    const std::array<uint32_t, 6> Stops = {0x141414u, 0x7f1d1du, 0xdc2626u, 0xf97316u, 0xfacc15u, 0xfef9c3u};
    const float BX = P.x + 12.0f;
    const float BY = P.y + 29.0f;
    const float BW = TotalW - 24.0f;
    const float BH = 15.0f;
    const float SegW = BW / static_cast<float>(Stops.size() - 1);
    for (size_t I = 0; I + 1 < Stops.size(); ++I)
    {
        const ImU32 C0 = KitInkHex(static_cast<int>(Stops[I]));
        const ImU32 C1 = KitInkHex(static_cast<int>(Stops[I + 1]));
        Ink->AddRectFilledMultiColor(ImVec2(BX + SegW * static_cast<float>(I), BY),
                                     ImVec2(BX + SegW * static_cast<float>(I + 1), BY + BH), C0, C1, C1, C0);
    }
    const float Norm = std::clamp((PeakKelvin - 293.0f) / (2100.0f - 293.0f), 0.0f, 1.0f);
    const float MX   = BX + BW * Norm;
    Ink->AddLine(ImVec2(MX, BY - 3.0f), ImVec2(MX, BY + BH + 3.0f), KitInkHex(0xffffff), 2.2f);
    KitDrawText(Ink, Faces.Regular, 9.5f, ImVec2(BX, BY + BH + 5.0f), MuteCol, "293 K Soot");
    KitDrawText(Ink, Faces.Regular, 9.5f, ImVec2(BX + BW * 0.44f, BY + BH + 5.0f), MuteCol, "1150 K Core");
    const float EndW = KitTextWidth(Faces.Regular, 9.5f, "2100 K White");
    KitDrawText(Ink, Faces.Regular, 9.5f, ImVec2(BX + BW - EndW, BY + BH + 5.0f), MuteCol, "2100 K White");

    ImGui::Dummy(ImVec2(TotalW, CardH + 4.0f));
}

void DrawProfileCrossSectionCard(const char *Title, const char *RightBadge,
                                 const float *ProfileHeights, size_t Count,
                                 float MaxHeightScale, uint32_t FillHex)
{
    if (ProfileHeights == nullptr || Count < 2)
    {
        return;
    }
    const KitFaces    Faces  = ResolveKitFaces();
    const ImGuiStyle &Style  = ImGui::GetStyle();
    ImDrawList       *Ink    = ImGui::GetWindowDrawList();
    const float       TotalW = InspectorCardWidth();
    const float       CardH  = 82.0f;
    const ImVec2      P      = ImGui::GetCursorScreenPos();

    ImU32 BgCol = 0, EdgeCol = 0, TextCol = 0, MuteCol = 0;
    ResolveOledCardPalette(Style, BgCol, EdgeCol, TextCol, MuteCol);
    const ImU32 Accent  = KitInkHex(static_cast<int>(FillHex));

    KitPillSurface(Ink, P, ImVec2(P.x + TotalW, P.y + CardH), BgCol, EdgeCol, 10.0f);
    KitDrawTracked(Ink, Faces.SemiBold, 9.5f, ImVec2(P.x + 12.0f, P.y + 8.0f), MuteCol, Title, 0.85f);
    if (RightBadge != nullptr)
    {
        const float RW = KitTextWidth(Faces.SemiBold, 10.5f, RightBadge);
        KitDrawText(Ink, Faces.SemiBold, 10.5f, ImVec2(P.x + TotalW - RW - 12.0f, P.y + 8.0f), TextCol, RightBadge);
    }

    const float GX   = P.x + 12.0f;
    const float GY   = P.y + 28.0f;
    const float GW   = TotalW - 24.0f;
    const float GH   = 42.0f;
    const float CapH = std::max(1e-4f, MaxHeightScale);

    Ink->AddLine(ImVec2(GX, GY + GH), ImVec2(GX + GW, GY + GH), EdgeCol, 1.2f);
    ImVec2 Prev{};
    for (size_t I = 0; I < Count; ++I)
    {
        const float T  = static_cast<float>(I) / static_cast<float>(Count - 1);
        const float N  = std::clamp(ProfileHeights[I] / CapH, 0.0f, 1.0f);
        const ImVec2 Cur(GX + T * GW, GY + GH * (1.0f - N));
        if (I > 0)
        {
            const ImVec2 Poly[4] = {Prev, Cur, ImVec2(Cur.x, GY + GH), ImVec2(Prev.x, GY + GH)};
            Ink->AddConvexPolyFilled(Poly, 4, HexAlpha(FillHex, 68));
            Ink->AddLine(Prev, Cur, Accent, 2.0f);
        }
        Prev = Cur;
    }
    ImGui::Dummy(ImVec2(TotalW, CardH + 4.0f));
}

void DrawQuadWheelMatrixCard(const float TempCelsius[4], const float LoadKn[4], const float SlipRatio[4])
{
    const KitFaces    Faces  = ResolveKitFaces();
    const ImGuiStyle &Style  = ImGui::GetStyle();
    ImDrawList       *Ink    = ImGui::GetWindowDrawList();
    const float       TotalW = InspectorCardWidth();
    const float       CardH  = 112.0f;
    const ImVec2      P      = ImGui::GetCursorScreenPos();

    ImU32 BgCol = 0, EdgeCol = 0, TextCol = 0, MuteCol = 0;
    ResolveOledCardPalette(Style, BgCol, EdgeCol, TextCol, MuteCol);

    KitPillSurface(Ink, P, ImVec2(P.x + TotalW, P.y + CardH), BgCol, EdgeCol, 10.0f);
    KitDrawTracked(Ink, Faces.SemiBold, 9.5f, ImVec2(P.x + 12.0f, P.y + 8.0f), MuteCol,
                   "GRIT .TYRX 4-CORNER THERMAL & CONTACT PATCH", 0.85f);

    static const char *const Names[4] = {"FL", "FR", "RL", "RR"};
    const float CellW = (TotalW - 30.0f) * 0.5f;
    const float CellH = 36.0f;

    for (int W = 0; W < 4; ++W)
    {
        const int   Col = W % 2;
        const int   Row = W / 2;
        const float CX  = P.x + 12.0f + static_cast<float>(Col) * (CellW + 6.0f);
        const float CY  = P.y + 28.0f + static_cast<float>(Row) * (CellH + 5.0f);

        const float TempN = std::clamp((TempCelsius[W] - 25.0f) / 85.0f, 0.0f, 1.0f);
        const uint32_t THex = TempN < 0.45f ? 0x38bdf8u : (TempN < 0.78f ? 0x2fe6a7u : 0xf97316u);
        KitPillSurface(Ink, ImVec2(CX, CY), ImVec2(CX + CellW, CY + CellH), HexAlpha(THex, 28), EdgeCol, 7.0f);

        KitDrawText(Ink, Faces.SemiBold, 11.0f, ImVec2(CX + 8.0f, CY + 4.0f), KitInkHex(static_cast<int>(THex)), Names[W]);
        char TopBuf[32] = {};
        std::snprintf(TopBuf, sizeof(TopBuf), "%.0f C", TempCelsius[W]);
        const float TW = KitTextWidth(Faces.SemiBold, 11.0f, TopBuf);
        KitDrawText(Ink, Faces.SemiBold, 11.0f, ImVec2(CX + CellW - TW - 8.0f, CY + 4.0f), TextCol, TopBuf);

        char BotBuf[48] = {};
        std::snprintf(BotBuf, sizeof(BotBuf), "%.2f kN \xC2\xB7 slip %.2f", LoadKn[W], SlipRatio[W]);
        KitDrawText(Ink, Faces.Regular, 9.5f, ImVec2(CX + 8.0f, CY + 19.0f), MuteCol, BotBuf);
    }
    ImGui::Dummy(ImVec2(TotalW, CardH + 4.0f));
}

} // namespace Frontier::Drive::Infographics

#else

namespace Frontier::Drive::Infographics
{
void DrawKpiRow(const KpiBadgeItem *, size_t) {}
void DrawSegmentedDistributionCard(const char *, const char *, const SegmentSlice *, size_t) {}
void DrawSparklineCard(const char *, const char *, const float *, size_t, float, float, uint32_t) {}
void DrawTwinRadialGauges(const char *, float, float, float, const char *, uint32_t,
                          const char *, float, float, float, const char *, uint32_t) {}
void DrawPolarVectorCompass(const char *, float, float, float, const char *, uint32_t) {}
void DrawBlackbodyRampCard(const char *, float, float) {}
void DrawProfileCrossSectionCard(const char *, const char *, const float *, size_t, float, uint32_t) {}
void DrawQuadWheelMatrixCard(const float[4], const float[4], const float[4]) {}
} // namespace Frontier::Drive::Infographics

#endif
