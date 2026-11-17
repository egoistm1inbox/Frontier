/*==========================================================================================================================================
                                                      FORCEFIELDWORKSPACEINSPECTOR.CPP
==========================================================================================================================================*/
// 🧩 The Force Field & Wind workspace inspector: editable field, wind and source state, with live actions and native Levelspace export.

#include "Engine/Interface/Workspaces/ForceFieldWorkspace.h"
#include "Engine/Interface/Workspaces/ForceFieldWorkspaceRuntime.h"

#include "Engine/Interface/Controls/ActionRow.h"
#include "Engine/Interface/Controls/ChipToggles.h"
#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/ControlTheme.h"
#include "Engine/Interface/Controls/GlyphRun.h"
#include "Engine/Interface/Controls/GlyphSymbol.h"
#include "Engine/Interface/Controls/HeroCard.h"
#include "Engine/Interface/Controls/PillTabs.h"
#include "Engine/Interface/Controls/PolarDial.h"
#include "Engine/Interface/Controls/SegmentedRow.h"
#include "Engine/Interface/Controls/SliderPill.h"
#include "Engine/Interface/Controls/StatGrid.h"
#include "Engine/Interface/Controls/TextRow.h"
#include "Engine/Interface/Controls/Toast.h"
#include "Engine/Interface/Controls/SwitchPill.h"
#include "Engine/Interface/Controls/TimeSeries.h"
#include "Engine/Interface/Controls/ToggleTile.h"
#include "Engine/Interface/Controls/VectorRow.h"
#include "Engine/Interface/InspectorControls.h"

#include <imgui_internal.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

