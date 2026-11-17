/*==========================================================================================================================================
                                                         PARTICLEEDITOR.H
==========================================================================================================================================*/
// 🧩 The Particle editor window opened from a Particles record's inspector: the approved prototype's editor in C++ (Outliner,
//    viewport on the GPU particle engine, Log Stream, Inspector, preset library) on the record's ParticleSpace, which it reads
//    from and writes to the record's .particlespace file beside the level.

#pragma once

#include "Engine/Diagnostics/BuildConfiguration.h"
#include "Engine/Scene/EngineConfigurations.h"
#include "Engine/Scene/RecordToken.h"

#include <filesystem>
#include <string>

namespace Frontier
{

#if FRONTIER_EDITOR

class ParticleEditorWorkspace;

class ParticleEditor
{
  public:
    // 📝 Opens the record's space (naming its file on first use: SpaceFile changes, so the level saves it) and lays the window.
    static void ConstructInterface(RecordToken Token, ParticleConfiguration& Parameters);

    // 📝 Writes the open space to its file if it changed (the level's save and the window's Close both call it).
    static bool SaveSpace();

    // 📝 The space file of a record: SpaceFile beside the level file; empty without a level or a file name.
    [[nodiscard]] static std::filesystem::path ResolveSpaceFile(const ParticleConfiguration& Parameters);
    // 📝 The file name a record's space takes on first use: "<level>.<record>.particlespace", letters, digits, '-' and '_'.
    [[nodiscard]] static std::string NameSpaceFile(const std::filesystem::path& LevelFile, const std::string& RecordName);

    // 📝 The editor behind the window (created when it first opens); captures drive it through its verbs.
    [[nodiscard]] static ParticleEditorWorkspace* AccessWorkspace();
};

#endif // FRONTIER_EDITOR

} // namespace Frontier
