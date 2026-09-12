#!/usr/bin/env bash
#============================================================================================================================================
# 📦 Scratchpad/RenderProjectZeroShowcase.sh — Project Zero's sky, sun, moon and stars as the game renders them
#============================================================================================================================================
# Headless, like the gates — no Vulkan, no GLFW, no window. Builds ProjectZeroShowcase.cpp (the project's own
# CelestialSequence through the CPU Visibility Raster, driven in GameExecution order) and renders path-labelled
# frames from the production ProjectZeroCelestial scene. It never labels these CPU frames as ReSTIR captures.
#
# Dependency roots follow CheckCelestialSky so the showcase stays runnable in the same environment.
set -u
cd "$(dirname "$0")/.."
Cg="${CGLTF:-/tmp/cg}"; Ufbx="${UFBX:-/tmp/ufbxsrc}"; Stb="${STB:-/tmp/stbsrc}"

echo "[Showcase] Project Zero's sky through the game's own sequence"
Show="$(mktemp -u /tmp/ProjectZeroShowcase.XXXXXX)"
if ! g++ -std=c++20 -O2 -msse4.2 -I . -I Engine -I Scratchpad \
     -I "$Cg" -I "$Ufbx" -I "$Stb" -o "$Show" \
     Scratchpad/ProjectZeroShowcase.cpp \
     Projects/Project-Zero/Source/CelestialSequence.cpp \
     Engine/GeometricRaster/VisibilityRaster.cpp \
     Engine/GeometricRaster/SceneRecordPacking.cpp \
     Engine/GeometricRaster/StarCatalogueIndex.cpp \
     Engine/GeometricRaster/SceneStructure.cpp \
     Engine/GeometricRaster/GeometryStructure.cpp \
     Engine/DisplayPresentation/CelestialSolver.cpp \
     Engine/DisplayPresentation/FidelityClassifier.cpp \
     Engine/ContentInterchange/SceneCodec.cpp \
     Projects/Project-Zero/Source/RayTracingSolver.cpp \
     Engine/ContentInterchange/MaterialCodec.cpp \
     Engine/ContentInterchange/MaterialIndex.cpp \
     Engine/ContentInterchange/TextureIndex.cpp \
     Engine/DeviceExchange/OrientationClassifier.cpp \
     2>/tmp/ProjectZeroShowcase.build; then
    echo "  SHOWCASE FAILED TO BUILD"; sed 's/^/    /' /tmp/ProjectZeroShowcase.build | head -20; exit 1
fi
"$Show" || exit 1
rm -f "$Show"
