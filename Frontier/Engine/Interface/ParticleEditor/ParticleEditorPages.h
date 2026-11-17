/*==========================================================================================================================================
                                                          PARTICLEEDITORPAGES.H
==========================================================================================================================================*/
// 🧩 The Particle editor's inspector pages: Force Field (master), Wind (guest), one force field, Lightning and one effect, built
//    from the shared inspector controls as the approved prototype lays them out.

#pragma once

#include "Engine/Diagnostics/BuildConfiguration.h"

#if FRONTIER_EDITOR && defined(FRONTIER_WITH_INTERFACE_SDK)

#include "Engine/Interface/ParticleEditor/ParticleFieldOverlay.h"
#include "Engine/Interface/ParticleEditor/ParticleViewportPresentation.h"

#include <string>
#include <vector>

namespace Frontier
{

class ControlColumn;

// 📝 What a page reads and edits; Requests carries the workspace verbs a page cannot carry out itself ("duplicate:<token>",
//    "remove:<token>", "rebuild:<token>", "reset", "strike", "library", "select:<token>", "add-force:<category>").
struct ParticleEditorContext
{
    ParticleSpace&               Space;
    const ParticleEffectLibrary& Library;
    ParticleOverlaySettings&     Overlay;
    const ParticleViewportImage& Image;
    const ParticleRefreshPlan*   Plan = nullptr;
    std::vector<std::string>&    Requests;
    bool                         LevelFieldAvailable = false;   // the host can provide the level's native ForceField
};

namespace ParticleEditorPages
{
void ConstructFieldPage(ControlColumn& Page, ParticleEditorContext& Context);
void ConstructWindPage(ControlColumn& Page, ParticleEditorContext& Context);
void ConstructForcePage(ControlColumn& Page, ParticleEditorContext& Context, size_t Index);
void ConstructLightningPage(ControlColumn& Page, ParticleEditorContext& Context);
void ConstructEffectPage(ControlColumn& Page, ParticleEditorContext& Context, ParticleEffectInstance& Effect);

// 📝 The census line the outliner and the effect page share ("Streak · 168 alive").
[[nodiscard]] const ParticleEffectCensus* ResolveCensus(const ParticleViewportImage& Image, const std::string& Token) noexcept;
} // namespace ParticleEditorPages

} // namespace Frontier

#endif
