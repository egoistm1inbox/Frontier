/*============================================================================================================================================
                                               PARAMETRICSKETCHERGEOMETRYVALIDATION.CPP
============================================================================================================================================*/
// 🧩 Native Parametric Sketcher Phase 1 validation for planar profiles, prismatic metrics, PolygonNetwork derivation, plus .Sketch persistence

//------------------------------------------------------------------------------------------------------------------------
//                                                        INCLUDES
//------------------------------------------------------------------------------------------------------------------------

#include "Engine/Codecs/SketchCodec.h"
#include "Engine/Codecs/SpaceContainerCodec.h"
#include "Engine/ParametricSketcher/ParametricSketcherDocument.h"
#include "Exhibits/SoftwareCanvasRasterizer.h"

#include <imgui.h>

#include <cmath>
#include <cstddef>
#include <cstdio>
#include <filesystem>
#include <string>
#include <utility>
#include <vector>

namespace
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    VALIDATION UTILITIES
//------------------------------------------------------------------------------------------------------------------------

[[nodiscard]] bool VerifyCondition(bool ConditionMet, const char* Description) noexcept
{
    if (!ConditionMet)
    {
        std::fprintf(stderr, "[ParametricSketcherGeometryValidation] FAILED: %s\n", Description);
        return false;
    }
    return true;
}

[[nodiscard]] bool QueryNear(double First, double Second, double Tolerance = 1.0e-6) noexcept
{
    return std::fabs(First - Second) <= Tolerance;
}

struct PhaseOneMetrics
{
    double   SketchAreaSquareMeters      = 0.0; // [m^2] - Exact rectangle area from retained 2D profile
    double   PrismVolumeCubicMeters      = 0.0; // [m^3] - Exact prism volume from profile area plus extrusion length
    double   PrismSurfaceSquareMeters    = 0.0; // [m^2] - Exact cap plus wall surface area
    uint32_t DerivedVertexCount          = 0u;  // [count] - Derived PolygonNetwork display vertex count
    uint32_t DerivedFaceCount            = 0u;  // [count] - Derived PolygonNetwork display face count
};

//------------------------------------------------------------------------------------------------------------------------
//                                          PLANAR PROFILE PLUS PRISM CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

