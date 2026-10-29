//============================================================================================================================================
//                                                        RIGIDBODYSOLVER.CPP
//============================================================================================================================================
// 🧩 Jolt Physics rigid-body world implementation; the sole translation unit that includes JPH:: headers.

#include "RigidBodySolver.h"

#include <Jolt/Jolt.h>
#include <Jolt/RegisterTypes.h>
#include <Jolt/Core/Factory.h>
#include <Jolt/Core/JobSystemThreadPool.h>
#include <Jolt/Core/TempAllocator.h>
#include <Jolt/Physics/Body/Body.h>
#include <Jolt/Physics/Body/BodyCreationSettings.h>
#include <Jolt/Physics/Body/BodyFilter.h>
#include <Jolt/Physics/Body/BodyInterface.h>
#include <Jolt/Physics/Body/BodyLock.h>
#include <Jolt/Physics/Body/BodyLockMulti.h>
#include <Jolt/Physics/Collision/BroadPhase/BroadPhaseLayerInterfaceTable.h>
#include <Jolt/Physics/Collision/BroadPhase/ObjectVsBroadPhaseLayerFilterTable.h>
#include <Jolt/Physics/Collision/CastResult.h>
#include <Jolt/Physics/Collision/CollisionCollector.h>
#include <Jolt/Physics/Collision/CollisionCollectorImpl.h>
#include <Jolt/Physics/Collision/NarrowPhaseQuery.h>
#include <Jolt/Physics/Collision/ObjectLayerPairFilterTable.h>
#include <Jolt/Physics/Collision/RayCast.h>
#include <Jolt/Physics/Collision/Shape/BoxShape.h>
#include <Jolt/Physics/Collision/Shape/CapsuleShape.h>
#include <Jolt/Physics/Collision/Shape/ConvexHullShape.h>
#include <Jolt/Physics/Collision/Shape/CylinderShape.h>
#include <Jolt/Physics/Collision/Shape/HeightFieldShape.h>
#include <Jolt/Physics/Collision/Shape/PlaneShape.h>
#include <Jolt/Physics/Collision/Shape/RotatedTranslatedShape.h>
#include <Jolt/Physics/Collision/Shape/SphereShape.h>
#include <Jolt/Physics/Collision/ShapeCast.h>
#include <Jolt/Physics/Constraints/Constraint.h>
#include <Jolt/Physics/Constraints/DistanceConstraint.h>
#include <Jolt/Physics/Constraints/SpringSettings.h>
#include <Jolt/Physics/PhysicsSettings.h>
#include <Jolt/Physics/PhysicsSystem.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <mutex>
#include <thread>

JPH_SUPPRESS_WARNINGS

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                             PROCESS-WIDE JOLT REGISTRATION
//------------------------------------------------------------------------------------------------------------------------

