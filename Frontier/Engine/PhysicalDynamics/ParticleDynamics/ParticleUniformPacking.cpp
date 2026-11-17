/*==========================================================================================================================================
                                                         PARTICLEUNIFORMPACKING.CPP
==========================================================================================================================================*/
// 🧩 eos fillSys, fillFibre and samplePath, and the prototype's camera, field and lensing packing, in C++.

#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleUniformPacking.h"
#include "Frontier/Engine/Foundation/Constants.h"

#include <algorithm>
#include <cmath>

namespace Frontier
{

namespace
{

// 📝 eos SYS_SLOT: the effect uniform's sixteen vec4 slots.
enum EffectSlot : uint32_t
{
    SlotOrigin = 0, SlotDirection = 1, SlotSpeed = 2, SlotLife = 3, SlotColourA = 4, SlotColourB = 5, SlotColourC = 6,
    SlotPhysics = 7, SlotPhysicsWind = 8, SlotPhysicsRelease = 9, SlotPhysicsBox = 10, SlotMolecular = 11,
    SlotMolecularLattice = 12, SlotMolecularReach = 13, SlotRelease = 14, SlotMiscellany = 15,
};

// 📝 eos GLOB_OFF: float offsets into the refresh constants.
enum RefreshOffset : uint32_t
{
    OffsetViewProjection = 0, OffsetCameraRight = 16, OffsetCameraUp = 20, OffsetCameraPosition = 24, OffsetWindMinimum = 28,
    OffsetWindSize = 32, OffsetWindDimensions = 36, OffsetTiming = 40, OffsetVisualization = 44, OffsetSwirl = 48,
};

using Triple = std::array<double, 3>;

double Hypotenuse(double A, double B, double C) noexcept
{
    const double Values[3] = { A, B, C };
    return ResolveCompensatedHypotenuse(Values);
}

double Hypotenuse(double A, double B) noexcept
{
    const double Values[2] = { A, B };
    return ResolveCompensatedHypotenuse(Values);
}

Triple Subtract(const Triple& A, const Triple& B) noexcept
{
    return { A[0] - B[0], A[1] - B[1], A[2] - B[2] };
}

Triple Cross(const Triple& A, const Triple& B) noexcept
{
    return { A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0] };
}

double Dot(const Triple& A, const Triple& B) noexcept
{
    return A[0] * B[0] + A[1] * B[1] + A[2] * B[2];
}

// 📝 The prototype's Normalize3: Math.hypot, and a zero length divides by one.
Triple Normalize(const Triple& A) noexcept
{
    double Length = Hypotenuse(A[0], A[1], A[2]);
    if (Length == 0.0)
    {
        Length = 1.0;
    }
    return { A[0] / Length, A[1] / Length, A[2] / Length };
}

template <size_t Count>
void Put(std::array<float, Count>& Out, uint32_t Slot, double A, double B = 0.0, double C = 0.0, double D = 0.0) noexcept
{
    const uint32_t Offset = Slot * 4u;
    Out[Offset]           = static_cast<float>(A);
    Out[Offset + 1]       = static_cast<float>(B);
    Out[Offset + 2]       = static_cast<float>(C);
    Out[Offset + 3]       = static_cast<float>(D);
}

template <size_t Count>
void PutAt(std::array<float, Count>& Out, uint32_t Offset, double A, double B, double C, double D) noexcept
{
    Out[Offset]     = static_cast<float>(A);
    Out[Offset + 1] = static_cast<float>(B);
    Out[Offset + 2] = static_cast<float>(C);
    Out[Offset + 3] = static_cast<float>(D);
}

// 📝 The Strand Editor's closed curves (fibres.js CURVES), in the order of LightFibrePathNames.
std::array<double, 2> EvaluateCurve(int32_t Shape, double α) noexcept
{
    switch (Shape)
    {
    case 1: return { std::sin(α), 0.5 * std::sin(2.0 * α) };
    case 2:
    {
        const double ρ = std::cos(5.0 * α);
        return { ρ * std::cos(α), ρ * std::sin(α) };
    }
    case 3: return { std::sin(3.0 * α), 0.6 * std::sin(2.0 * α + 0.5) };
    case 4:
    {
        const double ρ = (0.5 + std::cos(α)) / 1.5;
        return { ρ * std::cos(α), ρ * std::sin(α) };
    }
    case 5:
    {
        const double Cosine = std::cos(α);
        const double Sine   = std::sin(α);
        const auto   Sign   = [](double Value) { return Value > 0.0 ? 1.0 : Value < 0.0 ? -1.0 : Value; };
        return { Sign(Cosine) * std::pow(std::fabs(Cosine), 0.5), 0.36 * Sign(Sine) * std::pow(std::fabs(Sine), 0.5) };
    }
    case 6:
    {
        // 📝 Dipole field line r = L · sin²θ, axis along local y (world Z); one line runs out and back through the dipole.
        const double θ = α / 2.0;
        const double ρ = std::pow(std::sin(θ), 2.0);
        return { ρ * std::sin(θ), ρ * std::cos(θ) };
    }
    default: return { std::cos(α), std::sin(α) };
    }
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    EFFECT UNIFORM
//------------------------------------------------------------------------------------------------------------------------

uint32_t ResolveParticleCapacity(const ParticleEffectParameters& Parameters) noexcept
{
    return static_cast<uint32_t>(std::max(64, Parameters.Capacity));
}

uint32_t ResolveParticleGridDimension(const ParticleEffectParameters& Parameters) noexcept
{
    if (!EvaluateParticleMolecular(Parameters))
    {
        return 1u;
    }
    const double Half   = Parameters.BoxHalfMetres[0];
    const double Cutoff = 2.5 * Parameters.Sigma;
    const double Cells  = std::floor((2.0 * Half) / Cutoff);
    return static_cast<uint32_t>(std::clamp(Cells, 1.0, static_cast<double>(ParticleMolecularGridLimit)));
}

void PackParticleEffectUniform(ParticleEffectUniform& Out, const ParticleEffectParameters& P, const ParticleEffectRefresh& O) noexcept
{
    const Triple& Direction = P.Direction;
    double        Length    = Hypotenuse(Direction[0], Direction[1], Direction[2]);
    if (Length == 0.0)
    {
        Length = 1.0;
    }
    const double Box       = P.BoxHalfMetres[0];
    const double Behaviour = static_cast<double>(static_cast<uint32_t>(P.Behaviour));
    Put(Out, SlotOrigin, O.OriginMetres[0], O.OriginMetres[1], O.OriginMetres[2], P.RadiusMetres);
    Put(Out, SlotDirection, Direction[0] / Length, Direction[1] / Length, Direction[2] / Length, P.SpreadRadians);
    Put(Out, SlotSpeed, P.SpeedMinimum, P.SpeedMaximum, P.Drag, P.Gravity);
    Put(Out, SlotLife, P.LifeMinimumSeconds, P.LifeMaximumSeconds, P.SizeStartMetres, P.SizeEndMetres);
    Put(Out, SlotColourA, P.ColourA[0], P.ColourA[1], P.ColourA[2], P.ColourA[3]);
    Put(Out, SlotColourB, P.ColourB[0], P.ColourB[1], P.ColourB[2], P.ColourB[3]);
    Put(Out, SlotColourC, P.ColourC[0], P.ColourC[1], P.ColourC[2], P.ColourC[3]);
    Put(Out, SlotPhysics, O.StepSeconds, O.TimeSeconds, static_cast<double>(O.Step), Behaviour);
    Put(Out, SlotPhysicsWind, P.WindCoupling, P.Bounce, P.Buoyancy, P.Flutter);
    Put(Out, SlotPhysicsRelease, static_cast<double>(O.Capacity), static_cast<double>(static_cast<uint32_t>(P.ReleaseShape)),
        P.FractionA, static_cast<double>(O.ReleaseCount));
    Put(Out, SlotPhysicsBox, O.Molecular ? Box : P.BoxHalfMetres[0], O.Molecular ? Box : P.BoxHalfMetres[1],
        O.Molecular ? Box : P.BoxHalfMetres[2], static_cast<double>(O.Head));
    Put(Out, SlotMolecular, P.Temperature, P.Epsilon, P.Sigma, P.ReactRate);
    Put(Out, SlotMolecularLattice, O.CellMetres, static_cast<double>(O.GridDimension), static_cast<double>(ParticleMolecularSlots),
        P.Dissociation);
    if (P.Behaviour == ParticleBehaviour::Flocking)
    {
        Put(Out, SlotMolecularReach, P.SwarmRadiusMetres, P.SpeedMaximum, 0.0, 0.0);
    }
    else
    {
        Put(Out, SlotMolecularReach, std::min(P.ReactRadius, 2.5 * P.Sigma), P.Damping, 0.0, 0.0);
    }
    Put(Out, SlotRelease, static_cast<double>(O.Head), static_cast<double>(O.Seed),
        static_cast<double>(static_cast<uint32_t>(P.Appearance)), static_cast<double>(static_cast<uint32_t>(P.LeafSurface)));
    Put(Out, SlotMiscellany, P.SizeScale, P.PulseHz, P.PulseDepth, 0.0);
    if (P.Behaviour == ParticleBehaviour::VisualEffect)
    {
        // 📝 The transition fields: lattice slot = wave (1 melt, 2 glitch), butterflies, flight mode (0 burst or fall,
        //    1 rebuild, 2 stack), fragment flag; reach slot = hold minimum, hold spread, burst share, fragment life;
        //    miscellany w = the launch distance (a rebuild's start distance, a stack's drop height).
        const std::optional<ParticleTransition>& T = P.Transition;
        const double Wave = T ? static_cast<double>(static_cast<uint32_t>(T->Wave)) : 0.0;
        Put(Out, SlotMolecularLattice, Wave, T && T->Butterflies ? 1.0 : 0.0, T ? static_cast<double>(T->Assemble) : 0.0,
            T && T->Fragment ? 1.0 : 0.0);
        Put(Out, SlotMolecularReach, T ? T->HoldMinimumSeconds : 0.0, T ? T->HoldSpreadSeconds : 0.0, T ? T->BurstShare : 0.0,
            T ? T->FragmentLifeSeconds : 0.0);
        Put(Out, SlotMiscellany, P.SizeScale, P.PulseHz, P.PulseDepth, T && T->LaunchDistanceMetres != 0.0 ? T->LaunchDistanceMetres : 0.0);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    LIGHT FIBRES
//------------------------------------------------------------------------------------------------------------------------

void PackLightFibreUniform(LightFibreUniform& Out, const ParticleEffectParameters& P, const LightFibreRefresh& R)
{
    Out.fill(0.0f);
    if (!P.LightFibre)
    {
        return;
    }
    const LightFibreParameters& F         = *P.LightFibre;
    const Triple&               Origin    = P.OriginMetres;
    const Triple&               Direction = P.Direction;
    double                      Length    = Hypotenuse(Direction[0], Direction[1], Direction[2]);
    if (Length == 0.0)
    {
        Length = 1.0;
    }
    // 📝 The curve is built with its path plane as XY and its lift as Z; the shader swaps Z and Y into the editor's Y-up world,
    //    and the direction is swapped the same way here.
    Put(Out, 0, Origin[0], Origin[1], Origin[2], F.Scale);
    Put(Out, 1, Direction[0] / Length, Direction[2] / Length, Direction[1] / Length, 0.0);
    Put(Out, 2, F.LengthMetres, F.SpreadMetres, F.AmplitudeMetres, F.Frequency);
    Put(Out, 3, F.SheetWidthMetres, F.Ripple, F.Waves, F.PhaseSpread);
    Put(Out, 4, F.TrailLength, R.LoopFraction, F.Thickness, F.Taper);
    Put(Out, 5, F.Intensity, F.Halo, F.Baseline, F.Window);
    Put(Out, 6, F.AccentMix, F.PulseDepth, R.ProjectionScale, R.ViewHeight / 1080.0);
    Put(Out, 7, F.Harmonic, F.WindowCycles, F.PulseRate, static_cast<double>(static_cast<uint32_t>(F.Pulse)));
    Put(Out, 8, static_cast<double>(static_cast<uint32_t>(F.Shape)), static_cast<double>(F.Strands), static_cast<double>(F.Segments),
        static_cast<double>(F.Seed));
    Put(Out, 9, static_cast<double>(LightFibrePathSamples), F.Sparks, F.SparkSize, F.SparkBrightness);
    Put(Out, 10, R.ViewWidth, R.ViewHeight, 0.0, 0.0);

    // 📝 Colour block: slot 10 again (view, stop count, colour mode), 11 the accent, 12 – 19 the stop colours, 20 – 21 the stop
    //    positions. A stable sort by position, as Array.prototype.sort is.
    std::vector<LightFibreStop> Stops(F.Stops.begin(), F.Stops.begin() + std::min<size_t>(F.Stops.size(), LightFibreStopLimit));
    std::stable_sort(Stops.begin(), Stops.end(), [](const LightFibreStop& A, const LightFibreStop& B) { return A.Position < B.Position; });
    const size_t Count = std::max<size_t>(1, Stops.size());
    if (Stops.empty())
    {
        Stops.push_back(LightFibreStop{});
    }
    Put(Out, 10, R.ViewWidth, R.ViewHeight, static_cast<double>(Count), static_cast<double>(static_cast<uint32_t>(F.Colouring)));
    Put(Out, 11, F.AccentColour[0], F.AccentColour[1], F.AccentColour[2], 0.0);
    for (size_t Index = 0; Index < Count; ++Index)
    {
        const std::array<double, 4>& Colour = Stops[Index].Colour;
        Put(Out, static_cast<uint32_t>(12 + Index), Colour[0], Colour[1], Colour[2], 1.0);
    }
    for (uint32_t Index = 0; Index < LightFibreStopLimit; ++Index)
    {
        const double Position              = Index < Stops.size() ? Stops[Index].Position : 1.0;
        Out[(20 + (Index >> 2)) * 4 + (Index & 3)] = static_cast<float>(Position);
    }
}

std::vector<float> SampleLightFibrePath(std::string_view Shape, double SizeMetres, uint32_t Count)
{
    const int32_t  Curve = std::max(0, ResolveLightFibrePathIndex(Shape));
    constexpr int  Dense = 4096;
    std::vector<std::array<double, 2>> Points(Dense + 1);
    for (int Index = 0; Index <= Dense; ++Index)
    {
        Points[Index] = EvaluateCurve(Curve, (static_cast<double>(Index) / Dense) * 2.0 * std::numbers::pi);
    }
    double Furthest = 0.0;
    for (const auto& Point : Points)
    {
        Furthest = std::max(Furthest, Hypotenuse(Point[0], Point[1]));
    }
    const double        Scale = Furthest > 0.0 ? SizeMetres / Furthest : 0.0;
    std::vector<double> Cumulative(Dense + 1, 0.0);
    for (int Index = 1; Index <= Dense; ++Index)
    {
        Cumulative[Index] = Cumulative[Index - 1]
                          + Hypotenuse(Points[Index][0] - Points[Index - 1][0], Points[Index][1] - Points[Index - 1][1]);
    }
    const double       Total = Cumulative[Dense];
    std::vector<float> Out(static_cast<size_t>(Count) * 4u, 0.0f);
    int                Cursor = 0;
    for (uint32_t Sample = 0; Sample < Count; ++Sample)
    {
        const double Target = (static_cast<double>(Sample) / Count) * Total;
        while (Cursor < Dense - 1 && Cumulative[Cursor + 1] < Target)
        {
            ++Cursor;
        }
        const double Span   = Cumulative[Cursor + 1] - Cumulative[Cursor];
        const double Along  = Span > 0.0 ? (Target - Cumulative[Cursor]) / Span : 0.0;
        const auto&  A      = Points[Cursor];
        const auto&  B      = Points[Cursor + 1];
        Out[Sample * 4]     = static_cast<float>((A[0] + (B[0] - A[0]) * Along) * Scale);
        Out[Sample * 4 + 1] = static_cast<float>((A[1] + (B[1] - A[1]) * Along) * Scale);
    }
    return Out;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    CAMERA AND SCENE
//------------------------------------------------------------------------------------------------------------------------

ParticleCameraPose ConvertSceneCameraToParticleAxes(const ParticleCameraPose& SceneCamera) noexcept
{
    const auto ConvertAxes = [](const Triple& SceneVector) -> Triple { return { SceneVector[0], SceneVector[2], -SceneVector[1] }; };
    return { ConvertAxes(SceneCamera.Position), ConvertAxes(SceneCamera.Target), ConvertAxes(SceneCamera.Up), SceneCamera.VerticalFieldOfView };
}

ParticleCameraReading ResolveParticleCamera(const ParticleCameraPose& Camera, double Aspect) noexcept
{
    const Triple Eye     = Camera.Position;
    const Triple Up      = Camera.Up;
    const Triple Forward = Normalize(Subtract(Camera.Target, Eye));
    const Triple Side    = Normalize(Cross(Forward, Up));
    const Triple Upward  = Cross(Side, Forward);

    // 📝 ConstructLookAt and ConstructPerspective return Float32Arrays: their entries are floats before the product.
    const std::array<float, 16> View = {
        static_cast<float>(Side[0]), static_cast<float>(Upward[0]), static_cast<float>(-Forward[0]), 0.0f,
        static_cast<float>(Side[1]), static_cast<float>(Upward[1]), static_cast<float>(-Forward[1]), 0.0f,
        static_cast<float>(Side[2]), static_cast<float>(Upward[2]), static_cast<float>(-Forward[2]), 0.0f,
        static_cast<float>(-Dot(Side, Eye)), static_cast<float>(-Dot(Upward, Eye)), static_cast<float>(Dot(Forward, Eye)), 1.0f,
    };
    const double Near   = 0.05;
    const double Far    = 400.0;
    const double Focal  = 1.0 / std::tan(Camera.VerticalFieldOfView * 0.5);
    const std::array<float, 16> Projection = {
        static_cast<float>(Focal / Aspect), 0.0f, 0.0f, 0.0f,
        0.0f, static_cast<float>(Focal), 0.0f, 0.0f,
        0.0f, 0.0f, static_cast<float>(Far / (Near - Far)), -1.0f,
        0.0f, 0.0f, static_cast<float>((Near * Far) / (Near - Far)), 0.0f,
    };
    ParticleCameraReading Reading;
    for (int Column = 0; Column < 4; ++Column)
    {
        for (int Row = 0; Row < 4; ++Row)
        {
            double Sum = 0.0;
            for (int Inner = 0; Inner < 4; ++Inner)
            {
                Sum += static_cast<double>(Projection[Inner * 4 + Row]) * static_cast<double>(View[Column * 4 + Inner]);
            }
            Reading.ViewProjection[Column * 4 + Row] = static_cast<float>(Sum);
        }
    }
    const Triple Right = Normalize(Cross(Forward, Up));
    Reading.Eye        = Eye;
    Reading.Right      = Right;
    Reading.Up         = Cross(Right, Forward);
    return Reading;
}

ParticleCameraReading ResolveParticleCamera(const ParticleOrbitCamera& Camera, double Aspect) noexcept
{
    const double Cosine = std::cos(Camera.Pitch);
    const double Sine   = std::sin(Camera.Pitch);
    const Triple Eye    = { Camera.Target[0] + Camera.Distance * Cosine * std::sin(Camera.Yaw), Camera.Target[1] + Camera.Distance * Sine,
                            Camera.Target[2] + Camera.Distance * Cosine * std::cos(Camera.Yaw) };
    const ParticleCameraPose Pose{ Eye, Camera.Target, { 0.0, 1.0, 0.0 }, DegreesToRadians(45.0) };
    return ResolveParticleCamera(Pose, Aspect);
}
void PackParticleRefreshConstants(ParticleRefreshConstants& Out, const ParticleCameraReading& Camera, const ParticleWindSettings& Wind,
                                  const ParticleRefreshReadings& Readings) noexcept
{
    Out.fill(0.0f);
    std::copy(Camera.ViewProjection.begin(), Camera.ViewProjection.end(), Out.begin() + OffsetViewProjection);
    PutAt(Out, OffsetCameraRight, Camera.Right[0], Camera.Right[1], Camera.Right[2], 0.0);
    PutAt(Out, OffsetCameraUp, Camera.Up[0], Camera.Up[1], Camera.Up[2], 0.0);
    PutAt(Out, OffsetCameraPosition, Camera.Eye[0], Camera.Eye[1], Camera.Eye[2], 1.0);
    PutAt(Out, OffsetWindMinimum, ParticleDomainMinimum[0], ParticleDomainMinimum[1], ParticleDomainMinimum[2], 0.0);
    PutAt(Out, OffsetWindSize, ParticleDomainSize[0], ParticleDomainSize[1], ParticleDomainSize[2], 0.0);
    PutAt(Out, OffsetWindDimensions, ParticleDomainDimensions[0], ParticleDomainDimensions[1], ParticleDomainDimensions[2],
          static_cast<double>(Readings.FlowCount));
    PutAt(Out, OffsetTiming, Readings.TimeSeconds, Readings.DeltaSeconds, static_cast<double>(Readings.Step), Wind.WindScale);
    PutAt(Out, OffsetVisualization, Wind.ArrowReferenceMps, 0.012, Readings.LightningFlash, Wind.Turbulence);
    PutAt(Out, OffsetSwirl, Wind.Swirl, 0.45, 0.22, Wind.ArrowStride != 0.0 ? Wind.ArrowStride : 3.0);
}

void PackParticleWindComponents(ParticleWindComponents& Out, std::span<const ParticleLatticeComponent> Lattice) noexcept
{
    Out.fill(0.0f);
    const size_t Count = std::min<size_t>(Lattice.size(), ParticleWindComponentLimit);
    for (size_t Index = 0; Index < Count; ++Index)
    {
        const ParticleLatticeComponent& Component = Lattice[Index];
        const uint32_t                  Offset    = static_cast<uint32_t>(Index) * 8u;
        PutAt(Out, Offset, Component.X, Component.Z, std::max(0.5, Component.Radius), static_cast<double>(Component.Slot));
        PutAt(Out, Offset + 4, Component.Strength, DegreesToRadians(Component.BearingDegrees), Component.Rate,
              Component.Enabled ? 1.0 : 0.0);
    }
}

void PackParticleAccelerationFields(ParticleAccelerationBlock& Out, std::span<const ParticleEffectPlacement> Effects,
                                    std::span<const ParticleAccelerationEntry> Entries, double TimeSeconds) noexcept
{
    Out.fill(0.0f);
    uint32_t   Count = 0;
    const auto Place = [&](int32_t Slot, const Triple& Position, double Radius, double Strength, double Swirl, double Swallow,
                           double Begins, double Duration, double Period)
    {
        if (Count >= ParticleAccelerationLimit)
        {
            return;
        }
        const uint32_t Offset = (1u + 3u * Count) * 4u;
        PutAt(Out, Offset, Position[0], Position[1], Position[2], Radius);
        PutAt(Out, Offset + 4, static_cast<double>(Slot), Strength, Swirl, Swallow);
        PutAt(Out, Offset + 8, Begins, Duration, Period, 0.0);
        ++Count;
    };
    for (const ParticleEffectPlacement& Effect : Effects)
    {
        const ParticleEffectParameters* P = Effect.Parameters;
        if (!P || !P->Visible || !P->Attractor || !P->Attractor->Enabled)
        {
            continue;
        }
        const ParticleAttractor& A = *P->Attractor;
        Place(0, P->OriginMetres, A.RadiusMetres, A.Strength, A.Swirl, A.SwallowMetres, 0.0, 1.0e9, 0.0);
    }
    for (const ParticleEffectPlacement& Effect : Effects)
    {
        const ParticleEffectParameters* P = Effect.Parameters;
        if (!P || !P->Visible || !P->MagneticDipole)
        {
            continue;
        }
        const ParticleMagneticDipole& Dipole = *P->MagneticDipole;
        Place(3, P->OriginMetres, Dipole.RadiusMetres, Dipole.Strength, Dipole.Guide, 0.0, 0.0, 1.0e9, 0.0);
    }
    for (const ParticleAccelerationEntry& Entry : Entries)
    {
        Place(Entry.Slot, Entry.Position, Entry.Radius, Entry.Strength, Entry.Swirl, Entry.Swallow, Entry.Begins, Entry.DurationSeconds,
              Entry.PeriodSeconds);
    }
    Out[0] = static_cast<float>(Count);
    Out[1] = static_cast<float>(TimeSeconds);
}

ParticleLensingReading PackParticleLensing(ParticleLensingBlock& Out, std::span<const ParticleEffectPlacement> Effects,
                                           const ParticleCameraReading& Camera, double Aspect, double TimeSeconds,
                                           double VerticalFieldOfView) noexcept
{
    Out.fill(0.0f);
    ParticleLensingReading Reading;
    const std::array<float, 16>& M     = Camera.ViewProjection;
    const double                 Scale = 0.5 / std::tan(VerticalFieldOfView * 0.5);
    struct ScreenPoint
    {
        double U = 0.0;
        double V = 0.0;
        double K = 0.0;
        bool   Visible = false;
    };
    const auto Project = [&](const Triple& Origin)
    {
        double Clip[4];
        for (int Row = 0; Row < 4; ++Row)
        {
            Clip[Row] = static_cast<double>(M[Row]) * Origin[0] + static_cast<double>(M[4 + Row]) * Origin[1]
                      + static_cast<double>(M[8 + Row]) * Origin[2] + static_cast<double>(M[12 + Row]);
        }
        ScreenPoint Point;
        if (Clip[3] <= 0.01)
        {
            return Point;
        }
        const double Separation = Hypotenuse(Origin[0] - Camera.Eye[0], Origin[1] - Camera.Eye[1], Origin[2] - Camera.Eye[2]);
        Point.U       = (Clip[0] / Clip[3]) * 0.5 + 0.5;
        Point.V       = 0.5 - (Clip[1] / Clip[3]) * 0.5;
        Point.K       = Scale / std::max(Separation, 0.01);
        Point.Visible = true;
        return Point;
    };
    for (const ParticleEffectPlacement& Effect : Effects)
    {
        const ParticleEffectParameters* P = Effect.Parameters;
        if (!P || !P->Visible || !P->Lensing || Reading.HoleCount >= 2)
        {
            continue;
        }
        const ScreenPoint Point = Project(P->OriginMetres);
        if (!Point.Visible)
        {
            continue;
        }
        const ParticleLensing& Hole = *P->Lensing;
        PutAt(Out, Reading.HoleCount * 4, Point.U, Point.V, Hole.EventRadiusMetres * Hole.EinsteinRatio * Point.K, Hole.EventRadiusMetres * Point.K);
        ++Reading.HoleCount;
    }
    for (const ParticleEffectPlacement& Effect : Effects)
    {
        const ParticleEffectParameters* P = Effect.Parameters;
        if (!P || !P->Visible || !P->HeatShimmer || Reading.ShimmerCount >= 2)
        {
            continue;
        }
        const ScreenPoint Point = Project(P->OriginMetres);
        if (!Point.Visible)
        {
            continue;
        }
        const ParticleHeatShimmer& Shimmer = *P->HeatShimmer;
        PutAt(Out, 12 + Reading.ShimmerCount * 8, Point.U, Point.V, Shimmer.RadiusMetres * Point.K, Shimmer.Strength);
        PutAt(Out, 16 + Reading.ShimmerCount * 8, TimeSeconds * Shimmer.Rate, Shimmer.Frequency, 0.0, 0.0);
        ++Reading.ShimmerCount;
    }
    Out[8]  = static_cast<float>(Reading.HoleCount);
    Out[9]  = static_cast<float>(Aspect);
    Out[10] = 0.35f;
    Out[11] = static_cast<float>(Reading.ShimmerCount);
    return Reading;
}

std::vector<float> SampleParticleWindLattice(const IFieldSampler& Field, const std::array<double, 3>& FieldOriginMetres,
                                             bool IncludeCurlSwirl)
{
    const size_t CellCount = static_cast<size_t>(ParticleDomainDimensions[0]) * ParticleDomainDimensions[1] * ParticleDomainDimensions[2];
    std::vector<float> Samples(CellCount * 4u, 0.0f);
    if (!Field.QueryFieldEnabled()) return Samples;

    const double CellSpan = std::max({ ParticleDomainSize[0] / ParticleDomainDimensions[0],
                                       ParticleDomainSize[1] / ParticleDomainDimensions[1],
                                       ParticleDomainSize[2] / ParticleDomainDimensions[2] });
    for (uint32_t Z = 0; Z < ParticleDomainDimensions[2]; ++Z)
        for (uint32_t Y = 0; Y < ParticleDomainDimensions[1]; ++Y)
            for (uint32_t X = 0; X < ParticleDomainDimensions[0]; ++X)
            {
                const Vec3d Position{
                    FieldOriginMetres[0] + ParticleDomainMinimum[0] + (static_cast<double>(X) + 0.5) * ParticleDomainSize[0] / ParticleDomainDimensions[0],
                    FieldOriginMetres[1] + ParticleDomainMinimum[1] + (static_cast<double>(Y) + 0.5) * ParticleDomainSize[1] / ParticleDomainDimensions[1],
                    FieldOriginMetres[2] + ParticleDomainMinimum[2] + (static_cast<double>(Z) + 0.5) * ParticleDomainSize[2] / ParticleDomainDimensions[2] };
                Vec3d Flow = Field.SampleFieldFlow(Position, CellSpan, IncludeCurlSwirl);
                if (!std::isfinite(Flow.X)) Flow.X = 0.0;
                if (!std::isfinite(Flow.Y)) Flow.Y = 0.0;
                if (!std::isfinite(Flow.Z)) Flow.Z = 0.0;
                const size_t Texel = X + static_cast<size_t>(ParticleDomainDimensions[0]) *
                                           (Y + static_cast<size_t>(ParticleDomainDimensions[1]) * Z);
                const size_t Offset = Texel * 4u;
                Samples[Offset]     = static_cast<float>(Flow.X);
                Samples[Offset + 1] = static_cast<float>(Flow.Y);
                Samples[Offset + 2] = static_cast<float>(Flow.Z);
                Samples[Offset + 3] = static_cast<float>(std::hypot(Flow.X, Flow.Y, Flow.Z));
            }
    return Samples;
}

} // namespace Frontier
