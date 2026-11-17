/*============================================================================================================================================
                                              PARAMETRICSKETCHERWORKSPACESESSION.CPP
============================================================================================================================================*/
// 🧩 Parametric Sketcher workspace session implementation: native starter geometry, compact revision entries, .Sketch I/O, derived display networks

//------------------------------------------------------------------------------------------------------------------------
//                                                        INCLUDES
//------------------------------------------------------------------------------------------------------------------------

#include "Engine/Workspaces/ParametricSketcher/ParametricSketcherWorkspaceSession.h"

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <utility>

namespace Frontier::Workspaces::ParametricSketcher
{

namespace
{

[[nodiscard]] GeometrySpace::FaceShadingAssignment ConstructStarterShading() noexcept
{
    GeometrySpace::FaceShadingAssignment Shading{};
    Shading.AlbedoLinearRGB     = { 0.20f, 0.44f, 0.82f };
    Shading.MatCapTintLinearRGB = { 0.92f, 0.96f, 1.00f };
    Shading.Metallic            = 0.72f;
    Shading.Roughness           = 0.20f;
    Shading.Specular            = 0.68f;
    Shading.MatCapBlend         = 0.78f;
    Shading.MatCapSlot          = 8u;
    return Shading;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    SESSION INITIALIZATION
//------------------------------------------------------------------------------------------------------------------------

ParametricSketcherWorkspaceSession::ParametricSketcherWorkspaceSession()
{
    ResetToStarterDocument();
}

void ParametricSketcherWorkspaceSession::ResetToStarterDocument()
{
    Document = {};
    Document.DocumentTitle = "UntitledSketch";
    RevisionHistory.Reset();
    DerivedNetworks.clear();
    SelectedProfileOrdinal = ::Frontier::ParametricSketcher::InvalidSketchOrdinal;
    SelectedBodyOrdinal    = ::Frontier::ParametricSketcher::InvalidSketchOrdinal;
    NextRevisionStamp      = 1ull;

    std::string Diagnostic;
    const uint32_t ProfileOrdinal = ConstructRectangleSketch(
        "Sketch Profile",
        { -1.5f, -1.0f },
        { 1.5f, 1.0f },
        Diagnostic);
    if (ProfileOrdinal == ::Frontier::ParametricSketcher::InvalidSketchOrdinal)
    {
        StatusText = "Starter sketch construction failed: " + Diagnostic;
        return;
    }
    const uint32_t BodyOrdinal = ConstructPrismaticFeature(ProfileOrdinal, 4.0f, ConstructStarterShading(), Diagnostic);
    if (BodyOrdinal == ::Frontier::ParametricSketcher::InvalidSketchOrdinal)
    {
        StatusText = "Starter prism construction failed: " + Diagnostic;
        return;
    }
    RevisionHistory.MarkSavedAtCurrentCursor();
    StatusText = "Ready  |  Sketch Profile + Prismatic Body";
}

//------------------------------------------------------------------------------------------------------------------------
//                                                AUTHORING OPERATIONS
//------------------------------------------------------------------------------------------------------------------------

uint32_t ParametricSketcherWorkspaceSession::ConstructRectangleSketch(
    std::string         ProfileTitle,
    Mathematics::Axis2D MinimumCorner,
    Mathematics::Axis2D MaximumCorner,
    std::string&        OutDiagnostic)
{
    ::Frontier::ParametricSketcher::SketchProfile Profile = ::Frontier::ParametricSketcher::ConstructRectangleProfile(
        ::Frontier::ParametricSketcher::InvalidSketchOrdinal,
        std::move(ProfileTitle),
        MinimumCorner,
        MaximumCorner);
    const uint32_t ProfileOrdinal = ::Frontier::ParametricSketcher::AppendSketchProfile(Document, std::move(Profile), OutDiagnostic);
    if (ProfileOrdinal == ::Frontier::ParametricSketcher::InvalidSketchOrdinal)
    {
        return ProfileOrdinal;
    }

    SelectedProfileOrdinal = ProfileOrdinal;
    RecordCompactOperation("CreateRectangle", ProfileOrdinal, MinimumCorner.X, MinimumCorner.Y, MaximumCorner.X, MaximumCorner.Y);
    if (!RebuildDerivedNetworks(OutDiagnostic))
    {
        return ::Frontier::ParametricSketcher::InvalidSketchOrdinal;
    }
    StatusText = "Created rectangle SketchProfile " + std::to_string(ProfileOrdinal);
    return ProfileOrdinal;
}

uint32_t ParametricSketcherWorkspaceSession::ConstructPrismaticFeature(
    uint32_t                             ProfileOrdinal,
    float                                ExtrusionLengthMeters,
    GeometrySpace::FaceShadingAssignment SurfaceShading,
    std::string&                         OutDiagnostic)
{
    const uint32_t BodyOrdinal = ::Frontier::ParametricSketcher::ConstructPrismaticBody(
        Document,
        ProfileOrdinal,
        ExtrusionLengthMeters,
        SurfaceShading,
        OutDiagnostic);
    if (BodyOrdinal == ::Frontier::ParametricSketcher::InvalidSketchOrdinal)
    {
        return BodyOrdinal;
    }

    SelectedProfileOrdinal = ProfileOrdinal;
    SelectedBodyOrdinal    = BodyOrdinal;
    RecordCompactOperation("ConstructPrism", BodyOrdinal, ExtrusionLengthMeters, static_cast<double>(SurfaceShading.MatCapSlot), 0.0, 0.0);
    if (!RebuildDerivedNetworks(OutDiagnostic))
    {
        return ::Frontier::ParametricSketcher::InvalidSketchOrdinal;
    }
    StatusText = "Constructed PrismaticBody " + std::to_string(BodyOrdinal);
    return BodyOrdinal;
}

bool ParametricSketcherWorkspaceSession::RebuildDerivedNetworks(std::string& OutDiagnostic)
{
    std::vector<GeometrySpace::PolygonNetwork> RebuiltNetworks;
    RebuiltNetworks.reserve(Document.Bodies.size());
    for (const ::Frontier::ParametricSketcher::PrismaticBody& Body : Document.Bodies)
    {
        GeometrySpace::PolygonNetwork DerivedNetwork{};
        if (!::Frontier::ParametricSketcher::ConstructBodySurfaceNetwork(Document, Body.BodyOrdinal, DerivedNetwork, OutDiagnostic))
        {
            return false;
        }
        RebuiltNetworks.push_back(std::move(DerivedNetwork));
    }
    DerivedNetworks = std::move(RebuiltNetworks);
    OutDiagnostic.clear();
    return true;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  NATIVE .SKETCH I/O
//------------------------------------------------------------------------------------------------------------------------

bool ParametricSketcherWorkspaceSession::SaveSketchDocument(
    const std::filesystem::path& TargetPath,
    std::string&                 OutDiagnostic)
{
    if (!Codecs::SketchEncoder::EncodeToFile(TargetPath, Document, OutDiagnostic, &RevisionHistory))
    {
        return false;
    }
    RevisionHistory.MarkSavedAtCurrentCursor();
    StatusText = "Saved " + TargetPath.filename().string();
    return true;
}

bool ParametricSketcherWorkspaceSession::LoadSketchDocument(
    const std::filesystem::path& SourcePath,
    std::string&                 OutDiagnostic)
{
    ::Frontier::ParametricSketcher::ParametricSketcherDocument LoadedDocument{};
    RevisionTracker LoadedRevision(RevisionHistory.QueryDocumentBudgetBytes());
    if (!Codecs::SketchDecoder::DecodeFromFile(SourcePath, LoadedDocument, OutDiagnostic, &LoadedRevision))
    {
        return false;
    }

    Document        = std::move(LoadedDocument);
    RevisionHistory = std::move(LoadedRevision);
    SelectedProfileOrdinal = Document.Profiles.empty() ? ::Frontier::ParametricSketcher::InvalidSketchOrdinal : Document.Profiles.front().ProfileOrdinal;
    SelectedBodyOrdinal    = Document.Bodies.empty() ? ::Frontier::ParametricSketcher::InvalidSketchOrdinal : Document.Bodies.front().BodyOrdinal;
    NextRevisionStamp      = RevisionHistory.QueryLatestSequenceStamp() + 1ull;
    if (!RebuildDerivedNetworks(OutDiagnostic))
    {
        return false;
    }
    RevisionHistory.MarkSavedAtCurrentCursor();
    StatusText = "Loaded " + SourcePath.filename().string();
    return true;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     SELECTION
//------------------------------------------------------------------------------------------------------------------------

void ParametricSketcherWorkspaceSession::SelectProfile(uint32_t ProfileOrdinal) noexcept
{
    if (::Frontier::ParametricSketcher::ResolveSketchProfile(Document, ProfileOrdinal) != nullptr)
    {
        SelectedProfileOrdinal = ProfileOrdinal;
        SelectedBodyOrdinal    = ::Frontier::ParametricSketcher::InvalidSketchOrdinal;
    }
}

void ParametricSketcherWorkspaceSession::SelectBody(uint32_t BodyOrdinal) noexcept
{
    const ::Frontier::ParametricSketcher::PrismaticBody* Body = ::Frontier::ParametricSketcher::ResolvePrismaticBody(Document, BodyOrdinal);
    if (Body != nullptr)
    {
        SelectedBodyOrdinal    = BodyOrdinal;
        SelectedProfileOrdinal = Body->ProfileOrdinal;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                COMPACT REVISION RECORDING
//------------------------------------------------------------------------------------------------------------------------

void ParametricSketcherWorkspaceSession::RecordCompactOperation(
    std::string_view OperationTag,
    uint32_t         TargetOrdinal,
    double           FirstScalar,
    double           SecondScalar,
    double           ThirdScalar,
    double           FourthScalar)
{
    ParametricOperationParameters Operation{};
    Operation.Category      = ParametricOperationCategory::StructuredPayloadDelta;
    Operation.TargetChannel = TargetOrdinal;
    Operation.Scalars       = { FirstScalar, SecondScalar, ThirdScalar, FourthScalar, 0.0, 0.0, 0.0, 0.0 };
    const std::size_t CopyCount = std::min(OperationTag.size(), sizeof(Operation.OperationTag) - 1u);
    std::memcpy(Operation.OperationTag, OperationTag.data(), CopyCount);
    (void)RevisionHistory.RecordParametricOperation(Operation, NextRevisionStamp++);
}

} // namespace Frontier::Workspaces::ParametricSketcher
