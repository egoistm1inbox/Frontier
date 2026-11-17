# SolidArc upstream audit

**Audit date:** 2026-11-17 (UTC)

**Audited upstream:** `unassignedinbox/Frontier-OLD`, branch `arena/255c3b21-frontier`

**Pinned tip:** `30728d450f6a97e4d4e7b7f4a8f0016e3fa1ebc8` — 2026-11-10 16:06:52 UTC

**Latest SolidArc-focused change reviewed:** `84a61abe56c91008bb2bd574f9e6cf02669269d3` — “isolate sub-object face/edge/vertex transforms and eliminate bevel/UI stalls”

## Executive summary

SolidArc is a substantial CAD/B-rep workspace **integrated into Frontier**, not a standalone engine. The integration is technically real: its document layer, geometry kernel, viewport, native host, project-browser bridge, assets, and validation suite are present and a Linux CPU validation executable was built successfully from the pinned source.

The source is **not release-ready without follow-up**:

1. **P0 — performance regression gates fail.** The current `SolidArcDocumentValidation` exceeds its own timing limits on twisted-NURBS bevels (up to **9.55 s** vs a **3.0 s** pair limit) and its oversized bevel-limit probe (**6.12 s** vs **3.0 s**). These are explicitly anti-freeze checks.
2. **P1 — a split-viewport automation validation is currently red.** The split-layout implementation is rendered and its direct splitter/GPU-pane checks pass, but the scripted menu sequence cannot resolve `@ViewportSplit` after the first menu cycle. This looks like widget-board/script lifecycle coverage failure; it still blocks a clean validation run.
3. **P1 — active Windows CI builds/packages but does not run SolidArc validations or a Windows launch smoke test.** The failures above can therefore reach the packaged artifact undetected.
4. **P1 — provenance is documented, but there is no repository-level license grant.** The provenance notice explicitly says it “does not invent a new licence grant.” Legal approval is needed before redistribution or merging into a product branch.
5. **P2 — the advertised isolated CMake entry point is absent.** `Experimental/SolidArc/Native/SolidArc.cmake` says it can be included by `Experimental/SolidArc/Native/CMakeLists.txt`; that file is not tracked at the audited tip. The root build is monolithic enough that a sparse SolidArc checkout cannot configure with `BUILD_TESTING=ON`.

No merge was attempted. The current destination checkout is only the Frontier placeholder README, so it is not an identified compatible engine base for this integrated port.

## Clone and workspace state

A shallow, blob-filtered sparse clone was created at [`SolidArc-upstream/`](SolidArc-upstream/):

```sh
git clone --depth 1 --filter=blob:none --sparse \
  --branch arena/255c3b21-frontier \
  https://github.com/unassignedinbox/Frontier-OLD.git SolidArc-upstream
```

The clone is intentionally separate from this repository and ignored by this repository’s `.gitignore`; it must not be accidentally committed as a nested checkout.

Selected sparse paths cover the CAD workspace plus the Frontier support needed for the audited build:

- `Automation`, `Engine`, `Frontier`, `UI`
- `UI/SolidArc`, `Experimental/SolidArc`, `Exhibits/SolidArc`
- SolidArc icons, shader archive, geometry STEP fixtures, vehicle sample, Everest project support
- Two additional small source paths needed by the current root CMake graph for the Linux build (`Exhibits/ClusterDiagnostic/Code` and `Documentation/Notices`); generated fonts were prepared only for the audit build and are not tracked upstream

The upstream clone is shallow (`git rev-parse --is-shallow-repository` is `true`) and uses the `blob:none` promisor filter. To expand it later, use `git -C SolidArc-upstream sparse-checkout add <path>`.

## What was examined

### Architecture and integration surface

| Area | Evidence |
|---|---|
| CAD kernel | `Engine/GeometryProcessing/` builds `FrontierGeometryProcessing`: topology, B-rep construction, booleans, blend/rolling-ball geometry, NURBS, intersections, tessellation, sketch solving, feature replay, exchange, drawing and audits. |
| Document layer | `FrontierSolidArcDocument` owns `.solidarc` documents, TOML codec, image planes, material caps, drawing sheets, STEP/STL exchange, scene construction and specimens. |
| Viewport/UI | `FrontierSolidArcUI` uses Vulkan/volk, ImGui, the committed shader archive, docking, picker/snapping, gizmos, camera controls and SolidArc-specific UI panes. |
| Native host | `SolidArc` produces `SolidArcWorkspace` when GLFW hosting is enabled. `SolidArcCapture` provides the offscreen/scripted execution path. |
| Frontier bridge | `FrontierSolidArcBrowser` makes `.solidarc` previews and launch hand-off available in Frontier’s existing project browser. `SolidArcBrowserLink.cpp` uses platform-native process creation with a dedicated Windows argument-quoting routine and `execv` argument vectors on POSIX. |
| Packaging | The SolidArc install component copies the executable, options, fonts, icons, vehicle sample and third-party notices. |
| Scale | The sparse source selection contains approximately **59,459** SolidArc-specific C/C++/Slang lines; the selected engine/UI/CAD support is approximately **156,709** such lines. |

