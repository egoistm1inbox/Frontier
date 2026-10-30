/*==========================================================================================================================================
                                                       CABINICONDEPOT.H
==========================================================================================================================================*/
// 🧩 12 multicolour vector SVG infotainment icons ported from Experimental/VehicleHmiPrototype/Source/Cabin/IconDepot.js.

#pragma once

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             INCLUDES
------------------------------------------------------------------------------------------------------------------------------------------*/
#include "Engine/Gameplay/GameMechanics/VehicleCabinHmi.h"

#include <cstdint>
#include <vector>

namespace Frontier
{
/*------------------------------------------------------------------------------------------------------------------------------------------
                                                       CABIN ICON DEPOT
------------------------------------------------------------------------------------------------------------------------------------------*/
// Renders a crisp anti-aliased multicolour SVG-equivalent squircle app icon (linear diagonal gradient tile,
// inner glass highlight rim, soft drop shadow, and analytic vector glyph paths from IconDepot.js) into an RGBA8 buffer.
void DrawMulticolourSvgAppIcon(
    std::vector<uint8_t>& Rgba8Buffer,
    uint32_t              BufferWidth,
    uint32_t              BufferHeight,
    CabinApplicationSlot  Slot,
    float                 CentreX,
    float                 CentreY,
    float                 TileSizePx,
    bool                  Highlighted = false) noexcept;

} // namespace Frontier
