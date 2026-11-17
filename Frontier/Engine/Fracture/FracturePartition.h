/*==========================================================================================================================================
                                                        FRACTUREPARTITION.H
==========================================================================================================================================*/
// Native C++ fracture geometry contract. The deterministic convex clipping and clustered Voronoi solver is ported from
// Experimental Remastered/FractureEditor/Engine/ConvexPartitioning.js (c7egoist/Frontier arena/eb353da2-frontier).
// Jolt and interface dependencies deliberately stay outside this header.

#pragma once

#include <array>
#include <cstdint>
#include <string>
#include <vector>

namespace Frontier::Fracture
{

using Vec3 = std::array<double, 3>;

struct Face
{
    std::vector<uint32_t> Indices;
    uint32_t CutToken = 0;
    bool Interior = false;
};

struct Polyhedron
{
    std::vector<Vec3> Vertices;
    std::vector<Face> Faces;
};

struct Metrics
{
    double Volume = 0.0;
    Vec3 Centroid{};
    Vec3 BoundsMin{};
    Vec3 BoundsMax{};
    Vec3 Span{};
    double Radius = 0.0;
    double CrackArea = 0.0;
};

enum class Solver : uint8_t
{
    RuntimeBoussinesq = 0,
    EngineeringFem,
    Griffith,
    Wavefront,
    Voronoi,
    Dendritic,
};

enum class MaterialKind : uint8_t { Concrete, Granite, Wood, Glass, Tempered, Plastic };
enum class FractureMode : uint8_t { BulkBrittle, PlateBrittle, Fibrous, Ductile };
enum class SolidKind : uint8_t { Monolith, CurtainPane, TimberBeam, Boulder, Cube, Cylinder, Cone, HollowCore };

struct Material
{
    MaterialKind Kind = MaterialKind::Concrete;
    FractureMode Mode = FractureMode::BulkBrittle;
    double DensityKgPerM3 = 2350.0;
    double FractureEnergyJPerM2 = 140.0;
    double TensileStrengthMPa = 3.8;
    double StoredEnergyJPerM3 = 0.0;
    double YoungModulusGPa = 30.0;
    double PoissonRatio = 0.20;
    double AnisotropyRatio = 1.15;
    double Friction = 0.8;
    double Restitution = 0.12;
    double WeibullModulus = 8.0;
    double HertzConeRadians = 0.95;
    double BeddingWeakness = 0.12;
    double RingBias = 0.24;
    double CrackJitter = 0.32;
    double CompressiveStrengthMPa = 38.0;
    double InternalFrictionDegrees = 36.0;
    double HurstExponent = 0.78;
    double AggregateScale = 6.5;
    double AggregateWeight = 0.58;
    double ReliefAmplitudeMetres = 0.036;
};

struct Request
{
    Solver Algorithm = Solver::Voronoi;
    Vec3 HalfExtentMetres{ 0.48, 0.96, 0.48 };
    Vec3 ImpactPointMetres{ 0.08, 0.18, 0.44 };
    Vec3 ImpactNormal{ 0.0, 0.0, -1.0 };
    double EnergyJoules = 4600.0;
    double MinimumPieceSizeMetres = 0.04;
    double GrainAngleDegrees = 0.0;
    double BondStrengthScale = 1.0;
    uint32_t Seed = 42;
    uint32_t FragmentCeiling = 32;
};

struct Fragment
{
    uint32_t Index = 0;
    Polyhedron Shape;
    Metrics ShapeMetrics;
    double MassKg = 0.0;
    double ProximityToImpact = 0.0;
    double StressRatio = 0.0;
    Vec3 InitialVelocityMps{};
    Vec3 InitialAngularVelocityRadPerSec{};
};

struct Bond
{
    uint32_t FragmentA = 0;
    uint32_t FragmentB = 0;
    double SharedAreaM2 = 0.0;
    double CapacityNewtons = 0.0;
    double StrainRatio = 0.0;
    bool BrokenOnImpact = false;
};

struct Result
{
    bool Success = false;
    std::string Diagnostic;
    Metrics BaseMetrics;
    std::vector<Fragment> Fragments;
    std::vector<Bond> Bonds;
    double TotalFragmentVolumeM3 = 0.0;
    double TotalCrackAreaM2 = 0.0;
    double VolumeDriftRatio = 0.0;
    double TotalEnergyBudgetJ = 0.0;
    double ComputeMilliseconds = 0.0;
    double SpentSurfaceEnergyJ = 0.0;
    double RayleighSpeedMps = 0.0;
    bool WatertightManifold = false;
};

[[nodiscard]] Material ResolveMaterial(MaterialKind Kind) noexcept;
[[nodiscard]] Material ResolveMaterialById(const char* Id) noexcept;
[[nodiscard]] Polyhedron ConstructBox(double SizeXMetres, double SizeYMetres, double SizeZMetres);
[[nodiscard]] Polyhedron ConstructSolid(SolidKind Kind, const Vec3& Scale = { 1.0, 1.0, 1.0 }, uint32_t Seed = 17);
[[nodiscard]] Metrics EvaluateMetrics(const Polyhedron& Shape) noexcept;
// Splits a closed convex polyhedron by n·p = d. Front is n·p >= d; Back is n·p <= d.
[[nodiscard]] bool Clip(const Polyhedron& Shape, const Vec3& PlaneNormal, double PlaneOffset,
                         uint32_t CutToken, Polyhedron& OutFront, Polyhedron& OutBack,
                         double& OutCutAreaM2);
[[nodiscard]] Result Execute(const Request& Input, const Material& MaterialProperties);
[[nodiscard]] Result Execute(const Polyhedron& BaseSolid, const Request& Input, const Material& MaterialProperties);
[[nodiscard]] double EvaluateRayleighWaveSpeed(const Material& MaterialProperties) noexcept;
[[nodiscard]] std::vector<Polyhedron> SolveEngineeringPartition(const Polyhedron& Base, const Metrics& BaseMetrics,
                                                               const Request& Input, const Material& MaterialProperties,
                                                               uint32_t Ceiling, double EnergyBudget,
                                                               double& OutSpentEnergyJ, uint64_t& OutRandomDraws);

} // namespace Frontier::Fracture
