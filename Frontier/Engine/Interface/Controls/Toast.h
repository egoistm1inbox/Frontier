/*==========================================================================================================================================
                                                                 TOAST.H
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js Toast: a transient bottom-centre pill (.toast) shown for two seconds.

#pragma once

namespace Frontier
{

class Toast
{
  public:
    static void Show(const char* Text);
    static void Construct();
    [[nodiscard]] static bool QueryVisible() noexcept;
};

} // namespace Frontier