namespace Frontier
{

namespace
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    BIND WORDING
//------------------------------------------------------------------------------------------------------------------------

void LogSwitch(ForceFieldWorkspaceState& State, const char* Channel, const char* Owner, const char* Label, bool Value)
{
    LogForceFieldWorkspaceValue(State, Channel, Owner, Label, Value ? "on" : "off");
}

void LogFigure(ForceFieldWorkspaceState& State, const char* Channel, const char* Owner, const char* Label, double Value, int Digits,
               const char* Unit)
{
    char Trimmed[48]{};
    FormatForceFieldTrimmed(Value, Digits, Trimmed, sizeof(Trimmed));
    char Shown[80]{};
    if (Unit != nullptr && Unit[0] != '\0') std::snprintf(Shown, sizeof(Shown), "%s %s", Trimmed, Unit);
    else std::snprintf(Shown, sizeof(Shown), "%s", Trimmed);
    LogForceFieldWorkspaceValue(State, Channel, Owner, Label, Shown);
}

void LogSpan(ForceFieldWorkspaceState& State, const char* Channel, const char* Owner, const char* Label, double Metres)
{
    char Shown[48]{};
    FormatForceFieldSpan(Metres, Shown, sizeof(Shown));
    LogForceFieldWorkspaceValue(State, Channel, Owner, Label, Shown);
}

void LogChannels(ForceFieldWorkspaceState& State, const char* Channel, const char* Owner, const char* Label, const bool Flags[7])
{
    std::string Shown = "[";
    bool        First = true;
    for (int Index = 0; Index < 7; ++Index)
    {
        if (!Flags[Index]) continue;
        if (!First) Shown += ", ";
        Shown += QueryForceFieldChannel(Index);
        First = false;
    }
    Shown += "]";
    LogForceFieldWorkspaceValue(State, Channel, Owner, Label, Shown.c_str());
}

[[nodiscard]] const char* ContribLabel(int Contribution) noexcept
{
    if (Contribution == ForceFieldContributionAccelerate) return "Accelerate";
    if (Contribution == ForceFieldContributionDamp) return "Damp";
    return "Flow";
}

[[nodiscard]] bool ActsEmpty(const ForceFieldWorkspaceSource& Source) noexcept
{
    for (int Index = 0; Index < 7; ++Index)
    {
        if (Source.Acts[Index]) return false;
    }
    return true;
}

void ToUpperCopy(const char* Text, char* Out, size_t OutSize)
{
    if (Out == nullptr || OutSize == 0) return;
    size_t Index = 0;
    if (Text != nullptr)
    {
        for (; Text[Index] != '\0' && Index + 1 < OutSize; ++Index)
            Out[Index] = static_cast<char>(std::toupper(static_cast<unsigned char>(Text[Index])));
    }
    Out[Index] = '\0';
}

bool PressRect(const char* Id, ImVec2 Min, ImVec2 Max)
{
    ImGui::SetCursorScreenPos(Min);
    return ImGui::InvisibleButton(Id, ImVec2(Max.x - Min.x, Max.y - Min.y), ImGuiButtonFlags_EnableNav);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    SECTION CARD
//------------------------------------------------------------------------------------------------------------------------

struct InspectorSectionScope
{
    bool  Open       = true;
    float CardLeft   = 0.0f;
    float CardWidth  = 0.0f;
    float CardTop    = 0.0f;
    float HeadBottom = 0.0f;
};

std::vector<InspectorSectionScope>& QueryInspectorSections()
{
    static std::vector<InspectorSectionScope> Scopes{};
    return Scopes;
}

// 📝 .section-card: 180° gradient, radius 22, 46 px head (14 px icon, 15 px title, 10 px status), 18 px body inset.
bool BeginInspectorSection(ControlColumn& Column, ForceFieldWorkspaceState& State, const char* Id, const char* Title, const char* Glyph,
                           const char* Status, bool& InOutOpen)
{
    const EditorTypefaces& Faces   = Column.QueryFaces();
    ImDrawList* const      DrawList = Column.QueryDrawList();
    const float            S        = Column.QueryScale();
    const float            Width    = Column.QueryWidth();
    constexpr float        HeadTall = 46.0f;
    constexpr float        PadSide  = 18.0f;
    constexpr float        Radius   = 22.0f;
    const ImVec2           Top      = Column.Space(HeadTall, 0.0f, 0.0f);

    ImGui::PushID(Id);
    const bool Toggled = PressRect("##SectionHead", Top, ImVec2(Top.x + Width, Top.y + HeadTall * S));
    ImGui::PopID();
    if (Toggled) InOutOpen = !InOutOpen;
    char RectTag[64]{};
    std::snprintf(RectTag, sizeof(RectTag), "Inspector/Section/%s", Id);
    RecordForceFieldWorkspaceRect(State, RectTag, Top, ImVec2(Top.x + Width, Top.y + HeadTall * S));

    const ImVec2 HeadMax(Top.x + Width, Top.y + HeadTall * S);
    DrawList->AddRectFilled(Top, HeadMax, ResolveCssColour(0x212121FF), Radius * S,
                            InOutOpen ? ImDrawFlags_RoundCornersTop : ImDrawFlags_RoundCornersAll);
    if (!InOutOpen) DrawList->AddRect(Top, HeadMax, ResolveCssColour(0xFFFFFF0E), Radius * S, ImDrawFlags_None, S);

    const float LineTop = Top.y + 14.0f * S;
    float       TextAt  = Top.x + PadSide * S;
    if (Glyph != nullptr && Glyph[0] != '\0')
    {
        (void)GlyphSymbol::Construct(DrawList, Glyph, ImVec2(TextAt, LineTop + 2.0f * S), 14.0f * S, 1.6f,
                                     FadeColour(ResolveCssColour(0xE8C27AFF), 0.9f));
        TextAt += (14.0f + 9.0f) * S;
    }
    char Upper[96]{};
    if (Status != nullptr && Status[0] != '\0') ToUpperCopy(Status, Upper, sizeof(Upper));
    const float StatusAdvance = Upper[0] != '\0' ? GlyphRun::Measure(Column, Faces.Regular, 10.0f * S, Upper, 0.6f * S) : 0.0f;
    // 📝 Long titles truncate with "..." instead of colliding with the status tag or bleeding past the card edge.
    const float TitleAvail = Top.x + Width - PadSide * S - (StatusAdvance > 0.0f ? (StatusAdvance + 12.0f * S) : 0.0f) - TextAt;
    char        Clipped[160]{};
    const char* TitleDraw = Title != nullptr ? Title : "";
    if (GlyphRun::Measure(Column, Faces.Light, 15.0f * S, TitleDraw, -0.25f * S) > TitleAvail && TitleAvail > 40.0f * S)
    {
        size_t Keep = std::strlen(TitleDraw);
        Clipped[0]  = '\0';
        while (Keep > 0)
        {
            do { --Keep; } while (Keep > 0 && (TitleDraw[Keep] & 0xC0) == 0x80); // UTF-8 codepoint boundary
            std::snprintf(Clipped, sizeof(Clipped), "%.*s...", static_cast<int>(Keep), TitleDraw);
            if (GlyphRun::Measure(Column, Faces.Light, 15.0f * S, Clipped, -0.25f * S) <= TitleAvail) break;
        }
        if (Clipped[0] != '\0') TitleDraw = Clipped;
    }
    (void)GlyphRun::Construct(Column, Faces.Light, 15.0f * S, ImVec2(TextAt, GlyphRun::ResolveBaseline(LineTop, 15.0f * S, 1.2f)),
                              ResolveCssColour(0xE4E4E4FF), TitleDraw, -0.25f * S);
    if (Upper[0] != '\0')
    {
        const float StatusTop = Top.y + 0.5f * (HeadTall * S - 10.0f * 1.4f * S);
        (void)GlyphRun::Construct(Column, Faces.Regular, 10.0f * S,
                                  ImVec2(Top.x + Width - PadSide * S - StatusAdvance,
                                         GlyphRun::ResolveBaseline(StatusTop, 10.0f * S, 1.4f)),
                                  ResolveCssColour(0x6D6D6DFF), Upper, 0.6f * S);
    }

    InspectorSectionScope Scope{};
    Scope.Open       = InOutOpen;
    Scope.CardLeft   = Top.x;
    Scope.CardWidth  = Width;
    Scope.CardTop    = Top.y;
    Scope.HeadBottom = HeadMax.y;
    QueryInspectorSections().push_back(Scope);

    if (!InOutOpen)
    {
        (void)Column.Space(0.0f, 0.0f, 10.0f);
        return false;
    }
    DrawList->ChannelsSplit(2);
    DrawList->ChannelsSetCurrent(1);
    Column.PushIndent(PadSide, PadSide);
    return true;
}

void EndInspectorSection(ControlColumn& Column)
{
    std::vector<InspectorSectionScope>& Scopes = QueryInspectorSections();
    if (Scopes.empty()) return;
    const InspectorSectionScope Scope = Scopes.back();
    Scopes.pop_back();
    if (!Scope.Open) return;

    Column.PopIndent();
    ImDrawList* const DrawList = Column.QueryDrawList();
    const float       S        = Column.QueryScale();
    (void)Column.Space(18.0f, 0.0f, 10.0f);
    const ImVec2 Cursor = Column.QueryCursor();
    const ImVec2 CardMin(Scope.CardLeft, Scope.CardTop);
    const ImVec2 CardMax(Scope.CardLeft + Scope.CardWidth, Cursor.y);
    DrawList->ChannelsSetCurrent(0);
    const ImVec2 BodyMin(CardMin.x, Scope.HeadBottom);
    const int    VertexStart = DrawList->VtxBuffer.Size;
    DrawList->AddRectFilled(BodyMin, CardMax, ResolveCssColour(0x212121FF), 22.0f * S, ImDrawFlags_RoundCornersBottom);
    ImGui::ShadeVertsLinearColorGradientKeepAlpha(DrawList, VertexStart, DrawList->VtxBuffer.Size, BodyMin, CardMax,
                                                  ResolveCssColour(0x212121FF), ResolveCssColour(0x191919FF));
    DrawList->AddRect(CardMin, CardMax, ResolveCssColour(0xFFFFFF0E), 22.0f * S, ImDrawFlags_None, S);
    DrawList->ChannelsMerge();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    PAGE CHROME
//------------------------------------------------------------------------------------------------------------------------

void CrumbRow(ControlColumn& Column, const char* Crumb)
{
    const EditorTypefaces& Faces = Column.QueryFaces();
    const float            S     = Column.QueryScale();
    const ImVec2           Top   = Column.Space(15.0f, 2.0f, 8.0f);
    (void)GlyphRun::Construct(Column, Faces.Regular, 11.0f * S,
                              ImVec2(Top.x + 4.0f * S, GlyphRun::ResolveBaseline(Top.y, 11.0f * S, 1.4f)),
                              ResolveCssColour(0x848484FF), Crumb);
}

void SubtitleRow(ControlColumn& Column, const char* Subtitle)
{
    const EditorTypefaces& Faces = Column.QueryFaces();
    const float            S     = Column.QueryScale();
    const float            Width = Column.QueryWidth();
    const float Tall = ParagraphBlock::Construct(Column, Faces.Regular, 11.0f * S, 1.5f, Column.QueryCursor(), Width - 8.0f * S,
                                                 ResolveCssColour(0x7E7E7EFF), Subtitle, true);
    const ImVec2 Top = Column.Space(Tall / S, 4.0f, 12.0f);
    (void)ParagraphBlock::Construct(Column, Faces.Regular, 11.0f * S, 1.5f, ImVec2(Top.x + 4.0f * S, Top.y), Width - 8.0f * S,
                                    ResolveCssColour(0x7E7E7EFF), Subtitle, false);
}

void PageHead(ControlColumn& Column, const char* Crumb, const char* Title, const char* Pill, bool Live, const char* Subtitle)
{
    const EditorTypefaces& Faces   = Column.QueryFaces();
    ImDrawList* const      DrawList = Column.QueryDrawList();
    const float            S        = Column.QueryScale();
    const float            Width    = Column.QueryWidth();

    CrumbRow(Column, Crumb);

    const ImVec2 TitleTop = Column.Space(26.0f, 0.0f, 4.0f);
    (void)GlyphRun::Construct(Column, Faces.Light, 21.0f * S,
                              ImVec2(TitleTop.x + 4.0f * S, GlyphRun::ResolveBaseline(TitleTop.y + 0.5f * S, 21.0f * S, 1.2f)),
                              ResolveCssColour(0xF4F4F4FF), Title, -0.45f * S);
    ImFont* const PillFace = Live ? Faces.SemiBold : Faces.Medium;
    const float   Tracking = Live ? 0.7f * S : 0.0f;
    const float   PillText = GlyphRun::Measure(Column, PillFace, 9.5f * S, Pill, Tracking);
    const float   PillTall = 9.5f * 1.4f * S + 6.0f * S;
    const ImVec2  PillMin(TitleTop.x + Width - 4.0f * S - PillText - 18.0f * S, TitleTop.y + (26.0f * S - PillTall) * 0.5f);
    const ImVec2  PillMax(PillMin.x + PillText + 18.0f * S, PillMin.y + PillTall);
    DrawList->AddRectFilled(PillMin, PillMax, ResolveCssColour(Live ? 0x3EC46D26 : 0xEFF4CF24), PillTall * 0.5f);
    (void)GlyphRun::Construct(Column, PillFace, 9.5f * S,
                              ImVec2(PillMin.x + 9.0f * S, GlyphRun::ResolveBaseline(PillMin.y + 3.0f * S, 9.5f * S, 1.4f)),
                              ResolveCssColour(Live ? 0x3EC46DFF : 0xEFF4CFFF), Pill, Tracking);

    SubtitleRow(Column, Subtitle);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    BEAUFORT
//------------------------------------------------------------------------------------------------------------------------

struct BeaufortReading
{
    int         Force = 0;
    const char* Name  = "Calm";
};

BeaufortReading ResolveBeaufort(double Speed) noexcept
{
    static const double BeaufortLimits[12] = { 0.5, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7 };
    static const char*  BeaufortNames[13]  = { "Calm",         "Light air",   "Light breeze", "Gentle breeze", "Moderate breeze",
                                               "Fresh breeze", "Strong breeze", "Near gale",  "Gale",          "Strong gale",
                                               "Storm",        "Violent storm", "Hurricane force" };
    int Force = 0;
    while (Force < 12 && Speed >= BeaufortLimits[Force]) ++Force;
    return BeaufortReading{ Force, BeaufortNames[Force] };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    NATIVE LEVELSPACE PREVIEW
//------------------------------------------------------------------------------------------------------------------------

std::vector<std::string> ReadLevelspacePreview(const ForceFieldWorkspaceState& State)
{
    if (State.ExportPreview.empty())
        return {"No export written yet.", "Choose a .levelspace path above,", "then export the native records."};

    std::vector<std::string> Lines;
    std::istringstream Input(State.ExportPreview);
    std::string Line;
    while (Lines.size() < 120 && std::getline(Input, Line)) Lines.push_back(Line);
    if (Input && Lines.size() == 120) Lines.emplace_back("… preview truncated …");
    return Lines;
}

void LevelspacePre(ControlColumn& Column, const char* Id, const std::vector<std::string>& Lines)
{
    const EditorTypefaces& Faces = Column.QueryFaces();
    const float            S     = Column.QueryScale();
    const float            Width = Column.QueryWidth();
    constexpr float        LineTall = 14.5f; // 🧩 10 px mono at line-height 1.45.
    const float ContentH = 20.0f * S + static_cast<float>(Lines.size()) * LineTall * S;
    const float BoxH     = std::min(ContentH, 200.0f * S);
    const ImVec2 Top     = Column.Space(BoxH / S, 8.0f, 0.0f);
    ImDrawList* const DrawList = Column.QueryDrawList();
    DrawList->AddRectFilled(Top, ImVec2(Top.x + Width, Top.y + BoxH), ResolveCssColour(0x0A0A0AFF), 12.0f * S);
    DrawList->AddRect(Top, ImVec2(Top.x + Width, Top.y + BoxH), ResolveCssColour(0xFFFFFF12), 12.0f * S, ImDrawFlags_None, S);

    float MaxW = 0.0f;
    for (const std::string& Line : Lines) MaxW = std::max(MaxW, GlyphRun::Measure(Column, Faces.Monospace, 10.0f * S, Line.c_str()));

    ImGui::PushID(Id);
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.0f, 0.0f, 0.0f, 0.0f));
    ImGui::SetCursorScreenPos(ImVec2(Top.x + 10.0f * S, Top.y + 10.0f * S));
    ImGui::BeginChild("##Pre", ImVec2(Width - 20.0f * S, BoxH - 20.0f * S), false, ImGuiWindowFlags_HorizontalScrollbar);
    {
        ImDrawList* const Inner  = ImGui::GetWindowDrawList();
        const ImVec2      Origin = ImGui::GetCursorScreenPos();
        for (size_t Index = 0; Index < Lines.size(); ++Index)
        {
            const float Y = Origin.y + static_cast<float>(Index) * LineTall * S;
            (void)GlyphRun::Rasterize(Inner, &Faces, Faces.Monospace, 10.0f * S,
                                      ImVec2(Origin.x, GlyphRun::ResolveBaseline(Y, 10.0f * S, 1.45f)),
                                      ResolveCssColour(0x848484FF), Lines[Index].c_str(), 0.0f, false);
        }
        ImGui::Dummy(ImVec2(MaxW, static_cast<float>(Lines.size()) * LineTall * S));
    }
    ImGui::EndChild();
    ImGui::PopStyleColor();
    ImGui::PopID();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    INFLUENCE PROFILE
//------------------------------------------------------------------------------------------------------------------------

double FalloffAt(int Falloff, double Distance, double Radius) noexcept
{
    if (Distance >= Radius) return 0.0;
    if (Falloff == ForceFieldFalloffNone) return 1.0;
    const double Share = std::clamp(Distance / std::max(Radius, 1e-3), 0.0, 1.0);
    if (Falloff == ForceFieldFalloffLinear) return 1.0 - Share;
    if (Falloff == ForceFieldFalloffInverseSquare)
    {
        const double Clamped = std::clamp((Share - 0.85) / 0.15, 0.0, 1.0);
        const double Smooth  = Clamped * Clamped * (3.0 - 2.0 * Clamped);
        return (1.0 / (1.0 + 8.0 * Share * Share)) * (1.0 - Smooth);
    }
    const double Soft = 1.0 - Share * Share;
    return Soft * Soft;
}

// 📝 The source hero's radial profile: the JS CurvePlot frame (pads 34/12/14/22, ticks, dashed zero guide, caption)
//    over the analytic falloff envelope, strictly 0 past the influence boundary.
void InfluenceProfile(ControlColumn& Column, const ForceFieldWorkspaceSource& Source, const ForceFieldWorkspaceType& Type)
{
    const EditorTypefaces& Faces   = Column.QueryFaces();
    ImDrawList* const      DrawList = Column.QueryDrawList();
    const float            S        = Column.QueryScale();
    const float            Width    = Column.QueryWidth();
    constexpr float        PlotTall = 112.0f;
    const ImVec2           Top      = Column.Space(PlotTall, 0.0f, 0.0f);
    const float            H        = PlotTall * S;
    constexpr float        PadL = 34.0f, PadR = 12.0f, PadT = 14.0f, PadB = 22.0f;
    const float            PlotW = Width - (PadL + PadR) * S;
    const float            PlotH = H - (PadT + PadB) * S;

    double Reach = Source.Radius * 1.15;
    if (std::strcmp(Type.Id, "GustFront") == 0)
    {
        for (int Param = 0; Param < Type.ParamCount && Param < 7; ++Param)
        {
            if (std::strcmp(Type.Params[Param].Key, "CrestDepth") == 0) Reach = Source.Params[Param] * 3.0;
        }
    }
    else if (std::strcmp(Type.Id, "Blast") == 0) Reach = std::max(Source.Radius * 0.4, 60.0);
    else if (Source.Reach == ForceFieldReachBox) Reach = std::max(Source.HalfX, Source.HalfZ) * 1.15;
    const double Boundary = Reach / 1.15;

    double Points[73]{};
    double Peak = 0.0;
    for (int Step = 0; Step <= 72; ++Step)
    {
        const double Separation = static_cast<double>(Step) / 72.0 * Reach;
        Points[Step]            = Source.Params[0] * FalloffAt(Source.Falloff, Separation, Boundary);
        Peak                    = std::max(Peak, Points[Step]);
    }
    const double MaxY = std::max(1.0, Peak) * 1.15;
    const auto   MapX = [&](double X) { return Top.x + PadL * S + static_cast<float>(X / std::max(Reach, 1e-6)) * PlotW; };
    const auto   MapY = [&](double Y) { return Top.y + PadT * S + (1.0f - static_cast<float>(Y / std::max(MaxY, 1e-6))) * PlotH; };

    char                         MidLabel[32]{}, MaxLabel[32]{};
    std::snprintf(MidLabel, sizeof(MidLabel), "%.1f", MaxY * 0.5);
    std::snprintf(MaxLabel, sizeof(MaxLabel), "%.1f", MaxY);
    const double                 YValues[3]  = { 0.0, MaxY * 0.5, MaxY };
    const char*                  YLabels[3]  = { "0", MidLabel, MaxLabel };
    for (int Tick = 0; Tick < 3; ++Tick)
    {
        const float Y = MapY(YValues[Tick]);
        DrawList->AddLine(ImVec2(Top.x + PadL * S, Y), ImVec2(Top.x + Width - PadR * S, Y), ResolveCssColour(0xFFFFFF12), S);
        const float LabelW = GlyphRun::Measure(Column, Faces.Regular, 10.0f * S, YLabels[Tick]);
        (void)GlyphRun::Rasterize(DrawList, &Faces, Faces.Regular, 10.0f * S,
                                  ImVec2(Top.x + (PadL - 5.0f) * S - LabelW, Y + 3.0f * S),
                                  ResolveCssColour(0x7B8290FF), YLabels[Tick], 0.0f, false);
    }
    char                        HalfSpan[32]{}, FullSpan[32]{};
    FormatForceFieldSpan(Reach * 0.5, HalfSpan, sizeof(HalfSpan));
    FormatForceFieldSpan(Reach, FullSpan, sizeof(FullSpan));
    const double                XValues[3] = { 0.0, Reach * 0.5, Reach };
    const char*                 XLabels[3] = { "0", HalfSpan, FullSpan };
    for (int Tick = 0; Tick < 3; ++Tick)
    {
        const float LabelW = GlyphRun::Measure(Column, Faces.Regular, 10.0f * S, XLabels[Tick]);
        (void)GlyphRun::Rasterize(DrawList, &Faces, Faces.Regular, 10.0f * S,
                                  ImVec2(MapX(XValues[Tick]) - LabelW * 0.5f, Top.y + H - 5.0f * S),
                                  ResolveCssColour(0x7B8290FF), XLabels[Tick], 0.0f, false);
    }

    char RadiusSpan[32]{};
    FormatForceFieldSpan(Source.Radius, RadiusSpan, sizeof(RadiusSpan));
    char GuideText[64]{};
    std::snprintf(GuideText, sizeof(GuideText), "0 outside R = %s", RadiusSpan);
    const float GuideY = MapY(0.0);
    for (float X = Top.x + PadL * S; X < Top.x + Width - PadR * S; X += 8.0f * S)
    {
        DrawList->AddLine(ImVec2(X, GuideY), ImVec2(std::min(X + 4.0f * S, Top.x + Width - PadR * S), GuideY),
                          ResolveCssColour(0xFFFFFF38), S);
    }
    (void)GlyphRun::Rasterize(DrawList, &Faces, Faces.Regular, 10.0f * S,
                              ImVec2(Top.x + (PadL + 4.0f) * S, GuideY - 4.0f * S), ResolveCssColour(0x9AA3B2FF), GuideText,
                              0.0f, false);

    const ImU32 Stroke = ResolveCssColour(Type.Colour);
    const ImU32 Wash   = ResolveCssColour((Type.Colour & 0xFFFFFF00) | 0x26);
    ImVec2 Previous(MapX(0.0), MapY(Points[0]));
    for (int Step = 1; Step <= 72; ++Step)
    {
        const ImVec2 Point(MapX(static_cast<double>(Step) / 72.0 * Reach), MapY(Points[Step]));
        DrawList->AddLine(Previous, Point, Stroke, 1.8f * S);
        Previous = Point;
    }
    for (int Step = 0; Step <= 72; ++Step)
        DrawList->PathLineTo(ImVec2(MapX(static_cast<double>(Step) / 72.0 * Reach), MapY(Points[Step])));
    DrawList->PathLineTo(ImVec2(MapX(Reach), MapY(0.0)));
    DrawList->PathLineTo(ImVec2(MapX(0.0), MapY(0.0)));
    DrawList->PathFillConvex(Wash);

    char Caption[96]{};
    std::snprintf(Caption, sizeof(Caption), "Finite reach: strictly 0 %s beyond boundary",
                  QueryForceFieldContributionUnit(Type.Contribution));
    const ImVec2 CapTop = Column.Space(14.0f, 3.0f, 0.0f);
    const float  CapW   = GlyphRun::Measure(Column, Faces.Regular, 10.0f * S, Caption);
    (void)GlyphRun::Construct(Column, Faces.Regular, 10.0f * S,
                              ImVec2(CapTop.x + (Width - CapW) * 0.5f, GlyphRun::ResolveBaseline(CapTop.y, 10.0f * S, 1.4f)),
                              ResolveCssColour(0x5E5E5EFF), Caption);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    OBJECT HEADING
//------------------------------------------------------------------------------------------------------------------------

namespace
{
int  EditingSource  = -1;
bool EditingName    = false;
bool EditingFocused = false;
char EditingScratch[128]{};
} // namespace

void TrimCopy(const char* In, char* Out, size_t OutSize)
{
    if (Out == nullptr || OutSize == 0) return;
    while (*In != '\0' && std::isspace(static_cast<unsigned char>(*In)) != 0) ++In;
    size_t Length = 0;
    for (; In[Length] != '\0' && Length + 1 < OutSize; ++Length) Out[Length] = In[Length];
    Out[Length] = '\0';
    while (Length > 0 && std::isspace(static_cast<unsigned char>(Out[Length - 1])) != 0) Out[--Length] = '\0';
}

void ObjectHeading(ControlColumn& Column, ForceFieldWorkspaceState& State, int Index)
{
    ForceFieldWorkspaceSource&     Source = State.Sources[static_cast<size_t>(Index)];
    const ForceFieldWorkspaceType& Type   = QueryForceFieldType(Source.Type);
    if (EditingName && EditingSource != Index)
    {
        EditingName    = false;
        EditingFocused = false;
    }

    const EditorTypefaces& Faces   = Column.QueryFaces();
    ImDrawList* const      DrawList = Column.QueryDrawList();
    const float            S        = Column.QueryScale();
    const float            Width    = Column.QueryWidth();
    constexpr float        CardTall = 70.0f;
    const ImVec2           Top      = Column.Space(CardTall, 0.0f, 10.0f);
    const ImVec2           CardMax(Top.x + Width, Top.y + CardTall * S);
    const int              VertexStart = DrawList->VtxBuffer.Size;
    DrawList->AddRectFilled(Top, CardMax, ResolveCssColour(0x212121FF), 20.0f * S);
    ImGui::ShadeVertsLinearColorGradientKeepAlpha(DrawList, VertexStart, DrawList->VtxBuffer.Size, Top, CardMax,
                                                  ResolveCssColour(0x212121FF), ResolveCssColour(0x161616FF));
    DrawList->AddRect(Top, CardMax, ResolveCssColour(0xFFFFFF12), 20.0f * S, ImDrawFlags_None, S);

    const uint32_t Tinge = Type.Colour;
    const ImVec2   SymMin(Top.x + 14.0f * S, Top.y + 14.0f * S);
    const ImVec2   SymMax(SymMin.x + 38.0f * S, SymMin.y + 42.0f * S);
    DrawList->AddRectFilled(SymMin, SymMax, ResolveCssColour((Tinge & 0xFFFFFF00) | 0x20), 14.0f * S);
    DrawList->AddRect(SymMin, SymMax, ResolveCssColour((Tinge & 0xFFFFFF00) | 0x44), 14.0f * S, ImDrawFlags_None, S);
    (void)GlyphSymbol::Construct(DrawList, Type.Glyph, ImVec2(SymMin.x + 10.0f * S, SymMin.y + 12.0f * S), 18.0f * S, 2.0f,
                                 ResolveCssColour(Tinge));

    const float PillText = GlyphRun::Measure(Column, Faces.Regular, 9.0f * S, "BOUNDED", 0.9f * S);
    const float PillTall = 9.0f * 1.4f * S + 6.0f * S;
    const ImVec2 PillMax(CardMax.x - 14.0f * S, Top.y + (CardTall * S + PillTall) * 0.5f);
    const ImVec2 PillMin(PillMax.x - PillText - 16.0f * S, PillMax.y - PillTall);
    DrawList->AddRectFilled(PillMin, PillMax, ResolveCssColour(0xFFFFFF0A), PillTall * 0.5f);
    DrawList->AddRect(PillMin, PillMax, ResolveCssColour(0xFFFFFF1F), PillTall * 0.5f, ImDrawFlags_None, S);
    (void)GlyphRun::Construct(Column, Faces.Regular, 9.0f * S,
                              ImVec2(PillMin.x + 8.0f * S, GlyphRun::ResolveBaseline(PillMin.y + 3.0f * S, 9.0f * S, 1.4f)),
                              ResolveCssColour(Tinge), "BOUNDED", 0.9f * S);

    const float CopyX = SymMax.x + 12.0f * S;
    const float CopyW = PillMin.x - 12.0f * S - CopyX;
    const float NameTop = Top.y + (CardTall * S - (19.0f * 1.2f + 2.0f + 9.5f * 1.4f) * S) * 0.5f;
    const ImVec2 NameMax(CopyX + CopyW, NameTop + 19.0f * 1.2f * S);
    RecordForceFieldWorkspaceRect(State, "Inspector/Name", ImVec2(CopyX, NameTop), NameMax);
    ImGui::PushID("SourceName");
    if (!EditingName)
    {
        (void)GlyphRun::Construct(Column, Faces.Light, 19.0f * S,
                                  ImVec2(CopyX, GlyphRun::ResolveBaseline(NameTop, 19.0f * S, 1.2f)),
                                  ResolveCssColour(0xF4F4F4FF), Source.Name.c_str(), -0.45f * S);
        if (PressRect("##Name", ImVec2(CopyX, NameTop), NameMax))
        {
            EditingName    = true;
            EditingFocused = true;
            EditingSource  = Index;
            std::snprintf(EditingScratch, sizeof(EditingScratch), "%s", Source.Name.c_str());
        }
    }
    else
    {
        ImGui::SetCursorScreenPos(ImVec2(CopyX, NameTop));
        ImGui::PushItemWidth(CopyW);
        ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.0f, 0.0f, 0.0f, 0.0f));
        ImGui::PushStyleColor(ImGuiCol_Text, ImGui::ColorConvertU32ToFloat4(ResolveCssColour(0xF4F4F4FF)));
        ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 0.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(0.0f, 0.0f));
        if (EditingFocused)
        {
            ImGui::SetKeyboardFocusHere();
            EditingFocused = false;
        }
        const bool Committed = ImGui::InputText("##NameEdit", EditingScratch, sizeof(EditingScratch),
                                                ImGuiInputTextFlags_EnterReturnsTrue | ImGuiInputTextFlags_AutoSelectAll);
        const bool Done      = Committed || ImGui::IsItemDeactivatedAfterEdit();
        const bool Cancelled = ImGui::IsKeyPressed(ImGuiKey_Escape);
        ImGui::PopStyleVar(2);
        ImGui::PopStyleColor(2);
        ImGui::PopItemWidth();
        if (Cancelled) EditingName = false;
        else if (Done)
        {
            char Trimmed[128]{};
            TrimCopy(EditingScratch, Trimmed, sizeof(Trimmed));
            Source.Name   = Trimmed[0] != '\0' ? Trimmed : Type.Name;
            EditingName   = false;
        }
    }
    ImGui::PopID();

    char Sub[160]{}, Upper[160]{};
    std::snprintf(Sub, sizeof(Sub), "%s · %s · %s", Type.Native, ContribLabel(Type.Contribution),
                  QueryForceFieldReachName(Source.Reach));
    ToUpperCopy(Sub, Upper, sizeof(Upper));
    (void)GlyphRun::Construct(Column, Faces.Regular, 9.5f * S,
                              ImVec2(CopyX, GlyphRun::ResolveBaseline(NameTop + (19.0f * 1.2f + 2.0f) * S, 9.5f * S, 1.4f)),
                              ResolveCssColour(0x7C7C7CFF), Upper, 1.0f * S);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    FIELD PAGE
//------------------------------------------------------------------------------------------------------------------------

void FieldPage(ForceFieldWorkspaceState& State, ControlColumn& Column)
{
    PageHead(Column, "Inspector / Master Workspace", "Force Field Workspace", "LIVE", true,
             "Master spatial field: clean RK2 flow lines, sparse vector field, and finite influence envelopes.");

    const char* ContribOptions[3] = { "Flow · m/s", "Accelerate · m/s²", "Damp · 1/s" };
    if (PillTabs::Construct(Column, "##Contribution", ContribOptions, 3, State.View.Contribution))
    {
        if (State.View.Contribution == ForceFieldContributionDamp) State.View.Quantity = 0;
    }

    double Peak = 0.0;
    for (int Index = 0; Index < State.PeakCount; ++Index) Peak = std::max(Peak, State.PeakSamples[Index]);
    const BeaufortReading Beaufort = ResolveBeaufort(Peak);
    char                  ChipText[64]{};
    int                   Mark = HeroCard::MarkLive;
    if (State.View.Contribution == ForceFieldContributionFlow)
    {
        std::snprintf(ChipText, sizeof(ChipText), "Beaufort %d · %s", Beaufort.Force, Beaufort.Name);
        Mark = Beaufort.Force >= 10 ? HeroCard::MarkDanger : (Beaufort.Force >= 8 ? HeroCard::MarkWarm : HeroCard::MarkLive);
    }
    else std::snprintf(ChipText, sizeof(ChipText), "%s peak", ContribLabel(State.View.Contribution));
    char MetricText[32]{};
    std::snprintf(MetricText, sizeof(MetricText), Peak >= 100.0 ? "%.0f" : "%.1f", Peak);
    char SpanText[32]{};
    FormatForceFieldSpan(State.View.Span, SpanText, sizeof(SpanText));
    char SideText[64]{};
    std::snprintf(SideText, sizeof(SideText), "%s span · 24 flow lines", SpanText);
    const HeroCardInner FieldHero =
        HeroCard::Begin(Column, "##FieldHero", ChipText, "StudioFieldCheck", Mark, "In view peak", MetricText,
                        QueryForceFieldContributionUnit(State.View.Contribution), SideText);
    TimeSeries::Construct(Column, State.PeakSamples, State.PeakCount, 40, 17.2, 90.0f, true, 1.25);
    HeroCard::End(Column, FieldHero,
                  "Quiet dead zones outside forcefield influence envelopes are cleanly omitted so the workspace stays legible.");

    const bool FlowLines = State.View.FlowLines;
    const bool Arrows    = State.View.Arrows;
    const bool Influence = State.View.ShowInfluence;
    const bool Heatmap   = State.View.Heatmap;
    const bool Labels    = State.View.MinimalLabels;
    const bool Ambient   = State.Wind.Enabled;
    ToggleTileItem Tiles[6] = { { "Flow lines", "StudioFieldFlowLine", &State.View.FlowLines },
                                { "Vector field", "StudioFieldMove", &State.View.Arrows },
                                { "Influence", "StudioFieldTarget", &State.View.ShowInfluence },
                                { "Heatmap", "StudioFieldLayers", &State.View.Heatmap },
                                { "Clean labels", "StudioFieldEye", &State.View.MinimalLabels },
                                { "Ambient wind", "StudioFieldWind", &State.Wind.Enabled } };
    (void)ToggleTile::ConstructGrid(Column, "##FieldTiles", Tiles, 6);
    if (State.View.FlowLines != FlowLines) LogSwitch(State, "VIEW", "Field", "Flow lines", State.View.FlowLines);
    if (State.View.Arrows != Arrows) LogSwitch(State, "VIEW", "Field", "Vector field", State.View.Arrows);
    if (State.View.ShowInfluence != Influence) LogSwitch(State, "VIEW", "Field", "Influence", State.View.ShowInfluence);
    if (State.View.Heatmap != Heatmap) LogSwitch(State, "VIEW", "Field", "Heatmap", State.View.Heatmap);
    if (State.View.MinimalLabels != Labels) LogSwitch(State, "VIEW", "Field", "Clean labels", State.View.MinimalLabels);
    if (State.Wind.Enabled != Ambient) LogSwitch(State, "WIND", "Wind", "Ambient wind", State.Wind.Enabled);

    char ArrowTrim[16]{}, LineTrim[16]{}, DeclutterStatus[48]{};
    FormatForceFieldTrimmed(State.View.ArrowSpacing, 0, ArrowTrim, sizeof(ArrowTrim));
    FormatForceFieldTrimmed(State.View.FlowLineSpacing, 0, LineTrim, sizeof(LineTrim));
    std::snprintf(DeclutterStatus, sizeof(DeclutterStatus), "%s px · %s px", ArrowTrim, LineTrim);
    const bool DeclutterOpen = BeginInspectorSection(Column, State, "declutter", "Vectors & Flow Lines (Anti-Clutter)",
                                                     "StudioFieldFlowLine", DeclutterStatus, State.CardDeclutter);
    if (DeclutterOpen)
    {
        const char* QuantityOptions[4] = { "Speed", "Vertical", "Vorticity ω", "Divergence ∇·v" };
        static const char* QuantityValues[4] = { "Speed", "Vertical", "Vorticity", "Divergence" };
        if (SegmentedRow::Construct(Column, "##Quantity", "Mapped scalar", QuantityOptions, 4, State.View.Quantity, true, true))
            LogForceFieldWorkspaceValue(State, "VIEW", "View", "Mapped scalar", QuantityValues[State.View.Quantity]);
        SliderPillOptions SpacingEnds;
        SpacingEnds.LowerEnd = "denser";
        SpacingEnds.UpperEnd = "cleaner";
        if (SliderPill::Construct(Column, "##ArrowSpacing", "Vector arrow spacing", State.View.ArrowSpacing, 30.0, 96.0, 2.0,
                                  "px", SpacingEnds, true))
            LogFigure(State, "VIEW", "View", "Vector arrow spacing", State.View.ArrowSpacing, 0, "px");
        SliderPillOptions LineEnds;
        LineEnds.LowerEnd = "more lines";
        LineEnds.UpperEnd = "minimal";
        if (SliderPill::Construct(Column, "##FlowLineSpacing", "Flow line separation", State.View.FlowLineSpacing, 24.0, 88.0,
                                  2.0, "px", LineEnds, true))
            LogFigure(State, "VIEW", "View", "Flow line separation", State.View.FlowLineSpacing, 0, "px");
        if (SliderPill::Construct(Column, "##FlowLineLength", "Flow line arc length", State.View.FlowLineLength, 10.0, 40.0, 2.0,
                                  "steps"))
            LogFigure(State, "VIEW", "View", "Flow line arc length", State.View.FlowLineLength, 0, "steps");
        SliderPillOptions CutoffEnds;
        CutoffEnds.LowerEnd = "draw all";
        CutoffEnds.UpperEnd = "skip weak";
        if (SliderPill::Construct(Column, "##QuietCutoff", "Quiet cutoff threshold", State.View.QuietCutoff, 0.0, 0.2, 0.005,
                                  "×", CutoffEnds, true))
            LogFigure(State, "VIEW", "View", "Quiet cutoff threshold", State.View.QuietCutoff, 3, "×");
        SliderPillOptions Slice;
        Slice.Logarithmic = true;
        Slice.Distance    = true;
        if (SliderPill::Construct(Column, "##SliceHeight", "Slice elevation Y", State.View.SliceHeight, 1.0, 2000.0, 1.0, "m",
                                  Slice, true))
            LogSpan(State, "VIEW", "View", "Slice elevation Y", State.View.SliceHeight);
        if (SwitchPill::Construct(Column, "##FlowLinePulse", "Animate directional pulses",
                                  "Subtle moving packets along streamlines show speed and direction.", State.View.FlowLinePulse,
                                  SwitchTone::Verdant, true))
            LogSwitch(State, "VIEW", "View", "Animate directional pulses", State.View.FlowLinePulse);
        if (SwitchPill::Construct(Column, "##Cascades", "Show cascade boundaries", nullptr, State.View.Cascades,
                                  SwitchTone::Verdant, true))
            LogSwitch(State, "VIEW", "View", "Show cascade boundaries", State.View.Cascades);
    }
    EndInspectorSection(Column);

    int Coupled = 0;
    for (int Index = 0; Index < 7; ++Index)
    {
        if (State.FieldChannels[Index]) ++Coupled;
    }
    char ReceiversStatus[32]{};
    std::snprintf(ReceiversStatus, sizeof(ReceiversStatus), "%d channels", Coupled);
    const bool ReceiversOpen = BeginInspectorSection(Column, State, "receivers", "Receivers & Budget", "StudioFieldSparkles",
                                                     ReceiversStatus, State.CardReceivers);
    if (ReceiversOpen)
    {
        const char* ChannelOptions[7] = { QueryForceFieldChannelLabel(0), QueryForceFieldChannelLabel(1),
                                          QueryForceFieldChannelLabel(2), QueryForceFieldChannelLabel(3),
                                          QueryForceFieldChannelLabel(4), QueryForceFieldChannelLabel(5),
                                          QueryForceFieldChannelLabel(6) };
        char        Detail[64]{};
        std::snprintf(Detail, sizeof(Detail), "%d receiver types sample this field.", Coupled);
        if (ChipToggles::Construct(Column, "##Channels", "Coupled receivers", ChannelOptions, State.FieldChannels, 7, Detail))
            LogChannels(State, "FORCES", "Field", "Coupled receivers", State.FieldChannels);
        int Baked = 0, Live = 0, Damp = 0, Active = 0;
        for (const ForceFieldWorkspaceSource& Source : State.Sources)
        {
            if (Source.Enabled) ++Active;
            const int Contribution = QueryForceFieldType(Source.Type).Contribution;
            if (Contribution == ForceFieldContributionDamp) ++Damp;
            else if (Contribution == ForceFieldContributionFlow && ActsEmpty(Source)) ++Baked;
            else ++Live;
        }
        char BakedText[16]{}, LiveText[16]{}, ActiveText[16]{};
        std::snprintf(BakedText, sizeof(BakedText), "%d / 16", Baked);
        std::snprintf(LiveText, sizeof(LiveText), "%d", Live + Damp);
        std::snprintf(ActiveText, sizeof(ActiveText), "%d", Active);
        const StatGridCell Budget[4] = { { "Baked flow slots", BakedText },
                                         { "Live accel / damp", LiveText },
                                         { "Active sources", ActiveText },
                                         { "All bounded?", "100% Yes" } };
        StatGrid::Construct(Column, Budget, 4);
        const ActionItem Place[1] = { { "Place new forcefield / wind…", "StudioFieldPlus", ActionTone::Accent } };
        if (ActionRow::Construct(Column, "##PlaceNew", Place, 1) == 0) State.LibraryOpen = true;
    }
    EndInspectorSection(Column);

    const bool LevelOpen = BeginInspectorSection(Column, State, "lvl", "Native Levelspace Export", "StudioFieldCopy", "LEVELSPACE",
                                                 State.CardLevel);
    if (LevelOpen)
    {
        if (TextRow::Construct(Column, "ExportPath", "Destination (.levelspace)", State.ExportPath, true,
                               "Path is relative to the application working directory unless it is absolute."))
            State.ExportStatus = "Destination changed; click Export native .levelspace to write it.";

        const ActionItem LevelActions[2] = { { "Export .levelspace", "StudioFieldCopy", ActionTone::Accent },
                                             { "Reset preset", "StudioFieldReset", ActionTone::Default } };
        ImVec4 ActionRects[2]{};
        const int Fired = ActionRow::Construct(Column, "##Levelspace", LevelActions, 2, true, nullptr,
                                               ActionRowVoice::Charcoal, ActionRects);
        for (int Action = 0; Action < 2; ++Action)
        {
            const char* RectName = Action == 0 ? "Inspector/LevelAction0" : "Inspector/LevelAction1";
            RecordForceFieldWorkspaceRect(State, RectName, ImVec2(ActionRects[Action].x, ActionRects[Action].y),
                                          ImVec2(ActionRects[Action].z, ActionRects[Action].w));
        }
        if (Fired == 0)
        {
            std::string Diagnostic;
            if (ExportForceFieldWorkspaceLevelSpace(State, std::filesystem::path(State.ExportPath), &Diagnostic))
            {
                std::ifstream Input(State.ExportPath, std::ios::binary);
                if (Input)
                {
                    std::ostringstream Contents;
                    Contents << Input.rdbuf();
                    State.ExportPreview = Contents.str();
                }
                State.ExportStatus = "Exported native ForceField, Wind, and " + std::to_string(State.Sources.size()) +
                                     " ForceSource records to " + State.ExportPath;
                AppendForceFieldWorkspaceLog(State, "EXPORT", "Saved native Levelspace", State.ExportPath.c_str());
                Toast::Show("Native Levelspace exported");
            }
            else
            {
                State.ExportStatus = Diagnostic.empty() ? "Native Levelspace export failed." : Diagnostic;
                AppendForceFieldWorkspaceLog(State, "EXPORT", "Native Levelspace export failed", State.ExportStatus.c_str());
                Toast::Show("Levelspace export failed");
            }
        }
        else if (Fired == 1)
        {
            const int Scenario = State.Scenario;
            ApplyForceFieldWorkspacePreset(State, Scenario);
            Toast::Show("Workspace preset reset");
        }
        SubtitleRow(Column, State.ExportStatus.c_str());
        LevelspacePre(Column, "Levelspace", ReadLevelspacePreview(State));
    }
    EndInspectorSection(Column);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    WIND PAGE
//------------------------------------------------------------------------------------------------------------------------

void WindPage(ForceFieldWorkspaceState& State, ControlColumn& Column)
{
    PageHead(Column, "Inspector / Ambient Wind", "Ambient Wind", "GUEST", false,
             "Regional atmospheric background profile (disabled by default in Lab so placed Wind Generators stand out cleanly).");

    ForceFieldWorkspaceState::WindState& Wind = State.Wind;
    char                             MetricText[32]{};
    std::snprintf(MetricText, sizeof(MetricText), "%.1f", Wind.Enabled ? Wind.Speed : 0.0);
    char SideText[64]{};
    if (Wind.Enabled)
    {
        double From = std::fmod(Wind.Bearing + 180.0, 360.0);
        if (From < 0.0) From += 360.0;
        std::snprintf(SideText, sizeof(SideText), "From %.0f° %s", From, PolarDial::ResolveCompassPoint(From));
    }
    else std::snprintf(SideText, sizeof(SideText), "%s", "Ambient wind OFF");
    const HeroCardInner WindHero = HeroCard::Begin(Column, "##WindHero", "Wind at 10 m", nullptr, HeroCard::MarkNone,
                                                   "PlanetaryWindProfile", MetricText, "m/s", SideText);
    TimeSeries::Construct(Column, State.WindSamples, State.WindCount, 40, Wind.Speed, 86.0f);
    HeroCard::End(Column, WindHero);

    char FlowStatus[32]{};
    if (Wind.Enabled) std::snprintf(FlowStatus, sizeof(FlowStatus), "%.1f m/s", Wind.Speed);
    else std::snprintf(FlowStatus, sizeof(FlowStatus), "%s", "Off");
    const bool FlowOpen = BeginInspectorSection(Column, State, "wflow", "Ambient Direction & Bounded Region", "StudioFieldCompass",
                                                FlowStatus, State.CardWindFlow);
    if (FlowOpen)
    {
        if (SwitchPill::Construct(Column, "##WindEnabled", "Enable ambient wind",
                                  "Turn off to isolate placed Wind Generators & Forcefields.", Wind.Enabled,
                                  SwitchTone::Verdant, true))
            LogSwitch(State, "WIND", "Wind", "Enable ambient wind", Wind.Enabled);
        if (SwitchPill::Construct(Column, "##WindBounded", "Finite regional radius",
                                  "Bounds ambient wind smoothly around origin instead of infinite space.", Wind.Bounded,
                                  SwitchTone::Verdant, true))
            LogSwitch(State, "WIND", "Wind", "Finite regional radius", Wind.Bounded);
        SliderPillOptions Region;
        Region.Logarithmic = true;
        Region.Distance     = true;
        if (SliderPill::Construct(Column, "##RegionRadius", "Regional radius", Wind.RegionRadius, 100.0, 50000.0, 1.0, "m",
                                  Region, Wind.Bounded))
            LogSpan(State, "WIND", "Wind", "Regional radius", Wind.RegionRadius);
        if (PolarDial::Construct(Column, "##WindBearing", Wind.Bearing))
            LogFigure(State, "WIND", "Wind", "Travel bearing", Wind.Bearing, 0, "°");
        if (SliderPill::Construct(Column, "##BaseSpeed", "Base speed", Wind.Speed, 0.0, 40.0, 0.5, "m/s"))
            LogFigure(State, "WIND", "Wind", "Base speed", Wind.Speed, 1, "m/s");
    }
    EndInspectorSection(Column);

    char GustStatus[16]{};
    std::snprintf(GustStatus, sizeof(GustStatus), "%.0f%%", Wind.GustStrength * 100.0);
    const bool GustOpen = BeginInspectorSection(Column, State, "wgst", "Gusts, Turbulence & Ekman Veer", "StudioFieldActivity",
                                                GustStatus, State.CardWindGust);
    if (GustOpen)
    {
        if (SliderPill::Construct(Column, "##GustStrength", "Gust amplitude", Wind.GustStrength, 0.0, 1.0, 0.02, "×"))
            LogFigure(State, "WIND", "Wind", "Gust amplitude", Wind.GustStrength, 2, "×");
        if (SliderPill::Construct(Column, "##GustFrequency", "Gust frequency", Wind.GustFrequency, 0.01, 1.5, 0.01, "Hz"))
            LogFigure(State, "WIND", "Wind", "Gust frequency", Wind.GustFrequency, 2, "Hz");
        SliderPillOptions Bare;
        Bare.EmptyUnit = "";
        if (SliderPill::Construct(Column, "##Turbulence", "Curl eddies", Wind.Turbulence, 0.0, 1.5, 0.02, "", Bare, true))
            LogFigure(State, "WIND", "Wind", "Curl eddies", Wind.Turbulence, 2, "");
        if (SliderPill::Construct(Column, "##Shear", "Ekman shear (/km)", Wind.Shear, 0.0, 0.8, 0.02, "", Bare, true))
            LogFigure(State, "WIND", "Wind", "Ekman shear (/km)", Wind.Shear, 2, "");
        if (SliderPill::Construct(Column, "##Veer", "Ekman veer (°/km)", Wind.Veer, -30.0, 30.0, 1.0, "°"))
            LogFigure(State, "WIND", "Wind", "Ekman veer (°/km)", Wind.Veer, 0, "°");
    }
    EndInspectorSection(Column);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    SOURCE PAGE
//------------------------------------------------------------------------------------------------------------------------

void SourcePage(ForceFieldWorkspaceState& State, ControlColumn& Column, int Index)
{
    ForceFieldWorkspaceSource&     Source = State.Sources[static_cast<size_t>(Index)];
    const ForceFieldWorkspaceType& Type   = QueryForceFieldType(Source.Type);
    const char*                 Unit   = QueryForceFieldContributionUnit(Type.Contribution);

    char Crumb[160]{};
    std::snprintf(Crumb, sizeof(Crumb), "Inspector / %s / %s", ContribLabel(Type.Contribution), Type.Native);
    CrumbRow(Column, Crumb);
    ObjectHeading(Column, State, Index);
    SubtitleRow(Column, Type.Blurb);

    char Tag[64]{}, MetricText[32]{}, RadiusSpan[32]{}, SideText[96]{};
    std::snprintf(Tag, sizeof(Tag), "%s · %s", QueryForceFieldReachName(Source.Reach),
                  QueryForceFieldFalloffName(Source.Falloff));
    std::snprintf(MetricText, sizeof(MetricText), Source.Params[0] < 10.0 ? "%.2f" : "%.1f", Source.Params[0]);
    FormatForceFieldSpan(Source.Radius, RadiusSpan, sizeof(RadiusSpan));
    std::snprintf(SideText, sizeof(SideText), "R %s · %s", RadiusSpan, QueryForceFieldFalloffName(Source.Falloff));
    const HeroCardInner SourceHero = HeroCard::Begin(Column, "##SourceHero", "Bounded Spatial Influence Profile", nullptr,
                                                     HeroCard::MarkNone, Tag, MetricText, Unit, SideText);
    InfluenceProfile(Column, Source, Type);
    HeroCard::End(Column, SourceHero);

    const bool     EnabledBefore = Source.Enabled;
    const bool     SoloBefore    = State.View.Solo == Index;
    const bool     FollowBefore  = State.View.Follow == Index;
    bool           Solo          = SoloBefore;
    bool           Follow        = FollowBefore;
    ToggleTileItem Tiles[3]      = { { "Enabled", "StudioFieldCheck", &Source.Enabled },
                                     { "Solo field", "StudioFieldTarget", &Solo },
                                     { "Follow", "StudioFieldCompass", &Follow } };
    (void)ToggleTile::ConstructGrid(Column, "##SourceTiles", Tiles, 3);
    if (Source.Enabled != EnabledBefore) LogSwitch(State, "FORCES", Source.Name.c_str(), "Enabled", Source.Enabled);
    if (Solo != SoloBefore) State.View.Solo = Solo ? Index : -1;
    if (Follow != FollowBefore) State.View.Follow = Follow ? Index : -1;

    const ActionItem SourceActions[3] = { { "Frame", "StudioFieldRuler", ActionTone::Default },
                                          { "Duplicate", "StudioFieldCopy", ActionTone::Default },
                                          { "Remove", "StudioFieldTrash", ActionTone::Danger } };
    ImVec4 SourceActionRects[3]{};
    const int ActionFired = ActionRow::Construct(Column, "##SourceActions", SourceActions, 3, true, nullptr,
                                                 ActionRowVoice::Charcoal, SourceActionRects);
    for (int Action = 0; Action < 3; ++Action)
    {
        char RectName[48]{};
        std::snprintf(RectName, sizeof(RectName), "Inspector/SourceAction%d", Action);
        RecordForceFieldWorkspaceRect(State, RectName, ImVec2(SourceActionRects[Action].x, SourceActionRects[Action].y),
                                      ImVec2(SourceActionRects[Action].z, SourceActionRects[Action].w));
    }
    if (ActionFired == 0)
    {
        const double HorizontalSpan = Source.Reach == ForceFieldReachBox ? std::max(Source.HalfX, Source.HalfZ) : Source.Radius;
        State.View.CentreX = Source.Centre[0];
        State.View.CentreZ = -Source.Centre[2];
        State.View.Span = std::clamp(std::max(240.0, 3.2 * std::max(HorizontalSpan, Source.Height * 0.5)), 100.0, 100000.0);
        State.View.Follow = -1;
        AppendForceFieldWorkspaceLog(State, "VIEW", "Framed source", Source.Name.c_str());
        Toast::Show("Source framed in the field view");
    }
    else if (ActionFired == 1)
    {
        if (DuplicateForceFieldWorkspaceSource(State, Index))
        {
            Toast::Show("Force source duplicated");
            return; // 📝 Vector growth can invalidate the selected source reference.
        }
    }
    else if (ActionFired == 2)
    {
        const std::string RemovedName = Source.Name;
        if (RemoveForceFieldWorkspaceSource(State, Index))
        {
            Toast::Show(("Removed " + RemovedName).c_str());
            return; // 📝 Erasing the source invalidates the selected source reference.
        }
    }

    char PlaceStatus[80]{};
    std::snprintf(PlaceStatus, sizeof(PlaceStatus), "%s · %s", QueryForceFieldReachName(Source.Reach), RadiusSpan);
    const bool PlaceOpen =
        BeginInspectorSection(Column, State, "place", "Placement & Finite Influence", "StudioFieldTarget", PlaceStatus,
                              State.CardPlace);
    if (PlaceOpen)
    {
        if (VectorRow::Construct(Column, "##Centre", "Centre position (m)", "", Source.Centre, 1, false, 0.0, 0.0, true,
                                    true))
        {
            char X[24]{}, Y[24]{}, Z[24]{}, Shown[96]{};
            FormatForceFieldTrimmed(Source.Centre[0], 1, X, sizeof(X));
            FormatForceFieldTrimmed(Source.Centre[1], 1, Y, sizeof(Y));
            FormatForceFieldTrimmed(Source.Centre[2], 1, Z, sizeof(Z));
            std::snprintf(Shown, sizeof(Shown), "[%s, %s, %s]", X, Y, Z);
            LogForceFieldWorkspaceValue(State, "INFLUENCE", Source.Name.c_str(), "Centre position (m)", Shown);
        }
        const char* ReachOptions[3] = { "Sphere", "Column", "Box" };
        if (SegmentedRow::Construct(Column, "##Reach", "Influence shape (finite only)", ReachOptions, 3, Source.Reach, true,
                                    true))
            LogForceFieldWorkspaceValue(State, "INFLUENCE", Source.Name.c_str(), "Influence shape (finite only)",
                                     QueryForceFieldReachName(Source.Reach));
        SliderPillOptions Span;
        Span.Logarithmic = true;
        Span.Distance     = true;
        if (SliderPill::Construct(Column, "##Radius", "Influence radius", Source.Radius, 10.0, 40000.0, 1.0, "m", Span, true))
            LogSpan(State, "INFLUENCE", Source.Name.c_str(), "Influence radius", Source.Radius);
        if (Source.Reach == ForceFieldReachColumn || Source.Reach == ForceFieldReachBox)
        {
            if (SliderPill::Construct(Column, "##Height", "Vertical height", Source.Height, 5.0, 15000.0, 1.0, "m", Span, true))
            {
                for (int Param = 0; Param < Type.ParamCount; ++Param)
                    if (Type.Params[Param].Key != nullptr && std::strcmp(Type.Params[Param].Key, "Height") == 0)
                        Source.Params[Param] = Source.Height;
                LogSpan(State, "INFLUENCE", Source.Name.c_str(), "Vertical height", Source.Height);
            }
        }
        if (Source.Reach == ForceFieldReachBox && std::strcmp(Type.Id, "Jet") != 0 && std::strcmp(Type.Id, "Wake") != 0)
        {
            if (SliderPill::Construct(Column, "##HalfX", "Box half-width X", Source.HalfX, 5.0, 30000.0, 1.0, "m", Span, true))
                LogSpan(State, "INFLUENCE", Source.Name.c_str(), "Box half-width X", Source.HalfX);
            if (SliderPill::Construct(Column, "##HalfZ", "Box half-length Z", Source.HalfZ, 5.0, 30000.0, 1.0, "m", Span, true))
                LogSpan(State, "INFLUENCE", Source.Name.c_str(), "Box half-length Z", Source.HalfZ);
        }
        const char*         FalloffOptions[4] = { "Smooth", "Linear", "Inverse²", "Hard" };
        static const char*  FalloffValues[4]  = { "Smooth", "Linear", "InverseSquare", "None" };
        if (SegmentedRow::Construct(Column, "##Falloff", "Boundary falloff", FalloffOptions, 4, Source.Falloff, true, true))
            LogForceFieldWorkspaceValue(State, "INFLUENCE", Source.Name.c_str(), "Boundary falloff",
                                     FalloffValues[Source.Falloff]);
    }
    EndInspectorSection(Column);

    char StrengthTrim[32]{}, StrengthStatus[64]{};
    FormatForceFieldTrimmed(Source.Params[0], 1, StrengthTrim, sizeof(StrengthTrim));
    std::snprintf(StrengthStatus, sizeof(StrengthStatus), "%s %s", StrengthTrim, Unit);
    const bool StrengthOpen = BeginInspectorSection(Column, State, "strength", "Strength & Direction", Type.Glyph,
                                                    StrengthStatus, State.CardStrength);
    if (StrengthOpen)
    {
        if (Type.BearingKey != nullptr)
        {
            const bool Track  = std::strcmp(Type.BearingKey, "TrackBearing") == 0;
            double&    Bearing = Track ? Source.TrackBearing : Source.Bearing;
            if (PolarDial::Construct(Column, "##Bearing", Bearing))
                LogFigure(State, "FORCES", Source.Name.c_str(), Type.BearingLabel, Bearing, 0, "°");
        }
        if (Type.Spin)
        {
            int         SpinIndex   = Source.Spin < 0 ? 1 : 0;
            const char* SpinOptions[2] = { "Cyclonic (+)", "Anticyclonic (−)" };
            if (SegmentedRow::Construct(Column, "##Spin", "Rotation", SpinOptions, 2, SpinIndex, true, true))
            {
                Source.Spin = SpinIndex == 0 ? 1 : -1;
                LogForceFieldWorkspaceValue(State, "FORCES", Source.Name.c_str(), "Rotation", SpinIndex == 0 ? "1" : "-1");
            }
        }
        for (int Param = 0; Param < Type.ParamCount && Param < 7; ++Param)
        {
            const ForceFieldWorkspaceTypeParam& Spec = Type.Params[Param];
            char                           SliderId[32]{};
            std::snprintf(SliderId, sizeof(SliderId), "##Param%d", Param);
            SliderPillOptions Opts;
            Opts.Digits      = Spec.Digits;
            Opts.Logarithmic = Spec.Distance;
            Opts.Distance     = Spec.Distance;
            const bool ParamMoved = SliderPill::Construct(Column, SliderId, Spec.Label, Source.Params[Param], Spec.Minimum,
                                                          Spec.Maximum, Spec.Step, Spec.Unit, Opts, true);
            char ParamRect[48]{};
            std::snprintf(ParamRect, sizeof(ParamRect), "Inspector/Param%d", Param);
            RecordForceFieldWorkspaceRect(State, ParamRect, ImGui::GetItemRectMin(), ImGui::GetItemRectMax());
            if (ParamMoved)
            {
                if (Spec.Key != nullptr && std::strcmp(Spec.Key, "Height") == 0) Source.Height = Source.Params[Param];
                if (Spec.Distance) LogSpan(State, "FORCES", Source.Name.c_str(), Spec.Label, Source.Params[Param]);
                else LogFigure(State, "FORCES", Source.Name.c_str(), Spec.Label, Source.Params[Param], Spec.Digits, Spec.Unit);
            }
        }
    }
    EndInspectorSection(Column);

    const bool TimingOpen = BeginInspectorSection(Column, State, "timing", "Timing & Receivers", "StudioFieldClock",
                                                  QueryForceFieldActivationName(Source.Activation), State.CardTiming);
    if (TimingOpen)
    {
        const char* ActivationOptions[3] = { "Always", "Window", "Trigger" };
        if (SegmentedRow::Construct(Column, "##Activation", "Activation mode", ActivationOptions, 3, Source.Activation, true,
                                    true))
            LogForceFieldWorkspaceValue(State, "TIMELINE", Source.Name.c_str(), "Activation mode",
                                     QueryForceFieldActivationName(Source.Activation));
        if (Source.Activation != ForceFieldActivationAlways)
        {
            if (Source.Activation == ForceFieldActivationWindow)
            {
                if (SliderPill::Construct(Column, "##Begins", "Begins", Source.Begins, 0.0, 120.0, 0.5, "s"))
                    LogFigure(State, "TIMELINE", Source.Name.c_str(), "Begins", Source.Begins, 1, "s");
                if (SliderPill::Construct(Column, "##Repeats", "Repeats (0 = once)", Source.Repeats, 0.0, 180.0, 1.0, "s"))
                    LogFigure(State, "TIMELINE", Source.Name.c_str(), "Repeats (0 = once)", Source.Repeats, 0, "s");
            }
            if (SliderPill::Construct(Column, "##Lasts", "Duration (0 = forever)", Source.Lasts, 0.0, 120.0, 0.5, "s"))
                LogFigure(State, "TIMELINE", Source.Name.c_str(), "Duration (0 = forever)", Source.Lasts, 1, "s");
            SliderPillOptions Ramp;
            Ramp.Digits = 2;
            if (SliderPill::Construct(Column, "##RampIn", "Ramp in", Source.RampIn, 0.0, 10.0, 0.1, "s", Ramp, true))
                LogFigure(State, "TIMELINE", Source.Name.c_str(), "Ramp in", Source.RampIn, 2, "s");
            if (SliderPill::Construct(Column, "##RampOut", "Ramp out", Source.RampOut, 0.0, 10.0, 0.1, "s", Ramp, true))
                LogFigure(State, "TIMELINE", Source.Name.c_str(), "Ramp out", Source.RampOut, 2, "s");
            if (Source.Activation == ForceFieldActivationTrigger)
            {
                const ActionItem Fire[1] = { { "FIRE PULSE NOW", "StudioFieldZap", ActionTone::Accent } };
                if (ActionRow::Construct(Column, "##Fire", Fire, 1) == 0 && FireForceFieldWorkspaceSource(State, Index))
                    Toast::Show("Force source fired on the timeline");
            }
        }
        const char* ChannelOptions[7] = { QueryForceFieldChannelLabel(0), QueryForceFieldChannelLabel(1),
                                          QueryForceFieldChannelLabel(2), QueryForceFieldChannelLabel(3),
                                          QueryForceFieldChannelLabel(4), QueryForceFieldChannelLabel(5),
                                          QueryForceFieldChannelLabel(6) };
        std::string Restriction;
        for (int Index = 0; Index < 7; ++Index)
        {
            if (!Source.Acts[Index]) continue;
            if (!Restriction.empty()) Restriction += ", ";
            Restriction += QueryForceFieldChannel(Index);
        }
        char Detail[192]{};
        if (!Restriction.empty()) std::snprintf(Detail, sizeof(Detail), "Restricted to %s", Restriction.c_str());
        else std::snprintf(Detail, sizeof(Detail), "%s", "Acts on all enabled receivers within influence.");
        if (ChipToggles::Construct(Column, "##Acts", "Filter receivers (empty = all enabled)", ChannelOptions, Source.Acts, 7,
                                   Detail))
            LogChannels(State, "FORCES", Source.Name.c_str(), "Filter receivers (empty = all enabled)", Source.Acts);
    }
    EndInspectorSection(Column);
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    INSPECTOR ROOT
//------------------------------------------------------------------------------------------------------------------------

void ConstructForceFieldWorkspaceInspector(ForceFieldWorkspaceState& State, const EditorTypefaces& Faces, ControlColumn& Column)
{
    (void)Faces;
    if (State.Selected == ForceFieldWorkspaceState::SelectedWind) WindPage(State, Column);
    else if (State.Selected >= 0 && static_cast<size_t>(State.Selected) < State.Sources.size()) SourcePage(State, Column, State.Selected);
    else FieldPage(State, Column);
}

} // namespace Frontier