`Exhibits/SolidArc/README.md` scopes the port clearly: reuse Frontier’s UI/dependencies/browser; retain a separate CAD workspace process; do not add CAD tools directly to the Everest viewport; do not import unrelated Slate applications or T-splines/SubD.

### Provenance and licensing

The repository supplies two partially differing provenance statements:

- `Exhibits/SolidArc/README.md` describes the source integration as based on `streamlinkinbox/Frontier` commit `e72d319...`, with SolidArc source/fixes from `SultanAladin/Slate` commit `c3a187...`.
- `Documentation/Notices/SolidArcProvenance.md` says CAD sources originate in `unassignedinbox/Frontier` commit `82ed251...`, with SolidArc overlays/NURBS precision changes from the same Slate commit; it also names `SultanAladin/Frontier` `65cf0f...` as a three-way port comparison.

The notice correctly warns that it does **not** grant a new license. No repository-root `LICENSE`, `LICENCE`, `COPYING`, or `NOTICE` file was found in the audited tree. Reconcile the provenance statements and obtain an explicit license/redistribution decision before merging, releasing, or reusing this port outside the source-audit context.

## Build and validation evidence

### Dependency recovery

`python Automation/PrepareUI.py` completed successfully. It downloaded eight pinned sources and verified the listed archive SHA-256 values before extraction:

- ImGui `3bae66c...`, with all eight Frontier UI patches applied
- ThorVG `6715f99...`
- toml++ `1e8829b...`
- GLFW `a74efa0...`
- Vulkan-Headers `v1.4.321`
- stb `2c980bb...`
- volk `a8da8ef...`
- JoltPhysics `e77f175...`

`PrepareUI.py --verify` and `ApplyImGuiPatches.py --verify` both passed. Font recovery completed with **35 faces across five families** and `PrepareFonts.py --verify` passed.

**Supply-chain follow-up:** `PrepareUI.py --verify` treats a matching `.frontier-revision` stamp as sufficient and does not re-hash an already-populated dependency tree or verify its witness file. Fresh downloads are checksummed correctly; a later local tamper of a stamped dependency would not be detected by the current verification mode. Re-hash the extracted sources (or record a tree digest) in `--verify`.

### Linux build

A local audit toolchain used GCC 12.2, Python 3.11, CMake 4.4.5 and Ninja 1.13.2. The following configuration and build completed:

```sh
cmake -S . -B Build/Audit -G Ninja \
  -DFRONTIER_BUILD_SOLIDARC=ON \
  -DSOLIDARC_WINDOWED_HOST=OFF \
  -DFRONTIER_HOST_VERIFICATION=ON \
  -DBUILD_TESTING=OFF
cmake --build Build/Audit --target SolidArcDocumentValidation --parallel 2
```

The build compiled and linked **211** Ninja steps, including `FrontierGeometryProcessing`, `FrontierSolidArcDocument`, `FrontierSolidArcUI`, `SolidArcImGuiVulkan`, `SolidArcVolk`, and `SolidArcDocumentValidation`.

A normal `BUILD_TESTING=ON` root configure cannot work from this deliberately sparse checkout because the root CMake file unconditionally describes many non-SolidArc exhibit test targets. This is useful audit evidence of build coupling, not a claim that the complete upstream checkout lacks those files. An isolated native CMake entry point or more granular CMake options would make the CAD workspace independently buildable/testable.

### Document validation result

`Build/Audit/SolidArcDocumentValidation` ran for about **541 seconds** and exited **1**. Focused, reproducible batch results are below; the green groups passed completely.

| Batch | Coverage | Result |
|---|---|---|
| W83–W86 | hotkeys/outliner, dimensions, selection synchronization, grid/orientation cube | **PASS** |
| W87–W89 | transforms, numpad camera, split viewport | **FAIL** — W89 menu/script target resolution |
| W90–W91 | gizmo zoom stability and interactive dimensions | **PASS** |
| W92–W95 | dimension editing, header toggle, twisted-NURBS blends, reshape | **FAIL** — W94 performance |
| W96–W97 | sub-object transforms and freeze guards | **FAIL** — W97 bevel-limit probe timing |

The sparse selection contains SolidArc’s 66 icons but not every generic Frontier icon family. The validation emitted missing/unsupported generic-icon diagnostics for that deliberately omitted content; those warnings are a sparse-checkout artifact and are not counted below as upstream source failures. A full asset checkout is needed for a final icon-packaging audit.

## Findings and recommended disposition

### P0 — W94: twisted-NURBS bevel performance misses the anti-freeze contract

**Observed:**

- Single-edge twisted-NURBS fillets: **4.94 s** worst case, while the validation requires `< 2.5 s`.
- Two-edge fillet: **9.55 s**, while the validation requires `< 3.0 s`.
- Geometry was still accepted/sound (9/12 viable edges; three reflex-notch edges refused cleanly), so this is a responsiveness regression rather than an immediate geometry-correctness failure.

**Locations:** `Exhibits/SolidArc/Code/SolidArcDocumentValidation.cpp` W94; likely investigation starts in `Engine/GeometryProcessing/Blend/`, `Geometry/RollingBallCarrier.cpp`, NURBS/intersection code, and the audit/triangulation paths touched by `84a61abe`.

