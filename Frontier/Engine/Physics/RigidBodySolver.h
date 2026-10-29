//============================================================================================================================================
//                                                         RIGIDBODYSOLVER.H
//============================================================================================================================================
// 🧩 Jolt Physics rigid-body world, fixed-step accumulator, shape sweeps, terrain heightfields, and body records behind an opaque seam.

#pragma once

#include "Engine/Foundation/Math.h"

#include <cmath>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace Frontier
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    SPATIAL RECORDS
//------------------------------------------------------------------------------------------------------------------------

struct PhysicsVector3
{
    float X = 0.0f;   // [m] - Spatial coordinate along +X (forward / east)
    float Y = 0.0f;   // [m] - Spatial coordinate along +Y (left / north)
    float Z = 0.0f;   // [m] - Spatial coordinate along +Z (up)

    constexpr PhysicsVector3() noexcept = default;
    constexpr PhysicsVector3(float InX, float InY, float InZ) noexcept : X(InX), Y(InY), Z(InZ) {}
    constexpr explicit PhysicsVector3(Vec3 Vector) noexcept : X(Vector.X), Y(Vector.Y), Z(Vector.Z) {}

    [[nodiscard]] constexpr Vec3 ToFoundation() const noexcept
    {
        return {X, Y, Z};
    }

    [[nodiscard]] constexpr PhysicsVector3 operator+(PhysicsVector3 Other) const noexcept
    {
        return {X + Other.X, Y + Other.Y, Z + Other.Z};
    }

    [[nodiscard]] constexpr PhysicsVector3 operator-(PhysicsVector3 Other) const noexcept
    {
        return {X - Other.X, Y - Other.Y, Z - Other.Z};
    }

    [[nodiscard]] constexpr PhysicsVector3 operator*(float Scalar) const noexcept
    {
        return {X * Scalar, Y * Scalar, Z * Scalar};
    }

    [[nodiscard]] float LengthSquared() const noexcept
    {
        return X * X + Y * Y + Z * Z;
    }

    [[nodiscard]] float Length() const noexcept
    {
        return std::sqrt(LengthSquared());
    }

    [[nodiscard]] PhysicsVector3 Normalized() const noexcept
    {
        const float Magnitude = Length();
        return Magnitude > 1.0e-7f ? (*this * (1.0f / Magnitude)) : PhysicsVector3{};
    }
};

struct PhysicsQuaternion
{
    float X = 0.0f;   // [-] - Imaginary axis component X
    float Y = 0.0f;   // [-] - Imaginary axis component Y
    float Z = 0.0f;   // [-] - Imaginary axis component Z
    float W = 1.0f;   // [-] - Scalar real component W

    constexpr PhysicsQuaternion() noexcept = default;
    constexpr PhysicsQuaternion(float InX, float InY, float InZ, float InW) noexcept : X(InX), Y(InY), Z(InZ), W(InW) {}

    [[nodiscard]] static constexpr PhysicsQuaternion Identity() noexcept
    {
        return {0.0f, 0.0f, 0.0f, 1.0f};
    }

    [[nodiscard]] static PhysicsQuaternion AxisAngle(PhysicsVector3 Axis, float AngleRadians) noexcept
    {
        const PhysicsVector3 UnitAxis = Axis.Normalized();
        const float          Half     = 0.5f * AngleRadians;
        const float          Sine     = std::sin(Half);
        return {UnitAxis.X * Sine, UnitAxis.Y * Sine, UnitAxis.Z * Sine, std::cos(Half)};
    }

    [[nodiscard]] PhysicsQuaternion Normalized() const noexcept
    {
        const float Norm = std::sqrt(X * X + Y * Y + Z * Z + W * W);
        return Norm > 1.0e-7f ? PhysicsQuaternion{X / Norm, Y / Norm, Z / Norm, W / Norm} : Identity();
    }

    [[nodiscard]] constexpr PhysicsQuaternion operator*(PhysicsQuaternion Other) const noexcept
    {
        return {
            W * Other.X + X * Other.W + Y * Other.Z - Z * Other.Y,
            W * Other.Y - X * Other.Z + Y * Other.W + Z * Other.X,
            W * Other.Z + X * Other.Y - Y * Other.X + Z * Other.W,
            W * Other.W - X * Other.X - Y * Other.Y - Z * Other.Z,
        };
    }

