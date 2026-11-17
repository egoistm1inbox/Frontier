/*==========================================================================================================================================
                                                           PHYSICSSUBSTRATE.H
==========================================================================================================================================*/
// 🧩 Jolt-free physics engine contract: variant shape specifications, impact telemetry ring buffer, and IPhysicsSubstrate.

#pragma once

#include "Frontier/Engine/Foundation/Constants.h"
#include "Frontier/Engine/Foundation/Math.h"

#include <array>
#include <cstdint>
#include <deque>
#include <mutex>
#include <optional>
#include <string_view>
#include <variant>
#include <vector>

namespace Frontier
{

enum class PhysicsShape : uint8_t
{
    Box,
    Sphere,
    Cylinder,
    Cone,
    Torus,
    Capsule,
    ConvexHull,
    TriangleSurface,
};

enum class PhysicsMotion : uint8_t
{
    Fixed,      // never moves: ground and static colliders
    Moving,     // falls, collides, and responds to forces
    Kinematic,  // script/animation driven collider that pushes moving bodies
};

enum class SurfaceMaterialClass : uint8_t
{
    Concrete = 0,
    Asphalt  = 1,
    Metal    = 2,
    Wood     = 3,
    Glass    = 4,
    Water    = 5,
    Soil     = 6,
    Foliage  = 7,
    Composite = 8,
};

[[nodiscard]] constexpr std::string_view ResolveSurfaceMaterialName(SurfaceMaterialClass Material) noexcept
{
    switch (Material)
    {
    case SurfaceMaterialClass::Concrete: return "concrete";
    case SurfaceMaterialClass::Asphalt: return "asphalt";
    case SurfaceMaterialClass::Metal: return "metal";
    case SurfaceMaterialClass::Wood: return "wood";
    case SurfaceMaterialClass::Glass: return "glass";
    case SurfaceMaterialClass::Water: return "water";
    case SurfaceMaterialClass::Soil: return "soil";
    case SurfaceMaterialClass::Foliage: return "foliage";
    case SurfaceMaterialClass::Composite: return "composite";
    }
    return "concrete";
}

//------------------------------------------------------------------------------------------------------------------------
//                                              VARIANT SHAPE SPECIFICATIONS
//------------------------------------------------------------------------------------------------------------------------

struct PhysicsBoxShape
{
    std::array<double, 3> HalfExtentMetres{ 0.5, 0.5, 0.5 };
};

struct PhysicsSphereShape
{
    double RadiusMetres = 0.5;
};

struct PhysicsCylinderShape
{
    double HalfHeightMetres = 0.5;
    double RadiusMetres     = 0.5;
};

struct PhysicsConeShape
{
    double HeightMetres = 1.0;
    double RadiusMetres = 0.5;
};

struct PhysicsTorusShape
{
    double MajorRadiusMetres = 1.0;
    double MinorRadiusMetres = 0.25;
};

struct PhysicsCapsuleShape
{
    double HalfHeightMetres = 0.5;
    double RadiusMetres     = 0.25;
};

struct PhysicsConvexHullShape
{
    std::vector<std::array<double, 3>> VerticesMetres;
};

struct PhysicsTriangleSurfaceShape
{
    std::vector<std::array<double, 3>> VerticesMetres;
    std::vector<uint32_t>              Indices;
};

using PhysicsShapeSpecification = std::variant<PhysicsBoxShape,
                                               PhysicsSphereShape,
                                               PhysicsCylinderShape,
                                               PhysicsConeShape,
                                               PhysicsTorusShape,
                                               PhysicsCapsuleShape,
                                               PhysicsConvexHullShape,
                                               PhysicsTriangleSurfaceShape>;

//------------------------------------------------------------------------------------------------------------------------
//                                                  BODY & IMPACT TELEMETRY
//------------------------------------------------------------------------------------------------------------------------

// 📝 One body as it enters the space (z up, metres). Orientation is a unit quaternion (x, y, z, w).
struct PhysicsBodyDescriptor
{
    uint64_t                                 Record              = 0;
    PhysicsShape                             Shape               = PhysicsShape::Box;
    std::array<double, 3>                    HalfExtentMetres    = { 0.5, 0.5, 0.5 };
    std::array<double, 3>                    PositionMetres      = { 0.0, 0.0, 0.0 };
    std::array<double, 4>                    Orientation         = { 0.0, 0.0, 0.0, 1.0 };
    PhysicsMotion                            Motion              = PhysicsMotion::Moving;
    double                                   MassKilograms       = 0.0;   // 0: derive from volume at 1000 kg/m³
    double                                   Friction            = 0.5;
    double                                   Restitution         = 0.2;
    double                                   LinearDamping       = 0.05;
    std::array<double, 3>                    LinearVelocityMps   = { 0.0, 0.0, 0.0 };
    std::array<double, 3>                    AngularVelocityRads = { 0.0, 0.0, 0.0 };
    SurfaceMaterialClass                     SurfaceClass        = SurfaceMaterialClass::Concrete;
    std::optional<PhysicsShapeSpecification> VariantShape{};

