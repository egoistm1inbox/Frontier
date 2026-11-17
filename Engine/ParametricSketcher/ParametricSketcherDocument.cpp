/*============================================================================================================================================
                                                    PARAMETRICSKETCHERDOCUMENT.CPP
============================================================================================================================================*/
// 🧩 Persistent profile plus prismatic-body document operations for native Parametric Sketcher authoring

//------------------------------------------------------------------------------------------------------------------------
//                                                        INCLUDES
//------------------------------------------------------------------------------------------------------------------------

#include "Engine/ParametricSketcher/ParametricSketcherDocument.h"

#include <algorithm>
#include <limits>
#include <utility>

namespace Frontier::ParametricSketcher
{

namespace
{

[[nodiscard]] uint32_t DeriveNextProfileOrdinal(const ParametricSketcherDocument& Document) noexcept
{
    uint32_t HighestOrdinal = InvalidSketchOrdinal;
    for (const SketchProfile& Profile : Document.Profiles)
    {
        HighestOrdinal = std::max(HighestOrdinal, Profile.ProfileOrdinal);
    }
    return HighestOrdinal == std::numeric_limits<uint32_t>::max() ? InvalidSketchOrdinal : HighestOrdinal + 1u;
}

[[nodiscard]] uint32_t DeriveNextBodyOrdinal(const ParametricSketcherDocument& Document) noexcept
{
    uint32_t HighestOrdinal = InvalidSketchOrdinal;
    for (const PrismaticBody& Body : Document.Bodies)
    {
        HighestOrdinal = std::max(HighestOrdinal, Body.BodyOrdinal);
    }
    return HighestOrdinal == std::numeric_limits<uint32_t>::max() ? InvalidSketchOrdinal : HighestOrdinal + 1u;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                PERSISTENT IDENTITY RESOLUTION
//------------------------------------------------------------------------------------------------------------------------

SketchProfile* ResolveSketchProfile(
    ParametricSketcherDocument& Document,
    uint32_t                    ProfileOrdinal) noexcept
{
    for (SketchProfile& Profile : Document.Profiles)
    {
        if (Profile.ProfileOrdinal == ProfileOrdinal)
        {
            return &Profile;
        }
    }
    return nullptr;
}

const SketchProfile* ResolveSketchProfile(
    const ParametricSketcherDocument& Document,
    uint32_t                          ProfileOrdinal) noexcept
{
    for (const SketchProfile& Profile : Document.Profiles)
    {
        if (Profile.ProfileOrdinal == ProfileOrdinal)
        {
            return &Profile;
        }
    }
    return nullptr;
}

PrismaticBody* ResolvePrismaticBody(
    ParametricSketcherDocument& Document,
    uint32_t                    BodyOrdinal) noexcept
{
    for (PrismaticBody& Body : Document.Bodies)
    {
        if (Body.BodyOrdinal == BodyOrdinal)
        {
            return &Body;
        }
    }
    return nullptr;
}

const PrismaticBody* ResolvePrismaticBody(
    const ParametricSketcherDocument& Document,
    uint32_t                          BodyOrdinal) noexcept
{
    for (const PrismaticBody& Body : Document.Bodies)
    {
        if (Body.BodyOrdinal == BodyOrdinal)
        {
            return &Body;
        }
    }
    return nullptr;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 AUTHORING CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

uint32_t AppendSketchProfile(
    ParametricSketcherDocument& Document,
    SketchProfile                Profile,
    std::string&                 OutDiagnostic)
{
    if (Profile.ProfileOrdinal == InvalidSketchOrdinal)
    {
        Profile.ProfileOrdinal = Document.NextProfileOrdinal;
    }
    if (Profile.ProfileOrdinal == InvalidSketchOrdinal || ResolveSketchProfile(Document, Profile.ProfileOrdinal) != nullptr)
    {
        OutDiagnostic = "SketchProfile ordinal must be unique plus non-zero.";
        return InvalidSketchOrdinal;
    }

    const SketchContourValidity ProfileValidity = ValidateSketchProfile(Profile, OutDiagnostic);
    if (ProfileValidity != SketchContourValidity::Valid)
    {
        return InvalidSketchOrdinal;
    }

    Document.Profiles.push_back(std::move(Profile));
    Document.NextProfileOrdinal = DeriveNextProfileOrdinal(Document);
    OutDiagnostic.clear();
    return Document.Profiles.back().ProfileOrdinal;
}

uint32_t ConstructPrismaticBody(
    ParametricSketcherDocument&          Document,
    uint32_t                             ProfileOrdinal,
    float                                ExtrusionLengthMeters,
    GeometrySpace::FaceShadingAssignment SurfaceShading,
    std::string&                         OutDiagnostic)
{
    const SketchProfile* Profile = ResolveSketchProfile(Document, ProfileOrdinal);
    if (Profile == nullptr)
    {
        OutDiagnostic = "PrismaticBody source SketchProfile ordinal could not be resolved.";
        return InvalidSketchOrdinal;
    }

    PrismaticBody Body{};
    Body.BodyOrdinal           = Document.NextBodyOrdinal;
    Body.ProfileOrdinal        = ProfileOrdinal;
    Body.ExtrusionLengthMeters = ExtrusionLengthMeters;
    Body.SurfaceShading        = SurfaceShading;
    if (!ValidatePrismaticBody(Body, *Profile, OutDiagnostic))
    {
        return InvalidSketchOrdinal;
    }

    Document.Bodies.push_back(Body);
    Document.NextBodyOrdinal = DeriveNextBodyOrdinal(Document);
    OutDiagnostic.clear();
    return Body.BodyOrdinal;
}

//------------------------------------------------------------------------------------------------------------------------
//                                               DOCUMENT INTEGRITY CHECKS
//------------------------------------------------------------------------------------------------------------------------

bool ValidateParametricSketcherDocument(
    const ParametricSketcherDocument& Document,
    std::string&                      OutDiagnostic) noexcept
{
    if (!ValidateSketchPlane(Document.ActivePlane, OutDiagnostic))
    {
        return false;
    }

    for (std::size_t ProfileIndex = 0u; ProfileIndex < Document.Profiles.size(); ++ProfileIndex)
    {
        const SketchProfile& Profile = Document.Profiles[ProfileIndex];
        if (Profile.ProfileOrdinal == InvalidSketchOrdinal)
        {
            OutDiagnostic = "ParametricSketcherDocument contains a zero SketchProfile ordinal.";
            return false;
        }
        for (std::size_t PriorIndex = 0u; PriorIndex < ProfileIndex; ++PriorIndex)
        {
            if (Document.Profiles[PriorIndex].ProfileOrdinal == Profile.ProfileOrdinal)
            {
                OutDiagnostic = "ParametricSketcherDocument contains duplicate SketchProfile ordinals.";
                return false;
            }
        }
        if (ValidateSketchProfile(Profile, OutDiagnostic) != SketchContourValidity::Valid)
        {
            return false;
        }
    }

    for (std::size_t BodyIndex = 0u; BodyIndex < Document.Bodies.size(); ++BodyIndex)
    {
        const PrismaticBody& Body = Document.Bodies[BodyIndex];
        const SketchProfile* Profile = ResolveSketchProfile(Document, Body.ProfileOrdinal);
        if (Profile == nullptr || !ValidatePrismaticBody(Body, *Profile, OutDiagnostic))
        {
            return false;
        }
        for (std::size_t PriorIndex = 0u; PriorIndex < BodyIndex; ++PriorIndex)
        {
            if (Document.Bodies[PriorIndex].BodyOrdinal == Body.BodyOrdinal)
            {
                OutDiagnostic = "ParametricSketcherDocument contains duplicate PrismaticBody ordinals.";
                return false;
            }
        }
    }

    const uint32_t ExpectedProfileOrdinal = DeriveNextProfileOrdinal(Document);
    const uint32_t ExpectedBodyOrdinal    = DeriveNextBodyOrdinal(Document);
    if ((ExpectedProfileOrdinal != InvalidSketchOrdinal && Document.NextProfileOrdinal < ExpectedProfileOrdinal) ||
        (ExpectedBodyOrdinal != InvalidSketchOrdinal && Document.NextBodyOrdinal < ExpectedBodyOrdinal))
    {
        OutDiagnostic = "ParametricSketcherDocument identity issuer moved behind a retained ordinal.";
        return false;
    }

    OutDiagnostic.clear();
    return true;
}

bool ConstructBodySurfaceNetwork(
    const ParametricSketcherDocument& Document,
    uint32_t                          BodyOrdinal,
    GeometrySpace::PolygonNetwork&    OutNetwork,
    std::string&                      OutDiagnostic)
{
    const PrismaticBody* Body = ResolvePrismaticBody(Document, BodyOrdinal);
    if (Body == nullptr)
    {
        OutDiagnostic = "PrismaticBody ordinal could not be resolved for surface construction.";
        return false;
    }
    const SketchProfile* Profile = ResolveSketchProfile(Document, Body->ProfileOrdinal);
    if (Profile == nullptr || !ValidateSketchPlane(Document.ActivePlane, OutDiagnostic) ||
        !ValidatePrismaticBody(*Body, *Profile, OutDiagnostic))
    {
        return false;
    }

    ConstructPrismaticSurfaceNetwork(Document.ActivePlane, *Profile, *Body, OutNetwork);
    if (!OutNetwork.VerifyNetworkIntegrity())
    {
        OutDiagnostic = "Derived PolygonNetwork failed Frontier half-edge integrity validation.";
        return false;
    }

    OutDiagnostic.clear();
    return true;
}

} // namespace Frontier::ParametricSketcher
