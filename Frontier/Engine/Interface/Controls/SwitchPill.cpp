/*==========================================================================================================================================
                                                             SWITCHPILL.CPP
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js SwitchRow: a copy block (12 px label, 10 px detail) beside the 44x25 pill toggle
//    (.switch): idle #232323 with a #bcbcbc knob, checked white with a #111111 knob.

#include "Engine/Interface/Controls/SwitchPill.h"

#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/GlyphRun.h"
#include "Engine/Interface/InspectorControls.h"

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    SWITCH PILL
//------------------------------------------------------------------------------------------------------------------------

bool SwitchPill::Construct(ControlColumn& Column, const char* Id, const char* Label, const char* Detail, bool& InOut, bool Enabled,
                           const char* Tooltip)
{
    return Construct(Column, Id, Label, Detail, InOut, SwitchTone::Mono, Enabled, Tooltip);
}

bool SwitchPill::Construct(ControlColumn& Column, const char* Id, const char* Label, const char* Detail, bool& InOut, SwitchTone Tone,
                           bool Enabled, const char* Tooltip)
{
    const ControlTheme&    Theme    = Column.QueryTheme();
    const EditorTypefaces& Faces    = Column.QueryFaces();
    ImDrawList* const      DrawList = Column.QueryDrawList();
    const float            S        = Column.QueryScale();
    const float            Width    = Column.QueryWidth();
    const float            Fade     = Enabled ? 1.0f : 0.42f;
    const bool             Elaborated = Detail != nullptr && Detail[0] != '\0';
    const bool             Verdant    = Tone == SwitchTone::Verdant;

    // 📝 Verdant (.switch-pill): 40x22, 16 px knob, live-green on; Mono (.switch): 44x25, 19 px knob, white on.
    const float SwitchWide = Verdant ? 40.0f : 44.0f;
    const float SwitchTall = Verdant ? 22.0f : 25.0f;
    const float KnobR      = Verdant ? 8.0f : 9.5f;
    const float KnobOff    = 2.0f;
    const float KnobOn     = Verdant ? 20.0f : 25.0f;
    // 📝 The detail wraps like the browser block text instead of running under the toggle; single-line details keep the
    //    exact 34 px row so existing layouts do not shift.
    const float DetailWrap  = Width - SwitchWide * S - 12.0f * S > 40.0f * S ? Width - SwitchWide * S - 12.0f * S : 40.0f * S;
    const float DetailTall  = Elaborated ? ParagraphBlock::Construct(Column, Faces.Regular, 10.0f * S, 1.4f, ImVec2(0.0f, 0.0f), DetailWrap,
                                                                    FadeColour(Theme.Caption, Fade), Detail, true) : 0.0f;
    const float DetailExtra = Elaborated && DetailTall > 14.01f * S ? DetailTall / S - 14.0f : 0.0f;
    const float RowTall     = Elaborated ? 34.0f + DetailExtra : 28.0f;
    const ImVec2 Top        = Column.Space(RowTall, 0.0f, 15.0f);

    const float LabelTop = Top.y + (Elaborated ? 0.0f : 0.5f * (RowTall * S - 12.0f * 1.4f * S));
    (void)GlyphRun::Construct(Column, Faces.Regular, 12.0f * S, ImVec2(Top.x, GlyphRun::ResolveBaseline(LabelTop, 12.0f * S, 1.4f)),
                              FadeColour(Theme.ControlLabel, Fade), Label);
    if (Elaborated)
    {
        const float DetailTop = LabelTop + 12.0f * 1.4f * S + 2.0f * S;
        (void)ParagraphBlock::Construct(Column, Faces.Regular, 10.0f * S, 1.4f, ImVec2(Top.x, DetailTop), DetailWrap,
                                        FadeColour(Theme.Caption, Fade), Detail);
    }

    const ImVec2 SwitchMin(Top.x + Width - SwitchWide * S, Top.y + 0.5f * (RowTall * S - SwitchTall * S));
    const ImVec2 SwitchMax(SwitchMin.x + SwitchWide * S, SwitchMin.y + SwitchTall * S);
    ImGui::PushID(Id);
    ImGui::SetCursorScreenPos(SwitchMin);
    if (!Enabled) ImGui::BeginDisabled();
    const bool Flipped = ImGui::InvisibleButton("##Switch", ImVec2(SwitchWide * S, SwitchTall * S), ImGuiButtonFlags_EnableNav) && Enabled;
    if (ImGui::IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled)) ControlColumn::ConstructTooltip(Tooltip);
    if (!Enabled) ImGui::EndDisabled();
    ImGui::PopID();
    if (Flipped) InOut = !InOut;

    const ImU32 Fill = Verdant ? ResolveCssColour(InOut ? 0x3EC46D40 : 0x171717FF) : (InOut ? Theme.SwitchOn : Theme.SwitchOff);
    const ImU32 Edge = Verdant ? ResolveCssColour(InOut ? 0x3EC46D80 : 0xFFFFFF1A) : (InOut ? Theme.SwitchOn : Theme.PillBorder);
    const ImU32 KnobFill = Verdant ? ResolveCssColour(InOut ? 0x3EC46DFF : 0x777777FF) : (InOut ? Theme.KnobOn : Theme.KnobOff);
    DrawList->AddRectFilled(SwitchMin, SwitchMax, FadeColour(Fill, Fade), 0.5f * SwitchTall * S);
    DrawList->AddRect(SwitchMin, SwitchMax, FadeColour(Edge, Fade), 0.5f * SwitchTall * S, ImDrawFlags_None, S);
    const ImVec2 Knob(SwitchMin.x + (InOut ? KnobOn : KnobOff) * S + KnobR * S, SwitchMin.y + 2.0f * S + KnobR * S);
    DrawList->AddCircleFilled(Knob, KnobR * S, FadeColour(KnobFill, Fade), 32);
    return Flipped;
}

} // namespace Frontier