[[nodiscard]] bool ValidatePlanarProfilePrism(
    Frontier::ParametricSketcher::ParametricSketcherDocument& OutDocument,
    uint32_t&                                                  OutBodyOrdinal,
    PhaseOneMetrics&                                           OutMetrics)
{
    using namespace Frontier::ParametricSketcher;

    OutDocument.DocumentTitle = "PhaseOneBracket";
    std::string Diagnostic;
    SketchProfile Rectangle = ConstructRectangleProfile(
        InvalidSketchOrdinal,
        "MountingPlate",
        { -1.5f, -1.0f },
        { 1.5f, 1.0f });
    const uint32_t ProfileOrdinal = AppendSketchProfile(OutDocument, std::move(Rectangle), Diagnostic);
    if (!VerifyCondition(ProfileOrdinal != InvalidSketchOrdinal, "Accepted a simple CCW rectangular SketchProfile") ||
        !VerifyCondition(OutDocument.Profiles.size() == 1u, "Retained one persistent SketchProfile"))
    {
        return false;
    }

    const SketchProfile& Profile = OutDocument.Profiles.front();
    OutMetrics.SketchAreaSquareMeters = QuerySketchAreaSquareMeters(Profile);
    if (!VerifyCondition(QueryNear(OutMetrics.SketchAreaSquareMeters, 6.0), "Rectangle exact area equals 6 m2") ||
        !VerifyCondition(QueryNear(QuerySketchPerimeterMeters(Profile), 10.0), "Rectangle exact perimeter equals 10 m"))
    {
        return false;
    }

    SketchProfile Crossing{};
    Crossing.ProfileOrdinal = 8u;
    Crossing.ProfileTitle   = "CrossingContour";
    Crossing.ClosedContour  = { { -1.0f, -1.0f }, { 1.0f, 1.0f }, { -1.0f, 1.0f }, { 1.0f, -1.0f } };
    if (!VerifyCondition(
            ValidateSketchProfile(Crossing, Diagnostic) == SketchContourValidity::SelfIntersection,
            "Rejected self-intersecting sketch contour without document mutation"))
    {
        return false;
    }

    Frontier::GeometrySpace::FaceShadingAssignment Shading{};
    Shading.AlbedoLinearRGB     = { 0.20f, 0.44f, 0.82f };
    Shading.MatCapTintLinearRGB = { 0.92f, 0.96f, 1.00f };
    Shading.Metallic            = 0.72f;
    Shading.Roughness           = 0.20f;
    Shading.MatCapBlend         = 0.78f;
    Shading.MatCapSlot          = 8u;

    Frontier::GeometrySpace::FaceShadingAssignment InvalidShading = Shading;
    InvalidShading.MatCapSlot = 16u;
    if (!VerifyCondition(
            ConstructPrismaticBody(OutDocument, ProfileOrdinal, 4.0f, InvalidShading, Diagnostic) == InvalidSketchOrdinal,
            "Rejected an out-of-range MatCap assignment without document mutation") ||
        !VerifyCondition(OutDocument.Bodies.empty(), "Invalid PrismaticBody construction leaves no persistent feature"))
    {
        return false;
    }

    OutBodyOrdinal = ConstructPrismaticBody(OutDocument, ProfileOrdinal, 4.0f, Shading, Diagnostic);
    if (!VerifyCondition(OutBodyOrdinal != InvalidSketchOrdinal, "Constructed persistent PrismaticBody from SketchProfile") ||
        !VerifyCondition(OutDocument.Bodies.size() == 1u, "Retained one persistent PrismaticBody"))
    {
        return false;
    }

    const PrismaticBody& Body = OutDocument.Bodies.front();
    OutMetrics.PrismVolumeCubicMeters   = QueryPrismaticVolumeCubicMeters(Body, Profile);
    OutMetrics.PrismSurfaceSquareMeters = QueryPrismaticSurfaceAreaSquareMeters(Body, Profile);
    if (!VerifyCondition(QueryNear(OutMetrics.PrismVolumeCubicMeters, 24.0), "PrismaticBody exact volume equals 24 m3") ||
        !VerifyCondition(QueryNear(OutMetrics.PrismSurfaceSquareMeters, 52.0), "PrismaticBody exact surface area equals 52 m2"))
    {
        return false;
    }

    Frontier::GeometrySpace::PolygonNetwork DerivedNetwork{};
    if (!VerifyCondition(
            ConstructBodySurfaceNetwork(OutDocument, OutBodyOrdinal, DerivedNetwork, Diagnostic),
            "Derived target PolygonNetwork from retained exact prismatic definition") ||
        !VerifyCondition(DerivedNetwork.VerifyNetworkIntegrity(), "Derived PolygonNetwork preserves Frontier half-edge integrity"))
    {
        return false;
    }

    OutMetrics.DerivedVertexCount = static_cast<uint32_t>(DerivedNetwork.Vertices.size());
    OutMetrics.DerivedFaceCount   = static_cast<uint32_t>(DerivedNetwork.Faces.size());
    return VerifyCondition(OutMetrics.DerivedVertexCount == 8u, "Single prism derivation produces 8 display vertices") &&
           VerifyCondition(OutMetrics.DerivedFaceCount == 8u, "Single prism derivation produces 8 triangulated display faces");
}

//------------------------------------------------------------------------------------------------------------------------
//                                            NATIVE .SKETCH PERSISTENCE
//------------------------------------------------------------------------------------------------------------------------

