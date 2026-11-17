/*==========================================================================================================================================
                                                           PARTICLEEFFECTCODEC.H
==========================================================================================================================================*/
// 🧩 The TOML spelling of an effect's parameters and of a force record: the preset library reads it, the particle space file
//    reads and writes it, so both files spell every parameter the same way.

#pragma once

#include "Frontier/Engine/PhysicalDynamics/ParticleDynamics/ParticleEffectLibrary.h"

#include <toml++/toml.hpp>

#include <string>

namespace Frontier
{

// 📝 Absent keys keep the target's values; a key with the wrong type fails with Where and the key in Diagnostic.
bool DecodeParticleEffectParameters(const toml::table& Keys, ParticleEffectParameters& Parameters, const std::string& Where, std::string& Diagnostic);
void EncodeParticleEffectParameters(const ParticleEffectParameters& Parameters, toml::table& Keys);

bool DecodeParticleField(const toml::table& Keys, ParticleField& Field, const std::string& Where, std::string& Diagnostic);
void EncodeParticleField(const ParticleField& Field, toml::table& Keys);

} // namespace Frontier
