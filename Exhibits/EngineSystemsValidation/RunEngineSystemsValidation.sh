#!/usr/bin/env bash
# 🧩 Build and run Frontier EngineSystemsValidation in Release or SANITIZE=1 mode.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="$ROOT/.local/cmake/data/bin:$ROOT/.local/bin:$HOME/.local/bin:$PATH"
cd "$ROOT"

if [[ "${SANITIZE:-0}" == "1" ]]; then
    BUILD_DIR="$ROOT/build/engine-systems-sanitized"
    EXTRA_FLAGS="-O1 -g -fsanitize=address,undefined -fno-omit-frame-pointer"
    BUILD_TYPE="RelWithDebInfo"
else
    BUILD_DIR="$ROOT/build/engine-systems-release"
    EXTRA_FLAGS="-O2"
    BUILD_TYPE="Release"
fi

cmake -S "$ROOT/Exhibits/EngineSystemsValidation" -B "$BUILD_DIR" \
    -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
    -DCMAKE_CXX_FLAGS="$EXTRA_FLAGS" \
    -DCMAKE_EXE_LINKER_FLAGS="$EXTRA_FLAGS"

cmake --build "$BUILD_DIR" -j"$(nproc)"
"$BUILD_DIR/EngineSystemsValidation"