[[nodiscard]] bool ValidateSketchCodec(
    const Frontier::ParametricSketcher::ParametricSketcherDocument& SourceDocument,
    const std::filesystem::path&                                    ScratchDirectory)
{
    using namespace Frontier;

    std::error_code IoFailure;
    std::filesystem::create_directories(ScratchDirectory, IoFailure);
    if (!VerifyCondition(!IoFailure, "Created native .Sketch scratch directory"))
    {
        return false;
    }

    std::string Diagnostic;
    const std::filesystem::path SketchPath = ScratchDirectory / "PhaseOneBracket.Sketch";
    if (!VerifyCondition(
            Codecs::SketchEncoder::EncodeToFile(SketchPath, SourceDocument, Diagnostic),
            "Encoded native .Sketch container"))
    {
        std::fprintf(stderr, "  Diagnostic: %s\n", Diagnostic.c_str());
        return false;
    }

    Codecs::SpaceContainerPayload RawPayload{};
    if (!VerifyCondition(
            Codecs::SpaceContainerDecoder::DecodeFromFile(SketchPath, RawPayload, Diagnostic),
            "Decoded aligned .Sketch Two-Tier payload") ||
        !VerifyCondition(RawPayload.SuffixCategory == Codecs::SpaceSuffixCategory::Sketch, "Resolved .Sketch suffix category") ||
        !VerifyCondition(RawPayload.BinarySections.size() == 2u, "Persisted SketchProfile plus PrismaticBody binary sections"))
    {
        return false;
    }

    for (const Codecs::BinarySectionBlock& Section : RawPayload.BinarySections)
    {
        if (!VerifyCondition(
                (Section.DecodedAbsoluteByteOffset % 64u) == 0u,
                "Every .Sketch Tier 2 section retains 64-byte alignment"))
        {
            return false;
        }
    }

    ParametricSketcher::ParametricSketcherDocument RestoredDocument{};
    if (!VerifyCondition(
            Codecs::SketchDecoder::DecodeFromFile(SketchPath, RestoredDocument, Diagnostic),
            "Decoded native .Sketch document") ||
        !VerifyCondition(RestoredDocument.Profiles.size() == 1u && RestoredDocument.Bodies.size() == 1u, "Restored feature counts") ||
        !VerifyCondition(
            QueryNear(
                ParametricSketcher::QuerySketchAreaSquareMeters(RestoredDocument.Profiles.front()),
                ParametricSketcher::QuerySketchAreaSquareMeters(SourceDocument.Profiles.front())),
            "Restored exact sketch area") ||
        !VerifyCondition(
            RestoredDocument.Bodies.front().SurfaceShading.MatCapSlot == SourceDocument.Bodies.front().SurfaceShading.MatCapSlot,
            "Restored native per-body MatCap slot"))
    {
        return false;
    }

    std::vector<std::byte> ReencodedBytes;
    if (!VerifyCondition(
            Codecs::SpaceContainerEncoder::EncodeToBytes(RawPayload, ReencodedBytes, Diagnostic),
            "Re-encoded native .Sketch container for corruption guard"))
    {
        return false;
    }

    RawPayload.DomainManifest.erase(".SketchPlane");
    ParametricSketcher::ParametricSketcherDocument MissingMetadataDocument{};
    if (!VerifyCondition(
            !Codecs::SketchDecoder::ExtractDocument(RawPayload, MissingMetadataDocument, Diagnostic),
            "Refused a .Sketch payload missing mandatory SketchPlane metadata"))
    {
        return false;
    }

    ReencodedBytes[RawPayload.BinarySections.front().DecodedAbsoluteByteOffset] ^= std::byte{ 0x01 };
    Codecs::SpaceContainerPayload CorruptedPayload{};
    if (!VerifyCondition(
            !Codecs::SpaceContainerDecoder::DecodeFromBytes(ReencodedBytes, CorruptedPayload, Diagnostic),
            "Rejected single-bit .Sketch Tier 2 corruption through FNV-1a verification"))
    {
        return false;
    }
    return true;
}

//------------------------------------------------------------------------------------------------------------------------
//                                              VISUAL EXHIBIT RENDERING
//------------------------------------------------------------------------------------------------------------------------

