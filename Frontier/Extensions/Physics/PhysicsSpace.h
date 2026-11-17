/*==========================================================================================================================================
                                                               PHYSICSSPACE.H
==========================================================================================================================================*/
// 🧩 PhysicsSpace, the world rigid bodies live in: multi-shape bodies stepped by IPhysicsSubstrate (JoltSubstrate by default),
//    impact telemetry stream, and `.physicsspace` schema serialization via SpaceCodec.

#pragma once

#include "Frontier/Engine/Foundation/Constants.h"
#include "Frontier/Engine/Scene/SpaceCodec.h"
#include "Frontier/Extensions/Physics/PhysicsSubstrate.h"

#include <array>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

namespace Frontier
{

inline constexpr std::string_view PhysicsSpaceExtension = ".physicsspace";
inline constexpr std::string_view PhysicsSpaceFormat    = "frontier.physicsspace";
inline constexpr int64_t          PhysicsSpaceVersion   = 1;

//------------------------------------------------------------------------------------------------------------------------
//                                              .PHYSICSSPACE DOCUMENT & SCHEMA
//------------------------------------------------------------------------------------------------------------------------

struct PhysicsBodyDocumentEntry
{
    uint64_t             Record              = 0;
    PhysicsShape         Shape               = PhysicsShape::Box;
    std::array<double, 3> HalfExtentMetres   = { 0.5, 0.5, 0.5 };
    std::array<double, 3> PositionMetres     = { 0.0, 0.0, 0.0 };
    std::array<double, 4> Orientation        = { 0.0, 0.0, 0.0, 1.0 };
    PhysicsMotion        Motion              = PhysicsMotion::Moving;
    double               MassKilograms       = 0.0;
    double               Friction            = 0.5;
    double               Restitution         = 0.2;
    double               LinearDamping       = 0.05;
    SurfaceMaterialClass SurfaceClass        = SurfaceMaterialClass::Concrete;
};

struct PhysicsSpaceDocument
{
    std::array<double, 3>                 GravityMps2   = { 0.0, 0.0, -PhysicsConstantsD::StandardGravityMps2 };
    uint32_t                              MaximumBodies = 8192;
    uint32_t                              Workers       = 0;
    std::vector<PhysicsBodyDocumentEntry> Bodies;
};

template <>
struct SpaceSchema<PhysicsBodyDocumentEntry>
{
    static constexpr auto Bindings() noexcept
    {
        using E = PhysicsBodyDocumentEntry;
        return std::make_tuple(
            MakeFieldBinding("record", &E::Record),
            MakeFieldBinding("shape", &E::Shape),
            MakeFieldBinding("half_extent_m", &E::HalfExtentMetres),
            MakeFieldBinding("position_m", &E::PositionMetres),
            MakeFieldBinding("orientation", &E::Orientation),
            MakeFieldBinding("motion", &E::Motion),
            MakeClampedField("mass_kg", &E::MassKilograms, 0.0, 1.0e9),
            MakeClampedField("friction", &E::Friction, 0.0, 10.0),
            MakeClampedField("restitution", &E::Restitution, 0.0, 1.0),
            MakeClampedField("linear_damping", &E::LinearDamping, 0.0, 100.0),
            MakeFieldBinding("surface_class", &E::SurfaceClass));
    }
};

template <>
struct SpaceSchema<PhysicsSpaceDocument>
{
    static constexpr auto Bindings() noexcept
    {
        using Doc = PhysicsSpaceDocument;
        return std::make_tuple(
            MakeFieldBinding("gravity_mps2", &Doc::GravityMps2),
            MakeClampedField("maximum_bodies", &Doc::MaximumBodies, 16.0, 1048576.0),
            MakeClampedField("workers", &Doc::Workers, 0.0, 64.0),
            MakeFieldBinding("bodies", &Doc::Bodies));
    }
};

class PhysicsSpace
{
  public:
    explicit PhysicsSpace(const PhysicsSpaceSettings& Settings = {});
    PhysicsSpace(std::unique_ptr<IPhysicsSubstrate> CustomSubstrate, const PhysicsSpaceSettings& Settings = {});
    ~PhysicsSpace();

    PhysicsSpace(const PhysicsSpace&)            = delete;
    PhysicsSpace& operator=(const PhysicsSpace&) = delete;

    // 📝 The body's index in the space (0, 1, 2 …), or UINT32_MAX when the space is full or the shape is degenerate.
    uint32_t AddBody(const PhysicsBodyDescriptor& Descriptor);
    void     Prepare();
    void     Step(double DeltaSeconds, uint32_t CollisionSteps = 1);
    void     SetGravity(const std::array<double, 3>& GravityMps2);

    [[nodiscard]] PhysicsBodyReading               ReadBody(uint32_t Index) const;
    [[nodiscard]] const PhysicsBodyDescriptor&     QueryDescriptor(uint32_t Index) const { return Descriptors[Index]; }
    [[nodiscard]] size_t                           QueryBodyCount() const noexcept { return Descriptors.size(); }
    [[nodiscard]] size_t                           QueryAwakeCount() const;
    [[nodiscard]] uint64_t                         QueryContactsAdded() const noexcept;
    [[nodiscard]] double                           QuerySimulatedSeconds() const noexcept { return SimulatedSeconds; }
    [[nodiscard]] uint32_t                         QueryWorkers() const noexcept;
    [[nodiscard]] std::vector<PhysicsImpactEvent>  DrainImpactEvents();
    [[nodiscard]] uint64_t                         QueryImpactCount() const;
    [[nodiscard]] const PhysicsSpaceSettings&      QuerySettings() const noexcept { return Settings_; }

    [[nodiscard]] PhysicsSpaceDocument ExportDocument() const;
    bool ImportDocument(const PhysicsSpaceDocument& Document);

  private:
    PhysicsSpaceSettings               Settings_{};
    std::unique_ptr<IPhysicsSubstrate> Substrate;
    std::vector<PhysicsBodyDescriptor> Descriptors;
    double                             SimulatedSeconds = 0.0;
};

[[nodiscard]] bool WritePhysicsSpace(const PhysicsSpace&          Space,
                                     const std::filesystem::path& FilePath,
                                     std::string*                 OutDiagnostic = nullptr);
[[nodiscard]] bool ReadPhysicsSpace(const std::filesystem::path& FilePath,
                                    PhysicsSpace&                OutSpace,
                                    std::string*                 OutDiagnostic = nullptr);

// 📝 The level's Euler convention (OrientationDegrees: R = Rz(γ) · Ry(β) · Rx(α)) to and from a unit quaternion (x, y, z, w).
[[nodiscard]] std::array<double, 4> ResolvePhysicsOrientation(const std::array<double, 3>& OrientationDegrees) noexcept;
[[nodiscard]] std::array<double, 3> ResolvePhysicsEulerDegrees(const std::array<double, 4>& Orientation) noexcept;
[[nodiscard]] std::array<double, 3> RotatePhysicsVector(const std::array<double, 4>& Orientation,
                                                        const std::array<double, 3>& Vector) noexcept;

} // namespace Frontier
