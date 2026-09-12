# Project Zero ReSTIR capture status

The production capture seam is implemented, but this sandbox cannot execute it.

## Completed production path

- `Projects/Project-Zero/Source/GameExecution.cpp` accepts `FRONTIER_RESTIR_CAPTURE`,
  `FRONTIER_RESTIR_CAPTURE_FRAMES`, and `FRONTIER_RESTIR_CAPTURE_OUTPUT`.
- Capture mode forces `RenderPathSelection::ReSTIR`, keeps GI as an independent on/off
  setting, pins native render scale, applies the solved Project Zero celestial/weather,
  camera and exposure states, and settles the requested accumulation count.
- `SwapchainExchange::RecordAndPresent` copies the actual ReSTIR storage image to a
  host-visible staging buffer before the editor/UI overlay and swapchain blit. It does
  not copy the CPU/software-raster upload.
- `Scratchpad/RenderProjectZeroRestirCapture.sh` is the entry point. Its accepted specs
  are `clear_GIon`, `cloud_GIon`, `clear_GIoff`, and `cloud_GIoff`.

## Exact sandbox blocker

On 2026-09-12 the repository's available toolchain was inspected after initializing
its two declared submodules (`imgui` and `stb`):

- `cmake` is not installed;
- no Vulkan header was found (`vulkan/vulkan.h`);
- no Vulkan loader library or `pkg-config` Vulkan package is available;
- neither `glslc` nor `slangc` is installed;
- the declared `tomlpp` submodule is absent, so `toml++/toml.hpp` is missing;
- therefore the Linux CMake target cannot be configured, the direct GameExecution
  compile stops at the missing TOML header, shaders cannot be lowered by the normal
  build toolchain, `build/Project-Zero` cannot be compiled, and no Vulkan/GLFW window
  or ICD can be launched in this environment.

The repository's npm/WebAssembly `Scratchpad/CheckShaderCompile.sh` compiler is a
separate available check: all seven compute shaders passed there. It is syntax/parity
validation only and does not produce a runnable Vulkan executable. For the host-side
syntax seam, a temporary untracked clone of `tomlplusplus` was supplied to
`Scratchpad/CheckBuildIntegrity.sh`; `GameExecution.cpp` then parsed successfully.
The temporary dependency was removed afterward, so it is not part of the deliverable.

The wrapper intentionally exits with status 2 when `build/Project-Zero` is absent; it
never substitutes the CPU proof or emits a falsely labelled ReSTIR image.

## Evidence that does run here

The CPU proof is production-sequence evidence only and is labelled accordingly:

- `ProjectZeroCelestial_VisibilityRaster_GIoff_Standard_ClearSky_SunDisc.png`
- `ProjectZeroCelestial_VisibilityRaster_GIoff_Standard_ClearSky_SunDisc_Zoom.png`
- `ProjectZeroCelestial_VisibilityRaster_GIoff_Standard_CloudGodRays.png`
- the remaining dawn, sunset, moon/stars and cloud-kernel outputs in this directory

The parity gates run through the same packed celestial/weather records and march equations:

- `Scratchpad/CheckSkyKernel.sh` — PASS
- `Scratchpad/CheckWindField.sh` — PASS
- `Scratchpad/CheckVolumetricMedia.sh` — PASS
- `Scratchpad/CheckProofFidelity.sh` — PASS

On a desktop with the missing Vulkan build/runtime dependencies, run for example:

```bash
FRONTIER_BUILD_DIR=build Scratchpad/RenderProjectZeroRestirCapture.sh clear_GIon
FRONTIER_BUILD_DIR=build Scratchpad/RenderProjectZeroRestirCapture.sh cloud_GIoff
```
