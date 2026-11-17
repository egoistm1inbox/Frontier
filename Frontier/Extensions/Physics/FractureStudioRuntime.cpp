/*==========================================================================================================================================
                                                       FRACTURESTUDIORUNTIME.CPP
==========================================================================================================================================*/
// Transactional bridge between the reference fracture partition algorithms and Jolt convex-hull rigid bodies.

#include "Frontier/Extensions/Physics/FractureStudioRuntime.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <utility>

namespace Frontier
{
namespace
{

constexpr uint32_t RefusedBody = std::numeric_limits<uint32_t>::max();
constexpr uint64_t GroundRecord = std::numeric_limits<uint64_t>::max() - 3;

void WriteDiagnostic(std::string* Out, std::string Value)
{
    if (Out != nullptr) *Out = std::move(Value);
}

} // namespace

FractureStudioRuntime::FractureStudioRuntime() = default;
FractureStudioRuntime::~FractureStudioRuntime() = default;

bool FractureStudioRuntime::BuildJoltWorld(const Fracture::Result& Partition, const Fracture::Material& Mat,
                                            std::unique_ptr<PhysicsSpace>& OutSpace,
                                            std::string* OutDiagnostic) const
{
    if (!Partition.Success || Partition.Fragments.empty())
    {
        WriteDiagnostic(OutDiagnostic, Partition.Diagnostic.empty() ? "The solver returned no valid convex fragments."
                                                                     : Partition.Diagnostic);
        return false;
    }
    PhysicsSpaceSettings Settings;
    // The browser/editor solid definitions are Y-up. Jolt permits an arbitrary gravity vector, so keep the reference
    // dimensions, impact planes and proof views byte-for-byte comparable without silently turning the model sideways.
    Settings.GravityMps2 = { 0.0, -9.80665, 0.0 };
    Settings.MaximumBodies = static_cast<uint32_t>(std::clamp<size_t>(Partition.Fragments.size() + 8, 16, 512));
    Settings.Workers = 0;
    auto Candidate = std::make_unique<PhysicsSpace>(Settings);
    for (const Fracture::Fragment& Fragment : Partition.Fragments)
    {
        if (Fragment.Shape.Vertices.size() < 4)
        {
            WriteDiagnostic(OutDiagnostic, "A generated shard has fewer than four convex-hull vertices.");
            return false;
        }
        PhysicsBodyDescriptor Descriptor;
        Descriptor.Record = static_cast<uint64_t>(Fragment.Index) + 1;
        Descriptor.Shape = PhysicsShape::ConvexHull;
        Descriptor.Motion = PhysicsMotion::Moving;
        Descriptor.PositionMetres = Fragment.ShapeMetrics.Centroid;
        Descriptor.MassKilograms = Fragment.MassKg;
        Descriptor.Friction = Mat.Friction;
        Descriptor.Restitution = Mat.Restitution;
        Descriptor.LinearDamping = 0.08;
        Descriptor.LinearVelocityMps = Fragment.InitialVelocityMps;
        Descriptor.AngularVelocityRads = Fragment.InitialAngularVelocityRadPerSec;
        Descriptor.SurfaceClass = Mat.Kind == Fracture::MaterialKind::Glass || Mat.Kind == Fracture::MaterialKind::Tempered
                                      ? SurfaceMaterialClass::Glass
                                  : Mat.Kind == Fracture::MaterialKind::Wood ? SurfaceMaterialClass::Wood
                                  : Mat.Kind == Fracture::MaterialKind::Plastic ? SurfaceMaterialClass::Composite
                                                                               : SurfaceMaterialClass::Concrete;
        PhysicsConvexHullShape Hull;
        Hull.VerticesMetres.reserve(Fragment.Shape.Vertices.size());
        for (const Fracture::Vec3& P : Fragment.Shape.Vertices)
            Hull.VerticesMetres.push_back({ P[0] - Fragment.ShapeMetrics.Centroid[0],
                                            P[1] - Fragment.ShapeMetrics.Centroid[1],
                                            P[2] - Fragment.ShapeMetrics.Centroid[2] });
        Descriptor.VariantShape = std::move(Hull);
        if (Candidate->AddBody(Descriptor) == RefusedBody)
        {
            WriteDiagnostic(OutDiagnostic, "Jolt refused a fragment convex hull; the previous Studio world was kept.");
            return false;
        }
    }

    // A broad fixed box is sufficient for the isolated Studio sandbox; it is not written into the project scene.
    PhysicsBodyDescriptor Ground;
    Ground.Record = GroundRecord;
    Ground.Shape = PhysicsShape::Box;
    Ground.HalfExtentMetres = { 40.0, 0.12, 40.0 };
    Ground.PositionMetres = { Partition.BaseMetrics.Centroid[0], Partition.BaseMetrics.BoundsMin[1] - 0.12,
                              Partition.BaseMetrics.Centroid[2] };
    Ground.Motion = PhysicsMotion::Fixed;
    Ground.Friction = std::clamp(Mat.Friction, 0.0, 10.0);
    Ground.Restitution = std::clamp(Mat.Restitution, 0.0, 1.0);
    Ground.SurfaceClass = SurfaceMaterialClass::Concrete;
    if (Candidate->AddBody(Ground) == RefusedBody)
    {
        WriteDiagnostic(OutDiagnostic, "Jolt could not construct the Studio's temporary ground plane.");
        return false;
    }
    Candidate->Prepare();
    OutSpace = std::move(Candidate);
    if (OutDiagnostic != nullptr) OutDiagnostic->clear();
    return true;
}

bool FractureStudioRuntime::Bake(const Fracture::Polyhedron& BaseSolid, const Fracture::Request& Specification,
                                 const Fracture::Material& MaterialProperties, std::string* OutDiagnostic)
{
    Fracture::Result CandidateResult = Fracture::Execute(BaseSolid, Specification, MaterialProperties);
    if (!CandidateResult.Success)
    {
        WriteDiagnostic(OutDiagnostic, CandidateResult.Diagnostic);
        return false;
    }
    std::unique_ptr<PhysicsSpace> CandidateSpace;
    if (!BuildJoltWorld(CandidateResult, MaterialProperties, CandidateSpace, OutDiagnostic)) return false;

    BaseSolid_ = BaseSolid;
    Specification_ = Specification;
    Material_ = MaterialProperties;
    Result_ = std::move(CandidateResult);
    Space = std::move(CandidateSpace);
    FragmentBodyCount_ = Result_.Fragments.size();
    return true;
}

bool FractureStudioRuntime::Strike(const Fracture::Vec3& ImpactPoint, const Fracture::Vec3& ImpactNormal,
                                  double EnergyJoules, std::string* OutDiagnostic)
{
    if (BaseSolid_.Vertices.empty())
    {
        WriteDiagnostic(OutDiagnostic, "Choose or bake a source solid before striking it.");
        return false;
    }
    Fracture::Request Candidate = Specification_;
    Candidate.ImpactPointMetres = ImpactPoint;
    Candidate.ImpactNormal = ImpactNormal;
    Candidate.EnergyJoules = EnergyJoules;
    return Bake(BaseSolid_, Candidate, Material_, OutDiagnostic);
}

bool FractureStudioRuntime::Reassemble(std::string* OutDiagnostic)
{
    if (BaseSolid_.Vertices.empty())
    {
        WriteDiagnostic(OutDiagnostic, "Choose a source solid before reassembling the Studio scene.");
        return false;
    }
    Fracture::Result Candidate;
    Candidate.BaseMetrics = Fracture::EvaluateMetrics(BaseSolid_);
    Fracture::Fragment Whole;
    Whole.Index = 0;
    Whole.Shape = BaseSolid_;
    Whole.ShapeMetrics = Candidate.BaseMetrics;
    Whole.MassKg = Candidate.BaseMetrics.Volume * Material_.DensityKgPerM3;
    Candidate.Fragments.push_back(std::move(Whole));
    Candidate.TotalFragmentVolumeM3 = Candidate.BaseMetrics.Volume;
    Candidate.TotalEnergyBudgetJ = 0.0;
    Candidate.WatertightManifold = Candidate.BaseMetrics.Volume > 0.0;
    Candidate.Success = Candidate.WatertightManifold;
    std::unique_ptr<PhysicsSpace> CandidateSpace;
    if (!BuildJoltWorld(Candidate, Material_, CandidateSpace, OutDiagnostic)) return false;
    Result_ = std::move(Candidate);
    Space = std::move(CandidateSpace);
    FragmentBodyCount_ = 1;
    return true;
}

void FractureStudioRuntime::Step(double DeltaSeconds, uint32_t CollisionSteps)
{
    if (Space != nullptr && std::isfinite(DeltaSeconds) && DeltaSeconds > 0.0)
        Space->Step(std::min(DeltaSeconds, 0.25), std::max(1u, CollisionSteps));
}

bool FractureStudioRuntime::QueryFragmentBody(uint32_t Index, Fracture::BodyPose& OutPose) const noexcept
{
    if (Space == nullptr || Index >= FragmentBodyCount_) return false;
    const PhysicsBodyReading Reading = Space->ReadBody(Index);
    OutPose.PositionMetres = Reading.PositionMetres;
    OutPose.Orientation = Reading.Orientation;
    OutPose.LinearVelocityMps = Reading.LinearVelocityMps;
    OutPose.AngularVelocityRads = Reading.AngularVelocityRads;
    OutPose.Awake = Reading.Awake;
    return true;
}

size_t FractureStudioRuntime::QueryAwakeBodyCount() const noexcept
{
    return Space != nullptr ? Space->QueryAwakeCount() : 0;
}

double FractureStudioRuntime::QuerySimulatedSeconds() const noexcept
{
    return Space != nullptr ? Space->QuerySimulatedSeconds() : 0.0;
}

} // namespace Frontier
