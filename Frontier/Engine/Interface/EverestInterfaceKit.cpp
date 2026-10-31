/*==========================================================================================================================================
                                                        EVERESTINTERFACEKIT.CPP
==========================================================================================================================================*/
// 🧩 Pixel-accurate 1:1 VehicleHMI editor controls, cards, and vector instruments built on ControlKit and TypefaceRegistry.

#include "EverestInterfaceKit.h"

#if defined(FRONTIER_WITH_INTERFACE_SDK)

#include "Engine/Interface/ControlKit.h"
#include "Engine/Interface/DropdownControls.h"

#include <imgui_internal.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace Frontier
{

namespace
{

constexpr float PiConstant = 3.14159265358979323846f;

ColorQuad MixQuad(ColorQuad Left, ColorQuad Right, float Factor) noexcept
{
    return ColorQuad{
        Left.Red + (Right.Red - Left.Red) * Factor,
        Left.Green + (Right.Green - Left.Green) * Factor,
        Left.Blue + (Right.Blue - Left.Blue) * Factor,
        Left.Alpha + (Right.Alpha - Left.Alpha) * Factor,
    };
}

ImU32 QuadToInk(ColorQuad Quad, float AlphaMultiplier = 1.0f) noexcept
{
    const int Red   = std::clamp(static_cast<int>(std::lround(Quad.Red * 255.0f)), 0, 255);
    const int Green = std::clamp(static_cast<int>(std::lround(Quad.Green * 255.0f)), 0, 255);
    const int Blue  = std::clamp(static_cast<int>(std::lround(Quad.Blue * 255.0f)), 0, 255);
    const int Alpha = std::clamp(static_cast<int>(std::lround(Quad.Alpha * AlphaMultiplier * 255.0f)), 0, 255);
    return KitInkRgba(Red, Green, Blue, Alpha);
}

void PaintRoundedVerticalGradient(ImDrawList *Canvas, ImVec2 Minimum, ImVec2 Maximum, ImU32 TopColour,
                                  ImU32 BottomColour, float CornerRadius)
{
    const int FirstVertex = Canvas->VtxBuffer.Size;
    Canvas->AddRectFilled(Minimum, Maximum, IM_COL32_WHITE, CornerRadius);
    const int EndVertex = Canvas->VtxBuffer.Size;
    if (EndVertex > FirstVertex)
    {
        ImGui::ShadeVertsLinearColorGradientKeepAlpha(Canvas, FirstVertex, EndVertex, Minimum,
                                                      ImVec2(Minimum.x, Maximum.y), TopColour, BottomColour);
    }
}

float PaintWrappedCopy(ImDrawList *Canvas, ImFont *Font, float FontSize, ImVec2 Origin, float WrapWidth,
                       float LineAdvance, ImU32 Colour, const char *CopyText)
{
    if (CopyText == nullptr || CopyText[0] == '\0')
    {
        return 0.0f;
    }
    float       CursorY = Origin.y;
    const char *Cursor  = CopyText;
    while (*Cursor != '\0')
    {
        while (*Cursor == ' ')
        {
            ++Cursor;
        }
        if (*Cursor == '\0')
        {
            break;
        }
        const char *LineEnd       = Cursor;
        const char *LastBreakable = nullptr;
        while (*LineEnd != '\0' && *LineEnd != '\n')
        {
            if (*LineEnd == ' ')
            {
                LastBreakable = LineEnd;
            }
            const float CandidateWidth = KitTextWidth(Font, FontSize, Cursor, LineEnd + 1);
            if (WrapWidth > 20.0f && CandidateWidth > WrapWidth && LineEnd > Cursor)
            {
                if (LastBreakable != nullptr && LastBreakable > Cursor)
                {
                    LineEnd = LastBreakable;
                }
                break;
            }
            ++LineEnd;
        }
        if (Canvas != nullptr && LineEnd > Cursor)
        {
            KitDrawText(Canvas, Font, FontSize, ImVec2(Origin.x, CursorY), Colour, Cursor, LineEnd);
        }
        CursorY += LineAdvance;
        Cursor = LineEnd;
        if (*Cursor == '\n')
        {
            ++Cursor;
        }
    }
    return CursorY - Origin.y;
}

std::string ConvertToUppercase(const char *InputText)
{
    std::string Upper;
    if (InputText == nullptr)
    {
        return Upper;
    }
    for (const char *Cursor = InputText; *Cursor != '\0'; ++Cursor)
    {
        const unsigned char Character = static_cast<unsigned char>(*Cursor);
        if (Character >= 'a' && Character <= 'z')
        {
            Upper.push_back(static_cast<char>(Character - 'a' + 'A'));
        }
        else
        {
            Upper.push_back(static_cast<char>(Character));
        }
    }
    return Upper;
}

ImDrawListSplitter &ActiveCardSplitter() noexcept
{
    static ImDrawListSplitter Splitter;
    return Splitter;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                 TOKEN & GLYPH ACCESS
//------------------------------------------------------------------------------------------------------------------------

ImU32 ConvertRgbToInk(uint32_t Rgb, int Alpha) noexcept
{
    return KitInkRgba(static_cast<int>((Rgb >> 16u) & 0xffu), static_cast<int>((Rgb >> 8u) & 0xffu),
                      static_cast<int>(Rgb & 0xffu), Alpha);
}

EverestSurfaceTokens ResolveEverestTokens() noexcept
{
    const ControlKitPalette &Palette = ControlKit::Palette();
    const float MaxChannel = std::max({Palette.Panel.Red, Palette.Panel.Green, Palette.Panel.Blue});
    const float MinChannel = std::min({Palette.Panel.Red, Palette.Panel.Green, Palette.Panel.Blue});
    const bool  DefaultDark =
        !Palette.LightSurface && (MaxChannel - MinChannel) < 0.025f && Palette.Panel.Red >= 0.04f &&
        Palette.Panel.Red <= 0.16f;

    EverestSurfaceTokens Tokens;
    Tokens.ScaleFactor = 1.0f;

    if (DefaultDark)
    {
        // Exact 1:1 FrontierEditor.css :root design tokens.
        Tokens.Ground         = KitInkHex(0x101010);
        Tokens.Column         = KitInkHex(0x161616);
        Tokens.ColumnHeader   = KitInkHex(0x181818);
        Tokens.StatusStrip    = KitInkHex(0x0d0d0d);
        Tokens.CardTop        = KitInkHex(0x222222);
        Tokens.CardBottom     = KitInkHex(0x1f1f1f);
        Tokens.Inset          = KitInkHex(0x171717);
        Tokens.StatCell       = KitInkHex(0x181818);
        Tokens.ReadoutBox     = KitInkHex(0x151515);
        Tokens.RowHover       = KitInkRgba(255, 255, 255, 11);
        Tokens.RowSelectedTop = KitInkHex(0x333333);
        Tokens.RowSelectedBot = KitInkHex(0x292929);
        Tokens.Edge           = KitInkHex(0x2a2a2a);
        Tokens.EdgeSubtle     = KitInkHex(0x232323);
        Tokens.TextPrimary    = KitInkHex(0xdcdcdc);
        Tokens.TextSoft       = KitInkHex(0xb4b4b4);
        Tokens.TextMuted      = KitInkHex(0x7d7d7d);
        Tokens.TextFaint      = KitInkHex(0x5c5c5c);
        Tokens.ActivePillFill = KitInkHex(0xececec);
        Tokens.ActivePillInk  = KitInkHex(0x121212);
        Tokens.AccentNeutral  = KitInkHex(0xc5c5c5);
        Tokens.LiveGreen      = KitInkHex(0x3ec46d);
        Tokens.LiveGreenDim   = KitInkRgba(62, 196, 109, 36);
        Tokens.WarmAmber      = KitInkHex(0xe0a24a);
        Tokens.WarmAmberDim   = KitInkRgba(224, 162, 74, 36);
        Tokens.DangerCoral    = KitInkHex(0xff6b6b);
        Tokens.DangerCoralDim = KitInkRgba(255, 107, 107, 34);
        Tokens.PropSwitchOn   = KitInkHex(0x2f6d45);
        Tokens.PropSwitchOff  = KitInkHex(0xcc7673);
        return Tokens;
    }

    // Live ControlCentre theme adaptation (OLED, Light, Sepia, Midnight, Slate, Graphite, Nordic).
    // Never derive card surfaces from Palette.Raised (which ControlKit binds to #FFFFFF Notch button ink).
    const ColorQuad CardLift = MixQuad(Palette.Card, Palette.CardSub, 0.72f);
    const ColorQuad RowLift  = MixQuad(Palette.CardSub, Palette.Text, Palette.LightSurface ? 0.08f : 0.10f);
    const ColorQuad EdgeQuad = MixQuad(Palette.CardSub, Palette.TextDim, 0.28f);

    Tokens.Ground         = QuadToInk(MixQuad(Palette.Field, Palette.Panel, 0.45f));
    Tokens.Column         = QuadToInk(Palette.Panel);
    Tokens.ColumnHeader   = QuadToInk(Palette.Card);
    Tokens.StatusStrip    = QuadToInk(Palette.TabBackground);
    Tokens.CardTop        = QuadToInk(CardLift);
    Tokens.CardBottom     = QuadToInk(Palette.Card);
    Tokens.Inset          = QuadToInk(Palette.Inset);
    Tokens.StatCell       = QuadToInk(Palette.Inset);
    Tokens.ReadoutBox     = QuadToInk(MixQuad(Palette.Inset, Palette.Field, 0.35f));
    Tokens.RowHover       = Palette.LightSurface ? KitInkRgba(0, 0, 0, 14) : KitInkRgba(255, 255, 255, 14);
    Tokens.RowSelectedTop = QuadToInk(RowLift);
    Tokens.RowSelectedBot = QuadToInk(Palette.CardSub);
    Tokens.Edge           = QuadToInk(EdgeQuad);
    Tokens.EdgeSubtle     = QuadToInk(MixQuad(Palette.Card, Palette.CardSub, 0.55f));
    Tokens.TextPrimary    = QuadToInk(Palette.Text);
    Tokens.TextSoft       = QuadToInk(MixQuad(Palette.Text, Palette.TextDim, 0.32f));
    Tokens.TextMuted      = QuadToInk(Palette.TextDim);
    Tokens.TextFaint      = QuadToInk(Palette.TextFaint);
    Tokens.ActivePillFill = QuadToInk(Palette.Accent);
    Tokens.ActivePillInk  = QuadToInk(Palette.AccentInk);
    Tokens.AccentNeutral  = QuadToInk(Palette.Accent);
    Tokens.LiveGreen      = QuadToInk(Palette.Ok);
    Tokens.LiveGreenDim   = QuadToInk(Palette.Ok, 0.16f);
    Tokens.WarmAmber      = QuadToInk(Palette.Warning);
    Tokens.WarmAmberDim   = QuadToInk(Palette.Warning, 0.16f);
    Tokens.DangerCoral    = QuadToInk(Palette.Danger);
    Tokens.DangerCoralDim = QuadToInk(Palette.Danger, 0.16f);
    Tokens.PropSwitchOn   = QuadToInk(Palette.Ok, 0.72f);
    Tokens.PropSwitchOff  = QuadToInk(Palette.Danger, 0.72f);
    return Tokens;
}

void PaintTrackedLabel(ImDrawList *Canvas, ImFont *Font, float FontSize, ImVec2 Origin, ImU32 Colour,
                       const char *Caption, float TrackingPixels)
{
    if (Canvas == nullptr || Caption == nullptr || Caption[0] == '\0')
    {
        return;
    }
    ImFont *ResolvedFont = Font != nullptr ? Font : ImGui::GetFont();
    float   CursorX      = Origin.x;
    const char *Cursor   = Caption;
    const char *End      = Caption + std::strlen(Caption);
    while (Cursor < End)
    {
        unsigned int Codepoint = 0;
        const int    Consumed  = ImTextCharFromUtf8(&Codepoint, Cursor, End);
        if (Consumed <= 0 || Codepoint == 0)
        {
            break;
        }
        const char *Next = Cursor + Consumed;
        KitDrawText(Canvas, ResolvedFont, FontSize, ImVec2(CursorX, Origin.y), Colour, Cursor, Next);
        CursorX += KitTextWidth(ResolvedFont, FontSize, Cursor, Next) + TrackingPixels;
        Cursor = Next;
    }
}

void PaintChevronGlyph(ImDrawList *Canvas, ImVec2 Centre, float HalfExtent, int DirectionIndex, ImU32 Colour)
{
    if (Canvas == nullptr)
    {
        return;
    }
    const float Stroke = 1.45f;
    if (DirectionIndex == 0) // Down chevron (expanded / dropdown)
    {
        Canvas->AddLine(ImVec2(Centre.x - HalfExtent, Centre.y - HalfExtent * 0.45f),
                        ImVec2(Centre.x, Centre.y + HalfExtent * 0.55f), Colour, Stroke);
        Canvas->AddLine(ImVec2(Centre.x, Centre.y + HalfExtent * 0.55f),
                        ImVec2(Centre.x + HalfExtent, Centre.y - HalfExtent * 0.45f), Colour, Stroke);
    }
    else if (DirectionIndex == 1) // Right chevron (collapsed / breadcrumb)
    {
        Canvas->AddLine(ImVec2(Centre.x - HalfExtent * 0.45f, Centre.y - HalfExtent),
                        ImVec2(Centre.x + HalfExtent * 0.55f, Centre.y), Colour, Stroke);
        Canvas->AddLine(ImVec2(Centre.x + HalfExtent * 0.55f, Centre.y),
                        ImVec2(Centre.x - HalfExtent * 0.45f, Centre.y + HalfExtent), Colour, Stroke);
    }
    else // Left chevron (back button)
    {
        Canvas->AddLine(ImVec2(Centre.x + HalfExtent * 0.45f, Centre.y - HalfExtent),
                        ImVec2(Centre.x - HalfExtent * 0.55f, Centre.y), Colour, Stroke);
        Canvas->AddLine(ImVec2(Centre.x - HalfExtent * 0.55f, Centre.y),
                        ImVec2(Centre.x + HalfExtent * 0.45f, Centre.y + HalfExtent), Colour, Stroke);
    }
}

void PaintEverestGlyph(ImDrawList *Canvas, EverestGlyphCategory Glyph, ImVec2 Centre, float Extent, ImU32 Colour)
{
    const float Half   = Extent * 0.5f;
    const float Stroke = 1.45f;
    switch (Glyph)
    {
        case EverestGlyphCategory::Sun:
        case EverestGlyphCategory::Sunrise:
        {
            Canvas->AddCircle(Centre, Half * 0.44f, Colour, 16, Stroke);
            for (int RayIndex = 0; RayIndex < 8; ++RayIndex)
            {
                const float Angle = static_cast<float>(RayIndex) * (PiConstant * 0.25f);
                Canvas->AddLine(ImVec2(Centre.x + std::cos(Angle) * Half * 0.65f,
                                       Centre.y + std::sin(Angle) * Half * 0.65f),
                                ImVec2(Centre.x + std::cos(Angle) * Half * 0.94f,
                                       Centre.y + std::sin(Angle) * Half * 0.94f),
                                Colour, Stroke);
            }
            break;
        }
        case EverestGlyphCategory::Zap:
        {
            const ImVec2 Poly[6] = {
                ImVec2(Centre.x + Half * 0.12f, Centre.y - Half * 0.92f),
                ImVec2(Centre.x - Half * 0.58f, Centre.y + Half * 0.08f),
                ImVec2(Centre.x - Half * 0.04f, Centre.y + Half * 0.08f),
                ImVec2(Centre.x - Half * 0.14f, Centre.y + Half * 0.92f),
                ImVec2(Centre.x + Half * 0.58f, Centre.y - Half * 0.08f),
                ImVec2(Centre.x + Half * 0.04f, Centre.y - Half * 0.08f),
            };
            Canvas->AddPolyline(Poly, 6, Colour, ImDrawFlags_Closed, Stroke);
            break;
        }
        case EverestGlyphCategory::Car:
        {
            Canvas->AddRect(ImVec2(Centre.x - Half * 0.85f, Centre.y - Half * 0.12f),
                            ImVec2(Centre.x + Half * 0.85f, Centre.y + Half * 0.44f), Colour, 2.5f, 0, Stroke);
            Canvas->AddLine(ImVec2(Centre.x - Half * 0.55f, Centre.y - Half * 0.12f),
                            ImVec2(Centre.x - Half * 0.32f, Centre.y - Half * 0.56f), Colour, Stroke);
            Canvas->AddLine(ImVec2(Centre.x - Half * 0.32f, Centre.y - Half * 0.56f),
                            ImVec2(Centre.x + Half * 0.34f, Centre.y - Half * 0.56f), Colour, Stroke);
            Canvas->AddLine(ImVec2(Centre.x + Half * 0.34f, Centre.y - Half * 0.56f),
                            ImVec2(Centre.x + Half * 0.58f, Centre.y - Half * 0.12f), Colour, Stroke);
            Canvas->AddCircleFilled(ImVec2(Centre.x - Half * 0.48f, Centre.y + Half * 0.54f), 2.1f, Colour);
            Canvas->AddCircleFilled(ImVec2(Centre.x + Half * 0.48f, Centre.y + Half * 0.54f), 2.1f, Colour);
            break;
        }
        case EverestGlyphCategory::Eye:
        case EverestGlyphCategory::EyeOff:
        {
            Canvas->AddBezierQuadratic(ImVec2(Centre.x - Half * 0.9f, Centre.y),
                                       ImVec2(Centre.x, Centre.y - Half * 0.78f),
                                       ImVec2(Centre.x + Half * 0.9f, Centre.y), Colour, Stroke, 12);
            Canvas->AddBezierQuadratic(ImVec2(Centre.x - Half * 0.9f, Centre.y),
                                       ImVec2(Centre.x, Centre.y + Half * 0.78f),
                                       ImVec2(Centre.x + Half * 0.9f, Centre.y), Colour, Stroke, 12);
            Canvas->AddCircle(Centre, Half * 0.24f, Colour, 12, Stroke);
            if (Glyph == EverestGlyphCategory::EyeOff)
            {
                Canvas->AddLine(ImVec2(Centre.x - Half * 0.78f, Centre.y + Half * 0.72f),
                                ImVec2(Centre.x + Half * 0.78f, Centre.y - Half * 0.72f), Colour, Stroke);
            }
            break;
        }
        case EverestGlyphCategory::Activity:
        case EverestGlyphCategory::Gauge:
        {
            const ImVec2 Poly[5] = {
                ImVec2(Centre.x - Half * 0.88f, Centre.y + Half * 0.1f),
                ImVec2(Centre.x - Half * 0.34f, Centre.y + Half * 0.1f),
                ImVec2(Centre.x - Half * 0.10f, Centre.y - Half * 0.72f),
                ImVec2(Centre.x + Half * 0.22f, Centre.y + Half * 0.68f),
                ImVec2(Centre.x + Half * 0.88f, Centre.y + Half * 0.05f),
            };
            Canvas->AddPolyline(Poly, 5, Colour, 0, Stroke);
            break;
        }
        case EverestGlyphCategory::Flame:
        {
            Canvas->AddCircle(ImVec2(Centre.x, Centre.y + Half * 0.16f), Half * 0.56f, Colour, 16, Stroke);
            Canvas->AddLine(ImVec2(Centre.x, Centre.y - Half * 0.86f),
                            ImVec2(Centre.x - Half * 0.34f, Centre.y - Half * 0.10f), Colour, Stroke);
            Canvas->AddLine(ImVec2(Centre.x, Centre.y - Half * 0.86f),
                            ImVec2(Centre.x + Half * 0.34f, Centre.y - Half * 0.10f), Colour, Stroke);
            break;
        }
        case EverestGlyphCategory::GridLattice:
        case EverestGlyphCategory::LayoutGrid:
        case EverestGlyphCategory::Boxes:
        {
            Canvas->AddRect(ImVec2(Centre.x - Half * 0.80f, Centre.y - Half * 0.80f),
                            ImVec2(Centre.x - Half * 0.08f, Centre.y - Half * 0.08f), Colour, 1.5f, 0, Stroke);
            Canvas->AddRect(ImVec2(Centre.x + Half * 0.08f, Centre.y - Half * 0.80f),
                            ImVec2(Centre.x + Half * 0.80f, Centre.y - Half * 0.08f), Colour, 1.5f, 0, Stroke);
            Canvas->AddRect(ImVec2(Centre.x - Half * 0.80f, Centre.y + Half * 0.08f),
                            ImVec2(Centre.x - Half * 0.08f, Centre.y + Half * 0.80f), Colour, 1.5f, 0, Stroke);
            Canvas->AddRect(ImVec2(Centre.x + Half * 0.08f, Centre.y + Half * 0.08f),
                            ImVec2(Centre.x + Half * 0.80f, Centre.y + Half * 0.80f), Colour, 1.5f, 0, Stroke);
            break;
        }
        case EverestGlyphCategory::CircleDot:
        case EverestGlyphCategory::Aperture:
        case EverestGlyphCategory::Orbit:
        {
            Canvas->AddCircle(Centre, Half * 0.78f, Colour, 20, Stroke);
            Canvas->AddCircleFilled(Centre, Half * 0.24f, Colour);
            break;
        }
        case EverestGlyphCategory::CloudFog:
        case EverestGlyphCategory::Wind:
        {
            Canvas->AddLine(ImVec2(Centre.x - Half * 0.82f, Centre.y - Half * 0.32f),
                            ImVec2(Centre.x + Half * 0.56f, Centre.y - Half * 0.32f), Colour, Stroke);
            Canvas->AddLine(ImVec2(Centre.x - Half * 0.82f, Centre.y + Half * 0.08f),
                            ImVec2(Centre.x + Half * 0.84f, Centre.y + Half * 0.08f), Colour, Stroke);
            Canvas->AddLine(ImVec2(Centre.x - Half * 0.52f, Centre.y + Half * 0.48f),
                            ImVec2(Centre.x + Half * 0.62f, Centre.y + Half * 0.48f), Colour, Stroke);
            break;
        }
        case EverestGlyphCategory::Monitor:
        case EverestGlyphCategory::Camera:
        {
            Canvas->AddRect(ImVec2(Centre.x - Half * 0.84f, Centre.y - Half * 0.64f),
                            ImVec2(Centre.x + Half * 0.84f, Centre.y + Half * 0.38f), Colour, 2.0f, 0, Stroke);
            Canvas->AddLine(ImVec2(Centre.x - Half * 0.36f, Centre.y + Half * 0.74f),
                            ImVec2(Centre.x + Half * 0.36f, Centre.y + Half * 0.74f), Colour, Stroke);
            break;
        }
        case EverestGlyphCategory::Layers:
        case EverestGlyphCategory::Gem:
        {
            const ImVec2 Diamond[4] = {
                ImVec2(Centre.x, Centre.y - Half * 0.76f),
                ImVec2(Centre.x + Half * 0.84f, Centre.y - Half * 0.16f),
                ImVec2(Centre.x, Centre.y + Half * 0.40f),
                ImVec2(Centre.x - Half * 0.84f, Centre.y - Half * 0.16f),
            };
            Canvas->AddPolyline(Diamond, 4, Colour, ImDrawFlags_Closed, Stroke);
            Canvas->AddLine(ImVec2(Centre.x - Half * 0.80f, Centre.y + Half * 0.24f),
                            ImVec2(Centre.x, Centre.y + Half * 0.78f), Colour, Stroke);
            Canvas->AddLine(ImVec2(Centre.x, Centre.y + Half * 0.78f),
                            ImVec2(Centre.x + Half * 0.80f, Centre.y + Half * 0.24f), Colour, Stroke);
            break;
        }
        default:
        {
            Canvas->AddCircle(Centre, Half * 0.68f, Colour, 16, Stroke);
            Canvas->AddLine(ImVec2(Centre.x - Half * 0.32f, Centre.y),
                            ImVec2(Centre.x + Half * 0.32f, Centre.y), Colour, Stroke);
            Canvas->AddLine(ImVec2(Centre.x, Centre.y - Half * 0.32f),
                            ImVec2(Centre.x, Centre.y + Half * 0.32f), Colour, Stroke);
            break;
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 INSPECTOR CHROME
//------------------------------------------------------------------------------------------------------------------------

bool ConstructInspectorTopBar(const KitFaces &Faces, const EverestSurfaceTokens &Tokens, ImVec2 Origin, float Width,
                              const char *GroupCaption, const char *StudioButtonCaption)
{
    ImDrawList *Canvas     = ImGui::GetWindowDrawList();
    const float BarHeight  = 44.0f;
    const float CentreY    = Origin.y + BarHeight * 0.5f;
    const float LeftX      = Origin.x + 16.0f;
    const float RightLimit = Origin.x + Width - 16.0f;

    Canvas->AddRectFilled(Origin, ImVec2(Origin.x + Width, Origin.y + BarHeight), Tokens.ColumnHeader);
    Canvas->AddLine(ImVec2(Origin.x, Origin.y + BarHeight - 1.0f),
                    ImVec2(Origin.x + Width, Origin.y + BarHeight - 1.0f), Tokens.Edge);

    KitDrawText(Canvas, Faces.Medium, 12.5f, ImVec2(LeftX, CentreY - 6.5f), Tokens.TextMuted, "Inspector");
    const float WordWidth = KitTextWidth(Faces.Medium, 12.5f, "Inspector");
    PaintChevronGlyph(Canvas, ImVec2(LeftX + WordWidth + 8.5f, CentreY + 0.5f), 3.0f, 1, Tokens.TextFaint);
    KitDrawText(Canvas, Faces.Medium, 12.5f, ImVec2(LeftX + WordWidth + 16.0f, CentreY - 6.5f), Tokens.TextPrimary,
                GroupCaption != nullptr ? GroupCaption : "Scene");

    if (StudioButtonCaption != nullptr && StudioButtonCaption[0] != '\0')
    {
        const float ButtonWidth  = KitTextWidth(Faces.Medium, 11.5f, StudioButtonCaption) + 24.0f;
        const float ButtonHeight = 26.0f;
        const ImVec2 ButtonMin(RightLimit - ButtonWidth, CentreY - ButtonHeight * 0.5f);
        bool Hovered = false;
        const bool Clicked = KitTarget("##InspectorOpenStudio", ButtonMin, ImVec2(ButtonWidth, ButtonHeight), Hovered,
                                       "Open dedicated authoring studio");
        KitPillSurface(Canvas, ButtonMin, ImVec2(ButtonMin.x + ButtonWidth, ButtonMin.y + ButtonHeight),
                       Hovered ? Tokens.RowSelectedTop : Tokens.LiveGreenDim, Tokens.LiveGreen, 999.0f);
        KitDrawText(Canvas, Faces.Medium, 11.5f, ImVec2(ButtonMin.x + 12.0f, CentreY - 5.75f), Tokens.LiveGreen,
                    StudioButtonCaption);
        return Clicked;
    }

    const char *LiveCaption = "Changes apply live";
    const float LiveWidth   = KitTextWidth(Faces.Regular, 11.5f, LiveCaption);
    KitDrawText(Canvas, Faces.Regular, 11.5f, ImVec2(RightLimit - LiveWidth, CentreY - 5.75f), Tokens.TextFaint,
                LiveCaption);
    return false;
}

bool ConstructInspectorIdentity(const KitFaces &Faces, const EverestSurfaceTokens &Tokens, ImVec2 Origin, float Width,
                                const char *EyebrowCaption, const char *TitleCaption, uint32_t AccentRgb,
                                bool &EnabledCondition, float &OutConsumedHeight)
{
    ImDrawList *Canvas     = ImGui::GetWindowDrawList();
    const float LeftX      = Origin.x + 16.0f;
    const float RightLimit = Origin.x + Width - 16.0f;
    const float TopY       = Origin.y + 14.0f;

    const std::string UpperEyebrow = ConvertToUppercase(EyebrowCaption);
    Canvas->AddRectFilled(ImVec2(LeftX, TopY + 1.0f), ImVec2(LeftX + 2.0f, TopY + 12.0f),
                          ConvertRgbToInk(AccentRgb), 1.0f);
    PaintTrackedLabel(Canvas, Faces.Medium, 10.5f, ImVec2(LeftX + 8.0f, TopY), Tokens.TextMuted, UpperEyebrow.c_str(),
                      10.5f * 0.11f);

    const float TitleY = TopY + 17.0f;
    KitDrawText(Canvas, Faces.Medium, 19.0f, ImVec2(LeftX, TitleY), Tokens.TextPrimary,
                TitleCaption != nullptr ? TitleCaption : "Record");

    const char *PillLabel  = EnabledCondition ? "Enabled" : "Hidden";
    const float PillWidth  = 12.0f + 7.0f + 7.0f + KitTextWidth(Faces.Medium, 11.5f, PillLabel) + 12.0f;
    const float PillHeight = 26.0f;
    const ImVec2 PillMin(RightLimit - PillWidth, TitleY - 2.0f);
    bool Hovered = false;
    const bool Clicked = KitTarget("##InspectorEnabledToggle", PillMin, ImVec2(PillWidth, PillHeight), Hovered,
                                   "Toggle Outliner visibility");
    if (Clicked)
    {
        EnabledCondition = !EnabledCondition;
    }
    const ImU32 DotInk = EnabledCondition ? Tokens.LiveGreen : Tokens.WarmAmber;
    const ImU32 Fill   = EnabledCondition ? Tokens.LiveGreenDim : Tokens.WarmAmberDim;
    KitPillSurface(Canvas, PillMin, ImVec2(PillMin.x + PillWidth, PillMin.y + PillHeight), Fill,
                   Hovered ? DotInk : Tokens.Edge, 999.0f);
    Canvas->AddCircleFilled(ImVec2(PillMin.x + 14.0f, PillMin.y + PillHeight * 0.5f), 3.4f, DotInk);
    KitDrawText(Canvas, Faces.Medium, 11.5f, ImVec2(PillMin.x + 24.0f, PillMin.y + 7.0f),
                EnabledCondition ? Tokens.TextPrimary : Tokens.WarmAmber, PillLabel);

    const float BottomY = TitleY + 28.0f;
    Canvas->AddLine(ImVec2(Origin.x, BottomY), ImVec2(Origin.x + Width, BottomY), Tokens.EdgeSubtle);
    OutConsumedHeight = (BottomY - Origin.y) + 8.0f;
    return Clicked;
}

bool ConstructCategoryTabStrip(const KitFaces &Faces, const EverestSurfaceTokens &Tokens, const char *StripIdentifier,
                               ImVec2 Origin, float Width, const char *const *Captions, size_t Count,
                               size_t &SelectedIndex, float &OutConsumedHeight)
{
    ImDrawList *Canvas      = ImGui::GetWindowDrawList();
    const float LeftX       = Origin.x + 14.0f;
    const float RightLimit  = Origin.x + Width - 14.0f;
    const float PillHeight  = 27.0f;
    float       CursorX     = LeftX;
    float       RowY        = Origin.y + 2.0f;
    bool        Changed     = false;

    ImGui::PushID(StripIdentifier);
    for (size_t TabIndex = 0; TabIndex < Count; ++TabIndex)
    {
        const char *Caption   = Captions[TabIndex] != nullptr ? Captions[TabIndex] : "";
        const float PillWidth = KitTextWidth(Faces.Medium, 12.0f, Caption) + 22.0f;
        if (CursorX + PillWidth > RightLimit && CursorX > LeftX + 2.0f)
        {
            CursorX = LeftX;
            RowY += PillHeight + 6.0f;
        }
        const bool Active = (TabIndex == SelectedIndex);
        bool       Hovered = false;
        ImGui::PushID(static_cast<int>(TabIndex));
        if (KitTarget("##TabPill", ImVec2(CursorX, RowY), ImVec2(PillWidth, PillHeight), Hovered))
        {
            SelectedIndex = TabIndex;
            Changed       = true;
        }
        ImGui::PopID();

        const ImU32 Fill = Active ? Tokens.ActivePillFill : (Hovered ? Tokens.CardTop : Tokens.Inset);
        const ImU32 Ink  = Active ? Tokens.ActivePillInk : (Hovered ? Tokens.TextPrimary : Tokens.TextSoft);
        KitPillSurface(Canvas, ImVec2(CursorX, RowY), ImVec2(CursorX + PillWidth, RowY + PillHeight), Fill,
                       Active ? 0 : Tokens.Edge, 999.0f);
        KitDrawText(Canvas, Faces.Medium, 12.0f, ImVec2(CursorX + 11.0f, RowY + 7.25f), Ink, Caption);
        CursorX += PillWidth + 6.0f;
    }
    ImGui::PopID();

    OutConsumedHeight = (RowY - Origin.y) + PillHeight + 10.0f;
    return Changed;
}

bool ConstructPropertySwitchRow(const KitFaces &Faces, const EverestSurfaceTokens &Tokens, const char *RowIdentifier,
                                ImVec2 Origin, float Width, const EverestPropertyToggle *Toggles, size_t Count,
                                float &OutConsumedHeight)
{
    ImDrawList *Canvas     = ImGui::GetWindowDrawList();
    const float LeftX      = Origin.x + 14.0f;
    const float RightLimit = Origin.x + Width - 14.0f;
    const float PillHeight = 25.0f;
    float       CursorX    = LeftX;
    float       RowY       = Origin.y + 2.0f;
    bool        Changed    = false;

    ImGui::PushID(RowIdentifier);
    for (size_t ToggleIndex = 0; ToggleIndex < Count; ++ToggleIndex)
    {
        const EverestPropertyToggle &Toggle  = Toggles[ToggleIndex];
        const bool                   Enabled = Toggle.Enabled != nullptr ? *Toggle.Enabled : true;
        const float PillWidth = 10.0f + 7.0f + 6.0f + KitTextWidth(Faces.Medium, 11.5f, Toggle.Caption) + 11.0f;
        if (CursorX + PillWidth > RightLimit && CursorX > LeftX + 2.0f)
        {
            CursorX = LeftX;
            RowY += PillHeight + 6.0f;
        }
        bool Hovered = false;
        ImGui::PushID(static_cast<int>(ToggleIndex));
        if (KitTarget("##PropSwitch", ImVec2(CursorX, RowY), ImVec2(PillWidth, PillHeight), Hovered) &&
            Toggle.Enabled != nullptr)
        {
            *Toggle.Enabled = !(*Toggle.Enabled);
            Changed         = true;
        }
        ImGui::PopID();

        const ImU32 Fill = Enabled ? Tokens.PropSwitchOn : Tokens.PropSwitchOff;
        KitPillSurface(Canvas, ImVec2(CursorX, RowY), ImVec2(CursorX + PillWidth, RowY + PillHeight), Fill,
                       Hovered ? KitInkWhite(0.28f) : KitInkWhite(0.10f), 999.0f);
        Canvas->AddCircleFilled(ImVec2(CursorX + 12.5f, RowY + PillHeight * 0.5f), 3.0f, KitInkHex(0xf6fbf7));
        KitDrawText(Canvas, Faces.Medium, 11.5f, ImVec2(CursorX + 21.5f, RowY + 6.5f), KitInkHex(0xf6fbf7),
                    Toggle.Caption);
        CursorX += PillWidth + 6.0f;
    }
    ImGui::PopID();

    OutConsumedHeight = (RowY - Origin.y) + PillHeight + 10.0f;
    return Changed;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  MODULAR CARDS
//------------------------------------------------------------------------------------------------------------------------

EverestCardRegion BeginEverestCard(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                                   ImVec2 Origin, float Width, const char *TitleCaption, EverestGlyphCategory Glyph,
                                   uint32_t AccentRgb, int CardOrdinal, const char *SubtitleCaption)
{
    ImDrawListSplitter &Splitter = ActiveCardSplitter();
    Splitter.Split(Canvas, 2);
    Splitter.SetCurrentChannel(Canvas, 1);

    EverestCardRegion Card;
    Card.Origin         = Origin;
    Card.Width          = Width;
    Card.InnerLeft      = Origin.x + 14.0f;
    Card.InnerWidth     = std::max(80.0f, Width - 28.0f);
    Card.CursorY        = Origin.y + 13.0f;
    Card.BackgroundChan = 0;
    Card.AccentRgb      = AccentRgb;

    const ImU32 AccentInk = ConvertRgbToInk(AccentRgb);
    Canvas->AddRectFilled(ImVec2(Card.InnerLeft, Card.CursorY + 2.0f),
                          ImVec2(Card.InnerLeft + 2.0f, Card.CursorY + 16.0f), AccentInk, 1.0f);
    PaintEverestGlyph(Canvas, Glyph, ImVec2(Card.InnerLeft + 14.0f, Card.CursorY + 9.0f), 13.0f, AccentInk);
    KitDrawText(Canvas, Faces.Medium, 13.5f, ImVec2(Card.InnerLeft + 26.0f, Card.CursorY + 1.5f), Tokens.TextPrimary,
                TitleCaption != nullptr ? TitleCaption : "Card");

    if (CardOrdinal > 0)
    {
        char OrdinalBuffer[12] = {};
        std::snprintf(OrdinalBuffer, sizeof(OrdinalBuffer), "%02d", CardOrdinal);
        const float OrdinalWidth = KitTextWidth(Faces.Regular, 11.0f, OrdinalBuffer);
        KitDrawText(Canvas, Faces.Regular, 11.0f,
                    ImVec2(Card.InnerLeft + Card.InnerWidth - OrdinalWidth, Card.CursorY + 3.0f), Tokens.TextFaint,
                    OrdinalBuffer);
    }
    Card.CursorY += 22.0f;

    if (SubtitleCaption != nullptr && SubtitleCaption[0] != '\0')
    {
        KitDrawText(Canvas, Faces.Regular, 11.5f, ImVec2(Card.InnerLeft + 26.0f, Card.CursorY - 2.0f), Tokens.TextMuted,
                    SubtitleCaption);
        Card.CursorY += 16.0f;
    }
    Card.CursorY += 4.0f;
    return Card;
}

float EndEverestCard(ImDrawList *Canvas, const EverestSurfaceTokens &Tokens, EverestCardRegion &Card)
{
    const float OuterBottom = Card.CursorY + 10.0f;
    ImDrawListSplitter &Splitter = ActiveCardSplitter();
    Splitter.SetCurrentChannel(Canvas, 0);
    PaintRoundedVerticalGradient(Canvas, Card.Origin, ImVec2(Card.Origin.x + Card.Width, OuterBottom), Tokens.CardTop,
                                 Tokens.CardBottom, 18.0f);
    Canvas->AddRect(Card.Origin, ImVec2(Card.Origin.x + Card.Width, OuterBottom), Tokens.Edge, 18.0f);
    Splitter.Merge(Canvas);
    return (OuterBottom - Card.Origin.y) + 10.0f;
}

void ConstructHeroMetric(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                         EverestCardRegion &Card, const char *PrimaryFigure, const char *UnitCaption,
                         const char *PillCaption, bool WarmTone)
{
    const float TopY      = Card.CursorY;
    const float FigureLen = KitTextWidth(Faces.Light, 34.0f, PrimaryFigure != nullptr ? PrimaryFigure : "0");
    KitDrawText(Canvas, Faces.Light, 34.0f, ImVec2(Card.InnerLeft, TopY), Tokens.TextPrimary,
                PrimaryFigure != nullptr ? PrimaryFigure : "0");
    if (UnitCaption != nullptr && UnitCaption[0] != '\0')
    {
        KitDrawText(Canvas, Faces.Regular, 13.0f, ImVec2(Card.InnerLeft + FigureLen + 6.0f, TopY + 16.0f),
                    Tokens.TextMuted, UnitCaption);
    }
    if (PillCaption != nullptr && PillCaption[0] != '\0')
    {
        const float PillWidth  = KitTextWidth(Faces.Medium, 11.0f, PillCaption) + 18.0f;
        const float PillHeight = 22.0f;
        const ImVec2 PillMin(Card.InnerLeft + Card.InnerWidth - PillWidth, TopY + 8.0f);
        const ImU32 Fill = WarmTone ? Tokens.WarmAmberDim : Tokens.LiveGreenDim;
        const ImU32 Ink  = WarmTone ? Tokens.WarmAmber : Tokens.LiveGreen;
        KitPillSurface(Canvas, PillMin, ImVec2(PillMin.x + PillWidth, PillMin.y + PillHeight), Fill, Tokens.Edge,
                       999.0f);
        KitDrawText(Canvas, Faces.Medium, 11.0f, ImVec2(PillMin.x + 9.0f, PillMin.y + 5.5f), Ink, PillCaption);
    }
    Card.CursorY += 40.0f;
}

void ConstructMutedParagraph(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                             EverestCardRegion &Card, const char *ParagraphText)
{
    const float Consumed = PaintWrappedCopy(Canvas, Faces.Regular, 11.5f, ImVec2(Card.InnerLeft, Card.CursorY),
                                            Card.InnerWidth, 15.5f, Tokens.TextMuted, ParagraphText);
    Card.CursorY += Consumed + 6.0f;
}

bool ConstructPrecisionSlider(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                              EverestCardRegion &Card, const char *ControlIdentifier, const char *Caption,
                              float &ScalarReading, float MinimumLimit, float MaximumLimit, const char *UnitSuffix,
                              int DecimalPlaces, const char *LowHint, const char *HighHint)
{
    const float RowTop = Card.CursorY;
    char ReadingText[48] = {};
    if (UnitSuffix != nullptr && UnitSuffix[0] != '\0')
    {
        std::snprintf(ReadingText, sizeof(ReadingText), "%.*f %s", DecimalPlaces, static_cast<double>(ScalarReading),
                      UnitSuffix);
    }
    else
    {
        std::snprintf(ReadingText, sizeof(ReadingText), "%.*f", DecimalPlaces, static_cast<double>(ScalarReading));
    }
    KitDrawText(Canvas, Faces.Regular, 12.5f, ImVec2(Card.InnerLeft, RowTop), Tokens.TextSoft,
                Caption != nullptr ? Caption : "");
    const float ReadingWidth = KitTextWidth(Faces.Medium, 12.0f, ReadingText);
    KitDrawText(Canvas, Faces.Medium, 12.0f, ImVec2(Card.InnerLeft + Card.InnerWidth - ReadingWidth, RowTop),
                Tokens.TextPrimary, ReadingText);

    const float TrackY     = RowTop + 21.0f;
    const float HitHeight  = 16.0f;
    const ImVec2 HitMin(Card.InnerLeft, TrackY - HitHeight * 0.5f);
    ImGui::SetCursorScreenPos(HitMin);
    ImGui::PushID(ControlIdentifier);
    ImGui::InvisibleButton("##PrecisionSliderHit", ImVec2(Card.InnerWidth, HitHeight));
    const bool Active  = ImGui::IsItemActive();
    const bool Hovered = ImGui::IsItemHovered();
    bool       Changed = false;
    if (Active && MaximumLimit > MinimumLimit)
    {
        const float MouseRatio =
            std::clamp((ImGui::GetIO().MousePos.x - Card.InnerLeft) / Card.InnerWidth, 0.0f, 1.0f);
        const float Candidate = MinimumLimit + MouseRatio * (MaximumLimit - MinimumLimit);
        if (std::fabs(Candidate - ScalarReading) > 1.0e-6f)
        {
            ScalarReading = Candidate;
            Changed       = true;
        }
    }
    ImGui::PopID();

    const float Ratio = (MaximumLimit > MinimumLimit)
                            ? std::clamp((ScalarReading - MinimumLimit) / (MaximumLimit - MinimumLimit), 0.0f, 1.0f)
                            : 0.0f;
    const float FillEnd = Card.InnerLeft + Ratio * Card.InnerWidth;
    Canvas->AddRectFilled(ImVec2(Card.InnerLeft, TrackY - 1.5f),
                          ImVec2(Card.InnerLeft + Card.InnerWidth, TrackY + 1.5f), Tokens.Edge, 1.5f);
    Canvas->AddRectFilled(ImVec2(Card.InnerLeft, TrackY - 1.5f), ImVec2(FillEnd, TrackY + 1.5f), Tokens.AccentNeutral,
                          1.5f);
    Canvas->AddCircleFilled(ImVec2(FillEnd, TrackY), (Hovered || Active) ? 6.0f : 5.0f, Tokens.ActivePillFill);
    Canvas->AddCircle(ImVec2(FillEnd, TrackY), (Hovered || Active) ? 6.0f : 5.0f, Tokens.Ground, 16, 1.2f);

    Card.CursorY = TrackY + 9.0f;
    if ((LowHint != nullptr && LowHint[0] != '\0') || (HighHint != nullptr && HighHint[0] != '\0'))
    {
        if (LowHint != nullptr && LowHint[0] != '\0')
        {
            KitDrawText(Canvas, Faces.Regular, 10.5f, ImVec2(Card.InnerLeft, Card.CursorY), Tokens.TextFaint, LowHint);
        }
        if (HighHint != nullptr && HighHint[0] != '\0')
        {
            const float HighWidth = KitTextWidth(Faces.Regular, 10.5f, HighHint);
            KitDrawText(Canvas, Faces.Regular, 10.5f,
                        ImVec2(Card.InnerLeft + Card.InnerWidth - HighWidth, Card.CursorY), Tokens.TextFaint, HighHint);
        }
        Card.CursorY += 15.0f;
    }
    Card.CursorY += 4.0f;
    return Changed;
}

bool ConstructCapsuleSlider(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                            EverestCardRegion &Card, const char *ControlIdentifier, const char *Caption,
                            float &ScalarReading, float MinimumLimit, float MaximumLimit, const char *UnitSuffix,
                            int DecimalPlaces)
{
    // Native 22 px Observatory capsule slider (SunInspectorPanel.cpp parity).
    const float CapsuleHeight = 24.0f;
    const ImVec2 CapsuleMin(Card.InnerLeft, Card.CursorY);
    const ImVec2 CapsuleMax(Card.InnerLeft + Card.InnerWidth, Card.CursorY + CapsuleHeight);

    ImGui::SetCursorScreenPos(CapsuleMin);
    ImGui::PushID(ControlIdentifier);
    ImGui::InvisibleButton("##CapsuleSliderHit", ImVec2(Card.InnerWidth, CapsuleHeight));
    const bool Active  = ImGui::IsItemActive();
    const bool Hovered = ImGui::IsItemHovered();
    bool       Changed = false;
    if (Active && MaximumLimit > MinimumLimit)
    {
        const float Ratio     = std::clamp((ImGui::GetIO().MousePos.x - CapsuleMin.x) / Card.InnerWidth, 0.0f, 1.0f);
        const float Candidate = MinimumLimit + Ratio * (MaximumLimit - MinimumLimit);
        if (std::fabs(Candidate - ScalarReading) > 1.0e-6f)
        {
            ScalarReading = Candidate;
            Changed       = true;
        }
    }
    ImGui::PopID();

    const float Ratio = (MaximumLimit > MinimumLimit)
                            ? std::clamp((ScalarReading - MinimumLimit) / (MaximumLimit - MinimumLimit), 0.0f, 1.0f)
                            : 0.0f;
    Canvas->AddRectFilled(CapsuleMin, CapsuleMax, Tokens.Inset, 7.0f);
    if (Ratio > 0.01f)
    {
        const ImU32 FillInk = ConvertRgbToInk(Card.AccentRgb, Hovered ? 115 : 88);
        Canvas->AddRectFilled(CapsuleMin, ImVec2(CapsuleMin.x + Card.InnerWidth * Ratio, CapsuleMax.y), FillInk, 7.0f);
    }
    Canvas->AddRect(CapsuleMin, CapsuleMax, Hovered ? ConvertRgbToInk(Card.AccentRgb) : Tokens.Edge, 7.0f);

    KitDrawText(Canvas, Faces.Regular, 12.0f, ImVec2(CapsuleMin.x + 10.0f, CapsuleMin.y + 6.0f), Tokens.TextPrimary,
                Caption != nullptr ? Caption : "");

    char ReadingBuffer[48] = {};
    if (UnitSuffix != nullptr && UnitSuffix[0] != '\0')
    {
        std::snprintf(ReadingBuffer, sizeof(ReadingBuffer), "%.*f %s", DecimalPlaces,
                      static_cast<double>(ScalarReading), UnitSuffix);
    }
    else
    {
        std::snprintf(ReadingBuffer, sizeof(ReadingBuffer), "%.*f", DecimalPlaces, static_cast<double>(ScalarReading));
    }
    const float ReadingW = KitTextWidth(Faces.Medium, 11.5f, ReadingBuffer);
    KitDrawText(Canvas, Faces.Medium, 11.5f, ImVec2(CapsuleMax.x - ReadingW - 10.0f, CapsuleMin.y + 6.25f),
                Tokens.TextSoft, ReadingBuffer);

    Card.CursorY += CapsuleHeight + 6.0f;
    return Changed;
}

bool ConstructToggleRow(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                        EverestCardRegion &Card, const char *ControlIdentifier, const char *Caption,
                        bool &EnabledCondition, const char *DetailCaption)
{
    const float SwitchW      = 40.0f;
    const float SwitchH      = 23.0f;
    const float LabelWrapW   = std::max(80.0f, Card.InnerWidth - SwitchW - 14.0f);
    const float TopY         = Card.CursorY;
    float       BlockHeight  = 23.0f;

    KitDrawText(Canvas, Faces.Regular, 12.5f, ImVec2(Card.InnerLeft, TopY + 2.0f), Tokens.TextPrimary,
                Caption != nullptr ? Caption : "");
    if (DetailCaption != nullptr && DetailCaption[0] != '\0')
    {
        const float DetailH = PaintWrappedCopy(Canvas, Faces.Regular, 11.0f, ImVec2(Card.InnerLeft, TopY + 18.0f),
                                               LabelWrapW, 14.0f, Tokens.TextMuted, DetailCaption);
        BlockHeight = std::max(BlockHeight, 18.0f + DetailH);
    }

    const ImVec2 SwitchMin(Card.InnerLeft + Card.InnerWidth - SwitchW, TopY + 1.0f);
    bool Hovered = false;
    ImGui::PushID(ControlIdentifier);
    const bool Clicked = KitTarget("##ToggleHit", SwitchMin, ImVec2(SwitchW, SwitchH), Hovered);
    ImGui::PopID();
    if (Clicked)
    {
        EnabledCondition = !EnabledCondition;
    }

    const ImU32 TrackInk = EnabledCondition ? Tokens.LiveGreen : Tokens.Inset;
    KitPillSurface(Canvas, SwitchMin, ImVec2(SwitchMin.x + SwitchW, SwitchMin.y + SwitchH), TrackInk,
                   EnabledCondition ? Tokens.LiveGreen : Tokens.Edge, 999.0f);
    const float KnobX = EnabledCondition ? (SwitchMin.x + SwitchW - 11.5f) : (SwitchMin.x + 11.5f);
    Canvas->AddCircleFilled(ImVec2(KnobX, SwitchMin.y + SwitchH * 0.5f), 8.2f,
                            EnabledCondition ? KitInkHex(0xf6fbf7) : Tokens.TextSoft);

    Card.CursorY += BlockHeight + 8.0f;
    return Clicked;
}

bool ConstructSegmentedRow(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                           EverestCardRegion &Card, const char *ControlIdentifier, const char *LabelCaption,
                           const char *const *OptionCaptions, size_t OptionCount, size_t &SelectedIndex)
{
    if (OptionCount == 0)
    {
        return false;
    }
    if (LabelCaption != nullptr && LabelCaption[0] != '\0')
    {
        KitDrawText(Canvas, Faces.Regular, 11.5f, ImVec2(Card.InnerLeft, Card.CursorY), Tokens.TextMuted, LabelCaption);
        Card.CursorY += 16.0f;
    }
    const float TrayHeight = 30.0f;
    const ImVec2 TrayMin(Card.InnerLeft, Card.CursorY);
    const ImVec2 TrayMax(Card.InnerLeft + Card.InnerWidth, Card.CursorY + TrayHeight);
    Canvas->AddRectFilled(TrayMin, TrayMax, Tokens.Inset, 9.0f);
    Canvas->AddRect(TrayMin, TrayMax, Tokens.Edge, 9.0f);

    const float CellWidth = (Card.InnerWidth - 6.0f) / static_cast<float>(OptionCount);
    bool        Changed   = false;
    ImGui::PushID(ControlIdentifier);
    for (size_t OptionIndex = 0; OptionIndex < OptionCount; ++OptionIndex)
    {
        const ImVec2 CellMin(TrayMin.x + 3.0f + CellWidth * static_cast<float>(OptionIndex), TrayMin.y + 3.0f);
        const ImVec2 CellSize(CellWidth, TrayHeight - 6.0f);
        bool         Hovered = false;
        ImGui::PushID(static_cast<int>(OptionIndex));
        if (KitTarget("##SegCell", CellMin, CellSize, Hovered))
        {
            SelectedIndex = OptionIndex;
            Changed       = true;
        }
        ImGui::PopID();

        const bool Active = (OptionIndex == SelectedIndex);
        if (Active || Hovered)
        {
            Canvas->AddRectFilled(CellMin, ImVec2(CellMin.x + CellSize.x, CellMin.y + CellSize.y),
                                  Active ? Tokens.RowSelectedTop : Tokens.CardTop, 7.0f);
            if (Active)
            {
                Canvas->AddRect(CellMin, ImVec2(CellMin.x + CellSize.x, CellMin.y + CellSize.y), Tokens.Edge, 7.0f);
            }
        }
        const char *Text      = OptionCaptions[OptionIndex] != nullptr ? OptionCaptions[OptionIndex] : "";
        const float TextWidth = KitTextWidth(Faces.Medium, 11.5f, Text);
        KitDrawText(Canvas, Faces.Medium, 11.5f,
                    ImVec2(CellMin.x + (CellSize.x - TextWidth) * 0.5f, CellMin.y + 6.0f),
                    Active ? Tokens.TextPrimary : Tokens.TextMuted, Text);
    }
    ImGui::PopID();

    Card.CursorY += TrayHeight + 8.0f;
    return Changed;
}

bool ConstructDropdownRow(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                          EverestCardRegion &Card, const char *PopupIdentifier, const char *LabelCaption,
                          const char *const *OptionCaptions, size_t OptionCount, size_t &SelectedIndex)
{
    if (OptionCount == 0)
    {
        return false;
    }
    if (LabelCaption != nullptr && LabelCaption[0] != '\0')
    {
        KitDrawText(Canvas, Faces.Regular, 11.5f, ImVec2(Card.InnerLeft, Card.CursorY), Tokens.TextMuted, LabelCaption);
        Card.CursorY += 16.0f;
    }
    const float BoxHeight = 30.0f;
    const ImVec2 BoxMin(Card.InnerLeft, Card.CursorY);
    const ImVec2 BoxMax(Card.InnerLeft + Card.InnerWidth, Card.CursorY + BoxHeight);
    bool Hovered = false;
    if (KitTarget(PopupIdentifier, BoxMin, ImVec2(Card.InnerWidth, BoxHeight), Hovered))
    {
        ImGui::OpenPopup(PopupIdentifier);
    }
    Canvas->AddRectFilled(BoxMin, BoxMax, Hovered ? Tokens.CardTop : Tokens.Inset, 8.0f);
    Canvas->AddRect(BoxMin, BoxMax, Tokens.Edge, 8.0f);
    const size_t Clamped = std::min(SelectedIndex, OptionCount - 1);
    KitDrawText(Canvas, Faces.Regular, 12.0f, ImVec2(BoxMin.x + 11.0f, BoxMin.y + 8.5f), Tokens.TextPrimary,
                OptionCaptions[Clamped]);
    PaintChevronGlyph(Canvas, ImVec2(BoxMax.x - 13.0f, (BoxMin.y + BoxMax.y) * 0.5f), 3.4f, 0, Tokens.TextMuted);

    bool Changed = false;
    ImGui::SetNextWindowPos(ImVec2(BoxMin.x, BoxMax.y + 4.0f), ImGuiCond_Appearing);
    if (DropdownControlSurface::BeginMenu(PopupIdentifier))
    {
        for (size_t OptionIndex = 0; OptionIndex < OptionCount; ++OptionIndex)
        {
            if (DropdownControlSurface::Option(OptionCaptions[OptionIndex], OptionIndex == SelectedIndex))
            {
                SelectedIndex = OptionIndex;
                Changed       = true;
            }
        }
        DropdownControlSurface::EndMenu();
    }
    Card.CursorY += BoxHeight + 8.0f;
    return Changed;
}

void ConstructStatisticRow(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                           EverestCardRegion &Card, const EverestStatisticCell *Cells, size_t CellCount)
{
    if (CellCount == 0)
    {
        return;
    }
    const float Gap       = 6.0f;
    const float CellWidth = (Card.InnerWidth - Gap * static_cast<float>(CellCount - 1)) / static_cast<float>(CellCount);
    const float CellH     = 42.0f;

    for (size_t CellIndex = 0; CellIndex < CellCount; ++CellIndex)
    {
        const float CellX = Card.InnerLeft + (CellWidth + Gap) * static_cast<float>(CellIndex);
        const ImVec2 CellMin(CellX, Card.CursorY);
        const ImVec2 CellMax(CellX + CellWidth, Card.CursorY + CellH);
        Canvas->AddRectFilled(CellMin, CellMax, Tokens.StatCell, 10.0f);
        Canvas->AddRect(CellMin, CellMax, Tokens.EdgeSubtle, 10.0f);

        const std::string Upper = ConvertToUppercase(Cells[CellIndex].Caption);
        PaintTrackedLabel(Canvas, Faces.Medium, 9.5f, ImVec2(CellX + 9.0f, CellMin.y + 7.0f), Tokens.TextMuted,
                          Upper.c_str(), 9.5f * 0.08f);
        KitDrawText(Canvas, Faces.Medium, 13.5f, ImVec2(CellX + 9.0f, CellMin.y + 21.0f), Tokens.TextPrimary,
                    Cells[CellIndex].Reading.c_str());
    }
    Card.CursorY += CellH + 7.0f;
}

void ConstructMonospaceReadout(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                               EverestCardRegion &Card, const std::vector<std::string> &Lines)
{
    if (Lines.empty())
    {
        return;
    }
    const float BoxHeight = 14.0f + static_cast<float>(Lines.size()) * 15.0f;
    const ImVec2 BoxMin(Card.InnerLeft, Card.CursorY);
    const ImVec2 BoxMax(Card.InnerLeft + Card.InnerWidth, Card.CursorY + BoxHeight);
    Canvas->AddRectFilled(BoxMin, BoxMax, Tokens.ReadoutBox, 10.0f);
    Canvas->AddRect(BoxMin, BoxMax, Tokens.EdgeSubtle, 10.0f);

    float LineY = BoxMin.y + 7.0f;
    for (const std::string &Line : Lines)
    {
        KitDrawText(Canvas, Faces.Regular, 11.0f, ImVec2(BoxMin.x + 10.0f, LineY), Tokens.TextSoft, Line.c_str());
        LineY += 15.0f;
    }
    Card.CursorY += BoxHeight + 7.0f;
}

bool ConstructMaterialChips(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                            EverestCardRegion &Card, const char *GridIdentifier, const EverestMaterialChip *Chips,
                            size_t ChipCount, size_t &SelectedIndex)
{
    if (ChipCount == 0)
    {
        return false;
    }
    const float Gap       = 6.0f;
    const float ColWidth  = (Card.InnerWidth - Gap) * 0.5f;
    const float ChipH     = 30.0f;
    bool        Changed   = false;

    ImGui::PushID(GridIdentifier);
    for (size_t ChipIndex = 0; ChipIndex < ChipCount; ++ChipIndex)
    {
        const size_t Column = ChipIndex % 2;
        const size_t Row    = ChipIndex / 2;
        const ImVec2 ChipMin(Card.InnerLeft + static_cast<float>(Column) * (ColWidth + Gap),
                             Card.CursorY + static_cast<float>(Row) * (ChipH + Gap));
        bool Hovered = false;
        ImGui::PushID(static_cast<int>(ChipIndex));
        if (KitTarget("##MatChip", ChipMin, ImVec2(ColWidth, ChipH), Hovered))
        {
            SelectedIndex = ChipIndex;
            Changed       = true;
        }
        ImGui::PopID();

        const bool Active = (ChipIndex == SelectedIndex);
        Canvas->AddRectFilled(ChipMin, ImVec2(ChipMin.x + ColWidth, ChipMin.y + ChipH),
                              Active ? Tokens.RowSelectedTop : (Hovered ? Tokens.CardTop : Tokens.Inset), 9.0f);
        Canvas->AddRect(ChipMin, ImVec2(ChipMin.x + ColWidth, ChipMin.y + ChipH),
                        Active ? ConvertRgbToInk(Chips[ChipIndex].SwatchColourRgb) : Tokens.Edge, 9.0f, 0,
                        Active ? 1.5f : 1.0f);
        Canvas->AddCircleFilled(ImVec2(ChipMin.x + 13.0f, ChipMin.y + ChipH * 0.5f), 4.2f,
                                ConvertRgbToInk(Chips[ChipIndex].SwatchColourRgb));
        KitDrawText(Canvas, Faces.Medium, 11.5f, ImVec2(ChipMin.x + 24.0f, ChipMin.y + 8.5f),
                    Active ? Tokens.TextPrimary : Tokens.TextSoft, Chips[ChipIndex].Caption);
    }
    ImGui::PopID();

    const size_t TotalRows = (ChipCount + 1) / 2;
    Card.CursorY += static_cast<float>(TotalRows) * (ChipH + Gap) + 2.0f;
    return Changed;
}

int ConstructActionButtons(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                           EverestCardRegion &Card, const char *RowIdentifier, const EverestActionButton *Buttons,
                           size_t ButtonCount)
{
    if (ButtonCount == 0)
    {
        return -1;
    }
    const float Gap       = 6.0f;
    const float BtnWidth  = (Card.InnerWidth - Gap * static_cast<float>(ButtonCount - 1)) /
                            static_cast<float>(ButtonCount);
    const float BtnHeight = 30.0f;
    int         Activated = -1;

    ImGui::PushID(RowIdentifier);
    for (size_t BtnIndex = 0; BtnIndex < ButtonCount; ++BtnIndex)
    {
        const ImVec2 BtnMin(Card.InnerLeft + (BtnWidth + Gap) * static_cast<float>(BtnIndex), Card.CursorY);
        bool         Hovered = false;
        ImGui::PushID(static_cast<int>(BtnIndex));
        if (KitTarget("##ActionBtn", BtnMin, ImVec2(BtnWidth, BtnHeight), Hovered))
        {
            Activated = static_cast<int>(BtnIndex);
        }
        ImGui::PopID();

        ImU32 Fill   = Hovered ? Tokens.RowSelectedTop : Tokens.Inset;
        ImU32 Border = Tokens.Edge;
        ImU32 Ink    = Tokens.TextPrimary;
        switch (Buttons[BtnIndex].Style)
        {
            case EverestButtonStyle::Primary:
                Fill   = Tokens.ActivePillFill;
                Border = Tokens.ActivePillFill;
                Ink    = Tokens.ActivePillInk;
                break;
            case EverestButtonStyle::Danger:
                Fill   = Tokens.DangerCoralDim;
                Border = Tokens.DangerCoral;
                Ink    = Tokens.DangerCoral;
                break;
            case EverestButtonStyle::Studio:
                Fill   = Tokens.LiveGreenDim;
                Border = Tokens.LiveGreen;
                Ink    = Tokens.LiveGreen;
                break;
            case EverestButtonStyle::Secondary:
                break;
        }
        Canvas->AddRectFilled(BtnMin, ImVec2(BtnMin.x + BtnWidth, BtnMin.y + BtnHeight), Fill, 9.0f);
        Canvas->AddRect(BtnMin, ImVec2(BtnMin.x + BtnWidth, BtnMin.y + BtnHeight), Border, 9.0f);

        const float LabelW = KitTextWidth(Faces.Medium, 11.5f, Buttons[BtnIndex].Caption);
        KitDrawText(Canvas, Faces.Medium, 11.5f,
                    ImVec2(BtnMin.x + (BtnWidth - LabelW) * 0.5f, BtnMin.y + 8.5f), Ink, Buttons[BtnIndex].Caption);
    }
    ImGui::PopID();

    Card.CursorY += BtnHeight + 7.0f;
    return Activated;
}

bool ConstructWorldTransformCard(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                                 ImVec2 Origin, float Width, uint32_t AccentRgb, float Coordinates[3],
                                 bool &OutFocusRequested, float &OutConsumedHeight)
{
    EverestCardRegion Card = BeginEverestCard(Canvas, Faces, Tokens, Origin, Width, "World transform",
                                              EverestGlyphCategory::MapPin, AccentRgb, 0);
    const char *AxisLabels[3]  = {"X", "Y", "Z"};
    const uint32_t AxisColours[3] = {0xd97373u, 0x6ec28bu, 0x6ea4d8u};
    const float Gap       = 6.0f;
    const float CellWidth = (Card.InnerWidth - Gap * 2.0f) / 3.0f;
    const float CellH     = 34.0f;
    bool        Changed   = false;

    for (int AxisIndex = 0; AxisIndex < 3; ++AxisIndex)
    {
        const float CellX = Card.InnerLeft + (CellWidth + Gap) * static_cast<float>(AxisIndex);
        const ImVec2 CellMin(CellX, Card.CursorY);
        const ImVec2 CellMax(CellX + CellWidth, Card.CursorY + CellH);
        Canvas->AddRectFilled(CellMin, CellMax, Tokens.Inset, 8.0f);
        Canvas->AddRect(CellMin, CellMax, Tokens.Edge, 8.0f);
        KitDrawText(Canvas, Faces.SemiBold, 11.5f, ImVec2(CellX + 9.0f, CellMin.y + 10.5f),
                    ConvertRgbToInk(AxisColours[AxisIndex]), AxisLabels[AxisIndex]);

        char NumberText[32] = {};
        std::snprintf(NumberText, sizeof(NumberText), "%.2f m", static_cast<double>(Coordinates[AxisIndex]));
        const float NumW = KitTextWidth(Faces.Medium, 11.5f, NumberText);
        KitDrawText(Canvas, Faces.Medium, 11.5f, ImVec2(CellMax.x - NumW - 8.0f, CellMin.y + 10.5f),
                    Tokens.TextPrimary, NumberText);

        ImGui::SetCursorScreenPos(CellMin);
        ImGui::PushID(AxisIndex);
        ImGui::InvisibleButton("##TransformDrag", ImVec2(CellWidth, CellH));
        if (ImGui::IsItemActive() && std::fabs(ImGui::GetIO().MouseDelta.x) > 0.0f)
        {
            Coordinates[AxisIndex] += ImGui::GetIO().MouseDelta.x * 0.05f;
            Changed = true;
        }
        ImGui::PopID();
    }
    Card.CursorY += CellH + 8.0f;

    const EverestActionButton FocusButton{"Focus target in viewport (F)", EverestGlyphCategory::Camera,
                                          EverestButtonStyle::Secondary};
    OutFocusRequested = (ConstructActionButtons(Canvas, Faces, Tokens, Card, "##TransformFocus", &FocusButton, 1) == 0);
    OutConsumedHeight = EndEverestCard(Canvas, Tokens, Card);
    return Changed;
}

//------------------------------------------------------------------------------------------------------------------------
//                                               VECTOR INSTRUMENTS
//------------------------------------------------------------------------------------------------------------------------

void ConstructSunArcInstrument(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                               EverestCardRegion &Card, float ElevationDegrees, float AzimuthDegrees)
{
    const float Height = 92.0f;
    const ImVec2 BoxMin(Card.InnerLeft, Card.CursorY);
    const ImVec2 BoxMax(Card.InnerLeft + Card.InnerWidth, Card.CursorY + Height);
    Canvas->AddRectFilled(BoxMin, BoxMax, Tokens.ReadoutBox, 12.0f);
    Canvas->AddRect(BoxMin, BoxMax, Tokens.EdgeSubtle, 12.0f);

    const float HorizonY = BoxMin.y + Height * 0.78f;
    const float Radius   = Height * 0.60f;
    const float CentreX  = (BoxMin.x + BoxMax.x) * 0.5f;
    Canvas->AddLine(ImVec2(BoxMin.x + 16.0f, HorizonY), ImVec2(BoxMax.x - 16.0f, HorizonY), Tokens.Edge, 1.5f);

    for (int Segment = 0; Segment < 24; ++Segment)
    {
        if (Segment % 2 == 1)
        {
            continue;
        }
        const float Angle0 = PiConstant + (static_cast<float>(Segment) / 24.0f) * PiConstant;
        const float Angle1 = PiConstant + (static_cast<float>(Segment + 1) / 24.0f) * PiConstant;
        Canvas->AddLine(ImVec2(CentreX + std::cos(Angle0) * Radius, HorizonY + std::sin(Angle0) * Radius),
                        ImVec2(CentreX + std::cos(Angle1) * Radius, HorizonY + std::sin(Angle1) * Radius),
                        Tokens.TextFaint, 1.2f);
    }

    const float SunAngle = PiConstant - ((ElevationDegrees + 20.0f) / 105.0f) * PiConstant;
    const ImVec2 SunPos(CentreX + std::cos(SunAngle) * Radius, HorizonY - std::sin(SunAngle) * Radius);
    const ImU32 GlowInk = ElevationDegrees > 0.0f ? KitInkRgba(255, 210, 122, 46) : KitInkRgba(159, 176, 216, 42);
    const ImU32 CoreInk = ElevationDegrees > 0.0f ? KitInkHex(0xffd27a) : KitInkHex(0xc3cff0);
    Canvas->AddCircleFilled(SunPos, 15.0f, GlowInk);
    Canvas->AddCircleFilled(SunPos, 5.0f, CoreInk);

    char AzimuthLabel[48] = {};
    std::snprintf(AzimuthLabel, sizeof(AzimuthLabel), "azimuth %.0f\xC2\xB0", static_cast<double>(AzimuthDegrees));
    KitDrawText(Canvas, Faces.Regular, 11.0f, ImVec2(BoxMin.x + 14.0f, BoxMax.y - 17.0f), Tokens.TextMuted,
                AzimuthLabel);
    Card.CursorY += Height + 8.0f;
}

void ConstructTorqueCurveInstrument(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                                    EverestCardRegion &Card, float CurrentEngineRpm)
{
    const float Height = 112.0f;
    const ImVec2 BoxMin(Card.InnerLeft, Card.CursorY);
    const ImVec2 BoxMax(Card.InnerLeft + Card.InnerWidth, Card.CursorY + Height);
    Canvas->AddRectFilled(BoxMin, BoxMax, Tokens.ReadoutBox, 12.0f);
    Canvas->AddRect(BoxMin, BoxMax, Tokens.EdgeSubtle, 12.0f);

    const float PlotLeft   = BoxMin.x + 16.0f;
    const float PlotRight  = BoxMax.x - 16.0f;
    const float PlotTop    = BoxMin.y + 14.0f;
    const float PlotBottom = BoxMax.y - 24.0f;
    Canvas->AddLine(ImVec2(PlotLeft, PlotBottom), ImVec2(PlotRight, PlotBottom), Tokens.Edge, 1.0f);

    static constexpr float AuthoredCurve[9][2] = {
        {800.0f, 240.0f},  {1800.0f, 340.0f}, {2800.0f, 465.0f}, {4000.0f, 520.0f}, {5200.0f, 540.0f},
        {6400.0f, 515.0f}, {7400.0f, 470.0f}, {8100.0f, 410.0f}, {8500.0f, 355.0f},
    };
    ImVec2 Points[9] = {};
    for (int PointIndex = 0; PointIndex < 9; ++PointIndex)
    {
        const float NormalizedX = AuthoredCurve[PointIndex][0] / 8500.0f;
        const float NormalizedY = AuthoredCurve[PointIndex][1] / 560.0f;
        Points[PointIndex]      = ImVec2(PlotLeft + NormalizedX * (PlotRight - PlotLeft),
                                         PlotBottom - NormalizedY * (PlotBottom - PlotTop));
    }
    Canvas->AddPolyline(Points, 9, KitInkHex(0xc7ce94), 0, 2.0f);

    const float MarkerX = PlotLeft + std::clamp(CurrentEngineRpm / 8500.0f, 0.0f, 1.0f) * (PlotRight - PlotLeft);
    Canvas->AddLine(ImVec2(MarkerX, PlotTop), ImVec2(MarkerX, PlotBottom), KitInkHex(0xe3d3a5), 1.2f);
    KitDrawText(Canvas, Faces.Regular, 10.5f, ImVec2(PlotLeft, BoxMax.y - 18.0f), Tokens.TextMuted,
                "800 - 8,500 rpm / authored torque curve (N\xC2\xB7m)");
    Card.CursorY += Height + 8.0f;
}

void ConstructCollisionHullInstrument(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                                      EverestCardRegion &Card, bool OverlayActive)
{
    const float Height = 122.0f;
    const ImVec2 BoxMin(Card.InnerLeft, Card.CursorY);
    const ImVec2 BoxMax(Card.InnerLeft + Card.InnerWidth, Card.CursorY + Height);
    Canvas->AddRectFilled(BoxMin, BoxMax, KitInkHex(0x15191a), 12.0f);
    Canvas->AddRect(BoxMin, BoxMax, Tokens.EdgeSubtle, 12.0f);

    const float MidX  = (BoxMin.x + BoxMax.x) * 0.5f;
    const float BaseY = BoxMin.y + Height * 0.72f;
    const float Span  = (BoxMax.x - BoxMin.x) * 0.36f;
    const ImVec2 Silhouette[8] = {
        ImVec2(MidX - Span, BaseY),
        ImVec2(MidX - Span * 0.94f, BaseY - 18.0f),
        ImVec2(MidX - Span * 0.46f, BaseY - 24.0f),
        ImVec2(MidX - Span * 0.16f, BaseY - 44.0f),
        ImVec2(MidX + Span * 0.34f, BaseY - 44.0f),
        ImVec2(MidX + Span * 0.68f, BaseY - 22.0f),
        ImVec2(MidX + Span * 0.98f, BaseY - 16.0f),
        ImVec2(MidX + Span, BaseY),
    };
    Canvas->AddPolyline(Silhouette, 8, ImDrawFlags_Closed ? KitInkRgba(139, 153, 138, 110) : Tokens.Edge,
                        ImDrawFlags_Closed, 1.3f);
    Canvas->AddCircle(ImVec2(MidX - Span * 0.58f, BaseY + 2.0f), 12.0f, KitInkRgba(207, 204, 134, 150), 16, 1.3f);
    Canvas->AddCircle(ImVec2(MidX + Span * 0.58f, BaseY + 2.0f), 12.0f, KitInkRgba(207, 204, 134, 150), 16, 1.3f);
    for (int SampleIndex = 0; SampleIndex < 22; ++SampleIndex)
    {
        const float T = static_cast<float>(SampleIndex) / 21.0f;
        const float SampleX = MidX - Span * 0.92f + T * Span * 1.84f;
        const float Arch    = std::sin(T * PiConstant) * 28.0f;
        Canvas->AddCircleFilled(ImVec2(SampleX, BaseY - 8.0f - Arch * 0.65f), 2.0f,
                                OverlayActive ? KitInkHex(0x3ec46d) : KitInkHex(0xcfcc86));
    }
    KitDrawTracked(Canvas, Faces.Medium, 9.5f, ImVec2(BoxMin.x + 12.0f, BoxMin.y + 10.0f), KitInkHex(0xb7bd9b),
                   "BODY-LOCAL SIDE VIEW / ACTUAL HULL SAMPLES", 9.5f * 0.08f);
    KitDrawText(Canvas, Faces.Regular, 10.5f, ImVec2(BoxMin.x + 12.0f, BoxMax.y - 18.0f), KitInkHex(0x8a9989),
                "Sampled hull wireframe \xC2\xB7 64 convex support points");
    Card.CursorY += Height + 8.0f;
}

void ConstructSmokeDecayInstrument(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                                   EverestCardRegion &Card, float DissipationRate, float CoolingRate)
{
    const float Height = 86.0f;
    const ImVec2 BoxMin(Card.InnerLeft, Card.CursorY);
    const ImVec2 BoxMax(Card.InnerLeft + Card.InnerWidth, Card.CursorY + Height);
    Canvas->AddRectFilled(BoxMin, BoxMax, Tokens.ReadoutBox, 12.0f);
    Canvas->AddRect(BoxMin, BoxMax, Tokens.EdgeSubtle, 12.0f);

    const float Left   = BoxMin.x + 14.0f;
    const float Right  = BoxMax.x - 14.0f;
    const float Top    = BoxMin.y + 12.0f;
    const float Bottom = BoxMax.y - 20.0f;
    ImVec2 DensityCurve[33] = {};
    ImVec2 HeatCurve[33]    = {};
    for (int StepIndex = 0; StepIndex <= 32; ++StepIndex)
    {
        const float Seconds  = (static_cast<float>(StepIndex) / 32.0f) * 12.0f;
        const float XCoord   = Left + (Right - Left) * (static_cast<float>(StepIndex) / 32.0f);
        const float SurviveD = std::pow(std::max(0.0f, 1.0f - DissipationRate), Seconds);
        const float SurviveH = std::pow(std::max(0.0f, 1.0f - CoolingRate), Seconds);
        DensityCurve[StepIndex] = ImVec2(XCoord, Bottom - (Bottom - Top) * SurviveD);
        HeatCurve[StepIndex]    = ImVec2(XCoord, Bottom - (Bottom - Top) * SurviveH);
    }
    Canvas->AddPolyline(DensityCurve, 33, KitInkHex(0xd8d8d8), 0, 1.8f);
    Canvas->AddPolyline(HeatCurve, 33, KitInkHex(0xe8833a), 0, 1.8f);
    KitDrawText(Canvas, Faces.Regular, 10.5f, ImVec2(Left, BoxMax.y - 15.0f), Tokens.TextMuted, "density");
    KitDrawText(Canvas, Faces.Regular, 10.5f, ImVec2(Left + 52.0f, BoxMax.y - 15.0f), KitInkHex(0xe8833a), "heat");
    KitDrawText(Canvas, Faces.Regular, 10.5f, ImVec2(Right - 24.0f, BoxMax.y - 15.0f), Tokens.TextMuted, "12 s");
    Card.CursorY += Height + 8.0f;
}

void ConstructBlackbodyRampInstrument(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                                      EverestCardRegion &Card, float TipKelvin, float CoreKelvin)
{
    const float Height = 54.0f;
    const ImVec2 BoxMin(Card.InnerLeft, Card.CursorY);
    const ImVec2 BoxMax(Card.InnerLeft + Card.InnerWidth, Card.CursorY + Height);
    Canvas->AddRectFilled(BoxMin, BoxMax, Tokens.ReadoutBox, 10.0f);
    Canvas->AddRect(BoxMin, BoxMax, Tokens.EdgeSubtle, 10.0f);

    const float Left  = BoxMin.x + 12.0f;
    const float Right = BoxMax.x - 12.0f;
    const int   Bands = 48;
    const float BandW = (Right - Left) / static_cast<float>(Bands);
    for (int BandIndex = 0; BandIndex < Bands; ++BandIndex)
    {
        const float Ratio  = static_cast<float>(BandIndex) / static_cast<float>(Bands - 1);
        const float Kelvin = TipKelvin + (CoreKelvin - TipKelvin) * Ratio;
        const float Hecto  = std::clamp(Kelvin, 1000.0f, 6600.0f) / 100.0f;
        const float Green  = std::clamp((99.4708f * std::log(Hecto) - 161.1195f) / 255.0f, 0.0f, 1.0f);
        const float Blue   = Hecto <= 19.0f
                                 ? 0.0f
                                 : std::clamp((138.5177f * std::log(std::max(1.0f, Hecto - 10.0f)) - 305.0448f) /
                                                  255.0f,
                                              0.0f, 1.0f);
        const ImU32 BandInk = KitInkRgba(255, static_cast<int>(Green * 255.0f), static_cast<int>(Blue * 255.0f), 255);
        Canvas->AddRectFilled(ImVec2(Left + BandW * static_cast<float>(BandIndex), BoxMin.y + 8.0f),
                              ImVec2(Left + BandW * static_cast<float>(BandIndex + 1) + 0.5f, BoxMin.y + 28.0f),
                              BandInk);
    }
    char TipText[32]  = {};
    char CoreText[32] = {};
    std::snprintf(TipText, sizeof(TipText), "tip %.0f K", static_cast<double>(TipKelvin));
    std::snprintf(CoreText, sizeof(CoreText), "core %.0f K", static_cast<double>(CoreKelvin));
    KitDrawText(Canvas, Faces.Regular, 10.5f, ImVec2(Left, BoxMax.y - 17.0f), Tokens.TextMuted, TipText);
    const float CoreW = KitTextWidth(Faces.Regular, 10.5f, CoreText);
    KitDrawText(Canvas, Faces.Regular, 10.5f, ImVec2(Right - CoreW, BoxMax.y - 17.0f), Tokens.TextMuted, CoreText);
    Card.CursorY += Height + 8.0f;
}

void ConstructImpactBreakInstrument(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                                    EverestCardRegion &Card, float ReducedMassKg, float ThresholdJoules)
{
    const float Height = 96.0f;
    const ImVec2 BoxMin(Card.InnerLeft, Card.CursorY);
    const ImVec2 BoxMax(Card.InnerLeft + Card.InnerWidth, Card.CursorY + Height);
    Canvas->AddRectFilled(BoxMin, BoxMax, Tokens.ReadoutBox, 12.0f);
    Canvas->AddRect(BoxMin, BoxMax, Tokens.EdgeSubtle, 12.0f);

    const float Left       = BoxMin.x + 14.0f;
    const float Right      = BoxMax.x - 14.0f;
    const float Top        = BoxMin.y + 12.0f;
    const float Bottom     = BoxMax.y - 20.0f;
    const float SafeMass   = std::max(1.0f, ReducedMassKg);
    const float BreakSpeed = std::sqrt(2.0f * std::max(1.0f, ThresholdJoules) / SafeMass);
    const float MaxSpeed   = std::clamp(2.2f * BreakSpeed, 4.0f, 35.0f);
    const float MaxEnergy  = 0.5f * SafeMass * MaxSpeed * MaxSpeed;

    ImVec2 Curve[29] = {};
    for (int StepIndex = 0; StepIndex <= 28; ++StepIndex)
    {
        const float Speed  = (static_cast<float>(StepIndex) / 28.0f) * MaxSpeed;
        const float Energy = 0.5f * SafeMass * Speed * Speed;
        Curve[StepIndex]   = ImVec2(Left + (Right - Left) * (Speed / MaxSpeed),
                                    Bottom - (Bottom - Top) * std::clamp(Energy / MaxEnergy, 0.0f, 1.0f));
    }
    Canvas->AddPolyline(Curve, 29, KitInkHex(0x8fb3a4), 0, 1.8f);

    const float ThresholdY = Bottom - (Bottom - Top) * std::clamp(ThresholdJoules / MaxEnergy, 0.0f, 1.0f);
    Canvas->AddLine(ImVec2(Left, ThresholdY), ImVec2(Right, ThresholdY), Tokens.DangerCoral, 1.2f);
    char BreakLabel[64] = {};
    std::snprintf(BreakLabel, sizeof(BreakLabel), "\xC2\xBD\xC2\xB7m\xC2\xB7v\xC2\xB2 threshold at %.0f km/h",
                  static_cast<double>(BreakSpeed * 3.6f));
    KitDrawText(Canvas, Faces.Regular, 10.5f, ImVec2(Left, BoxMax.y - 16.0f), Tokens.TextMuted, BreakLabel);
    Card.CursorY += Height + 8.0f;
}

void ConstructInspectorFooter(ImDrawList *Canvas, const KitFaces &Faces, const EverestSurfaceTokens &Tokens,
                              ImVec2 Origin, float Width, const char *LeftCaption, const char *RightCaption)
{
    const float FooterH = 34.0f;
    Canvas->AddRectFilled(Origin, ImVec2(Origin.x + Width, Origin.y + FooterH), Tokens.ColumnHeader);
    Canvas->AddLine(Origin, ImVec2(Origin.x + Width, Origin.y), Tokens.Edge);
    KitDrawText(Canvas, Faces.Regular, 11.0f, ImVec2(Origin.x + 14.0f, Origin.y + 11.0f), Tokens.TextMuted,
                LeftCaption != nullptr ? LeftCaption : "");
    if (RightCaption != nullptr && RightCaption[0] != '\0')
    {
        const float RightW = KitTextWidth(Faces.Medium, 11.0f, RightCaption);
        KitDrawText(Canvas, Faces.Medium, 11.0f, ImVec2(Origin.x + Width - RightW - 14.0f, Origin.y + 11.0f),
                    Tokens.TextSoft, RightCaption);
    }
}

} // namespace Frontier

#endif // FRONTIER_WITH_INTERFACE_SDK
