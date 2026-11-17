/*============================================================================================================================================
                                                             SKETCHCODEC.CPP
============================================================================================================================================*/
// 🧩 Native .Sketch binary profile plus prismatic-body persistence through Frontier's aligned Two-Tier container format

//------------------------------------------------------------------------------------------------------------------------
//                                                        INCLUDES
//------------------------------------------------------------------------------------------------------------------------

#include "Engine/Codecs/SketchCodec.h"

#include <algorithm>
#include <bit>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <span>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace Frontier::Codecs
{

namespace
{

constexpr uint32_t SketchProfileSignature    = 0x46525053u; // 'SPRF'
constexpr uint32_t PrismaticBodySignature    = 0x53425052u; // 'RPBS'
constexpr uint32_t MaximumProfileCount       = 65536u;
constexpr uint32_t MaximumContourCornerCount = 1048576u;
constexpr uint32_t MaximumTextByteCount      = 65536u;

void AppendUint32(std::vector<std::byte>& Bytes, uint32_t Reading)
{
    Bytes.push_back(static_cast<std::byte>(Reading & 0xFFu));
    Bytes.push_back(static_cast<std::byte>((Reading >> 8u) & 0xFFu));
    Bytes.push_back(static_cast<std::byte>((Reading >> 16u) & 0xFFu));
    Bytes.push_back(static_cast<std::byte>((Reading >> 24u) & 0xFFu));
}

void AppendFloat32(std::vector<std::byte>& Bytes, float Reading)
{
    AppendUint32(Bytes, std::bit_cast<uint32_t>(Reading));
}

void AppendText(std::vector<std::byte>& Bytes, std::string_view Text)
{
    const uint32_t ByteCount = static_cast<uint32_t>(std::min<std::size_t>(Text.size(), MaximumTextByteCount));
    AppendUint32(Bytes, ByteCount);
    for (uint32_t Index = 0u; Index < ByteCount; ++Index)
    {
        Bytes.push_back(static_cast<std::byte>(static_cast<uint8_t>(Text[Index])));
    }
}

[[nodiscard]] bool ExtractUint32(
    std::span<const std::byte> Bytes,
    std::size_t&               CursorBytes,
    uint32_t&                  OutReading) noexcept
{
    if (CursorBytes > Bytes.size() || 4u > (Bytes.size() - CursorBytes))
    {
        return false;
    }

    OutReading =
        static_cast<uint32_t>(std::to_integer<uint8_t>(Bytes[CursorBytes + 0u])) |
        (static_cast<uint32_t>(std::to_integer<uint8_t>(Bytes[CursorBytes + 1u])) << 8u) |
        (static_cast<uint32_t>(std::to_integer<uint8_t>(Bytes[CursorBytes + 2u])) << 16u) |
        (static_cast<uint32_t>(std::to_integer<uint8_t>(Bytes[CursorBytes + 3u])) << 24u);
    CursorBytes += 4u;
    return true;
}

[[nodiscard]] bool ExtractFloat32(
    std::span<const std::byte> Bytes,
    std::size_t&               CursorBytes,
    float&                     OutReading) noexcept
{
    uint32_t PackedReading = 0u;
    if (!ExtractUint32(Bytes, CursorBytes, PackedReading))
    {
        return false;
    }
    OutReading = std::bit_cast<float>(PackedReading);
    return true;
}

[[nodiscard]] bool ExtractText(
    std::span<const std::byte> Bytes,
    std::size_t&               CursorBytes,
    std::string&               OutText) noexcept
{
    uint32_t ByteCount = 0u;
    if (!ExtractUint32(Bytes, CursorBytes, ByteCount) || ByteCount > MaximumTextByteCount ||
        CursorBytes > Bytes.size() || ByteCount > (Bytes.size() - CursorBytes))
    {
        return false;
    }

    OutText.assign(
        reinterpret_cast<const char*>(Bytes.data() + CursorBytes),
        static_cast<std::size_t>(ByteCount));
    CursorBytes += ByteCount;
    return true;
}

[[nodiscard]] const BinarySectionBlock* ResolveBinarySection(
    const SpaceContainerPayload& Payload,
    std::string_view             SectionIdentifier) noexcept
{
    for (const BinarySectionBlock& Section : Payload.BinarySections)
    {
        if (Section.SectionIdentifier == SectionIdentifier)
        {
            return &Section;
        }
    }
    return nullptr;
}

[[nodiscard]] uint32_t QueryBinarySectionCount(
    const SpaceContainerPayload& Payload,
    std::string_view             SectionIdentifier) noexcept
{
    uint32_t Count = 0u;
    for (const BinarySectionBlock& Section : Payload.BinarySections)
    {
        Count += Section.SectionIdentifier == SectionIdentifier ? 1u : 0u;
    }
    return Count;
}

[[nodiscard]] bool ValidateSketchPayloadBounds(
    const ParametricSketcher::ParametricSketcherDocument& Document,
    std::string&                                          OutDiagnostic) noexcept
{
    if (Document.Profiles.size() > MaximumProfileCount || Document.Bodies.size() > MaximumProfileCount)
    {
        OutDiagnostic = ".Sketch exceeds the maximum profile or prismatic-body count.";
        return false;
    }
    for (const ParametricSketcher::SketchProfile& Profile : Document.Profiles)
    {
        if (Profile.ProfileTitle.size() > MaximumTextByteCount || Profile.ClosedContour.size() > MaximumContourCornerCount)
        {
            OutDiagnostic = ".Sketch SketchProfile title or contour exceeds a codec safety limit.";
            return false;
        }
    }
    OutDiagnostic.clear();
    return true;
}

void EncodeProfiles(
    const ParametricSketcher::ParametricSketcherDocument& Document,
    BinarySectionBlock&                                   OutSection)
{
    OutSection.SectionIdentifier = "SketchProfiles";
    OutSection.SubFormatTag      = ".SketchProfile";
    AppendUint32(OutSection.PayloadBytes, SketchProfileSignature);
    AppendUint32(OutSection.PayloadBytes, static_cast<uint32_t>(Document.Profiles.size()));

    for (const ParametricSketcher::SketchProfile& Profile : Document.Profiles)
    {
        AppendUint32(OutSection.PayloadBytes, Profile.ProfileOrdinal);
        AppendText(OutSection.PayloadBytes, Profile.ProfileTitle);
        AppendUint32(OutSection.PayloadBytes, static_cast<uint32_t>(Profile.ClosedContour.size()));
        for (const Mathematics::Axis2D Corner : Profile.ClosedContour)
        {
            AppendFloat32(OutSection.PayloadBytes, Corner.X);
            AppendFloat32(OutSection.PayloadBytes, Corner.Y);
        }
    }
    OutSection.Checksum64 = SpaceContainerEncoder::ComputeFnv1aChecksum64(OutSection.PayloadBytes);
}

void EncodeBodies(
    const ParametricSketcher::ParametricSketcherDocument& Document,
    BinarySectionBlock&                                   OutSection)
{
    OutSection.SectionIdentifier = "PrismaticBodies";
    OutSection.SubFormatTag      = ".PrismaticBody";
    AppendUint32(OutSection.PayloadBytes, PrismaticBodySignature);
    AppendUint32(OutSection.PayloadBytes, static_cast<uint32_t>(Document.Bodies.size()));

    for (const ParametricSketcher::PrismaticBody& Body : Document.Bodies)
    {
        AppendUint32(OutSection.PayloadBytes, Body.BodyOrdinal);
        AppendUint32(OutSection.PayloadBytes, Body.ProfileOrdinal);
        AppendFloat32(OutSection.PayloadBytes, Body.ExtrusionLengthMeters);
        AppendFloat32(OutSection.PayloadBytes, Body.SurfaceShading.AlbedoLinearRGB.X);
        AppendFloat32(OutSection.PayloadBytes, Body.SurfaceShading.AlbedoLinearRGB.Y);
        AppendFloat32(OutSection.PayloadBytes, Body.SurfaceShading.AlbedoLinearRGB.Z);
        AppendFloat32(OutSection.PayloadBytes, Body.SurfaceShading.MatCapTintLinearRGB.X);
        AppendFloat32(OutSection.PayloadBytes, Body.SurfaceShading.MatCapTintLinearRGB.Y);
        AppendFloat32(OutSection.PayloadBytes, Body.SurfaceShading.MatCapTintLinearRGB.Z);
        AppendFloat32(OutSection.PayloadBytes, Body.SurfaceShading.Metallic);
        AppendFloat32(OutSection.PayloadBytes, Body.SurfaceShading.Roughness);
        AppendFloat32(OutSection.PayloadBytes, Body.SurfaceShading.Specular);
        AppendFloat32(OutSection.PayloadBytes, Body.SurfaceShading.MatCapBlend);
        OutSection.PayloadBytes.push_back(static_cast<std::byte>(Body.SurfaceShading.MatCapSlot));
    }
    OutSection.Checksum64 = SpaceContainerEncoder::ComputeFnv1aChecksum64(OutSection.PayloadBytes);
}

[[nodiscard]] bool DecodeProfiles(
    std::span<const std::byte>                         Bytes,
    ParametricSketcher::ParametricSketcherDocument& OutDocument,
    std::string&                                       OutDiagnostic)
{
    std::size_t CursorBytes = 0u;
    uint32_t Signature = 0u;
    uint32_t ProfileCount = 0u;
    if (!ExtractUint32(Bytes, CursorBytes, Signature) || Signature != SketchProfileSignature ||
        !ExtractUint32(Bytes, CursorBytes, ProfileCount) || ProfileCount > MaximumProfileCount)
    {
        OutDiagnostic = "Malformed .SketchProfile binary section header.";
        return false;
    }

    OutDocument.Profiles.reserve(ProfileCount);
    for (uint32_t ProfileIndex = 0u; ProfileIndex < ProfileCount; ++ProfileIndex)
    {
        ParametricSketcher::SketchProfile Profile{};
        uint32_t CornerCount = 0u;
        if (!ExtractUint32(Bytes, CursorBytes, Profile.ProfileOrdinal) || !ExtractText(Bytes, CursorBytes, Profile.ProfileTitle) ||
            !ExtractUint32(Bytes, CursorBytes, CornerCount) || CornerCount > MaximumContourCornerCount ||
            CursorBytes > Bytes.size() || static_cast<std::size_t>(CornerCount) > (Bytes.size() - CursorBytes) / (2u * sizeof(float)))
        {
            OutDiagnostic = "Truncated .SketchProfile binary section.";
            return false;
        }

        Profile.ClosedContour.resize(CornerCount);
        for (Mathematics::Axis2D& Corner : Profile.ClosedContour)
        {
            if (!ExtractFloat32(Bytes, CursorBytes, Corner.X) || !ExtractFloat32(Bytes, CursorBytes, Corner.Y))
            {
                OutDiagnostic = "Truncated SketchProfile contour coordinates.";
                return false;
            }
        }
        OutDocument.Profiles.push_back(std::move(Profile));
    }

    if (CursorBytes != Bytes.size())
    {
        OutDiagnostic = "Unexpected trailing bytes in .SketchProfile binary section.";
        return false;
    }
    return true;
}

[[nodiscard]] bool DecodeBodies(
    std::span<const std::byte>                         Bytes,
    ParametricSketcher::ParametricSketcherDocument& OutDocument,
    std::string&                                       OutDiagnostic)
{
    std::size_t CursorBytes = 0u;
    uint32_t Signature = 0u;
    uint32_t BodyCount = 0u;
    if (!ExtractUint32(Bytes, CursorBytes, Signature) || Signature != PrismaticBodySignature ||
        !ExtractUint32(Bytes, CursorBytes, BodyCount) || BodyCount > MaximumProfileCount)
    {
        OutDiagnostic = "Malformed .PrismaticBody binary section header.";
        return false;
    }

    OutDocument.Bodies.reserve(BodyCount);
    for (uint32_t BodyIndex = 0u; BodyIndex < BodyCount; ++BodyIndex)
    {
        ParametricSketcher::PrismaticBody Body{};
        if (!ExtractUint32(Bytes, CursorBytes, Body.BodyOrdinal) ||
            !ExtractUint32(Bytes, CursorBytes, Body.ProfileOrdinal) ||
            !ExtractFloat32(Bytes, CursorBytes, Body.ExtrusionLengthMeters) ||
            !ExtractFloat32(Bytes, CursorBytes, Body.SurfaceShading.AlbedoLinearRGB.X) ||
            !ExtractFloat32(Bytes, CursorBytes, Body.SurfaceShading.AlbedoLinearRGB.Y) ||
            !ExtractFloat32(Bytes, CursorBytes, Body.SurfaceShading.AlbedoLinearRGB.Z) ||
            !ExtractFloat32(Bytes, CursorBytes, Body.SurfaceShading.MatCapTintLinearRGB.X) ||
            !ExtractFloat32(Bytes, CursorBytes, Body.SurfaceShading.MatCapTintLinearRGB.Y) ||
            !ExtractFloat32(Bytes, CursorBytes, Body.SurfaceShading.MatCapTintLinearRGB.Z) ||
            !ExtractFloat32(Bytes, CursorBytes, Body.SurfaceShading.Metallic) ||
            !ExtractFloat32(Bytes, CursorBytes, Body.SurfaceShading.Roughness) ||
            !ExtractFloat32(Bytes, CursorBytes, Body.SurfaceShading.Specular) ||
            !ExtractFloat32(Bytes, CursorBytes, Body.SurfaceShading.MatCapBlend) ||
            CursorBytes >= Bytes.size())
        {
            OutDiagnostic = "Truncated .PrismaticBody binary section.";
            return false;
        }

        Body.SurfaceShading.MatCapSlot = std::to_integer<uint8_t>(Bytes[CursorBytes]);
        ++CursorBytes;
        OutDocument.Bodies.push_back(Body);
    }

    if (CursorBytes != Bytes.size())
    {
        OutDiagnostic = "Unexpected trailing bytes in .PrismaticBody binary section.";
        return false;
    }
    return true;
}

[[nodiscard]] bool ExtractFiniteFloat(
    const toml::table& Specification,
    std::string_view   FieldIdentifier,
    float&              OutReading) noexcept
{
    const auto Reading = Specification[FieldIdentifier].value<double>();
    if (!Reading.has_value() || !std::isfinite(*Reading) ||
        *Reading < static_cast<double>(std::numeric_limits<float>::lowest()) ||
        *Reading > static_cast<double>(std::numeric_limits<float>::max()))
    {
        return false;
    }
    OutReading = static_cast<float>(*Reading);
    return std::isfinite(OutReading);
}

[[nodiscard]] bool ExtractOrdinal(
    const toml::table& Specification,
    std::string_view   FieldIdentifier,
    uint32_t&          OutOrdinal) noexcept
{
    const int64_t RawOrdinal = Specification[FieldIdentifier].value_or(int64_t{ 0 });
    if (RawOrdinal <= 0 || RawOrdinal > static_cast<int64_t>(std::numeric_limits<uint32_t>::max()))
    {
        return false;
    }
    OutOrdinal = static_cast<uint32_t>(RawOrdinal);
    return true;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                 SKETCH ENCODER OPERATIONS
//------------------------------------------------------------------------------------------------------------------------

SpaceContainerPayload SketchEncoder::ConstructPayload(
    const ParametricSketcher::ParametricSketcherDocument& Document,
    const Workspaces::RevisionTracker*                    OptionalRevision)
{
    SpaceContainerPayload Payload{};
    Payload.SuffixCategory      = SpaceSuffixCategory::Sketch;
    Payload.SchemaVersion       = 1u;
    Payload.DocumentTitle       = Document.DocumentTitle;
    Payload.AuthoringWorkspace  = "Frontier.ParametricSketcher";

    toml::table PlaneSpecification;
    PlaneSpecification.insert_or_assign("OriginX", static_cast<double>(Document.ActivePlane.Origin.X));
    PlaneSpecification.insert_or_assign("OriginY", static_cast<double>(Document.ActivePlane.Origin.Y));
    PlaneSpecification.insert_or_assign("OriginZ", static_cast<double>(Document.ActivePlane.Origin.Z));
    PlaneSpecification.insert_or_assign("RightX", static_cast<double>(Document.ActivePlane.RightAxis.X));
    PlaneSpecification.insert_or_assign("RightY", static_cast<double>(Document.ActivePlane.RightAxis.Y));
    PlaneSpecification.insert_or_assign("RightZ", static_cast<double>(Document.ActivePlane.RightAxis.Z));
    PlaneSpecification.insert_or_assign("UpX", static_cast<double>(Document.ActivePlane.UpAxis.X));
    PlaneSpecification.insert_or_assign("UpY", static_cast<double>(Document.ActivePlane.UpAxis.Y));
    PlaneSpecification.insert_or_assign("UpZ", static_cast<double>(Document.ActivePlane.UpAxis.Z));
    PlaneSpecification.insert_or_assign("ProfileCount", static_cast<int64_t>(Document.Profiles.size()));
    PlaneSpecification.insert_or_assign("BodyCount", static_cast<int64_t>(Document.Bodies.size()));
    PlaneSpecification.insert_or_assign("NextProfileOrdinal", static_cast<int64_t>(Document.NextProfileOrdinal));
    PlaneSpecification.insert_or_assign("NextBodyOrdinal", static_cast<int64_t>(Document.NextBodyOrdinal));
    Payload.DomainManifest.insert_or_assign(".SketchPlane", std::move(PlaneSpecification));

    BinarySectionBlock ProfileSection{};
    EncodeProfiles(Document, ProfileSection);
    Payload.BinarySections.push_back(std::move(ProfileSection));

    BinarySectionBlock BodySection{};
    EncodeBodies(Document, BodySection);
    Payload.BinarySections.push_back(std::move(BodySection));

    if (OptionalRevision != nullptr)
    {
        RevisionEncoder::AttachRevisionSections(*OptionalRevision, Payload);
    }
    return Payload;
}

bool SketchEncoder::EncodeToFile(
    const std::filesystem::path&                          TargetPath,
    const ParametricSketcher::ParametricSketcherDocument& Document,
    std::string&                                          OutDiagnostic,
    const Workspaces::RevisionTracker*                    OptionalRevision)
{
    if (!ParametricSketcher::ValidateParametricSketcherDocument(Document, OutDiagnostic) ||
        !ValidateSketchPayloadBounds(Document, OutDiagnostic))
    {
        return false;
    }
    return SpaceContainerEncoder::EncodeToFile(TargetPath, ConstructPayload(Document, OptionalRevision), OutDiagnostic);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 SKETCH DECODER OPERATIONS
//------------------------------------------------------------------------------------------------------------------------

bool SketchDecoder::ExtractDocument(
    const SpaceContainerPayload&                    Payload,
    ParametricSketcher::ParametricSketcherDocument& OutDocument,
    std::string&                                    OutDiagnostic,
    Workspaces::RevisionTracker*                    OptionalOutRevision)
{
    if (Payload.SuffixCategory != SpaceSuffixCategory::Sketch)
    {
        OutDiagnostic = "Expected .Sketch container category.";
        return false;
    }
    if (Payload.SchemaVersion != 1u)
    {
        OutDiagnostic = "Unsupported .Sketch container schema version.";
        return false;
    }

    const toml::table* PlaneSpecification = Payload.DomainManifest[".SketchPlane"].as_table();
    const BinarySectionBlock* ProfileSection = ResolveBinarySection(Payload, "SketchProfiles");
    const BinarySectionBlock* BodySection = ResolveBinarySection(Payload, "PrismaticBodies");
    if (PlaneSpecification == nullptr || ProfileSection == nullptr || BodySection == nullptr ||
        QueryBinarySectionCount(Payload, "SketchProfiles") != 1u ||
        QueryBinarySectionCount(Payload, "PrismaticBodies") != 1u)
    {
        OutDiagnostic = ".Sketch container is missing or duplicates .SketchPlane required Tier 2 sections.";
        return false;
    }
    if (ProfileSection->SubFormatTag != ".SketchProfile" || BodySection->SubFormatTag != ".PrismaticBody")
    {
        OutDiagnostic = ".Sketch Tier 2 section identifiers do not match their expected sub-format tags.";
        return false;
    }

    ParametricSketcher::ParametricSketcherDocument DecodedDocument{};
    DecodedDocument.DocumentTitle = Payload.DocumentTitle;
    if (!ExtractFiniteFloat(*PlaneSpecification, "OriginX", DecodedDocument.ActivePlane.Origin.X) ||
        !ExtractFiniteFloat(*PlaneSpecification, "OriginY", DecodedDocument.ActivePlane.Origin.Y) ||
        !ExtractFiniteFloat(*PlaneSpecification, "OriginZ", DecodedDocument.ActivePlane.Origin.Z) ||
        !ExtractFiniteFloat(*PlaneSpecification, "RightX", DecodedDocument.ActivePlane.RightAxis.X) ||
        !ExtractFiniteFloat(*PlaneSpecification, "RightY", DecodedDocument.ActivePlane.RightAxis.Y) ||
        !ExtractFiniteFloat(*PlaneSpecification, "RightZ", DecodedDocument.ActivePlane.RightAxis.Z) ||
        !ExtractFiniteFloat(*PlaneSpecification, "UpX", DecodedDocument.ActivePlane.UpAxis.X) ||
        !ExtractFiniteFloat(*PlaneSpecification, "UpY", DecodedDocument.ActivePlane.UpAxis.Y) ||
        !ExtractFiniteFloat(*PlaneSpecification, "UpZ", DecodedDocument.ActivePlane.UpAxis.Z))
    {
        OutDiagnostic = ".Sketch plane specification requires finite plane coordinates plus basis axes.";
        return false;
    }
    if (!ExtractOrdinal(*PlaneSpecification, "NextProfileOrdinal", DecodedDocument.NextProfileOrdinal) ||
        !ExtractOrdinal(*PlaneSpecification, "NextBodyOrdinal", DecodedDocument.NextBodyOrdinal))
    {
        OutDiagnostic = ".Sketch plane specification has invalid persistent identity issuers.";
        return false;
    }

    const int64_t ManifestProfileCount = (*PlaneSpecification)["ProfileCount"].value_or(int64_t{ -1 });
    const int64_t ManifestBodyCount    = (*PlaneSpecification)["BodyCount"].value_or(int64_t{ -1 });
    if (ManifestProfileCount < 0 || ManifestBodyCount < 0 ||
        ManifestProfileCount > static_cast<int64_t>(MaximumProfileCount) ||
        ManifestBodyCount > static_cast<int64_t>(MaximumProfileCount))
    {
        OutDiagnostic = ".Sketch plane specification has invalid binary section counts.";
        return false;
    }

    if (!DecodeProfiles(ProfileSection->PayloadBytes, DecodedDocument, OutDiagnostic) ||
        !DecodeBodies(BodySection->PayloadBytes, DecodedDocument, OutDiagnostic))
    {
        return false;
    }
    if (static_cast<int64_t>(DecodedDocument.Profiles.size()) != ManifestProfileCount ||
        static_cast<int64_t>(DecodedDocument.Bodies.size()) != ManifestBodyCount)
    {
        OutDiagnostic = ".Sketch Tier 1 counts disagree with decoded Tier 2 section counts.";
        return false;
    }
    if (!ParametricSketcher::ValidateParametricSketcherDocument(DecodedDocument, OutDiagnostic))
    {
        return false;
    }

    if (OptionalOutRevision != nullptr && !RevisionDecoder::ExtractRevisionSections(Payload, *OptionalOutRevision, OutDiagnostic))
    {
        return false;
    }

    OutDocument = std::move(DecodedDocument);
    OutDiagnostic.clear();
    return true;
}

bool SketchDecoder::DecodeFromFile(
    const std::filesystem::path&                    SourcePath,
    ParametricSketcher::ParametricSketcherDocument& OutDocument,
    std::string&                                    OutDiagnostic,
    Workspaces::RevisionTracker*                    OptionalOutRevision)
{
    SpaceContainerPayload Payload{};
    if (!SpaceContainerDecoder::DecodeFromFile(SourcePath, Payload, OutDiagnostic))
    {
        return false;
    }
    return ExtractDocument(Payload, OutDocument, OutDiagnostic, OptionalOutRevision);
}

} // namespace Frontier::Codecs