[[nodiscard]] bool RenderPhaseOneExhibit(
    const PhaseOneMetrics& Metrics,
    const std::filesystem::path& OutputPath)
{
    constexpr uint32_t CanvasWidthPx  = 1280u;
    constexpr uint32_t CanvasHeightPx = 720u;

    ImGuiContext* GuiContext = ImGui::CreateContext();
    ImGui::SetCurrentContext(GuiContext);
    ImGuiIO& Io = ImGui::GetIO();
    Io.DisplaySize = { static_cast<float>(CanvasWidthPx), static_cast<float>(CanvasHeightPx) };
    Io.DeltaTime   = 1.0f / 60.0f;
    unsigned char* FontPixels = nullptr;
    int            FontWidth  = 0;
    int            FontHeight = 0;
    Io.Fonts->GetTexDataAsRGBA32(&FontPixels, &FontWidth, &FontHeight);

    ImGui::NewFrame();
    ImGui::SetNextWindowPos({ 0.0f, 0.0f });
    ImGui::SetNextWindowSize(Io.DisplaySize);
    ImGui::Begin(
        "ParametricSketcherPhaseOne",
        nullptr,
        ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoBackground);

    ImDrawList* Surface = ImGui::GetWindowDrawList();
    const ImU32 Background = IM_COL32(16, 19, 24, 255);
    const ImU32 PanelFill  = IM_COL32(28, 33, 42, 255);
    const ImU32 PanelLine  = IM_COL32(76, 91, 110, 255);
    const ImU32 AccentBlue = IM_COL32(103, 178, 255, 255);
    const ImU32 AccentMint = IM_COL32(128, 226, 181, 255);
    const ImU32 AccentGold = IM_COL32(241, 202, 103, 255);
    const ImU32 TextBright = IM_COL32(232, 239, 246, 255);
    const ImU32 TextMuted  = IM_COL32(157, 171, 188, 255);

    Surface->AddRectFilled({ 0.0f, 0.0f }, Io.DisplaySize, Background);
    Surface->AddRectFilled({ 24.0f, 20.0f }, { 1256.0f, 78.0f }, PanelFill, 4.0f);
    Surface->AddRect({ 24.0f, 20.0f }, { 1256.0f, 78.0f }, PanelLine, 4.0f);
    Surface->AddText({ 44.0f, 39.0f }, AccentMint, "PARAMETRIC SKETCHER  |  PHASE 1 GEOMETRY VERIFIED");
    Surface->AddText({ 958.0f, 39.0f }, AccentGold, "NATIVE .SKETCH");

    Surface->AddRectFilled({ 24.0f, 96.0f }, { 714.0f, 684.0f }, PanelFill, 4.0f);
    Surface->AddRect({ 24.0f, 96.0f }, { 714.0f, 684.0f }, PanelLine, 4.0f);
    Surface->AddText({ 46.0f, 116.0f }, AccentBlue, "SKETCH PROFILE  >  PRISMATIC BODY  >  DERIVED POLYGONNETWORK");

    const ImVec2 ProfileCorners[4] = {
        { 138.0f, 454.0f }, { 356.0f, 454.0f }, { 356.0f, 308.0f }, { 138.0f, 308.0f },
    };
    Surface->AddConvexPolyFilled(ProfileCorners, 4, IM_COL32(55, 128, 208, 80));
    Surface->AddPolyline(ProfileCorners, 4, AccentBlue, ImDrawFlags_Closed, 3.0f);
    Surface->AddText({ 138.0f, 474.0f }, TextMuted, "2D driving rectangle  |  3.0 m x 2.0 m");

    const ImVec2 PrismBack[4] = {
        { 432.0f, 334.0f }, { 606.0f, 278.0f }, { 606.0f, 430.0f }, { 432.0f, 486.0f },
    };
    const ImVec2 PrismFront[4] = {
        { 340.0f, 414.0f }, { 514.0f, 358.0f }, { 514.0f, 510.0f }, { 340.0f, 566.0f },
    };
    Surface->AddConvexPolyFilled(PrismBack, 4, IM_COL32(94, 156, 235, 110));
    Surface->AddConvexPolyFilled(PrismFront, 4, IM_COL32(105, 188, 255, 155));
    for (int CornerIndex = 0; CornerIndex < 4; ++CornerIndex)
    {
        const int NextIndex = (CornerIndex + 1) % 4;
        Surface->AddLine(PrismBack[CornerIndex], PrismBack[NextIndex], AccentBlue, 2.0f);
        Surface->AddLine(PrismFront[CornerIndex], PrismFront[NextIndex], AccentMint, 2.0f);
        Surface->AddLine(PrismBack[CornerIndex], PrismFront[CornerIndex], AccentGold, 2.0f);
    }
    Surface->AddText({ 394.0f, 588.0f }, TextMuted, "Exact profile retained");

    Surface->AddRectFilled({ 740.0f, 96.0f }, { 1256.0f, 684.0f }, PanelFill, 4.0f);
    Surface->AddRect({ 740.0f, 96.0f }, { 1256.0f, 684.0f }, PanelLine, 4.0f);
    Surface->AddText({ 764.0f, 116.0f }, AccentBlue, "MEASUREMENTS + NATIVE CONTAINER");

    char Reading[144] {};
    std::snprintf(Reading, sizeof(Reading), "Profile Area     %.2f m2", Metrics.SketchAreaSquareMeters);
    Surface->AddText({ 766.0f, 172.0f }, TextBright, Reading);
    std::snprintf(Reading, sizeof(Reading), "Prism Volume     %.2f m3", Metrics.PrismVolumeCubicMeters);
    Surface->AddText({ 766.0f, 212.0f }, AccentMint, Reading);
    std::snprintf(Reading, sizeof(Reading), "Surface Area     %.2f m2", Metrics.PrismSurfaceSquareMeters);
    Surface->AddText({ 766.0f, 252.0f }, TextBright, Reading);
    std::snprintf(Reading, sizeof(Reading), "Derived Network  %u vertices  |  %u faces", Metrics.DerivedVertexCount, Metrics.DerivedFaceCount);
    Surface->AddText({ 766.0f, 292.0f }, TextBright, Reading);

    Surface->AddRectFilled({ 766.0f, 338.0f }, { 1228.0f, 612.0f }, IM_COL32(18, 23, 30, 255), 3.0f);
    Surface->AddRect({ 766.0f, 338.0f }, { 1228.0f, 612.0f }, AccentMint, 3.0f);
    Surface->AddText({ 786.0f, 362.0f }, AccentMint, ".Sketch  |  Two-Tier Hybrid Container");
    Surface->AddText({ 786.0f, 402.0f }, TextMuted, "Tier 1  .SketchPlane");
    Surface->AddText({ 786.0f, 434.0f }, TextMuted, "Tier 2  .SketchProfile  64 B aligned");
    Surface->AddText({ 786.0f, 466.0f }, TextMuted, "Tier 2  .PrismaticBody  64 B aligned");
    Surface->AddText({ 786.0f, 514.0f }, AccentGold, "FNV-1a corruption guard: verified");
    Surface->AddText({ 786.0f, 554.0f }, AccentMint, "MatCap assignment: retained");

    ImGui::End();
    ImGui::Render();

    std::error_code IoFailure;
    std::filesystem::create_directories(OutputPath.parent_path(), IoFailure);
    Frontier::Exhibits::SoftwareRasterCanvas Canvas(CanvasWidthPx, CanvasHeightPx, { 16u, 19u, 24u, 255u });
    Canvas.RasterizeImGuiBatches(ImGui::GetDrawData());
    const bool ImageWritten = !IoFailure && Canvas.EncodePngToFile(OutputPath);
    ImGui::DestroyContext(GuiContext);
    return ImageWritten;
}

} // namespace

