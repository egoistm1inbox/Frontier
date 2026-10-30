#!/usr/bin/env bash
# 🧩 Compile photometric/volumetric SPIR-V shaders, run CTests, and execute GPU photometric cluster validation.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

export PATH="$ROOT/_ClaudeScratch/pytools/bin:$PATH"
export PYTHONPATH="$ROOT/_ClaudeScratch/pytools${PYTHONPATH:+:$PYTHONPATH}"

TOOLS="$ROOT/ExternalPackages/VulkanCompute"
CMAKE="${CMAKE:-cmake}"
CTEST="${CTEST:-ctest}"
SLANG="${SLANGC:-$TOOLS/Slang/slangtorch/bin/slangc}"
DRIVER="${VULKAN_LIBRARY:-$TOOLS/SwiftShader/libvk_swiftshader.so}"
export LD_LIBRARY_PATH="$TOOLS/SwiftShader${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

MODE=release
OPTIONS=(-G Ninja -DCMAKE_BUILD_TYPE=Release)
BUILD_DEFAULT="$ROOT/_ClaudeScratch/build/unified-release"
if [[ "${SANITIZE:-0}" == 1 ]]; then
    MODE=host-sanitized
    OPTIONS=(-G Ninja -DCMAKE_BUILD_TYPE=Debug
             '-DCMAKE_CXX_FLAGS=-fsanitize=address,undefined -fno-omit-frame-pointer'
             '-DCMAKE_EXE_LINKER_FLAGS=-fsanitize=address,undefined'
             '-DCMAKE_CXX_FLAGS_DEBUG=-O1 -g')
    export ASAN_OPTIONS="${ASAN_OPTIONS:-detect_leaks=0}"
    export UBSAN_OPTIONS="${UBSAN_OPTIONS:-halt_on_error=1}"
    BUILD_DEFAULT="$ROOT/_ClaudeScratch/build/production-restir-sanitized"
fi

BUILD="${BUILD:-$BUILD_DEFAULT}"
SHADER_BUILD="${SHADER_BUILD:-$ROOT/_ClaudeScratch/build/photometric-shaders}"
MED_OUT="$SHADER_BUILD/medium-shaders"
REP_OUT="$SHADER_BUILD/replay-shaders"
OUTPUT="${OUTPUT:-$ROOT/_ClaudeScratch/photometric-cluster-capture-$MODE}"
RESULTS="${RESULTS:-$ROOT/Exhibits/LightCompute/Results/PhotometricCluster-$MODE.txt}"

mkdir -p "$BUILD" "$MED_OUT" "$REP_OUT" "$OUTPUT" "$(dirname "$RESULTS")"

{
    printf 'PhotometricCluster mode=%s revision=%s external_driver_sanitized=0\n' "$MODE" "$(git rev-parse HEAD)"
    "${CXX:-c++}" --version | head -n 1
    "$SLANG" -version

    sha256sum \
        Frontier/Engine/Rendering/{CMakeLists.txt,PhotometricLights.h,PhotometricLights.cpp,AtmosphereModel.h,AtmosphereModel.cpp,CelestialModel.h,CelestialModel.cpp,CloudField.h,CloudField.cpp,FogMedium.h,FogMedium.cpp,LensFlareModel.h,SolarOpticsPayload.h,PathReplayVulkan.h,PathReplayVulkan.cpp} \
        Frontier/Engine/Rendering/Shaders/{PhotometricLuminaire.slang,LightInfluence.slang,SolarOptics.slang,PathReplayReservoir.slang} \
        Exhibits/LightCompute/{CMakeLists.txt,RunPhotometricCluster.sh} \
        Exhibits/LightCompute/Code/{PhotometricClusterValidation.cpp,PhotometricClusterGpuValidation.h,LightComputeValidation.cpp}

    rm -f "$MED_OUT"/*.spv "$REP_OUT"/*.spv
    SDIR="Frontier/Engine/Rendering/Shaders"
    "$SLANG" "$SDIR/LightInfluence.slang" -entry AssignLightCells -target spirv -profile spirv_1_3 -emit-spirv-directly -O0 -o "$MED_OUT/Cells.spv"
    "$SLANG" "$SDIR/LightInfluence.slang" -entry TracePrimarySurfaces -target spirv -profile spirv_1_3 -emit-spirv-directly -O0 -o "$MED_OUT/Primary.spv"
    "$SLANG" "$SDIR/LightInfluence.slang" -entry EvaluateLightReceivers -target spirv -profile spirv_1_3 -emit-spirv-directly -O0 -o "$MED_OUT/Receivers.spv"
    "$SLANG" "$SDIR/LightInfluence.slang" -entry BakeCloudRadiance -target spirv -profile spirv_1_3 -emit-spirv-directly -O0 -o "$MED_OUT/Clouds.spv"
    "$SLANG" "$SDIR/LightInfluence.slang" -entry IntegrateFogScattering -target spirv -profile spirv_1_3 -emit-spirv-directly -O0 -o "$MED_OUT/Fog.spv"
    "$SLANG" "$SDIR/LightInfluence.slang" -entry ResolveSolarVisibility -target spirv -profile spirv_1_3 -emit-spirv-directly -O0 -o "$MED_OUT/SolarVisibility.spv"
    "$SLANG" "$SDIR/LightInfluence.slang" -entry CompositeSolarOptics -target spirv -profile spirv_1_3 -emit-spirv-directly -O0 -o "$MED_OUT/SolarOptics.spv"

    cp "$MED_OUT/Primary.spv" "$REP_OUT/Primary.spv"
    "$SLANG" "$SDIR/PathReplayReservoir.slang" -entry GenerateReplayReservoirs -target spirv -profile spirv_1_3 -emit-spirv-directly -O0 -o "$REP_OUT/ReplayGenerate.spv"
    "$SLANG" "$SDIR/PathReplayReservoir.slang" -entry ResolveReplayReservoirs -target spirv -profile spirv_1_3 -emit-spirv-directly -O0 -o "$REP_OUT/ReplayResolve.spv"

    sha256sum "$MED_OUT"/*.spv "$REP_OUT"/*.spv

    "$CMAKE" -S Exhibits/LightCompute -B "$BUILD" "${OPTIONS[@]}"
    if [[ "${SANITIZE:-0}" == 1 ]]; then
        "$CMAKE" --build "$BUILD" --parallel "${BUILD_JOBS:-2}" --target \
            PathReplayDomainValidation \
            PathReplayVulkanValidation \
            RadiantFacetValidation \
            MediumRadianceValidation \
            ReplaySeedCorrelationValidation \
            ReplayVarianceFilterValidation \
            ReplayRayAccelerationValidation \
            ReplayPbrReflectionValidation \
            ReplaySubmissionSequenceValidation \
            ProductionReSTIRContractValidation \
            PhotometricClusterValidation \
            PathReplayArchiveValidation
    else
        "$CMAKE" --build "$BUILD" --parallel "${BUILD_JOBS:-2}"
    fi
    "$CTEST" --test-dir "$BUILD" --output-on-failure

    if [[ "${SANITIZE:-0}" != 1 ]]; then
        "$BUILD/LightComputeValidation" "$DRIVER" "$MED_OUT" --photometric-cluster "$REP_OUT" "$OUTPUT"
        sha256sum "$OUTPUT"/*.f32
    fi
} > "$RESULTS" 2>&1
cat "$RESULTS"
