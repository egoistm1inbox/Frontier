/*==========================================================================================================================================
                                                            JOLTSUBSTRATE.CPP
==========================================================================================================================================*/
// 🧩 JoltPhysics v5.6.0 implementation of IPhysicsSubstrate using std::visit over PhysicsShapeSpecification variants.

#include "Frontier/Extensions/Physics/JoltSubstrate.h"

#include "Frontier/Engine/Foundation/Constants.h"
#include "Frontier/Extensions/Physics/JoltExtension.h"

#include <Jolt/Geometry/Triangle.h>
#include <Jolt/Physics/Body/BodyCreationSettings.h>
#include <Jolt/Physics/Body/BodyInterface.h>
#include <Jolt/Physics/Collision/ContactListener.h>
#include <Jolt/Physics/Collision/Shape/BoxShape.h>
#include <Jolt/Physics/Collision/Shape/CapsuleShape.h>
#include <Jolt/Physics/Collision/Shape/ConvexHullShape.h>
#include <Jolt/Physics/Collision/Shape/CylinderShape.h>
#include <Jolt/Physics/Collision/Shape/MeshShape.h>
#include <Jolt/Physics/Collision/Shape/SphereShape.h>
#include <Jolt/Physics/PhysicsSystem.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <limits>
#include <unordered_map>