int main()
{
    Frontier::ParametricSketcher::ParametricSketcherDocument Document{};
    PhaseOneMetrics Metrics{};
    uint32_t BodyOrdinal = Frontier::ParametricSketcher::InvalidSketchOrdinal;

    const std::filesystem::path ScratchDirectory =
        std::filesystem::temp_directory_path() / "FrontierParametricSketcherValidation";
    const std::filesystem::path ExhibitPath =
        std::filesystem::path(FRONTIER_REPO_ROOT_DIR) / "Exhibits/Images/ParametricSketcher/PhaseOneSketchPrism.png";

    std::error_code IoFailure;
    std::filesystem::remove_all(ScratchDirectory, IoFailure);
    const bool GeometryValid = ValidatePlanarProfilePrism(Document, BodyOrdinal, Metrics);
    const bool CodecValid    = GeometryValid && ValidateSketchCodec(Document, ScratchDirectory);
    const bool ExhibitValid  = GeometryValid && RenderPhaseOneExhibit(Metrics, ExhibitPath);
    std::filesystem::remove_all(ScratchDirectory, IoFailure);

    if (!GeometryValid || !CodecValid || !ExhibitValid)
    {
        return 1;
    }

    std::printf(
        "[ParametricSketcherGeometryValidation] PASS: body=%u, volume=%.2f m3, surface=%.2f m2, exhibit=%s\n",
        BodyOrdinal,
        Metrics.PrismVolumeCubicMeters,
        Metrics.PrismSurfaceSquareMeters,
        ExhibitPath.string().c_str());
    return 0;
}
