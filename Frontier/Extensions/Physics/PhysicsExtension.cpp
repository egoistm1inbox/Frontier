/*==========================================================================================================================================
                                                            PHYSICSEXTENSION.CPP
==========================================================================================================================================*/
// 🧩 Level records into bodies, incremental signature hashing, background PhysicsExecutionThread, and world restoration.

#include "Frontier/Extensions/Physics/PhysicsExtension.h"

#include "Frontier/Engine/Foundation/Constants.h"
#include "Frontier/Engine/Scene/ComposedSceneEntry.h"
#include "Frontier/Engine/Scene/WorldSpace.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <limits>
#include <thread>

namespace Frontier
{

namespace
{

constexpr double StepSeconds = 1.0 / 60.0;

std::array<double, 3> ToDouble(const float Values[3])
{
    return { Values[0], Values[1], Values[2] };
}

std::array<double, 3> Conjugated(const std::array<double, 4>& Q, const std::array<double, 3>& Vector)
{
    return RotatePhysicsVector({ -Q[0], -Q[1], -Q[2], Q[3] }, Vector);
}

void HashCombine(uint64_t& Seed, uint64_t Value) noexcept
{
    Seed ^= Value + 0x9e3779b97f4a7c15ull + (Seed << 6) + (Seed >> 2);
}

void HashFloatTriple(uint64_t& Seed, const float Values[3]) noexcept
{
    for (int i = 0; i < 3; ++i)
    {
        uint32_t Bits = 0;
        std::memcpy(&Bits, &Values[i], sizeof(Bits));
        HashCombine(Seed, Bits);
    }
}

} // namespace

PhysicsExtension::PhysicsExtension() = default;

PhysicsExtension::~PhysicsExtension()
{
    StopExecutionThread();
}

uint64_t PhysicsExtension::ComputeWorldBindingSignature(const WorldSpace& World)
{
    uint64_t Seed = 0xcbf29ce484222325ull;
    for (const SceneRecordBase* Entry : World.FindAllByType("Geometry"))
    {
        if (const auto* G = dynamic_cast<const GeometryRecord*>(Entry))
        {
            const GeometryConfiguration& Cfg = G->QueryConfiguration();
            HashCombine(Seed, G->QueryToken().Value);
            HashCombine(Seed, Cfg.Physics ? 1u : 0u);
            HashCombine(Seed, Cfg.Visible ? 1u : 0u);
            HashCombine(Seed, Cfg.Resolved.Shown);
            HashFloatTriple(Seed, Cfg.Resolved.BoundsMinimum);
            HashFloatTriple(Seed, Cfg.Resolved.BoundsMaximum);
        }
    }
    for (const SceneRecordBase* Entry : World.FindAllByType("RigidBody"))
    {
        if (const auto* R = dynamic_cast<const RigidBodyRecord*>(Entry))
        {
            HashCombine(Seed, R->QueryToken().Value);
            HashCombine(Seed, R->QueryPhysics().Enabled ? 1u : 0u);
            HashFloatTriple(Seed, R->QuerySpatial().PositionMetres);
        }
    }
    return Seed;
}

size_t PhysicsExtension::Begin(WorldSpace& World, const PhysicsSpaceSettings& Settings)
{
    StopExecutionThread();
    if (Space)
    {
        End(World);
    }
    {
        std::lock_guard<std::mutex> Guard(SpaceMutex_);
        Space = std::make_unique<PhysicsSpace>(Settings);
    }
    return PopulateWorldBodies(World);
}

size_t PhysicsExtension::BeginWithSubstrate(WorldSpace&                      World,
                                            std::unique_ptr<IPhysicsSubstrate> Substrate,
                                            const PhysicsSpaceSettings&        Settings)
{
    StopExecutionThread();
    if (Space)
    {
        End(World);
    }
    {
        std::lock_guard<std::mutex> Guard(SpaceMutex_);
        Space = std::make_unique<PhysicsSpace>(std::move(Substrate), Settings);
    }
    return PopulateWorldBodies(World);
}

size_t PhysicsExtension::PopulateWorldBodies(WorldSpace& World)
{
    std::lock_guard<std::mutex> Guard(SpaceMutex_);
    Links.clear();
    Tally          = {};
    Remainder      = 0.0;
    LastSignature_ = ComputeWorldBindingSignature(World);

    // ① the ground: a 4 km slab whose top is z = 0
    PhysicsBodyDescriptor Ground;
    Ground.Shape            = PhysicsShape::Box;
    Ground.HalfExtentMetres = { 2000.0, 2000.0, 1.0 };
    Ground.PositionMetres   = { 0.0, 0.0, -1.0 };
    Ground.Motion           = PhysicsMotion::Fixed;
    Ground.Friction         = 0.8;
    Ground.SurfaceClass     = SurfaceMaterialClass::Concrete;
    if (Space->AddBody(Ground) != std::numeric_limits<uint32_t>::max())
    {
        ++Tally.Fixed;
    }

    // ② Geometry records: Physics on -> moving box; static visible -> fixed collider
    for (const SceneRecordBase* Entry : World.FindAllByType("Geometry"))
    {
        auto* Record = dynamic_cast<GeometryRecord*>(World.FindRecord(Entry->QueryToken()));
        if (Record == nullptr)
        {
            continue;
        }
        GeometryConfiguration&                   Geometry = Record->AccessConfiguration();
        const GeometryConfiguration::Resolution& Resolved = Geometry.Resolved;
        const std::array<double, 3>              Minimum  = ToDouble(Resolved.BoundsMinimum);
        const std::array<double, 3>              Maximum  = ToDouble(Resolved.BoundsMaximum);
        const std::array<double, 3>              World3   = { Maximum[0] - Minimum[0], Maximum[1] - Minimum[1], Maximum[2] - Minimum[2] };
        const bool                               Bounded  = World3[0] > 1.0e-3 && World3[1] > 1.0e-3 && World3[2] > 1.0e-3;
        if (Resolved.Shown > 1)
        {
            ++Tally.Held;
            continue;
        }
        if (Geometry.Physics)
        {
            const SpatialConfiguration& Spatial = Geometry.Spatial;
            std::array<double, 3> Size = { Resolved.Extent[0] * std::abs(Spatial.Scale[0]),
                                           Resolved.Extent[1] * std::abs(Spatial.Scale[1]),
                                           Resolved.Extent[2] * std::abs(Spatial.Scale[2]) };
            if (!(Size[0] > 1.0e-3 && Size[1] > 1.0e-3 && Size[2] > 1.0e-3))
            {
                if (!Bounded)
                {
                    ++Tally.Skipped;
                    continue;
                }
                Size = World3;
            }
            const std::array<double, 3> Origin      = ToDouble(Spatial.PositionMetres);
            const std::array<double, 4> Orientation = ResolvePhysicsOrientation(ToDouble(Spatial.OrientationDegrees));
            const std::array<double, 3> Centre =
                Bounded ? std::array<double, 3>{ 0.5 * (Minimum[0] + Maximum[0]), 0.5 * (Minimum[1] + Maximum[1]),
                                                 0.5 * (Minimum[2] + Maximum[2]) }
                        : Origin;
            const std::array<double, 3> Offset =
                Conjugated(Orientation, { Centre[0] - Origin[0], Centre[1] - Origin[1], Centre[2] - Origin[2] });
            PhysicsBodyDescriptor Body;
            Body.Record           = Record->QueryToken().Value;
            Body.Shape            = PhysicsShape::Box;
            Body.HalfExtentMetres = { 0.5 * Size[0], 0.5 * Size[1], 0.5 * Size[2] };
            Body.PositionMetres   = Centre;
            Body.Orientation      = Orientation;
            Body.Motion           = PhysicsMotion::Moving;
            const uint32_t Index  = Space->AddBody(Body);
            if (Index == std::numeric_limits<uint32_t>::max())
            {
                ++Tally.Skipped;
                continue;
            }
            Links.push_back({ Index, Record->QueryToken(), true, Offset, Spatial, Geometry.Dynamic });
            Geometry.Dynamic = true;
            ++Tally.Moving;
        }
        else if (Geometry.Visible && Resolved.Shown == 1 && Bounded)
        {
            PhysicsBodyDescriptor Collider;
            Collider.Record           = Record->QueryToken().Value;
            Collider.HalfExtentMetres = { 0.5 * World3[0], 0.5 * World3[1], 0.5 * World3[2] };
            Collider.PositionMetres   = { 0.5 * (Minimum[0] + Maximum[0]), 0.5 * (Minimum[1] + Maximum[1]),
                                          0.5 * (Minimum[2] + Maximum[2]) };
            Collider.Motion           = PhysicsMotion::Fixed;
            if (Space->AddBody(Collider) != std::numeric_limits<uint32_t>::max())
            {
                ++Tally.Fixed;
            }
        }
        else
        {
            ++Tally.Skipped;
        }
    }

    // ③ RigidBody records: spheres of their volume
    for (const SceneRecordBase* Entry : World.FindAllByType("RigidBody"))
    {
        auto* Record = dynamic_cast<RigidBodyRecord*>(World.FindRecord(Entry->QueryToken()));
        if (Record == nullptr || !Record->QueryPhysics().Enabled)
        {
            continue;
        }
        const PhysicsConfiguration& Physics = Record->QueryPhysics();
        const double                Volume  = Physics.Mass.MassKilograms / std::max(1.0e-3f, Physics.Mass.DensityKgPerCubicMetre);
        PhysicsBodyDescriptor       Body;
        Body.Record              = Record->QueryToken().Value;
        Body.Shape               = PhysicsShape::Sphere;
        Body.HalfExtentMetres[0] = std::clamp(std::cbrt(3.0 * Volume / (4.0 * MathConstantsD::Pi)), 0.05, 50.0);
        Body.PositionMetres      = ToDouble(Record->QuerySpatial().PositionMetres);
        Body.Orientation         = ResolvePhysicsOrientation(ToDouble(Record->QuerySpatial().OrientationDegrees));
        Body.Motion              = Physics.DynamicBody ? PhysicsMotion::Moving : PhysicsMotion::Fixed;
        Body.MassKilograms       = Physics.Mass.MassKilograms;
        Body.Friction            = Physics.DynamicFriction;
        Body.Restitution         = Physics.Restitution;
        Body.LinearDamping       = Physics.LinearDamping;
        Body.LinearVelocityMps   = ToDouble(Physics.LinearVelocityMps);
        Body.AngularVelocityRads = ToDouble(Physics.AngularVelocityRadSec);
        const uint32_t Index     = Space->AddBody(Body);
        if (Index == std::numeric_limits<uint32_t>::max())
        {
            continue;
        }
        if (Body.Motion == PhysicsMotion::Moving)
        {
            Links.push_back({ Index, Record->QueryToken(), false, {}, Record->QuerySpatial(), false });
            ++Tally.Moving;
        }
        else
        {
            ++Tally.Fixed;
        }
    }

    // ④ ComposedSceneEntry<SpatialProfile, MassProfile> bindings
    World.ForEachRecord([&](SceneRecordBase& Base) {
        if (auto* Composed = dynamic_cast<ComposedSceneEntry<SpatialProfile, MassProfile>*>(&Base))
        {
            const SpatialProfile& Spatial = Composed->Query<SpatialProfile>();
            const MassProfile&    Mass    = Composed->Query<MassProfile>();
            PhysicsBodyDescriptor Body;
            Body.Record              = Composed->QueryToken().Value;
            Body.Shape               = PhysicsShape::Box;
            Body.HalfExtentMetres    = { std::max(0.05, 0.5 * std::abs(Spatial.Scale.X)),
                                         std::max(0.05, 0.5 * std::abs(Spatial.Scale.Y)),
                                         std::max(0.05, 0.5 * std::abs(Spatial.Scale.Z)) };
            Body.PositionMetres      = Spatial.PositionMetres.ToArray();
            Body.Orientation         = Spatial.RotationQuaternion().ToArray();
            Body.Motion              = PhysicsMotion::Moving;
            Body.MassKilograms       = Mass.MassKilograms;
            Body.Friction            = Mass.StaticFriction;
            Body.Restitution         = Mass.Restitution;
            Body.LinearDamping       = Mass.LinearDamping;
            const uint32_t Index     = Space->AddBody(Body);
            if (Index != std::numeric_limits<uint32_t>::max())
            {
                SpatialConfiguration Saved{};
                for (size_t i = 0; i < 3; ++i)
                {
                    Saved.PositionMetres[i]     = static_cast<float>(Body.PositionMetres[i]);
                    Saved.OrientationDegrees[i] = static_cast<float>(Spatial.OrientationDegrees.ToArray()[i]);
                    Saved.Scale[i]              = static_cast<float>(Spatial.Scale.ToArray()[i]);
                }
                Links.push_back({ Index, Composed->QueryToken(), false, {}, Saved, false });
                ++Tally.Moving;
            }
        }
    });

    Space->Prepare();
    return Tally.Moving;
}

uint32_t PhysicsExtension::AddTriangleSurfaceCollider(uint64_t                         RecordId,
                                                      const PhysicsTriangleSurfaceShape& Mesh,
                                                      SurfaceMaterialClass             Material)
{
    std::lock_guard<std::mutex> Guard(SpaceMutex_);
    if (!Space)
    {
        return std::numeric_limits<uint32_t>::max();
    }
    PhysicsBodyDescriptor Desc;
    Desc.Record       = RecordId;
    Desc.Shape        = PhysicsShape::TriangleSurface;
    Desc.Motion       = PhysicsMotion::Fixed;
    Desc.SurfaceClass = Material;
    Desc.VariantShape = Mesh;
    const uint32_t Id = Space->AddBody(Desc);
    if (Id != std::numeric_limits<uint32_t>::max())
    {
        ++Tally.Fixed;
    }
    return Id;
}

std::vector<PhysicsImpactEvent> PhysicsExtension::DrainImpactEvents()
{
    std::lock_guard<std::mutex> Guard(SpaceMutex_);
    return Space ? Space->DrainImpactEvents() : std::vector<PhysicsImpactEvent>{};
}

size_t PhysicsExtension::Step(WorldSpace& World, double DeltaSeconds)
{
    std::lock_guard<std::mutex> Guard(SpaceMutex_);
    if (!Space)
    {
        return 0;
    }
    const auto Start = std::chrono::steady_clock::now();
    Remainder += std::clamp(DeltaSeconds, 0.0, 0.25);
    while (Remainder >= StepSeconds)
    {
        Space->Step(StepSeconds);
        Remainder -= StepSeconds;
    }
    size_t Written = 0;
    for (const Link& Moved : Links)
    {
        const PhysicsBodyReading    Reading = Space->ReadBody(Moved.Body);
        const std::array<double, 3> Turned  = RotatePhysicsVector(Reading.Orientation, Moved.CentreOffset);
        const std::array<double, 3> Euler   = ResolvePhysicsEulerDegrees(Reading.Orientation);
        SpatialConfiguration*       Spatial  = nullptr;
        RevisionCounter*            Revision = nullptr;
        if (Moved.Geometry)
        {
            if (auto* Record = dynamic_cast<GeometryRecord*>(World.FindRecord(Moved.Record)))
            {
                Spatial  = &Record->AccessConfiguration().Spatial;
                Revision = &Record->AccessConfiguration();
            }
        }
        else if (auto* Record = dynamic_cast<RigidBodyRecord*>(World.FindRecord(Moved.Record)))
        {
            Spatial  = &Record->AccessSpatial();
            Revision = &Record->AccessSpatial();
            for (size_t Axis = 0; Axis < 3; ++Axis)
            {
                Record->AccessPhysics().LinearVelocityMps[Axis] = static_cast<float>(Reading.LinearVelocityMps[Axis]);
            }
        }
        else if (auto* Composed = dynamic_cast<ComposedSceneEntry<SpatialProfile, MassProfile>*>(World.FindRecord(Moved.Record)))
        {
            SpatialProfile& Profile = Composed->Access<SpatialProfile>();
            Profile.PositionMetres  = { Reading.PositionMetres[0] - Turned[0],
                                        Reading.PositionMetres[1] - Turned[1],
                                        Reading.PositionMetres[2] - Turned[2] };
            Profile.OrientationDegrees = { Euler[0], Euler[1], Euler[2] };
            Profile.AdvanceRevision();
            ++Written;
            continue;
        }
        if (Spatial == nullptr)
        {
            continue;
        }
        for (size_t Axis = 0; Axis < 3; ++Axis)
        {
            Spatial->PositionMetres[Axis]     = static_cast<float>(Reading.PositionMetres[Axis] - Turned[Axis]);
            Spatial->OrientationDegrees[Axis] = static_cast<float>(Euler[Axis]);
        }
        Revision->AdvanceRevision();
        ++Written;
    }
    Tally.StepMilliseconds =
        std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - Start).count();
    return Written;
}

