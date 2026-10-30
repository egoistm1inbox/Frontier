/*==========================================================================================================================================
                                                   BALLISTICSPARKEXTENSION.H
==========================================================================================================================================*/
// 🧩 Swept-collision incandescent metallic sparks with Planckian radiative cooling and dynamic shadowed scene illumination.

#pragma once

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                             INCLUDES
------------------------------------------------------------------------------------------------------------------------------------------*/
#include "Engine/Foundation/Math.h"

#include <cstdint>
#include <vector>

namespace Frontier
{
/*------------------------------------------------------------------------------------------------------------------------------------------
                                                 SPARK COLLIDER & LUMINAIRE RECORDS
------------------------------------------------------------------------------------------------------------------------------------------*/
struct SparkSceneColliderBox
{
    Vec3  CentreWorld{};            // [m] - Oriented bounding box centre in world coordinates
    Vec3  AxisX{1.0f, 0.0f, 0.0f};  // [unit] - Local X axis
    Vec3  AxisY{0.0f, 1.0f, 0.0f};  // [unit] - Local Y axis
    Vec3  AxisZ{0.0f, 0.0f, 1.0f};  // [unit] - Local Z axis
    Vec3  HalfExtents{1.0f, 1.0f, 1.0f}; // [m] - Half extents along local X, Y, Z
    float Restitution = 0.44f;      // [0..1] - Normal bounce restitution for hot metallic grit
    float Friction    = 0.22f;      // [0..1] - Tangential scrape damping on rebound
};

struct MetallicScrapeContact
{
    Vec3     ContactPointWorld{};             // [m] - Scrape or impact origin on chassis/rim/barrier
    Vec3     ContactNormalWorld{0.0f, 0.0f, 1.0f}; // [unit] - Outward surface normal
    Vec3     TangentialVelocityMps{18.0f, 0.0f, 0.0f}; // [m/s] - Sliding velocity ejecting incandescent grit
    float    NormalForceNewtons = 4500.0f;    // [N] - Contact load scaling spark spawn rate & temperature
    uint32_t RequestedSparkCount = 24u;       // [count] - Sparks to inject from this contact burst
    uint64_t DeterministicSeed   = 0x5BA2C5ULL;
};

struct BallisticSparkRecord
{
    Vec3     PositionWorld{};       // [m] - Current spark position
    Vec3     TailPositionWorld{};   // [m] - Motion-blurred streak tail position (prev / shutter-integrated)
    Vec3     VelocityMps{};         // [m/s] - Current 3D velocity
    float    RadiusMetres = 0.0007f;// [m] - Incandescent metal particle radius (0.35..1.35 mm)
    float    TemperatureK = 2350.0f;// [K] - Instantaneous blackbody temperature
    float    AgeSeconds   = 0.0f;   // [s] - Elapsed lifetime
    uint16_t BounceCount  = 0u;     // [count] - Cumulative swept collisions with scene geometry / ground
    bool     Active       = false;  // [boolean] - Slot occupancy
};

struct SparkPointLuminaire
{
    Vec3  PositionWorld{};          // [m] - World light position
    Vec3  RadiantIntensityWsr{};    // [W/sr] - Blackbody spectral radiant intensity lighting the scene
    float EffectiveRadiusM = 2.5f;  // [m] - Clustered / ReSTIR cutoff radius
};

struct BallisticSparkConfig
{
    uint32_t MaxSparkBudget         = 2048u;   // [count] - Hard ring-pool budget
    float    GroundElevationMetres  = 0.0f;    // [m] - Default ground floor height
    float    CollisionSkinMetres    = 0.003f;  // [m] - 3 mm swept collision safety offset preventing tunneling
    float    AmbientTemperatureK    = 293.15f; // [K] - Ambient air temperature
    float    MinimumVisibleTempK    = 880.0f;  // [K] - Draper-point cutoff below which glow extinguishes
    float    SceneLuminanceGain     = 18.0f;   // [-] - Photometric coupling scale for near-field spark lighting
};

struct BallisticSparkTelemetry
{
    uint32_t ActiveSparkCount       = 0u;  // [count] - Currently glowing active sparks
    uint64_t CumulativeSpawns       = 0u;  // [count] - Total sparks spawned
    uint64_t SweptSceneCollisions   = 0u;  // [count] - Total swept ground + OBB bounces resolved
    uint64_t ImpactSplitSparks      = 0u;  // [count] - Secondary daughter sparks created on hard impact
    float    PeakTemperatureKelvin  = 0.0f;// [K] - Hottest active spark temperature
};

/*------------------------------------------------------------------------------------------------------------------------------------------
                                                   BALLISTIC SPARK EXTENSION
------------------------------------------------------------------------------------------------------------------------------------------*/
class SparkParticles
{
public:
    explicit SparkParticles(const BallisticSparkConfig& Config = {});