namespace Frontier
{

namespace
{

JPH::Vec3 ToVector(const std::array<double, 3>& Value)
{
    return JPH::Vec3(static_cast<float>(Value[0]), static_cast<float>(Value[1]), static_cast<float>(Value[2]));
}

template <class... Ts>
struct Overloaded : Ts...
{
    using Ts::operator()...;
};

template <class... Ts>
Overloaded(Ts...) -> Overloaded<Ts...>;

JPH::RefConst<JPH::Shape> ConstructJoltShape(const PhysicsShapeSpecification& Spec, PhysicsMotion Motion)
{
    return std::visit(
        Overloaded{
            [](const PhysicsBoxShape& Box) -> JPH::RefConst<JPH::Shape> {
                const JPH::Vec3 Half = ToVector(Box.HalfExtentMetres);
                if (!(Half.ReduceMin() > 1.0e-3f)) return nullptr;
                return new JPH::BoxShape(Half, std::min(JPH::cDefaultConvexRadius, 0.5f * Half.ReduceMin()));
            },
            [](const PhysicsSphereShape& Sphere) -> JPH::RefConst<JPH::Shape> {
                if (!(Sphere.RadiusMetres > 1.0e-3)) return nullptr;
                return new JPH::SphereShape(static_cast<float>(Sphere.RadiusMetres));
            },
            [](const PhysicsCylinderShape& Cyl) -> JPH::RefConst<JPH::Shape> {
                if (!(Cyl.HalfHeightMetres > 1.0e-3 && Cyl.RadiusMetres > 1.0e-3)) return nullptr;
                const float Convex = std::min(JPH::cDefaultConvexRadius,
                                              0.5f * static_cast<float>(std::min(Cyl.HalfHeightMetres, Cyl.RadiusMetres)));
                return new JPH::CylinderShape(static_cast<float>(Cyl.HalfHeightMetres),
                                              static_cast<float>(Cyl.RadiusMetres), Convex);
            },
            [](const PhysicsCapsuleShape& Cap) -> JPH::RefConst<JPH::Shape> {
                if (!(Cap.HalfHeightMetres > 1.0e-3 && Cap.RadiusMetres > 1.0e-3)) return nullptr;
                return new JPH::CapsuleShape(static_cast<float>(Cap.HalfHeightMetres),
                                             static_cast<float>(Cap.RadiusMetres));
            },
            [](const PhysicsConeShape& Cone) -> JPH::RefConst<JPH::Shape> {
                if (!(Cone.HeightMetres > 2.0e-3 && Cone.RadiusMetres > 1.0e-3)) return nullptr;
                JPH::Array<JPH::Vec3> Points;
                const float HalfH = static_cast<float>(0.5 * Cone.HeightMetres);
                const float R     = static_cast<float>(Cone.RadiusMetres);
                Points.push_back(JPH::Vec3(0.0f, 0.0f, HalfH));
                constexpr int Sides = 12;
                for (int i = 0; i < Sides; ++i)
                {
                    const double Angle = (MathConstantsD::TwoPi * i) / Sides;
                    Points.push_back(JPH::Vec3(R * static_cast<float>(std::cos(Angle)),
                                               R * static_cast<float>(std::sin(Angle)), -HalfH));
                }
                JPH::ConvexHullShapeSettings Settings(Points, std::min(JPH::cDefaultConvexRadius, 0.25f * std::min(HalfH, R)));
                auto                         Result = Settings.Create();
                return Result.IsValid() ? Result.Get() : nullptr;
            },
            [](const PhysicsTorusShape& Torus) -> JPH::RefConst<JPH::Shape> {
                if (!(Torus.MajorRadiusMetres > 1.0e-3 && Torus.MinorRadiusMetres > 1.0e-3)) return nullptr;
                JPH::Array<JPH::Vec3> Points;
                const float OuterR = static_cast<float>(Torus.MajorRadiusMetres + Torus.MinorRadiusMetres);
                const float MinorH = static_cast<float>(Torus.MinorRadiusMetres);
                constexpr int Sides = 16;
                for (int i = 0; i < Sides; ++i)
                {
                    const double Angle = (MathConstantsD::TwoPi * i) / Sides;
                    const float  Cx    = OuterR * static_cast<float>(std::cos(Angle));
                    const float  Cy    = OuterR * static_cast<float>(std::sin(Angle));
                    Points.push_back(JPH::Vec3(Cx, Cy, -MinorH));
                    Points.push_back(JPH::Vec3(Cx, Cy, MinorH));
                }
                JPH::ConvexHullShapeSettings Settings(Points, std::min(JPH::cDefaultConvexRadius, 0.25f * MinorH));
                auto                         Result = Settings.Create();
                return Result.IsValid() ? Result.Get() : nullptr;
            },
            [](const PhysicsConvexHullShape& Hull) -> JPH::RefConst<JPH::Shape> {
                if (Hull.VerticesMetres.size() < 4) return nullptr;
                JPH::Array<JPH::Vec3> Points;
                Points.reserve(Hull.VerticesMetres.size());
                for (const auto& V : Hull.VerticesMetres) Points.push_back(ToVector(V));
                JPH::ConvexHullShapeSettings Settings(Points);
                auto                         Result = Settings.Create();
                return Result.IsValid() ? Result.Get() : nullptr;
            },
            [Motion](const PhysicsTriangleSurfaceShape& Mesh) -> JPH::RefConst<JPH::Shape> {
                if (Mesh.VerticesMetres.size() < 3 || Mesh.Indices.size() < 3) return nullptr;
                if (Motion != PhysicsMotion::Fixed)
                {
                    JPH::Array<JPH::Vec3> Points;
                    Points.reserve(Mesh.VerticesMetres.size());
                    for (const auto& V : Mesh.VerticesMetres) Points.push_back(ToVector(V));
                    JPH::ConvexHullShapeSettings Settings(Points);
                    auto                         Result = Settings.Create();
                    return Result.IsValid() ? Result.Get() : nullptr;
                }
                JPH::VertexList        Verts;
                JPH::IndexedTriangleList Tris;
                Verts.reserve(Mesh.VerticesMetres.size());
                for (const auto& V : Mesh.VerticesMetres)
                {
                    Verts.push_back(JPH::Float3(static_cast<float>(V[0]), static_cast<float>(V[1]), static_cast<float>(V[2])));
                }
                Tris.reserve(Mesh.Indices.size() / 3);
                for (size_t i = 0; i + 2 < Mesh.Indices.size(); i += 3)
                {
                    Tris.push_back(JPH::IndexedTriangle(Mesh.Indices[i], Mesh.Indices[i + 1], Mesh.Indices[i + 2]));
                }
                JPH::MeshShapeSettings Settings(std::move(Verts), std::move(Tris));
                auto                   Result = Settings.Create();
                return Result.IsValid() ? Result.Get() : nullptr;
            },
        },
        Spec);
}

// 📝 Captures Jolt contact counts and records decoupled impact events into the ring buffer.
class TelemetryContactListener final : public JPH::ContactListener
{
  public:
    void OnContactAdded(const JPH::Body&             Body1,
                        const JPH::Body&             Body2,
                        const JPH::ContactManifold&  Manifold,
                        JPH::ContactSettings&        /*Settings*/) override
    {
        Added.fetch_add(1, std::memory_order_relaxed);
        const JPH::Vec3 RelVel = Body1.GetLinearVelocity() - Body2.GetLinearVelocity();
        const double    Speed  = static_cast<double>(RelVel.Length());
        if (Speed < 0.25)
        {
            return;
        }
        PhysicsImpactEvent Event;
        Event.BodyARecord      = static_cast<uint64_t>(Body1.GetUserData());
        Event.BodyBRecord      = static_cast<uint64_t>(Body2.GetUserData());
        const JPH::RVec3 Base  = Manifold.mBaseOffset;
        const JPH::Vec3  Local = Manifold.mRelativeContactPointsOn1.empty() ? JPH::Vec3::sZero() : Manifold.mRelativeContactPointsOn1[0];
        Event.PointMetres      = { static_cast<double>(Base.GetX()) + Local.GetX(),
                                   static_cast<double>(Base.GetY()) + Local.GetY(),
                                   static_cast<double>(Base.GetZ()) + Local.GetZ() };
        Event.Normal           = { Manifold.mWorldSpaceNormal.GetX(),
                                   Manifold.mWorldSpaceNormal.GetY(),
                                   Manifold.mWorldSpaceNormal.GetZ() };
        Event.RelativeSpeedMps = Speed;
        const double MassA     = Body1.GetMotionType() == JPH::EMotionType::Dynamic ? 1.0 / std::max(1.0e-5, static_cast<double>(Body1.GetMotionProperties()->GetInverseMass())) : 0.0;
        const double MassB     = Body2.GetMotionType() == JPH::EMotionType::Dynamic ? 1.0 / std::max(1.0e-5, static_cast<double>(Body2.GetMotionProperties()->GetInverseMass())) : 0.0;
        const double EffMass   = (MassA > 0.0 && MassB > 0.0) ? (MassA * MassB) / (MassA + MassB) : std::max(MassA, MassB);
        Event.ImpulseMagnitudeNs = EffMass * Speed;
        Event.TimestampSeconds   = CurrentTimeSeconds.load(std::memory_order_relaxed);
        {
            std::lock_guard<std::mutex> Guard(MaterialLock);
            auto Found = SurfaceMaterials.find(Event.BodyBRecord);
            if (Found != SurfaceMaterials.end())
            {
                Event.SurfaceClass = Found->second;
            }
            else if (auto FoundA = SurfaceMaterials.find(Event.BodyARecord); FoundA != SurfaceMaterials.end())
            {
                Event.SurfaceClass = FoundA->second;
            }
        }
        Ring.Push(Event);
    }

