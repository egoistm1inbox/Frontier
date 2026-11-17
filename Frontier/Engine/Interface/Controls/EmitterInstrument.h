/*==========================================================================================================================================
                                                         EMITTERINSTRUMENT.H
==========================================================================================================================================*/
// 🧩 Remastered emitter instrument: the particle Source cluster — release-shape segments (Point/Sphere/Disc/Box/
//    Cube Surface), the origin vector in metres, the radius slider, and the box half-extents vector (live only for
//    the Box shape). Returns true when any binding changed. Shape codes match ParticleReleaseShape order.

#pragma once

namespace Frontier
{

class ControlColumn;

class EmitterInstrument
{
  public:
    [[nodiscard]] static bool Construct(ControlColumn& Column, const char* Id, int& InOutShape, double OriginMetres[3],
                                        double& InOutRadiusMetres, double BoxHalfMetres[3], bool Enabled = true,
                                        const char* Tooltip = nullptr);
};

} // namespace Frontier
