/*==========================================================================================================================================
                                                              ACTIONROW.H
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js ActionRow: the 32 px pill command buttons (.action-btn), default/accent/danger tones.

#pragma once

#include <imgui.h>

#include <span>

namespace Frontier
{

class ControlColumn;

enum class ActionTone
{
    Default,
    Accent,
    Danger
};

struct ActionItem
{
    const char* Label;
    const char* Glyph; // 🧩 Studio glyph name or nullptr, e.g. "StudioFieldPlus".
    ActionTone  Tone    = ActionTone::Default;
    bool        Enabled = true;      // 📝 Per-action availability; false dims to 0.42 and never fires.
    const char* Reason  = nullptr;   // 📝 Disabled tooltip.
};

// 📝 Charcoal: ForceField 32 px buttons, cream accent. Warm: Particle 34 px buttons, warm translucent accent.
enum class ActionRowVoice
{
    Charcoal,
    Warm
};

// 📝 Legacy intrinsic-width actions (pre-Remastered inspectors): kept alongside the Remastered overload.
struct ActionEntry
{
    const char* Id;
    const char* Caption;
    bool        Enabled = true;
    const char* Tooltip = nullptr;
};

struct ActionRowLook
{
    float       FontSize     = 11;
    float       PaddingSide  = 14;
    float       PaddingTop   = 8;
    float       MarginTop    = 18;
    float       MarginBottom = 20;
    bool        Trailing     = false;
    const char* Leading      = nullptr;
};

class ActionRow
{
  public:
    // 📝 Returns the clicked action index, or -1 when nothing fired this frame. OutRects, when given, receives one
    //    screen rect per action so shells can expose scripted hit rects.
    [[nodiscard]] static int Construct(ControlColumn& Column, const char* Id, const ActionItem* Actions, int Count, bool Enabled = true,
                                       const char* Tooltip = nullptr, ActionRowVoice Voice = ActionRowVoice::Charcoal,
                                       ImVec4* OutRects = nullptr);
    static int Construct(ControlColumn& Column, std::span<const ActionEntry> Entries, const ActionRowLook& Look = {});
};

} // namespace Frontier