    void RegisterSurface(uint64_t RecordId, SurfaceMaterialClass Material)
    {
        std::lock_guard<std::mutex> Guard(MaterialLock);
        SurfaceMaterials[RecordId] = Material;
    }

    std::atomic<uint64_t> Added{ 0 };
    std::atomic<double>   CurrentTimeSeconds{ 0.0 };
    PhysicsImpactRing     Ring{ 256 };
    std::mutex            MaterialLock;
    std::unordered_map<uint64_t, SurfaceMaterialClass> SurfaceMaterials;
};

} // namespace

struct JoltSubstrate::Implementation
{
    JoltExtension             Backend;
    JPH::PhysicsSystem        Solver;
    TelemetryContactListener  Contacts;
    std::vector<JPH::BodyID>  Bodies;

    explicit Implementation(uint32_t Workers) : Backend(Workers) {}
};

JoltSubstrate::JoltSubstrate(const PhysicsSpaceSettings& Settings)
    : Detail(std::make_unique<Implementation>(Settings.Workers))
{
    const JPH::uint Bodies = std::max<JPH::uint>(16, Settings.MaximumBodies);
    const JPH::uint BodyPairCapacity = std::max<JPH::uint>(4096, Bodies);
    const JPH::uint ContactCapacity = std::max<JPH::uint>(4096, Bodies);
    Detail->Solver.Init(Bodies,
                        0,
                        BodyPairCapacity,
                        ContactCapacity,
                        Detail->Backend.QueryLayers(),
                        Detail->Backend.QueryLayerFilter(),
                        Detail->Backend.QueryPairFilter());
    Detail->Solver.SetGravity(ToVector(Settings.GravityMps2));
    Detail->Solver.SetContactListener(&Detail->Contacts);
}

JoltSubstrate::~JoltSubstrate()
{
    JPH::BodyInterface& Interface = Detail->Solver.GetBodyInterface();
    for (const JPH::BodyID& Body : Detail->Bodies)
    {
        Interface.RemoveBody(Body);
        Interface.DestroyBody(Body);
    }
}

uint32_t JoltSubstrate::AddBody(const PhysicsBodyDescriptor& Descriptor)
{
    constexpr uint32_t        Refused = std::numeric_limits<uint32_t>::max();
    JPH::RefConst<JPH::Shape> Shape   = ConstructJoltShape(Descriptor.ResolveShapeSpecification(), Descriptor.Motion);
    if (!Shape)
    {
        return Refused;
    }
    const bool Moving = Descriptor.Motion == PhysicsMotion::Moving;
    const JPH::EMotionType MotionType = Descriptor.Motion == PhysicsMotion::Moving
                                            ? JPH::EMotionType::Dynamic
                                            : (Descriptor.Motion == PhysicsMotion::Kinematic
                                                   ? JPH::EMotionType::Kinematic
                                                   : JPH::EMotionType::Static);
    const JPH::ObjectLayer Layer = Descriptor.Motion == PhysicsMotion::Fixed ? JoltLayers::Fixed : JoltLayers::Moving;
    JPH::BodyCreationSettings Settings(
        Shape,
        JPH::RVec3(ToVector(Descriptor.PositionMetres)),
        JPH::Quat(static_cast<float>(Descriptor.Orientation[0]),
                  static_cast<float>(Descriptor.Orientation[1]),
                  static_cast<float>(Descriptor.Orientation[2]),
                  static_cast<float>(Descriptor.Orientation[3]))
            .Normalized(),
        MotionType,
        Layer);
    Settings.mFriction      = static_cast<float>(Descriptor.Friction);
    Settings.mRestitution   = static_cast<float>(Descriptor.Restitution);
    Settings.mLinearDamping = static_cast<float>(Descriptor.LinearDamping);
    Settings.mUserData      = Descriptor.Record;
    if (Moving)
    {
        Settings.mLinearVelocity  = ToVector(Descriptor.LinearVelocityMps);
        Settings.mAngularVelocity = ToVector(Descriptor.AngularVelocityRads);
        if (Descriptor.MassKilograms > 0.0)
        {
            Settings.mOverrideMassProperties       = JPH::EOverrideMassProperties::CalculateInertia;
            Settings.mMassPropertiesOverride.mMass = static_cast<float>(Descriptor.MassKilograms);
        }
    }
    if (Descriptor.Record != 0)
    {
        Detail->Contacts.RegisterSurface(Descriptor.Record, Descriptor.SurfaceClass);
    }
    JPH::BodyInterface& Interface = Detail->Solver.GetBodyInterface();
    const JPH::BodyID   Body      = Interface.CreateAndAddBody(
        Settings,
        Descriptor.Motion == PhysicsMotion::Fixed ? JPH::EActivation::DontActivate : JPH::EActivation::Activate);
    if (Body.IsInvalid())
    {
        return Refused;
    }
    Detail->Bodies.push_back(Body);
    return static_cast<uint32_t>(Detail->Bodies.size() - 1);
}

void JoltSubstrate::Prepare()
{
    Detail->Solver.OptimizeBroadPhase();
}

void JoltSubstrate::Step(double DeltaSeconds, uint32_t CollisionSteps)
{
    if (!(DeltaSeconds > 0.0))
    {
        return;
    }
    Detail->Contacts.CurrentTimeSeconds.store(
        Detail->Contacts.CurrentTimeSeconds.load(std::memory_order_relaxed) + DeltaSeconds,
        std::memory_order_relaxed);
    const JPH::EPhysicsUpdateError Errors = Detail->Solver.Update(static_cast<float>(DeltaSeconds),
                                                                   static_cast<int>(std::max(1u, CollisionSteps)),
                                                                   &Detail->Backend.AccessTemporary(),
                                                                   &Detail->Backend.AccessJobs());
    if (Errors != JPH::EPhysicsUpdateError::None)
    {
        std::fprintf(stderr, "Jolt physics update error flags: 0x%x (bodies=%zu, steps=%u, dt=%.6f)\n",
                     static_cast<unsigned>(Errors), Detail->Bodies.size(), CollisionSteps, DeltaSeconds);
        std::fflush(stderr);
    }
}

PhysicsBodyReading JoltSubstrate::ReadBody(uint32_t Index) const
{
    PhysicsBodyReading Reading;
    if (Index >= Detail->Bodies.size())
    {
        return Reading;
    }
    const JPH::BodyInterface& Interface = Detail->Solver.GetBodyInterfaceNoLock();
    const JPH::BodyID         Body      = Detail->Bodies[Index];
    JPH::RVec3                Position;
    JPH::Quat                 Rotation;
    Interface.GetPositionAndRotation(Body, Position, Rotation);
    const JPH::Vec3 Linear  = Interface.GetLinearVelocity(Body);
    const JPH::Vec3 Angular = Interface.GetAngularVelocity(Body);
    Reading.PositionMetres      = { Position.GetX(), Position.GetY(), Position.GetZ() };
    Reading.Orientation         = { Rotation.GetX(), Rotation.GetY(), Rotation.GetZ(), Rotation.GetW() };
    Reading.LinearVelocityMps   = { Linear.GetX(), Linear.GetY(), Linear.GetZ() };
    Reading.AngularVelocityRads = { Angular.GetX(), Angular.GetY(), Angular.GetZ() };
    Reading.Awake               = Interface.IsActive(Body);
    return Reading;
}

size_t JoltSubstrate::QueryAwakeCount() const
{
    return Detail->Solver.GetNumActiveBodies(JPH::EBodyType::RigidBody);
}

uint64_t JoltSubstrate::QueryContactsAdded() const noexcept
{
    return Detail->Contacts.Added.load(std::memory_order_relaxed);
}

uint32_t JoltSubstrate::QueryWorkers() const noexcept
{
    return Detail->Backend.QueryWorkers();
}

std::vector<PhysicsImpactEvent> JoltSubstrate::DrainImpactEvents()
{
    return Detail->Contacts.Ring.Drain();
}

uint64_t JoltSubstrate::QueryImpactCount() const
{
    return Detail->Contacts.Ring.QueryTotalRecorded();
}

void JoltSubstrate::SetGravity(const std::array<double, 3>& GravityMps2)
{
    Detail->Solver.SetGravity(ToVector(GravityMps2));
}

} // namespace Frontier
