/*==========================================================================================================================================
                                                            PARTICLESPACECODEC.H
==========================================================================================================================================*/
// 🧩 A ParticleSpace on disk: the `.particlespace` TOML file a Particles record keeps beside its level. It holds the clock,
//    camera, wind, lightning, probe and level-wind settings, the [[force]] records and one [[effect]] per effect, every
//    parameter spelled as the preset library spells it. Live values (particles, bolts, the time) are not stored.

#pragma once

#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleSpace.h"

#include <filesystem>
#include <string>
#include <string_view>

namespace Frontier
{

inline constexpr std::string_view ParticleSpaceExtension = ".particlespace";
inline constexpr std::string_view ParticleSpaceFormat    = "frontier.particlespace";
inline constexpr int64_t          ParticleSpaceVersion   = 1;

[[nodiscard]] std::string EncodeParticleSpace(const ParticleSpace& Space);

// 📝 Replaces Space with the decoded one; on failure leaves Space unchanged and the reason in Diagnostic.
bool DecodeParticleSpace(std::string_view Text, ParticleSpace& Space, std::string& Diagnostic);

bool WriteParticleSpace(const ParticleSpace& Space, const std::filesystem::path& File, std::string& Diagnostic);
bool ReadParticleSpace(const std::filesystem::path& File, ParticleSpace& Space, std::string& Diagnostic);

// 📝 What a Particles record's inspector shows without loading the space into an editor.
struct ParticleSpaceSummary
{
    size_t Effects        = 0;
    size_t VisibleEffects = 0;
    size_t Forces         = 0;
    size_t EnabledForces  = 0;
    double WindScale      = 1.0;
    bool   Lightning      = false;
};

bool SummarizeParticleSpace(const std::filesystem::path& File, ParticleSpaceSummary& Summary, std::string& Diagnostic);

} // namespace Frontier