    void Reconfigure(const BallisticSparkConfig& Config);
    void ClearSceneColliders() noexcept;
    void RegisterSceneCollider(const SparkSceneColliderBox& Box);

    // Spawns incandescent sparks along tangential scrape cone (clamped outside ground & registered scene colliders).
    void SpawnScrapeSparks(const MetallicScrapeContact& Contact) noexcept;

    // Advances aerodynamic drag, wind advection, Stefan-Boltzmann T^4 cooling, and swept 3 mm zero-tunneling collisions!
    void StepBallisticSparks(float DtSeconds, Vec3 AmbientWindMps = {0.0f, 0.0f, 0.0f}) noexcept;

    // Evaluates blackbody chromaticity & radiant intensity for temperature T [K].
    [[nodiscard]] static Vec3 EvaluatePlanckianSparkChromaticity(float TemperatureKelvin) noexcept;

    // Exports compacted active spark luminaires for SDF ReSTIR, RTX ReSTIR, and PhotometricLights!
    void PopulateSceneSparkLuminaires(
        std::vector<SparkPointLuminaire>& OutLuminaires,
        uint32_t                          MaxLuminaires = 128u) const;

    // Evaluates direct shadowed scene irradiance [W/m^2] from all active sparks at SurfacePoint (occluded by scene boxes!).
    [[nodiscard]] Vec3 EvaluateShadowedSceneIrradiance(Vec3 SurfacePoint, Vec3 SurfaceNormal) const noexcept;

    // Evaluates crisp SparkRaster.wgsl screen-clamped shutter motion streaks along a camera/reflection ray up to MaxDistanceM.
    [[nodiscard]] Vec3 EvaluateRaySparkStreaks(
        Vec3  RayOrigin,
        Vec3  RayDirectionUnit,
        float MaxDistanceM,
        float PixelAngularRadians = 0.00145f,
        float ShutterSeconds      = 0.024f) const noexcept;

    [[nodiscard]] const std::vector<BallisticSparkRecord>&  Sparks() const noexcept { return Pool_; }
    [[nodiscard]] const std::vector<SparkSceneColliderBox>& SceneColliders() const noexcept { return Colliders_; }
    [[nodiscard]] const BallisticSparkTelemetry&            Telemetry() const noexcept { return Telemetry_; }

private:
    [[nodiscard]] bool SweepSegmentAgainstScene(
        Vec3   StartWorld,
        Vec3   EndWorld,
        float& OutHitFraction,
        Vec3&  OutHitPoint,
        Vec3&  OutHitNormal,
        float& OutRestitution,
        float& OutFriction) const noexcept;

    [[nodiscard]] bool SegmentOccludedByColliders(Vec3 Origin, Vec3 Target) const noexcept;
    void               AllocateSparkSlot(const BallisticSparkRecord& Candidate) noexcept;

    BallisticSparkConfig               Config_{};
    std::size_t                        RingCursor_ = 0u;
    std::vector<BallisticSparkRecord>  Pool_;
    std::vector<SparkSceneColliderBox> Colliders_;
    BallisticSparkTelemetry            Telemetry_{};
};

} // namespace Frontier
