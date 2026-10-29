#!/usr/bin/env bash
# 🧩 Build and verify FrontierPlumeFluid, 3-mode TyreContinuum, Snow/Hail WeatherEffects, Slang SPIR-V shaders, and VehicleHMI scene.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

export PATH="$ROOT/.local/bin:$PATH"
export PYTHONPATH="${PYTHONPATH:-$ROOT/.local}"

LABEL=release
CMAKE_ARGS=(-DCMAKE_BUILD_TYPE=Release)
if [[ "${SANITIZE:-0}" == 1 ]]; then
    LABEL=sanitized
    CMAKE_ARGS=(-DCMAKE_BUILD_TYPE=RelWithDebInfo -DFRONTIER_SHOWCASE_SANITIZERS=ON)
    export ASAN_OPTIONS="${ASAN_OPTIONS:-detect_leaks=0}"
    export UBSAN_OPTIONS="${UBSAN_OPTIONS:-halt_on_error=1:print_stacktrace=1}"
fi

BUILD="${BUILD:-$ROOT/build/vehiclehmi-showcase-$LABEL}"
RESULTS="${RESULTS:-$ROOT/Exhibits/VehicleHmiShowcase/Results}"
mkdir -p "$BUILD" "$RESULTS"

TOOLS="${VULKAN_TOOLS:-$ROOT/.local/VulkanCompute}"
if [[ ! -d "$TOOLS" && -d "$ROOT/ExternalPackages/VulkanCompute" ]]; then
    TOOLS="$ROOT/ExternalPackages/VulkanCompute"
fi
SLANGC="${SLANGC:-$TOOLS/Slang/slangtorch/bin/slangc}"

{
    printf 'VehicleHMI + PlumeFluid + TyreContinuum + WeatherEffects validation; %s\n' "$LABEL"
    printf 'Base %s\n' "$(git rev-parse --short HEAD)"
    uname -srm
    "${CXX:-c++}" --version | head -1

    if [[ -x "$SLANGC" ]]; then
        mkdir -p "$BUILD/spv"
        for Entry in MeasurePlumeFaceDivergence RelaxPlumePressure ProjectPlumeVelocity AdvectPlumeThermoMacCormack; do
            "$SLANGC" Frontier/Engine/Rendering/Shaders/PlumeFluidTransport.slang \
                -target spirv -profile spirv_1_3 -O0 -entry "$Entry" -stage compute -o "$BUILD/spv/${Entry}.spv"
        done
        "$SLANGC" Frontier/Engine/Rendering/Shaders/PlumeFluidMarch.slang \
            -target spirv -profile spirv_1_3 -O0 -entry MarchPlumeFluidVolume -stage compute -o "$BUILD/spv/MarchPlumeFluidVolume.spv"
        "$SLANGC" Frontier/Engine/Rendering/Shaders/PrecipitationOptics.slang \
            -target spirv -profile spirv_1_3 -O0 -entry EvaluatePrecipitationRays -stage compute -o "$BUILD/spv/EvaluatePrecipitationRays.spv"
        sha256sum "$BUILD"/spv/*.spv
    fi

    cmake -S Exhibits/VehicleHmiShowcase -B "$BUILD" "${CMAKE_ARGS[@]}" >/dev/null
    cmake --build "$BUILD" -j4 >/dev/null
    "$BUILD/VehicleHmiFluidWeatherValidation" "$@"
} | tee "$RESULTS/Validation-${LABEL}.txt"
