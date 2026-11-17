/*==========================================================================================================================================
                                                              HEROCARD.CPP
==========================================================================================================================================*/
// 🧩 Remastered hero-card: the 145° gradient metric card (145° #212121 → #191919, radius 22, padding 16/18) holding a
//    status chip row, a 38 px metric row, caller-drawn body content at the narrowed width, and an optional wrapped
//    note. Begin splits the draw channels and indents; End paints the card behind the body — hero cards must never nest.

#include "Engine/Interface/Controls/HeroCard.h"

#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/GlyphRun.h"
#include "Engine/Interface/Controls/GlyphSymbol.h"
#include "Engine/Interface/InspectorControls.h"

#include <imgui_internal.h>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    HERO CARD
//------------------------------------------------------------------------------------------------------------------------

HeroCardInner HeroCard::Begin(ControlColumn& Column, const char* Id, const char* ChipText, const char* ChipGlyph, int MarkTone,
                              const char* TagText, const char* MetricText, const char* MetricUnit, const char* SideText, bool Enabled)
{
    const EditorTypefaces& Faces    = Column.QueryFaces();
    ImDrawList* const      DrawList = Column.QueryDrawList();
    const float            S        = Column.QueryScale();
    const float            Width    = Column.QueryWidth();
    const float            Fade     = Enabled ? 1.0f : 0.42f;

    // 📝 Chrome: 16 px pad, 20 px chip row, 8 px gap, 38 px metric row, 8 px gap; the body starts below.
    constexpr float PadSide = 18.0f;
    constexpr float Chrome  = 16.0f + 20.0f + 8.0f + 38.0f + 8.0f;
    const ImVec2    CardTop = Column.Space(Chrome, 0.0f, 0.0f);

    const float InnerX = CardTop.x + PadSide * S;
    const float InnerW = Width - 2.0f * PadSide * S;
    float       Cursor = InnerX;
    const float ChipY  = CardTop.y + 16.0f * S;
    if (MarkTone != MarkNone)
    {
        const ImU32 Tones[3][2] = { { ResolveCssColour(0x3EC46D29), ResolveCssColour(0x3EC46DFF) },
                                    { ResolveCssColour(0xE8C27A2E), ResolveCssColour(0xE8C27AFF) },
                                    { ResolveCssColour(0xFF5C5C2E), ResolveCssColour(0xFF5C5CFF) } };
        const int Tone          = MarkTone < 0 ? 0 : (MarkTone > 2 ? 2 : MarkTone);
        DrawList->AddCircleFilled(ImVec2(Cursor + 10.0f * S, ChipY + 10.0f * S), 10.0f * S, FadeColour(Tones[Tone][0], Fade), 24);
        if (ChipGlyph != nullptr && ChipGlyph[0] != '\0')
        {
            (void)GlyphSymbol::Construct(DrawList, ChipGlyph, ImVec2(Cursor + 4.5f * S, ChipY + 4.5f * S), 11.0f * S, 2.0f * S,
                                         FadeColour(Tones[Tone][1], Fade));
        }
        Cursor += 20.0f * S + 7.0f * S;
    }
    if (ChipText != nullptr)
    {
        (void)GlyphRun::Construct(Column, Faces.Regular, 11.0f * S,
                                  ImVec2(Cursor, GlyphRun::ResolveBaseline(ChipY + 2.5f * S, 11.0f * S, 1.4f)),
                                  FadeColour(ResolveCssColour(0xB9B9B9FF), Fade), ChipText);
    }
    if (TagText != nullptr)
    {
        const float TagWide = GlyphRun::Measure(Column, Faces.Regular, 9.5f * S, TagText, 0.9f * S);
        (void)GlyphRun::Construct(Column, Faces.Regular, 9.5f * S,
                                  ImVec2(InnerX + InnerW - TagWide, GlyphRun::ResolveBaseline(ChipY + 2.5f * S, 9.5f * S, 1.4f)),
                                  FadeColour(ResolveCssColour(0x6F6F6FFF), Fade), TagText, 0.9f * S);
    }

    const float MetricY = ChipY + 20.0f * S + 8.0f * S + 4.0f * S;
    float       MetricAdvance = 0.0f;
    if (MetricText != nullptr)
    {
        MetricAdvance = GlyphRun::Construct(Column, Faces.Light, 38.0f * S,
                                            ImVec2(InnerX, GlyphRun::ResolveBaseline(MetricY, 38.0f * S, 1.0f)),
                                            FadeColour(ResolveCssColour(0xF1F1F1FF), Fade), MetricText, -1.5f * S);
    }
    if (MetricUnit != nullptr)
    {
        (void)GlyphRun::Construct(Column, Faces.Regular, 13.5f * S,
                                  ImVec2(InnerX + MetricAdvance + 3.0f * S, GlyphRun::ResolveBaseline(MetricY + 17.0f * S, 13.5f * S, 1.0f)),
                                  FadeColour(ResolveCssColour(0x868686FF), Fade), MetricUnit);
    }
    if (SideText != nullptr)
    {
        const float SideWide = GlyphRun::Measure(Column, Faces.Regular, 11.0f * S, SideText);
        (void)GlyphRun::Construct(Column, Faces.Regular, 11.0f * S,
                                  ImVec2(InnerX + InnerW - SideWide, GlyphRun::ResolveBaseline(MetricY + 22.0f * S, 11.0f * S, 1.0f)),
                                  FadeColour(ResolveCssColour(0x848484FF), Fade), SideText);
    }

    DrawList->ChannelsSplit(2);
    DrawList->ChannelsSetCurrent(1);
    Column.PushIndent(PadSide, PadSide);

    (void)Id;
    HeroCardInner Inner{};
    Inner.X      = InnerX;
    Inner.Width  = InnerW;
    Inner.Y      = CardTop.y + Chrome * S;
    Inner.Chrome = Chrome;
    return Inner;
}