void PhysicsExtension::End(WorldSpace& World)
{
    StopExecutionThread();
    std::lock_guard<std::mutex> Guard(SpaceMutex_);
    for (const Link& Moved : Links)
    {
        if (Moved.Geometry)
        {
            if (auto* Record = dynamic_cast<GeometryRecord*>(World.FindRecord(Moved.Record)))
            {
                GeometryConfiguration& Geometry = Record->AccessConfiguration();
                for (size_t Axis = 0; Axis < 3; ++Axis)
                {
                    Geometry.Spatial.PositionMetres[Axis]     = Moved.Saved.PositionMetres[Axis];
                    Geometry.Spatial.OrientationDegrees[Axis] = Moved.Saved.OrientationDegrees[Axis];
                    Geometry.Spatial.Scale[Axis]              = Moved.Saved.Scale[Axis];
                }
                Geometry.Dynamic = Moved.SavedDynamic;
                Geometry.AdvanceRevision();
            }
        }
        else if (auto* Record = dynamic_cast<RigidBodyRecord*>(World.FindRecord(Moved.Record)))
        {
            SpatialConfiguration& Spatial = Record->AccessSpatial();
            for (size_t Axis = 0; Axis < 3; ++Axis)
            {
                Spatial.PositionMetres[Axis]     = Moved.Saved.PositionMetres[Axis];
                Spatial.OrientationDegrees[Axis] = Moved.Saved.OrientationDegrees[Axis];
            }
            Spatial.AdvanceRevision();
        }
    }
    Links.clear();
    Space.reset();
    Remainder = 0.0;
}

