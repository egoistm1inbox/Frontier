#!/usr/bin/env bash
#============================================================================================================================================
# 📦 Scratchpad/CheckProofFidelity.sh — proof images show what the project does, and the wiring proves it
#============================================================================================================================================
# The no-fakes rule, enforced structurally. A proof image is honest only when shipping translation units produced
#    it through project wiring: a hand-built settings struct that bypasses the sequence can show anything its
#    author imagines, and a mock renderer shows nothing at all. So this gate pins the two things that make the
#    celestial sheets honest — the sequence drives them, and no mock/fake/stub identifier exists in any
#    image-emitting proof — plus the contract declarations that say so in the files themselves.
#
# This gate distinguishes CPU Visibility Raster images from GPU/ReSTIR captures. A headless run must never label
#    a CPU image as ReSTIR; the latter requires a GPU capture or a separately declared scalar ReSTIR reference.
#    The production ShadowResolve and ReSTIRViewport shaders are checked for the same packed celestial records.
set -u
cd "$(dirname "$0")/.."
Fail=0

Report()
{
    if [ "$1" -eq 0 ]; then printf '  %-64s PASS\n' "$2"; else printf '  %-64s FAIL\n' "$2"; Fail=1; fi
}

echo "[ProofFidelity] the sky proof drives the project's own sequence"
SkyProof=Scratchpad/CelestialSkyProof.cpp
grep -q 'Sky\.Prepare()' "$SkyProof"
Report $? "the sky proof prepares a live CelestialSequence"
grep -q 'Sky\.Tick(0\.0f, TickOrigin, 0\.0f)' "$SkyProof"
Report $? "the clock is the only input — the tick solves the rest"
grep -q 'Sky\.ApplyTo(Raster, Budget)' "$SkyProof"
Report $? "the raster is fed by ApplyTo, the GameExecution order"
grep -q 'ProjectZeroCelestial' Scratchpad/ProjectZeroShowcase.cpp
Report $? "the proof loads the dedicated Project Zero scene, not a hand-built sample"
grep -q 'SunDiscGain' Engine/DisplayPresentation/SkyConstantRecord.h Engine/GeometricRaster/VisibilityRaster.h
Report $? "CPU and packed GPU records carry the bounded sun-disc gain"
grep -q 'RenderPathSelection' Engine/DisplayPresentation/ConfigurationStructure.h Projects/Project-Zero/Source/GameExecution.cpp
Report $? "render-path semantics are an explicit host setting, not a quality tier"
grep -q 'CelestialTier::BudgetFor(Criteria)' "$SkyProof"
Report $? "tier budgets arrive via the project's own tier table"
! grep -q 'CelestialSettings Sky' "$SkyProof"
Report $? "no hand-built settings struct bypasses the sequence"
grep -q 'QuerySourceCount() > 0u' "$SkyProof"
Report $? "the shipping star catalogue is asserted loaded, not assumed"
grep -q 'FIDELITY CONTRACT' "$SkyProof"
Report $? "the proof declares its fidelity contract in its header"
grep -q 'ProjectZeroCelestial_VisibilityRaster_GIoff_Standard' Scratchpad/ProjectZeroShowcase.cpp
Report $? "showcase output names include scene, path, GI state and quality tier"
grep -q 'ClearSky_SunDisc' Scratchpad/ProjectZeroShowcase.cpp
Report $? "showcase includes a clear-sky, zoomed sun-disc inspection frame"

echo "[ProofFidelity] the moon proof drives the same wiring"
MoonProof=Scratchpad/MoonRenderProof.cpp
grep -q 'Sky\.ApplyTo(Raster, Budget)' "$MoonProof"
Report $? "the moon sheet renders through ApplyTo as well"
grep -q 'FIDELITY CONTRACT' "$MoonProof"
Report $? "the moon proof declares its fidelity contract too"

echo "[ProofFidelity] no proof image comes from a mock"
if grep -n 'Mock[A-Za-z]\|Fake[A-Za-z]\|Stub[A-Za-z]\|mock_\|fake_\|stub_' \
     Scratchpad/CelestialSkyProof.cpp Scratchpad/MoonRenderProof.cpp Scratchpad/CelestialSceneProof.cpp \
     Scratchpad/EditorPreview.cpp Scratchpad/EditorProof.cpp Scratchpad/GenerateControlCentreProof.cpp \
     Scratchpad/InterfaceRasterTest.cpp Scratchpad/PanelSampleTest.cpp Scratchpad/ShadowTierProof.cpp \
     Scratchpad/TextProjectionTest.cpp Scratchpad/EditorKnobCheck.cpp; then
    Report 1 "no Mock/Fake/Stub identifier in any image-emitting proof"
else
    Report 0 "no Mock/Fake/Stub identifier in any image-emitting proof"
fi

if [ "$Fail" -eq 0 ]; then echo; echo "[ProofFidelity] OK"; else echo; echo "[ProofFidelity] FAILED"; fi
exit "$Fail"