**Recommendation:** profile the W94 fixture with operation tracing enabled; identify the slowest edge/pair and add per-phase timings. Do not relax the threshold before comparing against a Windows release-toolchain baseline. The code must preserve refusal semantics while bounding rolling-ball/intersection/triangulation work.

### P0 — W97: oversized bevel-limit probing still stalls for too long

**Observed:** the per-frame cap passes (**maximum one kernel rebuild per UI frame**), and the astronomical zoom test passes (**34.49 ms** over four frames with 10,568 vertices). However, eight oversized NURBS bevel-probe frames still take **6.12 s**, exceeding the `< 3.0 s` contract.

**Locations:** `UI/SolidArc/Interface/SolidArcInterface.cpp`, especially `StageBevelPreview` and `ConfineBevelLimit`; the kernel blend path exercised by W94.

**Recommendation:** retain the one-rebuild rule but prevent expensive probes from consuming consecutive UI frames. Cache/refine the last accepted/refused interval, introduce a stricter time budget/cancellation boundary for probes, and add trace assertions for each preview stage.

### P1 — W89: split-viewport menu automation fails

**Observed:** the scripted menu sequence reports:

```text
line 1: target resolves (observed 'unresolved target ViewportSplit',
status='Viewport layout: 4 Quad (Ctrl+Alt+Q)')
```

The direct split-button presence check, internal crosshair splitter test, quad-pane raster test, hover routing, and axis-isolation checks all pass. `DrawViewportBar` does record `ViewportSplit` through `PressSolidArcRegion`; `SolidArcScript` clears/rebuilds its widget board each frame. This points to a lifecycle/timing issue between the script target resolver and docked-toolbar recording, not proof that the visual control is absent.

**Recommendation:** add a small W89 diagnostic that logs the widget board’s current/previous rectangle and clipped state before each scripted click. Then make scripted popup interactions wait for the next settled toolbar frame rather than treating a transient absent record as an immediate failure. Keep a real Windows/GPU interaction check as the acceptance criterion.

### P1 — CI does not enforce the CAD validation suite

The active `.github/workflows/EditorPreviewWindows.yml` configures with `-DBUILD_TESTING=OFF`, builds `Frontier`, `SolidArc`, and `TextureStudio`, packages them, and uploads an artifact. It does not run:

- `SolidArcDocumentValidation`
- SolidArc ctests/walkthroughs
- the Windows package validation script
- a Windows launch smoke test for `SolidArcWorkspace.exe`

The README itself says Windows executable/startup verification remains outstanding. Add a Windows job that first builds/runs the document validation (at least its CPU gates), then runs package and first-launch checks. Make performance gates visible in job summaries and required before publishing artifacts.

### P1 — license/provenance decision is outstanding

Treat the missing license grant and inconsistent provenance references as a release/merge blocker. Preserve a source manifest with exact commits, clarify the upstream authorization for the Slate-derived code and icons, and ship license notices only after that review.

### P2 — isolated build documentation does not match the tree

`Experimental/SolidArc/Native/SolidArc.cmake` states that an `Experimental/SolidArc/Native/CMakeLists.txt` can build the standalone configuration. There is no such tracked file at the audited tip. Either add and test that entry point, or remove/correct the claim. This matters because the root CMake dependency graph otherwise pulls broad editor/exhibit coverage even when only a CAD validation target is requested.

### P2 — sparse-asset and package verification

The current integration declares many generic Frontier icon paths at runtime while the SolidArc install component copies the main `EngineContent/Icons` directory and then SolidArc-specific icons. Run a full checkout/package validation on Windows to verify all generic icons, fonts, shader archives, and the side-by-side `SolidArcWorkspace.exe` launch contract. The current sparse audit cannot certify that full asset set.

## Security review notes

- No native HTTP/socket client was found in the selected SolidArc, geometry, and native-host C++ source. Network retrieval is limited to explicit Python preparation tooling.
- No uses of `strcpy`, `strcat`, `sprintf`, `vsprintf`, or `gets` were found in the selected C++ source. The code uses bounded formatting such as `std::snprintf`.
- The browser hand-off uses `CreateProcessW` on Windows with explicit CommandLineToArgvW-compatible quoting, and `fork` + `execv` with an argument vector on POSIX; this is materially safer than a shell launch.
- The workspace loads a Vulkan driver through volk/system configuration. Treat `DriverPath` as a trusted-local configuration boundary and exercise it in packaging/security review.

These are focused static checks, not a substitute for fuzzing untrusted `.solidarc`, STEP, STL, SVG, and image inputs.

## Practical next steps

1. Resolve W94/W97 against the pinned fixture before any performance or release claim.
2. Fix/instrument W89 and make the targeted batch green.
3. Add a standalone/isolated CMake entry point or split optional exhibit tests from the root build graph.
4. Add required Windows validation, package, and first-launch CI stages.
5. Obtain explicit provenance/license approval and reconcile the two provenance records.
6. Once the destination Frontier engine baseline is identified, perform a three-way compatibility plan rather than copying this integration wholesale.
