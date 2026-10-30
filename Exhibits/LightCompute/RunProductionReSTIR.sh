#!/usr/bin/env bash
# 🧩 Compile production SW + HW-RT ReSTIR SPIR-V shaders, run CTests, and execute Phases 1-4 Vulkan GPU verification.
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
SHADER_BUILD="${SHADER_BUILD:-$ROOT/_ClaudeScratch/build/production-shaders}"
SW_OUT="$SHADER_BUILD/sw-shaders"
HW_OUT="$SHADER_BUILD/hw-shaders"
OUTPUT="${OUTPUT:-$ROOT/_ClaudeScratch/production-restir-capture-$MODE}"
RESULTS="${RESULTS:-$ROOT/Exhibits/LightCompute/Results/ProductionReSTIR-$MODE.txt}"

mkdir -p "$BUILD" "$SW_OUT" "$HW_OUT" "$OUTPUT" "$(dirname "$RESULTS")"

{
    printf 'ProductionReSTIR mode=%s revision=%s external_driver_sanitized=0\n' "$MODE" "$(git rev-parse HEAD)"
    "${CXX:-c++}" --version | head -n 1
    "$SLANG" -version

    sha256sum \
        Frontier/Engine/Rendering/{CMakeLists.txt,SkyRadiance.h,SkyRadiance.cpp,PhotometricLights.h,PhotometricLights.cpp,PathReplayVulkan.h,PathReplayVulkan.cpp,PathReplayDomain.h,PathReplayDomain.cpp,PathReplaySubmissionSequence.cpp} \
        Frontier/Engine/Rendering/Shaders/{SkyRadiance.slang,PhotometricLuminaire.slang,LightInfluence.slang,PathReplayReservoir.slang,PathReplaySampleHistory.slang,PathReplayVarianceFilter.slang,PathReplayRayQuery.slang} \
        Exhibits/LightCompute/{CMakeLists.txt,RunProductionReSTIR.sh} \
        Exhibits/LightCompute/Code/{ProductionReSTIRContractValidation.cpp,ProductionReSTIRValidation.h,PhotometricClusterValidation.cpp,ReplayRayAccelerationValidation.cpp,LightComputeValidation.cpp} \
        "$DRIVER" "$SLANG" Automation/ReplayToolDependencies.json

    rm -f "$SW_OUT"/*.spv "$HW_OUT"/*.spv
    SDIR="Frontier/Engine/Rendering/Shaders"
    "$SLANG" "$SDIR/LightInfluence.slang" -entry TracePrimarySurfaces -target spirv -profile spirv_1_3 -emit-spirv-directly -O0 -o "$SW_OUT/Primary.spv"
    "$SLANG" "$SDIR/PathReplayReservoir.slang" -entry GenerateReplayReservoirs -target spirv -profile spirv_1_3 -emit-spirv-directly -O0 -o "$SW_OUT/ReplayGenerate.spv"
    "$SLANG" "$SDIR/PathReplayReservoir.slang" -entry ResolveReplayReservoirs -target spirv -profile spirv_1_3 -emit-spirv-directly -O0 -o "$SW_OUT/ReplayResolve.spv"
    "$SLANG" "$SDIR/PathReplayReservoir.slang" -entry ResolveHybridReplayReservoirs -target spirv -profile spirv_1_3 -emit-spirv-directly -O0 -o "$SW_OUT/ReplayResolveHybrid.spv"
    "$SLANG" "$SDIR/PathReplaySampleHistory.slang" -entry GatherReplaySampleHistory -target spirv -profile spirv_1_3 -emit-spirv-directly -O0 -o "$SW_OUT/ReplayGatherSampleHistory.spv"
    "$SLANG" "$SDIR/PathReplaySampleHistory.slang" -entry FinalizeReplaySampleHistory -target spirv -profile spirv_1_3 -emit-spirv-directly -O0 -o "$SW_OUT/ReplayFinalizeSampleHistory.spv"
    "$SLANG" "$SDIR/PathReplayVarianceFilter.slang" -entry GatherReplayVarianceHistory -target spirv -profile spirv_1_3 -emit-spirv-directly -O0 -o "$SW_OUT/ReplayGatherVarianceHistory.spv"
    "$SLANG" "$SDIR/PathReplayVarianceFilter.slang" -entry IntegrateReplayVarianceMoments -target spirv -profile spirv_1_3 -emit-spirv-directly -O0 -o "$SW_OUT/ReplayIntegrateVarianceMoments.spv"
    "$SLANG" "$SDIR/PathReplayVarianceFilter.slang" -entry FilterReplayVarianceWavelet -target spirv -profile spirv_1_3 -emit-spirv-directly -O0 -o "$SW_OUT/ReplayFilterVarianceWavelet.spv"

    "$SLANG" "$SDIR/PathReplayRayQuery.slang" -entry TracePrimarySurfaces -target spirv -profile "spirv_1_4+spvRayQueryKHR" -emit-spirv-directly -O0 -o "$HW_OUT/PrimaryHardwareRT.spv"
    "$SLANG" "$SDIR/PathReplayRayQuery.slang" -entry GenerateReplayReservoirs -target spirv -profile "spirv_1_4+spvRayQueryKHR" -emit-spirv-directly -O0 -o "$HW_OUT/ReplayGenerateHardwareRT.spv"
    "$SLANG" "$SDIR/PathReplayRayQuery.slang" -entry ResolveReplayReservoirs -target spirv -profile "spirv_1_4+spvRayQueryKHR" -emit-spirv-directly -O0 -o "$HW_OUT/ReplayResolveHardwareRT.spv"
    "$SLANG" "$SDIR/PathReplayRayQuery.slang" -entry ResolveHybridReplayReservoirs -target spirv -profile "spirv_1_4+spvRayQueryKHR" -emit-spirv-directly -O0 -o "$HW_OUT/ReplayResolveHybridHardwareRT.spv"
    "$SLANG" "$SDIR/PathReplayRayQuery.slang" -entry FinalizeReplaySampleHistory -target spirv -profile "spirv_1_4+spvRayQueryKHR" -emit-spirv-directly -O0 -o "$HW_OUT/ReplayFinalizeSampleHistoryHardwareRT.spv"

    sha256sum "$SW_OUT"/*.spv "$HW_OUT"/*.spv

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
    "$BUILD/ReplayRayAccelerationValidation" --verify-spirv "$HW_OUT"

    if [[ "${SANITIZE:-0}" != 1 ]]; then
        "$BUILD/LightComputeValidation" "$DRIVER" "$SW_OUT" --production-restir "$OUTPUT"
        sha256sum "$OUTPUT"/*.f32
    fi
} > "$RESULTS" 2>&1
cat "$RESULTS"
