#!/usr/bin/env bash
# Render a real Project-Zero ReSTIR storage-image capture through the normal windowed renderer.
#
# This is intentionally not a CPU fallback. The executable must bring up Vulkan, run the packed Project Zero
# scene through ReSTIR, settle the requested temporal frame count, and copy the resolved storage image before the
# swapchain/UI blit. The sandbox may not have an ICD; in that case the script reports the runtime blocker while the
# capture seam and parity code remain testable in a desktop build.
set -euo pipefail

Root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
Build="${FRONTIER_BUILD_DIR:-$Root/build}"
if [[ "$Build" != /* ]]; then Build="$Root/$Build"; fi
Spec="${1:-clear_GIon}"
Frames="${FRONTIER_RESTIR_CAPTURE_FRAMES:-64}"
if [[ -n "${2:-}" ]]; then
    Output="$2"
else
    GIState="$([[ "$Spec" == *GIoff* ]] && echo GIoff || echo GIon)"
    if [[ "$Spec" == *clear* ]]; then
        Output="$Root/Diagnostics/ProjectZeroCelestial_ReSTIR_${GIState}_Standard_Dawn_ClearSky_SunDisc.png"
    else
        Output="$Root/Diagnostics/ProjectZeroCelestial_ReSTIR_${GIState}_Standard_LateMorning_CloudGodRays.png"
    fi
fi

if [[ ! -x "$Build/Project-Zero" ]]; then
    echo "[ReSTIR capture] $Build/Project-Zero is not built; configure/build the Project-Zero target first." >&2
    exit 2
fi

mkdir -p "$(dirname "$Output")"
echo "[ReSTIR capture] scene=Project Zero celestial path=ReSTIR GI=$([[ "$Spec" == *GIoff* ]] && echo off || echo on) state=$([[ "$Spec" == *clear* ]] && echo clear || echo cloud) frames=$Frames"
echo "[ReSTIR capture] output=$Output"

cd "$Root"
FRONTIER_RESTIR_CAPTURE="$Spec" \
FRONTIER_RESTIR_CAPTURE_FRAMES="$Frames" \
FRONTIER_RESTIR_CAPTURE_OUTPUT="$Output" \
"$Build/Project-Zero"