namespace
{

std::mutex RegistrationMutex;
uint32_t   RegistrationCount = 0u;

void JoltTrace(const char* Format, ...)
{
    va_list Arguments;
    va_start(Arguments, Format);
    char Line[1024] = {};
    std::vsnprintf(Line, sizeof(Line), Format, Arguments);
    va_end(Arguments);
    std::fprintf(stderr, "[Jolt] %s\n", Line);
}

#ifdef JPH_ENABLE_ASSERTS
bool JoltAssertFailed(const char* Expression, const char* Message, const char* File, JPH::uint Line)
{
    std::fprintf(stderr, "[Jolt] %s:%u: (%s) %s\n", File, Line, Expression, Message != nullptr ? Message : "");
    return true;
}
#endif

bool RegisterJoltRuntime() noexcept
{
    std::lock_guard<std::mutex> Guard(RegistrationMutex);
    if (RegistrationCount++ > 0u)
    {
        return true;
    }

    JPH::RegisterDefaultAllocator();
    JPH::Trace = JoltTrace;
    JPH_IF_ENABLE_ASSERTS(JPH::AssertFailed = JoltAssertFailed;)
    JPH::Factory::sInstance = new JPH::Factory();
    JPH::RegisterTypes();
    return JPH::Factory::sInstance != nullptr;
}

void UnregisterJoltRuntime() noexcept
{
    std::lock_guard<std::mutex> Guard(RegistrationMutex);
    if (RegistrationCount == 0u || --RegistrationCount > 0u)
    {
        return;
    }

    JPH::UnregisterTypes();
    delete JPH::Factory::sInstance;
    JPH::Factory::sInstance = nullptr;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    COLLISION LAYERS
//------------------------------------------------------------------------------------------------------------------------

namespace ObjectLayers
{
    constexpr JPH::ObjectLayer NonMoving = 0;
    constexpr JPH::ObjectLayer Moving    = 1;
    constexpr JPH::uint        Count     = 2;
} // namespace ObjectLayers

namespace BroadPhaseLayers
{
    constexpr JPH::BroadPhaseLayer NonMoving(0);
    constexpr JPH::BroadPhaseLayer Moving(1);
    constexpr JPH::uint            Count = 2;
} // namespace BroadPhaseLayers

//------------------------------------------------------------------------------------------------------------------------
//                                                    TYPE CONVERSIONS
//------------------------------------------------------------------------------------------------------------------------

inline JPH::Vec3 ToJolt(const PhysicsVector3& Vector) noexcept
{
    return JPH::Vec3(Vector.X, Vector.Y, Vector.Z);
}

inline JPH::RVec3 ToJoltReal(const PhysicsVector3& Vector) noexcept
{
    return JPH::RVec3(JPH::Real(Vector.X), JPH::Real(Vector.Y), JPH::Real(Vector.Z));
}

inline JPH::Quat ToJolt(const PhysicsQuaternion& Rotation) noexcept
{
    const JPH::Quat Candidate(Rotation.X, Rotation.Y, Rotation.Z, Rotation.W);
    return Candidate.IsNormalized() ? Candidate : Candidate.Normalized();
}

inline PhysicsVector3 FromJolt(JPH::Vec3Arg Vector) noexcept
{
    return PhysicsVector3{Vector.GetX(), Vector.GetY(), Vector.GetZ()};
}

#ifdef JPH_DOUBLE_PRECISION
inline PhysicsVector3 FromJolt(JPH::RVec3Arg Vector) noexcept
{
    return PhysicsVector3{static_cast<float>(Vector.GetX()), static_cast<float>(Vector.GetY()), static_cast<float>(Vector.GetZ())};
}
#endif

inline PhysicsQuaternion FromJolt(JPH::QuatArg Rotation) noexcept
{
    return PhysicsQuaternion{Rotation.GetX(), Rotation.GetY(), Rotation.GetZ(), Rotation.GetW()};
}

inline JPH::EMotionType ToJolt(RigidBodyMotionCategory Motion) noexcept
{
    switch (Motion)
    {
        case RigidBodyMotionCategory::Static:
            return JPH::EMotionType::Static;
        case RigidBodyMotionCategory::Kinematic:
            return JPH::EMotionType::Kinematic;
        case RigidBodyMotionCategory::Dynamic:
            return JPH::EMotionType::Dynamic;
    }
    return JPH::EMotionType::Dynamic;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   SHAPE CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

JPH::ShapeRefC BuildCollisionShape(const CollisionShapeDescription& Description, std::string& OutRefusal) noexcept
{
    const JPH::Quat AlignLocalYToZ = JPH::Quat::sRotation(JPH::Vec3::sAxisX(), 0.5f * JPH::JPH_PI);

    switch (Description.Category)
    {
        case CollisionShapeCategory::Plane:
        {
            const PhysicsVector3 Normal = Description.PlaneNormal.Normalized();
            if (Normal.LengthSquared() < 0.5f)
            {
                OutRefusal = "plane normal is zero";
                return nullptr;
            }
            const float HalfExtent = std::max(1.0f, Description.PlaneHalfExtent);
            JPH::PlaneShapeSettings Settings(JPH::Plane(ToJolt(Normal), -Description.PlaneOffset), nullptr, HalfExtent);
            const JPH::ShapeSettings::ShapeResult Built = Settings.Create();
            if (Built.HasError())
            {
                OutRefusal = Built.GetError().c_str();
                return nullptr;
            }
            return Built.Get();
        }
        case CollisionShapeCategory::Box:
        {
            const JPH::Vec3 Half(
                std::max(0.02f, Description.HalfExtents.X),
                std::max(0.02f, Description.HalfExtents.Y),
                std::max(0.02f, Description.HalfExtents.Z));
            const float ConvexRadius = std::min(0.05f, 0.25f * Half.ReduceMin());
            JPH::BoxShapeSettings Settings(Half, ConvexRadius);
            const JPH::ShapeSettings::ShapeResult Built = Settings.Create();
            if (Built.HasError())
            {
                OutRefusal = Built.GetError().c_str();
                return nullptr;
            }
            return Built.Get();
        }
        case CollisionShapeCategory::Sphere:
        {
            JPH::SphereShapeSettings Settings(std::max(0.02f, Description.Radius));
            const JPH::ShapeSettings::ShapeResult Built = Settings.Create();
            if (Built.HasError())
            {
                OutRefusal = Built.GetError().c_str();
                return nullptr;
            }
            return Built.Get();
        }
        case CollisionShapeCategory::Capsule:
        {
            JPH::CapsuleShapeSettings Inner(std::max(0.01f, Description.HalfHeight), std::max(0.02f, Description.Radius));
            const JPH::ShapeSettings::ShapeResult InnerBuilt = Inner.Create();
            if (InnerBuilt.HasError())
            {
                OutRefusal = InnerBuilt.GetError().c_str();
                return nullptr;
            }
            JPH::RotatedTranslatedShapeSettings Wrapped(JPH::Vec3::sZero(), AlignLocalYToZ, InnerBuilt.Get());
            const JPH::ShapeSettings::ShapeResult Built = Wrapped.Create();
            if (Built.HasError())
            {
                OutRefusal = Built.GetError().c_str();
                return nullptr;
            }
            return Built.Get();
        }
        case CollisionShapeCategory::Cylinder:
        {
            const float HalfHeight   = std::max(0.02f, Description.HalfHeight);
            const float Radius       = std::max(0.02f, Description.Radius);
            const float ConvexRadius = std::min(0.05f, 0.25f * std::min(HalfHeight, Radius));
            JPH::CylinderShapeSettings Inner(HalfHeight, Radius, ConvexRadius);
            const JPH::ShapeSettings::ShapeResult InnerBuilt = Inner.Create();
            if (InnerBuilt.HasError())
            {
                OutRefusal = InnerBuilt.GetError().c_str();
                return nullptr;
            }
            JPH::RotatedTranslatedShapeSettings Wrapped(JPH::Vec3::sZero(), AlignLocalYToZ, InnerBuilt.Get());
            const JPH::ShapeSettings::ShapeResult Built = Wrapped.Create();
            if (Built.HasError())
            {
                OutRefusal = Built.GetError().c_str();
                return nullptr;
            }
            return Built.Get();
        }
        case CollisionShapeCategory::ConvexHull:
        {
            if (Description.HullPoints.size() < 4u)
            {
                OutRefusal = "convex hull requires at least 4 local vertices";
                return nullptr;
            }
            JPH::Array<JPH::Vec3> Vertices;
            Vertices.reserve(Description.HullPoints.size());
            for (const PhysicsVector3& Point : Description.HullPoints)
            {
                Vertices.push_back(ToJolt(Point));
            }
            JPH::ConvexHullShapeSettings Settings(Vertices, 0.02f);
            const JPH::ShapeSettings::ShapeResult Built = Settings.Create();
            if (Built.HasError())
            {
                OutRefusal = Built.GetError().c_str();
                return nullptr;
            }
            return Built.Get();
        }
        case CollisionShapeCategory::Heightfield:
        {
            OutRefusal = "use CreateHeightfieldBody() to construct Heightfield bodies";
            return nullptr;
        }
    }

    OutRefusal = "unrecognized collision shape category";
    return nullptr;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    OPAQUE JOLT WORLD
//------------------------------------------------------------------------------------------------------------------------

struct RigidBodySolver::JoltWorld
{
    struct BodyRecord
    {
        JPH::BodyID             Body;                                         // [-] - Jolt body handle
        std::string             Name;                                         // [-] - Diagnostic name
        RigidBodyMotionCategory Motion = RigidBodyMotionCategory::Dynamic;
        CollisionShapeCategory  Shape  = CollisionShapeCategory::Box;
        bool                    Alive  = false;
    };

    struct ConstraintRecord
    {
        JPH::Ref<JPH::Constraint> Constraint;                                 // [-] - Reference-counted Jolt constraint
        bool                      Alive = false;
    };

    struct LayerScheme
    {
        JPH::BroadPhaseLayerInterfaceTable BroadPhaseTable;
        JPH::ObjectLayerPairFilterTable    PairTable;

        LayerScheme()
            : BroadPhaseTable(ObjectLayers::Count, BroadPhaseLayers::Count)
            , PairTable(ObjectLayers::Count)
        {
            BroadPhaseTable.MapObjectToBroadPhaseLayer(ObjectLayers::NonMoving, BroadPhaseLayers::NonMoving);
            BroadPhaseTable.MapObjectToBroadPhaseLayer(ObjectLayers::Moving, BroadPhaseLayers::Moving);
            PairTable.EnableCollision(ObjectLayers::Moving, ObjectLayers::Moving);
            PairTable.EnableCollision(ObjectLayers::Moving, ObjectLayers::NonMoving);
        }
    };

    JPH::TempAllocatorImpl                  TemporaryAllocator;
    JPH::JobSystemThreadPool                Jobs;
    LayerScheme                             Layers;
    JPH::ObjectVsBroadPhaseLayerFilterTable ObjectVsBroadPhaseTable;
    JPH::PhysicsSystem                      Physics;
    std::vector<BodyRecord>                 Records;
    std::vector<uint32_t>                   FreeSlots;
    std::vector<ConstraintRecord>           Constraints;
    std::vector<uint32_t>                   FreeConstraintSlots;

    [[nodiscard]] static int ResolveWorkerThreads() noexcept
    {
        const int Lanes = static_cast<int>(std::thread::hardware_concurrency());
        if (Lanes <= 0)
        {
            return 1;
        }
        return std::clamp(Lanes - 2, 1, 4);
    }

    explicit JoltWorld(const RigidBodyConfiguration& Config)
        : TemporaryAllocator(static_cast<JPH::uint>(std::max<uint32_t>(Config.TemporaryAllocationBytes, 1u * 1024u * 1024u)))
        , Jobs(
              JPH::cMaxPhysicsJobs,
              JPH::cMaxPhysicsBarriers,
              Config.WorkerThreads > 0u ? static_cast<int>(Config.WorkerThreads) : ResolveWorkerThreads())
        , Layers()
        , ObjectVsBroadPhaseTable(Layers.BroadPhaseTable, BroadPhaseLayers::Count, Layers.PairTable, ObjectLayers::Count)
    {
        Physics.Init(
            Config.MaxBodies,
            0u,
            Config.MaxBodyPairs,
            Config.MaxContactConstraints,
            Layers.BroadPhaseTable,
            ObjectVsBroadPhaseTable,
            Layers.PairTable);
        Physics.SetGravity(ToJolt(Config.Gravity));

        JPH::PhysicsSettings Settings            = Physics.GetPhysicsSettings();
        Settings.mSpeculativeContactDistance     = std::max(0.0f, Config.SpeculativeContactDistance);
        Settings.mPenetrationSlop                = std::max(0.0f, Config.PenetrationSlop);
        Settings.mTimeBeforeSleep                = std::max(0.0f, Config.TimeBeforeSleepSeconds);
        Physics.SetPhysicsSettings(Settings);
    }

    [[nodiscard]] const BodyRecord* Find(RigidBodyIdentity Identity) const noexcept
    {
        if (Identity >= Records.size() || !Records[Identity].Alive)
        {
            return nullptr;
        }
        return &Records[Identity];
    }

    [[nodiscard]] RigidBodyIdentity IdentityOf(JPH::BodyID Identifier) const noexcept
    {
        if (Identifier.IsInvalid())
        {
            return InvalidRigidBody;
        }
        const uint32_t Slot = static_cast<uint32_t>(Physics.GetBodyInterface().GetUserData(Identifier));
        if (Slot < Records.size() && Records[Slot].Alive && Records[Slot].Body == Identifier)
        {
            return Slot;
        }
        return InvalidRigidBody;
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                                        LIFECYCLE
//------------------------------------------------------------------------------------------------------------------------

RigidBodySolver::RigidBodySolver() noexcept = default;

RigidBodySolver::~RigidBodySolver() noexcept
{
    Retire();
}

bool RigidBodySolver::Bring(const RigidBodyConfiguration& RequestedConfiguration) noexcept
{
    if (WorldActive)
    {
        LastRefusal = "Bring() invoked while world is already active";
        return false;
    }
    if (!(RequestedConfiguration.FixedStepSeconds > 0.0f) || RequestedConfiguration.MaxBodies == 0u)
    {
        LastRefusal = "FixedStepSeconds must be positive and MaxBodies non-zero";
        return false;
    }
    if (!RegisterJoltRuntime())
    {
        LastRefusal = "Jolt runtime type registration failed";
        return false;
    }

    Configuration = RequestedConfiguration;
    Accumulator   = 0.0f;
    Metrics       = RigidBodyMetrics{};
    World         = std::make_unique<JoltWorld>(Configuration);
    WorldActive   = true;
    LastRefusal.clear();
    return true;
}

void RigidBodySolver::Retire() noexcept
{
    if (!World)
    {
        return;
    }
    DestroyAllBodies();
    World.reset();
    WorldActive = false;
    UnregisterJoltRuntime();
}

const char* RigidBodySolver::QueryJoltVersion() noexcept
{
    static char Version[32] = {};
    if (Version[0] == '\0')
    {
        std::snprintf(Version, sizeof(Version), "Jolt %d.%d.%d", JPH_VERSION_MAJOR, JPH_VERSION_MINOR, JPH_VERSION_PATCH);
    }
    return Version;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    BODY MANAGEMENT
//------------------------------------------------------------------------------------------------------------------------

RigidBodyIdentity RigidBodySolver::CreateBody(const RigidBodyDescription& Description) noexcept
{
    if (!WorldActive)
    {
        LastRefusal = "solver not active";
        return InvalidRigidBody;
    }
    if (Description.Shape.Category == CollisionShapeCategory::Plane && Description.Motion != RigidBodyMotionCategory::Static)
    {
        LastRefusal = "plane collision shapes require Static motion";
        return InvalidRigidBody;
    }

    const JPH::ShapeRefC Shape = BuildCollisionShape(Description.Shape, LastRefusal);
    if (Shape == nullptr)
    {
        return InvalidRigidBody;
    }

    const bool Moving = Description.Motion != RigidBodyMotionCategory::Static;
    JPH::BodyCreationSettings Settings(
        Shape,
        ToJoltReal(Description.Position),
        ToJolt(Description.Orientation),
        ToJolt(Description.Motion),
        Moving ? ObjectLayers::Moving : ObjectLayers::NonMoving);
    Settings.mLinearVelocity  = ToJolt(Description.LinearVelocity);
    Settings.mAngularVelocity = ToJolt(Description.AngularVelocity);
    Settings.mFriction        = std::max(0.0f, Description.Friction);
    Settings.mRestitution     = std::clamp(Description.Restitution, 0.0f, 1.0f);
    Settings.mLinearDamping   = std::max(0.0f, Description.LinearDamping);
    Settings.mAngularDamping  = std::max(0.0f, Description.AngularDamping);
    Settings.mGravityFactor   = Description.GravityFactor;
    Settings.mAllowSleeping   = Description.AllowSleeping;
    Settings.mMotionQuality   = Description.ContinuousCollision ? JPH::EMotionQuality::LinearCast : JPH::EMotionQuality::Discrete;
    if (Description.Motion == RigidBodyMotionCategory::Dynamic && Description.MassKilograms > 0.0f)
    {
        if (Description.PrincipalInertia.X > 0.0f &&
            Description.PrincipalInertia.Y > 0.0f &&
            Description.PrincipalInertia.Z > 0.0f)
        {
            Settings.mOverrideMassProperties         = JPH::EOverrideMassProperties::MassAndInertiaProvided;
            Settings.mMassPropertiesOverride.mMass   = Description.MassKilograms;
            Settings.mMassPropertiesOverride.mInertia =
                JPH::Mat44::sScale(ToJolt(Description.PrincipalInertia));
        }
        else
        {
            Settings.mOverrideMassProperties       = JPH::EOverrideMassProperties::CalculateInertia;
            Settings.mMassPropertiesOverride.mMass = Description.MassKilograms;
        }
    }

    JPH::BodyInterface& Bodies = World->Physics.GetBodyInterface();
    const JPH::BodyID   Body   = Bodies.CreateAndAddBody(
        Settings, Moving ? JPH::EActivation::Activate : JPH::EActivation::DontActivate);
    if (Body.IsInvalid())
    {
        LastRefusal = "Jolt refused body creation";
        return InvalidRigidBody;
    }

    uint32_t Slot = 0u;
    if (!World->FreeSlots.empty())
    {
        Slot = World->FreeSlots.back();
        World->FreeSlots.pop_back();
    }
    else
    {
        Slot = static_cast<uint32_t>(World->Records.size());
        World->Records.emplace_back();
    }

    JoltWorld::BodyRecord& Record = World->Records[Slot];
    Record.Body                   = Body;
    Record.Name                   = Description.Name;
    Record.Motion                 = Description.Motion;
    Record.Shape                  = Description.Shape.Category;
    Record.Alive                  = true;
    Bodies.SetUserData(Body, Slot);

    Metrics.BodyCount = World->Physics.GetNumBodies();
    return Slot;
}

RigidBodyIdentity RigidBodySolver::CreateHeightfieldBody(const HeightfieldDescription& Description) noexcept
{
    if (!WorldActive)
    {
        LastRefusal = "solver not active";
        return InvalidRigidBody;
    }
    if (Description.Samples == nullptr || Description.SampleCount == 0u || (Description.SampleCount % 8u) != 0u)
    {
        LastRefusal = "heightfield requires non-null samples with SampleCount a non-zero multiple of 8";
        return InvalidRigidBody;
    }

    JPH::HeightFieldShapeSettings Field(
        Description.Samples,
        JPH::Vec3::sZero(),
        JPH::Vec3(Description.SpacingX, Description.HeightScale, Description.SpacingY),
        Description.SampleCount);
    const JPH::ShapeSettings::ShapeResult FieldBuilt = Field.Create();
    if (FieldBuilt.HasError())
    {
        LastRefusal = std::string("heightfield: ") + FieldBuilt.GetError().c_str();
        return InvalidRigidBody;
    }

    JPH::RotatedTranslatedShapeSettings Wrapped(
        JPH::Vec3::sZero(),
        JPH::Quat::sRotation(JPH::Vec3::sAxisX(), 0.5f * JPH::JPH_PI),
        FieldBuilt.Get());
    const JPH::ShapeSettings::ShapeResult WrappedBuilt = Wrapped.Create();
    if (WrappedBuilt.HasError())
    {
        LastRefusal = std::string("heightfield wrap: ") + WrappedBuilt.GetError().c_str();
        return InvalidRigidBody;
    }

    JPH::BodyCreationSettings Settings(
        WrappedBuilt.Get(),
        ToJoltReal(Description.Origin),
        JPH::Quat::sIdentity(),
        JPH::EMotionType::Static,
        ObjectLayers::NonMoving);
    Settings.mFriction    = std::max(0.0f, Description.Friction);
    Settings.mRestitution = std::clamp(Description.Restitution, 0.0f, 1.0f);

    JPH::BodyInterface& Bodies = World->Physics.GetBodyInterface();
    const JPH::BodyID   Body   = Bodies.CreateAndAddBody(Settings, JPH::EActivation::DontActivate);
    if (Body.IsInvalid())
    {
        LastRefusal = "Jolt refused heightfield body";
        return InvalidRigidBody;
    }

    uint32_t Slot = 0u;
    if (!World->FreeSlots.empty())
    {
        Slot = World->FreeSlots.back();
        World->FreeSlots.pop_back();
    }
    else
    {
        Slot = static_cast<uint32_t>(World->Records.size());
        World->Records.emplace_back();
    }

    JoltWorld::BodyRecord& Record = World->Records[Slot];
    Record.Body                   = Body;
    Record.Name                   = Description.Name;
    Record.Motion                 = RigidBodyMotionCategory::Static;
    Record.Shape                  = CollisionShapeCategory::Heightfield;
    Record.Alive                  = true;
    Bodies.SetUserData(Body, Slot);

    Metrics.BodyCount = World->Physics.GetNumBodies();
    return Slot;
}

void RigidBodySolver::DestroyBody(RigidBodyIdentity Identity) noexcept
{
    if (!WorldActive)
    {
        return;
    }
    const JoltWorld::BodyRecord* Record = World->Find(Identity);
    if (Record == nullptr)
    {
        return;
    }

    JPH::BodyInterface& Bodies = World->Physics.GetBodyInterface();
    if (Bodies.IsAdded(Record->Body))
    {
        Bodies.RemoveBody(Record->Body);
    }
    Bodies.DestroyBody(Record->Body);

    World->Records[Identity] = JoltWorld::BodyRecord{};
    World->FreeSlots.push_back(Identity);
    Metrics.BodyCount = World->Physics.GetNumBodies();
}

void RigidBodySolver::DestroyAllBodies() noexcept
{
    if (!World)
    {
        return;
    }

    for (JoltWorld::ConstraintRecord& Record : World->Constraints)
    {
        if (Record.Alive && Record.Constraint != nullptr)
        {
            World->Physics.RemoveConstraint(Record.Constraint.GetPtr());
        }
        Record = JoltWorld::ConstraintRecord{};
    }
    World->Constraints.clear();
    World->FreeConstraintSlots.clear();

    JPH::BodyInterface& Bodies = World->Physics.GetBodyInterface();
    for (const JoltWorld::BodyRecord& Record : World->Records)
    {
        if (Record.Alive)
        {
            if (Bodies.IsAdded(Record.Body))
            {
                Bodies.RemoveBody(Record.Body);
            }
            Bodies.DestroyBody(Record.Body);
        }
    }
    World->Records.clear();
    World->FreeSlots.clear();
    Metrics.BodyCount = World->Physics.GetNumBodies();
}

void RigidBodySolver::OptimizeBroadPhase() noexcept
{
    if (WorldActive)
    {
        World->Physics.OptimizeBroadPhase();
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    TIME INTEGRATION
//------------------------------------------------------------------------------------------------------------------------

void RigidBodySolver::Advance(float Δτ) noexcept
{
    Metrics.StepsLastAdvance = 0u;
    if (!WorldActive || !(Δτ > 0.0f))
    {
        return;
    }

    Accumulator += Δτ;

    const float BacklogLimit = Configuration.FixedStepSeconds * static_cast<float>(std::max(1u, Configuration.MaxStepsPerAdvance));
    if (Accumulator > BacklogLimit)
    {
        Metrics.DroppedSeconds += Accumulator - BacklogLimit;
        Accumulator = BacklogLimit;
    }

    while (Accumulator >= Configuration.FixedStepSeconds)
    {
        (void)StepOnce();
        Accumulator -= Configuration.FixedStepSeconds;
        ++Metrics.StepsLastAdvance;
    }

    Metrics.AccumulatorSeconds = Accumulator;
}

bool RigidBodySolver::StepOnce() noexcept
{
    if (!WorldActive)
    {
        return false;
    }

    using Clock      = std::chrono::steady_clock;
    const auto Start = Clock::now();
    const JPH::EPhysicsUpdateError Error = World->Physics.Update(
        Configuration.FixedStepSeconds,
        static_cast<int>(std::max(1u, Configuration.CollisionStepsPerStep)),
        &World->TemporaryAllocator,
        &World->Jobs);
    Metrics.LastStepMilliseconds = std::chrono::duration<float, std::milli>(Clock::now() - Start).count();

    if (Error != JPH::EPhysicsUpdateError::None)
    {
        char Line[128] = {};
        std::snprintf(Line, sizeof(Line), "Jolt step error 0x%X", static_cast<unsigned>(Error));
        LastRefusal = Line;
    }

    ++Metrics.StepCount;
    Metrics.BodyCount      = World->Physics.GetNumBodies();
    Metrics.AwakeBodyCount = World->Physics.GetNumActiveBodies(JPH::EBodyType::RigidBody);
    return Error == JPH::EPhysicsUpdateError::None;
}

float RigidBodySolver::QueryInterpolationAlpha() const noexcept
{
    return Configuration.FixedStepSeconds > 0.0f ? std::clamp(Accumulator / Configuration.FixedStepSeconds, 0.0f, 1.0f) : 0.0f;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  FORCES & KINEMATICS
//------------------------------------------------------------------------------------------------------------------------

void RigidBodySolver::ApplyImpulse(RigidBodyIdentity Identity, const PhysicsVector3& ImpulseNewtonSeconds) noexcept
{
    if (!WorldActive)
    {
        return;
    }
    if (const JoltWorld::BodyRecord* Record = World->Find(Identity);
        Record != nullptr && Record->Motion == RigidBodyMotionCategory::Dynamic)
    {
        World->Physics.GetBodyInterface().AddImpulse(Record->Body, ToJolt(ImpulseNewtonSeconds));
    }
}

void RigidBodySolver::ApplyAngularImpulse(RigidBodyIdentity Identity, const PhysicsVector3& AngularImpulse) noexcept
{
    if (!WorldActive)
    {
        return;
    }
    if (const JoltWorld::BodyRecord* Record = World->Find(Identity);
        Record != nullptr && Record->Motion == RigidBodyMotionCategory::Dynamic)
    {
        World->Physics.GetBodyInterface().AddAngularImpulse(Record->Body, ToJolt(AngularImpulse));
    }
}

void RigidBodySolver::ApplyForce(RigidBodyIdentity Identity, const PhysicsVector3& ForceNewtons) noexcept
{
    if (!WorldActive)
    {
        return;
    }
    if (const JoltWorld::BodyRecord* Record = World->Find(Identity);
        Record != nullptr && Record->Motion == RigidBodyMotionCategory::Dynamic)
    {
        World->Physics.GetBodyInterface().AddForce(Record->Body, ToJolt(ForceNewtons));
    }
}

void RigidBodySolver::ApplyForceAtPoint(
    RigidBodyIdentity     Identity,
    const PhysicsVector3& ForceNewtons,
    const PhysicsVector3& WorldPoint) noexcept
{
    if (!WorldActive)
    {
        return;
    }
    if (const JoltWorld::BodyRecord* Record = World->Find(Identity);
        Record != nullptr && Record->Motion == RigidBodyMotionCategory::Dynamic)
    {
        World->Physics.GetBodyInterface().AddForce(Record->Body, ToJolt(ForceNewtons), ToJoltReal(WorldPoint));
    }
}

void RigidBodySolver::ApplyTorque(RigidBodyIdentity Identity, const PhysicsVector3& TorqueNewtonMetres) noexcept
{
    if (!WorldActive)
    {
        return;
    }
    if (const JoltWorld::BodyRecord* Record = World->Find(Identity);
        Record != nullptr && Record->Motion == RigidBodyMotionCategory::Dynamic)
    {
        World->Physics.GetBodyInterface().AddTorque(Record->Body, ToJolt(TorqueNewtonMetres));
    }
}

void RigidBodySolver::AssignLinearVelocity(RigidBodyIdentity Identity, const PhysicsVector3& Velocity) noexcept
{
    if (!WorldActive)
    {
        return;
    }
    if (const JoltWorld::BodyRecord* Record = World->Find(Identity);
        Record != nullptr && Record->Motion != RigidBodyMotionCategory::Static)
    {
        World->Physics.GetBodyInterface().SetLinearVelocity(Record->Body, ToJolt(Velocity));
    }
}

void RigidBodySolver::AssignAngularVelocity(RigidBodyIdentity Identity, const PhysicsVector3& AngularVelocity) noexcept
{
    if (!WorldActive)
    {
        return;
    }
    if (const JoltWorld::BodyRecord* Record = World->Find(Identity);
        Record != nullptr && Record->Motion != RigidBodyMotionCategory::Static)
    {
        World->Physics.GetBodyInterface().SetAngularVelocity(Record->Body, ToJolt(AngularVelocity));
    }
}

void RigidBodySolver::Teleport(
    RigidBodyIdentity        Identity,
    const PhysicsVector3&    Position,
    const PhysicsQuaternion& Orientation) noexcept
{
    if (!WorldActive)
    {
        return;
    }
    if (const JoltWorld::BodyRecord* Record = World->Find(Identity); Record != nullptr)
    {
        JPH::BodyInterface& Bodies = World->Physics.GetBodyInterface();
        Bodies.SetPositionAndRotation(
            Record->Body,
            ToJoltReal(Position),
            ToJolt(Orientation),
            Record->Motion == RigidBodyMotionCategory::Static ? JPH::EActivation::DontActivate : JPH::EActivation::Activate);
        if (Record->Motion == RigidBodyMotionCategory::Dynamic)
        {
            Bodies.SetLinearAndAngularVelocity(Record->Body, JPH::Vec3::sZero(), JPH::Vec3::sZero());
        }
    }
}

void RigidBodySolver::MoveKinematic(
    RigidBodyIdentity        Identity,
    const PhysicsVector3&    Position,
    const PhysicsQuaternion& Orientation,
    float                    Δτ) noexcept
{
    if (!WorldActive || !(Δτ > 0.0f))
    {
        return;
    }
    if (const JoltWorld::BodyRecord* Record = World->Find(Identity);
        Record != nullptr && Record->Motion == RigidBodyMotionCategory::Kinematic)
    {
        World->Physics.GetBodyInterface().MoveKinematic(Record->Body, ToJoltReal(Position), ToJolt(Orientation), Δτ);
    }
}

void RigidBodySolver::Activate(RigidBodyIdentity Identity) noexcept
{
    if (!WorldActive)
    {
        return;
    }
    if (const JoltWorld::BodyRecord* Record = World->Find(Identity);
        Record != nullptr && Record->Motion != RigidBodyMotionCategory::Static)
    {
        World->Physics.GetBodyInterface().ActivateBody(Record->Body);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    MASS & VELOCITY
//------------------------------------------------------------------------------------------------------------------------

float RigidBodySolver::QueryBodyMass(RigidBodyIdentity Identity) const noexcept
{
    if (!WorldActive)
    {
        return 0.0f;
    }
    const JoltWorld::BodyRecord* Record = World->Find(Identity);
    if (Record == nullptr || Record->Motion != RigidBodyMotionCategory::Dynamic)
    {
        return 0.0f;
    }

    JPH::BodyLockRead Lock(World->Physics.GetBodyLockInterface(), Record->Body);
    if (!Lock.Succeeded())
    {
        return 0.0f;
    }
    const float InverseMass = Lock.GetBody().GetMotionProperties()->GetInverseMass();
    return InverseMass > 0.0f ? (1.0f / InverseMass) : 0.0f;
}

PhysicsVector3 RigidBodySolver::QueryCenterOfMass(RigidBodyIdentity Identity) const noexcept
{
    if (!WorldActive)
    {
        return {};
    }
    const JoltWorld::BodyRecord* Record = World->Find(Identity);
    if (Record == nullptr)
    {
        return {};
    }
    return FromJolt(World->Physics.GetBodyInterface().GetCenterOfMassPosition(Record->Body));
}

PhysicsVector3 RigidBodySolver::QueryPointVelocity(RigidBodyIdentity Identity, const PhysicsVector3& WorldPoint) const noexcept
{
    if (!WorldActive)
    {
        return {};
    }
    const JoltWorld::BodyRecord* Record = World->Find(Identity);
    if (Record == nullptr || Record->Motion == RigidBodyMotionCategory::Static)
    {
        return {};
    }
    return FromJolt(World->Physics.GetBodyInterface().GetPointVelocity(Record->Body, ToJoltReal(WorldPoint)));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      SCENE QUERIES
//------------------------------------------------------------------------------------------------------------------------

SceneCastReading RigidBodySolver::CastRay(
    const PhysicsVector3& Origin,
    const PhysicsVector3& Direction,
    float                 MaxDistance,
    RigidBodyIdentity     Ignore) const noexcept
{
    SceneCastReading Out;
    if (!WorldActive || !(MaxDistance > 0.0f))
    {
        return Out;
    }

    const PhysicsVector3 UnitDirection = Direction.Normalized();
    if (UnitDirection.LengthSquared() < 0.5f)
    {
        return Out;
    }

    const JPH::RRayCast Ray(ToJoltReal(Origin), ToJolt(UnitDirection * MaxDistance));
    JPH::RayCastResult  Hit;

    JPH::BodyID IgnoreBody;
    if (const JoltWorld::BodyRecord* Ignored = World->Find(Ignore); Ignored != nullptr)
    {
        IgnoreBody = Ignored->Body;
    }
    const JPH::IgnoreSingleBodyFilter BodyFilter(IgnoreBody);

    if (!World->Physics.GetNarrowPhaseQuery().CastRay(Ray, Hit, {}, {}, BodyFilter))
    {
        return Out;
    }

    const JPH::RVec3 ContactPoint = Ray.GetPointOnRay(Hit.mFraction);
    Out.Contact                   = true;
    Out.Fraction                  = Hit.mFraction;
    Out.Distance                  = Hit.mFraction * MaxDistance;
    Out.Position                  = FromJolt(ContactPoint);
    Out.Body                      = World->IdentityOf(Hit.mBodyID);

    JPH::BodyLockRead Lock(World->Physics.GetBodyLockInterface(), Hit.mBodyID);
    if (Lock.Succeeded())
    {
        Out.Normal = FromJolt(Lock.GetBody().GetWorldSpaceSurfaceNormal(Hit.mSubShapeID2, ContactPoint));
    }
    return Out;
}

SceneCastReading RigidBodySolver::CastSphere(
    float                 Radius,
    const PhysicsVector3& From,
    const PhysicsVector3& Sweep,
    RigidBodyIdentity     Ignore) const noexcept
{
    if (!WorldActive || !(Radius > 0.0f))
    {
        return {};
    }
    JPH::SphereShape Sphere(std::max(0.01f, Radius));
    Sphere.SetEmbedded();
    const JPH::Quat  Orientation = JPH::Quat::sIdentity();
    uint32_t         IgnoreRaw   = JPH::BodyID::cInvalidBodyID;
    if (const JoltWorld::BodyRecord* Ignored = World->Find(Ignore); Ignored != nullptr)
    {
        IgnoreRaw = Ignored->Body.GetIndexAndSequenceNumber();
    }
    return SweepShapeInternal(&Sphere, &Orientation, From, Sweep, IgnoreRaw);
}

SceneCastReading RigidBodySolver::CastCylinder(
    float                    Radius,
    float                    HalfHeight,
    const PhysicsQuaternion& Orientation,
    const PhysicsVector3&    From,
    const PhysicsVector3&    Sweep,
    RigidBodyIdentity        Ignore) const noexcept
{
    if (!WorldActive || !(Radius > 0.0f) || !(HalfHeight > 0.0f))
    {
        return {};
    }
    const float        SafeHalf     = std::max(0.02f, HalfHeight);
    const float        SafeRadius   = std::max(0.02f, Radius);
    const float        ConvexRadius = std::min(0.02f, 0.25f * std::min(SafeHalf, SafeRadius));
    JPH::CylinderShape Inner(SafeHalf, SafeRadius, ConvexRadius);
    Inner.SetEmbedded();
    JPH::RotatedTranslatedShape Cylinder(
        JPH::Vec3::sZero(), JPH::Quat::sRotation(JPH::Vec3::sAxisX(), 0.5f * JPH::JPH_PI), &Inner);
    Cylinder.SetEmbedded();
    const JPH::Quat JoltOrientation = ToJolt(Orientation);
    uint32_t        IgnoreRaw       = JPH::BodyID::cInvalidBodyID;
    if (const JoltWorld::BodyRecord* Ignored = World->Find(Ignore); Ignored != nullptr)
    {
        IgnoreRaw = Ignored->Body.GetIndexAndSequenceNumber();
    }
    return SweepShapeInternal(&Cylinder, &JoltOrientation, From, Sweep, IgnoreRaw);
}

SceneCastReading RigidBodySolver::SweepShapeInternal(
    const void*           ShapePointer,
    const void*           OrientationPointer,
    const PhysicsVector3& From,
    const PhysicsVector3& Sweep,
    uint32_t              IgnoreRaw) const noexcept
{
    SceneCastReading Out;
    const float      SweepLength = Sweep.Length();
    if (!(SweepLength > 0.0f))
    {
        return Out;
    }

    const auto*       Shape       = static_cast<const JPH::Shape*>(ShapePointer);
    const JPH::Quat&  Orientation = *static_cast<const JPH::Quat*>(OrientationPointer);
    const JPH::RMat44 Start       = JPH::RMat44::sRotationTranslation(Orientation, ToJoltReal(From));
    const JPH::RShapeCast Cast(Shape, JPH::Vec3::sReplicate(1.0f), Start, ToJolt(Sweep));

    JPH::ShapeCastSettings Settings;
    Settings.mUseShrunkenShapeAndConvexRadius = true;
    Settings.mReturnDeepestPoint              = false;

    const JPH::IgnoreSingleBodyFilter                     BodyFilter((JPH::BodyID(IgnoreRaw)));
    JPH::ClosestHitCollisionCollector<JPH::CastShapeCollector> Collector;
    World->Physics.GetNarrowPhaseQuery().CastShape(Cast, Settings, ToJoltReal(From), Collector, {}, {}, BodyFilter);
    if (!Collector.HadHit())
    {
        return Out;
    }

    const JPH::ShapeCastResult& Hit = Collector.mHit;
    Out.Contact                     = true;
    Out.Fraction                    = Hit.mFraction;
    Out.Distance                    = Hit.mFraction * SweepLength;
    Out.Position                    = FromJolt(ToJoltReal(From) + Hit.mContactPointOn2);
    Out.Normal                      = FromJolt(-Hit.mPenetrationAxis.Normalized());
    Out.Body                        = World->IdentityOf(Hit.mBodyID2);
    return Out;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       CONSTRAINTS
//------------------------------------------------------------------------------------------------------------------------

ConstraintIdentity RigidBodySolver::CreateDistanceSpring(
    RigidBodyIdentity     BodyAlpha,
    const PhysicsVector3& WorldAnchorAlpha,
    RigidBodyIdentity     BodyBeta,
    const PhysicsVector3& WorldAnchorBeta,
    float                 MinDistance,
    float                 MaxDistance,
    float                 FrequencyHertz,
    float                 DampingRatio) noexcept
{
    if (!WorldActive)
    {
        LastRefusal = "solver not active";
        return InvalidConstraint;
    }
    const JoltWorld::BodyRecord* Alpha = World->Find(BodyAlpha);
    const JoltWorld::BodyRecord* Beta  = World->Find(BodyBeta);
    if (Alpha == nullptr || Beta == nullptr)
    {
        LastRefusal = "distance spring references invalid body";
        return InvalidConstraint;
    }

    JPH::DistanceConstraintSettings Settings;
    Settings.mSpace       = JPH::EConstraintSpace::WorldSpace;
    Settings.mPoint1      = ToJoltReal(WorldAnchorAlpha);
    Settings.mPoint2      = ToJoltReal(WorldAnchorBeta);
    Settings.mMinDistance = MinDistance;
    Settings.mMaxDistance = MaxDistance;
    if (FrequencyHertz > 0.0f)
    {
        Settings.mLimitsSpringSettings.mMode      = JPH::ESpringMode::FrequencyAndDamping;
        Settings.mLimitsSpringSettings.mFrequency = FrequencyHertz;
        Settings.mLimitsSpringSettings.mDamping   = DampingRatio;
    }

    const JPH::BodyID      Pair[2] = {Alpha->Body, Beta->Body};
    JPH::BodyLockMultiWrite Locks(World->Physics.GetBodyLockInterface(), Pair, 2);
    JPH::Body*              LiveAlpha = Locks.GetBody(0);
    JPH::Body*              LiveBeta  = Locks.GetBody(1);
    if (LiveAlpha == nullptr || LiveBeta == nullptr)
    {
        LastRefusal = "distance spring body lock failed";
        return InvalidConstraint;
    }

    JPH::Constraint* Created = Settings.Create(*LiveAlpha, *LiveBeta);
    if (Created == nullptr)
    {
        LastRefusal = "Jolt refused distance constraint";
        return InvalidConstraint;
    }
    World->Physics.AddConstraint(Created);

    uint32_t Slot = 0u;
    if (!World->FreeConstraintSlots.empty())
    {
        Slot = World->FreeConstraintSlots.back();
        World->FreeConstraintSlots.pop_back();
    }
    else
    {
        Slot = static_cast<uint32_t>(World->Constraints.size());
        World->Constraints.emplace_back();
    }
    World->Constraints[Slot].Constraint = Created;
    World->Constraints[Slot].Alive      = true;
    return Slot;
}

void RigidBodySolver::DestroyConstraint(ConstraintIdentity Identity) noexcept
{
    if (!WorldActive || Identity >= World->Constraints.size() || !World->Constraints[Identity].Alive)
    {
        return;
    }
    JoltWorld::ConstraintRecord& Record = World->Constraints[Identity];
    if (Record.Constraint != nullptr)
    {
        World->Physics.RemoveConstraint(Record.Constraint.GetPtr());
    }
    Record = JoltWorld::ConstraintRecord{};
    World->FreeConstraintSlots.push_back(Identity);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        READBACK
//------------------------------------------------------------------------------------------------------------------------

bool RigidBodySolver::QueryPose(RigidBodyIdentity Identity, RigidBodyPose& OutPose) const noexcept
{
    if (!WorldActive)
    {
        return false;
    }
    const JoltWorld::BodyRecord* Record = World->Find(Identity);
    if (Record == nullptr)
    {
        return false;
    }

    const JPH::BodyInterface& Bodies = World->Physics.GetBodyInterface();
    JPH::RVec3                Position;
    JPH::Quat                 Orientation;
    Bodies.GetPositionAndRotation(Record->Body, Position, Orientation);

    OutPose.Identity    = Identity;
    OutPose.Position    = FromJolt(Position);
    OutPose.Orientation = FromJolt(Orientation);
    OutPose.LinearVelocity =
        Record->Motion == RigidBodyMotionCategory::Static ? PhysicsVector3{} : FromJolt(Bodies.GetLinearVelocity(Record->Body));
    OutPose.AngularVelocity =
        Record->Motion == RigidBodyMotionCategory::Static ? PhysicsVector3{} : FromJolt(Bodies.GetAngularVelocity(Record->Body));
    OutPose.Motion = Record->Motion;
    OutPose.Shape  = Record->Shape;
    OutPose.Awake  = Bodies.IsActive(Record->Body);
    return true;
}

void RigidBodySolver::QueryPoses(std::vector<RigidBodyPose>& OutPoses) const noexcept
{
    OutPoses.clear();
    if (!WorldActive)
    {
        return;
    }
    OutPoses.reserve(World->Records.size());
    for (uint32_t Slot = 0u; Slot < static_cast<uint32_t>(World->Records.size()); ++Slot)
    {
        RigidBodyPose Pose;
        if (QueryPose(Slot, Pose))
        {
            OutPoses.push_back(Pose);
        }
    }
}

const std::string& RigidBodySolver::QueryName(RigidBodyIdentity Identity) const noexcept
{
    static const std::string Empty;
    if (!WorldActive)
    {
        return Empty;
    }
    const JoltWorld::BodyRecord* Record = World->Find(Identity);
    return Record != nullptr ? Record->Name : Empty;
}

} // namespace Frontier
