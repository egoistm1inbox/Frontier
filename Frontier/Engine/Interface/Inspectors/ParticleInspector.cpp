/*==========================================================================================================================================
                                                           PARTICLEINSPECTOR.CPP
==========================================================================================================================================*/
// 🧩 ParticleConfiguration: the record's ParticleSpace file, its figures, and the Particle Editor that edits it.

#include "Engine/Interface/Inspectors/ParticleInspector.h"

#if FRONTIER_EDITOR && defined(FRONTIER_WITH_INTERFACE_SDK)

#include "Engine/Interface/DiagramControls.h"
#include "Engine/Interface/InspectorControls.h"
#include "Engine/Interface/ParticleEditor.h"
#include "Engine/PhysicalDynamics/ParticleDynamics/ParticleSpaceCodec.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <iterator>
#include <string>

#endif

namespace Frontier
{

#if FRONTIER_EDITOR && defined(FRONTIER_WITH_INTERFACE_SDK)

void ParticleInspector::ConstructEditor(RecordToken Token)
{
    ParticleEditor::ConstructInterface(Token, Parameters);
}

void ParticleInspector::EnumerateSwitches(std::vector<InspectorSwitchEntry>&) {}

void ParticleInspector::ConstructInspector()
{
    const InspectorPalette Palette = InspectorPalette::Resolve();
    const EditorTypefaces  Faces   = EditorTypefaces::Resolve();

    // 📝 The space's figures, read from its file again only when the file changes (the editor writes it on Close and Save).
    struct SummaryReading
    {
        std::filesystem::path           File;
        std::filesystem::file_time_type Written{};
        ParticleSpaceSummary            Summary{};
        std::string                     Failure;
        bool                            Valid = false;
    };
    static SummaryReading Reading;
    const std::filesystem::path File = ParticleEditor::ResolveSpaceFile(Parameters);
    std::error_code             Missing;
    const bool                  Exists  = !File.empty() && std::filesystem::exists(File, Missing);
    const auto                  Written = Exists ? std::filesystem::last_write_time(File, Missing) : std::filesystem::file_time_type{};
    if (Exists && (File != Reading.File || Written != Reading.Written))
    {
        Reading         = SummaryReading{};
        Reading.File    = File;
        Reading.Written = Written;
        Reading.Valid   = SummarizeParticleSpace(File, Reading.Summary, Reading.Failure);
    }

    if (Parameters.SpaceFile.empty())
    {
        InspectorControls::ConstructMutedNote(Palette, Faces,
                                              "No particle space yet. The Particle Editor creates one beside the level the first time it opens, "
                                              "starting from the library's opening space.");
        return;
    }
    if (!Exists || !Reading.Valid || Reading.File != File)
    {
        const std::string Note = !Exists ? Parameters.SpaceFile + " is not beside the level yet: the Particle Editor writes it when it opens."
                                         : Parameters.SpaceFile + ": " + Reading.Failure;
        InspectorControls::ConstructMutedNote(Palette, Faces, Note.c_str());
        return;
    }
    char Effects[32], Forces[32], Wind[32];
    std::snprintf(Effects, sizeof(Effects), "%zu / %zu", Reading.Summary.VisibleEffects, Reading.Summary.Effects);
    std::snprintf(Forces, sizeof(Forces), "%zu / %zu", Reading.Summary.EnabledForces, Reading.Summary.Forces);
    std::snprintf(Wind, sizeof(Wind), "\xC3\x97%.2g", Reading.Summary.WindScale);
    const InspectorReadoutCell Cells[] = {
        { "Effects shown", Effects },
        { "Forces on", Forces },
        { "Wind", Wind },
        { "Lightning", Reading.Summary.Lightning ? "On" : "Off" },
    };
    InspectorControls::ConstructReadoutStrip(Palette, Faces, Cells, std::size(Cells));
    const std::string Note = "ParticleSpace in " + Parameters.SpaceFile + ", beside the level. Edit its effects, force fields, wind and "
                             "lightning in the Particle Editor.";
    InspectorControls::ConstructMutedNote(Palette, Faces, Note.c_str());
}

#elif FRONTIER_EDITOR

void ParticleInspector::ConstructEditor(RecordToken) {}
void ParticleInspector::EnumerateSwitches(std::vector<InspectorSwitchEntry>&) {}
void ParticleInspector::ConstructInspector() {}

#endif

} // namespace Frontier