HeroCardInner HeroCard::BeginTitled(ControlColumn& Column, const char* Id, const char* Eyebrow, const char* Title, const char* ChipText,
                                    const char* ChipGlyph, int MarkTone, const char* MetricText, const char* MetricUnit, const char* SideText,
                                    bool Enabled)
{
    const EditorTypefaces& Faces    = Column.QueryFaces();
    ImDrawList* const      DrawList = Column.QueryDrawList();
    const float            S        = Column.QueryScale();
    const float            Width    = Column.QueryWidth();
    const float            Fade     = Enabled ? 1.0f : 0.42f;

    // 📝 Titled chrome: 16 px pad, 20 px chip row, 8 px gap, 34 px eyebrow/title block, 8 px gap, 38 px metric row,
    //    8 px gap; the body starts below.
    constexpr float PadSide = 18.0f;
    constexpr float Chrome  = 16.0f + 20.0f + 8.0f + 34.0f + 8.0f + 38.0f + 8.0f;
    const ImVec2    CardTop = Column.Space(Chrome, 0.0f, 0.0f);

    const float InnerX = CardTop.x + PadSide * S;
    const float InnerW = Width - 2.0f * PadSide * S;
    float       Cursor = InnerX;
    const float ChipY  = CardTop.y + 16.0f * S;
    if (MarkTone != MarkNone)
    {
        const ImU32 Tones[3][2] = { { ResolveCssColour(0x3EC46D29), ResolveCssColour(0x3EC46DFF) },
                                    { ResolveCssColour(0xE8C27A2E), ResolveCssColour(0xE8C27AFF) },
                                    { ResolveCssColour(0xFF5C5C2E), ResolveCssColour(0xFF5C5CFF) } };
        const int Tone          = MarkTone < 0 ? 0 : (MarkTone > 2 ? 2 : MarkTone);
        DrawList->AddCircleFilled(ImVec2(Cursor + 10.0f * S, ChipY + 10.0f * S), 10.0f * S, FadeColour(Tones[Tone][0], Fade), 24);
        if (ChipGlyph != nullptr && ChipGlyph[0] != '\0')
        {
            (void)GlyphSymbol::Construct(DrawList, ChipGlyph, ImVec2(Cursor + 4.5f * S, ChipY + 4.5f * S), 11.0f * S, 2.0f * S,
                                         FadeColour(Tones[Tone][1], Fade));
        }
        Cursor += 20.0f * S + 7.0f * S;
    }
    if (ChipText != nullptr)
    {
        (void)GlyphRun::Construct(Column, Faces.Regular, 11.0f * S,
                                  ImVec2(Cursor, GlyphRun::ResolveBaseline(ChipY + 2.5f * S, 11.0f * S, 1.4f)),
                                  FadeColour(ResolveCssColour(0xB9B9B9FF), Fade), ChipText);
    }

    const float TitleY = ChipY + 20.0f * S + 8.0f * S;
    if (Eyebrow != nullptr)
    {
        (void)GlyphRun::Construct(Column, Faces.Regular, 9.5f * S, ImVec2(InnerX, GlyphRun::ResolveBaseline(TitleY, 9.5f * S, 1.4f)),
                                  FadeColour(ResolveCssColour(0x6F6F6FFF), Fade), Eyebrow, 0.9f * S);
    }
    if (Title != nullptr)
    {
        (void)GlyphRun::Construct(Column, Faces.Medium, 13.0f * S,
                                  ImVec2(InnerX, GlyphRun::ResolveBaseline(TitleY + 9.5f * 1.4f * S + 2.0f * S, 13.0f * S, 1.3f)),
                                  FadeColour(ResolveCssColour(0xEDEDEDFF), Fade), Title);
    }

    const float MetricY = TitleY + 34.0f * S + 8.0f * S + 4.0f * S;
    float       MetricAdvance = 0.0f;
    if (MetricText != nullptr)
    {
        MetricAdvance = GlyphRun::Construct(Column, Faces.Light, 38.0f * S,
                                            ImVec2(InnerX, GlyphRun::ResolveBaseline(MetricY, 38.0f * S, 1.0f)),
                                            FadeColour(ResolveCssColour(0xF1F1F1FF), Fade), MetricText, -1.5f * S);
    }
    if (MetricUnit != nullptr)
    {
        (void)GlyphRun::Construct(Column, Faces.Regular, 13.5f * S,
                                  ImVec2(InnerX + MetricAdvance + 3.0f * S, GlyphRun::ResolveBaseline(MetricY + 17.0f * S, 13.5f * S, 1.0f)),
                                  FadeColour(ResolveCssColour(0x868686FF), Fade), MetricUnit);
    }
    if (SideText != nullptr)
    {
        const float SideWide = GlyphRun::Measure(Column, Faces.Regular, 11.0f * S, SideText);
        (void)GlyphRun::Construct(Column, Faces.Regular, 11.0f * S,
                                  ImVec2(InnerX + InnerW - SideWide, GlyphRun::ResolveBaseline(MetricY + 22.0f * S, 11.0f * S, 1.0f)),
                                  FadeColour(ResolveCssColour(0x848484FF), Fade), SideText);
    }

    DrawList->ChannelsSplit(2);
    DrawList->ChannelsSetCurrent(1);
    Column.PushIndent(PadSide, PadSide);

    (void)Id;
    HeroCardInner Inner{};
    Inner.X      = InnerX;
    Inner.Width  = InnerW;
    Inner.Y      = CardTop.y + Chrome * S;
    Inner.Chrome = Chrome;
    return Inner;
}

