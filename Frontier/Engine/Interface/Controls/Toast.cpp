/*==========================================================================================================================================
                                                                 TOAST.CPP
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js Toast: a transient bottom-centre pill (.toast) shown for two seconds.

#include "Engine/Interface/Controls/Toast.h"

#include "Engine/Interface/Controls/ControlTheme.h"

#include <imgui.h>

#include <cstdio>
#include <cstring>

namespace Frontier
{

namespace
{

char   ToastLine[256]{};
double ToastShownAt = -10.0;

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    TOAST
//------------------------------------------------------------------------------------------------------------------------

void Toast::Show(const char* Text)
{
    if (Text == nullptr) return;
    std::snprintf(ToastLine, sizeof(ToastLine), "%s", Text);
    ToastShownAt = ImGui::GetTime();
}

bool Toast::QueryVisible() noexcept
{
    return ToastLine[0] != '\0' && (ImGui::GetTime() - ToastShownAt) < 2.0;
}

void Toast::Construct()
{
    if (!QueryVisible()) return;
    ImGuiViewport* const Viewport = ImGui::GetMainViewport();
    if (Viewport == nullptr) return;
    ImDrawList* const DrawList = ImGui::GetForegroundDrawList(Viewport);
    if (DrawList == nullptr) return;

    const float  Size  = 12.0f;
    const ImVec2 Extent = ImGui::GetFont()->CalcTextSizeA(Size, FLT_MAX, 0.0f, ToastLine);
    // 📝 .toast: padding 8px 16px, radius 999, bottom 40 px, centred.
    const ImVec2 Min(Viewport->Pos.x + 0.5f * (Viewport->Size.x - (Extent.x + 32.0f)), Viewport->Pos.y + Viewport->Size.y - 40.0f - 28.0f);
    const ImVec2 Max(Min.x + Extent.x + 32.0f, Min.y + 28.0f);
    DrawList->AddRectFilled(Min, Max, ResolveCssColour(0x222222F0), 14.0f);
    DrawList->AddRect(Min, Max, ResolveCssColour(0xFFFFFF29), 14.0f, ImDrawFlags_None, 1.0f);
    DrawList->AddText(ImGui::GetFont(), Size, ImVec2(Min.x + 16.0f, Min.y + 8.0f - 2.0f), ResolveCssColour(0xEFEFEFFF), ToastLine);
}

} // namespace Frontier
