# Parametric Sketcher Phase 1 Report

> **TL;DR:** The first native Parametric Sketcher slice is now present on `arena/d67d44b5-frontier`: validated planar profiles, exact prismatic measurements, derived `PolygonNetwork` display surfaces, native `.Sketch` persistence, plus deterministic visual proof. No SolidArc host, legacy UI, legacy renderer, or `.solidarc` writer was imported.

## Delivered

| Area | Native implementation | Result |
| :--- | :--- | :--- |
| Sketch profile | `Engine/ParametricSketcher/Sketching/SketchProfile.*` | Validates finite, simple, non-degenerate closed planar contours; computes signed area, area, perimeter. |
| Exact solid | `Engine/ParametricSketcher/Solids/PrismaticBody.*` | Retains profile reference plus extrusion distance; computes exact volume plus surface area. |
| Document ownership | `Engine/ParametricSketcher/ParametricSketcherDocument.*` | Uses persistent profile/body ordinals; refuses broken references or duplicate ordinals. |
| Target display bridge | Existing `AppendLinearExtrusionPrimitive` plus `PolygonNetwork` | Generates derived display faces without replacing the exact authoring definition. |
| Native persistence | `Engine/Codecs/SketchCodec.*` | Writes `.Sketch` with `.SketchPlane`, `.SketchProfile`, `.PrismaticBody` sections in the existing aligned Two-Tier container. |
| Integrity | Existing FNV-1a section checks plus new manifest-count verification | Refuses bit corruption or Tier 1/Tier 2 count disagreement. |
| MatCap fields | Existing `FaceShadingAssignment` | Retains body MatCap slot plus PBR parameters in `.Sketch`. |
| Validation proof | `Exhibits/ParametricSketcherGeometryValidation.cpp` | Proves rectangular profile, prism measurements, derived half-edge network, persistence, corruption refusal, PNG output. |

## Verified slice

| Check | Expected | Result |
| :--- | :--- | :--- |
| Profile area | `3 m × 2 m = 6 m²` | Pass |
| Profile perimeter | `10 m` | Pass |
| Extrusion volume | `6 m² × 4 m = 24 m³` | Pass |
| Prism surface | `2 × 6 m² + 10 m × 4 m = 52 m²` | Pass |
| Derived render network | `8` vertices, `8` triangulated faces | Pass |
| Invalid bow-tie contour | Refused before document insertion | Pass |
| Invalid MatCap slot | Refused before body construction | Pass |
| `.Sketch` reconstruction | Profile count, body count, area, MatCap slot | Pass |
| Required plane metadata | Missing `.SketchPlane` manifest rejected | Pass |
| Tier 2 alignment | Every `.Sketch` binary section at `64 B` boundary | Pass |
| Corruption refusal | One altered Tier 2 bit rejected | Pass |
| Visual proof | `Exhibits/Images/ParametricSketcher/PhaseOneSketchPrism.png` | Pass |

## Local verification

```bash
# Direct GCC validation because this Arena image does not provide cmake or ninja.
g++ -std=c++20 -O0 -g -Wall -Wextra -Wpedantic -pthread \
  -DFRONTIER_PROFILE_EDITOR=0 -DFRONTIER_PROFILE_DEVELOPMENT=1 -DFRONTIER_PROFILE_SHIPPING=0 \
  -DFRONTIER_REPO_ROOT_DIR='"/home/user/Frontier"' \
  -I. -IExternalPackages/tomlpp/include -IExternalPackages/imgui -IExternalPackages/stb \
  Exhibits/ParametricSketcherGeometryValidation.cpp \
  Engine/ParametricSketcher/Sketching/SketchProfile.cpp \
  Engine/ParametricSketcher/Solids/PrismaticBody.cpp \
  Engine/ParametricSketcher/ParametricSketcherDocument.cpp \
  Engine/Codecs/SketchCodec.cpp Engine/Codecs/SpaceContainerCodec.cpp \
  Engine/Codecs/RevisionCodec.cpp Engine/Workspaces/Revision/ContentRegion.cpp \
  Engine/Workspaces/Revision/NonLinearHistory.cpp Engine/Workspaces/Revision/OperationRecorder.cpp \
  Engine/Workspaces/Revision/CursorResolution.cpp Engine/Workspaces/Revision/RevisionTracker.cpp \
  Engine/GeometrySpace/Network/PolygonNetwork.cpp \
  Engine/GeometrySpace/Primitives/RevolutionSweepPrimitives.cpp \
  ExternalPackages/imgui/imgui.cpp ExternalPackages/imgui/imgui_draw.cpp \
  ExternalPackages/imgui/imgui_tables.cpp ExternalPackages/imgui/imgui_widgets.cpp \
  -o Build/ParametricSketcherDirect/ParametricSketcherGeometryValidation

Build/ParametricSketcherDirect/ParametricSketcherGeometryValidation
```

Result:

```text
PASS: body=1, volume=24.00 m3, surface=52.00 m2
```

`cmake` plus `ninja` are unavailable in this runner, so the standard three-profile CMake matrix remains pending a toolchain-capable runner. The direct Development-profile compilation covers every new Phase 1 translation unit, target persistence code, revision linkage, target polygon extrusion, plus ImGui software-raster visual proof. A second direct run with GCC AddressSanitizer plus UndefinedBehaviorSanitizer also passed with leak detection enabled.

## Baseline import

| Source | Local commit | Scope |
| :--- | :--- | :--- |
| `SultanAladin/Frontier-1` `arena/39c6910b-frontier-1` at clone time `7688e9c1c3a1a36946668b44bffaf8d5318428be` | `57537de` | Frontier source, configuration, automation, documentation, engine content, experimental references, validation sources. |
| Upstream exhibit PNG corpus | Not copied | `616 MiB` baseline artifact corpus was excluded to stay within Arena patch artifact limits; new Parametric Sketcher visual proof is tracked. |

## Next slice

1. Add compact Parametric Sketcher revision entries for driving dimensions plus extrusion edits.
2. Build the native session, outliner, inspector, target viewport host, GPU pick schema, MatCap viewport path.
3. Add Slang grid, curve, dimension, selection overlays; no ImGui viewport geometry.
4. Add constraint classes before NURBS, booleans, fillets, chamfers, or legacy `.solidarc` import.
