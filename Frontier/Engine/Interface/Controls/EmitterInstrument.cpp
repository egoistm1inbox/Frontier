/*==========================================================================================================================================
                                                        EMITTERINSTRUMENT.CPP
==========================================================================================================================================*/
// 🧩 Remastered emitter instrument: release-shape segments, origin vector, radius slider, box half-extents. The radius
//    reads only for Sphere/Disc (Point fixes it at the origin) and the half-extents only for Box; the dimmed rows stay
//    visible so the prototype's P() shape is always legible.

#include "Engine/Interface/Controls/EmitterInstrument.h"

#include "Engine/Interface/Controls/ControlColumn.h"
#include "Engine/Interface/Controls/SegmentedRow.h"
#include "Engine/Interface/Controls/SliderPill.h"
#include "Engine/Interface/Controls/VectorRow.h"

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    EMITTER INSTRUMENT
//------------------------------------------------------------------------------------------------------------------------

bool EmitterInstrument::Construct(ControlColumn& Column, const char* Id, int& InOutShape, double OriginMetres[3],
                                  double& InOutRadiusMetres, double BoxHalfMetres[3], bool Enabled, const char* Tooltip)
{
    if (OriginMetres == nullptr || BoxHalfMetres == nullptr) return false;
    if (InOutShape < 0 || InOutShape > 4) InOutShape = 0;
    bool Changed = false;

    ImGui::PushID(Id);
    static const char* Shapes[5] = { "Point", "Sphere", "Disc", "Box", "Cube Surface" };
    Changed |= SegmentedRow::Construct(Column, "Shape", "Release shape", Shapes, 5, InOutShape, Enabled, Tooltip);
    Changed |= VectorRow::Construct(Column, "Origin", "Origin", "m", OriginMetres, 2, false, 0.0, 0.0, Enabled, Tooltip);
    const bool RadiusLive = InOutShape == 1 || InOutShape == 2;
    Changed |= SliderPill::Construct(Column, "Radius", "Radius", InOutRadiusMetres, 0.0, 10.0, 0.05, "m", Enabled && RadiusLive,
                                     RadiusLive ? Tooltip : "Sphere and Disc shapes only");
    Changed |= VectorRow::Construct(Column, "BoxHalf", "Box half-extents", "m", BoxHalfMetres, 2, true, 0.0, 10.0,
                                     Enabled && InOutShape == 3, InOutShape == 3 ? Tooltip : "Box shape only");
    ImGui::PopID();
    return Changed;
}

} // namespace Frontier
