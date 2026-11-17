/*============================================================================================================================================
                                                              SKETCHCODEC.H
============================================================================================================================================*/
// 🧩 Native .Sketch Two-Tier encoder plus decoder for Parametric Sketcher planes, profiles, prismatic bodies, plus revisions

#pragma once

//------------------------------------------------------------------------------------------------------------------------
//                                                        INCLUDES
//------------------------------------------------------------------------------------------------------------------------

#include "Engine/Codecs/RevisionCodec.h"
#include "Engine/Codecs/SpaceContainerCodec.h"
#include "Engine/ParametricSketcher/ParametricSketcherDocument.h"

#include <filesystem>
#include <string>

namespace Frontier::Codecs
{

//------------------------------------------------------------------------------------------------------------------------
//                                                       STRUCTURES
//------------------------------------------------------------------------------------------------------------------------

class SketchEncoder
{
public:
    [[nodiscard]] static SpaceContainerPayload ConstructPayload(
        const ParametricSketcher::ParametricSketcherDocument& Document,
        const Workspaces::RevisionTracker* OptionalRevision = nullptr);

    [[nodiscard]] static bool EncodeToFile(
        const std::filesystem::path&                          TargetPath,
        const ParametricSketcher::ParametricSketcherDocument& Document,
        std::string&                                          OutDiagnostic,
        const Workspaces::RevisionTracker*                    OptionalRevision = nullptr);
};

class SketchDecoder
{
public:
    [[nodiscard]] static bool ExtractDocument(
        const SpaceContainerPayload&                    Payload,
        ParametricSketcher::ParametricSketcherDocument& OutDocument,
        std::string&                                    OutDiagnostic,
        Workspaces::RevisionTracker*                    OptionalOutRevision = nullptr);

    [[nodiscard]] static bool DecodeFromFile(
        const std::filesystem::path&                    SourcePath,
        ParametricSketcher::ParametricSketcherDocument& OutDocument,
        std::string&                                    OutDiagnostic,
        Workspaces::RevisionTracker*                    OptionalOutRevision = nullptr);
};

struct SketchCodec
{
    using Encoder = SketchEncoder;
    using Decoder = SketchDecoder;
};

} // namespace Frontier::Codecs