void PhysicsExtension::StartExecutionThread(double StepIntervalSeconds)
{
    StopExecutionThread();
    const double ClampedStep = std::clamp(StepIntervalSeconds, 1.0 / 240.0, 0.1);
    WorkerRunning_.store(true, std::memory_order_release);
    WorkerThread_ = std::jthread([this, ClampedStep](std::stop_token StopToken) {
        uint64_t Seq = 0;
        while (!StopToken.stop_requested() && WorkerRunning_.load(std::memory_order_acquire))
        {
            const auto FrameStart = std::chrono::steady_clock::now();
            PhysicsStepSnapshot Snapshot;
            {
                std::lock_guard<std::mutex> Guard(SpaceMutex_);
                if (Space)
                {
                    Space->Step(ClampedStep);
                    Snapshot.SequenceNumber   = ++Seq;
                    Snapshot.SimulatedSeconds = Space->QuerySimulatedSeconds();
                    Snapshot.Readings.reserve(Links.size());
                    for (const Link& Moved : Links)
                    {
                        Snapshot.Readings.emplace_back(Moved.Record, Space->ReadBody(Moved.Body));
                    }
                    Snapshot.Impacts = Space->DrainImpactEvents();
                }
            }
            if (Snapshot.SequenceNumber > 0)
            {
                std::lock_guard<std::mutex> SnapGuard(SnapshotMutex_);
                LatestSnapshot_    = std::move(Snapshot);
                HasUnreadSnapshot_ = true;
            }
            const auto Elapsed = std::chrono::steady_clock::now() - FrameStart;
            const auto Budget  = std::chrono::duration<double>(ClampedStep);
            if (Elapsed < Budget)
            {
                std::this_thread::sleep_for(Budget - Elapsed);
            }
        }
    });
}

void PhysicsExtension::StopExecutionThread()
{
    WorkerRunning_.store(false, std::memory_order_release);
    if (WorkerThread_.joinable())
    {
        WorkerThread_.request_stop();
        WorkerThread_.join();
    }
}

bool PhysicsExtension::TryConsumeExecutionSnapshot(PhysicsStepSnapshot& OutSnapshot)
{
    std::lock_guard<std::mutex> Guard(SnapshotMutex_);
    if (!HasUnreadSnapshot_)
    {
        return false;
    }
    OutSnapshot        = std::move(LatestSnapshot_);
    HasUnreadSnapshot_ = false;
    return true;
}

} // namespace Frontier
