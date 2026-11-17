/*======================================================================================================================
                                                                CURVEPLOT.H
======================================================================================================================*/
// 🧩 Shared curve editor: interpolation choice, bounded knot dragging, and a live CurveSpace evaluation preview.

#pragma once

#include "Frontier/Engine/Foundation/Curves/CurveSpace.h"

namespace Frontier
{

class ControlColumn;

class CurvePlot
{
  public:
    // 📝 Edits the interpolation mode or drags existing knots. Invalid candidate edits leave the curve unchanged.
    [[nodiscard]] static bool Construct(ControlColumn& Column, const char* Id, CurveSpecification& Specification,
                                        bool Enabled = true);
};

} // namespace Frontier