float HeroCard::Top(const HeroCardInner& Inner, float UIScale)
{
    constexpr float DefaultChrome = 16.0f + 20.0f + 8.0f + 38.0f + 8.0f;
    const float     Chrome        = Inner.Chrome > 0.0f ? Inner.Chrome : DefaultChrome;
    return Inner.Y - Chrome * std::max(UIScale, 1e-6f);
}

void HeroCard::End(ControlColumn& Column, const HeroCardInner& Inner, const char* Note, bool Enabled)
{
    const EditorTypefaces& Faces    = Column.QueryFaces();
    ImDrawList* const      DrawList = Column.QueryDrawList();
    const float            S        = Column.QueryScale();
    const float            Fade     = Enabled ? 1.0f : 0.42f;
    const bool             Noted    = Note != nullptr && Note[0] != '\0';

    // 📝 The body the caller drew already advanced the narrowed cursor; the note wraps at the narrowed width.
    float NoteTall = 0.0f;
    if (Noted)
    {
        NoteTall = ParagraphBlock::Construct(Column, Faces.Regular, 10.5f * S, 1.45f, Column.QueryCursor(), Inner.Width,
                                             FadeColour(ResolveCssColour(0x757575FF), Fade), Note, true);
        const ImVec2 NoteTop = Column.Space(NoteTall / std::max(S, 1e-6f), 8.0f, 0.0f);
        (void)ParagraphBlock::Construct(Column, Faces.Regular, 10.5f * S, 1.45f, NoteTop, Inner.Width,
                                        FadeColour(ResolveCssColour(0x757575FF), Fade), Note, false);
    }
    Column.PopIndent();

    constexpr float PadBottom = 16.0f;
    constexpr float Radius    = 22.0f;
    (void)Column.Space(PadBottom, 0.0f, 10.0f);
    const ImVec2 Cursor  = Column.QueryCursor();
    const ImVec2 CardMin(Inner.X - 18.0f * S, Top(Inner, S));
    const ImVec2 CardMax(Inner.X + Inner.Width + 18.0f * S, Cursor.y);
    DrawList->ChannelsSetCurrent(0);
    const int VertexStart = DrawList->VtxBuffer.Size;
    DrawList->AddRectFilled(CardMin, CardMax, FadeColour(ResolveCssColour(0x212121FF), Fade), Radius * S);
    ImGui::ShadeVertsLinearColorGradientKeepAlpha(DrawList, VertexStart, DrawList->VtxBuffer.Size, CardMin, CardMax,
                                                  FadeColour(ResolveCssColour(0x212121FF), Fade),
                                                  FadeColour(ResolveCssColour(0x191919FF), Fade));
    DrawList->AddRect(CardMin, CardMax, FadeColour(ResolveCssColour(0xFFFFFF11), Fade), Radius * S, ImDrawFlags_None, S);
    DrawList->ChannelsMerge();
}

} // namespace Frontier
