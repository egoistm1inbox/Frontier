# Native Photometric Workspace — LM-63 Type-C import

The native C++ Photometric Workspace imports bounded LM-63 Type-C `.ies` profiles into workspace-local state. It is a staged UI shell: imported curves and estimates are preview data, not scene persistence or renderer/shader integration.

## Parser and supported scope

- Requires `TILT=NONE` and LM-63 photometric type 1 (Type C); external tilt tables and other photometric types are rejected.
- Caps input at 4 MiB; vertical angles at 2–181 and horizontal angles at 1–361; requires finite, strictly increasing angle lists in the Type-C ranges.
- Accepts C-plane symmetry coverage ending at 0°, 90°, 180°, or 360°. Applies the candela multiplier, retains the full C-plane-major candela grid, and builds a peak-normalized 16×32 periodic atlas for sampling.
- Parsing is transactional: malformed, over-limit, or unsupported input returns an error without replacing the destination profile. File loading checks size before reading and keeps a normalized UTF-8 source path.

## Workspace behavior

- `Load .ies` opens a native Windows file picker. Other platforms show an editable path modal.
- The imported profile is assigned to the selected IES luminaire, or to the first IES luminaire if another node is selected. It remains in memory for the life of that workspace state.
- The IES inspector displays peak-normalized C0° and C90° candela curves. The wall-screen lux estimate samples the imported distribution in the luminaire's local photometric frame and applies candela/lumen scaling and the profile multiplier.
- Selecting a bundled measured profile or an analytical preset clears the custom-profile index. Rejected files raise a visible toast and log entry; exports, suite links, and persistent scene/renderer operations remain explicit NOOPs.

## Validation

`Fixtures/TypeC_Imported.ies` is a small synthetic test fixture, not manufacturer data. `PhotometricWorkspaceValidation` checks its LM-63 header, candela multiplier and grid order, C0/C90 samples, atomic rejection of unsupported tilt/type, excess angle counts, truncated candela data, and an input above the 4 MiB cap. On non-Windows hosts it also drives the path modal through import and assignment.

The current verification passed `PhotometricWorkspaceValidation` (CTest 1/1). The wall-lux probe reported baseline `58.0409 lx`, imported `64.3450 lx`, and dimmed imported profile `57.0453 lx`.

```sh
cmake --build build/photometric-ies --target PhotometricWorkspaceValidation
ctest --test-dir build/photometric-ies -R '^PhotometricWorkspaceValidation$' --output-on-failure
```

The C++ workspace is separate from `Experimental Remastered/PhotometricEditor`; that browser editor's view captures are documented in its own README.

## Native ReSTIR rendered proofs

The images below are offscreen captures of the staged Photometric Studio UI composed over a readback from the production `RenderingExtension`. They were rendered with the repository's stored `EngineContent/ShaderArchives` on Vulkan SwiftShader (CPU), and each capture verifies that the renderer reports the RTX ReSTIR path. The staged measured profiles are translated to the renderer's native beam families (low beam, high beam, fog cutoff, or roadway batwing); the custom LM-63 importer remains workspace-local and is not yet a persisted shader distribution.

| Roadway | Architectural gallery | Softbox studio | Night and lunar field |
| --- | --- | --- | --- |
| ![Roadway ReSTIR render](Images/NativeReSTIR-Roadway.png) | ![Gallery ReSTIR render](Images/NativeReSTIR-Gallery.png) | ![Studio ReSTIR render](Images/NativeReSTIR-Studio.png) | ![Lunar ReSTIR render](Images/NativeReSTIR-Lunar.png) |

To regenerate these captures in a configured build:

```sh
cmake --build build/photometric-ies --target PhotometricWorkspaceCapture
VK_ICD_FILENAMES=/tmp/vk_swiftshader_icd.json \
  LD_LIBRARY_PATH=/tmp:${LD_LIBRARY_PATH} \
  ./build/photometric-ies/PhotometricWorkspaceCapture \
  EngineContent Projects/Everest EngineContent/ShaderArchives \
  Exhibits/PhotometricWorkspace/Images 2
```

The last argument is the number of progressive refreshes per rig (1–8). Each saved PNG includes the native renderer readout and the selected Photometric workspace scenario.
