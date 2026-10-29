#!/usr/bin/env bash
#============================================================================================================================================
#                                                   RUNPROJECTDRIVEJOLTVALIDATION.SH
#============================================================================================================================================
# 🧩 End-to-end build & validation for Engine Jolt Physics (v5.6.0), VehicleRigidBodyAssembly, VehiclePhysicsThread, and Project-Drive.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

for CandidateBin in "$ROOT/.local/bin" "$ROOT/_ClaudeScratch/pytools/bin"
do
    if [ -d "$CandidateBin" ]
    then
        export PATH="$CandidateBin:$PATH"
    fi
done
for CandidatePy in "$ROOT/.local" "$ROOT/_ClaudeScratch/pytools"
do
    if [ -d "$CandidatePy" ]
    then
        export PYTHONPATH="$CandidatePy:${PYTHONPATH:-}"
    fi
done

if [ ! -f "$ROOT/ExternalPackages/jolt/lib/Release/libJolt.a" ]
then
    bash "$ROOT/Automation/BuildJolt.sh" release
fi

TOML_ROOT="$ROOT/ExternalPackages/tomlplusplus"
if [ ! -f "$TOML_ROOT/include/toml++/toml.h" ]
then
    mkdir -p "$TOML_ROOT"
    curl -fsSL "https://codeload.github.com/marzer/tomlplusplus/tar.gz/refs/tags/v3.4.0" -o "$TOML_ROOT/tomlplusplus.tar.gz"
    tar -xzf "$TOML_ROOT/tomlplusplus.tar.gz" --strip-components=1 -C "$TOML_ROOT"
    rm -f "$TOML_ROOT/tomlplusplus.tar.gz"
fi

VARIANT="release"
SANITIZER_FLAG="OFF"
if [[ "${SANITIZE:-0}" == "1" ]]
then
    VARIANT="sanitized"
    SANITIZER_FLAG="ON"
fi

BUILD_DIR="$ROOT/build/projectdrive-jolt-$VARIANT"
HOST_BUILD_DIR="$ROOT/build/frontier-host-$VARIANT"
RESULTS_PATH="${RESULTS:-$ROOT/Exhibits/VehiclePhysics/Results/ProjectDriveJolt-$VARIANT.txt}"
mkdir -p "$BUILD_DIR" "$HOST_BUILD_DIR" "$(dirname "$RESULTS_PATH")"

GENERATOR_ARGS=()
if command -v ninja >/dev/null 2>&1
then
    GENERATOR_ARGS=(-G Ninja)
fi

cmake -S "$ROOT/Exhibits/VehiclePhysics/ProjectDriveJoltBuild" -B "$BUILD_DIR" \
    "${GENERATOR_ARGS[@]}" \
    -DCMAKE_BUILD_TYPE=Release \
    -DFRONTIER_DRIVE_SANITIZERS="$SANITIZER_FLAG"

cmake --build "$BUILD_DIR" --parallel "$(nproc 2>/dev/null || echo 2)"

cmake -S "$ROOT/Exhibits/LogStream" -B "$HOST_BUILD_DIR" \
    "${GENERATOR_ARGS[@]}" \
    -DCMAKE_BUILD_TYPE=Release \
    -DFRONTIER_TOMLPLUSPLUS_DIR="$TOML_ROOT"

cmake --build "$HOST_BUILD_DIR" --target Frontier --parallel "$(nproc 2>/dev/null || echo 2)"

{
    echo "=== Frontier Project-Drive + Engine Jolt Physics ($VARIANT) ==="
    "${CXX:-g++}" --version | head -n 1
    uname -srm
    echo "--- 1. ProjectDriveJoltValidation (Engine Jolt 5.6 + VehiclePhysics + Async Thread + dlopen ProjectDrive.dll) ---"
    "$BUILD_DIR/ProjectDriveJoltValidation" "$BUILD_DIR/project-drive/Output/ProjectDrive.dll"
    echo "--- 2. Frontier Project Browser Enumeration ---"
    "$HOST_BUILD_DIR/Frontier"
    echo "--- 3. Frontier Headless Session (ProjectDrive.frontier) ---"
    "$HOST_BUILD_DIR/Frontier" --project="$ROOT/Frontier/Projects/Project-Drive/ProjectDrive.frontier" --headless
} | tee "$RESULTS_PATH"
