/*==========================================================================================================================================
                                                        PARTICLEFIELDOVERLAY.CPP
==========================================================================================================================================*/
// 🧩 The shared field visualization over the particle image: the lattice sampler, fieldAccel on the CPU and the force outlines.

#include "Engine/Interface/ParticleEditor/ParticleFieldOverlay.h"

#if FRONTIER_EDITOR && defined(FRONTIER_WITH_INTERFACE_SDK)

#include <algorithm>
#include <cmath>

namespace Frontier
{

namespace
{

using Triple = std::array<double, 3>;

// 📝 The particle domain's axes are the field's (X, Y up, Z); the visualization's camera lives in the editor's z-up world.
std::array<double, 3> ConvertToSceneAxes(const Triple& Domain) noexcept
{
    return { Domain[0], -Domain[2], Domain[1] };
}

double WrapDegrees(double Degrees) noexcept
{
    return std::fmod(std::fmod(Degrees, 360.0) + 360.0, 360.0);
}

} // namespace

std::array<double, 3> EvaluateParticleFieldAcceleration(const ParticleAccelerationBlock& Fields, const std::array<double, 3>& Point)
{
    Triple       Out   = { 0.0, 0.0, 0.0 };
    const int    Count = static_cast<int>(Fields[0]);
    const double Now   = Fields[1];
    for (int Index = 0; Index < Count && Index < static_cast<int>(ParticleAccelerationLimit); ++Index)
    {
        const size_t A = static_cast<size_t>(1 + 3 * Index) * 4u, B = A + 4u, Window = A + 8u;
        const double Since = Now - Fields[Window];
        if (Since < 0.0) continue;
        if (Fields[Window + 2] > 0.0 ? std::fmod(Since, Fields[Window + 2]) >= Fields[Window + 1] : Since >= Fields[Window + 1]) continue;
        const double ΔX = Fields[A] - Point[0], ΔY = Fields[A + 1] - Point[1], ΔZ = Fields[A + 2] - Point[2];
        const double Separation = std::sqrt(ΔX * ΔX + ΔY * ΔY + ΔZ * ΔZ);
        const bool   Everywhere = Fields[A + 3] <= 0.0;
        if (!Everywhere && Separation >= Fields[A + 3]) continue;
        const double Share   = Everywhere ? 1.0 : std::pow(std::clamp(1.0 - Separation / std::max<double>(Fields[A + 3], 1e-3), 0.0, 1.0), 2.0);
        const double Inverse = 1.0 / std::max(Separation, 1e-3);
        const double DirectionX = ΔX * Inverse, DirectionY = ΔY * Inverse, DirectionZ = ΔZ * Inverse;
        const int    Category = static_cast<int>(Fields[B]);
        const double Strength = Fields[B + 1], Swirl = Fields[B + 2];
        if (Category == 0)
        {
            double     TangentX = DirectionZ + 1e-5, TangentZ = -DirectionX;
            const double Length = std::hypot(TangentX, TangentZ) > 0.0 ? std::hypot(TangentX, TangentZ) : 1.0;
            TangentX /= Length;
            TangentZ /= Length;
            Out[0] += (DirectionX * Strength + TangentX * Swirl) * Share;
            Out[1] += DirectionY * Strength * Share;
            Out[2] += (DirectionZ * Strength + TangentZ * Swirl) * Share;
        }
        else if (Category == 1)
        {
            Out[0] -= DirectionX * Strength * Share;
            Out[1] -= DirectionY * Strength * Share;
            Out[2] -= DirectionZ * Strength * Share;
        }
        else if (Category == 2)
        {
            Out[1] += Strength * Share;
        }
        else
        {
            const double RelativeX = -ΔX, RelativeY = -ΔY, RelativeZ = -ΔZ;
            const double Clipped = std::max(std::sqrt(RelativeX * RelativeX + RelativeY * RelativeY + RelativeZ * RelativeZ), 0.4);
            const double UnitX = RelativeX / Clipped, UnitY = RelativeY / Clipped, UnitZ = RelativeZ / Clipped;
            const double FieldX = 3.0 * UnitZ * UnitX, FieldY = 3.0 * UnitZ * UnitY, FieldZ = 3.0 * UnitZ * UnitZ - 1.0;
            double       Length = std::sqrt(FieldX * FieldX + FieldY * FieldY + FieldZ * FieldZ);
            if (Length == 0.0) Length = 1.0;
            Out[0] += FieldX / Length * Strength * Share;
            Out[1] += FieldY / Length * Strength * Share;
            Out[2] += FieldZ / Length * Strength * Share;
        }
    }
    return Out;
}

std::array<double, 3> SampleParticleWindLattice(const std::vector<float>& Cells, const std::array<double, 3>& Point)
{
    const uint32_t Cx = ParticleDomainDimensions[0], Cy = ParticleDomainDimensions[1], Cz = ParticleDomainDimensions[2];
    if (Cells.size() < static_cast<size_t>(Cx) * Cy * Cz * 4u) return { 0.0, 0.0, 0.0 };
    double Texel[3];
    for (int Axis = 0; Axis < 3; ++Axis)
    {
        const double U = (Point[Axis] - ParticleDomainMinimum[Axis]) / ParticleDomainSize[Axis];
        if (U < 0.0 || U > 1.0) return { 0.0, 0.0, 0.0 };
        Texel[Axis] = U * ParticleDomainDimensions[Axis] - 0.5;
    }
    const auto Cell = [&](int X, int Y, int Z, int Channel)
    {
        X = std::clamp(X, 0, static_cast<int>(Cx) - 1);
        Y = std::clamp(Y, 0, static_cast<int>(Cy) - 1);
        Z = std::clamp(Z, 0, static_cast<int>(Cz) - 1);
        return static_cast<double>(Cells[(static_cast<size_t>(X) + Cx * (static_cast<size_t>(Y) + Cy * static_cast<size_t>(Z))) * 4u + Channel]);
    };
    const int    X0 = static_cast<int>(std::floor(Texel[0])), Y0 = static_cast<int>(std::floor(Texel[1])), Z0 = static_cast<int>(std::floor(Texel[2]));
    const double Fx = Texel[0] - X0, Fy = Texel[1] - Y0, Fz = Texel[2] - Z0;
    Triple       Out{};
    for (int Channel = 0; Channel < 3; ++Channel)
    {
        const double C00 = Cell(X0, Y0, Z0, Channel) * (1 - Fx) + Cell(X0 + 1, Y0, Z0, Channel) * Fx;
        const double C10 = Cell(X0, Y0 + 1, Z0, Channel) * (1 - Fx) + Cell(X0 + 1, Y0 + 1, Z0, Channel) * Fx;
        const double C01 = Cell(X0, Y0, Z0 + 1, Channel) * (1 - Fx) + Cell(X0 + 1, Y0, Z0 + 1, Channel) * Fx;
        const double C11 = Cell(X0, Y0 + 1, Z0 + 1, Channel) * (1 - Fx) + Cell(X0 + 1, Y0 + 1, Z0 + 1, Channel) * Fx;
        Out[Channel]     = (C00 * (1 - Fy) + C10 * Fy) * (1 - Fz) + (C01 * (1 - Fy) + C11 * Fy) * Fz;
    }
    return Out;
}

ParticleFieldOverlay::ParticleFieldOverlay()
{
    Slice.View.Mode               = FieldViewMode::Camera;
    Slice.Options.HasExtent       = true;
    Slice.Options.Extent          = { ParticleDomainMinimum[0], ParticleDomainMinimum[2], ParticleDomainMinimum[0] + ParticleDomainSize[0],
                                      ParticleDomainMinimum[2] + ParticleDomainSize[2] };
    Slice.Options.ClipToExtent    = true;
    Slice.Options.ShowGroundGrid  = false;
    Slice.Options.ShowCascades    = false;
    Slice.Options.ShowScaleBar    = false;
    Slice.Options.MinimumSpan     = 2.0;
    Slice.Options.MaximumSpan     = 40.0;
    Slice.Options.CameraCells     = 48;
    Slice.Options.RefreshSeconds  = 0.15;
    Slice.Options.TracerCount     = 160;
}

SpatialVector ParticleFieldOverlay::Sample(ForceContribution Contribution, SpatialVector Point) const
{
    const Triple At = { Point.X, Point.Y, Point.Z };
    if (Contribution == ForceContribution::Accelerate)
    {
        const Triple Value = Accelerations_ ? EvaluateParticleFieldAcceleration(*Accelerations_, At) : Triple{};
        return { Value[0], Value[1], Value[2] };
    }
    if (Contribution == ForceContribution::Damp)
    {
        const double Damp = Fields_ ? ResolveParticleFields(*Fields_, At, TimeSeconds_, {}).Damp : 0.0;
        return { Damp, 0.0, 0.0 };
    }
    const Triple Value = Cells_ ? SampleParticleWindLattice(*Cells_, At) : Triple{};
    return { Value[0], Value[1], Value[2] };
}

void ParticleFieldOverlay::ConfigureLattice(std::shared_ptr<const std::vector<float>> Cells, const ParticleSpace& Space, const ParticleRefreshPlan& Plan)
{
    if (Cells) Cells_ = std::move(Cells);
    Accelerations_ = std::make_shared<ParticleAccelerationBlock>(Plan.Fields);
    Fields_        = std::make_shared<std::vector<ParticleField>>(Space.Fields);
    TimeSeconds_   = Space.TimeSeconds;
    // 📝 The sampler holds its own copies, so the slice can sample them away from the interface thread.
    Slice.ConfigureSampler([Lattice = Cells_, Accelerations = Accelerations_, Fields = Fields_, Time = TimeSeconds_](ForceContribution Contribution,
                                                                                                                   SpatialVector     Point) -> SpatialVector
                           {
                               const Triple At = { Point.X, Point.Y, Point.Z };
                               if (Contribution == ForceContribution::Accelerate)
                               {
                                   const Triple Value = EvaluateParticleFieldAcceleration(*Accelerations, At);
                                   return { Value[0], Value[1], Value[2] };
                               }
                               if (Contribution == ForceContribution::Damp)
                               {
                                   return { ResolveParticleFields(*Fields, At, Time, {}).Damp, 0.0, 0.0 };
                               }
                               const Triple Value = Lattice ? SampleParticleWindLattice(*Lattice, At) : Triple{};
                               return { Value[0], Value[1], Value[2] };
                           },
                           ++Revision_);
}

void ParticleFieldOverlay::Render(ImDrawList* Ink, const EditorTypefaces& Faces, ImVec2 Minimum, ImVec2 Maximum, const ParticleSpace& Space, float Scale)
{
    if (!Settings.Enabled) return;
    FieldVisualizationOptions& Options = Slice.Options;
    Options.Contribution = Settings.Contribution;
    Options.Quantity     = Settings.Quantity;
    Options.Heatmap      = Settings.Heatmap;
    Options.Arrows       = Settings.Arrows;
    Options.Tracers      = Settings.Tracers;
    Options.ShowLabels   = Settings.Labels;
    Options.SliceHeight  = Settings.SliceHeight;
    Options.Opacity      = Settings.Opacity;
    Options.ArrowSpacing = Settings.ArrowSpacing;
    Options.HasProbe     = Space.ProbeEnabled;
    Options.ProbePoint   = { Space.Probe[0], Space.Probe[2] };

    // 📝 The forces as the slice outlines them: flows dim while acceleration is shown and the other way round.
    Options.Sources.clear();
    for (size_t Index = 0; Index < Space.Fields.size(); ++Index)
    {
        const ParticleField&           Field      = Space.Fields[Index];
        const ParticleFieldDescriptor& Descriptor = ResolveParticleFieldDescriptor(Field.Category);
        FieldSourceOutline             Outline;
        Outline.Index        = static_cast<int32_t>(Index);
        Outline.X            = Field.Centre[0];
        Outline.Y            = Settings.SliceHeight;
        Outline.Z            = Field.Centre[2];
        Outline.Radius       = Field.Radius;
        Outline.Shape        = Field.Reach == ForceReach::Everywhere ? FieldOutlineShape::Everywhere
                             : Field.Reach == ForceReach::Box        ? FieldOutlineShape::Box
                                                                     : FieldOutlineShape::Circle;
        Outline.HalfX        = Field.Radius;
        Outline.HalfZ        = Field.Radius;
        Outline.Contribution = Descriptor.Contribution;
        Outline.Label        = Field.Name;
        Outline.Active       = Field.Enabled ? 1.0 : 0.25;
        Outline.Selected     = Space.Selected == "force:" + std::to_string(Index);
        Outline.Dim          = Descriptor.Contribution != Settings.Contribution || !Field.Enabled;
        // 📝 eos bearings are atan2(x, z) (0° = +Z); the slice reads compass bearings, 0° = −Z, 90° = +X.
        Outline.ShowBearing    = Descriptor.Contribution == ForceContribution::Flow && Field.Category != ParticleFieldCategory::Tornado
                              && Field.Category != ParticleFieldCategory::Outflow;
        Outline.BearingDegrees = WrapDegrees(180.0 - ResolveParticleFieldBearing(Field));
        Options.Sources.push_back(std::move(Outline));
    }

    const ParticleCameraReading Camera = ResolveParticleCamera(Space.Camera, (Maximum.x - Minimum.x) / std::max(1.0f, Maximum.y - Minimum.y));
    const Triple Forward = { Space.Camera.Target[0] - Camera.Eye[0], Space.Camera.Target[1] - Camera.Eye[1], Space.Camera.Target[2] - Camera.Eye[2] };
    const double Length  = std::max(1e-9, std::sqrt(Forward[0] * Forward[0] + Forward[1] * Forward[1] + Forward[2] * Forward[2]));
    FieldCamera& View    = Slice.View.Camera;
    View.Eye             = ConvertToSceneAxes(Camera.Eye);
    View.Forward         = ConvertToSceneAxes({ Forward[0] / Length, Forward[1] / Length, Forward[2] / Length });
    View.Right           = ConvertToSceneAxes(Camera.Right);
    View.Up              = ConvertToSceneAxes(Camera.Up);
    View.VerticalFieldOfView = 45.0 * 3.14159265358979323846 / 180.0;
    Slice.View.Mode      = FieldViewMode::Camera;
    Slice.Render(Ink, Faces, Minimum, Maximum, Space.TimeSeconds, Scale);
}

} // namespace Frontier

#endif
