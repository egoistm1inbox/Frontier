/*==========================================================================================================================================
                                                             POLARDIAL.CPP
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js PolarDial: the 160 px bearing compass (r58 + r30 rings, cardinal ticks, flow needle,
//    lime pip) with a "deg° COMPASS" meta line. Dragging the dial writes whole degrees (0 = north, clockwise).

#include "Engine/Interface/Controls/PolarDial.h"

#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/GlyphRun.h"
#include "Engine/Interface/InspectorControls.h"

#include <cmath>
#include <cstdio>

namespace Frontier
{

namespace
{

constexpr const char* CompassPoints[16] = { "N",  "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                                            "S",  "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW" };
constexpr float       PiSingle          = 3.14159265358979f;

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    POLAR DIAL
//------------------------------------------------------------------------------------------------------------------------

const char* PolarDial::ResolveCompassPoint(double Degrees) noexcept
{
    const double Wrapped = std::fmod(Degrees, 360.0);
    const double Positive = Wrapped < 0.0 ? Wrapped + 360.0 : Wrapped;
    return CompassPoints[static_cast<int>(std::round(Positive / 22.5)) % 16];
}

bool PolarDial::Construct(ControlColumn& Column, const char* Id, double& InOutDegrees, const char* Caption, bool Enabled,
                          const char* Tooltip)
{
    const EditorTypefaces& Faces    = Column.QueryFaces();
    ImDrawList* const      DrawList = Column.QueryDrawList();
    const float            S        = Column.QueryScale();
    const float            Width    = Column.QueryWidth();
    const float            Fade     = Enabled ? 1.0f : 0.42f;
    bool                   Moved    = false;

    // 📝 .polar-dial-wrap: centred dial, padding 6/0/8, meta 10.5 px with a 4 px gap.
    constexpr float Dial     = 160.0f;
    constexpr float MetaTall = 15.0f;
    const ImVec2    Top      = Column.Space(6.0f + Dial + 4.0f + MetaTall + 8.0f, 0.0f, 0.0f);
    const ImVec2    Centre(Top.x + 0.5f * Width, Top.y + 6.0f * S + 0.5f * Dial * S);

    ImGui::PushID(Id);
    ImGui::SetCursorScreenPos(ImVec2(Centre.x - 0.5f * Dial * S, Centre.y - 0.5f * Dial * S));
    if (!Enabled) ImGui::BeginDisabled();
    ImGui::InvisibleButton("##Dial", ImVec2(Dial * S, Dial * S), ImGuiButtonFlags_EnableNav);
    if (ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled)) ControlColumn::ConstructTooltip(Tooltip);
    if (Enabled && ImGui::IsItemActive() && ImGui::IsMouseDown(ImGuiMouseButton_Left))
    {
        const ImVec2 Mouse = ImGui::GetIO().MousePos;
        const double Degrees = std::fmod((std::atan2(Mouse.x - Centre.x, -(Mouse.y - Centre.y)) * 180.0 / PiSingle) + 360.0, 360.0);
        const double Next    = std::round(Degrees);
        if (Next != InOutDegrees)
        {
            InOutDegrees = Next;
            Moved        = true;
        }
    }
    if (!Enabled) ImGui::EndDisabled();
    ImGui::PopID();

    DrawList->AddCircle(Centre, 58.0f * S, FadeColour(ResolveCssColour(0xFFFFFF1F), Fade), 64, S);
    DrawList->AddCircle(Centre, 58.0f * 0.52f * S, FadeColour(ResolveCssColour(0xFFFFFF1F), Fade), 48, S);
    const char*        Ticks[4] = { "N", "S", "E", "W" };
    const ImVec2       Anchors[4] = { ImVec2(Centre.x, Centre.y - 58.0f * S - 6.0f * S), ImVec2(Centre.x, Centre.y + 58.0f * S + 4.0f * S),
                                      ImVec2(Centre.x + 58.0f * S + 4.0f * S, Centre.y - 5.0f * S),
                                      ImVec2(Centre.x - 58.0f * S - 4.0f * S, Centre.y - 5.0f * S) };
    const bool         Centred[4] = { true, true, false, false };
    for (int Tick = 0; Tick < 4; ++Tick)
    {
        const float Wide = GlyphRun::Measure(Column, Faces.Medium, 10.0f * S, Ticks[Tick]);
        const float X    = Centred[Tick] ? Anchors[Tick].x - 0.5f * Wide : (Tick == 2 ? Anchors[Tick].x : Anchors[Tick].x - Wide);
        (void)GlyphRun::Construct(Column, Faces.Medium, 10.0f * S, ImVec2(X, Anchors[Tick].y),
                                  FadeColour(ResolveCssColour(0x7E8694FF), Fade), Ticks[Tick]);
    }

    const float Angle = static_cast<float>(InOutDegrees) * PiSingle / 180.0f;
    const ImVec2 Tip(Centre.x + std::sin(Angle) * 58.0f * 0.85f * S, Centre.y - std::cos(Angle) * 58.0f * 0.85f * S);
    DrawList->AddLine(Centre, Tip, FadeColour(ResolveCssColour(0x8FD3C4FF), Fade), 2.4f * S);
    DrawList->AddCircleFilled(Tip, 4.5f * S, FadeColour(ResolveCssColour(0xD1F773FF), Fade), 24);

    char Meta[64]{};
    if (Caption != nullptr && Caption[0] != '\0') std::snprintf(Meta, sizeof(Meta), "%.0f° %s · %s", InOutDegrees, ResolveCompassPoint(InOutDegrees), Caption);
    else std::snprintf(Meta, sizeof(Meta), "%.0f° %s", InOutDegrees, ResolveCompassPoint(InOutDegrees));
    const float MetaWide = GlyphRun::Measure(Column, Faces.Regular, 10.5f * S, Meta);
    const float MetaTop  = Centre.y + 0.5f * Dial * S + 4.0f * S;
    (void)GlyphRun::Construct(Column, Faces.Regular, 10.5f * S,
                              ImVec2(Top.x + 0.5f * (Width - MetaWide), GlyphRun::ResolveBaseline(MetaTop, 10.5f * S, 1.4f)),
                              FadeColour(ResolveCssColour(0x848484FF), Fade), Meta);
    return Moved;
}

bool PolarDial::ConstructPanel(ControlColumn& Column, const char* Id, const char* Title, const char* Note, double& InOutDegrees,
                               const char* Caption, bool Enabled, const char* Tooltip)
{
    const EditorTypefaces& Faces = Column.QueryFaces();
    const float            S     = Column.QueryScale();
    const float            Fade  = Enabled ? 1.0f : 0.42f;

    if (Title != nullptr && Title[0] != '\0')
    {
        const ImVec2 TitleTop = Column.Space(12.0f * 1.3f, 0.0f, 2.0f);
        (void)GlyphRun::Construct(Column, Faces.Medium, 12.0f * S,
                                  ImVec2(TitleTop.x, GlyphRun::ResolveBaseline(TitleTop.y, 12.0f * S, 1.3f)),
                                  FadeColour(ResolveCssColour(0xE4E4E4FF), Fade), Title);
    }
    const bool Moved = Construct(Column, Id, InOutDegrees, Caption, Enabled, Tooltip);
    if (Note != nullptr && Note[0] != '\0')
    {
        const ImVec2 NoteTop = Column.Space(10.5f * 1.4f, 2.0f, 10.0f);
        (void)GlyphRun::Construct(Column, Faces.Regular, 10.5f * S,
                                  ImVec2(NoteTop.x, GlyphRun::ResolveBaseline(NoteTop.y, 10.5f * S, 1.4f)),
                                  FadeColour(ResolveCssColour(0x757575FF), Fade), Note);
    }
    return Moved;
}

} // namespace Frontier
