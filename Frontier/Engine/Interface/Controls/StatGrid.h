/*==========================================================================================================================================
                                                              STATGRID.H
==========================================================================================================================================*/
// 🧩 Remastered StudioControls.js StatGrid: the two-column .stat-cell grid (14 px figure over a 10 px label).

#pragma once

namespace Frontier
{

class ControlColumn;

struct StatGridCell
{
    const char* Label;
    const char* Value;
};

class StatGrid
{
  public:
    static void Construct(ControlColumn& Column, const StatGridCell* Cells, int Count, bool Enabled = true);
};

} // namespace Frontier