    [[nodiscard]] PhysicsShapeSpecification ResolveShapeSpecification() const
    {
        if (VariantShape.has_value())
        {
            return *VariantShape;
        }
        switch (Shape)
        {
        case PhysicsShape::Sphere: return PhysicsSphereShape{ HalfExtentMetres[0] };
        case PhysicsShape::Cylinder: return PhysicsCylinderShape{ HalfExtentMetres[2], HalfExtentMetres[0] };
        case PhysicsShape::Cone: return PhysicsConeShape{ HalfExtentMetres[2] * 2.0, HalfExtentMetres[0] };
        case PhysicsShape::Torus: return PhysicsTorusShape{ HalfExtentMetres[0], HalfExtentMetres[2] };
        case PhysicsShape::Capsule: return PhysicsCapsuleShape{ HalfExtentMetres[2], HalfExtentMetres[0] };
        case PhysicsShape::Box:
        default: return PhysicsBoxShape{ HalfExtentMetres };
        }
    }
};

struct PhysicsBodyReading
{
    std::array<double, 3> PositionMetres      = { 0.0, 0.0, 0.0 };
    std::array<double, 4> Orientation         = { 0.0, 0.0, 0.0, 1.0 };
    std::array<double, 3> LinearVelocityMps   = { 0.0, 0.0, 0.0 };
    std::array<double, 3> AngularVelocityRads = { 0.0, 0.0, 0.0 };
    bool                  Awake               = false;
};

struct PhysicsSpaceSettings
{
    std::array<double, 3> GravityMps2   = { 0.0, 0.0, -PhysicsConstantsD::StandardGravityMps2 };
    uint32_t              MaximumBodies = 8192;
    uint32_t              Workers       = 0;
};

// 📝 Decoupled impact event published by physics contact listeners for downstream consumers (Particle, Fluid, Fracture, Audio).
struct PhysicsImpactEvent
{
    uint64_t             BodyARecord        = 0;
    uint64_t             BodyBRecord        = 0;
    Vec3d                PointMetres{};
    Vec3d                Normal{ 0.0, 0.0, 1.0 };
    double               ImpulseMagnitudeNs = 0.0;
    double               RelativeSpeedMps   = 0.0;
    SurfaceMaterialClass SurfaceClass       = SurfaceMaterialClass::Concrete;
    double               TimestampSeconds   = 0.0;
};

class PhysicsImpactRing
{
  public:
    explicit PhysicsImpactRing(size_t Capacity = 256) noexcept : Capacity_(Capacity > 0 ? Capacity : 1) {}

    void Push(const PhysicsImpactEvent& Event)
    {
        std::lock_guard<std::mutex> Guard(Mutex_);
        if (Events_.size() >= Capacity_)
        {
            Events_.pop_front();
        }
        Events_.push_back(Event);
        ++TotalRecorded_;
    }

    [[nodiscard]] std::vector<PhysicsImpactEvent> Drain()
    {
        std::lock_guard<std::mutex> Guard(Mutex_);
        std::vector<PhysicsImpactEvent> Out(Events_.begin(), Events_.end());
        Events_.clear();
        return Out;
    }

    [[nodiscard]] size_t Size() const
    {
        std::lock_guard<std::mutex> Guard(Mutex_);
        return Events_.size();
    }

    [[nodiscard]] uint64_t QueryTotalRecorded() const
    {
        std::lock_guard<std::mutex> Guard(Mutex_);
        return TotalRecorded_;
    }

    void Clear()
    {
        std::lock_guard<std::mutex> Guard(Mutex_);
        Events_.clear();
    }

  private:
    size_t                         Capacity_;
    mutable std::mutex             Mutex_;
    std::deque<PhysicsImpactEvent> Events_;
    uint64_t                       TotalRecorded_ = 0;
};

//------------------------------------------------------------------------------------------------------------------------
//                                                 SUBSTRATE INTERFACE
//------------------------------------------------------------------------------------------------------------------------

class IPhysicsSubstrate
{
  public:
    virtual ~IPhysicsSubstrate() = default;

    virtual uint32_t           AddBody(const PhysicsBodyDescriptor& Descriptor)            = 0;
    virtual void               Prepare()                                                   = 0;
    virtual void               Step(double DeltaSeconds, uint32_t CollisionSteps)          = 0;
    [[nodiscard]] virtual PhysicsBodyReading ReadBody(uint32_t Index) const                = 0;
    [[nodiscard]] virtual size_t             QueryAwakeCount() const                       = 0;
    [[nodiscard]] virtual uint64_t           QueryContactsAdded() const noexcept           = 0;
    [[nodiscard]] virtual uint32_t           QueryWorkers() const noexcept                 = 0;
    [[nodiscard]] virtual std::vector<PhysicsImpactEvent> DrainImpactEvents()              = 0;
    [[nodiscard]] virtual uint64_t           QueryImpactCount() const                      = 0;
    virtual void                             SetGravity(const std::array<double, 3>& GravityMps2) = 0;
};

} // namespace Frontier
