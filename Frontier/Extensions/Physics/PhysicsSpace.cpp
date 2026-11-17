/*==========================================================================================================================================
                                                              PHYSICSSPACE.CPP
==========================================================================================================================================*/
// 🧩 PhysicsSpace: bridges IPhysicsSubstrate (JoltSubstrate default or injected backend) and .physicsspace document codecs.

#include "Frontier/Extensions/Physics/PhysicsSpace.h"

#include "Frontier/Engine/Foundation/Math.h"
#include "Frontier/Extensions/Physics/JoltSubstrate.h"

#include <limits>

namespace Frontier
{

PhysicsSpace::PhysicsSpace(const PhysicsSpaceSettings& Settings)
    : Settings_(Settings), Substrate(std::make_unique<JoltSubstrate>(Settings))
{
}

PhysicsSpace::PhysicsSpace(std::unique_ptr<IPhysicsSubstrate> CustomSubstrate, const PhysicsSpaceSettings& Settings)
    : Settings_(Settings), Substrate(std::move(CustomSubstrate))
{
}

PhysicsSpace::~PhysicsSpace() = default;

uint32_t PhysicsSpace::AddBody(const PhysicsBodyDescriptor& Descriptor)
{
    if (!Substrate || Descriptors.size() >= Settings_.MaximumBodies)
    {
        return std::numeric_limits<uint32_t>::max();
    }
    const uint32_t Index = Substrate->AddBody(Descriptor);
    if (Index == std::numeric_limits<uint32_t>::max())
    {
        return Index;
    }
    Descriptors.push_back(Descriptor);
    return Index;
}

void PhysicsSpace::Prepare()
{
    if (Substrate)
    {
        Substrate->Prepare();
    }
}

void PhysicsSpace::Step(double DeltaSeconds, uint32_t CollisionSteps)
{
    if (!Substrate || !(DeltaSeconds > 0.0))
    {
        return;
    }
    Substrate->Step(DeltaSeconds, CollisionSteps);
    SimulatedSeconds += DeltaSeconds;
}

void PhysicsSpace::SetGravity(const std::array<double, 3>& GravityMps2)
{
    Settings_.GravityMps2 = GravityMps2;
    if (Substrate)
    {
        Substrate->SetGravity(GravityMps2);
    }
}

PhysicsBodyReading PhysicsSpace::ReadBody(uint32_t Index) const
{
    return Substrate ? Substrate->ReadBody(Index) : PhysicsBodyReading{};
}

size_t PhysicsSpace::QueryAwakeCount() const
{
    return Substrate ? Substrate->QueryAwakeCount() : 0;
}

uint64_t PhysicsSpace::QueryContactsAdded() const noexcept
{
    return Substrate ? Substrate->QueryContactsAdded() : 0;
}

uint32_t PhysicsSpace::QueryWorkers() const noexcept
{
    return Substrate ? Substrate->QueryWorkers() : 0;
}

std::vector<PhysicsImpactEvent> PhysicsSpace::DrainImpactEvents()
{
    return Substrate ? Substrate->DrainImpactEvents() : std::vector<PhysicsImpactEvent>{};
}

uint64_t PhysicsSpace::QueryImpactCount() const
{
    return Substrate ? Substrate->QueryImpactCount() : 0;
}

PhysicsSpaceDocument PhysicsSpace::ExportDocument() const
{
    PhysicsSpaceDocument Doc;
    Doc.GravityMps2   = Settings_.GravityMps2;
    Doc.MaximumBodies = Settings_.MaximumBodies;
    Doc.Workers       = Settings_.Workers;
    Doc.Bodies.reserve(Descriptors.size());
    for (size_t Index = 0; Index < Descriptors.size(); ++Index)
    {
        const PhysicsBodyDescriptor& Desc    = Descriptors[Index];
        const PhysicsBodyReading     Current = ReadBody(static_cast<uint32_t>(Index));
        PhysicsBodyDocumentEntry     Entry;
        Entry.Record           = Desc.Record;
        Entry.Shape            = Desc.Shape;
        Entry.HalfExtentMetres = Desc.HalfExtentMetres;
        Entry.PositionMetres   = Current.PositionMetres;
        Entry.Orientation      = Current.Orientation;
        Entry.Motion           = Desc.Motion;
        Entry.MassKilograms    = Desc.MassKilograms;
        Entry.Friction         = Desc.Friction;
        Entry.Restitution      = Desc.Restitution;
        Entry.LinearDamping    = Desc.LinearDamping;
        Entry.SurfaceClass     = Desc.SurfaceClass;
        Doc.Bodies.push_back(Entry);
    }
    return Doc;
}

bool PhysicsSpace::ImportDocument(const PhysicsSpaceDocument& Document)
{
    Settings_.GravityMps2   = Document.GravityMps2;
    Settings_.MaximumBodies = Document.MaximumBodies;
    Settings_.Workers       = Document.Workers;
    if (Substrate)
    {
        Substrate->SetGravity(Document.GravityMps2);
    }
    for (const PhysicsBodyDocumentEntry& Entry : Document.Bodies)
    {
        PhysicsBodyDescriptor Desc;
        Desc.Record           = Entry.Record;
        Desc.Shape            = Entry.Shape;
        Desc.HalfExtentMetres = Entry.HalfExtentMetres;
        Desc.PositionMetres   = Entry.PositionMetres;
        Desc.Orientation      = Entry.Orientation;
        Desc.Motion           = Entry.Motion;
        Desc.MassKilograms    = Entry.MassKilograms;
        Desc.Friction         = Entry.Friction;
        Desc.Restitution      = Entry.Restitution;
        Desc.LinearDamping    = Entry.LinearDamping;
        Desc.SurfaceClass     = Entry.SurfaceClass;
        if (AddBody(Desc) == std::numeric_limits<uint32_t>::max())
        {
            return false;
        }
    }
    Prepare();
    return true;
}

bool WritePhysicsSpace(const PhysicsSpace&          Space,
                       const std::filesystem::path& FilePath,
                       std::string*                 OutDiagnostic)
{
    return EncodeSpaceFile(FilePath,
                           PhysicsSpaceExtension,
                           PhysicsSpaceFormat,
                           PhysicsSpaceVersion,
                           Space.ExportDocument(),
                           OutDiagnostic);
}

bool ReadPhysicsSpace(const std::filesystem::path& FilePath,
                      PhysicsSpace&                OutSpace,
                      std::string*                 OutDiagnostic)
{
    PhysicsSpaceDocument Doc;
    if (!DecodeSpaceFile(FilePath, PhysicsSpaceExtension, PhysicsSpaceFormat, PhysicsSpaceVersion, Doc, OutDiagnostic))
    {
        return false;
    }
    return OutSpace.ImportDocument(Doc);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    ORIENTATION
//------------------------------------------------------------------------------------------------------------------------

std::array<double, 4> ResolvePhysicsOrientation(const std::array<double, 3>& OrientationDegrees) noexcept
{
    return Quatd::FromEulerDegreesZYX({ OrientationDegrees[0], OrientationDegrees[1], OrientationDegrees[2] }).ToArray();
}

std::array<double, 3> ResolvePhysicsEulerDegrees(const std::array<double, 4>& Q) noexcept
{
    return Quatd{ Q[0], Q[1], Q[2], Q[3] }.ToEulerDegreesZYX().ToArray();
}

std::array<double, 3> RotatePhysicsVector(const std::array<double, 4>& Q, const std::array<double, 3>& V) noexcept
{
    return Quatd{ Q[0], Q[1], Q[2], Q[3] }.RotateVector({ V[0], V[1], V[2] }).ToArray();
}

} // namespace Frontier