    [[nodiscard]] PhysicsVector3 Rotate(PhysicsVector3 Vector) const noexcept
    {
        const Vec3 Axis{X, Y, Z};
        const Vec3 Input  = Vector.ToFoundation();
        const Vec3 Twice  = Cross(Axis, Input) * 2.0f;
        const Vec3 Result = Input + (Twice * W) + Cross(Axis, Twice);
        return PhysicsVector3(Result);
    }

    [[nodiscard]] Mat4 ToMatrix(PhysicsVector3 Translation = {}) const noexcept
    {
        const PhysicsQuaternion Unit = Normalized();
        const float             XX   = Unit.X * Unit.X;
        const float             YY   = Unit.Y * Unit.Y;
        const float             ZZ   = Unit.Z * Unit.Z;
        const float             XY   = Unit.X * Unit.Y;
        const float             XZ   = Unit.X * Unit.Z;
        const float             YZ   = Unit.Y * Unit.Z;
        const float             WX   = Unit.W * Unit.X;
        const float             WY   = Unit.W * Unit.Y;
        const float             WZ   = Unit.W * Unit.Z;

        Mat4 Out            = Mat4::Identity();
        Out.Columns[0][0]   = 1.0f - 2.0f * (YY + ZZ);
        Out.Columns[0][1]   = 2.0f * (XY + WZ);
        Out.Columns[0][2]   = 2.0f * (XZ - WY);

        Out.Columns[1][0]   = 2.0f * (XY - WZ);
        Out.Columns[1][1]   = 1.0f - 2.0f * (XX + ZZ);
        Out.Columns[1][2]   = 2.0f * (YZ + WX);

        Out.Columns[2][0]   = 2.0f * (XZ + WY);
        Out.Columns[2][1]   = 2.0f * (YZ - WX);
        Out.Columns[2][2]   = 1.0f - 2.0f * (XX + YY);

        Out.Columns[3][0]   = Translation.X;
        Out.Columns[3][1]   = Translation.Y;
        Out.Columns[3][2]   = Translation.Z;
        return Out;
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                                 RIGID BODY CATEGORIES
//------------------------------------------------------------------------------------------------------------------------

enum class RigidBodyMotionCategory : uint8_t
{
    Static    = 0u,   // [-] - Immobile collision geometry
    Kinematic = 1u,   // [-] - Pose-driven mover that displaces dynamic bodies
    Dynamic   = 2u    // [-] - Force, impulse, and contact integrated body
};

enum class CollisionShapeCategory : uint8_t
{
    Plane       = 0u,   // [-] - Finite broad-phase half-space plane
    Box         = 1u,   // [-] - Axis-aligned box half extents
    Sphere      = 2u,   // [-] - Uniform sphere radius
    Capsule     = 3u,   // [-] - Z-aligned capsule (half height + cap radius)
    Cylinder    = 4u,   // [-] - Z-aligned cylinder (half height + radius)
    ConvexHull  = 5u,   // [-] - Convex hull over local HullPoints
    Heightfield = 6u    // [-] - +Z-up terrain height grid (CreateHeightfieldBody)
};

//------------------------------------------------------------------------------------------------------------------------
//                                                RIGID BODY DESCRIPTIONS
//------------------------------------------------------------------------------------------------------------------------

struct CollisionShapeDescription
{
    CollisionShapeCategory      Category        = CollisionShapeCategory::Box;
    PhysicsVector3              HalfExtents     {0.5f, 0.5f, 0.5f};   // [m] - Box half extents
    float                       Radius          = 0.5f;               // [m] - Sphere / Capsule / Cylinder radius
    float                       HalfHeight      = 0.5f;               // [m] - Capsule / Cylinder half length along local Z
    PhysicsVector3              PlaneNormal     {0.0f, 0.0f, 1.0f};   // [-] - Plane outward unit normal
    float                       PlaneOffset     = 0.0f;               // [m] - Plane signed offset along PlaneNormal
    float                       PlaneHalfExtent = 500.0f;             // [m] - Plane broad-phase half extent
    std::vector<PhysicsVector3> HullPoints;                           // [m] - Local vertices when Category == ConvexHull
};

struct HeightfieldDescription
{
    std::string    Name;                              // [-] - Diagnostic label
    const float*   Samples     = nullptr;             // [m] - Row-major SampleCount x SampleCount elevation samples
    uint32_t       SampleCount = 0u;                  // [-] - Samples per side; non-zero multiple of 8
    PhysicsVector3 Origin      {0.0f, 0.0f, 0.0f};    // [m] - World position of sample [row=0, col=0]
    float          SpacingX    = 1.0f;                // [m] - Step along world +X per column
    float          SpacingY    = 1.0f;                // [m] - Step along world -Y per row
    float          HeightScale = 1.0f;                // [-] - Elevation scale factor into world +Z
    float          Friction    = 0.9f;                // [-] - Coulomb surface friction
    float          Restitution = 0.0f;                // [-] - Coefficient of restitution
};

struct RigidBodyDescription
{
    std::string               Name;                                                 // [-]     - Diagnostic label
    CollisionShapeDescription Shape;                                                // [-]     - Collision geometry specification
    RigidBodyMotionCategory   Motion              = RigidBodyMotionCategory::Dynamic;
    PhysicsVector3            Position            {0.0f, 0.0f, 0.0f};               // [m]     - Initial world centre-of-mass position
    PhysicsQuaternion         Orientation         = PhysicsQuaternion::Identity();  // [-]     - Initial world orientation
    PhysicsVector3            LinearVelocity      {0.0f, 0.0f, 0.0f};               // [m/s]   - Initial world linear velocity
    PhysicsVector3            AngularVelocity     {0.0f, 0.0f, 0.0f};               // [rad/s] - Initial world angular velocity
    float                     MassKilograms       = 0.0f;                           // [kg]    - Explicit mass (0 = volume * 1000 kg/m^3)
    PhysicsVector3            PrincipalInertia    {0.0f, 0.0f, 0.0f};               // [kg*m^2]- Explicit body-frame inertia (0 = shape)
    float                     Friction            = 0.5f;                           // [-]     - Coulomb friction coefficient
    float                     Restitution         = 0.1f;                           // [-]     - Contact restitution in [0, 1]
    float                     LinearDamping       = 0.05f;                          // [1/s]   - Linear velocity damping
    float                     AngularDamping      = 0.05f;                          // [1/s]   - Angular velocity damping
    float                     GravityFactor       = 1.0f;                           // [-]     - Multiplier on world gravity
    bool                      AllowSleeping       = true;                           // [-]     - Permits Jolt island deactivation
    bool                      ContinuousCollision = false;                          // [-]     - Enables linear-cast CCD
};

//------------------------------------------------------------------------------------------------------------------------
//                                             IDENTITIES, QUERIES & METRICS
//------------------------------------------------------------------------------------------------------------------------

using RigidBodyIdentity  = uint32_t;
using ConstraintIdentity = uint32_t;

constexpr RigidBodyIdentity  InvalidRigidBody  = 0xFFFFFFFFu;
constexpr ConstraintIdentity InvalidConstraint = 0xFFFFFFFFu;

struct SceneCastReading
{
    bool               Contact  = false;              // [-]   - True when ray or shape sweep hit geometry
    PhysicsVector3     Position {0.0f, 0.0f, 0.0f};   // [m]   - World-space contact location
    PhysicsVector3     Normal   {0.0f, 0.0f, 1.0f};   // [-]   - Outward world-space surface normal
    float              Fraction = 1.0f;               // [0,1] - Parametric fraction along cast vector
    float              Distance = 0.0f;               // [m]   - Travel distance to contact
    RigidBodyIdentity  Body     = InvalidRigidBody;   // [-]   - Struck rigid-body slot
};

struct RigidBodyPose
{
    RigidBodyIdentity       Identity        = InvalidRigidBody;
    PhysicsVector3          Position        {};   // [m]     - World-space centre of mass
    PhysicsQuaternion       Orientation     {};   // [-]     - World-space orientation
    PhysicsVector3          LinearVelocity  {};   // [m/s]   - World-space linear velocity
    PhysicsVector3          AngularVelocity {};   // [rad/s] - World-space angular velocity
    RigidBodyMotionCategory Motion          = RigidBodyMotionCategory::Dynamic;
    CollisionShapeCategory  Shape           = CollisionShapeCategory::Box;
    bool                    Awake           = false;
};

struct RigidBodyConfiguration
{
    PhysicsVector3 Gravity                    {0.0f, 0.0f, -9.81f};   // [m/s^2] - World gravitational acceleration (+Z up)
    float          FixedStepSeconds           = 1.0f / 60.0f;         // [s]     - Fixed integrator step duration
    uint32_t       MaxStepsPerAdvance         = 4u;                   // [-]     - Spiral-of-death step cap per Advance()
    uint32_t       CollisionStepsPerStep      = 1u;                   // [-]     - Jolt collision sub-steps per fixed step
    uint32_t       MaxBodies                  = 4096u;                // [-]     - Capacity of Jolt body pool
    uint32_t       MaxBodyPairs               = 4096u;                // [-]     - Capacity of broad-phase pair cache
    uint32_t       MaxContactConstraints      = 4096u;                // [-]     - Capacity of contact constraint buffer
    uint32_t       WorkerThreads              = 0u;                   // [-]     - 0 = clamp(hardware_concurrency - 2, 1, 4)
    uint32_t       TemporaryAllocationBytes   = 16u * 1024u * 1024u;  // [B]     - Per-step Jolt scratch arena capacity
    float          SpeculativeContactDistance = 0.02f;                // [m]     - Speculative contact look-ahead margin
    float          PenetrationSlop            = 0.02f;                // [m]     - Allowed resting penetration tolerance
    float          TimeBeforeSleepSeconds     = 0.5f;                 // [s]     - Quiet interval prior to island sleep
};

struct RigidBodyMetrics
{
    uint32_t BodyCount            = 0u;     // [-]  - Resident rigid bodies in world
    uint32_t AwakeBodyCount       = 0u;     // [-]  - Awake dynamic/kinematic bodies after last step
    uint64_t StepCount            = 0u;     // [-]  - Total fixed steps executed since Bring()
    uint32_t StepsLastAdvance     = 0u;     // [-]  - Fixed steps executed during most recent Advance()
    float    LastStepMilliseconds = 0.0f;   // [ms] - Wall duration of most recent fixed step
    float    AccumulatorSeconds   = 0.0f;   // [s]  - Unconsumed frame time carried forward
    float    DroppedSeconds       = 0.0f;   // [s]  - Cumulative time discarded by backlog guard
};

//------------------------------------------------------------------------------------------------------------------------
//                                                   RIGID BODY SOLVER
//------------------------------------------------------------------------------------------------------------------------

class RigidBodySolver
{
  public:
    RigidBodySolver() noexcept;
    ~RigidBodySolver() noexcept;

    RigidBodySolver(const RigidBodySolver&)            = delete;
    RigidBodySolver& operator=(const RigidBodySolver&) = delete;

    [[nodiscard]] bool Bring(const RigidBodyConfiguration& Configuration = {}) noexcept;
    void               Retire() noexcept;
    [[nodiscard]] bool Active() const noexcept { return WorldActive; }

    [[nodiscard]] RigidBodyIdentity CreateBody(const RigidBodyDescription& Description) noexcept;
    [[nodiscard]] RigidBodyIdentity CreateHeightfieldBody(const HeightfieldDescription& Description) noexcept;
    void                            DestroyBody(RigidBodyIdentity Identity) noexcept;
    void                            DestroyAllBodies() noexcept;
    void                            OptimizeBroadPhase() noexcept;

    void               Advance(float Δτ) noexcept;
    [[nodiscard]] bool StepOnce() noexcept;

    void ApplyImpulse(RigidBodyIdentity Identity, const PhysicsVector3& ImpulseNewtonSeconds) noexcept;
    void ApplyAngularImpulse(RigidBodyIdentity Identity, const PhysicsVector3& AngularImpulse) noexcept;
    void ApplyForce(RigidBodyIdentity Identity, const PhysicsVector3& ForceNewtons) noexcept;
    void ApplyForceAtPoint(RigidBodyIdentity Identity, const PhysicsVector3& ForceNewtons, const PhysicsVector3& WorldPoint) noexcept;
    void ApplyTorque(RigidBodyIdentity Identity, const PhysicsVector3& TorqueNewtonMetres) noexcept;

    void AssignLinearVelocity(RigidBodyIdentity Identity, const PhysicsVector3& Velocity) noexcept;
    void AssignAngularVelocity(RigidBodyIdentity Identity, const PhysicsVector3& AngularVelocity) noexcept;
    void Teleport(RigidBodyIdentity Identity, const PhysicsVector3& Position, const PhysicsQuaternion& Orientation) noexcept;
    void MoveKinematic(RigidBodyIdentity Identity, const PhysicsVector3& Position, const PhysicsQuaternion& Orientation, float Δτ) noexcept;
    void Activate(RigidBodyIdentity Identity) noexcept;

    [[nodiscard]] float          QueryBodyMass(RigidBodyIdentity Identity) const noexcept;
    [[nodiscard]] PhysicsVector3 QueryCenterOfMass(RigidBodyIdentity Identity) const noexcept;
    [[nodiscard]] PhysicsVector3 QueryPointVelocity(RigidBodyIdentity Identity, const PhysicsVector3& WorldPoint) const noexcept;

    [[nodiscard]] SceneCastReading CastRay(
        const PhysicsVector3& Origin,
        const PhysicsVector3& Direction,
        float                 MaxDistance,
        RigidBodyIdentity     Ignore = InvalidRigidBody) const noexcept;

    [[nodiscard]] SceneCastReading CastSphere(
        float                 Radius,
        const PhysicsVector3& From,
        const PhysicsVector3& Sweep,
        RigidBodyIdentity     Ignore = InvalidRigidBody) const noexcept;

    [[nodiscard]] SceneCastReading CastCylinder(
        float                    Radius,
        float                    HalfHeight,
        const PhysicsQuaternion& Orientation,
        const PhysicsVector3&    From,
        const PhysicsVector3&    Sweep,
        RigidBodyIdentity        Ignore = InvalidRigidBody) const noexcept;

    [[nodiscard]] ConstraintIdentity CreateDistanceSpring(
        RigidBodyIdentity     BodyAlpha,
        const PhysicsVector3& WorldAnchorAlpha,
        RigidBodyIdentity     BodyBeta,
        const PhysicsVector3& WorldAnchorBeta,
        float                 MinDistance,
        float                 MaxDistance,
        float                 FrequencyHertz,
        float                 DampingRatio) noexcept;

    void DestroyConstraint(ConstraintIdentity Identity) noexcept;

    [[nodiscard]] bool                          QueryPose(RigidBodyIdentity Identity, RigidBodyPose& OutPose) const noexcept;
    void                                        QueryPoses(std::vector<RigidBodyPose>& OutPoses) const noexcept;
    [[nodiscard]] const std::string&            QueryName(RigidBodyIdentity Identity) const noexcept;
    [[nodiscard]] const RigidBodyMetrics&       QueryMetrics() const noexcept { return Metrics; }
    [[nodiscard]] const RigidBodyConfiguration& QueryConfiguration() const noexcept { return Configuration; }
    [[nodiscard]] float                         QueryInterpolationAlpha() const noexcept;
    [[nodiscard]] const std::string&            QueryLastRefusal() const noexcept { return LastRefusal; }
    [[nodiscard]] static const char*            QueryJoltVersion() noexcept;

    template <typename TargetType>
    [[nodiscard]] TargetType Convert() const noexcept;

  private:
    struct JoltWorld;

    [[nodiscard]] SceneCastReading SweepShapeInternal(
        const void*           ShapePointer,
        const void*           OrientationPointer,
        const PhysicsVector3& From,
        const PhysicsVector3& Sweep,
        uint32_t              IgnoreRaw) const noexcept;

    std::unique_ptr<JoltWorld> World;
    RigidBodyConfiguration     Configuration;           // [-] - Configuration latched during Bring()
    RigidBodyMetrics           Metrics;                 // [-] - Step and occupancy counters
    float                      Accumulator   = 0.0f;    // [s] - Residual frame time awaiting next fixed step
    bool                       WorldActive   = false;   // [-] - True between Bring() and Retire()
    std::string                LastRefusal;             // [-] - Diagnostic description of most recent refusal
};

template <>
inline bool RigidBodySolver::Convert<bool>() const noexcept
{
    return WorldActive;
}

template <>
inline uint32_t RigidBodySolver::Convert<uint32_t>() const noexcept
{
    return Metrics.BodyCount;
}

template <>
inline uint64_t RigidBodySolver::Convert<uint64_t>() const noexcept
{
    return Metrics.StepCount;
}

} // namespace Frontier
